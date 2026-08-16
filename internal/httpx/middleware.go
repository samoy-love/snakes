package httpx

import (
	"net/http"
	"strings"
	"sync/atomic"
)

// BuildPlaceholder — литерал, который стоит в public/index.html вместо
// идентификатора релиза. Его подменяет scripts/deploy.sh в копии, уезжающей на
// сервер (см. «versioned static» там же); в репозитории литерал остаётся как
// есть, поэтому `go run .` кэша не включает.
const BuildPlaceholder = "__BUILD__"

const immutableCacheControl = "public, max-age=31536000, immutable"

// revalidateCacheControl — «храни, но каждый раз спрашивай». Для соседних ES-модулей
// это строго лучше no-store: no-store запрещает даже условный запрос, поэтому
// каждый F5 тянул все ~20 КБ целиком. С no-cache браузер шлёт
// If-Modified-Since, а http.FileServer отвечает 304 без тела.
// Корректность не страдает: ревалидация происходит всегда, устаревший модуль
// отдан быть не может.
const revalidateCacheControl = "no-cache"

// isVersionedAsset — запрос к статике с настоящим идентификатором релиза в
// query (?v=20260802-abc1234). Пустой v и неподменённый литерал __BUILD__ не
// считаются: в обоих случаях URL не меняется от релиза к релизу, и immutable
// намертво залипил бы у пользователя старый файл.
func isVersionedAsset(r *http.Request) bool {
	v := r.URL.Query().Get("v")
	return v != "" && v != BuildPlaceholder
}

func CacheStaticMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		// HTML — всегда no-store: это единственное место, где записан текущий
		// ?v=..., и закэшированный index.html навсегда прибил бы клиента к
		// старому релизу.
		if path == "/" || path == "/index.html" || strings.HasSuffix(path, ".html") {
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r)
			return
		}
		if strings.HasSuffix(path, ".js") || strings.HasSuffix(path, ".css") {
			// V1: client.js ~490 КБ и style.css ~180 КБ качались заново на
			// каждый F5. С ?v=<релиз> URL меняется при каждом деплое, поэтому
			// immutable безопасен: новый релиз — новый URL — новый запрос.
			//
			// ВАЖНО. Соседние ES-модули (client_errors/audio/fx/net.js)
			// импортируются из client.js по относительным путям, query из
			// <script src> на них НЕ наследуется, и они приходят сюда без v.
			// Рассинхрона версий это не создаёт: index.html отдаётся no-store,
			// поэтому новый релиз всегда приносит новый ?v= для client.js, а
			// соседи ревалидируются на каждый запрос. Но no-store запрещал даже
			// условный запрос — все ~20 КБ качались заново на каждый F5.
			// no-cache оставляет ревалидацию обязательной и даёт 304 без тела.
			if isVersionedAsset(r) {
				w.Header().Set("Cache-Control", immutableCacheControl)
			} else {
				w.Header().Set("Cache-Control", revalidateCacheControl)
			}
			next.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(path, "/emoji-64/") && strings.HasSuffix(path, ".png") {
			w.Header().Set("Cache-Control", immutableCacheControl)
		}
		next.ServeHTTP(w, r)
	})
}

// cspHeader — готовая строка Content-Security-Policy. Собирается один раз на
// процесс: connect-src зависит от WS_ORIGINS, а список приходит из окружения на
// старте и в рантайме не меняется (кроме тестов, зовущих SetWSOriginPolicy).
var cspHeader atomic.Pointer[string]

func init() { rebuildCSP() }

// buildCSP собирает политику.
//
// CSP: everything is same-origin. twemoji is vendored at
// public/vendor/twemoji.min.js, so no CDN exception is needed.
// Note: client uses inline styles (element.style), so style-src includes 'unsafe-inline'.
//
// connect-src раньше был `'self' ws: wss:`, но голая схема в CSP матчит ЛЮБОЙ
// хост: политика не ограничивала WebSocket ничем, хотя обещала same-origin, и
// любая точка инъекции скрипта могла лить токен `?t=` и чат на чужой сокет.
// Теперь источники берутся из того же allowlist, по которому судит
// рукопожатие: адрес, которому мы не дали бы 101, браузер и не откроет.
// img-src сужен до 'self' data: — внешних картинок в public/ нет, эмодзи
// отдаются из /emoji-64/.
func buildCSP() string {
	var connect strings.Builder
	connect.WriteString("connect-src 'self'")
	for _, s := range wsConnectSources() {
		connect.WriteByte(' ')
		connect.WriteString(s)
	}
	return "default-src 'self'; " +
		"script-src 'self'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; " +
		connect.String() + "; " +
		"font-src 'self' data:; " +
		"base-uri 'self'; " +
		"form-action 'self'; " +
		"frame-ancestors 'none'"
}

func rebuildCSP() {
	s := buildCSP()
	cspHeader.Store(&s)
}

func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		if csp := cspHeader.Load(); csp != nil {
			w.Header().Set("Content-Security-Policy", *csp)
		}
		next.ServeHTTP(w, r)
	})
}

// Пробы для systemd и оркестраторов. Именованные функции, а не литералы внутри
// main(): замыканиями они были недостижимы ниоткуда, кроме живого слушателя, и
// httptest их не видел.

func HealthzHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}

// readinessProbe — необязательный источник «мы деградировали». Хранится
// колбэком, а не прямой ссылкой на internal/profiles: транспортный пакет не
// должен знать про хранилище, а импорт в обратную сторону нужен профилям для
// метрик. Пусто — сервис считается готовым, как и было.
var readinessProbe atomic.Pointer[func() (bool, string)]

// SetReadinessProbe подключает проверку готовности. Вызывается из main.
// Колбэк возвращает (ready, reason); reason уходит в тело ответа.
func SetReadinessProbe(f func() (bool, string)) {
	if f == nil {
		readinessProbe.Store(nil)
		return
	}
	readinessProbe.Store(&f)
}

// ReadyzHandler отвечает 503, когда подключённая проверка говорит, что сервис
// деградировал. Это единственный способ для внешнего гейта заметить, например,
// read-only хранилище профилей: /healthz намеренно отвечает 200, пока процесс
// жив, а «жив, но выбрасывает весь прогресс игроков» — это не готовность.
func ReadyzHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if p := readinessProbe.Load(); p != nil {
		if ready, reason := (*p)(); !ready {
			if reason == "" {
				reason = "degraded"
			}
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("not ready: " + reason + "\n"))
			return
		}
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ready\n"))
}
