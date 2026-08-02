// bot_ai.go holds the bot brain: sensing, pathfinding, expansion planning,
// hunting, the per-archetype personalities and the bot population manager.
package game

import (
	"snakes/internal/botnames"
	"snakes/internal/metrics"
)

// recentAt returns the position `back` steps ago from the anti-loop ring.
func (p *Player) recentAt(back int) (int, int, bool) {
	if back < 0 || back >= int(p.aiRecentN) || back >= aiRecentCap {
		return 0, 0, false
	}
	idx := int(p.aiRecentI) - 1 - back
	for idx < 0 {
		idx += aiRecentCap
	}
	idx %= aiRecentCap
	return p.aiRecentX[idx], p.aiRecentY[idx], true
}

// inPositionCycle detects a repeating path of period 2, 4 or 6. The old check
// only caught A-B-A-B, so bots could orbit their own territory forever (G13).
func (p *Player) inPositionCycle() bool {
	for _, k := range [3]int{2, 4, 6} {
		if int(p.aiRecentN) < 2*k {
			continue
		}
		x0, y0, ok0 := p.recentAt(0)
		if !ok0 {
			continue
		}
		match := true
		distinct := false
		for j := 0; j < k; j++ {
			xa, ya, oka := p.recentAt(j)
			xb, yb, okb := p.recentAt(j + k)
			if !oka || !okb || xa != xb || ya != yb {
				match = false
				break
			}
			if xa != x0 || ya != y0 {
				distinct = true
			}
		}
		if match && distinct {
			return true
		}
	}
	return false
}

func (r *Room) botPickDirOutside(p *Player) (Dir, bool) {
	if p == nil || !p.alive {
		return DirUp, false
	}
	cur := p.dir
	if p.pendingDir != p.dir && !isOpposite(p.dir, p.pendingDir) {
		cur = p.pendingDir
	}
	best := cur
	bestScore := int32(-1 << 30)
	found := false
	cands := []Dir{cur, turnLeft(cur), turnRight(cur)}
	for pass := 0; pass < 2; pass++ {
		for _, d := range cands {
			if pass == 0 && isOpposite(cur, d) {
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
			if d == cur {
				score += 4
			}
			if r.gridOwner[i] == p.num {
				score += 180
			}
			// G6: an unshielded enemy trail one step away is a free kill.
			// Bots used to swerve away from it, which read as stupidity.
			score += r.freeKillBonus(p, i)
			if r.lookaheadBad(p, d, 5, 0) {
				score -= 240
			}
			if pen := r.recentPenalty(p, nx, ny); pen > 0 {
				score -= pen * 3
			}

			open := 0
			ownAdj := 0
			if nx > 0 {
				to := r.trailOwner[i-1]
				if to == 0 {
					open++
				} else if to == p.num {
					ownAdj++
				}
			}
			if nx < W-1 {
				to := r.trailOwner[i+1]
				if to == 0 {
					open++
				} else if to == p.num {
					ownAdj++
				}
			}
			if ny > 0 {
				to := r.trailOwner[i-W]
				if to == 0 {
					open++
				} else if to == p.num {
					ownAdj++
				}
			}
			if ny < H-1 {
				to := r.trailOwner[i+W]
				if to == 0 {
					open++
				} else if to == p.num {
					ownAdj++
				}
			}
			score += int32(open * 14)
			score -= int32(ownAdj * 22)

			ret := r.estimateReturnSteps(p.num, nx, ny)
			score -= int32(ret * 10)
			if score > bestScore {
				bestScore = score
				best = d
				found = true
			}
		}
		if found {
			break
		}
		cands = []Dir{cur, turnLeft(cur), turnRight(cur), turnLeft(turnLeft(cur))}
	}
	if !found {
		return cur, false
	}
	return best, true
}

// aiRecentCap — глубина кольца недавних клеток головы. По нему бот ловит себя
// на кружении по одному и тому же пятачку.
const aiRecentCap = 12

const (
	BotCount = 14
	// BotCountMin is the floor for the dynamic bot population (G7). Bots are
	// removed as humans join so a full room does not turn into a mob.
	BotCountMin = 4
)

const (
	// G8: respawn is slow enough to feel like a real loss, and gets slower for
	// a bot that keeps feeding the same player.
	BotRespawnDelayMin    = 25
	BotRespawnDelayMax    = 45
	BotRespawnDeathWindow = 300
	BotRespawnDeathStep   = 10
	BotRespawnDelayCap    = 80
	// aiDeathCap bounds the per-bot recent-death ring used for the progression.
	aiDeathCap = 8
)

// Difficulty tiers (G3). A room always holds a fixed mix so a player meets
// pushovers and real threats in the same match.
const (
	TierEasy uint8 = iota
	TierNormal
	TierHard
	TierCount
)

// Behaviour archetypes (G4). Each one is meant to be recognisable from the
// outside after a few seconds of watching.
const (
	ArchFarmer uint8 = iota
	ArchAggressor
	ArchCoward
	ArchTerritorial
	ArchCount
)

// tierMix / archMix are the target compositions, expressed as weights over
// BotCount. They are scaled with largest-remainder for smaller populations.
var (
	tierMix = [TierCount]int{5, 6, 3}
	// G21: only the Aggressor archetype could actually give chase (the Farmer
	// needed dist<=2, the Coward dist<=6, the Territorial its own land), so
	// 4 of 14 bots carried all the pressure. One Farmer slot moves over.
	archMix = [ArchCount]int{3, 5, 3, 3}
)

const (
	// Hunter caps per victim (G2). G21: the human cap used to be tighter than
	// the bot one, which made the human the safest creature on the map
	// (~0.5 deaths per match against ~2.4 for a bot). They are level now.
	HuntCapHuman = 3
	HuntCapBot   = 3

	// G14: windup before a hunt actually starts. The bot drives straight at
	// the target for a few ticks, which is the player's cue to react.
	HuntWindupMin = 3
	HuntWindupMax = 5

	// G17: tryHunt is the most expensive part of a bot tick, so it only runs
	// every few ticks and only over a bounded number of BFS probes.
	// G21: 5 ticks (half a second) let a player walk straight past a bot
	// between two scans; 3 keeps the cost bounded and the reaction visible.
	BotHuntScanEvery = 3
	BotHuntMaxProbes = 40

	// S4: the trail budget ceiling. Everyone shares BotTrailBudgetCap; the
	// Farmer alone is allowed past it, which is what makes its loops visibly
	// longer than everyone else's. The ceiling is deliberately modest: past
	// ~30 the extra length is paid for entirely in trail_cut deaths and the
	// held territory goes DOWN, which is the trap the first attempt fell into.
	BotTrailBudgetCap       = 26
	BotTrailBudgetCapFarmer = 30
	// BotCloseFrac* is the fraction of the budget at which a bot starts
	// heading home. The Farmer runs almost the whole budget before turning
	// back; the rest keep the tuned micro-loop behaviour.
	BotCloseFracDefault = 0.72
	BotCloseFracFarmer  = 0.88
)

func (r *Room) freeSpaceScoreAt(pnum uint16, cx, cy int, rad int) int {
	if rad <= 0 {
		return 0
	}
	x0 := cx - rad
	y0 := cy - rad
	x1 := cx + rad
	y1 := cy + rad
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
	free := 0
	r2 := rad * rad
	for yy := y0; yy <= y1; yy++ {
		row := yy * W
		dy := yy - cy
		for xx := x0; xx <= x1; xx++ {
			dx := xx - cx
			if dx*dx+dy*dy > r2 {
				continue
			}
			i := row + xx
			if r.trailOwner[i] != 0 {
				continue
			}
			goi := r.gridOwner[i]
			if goi != 0 {
				continue
			}
			free++
		}
	}
	return free
}

func (r *Room) boundaryFreeSpace(p *Player, cell int, rad int) int {
	if p == nil {
		return 0
	}
	x := cell % W
	y := cell / W
	best := 0
	if x > 0 {
		i := cell - 1
		if r.gridOwner[i] != p.num && r.trailOwner[i] == 0 {
			v := r.freeSpaceScoreAt(p.num, x-1, y, rad)
			if v > best {
				best = v
			}
		}
	}
	if x < W-1 {
		i := cell + 1
		if r.gridOwner[i] != p.num && r.trailOwner[i] == 0 {
			v := r.freeSpaceScoreAt(p.num, x+1, y, rad)
			if v > best {
				best = v
			}
		}
	}
	if y > 0 {
		i := cell - W
		if r.gridOwner[i] != p.num && r.trailOwner[i] == 0 {
			v := r.freeSpaceScoreAt(p.num, x, y-1, rad)
			if v > best {
				best = v
			}
		}
	}
	if y < H-1 {
		i := cell + W
		if r.gridOwner[i] != p.num && r.trailOwner[i] == 0 {
			v := r.freeSpaceScoreAt(p.num, x, y+1, rad)
			if v > best {
				best = v
			}
		}
	}
	return best
}

func (r *Room) pickCloseGateCell(p *Player) (int, bool) {
	if p == nil || len(p.trail) == 0 || len(p.owned) == 0 {
		return -1, false
	}
	minCut := r.worstCaseCutDistToTrail(p, 40)
	tries := 80
	if len(p.owned) < tries {
		tries = len(p.owned)
	}
	bestI := -1
	bestScore := int32(-1 << 30)
	for t := 0; t < tries; t++ {
		cell := p.owned[r.rng.Intn(len(p.owned))]
		x := cell % W
		y := cell / W
		// boundary-ish owned cell
		border := false
		ownAdj := 0
		if x > 0 {
			if r.gridOwner[cell-1] != p.num {
				border = true
			} else {
				ownAdj++
			}
		}
		if x < W-1 {
			if r.gridOwner[cell+1] != p.num {
				border = true
			} else {
				ownAdj++
			}
		}
		if y > 0 {
			if r.gridOwner[cell-W] != p.num {
				border = true
			} else {
				ownAdj++
			}
		}
		if y < H-1 {
			if r.gridOwner[cell+W] != p.num {
				border = true
			} else {
				ownAdj++
			}
		}
		if !border {
			continue
		}

		dist := r.bfsToCell(p.x, p.y, cell, 0, 36)
		if dist >= 9999 {
			continue
		}
		safety := minCut - dist
		free := r.boundaryFreeSpace(p, cell, 7)
		dh := 0
		if p.homeX >= 0 && p.homeY >= 0 {
			dh = manhattan(x, y, p.homeX, p.homeY)
		}
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

		sc := int32(0)
		sc -= int32(dist * 18)
		sc += int32(ownAdj * 14)
		sc += int32(free / 10)
		sc -= int32(dh)
		if bd <= 1 {
			sc -= 140
		} else if bd == 2 {
			sc -= 40
		}
		if safety < 0 {
			sc -= int32(260 + (-safety)*55)
		} else {
			sc += int32(safety * 28)
		}
		if sc > bestScore {
			bestScore = sc
			bestI = cell
		}
	}
	if bestI >= 0 {
		return bestI, true
	}
	return -1, false
}

func (r *Room) recordRecentPos(p *Player, x, y int) {
	if p == nil {
		return
	}
	idx := int(p.aiRecentI)
	if idx >= aiRecentCap {
		idx = idx % aiRecentCap
	}
	p.aiRecentX[idx] = x
	p.aiRecentY[idx] = y
	if p.aiRecentN < aiRecentCap {
		p.aiRecentN++
	}
	p.aiRecentI = uint8((idx + 1) % aiRecentCap)
}

func (r *Room) recentPenalty(p *Player, x, y int) int32 {
	if p == nil {
		return 0
	}
	n := int(p.aiRecentN)
	if n <= 0 {
		return 0
	}
	maxCheck := 8
	if n < maxCheck {
		maxCheck = n
	}
	for j := 0; j < maxCheck; j++ {
		idx := int(p.aiRecentI) - 1 - j
		for idx < 0 {
			idx += aiRecentCap
		}
		idx = idx % aiRecentCap
		if p.aiRecentX[idx] == x && p.aiRecentY[idx] == y {
			return int32(70 - j*8)
		}
	}
	return 0
}

func (r *Room) predictedNextCell(o *Player) (int, int, bool) {
	if o == nil || !o.alive {
		return 0, 0, false
	}
	// G10: read the committed direction, never pendingDir. pendingDir already
	// holds this tick's network input, and bots run before stepPlayer, which
	// let them react to a human turn before it happened.
	dx, dy := dirToDelta(o.dir)
	nx := o.x + dx
	ny := o.y + dy
	if !inBounds(nx, ny) {
		return 0, 0, false
	}
	return nx, ny, true
}

func (r *Room) worstCaseCutDistToTrail(p *Player, maxTrailCells int) int {
	if p == nil || len(p.trail) == 0 {
		return 9999
	}
	k := maxTrailCells
	if len(p.trail) < k {
		k = len(p.trail)
	}
	if k <= 0 {
		return 9999
	}
	minCut := 9999
	// G9: only enemies the bot can actually see may scare it off a loop.
	minX, minY, maxX, maxY := r.botROIBounds(p)
	for _, o := range r.players {
		if o == nil || !o.alive || o.num == p.num {
			continue
		}
		if o.x < minX || o.x >= maxX || o.y < minY || o.y >= maxY {
			continue
		}
		vx0 := o.x
		vy0 := o.y
		for t := 0; t < 5; t++ {
			vx := vx0
			vy := vy0
			if t > 0 {
				dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
				dd := dirs[t-1]
				dx, dy := dirToDelta(dd)
				nx := vx0 + dx
				ny := vy0 + dy
				if inBounds(nx, ny) {
					vx = nx
					vy = ny
				}
			}
			for i := len(p.trail) - 1; i >= 0 && i >= len(p.trail)-k; i-- {
				cell := p.trail[i]
				xx := cell % W
				yy := cell / W
				d := manhattan(vx, vy, xx, yy)
				if d < minCut {
					minCut = d
					if minCut <= 1 {
						return minCut
					}
				}
			}
		}
	}
	return minCut
}

func (r *Room) minDistToTrailVirtual(p *Player, ex, ey int, x1, y1 int, include1 bool, x2, y2 int, include2 bool, maxTrailCells int) int {
	minD := 9999
	if p == nil {
		return minD
	}
	k := maxTrailCells
	if len(p.trail) < k {
		k = len(p.trail)
	}
	for i := len(p.trail) - 1; i >= 0 && i >= len(p.trail)-k; i-- {
		cell := p.trail[i]
		xx := cell % W
		yy := cell / W
		d := manhattan(ex, ey, xx, yy)
		if d < minD {
			minD = d
			if minD <= 1 {
				return minD
			}
		}
	}
	if include1 {
		d := manhattan(ex, ey, x1, y1)
		if d < minD {
			minD = d
			if minD <= 1 {
				return minD
			}
		}
	}
	if include2 {
		d := manhattan(ex, ey, x2, y2)
		if d < minD {
			minD = d
		}
	}
	return minD
}

func (r *Room) minimaxOutsideDir(p *Player) (Dir, bool) {
	if p == nil || !p.alive {
		return p.dir, false
	}
	if len(p.trail) == 0 {
		return p.dir, false
	}
	if p.aiBaitSense < 0.05 {
		p.aiBaitSense = 0.05
	}
	if p.aiRiskiness < 0 {
		p.aiRiskiness = 0
	} else if p.aiRiskiness > 1 {
		p.aiRiskiness = 1
	}
	trailLen := len(p.trail)
	budget := r.botTrailBudget(p, p.aiRiskiness, p.aiCaution)

	rw, rh := p.botROI()
	rx := p.x - rw/2
	ry := p.y - rh/2
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
	minX := rx
	minY := ry
	maxX := rx + rw
	maxY := ry + rh

	toOwned := r.pickDirToOwned(p)
	cands := []Dir{p.dir, turnLeft(p.dir), turnRight(p.dir), toOwned}
	best := p.dir
	bestScore := int32(-1 << 30)
	found := false

	for _, d0 := range cands {
		dx, dy := dirToDelta(d0)
		x1 := p.x + dx
		y1 := p.y + dy
		if !inBounds(x1, y1) {
			continue
		}
		i1 := r.idx(x1, y1)
		if r.trailOwner[i1] == p.num {
			continue
		}
		if r.lookaheadBad(p, d0, 2, 0) {
			continue
		}

		base := int32(0)
		owner := r.gridOwner[i1]
		if owner == 0 {
			base += 12
		} else if owner != p.num {
			base += 10
		} else {
			base += 4
		}
		if d0 == p.dir {
			base += 2
		}
		if pen := r.recentPenalty(p, x1, y1); pen > 0 {
			base -= pen * 2
		}
		bd := x1
		if y1 < bd {
			bd = y1
		}
		rd := (W - 1) - x1
		if rd < bd {
			bd = rd
		}
		dn := (H - 1) - y1
		if dn < bd {
			bd = dn
		}
		if bd == 0 {
			base -= 220
		} else if bd == 1 {
			base -= 70
		}

		close0 := r.estimateReturnSteps(p.num, p.x, p.y)
		close1 := r.estimateReturnSteps(p.num, x1, y1)
		include1 := r.gridOwner[i1] != p.num
		x2, y2 := x1, y1
		include2 := false
		close2 := close1
		if p.aiPredictDepth >= 2 {
			pp := *p
			pp.x = x1
			pp.y = y1
			pp.dir = d0
			pp.pendingDir = d0
			d1 := r.pickDirToOwned(&pp)
			dx2, dy2 := dirToDelta(d1)
			x2 = x1 + dx2
			y2 = y1 + dy2
			if inBounds(x2, y2) {
				i2 := r.idx(x2, y2)
				if r.trailOwner[i2] != p.num {
					close2 = r.estimateReturnSteps(p.num, x2, y2)
					include2 = r.gridOwner[i2] != p.num
				}
			}
		}

		minCut := 9999
		for _, o := range r.players {
			if o == nil || !o.alive || o.num == p.num {
				continue
			}
			if o.x < minX || o.x >= maxX || o.y < minY || o.y >= maxY {
				continue
			}
			vx0 := o.x
			vy0 := o.y
			bestForEnemy := 9999
			for t := 0; t < 5; t++ {
				vx := vx0
				vy := vy0
				if t > 0 {
					dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
					dd := dirs[t-1]
					dx, dy := dirToDelta(dd)
					nx := vx0 + dx
					ny := vy0 + dy
					if inBounds(nx, ny) {
						vx = nx
						vy = ny
					}
				}
				if r.trailOwner[r.idx(vx, vy)] == o.num {
					continue
				}
				dm := r.minDistToTrailVirtual(p, vx, vy, x1, y1, include1, x2, y2, include2, 40)
				if p.aiPredictDepth >= 2 {
					dm2 := dm - (close2 - close1)
					if dm2 < dm {
						dm = dm2
					}
				}
				if dm < bestForEnemy {
					bestForEnemy = dm
					if bestForEnemy <= 1 {
						break
					}
				}
			}
			if bestForEnemy < minCut {
				minCut = bestForEnemy
				if minCut <= 1 {
					break
				}
			}
		}
		if minCut == 9999 {
			minCut = 60
		}

		safety := minCut - close1
		margin := 1 + int(6*float32(p.aiBaitSense))
		riskPenalty := int32(0)
		if safety < -margin {
			riskPenalty += 260
		} else if safety < 0 {
			riskPenalty += int32(120 - safety*18)
		} else if safety <= margin {
			riskPenalty += int32((margin - safety) * 14)
		}
		riskPenalty = int32(float32(riskPenalty) * (0.55 + 0.55*(1.0-p.aiRiskiness)))

		// Prevent huge outside loops: if the trail is already long, heavily penalize moves
		// that do not decrease return distance.
		if trailLen >= budget {
			if close1 >= close0 {
				riskPenalty += int32(180 + (trailLen-budget)*8)
			}
			if r.gridOwner[i1] != p.num {
				riskPenalty += int32(60 + (trailLen-budget)*6)
			}
		}

		score := base - riskPenalty
		if score > bestScore {
			bestScore = score
			best = d0
			found = true
		}
	}
	return best, found
}

// mixTargets distributes n slots over weights using largest remainder, so a
// shrinking bot population keeps roughly the intended composition.
func mixTargets(weights []int, n int) []int {
	out := make([]int, len(weights))
	if n <= 0 {
		return out
	}
	total := 0
	for _, w := range weights {
		total += w
	}
	if total <= 0 {
		out[0] = n
		return out
	}
	rem := make([]int, len(weights))
	assigned := 0
	for i, w := range weights {
		v := n * w
		out[i] = v / total
		rem[i] = v % total
		assigned += out[i]
	}
	for assigned < n {
		bi := 0
		bv := -1
		for i := range weights {
			if rem[i] > bv {
				bv = rem[i]
				bi = i
			}
		}
		out[bi]++
		rem[bi] = -1
		assigned++
	}
	return out
}

// pickUnderfilled returns the slot whose current count trails its target by
// the most; ties go to the lowest index.
func pickUnderfilled(counts []int, targets []int) uint8 {
	bi := 0
	bd := -1 << 30
	for i := range targets {
		d := targets[i] - counts[i]
		if d > bd {
			bd = d
			bi = i
		}
	}
	return uint8(bi)
}

// botMixCountsLocked tallies the tiers and archetypes currently in the room.
func (r *Room) botMixCountsLocked() (tiers []int, archs []int, bots int) {
	tiers = make([]int, TierCount)
	archs = make([]int, ArchCount)
	for _, p := range r.players {
		if p == nil || !p.bot {
			continue
		}
		bots++
		if int(p.aiTier) < len(tiers) {
			tiers[p.aiTier]++
		}
		if int(p.aiArchetype) < len(archs) {
			archs[p.aiArchetype]++
		}
	}
	return tiers, archs, bots
}

// applyBotPersonality derives every per-bot knob from the tier and archetype.
// The tier fixes reaction speed, sight and prediction depth; the archetype
// fixes what the bot wants to do with them.
func (r *Room) applyBotPersonality(p *Player, tier uint8, arch uint8) {
	p.aiTier = tier
	p.aiArchetype = arch

	// Tier: reaction, sight, lookahead, willingness to chase a trail.
	var tierBudgetLo, tierBudgetHi int
	switch tier {
	case TierEasy:
		tierBudgetLo, tierBudgetHi = 6, 9
		p.aiCooldownMin, p.aiCooldownMax = 6, 9
		p.aiPredictDepth = 1
		p.aiROIW, p.aiROIH = 48, 34
		// G21: 0.25 made the five easy bots effectively pacifists.
		p.aiHuntGate = 0.40
	case TierHard:
		tierBudgetLo, tierBudgetHi = 18, 26
		p.aiCooldownMin, p.aiCooldownMax = 2, 2
		p.aiPredictDepth = uint8(2 + r.rng.Intn(2))
		p.aiROIW, p.aiROIH = ROIWidth, ROIHeight
		p.aiHuntGate = 1.0
	default:
		tier = TierNormal
		p.aiTier = TierNormal
		tierBudgetLo, tierBudgetHi = 10, 16
		p.aiCooldownMin, p.aiCooldownMax = 3, 5
		p.aiPredictDepth = uint8(1 + r.rng.Intn(2))
		p.aiROIW, p.aiROIH = ROIWidth, ROIHeight
		p.aiHuntGate = 0.65
	}

	// Archetype: temperament plus its own trail-length band. The tier then
	// picks where inside that band this particular bot sits, so a hard farmer
	// runs the longest loops of anyone.
	budgetLo, budgetHi := tierBudgetLo, tierBudgetHi
	farmer := false
	p.aiCloseFrac = BotCloseFracDefault
	p.aiBudgetCap = BotTrailBudgetCap
	switch arch {
	case ArchFarmer:
		// S4: the Farmer was supposed to be a fat, obvious target and was
		// instead the skinniest bot in the room, because its 18-26 band never
		// reached the map: the shared closeStart fraction shut the loop first.
		//
		// Territory is (land held) x (time alive) and a death wipes the land,
		// so simply lengthening the loops makes it WORSE. Measured over 16
		// sims x 4000 ticks with an honest autopilot in the room, a naive
		// budget of 30-44 with low caution gave 853 held cells against a
		// baseline of 1077, with deaths going 183 -> 190+ per batch.
		//
		// What works is longer loops PLUS the survival profile to finish
		// them: never chase, read bait better than anyone, keep a wide margin
		// on the way home. That lands the average loop at 33 cells against
		// 17-22 for the other archetypes while the held territory stays on
		// top of the roster.
		//
		// The extra deaths that do remain are the point of the archetype:
		// ~90% of them are trail_cut, i.e. a player cutting a long exposed
		// trail. This is the bot that is meant to be pleasant to kill.
		p.aiAggression = 0.10 + 0.10*r.rng.Float32()
		p.aiCaution = 0.55 + 0.25*r.rng.Float32()
		budgetLo, budgetHi = 22, 30
		p.aiCloseFrac = BotCloseFracFarmer
		p.aiBudgetCap = BotTrailBudgetCapFarmer
		// A Farmer that leaves its loop to hunt is a Farmer that dies with a
		// 25-cell trail out. The tier sets this above; the archetype vetoes it.
		p.aiHuntGate = 0.10
		farmer = true
	case ArchAggressor:
		p.aiAggression = 0.80 + 0.15*r.rng.Float32()
		p.aiCaution = 0.25
		budgetLo, budgetHi = 8, 12
		p.aiHuntGate = 1.0
	case ArchCoward:
		p.aiAggression = 0.25 + 0.25*r.rng.Float32()
		p.aiCaution = 0.85
		budgetLo, budgetHi = 8, 14
	default:
		p.aiArchetype = ArchTerritorial
		p.aiAggression = 0.40 + 0.35*r.rng.Float32()
		p.aiCaution = 0.35 + 0.40*r.rng.Float32()
	}

	// Place the bot inside its archetype band according to the tier, with a
	// little jitter so same-tier siblings still differ.
	span := budgetHi - budgetLo
	frac := 0.5
	switch p.aiTier {
	case TierEasy:
		frac = 0.10
	case TierHard:
		frac = 0.90
	}
	base := budgetLo + int(float64(span)*frac+0.5)
	if span > 0 {
		base += r.randInt(-1, 1)
	}
	if base < budgetLo {
		base = budgetLo
	}
	if base > budgetHi {
		base = budgetHi
	}
	p.aiTrailBudget = base
	p.aiBravery = base

	// baitSense now scales the budget instead of being subtracted from it, so
	// the top of the scale stays reachable (G3).
	p.aiBaitSense = 0.30 + 0.60*r.rng.Float32()
	if farmer {
		// Trap awareness is the cheapest survival knob there is, and it is the
		// one that lets the long loop pay off instead of ending in a cut.
		p.aiBaitSense = 0.70 + 0.30*r.rng.Float32()
	}
	p.aiRiskiness = 0.20 + 0.65*r.rng.Float32()
	if p.aiCaution > 0.70 {
		p.aiBaitSense += 0.12
		p.aiRiskiness -= 0.10
	}
	if p.aiAggression > 0.70 {
		p.aiRiskiness += 0.12
		p.aiBaitSense -= 0.10
	}
	if p.aiBaitSense < 0.05 {
		p.aiBaitSense = 0.05
	} else if p.aiBaitSense > 1 {
		p.aiBaitSense = 1
	}
	if p.aiRiskiness < 0 {
		p.aiRiskiness = 0
	} else if p.aiRiskiness > 1 {
		p.aiRiskiness = 1
	}
}

// botROI returns this bot's perception window, falling back to the global one
// for bots created before personalities existed.
func (p *Player) botROI() (int, int) {
	w := p.aiROIW
	h := p.aiROIH
	if w <= 0 {
		w = ROIWidth
	}
	if h <= 0 {
		h = ROIHeight
	}
	if w > W {
		w = W
	}
	if h > H {
		h = H
	}
	return w, h
}

// botROIBounds clips the bot's perception window to the map.
func (r *Room) botROIBounds(p *Player) (minX, minY, maxX, maxY int) {
	rw, rh := p.botROI()
	rx := p.x - rw/2
	ry := p.y - rh/2
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
	return rx, ry, rx + rw, ry + rh
}

// newBotLocked creates one bot with the given personality and spawns it.
func (r *Room) newBotLocked(used, usedStarts, usedEn, usedStartsEn map[string]struct{}, tier, arch uint8, fallbackN int) *Player {
	pnum := r.allocPlayerNumLocked()
	if pnum == 0 {
		return nil
	}
	name := botnames.PickUnique(r.rng, botnames.PoolsRU, used, usedStarts, fallbackN)
	nameEn := botnames.PickUnique(r.rng, botnames.PoolsEN, usedEn, usedStartsEn, fallbackN)
	hue := r.allocUniqueHue()
	metrics.JoinsTotal.Inc(metrics.ActorLabel(true))
	p := &Player{
		num:             pnum,
		name:            name,
		nameEn:          nameEn,
		bot:             true,
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
		hue:             hue,
		cosInvCaptureFx: 1,
		cosInvHead:      1,
		cosInvSeg:       1,
		cosInvNameplate: 1,
		cosInvFrame:     1,
		aiMode:          0,
		aiModeUntil:     0,
		aiTargetX:       -1,
		aiTargetY:       -1,
		aiCoolCell:      -1,
	}
	r.applyBotPersonality(p, tier, arch)
	r.players[pnum] = p
	r.scores[pnum] = 0
	r.points[pnum] = 0
	r.setKnownNameLocalizedLocked(pnum, name, nameEn, true)
	r.respawnPlayer(p)
	return p
}

func (r *Room) spawnBots() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.syncBotPopulationLocked()
}

// desiredBotCount thins the bot field out as real players fill the room (G7).
func desiredBotCount(humans int) int {
	if humans < 0 {
		humans = 0
	}
	n := BotCount - (3*humans)/2
	if n < BotCountMin {
		n = BotCountMin
	}
	return n
}

// syncBotPopulationLocked adds or removes bots to match desiredBotCount while
// holding the intended tier/archetype mix. Removed bots go through
// removePlayer, which clears their territory and trail.
func (r *Room) syncBotPopulationLocked() {
	want := desiredBotCount(r.humanCount)
	tiers, archs, have := r.botMixCountsLocked()

	for have > want {
		num := r.pickBotToRemoveLocked()
		if num == 0 {
			break
		}
		if p := r.players[num]; p != nil {
			r.releaseHunt(p)
			if int(p.aiTier) < len(tiers) {
				tiers[p.aiTier]--
			}
			if int(p.aiArchetype) < len(archs) {
				archs[p.aiArchetype]--
			}
		}
		r.removePlayer(num)
		delete(r.knownNames, num)
		have--
		r.forceFullSnapshot = true
	}
	if have >= want {
		return
	}

	used, usedStarts := r.usedBotNamesLocked()
	usedEn, usedStartsEn := r.usedBotNamesEnLocked()
	tierT := mixTargets(tierMix[:], want)
	archT := mixTargets(archMix[:], want)
	for have < want {
		tier := pickUnderfilled(tiers, tierT)
		arch := pickUnderfilled(archs, archT)
		if r.newBotLocked(used, usedStarts, usedEn, usedStartsEn, tier, arch, have+1) == nil {
			// Player numbers exhausted: stop instead of spinning forever.
			break
		}
		tiers[tier]++
		archs[arch]++
		have++
		r.forceFullSnapshot = true
	}
}

// pickBotToRemoveLocked prefers a dead bot, then the least successful live one,
// so removing bots does not erase a leader mid-match.
func (r *Room) pickBotToRemoveLocked() uint16 {
	bestNum := uint16(0)
	bestKey := 1 << 30
	for num, p := range r.players {
		if p == nil || !p.bot {
			continue
		}
		// Dead bots sort first, then by points, then by held cells.
		key := int(r.points[num])*4 + int(r.scores[num])
		if !p.alive {
			key = -1000000 + key
		}
		if key < bestKey {
			bestKey = key
			bestNum = num
		}
	}
	return bestNum
}

// botReclaimGate is the per-archetype appetite for a reclaim detour (G4):
// the Farmer lives off its estate, the Aggressor would rather chase.
var botReclaimGate = [ArchCount]float32{
	ArchFarmer:      0.95,
	ArchAggressor:   0.35,
	ArchCoward:      0.60,
	ArchTerritorial: 0.85,
}

func (r *Room) botLocalSnapshot(num uint16, headX int, headY int, hitX int, hitY int, radius int) string {
	if radius < 1 {
		radius = 1
	}
	if radius > 8 {
		radius = 8
	}
	w := radius*2 + 1
	b := make([]byte, 0, w*w+(w-1))
	for y := headY - radius; y <= headY+radius; y++ {
		if len(b) > 0 {
			b = append(b, '|')
		}
		for x := headX - radius; x <= headX+radius; x++ {
			if x == headX && y == headY {
				if x == hitX && y == hitY {
					b = append(b, '*')
				} else {
					b = append(b, 'H')
				}
				continue
			}
			if x == hitX && y == hitY {
				b = append(b, 'X')
				continue
			}
			if !inBounds(x, y) {
				b = append(b, '#')
				continue
			}
			i := r.idx(x, y)
			if r.trailOwner[i] == num {
				b = append(b, 's')
				continue
			}
			if r.trailOwner[i] != 0 {
				b = append(b, 't')
				continue
			}
			if r.gridOwner[i] == num {
				b = append(b, 'S')
				continue
			}
			if r.gridOwner[i] != 0 {
				b = append(b, 'E')
				continue
			}
			b = append(b, '.')
		}
	}
	return string(b)
}

// botRespawnDelay records the death and returns how long this bot stays off
// the map. A bot that keeps dying comes back slower, so a player who farms one
// spawn point runs out of food (G8).
func (r *Room) botRespawnDelay(p *Player) uint32 {
	p.aiDeathAt[p.aiDeathI%aiDeathCap] = r.tick
	p.aiDeathI = (p.aiDeathI + 1) % aiDeathCap
	if p.aiDeathN < aiDeathCap {
		p.aiDeathN++
	}
	recent := 0
	for i := 0; i < int(p.aiDeathN); i++ {
		if r.tick-p.aiDeathAt[i] <= BotRespawnDeathWindow {
			recent++
		}
	}
	d := r.randInt(BotRespawnDelayMin, BotRespawnDelayMax)
	// The death just recorded counts as the baseline, not as a penalty.
	if recent > 1 {
		d += BotRespawnDeathStep * (recent - 1)
	}
	if d > BotRespawnDelayCap {
		d = BotRespawnDelayCap
	}
	return uint32(d)
}

func (r *Room) nearestOwnedApprox(num uint16, x, y int) (int, int, int) {
	p := r.players[num]
	if p == nil || len(p.owned) == 0 {
		return x, y, 9999
	}
	bestD := 9999
	bestI := p.owned[r.rng.Intn(len(p.owned))]
	tries := 80
	if len(p.owned) < tries {
		tries = len(p.owned)
	}
	for k := 0; k < tries; k++ {
		i := p.owned[r.rng.Intn(len(p.owned))]
		xx := i % W
		yy := i / W
		d := manhattan(x, y, xx, yy)
		if d < bestD {
			bestD = d
			bestI = i
			if bestD <= 1 {
				break
			}
		}
	}
	return bestI % W, bestI / W, bestD
}

// visibleReturnEstimate guesses how far an enemy is from safety using only
// what the hunting bot can see. When the enemy's nearest own cell lies outside
// the bot's ROI the bot must not know the exact number, so the estimate falls
// back to "at least as far as the edge of what I can see" (G9).
func (r *Room) visibleReturnEstimate(p *Player, enemy *Player, minX, minY, maxX, maxY int) int {
	if enemy == nil {
		return 9999
	}
	if inBounds(enemy.x, enemy.y) && r.gridOwner[r.idx(enemy.x, enemy.y)] == enemy.num {
		return 0
	}
	ox, oy, d := r.nearestOwnedApprox(enemy.num, enemy.x, enemy.y)
	if d < 9999 && ox >= minX && ox < maxX && oy >= minY && oy < maxY {
		return d
	}
	// Unknown: lower-bounded by the distance from the enemy to the ROI edge.
	edge := maxX - 1 - enemy.x
	if v := enemy.x - minX; v < edge {
		edge = v
	}
	if v := enemy.y - minY; v < edge {
		edge = v
	}
	if v := maxY - 1 - enemy.y; v < edge {
		edge = v
	}
	if edge < 0 {
		edge = 0
	}
	return edge + 4
}

func (r *Room) estimateReturnSteps(num uint16, x, y int) int {
	if !inBounds(x, y) {
		return 9999
	}
	i := r.idx(x, y)
	if r.gridOwner[i] == num {
		return 0
	}
	d := r.bfsToNearestOwned(num, x, y, 26)
	if d < 9999 {
		return d
	}
	_, _, d2 := r.nearestOwnedApprox(num, x, y)
	return d2
}

func (r *Room) bfsToNearestOwned(num uint16, sx, sy int, maxSteps int) int {
	if !inBounds(sx, sy) {
		return 9999
	}
	start := r.idx(sx, sy)
	if r.gridOwner[start] == num {
		return 0
	}
	r.bfsGen++
	gen := r.bfsGen
	if gen == 0 {
		for i := range r.bfsMark {
			r.bfsMark[i] = 0
		}
		r.bfsGen = 1
		gen = 1
	}
	r.bfsQ = r.bfsQ[:0]
	r.bfsMark[start] = gen
	r.bfsDist[start] = 0
	r.bfsQ = append(r.bfsQ, start)
	for qs := 0; qs < len(r.bfsQ); qs++ {
		v := r.bfsQ[qs]
		d := int(r.bfsDist[v])
		if d >= maxSteps {
			continue
		}
		x := v % W
		y := v / W
		if x > 0 {
			n := v - 1
			if r.bfsMark[n] != gen && r.trailOwner[n] == 0 {
				if r.gridOwner[n] == num {
					return d + 1
				}
				r.bfsMark[n] = gen
				r.bfsDist[n] = uint16(d + 1)
				r.bfsQ = append(r.bfsQ, n)
			}
		}
		if x < W-1 {
			n := v + 1
			if r.bfsMark[n] != gen && r.trailOwner[n] == 0 {
				if r.gridOwner[n] == num {
					return d + 1
				}
				r.bfsMark[n] = gen
				r.bfsDist[n] = uint16(d + 1)
				r.bfsQ = append(r.bfsQ, n)
			}
		}
		if y > 0 {
			n := v - W
			if r.bfsMark[n] != gen && r.trailOwner[n] == 0 {
				if r.gridOwner[n] == num {
					return d + 1
				}
				r.bfsMark[n] = gen
				r.bfsDist[n] = uint16(d + 1)
				r.bfsQ = append(r.bfsQ, n)
			}
		}
		if y < H-1 {
			n := v + W
			if r.bfsMark[n] != gen && r.trailOwner[n] == 0 {
				if r.gridOwner[n] == num {
					return d + 1
				}
				r.bfsMark[n] = gen
				r.bfsDist[n] = uint16(d + 1)
				r.bfsQ = append(r.bfsQ, n)
			}
		}
	}
	return 9999
}

func (r *Room) bfsToCell(sx, sy int, targetI int, allowTrailOwner uint16, maxSteps int) int {
	if !inBounds(sx, sy) {
		return 9999
	}
	if targetI < 0 || targetI >= N {
		return 9999
	}
	start := r.idx(sx, sy)
	if start == targetI {
		return 0
	}
	r.bfsGen++
	gen := r.bfsGen
	if gen == 0 {
		for i := range r.bfsMark {
			r.bfsMark[i] = 0
		}
		r.bfsGen = 1
		gen = 1
	}
	r.bfsQ = r.bfsQ[:0]
	r.bfsMark[start] = gen
	r.bfsDist[start] = 0
	r.bfsQ = append(r.bfsQ, start)
	for qs := 0; qs < len(r.bfsQ); qs++ {
		v := r.bfsQ[qs]
		d := int(r.bfsDist[v])
		if d >= maxSteps {
			continue
		}
		x := v % W
		y := v / W
		tryPush := func(n int) (found bool) {
			if r.bfsMark[n] == gen {
				return false
			}
			to := r.trailOwner[n]
			if to != 0 && to != allowTrailOwner {
				return false
			}
			if n == targetI {
				return true
			}
			r.bfsMark[n] = gen
			r.bfsDist[n] = uint16(d + 1)
			r.bfsQ = append(r.bfsQ, n)
			return false
		}
		if x > 0 {
			if tryPush(v - 1) {
				return d + 1
			}
		}
		if x < W-1 {
			if tryPush(v + 1) {
				return d + 1
			}
		}
		if y > 0 {
			if tryPush(v - W) {
				return d + 1
			}
		}
		if y < H-1 {
			if tryPush(v + W) {
				return d + 1
			}
		}
	}
	return 9999
}

func (r *Room) pickDirToOwned(p *Player) Dir {
	best := p.dir
	bestD := 9999
	found := false
	dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
	for _, d := range dirs {
		if isOpposite(p.dir, d) {
			continue
		}
		dx, dy := dirToDelta(d)
		nx := p.x + dx
		ny := p.y + dy
		if !inBounds(nx, ny) {
			continue
		}
		i := r.idx(nx, ny)
		if r.trailOwner[i] != 0 {
			continue
		}
		if r.gridOwner[i] == p.num {
			return d
		}
		d2 := r.bfsToNearestOwned(p.num, nx, ny, 26)
		if d2 < bestD {
			bestD = d2
			best = d
			found = true
		}
	}
	if bestD < 9999 {
		return best
	}
	if !found {
		for _, d := range dirs {
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
			if r.trailOwner[i] != 0 {
				continue
			}
			return d
		}
	}
	tx, ty, _ := r.nearestOwnedApprox(p.num, p.x, p.y)
	return r.bestGreedyDir(p, tx, ty)
}

func (r *Room) pickDirToCell(p *Player, targetI int, allowTrailOwner uint16) (Dir, bool) {
	best := p.dir
	bestD := 9999
	found := false
	dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
	for _, d := range dirs {
		if isOpposite(p.dir, d) {
			continue
		}
		dx, dy := dirToDelta(d)
		nx := p.x + dx
		ny := p.y + dy
		if !inBounds(nx, ny) {
			continue
		}
		i := r.idx(nx, ny)
		to := r.trailOwner[i]
		if to != 0 && to != allowTrailOwner {
			continue
		}
		if i == targetI {
			return d, true
		}
		d2 := r.bfsToCell(nx, ny, targetI, allowTrailOwner, 28)
		if d2 < bestD {
			bestD = d2
			best = d
			found = true
		}
	}
	if found {
		return best, true
	}
	for _, d := range dirs {
		dx, dy := dirToDelta(d)
		nx := p.x + dx
		ny := p.y + dy
		if !inBounds(nx, ny) {
			continue
		}
		i := r.idx(nx, ny)
		to := r.trailOwner[i]
		if to != 0 && to != allowTrailOwner {
			continue
		}
		if to == p.num {
			continue
		}
		return d, true
	}
	return p.dir, false
}

func (r *Room) lookaheadBad(p *Player, d Dir, steps int, allowTrailOwner uint16) bool {
	x := p.x
	y := p.y
	dd := d
	for k := 0; k < steps; k++ {
		dx, dy := dirToDelta(dd)
		x += dx
		y += dy
		if !inBounds(x, y) {
			return true
		}
		i := r.idx(x, y)
		to := r.trailOwner[i]
		if to != 0 {
			if to == p.num {
				return true
			}
			if allowTrailOwner == 0 || to != allowTrailOwner {
				return true
			}
		}
		if r.gridOwner[i] != p.num {
			open := 0
			if x > 0 {
				n := i - 1
				to2 := r.trailOwner[n]
				if to2 == 0 || to2 == allowTrailOwner {
					open++
				}
			}
			if x < W-1 {
				n := i + 1
				to2 := r.trailOwner[n]
				if to2 == 0 || to2 == allowTrailOwner {
					open++
				}
			}
			if y > 0 {
				n := i - W
				to2 := r.trailOwner[n]
				if to2 == 0 || to2 == allowTrailOwner {
					open++
				}
			}
			if y < H-1 {
				n := i + W
				to2 := r.trailOwner[n]
				if to2 == 0 || to2 == allowTrailOwner {
					open++
				}
			}
			if open <= 1 {
				return true
			}
		}
		if k == 0 {
			dd = d
		}
	}
	return false
}

func (r *Room) pickBoundaryCell(p *Player) (int, int, bool) {
	if p == nil || len(p.owned) == 0 {
		return 0, 0, false
	}
	tries := 120
	if len(p.owned) < tries {
		tries = len(p.owned)
	}
	best := -1
	bestScore := -1
	for k := 0; k < tries; k++ {
		cell := p.owned[r.rng.Intn(len(p.owned))]
		x := cell % W
		y := cell / W
		score := 0
		enemyAdj := 0
		ownAdj := 0
		if x > 0 {
			i := cell - 1
			if r.gridOwner[i] != p.num && r.trailOwner[i] == 0 {
				score++
				if r.gridOwner[i] != 0 {
					enemyAdj++
				}
			}
			if r.gridOwner[i] == p.num {
				ownAdj++
			}
		}
		if x < W-1 {
			i := cell + 1
			if r.gridOwner[i] != p.num && r.trailOwner[i] == 0 {
				score++
				if r.gridOwner[i] != 0 {
					enemyAdj++
				}
			}
			if r.gridOwner[i] == p.num {
				ownAdj++
			}
		}
		if y > 0 {
			i := cell - W
			if r.gridOwner[i] != p.num && r.trailOwner[i] == 0 {
				score++
				if r.gridOwner[i] != 0 {
					enemyAdj++
				}
			}
			if r.gridOwner[i] == p.num {
				ownAdj++
			}
		}
		if y < H-1 {
			i := cell + W
			if r.gridOwner[i] != p.num && r.trailOwner[i] == 0 {
				score++
				if r.gridOwner[i] != 0 {
					enemyAdj++
				}
			}
			if r.gridOwner[i] == p.num {
				ownAdj++
			}
		}
		if score == 0 {
			continue
		}
		free := r.boundaryFreeSpace(p, cell, 8)
		if p.aiExpandIntent == 1 {
			score += enemyAdj * 3
			score += ownAdj
			score += free / 24
		} else {
			score += ownAdj * 2
			score -= enemyAdj * 2
			score += free / 14
			if p.aiExpandPrefer == 3 && ownAdj <= 1 {
				score -= 6
			}
			if p.homeX >= 0 && p.homeY >= 0 {
				dh := manhattan(x, y, p.homeX, p.homeY)
				score -= dh / 6
			}
		}
		score += r.rng.Intn(2)
		if score > bestScore {
			bestScore = score
			best = cell
		}
	}
	if best < 0 {
		return 0, 0, false
	}
	return best % W, best / W, true
}

func (r *Room) planExpand(p *Player, s sensedInfo) {
	p.aiExpandPhase = 0
	p.aiExpandUntil = r.tick + uint32(50+r.rng.Intn(35))
	p.aiExpandIntent = 0
	p.aiExpandPrefer = 0
	if s.enemyHeadNum != 0 && s.enemyHeadDist <= 12 {
		gate := (0.06 + 0.22*p.aiAggression) * (0.70 + 0.30*p.aiRiskiness)
		gate *= (0.80 + 0.20*(1.0-p.aiBaitSense))
		if r.rng.Float32() < gate {
			p.aiExpandIntent = 1
		}
	}
	if s.enemyTrailNum != 0 && s.enemyTrailDist <= 14 {
		gate := (0.08 + 0.24*p.aiAggression) * (0.75 + 0.25*p.aiRiskiness)
		gate *= (0.80 + 0.20*(1.0-p.aiBaitSense))
		if r.rng.Float32() < gate {
			p.aiExpandIntent = 1
		}
	}
	if p.aiExpandIntent == 0 {
		area, bw, bh, dens, per := r.measureTerritoryShape(p.num, p)
		_ = area
		if bw > 0 && bh > 0 {
			if bw*2 >= bh*3 {
				p.aiExpandPrefer = 1
			} else if bh*2 >= bw*3 {
				p.aiExpandPrefer = 2
			}
		}
		if dens < 0.62 || (area > 0 && per > area*4) {
			if p.aiExpandPrefer == 0 {
				p.aiExpandPrefer = 3
			}
		}
	}
	x, y, ok := r.pickBoundaryCell(p)
	if !ok {
		p.aiExpandPhase = 0
		return
	}
	p.aiTargetX = x
	p.aiTargetY = y
	p.aiExpandPhase = 4
}

func (r *Room) startExpandFromBoundary(p *Player) {
	dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
	best := DirRight
	bestScore := -9999
	for _, d := range dirs {
		if isOpposite(p.dir, d) {
			continue
		}
		dx, dy := dirToDelta(d)
		nx := p.x + dx
		ny := p.y + dy
		if !inBounds(nx, ny) {
			continue
		}
		i := r.idx(nx, ny)
		if r.gridOwner[i] == p.num {
			continue
		}
		if r.trailOwner[i] != 0 {
			continue
		}
		s := 0
		if p.aiExpandIntent == 1 {
			if r.gridOwner[i] != 0 && r.gridOwner[i] != p.num {
				s += 7
			} else if r.gridOwner[i] == 0 {
				s += 4
			}
		} else {
			if r.gridOwner[i] == 0 {
				s += 5
			} else {
				s += 1
			}
		}
		if p.aiExpandPrefer == 1 {
			if d == DirUp || d == DirDown {
				s += 3
			}
		} else if p.aiExpandPrefer == 2 {
			if d == DirLeft || d == DirRight {
				s += 3
			}
		}
		bd := nx
		if ny < bd {
			bd = ny
		}
		rd := (W - 1) - nx
		if rd < bd {
			bd = rd
		}
		dn := (H - 1) - ny
		if dn < bd {
			bd = dn
		}
		if bd <= 1 {
			s -= 6
		}
		s += r.rng.Intn(3)
		if s > bestScore {
			bestScore = s
			best = d
		}
	}
	p.aiExpandDir = best
	if r.rng.Intn(2) == 0 {
		p.aiExpandTurn = -1
	} else {
		p.aiExpandTurn = 1
	}
	outLen := 5 + r.rng.Intn(6)
	sideLen := 5 + r.rng.Intn(6)
	if p.aiExpandIntent == 1 {
		outLen += 2
		sideLen -= 1
	}
	if p.aiExpandPrefer != 0 {
		outLen -= 1
		sideLen += 2
	}
	if p.aiCaution > 0.6 {
		outLen -= 1
		sideLen -= 1
	}
	if len(p.trail) > 0 {
		outLen -= 1
	}
	if outLen < 4 {
		outLen = 4
	}
	if sideLen < 3 {
		sideLen = 3
	}
	if outLen > 11 {
		outLen = 11
	}
	if sideLen > 13 {
		sideLen = 13
	}
	p.aiExpandOutLeft = uint8(outLen)
	p.aiExpandSideLeft = uint8(sideLen)
	p.aiExpandPhase = 1
}

type sensedInfo struct {
	enemyHeadNum  uint16
	enemyHeadDist int
	enemyHeadX    int
	enemyHeadY    int

	enemyTrailNum  uint16
	enemyTrailDist int
	enemyTrailX    int
	enemyTrailY    int
}

func (r *Room) senseBot(p *Player) sensedInfo {
	out := sensedInfo{enemyHeadDist: 9999, enemyTrailDist: 9999}
	// G3: perception window is a tier property, not a global constant.
	minX, minY, maxX, maxY := r.botROIBounds(p)
	for _, o := range r.players {
		if o == nil || !o.alive || o.num == p.num {
			continue
		}
		if o.x < minX || o.x >= maxX || o.y < minY || o.y >= maxY {
			continue
		}
		d := manhattan(p.x, p.y, o.x, o.y)
		if d < out.enemyHeadDist {
			out.enemyHeadDist = d
			out.enemyHeadNum = o.num
			out.enemyHeadX = o.x
			out.enemyHeadY = o.y
		}
	}

	for yy := minY; yy < maxY; yy++ {
		row := yy * W
		for xx := minX; xx < maxX; xx++ {
			i := row + xx
			o := r.trailOwner[i]
			if o == 0 || o == p.num {
				continue
			}
			d := manhattan(p.x, p.y, xx, yy)
			if d >= out.enemyTrailDist {
				continue
			}
			out.enemyTrailNum = o
			out.enemyTrailDist = d
			out.enemyTrailX = xx
			out.enemyTrailY = yy
		}
	}

	if out.enemyTrailNum != 0 {
		p.aiLastSeenTick = r.tick
		p.aiLastSeenType = 1
		p.aiLastSeenX = out.enemyTrailX
		p.aiLastSeenY = out.enemyTrailY
		p.aiLastSeenNum = out.enemyTrailNum
	} else if out.enemyHeadNum != 0 {
		p.aiLastSeenTick = r.tick
		p.aiLastSeenType = 2
		p.aiLastSeenX = out.enemyHeadX
		p.aiLastSeenY = out.enemyHeadY
		p.aiLastSeenNum = out.enemyHeadNum
	}

	return out
}

func (r *Room) botTrySetDir(p *Player, d Dir, urgent bool) {
	if !urgent && p.aiNextDecisionTick != 0 && r.tick < p.aiNextDecisionTick {
		return
	}
	if d != p.pendingDir && !isOpposite(p.dir, d) {
		p.pendingDir = d
		// G3: reaction time is a tier property. Easy bots think in ~700ms,
		// hard bots re-decide almost every tick.
		lo := int(p.aiCooldownMin)
		hi := int(p.aiCooldownMax)
		if lo <= 0 {
			lo = 2
		}
		if hi < lo {
			hi = lo
		}
		cool := uint32(lo)
		if hi > lo {
			cool = uint32(lo + r.rng.Intn(hi-lo+1))
		}
		p.aiNextDecisionTick = r.tick + cool
	}
}

// huntCapFor is the hard ceiling on simultaneous hunters for one victim (G2).
func huntCapFor(victim *Player) int {
	if victim == nil {
		return 0
	}
	if victim.bot {
		return HuntCapBot
	}
	return HuntCapHuman
}

// recomputeHuntersLocked rebuilds the hunter census from actual bot state.
// Running it every tick makes the counter impossible to desync, which is the
// failure mode that would silently disable all bot aggression.
func (r *Room) recomputeHuntersLocked() {
	if r.huntersOn == nil {
		r.huntersOn = make(map[uint16]int, 8)
	}
	for k := range r.huntersOn {
		delete(r.huntersOn, k)
	}
	for _, p := range r.players {
		if p == nil || !p.bot || !p.alive || p.aiMode != 2 {
			continue
		}
		if p.aiHuntWho == 0 {
			continue
		}
		v := r.players[p.aiHuntWho]
		if v == nil || !v.alive {
			p.aiHuntWho = 0
			continue
		}
		r.huntersOn[p.aiHuntWho]++
	}
}

// canHunt combines the per-victim hunter cap with the bot's archetype rules.
func (r *Room) canHunt(p *Player, victim *Player, tx, ty, dist int) bool {
	if p == nil || victim == nil || !victim.alive || victim.num == p.num {
		return false
	}
	if !r.botMayHunt(p, tx, ty, dist) {
		return false
	}
	if p.aiMode == 2 && p.aiHuntWho == victim.num {
		return true
	}
	if r.huntersOn == nil {
		return true
	}
	return r.huntersOn[victim.num] < huntCapFor(victim)
}

// botMayHunt applies the archetype's appetite for a chase (G4).
func (r *Room) botMayHunt(p *Player, tx, ty int, dist int) bool {
	switch p.aiArchetype {
	case ArchFarmer:
		// Farmers only swat a trail that is already under their nose.
		// G21: "under their nose" was 2 cells, which almost never fired.
		return dist <= 5
	case ArchAggressor:
		return true
	case ArchCoward:
		// Cowards commit only to short, near-certain finishes.
		return dist <= 6
	case ArchTerritorial:
		if inBounds(tx, ty) && r.gridOwner[r.idx(tx, ty)] == p.num {
			return true
		}
		if p.homeX >= 0 && manhattan(tx, ty, p.homeX, p.homeY) <= 24 {
			return true
		}
		return false
	}
	return true
}

// enterHunt is the single entry point into aiMode 2. It books a hunter slot
// and arms the windup so the attack is telegraphed (G2, G14).
func (r *Room) enterHunt(p *Player, victim uint16, tx, ty int, trailOwner uint16, dur uint32) {
	r.releaseHunt(p)
	p.aiMode = 2
	p.aiTargetX = tx
	p.aiTargetY = ty
	p.aiHuntTarget = trailOwner
	p.aiHuntWho = victim
	p.aiModeUntil = r.tick + dur
	p.aiExpandPhase = 0
	if victim != 0 {
		if r.huntersOn == nil {
			r.huntersOn = make(map[uint16]int, 8)
		}
		r.huntersOn[victim]++
	}
	p.aiWindupUntil = r.tick + uint32(HuntWindupMin+r.rng.Intn(HuntWindupMax-HuntWindupMin+1))
	p.aiWindupDir = r.bestGreedyDir(p, tx, ty)
}

// releaseHunt gives the booked hunter slot back. Called on every exit from
// aiMode 2, on bot death and on respawn.
func (r *Room) releaseHunt(p *Player) {
	if p == nil || p.aiHuntWho == 0 {
		return
	}
	if r.huntersOn != nil {
		if n := r.huntersOn[p.aiHuntWho]; n > 1 {
			r.huntersOn[p.aiHuntWho] = n - 1
		} else {
			delete(r.huntersOn, p.aiHuntWho)
		}
	}
	p.aiHuntWho = 0
	p.aiWindupUntil = 0
}

// leaveHunt drops out of aiMode 2 cleanly.
func (r *Room) leaveHunt(p *Player) {
	r.releaseHunt(p)
	p.aiMode = 0
	p.aiModeUntil = 0
}

// botTrailBudget is the trail length this bot is willing to run before heading
// home. baitSense multiplies rather than subtracts, so the whole 6..26 range
// stays reachable instead of collapsing onto the lower clamp (G3).
func (r *Room) botTrailBudget(p *Player, localRisk, localCaution float32) int {
	base := p.aiTrailBudget
	if base <= 0 {
		base = p.aiBravery
	}
	if base <= 0 {
		base = 12
	}
	f := 1.30 - 0.50*p.aiBaitSense
	budget := int(float32(base)*f + 0.5)
	budget += int(4 * localRisk)
	if localCaution > 0.70 {
		budget -= 2
	}
	if p.contractType == ContractCapture {
		budget += 4
	}
	if r.mutatorType == MutatorDoubleCapture {
		budget -= 2
	}
	floor := 6
	if p.aiArchetype == ArchFarmer {
		// Keep the Farmer above everyone else's ceiling even at the worst end
		// of the baitSense multiplier; otherwise the archetype is invisible
		// again the moment the dice go against it.
		floor = BotTrailBudgetCap + 1
	}
	if budget < floor {
		budget = floor
	}
	budgetCap := p.aiBudgetCap
	if budgetCap <= 0 {
		budgetCap = BotTrailBudgetCap
	}
	if budget > budgetCap {
		budget = budgetCap
	}
	return budget
}

// botCloseFrac is the share of the trail budget a bot burns before it starts
// looking for a gate home. Zero means a bot built before archetype-specific
// loop lengths existed.
func botCloseFrac(p *Player) float32 {
	if p == nil || p.aiCloseFrac <= 0 {
		return BotCloseFracDefault
	}
	return p.aiCloseFrac
}

func (r *Room) botStep(p *Player) {
	if p == nil || !p.alive || !p.bot {
		return
	}
	if p.x < 0 || p.y < 0 {
		return
	}
	r.recordRecentPos(p, p.x, p.y)
	if p.inPositionCycle() {
		cand := []Dir{turnLeft(p.dir), turnRight(p.dir), p.dir}
		best := p.dir
		bestScore := int32(-1 << 30)
		bestOk := false
		for _, d := range cand {
			if isOpposite(p.dir, d) {
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
			if r.lookaheadBad(p, d, 2, 0) {
				continue
			}
			sc := int32(0)
			if d == p.dir {
				sc += 1
			}
			if pen := r.recentPenalty(p, nx, ny); pen > 0 {
				sc -= pen * 3
			}
			if sc > bestScore {
				bestScore = sc
				best = d
				bestOk = true
			}
		}
		if bestOk {
			r.botTrySetDir(p, best, true)
			p.aiNextDecisionTick = 0
			r.leaveHunt(p)
			p.aiMode = 1
			p.aiExpandPhase = 0
			return
		}
	}

	onOwn := false
	if inBounds(p.x, p.y) {
		onOwn = r.gridOwner[r.idx(p.x, p.y)] == p.num
	}
	outside := len(p.trail) > 0 && !onOwn
	if outside {
		// Hard stop tied to this bot's own budget instead of a flat 14, which
		// used to cap even the long-loop farmers.
		if len(p.trail) >= r.botTrailBudget(p, p.aiRiskiness, p.aiCaution)+4 {
			r.leaveHunt(p)
			p.aiMode = 1
		}
	}

	if p.aiNextDecisionTick != 0 && r.tick < p.aiNextDecisionTick {
		moveDir := p.dir
		if p.pendingDir != p.dir && !isOpposite(p.dir, p.pendingDir) {
			moveDir = p.pendingDir
		}
		if r.lookaheadBad(p, moveDir, 2, 0) {
			goto doFullBot
		}
		for _, o := range r.players {
			if o == nil || !o.alive || o.num == p.num {
				continue
			}
			if manhattan(p.x, p.y, o.x, o.y) <= 2 {
				goto doFullBot
			}
		}
		return
	}

doFullBot:

	s := r.senseBot(p)
	urgent := s.enemyHeadDist <= 2
	// G4: the coward bolts from any head it can see, which is what makes it
	// readable as a coward.
	if p.aiArchetype == ArchCoward && s.enemyHeadDist <= 10 {
		urgent = true
	}

	// Points-aware AI overlay: bots that are behind focus pressure on the leader;
	// bots that are leading play safer (shorter trails, less risky hunts).
	myPts := r.points[p.num]
	leaderNum := uint16(0)
	leaderPts := uint16(0)
	secondPts := uint16(0)
	for _, o := range r.players {
		if o == nil || !o.alive {
			continue
		}
		v := r.points[o.num]
		if v > leaderPts {
			secondPts = leaderPts
			leaderPts = v
			leaderNum = o.num
		} else if v > secondPts {
			secondPts = v
		}
	}
	isLeader := leaderNum == p.num && leaderPts > 0
	lead := 0
	if isLeader {
		lead = int(leaderPts) - int(secondPts)
	}
	gap := int(leaderPts) - int(myPts)
	wantCatchup := !isLeader && leaderNum != 0 && leaderPts >= 40 && gap >= 25
	localAgg := p.aiAggression
	localRisk := p.aiRiskiness
	localCaution := p.aiCaution
	if wantCatchup {
		localAgg += 0.12
		localRisk += 0.10
		localCaution -= 0.08
	} else if isLeader {
		localAgg -= 0.08
		localRisk -= 0.06
		localCaution += 0.12
	}
	if localAgg < 0 {
		localAgg = 0
	} else if localAgg > 1 {
		localAgg = 1
	}
	if localRisk < 0 {
		localRisk = 0
	} else if localRisk > 1 {
		localRisk = 1
	}
	if localCaution < 0 {
		localCaution = 0
	} else if localCaution > 1 {
		localCaution = 1
	}

	huntTrailMax := 10
	if p.contractType == ContractKills {
		huntTrailMax = 14
	} else if localAgg >= 0.75 {
		huntTrailMax = 12
	}

	// imminent collision override (prevents dying due to reaction cooldown)
	{
		moveDir := p.dir
		if p.pendingDir != p.dir && !isOpposite(p.dir, p.pendingDir) {
			moveDir = p.pendingDir
		}
		dx, dy := dirToDelta(moveDir)
		nx := p.x + dx
		ny := p.y + dy
		imminentWall := false
		imminentSelf := false
		if !inBounds(nx, ny) {
			imminentWall = true
		}
		// G6: an enemy trail ahead is no longer treated as a threat. Stepping
		// on it kills the owner, and swerving away looked like a bug.
		if !imminentWall && r.trailOwner[r.idx(nx, ny)] == p.num {
			imminentSelf = true
		}
		if imminentWall || imminentSelf {
			dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
			best := DirUp
			bestOk := false
			bestScore := int32(-1 << 30)
			for _, d := range dirs {
				// G5: bots turn under the same rule as humans. No 180s.
				if isOpposite(p.dir, d) {
					continue
				}
				dx, dy := dirToDelta(d)
				x2 := p.x + dx
				y2 := p.y + dy
				if !inBounds(x2, y2) {
					continue
				}
				i2 := r.idx(x2, y2)
				if r.trailOwner[i2] == p.num {
					continue
				}
				sc := int32(0)
				if d == moveDir {
					sc += 2
				}
				sc += r.freeKillBonus(p, i2) / 8
				bd := x2
				if y2 < bd {
					bd = y2
				}
				rd := (W - 1) - x2
				if rd < bd {
					bd = rd
				}
				dn := (H - 1) - y2
				if dn < bd {
					bd = dn
				}
				if bd == 0 {
					sc -= 200
				} else if bd == 1 {
					sc -= 60
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
				p.aiNextDecisionTick = 0
				return
			}
		}
	}

	onOwn = false
	if inBounds(p.x, p.y) {
		onOwn = r.gridOwner[r.idx(p.x, p.y)] == p.num
	}
	outside = len(p.trail) > 0 && !onOwn

	if !urgent {
		if r.bountyTarget != 0 && localAgg > 0.55 && (!outside || len(p.trail) <= huntTrailMax) {
			t := r.players[r.bountyTarget]
			if t != nil && t.alive {
				dd := manhattan(p.x, p.y, t.x, t.y)
				// G1/G2: a bounty no longer overrides the hunter cap or the
				// archetype, so a marked human still faces at most two bots.
				if dd <= 22 && r.canHunt(p, t, t.x, t.y, dd) {
					r.enterHunt(p, t.num, t.x, t.y, t.num, uint32(10+r.rng.Intn(10)))
				}
			}
		}

		// If we're behind, try to pressure the points leader when they are vulnerable (outside their own land).
		if !urgent && p.aiMode != 2 && p.aiMode != 4 && wantCatchup && localAgg > 0.55 && (!outside || len(p.trail) <= huntTrailMax) {
			t := r.players[leaderNum]
			if t != nil && t.alive && inBounds(t.x, t.y) {
				leaderOnOwn := r.gridOwner[r.idx(t.x, t.y)] == t.num
				if !leaderOnOwn {
					dd := manhattan(p.x, p.y, t.x, t.y)
					if dd <= 22 && r.canHunt(p, t, t.x, t.y, dd) {
						r.enterHunt(p, t.num, t.x, t.y, 0, uint32(8+r.rng.Intn(10)))
					}
				}
			}
		}

		// F5: go take your own cooling ground back on purpose. Only when not
		// already committed to a chase or a pickup, and never while dragging a
		// long trail — the detour must not become a suicide.
		if p.aiMode != 2 && p.aiMode != 4 && r.coolOwner != nil && p.num != 0 &&
			(!outside || len(p.trail) <= BotReclaimMaxTrail) &&
			(p.aiCoolScanTick == 0 || r.tick >= p.aiCoolScanTick) {
			p.aiCoolScanTick = r.tick + BotReclaimScanEvery + uint32(r.rng.Intn(3))
			gate := float32(0.6)
			if int(p.aiArchetype) < len(botReclaimGate) {
				gate = botReclaimGate[p.aiArchetype]
			}
			if r.rng.Float32() < gate {
				minX, minY, maxX, maxY := r.botROIBounds(p)
				bestI := -1
				bestD := 1 << 30
				for yy := minY; yy < maxY; yy += BotReclaimStride {
					row := yy * W
					for xx := minX; xx < maxX; xx += BotReclaimStride {
						i := row + xx
						if r.coolOwner[i] != p.num || r.coolUntil[i] <= r.tick {
							continue
						}
						d := manhattan(p.x, p.y, xx, yy)
						if d >= bestD || d > BotReclaimMaxSteps {
							continue
						}
						// Reject a patch that expires before arrival.
						if r.coolUntil[i] < r.tick+uint32(d)+BotReclaimTimeMargin {
							continue
						}
						bestD = d
						bestI = i
					}
				}
				if bestI >= 0 {
					// One BFS on the single best candidate keeps the cost flat.
					if bd := r.bfsToCell(p.x, p.y, bestI, 0, BotReclaimMaxSteps); bd < 9999 &&
						r.coolUntil[bestI] >= r.tick+uint32(bd)+BotReclaimTimeMargin {
						p.aiMode = 5
						p.aiCoolCell = bestI
						p.aiTargetX = bestI % W
						p.aiTargetY = bestI / W
						p.aiHuntTarget = 0
						p.aiModeUntil = r.tick + uint32(bd+8)
						p.aiExpandPhase = 0
					}
				}
			}
		}

		if p.aiMode != 2 && p.aiMode != 5 && len(r.powerUps) > 0 {
			bestScore := int32(-1 << 30)
			bestX := -1
			bestY := -1
			bestI := -1
			for _, pu := range r.powerUps {
				px := int(pu.X)
				py := int(pu.Y)
				if !inBounds(px, py) {
					continue
				}
				if pu.Type == PowerupShield && p.shield > 0 {
					continue
				}
				if (pu.Type == PowerupDash || pu.Type == PowerupMegaDash) && ((p.speedUntil != 0 && r.tick+25 < p.speedUntil) || (p.speedLockUntil != 0 && r.tick < p.speedLockUntil)) {
					continue
				}
				ti := r.idx(px, py)
				d := r.bfsToCell(p.x, p.y, ti, 0, 20)
				if d >= 9999 {
					continue
				}
				if outside {
					maxBonusDist := 8
					if p.contractType == ContractPickups {
						maxBonusDist = 12
					}
					if d > maxBonusDist {
						continue
					}
				}
				w := int32(100)
				switch pu.Type {
				case PowerupShield:
					w = 92
				case PowerupDash:
					w = 112
				case PowerupNova:
					w = 150
				case PowerupMegaDash:
					w = 178
				}
				if wantCatchup {
					switch pu.Type {
					case PowerupShield:
						w = int32(float32(w) * 0.90)
					case PowerupDash:
						w = int32(float32(w) * 1.05)
					case PowerupNova:
						w = int32(float32(w) * 1.10)
					case PowerupMegaDash:
						w = int32(float32(w) * 1.10)
					}
					if gap >= 60 {
						if pu.Type == PowerupNova || pu.Type == PowerupMegaDash {
							w = int32(float32(w) * 1.07)
						}
					}
				} else if isLeader {
					switch pu.Type {
					case PowerupShield:
						w = int32(float32(w) * 1.12)
					case PowerupDash:
						w = int32(float32(w) * 0.95)
					case PowerupNova:
						w = int32(float32(w) * 0.90)
					case PowerupMegaDash:
						w = int32(float32(w) * 0.92)
					}
				}
				if p.contractType == ContractPickups {
					w = int32(float32(w) * 1.20)
				}
				if r.mutatorType == MutatorPowerSurge {
					w = int32(float32(w) * 1.20)
				}
				if r.mutatorType == MutatorDoubleCapture {
					w = int32(float32(w) * 0.90)
				}
				sc := w - int32(d*8)
				if sc > bestScore {
					bestScore = sc
					bestX = px
					bestY = py
					bestI = ti
				}
			}
			minGate := int32(0)
			if r.mutatorType == MutatorDoubleCapture {
				minGate = 12
			}
			if p.contractType == ContractPickups {
				minGate = -20
			}
			if bestI >= 0 && bestScore > minGate {
				p.aiMode = 4
				p.aiTargetX = bestX
				p.aiTargetY = bestY
				p.aiHuntTarget = 0
				p.aiModeUntil = r.tick + uint32(12+r.rng.Intn(12))
				p.aiExpandPhase = 0
			}
		}
	}

	if urgent {
		r.releaseHunt(p)
		p.aiMode = 3
		p.aiModeUntil = r.tick + uint32(r.randInt(6, 12))
		p.aiTargetX = p.x - (s.enemyHeadX - p.x)
		p.aiTargetY = p.y - (s.enemyHeadY - p.y)
		p.aiExpandPhase = 0
	}

	if p.aiLastSeenTick != 0 && r.tick-p.aiLastSeenTick <= 18 && (!outside || len(p.trail) <= huntTrailMax) {
		if p.aiLastSeenType == 1 {
			enemy := r.players[p.aiLastSeenNum]
			dd := manhattan(p.x, p.y, p.aiLastSeenX, p.aiLastSeenY)
			// G2: this branch used to have no gate at all, so a single long
			// loop pulled every bot that could see it. Now it rolls the tier
			// gate and still has to fit under the hunter cap.
			gate := p.aiHuntGate * (0.35 + 0.50*localAgg)
			if r.rng.Float32() < gate && r.canHunt(p, enemy, p.aiLastSeenX, p.aiLastSeenY, dd) {
				r.enterHunt(p, enemy.num, p.aiLastSeenX, p.aiLastSeenY, p.aiLastSeenNum, uint32(8+r.rng.Intn(10)))
			}
		} else if p.aiLastSeenType == 2 {
			enemy := r.players[p.aiLastSeenNum]
			if enemy != nil && enemy.alive {
				enemyOnOwn := r.gridOwner[r.idx(enemy.x, enemy.y)] == enemy.num
				if !enemyOnOwn {
					dd := manhattan(p.x, p.y, p.aiLastSeenX, p.aiLastSeenY)
					gate := (0.10 + 0.55*localRisk) * (0.35 + 0.65*localAgg)
					if r.rng.Float32() < gate && r.canHunt(p, enemy, p.aiLastSeenX, p.aiLastSeenY, dd) {
						r.enterHunt(p, enemy.num, p.aiLastSeenX, p.aiLastSeenY, 0, uint32(6+r.rng.Intn(8)))
					}
				}
			}
		}
	}

	if outside && len(p.trail) > 0 {
		closeD := r.estimateReturnSteps(p.num, p.x, p.y)
		minCut := r.worstCaseCutDistToTrail(p, 40)
		margin := 2 + int(7*float32(p.aiBaitSense))
		if p.aiCaution > 0.55 {
			margin += 1
		}
		if minCut+margin < closeD {
			r.leaveHunt(p)
			p.aiMode = 1
			p.aiExpandPhase = 0
		}
	}

	if p.aiModeUntil != 0 && r.tick < p.aiModeUntil {
		// keep mode
	} else {
		p.aiModeUntil = 0
		tryHunt := func(maxBotDist int) bool {
			// G17: the full trail scan is the single most expensive thing a
			// bot does. Run it every few ticks, not every decision, and give
			// each bot its own phase so they do not all scan the same tick.
			if p.aiHuntScanTick != 0 && r.tick-p.aiHuntScanTick < BotHuntScanEvery {
				return false
			}
			p.aiHuntScanTick = r.tick + uint32(r.rng.Intn(2))
			bestScore := -9999
			bestOwner := uint16(0)
			bestX := -1
			bestY := -1
			bestDist := 9999
			minX, minY, maxX, maxY := r.botROIBounds(p)
			probes := 0
			for yy := minY; yy < maxY && probes < BotHuntMaxProbes; yy++ {
				row := yy * W
				for xx := minX; xx < maxX; xx++ {
					i := row + xx
					o := r.trailOwner[i]
					if o == 0 || o == p.num {
						continue
					}
					enemy := r.players[o]
					if enemy == nil || !enemy.alive {
						continue
					}
					// BFS distance is never below the manhattan distance, so
					// this prefilter is free and prunes most of the ROI.
					if manhattan(p.x, p.y, xx, yy) > maxBotDist {
						continue
					}
					if !r.botMayHunt(p, xx, yy, manhattan(p.x, p.y, xx, yy)) {
						continue
					}
					if !r.canHunt(p, enemy, xx, yy, manhattan(p.x, p.y, xx, yy)) {
						continue
					}
					probes++
					if probes > BotHuntMaxProbes {
						break
					}
					botDist := r.bfsToCell(p.x, p.y, i, o, 26)
					if botDist >= 9999 {
						continue
					}
					if botDist > maxBotDist {
						continue
					}
					// G9: no exact knowledge of the enemy's way home; only
					// what the bot can see inside its own ROI.
					enemyReturn := r.visibleReturnEstimate(p, enemy, minX, minY, maxX, maxY)
					margin := 2 + int(5*float32(p.aiCaution))
					if p.aiArchetype == ArchCoward {
						// Cowards only take fights they cannot lose.
						margin += 4
					}
					win := enemyReturn - (botDist + margin)
					aggr := 0
					if p.contractType == ContractKills {
						aggr = 4
					} else if localAgg > 0.35 {
						aggr = 2
					}
					if p.aiArchetype == ArchCoward {
						aggr = 0
					}
					if win < -aggr {
						continue
					}
					sc := win*12 - botDist
					if p.contractType == ContractKills {
						sc += 14
					}
					if wantCatchup && o == leaderNum {
						sc += 24
					} else if isLeader {
						sc -= 6
					}
					if sc > bestScore {
						bestScore = sc
						bestOwner = o
						bestX = xx
						bestY = yy
						bestDist = botDist
					}
				}
			}
			if bestOwner != 0 && bestDist <= maxBotDist {
				r.enterHunt(p, bestOwner, bestX, bestY, bestOwner, uint32(10+r.rng.Intn(12)))
				return true
			}
			return false
		}

		if outside {
			closeD := r.estimateReturnSteps(p.num, p.x, p.y)
			minCut := 9999
			k := 60
			if len(p.trail) < k {
				k = len(p.trail)
			}
			// G9: same ROI gate as worstCaseCutDistToTrail — a bot must not
			// retreat from someone it cannot see.
			cminX, cminY, cmaxX, cmaxY := r.botROIBounds(p)
			for _, o := range r.players {
				if o == nil || !o.alive || o.num == p.num {
					continue
				}
				if o.x < cminX || o.x >= cmaxX || o.y < cminY || o.y >= cmaxY {
					continue
				}
				for i := len(p.trail) - 1; i >= 0 && i >= len(p.trail)-k; i-- {
					cell := p.trail[i]
					xx := cell % W
					yy := cell / W
					d := manhattan(o.x, o.y, xx, yy)
					if d < minCut {
						minCut = d
						if minCut <= 2 {
							break
						}
					}
				}
			}
			margin := 2 + int(5*float32(p.aiCaution))
			if minCut+margin < closeD {
				r.leaveHunt(p)
				p.aiMode = 1
				p.aiExpandPhase = 0
			} else {
				r.leaveHunt(p)
				if len(p.trail) <= huntTrailMax {
					_ = tryHunt(22)
				}
			}
		} else {
			r.leaveHunt(p)
			if !tryHunt(18) {
				p.aiMode = 0
			}
		}
	}

	if p.aiMode == 3 {
		d := r.bestGreedyDir(p, p.aiTargetX, p.aiTargetY)
		r.botTrySetDir(p, d, true)
		return
	}

	// F5: drive at the cooling patch until it is reclaimed or gone.
	if p.aiMode == 5 {
		i := p.aiCoolCell
		if r.coolOwner == nil || i < 0 || i >= N ||
			r.coolOwner[i] != p.num || r.coolUntil[i] <= r.tick {
			p.aiMode = 0
			p.aiModeUntil = 0
			p.aiCoolCell = -1
		} else {
			d, ok := r.pickDirToCell(p, i, 0)
			if !ok {
				d = r.bestGreedyDir(p, p.aiTargetX, p.aiTargetY)
			}
			if r.lookaheadBad(p, d, 2, 0) {
				d = r.pickDirToOwned(p)
			}
			r.botTrySetDir(p, d, urgent)
			return
		}
	}

	if p.aiMode == 4 {
		if !inBounds(p.aiTargetX, p.aiTargetY) {
			p.aiMode = 0
			p.aiModeUntil = 0
		} else {
			ti := r.idx(p.aiTargetX, p.aiTargetY)
			if r.powerUpIndexAtCell(ti) < 0 {
				p.aiMode = 0
				p.aiModeUntil = 0
			} else {
				d, ok := r.pickDirToCell(p, ti, 0)
				if !ok {
					d = r.bestGreedyDir(p, p.aiTargetX, p.aiTargetY)
				}
				if r.lookaheadBad(p, d, 2, 0) {
					d = r.pickDirToOwned(p)
				}
				r.botTrySetDir(p, d, urgent)
				return
			}
		}
	}

	if p.aiMode == 2 {
		if v := r.players[p.aiHuntWho]; p.aiHuntWho != 0 && (v == nil || !v.alive) {
			r.leaveHunt(p)
		}
		if p.aiMode == 2 && p.aiHuntTarget != 0 {
			enemy := r.players[p.aiHuntTarget]
			if enemy == nil || !enemy.alive {
				r.leaveHunt(p)
			} else if !inBounds(p.aiTargetX, p.aiTargetY) {
				r.leaveHunt(p)
			} else {
				targetI := r.idx(p.aiTargetX, p.aiTargetY)
				if r.trailOwner[targetI] != p.aiHuntTarget {
					r.leaveHunt(p)
				} else if r.bfsToCell(p.x, p.y, targetI, p.aiHuntTarget, 24) >= 9999 {
					r.leaveHunt(p)
				}
			}
		}
		if p.aiMode != 2 {
			p.aiExpandPhase = 0
		} else {
			// G14: hold a straight line at the target for a few ticks before
			// the chase proper, so the player gets a visible windup.
			if p.aiWindupUntil != 0 {
				if r.tick < p.aiWindupUntil {
					wd := p.aiWindupDir
					if !isOpposite(p.dir, wd) && !r.lookaheadBad(p, wd, 2, p.aiHuntTarget) {
						r.botTrySetDir(p, wd, true)
						return
					}
				}
				p.aiWindupUntil = 0
			}
			targetI := r.idx(p.aiTargetX, p.aiTargetY)
			d, ok := r.pickDirToCell(p, targetI, p.aiHuntTarget)
			if !ok {
				d = r.bestGreedyDir(p, p.aiTargetX, p.aiTargetY)
			}
			if r.lookaheadBad(p, d, 2, p.aiHuntTarget) {
				d = r.pickDirToOwned(p)
			}
			r.botTrySetDir(p, d, urgent)
			return
		}
	}

	if p.aiMode == 1 {
		if outside && len(p.trail) > 0 {
			if gi, ok := r.pickCloseGateCell(p); ok {
				p.aiTargetX = gi % W
				p.aiTargetY = gi / W
				d, ok2 := r.pickDirToCell(p, gi, 0)
				if !ok2 {
					d = r.bestGreedyDir(p, p.aiTargetX, p.aiTargetY)
				}
				r.botTrySetDir(p, d, true)
				return
			}
		}
		d := r.pickDirToOwned(p)
		r.botTrySetDir(p, d, urgent)
		return
	}

	// expand: prefer going forward, but occasionally turn to grow area
	if outside {
		trailLen := len(p.trail)
		budget := r.botTrailBudget(p, localRisk, localCaution)
		if isLeader && lead >= 20 {
			budget -= 3
		}
		if budget < 6 {
			budget = 6
		}
		// closeStart scales with the budget instead of bottoming out at a
		// flat 6, which used to make a third of the roster behave identically.
		closeStart := int(float32(budget)*botCloseFrac(p)) + 1
		if p.contractType == ContractCapture {
			closeStart += 2
		}
		if closeStart < 4 {
			closeStart = 4
		}
		if closeStart > budget {
			closeStart = budget
		}
		if isLeader && lead >= 20 {
			closeStart -= 2
		}
		if r.mutatorType == MutatorDoubleCapture {
			closeStart -= 2
		}
		if closeStart < 4 {
			closeStart = 4
		}
		if trailLen >= closeStart {
			r.leaveHunt(p)
			p.aiMode = 1
			if gi, ok := r.pickCloseGateCell(p); ok {
				p.aiTargetX = gi % W
				p.aiTargetY = gi / W
				d, ok2 := r.pickDirToCell(p, gi, 0)
				if !ok2 {
					d = r.bestGreedyDir(p, p.aiTargetX, p.aiTargetY)
				}
				r.botTrySetDir(p, d, true)
				return
			}
			d := r.pickDirToOwned(p)
			r.botTrySetDir(p, d, true)
			return
		}
		if trailLen >= budget {
			d := r.pickDirToOwned(p)
			r.botTrySetDir(p, d, true)
			return
		}
		if dmm, ok := r.minimaxOutsideDir(p); ok {
			r.botTrySetDir(p, dmm, urgent)
			return
		}
		if len(p.trail) > budget {
			d := r.pickDirToOwned(p)
			r.botTrySetDir(p, d, urgent)
			return
		}
		bd := p.x
		if p.y < bd {
			bd = p.y
		}
		rd := (W - 1) - p.x
		if rd < bd {
			bd = rd
		}
		dn := (H - 1) - p.y
		if dn < bd {
			bd = dn
		}
		if bd <= 2 && len(p.trail) > 0 {
			d := r.pickDirToOwned(p)
			r.botTrySetDir(p, d, true)
			return
		}
	}

	if p.aiExpandUntil != 0 && r.tick >= p.aiExpandUntil {
		p.aiExpandPhase = 0
	}
	if p.aiExpandPhase == 0 {
		r.planExpand(p, s)
	}
	if p.aiExpandPhase == 4 {
		if p.x == p.aiTargetX && p.y == p.aiTargetY {
			r.startExpandFromBoundary(p)
		} else {
			targetI := r.idx(p.aiTargetX, p.aiTargetY)
			d, ok := r.pickDirToCell(p, targetI, 0)
			if !ok {
				d = r.bestGreedyDir(p, p.aiTargetX, p.aiTargetY)
			}
			if r.lookaheadBad(p, d, 2, 0) {
				d = r.pickDirToOwned(p)
			}
			r.botTrySetDir(p, d, urgent)
			return
		}
	}
	if p.aiExpandPhase == 1 || p.aiExpandPhase == 2 {
		d := p.aiExpandDir
		if p.aiExpandPhase == 1 && p.aiExpandOutLeft == 0 {
			if p.aiExpandTurn < 0 {
				p.aiExpandDir = turnLeft(p.aiExpandDir)
			} else {
				p.aiExpandDir = turnRight(p.aiExpandDir)
			}
			p.aiExpandPhase = 2
			d = p.aiExpandDir
		}
		if p.aiExpandPhase == 2 && p.aiExpandSideLeft == 0 {
			p.aiExpandPhase = 3
		}
		if p.aiExpandPhase == 1 || p.aiExpandPhase == 2 {
			dx, dy := dirToDelta(d)
			nx := p.x + dx
			ny := p.y + dy
			bad := r.lookaheadBad(p, d, 3, 0)
			if !bad && r.recentPenalty(p, nx, ny) >= 48 {
				bad = true
			}
			if !bad && inBounds(nx, ny) {
				i := r.idx(nx, ny)
				adj := 0
				if nx > 0 && r.trailOwner[i-1] == p.num {
					adj++
				}
				if nx < W-1 && r.trailOwner[i+1] == p.num {
					adj++
				}
				if ny > 0 && r.trailOwner[i-W] == p.num {
					adj++
				}
				if ny < H-1 && r.trailOwner[i+W] == p.num {
					adj++
				}
				if adj >= 2 {
					bad = true
				}
			}
			if bad {
				p.aiExpandPhase = 3
			} else {
				r.botTrySetDir(p, d, urgent)
				if p.aiExpandPhase == 1 && p.aiExpandOutLeft > 0 {
					p.aiExpandOutLeft--
				}
				if p.aiExpandPhase == 2 && p.aiExpandSideLeft > 0 {
					p.aiExpandSideLeft--
				}
				return
			}
		}
	}
	if p.aiExpandPhase == 3 {
		d := r.pickDirToOwned(p)
		if r.lookaheadBad(p, d, 2, 0) {
			p.aiExpandPhase = 0
		}
		r.botTrySetDir(p, d, urgent)
		return
	}

	best := p.pendingDir
	bestScore := int32(-1 << 30)
	dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
	for _, d := range dirs {
		if isOpposite(p.dir, d) {
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
		owner := r.gridOwner[i]
		if owner == 0 {
			score += 14
		} else if owner != p.num {
			score += 10
		}
		// G6: take the free kill instead of steering around it.
		score += r.freeKillBonus(p, i)
		if d == p.dir {
			score += 4
		}
		if r.lookaheadBad(p, d, 3, 0) {
			score -= 80
		}
		if pen := r.recentPenalty(p, nx, ny); pen > 0 {
			score -= pen * 2
		}
		for _, o := range r.players {
			if o == nil || !o.alive || o.num == p.num {
				continue
			}
			ox, oy, okn := r.predictedNextCell(o)
			if okn && ox == nx && oy == ny {
				score -= 140
				continue
			}
			if manhattan(o.x, o.y, nx, ny) == 1 {
				score -= 55
				break
			}
		}
		// avoid tight turns near own trail to reduce self_trail
		adj := 0
		if nx > 0 && r.trailOwner[i-1] == p.num {
			adj++
		}
		if nx < W-1 && r.trailOwner[i+1] == p.num {
			adj++
		}
		if ny > 0 && r.trailOwner[i-W] == p.num {
			adj++
		}
		if ny < H-1 && r.trailOwner[i+W] == p.num {
			adj++
		}
		if adj > 0 {
			score -= int32(adj * 14)
		}
		// avoid borders to reduce "wall" deaths
		bd := nx
		if ny < bd {
			bd = ny
		}
		rd := (W - 1) - nx
		if rd < bd {
			bd = rd
		}
		dn := (H - 1) - ny
		if dn < bd {
			bd = dn
		}
		if bd <= 0 {
			score -= 200
		} else if bd == 1 {
			score -= 60
		} else if bd == 2 {
			score -= 16
		}
		if urgent {
			score += int32(manhattan(nx, ny, s.enemyHeadX, s.enemyHeadY))
		}
		if score > bestScore {
			bestScore = score
			best = d
		}
	}
	// G17: this is the only consumer of botPickDirOutside, so compute it here
	// instead of on every decision tick and throwing it away.
	if outside && p.aiMode == 0 && p.aiExpandPhase == 0 {
		if outsideHint, ok := r.botPickDirOutside(p); ok && !r.lookaheadBad(p, outsideHint, 3, 0) {
			best = outsideHint
		}
	}
	r.botTrySetDir(p, best, urgent)
}

func (r *Room) bestGreedyDir(p *Player, tx, ty int) Dir {
	best := p.dir
	bestD := 9999
	found := false
	dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
	for _, d := range dirs {
		if isOpposite(p.dir, d) {
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
		d2 := manhattan(nx, ny, tx, ty)
		if d2 < bestD {
			bestD = d2
			best = d
			found = true
		}
	}
	if found {
		return best
	}
	for _, d := range dirs {
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
		d2 := manhattan(nx, ny, tx, ty)
		if d2 < bestD {
			bestD = d2
			best = d
			found = true
		}
	}
	if found {
		return best
	}
	// Last resort: any safe direction (prevents wall/self_trail when all heuristics fail)
	for _, d := range dirs {
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
		return d
	}
	return p.dir
}
