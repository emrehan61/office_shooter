import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getHealthRestorePoints, getPuddles, getSkyConfig, shouldBuildCeiling, traceShotImpact, loadMap } from './world.js';

const mapData = JSON.parse(readFileSync(new URL('../maps/office_studio.json', import.meta.url), 'utf8'));
const outdoorMapData = JSON.parse(readFileSync(new URL('../maps/de_dust2.json', import.meta.url), 'utf8'));
loadMap(mapData);

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

test('loadMap preserves health restore points', () => {
    const points = getHealthRestorePoints();

    assert.ok(Array.isArray(points));
    assert.ok(points.length > 0);
    assert.equal(points[0].healAmount, 35);
    assert.equal(points[0].cooldownSec, 12);
});

test('rainy maps preserve puddles', () => {
    loadMap(outdoorMapData);
    const puddles = getPuddles();

    assert.ok(Array.isArray(puddles));
    assert.ok(puddles.length > 0);
    assert.ok(puddles.every((puddle) => puddle.radiusX > 0 && puddle.radiusZ > 0));

    loadMap(mapData);
});

test('indoor maps keep the ceiling and outdoor maps skip it', () => {
    loadMap(mapData);
    assert.equal(shouldBuildCeiling(), true);
    assert.equal(getSkyConfig().enabled, false);

    loadMap(outdoorMapData);
    assert.equal(shouldBuildCeiling(), false);
    assert.equal(getSkyConfig().enabled, true);
    assert.equal(getSkyConfig().preset, 'rain_day');

    loadMap(mapData);
});
