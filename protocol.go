// protocol.go holds the binary wire format: message/event opcodes, the ROI and
// minimap encoders, the event stream encoder and the reference-counted buffer
// pools they are written into.
package main

import (
	"encoding/binary"
	"math"
	"sync"
	"sync/atomic"
)

const (
	FullSnapshotEveryTicks = 20
	MaxDeltaChanges        = 9000
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

	BonusBudgetMax          = 70
	BonusBudgetRegenPerTick = 1

	SpeedPickupLockTicks   = 80
	DashDuration           = 45
	DashDurationLocked     = 28
	DashMaxFromNow         = 70
	MegaDashDuration       = 95
	MegaDashDurationLocked = 55
	MegaDashMaxFromNow     = 130

	aiRecentCap = 12

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

type pooledData struct {
	b    []byte
	refs int32
}

var pooledDataPool = sync.Pool{New: func() any { return &pooledData{b: make([]byte, 0, 64*1024)} }}
var pooledU32Pool = sync.Pool{New: func() any { return make([]uint32, 0, 2048) }}

var floodBytesPool = sync.Pool{New: func() any { return make([]byte, N) }}
var floodIntPool = sync.Pool{New: func() any { return make([]int, N) }}

func acquirePooledData(minCap int) *pooledData {
	pd := pooledDataPool.Get().(*pooledData)
	if cap(pd.b) < minCap {
		pd.b = make([]byte, 0, minCap)
	} else {
		pd.b = pd.b[:0]
	}
	atomic.StoreInt32(&pd.refs, 1)
	return pd
}

func incPooledRef(pd *pooledData) {
	if pd == nil {
		return
	}
	atomic.AddInt32(&pd.refs, 1)
}

func releasePooledData(pd *pooledData) {
	if pd == nil {
		return
	}
	if cap(pd.b) > 1024*1024 {
		return
	}
	pd.b = pd.b[:0]
	pooledDataPool.Put(pd)
}

func decPooledRef(pd *pooledData) {
	if pd == nil {
		return
	}
	if atomic.AddInt32(&pd.refs, -1) == 0 {
		releasePooledData(pd)
	}
}

func acquireU32(minCap int) []uint32 {
	s := pooledU32Pool.Get().([]uint32)
	if cap(s) < minCap {
		return make([]uint32, 0, minCap)
	}
	return s[:0]
}

func releaseU32(s []uint32) {
	if s == nil {
		return
	}
	if cap(s) > 1_000_000 {
		return
	}
	pooledU32Pool.Put(s[:0])
}

func appendU16LE(dst []byte, v uint16) []byte {
	var b [2]byte
	binary.LittleEndian.PutUint16(b[:], v)
	return append(dst, b[:]...)
}

func appendU32LE(dst []byte, v uint32) []byte {
	var b [4]byte
	binary.LittleEndian.PutUint32(b[:], v)
	return append(dst, b[:]...)
}

func (r *Room) buildEventsPooledLocked(force bool) *pooledData {
	if !force && len(r.events) == 0 && !r.metaDirty {
		return nil
	}
	capHint := 1 + 4 + 1 + 4 + 2 + 4 + 1 + len(r.powerUps)*13 + 2 + len(r.events)*16
	if capHint < 128 {
		capHint = 128
	}
	pd := acquirePooledData(capHint)
	b := pd.b

	b = append(b, MsgEventsBinary)
	b = appendU32LE(b, r.tick)
	b = append(b, r.mutatorType)
	b = appendU32LE(b, r.mutatorUntil)
	b = appendU16LE(b, r.bountyTarget)
	b = appendU32LE(b, r.bountyUntil)
	b = append(b, uint8(len(r.powerUps)))
	for _, pu := range r.powerUps {
		b = appendU16LE(b, pu.ID)
		b = append(b, pu.Type)
		b = appendU16LE(b, pu.X)
		b = appendU16LE(b, pu.Y)
		b = appendU32LE(b, pu.Expires)
	}

	b = appendU16LE(b, uint16(len(r.events)))
	for _, e := range r.events {
		b = append(b, e.Kind)
		switch e.Kind {
		case EventKill:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = append(b, e.D)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
		case EventStreak:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
		case EventBountyAssign:
			b = appendU16LE(b, e.A)
			b = appendU32LE(b, e.C)
		case EventBountyClaim:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
		case EventPowerupSpawn:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
			b = appendU32LE(b, e.C)
		case EventPowerupPickup:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = append(b, e.D)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
		case EventPowerupUse:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
		case EventMutatorStart:
			b = append(b, e.D)
			b = appendU32LE(b, e.C)
		case EventMutatorEnd:
			b = append(b, e.D)
		case EventContractAssign:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.B)
			b = appendU32LE(b, e.C)
		case EventContractProgress:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.B)
		case EventContractComplete:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
		case EventStyle:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = appendU32LE(b, e.C)
			b = append(b, e.D)
		case EventCapture:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
			b = appendU32LE(b, e.C)
			b = append(b, e.D)
		case EventRevenge:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
		case EventDailyAssign:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.B)
			b = appendU32LE(b, e.C)
		case EventDailyProgress:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
			b = appendU16LE(b, e.B)
		case EventDailyComplete:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
		case EventAchievement:
			b = appendU16LE(b, e.A)
			b = append(b, e.D)
		case EventReclaim:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = appendU16LE(b, e.X)
			b = appendU16LE(b, e.Y)
		case EventCoolBatch:
			b = appendU16LE(b, e.A)
			b = appendU16LE(b, e.B)
			b = appendU32LE(b, e.C)
		default:
			b = append(b, 0)
		}
	}

	pd.b = b
	r.events = r.events[:0]
	r.metaDirty = false
	r.metaSentTick = r.tick
	return pd
}

// clampViewport turns a client-requested window size (in cells) into one the
// server is willing to serve: per-axis bounds first, then the map, then the
// area budget. A zero or negative request means "no opinion" and falls back to
// the historical default, so a client that never sends "viewport" is served
// exactly as before.
func clampViewport(w, h int) (int, int) {
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

// roiLookahead is how far ahead of the head the window is pushed along the
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
func roiLookahead(rw, rh, dx, dy int) int {
	_, _, _, _ = rw, rh, dx, dy
	return 0
}

func packChange(i uint16, owner uint16) uint32 {
	return (uint32(i) << 16) | uint32(owner)
}

func (r *Room) buildROIPooledFast(rx, ry, rw, rh int, sinceTick uint32, players []*Player) *pooledData {
	dg := acquireU32(256)
	dt := acquireU32(256)

	minX := rx
	minY := ry
	maxX := rx + rw
	maxY := ry + rh

	for _, ch := range r.changedGrid {
		i := int(ch >> 16)
		x := i % W
		y := i / W
		if x >= minX && x < maxX && y >= minY && y < maxY {
			dg = append(dg, ch)
		}
	}
	for _, ch := range r.changedTrail {
		i := int(ch >> 16)
		x := i % W
		y := i / W
		if x >= minX && x < maxX && y >= minY && y < maxY {
			dt = append(dt, ch)
		}
	}

	plCount := len(players)
	bytesPlayers := plCount * (2 + 2 + 2 + 1 + 1 + 2 + 2 + 2 + 1 + 1 + 5)
	bytesDG := len(dg) * 4
	bytesDT := len(dt) * 4
	capHint := 1 + 4 + 2 + bytesPlayers + 2 + 2 + 2 + 2 + 4 + 4 + bytesDG + bytesDT
	if capHint < 64 {
		capHint = 64
	}
	pd := acquirePooledData(capHint)
	out := pd.b

	out = append(out, MsgROIBinary)
	out = appendU32LE(out, r.tick)
	out = appendU16LE(out, uint16(plCount))
	for _, p := range players {
		out = appendU16LE(out, p.num)
		out = appendU16LE(out, uint16(maxInt(0, p.x)))
		out = appendU16LE(out, uint16(maxInt(0, p.y)))
		out = append(out, uint8(p.dir))
		if p.alive {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = appendU16LE(out, r.scores[p.num])
		out = appendU16LE(out, r.points[p.num])
		out = appendU16LE(out, p.hue)
		out = append(out, r.playerShieldBits(p))
		if p.bot {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = append(out, p.cosCaptureFx, p.cosHead, p.cosSeg, p.cosNameplate, p.cosFrame)
	}
	out = appendU16LE(out, uint16(rx))
	out = appendU16LE(out, uint16(ry))
	out = appendU16LE(out, uint16(rw))
	out = appendU16LE(out, uint16(rh))
	out = appendU32LE(out, uint32(bytesDG))
	out = appendU32LE(out, uint32(bytesDT))
	for _, v := range dg {
		out = appendU32LE(out, v)
	}
	for _, v := range dt {
		out = appendU32LE(out, v)
	}

	pd.b = out
	releaseU32(dg)
	releaseU32(dt)
	_ = sinceTick
	return pd
}

func (r *Room) buildROIPooledScan(rx, ry, rw, rh int, full bool, sinceTick uint32, players []*Player) *pooledData {
	dg := acquireU32(rw * rh / 2)
	dt := acquireU32(rw * rh / 4)

	for y := ry; y < ry+rh; y++ {
		row := y * W
		for x := rx; x < rx+rw; x++ {
			i := row + x
			if full || r.gridStamp[i] > sinceTick {
				dg = append(dg, packChange(uint16(i), r.gridWireAt(i)))
			}
			if full || r.trailStamp[i] > sinceTick {
				dt = append(dt, packChange(uint16(i), r.trailOwner[i]))
			}
		}
	}

	plCount := len(players)
	bytesPlayers := plCount * (2 + 2 + 2 + 1 + 1 + 2 + 2 + 2 + 1 + 1 + 5)
	bytesDG := len(dg) * 4
	bytesDT := len(dt) * 4
	capHint := 1 + 4 + 2 + bytesPlayers + 2 + 2 + 2 + 2 + 4 + 4 + bytesDG + bytesDT
	if capHint < 64 {
		capHint = 64
	}
	pd := acquirePooledData(capHint)
	out := pd.b

	out = append(out, MsgROIBinary)
	out = appendU32LE(out, r.tick)
	out = appendU16LE(out, uint16(plCount))
	for _, p := range players {
		out = appendU16LE(out, p.num)
		out = appendU16LE(out, uint16(maxInt(0, p.x)))
		out = appendU16LE(out, uint16(maxInt(0, p.y)))
		out = append(out, uint8(p.dir))
		if p.alive {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = appendU16LE(out, r.scores[p.num])
		out = appendU16LE(out, r.points[p.num])
		out = appendU16LE(out, p.hue)
		out = append(out, r.playerShieldBits(p))
		if p.bot {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = append(out, p.cosCaptureFx, p.cosHead, p.cosSeg, p.cosNameplate, p.cosFrame)
	}
	out = appendU16LE(out, uint16(rx))
	out = appendU16LE(out, uint16(ry))
	out = appendU16LE(out, uint16(rw))
	out = appendU16LE(out, uint16(rh))
	out = appendU32LE(out, uint32(bytesDG))
	out = appendU32LE(out, uint32(bytesDT))
	for _, v := range dg {
		out = appendU32LE(out, v)
	}
	for _, v := range dt {
		out = appendU32LE(out, v)
	}

	pd.b = out
	releaseU32(dg)
	releaseU32(dt)
	return pd
}

func (r *Room) buildMinimapChunkBinary(full bool) []byte {
	chunksX := MinimapChunksX
	chunksY := MinimapChunksY
	if chunksX <= 0 || chunksY <= 0 {
		return nil
	}

	chunks := make([]int, 0, MinimapMaxChunksPerMsg)
	if !full {
		var seen [MinimapChunksX * MinimapChunksY]uint8
		unique := 0
		threshold := MinimapMaxChunksPerMsg * 2

		addChunk := func(i int) {
			cx := (i % W) / MinimapChunkW
			cy := (i / W) / MinimapChunkH
			idx := cy*chunksX + cx
			if idx < 0 || idx >= len(seen) {
				return
			}
			if seen[idx] == 1 {
				return
			}
			seen[idx] = 1
			unique++
			if unique <= threshold {
				if len(chunks) < MinimapMaxChunksPerMsg {
					chunks = append(chunks, idx)
				}
			}
		}

		for _, ch := range r.minimapGrid {
			addChunk(int(ch >> 16))
			if unique > threshold {
				break
			}
		}

		if unique > threshold {
			r.minimapFullActive = true
			r.minimapFullCursor = 0
			full = true
			chunks = chunks[:0]
		} else if len(chunks) == 0 {
			return nil
		}
	}

	if full {
		start := r.minimapFullCursor
		for len(chunks) < MinimapMaxChunksPerMsg {
			idx := start + len(chunks)
			if idx >= chunksX*chunksY {
				break
			}
			chunks = append(chunks, idx)
		}
		r.minimapFullCursor = start + len(chunks)
		if r.minimapFullCursor >= chunksX*chunksY {
			r.minimapFullActive = false
			r.minimapFullCursor = 0
		}
	} else {
		// chunks already collected for the delta case
	}

	// type(1) + tick(4) + cw(1)+ch(1)+count(2)+flags(1) + chunks*(cx(1)+cy(1)+payload)
	chunkCells := MinimapChunkW * MinimapChunkH
	payloadBytes := chunkCells * 2
	out := make([]byte, 0, 1+4+1+1+2+1+len(chunks)*(2+payloadBytes))
	out = append(out, MsgMinimapChunk)
	var b4 [4]byte
	binary.LittleEndian.PutUint32(b4[:], r.tick)
	out = append(out, b4[:]...)
	out = append(out, uint8(MinimapChunkW), uint8(MinimapChunkH))
	var b2 [2]byte
	binary.LittleEndian.PutUint16(b2[:], uint16(len(chunks)))
	out = append(out, b2[:]...)
	// flags: bit0 = hasTrail (0 for grid-only minimap)
	out = append(out, 0)

	for _, idx := range chunks {
		cx := idx % chunksX
		cy := idx / chunksX
		out = append(out, uint8(cx), uint8(cy))
		x0 := cx * MinimapChunkW
		y0 := cy * MinimapChunkH
		for yy := 0; yy < MinimapChunkH; yy++ {
			for xx := 0; xx < MinimapChunkW; xx++ {
				gx := x0 + xx
				gy := y0 + yy
				var v uint16
				if gx >= 0 && gx < W && gy >= 0 && gy < H {
					v = r.gridWireAt(gy*W + gx)
				}
				binary.LittleEndian.PutUint16(b2[:], v)
				out = append(out, b2[:]...)
			}
		}
	}

	return out
}
