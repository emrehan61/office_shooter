import test from 'node:test';
import assert from 'node:assert/strict';

import { triggerEffectParticles } from './particles.js';

function createMockParticleSystem(particleCount = 256, traceCount = 24) {
    return {
        burstMemory: new Map(),
        cursor: 0,
        traceCursor: 0,
        positions: new Float32Array(particleCount * 3),
        colors: new Float32Array(particleCount * 3),
        tracePositions: new Float32Array(traceCount * 6),
        traceColors: new Float32Array(traceCount * 6),
        geometry: {
            attributes: {
                position: { needsUpdate: false },
                color: { needsUpdate: false },
            },
        },
        traceGeometry: {
            attributes: {
                position: { needsUpdate: false },
                color: { needsUpdate: false },
            },
        },
        particles: Array.from({ length: particleCount }, () => ({
            active: false,
            x: 0,
            y: 0,
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
        traceStates: Array.from({ length: traceCount }, () => ({
            active: false,
            startX: 0,
            startY: 0,
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
}

test('bomb effects only spawn missile traces on outdoor maps', () => {
    const effect = [{ type: 'bomb', pos: [4, 0, -2], radius: 10.5, timeLeftMs: 650 }];

    const outdoorSystem = createMockParticleSystem();
    triggerEffectParticles(outdoorSystem, effect, 1000, { outdoor: true });
    assert.ok(outdoorSystem.particles.some((particle) => particle.active));
    assert.ok(outdoorSystem.traceStates.some((trace) => trace.active));

    const indoorSystem = createMockParticleSystem();
    triggerEffectParticles(indoorSystem, effect, 1000, { outdoor: false });
    assert.ok(indoorSystem.particles.some((particle) => particle.active));
    assert.equal(indoorSystem.traceStates.some((trace) => trace.active), false);
});
