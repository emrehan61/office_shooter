import { forwardFromYaw, rightFromYaw, clamp } from './math.js';
import { collideWalls, SPAWN_POINTS } from './world.js';

const SPEED = 10;
const JUMP_VEL = 7;
const GRAVITY = -20;
const PLAYER_RADIUS = 0.4;
const EYE_HEIGHT = 1.7;
export const MAX_AMMO = 250;

export function createPlayer() {
    return {
        pos: [...SPAWN_POINTS[0]],
        vel: [0, 0, 0],
        onGround: true,
        hp: 100,
        ammo: MAX_AMMO,
        alive: true,
        respawnTimer: 0,
    };
}

export function resetCombatState(player) {
    player.vel = [0, 0, 0];
    player.onGround = true;
    player.hp = 100;
    player.ammo = MAX_AMMO;
    player.alive = true;
    player.respawnTimer = 0;
}

export function updatePlayer(player, dt, keys) {
    if (!player.alive) {
        player.respawnTimer = Math.max(0, player.respawnTimer - dt);
        return;
    }

    const yaw = window._cam ? window._cam.yaw : 0;
    const fwd = forwardFromYaw(yaw);
    const right = rightFromYaw(yaw);

    let mx = 0, mz = 0;
    if (keys.forward)  { mx += fwd[0]; mz += fwd[2]; }
    if (keys.backward) { mx -= fwd[0]; mz -= fwd[2]; }
    if (keys.left)     { mx -= right[0]; mz -= right[2]; }
    if (keys.right)    { mx += right[0]; mz += right[2]; }

    // Normalize horizontal movement
    const mlen = Math.sqrt(mx * mx + mz * mz);
    if (mlen > 0) {
        mx = mx / mlen * SPEED;
        mz = mz / mlen * SPEED;
    }

    player.pos[0] += mx * dt;
    player.pos[2] += mz * dt;

    // Gravity
    player.vel[1] += GRAVITY * dt;
    player.pos[1] += player.vel[1] * dt;

    // Ground collision
    if (player.pos[1] <= EYE_HEIGHT) {
        player.pos[1] = EYE_HEIGHT;
        player.vel[1] = 0;
        player.onGround = true;
    } else {
        player.onGround = false;
    }

    // Ceiling
    if (player.pos[1] > 5 - 0.1) {
        player.pos[1] = 5 - 0.1;
        player.vel[1] = 0;
    }

    // Wall collision
    collideWalls(player.pos, PLAYER_RADIUS);

    // Keep in bounds
    player.pos[0] = clamp(player.pos[0], -29.5, 29.5);
    player.pos[2] = clamp(player.pos[2], -29.5, 29.5);
}

export function playerJump(player) {
    if (player.alive && player.onGround) {
        player.vel[1] = JUMP_VEL;
        player.onGround = false;
    }
}

export function playerTakeDamage(player, dmg) {
    player.hp -= dmg;
    if (player.hp <= 0) {
        player.alive = false;
        player.hp = 0;
        player.respawnTimer = 3;
    }
}

export function consumeAmmo(player, amount = 1) {
    if (player.ammo < amount) {
        return false;
    }

    player.ammo -= amount;
    return true;
}

export function addAmmo(player, amount = 1) {
    player.ammo = Math.min(MAX_AMMO, player.ammo + amount);
}

export function respawn(player) {
    const s = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    player.pos = [...s];
    resetCombatState(player);
}
