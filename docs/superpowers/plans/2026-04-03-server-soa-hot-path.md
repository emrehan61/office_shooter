# Server SoA Hot-Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Go multiplayer server hot path from `map[int]*Player` to a struct-of-arrays layout while preserving the existing WebSocket protocol and gameplay behavior.

**Architecture:** Replace per-player pointer storage with a dense `playerStore` owned by `Game`, backed by parallel slices plus `idToIndex`. Keep WebSocket messages stable and migrate only the hot-path systems: join/remove, state ticks, lag compensation, hit resolution, and respawn/kill bookkeeping.

**Tech Stack:** Go 1.21, Gorilla WebSocket, Node test runner, existing browser WebSocket client

---

## File Structure

- Modify: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main.go`
  Responsibility: Define the SoA store, migrate server lifecycle/state/hit logic to indexed slices, preserve protocol behavior.
- Modify: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main_test.go`
  Responsibility: Verify SoA bookkeeping, swap-delete correctness, snapshots, and lag-comp helpers.

### Task 1: Add SoA Regression Tests

**Files:**
- Modify: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main_test.go`
- Test: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main_test.go`

- [ ] **Step 1: Write the failing tests**

```go
func TestRemovePlayerSwapDeleteKeepsRemainingIndexValid(t *testing.T) {
	g := newTestGame()

	first := addNamedPlayer(g, "One")
	second := addNamedPlayer(g, "Two")
	third := addNamedPlayer(g, "Three")

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

	_ = first
}

func TestStateTickIncludesKillsAndDeathsFromDenseStore(t *testing.T) {
	g := newTestGame()
	g.state = StatePlaying

	host := addNamedPlayer(g, "Host")
	guest := addNamedPlayer(g, "Guest")

	hostIdx, _ := g.players.indexOf(host.id)
	guestIdx, _ := g.players.indexOf(guest.id)
	g.players.kills[hostIdx] = 7
	g.players.deaths[hostIdx] = 2
	g.players.kills[guestIdx] = 1
	g.players.deaths[guestIdx] = 5

	g.stateTick()

	msg := readQueuedMessage(t, host.sendCh)
	players := msg["players"].(map[string]any)
	hostState := players["1"].(map[string]any)
	guestState := players["2"].(map[string]any)

	if int(hostState["kills"].(float64)) != 7 || int(guestState["deaths"].(float64)) != 5 {
		t.Fatalf("expected kills/deaths to come from dense store")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/alyo/Desktop/personaltobedeleted/fps-game/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: FAIL because `g.players.indexOf`, dense store fields, and new helpers do not exist yet.

- [ ] **Step 3: Write minimal test helper updates**

```go
type testPlayer struct {
	id     int
	sendCh chan []byte
}

func addNamedPlayer(g *Game, name string) testPlayer {
	id, sendCh, ok := g.addPlayer(nil)
	if !ok {
		panic("expected player slot")
	}
	idx, _ := g.players.indexOf(id)
	g.players.names[idx] = name
	return testPlayer{id: id, sendCh: sendCh}
}
```

- [ ] **Step 4: Run tests again and confirm the failure is now only about missing SoA implementation**

Run: `cd /Users/alyo/Desktop/personaltobedeleted/fps-game/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: FAIL on missing SoA server implementation, not malformed tests.

### Task 2: Introduce Dense Player Storage

**Files:**
- Modify: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main.go`
- Test: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main_test.go`

- [ ] **Step 1: Add the dense store types**

```go
type playerStore struct {
	ids      []int
	names    []string
	pos      []Vec3
	yaw      []float64
	pitch    []float64
	hp       []int
	alive    []bool
	kills    []int
	deaths   []int
	conns    []*websocket.Conn
	sendChs  []chan []byte
	history  [][]positionSample
	idToIndex map[int]int
}
```

- [ ] **Step 2: Replace `Game.players map[int]*Player` with the dense store and constructor helpers**

```go
type Game struct {
	mu      sync.RWMutex
	players playerStore
	nextID  int
	state   GameState
}

func newPlayerStore() playerStore {
	return playerStore{idToIndex: make(map[int]int)}
}
```

- [ ] **Step 3: Implement add/index/remove helpers with swap-delete**

```go
func (ps *playerStore) indexOf(id int) (int, bool) {
	idx, ok := ps.idToIndex[id]
	return idx, ok
}

func (ps *playerStore) removeAt(idx int) {
	last := len(ps.ids) - 1
	movedID := ps.ids[last]
	// swap all slices, then shrink and update idToIndex
	_ = movedID
}
```

- [ ] **Step 4: Update `addPlayer`, `removePlayer`, `broadcast`, and direct-send code to use slices and channels by index**

Run: `cd /Users/alyo/Desktop/personaltobedeleted/fps-game/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: fewer failures, with remaining failures in message assembly or gameplay logic.

### Task 3: Migrate Snapshots, Lobby, and Join Flow

**Files:**
- Modify: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main.go`
- Test: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main_test.go`

- [ ] **Step 1: Rewrite lobby broadcast to iterate dense slices**

```go
for i, id := range g.players.ids {
	if g.players.names[i] == "" {
		continue
	}
	players = append(players, LobbyPlayer{
		ID: id, Name: g.players.names[i],
		Kills: g.players.kills[i], Deaths: g.players.deaths[i],
	})
}
```

- [ ] **Step 2: Rewrite state snapshots to read SoA fields**

```go
for i, id := range g.players.ids {
	state[id] = PlayerState{
		Pos: g.players.pos[i], Yaw: g.players.yaw[i], Pitch: g.players.pitch[i],
		Hp: g.players.hp[i], Name: g.players.names[i],
		Kills: g.players.kills[i], Deaths: g.players.deaths[i],
	}
}
```

- [ ] **Step 3: Rewrite name/join handshake in `handleWS` to use `id -> index` lookup and stored `sendCh`**

Run: `cd /Users/alyo/Desktop/personaltobedeleted/fps-game/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: lobby/state tests pass again.

### Task 4: Migrate Input, Lag Compensation, and Combat

**Files:**
- Modify: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main.go`
- Test: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main_test.go`

- [ ] **Step 1: Move input writes to indexed slices and indexed history**

```go
idx, ok := game.players.indexOf(playerID)
if ok && game.players.alive[idx] {
	game.players.pos[idx] = pos
	recordPositionSample(&game.players.history[idx], nowMS, pos)
}
```

- [ ] **Step 2: Change hit candidates from `*Player` to dense indices**

```go
type hitCandidate struct {
	index int
	id    int
	zone  HitZone
	dist  float64
}
```

- [ ] **Step 3: Rewrite hit detection, kill bookkeeping, and respawn using slice indices**

```go
victimIdx, ok := game.players.indexOf(victimID)
if ok && game.players.alive[victimIdx] {
	game.players.hp[victimIdx] -= damage
	if game.players.hp[victimIdx] <= 0 {
		game.players.hp[victimIdx] = 0
		game.players.alive[victimIdx] = false
		game.players.deaths[victimIdx]++
	}
}
```

- [ ] **Step 4: Run server tests**

Run: `cd /Users/alyo/Desktop/personaltobedeleted/fps-game/server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS

### Task 5: Full Verification

**Files:**
- Modify: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main.go`
- Modify: `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main_test.go`

- [ ] **Step 1: Format the Go files**

Run: `cd /Users/alyo/Desktop/personaltobedeleted/fps-game && gofmt -w server/main.go server/main_test.go`
Expected: no output

- [ ] **Step 2: Run project verification**

Run: `cd /Users/alyo/Desktop/personaltobedeleted/fps-game && npm test`
Expected: all client and server tests pass

- [ ] **Step 3: Report remaining runtime check**

Manual follow-up: restart the LAN server and validate that connect, lobby, hit registration, leaderboard, ammo reward, and ping still work from two browsers.
