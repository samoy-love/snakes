package metrics

import (
	"bufio"
	"bytes"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Тесты этого пакета проверяют ровно то, что читает Prometheus: имена, типы и
// значения. Формат разбирается сборщиком построчно и без всякой снисходи-
// тельности — пропущенный `# TYPE`, метка без кавычек или гистограмма без
// `+Inf` не роняют сервер, но делают цель нечитаемой, и узнать об этом можно
// только по пустому графику через неделю.

// scrape снимает метрики так же, как это делает Prometheus.
func scrape(t *testing.T) string {
	t.Helper()
	rec := httptest.NewRecorder()
	Handler(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("код %d, ожидалось 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != ContentType {
		t.Fatalf("Content-Type = %q, ожидалось %q", got, ContentType)
	}
	return rec.Body.String()
}

// sample достаёт значение строки метрики (с метками или без).
func sample(t *testing.T, body, line string) float64 {
	t.Helper()
	sc := bufio.NewScanner(strings.NewReader(body))
	for sc.Scan() {
		s := sc.Text()
		if strings.HasPrefix(s, line+" ") {
			v, err := strconv.ParseFloat(strings.TrimPrefix(s, line+" "), 64)
			if err != nil {
				t.Fatalf("значение %q не парсится: %v", s, err)
			}
			return v
		}
	}
	t.Fatalf("в выводе нет строки %q:\n%s", line, body)
	return 0
}

// Ловит: пропавший заголовок, самодельный тип, метрику без объявления.
// Prometheus молча игнорирует сэмплы, у которых нет `# TYPE`, — цель при этом
// остаётся up, а данных нет.
func TestEveryMetricHasHelpAndType(t *testing.T) {
	body := scrape(t)

	types := map[string]string{}
	helps := map[string]bool{}
	samples := map[string]bool{}

	sc := bufio.NewScanner(strings.NewReader(body))
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "# HELP "):
			f := strings.SplitN(strings.TrimPrefix(line, "# HELP "), " ", 2)
			if len(f) != 2 || strings.TrimSpace(f[1]) == "" {
				t.Fatalf("HELP без текста: %q", line)
			}
			helps[f[0]] = true
		case strings.HasPrefix(line, "# TYPE "):
			f := strings.SplitN(strings.TrimPrefix(line, "# TYPE "), " ", 2)
			if len(f) != 2 {
				t.Fatalf("битый TYPE: %q", line)
			}
			switch f[1] {
			case "counter", "gauge", "histogram", "summary", "untyped":
			default:
				t.Fatalf("неизвестный тип %q в %q", f[1], line)
			}
			types[f[0]] = f[1]
		case line == "" || strings.HasPrefix(line, "#"):
		default:
			name := line
			if i := strings.IndexAny(name, "{ "); i >= 0 {
				name = name[:i]
			}
			// Суффиксы гистограммы принадлежат её базовому имени.
			for _, suf := range []string{"_bucket", "_sum", "_count"} {
				if strings.HasSuffix(name, suf) && types[strings.TrimSuffix(name, suf)] == "histogram" {
					name = strings.TrimSuffix(name, suf)
					break
				}
			}
			samples[name] = true
		}
	}

	if len(samples) == 0 {
		t.Fatal("в выводе нет ни одного сэмпла")
	}
	names := make([]string, 0, len(samples))
	for n := range samples {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		if !helps[n] {
			t.Errorf("%s: нет # HELP", n)
		}
		if types[n] == "" {
			t.Errorf("%s: нет # TYPE", n)
		}
	}
}

// Ловит: переименование метрики. Имя — публичный контракт: по нему написаны
// запросы дашбордов и алертов, и смена имени ломает их молча.
func TestExpectedMetricNamesArePresent(t *testing.T) {
	body := scrape(t)
	want := []string{
		"snakes_build_info",
		// что происходит сейчас
		"snakes_rooms", "snakes_players", "snakes_bots", "snakes_matches_running",
		// игровой процесс
		"snakes_matches_total", "snakes_match_duration_seconds",
		"snakes_match_survivors", "snakes_tick_duration_seconds",
		"snakes_cells_captured_total", "snakes_loops_closed_total",
		"snakes_kills_total", "snakes_deaths_total",
		"snakes_powerup_pickups_total", "snakes_mutators_activated_total",
		// прогресс и экономика
		"snakes_contracts_completed_total", "snakes_dailies_completed_total",
		"snakes_style_awarded_total", "snakes_cosmetics_purchased_total",
		// хранилище профилей
		"snakes_profiles_read_only", "snakes_profiles_save_errors_total",
		// транспорт
		"snakes_ws_connections_total", "snakes_ws_active",
		"snakes_ws_write_errors_total", "snakes_ws_dropped_messages_total",
		"snakes_ws_closed_total", "snakes_ws_handshake_rejected_total",
		"snakes_ratelimit_triggered_total",
	}
	for _, n := range want {
		if !strings.Contains(body, "# TYPE "+n+" ") {
			t.Errorf("метрика %s пропала из вывода", n)
		}
	}
}

// Ловит: счётчик, объявленный, но не подключённый к событию, и счётчик с
// неверным шагом. Именно так метрика становится вечным нулём.
func TestCountersFollowEvents(t *testing.T) {
	before := scrape(t)
	b1 := sample(t, before, "snakes_ws_connections_total")
	b2 := sample(t, before, `snakes_deaths_total{reason="wall",actor="player"}`)
	b3 := sample(t, before, `snakes_cells_captured_total{actor="player"}`)
	b4 := sample(t, before, `snakes_style_awarded_total{reason="capture"}`)

	WSConnections.Inc()
	DeathsTotal.Inc("wall", "player")
	CellsCapturedTotal.Add("player", 17)
	StyleAwardedTotal.Add("capture", 5)

	after := scrape(t)
	if got := sample(t, after, "snakes_ws_connections_total"); got != b1+1 {
		t.Errorf("snakes_ws_connections_total = %v, ожидалось %v", got, b1+1)
	}
	if got := sample(t, after, `snakes_deaths_total{reason="wall",actor="player"}`); got != b2+1 {
		t.Errorf(`snakes_deaths_total{reason="wall",actor="player"} = %v, ожидалось %v`, got, b2+1)
	}
	if got := sample(t, after, `snakes_cells_captured_total{actor="player"}`); got != b3+17 {
		t.Errorf(`snakes_cells_captured_total{actor="player"} = %v, ожидалось %v`, got, b3+17)
	}
	if got := sample(t, after, `snakes_style_awarded_total{reason="capture"}`); got != b4+5 {
		t.Errorf(`snakes_style_awarded_total{reason="capture"} = %v, ожидалось %v`, got, b4+5)
	}
}

// Ловит: метку, появляющуюся только после первого события. Такая метрика даёт
// разрыв в rate() и график, начинающийся из ниоткуда.
func TestKnownLabelsAreExposedFromZero(t *testing.T) {
	body := scrape(t)
	for _, want := range []string{
		`snakes_deaths_total{reason="self_trail",actor="player"}`,
		`snakes_deaths_total{reason="self_trail",actor="bot"}`,
		`snakes_deaths_total{reason="trail_cut",actor="player"}`,
		`snakes_deaths_total{reason="head_on",actor="bot"}`,
		`snakes_powerup_pickups_total{type="shield",actor="player"}`,
		`snakes_powerup_pickups_total{type="mega_dash",actor="bot"}`,
		`snakes_kills_total{actor="player"}`,
		`snakes_kills_total{actor="bot"}`,
		`snakes_cells_captured_total{actor="player"}`,
		`snakes_loops_closed_total{actor="bot"}`,
		`snakes_kill_matchups_total{killer="bot",victim="player"}`,
		`snakes_kill_matchups_total{killer="player",victim="player"}`,
		`snakes_mutators_activated_total{mutator="double_capture"}`,
		`snakes_contracts_completed_total{type="capture"}`,
		`snakes_dailies_completed_total{type="style"}`,
		`snakes_cosmetics_purchased_total{category="frame"}`,
		`snakes_ws_closed_total{reason="rate_limited"}`,
		`snakes_ws_handshake_rejected_total{reason="origin"}`,
		`snakes_ratelimit_triggered_total{kind="ws_command"}`,
	} {
		if !strings.Contains(body, want+" ") {
			t.Errorf("нет строки %s — метка появится только после первого события", want)
		}
	}
}

// Ловит: гистограмму без +Inf или без _sum/_count и невозрастающие корзины.
// histogram_quantile на такой возвращает NaN, не жалуясь.
func TestHistogramIsCumulativeAndComplete(t *testing.T) {
	h := newHistogram("snakes_test_histogram_seconds", "Тестовая гистограмма.",
		[]float64{0.001, 0.01, 0.1})
	h.Observe(0.0005)
	h.Observe(0.05)
	h.ObserveDuration(2 * time.Second)

	var buf bytes.Buffer
	w := bufio.NewWriter(&buf)
	h.writeSamples(w)
	w.Flush()
	body := buf.String()

	if got := sample(t, body, `snakes_test_histogram_seconds_bucket{le="0.001"}`); got != 1 {
		t.Errorf("корзина 0.001 = %v, ожидалась 1", got)
	}
	// Корзины кумулятивны: 0.1 обязана включать и 0.0005, и 0.05.
	if got := sample(t, body, `snakes_test_histogram_seconds_bucket{le="0.1"}`); got != 2 {
		t.Errorf("корзина 0.1 = %v, ожидалось 2 (корзины должны быть кумулятивными)", got)
	}
	if got := sample(t, body, `snakes_test_histogram_seconds_bucket{le="+Inf"}`); got != 3 {
		t.Errorf("+Inf = %v, ожидалось 3", got)
	}
	if got := sample(t, body, "snakes_test_histogram_seconds_count"); got != 3 {
		t.Errorf("_count = %v, ожидалось 3", got)
	}
	if got := sample(t, body, "snakes_test_histogram_seconds_sum"); got != 2.0505 {
		t.Errorf("_sum = %v, ожидалось 2.0505", got)
	}
}

// Ловит: мгновенные величины, оторванные от игры. Без обновления в момент
// сбора Prometheus видит состояние на момент последнего события.
func TestGaugesComeFromGameSnapshot(t *testing.T) {
	t.Cleanup(func() { SetGameSnapshot(nil) })
	SetGameSnapshot(func() GameSnapshot {
		return GameSnapshot{Rooms: 3, Players: 7, Bots: 42, MatchesRunning: 2}
	})
	body := scrape(t)
	for _, c := range []struct {
		line string
		want float64
	}{
		{"snakes_rooms", 3},
		{"snakes_players", 7},
		{"snakes_bots", 42},
		{"snakes_matches_running", 2},
	} {
		if got := sample(t, body, c.line); got != c.want {
			t.Errorf("%s = %v, ожидалось %v", c.line, got, c.want)
		}
	}
}

// Ловит: версию сборки, не доехавшую до метрики, и незаэкранированную метку.
func TestBuildInfoCarriesVersion(t *testing.T) {
	SetBuildInfo(`v1.2.3"x`, "abcdef")
	body := scrape(t)
	want := `snakes_build_info{version="v1.2.3\"x",commit="abcdef"} 1`
	if !strings.Contains(body, want) {
		t.Errorf("нет строки %s:\n%s", want, body)
	}
}

// Ловит: неустойчивый порядок строк. Разъезжающийся вывод невозможно ни
// продиффать при разборе инцидента, ни сравнить с эталоном.
func TestOutputIsStable(t *testing.T) {
	a := scrape(t)
	b := scrape(t)
	if a != b {
		t.Error("два подряд снятых снимка отличаются")
	}
}
