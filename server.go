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
	"syscall"
	"time"

	"snakes/internal/envcfg"
	"snakes/internal/httpx"
)

func main() {
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

	roomLimit := RoomHumanLimitDefault
	if v := os.Getenv("ROOM_LIMIT"); v != "" {
		if n, err := envcfg.ParseInt(v); err == nil && n > 0 {
			roomLimit = n
		}
	}

	initProfileSecret()
	loadProfiles()
	log.Printf("limits roomLimit=%d maxRooms=%d maxProfiles=%d profileEmptyTTL=%s wsAllowLocalhost=%t botDeathLog=%t",
		roomLimit, maxRoomsLimit, maxProfiles, profileEmptyTTL, httpx.WSAllowLocalhost(), debugBotDeathSnap)
	autosaveStop := make(chan struct{})
	startProfilesAutosave(autosaveStop)

	hub := &Hub{rooms: make(map[int]*Room), nextRoomID: 1, roomLimit: roomLimit}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWS(hub, w, r)
	})
	mux.HandleFunc("/favicon.ico", httpx.FaviconHandler)
	// Liveness/readiness for systemd and whatever sits in front of it.
	mux.HandleFunc("/healthz", httpx.HealthzHandler)
	mux.HandleFunc("/readyz", httpx.ReadyzHandler)
	mux.HandleFunc("/metrics", metricsHandler)

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

	hub.mu.Lock()
	for _, rm := range hub.rooms {
		rm.close()
	}
	hub.mu.Unlock()

	close(autosaveStop)
	flushProfiles(true)
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

// mustCwd — статика раздаётся относительно рабочей директории процесса, и
// сервер обязан подняться даже если её не удалось определить.
func mustCwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}
