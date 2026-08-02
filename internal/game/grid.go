// grid.go holds the territory grid: cell ownership and trail writes, the
// flood-fill capture, and the post-death "cooling" territory that a player can
// reclaim.
package game

import (
	"sync"

	"snakes/internal/metrics"
	"snakes/internal/profiles"
)

// Скратч заливки: две карты размером с поле, которые capture берёт и
// возвращает на каждом захвате. Без пула каждый захват территории стоил бы
// 28000 байт и 28000 int мусора.
// Пулы хранят УКАЗАТЕЛИ на срезы, а не срезы: sync.Pool.Put принимает any, и
// срез при укладке боксится в интерфейс, то есть каждый Put сам аллоцирует
// (staticcheck SA6002). Для capture(), которая по профилю занимает около 5%
// CPU, это ровно та аллокация, ради устранения которой пул и заводили.
var floodBytesPool = sync.Pool{New: func() any { s := make([]byte, N); return &s }}
var floodIntPool = sync.Pool{New: func() any { s := make([]int, N); return &s }}

func (r *Room) bonusTerritory(num uint16, cx, cy int, rad int) {
	if rad <= 0 {
		return
	}
	p := r.players[num]
	if p == nil || !p.alive {
		return
	}
	budget := int(p.bonusBudget)
	if budget <= 0 {
		return
	}
	for dy := -rad; dy <= rad; dy++ {
		for dx := -rad; dx <= rad; dx++ {
			x := cx + dx
			y := cy + dy
			if !inBounds(x, y) {
				continue
			}
			i := r.idx(x, y)
			if r.gridOwner[i] == num && r.trailOwner[i] == 0 {
				continue
			}
			if budget <= 0 {
				break
			}
			budget--
			r.setGrid(i, num)
			r.setTrail(i, 0)
		}
		if budget <= 0 {
			break
		}
	}
	p.bonusBudget = uint16(maxInt(0, minInt(BonusBudgetMax, budget)))
}

// F5 "Reclaim" tunables.
const (
	// ReclaimTicks: 150 ticks == 15s at 100ms per tick.
	// G22: at 200 ticks (20s) death cost nothing — the whole estate was still
	// waiting when the player got back, and the logs showed single reclaims of
	// +1556 and +2745 cells.
	// G3: at 120 ticks combined with the spawn penalty the mechanic fired
	// literally zero times in three measured matches (mean distance from the
	// respawn cell to the patch was 94 cells). The window is back up to 15s and
	// the anti-refund job moved to ReclaimReturnPercent, which is a much more
	// honest brake: coming back is possible, but it is never a full undo.
	ReclaimTicks = 150
	// ReclaimReturnPercent: how much of the connected cooling patch a reclaim
	// gives back, in percent, nearest cells first. The rest is lost for good,
	// so dying always costs territory even when the run home succeeds.
	ReclaimReturnPercent = 55
	// ReclaimExpireBudget bounds how many cells the expiry queue retires per
	// tick, so a huge estate can never stall a tick.
	ReclaimExpireBudget = 1024
	// coolOwnerFlag marks a grid value on the wire as "cooling territory of
	// player (value &^ coolOwnerFlag)". Player numbers are allocated strictly
	// below it (see maxPlayerNum / allocPlayerNumLocked), so a live owner can
	// never be mistaken for cooling territory.
	coolOwnerFlag = uint16(0x8000)
	// maxPlayerNum is the highest number a player may be given. It must stay
	// below coolOwnerFlag.
	maxPlayerNum = coolOwnerFlag - 1

	// Bot reclaim (aiMode 5) tunables. The scan is a strided sweep of the
	// bot's own ROI, so it stays far cheaper than the hunt scan.
	BotReclaimScanEvery = 7 // ticks between scans
	BotReclaimStride    = 2 // ROI sampling stride
	// BotReclaimMaxSteps: BFS budget to the patch. G3 raised it from 26 — with
	// the old respawn penalty the branch was dead code, no bot ever found a
	// patch inside 26 steps after dying.
	BotReclaimMaxSteps = 34
	// A detour is only worth it if the patch still exists on arrival.
	BotReclaimTimeMargin = 6
	// Bots do not abandon a long trail for a reclaim; that trade is bad.
	BotReclaimMaxTrail = 6

	// spawnCoolBonusCap bounds the respawn attraction to a player's own cooling
	// patch (G3). The disc scanned by pickSpawnCell holds ~317 cells, so an
	// uncapped bonus would outweigh every other term and pin every respawn to
	// the centre of the old estate.
	spawnCoolBonusCap = 120
)

// coolBatch is one death's worth of cooling cells, retired together.
type coolBatch struct {
	until uint32
	owner uint16
	cells []int
}

// hasCoolingCellsLocked reports whether a player may still have reclaimable
// cells on the map. It is deliberately conservative — a batch whose cells were
// all overtaken still counts — because the only caller uses it to decide
// whether the name label is still needed, and keeping a name one batch too
// long is harmless while dropping it too early is visible.
func (r *Room) hasCoolingCellsLocked(num uint16) bool {
	if num == 0 {
		return false
	}
	for _, b := range r.coolBatches {
		if b.owner == num && b.until > r.tick {
			return true
		}
	}
	return false
}

// coolWireAt returns the grid value to put on the wire for an unowned cell:
// coolOwnerFlag|owner while the cell is still reclaimable, 0 otherwise.
func (r *Room) coolWireAt(i int) uint16 {
	if r.coolOwner == nil || i < 0 || i >= len(r.coolOwner) {
		return 0
	}
	if r.coolOwner[i] == 0 || r.coolUntil[i] <= r.tick {
		return 0
	}
	return coolOwnerFlag | r.coolOwner[i]
}

// gridWireAt is the grid value clients receive for a cell.
func (r *Room) gridWireAt(i int) uint16 {
	if v := r.gridOwner[i]; v != 0 {
		return v
	}
	return r.coolWireAt(i)
}

// clearCoolCell drops the cooling state of a cell without emitting a change:
// the caller is about to write a real owner into it.
func (r *Room) clearCoolCell(i int) {
	if r.coolOwner == nil || i < 0 || i >= len(r.coolOwner) {
		return
	}
	r.coolOwner[i] = 0
	r.coolUntil[i] = 0
}

// expireCoolCell retires one cooling cell and tells the clients it is gone.
func (r *Room) expireCoolCell(i int) {
	if r.coolOwner[i] == 0 {
		return
	}
	r.coolOwner[i] = 0
	r.coolUntil[i] = 0
	if r.gridOwner[i] != 0 {
		return
	}
	r.gridStamp[i] = r.tick
	r.changedGrid = append(r.changedGrid, packChange(uint16(i), 0))
	r.minimapGrid = append(r.minimapGrid, packChange(uint16(i), 0))
	if len(r.minimapGrid) > MinimapMaxChanges {
		r.minimapDirty = true
	}
}

// stepCoolExpiry retires due batches with a fixed per-tick budget.
// Caller holds r.mu.
func (r *Room) stepCoolExpiry() {
	if r.coolOwner == nil {
		return
	}
	budget := ReclaimExpireBudget
	for budget > 0 && len(r.coolBatches) > 0 {
		b := r.coolBatches[0]
		if b.until > r.tick {
			// Batches are appended in deadline order, so the head gates the rest.
			return
		}
		for r.coolCursor < len(b.cells) && budget > 0 {
			i := b.cells[r.coolCursor]
			r.coolCursor++
			budget--
			if i < 0 || i >= N {
				continue
			}
			// Skip cells that were reclaimed, retaken, or re-cooled later.
			if r.coolOwner[i] == 0 || r.coolUntil[i] > r.tick {
				continue
			}
			r.expireCoolCell(i)
		}
		if r.coolCursor < len(b.cells) {
			return
		}
		r.coolBatches[0].cells = nil
		r.coolBatches = r.coolBatches[1:]
		r.coolCursor = 0
	}
}

// reclaimCoolRegion gives part of the connected patch of cooling cells that
// touch `start` back to its former owner. Returns the number of cells restored.
//
// G3: only ReclaimReturnPercent of the patch comes back, and the walk is a
// breadth-first one so the cells that are returned are the ones nearest to the
// point of re-entry — a compact blob around the player, not a random spray.
// The remainder is dropped: that is what keeps death expensive now that the
// respawn no longer runs away from the patch.
func (r *Room) reclaimCoolRegion(p *Player, start int) int {
	if p == nil || r.coolOwner == nil {
		return 0
	}
	if start < 0 || start >= N || r.coolOwner[start] != p.num || r.coolUntil[start] <= r.tick {
		return 0
	}
	q := r.bfsQ[:0]
	q = append(q, start)
	r.clearCoolCell(start)
	push := func(j int) {
		if j < 0 || j >= N {
			return
		}
		if r.coolOwner[j] != p.num || r.coolUntil[j] <= r.tick {
			return
		}
		r.clearCoolCell(j)
		q = append(q, j)
	}
	for head := 0; head < len(q); head++ {
		i := q[head]
		x := i % W
		y := i / W
		if x > 0 {
			push(i - 1)
		}
		if x < W-1 {
			push(i + 1)
		}
		if y > 0 {
			push(i - W)
		}
		if y < H-1 {
			push(i + W)
		}
	}
	n := len(q)
	keep := (n*ReclaimReturnPercent + 99) / 100
	if keep < 1 {
		keep = 1
	}
	if keep > n {
		keep = n
	}
	// Restore after the walk: setGrid clears the cooling flag itself and would
	// otherwise cut the patch in half mid-traversal.
	for k := 0; k < keep; k++ {
		r.setGrid(q[k], p.num)
	}
	r.bfsQ = q[:0]
	return keep
}

func (r *Room) setGrid(i int, owner uint16) {
	prev := r.gridOwner[i]
	if prev == owner {
		return
	}
	if prev != 0 {
		r.removeOwnedCell(prev, i)
	}
	r.gridOwner[i] = owner
	if owner != 0 {
		// A real owner always wins over a cooling claim.
		r.clearCoolCell(i)
	}
	wire := owner
	if owner == 0 {
		wire = r.coolWireAt(i)
	}
	r.gridStamp[i] = r.tick
	r.changedGrid = append(r.changedGrid, packChange(uint16(i), wire))
	r.minimapGrid = append(r.minimapGrid, packChange(uint16(i), wire))
	if len(r.minimapGrid) > MinimapMaxChanges {
		r.minimapDirty = true
	}
	if prev != 0 {
		if v := r.scores[prev]; v > 0 {
			r.scores[prev] = v - 1
		}
	}
	if owner != 0 {
		v := r.scores[owner] + 1
		r.scores[owner] = v
		// F3: remember the high-water mark, the final-tick snapshot alone is a
		// bad summary of a match.
		if o := r.players[owner]; o != nil && v > o.peakCells {
			o.peakCells = v
		}
		r.addOwnedCell(owner, i)
	}
}

func (r *Room) setTrail(i int, owner uint16) {
	prev := r.trailOwner[i]
	if prev == owner {
		return
	}
	r.trailOwner[i] = owner
	r.trailStamp[i] = r.tick
	r.changedTrail = append(r.changedTrail, packChange(uint16(i), owner))
}

func (r *Room) addOwnedCell(num uint16, i int) {
	if i < 0 || i >= N {
		return
	}
	if r.gridPos[i] != 0 {
		return
	}
	p := r.players[num]
	if p == nil {
		return
	}
	p.owned = append(p.owned, i)
	r.gridPos[i] = int32(len(p.owned))
}

func (r *Room) removeOwnedCell(num uint16, i int) {
	if i < 0 || i >= N {
		return
	}
	pos := r.gridPos[i]
	if pos == 0 {
		return
	}
	p := r.players[num]
	if p == nil {
		r.gridPos[i] = 0
		return
	}
	idx := int(pos - 1)
	lastIdx := len(p.owned) - 1
	if idx < 0 || idx > lastIdx {
		r.gridPos[i] = 0
		return
	}
	lastCell := p.owned[lastIdx]
	p.owned[idx] = lastCell
	p.owned = p.owned[:lastIdx]
	r.gridPos[i] = 0
	if lastCell != i {
		r.gridPos[lastCell] = int32(idx + 1)
	}
}

// clearPlayerCells wipes a player's territory and trail. On death the cells go
// into the reclaim cooldown instead of vanishing (F5); when the player leaves
// the room for good they are dropped immediately.
func (r *Room) clearPlayerCells(num uint16, p *Player) {
	r.clearPlayerCellsCooling(num, p, true)
}

func (r *Room) clearPlayerCellsCooling(num uint16, p *Player, cool bool) {
	cool = cool && r.coolOwner != nil && num != 0
	var batch []int
	if cool && len(p.owned) > 0 {
		batch = make([]int, 0, len(p.owned))
	}
	until := r.tick + ReclaimTicks
	for len(p.owned) > 0 {
		i := p.owned[len(p.owned)-1]
		if cool {
			// Set before setGrid: the emitted change then already carries the
			// cooling value, so one delta entry per cell is enough.
			r.coolOwner[i] = num
			r.coolUntil[i] = until
			batch = append(batch, i)
		} else if r.coolOwner != nil {
			r.clearCoolCell(i)
		}
		r.setGrid(i, 0)
	}
	if len(batch) > 0 {
		r.coolBatches = append(r.coolBatches, coolBatch{until: until, owner: num, cells: batch})
		// F5: tell clients when this batch expires so they can fade the cells
		// out instead of only knowing "cooling / not cooling".
		cells := uint16(len(batch))
		if len(batch) > int(^uint16(0)) {
			cells = ^uint16(0)
		}
		r.pushEvent(Event{Kind: EventCoolBatch, A: num, B: cells, C: until})
	}
	for len(p.trail) > 0 {
		i := p.trail[len(p.trail)-1]
		p.trail = p.trail[:len(p.trail)-1]
		if i >= 0 && i < N && r.trailOwner[i] == num {
			r.setTrail(i, 0)
		}
	}
}

func (r *Room) idx(x, y int) int {
	return y*W + x
}

func inBounds(x, y int) bool {
	return x >= 0 && x < W && y >= 0 && y < H
}

func (r *Room) measureTerritoryShape(num uint16, p *Player) (area int, bboxW int, bboxH int, density float64, perimeter int) {
	if p == nil {
		return 0, 0, 0, 0, 0
	}
	area = len(p.owned)
	if area == 0 {
		return 0, 0, 0, 0, 0
	}

	minX := W
	minY := H
	maxX := -1
	maxY := -1
	for _, cell := range p.owned {
		x := cell % W
		y := cell / W
		if x < minX {
			minX = x
		}
		if y < minY {
			minY = y
		}
		if x > maxX {
			maxX = x
		}
		if y > maxY {
			maxY = y
		}
	}
	if maxX < minX || maxY < minY {
		return area, 0, 0, 0, 0
	}
	bboxW = maxX - minX + 1
	bboxH = maxY - minY + 1
	bboxArea := bboxW * bboxH
	if bboxArea > 0 {
		density = float64(area) / float64(bboxArea)
	}

	per := 0
	for _, cell := range p.owned {
		x := cell % W
		y := cell / W
		if x <= 0 || r.gridOwner[cell-1] != num {
			per++
		}
		if x >= W-1 || r.gridOwner[cell+1] != num {
			per++
		}
		if y <= 0 || r.gridOwner[cell-W] != num {
			per++
		}
		if y >= H-1 || r.gridOwner[cell+W] != num {
			per++
		}
	}
	perimeter = per
	return area, bboxW, bboxH, density, perimeter
}

func (r *Room) floodFillOutside(blocked []byte, outside []byte, q []int) []byte {
	qs := 0
	qe := 0

	push := func(i int) {
		if outside[i] != 0 {
			return
		}
		if blocked[i] != 0 {
			return
		}
		outside[i] = 1
		q[qe] = i
		qe++
	}

	for x := 0; x < W; x++ {
		push(r.idx(x, 0))
		push(r.idx(x, H-1))
	}
	for y := 0; y < H; y++ {
		push(r.idx(0, y))
		push(r.idx(W-1, y))
	}

	for qs < qe {
		i := q[qs]
		qs++
		x := i % W
		y := i / W
		if x > 0 {
			push(i - 1)
		}
		if x+1 < W {
			push(i + 1)
		}
		if y > 0 {
			push(i - W)
		}
		if y+1 < H {
			push(i + W)
		}
	}

	return outside
}

func (r *Room) capture(playerNum uint16) {
	// Пулы отдают *[]T: класть в sync.Pool сам срез значит аллоцировать на
	// каждом Put (SA6002), а capture() — горячий путь.
	blockedP := floodBytesPool.Get().(*[]byte)
	if len(*blockedP) != N {
		*blockedP = make([]byte, N)
	}
	outsideP := floodBytesPool.Get().(*[]byte)
	if len(*outsideP) != N {
		*outsideP = make([]byte, N)
	}
	qP := floodIntPool.Get().(*[]int)
	if len(*qP) != N {
		*qP = make([]int, N)
	}
	defer floodBytesPool.Put(blockedP)
	defer floodBytesPool.Put(outsideP)
	defer floodIntPool.Put(qP)
	blocked := *blockedP
	outside := *outsideP
	q := *qP

	for i := 0; i < N; i++ {
		blocked[i] = 0
		outside[i] = 0
		if r.gridOwner[i] == playerNum || r.trailOwner[i] == playerNum {
			blocked[i] = 1
		}
	}
	outside = r.floodFillOutside(blocked, outside, q)

	// The owned-cell snapshot MUST be taken before the fill below: that loop
	// already hands the enclosed interior to the player, so a snapshot taken
	// after it made `delta` equal the trail length instead of the captured
	// area. Everything downstream (the "+N" popup, capturePoints and the Style
	// payout) is specified in area, so the whole capture reward was being
	// computed from the perimeter — a 12x12 loop (area 144, perimeter 44) paid
	// capturePoints(44)=5 instead of capturePoints(144)=14. Because points then
	// grew as L^0.75 against a cost of L ticks, income per tick FELL as loops
	// got bigger, which is exactly the nibbling incentive CaptureMinCells was
	// added to kill.
	p := r.players[playerNum]
	ownedBefore := 0
	if p != nil {
		ownedBefore = len(p.owned)
	}

	for i := 0; i < N; i++ {
		if blocked[i] == 0 && outside[i] == 0 {
			r.setGrid(i, playerNum)
			r.setTrail(i, 0)
		}
	}

	if p != nil {
		trailLen := len(p.trail)
		for _, i := range p.trail {
			r.setGrid(i, playerNum)
			r.setTrail(i, 0)
		}
		p.trail = p.trail[:0]
		r.ensureContract(p)
		if p.contractType == ContractCapture {
			r.addContractProgress(p, uint16(trailLen))
		}
		if !p.bot {
			r.addDailyProgress(p, DailyCapture, uint16(trailLen))
			// TotalCapture was declared but never fed; the capture achievements
			// need it.
			if pr := profiles.ForKeyCreate(p.profileKey); pr != nil && trailLen > 0 {
				profiles.Mu.Lock()
				if pr.TotalCapture < ^uint32(0)-uint32(trailLen) {
					pr.TotalCapture += uint32(trailLen)
				} else {
					pr.TotalCapture = ^uint32(0)
				}
				achvCount := r.checkAchievementsLocked(p, pr)
				profiles.Mu.Unlock()
				profiles.MarkDirty()
				r.grantAchievementRewards(p, achvCount)
			}
		}
		ownedAfter := len(p.owned)
		if ownedAfter > ownedBefore {
			delta := ownedAfter - ownedBefore
			x := uint16(0)
			y := uint16(0)
			if inBounds(p.x, p.y) {
				x = uint16(p.x)
				y = uint16(p.y)
			}
			actor := metrics.ActorLabel(p.bot)
			metrics.LoopsClosedTotal.Inc(actor)
			metrics.CellsCapturedTotal.Add(actor, uint64(delta))
			r.pushEvent(Event{Kind: EventCapture, A: p.num, X: x, Y: y, C: uint32(delta), D: p.cosCaptureFx})
			r.awardPoints(p.num, capturePoints(delta, r.matchPhase(), r.mutatorType), PointsCapture)

			// E2: territory finally feeds the meta. Without this the optimal
			// strategy was to ignore the map and farm bot tails.
			//
			// G1: the old `if gain == 0 { gain = 1 }` paid a full Style for a
			// 2-cell nibble, i.e. 35x the honest rate, and let a twitching
			// script hit the 70/70 match ceiling in 20-30 seconds. The rate is
			// now exactly delta/StyleCaptureCellsPer with no floor; the
			// remainder is carried in styleCaptureAcc so that a player who
			// keeps making 60-cell loops is paid the same as one making 600s
			// and nothing is silently rounded away.
			//
			// A capture below CaptureMinCells pays nothing at all — the same
			// rule as the match points above, so a nibbler cannot dodge it by
			// switching from points to the meta currency.
			if delta >= CaptureMinCells {
				p.styleCaptureAcc += uint32(delta)
			}
			if gain := uint16(p.styleCaptureAcc / StyleCaptureCellsPer); gain > 0 {
				p.styleCaptureAcc -= uint32(gain) * StyleCaptureCellsPer
				r.addStyleCapped(p, gain, StyleCapture, &p.styleCaptureMatch, StyleCaptureMatchCap)
			}
		}
		if r.mutatorType == MutatorDoubleCapture {
			r.bonusTerritory(playerNum, p.x, p.y, 1)
		}
	}
}
