// Точка входа: разбор окружения, сборка HTTP-роутера и корректное выключение.
// Всё остальное живёт в internal/ — игра в internal/game, транспортные
// обвязки в internal/httpx, профили в internal/profiles, счётчики в
// internal/metrics.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"snakes/internal/envcfg"
	"snakes/internal/game"
	"snakes/internal/httpx"
	"snakes/internal/metrics"
	"snakes/internal/profiles"
)

// Build metadata, injected by the linker:
//
//	-ldflags "-X main.Version=... -X main.Commit=... -X main.BuildTime=..."
var (
	Version   = "dev"
	Commit    = "none"
	BuildTime = "unknown"
)

func main() {
	log.Printf("snakes build version=%s commit=%s buildTime=%s", Version, Commit, BuildTime)
	game.SetBuildVersion(Version)
	metrics.SetBuildInfo(Version, Commit)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	// Interface to bind. Loopback by DEFAULT: in production this is a systemd
	// unit sitting behind the host's nginx, and nothing outside the machine has
	// any business talking to the Go process directly.
	//
	// This used to be ":"+port, i.e. 0.0.0.0, so the game port was reachable
	// from the internet — bypassing every rate limit, origin check and security
	// header that live in the nginx config.
	listenAddr := httpx.ResolveListenAddr(os.Getenv("BIND_ADDR"), port)

	roomLimit := game.RoomHumanLimitDefault
	if v := os.Getenv("ROOM_LIMIT"); v != "" {
		if n, err := envcfg.ParseInt(v); err == nil && n > 0 {
			roomLimit = n
		}
	}

	profiles.InitSecret()
	profiles.Load(game.EnsureProfileCosmetics)
	log.Printf("limits roomLimit=%d maxRooms=%d maxProfiles=%d profileEmptyTTL=%s wsAllowLocalhost=%t botDeathLog=%t",
		roomLimit, game.MaxRooms(), profiles.MaxProfiles, profiles.EmptyTTL, httpx.WSAllowLocalhost(), game.BotDeathLogEnabled())
	autosaveStop := make(chan struct{})
	profiles.StartAutosave(autosaveStop)

	hub := game.NewHub(roomLimit)
	metrics.SetGameSnapshot(hub.Snapshot)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.HandleWS)
	mux.HandleFunc("/favicon.ico", httpx.FaviconHandler)
	// Liveness/readiness for systemd and whatever sits in front of it.
	mux.HandleFunc("/healthz", httpx.HealthzHandler)
	mux.HandleFunc("/readyz", httpx.ReadyzHandler)
	mux.HandleFunc("/metrics", metrics.Handler)

	publicDir := filepath.Join(mustCwd(), "public")
	fs := http.FileServer(http.Dir(publicDir))
	mux.Handle("/", httpx.CacheStaticMiddleware(fs))

	srv := &http.Server{
		Addr:              listenAddr,
		Handler:           httpx.SecurityHeadersMiddleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Отдельный слушатель для метрик. Игра остаётся на loopback, а забирать
	// метрики приходит Prometheus из docker-контейнера, то есть с адреса
	// моста. Пустить его на игровой порт означало бы открыть туда же /ws и
	// статику мимо nginx со всеми его лимитами и заголовками, поэтому наружу
	// выставляется ровно один путь и ничего больше. Пусто — слушателя нет.
	var metricsSrv *http.Server
	if addr := strings.TrimSpace(os.Getenv("METRICS_ADDR")); addr != "" {
		mmux := http.NewServeMux()
		mmux.HandleFunc("/metrics", metrics.Handler)
		metricsSrv = &http.Server{
			Addr:              addr,
			Handler:           mmux,
			ReadHeaderTimeout: 5 * time.Second,
			WriteTimeout:      15 * time.Second,
			IdleTimeout:       60 * time.Second,
		}
		go func() {
			log.Printf("metrics listening on http://%s/metrics", addr)
			if err := metricsSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				// Не Fatal: без метрик игра играется, без игры метрики не нужны.
				log.Printf("metrics server error: %v", err)
			}
		}()
	}

	go func() {
		log.Printf("listening on http://%s\n", listenAddr)
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
	if metricsSrv != nil {
		_ = metricsSrv.Shutdown(ctx)
	}

	hub.Close()

	close(autosaveStop)
	profiles.Flush(true)
}

// mustCwd — статика раздаётся относительно рабочей директории процесса, и
// сервер обязан подняться даже если её не удалось определить.
func mustCwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}
