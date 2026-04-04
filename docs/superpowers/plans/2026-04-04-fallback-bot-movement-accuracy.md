# Fallback Bot Movement And Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fallback bot move toward nearby enemies, strafe at close range, and only get a good shot on 1 out of every 5 deterministic shot opportunities.

**Architecture:** Keep the change server-only by extending the existing bot tick loop in `server/main.go`. Add small helper functions for deterministic shot-quality selection and planar bot movement, verify them with focused server tests, then wire them into the bot update path without changing the WebSocket protocol.

**Tech Stack:** Go server, Go test

---

### Task 1: Add Failing Tests For Bot Movement And Shot Quality

**Files:**
- Modify: `server/main_test.go`
- Test: `server/main_test.go`

- [ ] **Step 1: Write the failing tests**

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: FAIL with missing `isAccurateBotShot` helper and unchanged bot position

- [ ] **Step 3: Write minimal implementation**

```go
func isAccurateBotShot(shotIndex int64) bool {
	return shotIndex%5 == 0
}

func clampBotAxis(v float64) float64 {
	return math.Max(-(projectileBounds-1.0), math.Min(projectileBounds-1.0, v))
}

func (g *Game) moveFallbackBotLocked(idx, targetIdx int, nowMS int64) {
	pos := g.players.pos[idx]
	target := g.players.pos[targetIdx]
	dir := normalizeVec(Vec3{target[0] - pos[0], 0, target[2] - pos[2]})
	pos[0] = clampBotAxis(pos[0] + dir[0]*0.22)
	pos[2] = clampBotAxis(pos[2] + dir[2]*0.22)
	pos[1] = standEyeHeight
	g.players.pos[idx] = pos
	recordPositionSample(&g.players.history[idx], nowMS, pos, false)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS for the new movement and shot-quality tests

- [ ] **Step 5: Commit**

```bash
git add server/main.go server/main_test.go
git commit -m "test: cover bot movement and shot quality"
```

### Task 2: Make Close-Range Bot Behavior Strafe And Miss Often

**Files:**
- Modify: `server/main.go`
- Modify: `server/main_test.go`
- Test: `server/main_test.go`

- [ ] **Step 1: Write the failing test**

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: FAIL because the bot still moves directly or stands still without close-range strafing

- [ ] **Step 3: Write minimal implementation**

```go
func applyBotAimProfile(dir Vec3, shotIndex int64) Vec3 {
	if isAccurateBotShot(shotIndex) {
		return normalizeVec(Vec3{dir[0], dir[1] + 0.01, dir[2]})
	}
	return normalizeVec(Vec3{dir[0] + 0.38, dir[1] + 0.16, dir[2] - 0.12})
}

func (g *Game) moveFallbackBotLocked(idx, targetIdx int, nowMS int64) {
	pos := g.players.pos[idx]
	target := g.players.pos[targetIdx]
	flat := Vec3{target[0] - pos[0], 0, target[2] - pos[2]}
	if distanceVec3(Vec3{pos[0], 0, pos[2]}, Vec3{target[0], 0, target[2]}) > 6 {
		dir := normalizeVec(flat)
		pos[0] = clampBotAxis(pos[0] + dir[0]*0.22)
		pos[2] = clampBotAxis(pos[2] + dir[2]*0.22)
	} else {
		dir := normalizeVec(flat)
		strafe := Vec3{-dir[2], 0, dir[0]}
		sign := 1.0
		if (nowMS/700)%2 == 1 {
			sign = -1.0
		}
		pos[0] = clampBotAxis(pos[0] + strafe[0]*0.18*sign)
		pos[2] = clampBotAxis(pos[2] + strafe[2]*0.18*sign)
	}
	pos[1] = standEyeHeight
	g.players.pos[idx] = pos
	recordPositionSample(&g.players.history[idx], nowMS, pos, false)
}

func (g *Game) tickFallbackBotsLocked(nowMS int64, tm *tickMessages) {
	targetIdx := g.nearestEnemyLocked(idx)
	g.moveFallbackBotLocked(idx, targetIdx, nowMS)
	dir := normalizeVec(Vec3{
		g.players.pos[targetIdx][0] - g.players.pos[idx][0],
		g.players.pos[targetIdx][1] - g.players.pos[idx][1],
		g.players.pos[targetIdx][2] - g.players.pos[idx][2],
	})
	dir = applyBotAimProfile(dir, g.players.botShotCount[idx])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS for the new close-range strafe test and the existing bot tests

- [ ] **Step 5: Commit**

```bash
git add server/main.go server/main_test.go
git commit -m "feat: tune fallback bot movement and aim"
```

### Task 3: Full Verification And Push

**Files:**
- Modify: `server/main.go`
- Modify: `server/main_test.go`

- [ ] **Step 1: Run server tests**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS with `ok  	fps-server`

- [ ] **Step 2: Run full project tests**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && npm test`
Expected: PASS with 0 failures

- [ ] **Step 3: Push the branch**

Run: `cd /Users/emrehanhosver/Desktop/projects/office_shooter && git push`
Expected: branch `codex/fallback-team-bot` updated on `origin`
