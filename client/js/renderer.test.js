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

test('rain_day atmosphere enables rain and thunder with moodier lighting', () => {
    const rainy = resolveAtmosphereForSky({ enabled: true, preset: 'rain_day', sunMode: 'fixed' });
    const clear = resolveAtmosphereForSky({ enabled: true, preset: 'clear_day', sunMode: 'fixed' });

    assert.equal(rainy.enabled, true);
    assert.equal(rainy.rainEnabled, true);
    assert.equal(rainy.thunderEnabled, true);
    assert.equal(rainy.cloudEnabled, true);
    assert.ok(rainy.cloudStrength > 0.5);
    assert.ok(rainy.dirLightIntensity < clear.dirLightIntensity);
    assert.ok(rainy.ambientIntensity < clear.ambientIntensity);
});
