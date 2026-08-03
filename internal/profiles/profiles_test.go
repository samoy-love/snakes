package profiles

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"snakes/internal/metrics"
)

// ---------------------------------------------------------------------------
// G7: профиль живого игрока не вытесняется
// ---------------------------------------------------------------------------

func TestLiveProfileIsNotEvicted(t *testing.T) {
	withEmptyProfileStore(t)
	prevMax := MaxProfiles
	MaxProfiles = 4
	t.Cleanup(func() { MaxProfiles = prevMax })

	const livePID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	now := time.Now().Unix()
	Mu.Lock()
	// Самый несвежий профиль в хранилище — и при этом он держится живым
	// подключением, поэтому вытеснять его нельзя.
	store[livePID] = &Profile{StyleBalance: 500, LastSeen: now - 100000}
	for i, pid := range []string{
		"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"cccccccccccccccccccccccccccccccc",
		"dddddddddddddddddddddddddddddddd",
	} {
		store[pid] = &Profile{StyleBalance: 5, LastSeen: now - int64(i)*10}
	}
	Mu.Unlock()

	RetainPID(livePID)
	for i := 0; i < 5; i++ {
		ForKeyCreate(fmt.Sprintf("%032x", 900+i))
	}

	Mu.Lock()
	pr, ok := store[livePID]
	Mu.Unlock()
	if !ok {
		t.Fatal("профиль подключённого игрока вытеснен")
	}
	if pr.StyleBalance != 500 {
		t.Fatalf("баланс живого профиля = %d, ожидалось 500", pr.StyleBalance)
	}

	// После отключения он снова обычный кандидат.
	ReleasePID(livePID)
	for i := 0; i < 8; i++ {
		ForKeyCreate(fmt.Sprintf("%032x", 950+i))
	}
	Mu.Lock()
	_, still := store[livePID]
	Mu.Unlock()
	if still {
		t.Fatal("отключённый профиль так и не стал кандидатом на вытеснение")
	}
}

// ---------------------------------------------------------------------------
// G6: битый profiles.json не должен затираться пустым store
// ---------------------------------------------------------------------------

func resetProfilesReadOnly(t *testing.T) {
	t.Helper()
	prev := profilesReadOnly.Load()
	prevReason := profilesReadOnlyReason
	t.Cleanup(func() {
		profilesReadOnly.Store(prev)
		profilesReadOnlyReason = prevReason
	})
	profilesReadOnly.Store(false)
	profilesReadOnlyReason = ""
}

// TestCorruptProfilesFileIsNotOverwritten: обрезанный файл раньше приводил к
// старту с пустым store, а первый же Flush(true) записывал поверх
// {"profiles":{}} — тихая потеря прогресса всех игроков без падения и с зелёным
// healthcheck. Теперь store переходит в read-only, битый файл уезжает в
// .corrupt-<ts>, а сохранение запрещено.
func TestCorruptProfilesFileIsNotOverwritten(t *testing.T) {
	withEmptyProfileStore(t)
	resetProfilesReadOnly(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "profiles.json")
	t.Setenv("PROFILES_PATH", path)

	const pid = "33333333333333333333333333333333"
	raw := fmt.Sprintf(`{"version":1,"savedAt":%d,"profiles":{%q:{"styleBalance":4242`,
		time.Now().Unix(), pid)
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatalf("не удалось записать битый файл: %v", err)
	}

	Load(nil)

	if !profilesSavingDisabled() {
		t.Fatal("после битого файла сохранение осталось разрешённым")
	}

	// Битый файл переименован, а не оставлен под ударом.
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("битый файл остался на месте (err=%v)", err)
	}
	ents, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	quarantined := ""
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), "profiles.json.corrupt-") {
			quarantined = filepath.Join(dir, e.Name())
		}
	}
	if quarantined == "" {
		t.Fatalf("карантинная копия не создана, в каталоге: %v", ents)
	}
	got, err := os.ReadFile(quarantined)
	if err != nil {
		t.Fatalf("чтение карантина: %v", err)
	}
	if string(got) != raw {
		t.Fatal("карантинная копия не совпадает с исходником")
	}

	// Ни явный flush, ни saveProfiles ничего не пишут.
	ForKeyCreate("44444444444444444444444444444444")
	Flush(true)
	if err := saveProfiles(); err == nil {
		t.Fatal("saveProfiles отработал в read-only режиме")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("в read-only режиме файл всё-таки создан (err=%v)", err)
	}

	// Контроль: отсутствие файла — не ошибка, режим не включается.
	withEmptyProfileStore(t)
	resetProfilesReadOnly(t)
	t.Setenv("PROFILES_PATH", filepath.Join(t.TempDir(), "nope.json"))
	Load(nil)
	if profilesSavingDisabled() {
		t.Fatal("отсутствующий файл ошибочно принят за битый")
	}
}

// ---------------------------------------------------------------------------
// Хранилище профилей: без создания на «заходе», короткий TTL для пустых,
// потолок размера карты.
// ---------------------------------------------------------------------------

func withEmptyProfileStore(t *testing.T) {
	t.Helper()
	t.Cleanup(SwapStore())
}

// TestProfileForKeyDoesNotStore — атака «connect без токена -> join ->
// disconnect» давала новую запись в карте на каждое подключение. Путь чтения
// обязан возвращать пустой профиль-значение и НЕ писать в карту.
func TestProfileForKeyDoesNotStore(t *testing.T) {
	withEmptyProfileStore(t)

	const pid = "0123456789abcdef0123456789abcdef"
	pr := ForKey(pid)
	if pr == nil {
		t.Fatal("ForKey вернул nil для валидного pid")
	}
	if n := Len(); n != 0 {
		t.Fatalf("чтение создало %d записей, ожидалось 0", n)
	}
	// Запись через временный профиль никуда не сохраняется.
	pr.StyleBalance = 1234
	if again := ForKey(pid); again.StyleBalance != 0 {
		t.Fatalf("временный профиль просочился в хранилище: balance=%d", again.StyleBalance)
	}
	if ForKey("") != nil {
		t.Fatal("пустой ключ должен давать nil")
	}
	// TouchLastSeen тоже не должен создавать запись.
	TouchLastSeen(pid)
	if n := Len(); n != 0 {
		t.Fatalf("TouchLastSeen создал %d записей", n)
	}
}

// TestProfileForKeyCreateStoresAndKeepsProgress: запись заводится на первом
// реальном начислении, и уже заработанный Стиль после этого не теряется.
func TestProfileForKeyCreateStoresAndKeepsProgress(t *testing.T) {
	withEmptyProfileStore(t)

	const pid = "0123456789abcdef0123456789abcdef"
	pr := ForKeyCreate(pid)
	if pr == nil {
		t.Fatal("ForKeyCreate вернул nil")
	}
	if n := Len(); n != 1 {
		t.Fatalf("в хранилище %d записей, ожидалась 1", n)
	}
	Mu.Lock()
	AddStyleLocked(pr, 500)
	Mu.Unlock()

	// Дальнейшее чтение обязано видеть тот же объект с прогрессом.
	if got := ForKey(pid); got.StyleBalance != 500 {
		t.Fatalf("после начисления чтение вернуло balance=%d, ожидалось 500", got.StyleBalance)
	}
	if got := ForKeyCreate(pid); got != pr {
		t.Fatal("повторный create завёл вторую запись вместо существующей")
	}
	if ForKeyCreate("") != nil {
		t.Fatal("пустой ключ должен давать nil и в create")
	}
}

func TestProfileEmptyTTLIsShort(t *testing.T) {
	now := time.Now()

	empty := &Profile{LastSeen: now.Add(-EmptyTTL - time.Minute).Unix()}
	Mu.Lock()
	expiredEmpty := profileExpiredLocked(empty, now)
	Mu.Unlock()
	if !expiredEmpty {
		t.Fatalf("пустой профиль старше %v должен протухать", EmptyTTL)
	}

	// Тот же возраст, но с заработанным Стилем: живёт полные 90 дней.
	rich := &Profile{LastSeen: now.Add(-EmptyTTL - time.Minute).Unix(), StyleBalance: 10}
	Mu.Lock()
	expiredRich := profileExpiredLocked(rich, now)
	hasProgress := profileHasProgressLocked(rich)
	Mu.Unlock()
	if expiredRich {
		t.Fatal("профиль с балансом протух по короткому TTL")
	}
	if !hasProgress {
		t.Fatal("баланс не считается прогрессом")
	}

	// А через 90 дней протухает и он.
	old := &Profile{LastSeen: now.Add(-profileTTL - time.Hour).Unix(), StyleBalance: 10}
	Mu.Lock()
	expiredOld := profileExpiredLocked(old, now)
	Mu.Unlock()
	if !expiredOld {
		t.Fatal("профиль старше 90 дней должен протухать")
	}

	// Косметика: бит 0 бесплатный и прогрессом не считается, любой другой - да.
	free := &Profile{CosInvHead: 1, CosInvSeg: 1}
	bought := &Profile{CosInvHead: 1 | 4}
	titled := &Profile{TitleID: 3}
	achv := &Profile{AchvMask: 2}
	Mu.Lock()
	gotFree := profileHasProgressLocked(free)
	gotBought := profileHasProgressLocked(bought)
	gotTitled := profileHasProgressLocked(titled)
	gotAchv := profileHasProgressLocked(achv)
	Mu.Unlock()
	if gotFree {
		t.Fatal("бесплатный дефолт косметики принят за прогресс")
	}
	if !gotBought || !gotTitled || !gotAchv {
		t.Fatalf("прогресс не распознан: cos=%v title=%v achv=%v", gotBought, gotTitled, gotAchv)
	}
}

func TestProfileStoreEvictsLeastRecentlySeen(t *testing.T) {
	withEmptyProfileStore(t)
	prevMax := MaxProfiles
	MaxProfiles = 4
	t.Cleanup(func() { MaxProfiles = prevMax })

	now := time.Now().Unix()
	pids := []string{
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"cccccccccccccccccccccccccccccccc",
		"dddddddddddddddddddddddddddddddd",
	}
	Mu.Lock()
	for i, pid := range pids {
		// У всех есть прогресс, чтобы вытеснение шло именно по LastSeen.
		store[pid] = &Profile{StyleBalance: 5, LastSeen: now - int64(len(pids)-i)*3600}
	}
	Mu.Unlock()

	ForKeyCreate("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")

	if n := Len(); n > MaxProfiles {
		t.Fatalf("в хранилище %d записей при потолке %d", n, MaxProfiles)
	}
	Mu.Lock()
	_, oldestAlive := store[pids[0]]
	_, newestAlive := store[pids[len(pids)-1]]
	_, freshAlive := store["eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]
	Mu.Unlock()
	if oldestAlive {
		t.Fatal("вытеснен не самый несвежий профиль")
	}
	if !newestAlive {
		t.Fatal("вытеснен свежий профиль")
	}
	if !freshAlive {
		t.Fatal("новая запись не создана")
	}
}

// TestProfilesRoundTripKeepsProgress: старые файлы обязаны продолжать
// грузиться, а заработанный Стиль - переживать сохранение и загрузку.
func TestProfilesRoundTripKeepsProgress(t *testing.T) {
	withEmptyProfileStore(t)
	path := filepath.Join(t.TempDir(), "profiles.json")
	t.Setenv("PROFILES_PATH", path)

	const richPID = "11111111111111111111111111111111"
	const emptyPID = "22222222222222222222222222222222"
	now := time.Now().Unix()

	// Файл в старом формате: без части ключей косметики, с балансом.
	raw := fmt.Sprintf(`{"version":1,"savedAt":%d,"profiles":{
		%q:{"styleBalance":777,"totalStyleGained":900,"cosInvHead":5,"cosEqHead":2,"lastSeen":%d},
		%q:{"lastSeen":%d}
	}}`, now, richPID, now, emptyPID, now)
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatalf("не удалось записать файл профилей: %v", err)
	}

	Load(nil)
	pr := ForKey(richPID)
	if pr.StyleBalance != 777 || pr.CosInvHead != 5 || pr.CosEqHead != 2 {
		t.Fatalf("старый профиль загрузился с потерями: %+v", *pr)
	}
	if n := Len(); n != 2 {
		t.Fatalf("загружено %d профилей, ожидалось 2", n)
	}

	// Сохранение и повторная загрузка не теряют прогресс.
	if err := saveProfiles(); err != nil {
		t.Fatalf("saveProfiles: %v", err)
	}
	withEmptyProfileStore(t)
	Load(nil)
	if got := ForKey(richPID); got.StyleBalance != 777 {
		t.Fatalf("после round-trip balance=%d, ожидалось 777", got.StyleBalance)
	}
}

// TestProfilesLoadDropsStaleEmpty: пустые профили не должны переживать
// перезапуск дольше короткого TTL, а профили с прогрессом - должны.
func TestProfilesLoadDropsStaleEmpty(t *testing.T) {
	withEmptyProfileStore(t)
	path := filepath.Join(t.TempDir(), "profiles.json")
	t.Setenv("PROFILES_PATH", path)

	stale := time.Now().Add(-EmptyTTL - time.Hour).Unix()
	raw := fmt.Sprintf(`{"version":1,"savedAt":%d,"profiles":{
		%q:{"lastSeen":%d},
		%q:{"styleBalance":10,"lastSeen":%d}
	}}`, time.Now().Unix(),
		"33333333333333333333333333333333", stale,
		"44444444444444444444444444444444", stale)
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatalf("не удалось записать файл профилей: %v", err)
	}

	Load(nil)
	Mu.Lock()
	_, emptyAlive := store["33333333333333333333333333333333"]
	_, richAlive := store["44444444444444444444444444444444"]
	Mu.Unlock()
	if emptyAlive {
		t.Fatal("протухший пустой профиль загружен")
	}
	if !richAlive {
		t.Fatal("профиль с прогрессом потерян при загрузке")
	}
}

// ---------------------------------------------------------------------------
// ParseToken: вся модель идентичности держится на этой подписи.
// ---------------------------------------------------------------------------

func withTestProfileSecret(t *testing.T) {
	t.Helper()
	prev := profileSecret
	profileSecret = []byte("test-profile-secret")
	t.Cleanup(func() { profileSecret = prev })
}

// mintToken собирает токен вручную, чтобы тест мог подменить любое поле.
func mintToken(pid string, iat int64, sign bool) string {
	iatStr := strconv.FormatInt(iat, 10)
	mac := profileTokenSign(profileTokenVersion + "." + pid + "." + iatStr)
	if !sign {
		mac = append([]byte(nil), mac...)
		mac[0] ^= 0xFF
	}
	return profileTokenVersion + "." + b64u([]byte(pid)) + "." + b64u([]byte(iatStr)) + "." + b64u(mac)
}

func TestParseProfileToken(t *testing.T) {
	withTestProfileSecret(t)

	const pid = "0123456789abcdef0123456789abcdef"
	const otherPID = "fedcba9876543210fedcba9876543210"
	now := time.Now().Unix()

	valid := mintToken(pid, now, true)
	if got, ok := ParseToken(valid); !ok || got != pid {
		t.Fatalf("валидный токен: got=%q ok=%v, ожидалось %q/true", got, ok, pid)
	}

	// Подменённый pid при неизменной подписи: MAC считается по pid, поэтому
	// подстановка чужого идентификатора обязана слететь на проверке.
	iatStr := strconv.FormatInt(now, 10)
	macOfPID := profileTokenSign(profileTokenVersion + "." + pid + "." + iatStr)
	swapped := profileTokenVersion + "." + b64u([]byte(otherPID)) + "." + b64u([]byte(iatStr)) + "." + b64u(macOfPID)

	// Подпись чужим секретом.
	profileSecret = []byte("attacker-secret")
	foreign := mintToken(pid, now, true)
	profileSecret = []byte("test-profile-secret")

	cases := []struct {
		name string
		tok  string
	}{
		{"empty", ""},
		{"garbage", "not-a-token"},
		{"wrong_version", "v2." + b64u([]byte(pid)) + "." + b64u([]byte(iatStr)) + "." + b64u(macOfPID)},
		{"too_few_parts", profileTokenVersion + "." + b64u([]byte(pid)) + "." + b64u([]byte(iatStr))},
		{"too_many_parts", valid + ".extra"},
		{"forged_mac", mintToken(pid, now, false)},
		{"swapped_pid", swapped},
		{"foreign_secret", foreign},
		{"expired_iat", mintToken(pid, time.Now().Add(-profileTokenMaxAge-time.Hour).Unix(), true)},
		{"future_iat", mintToken(pid, time.Now().Add(48*time.Hour).Unix(), true)},
		{"bad_base64_pid", profileTokenVersion + ".!!!." + b64u([]byte(iatStr)) + "." + b64u(macOfPID)},
		{"bad_base64_iat", profileTokenVersion + "." + b64u([]byte(pid)) + ".!!!." + b64u(macOfPID)},
		{"bad_base64_mac", profileTokenVersion + "." + b64u([]byte(pid)) + "." + b64u([]byte(iatStr)) + ".!!!"},
		{"pid_too_short", mintToken("0123456789abcdef", now, true)},
		{"pid_too_long", mintToken(pid+"00", now, true)},
		{"pid_not_hex", mintToken("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", now, true)},
		{"oversized", profileTokenVersion + "." + strings.Repeat("A", 600)},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if got, ok := ParseToken(tc.tok); ok {
				t.Fatalf("токен принят (pid=%q), ожидался отказ", got)
			}
		})
	}

	// Токен внутри срока жизни принимается.
	edge := mintToken(pid, time.Now().Add(-profileTokenMaxAge+time.Hour).Unix(), true)
	if _, ok := ParseToken(edge); !ok {
		t.Fatal("токен внутри срока жизни отвергнут")
	}

	// ResolveToken на мусоре обязан выдать НОВЫЙ валидный pid.
	newPID, fresh := ResolveToken("garbage")
	if !validProfilePID(newPID) {
		t.Fatalf("ResolveToken выдал невалидный pid %q", newPID)
	}
	if got, ok := ParseToken(fresh); !ok || got != newPID {
		t.Fatalf("перевыпущенный токен не разбирается: got=%q ok=%v", got, ok)
	}
}

// ---------------------------------------------------------------------------
// Античит: потолки дохода Стиля
// ---------------------------------------------------------------------------

func TestStyleIncomeGrantLockedMinuteCeiling(t *testing.T) {
	pr := &Profile{}
	if got := StyleIncomeGrantLocked(pr, "pid", 300); got != 300 {
		t.Fatalf("первое начисление = %d, ожидалось 300", got)
	}
	if got := StyleIncomeGrantLocked(pr, "pid", 300); got != styleIncomePerMinute-300 {
		t.Fatalf("добор до потолка = %d, ожидалось %d", got, styleIncomePerMinute-300)
	}
	if got := StyleIncomeGrantLocked(pr, "pid", 50); got != 0 {
		t.Fatalf("за потолком минуты выдано %d, ожидался 0", got)
	}
	if pr.styleWindowGained != styleIncomePerMinute {
		t.Fatalf("накоплено %d, ожидалось ровно %d", pr.styleWindowGained, styleIncomePerMinute)
	}
	// Окно скользящее: через минуту потолок открывается заново.
	pr.styleWindowStart = time.Now().Unix() - 61
	if got := StyleIncomeGrantLocked(pr, "pid", 100); got != 100 {
		t.Fatalf("после сброса окна выдано %d, ожидалось 100", got)
	}
	// Нулевая дельта проходит насквозь и окно не трогает.
	before := pr.styleWindowGained
	if got := StyleIncomeGrantLocked(pr, "pid", 0); got != 0 || pr.styleWindowGained != before {
		t.Fatalf("нулевая дельта изменила окно: got=%d gained=%d", got, pr.styleWindowGained)
	}
}

func TestStyleDayIncomeGrantLockedSoftCap(t *testing.T) {
	// До мягкого потолка платят полностью.
	pr := &Profile{}
	if got := StyleDayIncomeGrantLocked(pr, 500); got != 500 {
		t.Fatalf("под потолком выдано %d, ожидалось 500", got)
	}
	if pr.DayIncome != 500 {
		t.Fatalf("DayIncome=%d, ожидалось 500", pr.DayIncome)
	}
	if pr.DayIncomeDay != DayStampNow() {
		t.Fatal("день дохода не проставлен")
	}

	// Пересечение потолка: часть полностью, остаток по 40% с округлением вверх.
	// 100 полных + ceil(300*2/5)=120 -> 220.
	pr = &Profile{DayIncome: StyleDaySoftCap - 100, DayIncomeDay: DayStampNow()}
	if got := StyleDayIncomeGrantLocked(pr, 400); got != 220 {
		t.Fatalf("на границе потолка выдано %d, ожидалось 220", got)
	}
	if pr.DayIncome != StyleDaySoftCap-100+220 {
		t.Fatalf("DayIncome=%d, ожидалось %d", pr.DayIncome, StyleDaySoftCap-100+220)
	}

	// Полностью за потолком.
	pr = &Profile{DayIncome: StyleDaySoftCap, DayIncomeDay: DayStampNow()}
	if got := StyleDayIncomeGrantLocked(pr, 100); got != 40 {
		t.Fatalf("за потолком выдано %d, ожидалось 40", got)
	}
	// Округление вверх: мелкое начисление за потолком не должно пропадать.
	pr = &Profile{DayIncome: StyleDaySoftCap, DayIncomeDay: DayStampNow()}
	if got := StyleDayIncomeGrantLocked(pr, 1); got != 1 {
		t.Fatalf("минимальное начисление за потолком = %d, ожидалось 1", got)
	}

	// Смена суток обнуляет счётчик.
	pr = &Profile{DayIncome: StyleDaySoftCap * 2, DayIncomeDay: DayStampNow() - 1}
	if got := StyleDayIncomeGrantLocked(pr, 100); got != 100 {
		t.Fatalf("в новых сутках выдано %d, ожидалось 100", got)
	}
	if pr.DayIncome != 100 {
		t.Fatalf("DayIncome после смены суток = %d, ожидалось 100", pr.DayIncome)
	}
}

// ---------------------------------------------------------------------------
// PROFILE_SECRET_REQUIRED
// ---------------------------------------------------------------------------

// Ловит: молчаливое включение гейта от постороннего значения и, наоборот,
// «включил, а не сработало». Умолчание обязано быть «выключено»: опечатка в
// env-файле не должна ни ронять прод, ни тихо снимать защиту.
func TestEnvFlagEnabled(t *testing.T) {
	for _, v := range []string{"1", "true", "TRUE", " yes ", "on"} {
		if !envFlagEnabled(v) {
			t.Errorf("envFlagEnabled(%q) = false, ожидалось true", v)
		}
	}
	for _, v := range []string{"", "0", "false", "no", "off", "enabled", "Y", "х"} {
		if envFlagEnabled(v) {
			t.Errorf("envFlagEnabled(%q) = true, ожидалось false", v)
		}
	}
}

// Ловит: потерю гейта. С заданным PROFILE_SECRET флаг обязан быть безразличен,
// иначе прод падает на ровном месте.
func TestInitSecretWithRequiredFlagAndSecret(t *testing.T) {
	t.Setenv("PROFILE_SECRET", "test-secret")
	t.Setenv("PROFILE_SECRET_REQUIRED", "1")
	prev := profileSecret
	t.Cleanup(func() { profileSecret = prev })

	InitSecret()
	if string(profileSecret) != "test-secret" {
		t.Fatalf("profileSecret = %q, ожидалось значение из окружения", string(profileSecret))
	}
}

// Ловит: read-only режим, о котором наружу ничего не сообщается. Без ReadOnly()
// /readyz нечем отличить «работаем» от «выбрасываем весь прогресс игроков».
func TestReadOnlyReportsReason(t *testing.T) {
	if ro, _ := ReadOnly(); ro {
		t.Skip("хранилище уже в read-only от другого теста")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "profiles.json")
	if err := os.WriteFile(path, []byte("{ это не json"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PROFILES_PATH", path)

	enterProfilesReadOnly(path, "parse_error", fmt.Errorf("boom"))
	t.Cleanup(func() {
		profilesReadOnly.Store(false)
		profilesReadOnlyReason = ""
		metrics.ProfilesReadOnly.Set(0)
	})

	ro, reason := ReadOnly()
	if !ro || reason != "parse_error" {
		t.Fatalf("ReadOnly() = %v, %q; ожидалось true, \"parse_error\"", ro, reason)
	}
}
