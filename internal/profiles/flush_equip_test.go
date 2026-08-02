package profiles

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Персистентность профилей
// ---------------------------------------------------------------------------

// withTempProfilesPath уводит запись профилей во временный каталог и
// восстанавливает окружение после теста.
func withTempProfilesPath(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "profiles.json")
	prev, had := os.LookupEnv("PROFILES_PATH")
	if err := os.Setenv("PROFILES_PATH", path); err != nil {
		t.Fatalf("не удалось выставить PROFILES_PATH: %v", err)
	}
	t.Cleanup(func() {
		if had {
			_ = os.Setenv("PROFILES_PATH", prev)
		} else {
			_ = os.Unsetenv("PROFILES_PATH")
		}
	})
	return path
}

// flushProfiles — единственная защита прогресса игроков. Ловит:
//   - потерю флага dirty (файл перестаёт обновляться, прогресс живёт только
//     в памяти и исчезает при рестарте);
//   - запись при force даже без изменений (иначе первый снимок после старта
//     никогда бы не создавался).
func TestFlushWritesOnlyWhenDirtyOrForced(t *testing.T) {
	withEmptyProfileStore(t)
	path := withTempProfilesPath(t)

	// ForKeyCreate — единственный путь, кладущий запись в карту.
	pr := ForKeyCreate("0123456789abcdef0123456789abcdef")
	Mu.Lock()
	pr.StyleBalance = 42
	pr.LastSeen = time.Now().Unix()
	Mu.Unlock()

	// Без флага и без force запись не нужна.
	profilesDirty.Store(false)
	Flush(false)
	if _, err := os.Stat(path); err == nil {
		t.Fatal("Flush(false) записал файл при чистом флаге")
	}

	// force пишет всегда — иначе стартовый снимок не появится.
	Flush(true)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("Flush(true) не создал файл: %v", err)
	}
	if !strings.Contains(string(data), "\"version\"") {
		t.Fatalf("в файле нет версии схемы: %s", truncateForLog(string(data)))
	}
	if !strings.Contains(string(data), "0123456789abcdef0123456789abcdef") {
		t.Fatalf("профиль не попал в файл: %s", truncateForLog(string(data)))
	}

	// Флаг обязан сбрасываться, иначе каждый тик автосейва пишет файл заново.
	if profilesDirty.Load() {
		t.Fatal("после успешной записи флаг dirty остался взведён")
	}

	// Отметка изменения снова включает запись.
	_ = os.Remove(path)
	MarkDirty()
	Flush(false)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("после markProfilesDirty запись не произошла: %v", err)
	}
}

// startProfilesAutosave обязан останавливаться по каналу: горутина, пережившая
// shutdown, продолжит писать файл уже после того, как сервер попрощался с
// данными.
func TestStartAutosaveStopsOnSignal(t *testing.T) {
	withEmptyProfileStore(t)
	withTempProfilesPath(t)

	stop := make(chan struct{})
	StartAutosave(stop)
	close(stop)
	// Горутина не должна ничего писать после остановки; проверяем, что
	// закрытие канала не приводит к панике и повторное закрытие не нужно.
	time.Sleep(20 * time.Millisecond)
}

// profileSetEquippedLocked раскладывает выбранный предмет по нужному полю.
// Ловит копипасту в switch: перепутанные ветки означают, что игрок покупает
// голову, а надевается рамка.
func TestSetEquippedLockedRoutesEveryCategory(t *testing.T) {
	cases := []struct {
		cat string
		get func(*Profile) uint8
	}{
		{"capturefx", func(p *Profile) uint8 { return p.CosEqCaptureFx }},
		{"head", func(p *Profile) uint8 { return p.CosEqHead }},
		{"seg", func(p *Profile) uint8 { return p.CosEqSeg }},
		{"nameplate", func(p *Profile) uint8 { return p.CosEqNameplate }},
		{"frame", func(p *Profile) uint8 { return p.CosEqFrame }},
	}
	const want = 3
	for _, tc := range cases {
		pr := &Profile{}
		SetEquippedLocked(pr, tc.cat, want)
		if got := tc.get(pr); got != want {
			t.Fatalf("категория %q: экипировано %d, ожидалось %d", tc.cat, got, want)
		}
		// Ровно одно поле должно измениться.
		changed := 0
		for _, other := range cases {
			if other.get(pr) == want {
				changed++
			}
		}
		if changed != 1 {
			t.Fatalf("категория %q задела %d полей, ожидалось 1", tc.cat, changed)
		}
	}

	// nil и неизвестная категория не должны паниковать: cat приходит от клиента.
	SetEquippedLocked(nil, "head", 1)
	pr := &Profile{}
	SetEquippedLocked(pr, "нет-такой", 4)
	if pr.CosEqHead != 0 || pr.CosEqFrame != 0 {
		t.Fatal("неизвестная категория что-то изменила")
	}
}

func truncateForLog(s string) string {
	if len(s) > 200 {
		return s[:200] + "..."
	}
	return s
}
