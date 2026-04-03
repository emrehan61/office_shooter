import { mat4Multiply, mat4Create } from './math.js';

// Vertex format: pos(3) + uv(2) + matID(1) = 6 floats = 24 bytes per vertex
// Material IDs:
// 0=wall panel, 1=carpet, 2=ceiling, 3=metal, 4=flash,
// 5-8/11-12=player armor palettes, 9=skin, 10=gear,
// 13=glass, 14=wood, 15=screen, 16=plant, 17=smoke, 18=impact
const VS_SRC = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aMatID;

uniform mat4 uMVP;

out vec2 vUV;
out float vMatID;
out vec3 vWorldPos;

void main() {
    vUV = aUV;
    vMatID = aMatID;
    vWorldPos = aPos;
    gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FS_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
in float vMatID;
in vec3 vWorldPos;

uniform vec3 uLightDir;

out vec4 fragColor;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 wallPanel(vec2 uv) {
    vec2 panel = uv * vec2(0.55, 0.45);
    vec2 pf = fract(panel);
    float seam = max(step(pf.x, 0.04), step(pf.y, 0.035));
    float n = noise2D(uv * 4.0) * 0.08;
    vec3 base = mix(vec3(0.83, 0.84, 0.86), vec3(0.72, 0.78, 0.82), noise2D(uv * 0.8));
    vec3 accent = vec3(0.58, 0.67, 0.77) * smoothstep(0.65, 1.0, noise2D(uv * 0.12));
    return mix(base + accent * 0.12 + n, vec3(0.58, 0.62, 0.67), seam);
}

vec3 carpet(vec2 uv) {
    float weaveA = sin(uv.x * 22.0) * 0.04;
    float weaveB = sin(uv.y * 24.0) * 0.04;
    float n = noise2D(uv * 10.0) * 0.12 + noise2D(uv * 36.0) * 0.04;
    return vec3(0.19, 0.24, 0.29) + weaveA + weaveB + n;
}

vec3 ceilingPanel(vec2 uv) {
    vec2 cell = fract(uv * 0.7);
    float grid = max(step(cell.x, 0.04), step(cell.y, 0.04));
    float n = noise2D(uv * 5.0) * 0.05;
    return mix(vec3(0.86, 0.87, 0.88) + n, vec3(0.7, 0.73, 0.76), grid);
}

vec3 metal(vec2 uv) {
    float stripe = sin(uv.y * 80.0) * 0.04;
    float n = noise2D(vec2(uv.x * 2.0, uv.y * 40.0)) * 0.06;
    float h = hash21(floor(uv * 2.0));
    return vec3(0.55, 0.56, 0.58) + (h - 0.5) * 0.08 + stripe + n;
}

vec3 glassTint(vec2 uv) {
    float n = noise2D(uv * 2.0) * 0.05;
    float line = step(fract(uv.y * 0.45), 0.06) * 0.05;
    return vec3(0.56, 0.72, 0.82) + n + line;
}

vec3 wood(vec2 uv) {
    float grain = sin(uv.x * 18.0 + noise2D(uv * 3.0) * 4.0) * 0.08;
    float bands = noise2D(vec2(uv.x * 2.0, uv.y * 0.4)) * 0.14;
    return vec3(0.46, 0.31, 0.18) + grain + bands;
}

vec3 screenGlow(vec2 uv) {
    vec2 p = fract(uv * vec2(0.9, 0.9));
    float frame = max(step(p.x, 0.06), step(p.y, 0.08));
    float glow = 0.75 + noise2D(uv * 7.0) * 0.18;
    return mix(vec3(0.16, 0.72, 0.95) * glow, vec3(0.04, 0.06, 0.08), frame);
}

vec3 plant(vec2 uv) {
    float n = noise2D(uv * 8.0) * 0.2 + noise2D(uv * 21.0) * 0.07;
    return vec3(0.15, 0.46, 0.22) + n;
}

vec3 smokePuff(vec3 p) {
    float base = noise2D(p.xz * 0.45 + p.yy * 0.12);
    float detail = noise2D(p.xy * 1.7 + p.zz * 0.08);
    return mix(vec3(0.42, 0.44, 0.48), vec3(0.66, 0.69, 0.74), base * 0.7 + detail * 0.3);
}

vec3 impactMarker(vec3 p) {
    float n = noise2D(p.xy * 15.0 + p.zz * 4.0) * 0.04;
    return vec3(0.02, 0.02, 0.025) + n;
}

vec3 armorPaint(float id) {
    vec3 base;
    if (id < 5.5) base = vec3(0.73, 0.18, 0.16);
    else if (id < 6.5) base = vec3(0.18, 0.44, 0.78);
    else if (id < 7.5) base = vec3(0.18, 0.65, 0.33);
    else if (id < 8.5) base = vec3(0.82, 0.62, 0.18);
    else if (id < 11.5) base = vec3(0.58, 0.24, 0.72);
    else base = vec3(0.12, 0.66, 0.68);
    float wear = noise2D(vWorldPos.xy * 9.0) * 0.12;
    return base + wear;
}

void main() {
    vec3 texColor;
    float m = vMatID + 0.5;
    bool emissive = false;
    if      (m < 1.0) texColor = wallPanel(vWorldPos.xy * 0.6);
    else if (m < 2.0) texColor = carpet(vWorldPos.xz * 0.5);
    else if (m < 3.0) texColor = ceilingPanel(vWorldPos.xz * 0.5);
    else if (m < 4.0) texColor = metal(vWorldPos.xz * 0.5);
    else {
        if (m < 5.0) {
            texColor = vec3(1.4, 0.9, 0.35);
            emissive = true;
        } else if ((m >= 5.0 && m < 9.0) || (m >= 11.0 && m < 13.0)) {
            texColor = armorPaint(m);
        } else if (m < 10.0) {
            texColor = vec3(0.82, 0.66, 0.55) + noise2D(vWorldPos.xy * 12.0) * 0.05;
        } else if (m < 11.0) {
            texColor = vec3(0.18, 0.2, 0.24) + noise2D(vWorldPos.xz * 16.0) * 0.06;
        } else if (m < 14.0) {
            texColor = glassTint(vWorldPos.xy * 0.6);
        } else if (m < 15.0) {
            texColor = wood(vWorldPos.xz * 0.9);
        } else if (m < 16.0) {
            texColor = screenGlow(vWorldPos.xy * 1.1);
            emissive = true;
        } else if (m < 17.0) {
            texColor = plant(vWorldPos.xy * 0.8);
        } else if (m < 18.0) {
            texColor = smokePuff(vWorldPos);
        } else if (m < 19.0) {
            texColor = impactMarker(vWorldPos);
        } else {
            texColor = vec3(0.18, 0.2, 0.24) + noise2D(vWorldPos.xz * 16.0) * 0.06;
        }
    }

    vec3 normal = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    float diffuse = max(dot(normal, normalize(uLightDir)), 0.0);
    float lighting = emissive ? 1.0 : (0.35 + diffuse * 0.65);

    float fog = smoothstep(25.0, 60.0, length(vWorldPos));
    fragColor = vec4(mix(texColor * lighting, vec3(0.04, 0.04, 0.06), fog), 1.0);
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

    gl.useProgram(program);
    gl.uniform3f(uLightDir, 0.4, 0.8, 0.3);
    gl.useProgram(null);

    // Separate VAOs/VBOs for world (static) and dynamic objects
    const worldVAO = gl.createVertexArray();
    const worldVBO = gl.createBuffer();
    const dynVAO = gl.createVertexArray();
    const dynVBO = gl.createBuffer();

    // Setup dynamic VAO once
    gl.bindVertexArray(dynVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, dynVBO);
    setupAttribs(gl);
    gl.bindVertexArray(null);

    return { gl, program, uMVP, uLightDir, worldVAO, worldVBO, dynVAO, dynVBO, vertCount: 0 };
}

export function uploadWorldGeo(r, geometry) {
    const { gl, worldVAO, worldVBO } = r;
    r.vertCount = geometry.length / 6;

    gl.bindVertexArray(worldVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, worldVBO);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
    setupAttribs(gl);
    gl.bindVertexArray(null);
}

export function drawWorld(r, viewMatrix, projMatrix) {
    const { gl, program, uMVP, worldVAO, vertCount } = r;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    const mvp = mat4Create();
    mat4Multiply(mvp, projMatrix, viewMatrix);
    gl.uniformMatrix4fv(uMVP, false, mvp);

    gl.bindVertexArray(worldVAO);
    gl.drawArrays(gl.TRIANGLES, 0, vertCount);
    gl.bindVertexArray(null);
}

export function drawDynamic(r, vertices, mvp) {
    const { gl, program, uMVP, dynVAO, dynVBO } = r;
    const data = new Float32Array(vertices);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uMVP, false, mvp);

    gl.bindVertexArray(dynVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, dynVBO);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    gl.bindVertexArray(null);
}

function setupAttribs(gl) {
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
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

export function boxVerts(cx, cy, cz, hw, hh, hd, mat) {
    const v = [];
    const a = cx-hw, b = cx+hw, c = cy-hh, d = cy+hh, e = cz-hd, f = cz+hd;
    // Front +Z
    quad(v, a,c,f, b,c,f, b,d,f, a,d,f, mat);
    // Back -Z
    quad(v, b,c,e, a,c,e, a,d,e, b,d,e, mat);
    // Top +Y
    quad(v, a,d,f, b,d,f, b,d,e, a,d,e, mat);
    // Bottom -Y
    quad(v, a,c,e, b,c,e, b,c,f, a,c,f, mat);
    // Right +X
    quad(v, b,c,f, b,c,e, b,d,e, b,d,f, mat);
    // Left -X
    quad(v, a,c,e, a,c,f, a,d,f, a,d,e, mat);
    return v;
}

function quad(v, x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3, m) {
    v.push(x0,y0,z0, 0,0,m, x1,y1,z1, 1,0,m, x2,y2,z2, 1,1,m);
    v.push(x0,y0,z0, 0,0,m, x2,y2,z2, 1,1,m, x3,y3,z3, 0,1,m);
}
