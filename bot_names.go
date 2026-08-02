// bot_names.go holds the bot nickname pools (RU and EN) and the picker that
// keeps the names unique inside a room.
package main

import (
	"fmt"
	"math/rand"
	"strings"
	"unicode"
	"unicode/utf8"

	"snakes/internal/sanitize"
)

var botNickAdjRu = []string{
	"Лютый",
	"Сладкий",
	"Злой",
	"Добрый",
	"Хитрый",
	"Тихий",
	"Громкий",
	"Резкий",
	"Шустрый",
	"Сонный",
	"Наглый",
	"Смелый",
	"Кринжовый",
	"Токсичный",
	"Плюшевый",
	"Голодный",
}

var botNickNounRu = []string{
	"Пельмень",
	"Шашлык",
	"Котик",
	"Бобр",
	"Енот",
	"Гусь",
	"Кабан",
	"Карась",
	"Шмель",
	"Дед",
	"Школьник",
	"Танкист",
	"Ниндзя",
	"Чебурек",
	"Вареник",
	"Сосиска",
}

var botNickDumbRu = []string{
	"Квас",
	"Компот",
	"Лапша",
	"Тапок",
	"Сапог",
	"Шапка",
	"Пончик",
	"Блинчик",
	"Кефир",
	"Жмых",
	"Пшик",
	"Кусь",
	"Хомяк",
	"Тюлень",
	"Сыч",
	"Булка",
	"Селёдка",
	"Сардина",
	"Крабик",
	"Лимон",
	"Пупок",
	"Сметана",
	"Гречка",
	"Котлета",
}

var botNickFixedRu = []string{
	"Нагибатор",
	"КотикВШоке",
	"ДедНаСтиле",
	"ПельменьСудьбы",
	"ШашлыкБатя",
	"ГусьУльтима",
	"ЕнотКапец",
	"БобрИнженер",
	"КринжМашина",
	"ТихийУгар",
	"ЗлойКомпот",
	"СладкийКабан",
}

var botNickSuffixRu = []string{
	"ыч",
	"атор",
	"чик",
	"ка",
	"уля",
}

// G25: the English UI showed an all-Cyrillic leaderboard, which reads as a
// broken localisation rather than as flavour. Every bot now carries a second,
// English nickname of the same silly register; the client picks by its locale.
var botNickAdjEn = []string{
	"Angry",
	"Sweet",
	"Sneaky",
	"Quiet",
	"Loud",
	"Snappy",
	"Speedy",
	"Sleepy",
	"Cheeky",
	"Brave",
	"Cringe",
	"Toxic",
	"Plushy",
	"Hungry",
	"Salty",
	"Chunky",
}

var botNickNounEn = []string{
	"Dumpling",
	"Kebab",
	"Kitty",
	"Beaver",
	"Raccoon",
	"Goose",
	"Boar",
	"Carp",
	"Bumble",
	"Grandpa",
	"Schooler",
	"Tanker",
	"Ninja",
	"Donut",
	"Pickle",
	"Sausage",
}

var botNickDumbEn = []string{
	"Kvass",
	"Compote",
	"Noodle",
	"Slipper",
	"Boot",
	"Hat",
	"Muffin",
	"Pancake",
	"Kefir",
	"Squish",
	"Pfft",
	"Nom",
	"Hamster",
	"Seal",
	"Owlet",
	"Bun",
	"Herring",
	"Sardine",
	"Crabby",
	"Lemon",
	"Bellybtn",
	"Cream",
	"Buckwheat",
	"Cutlet",
}

var botNickFixedEn = []string{
	"Wreckerator",
	"KittyInShock",
	"GrandpaSwag",
	"DumplingFate",
	"KebabDaddy",
	"GooseUltima",
	"RaccoonOops",
	"BeaverEng",
	"CringeMachine",
	"QuietRiot",
	"AngryCompote",
	"SweetBoar",
}

var botNickSuffixEn = []string{
	"ster",
	"inator",
	"ie",
	"zz",
	"oid",
}

// botNamePools groups one language's word lists so the generator can be run
// twice over the same rng without duplicating its logic.
type botNamePools struct {
	adj       []string
	noun      []string
	dumb      []string
	fixed     []string
	suffix    []string
	fallback  string
	fallback2 string
}

var botPoolsRu = botNamePools{
	adj: botNickAdjRu, noun: botNickNounRu, dumb: botNickDumbRu,
	fixed: botNickFixedRu, suffix: botNickSuffixRu,
	fallback: "Нагибатор", fallback2: "Котик",
}

var botPoolsEn = botNamePools{
	adj: botNickAdjEn, noun: botNickNounEn, dumb: botNickDumbEn,
	fixed: botNickFixedEn, suffix: botNickSuffixEn,
	fallback: "Wreckerator", fallback2: "Kitty",
}

var botNickDecor = []string{
	"☆",
	"✦",
}

func botNameStartKey(nm string) string {
	s := nm
	for {
		r, size := utf8.DecodeRuneInString(s)
		if r == utf8.RuneError && size == 0 {
			break
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			break
		}
		s = s[size:]
	}
	if s == "" {
		return ""
	}

	best := ""
	check := func(list []string) {
		for _, w := range list {
			if w == "" {
				continue
			}
			if strings.HasPrefix(s, w) {
				if sanitize.RuneLen(w) > sanitize.RuneLen(best) {
					best = w
				}
			}
		}
	}
	check(botNickFixedRu)
	check(botNickAdjRu)
	check(botNickNounRu)
	check(botNickDumbRu)
	check(botNickFixedEn)
	check(botNickAdjEn)
	check(botNickNounEn)
	check(botNickDumbEn)

	if best != "" {
		return best
	}

	out := make([]rune, 0, 4)
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out = append(out, r)
			if len(out) >= 4 {
				break
			}
		}
	}
	return string(out)
}

func pickUniqueBotName(rng *rand.Rand, pools botNamePools, used map[string]struct{}, usedStarts map[string]struct{}, fallbackN int) string {
	if used == nil {
		used = make(map[string]struct{})
	}
	if usedStarts == nil {
		usedStarts = make(map[string]struct{})
	}
	fixedNums := []string{"228", "1337", "666", "777"}
	for tries := 0; tries < 1800; tries++ {
		adj := ""
		w1 := ""
		w2 := ""
		suf := ""
		digits := ""
		dec := ""
		decPrefix := false
		pickedFixed := false

		if rng.Float64() < 0.02 {
			dec = botNickDecor[rng.Intn(len(botNickDecor))]
			decPrefix = rng.Intn(2) == 0
		}

		if rng.Float64() < 0.18 {
			adj = pools.adj[rng.Intn(len(pools.adj))]
		}

		roll := rng.Float64()
		switch {
		case roll < 0.20:
			w1 = pools.fixed[rng.Intn(len(pools.fixed))]
			pickedFixed = true
		case roll < 0.70:
			w1 = pools.noun[rng.Intn(len(pools.noun))]
		default:
			w1 = pools.dumb[rng.Intn(len(pools.dumb))]
		}

		if !pickedFixed && rng.Float64() < 0.22 {
			if rng.Float64() < 0.55 {
				w2 = pools.dumb[rng.Intn(len(pools.dumb))]
			} else {
				w2 = pools.noun[rng.Intn(len(pools.noun))]
			}
			if w2 == w1 {
				w2 = ""
			}
		}

		if !pickedFixed && rng.Float64() < 0.10 {
			suf = pools.suffix[rng.Intn(len(pools.suffix))]
		}

		if rng.Float64() < 0.20 {
			if rng.Float64() < 0.14 {
				digits = fixedNums[rng.Intn(len(fixedNums))]
			} else {
				dr := rng.Float64()
				switch {
				case dr < 0.15:
					digits = fmt.Sprintf("%d", rng.Intn(10))
				case dr < 0.75:
					digits = fmt.Sprintf("%d", rng.Intn(90)+10)
				default:
					digits = fmt.Sprintf("%d", rng.Intn(900)+100)
				}
			}
		}

		assemble := func(adj, w1, w2, suf, digits, dec string, decPrefix bool) string {
			raw := ""
			if dec != "" && decPrefix {
				raw += dec
			}
			raw += adj + w1 + w2 + suf + digits
			if dec != "" && !decPrefix {
				raw += dec
			}
			return strings.ReplaceAll(raw, " ", "")
		}

		raw := assemble(adj, w1, w2, suf, digits, dec, decPrefix)
		if sanitize.RuneLen(raw) > sanitize.NameMaxLen {
			raw = assemble(adj, w1, w2, suf, digits, "", decPrefix)
		}
		if sanitize.RuneLen(raw) > sanitize.NameMaxLen {
			raw = assemble(adj, w1, w2, "", digits, "", decPrefix)
		}
		if sanitize.RuneLen(raw) > sanitize.NameMaxLen {
			raw = assemble(adj, w1, "", "", digits, "", decPrefix)
		}
		if sanitize.RuneLen(raw) > sanitize.NameMaxLen {
			raw = assemble("", w1, "", "", digits, "", decPrefix)
		}
		if sanitize.RuneLen(raw) > sanitize.NameMaxLen {
			if len(digits) == 3 {
				digits = fmt.Sprintf("%d", rng.Intn(90)+10)
			} else if len(digits) == 2 {
				digits = fmt.Sprintf("%d", rng.Intn(10))
			} else {
				digits = ""
			}
			raw = assemble("", w1, "", "", digits, "", decPrefix)
		}
		if sanitize.RuneLen(raw) > sanitize.NameMaxLen {
			continue
		}

		nm := sanitize.Name(raw)
		if nm == "" {
			continue
		}
		if sanitize.RuneLen(nm) > sanitize.NameMaxLen {
			continue
		}
		if _, ok := used[nm]; ok {
			continue
		}
		startKey := botNameStartKey(nm)
		if startKey == "" {
			continue
		}
		if _, ok := usedStarts[startKey]; ok {
			continue
		}
		used[nm] = struct{}{}
		usedStarts[startKey] = struct{}{}
		return nm
	}

	nm := sanitize.Name(fmt.Sprintf("%s%d", pools.fallback, fallbackN))
	if nm == "" {
		return sanitize.Name(fmt.Sprintf("%s%d", pools.fallback2, fallbackN))
	}
	return nm
}

// usedBotNamesLocked collects the names already taken in this room so the
// generator keeps producing distinguishable nicknames.
func (r *Room) usedBotNamesLocked() (map[string]struct{}, map[string]struct{}) {
	used := make(map[string]struct{}, BotCount)
	usedStarts := make(map[string]struct{}, BotCount)
	for _, kn := range r.knownNames {
		if kn.Name == "" {
			continue
		}
		used[kn.Name] = struct{}{}
		if k := botNameStartKey(kn.Name); k != "" {
			usedStarts[k] = struct{}{}
		}
	}
	return used, usedStarts
}

// usedBotNamesEnLocked is the same census over the English twins (G25); the two
// name spaces are kept unique independently of each other.
func (r *Room) usedBotNamesEnLocked() (map[string]struct{}, map[string]struct{}) {
	used := make(map[string]struct{}, BotCount)
	usedStarts := make(map[string]struct{}, BotCount)
	for _, kn := range r.knownNames {
		if kn.NameEn == "" {
			continue
		}
		used[kn.NameEn] = struct{}{}
		if k := botNameStartKey(kn.NameEn); k != "" {
			usedStarts[k] = struct{}{}
		}
	}
	return used, usedStarts
}
