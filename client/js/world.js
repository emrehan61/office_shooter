// World geometry and collision.
// Vertex format: pos(3) + uv(2) + matID(1) per vertex.
// Material IDs: 0=wall panel, 1=carpet, 2=ceiling, 3=metal, 13=glass, 14=wood, 15=screen, 16=plant

let mapArena = 30;
let mapWallHeight = 5;
let mapWallThick = 0.3;
let mapWalls = [];
let mapFloorInsets = [];
let mapBoxes = [];
let mapSpawnPoints = [];
let shotBlockers = [];

export function getSpawnPoints() {
    return mapSpawnPoints;
}

export function loadMap(data) {
    mapArena = data.arena ?? 30;
    mapWallHeight = data.wallHeight ?? 5;
    mapWallThick = data.wallThick ?? 0.3;
    mapWalls = data.walls || [];
    mapFloorInsets = data.floorInsets || [];
    mapBoxes = data.boxes || [];
    mapSpawnPoints = data.spawnPoints || [];
    rebuildShotBlockers();
}

function rebuildShotBlockers() {
    shotBlockers = [
        ...mapWalls.map(toWallBox),
        ...mapBoxes.map((box) => ({
            min: [box.cx - box.hx, box.cy - box.hy, box.cz - box.hz],
            max: [box.cx + box.hx, box.cy + box.hy, box.cz + box.hz],
        })),
        { min: [-mapArena, -0.2, -mapArena], max: [mapArena, 0, mapArena] },
        { min: [-mapArena, mapWallHeight, -mapArena], max: [mapArena, mapWallHeight + 0.2, mapArena] },
    ];
}

export function buildWorldGeometry() {
    const verts = [];

    pushFloorRect(verts, -mapArena, -mapArena, mapArena, mapArena, 1, 0);
    pushCeilingRect(verts, -mapArena, -mapArena, mapArena, mapArena, 2, mapWallHeight);

    for (const floor of mapFloorInsets) {
        pushFloorRect(verts, floor.x1, floor.z1, floor.x2, floor.z2, floor.matID, 0.01);
    }

    for (const wall of mapWalls) {
        pushThickWall(verts, wall.x1, wall.z1, wall.x2, wall.z2, wall.matID, wall.height ?? mapWallHeight);
    }

    for (const box of mapBoxes) {
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

function pushThickWall(verts, x1, z1, x2, z2, matID, height = mapWallHeight) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-8) return;

    const nx = (-dz / len) * mapWallThick;
    const nz = (dx / len) * mapWallThick;

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
        bx2, height, bz2, len, mapWallThick * 2, matID,
        bx1, height, bz1, 0, mapWallThick * 2, matID
    );

    pushQuad(verts,
        bx1, 0, bz1, 0, 0, matID,
        ax1, 0, az1, mapWallThick * 2, 0, matID,
        ax1, height, az1, mapWallThick * 2, height, matID,
        bx1, height, bz1, 0, height, matID
    );

    pushQuad(verts,
        ax2, 0, az2, 0, 0, matID,
        bx2, 0, bz2, mapWallThick * 2, 0, matID,
        bx2, height, bz2, mapWallThick * 2, height, matID,
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
    const r = radius + mapWallThick;

    for (const wall of mapWalls) {
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

    // Box collision: push player circle out of each AABB in XZ if Y overlaps
    const playerFoot = pos[1] - 1.7; // approximate feet position
    const playerTop = pos[1] + 0.1;
    for (const box of mapBoxes) {
        const bMinY = box.cy - box.hy;
        const bMaxY = box.cy + box.hy;
        if (playerTop < bMinY || playerFoot > bMaxY) continue;

        const bx0 = box.cx - box.hx, bx1 = box.cx + box.hx;
        const bz0 = box.cz - box.hz, bz1 = box.cz + box.hz;

        const cx = Math.max(bx0, Math.min(px, bx1));
        const cz = Math.max(bz0, Math.min(pz, bz1));
        const dx = px - cx;
        const dz = pz - cz;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < radius && dist > 1e-8) {
            const push = (radius - dist) / dist;
            px += dx * push;
            pz += dz * push;
        } else if (dist < 1e-8 && px >= bx0 && px <= bx1 && pz >= bz0 && pz <= bz1) {
            // player center is inside the box — push out on the shortest axis
            const pushXn = px - bx0 + radius;
            const pushXp = bx1 - px + radius;
            const pushZn = pz - bz0 + radius;
            const pushZp = bz1 - pz + radius;
            const minPush = Math.min(pushXn, pushXp, pushZn, pushZp);
            if (minPush === pushXn) px = bx0 - radius;
            else if (minPush === pushXp) px = bx1 + radius;
            else if (minPush === pushZn) pz = bz0 - radius;
            else pz = bz1 + radius;
        }
    }

    pos[0] = px;
    pos[2] = pz;
}

export function traceShotImpact(origin, dir, players = {}, shooterId = null, maxRange = 50) {
    let bestDist = maxRange;

    for (const box of shotBlockers) {
        const dist = rayAABBIntersection(origin, dir, box.min, box.max, maxRange);
        if (dist != null && dist < bestDist) {
            bestDist = dist;
        }
    }

    for (const [id, player] of Object.entries(players || {})) {
        if (player == null || player.alive === false) continue;
        if (shooterId != null && Number(id) === Number(shooterId)) continue;
        for (const box of playerHitBoxes(player.pos, !!player.crouching)) {
            const dist = rayAABBIntersection(origin, dir, box.min, box.max, maxRange);
            if (dist != null && dist < bestDist) {
                bestDist = dist;
            }
        }
    }

    return [
        origin[0] + dir[0] * bestDist,
        origin[1] + dir[1] * bestDist,
        origin[2] + dir[2] * bestDist,
    ];
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

function toWallBox(wall) {
    const height = wall.height ?? mapWallHeight;
    const minX = Math.min(wall.x1, wall.x2) - mapWallThick;
    const maxX = Math.max(wall.x1, wall.x2) + mapWallThick;
    const minZ = Math.min(wall.z1, wall.z2) - mapWallThick;
    const maxZ = Math.max(wall.z1, wall.z2) + mapWallThick;
    return {
        min: [minX, 0, minZ],
        max: [maxX, height, maxZ],
    };
}

function playerHitBoxes(pos, crouching) {
    const eyeHeight = crouching ? 1.15 : 1.7;
    const footY = pos[1] - eyeHeight;

    if (crouching) {
        return [
            {
                min: [pos[0] - 0.24, footY + 0.92, pos[2] - 0.24],
                max: [pos[0] + 0.24, footY + 1.3, pos[2] + 0.24],
            },
            {
                min: [pos[0] - 0.42, footY + 0.44, pos[2] - 0.32],
                max: [pos[0] + 0.42, footY + 0.96, pos[2] + 0.32],
            },
        ];
    }

    return [
        {
            min: [pos[0] - 0.24, footY + 1.36, pos[2] - 0.24],
            max: [pos[0] + 0.24, footY + 1.78, pos[2] + 0.24],
        },
        {
            min: [pos[0] - 0.42, footY + 0.58, pos[2] - 0.32],
            max: [pos[0] + 0.42, footY + 1.38, pos[2] + 0.32],
        },
    ];
}

export function rayAABBIntersection(origin, dir, min, max, maxRange) {
    let tMin = 0;
    let tMax = maxRange;

    for (let axis = 0; axis < 3; axis += 1) {
        const o = origin[axis];
        const d = dir[axis];
        const mn = min[axis];
        const mx = max[axis];

        if (Math.abs(d) < 1e-8) {
            if (o < mn || o > mx) {
                return null;
            }
            continue;
        }

        let t1 = (mn - o) / d;
        let t2 = (mx - o) / d;
        if (t1 > t2) {
            const swap = t1;
            t1 = t2;
            t2 = swap;
        }

        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) {
            return null;
        }
    }

    return tMin >= 0 && tMin <= maxRange ? tMin : null;
}
