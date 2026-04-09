import { MODE_CTF, MODE_DEATHMATCH, MODE_HOSTAGE, MODE_TEAM, normalizeMode } from './modes.js';
import { decodeMessage, encodeInput, encodeShoot, encodeThrow, encodeReload, encodeSwitch, encodeBuy, encodePing, applyDeltaToPlayer } from './codec.js';
import { createClockSync, startClockSync, stopClockSync, onPong as clockOnPong, getClockOffset, getLatency } from './clock.js';
import { createJitterBuffer, onSnapshotArrival, getRenderDelayMs as jbGetRenderDelay, resetJitterBuffer, createSnapRing, pushSnapRing, sampleSnapRing } from './jitter.js';

// Delta field group byte ranges — must match server deltaFieldGroups and codec.js DELTA_FIELD_GROUPS.
const _DELTA_SIZES = [
    [0, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 11], [11, 12], [12, 14],
    [14, 19], [19, 20], [20, 23], [23, 26], [26, 29], [29, 33], [33, 36], [36, 38],
];

export function createNet() {
    return {
        ws: null,
        myId: null,
        lobby: null,
        players: {},
        projectiles: [],
        effects: [],
        match: createDefaultMatchState(),
        connected: false,
        gameStarted: false,
        connectionError: '',
        sessionToken: 0,
        latencyMs: null,
        serverClockOffsetMs: 0,
        clockSync: createClockSync(),
        jitterBuffer: createJitterBuffer(),
        onHit: null,
        onKill: null,
        onRespawn: null,
        onLobby: null,
        onDisconnect: null,
        onShot: null,
        onEconomy: null,
        onSelfState: null,
        onMatch: null,
        onRound: null,
        onTeam: null,
        onMode: null,
        onMap: null,
        onRejoin: null,
        onStartDenied: null,
        onChat: null,
        lastRecvSnapshotSeq: 0,
    };
}

export function connect(net, url, name, lobby = null) {
    net.sessionToken += 1;
    const token = net.sessionToken;
    const previous = net.ws;

    if (previous && (previous.readyState === 0 || previous.readyState === 1)) {
        try {
            previous.close();
        } catch {
            // Ignore stale close races.
        }
    }

    resetSession(net);
    net.lobby = lobby ? { ...lobby } : null;

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        net.ws = ws;

        let welcomed = false;
        let settled = false;
        const timeout = setTimeout(() => {
            if (!isActiveSession(net, ws, token) || settled) return;
            settled = true;
            resetSession(net);
            reject(new Error('Connection timed out'));
            try {
                ws.close();
            } catch {
                // Ignore timeout close failures.
            }
        }, 5000);

        function fail(message) {
            if (settled || !isActiveSession(net, ws, token)) return;
            settled = true;
            clearTimeout(timeout);
            resetSession(net);
            net.connectionError = message;
            reject(new Error(message));
        }

        ws.onopen = () => {
            if (!isActiveSession(net, ws, token)) return;
            net.connected = true;
            net.connectionError = '';
            ws.send(JSON.stringify({ t: 'name', name }));
        };

        ws.onmessage = (e) => {
            if (!isActiveSession(net, ws, token)) return;

            let msg;
            if (e.data instanceof ArrayBuffer) {
                msg = decodeMessage(e.data);
                if (!msg) return;
            } else {
                try {
                    msg = JSON.parse(e.data);
                } catch {
                    return;
                }
            }

            handleMsg(net, msg);
            if (msg.t === 'welcome') {
                welcomed = true;
                settled = true;
                clearTimeout(timeout);
                startHeartbeat(net);
                resolve(msg);
            }
        };

        ws.onerror = () => {
            if (!welcomed) {
                fail('Connection failed');
            }
        };

        ws.onclose = (e) => {
            if (!isActiveSession(net, ws, token)) return;
            clearTimeout(timeout);

            if (!welcomed) {
                fail('Connection closed before joining');
                return;
            }

            resetSession(net);
            net.connectionError = e?.reason || 'Disconnected from server';
            if (net.onDisconnect) {
                net.onDisconnect({
                    code: e?.code ?? 0,
                    reason: net.connectionError,
                });
            }
        };
    });
}

function handleMsg(net, msg) {
    switch (msg.t) {
        case 'welcome': {
            net.myId = msg.id;
            applyGameState(net, msg.state);
            applyMatchState(net, msg.match);
            const self = ensurePlayer(net, msg.id);
            applyPlayerState(self, msg, true);
            notifySelfState(net, msg.id, true);
            break;
        }

        case 'lobby': {
            const ids = new Set();
            for (const entry of msg.players || []) {
                const key = normalizeId(entry.id);
                const player = ensurePlayer(net, entry.id);
                ids.add(key);
                applyPlayerState(player, entry, false);
                if (Number(entry.id) === net.myId) {
                    notifySelfState(net, entry.id);
                }
            }

            for (const id of Object.keys(net.players)) {
                if (!ids.has(id)) {
                    delete net.players[id];
                }
            }

            applyGameState(net, msg.state);
            applyMatchState(net, msg.match);
            if (net.onLobby) net.onLobby(msg);
            break;
        }

        case 'start':
            if (msg.ok === false) {
                if (net.onStartDenied) net.onStartDenied(msg);
                break;
            }
            net.gameStarted = true;
            applyMatchState(net, msg.match);
            break;

        case 'team':
            if (net.onTeam) net.onTeam(msg);
            break;

        case 'mode':
            if (net.onMode) net.onMode(msg);
            break;

        case 'map':
            if (net.onMap) net.onMap(msg);
            break;

        case 'rejoin':
            if (net.onRejoin) net.onRejoin(msg);
            break;

        case 'round':
            if (msg.snapshotSeq) net.lastRecvSnapshotSeq = msg.snapshotSeq;
            applySnapshot(net, msg, true);
            if (net.onRound) net.onRound(msg);
            break;

        case 'state':
            if (msg.snapshotSeq) net.lastRecvSnapshotSeq = msg.snapshotSeq;
            applySnapshot(net, msg, false);
            break;

        case 'deltaState':
            if (msg.snapshotSeq) net.lastRecvSnapshotSeq = msg.snapshotSeq;
            applyDeltaSnapshot(net, msg);
            break;

        case 'hit':
            if (net.onHit) net.onHit(msg);
            break;

        case 'kill':
            if (msg.killer != null) {
                const killer = ensurePlayer(net, msg.killer);
                if (msg.killer !== msg.victim) {
                    killer.kills = (killer.kills ?? 0) + 1;
                }
            }
            if (msg.victim != null) {
                const victim = ensurePlayer(net, msg.victim);
                victim.deaths = (victim.deaths ?? 0) + 1;
                victim.alive = false;
            }
            if (net.onKill) net.onKill(msg);
            break;

        case 'respawn': {
            const target = ensurePlayer(net, msg.id);
            applyPlayerState(target, msg, true);
            if (msg.id == net.myId) {
                notifySelfState(net, msg.id, true);
                if (net.onRespawn) net.onRespawn(msg);
            }
            break;
        }

        case 'economy': {
            const playerId = msg.id ?? net.myId;
            const target = ensurePlayer(net, playerId);
            applyPlayerState(target, msg, false);
            notifySelfState(net, playerId);
            if (net.onEconomy) net.onEconomy(msg);
            break;
        }

        case 'shot': {
            const target = ensurePlayer(net, msg.id);
            target.shotTime = 0.12;
            if (typeof msg.weapon === 'string') {
                target.activeWeapon = msg.weapon;
            }
            if (net.onShot) net.onShot(msg);
            break;
        }

        case 'pong':
            applyPong(net, msg);
            break;

        case 'inputAck':
            if (net.onInputAck) net.onInputAck(msg.lastProcessedSeq, msg.velY, msg.onGround);
            break;

        case 'leave':
            delete net.players[normalizeId(msg.id)];
            break;

        case 'chat':
            if (net.onChat) net.onChat(msg);
            break;
    }
}

function applySnapshot(net, msg, includeSelfTransform) {
    applyMatchState(net, msg.match);

    // Reuse projectile objects in-place to avoid GC pressure.
    const projArr = net.projectiles;
    let pCount = 0;
    if (Array.isArray(msg.projectiles)) {
        for (let i = 0; i < msg.projectiles.length; i++) {
            const p = msg.projectiles[i];
            if (!p?.pos || !p?.type) continue;
            let obj = projArr[pCount];
            if (!obj) {
                obj = { id: 0, type: '', pos: [0, 0, 0] };
                projArr[pCount] = obj;
            }
            obj.id = p.id ?? 0;
            obj.type = p.type;
            obj.pos[0] = p.pos[0]; obj.pos[1] = p.pos[1]; obj.pos[2] = p.pos[2];
            pCount++;
        }
    }
    projArr.length = pCount;

    // Reuse effect objects in-place.
    const effArr = net.effects;
    let eCount = 0;
    if (Array.isArray(msg.effects)) {
        for (let i = 0; i < msg.effects.length; i++) {
            const e = msg.effects[i];
            if (!e?.pos || !e?.type) continue;
            let obj = effArr[eCount];
            if (!obj) {
                obj = { type: '', pos: [0, 0, 0], radius: 0, timeLeftMs: 0 };
                effArr[eCount] = obj;
            }
            obj.type = e.type;
            obj.pos[0] = e.pos[0]; obj.pos[1] = e.pos[1]; obj.pos[2] = e.pos[2];
            obj.radius = e.radius ?? 0;
            obj.timeLeftMs = e.timeLeftMs ?? 0;
            eCount++;
        }
    }
    effArr.length = eCount;

    const players = msg.players || {};
    const serverTimeMs = typeof msg.serverTime === 'number' ? msg.serverTime : null;
    syncSnapshotClock(net, serverTimeMs);

    for (const id in players) {
        const target = ensurePlayer(net, id);
        const isSelf = Number(id) === net.myId;
        applyPlayerState(target, players[id], includeSelfTransform || !isSelf, serverTimeMs);
        if (isSelf) {
            // Store the server-authoritative position for reconciliation.
            const pd = players[id];
            if (pd && pd.pos) {
                if (!net.serverAuthPos) net.serverAuthPos = [0, 0, 0];
                net.serverAuthPos[0] = pd.pos[0];
                net.serverAuthPos[1] = pd.pos[1];
                net.serverAuthPos[2] = pd.pos[2];
            }
            notifySelfState(net, id, includeSelfTransform);
            // Trigger reconciliation callback with server position.
            if (net.onReconcile && net.serverAuthPos) {
                net.onReconcile(net.serverAuthPos);
            }
        }
    }
}

function applyDeltaSnapshot(net, msg) {
    applyMatchState(net, msg.match);

    // Projectiles — same handling as full snapshot.
    const projArr = net.projectiles;
    let pCount = 0;
    if (Array.isArray(msg.projectiles)) {
        for (let i = 0; i < msg.projectiles.length; i++) {
            const p = msg.projectiles[i];
            if (!p?.pos || !p?.type) continue;
            let obj = projArr[pCount];
            if (!obj) {
                obj = { id: 0, type: '', pos: [0, 0, 0] };
                projArr[pCount] = obj;
            }
            obj.id = p.id ?? 0;
            obj.type = p.type;
            obj.pos[0] = p.pos[0]; obj.pos[1] = p.pos[1]; obj.pos[2] = p.pos[2];
            pCount++;
        }
    }
    projArr.length = pCount;

    // Effects — same handling as full snapshot.
    const effArr = net.effects;
    let eCount = 0;
    if (Array.isArray(msg.effects)) {
        for (let i = 0; i < msg.effects.length; i++) {
            const e = msg.effects[i];
            if (!e?.pos || !e?.type) continue;
            let obj = effArr[eCount];
            if (!obj) {
                obj = { type: '', pos: [0, 0, 0], radius: 0, timeLeftMs: 0 };
                effArr[eCount] = obj;
            }
            obj.type = e.type;
            obj.pos[0] = e.pos[0]; obj.pos[1] = e.pos[1]; obj.pos[2] = e.pos[2];
            obj.radius = e.radius ?? 0;
            obj.timeLeftMs = e.timeLeftMs ?? 0;
            eCount++;
        }
    }
    effArr.length = eCount;

    const serverTimeMs = typeof msg.serverTime === 'number' ? msg.serverTime : null;
    syncSnapshotClock(net, serverTimeMs);

    // Remove players not in this snapshot.
    for (const existingId in net.players) {
        if (!msg.playerIds.has(Number(existingId))) {
            delete net.players[existingId];
        }
    }

    // Apply player deltas.
    for (const [idStr, delta] of Object.entries(msg.playerDeltas)) {
        const id = Number(idStr);
        const target = ensurePlayer(net, id);
        const isSelf = id === net.myId;

        if (delta.full) {
            // Full state — use normal apply path.
            applyPlayerState(target, delta.state, !isSelf, serverTimeMs);
            if (isSelf && delta.state.pos) {
                if (!net.serverAuthPos) net.serverAuthPos = [0, 0, 0];
                net.serverAuthPos[0] = delta.state.pos[0];
                net.serverAuthPos[1] = delta.state.pos[1];
                net.serverAuthPos[2] = delta.state.pos[2];
            }
        } else if (isSelf) {
            // Self player delta: apply non-transform fields (mask out bits 0-4).
            // Extract server position from delta for reconciliation.
            const v = msg.dataView;
            let dOff = delta.dataOffset;
            const mask = delta.changedMask;
            if (!net.serverAuthPos) net.serverAuthPos = [0, 0, 0];
            // Read position fields from the delta if present.
            for (let bit = 0; bit < 5; bit++) {
                if (!(mask & (1 << bit))) continue;
                const [start, end] = _DELTA_SIZES[bit];
                const size = end - start;
                switch (bit) {
                    case 0: net.serverAuthPos[0] = v.getInt16(dOff, true) / 256; break;
                    case 1: net.serverAuthPos[1] = v.getInt16(dOff, true) / 1024; break;
                    case 2: net.serverAuthPos[2] = v.getInt16(dOff, true) / 256; break;
                    // bits 3,4 (yaw/pitch) — skip for self, don't need
                }
                dOff += size;
            }
            // Apply only non-transform fields (bits 5-15) to the player state.
            const nonTransformMask = mask & 0xFFE0;
            if (nonTransformMask) {
                // Compute byte offset for non-transform fields by skipping bits 0-4.
                let skipOff = delta.dataOffset;
                for (let bit = 0; bit < 5; bit++) {
                    if (mask & (1 << bit)) {
                        const [s, e] = _DELTA_SIZES[bit];
                        skipOff += e - s;
                    }
                }
                applyDeltaToPlayer(target, v, skipOff, nonTransformMask);
            }
        } else {
            // Remote player delta — apply everything.
            applyDeltaToPlayer(target, msg.dataView, delta.dataOffset, delta.changedMask);
            // Update interpolation state if transforms changed.
            if (delta.changedMask & 0x1F) {
                applyTransformState(target, target.pos, target.yaw, target.pitch, target.crouching, serverTimeMs);
            }
        }

        if (isSelf) {
            notifySelfState(net, id);
            if (net.onReconcile && net.serverAuthPos) {
                net.onReconcile(net.serverAuthPos);
            }
        }
    }
}

export function sendInput(net, cmd) {
    if (!canSend(net)) return;
    net.ws.send(encodeInput(cmd, net.lastRecvSnapshotSeq));
}

export function sendShoot(net, dir, weapon, aiming = false, alternate = false) {
    if (!canSend(net)) return;
    net.ws.send(encodeShoot(dir, Math.round(estimateServerTime(net, Date.now())), weapon, aiming, alternate));
}

export function sendThrow(net, dir, weapon) {
    if (!canSend(net)) return;
    net.ws.send(encodeThrow(dir, weapon));
}

export function sendStart(net) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'start' }));
}

export function sendTeam(net, team) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'team', team }));
}

export function sendMode(net, mode) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'mode', mode: normalizeMode(mode) }));
}

export function sendMap(net, mapName) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'map', map: mapName }));
}

export function sendRejoin(net, yes) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'rejoin', yes: !!yes }));
}

export function sendLeaveMatch(net) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'leaveMatch' }));
}

export function sendBuy(net, item) {
    if (!canSend(net)) return;
    net.ws.send(encodeBuy(item));
}

export function sendReload(net) {
    if (!canSend(net)) return;
    net.ws.send(encodeReload());
}

export function sendSwitchWeapon(net, weapon) {
    if (!canSend(net)) return;
    net.ws.send(encodeSwitch(weapon));
}

export function sendChat(net, text) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'chat', text }));
}

function ensurePlayer(net, id) {
    const key = normalizeId(id);
    if (!net.players[key]) {
        net.players[key] = {
            pos: [0, 1.7, 0],
            yaw: 0,
            pitch: 0,
            hp: 100,
            armor: 0,
            credits: 0,
            name: '???',
            alive: true,
            crouching: false,
            pistolWeapon: '',
            pistolClip: 0,
            pistolReserve: 0,
            heavyWeapon: '',
            heavyClip: 0,
            heavyReserve: 0,
            bombs: 0,
            smokes: 0,
            flashbangs: 0,
            flashTimeLeftMs: 0,
            spawnProtectionTimeLeftMs: 0,
            loadoutTimeLeftMs: 0,
            team: '',
            inMatch: true,
            isBot: false,
            activeWeapon: 'knife',
            reloading: false,
            reloadTimeLeftMs: 0,
            shotTime: 0,
            kills: 0,
            deaths: 0,
            snapRing: createSnapRing(),
            renderSample: {
                pos: [0, 1.7, 0],
                yaw: 0,
                pitch: 0,
                crouching: false,
            },
        };
    }
    return net.players[key];
}

function normalizeId(id) {
    return String(id);
}

function canSend(net) {
    return !!(net.connected && net.ws && net.ws.readyState === 1);
}

function applyPlayerState(target, state, includeTransform = true, serverTimeMs = null) {
    target.kills = state.kills ?? target.kills;
    target.deaths = state.deaths ?? target.deaths;
    target.name = state.name ?? target.name;
    target.hp = state.hp ?? target.hp;
    target.armor = state.armor ?? target.armor;
    target.credits = state.credits ?? target.credits;
    target.crouching = state.crouching ?? target.crouching;
    target.pistolWeapon = state.pistolWeapon ?? target.pistolWeapon;
    target.heavyWeapon = state.heavyWeapon ?? target.heavyWeapon;
    target.pistolClip = state.pistolClip ?? target.pistolClip;
    target.pistolReserve = state.pistolReserve ?? target.pistolReserve;
    target.heavyClip = state.heavyClip ?? target.heavyClip;
    target.heavyReserve = state.heavyReserve ?? target.heavyReserve;
    target.bombs = state.bombs ?? target.bombs;
    target.smokes = state.smokes ?? target.smokes;
    target.flashbangs = state.flashbangs ?? target.flashbangs;
    target.flashTimeLeftMs = state.flashTimeLeftMs ?? target.flashTimeLeftMs;
    target.spawnProtectionTimeLeftMs = state.spawnProtectionTimeLeftMs ?? target.spawnProtectionTimeLeftMs;
    target.loadoutTimeLeftMs = state.loadoutTimeLeftMs ?? target.loadoutTimeLeftMs;
    target.team = state.team ?? target.team;
    if (typeof state.inMatch === 'boolean') target.inMatch = state.inMatch;
    if (typeof state.isBot === 'boolean') target.isBot = state.isBot;
    target.activeWeapon = state.activeWeapon ?? target.activeWeapon;
    if (typeof state.reloading === 'boolean') {
        target.reloading = state.reloading;
        if (!state.reloading && typeof state.reloadTimeLeftMs !== 'number') {
            target.reloadTimeLeftMs = 0;
        }
    }
    if (typeof state.reloadTimeLeftMs === 'number') {
        target.reloadTimeLeftMs = state.reloadTimeLeftMs;
        target.reloading = typeof state.reloading === 'boolean'
            ? (state.reloading || state.reloadTimeLeftMs > 0)
            : state.reloadTimeLeftMs > 0;
    }

    if (typeof state.alive === 'boolean') {
        target.alive = state.alive;
        if (!state.alive) {
            target.spawnProtectionTimeLeftMs = 0;
            target.loadoutTimeLeftMs = 0;
        }
    } else if (typeof state.hp === 'number') {
        target.alive = state.hp > 0;
        if (state.hp <= 0) {
            target.spawnProtectionTimeLeftMs = 0;
            target.loadoutTimeLeftMs = 0;
        }
    }

    if (!includeTransform) return;

    const nextPos = state.pos || target.pos;
    const nextYaw = typeof state.yaw === 'number' ? state.yaw : target.yaw;
    const nextPitch = typeof state.pitch === 'number' ? state.pitch : target.pitch;
    applyTransformState(target, nextPos, nextYaw, nextPitch, target.crouching, serverTimeMs);
}

function applyMatchState(net, match) {
    if (!match) return;

    const mode = normalizeMode(match.mode ?? net.match.mode);
    net.match.mode = mode;
    net.match.map = match.map ?? net.match.map;
    net.match.currentRound = match.currentRound ?? net.match.currentRound;
    net.match.totalRounds = match.totalRounds ?? net.match.totalRounds;
    net.match.roundTimeLeftMs = match.roundTimeLeftMs ?? net.match.roundTimeLeftMs;
    net.match.buyTimeLeftMs = match.buyTimeLeftMs ?? net.match.buyTimeLeftMs;
    net.match.buyPhase = match.buyPhase ?? net.match.buyPhase;
    net.match.intermission = match.intermission ?? net.match.intermission;
    net.match.intermissionTimeLeftMs = match.intermissionTimeLeftMs ?? net.match.intermissionTimeLeftMs;
    net.match.roundWinner = match.roundWinner ?? net.match.roundWinner;
    net.match.blueScore = match.blueScore ?? net.match.blueScore;
    net.match.greenScore = match.greenScore ?? net.match.greenScore;
    net.match.blueAlive = match.blueAlive ?? net.match.blueAlive;
    net.match.greenAlive = match.greenAlive ?? net.match.greenAlive;
    net.match.deathmatchVoteActive = match.deathmatchVoteActive ?? net.match.deathmatchVoteActive;
    net.match.deathmatchVoteTimeLeftMs = match.deathmatchVoteTimeLeftMs ?? net.match.deathmatchVoteTimeLeftMs;
    net.match.hostages = mode === MODE_HOSTAGE
        ? (Array.isArray(match.hostages) ? match.hostages : [])
        : [];
    net.match.flags = mode === MODE_CTF
        ? (Array.isArray(match.flags) ? match.flags : [])
        : [];
    net.match.blueCTFCaptures = mode === MODE_CTF
        ? (match.blueCTFCaptures ?? net.match.blueCTFCaptures)
        : 0;
    net.match.greenCTFCaptures = mode === MODE_CTF
        ? (match.greenCTFCaptures ?? net.match.greenCTFCaptures)
        : 0;
    net.match.rescueZones = mode === MODE_HOSTAGE
        ? (Array.isArray(match.rescueZones) ? match.rescueZones : [])
        : [];
    net.match.healthRestorePoints = Array.isArray(match.healthRestorePoints)
        ? match.healthRestorePoints.map((point) => ({
            x: point.x ?? 0,
            z: point.z ?? 0,
            radius: point.radius ?? 0,
            healAmount: point.healAmount ?? 0,
            cooldownSec: point.cooldownSec ?? 0,
            cooldownTimeLeftMs: point.cooldownTimeLeftMs ?? 0,
            active: point.active !== false,
        }))
        : (mode === MODE_DEATHMATCH ? net.match.healthRestorePoints : []);
    if (typeof match.deathmatchVoteTimeLeftMs === 'number') {
        net.match.deathmatchVoteEndsAtClientMs = Date.now() + Math.max(0, match.deathmatchVoteTimeLeftMs);
    } else if (match.deathmatchVoteActive === false) {
        net.match.deathmatchVoteEndsAtClientMs = 0;
    }

    if (net.onMatch) {
        net.onMatch(net.match);
    }
}

function createDefaultMatchState() {
    return {
        mode: MODE_TEAM,
        map: 'office_studio',
        currentRound: 0,
        totalRounds: 0,
        roundTimeLeftMs: 0,
        buyTimeLeftMs: 0,
        buyPhase: false,
        intermission: false,
        intermissionTimeLeftMs: 0,
        roundWinner: '',
        blueScore: 0,
        greenScore: 0,
        blueAlive: 0,
        greenAlive: 0,
        deathmatchVoteActive: false,
        deathmatchVoteTimeLeftMs: 0,
        deathmatchVoteEndsAtClientMs: 0,
        hostages: [],
        flags: [],
        blueCTFCaptures: 0,
        greenCTFCaptures: 0,
        rescueZones: [],
        healthRestorePoints: [],
    };
}

function notifySelfState(net, id, includeTransform = false) {
    if (Number(id) !== net.myId || !net.onSelfState) {
        return;
    }

    const target = net.players[normalizeId(id)];
    if (target) {
        const state = {
            ...target,
            pos: target.pos ? [...target.pos] : target.pos,
        };
        if (!includeTransform) {
            delete state.pos;
            delete state.yaw;
            delete state.pitch;
            delete state.crouching;
        }
        net.onSelfState(state);
    }
}

function applyGameState(net, state) {
    if (state === 'playing') {
        net.gameStarted = true;
    } else if (state === 'waiting') {
        net.gameStarted = false;
        net.projectiles = [];
        net.effects = [];
        net.match.buyPhase = false;
        net.match.buyTimeLeftMs = 0;
        net.match.roundTimeLeftMs = 0;
        net.match.intermission = false;
        net.match.intermissionTimeLeftMs = 0;
        net.match.roundWinner = '';
        net.match.blueAlive = 0;
        net.match.greenAlive = 0;
        net.match.deathmatchVoteActive = false;
        net.match.deathmatchVoteTimeLeftMs = 0;
        net.match.deathmatchVoteEndsAtClientMs = 0;
        net.match.healthRestorePoints = [];
    }
}

function resetSession(net) {
    stopHeartbeat(net);
    net.ws = null;
    net.myId = null;
    net.lobby = null;
    net.players = {};
    net.projectiles = [];
    net.effects = [];
    net.match = createDefaultMatchState();
    net.connected = false;
    net.gameStarted = false;
    net.latencyMs = null;
    net.serverClockOffsetMs = 0;
    net.clockSync = createClockSync();
    resetJitterBuffer(net.jitterBuffer);
    net.lastRecvSnapshotSeq = 0;
}

function isActiveSession(net, ws, token) {
    return net.sessionToken === token && net.ws === ws;
}

function startHeartbeat(net) {
    if (typeof window === 'undefined') return;
    startClockSync(net.clockSync, (clientTime) => {
        if (!canSend(net)) return;
        net.ws.send(encodePing(clientTime));
    });
}

function stopHeartbeat(net) {
    stopClockSync(net.clockSync);
}

export function applyPong(net, msg, receivedAt = Date.now()) {
    if (typeof msg?.clientTime !== 'number' || typeof msg?.serverTime !== 'number') {
        return;
    }

    clockOnPong(net.clockSync, msg.clientTime, msg.serverTime, receivedAt);
    net.latencyMs = getLatency(net.clockSync);
    net.serverClockOffsetMs = getClockOffset(net.clockSync);
}

export function estimateServerTime(net, clientTime = Date.now()) {
    return clientTime + (getClockOffset(net.clockSync) || net.serverClockOffsetMs || 0);
}

export function getAdaptiveRenderDelay(net) {
    return jbGetRenderDelay(net.jitterBuffer);
}

export function sampleRemotePlayer(player, renderServerTimeMs) {
    if (!player) {
        return null;
    }

    const sample = player.renderSample || {
        pos: [0, 1.7, 0],
        yaw: 0,
        pitch: 0,
        crouching: false,
    };
    player.renderSample = sample;

    if (player.snapRing && player.snapRing.count > 0) {
        sampleSnapRing(player.snapRing, renderServerTimeMs, sample);
        return sample;
    }

    // Fallback for players with no snapshot ring entries yet.
    copyVec3(sample.pos, player.pos);
    sample.yaw = player.yaw;
    sample.pitch = player.pitch;
    sample.crouching = player.crouching;
    return sample;
}

function applyTransformState(target, nextPos, nextYaw, nextPitch, nextCrouching, serverTimeMs) {
    copyVec3(target.pos, nextPos);
    target.yaw = nextYaw;
    target.pitch = nextPitch;

    // Push into snapshot ring for interpolation.
    const t = (typeof serverTimeMs === 'number' && Number.isFinite(serverTimeMs)) ? serverTimeMs : 0;
    if (target.snapRing) {
        pushSnapRing(target.snapRing, t, target.pos, nextYaw, nextPitch, nextCrouching);
    }
}

function copyVec3(target, source) {
    target[0] = source?.[0] ?? 0;
    target[1] = source?.[1] ?? 0;
    target[2] = source?.[2] ?? 0;
}

function syncSnapshotClock(net, serverTimeMs, receivedAt = Date.now()) {
    if (typeof serverTimeMs !== 'number' || !Number.isFinite(serverTimeMs)) {
        return;
    }

    // Snapshot-based clock offset (backup — primary comes from ping/pong probes).
    const offset = serverTimeMs - receivedAt;
    net.serverClockOffsetMs = net.serverClockOffsetMs === 0
        ? offset
        : net.serverClockOffsetMs * 0.85 + offset * 0.15;

    // Track snapshot arrival jitter for adaptive render delay.
    onSnapshotArrival(net.jitterBuffer, receivedAt);
}
