export const MODE_TEAM = 'team';
export const MODE_DEATHMATCH = 'deathmatch';

export function normalizeMode(mode) {
    return mode === MODE_DEATHMATCH ? MODE_DEATHMATCH : MODE_TEAM;
}

export function getModeLabel(mode) {
    return normalizeMode(mode) === MODE_DEATHMATCH ? 'Deathmatch' : 'Team';
}

export function getDeathmatchStartState(players = {}) {
    const humanCount = Object.values(players).filter((player) => !player?.isBot).length;
    if (humanCount < 1) {
        return { ok: false, reason: 'Need at least 1 player' };
    }
    return { ok: true, reason: '' };
}
