import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadMap } from './world.js';
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
    updatePlayer,
} from './player.js';
import { STARTING_CREDITS, UTILITY_BOMB, UTILITY_SMOKE, WEAPON_DEFS, WEAPON_KNIFE } from './economy.js';
import { TEAM_BLUE, TEAM_GREEN } from './teams.js';

const mapData = JSON.parse(readFileSync(new URL('../maps/office_studio.json', import.meta.url), 'utf8'));
const dust2Map = JSON.parse(readFileSync(new URL('../maps/de_dust2.json', import.meta.url), 'utf8'));
loadMap(mapData);

test('player starts with knife only and empty weapon slots', () => {
    const player = createPlayer();

    assert.equal(player.credits, STARTING_CREDITS);
    assert.equal(player.activeWeapon, WEAPON_KNIFE);
    assert.equal(player.pistolWeapon, '');
    assert.equal(player.heavyWeapon, '');
    assert.equal(player.pistolClip, 0);
    assert.equal(player.heavyClip, 0);
    assert.equal(canAttackWithWeapon(player, WEAPON_KNIFE), true);
});

test('respawn grants the side default pistol when the slot is empty', () => {
    const player = createPlayer();
    player.team = TEAM_GREEN;
    player.alive = false;
    player.hp = 0;

    respawn(player);

    assert.equal(player.alive, true);
    assert.equal(player.hp, 100);
    assert.equal(player.pistolWeapon, 'glock-18');
    assert.equal(player.pistolClip, WEAPON_DEFS['glock-18'].magSize);
});

test('respawn preserves an owned loadout instead of replacing it', () => {
    const player = createPlayer();
    player.team = TEAM_BLUE;
    player.pistolWeapon = 'usp-s';
    player.pistolClip = 6;
    player.pistolReserve = 18;
    player.heavyWeapon = 'm4a4';
    player.heavyClip = 24;
    player.heavyReserve = 60;
    player.activeWeapon = 'm4a4';

    respawn(player);

    assert.equal(player.pistolWeapon, 'usp-s');
    assert.equal(player.pistolClip, 6);
    assert.equal(player.heavyWeapon, 'm4a4');
    assert.equal(player.heavyClip, 24);
    assert.equal(player.activeWeapon, 'm4a4');
});

test('slot ammo is spent and reloaded against the equipped heavy weapon id', () => {
    const player = createPlayer();
    player.heavyWeapon = 'ak-47';
    player.heavyClip = 4;
    player.heavyReserve = 10;
    setActiveWeapon(player, 'ak-47');

    assert.equal(spendWeaponAmmo(player, 'ak-47'), true);
    assert.equal(player.heavyClip, 3);

    player.heavyClip = 0;
    assert.equal(spendWeaponAmmo(player, 'ak-47'), false);
    assert.equal(canReloadWeapon(player, 'ak-47'), true);
    assert.equal(reloadWeaponAmmo(player, 'ak-47'), true);
    assert.equal(player.heavyClip, 10);
    assert.equal(player.heavyReserve, 0);
});

test('match reset clears purchased slots and returns to knife', () => {
    const player = createPlayer();
    player.credits = 150;
    player.pistolWeapon = 'p250';
    player.pistolClip = 9;
    player.pistolReserve = 13;
    player.heavyWeapon = 'mac10';
    player.heavyClip = 25;
    player.heavyReserve = 60;
    player.activeWeapon = 'mac10';

    resetMatchState(player);

    assert.equal(player.credits, STARTING_CREDITS);
    assert.equal(player.pistolWeapon, '');
    assert.equal(player.heavyWeapon, '');
    assert.equal(player.pistolClip, 0);
    assert.equal(player.heavyClip, 0);
    assert.equal(player.activeWeapon, WEAPON_KNIFE);
});

test('authoritative state sync updates slot weapons, timers, and death state', () => {
    const player = createPlayer();

    applyAuthoritativeState(player, {
        hp: 0,
        armor: 18,
        credits: 725,
        kills: 3,
        deaths: 1,
        team: TEAM_BLUE,
        pistolWeapon: 'usp-s',
        pistolClip: 7,
        pistolReserve: 21,
        heavyWeapon: 'm4a4',
        heavyClip: 30,
        heavyReserve: 60,
        flashTimeLeftMs: 1200,
        spawnProtectionTimeLeftMs: 5000,
        loadoutTimeLeftMs: 7000,
        activeWeapon: 'usp-s',
        alive: false,
    });

    assert.equal(player.hp, 0);
    assert.equal(player.armor, 18);
    assert.equal(player.credits, 725);
    assert.equal(player.kills, 3);
    assert.equal(player.deaths, 1);
    assert.equal(player.team, TEAM_BLUE);
    assert.equal(player.pistolWeapon, 'usp-s');
    assert.equal(player.heavyWeapon, 'm4a4');
    assert.equal(player.pistolReserve, 21);
    assert.equal(player.heavyReserve, 60);
    assert.equal(player.flashTimeLeftMs, 1200);
    assert.equal(player.spawnProtectionTimeLeftMs, 0);
    assert.equal(player.loadoutTimeLeftMs, 0);
    assert.equal(player.activeWeapon, 'usp-s');
    assert.equal(player.alive, false);
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

test('movement is blocked during buy phase and intermission', () => {
    const player = createPlayer();

    assert.equal(canMove(player, { buyPhase: false }), true);
    assert.equal(canMove(player, { buyPhase: true }), false);
    assert.equal(canMove(player, { buyPhase: false, intermission: true }), false);

    player.alive = false;
    assert.equal(canMove(player, { buyPhase: false }), false);
});

test('movement uses the active map arena instead of a fixed studio-sized clamp', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { _cam: { yaw: Math.PI / 2 } };

    loadMap(dust2Map);
    const player = createPlayer();
    player.pos = [-29, 1.7, 35];
    player.onGround = true;

    updatePlayer(player, 0.3, {
        forward: true,
        backward: false,
        left: false,
        right: false,
    });

    assert.ok(player.pos[0] < -29.5);

    loadMap(mapData);
    globalThis.window = previousWindow;
});

test('weapon mobility follows the equipped weapon and scoped weapons slow further while aiming', () => {
    const player = createPlayer();
    const knifeMoveSpeed = getMoveSpeed(player);
    const knifeJump = getJumpVelocity(player);

    player.heavyWeapon = 'awp';
    setActiveWeapon(player, 'awp');
    const awpMoveSpeed = getMoveSpeed(player);
    const awpJump = getJumpVelocity(player);

    setAiming(player, true);
    const scopedMoveSpeed = getMoveSpeed(player);

    assert.ok(knifeMoveSpeed > awpMoveSpeed);
    assert.ok(knifeJump > awpJump);
    assert.ok(awpMoveSpeed > scopedMoveSpeed);
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

test('reloading blocks attacks until the timer clears', () => {
    const player = createPlayer();
    player.heavyWeapon = 'ak-47';
    player.heavyClip = 12;
    player.heavyReserve = 18;
    setActiveWeapon(player, 'ak-47');

    startReload(player, WEAPON_DEFS['ak-47'].reloadMs);
    assert.equal(canAttackWithWeapon(player, 'ak-47'), false);

    applyAuthoritativeState(player, { reloading: false, reloadTimeLeftMs: 0 });
    assert.equal(canAttackWithWeapon(player, 'ak-47'), true);
});
