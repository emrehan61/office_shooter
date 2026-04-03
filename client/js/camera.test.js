import test from 'node:test';
import assert from 'node:assert/strict';

import { createCamera, updateCamera } from './camera.js';
import { lookDirFromYawPitch } from './math.js';

test('mouse right turns the camera right', () => {
    const camera = createCamera();
    camera.yaw = 0;

    updateCamera(camera, 10, 0, 1);

    assert.ok(camera.yaw < 0);
});

test('lookDirFromYawPitch uses the same vertical direction as the rendered camera', () => {
    const dir = lookDirFromYawPitch(0, 0.35);

    assert.ok(dir[1] > 0);
});
