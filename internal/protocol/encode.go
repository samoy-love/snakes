package protocol

import "encoding/binary"

// roiPlayerRecordLen — длина записи одного игрока в ROI-пакете.
// num(2) + x(2) + y(2) + dir(1) + alive(1) + score(2) + points(2) + hue(2) +
// shield(1) + bot(1) + косметика(5).
const roiPlayerRecordLen = 2 + 2 + 2 + 1 + 1 + 2 + 2 + 2 + 1 + 1 + 5

// EventsHeader — общая часть пакета событий: она едет перед списком powerup и
// перед самими событиями, даже когда событий нет (клиент по ней ведёт таймеры
// мутатора и баунти).
type EventsHeader struct {
	Tick         uint32
	MutatorType  uint8
	MutatorUntil uint32
	BountyTarget uint16
	BountyUntil  uint32
}

// EncodeEvents собирает пакет MsgEventsBinary.
//
// Неизвестный Kind занимает ровно один байт-заглушку: клиент, встретив тип,
// которого не знает, обязан суметь пропустить его и разобрать хвост пакета.
// Именно на этом месте протокол ломался молча — парсер «съезжал» и терял
// киллфид, тосты и обновления заданий до конца пакета.
func EncodeEvents(h EventsHeader, powerUps []PowerUp, events []Event) *PooledData {
	capHint := 1 + 4 + 1 + 4 + 2 + 4 + 1 + len(powerUps)*13 + 2 + len(events)*16
	if capHint < 128 {
		capHint = 128
	}
	pd := AcquirePooledData(capHint)
	b := pd.B

	b = append(b, MsgEventsBinary)
	b = AppendU32LE(b, h.Tick)
	b = append(b, h.MutatorType)
	b = AppendU32LE(b, h.MutatorUntil)
	b = AppendU16LE(b, h.BountyTarget)
	b = AppendU32LE(b, h.BountyUntil)
	b = append(b, uint8(len(powerUps)))
	for _, pu := range powerUps {
		b = AppendU16LE(b, pu.ID)
		b = append(b, pu.Type)
		b = AppendU16LE(b, pu.X)
		b = AppendU16LE(b, pu.Y)
		b = AppendU32LE(b, pu.Expires)
	}

	b = AppendU16LE(b, uint16(len(events)))
	for _, e := range events {
		b = append(b, e.Kind)
		switch e.Kind {
		case EventKill:
			b = AppendU16LE(b, e.A)
			b = AppendU16LE(b, e.B)
			b = append(b, e.D)
			b = AppendU16LE(b, e.X)
			b = AppendU16LE(b, e.Y)
		case EventStreak:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
		case EventBountyAssign:
			b = AppendU16LE(b, e.A)
			b = AppendU32LE(b, e.C)
		case EventBountyClaim:
			b = AppendU16LE(b, e.A)
			b = AppendU16LE(b, e.B)
		case EventPowerupSpawn:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
			b = AppendU16LE(b, e.X)
			b = AppendU16LE(b, e.Y)
			b = AppendU32LE(b, e.C)
		case EventPowerupPickup:
			b = AppendU16LE(b, e.A)
			b = AppendU16LE(b, e.B)
			b = append(b, e.D)
			b = AppendU16LE(b, e.X)
			b = AppendU16LE(b, e.Y)
		case EventPowerupUse:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
			b = AppendU16LE(b, e.X)
			b = AppendU16LE(b, e.Y)
		case EventMutatorStart:
			b = append(b, e.D)
			b = AppendU32LE(b, e.C)
		case EventMutatorEnd:
			b = append(b, e.D)
		case EventContractAssign:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
			b = AppendU16LE(b, e.B)
			b = AppendU32LE(b, e.C)
		case EventContractProgress:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
			b = AppendU16LE(b, e.B)
		case EventContractComplete:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
		case EventStyle:
			b = AppendU16LE(b, e.A)
			b = AppendU16LE(b, e.B)
			b = AppendU32LE(b, e.C)
			b = append(b, e.D)
		case EventCapture:
			b = AppendU16LE(b, e.A)
			b = AppendU16LE(b, e.X)
			b = AppendU16LE(b, e.Y)
			b = AppendU32LE(b, e.C)
			b = append(b, e.D)
		case EventRevenge:
			b = AppendU16LE(b, e.A)
			b = AppendU16LE(b, e.B)
		case EventDailyAssign:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
			b = AppendU16LE(b, e.B)
			b = AppendU32LE(b, e.C)
		case EventDailyProgress:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
			b = AppendU16LE(b, e.B)
		case EventDailyComplete:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
		case EventAchievement:
			b = AppendU16LE(b, e.A)
			b = append(b, e.D)
		case EventReclaim:
			b = AppendU16LE(b, e.A)
			b = AppendU16LE(b, e.B)
			b = AppendU16LE(b, e.X)
			b = AppendU16LE(b, e.Y)
		case EventCoolBatch:
			b = AppendU16LE(b, e.A)
			b = AppendU16LE(b, e.B)
			b = AppendU32LE(b, e.C)
		default:
			b = append(b, 0)
		}
	}

	pd.B = b
	return pd
}

// ROIPlayer — игрок в том виде, в каком он уезжает в ROI-пакет. Отдельный тип,
// а не *Player: на провод едет одиннадцать полей из полутора сотен, и запись
// зафиксирована по длине (roiPlayerRecordLen) — всё остальное про игрока к
// формату отношения не имеет.
type ROIPlayer struct {
	Num    uint16
	X      uint16
	Y      uint16
	Dir    uint8
	Alive  bool
	Score  uint16
	Points uint16
	Hue    uint16
	Shield uint8
	Bot    bool
	Cos    [5]uint8
}

// EncodeROI собирает пакет MsgROIBinary: заголовок, записи игроков, рамка
// региона и две дельты (сетка и след) готовыми словами PackChange.
//
// Как именно собраны дельты — полным сканом региона или отбором из журнала
// изменений — формату безразлично, поэтому кодер один на оба пути.
func EncodeROI(tick uint32, rx, ry, rw, rh int, players []ROIPlayer, dg, dt []uint32) *PooledData {
	bytesPlayers := len(players) * roiPlayerRecordLen
	bytesDG := len(dg) * 4
	bytesDT := len(dt) * 4
	capHint := 1 + 4 + 2 + bytesPlayers + 2 + 2 + 2 + 2 + 4 + 4 + bytesDG + bytesDT
	if capHint < 64 {
		capHint = 64
	}
	pd := AcquirePooledData(capHint)
	out := pd.B

	out = append(out, MsgROIBinary)
	out = AppendU32LE(out, tick)
	out = AppendU16LE(out, uint16(len(players)))
	for _, p := range players {
		out = AppendU16LE(out, p.Num)
		out = AppendU16LE(out, p.X)
		out = AppendU16LE(out, p.Y)
		out = append(out, p.Dir)
		if p.Alive {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = AppendU16LE(out, p.Score)
		out = AppendU16LE(out, p.Points)
		out = AppendU16LE(out, p.Hue)
		out = append(out, p.Shield)
		if p.Bot {
			out = append(out, 1)
		} else {
			out = append(out, 0)
		}
		out = append(out, p.Cos[0], p.Cos[1], p.Cos[2], p.Cos[3], p.Cos[4])
	}
	out = AppendU16LE(out, uint16(rx))
	out = AppendU16LE(out, uint16(ry))
	out = AppendU16LE(out, uint16(rw))
	out = AppendU16LE(out, uint16(rh))
	out = AppendU32LE(out, uint32(bytesDG))
	out = AppendU32LE(out, uint32(bytesDT))
	for _, v := range dg {
		out = AppendU32LE(out, v)
	}
	for _, v := range dt {
		out = AppendU32LE(out, v)
	}

	pd.B = out
	return pd
}

// MinimapCursor — состояние постраничной выдачи полной миникарты. Полная карта
// не влезает в одно сообщение, поэтому чанки уходят страницами, а курсор живёт
// между тиками.
type MinimapCursor struct {
	FullActive bool
	FullCursor int
}

// EncodeMinimapChunks собирает пакет MsgMinimapChunk и двигает курсор.
//
// changed — журнал изменений сетки словами PackChange, cellAt отдаёт значение
// клетки в том виде, в каком его видит провод. Если дельта разрослась шире
// разумного (вдвое больше страницы уникальных чанков), кодер сам переключается
// на полную выдачу: перечислить всю карту дешевле, чем гнать почти всю её
// поштучно.
func EncodeMinimapChunks(cur *MinimapCursor, full bool, tick uint32, changed []uint32, cellAt func(i int) uint16) []byte {
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

		for _, ch := range changed {
			addChunk(int(ch >> 16))
			if unique > threshold {
				break
			}
		}

		if unique > threshold {
			cur.FullActive = true
			cur.FullCursor = 0
			full = true
			chunks = chunks[:0]
		} else if len(chunks) == 0 {
			return nil
		}
	}

	if full {
		start := cur.FullCursor
		for len(chunks) < MinimapMaxChunksPerMsg {
			idx := start + len(chunks)
			if idx >= chunksX*chunksY {
				break
			}
			chunks = append(chunks, idx)
		}
		cur.FullCursor = start + len(chunks)
		if cur.FullCursor >= chunksX*chunksY {
			cur.FullActive = false
			cur.FullCursor = 0
		}
	}

	// type(1) + tick(4) + cw(1)+ch(1)+count(2)+flags(1) + chunks*(cx(1)+cy(1)+payload)
	chunkCells := MinimapChunkW * MinimapChunkH
	payloadBytes := chunkCells * 2
	out := make([]byte, 0, 1+4+1+1+2+1+len(chunks)*(2+payloadBytes))
	out = append(out, MsgMinimapChunk)
	var b4 [4]byte
	binary.LittleEndian.PutUint32(b4[:], tick)
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
					v = cellAt(gy*W + gx)
				}
				binary.LittleEndian.PutUint16(b2[:], v)
				out = append(out, b2[:]...)
			}
		}
	}

	return out
}
