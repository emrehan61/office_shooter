import {
    BUY_MENU_SECTIONS,
    GRENADE_MAX,
    MACHINE_GUN_AMMO_MAX,
    MAX_ARMOR,
    PISTOL_AMMO_MAX,
    SHOP_ITEMS,
    UTILITY_BOMB,
    UTILITY_FLASHBANG,
    UTILITY_SMOKE,
    WEAPON_DEFS,
    WEAPON_KNIFE,
    WEAPON_MACHINE_GUN,
    WEAPON_PISTOL,
    isUtilityWeapon,
} from './economy.js';
import { getUtilityCount, getWeaponAmmoState } from './player.js';
import { TEAM_BLUE, TEAM_GREEN, getTeamLabel, normalizeTeam } from './teams.js';

const LOADOUT_SLOT_DEFS = [
    { id: WEAPON_MACHINE_GUN, key: '1', label: 'Machine Gun', defaultMeta: 'BUY' },
    { id: WEAPON_PISTOL, key: '2', label: 'Pistol', defaultMeta: 'BUY' },
    { id: WEAPON_KNIFE, key: '3', label: 'Knife', defaultMeta: 'ALWAYS' },
    { id: 'utility', key: '4', label: 'Utility', defaultMeta: 'EMPTY' },
];

export function createHUD() {
    const hud = {
        crosshair: document.getElementById('crosshair'),
        healthEl: document.getElementById('health'),
        armorEl: document.getElementById('armor'),
        ammoEl: document.getElementById('ammo'),
        ammoLabelEl: document.getElementById('ammo-label'),
        weaponEl: document.getElementById('weapon-name'),
        creditsEl: document.getElementById('credits'),
        pingEl: document.getElementById('ping'),
        roundEl: document.getElementById('round-label'),
        roundTimerEl: document.getElementById('round-timer'),
        buyStatusEl: document.getElementById('buy-status'),
        blueScoreEl: document.getElementById('blue-score'),
        greenScoreEl: document.getElementById('green-score'),
        blueAliveEl: document.getElementById('blue-alive'),
        greenAliveEl: document.getElementById('green-alive'),
        countdownSplash: document.getElementById('buy-countdown'),
        roundResultBanner: document.getElementById('round-result-banner'),
        roundResultTitle: document.getElementById('round-result-title'),
        roundResultSubtitle: document.getElementById('round-result-subtitle'),
        killFeed: document.getElementById('killfeed'),
        damageFlash: document.getElementById('damage-flash'),
        flashbangScreen: document.getElementById('flashbang-screen'),
        economyToast: document.getElementById('economy-toast'),
        loadoutBar: document.getElementById('loadout-bar'),
        overlay: document.getElementById('overlay'),
        deathScreen: document.getElementById('death-screen'),
        respawnTimer: document.getElementById('respawn-timer'),
        leaderboard: document.getElementById('leaderboard'),
        leaderboardBody: document.getElementById('leaderboard-body'),
        shopPanel: document.getElementById('shop-panel'),
        shopItems: [],
        loadoutSlots: [],
        economyToastTimer: 0,
    };

    renderBuyMenu(hud);
    renderLoadoutBar(hud);
    if (typeof document !== 'undefined') {
        hud.shopItems = Array.from(document.querySelectorAll('[data-shop-item]'));
        hud.loadoutSlots = Array.from(document.querySelectorAll('[data-loadout-slot]'));
    }

    return hud;
}

export function updateHUD(hud, player, leaderboard, network = {}, match = {}, ui = {}) {
    if (hud.healthEl) hud.healthEl.textContent = player.hp;
    if (hud.armorEl) hud.armorEl.textContent = player.armor;
    if (hud.creditsEl) hud.creditsEl.textContent = player.credits;
    if (hud.pingEl) hud.pingEl.textContent = formatPing(network.latencyMs);
    if (hud.weaponEl) hud.weaponEl.textContent = WEAPON_DEFS[player.activeWeapon]?.label || 'Knife';
    if (hud.roundEl) hud.roundEl.textContent = `ROUND ${match.currentRound || 0}/${match.totalRounds || 0}`;
    if (hud.roundTimerEl) hud.roundTimerEl.textContent = formatClock(match.roundTimeLeftMs || 0);
    if (hud.blueScoreEl) hud.blueScoreEl.textContent = String(match.blueScore || 0);
    if (hud.greenScoreEl) hud.greenScoreEl.textContent = String(match.greenScore || 0);
    if (hud.blueAliveEl) hud.blueAliveEl.textContent = String(match.blueAlive || 0);
    if (hud.greenAliveEl) hud.greenAliveEl.textContent = String(match.greenAlive || 0);
    if (hud.buyStatusEl) {
        if (match.intermission) {
            hud.buyStatusEl.textContent = `ROUND OVER • ${formatClock(match.intermissionTimeLeftMs || 0)}`;
        } else if (match.buyPhase) {
            hud.buyStatusEl.textContent = ui.buyMenuOpen
                ? `BUY ${formatClock(match.buyTimeLeftMs || 0)} • ESC CLOSE`
                : `BUY ${formatClock(match.buyTimeLeftMs || 0)} • B OPEN`;
        } else {
            hud.buyStatusEl.textContent = 'LIVE FIRE';
        }
    }

    updateAmmoDisplay(hud, player);
    updateLoadoutBar(hud, player);
    updateCountdownSplash(hud, match.buyPhase, match.buyTimeLeftMs || 0);
    updateRoundResultBanner(hud, match);
    updateShop(hud, player, !!match.buyPhase, !!ui.buyMenuOpen);
    updateFlashbangOverlay(hud, player.flashTimeLeftMs || 0);
    updateCrosshair(hud, ui.crosshairGap, !!player.aiming);

    if (!player.alive) {
        if (hud.deathScreen) hud.deathScreen.style.display = 'flex';
        if (hud.respawnTimer) {
            hud.respawnTimer.textContent = player.respawnTimer > 0
                ? String(Math.ceil(player.respawnTimer))
                : 'NEXT ROUND';
        }
        if (hud.crosshair) hud.crosshair.style.display = 'none';
    } else {
        if (hud.deathScreen) hud.deathScreen.style.display = 'none';
        if (hud.crosshair) hud.crosshair.style.display = ui.buyMenuOpen ? 'none' : 'block';
    }

    updateLeaderboard(hud, leaderboard);
}

export function addKill(hud, killer, victim) {
    const el = document.createElement('div');
    el.className = 'kill-entry';
    el.textContent = `${killer} \u2192 ${victim}`;
    if (hud.killFeed) {
        hud.killFeed.prepend(el);
        while (hud.killFeed.children.length > 5) {
            hud.killFeed.removeChild(hud.killFeed.lastChild);
        }
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

export function showEconomyNotice(hud, text) {
    if (!hud.economyToast) return;

    hud.economyToast.textContent = text;
    hud.economyToast.classList.add('active');

    if (typeof window !== 'undefined' && hud.economyToastTimer) {
        window.clearTimeout(hud.economyToastTimer);
    }

    if (typeof window !== 'undefined') {
        hud.economyToastTimer = window.setTimeout(() => {
            hud.economyToast.classList.remove('active');
        }, 1800);
    }
}

function updateCrosshair(hud, gapPx = 14, aiming = false) {
    if (!hud.crosshair) return;
    hud.crosshair.style.setProperty('--crosshair-gap', `${Math.round(gapPx)}px`);
    hud.crosshair.classList.toggle('aiming', aiming);
}

export function formatPing(latencyMs) {
    return latencyMs == null ? 'PING -- ms' : `PING ${Math.round(latencyMs)} ms`;
}

export function buildLeaderboardRows(players, myId) {
    return Object.entries(players || {})
        .map(([id, player]) => ({
            id: Number(id),
            name: player.name || `Player ${id}`,
            team: normalizeTeam(player.team),
            kills: player.kills || 0,
            deaths: player.deaths || 0,
            credits: player.credits || 0,
            isSelf: Number(id) === myId,
        }))
        .sort((a, b) => {
            if (b.kills !== a.kills) return b.kills - a.kills;
            if (a.deaths !== b.deaths) return a.deaths - b.deaths;
            if (b.credits !== a.credits) return b.credits - a.credits;
            if (a.name !== b.name) return a.name.localeCompare(b.name);
            return a.id - b.id;
        });
}

export function getRoundResultDisplay(match = {}) {
    if (!match.intermission || (match.intermissionTimeLeftMs || 0) <= 0) {
        return { visible: false, title: '', subtitle: '' };
    }

    const winner = normalizeTeam(match.roundWinner);
    const title = winner === TEAM_BLUE || winner === TEAM_GREEN
        ? `${getTeamLabel(winner).toUpperCase()} TEAM WINS`
        : 'ROUND OVER';
    const subtitlePrefix = (match.currentRound || 0) >= (match.totalRounds || 0)
        ? 'MATCH ENDS IN'
        : 'NEXT ROUND IN';

    return {
        visible: true,
        title,
        subtitle: `${subtitlePrefix} ${formatClock(match.intermissionTimeLeftMs || 0)}`,
    };
}

export function getShopItemState(player, itemId) {
    switch (itemId) {
        case 'buy-machinegun':
            return { label: player.hasMachineGun ? 'Owned' : 'Weapon', canBuy: !player.hasMachineGun };
        case 'machinegun-ammo':
            if (!player.hasMachineGun) return { label: 'Need MG', canBuy: false };
            if ((getWeaponAmmoState(player, WEAPON_MACHINE_GUN)?.reserve || 0) >= MACHINE_GUN_AMMO_MAX) return { label: 'Full', canBuy: false };
            return { label: `${getWeaponAmmoState(player, WEAPON_MACHINE_GUN)?.reserve || 0}/${MACHINE_GUN_AMMO_MAX}`, canBuy: true };
        case 'buy-pistol':
            return { label: player.hasPistol ? 'Owned' : 'Weapon', canBuy: !player.hasPistol };
        case 'pistol-ammo':
            if (!player.hasPistol) return { label: 'Need Pistol', canBuy: false };
            if ((getWeaponAmmoState(player, WEAPON_PISTOL)?.reserve || 0) >= PISTOL_AMMO_MAX) return { label: 'Full', canBuy: false };
            return { label: `${getWeaponAmmoState(player, WEAPON_PISTOL)?.reserve || 0}/${PISTOL_AMMO_MAX}`, canBuy: true };
        case 'bomb':
            return { label: player.bombs >= GRENADE_MAX ? 'Stocked' : `${player.bombs}/${GRENADE_MAX}`, canBuy: player.bombs < GRENADE_MAX };
        case 'smoke':
            return { label: player.smokes >= GRENADE_MAX ? 'Stocked' : `${player.smokes}/${GRENADE_MAX}`, canBuy: player.smokes < GRENADE_MAX };
        case 'flashbang':
            return { label: player.flashbangs >= GRENADE_MAX ? 'Stocked' : `${player.flashbangs}/${GRENADE_MAX}`, canBuy: player.flashbangs < GRENADE_MAX };
        case 'armor':
            return { label: player.armor >= MAX_ARMOR ? 'Full' : `${player.armor}/${MAX_ARMOR}`, canBuy: player.armor < MAX_ARMOR };
        default:
            return { label: 'Ready', canBuy: true };
    }
}

function renderBuyMenu(hud) {
    if (!hud.shopPanel || typeof document === 'undefined') return;

    hud.shopPanel.replaceChildren();

    const title = document.createElement('div');
    title.className = 'shop-title';
    title.textContent = 'BUY MENU';
    hud.shopPanel.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'shop-subtitle';
    subtitle.textContent = 'B opens the menu during buy time. Esc closes it.';
    hud.shopPanel.appendChild(subtitle);

    for (const section of BUY_MENU_SECTIONS) {
        const sectionEl = document.createElement('section');
        sectionEl.className = 'shop-section';

        const heading = document.createElement('div');
        heading.className = 'shop-section-heading';

        const index = document.createElement('span');
        index.className = 'shop-section-index';
        index.textContent = section.id;

        const headingText = document.createElement('div');

        const label = document.createElement('div');
        label.className = 'shop-section-label';
        label.textContent = section.label;

        const description = document.createElement('div');
        description.className = 'shop-section-description';
        description.textContent = section.description;

        headingText.append(label, description);
        heading.append(index, headingText);
        sectionEl.appendChild(heading);

        const itemsEl = document.createElement('div');
        itemsEl.className = 'shop-section-items';

        for (const itemId of section.itemIds) {
            const item = SHOP_ITEMS.find((entry) => entry.id === itemId);
            if (!item) continue;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'shop-item';
            button.dataset.shopItem = item.id;

            const slot = document.createElement('span');
            slot.className = 'shop-hotkey';
            slot.textContent = item.slot;

            const itemLabel = document.createElement('span');
            itemLabel.className = 'shop-label';
            itemLabel.textContent = item.label;

            const effect = document.createElement('span');
            effect.className = 'shop-effect';
            effect.textContent = item.effect;

            const cost = document.createElement('span');
            cost.className = 'shop-cost';
            cost.textContent = `$${item.cost}`;

            button.append(slot, itemLabel, effect, cost);
            itemsEl.appendChild(button);
        }

        sectionEl.appendChild(itemsEl);
        hud.shopPanel.appendChild(sectionEl);
    }
}

function renderLoadoutBar(hud) {
    if (!hud.loadoutBar || typeof document === 'undefined') return;

    hud.loadoutBar.replaceChildren();

    for (const slot of LOADOUT_SLOT_DEFS) {
        const slotEl = document.createElement('div');
        slotEl.className = 'loadout-slot';
        slotEl.dataset.loadoutSlot = slot.id;

        const key = document.createElement('span');
        key.className = 'loadout-slot-key';
        key.textContent = slot.key;

        const name = document.createElement('span');
        name.className = 'loadout-slot-name';
        name.textContent = slot.label;

        const meta = document.createElement('span');
        meta.className = 'loadout-slot-meta';
        meta.textContent = slot.defaultMeta;

        slotEl.append(key, name, meta);
        hud.loadoutBar.appendChild(slotEl);
    }
}

function updateAmmoDisplay(hud, player) {
    if (hud.ammoEl) {
        const ammo = getWeaponAmmoState(player);
        if (ammo) {
            hud.ammoEl.textContent = `${ammo.clip} / ${ammo.reserve}`;
        } else if (isUtilityWeapon(player.activeWeapon)) {
            hud.ammoEl.textContent = `x${getUtilityCount(player, player.activeWeapon)}`;
        } else {
            hud.ammoEl.textContent = '--';
        }
    }
    if (hud.ammoLabelEl) {
        hud.ammoLabelEl.textContent = player.activeWeapon === WEAPON_KNIFE
            ? 'KNIFE'
            : (WEAPON_DEFS[player.activeWeapon]?.hudAmmoLabel || 'AMMO');
    }
}

function updateLoadoutBar(hud, player) {
    if (!hud.loadoutSlots?.length) return;

    const selectedUtilityLabel = isUtilityWeapon(player.activeWeapon)
        ? (WEAPON_DEFS[player.activeWeapon]?.label || 'Utility')
        : 'Utility';
    const utilityStock = `B${getUtilityCount(player, UTILITY_BOMB)} S${getUtilityCount(player, UTILITY_SMOKE)} F${getUtilityCount(player, UTILITY_FLASHBANG)}`;

    for (const slotEl of hud.loadoutSlots) {
        const slotId = slotEl.dataset.loadoutSlot;
        const nameEl = slotEl.querySelector('.loadout-slot-name');
        const metaEl = slotEl.querySelector('.loadout-slot-meta');

        slotEl.classList.remove('is-active', 'is-owned', 'is-empty');

        if (slotId === WEAPON_MACHINE_GUN) {
            const ammo = getWeaponAmmoState(player, WEAPON_MACHINE_GUN);
            const owned = !!player.hasMachineGun;
            slotEl.classList.add(owned ? 'is-owned' : 'is-empty');
            slotEl.classList.toggle('is-active', player.activeWeapon === WEAPON_MACHINE_GUN);
            if (nameEl) nameEl.textContent = 'Machine Gun';
            if (metaEl) metaEl.textContent = ammo ? `${ammo.clip}/${ammo.reserve}` : 'BUY';
            continue;
        }

        if (slotId === WEAPON_PISTOL) {
            const ammo = getWeaponAmmoState(player, WEAPON_PISTOL);
            const owned = !!player.hasPistol;
            slotEl.classList.add(owned ? 'is-owned' : 'is-empty');
            slotEl.classList.toggle('is-active', player.activeWeapon === WEAPON_PISTOL);
            if (nameEl) nameEl.textContent = 'Pistol';
            if (metaEl) metaEl.textContent = ammo ? `${ammo.clip}/${ammo.reserve}` : 'BUY';
            continue;
        }

        if (slotId === WEAPON_KNIFE) {
            slotEl.classList.add('is-owned');
            slotEl.classList.toggle('is-active', player.activeWeapon === WEAPON_KNIFE);
            if (nameEl) nameEl.textContent = 'Knife';
            if (metaEl) metaEl.textContent = 'ALWAYS';
            continue;
        }

        if (slotId === 'utility') {
            const hasUtility = getUtilityCount(player, UTILITY_BOMB) > 0
                || getUtilityCount(player, UTILITY_SMOKE) > 0
                || getUtilityCount(player, UTILITY_FLASHBANG) > 0;
            slotEl.classList.add(hasUtility ? 'is-owned' : 'is-empty');
            slotEl.classList.toggle('is-active', isUtilityWeapon(player.activeWeapon));
            if (nameEl) nameEl.textContent = selectedUtilityLabel;
            if (metaEl) metaEl.textContent = hasUtility ? utilityStock : 'EMPTY';
        }
    }
}

function updateCountdownSplash(hud, buyPhase, buyTimeLeftMs) {
    if (!hud.countdownSplash) return;

    if (buyPhase && buyTimeLeftMs > 0 && buyTimeLeftMs <= 3000) {
        hud.countdownSplash.style.display = 'block';
        hud.countdownSplash.textContent = String(Math.ceil(buyTimeLeftMs / 1000));
    } else {
        hud.countdownSplash.style.display = 'none';
    }
}

function updateRoundResultBanner(hud, match) {
    if (!hud.roundResultBanner) return;

    const display = getRoundResultDisplay(match);
    hud.roundResultBanner.style.display = display.visible ? 'flex' : 'none';
    if (hud.roundResultTitle) hud.roundResultTitle.textContent = display.title;
    if (hud.roundResultSubtitle) hud.roundResultSubtitle.textContent = display.subtitle;
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
        const teamName = row.team === TEAM_BLUE || row.team === TEAM_GREEN
            ? `[${getTeamLabel(row.team).toUpperCase()}] `
            : '';

        const rank = document.createElement('td');
        rank.textContent = String(i + 1);
        const name = document.createElement('td');
        name.textContent = row.isSelf ? `${teamName}${row.name} (You)` : `${teamName}${row.name}`;
        const kills = document.createElement('td');
        kills.textContent = String(row.kills);
        const deaths = document.createElement('td');
        deaths.textContent = String(row.deaths);
        const credits = document.createElement('td');
        credits.textContent = `$${row.credits}`;

        tr.append(rank, name, kills, deaths, credits);
        hud.leaderboardBody.appendChild(tr);
    }
}

function updateFlashbangOverlay(hud, flashTimeLeftMs) {
    if (!hud.flashbangScreen) return;

    if (flashTimeLeftMs <= 0) {
        hud.flashbangScreen.style.opacity = '0';
        return;
    }

    const phase = Math.max(0, Math.min(1, flashTimeLeftMs / 3000));
    hud.flashbangScreen.style.opacity = String(0.18 + phase * 0.82);
}

function updateShop(hud, player, buyPhase, buyMenuOpen) {
    if (!hud.shopPanel) return;

    hud.shopPanel.style.display = buyPhase && buyMenuOpen ? 'grid' : 'none';

    for (const itemEl of hud.shopItems || []) {
        const item = SHOP_ITEMS.find((entry) => entry.id === itemEl.dataset.shopItem);
        if (!item) continue;

        const state = getShopItemState(player, item.id);
        itemEl.dataset.status = state.label;
        itemEl.classList.toggle('is-affordable', state.canBuy && player.credits >= item.cost);
        itemEl.classList.toggle('is-expensive', player.credits < item.cost);
        itemEl.classList.toggle('is-disabled', !state.canBuy);
        itemEl.disabled = !buyPhase || !buyMenuOpen || !state.canBuy;
    }
}

function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
