package game

import (
	"testing"
)

// ---------------------------------------------------------------------------
// Чистая арифметика популяции и личности бота.
// ---------------------------------------------------------------------------

// Ловит: изменение кривой прореживания ботов (G7). Полная комната не должна
// превращаться в толпу, пустая — в пустыню.
func TestDesiredBotCount(t *testing.T) {
	cases := []struct {
		humans int
		want   int
	}{
		{-5, BotCount},
		{0, BotCount},
		{1, BotCount - 1},
		{2, BotCount - 3},
		{4, BotCount - 6},
		{6, BotCount - 9},
		{7, BotCountMin},
		{16, BotCountMin},
		{1000, BotCountMin},
	}
	for _, c := range cases {
		if got := desiredBotCount(c.humans); got != c.want {
			t.Fatalf("desiredBotCount(%d) = %d, ожидалось %d", c.humans, got, c.want)
		}
	}
	// Монотонность: чем больше людей, тем меньше ботов, и никогда ниже пола.
	prev := desiredBotCount(0)
	for h := 1; h <= 40; h++ {
		got := desiredBotCount(h)
		if got > prev {
			t.Fatalf("при %d людях ботов стало больше: %d > %d", h, got, prev)
		}
		if got < BotCountMin {
			t.Fatalf("при %d людях ботов %d, ниже пола %d", h, got, BotCountMin)
		}
		prev = got
	}
}

// Ловит: снятие прогрессии и потолка задержки респавна (G8). Без прогрессии
// бот, которого фармят, возвращается мгновенно; без потолка — не возвращается
// вовсе.
func TestBotRespawnDelayProgressionAndCap(t *testing.T) {
	r := newRulesRoom(t, 211)
	r.tick = 10000
	p := &Player{num: 1, bot: true}

	// Первая смерть в окне: только базовая задержка.
	d := r.botRespawnDelay(p)
	if d < BotRespawnDelayMin || d > BotRespawnDelayMax {
		t.Fatalf("первая смерть дала задержку %d вне [%d..%d]", d, BotRespawnDelayMin, BotRespawnDelayMax)
	}

	// Серия смертей подряд упирается в потолок.
	for i := 0; i < aiDeathCap; i++ {
		d = r.botRespawnDelay(p)
	}
	if d != BotRespawnDelayCap {
		t.Fatalf("после %d смертей подряд задержка %d, ожидался потолок %d",
			aiDeathCap+1, d, BotRespawnDelayCap)
	}

	// Старые смерти за окном BotRespawnDeathWindow не штрафуют.
	r.tick += BotRespawnDeathWindow + 1
	d = r.botRespawnDelay(p)
	if d < BotRespawnDelayMin || d > BotRespawnDelayMax {
		t.Fatalf("после окна задержка %d вне [%d..%d] — старые смерти всё ещё считаются",
			d, BotRespawnDelayMin, BotRespawnDelayMax)
	}
	// Кольцо смертей не переполняется.
	if p.aiDeathN > aiDeathCap {
		t.Fatalf("aiDeathN = %d, больше ёмкости %d", p.aiDeathN, aiDeathCap)
	}
}

// Ловит: перестановку слагаемых в botTrailBudget и снятие пола/потолка.
func TestBotTrailBudgetArithmetic(t *testing.T) {
	r := newRulesRoom(t, 223)
	mk := func() *Player {
		return &Player{
			num: 1, bot: true,
			aiTrailBudget: 12,
			aiBaitSense:   0.5,
			aiArchetype:   ArchTerritorial,
			aiBudgetCap:   BotTrailBudgetCap,
		}
	}
	// base=12, f = 1.30-0.50*0.5 = 1.05 -> 12*1.05+0.5 = 13.1 -> 13
	if got := r.botTrailBudget(mk(), 0, 0); got != 13 {
		t.Fatalf("базовый бюджет = %d, ожидалось 13", got)
	}
	// Локальный риск добавляет int(4*risk).
	if got := r.botTrailBudget(mk(), 1.0, 0); got != 17 {
		t.Fatalf("бюджет при риске 1.0 = %d, ожидалось 17", got)
	}
	// Высокая локальная осторожность отнимает 2.
	if got := r.botTrailBudget(mk(), 0, 0.8); got != 11 {
		t.Fatalf("бюджет при осторожности 0.8 = %d, ожидалось 11", got)
	}
	// Контракт на захват добавляет 4.
	p := mk()
	p.contractType = ContractCapture
	if got := r.botTrailBudget(p, 0, 0); got != 17 {
		t.Fatalf("бюджет с контрактом на захват = %d, ожидалось 17", got)
	}
	// Мутатор двойного захвата отнимает 2.
	r.mutatorType = MutatorDoubleCapture
	if got := r.botTrailBudget(mk(), 0, 0); got != 11 {
		t.Fatalf("бюджет при мутаторе = %d, ожидалось 11", got)
	}
	r.mutatorType = MutatorNone

	// Пол 6 для обычного архетипа.
	tiny := mk()
	tiny.aiTrailBudget = 1
	if got := r.botTrailBudget(tiny, 0, 0); got != 6 {
		t.Fatalf("пол бюджета = %d, ожидалось 6", got)
	}
	// Потолок.
	huge := mk()
	huge.aiTrailBudget = 1000
	if got := r.botTrailBudget(huge, 1.0, 0); got != BotTrailBudgetCap {
		t.Fatalf("потолок бюджета = %d, ожидалось %d", got, BotTrailBudgetCap)
	}
	// Фермер живёт выше общего потолка (S4): его пол — BotTrailBudgetCap+1.
	farmer := mk()
	farmer.aiArchetype = ArchFarmer
	farmer.aiBudgetCap = BotTrailBudgetCapFarmer
	farmer.aiTrailBudget = 1
	got := r.botTrailBudget(farmer, 0, 0)
	if got <= BotTrailBudgetCap {
		t.Fatalf("бюджет фермера = %d, не выше общего потолка %d — архетип невидим",
			got, BotTrailBudgetCap)
	}
	if got > BotTrailBudgetCapFarmer {
		t.Fatalf("бюджет фермера = %d, выше собственного потолка %d", got, BotTrailBudgetCapFarmer)
	}

	// Ботам без личности (нулевые поля) достаются разумные значения, а не 0.
	legacy := &Player{num: 2, bot: true}
	if got := r.botTrailBudget(legacy, 0, 0); got < 6 || got > BotTrailBudgetCap {
		t.Fatalf("бюджет бота без личности = %d вне [6..%d]", got, BotTrailBudgetCap)
	}
	if got := botCloseFrac(legacy); got != BotCloseFracDefault {
		t.Fatalf("closeFrac бота без личности = %v, ожидалось %v", got, BotCloseFracDefault)
	}
	if got := botCloseFrac(nil); got != BotCloseFracDefault {
		t.Fatalf("closeFrac(nil) = %v", got)
	}
}

// Ловит: выход любого производного параметра личности за допустимые границы
// (нулевой ROI, cooldownMin > cooldownMax, baitSense вне 0..1 и т.п.).
// Такие значения не роняют сервер — они молча ломают поведение ботов.
func TestApplyBotPersonalityInvariants(t *testing.T) {
	r := newRulesRoom(t, 227)
	for tier := uint8(0); tier < TierCount; tier++ {
		for arch := uint8(0); arch < ArchCount; arch++ {
			for i := 0; i < 100; i++ {
				p := &Player{num: 1, bot: true}
				r.applyBotPersonality(p, tier, arch)

				if p.aiTier != tier {
					t.Fatalf("tier=%d arch=%d: сохранён tier %d", tier, arch, p.aiTier)
				}
				if p.aiArchetype != arch {
					t.Fatalf("tier=%d arch=%d: сохранён arch %d", tier, arch, p.aiArchetype)
				}
				if p.aiCooldownMin == 0 || p.aiCooldownMin > p.aiCooldownMax {
					t.Fatalf("tier=%d arch=%d: cooldown %d..%d", tier, arch, p.aiCooldownMin, p.aiCooldownMax)
				}
				if p.aiPredictDepth == 0 {
					t.Fatalf("tier=%d arch=%d: нулевая глубина предсказания", tier, arch)
				}
				if p.aiROIW <= 0 || p.aiROIH <= 0 {
					t.Fatalf("tier=%d arch=%d: ROI %dx%d", tier, arch, p.aiROIW, p.aiROIH)
				}
				if p.aiTrailBudget <= 0 || p.aiBravery <= 0 {
					t.Fatalf("tier=%d arch=%d: бюджет следа %d", tier, arch, p.aiTrailBudget)
				}
				if p.aiBudgetCap <= 0 {
					t.Fatalf("tier=%d arch=%d: нулевой потолок бюджета", tier, arch)
				}
				if p.aiCloseFrac <= 0 || p.aiCloseFrac > 1 {
					t.Fatalf("tier=%d arch=%d: closeFrac %v", tier, arch, p.aiCloseFrac)
				}
				if p.aiBaitSense < 0.05 || p.aiBaitSense > 1 {
					t.Fatalf("tier=%d arch=%d: baitSense %v", tier, arch, p.aiBaitSense)
				}
				if p.aiRiskiness < 0 || p.aiRiskiness > 1 {
					t.Fatalf("tier=%d arch=%d: riskiness %v", tier, arch, p.aiRiskiness)
				}
				if p.aiAggression < 0 || p.aiAggression > 1 {
					t.Fatalf("tier=%d arch=%d: aggression %v", tier, arch, p.aiAggression)
				}
				if p.aiCaution < 0 || p.aiCaution > 1 {
					t.Fatalf("tier=%d arch=%d: caution %v", tier, arch, p.aiCaution)
				}
				if p.aiHuntGate < 0 {
					t.Fatalf("tier=%d arch=%d: huntGate %v", tier, arch, p.aiHuntGate)
				}
				// Только фермеру можно за общий потолок бюджета.
				if arch != ArchFarmer && p.aiBudgetCap != BotTrailBudgetCap {
					t.Fatalf("arch=%d получил потолок фермера %d", arch, p.aiBudgetCap)
				}
			}
		}
	}
	// Неизвестный архетип/тир сваливаются в разумные умолчания, а не в нули.
	p := &Player{num: 1, bot: true}
	r.applyBotPersonality(p, 99, 99)
	if p.aiTier != TierNormal || p.aiArchetype != ArchTerritorial {
		t.Fatalf("неизвестные tier/arch дали %d/%d, ожидалось %d/%d",
			p.aiTier, p.aiArchetype, TierNormal, ArchTerritorial)
	}

	// Агрессор охотится, фермер — нет; это и есть различимость архетипов.
	aggr := &Player{num: 1, bot: true}
	farm := &Player{num: 2, bot: true}
	r.applyBotPersonality(aggr, TierHard, ArchAggressor)
	r.applyBotPersonality(farm, TierHard, ArchFarmer)
	if aggr.aiHuntGate <= farm.aiHuntGate {
		t.Fatalf("порог охоты агрессора %v не выше фермера %v", aggr.aiHuntGate, farm.aiHuntGate)
	}
	if aggr.aiAggression <= farm.aiAggression {
		t.Fatalf("агрессивность агрессора %v не выше фермера %v", aggr.aiAggression, farm.aiAggression)
	}
}

// Ловит: поломку раскладки состава комнаты — сумма обязана равняться n при
// любом n, иначе syncBotPopulationLocked уходит в бесконечный цикл или
// недосыпает ботов.
func TestMixTargetsAlwaysSumToN(t *testing.T) {
	for _, weights := range [][]int{
		tierMix[:], archMix[:], {1, 1, 1}, {0, 0, 0}, {5},
	} {
		for n := 0; n <= 40; n++ {
			got := mixTargets(weights, n)
			if len(got) != len(weights) {
				t.Fatalf("длина раскладки %d, ожидалось %d", len(got), len(weights))
			}
			sum := 0
			for _, v := range got {
				if v < 0 {
					t.Fatalf("отрицательный слот в раскладке %v", got)
				}
				sum += v
			}
			if sum != n {
				t.Fatalf("weights=%v n=%d: сумма %d (%v)", weights, n, sum, got)
			}
		}
	}
	// Отрицательное n не роняет и даёт нули.
	for _, v := range mixTargets(tierMix[:], -3) {
		if v != 0 {
			t.Fatalf("отрицательное n дало непустую раскладку")
		}
	}
}

// Ловит: выбор «переполненного» слота вместо отстающего.
func TestPickUnderfilled(t *testing.T) {
	if got := pickUnderfilled([]int{3, 0, 1}, []int{3, 5, 2}); got != 1 {
		t.Fatalf("выбран слот %d, ожидался 1 (отстаёт на 5)", got)
	}
	// Ничья — самый левый.
	if got := pickUnderfilled([]int{0, 0}, []int{2, 2}); got != 0 {
		t.Fatalf("при ничьей выбран слот %d, ожидался 0", got)
	}
	// Всё переполнено — всё равно возвращается наименее переполненный.
	if got := pickUnderfilled([]int{5, 9}, []int{1, 1}); got != 0 {
		t.Fatalf("выбран слот %d, ожидался 0", got)
	}
}

// ---------------------------------------------------------------------------
// Лимит охотников: счётчик не должен «залипать».
// ---------------------------------------------------------------------------

func newHuntBot(r *Room, num uint16, arch uint8) *Player {
	p := &Player{num: num, bot: true, alive: true, x: 50, y: 50, aiCoolCell: -1}
	r.applyBotPersonality(p, TierNormal, arch)
	r.players[num] = p
	r.scores[num] = 0
	r.points[num] = 0
	return p
}

// Ловит: главный сценарий «боты перестали атаковать вовсе» — счётчик охотников
// на жертве, который не уменьшается при смерти охотника, смерти жертвы,
// удалении бота или сбросе матча, навсегда закрывает лимит.
func TestHunterCensusNeverSticks(t *testing.T) {
	r := newRulesRoom(t, 229)
	r.tick = 500
	victim := addHumanPlayer(r, 1, 60, 60, DirRight)
	b1 := newHuntBot(r, 2, ArchAggressor)
	b2 := newHuntBot(r, 3, ArchAggressor)
	b3 := newHuntBot(r, 4, ArchAggressor)
	b4 := newHuntBot(r, 5, ArchAggressor)

	if got := huntCapFor(victim); got != HuntCapHuman {
		t.Fatalf("лимит охотников на человека = %d, ожидалось %d", got, HuntCapHuman)
	}
	if got := huntCapFor(b1); got != HuntCapBot {
		t.Fatalf("лимит охотников на бота = %d, ожидалось %d", got, HuntCapBot)
	}
	if got := huntCapFor(nil); got != 0 {
		t.Fatalf("лимит для nil = %d", got)
	}

	for _, b := range []*Player{b1, b2, b3} {
		if !r.canHunt(b, victim, 60, 60, 3) {
			t.Fatalf("бот %d не смог занять свободный слот охоты", b.num)
		}
		r.enterHunt(b, victim.num, 60, 60, victim.num, 30)
	}
	if r.huntersOn[1] != 3 {
		t.Fatalf("охотников на жертве %d, ожидалось 3", r.huntersOn[1])
	}
	// Лимит закрыт для четвёртого.
	if r.canHunt(b4, victim, 60, 60, 3) {
		t.Fatal("четвёртый бот пробил лимит охотников")
	}
	// Но уже охотящийся на эту жертву проходит всегда.
	if !r.canHunt(b1, victim, 60, 60, 3) {
		t.Fatal("уже охотящийся бот не смог подтвердить свою охоту")
	}

	// 1. Смерть охотника освобождает слот.
	r.killPlayerWithReason(b1.num, 0, "wall", -1, 0, 0)
	if r.huntersOn[1] != 2 {
		t.Fatalf("после смерти охотника осталось %d, ожидалось 2", r.huntersOn[1])
	}
	if b1.aiHuntWho != 0 {
		t.Fatalf("у мёртвого охотника осталась цель %d", b1.aiHuntWho)
	}
	if !r.canHunt(b4, victim, 60, 60, 3) {
		t.Fatal("слот не освободился после смерти охотника")
	}

	// 2. Пересчёт из живого состояния даёт то же самое.
	r.recomputeHuntersLocked()
	if r.huntersOn[1] != 2 {
		t.Fatalf("после пересчёта охотников %d, ожидалось 2", r.huntersOn[1])
	}

	// 3. Смерть жертвы снимает перепись целиком.
	victim.alive = false
	r.recomputeHuntersLocked()
	if r.huntersOn[1] != 0 {
		t.Fatalf("после смерти жертвы охотников %d, ожидалось 0", r.huntersOn[1])
	}
	if b2.aiHuntWho != 0 || b3.aiHuntWho != 0 {
		t.Fatalf("охотники не отпустили мёртвую жертву: %d/%d", b2.aiHuntWho, b3.aiHuntWho)
	}

	// 4. Удаление бота из комнаты не оставляет висящей записи.
	victim.alive = true
	r.enterHunt(b2, victim.num, 60, 60, victim.num, 30)
	r.enterHunt(b3, victim.num, 60, 60, victim.num, 30)
	if r.huntersOn[1] != 2 {
		t.Fatalf("подготовка: охотников %d", r.huntersOn[1])
	}
	r.releaseHunt(b2)
	r.removePlayer(b2.num)
	r.recomputeHuntersLocked()
	if r.huntersOn[1] != 1 {
		t.Fatalf("после удаления бота охотников %d, ожидалось 1", r.huntersOn[1])
	}
	// Даже если releaseHunt забыли — пересчёт всё равно чинит.
	r.removePlayer(b3.num)
	r.recomputeHuntersLocked()
	if r.huntersOn[1] != 0 {
		t.Fatalf("пересчёт не починил счётчик после удаления: %d", r.huntersOn[1])
	}

	// 5. Сброс матча очищает перепись.
	r.enterHunt(b4, victim.num, 60, 60, victim.num, 30)
	if r.huntersOn[1] == 0 {
		t.Fatal("подготовка: охота не началась")
	}
	r.resetMatchLocked()
	if len(r.huntersOn) != 0 {
		t.Fatalf("после сброса матча перепись охотников не пуста: %v", r.huntersOn)
	}
	if b4.aiHuntWho != 0 || b4.aiMode == 2 {
		t.Fatalf("бот пережил сброс матча в режиме охоты: who=%d mode=%d", b4.aiHuntWho, b4.aiMode)
	}

	// 6. leaveHunt выходит из режима начисто.
	r.enterHunt(b4, victim.num, 60, 60, victim.num, 30)
	r.leaveHunt(b4)
	if b4.aiMode != 0 || b4.aiModeUntil != 0 || b4.aiHuntWho != 0 || r.huntersOn[1] != 0 {
		t.Fatalf("leaveHunt оставил хвосты: mode=%d until=%d who=%d census=%d",
			b4.aiMode, b4.aiModeUntil, b4.aiHuntWho, r.huntersOn[1])
	}
	// Повторный releaseHunt не уводит счётчик в минус.
	r.releaseHunt(b4)
	r.releaseHunt(b4)
	if n, ok := r.huntersOn[1]; ok && n != 0 {
		t.Fatalf("повторный releaseHunt дал счётчик %d", n)
	}
}

// Ловит: базовые отказы canHunt (мёртвая жертва, охота на себя, nil).
func TestCanHuntBasicRefusals(t *testing.T) {
	r := newRulesRoom(t, 233)
	r.tick = 10
	v := addHumanPlayer(r, 1, 60, 60, DirRight)
	b := newHuntBot(r, 2, ArchAggressor)

	if r.canHunt(nil, v, 60, 60, 3) {
		t.Fatal("nil-охотник прошёл")
	}
	if r.canHunt(b, nil, 60, 60, 3) {
		t.Fatal("nil-жертва прошла")
	}
	if r.canHunt(b, b, 50, 50, 0) {
		t.Fatal("бот собрался охотиться на себя")
	}
	v.alive = false
	if r.canHunt(b, v, 60, 60, 3) {
		t.Fatal("мёртвая жертва прошла")
	}
}

// Ловит: размывание архетипов в решении «идти ли на охоту» (G4/G21).
func TestBotMayHuntByArchetype(t *testing.T) {
	r := newRulesRoom(t, 239)
	mk := func(arch uint8) *Player {
		p := &Player{num: 1, bot: true, alive: true, x: 50, y: 50, homeX: 50, homeY: 50}
		p.aiArchetype = arch
		return p
	}

	// Фермер: только то, что под носом (<=5).
	f := mk(ArchFarmer)
	if !r.botMayHunt(f, 52, 50, 5) {
		t.Fatal("фермер отказался от цели на расстоянии 5")
	}
	if r.botMayHunt(f, 60, 50, 6) {
		t.Fatal("фермер погнался за целью на расстоянии 6")
	}

	// Агрессор: всегда.
	a := mk(ArchAggressor)
	for _, d := range []int{0, 5, 50, 500} {
		if !r.botMayHunt(a, 60, 60, d) {
			t.Fatalf("агрессор отказался от цели на расстоянии %d", d)
		}
	}

	// Трус: только короткие добивания (<=6).
	c := mk(ArchCoward)
	if !r.botMayHunt(c, 56, 50, 6) {
		t.Fatal("трус отказался от цели на расстоянии 6")
	}
	if r.botMayHunt(c, 57, 50, 7) {
		t.Fatal("трус погнался за целью на расстоянии 7")
	}

	// Территориальный: своя земля или окрестности дома (<=24), иначе нет.
	tr := mk(ArchTerritorial)
	tr.num = 7
	r.players[7] = tr
	far := 150
	if r.botMayHunt(tr, far, 130, 200) {
		t.Fatal("территориальный ушёл охотиться на другой конец карты")
	}
	// Рядом с домом.
	if !r.botMayHunt(tr, 50+10, 50, 10) {
		t.Fatal("территориальный отказался от цели рядом с домом")
	}
	// На своей земле, но далеко от дома.
	r.setGrid(r.idx(far, 130), 7)
	if !r.botMayHunt(tr, far, 130, 200) {
		t.Fatal("территориальный отказался от цели на собственной земле")
	}
	// Бот без дома (homeX < 0) и вне своей земли не охотится.
	tr.homeX, tr.homeY = -1, -1
	if r.botMayHunt(tr, 1, 1, 200) {
		t.Fatal("территориальный без дома погнался за далёкой целью")
	}
	// Цель вне поля не считается «своей землёй» и не роняет.
	if r.botMayHunt(tr, -5, -5, 3) {
		t.Fatal("цель за пределами поля прошла проверку своей земли")
	}
}

// Ловит: возврат разворота на 180° — ни игрок, ни бот не должны так уходить
// от смерти (G5).
func TestIsOppositeCoversEveryPair(t *testing.T) {
	dirs := []Dir{DirUp, DirDown, DirLeft, DirRight}
	opp := map[Dir]Dir{DirUp: DirDown, DirDown: DirUp, DirLeft: DirRight, DirRight: DirLeft}
	for _, a := range dirs {
		for _, b := range dirs {
			want := opp[a] == b
			if got := isOpposite(a, b); got != want {
				t.Fatalf("isOpposite(%d,%d) = %v, ожидалось %v", a, b, got, want)
			}
		}
		// Симметрия и отсутствие самопротивоположности.
		if isOpposite(a, a) {
			t.Fatalf("направление %d противоположно самому себе", a)
		}
		if isOpposite(a, opp[a]) != isOpposite(opp[a], a) {
			t.Fatalf("isOpposite несимметричен для %d", a)
		}
	}
	// Смена направления на противоположное в stepPlayer запрещена.
	r := newRulesRoom(t, 241)
	p := addHumanPlayer(r, 1, 50, 50, DirRight)
	p.pendingDir = DirLeft
	r.stepPlayer(p)
	if p.dir != DirRight {
		t.Fatalf("игрок развернулся на 180°: dir=%d", p.dir)
	}
	if p.nextX != 51 {
		t.Fatalf("движение после запрещённого разворота ушло в x=%d", p.nextX)
	}
	// Разрешённый поворот проходит.
	p.pendingDir = DirUp
	r.stepPlayer(p)
	if p.dir != DirUp {
		t.Fatalf("разрешённый поворот не применён: dir=%d", p.dir)
	}
}

// Ловит: выход окна восприятия бота за карту — на этом легко получить панику
// по индексу в сканах.
func TestBotROIBoundsStayOnMap(t *testing.T) {
	r := newRulesRoom(t, 251)
	p := &Player{num: 1, bot: true, alive: true}
	r.applyBotPersonality(p, TierHard, ArchAggressor)
	for _, pos := range [][2]int{{0, 0}, {W - 1, H - 1}, {W / 2, H / 2}, {1, H - 2}} {
		p.x, p.y = pos[0], pos[1]
		minX, minY, maxX, maxY := r.botROIBounds(p)
		if minX < 0 || minY < 0 || maxX > W || maxY > H {
			t.Fatalf("в позиции %v ROI = [%d..%d]x[%d..%d]", pos, minX, maxX, minY, maxY)
		}
		if maxX <= minX || maxY <= minY {
			t.Fatalf("в позиции %v ROI вырожден: [%d..%d]x[%d..%d]", pos, minX, maxX, minY, maxY)
		}
	}
	// Бот без личности получает глобальное окно, а не нулевое.
	legacy := &Player{num: 2, bot: true}
	w, h := legacy.botROI()
	if w != ROIWidth || h != ROIHeight {
		t.Fatalf("окно бота без личности = %dx%d, ожидалось %dx%d", w, h, ROIWidth, ROIHeight)
	}
	// И окно всегда не больше карты.
	big := &Player{num: 3, bot: true, aiROIW: 10 * W, aiROIH: 10 * H}
	w, h = big.botROI()
	if w != W || h != H {
		t.Fatalf("окно больше карты: %dx%d", w, h)
	}
}

// Ловит: возврат опережения камеры (roiLookahead). Продукт-решение — камера
// жёстко приколота к игроку; ненулевой сдвиг съедает запас позади головы и
// рисует туман прямо за змейкой.
func TestROILookaheadIsPinned(t *testing.T) {
	for _, rw := range []int{40, 80, 120} {
		for _, rh := range []int{28, 56, 120} {
			for _, d := range [][2]int{{0, 0}, {1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				if got := roiLookahead(rw, rh, d[0], d[1]); got != 0 {
					t.Fatalf("roiLookahead(%d,%d,%d,%d) = %d, ожидался 0", rw, rh, d[0], d[1], got)
				}
			}
		}
	}
}
