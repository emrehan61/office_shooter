import test from 'node:test';
import assert from 'node:assert/strict';

import { UTILITY_BOMB, WEAPON_DEFS } from './economy.js';
import { buildEffectVerts, buildProjectileVerts } from './projectiles.js';

function getMaterials(verts) {
    const mats = new Set();
    for (let i = 5; i < verts.length; i += 6) {
        mats.add(verts[i]);
    }
    return mats;
}

test('bomb utility is presented as a nuke and renders a blast effect', () => {
    assert.equal(WEAPON_DEFS[UTILITY_BOMB].label, 'Nuke Grenade');

    const projectileVerts = buildProjectileVerts([
        { type: UTILITY_BOMB, pos: [0, 1, 0] },
    ]);
    const projectileMats = getMaterials(projectileVerts);

    assert.ok(projectileVerts.length > 0);
    assert.ok(projectileMats.has(3));
    assert.ok(projectileMats.has(21));

    const effectVerts = buildEffectVerts([
        { type: 'bomb', pos: [0, 0, 0], radius: 10.5, timeLeftMs: 650 },
    ]);
    const outdoorEffectVerts = buildEffectVerts([
        { type: 'bomb', pos: [0, 0, 0], radius: 10.5, timeLeftMs: 650 },
    ], { outdoor: true });
    const effectMats = getMaterials(effectVerts);
    const outdoorEffectMats = getMaterials(outdoorEffectVerts);

    assert.ok(effectVerts.length > projectileVerts.length);
    assert.ok(outdoorEffectVerts.length > effectVerts.length);
    assert.ok(effectMats.has(17));
    assert.ok(effectMats.has(21));
    assert.ok(outdoorEffectMats.has(10));
    assert.ok(outdoorEffectMats.has(21));
});
