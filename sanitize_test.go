package main

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// ---------------------------------------------------------------------------
// Санитайзеры пользовательского ввода.
//
// Ключевые инварианты:
//   - обрезка считается в РУНАХ, а не в байтах: кириллица и эмодзи не должны
//     резаться посередине, результат всегда валидный UTF-8;
//   - control-символы, \r, \n, \t, '<' и '>' вырезаются;
//   - пустой/пробельный/полностью запрещённый ввод даёт "";
//   - функции идемпотентны.
// ---------------------------------------------------------------------------

type sanitizer struct {
	name   string
	fn     func(string) string
	maxLen int
	// stripsAngle: вырезает ли санитайзер '<' и '>'. sanitizeLogField этого
	// намеренно не делает — он готовит строку для лога, а не для HTML, и там
	// угловые скобки безопасны и полезны для читаемости.
	stripsAngle bool
}

func allSanitizers() []sanitizer {
	return []sanitizer{
		{"sanitizeName", sanitizeName, NameMaxLen, true},
		{"sanitizeChat", sanitizeChat, ChatMaxLen, true},
		{"sanitizeRoomName", sanitizeRoomName, RoomNameMaxLen, true},
		{"sanitizeLogField", sanitizeLogField, 200, false},
	}
}

// truncRunes повторяет обрезку санитайзеров: по рунам, затем TrimSpace.
func truncRunes(s string, maxLen int) string {
	r := []rune(s)
	if len(r) > maxLen {
		r = r[:maxLen]
	}
	return strings.TrimSpace(string(r))
}

func TestSanitizersEmptyAndBlank(t *testing.T) {
	inputs := []struct {
		name string
		in   string
	}{
		{"empty", ""},
		{"spaces", "     "},
		{"tabs", "\t\t\t"},
		{"newlines", "\n\r\n"},
		{"mixed_ws", " \t\r\n  \n "},
		{"nbsp_only", " "}, // NBSP: не ASCII-пробел, сохраняется как символ
	}
	for _, s := range allSanitizers() {
		for _, tc := range inputs {
			t.Run(s.name+"/"+tc.name, func(t *testing.T) {
				got := s.fn(tc.in)
				if tc.name == "nbsp_only" {
					// NBSP не входит в TrimSpace? Входит: unicode.IsSpace(U+00A0) == true.
					if got != "" {
						t.Fatalf("%q -> %q, ожидалась пустая строка", tc.in, got)
					}
					return
				}
				if got != "" {
					t.Fatalf("%q -> %q, ожидалась пустая строка", tc.in, got)
				}
			})
		}
	}
}

func TestSanitizersStripForbiddenOnly(t *testing.T) {
	// Строки, целиком состоящие из запрещённых символов, должны схлопываться в "".
	inputs := []string{
		"<>",
		"<<<<>>>>",
		"<script>",       // не пусто: остаётся "script"
		"\x00\x01\x02",   // control
		"\x07\x08\x0b\f", // control
	}
	for _, s := range allSanitizers() {
		t.Run(s.name, func(t *testing.T) {
			for _, in := range inputs {
				got := s.fn(in)
				want := ""
				if s.stripsAngle {
					if in == "<script>" {
						want = "script"
					}
				} else {
					// sanitizeLogField сохраняет угловые скобки, вырезая только control-символы.
					want = strings.Map(func(r rune) rune {
						if r < 0x20 || r == 0x7f {
							return -1
						}
						return r
					}, in)
					want = strings.TrimSpace(want)
				}
				if got != want {
					t.Fatalf("%q -> %q, ожидалось %q", in, got, want)
				}
			}
		})
	}
}

func TestSanitizersStripControlAndAngleBrackets(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"angle", "a<b>c", "abc"},
		{"nul", "a\x00b", "ab"},
		{"bell", "a\x07b", "ab"},
		{"vtab", "a\x0bb", "ab"},
		{"formfeed", "a\fb", "ab"},
		{"tab_to_space", "a\tb", "a b"},
		{"cr_to_space", "a\rb", "a b"},
		{"lf_to_space", "a\nb", "a b"},
		{"crlf_to_spaces", "a\r\nb", "a  b"},
		{"trim_edges", "  hi  ", "hi"},
		{"xss", "<img src=x onerror=alert(1)>", "img src=x onerror=alert(1)"},
	}
	for _, s := range allSanitizers() {
		for _, tc := range tests {
			t.Run(s.name+"/"+tc.name, func(t *testing.T) {
				want := tc.want
				if !s.stripsAngle {
					// sanitizeLogField оставляет '<' и '>' как есть.
					want = tc.in
					want = strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(want)
					want = strings.Map(func(r rune) rune {
						if r < 0x20 || r == 0x7f {
							return -1
						}
						return r
					}, want)
					want = strings.TrimSpace(want)
				}
				// Все санитайзеры обрезают результат по своему лимиту в рунах.
				want = truncRunes(want, s.maxLen)
				if got := s.fn(tc.in); got != want {
					t.Fatalf("%s(%q) = %q, ожидалось %q", s.name, tc.in, got, want)
				}
			})
		}
	}
}

// sanitizeLogField отдельно: он вырезает ВСЕ unicode-control (включая U+007F
// и C1-диапазон), тогда как остальные санитайзеры фильтруют только ch < 0x20.
func TestSanitizeLogFieldStripsAllControls(t *testing.T) {
	if got := sanitizeLogField("ab"); got != "ab" {
		t.Fatalf("sanitizeLogField DEL = %q, ожидалось %q", got, "ab")
	}
	if got := sanitizeLogField("ab"); got != "ab" {
		t.Fatalf("sanitizeLogField NEL = %q, ожидалось %q", got, "ab")
	}
	// Угловые скобки sanitizeLogField НЕ вырезает — это лог, не HTML.
	if got := sanitizeLogField("a<b>"); got != "a<b>" {
		t.Fatalf("sanitizeLogField(%q) = %q", "a<b>", got)
	}
}

// TestSanitizeLogFieldKeepsAngleBrackets документирует расхождение из теста
// выше: allSanitizers() включает sanitizeLogField, поэтому проверка скобок
// вынесена сюда, а общий тест использует только те кейсы, где поведение
// совпадает. См. TestSanitizersStripControlAndAngleBrackets.
func TestSanitizeLogFieldMaxLen(t *testing.T) {
	in := strings.Repeat("я", 500)
	got := sanitizeLogField(in)
	if runeLen(got) != 200 {
		t.Fatalf("runeLen = %d, ожидалось 200", runeLen(got))
	}
	if !utf8.ValidString(got) {
		t.Fatal("результат не является валидным UTF-8")
	}
}

// ---------------------------------------------------------------------------
// Обрезка по длине считается в рунах
// ---------------------------------------------------------------------------

func TestSanitizersTruncateByRunes(t *testing.T) {
	cases := []struct {
		name  string
		rune_ string
		bytes int
	}{
		{"ascii", "a", 1},
		{"cyrillic", "я", 2},
		{"cjk", "漢", 3},
		{"emoji_bmp", "☆", 3},
		{"emoji_astral", "😀", 4},
	}

	for _, s := range allSanitizers() {
		for _, c := range cases {
			t.Run(s.name+"/"+c.name, func(t *testing.T) {
				in := strings.Repeat(c.rune_, s.maxLen*3)
				got := s.fn(in)

				if !utf8.ValidString(got) {
					t.Fatalf("результат не валидный UTF-8: %q", got)
				}
				if n := runeLen(got); n != s.maxLen {
					t.Fatalf("%s: длина в рунах = %d, ожидалось %d", s.name, n, s.maxLen)
				}
				// Многобайтовый символ не должен резаться посередине:
				// длина в байтах кратна размеру руны.
				if len(got) != s.maxLen*c.bytes {
					t.Fatalf("%s: длина в байтах = %d, ожидалось %d (символ разрезан?)",
						s.name, len(got), s.maxLen*c.bytes)
				}
				if strings.ContainsRune(got, utf8.RuneError) {
					t.Fatalf("%s: в результате есть U+FFFD: %q", s.name, got)
				}
				if got != strings.Repeat(c.rune_, s.maxLen) {
					t.Fatalf("%s: неожиданный результат %q", s.name, got)
				}
			})
		}
	}
}

// TestSanitizersLengthIsRunesNotBytes: строка длиной ровно maxLen рун из
// многобайтовых символов должна проходить целиком.
func TestSanitizersLengthIsRunesNotBytes(t *testing.T) {
	for _, s := range allSanitizers() {
		t.Run(s.name, func(t *testing.T) {
			in := strings.Repeat("😀", s.maxLen)
			if got := s.fn(in); got != in {
				t.Fatalf("%s: строка из %d эмодзи обрезана: runeLen = %d",
					s.name, s.maxLen, runeLen(got))
			}
		})
	}
}

// TestSanitizeNameConcreteLimits — конкретные значения лимитов, чтобы
// изменение констант было явным решением, а не случайностью.
func TestSanitizerLimitConstants(t *testing.T) {
	if NameMaxLen != 18 {
		t.Fatalf("NameMaxLen = %d, ожидалось 18", NameMaxLen)
	}
	if ChatMaxLen != 180 {
		t.Fatalf("ChatMaxLen = %d, ожидалось 180", ChatMaxLen)
	}
	if RoomNameMaxLen != 32 {
		t.Fatalf("RoomNameMaxLen = %d, ожидалось 32", RoomNameMaxLen)
	}
}

// TestSanitizersTruncationCountsOnlyKeptRunes: запрещённые символы не
// «съедают» бюджет длины — счётчик увеличивается только на сохранённых рунах.
func TestSanitizersTruncationCountsOnlyKeptRunes(t *testing.T) {
	s := sanitizer{"sanitizeName", sanitizeName, NameMaxLen, true}
	in := strings.Repeat("<a>", NameMaxLen*2)
	got := s.fn(in)
	if runeLen(got) != NameMaxLen {
		t.Fatalf("runeLen = %d, ожидалось %d (%q)", runeLen(got), NameMaxLen, got)
	}
	if got != strings.Repeat("a", NameMaxLen) {
		t.Fatalf("получено %q", got)
	}
}

// ---------------------------------------------------------------------------
// Идемпотентность
// ---------------------------------------------------------------------------

func TestSanitizersIdempotent(t *testing.T) {
	inputs := []string{
		"",
		"   ",
		"обычное имя",
		"Игрок 42",
		"<b>bold</b>",
		"a\tb\nc\rd",
		"\x00\x01тест\x02",
		strings.Repeat("я", 500),
		strings.Repeat("😀", 300),
		strings.Repeat("<a>", 100),
		"  ведущие и хвостовые  ",
		"漢字テスト",
		"mixed кир123 ☆✦",
		strings.Repeat("a", 1000),
		"end with space " + strings.Repeat("b", 400),
	}
	for _, s := range allSanitizers() {
		for i, in := range inputs {
			once := s.fn(in)
			twice := s.fn(once)
			if once != twice {
				t.Fatalf("%s не идемпотентен на входе #%d (%q):\n once = %q\ntwice = %q",
					s.name, i, in, once, twice)
			}
			if !utf8.ValidString(once) {
				t.Fatalf("%s: результат не валидный UTF-8 на входе #%d", s.name, i)
			}
			if once != strings.TrimSpace(once) {
				t.Fatalf("%s: результат не обрезан по краям: %q", s.name, once)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// runeLen
// ---------------------------------------------------------------------------

func TestRuneLen(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"a", 1},
		{"abc", 3},
		{"я", 1},
		{"привет", 6},
		{"漢字", 2},
		{"😀", 1},
		{"a😀я", 3},
		{"☆✦", 2},
		{" \t\n", 3},
	}
	for _, tc := range tests {
		if got := runeLen(tc.in); got != tc.want {
			t.Fatalf("runeLen(%q) = %d, ожидалось %d", tc.in, got, tc.want)
		}
	}

	// runeLen должен совпадать с utf8.RuneCountInString на валидном UTF-8.
	for _, s := range []string{"", "hello", "привет мир", "😀😀😀", "漢字テスト", "a b"} {
		if got, want := runeLen(s), utf8.RuneCountInString(s); got != want {
			t.Fatalf("runeLen(%q) = %d, utf8.RuneCountInString = %d", s, got, want)
		}
	}

	// Битый UTF-8: range по строке выдаёт по одной RuneError на невалидный байт,
	// что совпадает с поведением utf8.RuneCountInString.
	broken := string([]byte{0xff, 0xfe, 'a'})
	if got, want := runeLen(broken), utf8.RuneCountInString(broken); got != want {
		t.Fatalf("runeLen на битом UTF-8 = %d, ожидалось %d", got, want)
	}
}
