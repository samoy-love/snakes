package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	roomLimit := RoomHumanLimitDefault
	if v := os.Getenv("ROOM_LIMIT"); v != "" {
		if n, err := parseInt(v); err == nil && n > 0 {
			roomLimit = n
		}
	}

	initProfileSecret()
	loadProfiles()
	log.Printf("limits roomLimit=%d maxRooms=%d maxProfiles=%d profileEmptyTTL=%s wsAllowLocalhost=%t botDeathLog=%t",
		roomLimit, maxRoomsLimit, maxProfiles, profileEmptyTTL, wsAllowLocalhost, debugBotDeathSnap)
	autosaveStop := make(chan struct{})
	startProfilesAutosave(autosaveStop)

	hub := &Hub{rooms: make(map[int]*Room), nextRoomID: 1, roomLimit: roomLimit}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWS(hub, w, r)
	})
	mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	})
	// Liveness/readiness for container orchestration and HEALTHCHECK.
	mux.HandleFunc("/healthz", healthzHandler)
	mux.HandleFunc("/readyz", readyzHandler)
	mux.HandleFunc("/metrics", metricsHandler)

	publicDir := filepath.Join(mustCwd(), "public")
	fs := http.FileServer(http.Dir(publicDir))
	mux.Handle("/", cacheStaticMiddleware(fs))

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           securityHeadersMiddleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("listening on http://localhost:%s\n", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 2)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)

	hub.mu.Lock()
	for _, rm := range hub.rooms {
		rm.close()
	}
	hub.mu.Unlock()

	close(autosaveStop)
	flushProfiles(true)
}

// The three probe handlers are named functions rather than literals inside
// main() so tests can drive them through httptest: as closures they were
// unreachable from anywhere but a live listener.

func healthzHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}

func readyzHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ready\n"))
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(
		"{\"wsConnections\":%d,\"wsActive\":%d,\"wsWriteErrors\":%d,\"wsDropped\":%d}\n",
		metrics.wsConnections.Load(),
		metrics.wsActive.Load(),
		metrics.wsWriteErrors.Load(),
		metrics.wsDropped.Load(),
	)))
}

func mustCwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func parseInt(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	return n, err
}

// buildPlaceholder — литерал, который стоит в public/index.html вместо
// идентификатора релиза. Его подменяет scripts/deploy.sh в копии, уезжающей на
// сервер (см. «versioned static» там же); в репозитории литерал остаётся как
// есть, поэтому `go run .` и docker-сборка из исходников кэша не включают.
const buildPlaceholder = "__BUILD__"

const immutableCacheControl = "public, max-age=31536000, immutable"

// isVersionedAsset — запрос к статике с настоящим идентификатором релиза в
// query (?v=20260802-abc1234). Пустой v и неподменённый литерал __BUILD__ не
// считаются: в обоих случаях URL не меняется от релиза к релизу, и immutable
// намертво залипил бы у пользователя старый файл.
func isVersionedAsset(r *http.Request) bool {
	v := r.URL.Query().Get("v")
	return v != "" && v != buildPlaceholder
}

func cacheStaticMiddleware(next http.Handler) http.Handler {
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

func securityHeadersMiddleware(next http.Handler) http.Handler {
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
