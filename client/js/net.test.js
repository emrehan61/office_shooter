import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPong, createNet, connect, estimateServerTime, sampleRemotePlayer, sendBuy, sendChat, sendInput, sendLeaveMatch, sendMode, sendReload, sendRejoin, sendShoot, sendSwitchWeapon, sendTeam, sendThrow } from './net.js';
import { applyAuthoritativeState, createPlayer } from './player.js';

class FakeWebSocket {
    static instances = [];

    constructor(url) {
        this.url = url;
        this.sent = [];
        this.readyState = FakeWebSocket.CONNECTING;
        FakeWebSocket.instances.push(this);
    }

    send(data) {
        this.sent.push(JSON.parse(data));
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

    fail(event = new Error('socket error')) {
        this.onerror?.(event);
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

test('connect keeps lobby players keyed by id after lobby snapshots', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(net, 'ws://example.test/ws', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        assert.deepEqual(ws.sent[0], { t: 'name', name: 'Host' });

        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], match: { currentRound: 0, totalRounds: 30, roundTimeLeftMs: 0, buyTimeLeftMs: 0, buyPhase: false } });
        await connected;
        ws.emit({ t: 'lobby', players: [{ id: 1, name: 'Host' }], match: { currentRound: 0, totalRounds: 30, roundTimeLeftMs: 0, buyTimeLeftMs: 0, buyPhase: false } });

        assert.deepEqual(Object.keys(net.players), ['1']);
        assert.equal(net.players['1'].name, 'Host');
    } finally {
        restore();
    }
});

test('connect rejects and clears session when the socket closes before welcome', async () => {
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
        ws.emit({ t: 'welcome', id: 2, pos: [5, 1.7, 5], state: 'playing', match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 10000, buyPhase: true } });
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
        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], match: { currentRound: 0, totalRounds: 0, roundTimeLeftMs: 0, buyTimeLeftMs: 0, buyPhase: false } });
        await connected;

        assert.deepEqual(net.lobby, { id: 'lobby-2', name: 'Office', private: false });
    } finally {
        restore();
    }
});

test('state snapshots refresh kills and deaths for the leaderboard', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(net, 'ws://example.test/ws', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], state: 'playing', match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 10000, buyPhase: true } });
        await connected;
        ws.emit({
            t: 'state',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 294000, buyTimeLeftMs: 4000, buyPhase: true },
            players: {
                1: { pos: [0, 1.7, 0], yaw: 0, pitch: 0, hp: 100, armor: 15, credits: 420, hasPistol: true, pistolClip: 7, pistolReserve: 14, activeWeapon: 'pistol', kills: 3, deaths: 1 },
                2: { pos: [5, 1.7, 5], yaw: 0, pitch: 0, hp: 80, armor: 25, credits: 610, hasMachineGun: true, machineGunClip: 30, machineGunReserve: 50, activeWeapon: 'machinegun', kills: 5, deaths: 4 },
            },
        });

        assert.equal(net.players['1'].kills, 3);
        assert.equal(net.players['1'].deaths, 1);
        assert.equal(net.players['1'].armor, 15);
        assert.equal(net.players['1'].pistolClip, 7);
        assert.equal(net.players['1'].pistolReserve, 14);
        assert.equal(net.players['1'].credits, 420);
        assert.equal(net.players['1'].activeWeapon, 'pistol');
        assert.equal(net.players['2'].kills, 5);
        assert.equal(net.players['2'].deaths, 4);
        assert.equal(net.players['2'].armor, 25);
        assert.equal(net.players['2'].machineGunClip, 30);
        assert.equal(net.players['2'].machineGunReserve, 50);
        assert.equal(net.players['2'].credits, 610);
        assert.equal(net.match.buyPhase, true);
    } finally {
        restore();
    }
});

test('kill messages update leaderboard counters immediately', async () => {
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
            state: 'playing',
            match: { mode: 'deathmatch', currentRound: 1, totalRounds: 0, roundTimeLeftMs: 300000, buyTimeLeftMs: 0, buyPhase: false },
        });
        await connected;
        ws.emit({
            t: 'state',
            match: { mode: 'deathmatch', currentRound: 1, totalRounds: 0, roundTimeLeftMs: 299000, buyTimeLeftMs: 0, buyPhase: false },
            players: {
                1: { pos: [0, 1.7, 0], yaw: 0, pitch: 0, hp: 100, kills: 0, deaths: 0, inMatch: true },
                2: { pos: [5, 1.7, 5], yaw: 0, pitch: 0, hp: 100, kills: 0, deaths: 0, inMatch: true, name: 'Target' },
            },
        });

        ws.emit({ t: 'kill', killer: 1, victim: 2 });

        assert.equal(net.players['1'].kills, 1);
        assert.equal(net.players['2'].deaths, 1);
    } finally {
        restore();
    }
});

test('remote players can be sampled smoothly between server-timed snapshots', async () => {
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
            state: 'playing',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 10000, buyPhase: true },
        });
        await connected;

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
        assert.ok(Math.abs(sampled.yaw - Math.PI * 0.5) < 1e-9);
        assert.ok(Math.abs(sampled.pitch + 0.1) < 1e-9);
    } finally {
        restore();
    }
});

test('state snapshots do not overwrite the local player position', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const localPlayer = createPlayer();
        net.onSelfState = (state) => {
            applyAuthoritativeState(localPlayer, state);
        };

        const connected = connect(net, 'ws://example.test/ws', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({
            t: 'welcome',
            id: 1,
            pos: [0, 1.7, 0],
            hp: 100,
            armor: 0,
            credits: 3000,
            activeWeapon: 'knife',
            state: 'playing',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 10000, buyPhase: true },
        });
        await connected;

        localPlayer.pos = [9, 1.7, -4];

        ws.emit({
            t: 'state',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 289000, buyTimeLeftMs: 0, buyPhase: false },
            players: {
                1: { pos: [0, 1.7, 0], yaw: 1.2, pitch: 0.1, hp: 100, armor: 25, credits: 2600, activeWeapon: 'knife', kills: 1, deaths: 0 },
            },
        });

        assert.deepEqual(localPlayer.pos, [9, 1.7, -4]);
        assert.equal(localPlayer.armor, 25);
        assert.equal(localPlayer.credits, 2600);
    } finally {
        restore();
    }
});

test('economy messages update local player state and action requests send ids', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(net, 'ws://example.test/ws', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], hp: 100, armor: 0, credits: 3000, hasPistol: false, hasMachineGun: false, pistolClip: 0, pistolReserve: 0, machineGunClip: 0, machineGunReserve: 0, activeWeapon: 'knife', state: 'playing', match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 10000, buyPhase: true } });
        await connected;

        sendTeam(net, 'blue');
        sendMode(net, 'deathmatch');
        sendSwitchWeapon(net, 'knife');
        sendReload(net);
        sendThrow(net, [0, 0.25, -1], 'bomb');
        sendBuy(net, 'buy-pistol');
        assert.deepEqual(ws.sent[ws.sent.length - 6], { t: 'team', team: 'blue' });
        assert.deepEqual(ws.sent[ws.sent.length - 5], { t: 'mode', mode: 'deathmatch' });
        assert.deepEqual(ws.sent[ws.sent.length - 4], { t: 'switch', weapon: 'knife' });
        assert.deepEqual(ws.sent[ws.sent.length - 3], { t: 'reload' });
        assert.deepEqual(ws.sent[ws.sent.length - 2], { t: 'throw', dir: [0, 0.25, -1], weapon: 'bomb' });
        assert.deepEqual(ws.sent[ws.sent.length - 1], { t: 'buy', item: 'buy-pistol' });

        ws.emit({
            t: 'economy',
            id: 1,
            ok: true,
            kind: 'purchase',
            item: 'buy-pistol',
            team: 'blue',
            credits: 2300,
            armor: 0,
            hp: 100,
            hasPistol: true,
            pistolClip: 7,
            pistolReserve: 21,
            activeWeapon: 'pistol',
        });

        assert.equal(net.players['1'].credits, 2300);
        assert.equal(net.players['1'].team, 'blue');
        assert.equal(net.players['1'].hasPistol, true);
        assert.equal(net.players['1'].pistolClip, 7);
        assert.equal(net.players['1'].pistolReserve, 21);
        assert.equal(net.players['1'].activeWeapon, 'pistol');
    } finally {
        restore();
    }
});

test('chat messages are sent and delivered through the chat callback', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const received = [];
        net.onChat = (msg) => received.push(msg);

        const connected = connect(net, 'ws://example.test/ws', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], state: 'playing', match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 0, buyPhase: false } });
        await connected;

        sendChat(net, 'hello squad');
        assert.deepEqual(ws.sent[ws.sent.length - 1], { t: 'chat', text: 'hello squad' });

        ws.emit({ t: 'chat', id: 2, name: 'Guest', text: 'copy that' });
        assert.deepEqual(received, [{ t: 'chat', id: 2, name: 'Guest', text: 'copy that' }]);
    } finally {
        restore();
    }
});

test('shoot requests include aiming state and alternate attack flags', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(net, 'ws://example.test/ws', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], state: 'playing', match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 0, buyPhase: false } });
        await connected;

        sendShoot(net, [0.1, 0.05, -1], 'machinegun', true);
        const payload = ws.sent[ws.sent.length - 1];

        assert.equal(payload.t, 'shoot');
        assert.deepEqual(payload.dir, [0.1, 0.05, -1]);
        assert.equal(payload.weapon, 'machinegun');
        assert.equal(payload.aiming, true);
        assert.equal(payload.alternate, false);
        assert.equal(typeof payload.shotTime, 'number');

        sendShoot(net, [0, 0, -1], 'knife', false, true);
        const altPayload = ws.sent[ws.sent.length - 1];

        assert.equal(altPayload.weapon, 'knife');
        assert.equal(altPayload.aiming, false);
        assert.equal(altPayload.alternate, true);
        assert.equal(typeof altPayload.shotTime, 'number');
    } finally {
        restore();
    }
});

test('state snapshots include projectiles and reload timer state', async () => {
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
            hp: 100,
            armor: 0,
            credits: 3000,
            activeWeapon: 'knife',
            state: 'playing',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 0, buyPhase: false },
        });
        await connected;

        ws.emit({
            t: 'state',
            match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 299000, buyTimeLeftMs: 0, buyPhase: false },
            projectiles: [{ id: 7, type: 'bomb', pos: [1, 1.2, -3] }],
            effects: [{ type: 'smoke', pos: [2, 0.12, -4], radius: 3.8, timeLeftMs: 6400 }],
            players: {
                1: { hp: 100, armor: 0, credits: 3000, activeWeapon: 'machinegun', hasMachineGun: true, machineGunClip: 5, machineGunReserve: 25, reloading: true, reloadTimeLeftMs: 2400, flashTimeLeftMs: 1800 },
            },
        });

        assert.deepEqual(net.projectiles, [{ id: 7, type: 'bomb', pos: [1, 1.2, -3] }]);
        assert.deepEqual(net.effects, [{ type: 'smoke', pos: [2, 0.12, -4], radius: 3.8, timeLeftMs: 6400 }]);
        assert.equal(net.players['1'].reloading, true);
        assert.equal(net.players['1'].reloadTimeLeftMs, 2400);
        assert.equal(net.players['1'].flashTimeLeftMs, 1800);
    } finally {
        restore();
    }
});

test('input messages include crouch stance', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(net, 'ws://example.test/ws', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], state: 'playing', match: { currentRound: 1, totalRounds: 30, roundTimeLeftMs: 300000, buyTimeLeftMs: 10000, buyPhase: true } });
        await connected;

        sendInput(net, [0, 1.15, 0], 1.2, -0.4, true);

        assert.deepEqual(ws.sent[ws.sent.length - 1], {
            t: 'input',
            pos: [0, 1.15, 0],
            yaw: 1.2,
            pitch: -0.4,
            crouching: true,
        });
    } finally {
        restore();
    }
});

test('rejoin vote requests send the selected answer', async () => {
    const restore = installFakeWebSocket();
    try {
        const net = createNet();
        const connected = connect(net, 'ws://example.test/ws', 'Host');
        const ws = FakeWebSocket.instances[0];

        ws.open();
        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], state: 'waiting', match: { mode: 'deathmatch', deathmatchVoteActive: true, deathmatchVoteTimeLeftMs: 8000 } });
        await connected;

        sendRejoin(net, true);
        sendRejoin(net, false);

        assert.deepEqual(ws.sent[ws.sent.length - 2], { t: 'rejoin', yes: true });
        assert.deepEqual(ws.sent[ws.sent.length - 1], { t: 'rejoin', yes: false });
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

    applyPong(net, { clientTime: 1000, serverTime: 5025 }, 1040);

    assert.equal(net.latencyMs, 40);
    assert.equal(Math.round(estimateServerTime(net, 1100)), 5105);
});
