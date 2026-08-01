package main

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// requestClientIP resolves the peer address used for rate limiting and logs
// only. X-Forwarded-For is honoured only when the immediate peer is a trusted
// proxy, and then the rightmost untrusted hop wins: everything to its left is
// attacker controlled and must not be believed.
func requestClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	host = strings.TrimSpace(host)
	if !isTrustedProxy(host) {
		return host
	}
	xff := r.Header.Get("X-Forwarded-For")
	if xff == "" {
		return host
	}
	parts := strings.Split(xff, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		ip := strings.TrimSpace(parts[i])
		if ip == "" {
			continue
		}
		if net.ParseIP(ip) == nil {
			// Malformed chain: stop trusting it entirely.
			return host
		}
		if isTrustedProxy(ip) {
			continue
		}
		return ip
	}
	return host
}

type tokenBucket struct {
	tokens   float64
	last     time.Time
	rate     float64
	burst    float64
	lastSeen time.Time
}

type ipRateLimiter struct {
	mu        sync.Mutex
	buckets   map[string]*tokenBucket
	lastSweep time.Time
}

const (
	// rateLimiterSweepAt is the bucket count above which idle entries are
	// dropped. One bucket exists per (IP, message type) pair.
	rateLimiterSweepAt = 5000
	// rateLimiterSweepEvery bounds how often the O(n) sweep runs.
	rateLimiterSweepEvery = 30 * time.Second
	// rateLimiterBucketTTL is how long an untouched bucket is kept.
	rateLimiterBucketTTL = 10 * time.Minute
	// rateLimiterBucketTTLTight is the fallback cutoff used when a normal
	// sweep did not bring the map back under the threshold.
	rateLimiterBucketTTLTight = time.Minute
)

// sweepLocked drops idle buckets. It must run on the accepted path too: the
// original code swept only after a rejection, so a server where nobody is
// being limited grew the map without bound. Caller holds l.mu.
func (l *ipRateLimiter) sweepLocked(now time.Time) {
	if len(l.buckets) <= rateLimiterSweepAt {
		return
	}
	if !l.lastSweep.IsZero() && now.Sub(l.lastSweep) < rateLimiterSweepEvery {
		return
	}
	l.lastSweep = now
	l.dropIdleLocked(now.Add(-rateLimiterBucketTTL))
	if len(l.buckets) > rateLimiterSweepAt {
		l.dropIdleLocked(now.Add(-rateLimiterBucketTTLTight))
	}
}

func (l *ipRateLimiter) dropIdleLocked(cut time.Time) {
	for k, v := range l.buckets {
		if v.lastSeen.Before(cut) {
			delete(l.buckets, k)
		}
	}
}

func (l *ipRateLimiter) allow(key string, rate float64, burst float64) bool {
	if l == nil {
		return true
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.buckets == nil {
		l.buckets = make(map[string]*tokenBucket)
	}
	b := l.buckets[key]
	if b == nil {
		b = &tokenBucket{tokens: burst, last: now, rate: rate, burst: burst, lastSeen: now}
		l.buckets[key] = b
	}
	b.lastSeen = now
	b.rate = rate
	b.burst = burst
	dt := now.Sub(b.last).Seconds()
	if dt > 0 {
		b.tokens = math.Min(b.burst, b.tokens+dt*b.rate)
		b.last = now
	}
	l.sweepLocked(now)
	if b.tokens >= 1 {
		b.tokens -= 1
		return true
	}
	return false
}

var wsIPLimiter = &ipRateLimiter{buckets: make(map[string]*tokenBucket)}

// normalizeWSOrigin makes both sides of the allowlist comparison canonical:
// scheme and host are case-insensitive, a trailing slash is not significant.
func normalizeWSOrigin(s string) string {
	s = strings.TrimRight(strings.TrimSpace(s), "/")
	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return strings.ToLower(s)
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host)
}

// wsAllowLocalhost keeps the "any loopback Origin is fine" shortcut. It is
// convenient in development and a hole in production, where it hands a page
// served by malware on the player's own machine a valid Origin: production was
// measured answering 101 to `Origin: http://localhost`.
//
// G9: OFF by default. Development turns it on explicitly with
// WS_ALLOW_LOCALHOST=1 (also true/yes/on).
var wsAllowLocalhost = loadWSAllowLocalhost()

func loadWSAllowLocalhost() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("WS_ALLOW_LOCALHOST"))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func isLoopbackOriginHost(h string) bool {
	h = strings.ToLower(strings.TrimSpace(h))
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

// wsOriginAllowed is the single arbiter of the WebSocket Origin check;
// websocket.Accept runs with InsecureSkipVerify so nothing rejects earlier.
func wsOriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		// Non-browser client: no Origin to judge.
		return true
	}
	if wsAllowLocalhost {
		if u, err := url.Parse(origin); err == nil && isLoopbackOriginHost(u.Hostname()) {
			return true
		}
	}
	_, ok := allowedWSOrigins[normalizeWSOrigin(origin)]
	return ok
}

func handleWS(hub *Hub, w http.ResponseWriter, r *http.Request) {
	if !wsOriginAllowed(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionNoContextTakeover,
		// wsOriginAllowed above is the only origin arbiter. The library's own
		// check compares Origin against the Host header and would reject every
		// cross-domain Origin before our allowlist is consulted, so WS_ORIGINS
		// could only narrow the set, never widen it. It also broke on any
		// non-default port where the proxy rewrites Host.
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	c.SetReadLimit(MaxClientWSMsgBytes)
	// Signed identity: the legacy ?pid= parameter is never trusted, only ?t=.
	pid, token := resolveProfileToken(r.URL.Query().Get("t"))
	client := &Client{conn: c, sendCh: make(chan outbound, 256), ip: requestClientIP(r), pid: pid}
	// G7: a profile held by a live connection is never an eviction candidate.
	retainProfilePID(pid)
	defer releaseProfilePID(pid)
	touchProfileLastSeen(pid)
	client.name.Store("Игрок")
	metrics.wsConnections.Add(1)
	metrics.wsActive.Add(1)
	go client.writeLoop()

	defer client.close()

	client.sendJSON(r.Context(), "hello", map[string]any{
		"w":               W,
		"h":               H,
		"tickMs":          TickMS,
		"roomLimit":       hub.roomLimit,
		"token":           token,
		"cosmeticsPrices": cosmeticsPricesPayload(),
		"titles":          titlesPayload(),
		"reclaimTicks":    ReclaimTicks,
		// Viewport contract: defaults the server uses until a "viewport"
		// message arrives, plus the bounds it will clamp that message to.
		"roi": map[string]any{
			"w": ROIWidth, "h": ROIHeight,
			"minW": ROIMinWidth, "minH": ROIMinHeight,
			"maxW": ROIMaxWidth, "maxH": ROIMaxHeight,
			"maxArea": ROIMaxArea,
			"step":    ROIStep,
		},
		// G24: the phase boundaries are static, so the client can render the
		// arc bar before it ever joins a room.
		"matchTicks": MatchDurationTicks,
		"phaseTicks": []uint32{PhaseExpansionEndTick, PhaseConflictEndTick},
		"phaseNames": []string{"expansion", "conflict", "final"},
		"finalMult":  2,
		"version":    Version,
	})
	client.sendRooms(r.Context(), hub)

	for {
		mt, data, err := c.Read(r.Context())
		if err != nil {
			return
		}
		if mt != websocket.MessageText {
			client.closeWith(websocket.StatusPolicyViolation, "binary_not_allowed")
			return
		}
		if len(data) > MaxClientWSMsgBytes {
			client.closeWith(websocket.StatusPolicyViolation, "message_too_big")
			return
		}
		var msg ClientMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if client.ip != "" {
			key := client.ip + "|" + msg.Type
			rate := 0.0
			burst := 0.0
			switch msg.Type {
			case "rooms":
				rate, burst = 4, 8
			case "join":
				rate, burst = 2, 4
			case "createRoom":
				rate, burst = 1, 2
			case "matchContinue":
				rate, burst = 1, 2
			case "chat":
				rate, burst = 3, 6
			case "input":
				rate, burst = 30, 60
			case "rttPing":
				rate, burst = 2, 4
			case "setName":
				rate, burst = 1, 2
			case "leave":
				rate, burst = 1, 3
			case "respawn":
				rate, burst = 2, 4
			case "cosmeticsBuy":
				rate, burst = 2, 4
			case "cosmeticsEquip":
				rate, burst = 3, 6
			case "titleEquip":
				rate, burst = 2, 4
			case "viewport":
				// Resize fires in bursts (orientation change, browser chrome
				// showing/hiding); the client debounces, this catches the rest.
				rate, burst = 2, 8
			default:
				// Unknown types are limited too, so junk cannot be spammed.
				// One shared bucket, otherwise random type names would each
				// get a fresh burst and grow the bucket map.
				key = client.ip + "|<unknown>"
				rate, burst = 5, 10
			}
			if rate > 0 && !wsIPLimiter.allow(key, rate, burst) {
				client.closeWith(websocket.StatusPolicyViolation, "rate_limited")
				return
			}
		}
		switch msg.Type {
		case "rooms":
			if !client.lastRoomsAt.IsZero() && time.Since(client.lastRoomsAt) < 200*time.Millisecond {
				continue
			}
			client.lastRoomsAt = time.Now()
			client.sendRooms(r.Context(), hub)
		case "setName":
			var p struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			nm := sanitizeName(p.Name)
			if nm == "" {
				continue
			}
			client.name.Store(nm)
			client.broadcastNameUpdate(r.Context())
			client.sendRooms(r.Context(), hub)
		case "join":
			if !client.lastJoinAt.IsZero() && time.Since(client.lastJoinAt) < 300*time.Millisecond {
				continue
			}
			client.lastJoinAt = time.Now()
			var p struct {
				RoomID *int   `json:"roomId"`
				Mode   string `json:"mode"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			if p.Mode == "auto" {
				client.joinAuto(r.Context(), hub)
			} else if p.RoomID != nil {
				client.joinRoomByID(r.Context(), hub, *p.RoomID)
			}
		case "createRoom":
			if !client.lastCreateAt.IsZero() && time.Since(client.lastCreateAt) < 600*time.Millisecond {
				continue
			}
			client.lastCreateAt = time.Now()
			var p struct {
				Title string `json:"title"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			title := sanitizeRoomName(p.Title)
			if title == "" {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "room_title_invalid"})
				continue
			}
			rm := hub.createRoom(title)
			if rm == nil {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "rooms_limit_reached"})
				continue
			}
			client.joinRoom(r.Context(), hub, rm)
		case "leave":
			client.leaveRoom(r.Context())
			client.sendRooms(r.Context(), hub)
		case "chat":
			var p struct {
				Text string `json:"text"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			client.handleChat(r.Context(), p.Text)
		case "respawn":
			var p struct {
				Rejoin bool `json:"rejoin"`
			}
			_ = json.Unmarshal(msg.Data, &p)
			if p.Rejoin {
				client.joinAuto(r.Context(), hub)
			}
			client.mu.Lock()
			rm := client.room
			pl := client.player
			client.mu.Unlock()
			if rm == nil || pl == nil {
				continue
			}
			rm.mu.Lock()
			if !pl.alive {
				rm.respawnPlayer(pl)
			}
			// G5: one batch instead of a fan of N JSON messages, which at 2
			// respawns per second could bury the 256-entry send queue.
			known := rm.collectKnownNamesLocked()
			rm.mu.Unlock()

			client.sendKnownNames(r.Context(), known)
		case "matchContinue":
			if !client.lastMatchContinueAt.IsZero() && time.Since(client.lastMatchContinueAt) < 600*time.Millisecond {
				continue
			}
			client.lastMatchContinueAt = time.Now()

			client.mu.Lock()
			rm := client.room
			client.mu.Unlock()
			if rm == nil {
				continue
			}

			rm.mu.Lock()
			if !rm.matchEnded {
				rm.mu.Unlock()
				continue
			}
			rm.resetMatchLocked()
			payload := map[string]any{
				"tick":       rm.tick,
				"seq":        rm.matchSeq,
				"endTick":    rm.matchEndTick,
				"phase":      rm.matchPhase(),
				"phaseUntil": rm.phaseUntilTick(),
			}
			rm.phaseSent = rm.matchPhase()
			rm.mu.Unlock()
			rm.broadcastJSON(context.Background(), "matchStart", payload)
		case "cosmeticsBuy":
			var p struct {
				Cat string `json:"cat"`
				ID  uint8  `json:"id"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			cat := strings.TrimSpace(strings.ToLower(p.Cat))
			id := p.ID
			if id > CosmeticsMaxID {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_invalid_id"})
				continue
			}
			price, okCat := cosmeticsPriceFor(cat, id)
			if !okCat {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_invalid_cat"})
				continue
			}
			client.mu.Lock()
			rm := client.room
			pl := client.player
			client.mu.Unlock()
			pid := client.profileKey()
			bit := uint8(1) << id

			// Ownership check, debit and grant happen in one critical section
			// over the profile. Lock order stays rm.mu -> profilesMu.
			//
			// G8: this is a WRITE path, so the profile must be materialised with
			// profileForKeyCreate. profileForKey hands back a transient object
			// for a player with no stored profile yet, and a purchase through it
			// is dropped on the floor while the client is told it succeeded —
			// today only prices above zero hide the bug. The pointer is also
			// taken under profilesMu: between a lookup and the debit the entry
			// could otherwise be evicted.
			if rm != nil {
				rm.mu.Lock()
			}
			profilesMu.Lock()
			pr := profileForKeyCreateLocked(pid)
			if pr == nil {
				profilesMu.Unlock()
				if rm != nil {
					rm.mu.Unlock()
				}
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_unavailable"})
				continue
			}
			ensureProfileCosmeticsLocked(pr)
			inv := profileCosInvLocked(pr, cat)
			var payload map[string]any
			errMsg := ""
			bought := false
			balBefore := pr.StyleBalance
			balAfter := pr.StyleBalance
			switch {
			case inv == nil:
				errMsg = "cosmetics_invalid_cat"
			case (*inv & bit) != 0:
				// Idempotent: already owned, report the current state.
			case pr.StyleBalance < uint32(price):
				errMsg = "cosmetics_not_enough_style"
			default:
				pr.StyleBalance -= uint32(price)
				*inv |= bit
				profileSetEquippedLocked(pr, cat, id)
				pr.LastSeen = time.Now().Unix()
				balAfter = pr.StyleBalance
				bought = true
			}
			if errMsg == "" {
				// Player is a read-only cache refreshed from the profile.
				// Only safe to touch while rm.mu is held.
				if rm != nil {
					applyProfileCosmeticsToPlayerLocked(pl, pr)
				}
				payload = cosmeticsStatePayloadFromProfile(pr)
			}
			profilesMu.Unlock()
			if rm != nil {
				if bought {
					// equip changes live in the player record, force a snapshot
					rm.forceFullSnapshot = true
				}
				rm.mu.Unlock()
			}
			if errMsg != "" {
				client.sendJSON(r.Context(), "error", map[string]any{"message": errMsg})
				continue
			}
			if bought {
				markProfilesDirty()
				log.Printf("cosmetics_txn pid=%q cat=%q id=%d price=%d balance_before=%d balance_after=%d",
					shortPID(pid), cat, id, price, balBefore, balAfter)
			}
			client.sendJSON(r.Context(), "cosmetics", payload)
			if bought && rm != nil {
				rm.broadcastCosExtra(r.Context())
			}
		case "cosmeticsEquip":
			var p struct {
				Cat string `json:"cat"`
				ID  uint8  `json:"id"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			cat := strings.TrimSpace(strings.ToLower(p.Cat))
			id := p.ID
			if id > CosmeticsMaxID {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_invalid_id"})
				continue
			}
			if !cosmeticsCatValid(cat) {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_invalid_cat"})
				continue
			}
			client.mu.Lock()
			rm := client.room
			pl := client.player
			client.mu.Unlock()
			pid := client.profileKey()
			bit := uint8(1) << id

			// S5: NOT a create path. Equipping cannot unlock anything, so it
			// must not mint a profile for every visitor who opens the
			// wardrobe. See profileForKeyEquipLocked.
			if rm != nil {
				rm.mu.Lock()
			}
			profilesMu.Lock()
			pr, stored := profileForKeyEquipLocked(pid)
			if pr == nil {
				profilesMu.Unlock()
				if rm != nil {
					rm.mu.Unlock()
				}
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_unavailable"})
				continue
			}
			ensureProfileCosmeticsLocked(pr)
			inv := profileCosInvLocked(pr, cat)
			owned := inv != nil && (*inv&bit) != 0
			var payload map[string]any
			balance := pr.StyleBalance
			changed := owned && profileEquippedLocked(pr, cat) != id
			if owned {
				profileSetEquippedLocked(pr, cat, id)
				pr.LastSeen = time.Now().Unix()
				if rm != nil {
					applyProfileCosmeticsToPlayerLocked(pl, pr)
				}
				payload = cosmeticsStatePayloadFromProfile(pr)
			}
			profilesMu.Unlock()
			if rm != nil {
				if owned {
					rm.forceFullSnapshot = true
				}
				rm.mu.Unlock()
			}
			if !owned {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_not_owned"})
				continue
			}
			// Re-equipping what is already on is a no-op: neither persist nor
			// log it, or a client at the rate limit turns the log into a
			// firehose and the autosave into a treadmill.
			if changed && stored {
				markProfilesDirty()
				log.Printf("cosmetics_txn pid=%q cat=%q id=%d price=%d balance_before=%d balance_after=%d",
					shortPID(pid), "equip:"+cat, id, 0, balance, balance)
			}
			client.sendJSON(r.Context(), "cosmetics", payload)
			if rm != nil {
				rm.broadcastCosExtra(r.Context())
			}
		case "titleEquip":
			var p struct {
				ID uint8 `json:"id"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			if p.ID > TitleMaxID {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "title_invalid_id"})
				continue
			}
			client.mu.Lock()
			rm := client.room
			pl := client.player
			client.mu.Unlock()
			pid := client.profileKey()

			// Same lock order as the cosmetics branches: rm.mu -> profilesMu.
			// S5: equip only, so no entry is created (see cosmeticsEquip).
			if rm != nil {
				rm.mu.Lock()
			}
			profilesMu.Lock()
			pr, stored := profileForKeyEquipLocked(pid)
			if pr == nil {
				profilesMu.Unlock()
				if rm != nil {
					rm.mu.Unlock()
				}
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_unavailable"})
				continue
			}
			ensureProfileCosmeticsLocked(pr)
			// id 0 clears the title and is always allowed.
			unlocked := p.ID == 0 || titleUnlockedLocked(pr, p.ID)
			changed := unlocked && pr.TitleID != p.ID
			var payload map[string]any
			if unlocked {
				pr.TitleID = p.ID
				pr.LastSeen = time.Now().Unix()
				if rm != nil {
					applyProfileCosmeticsToPlayerLocked(pl, pr)
				}
				payload = cosmeticsStatePayloadFromProfile(pr)
			}
			profilesMu.Unlock()
			if rm != nil {
				rm.mu.Unlock()
			}
			if !unlocked {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "title_not_unlocked"})
				continue
			}
			if changed && stored {
				markProfilesDirty()
				log.Printf("title_equip pid=%q id=%d", shortPID(pid), p.ID)
			}
			client.sendJSON(r.Context(), "cosmetics", payload)
			if rm != nil {
				rm.broadcastCosExtra(r.Context())
			}
		case "viewport":
			// {"type":"viewport","data":{"w":46,"h":94}} — the window the
			// client can actually draw, in CELLS. Purely advisory: the server
			// clamps it, and a client that never sends it keeps the historical
			// 80x56. Valid before joining a room, so the first ROI after join
			// is already the right size.
			var p struct {
				W int `json:"w"`
				H int `json:"h"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			w, h := clampViewport(p.W, p.H)
			client.mu.Lock()
			changed := client.viewW != w || client.viewH != h
			client.viewW = w
			client.viewH = h
			client.mu.Unlock()
			// Echo the granted size so the client can size its own fog/camera
			// to what it will actually receive instead of what it asked for.
			if changed {
				client.sendJSON(r.Context(), "viewport", map[string]any{"w": w, "h": h})
			}
		case "input":
			var p struct {
				Dir string `json:"dir"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			d, ok := parseDir(p.Dir)
			if !ok {
				continue
			}
			client.mu.Lock()
			pl := client.player
			rm := client.room
			client.mu.Unlock()
			if rm == nil || pl == nil {
				continue
			}
			rm.mu.Lock()
			pl.pendingDir = d
			rm.mu.Unlock()
		case "rttPing":
			client.sendJSON(r.Context(), "rttPong", json.RawMessage(msg.Data))
		}
	}
}
