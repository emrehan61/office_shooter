// Adaptive jitter buffer — measures inter-snapshot arrival jitter and computes
// a render delay that absorbs network variance without adding unnecessary lag.
//
// Also provides a per-player snapshot ring buffer for robust interpolation:
// always two bounding snapshots available, with linear extrapolation (up to
// 100ms) when the buffer runs dry from packet loss.

const MIN_DELAY_MS = 33;            // 2 ticks at 60Hz
const MAX_DELAY_MS = 200;
const INITIAL_DELAY_MS = 100;       // start at old fixed value, adapt from there
const JITTER_EMA_WEIGHT = 0.1;
const EXPECTED_INTERVAL_MS = 1000 / 60; // ~16.67ms
const SNAP_RING_SIZE = 6;           // per-player snapshot ring entries
const MAX_EXTRAPOLATE_MS = 100;

// --- Jitter tracker ---

export function createJitterBuffer() {
    return {
        lastArrivalMs: 0,
        jitterEma: 0,
        renderDelayMs: INITIAL_DELAY_MS,
    };
}

export function onSnapshotArrival(jb, arrivedAtMs) {
    if (arrivedAtMs === undefined) arrivedAtMs = Date.now();
    if (jb.lastArrivalMs > 0) {
        const interval = arrivedAtMs - jb.lastArrivalMs;
        const deviation = Math.abs(interval - EXPECTED_INTERVAL_MS);
        jb.jitterEma = jb.jitterEma * (1 - JITTER_EMA_WEIGHT) + deviation * JITTER_EMA_WEIGHT;

        const twoTicks = 2 * EXPECTED_INTERVAL_MS;
        const threeJitter = 3 * jb.jitterEma;
        jb.renderDelayMs = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.max(twoTicks, threeJitter)));
    }
    jb.lastArrivalMs = arrivedAtMs;
}

export function getRenderDelayMs(jb) {
    return jb.renderDelayMs;
}

export function resetJitterBuffer(jb) {
    jb.lastArrivalMs = 0;
    jb.jitterEma = 0;
    jb.renderDelayMs = INITIAL_DELAY_MS;
}

// --- Per-player snapshot ring ---

export function createSnapRing() {
    return { entries: new Array(SNAP_RING_SIZE).fill(null), head: 0, count: 0 };
}

export function pushSnapRing(ring, serverTimeMs, pos, yaw, pitch, crouching) {
    ring.entries[ring.head] = {
        t: serverTimeMs,
        px: pos[0], py: pos[1], pz: pos[2],
        yaw, pitch,
        crouching: !!crouching,
    };
    ring.head = (ring.head + 1) % SNAP_RING_SIZE;
    if (ring.count < SNAP_RING_SIZE) ring.count++;
}

export function clearSnapRing(ring) {
    ring.entries.fill(null);
    ring.head = 0;
    ring.count = 0;
}

// Find bounding snapshots and interpolate for the given render server time.
// Returns {pos:[x,y,z], yaw, pitch, crouching} written into `out`.
export function sampleSnapRing(ring, renderTimeMs, out) {
    const count = ring.count;
    if (count === 0) return false;

    // Collect entries sorted by server time (oldest first).
    // Ring is small (6) so a simple insertion-sort inline is fine.
    const sorted = _sortBuf;
    let n = 0;
    for (let i = 0; i < count; i++) {
        const idx = (ring.head - count + i + SNAP_RING_SIZE) % SNAP_RING_SIZE;
        const e = ring.entries[idx];
        if (e) sorted[n++] = e;
    }
    if (n === 0) return false;
    // insertion sort (n ≤ 6)
    for (let i = 1; i < n; i++) {
        const key = sorted[i];
        let j = i - 1;
        while (j >= 0 && sorted[j].t > key.t) { sorted[j + 1] = sorted[j]; j--; }
        sorted[j + 1] = key;
    }

    // Find bounding pair.
    let from = null, to = null;
    for (let i = 0; i < n - 1; i++) {
        if (sorted[i].t <= renderTimeMs && sorted[i + 1].t >= renderTimeMs) {
            from = sorted[i];
            to = sorted[i + 1];
            break;
        }
    }

    if (from && to) {
        const span = to.t - from.t;
        const t = span > 0 ? clamp01((renderTimeMs - from.t) / span) : 1;
        lerpSnap(from, to, t, out);
        return true;
    }

    const latest = sorted[n - 1];
    if (renderTimeMs > latest.t) {
        // Past all snapshots — extrapolate if we have at least 2 entries and < 100ms gap.
        const gap = renderTimeMs - latest.t;
        if (n >= 2 && gap <= MAX_EXTRAPOLATE_MS) {
            const prev = sorted[n - 2];
            extrapolateSnap(prev, latest, renderTimeMs, out);
            return true;
        }
        // Freeze at last known.
        copySnap(latest, out);
        return true;
    }

    // Before all snapshots — use earliest.
    copySnap(sorted[0], out);
    return true;
}

// --- helpers ---

// Reusable sort buffer (avoids allocation per frame).
const _sortBuf = new Array(SNAP_RING_SIZE);

function clamp01(v) { return v <= 0 ? 0 : v >= 1 ? 1 : v; }

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

function lerpSnap(a, b, t, out) {
    out.pos[0] = lerp(a.px, b.px, t);
    out.pos[1] = lerp(a.py, b.py, t);
    out.pos[2] = lerp(a.pz, b.pz, t);
    out.yaw = lerpAngle(a.yaw, b.yaw, t);
    out.pitch = lerp(a.pitch, b.pitch, t);
    out.crouching = t >= 0.5 ? b.crouching : a.crouching;
}

function extrapolateSnap(prev, latest, renderTimeMs, out) {
    const span = latest.t - prev.t;
    if (span <= 0) { copySnap(latest, out); return; }
    const dt = (renderTimeMs - latest.t) / span;
    out.pos[0] = latest.px + (latest.px - prev.px) * dt;
    out.pos[1] = latest.py + (latest.py - prev.py) * dt;
    out.pos[2] = latest.pz + (latest.pz - prev.pz) * dt;
    out.yaw = latest.yaw + normalizeAngle(latest.yaw - prev.yaw) * dt;
    out.pitch = latest.pitch + (latest.pitch - prev.pitch) * dt;
    out.crouching = latest.crouching;
}

function copySnap(e, out) {
    out.pos[0] = e.px;
    out.pos[1] = e.py;
    out.pos[2] = e.pz;
    out.yaw = e.yaw;
    out.pitch = e.pitch;
    out.crouching = e.crouching;
}

function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}
