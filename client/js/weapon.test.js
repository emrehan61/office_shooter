import test from 'node:test';
import assert from 'node:assert/strict';

import { createWeapon, fire, getCrosshairGap, setWeaponType, updateWeapon, weaponVerts } from './weapon.js';
import { UTILITY_BOMB, WEAPON_DEFS, WEAPON_MACHINE_GUN, WEAPON_KNIFE, WEAPON_PISTOL } from './economy.js';

function getBounds(verts) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < verts.length; i += 6) {
        const x = verts[i];
        const y = verts[i + 1];
        const z = verts[i + 2];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    }

    return {
        minX,
        maxX,
        minY,
        maxY,
        minZ,
        maxZ,
    };
}

function withStubbedRandom(value, fn) {
    const original = Math.random;
    Math.random = () => value;
    try {
        return fn();
    } finally {
        Math.random = original;
    }
}

test('fire applies recoil and muzzle-flash state', () => {
    const weapon = createWeapon();
    setWeaponType(weapon, WEAPON_MACHINE_GUN);

    // First shot while still has zero recoil (first-shot accuracy)
    fire(weapon);
    const slot = weapon.slots[WEAPON_MACHINE_GUN];
    assert.ok(slot.kickback > 0);
    assert.ok(slot.flashTime > 0);

    // Second shot adds recoil
    fire(weapon);
    assert.ok(slot.recoilTargetPitch > 0);
    // After one update tick, actual recoilPitch should approach target
    updateWeapon(weapon, 0.016, false);
    assert.ok(slot.recoilPitch > 0);
});

test('updateWeapon settles recoil over time', () => {
    const weapon = createWeapon();
    setWeaponType(weapon, WEAPON_MACHINE_GUN);
    // Fire several shots to build up recoil (first shot has zero recoil when still)
    fire(weapon); fire(weapon); fire(weapon);
    // Let recoil approach target (short tick so flash hasn't fully decayed)
    updateWeapon(weapon, 0.02, false);

    const slot = weapon.slots[WEAPON_MACHINE_GUN];
    const recoilPitch = slot.recoilPitch;
    const flashTime = slot.flashTime;
    assert.ok(recoilPitch > 0, 'recoil should have built up');
    assert.ok(flashTime > 0, 'flash should still be active');

    // Simulate time passing with no firing — recoil and flash should settle
    updateWeapon(weapon, 0.8, false);

    assert.ok(slot.recoilPitch < recoilPitch);
    assert.ok(slot.flashTime < flashTime);
});

test('aiming reduces firearm recoil while sustained fire increases it', () => {
    const hipfireWeapon = createWeapon();
    setWeaponType(hipfireWeapon, WEAPON_MACHINE_GUN);
    fire(hipfireWeapon, false, false, true); // moving=true to skip first-shot zero
    fire(hipfireWeapon, false, false, true);
    const hipPitch = hipfireWeapon.slots[WEAPON_MACHINE_GUN].recoilTargetPitch;

    const aimedWeapon = createWeapon();
    setWeaponType(aimedWeapon, WEAPON_MACHINE_GUN);
    fire(aimedWeapon, true, false, true);
    fire(aimedWeapon, true, false, true);
    const aimedPitch = aimedWeapon.slots[WEAPON_MACHINE_GUN].recoilTargetPitch;
    fire(aimedWeapon, true, false, true);
    const sustainedPitch = aimedWeapon.slots[WEAPON_MACHINE_GUN].recoilTargetPitch;

    assert.ok(aimedPitch < hipPitch);
    assert.ok(sustainedPitch > aimedPitch);
});

test('machine gun burst recoil stays controlled enough for an m4a1-s style feel', () => {
    const weapon = createWeapon();
    setWeaponType(weapon, WEAPON_MACHINE_GUN);

    for (let i = 0; i < 5; i++) {
        fire(weapon, false, false, true);
    }

    const slot = weapon.slots[WEAPON_MACHINE_GUN];
    assert.ok(slot.recoilTargetPitch < 0.6);
    assert.ok(slot.viewPunchPitch < 0.04);
});

test('crosshair gap shrinks on aim and expands with sustained fire', () => {
    const weapon = createWeapon();
    setWeaponType(weapon, WEAPON_PISTOL);

    const hipGap = getCrosshairGap(weapon, false);
    const aimGap = getCrosshairGap(weapon, true);
    const crouchGap = getCrosshairGap(weapon, false, true);
    const movingGap = getCrosshairGap(weapon, false, false, true);
    fire(weapon, false);
    const firedGap = getCrosshairGap(weapon, false);

    assert.ok(aimGap < hipGap);
    assert.ok(crouchGap < hipGap);
    assert.ok(movingGap > hipGap);
    assert.ok(firedGap > hipGap);
});

test('default crosshair gap stays compact at rest', () => {
    const pistol = createWeapon();
    setWeaponType(pistol, WEAPON_PISTOL);

    const knife = createWeapon();
    setWeaponType(knife, WEAPON_KNIFE);

    assert.ok(getCrosshairGap(pistol, false) < 9);
    assert.ok(getCrosshairGap(knife, false) < 9);
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

test('utility selection renders a utility model instead of the knife model', () => {
    const weapon = createWeapon();
    setWeaponType(weapon, WEAPON_KNIFE);
    const knifeVerts = weaponVerts(weapon);

    setWeaponType(weapon, UTILITY_BOMB);
    const bombVerts = weaponVerts(weapon);

    assert.notDeepEqual(bombVerts, knifeVerts);
});

test('knife idles upright and uses a horizontal swing on primary attack', () => {
    const idleWeapon = createWeapon();
    setWeaponType(idleWeapon, WEAPON_KNIFE);
    const idleBounds = getBounds(weaponVerts(idleWeapon));

    const leftToRightStart = withStubbedRandom(0.1, () => {
        const weapon = createWeapon();
        setWeaponType(weapon, WEAPON_KNIFE);
        fire(weapon);
        updateWeapon(weapon, 0.1, false);
        return {
            direction: weapon.slots[WEAPON_KNIFE].attackDirection,
            bounds: getBounds(weaponVerts(weapon)),
        };
    });

    const leftToRightEnd = withStubbedRandom(0.1, () => {
        const weapon = createWeapon();
        setWeaponType(weapon, WEAPON_KNIFE);
        fire(weapon);
        updateWeapon(weapon, 0.5, false);
        return getBounds(weaponVerts(weapon));
    });

    const rightToLeftStart = withStubbedRandom(0.9, () => {
        const weapon = createWeapon();
        setWeaponType(weapon, WEAPON_KNIFE);
        fire(weapon);
        updateWeapon(weapon, 0.1, false);
        return {
            direction: weapon.slots[WEAPON_KNIFE].attackDirection,
            bounds: getBounds(weaponVerts(weapon)),
        };
    });

    assert.ok(idleBounds.maxY - idleBounds.minY > idleBounds.maxZ - idleBounds.minZ);
    assert.equal(leftToRightStart.direction, 1);
    assert.equal(rightToLeftStart.direction, -1);
    assert.ok(leftToRightStart.bounds.maxX - leftToRightStart.bounds.minX > idleBounds.maxX - idleBounds.minX);
    assert.ok(leftToRightStart.bounds.minX < idleBounds.minX - 0.45);
    assert.ok(leftToRightEnd.maxX > idleBounds.maxX + 0.2);
    assert.ok(rightToLeftStart.bounds.maxX > idleBounds.maxX + 0.15);
});

test('knife alternate fire uses a longer animation and a left-to-center stab with right recovery', () => {
    const idleWeapon = createWeapon();
    setWeaponType(idleWeapon, WEAPON_KNIFE);
    const idleBounds = getBounds(weaponVerts(idleWeapon));

    const primaryWeapon = createWeapon();
    setWeaponType(primaryWeapon, WEAPON_KNIFE);
    fire(primaryWeapon, false, false);
    updateWeapon(primaryWeapon, 0.16, false);
    const primarySlot = primaryWeapon.slots[WEAPON_KNIFE];
    const primaryBounds = getBounds(weaponVerts(primaryWeapon));

    const heavyWindup = (() => {
        const weapon = createWeapon();
        setWeaponType(weapon, WEAPON_KNIFE);
        fire(weapon, false, true);
        updateWeapon(weapon, 0.18, false);
        return {
            slot: weapon.slots[WEAPON_KNIFE],
            bounds: getBounds(weaponVerts(weapon)),
        };
    })();

    const heavyStab = (() => {
        const weapon = createWeapon();
        setWeaponType(weapon, WEAPON_KNIFE);
        fire(weapon, false, true);
        updateWeapon(weapon, 0.6, false);
        return getBounds(weaponVerts(weapon));
    })();

    const heavyRecover = (() => {
        const weapon = createWeapon();
        setWeaponType(weapon, WEAPON_KNIFE);
        fire(weapon, false, true);
        updateWeapon(weapon, 0.98, false);
        return getBounds(weaponVerts(weapon));
    })();

    assert.equal(primarySlot.attackStyle, 'primary');
    assert.ok(primarySlot.attackDuration > WEAPON_DEFS[WEAPON_KNIFE].fireRate);
    assert.equal(heavyWindup.slot.attackStyle, 'alternate');
    assert.ok(heavyWindup.slot.attackDuration > WEAPON_DEFS[WEAPON_KNIFE].altFireRate);
    assert.ok(heavyWindup.bounds.minX < idleBounds.minX - 0.35);
    assert.ok(heavyStab.minZ < primaryBounds.minZ - 0.18);
    assert.ok(heavyRecover.maxX > idleBounds.maxX + 0.12);
});
