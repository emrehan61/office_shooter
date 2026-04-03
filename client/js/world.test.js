import test from 'node:test';
import assert from 'node:assert/strict';

import { traceShotImpact } from './world.js';

test('traceShotImpact hits blocking world geometry', () => {
    const impact = traceShotImpact([0, 1.7, 5], [0, 0, -1], {}, null, 50);

    assert.ok(Math.abs(impact[0]) < 1e-6);
    assert.ok(Math.abs(impact[1] - 1.7) < 1e-6);
    assert.ok(Math.abs(impact[2] - 2.3) < 0.05);
});

test('traceShotImpact resolves nearby player hits before distant walls', () => {
    const impact = traceShotImpact(
        [20, 1.7, 5],
        [0, 0, -1],
        {
            2: {
                pos: [20, 1.7, 0],
                crouching: false,
                alive: true,
            },
        },
        1,
        50
    );

    assert.ok(Math.abs(impact[0] - 20) < 1e-6);
    assert.ok(impact[2] < 0.5);
    assert.ok(impact[2] > -0.5);
});
