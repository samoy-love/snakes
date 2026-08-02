// Package protocol — бинарный формат на проводе: опкоды сообщений и событий,
// геометрия поля (индекс клетки — часть формата), кодеры ROI, миникарты и
// потока событий, плюс пулы буферов, в которые они пишут.
//
// Пакет держится отдельно от игровой механики намеренно. Раскладка байтов
// зафиксирована побайтовыми тестами и независимым декодером на клиенте
// (public/client.js, tests/*.mjs); рассинхрон кодера с декодером трижды за
// проект молча ломал игру. Пока кодеры лежали вперемешку с логикой комнаты,
// правка механики могла задеть формат, не привлекая внимания.
//
// Пакет ничего не знает ни про Room, ни про Player: на вход ему дают уже
// собранные значения, на выход он отдаёт байты.
package protocol

import (
	"encoding/binary"
	"math"
	"sync"
	"sync/atomic"
)

// Геометрия поля. Живёт здесь, потому что индекс клетки i = y*W+x уезжает на
// провод как uint16 в PackChange — это часть формата, а не деталь механики.
const (
	W = 200
	H = 140
	N = W * H
)

const (
	MsgROIBinary    = 2
	MsgEventsBinary = 5
	MsgMinimapChunk = 4
)

const (
	EventKill             = 1
	EventStreak           = 2
	EventBountyAssign     = 3
	EventBountyClaim      = 4
	EventPowerupSpawn     = 5
	EventPowerupPickup    = 6
	EventPowerupUse       = 9
	EventMutatorStart     = 7
	EventMutatorEnd       = 8
	EventContractAssign   = 10
	EventContractProgress = 11
	EventContractComplete = 12
	EventStyle            = 13
	EventRevenge          = 14
	EventDailyAssign      = 15
	EventDailyProgress    = 16
	EventDailyComplete    = 17
	EventAchievement      = 18
	EventCapture          = 19
	// EventReclaim: F5, a player took his cooling territory back.
	EventReclaim = 20
	// EventCoolBatch: F5, one death's worth of territory started cooling.
	// Sent once per death so the client can run its own countdown over the
	// cells it already sees flagged with coolOwnerFlag.
	EventCoolBatch = 21
)

const (
	ROIWidth  = 80
	ROIHeight = 56
	ROIStep   = 8
	// ROILookahead is now the CAP on the forward shift, not a fixed offset.
	// A flat 12 left only rh/2-12-ROIStep = 8 rows of guaranteed history behind
	// the head at the default 80x56 window, which is exactly the fog band a
	// player sees for a few ticks after a hard reversal. The effective shift is
	// derived from the window's half-extent along the movement axis
	// (ROILookaheadNum/ROILookaheadDen), so a taller window still gets a useful
	// preview while a short one keeps its rear margin.
	ROILookahead    = 8
	ROILookaheadNum = 1
	ROILookaheadDen = 4

	// Bounds for a client-requested viewport ("viewport" message). Anything
	// outside is clamped; a client that never asks keeps ROIWidth x ROIHeight.
	ROIMinWidth  = 40
	ROIMinHeight = 28
	ROIMaxWidth  = 120
	ROIMaxHeight = 120
	// ROIMaxArea bounds the per-client cost. The ROI is rebuilt for every
	// client on every tick and a full snapshot costs ~8 bytes per cell, so the
	// area is the knob that decides both CPU and bandwidth. 6000 leaves room
	// for a portrait phone (46x94 = 4324) and for the legacy 80x56 = 4480
	// without letting one client order a tenth of the map.
	ROIMaxArea = 6000

	MinimapChunkW          = 10
	MinimapChunkH          = 10
	MinimapMaxChunksPerMsg = 128
	MinimapChunksX         = (W + MinimapChunkW - 1) / MinimapChunkW
	MinimapChunksY         = (H + MinimapChunkH - 1) / MinimapChunkH

	MinimapFullForcedEveryTicks = 30

	MinimapDeltaEveryTicks = 10  // ~1s
	MinimapFullEveryTicks  = 100 // ~10s
	MinimapMaxChanges      = 120000
)

// Event — одно событие в потоке. Набор и порядок полей на проводе зависят от
// Kind, полная раскладка — в EncodeEvents.
type Event struct {
	Kind uint8

	A uint16
	B uint16
	X uint16
	Y uint16
	C uint32
	D uint8
}

// PowerUp едет в заголовке потока событий записью фиксированной длины.
type PowerUp struct {
	ID      uint16
	Type    uint8
	X       uint16
	Y       uint16
	Expires uint32
}

// PooledData — буфер с ручным счётчиком ссылок: один и тот же снапшот
// уходит нескольким клиентам, и вернуть его в пул можно только после того,
// как его отпустит последняя очередь отправки.
type PooledData struct {
	B    []byte
	refs int32
}

// Refs — текущее число ссылок. Нужно тестам жизненного цикла пула: сам
// счётчик неэкспортирован, чтобы им нельзя было управлять в обход Inc/Dec.
func (pd *PooledData) Refs() int32 {
	if pd == nil {
		return 0
	}
	return atomic.LoadInt32(&pd.refs)
}

var pooledDataPool = sync.Pool{New: func() any { return &PooledData{B: make([]byte, 0, 64*1024)} }}

// Пул хранит УКАЗАТЕЛЬ на срез, а не срез.
//
// sync.Pool.Put принимает any, и срез при укладке боксится в интерфейс — то
// есть каждый Put сам по себе аллоцирует (staticcheck SA6002). Для пула,
// который дёргается в горячем пути (буферы ROI — каждый тик на каждого
// клиента), это ровно та аллокация, ради устранения которой пул и заводили.
// С *[]T укладка бесплатна.
var pooledU32Pool = sync.Pool{New: func() any { s := make([]uint32, 0, 2048); return &s }}

func AcquirePooledData(minCap int) *PooledData {
	pd := pooledDataPool.Get().(*PooledData)
	if cap(pd.B) < minCap {
		pd.B = make([]byte, 0, minCap)
	} else {
		pd.B = pd.B[:0]
	}
	atomic.StoreInt32(&pd.refs, 1)
	return pd
}

func IncPooledRef(pd *PooledData) {
	if pd == nil {
		return
	}
	atomic.AddInt32(&pd.refs, 1)
}

func ReleasePooledData(pd *PooledData) {
	if pd == nil {
		return
	}
	if cap(pd.B) > 1024*1024 {
		return
	}
	pd.B = pd.B[:0]
	pooledDataPool.Put(pd)
}

func DecPooledRef(pd *PooledData) {
	if pd == nil {
		return
	}
	if atomic.AddInt32(&pd.refs, -1) == 0 {
		ReleasePooledData(pd)
	}
}

func AcquireU32(minCap int) []uint32 {
	p := pooledU32Pool.Get().(*[]uint32)
	s := *p
	if cap(s) < minCap {
		// Мелкий буфер из пула не подходит — возвращаем его обратно, иначе
		// пул пустеет и следующий Get снова аллоцирует.
		pooledU32Pool.Put(p)
		return make([]uint32, 0, minCap)
	}
	return s[:0]
}

func ReleaseU32(s []uint32) {
	if s == nil {
		return
	}
	if cap(s) > 1_000_000 {
		return
	}
	s = s[:0]
	pooledU32Pool.Put(&s)
}

func AppendU16LE(dst []byte, v uint16) []byte {
	var b [2]byte
	binary.LittleEndian.PutUint16(b[:], v)
	return append(dst, b[:]...)
}

func AppendU32LE(dst []byte, v uint32) []byte {
	var b [4]byte
	binary.LittleEndian.PutUint32(b[:], v)
	return append(dst, b[:]...)
}

func PackChange(i uint16, owner uint16) uint32 {
	return (uint32(i) << 16) | uint32(owner)
}

// ClampViewport turns a client-requested window size (in cells) into one the
// server is willing to serve: per-axis bounds first, then the map, then the
// area budget. A zero or negative request means "no opinion" and falls back to
// the historical default, so a client that never sends "viewport" is served
// exactly as before.
func ClampViewport(w, h int) (int, int) {
	if w <= 0 {
		w = ROIWidth
	}
	if h <= 0 {
		h = ROIHeight
	}
	if w < ROIMinWidth {
		w = ROIMinWidth
	}
	if w > ROIMaxWidth {
		w = ROIMaxWidth
	}
	if h < ROIMinHeight {
		h = ROIMinHeight
	}
	if h > ROIMaxHeight {
		h = ROIMaxHeight
	}
	if w > W {
		w = W
	}
	if h > H {
		h = H
	}
	// Area budget. Shrink proportionally first so the aspect ratio the client
	// asked for survives, then shave the longer side until it fits. The
	// per-axis minimums multiply out to 40*28 = 1120, well under ROIMaxArea, so
	// the loop always terminates with both axes at or above their minimum.
	if w*h > ROIMaxArea {
		f := math.Sqrt(float64(ROIMaxArea) / float64(w*h))
		nw := int(float64(w) * f)
		nh := int(float64(h) * f)
		if nw < ROIMinWidth {
			nw = ROIMinWidth
		}
		if nh < ROIMinHeight {
			nh = ROIMinHeight
		}
		w, h = nw, nh
		for w*h > ROIMaxArea {
			if w-ROIMinWidth >= h-ROIMinHeight && w > ROIMinWidth {
				w--
			} else if h > ROIMinHeight {
				h--
			} else {
				break
			}
		}
	}
	return w, h
}

// ROILookaheadShift is how far ahead of the head the window is pushed along the
// movement axis.
//
// It is 0 on purpose: the client pins the camera to the player and never leads
// it (a leading camera swung the view on every turn, which the product owner
// rejected). With a fixed camera the viewport is centred on the head, so the
// window must be centred on the head too — any forward push would move the
// spare margin ahead of the player and starve the trailing edge, painting fog
// right behind the snake.
//
// The parameters are kept so the shift can be reintroduced per-axis without
// touching call sites; ROILookahead/Num/Den still bound it if it ever returns.
func ROILookaheadShift(rw, rh, dx, dy int) int {
	_, _, _, _ = rw, rh, dx, dy
	return 0
}
