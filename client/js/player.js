import { clamp, forwardFromYaw, rightFromYaw } from './math.js';
import { collideWalls, getSpawnPoints } from './world.js';
import {
    GRENADE_MAX,
    MAX_ARMOR,
    STARTING_CREDITS,
    UTILITY_IDS,
    WEAPON_DEFS,
    WEAPON_KNIFE,
    canAimWeapon,
    getDefaultPistolForTeam,
    isHeavyWeapon,
    isPistolWeapon,
    isUtilityWeapon,
} from './economy.js';
import { MODE_DEATHMATCH } from './modes.js';
import { TEAM_NONE, normalizeTeam } from './teams.js';

const BASE_SPEED = 10;
const BASE_JUMP_VEL = 7;
const GRAVITY = -20;
export const PLAYER_RADIUS = 0.4;
export const STAND_EYE_HEIGHT = 1.7;
export const CROUCH_EYE_HEIGHT = 1.15;

export const MAX_HP = 100;
export { MAX_ARMOR, STARTING_CREDITS };

export function createPlayer() {
    return {
        pos: [...(getSpawnPoints()[0] || [0, 1.7, 0])],
        vel: [0, 0, 0],
        onGround: true,
        hp: MAX_HP,
        armor: 0,
        credits: STARTING_CREDITS,
        pistolWeapon: '',
        pistolClip: 0,
        pistolReserve: 0,
        heavyWeapon: '',
        heavyClip: 0,
        heavyReserve: 0,
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
    player.pistolWeapon = '';
    player.pistolClip = 0;
    player.pistolReserve = 0;
    player.heavyWeapon = '';
    player.heavyClip = 0;
    player.heavyReserve = 0;
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

    if (state.pos) { player.pos[0] = state.pos[0]; player.pos[1] = state.pos[1]; player.pos[2] = state.pos[2]; }
    if (typeof state.hp === 'number') player.hp = clamp(state.hp, 0, MAX_HP);
    if (typeof state.armor === 'number') player.armor = clamp(state.armor, 0, MAX_ARMOR);
    if (typeof state.credits === 'number') player.credits = Math.max(0, state.credits);
    if (typeof state.kills === 'number') player.kills = Math.max(0, state.kills);
    if (typeof state.deaths === 'number') player.deaths = Math.max(0, state.deaths);
    if (typeof state.pistolWeapon === 'string') player.pistolWeapon = state.pistolWeapon;
    if (typeof state.heavyWeapon === 'string') player.heavyWeapon = state.heavyWeapon;
    if (typeof state.pistolClip === 'number') player.pistolClip = clampAmmo(state.pistolClip, getClipSize(player.pistolWeapon));
    if (typeof state.pistolReserve === 'number') player.pistolReserve = clampAmmo(state.pistolReserve, getReserveMax(player.pistolWeapon));
    if (typeof state.heavyClip === 'number') player.heavyClip = clampAmmo(state.heavyClip, getClipSize(player.heavyWeapon));
    if (typeof state.heavyReserve === 'number') player.heavyReserve = clampAmmo(state.heavyReserve, getReserveMax(player.heavyWeapon));
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
    if (weaponId && player.pistolWeapon === weaponId) return true;
    if (weaponId && player.heavyWeapon === weaponId) return true;
    if (isUtilityWeapon(weaponId)) return getUtilityCount(player, weaponId) > 0;
    return false;
}

export function getWeaponAmmoState(player, weaponId = player.activeWeapon) {
    if (weaponId && player.pistolWeapon === weaponId) {
        return {
            clip: player.pistolClip,
            reserve: player.pistolReserve,
            clipSize: getClipSize(weaponId),
            reserveMax: getReserveMax(weaponId),
        };
    }
    if (weaponId && player.heavyWeapon === weaponId) {
        return {
            clip: player.heavyClip,
            reserve: player.heavyReserve,
            clipSize: getClipSize(weaponId),
            reserveMax: getReserveMax(weaponId),
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
    if (weaponId && player.pistolWeapon === weaponId) {
        if (player.pistolClip < amount) return false;
        player.pistolClip -= amount;
        return true;
    }
    if (weaponId && player.heavyWeapon === weaponId) {
        if (player.heavyClip < amount) return false;
        player.heavyClip -= amount;
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

    if (weaponId && player.pistolWeapon === weaponId) {
        player.pistolClip += transferred;
        player.pistolReserve -= transferred;
        return transferred > 0;
    }
    if (weaponId && player.heavyWeapon === weaponId) {
        player.heavyClip += transferred;
        player.heavyReserve -= transferred;
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
    const spawns = getSpawnPoints();
    const spawn = spawns[Math.floor(Math.random() * spawns.length)];
    player.pos = [...spawn];
    resetCombatState(player);
    if (!player.pistolWeapon) {
        player.pistolWeapon = getDefaultPistolForTeam(player.team);
        player.pistolClip = getClipSize(player.pistolWeapon);
        player.pistolReserve = 0;
    }
    player.activeWeapon = normalizeWeaponForPlayer(player, player.activeWeapon);
}

function normalizeWeaponForPlayer(player, weaponId) {
    if (weaponId && player.heavyWeapon === weaponId) return weaponId;
    if (weaponId && player.pistolWeapon === weaponId) return weaponId;
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
    return clamp(count, 0, Math.max(0, maxCount || 0));
}

function getOwnedUtilities(player) {
    return UTILITY_IDS.filter((utilityId) => getUtilityCount(player, utilityId) > 0);
}

function normalizeAmmoTotals(player) {
    player.pistolClip = clamp(player.pistolClip, 0, getClipSize(player.pistolWeapon));
    player.heavyClip = clamp(player.heavyClip, 0, getClipSize(player.heavyWeapon));
    player.pistolReserve = clamp(player.pistolReserve, 0, getReserveMax(player.pistolWeapon));
    player.heavyReserve = clamp(player.heavyReserve, 0, getReserveMax(player.heavyWeapon));
    if (player.reloadTimeLeftMs <= 0) {
        player.reloadTimeLeftMs = 0;
        player.reloading = false;
    }
}

function getClipSize(weaponId) {
    return WEAPON_DEFS[weaponId]?.magSize || 0;
}

function getReserveMax(weaponId) {
    return WEAPON_DEFS[weaponId]?.reserveMax || 0;
}

export function getOwnedPistol(player) {
    return player.pistolWeapon;
}

export function getOwnedHeavy(player) {
    return player.heavyWeapon;
}

