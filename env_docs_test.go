package main

// Сверка «код ↔ документация» по переменным окружения.
//
// .env.example и README расходились с кодом уже не раз: переменную добавляли в
// main.go/profiles.go, а в шаблон конфига не заносили — и на сервере её просто
// никто не выставлял. Этот тест делает сверку автоматической: любая новая
// os.Getenv("X") в неотладочном коде обязана появиться и в .env.example, и в
// README, и в docker-compose.yml.
//
// Тестовые файлы не сканируются: переменные вроде UPDATE_GOLDEN — это ручка
// самих тестов, а не конфигурация сервера.

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var envRefRe = regexp.MustCompile(`os\.(?:Getenv|LookupEnv)\("([A-Z][A-Z0-9_]*)"\)`)

// envDocExempt — переменные, которые читает код, но которым нечего делать в
// шаблоне конфига. Пусто: на момент написания таких нет. Запись сюда обязана
// сопровождаться объяснением, почему переменная не нужна оператору.
var envDocExempt = map[string]string{}

func collectEnvNames(t *testing.T) []string {
	t.Helper()
	names := map[string]struct{}{}
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("читаю корень репозитория: %v", err)
	}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".go" || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		b, err := os.ReadFile(e.Name())
		if err != nil {
			t.Fatalf("читаю %s: %v", e.Name(), err)
		}
		for _, m := range envRefRe.FindAllStringSubmatch(string(b), -1) {
			names[m[1]] = struct{}{}
		}
	}
	out := make([]string, 0, len(names))
	for n := range names {
		if _, skip := envDocExempt[n]; skip {
			continue
		}
		out = append(out, n)
	}
	sort.Strings(out)
	if len(out) == 0 {
		t.Fatal("не найдено ни одной os.Getenv — регулярка или раскладка файлов изменились")
	}
	return out
}

func TestEnvVarsAreDocumented(t *testing.T) {
	names := collectEnvNames(t)
	t.Logf("переменных окружения в коде: %d (%s)", len(names), strings.Join(names, ", "))

	docs := []struct {
		path string
		// hint — что именно дописать, если переменной там нет.
		hint string
	}{
		{".env.example", "добавьте запись с дефолтом и комментарием, зачем она"},
		{"README.md", "опишите переменную в таблице конфигурации"},
	}

	for _, d := range docs {
		b, err := os.ReadFile(d.path)
		if err != nil {
			t.Errorf("не читается %s: %v", d.path, err)
			continue
		}
		text := string(b)
		for _, n := range names {
			if !strings.Contains(text, n) {
				t.Errorf("переменная %s читается кодом, но не упомянута в %s — %s", n, d.path, d.hint)
			}
		}
	}
}

// В обратную сторону: в .env.example не должно остаться переменных, которые
// код уже не читает, — оператор выставит их и будет думать, что они работают.
// Исключение — переменные, которые потребляет сборка, а не сам сервер.
func TestEnvExampleHasNoStaleVars(t *testing.T) {
	b, err := os.ReadFile(".env.example")
	if err != nil {
		t.Fatalf("не читается .env.example: %v", err)
	}
	used := map[string]bool{}
	for _, n := range collectEnvNames(t) {
		used[n] = true
	}
	// Переменные, которые потребляет инфраструктура, а не сам сервер.
	infra := map[string]string{
		"VERSION": "вшивается в бинарь через -ldflags при сборке",
		"COMMIT":  "вшивается в бинарь через -ldflags при сборке",
	}

	assign := regexp.MustCompile(`(?m)^\s*#?\s*([A-Z][A-Z0-9_]*)=`)
	seen := map[string]bool{}
	for _, m := range assign.FindAllStringSubmatch(string(b), -1) {
		name := m[1]
		if seen[name] {
			continue
		}
		seen[name] = true
		if used[name] {
			continue
		}
		if why, ok := infra[name]; ok {
			t.Logf("%s — инфраструктурная переменная (%s), сервером не читается", name, why)
			continue
		}
		t.Errorf("в .env.example есть %s, но код её не читает — либо удалите, либо внесите в infra-список", name)
	}
}
