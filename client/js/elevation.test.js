import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getGroundHeightAt, getPlatforms, loadMap } from './world.js';
import { predictStep } from './prediction.js';
import { STAND_EYE_HEIGHT } from './player.js';

const officeMap = JSON.parse(readFileSync(new URL('../maps/office_studio.json', import.meta.url), 'utf8'));
const dust2Map = JSON.parse(readFileSync(new URL('../maps/de_dust2.json', import.meta.url), 'utf8'));

test('platforms load and expose elevated ground heights', () => {
    loadMap(officeMap);

    assert.ok(getPlatforms().length >= 3);
    assert.equal(getGroundHeightAt(20, 20, 2), 1.2);
    assert.equal(getGroundHeightAt(16, 20, 1), 0.8);
    assert.equal(getGroundHeightAt(10, 10, 2), 0);
});

test('prediction climbs steps onto a raised platform', () => {
    loadMap(officeMap);

    const pos = [14.05, STAND_EYE_HEIGHT, 20.5];
    let velY = 0;
    let onGround = true;
    const cmd = {
        seq: 1,
        forward: true,
        backward: false,
        left: false,
        right: false,
        jump: false,
        crouch: false,
        aiming: false,
        yaw: -Math.PI / 2,
        pitch: 0,
        weapon: 'knife',
    };

    for (let i = 0; i < 40; i += 1) {
        const result = predictStep(pos, velY, onGround, cmd, 1 / 60);
        pos[0] = result.pos[0];
        pos[1] = result.pos[1];
        pos[2] = result.pos[2];
        velY = result.velY;
        onGround = result.onGround;
    }

    assert.equal(onGround, true);
    assert.ok(pos[0] > 19);
    assert.ok(Math.abs(pos[1] - (STAND_EYE_HEIGHT + 1.2)) < 0.05);
});

test('dust2 exposes a raised A site with stepped access and pit below', () => {
    loadMap(dust2Map);

    assert.ok(getPlatforms().length >= 3);
    assert.equal(getGroundHeightAt(-35, -34, 2), 1.2);
    assert.equal(getGroundHeightAt(-35, -26, 1), 0.8);
    assert.equal(getGroundHeightAt(-35, -22, 1), 0.4);
    assert.equal(getGroundHeightAt(-35, -12, 2), 0);

    loadMap(officeMap);
});
