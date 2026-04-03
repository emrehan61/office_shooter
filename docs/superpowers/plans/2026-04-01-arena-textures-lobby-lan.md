# Arena FPS: Textures, Arena, Lobby, LAN — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the black-screen FPS into a textured, lit arena game with a lobby system playable over LAN.

**Architecture:** Replace flat vertex-color rendering with procedural textures (brick/tile/concrete/metal) via fragment shader. Expand arena from 40x40 to 60x60 with varied cover. Add lobby state machine to server (waiting→playing) with name entry and player list. Client connects via configurable IP for LAN play.

**Tech Stack:** WebGL 2 (GLSL ES 3.0), Go + gorilla/websocket, vanilla JS modules

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `client/js/renderer.js` | Rewrite | New shaders with UV, procedural textures, lighting |
| `client/js/world.js` | Rewrite | 60x60 arena, UV coords, material IDs, collision |
| `client/js/main.js` | Modify | Lobby flow, deferred game start |
| `client/js/net.js` | Modify | Lobby messages (lobby, start), name param |
| `client/index.html` | Modify | Lobby UI (name, IP, player list, start button) |
| `client/style.css` | Modify | Lobby styles |
| `server/main.go` | Modify | Lobby state, player names, start command, LAN IP |

---

### Task 1: Renderer — New Shaders with Procedural Textures + Lighting

**Files:**
- Rewrite: `client/js/renderer.js`

Vertex format changes from `pos(3)+color(3)` to `pos(3)+uv(2)+matID(1)` — same 24-byte stride, no format conflict.

Material IDs: `0`=brick (walls), `1`=tile (floor), `2`=concrete (ceiling), `3`=metal (pillars).

- [ ] **Step 1: Replace renderer.js with new shaders and updated API**

Replace the entire file with:

```js
import { mat4Multiply, mat4Create } from './math.js';

const VS_SRC = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aMat;
uniform mat4 uMVP;
out vec2 vUV;
out float vMat;
out vec3 vWorldPos;
void main() {
    vec4 clip = uMVP * vec4(aPos, 1.0);
    vUV = aUV;
    vMat = aMat;
    vWorldPos = aPos;
    gl_Position = clip;
}`;

const FS_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
in float vMat;
in vec3 vWorldPos;
uniform vec3 uLightDir;
out vec4 fragColor;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 brick(vec2 uv) {
    float row = floor(uv.y / 0.5);
    float offset = mod(row, 2.0) * 0.5;
    vec2 bUV = vec2(uv.x + offset, uv.y);
    vec2 bID = floor(bUV / vec2(1.0, 0.5));
    vec2 bLocal = fract(bUV / vec2(1.0, 0.5));
    float mx = smoothstep(0.0, 0.03, bLocal.x) * smoothstep(0.0, 0.03, 1.0 - bLocal.x);
    float my = smoothstep(0.0, 0.04, bLocal.y) * smoothstep(0.0, 0.04, 1.0 - bLocal.y);
    float mortar = mx * my;
    float h = hash(bID);
    vec3 bCol = mix(vec3(0.55, 0.22, 0.15), vec3(0.65, 0.30, 0.20), h);
    return mix(vec3(0.5, 0.48, 0.45), bCol, mortar);
}

vec3 tile(vec2 uv) {
    vec2 tID = floor(uv);
    vec2 tLocal = fract(uv);
    float ex = smoothstep(0.0, 0.04, tLocal.x) * smoothstep(0.0, 0.04, 1.0 - tLocal.x);
    float ey = smoothstep(0.0, 0.04, tLocal.y) * smoothstep(0.0, 0.04, 1.0 - tLocal.y);
    float h = hash(tID);
    vec3 tCol = mix(vec3(0.35, 0.35, 0.38), vec3(0.40, 0.40, 0.42), h);
    return mix(vec3(0.25, 0.25, 0.28), tCol, ex * ey);
}

vec3 concrete(vec2 uv) {
    float h = hash(floor(uv * 8.0));
    return vec3(0.35, 0.34, 0.33) + (h - 0.5) * 0.08;
}

vec3 metal(vec2 uv) {
    float stripe = sin(uv.x * 40.0) * 0.03;
    float h = hash(floor(uv * 4.0));
    return vec3(0.45, 0.48, 0.52) + stripe + (h - 0.5) * 0.05;
}

void main() {
    vec3 normal = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    float diffuse = max(dot(normal, normalize(uLightDir)), 0.0);
    float light = 0.35 + diffuse * 0.65;
    vec3 color;
    int mat = int(vMat + 0.5);
    if (mat == 0) color = brick(vWorldPos.xz * 0.5);
    else if (mat == 1) color = tile(vWorldPos.xz * 0.5);
    else if (mat == 2) color = concrete(vWorldPos.xy * 0.5);
    else color = metal(vWorldPos.xz * 0.5);
    float fog = smoothstep(25.0, 60.0, length(vWorldPos));
    fragColor = vec4(mix(color * light, vec3(0.04, 0.04, 0.06), fog), 1.0);
}`;

export function createRenderer(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL 2 not supported');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.04, 0.04, 0.06, 1);
    const program = createProgram(gl, VS_SRC, FS_SRC);
    const uMVP = gl.getUniformLocation(program, 'uMVP');
    const uLightDir = gl.getUniformLocation(program, 'uLightDir');
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    return { gl, program, uMVP, uLightDir, vao, vbo, triCount: 0 };
}

export function uploadWorldGeo(r, geometry) {
    const { gl, vao, vbo } = r;
    r.triCount = geometry.length / 6 / 3;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
    // Position: 3 floats, offset 0, stride 24
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    // UV: 2 floats, offset 12, stride 24
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    // Material: 1 float, offset 20, stride 24
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
}

export function drawWorld(r, viewMatrix, projMatrix) {
    const { gl, program, uMVP, uLightDir, vao, triCount } = r;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    const mvp = mat4Create();
    mat4Multiply(mvp, projMatrix, viewMatrix);
    gl.uniformMatrix4fv(uMVP, false, mvp);
    gl.uniform3f(uLightDir, 0.4, 0.8, 0.3);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, triCount * 3);
    gl.bindVertexArray(null);
}

export function drawDynamic(r, vertices, mvp) {
    const { gl, program, uMVP, uLightDir, vbo } = r;
    const data = new Float32Array(vertices);
    const count = data.length / 6;
    gl.useProgram(program);
    gl.uniformMatrix4fv(uMVP, false, mvp);
    gl.uniform3f(uLightDir, 0.4, 0.8, 0.3);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.drawArrays(gl.TRIANGLES, 0, count);
}

function createProgram(gl, vsSrc, fsSrc) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        throw new Error('Shader link: ' + gl.getProgramInfoLog(prog));
    return prog;
}

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error('Shader compile: ' + info);
    }
    return s;
}

// Generate a colored box as triangle vertices [x,y,z, u,v, mat, ...]
export function boxVerts(cx, cy, cz, hw, hh, hd, mat) {
    const v = [];
    // Front (+Z)
    pushBoxFace(v, cx-hw,cy-hh,cz+hd, cx+hw,cy-hh,cz+hd, cx+hw,cy+hh,cz+hd, cx-hw,cy+hh,cz+hd, 0,1,0,1,0,0, mat);
    // Back (-Z)
    pushBoxFace(v, cx+hw,cy-hh,cz-hd, cx-hw,cy-hh,cz-hd, cx-hw,cy+hh,cz-hd, cx+hw,cy+hh,cz-hd, 0,1,0,1,0,0, mat);
    // Top (+Y)
    pushBoxFace(v, cx-hw,cy+hh,cz+hd, cx+hw,cy+hh,cz+hd, cx+hw,cy+hh,cz-hd, cx-hw,cy+hh,cz-hd, 0,0,1,0,1,1, mat);
    // Bottom (-Y)
    pushBoxFace(v, cx-hw,cy-hh,cz-hd, cx+hw,cy-hh,cz-hd, cx+hw,cy-hh,cz+hd, cx-hw,cy-hh,cz+hd, 0,0,1,0,1,1, mat);
    // Right (+X)
    pushBoxFace(v, cx+hw,cy-hh,cz+hd, cx+hw,cy-hh,cz-hd, cx+hw,cy+hh,cz-hd, cx+hw,cy+hh,cz+hd, 0,0,1,0,1,1, mat);
    // Left (-X)
    pushBoxFace(v, cx-hw,cy-hh,cz-hd, cx-hw,cy-hh,cz+hd, cx-hw,cy+hh,cz+hd, cx-hw,cy+hh,cz-hd, 0,0,1,0,1,1, mat);
    return v;
}

function pushBoxFace(v, x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3, u0,v0_, u1,v1_, u2,v2_, u3,v3_, mat) {
    // Tri 0-1-2
    v.push(x0,y0,z0, u0,v0_, mat);
    v.push(x1,y1,z1, u1,v1_, mat);
    v.push(x2,y2,z2, u2,v2_, mat);
    // Tri 0-2-3
    v.push(x0,y0,z0, u0,v0_, mat);
    v.push(x2,y2,z2, u2,v2_, mat);
    v.push(x3,y3,z3, u3,v3_, mat);
}
```

Key changes from old renderer:
- Shader uses UV + material ID instead of vertex colors
- `uLightDir` uniform for directional lighting
- `boxVerts` signature changes from `(cx,cy,cz,hw,hh,hd,r,g,b)` to `(cx,cy,cz,hw,hh,hd,mat)`
- Procedural texture functions in fragment shader: `brick`, `tile`, `concrete`, `metal`
- Face normals computed via `dFdx`/`dFdy` of world position

---

### Task 2: World — Expanded 60x60 Arena with UV + Materials

**Files:**
- Rewrite: `client/js/world.js`

- [ ] **Step 1: Replace world.js with new arena geometry**

```js
const WALL_HEIGHT = 5;
const ARENA = 30; // half-extent: -30 to 30

const MAP_WALLS = [
    // Outer walls (brick)
    { x1: -ARENA, z1: -ARENA, x2:  ARENA, z2: -ARENA },
    { x1:  ARENA, z1: -ARENA, x2:  ARENA, z2:  ARENA },
    { x1:  ARENA, z1:  ARENA, x2: -ARENA, z2:  ARENA },
    { x1: -ARENA, z1:  ARENA, x2: -ARENA, z2: -ARENA },

    // Center pillars (metal) - 4 pillars in a ring
    { x1: -3, z1: -3, x2: -1, z2: -3 },
    { x1: -1, z1: -3, x2: -1, z2: -1 },
    { x1: -1, z1: -1, x2: -3, z2: -1 },
    { x1: -3, z1: -1, x2: -3, z2: -3 },

    { x1: 1, z1: -3, x2: 3, z2: -3 },
    { x1: 3, z1: -3, x2: 3, z2: -1 },
    { x1: 3, z1: -1, x2: 1, z2: -1 },
    { x1: 1, z1: -1, x2: 1, z2: -3 },

    { x1: 1, z1: 1, x2: 3, z2: 1 },
    { x1: 3, z1: 1, x2: 3, z2: 3 },
    { x1: 3, z1: 3, x2: 1, z2: 3 },
    { x1: 1, z1: 3, x2: 1, z2: 1 },

    { x1: -3, z1: 1, x2: -1, z2: 1 },
    { x1: -1, z1: 1, x2: -1, z2: 3 },
    { x1: -1, z1: 3, x2: -3, z2: 3 },
    { x1: -3, z1: 3, x2: -3, z2: 1 },

    // NW corner room walls
    { x1: -26, z1: -26, x2: -14, z2: -26 },
    { x1: -14, z1: -26, x2: -14, z2: -19 },
    { x1: -14, z1: -16, x2: -14, z2: -14 },
    { x1: -14, z1: -14, x2: -26, z2: -14 },

    // NE corner room
    { x1: 14, z1: -26, x2: 26, z2: -26 },
    { x1: 14, z1: -26, x2: 14, z2: -19 },
    { x1: 14, z1: -16, x2: 14, z2: -14 },
    { x1: 26, z1: -14, x2: 14, z2: -14 },

    // SE corner room
    { x1: 14, z1: 26, x2: 26, z2: 26 },
    { x1: 14, z1: 14, x2: 14, z2: 19 },
    { x1: 14, z1: 22, x2: 14, z2: 26 },
    { x1: 14, z1: 26, x2: 26, z2: 26 },

    // SW corner room
    { x1: -26, z1: 14, x2: -26, z2: 26 },
    { x1: -26, z1: 26, x2: -14, z2: 26 },
    { x1: -14, z1: 26, x2: -14, z2: 22 },
    { x1: -14, z1: 19, x2: -14, z2: 14 },
    { x1: -14, z1: 14, x2: -26, z2: 14 },

    // Mid-cover walls (brick)
    { x1: -10, z1: 0, x2: -5, z2: 0 },
    { x1: 5, z1: 0, x2: 10, z2: 0 },
    { x1: 0, z1: -10, x2: 0, z2: -5 },
    { x1: 0, z1: 5, x2: 0, z2: 10 },

    // Corridor walls N
    { x1: -8, z1: -20, x2: -8, z2: -14 },
    { x1: 8, z1: -20, x2: 8, z2: -14 },
    // Corridor walls S
    { x1: -8, z1: 14, x2: -8, z2: 20 },
    { x1: 8, z1: 14, x2: 8, z2: 20 },
    // Corridor walls W
    { x1: -20, z1: -8, x2: -14, z2: -8 },
    { x1: -20, z1: 8, x2: -14, z2: 8 },
    // Corridor walls E
    { x1: 14, z1: -8, x2: 20, z2: -8 },
    { x1: 14, z1: 8, x2: 20, z2: 8 },

    // Scattered crates (brick, short walls)
    { x1: -20, z1: -5, x2: -19, z2: -4 },
    { x1: 19, z1: 4, x2: 20, z2: 5 },
    { x1: -5, z1: 20, x2: -4, z2: 21 },
    { x1: 5, z1: -21, x2: 6, z2: -20 },
    { x1: -22, z1: 5, x2: -21, z2: 6 },
    { x1: 22, z1: -6, x2: 21, z2: -5 },
];

export const SPAWN_POINTS = [
    [-25, 1.7, -25],
    [ 25, 1.7, -25],
    [ 25, 1.7,  25],
    [-25, 1.7,  25],
    [ 0, 1.7, -20],
    [ 0, 1.7,  20],
];

// Material IDs: 0=brick, 1=tile, 2=concrete, 3=metal
export function buildWorldGeometry() {
    const verts = [];

    // Floor (tile, mat=1)
    pushQuad(verts,
        -ARENA, 0, -ARENA, 0, 0, 1,
         ARENA, 0, -ARENA, ARENA*2, 0, 1,
         ARENA, 0,  ARENA, ARENA*2, ARENA*2, 1,
        -ARENA, 0,  ARENA, 0, ARENA*2, 1
    );

    // Ceiling (concrete, mat=2)
    pushQuad(verts,
        -ARENA, WALL_HEIGHT,  ARENA, 0, 0, 2,
         ARENA, WALL_HEIGHT,  ARENA, ARENA*2, 0, 2,
         ARENA, WALL_HEIGHT, -ARENA, ARENA*2, ARENA*2, 2,
        -ARENA, WALL_HEIGHT, -ARENA, 0, ARENA*2, 2
    );

    // Walls (brick, mat=0) and pillars (metal, mat=3)
    for (const w of MAP_WALLS) {
        const isPillar = (w.x1 > -5 && w.x1 < 5 && w.x2 > -5 && w.x2 < 5 &&
                          w.z1 > -5 && w.z1 < 5 && w.z2 > -5 && w.z2 < 5);
        const mat = isPillar ? 3 : 0;
        pushWall(verts, w.x1, w.z1, w.x2, w.z2, mat);
    }

    return new Float32Array(verts);
}

function pushWall(verts, x1, z1, x2, z2, mat) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    // Front face
    pushQuad(verts,
        x1, 0, z1, 0, 0, mat,
        x2, 0, z2, len, 0, mat,
        x2, WALL_HEIGHT, z2, len, WALL_HEIGHT, mat,
        x1, WALL_HEIGHT, z1, 0, WALL_HEIGHT, mat
    );
    // Back face
    pushQuad(verts,
        x1, WALL_HEIGHT, z1, 0, WALL_HEIGHT, mat,
        x2, WALL_HEIGHT, z2, len, WALL_HEIGHT, mat,
        x2, 0, z2, len, 0, mat,
        x1, 0, z1, 0, 0, mat
    );
}

function pushQuad(verts, x0,y0,z0,u0,v0,m0, x1,y1,z1,u1,v1,m1, x2,y2,z2,u2,v2,m2, x3,y3,z3,u3,v3,m3) {
    pushTri(verts, x0,y0,z0,u0,v0,m0, x1,y1,z1,u1,v1,m1, x2,y2,z2,u2,v2,m2);
    pushTri(verts, x0,y0,z0,u0,v0,m0, x2,y2,z2,u2,v2,m2, x3,y3,z3,u3,v3,m3);
}

function pushTri(verts, x0,y0,z0,u0,v0,m0, x1,y1,z1,u1,v1,m1, x2,y2,z2,u2,v2,m2) {
    verts.push(x0, y0, z0, u0, v0, m0);
    verts.push(x1, y1, z1, u1, v1, m1);
    verts.push(x2, y2, z2, u2, v2, m2);
}

export function collideWalls(pos, radius) {
    let px = pos[0], pz = pos[2];
    for (const w of MAP_WALLS) {
        const closest = closestPointOnSegment(px, pz, w.x1, w.z1, w.x2, w.z2);
        const dx = px - closest[0];
        const dz = pz - closest[1];
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < radius && dist > 1e-8) {
            const push = (radius - dist) / dist;
            px += dx * push;
            pz += dz * push;
        }
    }
    pos[0] = px;
    pos[2] = pz;
}

function closestPointOnSegment(px, pz, ax, az, bx, bz) {
    const abx = bx - ax, abz = bz - az;
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
    const ex = cx - targetPos[0], ey = cy - targetPos[1], ez = cz - targetPos[2];
    return Math.sqrt(ex*ex + ey*ey + ez*ez) < halfW && Math.abs(cy - targetPos[1]) < halfH;
}
```

- [ ] **Step 2: Update player.js to use new arena bounds and ceiling height**

In `client/js/player.js`:
- Change ceiling check from `4 - 0.1` to `5 - 0.1` (new `WALL_HEIGHT`)
- Change bounds from `19.5` to `29.5` (new `ARENA - 0.5`)
- Update spawn points to use `world.SPAWN_POINTS`

---

### Task 3: Server — Lobby State Machine + Player Names + LAN IP

**Files:**
- Modify: `server/main.go`

- [ ] **Step 1: Add lobby state, player names, start command, LAN IP detection**

Replace the full file. Key changes from current server:

1. Add `GameState` enum (`StateWaiting`, `StatePlaying`)
2. Add `state` and `started` flag to `Game`
3. Store `name` from initial join message
4. New message handler: `"name"` sent by client after WebSocket connect, server responds with `"welcome"` + `"lobby"`
5. New message: `"start"` — transitions from waiting to playing, broadcasts `"start"` to all
6. On player join/leave during lobby: broadcast `"lobby"` with current player list
7. On startup: detect and print LAN IP via `net.InterfaceAddrs()`
8. Update spawn points to match new 60x60 arena
9. Increase `maxPlayers` to 6

---

### Task 4: Client — Lobby UI

**Files:**
- Modify: `client/index.html`
- Modify: `client/style.css`

- [ ] **Step 1: Replace overlay in index.html with lobby form**

Replace the `#overlay` div with a full lobby UI containing:
- Name input (id=`name-input`, maxlength=12, placeholder="Your name")
- Server input (id=`server-input`, placeholder="host:port")
- Connect button (id=`connect-btn`)
- Player list (id=`player-list`)
- Start button (id=`start-btn`, disabled by default)
- Status text (id=`lobby-status`)
- Controls reference

- [ ] **Step 2: Add lobby CSS styles to style.css**

Add styles for `.lobby-panel`, input fields, buttons, player list, responsive layout.

---

### Task 5: Client — Lobby Logic + Game Flow

**Files:**
- Modify: `client/js/net.js`
- Modify: `client/js/main.js`

- [ ] **Step 1: Update net.js for lobby protocol**

Changes:
- `connect()` takes `(net, url, name)` — sends `{t:"name", name}` on open
- Handle new `"lobby"` message: update `net.players` map with name list
- Handle `"start"` message: set `net.gameStarted = true`
- Add `sendStart(net)` function

- [ ] **Step 2: Update main.js for lobby flow**

Changes:
- Remove auto-connect on load
- Connect when user clicks "Connect" in lobby
- Show player list from lobby updates
- "Start Game" button calls `sendStart()`
- Game loop only starts rendering gameplay after `net.gameStarted` is true
- Update `boxVerts` calls for players to use new `mat` param instead of `r,g,b`

---

### Task 6: Integration Test

- [ ] **Step 1: Build and run server, test in browser**

```bash
cd /Users/alyo/Desktop/personaltobedeleted/fps-game/server && go run main.go
```

Expected: Server prints LAN IP, listens on :8080
Browser: Open `http://localhost:8080` — should see lobby with textured arena background
Enter name, click Connect, see player list
Open second tab, connect as second player
Click Start — both clients enter game with procedural textures

- [ ] **Step 2: Test LAN access from another machine**

Open `http://<LAN-IP>:8080` on another device on same network
