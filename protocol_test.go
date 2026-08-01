package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"testing"
	"time"

	"nhooyr.io/websocket"
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
	EventReclaim:          8,  // A u16, B u16, X u16, Y u16
	EventCoolBatch:        8,  // A u16, B u16, C u32
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
		coolOwner:    make([]uint16, N),
		coolUntil:    make([]uint32, N),
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
		EventReclaim, EventCoolBatch,
	}

	if len(kinds) != 21 {
		t.Fatalf("ожидалось 21 типов событий, получено %d", len(kinds))
	}
	if len(eventPayloadLen) != 21 {
		t.Fatalf("таблица длин должна содержать 21 записей, содержит %d", len(eventPayloadLen))
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
	case EventReclaim:
		eq("A", rd.u16(), want.A)
		eq("B", rd.u16(), want.B)
		eq("X", rd.u16(), want.X)
		eq("Y", rd.u16(), want.Y)
	case EventCoolBatch:
		eq("A", rd.u16(), want.A)
		eq("B", rd.u16(), want.B)
		eq("C", rd.u32(), want.C)
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
			name: "CoolBatch_9_bytes",
			ev:   Event{Kind: EventCoolBatch, A: 0x0102, B: 0x0304, C: 0x05060708},
			want: []byte{EventCoolBatch, 0x02, 0x01, 0x04, 0x03, 0x08, 0x07, 0x06, 0x05},
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
		"Reclaim":          {EventReclaim, 20},
		"CoolBatch":        {EventCoolBatch, 21},
	}
	for name, p := range pairs {
		if p[0] != p[1] {
			t.Fatalf("Event%s = %d, ожидалось %d", name, p[0], p[1])
		}
	}
}

// ---------------------------------------------------------------------------
// F5 «Реклейм»: клетки погибшего остывают, возвращаются целой связной областью
// и окончательно исчезают по таймеру.
// ---------------------------------------------------------------------------

func TestReclaimCooldownLifecycle(t *testing.T) {
	r := newTestRoom()
	r.tick = 10
	p := &Player{num: 1, alive: true}
	r.players[1] = p

	patch := []int{100, 101, 102}
	lone := 5000
	for _, i := range append(append([]int{}, patch...), lone) {
		r.setGrid(i, 1)
	}

	r.changedGrid = r.changedGrid[:0]
	r.clearPlayerCells(1, p)

	wantWire := coolOwnerFlag | uint16(1)
	for _, i := range append(append([]int{}, patch...), lone) {
		if r.gridOwner[i] != 0 {
			t.Fatalf("клетка %d осталась во владении: %d", i, r.gridOwner[i])
		}
		if r.coolOwner[i] != 1 {
			t.Fatalf("coolOwner[%d] = %d, ожидалось 1", i, r.coolOwner[i])
		}
		if r.coolUntil[i] != r.tick+ReclaimTicks {
			t.Fatalf("coolUntil[%d] = %d, ожидалось %d", i, r.coolUntil[i], r.tick+ReclaimTicks)
		}
		if got := r.gridWireAt(i); got != wantWire {
			t.Fatalf("gridWireAt(%d) = %#x, ожидалось %#x", i, got, wantWire)
		}
	}
	// На смерти каждая клетка даёт РОВНО одну дельту — уже с меткой остывания.
	if len(r.changedGrid) != 4 {
		t.Fatalf("дельт после смерти = %d, ожидалось 4", len(r.changedGrid))
	}
	for _, ch := range r.changedGrid {
		if uint16(ch&0xFFFF) != wantWire {
			t.Fatalf("дельта %#x несёт владельца %#x, ожидалось %#x", ch, ch&0xFFFF, wantWire)
		}
	}

	if n := r.reclaimCoolRegion(p, 101); n != len(patch) {
		t.Fatalf("возвращено клеток = %d, ожидалось %d", n, len(patch))
	}
	for _, i := range patch {
		if r.gridOwner[i] != 1 {
			t.Fatalf("клетка %d не вернулась владельцу: %d", i, r.gridOwner[i])
		}
		if r.coolOwner[i] != 0 {
			t.Fatalf("coolOwner[%d] не сброшен", i)
		}
	}
	if r.coolOwner[lone] != 1 {
		t.Fatalf("несвязная клетка %d не должна была вернуться", lone)
	}

	// Чужой номер не забирает остывающую клетку.
	other := &Player{num: 2, alive: true}
	r.players[2] = other
	if n := r.reclaimCoolRegion(other, lone); n != 0 {
		t.Fatalf("чужой игрок вернул %d клеток, ожидалось 0", n)
	}

	r.tick = 10 + ReclaimTicks + 1
	r.changedGrid = r.changedGrid[:0]
	r.stepCoolExpiry()
	if r.coolOwner[lone] != 0 || r.gridWireAt(lone) != 0 {
		t.Fatalf("клетка %d не протухла: coolOwner=%d wire=%#x", lone, r.coolOwner[lone], r.gridWireAt(lone))
	}
	if len(r.changedGrid) == 0 {
		t.Fatal("протухание не отправило дельту клиенту")
	}
	if len(r.coolBatches) != 0 {
		t.Fatalf("очередь остывания не опустела: %d", len(r.coolBatches))
	}
}

func TestReclaimQueueBudgetIsAmortized(t *testing.T) {
	r := newTestRoom()
	r.tick = 1
	p := &Player{num: 1, alive: true}
	r.players[1] = p
	total := ReclaimExpireBudget*2 + 5
	for i := 0; i < total; i++ {
		r.setGrid(i, 1)
	}
	r.clearPlayerCells(1, p)

	r.tick = 1 + ReclaimTicks
	r.stepCoolExpiry()
	left := 0
	for i := 0; i < total; i++ {
		if r.coolOwner[i] != 0 {
			left++
		}
	}
	if left != total-ReclaimExpireBudget {
		t.Fatalf("за тик протухло %d клеток, ожидалось %d", total-left, ReclaimExpireBudget)
	}
	r.stepCoolExpiry()
	r.stepCoolExpiry()
	for i := 0; i < total; i++ {
		if r.coolOwner[i] != 0 {
			t.Fatalf("клетка %d не протухла после трёх тиков", i)
		}
	}
}

func TestTitlesUnlockedOnlyByAchievements(t *testing.T) {
	pr := &Profile{}
	if m := titleMaskLocked(pr); m != 1 {
		t.Fatalf("пустая маска титулов = %#x, ожидалось 1", m)
	}
	for _, tr := range titleRules {
		if titleUnlockedLocked(pr, tr.id) {
			t.Fatalf("титул %d разблокирован без ачивки", tr.id)
		}
	}
	pr.AchvMask = uint32(1) << uint32(AchvKills100)
	if !titleUnlockedLocked(pr, 2) {
		t.Fatal("титул 2 должен открываться ачивкой AchvKills100")
	}
	if titleUnlockedLocked(pr, 3) {
		t.Fatal("титул 3 не должен открываться ачивкой AchvKills100")
	}
	if titleUnlockedLocked(pr, TitleMaxID+1) {
		t.Fatal("id за пределами таблицы не должен считаться разблокированным")
	}
	// Экипированный титул слетает, если ачивки нет.
	pr.TitleID = 3
	ensureProfileCosmeticsLocked(pr)
	if pr.TitleID != 0 {
		t.Fatalf("TitleID = %d, ожидалось 0", pr.TitleID)
	}
	pr.TitleID = 2
	ensureProfileCosmeticsLocked(pr)
	if pr.TitleID != 2 {
		t.Fatalf("TitleID = %d, ожидалось 2", pr.TitleID)
	}
}

func TestOldProfileLoadsNewCosmeticCategories(t *testing.T) {
	// Файл профиля, записанный до появления terr/death/титулов.
	raw := []byte(`{"styleBalance":123,"cosInvFrame":3,"cosEqFrame":1,"achvMask":0}`)
	var pr Profile
	if err := json.Unmarshal(raw, &pr); err != nil {
		t.Fatalf("старый профиль не разобрался: %v", err)
	}
	ensureProfileCosmeticsLocked(&pr)
	if pr.StyleBalance != 123 || pr.CosInvFrame != 3 || pr.CosEqFrame != 1 {
		t.Fatalf("старые поля потерялись: %+v", pr)
	}
	if pr.CosInvTerr != 1 || pr.CosInvDeath != 1 {
		t.Fatalf("новые категории не получили бесплатный вариант 0: terr=%d death=%d", pr.CosInvTerr, pr.CosInvDeath)
	}
	if pr.CosEqTerr != 0 || pr.CosEqDeath != 0 || pr.TitleID != 0 {
		t.Fatalf("новые поля должны грузиться нулями: %+v", pr)
	}
}

func TestCosmeticsPricesCoverNewCategories(t *testing.T) {
	payload := cosmeticsPricesPayload()
	for _, cat := range []string{"frame", "nameplate", "seg", "head", "capturefx", "terr", "death"} {
		row, ok := payload[cat]
		if !ok {
			t.Fatalf("в hello.cosmeticsPrices нет категории %q", cat)
		}
		list, ok := row.([]uint16)
		if !ok || len(list) != CosmeticsMaxID+1 {
			t.Fatalf("категория %q: неверная таблица цен %v", cat, row)
		}
		if list[0] != 0 {
			t.Fatalf("категория %q: вариант 0 должен быть бесплатным, цена %d", cat, list[0])
		}
		if !cosmeticsCatValid(cat) {
			t.Fatalf("категория %q не принимается cosmeticsCatValid", cat)
		}
	}
}

// ---------------------------------------------------------------------------
// Новые категории косметики, титулы и сообщение cosExtra — по живому сокету.
// ---------------------------------------------------------------------------

// wsWaitAny ждёт текстовое сообщение одного из перечисленных типов.
func wsWaitAny(ctx context.Context, t *testing.T, c *websocket.Conn, want ...string) (string, json.RawMessage) {
	t.Helper()
	for {
		env := wsSmokeReadJSON(ctx, t, c)
		for _, w := range want {
			if env.Type == w {
				return env.Type, env.Data
			}
		}
	}
}

func TestWSCosExtraAndTitleEquip(t *testing.T) {
	_, wsURL := wsSmokeEnv(t)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	c, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	c.SetReadLimit(8 << 20)
	defer c.Close(websocket.StatusNormalClosure, "test done")

	helloRaw := wsSmokeWaitJSON(ctx, t, c, "hello")
	var hello struct {
		Prices map[string][]uint16 `json:"cosmeticsPrices"`
	}
	if err := json.Unmarshal(helloRaw, &hello); err != nil {
		t.Fatalf("hello не разобрался: %v", err)
	}
	for _, cat := range []string{"terr", "death"} {
		if len(hello.Prices[cat]) != CosmeticsMaxID+1 {
			t.Fatalf("hello.cosmeticsPrices[%q] = %v", cat, hello.Prices[cat])
		}
	}

	wsSmokeSend(ctx, t, c, "join", map[string]any{"mode": "auto"})
	initRaw := wsSmokeWaitJSON(ctx, t, c, "init")
	var initMsg struct {
		You       uint16 `json:"you"`
		Cosmetics struct {
			InvTerr   *uint8  `json:"invTerr"`
			InvDeath  *uint8  `json:"invDeath"`
			EqTerr    *uint8  `json:"eqTerr"`
			EqDeath   *uint8  `json:"eqDeath"`
			TitleID   *uint8  `json:"titleId"`
			TitleMask *uint32 `json:"titleMask"`
		} `json:"cosmetics"`
	}
	if err := json.Unmarshal(initRaw, &initMsg); err != nil {
		t.Fatalf("init не разобрался: %v", err)
	}
	cs := initMsg.Cosmetics
	if cs.InvTerr == nil || *cs.InvTerr == 0 || cs.InvDeath == nil || *cs.InvDeath == 0 {
		t.Fatalf("в init.cosmetics нет масок владения terr/death: %s", string(initRaw))
	}
	if cs.EqTerr == nil || cs.EqDeath == nil || cs.TitleID == nil || cs.TitleMask == nil {
		t.Fatalf("в init.cosmetics нет eqTerr/eqDeath/titleId/titleMask: %s", string(initRaw))
	}
	if *cs.TitleMask&1 == 0 {
		t.Fatalf("titleMask = %#x, бит 0 («без титула») обязан быть выставлен", *cs.TitleMask)
	}

	// cosExtra приходит при входе в комнату и содержит самого игрока.
	extraRaw := wsSmokeWaitJSON(ctx, t, c, "cosExtra")
	var extra struct {
		Players []cosExtraEntry `json:"players"`
	}
	if err := json.Unmarshal(extraRaw, &extra); err != nil {
		t.Fatalf("cosExtra не разобрался: %v (%s)", err, string(extraRaw))
	}
	found := false
	for _, e := range extra.Players {
		if e.N == initMsg.You {
			found = true
		}
	}
	if !found {
		t.Fatalf("в cosExtra нет игрока %d: %s", initMsg.You, string(extraRaw))
	}

	// Категория terr доходит до транзакционной ветки: отказ по балансу,
	// а не «неизвестная категория».
	wsSmokeSend(ctx, t, c, "cosmeticsBuy", map[string]any{"cat": "terr", "id": 1})
	_, errRaw := wsWaitAny(ctx, t, c, "error", "cosmetics")
	var errMsg struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(errRaw, &errMsg)
	if errMsg.Message != "cosmetics_not_enough_style" {
		t.Fatalf("покупка terr вернула %q, ожидалось cosmetics_not_enough_style", errMsg.Message)
	}

	// Титул без ачивки не выдаётся.
	wsSmokeSend(ctx, t, c, "titleEquip", map[string]any{"id": 2})
	_, errRaw = wsWaitAny(ctx, t, c, "error", "cosmetics")
	_ = json.Unmarshal(errRaw, &errMsg)
	if errMsg.Message != "title_not_unlocked" {
		t.Fatalf("titleEquip вернул %q, ожидалось title_not_unlocked", errMsg.Message)
	}

	// id вне таблицы отсекается отдельным кодом.
	wsSmokeSend(ctx, t, c, "titleEquip", map[string]any{"id": TitleMaxID + 1})
	_, errRaw = wsWaitAny(ctx, t, c, "error", "cosmetics")
	_ = json.Unmarshal(errRaw, &errMsg)
	if errMsg.Message != "title_invalid_id" {
		t.Fatalf("titleEquip(%d) вернул %q, ожидалось title_invalid_id", TitleMaxID+1, errMsg.Message)
	}

	// id 0 («без титула») разрешён всегда и отвечает состоянием косметики.
	wsSmokeSend(ctx, t, c, "titleEquip", map[string]any{"id": 0})
	typ, _ := wsWaitAny(ctx, t, c, "error", "cosmetics")
	if typ != "cosmetics" {
		t.Fatalf("titleEquip(0) вернул %q, ожидалось cosmetics", typ)
	}
}

// ---------------------------------------------------------------------------
// WS_ORIGINS: наш allowlist — единственный арбитр рукопожатия.
//
// Регрессия: websocket.Accept по умолчанию сам делает same-origin проверку
// (Origin против Host) и отдавал 403 ДО wsOriginAllowed. Из-за этого
// WS_ORIGINS мог только сузить набор, но никогда не расширить: Origin из
// allowlist с чужим хостом отвергался. Тест поднимает настоящий
// httptest.Server и проверяет все четыре случая на реальном рукопожатии.
// ---------------------------------------------------------------------------

func TestWSOriginAllowlistIsTheOnlyArbiter(t *testing.T) {
	_, wsURL := wsSmokeEnv(t)

	prev := allowedWSOrigins
	allowedWSOrigins = map[string]struct{}{
		"http://example.test:18080": {},
	}
	t.Cleanup(func() { allowedWSOrigins = prev })

	cases := []struct {
		name       string
		origin     string
		wantAccept bool
	}{
		// Хост не совпадает с Host сервера — раньше это было 403.
		{"origin_in_allowlist_cross_host", "http://example.test:18080", true},
		// Регистр схемы/хоста и хвостовой слэш не значимы.
		{"origin_in_allowlist_normalized", "HTTP://Example.Test:18080/", true},
		{"origin_localhost_dev", "http://127.0.0.1:12345", true},
		{"origin_not_in_allowlist", "https://evil.example.com", false},
		{"no_origin_non_browser", "", true},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			var opts *websocket.DialOptions
			if tc.origin != "" {
				h := http.Header{}
				h.Set("Origin", tc.origin)
				opts = &websocket.DialOptions{HTTPHeader: h}
			}
			c, resp, err := websocket.Dial(ctx, wsURL, opts)
			if resp != nil && resp.Body != nil {
				defer resp.Body.Close()
			}
			if tc.wantAccept {
				if err != nil {
					code := 0
					if resp != nil {
						code = resp.StatusCode
					}
					t.Fatalf("Origin %q: ожидалось 101, получено %d (%v)", tc.origin, code, err)
				}
				if resp.StatusCode != http.StatusSwitchingProtocols {
					t.Fatalf("Origin %q: статус %d, ожидалось 101", tc.origin, resp.StatusCode)
				}
				c.Close(websocket.StatusNormalClosure, "ok")
				return
			}
			if err == nil {
				c.Close(websocket.StatusNormalClosure, "unexpected")
				t.Fatalf("Origin %q: рукопожатие прошло, ожидалось 403", tc.origin)
			}
			if resp == nil {
				t.Fatalf("Origin %q: нет HTTP-ответа (%v)", tc.origin, err)
			}
			if resp.StatusCode != http.StatusForbidden {
				t.Fatalf("Origin %q: статус %d, ожидалось 403", tc.origin, resp.StatusCode)
			}
		})
	}
}

// TestWSOriginAllowlistLoaderNormalizes фиксирует, что WS_ORIGINS парсится в
// тот же канонический вид, с которым сравнивается заголовок Origin.
func TestWSOriginAllowlistLoaderNormalizes(t *testing.T) {
	t.Setenv("WS_ORIGINS", " HTTPS://Snakes.Example.COM/ , http://a.test:8080 ")
	got := loadAllowedWSOrigins()
	want := []string{"https://snakes.example.com", "http://a.test:8080"}
	if len(got) != len(want) {
		t.Fatalf("allowlist = %v, ожидалось %v", got, want)
	}
	for _, w := range want {
		if _, ok := got[w]; !ok {
			t.Fatalf("в allowlist нет %q: %v", w, got)
		}
	}
}

// TestCoolBatchEventOnDeath: на каждую смерть уходит ровно одно событие
// EventCoolBatch с числом клеток и tick'ом окончательного исчезновения —
// по нему клиент ведёт собственный обратный отсчёт.
func TestCoolBatchEventOnDeath(t *testing.T) {
	r := newTestRoom()
	r.tick = 42
	p := &Player{num: 3, alive: true}
	r.players[3] = p

	cells := []int{200, 201, 202, 203}
	for _, i := range cells {
		r.setGrid(i, 3)
	}
	r.events = r.events[:0]
	r.clearPlayerCells(3, p)

	var got []Event
	for _, e := range r.events {
		if e.Kind == EventCoolBatch {
			got = append(got, e)
		}
	}
	if len(got) != 1 {
		t.Fatalf("EventCoolBatch = %d, ожидалось 1 (события: %+v)", len(got), r.events)
	}
	if got[0].A != 3 {
		t.Fatalf("владелец = %d, ожидалось 3", got[0].A)
	}
	if int(got[0].B) != len(cells) {
		t.Fatalf("клеток = %d, ожидалось %d", got[0].B, len(cells))
	}
	if got[0].C != 42+ReclaimTicks {
		t.Fatalf("tick истечения = %d, ожидалось %d", got[0].C, 42+ReclaimTicks)
	}

	// Уход из комнаты (cool=false) события не порождает: возвращать нечего.
	q := &Player{num: 4, alive: true}
	r.players[4] = q
	r.setGrid(300, 4)
	r.events = r.events[:0]
	r.clearPlayerCellsCooling(4, q, false)
	for _, e := range r.events {
		if e.Kind == EventCoolBatch {
			t.Fatal("EventCoolBatch при окончательном уходе игрока")
		}
	}
}

// TestBotSeeksOwnCoolingTerritory: бот с остывающей территорией в ROI
// выбирает её приоритетной целью (aiMode 5) вместо случайного возврата.
func TestBotSeeksOwnCoolingTerritory(t *testing.T) {
	r := newTestRoom()
	r.rng = rand.New(rand.NewSource(1))
	r.bfsMark = make([]uint32, N)
	r.bfsDist = make([]uint16, N)
	r.bfsGen = 1
	r.bfsQ = make([]int, 0, 4096)
	r.tick = 100

	p := &Player{num: 1, alive: true, bot: true, x: W / 2, y: H / 2, dir: DirRight}
	p.pendingDir = p.dir
	p.aiCoolCell = -1
	r.applyBotPersonality(p, TierNormal, ArchFarmer)
	r.players[1] = p

	// Пятно остывающих клеток в двух шагах от головы.
	for _, d := range []int{2, 3, 4} {
		i := r.idx(p.x+d, p.y)
		r.coolOwner[i] = 1
		r.coolUntil[i] = r.tick + ReclaimTicks
	}

	found := false
	for k := 0; k < 40 && !found; k++ {
		p.aiCoolScanTick = 0
		p.aiNextDecisionTick = 0
		p.aiMode = 0
		p.aiModeUntil = 0
		r.botStep(p)
		if p.aiMode == 5 {
			found = true
		}
	}
	if !found {
		t.Fatal("бот-Фермер ни разу не выбрал aiMode 5 (реклейм) при остывающей территории в ROI")
	}
	if r.coolOwner[p.aiCoolCell] != 1 {
		t.Fatalf("aiCoolCell=%d не принадлежит боту", p.aiCoolCell)
	}
}

// TestBotReclaimGateFavoursFarmer фиксирует требование G4: «Фермер»
// пользуется реклеймом охотнее «Агрессора».
func TestBotReclaimGateFavoursFarmer(t *testing.T) {
	if botReclaimGate[ArchFarmer] <= botReclaimGate[ArchAggressor] {
		t.Fatalf("Фермер %v должен тянуться к реклейму сильнее Агрессора %v",
			botReclaimGate[ArchFarmer], botReclaimGate[ArchAggressor])
	}
	if botReclaimGate[ArchTerritorial] <= botReclaimGate[ArchAggressor] {
		t.Fatalf("Территориальный %v должен быть выше Агрессора %v",
			botReclaimGate[ArchTerritorial], botReclaimGate[ArchAggressor])
	}
	for a := uint8(0); a < ArchCount; a++ {
		if botReclaimGate[a] <= 0 || botReclaimGate[a] > 1 {
			t.Fatalf("botReclaimGate[%d] = %v вне (0,1]", a, botReclaimGate[a])
		}
	}
}

// TestHelloCarriesVersion: поле version в hello — единственный способ увидеть,
// какая сборка реально крутится на проде.
func TestHelloCarriesVersion(t *testing.T) {
	_, wsURL := wsSmokeEnv(t)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	c, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close(websocket.StatusNormalClosure, "test done")

	raw := wsSmokeWaitJSON(ctx, t, c, "hello")
	var hello struct {
		Version *string `json:"version"`
	}
	if err := json.Unmarshal(raw, &hello); err != nil {
		t.Fatalf("hello не разобрался: %v", err)
	}
	if hello.Version == nil || *hello.Version == "" {
		t.Fatalf("в hello нет непустого version: %s", string(raw))
	}
	if *hello.Version != Version {
		t.Fatalf("hello.version = %q, ожидалось %q", *hello.Version, Version)
	}
	if Version == "" || Commit == "" || BuildTime == "" {
		t.Fatal("Version/Commit/BuildTime должны иметь значения по умолчанию")
	}
}
