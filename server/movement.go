package main

import "math"

// Movement constants — must match client/js/player.js exactly.
const (
	baseSpeed     = 10.0
	gravity       = -20.0
	baseJumpVel   = 7.0
	baseMoveSpeed = 240.0 // denominator for weapon mobility multiplier
	ceilingY      = 5.0 - 0.1
)

// InputCommand represents a single client input frame.
type InputCommand struct {
	Seq      uint16
	Forward  bool
	Backward bool
	Left     bool
	Right    bool
	Jump     bool
	Crouch   bool
	Aiming   bool
	Yaw      float64
	Pitch    float64
}

// getMoveSpeedServer computes the movement speed for a weapon,
// mirroring client/js/player.js getMoveSpeed() + economy.js hydrateWeaponDef().
func getMoveSpeedServer(weapon WeaponID, aiming bool) float64 {
	entry, ok := weaponCatalogEntryByID(weapon)
	if !ok {
		// Knife / unknown — full speed
		return baseSpeed
	}
	ms := entry.MoveSpeed
	if ms <= 0 {
		ms = baseMoveSpeed
	}
	mul := ms / baseMoveSpeed
	if aiming && len(entry.ZoomLevels) > 0 && entry.ScopedMoveSpeed > 0 {
		mul *= entry.ScopedMoveSpeed / math.Max(1, ms)
	}
	return baseSpeed * mul
}

// getJumpVelServer computes the jump velocity for a weapon,
// mirroring client/js/player.js getJumpVelocity().
func getJumpVelServer(weapon WeaponID) float64 {
	entry, ok := weaponCatalogEntryByID(weapon)
	if !ok {
		return baseJumpVel
	}
	ms := entry.MoveSpeed
	if ms <= 0 {
		ms = baseMoveSpeed
	}
	return baseJumpVel * (ms / baseMoveSpeed)
}

// simulateMovement runs one tick of movement physics for a player.
// This is an exact port of client/js/player.js updatePlayer() (lines 153-206).
// g.mu must be held by the caller.
func (g *Game) simulateMovement(idx int, cmd InputCommand, dt float64) {
	if !g.players.alive[idx] || !g.players.inMatch[idx] {
		return
	}

	pos := g.players.pos[idx]
	velY := g.players.velY[idx]
	onGround := g.players.onGround[idx]

	// Forward / right vectors from yaw (matches client math.js).
	sinYaw := math.Sin(cmd.Yaw)
	cosYaw := math.Cos(cmd.Yaw)
	fwdX := -sinYaw
	fwdZ := -cosYaw
	rightX := cosYaw
	rightZ := -sinYaw

	// Eye height for crouch state.
	eyeHeight := standEyeHeight
	if cmd.Crouch {
		eyeHeight = crouchEyeHeight
	}

	// Accumulate movement direction.
	var mx, mz float64
	if cmd.Forward {
		mx += fwdX
		mz += fwdZ
	}
	if cmd.Backward {
		mx -= fwdX
		mz -= fwdZ
	}
	if cmd.Left {
		mx -= rightX
		mz -= rightZ
	}
	if cmd.Right {
		mx += rightX
		mz += rightZ
	}

	// Normalize and scale by move speed.
	mlen := math.Sqrt(mx*mx + mz*mz)
	if mlen > 0 {
		moveSpeed := getMoveSpeedServer(g.players.activeWeapon[idx], cmd.Aiming)
		mx = mx / mlen * moveSpeed
		mz = mz / mlen * moveSpeed
	}

	// Apply horizontal movement.
	pos[0] += mx * dt
	pos[2] += mz * dt

	// Jump.
	if cmd.Jump && onGround {
		velY = getJumpVelServer(g.players.activeWeapon[idx])
		onGround = false
	}

	// Vertical physics.
	if onGround {
		footY := pos[1] - eyeHeight
		groundHeight := g.groundHeightAt(pos[0], pos[2], footY+worldStepHeight)
		if footY-groundHeight > worldStepDown {
			onGround = false
		} else {
			pos[1] = groundHeight + eyeHeight
			velY = 0
		}
	}
	if !onGround {
		prevHeadY := pos[1] + playerHeadClearance
		velY += gravity * dt
		pos[1] += velY * dt
		if velY > 0 {
			if ceilingHeight, ok := g.ceilingHeightAt(pos[0], pos[2], prevHeadY, pos[1]+playerHeadClearance); ok {
				pos[1] = ceilingHeight - playerHeadClearance
				velY = 0
			}
		}
		landingHeight := g.groundHeightAt(pos[0], pos[2], pos[1]-eyeHeight)
		if pos[1] <= landingHeight+eyeHeight {
			pos[1] = landingHeight + eyeHeight
			velY = 0
			onGround = true
		}
	}

	// Ceiling collision.
	if pos[1] > ceilingY {
		pos[1] = ceilingY
		velY = 0
		onGround = false
	}

	// Wall / box collision (reuse existing server implementation).
	g.collideWalls(&pos, eyeHeight)

	// Arena bounds clamp (matches client player.js:204-205, using arenaSize-0.5).
	limit := g.mapArenaSize - 0.5
	pos[0] = math.Max(-limit, math.Min(limit, pos[0]))
	pos[2] = math.Max(-limit, math.Min(limit, pos[2]))

	// Write back.
	g.players.pos[idx] = pos
	g.players.velY[idx] = velY
	g.players.onGround[idx] = onGround
	g.players.crouching[idx] = cmd.Crouch
}
