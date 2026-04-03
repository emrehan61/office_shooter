import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLeaderboardRows } from './hud.js';

test('leaderboard rows sort by kills descending then deaths ascending', () => {
    const rows = buildLeaderboardRows({
        1: { name: 'Alpha', kills: 4, deaths: 1 },
        2: { name: 'Bravo', kills: 4, deaths: 3 },
        3: { name: 'Charlie', kills: 2, deaths: 0 },
    }, 1);

    assert.deepEqual(rows.map((row) => row.name), ['Alpha', 'Bravo', 'Charlie']);
    assert.equal(rows[0].isSelf, true);
    assert.equal(rows[0].kills, 4);
    assert.equal(rows[0].deaths, 1);
});
