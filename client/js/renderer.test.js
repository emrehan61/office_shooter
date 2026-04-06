import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRendererSkyConfig, resolveAtmosphereForSky } from './renderer.js';

test('normalizeRendererSkyConfig keeps indoor defaults when sky is absent', () => {
    assert.deepEqual(normalizeRendererSkyConfig(), {
        enabled: false,
        preset: 'clear_day',
        sunMode: 'fixed',
    });
});

test('resolveAtmosphereForSky brightens outdoor maps and keeps indoor defaults', () => {
    const indoor = resolveAtmosphereForSky();
    const outdoor = resolveAtmosphereForSky({ enabled: true, preset: 'clear_day', sunMode: 'fixed' });

    assert.equal(indoor.enabled, false);
    assert.equal(outdoor.enabled, true);
    assert.ok(outdoor.fogDensity < indoor.fogDensity);
    assert.ok(outdoor.ambientIntensity > indoor.ambientIntensity);
    assert.ok(outdoor.dirLightIntensity > indoor.dirLightIntensity);
    assert.deepEqual(outdoor.sunDirection.length, 3);
});
