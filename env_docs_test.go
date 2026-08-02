package main

// Сверка «код ↔ документация» по переменным окружения.
//
// .env.example и документация расходились с кодом уже не раз: переменную
// добавляли в код, а в шаблон конфига не заносили — и на сервере её просто
// никто не выставлял. Этот тест делает сверку автоматической: любая новая
// os.Getenv("X") в неотладочном коде обязана появиться и в .env.example, и в
// docs/config.md. README держит только ссылку на этот документ: таблица там
// была бы третьей копией и первой же расходилась бы с кодом.
//
// Тестовые файлы не сканируются: переменные вроде UPDATE_GOLDEN — это ручка
// самих тестов, а не конфигурация сервера.

import (
	"io/fs"
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
	// Обход всего дерева, а не только корня: настройки читают и пакеты в
	// internal/ (WS_ORIGINS в httpx, MAX_PROFILES в profiles). Пока сканировался
	// один корень, вынос кода в пакет молча выключал бы проверку.
	err := filepath.WalkDir(".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			// tools/node_modules и прочее чужое добро сканировать незачем.
			if name := d.Name(); path != "." && (strings.HasPrefix(name, ".") || name == "node_modules") {
				return fs.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range envRefRe.FindAllStringSubmatch(string(b), -1) {
			names[m[1]] = struct{}{}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("обхожу дерево репозитория: %v", err)
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
		{filepath.Join("docs", "config.md"), "опишите переменную в таблице конфигурации"},
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
