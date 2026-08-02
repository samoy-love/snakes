package game

import (
	"math/rand"
	"testing"

	"snakes/internal/metrics"
)

// Метрика проверяется в двух местах: internal/metrics отвечает за формат
// вывода, а этот файл — за то, что счётчик вообще подключён к событию игры.
// Ошибка здесь бесшумная: /metrics отдаёт валидный ноль, цель в Prometheus
// зелёная, а графика нет, и заметить это можно только через неделю.

// Ловит: разрыв между смертью игрока и snakes_deaths_total/snakes_kills_total,
// включая потерю разбивки по причине.
func TestDeathAndKillCountersAreWired(t *testing.T) {
	r := newTestRoom()
	r.rng = rand.New(rand.NewSource(1))
	// Побочные пути смерти (счёт матча, начисление «Стиля») пишут в эти карты;
	// newTestRoom их не заводит, потому что остальным тестам они не нужны.
	r.matchKills = make(map[uint16]uint16)
	r.matchDeaths = make(map[uint16]uint16)
	r.matchStyleEarned = make(map[uint16]uint32)
	r.matchStyleBy = make(map[uint16][StyleReasonCount]uint16)
	r.matchPointsBy = make(map[uint16][8]uint16)
	r.matchContractsBy = make(map[uint16][4]uint16)
	victim := &Player{num: 1, alive: true, x: 5, y: 5}
	killer := &Player{num: 2, alive: true, x: 6, y: 5}
	r.players[1] = victim
	r.players[2] = killer

	// Жертва — человек, убийца — бот: разные стороны должны попасть в разные
	// ряды, иначе метка бессмысленна.
	killer.bot = true

	beforeWall := metrics.DeathsTotal.Load("wall", "player")
	beforeCut := metrics.DeathsTotal.Load("trail_cut", "player")
	beforeKillsBot := metrics.KillsTotal.Load("bot")
	beforeKillsPlayer := metrics.KillsTotal.Load("player")
	beforeMatchup := metrics.KillMatchupsTotal.Load("bot", "player")

	// Смерть без виновника: причина считается, убийство — нет.
	r.killPlayerWithReason(1, 0, "wall", -1, 5, 5)
	if got := metrics.DeathsTotal.Load("wall", "player"); got != beforeWall+1 {
		t.Errorf(`deaths{reason="wall",actor="player"} = %d, ожидалось %d`, got, beforeWall+1)
	}
	if got := metrics.KillsTotal.Load("bot"); got != beforeKillsBot {
		t.Errorf("kills{actor=bot} = %d, ожидалось %d — стена не должна считаться убийством", got, beforeKillsBot)
	}

	// Смерть от чужого следа: считается причина, убийство и пара «кто кого».
	victim.alive = true
	r.killPlayerWithReason(1, 2, "trail_cut", -1, 5, 5)
	if got := metrics.DeathsTotal.Load("trail_cut", "player"); got != beforeCut+1 {
		t.Errorf(`deaths{reason="trail_cut",actor="player"} = %d, ожидалось %d`, got, beforeCut+1)
	}
	if got := metrics.KillsTotal.Load("bot"); got != beforeKillsBot+1 {
		t.Errorf("kills{actor=bot} = %d, ожидалось %d", got, beforeKillsBot+1)
	}
	// Ключевая проверка разделения: убийство бота не должно оседать на людях.
	if got := metrics.KillsTotal.Load("player"); got != beforeKillsPlayer {
		t.Errorf("kills{actor=player} = %d, ожидалось %d — убил бот, а не человек", got, beforeKillsPlayer)
	}
	if got := metrics.KillMatchupsTotal.Load("bot", "player"); got != beforeMatchup+1 {
		t.Errorf(`kill_matchups{killer="bot",victim="player"} = %d, ожидалось %d`, got, beforeMatchup+1)
	}
}

// Ловит: метки, разъехавшиеся с кодами игры. Значение метки — публичный
// контракт метрики, и «other» вместо имени означает, что константу
// перенумеровали, а таблицу не поправили.
func TestLabelTablesCoverEveryCode(t *testing.T) {
	cases := []struct {
		what string
		got  string
		want string
	}{
		{"powerup shield", powerupLabel(PowerupShield), "shield"},
		{"powerup dash", powerupLabel(PowerupDash), "dash"},
		{"powerup nova", powerupLabel(PowerupNova), "nova"},
		{"powerup megadash", powerupLabel(PowerupMegaDash), "mega_dash"},
		{"mutator double", mutatorLabel(MutatorDoubleCapture), "double_capture"},
		{"mutator surge", mutatorLabel(MutatorPowerSurge), "power_surge"},
		{"contract kills", contractLabel(ContractKills), "kills"},
		{"contract pickups", contractLabel(ContractPickups), "pickups"},
		{"contract capture", contractLabel(ContractCapture), "capture"},
		{"daily kills", dailyLabel(DailyKills), "kills"},
		{"daily pickups", dailyLabel(DailyPickups), "pickups"},
		{"daily capture", dailyLabel(DailyCapture), "capture"},
		{"daily style", dailyLabel(DailyStyle), "style"},
		{"style kill", styleReasonLabel(StyleKill), "kill"},
		{"style survive", styleReasonLabel(StyleSurvive), "survive"},
		{"style achievement", styleReasonLabel(StyleAchievement), "achievement"},
		{"close normal", closeReasonLabel(""), "normal"},
		{"close rate", closeReasonLabel("rate_limited"), "rate_limited"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s: метка %q, ожидалась %q", c.what, c.got, c.want)
		}
	}

	// Все коды «Стиля» от 1 до StyleReasonCount-1 обязаны иметь имя: суммарное
	// начисление валюты, часть которого уехала в "other", не сходится ни с чем.
	for code := uint8(1); int(code) < StyleReasonCount; code++ {
		if styleReasonLabel(code) == "other" {
			t.Errorf("код Стиля %d не имеет имени метки", code)
		}
	}
}

// Ловит: срез игры, разошедшийся с содержимым комнат. Он считается на лету при
// сборе, и ошибка здесь показывает пустой сервер на полном.
func TestHubSnapshotCountsRoomContents(t *testing.T) {
	h := NewHub(16)
	r := newTestRoom()
	r.rng = rand.New(rand.NewSource(1))
	r.players[1] = &Player{num: 1, alive: true}
	r.players[2] = &Player{num: 2, alive: true, bot: true}
	r.players[3] = &Player{num: 3, alive: false, bot: true}
	h.rooms[1] = r

	got := h.Snapshot()
	want := metrics.GameSnapshot{Rooms: 1, Players: 1, Bots: 1, MatchesRunning: 1}
	if got != want {
		t.Errorf("Snapshot() = %+v, ожидалось %+v", got, want)
	}

	// Комната в паузе между матчами идущим матчем не считается.
	r.matchEnded = true
	if got := h.Snapshot().MatchesRunning; got != 0 {
		t.Errorf("MatchesRunning = %d после конца матча, ожидалось 0", got)
	}
}
