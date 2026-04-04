import { forwardFromYaw, rightFromYaw, clamp } from './math.js';
import { collideWalls, SPAWN_POINTS } from './world.js';
import {
    GRENADE_MAX,
    MACHINE_GUN_AMMO_MAX,
    MACHINE_GUN_MAG_SIZE,
    MAX_ARMOR,
    PISTOL_AMMO_MAX,
    PISTOL_MAG_SIZE,
    STARTING_CREDITS,
    UTILITY_IDS,
    WEAPON_DEFS,
    WEAPON_KNIFE,
    WEAPON_MACHINE_GUN,
    WEAPON_PISTOL,
    canAimWeapon,
    isUtilityWeapon,
} from './economy.js';
import { MODE_DEATHMATCH } from './modes.js';
import { TEAM_NONE, normalizeTeam } from './teams.js';

const BASE_SPEED = 10;
const BASE_JUMP_VEL = 7;
const GRAVITY = -20;
const PLAYER_RADIUS = 0.4;
export const STAND_EYE_HEIGHT = 1.7;
export const CROUCH_EYE_HEIGHT = 1.15;

export const MAX_HP = 100;
export { MAX_ARMOR, STARTING_CREDITS };

export function createPlayer() {
    return {
        pos: [...SPAWN_POINTS[0]],
        vel: [0, 0, 0],
        onGround: true,
        hp: MAX_HP,
        armor: 0,
        credits: STARTING_CREDITS,
        hasPistol: false,
        hasMachineGun: false,
        pistolClip: 0,
        pistolReserve: 0,
        machineGunClip: 0,
        machineGunReserve: 0,
        bombs: 0,
        smokes: 0,
        flashbangs: 0,
        flashTimeLeftMs: 0,
        spawnProtectionTimeLeftMs: 0,
        loadoutTimeLeftMs: 0,
        team: TEAM_NONE,
        inMatch: true,
        isBot: false,
        kills: 0,
        deaths: 0,
        activeWeapon: WEAPON_KNIFE,
        aiming: false,
        reloading: false,
        reloadTimeLeftMs: 0,
        crouching: false,
        alive: true,
        respawnTimer: 0,
    };
}

export function resetMatchState(player) {
    player.credits = STARTING_CREDITS;
    player.armor = 0;
    player.hasPistol = false;
    player.hasMachineGun = false;
    player.pistolClip = 0;
    player.pistolReserve = 0;
    player.machineGunClip = 0;
    player.machineGunReserve = 0;
    player.bombs = 0;
    player.smokes = 0;
    player.flashbangs = 0;
    player.spawnProtectionTimeLeftMs = 0;
    player.loadoutTimeLeftMs = 0;
    player.activeWeapon = WEAPON_KNIFE;
    resetCombatState(player);
}

export function resetCombatState(player) {
    player.vel = [0, 0, 0];
    player.onGround = true;
    player.hp = MAX_HP;
    player.reloading = false;
    player.reloadTimeLeftMs = 0;
    player.flashTimeLeftMs = 0;
    player.spawnProtectionTimeLeftMs = 0;
    player.loadoutTimeLeftMs = 0;
    player.aiming = false;
    player.crouching = false;
    player.alive = true;
    player.respawnTimer = 0;
}

export function applyAuthoritativeState(player, state) {
    if (!state) return;

    if (state.pos) player.pos = [...state.pos];
    if (typeof state.hp === 'number') player.hp = clamp(state.hp, 0, MAX_HP);
    if (typeof state.armor === 'number') player.armor = clamp(state.armor, 0, MAX_ARMOR);
    if (typeof state.credits === 'number') player.credits = Math.max(0, state.credits);
    if (typeof state.kills === 'number') player.kills = Math.max(0, state.kills);
    if (typeof state.deaths === 'number') player.deaths = Math.max(0, state.deaths);
    if (typeof state.hasPistol === 'boolean') player.hasPistol = state.hasPistol;
    if (typeof state.hasMachineGun === 'boolean') player.hasMachineGun = state.hasMachineGun;
    if (typeof state.pistolClip === 'number') player.pistolClip = clampAmmo(state.pistolClip, PISTOL_MAG_SIZE);
    if (typeof state.pistolReserve === 'number') player.pistolReserve = clampAmmo(state.pistolReserve, PISTOL_AMMO_MAX);
    if (typeof state.machineGunClip === 'number') player.machineGunClip = clampAmmo(state.machineGunClip, MACHINE_GUN_MAG_SIZE);
    if (typeof state.machineGunReserve === 'number') player.machineGunReserve = clampAmmo(state.machineGunReserve, MACHINE_GUN_AMMO_MAX);
    if (typeof state.bombs === 'number') player.bombs = clampInventory(state.bombs, GRENADE_MAX);
    if (typeof state.smokes === 'number') player.smokes = clampInventory(state.smokes, GRENADE_MAX);
    if (typeof state.flashbangs === 'number') player.flashbangs = clampInventory(state.flashbangs, GRENADE_MAX);
    if (typeof state.flashTimeLeftMs === 'number') player.flashTimeLeftMs = Math.max(0, state.flashTimeLeftMs);
    if (typeof state.spawnProtectionTimeLeftMs === 'number') player.spawnProtectionTimeLeftMs = Math.max(0, state.spawnProtectionTimeLeftMs);
    if (typeof state.loadoutTimeLeftMs === 'number') player.loadoutTimeLeftMs = Math.max(0, state.loadoutTimeLeftMs);
    if (typeof state.team === 'string') player.team = normalizeTeam(state.team);
    if (typeof state.inMatch === 'boolean') player.inMatch = state.inMatch;
    if (typeof state.isBot === 'boolean') player.isBot = state.isBot;
    if (typeof state.reloadTimeLeftMs === 'number') {
        player.reloadTimeLeftMs = Math.max(0, state.reloadTimeLeftMs);
        player.reloading = player.reloadTimeLeftMs > 0;
    } else if (typeof state.reloading === 'boolean') {
        player.reloading = state.reloading;
        if (!state.reloading) {
            player.reloadTimeLeftMs = 0;
        }
    }
    normalizeAmmoTotals(player);
    if (typeof state.activeWeapon === 'string') player.activeWeapon = normalizeWeaponForPlayer(player, state.activeWeapon);
    if (typeof state.crouching === 'boolean') player.crouching = state.crouching;

    if (typeof state.alive === 'boolean') {
        if (!state.alive && player.alive) {
            player.respawnTimer = 0;
        }
        if (state.alive) {
            player.respawnTimer = 0;
        } else {
            player.spawnProtectionTimeLeftMs = 0;
            player.loadoutTimeLeftMs = 0;
        }
        player.alive = state.alive;
    }

    player.activeWeapon = normalizeWeaponForPlayer(player, player.activeWeapon);
    if (!canAimWeapon(player.activeWeapon) || !player.alive) {
        player.aiming = false;
    }
}

export function updatePlayer(player, dt, keys, movementEnabled = true) {
    if (!player.alive) {
        player.respawnTimer = Math.max(0, player.respawnTimer - dt);
        return;
    }

    const yaw = window._cam ? window._cam.yaw : 0;
    const fwd = forwardFromYaw(yaw);
    const right = rightFromYaw(yaw);
    const targetEyeHeight = getEyeHeight(player);
    const moveSpeed = getMoveSpeed(player);

    let mx = 0;
    let mz = 0;
    if (movementEnabled) {
        if (keys.forward) { mx += fwd[0]; mz += fwd[2]; }
        if (keys.backward) { mx -= fwd[0]; mz -= fwd[2]; }
        if (keys.left) { mx -= right[0]; mz -= right[2]; }
        if (keys.right) { mx += right[0]; mz += right[2]; }
    }

    const mlen = Math.sqrt(mx * mx + mz * mz);
    if (mlen > 0) {
        mx = mx / mlen * moveSpeed;
        mz = mz / mlen * moveSpeed;
    }

    player.pos[0] += mx * dt;
    player.pos[2] += mz * dt;

    if (player.onGround) {
        player.pos[1] = targetEyeHeight;
        player.vel[1] = 0;
    } else {
        player.vel[1] += GRAVITY * dt;
        player.pos[1] += player.vel[1] * dt;
        if (player.pos[1] <= targetEyeHeight) {
            player.pos[1] = targetEyeHeight;
            player.vel[1] = 0;
            player.onGround = true;
        }
    }

    if (player.pos[1] > 5 - 0.1) {
        player.pos[1] = 5 - 0.1;
        player.vel[1] = 0;
        player.onGround = false;
    }

    collideWalls(player.pos, PLAYER_RADIUS);

    player.pos[0] = clamp(player.pos[0], -29.5, 29.5);
    player.pos[2] = clamp(player.pos[2], -29.5, 29.5);
}

export function playerJump(player) {
    if (player.alive && player.onGround) {
        player.vel[1] = getJumpVelocity(player);
        player.onGround = false;
    }
}

export function canMove(player, match = {}) {
    return player.alive && !match.buyPhase && !match.intermission;
}

export function hasSpawnProtection(player, match = {}) {
    return match.mode === MODE_DEATHMATCH && player.alive && (player.spawnProtectionTimeLeftMs || 0) > 0;
}

export function canOpenBuyMenu(player, match = {}) {
    if (!player.alive) return false;
    if (match.buyPhase) return true;
    return match.mode === MODE_DEATHMATCH && (player.loadoutTimeLeftMs || 0) > 0;
}

export function getMoveSpeed(player) {
    const mobility = getWeaponMobility(player.activeWeapon);
    const aimMultiplier = player.aiming && mobility.canAim ? mobility.adsMoveSpeedMultiplier : 1;
    return BASE_SPEED * mobility.moveSpeedMultiplier * aimMultiplier;
}

export function getJumpVelocity(player) {
    return BASE_JUMP_VEL * getWeaponMobility(player.activeWeapon).jumpMultiplier;
}

export function getEyeHeight(player) {
    return player.crouching ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
}

export function setAiming(player, aiming) {
    player.aiming = !!aiming && player.alive && canAimWeapon(player.activeWeapon);
}

export function hasWeapon(player, weaponId) {
    if (weaponId === WEAPON_KNIFE) return true;
    if (weaponId === WEAPON_PISTOL) return !!player.hasPistol;
    if (weaponId === WEAPON_MACHINE_GUN) return !!player.hasMachineGun;
    if (isUtilityWeapon(weaponId)) return getUtilityCount(player, weaponId) > 0;
    return false;
}

export function getWeaponAmmoState(player, weaponId = player.activeWeapon) {
    if (weaponId === WEAPON_PISTOL) {
        return {
            clip: player.pistolClip,
            reserve: player.pistolReserve,
            clipSize: PISTOL_MAG_SIZE,
            reserveMax: PISTOL_AMMO_MAX,
        };
    }
    if (weaponId === WEAPON_MACHINE_GUN) {
        return {
            clip: player.machineGunClip,
            reserve: player.machineGunReserve,
            clipSize: MACHINE_GUN_MAG_SIZE,
            reserveMax: MACHINE_GUN_AMMO_MAX,
        };
    }
    return null;
}

export function getWeaponTotalAmmo(player, weaponId = player.activeWeapon) {
    const ammo = getWeaponAmmoState(player, weaponId);
    return ammo ? ammo.clip + ammo.reserve : 0;
}

export function getUtilityCount(player, weaponId) {
    if (weaponId === 'bomb') return player.bombs;
    if (weaponId === 'smoke') return player.smokes;
    if (weaponId === 'flashbang') return player.flashbangs;
    return 0;
}

export function canAttackWithWeapon(player, weaponId = player.activeWeapon) {
    if (player.reloading) return false;
    if (!hasWeapon(player, weaponId)) return false;
    if (weaponId === WEAPON_KNIFE) return true;
    if (isUtilityWeapon(weaponId)) return getUtilityCount(player, weaponId) > 0;
    const ammo = getWeaponAmmoState(player, weaponId);
    return !!ammo && ammo.clip > 0;
}

export function spendWeaponAmmo(player, weaponId = player.activeWeapon, amount = 1) {
    if (weaponId === WEAPON_PISTOL) {
        if (player.pistolClip < amount) return false;
        player.pistolClip -= amount;
        return true;
    }

    if (weaponId === WEAPON_MACHINE_GUN) {
        if (player.machineGunClip < amount) return false;
        player.machineGunClip -= amount;
        return true;
    }

    return weaponId === WEAPON_KNIFE;
}

export function canReloadWeapon(player, weaponId = player.activeWeapon) {
    if (player.reloading) return false;
    const ammo = getWeaponAmmoState(player, weaponId);
    return !!ammo && ammo.reserve > 0 && ammo.clip < ammo.clipSize;
}

export function startReload(player, durationMs) {
    player.reloading = true;
    player.reloadTimeLeftMs = Math.max(0, durationMs);
}

export function reloadWeaponAmmo(player, weaponId = player.activeWeapon) {
    const ammo = getWeaponAmmoState(player, weaponId);
    if (!ammo || ammo.reserve <= 0 || ammo.clip >= ammo.clipSize) {
        return false;
    }

    const needed = ammo.clipSize - ammo.clip;
    const transferred = Math.min(needed, ammo.reserve);

    if (weaponId === WEAPON_PISTOL) {
        player.pistolClip += transferred;
        player.pistolReserve -= transferred;
        return transferred > 0;
    }

    if (weaponId === WEAPON_MACHINE_GUN) {
        player.machineGunClip += transferred;
        player.machineGunReserve -= transferred;
        return transferred > 0;
    }

    return false;
}

export function cycleActiveUtility(player) {
    const owned = getOwnedUtilities(player);
    if (owned.length === 0) {
        return null;
    }

    const currentIndex = owned.indexOf(player.activeWeapon);
    const nextWeapon = owned[(currentIndex + 1 + owned.length) % owned.length] || owned[0];
    player.activeWeapon = nextWeapon;
    return nextWeapon;
}

export function setActiveWeapon(player, weaponId) {
    player.activeWeapon = normalizeWeaponForPlayer(player, weaponId);
    if (!canAimWeapon(player.activeWeapon)) {
        player.aiming = false;
    }
}

export function respawn(player) {
    const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    player.pos = [...spawn];
    resetCombatState(player);
}

function normalizeWeaponForPlayer(player, weaponId) {
    if (weaponId === WEAPON_MACHINE_GUN && player.hasMachineGun) return weaponId;
    if (weaponId === WEAPON_PISTOL && player.hasPistol) return weaponId;
    if (isUtilityWeapon(weaponId) && getUtilityCount(player, weaponId) > 0) return weaponId;
    return WEAPON_KNIFE;
}

function getWeaponMobility(weaponId) {
    return WEAPON_DEFS[weaponId] || WEAPON_DEFS[WEAPON_KNIFE];
}

function clampInventory(count, maxCount) {
    return clamp(count, 0, maxCount);
}

function clampAmmo(count, maxCount) {
    return clamp(count, 0, maxCount);
}

function getOwnedUtilities(player) {
    return UTILITY_IDS.filter((utilityId) => getUtilityCount(player, utilityId) > 0);
}

function normalizeAmmoTotals(player) {
    player.pistolClip = clamp(player.pistolClip, 0, PISTOL_MAG_SIZE);
    player.machineGunClip = clamp(player.machineGunClip, 0, MACHINE_GUN_MAG_SIZE);
    player.pistolReserve = clamp(player.pistolReserve, 0, PISTOL_AMMO_MAX);
    player.machineGunReserve = clamp(player.machineGunReserve, 0, MACHINE_GUN_AMMO_MAX);
    if (player.reloadTimeLeftMs <= 0) {
        player.reloadTimeLeftMs = 0;
        player.reloading = false;
    }
}
