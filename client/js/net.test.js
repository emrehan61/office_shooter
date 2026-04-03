import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPong, createNet, connect, estimateServerTime } from './net.js';

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

        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0] });
        await connected;
        ws.emit({ t: 'lobby', players: [{ id: 1, name: 'Host' }] });

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
        ws.emit({ t: 'welcome', id: 2, pos: [5, 1.7, 5], state: 'playing' });
        await connected;

        assert.equal(net.gameStarted, true);
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
        ws.emit({ t: 'welcome', id: 1, pos: [0, 1.7, 0], state: 'playing' });
        await connected;
        ws.emit({
            t: 'state',
            players: {
                1: { pos: [0, 1.7, 0], yaw: 0, pitch: 0, hp: 100, kills: 3, deaths: 1 },
                2: { pos: [5, 1.7, 5], yaw: 0, pitch: 0, hp: 80, kills: 5, deaths: 4 },
            },
        });

        assert.equal(net.players['1'].kills, 3);
        assert.equal(net.players['1'].deaths, 1);
        assert.equal(net.players['2'].kills, 5);
        assert.equal(net.players['2'].deaths, 4);
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
