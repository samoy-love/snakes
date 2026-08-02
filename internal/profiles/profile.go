package profiles

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
