package httpx

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// WS_ALLOW_LOCALHOST
// ---------------------------------------------------------------------------

func TestWSOriginLocalhostIsGated(t *testing.T) {
	prevList := allowedWSOrigins
	allowedWSOrigins = map[string]struct{}{"https://snakes.example.com": {}}
	prevFlag := wsAllowLocalhost
	t.Cleanup(func() {
		allowedWSOrigins = prevList
		wsAllowLocalhost = prevFlag
	})

	req := func(origin string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/ws", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		return r
	}
	loopback := []string{"http://localhost:3000", "http://127.0.0.1:8080", "http://[::1]:3000"}

	wsAllowLocalhost = true
	for _, o := range loopback {
		if !WSOriginAllowed(req(o)) {
			t.Fatalf("в дев-режиме origin %q должен приниматься", o)
		}
	}

	wsAllowLocalhost = false
	for _, o := range loopback {
		if WSOriginAllowed(req(o)) {
			t.Fatalf("при WS_ALLOW_LOCALHOST=0 origin %q должен отвергаться", o)
		}
	}
	// Флаг не влияет ни на allowlist, ни на клиента без Origin.
	if !WSOriginAllowed(req("https://snakes.example.com")) {
		t.Fatal("origin из allowlist отвергнут")
	}
	if !WSOriginAllowed(req("")) {
		t.Fatal("запрос без Origin отвергнут")
	}
	if WSOriginAllowed(req("https://evil.example.com")) {
		t.Fatal("чужой origin принят")
	}
}

// G9: дефолт — ВЫКЛЮЧЕНО. Локальная страница на машине игрока не должна
// проходить allowlist только потому, что она локальная; на проде это
// проверялось живьём (Origin: http://localhost -> 101).
func TestLoadWSAllowLocalhostEnv(t *testing.T) {
	for _, v := range []string{"", "0", "false", "no", "off", "OFF", "мусор"} {
		t.Setenv("WS_ALLOW_LOCALHOST", v)
		if loadWSAllowLocalhost() {
			t.Fatalf("WS_ALLOW_LOCALHOST=%q должен оставлять localhost выключенным", v)
		}
	}
	for _, v := range []string{"1", "true", "yes", "on", "ON"} {
		t.Setenv("WS_ALLOW_LOCALHOST", v)
		if !loadWSAllowLocalhost() {
			t.Fatalf("WS_ALLOW_LOCALHOST=%q должен включать localhost", v)
		}
	}
}

// ---------------------------------------------------------------------------
// requestClientIP / доверенные прокси
// ---------------------------------------------------------------------------

func TestRequestClientIPTrustedProxies(t *testing.T) {
	prev := trustedProxyNets
	InitTrustedProxies("127.0.0.1/8,::1,10.0.0.0/8")
	t.Cleanup(func() { trustedProxyNets = prev })

	cases := []struct {
		name   string
		remote string
		xff    string
		want   string
	}{
		{"untrusted_peer_xff_ignored", "203.0.113.7:5555", "1.2.3.4", "203.0.113.7"},
		{"trusted_peer_no_xff", "127.0.0.1:5555", "", "127.0.0.1"},
		{"trusted_peer_single_hop", "127.0.0.1:5555", "198.51.100.9", "198.51.100.9"},
		// Скан справа налево: доверенные хопы пропускаем, первый недоверенный - ответ.
		{"scan_right_to_left", "127.0.0.1:5555", "9.9.9.9, 198.51.100.9, 10.1.2.3", "198.51.100.9"},
		// Всё, что левее правого недоверенного хопа, подконтрольно атакующему.
		{"spoofed_left_part_ignored", "127.0.0.1:5555", "6.6.6.6, 198.51.100.9", "198.51.100.9"},
		// Битая цепочка: цепочке больше не верим совсем.
		{"malformed_chain", "127.0.0.1:5555", "198.51.100.9, junk", "127.0.0.1"},
		{"empty_entries", "127.0.0.1:5555", "198.51.100.9, ,", "198.51.100.9"},
		{"all_hops_trusted", "127.0.0.1:5555", "10.0.0.1, 10.0.0.2", "127.0.0.1"},
		{"remote_without_port", "127.0.0.1", "198.51.100.9", "198.51.100.9"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/ws", nil)
			r.RemoteAddr = tc.remote
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if got := ClientIP(r); got != tc.want {
				t.Fatalf("requestClientIP = %q, ожидалось %q", got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

func TestRateLimiterBurstAndRefill(t *testing.T) {
	l := &IPRateLimiter{buckets: make(map[string]*tokenBucket)}
	const rate, burst = 1.0, 3.0

	for i := 0; i < int(burst); i++ {
		if !l.Allow("ip|join", rate, burst) {
			t.Fatalf("запрос %d из burst должен пройти", i+1)
		}
	}
	if l.Allow("ip|join", rate, burst) {
		t.Fatal("burst исчерпан, следующий запрос должен быть отклонён")
	}

	// Пополнение: 2 секунды при rate=1/с дают ровно 2 токена.
	b := l.buckets["ip|join"]
	b.last = b.last.Add(-2 * time.Second)
	for i := 0; i < 2; i++ {
		if !l.Allow("ip|join", rate, burst) {
			t.Fatalf("после пополнения запрос %d должен пройти", i+1)
		}
	}
	if l.Allow("ip|join", rate, burst) {
		t.Fatal("пополнено только 2 токена, третий запрос должен быть отклонён")
	}

	// Накопление ограничено burst, а не временем простоя.
	b.last = b.last.Add(-1000 * time.Second)
	for i := 0; i < int(burst); i++ {
		if !l.Allow("ip|join", rate, burst) {
			t.Fatalf("после долгого простоя запрос %d должен пройти", i+1)
		}
	}
	if l.Allow("ip|join", rate, burst) {
		t.Fatal("после простоя накоплено больше burst токенов")
	}

	// Ключи независимы: у другого типа сообщения свой бакет.
	if !l.Allow("ip|chat", rate, burst) {
		t.Fatal("отдельный ключ должен иметь собственный бакет")
	}
}

// TestRateLimiterSweepsOnAcceptedPath — регрессия: очистка стояла ПОСЛЕ
// раннего return на успешном пути, поэтому карта бакетов чистилась только
// когда кого-то лимитировали, и на спокойном сервере росла без предела.
func TestRateLimiterSweepsOnAcceptedPath(t *testing.T) {
	l := &IPRateLimiter{buckets: make(map[string]*tokenBucket)}
	stale := time.Now().Add(-time.Hour)
	for i := 0; i < rateLimiterSweepAt+10; i++ {
		l.buckets[fmt.Sprintf("stale|%d", i)] = &tokenBucket{
			tokens: 1, last: stale, lastSeen: stale, rate: 1, burst: 1,
		}
	}
	before := len(l.buckets)

	// Один-единственный УСПЕШНЫЙ запрос обязан запустить очистку.
	if !l.Allow("fresh|input", 10, 10) {
		t.Fatal("первый запрос нового ключа должен пройти")
	}
	if len(l.buckets) >= before {
		t.Fatalf("карта не почищена на успешном пути: было %d, стало %d", before, len(l.buckets))
	}
	if _, ok := l.buckets["fresh|input"]; !ok {
		t.Fatal("очистка удалила только что использованный бакет")
	}
	if len(l.buckets) != 1 {
		t.Fatalf("после очистки осталось %d бакетов, ожидался 1", len(l.buckets))
	}
}

func TestRateLimiterSweepIsThrottled(t *testing.T) {
	l := &IPRateLimiter{buckets: make(map[string]*tokenBucket)}
	now := time.Now()
	l.lastSweep = now
	stale := now.Add(-time.Hour)
	for i := 0; i < rateLimiterSweepAt+10; i++ {
		l.buckets[fmt.Sprintf("stale|%d", i)] = &tokenBucket{
			tokens: 1, last: stale, lastSeen: stale, rate: 1, burst: 1,
		}
	}
	l.sweepLocked(now)
	if len(l.buckets) != rateLimiterSweepAt+10 {
		t.Fatalf("свип отработал раньше интервала: осталось %d", len(l.buckets))
	}
	l.sweepLocked(now.Add(rateLimiterSweepEvery + time.Second))
	if len(l.buckets) != 0 {
		t.Fatalf("после интервала свип должен был всё удалить, осталось %d", len(l.buckets))
	}
}

// TestWSOriginAllowlistLoaderNormalizes фиксирует, что WS_ORIGINS парсится в
// тот же канонический вид, с которым сравнивается заголовок Origin.
func TestWSOriginAllowlistLoaderNormalizes(t *testing.T) {
	t.Setenv("WS_ORIGINS", " HTTPS://Snakes.Example.COM/ , http://a.test:8080 ")
	got := loadAllowedWSOrigins()
	want := []string{"https://snakes.example.com", "http://a.test:8080"}
	if len(got) != len(want) {
		t.Fatalf("allowlist = %v, ожидалось %v", got, want)
	}
	for _, w := range want {
		if _, ok := got[w]; !ok {
			t.Fatalf("в allowlist нет %q: %v", w, got)
		}
	}
}
