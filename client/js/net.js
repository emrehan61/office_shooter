export function createNet() {
    return {
        ws: null,
        myId: null,
        players: {},   // id -> {pos, yaw, pitch, hp, name, alive, shotTime, kills, deaths}
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
            // Ignore close races from stale sockets.
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
            const self = ensurePlayer(net, msg.id);
            if (msg.pos) self.pos = msg.pos;
            self.alive = true;
            break;
        }

        case 'lobby': {
            const ids = new Set();
            for (const entry of msg.players || []) {
                const player = ensurePlayer(net, entry.id);
                const key = normalizeId(entry.id);
                ids.add(key);
                player.name = entry.name;
                player.kills = entry.kills ?? player.kills;
                player.deaths = entry.deaths ?? player.deaths;
            }

            for (const id of Object.keys(net.players)) {
                if (!ids.has(id)) {
                    delete net.players[id];
                }
            }

            applyGameState(net, msg.state);
            if (net.onLobby) net.onLobby(msg);
            break;
        }

        case 'start':
            net.gameStarted = true;
            break;

        case 'state': {
            const ps = msg.players || {};
            for (const id in ps) {
                const p = ps[id];
                const target = ensurePlayer(net, id);
                target.kills = p.kills ?? target.kills;
                target.deaths = p.deaths ?? target.deaths;
                target.name = p.name ?? target.name;
                target.hp = p.hp ?? target.hp;
                target.alive = (p.hp ?? target.hp) > 0;

                if (Number(id) === net.myId) continue;

                target.pos = p.pos;
                target.yaw = p.yaw;
                target.pitch = p.pitch;
            }
            break;
        }

        case 'hit':
            if (net.onHit) net.onHit(msg);
            break;

        case 'kill':
            if (net.onKill) net.onKill(msg);
            break;

        case 'respawn':
            if (msg.id == net.myId) {
                if (net.onRespawn) net.onRespawn(msg);
            } else {
                const target = ensurePlayer(net, msg.id);
                target.pos = msg.pos;
                target.hp = 100;
                target.alive = true;
            }
            break;

        case 'shot': {
            const target = ensurePlayer(net, msg.id);
            target.shotTime = 0.12;
            if (net.onShot) net.onShot(msg);
            break;
        }

        case 'pong':
            applyPong(net, msg);
            break;

        case 'leave':
            delete net.players[normalizeId(msg.id)];
            break;
    }
}

export function sendInput(net, pos, yaw, pitch) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({
        t: 'input',
        pos: [pos[0], pos[1], pos[2]],
        yaw,
        pitch,
    }));
}

export function sendShoot(net, dir) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({
        t: 'shoot',
        dir: [dir[0], dir[1], dir[2]],
        shotTime: Math.round(estimateServerTime(net, Date.now())),
    }));
}

export function sendStart(net) {
    if (!canSend(net)) return;
    net.ws.send(JSON.stringify({ t: 'start' }));
}

function ensurePlayer(net, id) {
    const key = normalizeId(id);
    if (!net.players[key]) {
        net.players[key] = {
            pos: [0, 1.7, 0],
            yaw: 0,
            pitch: 0,
            hp: 100,
            name: '???',
            alive: true,
            shotTime: 0,
            kills: 0,
            deaths: 0,
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

function applyGameState(net, state) {
    if (state === 'playing') {
        net.gameStarted = true;
    } else if (state === 'waiting') {
        net.gameStarted = false;
    }
}

function resetSession(net) {
    stopHeartbeat(net);
    net.ws = null;
    net.myId = null;
    net.players = {};
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
