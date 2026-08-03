package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Ловит: пропажу любого защитного заголовка. CSP здесь — не украшение:
// клиент грузит twemoji из public/vendor, и стоит появиться исключению для
// CDN, как в игру можно подмешать сторонний скрипт.
func TestSecurityHeadersMiddleware(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := SecurityHeadersMiddleware(next)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	want := map[string]string{
		"X-Content-Type-Options":       "nosniff",
		"X-Frame-Options":              "DENY",
		"Referrer-Policy":              "no-referrer",
		"Cross-Origin-Opener-Policy":   "same-origin",
		"Cross-Origin-Resource-Policy": "same-origin",
		"Permissions-Policy":           "geolocation=(), microphone=(), camera=()",
	}
	for k, v := range want {
		if got := rec.Header().Get(k); got != v {
			t.Fatalf("%s = %q, ожидалось %q", k, got, v)
		}
	}

	csp := rec.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("CSP не выставлена")
	}
	for _, part := range []string{
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"connect-src 'self'",
		"font-src 'self' data:",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	} {
		if !strings.Contains(csp, part) {
			t.Fatalf("в CSP нет директивы %q: %s", part, csp)
		}
	}
	// Никаких внешних источников для скриптов: twemoji вендорится локально.
	if strings.Contains(csp, "script-src 'self' http") || strings.Contains(csp, "unsafe-eval") {
		t.Fatalf("script-src ослаблена: %s", csp)
	}
	// 'unsafe-inline' допустим ТОЛЬКО в style-src (клиент правит element.style).
	for _, dir := range strings.Split(csp, ";") {
		dir = strings.TrimSpace(dir)
		if strings.Contains(dir, "'unsafe-inline'") && !strings.HasPrefix(dir, "style-src") {
			t.Fatalf("'unsafe-inline' просочился в директиву %q", dir)
		}
	}

	// Ловит: возврат голых источников-схем. `ws:`, `wss:`, `https:` матчат
	// ЛЮБОЙ хост — директива с ними выглядит ограничением, но не ограничивает
	// ничего. Именно так connect-src разрешал сокет на чужой домен.
	for _, bare := range []string{"ws:", "wss:", "https:", "http:"} {
		for _, tok := range strings.Fields(strings.ReplaceAll(csp, ";", " ")) {
			if tok == bare {
				t.Fatalf("в CSP голый источник-схема %q — он матчит любой хост: %s", bare, csp)
			}
		}
	}

	// Заголовки ставятся до вызова next, то есть и на ответах с ошибкой.
	boom := SecurityHeadersMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	rec = httptest.NewRecorder()
	boom.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/missing", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("код ответа = %d", rec.Code)
	}
	if rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("на ответе с ошибкой защитные заголовки потеряны")
	}
}

// Ловит: признание неподменённого литерала __BUILD__ настоящей версией — с
// ним immutable намертво залипил бы у пользователя старый client.js.
func TestIsVersionedAsset(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"/client.js", false},
		{"/client.js?v=", false},
		{"/client.js?v=" + BuildPlaceholder, false},
		{"/client.js?v=20260802-abc1234", true},
		{"/client.js?x=1&v=rel", true},
		{"/client.js?v=0", true},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, c.url, nil)
		if got := isVersionedAsset(req); got != c.want {
			t.Fatalf("isVersionedAsset(%q) = %v, ожидалось %v", c.url, got, c.want)
		}
	}
}

// Ловит: connect-src, оторванный от WS_ORIGINS. Если директива перестанет
// следовать за allowlist, политика снова начнёт разрешать (или запрещать) не
// то, что рукопожатие, и разойдётся с ним молча.
func TestCSPConnectSrcFollowsWSOrigins(t *testing.T) {
	restore := SetWSOriginPolicy([]string{"https://snakes.example", "http://localhost:8080"}, false)
	defer restore()

	rec := httptest.NewRecorder()
	SecurityHeadersMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})).
		ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	csp := rec.Header().Get("Content-Security-Policy")

	for _, want := range []string{
		"connect-src 'self' ws://localhost:8080 wss://snakes.example;",
	} {
		if !strings.Contains(csp, want) {
			t.Fatalf("в CSP нет %q: %s", want, csp)
		}
	}

	// Origin, которого нет в allowlist, не должен появиться и в политике.
	if strings.Contains(csp, "evil") {
		t.Fatalf("в connect-src просочился посторонний источник: %s", csp)
	}
}

// Ловит: readiness, который отвечает «готов», пока сервис выбрасывает данные.
// Именно так read-only хранилище профилей часами оставалось незамеченным:
// пробы зелёные, метрик нет, прогресс игроков в никуда.
func TestReadyzReportsDegradedState(t *testing.T) {
	t.Cleanup(func() { SetReadinessProbe(nil) })

	SetReadinessProbe(func() (bool, string) { return false, "profiles read-only (parse_error)" })
	rec := httptest.NewRecorder()
	ReadyzHandler(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("код %d, ожидалось 503", rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, "parse_error") {
		t.Fatalf("тело %q не называет причину", body)
	}

	// Снятая проверка возвращает прежнее поведение.
	SetReadinessProbe(nil)
	rec = httptest.NewRecorder()
	ReadyzHandler(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "ready\n" {
		t.Fatalf("без проверки: код %d, тело %q", rec.Code, rec.Body.String())
	}
}

// Ловит: пропажу no-store или смену кода/тела у проб. /healthz — это
// liveness-проба выкатки: закэшированный ответ означал бы «живой» после того,
// как процесс уже умер.
func TestProbeHandlers(t *testing.T) {
	cases := []struct {
		name string
		h    http.HandlerFunc
		body string
	}{
		{"/healthz", HealthzHandler, "ok\n"},
		{"/readyz", ReadyzHandler, "ready\n"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		c.h(rec, httptest.NewRequest(http.MethodGet, c.name, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: код %d, ожидалось 200", c.name, rec.Code)
		}
		if got := rec.Header().Get("Content-Type"); got != "text/plain; charset=utf-8" {
			t.Fatalf("%s: Content-Type = %q", c.name, got)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("%s: Cache-Control = %q, ожидалось no-store", c.name, got)
		}
		if got := rec.Body.String(); got != c.body {
			t.Fatalf("%s: тело %q, ожидалось %q", c.name, got, c.body)
		}
	}
}
