// wire.go — стык игровой логики с пакетом protocol.
//
// Здесь два вида кода и ничего больше: короткие псевдонимы словаря протокола и
// тонкие обёртки, которые собирают состояние комнаты в аргументы кодеров.
// Сами байты пишет только protocol.
package game

import "snakes/internal/protocol"

// Геометрия поля. Владелец — protocol (индекс клетки уезжает на провод), но
// игровой код обращается к W/H/N в сотнях мест арифметики по сетке, и
// квалифицированное имя утопило бы там смысл.
const (
	W = protocol.W
	H = protocol.H
	N = protocol.N
)

type (
	// Event и PowerUp — структуры протокола: игра их наполняет, но раскладка
	// на проводе принадлежит не ей.
	Event      = protocol.Event
	PowerUp    = protocol.PowerUp
	pooledData = protocol.PooledData
)

// Типы событий. Псевдонимы, а не квалифицированные имена: это словарь, на
// котором игровая логика разговаривает при каждом убийстве, подборе и выдаче
// награды.
const (
	EventKill             = protocol.EventKill
	EventStreak           = protocol.EventStreak
	EventBountyAssign     = protocol.EventBountyAssign
	EventBountyClaim      = protocol.EventBountyClaim
	EventPowerupSpawn     = protocol.EventPowerupSpawn
	EventPowerupPickup    = protocol.EventPowerupPickup
	EventPowerupUse       = protocol.EventPowerupUse
	EventMutatorStart     = protocol.EventMutatorStart
	EventMutatorEnd       = protocol.EventMutatorEnd
	EventContractAssign   = protocol.EventContractAssign
	EventContractProgress = protocol.EventContractProgress
	EventContractComplete = protocol.EventContractComplete
	EventStyle            = protocol.EventStyle
	EventRevenge          = protocol.EventRevenge
	EventDailyAssign      = protocol.EventDailyAssign
	EventDailyProgress    = protocol.EventDailyProgress
	EventDailyComplete    = protocol.EventDailyComplete
	EventAchievement      = protocol.EventAchievement
	EventCapture          = protocol.EventCapture
	EventReclaim          = protocol.EventReclaim
	EventCoolBatch        = protocol.EventCoolBatch
)

const (
	MsgROIBinary    = protocol.MsgROIBinary
	MsgEventsBinary = protocol.MsgEventsBinary
	MsgMinimapChunk = protocol.MsgMinimapChunk
)

const (
	ROIWidth        = protocol.ROIWidth
	ROIHeight       = protocol.ROIHeight
	ROIStep         = protocol.ROIStep
	ROILookahead    = protocol.ROILookahead
	ROILookaheadNum = protocol.ROILookaheadNum
	ROILookaheadDen = protocol.ROILookaheadDen
	ROIMinWidth     = protocol.ROIMinWidth
	ROIMinHeight    = protocol.ROIMinHeight
	ROIMaxWidth     = protocol.ROIMaxWidth
	ROIMaxHeight    = protocol.ROIMaxHeight
	ROIMaxArea      = protocol.ROIMaxArea

	MinimapChunkW               = protocol.MinimapChunkW
	MinimapChunkH               = protocol.MinimapChunkH
	MinimapMaxChunksPerMsg      = protocol.MinimapMaxChunksPerMsg
	MinimapChunksX              = protocol.MinimapChunksX
	MinimapChunksY              = protocol.MinimapChunksY
	MinimapFullForcedEveryTicks = protocol.MinimapFullForcedEveryTicks
	MinimapDeltaEveryTicks      = protocol.MinimapDeltaEveryTicks
	MinimapFullEveryTicks       = protocol.MinimapFullEveryTicks
	MinimapMaxChanges           = protocol.MinimapMaxChanges
)

var (
	acquirePooledData = protocol.AcquirePooledData
	releasePooledData = protocol.ReleasePooledData
	incPooledRef      = protocol.IncPooledRef
	decPooledRef      = protocol.DecPooledRef
	acquireU32        = protocol.AcquireU32
	releaseU32        = protocol.ReleaseU32
	appendU16LE       = protocol.AppendU16LE
	appendU32LE       = protocol.AppendU32LE
	packChange        = protocol.PackChange
	clampViewport     = protocol.ClampViewport
	roiLookahead      = protocol.ROILookaheadShift
)

// buildEventsPooledLocked отдаёт пакет событий комнаты и опустошает очередь.
// nil означает «отправлять нечего»: ни событий, ни изменившейся мета-шапки.
func (r *Room) buildEventsPooledLocked(force bool) *pooledData {
	if !force && len(r.events) == 0 && !r.metaDirty {
		return nil
	}
	pd := protocol.EncodeEvents(protocol.EventsHeader{
		Tick:         r.tick,
		MutatorType:  r.mutatorType,
		MutatorUntil: r.mutatorUntil,
		BountyTarget: r.bountyTarget,
		BountyUntil:  r.bountyUntil,
	}, r.powerUps, r.events)
	r.events = r.events[:0]
	r.metaDirty = false
	r.metaSentTick = r.tick
	return pd
}

// roiPlayersLocked перекладывает игроков в записи протокола. Скратч живёт в
// комнате: ROI пересобирается для каждого клиента на каждом тике, и свежий
// срез на каждый вызов был бы аллокацией в самом горячем месте сервера.
func (r *Room) roiPlayersLocked(players []*Player) []protocol.ROIPlayer {
	out := r.tmpROIPlayers[:0]
	for _, p := range players {
		out = append(out, protocol.ROIPlayer{
			Num: p.num,
			// Игрок между смертью и респавном стоит на (-1,-1), а на провод
			// координата едет беззнаковой.
			X:      uint16(maxInt(0, p.x)),
			Y:      uint16(maxInt(0, p.y)),
			Dir:    uint8(p.dir),
			Alive:  p.alive,
			Score:  r.scores[p.num],
			Points: r.points[p.num],
			Hue:    p.hue,
			Shield: r.playerShieldBits(p),
			Bot:    p.bot,
			Cos:    [5]uint8{p.cosCaptureFx, p.cosHead, p.cosSeg, p.cosNameplate, p.cosFrame},
		})
	}
	r.tmpROIPlayers = out
	return out
}

// buildROIPooledFast — путь по журналу изменений: дельты отбираются из уже
// собранного за тик списка. Дёшево, когда в кадре поменялось мало клеток.
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

	pd := protocol.EncodeROI(r.tick, rx, ry, rw, rh, r.roiPlayersLocked(players), dg, dt)
	releaseU32(dg)
	releaseU32(dt)
	_ = sinceTick
	return pd
}

// buildROIPooledScan — путь полного скана региона: каждая клетка окна
// сверяется со штампом тика. Нужен на первом кадре и когда журнал изменений
// разросся шире окна.
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

	pd := protocol.EncodeROI(r.tick, rx, ry, rw, rh, r.roiPlayersLocked(players), dg, dt)
	releaseU32(dg)
	releaseU32(dt)
	return pd
}

func (r *Room) buildMinimapChunkBinary(full bool) []byte {
	return protocol.EncodeMinimapChunks(&r.minimapCur, full, r.tick, r.minimapGrid, r.gridWireAt)
}
