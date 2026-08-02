// room.go holds the room lifecycle: the hub and room registry, the tick loop,
// movement/collision resolution, spawns, deaths and the match cycle.
package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// F4: a match runs through three phases derived from r.tick-r.matchStartTick.
const (
	PhaseExpansion = 0 // 0:00-1:30  more pickups, bounty disabled
	PhaseConflict  = 1 // 1:30-3:30  baseline
	PhaseFinal     = 2 // 3:30-5:00  double capture points, faster bounty
)

const (
	PhaseExpansionEndTick = 900
	PhaseConflictEndTick  = 2100
)

// ProfileTouchEveryTicks is how often a live human's profile LastSeen is
// refreshed from the tick loop (G7): 600 ticks == 60s.
const ProfileTouchEveryTicks = 600

const (
	PowerupShield   = 1
	PowerupDash     = 2
	PowerupNova     = 3
	PowerupMegaDash = 4
)

const (
	MutatorNone          = 0
	MutatorDoubleCapture = 1
	MutatorPowerSurge    = 2
)

type Hub struct {
	mu         sync.RWMutex
	rooms      map[int]*Room
	nextRoomID int
	roomLimit  int
}

// DefaultMaxRooms caps how many rooms may exist at once. A room costs ~500 KB
// of grid arrays plus up to BotCount bots and its own 10 Hz goroutine, and it
// survives for 30s after the last human leaves, so an unbounded count is a
// memory DoS: one connection creating rooms at the rate limit would hold
// dozens of them alive. Override with MAX_ROOMS.
const DefaultMaxRooms = 64

var maxRoomsLimit = loadMaxRooms()

func loadMaxRooms() int {
	if v := strings.TrimSpace(os.Getenv("MAX_ROOMS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return DefaultMaxRooms
}

func rmDisplayName(rm *Room, num uint16) string {
	if rm == nil {
		return ""
	}
	rm.mu.Lock()
	nm := rm.displayNameLocked(num)
	rm.mu.Unlock()
	return nm
}

func (h *Hub) getRoom(id int) *Room {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.rooms[id]
}

func (h *Hub) pickRoomForJoin() *Room {
	h.mu.RLock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.RUnlock()

	// Fill rooms in creation order (by id): room 1, then room 2, etc.
	var best *Room
	bestID := math.MaxInt
	for _, r := range rooms {
		r.mu.Lock()
		full := r.humanCount >= r.limit
		id := r.id
		r.mu.Unlock()
		if full {
			continue
		}
		if id < bestID {
			bestID = id
			best = r
		}
	}
	if best != nil {
		return best
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	// Re-check under lock to avoid creating unnecessary rooms under contention.
	for _, r := range h.rooms {
		r.mu.Lock()
		full := r.humanCount >= r.limit
		id := r.id
		r.mu.Unlock()
		if full {
			continue
		}
		if id < bestID {
			bestID = id
			best = r
		}
	}
	if best != nil {
		return best
	}

	// At the room cap every room is full. Hand back the emptiest one anyway so
	// auto-join never returns nil: joinRoom then answers a plain "room_full".
	if len(h.rooms) >= maxRoomsLimit {
		bestHumans := math.MaxInt
		bestID = math.MaxInt
		for _, r := range h.rooms {
			r.mu.Lock()
			humans := r.humanCount
			id := r.id
			r.mu.Unlock()
			if humans < bestHumans || (humans == bestHumans && id < bestID) {
				bestHumans = humans
				bestID = id
				best = r
			}
		}
		return best
	}

	r := newRoom(h, h.nextRoomID, h.roomLimit)
	h.nextRoomID++
	h.rooms[r.id] = r
	r.start()
	return r
}

// createRoom makes a room on client request. It returns nil once maxRoomsLimit
// is reached; the caller reports "rooms_limit_reached".
func (h *Hub) createRoom(title string) *Room {
	name := sanitizeRoomName(title)
	if name == "" {
		name = "Комната"
	}

	h.mu.Lock()
	if len(h.rooms) >= maxRoomsLimit {
		h.mu.Unlock()
		return nil
	}
	r := newRoom(h, h.nextRoomID, h.roomLimit)
	h.nextRoomID++
	h.rooms[r.id] = r
	h.mu.Unlock()

	r.mu.Lock()
	r.title = name
	r.mu.Unlock()

	r.start()
	return r
}

func (h *Hub) listRoomsSnapshot() []map[string]any {
	h.mu.RLock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.RUnlock()

	out := make([]map[string]any, 0, len(rooms))
	for _, r := range rooms {
		r.mu.Lock()
		clients := make([]*Client, 0, len(r.clients))
		for cl := range r.clients {
			clients = append(clients, cl)
		}
		id := r.id
		title := r.title
		humans := r.humanCount
		limit := r.limit
		r.mu.Unlock()

		namesAll := make([]string, 0, len(clients))
		for _, cl := range clients {
			nm, _ := cl.name.Load().(string)
			if nm != "" {
				namesAll = append(namesAll, nm)
			}
		}
		nameCount := len(namesAll)

		sort.Strings(namesAll)
		names := namesAll
		namesTruncated := false
		if len(names) > 5 {
			names = names[:5]
			namesTruncated = true
		}
		out = append(out, map[string]any{"id": id, "title": title, "humans": humans, "limit": limit, "names": names, "nameCount": nameCount, "namesTruncated": namesTruncated})
	}

	return out
}

func newRoom(hub *Hub, id int, limit int) *Room {
	r := &Room{
		hub:              hub,
		id:               id,
		title:            "",
		limit:            limit,
		gridOwner:        make([]uint16, N),
		trailOwner:       make([]uint16, N),
		gridPos:          make([]int32, N),
		gridStamp:        make([]uint32, N),
		trailStamp:       make([]uint32, N),
		coolOwner:        make([]uint16, N),
		coolUntil:        make([]uint32, N),
		changedGrid:      make([]uint32, 0, 4096),
		changedTrail:     make([]uint32, 0, 4096),
		minimapGrid:      make([]uint32, 0, 4096),
		players:          make(map[uint16]*Player),
		clients:          make(map[*Client]struct{}),
		scores:           make(map[uint16]uint16),
		points:           make(map[uint16]uint16),
		matchSeq:         1,
		matchStartTick:   0,
		matchEndTick:     MatchDurationTicks,
		matchEnded:       false,
		matchResetAt:     0,
		matchKills:       make(map[uint16]uint16),
		matchDeaths:      make(map[uint16]uint16),
		matchStyleEarned: make(map[uint16]uint32),
		matchStyleBy:     make(map[uint16][StyleReasonCount]uint16),
		matchPointsBy:    make(map[uint16][8]uint16),
		matchContractsBy: make(map[uint16][4]uint16),
		matchEndSentSeq:  0,
		phaseSent:        0xff,
		metaDirty:        true,
		powerUps:         make([]PowerUp, 0, 8),
		nextPowerUpID:    1,
		ticker:           time.NewTicker(time.Duration(TickMS) * time.Millisecond),
		stopCh:           make(chan struct{}),
		cleanupTimer:     nil,
		rng:              rand.New(rand.NewSource(time.Now().UnixNano() + int64(id)*9973)),
		bfsMark:          make([]uint32, N),
		bfsDist:          make([]uint16, N),
		bfsGen:           1,
		bfsQ:             make([]int, 0, 4096),
	}
	r.spawnBots()
	return r
}

func (r *Room) buildMatchResultsLocked() []matchResult {
	res := make([]matchResult, 0, len(r.players))
	for num, p := range r.players {
		if p == nil {
			continue
		}
		name := ""
		nameEn := ""
		if p.bot {
			name = p.name
			nameEn = p.nameEn
		} else {
			name = r.displayNameLocked(num)
		}
		se := uint16(0)
		if v := r.matchStyleEarned[num]; v > 0 {
			if v > uint32(^uint16(0)) {
				se = ^uint16(0)
			} else {
				se = uint16(v)
			}
		}
		avg := uint16(0)
		if elapsed := r.matchElapsed(); elapsed > 0 {
			v := p.cellTicks / elapsed
			if v > uint32(^uint16(0)) {
				v = uint32(^uint16(0))
			}
			avg = uint16(v)
		}
		res = append(res, matchResult{
			N:     num,
			Nm:    name,
			NmEn:  nameEn,
			Bot:   p.bot,
			P:     r.points[num],
			Cells: r.scores[num],
			Pk:    p.peakCells,
			Avg:   avg,
			K:     r.matchKills[num],
			D:     r.matchDeaths[num],
			Fr:    p.cosFrame,
			Ct:    p.contractType,
			Cp:    p.contractProgress,
			Cg:    p.contractGoal,
			Cu:    p.contractUntil,
			Cd:    r.matchContractsBy[num],
			Se:    se,
			Sb:    r.matchStyleBy[num],
			Pb:    r.matchPointsBy[num],
		})
	}
	sort.Slice(res, func(i, j int) bool {
		a := res[i]
		b := res[j]
		if a.P != b.P {
			return a.P > b.P
		}
		if a.Cells != b.Cells {
			return a.Cells > b.Cells
		}
		if a.K != b.K {
			return a.K > b.K
		}
		return a.N < b.N
	})
	for i := range res {
		res[i].Place = uint16(i + 1)
	}
	return res
}

func (r *Room) resetMatchLocked() {
	for i := 0; i < N; i++ {
		r.gridOwner[i] = 0
		r.trailOwner[i] = 0
		r.gridPos[i] = 0
		r.gridStamp[i] = 0
		r.trailStamp[i] = 0
		if r.coolOwner != nil {
			r.coolOwner[i] = 0
			r.coolUntil[i] = 0
		}
	}
	r.coolBatches = nil
	r.coolCursor = 0
	if r.changedGrid != nil {
		r.changedGrid = r.changedGrid[:0]
	}
	if r.changedTrail != nil {
		r.changedTrail = r.changedTrail[:0]
	}
	if r.minimapGrid != nil {
		r.minimapGrid = r.minimapGrid[:0]
	}
	r.minimapDirty = true
	r.minimapFullActive = false
	r.minimapFullCursor = 0

	r.events = r.events[:0]
	r.metaDirty = true
	r.metaSentTick = 0

	r.bountyTarget = 0
	r.bountyUntil = 0
	r.bountyCooldownUntil = 0
	r.mutatorType = MutatorNone
	r.mutatorUntil = 0
	r.powerUps = r.powerUps[:0]
	r.nextPowerUpID = 1

	r.matchSeq++
	r.matchStartTick = r.tick
	r.matchEndTick = r.tick + MatchDurationTicks
	r.matchEnded = false
	r.matchResetAt = 0
	r.matchEndSentSeq = 0
	r.phaseSent = 0xff
	for k := range r.matchKills {
		delete(r.matchKills, k)
	}
	for k := range r.matchDeaths {
		delete(r.matchDeaths, k)
	}
	for k := range r.matchStyleEarned {
		delete(r.matchStyleEarned, k)
	}
	for k := range r.matchStyleBy {
		delete(r.matchStyleBy, k)
	}
	for k := range r.matchPointsBy {
		delete(r.matchPointsBy, k)
	}
	for k := range r.matchContractsBy {
		delete(r.matchContractsBy, k)
	}

	for num, p := range r.players {
		if p == nil {
			continue
		}
		r.scores[num] = 0
		r.points[num] = 0
		p.alive = false
		p.respawnAt = 0
		p.trail = p.trail[:0]
		if p.owned != nil {
			p.owned = p.owned[:0]
		}
		// Per-match state. respawnPlayer deliberately keeps the contract (F1),
		// so a new match has to clear it here.
		p.contractType = ContractNone
		p.contractGoal = 0
		p.contractProgress = 0
		p.contractUntil = 0
		p.contractsDone = 0
		p.peakCells = 0
		p.cellTicks = 0
		p.styleCaptureMatch = 0
		p.styleCaptureAcc = 0
		p.styleKillMatch = 0
		p.botKillsMatch = 0
		p.holdAcc = 0
		p.holdPointsMatch = 0
		p.reclaimsMatch = 0
		p.revengeStyleAcc = 0
		p.revengeLastTgt = 0
		p.revengeLastTick = 0
		p.bountyStyleMatch = 0
		// G8: the respawn penalty is per match, not cumulative forever.
		p.aiDeathI = 0
		p.aiDeathN = 0
		r.respawnPlayer(p)
		r.ensureContract(p)
	}
	if r.huntersOn != nil {
		for k := range r.huntersOn {
			delete(r.huntersOn, k)
		}
	}

	r.forceFullSnapshot = true
}

func reasonCode(reason string) uint8 {
	switch reason {
	case "trail_cut":
		return 1
	case "head_on":
		return 2
	case "self_trail":
		return 3
	case "wall":
		return 4
	default:
		return 0
	}
}

func (r *Room) pushEvent(e Event) {
	r.events = append(r.events, e)
}

// matchElapsed is the number of ticks since the current match started, capped
// at the match length so the intermission does not dilute per-tick averages.
func (r *Room) matchElapsed() uint32 {
	if r.tick < r.matchStartTick {
		return 0
	}
	el := r.tick - r.matchStartTick
	if r.matchEndTick > r.matchStartTick {
		if full := r.matchEndTick - r.matchStartTick; el > full {
			el = full
		}
	}
	return el
}

// matchPhase derives the match arc phase from the elapsed match time (F4).
func (r *Room) matchPhase() uint8 {
	el := r.matchElapsed()
	switch {
	case el < PhaseExpansionEndTick:
		return PhaseExpansion
	case el < PhaseConflictEndTick:
		return PhaseConflict
	default:
		return PhaseFinal
	}
}

// phaseUntilTick is the absolute tick at which the current phase ends. For the
// final phase that is the end of the match itself (G24).
func (r *Room) phaseUntilTick() uint32 {
	switch r.matchPhase() {
	case PhaseExpansion:
		return r.matchStartTick + PhaseExpansionEndTick
	case PhaseConflict:
		return r.matchStartTick + PhaseConflictEndTick
	default:
		return r.matchEndTick
	}
}

// matchPhasePayload is the shared JSON shape for the phase indicator (G24).
// It is embedded in "init" / "matchStart" and broadcast on its own as
// "matchPhase" whenever the phase changes.
func (r *Room) matchPhasePayload() map[string]any {
	return map[string]any{
		"phase": r.matchPhase(),
		"until": r.phaseUntilTick(),
		"tick":  r.tick,
		"seq":   r.matchSeq,
	}
}

// hasSpawnGrace reports whether the player is still inside the post-respawn
// immunity window (F2).
func (r *Room) hasSpawnGrace(p *Player) bool {
	return p != nil && p.spawnGraceUntil != 0 && r.tick < p.spawnGraceUntil
}

// clearSpawnGrace drops the immunity, used when the player leaves home.
func (r *Room) clearSpawnGrace(p *Player) {
	if p != nil {
		p.spawnGraceUntil = 0
	}
}

// playerShieldBits packs the defensive state into the single "shield" byte of
// the ROI player record: bit0 = shield pickup, bit1 = spawn grace. The record
// size must stay at 21 bytes, so the flags share one byte.
func (r *Room) playerShieldBits(p *Player) uint8 {
	v := uint8(0)
	if p == nil {
		return 0
	}
	if p.shield > 0 {
		v |= 1
	}
	if r.hasSpawnGrace(p) {
		v |= 2
	}
	return v
}

func (r *Room) removePowerUpAtIndex(idx int) {
	if idx < 0 || idx >= len(r.powerUps) {
		return
	}
	last := len(r.powerUps) - 1
	r.powerUps[idx] = r.powerUps[last]
	r.powerUps = r.powerUps[:last]
}

func (r *Room) powerUpIndexAtCell(i int) int {
	x := uint16(i % W)
	y := uint16(i / W)
	for k, pu := range r.powerUps {
		if pu.X == x && pu.Y == y {
			return k
		}
	}
	return -1
}

func (r *Room) pickPowerUpSpawnCell() (int, int, bool) {
	for tries := 0; tries < 600; tries++ {
		x := r.randInt(2, W-3)
		y := r.randInt(2, H-3)
		i := r.idx(x, y)
		if r.gridOwner[i] != 0 {
			continue
		}
		if r.trailOwner[i] != 0 {
			continue
		}
		if r.powerUpIndexAtCell(i) >= 0 {
			continue
		}
		return x, y, true
	}
	return 0, 0, false
}

func (r *Room) maybeUpdateMutator() {
	if r.mutatorType != MutatorNone && r.mutatorUntil != 0 && r.tick >= r.mutatorUntil {
		r.pushEvent(Event{Kind: EventMutatorEnd, D: r.mutatorType})
		r.mutatorType = MutatorNone
		r.mutatorUntil = 0
		r.metaDirty = true
	}
	// F8: the schedule is relative to the match, not the room. A room cycle is
	// MatchDuration+Intermission ticks, so a room-relative phase drifted every
	// match and windows that landed in the intermission were lost entirely.
	if r.mutatorType == MutatorNone {
		el := r.matchElapsed()
		if el == 600 || el == 1500 || el == 2400 {
			pick := uint8(1 + r.rng.Intn(2))
			r.mutatorType = pick
			r.mutatorUntil = r.tick + 240
			r.pushEvent(Event{Kind: EventMutatorStart, D: r.mutatorType, C: r.mutatorUntil})
			r.metaDirty = true
		}
	}
}

// clearBountyLocked drops the current bounty and starts the re-arm cooldown.
func (r *Room) clearBounty() {
	r.bountyTarget = 0
	r.bountyUntil = 0
	cd := uint32(BountyCooldown)
	if r.matchPhase() == PhaseFinal {
		cd = BountyCooldownLate
	}
	r.bountyCooldownUntil = r.tick + cd
	r.metaDirty = true
}

func (r *Room) maybeUpdateBounty() {
	// E11: surviving the whole window is now worth something. Without it the
	// only lone human in a room was permanently marked and could never profit.
	if r.bountyUntil != 0 && r.tick >= r.bountyUntil {
		// No EventBountyClaim here: nobody claimed it. The client sees the
		// window close via the header (bountyTarget = 0) and the Style event.
		if t := r.players[r.bountyTarget]; t != nil && t.alive {
			// G11: shares the per-match bounty budget with the kill reward.
			r.addStyleCapped(t, StyleBountySurvive, StyleBounty, &t.bountyStyleMatch, StyleBountyMatchCap)
			r.awardPoints(t.num, PointsBountySurvive, PointsBounty)
		}
		r.clearBounty()
	}
	if r.bountyTarget != 0 {
		t := r.players[r.bountyTarget]
		if t == nil || !t.alive {
			r.clearBounty()
		}
	}
	// F4: the expansion phase is bounty free, the final phase re-arms faster
	// (shorter cooldown, see clearBounty).
	if r.matchPhase() == PhaseExpansion {
		return
	}
	if r.bountyCooldownUntil != 0 && r.tick < r.bountyCooldownUntil {
		return
	}
	if r.bountyTarget == 0 {
		// E11: bots are ordinary candidates now, not a fallback.
		cands := make([]uint16, 0, len(r.players))
		for _, p := range r.players {
			if p == nil || !p.alive {
				continue
			}
			cands = append(cands, p.num)
		}
		if len(cands) > 0 {
			r.bountyTarget = cands[r.rng.Intn(len(cands))]
			r.bountyUntil = r.tick + BountyWindowTicks
			r.pushEvent(Event{Kind: EventBountyAssign, A: r.bountyTarget, C: r.bountyUntil})
			r.metaDirty = true
		}
	}
}

func (r *Room) maybeUpdatePowerUps() {
	if len(r.powerUps) > 0 {
		for i := len(r.powerUps) - 1; i >= 0; i-- {
			if r.powerUps[i].Expires != 0 && r.tick >= r.powerUps[i].Expires {
				r.removePowerUpAtIndex(i)
				r.metaDirty = true
			}
		}
	}

	maxOnMap := 6
	if len(r.powerUps) >= maxOnMap {
		return
	}

	spawnEvery := uint32(20)
	if r.tick%spawnEvery != 0 {
		return
	}

	chance := float32(0.35)
	if r.mutatorType == MutatorPowerSurge {
		chance = 0.75
	}
	// F4: the expansion phase seeds the map faster.
	if r.matchPhase() == PhaseExpansion {
		chance *= 1.5
		if chance > 1.0 {
			chance = 1.0
		}
	}
	if r.rng.Float32() > chance {
		return
	}

	x, y, ok := r.pickPowerUpSpawnCell()
	if !ok {
		return
	}

	id := r.nextPowerUpID
	if id == 0 {
		id = 1
	}
	r.nextPowerUpID = id + 1

	pt := uint8(PowerupShield)
	rn := r.rng.Intn(1000)
	if rn < 550 {
		pt = PowerupShield
	} else if rn < 900 {
		pt = PowerupDash
	} else if rn < 985 {
		pt = PowerupNova
	} else {
		pt = PowerupMegaDash
	}

	exp := uint32(900)
	if pt == PowerupNova {
		exp = 700
	} else if pt == PowerupMegaDash {
		exp = 650
	}
	pu := PowerUp{ID: id, Type: pt, X: uint16(x), Y: uint16(y), Expires: r.tick + exp}
	r.powerUps = append(r.powerUps, pu)
	r.pushEvent(Event{Kind: EventPowerupSpawn, A: pu.ID, X: pu.X, Y: pu.Y, C: pu.Expires, D: pu.Type})
	r.metaDirty = true
}

// knownNameItem is one entry of the nameUpdateBatch payload (G5).
type knownNameItem struct {
	N    uint16 `json:"n"`
	Nm   string `json:"nm"`
	NmEn string `json:"nmEn,omitempty"`
}

// KnownNamesLegacyMax bounds how many single "nameUpdate" messages are still
// sent alongside the batch for clients that do not understand it yet. The
// bound is what makes the fan-out safe: sendCh holds 256 entries and a full
// channel blocks the sender for up to 100ms per message, so an unbounded fan
// turned joining into a tens-of-seconds stall ending in send_backpressure.
// Once the client confirms nameUpdateBatch support this can go to 0.
const KnownNamesLegacyMax = 32

// collectKnownNamesLocked renders every known name of the room, sorted by
// player number. Caller holds r.mu.
func (r *Room) collectKnownNamesLocked() []knownNameItem {
	out := make([]knownNameItem, 0, len(r.knownNames))
	for num := range r.knownNames {
		nm := r.displayNameLocked(num)
		if nm == "" {
			continue
		}
		out = append(out, knownNameItem{N: num, Nm: nm, NmEn: r.displayNameEnLocked(num)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].N < out[j].N })
	return out
}

// KnownNamesOfflineMax bounds how many offline entries a room remembers (G5).
// The map used to grow for the whole life of the room — a measured 200
// join/leave cycles left 214 entries — and every entry cost the joining client
// one JSON message plus a pass in usedBotNamesLocked on every join and leave.
const KnownNamesOfflineMax = 32

func (r *Room) setKnownNameLocked(num uint16, name string, online bool) {
	r.setKnownNameLocalizedLocked(num, name, "", online)
}

// dropKnownNameLocked forgets a player number entirely. Used when a client
// leaves and nothing of his is left on the map to label.
func (r *Room) dropKnownNameLocked(num uint16) {
	delete(r.knownNames, num)
}

// pruneKnownNamesLocked enforces KnownNamesOfflineMax by dropping the oldest
// offline entries. It is a safety net for any path that marks an entry offline
// without removing it; the normal leave path removes the entry outright.
func (r *Room) pruneKnownNamesLocked() {
	offline := 0
	for _, kn := range r.knownNames {
		if !kn.Online {
			offline++
		}
	}
	for offline > KnownNamesOfflineMax {
		oldestNum := uint16(0)
		oldestSeq := ^uint64(0)
		for num, kn := range r.knownNames {
			if kn.Online {
				continue
			}
			if kn.OfflineSeq < oldestSeq {
				oldestSeq = kn.OfflineSeq
				oldestNum = num
			}
		}
		if oldestNum == 0 {
			return
		}
		delete(r.knownNames, oldestNum)
		offline--
	}
}

// setKnownNameLocalizedLocked stores a name plus its optional English twin
// (G25). nameEn is only ever non-empty for bots.
func (r *Room) setKnownNameLocalizedLocked(num uint16, name, nameEn string, online bool) {
	if r.knownNames == nil {
		r.knownNames = make(map[uint16]KnownName)
	}
	base := sanitizeName(name)
	if base == "" {
		base = sanitizeName(fmt.Sprintf("Игрок %d", num))
	}
	seq := uint64(0)
	if !online {
		r.knownNameSeq++
		seq = r.knownNameSeq
	}
	r.knownNames[num] = KnownName{Name: base, NameEn: sanitizeName(nameEn), Online: online, OfflineSeq: seq}
	if !online {
		r.pruneKnownNamesLocked()
	}
}

// displayNameEnLocked returns the English twin of a name, or "" when there is
// none and the client should just use "nm".
func (r *Room) displayNameEnLocked(num uint16) string {
	kn, ok := r.knownNames[num]
	if !ok || kn.NameEn == "" {
		return ""
	}
	if kn.Online {
		return kn.NameEn
	}
	return kn.NameEn + " (offline)"
}

func (r *Room) displayNameLocked(num uint16) string {
	kn, ok := r.knownNames[num]
	if !ok {
		return sanitizeName(fmt.Sprintf("Игрок %d", num))
	}
	name := kn.Name
	if name == "" {
		name = sanitizeName(fmt.Sprintf("Игрок %d", num))
	}
	if kn.Online {
		return name
	}
	return name + " (отключен)"
}

func (r *Room) start() {
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("room_tick_panic room=%d err=%v", r.id, rec)
			}
		}()
		defer r.ticker.Stop()
		for {
			select {
			case <-r.ticker.C:
				func() {
					defer func() {
						if rec := recover(); rec != nil {
							log.Printf("room_step_panic room=%d err=%v", r.id, rec)
						}
					}()
					r.step()
				}()
			case <-r.stopCh:
				return
			}
		}
	}()
}

func (r *Room) close() {
	select {
	case <-r.stopCh:
		return
	default:
		close(r.stopCh)
	}
	r.cancelCleanup()
}

func (r *Room) cancelCleanup() {
	r.mu.Lock()
	r.cancelCleanupLocked()
	r.mu.Unlock()
}

func (r *Room) cancelCleanupLocked() {
	r.cleanupToken++
	if r.cleanupTimer == nil {
		return
	}
	r.cleanupTimer.Stop()
	r.cleanupTimer = nil
}

func (r *Room) scheduleCleanup() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cleanupTimer != nil {
		return
	}
	r.cleanupToken++
	token := r.cleanupToken
	r.cleanupTimer = time.AfterFunc(30*time.Second, func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("room_cleanup_panic room=%d err=%v", r.id, rec)
			}
		}()
		if r.hub == nil {
			r.mu.Lock()
			if r.cleanupToken != token {
				r.mu.Unlock()
				return
			}
			r.mu.Unlock()
			return
		}
		r.hub.mu.Lock()
		r.mu.Lock()
		if r.cleanupToken != token {
			r.mu.Unlock()
			r.hub.mu.Unlock()
			return
		}
		r.cleanupTimer = nil
		if r.humanCount == 0 {
			delete(r.hub.rooms, r.id)
			r.mu.Unlock()
			r.hub.mu.Unlock()
			r.close()
			return
		}
		r.mu.Unlock()
		r.hub.mu.Unlock()
	})
}

func (r *Room) broadcastJSON(ctx context.Context, typ string, data any) {
	r.mu.Lock()
	clients := make([]*Client, 0, len(r.clients))
	for c := range r.clients {
		clients = append(clients, c)
	}
	r.mu.Unlock()

	for _, c := range clients {
		c.sendJSON(ctx, typ, data)
	}
}

func (r *Room) removePlayer(num uint16) {
	p := r.players[num]
	if p == nil {
		return
	}
	// A player who is gone leaves nothing to reclaim.
	r.clearPlayerCellsCooling(num, p, false)
	delete(r.players, num)
	delete(r.scores, num)
	delete(r.points, num)
	for c := range r.clients {
		c.mu.Lock()
		if c.player != nil && c.player.num == num {
			delete(r.clients, c)
		}
		c.mu.Unlock()
	}
}

// pickSpawnCell picks a respawn cell for player `forNum`. G22: the scoring
// used to treat cooling cells as free space and only maximised the distance to
// enemy heads, so a dead player was systematically dropped back into the middle
// of his own cooling estate and reclaimed it for free. Own cooling cells now
// carry a penalty of their own.
func (r *Room) pickSpawnCell(forNum uint16) (int, int) {
	clearOK := func(x, y int) bool {
		if x < 2 || x > W-3 || y < 2 || y > H-3 {
			return false
		}
		for dy := -2; dy <= 2; dy++ {
			row := (y + dy) * W
			for dx := -2; dx <= 2; dx++ {
				i := row + (x + dx)
				if r.gridOwner[i] != 0 || r.trailOwner[i] != 0 {
					return false
				}
			}
		}
		return true
	}

	scoreCell := func(x, y int) int32 {
		// Maximize distance to nearest alive head.
		minD := 9999
		for _, p := range r.players {
			if p == nil || !p.alive {
				continue
			}
			d := manhattan(x, y, p.x, p.y)
			if d < minD {
				minD = d
				if minD <= 4 {
					break
				}
			}
		}
		if minD == 9999 {
			minD = 80
		}

		// Prefer "free" space: low density of painted/trails nearby.
		occ := 0
		ownCool := 0
		rad := 10
		x0 := x - rad
		y0 := y - rad
		x1 := x + rad
		y1 := y + rad
		if x0 < 0 {
			x0 = 0
		}
		if y0 < 0 {
			y0 = 0
		}
		if x1 >= W {
			x1 = W - 1
		}
		if y1 >= H {
			y1 = H - 1
		}
		for yy := y0; yy <= y1; yy++ {
			row := yy * W
			for xx := x0; xx <= x1; xx++ {
				if (xx-x)*(xx-x)+(yy-y)*(yy-y) > rad*rad {
					continue
				}
				i := row + xx
				if r.gridOwner[i] != 0 || r.trailOwner[i] != 0 {
					occ++
					continue
				}
				if forNum != 0 && r.coolOwner != nil && r.coolOwner[i] == forNum && r.coolUntil[i] > r.tick {
					ownCool++
				}
			}
		}

		// Border penalty.
		bd := x
		if y < bd {
			bd = y
		}
		rd := (W - 1) - x
		if rd < bd {
			bd = rd
		}
		dn := (H - 1) - y
		if dn < bd {
			bd = dn
		}
		borderPenalty := int32(0)
		if bd <= 1 {
			borderPenalty = 90
		} else if bd == 2 {
			borderPenalty = 30
		}

		// G3: this used to be `- ownCool*8`, a penalty steep enough that the
		// respawn deliberately ran away from the player's own cooling estate.
		// Combined with a 12s window that made reclaim unreachable in practice
		// (0 events in 3 measured matches, mean distance 94 cells) while the
		// client kept advertising the mechanic. It is now a bounded bonus, so a
		// player lands within reach of his patch and the run home is a real
		// decision. Spawn camping is handled by ReclaimReturnPercent instead:
		// a reclaim gives back a bit over half the patch, never all of it.
		coolBonus := ownCool
		if coolBonus > spawnCoolBonusCap {
			coolBonus = spawnCoolBonusCap
		}
		return int32(minD*14) - int32(occ*3) - borderPenalty + int32(coolBonus*3)
	}

	bestX := -1
	bestY := -1
	bestScore := int32(-1 << 30)

	margin := 10
	minX := maxInt(2, margin)
	maxX := minInt(W-3, (W-1)-margin)
	minY := maxInt(2, margin)
	maxY := minInt(H-3, (H-1)-margin)
	useMargin := minX <= maxX && minY <= maxY

	samples := 520
	if len(r.players) > 10 {
		samples = 760
	}
	for tries := 0; tries < samples; tries++ {
		x0 := 2
		x1 := W - 3
		y0 := 2
		y1 := H - 3
		if useMargin {
			x0 = minX
			x1 = maxX
			y0 = minY
			y1 = maxY
		}
		x := r.randInt(x0, x1)
		y := r.randInt(y0, y1)
		if !clearOK(x, y) {
			continue
		}
		s := scoreCell(x, y)
		if s > bestScore {
			bestScore = s
			bestX = x
			bestY = y
		}
	}
	if bestX >= 0 {
		return bestX, bestY
	}

	// Fallback: old behavior when the map is heavily occupied.
	for tries := 0; tries < 5000; tries++ {
		x := r.randInt(2, W-3)
		y := r.randInt(2, H-3)
		if clearOK(x, y) {
			return x, y
		}
	}
	return r.randInt(1, W-2), r.randInt(1, H-2)
}

func (r *Room) claimSpawnTerritory(playerNum uint16, x, y int) {
	for dy := -1; dy <= 1; dy++ {
		for dx := -1; dx <= 1; dx++ {
			xx := x + dx
			yy := y + dy
			if !inBounds(xx, yy) {
				continue
			}
			i := r.idx(xx, yy)
			r.setGrid(i, playerNum)
			r.setTrail(i, 0)
		}
	}
}

func (r *Room) killPlayerWithReason(num uint16, killer uint16, reason string, hitI int, hitX int, hitY int) {
	p := r.players[num]
	if p == nil || !p.alive {
		return
	}
	// F2: last line of defence for the post-respawn grace. Only kills inflicted
	// by another player are absorbed; walls and the player's own trail stay
	// lethal, otherwise a graced snake could get stuck driving into a wall.
	if r.hasSpawnGrace(p) && (killer != 0 || reason == "trail_cut" || reason == "head_on") {
		return
	}
	if r.matchDeaths != nil {
		r.matchDeaths[num] = r.matchDeaths[num] + 1
	}
	if killer != 0 && killer != num {
		if r.matchKills != nil {
			r.matchKills[killer] = r.matchKills[killer] + 1
		}
	}

	// The bot_death line is ~700 bytes of AI state: useful when tuning the AI,
	// pure disk burn in production. BOT_DEATH_SNAP gates the whole block, not
	// just the local snapshot field.
	if p.bot && debugBotDeathSnap {
		area, bw, bh, dens, per := r.measureTerritoryShape(num, p)
		headX := p.x
		headY := p.y
		nextX := p.nextX
		nextY := p.nextY
		prevX := headX
		prevY := headY
		if headX == nextX && headY == nextY {
			dx, dy := dirToDelta(p.dir)
			prevX = headX - dx
			prevY = headY - dy
		}

		hx := hitX
		hy := hitY
		if hitI >= 0 {
			hx = hitI % W
			hy = hitI / W
		}
		hitTrailOwner := uint16(0)
		hitGridOwner := uint16(0)
		if inBounds(hx, hy) {
			ii := r.idx(hx, hy)
			hitTrailOwner = r.trailOwner[ii]
			hitGridOwner = r.gridOwner[ii]
		}

		lastSeenDist := -1
		if p.aiLastSeenTick != 0 {
			lastSeenDist = manhattan(headX, headY, p.aiLastSeenX, p.aiLastSeenY)
		}
		snapCX := headX
		snapCY := headY
		if reason == "self_trail" {
			snapCX = prevX
			snapCY = prevY
		}
		snap := r.botLocalSnapshot(num, snapCX, snapCY, hx, hy, 5)
		speedActive := p.speedUntil != 0 && r.tick < p.speedUntil
		avoidAge := -1
		if p.aiAvoidTick != 0 {
			avoidAge = int(r.tick - p.aiAvoidTick)
		}

		killerName := ""
		if k := r.players[killer]; k != nil {
			killerName = k.name
		}
		pn := sanitizeLogField(p.name)
		kn := sanitizeLogField(killerName)
		rs := sanitizeLogField(reason)
		log.Printf(
			"bot_death room=%d tick=%d victim=%d name=%q killer=%d killerName=%q reason=%q cells=%d bbox=%dx%d dens=%.3f per=%d trail=%d head=%dx%d prev=%dx%d next=%dx%d hit=%dx%d hitI=%d hitTrailOwner=%d hitGridOwner=%d dir=%d pending=%d speedUntil=%d speedActive=%t aiAvoidTick=%d aiAvoidAge=%d aiAvoidFrom=%d aiAvoidTo=%d aiAvoidReason=%d aiMode=%d aiPhase=%d aiIntent=%d aiPrefer=%d aiTarget=%dx%d aiExpandDir=%d aiExpandTurn=%d outLeft=%d sideLeft=%d aiNextDecision=%d lastSeenType=%d lastSeen=%dx%d lastSeenNum=%d lastSeenTick=%d lastSeenDist=%d snap=%q",
			r.id,
			r.tick,
			num,
			pn,
			killer,
			kn,
			rs,
			area,
			bw,
			bh,
			dens,
			per,
			len(p.trail),
			headX,
			headY,
			prevX,
			prevY,
			nextX,
			nextY,
			hx,
			hy,
			hitI,
			hitTrailOwner,
			hitGridOwner,
			p.dir,
			p.pendingDir,
			p.speedUntil,
			speedActive,
			p.aiAvoidTick,
			avoidAge,
			p.aiAvoidFrom,
			p.aiAvoidTo,
			p.aiAvoidReason,
			p.aiMode,
			p.aiExpandPhase,
			p.aiExpandIntent,
			p.aiExpandPrefer,
			p.aiTargetX,
			p.aiTargetY,
			p.aiExpandDir,
			p.aiExpandTurn,
			p.aiExpandOutLeft,
			p.aiExpandSideLeft,
			p.aiNextDecisionTick,
			p.aiLastSeenType,
			p.aiLastSeenX,
			p.aiLastSeenY,
			p.aiLastSeenNum,
			p.aiLastSeenTick,
			lastSeenDist,
			snap,
		)
	}

	p.alive = false
	p.killStreak = 0
	p.lastKillTick = 0
	p.shield = 0
	p.spawnGraceUntil = 0
	p.speedUntil = 0
	p.speedLockUntil = 0
	p.bonusBudget = BonusBudgetMax
	p.lastKiller = killer
	p.lastKilledTick = r.tick
	// F1: the contract survives death; dying costs time, so give some back.
	if p.contractUntil != 0 {
		p.contractUntil += 100
	}
	if p.bot {
		r.releaseHunt(p)
		p.respawnAt = r.tick + r.botRespawnDelay(p)
	}
	if killer != 0 && killer != num {
		k := r.players[killer]
		if k != nil {
			r.ensureContract(k)
			if !k.bot {
				pr := profileForKeyCreate(k.profileKey)
				if pr != nil {
					profilesMu.Lock()
					ensureProfileDailyLocked(pr, k.profileKey)
					if pr.TotalKills < ^uint32(0) {
						pr.TotalKills++
					}
					rewardCount := r.addDailyProgressLocked(k, pr, DailyKills, 1)
					achvCount := r.checkAchievementsLocked(k, pr)
					profilesMu.Unlock()
					markProfilesDirty()
					r.grantDailyRewards(k, rewardCount)
					r.grantAchievementRewards(k, achvCount)
				}
			}
			if k.lastKillTick != 0 && r.tick-k.lastKillTick <= KillStreakWindow {
				if k.killStreak < 255 {
					k.killStreak++
				}
			} else {
				k.killStreak = 1
			}
			k.lastKillTick = r.tick
			r.pushEvent(Event{Kind: EventStreak, A: killer, D: k.killStreak})
			// E4: a bot respawns in about a second, so it cannot be worth as
			// much as a human, and the rate decays once the killer farms them.
			gain := uint16(StyleKillHuman)
			if p.bot {
				if k.botKillsMatch < ^uint16(0) {
					k.botKillsMatch++
				}
				if k.botKillsMatch > BotKillFullRate {
					gain = StyleKillBotLate
				} else {
					gain = StyleKillBot
				}
			}
			r.addStyleCapped(k, gain, StyleKill, &k.styleKillMatch, StyleKillMatchCap)
			r.awardPoints(k.num, 18, PointsKill)
			if k.lastKiller != 0 && k.lastKiller == num && k.lastKilledTick != 0 && r.tick-k.lastKilledTick <= 900 {
				r.pushEvent(Event{Kind: EventRevenge, A: killer, B: num})
				// G11: revenge used to be one of only two Style sources that
				// ignored every per-match budget. With a 900-tick window the
				// trade "die to the same bot, kill it back" was a farm. It now
				// has its own match budget and a per-target cooldown.
				if k.revengeLastTgt != num || k.revengeLastTick == 0 ||
					r.tick-k.revengeLastTick >= RevengeSameTargetCooldown {
					r.addStyleCapped(k, StyleRevengeReward, StyleRevenge, &k.revengeStyleAcc, StyleRevengeMatchCap)
					k.revengeLastTgt = num
					k.revengeLastTick = r.tick
				}
				r.awardPoints(k.num, 10, PointsRevenge)
				if !k.bot {
					pr := profileForKeyCreate(k.profileKey)
					if pr != nil {
						profilesMu.Lock()
						ensureProfileDailyLocked(pr, k.profileKey)
						if pr.TotalRevenge < ^uint32(0) {
							pr.TotalRevenge++
						}
						achvCount := r.checkAchievementsLocked(k, pr)
						profilesMu.Unlock()
						markProfilesDirty()
						r.grantAchievementRewards(k, achvCount)
					}
				}
				k.lastKiller = 0
				k.lastKilledTick = 0
			}
			// F9: streaks are worth noticing now — bigger radius, real Style,
			// and the ladder keeps going past x5.
			if k.alive {
				switch k.killStreak {
				case 3:
					r.bonusTerritory(k.num, k.x, k.y, 2)
					r.addStyleCapped(k, 15, StyleKill, &k.styleKillMatch, StyleKillMatchCap)
				case 5:
					r.bonusTerritory(k.num, k.x, k.y, 3)
					r.addStyleCapped(k, 30, StyleKill, &k.styleKillMatch, StyleKillMatchCap)
				case 7:
					r.bonusTerritory(k.num, k.x, k.y, 4)
					r.addStyleCapped(k, 50, StyleKill, &k.styleKillMatch, StyleKillMatchCap)
				}
			}
			if k.contractType == ContractKills {
				r.addContractProgress(k, 1)
			}
		}
	}
	if r.bountyTarget != 0 && num == r.bountyTarget && killer != 0 && killer != num {
		k := r.players[killer]
		if k != nil && k.alive {
			r.bonusTerritory(k.num, k.x, k.y, 3)
			// G11: bounty Style is budgeted per match like every other source.
			r.addStyleCapped(k, StyleBountyKill, StyleBounty, &k.bountyStyleMatch, StyleBountyMatchCap)
			r.awardPoints(k.num, 28, PointsBounty)
			if !k.bot {
				pr := profileForKeyCreate(k.profileKey)
				if pr != nil {
					profilesMu.Lock()
					ensureProfileDailyLocked(pr, k.profileKey)
					if pr.TotalBounty < ^uint32(0) {
						pr.TotalBounty++
					}
					achvCount := r.checkAchievementsLocked(k, pr)
					profilesMu.Unlock()
					markProfilesDirty()
					r.grantAchievementRewards(k, achvCount)
				}
			}
		}
		r.pushEvent(Event{Kind: EventBountyClaim, A: killer, B: num})
		r.clearBounty()
	}
	x := uint16(0)
	y := uint16(0)
	if inBounds(p.x, p.y) {
		x = uint16(p.x)
		y = uint16(p.y)
	}
	r.pushEvent(Event{Kind: EventKill, A: num, B: killer, D: reasonCode(reason), X: x, Y: y})
	r.clearPlayerCells(num, p)

	p.dir = DirRight
	p.pendingDir = DirRight
	p.nextI = -1
}

func (r *Room) respawnPlayer(p *Player) {
	x, y := r.pickSpawnCell(p.num)
	p.x = x
	p.y = y
	p.homeX = x
	p.homeY = y
	p.nextX = x
	p.nextY = y
	p.nextI = r.idx(x, y)
	p.dir = r.pickSafeSpawnDir(p)
	p.pendingDir = p.dir
	p.trail = p.trail[:0]
	if p.owned != nil {
		p.owned = p.owned[:0]
	}
	p.alive = true
	p.respawnAt = 0
	p.aiNextDecisionTick = 0
	p.aiModeUntil = 0
	p.aiMode = 0
	p.aiExpandPhase = 0
	p.aiExpandUntil = 0
	p.aiLastSeenTick = 0
	p.aiLastSeenType = 0
	p.aiLastSeenX = 0
	p.aiLastSeenY = 0
	p.aiLastSeenNum = 0
	p.aiAvoidTick = 0
	p.aiAvoidFrom = 0
	p.aiAvoidTo = 0
	p.aiAvoidReason = 0
	r.releaseHunt(p)
	p.aiHuntTarget = 0
	p.aiWindupUntil = 0
	p.aiHuntScanTick = 0
	p.aiCoolScanTick = 0
	p.aiCoolCell = -1
	for i := 0; i < aiRecentCap; i++ {
		p.aiRecentX[i] = 0
		p.aiRecentY[i] = 0
	}
	p.aiRecentI = 0
	p.aiRecentN = 0
	p.killStreak = 0
	p.lastKillTick = 0
	p.shield = 0
	p.speedUntil = 0
	p.lastKiller = 0
	p.lastKilledTick = 0
	// F2: a fresh 3x3 spawn in the middle of 14 bots needs a moment to breathe.
	// The grace is dropped as soon as the player leaves their own territory
	// (see applyMove), so it cannot be ridden into someone else's trail.
	p.spawnGraceUntil = r.tick + SpawnGraceTicks
	// F1: the contract deliberately survives respawn. With bots killing a
	// player every 20-45s a "3 kills" contract was otherwise unreachable.
	// resetMatchLocked clears it explicitly when a new match starts.
	r.claimSpawnTerritory(p.num, x, y)
	r.forceFullSnapshot = true
}

func (r *Room) pickSafeSpawnDir(p *Player) Dir {
	best := DirRight
	bestScore := int32(-1 << 30)
	wallMargin := 10
	dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
	for _, d := range dirs {
		if d == DirLeft && p.x <= wallMargin {
			continue
		}
		if d == DirRight && (W-1-p.x) <= wallMargin {
			continue
		}
		if d == DirUp && p.y <= wallMargin {
			continue
		}
		if d == DirDown && (H-1-p.y) <= wallMargin {
			continue
		}
		dx, dy := dirToDelta(d)
		nx := p.x + dx
		ny := p.y + dy
		if !inBounds(nx, ny) {
			continue
		}
		i := r.idx(nx, ny)
		if r.trailOwner[i] == p.num {
			continue
		}
		score := int32(0)
		if r.trailOwner[i] != 0 {
			score -= 40
		}
		if r.gridOwner[i] == 0 {
			score += 12
		} else if r.gridOwner[i] == p.num {
			score += 8
		} else {
			score += 10
		}
		minD := 9999
		for _, o := range r.players {
			if o == nil || !o.alive || o.num == p.num {
				continue
			}
			d := manhattan(nx, ny, o.x, o.y)
			if d < minD {
				minD = d
			}
		}
		score += int32(minD)
		if score > bestScore {
			bestScore = score
			best = d
		}
	}
	if bestScore == int32(-1<<30) {
		best = DirRight
		dirs2 := []Dir{DirUp, DirDown, DirLeft, DirRight}
		bestMargin := -1
		for _, d := range dirs2 {
			m := 0
			switch d {
			case DirLeft:
				m = p.x
			case DirRight:
				m = (W - 1 - p.x)
			case DirUp:
				m = p.y
			case DirDown:
				m = (H - 1 - p.y)
			}
			if m > bestMargin {
				bestMargin = m
				best = d
			}
		}
	}
	return best
}

func (r *Room) stepPlayer(p *Player) {
	if !p.alive {
		return
	}
	if p.pendingDir != p.dir && !isOpposite(p.dir, p.pendingDir) {
		p.dir = p.pendingDir
	}
	if p.bot {
		allowTrailOwner := uint16(0)
		if p.aiMode == 2 && p.aiHuntTarget != 0 {
			allowTrailOwner = p.aiHuntTarget
		}

		moveDir := p.dir
		dx, dy := dirToDelta(moveDir)
		nx := p.x + dx
		ny := p.y + dy
		needAvoid := false
		avoidReason := uint8(0)
		if !inBounds(nx, ny) {
			needAvoid = true
			avoidReason = 1
		} else {
			i := r.idx(nx, ny)
			if r.trailOwner[i] == p.num {
				needAvoid = true
				avoidReason = 2
			} else if r.lookaheadBad(p, moveDir, 3, allowTrailOwner) {
				needAvoid = true
				avoidReason = 3
			}
		}
		if needAvoid {
			dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
			best := moveDir
			bestScore := int32(-1 << 30)
			bestOk := false
			// G5: single pass only. A human cannot escape by reversing, so a
			// bot may not either — the second pass used to allow a free 180.
			for _, d := range dirs {
				if isOpposite(moveDir, d) {
					continue
				}
				dx2, dy2 := dirToDelta(d)
				x2 := p.x + dx2
				y2 := p.y + dy2
				if !inBounds(x2, y2) {
					continue
				}
				i2 := r.idx(x2, y2)
				if r.trailOwner[i2] == p.num {
					continue
				}
				if r.lookaheadBad(p, d, 3, allowTrailOwner) {
					continue
				}
				sc := int32(0)
				if d == moveDir {
					sc += 3
				}
				sc += r.freeKillBonus(p, i2) / 8
				if pen := r.recentPenalty(p, x2, y2); pen > 0 {
					sc -= pen
				}
				if sc > bestScore {
					bestScore = sc
					best = d
					bestOk = true
				}
			}
			if bestOk {
				p.dir = best
				p.pendingDir = best
				p.aiAvoidTick = r.tick
				p.aiAvoidFrom = moveDir
				p.aiAvoidTo = best
				p.aiAvoidReason = avoidReason
				p.aiNextDecisionTick = 0
				// G12: keep the expansion phase. Wiping it forced a full
				// replan next tick, which is what made bots dither at edges.
			}
		}
	}

	nx := p.x
	ny := p.y
	switch p.dir {
	case DirUp:
		ny--
	case DirDown:
		ny++
	case DirLeft:
		nx--
	case DirRight:
		nx++
	}

	p.nextX = nx
	p.nextY = ny
	if inBounds(nx, ny) {
		p.nextI = r.idx(nx, ny)
	} else {
		p.nextI = -1
	}
}

func (r *Room) resolveHeadOnCollisions(alive []*Player) {
	// G11: the map and its slices used to be allocated from scratch on every
	// tick of every room. They are reused now; the per-cell slices are trimmed
	// to zero length rather than dropped, so their backing arrays survive.
	if r.headOnCells == nil {
		r.headOnCells = make(map[int][]uint16, len(alive))
	}
	cellToPlayers := r.headOnCells
	for i, v := range cellToPlayers {
		cellToPlayers[i] = v[:0]
	}
	touched := r.headOnTouched[:0]
	for _, p := range alive {
		if p == nil || !p.alive {
			continue
		}
		i := p.nextI
		if i == -1 {
			continue
		}
		if len(cellToPlayers[i]) == 0 {
			touched = append(touched, i)
		}
		cellToPlayers[i] = append(cellToPlayers[i], p.num)
	}
	r.headOnTouched = touched
	for _, i := range touched {
		nums := cellToPlayers[i]
		if len(nums) > 1 {
			i := -1
			if len(nums) > 0 {
				if pp := r.players[nums[0]]; pp != nil {
					i = pp.nextI
				}
			}
			hx := 0
			hy := 0
			if i >= 0 {
				hx = i % W
				hy = i / W
			}
			for _, n := range nums {
				// F2: killPlayerWithReason absorbs the hit for anyone still
				// inside their spawn grace; the others still die.
				r.killPlayerWithReason(n, 0, "head_on", i, hx, hy)
			}
		}
	}
}

func (r *Room) applyMove(p *Player) {
	if !p.alive {
		return
	}
	if p.nextI == -1 {
		r.killPlayerWithReason(p.num, 0, "wall", -1, p.nextX, p.nextY)
		return
	}
	if p.bot {
		// Last-chance safety: next cell can become unsafe due to multi-step moves or
		// stale decisions; try to avoid stepping into own trail.
		if p.nextI >= 0 && r.trailOwner[p.nextI] == p.num {
			moveDir := p.dir
			allowTrailOwner := uint16(0)
			if p.aiMode == 2 && p.aiHuntTarget != 0 {
				allowTrailOwner = p.aiHuntTarget
			}
			dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
			best := moveDir
			bestScore := int32(-1 << 30)
			bestOk := false
			// G11: pass 0 also demands a clean 2-step lookahead, so the last
			// resort cannot dump the bot into a dead end or a wall. Pass 1
			// drops that requirement but never the no-180 rule (G5).
			for pass := 0; pass < 2; pass++ {
				for _, d := range dirs {
					if isOpposite(moveDir, d) {
						continue
					}
					dx, dy := dirToDelta(d)
					nx := p.x + dx
					ny := p.y + dy
					if !inBounds(nx, ny) {
						continue
					}
					ii := r.idx(nx, ny)
					if r.trailOwner[ii] == p.num {
						continue
					}
					if pass == 0 && r.lookaheadBad(p, d, 2, allowTrailOwner) {
						continue
					}
					sc := int32(0)
					if d == moveDir {
						sc += 3
					}
					sc += r.freeKillBonus(p, ii) / 8
					if sc > bestScore {
						bestScore = sc
						best = d
						bestOk = true
					}
				}
				if bestOk {
					break
				}
				bestScore = int32(-1 << 30)
			}
			if bestOk {
				p.dir = best
				p.pendingDir = best
				p.aiAvoidTick = r.tick
				p.aiAvoidFrom = moveDir
				p.aiAvoidTo = best
				p.aiAvoidReason = 3
				dx, dy := dirToDelta(best)
				nx := p.x + dx
				ny := p.y + dy
				p.nextX = nx
				p.nextY = ny
				if inBounds(nx, ny) {
					p.nextI = r.idx(nx, ny)
				} else {
					p.nextI = -1
				}
				if p.nextI == -1 {
					r.killPlayerWithReason(p.num, 0, "wall", -1, p.nextX, p.nextY)
					return
				}
			}
		}
	}

	p.x = p.nextX
	p.y = p.nextY

	i := p.nextI
	if len(r.powerUps) > 0 {
		if idx := r.powerUpIndexAtCell(i); idx >= 0 {
			pu := r.powerUps[idx]
			switch pu.Type {
			case PowerupShield:
				p.shield = 1
			case PowerupDash:
				dur := uint32(DashDuration)
				if p.speedLockUntil != 0 && r.tick < p.speedLockUntil {
					dur = uint32(DashDurationLocked)
				} else {
					p.speedLockUntil = r.tick + SpeedPickupLockTicks
				}
				target := r.tick + dur
				if p.speedUntil > target {
					target = p.speedUntil
				}
				cap := r.tick + uint32(DashMaxFromNow)
				if target > cap && p.speedUntil <= cap {
					target = cap
				}
				if p.speedUntil < target {
					p.speedUntil = target
				}
			case PowerupNova:
				r.bonusTerritory(p.num, p.x, p.y, 2)
				rad := 2
				for dy := -rad; dy <= rad; dy++ {
					for dx := -rad; dx <= rad; dx++ {
						x := p.x + dx
						y := p.y + dy
						if !inBounds(x, y) {
							continue
						}
						ii := r.idx(x, y)
						if r.trailOwner[ii] != 0 {
							r.setTrail(ii, 0)
						}
					}
				}
				r.pushEvent(Event{Kind: EventPowerupUse, A: p.num, D: PowerupNova, X: uint16(p.x), Y: uint16(p.y)})
			case PowerupMegaDash:
				dur := uint32(MegaDashDuration)
				if p.speedLockUntil != 0 && r.tick < p.speedLockUntil {
					dur = uint32(MegaDashDurationLocked)
				} else {
					p.speedLockUntil = r.tick + SpeedPickupLockTicks
				}
				target := r.tick + dur
				if p.speedUntil > target {
					target = p.speedUntil
				}
				cap := r.tick + uint32(MegaDashMaxFromNow)
				if target > cap && p.speedUntil <= cap {
					target = cap
				}
				if p.speedUntil < target {
					p.speedUntil = target
				}
			}
			r.removePowerUpAtIndex(idx)
			r.metaDirty = true
			r.pushEvent(Event{Kind: EventPowerupPickup, A: p.num, B: pu.ID, D: pu.Type, X: uint16(p.x), Y: uint16(p.y)})
			r.ensureContract(p)
			if p.contractType == ContractPickups {
				r.addContractProgress(p, 1)
			}
			if !p.bot {
				pr := profileForKeyCreate(p.profileKey)
				if pr != nil {
					profilesMu.Lock()
					ensureProfileDailyLocked(pr, p.profileKey)
					if pr.TotalPickups < ^uint32(0) {
						pr.TotalPickups++
					}
					rewardCount := r.addDailyProgressLocked(p, pr, DailyPickups, 1)
					achvCount := r.checkAchievementsLocked(p, pr)
					profilesMu.Unlock()
					markProfilesDirty()
					r.grantDailyRewards(p, rewardCount)
					r.grantAchievementRewards(p, achvCount)
				}
			}
		}
	}
	t := r.trailOwner[i]
	if t != 0 {
		if t == p.num {
			r.killPlayerWithReason(p.num, 0, "self_trail", i, p.x, p.y)
			return
		}
		if victim := r.players[t]; victim != nil {
			switch {
			case r.hasSpawnGrace(victim):
				// F2: the cut is absorbed by the grace, the shield is untouched.
			case victim.shield > 0:
				victim.shield = 0
				x := uint16(0)
				y := uint16(0)
				if inBounds(victim.x, victim.y) {
					x = uint16(victim.x)
					y = uint16(victim.y)
				}
				r.pushEvent(Event{Kind: EventPowerupUse, A: victim.num, D: PowerupShield, X: x, Y: y})
			default:
				r.killPlayerWithReason(t, p.num, "trail_cut", i, p.x, p.y)
			}
		}
	}

	owns := r.gridOwner[i] == p.num
	if !owns && r.coolWireAt(i) == (coolOwnerFlag|p.num) {
		// F5: stepping on your own cooling ground takes the whole connected
		// patch back at once.
		if n := r.reclaimCoolRegion(p, i); n > 0 {
			owns = true
			// G3: the mechanic was measured firing zero times in three matches.
			// Counting it is how we know it is alive after the fix.
			if p.reclaimsMatch < ^uint16(0) {
				p.reclaimsMatch++
			}
			cells := uint16(n)
			if n > int(^uint16(0)) {
				cells = ^uint16(0)
			}
			r.pushEvent(Event{Kind: EventReclaim, A: p.num, B: cells, X: uint16(p.x), Y: uint16(p.y)})
		}
	}
	if !owns {
		// F2: stepping outside home ends the grace, so it cannot be used as a
		// battering ram.
		r.clearSpawnGrace(p)
		if r.trailOwner[i] != p.num {
			r.setTrail(i, p.num)
			p.trail = append(p.trail, i)
		}
	} else {
		if len(p.trail) > 0 {
			r.capture(p.num)
		}
	}
}

func (r *Room) step() {
	stepStartedAt := time.Now()
	// lightweight perf splits (only logged on slow ticks)
	var botDur time.Duration
	var moveDur time.Duration
	var roiDur time.Duration
	var sendDur time.Duration
	var roiFast int
	var roiScan int
	var roiSkipped int
	var changedGridN int
	var changedTrailN int
	r.mu.Lock()

	// G11: a room with nobody watching used to run a full tick — 14 bots at
	// 0.42ms — for the whole 30s cleanup window, and any room kept alive
	// without humans burned that forever. At MaxRooms=64 that is a real idle
	// floor. The clock stops too, so a room that is woken up again resumes its
	// match where it left off instead of finding it long expired.
	if r.humanCount == 0 && len(r.clients) == 0 {
		r.mu.Unlock()
		return
	}

	r.tick++
	tickNow := r.tick

	var matchEndPayload any
	var matchStartPayload any
	matchEndedNow := false
	var matchEndClients []*Client

	if !r.matchEnded && r.matchEndTick != 0 && tickNow >= r.matchEndTick {
		r.matchEnded = true
		r.matchResetAt = tickNow + MatchIntermissionTicks
		if r.matchEndSentSeq != r.matchSeq {
			res := r.buildMatchResultsLocked()
			// G3: one line per match makes it possible to tell from production
			// logs whether reclaim is a mechanic or dead code.
			reclaims := 0
			for _, p := range r.players {
				if p != nil {
					reclaims += int(p.reclaimsMatch)
				}
			}
			log.Printf("match_end room=%d seq=%d reclaims=%d", r.id, r.matchSeq, reclaims)
			// E3: rewards follow the ABSOLUTE place among every participant,
			// bots included. Ranking humans only made the single human in a
			// room a guaranteed "winner" no matter how badly they played.
			// Only humans are paid; bots have nothing to spend Style on.
			for _, mr := range res {
				if mr.Bot {
					continue
				}
				p := r.players[mr.N]
				if p == nil {
					continue
				}
				switch {
				case mr.Place == 1:
					r.addStyle(p, StylePlace1, StyleWin)
					r.grantFirstWinBonus(p)
				case mr.Place <= 3:
					r.addStyle(p, StylePlace23, StyleTop5)
				case mr.Place <= 5:
					r.addStyle(p, StylePlace45, StyleTop5)
				case mr.Place == 6:
					r.addStyle(p, StylePlace6, StyleTop5)
				case mr.Place == 7:
					r.addStyle(p, StylePlace7, StyleTop5)
				case mr.Place == 8:
					r.addStyle(p, StylePlace8, StyleTop5)
				}
				// G23: surviving to the final tick always pays something, so
				// the last line of the summary is never a flat zero.
				if p.alive {
					r.addStyle(p, StyleSurviveReward, StyleSurvive)
				}
			}
			matchEndPayload = map[string]any{
				"tick":    tickNow,
				"seq":     r.matchSeq,
				"endTick": r.matchEndTick,
				"resetAt": r.matchResetAt,
				"results": res,
			}
			r.matchEndSentSeq = r.matchSeq
		}
		if len(r.clients) > 0 {
			matchEndClients = make([]*Client, 0, len(r.clients))
			for c := range r.clients {
				matchEndClients = append(matchEndClients, c)
			}
		}
		matchEndedNow = true
	}

	if r.matchEnded {
		if r.matchResetAt != 0 && tickNow >= r.matchResetAt {
			r.resetMatchLocked()
			matchStartPayload = map[string]any{
				"tick":       r.tick,
				"seq":        r.matchSeq,
				"endTick":    r.matchEndTick,
				"phase":      r.matchPhase(),
				"phaseUntil": r.phaseUntilTick(),
			}
			r.phaseSent = r.matchPhase()
			r.mu.Unlock()
			r.broadcastJSON(context.Background(), "matchStart", matchStartPayload)
			return
		}
		r.mu.Unlock()
		return
	}

	if matchEndedNow {
		r.mu.Unlock()
		if len(matchEndClients) > 0 {
			for _, c := range matchEndClients {
				c.mu.Lock()
				rm := c.room
				pl := c.player
				c.mu.Unlock()
				if rm != r || pl == nil {
					continue
				}
				// pl fields are guarded by r.mu: build the payload under the lock.
				r.mu.Lock()
				payload := cosmeticsStatePayload(pl)
				r.mu.Unlock()
				c.sendJSON(context.Background(), "cosmetics", payload)
			}
		}
		if matchEndPayload != nil {
			r.broadcastJSON(context.Background(), "matchEnd", matchEndPayload)
		}
		return
	}

	// G24: announce a phase boundary exactly once per match phase. The binary
	// events header (type 5) is frozen by the golden tests, so the phase rides
	// its own small JSON message instead.
	var phasePayload map[string]any
	if ph := r.matchPhase(); ph != r.phaseSent {
		r.phaseSent = ph
		phasePayload = r.matchPhasePayload()
	}

	// F5: retire cooling cells whose window has run out (amortized).
	r.stepCoolExpiry()

	r.maybeUpdateMutator()
	r.maybeUpdateBounty()
	r.maybeUpdatePowerUps()

	for _, p := range r.players {
		if p == nil || !p.bot || p.alive {
			continue
		}
		if p.respawnAt != 0 && r.tick >= p.respawnAt {
			r.respawnPlayer(p)
		}
	}

	alive := r.tmpAlive
	if alive == nil {
		alive = make([]*Player, 0, len(r.players))
	}
	alive = alive[:0]
	for _, p := range r.players {
		if p.alive {
			alive = append(alive, p)
		}
	}
	r.tmpAlive = alive

	// F3: integrate held territory over time so the summary can show an
	// average, not just the final-tick snapshot.
	for _, p := range r.players {
		if p == nil {
			continue
		}
		p.cellTicks += uint32(r.scores[p.num])
	}

	// G2: pay for territory that is actually held. Without this the only way to
	// score was the capture event itself, so nobody had a reason to defend an
	// empire and the map stayed a patchwork of nibbles.
	if tickNow%HoldPayEveryTicks == 0 {
		r.payHoldPoints()
	}

	// G7: keep LastSeen fresh for people who are actually playing. It is
	// otherwise only written at join, on a Style grant and on a purchase, and
	// once the income ceilings bite those stop for minutes at a time.
	if tickNow%ProfileTouchEveryTicks == 0 {
		for _, p := range r.players {
			if p == nil || p.bot || p.profileKey == "" {
				continue
			}
			touchProfileLastSeen(p.profileKey)
		}
	}

	for _, p := range alive {
		if p == nil {
			continue
		}
		if p.bonusBudget < BonusBudgetMax {
			v := int(p.bonusBudget) + BonusBudgetRegenPerTick
			if v > BonusBudgetMax {
				v = BonusBudgetMax
			}
			p.bonusBudget = uint16(v)
		}
		if p.contractType == ContractNone || p.contractGoal == 0 || (p.contractUntil != 0 && r.tick >= p.contractUntil) {
			r.ensureContract(p)
		}
	}

	botStartedAt := time.Now()
	// G2: rebuild the hunter census from live state before any bot decides.
	// Recomputing beats incremental bookkeeping here: a stuck counter would
	// silently switch bot aggression off for the rest of the match.
	r.recomputeHuntersLocked()
	for _, p := range alive {
		if p.bot {
			r.botStep(p)
		}
	}
	botDur = time.Since(botStartedAt)

	moveStartedAt := time.Now()
	for _, p := range alive {
		r.stepPlayer(p)
	}
	r.resolveHeadOnCollisions(alive)
	for _, p := range alive {
		r.applyMove(p)
	}
	// G11: the accelerated half-step used to run stepPlayer+applyMove per player
	// with no head-on pass in between, so two speeding players could walk
	// through each other in the same cell. It is now the same three phases as
	// the normal step.
	speeders := r.tmpSpeeders[:0]
	for _, p := range alive {
		if p == nil || !p.alive {
			continue
		}
		if p.speedUntil != 0 && r.tick < p.speedUntil {
			speeders = append(speeders, p)
		}
	}
	r.tmpSpeeders = speeders
	if len(speeders) > 0 {
		for _, p := range speeders {
			r.stepPlayer(p)
		}
		r.resolveHeadOnCollisions(speeders)
		for _, p := range speeders {
			r.applyMove(p)
		}
	}
	moveDur = time.Since(moveStartedAt)

	changedGridN = len(r.changedGrid)
	changedTrailN = len(r.changedTrail)
	forceROI := r.forceFullSnapshot || (r.tick%FullSnapshotEveryTicks == 0) || (changedGridN+changedTrailN > MaxDeltaChanges)
	if forceROI {
		r.forceFullSnapshot = false
	}

	players := r.tmpPlayers
	if players == nil {
		players = make([]*Player, 0, len(r.players))
	}
	players = players[:0]
	for _, p := range r.players {
		players = append(players, p)
	}
	r.tmpPlayers = players

	clients := r.tmpClients
	if clients == nil {
		clients = make([]*Client, 0, len(r.clients))
	}
	clients = clients[:0]
	for c := range r.clients {
		clients = append(clients, c)
	}
	r.tmpClients = clients
	anchors := r.tmpAnchors
	if anchors == nil {
		anchors = make(map[uint16]playerAnchor, len(players))
	}
	for k := range anchors {
		delete(anchors, k)
	}
	for _, p := range players {
		anchors[p.num] = playerAnchor{x: p.x, y: p.y, hx: p.homeX, hy: p.homeY, alive: p.alive, dir: p.dir}
	}
	r.tmpAnchors = anchors

	var minimapMsg []byte
	if !r.minimapFullActive && (r.tick%MinimapFullForcedEveryTicks == 0 || r.tick%MinimapFullEveryTicks == 0) {
		r.minimapFullActive = true
		r.minimapFullCursor = 0
	}
	if r.minimapDirty {
		if !r.minimapFullActive {
			r.minimapFullCursor = 0
		}
		r.minimapFullActive = true
		r.minimapDirty = false
	}
	if r.tick%MinimapDeltaEveryTicks == 0 {
		if r.minimapFullActive {
			minimapMsg = r.buildMinimapChunkBinary(true)
		} else if len(r.minimapGrid) > 0 {
			minimapMsg = r.buildMinimapChunkBinary(false)
		}
		r.minimapGrid = r.minimapGrid[:0]
	}

	forceEvents := len(r.events) > 0 || r.metaDirty || r.tick%10 == 0
	eventsPD := r.buildEventsPooledLocked(forceEvents)

	r.mu.Unlock()

	if phasePayload != nil {
		r.broadcastJSON(context.Background(), "matchPhase", phasePayload)
	}

	reqs := r.tmpReqs
	if reqs == nil {
		reqs = make([]roiReq, 0, len(clients))
	}
	reqs = reqs[:0]
	for _, c := range clients {
		c.mu.Lock()
		pl := c.player
		lastTick := c.lastStateTick
		lastROIX := c.lastROIX
		lastROIY := c.lastROIY
		lastROIW := c.lastROIW
		lastROIH := c.lastROIH
		viewW := c.viewW
		viewH := c.viewH
		c.mu.Unlock()

		rw, rh := clampViewport(viewW, viewH)

		x := W / 2
		y := H / 2
		if pl != nil {
			a := anchors[pl.num]
			if a.alive && a.x >= 0 && a.y >= 0 {
				x = a.x
				y = a.y
				dx, dy := dirToDelta(a.dir)
				la := roiLookahead(rw, rh, dx, dy)
				x += dx * la
				y += dy * la
				if x < 0 {
					x = 0
				} else if x >= W {
					x = W - 1
				}
				if y < 0 {
					y = 0
				} else if y >= H {
					y = H - 1
				}
			} else if a.hx >= 0 && a.hy >= 0 {
				x = a.hx
				y = a.hy
			}
		}

		rx := x - rw/2
		ry := y - rh/2
		if rx < 0 {
			rx = 0
		}
		if ry < 0 {
			ry = 0
		}
		if rx+rw > W {
			rx = W - rw
		}
		if ry+rh > H {
			ry = H - rh
		}
		if ROIStep > 1 {
			atRightEdge := rx == W-rw
			atBottomEdge := ry == H-rh

			// Snap to the NEAREST step, not the one below: flooring biased the
			// window backwards by up to ROIStep-1 cells and stacked that on top
			// of the forward lookahead, which is what made the rear margin
			// vanish after a reversal.
			rx = ((rx + ROIStep/2) / ROIStep) * ROIStep
			ry = ((ry + ROIStep/2) / ROIStep) * ROIStep
			if rx < 0 {
				rx = 0
			}
			if ry < 0 {
				ry = 0
			}
			if rx > W-rw {
				rx = W - rw
			}
			if ry > H-rh {
				ry = H - rh
			}
			if atRightEdge {
				rx = W - rw
			}
			if atBottomEdge {
				ry = H - rh
			}
		}

		// A resize keeps the origin but exposes new cells, so the window size
		// is part of the "same window as last tick" test.
		fullROI := forceROI || lastTick == 0 || rx != lastROIX || ry != lastROIY ||
			rw != lastROIW || rh != lastROIH
		reqs = append(reqs, roiReq{c: c, rx: rx, ry: ry, rw: rw, rh: rh, full: fullROI, sinceTick: lastTick})
	}
	r.tmpReqs = reqs
	roiStartedAt := time.Now()

	r.mu.Lock()
	roiMsgs := make(map[*Client]*pooledData, len(reqs))
	useFastSince := uint32(0)
	if tickNow > 0 {
		useFastSince = tickNow - 1
	}
	for _, req := range reqs {
		if _, ok := r.clients[req.c]; !ok {
			continue
		}
		if !req.full && req.sinceTick != 0 && req.sinceTick == useFastSince {
			roiFast++
			roiMsgs[req.c] = r.buildROIPooledFast(req.rx, req.ry, req.rw, req.rh, req.sinceTick, players)
		} else {
			roiScan++
			roiMsgs[req.c] = r.buildROIPooledScan(req.rx, req.ry, req.rw, req.rh, req.full, req.sinceTick, players)
		}
	}

	r.changedGrid = r.changedGrid[:0]
	r.changedTrail = r.changedTrail[:0]
	r.mu.Unlock()
	roiDur = time.Since(roiStartedAt)

	ctx := context.Background()
	var minimapPD *pooledData
	if minimapMsg != nil {
		minimapPD = acquirePooledData(len(minimapMsg))
		minimapPD.b = append(minimapPD.b, minimapMsg...)
	}
	var sharedEventsPD *pooledData
	if eventsPD != nil {
		sharedEventsPD = eventsPD
	}
	sendStartedAt := time.Now()
	for _, req := range reqs {
		c := req.c
		if pd, ok := roiMsgs[c]; ok {
			if len(c.sendCh) < cap(c.sendCh)-2 {
				if c.sendBinaryPooled(pd, true) {
					c.mu.Lock()
					c.lastStateTick = tickNow
					c.lastROIX = req.rx
					c.lastROIY = req.ry
					c.lastROIW = req.rw
					c.lastROIH = req.rh
					c.mu.Unlock()
				}
			} else {
				roiSkipped++
				decPooledRef(pd)
			}
		}
		if minimapPD != nil {
			incPooledRef(minimapPD)
			_ = c.sendBinaryPooled(minimapPD, true)
		}
		if sharedEventsPD != nil {
			incPooledRef(sharedEventsPD)
			_ = c.sendBinaryPooled(sharedEventsPD, true)
		}
	}
	sendDur = time.Since(sendStartedAt)
	if minimapPD != nil {
		decPooledRef(minimapPD)
	}
	if sharedEventsPD != nil {
		decPooledRef(sharedEventsPD)
	}
	_ = ctx
	if d := time.Since(stepStartedAt); d > 750*time.Millisecond {
		log.Printf("room_step_slow room=%d tick=%d dur_ms=%d clients=%d players=%d", r.id, tickNow, d.Milliseconds(), len(clients), len(players))
	} else if d > time.Duration(TickMS)*time.Millisecond {
		log.Printf(
			"room_step_perf room=%d tick=%d total_ms=%.3f bot_ms=%.3f move_ms=%.3f roi_ms=%.3f send_ms=%.3f clients=%d players=%d alive=%d forceROI=%t changedGrid=%d changedTrail=%d roiFast=%d roiScan=%d roiSkipped=%d",
			r.id,
			tickNow,
			float64(d)/float64(time.Millisecond),
			float64(botDur)/float64(time.Millisecond),
			float64(moveDur)/float64(time.Millisecond),
			float64(roiDur)/float64(time.Millisecond),
			float64(sendDur)/float64(time.Millisecond),
			len(clients),
			len(players),
			len(alive),
			forceROI,
			changedGridN,
			changedTrailN,
			roiFast,
			roiScan,
			roiSkipped,
		)
	}

	_ = matchStartPayload
}

// allocPlayerNumLocked hands out the first free number in 1..maxPlayerNum,
// scanning forward from the last one issued and wrapping around. Numbers are
// burned by bots too (syncBotPopulationLocked recreates them on every human
// join/leave), so a plain increment would eventually reach coolOwnerFlag and
// make live territory indistinguishable from cooling territory on the wire.
// Returns 0 when the room has no free number left. Caller holds r.mu.
func (r *Room) allocPlayerNumLocked() uint16 {
	n := r.nextPlayerNum
	if n < 1 || n > maxPlayerNum {
		n = 1
	}
	for i := 0; i < int(maxPlayerNum); i++ {
		if r.players[n] == nil {
			next := n + 1
			if next > maxPlayerNum {
				next = 1
			}
			r.nextPlayerNum = next
			return n
		}
		n++
		if n > maxPlayerNum {
			n = 1
		}
	}
	return 0
}

func (r *Room) allocUniqueHue() uint16 {
	total := 360 * len(colorVariants)
	if total <= 0 {
		return uint16(r.randInt(0, 359))
	}

	minHue := 26
	avg := 360 / maxInt(1, len(r.players)+1)
	if avg < minHue {
		minHue = maxInt(10, (avg*3)/4)
	}

	start := 0
	if total > 1 {
		start = r.randInt(0, total-1)
	}

	best := uint16(start)
	bestMinDist := -1
	bestStrict := uint16(start)
	bestStrictMinDist := -1

	for i := 0; i < total; i++ {
		code := uint16((start + i) % total)
		h, _, _ := colorCodeToHSL(code)
		minDist := 1 << 30
		ok := true
		strictOk := true
		for _, p := range r.players {
			if p.hue == code {
				ok = false
				break
			}
			ph, _, _ := colorCodeToHSL(p.hue)
			if hueDistance(ph, h) < minHue {
				strictOk = false
			}
			d := colorDistance(p.hue, code)
			if d < minDist {
				minDist = d
				if minDist <= bestMinDist {
					break
				}
			}
		}
		if !ok {
			continue
		}
		if minDist > bestMinDist {
			bestMinDist = minDist
			best = code
		}
		if strictOk {
			if minDist > bestStrictMinDist {
				bestStrictMinDist = minDist
				bestStrict = code
			}
		}
	}
	if bestStrictMinDist >= 0 {
		return bestStrict
	}
	return best
}
