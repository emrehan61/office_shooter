// Synthesized FPS sound engine using Web Audio API
// No audio files — all sounds are generated procedurally

let ctx = null;
let masterGain = null;
const MAX_CONCURRENT = 12;
let activeSounds = 0;

function getContext() {
    if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.6;
        masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

function canPlay() {
    return activeSounds < MAX_CONCURRENT;
}

function trackSound(duration) {
    activeSounds++;
    setTimeout(() => { activeSounds = Math.max(0, activeSounds - 1); }, duration);
}

// ─── Spatial panner for remote sounds ───
function createPanner(audioCtx, pos, listenerPos) {
    const panner = audioCtx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = 50;
    panner.rolloffFactor = 1.5;
    panner.setPosition(pos[0], pos[1], pos[2]);
    return panner;
}

function updateListener(pos, forward) {
    const audioCtx = getContext();
    const listener = audioCtx.listener;
    if (listener.positionX) {
        listener.positionX.value = pos[0];
        listener.positionY.value = pos[1];
        listener.positionZ.value = pos[2];
        listener.forwardX.value = forward[0];
        listener.forwardY.value = forward[1];
        listener.forwardZ.value = forward[2];
        listener.upX.value = 0;
        listener.upY.value = 1;
        listener.upZ.value = 0;
    } else {
        listener.setPosition(pos[0], pos[1], pos[2]);
        listener.setOrientation(forward[0], forward[1], forward[2], 0, 1, 0);
    }
}

// ─── White noise buffer (shared, created once) ───
let noiseBuffer = null;
function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const audioCtx = getContext();
    const size = audioCtx.sampleRate * 0.2;
    noiseBuffer = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
}

// ─── Gunshot sound ───
function playGunshotLocal(weaponType) {
    if (!canPlay()) return;
    const audioCtx = getContext();
    const now = audioCtx.currentTime;

    const isMG = weaponType === 'machinegun';
    const duration = isMG ? 0.06 : 0.09;

    // Noise burst through bandpass
    const noise = audioCtx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = isMG ? 1400 : 800;
    bandpass.Q.value = isMG ? 1.2 : 0.8;

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(bandpass).connect(noiseGain).connect(masterGain);
    noise.start(now);
    noise.stop(now + duration + 0.01);

    // Low-frequency punch
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isMG ? 120 : 80, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + duration);

    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.4, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(oscGain).connect(masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.01);

    trackSound(duration * 1000 + 50);
}

function playGunshotSpatial(pos, listenerPos, weaponType) {
    if (!canPlay()) return;
    const dx = pos[0] - listenerPos[0];
    const dz = pos[2] - listenerPos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 45) return;

    const audioCtx = getContext();
    const now = audioCtx.currentTime;
    const panner = createPanner(audioCtx, pos, listenerPos);
    const isMG = weaponType === 'machinegun';
    const duration = isMG ? 0.08 : 0.12;

    const noise = audioCtx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = isMG ? 1200 : 700;
    bandpass.Q.value = 0.7;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(bandpass).connect(gain).connect(panner).connect(masterGain);
    noise.start(now);
    noise.stop(now + duration + 0.01);

    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isMG ? 100 : 65, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + duration);

    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.3, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(oscGain).connect(panner).connect(masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.01);

    trackSound(duration * 1000 + 50);
}

// ─── Footstep sound ───
function playFootstep(spatial = false, pos = null, listenerPos = null) {
    if (!canPlay()) return;
    const audioCtx = getContext();
    const now = audioCtx.currentTime;
    const duration = 0.05;

    const noise = audioCtx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    if (spatial && pos && listenerPos) {
        const panner = createPanner(audioCtx, pos, listenerPos);
        panner.refDistance = 2;
        panner.rolloffFactor = 2;
        noise.connect(lp).connect(gain).connect(panner).connect(masterGain);
    } else {
        noise.connect(lp).connect(gain).connect(masterGain);
    }

    noise.start(now);
    noise.stop(now + duration + 0.01);
    trackSound(duration * 1000 + 30);
}

// ─── Hit marker sounds (non-spatial, constant volume) ───
function playHitSound() {
    const audioCtx = getContext();
    const now = audioCtx.currentTime;

    // Metallic tick
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2200, now);
    osc.frequency.exponentialRampToValueAtTime(1800, now + 0.03);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.05);
}

function playHeadshotSound() {
    const audioCtx = getContext();
    const now = audioCtx.currentTime;

    // Deep thunk
    const osc1 = audioCtx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(300, now);
    osc1.frequency.exponentialRampToValueAtTime(100, now + 0.06);

    const gain1 = audioCtx.createGain();
    gain1.gain.setValueAtTime(0.35, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc1.connect(gain1).connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.08);

    // High ding
    const osc2 = audioCtx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(3200, now);

    const gain2 = audioCtx.createGain();
    gain2.gain.setValueAtTime(0.2, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc2.connect(gain2).connect(masterGain);
    osc2.start(now + 0.01);
    osc2.stop(now + 0.1);
}

// ─── Impact sound (bullet hitting surface) ───
function playImpactSpatial(pos, listenerPos) {
    if (!canPlay()) return;
    const dx = pos[0] - listenerPos[0];
    const dz = pos[2] - listenerPos[2];
    if (Math.sqrt(dx * dx + dz * dz) > 30) return;

    const audioCtx = getContext();
    const now = audioCtx.currentTime;
    const panner = createPanner(audioCtx, pos, listenerPos);
    panner.refDistance = 2;

    const noise = audioCtx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    noise.connect(hp).connect(gain).connect(panner).connect(masterGain);
    noise.start(now);
    noise.stop(now + 0.04);
    trackSound(50);
}

// ─── Public API ───
export function createSoundEngine() {
    return {
        footstepAccum: 0,
        rainSource: null,
        rainGain: null,
        rainFilter: null,
    };
}

export function updateSoundListener(pos, forward) {
    updateListener(pos, forward);
}

export function soundGunshot(pos, weaponType, isLocal, listenerPos) {
    if (isLocal) {
        playGunshotLocal(weaponType);
    } else {
        playGunshotSpatial(pos, listenerPos, weaponType);
    }
}

export function soundFootstep(engine, dt, moving, pos, isLocal, listenerPos) {
    if (!moving) {
        engine.footstepAccum = 0;
        return;
    }
    engine.footstepAccum += dt * 10; // ~10 units/sec walk speed
    if (engine.footstepAccum >= 2.5) {
        engine.footstepAccum -= 2.5;
        playFootstep(!isLocal, pos, listenerPos);
    }
}

export function soundHitMarker(zone) {
    if (zone === 'head') {
        playHeadshotSound();
    } else {
        playHitSound();
    }
}

export function soundImpact(pos, listenerPos) {
    playImpactSpatial(pos, listenerPos);
}

export function primeSoundEngine() {
    getContext();
}

export function updateWeatherAudio(engine, weather = {}, dt = 0) {
    void dt;
    const rainy = weather?.rainy === true;
    if (!engine) return;

    if (!rainy) {
        if (engine.rainGain) {
            const audioCtx = getContext();
            const now = audioCtx.currentTime;
            engine.rainGain.gain.cancelScheduledValues(now);
            engine.rainGain.gain.setTargetAtTime(0.0001, now, 0.12);
        }
        return;
    }

    const audioCtx = getContext();
    if (!engine.rainSource) {
        const source = audioCtx.createBufferSource();
        source.buffer = getNoiseBuffer();
        source.loop = true;

        const hp = audioCtx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 900;

        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 5400;

        const gain = audioCtx.createGain();
        gain.gain.value = 0.0001;

        source.connect(hp).connect(lp).connect(gain).connect(masterGain);
        source.start();
        engine.rainSource = source;
        engine.rainFilter = lp;
        engine.rainGain = gain;
    }

    const now = audioCtx.currentTime;
    engine.rainGain.gain.cancelScheduledValues(now);
    engine.rainGain.gain.setTargetAtTime(0.055, now, 0.35);
}

export function soundThunder(intensity = 1) {
    if (!canPlay()) return;
    const audioCtx = getContext();
    const now = audioCtx.currentTime;
    const duration = 2.6;
    const gainScale = Math.max(0.4, Math.min(1.6, intensity || 1));

    const noise = audioCtx.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(420, now);
    lowpass.frequency.linearRampToValueAtTime(180, now + duration);

    const thunderGain = audioCtx.createGain();
    thunderGain.gain.setValueAtTime(0.0001, now);
    thunderGain.gain.linearRampToValueAtTime(0.12 * gainScale, now + 0.04);
    thunderGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    noise.connect(lowpass).connect(thunderGain).connect(masterGain);
    noise.start(now);
    noise.stop(now + duration + 0.05);

    const rumble = audioCtx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.setValueAtTime(68, now);
    rumble.frequency.exponentialRampToValueAtTime(34, now + duration);
    const rumbleGain = audioCtx.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.linearRampToValueAtTime(0.07 * gainScale, now + 0.08);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    rumble.connect(rumbleGain).connect(masterGain);
    rumble.start(now);
    rumble.stop(now + duration + 0.05);

    trackSound(duration * 1000 + 150);
}
