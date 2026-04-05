import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHttpURL, buildWebSocketURL, getDefaultServerAddress, normalizeServerAddress } from './config.js';

test('uses the current page host when it already includes a port', () => {
    assert.equal(
        getDefaultServerAddress({ host: '10.10.100.231:8090', hostname: '10.10.100.231', port: '8090' }),
        '10.10.100.231:8090'
    );
});

test('falls back to localhost when browser hostname is 0.0.0.0', () => {
    assert.equal(
        getDefaultServerAddress({ host: '0.0.0.0:8080', hostname: '0.0.0.0', port: '8080' }),
        'localhost:8080'
    );
});

test('normalizes explicit HTTP and WS server inputs down to host and port', () => {
    assert.equal(
        normalizeServerAddress('http://10.10.100.231:8090/ws'),
        '10.10.100.231:8090'
    );
    assert.equal(
        normalizeServerAddress('ws://localhost:8080'),
        'localhost:8080'
    );
});

test('builds websocket URLs from either raw hosts or full browser URLs', () => {
    assert.equal(
        buildWebSocketURL('localhost:8090', { protocol: 'http:' }),
        'ws://localhost:8090/ws'
    );
    assert.equal(
        buildWebSocketURL('https://office.test:9443', { protocol: 'https:' }),
        'wss://office.test:9443/ws'
    );
});

test('builds websocket URLs with a selected lobby id', () => {
    assert.equal(
        buildWebSocketURL('localhost:8090', { protocol: 'http:' }, 'lobby-2'),
        'ws://localhost:8090/ws?lobby=lobby-2'
    );
});

test('builds HTTP URLs from raw hosts or full browser URLs', () => {
    assert.equal(
        buildHttpURL('localhost:8090', '/api/lobbies', { protocol: 'http:' }),
        'http://localhost:8090/api/lobbies'
    );
    assert.equal(
        buildHttpURL('https://office.test:9443', '/api/lobbies/join-key', { protocol: 'https:' }),
        'https://office.test:9443/api/lobbies/join-key'
    );
});
