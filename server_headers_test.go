package main

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

// mustCwd обязан возвращать что-то пригодное для filepath.Join, а не пустую
// строку: на ней http.Dir("") отдаёт корень файловой системы.
func TestMustCwdIsNeverEmpty(t *testing.T) {
	if got := mustCwd(); got == "" {
		t.Fatal("mustCwd вернул пустую строку — раздача статики уехала бы в корень ФС")
	}
}
