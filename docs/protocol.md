# Бинарный протокол

Как сервер и клиент разговаривают по WebSocket. Раскладка байтов зафиксирована
побайтовыми тестами: `protocol_test.go` со стороны сервера и `tests/` со стороны
клиента — рассинхрон кодера с декодером трижды ломал игру молча.

## WebSocket-протокол

Один эндпоинт — `GET /ws`. Управляющие сообщения идут **текстом** в виде JSON
`{"type": "...", "data": {...}}`; игровое состояние — **бинарными** кадрами, в
которых первый байт задаёт тип сообщения.

### Текстовые сообщения

От сервера: `hello` (размеры поля, `tickMs`, `roomLimit`, токен личности),
`rooms`, `init` (`you`, `room`, `w`, `h`, тик, границы матча, косметика),
`nameUpdate`, `chat`, `matchStart`, `cosmetics`, `rttPong`, `error`.

От клиента: `rooms`, `setName`, `join`, `createRoom`, `leave`, `chat`, `input`,
`respawn`, `matchContinue`, `cosmeticsBuy`, `cosmeticsEquip`, `rttPing`.
Каждый тип ограничен отдельным token-bucket по IP (см. `handleWS` в `ws.go`).

### Бинарные сообщения

Первый байт — тип (константы `MsgROIBinary`, `MsgMinimapChunk`,
`MsgEventsBinary` в `protocol.go`), дальше little-endian.

| Тип | Константа | Сериализатор (`protocol.go`) | Назначение |
| --- | --- | --- | --- |
| `2` | `MsgROIBinary` | `buildROIPooledFast` / `buildROIPooledScan` | Основной канал: снапшот области интереса вокруг игрока. Окно по умолчанию 80×56, но клиент может запросить своё под вьюпорт (сообщение `viewport`, границы в `hello.roi`); начало окна снапится по 8 клеток. Полный или дельта относительно `sinceTick` |
| `4` | `MsgMinimapChunk` | `(*Room).buildMinimapChunkBinary` | Чанки миникарты 10×10 клеток; полная карта раскатывается порциями, дальше идут только изменившиеся чанки |
| `5` | `MsgEventsBinary` | `(*Room).buildEventsPooledLocked` | Пакет игровых событий + мета матча (фаза, счётчики, bounty, мутатор) |

Разбор на клиенте — `handleStateBinary(buf)` в `public/client.js`; транспорт и
реконнект — `createNetModule` в `public/client_net.js`. Эталонная байтовая
раскладка зафиксирована в `protocol_test.go` (сервер) и в
`tests/golden/protocol_golden.json` + `tests/*.test.mjs` (клиент) — при
изменении сериализатора падают обе стороны, и клиент нужно править синхронно.
Подробности — в разделе «Клиентские тесты протокола».

### 21 тип игровых событий

Общая структура события: байт `kind`, затем поля из `Event` (`A`, `B`, `X`, `Y`
— `uint16`, `C` — `uint32`, `D` — `uint8`) в порядке, специфичном для каждого
типа; точные длины payload перечислены в `protocol_test.go` и в
`tests/golden/protocol_golden.json` (там же — порядок и ширина каждого поля).

Неизвестный клиенту `kind` сервер пишет одним байтом-заглушкой, а клиент его
пропускает и продолжает разбор: иначе старый закешированный клиент терял бы весь
остаток пакета после первого же нового типа события.

| Код | Константа | Смысл |
| --- | --- | --- |
| 1 | `EventKill` | Убийство: кто, кого, причина, координаты |
| 2 | `EventStreak` | Серия убийств |
| 3 | `EventBountyAssign` | Назначена награда за голову |
| 4 | `EventBountyClaim` | Награда за голову получена |
| 5 | `EventPowerupSpawn` | На поле появился бонус |
| 6 | `EventPowerupPickup` | Бонус подобран |
| 7 | `EventMutatorStart` | Включился мутатор матча |
| 8 | `EventMutatorEnd` | Мутатор закончился |
| 9 | `EventPowerupUse` | Бонус применён |
| 10 | `EventContractAssign` | Выдан контракт |
| 11 | `EventContractProgress` | Прогресс по контракту |
| 12 | `EventContractComplete` | Контракт выполнен |
| 13 | `EventStyle` | Начислен «Стиль» (с причиной начисления) |
| 14 | `EventRevenge` | Месть обидчику |
| 15 | `EventDailyAssign` | Выдана ежедневка |
| 16 | `EventDailyProgress` | Прогресс по ежедневке |
| 17 | `EventDailyComplete` | Ежедневка выполнена |
| 18 | `EventAchievement` | Разблокировано достижение |
| 19 | `EventCapture` | Захват территории |
| 20 | `EventReclaim` | Игрок вернул свою остывающую территорию |
| 21 | `EventCoolBatch` | Территория погибшего пошла остывать (с тиком окончательного исчезновения) |
