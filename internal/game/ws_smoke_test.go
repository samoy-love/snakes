package game

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"snakes/internal/profiles"
)

// ---------------------------------------------------------------------------
// Smoke-тест полного цикла WebSocket: hello -> rooms -> join -> init -> respawn
// -> бинарный ROI-снапшот -> корректное закрытие.
//
// Тест поднимает настоящий httptest.Server с handleWS (как это делает main()
// в server.go) и настоящий Hub с живой комнатой (тик 100 мс), поэтому он
// проверяет протокол целиком, а не отдельные сериализаторы.
// ---------------------------------------------------------------------------

var wsSmokeSecretOnce sync.Once

// wsSmokeEnv поднимает Hub + httptest.Server и возвращает ws://-адрес /ws.
// Все созданные комнаты и сам сервер гасятся через t.Cleanup, чтобы не текли
// горутины тиков.
func wsSmokeEnv(t *testing.T) (*Hub, string) {
	t.Helper()

	// PROFILE_SECRET в тестах не задан: инициализируем эфемерный секрет один
	// раз на весь пакет, иначе токены из разных подключений не сойдутся.
	wsSmokeSecretOnce.Do(profiles.InitSecret)

	// Лимитер per-IP — пакетный глобал, и все тесты ходят с 127.0.0.1. Без
	// сброса повторный прогон (go test -count=N) упирается в бакет "join"
	// и получает close(1008, rate_limited).
	wsIPLimiter.Reset()

	hub := &Hub{rooms: make(map[int]*Room), nextRoomID: 1, roomLimit: RoomHumanLimitDefault}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleWS(hub, w, r)
	}))

	t.Cleanup(func() {
		srv.Close()
		hub.mu.Lock()
		rooms := make([]*Room, 0, len(hub.rooms))
		for _, rm := range hub.rooms {
			rooms = append(rooms, rm)
		}
		hub.mu.Unlock()
		for _, rm := range rooms {
			rm.close()
		}
	})

	return hub, "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
}

type wsSmokeEnvelope struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// wsSmokeReadJSON читает сообщения до первого текстового и разбирает конверт.
// Бинарные кадры (ROI, миникарта, события) по пути молча пропускаются.
func wsSmokeReadJSON(ctx context.Context, t *testing.T, c *websocket.Conn) wsSmokeEnvelope {
	t.Helper()
	for {
		mt, data, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("ws read: %v", err)
		}
		if mt != websocket.MessageText {
			continue
		}
		var env wsSmokeEnvelope
		if err := json.Unmarshal(data, &env); err != nil {
			t.Fatalf("не разобрался JSON-конверт %q: %v", string(data), err)
		}
		return env
	}
}

// wsSmokeWaitJSON ждёт текстовое сообщение конкретного типа.
func wsSmokeWaitJSON(ctx context.Context, t *testing.T, c *websocket.Conn, want string) json.RawMessage {
	t.Helper()
	for {
		env := wsSmokeReadJSON(ctx, t, c)
		if env.Type == want {
			return env.Data
		}
		if env.Type == "error" {
			t.Fatalf("сервер вернул error вместо %q: %s", want, string(env.Data))
		}
	}
}

func wsSmokeSend(ctx context.Context, t *testing.T, c *websocket.Conn, typ string, data any) {
	t.Helper()
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("marshal %s: %v", typ, err)
	}
	msg, err := json.Marshal(map[string]any{"type": typ, "data": json.RawMessage(raw)})
	if err != nil {
		t.Fatalf("marshal envelope %s: %v", typ, err)
	}
	if err := c.Write(ctx, websocket.MessageText, msg); err != nil {
		t.Fatalf("ws write %s: %v", typ, err)
	}
}

// wsSmokeHello читает hello и валидирует его поля, возвращая токен личности.
func wsSmokeHello(ctx context.Context, t *testing.T, c *websocket.Conn) string {
	t.Helper()
	raw := wsSmokeWaitJSON(ctx, t, c, "hello")
	var hello struct {
		W         *int    `json:"w"`
		H         *int    `json:"h"`
		TickMs    *int    `json:"tickMs"`
		RoomLimit *int    `json:"roomLimit"`
		Token     *string `json:"token"`
	}
	if err := json.Unmarshal(raw, &hello); err != nil {
		t.Fatalf("hello не разобрался: %v (%s)", err, string(raw))
	}
	switch {
	case hello.W == nil || *hello.W != W:
		t.Fatalf("hello.w = %v, ожидалось %d", hello.W, W)
	case hello.H == nil || *hello.H != H:
		t.Fatalf("hello.h = %v, ожидалось %d", hello.H, H)
	case hello.TickMs == nil || *hello.TickMs != TickMS:
		t.Fatalf("hello.tickMs = %v, ожидалось %d", hello.TickMs, TickMS)
	case hello.RoomLimit == nil || *hello.RoomLimit <= 0:
		t.Fatalf("hello.roomLimit = %v, ожидалось положительное число", hello.RoomLimit)
	case hello.Token == nil || *hello.Token == "":
		t.Fatalf("hello.token отсутствует или пуст: %s", string(raw))
	}
	return *hello.Token
}

func TestWSSmokeJoinAndSnapshot(t *testing.T) {
	_, wsURL := wsSmokeEnv(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	c, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	// Бинарные кадры полного стейта могут быть крупными.
	c.SetReadLimit(8 << 20)
	defer c.Close(websocket.StatusNormalClosure, "test done")

	// 1) hello
	token := wsSmokeHello(ctx, t, c)
	if _, ok := profiles.ParseToken(token); !ok {
		t.Fatalf("токен из hello не проходит проверку подписи: %q", token)
	}

	// 2) rooms
	roomsRaw := wsSmokeWaitJSON(ctx, t, c, "rooms")
	// data для "rooms" — это массив снапшотов комнат (см. listRoomsSnapshot).
	var rooms []map[string]any
	if err := json.Unmarshal(roomsRaw, &rooms); err != nil {
		t.Fatalf("rooms не разобрался: %v (%s)", err, string(roomsRaw))
	}

	// 3) join auto -> init
	wsSmokeSend(ctx, t, c, "join", map[string]any{"mode": "auto"})
	initRaw := wsSmokeWaitJSON(ctx, t, c, "init")
	var initMsg struct {
		You  *uint16 `json:"you"`
		Room *int    `json:"room"`
		W    *int    `json:"w"`
		H    *int    `json:"h"`
	}
	if err := json.Unmarshal(initRaw, &initMsg); err != nil {
		t.Fatalf("init не разобрался: %v (%s)", err, string(initRaw))
	}
	switch {
	case initMsg.You == nil || *initMsg.You == 0:
		t.Fatalf("init.you = %v, ожидался ненулевой номер игрока", initMsg.You)
	case initMsg.Room == nil || *initMsg.Room <= 0:
		t.Fatalf("init.room = %v, ожидался id комнаты", initMsg.Room)
	case initMsg.W == nil || *initMsg.W != W:
		t.Fatalf("init.w = %v, ожидалось %d", initMsg.W, W)
	case initMsg.H == nil || *initMsg.H != H:
		t.Fatalf("init.h = %v, ожидалось %d", initMsg.H, H)
	}

	// 4) respawn -> хотя бы один бинарный ROI-снапшот (первый байт = 2)
	wsSmokeSend(ctx, t, c, "respawn", map[string]any{})

	deadline, cancelROI := context.WithTimeout(ctx, 10*time.Second)
	defer cancelROI()
	gotROI := false
	seenBinaryKinds := map[byte]int{}
	for !gotROI {
		mt, data, err := c.Read(deadline)
		if err != nil {
			t.Fatalf("ждали бинарный ROI-снапшот, получили ошибку: %v (виденные типы: %v)", err, seenBinaryKinds)
		}
		if mt != websocket.MessageBinary || len(data) == 0 {
			continue
		}
		seenBinaryKinds[data[0]]++
		if data[0] == MsgROIBinary {
			gotROI = true
		}
	}

	// 5) корректное закрытие
	if err := c.Close(websocket.StatusNormalClosure, "bye"); err != nil {
		t.Fatalf("close: %v", err)
	}
}

func TestWSSmokeReconnectKeepsProfileID(t *testing.T) {
	_, wsURL := wsSmokeEnv(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	c1, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial #1: %v", err)
	}
	token1 := wsSmokeHello(ctx, t, c1)
	pid1, ok := profiles.ParseToken(token1)
	if !ok {
		t.Fatalf("токен первого подключения невалиден: %q", token1)
	}
	if err := c1.Close(websocket.StatusNormalClosure, "reconnect"); err != nil {
		t.Fatalf("close #1: %v", err)
	}

	c2, _, err := websocket.Dial(ctx, wsURL+"?t="+token1, nil)
	if err != nil {
		t.Fatalf("dial #2: %v", err)
	}
	defer c2.Close(websocket.StatusNormalClosure, "test done")

	token2 := wsSmokeHello(ctx, t, c2)
	pid2, ok := profiles.ParseToken(token2)
	if !ok {
		t.Fatalf("токен второго подключения невалиден: %q", token2)
	}
	if pid1 != pid2 {
		t.Fatalf("переподключение с ?t= сменило профиль: pid1=%q pid2=%q", pid1, pid2)
	}

	if err := c2.Close(websocket.StatusNormalClosure, "bye"); err != nil {
		t.Fatalf("close #2: %v", err)
	}
}
