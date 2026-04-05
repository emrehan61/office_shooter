import * as THREE from 'three';
import { getMaterial, createBoxMesh, createFloorMaterial } from './renderer.js';

// Office-themed world definition: open software studio with meeting pods and workstations.
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

// ─── Baked floor AO lightmap ───

function generateFloorAO() {
    const size = 512;
    const ao = new Float32Array(size * size).fill(1.0);
    const SHADOW_RANGE_WALL = 3.5;
    const SHADOW_RANGE_BOX = 2.0;
    const WALL_INTENSITY = 0.45;
    const BOX_INTENSITY = 0.35;

    function worldToPixel(wx, wz) {
        return [
            ((wx + mapArena) / (mapArena * 2)) * size,
            ((wz + mapArena) / (mapArena * 2)) * size,
        ];
    }

    function pointToSegmentDist(px, pz, ax, az, bx, bz) {
        const abx = bx - ax, abz = bz - az;
        const len2 = abx * abx + abz * abz;
        if (len2 < 1e-8) return Math.sqrt((px - ax) ** 2 + (pz - az) ** 2);
        let t = ((px - ax) * abx + (pz - az) * abz) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * abx, cz = az + t * abz;
        return Math.sqrt((px - cx) ** 2 + (pz - cz) ** 2);
    }

    // Paint wall shadows
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const wx = (px / size) * mapArena * 2 - mapArena;
            const wz = (py / size) * mapArena * 2 - mapArena;
            const idx = py * size + px;

            for (const wall of mapWalls) {
                const dist = pointToSegmentDist(wx, wz, wall.x1, wall.z1, wall.x2, wall.z2);
                if (dist < SHADOW_RANGE_WALL) {
                    const t = dist / SHADOW_RANGE_WALL;
                    const shadow = 1.0 - (1.0 - t * t) * WALL_INTENSITY;
                    ao[idx] = Math.min(ao[idx], shadow);
                }
            }

            for (const box of mapBoxes) {
                if (box.cy > 2.0) continue; // skip ceiling-mounted stuff
                const dx = Math.max(0, Math.abs(wx - box.cx) - box.hx);
                const dz = Math.max(0, Math.abs(wz - box.cz) - box.hz);
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < SHADOW_RANGE_BOX) {
                    const t = dist / SHADOW_RANGE_BOX;
                    const shadow = 1.0 - (1.0 - t * t) * BOX_INTENSITY;
                    ao[idx] = Math.min(ao[idx], shadow);
                }
            }
        }
    }

    // Box blur (3 passes for smooth falloff)
    const tmp = new Float32Array(size * size);
    for (let pass = 0; pass < 3; pass++) {
        const radius = 4;
        // Horizontal
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let sum = 0, count = 0;
                for (let dx = -radius; dx <= radius; dx++) {
                    const sx = x + dx;
                    if (sx >= 0 && sx < size) { sum += ao[y * size + sx]; count++; }
                }
                tmp[y * size + x] = sum / count;
            }
        }
        // Vertical
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let sum = 0, count = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    const sy = y + dy;
                    if (sy >= 0 && sy < size) { sum += tmp[sy * size + x]; count++; }
                }
                ao[y * size + x] = sum / count;
            }
        }
    }

    // Paint to canvas
    const cvs = document.createElement('canvas');
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
        const v = Math.round(ao[i] * 255);
        imageData.data[i * 4 + 0] = v;
        imageData.data[i * 4 + 1] = v;
        imageData.data[i * 4 + 2] = v;
        imageData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    const tex = new THREE.CanvasTexture(cvs);
    tex.flipY = false;
    return tex;
}

export function buildWorldGeometry(opts = {}) {
    const hideCeiling = opts.hideCeiling === true;
    const skipFloorAO = opts.skipFloorAO === true;
    const meshes = [];
    // Editor skips AO: generateFloorAO is O(512² × geometry) and was freezing every rebuild while dragging.
    const floorAO = skipFloorAO ? null : generateFloorAO();

    // Floor with baked AO (or flat material when skipFloorAO)
    meshes.push(createFloorMesh(-mapArena, -mapArena, mapArena, mapArena, 1, 0, floorAO));
    // Ceiling (no AO) — omitted in map editor so orbit view isn’t covered by the roof
    if (!hideCeiling) {
        meshes.push(createFloorMesh(-mapArena, -mapArena, mapArena, mapArena, 2, mapWallHeight, null));
    }

    for (const floor of mapFloorInsets) {
        meshes.push(createFloorMesh(floor.x1, floor.z1, floor.x2, floor.z2, floor.matID, 0.01, floorAO));
    }

    // Walls
    const wallVerts = new Map();
    for (const wall of mapWalls) {
        pushThickWall(wallVerts, wall.x1, wall.z1, wall.x2, wall.z2, wall.matID, wall.height ?? mapWallHeight);
    }
    for (const [matID, positions] of wallVerts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.computeVertexNormals();
        const mat = getMaterial(matID);
        const mesh = new THREE.Mesh(geo, mat);
        const isTransparent = mat.transparent === true;
        mesh.castShadow = !isTransparent;
        mesh.receiveShadow = !isTransparent;
        meshes.push(mesh);
    }

    // Office props
    for (const box of mapBoxes) {
        meshes.push(createBoxMesh(box.cx, box.cy, box.cz, box.hx, box.hy, box.hz, box.matID));
    }

    return meshes;
}

function createFloorMesh(x1, z1, x2, z2, matID, y, aoTexture) {
    const w = Math.abs(x2 - x1);
    const d = Math.abs(z2 - z1);
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);

    if (aoTexture) {
        // UV2 maps world position to lightmap: (worldX + mapArena) / (2*mapArena)
        const posAttr = geo.getAttribute('position');
        const uv2 = new Float32Array(posAttr.count * 2);
        for (let i = 0; i < posAttr.count; i++) {
            // After rotateX(-PI/2), local X → world X offset, local Z → world Z offset
            const lx = posAttr.getX(i);
            const lz = posAttr.getZ(i);
            uv2[i * 2]     = (lx + cx + mapArena) / (mapArena * 2);
            uv2[i * 2 + 1] = (lz + cz + mapArena) / (mapArena * 2);
        }
        geo.setAttribute('uv2', new THREE.Float32BufferAttribute(uv2, 2));
    }

    const mat = aoTexture ? createFloorMaterial(matID, aoTexture) : getMaterial(matID);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, y, cz);
    mesh.receiveShadow = true;
    return mesh;
}

function pushThickWall(buckets, x1, z1, x2, z2, matID, height = mapWallHeight) {
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

    let positions = buckets.get(matID);
    if (!positions) {
        positions = [];
        buckets.set(matID, positions);
    }

    // Front face
    pushQuadPositions(positions, ax1,0,az1, ax2,0,az2, ax2,height,az2, ax1,height,az1);
    // Back face
    pushQuadPositions(positions, bx2,0,bz2, bx1,0,bz1, bx1,height,bz1, bx2,height,bz2);
    // Top
    pushQuadPositions(positions, ax1,height,az1, ax2,height,az2, bx2,height,bz2, bx1,height,bz1);
    // Left cap
    pushQuadPositions(positions, bx1,0,bz1, ax1,0,az1, ax1,height,az1, bx1,height,bz1);
    // Right cap
    pushQuadPositions(positions, ax2,0,az2, bx2,0,bz2, bx2,height,bz2, ax2,height,az2);
}

function pushQuadPositions(positions, x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3) {
    positions.push(x0,y0,z0, x1,y1,z1, x2,y2,z2);
    positions.push(x0,y0,z0, x2,y2,z2, x3,y3,z3);
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
                max: [pos[0] + 0.42, footY + 0.92, pos[2] + 0.32],
            },
            {
                min: [pos[0] - 0.32, footY, pos[2] - 0.28],
                max: [pos[0] + 0.32, footY + 0.44, pos[2] + 0.28],
            },
        ];
    }

    return [
        {
            min: [pos[0] - 0.24, footY + 1.42, pos[2] - 0.24],
            max: [pos[0] + 0.24, footY + 1.94, pos[2] + 0.24],
        },
        {
            min: [pos[0] - 0.42, footY + 0.72, pos[2] - 0.32],
            max: [pos[0] + 0.42, footY + 1.38, pos[2] + 0.32],
        },
        {
            min: [pos[0] - 0.32, footY, pos[2] - 0.28],
            max: [pos[0] + 0.32, footY + 0.7, pos[2] + 0.28],
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
