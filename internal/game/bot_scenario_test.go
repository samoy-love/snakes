// История: во время разработки этих тестов один из промежуточных вариантов
// уводил snakes.test.exe в 45 ГБ и исчерпывал ОЗУ машины. Файл был временно
// отключён build-тегом до расследования. Расследование проведено на ИТОГОВОЙ
// версии, и она чиста — тег снят. Замеры, на которых это основано:
//
//	go test -tags(снят) ./...            весь набор: 11.6 с
//	каждый тест по отдельности           1-2 с, без роста памяти
//	-memprofile в конце прогона          8 МБ, и все они — runtime.allocm
//	                                     и runtime.procresize, прикладной
//	                                     памяти не удержано
//	TestRoomFleetStepBudget, 100 комнат  куча 81 -> 1 МБ после GC
//
// То есть r.step() на комнате без клиентов не течёт, и подозрение с него снято.
// Регресс на этот случай стоит рядом: TestRoomFleetStepBudget в
// bench_rooms_test.go валит прогон при росте кучи и накрыт предохранителем
// fleetMemGuard, который останавливает тест на 1.5 ГБ вместо того, чтобы дать
// съесть машину.
package game

import (
	"math/rand"
	"sort"
	"testing"
)

// ---------------------------------------------------------------------------
// Сценарные тесты бот-ИИ.
//
// botStep — это ~1000 строк эвристик, у которых нет «правильного ответа»:
// тест вида «в такой обстановке бот обязан пойти влево» цементирует случайное
// текущее значение веса и ломается от любой перебалансировки. Поэтому здесь
// нет ни одной проверки конкретного решения. Вместо этого гоняется настоящий
// матч (комната с ботами на N тиков) и проверяются свойства, которые обязаны
// выполняться при ЛЮБОЙ настройке эвристик: безопасность движения, лимит
// охотников, живучесть, целостность учёта клеток, состав комнаты.
//
// Детерминированность: r.rng сеется фиксированным значением, время/сеть/тикеры
// не используются, шаг комнаты вызывается напрямую. Обход map в Go случаен,
// поэтому порядок обработки игроков внутри r.step() от прогона к прогону
// меняется — все проверки здесь либо строго инвариантны, либо статистические
// с большим запасом, и каждая гоняется на нескольких фиксированных сидах.
// ---------------------------------------------------------------------------

// scenarioSeeds — фиксированный набор сидов. Несколько прогонов нужны потому,
// что порядок обхода r.players (а с ним и порядок розыгрыша r.rng) в Go не
// детерминирован, и одна траектория ничего не доказывает.
var scenarioSeeds = []int64{1, 7, 42, 1337}

// skipLongScenario снимает сценарий с прогона под -short.
//
// Сценарии — детерминированные симуляции на десятки тысяч тиков, и все они
// однопоточные: ни горутин, ни каналов, ни sync внутри нет. Детектору гонок
// здесь нечего искать, зато он замедляет прогон настолько, что пакет
// перестаёт укладываться в таймаут. Поэтому CI гоняет их отдельным шагом
// без -race, а прогон с детектором идёт с -short.
func skipLongScenario(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("длинная симуляция: гоняется отдельным шагом без -race")
	}
}

// newBotScenarioRoom собирает комнату с полным штатом ботов и без клиентов.
// humanCount выставляется ПОСЛЕ расстановки ботов: r.step() досрочно выходит
// из пустой комнаты (G11), а состав популяции пересчитывается только на
// входе/выходе людей, не каждый тик.
func newBotScenarioRoom(t *testing.T, seed int64) *Room {
	t.Helper()
	r := newRulesRoom(t, seed)
	r.nextPowerUpID = 1
	r.syncBotPopulationLocked()
	if len(r.players) != BotCount {
		t.Fatalf("сид %d: в комнате %d ботов, ожидалось %d", seed, len(r.players), BotCount)
	}
	r.humanCount = 1
	return r
}

// sortedNums возвращает номера игроков в детерминированном порядке: полагаться
// на порядок обхода map нельзя.
func sortedNums(r *Room) []uint16 {
	nums := make([]uint16, 0, len(r.players))
	for num := range r.players {
		nums = append(nums, num)
	}
	sort.Slice(nums, func(i, j int) bool { return nums[i] < nums[j] })
	return nums
}

// ---------------------------------------------------------------------------
// 1. Безопасность движения
// ---------------------------------------------------------------------------

// Ловит:
//   - выход головы за границы поля (индексная паника в сканах);
//   - «телепорт»: прыжок больше чем на шаг за тик и остановку на месте;
//   - рассинхрон p.nextI с фактической позицией. nextI обязан быть либо -1
//     (стена/смерть), либо корректным индексом ровно той клетки, где стоит
//     голова, иначе весь протокол и все проверки столкновений считают не то;
//   - массовый возврат разворота на 180° (G5). У человека разворот запрещён
//     жёстко, у бота он раньше протекал через аварийные ветки. Проверяется
//     ДОЛЯ разворотов, а не ноль: на живом коде остаточная дырка ещё есть
//     (см. BUG-1 в отчёте) и даёт ~1 разворот на 10..40 тысяч бот-тиков.
//     Порог 0.1% — стократный запас над этим фоном; снятие любого из трёх
//     isOpposite-барьеров (stepPlayer, applyMove, botPickDirOutside) поднимает
//     долю на порядки, а перебалансировка весов её не двигает вовсе.
func TestBotScenarioMovementSafety(t *testing.T) {
	skipLongScenario(t)
	type track struct {
		x, y   int
		dx, dy int
		alive  bool
		hadDir bool
	}
	totalBotTicks := 0
	totalReversals := 0

	for _, seed := range scenarioSeeds {
		r := newBotScenarioRoom(t, seed)

		prev := make(map[uint16]track, len(r.players))
		for _, num := range sortedNums(r) {
			p := r.players[num]
			prev[num] = track{x: p.x, y: p.y, alive: p.alive}
		}

		const ticks = 700
		for tk := 0; tk < ticks; tk++ {
			r.step()
			for _, num := range sortedNums(r) {
				p := r.players[num]
				pv := prev[num]

				if !p.alive {
					if p.nextI != -1 {
						t.Fatalf("сид %d тик %d: мёртвый бот %d хранит nextI=%d, ожидалось -1",
							seed, r.tick, num, p.nextI)
					}
					prev[num] = track{x: p.x, y: p.y, alive: false}
					continue
				}

				if !inBounds(p.x, p.y) {
					t.Fatalf("сид %d тик %d: бот %d вышел за поле: (%d,%d)",
						seed, r.tick, num, p.x, p.y)
				}
				if want := r.idx(p.x, p.y); p.nextI != want {
					t.Fatalf("сид %d тик %d: у бота %d nextI=%d, а голова в (%d,%d) => %d",
						seed, r.tick, num, p.nextI, p.x, p.y, want)
				}

				dx := p.x - pv.x
				dy := p.y - pv.y
				if !pv.alive {
					// Респавн — это телепорт по определению, шаг не измеряем.
					prev[num] = track{x: p.x, y: p.y, alive: true}
					continue
				}
				totalBotTicks++
				dist := abs(dx) + abs(dy)
				// За один тик игрок делает один шаг, а под ускорением — два.
				if dist > 2 {
					t.Fatalf("сид %d тик %d: бот %d переместился на %d клеток за тик: (%d,%d)->(%d,%d)",
						seed, r.tick, num, dist, pv.x, pv.y, p.x, p.y)
				}
				if dist == 0 {
					t.Fatalf("сид %d тик %d: живой бот %d не сдвинулся с (%d,%d)",
						seed, r.tick, num, pv.x, pv.y)
				}
				if dist == 1 && pv.hadDir && abs(pv.dx)+abs(pv.dy) == 1 {
					// Оба тика — обычный одиночный шаг: разворот виден напрямую.
					if dx == -pv.dx && dy == -pv.dy {
						totalReversals++
					}
				}
				prev[num] = track{x: p.x, y: p.y, dx: dx, dy: dy, alive: true, hadDir: true}
			}
		}
	}

	if totalBotTicks < 10000 {
		t.Fatalf("измерено всего %d бот-тиков — выборки не хватает", totalBotTicks)
	}
	// 0.1% от всех бот-тиков.
	if limit := totalBotTicks / 1000; totalReversals > limit {
		t.Fatalf("боты развернулись на 180° %d раз за %d бот-тиков (порог %d) — барьер isOpposite снят",
			totalReversals, totalBotTicks, limit)
	}
	t.Logf("разворотов %d на %d бот-тиков", totalReversals, totalBotTicks)
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// Аварийные ветки (stepPlayer и applyMove) — единственное место, где бот может
// поменять направление вне своей «головы». Полноматчевый тест выше их не
// краснит: разворот всегда ведёт на клетку, с которой бот только что ушёл, а
// она почти всегда его же след и отсекается другой проверкой. Поэтому барьер
// проверяется на самих ветках, детерминированным перебором ловушек.
//
// Ловит:
//   - снятие любого из барьеров isOpposite в аварийных ветках stepPlayer и
//     applyMove (G5). Разворот — это движение, недоступное живому игроку, и
//     бот, уходящий им от смерти, читается как читер;
//   - потерю проверки границ при вычислении p.nextI: шаг в стену обязан дать
//     ровно -1, а не индекс соседней строки (заворот карты по краю).
//
// Обе ветки изолируются от «обычного» поворота тем, что pendingDir на входе
// равен dir: тогда единственный источник смены направления — сама аварийная
// ветка, и её результат обязан не быть противоположен входному направлению.
func TestBotEmergencyTurnNeverReverses(t *testing.T) {
	skipLongScenario(t)
	for _, seed := range scenarioSeeds {
		r := newRulesRoom(t, seed)
		r.tick = 1000
		rng := rand.New(rand.NewSource(seed*7919 + 13))

		p := &Player{
			num: 1, bot: true, alive: true,
			homeX: -1, homeY: -1, aiCoolCell: -1,
			aiTargetX: -1, aiTargetY: -1,
		}
		r.players[1] = p
		r.scores[1] = 0
		r.points[1] = 0
		r.applyBotPersonality(p, TierHard, ArchAggressor)

		painted := make([]int, 0, 64)
		avoidFired := 0
		const iters = 3000
		for it := 0; it < iters; it++ {
			for _, i := range painted {
				r.trailOwner[i] = 0
			}
			painted = painted[:0]
			r.changedTrail = r.changedTrail[:0]
			r.changedGrid = r.changedGrid[:0]
			r.minimapGrid = r.minimapGrid[:0]
			r.events = r.events[:0]

			// Голова ставится в том числе вплотную к краю: ветка «шаг в стену»
			// обязана проверяться вместе с веткой «шаг в свой след».
			px := rng.Intn(W)
			py := rng.Intn(H)
			for dy := -3; dy <= 3; dy++ {
				for dx := -3; dx <= 3; dx++ {
					if dx == 0 && dy == 0 {
						continue
					}
					x := px + dx
					y := py + dy
					if !inBounds(x, y) || rng.Intn(100) >= 55 {
						continue
					}
					i := r.idx(x, y)
					r.trailOwner[i] = p.num
					painted = append(painted, i)
				}
			}
			p.x, p.y = px, py
			p.alive = true
			p.respawnAt = 0
			p.shield = 0
			p.spawnGraceUntil = 0
			p.speedUntil = 0
			p.aiMode = 0
			p.aiHuntTarget = 0
			p.trail = append(p.trail[:0], painted...)
			p.owned = p.owned[:0]
			p.aiAvoidTick = 0

			entry := Dir(rng.Intn(4))
			p.dir = entry
			p.pendingDir = entry

			r.stepPlayer(p)
			if p.aiAvoidTick != 0 {
				avoidFired++
			}
			if isOpposite(entry, p.dir) {
				t.Fatalf("сид %d итерация %d: stepPlayer развернул бота с %d на %d в (%d,%d)",
					seed, it, entry, p.dir, px, py)
			}
			if inBounds(p.nextX, p.nextY) {
				if want := r.idx(p.nextX, p.nextY); p.nextI != want {
					t.Fatalf("сид %d итерация %d: nextI=%d при цели (%d,%d) => %d",
						seed, it, p.nextI, p.nextX, p.nextY, want)
				}
			} else if p.nextI != -1 {
				t.Fatalf("сид %d итерация %d: шаг в стену (%d,%d) дал nextI=%d, ожидалось -1",
					seed, it, p.nextX, p.nextY, p.nextI)
			}

			before := p.dir
			r.applyMove(p)
			if p.alive && isOpposite(before, p.dir) {
				t.Fatalf("сид %d итерация %d: applyMove развернул бота с %d на %d",
					seed, it, before, p.dir)
			}
			// applyMove мог убить бота и почистить его клетки — вернуть доску
			// в исходное состояние помогает список painted, но захваченные и
			// снятые клетки чистим по факту.
			for _, i := range painted {
				r.trailOwner[i] = 0
			}
			for _, i := range p.trail {
				r.trailOwner[i] = 0
			}
			p.trail = p.trail[:0]
			for len(p.owned) > 0 {
				i := p.owned[len(p.owned)-1]
				r.setGrid(i, 0)
			}
			painted = painted[:0]
		}
		if avoidFired < iters/20 {
			t.Fatalf("сид %d: аварийная ветка сработала всего %d раз из %d — тест выродился",
				seed, avoidFired, iters)
		}
		t.Logf("сид %d: аварийная ветка сработала %d раз из %d", seed, avoidFired, iters)
	}
}

// ---------------------------------------------------------------------------
// 2. След: наезд на себя и уборка после смерти
// ---------------------------------------------------------------------------

// Ловит:
//   - выживание после наезда на собственный след. Голова живого бота может
//     стоять на своей клетке следа только если это САМАЯ СВЕЖАЯ клетка следа:
//     applyMove кладёт пройденную клетку в хвост списка. Если бот прошёл
//     сквозь свой старый след и не умер, повторной записи не будет (её
//     блокирует проверка trailOwner) — и голова окажется в середине следа,
//     что здесь и ловится. Это единственный наблюдаемый снаружи признак того,
//     что смерть от self_trail перестала быть безусловной;
//   - осиротевшие клетки следа: клетка на карте помечена следом игрока, но в
//     его p.trail её нет. Такую клетку уже никто не уберёт — она навсегда
//     остаётся смертельной ловушкой на пустом месте;
//   - незачищенное состояние мёртвого бота: у трупа обязаны быть пустые
//     trail и owned, иначе его территория остаётся «призраком».
func TestBotScenarioTrailIntegrity(t *testing.T) {
	skipLongScenario(t)
	for _, seed := range scenarioSeeds {
		r := newBotScenarioRoom(t, seed)

		const ticks = 700
		inList := make(map[uint16]map[int]struct{}, len(r.players))
		for tk := 0; tk < ticks; tk++ {
			r.step()
			// Полный скан карты дорогой, поэтому раз в 10 тиков; проверки по
			// самим игрокам — каждый тик.
			fullScan := tk%10 == 0 || tk == ticks-1
			for _, num := range sortedNums(r) {
				p := r.players[num]
				if !p.alive {
					if len(p.trail) != 0 || len(p.owned) != 0 {
						t.Fatalf("сид %d тик %d: у мёртвого бота %d trail=%d owned=%d, ожидалось 0/0",
							seed, r.tick, num, len(p.trail), len(p.owned))
					}
					delete(inList, num)
					continue
				}
				m := inList[num]
				if m == nil {
					m = make(map[int]struct{}, 64)
					inList[num] = m
				}
				for k := range m {
					delete(m, k)
				}
				for _, cell := range p.trail {
					if cell < 0 || cell >= N {
						t.Fatalf("сид %d тик %d: бот %d держит в следе клетку %d вне поля",
							seed, r.tick, num, cell)
					}
					m[cell] = struct{}{}
				}
				head := r.idx(p.x, p.y)
				if r.trailOwner[head] == num && len(p.trail) > 0 && p.trail[len(p.trail)-1] != head {
					t.Fatalf("сид %d тик %d: голова бота %d стоит в середине собственного следа (клетка %d, хвост %d) — наезд на свой след перестал убивать",
						seed, r.tick, num, head, p.trail[len(p.trail)-1])
				}
			}
			if !fullScan {
				continue
			}
			for i := 0; i < N; i++ {
				o := r.trailOwner[i]
				if o == 0 {
					continue
				}
				if r.players[o] == nil {
					t.Fatalf("сид %d тик %d: на карте остался след несуществующего игрока %d",
						seed, r.tick, o)
				}
				if _, ok := inList[o][i]; !ok {
					t.Fatalf("сид %d тик %d: клетка %d помечена следом игрока %d, но в его p.trail её нет — след осиротел",
						seed, r.tick, i, o)
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 3. Целостность учёта территории
// ---------------------------------------------------------------------------

// Ловит:
//   - «призрачные» клетки: занятую на карте клетку, которой нет ни в одном
//     p.owned (её никогда не отберут и не очистят) и наоборот;
//   - расхождение r.scores[num] с len(p.owned) — счёт в таблице и в протоколе
//     берётся из scores, а вся игровая логика из owned;
//   - поломку обратного индекса gridPos, на котором держится O(1) удаление
//     клетки: рассинхрон там тихо теряет клетки при следующем захвате.
func TestBotScenarioGridAccounting(t *testing.T) {
	skipLongScenario(t)
	for _, seed := range scenarioSeeds {
		r := newBotScenarioRoom(t, seed)

		const ticks = 700
		for tk := 0; tk < ticks; tk++ {
			r.step()
			if tk%10 != 0 && tk != ticks-1 {
				continue
			}
			ownedTotal := 0
			for _, num := range sortedNums(r) {
				p := r.players[num]
				if int(r.scores[num]) != len(p.owned) {
					t.Fatalf("сид %d тик %d: у игрока %d scores=%d, len(owned)=%d",
						seed, r.tick, num, r.scores[num], len(p.owned))
				}
				ownedTotal += len(p.owned)
				for pos, cell := range p.owned {
					if cell < 0 || cell >= N {
						t.Fatalf("сид %d тик %d: игрок %d владеет клеткой %d вне поля",
							seed, r.tick, num, cell)
					}
					if r.gridOwner[cell] != num {
						t.Fatalf("сид %d тик %d: клетка %d в owned игрока %d, а на карте у %d",
							seed, r.tick, num, cell, r.gridOwner[cell])
					}
					if int(r.gridPos[cell])-1 != pos {
						t.Fatalf("сид %d тик %d: gridPos[%d]=%d, а в owned игрока %d позиция %d",
							seed, r.tick, cell, r.gridPos[cell], num, pos)
					}
				}
			}
			mapTotal := 0
			for i := 0; i < N; i++ {
				if o := r.gridOwner[i]; o != 0 {
					mapTotal++
					if r.players[o] == nil {
						t.Fatalf("сид %d тик %d: клетка %d принадлежит несуществующему игроку %d",
							seed, r.tick, i, o)
					}
				}
			}
			if mapTotal != ownedTotal {
				t.Fatalf("сид %d тик %d: на карте занято %d клеток, у игроков в owned %d",
					seed, r.tick, mapTotal, ownedTotal)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 4. Лимит охотников (G1/G2)
// ---------------------------------------------------------------------------

// huntCensus считает фактическое число ботов в режиме охоты по каждой жертве.
func huntCensus(r *Room) map[uint16]int {
	out := make(map[uint16]int, 8)
	for _, p := range r.players {
		if p == nil || !p.bot || !p.alive || p.aiMode != 2 || p.aiHuntWho == 0 {
			continue
		}
		out[p.aiHuntWho]++
	}
	return out
}

// Ловит:
//   - снятие или обход потолка одновременных охотников (HuntCapHuman /
//     HuntCapBot). Без него на одну жертву сваливается вся комната, и это
//     ровно то ощущение «затравили толпой», ради которого лимит и вводился;
//   - утечку слотов: если releaseHunt перестанет вызываться (смерть охотника,
//     смерть жертвы, удаление бота), счётчик huntersOn «залипает» на потолке
//     и агрессия ботов молча выключается до конца матча. Проверяется тем, что
//     сумма забронированных слотов не может превысить число ботов и что в
//     huntersOn нет записей на несуществующих игроков.
func TestBotScenarioHunterCapNeverExceeded(t *testing.T) {
	skipLongScenario(t)
	for _, seed := range scenarioSeeds {
		r := newBotScenarioRoom(t, seed)

		const ticks = 700
		everHunted := false
		for tk := 0; tk < ticks; tk++ {
			r.step()
			for victim, n := range huntCensus(r) {
				v := r.players[victim]
				if v == nil {
					t.Fatalf("сид %d тик %d: %d ботов охотятся на несуществующего игрока %d",
						seed, r.tick, n, victim)
				}
				if n > 0 {
					everHunted = true
				}
				if cap := huntCapFor(v); n > cap {
					t.Fatalf("сид %d тик %d: на игрока %d (бот=%t) охотятся %d ботов при потолке %d",
						seed, r.tick, victim, v.bot, n, cap)
				}
			}
			booked := 0
			for victim, n := range r.huntersOn {
				if n < 0 {
					t.Fatalf("сид %d тик %d: huntersOn[%d]=%d ушёл в минус", seed, r.tick, victim, n)
				}
				if r.players[victim] == nil {
					t.Fatalf("сид %d тик %d: huntersOn держит слот на несуществующего игрока %d",
						seed, r.tick, victim)
				}
				booked += n
			}
			if booked > len(r.players) {
				t.Fatalf("сид %d тик %d: забронировано %d слотов охоты при %d игроках — слоты утекают",
					seed, r.tick, booked, len(r.players))
			}
		}
		if !everHunted {
			t.Fatalf("сид %d: за %d тиков ни один бот не перешёл в режим охоты — агрессия выключена",
				seed, ticks)
		}
	}
}

// forceHuntDeath сводит двух ботов в охоту и убивает охотника тем же тиком.
//
// Смерть охотника — главный путь возврата слота, и ждать её от симуляции
// нельзя: порядок обхода r.players в Go случаен, поэтому при одном и том же
// сиде матч идёт по-разному, и бывают прогоны, где за все отведённые тики не
// гибнет никто (наблюдалось 02.08.2026: push прошёл, pull_request на том же
// коммите упал). Поэтому смерть организуется тестом: пара берётся по
// возрастанию номера, а не по состоянию ИИ.
//
// Возвращает жертву, чтобы вызывающий мог убить и её тоже.
func forceHuntDeath(t *testing.T, r *Room, seed int64) *Player {
	t.Helper()
	alive := make([]uint16, 0, len(r.players))
	for _, num := range sortedNums(r) {
		if p := r.players[num]; p != nil && p.bot && p.alive {
			alive = append(alive, num)
		}
	}
	if len(alive) < 2 {
		t.Fatalf("сид %d тик %d: живых ботов %d — некого свести в охоту",
			seed, r.tick, len(alive))
	}
	h := r.players[alive[0]]
	v := r.players[alive[1]]

	r.enterHunt(h, v.num, v.x, v.y, 0, 60)
	booked := r.huntersOn[v.num]
	if booked < 1 {
		t.Fatalf("сид %d тик %d: enterHunt не забронировал слот на игрока %d",
			seed, r.tick, v.num)
	}
	// Причина «wall» с killer=0: только она проходит сквозь послереспавновый
	// иммунитет, а бот мог родиться минуту назад.
	r.killPlayerWithReason(h.num, 0, "wall", -1, h.x, h.y)
	if h.alive {
		t.Fatalf("сид %d тик %d: бот %d пережил принудительную смерть", seed, r.tick, h.num)
	}
	if h.aiHuntWho != 0 {
		t.Fatalf("сид %d тик %d: мёртвый охотник %d всё ещё числится за жертвой %d",
			seed, r.tick, h.num, h.aiHuntWho)
	}
	if got := r.huntersOn[v.num]; got != booked-1 {
		t.Fatalf("сид %d тик %d: после смерти охотника на игрока %d забронировано %d, ожидалось %d",
			seed, r.tick, v.num, got, booked-1)
	}
	return v
}

// Ловит: расхождение забронированного счётчика huntersOn с фактическим
// состоянием ботов. Именно этот счётчик решает, пустят ли следующего бота в
// атаку; если он «залипнет» на потолке (охотник умер, жертва умерла, бот снят
// с поля — а слот не вернулся), агрессия ботов молча выключится до конца
// матча, и заметить это без сверки нельзя. Эталон считается здесь же, а не
// вызовом recomputeHuntersLocked: тест не должен верить проверяемому коду.
//
// Сверка идёт на каждом тике длинного прогона, а смерть охотника и смерть
// жертвы — те два перехода, ради которых тест и написан, — устраиваются
// принудительно на фиксированных тиках. Полагаться на то, что симуляция сама
// кого-нибудь убьёт, нельзя: см. forceHuntDeath.
func TestBotScenarioHunterCensusMatchesState(t *testing.T) {
	skipLongScenario(t)
	for _, seed := range scenarioSeeds {
		r := newBotScenarioRoom(t, seed)

		const ticks = 500
		// Тики принудительных смертей: начало, середина и конец прогона, чтобы
		// проверка попадала и на разогретую комнату с уже занятыми слотами.
		probes := map[int]bool{100: true, 250: true, 400: true}

		checkCensus := func(stage string) {
			t.Helper()
			want := huntCensus(r)
			for victim, n := range r.huntersOn {
				if n != want[victim] {
					t.Fatalf("сид %d тик %d (%s): huntersOn[%d]=%d, фактически охотятся %d",
						seed, r.tick, stage, victim, n, want[victim])
				}
			}
			for victim, n := range want {
				if r.huntersOn[victim] != n {
					t.Fatalf("сид %d тик %d (%s): на игрока %d охотятся %d ботов, но забронировано %d",
						seed, r.tick, stage, victim, n, r.huntersOn[victim])
				}
			}
		}

		deaths := 0
		alivePrev := make(map[uint16]bool, len(r.players))
		for _, num := range sortedNums(r) {
			alivePrev[num] = r.players[num].alive
		}
		for tk := 0; tk < ticks; tk++ {
			r.step()
			for _, num := range sortedNums(r) {
				p := r.players[num]
				if alivePrev[num] && !p.alive {
					deaths++
				}
				alivePrev[num] = p.alive
			}
			checkCensus("шаг")
			if !probes[tk] {
				continue
			}
			// Смерть охотника: слот обязан вернуться сразу.
			victim := forceHuntDeath(t, r, seed)
			checkCensus("смерть охотника")
			// Смерть жертвы: слоты её охотников снимаются не мгновенно, но учёт
			// обязан сходиться и здесь.
			r.killPlayerWithReason(victim.num, 0, "wall", -1, victim.x, victim.y)
			checkCensus("смерть жертвы")
			alivePrev[victim.num] = false
		}
		t.Logf("сид %d: смертей замечено %d, принудительных пар %d",
			seed, deaths, len(probes))
	}
}

// Живой матч потолок охотников почти не задевает: даже в комнате из 14
// агрессоров тира hard одновременно на одну жертву выходит 2-3 бота (см.
// раздел «находки» в отчёте). Поэтому сам потолок проверяется отдельно и
// детерминированно — иначе его снятие не краснит ничего.
//
// Ловит: снятие проверки потолка в canHunt и потерю брони/возврата слота в
// enterHunt/releaseHunt. Без потолка на жертву сваливается вся комната.
func TestBotHuntCapGate(t *testing.T) {
	skipLongScenario(t)
	for _, victimIsBot := range []bool{true, false} {
		r := newRulesRoom(t, 20240)
		victim := &Player{num: 1, alive: true, bot: victimIsBot, x: 100, y: 70, aiCoolCell: -1}
		r.players[1] = victim
		cap := huntCapFor(victim)
		if cap <= 0 {
			t.Fatalf("потолок охотников для bot=%t равен %d", victimIsBot, cap)
		}

		hunters := make([]*Player, 0, cap+2)
		for k := 0; k < cap+2; k++ {
			h := &Player{
				num: uint16(2 + k), alive: true, bot: true,
				x: 100, y: 71 + k, homeX: 100, homeY: 71 + k,
				aiCoolCell: -1, aiTargetX: -1, aiTargetY: -1,
			}
			r.applyBotPersonality(h, TierHard, ArchAggressor)
			r.players[h.num] = h
			hunters = append(hunters, h)
		}

		for k, h := range hunters {
			allowed := r.canHunt(h, victim, victim.x, victim.y, 1)
			if k < cap && !allowed {
				t.Fatalf("bot=%t: охотнику %d отказано при %d занятых слотах из %d",
					victimIsBot, h.num, k, cap)
			}
			if k >= cap && allowed {
				t.Fatalf("bot=%t: охотник %d пущен сверх потолка %d", victimIsBot, h.num, cap)
			}
			if !allowed {
				continue
			}
			r.enterHunt(h, victim.num, victim.x, victim.y, 0, 30)
		}
		if r.huntersOn[victim.num] != cap {
			t.Fatalf("bot=%t: забронировано %d слотов, ожидалось %d",
				victimIsBot, r.huntersOn[victim.num], cap)
		}
		if got := huntCensus(r)[victim.num]; got != cap {
			t.Fatalf("bot=%t: фактически охотятся %d ботов, ожидалось %d", victimIsBot, got, cap)
		}

		// Освобождение слота обязано снова пускать в атаку.
		r.leaveHunt(hunters[0])
		if r.huntersOn[victim.num] != cap-1 {
			t.Fatalf("bot=%t: после выхода охотника забронировано %d, ожидалось %d",
				victimIsBot, r.huntersOn[victim.num], cap-1)
		}
		last := hunters[len(hunters)-1]
		if !r.canHunt(last, victim, victim.x, victim.y, 1) {
			t.Fatalf("bot=%t: освободившийся слот охоты не отдан следующему боту", victimIsBot)
		}
	}
}

// ---------------------------------------------------------------------------
// 5. Живучесть
// ---------------------------------------------------------------------------

// Ловит:
//   - вымирание: если эвристика начнёт заводить ботов в стены или в свои
//     следы, комната опустеет. На эталонном прогоне живыми остаются 11-14 из
//     14, порог 40% ловит обвал, но не реагирует на перебалансировку;
//   - полный паралич: если боты перестанут захватывать, суммарная территория
//     останется нулевой;
//   - зацикливание. Антизацикливание (inPositionCycle) ловит периоды 2/4/6;
//     если оно отключится, бот будет наматывать один и тот же микро-круг.
//     На эталоне каждый бот за 900 тиков видит 600+ разных клеток, порог 120
//     недостижим ни для какого цикла длиной 6.
func TestBotScenarioBotsStayAliveAndProductive(t *testing.T) {
	skipLongScenario(t)
	for _, seed := range scenarioSeeds {
		r := newBotScenarioRoom(t, seed)

		const ticks = 900
		minAliveAllowed := (len(r.players)*2 + 4) / 5 // 40%
		visited := make(map[uint16]map[int]struct{}, len(r.players))
		for _, num := range sortedNums(r) {
			visited[num] = make(map[int]struct{}, 512)
		}
		minAlive := len(r.players) + 1
		for tk := 0; tk < ticks; tk++ {
			r.step()
			alive := 0
			for _, num := range sortedNums(r) {
				p := r.players[num]
				if !p.alive {
					continue
				}
				alive++
				visited[num][r.idx(p.x, p.y)] = struct{}{}
			}
			if alive < minAlive {
				minAlive = alive
			}
			if alive < minAliveAllowed {
				t.Fatalf("сид %d тик %d: живых ботов %d из %d — комната вымирает",
					seed, r.tick, alive, len(r.players))
			}
		}

		totalOwned := 0
		for _, num := range sortedNums(r) {
			totalOwned += len(r.players[num].owned)
			if n := len(visited[num]); n < 120 {
				t.Fatalf("сид %d: бот %d за %d тиков посетил всего %d разных клеток — он зациклился",
					seed, num, ticks, n)
			}
		}
		// Спавн сам по себе даёт каждому боту 3x3, поэтому «ноль» — слишком
		// слабый порог: он проходит даже если боты вообще не замыкают петли.
		// На эталоне за 900 тиков комната держит 10-19 тысяч клеток, спавны
		// дают 126 — порог 1000 оставляет десятикратный запас в обе стороны.
		if totalOwned < 1000 {
			t.Fatalf("сид %d: за %d тиков боты удержали всего %d клеток — они не замыкают петли",
				seed, ticks, totalOwned)
		}
		t.Logf("сид %d: минимум живых %d/%d, территории %d клеток",
			seed, minAlive, len(r.players), totalOwned)
	}
}

// ---------------------------------------------------------------------------
// 6. Популяция ботов при входе и выходе людей
// ---------------------------------------------------------------------------

// Ловит:
//   - отвязку фактической популяции от desiredBotCount (G7): полная комната
//     превращается в толпу, пустая — в пустыню;
//   - грязное удаление бота: снятый с поля бот обязан унести с собой всю свою
//     территорию и след, иначе на карте остаются клетки несуществующего
//     игрока, а вместе с ними и забронированный слот охоты на него.
func TestBotScenarioPopulationFollowsHumans(t *testing.T) {
	skipLongScenario(t)
	for _, seed := range scenarioSeeds[:2] {
		r := newBotScenarioRoom(t, seed)

		check := func(stage string) {
			t.Helper()
			bots := 0
			for _, num := range sortedNums(r) {
				if r.players[num].bot {
					bots++
				}
			}
			if want := desiredBotCount(r.humanCount); bots != want {
				t.Fatalf("сид %d %s: людей %d, ботов %d, ожидалось %d",
					seed, stage, r.humanCount, bots, want)
			}
			for i := 0; i < N; i++ {
				if o := r.gridOwner[i]; o != 0 && r.players[o] == nil {
					t.Fatalf("сид %d %s: клетка %d осталась за удалённым игроком %d",
						seed, stage, i, o)
				}
				if o := r.trailOwner[i]; o != 0 && r.players[o] == nil {
					t.Fatalf("сид %d %s: след в клетке %d остался за удалённым игроком %d",
						seed, stage, i, o)
				}
			}
			for victim := range r.huntersOn {
				if r.players[victim] == nil {
					t.Fatalf("сид %d %s: остался слот охоты на удалённого игрока %d",
						seed, stage, victim)
				}
			}
		}

		for tk := 0; tk < 200; tk++ {
			r.step()
		}
		botsAt := make(map[int]int, 8)
		countBots := func() int {
			n := 0
			for _, num := range sortedNums(r) {
				if r.players[num].bot {
					n++
				}
			}
			return n
		}
		// Комната собрана на 14 ботов (humanCount=0); привести её к одному
		// человеку, иначе точка отсчёта не с той кривой.
		r.syncBotPopulationLocked()
		botsAt[1] = countBots()
		// Люди заходят по одному.
		for humans := 2; humans <= 8; humans++ {
			r.humanCount = humans
			r.syncBotPopulationLocked()
			for tk := 0; tk < 30; tk++ {
				r.step()
			}
			check("вход людей")
			botsAt[humans] = countBots()
		}
		// И уходят.
		for humans := 7; humans >= 1; humans-- {
			r.humanCount = humans
			r.syncBotPopulationLocked()
			for tk := 0; tk < 30; tk++ {
				r.step()
			}
			check("выход людей")
			if got := countBots(); got != botsAt[humans] {
				t.Fatalf("сид %d: на %d людях при входе было %d ботов, при выходе %d — популяция зависит от истории",
					seed, humans, botsAt[humans], got)
			}
		}

		// Сама зависимость, а не только совпадение с desiredBotCount: комната
		// обязана прореживаться по мере заполнения людьми и никогда не падать
		// ниже пола. Без этого «desiredBotCount вернул константу» не краснит
		// ничего — тест сверялся бы со сломанной функцией.
		for humans := 2; humans <= 8; humans++ {
			if botsAt[humans] > botsAt[humans-1] {
				t.Fatalf("сид %d: на %d людях ботов %d, а на %d было %d — популяция растёт",
					seed, humans, botsAt[humans], humans-1, botsAt[humans-1])
			}
			if botsAt[humans] < BotCountMin {
				t.Fatalf("сид %d: на %d людях ботов %d, ниже пола %d",
					seed, humans, botsAt[humans], BotCountMin)
			}
		}
		if botsAt[8] >= botsAt[1] {
			t.Fatalf("сид %d: полная комната (%d ботов на 8 людях) не прорежена относительно почти пустой (%d на 1)",
				seed, botsAt[8], botsAt[1])
		}
	}
}

// ---------------------------------------------------------------------------
// 7. Состав комнаты и параметры тиров
// ---------------------------------------------------------------------------

// Ловит:
//   - расхождение фактического состава комнаты с заявленными смесями
//     tierMix (5 easy / 6 normal / 3 hard) и archMix (3/5/3/3). Смесь — это
//     продуктовое обещание «в матче встречаются и слабаки, и реальная
//     угроза», и она не должна зависеть от порядка создания ботов;
//   - выход параметров тира за объявленные в комментариях к коду диапазоны:
//     кулдаун решения, глубина предсказания, окно восприятия. Такие значения
//     ничего не роняют — они просто стирают разницу между лёгким и тяжёлым
//     ботом, и заметить это без теста нельзя.
func TestBotScenarioRoomCompositionAndTierParams(t *testing.T) {
	skipLongScenario(t)
	for _, seed := range scenarioSeeds {
		r := newBotScenarioRoom(t, seed)

		tiers, archs, bots := r.botMixCountsLocked()
		if bots != BotCount {
			t.Fatalf("сид %d: ботов %d, ожидалось %d", seed, bots, BotCount)
		}
		wantTiers := mixTargets(tierMix[:], BotCount)
		wantArchs := mixTargets(archMix[:], BotCount)
		for i := range wantTiers {
			if tiers[i] != wantTiers[i] {
				t.Fatalf("сид %d: тиров %v, ожидалось %v", seed, tiers, wantTiers)
			}
		}
		for i := range wantArchs {
			if archs[i] != wantArchs[i] {
				t.Fatalf("сид %d: архетипов %v, ожидалось %v", seed, archs, wantArchs)
			}
		}

		for _, num := range sortedNums(r) {
			p := r.players[num]
			var loCool, hiCool, minDepth, maxDepth uint8
			var wantROIW, wantROIH int
			switch p.aiTier {
			case TierEasy:
				loCool, hiCool = 6, 9
				minDepth, maxDepth = 1, 1
				wantROIW, wantROIH = 48, 34
			case TierNormal:
				loCool, hiCool = 3, 5
				minDepth, maxDepth = 1, 2
				wantROIW, wantROIH = ROIWidth, ROIHeight
			case TierHard:
				loCool, hiCool = 2, 2
				minDepth, maxDepth = 2, 3
				wantROIW, wantROIH = ROIWidth, ROIHeight
			default:
				t.Fatalf("сид %d: бот %d получил неизвестный тир %d", seed, num, p.aiTier)
			}
			if p.aiCooldownMin != loCool || p.aiCooldownMax != hiCool {
				t.Fatalf("сид %d: бот %d тир %d имеет кулдаун %d..%d, ожидалось %d..%d",
					seed, num, p.aiTier, p.aiCooldownMin, p.aiCooldownMax, loCool, hiCool)
			}
			if p.aiPredictDepth < minDepth || p.aiPredictDepth > maxDepth {
				t.Fatalf("сид %d: бот %d тир %d имеет глубину предсказания %d вне %d..%d",
					seed, num, p.aiTier, p.aiPredictDepth, minDepth, maxDepth)
			}
			if p.aiROIW != wantROIW || p.aiROIH != wantROIH {
				t.Fatalf("сид %d: бот %d тир %d имеет ROI %dx%d, ожидалось %dx%d",
					seed, num, p.aiTier, p.aiROIW, p.aiROIH, wantROIW, wantROIH)
			}
			// Тяжёлый бот обязан думать не медленнее лёгкого и видеть не меньше.
			if p.aiTier == TierHard && p.aiCooldownMax > 2 {
				t.Fatalf("сид %d: бот %d тира hard реагирует за %d тиков", seed, num, p.aiCooldownMax)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 8. Архетипы различимы снаружи
// ---------------------------------------------------------------------------

// Ловит: схлопывание заявленного различия архетипов — «Фермер» наматывает
// заметно более длинные петли, чем «Агрессор». Это ровно то, ради чего
// Фермеру дали отдельные BotTrailBudgetCapFarmer и BotCloseFracFarmer (S4);
// если любой из этих двух путей отвалится, разница исчезнет.
//
// Проверка статистическая и по длинному прогону: на одном захвате разницы
// нет, а порядок обхода r.players в Go случаен. На эталоне Фермер даёт 32-41
// клетки на петлю против 22-24 у Агрессора; требуется превосходство хотя бы
// на 15%, что переживает любую разумную перебалансировку.
func TestBotScenarioFarmerLoopsLongerThanAggressor(t *testing.T) {
	skipLongScenario(t)
	sum := make([]int, ArchCount)
	cnt := make([]int, ArchCount)

	for _, seed := range scenarioSeeds {
		r := newBotScenarioRoom(t, seed)
		prevTrail := make(map[uint16]int, len(r.players))

		const ticks = 900
		for tk := 0; tk < ticks; tk++ {
			r.step()
			for _, num := range sortedNums(r) {
				p := r.players[num]
				cur := len(p.trail)
				// Петля закрылась: след был, стал пустым. Смерть тоже обнуляет
				// след, но она бьёт по обоим архетипам и не переворачивает знак.
				if cur == 0 && prevTrail[num] > 0 && p.aiArchetype < ArchCount {
					sum[p.aiArchetype] += prevTrail[num]
					cnt[p.aiArchetype]++
				}
				prevTrail[num] = cur
			}
		}
	}

	for a := 0; a < int(ArchCount); a++ {
		if cnt[a] < 30 {
			t.Fatalf("архетип %d закрыл всего %d петель — выборки не хватает", a, cnt[a])
		}
	}
	farmer := float64(sum[ArchFarmer]) / float64(cnt[ArchFarmer])
	aggr := float64(sum[ArchAggressor]) / float64(cnt[ArchAggressor])
	t.Logf("средняя петля: фермер %.1f (n=%d), агрессор %.1f (n=%d)",
		farmer, cnt[ArchFarmer], aggr, cnt[ArchAggressor])
	if farmer < aggr*1.15 {
		t.Fatalf("петли фермера (%.1f) не длиннее петель агрессора (%.1f) хотя бы на 15%% — архетипы неразличимы",
			farmer, aggr)
	}
}

// ---------------------------------------------------------------------------
// 9. Сброс матча
// ---------------------------------------------------------------------------

// Ловит: незачищенное состояние на границе матчей. После сброса на карте не
// должно остаться ни чужой территории, ни следов, ни забронированных слотов
// охоты, а счёт обязан сойтись со свежими 3x3 спавнами. Утечка слота охоты
// здесь особенно неприятна: она переживает весь следующий матч.
func TestBotScenarioMatchResetClearsBotState(t *testing.T) {
	skipLongScenario(t)
	for _, seed := range scenarioSeeds[:2] {
		r := newBotScenarioRoom(t, seed)
		// Короткий матч вместо MatchDurationTicks: тест не должен быть медленным.
		r.matchEndTick = r.tick + 250
		seq := r.matchSeq

		for tk := 0; tk < 250+int(MatchIntermissionTicks)+5; tk++ {
			r.step()
			if r.matchSeq != seq {
				break
			}
		}
		if r.matchSeq == seq {
			t.Fatalf("сид %d: матч так и не перезапустился за отведённые тики", seed)
		}
		if r.matchEnded {
			t.Fatalf("сид %d: после сброса матч всё ещё помечен завершённым", seed)
		}
		if len(r.huntersOn) != 0 {
			t.Fatalf("сид %d: после сброса осталось %d записей об охоте", seed, len(r.huntersOn))
		}

		ownedTotal := 0
		for _, num := range sortedNums(r) {
			p := r.players[num]
			if len(p.trail) != 0 {
				t.Fatalf("сид %d: после сброса у бота %d остался след из %d клеток",
					seed, num, len(p.trail))
			}
			if p.aiHuntWho != 0 {
				t.Fatalf("сид %d: после сброса бот %d всё ещё числится охотником на %d",
					seed, num, p.aiHuntWho)
			}
			if int(r.scores[num]) != len(p.owned) {
				t.Fatalf("сид %d: после сброса у бота %d scores=%d, owned=%d",
					seed, num, r.scores[num], len(p.owned))
			}
			ownedTotal += len(p.owned)
		}
		mapTotal := 0
		trailTotal := 0
		for i := 0; i < N; i++ {
			if r.gridOwner[i] != 0 {
				mapTotal++
			}
			if r.trailOwner[i] != 0 {
				trailTotal++
			}
		}
		if trailTotal != 0 {
			t.Fatalf("сид %d: после сброса на карте осталось %d клеток следа", seed, trailTotal)
		}
		if mapTotal != ownedTotal {
			t.Fatalf("сид %d: после сброса на карте занято %d клеток, у игроков %d",
				seed, mapTotal, ownedTotal)
		}
	}
}
