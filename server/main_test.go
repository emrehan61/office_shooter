package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	return testPlayer{id: id, sendCh: sendCh}
}

func assignPlayerTeam(g *Game, id int, team TeamID) {
	idx, ok := g.players.indexOf(id)
	if !ok {
		panic("expected player to exist")
	}
	g.players.team[idx] = team
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

func TestLobbyManagerCreatesPublicAndPrivateLobbies(t *testing.T) {
	manager := newLobbyManager()

	publicLobby := manager.createLobby("Office", false)
	privateLobby := manager.createLobby("Scrim", true)

	if publicLobby == nil {
		t.Fatal("expected public lobby")
	}
	if privateLobby == nil {
		t.Fatal("expected private lobby")
	}
	if publicLobby.Private {
		t.Fatal("expected first lobby to be public")
	}
	if !privateLobby.Private {
		t.Fatal("expected second lobby to be private")
	}
	if privateLobby.JoinKey == "" {
		t.Fatal("expected private lobby to have a join key")
	}

	public := manager.listPublicLobbies()
	if len(public) != 1 {
		t.Fatalf("expected 1 public lobby, got %d", len(public))
	}
	if public[0].ID != publicLobby.ID {
		t.Fatalf("expected public lobby id %q, got %q", publicLobby.ID, public[0].ID)
	}

	resolved, ok := manager.findLobbyByKey(privateLobby.JoinKey)
	if !ok {
		t.Fatal("expected join key lookup to succeed")
	}
	if resolved.ID != privateLobby.ID {
		t.Fatalf("expected resolved lobby %q, got %q", privateLobby.ID, resolved.ID)
	}
}

func TestNewGameLoadsDefaultMapObjectives(t *testing.T) {
	g := newGame()

	if g.mapName != defaultMapName {
		t.Fatalf("expected default map %q, got %q", defaultMapName, g.mapName)
	}
	if len(g.mapHostages) == 0 {
		t.Fatal("expected default map hostages to load")
	}
	if len(g.mapRescueZones) == 0 {
		t.Fatal("expected default map rescue zones to load")
	}
	if len(g.mapFlagBases) == 0 {
		t.Fatal("expected default map flag bases to load")
	}
	if len(g.mapBlueSpawns) == 0 || len(g.mapGreenSpawns) == 0 {
		t.Fatal("expected default map team spawns to load")
	}
}

func TestSpawnPointsForTeamUsesExplicitTeamSpawns(t *testing.T) {
	g := newTestGame()
	g.mapSpawns = []Vec3{{-1, standEyeHeight, 0}, {1, standEyeHeight, 0}, {0, standEyeHeight, 5}}
	g.mapBlueSpawns = []Vec3{{-10, standEyeHeight, -10}}
	g.mapGreenSpawns = []Vec3{{10, standEyeHeight, 10}}

	blue := g.spawnPointsForTeamLocked(TeamBlue)
	green := g.spawnPointsForTeamLocked(TeamGreen)

	if len(blue) != 1 || blue[0][0] != -10 || blue[0][2] != -10 {
		t.Fatalf("expected explicit blue spawns, got %#v", blue)
	}
	if len(green) != 1 || green[0][0] != 10 || green[0][2] != 10 {
		t.Fatalf("expected explicit green spawns, got %#v", green)
	}
}

func TestLeaveMatchLeavesTeamPlayersInLobby(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	green := addNamedPlayer(g, "Green")

	assignPlayerTeam(g, blue.id, TeamBlue)
	assignPlayerTeam(g, green.id, TeamGreen)
	g.setAllNamedPlayersInMatchLocked(true)
	g.startMatchLocked(1000)

	blueIdx, ok := g.players.indexOf(blue.id)
	if !ok {
		t.Fatal("expected blue player")
	}

	if !g.leaveMatchLocked(blue.id) {
		t.Fatal("expected leave match to succeed")
	}
	if g.players.inMatch[blueIdx] {
		t.Fatal("expected player to leave the current match")
	}
	if g.players.alive[blueIdx] {
		t.Fatal("expected player to stop being alive after leaving")
	}
	if g.state != StatePlaying {
		t.Fatal("expected match to stay active for other players")
	}
}

func TestBroadcastLobbyIncludesPlayersAndCurrentState(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying

	host := addNamedPlayer(g, "Host")
	guest := addNamedPlayer(g, "Guest")

	g.broadcastLobby()

	hostMsg := readQueuedMessage(t, host.sendCh)
	guestMsg := readQueuedMessage(t, guest.sendCh)

	for _, msg := range []map[string]any{hostMsg, guestMsg} {
		if got, _ := msg["t"].(string); got != "lobby" {
			t.Fatalf("expected lobby message, got %#v", msg["t"])
		}
		if got, _ := msg["state"].(string); got != "playing" {
			t.Fatalf("expected lobby state playing, got %#v", msg["state"])
		}
		players, ok := msg["players"].([]any)
		if !ok {
			t.Fatalf("expected players array, got %#v", msg["players"])
		}
		if len(players) != 2 {
			t.Fatalf("expected 2 lobby players, got %d", len(players))
		}
	}
}

func TestRemovePlayerResetsToWaitingWhenLastPlayerLeaves(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying

	host := addNamedPlayer(g, "Host")
	guest := addNamedPlayer(g, "Guest")

	g.removePlayer(host.id)
	if g.state != StatePlaying {
		t.Fatalf("expected state to stay playing while players remain, got %v", g.state)
	}

	g.removePlayer(guest.id)
	if g.state != StateWaiting {
		t.Fatalf("expected state waiting after last player leaves, got %v", g.state)
	}
}

func TestRemovePlayerSwapDeleteKeepsRemainingIndexValid(t *testing.T) {
	g := newTestGame()

	first := addNamedPlayer(g, "One")
	second := addNamedPlayer(g, "Two")
	third := addNamedPlayer(g, "Three")

	thirdIdx, _ := g.players.indexOf(third.id)
	g.players.credits[thirdIdx] = 725
	g.players.hasMG[thirdIdx] = true
	g.players.mgClip[thirdIdx] = 18
	g.players.mgReserve[thirdIdx] = 26
	g.players.armor[thirdIdx] = 18

	g.removePlayer(second.id)

	if _, ok := g.players.indexOf(second.id); ok {
		t.Fatalf("expected removed player index to disappear")
	}

	idx, ok := g.players.indexOf(third.id)
	if !ok {
		t.Fatalf("expected moved player to remain addressable")
	}
	if got := g.players.names[idx]; got != "Three" {
		t.Fatalf("expected moved player name to stay intact, got %q", got)
	}
	if got := g.players.credits[idx]; got != 725 {
		t.Fatalf("expected moved player credits to stay intact, got %d", got)
	}
	if got := g.players.mgClip[idx]; got != 18 {
		t.Fatalf("expected moved player mg clip to stay intact, got %d", got)
	}
	if got := g.players.mgReserve[idx]; got != 26 {
		t.Fatalf("expected moved player mg reserve to stay intact, got %d", got)
	}
	if got := g.players.armor[idx]; got != 18 {
		t.Fatalf("expected moved player armor to stay intact, got %d", got)
	}

	if _, ok := g.players.indexOf(first.id); !ok {
		t.Fatalf("expected untouched player to remain addressable")
	}
}

func TestStateTickIncludesServerTime(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying

	host := addNamedPlayer(g, "Host")
	nowMS := int64(1234)

	g.stateTick(nowMS)

	msg := readQueuedMessage(t, host.sendCh)
	got, ok := msg["serverTime"].(float64)
	if !ok {
		t.Fatalf("expected serverTime number, got %#v", msg["serverTime"])
	}
	if int64(got) != nowMS {
		t.Fatalf("expected serverTime %d, got %d", nowMS, int64(got))
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

func TestBroadcastChatQueuesSanitizedMessageToConnectedPlayers(t *testing.T) {
	g := newTestGame()

	host := addNamedPlayer(g, "Host")
	guest := addNamedPlayer(g, "Guest")

	g.broadcastChat(host.id, "  hello\n\nteam   ")

	hostMsg := readQueuedMessage(t, host.sendCh)
	guestMsg := readQueuedMessage(t, guest.sendCh)

	for _, msg := range []map[string]any{hostMsg, guestMsg} {
		if got, _ := msg["t"].(string); got != "chat" {
			t.Fatalf("expected chat message, got %#v", msg["t"])
		}
		if got, _ := msg["name"].(string); got != "Host" {
			t.Fatalf("expected sender name Host, got %#v", msg["name"])
		}
		if got, _ := msg["text"].(string); got != "hello team" {
			t.Fatalf("expected sanitized chat text, got %#v", msg["text"])
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

func TestTracePlayerHitHeadshotWinsAndUsesHeadDamage(t *testing.T) {
	origin := Vec3{0, 1.7, 5}
	target := Vec3{0, 1.7, 0}
	headAim := normalize(Vec3{0, -0.28, -5})

	zone, dist, ok := tracePlayerHit(origin, headAim, target, false, hitscanRange)
	if !ok {
		t.Fatal("expected headshot hit")
	}
	if zone != HitZoneHead {
		t.Fatalf("expected head zone, got %q", zone)
	}
	if dist <= 0 {
		t.Fatalf("expected positive distance, got %f", dist)
	}
	if dmg := damageForWeapon(WeaponMachineGun, zone); dmg != 32 {
		t.Fatalf("expected machine gun head damage 32, got %d", dmg)
	}
}

func TestTracePlayerHitBodyshotUsesBodyDamage(t *testing.T) {
	origin := Vec3{0, 1.1, 5}
	target := Vec3{0, 1.7, 0}
	bodyAim := normalize(Vec3{0, -0.35, -5})

	zone, _, ok := tracePlayerHit(origin, bodyAim, target, false, hitscanRange)
	if !ok {
		t.Fatal("expected bodyshot hit")
	}
	if zone != HitZoneBody {
		t.Fatalf("expected body zone, got %q", zone)
	}
	if dmg := damageForWeapon(WeaponPistol, zone); dmg != 34 {
		t.Fatalf("expected pistol body damage 34, got %d", dmg)
	}
}

func TestTracePlayerHitMissesOutsideHitboxes(t *testing.T) {
	origin := Vec3{4, 1.7, 5}
	target := Vec3{0, 1.7, 0}
	missAim := normalize(Vec3{0, 0, -1})

	if _, _, ok := tracePlayerHit(origin, missAim, target, false, hitscanRange); ok {
		t.Fatal("expected miss")
	}
}

func TestTracePlayerHitLevelShotAtStandingTargetHits(t *testing.T) {
	origin := Vec3{0, 1.7, 5}
	target := Vec3{0, 1.7, 0}
	levelAim := normalize(Vec3{0, 0, -1})

	zone, _, ok := tracePlayerHit(origin, levelAim, target, false, hitscanRange)
	if !ok {
		t.Fatal("expected level shot to hit standing target")
	}
	if zone != HitZoneHead {
		t.Fatalf("expected level shot to land on head zone, got %q", zone)
	}
}

func TestApplyShotSpreadAimingReducesDeflection(t *testing.T) {
	baseDir := normalize(Vec3{0.03, -0.01, -1})
	config := weaponConfigByID(WeaponMachineGun)

	hipDir := applyShotSpread(baseDir, config, false, false, false, 0.012, 42)
	adsDir := applyShotSpread(baseDir, config, true, false, false, 0.012, 42)

	hipDot := math.Max(-1, math.Min(1, dotVec3(baseDir, hipDir)))
	adsDot := math.Max(-1, math.Min(1, dotVec3(baseDir, adsDir)))
	hipAngle := math.Acos(hipDot)
	adsAngle := math.Acos(adsDot)

	if !(adsAngle < hipAngle) {
		t.Fatalf("expected aiming spread %f to be tighter than hip spread %f", adsAngle, hipAngle)
	}
}

func TestApplyShotSpreadCrouchingReducesDeflection(t *testing.T) {
	baseDir := normalize(Vec3{0.02, 0.01, -1})
	config := weaponConfigByID(WeaponPistol)

	standingDir := applyShotSpread(baseDir, config, false, false, false, 0.01, 77)
	crouchingDir := applyShotSpread(baseDir, config, false, true, false, 0.01, 77)

	standingDot := math.Max(-1, math.Min(1, dotVec3(baseDir, standingDir)))
	crouchingDot := math.Max(-1, math.Min(1, dotVec3(baseDir, crouchingDir)))
	standingAngle := math.Acos(standingDot)
	crouchingAngle := math.Acos(crouchingDot)

	if !(crouchingAngle < standingAngle) {
		t.Fatalf("expected crouching spread %f to be tighter than standing spread %f", crouchingAngle, standingAngle)
	}
}

func TestApplyShotSpreadMovingIncreasesDeflection(t *testing.T) {
	baseDir := normalize(Vec3{0.01, -0.02, -1})
	config := weaponConfigByID(WeaponMachineGun)

	standingDir := applyShotSpread(baseDir, config, false, false, false, 0.01, 99)
	movingDir := applyShotSpread(baseDir, config, false, false, true, 0.01, 99)

	standingDot := math.Max(-1, math.Min(1, dotVec3(baseDir, standingDir)))
	movingDot := math.Max(-1, math.Min(1, dotVec3(baseDir, movingDir)))
	standingAngle := math.Acos(standingDot)
	movingAngle := math.Acos(movingDot)

	if !(movingAngle > standingAngle) {
		t.Fatalf("expected moving spread %f to be wider than standing spread %f", movingAngle, standingAngle)
	}
}

func TestCanStartMatchLockedRequiresBalancedAssignedTeams(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	green := addNamedPlayer(g, "Green")

	if ok, reason := g.canStartMatchLocked(); ok || reason != "All players must join a team" {
		t.Fatalf("expected unassigned-team failure, got ok=%v reason=%q", ok, reason)
	}

	assignPlayerTeam(g, blue.id, TeamBlue)
	assignPlayerTeam(g, green.id, TeamBlue)
	if ok, reason := g.canStartMatchLocked(); ok || reason != "Both teams need players" {
		t.Fatalf("expected both-teams failure, got ok=%v reason=%q", ok, reason)
	}

	assignPlayerTeam(g, green.id, TeamGreen)
	if ok, reason := g.canStartMatchLocked(); !ok || reason != "" {
		t.Fatalf("expected balanced teams to start, got ok=%v reason=%q", ok, reason)
	}
}

func TestCanStartDeathmatchLockedAllowsSingleHumanWithBot(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	host := addNamedPlayer(g, "Host")
	hostIdx, _ := g.players.indexOf(host.id)
	g.players.inMatch[hostIdx] = true

	g.syncModeBotsLocked(1000)

	if ok, reason := g.canStartMatchLocked(); !ok || reason != "" {
		t.Fatalf("expected solo deathmatch start to succeed, got ok=%v reason=%q", ok, reason)
	}

	botCount := 0
	for i := range g.players.ids {
		if g.players.isBot[i] {
			botCount++
		}
	}
	if botCount != 1 {
		t.Fatalf("expected 1 deathmatch bot, got %d", botCount)
	}
}

func TestFindHitTargetLockedAllowsSameTeamTargetsInDeathmatch(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	shooter := addNamedPlayer(g, "Shooter")
	target := addNamedPlayer(g, "Target")

	shooterIdx, _ := g.players.indexOf(shooter.id)
	targetIdx, _ := g.players.indexOf(target.id)
	g.players.inMatch[shooterIdx] = true
	g.players.inMatch[targetIdx] = true
	g.players.team[shooterIdx] = TeamBlue
	g.players.team[targetIdx] = TeamBlue
	g.players.pos[shooterIdx] = Vec3{0, standEyeHeight, 5}
	g.players.pos[targetIdx] = Vec3{0, standEyeHeight, 0}
	recordPositionSample(&g.players.history[shooterIdx], 1000, g.players.pos[shooterIdx], false)
	recordPositionSample(&g.players.history[targetIdx], 1000, g.players.pos[targetIdx], false)

	hit := g.findHitTargetLocked(shooter.id, g.players.pos[shooterIdx], normalizeVec(Vec3{0, 0, -1}), 1000, hitscanRange)
	if hit == nil || hit.id != target.id {
		t.Fatalf("expected same-team deathmatch target %d, got %#v", target.id, hit)
	}
}

func TestTickStartsDeathmatchVoteWindowWhenTimerExpires(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	host := addNamedPlayer(g, "Host")
	hostIdx, _ := g.players.indexOf(host.id)
	g.players.inMatch[hostIdx] = true
	g.state = StatePlaying
	g.currentRound = 1
	g.roundEndsAt = 1000

	g.tick(1001)

	if g.deathmatchVoteEnds != 11001 {
		t.Fatalf("expected vote deadline 11001, got %d", g.deathmatchVoteEnds)
	}
}

func TestResolveDeathmatchVoteRestartsWithAcceptedPlayersOnly(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	host := addNamedPlayer(g, "Host")
	guest := addNamedPlayer(g, "Guest")
	hostIdx, _ := g.players.indexOf(host.id)
	guestIdx, _ := g.players.indexOf(guest.id)
	g.players.inMatch[hostIdx] = true
	g.players.inMatch[guestIdx] = true

	g.startDeathmatchVoteLocked(1000)
	g.deathmatchVotes[host.id] = true

	if restarted := g.resolveDeathmatchVoteLocked(11000); !restarted {
		t.Fatal("expected one yes vote to restart deathmatch")
	}

	if g.state != StatePlaying {
		t.Fatalf("expected restarted match state playing, got %v", g.state)
	}
	if !g.players.inMatch[hostIdx] {
		t.Fatal("expected accepted player to rejoin the next deathmatch")
	}
	if g.players.inMatch[guestIdx] {
		t.Fatal("expected non-voter to stay in the lobby")
	}
	if g.roundEndsAt != 11000+deathmatchDurationMS {
		t.Fatalf("expected deathmatch duration to reset, got %d", g.roundEndsAt)
	}

	botCount := 0
	for i := range g.players.ids {
		if g.players.isBot[i] && g.players.inMatch[i] {
			botCount++
		}
	}
	if botCount != 1 {
		t.Fatalf("expected one active bot after solo restart, got %d", botCount)
	}
}

func TestRespawnPlayerLockedGivesDeathmatchLoadoutAndTimers(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	player := addNamedPlayer(g, "Host")
	idx, _ := g.players.indexOf(player.id)

	g.respawnPlayerLocked(idx, 1000)

	if !g.players.hasPistol[idx] || !g.players.hasMG[idx] {
		t.Fatalf("expected deathmatch spawn to own both guns")
	}
	if g.players.pistolClip[idx] != pistolMagSize || g.players.pistolReserve[idx] != pistolAmmoMax {
		t.Fatalf("expected pistol ammo %d/%d, got %d/%d", pistolMagSize, pistolAmmoMax, g.players.pistolClip[idx], g.players.pistolReserve[idx])
	}
	if g.players.mgClip[idx] != machineGunMagSize || g.players.mgReserve[idx] != machineGunAmmoMax {
		t.Fatalf("expected machine gun ammo %d/%d, got %d/%d", machineGunMagSize, machineGunAmmoMax, g.players.mgClip[idx], g.players.mgReserve[idx])
	}
	if g.players.activeWeapon[idx] != WeaponMachineGun {
		t.Fatalf("expected deathmatch spawn to select machine gun, got %q", g.players.activeWeapon[idx])
	}
	if g.spawnProtectionTimeLeftLocked(idx, 1000) != deathmatchSpawnProtectionMS {
		t.Fatalf("expected spawn protection %d, got %d", deathmatchSpawnProtectionMS, g.spawnProtectionTimeLeftLocked(idx, 1000))
	}
	if g.loadoutTimeLeftLocked(idx, 1000) != deathmatchLoadoutWindowMS {
		t.Fatalf("expected loadout window %d, got %d", deathmatchLoadoutWindowMS, g.loadoutTimeLeftLocked(idx, 1000))
	}
}

func TestApplyPurchaseLockedAllowsFreeDeathmatchLoadout(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	player := addNamedPlayer(g, "Host")
	idx, _ := g.players.indexOf(player.id)
	g.state = StatePlaying
	g.players.credits[idx] = 0
	g.players.inMatch[idx] = true
	g.players.alive[idx] = true
	g.players.loadoutEndsAt[idx] = 5000

	update := g.applyPurchaseLocked(idx, "armor", 1000)

	if !update.OK {
		t.Fatalf("expected free deathmatch armor purchase, got %#v", update)
	}
	if g.players.credits[idx] != 0 {
		t.Fatalf("expected credits to stay 0 during free loadout, got %d", g.players.credits[idx])
	}
	if g.players.armor[idx] != armorPlateAmount {
		t.Fatalf("expected armor %d, got %d", armorPlateAmount, g.players.armor[idx])
	}
}

func TestAwardDeathmatchKillAmmoLockedAddsReserveAmmo(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	player := addNamedPlayer(g, "Host")
	idx, _ := g.players.indexOf(player.id)
	g.players.hasPistol[idx] = true
	g.players.pistolClip[idx] = 1
	g.players.pistolReserve[idx] = 5

	if !g.awardDeathmatchKillAmmoLocked(idx, WeaponPistol) {
		t.Fatal("expected deathmatch pistol kill reward ammo to be granted")
	}
	if g.players.pistolReserve[idx] != 15 {
		t.Fatalf("expected reserve ammo 15, got %d", g.players.pistolReserve[idx])
	}
}

func TestSyncFallbackBotAddsBotForEmptyTeam(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.syncFallbackBotLocked(1000)

	if len(g.players.ids) != 2 {
		t.Fatalf("expected 2 occupants after bot sync, got %d", len(g.players.ids))
	}

	foundBot := false
	for i := range g.players.ids {
		if g.players.isBot[i] && g.players.team[i] == TeamGreen {
			foundBot = true
		}
	}
	if !foundBot {
		t.Fatal("expected fallback bot on green team")
	}
}

func TestCanStartMatchLockedAllowsOneHumanVersusBot(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.syncFallbackBotLocked(1000)

	if ok, reason := g.canStartMatchLocked(); !ok || reason != "" {
		t.Fatalf("expected bot-backed roster to start, got ok=%v reason=%q", ok, reason)
	}
}

func TestSyncFallbackBotRemovesBotWhenHumanJoinsThatTeam(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	green := addNamedPlayer(g, "Green")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.syncFallbackBotLocked(1000)
	assignPlayerTeam(g, green.id, TeamGreen)
	g.syncFallbackBotLocked(1001)

	for i := range g.players.ids {
		if g.players.isBot[i] {
			t.Fatal("expected bot to be removed once green human joins")
		}
	}
}

func TestTickFallbackBotFiresAtNearestEnemy(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.syncFallbackBotLocked(1000)

	playerIdx, _ := g.players.indexOf(blue.id)
	botIdx := -1
	for i := range g.players.ids {
		if g.players.isBot[i] {
			botIdx = i
			break
		}
	}
	if botIdx < 0 {
		t.Fatal("expected fallback bot to exist")
	}

	g.state = StatePlaying
	g.currentRound = 1
	g.buyEndsAt = 0
	g.players.pos[playerIdx] = Vec3{-2, standEyeHeight, 0}
	g.players.pos[botIdx] = Vec3{2, standEyeHeight, 0}
	g.players.botNextThink[botIdx] = 0
	recordPositionSample(&g.players.history[playerIdx], 1000, g.players.pos[playerIdx], false)
	recordPositionSample(&g.players.history[botIdx], 1000, g.players.pos[botIdx], false)

	g.tick(1100)

	msg := readQueuedMessage(t, blue.sendCh)
	if got, _ := msg["t"].(string); got != "shot" {
		t.Fatalf("expected bot shot broadcast, got %#v", msg["t"])
	}
	if got, _ := msg["id"].(float64); int(got) != g.players.ids[botIdx] {
		t.Fatalf("expected shot from bot id %d, got %#v", g.players.ids[botIdx], msg["id"])
	}
}

func TestBotShotQualityIsAccurateOneInFiveShots(t *testing.T) {
	accurate := 0
	for i := int64(0); i < 10; i++ {
		if isAccurateBotShot(i) {
			accurate++
		}
	}

	if accurate != 2 {
		t.Fatalf("expected 2 accurate shots in 10 attempts, got %d", accurate)
	}
}

func TestTickFallbackBotMovesTowardNearestEnemyWhenFar(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	assignPlayerTeam(g, blue.id, TeamBlue)
	g.syncFallbackBotLocked(1000)

	playerIdx, _ := g.players.indexOf(blue.id)
	botIdx := -1
	for i := range g.players.ids {
		if g.players.isBot[i] {
			botIdx = i
			break
		}
	}
	if botIdx < 0 {
		t.Fatal("expected fallback bot")
	}

	g.state = StatePlaying
	g.currentRound = 1
	g.buyEndsAt = 0
	g.players.pos[playerIdx] = Vec3{-12, standEyeHeight, 0}
	g.players.pos[botIdx] = Vec3{12, standEyeHeight, 0}
	g.players.botNextThink[botIdx] = 999999
	recordPositionSample(&g.players.history[playerIdx], 1000, g.players.pos[playerIdx], false)
	recordPositionSample(&g.players.history[botIdx], 1000, g.players.pos[botIdx], false)

	before := g.players.pos[botIdx]
	g.tick(1100)
	after := g.players.pos[botIdx]

	if !(after[0] < before[0]) {
		t.Fatalf("expected bot to move toward enemy on x axis, before=%v after=%v", before, after)
	}
}

func TestTickFallbackBotStrafesWhenEnemyIsClose(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	assignPlayerTeam(g, blue.id, TeamBlue)
	g.syncFallbackBotLocked(1000)

	playerIdx, _ := g.players.indexOf(blue.id)
	botIdx := -1
	for i := range g.players.ids {
		if g.players.isBot[i] {
			botIdx = i
			break
		}
	}
	if botIdx < 0 {
		t.Fatal("expected fallback bot")
	}

	g.state = StatePlaying
	g.currentRound = 1
	g.buyEndsAt = 0
	g.players.pos[playerIdx] = Vec3{-2, standEyeHeight, 0}
	g.players.pos[botIdx] = Vec3{2, standEyeHeight, 0}
	g.players.botNextThink[botIdx] = 999999
	recordPositionSample(&g.players.history[playerIdx], 1000, g.players.pos[playerIdx], false)
	recordPositionSample(&g.players.history[botIdx], 1000, g.players.pos[botIdx], false)

	before := g.players.pos[botIdx]
	g.tick(1100)
	after := g.players.pos[botIdx]

	if after[2] == before[2] {
		t.Fatalf("expected bot to strafe on z axis, before=%v after=%v", before, after)
	}
}

func TestStartMatchGivesStartingPistolAndCredits(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	green := addNamedPlayer(g, "Green")
	assignPlayerTeam(g, blue.id, TeamBlue)
	assignPlayerTeam(g, green.id, TeamGreen)

	g.startMatchLocked(1000)

	for _, id := range []int{blue.id, green.id} {
		idx, _ := g.players.indexOf(id)
		if g.players.credits[idx] != startingCredits {
			t.Fatalf("expected starting credits %d, got %d", startingCredits, g.players.credits[idx])
		}
		if !g.players.hasPistol[idx] {
			t.Fatalf("expected player %d to start with a pistol", id)
		}
		if g.players.hasMG[idx] {
			t.Fatalf("expected player %d to start without a machine gun", id)
		}
		if g.players.pistolClip[idx] != pistolMagSize || g.players.pistolReserve[idx] != 0 {
			t.Fatalf("expected player %d to start with a full pistol and no reserve, got clip=%d reserve=%d", id, g.players.pistolClip[idx], g.players.pistolReserve[idx])
		}
		if g.players.activeWeapon[idx] != WeaponPistol {
			t.Fatalf("expected player %d to start with pistol selected, got %q", id, g.players.activeWeapon[idx])
		}
	}
}

func TestEffectiveWeaponConfigHeavyKnifeDoublesCooldownAndDamage(t *testing.T) {
	normal := effectiveWeaponConfig(WeaponKnife, false)
	heavy := effectiveWeaponConfig(WeaponKnife, true)

	if heavy.FireIntervalMS != normal.FireIntervalMS*2 {
		t.Fatalf("expected heavy knife cooldown %d, got %d", normal.FireIntervalMS*2, heavy.FireIntervalMS)
	}
	if heavy.BodyDamage != normal.BodyDamage*2 {
		t.Fatalf("expected heavy knife body damage %d, got %d", normal.BodyDamage*2, heavy.BodyDamage)
	}
	if heavy.HeadDamage != normal.HeadDamage*2 {
		t.Fatalf("expected heavy knife head damage %d, got %d", normal.HeadDamage*2, heavy.HeadDamage)
	}
}

func TestServerPortDefaultsTo8080(t *testing.T) {
	t.Setenv("PORT", "")
	if got := serverPort(); got != "8080" {
		t.Fatalf("expected default port 8080, got %q", got)
	}
}

func TestServerPortUsesEnvironmentOverride(t *testing.T) {
	t.Setenv("PORT", "8090")
	if got := serverPort(); got != "8090" {
		t.Fatalf("expected override port 8090, got %q", got)
	}
}

func TestPositionAtTimeInterpolatesAcrossHistorySamples(t *testing.T) {
	var rb positionRingBuffer
	rb.add(positionSample{At: 1000, Pos: Vec3{0, 1.7, 0}})
	rb.add(positionSample{At: 1100, Pos: Vec3{10, 1.7, 0}})

	got := positionAtTime(&rb, 1050)
	if math.Abs(got[0]-5) > 1e-6 {
		t.Fatalf("expected interpolated x to be 5, got %f", got[0])
	}
	if math.Abs(got[1]-1.7) > 1e-6 {
		t.Fatalf("expected y to stay 1.7, got %f", got[1])
	}
}

func TestStateTickIncludesKillsDeathsAndEconomy(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying
	g.currentRound = 2
	g.roundEndsAt = 4000
	g.buyEndsAt = 1500

	host := addNamedPlayer(g, "Host")
	guest := addNamedPlayer(g, "Guest")

	hostIdx, _ := g.players.indexOf(host.id)
	guestIdx, _ := g.players.indexOf(guest.id)
	g.players.kills[hostIdx] = 7
	g.players.deaths[hostIdx] = 2
	g.players.armor[hostIdx] = 35
	g.players.credits[hostIdx] = 880
	g.players.hasPistol[hostIdx] = true
	g.players.pistolClip[hostIdx] = 7
	g.players.pistolReserve[hostIdx] = 14
	g.players.activeWeapon[hostIdx] = WeaponPistol
	g.players.reloadWeapon[hostIdx] = WeaponPistol
	g.players.reloadEndsAt[hostIdx] = 2800
	g.players.kills[guestIdx] = 1
	g.players.deaths[guestIdx] = 5
	g.players.armor[guestIdx] = 10
	g.players.credits[guestIdx] = 315
	g.players.hasMG[guestIdx] = true
	g.players.mgClip[guestIdx] = 22
	g.players.mgReserve[guestIdx] = 18
	g.players.activeWeapon[guestIdx] = WeaponMachineGun
	g.projectiles = []projectileState{{
		ID:         4,
		Type:       WeaponBomb,
		OwnerID:    host.id,
		Pos:        Vec3{1, 1.2, -2},
		Vel:        Vec3{0, 0, 0},
		DetonateAt: 2500,
	}}
	g.effects = []areaEffectState{{
		Type:      "smoke",
		Pos:       Vec3{-3, 0.12, 6},
		Radius:    smokeRadius,
		ExpiresAt: 7000,
	}}

	g.stateTick(1000)

	msg := readQueuedMessage(t, host.sendCh)
	players, ok := msg["players"].(map[string]any)
	if !ok {
		t.Fatalf("expected players object, got %#v", msg["players"])
	}

	hostState, ok := players[fmt.Sprintf("%d", host.id)].(map[string]any)
	if !ok {
		t.Fatalf("expected host state, got %#v", players)
	}
	guestState, ok := players[fmt.Sprintf("%d", guest.id)].(map[string]any)
	if !ok {
		t.Fatalf("expected guest state, got %#v", players)
	}

	if got := int(hostState["kills"].(float64)); got != 7 {
		t.Fatalf("expected host kills 7, got %d", got)
	}
	if got := int(hostState["deaths"].(float64)); got != 2 {
		t.Fatalf("expected host deaths 2, got %d", got)
	}
	if got := int(hostState["armor"].(float64)); got != 35 {
		t.Fatalf("expected host armor 35, got %d", got)
	}
	if got := int(hostState["pistolClip"].(float64)); got != 7 {
		t.Fatalf("expected host pistol clip 7, got %d", got)
	}
	if got := int(hostState["pistolReserve"].(float64)); got != 14 {
		t.Fatalf("expected host pistol reserve 14, got %d", got)
	}
	if got := int(hostState["credits"].(float64)); got != 880 {
		t.Fatalf("expected host credits 880, got %d", got)
	}
	if got := hostState["activeWeapon"].(string); got != string(WeaponPistol) {
		t.Fatalf("expected host active weapon pistol, got %q", got)
	}
	if got := hostState["reloading"].(bool); !got {
		t.Fatalf("expected host reload state to be active")
	}
	if got := int(hostState["reloadTimeLeftMs"].(float64)); got != 1800 {
		t.Fatalf("expected host reload time 1800, got %d", got)
	}
	if got := int(guestState["kills"].(float64)); got != 1 {
		t.Fatalf("expected guest kills 1, got %d", got)
	}
	if got := int(guestState["deaths"].(float64)); got != 5 {
		t.Fatalf("expected guest deaths 5, got %d", got)
	}
	if got := int(guestState["armor"].(float64)); got != 10 {
		t.Fatalf("expected guest armor 10, got %d", got)
	}
	if got := int(guestState["machineGunClip"].(float64)); got != 22 {
		t.Fatalf("expected guest machine gun clip 22, got %d", got)
	}
	if got := int(guestState["machineGunReserve"].(float64)); got != 18 {
		t.Fatalf("expected guest machine gun reserve 18, got %d", got)
	}
	if got := int(guestState["credits"].(float64)); got != 315 {
		t.Fatalf("expected guest credits 315, got %d", got)
	}

	match, ok := msg["match"].(map[string]any)
	if !ok {
		t.Fatalf("expected match state, got %#v", msg["match"])
	}
	if got := int(match["currentRound"].(float64)); got != 2 {
		t.Fatalf("expected current round 2, got %d", got)
	}
	if got := bool(match["buyPhase"].(bool)); !got {
		t.Fatalf("expected buy phase to be active")
	}

	projectiles, ok := msg["projectiles"].([]any)
	if !ok || len(projectiles) != 1 {
		t.Fatalf("expected 1 projectile in snapshot, got %#v", msg["projectiles"])
	}
	projectile, ok := projectiles[0].(map[string]any)
	if !ok {
		t.Fatalf("expected projectile object, got %#v", projectiles[0])
	}
	if got := projectile["type"].(string); got != string(WeaponBomb) {
		t.Fatalf("expected bomb projectile, got %q", got)
	}
	effects, ok := msg["effects"].([]any)
	if !ok || len(effects) != 1 {
		t.Fatalf("expected 1 effect in snapshot, got %#v", msg["effects"])
	}
	effect, ok := effects[0].(map[string]any)
	if !ok {
		t.Fatalf("expected effect object, got %#v", effects[0])
	}
	if got := effect["type"].(string); got != "smoke" {
		t.Fatalf("expected smoke effect, got %q", got)
	}
}

func TestApplyDamageUsesArmorBeforeHealth(t *testing.T) {
	hp, armor, absorbed := applyDamage(100, 12, 20)

	if hp != 92 {
		t.Fatalf("expected hp 92, got %d", hp)
	}
	if armor != 0 {
		t.Fatalf("expected armor 0, got %d", armor)
	}
	if absorbed != 12 {
		t.Fatalf("expected absorbed damage 12, got %d", absorbed)
	}
}

func TestApplyPurchaseLockedBuysWeaponsAndArmor(t *testing.T) {
	g := newTestGame()
	player := addNamedPlayer(g, "Host")
	idx, _ := g.players.indexOf(player.id)
	g.state = StatePlaying
	g.buyEndsAt = 1000
	g.players.credits[idx] = 5000

	update := g.applyPurchaseLocked(idx, "buy-machinegun", 100)
	if !update.OK {
		t.Fatalf("expected machine gun purchase to succeed, got %#v", update)
	}
	if !g.players.hasMG[idx] {
		t.Fatalf("expected player to own machine gun")
	}
	if got := g.players.mgClip[idx]; got != machineGunMagSize {
		t.Fatalf("expected machine gun clip %d, got %d", machineGunMagSize, got)
	}
	if got := g.players.mgReserve[idx]; got != machineGunAmmoMax {
		t.Fatalf("expected machine gun reserve %d, got %d", machineGunAmmoMax, got)
	}
	if got := g.players.activeWeapon[idx]; got != WeaponMachineGun {
		t.Fatalf("expected active weapon machine gun, got %q", got)
	}

	g.players.armor[idx] = 90
	g.players.credits[idx] = 500
	update = g.applyPurchaseLocked(idx, "armor", 100)
	if !update.OK {
		t.Fatalf("expected armor purchase to succeed, got %#v", update)
	}
	if got := g.players.armor[idx]; got != 100 {
		t.Fatalf("expected armor capped at 100, got %d", got)
	}

	update = g.applyPurchaseLocked(idx, "buy-machinegun", 100)
	if update.OK {
		t.Fatalf("expected duplicate machine gun purchase to fail")
	}
	if update.Reason != "Machine gun already owned" {
		t.Fatalf("expected duplicate-weapon reason, got %q", update.Reason)
	}

	g.players.credits[idx] = 600
	update = g.applyPurchaseLocked(idx, "flashbang", 100)
	if !update.OK {
		t.Fatalf("expected flashbang purchase to succeed, got %#v", update)
	}
	if got := g.players.flashbangs[idx]; got != 1 {
		t.Fatalf("expected flashbang count 1, got %d", got)
	}
}

func TestReloadWeaponLockedRefillsClipFromReserve(t *testing.T) {
	g := newTestGame()
	player := addNamedPlayer(g, "Host")
	idx, _ := g.players.indexOf(player.id)
	g.players.hasMG[idx] = true
	g.players.mgClip[idx] = 6
	g.players.mgReserve[idx] = 20

	if !g.reloadWeaponLocked(idx, WeaponMachineGun) {
		t.Fatalf("expected reload to succeed")
	}
	if got := g.players.mgClip[idx]; got != 26 {
		t.Fatalf("expected reloaded machine gun clip 26, got %d", got)
	}
	if got := g.players.mgReserve[idx]; got != 0 {
		t.Fatalf("expected reserve depleted to 0, got %d", got)
	}
}

func TestStartReloadLockedCompletesAfterDelay(t *testing.T) {
	g := newTestGame()
	player := addNamedPlayer(g, "Host")
	idx, _ := g.players.indexOf(player.id)
	g.players.hasPistol[idx] = true
	g.players.pistolClip[idx] = 1
	g.players.pistolReserve[idx] = 10

	if !g.startReloadLocked(idx, WeaponPistol, 1000) {
		t.Fatalf("expected reload to start")
	}
	if got := g.players.pistolClip[idx]; got != 1 {
		t.Fatalf("expected clip to stay unchanged during reload start, got %d", got)
	}
	if !g.isReloadingLocked(idx, 1500) {
		t.Fatalf("expected reload to remain active before completion")
	}

	g.updateReloadsAndProjectilesLocked(4000)

	if g.isReloadingLocked(idx, 4000) {
		t.Fatalf("expected reload state to clear after completion")
	}
	if got := g.players.pistolClip[idx]; got != pistolMagSize {
		t.Fatalf("expected pistol clip to fill to %d, got %d", pistolMagSize, got)
	}
	if got := g.players.pistolReserve[idx]; got != 4 {
		t.Fatalf("expected reserve to drop to 4, got %d", got)
	}
}

func TestSpawnProjectileLockedAddsThrowableState(t *testing.T) {
	g := newTestGame()
	player := addNamedPlayer(g, "Host")

	g.spawnProjectileLocked(player.id, WeaponBomb, Vec3{0, 1.7, 0}, normalize(Vec3{0, 0.1, -1}), 1000)

	if len(g.projectiles) != 1 {
		t.Fatalf("expected 1 projectile, got %d", len(g.projectiles))
	}
	if got := g.projectiles[0].Type; got != WeaponBomb {
		t.Fatalf("expected bomb projectile, got %q", got)
	}
	if got := g.projectiles[0].OwnerID; got != player.id {
		t.Fatalf("expected owner %d, got %d", player.id, got)
	}
}

func TestBombDetonationDealsLethalDamageAndRewardsOwner(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying
	owner := addNamedPlayer(g, "Thrower")
	victim := addNamedPlayer(g, "Target")

	ownerIdx, _ := g.players.indexOf(owner.id)
	victimIdx, _ := g.players.indexOf(victim.id)
	g.players.pos[ownerIdx] = Vec3{8, 1.7, 8}
	g.players.pos[victimIdx] = Vec3{0, 1.7, 0}
	g.projectiles = []projectileState{{
		ID:         1,
		Type:       WeaponBomb,
		OwnerID:    owner.id,
		Pos:        Vec3{0, projectileFloorY, 0},
		Vel:        Vec3{0, 0, 0},
		DetonateAt: 1000,
	}}

	events := g.updateReloadsAndProjectilesLocked(2000)

	if g.players.hp[victimIdx] != 0 {
		t.Fatalf("expected victim hp 0, got %d", g.players.hp[victimIdx])
	}
	if g.players.alive[victimIdx] {
		t.Fatalf("expected victim to die from bomb")
	}
	if g.players.kills[ownerIdx] != 1 {
		t.Fatalf("expected owner to gain 1 kill, got %d", g.players.kills[ownerIdx])
	}
	if g.players.credits[ownerIdx] != startingCredits+bodyHitReward+killReward {
		t.Fatalf("expected owner credits %d, got %d", startingCredits+bodyHitReward+killReward, g.players.credits[ownerIdx])
	}
	if len(g.effects) != 1 {
		t.Fatalf("expected one lingering bomb effect, got %d", len(g.effects))
	}
	if got := g.effects[0].Type; got != "bomb" {
		t.Fatalf("expected bomb effect type, got %q", got)
	}
	if got := g.effects[0].Radius; got != bombRadius {
		t.Fatalf("expected bomb effect radius %f, got %f", bombRadius, got)
	}
	if len(events.broadcasts) < 2 {
		t.Fatalf("expected hit and kill broadcasts, got %d", len(events.broadcasts))
	}
	if len(events.directs[owner.id]) != 1 {
		t.Fatalf("expected 1 direct reward update, got %d", len(events.directs[owner.id]))
	}
}

func TestFlashbangDetonationOnlyFlashesPlayersLookingAtIt(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying
	front := addNamedPlayer(g, "Front")
	back := addNamedPlayer(g, "Back")

	frontIdx, _ := g.players.indexOf(front.id)
	backIdx, _ := g.players.indexOf(back.id)
	g.players.pos[frontIdx] = Vec3{0, 1.7, 0}
	g.players.pos[backIdx] = Vec3{1, 1.7, 0}
	g.players.yaw[frontIdx] = 0
	g.players.yaw[backIdx] = math.Pi
	g.projectiles = []projectileState{{
		ID:         2,
		Type:       WeaponFlashbang,
		OwnerID:    front.id,
		Pos:        Vec3{0, 1.7, -4},
		Vel:        Vec3{0, 0, 0},
		DetonateAt: 1000,
	}}

	g.updateReloadsAndProjectilesLocked(2000)

	if g.flashTimeLeftLocked(frontIdx, 2000) != flashbangDurationMS {
		t.Fatalf("expected front player to be flashed for %dms, got %d", flashbangDurationMS, g.flashTimeLeftLocked(frontIdx, 2000))
	}
	if g.flashTimeLeftLocked(backIdx, 2000) != 0 {
		t.Fatalf("expected back player to avoid flash, got %d", g.flashTimeLeftLocked(backIdx, 2000))
	}
}

func TestSmokeDetonationCreatesLingeringSmokeArea(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying
	player := addNamedPlayer(g, "Thrower")
	g.projectiles = []projectileState{{
		ID:         3,
		Type:       WeaponSmoke,
		OwnerID:    player.id,
		Pos:        Vec3{2, projectileFloorY, -3},
		Vel:        Vec3{0, 0, 0},
		DetonateAt: 1000,
	}}

	g.updateReloadsAndProjectilesLocked(2000)

	if len(g.effects) != 1 {
		t.Fatalf("expected one smoke effect, got %d", len(g.effects))
	}
	if got := g.effects[0].Type; got != "smoke" {
		t.Fatalf("expected smoke effect type, got %q", got)
	}
	if got := g.effects[0].Radius; got != smokeRadius {
		t.Fatalf("expected smoke radius %f, got %f", smokeRadius, got)
	}
}

func TestApplyInputLockedBlocksMovementDuringBuyPhase(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying
	g.buyEndsAt = 1000

	player := addNamedPlayer(g, "Host")
	idx, _ := g.players.indexOf(player.id)
	startPos := g.players.pos[idx]
	crouchPos := Vec3{startPos[0], crouchEyeHeight, startPos[2]}

	g.applyInputLocked(idx, Vec3{12, 1.7, -8}, 1.25, -0.5, false, 500)

	if got := g.players.pos[idx]; got != startPos {
		t.Fatalf("expected buy phase to keep position %#v, got %#v", startPos, got)
	}
	if got := g.players.yaw[idx]; got != 1.25 {
		t.Fatalf("expected yaw to keep updating during buy phase, got %f", got)
	}
	if got := g.players.pitch[idx]; got != -0.5 {
		t.Fatalf("expected pitch to keep updating during buy phase, got %f", got)
	}
	if got := g.players.history[idx].count; got != 1 {
		t.Fatalf("expected no new history sample during buy phase, got %d", got)
	}

	g.applyInputLocked(idx, crouchPos, 1.25, -0.5, true, 600)
	if got := g.players.pos[idx][1]; got != crouchEyeHeight {
		t.Fatalf("expected buy phase to allow crouch eye height %f, got %f", crouchEyeHeight, got)
	}
	if !g.players.crouching[idx] {
		t.Fatalf("expected crouch state to update during buy phase")
	}
	if got := g.players.history[idx].count; got != 2 {
		t.Fatalf("expected crouch update to add history sample, got %d", got)
	}

	nextPos := Vec3{12, 1.7, -8}
	g.applyInputLocked(idx, nextPos, 1.25, -0.5, false, 1200)

	if got := g.players.pos[idx]; got != nextPos {
		t.Fatalf("expected live phase to update position %#v, got %#v", nextPos, got)
	}
	if got := g.players.history[idx].count; got != 3 {
		t.Fatalf("expected movement history to resume after buy phase, got %d", got)
	}
}

func TestTickAdvancesRoundsAndPreservesLoadout(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying
	g.currentRound = 1
	g.roundEndsAt = 1000
	g.buyEndsAt = 200

	player := addNamedPlayer(g, "Host")
	idx, _ := g.players.indexOf(player.id)
	g.players.hasPistol[idx] = true
	g.players.pistolClip[idx] = 6
	g.players.pistolReserve[idx] = 13
	g.players.hasMG[idx] = true
	g.players.mgClip[idx] = 12
	g.players.mgReserve[idx] = 44
	g.players.armor[idx] = 42
	g.players.activeWeapon[idx] = WeaponPistol

	g.tick(1200)

	if g.currentRound != 1 {
		t.Fatalf("expected cooldown to keep current round at 1, got %d", g.currentRound)
	}
	if g.intermissionEndsAt != 1200+roundCooldownMS {
		t.Fatalf("expected round cooldown to end at %d, got %d", 1200+roundCooldownMS, g.intermissionEndsAt)
	}

	g.tick(1200 + roundCooldownMS + 1)

	if g.currentRound != 2 {
		t.Fatalf("expected current round 2 after cooldown, got %d", g.currentRound)
	}
	if !g.players.hasPistol[idx] {
		t.Fatalf("expected pistol ownership to carry into next round")
	}
	if g.players.pistolClip[idx] != pistolMagSize {
		t.Fatalf("expected pistol to start next round reloaded, got clip %d", g.players.pistolClip[idx])
	}
	if g.players.pistolReserve[idx] != 12 {
		t.Fatalf("expected pistol reserve to decrease after reload, got %d", g.players.pistolReserve[idx])
	}
	if g.players.mgClip[idx] != machineGunMagSize {
		t.Fatalf("expected machine gun to start next round reloaded, got clip %d", g.players.mgClip[idx])
	}
	if g.players.mgReserve[idx] != 26 {
		t.Fatalf("expected machine gun reserve to decrease after reload, got %d", g.players.mgReserve[idx])
	}
	if g.players.armor[idx] != 42 {
		t.Fatalf("expected armor to carry into next round, got %d", g.players.armor[idx])
	}
	if g.players.activeWeapon[idx] != WeaponPistol {
		t.Fatalf("expected active weapon to carry into next round, got %q", g.players.activeWeapon[idx])
	}
}

func TestTickAwardsRoundWhenOneTeamIsEliminated(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying
	g.currentRound = 1
	g.roundEndsAt = 5000
	g.buyEndsAt = 1000

	blue := addNamedPlayer(g, "Blue")
	green := addNamedPlayer(g, "Green")
	assignPlayerTeam(g, blue.id, TeamBlue)
	assignPlayerTeam(g, green.id, TeamGreen)

	blueIdx, _ := g.players.indexOf(blue.id)
	greenIdx, _ := g.players.indexOf(green.id)
	g.players.hasPistol[blueIdx] = true
	g.players.pistolClip[blueIdx] = 6
	g.players.pistolReserve[blueIdx] = 9
	g.players.activeWeapon[blueIdx] = WeaponPistol
	g.players.alive[greenIdx] = false
	g.players.hp[greenIdx] = 0

	g.tick(1200)

	if g.blueScore != 1 {
		t.Fatalf("expected blue score 1, got %d", g.blueScore)
	}
	if g.greenScore != 0 {
		t.Fatalf("expected green score 0, got %d", g.greenScore)
	}
	if g.currentRound != 1 {
		t.Fatalf("expected cooldown to keep round 1 active, got %d", g.currentRound)
	}
	if g.intermissionEndsAt != 1200+roundCooldownMS {
		t.Fatalf("expected elimination cooldown to end at %d, got %d", 1200+roundCooldownMS, g.intermissionEndsAt)
	}
	if g.players.alive[greenIdx] {
		t.Fatalf("expected eliminated green player to stay dead during cooldown")
	}
	g.tick(1200 + roundCooldownMS + 1)

	if g.currentRound != 2 {
		t.Fatalf("expected round 2 after cooldown, got %d", g.currentRound)
	}
	if !g.players.alive[greenIdx] {
		t.Fatalf("expected eliminated green player to respawn for next round")
	}
	if !g.players.hasPistol[blueIdx] || g.players.pistolClip[blueIdx] != pistolMagSize || g.players.pistolReserve[blueIdx] != 8 {
		t.Fatalf("expected blue loadout to carry into next round with a reloaded pistol, got clip=%d reserve=%d", g.players.pistolClip[blueIdx], g.players.pistolReserve[blueIdx])
	}
	if g.players.credits[blueIdx] != startingCredits+roundIncomeCredits {
		t.Fatalf("expected blue player to receive round income, got %d", g.players.credits[blueIdx])
	}
}

func TestStripLoadoutOnDeathLeavesOnlyPistolAndOneMagazine(t *testing.T) {
	g := newTestGame()
	player := addNamedPlayer(g, "Player")
	idx, _ := g.players.indexOf(player.id)

	g.players.hasPistol[idx] = true
	g.players.hasMG[idx] = true
	g.players.pistolClip[idx] = 3
	g.players.pistolReserve[idx] = 14
	g.players.mgClip[idx] = 22
	g.players.mgReserve[idx] = 60
	g.players.bombs[idx] = 1
	g.players.smokes[idx] = 1
	g.players.flashbangs[idx] = 1
	g.players.activeWeapon[idx] = WeaponMachineGun

	g.stripLoadoutOnDeathLocked(idx)

	if !g.players.hasPistol[idx] {
		t.Fatalf("expected pistol to remain after death")
	}
	if g.players.hasMG[idx] {
		t.Fatalf("expected machine gun to be removed on death")
	}
	if g.players.pistolClip[idx] != pistolMagSize || g.players.pistolReserve[idx] != 0 {
		t.Fatalf("expected one loaded pistol magazine after death, got clip=%d reserve=%d", g.players.pistolClip[idx], g.players.pistolReserve[idx])
	}
	if g.players.mgClip[idx] != 0 || g.players.mgReserve[idx] != 0 {
		t.Fatalf("expected machine gun ammo to be cleared on death, got clip=%d reserve=%d", g.players.mgClip[idx], g.players.mgReserve[idx])
	}
	if g.players.bombs[idx] != 0 || g.players.smokes[idx] != 0 || g.players.flashbangs[idx] != 0 {
		t.Fatalf("expected utility to be cleared on death")
	}
	if g.players.activeWeapon[idx] != WeaponPistol {
		t.Fatalf("expected active weapon to fall back to pistol after death, got %q", g.players.activeWeapon[idx])
	}
}

func TestFindHitTargetIgnoresTeammates(t *testing.T) {
	g := newTestGame()
	previousGame := game
	game = g
	defer func() { game = previousGame }()
	shooter := addNamedPlayer(g, "Shooter")
	teammate := addNamedPlayer(g, "Mate")
	enemy := addNamedPlayer(g, "Enemy")
	assignPlayerTeam(g, shooter.id, TeamBlue)
	assignPlayerTeam(g, teammate.id, TeamBlue)
	assignPlayerTeam(g, enemy.id, TeamGreen)

	shooterIdx, _ := g.players.indexOf(shooter.id)
	teammateIdx, _ := g.players.indexOf(teammate.id)
	enemyIdx, _ := g.players.indexOf(enemy.id)
	g.players.pos[shooterIdx] = Vec3{0, 1.7, 5}
	g.players.pos[teammateIdx] = Vec3{0, 1.7, 2}
	g.players.pos[enemyIdx] = Vec3{0, 1.7, 0}
	now := int64(1000)
	recordPositionSample(&g.players.history[shooterIdx], now, g.players.pos[shooterIdx], false)
	recordPositionSample(&g.players.history[teammateIdx], now, g.players.pos[teammateIdx], false)
	recordPositionSample(&g.players.history[enemyIdx], now, g.players.pos[enemyIdx], false)

	hit := findHitTarget(shooter.id, g.players.pos[shooterIdx], normalize(Vec3{0, 0, -1}), now, hitscanRange)
	if hit == nil || hit.id != enemy.id {
		t.Fatalf("expected enemy hit while ignoring teammate, got %#v", hit)
	}
}

func TestStaticClientHandlerDisablesCaching(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("ok"), 0o644); err != nil {
		t.Fatalf("write temp index: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	staticClientHandler(http.Dir(dir)).ServeHTTP(rec, req)

	if got := rec.Header().Get("Cache-Control"); got != "no-store, must-revalidate" {
		t.Fatalf("expected no-store cache control, got %q", got)
	}
	if got := rec.Header().Get("Pragma"); got != "no-cache" {
		t.Fatalf("expected pragma no-cache, got %q", got)
	}
	if got := rec.Header().Get("Expires"); got != "0" {
		t.Fatalf("expected expires 0, got %q", got)
	}
}

func TestCanAssignTeamLockedAllowsHostageAndCTF(t *testing.T) {
	for _, mode := range []GameMode{ModeHostage, ModeCTF} {
		t.Run(string(mode), func(t *testing.T) {
			g := newTestGame()
			g.mode = mode
			player := addNamedPlayer(g, "Player")
			idx, _ := g.players.indexOf(player.id)

			if !g.canAssignTeamLocked(idx, TeamBlue) {
				t.Fatalf("expected team assignment to be allowed in %s mode", mode)
			}
		})
	}
}

func TestCanAssignTeamLockedRejectsDeathmatch(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	player := addNamedPlayer(g, "Player")
	idx, _ := g.players.indexOf(player.id)

	if g.canAssignTeamLocked(idx, TeamBlue) {
		t.Fatal("expected team assignment to be rejected in deathmatch mode")
	}
}

func TestSyncFallbackBotLockedAddsBotInHostageMode(t *testing.T) {
	g := newTestGame()
	g.mode = ModeHostage
	blue := addNamedPlayer(g, "Blue")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.syncFallbackBotLocked(1000)

	foundBot := false
	for i := range g.players.ids {
		if g.players.isBot[i] && g.players.team[i] == TeamGreen {
			foundBot = true
		}
	}
	if !foundBot {
		t.Fatal("expected fallback bot on green team in hostage mode")
	}
}

func TestSyncFallbackBotLockedAddsBotInCTFMode(t *testing.T) {
	g := newTestGame()
	g.mode = ModeCTF
	green := addNamedPlayer(g, "Green")
	assignPlayerTeam(g, green.id, TeamGreen)

	g.syncFallbackBotLocked(1000)

	foundBot := false
	for i := range g.players.ids {
		if g.players.isBot[i] && g.players.team[i] == TeamBlue {
			foundBot = true
		}
	}
	if !foundBot {
		t.Fatal("expected fallback bot on blue team in CTF mode")
	}
}

func TestSyncFallbackBotLockedRemovesBotInDeathmatch(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	g.syncFallbackBotLocked(1000)

	for i := range g.players.ids {
		if g.players.isBot[i] {
			t.Fatal("expected no fallback bots in deathmatch mode")
		}
	}
}

func TestCanStartMatchLockedHostageWithBot(t *testing.T) {
	g := newTestGame()
	g.mode = ModeHostage
	blue := addNamedPlayer(g, "Blue")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.syncFallbackBotLocked(1000)

	if ok, reason := g.canStartMatchLocked(); !ok || reason != "" {
		t.Fatalf("expected bot-backed hostage match to start, got ok=%v reason=%q", ok, reason)
	}
}

func TestCanStartMatchLockedCTFWithBot(t *testing.T) {
	g := newTestGame()
	g.mode = ModeCTF
	green := addNamedPlayer(g, "Green")
	assignPlayerTeam(g, green.id, TeamGreen)

	g.syncFallbackBotLocked(1000)

	if ok, reason := g.canStartMatchLocked(); !ok || reason != "" {
		t.Fatalf("expected bot-backed CTF match to start, got ok=%v reason=%q", ok, reason)
	}
}

func TestSyncFallbackBotLockedRemovesBotWhenHumanJoinsHostage(t *testing.T) {
	g := newTestGame()
	g.mode = ModeHostage
	blue := addNamedPlayer(g, "Blue")
	green := addNamedPlayer(g, "Green")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.syncFallbackBotLocked(1000)
	assignPlayerTeam(g, green.id, TeamGreen)
	g.syncFallbackBotLocked(1001)

	for i := range g.players.ids {
		if g.players.isBot[i] {
			t.Fatal("expected bot to be removed once green human joins in hostage mode")
		}
	}
}

func normalize(v Vec3) Vec3 {
	length := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
	return Vec3{v[0] / length, v[1] / length, v[2] / length}
}
