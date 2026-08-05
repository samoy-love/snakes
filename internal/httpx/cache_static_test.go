package httpx

// V1: кэширование статики. client.js (~490 КБ) и style.css (~180 КБ) качались
// заново на каждый F5, потому что отдавались с Cache-Control: no-store.
//
// Контракт (index.html ставит ?v=__BUILD__, scripts/deploy.sh подменяет литерал
// на идентификатор релиза в уезжающей копии):
//   - .js/.css с непустым v, отличным от литерала __BUILD__ -> immutable на год;
//   - всё остальное .js/.css -> no-cache (обязательная ревалидация, но 304
//     вместо полной перекачки: соседние ES-модули приходят без ?v=);
//   - HTML -> всегда no-store (в нём и записан текущий ?v=).

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCacheStaticMiddleware(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("body"))
	})
	h := CacheStaticMiddleware(next)

	cases := []struct {
		name string
		url  string
		want string
	}{
		{"корень — no-store", "/", "no-store"},
		{"index.html — no-store", "/index.html", "no-store"},
		{"index.html с версией всё равно no-store", "/index.html?v=rel-1", "no-store"},
		{"произвольный html — no-store", "/foo/bar.html", "no-store"},

		{"js без query — ревалидация", "/client.js", revalidateCacheControl},
		{"js с пустым v — ревалидация", "/client.js?v=", revalidateCacheControl},
		{"js с неподменённым литералом — ревалидация", "/client.js?v=" + BuildPlaceholder, revalidateCacheControl},
		{"js с релизом — immutable", "/client.js?v=20260802-010203-deadbee", immutableCacheControl},
		{"вендоренный js с релизом — immutable", "/vendor/twemoji.min.js?v=rel-1", immutableCacheControl},

		{"css без query — ревалидация", "/css/01-base.css", revalidateCacheControl},
		{"css с релизом — immutable", "/css/01-base.css?v=rel-1", immutableCacheControl},

		// Соседние ES-модули приходят без query (импорт из client.js query не
		// наследует). no-cache: обязательная ревалидация, но 304 вместо ~20 КБ.
		{"соседний ES-модуль — ревалидация", "/client_net.js", revalidateCacheControl},

		{"эмодзи — immutable без всякого v", "/emoji-64/1f600.png", immutableCacheControl},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.url, nil))
			if got := rec.Header().Get("Cache-Control"); got != tc.want {
				t.Fatalf("%s: Cache-Control = %q, ожидалось %q", tc.url, got, tc.want)
			}
		})
	}
}

// Литерал в index.html и константа BuildPlaceholder обязаны совпадать: иначе
// незаштампованный index.html получит immutable и намертво залипнет.
func TestBuildPlaceholderMatchesIndexHTML(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "public", "index.html"))
	if err != nil {
		t.Skipf("public/index.html недоступен: %v", err)
	}
	src := string(b)
	if !strings.Contains(src, BuildPlaceholder) {
		t.Fatalf("в public/index.html нет литерала %s — версионирование статики выключено; "+
			"ссылки на собственную статику должны иметь ?v=%s", BuildPlaceholder, BuildPlaceholder)
	}
	// Ровно те ссылки, ради которых всё затевалось. Стили разрезаны на части
	// (public/css/NN-*.css), и версия обязана стоять у КАЖДОЙ: файл без ?v=
	// уходит на ревалидацию вместо immutable, а забытый в одной строке
	// плейсхолдер заметить глазами в шапке из шести <link> практически нельзя.
	for _, want := range []string{
		"/client.js?v=" + BuildPlaceholder,
		"/css/01-base.css?v=" + BuildPlaceholder,
	} {
		if !strings.Contains(src, want) {
			t.Errorf("в public/index.html нет ссылки %s", want)
		}
	}

	// Каждый .css из public/css подключён и подключён с версией.
	cssDir := filepath.Join("..", "..", "public", "css")
	entries, err := os.ReadDir(cssDir)
	if err != nil {
		t.Skipf("public/css недоступен: %v", err)
	}
	found := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".css") {
			continue
		}
		found++
		want := "/css/" + e.Name() + "?v=" + BuildPlaceholder
		if !strings.Contains(src, want) {
			t.Errorf("файл public/css/%s не подключён в index.html как %s", e.Name(), want)
		}
	}
	if found == 0 {
		t.Error("в public/css не нашлось ни одного .css — стили не поедут вовсе")
	}
}
