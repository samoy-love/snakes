package metrics

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Ловит: поломку формата /metrics и потерю связи счётчиков с metrics.*.
// Ответ парсится внешним сбором, поэтому это обязан быть валидный JSON с
// ровно этими четырьмя ключами.
func TestMetricsHandler(t *testing.T) {
	read := func() map[string]int64 {
		rec := httptest.NewRecorder()
		Handler(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("код %d, ожидалось 200", rec.Code)
		}
		if got := rec.Header().Get("Content-Type"); got != "application/json" {
			t.Fatalf("Content-Type = %q, ожидалось application/json", got)
		}
		var m map[string]int64
		if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
			t.Fatalf("тело /metrics не JSON (%v): %s", err, rec.Body.String())
		}
		if len(m) != 4 {
			t.Fatalf("в ответе %d счётчиков, ожидалось 4: %s", len(m), rec.Body.String())
		}
		for _, k := range []string{"wsConnections", "wsActive", "wsWriteErrors", "wsDropped"} {
			if _, ok := m[k]; !ok {
				t.Fatalf("нет счётчика %q: %s", k, rec.Body.String())
			}
		}
		return m
	}

	before := read()
	WSConnections.Add(1)
	WSActive.Add(1)
	WSWriteErrors.Add(1)
	WSDropped.Add(1)
	// Счётчики глобальные — возвращаем их на место, чтобы соседние тесты
	// видели то же, что и до нас.
	defer func() {
		WSConnections.Add(^uint64(0))
		WSActive.Add(-1)
		WSWriteErrors.Add(^uint64(0))
		WSDropped.Add(^uint64(0))
	}()
	after := read()
	for k, v := range before {
		if after[k] != v+1 {
			t.Fatalf("%s = %d, ожидалось %d — счётчик отвязан от metrics.*", k, after[k], v+1)
		}
	}
}
