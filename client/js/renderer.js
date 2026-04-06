import * as THREE from 'three';
import { EffectComposer } from './lib/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/postprocessing/UnrealBloomPass.js';
import { SSRPass } from './lib/postprocessing/SSRPass.js';
import { ShaderPass } from './lib/postprocessing/ShaderPass.js';
import { OutputPass } from './lib/postprocessing/OutputPass.js';
import { FXAAShader } from './lib/shaders/FXAAShader.js';

// Material IDs (kept for compatibility):
// 0=wall panel, 1=carpet, 2=ceiling, 3=metal, 4=flash,
// 5-8/11-12=player armor palettes, 9=skin, 10=gear,
// 13=glass, 14=wood, 15=screen, 16=plant, 17=smoke, 18=impact

const MATERIAL_DEFS = {
    0:  { color: 0xc8d4dc, roughness: 0.82, metalness: 0.0 },   // wall panel
    1:  { color: 0x2a3340, roughness: 0.97, metalness: 0.0 },   // carpet
    2:  { color: 0xe0e2e5, roughness: 0.85, metalness: 0.0 },   // ceiling
    3:  { color: 0x9a9ca2, roughness: 0.25, metalness: 0.8 },   // metal
    4:  { color: 0xffe65a, roughness: 0.2,  metalness: 0.0, emissive: 0xffe65a, emissiveIntensity: 2.5 }, // flash
    5:  { color: 0xc42a24, roughness: 0.5,  metalness: 0.15, emissive: 0xc42a24, emissiveIntensity: 0.15 },  // red armor
    6:  { color: 0x2668c4, roughness: 0.5,  metalness: 0.15, emissive: 0x2668c4, emissiveIntensity: 0.15 },  // blue armor
    7:  { color: 0x28a050, roughness: 0.5,  metalness: 0.15, emissive: 0x28a050, emissiveIntensity: 0.15 },  // green armor
    8:  { color: 0xd4a028, roughness: 0.5,  metalness: 0.15, emissive: 0xd4a028, emissiveIntensity: 0.15 },  // yellow armor
    9:  { color: 0xd4a88a, roughness: 0.65, metalness: 0.0,  emissive: 0xd4a88a, emissiveIntensity: 0.1 },   // skin
    10: { color: 0x282d36, roughness: 0.6,  metalness: 0.3,  emissive: 0x404860, emissiveIntensity: 0.1 },   // gear
    11: { color: 0x9438b8, roughness: 0.5,  metalness: 0.15, emissive: 0x9438b8, emissiveIntensity: 0.15 },  // purple armor
    12: { color: 0x1fa8ad, roughness: 0.5,  metalness: 0.15, emissive: 0x1fa8ad, emissiveIntensity: 0.15 },  // teal armor
    13: { color: 0x9ec4d8, roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.35 }, // glass
    14: { color: 0x7a5430, roughness: 0.7,  metalness: 0.0 },   // wood
    15: { color: 0x30c0f8, roughness: 0.2,  metalness: 0.0, emissive: 0x30c0f8, emissiveIntensity: 1.2 }, // screen (monitors)
    19: { color: 0xeef4ff, roughness: 0.1,  metalness: 0.0, emissive: 0xeef4ff, emissiveIntensity: 0.8 }, // ceiling light panel
    16: { color: 0x2a7a3a, roughness: 0.8,  metalness: 0.0 },   // plant
    17: { color: 0x787e88, roughness: 0.95, metalness: 0.0, transparent: true, opacity: 0.55 },  // smoke
    18: { color: 0x060608, roughness: 0.85, metalness: 0.0 },   // impact
    20: { color: 0xff2618, roughness: 0.3, metalness: 0.0, emissive: 0xff2618, emissiveIntensity: 2.0 }, // emissive red
    21: { color: 0x1ae634, roughness: 0.3, metalness: 0.0, emissive: 0x1ae634, emissiveIntensity: 2.0 }, // emissive green
    22: { color: 0x3374ff, roughness: 0.3, metalness: 0.0, emissive: 0x3374ff, emissiveIntensity: 2.0 }, // emissive blue
    23: { color: 0xdacb96, roughness: 0.9, metalness: 0.0 }, // sandstone wall (dust2)
    24: { color: 0xc2b280, roughness: 1.0, metalness: 0.0 }, // sand floor (dust2)
    25: { color: 0x8b6a4a, roughness: 0.8, metalness: 0.0 }, // crate wood
    26: { color: 0x7a3028, roughness: 0.9, metalness: 0.0 }, // warehouse brick (assault)
    27: { color: 0x808588, roughness: 0.8, metalness: 0.0 }, // concrete floor
    28: { color: 0x2c4e61, roughness: 0.4, metalness: 0.6 }, // metal container
    29: { color: 0xc0d8dc, roughness: 0.3, metalness: 0.0 }, // pool tile
    30: { color: 0x30a0d0, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.75 }, // pool water
};

const materialCache = new Map();
const aoMaterialCache = new Map();
const normalMapCache = new Map();
let envMap = null;

// ─── Procedural normal maps ───

function generateProceduralNormalMap(type) {
    if (normalMapCache.has(type)) return normalMapCache.get(type);

    const size = 512;
    const half = size / 2;
    const cvs = document.createElement('canvas');
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const d = imageData.data;

    // Reusable hash function for fine-grain noise
    const hash = (a, b) => {
        const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
        return h - Math.floor(h);
    };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            let nx = 0, ny = 0;

            if (type === 'carpet') {
                // Multi-octave fiber noise for realistic carpet texture
                nx = (hash(x, y) - 0.5) * 0.12;
                ny = (hash(x + 37, y + 91) - 0.5) * 0.12;
                // Finer detail layer
                nx += (hash(x * 3.1, y * 3.7) - 0.5) * 0.06;
                ny += (hash(x * 3.7 + 53, y * 3.1 + 17) - 0.5) * 0.06;
                // Subtle row pattern (carpet weave lines)
                const row = y % 8;
                if (row < 1) ny += 0.05;
                else if (row > 6) ny -= 0.05;
            } else if (type === 'wall') {
                // Panel grid with beveled edges + subtle surface texture
                const lineY = y % 32;
                if (lineY < 3) ny = -0.25;
                else if (lineY > 29) ny = 0.25;
                else if (lineY < 5) ny = -0.08;
                else if (lineY > 27) ny = 0.08;
                const lineX = x % 64;
                if (lineX < 3) nx = -0.2;
                else if (lineX > 61) nx = 0.2;
                else if (lineX < 5) nx = -0.06;
                else if (lineX > 59) nx = 0.06;
                // Subtle surface imperfection
                nx += (hash(x * 2.3, y * 2.7) - 0.5) * 0.03;
                ny += (hash(x * 2.7 + 41, y * 2.3 + 67) - 0.5) * 0.03;
            } else if (type === 'metal') {
                // Brushed metal: directional scratches + pits
                const scratch1 = Math.sin(y * 3.7 + Math.sin(x * 0.3) * 2) * 0.5;
                const scratch2 = Math.sin(y * 7.3 + Math.sin(x * 0.7) * 1.5) * 0.25;
                ny = (scratch1 + scratch2) * 0.1;
                // Fine cross-scratches
                nx = Math.sin(x * 5.1 + Math.sin(y * 0.4) * 1.8) * 0.03;
                // Pitting
                const pit = hash(x, y);
                if (pit > 0.96) {
                    nx += 0.3; ny += 0.3;
                } else if (pit > 0.93) {
                    nx -= 0.15; ny -= 0.15;
                }
            } else if (type === 'wood') {
                // Wood grain with knots and fine texture
                const grain = Math.sin(y * 0.4 + Math.sin(x * 0.08) * 6) * 0.5 + 0.5;
                const fineGrain = Math.sin(y * 1.6 + Math.sin(x * 0.3) * 2) * 0.25;
                ny = (grain - 0.5) * 0.16 + fineGrain * 0.06;
                // Two knots at different positions
                const knots = [[half * 0.6, half * 0.4, 18], [half * 1.4, half * 1.5, 10]];
                for (const [kx, ky, kr] of knots) {
                    const dx2 = x - kx, dy2 = y - ky;
                    const knotDist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                    if (knotDist < kr) {
                        const knotAngle = Math.atan2(dy2, dx2);
                        const falloff = 1 - knotDist / kr;
                        nx += Math.cos(knotAngle) * falloff * 0.2;
                        ny += Math.sin(knotAngle) * falloff * 0.2;
                    }
                }
                // Fine pore noise
                nx += (hash(x * 4.1, y * 4.3) - 0.5) * 0.03;
            } else if (type === 'ceiling') {
                // Acoustic tile grid with subtle dimple texture
                const gx = x % 48, gy = y % 48;
                if (gx < 2) nx = -0.15;
                else if (gx > 46) nx = 0.15;
                else if (gx < 4) nx = -0.05;
                else if (gx > 44) nx = 0.05;
                if (gy < 2) ny = -0.15;
                else if (gy > 46) ny = 0.15;
                else if (gy < 4) ny = -0.05;
                else if (gy > 44) ny = 0.05;
                // Acoustic dimple pattern inside tiles
                if (gx > 5 && gx < 43 && gy > 5 && gy < 43) {
                    nx += (hash(x * 5.3, y * 5.7) - 0.5) * 0.04;
                    ny += (hash(x * 5.7 + 23, y * 5.3 + 47) - 0.5) * 0.04;
                }
            } else if (type === 'sandstone') {
                // Large sandstone blocks with heavy grain
                const blockX = x % 128;
                const blockY = (y + (Math.floor(x / 128) % 2 === 0 ? 0 : 64)) % 64; // Staggered brick
                if (blockX < 4) nx = -0.3;
                else if (blockX > 124) nx = 0.3;
                if (blockY < 4) ny = -0.3;
                else if (blockY > 60) ny = 0.3;
                // Sand grain
                nx += (hash(x * 12.1, y * 13.3) - 0.5) * 0.2;
                ny += (hash(x * 13.3, y * 12.1) - 0.5) * 0.2;
            } else if (type === 'sand') {
                // High-frequency sand grain noise + slight rolling dunes
                nx = (hash(x * 15.0, y * 15.0) - 0.5) * 0.3;
                ny = (hash(x * 14.1, y * 16.2) - 0.5) * 0.3;
                nx += Math.sin(x * 0.02 + y * 0.03) * 0.1;
            } else if (type === 'crate_wood') {
                // Planks (vertical)
                const plankX = x % 64;
                if (plankX < 2) nx = -0.2;
                else if (plankX > 62) nx = 0.2;
                // Strong vertical grain
                ny += (hash(x * 8.0, y * 0.5) - 0.5) * 0.3;
                nx += (hash(x * 6.5, y * 0.5) - 0.5) * 0.1;
            } else if (type === 'warehouse_brick') {
                // Small standard bricks, staggered
                const bx = x % 32;
                const by = (y + (Math.floor(x / 32) % 2 === 0 ? 0 : 16)) % 16;
                if (bx < 2) nx = -0.4;
                else if (bx > 30) nx = 0.4;
                if (by < 2) ny = -0.4;
                else if (by > 14) ny = 0.4;
                nx += (hash(x * 7.1, y * 8.2) - 0.5) * 0.15;
                ny += (hash(x * 8.2, y * 7.1) - 0.5) * 0.15;
            } else if (type === 'concrete') {
                // Rough uneven surface
                nx = (hash(x * 4.1, y * 4.3) - 0.5) * 0.15;
                ny = (hash(x * 3.7 + 10, y * 5.1 + 20) - 0.5) * 0.15;
                const blob = Math.sin(x * 0.05) * Math.cos(y * 0.04);
                nx += blob * 0.05;
            } else if (type === 'pool_tile') {
                // Small square tiles (e.g., 16x16 pixels)
                const tx = x % 16;
                const ty = y % 16;
                if (tx < 1) nx = -0.3;
                else if (tx > 14) nx = 0.3;
                if (ty < 1) ny = -0.3;
                else if (ty > 14) ny = 0.3;
                nx += (hash(x * 2.1, y * 2.1) - 0.5) * 0.04; // Very slight bumps
                ny += (hash(x * 2.1, y * 2.1) - 0.5) * 0.04;
            } else if (type === 'metal_container') {
                // Corrugated metal (vertical waves)
                nx = Math.sin(x * 0.4) * 0.4;
                nx += (hash(x * 5.1, y * 5.1) - 0.5) * 0.05;
                ny += (hash(x * 5.1, y * 5.1) - 0.5) * 0.05;
            }

            d[i]     = Math.round((nx * 0.5 + 0.5) * 255);
            d[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            d[i + 2] = 255;
            d[i + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    normalMapCache.set(type, tex);
    return tex;
}

// ─── Environment cubemap ───

function generateEnvMap(renderer) {
    const size = 64;
    const faceColors = [
        [0.18, 0.20, 0.24],
        [0.18, 0.20, 0.24],
        [0.35, 0.38, 0.42],
        [0.08, 0.09, 0.10],
        [0.18, 0.20, 0.24],
        [0.18, 0.20, 0.24],
    ];

    const images = [];
    for (let face = 0; face < 6; face++) {
        const cvs = document.createElement('canvas');
        cvs.width = size;
        cvs.height = size;
        const ctx = cvs.getContext('2d');
        const imageData = ctx.createImageData(size, size);
        const [r, g, b] = faceColors[face];
        for (let i = 0; i < size * size; i++) {
            const y = Math.floor(i / size) / size;
            const brightness = 0.85 + y * 0.15;
            imageData.data[i * 4 + 0] = Math.floor(r * brightness * 255);
            imageData.data[i * 4 + 1] = Math.floor(g * brightness * 255);
            imageData.data[i * 4 + 2] = Math.floor(b * brightness * 255);
            imageData.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        images.push(cvs);
    }

    const cube = new THREE.CubeTexture(images);
    cube.needsUpdate = true;
    return cube;
}

// ─── Vignette + color grading shader ───

const VignetteColorGradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        vignetteStrength: { value: 0.3 },
        vignetteRadius: { value: 0.8 },
        saturation: { value: 1.15 },
        contrast: { value: 1.14 },
        tintColor: { value: new THREE.Vector3(1.01, 0.99, 0.95) },
        time: { value: 0 },
        grainIntensity: { value: 0.02 },
        chromaticAberration: { value: 0.003 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float vignetteStrength;
        uniform float vignetteRadius;
        uniform float saturation;
        uniform float contrast;
        uniform vec3 tintColor;
        uniform float time;
        uniform float grainIntensity;
        uniform float chromaticAberration;
        varying vec2 vUv;

        float hash(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
            // Chromatic aberration at vignette edges
            vec2 center = vUv - 0.5;
            float dist = length(center);
            vec2 dir = normalize(center + 0.0001);
            float caOffset = chromaticAberration * smoothstep(0.2, 0.8, dist);
            vec4 color;
            color.r = texture2D(tDiffuse, vUv + dir * caOffset).r;
            color.g = texture2D(tDiffuse, vUv).g;
            color.b = texture2D(tDiffuse, vUv - dir * caOffset).b;
            color.a = 1.0;

            // Vignette
            float vignette = smoothstep(vignetteRadius, vignetteRadius - 0.45, dist);
            color.rgb *= mix(1.0 - vignetteStrength, 1.0, vignette);
            // Saturation boost
            float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
            color.rgb = mix(vec3(luma), color.rgb, saturation);
            // Contrast (operating on tonemapped sRGB 0-1 values)
            color.rgb = clamp((color.rgb - 0.5) * contrast + 0.5, 0.0, 1.0);
            // Warm tint
            color.rgb *= tintColor;
            // Film grain
            float grain = hash(vUv * 1000.0 + fract(time) * 100.0) - 0.5;
            color.rgb += grain * grainIntensity;
            color.rgb = clamp(color.rgb, 0.0, 1.0);
            gl_FragColor = color;
        }
    `,
};

// ─── Materials ───

export function getMaterial(matID) {
    if (materialCache.has(matID)) return materialCache.get(matID);

    const def = MATERIAL_DEFS[matID] || MATERIAL_DEFS[10];
    const params = {
        color: def.color,
        roughness: def.roughness,
        metalness: def.metalness,
    };
    if (def.emissive) {
        params.emissive = def.emissive;
        params.emissiveIntensity = def.emissiveIntensity || 1;
    }
    if (def.transparent) {
        params.transparent = true;
        params.opacity = def.opacity ?? 1;
        params.depthWrite = false;
    }
    if (envMap && def.metalness > 0.1) {
        params.envMap = envMap;
        params.envMapIntensity = 0.6;
    }
    if (envMap && matID === 13) {
        params.envMap = envMap;
        params.envMapIntensity = 0.8;
    }

    const mat = new THREE.MeshStandardMaterial(params);

    // Procedural normal maps for surface detail (512x512)
    if (matID === 1) {
        mat.normalMap = generateProceduralNormalMap('carpet');
        mat.normalScale = new THREE.Vector2(0.6, 0.6);
    } else if (matID === 0) {
        mat.normalMap = generateProceduralNormalMap('wall');
        mat.normalScale = new THREE.Vector2(0.7, 0.7);
    } else if (matID === 3) {
        mat.normalMap = generateProceduralNormalMap('metal');
        mat.normalScale = new THREE.Vector2(0.5, 0.5);
    } else if (matID === 14) {
        mat.normalMap = generateProceduralNormalMap('wood');
        mat.normalScale = new THREE.Vector2(0.8, 0.8);
    } else if (matID === 2) {
        mat.normalMap = generateProceduralNormalMap('ceiling');
        mat.normalScale = new THREE.Vector2(0.4, 0.4);
    } else if (matID === 23) {
        mat.normalMap = generateProceduralNormalMap('sandstone');
        mat.normalScale = new THREE.Vector2(1.0, 1.0);
    } else if (matID === 24) {
        mat.normalMap = generateProceduralNormalMap('sand');
        mat.normalScale = new THREE.Vector2(0.8, 0.8);
    } else if (matID === 25) {
        mat.normalMap = generateProceduralNormalMap('crate_wood');
        mat.normalScale = new THREE.Vector2(0.9, 0.9);
    } else if (matID === 26) {
        mat.normalMap = generateProceduralNormalMap('warehouse_brick');
        mat.normalScale = new THREE.Vector2(1.2, 1.2);
    } else if (matID === 27) {
        mat.normalMap = generateProceduralNormalMap('concrete');
        mat.normalScale = new THREE.Vector2(0.6, 0.6);
    } else if (matID === 28) {
        mat.normalMap = generateProceduralNormalMap('metal_container');
        mat.normalScale = new THREE.Vector2(1.0, 1.0);
    } else if (matID === 29) {
        mat.normalMap = generateProceduralNormalMap('pool_tile');
        mat.normalScale = new THREE.Vector2(0.8, 0.8);
    }

    materialCache.set(matID, mat);
    return mat;
}

// Returns a material variant that multiplies vertex colors (used for baked AO).
export function getAOMaterial(matID) {
    if (aoMaterialCache.has(matID)) return aoMaterialCache.get(matID);
    const base = getMaterial(matID);
    const mat = base.clone();
    mat.vertexColors = true;
    aoMaterialCache.set(matID, mat);
    return mat;
}

export function createFloorMaterial(matID, aoTexture) {
    const def = MATERIAL_DEFS[matID] || MATERIAL_DEFS[1];
    const params = {
        color: def.color,
        roughness: def.roughness,
        metalness: def.metalness,
    };
    if (envMap && def.metalness > 0.1) {
        params.envMap = envMap;
        params.envMapIntensity = 0.6;
    }
    if (aoTexture) {
        params.lightMap = aoTexture;
        params.lightMapIntensity = 1.0;
    }
    const mat = new THREE.MeshStandardMaterial(params);
    // Apply normal map same as cached version
    if (matID === 1) {
        mat.normalMap = generateProceduralNormalMap('carpet');
        mat.normalScale = new THREE.Vector2(0.5, 0.5);
    } else if (matID === 14) {
        mat.normalMap = generateProceduralNormalMap('wood');
        mat.normalScale = new THREE.Vector2(0.7, 0.7);
    } else if (matID === 24) {
        mat.normalMap = generateProceduralNormalMap('sand');
        mat.normalScale = new THREE.Vector2(0.8, 0.8);
    } else if (matID === 27) {
        mat.normalMap = generateProceduralNormalMap('concrete');
        mat.normalScale = new THREE.Vector2(0.6, 0.6);
    } else if (matID === 29) {
        mat.normalMap = generateProceduralNormalMap('pool_tile');
        mat.normalScale = new THREE.Vector2(0.8, 0.8);
    }
    return mat;
}

export function createBoxMesh(cx, cy, cz, hx, hy, hz, matID) {
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const mat = getMaterial(matID);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.userData.matID = matID;
    const isTransparent = mat.transparent === true;
    mesh.castShadow = !isTransparent;
    mesh.receiveShadow = !isTransparent;
    return mesh;
}

// ─── Renderer + post-processing pipeline ───

export function createRenderer(canvas, options = {}) {
    const editorMode = options.editor === true;

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,  // composer handles quality; skip native AA for perf
        alpha: false,
        powerPreference: 'high-performance',
    });
    renderer.shadowMap.enabled = !editorMode;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = editorMode ? 1.0 : 1.3;
    renderer.setClearColor(0x1a1e28, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, editorMode ? 1 : 2));

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1a1e28, 0.025);

    envMap = generateEnvMap(renderer);
    scene.environment = envMap;

    // Lighting — baked lightmaps provide spatial variation from ceiling panels.
    // Real-time lights are kept low so baked light dominates.
    const ambientLight = new THREE.AmbientLight(0xc0c8d8, editorMode ? 0.62 : 0.8);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xd8e4f0, 0x383840, editorMode ? 0.5 : 0.5);
    scene.add(hemiLight);

    // Angled directional for edge definition on surfaces + shadow casting
    const dirLight = new THREE.DirectionalLight(0xf0f0ff, editorMode ? 0.5 : 0.55);
    dirLight.position.set(6, 16, 4);
    dirLight.castShadow = !editorMode;
    if (dirLight.castShadow) {
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 60;
        dirLight.shadow.camera.left = -30;
        dirLight.shadow.camera.right = 30;
        dirLight.shadow.camera.top = 30;
        dirLight.shadow.camera.bottom = -30;
        dirLight.shadow.bias = -0.002;
        dirLight.shadow.normalBias = 0.02;
    }
    scene.add(dirLight);

    const camera = new THREE.PerspectiveCamera(90, canvas.width / canvas.height, 0.05, 100);
    scene.add(camera);

    const dynamicGroup = new THREE.Group();
    dynamicGroup.name = 'dynamic';
    scene.add(dynamicGroup);

    const weaponGroup = new THREE.Group();
    weaponGroup.name = 'weapon';
    camera.add(weaponGroup);

    const worldGroup = new THREE.Group();
    worldGroup.name = 'world';
    scene.add(worldGroup);

    // ─── Vertex pools (game mode only) ───
    let dynamicVertPool = null;
    let weaponVertPool = null;
    if (!editorMode) {
        dynamicVertPool = createVertPool();
        dynamicGroup.add(dynamicVertPool.group);
        weaponVertPool = createVertPool();
        weaponGroup.add(weaponVertPool.group);
    }

    // ─── Post-processing ───
    const w = canvas.width || 1;
    const h = canvas.height || 1;
    const pr = renderer.getPixelRatio();

    // Create render target with depth texture so SSR can read scene depth
    const depthTexture = new THREE.DepthTexture(w * pr, h * pr);
    const composerRT = new THREE.WebGLRenderTarget(w * pr, h * pr, {
        type: THREE.HalfFloatType,
        depthTexture: depthTexture,
    });
    const composer = new EffectComposer(renderer, composerRT);

    // 1. Beauty pass
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    let ssrPass = null;
    let bloomPass = null;
    let vignettePass = null;
    let fxaaPass = null;

    if (!editorMode) {
        // 2. SSR — screen-space reflections (Fresnel-based, subtle)
        ssrPass = new SSRPass(camera, w * pr, h * pr);
        ssrPass.uniforms.maxDistance.value = 5.0;
        ssrPass.uniforms.opacity.value = 0.4;
        ssrPass.uniforms.thickness.value = 0.015;
        composer.addPass(ssrPass);

        // 3. Bloom
        bloomPass = new UnrealBloomPass(new THREE.Vector2(Math.floor(w / 2), Math.floor(h / 2)), 0.45, 0.35, 0.75);
        composer.addPass(bloomPass);
    }

    // OutputPass converts linear HDR → sRGB 0-1 (tone mapping + gamma).
    // Must come before color grading which expects values in 0-1 range.
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    if (!editorMode) {
        // 5. Vignette + color grading (operates on tonemapped sRGB)
        vignettePass = new ShaderPass(VignetteColorGradeShader);
        composer.addPass(vignettePass);

        // 6. FXAA — anti-aliasing (last pass, needs sRGB input)
        fxaaPass = new ShaderPass(FXAAShader);
        fxaaPass.uniforms['resolution'].value = new THREE.Vector2(w * pr, h * pr);
        composer.addPass(fxaaPass);
    }

    return {
        renderer,
        scene,
        camera,
        worldGroup,
        dynamicGroup,
        weaponGroup,
        gl: renderer.getContext(),
        composer,
        ssrPass,
        bloomPass,
        vignettePass,
        fxaaPass,
        editorMode,
        dynamicVertPool,
        weaponVertPool,
    };
}

export function uploadWorldGeo(r, worldMeshes) {
    while (r.worldGroup.children.length > 0) {
        const child = r.worldGroup.children[0];
        r.worldGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
    }

    if (Array.isArray(worldMeshes)) {
        for (const mesh of worldMeshes) {
            r.worldGroup.add(mesh);
        }
    }
}

export function drawWorld(r, _viewMatrix, _projMatrix) {
    // No-op: rendering is done in a single render() call
}

export function drawDynamic(r, _vertices, _mvp) {
    // No-op: dynamic objects are added to scene directly
}

export function render(r) {
    if (r.composer) {
        r.composer.render();
    } else {
        r.renderer.render(r.scene, r.camera);
    }
}

export function resizeRenderer(r, width, height) {
    r.renderer.setSize(width, height, false);
    r.camera.aspect = width / height;
    r.camera.updateProjectionMatrix();
    if (r.composer) {
        r.composer.setSize(width, height);
    }
    if (r.fxaaPass) {
        const pixelRatio = r.renderer.getPixelRatio();
        r.fxaaPass.uniforms['resolution'].value.set(width * pixelRatio, height * pixelRatio);
    }
}

export function updateCamera(r, position, yaw, pitch, fov) {
    const cam = r.camera;
    cam.position.set(position[0], position[1], position[2]);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = yaw;
    cam.rotation.x = pitch;
    if (fov !== undefined) {
        cam.fov = fov * (180 / Math.PI);
        cam.updateProjectionMatrix();
    }
}

export function clearDynamic(r) {
    const group = r.dynamicGroup;
    const poolGroup = r.dynamicVertPool?.group;
    for (let i = group.children.length - 1; i >= 0; i--) {
        const child = group.children[i];
        if (child === poolGroup) continue;
        group.remove(child);
        disposeObject(child);
    }
}

export function clearWeapon(r) {
    const group = r.weaponGroup;
    const poolGroup = r.weaponVertPool?.group;
    for (let i = group.children.length - 1; i >= 0; i--) {
        const child = group.children[i];
        if (child === poolGroup || child.isLight) continue;
        group.remove(child);
        disposeObject(child);
    }
}

function disposeObject(obj) {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.children) {
        for (const child of obj.children) {
            disposeObject(child);
        }
    }
}

// ─── Legacy compatibility: boxVerts still returns raw float arrays ───
export function boxVerts(cx, cy, cz, hw, hh, hd, mat) {
    const v = [];
    const a = cx-hw, b = cx+hw, c = cy-hh, d = cy+hh, e = cz-hd, f = cz+hd;
    quad(v, a,c,f, b,c,f, b,d,f, a,d,f, mat);
    quad(v, b,c,e, a,c,e, a,d,e, b,d,e, mat);
    quad(v, a,d,f, b,d,f, b,d,e, a,d,e, mat);
    quad(v, a,c,e, b,c,e, b,c,f, a,c,f, mat);
    quad(v, b,c,f, b,c,e, b,d,e, b,d,f, mat);
    quad(v, a,c,e, a,c,f, a,d,f, a,d,e, mat);
    return v;
}

function quad(v, x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3, m) {
    v.push(x0,y0,z0, 0,0,m, x1,y1,z1, 1,0,m, x2,y2,z2, 1,1,m);
    v.push(x0,y0,z0, 0,0,m, x2,y2,z2, 1,1,m, x3,y3,z3, 0,1,m);
}

// Convert raw vertex array (pos3 + uv2 + matID1) into a Three.js Group of meshes.
export function vertsToGroup(verts) {
    const group = new THREE.Group();
    if (!verts || verts.length === 0) return group;

    const buckets = new Map();
    for (let i = 0; i < verts.length; i += 6) {
        const matID = Math.round(verts[i + 5]);
        let bucket = buckets.get(matID);
        if (!bucket) {
            bucket = { positions: [], uvs: [] };
            buckets.set(matID, bucket);
        }
        bucket.positions.push(verts[i], verts[i + 1], verts[i + 2]);
        bucket.uvs.push(verts[i + 3], verts[i + 4]);
    }

    for (const [matID, data] of buckets) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
        geo.computeVertexNormals();
        const mat = getMaterial(matID);
        const mesh = new THREE.Mesh(geo, mat);
        const isTransparent = mat.transparent === true;
        mesh.castShadow = !isTransparent;
        mesh.receiveShadow = !isTransparent;
        group.add(mesh);
    }

    return group;
}

// ─── Vertex pool: reuses geometry across frames to avoid GC thrash ───

export function createVertPool() {
    const group = new THREE.Group();
    group.name = 'vertPool';
    return { group, buckets: new Map() };
}

export function updateVertPool(pool, verts) {
    if (!verts || verts.length === 0) {
        for (const entry of pool.buckets.values()) {
            entry.mesh.visible = false;
        }
        return;
    }

    // First pass: count vertices per material
    const vertCounts = new Map();
    for (let i = 0; i < verts.length; i += 6) {
        const matID = Math.round(verts[i + 5]);
        vertCounts.set(matID, (vertCounts.get(matID) || 0) + 1);
    }

    // Ensure each bucket has enough capacity, growing if needed
    for (const [matID, count] of vertCounts) {
        let entry = pool.buckets.get(matID);
        if (!entry || entry.capacity < count) {
            const newCapacity = Math.max(count * 2, 128);
            if (entry) {
                pool.group.remove(entry.mesh);
                entry.mesh.geometry.dispose();
            }
            const geo = new THREE.BufferGeometry();
            const posAttr = new THREE.BufferAttribute(new Float32Array(newCapacity * 3), 3);
            posAttr.setUsage(THREE.DynamicDrawUsage);
            const uvAttr = new THREE.BufferAttribute(new Float32Array(newCapacity * 2), 2);
            uvAttr.setUsage(THREE.DynamicDrawUsage);
            geo.setAttribute('position', posAttr);
            geo.setAttribute('uv', uvAttr);
            const mat = getMaterial(matID);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = !mat.transparent;
            mesh.receiveShadow = !mat.transparent;
            mesh.frustumCulled = false;
            entry = { mesh, capacity: newCapacity };
            pool.buckets.set(matID, entry);
            pool.group.add(mesh);
        }
    }

    // Second pass: fill vertex data into pre-allocated typed arrays
    const offsets = new Map();
    for (const matID of vertCounts.keys()) offsets.set(matID, 0);

    for (let i = 0; i < verts.length; i += 6) {
        const matID = Math.round(verts[i + 5]);
        const entry = pool.buckets.get(matID);
        const off = offsets.get(matID);
        const posArr = entry.mesh.geometry.attributes.position.array;
        const uvArr = entry.mesh.geometry.attributes.uv.array;
        posArr[off * 3]     = verts[i];
        posArr[off * 3 + 1] = verts[i + 1];
        posArr[off * 3 + 2] = verts[i + 2];
        uvArr[off * 2]     = verts[i + 3];
        uvArr[off * 2 + 1] = verts[i + 4];
        offsets.set(matID, off + 1);
    }

    // Mark buffers dirty and set draw ranges
    for (const [matID, count] of vertCounts) {
        const geo = pool.buckets.get(matID).mesh.geometry;
        geo.attributes.position.needsUpdate = true;
        geo.attributes.uv.needsUpdate = true;
        geo.setDrawRange(0, count);
        geo.computeVertexNormals();
        pool.buckets.get(matID).mesh.visible = true;
    }

    // Hide material buckets not used this frame
    for (const [matID, entry] of pool.buckets) {
        if (!vertCounts.has(matID)) {
            entry.mesh.visible = false;
        }
    }
}
