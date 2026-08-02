package game

import "snakes/internal/metrics"

// Перевод внутренних числовых кодов в имена меток Prometheus.
//
// Метка — часть публичного контракта метрики: по ней написаны запросы в
// дашбордах и алертах. Поэтому имена задаются здесь явно, а не выводятся из
// номера константы: перенумеровать бонус внутри игры можно, переименовать
// метку — нет. Неизвестный код становится "other", а не пропадает: молча
// потерянное событие хуже, чем событие в мусорной корзине.

func powerupLabel(t uint8) string {
	switch t {
	case PowerupShield:
		return "shield"
	case PowerupDash:
		return "dash"
	case PowerupNova:
		return "nova"
	case PowerupMegaDash:
		return "mega_dash"
	default:
		return "other"
	}
}

func mutatorLabel(m uint8) string {
	switch m {
	case MutatorDoubleCapture:
		return "double_capture"
	case MutatorPowerSurge:
		return "power_surge"
	default:
		return "other"
	}
}

func contractLabel(t uint8) string {
	switch t {
	case ContractKills:
		return "kills"
	case ContractPickups:
		return "pickups"
	case ContractCapture:
		return "capture"
	default:
		return "other"
	}
}

func dailyLabel(t uint8) string {
	switch t {
	case DailyKills:
		return "kills"
	case DailyPickups:
		return "pickups"
	case DailyCapture:
		return "capture"
	case DailyStyle:
		return "style"
	default:
		return "other"
	}
}

func styleReasonLabel(reason uint8) string {
	switch reason {
	case StyleKill:
		return "kill"
	case StyleRevenge:
		return "revenge"
	case StyleBounty:
		return "bounty"
	case StyleContract:
		return "contract"
	case StyleDaily:
		return "daily"
	case StyleWin:
		return "win"
	case StyleTop5:
		return "top5"
	case StyleCapture:
		return "capture"
	case StyleAchievement:
		return "achievement"
	case StyleSurvive:
		return "survive"
	default:
		return "other"
	}
}

// closeReasonLabel: штатное закрытие приходит с пустой причиной, но в метрике
// пустая метка неотличима от потерянной — она получает собственное имя.
func closeReasonLabel(reason string) string {
	if reason == "" {
		return "normal"
	}
	return reason
}

// Snapshot — мгновенный срез для /metrics: сколько сейчас комнат, людей,
// ботов и идущих матчей. Пройти по комнатам дешевле, чем поддерживать четыре
// глобальных счётчика, каждый из которых обязан быть уменьшен на всех путях
// выхода игрока — а таких путей у комнаты десяток.
//
// Порядок замков тот же, что в listRoomsSnapshot: сначала снимок карты комнат
// под h.mu, потом каждая комната по отдельности. Держать оба замка сразу
// нельзя — тик комнаты берёт только r.mu и упёрся бы в сборщика метрик.
func (h *Hub) Snapshot() metrics.GameSnapshot {
	h.mu.RLock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.RUnlock()

	out := metrics.GameSnapshot{Rooms: len(rooms)}
	for _, r := range rooms {
		r.mu.Lock()
		for _, p := range r.players {
			if p == nil || !p.alive {
				continue
			}
			if p.bot {
				out.Bots++
			} else {
				out.Players++
			}
		}
		if !r.matchEnded {
			out.MatchesRunning++
		}
		r.mu.Unlock()
	}
	return out
}
