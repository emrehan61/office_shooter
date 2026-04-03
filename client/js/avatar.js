import { boxVerts } from './renderer.js';
import { CROUCH_EYE_HEIGHT, STAND_EYE_HEIGHT } from './player.js';
import { TEAM_BLUE, TEAM_GREEN, normalizeTeam } from './teams.js';

const BLUE_PALETTE = { primary: 6, accent: 10 };
const GREEN_PALETTE = { primary: 7, accent: 10 };
const PLAYER_PALETTES = [
    { primary: 5, accent: 10 },
    BLUE_PALETTE,
    GREEN_PALETTE,
    { primary: 8, accent: 10 },
    { primary: 11, accent: 10 },
    { primary: 12, accent: 10 },
];

const SKIN_MAT = 9;
const GEAR_MAT = 10;
const FLASH_MAT = 4;
const GUN_MAT = 3;

export function getPlayerPalette(id, team = '') {
    const normalizedTeam = normalizeTeam(team);
    if (normalizedTeam === TEAM_BLUE) {
        return BLUE_PALETTE;
    }
    if (normalizedTeam === TEAM_GREEN) {
        return GREEN_PALETTE;
    }
    const index = Math.abs((Number(id) || 1) - 1) % PLAYER_PALETTES.length;
    return PLAYER_PALETTES[index];
}

export function buildAvatarVerts(playerId, player) {
    const palette = getPlayerPalette(playerId, player?.team);
    const shotKick = Math.max(0, player.shotTime || 0) / 0.12;
    const crouching = !!player.crouching;
    const eyeHeight = crouching ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
    const headY = crouching ? 1.24 : 1.65;
    const headTopY = crouching ? 1.39 : 1.83;
    const headsetY = crouching ? 1.25 : 1.66;
    const chestY = crouching ? 0.84 : 1.08;
    const plateY = crouching ? 0.87 : 1.11;
    const beltY = crouching ? 0.46 : 0.64;
    const thighY = crouching ? 0.17 : 0.34;
    const shinY = crouching ? 0.53 : 0.82;
    const footY = crouching ? -0.01 : 0.05;
    const leftShoulderY = crouching ? 0.96 : 1.1;
    const leftElbowY = crouching ? 0.75 : 0.84;
    const leftHandY = crouching ? 0.58 : 0.65;
    const rightShoulderY = crouching ? 0.94 : 1.08;
    const rightElbowY = crouching ? 0.74 : 0.83;
    const rightHandY = crouching ? 0.58 : 0.65;
    const gunY = crouching ? 0.74 : 0.9;
    const verts = [];

    appendPart(verts, boxVerts(0, headY, 0, 0.17, 0.22, 0.17, SKIN_MAT), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(0, headTopY, 0.01, 0.18, 0.05, 0.18, palette.primary), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(0, headsetY, 0.16, 0.08, 0.04, 0.03, GEAR_MAT), player.pos, player.yaw, eyeHeight);

    appendPart(verts, boxVerts(0, chestY, 0, 0.27, 0.32, 0.18, palette.primary), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(0, plateY, 0.17, 0.19, 0.16, 0.03, palette.accent), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(0, beltY, 0, 0.22, 0.16, 0.16, palette.accent), player.pos, player.yaw, eyeHeight);

    appendPart(verts, boxVerts(-0.12, thighY, 0, 0.1, crouching ? 0.22 : 0.32, 0.11, GEAR_MAT), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(0.12, thighY, 0, 0.1, crouching ? 0.22 : 0.32, 0.11, GEAR_MAT), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(-0.12, shinY, 0.01, 0.1, crouching ? 0.16 : 0.22, 0.11, palette.primary), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(0.12, shinY, 0.01, 0.1, crouching ? 0.16 : 0.22, 0.11, palette.primary), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(-0.12, footY, 0.08, 0.13, 0.05, 0.18, GEAR_MAT), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(0.12, footY, 0.08, 0.13, 0.05, 0.18, GEAR_MAT), player.pos, player.yaw, eyeHeight);

    appendPart(verts, boxVerts(-0.36, leftShoulderY, -0.02, 0.08, 0.18, 0.09, palette.primary), player.pos, player.yaw, eyeHeight, 0.28, 0, 0.25);
    appendPart(verts, boxVerts(-0.42, leftElbowY, -0.06, 0.07, 0.16, 0.08, SKIN_MAT), player.pos, player.yaw, eyeHeight, 0.2, 0, 0.08);
    appendPart(verts, boxVerts(-0.45, leftHandY, -0.1, 0.06, 0.06, 0.07, SKIN_MAT), player.pos, player.yaw, eyeHeight);

    appendPart(verts, boxVerts(0.34, rightShoulderY, -0.08, 0.08, 0.18, 0.09, palette.primary), player.pos, player.yaw, eyeHeight, -0.35 - shotKick * 0.2, -0.08, -0.15);
    appendPart(verts, boxVerts(0.42, rightElbowY, -0.25 - shotKick * 0.04, 0.07, 0.17, 0.08, SKIN_MAT), player.pos, player.yaw, eyeHeight, -0.75 - shotKick * 0.45, -0.08, -0.05);
    appendPart(verts, boxVerts(0.46, rightHandY, -0.42 - shotKick * 0.06, 0.06, 0.06, 0.08, SKIN_MAT), player.pos, player.yaw, eyeHeight, -0.2, 0, 0);

    appendPart(verts, boxVerts(0.1, gunY, -0.44 - shotKick * 0.08, 0.05, 0.05, 0.22, GUN_MAT), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(0.1, gunY + 0.04, -0.69 - shotKick * 0.1, 0.02, 0.02, 0.1, GUN_MAT), player.pos, player.yaw, eyeHeight);
    appendPart(verts, boxVerts(0.1, gunY - 0.12, -0.28, 0.03, 0.08, 0.04, GUN_MAT), player.pos, player.yaw, eyeHeight, 0.45, 0, 0);

    if (shotKick > 0) {
        const flash = 0.03 + shotKick * 0.025;
        appendPart(verts, boxVerts(0.1, gunY - 0.06, -0.83, flash, flash * 0.8, flash * 0.7, FLASH_MAT), player.pos, player.yaw, eyeHeight);
    }

    return verts;
}

function appendPart(out, verts, pos, yaw, eyeHeight = STAND_EYE_HEIGHT, rx = 0, ry = 0, rz = 0) {
    const sinX = Math.sin(rx), cosX = Math.cos(rx);
    const sinYLocal = Math.sin(ry), cosYLocal = Math.cos(ry);
    const sinZ = Math.sin(rz), cosZ = Math.cos(rz);
    const sinYaw = Math.sin(yaw || 0);
    const cosYaw = Math.cos(yaw || 0);
    const baseY = (pos?.[1] ?? STAND_EYE_HEIGHT) - eyeHeight;

    for (let i = 0; i < verts.length; i += 6) {
        let x = verts[i];
        let y = verts[i + 1];
        let z = verts[i + 2];

        const yx = y * cosX - z * sinX;
        const zx = y * sinX + z * cosX;
        y = yx;
        z = zx;

        const xy = x * cosYLocal + z * sinYLocal;
        const zy = -x * sinYLocal + z * cosYLocal;
        x = xy;
        z = zy;

        const xz = x * cosZ - y * sinZ;
        const yz = x * sinZ + y * cosZ;
        x = xz;
        y = yz;

        const worldX = x * cosYaw - z * sinYaw + (pos?.[0] ?? 0);
        const worldZ = x * sinYaw + z * cosYaw + (pos?.[2] ?? 0);

        out.push(
            worldX,
            y + baseY,
            worldZ,
            verts[i + 3],
            verts[i + 4],
            verts[i + 5]
        );
    }
}
