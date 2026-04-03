import { boxVerts } from './renderer.js';

const PLAYER_PALETTES = [
    { primary: 5, accent: 10 },
    { primary: 6, accent: 10 },
    { primary: 7, accent: 10 },
    { primary: 8, accent: 10 },
    { primary: 11, accent: 10 },
    { primary: 12, accent: 10 },
];

const SKIN_MAT = 9;
const GEAR_MAT = 10;
const FLASH_MAT = 4;
const GUN_MAT = 3;

export function getPlayerPalette(id) {
    const index = Math.abs((Number(id) || 1) - 1) % PLAYER_PALETTES.length;
    return PLAYER_PALETTES[index];
}

export function buildAvatarVerts(playerId, player) {
    const palette = getPlayerPalette(playerId);
    const shotKick = Math.max(0, player.shotTime || 0) / 0.12;
    const verts = [];

    appendPart(verts, boxVerts(0, 1.65, 0, 0.17, 0.22, 0.17, SKIN_MAT), player.pos, player.yaw);
    appendPart(verts, boxVerts(0, 1.83, 0.01, 0.18, 0.05, 0.18, palette.primary), player.pos, player.yaw);
    appendPart(verts, boxVerts(0, 1.66, 0.16, 0.08, 0.04, 0.03, GEAR_MAT), player.pos, player.yaw);

    appendPart(verts, boxVerts(0, 1.08, 0, 0.27, 0.38, 0.18, palette.primary), player.pos, player.yaw);
    appendPart(verts, boxVerts(0, 1.11, 0.17, 0.19, 0.18, 0.03, palette.accent), player.pos, player.yaw);
    appendPart(verts, boxVerts(0, 0.64, 0, 0.22, 0.16, 0.16, palette.accent), player.pos, player.yaw);

    appendPart(verts, boxVerts(-0.12, 0.34, 0, 0.1, 0.32, 0.11, GEAR_MAT), player.pos, player.yaw);
    appendPart(verts, boxVerts(0.12, 0.34, 0, 0.1, 0.32, 0.11, GEAR_MAT), player.pos, player.yaw);
    appendPart(verts, boxVerts(-0.12, 0.82, 0.01, 0.1, 0.22, 0.11, palette.primary), player.pos, player.yaw);
    appendPart(verts, boxVerts(0.12, 0.82, 0.01, 0.1, 0.22, 0.11, palette.primary), player.pos, player.yaw);
    appendPart(verts, boxVerts(-0.12, 0.05, 0.08, 0.13, 0.05, 0.18, GEAR_MAT), player.pos, player.yaw);
    appendPart(verts, boxVerts(0.12, 0.05, 0.08, 0.13, 0.05, 0.18, GEAR_MAT), player.pos, player.yaw);

    appendPart(verts, boxVerts(-0.36, 1.1, -0.02, 0.08, 0.18, 0.09, palette.primary), player.pos, player.yaw, 0.12, 0, 0.25);
    appendPart(verts, boxVerts(-0.42, 0.84, -0.06, 0.07, 0.16, 0.08, SKIN_MAT), player.pos, player.yaw, 0.1, 0, 0.08);
    appendPart(verts, boxVerts(-0.45, 0.65, -0.1, 0.06, 0.06, 0.07, SKIN_MAT), player.pos, player.yaw);

    appendPart(verts, boxVerts(0.34, 1.08, -0.08, 0.08, 0.18, 0.09, palette.primary), player.pos, player.yaw, -0.35 - shotKick * 0.2, -0.08, -0.15);
    appendPart(verts, boxVerts(0.42, 0.83, -0.25 - shotKick * 0.04, 0.07, 0.17, 0.08, SKIN_MAT), player.pos, player.yaw, -0.75 - shotKick * 0.45, -0.08, -0.05);
    appendPart(verts, boxVerts(0.46, 0.65, -0.42 - shotKick * 0.06, 0.06, 0.06, 0.08, SKIN_MAT), player.pos, player.yaw, -0.2, 0, 0);

    appendPart(verts, boxVerts(0.1, 0.9, -0.44 - shotKick * 0.08, 0.05, 0.05, 0.22, GUN_MAT), player.pos, player.yaw);
    appendPart(verts, boxVerts(0.1, 0.94, -0.69 - shotKick * 0.1, 0.02, 0.02, 0.1, GUN_MAT), player.pos, player.yaw);
    appendPart(verts, boxVerts(0.1, 0.78, -0.28, 0.03, 0.08, 0.04, GUN_MAT), player.pos, player.yaw, 0.45, 0, 0);

    if (shotKick > 0) {
        const flash = 0.03 + shotKick * 0.025;
        appendPart(verts, boxVerts(0.1, 0.84, -0.83, flash, flash * 0.8, flash * 0.7, FLASH_MAT), player.pos, player.yaw);
    }

    return verts;
}

function appendPart(out, verts, pos, yaw, rx = 0, ry = 0, rz = 0) {
    const sinX = Math.sin(rx), cosX = Math.cos(rx);
    const sinYLocal = Math.sin(ry), cosYLocal = Math.cos(ry);
    const sinZ = Math.sin(rz), cosZ = Math.cos(rz);
    const sinYaw = Math.sin(yaw || 0);
    const cosYaw = Math.cos(yaw || 0);
    const baseY = (pos?.[1] ?? 1.7) - 1.7;

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
