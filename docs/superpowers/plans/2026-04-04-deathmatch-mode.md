# Deathmatch Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable free-for-all deathmatch mode with solo bot fill, immediate respawns, a 10-minute timer, and a 10-second rejoin vote without regressing the current team mode.

**Architecture:** Add a small shared mode model and keep the current server/game loop intact. Route mode-sensitive behavior through focused helpers in the server and client so the dense SoA player store, existing team mode, and current WebSocket protocol stay stable while deathmatch gets its own validation, targeting, respawn, and restart flow.

**Tech Stack:** Go server, browser JavaScript client, Node test runner, Go test

---

### Task 1: Add Client Mode Metadata And Lobby Validation

**Files:**
- Create: `client/js/modes.js`
- Modify: `client/js/net.js`
- Modify: `client/js/main.js`
- Test: `client/js/net.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('welcome and lobby messages retain the selected game mode', async () => {
    const net = createNet();
    const ws = createMockSocket();
    globalThis.WebSocket = function MockSocket() { return ws; };

    const connected = connect(net, 'ws://example.test', 'Host');
    ws.open();
    ws.emit({ t: 'welcome', id: 1, state: 'waiting', match: { mode: 'deathmatch' } });
    await connected;

    assert.equal(net.match.mode, 'deathmatch');

    ws.emit({ t: 'lobby', players: [{ id: 1, name: 'Host' }], state: 'waiting', match: { mode: 'team' } });
    assert.equal(net.match.mode, 'team');
});

test('sendMode sends the requested waiting-lobby mode', () => {
    const net = createNet();
    net.connected = true;
    net.ws = { readyState: 1, sent: [], send(raw) { this.sent.push(JSON.parse(raw)); } };

    sendMode(net, 'deathmatch');

    assert.deepEqual(net.ws.sent[0], { t: 'mode', mode: 'deathmatch' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && node --test client/js/net.test.js`
Expected: FAIL because `match.mode` is not tracked and `sendMode` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
export const MODE_TEAM = 'team';
export const MODE_DEATHMATCH = 'deathmatch';

export function normalizeMode(mode) {
    return mode === MODE_DEATHMATCH ? MODE_DEATHMATCH : MODE_TEAM;
}

function createDefaultMatchState() {
    return {
        mode: MODE_TEAM,
        currentRound: 0,
        totalRounds: 0,
        roundTimeLeftMs: 0,
        buyTimeLeftMs: 0,
        buyPhase: false,
        intermission: false,
        intermissionTimeLeftMs: 0,
        roundWinner: '',
        blueScore: 0,
        greenScore: 0,
        blueAlive: 0,
        greenAlive: 0,
    };
}

export function sendMode(net, mode) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'mode', mode: normalizeMode(mode) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && node --test client/js/net.test.js`
Expected: PASS for the new mode metadata tests.

- [ ] **Step 5: Commit**

```bash
git add client/js/modes.js client/js/net.js client/js/net.test.js client/js/main.js
git commit -m "feat: add client game mode metadata"
```

### Task 2: Add Server Mode Selection And Deathmatch Start Rules

**Files:**
- Modify: `server/main.go`
- Test: `server/main_test.go`

- [ ] **Step 1: Write the failing tests**

```go
func TestDeathmatchStartAllowsSingleHumanWithBot(t *testing.T) {
	g := newTestGame()
	host := addNamedPlayer(g, "Host")
	hostIdx, _ := g.players.indexOf(host.id)
	g.players.team[hostIdx] = TeamNone
	g.mode = ModeDeathmatch

	g.syncModeBotsLocked(1000)

	if ok, reason := g.canStartMatchLocked(); !ok || reason != "" {
		t.Fatalf("expected solo deathmatch start to succeed, got ok=%v reason=%q", ok, reason)
	}
}

func TestSetModeDeniedWhileMatchRunning(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying

	if ok := g.setModeLocked(ModeDeathmatch); ok {
		t.Fatal("expected mode change to be denied during active match")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: FAIL because mode fields and deathmatch validation do not exist.

- [ ] **Step 3: Write minimal implementation**

```go
type GameMode string

const (
	ModeTeam       GameMode = "team"
	ModeDeathmatch GameMode = "deathmatch"
)

func normalizeMode(mode GameMode) GameMode {
	if mode == ModeDeathmatch {
		return mode
	}
	return ModeTeam
}

func (g *Game) setModeLocked(mode GameMode) bool {
	if g.state != StateWaiting {
		return false
	}
	g.mode = normalizeMode(mode)
	return true
}

func (g *Game) canStartMatchLocked() (bool, string) {
	if normalizeMode(g.mode) == ModeDeathmatch {
		if g.humanCountLocked() < 1 {
			return false, "Need at least 1 player"
		}
		return true, ""
	}
	// existing team-mode checks stay here
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS for server mode-selection and deathmatch start tests.

- [ ] **Step 5: Commit**

```bash
git add server/main.go server/main_test.go
git commit -m "feat: add server game mode selection"
```

### Task 3: Add Deathmatch Combat, Respawn, Bot, And Match Expiry

**Files:**
- Modify: `server/main.go`
- Test: `server/main_test.go`

- [ ] **Step 1: Write the failing tests**

```go
func TestDeathmatchFindHitTargetDoesNotSkipFormerTeammates(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	shooter := addNamedPlayer(g, "Shooter")
	target := addNamedPlayer(g, "Target")
	shooterIdx, _ := g.players.indexOf(shooter.id)
	targetIdx, _ := g.players.indexOf(target.id)
	g.players.team[shooterIdx] = TeamBlue
	g.players.team[targetIdx] = TeamBlue
	g.players.pos[shooterIdx] = Vec3{0, standEyeHeight, 5}
	g.players.pos[targetIdx] = Vec3{0, standEyeHeight, 0}
	recordPositionSample(&g.players.history[shooterIdx], 1000, g.players.pos[shooterIdx], false)
	recordPositionSample(&g.players.history[targetIdx], 1000, g.players.pos[targetIdx], false)

	hit := g.findHitTargetLocked(shooter.id, g.players.pos[shooterIdx], normalizeVec(Vec3{0, 0, -1}), 1000, hitscanRange)
	if hit == nil || hit.id != target.id {
		t.Fatalf("expected deathmatch hit target %d, got %#v", target.id, hit)
	}
}

func TestDeathmatchTimerStartsVoteWindow(t *testing.T) {
	g := newTestGame()
	g.mode = ModeDeathmatch
	g.state = StatePlaying
	g.roundEndsAt = 1000

	g.tick(1001)

	if !g.deathmatchVoteActive {
		t.Fatal("expected deathmatch vote window to start after timer expiry")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: FAIL because targeting, respawn, and vote-window logic are still team-only.

- [ ] **Step 3: Write minimal implementation**

```go
func (g *Game) canPlayersDamageLocked(attackerIdx, targetIdx int) bool {
	if attackerIdx == targetIdx {
		return false
	}
	if normalizeMode(g.mode) == ModeDeathmatch {
		return g.players.alive[targetIdx]
	}
	attackerTeam := normalizeTeam(g.players.team[attackerIdx])
	return attackerTeam == TeamNone || normalizeTeam(g.players.team[targetIdx]) != attackerTeam
}

func (g *Game) handlePlayerDeathLocked(idx int, nowMS int64) {
	if normalizeMode(g.mode) == ModeDeathmatch {
		g.scheduleRespawnLocked(g.players.ids[idx], nowMS+respawnDelayMS)
		return
	}
	g.stripLoadoutOnDeathLocked(idx)
}

func (g *Game) startDeathmatchVoteLocked(nowMS int64) {
	g.state = StateWaiting
	g.deathmatchVoteActive = true
	g.deathmatchVoteEndsAt = nowMS + 10_000
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS for deathmatch targeting, respawn, bot sync, and expiry tests.

- [ ] **Step 5: Commit**

```bash
git add server/main.go server/main_test.go
git commit -m "feat: add deathmatch server rules"
```

### Task 4: Add Lobby Controls, Deathmatch HUD, And Rejoin Prompt

**Files:**
- Modify: `client/index.html`
- Modify: `client/style.css`
- Modify: `client/js/main.js`
- Modify: `client/js/hud.js`
- Modify: `client/js/audio.js`
- Test: `client/js/hud.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('leaderboard rows still sort by kills descending then deaths ascending', () => {
    const rows = buildLeaderboardRows({
        1: { name: 'Alpha', kills: 5, deaths: 2 },
        2: { name: 'Bravo', kills: 5, deaths: 1 },
    }, 2);

    assert.deepEqual(rows.map((row) => row.name), ['Bravo', 'Alpha']);
});

test('deathmatch result display shows vote countdown copy', () => {
    assert.deepEqual(getRoundResultDisplay({
        mode: 'deathmatch',
        deathmatchVoteActive: true,
        deathmatchVoteTimeLeftMs: 8000,
    }), {
        visible: true,
        title: 'PLAY AGAIN?',
        subtitle: 'NEXT MATCH VOTE ENDS IN 0:08',
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && node --test client/js/hud.test.js`
Expected: FAIL because the HUD does not understand deathmatch vote states.

- [ ] **Step 3: Write minimal implementation**

```js
export function getRoundResultDisplay(match = {}) {
    if (match.mode === MODE_DEATHMATCH && match.deathmatchVoteActive) {
        return {
            visible: true,
            title: 'PLAY AGAIN?',
            subtitle: `NEXT MATCH VOTE ENDS IN ${formatClock(match.deathmatchVoteTimeLeftMs || 0)}`,
        };
    }
    // existing team-mode result logic stays here
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && node --test client/js/hud.test.js`
Expected: PASS for leaderboard and deathmatch vote-display tests.

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/style.css client/js/main.js client/js/hud.js client/js/hud.test.js client/js/audio.js
git commit -m "feat: add deathmatch lobby and hud flow"
```

### Task 5: Full Verification And Push

**Files:**
- Modify: `docs/superpowers/specs/2026-04-04-deathmatch-mode-design.md`
- Modify: `docs/superpowers/plans/2026-04-04-deathmatch-mode.md`

- [ ] **Step 1: Run the full verification suite**

```bash
cd /Users/emrehanhosver/Desktop/projects/office_shooter && npm test
```

- [ ] **Step 2: Inspect git status**

```bash
cd /Users/emrehanhosver/Desktop/projects/office_shooter && git status --short
```

- [ ] **Step 3: Commit the completed feature**

```bash
git add client server docs
git commit -m "feat: add deathmatch mode"
```

- [ ] **Step 4: Push the branch**

```bash
git push -u origin codex/add_death_match
```
