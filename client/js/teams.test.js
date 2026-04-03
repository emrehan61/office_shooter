import test from 'node:test';
import assert from 'node:assert/strict';

import { TEAM_BLUE, TEAM_GREEN, canSelectTeam, getTeamCounts, getTeamStartState } from './teams.js';

test('team counts separate blue green and unassigned players', () => {
    const counts = getTeamCounts({
        1: { team: TEAM_BLUE },
        2: { team: TEAM_GREEN },
        3: { team: TEAM_BLUE },
        4: { team: '' },
    });

    assert.deepEqual(counts, { blue: 2, green: 1, unassigned: 1 });
});

test('team selection prevents making one side larger by more than one player', () => {
    const players = {
        1: { team: TEAM_BLUE },
        2: { team: TEAM_GREEN },
        3: { team: TEAM_BLUE },
    };

    assert.equal(canSelectTeam(players, 2, TEAM_GREEN), true);
    assert.equal(canSelectTeam(players, 2, TEAM_BLUE), false);
    assert.equal(canSelectTeam(players, 3, TEAM_GREEN), true);
});

test('team start state requires full balanced assignments', () => {
    assert.deepEqual(getTeamStartState({
        1: { team: TEAM_BLUE },
    }), { ok: false, reason: 'Need at least 2 players' });

    assert.deepEqual(getTeamStartState({
        1: { team: TEAM_BLUE },
        2: { team: '' },
    }), { ok: false, reason: 'All players must join a team' });

    assert.deepEqual(getTeamStartState({
        1: { team: TEAM_BLUE },
        2: { team: TEAM_BLUE },
        3: { team: TEAM_GREEN },
        4: { team: TEAM_GREEN },
    }), { ok: true, reason: '' });
});
