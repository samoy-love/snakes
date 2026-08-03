package httpx

import (
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
)

// allowedWSOrigins is the WebSocket origin allowlist. It is seeded from the
// WS_ORIGINS env var (comma-separated), falling back to the production host.
// Without this, any deployment on a different domain is rejected at the
// handshake.
var allowedWSOrigins = loadAllowedWSOrigins()

func loadAllowedWSOrigins() map[string]struct{} {
	out := make(map[string]struct{})
	raw := strings.TrimSpace(os.Getenv("WS_ORIGINS"))
	if raw == "" {
		out["https://snakes.samoy.love"] = struct{}{}
		out["http://snakes.samoy.love"] = struct{}{}
		return out
	}
	for _, part := range strings.Split(raw, ",") {
		if o := normalizeWSOrigin(part); o != "" {
			out[o] = struct{}{}
		}
	}
	return out
}

// normalizeWSOrigin makes both sides of the allowlist comparison canonical:
// scheme and host are case-insensitive, a trailing slash is not significant.
func normalizeWSOrigin(s string) string {
	s = strings.TrimRight(strings.TrimSpace(s), "/")
	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return strings.ToLower(s)
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host)
}

// wsAllowLocalhost keeps the "any loopback Origin is fine" shortcut. It is
// convenient in development and a hole in production, where it hands a page
// served by malware on the player's own machine a valid Origin: production was
// measured answering 101 to `Origin: http://localhost`.
//
// G9: OFF by default. Development turns it on explicitly with
// WS_ALLOW_LOCALHOST=1 (also true/yes/on).
var wsAllowLocalhost = loadWSAllowLocalhost()

func loadWSAllowLocalhost() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("WS_ALLOW_LOCALHOST"))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// WSAllowLocalhost — состояние той самой лазейки. Нужно стартовому логу: в
// проде она обязана быть выключена, и это надо видеть в journalctl.
func WSAllowLocalhost() bool { return wsAllowLocalhost }

// SetWSOriginPolicy подменяет allowlist и режим localhost и возвращает функцию
// восстановления.
//
// Нужна тем тестам, которые поднимают настоящий httptest-сервер и гоняют живое
// рукопожатие: подменить окружение после инициализации пакета уже нельзя.
// Боевая политика приходит из WS_ORIGINS/WS_ALLOW_LOCALHOST один раз при
// старте, и звать это из рабочего кода незачем.
func SetWSOriginPolicy(origins []string, allowLocalhost bool) (restore func()) {
	prevList := allowedWSOrigins
	prevFlag := wsAllowLocalhost
	next := make(map[string]struct{}, len(origins))
	for _, o := range origins {
		if n := normalizeWSOrigin(o); n != "" {
			next[n] = struct{}{}
		}
	}
	allowedWSOrigins = next
	wsAllowLocalhost = allowLocalhost
	// connect-src в CSP собран из этого же списка, иначе тест с живым
	// рукопожатием увидел бы политику от прежнего окружения.
	rebuildCSP()
	return func() {
		allowedWSOrigins = prevList
		wsAllowLocalhost = prevFlag
		rebuildCSP()
	}
}

// wsConnectSources переводит allowlist рукопожатия в источники для CSP
// connect-src: http:// -> ws://, https:// -> wss://. Сам http(s)-origin в
// connect-src не нужен — по нему ходит только страница, а её покрывает 'self'.
//
// Порядок обхода карты случайный, а заголовок обязан быть побайтово
// стабильным, иначе его не сравнить между ответами при разборе инцидента.
func wsConnectSources() []string {
	out := make([]string, 0, len(allowedWSOrigins))
	for o := range allowedWSOrigins {
		switch {
		case strings.HasPrefix(o, "https://"):
			out = append(out, "wss://"+strings.TrimPrefix(o, "https://"))
		case strings.HasPrefix(o, "http://"):
			out = append(out, "ws://"+strings.TrimPrefix(o, "http://"))
		}
	}
	sort.Strings(out)
	return out
}

func isLoopbackOriginHost(h string) bool {
	h = strings.ToLower(strings.TrimSpace(h))
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

// WSOriginAllowed is the single arbiter of the WebSocket Origin check;
// websocket.Accept runs with InsecureSkipVerify so nothing rejects earlier.
func WSOriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		// Non-browser client: no Origin to judge.
		return true
	}
	if wsAllowLocalhost {
		if u, err := url.Parse(origin); err == nil && isLoopbackOriginHost(u.Hostname()) {
			return true
		}
	}
	_, ok := allowedWSOrigins[normalizeWSOrigin(origin)]
	return ok
}
