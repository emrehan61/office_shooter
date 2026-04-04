# Fallback Team Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let matches start and continue with a server-authoritative fallback bot on the empty team, and remove that bot when a human joins the same side.

**Architecture:** Keep the WebSocket protocol stable by representing the fallback bot inside the existing server player store. Update the client lobby validation to mirror the new occupancy rules, then extend the server with bot-aware roster syncing, human-slot accounting, and a simple stationary pistol AI that reuses the existing combat path.

**Tech Stack:** Go server, browser JavaScript client, Node test runner, Go test

---

### Task 1: Update Client Lobby Start Validation

**Files:**
- Modify: `client/js/teams.js`
- Test: `client/js/teams.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('team start state allows a one-player size gap when both teams are occupied', () => {
    assert.deepEqual(getTeamStartState({
        1: { team: TEAM_BLUE },
        2: { team: TEAM_GREEN },
        3: { team: TEAM_GREEN },
    }), { ok: true, reason: '' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && node --test client/js/teams.test.js`
Expected: FAIL on the new test with `"Teams must be even"`

- [ ] **Step 3: Write minimal implementation**

```js
export function getTeamStartState(players) {
    const counts = getTeamCounts(players);
    const totalPlayers = Object.keys(players || {}).length;

    if (totalPlayers < 2) {
        return { ok: false, reason: 'Need at least 2 players' };
    }
    if (counts.unassigned > 0) {
        return { ok: false, reason: 'All players must join a team' };
    }
    if (counts.blue === 0 || counts.green === 0) {
        return { ok: false, reason: 'Both teams need players' };
    }
    if (Math.abs(counts.blue - counts.green) > 1) {
        return { ok: false, reason: 'Teams must stay within one player' };
    }
    return { ok: true, reason: '' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && node --test client/js/teams.test.js`
Expected: PASS for all tests in `client/js/teams.test.js`

- [ ] **Step 5: Commit**

```bash
git add client/js/teams.js client/js/teams.test.js
git commit -m "test: relax lobby start balancing rule"
```

### Task 2: Add Server Fallback Bot Lifecycle and Start Validation

**Files:**
- Modify: `server/main.go`
- Test: `server/main_test.go`

- [ ] **Step 1: Write the failing tests**

```go
func TestSyncFallbackBotAddsBotForEmptyTeam(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.mu.Lock()
	g.syncFallbackBotLocked(time.Now().UnixMilli())
	g.mu.Unlock()

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

	g.mu.Lock()
	g.syncFallbackBotLocked(time.Now().UnixMilli())
	ok, reason := g.canStartMatchLocked()
	g.mu.Unlock()

	if !ok || reason != "" {
		t.Fatalf("expected bot-backed roster to start, got ok=%v reason=%q", ok, reason)
	}
}

func TestSyncFallbackBotRemovesBotWhenHumanJoinsThatTeam(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	green := addNamedPlayer(g, "Green")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.mu.Lock()
	g.syncFallbackBotLocked(time.Now().UnixMilli())
	assignPlayerTeam(g, green.id, TeamGreen)
	g.syncFallbackBotLocked(time.Now().UnixMilli())
	g.mu.Unlock()

	for i := range g.players.ids {
		if g.players.isBot[i] {
			t.Fatal("expected bot to be removed once green human joins")
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: FAIL with missing `isBot` / `syncFallbackBotLocked` symbols and old start-rule assertions

- [ ] **Step 3: Write minimal implementation**

```go
type playerStore struct {
	ids       []int
	names     []string
	team      []TeamID
	alive     []bool
	conns     []*websocket.Conn
	sendChs   []chan []byte
	history   [][]positionSample
	isBot     []bool
	// existing gameplay slices remain here
	idToIndex map[int]int
}

func (g *Game) humanCountLocked() int {
	count := 0
	for i := range g.players.ids {
		if !g.players.isBot[i] && g.players.names[i] != "" {
			count++
		}
	}
	return count
}

func (g *Game) humanTeamCountsLocked() (blue, green int) {
	for i := range g.players.ids {
		if g.players.isBot[i] {
			continue
		}
		switch normalizeTeam(g.players.team[i]) {
		case TeamBlue:
			blue++
		case TeamGreen:
			green++
		}
	}
	return blue, green
}

func (g *Game) syncFallbackBotLocked(nowMS int64) {
	blueHumans, greenHumans := g.humanTeamCountsLocked()
	desiredTeam := TeamNone
	switch {
	case blueHumans > 0 && greenHumans == 0:
		desiredTeam = TeamGreen
	case greenHumans > 0 && blueHumans == 0:
		desiredTeam = TeamBlue
	}
	for i := len(g.players.ids) - 1; i >= 0; i-- {
		if !g.players.isBot[i] {
			continue
		}
		if desiredTeam == TeamNone || normalizeTeam(g.players.team[i]) != desiredTeam {
			g.players.removeAt(i)
		}
	}
	if desiredTeam == TeamNone {
		return
	}
	for i := range g.players.ids {
		if g.players.isBot[i] && normalizeTeam(g.players.team[i]) == desiredTeam {
			return
		}
	}
	g.addFallbackBotLocked(desiredTeam, nowMS)
}

func (g *Game) canStartMatchLocked() (bool, string) {
	if g.humanCountLocked() < 1 {
		return false, "Need at least 1 player"
	}
	for i := range g.players.ids {
		if g.players.isBot[i] {
			continue
		}
		if normalizeTeam(g.players.team[i]) == TeamNone {
			return false, "All players must join a team"
		}
	}
	blue, green := g.teamCountsLocked()
	if blue == 0 || green == 0 {
		return false, "Both teams need players"
	}
	if absInt(blue-green) > 1 {
		return false, "Teams must stay within one player"
	}
	return true, ""
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS for bot lifecycle and updated start-validation tests

- [ ] **Step 5: Commit**

```bash
git add server/main.go server/main_test.go
git commit -m "feat: add fallback team bot lifecycle"
```

### Task 3: Reuse Server Shoot Logic for Bot AI

**Files:**
- Modify: `server/main.go`
- Test: `server/main_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestTickBotFiresAtNearestEnemy(t *testing.T) {
	g := newTestGame()
	blue := addNamedPlayer(g, "Blue")
	assignPlayerTeam(g, blue.id, TeamBlue)

	g.mu.Lock()
	g.syncFallbackBotLocked(1000)
	botIdx := -1
	for i := range g.players.ids {
		if g.players.isBot[i] {
			botIdx = i
		}
	}
	if botIdx < 0 {
		t.Fatal("expected fallback bot")
	}
	playerIdx, _ := g.players.indexOf(blue.id)
	g.state = StatePlaying
	g.currentRound = 1
	g.buyEndsAt = 0
	g.players.pos[playerIdx] = Vec3{-2, standEyeHeight, 0}
	g.players.pos[botIdx] = Vec3{2, standEyeHeight, 0}
	recordPositionSample(&g.players.history[playerIdx], 1000, g.players.pos[playerIdx], false)
	recordPositionSample(&g.players.history[botIdx], 1000, g.players.pos[botIdx], false)
	g.players.activeWeapon[botIdx] = WeaponPistol
	g.players.hasPistol[botIdx] = true
	g.players.pistolClip[botIdx] = pistolMagSize
	g.players.botNextThinkAt[botIdx] = 0
	g.mu.Unlock()

	g.tick(1100)

	msg := readQueuedMessage(t, blue.sendCh)
	if got, _ := msg["t"].(string); got != "shot" {
		t.Fatalf("expected bot shot broadcast, got %#v", msg["t"])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: FAIL with missing bot AI fields or no `shot` message emitted

- [ ] **Step 3: Write minimal implementation**

```go
func (g *Game) fireWeaponLocked(idx int, actorID int, requested WeaponID, dir Vec3, shotTime, nowMS int64, aiming, alternate bool) ([]byte, *hitCandidate, *economyUpdate, bool) {
	weapon := g.normalizeActiveWeaponLocked(idx, requested)
	if !g.players.alive[idx] || nowMS < g.buyEndsAt || g.isIntermissionLocked(nowMS) {
		return nil, nil, nil, false
	}
	if g.isReloadingLocked(idx, nowMS) {
		return nil, nil, nil, false
	}
	config := effectiveWeaponConfig(weapon, alternate)
	if nowMS < g.players.nextAttackAt[idx] {
		return nil, nil, nil, false
	}
	if config.UsesAmmo && !g.spendAmmoLocked(idx, weapon, 1) {
		if weapon == WeaponPistol {
			g.startReloadLocked(idx, weapon, nowMS)
		}
		return nil, nil, nil, false
	}
	bloom := g.registerShotBloomLocked(idx, weapon, nowMS)
	moving := isMovingAtTime(g.players.history[idx], shotTime)
	dir = applyShotSpread(dir, config, aiming, g.players.crouching[idx], moving, bloom, shotTime+int64(actorID)*97+nowMS)
	g.players.nextAttackAt[idx] = nowMS + config.FireIntervalMS
	origin := positionAtTime(g.players.history[idx], shotTime)
	shotMsg, _ := json.Marshal(map[string]interface{}{"t": "shot", "id": actorID, "pos": origin, "dir": dir, "weapon": weapon, "alternate": alternate})
	return shotMsg, findHitTarget(actorID, origin, dir, shotTime, config.Range), nil, true
}

func (g *Game) tickFallbackBotLocked(nowMS int64, tm *tickMessages) {
	if g.state != StatePlaying || nowMS < g.buyEndsAt || g.isIntermissionLocked(nowMS) {
		return
	}
	for idx, id := range g.players.ids {
		if !g.players.isBot[idx] || !g.players.alive[idx] {
			continue
		}
		target := g.nearestEnemyLocked(idx)
		if target < 0 {
			continue
		}
		dir := normalizeVec(Vec3{
			g.players.pos[target][0] - g.players.pos[idx][0],
			g.players.pos[target][1] - g.players.pos[idx][1],
			g.players.pos[target][2] - g.players.pos[idx][2],
		})
		g.players.yaw[idx], g.players.pitch[idx] = yawPitchFromDirection(dir)
		if nowMS < g.players.botNextThinkAt[idx] {
			continue
		}
		aimDir := applyBotAimError(dir, nowMS+int64(id)*31)
		shotMsg, hit, shooterUpdate, ok := g.fireWeaponLocked(idx, id, WeaponPistol, aimDir, nowMS, nowMS, false, false)
		g.players.botNextThinkAt[idx] = nowMS + 650
		if !ok {
			continue
		}
		tm.broadcasts = append(tm.broadcasts, shotMsg)
		g.resolveShotHitLocked(id, WeaponPistol, hit, shooterUpdate, nowMS, tm)
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS for the bot firing test and existing server tests

- [ ] **Step 5: Commit**

```bash
git add server/main.go server/main_test.go
git commit -m "feat: add simple fallback bot combat"
```

### Task 4: Full Verification

**Files:**
- Modify: `server/main.go`
- Modify: `server/main_test.go`
- Modify: `client/js/teams.js`
- Test: `client/js/teams.test.js`

- [ ] **Step 1: Run focused client tests**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && node --test client/js/*.test.js`
Expected: PASS with 0 failures

- [ ] **Step 2: Run server tests**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS with `ok` status for `server`

- [ ] **Step 3: Run full project tests**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && npm test`
Expected: PASS for the full suite with 0 failures

- [ ] **Step 4: Commit**

```bash
git add client/js/teams.js client/js/teams.test.js server/main.go server/main_test.go
git commit -m "feat: add fallback team bot"
```
