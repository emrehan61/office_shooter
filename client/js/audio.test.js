import test from 'node:test';
import assert from 'node:assert/strict';

import { createKillAnnouncerState, getAnnouncerKillCues, getAnnouncerMatchCues, snapshotMatchForAnnouncer } from './audio.js';

function matchState(overrides = {}) {
    return snapshotMatchForAnnouncer({
        buyPhase: false,
        buyTimeLeftMs: 0,
        intermission: false,
        roundWinner: '',
        ...overrides,
    });
}

test('initial announcer snapshot stays quiet', () => {
    assert.deepEqual(getAnnouncerMatchCues(null, matchState({ buyPhase: true, buyTimeLeftMs: 2500 })), []);
});

test('announcer emits the combined countdown cue when buy time reaches three seconds', () => {
    assert.deepEqual(
        getAnnouncerMatchCues(
            matchState({ buyPhase: true, buyTimeLeftMs: 4100 }),
            matchState({ buyPhase: true, buyTimeLeftMs: 2900 })
        ),
        ['countdown']
    );

    assert.deepEqual(
        getAnnouncerMatchCues(
            matchState({ buyPhase: true, buyTimeLeftMs: 900 }),
            matchState({ buyPhase: true, buyTimeLeftMs: 850 })
        ),
        []
    );
});

test('announcer fires lock and load when buy phase ends', () => {
    assert.deepEqual(
        getAnnouncerMatchCues(
            matchState({ buyPhase: true, buyTimeLeftMs: 400 }),
            matchState({ buyPhase: false, buyTimeLeftMs: 0, intermission: false })
        ),
        ['lockAndLoad']
    );
});

test('announcer uses local team outcome when intermission begins', () => {
    assert.deepEqual(
        getAnnouncerMatchCues(
            matchState(),
            matchState({ intermission: true, roundWinner: 'blue' }),
            { myTeam: 'blue' }
        ),
        ['youWin']
    );

    assert.deepEqual(
        getAnnouncerMatchCues(
            matchState(),
            matchState({ intermission: true, roundWinner: 'green' }),
            { myTeam: 'blue' }
        ),
        ['youLose']
    );
});

test('announcer emits kill cues for first blood, local kills, and local deaths', () => {
    const initialState = createKillAnnouncerState(1);

    const firstKill = getAnnouncerKillCues(initialState, { killer: 7, victim: 3 }, 7);
    assert.deepEqual(firstKill.cues, ['firstBlood']);

    const secondKill = getAnnouncerKillCues(firstKill.state, { killer: 8, victim: 7 }, 7);
    assert.deepEqual(secondKill.cues, ['elimination']);
    assert.equal(secondKill.state.firstBloodPlayed, true);

    const thirdKill = getAnnouncerKillCues(secondKill.state, { killer: 7, victim: 8 }, 7);
    assert.deepEqual(thirdKill.cues, ['killConfirmed']);
});

test('announcer falls back to game over when the final round ends without a winner id', () => {
    assert.deepEqual(
        getAnnouncerMatchCues(
            matchState({ currentRound: 30, totalRounds: 30 }),
            matchState({ currentRound: 30, totalRounds: 30, intermission: true, roundWinner: '' })
        ),
        ['gameOver']
    );
});
