import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLeaderboardRows, getRoundResultDisplay, getShopItemState } from './hud.js';

test('leaderboard rows sort by kills descending then deaths ascending', () => {
    const rows = buildLeaderboardRows({
        1: { name: 'Alpha', kills: 4, deaths: 1, credits: 250 },
        2: { name: 'Bravo', kills: 4, deaths: 3, credits: 600 },
        3: { name: 'Charlie', kills: 2, deaths: 0, credits: 900 },
    }, 1);

    assert.deepEqual(rows.map((row) => row.name), ['Alpha', 'Bravo', 'Charlie']);
    assert.equal(rows[0].isSelf, true);
    assert.equal(rows[0].kills, 4);
    assert.equal(rows[0].deaths, 1);
    assert.equal(rows[0].credits, 250);
});

test('shop item state reflects ownership, ammo gates, and grenade stock', () => {
    const player = {
        hasMachineGun: true,
        hasPistol: false,
        machineGunClip: 30,
        machineGunReserve: 30,
        pistolClip: 0,
        pistolReserve: 0,
        bombs: 1,
        smokes: 0,
        flashbangs: 0,
        armor: 40,
    };

    assert.deepEqual(getShopItemState(player, 'buy-machinegun'), { label: 'Owned', canBuy: false });
    assert.deepEqual(getShopItemState(player, 'machinegun-ammo'), { label: '30/90', canBuy: true });
    assert.deepEqual(getShopItemState(player, 'pistol-ammo'), { label: 'Need Pistol', canBuy: false });
    assert.deepEqual(getShopItemState(player, 'bomb'), { label: 'Stocked', canBuy: false });
    assert.deepEqual(getShopItemState(player, 'armor'), { label: '40/100', canBuy: true });
});

test('round result display shows winner and cooldown text', () => {
    assert.deepEqual(getRoundResultDisplay({
        intermission: true,
        intermissionTimeLeftMs: 5000,
        roundWinner: 'blue',
        currentRound: 2,
        totalRounds: 30,
    }), {
        visible: true,
        title: 'BLUE TEAM WINS',
        subtitle: 'NEXT ROUND IN 0:05',
    });

    assert.deepEqual(getRoundResultDisplay({
        intermission: true,
        intermissionTimeLeftMs: 5000,
        roundWinner: '',
        currentRound: 30,
        totalRounds: 30,
    }), {
        visible: true,
        title: 'ROUND OVER',
        subtitle: 'MATCH ENDS IN 0:05',
    });
});
