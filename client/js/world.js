import * as THREE from 'three';
import { getMaterial, getAOMaterial, createBoxMesh, createFloorMaterial } from './renderer.js';

// Office-themed world definition: open software studio with meeting pods and workstations.
// Material IDs: 0=wall panel, 1=carpet, 2=ceiling, 3=metal, 13=glass, 14=wood, 15=screen, 16=plant

let mapArena = 30;
let mapWallHeight = 5;
let mapWallThick = 0.3;
let mapWalls = [];
let mapFloorInsets = [];
let mapBoxes = [];
let mapSpawnPoints = [];
let mapHealthRestorePoints = [];
let shotBlockers = [];

export function getSpawnPoints() {
    return mapSpawnPoints;
}

export function getHealthRestorePoints() {
    return mapHealthRestorePoints;
}

export function loadMap(data) {
    mapArena = data.arena ?? 30;
    mapWallHeight = data.wallHeight ?? 5;
    mapWallThick = data.wallThick ?? 0.3;
    mapWalls = data.walls || [];
    mapFloorInsets = data.floorInsets || [];
    mapBoxes = data.boxes || [];
    mapSpawnPoints = data.spawnPoints || [];
    mapHealthRestorePoints = data.healthRestorePoints || [];
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

// ─── Light emitters: collect ceiling panels (matID 19) and monitors (matID 15) ───

function collectLightEmitters() {
    const emitters = [];
    for (const box of mapBoxes) {
        if (box.matID === 19) {
            // Ceiling panel — faces downward, area light
            emitters.push({
                cx: box.cx, cy: box.cy - box.hy, cz: box.cz, // bottom face
                nx: 0, ny: -1, nz: 0,
                area: box.hx * box.hz * 4, // surface area
                intensity: 1.8,
                color: [1.0, 1.0, 0.95], // warm white
            });
        } else if (box.matID === 15) {
            // Monitor — faces outward (thin in z → faces ±z)
            const faceAxis = box.hz < box.hx ? 'z' : 'x';
            const sign = 1;
            emitters.push({
                cx: box.cx, cy: box.cy, cz: box.cz + (faceAxis === 'z' ? box.hz : 0),
                nx: faceAxis === 'x' ? sign : 0, ny: 0, nz: faceAxis === 'z' ? sign : 0,
                area: (faceAxis === 'z' ? box.hx : box.hz) * box.hy * 4,
                intensity: 0.6,
                color: [0.5, 0.85, 1.0], // monitor cyan
            });
        }
    }
    return emitters;
}

// ─── Baked floor lightmap (AO + direct light from panels) ───

function generateFloorLightmap() {
    const size = 512;
    const light = new Float32Array(size * size * 3); // RGB
    const BASE_AMBIENT = 0.5;
    const SHADOW_RANGE_WALL = 3.5;
    const SHADOW_RANGE_BOX = 2.0;
    const WALL_INTENSITY = 0.45;
    const BOX_INTENSITY = 0.35;

    const emitters = collectLightEmitters();

    function pointToSegmentDist(px, pz, ax, az, bx, bz) {
        const abx = bx - ax, abz = bz - az;
        const len2 = abx * abx + abz * abz;
        if (len2 < 1e-8) return Math.sqrt((px - ax) ** 2 + (pz - az) ** 2);
        let t = ((px - ax) * abx + (pz - az) * abz) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * abx, cz = az + t * abz;
        return Math.sqrt((px - cx) ** 2 + (pz - cz) ** 2);
    }

    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const wx = (px / size) * mapArena * 2 - mapArena;
            const wz = (py / size) * mapArena * 2 - mapArena;
            const idx = (py * size + px) * 3;

            // Start with AO shadows from walls and boxes
            let aoFactor = 1.0;
            for (const wall of mapWalls) {
                const dist = pointToSegmentDist(wx, wz, wall.x1, wall.z1, wall.x2, wall.z2);
                if (dist < SHADOW_RANGE_WALL) {
                    const t = dist / SHADOW_RANGE_WALL;
                    aoFactor = Math.min(aoFactor, 1.0 - (1.0 - t * t) * WALL_INTENSITY);
                }
            }
            for (const box of mapBoxes) {
                if (box.cy > 2.0) continue;
                const dx = Math.max(0, Math.abs(wx - box.cx) - box.hx);
                const dz = Math.max(0, Math.abs(wz - box.cz) - box.hz);
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < SHADOW_RANGE_BOX) {
                    const t = dist / SHADOW_RANGE_BOX;
                    aoFactor = Math.min(aoFactor, 1.0 - (1.0 - t * t) * BOX_INTENSITY);
                }
            }

            // Accumulate direct light from emitters
            let lr = 0, lg = 0, lb = 0;
            for (const em of emitters) {
                const dx = em.cx - wx, dy = em.cy, dz = em.cz - wz; // floor is at y=0
                const dist2 = dx * dx + dy * dy + dz * dz;
                const dist = Math.sqrt(dist2);
                if (dist < 0.1) continue;
                // cos at emitter (how much panel faces this point)
                const cosEmitter = (-em.nx * dx + -em.ny * dy + -em.nz * dz) / dist;
                // cos at floor (floor normal is +Y, direction to emitter is (dx,dy,dz)/dist)
                const cosFloor = dy / dist;
                if (cosEmitter <= 0 || cosFloor <= 0) continue;
                const contribution = em.intensity * em.area * cosEmitter * cosFloor / (dist2 + 1);
                lr += contribution * em.color[0];
                lg += contribution * em.color[1];
                lb += contribution * em.color[2];
            }

            // Combine: ambient darkened by AO + direct light
            const r = Math.min(1, aoFactor * BASE_AMBIENT + lr);
            const g = Math.min(1, aoFactor * BASE_AMBIENT + lg);
            const b = Math.min(1, aoFactor * BASE_AMBIENT + lb);
            light[idx]     = r;
            light[idx + 1] = g;
            light[idx + 2] = b;
        }
    }

    // Box blur (3 passes)
    const tmp = new Float32Array(size * size * 3);
    for (let pass = 0; pass < 3; pass++) {
        const radius = 4;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let sr = 0, sg = 0, sb = 0, count = 0;
                for (let dx = -radius; dx <= radius; dx++) {
                    const sx = x + dx;
                    if (sx >= 0 && sx < size) {
                        const si = (y * size + sx) * 3;
                        sr += light[si]; sg += light[si+1]; sb += light[si+2]; count++;
                    }
                }
                const ti = (y * size + x) * 3;
                tmp[ti] = sr/count; tmp[ti+1] = sg/count; tmp[ti+2] = sb/count;
            }
        }
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let sr = 0, sg = 0, sb = 0, count = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    const sy = y + dy;
                    if (sy >= 0 && sy < size) {
                        const si = (sy * size + x) * 3;
                        sr += tmp[si]; sg += tmp[si+1]; sb += tmp[si+2]; count++;
                    }
                }
                const li = (y * size + x) * 3;
                light[li] = sr/count; light[li+1] = sg/count; light[li+2] = sb/count;
            }
        }
    }

    const cvs = document.createElement('canvas');
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
        imageData.data[i * 4]     = Math.round(Math.min(1, light[i*3])   * 255);
        imageData.data[i * 4 + 1] = Math.round(Math.min(1, light[i*3+1]) * 255);
        imageData.data[i * 4 + 2] = Math.round(Math.min(1, light[i*3+2]) * 255);
        imageData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    const tex = new THREE.CanvasTexture(cvs);
    tex.flipY = false;
    return tex;
}

// ─── Baked per-vertex AO for walls and props ───

// Pre-computed hemisphere sample directions (cosine-weighted, normal = +Y)
const AO_SAMPLES = [];
{
    const N = 24;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
        const theta = goldenAngle * i;
        const r = Math.sqrt((i + 0.5) / N); // cosine-weighted: more samples near horizon
        const y = Math.sqrt(1 - r * r);
        AO_SAMPLES.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
    }
}

function rayHitsAABB(ox, oy, oz, dx, dy, dz, min, max, maxDist) {
    let tMin = 0, tMax = maxDist;
    for (let a = 0; a < 3; a++) {
        const o = a === 0 ? ox : a === 1 ? oy : oz;
        const d = a === 0 ? dx : a === 1 ? dy : dz;
        const lo = min[a], hi = max[a];
        if (Math.abs(d) < 1e-8) {
            if (o < lo || o > hi) return false;
            continue;
        }
        const invD = 1 / d;
        let t1 = (lo - o) * invD, t2 = (hi - o) * invD;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return false;
    }
    return true;
}

function rotateHemisphereSample(sx, sy, sz, nx, ny, nz) {
    // Rotate sample from +Y hemisphere to arbitrary normal hemisphere
    // Build tangent frame from normal
    let tx, ty, tz, bx, by, bz;
    if (Math.abs(ny) < 0.99) {
        // cross(normal, up)
        tx = nz; ty = 0; tz = -nx;
        const tlen = Math.sqrt(tx * tx + tz * tz);
        tx /= tlen; tz /= tlen;
    } else {
        // Normal is nearly +/-Y, use X as reference
        tx = 1; ty = 0; tz = 0;
    }
    // bitangent = cross(normal, tangent)
    bx = ny * tz - nz * ty;
    by = nz * tx - nx * tz;
    bz = nx * ty - ny * tx;
    // Transform: sample.x * tangent + sample.y * normal + sample.z * bitangent
    return [
        sx * tx + sy * nx + sz * bx,
        sx * ty + sy * ny + sz * by,
        sx * tz + sy * nz + sz * bz,
    ];
}

function computeWorldLighting(meshes) {
    const AO_RANGE = 4.0;
    const AO_INTENSITY = 0.5;
    const BASE_AMBIENT = 0.5;

    const emitters = collectLightEmitters();

    // Collect all scene AABBs for occlusion testing
    const aabbs = [];
    for (const wall of mapWalls) {
        aabbs.push(toWallBox(wall));
    }
    for (const box of mapBoxes) {
        aabbs.push({
            min: [box.cx - box.hx, box.cy - box.hy, box.cz - box.hz],
            max: [box.cx + box.hx, box.cy + box.hy, box.cz + box.hz],
        });
    }
    aabbs.push({ min: [-mapArena, -0.5, -mapArena], max: [mapArena, 0, mapArena] });
    aabbs.push({ min: [-mapArena, mapWallHeight, -mapArena], max: [mapArena, mapWallHeight + 0.5, mapArena] });

    for (const mesh of meshes) {
        const geo = mesh.geometry;
        const posAttr = geo.getAttribute('position');
        if (!posAttr) continue;
        if (!geo.getAttribute('normal')) geo.computeVertexNormals();
        const normalAttr = geo.getAttribute('normal');
        if (!normalAttr) continue;

        const count = posAttr.count;
        const colors = new Float32Array(count * 3);
        const mx = mesh.position.x, my = mesh.position.y, mz = mesh.position.z;

        for (let i = 0; i < count; i++) {
            const vx = posAttr.getX(i) + mx;
            const vy = posAttr.getY(i) + my;
            const vz = posAttr.getZ(i) + mz;
            const vnx = normalAttr.getX(i);
            const vny = normalAttr.getY(i);
            const vnz = normalAttr.getZ(i);

            const ox = vx + vnx * 0.05;
            const oy = vy + vny * 0.05;
            const oz = vz + vnz * 0.05;

            // Hemisphere AO
            let blocked = 0;
            for (let s = 0; s < AO_SAMPLES.length; s++) {
                const [sx, sy, sz] = AO_SAMPLES[s];
                const [rdx, rdy, rdz] = rotateHemisphereSample(sx, sy, sz, vnx, vny, vnz);
                for (let a = 0; a < aabbs.length; a++) {
                    if (rayHitsAABB(ox, oy, oz, rdx, rdy, rdz, aabbs[a].min, aabbs[a].max, AO_RANGE)) {
                        blocked++;
                        break;
                    }
                }
            }
            const aoFactor = 1 - (blocked / AO_SAMPLES.length) * AO_INTENSITY;

            // Direct light from emitters
            let lr = 0, lg = 0, lb = 0;
            for (const em of emitters) {
                const dx = em.cx - ox, dy = em.cy - oy, dz = em.cz - oz;
                const dist2 = dx * dx + dy * dy + dz * dz;
                const dist = Math.sqrt(dist2);
                if (dist < 0.1) continue;
                // cos at vertex (how much vertex faces emitter)
                const cosVertex = (vnx * dx + vny * dy + vnz * dz) / dist;
                // cos at emitter (how much emitter faces vertex)
                const cosEmitter = (-em.nx * dx + -em.ny * dy + -em.nz * dz) / dist;
                if (cosVertex <= 0 || cosEmitter <= 0) continue;
                // Visibility check: ray from vertex to emitter
                let visible = true;
                for (let a = 0; a < aabbs.length; a++) {
                    if (rayHitsAABB(ox, oy, oz, dx/dist, dy/dist, dz/dist, aabbs[a].min, aabbs[a].max, dist - 0.1)) {
                        visible = false;
                        break;
                    }
                }
                if (!visible) continue;
                const contribution = em.intensity * em.area * cosVertex * cosEmitter / (dist2 + 1);
                lr += contribution * em.color[0];
                lg += contribution * em.color[1];
                lb += contribution * em.color[2];
            }

            // Combine: AO-darkened ambient + direct light
            colors[i * 3]     = Math.min(1, aoFactor * BASE_AMBIENT + lr);
            colors[i * 3 + 1] = Math.min(1, aoFactor * BASE_AMBIENT + lg);
            colors[i * 3 + 2] = Math.min(1, aoFactor * BASE_AMBIENT + lb);
        }

        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const matID = mesh.userData.matID;
        if (matID != null) {
            mesh.material = getAOMaterial(matID);
        } else if (mesh.material && !mesh.material.vertexColors) {
            const aoMat = mesh.material.clone();
            aoMat.vertexColors = true;
            mesh.material = aoMat;
        }
    }
}

export function buildWorldGeometry(opts = {}) {
    const hideCeiling = opts.hideCeiling === true;
    const skipFloorAO = opts.skipFloorAO === true;
    const meshes = [];
    // Editor skips AO: generateFloorAO is O(512² × geometry) and was freezing every rebuild while dragging.
    const floorAO = skipFloorAO ? null : generateFloorLightmap();

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
    const aoTargets = []; // meshes that should receive baked vertex AO
    for (const [matID, positions] of wallVerts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.computeVertexNormals();
        const mat = getMaterial(matID);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.matID = matID;
        meshes.push(mesh);
        aoTargets.push(mesh);
    }

    // Office props
    for (const box of mapBoxes) {
        const mesh = createBoxMesh(box.cx, box.cy, box.cz, box.hx, box.hy, box.hz, box.matID);
        meshes.push(mesh);
        aoTargets.push(mesh);
    }

    // Bake per-vertex ambient occlusion on walls and props
    if (!skipFloorAO) {
        computeWorldLighting(aoTargets);
    }

    // Emissive point lights at ceiling panel positions (matID 19)
    // Placed well below the panel to illuminate the room, not scorch the ceiling.
    // Low intensity — these complement the baked lighting, not replace it.
    if (!skipFloorAO) {
        let lightCount = 0;
        for (const box of mapBoxes) {
            if (box.matID === 19 && lightCount < 8) {
                const light = new THREE.PointLight(0xfff4e8, 0.6, 18, 2);
                light.position.set(box.cx, box.cy - box.hy - 1.5, box.cz);
                light.castShadow = false;
                meshes.push(light);
                lightCount++;
            }
        }
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
