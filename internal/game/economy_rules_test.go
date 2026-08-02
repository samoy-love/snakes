package game

import (
	"math/rand"
	"testing"

	"snakes/internal/profiles"
)

// ---------------------------------------------------------------------------
// Общий помощник: комната с полностью инициализированными матч-картами и
// детерминированным ГСЧ. newTestRoom() из protocol_test.go оставляет
// matchKills/matchStyleBy/... нулевыми, а экономика в них пишет.
// ---------------------------------------------------------------------------

// withEmptyProfileStore изолирует тест от накопленного соседями: карта
// профилей одна на процесс.
func withEmptyProfileStore(t *testing.T) {
	t.Helper()
	t.Cleanup(profiles.SwapStore())
}

func newRulesRoom(t testing.TB, seed int64) *Room {
	t.Helper()
	r := newTestRoom()
	r.rng = rand.New(rand.NewSource(seed))
	r.matchKills = make(map[uint16]uint16)
	r.matchDeaths = make(map[uint16]uint16)
	r.matchStyleEarned = make(map[uint16]uint32)
	r.matchStyleBy = make(map[uint16][StyleReasonCount]uint16)
	r.matchPointsBy = make(map[uint16][8]uint16)
	r.matchContractsBy = make(map[uint16][4]uint16)
	r.matchContractsBy = make(map[uint16][4]uint16)
	r.huntersOn = make(map[uint16]int)
	r.knownNames = make(map[uint16]KnownName)
	r.bfsMark = make([]uint32, N)
	r.bfsDist = make([]uint16, N)
	r.bfsGen = 1
	r.bfsQ = make([]int, 0, 1024)
	r.matchSeq = 1
	r.matchEndTick = MatchDurationTicks
	r.phaseSent = 0xff
	return r
}

// addBotPlayer — бот не трогает хранилище профилей, поэтому все проверки
// «сколько Стиля начислено» на нём детерминированы и не зависят от суточных
// потолков.
func addBotPlayer(r *Room, num uint16) *Player {
	p := &Player{num: num, alive: true, bot: true, x: 50, y: 50, aiCoolCell: -1}
	r.players[num] = p
	r.scores[num] = 0
	r.points[num] = 0
	return p
}

// ---------------------------------------------------------------------------
// capturePoints: кривая 0.35*A^0.75, потолки 200/400, мутатор.
// ---------------------------------------------------------------------------

// Ловит: любую немонотонность кривой (например, возврат «пола» на малых
// площадях или ступеньку из-за целочисленного деления) — большая петля обязана
// платить не меньше маленькой всегда, иначе снова появляется выгодный размер
// «дёргалки».
func TestCapturePointsAreMonotone(t *testing.T) {
	cases := []struct {
		phase   uint8
		mutator uint8
	}{
		{PhaseExpansion, MutatorNone},
		{PhaseConflict, MutatorNone},
		{PhaseFinal, MutatorNone},
		{PhaseConflict, MutatorDoubleCapture},
		{PhaseFinal, MutatorDoubleCapture},
	}
	for _, c := range cases {
		prev := uint16(0)
		for d := 1; d <= 6000; d++ {
			got := capturePoints(d, c.phase, c.mutator)
			if got < prev {
				t.Fatalf("phase=%d mutator=%d: capturePoints(%d)=%d меньше, чем на %d клетках (%d)",
					c.phase, c.mutator, d, got, d-1, prev)
			}
			prev = got
		}
	}
}

// Ловит: потерю удвоения в финале и множителя мутатора (и их потолков).
func TestCapturePointsPhaseAndMutatorMultipliers(t *testing.T) {
	base := capturePoints(400, PhaseConflict, MutatorNone)
	if base == 0 {
		t.Fatal("базовая выплата за 400 клеток равна нулю")
	}
	if got := capturePoints(400, PhaseFinal, MutatorNone); got != base*2 {
		t.Fatalf("финал: %d, ожидалось %d", got, base*2)
	}
	// Мутатор даёт +25% к выплате.
	if got, want := capturePoints(400, PhaseConflict, MutatorDoubleCapture), uint16(float64(base)*1.25); got < want-1 || got > want+1 {
		t.Fatalf("мутатор: %d, ожидалось ~%d", got, want)
	}
	// И поднимает потолок на 30%.
	huge := 1 << 20
	if got := capturePoints(huge, PhaseConflict, MutatorDoubleCapture); got != 260 {
		t.Fatalf("потолок с мутатором = %d, ожидалось 260", got)
	}
	if got := capturePoints(huge, PhaseFinal, MutatorDoubleCapture); got != 520 {
		t.Fatalf("потолок в финале с мутатором = %d, ожидалось 520", got)
	}
}

// Ловит: возвращение доминирующей стратегии «дёргалка». Серия захватов,
// каждый из которых чуть меньше CaptureMinCells, обязана давать РОВНО ноль и
// очков, и Стиля, сколько бы её ни повторяли.
func TestNibbleSeriesPaysNothing(t *testing.T) {
	r := newRulesRoom(t, 1)
	p := addBotPlayer(r, 1)

	total := uint16(0)
	for i := 0; i < 500; i++ {
		total += capturePoints(CaptureMinCells-1, PhaseFinal, MutatorDoubleCapture)
		// Тот же путь, что в capture(): ниже порога накопитель не трогается.
		if CaptureMinCells-1 >= CaptureMinCells {
			p.styleCaptureAcc += CaptureMinCells - 1
		}
		if gain := uint16(p.styleCaptureAcc / StyleCaptureCellsPer); gain > 0 {
			p.styleCaptureAcc -= uint32(gain) * StyleCaptureCellsPer
			r.addStyleCapped(p, gain, StyleCapture, &p.styleCaptureMatch, StyleCaptureMatchCap)
		}
	}
	if total != 0 {
		t.Fatalf("500 микро-захватов дали %d очков, ожидался 0", total)
	}
	if p.styleCaptureMatch != 0 {
		t.Fatalf("500 микро-захватов дали %d Стиля, ожидался 0", p.styleCaptureMatch)
	}
}

// ---------------------------------------------------------------------------
// awardPoints: rubber-band.
// ---------------------------------------------------------------------------

// Ловит: снятие или расширение зажимов резинки. Догоняющий бонус ограничен
// +70%, штраф лидеру — 10%; без потолков отстающий получал бы кратный доход.
func TestRubberBandIsClampedBothWays(t *testing.T) {
	newRoom := func(myPoints, bestPoints uint16) *Room {
		r := newRulesRoom(t, 7)
		me := &Player{num: 1, alive: true}
		lead := &Player{num: 2, alive: true}
		r.players[1] = me
		r.players[2] = lead
		r.points[1] = myPoints
		r.points[2] = bestPoints
		return r
	}

	// Огромное отставание — ровно +70%, не больше.
	r := newRoom(0, 60000)
	r.awardPoints(1, 100, PointsCapture)
	if got := r.points[1]; got != 170 {
		t.Fatalf("максимальный догоняющий бонус дал %d очков, ожидалось 170", got)
	}

	// При равных очках штрафа нет: d = 0, множитель ровно 1.0.
	r = newRoom(60000, 60000)
	before := r.points[1]
	r.awardPoints(1, 100, PointsCapture)
	if got := r.points[1] - before; got != 100 {
		t.Fatalf("при равных очках начислено %d за базу 100, ожидалось 100", got)
	}
	for _, best := range []uint16{20, 100, 1000, 60000} {
		rr := newRoom(best, best)
		rr.awardPoints(1, 100, PointsCapture)
		if got := rr.points[1] - best; got != 100 {
			t.Fatalf("при равных очках best=%d начислено %d за базу 100", best, got)
		}
	}

	// Лидер далеко впереди — работает штраф -10%, ровно как обещает
	// комментарий в awardPoints. Ловит регрессию «best считается по ВСЕМ
	// игрокам, включая самого получателя»: тогда d = best-me >= 0 всегда и
	// штраф молча исчезает.
	r = newRoom(60000, 20)
	before = r.points[1]
	r.awardPoints(1, 100, PointsCapture)
	if got := r.points[1] - before; got != 90 {
		t.Fatalf("лидер с огромным отрывом получил %d очков за базу 100, ожидалось 90", got)
	}
	// Небольшой отрыв штрафует пропорционально, а не сразу на потолок:
	// d = -6, x = -0.05, множитель 0.95.
	r = newRoom(26, 20)
	before = r.points[1]
	r.awardPoints(1, 100, PointsCapture)
	if got := r.points[1] - before; got != 95 {
		t.Fatalf("отрыв в 6 очков дал %d за базу 100, ожидалось 95", got)
	}

	// Одинокий игрок не штрафует сам себя: сравнивать не с кем.
	solo := newRulesRoom(t, 7)
	solo.players[1] = &Player{num: 1, alive: true}
	solo.points[1] = 60000
	before = solo.points[1]
	solo.awardPoints(1, 100, PointsCapture)
	if got := solo.points[1] - before; got != 100 {
		t.Fatalf("одинокий игрок получил %d очков за базу 100, ожидалось 100", got)
	}

	// Пока в матче меньше 20 очков — резинки нет вовсе.
	r = newRoom(0, 19)
	r.awardPoints(1, 100, PointsCapture)
	if got := r.points[1]; got != 100 {
		t.Fatalf("резинка сработала на 19 очках лидера: %d", got)
	}

	// Разбивка по причинам должна совпадать с начислением.
	r = newRoom(0, 0)
	r.awardPoints(1, 50, PointsKill)
	if got := r.matchPointsBy[1][PointsKill]; got != r.points[1] {
		t.Fatalf("matchPointsBy[Kill]=%d, а очков начислено %d", got, r.points[1])
	}
	// Неизвестная причина схлопывается в PointsOther, а не портит соседний слот.
	r.awardPoints(1, 10, 200)
	if r.matchPointsBy[1][PointsOther] == 0 {
		t.Fatal("причина вне диапазона не попала в PointsOther")
	}
}

// Ловит: начисление мёртвому игроку и нулевую базу.
func TestAwardPointsIgnoresDeadAndZero(t *testing.T) {
	r := newRulesRoom(t, 3)
	dead := &Player{num: 1, alive: false}
	r.players[1] = dead
	r.awardPoints(1, 100, PointsKill)
	if r.points[1] != 0 {
		t.Fatalf("мёртвый игрок получил %d очков", r.points[1])
	}
	alive := &Player{num: 2, alive: true}
	r.players[2] = alive
	r.awardPoints(2, 0, PointsKill)
	if r.points[2] != 0 {
		t.Fatalf("нулевая база дала %d очков", r.points[2])
	}
	// Минимум одно очко, если множитель округлил бы в ноль.
	r.points[2] = 0
	r.points[1] = 30
	r.awardPoints(2, 1, PointsKill)
	if r.points[2] == 0 {
		t.Fatal("начисление с базой 1 съедено округлением")
	}
}

// ---------------------------------------------------------------------------
// freeKillBonus
// ---------------------------------------------------------------------------

// Ловит: возврат бонуса за «убийство» защищённой или только что заспавненной
// цели — то есть за след, который на самом деле никого не убьёт (G6).
func TestFreeKillBonusOnlyForRealKills(t *testing.T) {
	r := newRulesRoom(t, 5)
	r.tick = 100
	hunter := &Player{num: 1, alive: true, aiAggression: 0.9}
	victim := &Player{num: 2, alive: true}
	r.players[1] = hunter
	r.players[2] = victim

	i := r.idx(10, 10)
	if got := r.freeKillBonus(hunter, i); got != 0 {
		t.Fatalf("пустая клетка дала бонус %d", got)
	}
	r.setTrail(i, 2)
	if got := r.freeKillBonus(hunter, i); got != 120 {
		t.Fatalf("агрессивный бот получил %d, ожидалось 120", got)
	}
	hunter.aiAggression = 0.1
	if got := r.freeKillBonus(hunter, i); got != 50 {
		t.Fatalf("осторожный бот получил %d, ожидалось 50", got)
	}
	// Щит.
	victim.shield = 1
	if got := r.freeKillBonus(hunter, i); got != 0 {
		t.Fatalf("след под щитом дал бонус %d", got)
	}
	victim.shield = 0
	// Спавн-грейс.
	victim.spawnGraceUntil = r.tick + 5
	if got := r.freeKillBonus(hunter, i); got != 0 {
		t.Fatalf("след игрока в спавн-грейсе дал бонус %d", got)
	}
	victim.spawnGraceUntil = 0
	// Мёртвый владелец следа.
	victim.alive = false
	if got := r.freeKillBonus(hunter, i); got != 0 {
		t.Fatalf("след мёртвого дал бонус %d", got)
	}
	// Собственный след не бонус.
	victim.alive = true
	r.setTrail(i, 1)
	if got := r.freeKillBonus(hunter, i); got != 0 {
		t.Fatalf("собственный след дал бонус %d", got)
	}
	// Индекс вне поля.
	if got := r.freeKillBonus(hunter, -1); got != 0 {
		t.Fatalf("индекс -1 дал бонус %d", got)
	}
	if got := r.freeKillBonus(hunter, N); got != 0 {
		t.Fatalf("индекс N дал бонус %d", got)
	}
}

// ---------------------------------------------------------------------------
// Ежедневки: 3 слота, стрик, сброс по суткам.
// ---------------------------------------------------------------------------

// Ловит: пропажу слота, потерю сброса прогресса на новых сутках и поломку
// логики стрика (самый частый источник «стрик обнулился ни за что»).
func TestDailyRolloverResetsProgressAndAdvancesStreak(t *testing.T) {
	today := profiles.DayStampNow()

	// Первый вход: 3 слота выкатились, стрик = 1.
	pr := &profiles.Profile{}
	ensureProfileDailyLocked(pr, "pid-a")
	if pr.Day != today {
		t.Fatalf("Day = %d, ожидалось %d", pr.Day, today)
	}
	for i, tp := range []uint8{pr.DailyType1, pr.DailyType2, pr.DailyType3} {
		if tp == 0 || tp > 4 {
			t.Fatalf("слот %d получил тип %d вне 1..4", i+1, tp)
		}
	}
	if pr.DailyGoal1 == 0 || pr.DailyGoal2 == 0 || pr.DailyGoal3 == 0 {
		t.Fatalf("нулевая цель: %d/%d/%d", pr.DailyGoal1, pr.DailyGoal2, pr.DailyGoal3)
	}
	if pr.StreakDays != 1 || pr.StreakLastDay != today {
		t.Fatalf("стрик после первого входа = %d (день %d)", pr.StreakDays, pr.StreakLastDay)
	}

	// Повторный вызов в те же сутки ничего не перекатывает.
	pr.DailyProg1 = 3
	t1 := pr.DailyType1
	ensureProfileDailyLocked(pr, "pid-a")
	if pr.DailyProg1 != 3 || pr.DailyType1 != t1 {
		t.Fatal("повторный вызов в те же сутки сбросил прогресс")
	}

	// Вчера играл — стрик растёт, прогресс обнуляется.
	pr.Day = today - 1
	pr.StreakLastDay = today - 1
	pr.StreakDays = 4
	pr.DailyProg1, pr.DailyProg2, pr.DailyProg3 = 9, 9, 9
	ensureProfileDailyLocked(pr, "pid-a")
	if pr.StreakDays != 5 {
		t.Fatalf("стрик = %d, ожидалось 5", pr.StreakDays)
	}
	if pr.DailyProg1 != 0 || pr.DailyProg2 != 0 || pr.DailyProg3 != 0 {
		t.Fatalf("прогресс не сброшен на новых сутках: %d/%d/%d", pr.DailyProg1, pr.DailyProg2, pr.DailyProg3)
	}

	// Пропуск дня — стрик с единицы.
	pr.Day = today - 3
	pr.StreakLastDay = today - 3
	pr.StreakDays = 9
	ensureProfileDailyLocked(pr, "pid-a")
	if pr.StreakDays != 1 {
		t.Fatalf("после пропуска стрик = %d, ожидалась 1", pr.StreakDays)
	}
}

// Ловит: расползание множителя стрика (1 + 0.25*(n-1), потолок x2).
func TestDailyStreakMultiplierIsCapped(t *testing.T) {
	if got := dailyStreakMultLocked(nil); got != 1.0 {
		t.Fatalf("nil-профиль дал множитель %v", got)
	}
	table := map[uint32]float32{0: 1.0, 1: 1.0, 2: 1.25, 3: 1.5, 5: 2.0, 100: 2.0}
	for days, want := range table {
		pr := &profiles.Profile{StreakDays: days}
		if got := dailyStreakMultLocked(pr); got != want {
			t.Fatalf("стрик %d дал множитель %v, ожидалось %v", days, got, want)
		}
	}
}

// Ловит: перестановку сложности слотов. Слот 1 обязан оставаться самым
// тяжёлым, слот 2 — самым лёгким; иначе награды за слоты перестают
// соответствовать усилию.
func TestDailyGoalsSlotOrdering(t *testing.T) {
	for _, tp := range []uint8{DailyKills, DailyPickups, DailyCapture, DailyStyle} {
		g1 := dailyGoalFor(1, tp)
		g2 := dailyGoalFor(2, tp)
		g3 := dailyGoalFor(3, tp)
		if g1 == 0 || g2 == 0 || g3 == 0 {
			t.Fatalf("тип %d: нулевая цель %d/%d/%d", tp, g1, g2, g3)
		}
		if !(g1 > g3 && g3 > g2) {
			t.Fatalf("тип %d: слоты не упорядочены по сложности: %d/%d/%d", tp, g1, g3, g2)
		}
	}
	if got := dailyGoalFor(1, 0); got != 0 {
		t.Fatalf("неизвестный тип дал цель %d", got)
	}
	if got := dailyGoalFor(1, 99); got != 0 {
		t.Fatalf("тип вне диапазона дал цель %d", got)
	}
}

// Ловит: двойную выдачу награды за один слот и переполнение прогресса выше
// цели (клиент рисует прогресс-бар от goal, значение больше goal его ломает).
func TestDailyProgressCompletesExactlyOnce(t *testing.T) {
	r := newRulesRoom(t, 11)
	p := addBotPlayer(r, 1)
	pr := &profiles.Profile{Day: profiles.DayStampNow()}
	pr.DailyType1 = DailyKills
	pr.DailyGoal1 = 3
	pr.DailyType2 = DailyPickups
	pr.DailyGoal2 = 2
	pr.DailyType3 = DailyKills
	pr.DailyGoal3 = 1

	// Один килл — оба «килловых» слота продвигаются, третий закрывается.
	if n := r.addDailyProgressLocked(p, pr, DailyKills, 1); n != 1 {
		t.Fatalf("наград после первого килла = %d, ожидалась 1 (слот 3 с целью 1)", n)
	}
	if pr.DailyProg1 != 1 || pr.DailyProg3 != 1 {
		t.Fatalf("прогресс килловых слотов = %d/%d", pr.DailyProg1, pr.DailyProg3)
	}
	if pr.DailyProg2 != 0 {
		t.Fatalf("слот другого типа продвинулся: %d", pr.DailyProg2)
	}

	// Переполнение: +10 при остатке 2 — прогресс встаёт ровно на цель, награда одна.
	if n := r.addDailyProgressLocked(p, pr, DailyKills, 10); n != 1 {
		t.Fatalf("наград = %d, ожидалась 1 (слот 1)", n)
	}
	if pr.DailyProg1 != pr.DailyGoal1 {
		t.Fatalf("прогресс %d обогнал цель %d", pr.DailyProg1, pr.DailyGoal1)
	}
	// Закрытый слот больше не платит.
	if n := r.addDailyProgressLocked(p, pr, DailyKills, 10); n != 0 {
		t.Fatalf("закрытые слоты заплатили ещё раз: %d", n)
	}
	// И не шлют лишних событий прогресса.
	before := len(r.events)
	r.addDailyProgressLocked(p, pr, DailyKills, 5)
	if len(r.events) != before {
		t.Fatalf("закрытый слот отправил %d новых событий", len(r.events)-before)
	}
	// Нулевой инкремент — no-op.
	if n := r.addDailyProgressLocked(p, pr, DailyPickups, 0); n != 0 {
		t.Fatalf("нулевой инкремент дал %d наград", n)
	}
}

// Ловит: потерю множителя стрика в выплате за ежедневку и снятие защиты от
// самоподпитки (награда за «набери Стиль» не должна засчитываться в тот же
// квест).
func TestGrantDailyRewardsScalesWithStreakAndDoesNotFeedItself(t *testing.T) {
	withEmptyProfileStore(t)
	r := newRulesRoom(t, 13)

	// Бот: множителя нет, платится ровно StyleDailyReward за слот.
	b := addBotPlayer(r, 1)
	r.grantDailyRewards(b, 2)
	if got := r.matchStyleBy[1][StyleDaily]; got != 2*StyleDailyReward {
		t.Fatalf("боту выдано %d Стиля за 2 слота, ожидалось %d", got, 2*StyleDailyReward)
	}
	if got := r.matchPointsBy[1][PointsDaily]; got == 0 {
		t.Fatal("очки за ежедневку не начислены")
	}

	// Человек со стриком 3 -> множитель 1.5.
	h := &Player{num: 2, alive: true, profileKey: "streak-pid"}
	r.players[2] = h
	r.scores[2] = 0
	r.points[2] = 0
	pr := profiles.ForKeyCreate("streak-pid")
	profiles.Mu.Lock()
	pr.Day = profiles.DayStampNow()
	pr.StreakDays = 3
	pr.StreakLastDay = pr.Day
	// Слот «набери Стиль» открыт: выплата за ежедневку не должна его двигать.
	pr.DailyType1 = DailyStyle
	pr.DailyGoal1 = 500
	pr.DailyProg1 = 0
	pr.DailyType2, pr.DailyGoal2 = DailyKills, 5
	pr.DailyType3, pr.DailyGoal3 = DailyKills, 5
	profiles.Mu.Unlock()

	r.grantDailyRewards(h, 1)
	want := uint16(float32(StyleDailyReward)*1.5 + 0.5)
	if got := r.matchStyleBy[2][StyleDaily]; got != want {
		t.Fatalf("человеку со стриком 3 выдано %d Стиля, ожидалось %d", got, want)
	}
	profiles.Mu.Lock()
	prog := pr.DailyProg1
	profiles.Mu.Unlock()
	if prog != 0 {
		t.Fatalf("награда за ежедневку зачлась в квест «набери Стиль»: прогресс %d", prog)
	}
}

// ---------------------------------------------------------------------------
// Ачивки: 21 штука, маска, идемпотентность.
// ---------------------------------------------------------------------------

// Ловит: дубли кодов, коды за пределами uint32-маски и потерю правила.
func TestAchievementRulesAreWellFormed(t *testing.T) {
	if len(achvRules) != 21 {
		t.Fatalf("правил ачивок %d, ожидался 21", len(achvRules))
	}
	seen := map[uint8]bool{}
	for _, ru := range achvRules {
		if ru.code == 0 {
			t.Fatal("код 0 занят «нет ачивки» и не может быть правилом")
		}
		if ru.code > 31 {
			t.Fatalf("код %d не помещается в uint32-маску", ru.code)
		}
		if seen[ru.code] {
			t.Fatalf("код %d встречается дважды", ru.code)
		}
		seen[ru.code] = true
		if ru.need == 0 || ru.get == nil {
			t.Fatalf("правило %d без порога или без счётчика", ru.code)
		}
	}
	// Каждый титул ссылается на существующую ачивку.
	for _, tr := range titleRules {
		if !seen[tr.achv] {
			t.Fatalf("титул %d ссылается на несуществующую ачивку %d", tr.id, tr.achv)
		}
		if tr.id == 0 || tr.id > TitleMaxID {
			t.Fatalf("id титула %d вне 1..%d", tr.id, TitleMaxID)
		}
	}
}

// Ловит: повторную выдачу уже полученной ачивки — это и лишние 50 Стиля за
// каждый килл после порога, и спам событий у клиента.
func TestCheckAchievementsIsIdempotent(t *testing.T) {
	withEmptyProfileStore(t)
	r := newRulesRoom(t, 17)
	p := addBotPlayer(r, 1)
	pr := &profiles.Profile{TotalKills: 10}

	profiles.Mu.Lock()
	n := r.checkAchievementsLocked(p, pr)
	profiles.Mu.Unlock()
	if n != 1 {
		t.Fatalf("выдано %d ачивок, ожидалась 1 (AchvKills10)", n)
	}
	if pr.AchvMask&(1<<AchvKills10) == 0 {
		t.Fatal("бит AchvKills10 не выставлен")
	}

	profiles.Mu.Lock()
	n = r.checkAchievementsLocked(p, pr)
	profiles.Mu.Unlock()
	if n != 0 {
		t.Fatalf("повторный проход выдал ещё %d ачивок", n)
	}

	// Переход сразу через несколько порогов выдаёт их все и ровно по разу.
	pr.TotalKills = 1000
	profiles.Mu.Lock()
	n = r.checkAchievementsLocked(p, pr)
	profiles.Mu.Unlock()
	if n != 2 {
		t.Fatalf("выдано %d ачивок, ожидалось 2 (100 и 1000)", n)
	}

	// Выплата: ровно StyleAchvReward за каждую.
	before := r.matchStyleBy[1][StyleAchievement]
	r.grantAchievementRewards(p, 2)
	if got := r.matchStyleBy[1][StyleAchievement] - before; got != 2*StyleAchvReward {
		t.Fatalf("за 2 ачивки выдано %d Стиля, ожидалось %d", got, 2*StyleAchvReward)
	}

	// nil-профиль и nil-игрок не роняют и ничего не выдают.
	profiles.Mu.Lock()
	zero := r.checkAchievementsLocked(p, nil) + r.checkAchievementsLocked(nil, pr)
	profiles.Mu.Unlock()
	if zero != 0 {
		t.Fatalf("nil-аргументы выдали %d ачивок", zero)
	}
}

// ---------------------------------------------------------------------------
// Контракты: лимит за матч, рост цели, полный цикл.
// ---------------------------------------------------------------------------

// Ловит: сброс лимита MaxContractsMatch и «плоский» набор целей (4-й контракт
// обязан быть заметно тяжелее 1-го).
func TestContractGoalsRampAndClampToLastRow(t *testing.T) {
	for _, ct := range []uint8{ContractKills, ContractPickups, ContractCapture} {
		prev := uint16(0)
		for done := uint16(0); done < MaxContractsMatch; done++ {
			g := contractGoalFor(ct, done)
			if g <= prev {
				t.Fatalf("тип %d: цель #%d = %d не выросла (было %d)", ct, done+1, g, prev)
			}
			prev = g
		}
		// Индекс за таблицей берёт последнюю строку, а не паникует.
		if got := contractGoalFor(ct, 999); got != prev {
			t.Fatalf("тип %d: цель за таблицей = %d, ожидалось %d", ct, got, prev)
		}
	}
	if got := contractGoalFor(ContractNone, 0); got != 0 {
		t.Fatalf("ContractNone дал цель %d", got)
	}
}

// Ловит: выдачу пятого контракта за матч (E5) и отсутствие очистки слота при
// достижении лимита — клиент иначе показывает «висящий» контракт навсегда.
func TestContractsAreLimitedPerMatch(t *testing.T) {
	withEmptyProfileStore(t)
	r := newRulesRoom(t, 23)
	r.tick = 1
	p := addBotPlayer(r, 1)

	for i := 0; i < MaxContractsMatch; i++ {
		r.assignContract(p)
		if p.contractType == ContractNone || p.contractGoal == 0 {
			t.Fatalf("контракт #%d не выдан", i+1)
		}
		// Закрываем его целиком.
		r.addContractProgress(p, p.contractGoal)
		if p.contractsDone != uint16(i+1) {
			t.Fatalf("contractsDone = %d, ожидалось %d", p.contractsDone, i+1)
		}
	}
	if p.contractType != ContractNone || p.contractGoal != 0 || p.contractUntil != 0 {
		t.Fatalf("после лимита слот не очищен: type=%d goal=%d until=%d",
			p.contractType, p.contractGoal, p.contractUntil)
	}
	// ensureContract тоже обязан молчать после лимита.
	r.ensureContract(p)
	if p.contractType != ContractNone {
		t.Fatalf("ensureContract выдал %d-й контракт", p.contractsDone+1)
	}
	if p.contractsDone != MaxContractsMatch {
		t.Fatalf("закрыто контрактов %d, ожидалось %d", p.contractsDone, MaxContractsMatch)
	}
	// Разбивка по типам в сумме равна числу закрытых контрактов.
	sum := uint16(0)
	for _, v := range r.matchContractsBy[1] {
		sum += v
	}
	if sum != MaxContractsMatch {
		t.Fatalf("сумма matchContractsBy = %d, ожидалось %d", sum, MaxContractsMatch)
	}
	// И Стиль выдан ровно за каждый контракт.
	if got := r.matchStyleBy[1][StyleContract]; got != MaxContractsMatch*StyleContractReward {
		t.Fatalf("Стиля за контракты %d, ожидалось %d", got, MaxContractsMatch*StyleContractReward)
	}
}

// Ловит: досрочное завершение по истёкшему сроку без перевыдачи.
func TestExpiredContractIsReassigned(t *testing.T) {
	r := newRulesRoom(t, 29)
	r.tick = 10
	p := addBotPlayer(r, 1)
	r.assignContract(p)
	until := p.contractUntil
	if until == 0 {
		t.Fatal("контракт выдан без срока")
	}
	p.contractProgress = 1
	r.tick = until
	r.ensureContract(p)
	if p.contractProgress != 0 {
		t.Fatalf("после истечения прогресс = %d, ожидался сброс", p.contractProgress)
	}
	if p.contractUntil <= until {
		t.Fatalf("срок не продлён: %d <= %d", p.contractUntil, until)
	}
}

// ---------------------------------------------------------------------------
// addStyle: рекурсия и бюджеты.
// ---------------------------------------------------------------------------

// Ловит: снятие ограничителя рекурсии addStyle -> ежедневка -> addStyle (E12).
func TestAddStyleRecursionGuard(t *testing.T) {
	r := newRulesRoom(t, 31)
	p := addBotPlayer(r, 1)
	p.styleDepth = StyleAddMaxDepth
	r.addStyle(p, 100, StyleKill)
	if p.style != 0 {
		t.Fatalf("на предельной глубине выдано %d Стиля", p.style)
	}
	p.styleDepth = StyleAddMaxDepth - 1
	r.addStyle(p, 100, StyleKill)
	if p.style != 100 {
		t.Fatalf("на допустимой глубине выдано %d Стиля, ожидалось 100", p.style)
	}
	// Глубина возвращается на место.
	if p.styleDepth != StyleAddMaxDepth-1 {
		t.Fatalf("styleDepth = %d, ожидалось %d", p.styleDepth, StyleAddMaxDepth-1)
	}
}

// Ловит: обход бюджета addStyleCapped (частичная выдача на границе).
func TestAddStyleCappedRespectsBudget(t *testing.T) {
	r := newRulesRoom(t, 37)
	p := addBotPlayer(r, 1)
	spent := uint16(0)
	if got := r.addStyleCapped(p, 40, StyleKill, &spent, 50); got != 40 {
		t.Fatalf("первая выдача = %d, ожидалось 40", got)
	}
	// На границе выдаётся ровно остаток, не больше.
	if got := r.addStyleCapped(p, 40, StyleKill, &spent, 50); got != 10 {
		t.Fatalf("вторая выдача = %d, ожидалось 10 (остаток бюджета)", got)
	}
	if got := r.addStyleCapped(p, 40, StyleKill, &spent, 50); got != 0 {
		t.Fatalf("после исчерпания бюджета выдано %d", got)
	}
	if spent != 50 {
		t.Fatalf("израсходовано %d, ожидалось 50", spent)
	}
	if p.style != 50 {
		t.Fatalf("на счету %d Стиля, ожидалось 50", p.style)
	}
	if got := r.addStyleCapped(p, 10, StyleKill, nil, 50); got != 0 {
		t.Fatal("nil-счётчик не должен ничего выдавать")
	}
}

// ---------------------------------------------------------------------------
// Стиль за киллы: затухание за ботов и потолок за матч.
// ---------------------------------------------------------------------------

// Ловит: возврат полной ставки за ботов после BotKillFullRate (E4) — прямой
// путь к фарму «настрелял ботов, закрыл магазин за вечер».
func TestBotKillStyleDecaysAndIsCapped(t *testing.T) {
	withEmptyProfileStore(t)
	r := newRulesRoom(t, 41)
	r.tick = 500
	k := addBotPlayer(r, 1)
	v := addBotPlayer(r, 2)

	killOnce := func() uint16 {
		v.alive = true
		v.spawnGraceUntil = 0
		// Изолируем серию убийств: бонусы за стрик здесь не проверяются.
		k.killStreak = 0
		k.lastKillTick = 0
		before := k.styleKillMatch
		r.killPlayerWithReason(2, 1, "trail_cut", -1, 0, 0)
		return k.styleKillMatch - before
	}

	for i := 1; i <= BotKillFullRate; i++ {
		if got := killOnce(); got != StyleKillBot {
			t.Fatalf("килл #%d бота дал %d Стиля, ожидалось %d", i, got, StyleKillBot)
		}
	}
	if got := killOnce(); got != StyleKillBotLate {
		t.Fatalf("килл #%d бота дал %d Стиля, ожидалось %d (затухание)",
			BotKillFullRate+1, got, StyleKillBotLate)
	}
	for i := 0; i < 200; i++ {
		killOnce()
	}
	if k.styleKillMatch != StyleKillMatchCap {
		t.Fatalf("Стиль за киллы = %d, ожидался потолок %d", k.styleKillMatch, StyleKillMatchCap)
	}
	// Счётчик киллов матча ведётся честно.
	if r.matchKills[1] == 0 {
		t.Fatal("киллы не посчитаны в matchKills")
	}
}

// Ловит: снятие бюджета и/или кулдауна мести (G11). Размен смертями с одним и
// тем же ботом внутри окна 900 тиков не должен платить повторно.
func TestRevengeStyleHasCooldownAndBudget(t *testing.T) {
	withEmptyProfileStore(t)
	r := newRulesRoom(t, 43)
	r.tick = 1000
	k := addBotPlayer(r, 1)
	v1 := addBotPlayer(r, 2)
	v2 := addBotPlayer(r, 3)

	revengeKill := func(victim *Player) {
		victim.alive = true
		victim.spawnGraceUntil = 0
		k.killStreak = 0
		k.lastKillTick = 0
		k.lastKiller = victim.num
		k.lastKilledTick = r.tick
		r.killPlayerWithReason(victim.num, 1, "trail_cut", -1, 0, 0)
	}

	revengeKill(v1)
	if k.revengeStyleAcc != StyleRevengeReward {
		t.Fatalf("первая месть дала %d Стиля, ожидалось %d", k.revengeStyleAcc, StyleRevengeReward)
	}
	// Та же цель внутри кулдауна — не платит.
	revengeKill(v1)
	if k.revengeStyleAcc != StyleRevengeReward {
		t.Fatalf("повторная месть той же цели заплатила: %d", k.revengeStyleAcc)
	}
	// Другая цель — платит.
	revengeKill(v2)
	if k.revengeStyleAcc != 2*StyleRevengeReward {
		t.Fatalf("месть другой цели дала %d, ожидалось %d", k.revengeStyleAcc, 2*StyleRevengeReward)
	}
	// Чередование целей упирается в бюджет матча.
	for i := 0; i < 50; i++ {
		if i%2 == 0 {
			revengeKill(v1)
		} else {
			revengeKill(v2)
		}
	}
	if k.revengeStyleAcc != StyleRevengeMatchCap {
		t.Fatalf("Стиль за месть = %d, ожидался потолок %d", k.revengeStyleAcc, StyleRevengeMatchCap)
	}
	// Та же цель после кулдауна снова платит.
	k.revengeStyleAcc = 0
	k.revengeLastTgt = 2
	k.revengeLastTick = r.tick
	r.tick += RevengeSameTargetCooldown
	revengeKill(v1)
	if k.revengeStyleAcc != StyleRevengeReward {
		t.Fatalf("после кулдауна месть дала %d Стиля", k.revengeStyleAcc)
	}
}

// Ловит: снятие бюджета за головы (G11).
func TestBountyStyleIsBudgeted(t *testing.T) {
	withEmptyProfileStore(t)
	r := newRulesRoom(t, 47)
	r.tick = 800
	k := addBotPlayer(r, 1)
	v := addBotPlayer(r, 2)

	for i := 0; i < 20; i++ {
		v.alive = true
		v.spawnGraceUntil = 0
		k.killStreak = 0
		k.lastKillTick = 0
		r.bountyTarget = 2
		r.bountyUntil = r.tick + BountyWindowTicks
		r.killPlayerWithReason(2, 1, "trail_cut", -1, 0, 0)
	}
	if k.bountyStyleMatch != StyleBountyMatchCap {
		t.Fatalf("Стиль за головы = %d, ожидался потолок %d", k.bountyStyleMatch, StyleBountyMatchCap)
	}
	// Награда за одну голову — ровно StyleBountyKill, пока бюджет есть.
	k2 := addBotPlayer(r, 3)
	v.alive = true
	v.spawnGraceUntil = 0
	r.bountyTarget = 2
	r.bountyUntil = r.tick + BountyWindowTicks
	r.killPlayerWithReason(2, 3, "trail_cut", -1, 0, 0)
	if k2.bountyStyleMatch != StyleBountyKill {
		t.Fatalf("одна голова дала %d Стиля, ожидалось %d", k2.bountyStyleMatch, StyleBountyKill)
	}
	// И награда снимает контракт на голову.
	if r.bountyTarget != 0 {
		t.Fatalf("после выплаты цель охоты осталась %d", r.bountyTarget)
	}
}

// ---------------------------------------------------------------------------
// Спавн-грейс.
// ---------------------------------------------------------------------------

// Ловит: пропажу защиты после респавна и, наоборот, её превращение в
// бессмертие — стена и собственный след обязаны убивать всегда (F2).
func TestSpawnGraceAbsorbsOnlyPlayerKills(t *testing.T) {
	r := newRulesRoom(t, 53)
	r.tick = 100
	p := addBotPlayer(r, 1)
	p.spawnGraceUntil = r.tick + SpawnGraceTicks

	r.killPlayerWithReason(1, 2, "trail_cut", -1, 0, 0)
	if !p.alive {
		t.Fatal("грейс не поглотил перерезание следа")
	}
	r.killPlayerWithReason(1, 0, "head_on", -1, 0, 0)
	if !p.alive {
		t.Fatal("грейс не поглотил лобовое")
	}
	// Стена убивает.
	r.killPlayerWithReason(1, 0, "wall", -1, 0, 0)
	if p.alive {
		t.Fatal("игрок пережил стену внутри грейса")
	}
	// Собственный след тоже.
	p.alive = true
	p.spawnGraceUntil = r.tick + SpawnGraceTicks
	r.killPlayerWithReason(1, 0, "self_trail", -1, 0, 0)
	if p.alive {
		t.Fatal("игрок пережил собственный след внутри грейса")
	}
	// Просроченный грейс не защищает.
	p.alive = true
	p.spawnGraceUntil = r.tick
	r.killPlayerWithReason(1, 2, "trail_cut", -1, 0, 0)
	if p.alive {
		t.Fatal("просроченный грейс всё ещё защищает")
	}
}

// ---------------------------------------------------------------------------
// Награда за место и за выживание.
// ---------------------------------------------------------------------------

// Ловит: обрезание хвоста таблицы мест (до 8-го включительно, G23) и потерю
// утешительной выплаты выжившим. Матч доводится до конца настоящим step().
func TestPlacementAndSurvivalRewards(t *testing.T) {
	cases := []struct {
		name      string
		ahead     int // сколько ботов стоят выше человека
		alive     bool
		wantWin   uint16
		wantTop   uint16
		wantSurv  uint16
		wantFirst bool
	}{
		{"1st", 0, true, StylePlace1 + StyleFirstWinBonus, 0, StyleSurviveReward, true},
		{"2nd", 1, true, 0, StylePlace23, StyleSurviveReward, false},
		{"5th", 4, true, 0, StylePlace45, StyleSurviveReward, false},
		{"6th", 5, true, 0, StylePlace6, StyleSurviveReward, false},
		{"7th", 6, true, 0, StylePlace7, StyleSurviveReward, false},
		{"8th", 7, true, 0, StylePlace8, StyleSurviveReward, false},
		{"9th", 8, true, 0, 0, StyleSurviveReward, false},
		{"9th-dead", 8, false, 0, 0, 0, false},
		{"1st-dead", 0, false, StylePlace1 + StyleFirstWinBonus, 0, 0, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			withEmptyProfileStore(t)
			r := newRulesRoom(t, 59)
			r.tick = 10
			r.matchStartTick = 0
			r.humanCount = 1

			h := &Player{num: 1, alive: c.alive, profileKey: "place-" + c.name, x: 10, y: 10}
			r.players[1] = h
			r.scores[1] = 0
			r.points[1] = 100
			r.knownNames[1] = KnownName{Name: "Человек", Online: true}
			for i := 0; i < c.ahead; i++ {
				num := uint16(10 + i)
				b := addBotPlayer(r, num)
				b.name = "bot"
				r.points[num] = 200 + uint16(i)
			}
			// Пара ботов заведомо ниже человека — чтобы место было «настоящим».
			for i := 0; i < 3; i++ {
				num := uint16(100 + i)
				addBotPlayer(r, num)
				r.points[num] = 1
			}

			r.matchEndTick = r.tick + 1
			r.step()

			if !r.matchEnded {
				t.Fatal("матч не завершился")
			}
			if got := r.matchStyleBy[1][StyleWin]; got != c.wantWin {
				t.Fatalf("StyleWin = %d, ожидалось %d", got, c.wantWin)
			}
			if got := r.matchStyleBy[1][StyleTop5]; got != c.wantTop {
				t.Fatalf("StyleTop5 = %d, ожидалось %d", got, c.wantTop)
			}
			if got := r.matchStyleBy[1][StyleSurvive]; got != c.wantSurv {
				t.Fatalf("StyleSurvive = %d, ожидалось %d", got, c.wantSurv)
			}
			// Бонус за первую победу за сутки — ровно один раз в сутки.
			profiles.Mu.Lock()
			pr := profiles.StoredLocked("place-" + c.name)
			gotFirst := pr != nil && pr.FirstWinDay == profiles.DayStampNow()
			profiles.Mu.Unlock()
			if gotFirst != c.wantFirst {
				t.Fatalf("отметка первой победы = %v, ожидалось %v", gotFirst, c.wantFirst)
			}
		})
	}
}

// Ловит: повторную выплату бонуса за первую победу в те же сутки (E7).
func TestFirstWinBonusIsOncePerDay(t *testing.T) {
	withEmptyProfileStore(t)
	r := newRulesRoom(t, 61)
	h := &Player{num: 1, alive: true, profileKey: "fw"}
	r.players[1] = h
	r.scores[1] = 0
	r.points[1] = 0

	r.grantFirstWinBonus(h)
	first := r.matchStyleBy[1][StyleWin]
	if first != StyleFirstWinBonus {
		t.Fatalf("первая победа дала %d Стиля, ожидалось %d", first, StyleFirstWinBonus)
	}
	r.grantFirstWinBonus(h)
	if got := r.matchStyleBy[1][StyleWin]; got != first {
		t.Fatalf("бонус выдан второй раз за сутки: %d", got)
	}
	// Новые сутки — снова можно.
	profiles.Mu.Lock()
	profiles.StoredLocked("fw").FirstWinDay = profiles.DayStampNow() - 1
	profiles.Mu.Unlock()
	r.grantFirstWinBonus(h)
	if got := r.matchStyleBy[1][StyleWin]; got != 2*first {
		t.Fatalf("на новых сутках выдано %d, ожидалось %d", got, 2*first)
	}
	// Бот бонуса не получает вовсе.
	b := addBotPlayer(r, 2)
	r.grantFirstWinBonus(b)
	if r.matchStyleBy[2][StyleWin] != 0 {
		t.Fatal("бот получил бонус за первую победу")
	}
}

// ---------------------------------------------------------------------------
// Таблица результатов.
// ---------------------------------------------------------------------------

// Ловит: поломку сортировки и нумерации мест — от неё напрямую зависит
// выплата за место.
func TestMatchResultsSortingAndPlaces(t *testing.T) {
	r := newRulesRoom(t, 67)
	r.tick = 100
	r.matchStartTick = 0

	mk := func(num uint16, pts, cells, kills uint16) {
		p := addBotPlayer(r, num)
		p.name = "b"
		r.points[num] = pts
		r.scores[num] = cells
		r.matchKills[num] = kills
	}
	// Одинаковые очки -> клетки -> киллы -> номер.
	mk(5, 100, 10, 1)
	mk(4, 100, 10, 3)
	mk(3, 100, 20, 0)
	mk(2, 200, 0, 0)
	mk(1, 100, 10, 1)

	res := r.buildMatchResultsLocked()
	wantOrder := []uint16{2, 3, 4, 1, 5}
	if len(res) != len(wantOrder) {
		t.Fatalf("строк результата %d, ожидалось %d", len(res), len(wantOrder))
	}
	for i, want := range wantOrder {
		if res[i].N != want {
			t.Fatalf("место %d занял игрок %d, ожидался %d (порядок %v)", i+1, res[i].N, want, wantOrder)
		}
		if res[i].Place != uint16(i+1) {
			t.Fatalf("игрок %d получил место %d, ожидалось %d", res[i].N, res[i].Place, i+1)
		}
	}
}
