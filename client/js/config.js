export function getDefaultServerAddress(locationLike = {}) {
    const port = locationLike.port || '8080';
    if (locationLike.host && !locationLike.host.startsWith('0.0.0.0')) {
        return locationLike.host;
    }

    const hostname = locationLike.hostname && locationLike.hostname !== '0.0.0.0'
        ? locationLike.hostname
        : 'localhost';
    return `${hostname}:${port}`;
}

export function normalizeServerAddress(server = '', locationLike = {}) {
    const trimmed = String(server || '').trim();
    if (!trimmed) {
        return getDefaultServerAddress(locationLike);
    }

    const parsed = parseServerAddress(trimmed);
    if (!parsed?.host) {
        return getDefaultServerAddress(locationLike);
    }

    return parsed.host;
}

export function buildHttpURL(server = '', path = '/', locationLike = {}) {
    return buildURL(server, path, locationLike, false);
}

function buildURL(server = '', path = '/', locationLike = {}, websocket = false, lobbyId = '') {
    const trimmed = String(server || '').trim();
    const parsed = trimmed ? parseServerAddress(trimmed) : null;
    const host = parsed?.host || getDefaultServerAddress(locationLike);
    const protocol = parsed?.protocol
        ? (websocket ? websocketProtocolFor(parsed.protocol) : httpProtocolFor(parsed.protocol))
        : defaultProtocol(locationLike, websocket);
    const basePath = String(path || '/');
    const query = websocket && lobbyId
        ? `?lobby=${encodeURIComponent(lobbyId)}`
        : '';

    return `${protocol}//${host}${basePath}${query}`;
}

export function buildWebSocketURL(server = '', locationLike = {}, lobbyId = '') {
    return buildURL(server, '/ws', locationLike, true, lobbyId);
}

function parseServerAddress(value) {
    try {
        const url = new URL(value.includes('://') ? value : `http://${value}`);
        return {
            protocol: url.protocol,
            host: url.host,
        };
    } catch {
        return null;
    }
}

function websocketProtocolFor(protocol) {
    if (protocol === 'https:' || protocol === 'wss:') {
        return 'wss:';
    }
    return 'ws:';
}

function httpProtocolFor(protocol) {
    if (protocol === 'wss:' || protocol === 'https:') {
        return 'https:';
    }
    return 'http:';
}

function defaultProtocol(locationLike, websocket) {
    const secure = locationLike.protocol === 'https:';
    if (websocket) {
        return secure ? 'wss:' : 'ws:';
    }
    return secure ? 'https:' : 'http:';
}
