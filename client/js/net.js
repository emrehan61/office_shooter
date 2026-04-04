import { MODE_TEAM, normalizeMode } from './modes.js';

export function createNet() {
    return {
        ws: null,
        myId: null,
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
        pingTimer: null,
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
        onRejoin: null,
        onStartDenied: null,
        onChat: null,
    };
}

export function connect(net, url, name) {
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

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
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
            try {
                msg = JSON.parse(e.data);
            } catch {
                return;
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

        case 'rejoin':
            if (net.onRejoin) net.onRejoin(msg);
            break;

        case 'round':
            applySnapshot(net, msg, true);
            if (net.onRound) net.onRound(msg);
            break;

        case 'state':
            applySnapshot(net, msg, false);
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
    net.projectiles = Array.isArray(msg.projectiles)
        ? msg.projectiles
            .filter((projectile) => projectile?.pos && projectile?.type)
            .map((projectile) => ({
                id: projectile.id ?? 0,
                type: projectile.type,
                pos: [...projectile.pos],
            }))
        : [];
    net.effects = Array.isArray(msg.effects)
        ? msg.effects
            .filter((effect) => effect?.pos && effect?.type)
            .map((effect) => ({
                type: effect.type,
                pos: [...effect.pos],
                radius: effect.radius ?? 0,
                timeLeftMs: effect.timeLeftMs ?? 0,
            }))
        : [];
    const players = msg.players || {};
    const serverTimeMs = typeof msg.serverTime === 'number' ? msg.serverTime : null;
    syncSnapshotClock(net, serverTimeMs);

    for (const id in players) {
        const target = ensurePlayer(net, id);
        const isSelf = Number(id) === net.myId;
        applyPlayerState(target, players[id], includeSelfTransform || !isSelf, serverTimeMs);
        if (isSelf) {
            notifySelfState(net, id, includeSelfTransform);
        }
    }
}

export function sendInput(net, pos, yaw, pitch, crouching = false) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({
        t: 'input',
        pos: [pos[0], pos[1], pos[2]],
        yaw,
        pitch,
        crouching: !!crouching,
    }));
}

export function sendShoot(net, dir, weapon, aiming = false, alternate = false) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({
        t: 'shoot',
        dir: [dir[0], dir[1], dir[2]],
        shotTime: Math.round(estimateServerTime(net, Date.now())),
        weapon,
        aiming: !!aiming,
        alternate: !!alternate,
    }));
}

export function sendThrow(net, dir, weapon) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({
        t: 'throw',
        dir: [dir[0], dir[1], dir[2]],
        weapon,
    }));
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

export function sendRejoin(net, yes) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'rejoin', yes: !!yes }));
}

export function sendBuy(net, item) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'buy', item }));
}

export function sendReload(net) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'reload' }));
}

export function sendSwitchWeapon(net, weapon) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'switch', weapon }));
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
            prevPos: [0, 1.7, 0],
            targetPos: [0, 1.7, 0],
            yaw: 0,
            prevYaw: 0,
            targetYaw: 0,
            pitch: 0,
            prevPitch: 0,
            targetPitch: 0,
            hp: 100,
            armor: 0,
            credits: 0,
            name: '???',
            alive: true,
            crouching: false,
            prevCrouching: false,
            targetCrouching: false,
            hasPistol: false,
            hasMachineGun: false,
            pistolClip: 0,
            pistolReserve: 0,
            machineGunClip: 0,
            machineGunReserve: 0,
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
            prevSnapshotServerTimeMs: 0,
            targetSnapshotServerTimeMs: 0,
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
    target.hasPistol = state.hasPistol ?? target.hasPistol;
    target.hasMachineGun = state.hasMachineGun ?? target.hasMachineGun;
    target.pistolClip = state.pistolClip ?? target.pistolClip;
    target.pistolReserve = state.pistolReserve ?? target.pistolReserve;
    target.machineGunClip = state.machineGunClip ?? target.machineGunClip;
    target.machineGunReserve = state.machineGunReserve ?? target.machineGunReserve;
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

    const nextPos = state.pos ? cloneVec3(state.pos) : target.pos;
    const nextYaw = typeof state.yaw === 'number' ? state.yaw : target.yaw;
    const nextPitch = typeof state.pitch === 'number' ? state.pitch : target.pitch;
    applyTransformState(target, nextPos, nextYaw, nextPitch, target.crouching, serverTimeMs);
}

function applyMatchState(net, match) {
    if (!match) return;

    net.match.mode = normalizeMode(match.mode ?? net.match.mode);
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
    }
}

function resetSession(net) {
    stopHeartbeat(net);
    net.ws = null;
    net.myId = null;
    net.players = {};
    net.projectiles = [];
    net.effects = [];
    net.match = createDefaultMatchState();
    net.connected = false;
    net.gameStarted = false;
    net.latencyMs = null;
    net.serverClockOffsetMs = 0;
}

function isActiveSession(net, ws, token) {
    return net.sessionToken === token && net.ws === ws;
}

function startHeartbeat(net) {
    if (typeof window === 'undefined' || net.pingTimer) {
        return;
    }

    const sendPing = () => {
        if (!canSend(net)) return;
        net.ws.send(JSON.stringify({
            t: 'ping',
            clientTime: Date.now(),
        }));
    };

    sendPing();
    net.pingTimer = window.setInterval(sendPing, 1000);
}

function stopHeartbeat(net) {
    if (typeof window !== 'undefined' && net.pingTimer) {
        window.clearInterval(net.pingTimer);
    }
    net.pingTimer = null;
}

export function applyPong(net, msg, receivedAt = Date.now()) {
    if (typeof msg?.clientTime !== 'number' || typeof msg?.serverTime !== 'number') {
        return;
    }

    const rtt = Math.max(0, receivedAt - msg.clientTime);
    const offset = msg.serverTime - (msg.clientTime + rtt * 0.5);

    net.latencyMs = net.latencyMs == null
        ? rtt
        : Math.round(net.latencyMs * 0.7 + rtt * 0.3);
    net.serverClockOffsetMs = net.serverClockOffsetMs === 0
        ? offset
        : net.serverClockOffsetMs * 0.7 + offset * 0.3;
}

export function estimateServerTime(net, clientTime = Date.now()) {
    return clientTime + (net.serverClockOffsetMs || 0);
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

    const fromTime = player.prevSnapshotServerTimeMs || 0;
    const toTime = player.targetSnapshotServerTimeMs || 0;
    const span = toTime - fromTime;
    if (span <= 0 || !Number.isFinite(renderServerTimeMs)) {
        copyVec3(sample.pos, player.targetPos || player.pos);
        sample.yaw = player.targetYaw ?? player.yaw;
        sample.pitch = player.targetPitch ?? player.pitch;
        sample.crouching = player.targetCrouching ?? player.crouching;
        return sample;
    }

    const t = clamp01((renderServerTimeMs - fromTime) / span);
    lerpVec3Into(sample.pos, player.prevPos, player.targetPos, t);
    sample.yaw = lerpAngle(player.prevYaw ?? player.yaw, player.targetYaw ?? player.yaw, t);
    sample.pitch = lerp(player.prevPitch ?? player.pitch, player.targetPitch ?? player.pitch, t);
    sample.crouching = t >= 0.5 ? !!player.targetCrouching : !!player.prevCrouching;
    return sample;
}

function applyTransformState(target, nextPos, nextYaw, nextPitch, nextCrouching, serverTimeMs) {
    target.pos = cloneVec3(nextPos);
    target.yaw = nextYaw;
    target.pitch = nextPitch;

    if (typeof serverTimeMs !== 'number' || !Number.isFinite(serverTimeMs)) {
        syncRemoteSnapshotTarget(target, target.pos, target.yaw, target.pitch, nextCrouching, 0);
        return;
    }

    const hasTimedSnapshot = target.targetSnapshotServerTimeMs > 0;
    if (!hasTimedSnapshot || serverTimeMs <= target.targetSnapshotServerTimeMs) {
        syncRemoteSnapshotTarget(target, target.pos, target.yaw, target.pitch, nextCrouching, serverTimeMs);
        return;
    }

    target.prevPos = cloneVec3(target.targetPos || target.pos);
    target.prevYaw = target.targetYaw ?? target.yaw;
    target.prevPitch = target.targetPitch ?? target.pitch;
    target.prevCrouching = target.targetCrouching ?? target.crouching;
    target.prevSnapshotServerTimeMs = target.targetSnapshotServerTimeMs;
    target.targetPos = cloneVec3(target.pos);
    target.targetYaw = target.yaw;
    target.targetPitch = target.pitch;
    target.targetCrouching = !!nextCrouching;
    target.targetSnapshotServerTimeMs = serverTimeMs;
}

function syncRemoteSnapshotTarget(target, pos, yaw, pitch, crouching, serverTimeMs) {
    target.prevPos = cloneVec3(pos);
    target.targetPos = cloneVec3(pos);
    target.prevYaw = yaw;
    target.targetYaw = yaw;
    target.prevPitch = pitch;
    target.targetPitch = pitch;
    target.prevCrouching = !!crouching;
    target.targetCrouching = !!crouching;
    target.prevSnapshotServerTimeMs = serverTimeMs;
    target.targetSnapshotServerTimeMs = serverTimeMs;
}

function cloneVec3(vec) {
    return [vec[0] ?? 0, vec[1] ?? 0, vec[2] ?? 0];
}

function copyVec3(target, source) {
    target[0] = source?.[0] ?? 0;
    target[1] = source?.[1] ?? 0;
    target[2] = source?.[2] ?? 0;
}

function lerpVec3Into(target, from, to, t) {
    target[0] = lerp(from?.[0] ?? 0, to?.[0] ?? 0, t);
    target[1] = lerp(from?.[1] ?? 0, to?.[1] ?? 0, t);
    target[2] = lerp(from?.[2] ?? 0, to?.[2] ?? 0, t);
}

function lerp(from, to, t) {
    return from + (to - from) * t;
}

function lerpAngle(from, to, t) {
    const delta = normalizeAngle(to - from);
    return from + delta * t;
}

function normalizeAngle(angle) {
    let normalized = angle;
    while (normalized > Math.PI) normalized -= Math.PI * 2;
    while (normalized < -Math.PI) normalized += Math.PI * 2;
    return normalized;
}

function clamp01(value) {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function syncSnapshotClock(net, serverTimeMs, receivedAt = Date.now()) {
    if (typeof serverTimeMs !== 'number' || !Number.isFinite(serverTimeMs)) {
        return;
    }

    const offset = serverTimeMs - receivedAt;
    net.serverClockOffsetMs = net.serverClockOffsetMs === 0
        ? offset
        : net.serverClockOffsetMs * 0.85 + offset * 0.15;
}
