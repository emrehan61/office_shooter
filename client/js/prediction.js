// Client-side prediction and server reconciliation for server-authoritative movement.
import { forwardFromYaw, rightFromYaw } from './math.js';
import { collideWalls, mapArena } from './world.js';
import { getMoveSpeed, getJumpVelocity, PLAYER_RADIUS, STAND_EYE_HEIGHT, CROUCH_EYE_HEIGHT } from './player.js';

const GRAVITY = -20;
const CEILING_Y = 5.0 - 0.1;

let cmdSeq = 0;
let pendingInputs = [];
let lastAckedSeq = 0;
let wantsJump = false;
let serverVelY = 0;
let serverOnGround = true;

// Called from main.js on Space keydown.
export function requestJump() {
    wantsJump = true;
}

// Called at 60Hz from the game loop to capture current input and create a command.
export function captureInput(player, keys, camera) {
    cmdSeq = (cmdSeq + 1) & 0xFFFF;
    const cmd = {
        seq: cmdSeq,
        forward: !!keys.forward,
        backward: !!keys.backward,
        left: !!keys.left,
        right: !!keys.right,
        jump: wantsJump,
        crouch: !!player.crouching,
        aiming: !!player.aiming,
        yaw: camera.yaw,
        pitch: camera.pitch,
        weapon: player.activeWeapon,
    };
    wantsJump = false;
    pendingInputs.push(cmd);
    return cmd;
}

// Called when the server sends an input ack message.
export function onInputAck(seq, velY, onGround) {
    lastAckedSeq = seq;
    serverVelY = velY;
    serverOnGround = onGround;
}

// Reusable arrays/objects to avoid per-frame allocations.
const _reconPos = [0, 0, 0];
const _stepPos = [0, 0, 0];
const _stepResult = { pos: _stepPos, velY: 0, onGround: true };

// Called on state snapshot to reconcile the local player with the server.
export function reconcile(player, serverPos) {
    // Discard inputs the server has already processed (in-place filter).
    let writeIdx = 0;
    for (let i = 0; i < pendingInputs.length; i++) {
        if (seqAfter(pendingInputs[i].seq, lastAckedSeq)) {
            pendingInputs[writeIdx++] = pendingInputs[i];
        }
    }
    pendingInputs.length = writeIdx;

    // Start from server authoritative state (including physics state from inputAck).
    _reconPos[0] = serverPos[0]; _reconPos[1] = serverPos[1]; _reconPos[2] = serverPos[2];
    let velY = serverVelY;
    let onGround = serverOnGround;

    // Replay all pending (unacked) inputs with fixed dt matching the server.
    const dt = 1 / 60;
    for (const cmd of pendingInputs) {
        const result = predictStep(_reconPos, velY, onGround, cmd, dt);
        _reconPos[0] = result.pos[0];
        _reconPos[1] = result.pos[1];
        _reconPos[2] = result.pos[2];
        velY = result.velY;
        onGround = result.onGround;
    }

    // Snap to the reconciled position — this is the authoritative prediction.
    // Also update physics state so updatePlayer() continues from the correct state.
    player.pos[0] = _reconPos[0];
    player.pos[1] = _reconPos[1];
    player.pos[2] = _reconPos[2];
    player.vel[1] = velY;
    player.onGround = onGround;
}

// Reset prediction state (e.g., on respawn or match start).
export function resetPrediction() {
    pendingInputs = [];
    lastAckedSeq = 0;
    wantsJump = false;
    serverVelY = 0;
    serverOnGround = true;
}

// Shared prediction step — must produce identical results to server/movement.go simulateMovement().
export function predictStep(pos, velY, onGround, cmd, dt) {
    _stepPos[0] = pos[0]; _stepPos[1] = pos[1]; _stepPos[2] = pos[2];
    const outPos = _stepPos;

    // Forward/right from yaw (matches server/math.js).
    const fwd = forwardFromYaw(cmd.yaw);
    const right = rightFromYaw(cmd.yaw);

    const eyeHeight = cmd.crouch ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;

    // Accumulate movement direction.
    let mx = 0;
    let mz = 0;
    if (cmd.forward)  { mx += fwd[0]; mz += fwd[2]; }
    if (cmd.backward) { mx -= fwd[0]; mz -= fwd[2]; }
    if (cmd.left)     { mx -= right[0]; mz -= right[2]; }
    if (cmd.right)    { mx += right[0]; mz += right[2]; }

    // Normalize and scale by move speed.
    const mlen = Math.sqrt(mx * mx + mz * mz);
    if (mlen > 0) {
        const moveSpeed = getMoveSpeed({ activeWeapon: cmd.weapon, aiming: cmd.aiming });
        mx = (mx / mlen) * moveSpeed;
        mz = (mz / mlen) * moveSpeed;
    }

    // Apply horizontal movement.
    outPos[0] += mx * dt;
    outPos[2] += mz * dt;

    // Jump.
    if (cmd.jump && onGround) {
        velY = getJumpVelocity({ activeWeapon: cmd.weapon });
        onGround = false;
    }

    // Vertical physics.
    if (onGround) {
        outPos[1] = eyeHeight;
        velY = 0;
    } else {
        velY += GRAVITY * dt;
        outPos[1] += velY * dt;
        if (outPos[1] <= eyeHeight) {
            outPos[1] = eyeHeight;
            velY = 0;
            onGround = true;
        }
    }

    // Ceiling collision.
    if (outPos[1] > CEILING_Y) {
        outPos[1] = CEILING_Y;
        velY = 0;
        onGround = false;
    }

    // Wall / box collision (same implementation as server).
    collideWalls(outPos, PLAYER_RADIUS);

    // Arena bounds clamp.
    const limit = mapArena - 0.5;
    outPos[0] = Math.max(-limit, Math.min(limit, outPos[0]));
    outPos[2] = Math.max(-limit, Math.min(limit, outPos[2]));

    _stepResult.pos = _stepPos;
    _stepResult.velY = velY;
    _stepResult.onGround = onGround;
    return _stepResult;
}

// uint16 sequence comparison: returns true if a is "after" b (modular arithmetic).
function seqAfter(a, b) {
    return ((a - b) & 0xFFFF) > 0 && ((a - b) & 0xFFFF) < 0x8000;
}
