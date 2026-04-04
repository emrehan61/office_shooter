import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyAuthoritativeState,
    canAttackWithWeapon,
    canOpenBuyMenu,
    canMove,
    canReloadWeapon,
    createPlayer,
    cycleActiveUtility,
    getJumpVelocity,
    getMoveSpeed,
    reloadWeaponAmmo,
    resetMatchState,
    respawn,
    setAiming,
    setActiveWeapon,
    startReload,
    spendWeaponAmmo,
} from './player.js';
import { RELOAD_DURATION_MS, STARTING_CREDITS, UTILITY_BOMB, UTILITY_SMOKE, WEAPON_KNIFE, WEAPON_MACHINE_GUN, WEAPON_PISTOL } from './economy.js';
import { TEAM_BLUE } from './teams.js';

test('player starts with knife only and no firearm ammo', () => {
    const player = createPlayer();

    assert.equal(player.credits, STARTING_CREDITS);
    assert.equal(player.activeWeapon, WEAPON_KNIFE);
    assert.equal(player.hasPistol, false);
    assert.equal(player.hasMachineGun, false);
    assert.equal(player.pistolClip, 0);
    assert.equal(player.pistolReserve, 0);
    assert.equal(player.machineGunClip, 0);
    assert.equal(player.machineGunReserve, 0);
    assert.equal(canAttackWithWeapon(player, WEAPON_KNIFE), true);
});

test('respawn restores life state but preserves bought loadout', () => {
    const player = createPlayer();
    player.hasPistol = true;
    player.pistolClip = 5;
    player.pistolReserve = 12;
    player.armor = 24;
    player.hp = 0;
    player.alive = false;

    respawn(player);

    assert.equal(player.pistolClip, 5);
    assert.equal(player.pistolReserve, 12);
    assert.equal(player.hp, 100);
    assert.equal(player.armor, 24);
    assert.equal(player.alive, true);
});

test('active firearm ammo uses clip ammo and can be reloaded locally', () => {
    const player = createPlayer();
    player.hasMachineGun = true;
    player.machineGunClip = 4;
    player.machineGunReserve = 10;
    setActiveWeapon(player, WEAPON_MACHINE_GUN);

    assert.equal(spendWeaponAmmo(player, WEAPON_MACHINE_GUN), true);
    assert.equal(player.machineGunClip, 3);
    player.machineGunClip = 0;
    assert.equal(spendWeaponAmmo(player, WEAPON_MACHINE_GUN), false);
    assert.equal(canReloadWeapon(player, WEAPON_MACHINE_GUN), true);
    assert.equal(reloadWeaponAmmo(player, WEAPON_MACHINE_GUN), true);
    assert.equal(player.machineGunClip, 10);
    assert.equal(player.machineGunReserve, 0);
});

test('match reset clears purchased weapons and returns to knife', () => {
    const player = createPlayer();
    player.credits = 150;
    player.hasPistol = true;
    player.hasMachineGun = true;
    player.pistolClip = 7;
    player.pistolReserve = 5;
    player.machineGunClip = 30;
    player.machineGunReserve = 25;
    player.activeWeapon = WEAPON_PISTOL;

    resetMatchState(player);

    assert.equal(player.credits, STARTING_CREDITS);
    assert.equal(player.hasPistol, false);
    assert.equal(player.hasMachineGun, false);
    assert.equal(player.pistolClip, 0);
    assert.equal(player.pistolReserve, 0);
    assert.equal(player.machineGunClip, 0);
    assert.equal(player.machineGunReserve, 0);
    assert.equal(player.activeWeapon, WEAPON_KNIFE);
});

test('authoritative state sync updates loadout and death state', () => {
    const player = createPlayer();

    applyAuthoritativeState(player, {
        hp: 0,
        armor: 18,
        credits: 725,
        kills: 3,
        deaths: 1,
        team: TEAM_BLUE,
        hasPistol: true,
        pistolClip: 7,
        pistolReserve: 14,
        flashTimeLeftMs: 1200,
        activeWeapon: WEAPON_PISTOL,
        alive: false,
    });

    assert.equal(player.hp, 0);
    assert.equal(player.armor, 18);
    assert.equal(player.credits, 725);
    assert.equal(player.kills, 3);
    assert.equal(player.deaths, 1);
    assert.equal(player.team, TEAM_BLUE);
    assert.equal(player.hasPistol, true);
    assert.equal(player.pistolClip, 7);
    assert.equal(player.pistolReserve, 14);
    assert.equal(player.flashTimeLeftMs, 1200);
    assert.equal(player.activeWeapon, WEAPON_PISTOL);
    assert.equal(player.alive, false);
    assert.equal(player.respawnTimer, 0);
});

test('authoritative state sync tracks deathmatch spawn and loadout timers', () => {
    const player = createPlayer();

    applyAuthoritativeState(player, {
        spawnProtectionTimeLeftMs: 5000,
        loadoutTimeLeftMs: 7000,
    });

    assert.equal(player.spawnProtectionTimeLeftMs, 5000);
    assert.equal(player.loadoutTimeLeftMs, 7000);
});

test('deathmatch loadout window allows the buy menu outside team buy phase', () => {
    const player = createPlayer();

    assert.equal(canOpenBuyMenu(player, { mode: 'deathmatch', buyPhase: false }), false);

    applyAuthoritativeState(player, {
        loadoutTimeLeftMs: 7000,
    });

    assert.equal(canOpenBuyMenu(player, { mode: 'deathmatch', buyPhase: false }), true);

    applyAuthoritativeState(player, {
        alive: false,
    });

    assert.equal(canOpenBuyMenu(player, { mode: 'deathmatch', buyPhase: false }), false);
});

test('movement is blocked during buy phase', () => {
    const player = createPlayer();

    assert.equal(canMove(player, { buyPhase: false }), true);
    assert.equal(canMove(player, { buyPhase: true }), false);
    assert.equal(canMove(player, { buyPhase: false, intermission: true }), false);

    player.alive = false;
    assert.equal(canMove(player, { buyPhase: false }), false);
});

test('weapon mobility changes movement speed and jump power', () => {
    const player = createPlayer();

    assert.equal(getMoveSpeed(player), 12.5);
    assert.equal(getJumpVelocity(player), 8.75);

    player.hasPistol = true;
    setActiveWeapon(player, WEAPON_PISTOL);
    assert.equal(getMoveSpeed(player), 10);
    assert.equal(getJumpVelocity(player), 7);
    setAiming(player, true);
    assert.ok(Math.abs(getMoveSpeed(player) - 7.8) < 1e-9);
    assert.equal(getJumpVelocity(player), 7);

    player.hasMachineGun = true;
    setActiveWeapon(player, WEAPON_MACHINE_GUN);
    assert.equal(getMoveSpeed(player), 4.125);
    assert.equal(getJumpVelocity(player), 5.25);
    setAiming(player, false);
    assert.equal(getMoveSpeed(player), 7.5);
});

test('utility slot cycles through owned grenades only', () => {
    const player = createPlayer();

    assert.equal(cycleActiveUtility(player), null);

    player.bombs = 1;
    player.smokes = 1;

    assert.equal(cycleActiveUtility(player), UTILITY_BOMB);
    assert.equal(player.activeWeapon, UTILITY_BOMB);
    assert.equal(cycleActiveUtility(player), UTILITY_SMOKE);
    assert.equal(player.activeWeapon, UTILITY_SMOKE);
    assert.equal(cycleActiveUtility(player), UTILITY_BOMB);
});

test('reloading blocks weapon attacks until the timer clears', () => {
    const player = createPlayer();
    player.hasMachineGun = true;
    player.machineGunClip = 12;
    player.machineGunReserve = 18;
    setActiveWeapon(player, WEAPON_MACHINE_GUN);

    startReload(player, RELOAD_DURATION_MS);
    assert.equal(canAttackWithWeapon(player, WEAPON_MACHINE_GUN), false);

    applyAuthoritativeState(player, { reloading: false, reloadTimeLeftMs: 0 });
    assert.equal(canAttackWithWeapon(player, WEAPON_MACHINE_GUN), true);
});
