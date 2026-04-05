# Multi-Lobby Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real public/private lobbies with join-by-key, route each WebSocket session into its own lobby game, and support deathmatch-to-menu vs team-to-lobby exit behavior.

**Architecture:** Introduce a server-side `LobbyManager` that owns isolated `Game` instances and exposes HTTP endpoints for lobby discovery/creation/key lookup. Update the client home screen to create or select a lobby before opening the gameplay WebSocket, then add an in-match pause menu that disconnects to the main menu for deathmatch or leaves the current match while staying in the team lobby.

**Tech Stack:** Go HTTP/WebSocket server, browser JS modules, Node test runner, Go test

---

### Task 1: Server Lobby Registry And API

**Files:**
- Modify: `server/main.go`
- Test: `server/main_test.go`

- [ ] **Step 1: Write the failing tests**

```go
func TestLobbyManagerCreatesPublicAndPrivateLobbies(t *testing.T) {
	manager := newLobbyManager()

	publicLobby := manager.createLobby("Office", false)
	privateLobby := manager.createLobby("Scrim", true)

	if publicLobby.Private {
		t.Fatal("expected public lobby")
	}
	if privateLobby.JoinKey == "" {
		t.Fatal("expected private lobby join key")
	}
	if got := len(manager.listPublicLobbies()); got != 1 {
		t.Fatalf("expected 1 public lobby, got %d", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: FAIL with undefined lobby-manager symbols or missing behavior

- [ ] **Step 3: Write the minimal implementation**

```go
type Lobby struct {
	ID      string
	Name    string
	Private bool
	JoinKey string
	Game    *Game
}

type LobbyManager struct {
	mu      sync.RWMutex
	lobbies map[string]*Lobby
	keys    map[string]string
	nextID  int
}
```

- [ ] **Step 4: Add HTTP handlers and WebSocket routing**

```go
http.HandleFunc("/api/lobbies", lobbyListOrCreateHandler)
http.HandleFunc("/api/lobbies/join-key", lobbyJoinKeyHandler)
http.HandleFunc("/ws", handleWS)
```

- [ ] **Step 5: Run server tests**

Run: `cd server && GOCACHE=$(pwd)/../.gocache go test ./...`
Expected: PASS

### Task 2: Client Connection And Lobby Discovery

**Files:**
- Modify: `client/js/config.js`
- Modify: `client/js/net.js`
- Test: `client/js/config.test.js`
- Test: `client/js/net.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('builds websocket URLs with lobby query params', () => {
    assert.equal(
        buildWebSocketURL('localhost:8090', { protocol: 'http:' }, 'lobby-2'),
        'ws://localhost:8090/ws?lobby=lobby-2'
    );
});
```

- [ ] **Step 2: Run client tests to verify they fail**

Run: `node --test client/js/config.test.js client/js/net.test.js`
Expected: FAIL because URL helpers and lobby metadata are missing

- [ ] **Step 3: Write the minimal implementation**

```js
export function buildHttpURL(server = '', path = '/', locationLike = {}) {
    return `${protocol}//${host}${path}`;
}

export function connect(net, url, name, lobbyMeta = null) {
    net.lobby = lobbyMeta;
    // existing websocket handshake
}
```

- [ ] **Step 4: Add send helper for team-mode leave-match**

```js
export function sendLeaveMatch(net) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'leaveMatch' }));
}
```

- [ ] **Step 5: Run client protocol tests**

Run: `node --test client/js/config.test.js client/js/net.test.js`
Expected: PASS

### Task 3: Client UI And Exit Flow

**Files:**
- Modify: `client/index.html`
- Modify: `client/style.css`
- Modify: `client/js/main.js`

- [ ] **Step 1: Add the failing UI-facing tests where practical**

```js
test('leave-match requests send the expected websocket payload', async () => {
    sendLeaveMatch(net);
    assert.deepEqual(ws.sent.at(-1), { t: 'leaveMatch' });
});
```

- [ ] **Step 2: Run the relevant client tests**

Run: `node --test client/js/net.test.js`
Expected: FAIL until the new message exists

- [ ] **Step 3: Implement the home-screen lobby browser**

```html
<div class="lobby-create">...</div>
<div id="public-lobby-list"></div>
<div class="join-key-row">...</div>
```

- [ ] **Step 4: Implement the in-match pause menu**

```html
<div id="pause-menu" style="display:none;">
  <button id="resume-btn">Resume</button>
  <button id="leave-match-btn">Leave Match</button>
</div>
```

- [ ] **Step 5: Wire deathmatch-vs-team exit behavior**

```js
if (isDeathmatchMode()) {
    returnToMenu('Returned to menu');
} else {
    sendLeaveMatch(net);
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS
