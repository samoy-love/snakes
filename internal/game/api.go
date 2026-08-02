package game

import (
	"net/http"

	"snakes/internal/profiles"
)

// Поверхность пакета, которой пользуется main. Всё остальное в game
// неэкспортировано намеренно: игровое состояние живёт под замком комнаты, и
// снаружи с ним делать нечего.

// buildVersion — версия сборки, уезжающая клиенту в приветственном пакете.
// Значение приходит из main: ldflags умеет подставлять только -X main.Version,
// а тянуть в игровое ядро линкерную переменную чужого пакета нельзя.
var buildVersion = "dev"

// SetBuildVersion вызывается из main до старта сервера.
func SetBuildVersion(v string) {
	if v != "" {
		buildVersion = v
	}
}

// NewHub создаёт хаб комнат с лимитом людей на комнату.
func NewHub(roomLimit int) *Hub {
	return &Hub{rooms: make(map[int]*Room), nextRoomID: 1, roomLimit: roomLimit}
}

// HandleWS — обработчик /ws.
func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	handleWS(h, w, r)
}

// Close останавливает все комнаты при выключении сервера.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, rm := range h.rooms {
		rm.close()
	}
}

// EnsureProfileCosmetics достраивает профиль до текущей схемы косметики.
// Передаётся в profiles.Load: хранилище профилей не знает, какие поля нужны
// игре, а игра не знает, когда хранилище читает файл.
func EnsureProfileCosmetics(pr *profiles.Profile) { ensureProfileCosmeticsLocked(pr) }

// MaxRooms — фактический потолок числа комнат (MAX_ROOMS или DefaultMaxRooms).
func MaxRooms() int { return maxRoomsLimit }

// BotDeathLogEnabled — включён ли подробный лог смертей ботов (BOT_DEATH_SNAP).
func BotDeathLogEnabled() bool { return debugBotDeathSnap }
