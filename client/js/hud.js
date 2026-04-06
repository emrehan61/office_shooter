import {
    BUY_MENU_SECTIONS,
    GRENADE_MAX,
    MAX_ARMOR,
    SHOP_ITEMS,
    UTILITY_BOMB,
    UTILITY_FLASHBANG,
    UTILITY_SMOKE,
    WEAPON_DEFS,
    WEAPON_KNIFE,
    isHeavyWeapon,
    isPistolWeapon,
    isUtilityWeapon,
    weaponAllowedForTeam,
} from './economy.js';
import { MODE_DEATHMATCH, MODE_CTF } from './modes.js';
import { canOpenBuyMenu, getUtilityCount, getWeaponAmmoState } from './player.js';
import { TEAM_BLUE, TEAM_GREEN, getTeamLabel, normalizeTeam } from './teams.js';

const LOADOUT_SLOT_DEFS = [
    { id: 'heavy', key: '1', label: 'Heavy', defaultMeta: 'EMPTY' },
    { id: 'pistol', key: '2', label: 'Pistol', defaultMeta: 'DEFAULT' },
    { id: WEAPON_KNIFE, key: '3', label: 'Knife', defaultMeta: 'ALWAYS' },
    { id: 'utility', key: '4', label: 'Utility', defaultMeta: 'EMPTY' },
];

export function createHUD() {
    const objectiveMarkers = createObjectiveMarkers();
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
        blueScoreNameEl: document.getElementById('blue-score-name'),
        blueScoreEl: document.getElementById('blue-score'),
        blueScoreMetaEl: document.getElementById('blue-score-meta'),
        greenScoreNameEl: document.getElementById('green-score-name'),
        greenScoreEl: document.getElementById('green-score'),
        greenScoreMetaEl: document.getElementById('green-score-meta'),
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
        hitMarker: document.getElementById('hit-marker'),
        objectiveMarkers,
        hitMarkerTimer: 0,
        selectedShopSectionId: BUY_MENU_SECTIONS[0]?.id || '',
        selectedShopItemId: BUY_MENU_SECTIONS[0]?.itemIds?.[0] || '',
        shopItems: [],
        shopSectionButtons: [],
        shopSections: [],
        shopDetailNameEl: null,
        shopDetailMetaEl: null,
        shopDetailPriceEl: null,
        shopDetailStatusEl: null,
        shopDetailStatsEl: null,
        shopDetailSlotEl: null,
        loadoutSlots: [],
        economyToastTimer: 0,
    };

    renderBuyMenu(hud);
    renderLoadoutBar(hud);
    if (typeof document !== 'undefined') {
        hud.shopItems = Array.from(document.querySelectorAll('[data-shop-item]'));
        hud.shopSectionButtons = Array.from(document.querySelectorAll('[data-shop-section-button]'));
        hud.shopSections = Array.from(document.querySelectorAll('[data-shop-section]'));
        hud.shopDetailNameEl = document.getElementById('shop-detail-name');
        hud.shopDetailMetaEl = document.getElementById('shop-detail-meta');
        hud.shopDetailPriceEl = document.getElementById('shop-detail-price');
        hud.shopDetailStatusEl = document.getElementById('shop-detail-status');
        hud.shopDetailStatsEl = document.getElementById('shop-detail-stats');
        hud.shopDetailSlotEl = document.getElementById('shop-detail-slot');
        hud.loadoutSlots = Array.from(document.querySelectorAll('[data-loadout-slot]'));
        hud.shopPanel?.addEventListener('mouseover', (event) => {
            if (!(event.target instanceof Element)) return;
            const button = event.target.closest('[data-shop-item]');
            if (button?.dataset.shopItem) {
                hud.selectedShopItemId = button.dataset.shopItem;
                hud.selectedShopSectionId = getSectionForItem(button.dataset.shopItem);
            }
        });
        hud.shopPanel?.addEventListener('focusin', (event) => {
            if (!(event.target instanceof Element)) return;
            const button = event.target.closest('[data-shop-item]');
            if (button?.dataset.shopItem) {
                hud.selectedShopItemId = button.dataset.shopItem;
                hud.selectedShopSectionId = getSectionForItem(button.dataset.shopItem);
            }
        });
        hud.shopPanel?.addEventListener('click', (event) => {
            if (!(event.target instanceof Element)) return;
            const sectionButton = event.target.closest('[data-shop-section-button]');
            if (sectionButton?.dataset.shopSectionButton) {
                hud.selectedShopSectionId = sectionButton.dataset.shopSectionButton;
                if (!BUY_MENU_SECTIONS.find((section) => section.id === hud.selectedShopSectionId)?.itemIds?.includes(hud.selectedShopItemId)) {
                    hud.selectedShopItemId = BUY_MENU_SECTIONS.find((section) => section.id === hud.selectedShopSectionId)?.itemIds?.[0] || '';
                }
            }
        });
    }

    return hud;
}

export function updateHUD(hud, player, leaderboard, network = {}, match = {}, ui = {}) {
    const isDeathmatch = match.mode === MODE_DEATHMATCH;
    const matchBar = getMatchBarDisplay(player, match, leaderboard);
    if (hud.healthEl) hud.healthEl.textContent = player.hp;
    if (hud.armorEl) hud.armorEl.textContent = player.armor;
    if (hud.creditsEl) hud.creditsEl.textContent = player.credits;
    if (hud.pingEl) hud.pingEl.textContent = formatPing(network.latencyMs);
    if (hud.weaponEl) hud.weaponEl.textContent = WEAPON_DEFS[player.activeWeapon]?.label || 'Knife';
    if (hud.roundEl) hud.roundEl.textContent = isDeathmatch
        ? 'DEATHMATCH'
        : `ROUND ${match.currentRound || 0}/${match.totalRounds || 0}`;
    if (hud.roundTimerEl) hud.roundTimerEl.textContent = formatClock(match.roundTimeLeftMs || 0);
    if (hud.blueScoreNameEl) hud.blueScoreNameEl.textContent = matchBar.left.name;
    if (hud.blueScoreEl) hud.blueScoreEl.textContent = matchBar.left.value;
    if (hud.blueScoreMetaEl) hud.blueScoreMetaEl.textContent = matchBar.left.meta;
    if (hud.greenScoreNameEl) hud.greenScoreNameEl.textContent = matchBar.right.name;
    if (hud.greenScoreEl) hud.greenScoreEl.textContent = matchBar.right.value;
    if (hud.greenScoreMetaEl) hud.greenScoreMetaEl.textContent = matchBar.right.meta;
    if (hud.buyStatusEl) {
        if (match.mode === MODE_DEATHMATCH && match.deathmatchVoteActive) {
            hud.buyStatusEl.textContent = `VOTE ${formatClock(match.deathmatchVoteTimeLeftMs || 0)}`;
        } else if (isDeathmatch) {
            const protectionTimeLeftMs = Math.max(0, player.spawnProtectionTimeLeftMs || 0);
            const loadoutTimeLeftMs = Math.max(0, player.loadoutTimeLeftMs || 0);
            if (protectionTimeLeftMs > 0 || loadoutTimeLeftMs > 0) {
                const parts = [];
                if (protectionTimeLeftMs > 0) {
                    parts.push(`SAFE ${formatClock(protectionTimeLeftMs)}`);
                }
                if (loadoutTimeLeftMs > 0) {
                    parts.push(ui.buyMenuOpen
                        ? `LOADOUT ${formatClock(loadoutTimeLeftMs)} • ESC CLOSE`
                        : `LOADOUT ${formatClock(loadoutTimeLeftMs)} • B OPEN`);
                }
                hud.buyStatusEl.textContent = parts.join(' • ');
            } else {
                hud.buyStatusEl.textContent = 'FREE FOR ALL';
            }
        } else if (match.intermission) {
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
    updateShop(hud, player, match, !!ui.buyMenuOpen);
    updateFlashbangOverlay(hud, player.flashTimeLeftMs || 0);
    updateCrosshair(hud, ui.crosshairGap, !!player.aiming, ui.crosshairOffsetY || 0);
    updateObjectiveMarkers(hud, ui.objectiveMarkers || []);

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
        if (hud.crosshair) hud.crosshair.style.display = ui.buyMenuOpen || ui.chatOpen ? 'none' : 'block';
    }

    updateLeaderboard(hud, leaderboard);
}

function createObjectiveMarkers() {
    if (typeof document === 'undefined') return [];

    return ['primary', 'secondary'].map((slot) => {
        const el = document.createElement('div');
        el.className = `objective-marker objective-marker-${slot}`;
        el.style.display = 'none';

        const arrow = document.createElement('div');
        arrow.className = 'objective-marker-arrow';
        const label = document.createElement('div');
        label.className = 'objective-marker-label';

        el.append(arrow, label);
        document.body.appendChild(el);
        return { el, label };
    });
}

function updateObjectiveMarkers(hud, markers) {
    const slots = hud.objectiveMarkers || [];
    for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i];
        const marker = markers[i];
        if (!slot?.el || !marker?.visible) {
            if (slot?.el) slot.el.style.display = 'none';
            continue;
        }

        slot.el.style.display = 'flex';
        slot.el.style.left = `${Math.round(marker.x)}px`;
        slot.el.style.top = `${Math.round(marker.y)}px`;
        slot.el.style.setProperty('--objective-marker-color', marker.color || '#ffffff');
        slot.label.textContent = marker.label || '';
    }
}

const WEAPON_ICONS = {
    knife: `<svg viewBox="0 0 32 16" class="kill-weapon-icon kill-weapon-knife">
        <polygon points="2,10 14,4 16,3 18,4 16,6 4,12" fill="currentColor"/>
        <rect x="16" y="5" width="8" height="5" rx="1" fill="currentColor" opacity="0.7"/>
        <rect x="24" y="4" width="6" height="7" rx="2" fill="currentColor" opacity="0.5"/>
    </svg>`,
    pistol: `<svg viewBox="0 0 32 20" class="kill-weapon-icon kill-weapon-pistol">
        <rect x="2" y="5" width="20" height="5" rx="1" fill="currentColor"/>
        <rect x="0" y="4" width="6" height="7" rx="1" fill="currentColor" opacity="0.8"/>
        <rect x="18" y="3" width="4" height="3" rx="1" fill="currentColor" opacity="0.6"/>
        <rect x="14" y="10" width="6" height="8" rx="1" fill="currentColor" transform="rotate(10,17,10)"/>
    </svg>`,
    machinegun: `<svg viewBox="0 0 48 20" class="kill-weapon-icon kill-weapon-mg">
        <rect x="0" y="6" width="36" height="5" rx="1" fill="currentColor"/>
        <rect x="36" y="5" width="8" height="7" rx="1" fill="currentColor" opacity="0.7"/>
        <rect x="6" y="3" width="12" height="3" rx="1" fill="currentColor" opacity="0.6"/>
        <rect x="22" y="11" width="6" height="8" rx="1" fill="currentColor" transform="rotate(8,25,11)"/>
        <rect x="10" y="11" width="2" height="4" fill="currentColor" opacity="0.5"/>
        <rect x="30" y="11" width="2" height="4" fill="currentColor" opacity="0.5"/>
    </svg>`,
    bomb: `<svg viewBox="0 0 24 24" class="kill-weapon-icon kill-weapon-bomb">
        <circle cx="12" cy="15" r="7" fill="currentColor"/>
        <rect x="11" y="3" width="2" height="6" rx="1" fill="currentColor" opacity="0.7"/>
        <circle cx="12" cy="3" r="2" fill="#ff4" opacity="0.9"/>
    </svg>`,
};

export function addKill(hud, killer, victim, weapon) {
    const el = document.createElement('div');
    el.className = 'kill-entry';
    const iconKey = WEAPON_DEFS[weapon]?.renderAs || weapon;
    const icon = WEAPON_ICONS[iconKey] || WEAPON_ICONS.knife;
    el.innerHTML = `<span class="kill-name">${escapeHtml(killer)}</span>${icon}<span class="kill-name">${escapeHtml(victim)}</span>`;
    if (hud.killFeed) {
        hud.killFeed.prepend(el);
        while (hud.killFeed.children.length > 5) {
            hud.killFeed.removeChild(hud.killFeed.lastChild);
        }
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function showHitMarker(hud, zone = 'body', damage = 0) {
    if (!hud.crosshair) return;
    hud.crosshair.classList.add('hit');
    setTimeout(() => hud.crosshair.classList.remove('hit'), 150);

    // X-shaped hit marker overlay
    const marker = hud.hitMarker;
    if (!marker) return;
    marker.classList.remove('active', 'headshot');
    void marker.offsetWidth; // force reflow for re-animation
    marker.classList.add('active');
    if (zone === 'head') marker.classList.add('headshot');

    const dmgEl = marker.querySelector('.hm-dmg');
    if (dmgEl && damage > 0) dmgEl.textContent = damage;

    const duration = zone === 'head' ? 600 : 600;
    if (hud.hitMarkerTimer) clearTimeout(hud.hitMarkerTimer);
    hud.hitMarkerTimer = setTimeout(() => marker.classList.remove('active', 'headshot'), duration);
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

function updateCrosshair(hud, gapPx = 14, aiming = false, offsetY = 0) {
    if (!hud.crosshair) return;
    hud.crosshair.style.setProperty('--crosshair-gap', `${Math.round(gapPx)}px`);
    hud.crosshair.style.setProperty('--crosshair-offset-y', `${Math.round(offsetY)}px`);
    hud.crosshair.classList.toggle('aiming', aiming);
}

export function formatPing(latencyMs) {
    return latencyMs == null ? 'PING -- ms' : `PING ${Math.round(latencyMs)} ms`;
}

export function buildLeaderboardRows(players, myId) {
    return Object.entries(players || {})
        .filter(([, player]) => player?.inMatch !== false)
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

export function getMatchBarDisplay(player = {}, match = {}, leaderboard = {}) {
    if (match.mode === MODE_DEATHMATCH) {
        const rows = buildLeaderboardRows(leaderboard.players, leaderboard.myId);
        const rank = rows.findIndex((row) => row.isSelf) + 1;
        return {
            left: {
                name: 'KILLS',
                value: String(player.kills || 0),
                meta: rank > 0 ? `RANK #${rank}` : 'RANK --',
            },
            right: {
                name: 'DEATHS',
                value: String(player.deaths || 0),
                meta: `PLAYERS ${rows.length}`,
            },
        };
    }

    if (match.mode === MODE_CTF) {
        return {
            left: {
                name: 'BLUE',
                value: String(match.blueCTFCaptures || 0),
                meta: `FLAGS ${match.blueCTFCaptures || 0}`,
            },
            right: {
                name: 'GREEN',
                value: String(match.greenCTFCaptures || 0),
                meta: `FLAGS ${match.greenCTFCaptures || 0}`,
            },
        };
    }

    return {
        left: {
            name: 'BLUE',
            value: String(match.blueScore || 0),
            meta: `ALIVE ${match.blueAlive || 0}`,
        },
        right: {
            name: 'GREEN',
            value: String(match.greenScore || 0),
            meta: `ALIVE ${match.greenAlive || 0}`,
        },
    };
}

export function getRoundResultDisplay(match = {}) {
    if (match.mode === MODE_DEATHMATCH && match.deathmatchVoteActive) {
        return {
            visible: true,
            title: 'PLAY AGAIN?',
            subtitle: `NEXT MATCH VOTE ENDS IN ${formatClock(match.deathmatchVoteTimeLeftMs || 0)}`,
        };
    }

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

export function getShopItemState(player, itemId, team = player.team) {
    const def = WEAPON_DEFS[itemId];
    if (def && (isPistolWeapon(itemId) || isHeavyWeapon(itemId))) {
        if (!weaponAllowedForTeam(itemId, team)) {
            return { label: 'Wrong side', canBuy: false };
        }
        if (player.pistolWeapon === itemId || player.heavyWeapon === itemId) {
            return { label: 'Equipped', canBuy: false };
        }
        if (isPistolWeapon(itemId)) {
            return { label: player.pistolWeapon ? 'Replace' : 'Buy', canBuy: true };
        }
        return { label: player.heavyWeapon ? 'Replace' : 'Buy', canBuy: true };
    }

    switch (itemId) {
        case UTILITY_BOMB:
            return { label: player.bombs >= GRENADE_MAX ? 'Stocked' : `${player.bombs}/${GRENADE_MAX}`, canBuy: player.bombs < GRENADE_MAX };
        case UTILITY_SMOKE:
            return { label: player.smokes >= GRENADE_MAX ? 'Stocked' : `${player.smokes}/${GRENADE_MAX}`, canBuy: player.smokes < GRENADE_MAX };
        case UTILITY_FLASHBANG:
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
    subtitle.textContent = 'Heavy, pistol, knife, and three utility slots. B opens. Esc closes.';
    hud.shopPanel.appendChild(subtitle);

    const shell = document.createElement('div');
    shell.className = 'shop-shell';

    const nav = document.createElement('aside');
    nav.className = 'shop-rail';
    for (const section of BUY_MENU_SECTIONS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shop-rail-button';
        button.dataset.shopSectionButton = section.id;

        const label = document.createElement('span');
        label.className = 'shop-rail-label';
        label.textContent = section.label;

        const meta = document.createElement('span');
        meta.className = 'shop-rail-meta';
        meta.textContent = section.description;

        button.append(label, meta);
        nav.appendChild(button);
    }

    const catalog = document.createElement('div');
    catalog.className = 'shop-catalog';

    for (const section of BUY_MENU_SECTIONS) {
        const sectionEl = document.createElement('section');
        sectionEl.className = 'shop-section';
        sectionEl.dataset.shopSection = section.id;

        const heading = document.createElement('div');
        heading.className = 'shop-section-heading';

        const index = document.createElement('span');
        index.className = 'shop-section-index';
        index.textContent = section.label.slice(0, 1);

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
        catalog.appendChild(sectionEl);
    }

    const detail = document.createElement('aside');
    detail.className = 'shop-detail';
    detail.innerHTML = `
        <div class="shop-detail-slot" id="shop-detail-slot">SELECTED SLOT</div>
        <div class="shop-detail-name" id="shop-detail-name">AK-47</div>
        <div class="shop-detail-meta" id="shop-detail-meta">Rifle</div>
        <div class="shop-detail-price" id="shop-detail-price">$2700</div>
        <div class="shop-detail-status" id="shop-detail-status">Buy</div>
        <div class="shop-detail-stats" id="shop-detail-stats"></div>
    `;

    shell.append(nav, catalog, detail);
    hud.shopPanel.appendChild(shell);
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

    const heavyAmmo = player.heavyWeapon ? getWeaponAmmoState(player, player.heavyWeapon) : null;
    const pistolAmmo = player.pistolWeapon ? getWeaponAmmoState(player, player.pistolWeapon) : null;
    const selectedUtilityLabel = isUtilityWeapon(player.activeWeapon)
        ? (WEAPON_DEFS[player.activeWeapon]?.label || 'Utility')
        : 'Utility';
    const utilityStock = `B${getUtilityCount(player, UTILITY_BOMB)} S${getUtilityCount(player, UTILITY_SMOKE)} F${getUtilityCount(player, UTILITY_FLASHBANG)}`;

    for (const slotEl of hud.loadoutSlots) {
        const slotId = slotEl.dataset.loadoutSlot;
        const nameEl = slotEl.querySelector('.loadout-slot-name');
        const metaEl = slotEl.querySelector('.loadout-slot-meta');

        slotEl.classList.remove('is-active', 'is-owned', 'is-empty');

        if (slotId === 'heavy') {
            const owned = !!player.heavyWeapon;
            slotEl.classList.add(owned ? 'is-owned' : 'is-empty');
            slotEl.classList.toggle('is-active', owned && player.activeWeapon === player.heavyWeapon);
            if (nameEl) nameEl.textContent = owned ? (WEAPON_DEFS[player.heavyWeapon]?.label || 'Heavy') : 'No Heavy';
            if (metaEl) metaEl.textContent = heavyAmmo ? `${heavyAmmo.clip}/${heavyAmmo.reserve}` : 'EMPTY';
            continue;
        }

        if (slotId === 'pistol') {
            const owned = !!player.pistolWeapon;
            slotEl.classList.add(owned ? 'is-owned' : 'is-empty');
            slotEl.classList.toggle('is-active', owned && player.activeWeapon === player.pistolWeapon);
            if (nameEl) nameEl.textContent = owned ? (WEAPON_DEFS[player.pistolWeapon]?.label || 'Pistol') : 'No Pistol';
            if (metaEl) metaEl.textContent = pistolAmmo ? `${pistolAmmo.clip}/${pistolAmmo.reserve}` : 'DEFAULT';
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

function getSectionForItem(itemId) {
    return BUY_MENU_SECTIONS.find((section) => section.itemIds.includes(itemId))?.id || BUY_MENU_SECTIONS[0]?.id || '';
}

function getDefaultItemForSection(sectionId) {
    return BUY_MENU_SECTIONS.find((section) => section.id === sectionId)?.itemIds?.[0] || '';
}

function ensureShopSelection(hud) {
    if (!hud.selectedShopSectionId || !BUY_MENU_SECTIONS.some((section) => section.id === hud.selectedShopSectionId)) {
        hud.selectedShopSectionId = BUY_MENU_SECTIONS[0]?.id || '';
    }
    const selectedSection = BUY_MENU_SECTIONS.find((section) => section.id === hud.selectedShopSectionId);
    if (!hud.selectedShopItemId || !selectedSection?.itemIds.includes(hud.selectedShopItemId)) {
        hud.selectedShopItemId = selectedSection?.itemIds?.[0] || '';
    }
}

function getShopSlotLabel(itemId) {
    if (itemId === 'armor') return 'Gear';
    if (isPistolWeapon(itemId)) return 'Pistol Slot';
    if (isHeavyWeapon(itemId)) return 'Heavy Slot';
    if (isUtilityWeapon(itemId)) return 'Utility Slot';
    return 'Equipment';
}

function getShopMeta(itemId) {
    const def = WEAPON_DEFS[itemId];
    if (!def) {
        return itemId === 'armor' ? 'Kevlar armor' : 'Utility';
    }
    const parts = [];
    if (def.side && def.side !== 'both') {
        parts.push(def.side.toUpperCase());
    }
    parts.push(def.category.replace(/-/g, ' '));
    return parts.join(' • ').toUpperCase();
}

function formatStat(value) {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    return String(value);
}

function getShopDetailStats(itemId) {
    if (itemId === 'armor') {
        return [
            ['Protection', '100 armor'],
            ['Slot', 'Gear'],
            ['Notes', 'No helmet split'],
        ];
    }

    const def = WEAPON_DEFS[itemId];
    if (!def) return [];

    if (isUtilityWeapon(itemId)) {
        return [
            ['Category', def.label],
            ['Carry Limit', GRENADE_MAX],
            ['Use', def.effect || def.secondaryMode || 'Throwable'],
        ];
    }

    return [
        ['Damage', def.baseDamage],
        ['Mag', def.magSize],
        ['Reserve', def.reserveMax],
        ['Fire', `${def.fireIntervalMs}ms`],
        ['Reward', `$${def.killReward}`],
        ['Move', def.moveSpeed],
    ];
}

function updateShopDetail(hud, player, freeLoadout) {
    const item = SHOP_ITEMS.find((entry) => entry.id === hud.selectedShopItemId) || SHOP_ITEMS[0];
    if (!item) return;

    const state = getShopItemState(player, item.id, player.team);
    const def = WEAPON_DEFS[item.id];
    const affordable = freeLoadout || player.credits >= item.cost;
    const statusLabel = !state.canBuy
        ? state.label
        : (freeLoadout ? `${state.label} • FREE` : (affordable ? `${state.label} • READY` : 'Too expensive'));

    if (hud.shopDetailSlotEl) hud.shopDetailSlotEl.textContent = getShopSlotLabel(item.id);
    if (hud.shopDetailNameEl) hud.shopDetailNameEl.textContent = item.label;
    if (hud.shopDetailMetaEl) hud.shopDetailMetaEl.textContent = getShopMeta(item.id);
    if (hud.shopDetailPriceEl) hud.shopDetailPriceEl.textContent = freeLoadout ? 'FREE' : `$${item.cost}`;
    if (hud.shopDetailStatusEl) hud.shopDetailStatusEl.textContent = statusLabel;
    if (hud.shopDetailStatsEl) {
        hud.shopDetailStatsEl.replaceChildren();
        for (const [label, value] of getShopDetailStats(item.id)) {
            const row = document.createElement('div');
            row.className = 'shop-detail-stat';

            const statLabel = document.createElement('span');
            statLabel.className = 'shop-detail-stat-label';
            statLabel.textContent = label;

            const statValue = document.createElement('span');
            statValue.className = 'shop-detail-stat-value';
            statValue.textContent = formatStat(value);

            row.append(statLabel, statValue);
            hud.shopDetailStatsEl.appendChild(row);
        }
        if (def?.zoomLevels?.length) {
            const zoomRow = document.createElement('div');
            zoomRow.className = 'shop-detail-stat';
            zoomRow.innerHTML = `<span class="shop-detail-stat-label">Zoom</span><span class="shop-detail-stat-value">${def.zoomLevels.length}x level</span>`;
            hud.shopDetailStatsEl.appendChild(zoomRow);
        }
    }
}

function updateShop(hud, player, match, buyMenuOpen) {
    if (!hud.shopPanel) return;

    const freeLoadout = match.mode === MODE_DEATHMATCH && (player.loadoutTimeLeftMs || 0) > 0;
    const buyPhase = canOpenBuyMenu(player, match);
    ensureShopSelection(hud);

    hud.shopPanel.style.display = buyPhase && buyMenuOpen ? 'grid' : 'none';

    for (const button of hud.shopSectionButtons || []) {
        const sectionId = button.dataset.shopSectionButton;
        button.classList.toggle('is-active', sectionId === hud.selectedShopSectionId);
    }
    for (const sectionEl of hud.shopSections || []) {
        sectionEl.classList.toggle('is-active', sectionEl.dataset.shopSection === hud.selectedShopSectionId);
    }

    for (const itemEl of hud.shopItems || []) {
        const item = SHOP_ITEMS.find((entry) => entry.id === itemEl.dataset.shopItem);
        if (!item) continue;

        const state = getShopItemState(player, item.id, player.team);
        const affordable = freeLoadout || player.credits >= item.cost;
        itemEl.dataset.status = freeLoadout && state.canBuy ? `${state.label} • FREE` : state.label;
        itemEl.classList.toggle('is-selected', item.id === hud.selectedShopItemId);
        itemEl.classList.toggle('is-affordable', state.canBuy && affordable);
        itemEl.classList.toggle('is-expensive', !freeLoadout && !affordable);
        itemEl.classList.toggle('is-disabled', !state.canBuy);
        itemEl.classList.toggle('is-equipped', state.label === 'Equipped');
        itemEl.disabled = !buyPhase || !buyMenuOpen || !state.canBuy;

        const costEl = itemEl.querySelector('.shop-cost');
        if (costEl) {
            costEl.textContent = freeLoadout ? 'FREE' : `$${item.cost}`;
        }
    }

    updateShopDetail(hud, player, freeLoadout);
}

function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
