// Multi-sample clock synchronization with outlier rejection.
//
// On connect: sends INITIAL_PROBE_COUNT probes spaced PROBE_INTERVAL_MS apart,
// discards samples with RTT > median + 1σ, averages remaining offsets.
// Ongoing: re-probes every PERIODIC_INTERVAL_MS with PERIODIC_PROBE_COUNT
// samples, blends into running offset with low weight for stability.

const INITIAL_PROBE_COUNT = 8;
const PERIODIC_PROBE_COUNT = 3;
const PROBE_INTERVAL_MS = 100;
const PERIODIC_INTERVAL_MS = 10000;
const PERIODIC_BLEND_WEIGHT = 0.05;

export function createClockSync() {
    return {
        offset: 0,
        initialDone: false,
        probes: [],
        probesSent: 0,
        probesExpected: 0,
        _probeTimer: null,
        _periodicTimer: null,
        _sendPing: null,
        latencyMs: null,
    };
}

export function startClockSync(cs, sendPingFn) {
    stopClockSync(cs);
    cs._sendPing = sendPingFn;
    cs.initialDone = false;
    cs.offset = 0;
    cs.latencyMs = null;
    cs.probes = [];
    cs.probesSent = 0;
    cs.probesExpected = INITIAL_PROBE_COUNT;

    sendProbe(cs);
    cs._probeTimer = setInterval(() => {
        if (cs.probesSent < INITIAL_PROBE_COUNT) {
            sendProbe(cs);
        } else {
            clearInterval(cs._probeTimer);
            cs._probeTimer = null;
        }
    }, PROBE_INTERVAL_MS);

    cs._periodicTimer = setInterval(() => {
        startPeriodicBatch(cs);
    }, PERIODIC_INTERVAL_MS);
}

export function stopClockSync(cs) {
    if (cs._probeTimer) { clearInterval(cs._probeTimer); cs._probeTimer = null; }
    if (cs._periodicTimer) { clearInterval(cs._periodicTimer); cs._periodicTimer = null; }
    cs._sendPing = null;
}

export function onPong(cs, clientTime, serverTime, receivedAt) {
    if (receivedAt === undefined) receivedAt = Date.now();
    const rtt = Math.max(0, receivedAt - clientTime);
    const offset = serverTime - (clientTime + rtt * 0.5);

    cs.latencyMs = cs.latencyMs == null
        ? rtt
        : Math.round(cs.latencyMs * 0.7 + rtt * 0.3);

    cs.probes.push({ rtt, offset });

    if (cs.probes.length >= cs.probesExpected) {
        finalizeBatch(cs);
    }
}

export function getClockOffset(cs) {
    return cs.offset;
}

export function getLatency(cs) {
    return cs.latencyMs;
}

// --- internal ---

function sendProbe(cs) {
    if (cs._sendPing) {
        cs._sendPing(Date.now());
        cs.probesSent++;
    }
}

function startPeriodicBatch(cs) {
    if (!cs.initialDone) return;
    cs.probes = [];
    cs.probesSent = 0;
    cs.probesExpected = PERIODIC_PROBE_COUNT;

    sendProbe(cs);
    let sent = 1;
    const timer = setInterval(() => {
        if (sent < PERIODIC_PROBE_COUNT) {
            sendProbe(cs);
            sent++;
        } else {
            clearInterval(timer);
        }
    }, PROBE_INTERVAL_MS);
}

function finalizeBatch(cs) {
    const probes = cs.probes;
    if (probes.length === 0) return;

    // Sort by RTT ascending.
    probes.sort((a, b) => a.rtt - b.rtt);

    // Median RTT.
    const mid = Math.floor(probes.length / 2);
    const medianRTT = probes.length % 2 === 0
        ? (probes[mid - 1].rtt + probes[mid].rtt) / 2
        : probes[mid].rtt;

    // Standard deviation of RTT.
    const mean = probes.reduce((s, p) => s + p.rtt, 0) / probes.length;
    const variance = probes.reduce((s, p) => s + (p.rtt - mean) ** 2, 0) / probes.length;
    const stdDev = Math.sqrt(variance);

    // Discard outliers: RTT > median + 1 stddev.
    const threshold = medianRTT + stdDev;
    const good = probes.filter(p => p.rtt <= threshold);
    if (good.length === 0) return;

    const avgOffset = good.reduce((s, p) => s + p.offset, 0) / good.length;

    if (!cs.initialDone) {
        cs.offset = avgOffset;
        cs.initialDone = true;
    } else {
        cs.offset = cs.offset * (1 - PERIODIC_BLEND_WEIGHT) + avgOffset * PERIODIC_BLEND_WEIGHT;
    }

    cs.probes = [];
}
