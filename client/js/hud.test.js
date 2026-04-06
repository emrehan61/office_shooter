import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLeaderboardRows, getMatchBarDisplay, getRoundResultDisplay, getShopItemState } from './hud.js';

test('leaderboard rows sort by kills descending then deaths ascending', () => {
    const rows = buildLeaderboardRows({
        1: { name: 'Alpha', kills: 4, deaths: 1, credits: 250 },
        2: { name: 'Bravo', kills: 4, deaths: 3, credits: 600 },
        3: { name: 'Charlie', kills: 2, deaths: 0, credits: 900 },
    }, 1);

    assert.deepEqual(rows.map((row) => row.name), ['Alpha', 'Bravo', 'Charlie']);
    assert.equal(rows[0].isSelf, true);
});

test('match bar shows deathmatch kills, deaths, rank, and player count', () => {
    assert.deepEqual(getMatchBarDisplay(
        { kills: 4, deaths: 2 },
        { mode: 'deathmatch' },
        {
            players: {
                1: { name: 'Alpha', kills: 4, deaths: 2, inMatch: true },
                2: { name: 'Bravo', kills: 6, deaths: 3, inMatch: true },
                3: { name: 'Charlie', kills: 4, deaths: 5, inMatch: true },
            },
            myId: 1,
        },
    ), {
        left: { name: 'KILLS', value: '4', meta: 'RANK #2' },
        right: { name: 'DEATHS', value: '2', meta: 'PLAYERS 3' },
    });
});

test('shop item state reflects equipped weapons, side gating, and utility stock', () => {
    const player = {
        team: 'green',
        pistolWeapon: 'glock-18',
        heavyWeapon: 'ak-47',
        bombs: 1,
        smokes: 0,
        flashbangs: 0,
        armor: 40,
    };

    assert.deepEqual(getShopItemState(player, 'ak-47'), { label: 'Equipped', canBuy: false });
    assert.deepEqual(getShopItemState(player, 'm4a4', player.team), { label: 'Wrong side', canBuy: false });
    assert.deepEqual(getShopItemState(player, 'p250', player.team), { label: 'Replace', canBuy: true });
    assert.deepEqual(getShopItemState(player, 'bomb'), { label: 'Stocked', canBuy: false });
    assert.deepEqual(getShopItemState(player, 'smoke'), { label: '0/1', canBuy: true });
    assert.deepEqual(getShopItemState(player, 'flashbang'), { label: '0/1', canBuy: true });
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

test('round result display shows the deathmatch replay vote countdown', () => {
    assert.deepEqual(getRoundResultDisplay({
        mode: 'deathmatch',
        deathmatchVoteActive: true,
        deathmatchVoteTimeLeftMs: 8000,
    }), {
        visible: true,
        title: 'PLAY AGAIN?',
        subtitle: 'NEXT MATCH VOTE ENDS IN 0:08',
    });
});
