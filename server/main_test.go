package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func newTestGame() *Game {
	return &Game{
		players: newPlayerStore(),
		nextID:  1,
		state:   StateWaiting,
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

	if _, ok := g.players.indexOf(first.id); !ok {
		t.Fatalf("expected untouched player to remain addressable")
	}
}

func TestTracePlayerHitHeadshotWinsAndUsesHeadDamage(t *testing.T) {
	origin := Vec3{0, 1.7, 5}
	target := Vec3{0, 1.7, 0}
	headAim := normalize(Vec3{0, -0.28, -5})

	zone, dist, ok := tracePlayerHit(origin, headAim, target)
	if !ok {
		t.Fatal("expected headshot hit")
	}
	if zone != HitZoneHead {
		t.Fatalf("expected head zone, got %q", zone)
	}
	if dist <= 0 {
		t.Fatalf("expected positive distance, got %f", dist)
	}
	if dmg := damageForHitZone(zone); dmg != 90 {
		t.Fatalf("expected head damage 90, got %d", dmg)
	}
}

func TestTracePlayerHitBodyshotUsesBodyDamage(t *testing.T) {
	origin := Vec3{0, 1.1, 5}
	target := Vec3{0, 1.7, 0}
	bodyAim := normalize(Vec3{0, -0.35, -5})

	zone, _, ok := tracePlayerHit(origin, bodyAim, target)
	if !ok {
		t.Fatal("expected bodyshot hit")
	}
	if zone != HitZoneBody {
		t.Fatalf("expected body zone, got %q", zone)
	}
	if dmg := damageForHitZone(zone); dmg != 20 {
		t.Fatalf("expected body damage 20, got %d", dmg)
	}
}

func TestTracePlayerHitMissesOutsideHitboxes(t *testing.T) {
	origin := Vec3{4, 1.7, 5}
	target := Vec3{0, 1.7, 0}
	missAim := normalize(Vec3{0, 0, -1})

	if _, _, ok := tracePlayerHit(origin, missAim, target); ok {
		t.Fatal("expected miss")
	}
}

func TestTracePlayerHitLevelShotAtStandingTargetHits(t *testing.T) {
	origin := Vec3{0, 1.7, 5}
	target := Vec3{0, 1.7, 0}
	levelAim := normalize(Vec3{0, 0, -1})

	zone, _, ok := tracePlayerHit(origin, levelAim, target)
	if !ok {
		t.Fatal("expected level shot to hit standing target")
	}
	if zone != HitZoneHead {
		t.Fatalf("expected level shot to land on head zone, got %q", zone)
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
	samples := []positionSample{
		{At: 1000, Pos: Vec3{0, 1.7, 0}},
		{At: 1100, Pos: Vec3{10, 1.7, 0}},
	}

	got := positionAtTime(samples, 1050)
	if math.Abs(got[0]-5) > 1e-6 {
		t.Fatalf("expected interpolated x to be 5, got %f", got[0])
	}
	if math.Abs(got[1]-1.7) > 1e-6 {
		t.Fatalf("expected y to stay 1.7, got %f", got[1])
	}
}

func TestStateTickIncludesKillsAndDeaths(t *testing.T) {
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
	if got := int(guestState["kills"].(float64)); got != 1 {
		t.Fatalf("expected guest kills 1, got %d", got)
	}
	if got := int(guestState["deaths"].(float64)); got != 5 {
		t.Fatalf("expected guest deaths 5, got %d", got)
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

func normalize(v Vec3) Vec3 {
	length := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
	return Vec3{v[0] / length, v[1] / length, v[2] / length}
}
