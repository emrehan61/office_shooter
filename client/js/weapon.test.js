import test from 'node:test';
import assert from 'node:assert/strict';

import { createWeapon, fire, updateWeapon, weaponVerts } from './weapon.js';

test('fire applies recoil and muzzle-flash state', () => {
    const weapon = createWeapon();

    fire(weapon);

    assert.ok(weapon.kickback > 0);
    assert.ok(weapon.recoilPitch > 0);
    assert.ok(weapon.flashTime > 0);
});

test('updateWeapon settles recoil over time', () => {
    const weapon = createWeapon();
    fire(weapon);

    const recoilPitch = weapon.recoilPitch;
    const flashTime = weapon.flashTime;

    updateWeapon(weapon, 0.1, false);

    assert.ok(weapon.recoilPitch < recoilPitch);
    assert.ok(weapon.flashTime < flashTime);
});

test('weapon view model includes hands holding the gun', () => {
    const weapon = createWeapon();
    const verts = weaponVerts(weapon);
    const mats = new Set();

    for (let i = 5; i < verts.length; i += 6) {
        mats.add(verts[i]);
    }

    assert.ok(mats.has(9));
});
