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

export function buildWebSocketURL(server = '', locationLike = {}) {
    const trimmed = String(server || '').trim();
    const parsed = trimmed ? parseServerAddress(trimmed) : null;
    const host = parsed?.host || getDefaultServerAddress(locationLike);
    const protocol = parsed?.protocol
        ? websocketProtocolFor(parsed.protocol)
        : (locationLike.protocol === 'https:' ? 'wss:' : 'ws:');

    return `${protocol}//${host}/ws`;
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
