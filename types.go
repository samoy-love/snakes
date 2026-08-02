// types.go holds the core data structures shared by the whole server:
// the room, the player, the persisted profile, the websocket client and the
// small value types they are built from.
package main

import (
	"encoding/json"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"

	"nhooyr.io/websocket"
)

type Dir uint8

const (
	DirUp Dir = iota
	DirDown
	DirLeft
	DirRight
)

type playerAnchor struct {
	x, y   int
	hx, hy int
	alive  bool
	dir    Dir
}

type roiReq struct {
	c         *Client
	rx, ry    int
	rw, rh    int
	full      bool
	sinceTick uint32
}

type Room struct {
	hub   *Hub
	id    int
	title string
	limit int

	mu sync.Mutex

	gridOwner  []uint16
	trailOwner []uint16
	gridPos    []int32
	gridStamp  []uint32
	trailStamp []uint32

	// F5 "Reclaim": cells of a dead player stay unowned but remembered for
	// ReclaimTicks. Their former owner takes the whole connected patch back by
	// touching any of it; after the deadline the patch is dropped for good.
	coolOwner []uint16
	coolUntil []uint32
	// coolBatches is the expiry work queue: one entry per death, processed with
	// a per-tick budget so a big estate never stalls a tick.
	coolBatches []coolBatch
	coolCursor  int

	changedGrid  []uint32
	changedTrail []uint32

	minimapGrid       []uint32
	minimapDirty      bool
	minimapFullActive bool
	minimapFullCursor int

	events []Event

	metaDirty    bool
	metaSentTick uint32

	bountyTarget uint16
	bountyUntil  uint32
	// E11: no new bounty may be assigned before this tick.
	bountyCooldownUntil uint32

	mutatorType  uint8
	mutatorUntil uint32

	powerUps      []PowerUp
	nextPowerUpID uint16

	players    map[uint16]*Player
	clients    map[*Client]struct{}
	chat       []ChatMessage
	knownNames map[uint16]KnownName
	// knownNameSeq orders offline entries for the LRU cap (G5).
	knownNameSeq uint64

	scores map[uint16]uint16
	points map[uint16]uint16

	matchSeq         uint32
	matchStartTick   uint32
	matchEndTick     uint32
	matchEnded       bool
	matchResetAt     uint32
	matchKills       map[uint16]uint16
	matchDeaths      map[uint16]uint16
	matchStyleEarned map[uint16]uint32
	matchStyleBy     map[uint16][StyleReasonCount]uint16
	matchPointsBy    map[uint16][8]uint16
	matchContractsBy map[uint16][4]uint16
	matchEndSentSeq  uint32
	// G24: last match phase announced to clients. 0xff means "nothing sent
	// yet for this match", which is distinct from PhaseExpansion (0).
	phaseSent uint8

	nextPlayerNum uint16
	humanCount    int

	// G2: how many bots are currently hunting each victim. Rebuilt from the
	// actual bot state at the top of every tick so it cannot drift.
	huntersOn map[uint16]int

	tick              uint32
	forceFullSnapshot bool

	ticker *time.Ticker
	stopCh chan struct{}

	cleanupTimer *time.Timer
	cleanupToken uint64

	rng *rand.Rand

	bfsMark []uint32
	bfsDist []uint16
	bfsGen  uint32
	bfsQ    []int

	// G11: per-tick scratch for resolveHeadOnCollisions, reused instead of
	// allocating a fresh map and slices on every tick of every room.
	headOnCells   map[int][]uint16
	headOnTouched []int
	tmpSpeeders   []*Player

	tmpAlive   []*Player
	tmpPlayers []*Player
	tmpClients []*Client
	tmpReqs    []roiReq
	tmpAnchors map[uint16]playerAnchor
}

type matchResult struct {
	N  uint16 `json:"n"`
	Nm string `json:"nm"`
	// NmEn is the English twin of a bot nickname (G25); omitted for humans.
	NmEn  string `json:"nmEn,omitempty"`
	Bot   bool   `json:"bot"`
	P     uint16 `json:"p"`
	Cells uint16 `json:"cells"`
	// Pk is the peak territory held during the match, Avg the time-weighted
	// average. Cells alone is a snapshot at the final tick and reads as 0 for
	// anyone who died late (F3).
	Pk    uint16                   `json:"pk"`
	Avg   uint16                   `json:"avg"`
	K     uint16                   `json:"k"`
	D     uint16                   `json:"d"`
	Fr    uint8                    `json:"fr"`
	Place uint16                   `json:"place"`
	Ct    uint8                    `json:"ct"`
	Cp    uint16                   `json:"cp"`
	Cg    uint16                   `json:"cg"`
	Cu    uint32                   `json:"cu"`
	Cd    [4]uint16                `json:"cd"`
	Se    uint16                   `json:"se"`
	Sb    [StyleReasonCount]uint16 `json:"sb"`
	Pb    [8]uint16                `json:"pb"`
}

type KnownName struct {
	Name string
	// NameEn is the English-language twin of a bot nickname (G25). Empty for
	// humans, whose name is whatever they typed and is never translated.
	NameEn string
	Online bool
	// OfflineSeq orders offline entries for the LRU cap (G5). 0 while online.
	OfflineSeq uint64
}

type Player struct {
	num uint16

	name string
	// nameEn: G25, the English nickname of a bot. Empty for humans.
	nameEn string
	bot    bool

	x int
	y int

	homeX int
	homeY int

	dir        Dir
	pendingDir Dir

	nextX int
	nextY int
	nextI int

	alive     bool
	respawnAt uint32
	trail     []int
	owned     []int

	aiMode             uint8
	aiModeUntil        uint32
	aiTargetX          int
	aiTargetY          int
	aiNextDecisionTick uint32

	aiExpandPhase    uint8
	aiExpandDir      Dir
	aiExpandTurn     int8
	aiExpandOutLeft  uint8
	aiExpandSideLeft uint8
	aiExpandUntil    uint32
	aiHuntTarget     uint16
	aiExpandIntent   uint8
	aiExpandPrefer   uint8

	aiLastSeenTick uint32
	aiLastSeenType uint8
	aiLastSeenX    int
	aiLastSeenY    int
	aiLastSeenNum  uint16

	aiRecentX [aiRecentCap]int
	aiRecentY [aiRecentCap]int
	aiRecentI uint8
	aiRecentN uint8

	aiBaitSense    float32
	aiRiskiness    float32
	aiPredictDepth uint8

	// G3/G4: difficulty tier and behaviour archetype, plus the per-bot values
	// they derive. Server-side only, nothing here reaches the wire protocol.
	aiTier        uint8
	aiArchetype   uint8
	aiROIW        int
	aiROIH        int
	aiCooldownMin uint8
	aiCooldownMax uint8
	aiTrailBudget int
	aiHuntGate    float32
	// aiCloseFrac is the fraction of the trail budget at which the bot starts
	// looking for a way home. It used to be a hard-coded 0.72 for everyone,
	// which is why every archetype ran the same ~22-cell micro-loops and the
	// Farmer's larger budget never turned into larger territory (S4).
	aiCloseFrac float32
	// aiBudgetCap is this bot's own ceiling on the trail budget. Only the
	// Farmer is allowed past the shared 26.
	aiBudgetCap int

	// G2: victim this bot is accounted against in Room.huntersOn. Distinct
	// from aiHuntTarget, which stays the trail owner used for path validation.
	aiHuntWho uint16

	// G14: straight-line windup before a hunt becomes a real chase.
	aiWindupUntil uint32
	aiWindupDir   Dir

	// G17: throttle for the expensive trail scan in botStep.
	aiHuntScanTick uint32

	// F5: throttle for the cooling-territory scan, and the cell aiMode 5
	// is currently driving at.
	aiCoolScanTick uint32
	aiCoolCell     int

	// G8: ring of recent death ticks driving the respawn progression.
	aiDeathAt [aiDeathCap]uint32
	aiDeathI  uint8
	aiDeathN  uint8

	aiAggression float32
	aiCaution    float32
	aiBravery    int

	aiAvoidTick   uint32
	aiAvoidFrom   Dir
	aiAvoidTo     Dir
	aiAvoidReason uint8

	hue uint16

	killStreak     uint8
	lastKillTick   uint32
	shield         uint8
	speedUntil     uint32
	speedLockUntil uint32
	bonusBudget    uint16

	// F2: short post-respawn immunity. Cleared early once the player leaves
	// their own territory so it cannot be used as a battering ram.
	spawnGraceUntil uint32

	// Per-match counters, all reset in resetMatchLocked.
	peakCells         uint16 // F3: best territory held
	cellTicks         uint32 // F3: integral of territory over ticks
	styleCaptureMatch uint16 // E2: Style already paid for captures
	styleCaptureAcc   uint32 // G1: captured cells not yet worth a whole Style
	styleKillMatch    uint16 // E4: Style already paid for kills
	// G2: territory held over time. holdAcc carries cell-ticks that are not yet
	// worth a whole point, holdPointsMatch is the per-match budget spent.
	holdAcc          uint32
	holdPointsMatch  uint16
	reclaimsMatch    uint16 // G3: successful reclaims this match
	revengeStyleAcc  uint16 // G11: revenge Style spent this match
	revengeLastTgt   uint16 // G11: last revenge victim, for the repeat cooldown
	revengeLastTick  uint32
	bountyStyleMatch uint16 // G11: bounty Style (kill + survive) spent this match
	botKillsMatch    uint16 // E4: bot kills, drives the diminishing rate
	contractsDone    uint16 // E5: contracts completed

	// E12: re-entrancy guards for addStyle. styleDepth bounds recursion,
	// dailyRewardDepth marks Style that is itself a daily payout.
	styleDepth       uint8
	dailyRewardDepth uint8

	lastKiller     uint16
	lastKilledTick uint32

	style uint32

	cosInvCaptureFx uint8
	cosInvHead      uint8
	cosInvSeg       uint8
	cosInvNameplate uint8
	cosInvFrame     uint8
	cosCaptureFx    uint8
	cosHead         uint8
	cosSeg          uint8
	cosNameplate    uint8
	cosFrame        uint8
	// Extra categories and the title travel in the JSON "cosExtra" message, not
	// in the binary ROI record (its layout is frozen at 21 bytes).
	cosInvTerr  uint8
	cosInvDeath uint8
	cosTerr     uint8
	cosDeath    uint8
	titleID     uint8

	contractType     uint8
	contractGoal     uint16
	contractProgress uint16
	contractUntil    uint32

	profileKey string

	lastChatAt time.Time
}

type Profile struct {
	Day int64 `json:"day"`

	DailyType1 uint8  `json:"dailyType1"`
	DailyGoal1 uint16 `json:"dailyGoal1"`
	DailyProg1 uint16 `json:"dailyProg1"`

	DailyType2 uint8  `json:"dailyType2"`
	DailyGoal2 uint16 `json:"dailyGoal2"`
	DailyProg2 uint16 `json:"dailyProg2"`

	DailyType3 uint8  `json:"dailyType3"`
	DailyGoal3 uint16 `json:"dailyGoal3"`
	DailyProg3 uint16 `json:"dailyProg3"`

	// E7: login streak. Old files load with zeros, ensureProfileDailyLocked
	// seeds them on the first day rollover.
	StreakDays    uint32 `json:"streakDays"`
	StreakLastDay int64  `json:"streakLastDay"`
	// E7: day stamp of the last "first win of the day" bonus.
	FirstWinDay int64 `json:"firstWinDay"`

	// E13: soft daily income ceiling.
	DayIncome    uint32 `json:"dayIncome"`
	DayIncomeDay int64  `json:"dayIncomeDay"`

	TotalKills       uint32 `json:"totalKills"`
	TotalPickups     uint32 `json:"totalPickups"`
	TotalCapture     uint32 `json:"totalCapture"`
	TotalBounty      uint32 `json:"totalBounty"`
	TotalContracts   uint32 `json:"totalContracts"`
	TotalRevenge     uint32 `json:"totalRevenge"`
	TotalStyleGained uint32 `json:"totalStyleGained"`
	StyleBalance     uint32 `json:"styleBalance"`

	CosInvCaptureFx uint8 `json:"cosInvCaptureFx"`
	CosInvHead      uint8 `json:"cosInvHead"`
	CosInvSeg       uint8 `json:"cosInvSeg"`
	CosInvNameplate uint8 `json:"cosInvNameplate"`
	CosInvFrame     uint8 `json:"cosInvFrame"`
	CosEqCaptureFx  uint8 `json:"cosEqCaptureFx"`
	CosEqHead       uint8 `json:"cosEqHead"`
	CosEqSeg        uint8 `json:"cosEqSeg"`
	CosEqNameplate  uint8 `json:"cosEqNameplate"`
	CosEqFrame      uint8 `json:"cosEqFrame"`
	// Categories added later. Old profile files have no such keys, so they load
	// as 0 and ensureProfileCosmeticsLocked grants bit 0 (the free default).
	CosInvTerr  uint8 `json:"cosInvTerr"`
	CosInvDeath uint8 `json:"cosInvDeath"`
	CosEqTerr   uint8 `json:"cosEqTerr"`
	CosEqDeath  uint8 `json:"cosEqDeath"`

	AchvMask uint32 `json:"achvMask"`
	// TitleID is the equipped title. Titles are never bought, only unlocked by
	// achievements; 0 means "no title".
	TitleID uint8 `json:"titleId"`

	LastSeen int64 `json:"lastSeen"`

	// Sliding one-minute income window, runtime only.
	styleWindowStart  int64
	styleWindowGained uint32
	styleWindowLogged bool
}

type PowerUp struct {
	ID      uint16
	Type    uint8
	X       uint16
	Y       uint16
	Expires uint32
}

type Event struct {
	Kind uint8

	A uint16
	B uint16
	X uint16
	Y uint16
	C uint32
	D uint8
}

type ChatMessage struct {
	T    int64  `json:"t"`
	N    uint16 `json:"n"`
	Text string `json:"text"`
}

type Client struct {
	conn *websocket.Conn

	sendCh chan outbound

	name atomic.Value
	ip   string
	pid  string

	mu     sync.Mutex
	room   *Room
	player *Player

	lastRoomsAt         time.Time
	lastJoinAt          time.Time
	lastCreateAt        time.Time
	lastMatchContinueAt time.Time

	lastStateTick uint32
	lastROIX      int
	lastROIY      int
	lastROIW      int
	lastROIH      int

	// viewW/viewH is the window the client asked for with the "viewport"
	// message, in cells, already passed through clampViewport. Zero means
	// "never asked", which clampViewport turns into the historical
	// ROIWidth x ROIHeight, so an old client is served exactly as before.
	viewW int
	viewH int

	closed atomic.Bool
}

type outbound struct {
	msgType websocket.MessageType
	data    []byte
	drop    bool
	pd      *pooledData
}

type serverMetrics struct {
	wsConnections atomic.Uint64
	wsWriteErrors atomic.Uint64
	wsDropped     atomic.Uint64
	wsActive      atomic.Int64
}

var metrics serverMetrics

type ClientMsg struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type ServerMsg struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}
