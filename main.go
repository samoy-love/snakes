package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"nhooyr.io/websocket"
)

var debugBotDeathSnap = os.Getenv("BOT_DEATH_SNAP") == "1"

type Dir uint8

const (
	DirUp Dir = iota
	DirDown
	DirLeft
	DirRight
)

const (
	W      = 200
	H      = 140
	N      = W * H
	TickMS = 100
)

var (
	MatchDurationTicks     uint32 = 3000
	MatchIntermissionTicks uint32 = 150
)

func init() {
	if v := os.Getenv("MATCH_DURATION_TICKS"); v != "" {
		if n, err := parseInt(v); err == nil && n > 0 {
			MatchDurationTicks = uint32(n)
		}
	}
	if v := os.Getenv("MATCH_INTERMISSION_TICKS"); v != "" {
		if n, err := parseInt(v); err == nil && n > 0 {
			MatchIntermissionTicks = uint32(n)
		}
	}
}

const (
	FullSnapshotEveryTicks = 20
	MaxDeltaChanges        = 9000
)

const (
	RoomHumanLimitDefault = 16
	ChatMaxLen            = 180
	ChatHistoryMax        = 80
	ChatMinInterval       = 500 * time.Millisecond
	NameMaxLen            = 18
	RoomNameMaxLen        = 32
)

const (
	MaxClientWSMsgBytes = 16 * 1024
	// Max time enqueue() may block on a full client queue before the client
	// is dropped. Keep small: broadcasts run on the room tick goroutine.
	SendBackpressureTimeout = 100 * time.Millisecond
)

// allowedWSOrigins is the WebSocket origin allowlist. It is seeded from the
// WS_ORIGINS env var (comma-separated), falling back to the production host.
// Without this, any deployment on a different domain — including Docker — is
// rejected at the handshake.
var allowedWSOrigins = loadAllowedWSOrigins()

func loadAllowedWSOrigins() map[string]struct{} {
	out := make(map[string]struct{})
	raw := strings.TrimSpace(os.Getenv("WS_ORIGINS"))
	if raw == "" {
		out["https://snakes.samoy.love"] = struct{}{}
		out["http://snakes.samoy.love"] = struct{}{}
		return out
	}
	for _, part := range strings.Split(raw, ",") {
		if o := normalizeWSOrigin(part); o != "" {
			out[o] = struct{}{}
		}
	}
	return out
}

// Build metadata, injected by the linker:
//
//	-ldflags "-X main.Version=... -X main.Commit=... -X main.BuildTime=..."
var (
	Version   = "dev"
	Commit    = "none"
	BuildTime = "unknown"
)

func init() {
	log.Printf("snakes build version=%s commit=%s buildTime=%s", Version, Commit, BuildTime)
}

// CosmeticsMaxID is the highest cosmetic id; the inventory mask is a uint8, so
// exactly 8 slots (0..7) fit per category.
const CosmeticsMaxID = 7

// cosmeticsPrices is the single source of truth for shop prices: per category,
// per id. Index 0 is the free default that every profile owns. Server code and
// the payload sent to the client both read this table, never a literal.
var cosmeticsPrices = map[string][CosmeticsMaxID + 1]uint16{
	"frame":     {0, 30, 45, 85, 115, 200, 330, 550},
	"nameplate": {0, 40, 60, 105, 140, 240, 390, 640},
	"seg":       {0, 160, 55, 210, 360, 90, 580, 950},
	"head":      {0, 50, 75, 135, 175, 300, 500, 800},
	"capturefx": {0, 65, 100, 180, 240, 410, 660, 1050},
	// Territory fill style: the largest painted surface on screen.
	"terr": {0, 60, 90, 150, 220, 360, 600, 980},
	// Death effect: seen by the victim and the killer alike.
	"death": {0, 55, 85, 140, 210, 340, 560, 900},
}

func cosmeticsCatKey(cat string) string {
	return strings.TrimSpace(strings.ToLower(cat))
}

// cosmeticsCatValid reports whether the category exists.
func cosmeticsCatValid(cat string) bool {
	_, ok := cosmeticsPrices[cosmeticsCatKey(cat)]
	return ok
}

// cosmeticsPriceFor returns the price of one item, false for unknown cat/id.
func cosmeticsPriceFor(cat string, id uint8) (uint16, bool) {
	row, ok := cosmeticsPrices[cosmeticsCatKey(cat)]
	if !ok || id > CosmeticsMaxID {
		return 0, false
	}
	return row[id], true
}

// cosmeticsPricesPayload renders the price table for the "hello" message.
func cosmeticsPricesPayload() map[string]any {
	out := make(map[string]any, len(cosmeticsPrices))
	for cat, row := range cosmeticsPrices {
		list := make([]uint16, len(row))
		copy(list, row[:])
		out[cat] = list
	}
	return out
}

func (r *Room) awardPoints(num uint16, base uint16, reason uint8) {
	if num == 0 || base == 0 {
		return
	}
	p := r.players[num]
	if p == nil || !p.alive {
		return
	}
	if reason > PointsCapture {
		reason = PointsOther
	}
	// The leader is the best score in the room, dead or alive: using only living
	// players made every multiplier jump around while the leader lay dead.
	best := uint16(0)
	for _, o := range r.players {
		if o == nil {
			continue
		}
		if v := r.points[o.num]; v > best {
			best = v
		}
	}
	me := r.points[num]
	mult := float32(1.0)
	// Rubber-band only starts after the match has "some" points to avoid early randomness.
	if best >= 20 {
		d := float32(int(best) - int(me))
		// Smooth, capped curve: ~+70% at large deficit, -10% when far ahead.
		// The leader penalty stays mild on purpose; the catch-up bonus is the
		// part that is allowed to bite.
		x := d / 120.0
		if x > 0.70 {
			x = 0.70
		} else if x < -0.10 {
			x = -0.10
		}
		mult = 1.0 + x
	}
	// No per-event cap: clamping to base+10 used to eat the whole catch-up bonus.
	// Only overflow protection remains.
	addF := float32(base)*mult + 0.0001
	add := uint16(0)
	if addF >= float32(^uint16(0)) {
		add = ^uint16(0)
	} else {
		add = uint16(addF)
	}
	if add == 0 {
		add = 1
	}
	actualAdd := add
	if me > ^uint16(0)-add {
		r.points[num] = ^uint16(0)
		actualAdd = ^uint16(0) - me
	} else {
		r.points[num] = me + add
	}
	if actualAdd > 0 {
		v := r.matchPointsBy[num]
		cur := v[reason]
		if cur > ^uint16(0)-actualAdd {
			v[reason] = ^uint16(0)
		} else {
			v[reason] = cur + actualAdd
		}
		r.matchPointsBy[num] = v
	}
}

// freeKillBonus rewards stepping onto an enemy trail cell that will actually
// kill its owner. Shielded owners and players still in spawn grace are worth
// nothing, so they get no bonus (G6).
func (r *Room) freeKillBonus(p *Player, i int) int32 {
	if i < 0 || i >= N {
		return 0
	}
	to := r.trailOwner[i]
	if to == 0 || to == p.num {
		return 0
	}
	o := r.players[to]
	if o == nil || !o.alive || o.shield > 0 || r.hasSpawnGrace(o) {
		return 0
	}
	if p.aiAggression < 0.35 {
		return 50
	}
	return 120
}

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

// dailyGoalFor picks the goal for a daily type in a given slot. Slot 1 is the
// hardest, slot 3 sits in the middle.
func dailyGoalFor(slot uint8, t uint8) uint16 {
	switch t {
	case DailyKills:
		switch slot {
		case 1:
			return 5
		case 2:
			return 3
		default:
			return 4
		}
	case DailyPickups:
		switch slot {
		case 1:
			return 4
		case 2:
			return 2
		default:
			return 3
		}
	case DailyCapture:
		switch slot {
		case 1:
			return 260
		case 2:
			return 160
		default:
			return 200
		}
	case DailyStyle:
		switch slot {
		case 1:
			return 120
		case 2:
			return 80
		default:
			return 100
		}
	}
	return 0
}

func (r *Room) ensureProfileDailyLocked(p *Profile) {
	if p == nil {
		return
	}
	today := dayStampNow()
	if p.Day != today {
		p.Day = today
		p.DailyType1 = 0
		p.DailyGoal1 = 0
		p.DailyProg1 = 0
		p.DailyType2 = 0
		p.DailyGoal2 = 0
		p.DailyProg2 = 0
		p.DailyType3 = 0
		p.DailyGoal3 = 0
		p.DailyProg3 = 0
		// Login streak: consecutive days keep counting, a gap restarts at 1.
		if p.StreakLastDay == today-1 && p.StreakDays > 0 {
			if p.StreakDays < ^uint32(0) {
				p.StreakDays++
			}
		} else {
			p.StreakDays = 1
		}
		p.StreakLastDay = today
	}
	roll := func(slot uint8, t *uint8, goal *uint16, prog *uint16) {
		if *t != 0 {
			return
		}
		nt := uint8(1 + r.rng.Intn(4))
		*t = nt
		*goal = dailyGoalFor(slot, nt)
		*prog = 0
	}
	roll(1, &p.DailyType1, &p.DailyGoal1, &p.DailyProg1)
	roll(2, &p.DailyType2, &p.DailyGoal2, &p.DailyProg2)
	roll(3, &p.DailyType3, &p.DailyGoal3, &p.DailyProg3)
}

// dailyStreakMultLocked returns the daily reward multiplier: 1 + 0.25*(streak-1),
// capped at x2. Caller holds profilesMu.
func dailyStreakMultLocked(pr *Profile) float32 {
	if pr == nil || pr.StreakDays <= 1 {
		return 1.0
	}
	m := 1.0 + 0.25*float32(pr.StreakDays-1)
	if m > 2.0 {
		m = 2.0
	}
	return m
}

func (r *Room) sendDailyStateToPlayer(p *Player) {
	if p == nil || p.bot {
		return
	}
	pr := profileForKey(p.profileKey)
	if pr == nil {
		return
	}
	type slotState struct {
		slot uint8
		t    uint8
		goal uint16
		prog uint16
	}
	profilesMu.Lock()
	r.ensureProfileDailyLocked(pr)
	slots := [3]slotState{
		{1, pr.DailyType1, pr.DailyGoal1, pr.DailyProg1},
		{2, pr.DailyType2, pr.DailyGoal2, pr.DailyProg2},
		{3, pr.DailyType3, pr.DailyGoal3, pr.DailyProg3},
	}
	profilesMu.Unlock()
	markProfilesDirty()

	for _, s := range slots {
		r.pushEvent(Event{Kind: EventDailyAssign, A: p.num, B: s.goal, C: (uint32(s.t) << 16) | uint32(s.prog), D: s.slot})
	}
}

// checkAchievementsLocked unlocks every achievement whose profile counter has
// reached its threshold and returns how many were newly unlocked. The caller
// must pay out the rewards AFTER releasing profilesMu (addStyle takes it).
// Caller holds profilesMu.
func (r *Room) checkAchievementsLocked(p *Player, pr *Profile) int {
	if p == nil || pr == nil {
		return 0
	}
	n := 0
	for _, ru := range achvRules {
		bit := uint32(1) << uint32(ru.code)
		if pr.AchvMask&bit != 0 {
			continue
		}
		if ru.get(pr) < ru.need {
			continue
		}
		pr.AchvMask |= bit
		r.pushEvent(Event{Kind: EventAchievement, A: p.num, D: ru.code})
		n++
	}
	return n
}

// grantAchievementRewards pays out unlocks found by checkAchievementsLocked.
// Must be called without profilesMu held.
func (r *Room) grantAchievementRewards(p *Player, count int) {
	for i := 0; i < count; i++ {
		r.addStyle(p, StyleAchvReward, StyleAchievement)
	}
}

// grantDailyRewards pays out completed daily slots, scaled by the login streak.
// Must be called without profilesMu held. dailyRewardDepth keeps the payout
// from feeding the "earn Style" daily back into itself (see addStyle).
func (r *Room) grantDailyRewards(p *Player, count int) {
	if p == nil || count <= 0 {
		return
	}
	mult := float32(1.0)
	if !p.bot {
		if pr := profileForKey(p.profileKey); pr != nil {
			profilesMu.Lock()
			mult = dailyStreakMultLocked(pr)
			profilesMu.Unlock()
		}
	}
	reward := uint16(float32(StyleDailyReward)*mult + 0.5)
	if p.dailyRewardDepth < ^uint8(0) {
		p.dailyRewardDepth++
	}
	for i := 0; i < count; i++ {
		r.addStyle(p, reward, StyleDaily)
		r.awardPoints(p.num, 14, PointsDaily)
	}
	if p.dailyRewardDepth > 0 {
		p.dailyRewardDepth--
	}
}

// grantFirstWinBonus pays the once-per-day "first win" bonus (E7).
func (r *Room) grantFirstWinBonus(p *Player) {
	if p == nil || p.bot {
		return
	}
	pr := profileForKey(p.profileKey)
	if pr == nil {
		return
	}
	today := dayStampNow()
	profilesMu.Lock()
	eligible := pr.FirstWinDay != today
	if eligible {
		pr.FirstWinDay = today
	}
	profilesMu.Unlock()
	if !eligible {
		return
	}
	markProfilesDirty()
	r.addStyle(p, StyleFirstWinBonus, StyleWin)
}

func (r *Room) addDailyProgress(p *Player, kind uint8, inc uint16) {
	if p == nil || p.bot || inc == 0 {
		return
	}
	pr := profileForKey(p.profileKey)
	if pr == nil {
		return
	}
	profilesMu.Lock()
	r.ensureProfileDailyLocked(pr)
	rewardCount := r.addDailyProgressLocked(p, pr, kind, inc)
	profilesMu.Unlock()
	markProfilesDirty()
	r.grantDailyRewards(p, rewardCount)
}

func (r *Room) addDailyProgressLocked(p *Player, pr *Profile, kind uint8, inc uint16) int {
	if p == nil || pr == nil || inc == 0 {
		return 0
	}
	rewardCount := 0
	apply := func(slot uint8, t uint8, goal *uint16, prog *uint16) {
		if t != kind {
			return
		}
		if *goal == 0 {
			return
		}
		if *prog >= *goal {
			return
		}
		left := *goal - *prog
		add := inc
		if add > left {
			add = left
		}
		*prog += add
		r.pushEvent(Event{Kind: EventDailyProgress, A: p.num, B: *prog, D: slot})
		if *prog >= *goal {
			r.pushEvent(Event{Kind: EventDailyComplete, A: p.num, D: slot})
			rewardCount++
		}
	}
	apply(1, pr.DailyType1, &pr.DailyGoal1, &pr.DailyProg1)
	apply(2, pr.DailyType2, &pr.DailyGoal2, &pr.DailyProg2)
	apply(3, pr.DailyType3, &pr.DailyGoal3, &pr.DailyProg3)
	return rewardCount
}

const (
	MsgStateBinary  = 1
	MsgROIBinary    = 2
	MsgEventsBinary = 5
	MsgMinimapChunk = 4
)

const (
	EventKill             = 1
	EventStreak           = 2
	EventBountyAssign     = 3
	EventBountyClaim      = 4
	EventPowerupSpawn     = 5
	EventPowerupPickup    = 6
	EventPowerupUse       = 9
	EventMutatorStart     = 7
	EventMutatorEnd       = 8
	EventContractAssign   = 10
	EventContractProgress = 11
	EventContractComplete = 12
	EventStyle            = 13
	EventRevenge          = 14
	EventDailyAssign      = 15
	EventDailyProgress    = 16
	EventDailyComplete    = 17
	EventAchievement      = 18
	EventCapture          = 19
	// EventReclaim: F5, a player took his cooling territory back.
	EventReclaim = 20
	// EventCoolBatch: F5, one death's worth of territory started cooling.
	// Sent once per death so the client can run its own countdown over the
	// cells it already sees flagged with coolOwnerFlag.
	EventCoolBatch = 21
)

const (
	ContractNone    = 0
	ContractKills   = 1
	ContractPickups = 2
	ContractCapture = 3
)

const (
	StyleKill        = 1
	StyleRevenge     = 2
	StyleBounty      = 3
	StyleContract    = 4
	StyleDaily       = 5
	StyleWin         = 6
	StyleTop5        = 7
	StyleCapture     = 8
	StyleAchievement = 9
)

// StyleReasonCount sizes the per-match breakdown arrays (matchResult.Sb): the
// highest reason code plus one.
const StyleReasonCount = 10

// Per-match Style budgets and rates.
const (
	StyleCaptureCellsPer = 40  // cells captured per 1 Style
	StyleCaptureMatchCap = 25  // E2: max Style from captures per match
	StyleKillMatchCap    = 100 // E4: max Style from kills (incl. streaks) per match

	StyleKillHuman   = 14
	StyleKillBot     = 5
	StyleKillBotLate = 2 // after BotKillFullRateCount bot kills in one match
	BotKillFullRate  = 10

	StyleContractReward = 20 // E5
	StyleDailyReward    = 45 // E7
	StyleAchvReward     = 50 // E8
	StyleFirstWinBonus  = 50 // E7
	StyleBountySurvive  = 30 // E11
	PointsBountySurvive = 20

	// E3: placement rewards use the absolute place among every participant.
	StylePlace1  = 40
	StylePlace23 = 25
	StylePlace45 = 15

	// E13: soft daily income ceiling; everything past it pays 40%.
	// Raised 600 -> 800 after the "terr" and
	// "death" categories added 4750 Style to the full collection (14865 total):
	// at 600 the average player needed ~24 days to close the shop instead of
	// the intended 2-3 weeks. Reclaim itself does not inflate income — the
	// reclaim path bypasses the capture Style award, which is capped anyway.
	StyleDaySoftCap    = 800
	StyleOverCapNumer  = 2
	StyleOverCapDenom  = 5
	MaxContractsMatch  = 4 // E5
	StyleAddMaxDepth   = 4 // E12: hard bound on addStyle re-entrancy
	SpawnGraceTicks    = 15
	KillStreakWindow   = 150 // F9
	BountyWindowTicks  = 700
	BountyCooldown     = 400 // E11
	BountyCooldownLate = 150 // F4: the final phase re-arms the bounty faster
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

const (
	PointsOther    = 0
	PointsKill     = 1
	PointsRevenge  = 2
	PointsBounty   = 3
	PointsContract = 4
	PointsDaily    = 5
	PointsCapture  = 6
)

const (
	PowerupShield   = 1
	PowerupDash     = 2
	PowerupNova     = 3
	PowerupMegaDash = 4
)

const (
	DailyKills   = 1
	DailyPickups = 2
	DailyCapture = 3
	DailyStyle   = 4
)

// Achievement codes. They index bits of Profile.AchvMask (uint32), so the
// highest usable code is 31. Codes 1-5 are the original set and must not move.
const (
	AchvKills10    = 1
	AchvBounty3    = 2
	AchvContracts3 = 3
	AchvStyle200   = 4
	AchvRevenge3   = 5

	AchvKills100     = 6
	AchvKills1000    = 7
	AchvContracts25  = 8
	AchvContracts100 = 9
	AchvCapture1k    = 10
	AchvCapture10k   = 11
	AchvCapture100k  = 12
	AchvBounty15     = 13
	AchvRevenge15    = 14
	AchvStyle2000    = 15
	AchvStyle10000   = 16
	AchvPickups25    = 17
	AchvPickups250   = 18
	AchvStreak3      = 19
	AchvStreak7      = 20
	AchvStreak30     = 21
)

// achvRule binds an achievement code to a profile counter and its threshold.
type achvRule struct {
	code uint8
	need uint32
	get  func(pr *Profile) uint32
}

var achvRules = []achvRule{
	{AchvKills10, 10, func(pr *Profile) uint32 { return pr.TotalKills }},
	{AchvKills100, 100, func(pr *Profile) uint32 { return pr.TotalKills }},
	{AchvKills1000, 1000, func(pr *Profile) uint32 { return pr.TotalKills }},
	{AchvContracts3, 3, func(pr *Profile) uint32 { return pr.TotalContracts }},
	{AchvContracts25, 25, func(pr *Profile) uint32 { return pr.TotalContracts }},
	{AchvContracts100, 100, func(pr *Profile) uint32 { return pr.TotalContracts }},
	{AchvCapture1k, 1000, func(pr *Profile) uint32 { return pr.TotalCapture }},
	{AchvCapture10k, 10000, func(pr *Profile) uint32 { return pr.TotalCapture }},
	{AchvCapture100k, 100000, func(pr *Profile) uint32 { return pr.TotalCapture }},
	{AchvBounty3, 3, func(pr *Profile) uint32 { return pr.TotalBounty }},
	{AchvBounty15, 15, func(pr *Profile) uint32 { return pr.TotalBounty }},
	{AchvRevenge3, 3, func(pr *Profile) uint32 { return pr.TotalRevenge }},
	{AchvRevenge15, 15, func(pr *Profile) uint32 { return pr.TotalRevenge }},
	{AchvStyle200, 200, func(pr *Profile) uint32 { return pr.TotalStyleGained }},
	{AchvStyle2000, 2000, func(pr *Profile) uint32 { return pr.TotalStyleGained }},
	{AchvStyle10000, 10000, func(pr *Profile) uint32 { return pr.TotalStyleGained }},
	{AchvPickups25, 25, func(pr *Profile) uint32 { return pr.TotalPickups }},
	{AchvPickups250, 250, func(pr *Profile) uint32 { return pr.TotalPickups }},
	{AchvStreak3, 3, func(pr *Profile) uint32 { return pr.StreakDays }},
	{AchvStreak7, 7, func(pr *Profile) uint32 { return pr.StreakDays }},
	{AchvStreak30, 30, func(pr *Profile) uint32 { return pr.StreakDays }},
}

const (
	MutatorNone          = 0
	MutatorDoubleCapture = 1
	MutatorPowerSurge    = 2
)

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
	archMix = [ArchCount]int{4, 4, 3, 3}
)

const (
	// Hunter caps per victim (G2). Humans get the tighter one: being chased by
	// three bots at once is unreadable.
	HuntCapHuman = 2
	HuntCapBot   = 3

	// G14: windup before a hunt actually starts. The bot drives straight at
	// the target for a few ticks, which is the player's cue to react.
	HuntWindupMin = 3
	HuntWindupMax = 5

	// G17: tryHunt is the most expensive part of a bot tick, so it only runs
	// every few ticks and only over a bounded number of BFS probes.
	BotHuntScanEvery = 5
	BotHuntMaxProbes = 40
)

const (
	ROIWidth     = 80
	ROIHeight    = 56
	ROIStep      = 8
	ROILookahead = 12

	BonusBudgetMax          = 70
	BonusBudgetRegenPerTick = 1

	SpeedPickupLockTicks   = 80
	DashDuration           = 45
	DashDurationLocked     = 28
	DashMaxFromNow         = 70
	MegaDashDuration       = 95
	MegaDashDurationLocked = 55
	MegaDashMaxFromNow     = 130

	aiRecentCap = 12

	MinimapChunkW          = 10
	MinimapChunkH          = 10
	MinimapMaxChunksPerMsg = 128
	MinimapChunksX         = (W + MinimapChunkW - 1) / MinimapChunkW
	MinimapChunksY         = (H + MinimapChunkH - 1) / MinimapChunkH

	MinimapFullForcedEveryTicks = 30

	MinimapDeltaEveryTicks = 10  // ~1s
	MinimapFullEveryTicks  = 100 // ~10s
	MinimapMaxChanges      = 120000
)

type Hub struct {
	mu         sync.RWMutex
	rooms      map[int]*Room
	nextRoomID int
	roomLimit  int
}

type playerAnchor struct {
	x, y   int
	hx, hy int
	alive  bool
	dir    Dir
}

type roiReq struct {
	c         *Client
	rx, ry    int
	rw, rh    int
	full      bool
	sinceTick uint32
}

type Room struct {
	hub   *Hub
	id    int
	title string
	limit int

	mu sync.Mutex

	gridOwner  []uint16
	trailOwner []uint16
	gridPos    []int32
	gridStamp  []uint32
	trailStamp []uint32

	// F5 "Reclaim": cells of a dead player stay unowned but remembered for
	// ReclaimTicks. Their former owner takes the whole connected patch back by
	// touching any of it; after the deadline the patch is dropped for good.
	coolOwner []uint16
	coolUntil []uint32
	// coolBatches is the expiry work queue: one entry per death, processed with
	// a per-tick budget so a big estate never stalls a tick.
	coolBatches []coolBatch
	coolCursor  int

	changedGrid  []uint32
	changedTrail []uint32

	minimapGrid       []uint32
	minimapDirty      bool
	minimapFullActive bool
	minimapFullCursor int

	events []Event

	metaDirty    bool
	metaSentTick uint32

	bountyTarget uint16
	bountyUntil  uint32
	// E11: no new bounty may be assigned before this tick.
	bountyCooldownUntil uint32

	mutatorType  uint8
	mutatorUntil uint32

	powerUps      []PowerUp
	nextPowerUpID uint16

	players    map[uint16]*Player
	clients    map[*Client]struct{}
	chat       []ChatMessage
	knownNames map[uint16]KnownName

	scores map[uint16]uint16
	points map[uint16]uint16

	matchSeq         uint32
	matchStartTick   uint32
	matchEndTick     uint32
	matchEnded       bool
	matchResetAt     uint32
	matchKills       map[uint16]uint16
	matchDeaths      map[uint16]uint16
	matchStyleEarned map[uint16]uint32
	matchStyleBy     map[uint16][StyleReasonCount]uint16
	matchPointsBy    map[uint16][8]uint16
	matchContractsBy map[uint16][4]uint16
	matchEndSentSeq  uint32

	nextPlayerNum uint16
	humanCount    int

	// G2: how many bots are currently hunting each victim. Rebuilt from the
	// actual bot state at the top of every tick so it cannot drift.
	huntersOn map[uint16]int

	tick              uint32
	forceFullSnapshot bool

	ticker *time.Ticker
	stopCh chan struct{}

	cleanupTimer *time.Timer
	cleanupToken uint64

	rng *rand.Rand

	bfsMark []uint32
	bfsDist []uint16
	bfsGen  uint32
	bfsQ    []int

	tmpAlive   []*Player
	tmpPlayers []*Player
	tmpClients []*Client
	tmpReqs    []roiReq
	tmpAnchors map[uint16]playerAnchor
}

type matchResult struct {
	N     uint16 `json:"n"`
	Nm    string `json:"nm"`
	Bot   bool   `json:"bot"`
	P     uint16 `json:"p"`
	Cells uint16 `json:"cells"`
	// Pk is the peak territory held during the match, Avg the time-weighted
	// average. Cells alone is a snapshot at the final tick and reads as 0 for
	// anyone who died late (F3).
	Pk    uint16                   `json:"pk"`
	Avg   uint16                   `json:"avg"`
	K     uint16                   `json:"k"`
	D     uint16                   `json:"d"`
	Fr    uint8                    `json:"fr"`
	Place uint16                   `json:"place"`
	Ct    uint8                    `json:"ct"`
	Cp    uint16                   `json:"cp"`
	Cg    uint16                   `json:"cg"`
	Cu    uint32                   `json:"cu"`
	Cd    [4]uint16                `json:"cd"`
	Se    uint16                   `json:"se"`
	Sb    [StyleReasonCount]uint16 `json:"sb"`
	Pb    [8]uint16                `json:"pb"`
}

type KnownName struct {
	Name   string
	Online bool
}

type Player struct {
	num uint16

	name string
	bot  bool

	x int
	y int

	homeX int
	homeY int

	dir        Dir
	pendingDir Dir

	nextX int
	nextY int
	nextI int

	alive     bool
	respawnAt uint32
	trail     []int
	owned     []int

	aiMode             uint8
	aiModeUntil        uint32
	aiTargetX          int
	aiTargetY          int
	aiNextDecisionTick uint32

	aiExpandPhase    uint8
	aiExpandDir      Dir
	aiExpandTurn     int8
	aiExpandOutLeft  uint8
	aiExpandSideLeft uint8
	aiExpandUntil    uint32
	aiHuntTarget     uint16
	aiExpandIntent   uint8
	aiExpandPrefer   uint8

	aiLastSeenTick uint32
	aiLastSeenType uint8
	aiLastSeenX    int
	aiLastSeenY    int
	aiLastSeenNum  uint16

	aiRecentX [aiRecentCap]int
	aiRecentY [aiRecentCap]int
	aiRecentI uint8
	aiRecentN uint8

	aiBaitSense    float32
	aiRiskiness    float32
	aiPredictDepth uint8

	// G3/G4: difficulty tier and behaviour archetype, plus the per-bot values
	// they derive. Server-side only, nothing here reaches the wire protocol.
	aiTier        uint8
	aiArchetype   uint8
	aiROIW        int
	aiROIH        int
	aiCooldownMin uint8
	aiCooldownMax uint8
	aiTrailBudget int
	aiHuntGate    float32

	// G2: victim this bot is accounted against in Room.huntersOn. Distinct
	// from aiHuntTarget, which stays the trail owner used for path validation.
	aiHuntWho uint16

	// G14: straight-line windup before a hunt becomes a real chase.
	aiWindupUntil uint32
	aiWindupDir   Dir

	// G17: throttle for the expensive trail scan in botStep.
	aiHuntScanTick uint32

	// F5: throttle for the cooling-territory scan, and the cell aiMode 5
	// is currently driving at.
	aiCoolScanTick uint32
	aiCoolCell     int

	// G8: ring of recent death ticks driving the respawn progression.
	aiDeathAt [aiDeathCap]uint32
	aiDeathI  uint8
	aiDeathN  uint8

	aiAggression float32
	aiCaution    float32
	aiBravery    int

	aiAvoidTick   uint32
	aiAvoidFrom   Dir
	aiAvoidTo     Dir
	aiAvoidReason uint8

	hue uint16

	killStreak     uint8
	lastKillTick   uint32
	shield         uint8
	speedUntil     uint32
	speedLockUntil uint32
	bonusBudget    uint16

	// F2: short post-respawn immunity. Cleared early once the player leaves
	// their own territory so it cannot be used as a battering ram.
	spawnGraceUntil uint32

	// Per-match counters, all reset in resetMatchLocked.
	peakCells         uint16 // F3: best territory held
	cellTicks         uint32 // F3: integral of territory over ticks
	styleCaptureMatch uint16 // E2: Style already paid for captures
	styleKillMatch    uint16 // E4: Style already paid for kills
	botKillsMatch     uint16 // E4: bot kills, drives the diminishing rate
	contractsDone     uint16 // E5: contracts completed

	// E12: re-entrancy guards for addStyle. styleDepth bounds recursion,
	// dailyRewardDepth marks Style that is itself a daily payout.
	styleDepth       uint8
	dailyRewardDepth uint8

	lastKiller     uint16
	lastKilledTick uint32

	style uint32

	cosInvCaptureFx uint8
	cosInvHead      uint8
	cosInvSeg       uint8
	cosInvNameplate uint8
	cosInvFrame     uint8
	cosCaptureFx    uint8
	cosHead         uint8
	cosSeg          uint8
	cosNameplate    uint8
	cosFrame        uint8
	// Extra categories and the title travel in the JSON "cosExtra" message, not
	// in the binary ROI record (its layout is frozen at 21 bytes).
	cosInvTerr  uint8
	cosInvDeath uint8
	cosTerr     uint8
	cosDeath    uint8
	titleID     uint8

	contractType     uint8
	contractGoal     uint16
	contractProgress uint16
	contractUntil    uint32

	profileKey string

	lastChatAt time.Time
}

type Profile struct {
	Day int64 `json:"day"`

	DailyType1 uint8  `json:"dailyType1"`
	DailyGoal1 uint16 `json:"dailyGoal1"`
	DailyProg1 uint16 `json:"dailyProg1"`

	DailyType2 uint8  `json:"dailyType2"`
	DailyGoal2 uint16 `json:"dailyGoal2"`
	DailyProg2 uint16 `json:"dailyProg2"`

	DailyType3 uint8  `json:"dailyType3"`
	DailyGoal3 uint16 `json:"dailyGoal3"`
	DailyProg3 uint16 `json:"dailyProg3"`

	// E7: login streak. Old files load with zeros, ensureProfileDailyLocked
	// seeds them on the first day rollover.
	StreakDays    uint32 `json:"streakDays"`
	StreakLastDay int64  `json:"streakLastDay"`
	// E7: day stamp of the last "first win of the day" bonus.
	FirstWinDay int64 `json:"firstWinDay"`

	// E13: soft daily income ceiling.
	DayIncome    uint32 `json:"dayIncome"`
	DayIncomeDay int64  `json:"dayIncomeDay"`

	TotalKills       uint32 `json:"totalKills"`
	TotalPickups     uint32 `json:"totalPickups"`
	TotalCapture     uint32 `json:"totalCapture"`
	TotalBounty      uint32 `json:"totalBounty"`
	TotalContracts   uint32 `json:"totalContracts"`
	TotalRevenge     uint32 `json:"totalRevenge"`
	TotalStyleGained uint32 `json:"totalStyleGained"`
	StyleBalance     uint32 `json:"styleBalance"`

	CosInvCaptureFx uint8 `json:"cosInvCaptureFx"`
	CosInvHead      uint8 `json:"cosInvHead"`
	CosInvSeg       uint8 `json:"cosInvSeg"`
	CosInvNameplate uint8 `json:"cosInvNameplate"`
	CosInvFrame     uint8 `json:"cosInvFrame"`
	CosEqCaptureFx  uint8 `json:"cosEqCaptureFx"`
	CosEqHead       uint8 `json:"cosEqHead"`
	CosEqSeg        uint8 `json:"cosEqSeg"`
	CosEqNameplate  uint8 `json:"cosEqNameplate"`
	CosEqFrame      uint8 `json:"cosEqFrame"`
	// Categories added later. Old profile files have no such keys, so they load
	// as 0 and ensureProfileCosmeticsLocked grants bit 0 (the free default).
	CosInvTerr  uint8 `json:"cosInvTerr"`
	CosInvDeath uint8 `json:"cosInvDeath"`
	CosEqTerr   uint8 `json:"cosEqTerr"`
	CosEqDeath  uint8 `json:"cosEqDeath"`

	AchvMask uint32 `json:"achvMask"`
	// TitleID is the equipped title. Titles are never bought, only unlocked by
	// achievements; 0 means "no title".
	TitleID uint8 `json:"titleId"`

	LastSeen int64 `json:"lastSeen"`

	// Sliding one-minute income window, runtime only.
	styleWindowStart  int64
	styleWindowGained uint32
	styleWindowLogged bool
}

func ensureProfileCosmeticsLocked(pr *Profile) {
	if pr == nil {
		return
	}
	// One pass per category: grant the free default, clamp the equipped id and
	// drop an equip the profile does not actually own.
	fix := func(inv *uint8, eq *uint8) {
		if *inv == 0 {
			*inv = 1
		}
		if *eq > CosmeticsMaxID {
			*eq = 0
		}
		if (*inv & (uint8(1) << *eq)) == 0 {
			*eq = 0
		}
	}
	fix(&pr.CosInvCaptureFx, &pr.CosEqCaptureFx)
	fix(&pr.CosInvHead, &pr.CosEqHead)
	fix(&pr.CosInvSeg, &pr.CosEqSeg)
	fix(&pr.CosInvNameplate, &pr.CosEqNameplate)
	fix(&pr.CosInvFrame, &pr.CosEqFrame)
	fix(&pr.CosInvTerr, &pr.CosEqTerr)
	fix(&pr.CosInvDeath, &pr.CosEqDeath)

	// A title stays equipped only while its achievement is still unlocked.
	if pr.TitleID != 0 && (titleMaskLocked(pr)&(uint32(1)<<uint32(pr.TitleID))) == 0 {
		pr.TitleID = 0
	}
}

// ---------------------------------------------------------------------------
// Titles: status earned from achievements, never sold for currency.
// ---------------------------------------------------------------------------

// TitleMaxID is the highest title id; ids index bits of a uint32 mask.
const TitleMaxID = 12

// titleRule binds a title id to the achievement that unlocks it.
type titleRule struct {
	id   uint8
	achv uint8
	name string
}

var titleRules = []titleRule{
	{1, AchvKills10, "Боец"},
	{2, AchvKills100, "Нагибатор"},
	{3, AchvKills1000, "Легенда"},
	{4, AchvCapture10k, "Землевладелец"},
	{5, AchvCapture100k, "Картограф"},
	{6, AchvRevenge15, "Мститель"},
	{7, AchvContracts25, "Подрядчик"},
	{8, AchvContracts100, "Исполнитель"},
	{9, AchvBounty15, "Охотник за головами"},
	{10, AchvStyle10000, "Модник"},
	{11, AchvStreak7, "Завсегдатай"},
	{12, AchvStreak30, "Преданный"},
}

// titlesPayload renders the "achievement -> title" table for the "hello"
// message, so the client can name titles and know what unlocks them.
func titlesPayload() []map[string]any {
	out := make([]map[string]any, 0, len(titleRules))
	for _, tr := range titleRules {
		out = append(out, map[string]any{"id": tr.id, "achv": tr.achv, "name": tr.name})
	}
	return out
}

// titleMaskLocked returns the bitmask of unlocked title ids. Bit 0 ("no title")
// is always set. Caller holds profilesMu.
func titleMaskLocked(pr *Profile) uint32 {
	mask := uint32(1)
	if pr == nil {
		return mask
	}
	for _, tr := range titleRules {
		if pr.AchvMask&(uint32(1)<<uint32(tr.achv)) != 0 {
			mask |= uint32(1) << uint32(tr.id)
		}
	}
	return mask
}

// titleUnlockedLocked reports whether a title id may be equipped.
// Caller holds profilesMu.
func titleUnlockedLocked(pr *Profile, id uint8) bool {
	if id > TitleMaxID {
		return false
	}
	return titleMaskLocked(pr)&(uint32(1)<<uint32(id)) != 0
}

var profilesMu sync.Mutex
var profiles = make(map[string]*Profile)

func dayStampNow() int64 {
	return time.Now().Unix() / 86400
}

func profileForKey(key string) *Profile {
	if key == "" {
		return nil
	}
	profilesMu.Lock()
	defer profilesMu.Unlock()
	p := profiles[key]
	if p == nil {
		p = &Profile{LastSeen: time.Now().Unix()}
		profiles[key] = p
		markProfilesDirty()
	}
	return p
}

type PowerUp struct {
	ID      uint16
	Type    uint8
	X       uint16
	Y       uint16
	Expires uint32
}

type Event struct {
	Kind uint8

	A uint16
	B uint16
	X uint16
	Y uint16
	C uint32
	D uint8
}

type ChatMessage struct {
	T    int64  `json:"t"`
	N    uint16 `json:"n"`
	Text string `json:"text"`
}

type Client struct {
	conn *websocket.Conn

	sendCh chan outbound

	name atomic.Value
	ip   string
	pid  string

	mu     sync.Mutex
	room   *Room
	player *Player

	lastRoomsAt         time.Time
	lastJoinAt          time.Time
	lastCreateAt        time.Time
	lastMatchContinueAt time.Time

	lastStateTick uint32
	lastROIX      int
	lastROIY      int

	closed atomic.Bool
}

func (c *Client) profileKey() string {
	if c == nil {
		return ""
	}
	if c.pid != "" {
		return c.pid
	}
	return c.ip
}

type outbound struct {
	msgType websocket.MessageType
	data    []byte
	drop    bool
	pd      *pooledData
}

type serverMetrics struct {
	wsConnections atomic.Uint64
	wsWriteErrors atomic.Uint64
	wsDropped     atomic.Uint64
	wsActive      atomic.Int64
}

var metrics serverMetrics

type pooledData struct {
	b    []byte
	refs int32
}

var pooledDataPool = sync.Pool{New: func() any { return &pooledData{b: make([]byte, 0, 64*1024)} }}
var pooledU32Pool = sync.Pool{New: func() any { return make([]uint32, 0, 2048) }}

var floodBytesPool = sync.Pool{New: func() any { return make([]byte, N) }}
var floodIntPool = sync.Pool{New: func() any { return make([]int, N) }}

func acquirePooledData(minCap int) *pooledData {
	pd := pooledDataPool.Get().(*pooledData)
	if cap(pd.b) < minCap {
		pd.b = make([]byte, 0, minCap)
	} else {
		pd.b = pd.b[:0]
	}
	atomic.StoreInt32(&pd.refs, 1)
	return pd
}

func incPooledRef(pd *pooledData) {
	if pd == nil {
		return
	}
	atomic.AddInt32(&pd.refs, 1)
}

func releasePooledData(pd *pooledData) {
	if pd == nil {
		return
	}
	if cap(pd.b) > 1024*1024 {
		return
	}
	pd.b = pd.b[:0]
	pooledDataPool.Put(pd)
}

func decPooledRef(pd *pooledData) {
	if pd == nil {
		return
	}
	if atomic.AddInt32(&pd.refs, -1) == 0 {
		releasePooledData(pd)
	}
}

func acquireU32(minCap int) []uint32 {
	s := pooledU32Pool.Get().([]uint32)
	if cap(s) < minCap {
		return make([]uint32, 0, minCap)
	}
	return s[:0]
}

func releaseU32(s []uint32) {
	if s == nil {
		return
	}
	if cap(s) > 1_000_000 {
		return
	}
	pooledU32Pool.Put(s[:0])
}

func appendU16LE(dst []byte, v uint16) []byte {
	var b [2]byte
	binary.LittleEndian.PutUint16(b[:], v)
	return append(dst, b[:]...)
}

func appendU32LE(dst []byte, v uint32) []byte {
	var b [4]byte
	binary.LittleEndian.PutUint32(b[:], v)
	return append(dst, b[:]...)
}

type ClientMsg struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type ServerMsg struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

func (c *Client) close() {
	c.closeWith(websocket.StatusNormalClosure, "")
}

func (c *Client) closeWith(code websocket.StatusCode, reason string) {
	if c.closed.Swap(true) {
		return
	}
	log.Printf("ws_close ip=%q pid=%q code=%d reason=%q", c.ip, shortPID(c.pid), code, reason)
	metrics.wsActive.Add(-1)
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
				metrics.wsWriteErrors.Add(1)
				log.Printf("ws_write_error ip=%q err=%v", c.ip, err)
				writeFailed = true
				c.closeWith(websocket.StatusGoingAway, "write_error")
			}
		}
		if m.pd != nil {
			decPooledRef(m.pd)
		}
		if c.closed.Load() && writeFailed {
			// drain queued messages to release pooled refs
			continue
		}
		if c.closed.Load() {
			return
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
		metrics.wsDropped.Add(1)
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
	metrics.wsDropped.Add(1)
	decPooledRef(pd)
	// Drop the laggard instead of blocking everyone else. Async because the
	// caller may hold room locks that close() needs.
	go c.closeWith(websocket.StatusPolicyViolation, "send_backpressure")
	return false
}

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

func (c *Client) sendJSON(ctx context.Context, typ string, data any) {
	b, err := json.Marshal(ServerMsg{Type: typ, Data: data})
	if err != nil {
		return
	}
	_ = c.enqueue(websocket.MessageText, b, nil, false)
}

func (c *Client) sendBinaryPooled(pd *pooledData, drop bool) bool {
	if pd == nil {
		return false
	}
	if len(pd.b) == 0 {
		decPooledRef(pd)
		return false
	}
	return c.enqueue(websocket.MessageBinary, pd.b, pd, drop)
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
	rm.mu.Unlock()

	rm.broadcastJSON(ctx, "nameUpdate", map[string]any{"n": pl.num, "nm": display})
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
	num := pl.num
	rm.setKnownNameLocked(num, pl.name, false)
	offlineUpdate = rm.displayNameLocked(num)
	rm.removePlayer(num)
	rm.humanCount = maxInt(0, rm.humanCount-1)
	rm.forceFullSnapshot = true
	shouldCleanup := rm.humanCount == 0
	if !shouldCleanup {
		// G7: refill the bot field as the room empties out.
		rm.syncBotPopulationLocked()
	}
	rm.mu.Unlock()

	if offlineUpdate != "" {
		rm.broadcastJSON(ctx, "nameUpdate", map[string]any{"n": num, "nm": offlineUpdate})
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
	c.leaveRoomInternal(ctx, false)

	name := c.name.Load().(string)

	rm.mu.Lock()
	if rm.humanCount >= rm.limit {
		rm.mu.Unlock()
		c.sendJSON(ctx, "error", map[string]any{"message": "room_full"})
		return
	}

	pnum := rm.nextPlayerNum
	if pnum == 0 {
		pnum = 1
	}
	rm.nextPlayerNum = pnum + 1

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
	if pr := profileForKey(pl.profileKey); pr != nil {
		profilesMu.Lock()
		ensureProfileCosmeticsLocked(pr)
		pr.LastSeen = time.Now().Unix()
		applyProfileCosmeticsToPlayerLocked(pl, pr)
		profilesMu.Unlock()
		markProfilesDirty()
	}

	rm.players[pnum] = pl
	rm.scores[pnum] = 0
	rm.points[pnum] = 0
	rm.clients[c] = struct{}{}
	rm.humanCount++
	rm.forceFullSnapshot = true
	rm.cancelCleanupLocked()
	// G7: thin the bot field out so a busy room is not a mob.
	rm.syncBotPopulationLocked()

	rm.setKnownNameLocked(pnum, name, true)
	rm.sendDailyStateToPlayer(pl)

	known := make([]ChatMessage, 0, len(rm.knownNames))
	for num := range rm.knownNames {
		nm := rm.displayNameLocked(num)
		if nm == "" {
			continue
		}
		known = append(known, ChatMessage{N: num, Text: nm})
	}
	rm.mu.Unlock()

	sort.Slice(known, func(i, j int) bool { return known[i].N < known[j].N })

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
	var matchResults []matchResult
	if matchEnded {
		matchResults = rm.buildMatchResultsLocked()
	}
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
	}
	initPayload["cosmetics"] = cosmeticsStatePayload(pl)
	if matchEnded {
		initPayload["matchResults"] = matchResults
	}
	c.sendJSON(ctx, "init", initPayload)

	rm.mu.Lock()
	chatHistory := make([]ChatMessage, len(rm.chat))
	copy(chatHistory, rm.chat)
	rm.minimapDirty = true
	rm.minimapFullActive = true
	rm.minimapFullCursor = 0
	rm.mu.Unlock()

	for _, it := range known {
		c.sendJSON(ctx, "nameUpdate", map[string]any{"n": it.N, "nm": it.Text})
	}
	if len(chatHistory) > 0 {
		c.sendJSON(ctx, "chatInit", chatHistory)
	}

	rm.broadcastJSON(ctx, "nameUpdate", map[string]any{"n": pnum, "nm": rmDisplayName(rm, pnum)})
	// The newcomer needs the whole room, everyone else needs the newcomer:
	// one full broadcast covers both.
	rm.broadcastCosExtra(ctx)
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

func cosmeticsStatePayload(p *Player) map[string]any {
	if p == nil {
		return map[string]any{}
	}
	titleMask := uint32(1)
	if pr := profileForKey(p.profileKey); pr != nil {
		profilesMu.Lock()
		titleMask = titleMaskLocked(pr)
		profilesMu.Unlock()
	}
	return map[string]any{
		"style":        p.style,
		"invCaptureFx": p.cosInvCaptureFx,
		"invHead":      p.cosInvHead,
		"invSeg":       p.cosInvSeg,
		"invNameplate": p.cosInvNameplate,
		"invFrame":     p.cosInvFrame,
		"invTerr":      p.cosInvTerr,
		"invDeath":     p.cosInvDeath,
		"eqCaptureFx":  p.cosCaptureFx,
		"eqHead":       p.cosHead,
		"eqSeg":        p.cosSeg,
		"eqNameplate":  p.cosNameplate,
		"eqFrame":      p.cosFrame,
		"eqTerr":       p.cosTerr,
		"eqDeath":      p.cosDeath,
		"titleId":      p.titleID,
		"titleMask":    titleMask,
	}
}

// cosExtraEntry is one row of the "cosExtra" message: the cosmetic categories
// that deliberately stay out of the frozen 21-byte binary player record.
type cosExtraEntry struct {
	N     uint16 `json:"n"`
	Terr  uint8  `json:"terr"`
	Death uint8  `json:"death"`
	Title uint8  `json:"title"`
}

// cosExtraPayloadLocked snapshots every player in the room. Caller holds r.mu;
// the result must be broadcast after releasing it (broadcastJSON takes r.mu).
func (r *Room) cosExtraPayloadLocked() map[string]any {
	list := make([]cosExtraEntry, 0, len(r.players))
	for num, p := range r.players {
		if p == nil {
			continue
		}
		list = append(list, cosExtraEntry{N: num, Terr: p.cosTerr, Death: p.cosDeath, Title: p.titleID})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].N < list[j].N })
	return map[string]any{"players": list}
}

// broadcastCosExtra rebuilds and pushes the full list. It is small (<= 30 rows)
// so a full resend on every change is cheaper than tracking deltas.
func (r *Room) broadcastCosExtra(ctx context.Context) {
	if r == nil {
		return
	}
	r.mu.Lock()
	payload := r.cosExtraPayloadLocked()
	r.mu.Unlock()
	r.broadcastJSON(ctx, "cosExtra", payload)
}

func cosmeticsStatePayloadFromProfile(pr *Profile) map[string]any {
	if pr == nil {
		return map[string]any{}
	}
	return map[string]any{
		"style":        pr.StyleBalance,
		"invCaptureFx": pr.CosInvCaptureFx,
		"invHead":      pr.CosInvHead,
		"invSeg":       pr.CosInvSeg,
		"invNameplate": pr.CosInvNameplate,
		"invFrame":     pr.CosInvFrame,
		"invTerr":      pr.CosInvTerr,
		"invDeath":     pr.CosInvDeath,
		"eqCaptureFx":  pr.CosEqCaptureFx,
		"eqHead":       pr.CosEqHead,
		"eqSeg":        pr.CosEqSeg,
		"eqNameplate":  pr.CosEqNameplate,
		"eqFrame":      pr.CosEqFrame,
		"eqTerr":       pr.CosEqTerr,
		"eqDeath":      pr.CosEqDeath,
		"titleId":      pr.TitleID,
		"titleMask":    titleMaskLocked(pr),
	}
}

func (c *Client) handleChat(ctx context.Context, text string) {
	c.mu.Lock()
	rm := c.room
	pl := c.player
	c.mu.Unlock()
	if rm == nil || pl == nil {
		return
	}

	msgText := sanitizeChat(text)
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

	r := newRoom(h, h.nextRoomID, h.roomLimit)
	h.nextRoomID++
	h.rooms[r.id] = r
	r.start()
	return r
}

func (h *Hub) createRoom(title string) *Room {
	name := sanitizeRoomName(title)
	if name == "" {
		name = "Комната"
	}

	h.mu.Lock()
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
		if p.bot {
			name = p.name
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
		p.styleKillMatch = 0
		p.botKillsMatch = 0
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

func sanitizeRoomName(name string) string {
	raw := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(name))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= RoomNameMaxLen {
			break
		}
		if ch < 0x20 || ch == '<' || ch == '>' {
			continue
		}
		out = append(out, ch)
	}
	res := strings.TrimSpace(string(out))
	if res == "" {
		return ""
	}
	return res
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

func (r *Room) contractName(t uint8) string {
	switch t {
	case ContractKills:
		return "kills"
	case ContractPickups:
		return "pickups"
	case ContractCapture:
		return "capture"
	default:
		return ""
	}
}

// Contract goals ramp with the number of contracts already completed in the
// match, so the 4th one is not as trivial as the 1st (E5).
var (
	contractKillGoals    = [MaxContractsMatch]uint16{3, 5, 8, 12}
	contractPickupGoals  = [MaxContractsMatch]uint16{2, 3, 4, 5}
	contractCaptureGoals = [MaxContractsMatch]uint16{180, 260, 360, 500}
)

func contractGoalFor(ct uint8, done uint16) uint16 {
	idx := int(done)
	if idx >= MaxContractsMatch {
		idx = MaxContractsMatch - 1
	}
	switch ct {
	case ContractKills:
		return contractKillGoals[idx]
	case ContractPickups:
		return contractPickupGoals[idx]
	case ContractCapture:
		return contractCaptureGoals[idx]
	}
	return 0
}

func (r *Room) assignContract(p *Player) {
	if p == nil {
		return
	}
	// E5: a match hands out at most MaxContractsMatch completed contracts.
	if p.contractsDone >= MaxContractsMatch {
		p.contractType = ContractNone
		p.contractGoal = 0
		p.contractProgress = 0
		p.contractUntil = 0
		return
	}
	ct := uint8(ContractKills)
	rn := r.rng.Intn(100)
	if rn < 34 {
		ct = ContractKills
	} else if rn < 67 {
		ct = ContractPickups
	} else {
		ct = ContractCapture
	}
	goal := contractGoalFor(ct, p.contractsDone)
	if r.mutatorType == MutatorPowerSurge && ct == ContractPickups {
		goal++
	}
	until := r.tick + 2400
	p.contractType = ct
	p.contractGoal = goal
	p.contractProgress = 0
	p.contractUntil = until
	r.pushEvent(Event{Kind: EventContractAssign, A: p.num, B: goal, C: until, D: ct})
}

func (r *Room) ensureContract(p *Player) {
	if p == nil {
		return
	}
	if p.contractsDone >= MaxContractsMatch {
		return
	}
	if p.contractType == ContractNone || p.contractGoal == 0 {
		r.assignContract(p)
		return
	}
	if p.contractUntil != 0 && r.tick >= p.contractUntil {
		r.assignContract(p)
	}
}

func (r *Room) addStyle(p *Player, delta uint16, reason uint8) {
	if p == nil || delta == 0 {
		return
	}
	// E12: two independent brakes on the addStyle -> daily -> addStyle loop.
	// styleDepth is a hard bound on re-entrancy, dailyRewardDepth marks Style
	// that is itself a daily payout. Daily progress is only fed by a top-level,
	// non-daily-payout grant, so no single edit can reopen the cycle.
	if p.styleDepth >= StyleAddMaxDepth {
		log.Printf("style_recursion_guard room=%d player=%d reason=%d", r.id, p.num, reason)
		return
	}
	p.styleDepth++
	defer func() { p.styleDepth-- }()
	allowDailyProgress := p.styleDepth == 1 && p.dailyRewardDepth == 0

	// The profile is the single source of truth for the balance: never write
	// Player.style back into it, only apply atomic deltas and refresh the cache.
	rewardCount := 0
	achvCount := 0
	var pr *Profile
	if !p.bot {
		pr = profileForKey(p.profileKey)
	}
	if pr != nil {
		profilesMu.Lock()
		r.ensureProfileDailyLocked(pr)
		granted := styleIncomeGrantLocked(pr, p.profileKey, delta)
		if granted == 0 {
			profilesMu.Unlock()
			return
		}
		granted = styleDayIncomeGrantLocked(pr, granted)
		if granted == 0 {
			profilesMu.Unlock()
			return
		}
		delta = granted
		addProfileStyleLocked(pr, uint32(delta))
		if pr.TotalStyleGained < ^uint32(0)-uint32(delta) {
			pr.TotalStyleGained += uint32(delta)
		} else {
			pr.TotalStyleGained = ^uint32(0)
		}
		if allowDailyProgress {
			rewardCount = r.addDailyProgressLocked(p, pr, DailyStyle, delta)
		}
		achvCount = r.checkAchievementsLocked(p, pr)
		pr.LastSeen = time.Now().Unix()
		p.style = pr.StyleBalance
		profilesMu.Unlock()
		markProfilesDirty()
	} else if p.style < ^uint32(0)-uint32(delta) {
		p.style += uint32(delta)
	} else {
		p.style = ^uint32(0)
	}

	if reason > 0 && int(reason) < StyleReasonCount {
		if r.matchStyleEarned[p.num] < ^uint32(0)-uint32(delta) {
			r.matchStyleEarned[p.num] += uint32(delta)
		} else {
			r.matchStyleEarned[p.num] = ^uint32(0)
		}
		v := r.matchStyleBy[p.num]
		cur := v[reason]
		if cur > ^uint16(0)-delta {
			v[reason] = ^uint16(0)
		} else {
			v[reason] = cur + delta
		}
		r.matchStyleBy[p.num] = v
	}
	r.pushEvent(Event{Kind: EventStyle, A: p.num, B: delta, C: p.style, D: reason})
	r.grantDailyRewards(p, rewardCount)
	r.grantAchievementRewards(p, achvCount)
}

// addStyleCapped grants Style while respecting a per-match budget counter.
// Returns the amount actually granted.
func (r *Room) addStyleCapped(p *Player, delta uint16, reason uint8, spent *uint16, budget uint16) uint16 {
	if p == nil || delta == 0 || spent == nil {
		return 0
	}
	if *spent >= budget {
		return 0
	}
	if room := budget - *spent; delta > room {
		delta = room
	}
	*spent += delta
	r.addStyle(p, delta, reason)
	return delta
}

func (r *Room) addContractProgress(p *Player, inc uint16) {
	if p == nil || inc == 0 {
		return
	}
	r.ensureContract(p)
	if p.contractType == ContractNone || p.contractGoal == 0 {
		return
	}
	if p.contractUntil != 0 && r.tick >= p.contractUntil {
		r.assignContract(p)
	}
	if p.contractProgress < p.contractGoal {
		left := p.contractGoal - p.contractProgress
		if inc > left {
			inc = left
		}
		p.contractProgress += inc
		r.pushEvent(Event{Kind: EventContractProgress, A: p.num, B: p.contractProgress, D: p.contractType})
	}
	if p.contractProgress >= p.contractGoal {
		r.pushEvent(Event{Kind: EventContractComplete, A: p.num, D: p.contractType})
		if p.contractType > 0 && p.contractType < 4 {
			v := r.matchContractsBy[p.num]
			idx := p.contractType
			if v[idx] < ^uint16(0) {
				v[idx]++
			}
			r.matchContractsBy[p.num] = v
		}
		if p.contractsDone < ^uint16(0) {
			p.contractsDone++
		}
		r.addStyle(p, StyleContractReward, StyleContract)
		r.awardPoints(p.num, 16, PointsContract)
		if !p.bot {
			pr := profileForKey(p.profileKey)
			if pr != nil {
				profilesMu.Lock()
				r.ensureProfileDailyLocked(pr)
				if pr.TotalContracts < ^uint32(0) {
					pr.TotalContracts++
				}
				achvCount := r.checkAchievementsLocked(p, pr)
				profilesMu.Unlock()
				markProfilesDirty()
				r.grantAchievementRewards(p, achvCount)
			}
		}
		// assignContract itself clears the slot once the match limit is hit.
		r.assignContract(p)
	}
}

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

func (r *Room) powerupTypeName(t uint8) string {
	switch t {
	case PowerupShield:
		return "shield"
	case PowerupDash:
		return "dash"
	case PowerupNova:
		return "nova"
	case PowerupMegaDash:
		return "megadash"
	default:
		return ""
	}
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
			r.addStyle(t, StyleBountySurvive, StyleBounty)
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

func (r *Room) buildEventsPooledLocked(force bool) *pooledData {
	if !force && len(r.events) == 0 && !r.metaDirty {
		return nil
	}
	capHint := 1 + 4 + 1 + 4 + 2 + 4 + 1 + len(r.powerUps)*13 + 2 + len(r.events)*16
	if capHint < 128 {
		capHint = 128
	}
	pd := acquirePooledData(capHint)
	b := pd.b

	b = append(b, MsgEventsBinary)
	b = appendU32LE(b, r.tick)
	b = append(b, r.mutatorType)
	b = appendU32LE(b, r.mutatorUntil)
	b = appendU16LE(b, r.bountyTarget)
	b = appendU32LE(b, r.bountyUntil)
	b = append(b, uint8(len(r.powerUps)))
	for _, pu := range r.powerUps {
		b = appendU16LE(b, pu.ID)
		b = append(b, pu.Type)
		b = appendU16LE(b, pu.X)
		b = appendU16LE(b, pu.Y)
		b = appendU32LE(b, pu.Expires)
	}

	b = appendU16LE(b, uint16(len(r.events)))
	for _, e := range r.events {
		b = append(b, e.Kind)
		switch e.Kind {
		case EventKill:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = append(b, e.D)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
		case EventStreak:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
		case EventBountyAssign:
			b = appendU16LE(b, e.A)
			b = appendU32LE(b, e.C)
		case EventBountyClaim:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
		case EventPowerupSpawn:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
			b = appendU32LE(b, e.C)
		case EventPowerupPickup:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = append(b, e.D)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
		case EventPowerupUse:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
		case EventMutatorStart:
			b = append(b, e.D)
			b = appendU32LE(b, e.C)
		case EventMutatorEnd:
			b = append(b, e.D)
		case EventContractAssign:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.B)
			b = appendU32LE(b, e.C)
		case EventContractProgress:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.B)
		case EventContractComplete:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
		case EventStyle:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = appendU32LE(b, e.C)
			b = append(b, e.D)
		case EventCapture:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
			b = appendU32LE(b, e.C)
			b = append(b, e.D)
		case EventRevenge:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
		case EventDailyAssign:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.B)
			b = appendU32LE(b, e.C)
		case EventDailyProgress:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.B)
		case EventDailyComplete:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
		case EventAchievement:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
		case EventReclaim:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
		case EventCoolBatch:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = appendU32LE(b, e.C)
		default:
			b = append(b, 0)
		}
	}

	pd.b = b
	r.events = r.events[:0]
	r.metaDirty = false
	r.metaSentTick = r.tick
	return pd
}

var botNickAdjRu = []string{
	"Лютый",
	"Сладкий",
	"Злой",
	"Добрый",
	"Хитрый",
	"Тихий",
	"Громкий",
	"Резкий",
	"Шустрый",
	"Сонный",
	"Наглый",
	"Смелый",
	"Кринжовый",
	"Токсичный",
	"Плюшевый",
	"Голодный",
}

var botNickNounRu = []string{
	"Пельмень",
	"Шашлык",
	"Котик",
	"Бобр",
	"Енот",
	"Гусь",
	"Кабан",
	"Карась",
	"Шмель",
	"Дед",
	"Школьник",
	"Танкист",
	"Ниндзя",
	"Чебурек",
	"Вареник",
	"Сосиска",
}

var botNickDumbRu = []string{
	"Квас",
	"Компот",
	"Лапша",
	"Тапок",
	"Сапог",
	"Шапка",
	"Пончик",
	"Блинчик",
	"Кефир",
	"Жмых",
	"Пшик",
	"Кусь",
	"Хомяк",
	"Тюлень",
	"Сыч",
	"Булка",
	"Селёдка",
	"Сардина",
	"Крабик",
	"Лимон",
	"Пупок",
	"Сметана",
	"Гречка",
	"Котлета",
}

var botNickFixedRu = []string{
	"Нагибатор",
	"КотикВШоке",
	"ДедНаСтиле",
	"ПельменьСудьбы",
	"ШашлыкБатя",
	"ГусьУльтима",
	"ЕнотКапец",
	"БобрИнженер",
	"КринжМашина",
	"ТихийУгар",
	"ЗлойКомпот",
	"СладкийКабан",
}

var botNickSuffixRu = []string{
	"ыч",
	"атор",
	"чик",
	"ка",
	"уля",
}

var botNickDecor = []string{
	"☆",
	"✦",
}

func runeLen(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}

func botNameStartKey(nm string) string {
	s := nm
	for {
		r, size := utf8.DecodeRuneInString(s)
		if r == utf8.RuneError && size == 0 {
			break
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			break
		}
		s = s[size:]
	}
	if s == "" {
		return ""
	}

	best := ""
	check := func(list []string) {
		for _, w := range list {
			if w == "" {
				continue
			}
			if strings.HasPrefix(s, w) {
				if runeLen(w) > runeLen(best) {
					best = w
				}
			}
		}
	}
	check(botNickFixedRu)
	check(botNickAdjRu)
	check(botNickNounRu)
	check(botNickDumbRu)

	if best != "" {
		return best
	}

	out := make([]rune, 0, 4)
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out = append(out, r)
			if len(out) >= 4 {
				break
			}
		}
	}
	return string(out)
}

func pickUniqueBotName(rng *rand.Rand, used map[string]struct{}, usedStarts map[string]struct{}, fallbackN int) string {
	if used == nil {
		used = make(map[string]struct{})
	}
	if usedStarts == nil {
		usedStarts = make(map[string]struct{})
	}
	fixedNums := []string{"228", "1337", "666", "777"}
	for tries := 0; tries < 1800; tries++ {
		adj := ""
		w1 := ""
		w2 := ""
		suf := ""
		digits := ""
		dec := ""
		decPrefix := false
		pickedFixed := false

		if rng.Float64() < 0.02 {
			dec = botNickDecor[rng.Intn(len(botNickDecor))]
			decPrefix = rng.Intn(2) == 0
		}

		if rng.Float64() < 0.18 {
			adj = botNickAdjRu[rng.Intn(len(botNickAdjRu))]
		}

		roll := rng.Float64()
		switch {
		case roll < 0.20:
			w1 = botNickFixedRu[rng.Intn(len(botNickFixedRu))]
			pickedFixed = true
		case roll < 0.70:
			w1 = botNickNounRu[rng.Intn(len(botNickNounRu))]
		default:
			w1 = botNickDumbRu[rng.Intn(len(botNickDumbRu))]
		}

		if !pickedFixed && rng.Float64() < 0.22 {
			if rng.Float64() < 0.55 {
				w2 = botNickDumbRu[rng.Intn(len(botNickDumbRu))]
			} else {
				w2 = botNickNounRu[rng.Intn(len(botNickNounRu))]
			}
			if w2 == w1 {
				w2 = ""
			}
		}

		if !pickedFixed && rng.Float64() < 0.10 {
			suf = botNickSuffixRu[rng.Intn(len(botNickSuffixRu))]
		}

		if rng.Float64() < 0.20 {
			if rng.Float64() < 0.14 {
				digits = fixedNums[rng.Intn(len(fixedNums))]
			} else {
				dr := rng.Float64()
				switch {
				case dr < 0.15:
					digits = fmt.Sprintf("%d", rng.Intn(10))
				case dr < 0.75:
					digits = fmt.Sprintf("%d", rng.Intn(90)+10)
				default:
					digits = fmt.Sprintf("%d", rng.Intn(900)+100)
				}
			}
		}

		assemble := func(adj, w1, w2, suf, digits, dec string, decPrefix bool) string {
			raw := ""
			if dec != "" && decPrefix {
				raw += dec
			}
			raw += adj + w1 + w2 + suf + digits
			if dec != "" && !decPrefix {
				raw += dec
			}
			return strings.ReplaceAll(raw, " ", "")
		}

		raw := assemble(adj, w1, w2, suf, digits, dec, decPrefix)
		if runeLen(raw) > NameMaxLen {
			raw = assemble(adj, w1, w2, suf, digits, "", decPrefix)
		}
		if runeLen(raw) > NameMaxLen {
			raw = assemble(adj, w1, w2, "", digits, "", decPrefix)
		}
		if runeLen(raw) > NameMaxLen {
			raw = assemble(adj, w1, "", "", digits, "", decPrefix)
		}
		if runeLen(raw) > NameMaxLen {
			raw = assemble("", w1, "", "", digits, "", decPrefix)
		}
		if runeLen(raw) > NameMaxLen {
			if len(digits) == 3 {
				digits = fmt.Sprintf("%d", rng.Intn(90)+10)
			} else if len(digits) == 2 {
				digits = fmt.Sprintf("%d", rng.Intn(10))
			} else {
				digits = ""
			}
			raw = assemble("", w1, "", "", digits, "", decPrefix)
		}
		if runeLen(raw) > NameMaxLen {
			continue
		}

		nm := sanitizeName(raw)
		if nm == "" {
			continue
		}
		if runeLen(nm) > NameMaxLen {
			continue
		}
		if _, ok := used[nm]; ok {
			continue
		}
		startKey := botNameStartKey(nm)
		if startKey == "" {
			continue
		}
		if _, ok := usedStarts[startKey]; ok {
			continue
		}
		used[nm] = struct{}{}
		usedStarts[startKey] = struct{}{}
		return nm
	}

	nm := sanitizeName(fmt.Sprintf("Нагибатор%d", fallbackN))
	if nm == "" {
		return sanitizeName(fmt.Sprintf("Котик%d", fallbackN))
	}
	return nm
}

func (r *Room) setKnownNameLocked(num uint16, name string, online bool) {
	if r.knownNames == nil {
		r.knownNames = make(map[uint16]KnownName)
	}
	base := sanitizeName(name)
	if base == "" {
		base = sanitizeName(fmt.Sprintf("Игрок %d", num))
	}
	r.knownNames[num] = KnownName{Name: base, Online: online}
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
		p.aiHuntGate = 0.25
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
	switch arch {
	case ArchFarmer:
		p.aiAggression = 0.15 + 0.15*r.rng.Float32()
		p.aiCaution = 0.45 + 0.30*r.rng.Float32()
		budgetLo, budgetHi = 18, 26
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
func (r *Room) newBotLocked(used, usedStarts map[string]struct{}, tier, arch uint8, fallbackN int) *Player {
	pnum := r.nextPlayerNum
	if pnum == 0 {
		pnum = 1
	}
	r.nextPlayerNum = pnum + 1
	name := pickUniqueBotName(r.rng, used, usedStarts, fallbackN)
	hue := r.allocUniqueHue()
	p := &Player{
		num:             pnum,
		name:            name,
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
	r.setKnownNameLocked(pnum, name, true)
	r.respawnPlayer(p)
	return p
}

// usedBotNamesLocked collects the names already taken in this room so the
// generator keeps producing distinguishable nicknames.
func (r *Room) usedBotNamesLocked() (map[string]struct{}, map[string]struct{}) {
	used := make(map[string]struct{}, BotCount)
	usedStarts := make(map[string]struct{}, BotCount)
	for _, kn := range r.knownNames {
		if kn.Name == "" {
			continue
		}
		used[kn.Name] = struct{}{}
		if k := botNameStartKey(kn.Name); k != "" {
			usedStarts[k] = struct{}{}
		}
	}
	return used, usedStarts
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
	tierT := mixTargets(tierMix[:], want)
	archT := mixTargets(archMix[:], want)
	for have < want {
		tier := pickUnderfilled(tiers, tierT)
		arch := pickUnderfilled(archs, archT)
		r.newBotLocked(used, usedStarts, tier, arch, have+1)
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

// F5 "Reclaim" tunables.
const (
	// ReclaimTicks: 200 ticks == 20s at 100ms per tick.
	ReclaimTicks = 200
	// ReclaimExpireBudget bounds how many cells the expiry queue retires per
	// tick, so a huge estate can never stall a tick.
	ReclaimExpireBudget = 1024
	// coolOwnerFlag marks a grid value on the wire as "cooling territory of
	// player (value &^ coolOwnerFlag)". Player numbers never reach 0x8000.
	coolOwnerFlag = uint16(0x8000)

	// Bot reclaim (aiMode 5) tunables. The scan is a strided sweep of the
	// bot's own ROI, so it stays far cheaper than the hunt scan.
	BotReclaimScanEvery = 7  // ticks between scans
	BotReclaimStride    = 2  // ROI sampling stride
	BotReclaimMaxSteps  = 26 // BFS budget to the patch
	// A detour is only worth it if the patch still exists on arrival.
	BotReclaimTimeMargin = 6
	// Bots do not abandon a long trail for a reclaim; that trade is bad.
	BotReclaimMaxTrail = 6
)

// botReclaimGate is the per-archetype appetite for a reclaim detour (G4):
// the Farmer lives off its estate, the Aggressor would rather chase.
var botReclaimGate = [ArchCount]float32{
	ArchFarmer:      0.95,
	ArchAggressor:   0.35,
	ArchCoward:      0.60,
	ArchTerritorial: 0.85,
}

// coolBatch is one death's worth of cooling cells, retired together.
type coolBatch struct {
	until uint32
	cells []int
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

// reclaimCoolRegion gives the connected patch of cooling cells that touch
// `start` back to its former owner. Returns the number of cells restored.
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
	n := 0
	for len(q) > 0 {
		i := q[len(q)-1]
		q = q[:len(q)-1]
		r.setGrid(i, p.num)
		n++
		x := i % W
		y := i / W
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
	r.bfsQ = q[:0]
	return n
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
		r.coolBatches = append(r.coolBatches, coolBatch{until: until, cells: batch})
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

func (r *Room) idx(x, y int) int {
	return y*W + x
}

func inBounds(x, y int) bool {
	return x >= 0 && x < W && y >= 0 && y < H
}

func packChange(i uint16, owner uint16) uint32 {
	return (uint32(i) << 16) | uint32(owner)
}

func isOpposite(a, b Dir) bool {
	return (a == DirUp && b == DirDown) || (a == DirDown && b == DirUp) || (a == DirLeft && b == DirRight) || (a == DirRight && b == DirLeft)
}

func (r *Room) pickSpawnCell() (int, int) {
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

		// Weights chosen to keep it fast and stable.
		return int32(minD*14) - int32(occ*3) - borderPenalty
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

	if p.bot {
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
		snap := ""
		if debugBotDeathSnap {
			snapCX := headX
			snapCY := headY
			if reason == "self_trail" {
				snapCX = prevX
				snapCY = prevY
			}
			snap = r.botLocalSnapshot(num, snapCX, snapCY, hx, hy, 5)
		}
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
				pr := profileForKey(k.profileKey)
				if pr != nil {
					profilesMu.Lock()
					r.ensureProfileDailyLocked(pr)
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
				r.addStyle(k, 20, StyleRevenge)
				r.awardPoints(k.num, 10, PointsRevenge)
				if !k.bot {
					pr := profileForKey(k.profileKey)
					if pr != nil {
						profilesMu.Lock()
						r.ensureProfileDailyLocked(pr)
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
			r.addStyle(k, 40, StyleBounty)
			r.awardPoints(k.num, 28, PointsBounty)
			if !k.bot {
				pr := profileForKey(k.profileKey)
				if pr != nil {
					profilesMu.Lock()
					r.ensureProfileDailyLocked(pr)
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

func (r *Room) killPlayer(num uint16) {
	r.killPlayerWithReason(num, 0, "unknown", -2, 0, 0)
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

func (r *Room) respawnPlayer(p *Player) {
	x, y := r.pickSpawnCell()
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

func dirToDelta(d Dir) (int, int) {
	switch d {
	case DirUp:
		return 0, -1
	case DirDown:
		return 0, 1
	case DirLeft:
		return -1, 0
	case DirRight:
		return 1, 0
	default:
		return 0, 0
	}
}

func turnLeft(d Dir) Dir {
	switch d {
	case DirUp:
		return DirLeft
	case DirDown:
		return DirRight
	case DirLeft:
		return DirDown
	case DirRight:
		return DirUp
	default:
		return d
	}
}

func turnRight(d Dir) Dir {
	switch d {
	case DirUp:
		return DirRight
	case DirDown:
		return DirLeft
	case DirLeft:
		return DirUp
	case DirRight:
		return DirDown
	default:
		return d
	}
}

func manhattan(x0, y0, x1, y1 int) int {
	dx := x0 - x1
	if dx < 0 {
		dx = -dx
	}
	dy := y0 - y1
	if dy < 0 {
		dy = -dy
	}
	return dx + dy
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
		return dist <= 2
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
	if budget < 6 {
		budget = 6
	}
	if budget > 26 {
		budget = 26
	}
	return budget
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
		closeStart := int(float32(budget)*0.72) + 1
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
	blocked := floodBytesPool.Get().([]byte)
	if len(blocked) != N {
		blocked = make([]byte, N)
	}
	outside := floodBytesPool.Get().([]byte)
	if len(outside) != N {
		outside = make([]byte, N)
	}
	q := floodIntPool.Get().([]int)
	if len(q) != N {
		q = make([]int, N)
	}
	defer floodBytesPool.Put(blocked)
	defer floodBytesPool.Put(outside)
	defer floodIntPool.Put(q)

	for i := 0; i < N; i++ {
		blocked[i] = 0
		outside[i] = 0
		if r.gridOwner[i] == playerNum || r.trailOwner[i] == playerNum {
			blocked[i] = 1
		}
	}
	outside = r.floodFillOutside(blocked, outside, q)

	for i := 0; i < N; i++ {
		if blocked[i] == 0 && outside[i] == 0 {
			r.setGrid(i, playerNum)
			r.setTrail(i, 0)
		}
	}

	p := r.players[playerNum]
	if p != nil {
		ownedBefore := len(p.owned)
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
			if pr := profileForKey(p.profileKey); pr != nil && trailLen > 0 {
				profilesMu.Lock()
				if pr.TotalCapture < ^uint32(0)-uint32(trailLen) {
					pr.TotalCapture += uint32(trailLen)
				} else {
					pr.TotalCapture = ^uint32(0)
				}
				achvCount := r.checkAchievementsLocked(p, pr)
				profilesMu.Unlock()
				markProfilesDirty()
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
			r.pushEvent(Event{Kind: EventCapture, A: p.num, X: x, Y: y, C: uint32(delta), D: p.cosCaptureFx})
			// E9: sqrt curve instead of delta/4 with a cap of 60. A 1000 cell
			// loop is nine seconds of lethal risk and must beat a 240 cell one.
			ptsF := 1.6 * math.Sqrt(float64(delta))
			maxPts := 100.0
			if r.matchPhase() == PhaseFinal {
				// F4: the endgame pays double for territory.
				ptsF *= 2
				maxPts *= 2
			}
			if r.mutatorType == MutatorDoubleCapture {
				ptsF *= 1.25
				maxPts *= 1.3
			}
			if ptsF > maxPts {
				ptsF = maxPts
			}
			if ptsF < 3 {
				ptsF = 3
			}
			r.awardPoints(p.num, uint16(ptsF), PointsCapture)

			// E2: territory finally feeds the meta. Without this the optimal
			// strategy was to ignore the map and farm bot tails.
			gain := uint16(delta / StyleCaptureCellsPer)
			if gain == 0 {
				gain = 1
			}
			r.addStyleCapped(p, gain, StyleCapture, &p.styleCaptureMatch, StyleCaptureMatchCap)
		}
		if r.mutatorType == MutatorDoubleCapture {
			r.bonusTerritory(playerNum, p.x, p.y, 1)
		}
	}
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
	cellToPlayers := make(map[int][]uint16)
	for _, p := range alive {
		i := p.nextI
		if i == -1 {
			continue
		}
		cellToPlayers[i] = append(cellToPlayers[i], p.num)
	}
	for _, nums := range cellToPlayers {
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
				pr := profileForKey(p.profileKey)
				if pr != nil {
					profilesMu.Lock()
					r.ensureProfileDailyLocked(pr)
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
			// E3: rewards follow the ABSOLUTE place among every participant,
			// bots included. Ranking humans only made the single human in a
			// room a guaranteed "winner" no matter how badly they played.
			// Only humans are paid; bots have nothing to spend Style on.
			for _, mr := range res {
				if mr.Bot || mr.Place > 5 {
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
				default:
					r.addStyle(p, StylePlace45, StyleTop5)
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
				"tick":    r.tick,
				"seq":     r.matchSeq,
				"endTick": r.matchEndTick,
			}
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
	for _, p := range alive {
		if p == nil || !p.alive {
			continue
		}
		if p.speedUntil != 0 && r.tick < p.speedUntil {
			r.stepPlayer(p)
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
		c.mu.Unlock()

		x := W / 2
		y := H / 2
		if pl != nil {
			a := anchors[pl.num]
			if a.alive && a.x >= 0 && a.y >= 0 {
				x = a.x
				y = a.y
				dx, dy := dirToDelta(a.dir)
				x += dx * ROILookahead
				y += dy * ROILookahead
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

		rw := ROIWidth
		rh := ROIHeight
		if rw > W {
			rw = W
		}
		if rh > H {
			rh = H
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

			rx = (rx / ROIStep) * ROIStep
			ry = (ry / ROIStep) * ROIStep
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

		fullROI := forceROI || lastTick == 0 || rx != lastROIX || ry != lastROIY
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
	if tickNow%10 == 0 {
		d := time.Since(stepStartedAt)
		log.Printf(
			"room_step_stat room=%d tick=%d total_ms=%.3f bot_ms=%.3f move_ms=%.3f roi_ms=%.3f send_ms=%.3f clients=%d players=%d alive=%d forceROI=%t changedGrid=%d changedTrail=%d roiFast=%d roiScan=%d roiSkipped=%d",
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

func (r *Room) buildROIPooledFast(rx, ry, rw, rh int, sinceTick uint32, players []*Player) *pooledData {
	dg := acquireU32(256)
	dt := acquireU32(256)

	minX := rx
	minY := ry
	maxX := rx + rw
	maxY := ry + rh

	for _, ch := range r.changedGrid {
		i := int(ch >> 16)
		x := i % W
		y := i / W
		if x >= minX && x < maxX && y >= minY && y < maxY {
			dg = append(dg, ch)
		}
	}
	for _, ch := range r.changedTrail {
		i := int(ch >> 16)
		x := i % W
		y := i / W
		if x >= minX && x < maxX && y >= minY && y < maxY {
			dt = append(dt, ch)
		}
	}

	plCount := len(players)
	bytesPlayers := plCount * (2 + 2 + 2 + 1 + 1 + 2 + 2 + 2 + 1 + 1 + 5)
	bytesDG := len(dg) * 4
	bytesDT := len(dt) * 4
	capHint := 1 + 4 + 2 + bytesPlayers + 2 + 2 + 2 + 2 + 4 + 4 + bytesDG + bytesDT
	if capHint < 64 {
		capHint = 64
	}
	pd := acquirePooledData(capHint)
	out := pd.b

	out = append(out, MsgROIBinary)
	out = appendU32LE(out, r.tick)
	out = appendU16LE(out, uint16(plCount))
	for _, p := range players {
		out = appendU16LE(out, p.num)
		out = appendU16LE(out, uint16(maxInt(0, p.x)))
		out = appendU16LE(out, uint16(maxInt(0, p.y)))
		out = append(out, uint8(p.dir))
		if p.alive {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = appendU16LE(out, r.scores[p.num])
		out = appendU16LE(out, r.points[p.num])
		out = appendU16LE(out, p.hue)
		out = append(out, r.playerShieldBits(p))
		if p.bot {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = append(out, p.cosCaptureFx, p.cosHead, p.cosSeg, p.cosNameplate, p.cosFrame)
	}
	out = appendU16LE(out, uint16(rx))
	out = appendU16LE(out, uint16(ry))
	out = appendU16LE(out, uint16(rw))
	out = appendU16LE(out, uint16(rh))
	out = appendU32LE(out, uint32(bytesDG))
	out = appendU32LE(out, uint32(bytesDT))
	for _, v := range dg {
		out = appendU32LE(out, v)
	}
	for _, v := range dt {
		out = appendU32LE(out, v)
	}

	pd.b = out
	releaseU32(dg)
	releaseU32(dt)
	_ = sinceTick
	return pd
}

func (r *Room) buildROIPooledScan(rx, ry, rw, rh int, full bool, sinceTick uint32, players []*Player) *pooledData {
	dg := acquireU32(rw * rh / 2)
	dt := acquireU32(rw * rh / 4)

	for y := ry; y < ry+rh; y++ {
		row := y * W
		for x := rx; x < rx+rw; x++ {
			i := row + x
			if full || r.gridStamp[i] > sinceTick {
				dg = append(dg, packChange(uint16(i), r.gridWireAt(i)))
			}
			if full || r.trailStamp[i] > sinceTick {
				dt = append(dt, packChange(uint16(i), r.trailOwner[i]))
			}
		}
	}

	plCount := len(players)
	bytesPlayers := plCount * (2 + 2 + 2 + 1 + 1 + 2 + 2 + 2 + 1 + 1 + 5)
	bytesDG := len(dg) * 4
	bytesDT := len(dt) * 4
	capHint := 1 + 4 + 2 + bytesPlayers + 2 + 2 + 2 + 2 + 4 + 4 + bytesDG + bytesDT
	if capHint < 64 {
		capHint = 64
	}
	pd := acquirePooledData(capHint)
	out := pd.b

	out = append(out, MsgROIBinary)
	out = appendU32LE(out, r.tick)
	out = appendU16LE(out, uint16(plCount))
	for _, p := range players {
		out = appendU16LE(out, p.num)
		out = appendU16LE(out, uint16(maxInt(0, p.x)))
		out = appendU16LE(out, uint16(maxInt(0, p.y)))
		out = append(out, uint8(p.dir))
		if p.alive {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = appendU16LE(out, r.scores[p.num])
		out = appendU16LE(out, r.points[p.num])
		out = appendU16LE(out, p.hue)
		out = append(out, r.playerShieldBits(p))
		if p.bot {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = append(out, p.cosCaptureFx, p.cosHead, p.cosSeg, p.cosNameplate, p.cosFrame)
	}
	out = appendU16LE(out, uint16(rx))
	out = appendU16LE(out, uint16(ry))
	out = appendU16LE(out, uint16(rw))
	out = appendU16LE(out, uint16(rh))
	out = appendU32LE(out, uint32(bytesDG))
	out = appendU32LE(out, uint32(bytesDT))
	for _, v := range dg {
		out = appendU32LE(out, v)
	}
	for _, v := range dt {
		out = appendU32LE(out, v)
	}

	pd.b = out
	releaseU32(dg)
	releaseU32(dt)
	return pd
}

func (r *Room) buildMinimapChunkBinary(full bool) []byte {
	chunksX := MinimapChunksX
	chunksY := MinimapChunksY
	if chunksX <= 0 || chunksY <= 0 {
		return nil
	}

	chunks := make([]int, 0, MinimapMaxChunksPerMsg)
	if !full {
		var seen [MinimapChunksX * MinimapChunksY]uint8
		unique := 0
		threshold := MinimapMaxChunksPerMsg * 2

		addChunk := func(i int) {
			cx := (i % W) / MinimapChunkW
			cy := (i / W) / MinimapChunkH
			idx := cy*chunksX + cx
			if idx < 0 || idx >= len(seen) {
				return
			}
			if seen[idx] == 1 {
				return
			}
			seen[idx] = 1
			unique++
			if unique <= threshold {
				if len(chunks) < MinimapMaxChunksPerMsg {
					chunks = append(chunks, idx)
				}
			}
		}

		for _, ch := range r.minimapGrid {
			addChunk(int(ch >> 16))
			if unique > threshold {
				break
			}
		}

		if unique > threshold {
			r.minimapFullActive = true
			r.minimapFullCursor = 0
			full = true
			chunks = chunks[:0]
		} else if len(chunks) == 0 {
			return nil
		}
	}

	if full {
		start := r.minimapFullCursor
		for len(chunks) < MinimapMaxChunksPerMsg {
			idx := start + len(chunks)
			if idx >= chunksX*chunksY {
				break
			}
			chunks = append(chunks, idx)
		}
		r.minimapFullCursor = start + len(chunks)
		if r.minimapFullCursor >= chunksX*chunksY {
			r.minimapFullActive = false
			r.minimapFullCursor = 0
		}
	} else {
		// chunks already collected for the delta case
	}

	// type(1) + tick(4) + cw(1)+ch(1)+count(2)+flags(1) + chunks*(cx(1)+cy(1)+payload)
	chunkCells := MinimapChunkW * MinimapChunkH
	payloadBytes := chunkCells * 2
	out := make([]byte, 0, 1+4+1+1+2+1+len(chunks)*(2+payloadBytes))
	out = append(out, MsgMinimapChunk)
	var b4 [4]byte
	binary.LittleEndian.PutUint32(b4[:], r.tick)
	out = append(out, b4[:]...)
	out = append(out, uint8(MinimapChunkW), uint8(MinimapChunkH))
	var b2 [2]byte
	binary.LittleEndian.PutUint16(b2[:], uint16(len(chunks)))
	out = append(out, b2[:]...)
	// flags: bit0 = hasTrail (0 for grid-only minimap)
	out = append(out, 0)

	for _, idx := range chunks {
		cx := idx % chunksX
		cy := idx / chunksX
		out = append(out, uint8(cx), uint8(cy))
		x0 := cx * MinimapChunkW
		y0 := cy * MinimapChunkH
		for yy := 0; yy < MinimapChunkH; yy++ {
			for xx := 0; xx < MinimapChunkW; xx++ {
				gx := x0 + xx
				gy := y0 + yy
				var v uint16
				if gx >= 0 && gx < W && gy >= 0 && gy < H {
					v = r.gridWireAt(gy*W + gx)
				}
				binary.LittleEndian.PutUint16(b2[:], v)
				out = append(out, b2[:]...)
			}
		}
	}

	return out
}

func (r *Room) buildROIBinary(rx, ry, rw, rh int, full bool, sinceTick uint32, players []*Player) []byte {
	// packed changes use absolute cell index, so the client can patch its full arrays
	dg := make([]uint32, 0, rw*rh/2)
	dt := make([]uint32, 0, rw*rh/4)

	for y := ry; y < ry+rh; y++ {
		row := y * W
		for x := rx; x < rx+rw; x++ {
			i := row + x
			if full || r.gridStamp[i] > sinceTick {
				dg = append(dg, packChange(uint16(i), r.gridWireAt(i)))
			}
			if full || r.trailStamp[i] > sinceTick {
				dt = append(dt, packChange(uint16(i), r.trailOwner[i]))
			}
		}
	}

	plCount := len(players)
	bytesPlayers := plCount * (2 + 2 + 2 + 1 + 1 + 2 + 2 + 2 + 1 + 1 + 5)
	bytesDG := len(dg) * 4
	bytesDT := len(dt) * 4

	out := make([]byte, 0, 1+4+2+bytesPlayers+2+2+2+2+4+4+bytesDG+bytesDT)
	pushU8 := func(v uint8) { out = append(out, v) }
	pushU16 := func(v uint16) {
		var b [2]byte
		binary.LittleEndian.PutUint16(b[:], v)
		out = append(out, b[:]...)
	}
	pushU32 := func(v uint32) {
		var b [4]byte
		binary.LittleEndian.PutUint32(b[:], v)
		out = append(out, b[:]...)
	}

	pushU8(MsgROIBinary)
	pushU32(r.tick)
	pushU16(uint16(plCount))
	for _, p := range players {
		pushU16(p.num)
		pushU16(uint16(maxInt(0, p.x)))
		pushU16(uint16(maxInt(0, p.y)))
		pushU8(uint8(p.dir))
		if p.alive {
			pushU8(1)
		} else {
			pushU8(0)
		}
		pushU16(r.scores[p.num])
		pushU16(r.points[p.num])
		pushU16(p.hue)
		pushU8(r.playerShieldBits(p))
		if p.bot {
			pushU8(1)
		} else {
			pushU8(0)
		}
		pushU8(p.cosCaptureFx)
		pushU8(p.cosHead)
		pushU8(p.cosSeg)
		pushU8(p.cosNameplate)
		pushU8(p.cosFrame)
	}
	pushU16(uint16(rx))
	pushU16(uint16(ry))
	pushU16(uint16(rw))
	pushU16(uint16(rh))
	pushU32(uint32(bytesDG))
	pushU32(uint32(bytesDT))
	for _, v := range dg {
		pushU32(v)
	}
	for _, v := range dt {
		pushU32(v)
	}
	return out
}

func (r *Room) buildStateBinary(full bool) []byte {
	players := make([]*Player, 0, len(r.players))
	for _, p := range r.players {
		players = append(players, p)
	}

	gridBytes := 0
	trailBytes := 0
	dgBytes := 0
	dtBytes := 0
	if full {
		gridBytes = len(r.gridOwner) * 2
		trailBytes = len(r.trailOwner) * 2
	} else {
		dgBytes = len(r.changedGrid) * 4
		dtBytes = len(r.changedTrail) * 4
	}

	headerBytes := 1 + 1 + 4 + 2
	playerBytes := len(players) * 21
	lensBytes := 4 + 4
	payloadBytes := 0
	if full {
		payloadBytes = gridBytes + trailBytes
	} else {
		payloadBytes = dgBytes + dtBytes
	}

	total := headerBytes + playerBytes + lensBytes + payloadBytes
	out := make([]byte, total)
	o := 0
	out[o] = MsgStateBinary
	o++
	if full {
		out[o] = 1
	} else {
		out[o] = 0
	}
	o++
	binary.LittleEndian.PutUint32(out[o:], r.tick)
	o += 4
	binary.LittleEndian.PutUint16(out[o:], uint16(len(players)))
	o += 2

	for _, p := range players {
		binary.LittleEndian.PutUint16(out[o:], p.num)
		o += 2
		binary.LittleEndian.PutUint16(out[o:], uint16(maxInt(0, p.x)))
		o += 2
		binary.LittleEndian.PutUint16(out[o:], uint16(maxInt(0, p.y)))
		o += 2
		out[o] = uint8(p.dir)
		o++
		if p.alive {
			out[o] = 1
		} else {
			out[o] = 0
		}
		o++
		sc := r.scores[p.num]
		binary.LittleEndian.PutUint16(out[o:], sc)
		o += 2
		binary.LittleEndian.PutUint16(out[o:], r.points[p.num])
		o += 2
		binary.LittleEndian.PutUint16(out[o:], p.hue)
		o += 2
		out[o] = r.playerShieldBits(p)
		o++
		if p.bot {
			out[o] = 1
		} else {
			out[o] = 0
		}
		o++
		out[o] = p.cosCaptureFx
		o++
		out[o] = p.cosHead
		o++
		out[o] = p.cosSeg
		o++
		out[o] = p.cosNameplate
		o++
		out[o] = p.cosFrame
		o++
	}

	if full {
		binary.LittleEndian.PutUint32(out[o:], uint32(gridBytes))
		o += 4
		binary.LittleEndian.PutUint32(out[o:], uint32(trailBytes))
		o += 4
		for i := range r.gridOwner {
			binary.LittleEndian.PutUint16(out[o:], r.gridWireAt(i))
			o += 2
		}
		for _, v := range r.trailOwner {
			binary.LittleEndian.PutUint16(out[o:], v)
			o += 2
		}
		return out
	}

	binary.LittleEndian.PutUint32(out[o:], uint32(dgBytes))
	o += 4
	binary.LittleEndian.PutUint32(out[o:], uint32(dtBytes))
	o += 4
	for _, v := range r.changedGrid {
		binary.LittleEndian.PutUint32(out[o:], v)
		o += 4
	}
	for _, v := range r.changedTrail {
		binary.LittleEndian.PutUint32(out[o:], v)
		o += 4
	}
	return out
}

func parseDir(s string) (Dir, bool) {
	switch s {
	case "up":
		return DirUp, true
	case "down":
		return DirDown, true
	case "left":
		return DirLeft, true
	case "right":
		return DirRight, true
	default:
		return 0, false
	}
}

func sanitizeLogField(s string) string {
	raw := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(s))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= 200 {
			break
		}
		if unicode.IsControl(ch) {
			continue
		}
		out = append(out, ch)
	}
	return strings.TrimSpace(string(out))
}

func sanitizeName(name string) string {
	raw := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(name))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= NameMaxLen {
			break
		}
		if ch < 0x20 || ch == '<' || ch == '>' {
			continue
		}
		out = append(out, ch)
	}
	res := strings.TrimSpace(string(out))
	if res == "" {
		return ""
	}
	return res
}

func sanitizeChat(text string) string {
	raw := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(text))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= ChatMaxLen {
			break
		}
		if ch < 0x20 || ch == '<' || ch == '>' {
			continue
		}
		out = append(out, ch)
	}
	res := strings.TrimSpace(string(out))
	if res == "" {
		return ""
	}
	return res
}

func (r *Room) randInt(min int, max int) int {
	if max <= min {
		return min
	}
	return min + r.rng.Intn(max-min+1)
}

type hslVariant struct {
	s int
	l int
}

var colorVariants = []hslVariant{
	{s: 78, l: 52},
	{s: 78, l: 42},
	{s: 78, l: 62},
	{s: 90, l: 52},
	{s: 66, l: 52},
	{s: 90, l: 62},
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

func colorCodeToHSL(code uint16) (h int, s int, l int) {
	vCount := len(colorVariants)
	if vCount <= 0 {
		return int(code) % 360, 78, 52
	}
	c := int(code)
	h = c % 360
	if h < 0 {
		h = (h%360 + 360) % 360
	}
	vi := (c / 360) % vCount
	if vi < 0 {
		vi = (vi%vCount + vCount) % vCount
	}
	v := colorVariants[vi]
	return h, v.s, v.l
}

func colorDistance(a, b uint16) int {
	ha, sa, la := colorCodeToHSL(a)
	hb, sb, lb := colorCodeToHSL(b)
	dh := hueDistance(ha, hb)
	ds := absInt(sa - sb)
	dl := absInt(la - lb)
	return dh*4 + ds*3 + dl*3
}

func hueDistance(a, b int) int {
	d := a - b
	if d < 0 {
		d = -d
	}
	d = d % 360
	if d > 180 {
		return 360 - d
	}
	return d
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
