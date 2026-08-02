package envcfg

import "testing"

// Ловит: молчаливое принятие мусора в числовых переменных окружения
// (PORT/ROOM_LIMIT/MAX_ROOMS читаются через ParseInt).
func TestParseInt(t *testing.T) {
	cases := []struct {
		in   string
		want int
		ok   bool
	}{
		{"0", 0, true},
		{"42", 42, true},
		{"-7", -7, true},
		{"", 0, false},
		{"abc", 0, false},
	}
	for _, c := range cases {
		got, err := ParseInt(c.in)
		if (err == nil) != c.ok {
			t.Fatalf("ParseInt(%q): err=%v, ожидалось ok=%v", c.in, err, c.ok)
		}
		if c.ok && got != c.want {
			t.Fatalf("ParseInt(%q) = %d, ожидалось %d", c.in, got, c.want)
		}
	}
}
