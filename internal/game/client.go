// client.go holds the per-connection client: its send queue and write loop,
// room join/leave and the chat handler.
package game

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/coder/websocket"

	"snakes/internal/metrics"
	"snakes/internal/profiles"

	"snakes/internal/sanitize"
)

func (c *Client) profileKey() string {
	if c == nil {
		return ""
	}
	if c.pid != "" {
		return c.pid
	}
	return c.ip
}

func (c *Client) close() {
	c.closeWith(websocket.StatusNormalClosure, "")
}

func (c *Client) closeWith(code websocket.StatusCode, reason string) {
	if c.closed.Swap(true) {
		return
	}
	log.Printf("ws_close ip=%q pid=%q code=%d reason=%q", c.ip, profiles.ShortPID(c.pid), code, reason)
	metrics.WSClosedTotal.Inc(closeReasonLabel(reason))
	metrics.WSActive.Add(-1)
	c.leaveRoom(context.Background())
	close(c.sendCh)
	_ = c.conn.Close(code, reason)
}

func (c *Client) writeLoop() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("ws_writeLoop_panic ip=%q err=%v", c.ip, r)
			c.closeWith(websocket.StatusInternalError, "panic")
		}
	}()

	writeFailed := false
	for m := range c.sendCh {
		if !writeFailed {
			ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
			err := c.conn.Write(ctx, m.msgType, m.data)
			cancel()
			if err != nil {
				metrics.WSWriteErrors.Add(1)
				log.Printf("ws_write_error ip=%q err=%v", c.ip, err)
				writeFailed = true
				c.closeWith(websocket.StatusGoingAway, "write_error")
			}
		}
		if m.pd != nil {
			decPooledRef(m.pd)
		}
		if c.closed.Load() {
			// Stop writing, but keep ranging: every queued message still holds a
			// reference to a pooled buffer, and returning here abandoned up to a
			// full queue of them (they fell to the GC instead of going back to
			// pooledDataPool). closeWith closes sendCh, which ends the range.
			writeFailed = true
			continue
		}
	}
}

func (c *Client) enqueue(msgType websocket.MessageType, b []byte, pd *pooledData, drop bool) bool {
	if c.closed.Load() {
		decPooledRef(pd)
		return false
	}
	m := outbound{msgType: msgType, data: b, drop: drop, pd: pd}
	defer func() {
		if recover() != nil {
			decPooledRef(pd)
		}
	}()
	if drop {
		select {
		case c.sendCh <- m:
			return true
		default:
		}
		metrics.WSDropped.Add(1)
		decPooledRef(pd)
		return false
	}
	select {
	case c.sendCh <- m:
		return true
	default:
	}
	// Bounded wait: a single slow client must never stall a room tick.
	t := time.NewTimer(SendBackpressureTimeout)
	defer func() {
		if !t.Stop() {
			select {
			case <-t.C:
			default:
			}
		}
	}()
	select {
	case c.sendCh <- m:
		return true
	case <-t.C:
	}
	metrics.WSDropped.Add(1)
	decPooledRef(pd)
	// Drop the laggard instead of blocking everyone else. Async because the
	// caller may hold room locks that close() needs.
	go c.closeWith(websocket.StatusPolicyViolation, "send_backpressure")
	return false
}

// marshalServerMsg encodes one server message. Broadcasts encode once and hand
// the same bytes to every client, exactly as the binary pooled path does.
func marshalServerMsg(typ string, data any) ([]byte, bool) {
	b, err := json.Marshal(ServerMsg{Type: typ, Data: data})
	if err != nil {
		return nil, false
	}
	return b, true
}

// sendJSONRaw enqueues an already-encoded ServerMsg. The buffer is read-only
// from here on and may be shared between clients.
func (c *Client) sendJSONRaw(b []byte) {
	_ = c.enqueue(websocket.MessageText, b, nil, false)
}

func (c *Client) sendJSON(ctx context.Context, typ string, data any) {
	b, ok := marshalServerMsg(typ, data)
	if !ok {
		return
	}
	c.sendJSONRaw(b)
}

func (c *Client) sendBinaryPooled(pd *pooledData, drop bool) bool {
	if pd == nil {
		return false
	}
	if len(pd.B) == 0 {
		decPooledRef(pd)
		return false
	}
	return c.enqueue(websocket.MessageBinary, pd.B, pd, drop)
}

func (c *Client) sendRooms(ctx context.Context, hub *Hub) {
	rooms := hub.listRoomsSnapshot()
	c.sendJSON(ctx, "rooms", rooms)
}

func (c *Client) broadcastNameUpdate(ctx context.Context) {
	c.mu.Lock()
	rm := c.room
	pl := c.player
	name := c.name.Load().(string)
	c.mu.Unlock()
	if rm == nil || pl == nil {
		return
	}

	rm.mu.Lock()
	pl.name = name
	rm.setKnownNameLocked(pl.num, name, true)
	display := rm.displayNameLocked(pl.num)
	displayEn := rm.displayNameEnLocked(pl.num)
	rm.mu.Unlock()

	payload := map[string]any{"n": pl.num, "nm": display}
	if displayEn != "" {
		payload["nmEn"] = displayEn
	}
	rm.broadcastJSON(ctx, "nameUpdate", payload)
}

func (c *Client) leaveRoom(ctx context.Context) {
	c.leaveRoomInternal(ctx, true)
}

func (c *Client) leaveRoomInternal(ctx context.Context, notify bool) {
	c.mu.Lock()
	rm := c.room
	pl := c.player
	c.room = nil
	c.player = nil
	c.mu.Unlock()

	if rm == nil {
		return
	}

	rm.mu.Lock()
	delete(rm.clients, c)
	if pl == nil {
		rm.mu.Unlock()
		return
	}

	offlineUpdate := ""
	offlineUpdateEn := ""
	num := pl.num
	rm.setKnownNameLocked(num, pl.name, false)
	offlineUpdate = rm.displayNameLocked(num)
	offlineUpdateEn = rm.displayNameEnLocked(num)
	rm.removePlayer(num)
	// G5: removePlayer drops the player's territory and trail outright (a
	// leaver leaves nothing to reclaim), so there is nothing on the map left to
	// label and the entry must not survive the session. Keeping it was an
	// unbounded leak: 200 join/leave cycles measured 214 entries, and every one
	// of them cost each new client one nameUpdate message.
	if !rm.hasCoolingCellsLocked(num) {
		rm.dropKnownNameLocked(num)
	}
	rm.humanCount = maxInt(0, rm.humanCount-1)
	rm.forceFullSnapshot = true
	shouldCleanup := rm.humanCount == 0
	if !shouldCleanup {
		// G7: refill the bot field as the room empties out.
		rm.syncBotPopulationLocked()
	}
	rm.mu.Unlock()

	if offlineUpdate != "" {
		payload := map[string]any{"n": num, "nm": offlineUpdate}
		if offlineUpdateEn != "" {
			payload["nmEn"] = offlineUpdateEn
		}
		rm.broadcastJSON(ctx, "nameUpdate", payload)
	}
	if !shouldCleanup {
		// The refill above may have added bots; cosExtra is what carries their
		// archetype and tier, so the remaining clients need a fresh copy.
		rm.broadcastCosExtra(ctx)
	}

	if notify {
		c.sendJSON(ctx, "left", map[string]any{"room": rm.id})
	}

	if shouldCleanup {
		rm.scheduleCleanup()
	}
}

func (c *Client) joinAuto(ctx context.Context, hub *Hub) {
	rm := hub.pickRoomForJoin()
	c.joinRoom(ctx, hub, rm)
}

func (c *Client) joinRoomByID(ctx context.Context, hub *Hub, id int) {
	rm := hub.getRoom(id)
	if rm == nil {
		c.sendJSON(ctx, "error", map[string]any{"message": "room_not_found"})
		return
	}
	c.joinRoom(ctx, hub, rm)
}

func (c *Client) joinRoom(ctx context.Context, hub *Hub, rm *Room) {
	if rm == nil {
		c.sendJSON(ctx, "error", map[string]any{"message": "rooms_limit_reached"})
		return
	}
	// G-lag: жалоба «долго не начинается движение после клика Играть» не
	// воспроизвелась по чтению кода — нужны реальные тайминги с прода, а не
	// догадки. join логируется целиком, только если он реально медленный
	// (>150мс — за пределами того, что игрок спишет на обычную сетевую
	// задержку), с разбивкой по фазам, чтобы не гадать, что именно тормозит:
	// подготовка бота-состава комнаты — самый вероятный подозреваемый, она
	// синхронна и держит rm.mu на всё время join.
	joinStartedAt := time.Now()
	var botSyncDur time.Duration
	c.leaveRoomInternal(ctx, false)

	name := c.name.Load().(string)

	rm.mu.Lock()
	if rm.humanCount >= rm.limit {
		rm.mu.Unlock()
		c.sendJSON(ctx, "error", map[string]any{"message": "room_full"})
		return
	}

	pnum := rm.allocPlayerNumLocked()
	if pnum == 0 {
		rm.mu.Unlock()
		c.sendJSON(ctx, "error", map[string]any{"message": "room_full"})
		return
	}

	hue := rm.allocUniqueHue()

	pl := &Player{
		num:             pnum,
		name:            name,
		x:               -1,
		y:               -1,
		homeX:           -1,
		homeY:           -1,
		dir:             DirRight,
		pendingDir:      DirRight,
		nextX:           -1,
		nextY:           -1,
		nextI:           -1,
		alive:           false,
		trail:           nil,
		owned:           nil,
		bot:             false,
		hue:             hue,
		cosInvCaptureFx: 1,
		cosInvHead:      1,
		cosInvSeg:       1,
		cosInvNameplate: 1,
		cosInvFrame:     1,
		cosInvTerr:      1,
		cosInvDeath:     1,
		cosCaptureFx:    0,
		cosHead:         0,
		cosSeg:          0,
		cosNameplate:    0,
		cosFrame:        0,
		profileKey:      c.profileKey(),
	}
	if pr := profiles.ForKey(pl.profileKey); pr != nil {
		profiles.Mu.Lock()
		ensureProfileCosmeticsLocked(pr)
		pr.LastSeen = time.Now().Unix()
		applyProfileCosmeticsToPlayerLocked(pl, pr)
		// Only a stored profile has something to persist; a transient one is
		// discarded with this call.
		stored := profiles.StoredLocked(pl.profileKey) != nil
		profiles.Mu.Unlock()
		if stored {
			profiles.MarkDirty()
		}
	}

	rm.players[pnum] = pl
	rm.scores[pnum] = 0
	rm.points[pnum] = 0
	rm.clients[c] = struct{}{}
	rm.humanCount++
	metrics.JoinsTotal.Inc(metrics.ActorLabel(false))
	rm.forceFullSnapshot = true
	rm.cancelCleanupLocked()
	// G7: thin the bot field out so a busy room is not a mob.
	botSyncStartedAt := time.Now()
	rm.syncBotPopulationLocked()
	botSyncDur = time.Since(botSyncStartedAt)

	rm.setKnownNameLocked(pnum, name, true)
	rm.sendDailyStateToPlayer(pl)

	known := rm.collectKnownNamesLocked()
	rm.mu.Unlock()

	c.mu.Lock()
	c.room = rm
	c.player = pl
	c.mu.Unlock()

	rm.mu.Lock()
	matchSeq := rm.matchSeq
	tickNow := rm.tick
	matchEndTick := rm.matchEndTick
	matchEnded := rm.matchEnded
	matchResetAt := rm.matchResetAt
	// G24: the match arc was invisible to the player even though the server
	// has always changed the rules by phase.
	matchPhaseNow := rm.matchPhase()
	matchPhaseUntil := rm.phaseUntilTick()
	var matchResults []matchResult
	if matchEnded {
		matchResults = rm.buildMatchResultsLocked()
	}
	// pl is already published in rm.players, so the tick goroutine owns its
	// style/cosmetic fields from here on: build the payload under rm.mu.
	cosmetics := cosmeticsStatePayload(pl)
	rm.mu.Unlock()

	initPayload := map[string]any{
		"w":          W,
		"h":          H,
		"tickMs":     TickMS,
		"tick":       tickNow,
		"you":        pnum,
		"mapCells":   N,
		"room":       rm.id,
		"roomLimit":  rm.limit,
		"matchSeq":   matchSeq,
		"matchEnd":   matchEndTick,
		"matchEnded": matchEnded,
		"matchReset": matchResetAt,
		"phase":      matchPhaseNow,
		"phaseUntil": matchPhaseUntil,
	}
	initPayload["cosmetics"] = cosmetics
	if matchEnded {
		initPayload["matchResults"] = matchResults
	}
	c.sendJSON(ctx, "init", initPayload)
	// Тайминг критического пути игрока: сколько прошло от получения join до
	// того, как ему ушёл init — это то, что реально задерживает первое
	// движение на клиенте, всё после (broadcast остальным) на него уже не
	// влияет. Логируем только если заметно медленнее нормы.
	if d := time.Since(joinStartedAt); d > 150*time.Millisecond {
		log.Printf("join_slow room=%d client_num=%d total_ms=%.3f botSync_ms=%.3f", rm.id, pnum, float64(d)/float64(time.Millisecond), float64(botSyncDur)/float64(time.Millisecond))
	}

	rm.mu.Lock()
	chatHistory := make([]ChatMessage, len(rm.chat))
	copy(chatHistory, rm.chat)
	rm.minimapDirty = true
	rm.minimapCur.FullActive = true
	rm.minimapCur.FullCursor = 0
	rm.mu.Unlock()

	c.sendKnownNames(ctx, known)
	if len(chatHistory) > 0 {
		c.sendJSON(ctx, "chatInit", chatHistory)
	}

	rm.broadcastJSON(ctx, "nameUpdate", map[string]any{"n": pnum, "nm": rmDisplayName(rm, pnum)})
	// The newcomer needs the whole room, everyone else needs the newcomer:
	// one full broadcast covers both.
	rm.broadcastCosExtra(ctx)
}

func (c *Client) handleChat(ctx context.Context, text string) {
	metrics.ChatMessagesTotal.Inc()
	c.mu.Lock()
	rm := c.room
	pl := c.player
	c.mu.Unlock()
	if rm == nil || pl == nil {
		return
	}

	msgText := sanitize.Chat(text)
	if msgText == "" {
		return
	}

	rm.mu.Lock()
	if !pl.lastChatAt.IsZero() && time.Since(pl.lastChatAt) < ChatMinInterval {
		rm.mu.Unlock()
		return
	}
	pl.lastChatAt = time.Now()
	out := ChatMessage{T: time.Now().UnixMilli(), N: pl.num, Text: msgText}
	rm.chat = append(rm.chat, out)
	if len(rm.chat) > ChatHistoryMax {
		rm.chat = rm.chat[len(rm.chat)-ChatHistoryMax:]
	}
	rm.mu.Unlock()

	rm.broadcastJSON(ctx, "chat", out)
}

// sendKnownNames delivers the name table as one nameUpdateBatch message, plus
// the legacy per-entry messages while the table is short enough for that to be
// free (G5). Must be called without r.mu held.
func (c *Client) sendKnownNames(ctx context.Context, items []knownNameItem) {
	if len(items) == 0 {
		return
	}
	c.sendJSON(ctx, "nameUpdateBatch", map[string]any{"names": items})
	if len(items) > KnownNamesLegacyMax {
		return
	}
	for _, it := range items {
		payload := map[string]any{"n": it.N, "nm": it.Nm}
		if it.NmEn != "" {
			payload["nmEn"] = it.NmEn
		}
		c.sendJSON(ctx, "nameUpdate", payload)
	}
}
