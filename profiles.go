package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Trusted proxies (X-Forwarded-For handling)
// ---------------------------------------------------------------------------

const defaultTrustedProxies = "127.0.0.1/8,::1"

var trustedProxyNets []*net.IPNet

func init() {
	initTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
}

// initTrustedProxies parses a comma separated list of CIDRs / bare IPs.
func initTrustedProxies(spec string) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		spec = defaultTrustedProxies
	}
	nets := make([]*net.IPNet, 0, 4)
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, n, err := net.ParseCIDR(part); err == nil {
			nets = append(nets, n)
			continue
		}
		ip := net.ParseIP(part)
		if ip == nil {
			log.Printf("trusted_proxy_invalid entry=%q", part)
			continue
		}
		bits := 32
		if ip.To4() == nil {
			bits = 128
		}
		nets = append(nets, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
	}
	trustedProxyNets = nets
}

func isTrustedProxy(host string) bool {
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil {
		return false
	}
	for _, n := range trustedProxyNets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Signed anonymous identity tokens
// ---------------------------------------------------------------------------

const (
	profileTokenVersion = "v1"
	profileTokenMaxAge  = 90 * 24 * time.Hour
)

var profileSecret []byte

// initProfileSecret loads PROFILE_SECRET or generates an ephemeral dev secret.
func initProfileSecret() {
	if s := strings.TrimSpace(os.Getenv("PROFILE_SECRET")); s != "" {
		profileSecret = []byte(s)
		return
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		log.Fatalf("profile_secret_rand_error: %v", err)
	}
	profileSecret = buf
	log.Printf("PROFILE_SECRET is not set: generated an ephemeral secret, player progress will NOT survive a restart")
}

func b64u(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func newProfilePID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// extremely unlikely; fall back to a time based value so we never hand out ""
		return hex.EncodeToString([]byte(fmt.Sprintf("%016x", time.Now().UnixNano())))
	}
	return hex.EncodeToString(buf)
}

func profileTokenSign(payload string) []byte {
	m := hmac.New(sha256.New, profileSecret)
	m.Write([]byte(payload))
	return m.Sum(nil)
}

// issueProfileToken builds v1.<b64(pid)>.<b64(iat)>.<b64(mac)>.
func issueProfileToken(pid string) string {
	iat := strconv.FormatInt(time.Now().Unix(), 10)
	payload := profileTokenVersion + "." + pid + "." + iat
	mac := profileTokenSign(payload)
	return profileTokenVersion + "." + b64u([]byte(pid)) + "." + b64u([]byte(iat)) + "." + b64u(mac)
}

func validProfilePID(pid string) bool {
	if len(pid) != 32 {
		return false
	}
	_, err := hex.DecodeString(pid)
	return err == nil
}

// parseProfileToken verifies signature and age, returning the carried pid.
func parseProfileToken(tok string) (string, bool) {
	tok = strings.TrimSpace(tok)
	if tok == "" || len(tok) > 512 {
		return "", false
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 4 || parts[0] != profileTokenVersion {
		return "", false
	}
	pidRaw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	iatRaw, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", false
	}
	macRaw, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return "", false
	}
	pid := string(pidRaw)
	if !validProfilePID(pid) {
		return "", false
	}
	want := profileTokenSign(profileTokenVersion + "." + pid + "." + string(iatRaw))
	if subtle.ConstantTimeCompare(macRaw, want) != 1 {
		return "", false
	}
	iat, err := strconv.ParseInt(string(iatRaw), 10, 64)
	if err != nil {
		return "", false
	}
	age := time.Since(time.Unix(iat, 0))
	if age > profileTokenMaxAge || age < -24*time.Hour {
		return "", false
	}
	return pid, true
}

// resolveProfileToken returns the pid to use plus a freshly minted token.
// The token is always re-issued so that the client's expiry keeps sliding.
func resolveProfileToken(tok string) (string, string) {
	pid, ok := parseProfileToken(tok)
	if !ok {
		pid = newProfilePID()
	}
	return pid, issueProfileToken(pid)
}

func shortPID(pid string) string {
	if len(pid) > 8 {
		return pid[:8]
	}
	return pid
}

// ---------------------------------------------------------------------------
// Balance helpers (profile is the single source of truth)
// ---------------------------------------------------------------------------

// addProfileStyleLocked applies a saturating delta. Caller holds profilesMu.
func addProfileStyleLocked(pr *Profile, delta uint32) {
	if pr == nil || delta == 0 {
		return
	}
	if pr.StyleBalance < ^uint32(0)-delta {
		pr.StyleBalance += delta
	} else {
		pr.StyleBalance = ^uint32(0)
	}
}

// applyProfileCosmeticsToPlayerLocked refreshes the player's read-only render
// cache from the profile. Caller holds profilesMu (and rm.mu when pl is live).
func applyProfileCosmeticsToPlayerLocked(pl *Player, pr *Profile) {
	if pl == nil || pr == nil {
		return
	}
	pl.style = pr.StyleBalance
	pl.cosInvCaptureFx = pr.CosInvCaptureFx
	pl.cosInvHead = pr.CosInvHead
	pl.cosInvSeg = pr.CosInvSeg
	pl.cosInvNameplate = pr.CosInvNameplate
	pl.cosInvFrame = pr.CosInvFrame
	pl.cosCaptureFx = pr.CosEqCaptureFx
	pl.cosHead = pr.CosEqHead
	pl.cosSeg = pr.CosEqSeg
	pl.cosNameplate = pr.CosEqNameplate
	pl.cosFrame = pr.CosEqFrame
	pl.cosInvTerr = pr.CosInvTerr
	pl.cosInvDeath = pr.CosInvDeath
	pl.cosTerr = pr.CosEqTerr
	pl.cosDeath = pr.CosEqDeath
	pl.titleID = pr.TitleID
}

// profileCosInvLocked returns a pointer to the inventory mask of a category,
// or nil for an unknown category. Caller holds profilesMu.
func profileCosInvLocked(pr *Profile, cat string) *uint8 {
	if pr == nil {
		return nil
	}
	switch cat {
	case "capturefx":
		return &pr.CosInvCaptureFx
	case "head":
		return &pr.CosInvHead
	case "seg":
		return &pr.CosInvSeg
	case "nameplate":
		return &pr.CosInvNameplate
	case "frame":
		return &pr.CosInvFrame
	case "terr":
		return &pr.CosInvTerr
	case "death":
		return &pr.CosInvDeath
	}
	return nil
}

// profileEquippedLocked returns the id currently equipped in a category, or 0
// for an unknown category. Caller holds profilesMu.
func profileEquippedLocked(pr *Profile, cat string) uint8 {
	if pr == nil {
		return 0
	}
	switch cat {
	case "capturefx":
		return pr.CosEqCaptureFx
	case "head":
		return pr.CosEqHead
	case "seg":
		return pr.CosEqSeg
	case "nameplate":
		return pr.CosEqNameplate
	case "frame":
		return pr.CosEqFrame
	case "terr":
		return pr.CosEqTerr
	case "death":
		return pr.CosEqDeath
	}
	return 0
}

// profileSetEquippedLocked equips an item. Caller holds profilesMu.
func profileSetEquippedLocked(pr *Profile, cat string, id uint8) {
	if pr == nil {
		return
	}
	switch cat {
	case "capturefx":
		pr.CosEqCaptureFx = id
	case "head":
		pr.CosEqHead = id
	case "seg":
		pr.CosEqSeg = id
	case "nameplate":
		pr.CosEqNameplate = id
	case "frame":
		pr.CosEqFrame = id
	case "terr":
		pr.CosEqTerr = id
	case "death":
		pr.CosEqDeath = id
	}
}

// ---------------------------------------------------------------------------
// Style income ceiling (anti farming / anti scripting)
// ---------------------------------------------------------------------------

const styleIncomePerMinute = 400

// styleIncomeGrantLocked clamps how much Style a profile may earn per minute.
// Returns the granted amount (0 means "drop it"). Caller holds profilesMu.
func styleIncomeGrantLocked(pr *Profile, pid string, delta uint16) uint16 {
	if pr == nil || delta == 0 {
		return delta
	}
	now := time.Now().Unix()
	if pr.styleWindowStart == 0 || now-pr.styleWindowStart >= 60 {
		pr.styleWindowStart = now
		pr.styleWindowGained = 0
		pr.styleWindowLogged = false
	}
	room := uint32(0)
	if pr.styleWindowGained < styleIncomePerMinute {
		room = styleIncomePerMinute - pr.styleWindowGained
	}
	if uint32(delta) > room {
		if !pr.styleWindowLogged {
			pr.styleWindowLogged = true
			log.Printf("style_rate_anomaly pid=%q gained=%d", shortPID(pid), pr.styleWindowGained+uint32(delta))
		}
		delta = uint16(room)
	}
	pr.styleWindowGained += uint32(delta)
	return delta
}

// styleDayIncomeGrantLocked applies the soft daily ceiling: the first
// StyleDaySoftCap Style of a day pay in full, everything past it pays 40%.
// Returns the granted amount. Caller holds profilesMu.
func styleDayIncomeGrantLocked(pr *Profile, delta uint16) uint16 {
	if pr == nil || delta == 0 {
		return delta
	}
	today := dayStampNow()
	if pr.DayIncomeDay != today {
		pr.DayIncomeDay = today
		pr.DayIncome = 0
	}
	reduce := func(v uint32) uint32 {
		out := (v*StyleOverCapNumer + StyleOverCapDenom - 1) / StyleOverCapDenom
		if out == 0 && v > 0 {
			out = 1
		}
		return out
	}
	full := uint32(0)
	if pr.DayIncome < StyleDaySoftCap {
		full = StyleDaySoftCap - pr.DayIncome
		if full > uint32(delta) {
			full = uint32(delta)
		}
	}
	out := full + reduce(uint32(delta)-full)
	if out > uint32(^uint16(0)) {
		out = uint32(^uint16(0))
	}
	if pr.DayIncome < ^uint32(0)-out {
		pr.DayIncome += out
	} else {
		pr.DayIncome = ^uint32(0)
	}
	return uint16(out)
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const (
	profilesFileVersion = 1
	profileTTL          = 90 * 24 * time.Hour
	profilesSaveEvery   = 30 * time.Second

	// DefaultProfileEmptyTTLHours is how long a profile with nothing in it is
	// kept. Such an entry only exists because someone touched a progress path
	// once; it costs a map slot and a slice of every 30s marshal, so it must
	// not sit around for the full 90 days. Override with
	// PROFILE_EMPTY_TTL_HOURS.
	DefaultProfileEmptyTTLHours = 6

	// DefaultMaxProfiles bounds the store. saveProfiles copies and marshals the
	// whole map under profilesMu, and profilesMu is taken from under rm.mu on
	// the hot paths, so an unbounded store stalls every room at once. Override
	// with MAX_PROFILES.
	DefaultMaxProfiles = 50000
)

var (
	profileEmptyTTL = loadProfileEmptyTTL()
	maxProfiles     = loadMaxProfiles()
)

func loadProfileEmptyTTL() time.Duration {
	if v := strings.TrimSpace(os.Getenv("PROFILE_EMPTY_TTL_HOURS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Hour
		}
	}
	return DefaultProfileEmptyTTLHours * time.Hour
}

func loadMaxProfiles() int {
	if v := strings.TrimSpace(os.Getenv("MAX_PROFILES")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return DefaultMaxProfiles
}

// profileHasProgressLocked reports whether a profile holds anything worth
// keeping for 90 days: currency earned or held, a cosmetic bought past the free
// default (bit 0), an achievement, a title or a real login streak.
// Caller holds profilesMu.
func profileHasProgressLocked(pr *Profile) bool {
	if pr == nil {
		return false
	}
	if pr.StyleBalance > 0 || pr.TotalStyleGained > 0 {
		return true
	}
	if pr.AchvMask != 0 || pr.TitleID != 0 {
		return true
	}
	if pr.StreakDays > 1 {
		return true
	}
	inv := [...]uint8{
		pr.CosInvCaptureFx, pr.CosInvHead, pr.CosInvSeg,
		pr.CosInvNameplate, pr.CosInvFrame, pr.CosInvTerr, pr.CosInvDeath,
	}
	for _, m := range inv {
		// Bit 0 is granted to everyone by ensureProfileCosmeticsLocked.
		if m&^uint8(1) != 0 {
			return true
		}
	}
	return false
}

// profileExpiredLocked applies the short TTL to empty profiles and the full one
// to profiles with progress. Caller holds profilesMu.
func profileExpiredLocked(pr *Profile, now time.Time) bool {
	if pr == nil {
		return true
	}
	ttl := profileEmptyTTL
	if profileHasProgressLocked(pr) {
		ttl = profileTTL
	}
	return pr.LastSeen < now.Add(-ttl).Unix()
}

// evictProfilesLocked keeps the store under maxProfiles: expired entries go
// first, then the least recently seen ones. Caller holds profilesMu.
func evictProfilesLocked(now time.Time) {
	if len(profiles) < maxProfiles {
		return
	}
	for pid, pr := range profiles {
		if profileExpiredLocked(pr, now) {
			delete(profiles, pid)
		}
	}
	if len(profiles) < maxProfiles {
		return
	}
	type entry struct {
		pid  string
		seen int64
	}
	list := make([]entry, 0, len(profiles))
	for pid, pr := range profiles {
		list = append(list, entry{pid, pr.LastSeen})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].seen < list[j].seen })
	drop := len(profiles) - maxProfiles + 1
	for i := 0; i < drop && i < len(list); i++ {
		delete(profiles, list[i].pid)
	}
}

var profilesDirty atomic.Bool

func markProfilesDirty() { profilesDirty.Store(true) }

func profilesPath() string {
	if p := strings.TrimSpace(os.Getenv("PROFILES_PATH")); p != "" {
		return p
	}
	return filepath.Join(".", "data", "profiles.json")
}

type profilesFileFormat struct {
	Version  int                 `json:"version"`
	SavedAt  int64               `json:"savedAt"`
	Profiles map[string]*Profile `json:"profiles"`
}

// touchProfileLastSeen bumps LastSeen for an existing profile only; it never
// creates one, so drive-by connections do not grow the store.
func touchProfileLastSeen(pid string) {
	if pid == "" {
		return
	}
	profilesMu.Lock()
	pr := profiles[pid]
	if pr != nil {
		pr.LastSeen = time.Now().Unix()
	}
	profilesMu.Unlock()
	if pr != nil {
		markProfilesDirty()
	}
}

// loadProfiles reads the store from disk. A missing file is not an error.
func loadProfiles() {
	path := profilesPath()
	b, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("profiles_load_error path=%q err=%v", path, err)
		}
		return
	}
	var f profilesFileFormat
	if err := json.Unmarshal(b, &f); err != nil {
		log.Printf("profiles_load_parse_error path=%q err=%v", path, err)
		return
	}
	if f.Version != profilesFileVersion {
		log.Printf("profiles_load_version_mismatch path=%q version=%d", path, f.Version)
		return
	}
	savedAt := f.SavedAt
	if savedAt == 0 {
		savedAt = time.Now().Unix()
	}
	now := time.Now()
	loaded, evicted := 0, 0
	profilesMu.Lock()
	for pid, pr := range f.Profiles {
		if pr == nil || !validProfilePID(pid) {
			continue
		}
		if pr.LastSeen == 0 {
			pr.LastSeen = savedAt
		}
		if profileExpiredLocked(pr, now) {
			evicted++
			continue
		}
		ensureProfileCosmeticsLocked(pr)
		profiles[pid] = pr
		loaded++
	}
	// A file written before the cap existed may be larger than it.
	evictProfilesLocked(now)
	loaded = len(profiles)
	profilesMu.Unlock()
	log.Printf("profiles_loaded path=%q count=%d evicted=%d", path, loaded, evicted)
}

// saveProfiles snapshots the store and writes it atomically (temp + rename).
func saveProfiles() error {
	path := profilesPath()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	now := time.Now()
	profilesMu.Lock()
	for pid, pr := range profiles {
		if pr == nil || profileExpiredLocked(pr, now) {
			delete(profiles, pid)
		}
	}
	evictProfilesLocked(now)
	snap := make(map[string]*Profile, len(profiles))
	for pid, pr := range profiles {
		cp := *pr
		snap[pid] = &cp
	}
	profilesMu.Unlock()

	b, err := json.Marshal(profilesFileFormat{
		Version:  profilesFileVersion,
		SavedAt:  time.Now().Unix(),
		Profiles: snap,
	})
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".profiles-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}

// flushProfiles persists only when something changed since the last write.
func flushProfiles(force bool) {
	if !force && !profilesDirty.Load() {
		return
	}
	profilesDirty.Store(false)
	if err := saveProfiles(); err != nil {
		profilesDirty.Store(true)
		log.Printf("profiles_save_error path=%q err=%v", profilesPath(), err)
	}
}

// startProfilesAutosave persists dirty state on a fixed interval.
func startProfilesAutosave(stop <-chan struct{}) {
	go func() {
		t := time.NewTicker(profilesSaveEvery)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				flushProfiles(false)
			}
		}
	}()
}
