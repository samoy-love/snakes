package main

import (
	"testing"

	"nhooyr.io/websocket"
)

func refsOf(pd *pooledData) int32 { return pd.Refs() }

// newQueuedClient — клиент без сокета: enqueue трогает только closed и sendCh,
// так что этого достаточно для проверки очереди и подсчёта ссылок.
func newQueuedClient(size int) *Client {
	c := &Client{sendCh: make(chan outbound, size), ip: "test"}
	c.name.Store("t")
	return c
}

// ---------------------------------------------------------------------------
// Подсчёт ссылок на буфер.
// ---------------------------------------------------------------------------

// Ловит: сдвиг семантики счётчика ссылок. Утечка (буфер не возвращается в пул)
// и двойное освобождение (два клиента пишут в один и тот же переиспользованный
// массив) — оба тихие и оба ловятся только счётчиком.
func TestPooledRefCountLifecycle(t *testing.T) {
	pd := acquirePooledData(64)
	if got := refsOf(pd); got != 1 {
		t.Fatalf("свежий буфер имеет %d ссылок, ожидалась 1", got)
	}
	if len(pd.B) != 0 {
		t.Fatalf("свежий буфер не пуст: %d байт", len(pd.B))
	}
	if cap(pd.B) < 64 {
		t.Fatalf("ёмкость буфера %d, запрашивалось 64", cap(pd.B))
	}

	incPooledRef(pd)
	incPooledRef(pd)
	if got := refsOf(pd); got != 3 {
		t.Fatalf("после двух inc ссылок %d, ожидалось 3", got)
	}
	decPooledRef(pd)
	decPooledRef(pd)
	if got := refsOf(pd); got != 1 {
		t.Fatalf("после двух dec ссылок %d, ожидалась 1", got)
	}
	pd.B = append(pd.B, 1, 2, 3)
	decPooledRef(pd)
	if got := refsOf(pd); got != 0 {
		t.Fatalf("последний dec оставил %d ссылок", got)
	}
	if len(pd.B) != 0 {
		t.Fatalf("возвращённый в пул буфер сохранил %d байт", len(pd.B))
	}

	// nil-аргументы безопасны: они приходят с путей, где буфера просто нет.
	incPooledRef(nil)
	decPooledRef(nil)
	releasePooledData(nil)

	// Запрос большей ёмкости выделяет новый массив, а не отдаёт короткий.
	big := acquirePooledData(200000)
	if cap(big.B) < 200000 {
		t.Fatalf("ёмкость %d, запрашивалось 200000", cap(big.B))
	}
	decPooledRef(big)
}

// Ловит: возврат в пул огромных буферов — это тихий рост RSS, потому что
// sync.Pool держал бы мегабайтные массивы между тиками.
func TestOversizedBuffersAreNotPooled(t *testing.T) {
	pd := acquirePooledData(2 * 1024 * 1024)
	pd.B = append(pd.B, make([]byte, 8)...)
	decPooledRef(pd)
	// Буфер выброшен, а не очищен и положен обратно.
	if len(pd.B) != 8 {
		t.Fatalf("огромный буфер был подготовлен к переиспользованию: len=%d", len(pd.B))
	}

	// Тот же порог у пула uint32.
	s := make([]uint32, 4, 2_000_000)
	releaseU32(s)
	releaseU32(nil)
	got := acquireU32(8)
	if cap(got) >= 2_000_000 {
		t.Fatal("огромный слайс uint32 вернулся из пула")
	}
	if len(got) != 0 {
		t.Fatalf("слайс из пула не обнулён по длине: %d", len(got))
	}
}

// ---------------------------------------------------------------------------
// Backpressure и освобождение ссылок в enqueue.
// ---------------------------------------------------------------------------

// Ловит: утечку ссылки на закрытом клиенте — буфер никогда не вернулся бы в
// пул, а на каждом разрыве соединения их десятки.
func TestEnqueueOnClosedClientReleasesRef(t *testing.T) {
	c := newQueuedClient(4)
	c.closed.Store(true)
	pd := acquirePooledData(16)
	pd.B = append(pd.B, 1)

	if c.enqueue(websocket.MessageBinary, pd.B, pd, false) {
		t.Fatal("закрытый клиент принял сообщение")
	}
	if got := refsOf(pd); got != 0 {
		t.Fatalf("ссылок после отказа %d, ожидался 0 (утечка буфера)", got)
	}
	if len(c.sendCh) != 0 {
		t.Fatalf("в очередь закрытого клиента что-то попало: %d", len(c.sendCh))
	}
}

// Ловит: утечку ссылки на пути «очередь полна, сообщение дропаемое». Этот путь
// исполняется каждый тик для каждого отстающего клиента.
func TestEnqueueDropPathReleasesRefAndCounts(t *testing.T) {
	c := newQueuedClient(1)
	// Забиваем очередь.
	first := acquirePooledData(16)
	first.B = append(first.B, 1)
	if !c.enqueue(websocket.MessageBinary, first.B, first, true) {
		t.Fatal("первое сообщение не попало в пустую очередь")
	}
	if got := refsOf(first); got != 1 {
		t.Fatalf("принятое сообщение потеряло ссылку: %d", got)
	}

	dropped := metrics.wsDropped.Load()
	second := acquirePooledData(16)
	second.B = append(second.B, 2)
	if c.enqueue(websocket.MessageBinary, second.B, second, true) {
		t.Fatal("сообщение попало в полную очередь")
	}
	if got := refsOf(second); got != 0 {
		t.Fatalf("ссылок после дропа %d, ожидался 0 (утечка буфера)", got)
	}
	if metrics.wsDropped.Load() != dropped+1 {
		t.Fatal("дроп не посчитан в метриках")
	}

	// Приёмник вычитывает и отпускает свою ссылку — буфер возвращается в пул.
	m := <-c.sendCh
	if m.pd != first {
		t.Fatal("из очереди пришёл не тот буфер")
	}
	decPooledRef(m.pd)
	if got := refsOf(first); got != 0 {
		t.Fatalf("после вычитывания ссылок %d, ожидался 0", got)
	}
}

// Ловит: отправку пустого буфера (клиент получил бы кадр нулевой длины) и
// утечку ссылки на этом пути.
func TestSendBinaryPooledRejectsEmpty(t *testing.T) {
	c := newQueuedClient(4)
	if c.sendBinaryPooled(nil, false) {
		t.Fatal("nil-буфер принят к отправке")
	}
	pd := acquirePooledData(16) // длина 0
	if c.sendBinaryPooled(pd, false) {
		t.Fatal("пустой буфер принят к отправке")
	}
	if got := refsOf(pd); got != 0 {
		t.Fatalf("ссылок после отказа %d, ожидался 0", got)
	}
	if len(c.sendCh) != 0 {
		t.Fatalf("пустой буфер попал в очередь: %d", len(c.sendCh))
	}
}

// Ловит: разъезд владения буфером при веерной рассылке (room.go: комната
// делает incPooledRef на каждого клиента и отпускает собственную ссылку в
// конце). Ровно один возврат в пул — не ноль и не два.
func TestSharedBufferFanoutEndsAtZeroRefs(t *testing.T) {
	const clients = 5
	cs := make([]*Client, clients)
	for i := range cs {
		cs[i] = newQueuedClient(2)
	}
	// Один закрыт заранее, один с забитой очередью — оба обязаны отпустить
	// свою ссылку сами.
	cs[1].closed.Store(true)
	filler := acquirePooledData(8)
	filler.B = append(filler.B, 9)
	cs[2].enqueue(websocket.MessageBinary, filler.B, filler, true)
	cs[2].enqueue(websocket.MessageBinary, filler.B, nil, true)

	pd := acquirePooledData(64)
	pd.B = append(pd.B, 1, 2, 3, 4)
	for _, c := range cs {
		incPooledRef(pd)
		_ = c.sendBinaryPooled(pd, true)
	}
	decPooledRef(pd) // ссылка самой комнаты

	// Клиенты вычитывают очередь и отпускают свои ссылки.
	for _, c := range cs {
		for len(c.sendCh) > 0 {
			m := <-c.sendCh
			decPooledRef(m.pd)
		}
	}
	if got := refsOf(pd); got != 0 {
		t.Fatalf("после веерной рассылки ссылок %d, ожидался 0", got)
	}
}

// ---------------------------------------------------------------------------
// profileKey
// ---------------------------------------------------------------------------

// Ловит: подмену ключа профиля — если pid перестанет иметь приоритет над IP,
// прогресс за NAT смешается между разными людьми.
func TestClientProfileKeyPrefersPID(t *testing.T) {
	var nilClient *Client
	if got := nilClient.profileKey(); got != "" {
		t.Fatalf("nil-клиент дал ключ %q", got)
	}
	c := &Client{ip: "10.0.0.1"}
	if got := c.profileKey(); got != "10.0.0.1" {
		t.Fatalf("без pid ключ = %q, ожидался IP", got)
	}
	c.pid = "0123456789abcdef0123456789abcdef"
	if got := c.profileKey(); got != c.pid {
		t.Fatalf("с pid ключ = %q, ожидался pid", got)
	}
}
