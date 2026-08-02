// Package sanitize — приведение приходящих извне строк к виду, пригодному для
// показа другим игрокам и для записи в лог.
//
// Пакет отдельный, потому что чистить строки нужно в трёх местах сразу: игра
// (имена, чат, названия комнат, лог), генератор ников ботов и всё, что появится
// после. Разъехавшиеся копии этих правил — это разъехавшиеся ограничения
// длины и разные наборы вырезаемых символов на разных путях.
package sanitize

import (
	"strings"
	"unicode"
)

const (
	// NameMaxLen — предел длины имени игрока В РУНАХ. Байтовый предел здесь не
	// годится: одно кириллическое имя из 18 символов занимает 36 байт.
	NameMaxLen     = 18
	ChatMaxLen     = 180
	RoomNameMaxLen = 32
	// LogFieldMaxLen ограничивает поле в строке лога: пользовательская строка
	// не должна раздувать журнал.
	LogFieldMaxLen = 200
)

// RuneLen — длина в рунах.
func RuneLen(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}

// spaces сводит перевод строки и табуляцию к пробелу: без этого имя игрока
// разрывает строку лога и ломает вёрстку у соседей.
var spaces = strings.NewReplacer("\r", " ", "\n", " ", "\t", " ")

// clamp — общее тело всех санитайзеров показа: вырезает управляющие символы и
// угловые скобки (последние закрывают путь к разметке на клиенте), обрезает по
// длине в рунах и схлопывает результат в пустую строку, если ничего не
// осталось.
func clamp(s string, maxLen int) string {
	raw := strings.TrimSpace(spaces.Replace(s))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= maxLen {
			break
		}
		if ch < 0x20 || ch == '<' || ch == '>' {
			continue
		}
		out = append(out, ch)
	}
	res := strings.TrimSpace(string(out))
	if res == "" {
		return ""
	}
	return res
}

// Name чистит имя игрока.
func Name(name string) string { return clamp(name, NameMaxLen) }

// Chat чистит сообщение чата.
func Chat(text string) string { return clamp(text, ChatMaxLen) }

// RoomName чистит название комнаты.
func RoomName(name string) string { return clamp(name, RoomNameMaxLen) }

// LogField чистит строку, уезжающую в журнал. Отличается от остальных тем, что
// вырезает ВСЕ управляющие символы, а не только диапазон до 0x20: подделка
// строки лога делается управляющими символами из старших диапазонов ровно так
// же. Угловые скобки здесь безобидны и остаются.
func LogField(s string) string {
	raw := strings.TrimSpace(spaces.Replace(s))
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, ch := range raw {
		if len(out) >= LogFieldMaxLen {
			break
		}
		if unicode.IsControl(ch) {
			continue
		}
		out = append(out, ch)
	}
	return strings.TrimSpace(string(out))
}
