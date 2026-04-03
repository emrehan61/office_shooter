import { boxVerts } from './renderer.js';
import { UTILITY_BOMB, UTILITY_FLASHBANG, UTILITY_SMOKE } from './economy.js';

export function buildProjectileVerts(projectiles = []) {
    const verts = [];

    for (const projectile of projectiles) {
        if (!projectile?.pos || !projectile?.type) continue;

        if (projectile.type === UTILITY_BOMB) {
            appendCube(verts, projectile.pos, 0.12, 5);
            appendCube(verts, [projectile.pos[0], projectile.pos[1] + 0.12, projectile.pos[2]], 0.03, 4);
            continue;
        }

        if (projectile.type === UTILITY_SMOKE) {
            appendBox(verts, projectile.pos, 0.08, 0.14, 0.08, 13);
            appendBox(verts, [projectile.pos[0], projectile.pos[1] + 0.11, projectile.pos[2]], 0.09, 0.02, 0.09, 3);
            continue;
        }

        if (projectile.type === UTILITY_FLASHBANG) {
            appendBox(verts, projectile.pos, 0.07, 0.13, 0.07, 4);
            appendBox(verts, [projectile.pos[0], projectile.pos[1], projectile.pos[2]], 0.075, 0.12, 0.075, 3);
            continue;
        }
    }

    return verts;
}

export function buildEffectVerts(effects = []) {
    const verts = [];

    for (const effect of effects) {
        if (!effect?.pos || !effect?.type) continue;
        if (effect.type === 'smoke') {
            appendSmokeCloud(verts, effect.pos, effect.radius || 9);
            continue;
        }
        if (effect.type === 'bomb') {
            appendBombBlast(verts, effect.pos, effect.radius || 6, effect.timeLeftMs || 0);
            continue;
        }
        if (effect.type === 'impact') {
            appendImpactMarker(verts, effect.pos, effect.timeLeftMs || 0);
        }
    }

    return verts;
}

function appendCube(out, pos, halfSize, mat) {
    out.push(...boxVerts(pos[0], pos[1], pos[2], halfSize, halfSize, halfSize, mat));
}

function appendBox(out, pos, hx, hy, hz, mat) {
    out.push(...boxVerts(pos[0], pos[1], pos[2], hx, hy, hz, mat));
}

function appendSmokeCloud(out, pos, radius) {
    const scale = radius / 9;
    const rings = [
        { dist: 0.0, count: 1, y: 1.5, size: 1.9, height: 2.1 },
        { dist: 0.24, count: 6, y: 1.45, size: 1.7, height: 2.0 },
        { dist: 0.46, count: 10, y: 1.55, size: 1.55, height: 1.95 },
        { dist: 0.68, count: 14, y: 1.7, size: 1.42, height: 1.9 },
        { dist: 0.88, count: 18, y: 1.8, size: 1.26, height: 1.8 },
    ];

    for (const ring of rings) {
        for (let i = 0; i < ring.count; i += 1) {
            const angle = ring.count === 1 ? 0 : (Math.PI * 2 * i) / ring.count;
            const wobble = (i % 2 === 0 ? 0.04 : -0.04) * radius;
            const radial = ring.dist * radius + wobble;
            const x = Math.cos(angle) * radial;
            const z = Math.sin(angle) * radial;
            const sizeJitter = 1 + ((i % 3) - 1) * 0.08;
            const heightJitter = 1 + ((i % 4) - 1.5) * 0.05;
            appendBox(out, [
                pos[0] + x,
                pos[1] + ring.y * scale,
                pos[2] + z,
            ], ring.size * scale * sizeJitter, ring.height * scale * heightJitter, ring.size * scale * sizeJitter, 17);
        }
    }

    const capLayers = [
        [0, 2.7, 0, 1.35, 1.35, 1.35],
        [-1.8, 2.95, 1.2, 1.1, 1.2, 1.1],
        [1.7, 2.9, -1.3, 1.08, 1.18, 1.08],
        [-2.2, 3.2, -1.8, 0.96, 1.05, 0.96],
        [2.15, 3.15, 1.75, 0.94, 1.0, 0.94],
        [0, 3.45, 0.5, 0.88, 0.95, 0.88],
    ];

    for (const puff of capLayers) {
        appendBox(out, [
            pos[0] + puff[0] * scale,
            pos[1] + puff[1] * scale,
            pos[2] + puff[2] * scale,
        ], puff[3] * scale, puff[4] * scale, puff[5] * scale, 17);
    }
}

function appendBombBlast(out, pos, radius, timeLeftMs) {
    const phase = Math.max(0, Math.min(1, timeLeftMs / 350));
    const ringRadius = radius * (0.78 + (1 - phase) * 0.22);
    const pillarHeight = 0.38 + (1 - phase) * 0.32;
    const pillarSize = 0.14 + phase * 0.03;
    const count = 24;

    appendBox(out, [pos[0], pos[1] + 0.16, pos[2]], 0.42, 0.16, 0.42, 5);

    for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count;
        const x = pos[0] + Math.cos(angle) * ringRadius;
        const z = pos[2] + Math.sin(angle) * ringRadius;
        appendBox(out, [x, pos[1] + pillarHeight * 0.5, z], pillarSize, pillarHeight, pillarSize, 5);
    }

    const diagonalRadius = ringRadius * 0.72;
    for (let i = 0; i < 8; i += 1) {
        const angle = (Math.PI * 2 * i) / 8 + Math.PI / 8;
        const x = pos[0] + Math.cos(angle) * diagonalRadius;
        const z = pos[2] + Math.sin(angle) * diagonalRadius;
        appendBox(out, [x, pos[1] + 0.18, z], 0.16, 0.18, 0.16, 5);
    }
}

function appendImpactMarker(out, pos, timeLeftMs) {
    const phase = Math.max(0, Math.min(1, timeLeftMs / 140));
    const size = 0.045 + phase * 0.018;
    appendBox(out, [pos[0], pos[1], pos[2]], size, size, size, 18);
    appendBox(out, [pos[0], pos[1], pos[2]], size * 0.58, size * 0.58, size * 0.58, 10);
}
