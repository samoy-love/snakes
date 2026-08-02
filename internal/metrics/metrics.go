// Package metrics — счётчики сервера и их выдача на /metrics в text exposition
// format Prometheus.
//
// Формат простой (имя, метки, число, перевод строки), поэтому реализация своя,
// а не prometheus/client_golang: библиотека тянет за собой protobuf, expfmt и
// свой сборщик рантайм-метрик — несколько мегабайт зависимостей ради трёх
// десятков счётчиков. Единственная зависимость проекта — websocket-библиотека,
// и ломать это ради формата, который умещается в один Writer, незачем.
//
// Пакет намеренно ничего не знает об игре: считают и транспортный слой, и
// игровой цикл, а зависимость в обратную сторону (метрики знают про Room)
// сделала бы пакет недоступным из ws-обвязки. Мгновенные величины, которые
// нельзя посчитать инкрементами (сколько сейчас живых игроков, комнат, идущих
// матчей), пакет спрашивает у игры через SetGameSnapshot.
package metrics

import (
	"bufio"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ContentType — то, что Prometheus ожидает увидеть в ответе. Версия формата
// указывается явно: без неё сборщик угадывает по телу и в спорных случаях
// принимает ответ за protobuf.
const ContentType = "text/plain; version=0.0.4; charset=utf-8"

// ---------------------------------------------------------------------------
// Реестр
// ---------------------------------------------------------------------------

// collector — одна метрика: заголовок (# HELP/# TYPE) и её строки-сэмплы.
type collector interface {
	metricName() string
	metricHelp() string
	metricType() string
	writeSamples(w *bufio.Writer)
}

var (
	regMu    sync.Mutex
	registry []collector
)

func register[T collector](c T) T {
	regMu.Lock()
	registry = append(registry, c)
	regMu.Unlock()
	return c
}

// ---------------------------------------------------------------------------
// Типы метрик
// ---------------------------------------------------------------------------

type meta struct {
	name string
	help string
}

func (m meta) metricName() string { return m.name }
func (m meta) metricHelp() string { return m.help }

// Counter — монотонно растущий счётчик.
type Counter struct {
	meta
	v atomic.Uint64
}

func (c *Counter) metricType() string { return "counter" }

// Inc увеличивает счётчик на единицу.
func (c *Counter) Inc() { c.v.Add(1) }

// Add увеличивает счётчик на n.
func (c *Counter) Add(n uint64) { c.v.Add(n) }

// Load возвращает текущее значение.
func (c *Counter) Load() uint64 { return c.v.Load() }

func (c *Counter) writeSamples(w *bufio.Writer) {
	w.WriteString(c.name)
	w.WriteByte(' ')
	w.WriteString(strconv.FormatUint(c.v.Load(), 10))
	w.WriteByte('\n')
}

func newCounter(name, help string) *Counter {
	return register(&Counter{meta: meta{name: name, help: help}})
}

// Gauge — величина, которая ходит в обе стороны.
type Gauge struct {
	meta
	v atomic.Int64
}

func (g *Gauge) metricType() string { return "gauge" }

// Add сдвигает значение на delta (может быть отрицательной).
func (g *Gauge) Add(delta int64) { g.v.Add(delta) }

// Set задаёт значение.
func (g *Gauge) Set(v int64) { g.v.Store(v) }

// Load возвращает текущее значение.
func (g *Gauge) Load() int64 { return g.v.Load() }

func (g *Gauge) writeSamples(w *bufio.Writer) {
	w.WriteString(g.name)
	w.WriteByte(' ')
	w.WriteString(strconv.FormatInt(g.v.Load(), 10))
	w.WriteByte('\n')
}

func newGauge(name, help string) *Gauge {
	return register(&Gauge{meta: meta{name: name, help: help}})
}

// CounterVec — счётчик с одной меткой. Значения метки приходят из кода игры
// (причина смерти, тип бонуса), их набор конечный и известен заранее, но
// заводить по отдельной переменной на каждое значение — это тридцать
// переменных вместо одной.
type CounterVec struct {
	meta
	label string
	mu    sync.RWMutex
	vals  map[string]*atomic.Uint64
}

func (cv *CounterVec) metricType() string { return "counter" }

// Inc увеличивает счётчик для значения метки на единицу.
func (cv *CounterVec) Inc(value string) { cv.Add(value, 1) }

// Add увеличивает счётчик для значения метки на n.
func (cv *CounterVec) Add(value string, n uint64) {
	cv.mu.RLock()
	c, ok := cv.vals[value]
	cv.mu.RUnlock()
	if !ok {
		cv.mu.Lock()
		if c, ok = cv.vals[value]; !ok {
			c = new(atomic.Uint64)
			cv.vals[value] = c
		}
		cv.mu.Unlock()
	}
	c.Add(n)
}

// Load возвращает значение для метки (0, если такой ещё не было).
func (cv *CounterVec) Load(value string) uint64 {
	cv.mu.RLock()
	defer cv.mu.RUnlock()
	if c, ok := cv.vals[value]; ok {
		return c.Load()
	}
	return 0
}

func (cv *CounterVec) writeSamples(w *bufio.Writer) {
	cv.mu.RLock()
	keys := make([]string, 0, len(cv.vals))
	for k := range cv.vals {
		keys = append(keys, k)
	}
	cv.mu.RUnlock()
	// Порядок фиксируется: вывод /metrics должен быть воспроизводимым, иначе
	// его невозможно ни продиффать руками, ни проверить тестом.
	sort.Strings(keys)
	for _, k := range keys {
		w.WriteString(cv.name)
		w.WriteString(`{`)
		w.WriteString(cv.label)
		w.WriteString(`="`)
		w.WriteString(escapeLabel(k))
		w.WriteString(`"} `)
		w.WriteString(strconv.FormatUint(cv.Load(k), 10))
		w.WriteByte('\n')
	}
}

// newCounterVec заводит счётчик с меткой. known — значения, которые обязаны
// присутствовать в выводе с нуля: метрика, появляющаяся только после первого
// события, ломает rate() и заставляет графики начинаться с дыры.
func newCounterVec(name, help, label string, known ...string) *CounterVec {
	cv := register(&CounterVec{
		meta:  meta{name: name, help: help},
		label: label,
		vals:  make(map[string]*atomic.Uint64, len(known)),
	})
	for _, k := range known {
		cv.vals[k] = new(atomic.Uint64)
	}
	return cv
}

// Histogram — кумулятивная гистограмма с фиксированными границами.
type Histogram struct {
	meta
	bounds  []float64
	buckets []atomic.Uint64
	count   atomic.Uint64
	sumBits atomic.Uint64 // float64 в виде битов: sum считается без замка
}

func (h *Histogram) metricType() string { return "histogram" }

// Observe записывает одно наблюдение.
func (h *Histogram) Observe(v float64) {
	for i, b := range h.bounds {
		if v <= b {
			h.buckets[i].Add(1)
		}
	}
	h.count.Add(1)
	for {
		old := h.sumBits.Load()
		nw := math.Float64bits(math.Float64frombits(old) + v)
		if h.sumBits.CompareAndSwap(old, nw) {
			return
		}
	}
}

// ObserveDuration записывает длительность в секундах.
func (h *Histogram) ObserveDuration(d time.Duration) { h.Observe(d.Seconds()) }

// Count возвращает число наблюдений.
func (h *Histogram) Count() uint64 { return h.count.Load() }

// Sum возвращает сумму наблюдений.
func (h *Histogram) Sum() float64 { return math.Float64frombits(h.sumBits.Load()) }

func (h *Histogram) writeSamples(w *bufio.Writer) {
	for i, b := range h.bounds {
		w.WriteString(h.name)
		w.WriteString(`_bucket{le="`)
		w.WriteString(formatFloat(b))
		w.WriteString(`"} `)
		w.WriteString(strconv.FormatUint(h.buckets[i].Load(), 10))
		w.WriteByte('\n')
	}
	// +Inf обязателен: без него это не гистограмма, а набор чисел, и
	// histogram_quantile молча возвращает NaN.
	w.WriteString(h.name)
	w.WriteString(`_bucket{le="+Inf"} `)
	w.WriteString(strconv.FormatUint(h.count.Load(), 10))
	w.WriteByte('\n')
	w.WriteString(h.name)
	w.WriteString("_sum ")
	w.WriteString(formatFloat(h.Sum()))
	w.WriteByte('\n')
	w.WriteString(h.name)
	w.WriteString("_count ")
	w.WriteString(strconv.FormatUint(h.count.Load(), 10))
	w.WriteByte('\n')
}

func newHistogram(name, help string, bounds []float64) *Histogram {
	return register(&Histogram{
		meta:    meta{name: name, help: help},
		bounds:  bounds,
		buckets: make([]atomic.Uint64, len(bounds)),
	})
}

// ---------------------------------------------------------------------------
// Форматирование
// ---------------------------------------------------------------------------

func escapeLabel(s string) string {
	if !strings.ContainsAny(s, `\"`+"\n") {
		return s
	}
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
	return r.Replace(s)
}

// formatFloat печатает число без экспоненты там, где это возможно: 0.005, а не
// 5e-03. Prometheus принимает оба вида, но le="5e-03" нечитаем в графане.
func formatFloat(v float64) string {
	return strconv.FormatFloat(v, 'g', -1, 64)
}
