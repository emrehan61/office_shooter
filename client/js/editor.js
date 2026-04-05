import * as THREE from 'three';
import { createRenderer, uploadWorldGeo, render, resizeRenderer, clearDynamic, vertsToGroup } from './renderer.js';
import { buildWorldGeometry, loadMap, rayAABBIntersection } from './world.js';

// ── Material palette ───────────────────────────────────────────────
const MATERIALS = [
    { id: 0, name: 'Wall Panel' },
    { id: 1, name: 'Carpet' },
    { id: 2, name: 'Ceiling' },
    { id: 3, name: 'Metal' },
    { id: 13, name: 'Glass' },
    { id: 14, name: 'Wood' },
    { id: 15, name: 'Screen' },
    { id: 16, name: 'Plant' },
];

const HIGHLIGHT_MAT = 0; // wall panel — readable selection without emissive/bloom

// ── Prefab models (arrays of box offsets relative to placement point) ──
const PREFABS = {
    table: {
        label: 'Table',
        boxes: [
            { cx: 0, cy: 1.12, cz: 0, hx: 2.25, hy: 0.08, hz: 1.12, matID: 14 },
            { cx: -2.0, cy: 0.52, cz: -0.9, hx: 0.09, hy: 0.52, hz: 0.09, matID: 3 },
            { cx: 2.0, cy: 0.52, cz: -0.9, hx: 0.09, hy: 0.52, hz: 0.09, matID: 3 },
            { cx: -2.0, cy: 0.52, cz: 0.9, hx: 0.09, hy: 0.52, hz: 0.09, matID: 3 },
            { cx: 2.0, cy: 0.52, cz: 0.9, hx: 0.09, hy: 0.52, hz: 0.09, matID: 3 },
        ],
    },
    chair: {
        label: 'Chair',
        boxes: [
            { cx: 0, cy: 0.63, cz: 0, hx: 0.52, hy: 0.06, hz: 0.52, matID: 14 },
            { cx: 0, cy: 1.08, cz: -0.46, hx: 0.52, hy: 0.39, hz: 0.06, matID: 14 },
            { cx: -0.42, cy: 0.3, cz: -0.42, hx: 0.06, hy: 0.3, hz: 0.06, matID: 3 },
            { cx: 0.42, cy: 0.3, cz: -0.42, hx: 0.06, hy: 0.3, hz: 0.06, matID: 3 },
            { cx: -0.42, cy: 0.3, cz: 0.42, hx: 0.06, hy: 0.3, hz: 0.06, matID: 3 },
            { cx: 0.42, cy: 0.3, cz: 0.42, hx: 0.06, hy: 0.3, hz: 0.06, matID: 3 },
        ],
    },
    desk: {
        label: 'Desk',
        boxes: [
            { cx: 0, cy: 1.11, cz: 0, hx: 1.8, hy: 0.06, hz: 0.82, matID: 14 },
            { cx: -1.72, cy: 0.54, cz: 0, hx: 0.06, hy: 0.54, hz: 0.75, matID: 14 },
            { cx: 1.72, cy: 0.54, cz: 0, hx: 0.06, hy: 0.54, hz: 0.75, matID: 14 },
            { cx: 0, cy: 0.54, cz: -0.75, hx: 1.72, hy: 0.54, hz: 0.06, matID: 14 },
        ],
    },
    shelf: {
        label: 'Shelf',
        boxes: [
            { cx: -0.78, cy: 1.35, cz: 0, hx: 0.06, hy: 1.35, hz: 0.45, matID: 14 },
            { cx: 0.78, cy: 1.35, cz: 0, hx: 0.06, hy: 1.35, hz: 0.45, matID: 14 },
            { cx: 0, cy: 0.06, cz: 0, hx: 0.75, hy: 0.06, hz: 0.45, matID: 14 },
            { cx: 0, cy: 0.9, cz: 0, hx: 0.75, hy: 0.06, hz: 0.45, matID: 14 },
            { cx: 0, cy: 1.8, cz: 0, hx: 0.75, hy: 0.06, hz: 0.45, matID: 14 },
            { cx: 0, cy: 2.7, cz: 0, hx: 0.75, hy: 0.06, hz: 0.45, matID: 14 },
        ],
    },
    bench: {
        label: 'Bench',
        boxes: [
            { cx: 0, cy: 0.57, cz: 0, hx: 2.1, hy: 0.08, hz: 0.45, matID: 14 },
            { cx: -1.8, cy: 0.25, cz: 0, hx: 0.09, hy: 0.25, hz: 0.38, matID: 3 },
            { cx: 1.8, cy: 0.25, cz: 0, hx: 0.09, hy: 0.25, hz: 0.38, matID: 3 },
        ],
    },
    crate: {
        label: 'Crate',
        boxes: [
            { cx: 0, cy: 0.6, cz: 0, hx: 0.6, hy: 0.6, hz: 0.6, matID: 14 },
        ],
    },
    barrel: {
        label: 'Barrel',
        boxes: [
            { cx: 0, cy: 0.75, cz: 0, hx: 0.48, hy: 0.75, hz: 0.48, matID: 3 },
        ],
    },
    monitor: {
        label: 'Monitor',
        boxes: [
            { cx: 0, cy: 1.23, cz: 0, hx: 0.6, hy: 0.42, hz: 0.05, matID: 15 },
            { cx: 0, cy: 0.78, cz: 0, hx: 0.09, hy: 0.06, hz: 0.15, matID: 3 },
        ],
    },
};

// ── Map state ──────────────────────────────────────────────────────
let mapData = {
    name: 'Untitled',
    arena: 30,
    wallHeight: 5,
    wallThick: 0.3,
    walls: [],
    floorInsets: [],
    boxes: [],
    spawnPoints: [],
};

let selectedType = null; // 'wall' | 'box' | 'floorInset' | 'spawn'
let selectedIndex = -1;
let dirty = true;

// ── Undo stack ─────────────────────────────────────────────────────
const UNDO_LIMIT = 50;
const undoStack = [];

function cloneMap() {
    return JSON.parse(JSON.stringify(mapData));
}

function pushUndo() {
    undoStack.push(cloneMap());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function undo() {
    if (undoStack.length === 0) { setStatus('Nothing to undo'); return; }
    const prev = undoStack.pop();
    mapData = prev;
    document.getElementById('map-name').value = mapData.name;
    document.getElementById('arena-size').value = mapData.arena;
    selectedType = null;
    selectedIndex = -1;
    dirty = true;
    updateProperties();
    setStatus(`Undo (${undoStack.length} left)`);
}

// ── Scale/resize state ─────────────────────────────────────────────
let scaleEdge = null;

// ── Tool mode & gizmo state ────────────────────────────────────────
// matID 20=emissive red(X), 21=emissive green(Y), 22=emissive blue(Z)
const AXIS_MAT_X = 20, AXIS_MAT_Y = 21, AXIS_MAT_Z = 22;
const GIZMO_LEN = 3.0;
const GIZMO_HANDLE = 0.3;

let activeTool = 'select'; // 'select' | 'move' | 'scale' | 'rotate'
let activeAxis = null;     // null | 'x' | 'y' | 'z'
let gizmoDragStartT = 0;
let gizmoDragOriginObj = null; // snapshot of object position at drag start
let rotateDragStartAngle = 0;

// ── Group system for prefab objects ────────────────────────────────
let nextGroupId = 1;

function getGroupIndices() {
    if (selectedType !== 'box' || selectedIndex < 0) return [selectedIndex];
    const box = mapData.boxes[selectedIndex];
    if (box.group == null) return [selectedIndex];
    const indices = [];
    for (let i = 0; i < mapData.boxes.length; i++) {
        if (mapData.boxes[i].group === box.group) indices.push(i);
    }
    return indices;
}

function syncNextGroupId() {
    nextGroupId = 1;
    for (const b of mapData.boxes) {
        if (b.group != null && b.group >= nextGroupId) nextGroupId = b.group + 1;
    }
}

// ── Clipboard ─────────────────────────────────────────────────────
let clipboard = null; // { type, data }

// ── Renderer ───────────────────────────────────────────────────────
const canvas = document.getElementById('viewport');
const renderer = createRenderer(canvas, { editor: true });
renderer.scene.fog = null; // editor needs clear long-range view
renderer.camera.far = 500;

// Grid lives outside dynamicGroup so we do not dispose/rebuild vertsToGroup(grid) every frame.
const editorGridGroup = new THREE.Group();
editorGridGroup.name = 'editorGrid';
renderer.scene.add(editorGridGroup);
let editorGridArenaKey = NaN;

function disposeEditorGeometryOnly(obj) {
    obj.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
    });
}

function syncEditorGridMesh() {
    if (editorGridArenaKey === mapData.arena) return;
    editorGridArenaKey = mapData.arena;
    while (editorGridGroup.children.length > 0) {
        const c = editorGridGroup.children[0];
        editorGridGroup.remove(c);
        disposeEditorGeometryOnly(c);
    }
    const verts = buildGridVerts();
    if (verts.length) editorGridGroup.add(vertsToGroup(verts));
}

// ── Orbit camera ───────────────────────────────────────────────────
const orbit = {
    theta: Math.PI * 0.75,
    phi: Math.PI / 4,
    distance: 60,
    target: [0, 0, 0],
    fov: Math.PI / 3,
    near: 0.1,
    far: 500,
};

// ── Resize ─────────────────────────────────────────────────────────
function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    resizeRenderer(renderer, canvas.width, canvas.height);
    renderer.camera.far = orbit.far;
    renderer.camera.near = orbit.near;
    renderer.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ── Snap helper ────────────────────────────────────────────────────
function snap(val) {
    const enabled = document.getElementById('snap-enabled').checked;
    if (!enabled) return val;
    const size = parseFloat(document.getElementById('snap-size').value) || 0.5;
    return Math.round(val / size) * size;
}

function buildGridVerts() {
    const verts = [];
    const a = mapData.arena;
    const step = 5;
    const y = 0.005;
    const mat = 3; // metal — subtle gray
    const t = 0.02;

    for (let x = -a; x <= a; x += step) {
        pushLine(verts, x, y, -a, x, y, a, t, mat);
    }
    for (let z = -a; z <= a; z += step) {
        pushLine(verts, -a, y, z, a, y, z, t, mat);
    }
    return verts;
}

function pushLine(v, x1, y, z1, x2, y2, z2, t, mat) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) return;
    const nx = (-dz / len) * t, nz = (dx / len) * t;

    v.push(x1 + nx, y, z1 + nz, 0, 0, mat);
    v.push(x2 + nx, y2, z2 + nz, 1, 0, mat);
    v.push(x2 - nx, y2, z2 - nz, 1, 1, mat);

    v.push(x1 + nx, y, z1 + nz, 0, 0, mat);
    v.push(x2 - nx, y2, z2 - nz, 1, 1, mat);
    v.push(x1 - nx, y, z1 - nz, 0, 1, mat);
}

// ── Spawn marker geometry ──────────────────────────────────────────
function buildSpawnVerts() {
    const verts = [];
    for (let i = 0; i < mapData.spawnPoints.length; i++) {
        const sp = mapData.spawnPoints[i];
        const isSelected = selectedType === 'spawn' && selectedIndex === i;
        const mat = isSelected ? HIGHLIGHT_MAT : 16;
        const cx = sp[0], cy = sp[1], cz = sp[2];
        pushCross(verts, cx, 0.02, cz, 0.6, mat);
        pushVLine(verts, cx, 0.02, cz, cy, mat);
    }
    return verts;
}

function pushCross(v, cx, y, cz, size, mat) {
    const t = 0.08;
    pushLine(v, cx - size, y, cz, cx + size, y, cz, t, mat);
    pushLine(v, cx, y, cz - size, cx, y, cz + size, t, mat);
}

function pushVLine(v, x, y0, z, y1, mat) {
    const t = 0.04;
    v.push(x - t, y0, z, 0, 0, mat);
    v.push(x + t, y0, z, 1, 0, mat);
    v.push(x + t, y1, z, 1, 1, mat);
    v.push(x - t, y0, z, 0, 0, mat);
    v.push(x + t, y1, z, 1, 1, mat);
    v.push(x - t, y1, z, 0, 1, mat);

    v.push(x, y0, z - t, 0, 0, mat);
    v.push(x, y0, z + t, 1, 0, mat);
    v.push(x, y1, z + t, 1, 1, mat);
    v.push(x, y0, z - t, 0, 0, mat);
    v.push(x, y1, z + t, 1, 1, mat);
    v.push(x, y1, z - t, 0, 1, mat);
}

// ── Selection highlight (wireframe box overlay + scale handles) ────
function buildSelectionVerts() {
    const verts = [];
    const aabb = getSelectedAABB();
    if (!aabb) return verts;

    const [mn, mx] = aabb;
    const t = 0.06;
    const mat = HIGHLIGHT_MAT;
    const e = 0.01;

    const x0 = mn[0] - e, y0 = mn[1] - e, z0 = mn[2] - e;
    const x1 = mx[0] + e, y1 = mx[1] + e, z1 = mx[2] + e;

    pushLine(verts, x0, y0, z0, x1, y0, z0, t, mat);
    pushLine(verts, x0, y0, z1, x1, y0, z1, t, mat);
    pushLine(verts, x0, y1, z0, x1, y1, z0, t, mat);
    pushLine(verts, x0, y1, z1, x1, y1, z1, t, mat);

    pushLine(verts, x0, y0, z0, x0, y0, z1, t, mat);
    pushLine(verts, x1, y0, z0, x1, y0, z1, t, mat);
    pushLine(verts, x0, y1, z0, x0, y1, z1, t, mat);
    pushLine(verts, x1, y1, z0, x1, y1, z1, t, mat);

    pushVLineEdge(verts, x0, y0, z0, y1, t, mat);
    pushVLineEdge(verts, x1, y0, z0, y1, t, mat);
    pushVLineEdge(verts, x0, y0, z1, y1, t, mat);
    pushVLineEdge(verts, x1, y0, z1, y1, t, mat);

    if (selectedType === 'floorInset' || selectedType === 'box') {
        const hy = 0.15;
        const hs = 0.25;
        const midX = (x0 + x1) / 2, midZ = (z0 + z1) / 2;
        const handleY = selectedType === 'floorInset' ? 0.1 : (mn[1] + mx[1]) / 2;
        for (const [hx, hz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [midX, z0], [midX, z1], [x0, midZ], [x1, midZ]]) {
            pushHandleBox(verts, hx, handleY, hz, hs, hy, hs, mat);
        }
    }

    return verts;
}

function pushHandleBox(v, cx, cy, cz, hx, hy, hz, mat) {
    const x0 = cx - hx, x1 = cx + hx;
    const y0 = cy - hy, y1 = cy + hy;
    const z0 = cz - hz, z1 = cz + hz;
    const w = hx * 2, h = hy * 2, d = hz * 2;
    // 6 faces as quads split into triangles
    pushQuadTri(v, x0,y0,z1, x1,y0,z1, x1,y1,z1, x0,y1,z1, mat);
    pushQuadTri(v, x1,y0,z0, x0,y0,z0, x0,y1,z0, x1,y1,z0, mat);
    pushQuadTri(v, x0,y1,z1, x1,y1,z1, x1,y1,z0, x0,y1,z0, mat);
    pushQuadTri(v, x0,y0,z0, x1,y0,z0, x1,y0,z1, x0,y0,z1, mat);
    pushQuadTri(v, x1,y0,z1, x1,y0,z0, x1,y1,z0, x1,y1,z1, mat);
    pushQuadTri(v, x0,y0,z0, x0,y0,z1, x0,y1,z1, x0,y1,z0, mat);
}

function pushQuadTri(v, x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3, mat) {
    v.push(x0,y0,z0, 0,0,mat, x1,y1,z1, 1,0,mat, x2,y2,z2, 1,1,mat);
    v.push(x0,y0,z0, 0,0,mat, x2,y2,z2, 1,1,mat, x3,y3,z3, 0,1,mat);
}

function pushVLineEdge(v, x, y0, z, y1, t, mat) {
    v.push(x - t, y0, z, 0, 0, mat);
    v.push(x + t, y0, z, 1, 0, mat);
    v.push(x + t, y1, z, 1, 1, mat);
    v.push(x - t, y0, z, 0, 0, mat);
    v.push(x + t, y1, z, 1, 1, mat);
    v.push(x - t, y1, z, 0, 1, mat);
}

// ── AABB for selected object ───────────────────────────────────────
function getSelectedAABB() {
    if (selectedIndex < 0) return null;
    if (selectedType === 'wall') {
        const w = mapData.walls[selectedIndex];
        if (!w) return null;
        const h = w.height ?? mapData.wallHeight;
        const wt = mapData.wallThick;
        return [
            [Math.min(w.x1, w.x2) - wt, 0, Math.min(w.z1, w.z2) - wt],
            [Math.max(w.x1, w.x2) + wt, h, Math.max(w.z1, w.z2) + wt],
        ];
    }
    if (selectedType === 'box') {
        const indices = getGroupIndices();
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const i of indices) {
            const b = mapData.boxes[i];
            if (!b) continue;
            minX = Math.min(minX, b.cx - b.hx);
            minY = Math.min(minY, b.cy - b.hy);
            minZ = Math.min(minZ, b.cz - b.hz);
            maxX = Math.max(maxX, b.cx + b.hx);
            maxY = Math.max(maxY, b.cy + b.hy);
            maxZ = Math.max(maxZ, b.cz + b.hz);
        }
        if (!isFinite(minX)) return null;
        return [[minX, minY, minZ], [maxX, maxY, maxZ]];
    }
    if (selectedType === 'floorInset') {
        const f = mapData.floorInsets[selectedIndex];
        if (!f) return null;
        return [
            [Math.min(f.x1, f.x2), -0.01, Math.min(f.z1, f.z2)],
            [Math.max(f.x1, f.x2), 0.02, Math.max(f.z1, f.z2)],
        ];
    }
    if (selectedType === 'spawn') {
        const s = mapData.spawnPoints[selectedIndex];
        if (!s) return null;
        return [
            [s[0] - 0.6, 0, s[2] - 0.6],
            [s[0] + 0.6, s[1], s[2] + 0.6],
        ];
    }
    return null;
}

// ── All pickable AABBs ─────────────────────────────────────────────
function getAllAABBs() {
    const result = [];
    for (let i = 0; i < mapData.walls.length; i++) {
        const w = mapData.walls[i];
        const h = w.height ?? mapData.wallHeight;
        const wt = mapData.wallThick ?? 0.3;
        result.push({
            type: 'wall', index: i,
            min: [Math.min(w.x1, w.x2) - wt, 0, Math.min(w.z1, w.z2) - wt],
            max: [Math.max(w.x1, w.x2) + wt, h, Math.max(w.z1, w.z2) + wt],
        });
    }
    for (let i = 0; i < mapData.boxes.length; i++) {
        const b = mapData.boxes[i];
        result.push({
            type: 'box', index: i,
            min: [b.cx - b.hx, b.cy - b.hy, b.cz - b.hz],
            max: [b.cx + b.hx, b.cy + b.hy, b.cz + b.hz],
        });
    }
    for (let i = 0; i < mapData.floorInsets.length; i++) {
        const f = mapData.floorInsets[i];
        result.push({
            type: 'floorInset', index: i,
            min: [Math.min(f.x1, f.x2), -0.01, Math.min(f.z1, f.z2)],
            max: [Math.max(f.x1, f.x2), 0.03, Math.max(f.z1, f.z2)],
        });
    }
    for (let i = 0; i < mapData.spawnPoints.length; i++) {
        const s = mapData.spawnPoints[i];
        result.push({
            type: 'spawn', index: i,
            min: [s[0] - 0.6, 0, s[2] - 0.6],
            max: [s[0] + 0.6, s[1], s[2] + 0.6],
        });
    }
    return result;
}

// ── Raycasting helpers ─────────────────────────────────────────────
function screenToRay(mx, my) {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((mx - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((my - rect.top) / rect.height) * 2;

    // Sync Three.js camera to current orbit state before unprojecting
    const cam = renderer.camera;
    const ct = Math.cos(orbit.theta), st = Math.sin(orbit.theta);
    const cp = Math.cos(orbit.phi), sp = Math.sin(orbit.phi);
    cam.position.set(
        orbit.target[0] + orbit.distance * cp * st,
        orbit.target[1] + orbit.distance * sp,
        orbit.target[2] + orbit.distance * cp * ct,
    );
    cam.lookAt(orbit.target[0], orbit.target[1], orbit.target[2]);
    cam.fov = orbit.fov * (180 / Math.PI);
    cam.near = orbit.near;
    cam.far = orbit.far;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    const near = new THREE.Vector3(ndcX, ndcY, -1).unproject(cam);
    const far = new THREE.Vector3(ndcX, ndcY, 1).unproject(cam);
    const dir = new THREE.Vector3().subVectors(far, near).normalize();
    return { origin: [near.x, near.y, near.z], dir: [dir.x, dir.y, dir.z] };
}

function groundPlaneHit(ray) {
    if (Math.abs(ray.dir[1]) < 1e-8) return null;
    const t = -ray.origin[1] / ray.dir[1];
    if (t < 0) return null;
    return [
        ray.origin[0] + ray.dir[0] * t,
        0,
        ray.origin[2] + ray.dir[2] * t,
    ];
}

function pickObject(ray) {
    const aabbs = getAllAABBs();
    let best = null;
    let bestDist = Infinity;
    for (const entry of aabbs) {
        const dist = rayAABBIntersection(ray.origin, ray.dir, entry.min, entry.max, 1000);
        if (dist != null && dist < bestDist) {
            bestDist = dist;
            best = entry;
        }
    }
    return best;
}

// ── Gizmo center for selected object ───────────────────────────────
function getGizmoCenter() {
    if (selectedIndex < 0) return null;
    if (selectedType === 'wall') {
        const w = mapData.walls[selectedIndex];
        return [(w.x1 + w.x2) / 2, (w.height ?? mapData.wallHeight) / 2, (w.z1 + w.z2) / 2];
    }
    if (selectedType === 'box') {
        const aabb = getSelectedAABB();
        if (!aabb) return null;
        return [(aabb[0][0] + aabb[1][0]) / 2, (aabb[0][1] + aabb[1][1]) / 2, (aabb[0][2] + aabb[1][2]) / 2];
    }
    if (selectedType === 'floorInset') {
        const f = mapData.floorInsets[selectedIndex];
        return [(f.x1 + f.x2) / 2, 0.02, (f.z1 + f.z2) / 2];
    }
    if (selectedType === 'spawn') {
        const s = mapData.spawnPoints[selectedIndex];
        return [s[0], s[1] / 2, s[2]];
    }
    return null;
}

// ── Gizmo axis directions ──────────────────────────────────────────
const AXIS_DIR = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXIS_MATS = { x: AXIS_MAT_X, y: AXIS_MAT_Y, z: AXIS_MAT_Z };
const AXIS_KEYS = ['x', 'y', 'z'];

// ── Gizmo geometry ─────────────────────────────────────────────────
function buildGizmoVerts() {
    const verts = [];
    if (selectedIndex < 0 || activeTool === 'select') return verts;
    const c = getGizmoCenter();
    if (!c) return verts;

    if (activeTool === 'rotate') {
        pushRotateRing(verts, c, GIZMO_LEN, 0.1, AXIS_MAT_Y);
        return verts;
    }

    for (const axis of AXIS_KEYS) {
        const dir = AXIS_DIR[axis];
        const mat = AXIS_MATS[axis];
        const tip = [c[0] + dir[0] * GIZMO_LEN, c[1] + dir[1] * GIZMO_LEN, c[2] + dir[2] * GIZMO_LEN];

        // shaft
        pushGizmoLine(verts, c, tip, 0.12, mat);

        // handle at tip
        if (activeTool === 'move') {
            pushGizmoArrow(verts, tip, dir, 0.35, mat);
        } else {
            pushHandleBox(verts, tip[0], tip[1], tip[2], GIZMO_HANDLE, GIZMO_HANDLE, GIZMO_HANDLE, mat);
        }
    }
    return verts;
}

function pushRotateRing(v, center, radius, thickness, mat) {
    const segments = 32;
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const from = [center[0] + Math.cos(a0) * radius, center[1], center[2] + Math.sin(a0) * radius];
        const to = [center[0] + Math.cos(a1) * radius, center[1], center[2] + Math.sin(a1) * radius];
        pushGizmoLine(v, from, to, thickness, mat);
    }
}

function pushGizmoLine(v, from, to, t, mat) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return;

    // two perpendicular offset vectors to form a rectangular cross-section
    let px, py, pz, qx, qy, qz;
    if (Math.abs(dy / len) > 0.9) {
        px = t; py = 0; pz = 0;
        qx = 0; qy = 0; qz = t;
    } else {
        px = -dz / len * t; py = 0; pz = dx / len * t;
        const ux = dx / len, uy = dy / len, uz = dz / len;
        qx = uy * pz - 0 * uz;
        qy = 0 * uz - ux * pz;
        qz = ux * 0 - uy * px;
        const ql = Math.sqrt(qx*qx + qy*qy + qz*qz);
        if (ql > 1e-6) { qx = qx/ql*t; qy = qy/ql*t; qz = qz/ql*t; }
        else { qx = 0; qy = t; qz = 0; }
    }

    // 4 corners at each end
    const c = [
        [px + qx, py + qy, pz + qz],
        [px - qx, py - qy, pz - qz],
        [-px - qx, -py - qy, -pz - qz],
        [-px + qx, -py + qy, -pz + qz],
    ];

    for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4];
        v.push(from[0]+a[0], from[1]+a[1], from[2]+a[2], 0,0,mat);
        v.push(to[0]+a[0],   to[1]+a[1],   to[2]+a[2],   1,0,mat);
        v.push(to[0]+b[0],   to[1]+b[1],   to[2]+b[2],   1,1,mat);
        v.push(from[0]+a[0], from[1]+a[1], from[2]+a[2], 0,0,mat);
        v.push(to[0]+b[0],   to[1]+b[1],   to[2]+b[2],   1,1,mat);
        v.push(from[0]+b[0], from[1]+b[1], from[2]+b[2], 0,1,mat);
    }
}

function pushGizmoArrow(v, tip, dir, size, mat) {
    // simple cone approximation: 4 triangles converging to the tip
    const base = [tip[0] - dir[0] * size * 2, tip[1] - dir[1] * size * 2, tip[2] - dir[2] * size * 2];
    const s = size;

    let p1, p2, p3, p4;
    if (Math.abs(dir[1]) > 0.9) {
        p1 = [base[0]+s, base[1], base[2]+s];
        p2 = [base[0]-s, base[1], base[2]+s];
        p3 = [base[0]-s, base[1], base[2]-s];
        p4 = [base[0]+s, base[1], base[2]-s];
    } else if (Math.abs(dir[0]) > 0.9) {
        p1 = [base[0], base[1]+s, base[2]+s];
        p2 = [base[0], base[1]-s, base[2]+s];
        p3 = [base[0], base[1]-s, base[2]-s];
        p4 = [base[0], base[1]+s, base[2]-s];
    } else {
        p1 = [base[0]+s, base[1]+s, base[2]];
        p2 = [base[0]-s, base[1]+s, base[2]];
        p3 = [base[0]-s, base[1]-s, base[2]];
        p4 = [base[0]+s, base[1]-s, base[2]];
    }

    pushTriVerts(v, tip, p1, p2, mat);
    pushTriVerts(v, tip, p2, p3, mat);
    pushTriVerts(v, tip, p3, p4, mat);
    pushTriVerts(v, tip, p4, p1, mat);
}

function pushTriVerts(v, a, b, c, mat) {
    v.push(a[0],a[1],a[2], 0,0,mat, b[0],b[1],b[2], 1,0,mat, c[0],c[1],c[2], 0.5,1,mat);
}

// ── Gizmo handle hit test ──────────────────────────────────────────
function pickGizmoHandle(ray) {
    if (selectedIndex < 0 || activeTool === 'select') return null;
    const c = getGizmoCenter();
    if (!c) return null;

    if (activeTool === 'rotate') {
        // hit test: torus approximated as flat ring AABB
        const hs = GIZMO_LEN + 0.5;
        const min = [c[0] - hs, c[1] - 0.5, c[2] - hs];
        const max = [c[0] + hs, c[1] + 0.5, c[2] + hs];
        const dist = rayAABBIntersection(ray.origin, ray.dir, min, max, 500);
        return dist != null ? 'y' : null;
    }

    let bestAxis = null;
    let bestDist = Infinity;

    for (const axis of AXIS_KEYS) {
        const dir = AXIS_DIR[axis];
        const tip = [c[0] + dir[0] * GIZMO_LEN, c[1] + dir[1] * GIZMO_LEN, c[2] + dir[2] * GIZMO_LEN];
        const hs = GIZMO_HANDLE + 0.15;
        const min = [tip[0] - hs, tip[1] - hs, tip[2] - hs];
        const max = [tip[0] + hs, tip[1] + hs, tip[2] + hs];
        const dist = rayAABBIntersection(ray.origin, ray.dir, min, max, 500);
        if (dist != null && dist < bestDist) {
            bestDist = dist;
            bestAxis = axis;
        }
    }

    if (!bestAxis) {
        for (const axis of AXIS_KEYS) {
            const dir = AXIS_DIR[axis];
            const shaftHs = 0.3;
            const min = [
                c[0] + Math.min(0, dir[0] * GIZMO_LEN) - shaftHs,
                c[1] + Math.min(0, dir[1] * GIZMO_LEN) - shaftHs,
                c[2] + Math.min(0, dir[2] * GIZMO_LEN) - shaftHs,
            ];
            const max = [
                c[0] + Math.max(0, dir[0] * GIZMO_LEN) + shaftHs,
                c[1] + Math.max(0, dir[1] * GIZMO_LEN) + shaftHs,
                c[2] + Math.max(0, dir[2] * GIZMO_LEN) + shaftHs,
            ];
            const dist = rayAABBIntersection(ray.origin, ray.dir, min, max, 500);
            if (dist != null && dist < bestDist) {
                bestDist = dist;
                bestAxis = axis;
            }
        }
    }

    return bestAxis;
}

// ── Closest parameter along an axis ray to a mouse ray ─────────────
function axisRayParam(axisOrigin, axisDir, ray) {
    const w = [axisOrigin[0] - ray.origin[0], axisOrigin[1] - ray.origin[1], axisOrigin[2] - ray.origin[2]];
    const a = axisDir[0]*axisDir[0] + axisDir[1]*axisDir[1] + axisDir[2]*axisDir[2];
    const b = axisDir[0]*ray.dir[0] + axisDir[1]*ray.dir[1] + axisDir[2]*ray.dir[2];
    const c = ray.dir[0]*ray.dir[0] + ray.dir[1]*ray.dir[1] + ray.dir[2]*ray.dir[2];
    const d = axisDir[0]*w[0] + axisDir[1]*w[1] + axisDir[2]*w[2];
    const e = ray.dir[0]*w[0] + ray.dir[1]*w[1] + ray.dir[2]*w[2];
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-10) return 0;
    return (b * e - c * d) / denom;
}

// ── Apply axis-constrained move ────────────────────────────────────
function applyGizmoMove(axis, delta) {
    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const snapped = snap(delta);

    if (selectedType === 'wall') {
        const w = mapData.walls[selectedIndex];
        const o = gizmoDragOriginObj;
        if (idx === 0) { w.x1 = o.x1 + snapped; w.x2 = o.x2 + snapped; }
        else if (idx === 2) { w.z1 = o.z1 + snapped; w.z2 = o.z2 + snapped; }
        // Y not applicable for walls (they sit on ground)
    } else if (selectedType === 'box') {
        const { indices, snapshots } = gizmoDragOriginObj;
        for (let k = 0; k < indices.length; k++) {
            const b = mapData.boxes[indices[k]];
            const o = snapshots[k];
            if (idx === 0) b.cx = o.cx + snapped;
            else if (idx === 1) b.cy = o.cy + snapped;
            else b.cz = o.cz + snapped;
        }
    } else if (selectedType === 'floorInset') {
        const f = mapData.floorInsets[selectedIndex];
        const o = gizmoDragOriginObj;
        if (idx === 0) { f.x1 = o.x1 + snapped; f.x2 = o.x2 + snapped; }
        else if (idx === 2) { f.z1 = o.z1 + snapped; f.z2 = o.z2 + snapped; }
    } else if (selectedType === 'spawn') {
        const s = mapData.spawnPoints[selectedIndex];
        const o = gizmoDragOriginObj;
        s[idx] = o[idx] + snapped;
    }
}

// ── Apply axis-constrained scale ───────────────────────────────────
function applyGizmoScale(axis, delta) {
    const snapped = snap(delta);

    if (selectedType === 'box') {
        const { indices, snapshots } = gizmoDragOriginObj;
        const k = indices.indexOf(selectedIndex);
        const b = mapData.boxes[selectedIndex];
        const o = snapshots[k >= 0 ? k : 0];
        if (axis === 'x') b.hx = Math.max(0.05, o.hx + snapped);
        else if (axis === 'y') b.hy = Math.max(0.05, o.hy + snapped);
        else b.hz = Math.max(0.05, o.hz + snapped);
    } else if (selectedType === 'floorInset') {
        const f = mapData.floorInsets[selectedIndex];
        const o = gizmoDragOriginObj;
        if (axis === 'x') { f.x2 = o.x2 + snapped; }
        else if (axis === 'z') { f.z2 = o.z2 + snapped; }
    } else if (selectedType === 'wall') {
        const w = mapData.walls[selectedIndex];
        const o = gizmoDragOriginObj;
        if (axis === 'y') { w.height = Math.max(0.1, (o.height ?? mapData.wallHeight) + snapped); }
        else if (axis === 'x') { w.x2 = o.x2 + snapped; }
        else { w.z2 = o.z2 + snapped; }
    }
}

// ── Apply Y-axis rotation ──────────────────────────────────────────
function applyGizmoRotate(deltaAngle) {
    const snapDeg = parseFloat(document.getElementById('snap-size').value) || 0.5;
    const snapEnabled = document.getElementById('snap-enabled').checked;
    let angle = deltaAngle;
    if (snapEnabled) {
        const snapRad = (snapDeg * 15) * Math.PI / 180;
        angle = Math.round(angle / snapRad) * snapRad;
    }
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const o = gizmoDragOriginObj;

    if (selectedType === 'wall') {
        const w = mapData.walls[selectedIndex];
        const cx = (o.x1 + o.x2) / 2, cz = (o.z1 + o.z2) / 2;
        w.x1 = cx + (o.x1 - cx) * cos - (o.z1 - cz) * sin;
        w.z1 = cz + (o.x1 - cx) * sin + (o.z1 - cz) * cos;
        w.x2 = cx + (o.x2 - cx) * cos - (o.z2 - cz) * sin;
        w.z2 = cz + (o.x2 - cx) * sin + (o.z2 - cz) * cos;
    } else if (selectedType === 'floorInset') {
        const f = mapData.floorInsets[selectedIndex];
        const cx = (o.x1 + o.x2) / 2, cz = (o.z1 + o.z2) / 2;
        const hw = (o.x2 - o.x1) / 2, hd = (o.z2 - o.z1) / 2;
        const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
        const rotated = corners.map(([lx, lz]) => [lx * cos - lz * sin, lx * sin + lz * cos]);
        const xs = rotated.map(p => p[0]), zs = rotated.map(p => p[1]);
        f.x1 = cx + Math.min(...xs); f.x2 = cx + Math.max(...xs);
        f.z1 = cz + Math.min(...zs); f.z2 = cz + Math.max(...zs);
    } else if (selectedType === 'box') {
        const { indices, snapshots } = gizmoDragOriginObj;
        const steps = Math.round(angle / (Math.PI / 2));
        if (indices.length > 1) {
            let gcx = 0, gcz = 0;
            for (const s of snapshots) { gcx += s.cx; gcz += s.cz; }
            gcx /= snapshots.length; gcz /= snapshots.length;
            for (let k = 0; k < indices.length; k++) {
                const b = mapData.boxes[indices[k]];
                const s = snapshots[k];
                const rx = s.cx - gcx, rz = s.cz - gcz;
                b.cx = gcx + rx * cos - rz * sin;
                b.cz = gcz + rx * sin + rz * cos;
                if (Math.abs(steps) % 2 === 1) { b.hx = s.hz; b.hz = s.hx; }
                else { b.hx = s.hx; b.hz = s.hz; }
            }
        } else {
            const b = mapData.boxes[indices[0]];
            const s = snapshots[0];
            if (Math.abs(steps) % 2 === 1) { b.hx = s.hz; b.hz = s.hx; }
            else { b.hx = s.hx; b.hz = s.hz; }
        }
    }
}

// ── Snapshot object state at gizmo drag start ──────────────────────
function snapshotSelectedObject() {
    if (selectedType === 'wall') return { ...mapData.walls[selectedIndex] };
    if (selectedType === 'box') {
        const indices = getGroupIndices();
        return { indices, snapshots: indices.map(i => ({ ...mapData.boxes[i] })) };
    }
    if (selectedType === 'floorInset') return { ...mapData.floorInsets[selectedIndex] };
    if (selectedType === 'spawn') return [...mapData.spawnPoints[selectedIndex]];
    return null;
}

// ── Tool switching ─────────────────────────────────────────────────
function setActiveTool(tool) {
    activeTool = tool;
    activeAxis = null;
    document.querySelectorAll('.tool-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
}

// ── Rebuild and upload world geometry ──────────────────────────────
function rebuildWorld() {
    loadMap(mapData);
    const geo = buildWorldGeometry({ hideCeiling: true, skipFloorAO: true });
    uploadWorldGeo(renderer, geo);
    dirty = false;
}

// ── Render loop ────────────────────────────────────────────────────
function frame() {
    requestAnimationFrame(frame);

    if (dirty) rebuildWorld();

    syncEditorGridMesh();

    // Update Three.js camera from orbit state
    const ct = Math.cos(orbit.theta), st = Math.sin(orbit.theta);
    const cp = Math.cos(orbit.phi), sp = Math.sin(orbit.phi);
    const eye = [
        orbit.target[0] + orbit.distance * cp * st,
        orbit.target[1] + orbit.distance * sp,
        orbit.target[2] + orbit.distance * cp * ct,
    ];
    const cam = renderer.camera;
    cam.position.set(eye[0], eye[1], eye[2]);
    cam.lookAt(orbit.target[0], orbit.target[1], orbit.target[2]);
    cam.fov = orbit.fov * (180 / Math.PI);
    cam.near = orbit.near;
    cam.far = orbit.far;
    cam.updateProjectionMatrix();

    // Clear previous dynamic objects
    clearDynamic(renderer);

    const dynVerts = [];
    appendArr(dynVerts, buildSpawnVerts());
    appendArr(dynVerts, buildSelectionVerts());
    if (ghostVerts.length > 0) appendArr(dynVerts, ghostVerts);

    if (dynVerts.length > 0) {
        renderer.dynamicGroup.add(vertsToGroup(dynVerts));
    }

    // Gizmo always on top (disable depth test on its materials)
    const gizmoVerts = buildGizmoVerts();
    if (gizmoVerts.length > 0) {
        const gizmoGroup = vertsToGroup(gizmoVerts);
        gizmoGroup.traverse((obj) => {
            if (obj.material) {
                obj.material.depthTest = false;
                obj.renderOrder = 999;
            }
        });
        renderer.dynamicGroup.add(gizmoGroup);
    }

    render(renderer);
}

function appendArr(target, src) {
    for (let i = 0; i < src.length; i++) target.push(src[i]);
}

// ── Ghost preview while dragging from palette ──────────────────────
let ghostVerts = [];
let dragType = null;

// ── Mouse interaction state ────────────────────────────────────────
let isOrbiting = false;
let isPanning = false;
let isDragging = false;
let dragStartGround = null;
let lastMouse = { x: 0, y: 0 };

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;

    if (e.button === 1 || (e.button === 2 && !isDragging)) {
        isPanning = true;
        e.preventDefault();
        return;
    }

    if (e.button === 0 && !e.shiftKey && !dragType) {
        const ray = screenToRay(e.clientX, e.clientY);
        if (!ray) return;

        // check gizmo handles first
        const gizmoHit = pickGizmoHandle(ray);
        if (gizmoHit && selectedIndex >= 0) {
            pushUndo();
            activeAxis = gizmoHit;
            isDragging = true;
            const c = getGizmoCenter();
            gizmoDragOriginObj = snapshotSelectedObject();
            if (activeTool === 'rotate') {
                const gp = groundPlaneHit(ray);
                rotateDragStartAngle = gp ? Math.atan2(gp[2] - c[2], gp[0] - c[0]) : 0;
            } else {
                gizmoDragStartT = axisRayParam(c, AXIS_DIR[gizmoHit], ray);
            }
            return;
        }

        const hit = pickObject(ray);
        if (hit) {
            const wasAlreadySelected = hit.type === selectedType && hit.index === selectedIndex;
            selectedType = hit.type;
            selectedIndex = hit.index;
            isDragging = true;
            dragStartGround = groundPlaneHit(ray);
            scaleEdge = null;
            activeAxis = null;

            if (wasAlreadySelected && dragStartGround && activeTool === 'select') {
                scaleEdge = detectScaleEdge(dragStartGround);
            }

            pushUndo();
            updateProperties();
            return;
        }

        selectedType = null;
        selectedIndex = -1;
        scaleEdge = null;
        activeAxis = null;
        updateProperties();
        isOrbiting = true;
        return;
    }

    if (e.button === 0) {
        isOrbiting = true;
    }
});

window.addEventListener('mousemove', (e) => {
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;

    if (isOrbiting) {
        orbit.theta -= dx * 0.005;
        orbit.phi = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, orbit.phi + dy * 0.005));
        return;
    }

    if (isPanning) {
        const panScale = orbit.distance * 0.002;
        const ct = Math.cos(orbit.theta), st = Math.sin(orbit.theta);
        orbit.target[0] -= (dx * ct + dy * st * Math.sin(orbit.phi)) * panScale;
        orbit.target[2] += (dx * st - dy * ct * Math.sin(orbit.phi)) * panScale;
        orbit.target[1] += dy * Math.cos(orbit.phi) * panScale;
        return;
    }

    if (isDragging && selectedIndex >= 0) {
        const ray = screenToRay(e.clientX, e.clientY);
        if (!ray) return;

        // axis-constrained gizmo drag
        if (activeAxis && gizmoDragOriginObj) {
            const c = getGizmoCenter();
            if (c) {
                if (activeTool === 'rotate') {
                    const gp = groundPlaneHit(ray);
                    if (gp) {
                        const angle = Math.atan2(gp[2] - c[2], gp[0] - c[0]);
                        const delta = angle - rotateDragStartAngle;
                        applyGizmoRotate(delta);
                        dirty = true;
                        updateProperties();
                    }
                } else {
                    const currentT = axisRayParam(c, AXIS_DIR[activeAxis], ray);
                    const delta = currentT - gizmoDragStartT;
                    if (activeTool === 'move') applyGizmoMove(activeAxis, delta);
                    else if (activeTool === 'scale') applyGizmoScale(activeAxis, delta);
                    dirty = true;
                    updateProperties();
                }
            }
            return;
        }

        const gp = groundPlaneHit(ray);
        if (!gp || !dragStartGround) return;

        if (scaleEdge) {
            scaleSelected(scaleEdge, gp);
            dirty = true;
            updateProperties();
            return;
        }

        const moveX = snap(gp[0]) - snap(dragStartGround[0]);
        const moveZ = snap(gp[2]) - snap(dragStartGround[2]);
        if (Math.abs(moveX) < 1e-6 && Math.abs(moveZ) < 1e-6) return;

        moveSelected(moveX, moveZ);
        dragStartGround = gp;
        dirty = true;
        updateProperties();
        return;
    }

    if (dragType) {
        updateGhost(e.clientX, e.clientY);
    }
});

window.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
        isOrbiting = false;
        isDragging = false;
        dragStartGround = null;
        scaleEdge = null;
        activeAxis = null;
        gizmoDragOriginObj = null;
    }
    if (e.button === 1 || e.button === 2) isPanning = false;
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.distance = Math.max(2, Math.min(300, orbit.distance * (1 + e.deltaY * 0.001)));
}, { passive: false });

// ── Detect which edge/corner a ground point is near ────────────────
function detectScaleEdge(gp) {
    if (selectedType !== 'floorInset' && selectedType !== 'box') return null;

    let x1, z1, x2, z2;
    if (selectedType === 'floorInset') {
        const f = mapData.floorInsets[selectedIndex];
        x1 = Math.min(f.x1, f.x2); x2 = Math.max(f.x1, f.x2);
        z1 = Math.min(f.z1, f.z2); z2 = Math.max(f.z1, f.z2);
    } else {
        const b = mapData.boxes[selectedIndex];
        x1 = b.cx - b.hx; x2 = b.cx + b.hx;
        z1 = b.cz - b.hz; z2 = b.cz + b.hz;
    }

    const threshold = Math.max(1.0, Math.min(x2 - x1, z2 - z1) * 0.25);
    const nearX1 = Math.abs(gp[0] - x1) < threshold;
    const nearX2 = Math.abs(gp[0] - x2) < threshold;
    const nearZ1 = Math.abs(gp[2] - z1) < threshold;
    const nearZ2 = Math.abs(gp[2] - z2) < threshold;

    if (nearX1 && nearZ1) return 'x1z1';
    if (nearX1 && nearZ2) return 'x1z2';
    if (nearX2 && nearZ1) return 'x2z1';
    if (nearX2 && nearZ2) return 'x2z2';
    if (nearX1) return 'x1';
    if (nearX2) return 'x2';
    if (nearZ1) return 'z1';
    if (nearZ2) return 'z2';
    return null;
}

// ── Scale selected object by moving an edge ────────────────────────
function scaleSelected(edge, gp) {
    const sx = snap(gp[0]), sz = snap(gp[2]);

    if (selectedType === 'floorInset') {
        const f = mapData.floorInsets[selectedIndex];
        if (edge.includes('x1')) f.x1 = sx;
        if (edge.includes('x2')) f.x2 = sx;
        if (edge.includes('z1')) f.z1 = sz;
        if (edge.includes('z2')) f.z2 = sz;
    } else if (selectedType === 'box') {
        const b = mapData.boxes[selectedIndex];
        const oldX1 = b.cx - b.hx, oldX2 = b.cx + b.hx;
        const oldZ1 = b.cz - b.hz, oldZ2 = b.cz + b.hz;
        let nx1 = oldX1, nx2 = oldX2, nz1 = oldZ1, nz2 = oldZ2;
        if (edge.includes('x1')) nx1 = sx;
        if (edge.includes('x2')) nx2 = sx;
        if (edge.includes('z1')) nz1 = sz;
        if (edge.includes('z2')) nz2 = sz;
        b.cx = (nx1 + nx2) / 2;
        b.hx = Math.abs(nx2 - nx1) / 2;
        b.cz = (nz1 + nz2) / 2;
        b.hz = Math.abs(nz2 - nz1) / 2;
    }
}

// ── Move selected object ───────────────────────────────────────────
function moveSelected(dx, dz) {
    if (selectedType === 'wall') {
        const w = mapData.walls[selectedIndex];
        w.x1 += dx; w.x2 += dx;
        w.z1 += dz; w.z2 += dz;
    } else if (selectedType === 'box') {
        for (const i of getGroupIndices()) {
            mapData.boxes[i].cx += dx;
            mapData.boxes[i].cz += dz;
        }
    } else if (selectedType === 'floorInset') {
        const f = mapData.floorInsets[selectedIndex];
        f.x1 += dx; f.x2 += dx;
        f.z1 += dz; f.z2 += dz;
    } else if (selectedType === 'spawn') {
        const s = mapData.spawnPoints[selectedIndex];
        s[0] += dx; s[2] += dz;
    }
}

// ── Delete selected ────────────────────────────────────────────────
function deleteSelected() {
    if (selectedIndex < 0) return;
    pushUndo();
    if (selectedType === 'wall') mapData.walls.splice(selectedIndex, 1);
    else if (selectedType === 'box') {
        const indices = getGroupIndices().sort((a, b) => b - a);
        for (const i of indices) mapData.boxes.splice(i, 1);
    }
    else if (selectedType === 'floorInset') mapData.floorInsets.splice(selectedIndex, 1);
    else if (selectedType === 'spawn') mapData.spawnPoints.splice(selectedIndex, 1);
    selectedType = null;
    selectedIndex = -1;
    dirty = true;
    updateProperties();
}

// ── Copy / Paste / Duplicate ────────────────────────────────────────
function copySelected() {
    if (selectedIndex < 0 || !selectedType) return;
    if (selectedType === 'wall') clipboard = { type: 'wall', data: { ...mapData.walls[selectedIndex] } };
    else if (selectedType === 'box') {
        const indices = getGroupIndices();
        clipboard = { type: 'box', data: indices.map(i => ({ ...mapData.boxes[i] })) };
    }
    else if (selectedType === 'floorInset') clipboard = { type: 'floorInset', data: { ...mapData.floorInsets[selectedIndex] } };
    else if (selectedType === 'spawn') clipboard = { type: 'spawn', data: [...mapData.spawnPoints[selectedIndex]] };
    setStatus('Copied');
}

function pasteClipboard() {
    if (!clipboard) { setStatus('Nothing to paste'); return; }
    pushUndo();
    const offset = 2;
    if (clipboard.type === 'wall') {
        const d = { ...clipboard.data, x1: clipboard.data.x1 + offset, x2: clipboard.data.x2 + offset, z1: clipboard.data.z1 + offset, z2: clipboard.data.z2 + offset };
        mapData.walls.push(d);
        selectedType = 'wall';
        selectedIndex = mapData.walls.length - 1;
    } else if (clipboard.type === 'box') {
        const items = Array.isArray(clipboard.data) ? clipboard.data : [clipboard.data];
        const hasGroup = items.some(d => d.group != null);
        const newGroup = hasGroup ? nextGroupId++ : undefined;
        for (const d of items) {
            mapData.boxes.push({ ...d, cx: d.cx + offset, cz: d.cz + offset, group: hasGroup ? newGroup : d.group });
        }
        selectedType = 'box';
        selectedIndex = mapData.boxes.length - 1;
    } else if (clipboard.type === 'floorInset') {
        const d = { ...clipboard.data, x1: clipboard.data.x1 + offset, x2: clipboard.data.x2 + offset, z1: clipboard.data.z1 + offset, z2: clipboard.data.z2 + offset };
        mapData.floorInsets.push(d);
        selectedType = 'floorInset';
        selectedIndex = mapData.floorInsets.length - 1;
    } else if (clipboard.type === 'spawn') {
        const d = [clipboard.data[0] + offset, clipboard.data[1], clipboard.data[2] + offset];
        mapData.spawnPoints.push(d);
        selectedType = 'spawn';
        selectedIndex = mapData.spawnPoints.length - 1;
    }
    dirty = true;
    updateProperties();
    setStatus('Pasted');
}

function duplicateSelected() {
    copySelected();
    pasteClipboard();
    setStatus('Duplicated');
}

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ((e.code === 'Delete' || e.code === 'Backspace') && selectedIndex >= 0) {
        e.preventDefault();
        deleteSelected();
    }
    if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
    }
    if (e.code === 'KeyC' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        copySelected();
    }
    if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        pasteClipboard();
    }
    if (e.code === 'KeyD' && !(e.ctrlKey || e.metaKey)) {
        duplicateSelected();
    }
    if (e.code === 'KeyQ') setActiveTool('select');
    if (e.code === 'KeyW') setActiveTool('move');
    if (e.code === 'KeyE') setActiveTool('scale');
    if (e.code === 'KeyR') setActiveTool('rotate');
});

// ── Palette drag-and-drop ──────────────────────────────────────────
document.querySelectorAll('.palette-item').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
        dragType = el.dataset.type;
        e.dataTransfer.setData('text/plain', dragType);
        e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('dragend', () => {
        dragType = null;
        ghostVerts = [];
    });
});

canvas.addEventListener('dragover', (e) => {
    if (!dragType) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    updateGhost(e.clientX, e.clientY);
});

canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragType) return;

    const ray = screenToRay(e.clientX, e.clientY);
    if (!ray) return;
    const gp = groundPlaneHit(ray);
    if (!gp) return;

    const x = snap(gp[0]), z = snap(gp[2]);
    addObject(dragType, x, z);

    dragType = null;
    ghostVerts = [];
    dirty = true;
    setStatus('Object placed');
});

function addObject(type, x, z) {
    pushUndo();

    if (type.startsWith('prefab-')) {
        const key = type.slice(7);
        const prefab = PREFABS[key];
        if (!prefab) return;
        const gid = nextGroupId++;
        for (const b of prefab.boxes) {
            mapData.boxes.push({ cx: x + b.cx, cy: b.cy, cz: z + b.cz, hx: b.hx, hy: b.hy, hz: b.hz, matID: b.matID, group: gid });
        }
        selectedType = 'box';
        selectedIndex = mapData.boxes.length - 1;
        dirty = true;
        updateProperties();
        setStatus(`Placed: ${prefab.label}`);
        return;
    }

    if (type === 'wall') {
        const len = 4;
        mapData.walls.push({ x1: x - len / 2, z1: z, x2: x + len / 2, z2: z, matID: 0, height: mapData.wallHeight });
        selectedType = 'wall';
        selectedIndex = mapData.walls.length - 1;
    } else if (type === 'box') {
        mapData.boxes.push({ cx: x, cy: 0.5, cz: z, hx: 1, hy: 0.5, hz: 1, matID: 14 });
        selectedType = 'box';
        selectedIndex = mapData.boxes.length - 1;
    } else if (type === 'floorInset') {
        mapData.floorInsets.push({ x1: x - 2, z1: z - 2, x2: x + 2, z2: z + 2, matID: 14 });
        selectedType = 'floorInset';
        selectedIndex = mapData.floorInsets.length - 1;
    } else if (type === 'spawn') {
        mapData.spawnPoints.push([x, 1.7, z]);
        selectedType = 'spawn';
        selectedIndex = mapData.spawnPoints.length - 1;
    }
    dirty = true;
    updateProperties();
}

function updateGhost(mx, my) {
    const ray = screenToRay(mx, my);
    if (!ray) { ghostVerts = []; return; }
    const gp = groundPlaneHit(ray);
    if (!gp) { ghostVerts = []; return; }

    const x = snap(gp[0]), z = snap(gp[2]);
    ghostVerts = [];
    const mat = HIGHLIGHT_MAT;

    if (dragType.startsWith('prefab-')) {
        const key = dragType.slice(7);
        const prefab = PREFABS[key];
        if (prefab) {
            const t = 0.06;
            for (const b of prefab.boxes) {
                const bx = x + b.cx, bz = z + b.cz;
                pushLine(ghostVerts, bx - b.hx, 0.02, bz - b.hz, bx + b.hx, 0.02, bz - b.hz, t, mat);
                pushLine(ghostVerts, bx - b.hx, 0.02, bz + b.hz, bx + b.hx, 0.02, bz + b.hz, t, mat);
                pushLine(ghostVerts, bx - b.hx, 0.02, bz - b.hz, bx - b.hx, 0.02, bz + b.hz, t, mat);
                pushLine(ghostVerts, bx + b.hx, 0.02, bz - b.hz, bx + b.hx, 0.02, bz + b.hz, t, mat);
            }
        }
    } else if (dragType === 'wall') {
        pushLine(ghostVerts, x - 2, 0.02, z, x + 2, 0.02, z, 0.12, mat);
    } else if (dragType === 'box') {
        const t = 0.08;
        pushLine(ghostVerts, x - 1, 0.02, z - 1, x + 1, 0.02, z - 1, t, mat);
        pushLine(ghostVerts, x - 1, 0.02, z + 1, x + 1, 0.02, z + 1, t, mat);
        pushLine(ghostVerts, x - 1, 0.02, z - 1, x - 1, 0.02, z + 1, t, mat);
        pushLine(ghostVerts, x + 1, 0.02, z - 1, x + 1, 0.02, z + 1, t, mat);
    } else if (dragType === 'floorInset') {
        const t = 0.08;
        pushLine(ghostVerts, x - 2, 0.02, z - 2, x + 2, 0.02, z - 2, t, mat);
        pushLine(ghostVerts, x - 2, 0.02, z + 2, x + 2, 0.02, z + 2, t, mat);
        pushLine(ghostVerts, x - 2, 0.02, z - 2, x - 2, 0.02, z + 2, t, mat);
        pushLine(ghostVerts, x + 2, 0.02, z - 2, x + 2, 0.02, z + 2, t, mat);
    } else if (dragType === 'spawn') {
        pushCross(ghostVerts, x, 0.02, z, 0.6, mat);
    }
}

// ── Properties panel ───────────────────────────────────────────────
const propsPanel = document.getElementById('properties');
const propsContent = document.getElementById('props-content');

function updateProperties() {
    if (selectedIndex < 0 || !selectedType) {
        propsPanel.style.display = 'none';
        return;
    }
    propsPanel.style.display = 'block';
    propsContent.innerHTML = '';

    if (selectedType === 'wall') {
        const w = mapData.walls[selectedIndex];
        addPropNum('x1', w.x1, (v) => { w.x1 = v; });
        addPropNum('z1', w.z1, (v) => { w.z1 = v; });
        addPropNum('x2', w.x2, (v) => { w.x2 = v; });
        addPropNum('z2', w.z2, (v) => { w.z2 = v; });
        addPropNum('height', w.height ?? mapData.wallHeight, (v) => { w.height = v; });
        addPropMat(w);
    } else if (selectedType === 'box') {
        const b = mapData.boxes[selectedIndex];
        addPropNum('cx', b.cx, (v) => { b.cx = v; });
        addPropNum('cy', b.cy, (v) => { b.cy = v; });
        addPropNum('cz', b.cz, (v) => { b.cz = v; });
        addPropNum('hx', b.hx, (v) => { b.hx = v; }, 0.01);
        addPropNum('hy', b.hy, (v) => { b.hy = v; }, 0.01);
        addPropNum('hz', b.hz, (v) => { b.hz = v; }, 0.01);
        addPropMat(b);
    } else if (selectedType === 'floorInset') {
        const f = mapData.floorInsets[selectedIndex];
        addPropNum('x1', f.x1, (v) => { f.x1 = v; });
        addPropNum('z1', f.z1, (v) => { f.z1 = v; });
        addPropNum('x2', f.x2, (v) => { f.x2 = v; });
        addPropNum('z2', f.z2, (v) => { f.z2 = v; });
        addPropMat(f);
    } else if (selectedType === 'spawn') {
        const s = mapData.spawnPoints[selectedIndex];
        addPropNum('x', s[0], (v) => { s[0] = v; });
        addPropNum('y', s[1], (v) => { s[1] = v; });
        addPropNum('z', s[2], (v) => { s[2] = v; });
    }
}

function addPropNum(label, value, onChange, step = 0.5) {
    const row = document.createElement('label');
    row.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = step;
    input.value = parseFloat(value.toFixed(3));
    input.addEventListener('focus', () => pushUndo());
    input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
            onChange(v);
            dirty = true;
        }
    });
    row.appendChild(input);
    propsContent.appendChild(row);
}

function addPropMat(obj) {
    const row = document.createElement('label');
    row.textContent = 'material';
    const sel = document.createElement('select');
    for (const m of MATERIALS) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        if (m.id === obj.matID) opt.selected = true;
        sel.appendChild(opt);
    }
    sel.addEventListener('mousedown', () => pushUndo());
    sel.addEventListener('change', () => {
        obj.matID = parseInt(sel.value, 10);
        dirty = true;
    });
    row.appendChild(sel);
    propsContent.appendChild(row);
}

document.getElementById('btn-delete').addEventListener('click', deleteSelected);

document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
});

// ── Top bar ────────────────────────────────────────────────────────
const nameInput = document.getElementById('map-name');
const arenaInput = document.getElementById('arena-size');
const statusEl = document.getElementById('status-text');

nameInput.addEventListener('input', () => { mapData.name = nameInput.value; });
arenaInput.addEventListener('change', () => {
    mapData.arena = parseInt(arenaInput.value, 10) || 30;
    dirty = true;
});

function setStatus(msg) {
    statusEl.textContent = msg;
}

// ── New map ────────────────────────────────────────────────────────
document.getElementById('btn-new').addEventListener('click', () => {
    const arena = parseInt(arenaInput.value, 10) || 30;
    mapData = {
        name: 'Untitled',
        arena,
        wallHeight: 5,
        wallThick: 0.3,
        walls: [
            { x1: -arena, z1: -arena, x2: arena, z2: -arena, matID: 0 },
            { x1: arena, z1: -arena, x2: arena, z2: arena, matID: 0 },
            { x1: arena, z1: arena, x2: -arena, z2: arena, matID: 0 },
            { x1: -arena, z1: arena, x2: -arena, z2: -arena, matID: 0 },
        ],
        floorInsets: [],
        boxes: [],
        spawnPoints: [],
    };
    nameInput.value = mapData.name;
    nextGroupId = 1;
    selectedType = null;
    selectedIndex = -1;
    dirty = true;
    updateProperties();
    setStatus('New map created');
});

// ── Import ─────────────────────────────────────────────────────────
const fileInput = document.getElementById('file-import');
document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            mapData = {
                name: data.name || 'Imported',
                arena: data.arena ?? 30,
                wallHeight: data.wallHeight ?? 5,
                wallThick: data.wallThick ?? 0.3,
                walls: data.walls || [],
                floorInsets: data.floorInsets || [],
                boxes: data.boxes || [],
                spawnPoints: data.spawnPoints || [],
            };
            nameInput.value = mapData.name;
            arenaInput.value = mapData.arena;
            syncNextGroupId();
            selectedType = null;
            selectedIndex = -1;
            dirty = true;
            updateProperties();
            setStatus(`Imported: ${file.name}`);
        } catch (err) {
            setStatus('Import failed: invalid JSON');
        }
    };
    reader.readAsText(file);
    fileInput.value = '';
});

// ── Export ──────────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
    const json = JSON.stringify(mapData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(mapData.name || 'map').replace(/\s+/g, '_').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Map exported');
});

// ── Boot ───────────────────────────────────────────────────────────
async function init() {
    try {
        const resp = await fetch('maps/office_studio.json');
        if (resp.ok) {
            const data = await resp.json();
            mapData = {
                name: data.name || 'Office Studio',
                arena: data.arena ?? 30,
                wallHeight: data.wallHeight ?? 5,
                wallThick: data.wallThick ?? 0.3,
                walls: data.walls || [],
                floorInsets: data.floorInsets || [],
                boxes: data.boxes || [],
                spawnPoints: data.spawnPoints || [],
            };
            nameInput.value = mapData.name;
            arenaInput.value = mapData.arena;
            syncNextGroupId();
            setStatus('Loaded: office_studio.json');
        }
    } catch {
        setStatus('Starting with empty map');
    }

    dirty = true;
    requestAnimationFrame(frame);
}

init();
