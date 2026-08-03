package metrics

import (
	"bufio"
	"sync/atomic"
)

// Здесь перечислены все метрики сервера. Порядок объявления — порядок вывода,
// поэтому родственные метрики стоят рядом.
//
// Соглашение по именам — прометеевское: префикс `snakes_`, единица измерения в
// конце (`_seconds`), суффикс `_total` у монотонных счётчиков. Переименование
// метрики ломает все дашборды и алерты, которые на неё смотрят, поэтому имена
// подбираются один раз.

// actors — значения метки actor. Людей на поле втрое меньше ботов, и без
// разделения все игровые счётчики показывают в основном работу ИИ.
var actors = []string{"player", "bot"}

// ActorLabel переводит признак «это бот» в значение метки. Одна точка правды:
// разъехавшиеся написания дали бы две метрики вместо одной.
func ActorLabel(bot bool) string {
	if bot {
		return "bot"
	}
	return "player"
}

// --- сборка ----------------------------------------------------------------

var (
	buildVersion atomic.Value
	buildCommit  atomic.Value
)

// infoMetric — метрика-константа: значение всегда 1, полезное содержимое в
// метках. Так принято отдавать версию сборки.
type infoMetric struct{ meta }

func (i *infoMetric) metricType() string { return "gauge" }

func (i *infoMetric) writeSamples(w *bufio.Writer) {
	v, _ := buildVersion.Load().(string)
	c, _ := buildCommit.Load().(string)
	if v == "" {
		v = "unknown"
	}
	if c == "" {
		c = "unknown"
	}
	w.WriteString(i.name)
	w.WriteString(`{version="`)
	w.WriteString(escapeLabel(v))
	w.WriteString(`",commit="`)
	w.WriteString(escapeLabel(c))
	w.WriteString(`"} 1`)
	w.WriteByte('\n')
}

var _ = register(&infoMetric{meta: meta{
	name: "snakes_build_info",
	help: "Версия работающей сборки: значение всегда 1, полезное — в метках.",
}})

// --- что происходит прямо сейчас -------------------------------------------

var (
	// Rooms/Players/Bots/MatchesRunning заполняются в момент сбора из
	// GameSnapshot, руками их трогать не нужно.
	Rooms = newGauge("snakes_rooms",
		"Живых комнат.")
	Players = newGauge("snakes_players",
		"Живых игроков-людей во всех комнатах.")
	Bots = newGauge("snakes_bots",
		"Ботов во всех комнатах.")
	MatchesRunning = newGauge("snakes_matches_running",
		"Комнат, в которых прямо сейчас идёт матч (не пауза между матчами).")
)

// --- игровой процесс -------------------------------------------------------

var (
	MatchesTotal = newCounter("snakes_matches_total",
		"Сыгранных матчей — счётчик растёт в момент завершения матча.")

	MatchDurationSeconds = newHistogram("snakes_match_duration_seconds",
		"Длительность матча от старта до подведения итогов.",
		[]float64{30, 60, 120, 180, 240, 300, 360, 600})

	MatchSurvivors = newHistogram("snakes_match_survivors",
		"Сколько игроков дожило до конца матча. Дно распределения — признак того, что матч превратился в мясорубку.",
		[]float64{0, 1, 2, 3, 4, 6, 8, 12, 16})

	TickDurationSeconds = newHistogram("snakes_tick_duration_seconds",
		"Время обсчёта одного игрового тика. Бюджет — 0.1 с, всё что рядом с ним означает, что комната не успевает за собственными часами.",
		[]float64{0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25})

	CellsCapturedTotal = newCounterVec("snakes_cells_captured_total",
		"Захвачено клеток территории, отдельно людьми и ботами.",
		"actor", actors...)

	LoopsClosedTotal = newCounterVec("snakes_loops_closed_total",
		"Замкнутых петель: сколько раз змейка довела след до своей территории и получила захват.",
		"actor", actors...)

	KillsTotal = newCounterVec("snakes_kills_total",
		"Убийств: смертей, у которых есть виновник. Метка — кто убил.",
		"actor", actors...)

	DeathsTotal = newCounterVec2("snakes_deaths_total",
		"Смертей по причинам: self_trail — свой след, trail_cut — чужой след, head_on — лобовое, wall — стена.",
		"reason", "actor",
		[]string{"self_trail", "trail_cut", "head_on", "wall"}, actors)

	// Кто кого убивает. Отдельно от snakes_kills_total: там видно только
	// сторону убийцы, а вопрос «боты вообще убивают людей или только друг
	// друга» решает именно эта пара меток — по ней и настраивается сложность.
	KillMatchupsTotal = newCounterVec2("snakes_kill_matchups_total",
		"Убийств в разрезе «кто кого»: killer — убийца, victim — жертва.",
		"killer", "victim", actors, actors)

	// Вход в комнату — единственная точка, где видно живой спрос: гейдж
	// snakes_players показывает, сколько сейчас, но не сколько людей вообще
	// заходило за день.
	JoinsTotal = newCounterVec("snakes_joins_total",
		"Входов в комнату, отдельно людьми и ботами.",
		"actor", actors...)

	// Чат отделён от игровых действий намеренно: он показывает не активность,
	// а то, живая ли комната — в пустой комнате никто не пишет.
	ChatMessagesTotal = newCounter("snakes_chat_messages_total",
		"Сообщений в чате, отправленных людьми.")

	RoomPlayersAtStart = newHistogram("snakes_room_players_at_start",
		"Сколько людей было в комнате в момент старта матча.",
		[]float64{0, 1, 2, 4, 8, 12, 16})

	PowerupPickupsTotal = newCounterVec2("snakes_powerup_pickups_total",
		"Подобранных бонусов по типам, отдельно людьми и ботами.",
		"type", "actor",
		[]string{"shield", "dash", "nova", "mega_dash"}, actors)

	MutatorsActivatedTotal = newCounterVec("snakes_mutators_activated_total",
		"Срабатываний мутаторов матча по типам.",
		"mutator", "double_capture", "power_surge")
)

// --- прогресс и экономика --------------------------------------------------

var (
	ContractsCompletedTotal = newCounterVec("snakes_contracts_completed_total",
		"Выполненных контрактов по типам.",
		"type", "kills", "pickups", "capture")

	DailiesCompletedTotal = newCounterVec("snakes_dailies_completed_total",
		"Выполненных ежедневных заданий по типам.",
		"type", "kills", "pickups", "capture", "style")

	StyleAwardedTotal = newCounterVec("snakes_style_awarded_total",
		"Начислено валюты «Стиль» с разбивкой по поводу начисления.",
		"reason", "kill", "revenge", "bounty", "contract", "daily", "win",
		"top5", "capture", "achievement", "survive")

	CosmeticsPurchasedTotal = newCounterVec("snakes_cosmetics_purchased_total",
		"Покупок косметики по категориям.",
		"category", "frame", "nameplate", "seg", "head", "capturefx", "terr", "death")
)

// --- хранилище профилей ----------------------------------------------------

// Read-only режим хранилища раньше было видно ровно из одной строки в логе:
// пробы отвечали 200, дашборды не менялись, а весь заработанный «Стиль» и все
// покупки за следующие часы уезжали в никуда и терялись на рестарте. Гейдж
// нужен именно для алерта — он залипает в 1 до вмешательства оператора.
var (
	ProfilesReadOnly = newGauge("snakes_profiles_read_only",
		"1 — хранилище профилей в read-only после неудачной загрузки: сохранение запрещено, прогресс игроков не переживёт рестарт.")

	ProfilesSaveErrors = newCounter("snakes_profiles_save_errors_total",
		"Неудачных сохранений profiles.json. Растёт — значит автосейв не долетает до диска.")
)

// --- транспорт и ошибки ----------------------------------------------------

var (
	WSConnections = newCounter("snakes_ws_connections_total",
		"Принятых WebSocket-соединений.")

	WSActive = newGauge("snakes_ws_active",
		"Открытых WebSocket-соединений прямо сейчас.")

	WSWriteErrors = newCounter("snakes_ws_write_errors_total",
		"Ошибок записи в сокет.")

	WSDropped = newCounter("snakes_ws_dropped_messages_total",
		"Сообщений, выброшенных из-за переполненной очереди клиента.")

	WSClosedTotal = newCounterVec("snakes_ws_closed_total",
		"Закрытий соединения по причинам: normal — штатное, остальные — отказы.",
		"reason", "normal", "write_error", "send_backpressure",
		"binary_not_allowed", "message_too_big", "rate_limited", "panic")

	WSHandshakeRejectedTotal = newCounterVec("snakes_ws_handshake_rejected_total",
		"Отказов в рукопожатии /ws. origin — Origin не входит в WS_ORIGINS.",
		"reason", "origin")

	RateLimitedTotal = newCounterVec("snakes_ratelimit_triggered_total",
		"Срабатываний rate-limit по видам: ws_command — поток команд от одного адреса.",
		"kind", "ws_command")
)
