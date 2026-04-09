import { boxVerts } from './renderer.js';
import { UTILITY_BOMB, UTILITY_FLASHBANG, UTILITY_SMOKE } from './economy.js';

export function buildProjectileVerts(projectiles = []) {
    const verts = [];

    for (const projectile of projectiles) {
        if (!projectile?.pos || !projectile?.type) continue;

        if (projectile.type === UTILITY_BOMB) {
            appendBox(verts, projectile.pos, 0.11, 0.08, 0.11, 3);
            appendBox(verts, [projectile.pos[0], projectile.pos[1], projectile.pos[2]], 0.085, 0.055, 0.085, 21);
            appendBox(verts, [projectile.pos[0], projectile.pos[1] + 0.09, projectile.pos[2]], 0.04, 0.025, 0.04, 10);
            appendBox(verts, [projectile.pos[0] + 0.06, projectile.pos[1] + 0.03, projectile.pos[2]], 0.012, 0.012, 0.01, 4);
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

export function buildEffectVerts(effects = [], options = {}) {
    const verts = [];
    const outdoor = options.outdoor === true;

    for (const effect of effects) {
        if (!effect?.pos || !effect?.type) continue;
        if (effect.type === 'smoke') {
            appendSmokeCloud(verts, effect.pos, effect.radius || 9);
            continue;
        }
        if (effect.type === 'bomb') {
            appendBombBlast(verts, effect.pos, effect.radius || 10, effect.timeLeftMs || 0);
            if (outdoor) {
                appendAirstrikeTraces(verts, effect.pos, effect.radius || 10, effect.timeLeftMs || 0);
            }
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
    const phase = Math.max(0, Math.min(1, timeLeftMs / 650));
    const expansion = 1 - phase;
    const shockRadius = radius * (0.28 + expansion * 0.82);
    const stemHeight = radius * (0.16 + expansion * 0.18);
    const stemWidth = radius * 0.08;
    const capHeight = radius * (0.2 + expansion * 0.14);
    const capRadius = radius * (0.34 + expansion * 0.18);

    appendBox(out, [pos[0], pos[1] + 0.2, pos[2]], 0.5, 0.2, 0.5, 4);
    appendBox(out, [pos[0], pos[1] + stemHeight * 0.5, pos[2]], stemWidth, stemHeight, stemWidth, 20);
    appendBox(out, [pos[0], pos[1] + stemHeight + capHeight * 0.3, pos[2]], capRadius * 0.58, capHeight * 0.9, capRadius * 0.58, 21);

    const capPuffs = [
        [0, 0, 0],
        [-0.55, 0.05, 0.38],
        [0.58, 0.02, -0.32],
        [-0.36, 0.12, -0.54],
        [0.4, 0.1, 0.52],
        [0.0, 0.18, 0.0],
    ];
    for (const puff of capPuffs) {
        appendBox(out, [
            pos[0] + puff[0] * capRadius,
            pos[1] + stemHeight + capHeight + puff[1] * radius,
            pos[2] + puff[2] * capRadius,
        ], capRadius * 0.34, capHeight * 0.44, capRadius * 0.34, 17);
    }

    const ringCount = 28;
    const ringHeight = radius * (0.08 + expansion * 0.08);
    for (let i = 0; i < ringCount; i += 1) {
        const angle = (Math.PI * 2 * i) / ringCount;
        const x = pos[0] + Math.cos(angle) * shockRadius;
        const z = pos[2] + Math.sin(angle) * shockRadius;
        appendBox(out, [x, pos[1] + ringHeight, z], radius * 0.04, ringHeight, radius * 0.04, i % 2 === 0 ? 4 : 21);
    }

    const innerRing = shockRadius * 0.58;
    for (let i = 0; i < 10; i += 1) {
        const angle = (Math.PI * 2 * i) / 10 + Math.PI / 10;
        appendBox(out, [
            pos[0] + Math.cos(angle) * innerRing,
            pos[1] + radius * 0.16,
            pos[2] + Math.sin(angle) * innerRing,
        ], radius * 0.06, radius * 0.12, radius * 0.06, 20);
    }
}

function appendAirstrikeTraces(out, pos, radius, timeLeftMs) {
    const phase = Math.max(0, Math.min(1, timeLeftMs / 650));
    const collapse = Math.min(1, (1 - phase) * 1.35);
    const traces = [
        { tx: -0.32, tz: 0.14, sx: -0.82, sz: -0.18, lift: 0.1 },
        { tx: 0.0, tz: -0.08, sx: 0.16, sz: -0.68, lift: 0.3 },
        { tx: 0.28, tz: 0.26, sx: 0.86, sz: 0.08, lift: 0.2 },
        { tx: -0.18, tz: -0.34, sx: -0.42, sz: -0.94, lift: 0.45 },
        { tx: 0.4, tz: -0.22, sx: 0.62, sz: -0.44, lift: 0.0 },
    ];

    for (let i = 0; i < traces.length; i += 1) {
        const trace = traces[i];
        const start = [
            pos[0] + trace.sx * radius * 0.85,
            pos[1] + radius * (1.9 + trace.lift + phase * 0.8),
            pos[2] + trace.sz * radius * 0.85,
        ];
        const end = [
            pos[0] + trace.tx * radius,
            pos[1] + 0.3,
            pos[2] + trace.tz * radius,
        ];
        const segmentCount = 7;
        for (let segment = 0; segment < segmentCount; segment += 1) {
            const t = collapse + (1 - collapse) * (segment / (segmentCount - 1));
            const x = start[0] + (end[0] - start[0]) * t;
            const y = start[1] + (end[1] - start[1]) * t;
            const z = start[2] + (end[2] - start[2]) * t;
            const size = radius * (segment === segmentCount - 1 ? 0.05 : 0.028);
            const height = segment === segmentCount - 1 ? radius * 0.12 : radius * 0.07;
            const mat = segment === segmentCount - 1 ? 10 : (i % 2 === 0 ? 21 : 4);
            appendBox(out, [x, y, z], size, height, size, mat);
        }
        appendBox(out, [
            end[0],
            pos[1] + radius * (0.12 + phase * 0.18),
            end[2],
        ], radius * 0.045, radius * 0.08, radius * 0.045, 21);
    }
}

function appendImpactMarker(out, pos, timeLeftMs) {
    const phase = Math.max(0, Math.min(1, timeLeftMs / 140));
    const size = 0.045 + phase * 0.018;
    appendBox(out, [pos[0], pos[1], pos[2]], size, size, size, 18);
    appendBox(out, [pos[0], pos[1], pos[2]], size * 0.58, size * 0.58, size * 0.58, 10);
}
