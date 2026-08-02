package main

import (
	"fmt"
	"os"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Бенчмарк флота комнат и сторож бюджета тика.
//
// Что меряем и почему именно это. В проде каждая комната живёт своей горутиной
// и обязана отработать r.step() за TickMS (100 мс). Сервер держит до
// maxRoomsLimit комнат одновременно, в каждой BotCount ботов, и весь ИИ,
// заливка территории и сериализация снапшота выполняются внутри тика. Значит
// осмысленная единица измерения — «один тик всего флота»: столько работы
// сервер обязан успевать делать каждые 100 мс.
//
// Почему бенчмарк и сторож лежат вместе. go test не проваливает бенчмарки по
// порогу — их вывод надо читать глазами. Поэтому рядом стоит обычный тест
// TestRoomFleetStepBudget: он гоняет тот же код и падает, если тик вылез за
// бюджет. Бенчмарк отвечает на вопрос «сколько именно», тест — на вопрос «не
// стало ли хуже».
//
// ВНИМАНИЕ ПРО ПАМЯТЬ. В проекте есть незакрытая утечка при прогоне r.step()
// на комнате без клиентов (см. заголовок bot_scenario_test.go: тестовый
// процесс добирал до 45 ГБ и валил машину). Пока причина не найдена, все
// прогоны здесь ограничены и сверху накрыты предохранителем fleetMemGuard: он
// валит тест с понятным сообщением, а не даёт съесть всю ОЗУ.
// ---------------------------------------------------------------------------

const (
	// benchFleetTicks — сколько тиков крутит сторож. 30 тиков это 3 секунды
	// игрового времени: достаточно, чтобы боты разъехались со спавна и начали
	// резать территорию, и достаточно мало, чтобы прогон был секундным.
	benchFleetTicks = 30

	// roomStepBudget — потолок среднего времени ОДНОГО тика ОДНОЙ комнаты.
	// В проде это жёсткая граница: комната тикает раз в TickMS, и если step()
	// не укладывается, комната отстаёт и копит задержку. Порог взят с большим
	// запасом относительно замеренного порядка (~1 мс на комнату с 14 ботами),
	// чтобы ловить настоящие регрессии, а не дрожание CI. Переопределяется
	// через SNAKES_STEP_BUDGET_MS.
	roomStepBudgetMS = 10

	// fleetMemGuardMB — предохранитель. Прогон 100 комнат стоит примерно
	// 100 * 0.9 МБ массивов поля; всё, что сильно выше, означает утечку.
	fleetMemGuardMB = 1536
)

// fleetSizes — размеры флота для бенчмарка. 1 — стоимость одной комнаты,
// 10 — типичная нагрузка, 100 — потолок maxRoomsLimit.
var fleetSizes = []int{1, 10, 100}

// newBenchFleet собирает флот независимых комнат с полным штатом ботов.
//
// humanCount выставляется ПОСЛЕ расстановки ботов: r.step() досрочно выходит
// из комнаты без людей, и без этого бенчмарк мерил бы пустой вызов. Клиентов
// не добавляем сознательно — иначе в замер попадёт сериализация в сокет,
// которой в проде занимается отдельная горутина записи.
func newBenchFleet(tb testing.TB, rooms int, seed0 int64) []*Room {
	tb.Helper()
	fleet := make([]*Room, 0, rooms)
	for i := 0; i < rooms; i++ {
		r := newRulesRoom(tb, seed0+int64(i))
		r.id = i + 1
		r.nextPowerUpID = 1
		r.syncBotPopulationLocked()
		if len(r.players) != BotCount {
			tb.Fatalf("комната %d: ботов %d, ожидалось %d", i, len(r.players), BotCount)
		}
		r.humanCount = 1
		fleet = append(fleet, r)
	}
	return fleet
}

// stepFleet прогоняет один тик по всему флоту.
func stepFleet(fleet []*Room) {
	for _, r := range fleet {
		r.step()
	}
}

// heapMB возвращает текущий размер кучи в мегабайтах.
func heapMB() float64 {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return float64(ms.HeapAlloc) / (1024 * 1024)
}

// fleetMemGuard валит прогон, если куча вышла за предохранитель. Вызывается
// каждый тик: утечка в step() растёт линейно, и поймать её надо до того, как
// машина уйдёт в своп.
func fleetMemGuard(tb testing.TB, rooms, tick int) {
	tb.Helper()
	if mb := heapMB(); mb > fleetMemGuardMB {
		tb.Fatalf(
			"куча %.0f МБ на %d комнат, тик %d — превышен предохранитель %d МБ.\n"+
				"Это утечка в r.step(): комнаты и боты фиксированного размера, "+
				"расти тут нечему. Снимите профиль: go test -run TestRoomFleetStepBudget -memprofile heap.out",
			mb, rooms, tick, fleetMemGuardMB,
		)
	}
}

// ---------------------------------------------------------------------------
// Бенчмарк
// ---------------------------------------------------------------------------

// BenchmarkRoomFleetStep меряет один тик флота из 1/10/100 комнат.
//
// Один b.N — это один тик ВСЕГО флота, то есть ровно та работа, которую сервер
// обязан успеть за TickMS. Отсюда и производные метрики: ms/tick сравнивается
// с бюджетом 100 мс напрямую, а us/room/tick показывает, масштабируется ли
// стоимость линейно по числу комнат.
//
//	go test -run '^$' -bench BenchmarkRoomFleetStep -benchmem
func BenchmarkRoomFleetStep(b *testing.B) {
	for _, rooms := range fleetSizes {
		b.Run(fmt.Sprintf("rooms=%d", rooms), func(b *testing.B) {
			fleet := newBenchFleet(b, rooms, 1)
			// Прогреваем: на первых тиках боты ещё стоят на спавне, ветки ИИ
			// холодные, и первый тик заметно дешевле установившегося режима.
			for i := 0; i < 5; i++ {
				stepFleet(fleet)
			}

			b.ReportAllocs()
			b.ResetTimer()
			start := time.Now()
			for i := 0; i < b.N; i++ {
				stepFleet(fleet)
			}
			b.StopTimer()

			elapsed := time.Since(start)
			perTick := elapsed / time.Duration(maxInt(1, b.N))
			b.ReportMetric(float64(perTick.Microseconds())/1000.0, "ms/tick")
			b.ReportMetric(float64(perTick.Microseconds())/float64(rooms), "us/room/tick")
			// Доля бюджета TickMS, съеденная одним тиком флота. >100 означает,
			// что сервер такой флот не тянет.
			b.ReportMetric(float64(perTick.Microseconds())/(float64(TickMS)*1000.0)*100.0, "pctOfTick")
		})
	}
}

// BenchmarkRoomStepSingle меряет стоимость тика одной комнаты в отрыве от
// флота — по этой цифре выставлен roomStepBudgetMS.
//
//	go test -run '^$' -bench BenchmarkRoomStepSingle -benchmem
func BenchmarkRoomStepSingle(b *testing.B) {
	fleet := newBenchFleet(b, 1, 1)
	for i := 0; i < 5; i++ {
		stepFleet(fleet)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		fleet[0].step()
	}
}

// ---------------------------------------------------------------------------
// Сторож бюджета
// ---------------------------------------------------------------------------

// stepBudget возвращает бюджет одного тика одной комнаты. На медленной или
// перегруженной машине его можно поднять через SNAKES_STEP_BUDGET_MS, не трогая
// код: цель теста — ловить регрессии в разы, а не мерить абсолютную скорость.
func stepBudget(tb testing.TB) time.Duration {
	tb.Helper()
	if v := os.Getenv("SNAKES_STEP_BUDGET_MS"); v != "" {
		ms, err := strconv.Atoi(v)
		if err != nil || ms <= 0 {
			tb.Fatalf("SNAKES_STEP_BUDGET_MS=%q — ожидалось положительное число мс", v)
		}
		return time.Duration(ms) * time.Millisecond
	}
	return roomStepBudgetMS * time.Millisecond
}

// TestRoomFleetStepBudget — сторож: тик комнаты обязан укладываться в бюджет
// при любом размере флота, а память не должна расти от числа тиков.
//
// Что именно ловится:
//  1. Регрессия производительности в step()/botStep()/capture() — например
//     возврат O(N) прохода по всему полю на каждый захват или снятие троттлинга
//     дорогого поиска у ботов.
//  2. Утечка памяти в step(): комнаты и боты фиксированного размера, поэтому
//     рост кучи между началом и концом прогона означает, что что-то копится
//     от тика к тику.
//
// Тест сознательно НЕ проверяет абсолютную скорость: пороги взяты с запасом в
// порядок, чтобы не падать от шума CI.
func TestRoomFleetStepBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("длительный прогон флота: пропущен в -short")
	}

	budget := stepBudget(t)

	for _, rooms := range fleetSizes {
		rooms := rooms
		t.Run(fmt.Sprintf("rooms=%d", rooms), func(t *testing.T) {
			fleet := newBenchFleet(t, rooms, 1)

			// Прогрев не входит в замер: см. комментарий в бенчмарке.
			for i := 0; i < 5; i++ {
				stepFleet(fleet)
				fleetMemGuard(t, rooms, i)
			}

			runtime.GC()
			heapBefore := heapMB()

			start := time.Now()
			for tk := 0; tk < benchFleetTicks; tk++ {
				stepFleet(fleet)
				fleetMemGuard(t, rooms, tk)
			}
			elapsed := time.Since(start)

			perFleetTick := elapsed / benchFleetTicks
			perRoomTick := perFleetTick / time.Duration(rooms)

			runtime.GC()
			heapAfter := heapMB()
			grewMB := heapAfter - heapBefore

			t.Logf("комнат %d: тик флота %.2f мс (%.0f%% бюджета TickMS), на комнату %.3f мс, куча %.0f→%.0f МБ",
				rooms,
				float64(perFleetTick.Microseconds())/1000.0,
				float64(perFleetTick.Microseconds())/(float64(TickMS)*1000.0)*100.0,
				float64(perRoomTick.Microseconds())/1000.0,
				heapBefore, heapAfter,
			)

			if perRoomTick > budget {
				t.Fatalf(
					"тик одной комнаты занял %.2f мс при бюджете %.0f мс (флот %d комнат, %d тиков).\n"+
						"В проде комната тикает раз в %d мс — на таком времени она перестаёт успевать.\n"+
						"Смотрите профиль: go test -run '^$' -bench BenchmarkRoomFleetStep -cpuprofile cpu.out",
					float64(perRoomTick.Microseconds())/1000.0,
					float64(budget.Milliseconds()),
					rooms, benchFleetTicks, TickMS,
				)
			}

			// Рост кучи за 30 тиков на фиксированном числе комнат и ботов —
			// это утечка. Порог щедрый: пулы буферов и кэши BFS честно
			// прогреваются в первые тики, но не растут бесконечно.
			maxGrowMB := 8.0 + float64(rooms)*0.5
			if grewMB > maxGrowMB {
				t.Fatalf(
					"куча выросла на %.0f МБ за %d тиков (%d комнат) при допуске %.0f МБ — похоже на утечку в step().\n"+
						"Профиль: go test -run TestRoomFleetStepBudget -memprofile heap.out",
					grewMB, benchFleetTicks, rooms, maxGrowMB,
				)
			}
		})
	}
}
