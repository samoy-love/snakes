package main

import (
	"encoding/json"
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
	h := securityHeadersMiddleware(next)
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
		"img-src 'self' data: https:",
		"connect-src 'self' ws: wss:",
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

	// Заголовки ставятся до вызова next, то есть и на ответах с ошибкой.
	boom := securityHeadersMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		{"/client.js?v=" + buildPlaceholder, false},
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

// Ловит: молчаливое принятие мусора в числовых переменных окружения
// (PORT/ROOM_LIMIT читаются через parseInt).
func TestParseInt(t *testing.T) {
	cases := []struct {
		in   string
		want int
		ok   bool
	}{
		{"0", 0, true},
		{"42", 42, true},
		{"-7", -7, true},
		{"", 0, false},
		{"abc", 0, false},
	}
	for _, c := range cases {
		got, err := parseInt(c.in)
		if (err == nil) != c.ok {
			t.Fatalf("parseInt(%q): err=%v, ожидалось ok=%v", c.in, err, c.ok)
		}
		if c.ok && got != c.want {
			t.Fatalf("parseInt(%q) = %d, ожидалось %d", c.in, got, c.want)
		}
	}
}

// Ловит: пропажу no-store или смену кода/тела у проб. /healthz — это
// HEALTHCHECK контейнера: закэшированный ответ означал бы «живой» после того,
// как процесс уже умер.
func TestProbeHandlers(t *testing.T) {
	cases := []struct {
		name string
		h    http.HandlerFunc
		body string
	}{
		{"/healthz", healthzHandler, "ok\n"},
		{"/readyz", readyzHandler, "ready\n"},
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

// Ловит: поломку формата /metrics и потерю связи счётчиков с metrics.*.
// Ответ парсится внешним сбором, поэтому это обязан быть валидный JSON с
// ровно этими четырьмя ключами.
func TestMetricsHandler(t *testing.T) {
	read := func() map[string]int64 {
		rec := httptest.NewRecorder()
		metricsHandler(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("код %d, ожидалось 200", rec.Code)
		}
		if got := rec.Header().Get("Content-Type"); got != "application/json" {
			t.Fatalf("Content-Type = %q, ожидалось application/json", got)
		}
		var m map[string]int64
		if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
			t.Fatalf("тело /metrics не JSON (%v): %s", err, rec.Body.String())
		}
		if len(m) != 4 {
			t.Fatalf("в ответе %d счётчиков, ожидалось 4: %s", len(m), rec.Body.String())
		}
		for _, k := range []string{"wsConnections", "wsActive", "wsWriteErrors", "wsDropped"} {
			if _, ok := m[k]; !ok {
				t.Fatalf("нет счётчика %q: %s", k, rec.Body.String())
			}
		}
		return m
	}

	before := read()
	metrics.wsConnections.Add(1)
	metrics.wsActive.Add(1)
	metrics.wsWriteErrors.Add(1)
	metrics.wsDropped.Add(1)
	// Счётчики глобальные — возвращаем их на место, чтобы соседние тесты
	// видели то же, что и до нас.
	defer func() {
		metrics.wsConnections.Add(^uint64(0))
		metrics.wsActive.Add(-1)
		metrics.wsWriteErrors.Add(^uint64(0))
		metrics.wsDropped.Add(^uint64(0))
	}()
	after := read()
	for k, v := range before {
		if after[k] != v+1 {
			t.Fatalf("%s = %d, ожидалось %d — счётчик отвязан от metrics.*", k, after[k], v+1)
		}
	}
}

// mustCwd обязан возвращать что-то пригодное для filepath.Join, а не пустую
// строку: на ней http.Dir("") отдаёт корень файловой системы.
func TestMustCwdIsNeverEmpty(t *testing.T) {
	if got := mustCwd(); got == "" {
		t.Fatal("mustCwd вернул пустую строку — раздача статики уехала бы в корень ФС")
	}
}
