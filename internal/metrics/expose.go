package metrics

import (
	"bufio"
	"io"
	"net/http"
	"strings"
	"sync"
)

// GameSnapshot — мгновенный срез игры. Такие величины нельзя набрать
// инкрементами: игрок может уйти, комната закрыться, матч кончиться, и
// счётчик «сколько сейчас» разъедется с реальностью на первой же потерянной
// декрементации. Их спрашивают у игры в момент сбора.
type GameSnapshot struct {
	Rooms          int
	Players        int // живые люди
	Bots           int
	MatchesRunning int
}

var snapshotFn struct {
	mu sync.RWMutex
	f  func() GameSnapshot
}

// SetGameSnapshot подключает источник мгновенных величин. Вызывается из main
// после создания хаба; до этого /metrics отдаёт нули, а не падает.
func SetGameSnapshot(f func() GameSnapshot) {
	snapshotFn.mu.Lock()
	snapshotFn.f = f
	snapshotFn.mu.Unlock()
}

func gameSnapshot() GameSnapshot {
	snapshotFn.mu.RLock()
	f := snapshotFn.f
	snapshotFn.mu.RUnlock()
	if f == nil {
		return GameSnapshot{}
	}
	return f()
}

// SetBuildInfo записывает версию сборки в snakes_build_info. Метрика-константа
// со значением 1 и версией в метке — стандартный приём: по ней в графане
// видно, какая версия крутится, и виден момент выкатки.
func SetBuildInfo(version, commit string) {
	buildVersion.Store(version)
	buildCommit.Store(commit)
}

// Write печатает все метрики в text exposition format.
func Write(dst io.Writer) error {
	// Мгновенные величины обновляются прямо перед выводом: иначе Prometheus
	// увидит состояние на момент последнего игрового события.
	s := gameSnapshot()
	Rooms.Set(int64(s.Rooms))
	Players.Set(int64(s.Players))
	Bots.Set(int64(s.Bots))
	MatchesRunning.Set(int64(s.MatchesRunning))

	w := bufio.NewWriter(dst)
	regMu.Lock()
	cs := make([]collector, len(registry))
	copy(cs, registry)
	regMu.Unlock()

	for _, c := range cs {
		w.WriteString("# HELP ")
		w.WriteString(c.metricName())
		w.WriteByte(' ')
		w.WriteString(escapeHelp(c.metricHelp()))
		w.WriteByte('\n')
		w.WriteString("# TYPE ")
		w.WriteString(c.metricName())
		w.WriteByte(' ')
		w.WriteString(c.metricType())
		w.WriteByte('\n')
		c.writeSamples(w)
	}
	return w.Flush()
}

// Handler отдаёт метрики. Никакой авторизации: эндпоинт слушает только там,
// куда его пустили (loopback и подсеть docker-моста), наружу он не торчит.
func Handler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", ContentType)
	w.WriteHeader(http.StatusOK)
	_ = Write(w)
}

// escapeHelp — в HELP запрещены перевод строки и одиночный обратный слэш.
func escapeHelp(s string) string {
	if !strings.ContainsAny(s, "\\\n") {
		return s
	}
	return strings.NewReplacer(`\`, `\\`, "\n", `\n`).Replace(s)
}
