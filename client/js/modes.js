import { getTeamStartState } from './teams.js';

export const MODE_TEAM = 'team';
export const MODE_DEATHMATCH = 'deathmatch';
export const MODE_HOSTAGE = 'hostage';
export const MODE_CTF = 'ctf';

export function normalizeMode(mode) {
    if (mode === MODE_DEATHMATCH || mode === MODE_HOSTAGE || mode === MODE_CTF) {
        return mode;
    }
    return MODE_TEAM;
}

export function getModeLabel(mode) {
    const m = normalizeMode(mode);
    if (m === MODE_DEATHMATCH) return 'Deathmatch';
    if (m === MODE_HOSTAGE) return 'Hostage Rescue';
    if (m === MODE_CTF) return 'Capture the Flag';
    return 'Team';
}

export function getDeathmatchStartState(players = {}) {
    const humanCount = Object.values(players).filter((player) => !player?.isBot).length;
    if (humanCount < 1) {
        return { ok: false, reason: 'Need at least 1 player' };
    }
    return { ok: true, reason: '' };
}

export function getHostageStartState(players) {
    return getTeamStartState(players);
}

export function getCTFStartState(players) {
    return getTeamStartState(players);
}
