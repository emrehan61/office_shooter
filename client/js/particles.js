import * as THREE from 'three';

const MAX_PARTICLES = 320;
const MAX_MISSILE_TRACES = 24;
const OFFSCREEN_Y = -9999;
const _tmpColor = new THREE.Color();

function createParticleSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

function setOffscreen(system, index) {
    const base = index * 3;
    system.positions[base] = 0;
    system.positions[base + 1] = OFFSCREEN_Y;
    system.positions[base + 2] = 0;
    system.colors[base] = 0;
    system.colors[base + 1] = 0;
    system.colors[base + 2] = 0;
}

function setTraceOffscreen(system, index) {
    const base = index * 6;
    for (let i = 0; i < 6; i += 1) {
        system.tracePositions[base + i] = i % 3 === 1 ? OFFSCREEN_Y : 0;
        system.traceColors[base + i] = 0;
    }
}

function allocateParticle(system) {
    const index = system.cursor;
    system.cursor = (system.cursor + 1) % system.particles.length;
    return index;
}

function allocateTrace(system) {
    const index = system.traceCursor;
    system.traceCursor = (system.traceCursor + 1) % system.traceStates.length;
    return index;
}

function emitParticle(system, {
    pos,
    vel,
    life = 0.5,
    drag = 0.9,
    gravity = -8,
    color = 0xffffff,
}) {
    const index = allocateParticle(system);
    const particle = system.particles[index];
    particle.active = true;
    particle.x = pos[0];
    particle.y = pos[1];
    particle.z = pos[2];
    particle.vx = vel[0];
    particle.vy = vel[1];
    particle.vz = vel[2];
    particle.life = life;
    particle.maxLife = life;
    particle.drag = drag;
    particle.gravity = gravity;
    _tmpColor.set(color);
    particle.r = _tmpColor.r;
    particle.g = _tmpColor.g;
    particle.b = _tmpColor.b;

    const base = index * 3;
    system.positions[base] = particle.x;
    system.positions[base + 1] = particle.y;
    system.positions[base + 2] = particle.z;
    system.colors[base] = particle.r;
    system.colors[base + 1] = particle.g;
    system.colors[base + 2] = particle.b;
}

function emitMissileTrace(system, {
    start,
    end,
    life = 0.32,
    tailColor = 0xff8c42,
    headColor = 0xfff7cf,
}) {
    const index = allocateTrace(system);
    const trace = system.traceStates[index];
    trace.active = true;
    trace.startX = start[0];
    trace.startY = start[1];
    trace.startZ = start[2];
    trace.endX = end[0];
    trace.endY = end[1];
    trace.endZ = end[2];
    trace.life = life;
    trace.maxLife = life;
    trace.spawnedBurst = false;

    _tmpColor.set(tailColor);
    trace.tailR = _tmpColor.r;
    trace.tailG = _tmpColor.g;
    trace.tailB = _tmpColor.b;
    _tmpColor.set(headColor);
    trace.headR = _tmpColor.r;
    trace.headG = _tmpColor.g;
    trace.headB = _tmpColor.b;

    const base = index * 6;
    system.tracePositions[base] = trace.startX;
    system.tracePositions[base + 1] = trace.startY;
    system.tracePositions[base + 2] = trace.startZ;
    system.tracePositions[base + 3] = trace.startX;
    system.tracePositions[base + 4] = trace.startY;
    system.tracePositions[base + 5] = trace.startZ;
    system.traceColors[base] = trace.tailR;
    system.traceColors[base + 1] = trace.tailG;
    system.traceColors[base + 2] = trace.tailB;
    system.traceColors[base + 3] = trace.headR;
    system.traceColors[base + 4] = trace.headG;
    system.traceColors[base + 5] = trace.headB;
}

function effectBurstKey(effect) {
    const radius = effect.radius ?? 0;
    return [
        effect.type,
        Math.round((effect.pos?.[0] ?? 0) * 2),
        Math.round((effect.pos?.[1] ?? 0) * 2),
        Math.round((effect.pos?.[2] ?? 0) * 2),
        Math.round(radius * 2),
    ].join(':');
}

export function createParticleSystem(scene) {
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.24,
        map: createParticleSprite(),
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        toneMapped: false,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.name = 'particles';
    scene.add(points);

    const tracePositions = new Float32Array(MAX_MISSILE_TRACES * 2 * 3);
    const traceColors = new Float32Array(MAX_MISSILE_TRACES * 2 * 3);
    const traceGeometry = new THREE.BufferGeometry();
    traceGeometry.setAttribute('position', new THREE.BufferAttribute(tracePositions, 3));
    traceGeometry.setAttribute('color', new THREE.BufferAttribute(traceColors, 3));
    const traceMaterial = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    });
    const traceLines = new THREE.LineSegments(traceGeometry, traceMaterial);
    traceLines.frustumCulled = false;
    traceLines.name = 'airstrike-traces';
    scene.add(traceLines);

    const system = {
        points,
        traceLines,
        geometry,
        traceGeometry,
        positions,
        colors,
        tracePositions,
        traceColors,
        cursor: 0,
        traceCursor: 0,
        burstMemory: new Map(),
        particles: Array.from({ length: MAX_PARTICLES }, () => ({
            active: false,
            x: 0,
            y: OFFSCREEN_Y,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            life: 0,
            maxLife: 0,
            drag: 1,
            gravity: 0,
            r: 0,
            g: 0,
            b: 0,
        })),
        traceStates: Array.from({ length: MAX_MISSILE_TRACES }, () => ({
            active: false,
            startX: 0,
            startY: OFFSCREEN_Y,
            startZ: 0,
            endX: 0,
            endY: 0,
            endZ: 0,
            life: 0,
            maxLife: 0,
            spawnedBurst: false,
            tailR: 0,
            tailG: 0,
            tailB: 0,
            headR: 0,
            headG: 0,
            headB: 0,
        })),
    };

    for (let i = 0; i < MAX_PARTICLES; i += 1) {
        setOffscreen(system, i);
    }
    for (let i = 0; i < MAX_MISSILE_TRACES; i += 1) {
        setTraceOffscreen(system, i);
    }

    return system;
}

export function clearParticleSystem(system) {
    system.burstMemory.clear();
    system.cursor = 0;
    system.traceCursor = 0;
    for (let i = 0; i < system.particles.length; i += 1) {
        system.particles[i].active = false;
        setOffscreen(system, i);
    }
    for (let i = 0; i < system.traceStates.length; i += 1) {
        system.traceStates[i].active = false;
        setTraceOffscreen(system, i);
    }
    system.geometry.attributes.position.needsUpdate = true;
    system.geometry.attributes.color.needsUpdate = true;
    system.traceGeometry.attributes.position.needsUpdate = true;
    system.traceGeometry.attributes.color.needsUpdate = true;
}

export function spawnImpactParticles(system, pos, intensity = 1) {
    if (!Array.isArray(pos)) return;
    const count = Math.max(6, Math.round(10 * intensity));
    for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.2 + Math.random() * 4.5 * intensity;
        const lift = 1.2 + Math.random() * 3.2 * intensity;
        emitParticle(system, {
            pos: [pos[0], pos[1], pos[2]],
            vel: [Math.cos(angle) * speed, lift, Math.sin(angle) * speed],
            life: 0.15 + Math.random() * 0.14,
            drag: 0.84,
            gravity: -13,
            color: i % 3 === 0 ? 0xfff0a0 : (i % 2 === 0 ? 0xffb347 : 0xff7a3c),
        });
    }
}

function spawnSmokeBurst(system, pos, radius = 6) {
    const count = Math.max(10, Math.round(radius * 1.4));
    for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * radius * 0.18;
        const speed = 0.35 + Math.random() * 0.8;
        emitParticle(system, {
            pos: [
                pos[0] + Math.cos(angle) * distance,
                pos[1] + 0.35 + Math.random() * 0.9,
                pos[2] + Math.sin(angle) * distance,
            ],
            vel: [
                Math.cos(angle) * speed,
                0.5 + Math.random() * 1.2,
                Math.sin(angle) * speed,
            ],
            life: 0.65 + Math.random() * 0.5,
            drag: 0.93,
            gravity: -0.8,
            color: i % 4 === 0 ? 0x95a8a2 : 0x6f767e,
        });
    }
}

function spawnAirstrikeTraces(system, pos, radius = 8) {
    const count = Math.max(4, Math.min(8, Math.round(radius * 0.55)));
    for (let i = 0; i < count; i += 1) {
        const targetAngle = Math.random() * Math.PI * 2;
        const targetDist = Math.random() * radius * 0.34;
        const target = [
            pos[0] + Math.cos(targetAngle) * targetDist,
            pos[1] + 0.1,
            pos[2] + Math.sin(targetAngle) * targetDist,
        ];
        const start = [
            target[0] + (Math.random() - 0.5) * radius * 0.9,
            pos[1] + 12 + Math.random() * 8,
            target[2] + (Math.random() - 0.5) * radius * 0.9,
        ];
        emitMissileTrace(system, {
            start,
            end: target,
            life: 0.2 + Math.random() * 0.18,
            tailColor: i % 2 === 0 ? 0xff9d4c : 0x8fd5ff,
            headColor: i % 2 === 0 ? 0xfff3c8 : 0xe8f6ff,
        });
    }
}

export function spawnExplosionParticles(system, pos, radius = 8) {
    if (!Array.isArray(pos)) return;

    const flareCount = Math.max(24, Math.round(radius * 3.2));
    for (let i = 0; i < flareCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const spread = radius * (0.4 + Math.random() * 0.75);
        const rise = 1.6 + Math.random() * 4.8;
        emitParticle(system, {
            pos: [pos[0], pos[1] + 0.1, pos[2]],
            vel: [
                Math.cos(angle) * spread,
                rise,
                Math.sin(angle) * spread,
            ],
            life: 0.28 + Math.random() * 0.24,
            drag: 0.88,
            gravity: -8.5,
            color: i % 5 === 0 ? 0x8fff6c : (i % 2 === 0 ? 0xfff27a : 0xff7e3e),
        });
    }

    spawnSmokeBurst(system, pos, radius);
}

export function triggerEffectParticles(system, effects = [], nowMS = performance.now(), opts = {}) {
    const outdoor = opts.outdoor === true;
    for (const effect of effects) {
        if (!effect?.pos || (effect.type !== 'bomb' && effect.type !== 'smoke')) continue;
        const key = effectBurstKey(effect);
        const seenUntil = system.burstMemory.get(key) || 0;
        if (seenUntil > nowMS) continue;

        if (effect.type === 'bomb') {
            spawnExplosionParticles(system, effect.pos, effect.radius || 8);
            if (outdoor) {
                spawnAirstrikeTraces(system, effect.pos, effect.radius || 8);
            }
        } else if (effect.type === 'smoke') {
            spawnSmokeBurst(system, effect.pos, (effect.radius || 8) * 0.5);
        }
        system.burstMemory.set(key, nowMS + Math.max(450, effect.timeLeftMs || 0) + 180);
    }

    for (const [key, seenUntil] of system.burstMemory) {
        if (seenUntil <= nowMS) {
            system.burstMemory.delete(key);
        }
    }
}

export function updateParticleSystem(system, dt) {
    let dirty = false;
    let traceDirty = false;

    for (let i = 0; i < system.particles.length; i += 1) {
        const particle = system.particles[i];
        if (!particle.active) continue;

        particle.life = Math.max(0, particle.life - dt);
        if (particle.life <= 0) {
            particle.active = false;
            setOffscreen(system, i);
            dirty = true;
            continue;
        }

        const drag = Math.pow(particle.drag, dt * 60);
        particle.vx *= drag;
        particle.vy *= drag;
        particle.vz *= drag;
        particle.vy += particle.gravity * dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.z += particle.vz * dt;

        const fade = particle.life / Math.max(0.001, particle.maxLife);
        const colorScale = 0.2 + fade * 0.8;
        const base = i * 3;
        system.positions[base] = particle.x;
        system.positions[base + 1] = particle.y;
        system.positions[base + 2] = particle.z;
        system.colors[base] = particle.r * colorScale;
        system.colors[base + 1] = particle.g * colorScale;
        system.colors[base + 2] = particle.b * colorScale;
        dirty = true;
    }

    for (let i = 0; i < system.traceStates.length; i += 1) {
        const trace = system.traceStates[i];
        if (!trace.active) continue;

        trace.life = Math.max(0, trace.life - dt);
        const progress = 1 - (trace.life / Math.max(0.001, trace.maxLife));
        const headT = Math.min(1, progress * 1.08);
        const tailT = Math.max(0, headT - 0.16);
        const headX = trace.startX + (trace.endX - trace.startX) * headT;
        const headY = trace.startY + (trace.endY - trace.startY) * headT;
        const headZ = trace.startZ + (trace.endZ - trace.startZ) * headT;
        const tailX = trace.startX + (trace.endX - trace.startX) * tailT;
        const tailY = trace.startY + (trace.endY - trace.startY) * tailT;
        const tailZ = trace.startZ + (trace.endZ - trace.startZ) * tailT;

        if (!trace.spawnedBurst && headT >= 0.98) {
            spawnImpactParticles(system, [trace.endX, trace.endY, trace.endZ], 0.55);
            trace.spawnedBurst = true;
            dirty = true;
        }

        if (trace.life <= 0) {
            trace.active = false;
            setTraceOffscreen(system, i);
            traceDirty = true;
            continue;
        }

        const fade = 0.2 + (1 - progress) * 0.8;
        const base = i * 6;
        system.tracePositions[base] = tailX;
        system.tracePositions[base + 1] = tailY;
        system.tracePositions[base + 2] = tailZ;
        system.tracePositions[base + 3] = headX;
        system.tracePositions[base + 4] = headY;
        system.tracePositions[base + 5] = headZ;
        system.traceColors[base] = trace.tailR * fade * 0.55;
        system.traceColors[base + 1] = trace.tailG * fade * 0.55;
        system.traceColors[base + 2] = trace.tailB * fade * 0.55;
        system.traceColors[base + 3] = trace.headR * fade;
        system.traceColors[base + 4] = trace.headG * fade;
        system.traceColors[base + 5] = trace.headB * fade;
        traceDirty = true;
    }

    if (dirty) {
        system.geometry.attributes.position.needsUpdate = true;
        system.geometry.attributes.color.needsUpdate = true;
    }
    if (traceDirty) {
        system.traceGeometry.attributes.position.needsUpdate = true;
        system.traceGeometry.attributes.color.needsUpdate = true;
    }
}
