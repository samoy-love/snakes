package main

// Экспорт эталонных («золотых») буферов бинарного протокола в JSON, который
// читают клиентские тесты на Node (tests/*.test.mjs).
//
// Зачем. Серверная сторона протокола покрыта побайтовыми тестами в
// protocol_test.go, клиентская (public/client.js, handleStateBinary) — не была
// покрыта ничем, кроме `node --check`. Рассинхрон кодера и декодера трижды за
// проект ломал игру молча: клиент читал для kind=12 одиннадцать байт вместо
// трёх, для kind=13 обработчика не было вовсе — парсер «съезжал» и терял весь
// хвост пакета, вместе с ним киллфид, тосты и обновления заданий.
//
// Схема защиты двусторонняя:
//   - этот тест держит tests/golden/protocol_golden.json в точном соответствии
//     с фактическими сериализаторами (падает, если файл устарел);
//   - node-тесты держат public/client.js в соответствии с этим JSON.
// Между ними рассинхрон кодера и декодера физически не проходит незамеченным.
//
// Регенерация после осознанного изменения протокола:
//
//	UPDATE_GOLDEN=1 go test -run TestProtocolGoldenExport .
//
// JSON — данные, а не код: node-тестам не нужен Go в момент запуска.

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const goldenPath = "tests/golden/protocol_golden.json"

// goldenField — одно поле payload события: буква поля структуры Event и его
// ширина на проводе. Порядок в срезе — порядок записи в буфер.
type goldenField struct {
	Name string `json:"name"`
	Size int    `json:"size"`
}

type goldenEventLayout struct {
	Kind   uint8         `json:"kind"`
	Const  string        `json:"const"`
	Len    int           `json:"len"`
	Fields []goldenField `json:"fields"`
}

type goldenCase struct {
	Name  string `json:"name"`
	Desc  string `json:"desc"`
	Bytes string `json:"bytes"` // base64
}

type goldenDoc struct {
	Note     string                 `json:"note"`
	Regen    string                 `json:"regen"`
	Consts   map[string]int         `json:"consts"`
	MsgTypes map[string]int         `json:"msgTypes"`
	Events   []goldenEventLayout    `json:"events"`
	Sample   map[string]uint32      `json:"sample"`
	Cases    []goldenCase           `json:"cases"`
	Expect   map[string]interface{} `json:"expect"`
}

// goldenSample — значения полей события-образца. Все шесть различны и не
// совпадают ни в одном байте по ширине, поэтому перепутанный порядок полей или
// подменённая ширина обязательно дадут другое значение при разборе.
var goldenSample = map[string]uint32{
	"A": 0x1122,
	"B": 0x3344,
	"X": 0x5566,
	"Y": 0x7788,
	"C": 0x99AABBCC,
	"D": 0xDD,
}

// goldenEventFields — эталонная раскладка payload по каждому типу события.
// Таблица написана вручную (это спецификация), а TestProtocolGoldenExport
// проверяет, что фактический сериализатор пишет ровно эти байты.
var goldenEventFields = map[uint8][]goldenField{
	EventKill:             {{"A", 2}, {"B", 2}, {"D", 1}, {"X", 2}, {"Y", 2}},
	EventStreak:           {{"A", 2}, {"D", 1}},
	EventBountyAssign:     {{"A", 2}, {"C", 4}},
	EventBountyClaim:      {{"A", 2}, {"B", 2}},
	EventPowerupSpawn:     {{"A", 2}, {"D", 1}, {"X", 2}, {"Y", 2}, {"C", 4}},
	EventPowerupPickup:    {{"A", 2}, {"B", 2}, {"D", 1}, {"X", 2}, {"Y", 2}},
	EventMutatorStart:     {{"D", 1}, {"C", 4}},
	EventMutatorEnd:       {{"D", 1}},
	EventPowerupUse:       {{"A", 2}, {"D", 1}, {"X", 2}, {"Y", 2}},
	EventContractAssign:   {{"A", 2}, {"D", 1}, {"B", 2}, {"C", 4}},
	EventContractProgress: {{"A", 2}, {"D", 1}, {"B", 2}},
	EventContractComplete: {{"A", 2}, {"D", 1}},
	EventStyle:            {{"A", 2}, {"B", 2}, {"C", 4}, {"D", 1}},
	EventRevenge:          {{"A", 2}, {"B", 2}},
	EventDailyAssign:      {{"A", 2}, {"D", 1}, {"B", 2}, {"C", 4}},
	EventDailyProgress:    {{"A", 2}, {"D", 1}, {"B", 2}},
	EventDailyComplete:    {{"A", 2}, {"D", 1}},
	EventAchievement:      {{"A", 2}, {"D", 1}},
	EventCapture:          {{"A", 2}, {"X", 2}, {"Y", 2}, {"C", 4}, {"D", 1}},
	EventReclaim:          {{"A", 2}, {"B", 2}, {"X", 2}, {"Y", 2}},
	EventCoolBatch:        {{"A", 2}, {"B", 2}, {"C", 4}},
}

var goldenEventConstName = map[uint8]string{
	EventKill:             "EventKill",
	EventStreak:           "EventStreak",
	EventBountyAssign:     "EventBountyAssign",
	EventBountyClaim:      "EventBountyClaim",
	EventPowerupSpawn:     "EventPowerupSpawn",
	EventPowerupPickup:    "EventPowerupPickup",
	EventMutatorStart:     "EventMutatorStart",
	EventMutatorEnd:       "EventMutatorEnd",
	EventPowerupUse:       "EventPowerupUse",
	EventContractAssign:   "EventContractAssign",
	EventContractProgress: "EventContractProgress",
	EventContractComplete: "EventContractComplete",
	EventStyle:            "EventStyle",
	EventRevenge:          "EventRevenge",
	EventDailyAssign:      "EventDailyAssign",
	EventDailyProgress:    "EventDailyProgress",
	EventDailyComplete:    "EventDailyComplete",
	EventAchievement:      "EventAchievement",
	EventCapture:          "EventCapture",
	EventReclaim:          "EventReclaim",
	EventCoolBatch:        "EventCoolBatch",
}

func goldenSampleEvent(kind uint8) Event {
	return Event{
		Kind: kind,
		A:    uint16(goldenSample["A"]),
		B:    uint16(goldenSample["B"]),
		X:    uint16(goldenSample["X"]),
		Y:    uint16(goldenSample["Y"]),
		C:    goldenSample["C"],
		D:    uint8(goldenSample["D"]),
	}
}

// buildGolden собирает документ целиком из фактических сериализаторов.
func buildGolden(t *testing.T) goldenDoc {
	t.Helper()

	doc := goldenDoc{
		Note: "Эталонные буферы бинарного протокола Snakes. Генерируется из Go-сериализаторов " +
			"(golden_export_test.go), потребляется node-тестами в tests/. Не редактировать вручную.",
		Regen: "UPDATE_GOLDEN=1 go test -run TestProtocolGoldenExport .",
		Consts: map[string]int{
			"W":                      W,
			"H":                      H,
			"eventsHeaderBase":       eventsHeaderBase,
			"powerUpRecordLen":       powerUpRecordLen,
			"roiPlayerRecordLen":     roiPlayerRecordLen,
			"minimapChunkW":          MinimapChunkW,
			"minimapChunkH":          MinimapChunkH,
			"minimapChunksX":         MinimapChunksX,
			"minimapChunksY":         MinimapChunksY,
			"minimapMaxChunksPerMsg": MinimapMaxChunksPerMsg,
			"minimapHeaderLen":       1 + 4 + 1 + 1 + 2 + 1,
			"roiHeaderLen":           1 + 4 + 2,
			"roiTrailerLen":          2 + 2 + 2 + 2 + 4 + 4,
		},
		MsgTypes: map[string]int{
			"state":        MsgStateBinary,
			"roi":          MsgROIBinary,
			"minimapChunk": MsgMinimapChunk,
			"events":       MsgEventsBinary,
		},
		Sample: goldenSample,
		Expect: map[string]interface{}{},
	}

	// --- раскладка событий -------------------------------------------------
	for kind := uint8(1); kind <= 21; kind++ {
		fields, ok := goldenEventFields[kind]
		if !ok {
			t.Fatalf("нет эталонной раскладки для kind=%d", kind)
		}
		total := 0
		for _, f := range fields {
			total += f.Size
		}
		if total != eventPayloadLen[kind] {
			t.Fatalf("kind=%d: сумма полей %d != eventPayloadLen %d", kind, total, eventPayloadLen[kind])
		}
		doc.Events = append(doc.Events, goldenEventLayout{
			Kind:   kind,
			Const:  goldenEventConstName[kind],
			Len:    total,
			Fields: fields,
		})
	}

	add := func(name, desc string, b []byte) {
		doc.Cases = append(doc.Cases, goldenCase{
			Name:  name,
			Desc:  desc,
			Bytes: base64.StdEncoding.EncodeToString(b),
		})
	}

	// --- по одному пакету на каждый тип события ---------------------------
	for kind := uint8(1); kind <= 21; kind++ {
		r := newTestRoom()
		r.tick = 7
		r.events = append(r.events, goldenSampleEvent(kind))
		pd := r.buildEventsPooledLocked(false)
		if pd == nil {
			t.Fatalf("kind=%d: buildEventsPooledLocked вернул nil", kind)
		}
		b := append([]byte(nil), pd.b...)
		releasePooledData(pd)
		add("events_kind_"+goldenEventConstName[kind], "пакет событий с одним событием-образцом", b)
	}

	// --- заголовок с мутатором, баунти и списком powerup ------------------
	{
		r := newTestRoom()
		r.tick = 4242
		r.mutatorType = 3
		r.mutatorUntil = 5000
		r.bountyTarget = 17
		r.bountyUntil = 4999
		for i := 0; i < 5; i++ {
			r.powerUps = append(r.powerUps, PowerUp{
				ID: uint16(i + 1), Type: uint8(i%4 + 1), X: uint16(10 + i), Y: uint16(20 + i*2),
				Expires: uint32(9000 + i),
			})
		}
		r.events = append(r.events, Event{Kind: EventStreak, A: 17, D: 5})
		r.events = append(r.events, Event{Kind: EventMutatorEnd, D: 3})
		pd := r.buildEventsPooledLocked(false)
		if pd == nil {
			t.Fatal("events_header: nil")
		}
		b := append([]byte(nil), pd.b...)
		releasePooledData(pd)
		add("events_header_powerups", "заголовок + 5 powerup + 2 события", b)
	}

	// --- все 21 типов подряд в одном пакете --------------------------------
	{
		r := newTestRoom()
		r.tick = 100500
		for kind := uint8(1); kind <= 21; kind++ {
			r.events = append(r.events, goldenSampleEvent(kind))
		}
		pd := r.buildEventsPooledLocked(false)
		if pd == nil {
			t.Fatal("events_all_kinds: nil")
		}
		b := append([]byte(nil), pd.b...)
		releasePooledData(pd)
		add("events_all_kinds", "все 21 типов событий в одном пакете, по порядку", b)
	}

	// --- неизвестный тип: 1 байт-заглушка, разбор продолжается -------------
	{
		r := newTestRoom()
		r.tick = 8
		r.events = append(r.events, Event{Kind: 250, A: 1, B: 2, C: 3, D: 4})
		r.events = append(r.events, goldenSampleEvent(EventStreak))
		pd := r.buildEventsPooledLocked(false)
		if pd == nil {
			t.Fatal("events_unknown_kind: nil")
		}
		b := append([]byte(nil), pd.b...)
		releasePooledData(pd)
		add("events_unknown_kind", "неизвестный kind=250 (1 байт-заглушка) + известное событие следом", b)
	}

	// --- ROI: fast-путь, два игрока, пустые дельты -------------------------
	{
		r := newTestRoom()
		r.tick = 99
		p1 := makeTestPlayer(5, 30, 40)
		p2 := makeTestPlayer(9, 31, 41)
		p2.bot = true
		p2.shield = 0
		p2.hue = 300
		p2.alive = false
		r.players[5] = p1
		r.players[9] = p2
		r.scores[5], r.points[5] = 111, 222
		r.scores[9], r.points[9] = 333, 444
		pd := r.buildROIPooledFast(0, 0, 8, 8, 0, []*Player{p1, p2})
		if pd == nil {
			t.Fatal("roi_fast: nil")
		}
		b := append([]byte(nil), pd.b...)
		releasePooledData(pd)
		add("roi_fast_two_players", "ROI (тип 2), два игрока, пустые дельты", b)
	}

	// --- ROI: scan-путь, full=true, регион 4x3 ------------------------------
	{
		r := newTestRoom()
		r.tick = 55
		p := makeTestPlayer(5, 4, 6)
		r.players[5] = p
		r.scores[5], r.points[5] = 1, 2
		for y := 6; y < 9; y++ {
			for x := 4; x < 8; x++ {
				r.gridOwner[y*W+x] = uint16(x + y)
			}
		}
		r.trailOwner[6*W+4] = 5
		pd := r.buildROIPooledScan(4, 6, 4, 3, true, 0, []*Player{p})
		if pd == nil {
			t.Fatal("roi_scan_full: nil")
		}
		b := append([]byte(nil), pd.b...)
		releasePooledData(pd)
		add("roi_scan_full", "ROI (тип 2), полный скан региона 4x3", b)
	}

	// --- миникарта: дельта в один чанк -------------------------------------
	{
		r := newTestRoom()
		r.tick = 3
		for _, i := range []int{MinimapChunkW, MinimapChunkW + 1, W + MinimapChunkW} {
			r.gridOwner[i] = 5
			r.minimapGrid = append(r.minimapGrid, packChange(uint16(i), 5))
		}
		b := r.buildMinimapChunkBinary(false)
		if b == nil {
			t.Fatal("minimap_delta: nil")
		}
		add("minimap_delta_one_chunk", "миникарта (тип 4), дельта — один чанк (1,0)", b)
	}

	// --- миникарта: full, первая страница ----------------------------------
	{
		r := newTestRoom()
		r.tick = 12
		r.gridOwner[0] = 77
		r.gridOwner[W*MinimapChunkH+MinimapChunkW] = 88 // чанк (1,1)
		b := r.buildMinimapChunkBinary(true)
		if b == nil {
			t.Fatal("minimap_full: nil")
		}
		add("minimap_full_page1", "миникарта (тип 4), full — первая страница чанков", b)
	}

	return doc
}

// TestProtocolGoldenExport проверяет (и при UPDATE_GOLDEN=1 перезаписывает)
// tests/golden/protocol_golden.json.
func TestProtocolGoldenExport(t *testing.T) {
	doc := buildGolden(t)

	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	out = append(out, '\n')

	if os.Getenv("UPDATE_GOLDEN") != "" {
		if err := os.MkdirAll(filepath.Dir(goldenPath), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(goldenPath, out, 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		t.Logf("обновлён %s (%d байт, %d кейсов)", goldenPath, len(out), len(doc.Cases))
		return
	}

	have, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("не читается %s: %v\nСгенерируйте: UPDATE_GOLDEN=1 go test -run TestProtocolGoldenExport .", goldenPath, err)
	}
	// Нормализуем перевод строки: на Windows файл может быть выгружен с CRLF.
	if normalizeNewlines(string(have)) != normalizeNewlines(string(out)) {
		t.Fatalf("%s устарел относительно сериализаторов.\n"+
			"Если протокол менялся осознанно — обновите эталон и СИНХРОННО клиент:\n"+
			"  UPDATE_GOLDEN=1 go test -run TestProtocolGoldenExport .\n"+
			"  node --test tests/", goldenPath)
	}
}

func normalizeNewlines(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '\r' {
			continue
		}
		out = append(out, s[i])
	}
	return string(out)
}

// TestGoldenEventLayoutMatchesSerializer — раскладка полей из goldenEventFields
// обязана совпадать с тем, что реально пишет buildEventsPooledLocked.
// Именно эта таблица уезжает в JSON и становится контрактом для клиента.
func TestGoldenEventLayoutMatchesSerializer(t *testing.T) {
	if len(goldenEventFields) != 21 {
		t.Fatalf("раскладок %d, ожидалось 21", len(goldenEventFields))
	}
	for kind := uint8(1); kind <= 21; kind++ {
		kind := kind
		t.Run(goldenEventConstName[kind], func(t *testing.T) {
			r := newTestRoom()
			r.tick = 0
			r.events = append(r.events, goldenSampleEvent(kind))
			pd := r.buildEventsPooledLocked(false)
			if pd == nil {
				t.Fatal("nil")
			}
			defer releasePooledData(pd)

			// payload начинается сразу после байта kind.
			off := eventsHeaderBase + 2 + 1
			rd := &reader{b: pd.b, o: off, t: t}
			for _, f := range goldenEventFields[kind] {
				want := goldenSample[f.Name]
				var got uint32
				switch f.Size {
				case 1:
					got = uint32(rd.u8())
				case 2:
					got = uint32(rd.u16())
				case 4:
					got = rd.u32()
				default:
					t.Fatalf("недопустимая ширина поля %d", f.Size)
				}
				if f.Size < 4 {
					want &= (1 << (8 * uint(f.Size))) - 1
				}
				if got != want {
					t.Fatalf("поле %s (%d байт): прочитано 0x%X, ожидалось 0x%X — "+
						"порядок или ширина полей в сериализаторе разошлись с эталоном",
						f.Name, f.Size, got, want)
				}
			}
			if !rd.eof() {
				t.Fatalf("после раскладки остался хвост %d байт", len(rd.b)-rd.o)
			}
		})
	}
}
