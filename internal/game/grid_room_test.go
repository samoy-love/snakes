package game

import (
	"math/rand"
	"testing"
)

// addHumanPlayer — «человек» без profileKey: пути начисления в профиль на нём
// молча выключены (profiles.ForKeyCreate("") == nil), а логика ботов в
// stepPlayer/applyMove не вмешивается в движение.
func addHumanPlayer(r *Room, num uint16, x, y int, d Dir) *Player {
	p := &Player{
		num: num, alive: true, x: x, y: y, homeX: x, homeY: y,
		dir: d, pendingDir: d, nextX: x, nextY: y, nextI: r.idx(x, y),
		aiCoolCell: -1,
	}
	r.players[num] = p
	r.scores[num] = 0
	r.points[num] = 0
	return p
}

// ---------------------------------------------------------------------------
// Согласованность gridPos <-> p.owned (swap-remove).
// ---------------------------------------------------------------------------

// checkOwnedIndex проверяет полный инвариант индекса владения:
//   - gridPos[i] != 0 ровно тогда, когда у клетки есть владелец;
//   - gridPos[i]-1 — позиция клетки в p.owned её владельца;
//   - в p.owned нет дублей и чужих клеток;
//   - len(p.owned) совпадает с числом клеток игрока на карте и со scores.
func checkOwnedIndex(t *testing.T, r *Room, step int) {
	t.Helper()
	count := map[uint16]int{}
	for i := 0; i < N; i++ {
		o := r.gridOwner[i]
		if o == 0 {
			if r.gridPos[i] != 0 {
				t.Fatalf("шаг %d: gridPos[%d]=%d у ничейной клетки", step, i, r.gridPos[i])
			}
			continue
		}
		count[o]++
		if r.gridPos[i] == 0 {
			t.Fatalf("шаг %d: клетка %d принадлежит %d, но не проиндексирована", step, i, o)
		}
	}
	for num, p := range r.players {
		if p == nil {
			continue
		}
		if len(p.owned) != count[num] {
			t.Fatalf("шаг %d: у игрока %d owned=%d, а на карте %d клеток", step, num, len(p.owned), count[num])
		}
		if int(r.scores[num]) != count[num] {
			t.Fatalf("шаг %d: scores[%d]=%d, а на карте %d клеток", step, num, r.scores[num], count[num])
		}
		seen := map[int]bool{}
		for k, cell := range p.owned {
			if seen[cell] {
				t.Fatalf("шаг %d: клетка %d встречается в owned игрока %d дважды", step, cell, num)
			}
			seen[cell] = true
			if r.gridOwner[cell] != num {
				t.Fatalf("шаг %d: в owned игрока %d лежит клетка %d владельца %d", step, num, cell, r.gridOwner[cell])
			}
			if got := int(r.gridPos[cell]) - 1; got != k {
				t.Fatalf("шаг %d: gridPos[%d]=%d, а позиция в owned = %d", step, cell, got, k)
			}
		}
	}
}

// Ловит: рассинхрон swap-remove в removeOwnedCell/addOwnedCell. Симптом в
// продакшне — «территория есть на карте, но счётчик показывает другое»,
// вплоть до клеток, которые невозможно потерять.
func TestOwnedIndexSurvivesRandomOwnershipChurn(t *testing.T) {
	r := newRulesRoom(t, 101)
	addHumanPlayer(r, 1, 5, 5, DirRight)
	addHumanPlayer(r, 2, 9, 9, DirRight)
	addHumanPlayer(r, 3, 15, 15, DirRight)

	rng := rand.New(rand.NewSource(2024))
	// Тесная область: перезаписи владельцев происходят постоянно.
	cells := make([]int, 0, 400)
	for y := 0; y < 20; y++ {
		for x := 0; x < 20; x++ {
			cells = append(cells, r.idx(x, y))
		}
	}
	for step := 0; step < 4000; step++ {
		i := cells[rng.Intn(len(cells))]
		owner := uint16(rng.Intn(4)) // 0 = снять владельца
		r.setGrid(i, owner)
		if step%97 == 0 {
			checkOwnedIndex(t, r, step)
		}
	}
	checkOwnedIndex(t, r, -1)

	// И то же самое после массовой очистки территории одного игрока.
	p := r.players[2]
	r.clearPlayerCells(2, p)
	if len(p.owned) != 0 {
		t.Fatalf("после очистки у игрока 2 осталось %d клеток", len(p.owned))
	}
	checkOwnedIndex(t, r, -2)
}

// Ловит: повторную вставку уже проиндексированной клетки и снятие индекса у
// клетки, которой игрок не владеет.
func TestAddRemoveOwnedCellGuards(t *testing.T) {
	r := newRulesRoom(t, 103)
	p := addHumanPlayer(r, 1, 5, 5, DirRight)

	r.addOwnedCell(1, 10)
	r.addOwnedCell(1, 10) // повтор
	if len(p.owned) != 1 {
		t.Fatalf("повторная вставка дала owned=%d", len(p.owned))
	}
	r.addOwnedCell(1, -1)
	r.addOwnedCell(1, N)
	if len(p.owned) != 1 {
		t.Fatalf("индексы вне поля попали в owned: %d", len(p.owned))
	}
	// Снятие непроиндексированной клетки — no-op.
	r.removeOwnedCell(1, 11)
	if len(p.owned) != 1 {
		t.Fatalf("снятие чужой клетки изменило owned: %d", len(p.owned))
	}
	// Удаление из середины двигает последнюю клетку и чинит её позицию.
	r.addOwnedCell(1, 20)
	r.addOwnedCell(1, 30)
	r.removeOwnedCell(1, 20)
	if len(p.owned) != 2 {
		t.Fatalf("owned=%d, ожидалось 2", len(p.owned))
	}
	if r.gridPos[20] != 0 {
		t.Fatalf("gridPos удалённой клетки = %d", r.gridPos[20])
	}
	for k, cell := range p.owned {
		if int(r.gridPos[cell])-1 != k {
			t.Fatalf("после swap-remove gridPos[%d]=%d, ожидалось %d", cell, r.gridPos[cell]-1, k)
		}
	}
}

// ---------------------------------------------------------------------------
// capture: заливка, замыкание петли, вложенные области.
// ---------------------------------------------------------------------------

// Ловит: поломку flood fill — незамкнутая петля не должна ничего захватывать,
// замкнутая обязана забирать и рамку, и всё внутри.
func TestCaptureFillsClosedLoopOnly(t *testing.T) {
	r := newRulesRoom(t, 107)
	p := addHumanPlayer(r, 1, 20, 20, DirRight)

	// Квадрат 10x10 по периметру.
	x0, y0, side := 20, 20, 10
	perim := make([]int, 0, 4*side)
	add := func(x, y int) {
		i := r.idx(x, y)
		r.setTrail(i, 1)
		perim = append(perim, i)
	}
	for x := x0; x < x0+side; x++ {
		add(x, y0)
		add(x, y0+side-1)
	}
	for y := y0 + 1; y < y0+side-1; y++ {
		add(x0, y)
		add(x0+side-1, y)
	}
	p.trail = append(p.trail[:0], perim...)

	r.capture(1)

	want := side * side
	if got := len(p.owned); got != want {
		t.Fatalf("захвачено %d клеток, ожидалось %d", got, want)
	}
	if int(r.scores[1]) != want {
		t.Fatalf("scores=%d, ожидалось %d", r.scores[1], want)
	}
	if len(p.trail) != 0 {
		t.Fatalf("след не очищен: %d клеток", len(p.trail))
	}
	// Центр внутри петли.
	if r.gridOwner[r.idx(x0+5, y0+5)] != 1 {
		t.Fatal("внутренняя клетка не захвачена")
	}
	// Клетка снаружи — нет.
	if r.gridOwner[r.idx(x0-1, y0-1)] != 0 {
		t.Fatal("клетка снаружи петли захвачена")
	}
	checkOwnedIndex(t, r, 0)

	// Незамкнутая линия: заливка снаружи достаёт всюду, добавляется только сам след.
	r2 := newRulesRoom(t, 109)
	q := addHumanPlayer(r2, 1, 50, 50, DirRight)
	line := make([]int, 0, 20)
	for x := 50; x < 70; x++ {
		i := r2.idx(x, 50)
		r2.setTrail(i, 1)
		line = append(line, i)
	}
	q.trail = append(q.trail[:0], line...)
	r2.capture(1)
	if got := len(q.owned); got != len(line) {
		t.Fatalf("незамкнутая линия захватила %d клеток, ожидалось %d (только сам след)", got, len(line))
	}
}

// Ловит: потерю заливки «дырок» — область, окружённая уже своей территорией,
// обязана закрываться, иначе внутри владений остаются вечные проплешины.
func TestCaptureFillsHoleInsideOwnedTerritory(t *testing.T) {
	r := newRulesRoom(t, 113)
	addHumanPlayer(r, 1, 30, 30, DirRight)

	// Кольцо владения с пустотой 3x3 внутри.
	for y := 30; y <= 36; y++ {
		for x := 30; x <= 36; x++ {
			if x >= 32 && x <= 34 && y >= 32 && y <= 34 {
				continue
			}
			r.setGrid(r.idx(x, y), 1)
		}
	}
	holeBefore := 0
	for y := 32; y <= 34; y++ {
		for x := 32; x <= 34; x++ {
			if r.gridOwner[r.idx(x, y)] == 0 {
				holeBefore++
			}
		}
	}
	if holeBefore != 9 {
		t.Fatalf("подготовка: дырка %d клеток, ожидалось 9", holeBefore)
	}

	r.capture(1)

	for y := 32; y <= 34; y++ {
		for x := 32; x <= 34; x++ {
			if r.gridOwner[r.idx(x, y)] != 1 {
				t.Fatalf("клетка дырки (%d,%d) не залита", x, y)
			}
		}
	}
	checkOwnedIndex(t, r, 0)
}

// Ловит: пропажу выплаты за захват (очки + Стиль) и, наоборот, оплату
// захвата, который ничего не добавил.
func TestCapturePaysOncePerRealGain(t *testing.T) {
	withEmptyProfileStore(t)
	r := newRulesRoom(t, 127)
	p := addHumanPlayer(r, 1, 20, 20, DirRight)
	p.bot = true // бот, чтобы не трогать хранилище профилей

	x0, y0, side := 20, 20, 12
	for x := x0; x < x0+side; x++ {
		for _, y := range []int{y0, y0 + side - 1} {
			i := r.idx(x, y)
			r.setTrail(i, 1)
			p.trail = append(p.trail, i)
		}
	}
	for y := y0 + 1; y < y0+side-1; y++ {
		for _, x := range []int{x0, x0 + side - 1} {
			i := r.idx(x, y)
			r.setTrail(i, 1)
			p.trail = append(p.trail, i)
		}
	}
	trailLen := len(p.trail)
	r.capture(1)

	// Оплачивается ПОЛНАЯ огороженная площадь: и след, и залитая им середина.
	// Именно так тюнилась capturePoints («11 очков за 100 клеток, 31 за 400»).
	// Регрессия, которую тест ловит: если снимок ownedBefore снова уедет ПОСЛЕ
	// заливки внутренней области, в delta останется только длина следа —
	// квадрат 12x12 начнёт платить capturePoints(44)=5 вместо
	// capturePoints(144)=14. Тогда доход в единицу времени падает с ростом
	// петли, и выгодной снова становится «дёргалка» мелкими захватами.
	delta := side * side
	if delta <= trailLen {
		t.Fatalf("подготовка: площадь %d должна быть больше периметра %d", delta, trailLen)
	}
	wantPts := capturePoints(delta, r.matchPhase(), r.mutatorType)
	if wantPts == 0 {
		t.Fatal("подготовка: захват такого размера обязан платить")
	}
	if got := r.points[1]; got != wantPts {
		t.Fatalf("очков за захват %d, ожидалось %d", got, wantPts)
	}
	if got := r.matchPointsBy[1][PointsCapture]; got != wantPts {
		t.Fatalf("разбивка PointsCapture = %d, ожидалось %d", got, wantPts)
	}
	if p.styleCaptureMatch == 0 {
		t.Fatal("Стиль за захват не начислен")
	}
	// Событие захвата ровно одно и с правильной дельтой.
	n := 0
	for _, e := range r.events {
		if e.Kind == EventCapture {
			n++
			if int(e.C) != delta {
				t.Fatalf("в событии захвата дельта %d, ожидалось %d", e.C, delta)
			}
		}
	}
	if n != 1 {
		t.Fatalf("событий захвата %d, ожидалось 1", n)
	}

	// Повторный capture без следа ничего не добавляет и не платит.
	ptsBefore := r.points[1]
	styleBefore := p.styleCaptureMatch
	r.capture(1)
	if r.points[1] != ptsBefore || p.styleCaptureMatch != styleBefore {
		t.Fatalf("пустой захват заплатил: очки %d->%d, стиль %d->%d",
			ptsBefore, r.points[1], styleBefore, p.styleCaptureMatch)
	}
}

// ---------------------------------------------------------------------------
// Смерть: 4 причины, очистка территории и следа.
// ---------------------------------------------------------------------------

// Ловит: перепутанные коды причин на проводе — клиент по ним рисует разные
// сообщения и эффекты смерти.
func TestReasonCodeMapping(t *testing.T) {
	want := map[string]uint8{
		"trail_cut":  1,
		"head_on":    2,
		"self_trail": 3,
		"wall":       4,
		"":           0,
		"whatever":   0,
	}
	for s, code := range want {
		if got := reasonCode(s); got != code {
			t.Fatalf("reasonCode(%q) = %d, ожидалось %d", s, got, code)
		}
	}
}

// Ловит: пропажу любой из четырёх причин смерти на реальном пути движения.
func TestFourDeathCauses(t *testing.T) {
	t.Run("wall", func(t *testing.T) {
		r := newRulesRoom(t, 131)
		r.tick = 5
		p := addHumanPlayer(r, 1, 0, 10, DirLeft)
		r.stepPlayer(p)
		if p.nextI != -1 {
			t.Fatalf("шаг за край дал nextI=%d", p.nextI)
		}
		r.applyMove(p)
		assertDeath(t, r, 1, 0, 4)
	})

	t.Run("self_trail", func(t *testing.T) {
		r := newRulesRoom(t, 137)
		r.tick = 5
		p := addHumanPlayer(r, 1, 10, 10, DirRight)
		i := r.idx(11, 10)
		r.setTrail(i, 1)
		p.trail = append(p.trail, i)
		r.stepPlayer(p)
		r.applyMove(p)
		assertDeath(t, r, 1, 0, 3)
	})

	t.Run("trail_cut", func(t *testing.T) {
		r := newRulesRoom(t, 139)
		r.tick = 5
		victim := addHumanPlayer(r, 1, 40, 40, DirRight)
		killer := addHumanPlayer(r, 2, 20, 20, DirRight)
		i := r.idx(21, 20)
		r.setTrail(i, 1)
		victim.trail = append(victim.trail, i)
		r.stepPlayer(killer)
		r.applyMove(killer)
		assertDeath(t, r, 1, 2, 1)
		if !killer.alive {
			t.Fatal("убийца погиб вместе с жертвой")
		}
		if r.matchKills[2] != 1 {
			t.Fatalf("килл не засчитан: %d", r.matchKills[2])
		}
		if r.matchDeaths[1] != 1 {
			t.Fatalf("смерть не засчитана: %d", r.matchDeaths[1])
		}
		// След жертвы снят с карты: клетка либо ничья, либо уже под следом
		// убийцы, но принадлежать погибшему она не может.
		if r.trailOwner[i] == 1 {
			t.Fatal("след погибшего остался на карте")
		}
	})

	t.Run("head_on", func(t *testing.T) {
		r := newRulesRoom(t, 149)
		r.tick = 5
		a := addHumanPlayer(r, 1, 50, 50, DirRight)
		b := addHumanPlayer(r, 2, 52, 50, DirLeft)
		r.stepPlayer(a)
		r.stepPlayer(b)
		if a.nextI != b.nextI {
			t.Fatalf("подготовка: игроки метят в разные клетки %d/%d", a.nextI, b.nextI)
		}
		r.resolveHeadOnCollisions([]*Player{a, b})
		assertDeath(t, r, 1, 0, 2)
		assertDeath(t, r, 2, 0, 2)
	})

	t.Run("head_on_grace", func(t *testing.T) {
		// F2: игрок в спавн-грейсе лобовое переживает, второй — нет.
		r := newRulesRoom(t, 151)
		r.tick = 5
		a := addHumanPlayer(r, 1, 50, 50, DirRight)
		b := addHumanPlayer(r, 2, 52, 50, DirLeft)
		a.spawnGraceUntil = r.tick + SpawnGraceTicks
		r.stepPlayer(a)
		r.stepPlayer(b)
		r.resolveHeadOnCollisions([]*Player{a, b})
		if !a.alive {
			t.Fatal("игрок в грейсе погиб в лобовом")
		}
		if b.alive {
			t.Fatal("второй игрок пережил лобовое")
		}
	})
}

func assertDeath(t *testing.T, r *Room, num uint16, killer uint16, code uint8) {
	t.Helper()
	p := r.players[num]
	if p.alive {
		t.Fatalf("игрок %d выжил", num)
	}
	if len(p.trail) != 0 {
		t.Fatalf("след игрока %d не очищен: %d клеток", num, len(p.trail))
	}
	if len(p.owned) != 0 {
		t.Fatalf("территория игрока %d не очищена: %d клеток", num, len(p.owned))
	}
	found := false
	for _, e := range r.events {
		if e.Kind == EventKill && e.A == num {
			found = true
			if e.D != code {
				t.Fatalf("причина смерти игрока %d = %d, ожидалось %d", num, e.D, code)
			}
			if e.B != killer {
				t.Fatalf("убийца игрока %d = %d, ожидалось %d", num, e.B, killer)
			}
		}
	}
	if !found {
		t.Fatalf("событие смерти игрока %d не отправлено (события: %d)", num, len(r.events))
	}
}

// Ловит: потерю остывания территории при смерти и, наоборот, её сохранение
// при окончательном выходе из комнаты.
func TestDeathCoolsTerritoryButLeavingDropsIt(t *testing.T) {
	r := newRulesRoom(t, 157)
	r.tick = 50
	addHumanPlayer(r, 1, 10, 10, DirRight)
	cells := []int{500, 501, 502}
	for _, i := range cells {
		r.setGrid(i, 1)
	}
	r.killPlayerWithReason(1, 0, "wall", -1, 0, 0)
	for _, i := range cells {
		if r.coolOwner[i] != 1 {
			t.Fatalf("клетка %d не остывает после смерти", i)
		}
		if r.gridWireAt(i) != coolOwnerFlag|1 {
			t.Fatalf("на провод клетка %d уходит как %#x, ожидалось %#x",
				i, r.gridWireAt(i), coolOwnerFlag|1)
		}
	}

	q := addHumanPlayer(r, 2, 12, 12, DirRight)
	other := []int{600, 601}
	for _, i := range other {
		r.setGrid(i, 2)
	}
	r.removePlayer(2)
	for _, i := range other {
		if r.coolOwner[i] != 0 {
			t.Fatalf("клетка %d ушедшего игрока осталась в остывании", i)
		}
		if r.gridWireAt(i) != 0 {
			t.Fatalf("клетка %d ушедшего игрока не обнулена на проводе", i)
		}
	}
	if len(q.owned) != 0 {
		t.Fatalf("у ушедшего игрока осталось %d клеток", len(q.owned))
	}
	if _, ok := r.players[2]; ok {
		t.Fatal("игрок не удалён из комнаты")
	}
}

// Ловит: превращение спавн-грейса в таран (F2). Иммунитет обязан сниматься
// ровно в тот момент, когда игрок сходит со своей земли, — иначе под ним можно
// безнаказанно въехать в чужой след.
func TestSpawnGraceEndsWhenLeavingOwnLand(t *testing.T) {
	r := newRulesRoom(t, 193)
	r.tick = 10
	p := addHumanPlayer(r, 1, 50, 50, DirRight)
	// Своя земля под ногами и на клетку вперёд.
	r.setGrid(r.idx(50, 50), 1)
	r.setGrid(r.idx(51, 50), 1)
	p.spawnGraceUntil = r.tick + SpawnGraceTicks

	// Шаг по своей земле грейс не трогает.
	r.stepPlayer(p)
	r.applyMove(p)
	if !r.hasSpawnGrace(p) {
		t.Fatal("грейс снят при движении по собственной территории")
	}
	if len(p.trail) != 0 {
		t.Fatalf("движение по своей земле оставило след: %d", len(p.trail))
	}

	// Шаг наружу — грейс снимается немедленно.
	r.stepPlayer(p)
	r.applyMove(p)
	if r.hasSpawnGrace(p) {
		t.Fatal("грейс пережил выход за пределы собственной территории — это таран")
	}
	if p.spawnGraceUntil != 0 {
		t.Fatalf("spawnGraceUntil = %d, ожидался 0", p.spawnGraceUntil)
	}
	if len(p.trail) != 1 {
		t.Fatalf("выход наружу не начал след: %d клеток", len(p.trail))
	}
	// И теперь игрока можно убить перерезанием следа.
	r.killPlayerWithReason(1, 2, "trail_cut", -1, 0, 0)
	if p.alive {
		t.Fatal("игрок вне своей земли всё ещё неуязвим")
	}
}

// ---------------------------------------------------------------------------
// Реклейм на боевом пути (applyMove).
// ---------------------------------------------------------------------------

// Ловит: отключение реклейма в applyMove (флаг 0x8000, окно ReclaimTicks,
// счётчик reclaimsMatch и событие для клиента). G3: механика однажды уже была
// мёртвым кодом, и заметили это только по логам.
func TestReclaimOnSteppingBackIntoCoolingPatch(t *testing.T) {
	r := newRulesRoom(t, 163)
	r.tick = 100
	p := addHumanPlayer(r, 1, 10, 10, DirRight)

	// Компактное пятно 6x6.
	patch := make([]int, 0, 36)
	for y := 20; y < 26; y++ {
		for x := 20; x < 26; x++ {
			i := r.idx(x, y)
			r.setGrid(i, 1)
			patch = append(patch, i)
		}
	}
	r.killPlayerWithReason(1, 0, "wall", -1, 0, 0)

	// «Респавн» рядом с пятном.
	p.alive = true
	p.spawnGraceUntil = 0
	p.x, p.y = 19, 20
	p.dir, p.pendingDir = DirRight, DirRight
	r.events = r.events[:0]
	r.stepPlayer(p)
	r.applyMove(p)

	if p.reclaimsMatch != 1 {
		t.Fatalf("счётчик реклеймов = %d, ожидался 1", p.reclaimsMatch)
	}
	want := (len(patch)*ReclaimReturnPercent + 99) / 100
	if len(p.owned) != want {
		t.Fatalf("возвращено %d клеток, ожидалось %d (%d%% пятна)", len(p.owned), want, ReclaimReturnPercent)
	}
	if len(p.trail) != 0 {
		t.Fatalf("вход на собственную землю оставил след из %d клеток", len(p.trail))
	}
	var ev *Event
	for i := range r.events {
		if r.events[i].Kind == EventReclaim {
			ev = &r.events[i]
		}
	}
	if ev == nil {
		t.Fatal("событие реклейма не отправлено")
	}
	if int(ev.B) != want {
		t.Fatalf("в событии реклейма %d клеток, ожидалось %d", ev.B, want)
	}
	checkOwnedIndex(t, r, 0)
}

// Ловит: реклейм за пределами окна ReclaimTicks — пятно обязано протухать.
func TestReclaimExpiresAfterWindow(t *testing.T) {
	r := newRulesRoom(t, 167)
	r.tick = 100
	p := addHumanPlayer(r, 1, 10, 10, DirRight)
	for y := 20; y < 24; y++ {
		for x := 20; x < 24; x++ {
			r.setGrid(r.idx(x, y), 1)
		}
	}
	r.killPlayerWithReason(1, 0, "wall", -1, 0, 0)

	r.tick += ReclaimTicks + 1
	p.alive = true
	p.spawnGraceUntil = 0
	p.x, p.y = 19, 20
	p.dir, p.pendingDir = DirRight, DirRight
	r.stepPlayer(p)
	r.applyMove(p)

	if p.reclaimsMatch != 0 {
		t.Fatalf("реклейм сработал за пределами окна: %d", p.reclaimsMatch)
	}
	if len(p.owned) != 0 {
		t.Fatalf("вернулось %d клеток после истечения окна", len(p.owned))
	}
	if len(p.trail) != 1 {
		t.Fatalf("след после входа на протухшую клетку = %d, ожидалась 1", len(p.trail))
	}
}

// ---------------------------------------------------------------------------
// bonusTerritory
// ---------------------------------------------------------------------------

// Ловит: обход бюджета bonusBudget — без него бонус за стрик/нову закрашивал
// бы произвольно большую площадь.
func TestBonusTerritoryRespectsBudget(t *testing.T) {
	r := newRulesRoom(t, 173)
	p := addHumanPlayer(r, 1, 100, 70, DirRight)
	p.bonusBudget = 5

	r.bonusTerritory(1, 100, 70, 4) // 9x9 = 81 клетка потенциально
	if got := len(p.owned); got != 5 {
		t.Fatalf("закрашено %d клеток при бюджете 5", got)
	}
	if p.bonusBudget != 0 {
		t.Fatalf("бюджет после траты = %d, ожидался 0", p.bonusBudget)
	}
	// Нулевой бюджет — ничего.
	r.bonusTerritory(1, 100, 70, 2)
	if got := len(p.owned); got != 5 {
		t.Fatalf("при нулевом бюджете закрашено ещё %d клеток", got-5)
	}
	// Нулевой радиус и мёртвый игрок — no-op.
	p.bonusBudget = 50
	r.bonusTerritory(1, 100, 70, 0)
	if p.bonusBudget != 50 {
		t.Fatalf("нулевой радиус потратил бюджет: %d", p.bonusBudget)
	}
	p.alive = false
	r.bonusTerritory(1, 100, 70, 3)
	if p.bonusBudget != 50 {
		t.Fatalf("мёртвый игрок потратил бюджет: %d", p.bonusBudget)
	}
	checkOwnedIndex(t, r, 0)
}

// ---------------------------------------------------------------------------
// measureTerritoryShape
// ---------------------------------------------------------------------------

// Ловит: ошибку в bbox/плотности/периметре — на них опирается диагностика ИИ.
func TestMeasureTerritoryShape(t *testing.T) {
	r := newRulesRoom(t, 179)
	p := addHumanPlayer(r, 1, 5, 5, DirRight)

	area, bw, bh, dens, per := r.measureTerritoryShape(1, p)
	if area != 0 || bw != 0 || bh != 0 || dens != 0 || per != 0 {
		t.Fatalf("пустая территория дала %d %dx%d %.2f %d", area, bw, bh, dens, per)
	}
	// Прямоугольник 3x2.
	for y := 10; y < 12; y++ {
		for x := 10; x < 13; x++ {
			r.setGrid(r.idx(x, y), 1)
		}
	}
	area, bw, bh, dens, per = r.measureTerritoryShape(1, p)
	if area != 6 || bw != 3 || bh != 2 {
		t.Fatalf("площадь=%d bbox=%dx%d, ожидалось 6 и 3x2", area, bw, bh)
	}
	if dens != 1.0 {
		t.Fatalf("плотность = %.3f, ожидалась 1.0", dens)
	}
	if per != 10 {
		t.Fatalf("периметр = %d, ожидался 10", per)
	}
	if _, _, _, _, _ = r.measureTerritoryShape(1, nil); false {
		t.Fatal("unreachable")
	}
}

// ---------------------------------------------------------------------------
// Фазы матча и сброс матча.
// ---------------------------------------------------------------------------

// Ловит: сдвиг границ фаз — от фазы зависят удвоение очков за захват, частота
// бонусов и охота за головами.
func TestMatchPhaseBoundaries(t *testing.T) {
	r := newRulesRoom(t, 181)
	r.matchStartTick = 1000
	r.matchEndTick = r.matchStartTick + MatchDurationTicks
	cases := []struct {
		elapsed uint32
		phase   uint8
	}{
		{0, PhaseExpansion},
		{PhaseExpansionEndTick - 1, PhaseExpansion},
		{PhaseExpansionEndTick, PhaseConflict},
		{PhaseConflictEndTick - 1, PhaseConflict},
		{PhaseConflictEndTick, PhaseFinal},
		{PhaseConflictEndTick + 5000, PhaseFinal},
	}
	for _, c := range cases {
		r.tick = r.matchStartTick + c.elapsed
		if got := r.matchPhase(); got != c.phase {
			t.Fatalf("на %d тике матча фаза %d, ожидалась %d", c.elapsed, got, c.phase)
		}
	}
	// Границы фаз, объявляемые клиенту, совпадают с расчётом.
	r.tick = r.matchStartTick
	if got := r.phaseUntilTick(); got != r.matchStartTick+PhaseExpansionEndTick {
		t.Fatalf("конец фазы расширения = %d, ожидалось %d", got, r.matchStartTick+PhaseExpansionEndTick)
	}
	r.tick = r.matchStartTick + PhaseExpansionEndTick
	if got := r.phaseUntilTick(); got != r.matchStartTick+PhaseConflictEndTick {
		t.Fatalf("конец фазы конфликта = %d, ожидалось %d", got, r.matchStartTick+PhaseConflictEndTick)
	}
}

// Ловит: остаточное состояние прошлого матча — самая частая причина «новый
// матч начался, а бонусы/потолки уже израсходованы».
func TestResetMatchClearsPerMatchState(t *testing.T) {
	r := newRulesRoom(t, 191)
	r.tick = 2000
	p := addHumanPlayer(r, 1, 30, 30, DirRight)
	p.bot = true
	b := addBotPlayer(r, 2)

	// Пачкаем всё, что обязано обнулиться.
	r.setGrid(r.idx(40, 40), 1)
	r.points[1] = 500
	r.matchKills[1] = 3
	r.matchDeaths[1] = 2
	r.matchStyleEarned[1] = 90
	r.matchStyleBy[1] = [StyleReasonCount]uint16{1: 10}
	r.matchPointsBy[1] = [8]uint16{1: 10}
	r.matchContractsBy[1] = [4]uint16{1: 2}
	p.styleCaptureMatch = 70
	p.styleCaptureAcc = 17
	p.styleKillMatch = 100
	p.botKillsMatch = 12
	p.holdAcc = 999
	p.holdPointsMatch = 250
	p.reclaimsMatch = 4
	p.revengeStyleAcc = 60
	p.revengeLastTgt = 2
	p.revengeLastTick = 1500
	p.bountyStyleMatch = 120
	p.contractsDone = MaxContractsMatch
	p.peakCells = 900
	p.cellTicks = 12345
	p.aiDeathN = aiDeathCap
	r.bountyTarget = 2
	r.bountyUntil = 3000
	r.mutatorType = MutatorDoubleCapture
	r.mutatorUntil = 3000
	r.huntersOn[2] = 3
	b.aiHuntWho = 1
	b.aiMode = 2
	seqBefore := r.matchSeq

	r.resetMatchLocked()

	if r.matchSeq != seqBefore+1 {
		t.Fatalf("matchSeq = %d, ожидалось %d", r.matchSeq, seqBefore+1)
	}
	if r.matchEnded || r.matchResetAt != 0 || r.matchEndSentSeq != 0 {
		t.Fatal("флаги завершения матча не сброшены")
	}
	if r.bountyTarget != 0 || r.bountyUntil != 0 || r.mutatorType != MutatorNone {
		t.Fatal("охота за головой или мутатор пережили сброс матча")
	}
	if len(r.huntersOn) != 0 {
		t.Fatalf("перепись охотников не очищена: %d записей", len(r.huntersOn))
	}
	// peakCells здесь не проверяется: resetMatchLocked обнуляет его, но тут же
	// вызывает respawnPlayer, который выдаёт стартовый участок и честно ставит
	// новый пик.
	counters := map[string]uint16{
		"styleCaptureMatch": p.styleCaptureMatch,
		"styleKillMatch":    p.styleKillMatch,
		"holdPointsMatch":   p.holdPointsMatch,
		"reclaimsMatch":     p.reclaimsMatch,
		"revengeStyleAcc":   p.revengeStyleAcc,
		"revengeLastTgt":    p.revengeLastTgt,
		"bountyStyleMatch":  p.bountyStyleMatch,
		"contractsDone":     p.contractsDone,
		"botKillsMatch":     p.botKillsMatch,
	}
	for name, v := range counters {
		if v != 0 {
			t.Fatalf("пер-матчевый счётчик %s не обнулён: %d", name, v)
		}
	}
	if p.peakCells > uint16(len(p.owned)) {
		t.Fatalf("peakCells=%d больше свежей территории %d — счётчик пережил матч",
			p.peakCells, len(p.owned))
	}
	if p.styleCaptureAcc != 0 || p.holdAcc != 0 || p.cellTicks != 0 || p.revengeLastTick != 0 {
		t.Fatalf("накопители не обнулены: acc=%d hold=%d ticks=%d rev=%d",
			p.styleCaptureAcc, p.holdAcc, p.cellTicks, p.revengeLastTick)
	}
	if p.aiDeathN != 0 {
		t.Fatalf("кольцо смертей бота не сброшено: %d", p.aiDeathN)
	}
	if len(r.matchKills) != 0 || len(r.matchDeaths) != 0 || len(r.matchStyleEarned) != 0 ||
		len(r.matchStyleBy) != 0 || len(r.matchPointsBy) != 0 || len(r.matchContractsBy) != 0 {
		t.Fatal("матчевые карты не очищены")
	}
	if len(r.coolBatches) != 0 {
		t.Fatalf("очередь остывания пережила сброс: %d", len(r.coolBatches))
	}
	// Карта чистая, кроме свежих спавн-territory (respawnPlayer их выдаёт).
	for i := 0; i < N; i++ {
		if r.gridOwner[i] == 0 && r.gridPos[i] != 0 {
			t.Fatalf("gridPos[%d] пережил сброс: %d", i, r.gridPos[i])
		}
		if r.coolOwner[i] != 0 {
			t.Fatalf("остывание клетки %d пережило сброс", i)
		}
	}
	checkOwnedIndex(t, r, 0)
}
