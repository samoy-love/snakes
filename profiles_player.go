// profiles_player.go — перенос профиля в игрока и обратно.
//
// Живёт в игровом пакете, а не в internal/profiles: хранилище профилей ничего
// не знает про Player и не должно.
package main

import "snakes/internal/profiles"

// applyProfileCosmeticsToPlayerLocked refreshes the player's read-only render
// cache from the profile. Caller holds profiles.Mu (and rm.mu when pl is live).
func applyProfileCosmeticsToPlayerLocked(pl *Player, pr *profiles.Profile) {
	if pl == nil || pr == nil {
		return
	}
	pl.style = pr.StyleBalance
	pl.cosInvCaptureFx = pr.CosInvCaptureFx
	pl.cosInvHead = pr.CosInvHead
	pl.cosInvSeg = pr.CosInvSeg
	pl.cosInvNameplate = pr.CosInvNameplate
	pl.cosInvFrame = pr.CosInvFrame
	pl.cosCaptureFx = pr.CosEqCaptureFx
	pl.cosHead = pr.CosEqHead
	pl.cosSeg = pr.CosEqSeg
	pl.cosNameplate = pr.CosEqNameplate
	pl.cosFrame = pr.CosEqFrame
	pl.cosInvTerr = pr.CosInvTerr
	pl.cosInvDeath = pr.CosInvDeath
	pl.cosTerr = pr.CosEqTerr
	pl.cosDeath = pr.CosEqDeath
	pl.titleID = pr.TitleID
}
