package main

// V1: кэширование статики. client.js (~490 КБ) и style.css (~180 КБ) качались
// заново на каждый F5, потому что отдавались с Cache-Control: no-store.
//
// Контракт (index.html ставит ?v=__BUILD__, scripts/deploy.sh подменяет литерал
// на идентификатор релиза в уезжающей копии):
//   - .js/.css с непустым v, отличным от литерала __BUILD__ -> immutable на год;
//   - всё остальное .js/.css -> no-store;
//   - HTML -> всегда no-store (в нём и записан текущий ?v=).

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestCacheStaticMiddleware(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("body"))
	})
	h := cacheStaticMiddleware(next)

	cases := []struct {
		name string
		url  string
		want string
	}{
		{"корень — no-store", "/", "no-store"},
		{"index.html — no-store", "/index.html", "no-store"},
		{"index.html с версией всё равно no-store", "/index.html?v=rel-1", "no-store"},
		{"произвольный html — no-store", "/foo/bar.html", "no-store"},

		{"js без query — no-store", "/client.js", "no-store"},
		{"js с пустым v — no-store", "/client.js?v=", "no-store"},
		{"js с неподменённым литералом — no-store", "/client.js?v=" + buildPlaceholder, "no-store"},
		{"js с релизом — immutable", "/client.js?v=20260802-010203-deadbee", immutableCacheControl},
		{"вендоренный js с релизом — immutable", "/vendor/twemoji.min.js?v=rel-1", immutableCacheControl},

		{"css без query — no-store", "/style.css", "no-store"},
		{"css с релизом — immutable", "/style.css?v=rel-1", immutableCacheControl},

		// Соседние ES-модули приходят без query (импорт из client.js query не
		// наследует) и осознанно остаются на no-store — суммарно ~20 КБ.
		{"соседний ES-модуль — no-store", "/client_net.js", "no-store"},

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

// Литерал в index.html и константа в server.go обязаны совпадать: иначе
// незаштампованный index.html получит immutable и намертво залипнет.
func TestBuildPlaceholderMatchesIndexHTML(t *testing.T) {
	b, err := os.ReadFile("public/index.html")
	if err != nil {
		t.Skipf("public/index.html недоступен: %v", err)
	}
	src := string(b)
	if !strings.Contains(src, buildPlaceholder) {
		t.Fatalf("в public/index.html нет литерала %s — версионирование статики выключено; "+
			"ссылки на собственную статику должны иметь ?v=%s", buildPlaceholder, buildPlaceholder)
	}
	// Ровно те ссылки, ради которых всё затевалось.
	for _, want := range []string{
		"/client.js?v=" + buildPlaceholder,
		"/style.css?v=" + buildPlaceholder,
	} {
		if !strings.Contains(src, want) {
			t.Errorf("в public/index.html нет ссылки %s", want)
		}
	}
}
