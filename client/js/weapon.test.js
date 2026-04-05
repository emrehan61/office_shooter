import test from 'node:test';
import assert from 'node:assert/strict';

import { createWeapon, fire, getCrosshairGap, setWeaponType, updateWeapon, weaponVerts } from './weapon.js';
import { UTILITY_BOMB, WEAPON_DEFS, WEAPON_KNIFE } from './economy.js';

function getBounds(verts) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < verts.length; i += 6) {
        minX = Math.min(minX, verts[i]);
        maxX = Math.max(maxX, verts[i]);
        minY = Math.min(minY, verts[i + 1]);
        maxY = Math.max(maxY, verts[i + 1]);
        minZ = Math.min(minZ, verts[i + 2]);
        maxZ = Math.max(maxZ, verts[i + 2]);
    }

    return { minX, maxX, minY, maxY, minZ, maxZ };
}

test('fire applies recoil and muzzle flash for heavy weapons', () => {
    const weapon = createWeapon();
    setWeaponType(weapon, 'ak-47');

    fire(weapon, false, false, true);
    fire(weapon, false, false, true);

    const slot = weapon.slots['ak-47'];
    assert.ok(slot.kickback > 0);
    assert.ok(slot.flashTime > 0);
    assert.ok(slot.recoilTargetPitch > 0);

    updateWeapon(weapon, 0.016, false);
    assert.ok(slot.recoilPitch > 0);
});

test('updateWeapon settles recoil over time', () => {
    const weapon = createWeapon();
    setWeaponType(weapon, 'ak-47');
    fire(weapon, false, false, true);
    fire(weapon, false, false, true);
    fire(weapon, false, false, true);
    updateWeapon(weapon, 0.02, false);

    const slot = weapon.slots['ak-47'];
    const recoilPitch = slot.recoilPitch;
    const flashTime = slot.flashTime;

    updateWeapon(weapon, 0.8, false);

    assert.ok(slot.recoilPitch < recoilPitch);
    assert.ok(slot.flashTime < flashTime);
});

test('scoped weapons shrink the crosshair while pistols expand under sustained fire', () => {
    const sniper = createWeapon();
    setWeaponType(sniper, 'awp');
    const hipGap = getCrosshairGap(sniper, false);
    const aimGap = getCrosshairGap(sniper, true);

    const pistol = createWeapon();
    setWeaponType(pistol, 'glock-18');
    const pistolHipGap = getCrosshairGap(pistol, false);
    fire(pistol, false);
    const pistolFiredGap = getCrosshairGap(pistol, false);
    const pistolMovingGap = getCrosshairGap(pistol, false, false, true);

    assert.ok(aimGap < hipGap);
    assert.ok(pistolFiredGap > pistolHipGap);
    assert.ok(pistolMovingGap > pistolHipGap);
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

test('utility selection renders a different model than the knife', () => {
    const weapon = createWeapon();
    setWeaponType(weapon, WEAPON_KNIFE);
    const knifeVerts = weaponVerts(weapon);

    setWeaponType(weapon, UTILITY_BOMB);
    const bombVerts = weaponVerts(weapon);

    assert.notDeepEqual(bombVerts, knifeVerts);
});

test('different firearms use distinct meshes and recoil signatures', () => {
    const rifle = createWeapon();
    setWeaponType(rifle, 'ak-47');
    fire(rifle, false, false, true);
    fire(rifle, false, false, true);
    const akVerts = weaponVerts(rifle);
    const akSlot = rifle.slots['ak-47'];

    const pdw = createWeapon();
    setWeaponType(pdw, 'p90');
    fire(pdw, false, false, true);
    fire(pdw, false, false, true);
    const p90Verts = weaponVerts(pdw);
    const p90Slot = pdw.slots.p90;

    assert.notDeepEqual(akVerts, p90Verts);
    assert.notEqual(akSlot.recoilTargetYaw, p90Slot.recoilTargetYaw);
    assert.notEqual(WEAPON_DEFS['ak-47'].baseDamage, WEAPON_DEFS.p90.baseDamage);
});

test('special pistols render unique silhouettes', () => {
    const duals = createWeapon();
    setWeaponType(duals, 'dual-berettas');
    const dualVerts = weaponVerts(duals);

    const revolver = createWeapon();
    setWeaponType(revolver, 'r8-revolver');
    const revolverVerts = weaponVerts(revolver);

    assert.notDeepEqual(dualVerts, revolverVerts);
});

test('knife alternate attack lasts longer than the primary slash', () => {
    const primary = createWeapon();
    setWeaponType(primary, WEAPON_KNIFE);
    fire(primary, false, false);

    const alternate = createWeapon();
    setWeaponType(alternate, WEAPON_KNIFE);
    fire(alternate, false, true);

    const primarySlot = primary.slots[WEAPON_KNIFE];
    const alternateSlot = alternate.slots[WEAPON_KNIFE];

    assert.equal(primarySlot.attackStyle, 'primary');
    assert.equal(alternateSlot.attackStyle, 'alternate');
    assert.ok(alternateSlot.attackDuration > primarySlot.attackDuration);
    assert.ok(alternateSlot.attackDuration > WEAPON_DEFS[WEAPON_KNIFE].fireIntervalMs / 1000);

    updateWeapon(alternate, 0.18, false);
    const windupBounds = getBounds(weaponVerts(alternate));
    updateWeapon(alternate, 0.5, false);
    const stabBounds = getBounds(weaponVerts(alternate));

    assert.ok(windupBounds.minX < stabBounds.maxX);
});
