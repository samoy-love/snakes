package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

func requestClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	if host == "127.0.0.1" || host == "::1" {
		xff := r.Header.Get("X-Forwarded-For")
		if xff != "" {
			parts := strings.Split(xff, ",")
			if len(parts) > 0 {
				ip := strings.TrimSpace(parts[0])
				if ip != "" {
					return ip
				}
			}
		}
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
	mu      sync.Mutex
	buckets map[string]*tokenBucket
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
	if b.tokens >= 1 {
		b.tokens -= 1
		return true
	}
	if len(l.buckets) > 5000 {
		cut := now.Add(-10 * time.Minute)
		for k, v := range l.buckets {
			if v.lastSeen.Before(cut) {
				delete(l.buckets, k)
			}
		}
	}
	return false
}

var wsIPLimiter = &ipRateLimiter{buckets: make(map[string]*tokenBucket)}

func wsOriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err == nil {
		h := strings.ToLower(strings.TrimSpace(u.Hostname()))
		if h == "localhost" || h == "127.0.0.1" || h == "::1" {
			return true
		}
	}
	_, ok := allowedWSOrigins[origin]
	return ok
}

func handleWS(hub *Hub, w http.ResponseWriter, r *http.Request) {
	if !wsOriginAllowed(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionNoContextTakeover,
	})
	if err != nil {
		return
	}
	c.SetReadLimit(MaxClientWSMsgBytes)
	client := &Client{conn: c, sendCh: make(chan outbound, 256), ip: requestClientIP(r)}
	client.name.Store("Игрок")
	metrics.wsConnections.Add(1)
	metrics.wsActive.Add(1)
	go client.writeLoop()

	defer client.close()

	client.sendJSON(r.Context(), "hello", map[string]any{"w": W, "h": H, "tickMs": TickMS, "roomLimit": hub.roomLimit})
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
			known := make([]ChatMessage, 0, len(rm.knownNames))
			for num, kn := range rm.knownNames {
				nm := kn.Name
				if nm == "" {
					nm = sanitizeName(fmt.Sprintf("Игрок %d", num))
				}
				if !kn.Online {
					nm = nm + " (отключен)"
				}
				known = append(known, ChatMessage{N: num, Text: nm})
			}
			rm.mu.Unlock()

			sort.Slice(known, func(i, j int) bool { return known[i].N < known[j].N })
			for _, it := range known {
				client.sendJSON(r.Context(), "nameUpdate", map[string]any{"n": it.N, "nm": it.Text})
			}
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
				"tick":    rm.tick,
				"seq":     rm.matchSeq,
				"endTick": rm.matchEndTick,
			}
			rm.mu.Unlock()
			rm.broadcastJSON(context.Background(), "matchStart", payload)
		case "cosmeticsBuy":
			client.mu.Lock()
			rm := client.room
			pl := client.player
			client.mu.Unlock()
			if rm == nil || pl == nil {
				continue
			}
			var p struct {
				Cat string `json:"cat"`
				ID  uint8  `json:"id"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			cat := strings.TrimSpace(strings.ToLower(p.Cat))
			id := p.ID
			if id > 4 {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_invalid_id"})
				continue
			}
			var price uint16
			switch cat {
			case "capturefx":
				price = 60
			case "head":
				price = 50
			case "seg":
				price = 40
			case "nameplate":
				price = 35
			case "frame":
				price = 30
			default:
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_invalid_cat"})
				continue
			}
			bit := uint8(1) << id
			rm.mu.Lock()
			// already owned?
			owned := false
			switch cat {
			case "capturefx":
				owned = (pl.cosInvCaptureFx & bit) != 0
			case "head":
				owned = (pl.cosInvHead & bit) != 0
			case "seg":
				owned = (pl.cosInvSeg & bit) != 0
			case "nameplate":
				owned = (pl.cosInvNameplate & bit) != 0
			case "frame":
				owned = (pl.cosInvFrame & bit) != 0
			}
			if owned {
				rm.mu.Unlock()
				client.sendJSON(r.Context(), "cosmetics", cosmeticsStatePayload(pl))
				continue
			}
			if pl.style < uint32(price) {
				rm.mu.Unlock()
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_not_enough_style"})
				continue
			}
			pl.style -= uint32(price)
			switch cat {
			case "capturefx":
				pl.cosInvCaptureFx |= bit
				pl.cosCaptureFx = id
			case "head":
				pl.cosInvHead |= bit
				pl.cosHead = id
			case "seg":
				pl.cosInvSeg |= bit
				pl.cosSeg = id
			case "nameplate":
				pl.cosInvNameplate |= bit
				pl.cosNameplate = id
			case "frame":
				pl.cosInvFrame |= bit
				pl.cosFrame = id
			}
			if !pl.bot {
				pr := profileForKey(pl.profileKey)
				if pr != nil {
					profilesMu.Lock()
					ensureProfileCosmeticsLocked(pr)
					pr.StyleBalance = pl.style
					pr.CosInvCaptureFx = pl.cosInvCaptureFx
					pr.CosInvHead = pl.cosInvHead
					pr.CosInvSeg = pl.cosInvSeg
					pr.CosInvNameplate = pl.cosInvNameplate
					pr.CosInvFrame = pl.cosInvFrame
					pr.CosEqCaptureFx = pl.cosCaptureFx
					pr.CosEqHead = pl.cosHead
					pr.CosEqSeg = pl.cosSeg
					pr.CosEqNameplate = pl.cosNameplate
					pr.CosEqFrame = pl.cosFrame
					profilesMu.Unlock()
				}
			}
			// equip changes are in player record, so force snapshot for quick propagation
			rm.forceFullSnapshot = true
			rm.mu.Unlock()
			client.sendJSON(r.Context(), "cosmetics", cosmeticsStatePayload(pl))
		case "cosmeticsEquip":
			client.mu.Lock()
			rm := client.room
			pl := client.player
			client.mu.Unlock()
			if rm == nil || pl == nil {
				continue
			}
			var p struct {
				Cat string `json:"cat"`
				ID  uint8  `json:"id"`
			}
			if json.Unmarshal(msg.Data, &p) != nil {
				continue
			}
			cat := strings.TrimSpace(strings.ToLower(p.Cat))
			id := p.ID
			if id > 4 {
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_invalid_id"})
				continue
			}
			bit := uint8(1) << id
			rm.mu.Lock()
			owned := false
			switch cat {
			case "capturefx":
				owned = (pl.cosInvCaptureFx & bit) != 0
				if owned {
					pl.cosCaptureFx = id
				}
			case "head":
				owned = (pl.cosInvHead & bit) != 0
				if owned {
					pl.cosHead = id
				}
			case "seg":
				owned = (pl.cosInvSeg & bit) != 0
				if owned {
					pl.cosSeg = id
				}
			case "nameplate":
				owned = (pl.cosInvNameplate & bit) != 0
				if owned {
					pl.cosNameplate = id
				}
			case "frame":
				owned = (pl.cosInvFrame & bit) != 0
				if owned {
					pl.cosFrame = id
				}
			default:
				rm.mu.Unlock()
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_invalid_cat"})
				continue
			}
			if !owned {
				rm.mu.Unlock()
				client.sendJSON(r.Context(), "error", map[string]any{"message": "cosmetics_not_owned"})
				continue
			}
			if !pl.bot {
				pr := profileForKey(pl.profileKey)
				if pr != nil {
					profilesMu.Lock()
					ensureProfileCosmeticsLocked(pr)
					pr.CosEqCaptureFx = pl.cosCaptureFx
					pr.CosEqHead = pl.cosHead
					pr.CosEqSeg = pl.cosSeg
					pr.CosEqNameplate = pl.cosNameplate
					pr.CosEqFrame = pl.cosFrame
					profilesMu.Unlock()
				}
			}
			rm.forceFullSnapshot = true
			rm.mu.Unlock()
			client.sendJSON(r.Context(), "cosmetics", cosmeticsStatePayload(pl))
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
