// Office-themed world definition: open software studio with meeting pods and workstations.
// Vertex format: pos(3) + uv(2) + matID(1) per vertex.
// Material IDs: 0=wall panel, 1=carpet, 2=ceiling, 3=metal, 13=glass, 14=wood, 15=screen, 16=plant

const ARENA = 30;
const WALL_HEIGHT = 5;
const WALL_THICK = 0.3;

const MAP_WALLS = [
    // Outer shell
    { x1: -ARENA, z1: -ARENA, x2: ARENA, z2: -ARENA, matID: 0 },
    { x1: ARENA, z1: -ARENA, x2: ARENA, z2: ARENA, matID: 0 },
    { x1: ARENA, z1: ARENA, x2: -ARENA, z2: ARENA, matID: 0 },
    { x1: -ARENA, z1: ARENA, x2: -ARENA, z2: -ARENA, matID: 0 },

    // Northwest meeting pod
    { x1: -26, z1: -26, x2: -14, z2: -26, matID: 13, height: 3.2 },
    { x1: -26, z1: -26, x2: -26, z2: -14, matID: 13, height: 3.2 },
    { x1: -14, z1: -26, x2: -14, z2: -20, matID: 13, height: 3.2 },
    { x1: -14, z1: -18, x2: -14, z2: -14, matID: 13, height: 3.2 },
    { x1: -26, z1: -14, x2: -21, z2: -14, matID: 13, height: 3.2 },
    { x1: -18, z1: -14, x2: -14, z2: -14, matID: 13, height: 3.2 },

    // Northeast meeting pod
    { x1: 14, z1: -26, x2: 26, z2: -26, matID: 13, height: 3.2 },
    { x1: 26, z1: -26, x2: 26, z2: -14, matID: 13, height: 3.2 },
    { x1: 14, z1: -26, x2: 14, z2: -20, matID: 13, height: 3.2 },
    { x1: 14, z1: -18, x2: 14, z2: -14, matID: 13, height: 3.2 },
    { x1: 14, z1: -14, x2: 19, z2: -14, matID: 13, height: 3.2 },
    { x1: 22, z1: -14, x2: 26, z2: -14, matID: 13, height: 3.2 },

    // Southwest meeting pod
    { x1: -26, z1: 14, x2: -14, z2: 14, matID: 13, height: 3.2 },
    { x1: -26, z1: 14, x2: -26, z2: 26, matID: 13, height: 3.2 },
    { x1: -14, z1: 14, x2: -14, z2: 19, matID: 13, height: 3.2 },
    { x1: -14, z1: 22, x2: -14, z2: 26, matID: 13, height: 3.2 },
    { x1: -26, z1: 26, x2: -14, z2: 26, matID: 13, height: 3.2 },

    // Southeast meeting pod
    { x1: 14, z1: 14, x2: 26, z2: 14, matID: 13, height: 3.2 },
    { x1: 26, z1: 14, x2: 26, z2: 26, matID: 13, height: 3.2 },
    { x1: 14, z1: 14, x2: 14, z2: 19, matID: 13, height: 3.2 },
    { x1: 14, z1: 22, x2: 14, z2: 26, matID: 13, height: 3.2 },
    { x1: 14, z1: 26, x2: 26, z2: 26, matID: 13, height: 3.2 },

    // Open workspace dividers, west
    { x1: -18, z1: -9, x2: -9, z2: -9, matID: 0, height: 1.5 },
    { x1: -18, z1: 9, x2: -9, z2: 9, matID: 0, height: 1.5 },
    { x1: -18, z1: -9, x2: -18, z2: -3, matID: 0, height: 1.5 },
    { x1: -18, z1: 3, x2: -18, z2: 9, matID: 0, height: 1.5 },
    { x1: -9, z1: -9, x2: -9, z2: -5, matID: 0, height: 1.5 },
    { x1: -9, z1: 5, x2: -9, z2: 9, matID: 0, height: 1.5 },

    // Open workspace dividers, east
    { x1: 9, z1: -9, x2: 18, z2: -9, matID: 0, height: 1.5 },
    { x1: 9, z1: 9, x2: 18, z2: 9, matID: 0, height: 1.5 },
    { x1: 18, z1: -9, x2: 18, z2: -3, matID: 0, height: 1.5 },
    { x1: 18, z1: 3, x2: 18, z2: 9, matID: 0, height: 1.5 },
    { x1: 9, z1: -9, x2: 9, z2: -5, matID: 0, height: 1.5 },
    { x1: 9, z1: 5, x2: 9, z2: 9, matID: 0, height: 1.5 },

    // Central huddle screens
    { x1: -4, z1: -2, x2: 4, z2: -2, matID: 13, height: 2.4 },
    { x1: -4, z1: 2, x2: 4, z2: 2, matID: 13, height: 2.4 },

    // South reception desk
    { x1: -6, z1: 17, x2: 6, z2: 17, matID: 14, height: 1.2 },
    { x1: -6, z1: 17, x2: -6, z2: 22, matID: 14, height: 1.2 },
    { x1: 6, z1: 17, x2: 6, z2: 22, matID: 14, height: 1.2 },

    // North cafe counter
    { x1: -7, z1: -17, x2: 7, z2: -17, matID: 14, height: 1.2 },
    { x1: -7, z1: -22, x2: -7, z2: -17, matID: 14, height: 1.2 },
    { x1: 7, z1: -22, x2: 7, z2: -17, matID: 14, height: 1.2 },
];

const FLOOR_INSETS = [
    { x1: -27, z1: -27, x2: -13, z2: -13, matID: 14 },
    { x1: 13, z1: -27, x2: 27, z2: -13, matID: 14 },
    { x1: -27, z1: 13, x2: -13, z2: 27, matID: 14 },
    { x1: 13, z1: 13, x2: 27, z2: 27, matID: 14 },
    { x1: -8, z1: -24, x2: 8, z2: -16, matID: 14 },
    { x1: -8, z1: 16, x2: 8, z2: 24, matID: 14 },
];

const OFFICE_BOXES = [
    // Reception desks and screens
    { cx: 0, cy: 0.72, cz: 19.5, hx: 4.8, hy: 0.08, hz: 1.0, matID: 14 },
    { cx: -2.2, cy: 1.05, cz: 18.9, hx: 0.55, hy: 0.28, hz: 0.08, matID: 15 },
    { cx: 0, cy: 1.05, cz: 18.9, hx: 0.55, hy: 0.28, hz: 0.08, matID: 15 },
    { cx: 2.2, cy: 1.05, cz: 18.9, hx: 0.55, hy: 0.28, hz: 0.08, matID: 15 },

    // Cafe island
    { cx: 0, cy: 0.78, cz: -19.4, hx: 5.1, hy: 0.08, hz: 1.1, matID: 14 },
    { cx: 0, cy: 1.1, cz: -19.4, hx: 0.75, hy: 0.18, hz: 0.75, matID: 3 },

    // West desk benches
    { cx: -14, cy: 0.74, cz: -5, hx: 2.0, hy: 0.08, hz: 0.75, matID: 14 },
    { cx: -14, cy: 1.02, cz: -5.45, hx: 0.5, hy: 0.24, hz: 0.08, matID: 15 },
    { cx: -14, cy: 0.74, cz: 5, hx: 2.0, hy: 0.08, hz: 0.75, matID: 14 },
    { cx: -14, cy: 1.02, cz: 4.55, hx: 0.5, hy: 0.24, hz: 0.08, matID: 15 },
    { cx: -11, cy: 0.74, cz: -5, hx: 1.8, hy: 0.08, hz: 0.75, matID: 14 },
    { cx: -11, cy: 1.02, cz: -5.45, hx: 0.45, hy: 0.24, hz: 0.08, matID: 15 },
    { cx: -11, cy: 0.74, cz: 5, hx: 1.8, hy: 0.08, hz: 0.75, matID: 14 },
    { cx: -11, cy: 1.02, cz: 4.55, hx: 0.45, hy: 0.24, hz: 0.08, matID: 15 },

    // East desk benches
    { cx: 14, cy: 0.74, cz: -5, hx: 2.0, hy: 0.08, hz: 0.75, matID: 14 },
    { cx: 14, cy: 1.02, cz: -5.45, hx: 0.5, hy: 0.24, hz: 0.08, matID: 15 },
    { cx: 14, cy: 0.74, cz: 5, hx: 2.0, hy: 0.08, hz: 0.75, matID: 14 },
    { cx: 14, cy: 1.02, cz: 4.55, hx: 0.5, hy: 0.24, hz: 0.08, matID: 15 },
    { cx: 11, cy: 0.74, cz: -5, hx: 1.8, hy: 0.08, hz: 0.75, matID: 14 },
    { cx: 11, cy: 1.02, cz: -5.45, hx: 0.45, hy: 0.24, hz: 0.08, matID: 15 },
    { cx: 11, cy: 0.74, cz: 5, hx: 1.8, hy: 0.08, hz: 0.75, matID: 14 },
    { cx: 11, cy: 1.02, cz: 4.55, hx: 0.45, hy: 0.24, hz: 0.08, matID: 15 },

    // Meeting tables
    { cx: -20, cy: 0.76, cz: -20, hx: 2.4, hy: 0.08, hz: 1.2, matID: 14 },
    { cx: 20, cy: 0.76, cz: -20, hx: 2.4, hy: 0.08, hz: 1.2, matID: 14 },
    { cx: -20, cy: 0.76, cz: 20, hx: 2.4, hy: 0.08, hz: 1.2, matID: 14 },
    { cx: 20, cy: 0.76, cz: 20, hx: 2.4, hy: 0.08, hz: 1.2, matID: 14 },

    // Planters
    { cx: -8, cy: 0.52, cz: -14, hx: 0.7, hy: 0.52, hz: 0.7, matID: 14 },
    { cx: -8, cy: 1.28, cz: -14, hx: 0.45, hy: 0.45, hz: 0.45, matID: 16 },
    { cx: 8, cy: 0.52, cz: -14, hx: 0.7, hy: 0.52, hz: 0.7, matID: 14 },
    { cx: 8, cy: 1.28, cz: -14, hx: 0.45, hy: 0.45, hz: 0.45, matID: 16 },
    { cx: -8, cy: 0.52, cz: 14, hx: 0.7, hy: 0.52, hz: 0.7, matID: 14 },
    { cx: -8, cy: 1.28, cz: 14, hx: 0.45, hy: 0.45, hz: 0.45, matID: 16 },
    { cx: 8, cy: 0.52, cz: 14, hx: 0.7, hy: 0.52, hz: 0.7, matID: 14 },
    { cx: 8, cy: 1.28, cz: 14, hx: 0.45, hy: 0.45, hz: 0.45, matID: 16 },

    // Ceiling light panels
    { cx: -14, cy: 4.72, cz: -5, hx: 2.2, hy: 0.04, hz: 0.8, matID: 15 },
    { cx: -14, cy: 4.72, cz: 5, hx: 2.2, hy: 0.04, hz: 0.8, matID: 15 },
    { cx: 14, cy: 4.72, cz: -5, hx: 2.2, hy: 0.04, hz: 0.8, matID: 15 },
    { cx: 14, cy: 4.72, cz: 5, hx: 2.2, hy: 0.04, hz: 0.8, matID: 15 },
    { cx: 0, cy: 4.72, cz: 0, hx: 3.2, hy: 0.04, hz: 0.75, matID: 15 },
    { cx: 0, cy: 4.72, cz: 19, hx: 3.4, hy: 0.04, hz: 0.75, matID: 15 },
    { cx: 0, cy: 4.72, cz: -19, hx: 3.4, hy: 0.04, hz: 0.75, matID: 15 },
];

export const SPAWN_POINTS = [
    [-25, 1.7, -25],
    [25, 1.7, -25],
    [-25, 1.7, 25],
    [25, 1.7, 25],
    [0, 1.7, -12],
    [0, 1.7, 12],
];

export function buildWorldGeometry() {
    const verts = [];

    pushFloorRect(verts, -ARENA, -ARENA, ARENA, ARENA, 1, 0);
    pushCeilingRect(verts, -ARENA, -ARENA, ARENA, ARENA, 2, WALL_HEIGHT);

    for (const floor of FLOOR_INSETS) {
        pushFloorRect(verts, floor.x1, floor.z1, floor.x2, floor.z2, floor.matID, 0.01);
    }

    for (const wall of MAP_WALLS) {
        pushThickWall(verts, wall.x1, wall.z1, wall.x2, wall.z2, wall.matID, wall.height ?? WALL_HEIGHT);
    }

    for (const box of OFFICE_BOXES) {
        pushBox(verts, box.cx, box.cy, box.cz, box.hx, box.hy, box.hz, box.matID);
    }

    return new Float32Array(verts);
}

function pushFloorRect(verts, x1, z1, x2, z2, matID, y = 0) {
    pushQuad(verts,
        x1, y, z2, 0, 0, matID,
        x2, y, z2, x2 - x1, 0, matID,
        x2, y, z1, x2 - x1, z2 - z1, matID,
        x1, y, z1, 0, z2 - z1, matID
    );
}

function pushCeilingRect(verts, x1, z1, x2, z2, matID, y) {
    pushQuad(verts,
        x1, y, z1, 0, 0, matID,
        x2, y, z1, x2 - x1, 0, matID,
        x2, y, z2, x2 - x1, z2 - z1, matID,
        x1, y, z2, 0, z2 - z1, matID
    );
}

function pushThickWall(verts, x1, z1, x2, z2, matID, height = WALL_HEIGHT) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-8) return;

    const nx = (-dz / len) * WALL_THICK;
    const nz = (dx / len) * WALL_THICK;

    const ax1 = x1 + nx, az1 = z1 + nz;
    const ax2 = x2 + nx, az2 = z2 + nz;
    const bx1 = x1 - nx, bz1 = z1 - nz;
    const bx2 = x2 - nx, bz2 = z2 - nz;

    pushQuad(verts,
        ax1, 0, az1, 0, 0, matID,
        ax2, 0, az2, len, 0, matID,
        ax2, height, az2, len, height, matID,
        ax1, height, az1, 0, height, matID
    );

    pushQuad(verts,
        bx2, 0, bz2, 0, 0, matID,
        bx1, 0, bz1, len, 0, matID,
        bx1, height, bz1, len, height, matID,
        bx2, height, bz2, 0, height, matID
    );

    pushQuad(verts,
        ax1, height, az1, 0, 0, matID,
        ax2, height, az2, len, 0, matID,
        bx2, height, bz2, len, WALL_THICK * 2, matID,
        bx1, height, bz1, 0, WALL_THICK * 2, matID
    );

    pushQuad(verts,
        bx1, 0, bz1, 0, 0, matID,
        ax1, 0, az1, WALL_THICK * 2, 0, matID,
        ax1, height, az1, WALL_THICK * 2, height, matID,
        bx1, height, bz1, 0, height, matID
    );

    pushQuad(verts,
        ax2, 0, az2, 0, 0, matID,
        bx2, 0, bz2, WALL_THICK * 2, 0, matID,
        bx2, height, bz2, WALL_THICK * 2, height, matID,
        ax2, height, az2, 0, height, matID
    );
}

function pushBox(verts, cx, cy, cz, hx, hy, hz, matID) {
    const x0 = cx - hx, x1 = cx + hx;
    const y0 = cy - hy, y1 = cy + hy;
    const z0 = cz - hz, z1 = cz + hz;
    const w = hx * 2, h = hy * 2, d = hz * 2;

    pushQuad(verts, x0, y0, z1, 0, 0, matID, x1, y0, z1, w, 0, matID, x1, y1, z1, w, h, matID, x0, y1, z1, 0, h, matID);
    pushQuad(verts, x1, y0, z0, 0, 0, matID, x0, y0, z0, w, 0, matID, x0, y1, z0, w, h, matID, x1, y1, z0, 0, h, matID);
    pushQuad(verts, x0, y1, z1, 0, 0, matID, x1, y1, z1, w, 0, matID, x1, y1, z0, w, d, matID, x0, y1, z0, 0, d, matID);
    pushQuad(verts, x0, y0, z0, 0, 0, matID, x1, y0, z0, w, 0, matID, x1, y0, z1, w, d, matID, x0, y0, z1, 0, d, matID);
    pushQuad(verts, x1, y0, z1, 0, 0, matID, x1, y0, z0, d, 0, matID, x1, y1, z0, d, h, matID, x1, y1, z1, 0, h, matID);
    pushQuad(verts, x0, y0, z0, 0, 0, matID, x0, y0, z1, d, 0, matID, x0, y1, z1, d, h, matID, x0, y1, z0, 0, h, matID);
}

function pushQuad(verts,
    x0, y0, z0, u0, v0, m0,
    x1, y1, z1, u1, v1, m1,
    x2, y2, z2, u2, v2, m2,
    x3, y3, z3, u3, v3, m3
) {
    pushTri(verts, x0, y0, z0, u0, v0, m0, x1, y1, z1, u1, v1, m1, x2, y2, z2, u2, v2, m2);
    pushTri(verts, x0, y0, z0, u0, v0, m0, x2, y2, z2, u2, v2, m2, x3, y3, z3, u3, v3, m3);
}

function pushTri(verts,
    x0, y0, z0, u0, v0, m0,
    x1, y1, z1, u1, v1, m1,
    x2, y2, z2, u2, v2, m2
) {
    verts.push(x0, y0, z0, u0, v0, m0);
    verts.push(x1, y1, z1, u1, v1, m1);
    verts.push(x2, y2, z2, u2, v2, m2);
}

export function collideWalls(pos, radius) {
    let px = pos[0];
    let pz = pos[2];
    const r = radius + WALL_THICK;

    for (const wall of MAP_WALLS) {
        const closest = closestPointOnSegment(px, pz, wall.x1, wall.z1, wall.x2, wall.z2);
        const dx = px - closest[0];
        const dz = pz - closest[1];
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < r && dist > 1e-8) {
            const push = (r - dist) / dist;
            px += dx * push;
            pz += dz * push;
        }
    }

    pos[0] = px;
    pos[2] = pz;
}

function closestPointOnSegment(px, pz, ax, az, bx, bz) {
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    if (len2 < 1e-12) return [ax, az];
    let t = ((px - ax) * abx + (pz - az) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    return [ax + t * abx, az + t * abz];
}

export function rayHitPlayer(origin, dir, targetPos, halfW, halfH) {
    const dx = targetPos[0] - origin[0];
    const dy = targetPos[1] - origin[1];
    const dz = targetPos[2] - origin[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 50) return false;

    const dot = dx * dir[0] + dy * dir[1] + dz * dir[2];
    if (dot < 0) return false;

    const cx = origin[0] + dir[0] * dot;
    const cy = origin[1] + dir[1] * dot;
    const cz = origin[2] + dir[2] * dot;

    const ex = cx - targetPos[0];
    const ey = cy - targetPos[1];
    const ez = cz - targetPos[2];
    const err = Math.sqrt(ex * ex + ey * ey + ez * ez);

    return err < halfW && Math.abs(cy - targetPos[1]) < halfH;
}
