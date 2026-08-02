package httpx

import (
	"net/http"
	"strings"
)

// BuildPlaceholder — литерал, который стоит в public/index.html вместо
// идентификатора релиза. Его подменяет scripts/deploy.sh в копии, уезжающей на
// сервер (см. «versioned static» там же); в репозитории литерал остаётся как
// есть, поэтому `go run .` кэша не включает.
const BuildPlaceholder = "__BUILD__"

const immutableCacheControl = "public, max-age=31536000, immutable"

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
			// <script src> на них НЕ наследуется, и они приходят сюда без v —
			// то есть остаются на no-store. Это осознанно: суммарно они ~20 КБ.
			if isVersionedAsset(r) {
				w.Header().Set("Cache-Control", immutableCacheControl)
			} else {
				w.Header().Set("Cache-Control", "no-store")
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

func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		// CSP: everything is same-origin. twemoji is vendored at
		// public/vendor/twemoji.min.js, so no CDN exception is needed.
		// Note: client uses inline styles (element.style), so style-src includes 'unsafe-inline'.
		w.Header().Set(
			"Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self'; "+
				"style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: https:; "+
				"connect-src 'self' ws: wss:; "+
				"font-src 'self' data:; "+
				"base-uri 'self'; "+
				"form-action 'self'; "+
				"frame-ancestors 'none'",
		)
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

func ReadyzHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ready\n"))
}

// FaviconHandler отвечает пустотой, чтобы не ловить 404 в логах.
func FaviconHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
