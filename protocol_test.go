package main

import (
	"encoding/binary"
	"fmt"
	"testing"
)

// ---------------------------------------------------------------------------
// Эталонная спецификация бинарного протокола.
//
// Эти тесты — «золотой стандарт»: они фиксируют точную раскладку байтов,
// которую обязаны соблюдать и сервер, и клиент (public/client_net.js).
// Если тест упал — либо сериализатор изменился (тогда нужно синхронно
// поправить клиент), либо в сериализатор внесена регрессия.
//
// Ранее найденный баг: клиент для kind=12 (ContractComplete) читал 11 байт
// вместо 3, а обработчика kind=13 (Style) не было вовсе, из-за чего парсер
// «съезжал» и терял весь хвост пакета событий.
// ---------------------------------------------------------------------------

// eventPayloadLen — эталонная длина payload события (байт ПОСЛЕ байта kind).
var eventPayloadLen = map[uint8]int{
	EventKill:             9,  // A u16, B u16, D u8, X u16, Y u16
	EventStreak:           3,  // A u16, D u8
	EventBountyAssign:     6,  // A u16, C u32
	EventBountyClaim:      4,  // A u16, B u16
	EventPowerupSpawn:     11, // A u16, D u8, X u16, Y u16, C u32
	EventPowerupPickup:    9,  // A u16, B u16, D u8, X u16, Y u16
	EventMutatorStart:     5,  // D u8, C u32
	EventMutatorEnd:       1,  // D u8
	EventPowerupUse:       7,  // A u16, D u8, X u16, Y u16
	EventContractAssign:   9,  // A u16, D u8, B u16, C u32
	EventContractProgress: 5,  // A u16, D u8, B u16
	EventContractComplete: 3,  // A u16, D u8
	EventStyle:            9,  // A u16, B u16, C u32, D u8
	EventRevenge:          4,  // A u16, B u16
	EventDailyAssign:      9,  // A u16, D u8, B u16, C u32
	EventDailyProgress:    5,  // A u16, D u8, B u16
	EventDailyComplete:    3,  // A u16, D u8
	EventAchievement:      3,  // A u16, D u8
	EventCapture:          11, // A u16, X u16, Y u16, C u32, D u8
}

// eventsHeaderBase — размер заголовка пакета событий без списка powerup'ов
// и без u16 счётчика событий:
// type(1) + tick(4) + mutatorType(1) + mutatorUntil(4) + bountyTarget(2) + bountyUntil(4)
// + powerupCount(1)
const eventsHeaderBase = 1 + 4 + 1 + 4 + 2 + 4 + 1

// powerUpRecordLen — ID(2) + Type(1) + X(2) + Y(2) + Expires(4)
const powerUpRecordLen = 11

// roiPlayerRecordLen — num(2) x(2) y(2) dir(1) alive(1) score(2) points(2)
// hue(2) shield(1) bot(1) + 5 косметик(5)
const roiPlayerRecordLen = 21

// newTestRoom собирает минимальную комнату БЕЗ ботов, тикера и горутин.
// newRoom() запускает spawnBots() и создаёт time.Ticker, что в тестах не нужно.
func newTestRoom() *Room {
	return &Room{
		gridOwner:    make([]uint16, N),
		trailOwner:   make([]uint16, N),
		gridPos:      make([]int32, N),
		gridStamp:    make([]uint32, N),
		trailStamp:   make([]uint32, N),
		changedGrid:  make([]uint32, 0, 64),
		changedTrail: make([]uint32, 0, 64),
		minimapGrid:  make([]uint32, 0, 64),
		players:      make(map[uint16]*Player),
		clients:      make(map[*Client]struct{}),
		scores:       make(map[uint16]uint16),
		points:       make(map[uint16]uint16),
		powerUps:     make([]PowerUp, 0, 4),
		events:       make([]Event, 0, 32),
	}
}

// ---------------------------------------------------------------------------
// Эталонный ридер (написан независимо от сериализатора)
// ---------------------------------------------------------------------------

type reader struct {
	b []byte
	o int
	t *testing.T
}

func (r *reader) u8() uint8 {
	r.t.Helper()
	if r.o+1 > len(r.b) {
		r.t.Fatalf("read u8 out of range at offset %d (len %d)", r.o, len(r.b))
	}
	v := r.b[r.o]
	r.o++
	return v
}

func (r *reader) u16() uint16 {
	r.t.Helper()
	if r.o+2 > len(r.b) {
		r.t.Fatalf("read u16 out of range at offset %d (len %d)", r.o, len(r.b))
	}
	v := binary.LittleEndian.Uint16(r.b[r.o:])
	r.o += 2
	return v
}

func (r *reader) u32() uint32 {
	r.t.Helper()
	if r.o+4 > len(r.b) {
		r.t.Fatalf("read u32 out of range at offset %d (len %d)", r.o, len(r.b))
	}
	v := binary.LittleEndian.Uint32(r.b[r.o:])
	r.o += 4
	return v
}

func (r *reader) eof() bool { return r.o == len(r.b) }

// ---------------------------------------------------------------------------
// 1. Таблица эталонных длин payload для всех 19 типов событий
// ---------------------------------------------------------------------------

func TestEventPayloadLengths(t *testing.T) {
	// Событие-образец с уникальными значениями в каждом поле, чтобы поймать
	// перепутанный порядок записи.
	sample := func(kind uint8) Event {
		return Event{
			Kind: kind,
			A:    0x1122,
			B:    0x3344,
			X:    0x5566,
			Y:    0x7788,
			C:    0x99AABBCC,
			D:    0xDD,
		}
	}

	kinds := []uint8{
		EventKill, EventStreak, EventBountyAssign, EventBountyClaim,
		EventPowerupSpawn, EventPowerupPickup, EventMutatorStart, EventMutatorEnd,
		EventPowerupUse, EventContractAssign, EventContractProgress,
		EventContractComplete, EventStyle, EventRevenge, EventDailyAssign,
		EventDailyProgress, EventDailyComplete, EventAchievement, EventCapture,
	}

	if len(kinds) != 19 {
		t.Fatalf("ожидалось 19 типов событий, получено %d", len(kinds))
	}
	if len(eventPayloadLen) != 19 {
		t.Fatalf("таблица длин должна содержать 19 записей, содержит %d", len(eventPayloadLen))
	}

	for _, kind := range kinds {
		kind := kind
		t.Run(fmt.Sprintf("kind_%d", kind), func(t *testing.T) {
			r := newTestRoom()
			r.tick = 7
			ev := sample(kind)
			r.events = append(r.events, ev)

			pd := r.buildEventsPooledLocked(false)
			if pd == nil {
				t.Fatal("buildEventsPooledLocked вернул nil")
			}
			defer releasePooledData(pd)
			b := pd.b

			wantTotal := eventsHeaderBase + 2 + 1 + eventPayloadLen[kind]
			if len(b) != wantTotal {
				t.Fatalf("длина буфера = %d, ожидалось %d (payload %d)",
					len(b), wantTotal, eventPayloadLen[kind])
			}

			rd := &reader{b: b, t: t}
			if got := rd.u8(); got != MsgEventsBinary {
				t.Fatalf("тип сообщения = %d, ожидалось %d", got, MsgEventsBinary)
			}
			rd.u32() // tick
			rd.u8()  // mutatorType
			rd.u32() // mutatorUntil
			rd.u16() // bountyTarget
			rd.u32() // bountyUntil
			if n := rd.u8(); n != 0 {
				t.Fatalf("powerUps count = %d, ожидалось 0", n)
			}
			if n := rd.u16(); n != 1 {
				t.Fatalf("events count = %d, ожидалось 1", n)
			}
			if got := rd.u8(); got != kind {
				t.Fatalf("kind = %d, ожидалось %d", got, kind)
			}

			payloadStart := rd.o
			checkEventPayload(t, rd, ev)
			if got := rd.o - payloadStart; got != eventPayloadLen[kind] {
				t.Fatalf("прочитано %d байт payload, ожидалось %d", got, eventPayloadLen[kind])
			}
			if !rd.eof() {
				t.Fatalf("курсор на %d, длина буфера %d — лишние байты", rd.o, len(rd.b))
			}
		})
	}
}

// checkEventPayload — эталонный разбор payload одного события,
// написанный по спецификации, а не переиспользующий код сериализатора.
// Проверяет и порядок, и значения полей.
func checkEventPayload(t *testing.T, rd *reader, want Event) {
	t.Helper()
	eq := func(field string, got, exp any) {
		t.Helper()
		if fmt.Sprint(got) != fmt.Sprint(exp) {
			t.Fatalf("kind=%d поле %s = %v, ожидалось %v", want.Kind, field, got, exp)
		}
	}
	switch want.Kind {
	case EventKill:
		eq("A", rd.u16(), want.A)
		eq("B", rd.u16(), want.B)
		eq("D", rd.u8(), want.D)
		eq("X", rd.u16(), want.X)
		eq("Y", rd.u16(), want.Y)
	case EventStreak:
		eq("A", rd.u16(), want.A)
		eq("D", rd.u8(), want.D)
	case EventBountyAssign:
		eq("A", rd.u16(), want.A)
		eq("C", rd.u32(), want.C)
	case EventBountyClaim:
		eq("A", rd.u16(), want.A)
		eq("B", rd.u16(), want.B)
	case EventPowerupSpawn:
		eq("A", rd.u16(), want.A)
		eq("D", rd.u8(), want.D)
		eq("X", rd.u16(), want.X)
		eq("Y", rd.u16(), want.Y)
		eq("C", rd.u32(), want.C)
	case EventPowerupPickup:
		eq("A", rd.u16(), want.A)
		eq("B", rd.u16(), want.B)
		eq("D", rd.u8(), want.D)
		eq("X", rd.u16(), want.X)
		eq("Y", rd.u16(), want.Y)
	case EventPowerupUse:
		eq("A", rd.u16(), want.A)
		eq("D", rd.u8(), want.D)
		eq("X", rd.u16(), want.X)
		eq("Y", rd.u16(), want.Y)
	case EventMutatorStart:
		eq("D", rd.u8(), want.D)
		eq("C", rd.u32(), want.C)
	case EventMutatorEnd:
		eq("D", rd.u8(), want.D)
	case EventContractAssign, EventDailyAssign:
		eq("A", rd.u16(), want.A)
		eq("D", rd.u8(), want.D)
		eq("B", rd.u16(), want.B)
		eq("C", rd.u32(), want.C)
	case EventContractProgress, EventDailyProgress:
		eq("A", rd.u16(), want.A)
		eq("D", rd.u8(), want.D)
		eq("B", rd.u16(), want.B)
	case EventContractComplete, EventDailyComplete, EventAchievement:
		eq("A", rd.u16(), want.A)
		eq("D", rd.u8(), want.D)
	case EventStyle:
		eq("A", rd.u16(), want.A)
		eq("B", rd.u16(), want.B)
		eq("C", rd.u32(), want.C)
		eq("D", rd.u8(), want.D)
	case EventRevenge:
		eq("A", rd.u16(), want.A)
		eq("B", rd.u16(), want.B)
	case EventCapture:
		eq("A", rd.u16(), want.A)
		eq("X", rd.u16(), want.X)
		eq("Y", rd.u16(), want.Y)
		eq("C", rd.u32(), want.C)
		eq("D", rd.u8(), want.D)
	default:
		t.Fatalf("неизвестный kind=%d в эталонном парсере", want.Kind)
	}
}

// TestEventPayloadLengthsExactBytes проверяет побайтовое содержимое для
// нескольких событий с «говорящими» значениями — защита от перестановки
// endianness и порядка полей.
func TestEventPayloadExactBytes(t *testing.T) {
	tests := []struct {
		name string
		ev   Event
		want []byte // байты, начиная с kind
	}{
		{
			name: "ContractComplete_3_bytes",
			ev:   Event{Kind: EventContractComplete, A: 0x0102, D: 0x03},
			want: []byte{EventContractComplete, 0x02, 0x01, 0x03},
		},
		{
			name: "Style_9_bytes",
			ev:   Event{Kind: EventStyle, A: 0x0102, B: 0x0304, C: 0x05060708, D: 0x09},
			want: []byte{EventStyle, 0x02, 0x01, 0x04, 0x03, 0x08, 0x07, 0x06, 0x05, 0x09},
		},
		{
			name: "Capture_11_bytes",
			ev:   Event{Kind: EventCapture, A: 1, X: 2, Y: 3, C: 4, D: 5},
			want: []byte{EventCapture, 1, 0, 2, 0, 3, 0, 4, 0, 0, 0, 5},
		},
		{
			name: "MutatorEnd_1_byte",
			ev:   Event{Kind: EventMutatorEnd, D: 0x7F},
			want: []byte{EventMutatorEnd, 0x7F},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := newTestRoom()
			r.events = append(r.events, tc.ev)
			pd := r.buildEventsPooledLocked(false)
			if pd == nil {
				t.Fatal("nil pooledData")
			}
			defer releasePooledData(pd)

			off := eventsHeaderBase + 2
			got := pd.b[off:]
			if len(got) != len(tc.want) {
				t.Fatalf("len=%d, ожидалось %d (%v)", len(got), len(tc.want), got)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Fatalf("байт %d = 0x%02X, ожидалось 0x%02X\nполучено %v\nожидалось %v",
						i, got[i], tc.want[i], got, tc.want)
				}
			}
		})
	}
}

// TestEventUnknownKindFallback фиксирует поведение default-ветки:
// неизвестный kind пишет ровно 1 нулевой байт payload.
func TestEventUnknownKindFallback(t *testing.T) {
	r := newTestRoom()
	r.events = append(r.events, Event{Kind: 200, A: 1, B: 2, C: 3, D: 4})
	pd := r.buildEventsPooledLocked(false)
	if pd == nil {
		t.Fatal("nil pooledData")
	}
	defer releasePooledData(pd)

	off := eventsHeaderBase + 2
	got := pd.b[off:]
	want := []byte{200, 0}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("fallback payload = %v, ожидалось %v", got, want)
	}
}

// ---------------------------------------------------------------------------
// 2. Round-trip пакета из разнотипных событий
// ---------------------------------------------------------------------------

func TestEventsPacketRoundTrip(t *testing.T) {
	events := []Event{
		{Kind: EventKill, A: 3, B: 7, D: 2, X: 10, Y: 20},
		{Kind: EventContractComplete, A: 3, D: 1},            // раньше клиент читал 11 байт вместо 3
		{Kind: EventStyle, A: 3, B: 5, C: 120, D: StyleKill}, // раньше обработчика не было
		{Kind: EventStreak, A: 3, D: 4},
		{Kind: EventPowerupSpawn, A: 42, D: PowerupShield, X: 1, Y: 2, C: 900},
		{Kind: EventMutatorStart, D: 1, C: 1234},
		{Kind: EventCapture, A: 3, X: 11, Y: 12, C: 55, D: 1},
		{Kind: EventDailyProgress, A: 3, D: 2, B: 9},
		{Kind: EventAchievement, A: 3, D: 6},
		{Kind: EventMutatorEnd, D: 1},
		{Kind: EventRevenge, A: 3, B: 7},
		{Kind: EventBountyAssign, A: 7, C: 3000},
		{Kind: EventBountyClaim, A: 3, B: 7},
		{Kind: EventPowerupPickup, A: 42, B: 3, D: PowerupShield, X: 1, Y: 2},
		{Kind: EventPowerupUse, A: 3, D: PowerupDash, X: 5, Y: 6},
		{Kind: EventContractAssign, A: 3, D: ContractKills, B: 4, C: 200},
		{Kind: EventContractProgress, A: 3, D: ContractKills, B: 2},
		{Kind: EventDailyAssign, A: 3, D: 1, B: 5, C: 100},
		{Kind: EventDailyComplete, A: 3, D: 1},
	}

	r := newTestRoom()
	r.tick = 4242
	r.mutatorType = 2
	r.mutatorUntil = 5000
	r.bountyTarget = 7
	r.bountyUntil = 6000
	r.powerUps = append(r.powerUps,
		PowerUp{ID: 1, Type: PowerupShield, X: 10, Y: 11, Expires: 900},
		PowerUp{ID: 2, Type: PowerupDash, X: 12, Y: 13, Expires: 950},
	)
	r.events = append(r.events, events...)

	pd := r.buildEventsPooledLocked(false)
	if pd == nil {
		t.Fatal("nil pooledData")
	}
	defer releasePooledData(pd)

	// Ожидаемая суммарная длина считается независимо, по таблице.
	wantLen := eventsHeaderBase + len(r.powerUps)*powerUpRecordLen + 2
	for _, e := range events {
		wantLen += 1 + eventPayloadLen[e.Kind]
	}
	if len(pd.b) != wantLen {
		t.Fatalf("длина пакета = %d, ожидалось %d", len(pd.b), wantLen)
	}

	rd := &reader{b: pd.b, t: t}
	if got := rd.u8(); got != MsgEventsBinary {
		t.Fatalf("тип = %d", got)
	}
	if got := rd.u32(); got != 4242 {
		t.Fatalf("tick = %d", got)
	}
	if got := rd.u8(); got != 2 {
		t.Fatalf("mutatorType = %d", got)
	}
	if got := rd.u32(); got != 5000 {
		t.Fatalf("mutatorUntil = %d", got)
	}
	if got := rd.u16(); got != 7 {
		t.Fatalf("bountyTarget = %d", got)
	}
	if got := rd.u32(); got != 6000 {
		t.Fatalf("bountyUntil = %d", got)
	}
	puN := int(rd.u8())
	if puN != 2 {
		t.Fatalf("powerUps count = %d", puN)
	}
	for i := 0; i < puN; i++ {
		id := rd.u16()
		typ := rd.u8()
		x := rd.u16()
		y := rd.u16()
		exp := rd.u32()
		want := r.powerUps[i]
		if id != want.ID || typ != want.Type || x != want.X || y != want.Y || exp != want.Expires {
			t.Fatalf("powerUp %d = {%d %d %d %d %d}, ожидалось %+v", i, id, typ, x, y, exp, want)
		}
	}

	evN := int(rd.u16())
	if evN != len(events) {
		t.Fatalf("events count = %d, ожидалось %d", evN, len(events))
	}
	for i := 0; i < evN; i++ {
		kind := rd.u8()
		if kind != events[i].Kind {
			t.Fatalf("событие %d: kind = %d, ожидалось %d", i, kind, events[i].Kind)
		}
		start := rd.o
		checkEventPayload(t, rd, events[i])
		if n := rd.o - start; n != eventPayloadLen[kind] {
			t.Fatalf("событие %d (kind=%d): прочитано %d, ожидалось %d",
				i, kind, n, eventPayloadLen[kind])
		}
	}

	// Главная проверка класса багов: курсор дошёл ровно до конца буфера.
	if !rd.eof() {
		t.Fatalf("курсор на %d, длина буфера %d — рассинхрон парсера/сериализатора",
			rd.o, len(rd.b))
	}

	// Побочный эффект: очередь событий очищена, metaDirty сброшен.
	if len(r.events) != 0 {
		t.Fatalf("очередь событий не очищена: %d", len(r.events))
	}
	if r.metaDirty {
		t.Fatal("metaDirty не сброшен")
	}
	if r.metaSentTick != r.tick {
		t.Fatalf("metaSentTick = %d, ожидалось %d", r.metaSentTick, r.tick)
	}
}

// ---------------------------------------------------------------------------
// 3. Заголовок пакета событий
// ---------------------------------------------------------------------------

func TestEventsHeader(t *testing.T) {
	t.Run("пустой пакет без force возвращает nil", func(t *testing.T) {
		r := newTestRoom()
		r.metaDirty = false
		if pd := r.buildEventsPooledLocked(false); pd != nil {
			releasePooledData(pd)
			t.Fatal("ожидался nil для пустой комнаты без metaDirty")
		}
	})

	t.Run("force даёт минимальный заголовок", func(t *testing.T) {
		r := newTestRoom()
		r.metaDirty = false
		r.tick = 1
		pd := r.buildEventsPooledLocked(true)
		if pd == nil {
			t.Fatal("force=true вернул nil")
		}
		defer releasePooledData(pd)
		if len(pd.b) != eventsHeaderBase+2 {
			t.Fatalf("длина = %d, ожидалось %d", len(pd.b), eventsHeaderBase+2)
		}
	})

	t.Run("metaDirty даёт пакет без событий", func(t *testing.T) {
		r := newTestRoom()
		r.metaDirty = true
		pd := r.buildEventsPooledLocked(false)
		if pd == nil {
			t.Fatal("metaDirty=true вернул nil")
		}
		defer releasePooledData(pd)
		rd := &reader{b: pd.b, t: t}
		rd.u8()
		rd.u32()
		rd.u8()
		rd.u32()
		rd.u16()
		rd.u32()
		if n := rd.u8(); n != 0 {
			t.Fatalf("powerUps = %d", n)
		}
		if n := rd.u16(); n != 0 {
			t.Fatalf("events = %d", n)
		}
		if !rd.eof() {
			t.Fatalf("хвост длиной %d", len(rd.b)-rd.o)
		}
	})

	t.Run("список powerup по 11 байт", func(t *testing.T) {
		r := newTestRoom()
		for i := 0; i < 5; i++ {
			r.powerUps = append(r.powerUps, PowerUp{
				ID: uint16(i + 1), Type: uint8(i % 4), X: uint16(i), Y: uint16(i * 2),
				Expires: uint32(1000 + i),
			})
		}
		pd := r.buildEventsPooledLocked(true)
		if pd == nil {
			t.Fatal("nil")
		}
		defer releasePooledData(pd)
		want := eventsHeaderBase + 5*powerUpRecordLen + 2
		if len(pd.b) != want {
			t.Fatalf("длина = %d, ожидалось %d", len(pd.b), want)
		}
	})
}

// ---------------------------------------------------------------------------
// 4. ROI (тип 2) и миникарта (тип 4)
// ---------------------------------------------------------------------------

func makeTestPlayer(num uint16, x, y int) *Player {
	return &Player{
		num: num, x: x, y: y, dir: DirRight, alive: true,
		hue: 120, shield: 1, bot: false,
		cosCaptureFx: 1, cosHead: 2, cosSeg: 3, cosNameplate: 4, cosFrame: 0,
	}
}

func TestROIPlayerRecordSizeAndLayout(t *testing.T) {
	r := newTestRoom()
	r.tick = 99
	p := makeTestPlayer(5, 30, 40)
	r.players[5] = p
	r.scores[5] = 111
	r.points[5] = 222

	// Fast-путь: без изменённых клеток в ROI список дельт пуст.
	pd := r.buildROIPooledFast(0, 0, 8, 8, 0, []*Player{p})
	if pd == nil {
		t.Fatal("nil pooledData")
	}
	defer releasePooledData(pd)

	wantLen := 1 + 4 + 2 + roiPlayerRecordLen*1 + 2 + 2 + 2 + 2 + 4 + 4
	if len(pd.b) != wantLen {
		t.Fatalf("длина ROI = %d, ожидалось %d", len(pd.b), wantLen)
	}

	rd := &reader{b: pd.b, t: t}
	if got := rd.u8(); got != MsgROIBinary {
		t.Fatalf("тип = %d, ожидалось %d", got, MsgROIBinary)
	}
	if got := rd.u32(); got != 99 {
		t.Fatalf("tick = %d", got)
	}
	if got := rd.u16(); got != 1 {
		t.Fatalf("plCount = %d", got)
	}

	recStart := rd.o
	if got := rd.u16(); got != 5 {
		t.Fatalf("num = %d", got)
	}
	if got := rd.u16(); got != 30 {
		t.Fatalf("x = %d", got)
	}
	if got := rd.u16(); got != 40 {
		t.Fatalf("y = %d", got)
	}
	if got := rd.u8(); got != uint8(DirRight) {
		t.Fatalf("dir = %d", got)
	}
	if got := rd.u8(); got != 1 {
		t.Fatalf("alive = %d", got)
	}
	if got := rd.u16(); got != 111 {
		t.Fatalf("score = %d", got)
	}
	if got := rd.u16(); got != 222 {
		t.Fatalf("points = %d", got)
	}
	if got := rd.u16(); got != 120 {
		t.Fatalf("hue = %d", got)
	}
	if got := rd.u8(); got != 1 {
		t.Fatalf("shield = %d", got)
	}
	if got := rd.u8(); got != 0 {
		t.Fatalf("bot = %d", got)
	}
	for i, want := range []uint8{1, 2, 3, 4, 0} {
		if got := rd.u8(); got != want {
			t.Fatalf("косметика %d = %d, ожидалось %d", i, got, want)
		}
	}
	if n := rd.o - recStart; n != roiPlayerRecordLen {
		t.Fatalf("размер записи игрока = %d, ожидалось %d", n, roiPlayerRecordLen)
	}

	if got := rd.u16(); got != 0 {
		t.Fatalf("rx = %d", got)
	}
	if got := rd.u16(); got != 0 {
		t.Fatalf("ry = %d", got)
	}
	if got := rd.u16(); got != 8 {
		t.Fatalf("rw = %d", got)
	}
	if got := rd.u16(); got != 8 {
		t.Fatalf("rh = %d", got)
	}
	if got := rd.u32(); got != 0 {
		t.Fatalf("bytesDG = %d", got)
	}
	if got := rd.u32(); got != 0 {
		t.Fatalf("bytesDT = %d", got)
	}
	if !rd.eof() {
		t.Fatalf("хвост %d байт", len(rd.b)-rd.o)
	}
}

func TestROIFastLengthMatchesChanges(t *testing.T) {
	r := newTestRoom()
	r.tick = 5

	players := []*Player{
		makeTestPlayer(1, 1, 1),
		makeTestPlayer(2, 2, 2),
		makeTestPlayer(3, 3, 3),
	}
	for _, p := range players {
		r.players[p.num] = p
	}

	// Внутри ROI (0,0,10,10)
	inGrid := []int{0, 5, 9, W + 3, 5*W + 5}
	// Снаружи ROI
	outGrid := []int{50, 20*W + 50}
	for _, i := range inGrid {
		r.changedGrid = append(r.changedGrid, packChange(uint16(i), 7))
	}
	for _, i := range outGrid {
		r.changedGrid = append(r.changedGrid, packChange(uint16(i), 7))
	}
	inTrail := []int{1, 2 * W}
	for _, i := range inTrail {
		r.changedTrail = append(r.changedTrail, packChange(uint16(i), 3))
	}
	r.changedTrail = append(r.changedTrail, packChange(uint16(30*W+80), 3))

	pd := r.buildROIPooledFast(0, 0, 10, 10, 0, players)
	if pd == nil {
		t.Fatal("nil")
	}
	defer releasePooledData(pd)

	wantLen := 1 + 4 + 2 + roiPlayerRecordLen*len(players) + 2 + 2 + 2 + 2 + 4 + 4 +
		4*len(inGrid) + 4*len(inTrail)
	if len(pd.b) != wantLen {
		t.Fatalf("длина = %d, ожидалось %d", len(pd.b), wantLen)
	}

	// bytesDG/bytesDT в заголовке должны совпадать с реальным хвостом.
	off := 1 + 4 + 2 + roiPlayerRecordLen*len(players) + 2 + 2 + 2 + 2
	bytesDG := int(binary.LittleEndian.Uint32(pd.b[off:]))
	bytesDT := int(binary.LittleEndian.Uint32(pd.b[off+4:]))
	if bytesDG != 4*len(inGrid) {
		t.Fatalf("bytesDG = %d, ожидалось %d", bytesDG, 4*len(inGrid))
	}
	if bytesDT != 4*len(inTrail) {
		t.Fatalf("bytesDT = %d, ожидалось %d", bytesDT, 4*len(inTrail))
	}
	if off+8+bytesDG+bytesDT != len(pd.b) {
		t.Fatalf("хвост не сходится: %d != %d", off+8+bytesDG+bytesDT, len(pd.b))
	}
}

func TestROIScanFullLength(t *testing.T) {
	r := newTestRoom()
	r.tick = 1
	p := makeTestPlayer(1, 0, 0)
	r.players[1] = p

	const rw, rh = 12, 9
	pd := r.buildROIPooledScan(4, 6, rw, rh, true, 0, []*Player{p})
	if pd == nil {
		t.Fatal("nil")
	}
	defer releasePooledData(pd)

	cells := rw * rh
	wantLen := 1 + 4 + 2 + roiPlayerRecordLen + 2 + 2 + 2 + 2 + 4 + 4 + 4*cells + 4*cells
	if len(pd.b) != wantLen {
		t.Fatalf("длина = %d, ожидалось %d", len(pd.b), wantLen)
	}

	// Первая дельта должна ссылаться на клетку (4,6).
	off := 1 + 4 + 2 + roiPlayerRecordLen + 2 + 2 + 2 + 2 + 4 + 4
	first := binary.LittleEndian.Uint32(pd.b[off:])
	if idx := int(first >> 16); idx != 6*W+4 {
		t.Fatalf("первая клетка = %d, ожидалось %d", idx, 6*W+4)
	}
}

func TestROIScanDeltaRespectsSinceTick(t *testing.T) {
	r := newTestRoom()
	r.tick = 20
	p := makeTestPlayer(1, 0, 0)
	r.players[1] = p

	// Только две клетки «свежее» sinceTick=10.
	r.gridStamp[2*W+2] = 15
	r.gridOwner[2*W+2] = 9
	r.trailStamp[3*W+3] = 11

	pd := r.buildROIPooledScan(0, 0, 8, 8, false, 10, []*Player{p})
	if pd == nil {
		t.Fatal("nil")
	}
	defer releasePooledData(pd)

	wantLen := 1 + 4 + 2 + roiPlayerRecordLen + 2 + 2 + 2 + 2 + 4 + 4 + 4 + 4
	if len(pd.b) != wantLen {
		t.Fatalf("длина = %d, ожидалось %d", len(pd.b), wantLen)
	}
	off := 1 + 4 + 2 + roiPlayerRecordLen + 2 + 2 + 2 + 2 + 4 + 4
	dg := binary.LittleEndian.Uint32(pd.b[off:])
	if int(dg>>16) != 2*W+2 || uint16(dg&0xFFFF) != 9 {
		t.Fatalf("gridChange = idx %d owner %d", dg>>16, dg&0xFFFF)
	}
	dt := binary.LittleEndian.Uint32(pd.b[off+4:])
	if int(dt>>16) != 3*W+3 {
		t.Fatalf("trailChange idx = %d, ожидалось %d", dt>>16, 3*W+3)
	}
}

// TestROIFastAndScanAgree: на одинаковом наборе изменений «быстрый» и
// «сканирующий» пути должны выдавать идентичный буфер.
func TestROIFastAndScanAgree(t *testing.T) {
	r := newTestRoom()
	r.tick = 33
	p := makeTestPlayer(4, 5, 5)
	r.players[4] = p
	r.scores[4] = 1
	r.points[4] = 2

	changes := []int{0, 1, 2, W, W + 1}
	for _, i := range changes {
		r.gridOwner[i] = 4
		r.gridStamp[i] = 33
		r.changedGrid = append(r.changedGrid, packChange(uint16(i), 4))
	}

	fast := r.buildROIPooledFast(0, 0, 4, 4, 32, []*Player{p})
	defer releasePooledData(fast)
	scan := r.buildROIPooledScan(0, 0, 4, 4, false, 32, []*Player{p})
	defer releasePooledData(scan)

	if len(fast.b) != len(scan.b) {
		t.Fatalf("длины расходятся: fast=%d scan=%d", len(fast.b), len(scan.b))
	}
	for i := range fast.b {
		if fast.b[i] != scan.b[i] {
			t.Fatalf("байт %d: fast=0x%02X scan=0x%02X", i, fast.b[i], scan.b[i])
		}
	}
}

func TestMinimapChunkBinary(t *testing.T) {
	const chunkCells = MinimapChunkW * MinimapChunkH
	const chunkRecord = 2 + chunkCells*2 // cx(1)+cy(1) + payload
	const minimapHeader = 1 + 4 + 1 + 1 + 2 + 1

	t.Run("full", func(t *testing.T) {
		r := newTestRoom()
		r.tick = 12
		r.gridOwner[0] = 77
		r.gridOwner[W*MinimapChunkH+MinimapChunkW] = 88 // чанк (1,1)

		b := r.buildMinimapChunkBinary(true)
		if b == nil {
			t.Fatal("nil buffer")
		}
		rd := &reader{b: b, t: t}
		if got := rd.u8(); got != MsgMinimapChunk {
			t.Fatalf("тип = %d, ожидалось %d", got, MsgMinimapChunk)
		}
		if got := rd.u32(); got != 12 {
			t.Fatalf("tick = %d", got)
		}
		if got := rd.u8(); got != MinimapChunkW {
			t.Fatalf("cw = %d", got)
		}
		if got := rd.u8(); got != MinimapChunkH {
			t.Fatalf("ch = %d", got)
		}
		count := int(rd.u16())
		if got := rd.u8(); got != 0 {
			t.Fatalf("flags = %d, ожидалось 0", got)
		}

		total := MinimapChunksX * MinimapChunksY
		wantCount := MinimapMaxChunksPerMsg
		if total < wantCount {
			wantCount = total
		}
		if count != wantCount {
			t.Fatalf("count = %d, ожидалось %d", count, wantCount)
		}
		if len(b) != minimapHeader+count*chunkRecord {
			t.Fatalf("длина = %d, ожидалось %d", len(b), minimapHeader+count*chunkRecord)
		}

		// Первый чанк — (0,0), в нём клетка 0 = 77.
		cx := rd.u8()
		cy := rd.u8()
		if cx != 0 || cy != 0 {
			t.Fatalf("первый чанк (%d,%d), ожидалось (0,0)", cx, cy)
		}
		if got := rd.u16(); got != 77 {
			t.Fatalf("клетка (0,0) = %d, ожидалось 77", got)
		}

		// Курсор должен дойти ровно до конца.
		rd.o = minimapHeader + count*chunkRecord
		if !rd.eof() {
			t.Fatalf("длина не сходится: %d vs %d", rd.o, len(b))
		}

		// Cursor двигается: full-выдача пагинируется.
		if total > MinimapMaxChunksPerMsg && r.minimapFullCursor != MinimapMaxChunksPerMsg {
			t.Fatalf("minimapFullCursor = %d, ожидалось %d", r.minimapFullCursor, MinimapMaxChunksPerMsg)
		}
	})

	t.Run("delta_empty_returns_nil", func(t *testing.T) {
		r := newTestRoom()
		if b := r.buildMinimapChunkBinary(false); b != nil {
			t.Fatalf("ожидался nil, получено %d байт", len(b))
		}
	})

	t.Run("delta_one_chunk", func(t *testing.T) {
		r := newTestRoom()
		r.tick = 3
		// Три изменения внутри одного чанка (1,0) => 1 уникальный чанк.
		for _, i := range []int{MinimapChunkW, MinimapChunkW + 1, W + MinimapChunkW} {
			r.gridOwner[i] = 5
			r.minimapGrid = append(r.minimapGrid, packChange(uint16(i), 5))
		}
		b := r.buildMinimapChunkBinary(false)
		if b == nil {
			t.Fatal("nil buffer")
		}
		count := int(binary.LittleEndian.Uint16(b[7:]))
		if count != 1 {
			t.Fatalf("count = %d, ожидалось 1", count)
		}
		if len(b) != minimapHeader+chunkRecord {
			t.Fatalf("длина = %d, ожидалось %d", len(b), minimapHeader+chunkRecord)
		}
		if b[minimapHeader] != 1 || b[minimapHeader+1] != 0 {
			t.Fatalf("чанк = (%d,%d), ожидалось (1,0)", b[minimapHeader], b[minimapHeader+1])
		}
	})
}

// ---------------------------------------------------------------------------
// 5. packChange и границы упаковки индекса
// ---------------------------------------------------------------------------

// Compile-time проверка: индекс клетки должен помещаться в uint16,
// иначе packChange молча теряет старшие биты.
const _ = uint16(W*H - 1)

func TestPackChange(t *testing.T) {
	tests := []struct {
		idx   uint16
		owner uint16
	}{
		{0, 0},
		{1, 1},
		{0xFFFF, 0xFFFF},
		{uint16(N - 1), 42},
		{uint16(3*W + 7), 1000},
	}
	for _, tc := range tests {
		v := packChange(tc.idx, tc.owner)
		if gotIdx := uint16(v >> 16); gotIdx != tc.idx {
			t.Fatalf("packChange(%d,%d): idx = %d", tc.idx, tc.owner, gotIdx)
		}
		if gotOwner := uint16(v & 0xFFFF); gotOwner != tc.owner {
			t.Fatalf("packChange(%d,%d): owner = %d", tc.idx, tc.owner, gotOwner)
		}
	}
}

// TestGridFitsInPackedIndex — защита от увеличения карты: при W*H >= 65536
// упаковка индекса в старшие 16 бит packChange ломается молча.
func TestGridFitsInPackedIndex(t *testing.T) {
	if W*H >= 65536 {
		t.Fatalf("W*H = %d >= 65536: packChange() больше не может упаковать индекс клетки "+
			"в uint16. Нужно расширить формат дельт (uint32 индекс) в buildROIPooled*/"+
			"buildMinimapChunkBinary и в клиенте.", W*H)
	}
	if N != W*H {
		t.Fatalf("N = %d, ожидалось W*H = %d", N, W*H)
	}
}

func TestAppendU16U32LE(t *testing.T) {
	b := appendU16LE(nil, 0x0102)
	if len(b) != 2 || b[0] != 0x02 || b[1] != 0x01 {
		t.Fatalf("appendU16LE = %v", b)
	}
	b = appendU32LE(nil, 0x01020304)
	if len(b) != 4 || b[0] != 0x04 || b[1] != 0x03 || b[2] != 0x02 || b[3] != 0x01 {
		t.Fatalf("appendU32LE = %v", b)
	}
}

// TestMsgTypeConstants фиксирует номера типов сообщений — клиент
// (public/client_net.js) разбирает их по первому байту.
func TestMsgTypeConstants(t *testing.T) {
	pairs := []struct {
		name string
		got  int
		want int
	}{
		{"MsgStateBinary", MsgStateBinary, 1},
		{"MsgROIBinary", MsgROIBinary, 2},
		{"MsgMinimapChunk", MsgMinimapChunk, 4},
		{"MsgEventsBinary", MsgEventsBinary, 5},
	}
	for _, p := range pairs {
		if p.got != p.want {
			t.Fatalf("%s = %d, ожидалось %d", p.name, p.got, p.want)
		}
	}
}

// TestEventConstants фиксирует номера событий.
func TestEventConstants(t *testing.T) {
	pairs := map[string][2]int{
		"Kill":             {EventKill, 1},
		"Streak":           {EventStreak, 2},
		"BountyAssign":     {EventBountyAssign, 3},
		"BountyClaim":      {EventBountyClaim, 4},
		"PowerupSpawn":     {EventPowerupSpawn, 5},
		"PowerupPickup":    {EventPowerupPickup, 6},
		"MutatorStart":     {EventMutatorStart, 7},
		"MutatorEnd":       {EventMutatorEnd, 8},
		"PowerupUse":       {EventPowerupUse, 9},
		"ContractAssign":   {EventContractAssign, 10},
		"ContractProgress": {EventContractProgress, 11},
		"ContractComplete": {EventContractComplete, 12},
		"Style":            {EventStyle, 13},
		"Revenge":          {EventRevenge, 14},
		"DailyAssign":      {EventDailyAssign, 15},
		"DailyProgress":    {EventDailyProgress, 16},
		"DailyComplete":    {EventDailyComplete, 17},
		"Achievement":      {EventAchievement, 18},
		"Capture":          {EventCapture, 19},
	}
	for name, p := range pairs {
		if p[0] != p[1] {
			t.Fatalf("Event%s = %d, ожидалось %d", name, p[0], p[1])
		}
	}
}
