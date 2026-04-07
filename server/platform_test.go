package main

import (
	"math"
	"testing"
)

func TestGroundHeightAtUsesHighestPlatform(t *testing.T) {
	g := newTestGame()
	g.mapPlatformsRuntime = []platformEntry{
		{X1: 0, Z1: 0, X2: 4, Z2: 4, Y: 0.4, Thickness: 0.2, MatID: 27},
		{X1: 1, Z1: 1, X2: 3, Z2: 3, Y: 1.2, Thickness: 0.2, MatID: 27},
	}

	if got := g.groundHeightAt(2, 2, 2); math.Abs(got-1.2) > 1e-6 {
		t.Fatalf("expected highest platform height 1.2, got %f", got)
	}
	if got := g.groundHeightAt(2, 2, 0.6); math.Abs(got-0.4) > 1e-6 {
		t.Fatalf("expected lower step height 0.4 with capped maxTop, got %f", got)
	}
}

func TestSimulateMovementClimbsStepsOntoPlatform(t *testing.T) {
	g := newTestGame()
	g.mapArenaSize = 30
	g.mapPlatformsRuntime = []platformEntry{
		{X1: 0.0, Z1: -1.0, X2: 1.6, Z2: 1.0, Y: 0.4, Thickness: 0.2, MatID: 27},
		{X1: 1.2, Z1: -1.2, X2: 2.8, Z2: 1.2, Y: 0.8, Thickness: 0.2, MatID: 27},
		{X1: 2.5, Z1: -1.5, X2: 5.5, Z2: 1.5, Y: 1.2, Thickness: 0.25, MatID: 27},
	}

	player := addNamedPlayer(g, "Stepper")
	idx := assignPlayerTeam(g, player.id, TeamBlue)
	g.players.pos[idx] = Vec3{-0.2, standEyeHeight, 0}
	g.players.onGround[idx] = true
	g.players.activeWeapon[idx] = WeaponKnife

	cmd := InputCommand{
		Forward: true,
		Yaw:     -math.Pi / 2,
	}

	for i := 0; i < 30; i++ {
		g.simulateMovement(idx, cmd, 1.0/60.0)
	}

	if !g.players.onGround[idx] {
		t.Fatal("expected player to remain grounded on the platform")
	}
	if got := g.players.pos[idx][0]; got <= 3.0 {
		t.Fatalf("expected player to move onto the raised platform, got x=%f", got)
	}
	wantY := standEyeHeight + 1.2
	if got := g.players.pos[idx][1]; math.Abs(got-wantY) > 0.05 {
		t.Fatalf("expected player eye height near %f on the platform, got %f", wantY, got)
	}
}
