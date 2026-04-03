import { boxVerts } from './renderer.js';

const FIRE_RATE = 0.15; // seconds between shots

export function createWeapon() {
    return {
        cooldown: 0,
        bobPhase: 0,
        bobWeight: 0,
        kickback: 0,
        recoilPitch: 0,
        recoilYaw: 0,
        flashTime: 0,
        appliedPitch: 0,
        appliedYaw: 0,
        shotIndex: 0,
    };
}

export function updateWeapon(weapon, dt, moving) {
    weapon.cooldown = Math.max(0, weapon.cooldown - dt);
    weapon.kickback = Math.max(0, weapon.kickback - dt * 9);
    weapon.recoilPitch = Math.max(0, weapon.recoilPitch - dt * 4.5);
    weapon.flashTime = Math.max(0, weapon.flashTime - dt);

    if (weapon.recoilYaw > 0) {
        weapon.recoilYaw = Math.max(0, weapon.recoilYaw - dt * 1.8);
    } else {
        weapon.recoilYaw = Math.min(0, weapon.recoilYaw + dt * 1.8);
    }

    if (moving) {
        weapon.bobWeight = Math.min(1, weapon.bobWeight + dt * 6);
        weapon.bobPhase += dt * 10;
    } else {
        weapon.bobWeight = Math.max(0, weapon.bobWeight - dt * 4);
        weapon.bobPhase += dt * 3;
    }
}

export function canFire(weapon) {
    return weapon.cooldown <= 0;
}

export function fire(weapon) {
    weapon.cooldown = FIRE_RATE;
    weapon.kickback = Math.min(1.2, weapon.kickback + 1);
    weapon.recoilPitch = Math.min(0.18, weapon.recoilPitch + 0.09);
    const pattern = [-1, 1, -0.6, 0.6];
    weapon.recoilYaw += pattern[weapon.shotIndex % pattern.length] * 0.02;
    weapon.flashTime = 0.06;
    weapon.shotIndex += 1;
}

// Generate weapon vertices in view space (no view matrix applied)
export function weaponVerts(weapon) {
    const bob = Math.sin(weapon.bobPhase) * 0.02 * weapon.bobWeight;
    const bobX = Math.cos(weapon.bobPhase * 0.5) * 0.015 * weapon.bobWeight;
    const kick = weapon.kickback * 0.12;
    const pitch = -weapon.recoilPitch * 2.5;
    const yaw = weapon.recoilYaw * 4.5;
    const roll = -weapon.recoilYaw * 9;

    const ox = 0.26 + bobX;
    const oy = -0.24 + bob;
    const oz = -0.58 + kick;

    const v = [];
    appendPart(v, boxVerts(-0.02, -0.08, -0.02, 0.06, 0.16, 0.08, 10), ox, oy, oz, pitch * 0.6, yaw * 0.3, roll * 0.6);
    appendPart(v, boxVerts(-0.02, -0.24, 0.06, 0.065, 0.14, 0.085, 10), ox, oy, oz, pitch * 0.3, yaw * 0.2, roll * 0.5);
    appendPart(v, boxVerts(0.0, -0.34, 0.12, 0.06, 0.07, 0.075, 9), ox, oy, oz, pitch * 0.2, yaw * 0.1, roll * 0.4);

    appendPart(v, boxVerts(0.13, -0.02, -0.04, 0.055, 0.15, 0.075, 10), ox, oy, oz, -0.35 + pitch, yaw * 0.5, roll * 0.3);
    appendPart(v, boxVerts(0.16, -0.16, 0.04, 0.055, 0.14, 0.07, 10), ox, oy, oz, -0.55 + pitch, yaw * 0.35, roll * 0.2);
    appendPart(v, boxVerts(0.18, -0.26, 0.11, 0.055, 0.065, 0.07, 9), ox, oy, oz, -0.2 + pitch * 0.5, yaw * 0.2, roll * 0.15);

    appendPart(v, boxVerts(0, 0, 0, 0.05, 0.05, 0.2, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0, 0.02, -0.24 - weapon.kickback * 0.04, 0.018, 0.018, 0.11, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0, -0.085, 0.055, 0.028, 0.055, 0.035, 0), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0.0, -0.03, 0.01, 0.045, 0.03, 0.12, 10), ox, oy, oz, pitch, yaw, roll);

    if (weapon.flashTime > 0) {
        const flashScale = 0.5 + (weapon.flashTime / 0.06) * 0.5;
        appendPart(
            v,
            boxVerts(0, 0.02, -0.39, 0.035 * flashScale, 0.03 * flashScale, 0.05 * flashScale, 4),
            ox,
            oy,
            oz,
            pitch,
            yaw,
            roll
        );
    }

    return v;
}

export function consumeRecoilDelta(weapon) {
    const pitch = weapon.recoilPitch - weapon.appliedPitch;
    const yaw = weapon.recoilYaw - weapon.appliedYaw;
    weapon.appliedPitch = weapon.recoilPitch;
    weapon.appliedYaw = weapon.recoilYaw;
    return { pitch, yaw };
}

function appendPart(out, verts, tx, ty, tz, rx, ry, rz) {
    const sinX = Math.sin(rx), cosX = Math.cos(rx);
    const sinY = Math.sin(ry), cosY = Math.cos(ry);
    const sinZ = Math.sin(rz), cosZ = Math.cos(rz);

    for (let i = 0; i < verts.length; i += 6) {
        let x = verts[i];
        let y = verts[i + 1];
        let z = verts[i + 2];

        const yx = y * cosX - z * sinX;
        const zx = y * sinX + z * cosX;
        y = yx;
        z = zx;

        const xy = x * cosY + z * sinY;
        const zy = -x * sinY + z * cosY;
        x = xy;
        z = zy;

        const xz = x * cosZ - y * sinZ;
        const yz = x * sinZ + y * cosZ;
        x = xz;
        y = yz;

        out.push(
            x + tx,
            y + ty,
            z + tz,
            verts[i + 3],
            verts[i + 4],
            verts[i + 5]
        );
    }
}
