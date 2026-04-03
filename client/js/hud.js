export function createHUD() {
    return {
        crosshair: document.getElementById('crosshair'),
        healthEl: document.getElementById('health'),
        ammoEl: document.getElementById('ammo'),
        pingEl: document.getElementById('ping'),
        killFeed: document.getElementById('killfeed'),
        damageFlash: document.getElementById('damage-flash'),
        overlay: document.getElementById('overlay'),
        deathScreen: document.getElementById('death-screen'),
        respawnTimer: document.getElementById('respawn-timer'),
        leaderboard: document.getElementById('leaderboard'),
        leaderboardBody: document.getElementById('leaderboard-body'),
    };
}

export function updateHUD(hud, player, leaderboard, network = {}) {
    if (hud.healthEl) hud.healthEl.textContent = player.hp;
    if (hud.ammoEl) hud.ammoEl.textContent = player.ammo;
    if (hud.pingEl) hud.pingEl.textContent = formatPing(network.latencyMs);

    if (!player.alive) {
        if (hud.deathScreen) hud.deathScreen.style.display = 'flex';
        if (hud.respawnTimer) hud.respawnTimer.textContent = Math.ceil(player.respawnTimer);
        if (hud.crosshair) hud.crosshair.style.display = 'none';
    } else {
        if (hud.deathScreen) hud.deathScreen.style.display = 'none';
        if (hud.crosshair) hud.crosshair.style.display = 'block';
    }

    updateLeaderboard(hud, leaderboard);
}

export function addKill(hud, killer, victim) {
    const el = document.createElement('div');
    el.className = 'kill-entry';
    el.textContent = `${killer} \u2192 ${victim}`;
    if (hud.killFeed) {
        hud.killFeed.prepend(el);
        // Keep only last 5
        while (hud.killFeed.children.length > 5) {
            hud.killFeed.removeChild(hud.killFeed.lastChild);
        }
        // Auto-remove after 5s
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
    }
}

export function showHitMarker(hud) {
    if (!hud.crosshair) return;
    hud.crosshair.classList.add('hit');
    setTimeout(() => hud.crosshair.classList.remove('hit'), 150);
}

export function showDamageFlash(hud, zone) {
    if (!hud.damageFlash) return;
    hud.damageFlash.classList.remove('active', 'headshot');
    void hud.damageFlash.offsetWidth;
    hud.damageFlash.classList.add('active');
    if (zone === 'head') {
        hud.damageFlash.classList.add('headshot');
    }
}

export function formatPing(latencyMs) {
    return latencyMs == null ? 'PING -- ms' : `PING ${Math.round(latencyMs)} ms`;
}

export function buildLeaderboardRows(players, myId) {
    return Object.entries(players || {})
        .map(([id, player]) => ({
            id: Number(id),
            name: player.name || `Player ${id}`,
            kills: player.kills || 0,
            deaths: player.deaths || 0,
            isSelf: Number(id) === myId,
        }))
        .sort((a, b) => {
            if (b.kills !== a.kills) return b.kills - a.kills;
            if (a.deaths !== b.deaths) return a.deaths - b.deaths;
            if (a.name !== b.name) return a.name.localeCompare(b.name);
            return a.id - b.id;
        });
}

function updateLeaderboard(hud, leaderboard) {
    if (!hud.leaderboard) return;

    const visible = !!leaderboard?.visible;
    if (!visible) {
        hud.leaderboard.style.display = 'none';
        return;
    }

    const rows = buildLeaderboardRows(leaderboard.players, leaderboard.myId);
    if (rows.length === 0) {
        hud.leaderboard.style.display = 'none';
        return;
    }

    hud.leaderboard.style.display = 'block';
    if (!hud.leaderboardBody || typeof document === 'undefined') return;

    hud.leaderboardBody.replaceChildren();

    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const tr = document.createElement('tr');
        if (row.isSelf) {
            tr.className = 'is-self';
        }

        const rank = document.createElement('td');
        rank.textContent = String(i + 1);
        const name = document.createElement('td');
        name.textContent = row.isSelf ? `${row.name} (You)` : row.name;
        const kills = document.createElement('td');
        kills.textContent = String(row.kills);
        const deaths = document.createElement('td');
        deaths.textContent = String(row.deaths);

        tr.append(rank, name, kills, deaths);
        hud.leaderboardBody.appendChild(tr);
    }
}
