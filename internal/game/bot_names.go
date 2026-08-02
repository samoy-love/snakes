// bot_names.go — перепись имён, уже занятых в комнате. Сам генератор живёт в
// internal/botnames; здесь остаётся только то, что смотрит в состояние комнаты.
package game

import "snakes/internal/botnames"

// generator keeps producing distinguishable nicknames.
func (r *Room) usedBotNamesLocked() (map[string]struct{}, map[string]struct{}) {
	used := make(map[string]struct{}, BotCount)
	usedStarts := make(map[string]struct{}, BotCount)
	for _, kn := range r.knownNames {
		if kn.Name == "" {
			continue
		}
		used[kn.Name] = struct{}{}
		if k := botnames.StartKey(kn.Name); k != "" {
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
		if k := botnames.StartKey(kn.NameEn); k != "" {
			usedStarts[k] = struct{}{}
		}
	}
	return used, usedStarts
}
