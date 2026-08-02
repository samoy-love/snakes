// main.go holds the field/tick constants, environment-driven globals and the
// small shared helpers (geometry, direction math, sanitizers, colour math).
// Everything with a theme of its own lives in a sibling file.
package main

import (
	"log"
	"os"
	"strings"
	"time"
	"unicode"
)

var debugBotDeathSnap = os.Getenv("BOT_DEATH_SNAP") == "1"

const (
	W      = 200
	H      = 140
	N      = W * H
	TickMS = 100
)

var (
	MatchDurationTicks     uint32 = 3000
	MatchIntermissionTicks uint32 = 150
)

func init() {
	if v := os.Getenv("MATCH_DURATION_TICKS"); v != "" {
		if n, err := parseInt(v); err == nil && n > 0 {
			MatchDurationTicks = uint32(n)
		}
	}
	if v := os.Getenv("MATCH_INTERMISSION_TICKS"); v != "" {
		if n, err := parseInt(v); err == nil && n > 0 {
			MatchIntermissionTicks = uint32(n)
		}
	}
}

const (
	RoomHumanLimitDefault = 16
	ChatMaxLen            = 180
	ChatHistoryMax        = 80
	ChatMinInterval       = 500 * time.Millisecond
	NameMaxLen            = 18
	RoomNameMaxLen        = 32
)

const (
	MaxClientWSMsgBytes = 16 * 1024
	// Max time enqueue() may block on a full client queue before the client
	// is dropped. Keep small: broadcasts run on the room tick goroutine.
	SendBackpressureTimeout = 100 * time.Millisecond
)

// allowedWSOrigins is the WebSocket origin allowlist. It is seeded from the
// WS_ORIGINS env var (comma-separated), falling back to the production host.
// Without this, any deployment on a different domain — including Docker — is
// rejected at the handshake.
var allowedWSOrigins = loadAllowedWSOrigins()

func loadAllowedWSOrigins() map[string]struct{} {
	out := make(map[string]struct{})
	raw := strings.TrimSpace(os.Getenv("WS_ORIGINS"))
	if raw == "" {
		out["https://snakes.samoy.love"] = struct{}{}
		out["http://snakes.samoy.love"] = struct{}{}
		return out
	}
	for _, part := range strings.Split(raw, ",") {
		if o := normalizeWSOrigin(part); o != "" {
			out[o] = struct{}{}
		}
	}
	return out
}

// Build metadata, injected by the linker:
//
//	-ldflags "-X main.Version=... -X main.Commit=... -X main.BuildTime=..."
var (
	Version   = "dev"
	Commit    = "none"
	BuildTime = "unknown"
)

func init() {
	log.Printf("snakes build version=%s commit=%s buildTime=%s", Version, Commit, BuildTime)
}

func sanitizeRoomName(name string) string {
	raw := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(name))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= RoomNameMaxLen {
			break
		}
		if ch < 0x20 || ch == '<' || ch == '>' {
			continue
		}
		out = append(out, ch)
	}
	res := strings.TrimSpace(string(out))
	if res == "" {
		return ""
	}
	return res
}

func runeLen(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}

func isOpposite(a, b Dir) bool {
	return (a == DirUp && b == DirDown) || (a == DirDown && b == DirUp) || (a == DirLeft && b == DirRight) || (a == DirRight && b == DirLeft)
}

func dirToDelta(d Dir) (int, int) {
	switch d {
	case DirUp:
		return 0, -1
	case DirDown:
		return 0, 1
	case DirLeft:
		return -1, 0
	case DirRight:
		return 1, 0
	default:
		return 0, 0
	}
}

func turnLeft(d Dir) Dir {
	switch d {
	case DirUp:
		return DirLeft
	case DirDown:
		return DirRight
	case DirLeft:
		return DirDown
	case DirRight:
		return DirUp
	default:
		return d
	}
}

func turnRight(d Dir) Dir {
	switch d {
	case DirUp:
		return DirRight
	case DirDown:
		return DirLeft
	case DirLeft:
		return DirUp
	case DirRight:
		return DirDown
	default:
		return d
	}
}

func manhattan(x0, y0, x1, y1 int) int {
	dx := x0 - x1
	if dx < 0 {
		dx = -dx
	}
	dy := y0 - y1
	if dy < 0 {
		dy = -dy
	}
	return dx + dy
}

func parseDir(s string) (Dir, bool) {
	switch s {
	case "up":
		return DirUp, true
	case "down":
		return DirDown, true
	case "left":
		return DirLeft, true
	case "right":
		return DirRight, true
	default:
		return 0, false
	}
}

func sanitizeLogField(s string) string {
	raw := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(s))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= 200 {
			break
		}
		if unicode.IsControl(ch) {
			continue
		}
		out = append(out, ch)
	}
	return strings.TrimSpace(string(out))
}

func sanitizeName(name string) string {
	raw := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(name))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= NameMaxLen {
			break
		}
		if ch < 0x20 || ch == '<' || ch == '>' {
			continue
		}
		out = append(out, ch)
	}
	res := strings.TrimSpace(string(out))
	if res == "" {
		return ""
	}
	return res
}

func sanitizeChat(text string) string {
	raw := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(text))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= ChatMaxLen {
			break
		}
		if ch < 0x20 || ch == '<' || ch == '>' {
			continue
		}
		out = append(out, ch)
	}
	res := strings.TrimSpace(string(out))
	if res == "" {
		return ""
	}
	return res
}

func (r *Room) randInt(min int, max int) int {
	if max <= min {
		return min
	}
	return min + r.rng.Intn(max-min+1)
}

type hslVariant struct {
	s int
	l int
}

var colorVariants = []hslVariant{
	{s: 78, l: 52},
	{s: 78, l: 42},
	{s: 78, l: 62},
	{s: 90, l: 52},
	{s: 66, l: 52},
	{s: 90, l: 62},
}

func colorCodeToHSL(code uint16) (h int, s int, l int) {
	vCount := len(colorVariants)
	if vCount <= 0 {
		return int(code) % 360, 78, 52
	}
	c := int(code)
	h = c % 360
	if h < 0 {
		h = (h%360 + 360) % 360
	}
	vi := (c / 360) % vCount
	if vi < 0 {
		vi = (vi%vCount + vCount) % vCount
	}
	v := colorVariants[vi]
	return h, v.s, v.l
}

func colorDistance(a, b uint16) int {
	ha, sa, la := colorCodeToHSL(a)
	hb, sb, lb := colorCodeToHSL(b)
	dh := hueDistance(ha, hb)
	ds := absInt(sa - sb)
	dl := absInt(la - lb)
	return dh*4 + ds*3 + dl*3
}

func hueDistance(a, b int) int {
	d := a - b
	if d < 0 {
		d = -d
	}
	d = d % 360
	if d > 180 {
		return 360 - d
	}
	return d
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
