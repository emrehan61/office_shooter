import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyPong,
    createNet,
    connect,
    estimateServerTime,
    sampleRemotePlayer,
    sendBuy,
    sendChat,
    sendInput,
    sendLeaveMatch,
    sendMode,
    sendReload,
    sendRejoin,
    sendShoot,
    sendSwitchWeapon,
    sendTeam,
    sendThrow,
} from './net.js';

class FakeWebSocket {
    static instances = [];

    constructor(url) {
        this.url = url;
        this.sent = [];
        this.readyState = FakeWebSocket.CONNECTING;
        FakeWebSocket.instances.push(this);
    }

    send(data) {
        if (data instanceof ArrayBuffer) {
            this.sent.push(data);
        } else {
            this.sent.push(JSON.parse(data));
        }
    }

    open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
    }

    emit(msg) {
        this.onmessage?.({ data: JSON.stringify(msg) });
    }

    close(event = { code: 1000 }) {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(event);
    }
}

FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSED = 3;

function installFakeWebSocket() {
    FakeWebSocket.instances.length = 0;
    const previous = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket;
    return () => {
        globalThis.WebSocket = previous;
    };
}

async function connectClient() {
    const net = createNet();
    const connected = connect(net, 'ws://example.test/ws', 'Host');
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.emit({
        t: 'welcome',
        id: 1,
        pos: [0, 1.7, 0],
        state: 'playing',
        match: { mode: 'team', currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 10000, buyPhase: true },
    });
    await connected;
    return { net, ws };
}

test('connect keeps lobby players keyed by id after lobby snapshots', async () => {
    const restore = installFakeWebSocket();
    try {
        const { net, ws } = await connectClient();
        ws.emit({ t: 'lobby', players: [{ id: 1, name: 'Host' }], match: { currentRound: 0, totalRounds: 30, roundTimeLeftMs: 0, buyTimeLeftMs: 0, buyPhase: false } });

        assert.deepEqual(Object.keys(net.players), ['1']);
        assert.equal(net.players['1'].name, 'Host');
    } finally {
        restore();
    }
});

test('state snapshots refresh slot weapons, ammo, and scoreboard fields', async () => {
    const restore = installFakeWebSocket();
    try {
        const { net, ws } = await connectClient();
        ws.emit({
            t: 'state',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 294000, buyTimeLeftMs: 4000, buyPhase: true },
            players: {
                1: {
                    pos: [0, 1.7, 0],
                    yaw: 0,
                    pitch: 0,
                    hp: 100,
                    armor: 15,
                    credits: 420,
                    pistolWeapon: 'usp-s',
                    pistolClip: 7,
                    pistolReserve: 14,
                    heavyWeapon: 'm4a4',
                    heavyClip: 30,
                    heavyReserve: 60,
                    activeWeapon: 'usp-s',
                    kills: 3,
                    deaths: 1,
                },
                2: {
                    pos: [5, 1.7, 5],
                    yaw: 0,
                    pitch: 0,
                    hp: 80,
                    armor: 25,
                    credits: 610,
                    pistolWeapon: 'glock-18',
                    pistolClip: 20,
                    pistolReserve: 80,
                    heavyWeapon: 'ak-47',
                    heavyClip: 30,
                    heavyReserve: 50,
                    activeWeapon: 'ak-47',
                    kills: 5,
                    deaths: 4,
                },
            },
        });

        assert.equal(net.players['1'].kills, 3);
        assert.equal(net.players['1'].pistolWeapon, 'usp-s');
        assert.equal(net.players['1'].heavyWeapon, 'm4a4');
        assert.equal(net.players['2'].heavyClip, 30);
        assert.equal(net.players['2'].heavyReserve, 50);
        assert.equal(net.players['2'].activeWeapon, 'ak-47');
        assert.equal(net.match.buyPhase, true);
    } finally {
        restore();
    }
});

test('match snapshots retain health restore point cooldown state', async () => {
    const restore = installFakeWebSocket();
    try {
        const { net, ws } = await connectClient();
        ws.emit({
            t: 'state',
            match: {
                mode: 'deathmatch',
                currentRound: 1,
                totalRounds: 1,
                roundTimeLeftMs: 1000,
                buyTimeLeftMs: 0,
                buyPhase: false,
                healthRestorePoints: [
                    { x: 10, z: -4, radius: 1.5, healAmount: 35, cooldownSec: 12, cooldownTimeLeftMs: 8000, active: false },
                ],
            },
            players: {
                1: { pos: [0, 1.7, 0], yaw: 0, pitch: 0, hp: 100 },
            },
        });

        assert.equal(net.match.healthRestorePoints.length, 1);
        assert.deepEqual(net.match.healthRestorePoints[0], {
            x: 10,
            z: -4,
            radius: 1.5,
            healAmount: 35,
            cooldownSec: 12,
            cooldownTimeLeftMs: 8000,
            active: false,
        });
    } finally {
        restore();
    }
});

test('connection closes before welcome and clears session state', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const result = Promise.race([
            connect(net, 'ws://example.test/ws', 'Host').then(
                () => 'resolved',
                () => 'rejected'
            ),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 50)),
        ]);

        const ws = FakeWebSocket.instances[0];
        ws.open();
        ws.close({ code: 1006 });

        assert.equal(await result, 'rejected');
        assert.equal(net.connected, false);
        assert.equal(net.ws, null);
        assert.deepEqual(net.players, {});
    } finally {
        restore();
    }
});

test('welcome marks the client as playing when the match is already active', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(net, 'ws://example.test/ws', 'Guest');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({
            t: 'welcome',
            id: 2,
            pos: [5, 1.7, 5],
            state: 'playing',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 10000, buyPhase: true },
        });
        await connected;

        assert.equal(net.gameStarted, true);
        assert.equal(net.match.currentRound, 1);
    } finally {
        restore();
    }
});

test('welcome and lobby messages retain the selected game mode', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(net, 'ws://example.test/ws', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({
            t: 'welcome',
            id: 1,
            pos: [0, 1.7, 0],
            match: { mode: 'deathmatch', currentRound: 0, totalRounds: 0, roundTimeLeftMs: 0, buyTimeLeftMs: 0, buyPhase: false },
        });
        await connected;

        assert.equal(net.match.mode, 'deathmatch');

        ws.emit({
            t: 'lobby',
            players: [{ id: 1, name: 'Host' }],
            state: 'waiting',
            match: { mode: 'team', currentRound: 0, totalRounds: 0, roundTimeLeftMs: 0, buyTimeLeftMs: 0, buyPhase: false },
        });

        assert.equal(net.match.mode, 'team');
    } finally {
        restore();
    }
});

test('connect stores selected lobby metadata for the active session', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(
            net,
            'ws://example.test/ws?lobby=lobby-2',
            'Host',
            { id: 'lobby-2', name: 'Office', private: false }
        );
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({
            t: 'welcome',
            id: 1,
            pos: [0, 1.7, 0],
            match: { currentRound: 0, totalRounds: 0, roundTimeLeftMs: 0, buyTimeLeftMs: 0, buyPhase: false },
        });
        await connected;

        assert.deepEqual(net.lobby, { id: 'lobby-2', name: 'Office', private: false });
    } finally {
        restore();
    }
});

test('kill and economy messages update the local player state', async () => {
    const restore = installFakeWebSocket();
    try {
        const { net, ws } = await connectClient();
        ws.emit({
            t: 'state',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 299000, buyTimeLeftMs: 9000, buyPhase: true },
            players: {
                1: { pos: [0, 1.7, 0], hp: 100, kills: 0, deaths: 0, inMatch: true, pistolWeapon: 'usp-s', activeWeapon: 'usp-s' },
                2: { pos: [5, 1.7, 5], hp: 100, kills: 0, deaths: 0, inMatch: true, name: 'Target' },
            },
        });
        ws.emit({ t: 'kill', killer: 1, victim: 2 });
        ws.emit({
            t: 'economy',
            id: 1,
            credits: 2100,
            pistolWeapon: 'usp-s',
            heavyWeapon: 'm4a4',
            heavyClip: 30,
            heavyReserve: 90,
            activeWeapon: 'm4a4',
            reloading: true,
            reloadTimeLeftMs: 1700,
        });

        assert.equal(net.players['1'].kills, 1);
        assert.equal(net.players['2'].deaths, 1);
        assert.equal(net.players['1'].credits, 2100);
        assert.equal(net.players['1'].heavyWeapon, 'm4a4');
        assert.equal(net.players['1'].reloading, true);
    } finally {
        restore();
    }
});

test('remote players can be sampled smoothly between server-timed snapshots', async () => {
    const restore = installFakeWebSocket();
    try {
        const { net, ws } = await connectClient();
        ws.emit({
            t: 'state',
            serverTime: 1000,
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 299000, buyTimeLeftMs: 9000, buyPhase: true },
            players: {
                2: { pos: [0, 1.7, 0], yaw: 0, pitch: 0.1, hp: 100, armor: 0, activeWeapon: 'knife' },
            },
        });
        ws.emit({
            t: 'state',
            serverTime: 1100,
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 298900, buyTimeLeftMs: 8900, buyPhase: true },
            players: {
                2: { pos: [10, 1.2, -4], yaw: Math.PI, pitch: -0.3, crouching: true, hp: 100, armor: 0, activeWeapon: 'knife' },
            },
        });

        const sampled = sampleRemotePlayer(net.players['2'], 1050);

        assert.ok(sampled);
        assert.equal(sampled.crouching, true);
        assert.ok(Math.abs(sampled.pos[0] - 5) < 1e-9);
        assert.ok(Math.abs(sampled.pos[1] - 1.45) < 1e-9);
        assert.ok(Math.abs(sampled.pos[2] + 2) < 1e-9);
    } finally {
        restore();
    }
});

test('action requests send the current item ids and flags', async () => {
    const restore = installFakeWebSocket();
    try {
        const { net, ws } = await connectClient();

        sendBuy(net, 'm4a4');
        sendReload(net);
        sendSwitchWeapon(net, 'usp-s');
        sendThrow(net, [0, 0.25, -1], 'flashbang');
        sendTeam(net, 'blue');
        sendMode(net, 'deathmatch');
        sendRejoin(net, true);
        sendChat(net, 'hello');
        sendInput(net, { seq: 1, forward: true, backward: false, left: false, right: false, jump: false, crouch: true, aiming: false, yaw: 0.2, pitch: -0.1 });
        sendShoot(net, [0, 0, -1], 'awp', true, false);

        const actions = ws.sent.slice(1);

        // Binary messages: buy, reload, switch, throw
        assert.ok(actions[0] instanceof ArrayBuffer, 'buy should be binary');
        assert.ok(actions[1] instanceof ArrayBuffer, 'reload should be binary');
        assert.ok(actions[2] instanceof ArrayBuffer, 'switch should be binary');
        assert.ok(actions[3] instanceof ArrayBuffer, 'throw should be binary');
        // JSON messages: team, mode, rejoin, chat
        assert.deepEqual(actions[4], { t: 'team', team: 'blue' });
        assert.deepEqual(actions[5], { t: 'mode', mode: 'deathmatch' });
        assert.deepEqual(actions[6], { t: 'rejoin', yes: true });
        assert.deepEqual(actions[7], { t: 'chat', text: 'hello' });
        // Binary messages: input, shoot
        assert.ok(actions[8] instanceof ArrayBuffer, 'input should be binary');
        assert.ok(actions[9] instanceof ArrayBuffer, 'shoot should be binary');
    } finally {
        restore();
    }
});

test('state snapshots include projectiles and reload timer state', async () => {
    const restore = installFakeWebSocket();
    try {
        const { net, ws } = await connectClient();
        ws.emit({
            t: 'state',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 299000, buyTimeLeftMs: 9000, buyPhase: true },
            projectiles: [{ id: 3, type: 'flashbang', pos: [1, 2, 3] }],
            effects: [{ type: 'smoke', pos: [4, 1, 5], radius: 9, timeLeftMs: 6000 }],
            players: {
                1: {
                    hp: 100,
                    armor: 0,
                    credits: 3000,
                    activeWeapon: 'ak-47',
                    heavyWeapon: 'ak-47',
                    heavyClip: 5,
                    heavyReserve: 25,
                    reloading: true,
                    reloadTimeLeftMs: 2400,
                    flashTimeLeftMs: 1800,
                },
            },
        });

        assert.deepEqual(net.projectiles, [{ id: 3, type: 'flashbang', pos: [1, 2, 3] }]);
        assert.deepEqual(net.effects, [{ type: 'smoke', pos: [4, 1, 5], radius: 9, timeLeftMs: 6000 }]);
        assert.equal(net.players['1'].reloading, true);
        assert.equal(net.players['1'].reloadTimeLeftMs, 2400);
    } finally {
        restore();
    }
});

test('leave-match requests send the expected websocket payload', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(net, 'ws://example.test/ws?lobby=lobby-2', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], state: 'playing', match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 0, buyPhase: false } });
        await connected;

        sendLeaveMatch(net);

        assert.deepEqual(ws.sent[ws.sent.length - 1], { t: 'leaveMatch' });
    } finally {
        restore();
    }
});

test('pong samples update round-trip latency and server clock estimate', () => {
    const net = createNet();
    applyPong(net, { clientTime: 1000, serverTime: 1012 }, 1040);

    assert.equal(net.latencyMs, 40);
    assert.equal(estimateServerTime(net, 1100), 1092);
});
