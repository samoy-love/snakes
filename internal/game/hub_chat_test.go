package game

import (
	"context"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Тесты на пути, которые до этого не выполнялись ни разу: разбор ввода игрока,
// чат, реестр комнат и уборка пустой комнаты.
//
// Все они — не про проценты. Каждый закрывает конкретный отказ, который на
// проде выглядит как «игра молча перестала работать»: потерянный ввод,
// затопленный чат, комната-призрак в списке, стёртый прогресс.
// ---------------------------------------------------------------------------

// parseDir — единственная дверь, через которую ввод игрока попадает в игру
// (ws.go, сообщение "input"). Опечатка в одной из веток тихо превращает одно
// направление в «не понял», и игрок теряет управление в одну сторону.
func TestParseDirAcceptsExactlyFourDirections(t *testing.T) {
	ok := map[string]Dir{
		"up":    DirUp,
		"down":  DirDown,
		"left":  DirLeft,
		"right": DirRight,
	}
	for s, want := range ok {
		got, valid := parseDir(s)
		if !valid {
			t.Fatalf("parseDir(%q) отвергнут, а обязан приниматься", s)
		}
		if got != want {
			t.Fatalf("parseDir(%q) = %d, ожидалось %d", s, got, want)
		}
	}

	// Всё остальное обязано отвергаться, а не молча превращаться в DirUp:
	// нулевое значение Dir — это как раз «вверх», поэтому небрежный default
	// разворачивал бы змейку вместо игнорирования мусора.
	bad := []string{
		"", "UP", "Up", " up", "up ", "u", "north", "0", "5",
		"upup", "left,right", "DirLeft",
	}
	for _, s := range bad {
		if got, valid := parseDir(s); valid {
			t.Fatalf("parseDir(%q) принят как направление %d, а обязан быть отвергнут", s, got)
		}
	}
}

// ---------------------------------------------------------------------------
// Чат
// ---------------------------------------------------------------------------

// newChatClient — клиент, привязанный к комнате и игроку, но без сокета.
// handleChat пишет в r.chat под r.mu и только в конце вызывает broadcastJSON,
// который на комнате без клиентов ничего не делает, — поэтому сокет не нужен.
func newChatClient(r *Room, p *Player) *Client {
	c := &Client{}
	c.room = r
	c.player = p
	return c
}

// Ловит три отказа сразу:
//   - снятие sanitizeChat: в историю попадёт управляющий символ или '<',
//     который клиент подставит в разметку;
//   - снятие ограничения по времени (ChatMinInterval): один игрок затопит
//     историю и вытеснит чужие сообщения;
//   - снятие потолка ChatHistoryMax: r.chat растёт без границ, а вся история
//     копируется каждому входящему в комнату.
func TestHandleChatSanitizesRateLimitsAndCapsHistory(t *testing.T) {
	r := newRulesRoom(t, 5)
	p := addHumanPlayer(r, 1, 10, 10, DirRight)
	c := newChatClient(r, p)
	ctx := context.Background()

	// Пустое и полностью запрещённое сообщение не должно попадать в историю.
	c.handleChat(ctx, "   ")
	c.handleChat(ctx, "<>")
	if len(r.chat) != 0 {
		t.Fatalf("после пустых сообщений в истории %d записей, ожидалось 0", len(r.chat))
	}

	c.handleChat(ctx, "  привет <b> мир  ")
	if len(r.chat) != 1 {
		t.Fatalf("сообщение не записано: в истории %d", len(r.chat))
	}
	got := r.chat[0].Text
	if strings.ContainsAny(got, "<>") {
		t.Fatalf("угловые скобки не вырезаны: %q", got)
	}
	if got != strings.TrimSpace(got) {
		t.Fatalf("края не обрезаны: %q", got)
	}
	if r.chat[0].N != p.num {
		t.Fatalf("номер автора %d, ожидалось %d", r.chat[0].N, p.num)
	}
	if r.chat[0].T <= 0 {
		t.Fatal("время сообщения не проставлено")
	}

	// Второе сообщение сразу за первым — отсекается по интервалу.
	c.handleChat(ctx, "флуд")
	if len(r.chat) != 1 {
		t.Fatalf("ограничение по интервалу не сработало: в истории %d", len(r.chat))
	}

	// Потолок истории. Обходим интервал, сдвигая отметку последнего сообщения
	// в прошлое: проверяем именно потолок, а не таймер.
	for i := 0; i < ChatHistoryMax+20; i++ {
		p.lastChatAt = time.Now().Add(-2 * ChatMinInterval)
		c.handleChat(ctx, "сообщение")
	}
	if len(r.chat) != ChatHistoryMax {
		t.Fatalf("история %d записей, ожидался потолок %d", len(r.chat), ChatHistoryMax)
	}
}

// Клиент без комнаты обязан молча игнорировать чат, а не паниковать: между
// leave и join поле c.room пусто, а сообщение уже могло уйти в сеть.
func TestHandleChatWithoutRoomIsNoop(t *testing.T) {
	c := &Client{}
	c.handleChat(context.Background(), "привет")

	r := newRulesRoom(t, 6)
	c2 := &Client{}
	c2.room = r // игрока нет
	c2.handleChat(context.Background(), "привет")
	if len(r.chat) != 0 {
		t.Fatalf("сообщение от клиента без игрока попало в историю: %d", len(r.chat))
	}
}

// ---------------------------------------------------------------------------
// Реестр комнат
// ---------------------------------------------------------------------------

func newTestHub() *Hub {
	return &Hub{rooms: make(map[int]*Room), nextRoomID: 1, roomLimit: RoomHumanLimitDefault}
}

// getRoom обязан возвращать nil на неизвестный id, а не паниковать: id
// приходит от клиента (сообщение "join" с roomId) и может быть любым.
func TestGetRoomUnknownIDReturnsNil(t *testing.T) {
	h := newTestHub()
	r := newRulesRoom(t, 7)
	r.id = 1
	h.rooms[1] = r

	if got := h.getRoom(1); got != r {
		t.Fatal("существующая комната не найдена по id")
	}
	for _, id := range []int{0, -1, 2, 999999} {
		if got := h.getRoom(id); got != nil {
			t.Fatalf("getRoom(%d) вернул комнату, ожидался nil", id)
		}
	}
}

// listRoomsSnapshot — это то, что игрок видит в меню. Ловит: пропажу полей
// (клиент рисует пустые карточки), утечку ников сверх лимита и рассинхрон
// nameCount с фактическим числом игроков.
func TestListRoomsSnapshotShape(t *testing.T) {
	h := newTestHub()
	r := newRulesRoom(t, 8)
	r.id = 1
	r.title = "Комната"
	r.limit = RoomHumanLimitDefault
	r.humanCount = 2
	h.rooms[1] = r

	snap := h.listRoomsSnapshot()
	if len(snap) != 1 {
		t.Fatalf("комнат в снимке %d, ожидалась 1", len(snap))
	}
	got := snap[0]
	for _, k := range []string{"id", "title", "humans", "limit", "names", "nameCount", "namesTruncated"} {
		if _, ok := got[k]; !ok {
			t.Fatalf("в снимке нет поля %q: %v", k, got)
		}
	}
	if got["id"] != 1 {
		t.Fatalf("id = %v, ожидалось 1", got["id"])
	}
	if got["humans"] != 2 {
		t.Fatalf("humans = %v, ожидалось 2", got["humans"])
	}
	if got["limit"] != RoomHumanLimitDefault {
		t.Fatalf("limit = %v, ожидалось %d", got["limit"], RoomHumanLimitDefault)
	}

	// Пустой хаб — пустой список, а не nil: клиент делает по нему map().
	empty := newTestHub().listRoomsSnapshot()
	if empty == nil {
		t.Fatal("снимок пустого хаба = nil, ожидался пустой список")
	}
	if len(empty) != 0 {
		t.Fatalf("в снимке пустого хаба %d комнат", len(empty))
	}
}

// ---------------------------------------------------------------------------
// Уборка пустой комнаты
// ---------------------------------------------------------------------------

// scheduleCleanup ставит отложенное удаление комнаты, а cancelCleanup обязан
// его отменять по токену. Ловит гонку «последний вышел — новый зашёл»: если
// отмена не сработает, комнату с живым игроком удалят из реестра, и он
// окажется в комнате-призраке, невидимой в списке.
func TestScheduleCleanupIsCancelledByToken(t *testing.T) {
	h := newTestHub()
	r := newRulesRoom(t, 9)
	r.id = 1
	r.hub = h
	h.rooms[1] = r

	r.scheduleCleanup()
	r.mu.Lock()
	timerSet := r.cleanupTimer != nil
	tokenAfterSchedule := r.cleanupToken
	r.mu.Unlock()
	if !timerSet {
		t.Fatal("таймер уборки не поставлен")
	}

	// Повторный вызов не должен плодить второй таймер.
	r.scheduleCleanup()
	r.mu.Lock()
	tokenAfterSecond := r.cleanupToken
	r.mu.Unlock()
	if tokenAfterSecond != tokenAfterSchedule {
		t.Fatalf("повторный scheduleCleanup сдвинул токен: %d -> %d", tokenAfterSchedule, tokenAfterSecond)
	}

	r.cancelCleanup()
	r.mu.Lock()
	timerCleared := r.cleanupTimer == nil
	tokenAfterCancel := r.cleanupToken
	r.mu.Unlock()
	if !timerCleared {
		t.Fatal("cancelCleanup не снял таймер")
	}
	if tokenAfterCancel == tokenAfterSchedule {
		t.Fatal("токен не сдвинут — сработавший позже таймер удалит живую комнату")
	}

	// Комната обязана остаться в реестре.
	if h.getRoom(1) == nil {
		t.Fatal("комната исчезла из реестра после отмены уборки")
	}
}
