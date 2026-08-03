// Package profiles — постоянное хранилище прогресса игроков и подписанная
// анонимная личность, по которой этот прогресс находится.
//
// Пакет ничего не знает ни про комнату, ни про игрока: он оперирует записью
// Profile и ключом. Перекладывание профиля в игрока живёт на стороне игры
// (profiles_player.go) — иначе хранилище тянуло бы за собой всю механику.
//
// Единственный на пакет мьютекс Mu защищает карту и любые изменения записей.
// Порядок захвата всегда rm.mu -> profiles.Mu; обратный порядок — дедлок.
package profiles

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"snakes/internal/metrics"
)

// ---------------------------------------------------------------------------
// Signed anonymous identity tokens
// ---------------------------------------------------------------------------

const (
	profileTokenVersion = "v1"
	profileTokenMaxAge  = 90 * 24 * time.Hour
)

var profileSecret []byte

// InitSecret loads PROFILE_SECRET or generates an ephemeral dev secret.
//
// An ephemeral secret means every token issued before the last restart fails
// verification: each player silently gets a fresh pid with a zero balance and
// an empty inventory, while the real profiles rot in profiles.json until TTL.
// The process still starts and both probes stay green, so the only signal is
// one log line. PROFILE_SECRET_REQUIRED turns that into a hard start failure —
// off by default so `go run .` without a config keeps working, on in
// production so a truncated env file fails the deploy instead of the players.
func InitSecret() {
	if s := strings.TrimSpace(os.Getenv("PROFILE_SECRET")); s != "" {
		profileSecret = []byte(s)
		return
	}
	if envFlagEnabled(os.Getenv("PROFILE_SECRET_REQUIRED")) {
		log.Fatalf("PROFILE_SECRET is empty and PROFILE_SECRET_REQUIRED is set: " +
			"refusing to start with an ephemeral secret, every player would lose their progress")
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		log.Fatalf("profile_secret_rand_error: %v", err)
	}
	profileSecret = buf
	log.Printf("PROFILE_SECRET is not set: generated an ephemeral secret, player progress will NOT survive a restart")
}

// envFlagEnabled — то же прочтение булевой переменной, что и у
// WS_ALLOW_LOCALHOST в internal/httpx: включено только явным 1/true/yes/on,
// всё остальное (включая пустое и опечатки) — выключено. Умолчание всегда
// «выключено», поэтому опечатка не может незаметно включить поведение.
//
// На вход идёт значение, а не имя: env_docs_test ищет по дереву литеральные
// os.Getenv("ИМЯ"), и переменная, прочитанная через параметр, выпала бы из
// сверки «код ↔ документация».
func envFlagEnabled(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
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

// ParseToken verifies signature and age, returning the carried pid.
func ParseToken(tok string) (string, bool) {
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

// ResolveToken returns the pid to use plus a freshly minted token.
// The token is always re-issued so that the client's expiry keeps sliding.
func ResolveToken(tok string) (string, string) {
	pid, ok := ParseToken(tok)
	if !ok {
		pid = newProfilePID()
	}
	return pid, issueProfileToken(pid)
}

func ShortPID(pid string) string {
	if len(pid) > 8 {
		return pid[:8]
	}
	return pid
}

// ---------------------------------------------------------------------------
// Balance helpers (profile is the single source of truth)
// ---------------------------------------------------------------------------

// AddStyleLocked applies a saturating delta. Caller holds Mu.
func AddStyleLocked(pr *Profile, delta uint32) {
	if pr == nil || delta == 0 {
		return
	}
	if pr.StyleBalance < ^uint32(0)-delta {
		pr.StyleBalance += delta
	} else {
		pr.StyleBalance = ^uint32(0)
	}
}

// CosInvLocked returns a pointer to the inventory mask of a category,
// or nil for an unknown category. Caller holds Mu.
func CosInvLocked(pr *Profile, cat string) *uint8 {
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

// EquippedLocked returns the id currently equipped in a category, or 0
// for an unknown category. Caller holds Mu.
func EquippedLocked(pr *Profile, cat string) uint8 {
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

// SetEquippedLocked equips an item. Caller holds Mu.
func SetEquippedLocked(pr *Profile, cat string, id uint8) {
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

// Потолки дневного дохода. Живут рядом с кодом, который их применяет: это
// единственное место, где они что-то значат.
//
// E13: мягкий дневной потолок, всё сверх него оплачивается на 40%.
// Поднят 600 -> 800 после того, как категории "terr" и "death" добавили 4750
// Стиля к полной коллекции (14865 всего): на 600 среднему игроку требовалось
// ~24 дня, чтобы закрыть магазин, вместо задуманных 2-3 недель. Реклейм доход
// не разгоняет — он обходит награду за захват, а та и так ограничена.
// G20/G23 подняли бюджет за захват 25 -> 70 и продлили выплату за место до 8-го
// плюс 5 за выживание, это ещё ~40 Стиля за хороший матч. Потолок съедает
// большую часть: измеренная средняя сессия по-прежнему даёт около 1000
// Стиля в день, то есть ~15 дней на полную коллекцию.
const (
	StyleDaySoftCap   = 800
	StyleOverCapNumer = 2
	StyleOverCapDenom = 5
)

// StyleIncomeGrantLocked clamps how much Style a profile may earn per minute.
// Returns the granted amount (0 means "drop it"). Caller holds Mu.
func StyleIncomeGrantLocked(pr *Profile, pid string, delta uint16) uint16 {
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
			log.Printf("style_rate_anomaly pid=%q gained=%d", ShortPID(pid), pr.styleWindowGained+uint32(delta))
		}
		delta = uint16(room)
	}
	pr.styleWindowGained += uint32(delta)
	return delta
}

// StyleDayIncomeGrantLocked applies the soft daily ceiling: the first
// StyleDaySoftCap Style of a day pay in full, everything past it pays 40%.
// Returns the granted amount. Caller holds Mu.
func StyleDayIncomeGrantLocked(pr *Profile, delta uint16) uint16 {
	if pr == nil || delta == 0 {
		return delta
	}
	today := DayStampNow()
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
	// whole map under Mu, and Mu is taken from under rm.mu on
	// the hot paths, so an unbounded store stalls every room at once. Override
	// with MAX_PROFILES.
	DefaultMaxProfiles = 50000
)

var (
	EmptyTTL    = loadProfileEmptyTTL()
	MaxProfiles = loadMaxProfiles()
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
// Caller holds Mu.
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
// to profiles with progress. Caller holds Mu.
func profileExpiredLocked(pr *Profile, now time.Time) bool {
	if pr == nil {
		return true
	}
	ttl := EmptyTTL
	if profileHasProgressLocked(pr) {
		ttl = profileTTL
	}
	return pr.LastSeen < now.Add(-ttl).Unix()
}

// ---------------------------------------------------------------------------
// Live profile registry (G7)
// ---------------------------------------------------------------------------

// liveProfilePIDs counts the connected clients per profile id. A profile held
// by a live connection is never evicted: LastSeen is only refreshed at join, on
// a Style grant and on a purchase, so an active player with an income at its
// ceiling can go minutes without a touch and used to be evictable — measured,
// an active profile with a balance of 500 was dropped and the next grant
// created an empty one in its place. Guarded by Mu.
var liveProfilePIDs = make(map[string]int)

// RetainPID marks a profile as held by a live connection.
func RetainPID(pid string) {
	if pid == "" {
		return
	}
	Mu.Lock()
	liveProfilePIDs[pid]++
	Mu.Unlock()
}

// ReleasePID undoes RetainPID.
func ReleasePID(pid string) {
	if pid == "" {
		return
	}
	Mu.Lock()
	if n := liveProfilePIDs[pid]; n > 1 {
		liveProfilePIDs[pid] = n - 1
	} else {
		delete(liveProfilePIDs, pid)
	}
	Mu.Unlock()
}

// evictSampleSize is how many entries one eviction pass looks at. A full sort
// under Mu measured 0.60ms at 20k profiles (~1.5-2ms at 50k) and
// Mu is taken from under rm.mu on hot paths, so every room in the
// process stalls for that long. Sampling k entries and dropping the oldest of
// them costs a fixed few microseconds and picks an almost-as-old victim.
const evictSampleSize = 64

// evictBatchSize is how many victims one pass retires, so the sampling cost is
// amortised over many admissions instead of running on every single one.
const evictBatchSize = 16

// evictProfilesLocked keeps the store under MaxProfiles: expired entries go
// first, then the least recently seen of a bounded random sample. Profiles held
// by a live connection are never candidates. Caller holds Mu.
func evictProfilesLocked(now time.Time) {
	if len(store) < MaxProfiles {
		return
	}
	for pid, pr := range store {
		if liveProfilePIDs[pid] > 0 {
			continue
		}
		if profileExpiredLocked(pr, now) {
			delete(store, pid)
		}
	}
	if len(store) < MaxProfiles {
		return
	}
	type entry struct {
		pid  string
		seen int64
	}
	// Go randomises map iteration order, so a truncated range is a random
	// sample.
	sample := make([]entry, 0, evictSampleSize)
	for pid, pr := range store {
		if liveProfilePIDs[pid] > 0 {
			continue
		}
		sample = append(sample, entry{pid, pr.LastSeen})
		if len(sample) >= evictSampleSize {
			break
		}
	}
	if len(sample) == 0 {
		// Everything left is live. Refusing to evict is the right call: the
		// alternative is deleting the progress of someone who is playing.
		log.Printf("profiles_evict_all_live count=%d", len(store))
		return
	}
	sort.Slice(sample, func(i, j int) bool { return sample[i].seen < sample[j].seen })
	// Retire a small batch so the sampling cost is amortised, but never more
	// than the store can spare: a tiny store (tests, tiny MAX_PROFILES) drops
	// exactly one entry.
	batch := MaxProfiles / 64
	if batch < 1 {
		batch = 1
	}
	if batch > evictBatchSize {
		batch = evictBatchSize
	}
	drop := len(store) - MaxProfiles + batch
	for i := 0; i < drop && i < len(sample); i++ {
		if pr := store[sample[i].pid]; pr != nil && profileHasProgressLocked(pr) {
			// Losing currency must never be silent.
			log.Printf("profiles_evict_with_progress pid=%q style=%d total=%d last_seen=%d",
				ShortPID(sample[i].pid), pr.StyleBalance, pr.TotalStyleGained, pr.LastSeen)
		}
		delete(store, sample[i].pid)
	}
}

var profilesDirty atomic.Bool

func MarkDirty() { profilesDirty.Store(true) }

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

// TouchLastSeen bumps LastSeen for an existing profile only; it never
// creates one, so drive-by connections do not grow the store.
func TouchLastSeen(pid string) {
	if pid == "" {
		return
	}
	Mu.Lock()
	pr := store[pid]
	if pr != nil {
		pr.LastSeen = time.Now().Unix()
	}
	Mu.Unlock()
	if pr != nil {
		MarkDirty()
	}
}

// profilesReadOnly latches when the store could not be loaded from an existing
// file (G6). The old code simply returned, leaving an empty store that the
// first autosave — or the flush on SIGTERM — wrote straight over the file:
// a truncated profiles.json silently turned into {"profiles":{}} and every
// player lost everything, with a green healthcheck and exit code 0. In
// read-only mode saving is refused entirely until an operator intervenes.
var profilesReadOnly atomic.Bool

// profilesReadOnlyReason is only ever written before the flag is set.
var profilesReadOnlyReason string

// enterProfilesReadOnly latches the read-only mode and quarantines the file
// that could not be read, so the operator still has the bytes.
func enterProfilesReadOnly(path, reason string, err error) {
	profilesReadOnlyReason = reason
	profilesReadOnly.Store(true)
	// Одной строки в логе для этого мало: без метрики и без /readyz режим
	// виден только тому, кто в этот момент читал journalctl.
	metrics.ProfilesReadOnly.Set(1)
	log.Printf("profiles_read_only reason=%s path=%q err=%v: saving is DISABLED, "+
		"player progress will not be persisted until the file is repaired or removed",
		reason, path, err)
	quarantine := fmt.Sprintf("%s.corrupt-%d", path, time.Now().Unix())
	if rerr := os.Rename(path, quarantine); rerr != nil {
		log.Printf("profiles_quarantine_error path=%q dst=%q err=%v", path, quarantine, rerr)
		return
	}
	log.Printf("profiles_quarantined path=%q dst=%q", path, quarantine)
}

// profilesSavingDisabled reports whether persistence is currently refused.
func profilesSavingDisabled() bool { return profilesReadOnly.Load() }

// ReadOnly reports the degraded state and why it was entered. It exists so the
// readiness probe can fail instead of answering "ready" while every byte of
// player progress is being dropped on the floor.
func ReadOnly() (bool, string) {
	if !profilesReadOnly.Load() {
		return false, ""
	}
	return true, profilesReadOnlyReason
}

// Load reads the store from disk. A missing file is not an error;
// anything else latches read-only mode (G6).
//
// normalize приводит только что загруженную запись в порядок: выдаёт бесплатные
// предметы, чинит экипировку, которой профиль не владеет, снимает титул за
// отобранную ачивку. Это правила игры, а не хранения, поэтому они приходят
// колбэком, а не живут здесь — иначе хранилище потянуло бы за собой каталог
// косметики и таблицу достижений. nil означает «грузить как есть».
func Load(normalize func(*Profile)) {
	path := profilesPath()
	b, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("profiles_load_error path=%q err=%v", path, err)
			enterProfilesReadOnly(path, "read_error", err)
		}
		return
	}
	var f profilesFileFormat
	if err := json.Unmarshal(b, &f); err != nil {
		log.Printf("profiles_load_parse_error path=%q err=%v", path, err)
		enterProfilesReadOnly(path, "parse_error", err)
		return
	}
	if f.Version != profilesFileVersion {
		log.Printf("profiles_load_version_mismatch path=%q version=%d", path, f.Version)
		enterProfilesReadOnly(path, "version_mismatch",
			fmt.Errorf("version %d, want %d", f.Version, profilesFileVersion))
		return
	}
	savedAt := f.SavedAt
	if savedAt == 0 {
		savedAt = time.Now().Unix()
	}
	now := time.Now()
	loaded, evicted := 0, 0
	Mu.Lock()
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
		if normalize != nil {
			normalize(pr)
		}
		store[pid] = pr
		loaded++
	}
	// A file written before the cap existed may be larger than it.
	evictProfilesLocked(now)
	loaded = len(store)
	Mu.Unlock()
	log.Printf("profiles_loaded path=%q count=%d evicted=%d", path, loaded, evicted)
}

// errProfilesReadOnly is returned by saveProfiles while the store is degraded.
var errProfilesReadOnly = errors.New("profiles store is read-only after a failed load")

// saveProfiles snapshots the store and writes it atomically (temp + rename).
// It refuses to run at all in read-only mode (G6).
func saveProfiles() error {
	if profilesSavingDisabled() {
		return errProfilesReadOnly
	}
	path := profilesPath()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	now := time.Now()
	Mu.Lock()
	for pid, pr := range store {
		if pr == nil || profileExpiredLocked(pr, now) {
			delete(store, pid)
		}
	}
	evictProfilesLocked(now)
	snap := make(map[string]*Profile, len(store))
	for pid, pr := range store {
		cp := *pr
		snap[pid] = &cp
	}
	Mu.Unlock()

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

// Flush persists only when something changed since the last write.
func Flush(force bool) {
	if profilesSavingDisabled() {
		// Never overwrite a file we failed to read (G6).
		return
	}
	if !force && !profilesDirty.Load() {
		return
	}
	profilesDirty.Store(false)
	if err := saveProfiles(); err != nil {
		profilesDirty.Store(true)
		metrics.ProfilesSaveErrors.Inc()
		log.Printf("profiles_save_error path=%q err=%v", profilesPath(), err)
	}
}

// StartAutosave persists dirty state on a fixed interval.
func StartAutosave(stop <-chan struct{}) {
	go func() {
		t := time.NewTicker(profilesSaveEvery)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				Flush(false)
			}
		}
	}()
}

var Mu sync.Mutex
var store = make(map[string]*Profile)

// Len — сколько записей лежит в хранилище.
func Len() int {
	Mu.Lock()
	n := len(store)
	Mu.Unlock()
	return n
}

// SwapStore подменяет карту профилей пустой и возвращает функцию
// восстановления.
//
// Карта одна на процесс, поэтому тест, который проверяет заведение или
// вытеснение записей, обязан начинать с чистого листа и не оставлять следов
// соседям. Рабочему коду подменять хранилище незачем.
func SwapStore() (restore func()) {
	Mu.Lock()
	prev := store
	store = make(map[string]*Profile)
	Mu.Unlock()
	return func() {
		Mu.Lock()
		store = prev
		Mu.Unlock()
	}
}

// StoredLocked отдаёт запись, которая действительно лежит в карте, или nil.
//
// Отличается от ForKey тем, что ничего не создаёт и не подменяет: путь чтения
// возвращает временный объект для игрока, у которого записи ещё нет, и будить
// ради изменений в таком объекте автосейв бессмысленно — сохранять нечего.
// Вызывать под Mu.
func StoredLocked(key string) *Profile {
	return store[key]
}

func DayStampNow() int64 {
	return time.Now().Unix() / 86400
}

// ForKey is the READ path. It returns the stored profile when there is
// one, otherwise a transient zero-value profile that is deliberately NOT put in
// the map: a connect/join/disconnect loop must not be able to grow the store.
// Writes through a transient profile are dropped, which is exactly right for a
// player who has not earned anything yet.
func ForKey(key string) *Profile {
	if key == "" {
		return nil
	}
	Mu.Lock()
	p := store[key]
	Mu.Unlock()
	if p == nil {
		p = &Profile{LastSeen: time.Now().Unix()}
	}
	return p
}

// ForKeyCreate is the WRITE path: it materialises the profile in the
// store. Only call it where there is real progress to persist (a Style grant, a
// quest step, a purchase) — never from a path a client can drive without
// actually playing.
func ForKeyCreate(key string) *Profile {
	if key == "" {
		return nil
	}
	Mu.Lock()
	defer Mu.Unlock()
	return ForKeyCreateLocked(key)
}

// ForKeyEquipLocked is the lookup used by the EQUIP paths
// (cosmeticsEquip, titleEquip). Equipping is not progress: nothing can be
// equipped that was not first bought or unlocked, and both of those already
// materialise the profile. Routing equip through ForKeyCreateLocked
// (G8) meant every visitor who merely opened the wardrobe minted a store entry
// — a free write amplifier against MAX_PROFILES that needed nothing but a
// websocket and a rate-limit-respecting loop. S5: hand back the stored profile
// when there is one, otherwise a transient with the free defaults. For such a
// profile the only owned item in every category is bit 0, which is already the
// equipped default, so every equip it can legally perform is a no-op and there
// is nothing to persist. The second return says whether the profile is stored,
// so callers know not to wake the autosave. Caller holds Mu.
func ForKeyEquipLocked(key string) (*Profile, bool) {
	if key == "" {
		return nil, false
	}
	if p := store[key]; p != nil {
		return p, true
	}
	return &Profile{LastSeen: time.Now().Unix()}, false
}

// ForKeyCreateLocked is ForKeyCreate for callers that already
// hold Mu, which is the only way to take the pointer and write through
// it in one critical section (G8).
func ForKeyCreateLocked(key string) *Profile {
	if key == "" {
		return nil
	}
	now := time.Now()
	p := store[key]
	if p == nil {
		evictProfilesLocked(now)
		p = &Profile{LastSeen: now.Unix()}
		store[key] = p
		MarkDirty()
	}
	return p
}
