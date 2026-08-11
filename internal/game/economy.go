// economy.go holds the reward economy: Style and match points, contracts,
// dailies, achievements, titles and the cosmetics catalogue.
package game

import (
	"context"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"snakes/internal/profiles"

	"snakes/internal/metrics"
)

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
	if reason > PointsHold {
		reason = PointsOther
	}
	// The mark to beat is the best score among the OTHER players, dead or alive:
	// counting only the living made every multiplier jump around while the
	// leader lay dead, and counting the receiver himself made the gap
	// non-negative by construction — the leader penalty promised below could
	// never fire. With nobody else in the room best stays 0 and the band is off,
	// so a lone player never penalises himself.
	best := uint16(0)
	for _, o := range r.players {
		if o == nil || o.num == num {
			continue
		}
		if v := r.points[o.num]; v > best {
			best = v
		}
	}
	me := r.points[num]
	mult := float32(1.0)
	// Rubber-band only starts after the match has "some" points to avoid early randomness.
	//
	// G4: bots are excluded. Applying it to them compressed all 14 into a
	// 475-640 band, so the 8th place a beginner is supposed to be able to reach
	// cost ~550 points and the measured result was place 14/14 in 20 matches out
	// of 20. Without the band the bot field spreads out naturally and the tail
	// places become reachable; humans keep the catch-up help.
	if !p.bot && best >= 20 {
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

// dailyRollType picks a quest type for a slot from the profile id and the day.
// It has to be deterministic: the quests sent at join are rolled on a transient
// profile (profiles.ForKey), and the stored profile created later on the first
// real grant must come up with exactly the same set, otherwise the client shows
// quests that nothing is counting towards.
func dailyRollType(pid string, day int64, slot uint8) uint8 {
	h := uint32(2166136261)
	mix := func(b byte) {
		h ^= uint32(b)
		h *= 16777619
	}
	for i := 0; i < len(pid); i++ {
		mix(pid[i])
	}
	for s := 0; s < 8; s++ {
		mix(byte(day >> (8 * s)))
	}
	mix(slot)
	return uint8(1 + h%4)
}

func ensureProfileDailyLocked(p *profiles.Profile, pid string) {
	if p == nil {
		return
	}
	today := profiles.DayStampNow()
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
		nt := dailyRollType(pid, today, slot)
		*t = nt
		*goal = dailyGoalFor(slot, nt)
		*prog = 0
	}
	roll(1, &p.DailyType1, &p.DailyGoal1, &p.DailyProg1)
	roll(2, &p.DailyType2, &p.DailyGoal2, &p.DailyProg2)
	roll(3, &p.DailyType3, &p.DailyGoal3, &p.DailyProg3)
}

// dailyStreakMultLocked returns the daily reward multiplier: 1 + 0.25*(streak-1),
// capped at x2. Caller holds profiles.Mu.
func dailyStreakMultLocked(pr *profiles.Profile) float32 {
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
	pr := profiles.ForKey(p.profileKey)
	if pr == nil {
		return
	}
	type slotState struct {
		slot uint8
		t    uint8
		goal uint16
		prog uint16
	}
	profiles.Mu.Lock()
	ensureProfileDailyLocked(pr, p.profileKey)
	slots := [3]slotState{
		{1, pr.DailyType1, pr.DailyGoal1, pr.DailyProg1},
		{2, pr.DailyType2, pr.DailyGoal2, pr.DailyProg2},
		{3, pr.DailyType3, pr.DailyGoal3, pr.DailyProg3},
	}
	// pr may be a transient profile (nothing earned yet): rolling its quests
	// changes nothing on disk, so do not wake the autosave for it.
	stored := profiles.StoredLocked(p.profileKey) != nil
	profiles.Mu.Unlock()
	if stored {
		profiles.MarkDirty()
	}

	for _, s := range slots {
		r.pushEvent(Event{Kind: EventDailyAssign, A: p.num, B: s.goal, C: (uint32(s.t) << 16) | uint32(s.prog), D: s.slot})
	}
}

// checkAchievementsLocked unlocks every achievement whose profile counter has
// reached its threshold and returns how many were newly unlocked. The caller
// must pay out the rewards AFTER releasing profiles.Mu (addStyle takes it).
// Caller holds profiles.Mu.
func (r *Room) checkAchievementsLocked(p *Player, pr *profiles.Profile) int {
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

// achvProgressEntry is one row of the "achvProgress" array carried by the
// "cosmetics" payload: the running counter and the threshold of one
// achievement.
type achvProgressEntry struct {
	ID  uint8  `json:"id"`
	Cur uint32 `json:"cur"`
	Max uint32 `json:"max"`
}

// achvProgressLocked snapshots the progress of every achievement, unlocked
// ones included: the client draws a bar per title and had no numbers at all for
// the rows it could not fill from achvMask. Caller holds profiles.Mu.
func achvProgressLocked(pr *profiles.Profile) []achvProgressEntry {
	out := make([]achvProgressEntry, 0, len(achvRules))
	if pr == nil {
		return out
	}
	for _, ru := range achvRules {
		cur := ru.get(pr)
		if cur > ru.need {
			// Counters keep growing after the unlock (and may pass the goal
			// before it is evaluated); never report more than the goal, the
			// client derives the bar fraction straight from cur/max.
			cur = ru.need
		}
		out = append(out, achvProgressEntry{ID: ru.code, Cur: cur, Max: ru.need})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// grantAchievementRewards pays out unlocks found by checkAchievementsLocked.
// Must be called without profiles.Mu held.
func (r *Room) grantAchievementRewards(p *Player, count int) {
	for i := 0; i < count; i++ {
		r.addStyle(p, StyleAchvReward, StyleAchievement)
	}
}

// grantDailyRewards pays out completed daily slots, scaled by the login streak.
// Must be called without profiles.Mu held. dailyRewardDepth keeps the payout
// from feeding the "earn Style" daily back into itself (see addStyle).
func (r *Room) grantDailyRewards(p *Player, count int) {
	if p == nil || count <= 0 {
		return
	}
	mult := float32(1.0)
	if !p.bot {
		if pr := profiles.ForKey(p.profileKey); pr != nil {
			profiles.Mu.Lock()
			mult = dailyStreakMultLocked(pr)
			profiles.Mu.Unlock()
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
	pr := profiles.ForKeyCreate(p.profileKey)
	if pr == nil {
		return
	}
	today := profiles.DayStampNow()
	profiles.Mu.Lock()
	eligible := pr.FirstWinDay != today
	if eligible {
		pr.FirstWinDay = today
	}
	profiles.Mu.Unlock()
	if !eligible {
		return
	}
	profiles.MarkDirty()
	r.addStyle(p, StyleFirstWinBonus, StyleWin)
}

func (r *Room) addDailyProgress(p *Player, kind uint8, inc uint16) {
	if p == nil || p.bot || inc == 0 {
		return
	}
	pr := profiles.ForKeyCreate(p.profileKey)
	if pr == nil {
		return
	}
	profiles.Mu.Lock()
	ensureProfileDailyLocked(pr, p.profileKey)
	rewardCount := r.addDailyProgressLocked(p, pr, kind, inc)
	profiles.Mu.Unlock()
	profiles.MarkDirty()
	r.grantDailyRewards(p, rewardCount)
}

func (r *Room) addDailyProgressLocked(p *Player, pr *profiles.Profile, kind uint8, inc uint16) int {
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
			metrics.DailiesCompletedTotal.Inc(dailyLabel(t))
			rewardCount++
		}
	}
	apply(1, pr.DailyType1, &pr.DailyGoal1, &pr.DailyProg1)
	apply(2, pr.DailyType2, &pr.DailyGoal2, &pr.DailyProg2)
	apply(3, pr.DailyType3, &pr.DailyGoal3, &pr.DailyProg3)
	return rewardCount
}

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
	// StyleSurvive: G23 consolation for finishing the match alive.
	StyleSurvive = 10
)

// StyleReasonCount sizes the per-match breakdown arrays (matchResult.Sb): the
// highest reason code plus one.
const StyleReasonCount = 11

// Per-match Style budgets and rates.
const (
	// G20: at 40 cells per Style with a 25 cap the ceiling was reached after
	// 1000 new cells, i.e. in the first 60-90 seconds, after which the core
	// mechanic of the game paid literally nothing for the remaining 3.5-4
	// minutes.
	//
	// G1: the unit is the capture delta, i.e. the trail actually drawn outside
	// your own land, not the enclosed area — a measured honest match produces
	// ~1300 of those, not tens of thousands. At 70 per Style the floor
	// (`gain = 1`) was carrying the entire payout: removing it took an honest
	// match from ~37 Style down to 19, while a nibbler still reached the 70 cap
	// in 25 seconds. 25 per Style restores the honest income (~50/match) on a
	// rate that is now strictly proportional to the risk taken.

	// CaptureMinCells is the smallest capture that is worth any match points at
	// all (G1). Below it the loop is a nibble at your own border: no risk, no
	// pay. A 12-cell loop is still a real detour outside your land.
	CaptureMinCells = 12

	// Enclosed cells per 1 Style. This used to read 25 and was calibrated
	// against the TRAIL length, because capture() accidentally fed it the
	// perimeter instead of the area (the ownedBefore snapshot was taken after
	// the interior had already been filled). Fixing that made the same loop
	// report ~3.4x more cells, which would have inflated the currency and let a
	// player hit StyleCaptureMatchCap in a fraction of the intended time — the
	// very problem G1 was written to stop. Rescaled by that ratio so the Style
	// income per match stays where it was tuned; the fix shows up in match
	// POINTS (big loops finally out-earn nibbles), not in currency.
	StyleCaptureCellsPer = 85
	StyleCaptureMatchCap = 70  // E2: max Style from captures per match
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

	// G11: revenge (20) and "survived the bounty" (30) were the only Style
	// sources with no per-match budget at all, which made repeatedly trading
	// deaths with one bot a farm inside the 900-tick revenge window. Both now
	// have a budget, and revenge additionally needs a different victim (or the
	// cooldown) to pay again.
	StyleRevengeReward        = 20
	StyleRevengeMatchCap      = 60
	RevengeSameTargetCooldown = 900
	StyleBountyKill           = 40
	StyleBountyMatchCap       = 120

	// E3: placement rewards use the absolute place among every participant.
	// G23: a room holds ~15 participants and every one of the 14 bots really
	// does outrank a beginner, so paying only the top 5 meant a new player saw
	// a flat 0 for the single most visible line of the summary, every match.
	// The tail now reaches 8th place and everyone who is still standing at the
	// final tick gets a consolation payment.
	StylePlace1  = 40
	StylePlace23 = 25
	StylePlace45 = 15
	StylePlace6  = 10
	StylePlace7  = 8
	StylePlace8  = 6
	// StyleSurviveReward: paid to every human alive at the final tick.
	StyleSurviveReward = 5

	MaxContractsMatch  = 4 // E5
	StyleAddMaxDepth   = 4 // E12: hard bound on addStyle re-entrancy
	SpawnGraceTicks    = 15
	KillStreakWindow   = 150 // F9
	BountyWindowTicks  = 700
	BountyCooldown     = 400 // E11
	BountyCooldownLate = 150 // F4: the final phase re-arms the bounty faster

	// BountyWeightFloor is the weight the weakest candidate carries in the
	// bounty draw; everyone else adds their lead over him (R2). It sets how
	// hard the draw tilts. At the measured end-of-match spread (leader ~1100,
	// tail ~570) the leader comes out about four times as likely as the tail,
	// and the tail still keeps a real chance rather than an exemption. Early
	// in the match the field is bunched and the draw is nearly flat, which is
	// correct — there is no leader to mark yet.
	BountyWeightFloor = 150
)

const (
	PointsOther    = 0
	PointsKill     = 1
	PointsRevenge  = 2
	PointsBounty   = 3
	PointsContract = 4
	PointsDaily    = 5
	PointsCapture  = 6
	// PointsHold: G2, periodic pay for territory actually held. matchPointsBy
	// is [8]uint16, so 7 is the last free slot.
	PointsHold = 7
)

// G2: holding territory is the core of the genre and used to pay exactly
// nothing — points were only ever credited at the moment of a capture, so an
// "empire" was worth defending only as a tiebreaker. These constants pay for
// the integral of held cells over time.
const (
	// HoldPayEveryTicks: one payout per second at 100ms per tick.
	HoldPayEveryTicks = 10
	// HoldCellTicksPerPoint: 24000 cell-ticks == 1 point. Holding 2000 cells
	// pays 0.83 pts/s, i.e. the match cap in ~5 minutes of perfect defence.
	// Holding 500 cells over a whole match is worth ~62.
	HoldCellTicksPerPoint = 24000
	// HoldPointsMatchCap keeps defence comparable to, but never better than,
	// active play: a good aggressive match is 700-900 points.
	HoldPointsMatchCap = 250
)

const (
	DailyKills   = 1
	DailyPickups = 2
	DailyCapture = 3
	DailyStyle   = 4
)

// Achievement codes. They index bits of profiles.Profile.AchvMask (uint32), so the
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
	AchvFirstMatch   = 22
)

// achvRule binds an achievement code to a profile counter and its threshold.
type achvRule struct {
	code uint8
	need uint32
	get  func(pr *profiles.Profile) uint32
}

var achvRules = []achvRule{
	{AchvKills10, 10, func(pr *profiles.Profile) uint32 { return pr.TotalKills }},
	{AchvKills100, 100, func(pr *profiles.Profile) uint32 { return pr.TotalKills }},
	{AchvKills1000, 1000, func(pr *profiles.Profile) uint32 { return pr.TotalKills }},
	{AchvContracts3, 3, func(pr *profiles.Profile) uint32 { return pr.TotalContracts }},
	{AchvContracts25, 25, func(pr *profiles.Profile) uint32 { return pr.TotalContracts }},
	{AchvContracts100, 100, func(pr *profiles.Profile) uint32 { return pr.TotalContracts }},
	{AchvCapture1k, 1000, func(pr *profiles.Profile) uint32 { return pr.TotalCapture }},
	{AchvCapture10k, 10000, func(pr *profiles.Profile) uint32 { return pr.TotalCapture }},
	{AchvCapture100k, 100000, func(pr *profiles.Profile) uint32 { return pr.TotalCapture }},
	{AchvBounty3, 3, func(pr *profiles.Profile) uint32 { return pr.TotalBounty }},
	{AchvBounty15, 15, func(pr *profiles.Profile) uint32 { return pr.TotalBounty }},
	{AchvRevenge3, 3, func(pr *profiles.Profile) uint32 { return pr.TotalRevenge }},
	{AchvRevenge15, 15, func(pr *profiles.Profile) uint32 { return pr.TotalRevenge }},
	{AchvStyle200, 200, func(pr *profiles.Profile) uint32 { return pr.TotalStyleGained }},
	{AchvStyle2000, 2000, func(pr *profiles.Profile) uint32 { return pr.TotalStyleGained }},
	{AchvStyle10000, 10000, func(pr *profiles.Profile) uint32 { return pr.TotalStyleGained }},
	{AchvPickups25, 25, func(pr *profiles.Profile) uint32 { return pr.TotalPickups }},
	{AchvPickups250, 250, func(pr *profiles.Profile) uint32 { return pr.TotalPickups }},
	{AchvStreak3, 3, func(pr *profiles.Profile) uint32 { return pr.StreakDays }},
	{AchvStreak7, 7, func(pr *profiles.Profile) uint32 { return pr.StreakDays }},
	{AchvStreak30, 30, func(pr *profiles.Profile) uint32 { return pr.StreakDays }},
	{AchvFirstMatch, 1, func(pr *profiles.Profile) uint32 { return pr.TotalMatches }},
}

func ensureProfileCosmeticsLocked(pr *profiles.Profile) {
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
const TitleMaxID = 13

// titleRule binds a title id to the achievement that unlocks it.
//
// R5: nameEn travels with the rule for the same reason bot nicknames carry
// one. The client keeps its own translation table and falls back to the
// server name when a title is newer than the client — which meant the
// fallback served Russian into an English UI. Now both names are on the wire
// and the fallback is correct in either language.
type titleRule struct {
	id     uint8
	achv   uint8
	name   string
	nameEn string
}

var titleRules = []titleRule{
	{1, AchvKills10, "Боец", "Fighter"},
	{2, AchvKills100, "Нагибатор", "Crusher"},
	{3, AchvKills1000, "Легенда", "Legend"},
	{4, AchvCapture10k, "Землевладелец", "Landlord"},
	{5, AchvCapture100k, "Картограф", "Cartographer"},
	{6, AchvRevenge15, "Мститель", "Avenger"},
	{7, AchvContracts25, "Подрядчик", "Contractor"},
	{8, AchvContracts100, "Исполнитель", "Executor"},
	{9, AchvBounty15, "Охотник за головами", "Bounty Hunter"},
	{10, AchvStyle10000, "Модник", "Trendsetter"},
	{11, AchvStreak7, "Завсегдатай", "Regular"},
	{12, AchvStreak30, "Преданный", "Devoted"},
	{13, AchvFirstMatch, "Новичок", "Rookie"},
}

// titlesPayload renders the "achievement -> title" table for the "hello"
// message, so the client can name titles and know what unlocks them.
func titlesPayload() []map[string]any {
	out := make([]map[string]any, 0, len(titleRules))
	for _, tr := range titleRules {
		out = append(out, map[string]any{
			"id":     tr.id,
			"achv":   tr.achv,
			"name":   tr.name,
			"nameEn": tr.nameEn,
		})
	}
	return out
}

// titleMaskLocked returns the bitmask of unlocked title ids. Bit 0 ("no title")
// is always set. Caller holds profiles.Mu.
func titleMaskLocked(pr *profiles.Profile) uint32 {
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
// Caller holds profiles.Mu.
func titleUnlockedLocked(pr *profiles.Profile, id uint8) bool {
	if id > TitleMaxID {
		return false
	}
	return titleMaskLocked(pr)&(uint32(1)<<uint32(id)) != 0
}

func cosmeticsStatePayload(p *Player) map[string]any {
	if p == nil {
		return map[string]any{}
	}
	titleMask := uint32(1)
	achvMask := uint32(0)
	var achvProg []achvProgressEntry
	if pr := profiles.ForKey(p.profileKey); pr != nil {
		profiles.Mu.Lock()
		titleMask = titleMaskLocked(pr)
		achvMask = pr.AchvMask
		achvProg = achvProgressLocked(pr)
		profiles.Mu.Unlock()
	}
	if achvProg == nil {
		achvProg = []achvProgressEntry{}
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
		"achvMask":     achvMask,
		"achvProgress": achvProg,
	}
}

// cosExtraEntry is one row of the "cosExtra" message: the cosmetic categories
// that deliberately stay out of the frozen 21-byte binary player record.
// It also carries the bot identity (G4/S3): the frozen 21-byte binary record
// has a bot flag but no room for the archetype or the tier, and without them a
// player has no way to tell a pushover from a hunter.
type cosExtraEntry struct {
	N     uint16 `json:"n"`
	Terr  uint8  `json:"terr"`
	Death uint8  `json:"death"`
	Title uint8  `json:"title"`
	// Bot gates arch/tier: they are meaningless for a human and are sent as 0.
	Bot bool `json:"bot"`
	// Arch is ArchFarmer/ArchAggressor/ArchCoward/ArchTerritorial (0..3).
	Arch uint8 `json:"arch"`
	// Tier is TierEasy/TierNormal/TierHard (0..2).
	Tier uint8 `json:"tier"`
}

// cosExtraPayloadLocked snapshots every player in the room. Caller holds r.mu;
// the result must be broadcast after releasing it (broadcastJSON takes r.mu).
func (r *Room) cosExtraPayloadLocked() map[string]any {
	list := make([]cosExtraEntry, 0, len(r.players))
	for num, p := range r.players {
		if p == nil {
			continue
		}
		e := cosExtraEntry{N: num, Terr: p.cosTerr, Death: p.cosDeath, Title: p.titleID, Bot: p.bot}
		if p.bot {
			e.Arch = p.aiArchetype
			e.Tier = p.aiTier
		}
		list = append(list, e)
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

func cosmeticsStatePayloadFromProfile(pr *profiles.Profile) map[string]any {
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
		"achvMask":     pr.AchvMask,
		"achvProgress": achvProgressLocked(pr),
	}
}

// capturePoints is the score paid for a capture that added `delta` cells.
//
// G20: the previous curve was 1.6*sqrt(delta). For a square of side s the
// trail costs ~3s ticks and the payout was 1.6*s, i.e. points per second were
// a constant independent of loop size — a huge loop paid the same rate as a
// tiny one while spending four times as long under the knife, so the optimal
// strategy was nibbling and skill had nothing to express. An exponent above
// 0.5 makes the rate grow with the loop: 11 points for 100 cells, 31 for 400,
// 88 for 1600, 176 for 4000.
func capturePoints(delta int, phase uint8, mutator uint8) uint16 {
	if delta <= 0 {
		return 0
	}
	// G1: there is no floor any more. The old `if ptsF < 3 { ptsF = 3 }` paid a
	// 2-cell nibble at the edge of your own land the same 3 points as a 60-cell
	// loop, and a nibble is nearly risk free: the measured rate was 10 pts/s for
	// a twitching script against 2.4 pts/s for a real loop, and the score curve
	// became U-shaped. Anything below CaptureMinCells is now worth nothing.
	if delta < CaptureMinCells {
		return 0
	}
	ptsF := 0.35 * math.Pow(float64(delta), 0.75)
	maxPts := 200.0
	if phase == PhaseFinal {
		// F4: the endgame pays double for territory.
		ptsF *= 2
		maxPts *= 2
	}
	if mutator == MutatorDoubleCapture {
		ptsF *= 1.25
		maxPts *= 1.3
	}
	if ptsF > maxPts {
		ptsF = maxPts
	}
	return uint16(ptsF)
}

// payHoldPoints credits the integral of held territory over time (G2). Called
// once every HoldPayEveryTicks ticks with r.mu held. Only living players are
// paid: a dead player holds nothing, his cells are cooling.
func (r *Room) payHoldPoints() {
	for _, p := range r.players {
		if p == nil || !p.alive {
			continue
		}
		cells := uint32(r.scores[p.num])
		if cells == 0 {
			continue
		}
		if p.holdPointsMatch >= HoldPointsMatchCap {
			// Budget spent: stop integrating too, so the accumulator cannot
			// bank a burst that pays out at the start of the next match.
			p.holdAcc = 0
			continue
		}
		p.holdAcc += cells * HoldPayEveryTicks
		gain := p.holdAcc / HoldCellTicksPerPoint
		if gain == 0 {
			continue
		}
		p.holdAcc -= gain * HoldCellTicksPerPoint
		if room := uint32(HoldPointsMatchCap - p.holdPointsMatch); gain > room {
			gain = room
		}
		if gain == 0 {
			continue
		}
		p.holdPointsMatch += uint16(gain)
		r.awardPoints(p.num, uint16(gain), PointsHold)
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

// addStyle credits Style to a player and returns the amount that was actually
// credited. That is not always the requested delta: the re-entrancy guard, the
// per-minute income window and the daily soft cap can all shrink it to zero, and
// callers that keep a budget (addStyleCapped) must debit what was paid, not what
// was asked for.
func (r *Room) addStyle(p *Player, delta uint16, reason uint8) uint16 {
	if p == nil || delta == 0 {
		return 0
	}
	// E12: two independent brakes on the addStyle -> daily -> addStyle loop.
	// styleDepth is a hard bound on re-entrancy, dailyRewardDepth marks Style
	// that is itself a daily payout. Daily progress is only fed by a top-level,
	// non-daily-payout grant, so no single edit can reopen the cycle.
	if p.styleDepth >= StyleAddMaxDepth {
		log.Printf("style_recursion_guard room=%d player=%d reason=%d", r.id, p.num, reason)
		return 0
	}
	p.styleDepth++
	defer func() { p.styleDepth-- }()
	allowDailyProgress := p.styleDepth == 1 && p.dailyRewardDepth == 0

	// The profile is the single source of truth for the balance: never write
	// Player.style back into it, only apply atomic deltas and refresh the cache.
	rewardCount := 0
	achvCount := 0
	var pr *profiles.Profile
	if !p.bot {
		pr = profiles.ForKeyCreate(p.profileKey)
	}
	if pr != nil {
		profiles.Mu.Lock()
		ensureProfileDailyLocked(pr, p.profileKey)
		granted := profiles.StyleIncomeGrantLocked(pr, p.profileKey, delta)
		if granted == 0 {
			profiles.Mu.Unlock()
			return 0
		}
		granted = profiles.StyleDayIncomeGrantLocked(pr, granted)
		if granted == 0 {
			profiles.Mu.Unlock()
			return 0
		}
		delta = granted
		profiles.AddStyleLocked(pr, uint32(delta))
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
		profiles.Mu.Unlock()
		profiles.MarkDirty()
	} else if p.style < ^uint32(0)-uint32(delta) {
		p.style += uint32(delta)
	} else {
		p.style = ^uint32(0)
	}

	metrics.StyleAwardedTotal.Add(styleReasonLabel(reason), uint64(delta))
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
	return delta
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
	// Debit what was actually paid out. Charging the request instead drained the
	// per-match budget while the income throttle was swallowing the grants, so a
	// throttled player stopped earning for the rest of the match instead of
	// resuming when the window rolled over.
	granted := r.addStyle(p, delta, reason)
	*spent += granted
	return granted
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
		metrics.ContractsCompletedTotal.Inc(contractLabel(p.contractType))
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
			pr := profiles.ForKeyCreate(p.profileKey)
			if pr != nil {
				profiles.Mu.Lock()
				ensureProfileDailyLocked(pr, p.profileKey)
				if pr.TotalContracts < ^uint32(0) {
					pr.TotalContracts++
				}
				achvCount := r.checkAchievementsLocked(p, pr)
				profiles.Mu.Unlock()
				profiles.MarkDirty()
				r.grantAchievementRewards(p, achvCount)
			}
		}
		// assignContract itself clears the slot once the match limit is hit.
		r.assignContract(p)
	}
}
