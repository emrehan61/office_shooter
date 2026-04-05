package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func newTestGame() *Game {
	return &Game{
		players:         newPlayerStore(),
		nextID:          1,
		mode:            ModeTeam,
		state:           StateWaiting,
		deathmatchVotes: make(map[int]bool),
		mapName:         defaultMapName,
		mapSpawns:       defaultSpawns,
	}
}

type testPlayer struct {
	id     int
	sendCh chan []byte
}

func addNamedPlayer(g *Game, name string) testPlayer {
	id, sendCh, ok := g.addPlayer(nil)
	if !ok {
		panic("expected available player slot")
	}
	idx, _ := g.players.indexOf(id)
	g.players.names[idx] = name
	g.players.inMatch[idx] = true
	return testPlayer{id: id, sendCh: sendCh}
}

func assignPlayerTeam(g *Game, id int, team TeamID) int {
	idx, ok := g.players.indexOf(id)
	if !ok {
		panic("expected player to exist")
	}
	g.players.team[idx] = team
	return idx
}

func readQueuedMessage(t *testing.T, sendCh chan []byte) map[string]any {
	t.Helper()

	select {
	case raw := <-sendCh:
		var msg map[string]any
		if err := json.Unmarshal(raw, &msg); err != nil {
			t.Fatalf("unmarshal message: %v", err)
		}
		return msg
	default:
		t.Fatal("expected queued message")
		return nil
	}
}

func TestBroadcastLobbyIncludesPlayersAndCurrentState(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying

	host := addNamedPlayer(g, "Host")
	guest := addNamedPlayer(g, "Guest")

	g.broadcastLobby()

	for _, sendCh := range []chan []byte{host.sendCh, guest.sendCh} {
		msg := readQueuedMessage(t, sendCh)
		if got := msg["t"]; got != "lobby" {
			t.Fatalf("expected lobby payload, got %#v", got)
		}
		if got := msg["state"]; got != "playing" {
			t.Fatalf("expected playing state, got %#v", got)
		}
		players, ok := msg["players"].([]any)
		if !ok || len(players) != 2 {
			t.Fatalf("expected 2 players, got %#v", msg["players"])
		}
	}
}

func TestRemovePlayerSwapDeleteKeepsRemainingIndexValid(t *testing.T) {
	g := newTestGame()

	first := addNamedPlayer(g, "One")
	second := addNamedPlayer(g, "Two")
	third := addNamedPlayer(g, "Three")

	thirdIdx, _ := g.players.indexOf(third.id)
	g.players.credits[thirdIdx] = 725
	g.players.heavyWeapon[thirdIdx] = WeaponID("ak-47")
	g.players.heavyClip[thirdIdx] = 18
	g.players.heavyReserve[thirdIdx] = 26
	g.players.armor[thirdIdx] = 18

	g.removePlayer(second.id)

	if _, ok := g.players.indexOf(second.id); ok {
		t.Fatalf("expected removed player to disappear")
	}

	idx, ok := g.players.indexOf(third.id)
	if !ok {
		t.Fatal("expected moved player to remain addressable")
	}
	if got := g.players.names[idx]; got != "Three" {
		t.Fatalf("expected moved player name to stay intact, got %q", got)
	}
	if got := g.players.heavyWeapon[idx]; got != WeaponID("ak-47") {
		t.Fatalf("expected moved player heavy weapon to stay intact, got %q", got)
	}
	if got := g.players.heavyClip[idx]; got != 18 {
		t.Fatalf("expected moved player heavy clip to stay intact, got %d", got)
	}
	if got := g.players.heavyReserve[idx]; got != 26 {
		t.Fatalf("expected moved player heavy reserve to stay intact, got %d", got)
	}
	if _, ok := g.players.indexOf(first.id); !ok {
		t.Fatal("expected untouched player to remain addressable")
	}
}

func TestStateTickIncludesServerTime(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying

	host := addNamedPlayer(g, "Host")
	nowMS := int64(1234)
	g.stateTick(nowMS)

	msg := readQueuedMessage(t, host.sendCh)
	if got, ok := msg["serverTime"].(float64); !ok || int64(got) != nowMS {
		t.Fatalf("expected serverTime %d, got %#v", nowMS, msg["serverTime"])
	}
}

func TestBuildMatchStateIncludesSelectedMode(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch

	match := g.buildMatchStateLocked(1000)
	if match.Mode != ModeDeathmatch {
		t.Fatalf("expected mode %q, got %q", ModeDeathmatch, match.Mode)
	}
}

func TestBroadcastChatQueuesSanitizedMessage(t *testing.T) {
	g := newTestGame()

	host := addNamedPlayer(g, "Host")
	guest := addNamedPlayer(g, "Guest")

	g.broadcastChat(host.id, "  hello\n\nteam   ")

	for _, sendCh := range []chan []byte{host.sendCh, guest.sendCh} {
		msg := readQueuedMessage(t, sendCh)
		if got := msg["t"]; got != "chat" {
			t.Fatalf("expected chat payload, got %#v", got)
		}
		if got := msg["name"]; got != "Host" {
			t.Fatalf("expected sender Host, got %#v", got)
		}
		if got := msg["text"]; got != "hello team" {
			t.Fatalf("expected sanitized text, got %#v", got)
		}
	}
}

func TestSanitizeChatTextTrimsWhitespaceAndLimitsRunes(t *testing.T) {
	input := " \n   alpha\tbeta  " + strings.Repeat("x", maxChatMessageRunes+10)
	got := sanitizeChatText(input)

	if len([]rune(got)) != maxChatMessageRunes {
		t.Fatalf("expected chat text length %d, got %d", maxChatMessageRunes, len([]rune(got)))
	}
	if got[:10] != "alpha beta" {
		t.Fatalf("expected sanitized prefix alpha beta, got %q", got[:10])
	}
}

func TestTracePlayerHitUsesWeaponDamageTables(t *testing.T) {
	origin := Vec3{0, 1.7, 5}
	target := Vec3{0, 1.7, 0}

	headAim := normalizeVec(Vec3{0, -0.28, -5})
	zone, dist, ok := tracePlayerHit(origin, headAim, target, false, hitscanRange)
	if !ok || zone != HitZoneHead || dist <= 0 {
		t.Fatalf("expected a headshot, got zone=%q dist=%f ok=%v", zone, dist, ok)
	}
	if dmg := damageForWeapon(WeaponID("ak-47"), zone); dmg != weaponConfigByID(WeaponID("ak-47")).HeadDamage {
		t.Fatalf("expected AK-47 head damage %d, got %d", weaponConfigByID(WeaponID("ak-47")).HeadDamage, dmg)
	}

	bodyAim := normalizeVec(Vec3{0, -0.35, -5})
	zone, _, ok = tracePlayerHit(Vec3{0, 1.1, 5}, bodyAim, target, false, hitscanRange)
	if !ok || zone != HitZoneBody {
		t.Fatalf("expected a bodyshot, got zone=%q ok=%v", zone, ok)
	}
	if dmg := damageForWeapon(WeaponID("p2000"), zone); dmg != weaponConfigByID(WeaponID("p2000")).BodyDamage {
		t.Fatalf("expected P2000 body damage %d, got %d", weaponConfigByID(WeaponID("p2000")).BodyDamage, dmg)
	}
}

func TestWeaponConfigsUseDistinctRecoilTablesPerGun(t *testing.T) {
	ak := weaponConfigByID(WeaponID("ak-47"))
	p90 := weaponConfigByID(WeaponID("p90"))
	awp := weaponConfigByID(WeaponID("awp"))

	if len(ak.RecoilTable) == 0 || len(p90.RecoilTable) == 0 || len(awp.RecoilTable) == 0 {
		t.Fatal("expected firearm recoil tables to be populated")
	}
	if reflect.DeepEqual(ak.RecoilTable, p90.RecoilTable) {
		t.Fatal("expected AK-47 and P90 recoil tables to differ")
	}
	if reflect.DeepEqual(ak.RecoilTable, awp.RecoilTable) {
		t.Fatal("expected AK-47 and AWP recoil tables to differ")
	}
	if ak.BodyDamage == p90.BodyDamage {
		t.Fatal("expected AK-47 and P90 damage values to differ")
	}
}

func TestApplyPurchaseLockedUsesSlotWeaponsAndSideRestrictions(t *testing.T) {
	g := newTestGame()
	player := addNamedPlayer(g, "Buyer")
	idx := assignPlayerTeam(g, player.id, TeamGreen)
	g.state = StatePlaying
	g.buyEndsAt = 5000
	nowMS := int64(1000)
	g.players.credits[idx] = 5000

	update := g.applyPurchaseLocked(idx, "ak-47", nowMS)
	if !update.OK {
		t.Fatalf("expected AK-47 purchase to succeed, got reason %q", update.Reason)
	}
	if got := g.players.heavyWeapon[idx]; got != WeaponID("ak-47") {
		t.Fatalf("expected heavy weapon ak-47, got %q", got)
	}
	if got := g.players.heavyClip[idx]; got != weaponClipSize(WeaponID("ak-47")) {
		t.Fatalf("expected heavy clip %d, got %d", weaponClipSize(WeaponID("ak-47")), got)
	}

	update = g.applyPurchaseLocked(idx, "m4a4", nowMS)
	if update.OK {
		t.Fatal("expected CT-only weapon purchase to fail for T side")
	}
	if update.Reason == "" {
		t.Fatal("expected a rejection reason for wrong-side purchase")
	}
}

func TestApplyPurchaseLockedStocksUtilitiesAndArmor(t *testing.T) {
	g := newTestGame()
	player := addNamedPlayer(g, "Buyer")
	idx := assignPlayerTeam(g, player.id, TeamBlue)
	g.state = StatePlaying
	g.buyEndsAt = 5000
	nowMS := int64(1000)
	g.players.credits[idx] = 5000

	if update := g.applyPurchaseLocked(idx, "flashbang", nowMS); !update.OK {
		t.Fatalf("expected flashbang purchase to succeed, got reason %q", update.Reason)
	}
	if got := g.players.flashbangs[idx]; got != 1 {
		t.Fatalf("expected 1 flashbang, got %d", got)
	}
	if update := g.applyPurchaseLocked(idx, "armor", nowMS); !update.OK {
		t.Fatalf("expected armor purchase to succeed, got reason %q", update.Reason)
	}
	if got := g.players.armor[idx]; got != maxArmor {
		t.Fatalf("expected armor %d, got %d", maxArmor, got)
	}
}

func TestResetPlayerForNewMatchLockedGivesDefaultPistolAndStartingCredits(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	green := addNamedPlayer(g, "Green")
	blueIdx := assignPlayerTeam(g, blue.id, TeamBlue)
	greenIdx := assignPlayerTeam(g, green.id, TeamGreen)

	g.resetPlayerForNewMatchLocked(blueIdx, 1000)
	g.resetPlayerForNewMatchLocked(greenIdx, 1000)

	if got := g.players.credits[blueIdx]; got != startingCredits {
		t.Fatalf("expected starting credits %d, got %d", startingCredits, got)
	}
	if got := g.players.pistolWeapon[blueIdx]; got != WeaponID("p2000") {
		t.Fatalf("expected CT default pistol p2000, got %q", got)
	}
	if got := g.players.pistolWeapon[greenIdx]; got != WeaponID("glock-18") {
		t.Fatalf("expected T default pistol glock-18, got %q", got)
	}
	if got := g.players.activeWeapon[blueIdx]; got != WeaponID("p2000") {
		t.Fatalf("expected active weapon p2000, got %q", got)
	}
}

func TestRespawnPlayerLockedDeathmatchGivesDefaultHeavyAndFullAmmo(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	g.state = StatePlaying

	green := addNamedPlayer(g, "Green")
	idx := assignPlayerTeam(g, green.id, TeamGreen)

	g.resetPlayerForNewMatchLocked(idx, 1000)
	g.players.heavyWeapon[idx] = ""
	g.respawnPlayerLocked(idx, 1200)

	if got := g.players.heavyWeapon[idx]; got != WeaponID("ak-47") {
		t.Fatalf("expected T deathmatch heavy ak-47, got %q", got)
	}
	if got := g.players.heavyClip[idx]; got != weaponClipSize(WeaponID("ak-47")) {
		t.Fatalf("expected heavy clip %d, got %d", weaponClipSize(WeaponID("ak-47")), got)
	}
	if got := g.players.heavyReserve[idx]; got != weaponReserveAmmoMax(WeaponID("ak-47")) {
		t.Fatalf("expected heavy reserve %d, got %d", weaponReserveAmmoMax(WeaponID("ak-47")), got)
	}
	if got := g.players.activeWeapon[idx]; got != WeaponID("ak-47") {
		t.Fatalf("expected active weapon ak-47, got %q", got)
	}
}

func TestAwardDeathmatchKillAmmoLockedAddsReserveAmmo(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch

	player := addNamedPlayer(g, "Shooter")
	idx := assignPlayerTeam(g, player.id, TeamBlue)
	g.players.heavyWeapon[idx] = WeaponID("m4a4")
	g.players.heavyClip[idx] = 12
	g.players.heavyReserve[idx] = 40

	if !g.awardDeathmatchKillAmmoLocked(idx, WeaponID("m4a4")) {
		t.Fatal("expected deathmatch ammo reward to apply")
	}
	if got := g.players.heavyReserve[idx]; got != 50 {
		t.Fatalf("expected reserve ammo 50, got %d", got)
	}
}

func TestBeginRoundCooldownLockedAwardsCSStyleEconomy(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	green := addNamedPlayer(g, "Green")
	assignPlayerTeam(g, blue.id, TeamBlue)
	assignPlayerTeam(g, green.id, TeamGreen)

	g.state = StatePlaying
	g.currentRound = 1
	g.resetPlayerForNewMatchLocked(0, 1000)
	g.resetPlayerForNewMatchLocked(1, 1000)
	g.beginRoundCooldownLocked(TeamBlue, 2000)

	if got := g.players.credits[0]; got != startingCredits+roundWinCredits {
		t.Fatalf("expected winner credits %d, got %d", startingCredits+roundWinCredits, got)
	}
	if got := g.players.credits[1]; got != startingCredits+pistolRoundLossBonus {
		t.Fatalf("expected loser credits %d, got %d", startingCredits+pistolRoundLossBonus, got)
	}
}

func TestBuildPlayerStateLockedUsesNewSlotFields(t *testing.T) {
	g := newTestGame()
	player := addNamedPlayer(g, "State")
	idx := assignPlayerTeam(g, player.id, TeamBlue)
	g.players.pistolWeapon[idx] = WeaponID("usp-s")
	g.players.pistolClip[idx] = 7
	g.players.pistolReserve[idx] = 21
	g.players.heavyWeapon[idx] = WeaponID("m4a4")
	g.players.heavyClip[idx] = 30
	g.players.heavyReserve[idx] = 60
	g.players.activeWeapon[idx] = WeaponID("m4a4")

	state := g.buildPlayerStateLocked(idx, 1000)
	if state.PistolWeapon != WeaponID("usp-s") {
		t.Fatalf("expected usp-s pistol, got %q", state.PistolWeapon)
	}
	if state.HeavyWeapon != WeaponID("m4a4") {
		t.Fatalf("expected m4a4 heavy, got %q", state.HeavyWeapon)
	}
	if state.HeavyClip != 30 || state.HeavyReserve != 60 {
		t.Fatalf("expected heavy ammo 30/60, got %d/%d", state.HeavyClip, state.HeavyReserve)
	}
	if state.ActiveWeapon != WeaponID("m4a4") {
		t.Fatalf("expected active weapon m4a4, got %q", state.ActiveWeapon)
	}
}

func TestStripLoadoutOnDeathLockedClearsHeavyAndKeepsDefaultPistol(t *testing.T) {
	g := newTestGame()
	player := addNamedPlayer(g, "Victim")
	idx := assignPlayerTeam(g, player.id, TeamBlue)
	g.players.pistolWeapon[idx] = WeaponID("usp-s")
	g.players.pistolClip[idx] = 3
	g.players.pistolReserve[idx] = 10
	g.players.heavyWeapon[idx] = WeaponID("m4a4")
	g.players.heavyClip[idx] = 22
	g.players.heavyReserve[idx] = 60
	g.players.activeWeapon[idx] = WeaponID("m4a4")

	g.stripLoadoutOnDeathLocked(idx)

	if got := g.players.pistolWeapon[idx]; got != WeaponID("p2000") {
		t.Fatalf("expected default CT pistol p2000 after death, got %q", got)
	}
	if got := g.players.heavyWeapon[idx]; got != "" {
		t.Fatalf("expected heavy weapon cleared on death, got %q", got)
	}
	if g.players.heavyClip[idx] != 0 || g.players.heavyReserve[idx] != 0 {
		t.Fatalf("expected heavy ammo cleared on death, got %d/%d", g.players.heavyClip[idx], g.players.heavyReserve[idx])
	}
	if got := g.players.activeWeapon[idx]; got != WeaponID("p2000") {
		t.Fatalf("expected active weapon p2000 after death, got %q", got)
	}
}
