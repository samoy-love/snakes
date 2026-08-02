// Package metrics — счётчики сервера и их выдача на /metrics.
//
// Пакет отдельный и намеренно ничего не знает об игре: считать умеет и
// транспорт, и игровой цикл, а зависимость в обратную сторону (метрики знают
// про Room) сделала бы пакет неиспользуемым из ws-слоя.
package metrics

import (
	"fmt"
	"net/http"
	"sync/atomic"
)

// Счётчики транспорта. Глобальные, потому что точек инкремента много и они
// разбросаны по обработчикам, которым незачем таскать за собой реестр.
var (
	WSConnections atomic.Uint64
	WSWriteErrors atomic.Uint64
	WSDropped     atomic.Uint64
	WSActive      atomic.Int64
)

// Handler отдаёт снимок счётчиков.
func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(
		"{\"wsConnections\":%d,\"wsActive\":%d,\"wsWriteErrors\":%d,\"wsDropped\":%d}\n",
		WSConnections.Load(),
		WSActive.Load(),
		WSWriteErrors.Load(),
		WSDropped.Load(),
	)))
}
