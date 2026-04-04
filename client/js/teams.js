export const TEAM_NONE = '';
export const TEAM_BLUE = 'blue';
export const TEAM_GREEN = 'green';

export const TEAM_LABELS = {
    [TEAM_NONE]: 'Unassigned',
    [TEAM_BLUE]: 'Blue',
    [TEAM_GREEN]: 'Green',
};

export function normalizeTeam(team) {
    if (team === TEAM_BLUE || team === TEAM_GREEN) {
        return team;
    }
    return TEAM_NONE;
}

export function getTeamLabel(team) {
    return TEAM_LABELS[normalizeTeam(team)] || TEAM_LABELS[TEAM_NONE];
}

export function isAssignedTeam(team) {
    return normalizeTeam(team) !== TEAM_NONE;
}

export function getTeamCounts(players = {}) {
    let blue = 0;
    let green = 0;
    let unassigned = 0;

    for (const player of Object.values(players)) {
        const team = normalizeTeam(player?.team);
        if (team === TEAM_BLUE) {
            blue += 1;
        } else if (team === TEAM_GREEN) {
            green += 1;
        } else {
            unassigned += 1;
        }
    }

    return { blue, green, unassigned };
}

export function canSelectTeam(players, myId, nextTeam) {
    const desired = normalizeTeam(nextTeam);
    if (!isAssignedTeam(desired)) {
        return false;
    }

    const counts = getTeamCounts(players);
    const self = players?.[String(myId)];
    const current = normalizeTeam(self?.team);

    if (current === desired) {
        return true;
    }

    if (current === TEAM_BLUE) counts.blue -= 1;
    if (current === TEAM_GREEN) counts.green -= 1;

    if (desired === TEAM_BLUE) counts.blue += 1;
    if (desired === TEAM_GREEN) counts.green += 1;

    return Math.abs(counts.blue - counts.green) <= 1;
}

export function getTeamStartState(players) {
    const counts = getTeamCounts(players);
    const totalPlayers = Object.keys(players || {}).length;

    if (totalPlayers < 2) {
        return { ok: false, reason: 'Need at least 2 players' };
    }
    if (counts.unassigned > 0) {
        return { ok: false, reason: 'All players must join a team' };
    }
    if (counts.blue === 0 || counts.green === 0) {
        return { ok: false, reason: 'Both teams need players' };
    }
    if (Math.abs(counts.blue - counts.green) > 1) {
        return { ok: false, reason: 'Teams must stay within one player' };
    }
    return { ok: true, reason: '' };
}
