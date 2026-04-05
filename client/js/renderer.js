import * as THREE from 'three';
import { EffectComposer } from './lib/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from './lib/postprocessing/ShaderPass.js';
import { OutputPass } from './lib/postprocessing/OutputPass.js';

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
    15: { color: 0x30c0f8, roughness: 0.2,  metalness: 0.0, emissive: 0x30c0f8, emissiveIntensity: 0.95 }, // screen (monitors)
    16: { color: 0x2a7a3a, roughness: 0.8,  metalness: 0.0 },   // plant
    17: { color: 0x787e88, roughness: 0.95, metalness: 0.0, transparent: true, opacity: 0.55 },  // smoke
    18: { color: 0x060608, roughness: 0.85, metalness: 0.0 },   // impact
    20: { color: 0xff2618, roughness: 0.3, metalness: 0.0, emissive: 0xff2618, emissiveIntensity: 2.0 }, // emissive red
    21: { color: 0x1ae634, roughness: 0.3, metalness: 0.0, emissive: 0x1ae634, emissiveIntensity: 2.0 }, // emissive green
    22: { color: 0x3374ff, roughness: 0.3, metalness: 0.0, emissive: 0x3374ff, emissiveIntensity: 2.0 }, // emissive blue
};

// Ceiling light panel positions (x, z) — matches world.js OFFICE_BOXES with matID 15 at y=4.72
const CEILING_LIGHT_POSITIONS = [
    [-14, -5], [-14, 5], [14, -5], [14, 5],
    [0, 0], [0, 19], [0, -19],
];

const materialCache = new Map();
const normalMapCache = new Map();
let envMap = null;

// ─── Procedural normal maps ───

function generateProceduralNormalMap(type) {
    if (normalMapCache.has(type)) return normalMapCache.get(type);

    const size = 128;
    const cvs = document.createElement('canvas');
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const d = imageData.data;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            let nx = 0, ny = 0;

            if (type === 'carpet') {
                const hash = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
                nx = (hash - Math.floor(hash) - 0.5) * 0.15;
                const hash2 = Math.sin(x * 269.5 + y * 183.3) * 43758.5453;
                ny = (hash2 - Math.floor(hash2) - 0.5) * 0.15;
            } else if (type === 'wall') {
                const lineY = y % 16;
                if (lineY < 2) ny = -0.2;
                else if (lineY > 14) ny = 0.2;
                const lineX = x % 32;
                if (lineX < 2) nx = -0.15;
                else if (lineX > 30) nx = 0.15;
            } else if (type === 'metal') {
                const scratch = Math.sin(y * 3.7 + Math.sin(x * 0.3) * 2) * 0.5;
                ny = scratch * 0.12;
                const pit = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
                if ((pit - Math.floor(pit)) > 0.95) {
                    nx = 0.3; ny = 0.3;
                }
            } else if (type === 'wood') {
                const grain = Math.sin(y * 0.8 + Math.sin(x * 0.15) * 4) * 0.5 + 0.5;
                ny = (grain - 0.5) * 0.18;
                const dx2 = x - 64, dy2 = y - 64;
                const knotDist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                if (knotDist < 12) {
                    const knotAngle = Math.atan2(dy2, dx2);
                    nx += Math.cos(knotAngle) * (1 - knotDist / 12) * 0.2;
                    ny += Math.sin(knotAngle) * (1 - knotDist / 12) * 0.2;
                }
            } else if (type === 'ceiling') {
                // Subtle tile grid pattern
                const gx = x % 24, gy = y % 24;
                if (gx < 1) nx = -0.12;
                else if (gx > 22) nx = 0.12;
                if (gy < 1) ny = -0.12;
                else if (gy > 22) ny = 0.12;
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
        saturation: { value: 1.12 },
        contrast: { value: 1.04 },
        tintColor: { value: new THREE.Vector3(1.01, 0.99, 0.95) },
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
        varying vec2 vUv;
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            // Vignette
            vec2 center = vUv - 0.5;
            float dist = length(center);
            float vignette = smoothstep(vignetteRadius, vignetteRadius - 0.45, dist);
            color.rgb *= mix(1.0 - vignetteStrength, 1.0, vignette);
            // Saturation boost
            float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
            color.rgb = mix(vec3(luma), color.rgb, saturation);
            // Contrast
            color.rgb = (color.rgb - 0.5) * contrast + 0.5;
            // Warm tint
            color.rgb *= tintColor;
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

    // Procedural normal maps for surface detail
    if (matID === 1) {
        mat.normalMap = generateProceduralNormalMap('carpet');
        mat.normalScale = new THREE.Vector2(0.5, 0.5);
    } else if (matID === 0) {
        mat.normalMap = generateProceduralNormalMap('wall');
        mat.normalScale = new THREE.Vector2(0.6, 0.6);
    } else if (matID === 3) {
        mat.normalMap = generateProceduralNormalMap('metal');
        mat.normalScale = new THREE.Vector2(0.4, 0.4);
    } else if (matID === 14) {
        mat.normalMap = generateProceduralNormalMap('wood');
        mat.normalScale = new THREE.Vector2(0.7, 0.7);
    } else if (matID === 2) {
        mat.normalMap = generateProceduralNormalMap('ceiling');
        mat.normalScale = new THREE.Vector2(0.3, 0.3);
    }

    materialCache.set(matID, mat);
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
        params.aoMap = aoTexture;
        params.aoMapIntensity = 0.8;
    }
    const mat = new THREE.MeshStandardMaterial(params);
    // Apply normal map same as cached version
    if (matID === 1) {
        mat.normalMap = generateProceduralNormalMap('carpet');
        mat.normalScale = new THREE.Vector2(0.5, 0.5);
    } else if (matID === 14) {
        mat.normalMap = generateProceduralNormalMap('wood');
        mat.normalScale = new THREE.Vector2(0.7, 0.7);
    }
    return mat;
}

export function createBoxMesh(cx, cy, cz, hx, hy, hz, matID) {
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const mat = getMaterial(matID);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
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
    renderer.toneMappingExposure = editorMode ? 1.0 : 1.15;
    renderer.setClearColor(0x1a1e28, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, editorMode ? 1 : 2));

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1a1e28, 0.012);

    envMap = generateEnvMap(renderer);
    scene.environment = envMap;

    // Lighting (editor: fewer fills, no point lights — bloom off; keeps view readable and FPS up)
    const ambientLight = new THREE.AmbientLight(0x607090, editorMode ? 0.62 : 0.45);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xb0c0d8, 0x282830, editorMode ? 0.5 : 0.4);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xf0f0ff, editorMode ? 0.5 : 0.6);
    dirLight.position.set(8, 18, 6);
    if (!editorMode) {
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 4096;
        dirLight.shadow.mapSize.height = 4096;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 80;
        dirLight.shadow.camera.left = -35;
        dirLight.shadow.camera.right = 35;
        dirLight.shadow.camera.top = 35;
        dirLight.shadow.camera.bottom = -35;
        dirLight.shadow.bias = -0.0005;
        dirLight.shadow.normalBias = 0.02;
    }
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x6878a0, editorMode ? 0.18 : 0.25);
    fillLight.position.set(-10, 12, -8);
    scene.add(fillLight);

    if (!editorMode) {
        for (const [x, z] of CEILING_LIGHT_POSITIONS) {
            const pointLight = new THREE.PointLight(0xe8eeff, 0.8, 20, 1.5);
            pointLight.position.set(x, 4.5, z);
            pointLight.castShadow = false;
            scene.add(pointLight);
        }

        const cornerPositions = [[-24, -24], [24, -24], [-24, 24], [24, 24]];
        for (const [x, z] of cornerPositions) {
            const cornerLight = new THREE.PointLight(0xd0d8ff, 0.35, 16, 2);
            cornerLight.position.set(x, 3.5, z);
            scene.add(cornerLight);
        }
    }

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

    // ─── Post-processing ───
    const w = canvas.width || 1;
    const h = canvas.height || 1;

    const composer = new EffectComposer(renderer);

    // 1. Beauty pass
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    let bloomPass = null;
    let vignettePass = null;
    if (!editorMode) {
        bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.35, 0.75);
        composer.addPass(bloomPass);

        vignettePass = new ShaderPass(VignetteColorGradeShader);
        composer.addPass(vignettePass);
    }

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    return {
        renderer,
        scene,
        camera,
        worldGroup,
        dynamicGroup,
        weaponGroup,
        gl: renderer.getContext(),
        composer,
        bloomPass,
        vignettePass,
        editorMode,
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
    while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        disposeObject(child);
    }
}

export function clearWeapon(r) {
    const group = r.weaponGroup;
    while (group.children.length > 0) {
        const child = group.children[0];
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
