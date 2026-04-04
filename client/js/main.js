import { createRenderer, uploadWorldGeo, drawWorld, drawDynamic } from './renderer.js';
import { DEFAULT_FOV, approachCameraFov, createCamera, updateCamera } from './camera.js';
import { init, consumeMouse, isKeyDown, isMouseDown, isRightMouseDown, isLocked, setPointerLockEnabled } from './input.js';
import { buildWorldGeometry, traceShotImpact } from './world.js';
import {
    applyAuthoritativeState,
    canMove,
    canAttackWithWeapon,
    canReloadWeapon,
    createPlayer,
    cycleActiveUtility,
    hasWeapon,
    playerJump,
    resetCombatState,
    resetMatchState,
    setAiming,
    setActiveWeapon,
    startReload,
    spendWeaponAmmo,
    updatePlayer,
} from './player.js';
import { canFire, consumeRecoilDelta, createWeapon, fire, getCrosshairGap, setWeaponReloadTime, setWeaponType, updateWeapon, weaponVerts } from './weapon.js';
import { addKill, createHUD, showDamageFlash, showEconomyNotice, showHitMarker, updateHUD } from './hud.js';
import { connect, createNet, estimateServerTime, sampleRemotePlayer, sendBuy, sendChat, sendInput, sendReload, sendShoot, sendStart, sendSwitchWeapon, sendTeam, sendThrow } from './net.js';
import { buildAvatarVerts } from './avatar.js';
import { buildWebSocketURL, getDefaultServerAddress } from './config.js';
import { clamp, lookDirFromYawPitch, mat4Create, mat4Multiply } from './math.js';
import { RELOAD_DURATION_MS, WEAPON_DEFS, WEAPON_KNIFE, getRenderableWeapon, getWeaponSwitchByCode, isUtilityWeapon } from './economy.js';
import { buildEffectVerts, buildProjectileVerts } from './projectiles.js';
import { TEAM_BLUE, TEAM_GREEN, TEAM_NONE, canSelectTeam, getTeamCounts, getTeamLabel, getTeamStartState, normalizeTeam } from './teams.js';
import {
    createAnnouncer,
    createKillAnnouncerState,
    getAnnouncerKillCues,
    getAnnouncerMatchCues,
    playAnnouncerCue,
    primeAnnouncer,
    snapshotMatchForAnnouncer,
} from './audio.js';

const SEND_RATE = 1 / 60;
const REMOTE_RENDER_DELAY_MS = 100;
const CHAT_HISTORY_LIMIT = 8;
const CHAT_MESSAGE_LIFETIME_MS = 8000;

let lastTime = 0;
let sendTimer = 0;
let buyMenuOpen = false;
let chatOpen = false;
let restorePointerLockAfterChat = false;
let lastClosedVisibleChatCount = 0;
const localImpactEffects = [];
const worldDynamicVerts = [];
const mergedEffects = [];
const chatMessages = [];

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const camera = createCamera();
const player = createPlayer();
const weapon = createWeapon();
const hud = createHUD();
const net = createNet();
const announcer = createAnnouncer();
let lastAnnouncerMatch = null;
let killAnnouncerState = createKillAnnouncerState();

window._cam = camera;
init(canvas);

const worldGeo = buildWorldGeometry();
uploadWorldGeo(renderer, worldGeo);

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    renderer.gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

function warmAudio() {
    void primeAnnouncer(announcer);
}

window.addEventListener('pointerdown', warmAudio, { once: true });
window.addEventListener('keydown', warmAudio, { once: true });

const serverInput = document.getElementById('server-input');
const nameInput = document.getElementById('name-input');
const connectBtn = document.getElementById('connect-btn');
const lobbyPanel = document.getElementById('lobby-panel');
const lobbyForm = document.querySelector('.lobby-form');
const lobbyStatus = document.getElementById('lobby-status');
const playerList = document.getElementById('player-list');
const startBtn = document.getElementById('start-btn');
const teamBlueBtn = document.getElementById('team-blue-btn');
const teamGreenBtn = document.getElementById('team-green-btn');
const teamHint = document.getElementById('team-hint');
const chatPanel = document.getElementById('chat-panel');
const chatFeed = document.getElementById('chat-feed');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

function getSelfLobbyPlayer() {
    if (net.myId == null) return null;
    return net.players[String(net.myId)] || null;
}

function updateTeamControls() {
    const counts = getTeamCounts(net.players);
    const startState = getTeamStartState(net.players);
    const myTeam = normalizeTeam(getSelfLobbyPlayer()?.team);
    const buttonDefs = [
        { el: teamBlueBtn, team: TEAM_BLUE, count: counts.blue },
        { el: teamGreenBtn, team: TEAM_GREEN, count: counts.green },
    ];

    for (const entry of buttonDefs) {
        if (!entry.el) continue;
        entry.el.textContent = `${getTeamLabel(entry.team).toUpperCase()} TEAM (${entry.count})`;
        entry.el.classList.toggle('is-active', myTeam === entry.team);
        entry.el.disabled = !net.connected
            || net.gameStarted
            || (!canSelectTeam(net.players, net.myId, entry.team) && myTeam !== entry.team);
    }

    if (teamHint) {
        if (!net.connected) {
            teamHint.textContent = 'Connect first.';
        } else if (net.gameStarted) {
            teamHint.textContent = 'Match already in progress.';
        } else if (startState.ok) {
            teamHint.textContent = 'Teams are balanced. Ready to start.';
        } else {
            teamHint.textContent = `${startState.reason}.`;
        }
    }

    if (startBtn) {
        startBtn.disabled = !net.connected || net.gameStarted || !startState.ok;
        startBtn.title = startState.ok ? '' : startState.reason;
    }
}

function setBuyMenuOpen(nextOpen) {
    const allowed = nextOpen && net.gameStarted && net.match.buyPhase && player.alive;
    buyMenuOpen = !!allowed;
    syncPointerLockAvailability();

    if (buyMenuOpen && document.pointerLockElement === canvas && document.exitPointerLock) {
        document.exitPointerLock();
    }
}

function isEditableTarget(target) {
    return target instanceof HTMLElement
        && (target.tagName === 'INPUT'
            || target.tagName === 'TEXTAREA'
            || target.isContentEditable);
}

function canChat() {
    return net.connected && net.myId != null;
}

function syncPointerLockAvailability() {
    setPointerLockEnabled(!buyMenuOpen && !chatOpen);
}

function requestPointerLockIfNeeded() {
    if (!restorePointerLockAfterChat || buyMenuOpen || !net.gameStarted || !player.alive || !canvas.requestPointerLock) {
        restorePointerLockAfterChat = false;
        return;
    }

    restorePointerLockAfterChat = false;
    try {
        canvas.requestPointerLock();
    } catch {
        // Ignore browsers that reject keyboard-triggered pointer lock restores.
    }
}

function getVisibleChatMessages(now = Date.now()) {
    if (chatOpen) {
        return chatMessages;
    }
    return chatMessages.filter((message) => (message.expiresAt || 0) > now);
}

function refreshChatVisibility(now = Date.now()) {
    if (chatOpen || !canChat()) return;

    const visibleCount = getVisibleChatMessages(now).length;
    if (visibleCount !== lastClosedVisibleChatCount) {
        renderChat(now);
    }
}

function renderChat(now = Date.now()) {
    if (!chatPanel || !chatFeed) return;

    if (!canChat()) {
        chatPanel.style.display = 'none';
        chatPanel.classList.remove('is-open');
        lastClosedVisibleChatCount = 0;
        return;
    }

    const visibleMessages = getVisibleChatMessages(now);
    lastClosedVisibleChatCount = chatOpen ? 0 : visibleMessages.length;
    chatPanel.style.display = chatOpen || visibleMessages.length > 0 ? 'flex' : 'none';
    chatPanel.classList.toggle('is-open', chatOpen);
    chatFeed.replaceChildren();

    if (visibleMessages.length === 0) {
        if (!chatOpen) {
            return;
        }
        const empty = document.createElement('div');
        empty.className = 'chat-entry is-empty';
        empty.textContent = 'Type a message, press Enter to send, Esc to close.';
        chatFeed.appendChild(empty);
        chatFeed.scrollTop = chatFeed.scrollHeight;
        return;
    }

    for (const message of visibleMessages) {
        const row = document.createElement('div');
        row.className = 'chat-entry';
        if (message.id === net.myId) {
            row.classList.add('is-self');
        }

        const author = document.createElement('span');
        author.className = 'chat-author';
        author.textContent = `${message.id === net.myId ? 'YOU' : (message.name || 'PLAYER')}:`;

        const body = document.createElement('span');
        body.textContent = message.text || '';

        row.append(author, body);
        chatFeed.appendChild(row);
    }

    chatFeed.scrollTop = chatFeed.scrollHeight;
}

function setChatOpen(nextOpen) {
    const allowed = !!nextOpen && canChat();
    if (allowed === chatOpen) {
        if (allowed && chatInput) {
            chatInput.focus();
            chatInput.select();
        }
        return;
    }

    if (allowed) {
        restorePointerLockAfterChat = isLocked();
        if (restorePointerLockAfterChat && document.exitPointerLock) {
            document.exitPointerLock();
        }
    } else if (chatInput) {
        chatInput.blur();
        chatInput.value = '';
    }

    chatOpen = allowed;
    syncPointerLockAvailability();
    renderChat();

    if (chatOpen && chatInput) {
        chatInput.focus();
        chatInput.select();
        return;
    }

    requestPointerLockIfNeeded();
}

function clearChat() {
    chatMessages.length = 0;
    renderChat();
}

function pushChatMessage(message) {
    const text = typeof message?.text === 'string' ? message.text.trim() : '';
    if (!text) return;

    chatMessages.push({
        id: typeof message.id === 'number' ? message.id : null,
        name: typeof message.name === 'string' ? message.name : '',
        text,
        expiresAt: Date.now() + CHAT_MESSAGE_LIFETIME_MS,
    });
    if (chatMessages.length > CHAT_HISTORY_LIMIT) {
        chatMessages.splice(0, chatMessages.length - CHAT_HISTORY_LIMIT);
    }
    renderChat();
}

if (serverInput) serverInput.value = getDefaultServerAddress(window.location);
renderChat();
syncPointerLockAvailability();

function populatePlayerList() {
    if (!playerList) return;

    playerList.innerHTML = '';
    const ids = Object.keys(net.players).sort((a, b) => {
        const orderForTeam = (team) => {
            if (team === TEAM_BLUE) return 0;
            if (team === TEAM_GREEN) return 1;
            return 2;
        };
        const left = net.players[a] || {};
        const right = net.players[b] || {};
        const teamDiff = orderForTeam(normalizeTeam(left.team)) - orderForTeam(normalizeTeam(right.team));
        if (teamDiff !== 0) return teamDiff;
        return Number(a) - Number(b);
    });
    if (ids.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'player-row empty';
        empty.textContent = 'Waiting for players...';
        playerList.appendChild(empty);
    }

    for (const id of ids) {
        const entry = net.players[id] || {};
        const team = normalizeTeam(entry.team);
        const row = document.createElement('div');
        row.className = `player-row team-${team || 'none'}`;
        const isSelf = Number(id) === net.myId;
        const badge = document.createElement('span');
        badge.className = `player-team-badge team-${team || 'none'}`;
        badge.textContent = getTeamLabel(team).toUpperCase();

        const label = document.createElement('span');
        label.textContent = isSelf ? `${entry.name || 'You'} (You)` : (entry.name || '???');

        row.append(badge, label);
        playerList.appendChild(row);
    }

    updateTeamControls();
}

function setLobbyStatus(text) {
    if (lobbyStatus) lobbyStatus.textContent = text;
}

function showConnectForm() {
    if (lobbyForm) lobbyForm.style.display = 'flex';
    if (lobbyPanel) lobbyPanel.style.display = 'none';
}

function showLobbyPanel() {
    if (lobbyPanel) lobbyPanel.style.display = 'block';
    if (lobbyForm) lobbyForm.style.display = 'none';
}

function syncLocalWeaponState() {
    setWeaponType(weapon, getRenderableWeapon(player.activeWeapon));
    setWeaponReloadTime(weapon, player.reloadTimeLeftMs);
}

function resetAfterDisconnect(message) {
    resetMatchState(player);
    player.team = TEAM_NONE;
    syncLocalWeaponState();
    sendTimer = 0;
    setBuyMenuOpen(false);
    setChatOpen(false);
    clearChat();
    camera.fov = DEFAULT_FOV;
    localImpactEffects.length = 0;
    lastAnnouncerMatch = null;
    killAnnouncerState = createKillAnnouncerState();

    if (hud.overlay) hud.overlay.style.display = 'flex';
    showConnectForm();
    setLobbyStatus(message || 'Disconnected from server');
    populatePlayerList();
}

function syncAnnouncer(match) {
    const nextState = snapshotMatchForAnnouncer(match);
    const cues = getAnnouncerMatchCues(lastAnnouncerMatch, nextState, {
        myTeam: normalizeTeam(player.team),
    });
    lastAnnouncerMatch = nextState;
    for (const cue of cues) {
        playAnnouncerCue(announcer, cue);
    }
}

if (hud.shopPanel) {
    hud.shopPanel.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest('[data-shop-item]');
        if (!button || !buyMenuOpen) return;

        event.preventDefault();
        sendBuy(net, button.dataset.shopItem);
    });
}

if (chatForm) {
    chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = (chatInput ? chatInput.value : '').trim();
        if (!text) {
            setChatOpen(false);
            return;
        }

        sendChat(net, text);
        if (chatInput) {
            chatInput.value = '';
            chatInput.focus();
        }
    });
}

if (chatInput) {
    chatInput.addEventListener('keydown', (event) => {
        if (event.code !== 'Escape') return;
        event.preventDefault();
        setChatOpen(false);
    });
}

if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
        const name = (nameInput ? nameInput.value.trim() : '') || 'Player';
        const server = (serverInput ? serverInput.value.trim() : '') || 'localhost:8080';
        const url = buildWebSocketURL(server, window.location);

        warmAudio();
        connectBtn.disabled = true;
        setLobbyStatus('Connecting...');

        try {
            const msg = await connect(net, url, name);
            resetMatchState(player);
            applyAuthoritativeState(player, msg);
            syncLocalWeaponState();
            camera.position = player.pos;
            clearChat();
            showLobbyPanel();
            populatePlayerList();
            setLobbyStatus(net.gameStarted ? 'Match in progress' : 'Connected to lobby');
            lastAnnouncerMatch = snapshotMatchForAnnouncer(net.match);
            killAnnouncerState = createKillAnnouncerState(net.match.currentRound || 0);
        } catch (err) {
            resetAfterDisconnect(err.message || 'Connection failed');
        } finally {
            connectBtn.disabled = false;
        }
    });
}

net.onLobby = (msg) => {
    populatePlayerList();
    if (msg.state === 'playing') {
        setLobbyStatus(`Round ${net.match.currentRound}/${net.match.totalRounds}`);
    } else {
        setBuyMenuOpen(false);
        if (hud.overlay) hud.overlay.style.display = 'flex';
        showLobbyPanel();
        setLobbyStatus(net.match.currentRound === 0 ? 'Connected to lobby' : 'Match finished');
    }
};

net.onTeam = (msg) => {
    if (msg.ok === false) {
        setLobbyStatus(msg.reason || 'Team selection failed');
        updateTeamControls();
        return;
    }
    setLobbyStatus(`${getTeamLabel(msg.team).toUpperCase()} team selected`);
};

net.onStartDenied = (msg) => {
    setLobbyStatus(msg.reason || 'Cannot start match');
    updateTeamControls();
};

if (startBtn) {
    startBtn.addEventListener('click', () => {
        const startState = getTeamStartState(net.players);
        if (!startState.ok) {
            setLobbyStatus(startState.reason);
            updateTeamControls();
            return;
        }
        warmAudio();
        if (startBtn) startBtn.disabled = true;
        setLobbyStatus('Starting match...');
        sendStart(net);
    });
}

if (teamBlueBtn) {
    teamBlueBtn.addEventListener('click', () => {
        if (!canSelectTeam(net.players, net.myId, TEAM_BLUE)) {
            setLobbyStatus('Blue team would break balance');
            updateTeamControls();
            return;
        }
        sendTeam(net, TEAM_BLUE);
    });
}

if (teamGreenBtn) {
    teamGreenBtn.addEventListener('click', () => {
        if (!canSelectTeam(net.players, net.myId, TEAM_GREEN)) {
            setLobbyStatus('Green team would break balance');
            updateTeamControls();
            return;
        }
        sendTeam(net, TEAM_GREEN);
    });
}

window.addEventListener('keydown', (e) => {
    if (isEditableTarget(e.target)) {
        return;
    }

    if (e.code === 'Escape' && chatOpen) {
        e.preventDefault();
        setChatOpen(false);
        return;
    }

    if (e.code === 'Enter' && canChat()) {
        e.preventDefault();
        setChatOpen(true);
        return;
    }

    if (chatOpen) {
        return;
    }

    if (e.code === 'Escape' && buyMenuOpen) {
        e.preventDefault();
        setBuyMenuOpen(false);
        return;
    }

    if (e.code === 'KeyB') {
        if (net.gameStarted && net.match.buyPhase && player.alive) {
            e.preventDefault();
            setBuyMenuOpen(true);
        }
        return;
    }

    if (buyMenuOpen) {
        if (e.code.startsWith('Digit')) {
            e.preventDefault();
        }
        return;
    }

    if (e.code === 'Space' && canMove(player, net.match)) playerJump(player);
    if (e.code === 'Tab' && net.gameStarted) e.preventDefault();
    if (e.code === 'KeyR' && net.gameStarted && player.alive) {
        e.preventDefault();
        if (canReloadWeapon(player)) {
            startReload(player, RELOAD_DURATION_MS);
            syncLocalWeaponState();
            sendReload(net);
        }
        return;
    }

    const switchWeapon = getWeaponSwitchByCode(e.code);
    if (switchWeapon) {
        e.preventDefault();
        if (player.reloading) {
            showEconomyNotice(hud, 'ACTION RELOADING');
            return;
        }
        if (hasWeapon(player, switchWeapon.id)) {
            setActiveWeapon(player, switchWeapon.id);
            syncLocalWeaponState();
            sendSwitchWeapon(net, switchWeapon.id);
        } else if (switchWeapon.id !== WEAPON_KNIFE) {
            showEconomyNotice(hud, `${switchWeapon.label.toUpperCase()} NOT OWNED`);
        }
        return;
    }

    if (e.code === 'Digit4') {
        e.preventDefault();
        if (player.reloading) {
            showEconomyNotice(hud, 'ACTION RELOADING');
            return;
        }
        const utility = cycleActiveUtility(player);
        if (utility) {
            syncLocalWeaponState();
            sendSwitchWeapon(net, utility);
        } else {
            showEconomyNotice(hud, 'NO UTILITY OWNED');
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (isEditableTarget(e.target) || chatOpen) return;
    if (e.code === 'Tab' && net.gameStarted) e.preventDefault();
});

net.onHit = (msg) => {
    if (msg.to == net.myId) {
        applyAuthoritativeState(player, {
            hp: msg.hp,
            armor: msg.armor,
            alive: msg.hp > 0,
        });
        showDamageFlash(hud, msg.zone);
    }
    if (msg.from == net.myId) showHitMarker(hud);
};

net.onKill = (msg) => {
    const killerName = msg.killer == net.myId ? 'You' : (net.players[msg.killer]?.name || '?');
    const victimName = msg.victim == net.myId ? 'You' : (net.players[msg.victim]?.name || '?');
    addKill(hud, killerName, victimName);

    const nextKillState = getAnnouncerKillCues(killAnnouncerState, msg, net.myId);
    killAnnouncerState = nextKillState.state;
    for (const cue of nextKillState.cues) {
        playAnnouncerCue(announcer, cue);
    }
};

net.onRespawn = (msg) => {
    resetCombatState(player);
    applyAuthoritativeState(player, msg);
    syncLocalWeaponState();
    camera.position = player.pos;
    setBuyMenuOpen(false);
    localImpactEffects.length = 0;
};

net.onRound = () => {
    player.vel = [0, 0, 0];
    player.onGround = true;
    player.respawnTimer = 0;
    syncLocalWeaponState();
    camera.position = player.pos;
    setBuyMenuOpen(false);
    localImpactEffects.length = 0;
    killAnnouncerState = createKillAnnouncerState(net.match.currentRound || 0);
    if (hud.overlay) hud.overlay.style.display = 'none';
};

net.onShot = (msg) => {
    if (msg.id !== net.myId || msg.weapon === WEAPON_KNIFE || !Array.isArray(msg.pos) || !Array.isArray(msg.dir)) {
        return;
    }

    const impactPos = traceShotImpact(msg.pos, msg.dir, net.players, net.myId);
    localImpactEffects.push({
        type: 'impact',
        pos: impactPos,
        timeLeftMs: 140,
    });
    if (localImpactEffects.length > 16) {
        localImpactEffects.splice(0, localImpactEffects.length - 16);
    }
};

net.onSelfState = (state) => {
    applyAuthoritativeState(player, state);
    syncLocalWeaponState();
};

net.onEconomy = (msg) => {
    if (msg.id != null && msg.id != net.myId) return;
    applyAuthoritativeState(player, msg);
    syncLocalWeaponState();

    if (!msg.label && !msg.reason) return;

    const detail = msg.reason || (typeof msg.amount === 'number' && msg.amount !== 0
        ? `${msg.label} ${msg.amount > 0 ? `+$${msg.amount}` : `-$${Math.abs(msg.amount)}`}`
        : msg.label);
    const prefix = msg.ok === false
        ? (msg.kind === 'purchase' ? 'SHOP' : 'ACTION')
        : (msg.kind === 'reward' ? 'CREDITS' : (msg.kind === 'purchase' ? 'BUY' : 'ACTION'));
    showEconomyNotice(hud, `${prefix} ${detail}`);
};

net.onDisconnect = ({ reason }) => {
    resetAfterDisconnect(reason);
};

net.onMatch = (match) => {
    syncAnnouncer(match);
};

net.onChat = (msg) => {
    pushChatMessage(msg);
};

function frame(time) {
    requestAnimationFrame(frame);

    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    refreshChatVisibility();

    if (net.gameStarted) {
        if (hud.overlay && hud.overlay.style.display !== 'none') {
            hud.overlay.style.display = 'none';
        }
        if (lobbyPanel && lobbyPanel.style.display !== 'none') {
            lobbyPanel.style.display = 'none';
        }
    }

    const gameplayInputEnabled = !chatOpen;
    const rawMouse = consumeMouse();
    const mouse = gameplayInputEnabled ? rawMouse : { dx: 0, dy: 0 };
    updateCamera(camera, mouse.dx, mouse.dy, canvas.width / canvas.height);

    const keys = {
        forward: gameplayInputEnabled && isKeyDown('KeyW'),
        backward: gameplayInputEnabled && isKeyDown('KeyS'),
        left: gameplayInputEnabled && isKeyDown('KeyA'),
        right: gameplayInputEnabled && isKeyDown('KeyD'),
    };
    const crouchPressed = gameplayInputEnabled && (
        isKeyDown('ControlLeft')
        || isKeyDown('ControlRight')
        || isKeyDown('MetaLeft')
        || isKeyDown('MetaRight')
    );

    for (const id in net.players) {
        const remote = net.players[id];
        if (remote.shotTime > 0) {
            remote.shotTime = Math.max(0, remote.shotTime - dt);
        }
    }

    if (net.gameStarted) {
        const movementAllowed = gameplayInputEnabled && canMove(player, net.match);
        player.crouching = player.alive && crouchPressed;
        setAiming(player, gameplayInputEnabled && player.alive && !net.match.intermission && isRightMouseDown() && !buyMenuOpen);
        if ((!net.match.buyPhase || !player.alive) && buyMenuOpen) {
            setBuyMenuOpen(false);
        }

        updatePlayer(player, dt, keys, movementAllowed);
        camera.position = player.pos;

        syncLocalWeaponState();
        const moving = movementAllowed && (keys.forward || keys.backward || keys.left || keys.right);
        updateWeapon(weapon, dt, moving);
        const recoilDelta = consumeRecoilDelta(weapon);
        camera.pitch = clamp(camera.pitch + recoilDelta.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
        camera.yaw += recoilDelta.yaw;
        const adsFovMultiplier = player.aiming ? (WEAPON_DEFS[player.activeWeapon]?.adsFovMultiplier || 1) : 1;
        approachCameraFov(camera, DEFAULT_FOV * adsFovMultiplier, dt);
        updateCamera(camera, 0, 0, canvas.width / canvas.height);

        const selectedWeapon = player.activeWeapon;
        const canAttack = gameplayInputEnabled
            && player.alive
            && !net.match.buyPhase
            && !net.match.intermission
            && canAttackWithWeapon(player, selectedWeapon);
        const heavyKnifeAttack = selectedWeapon === WEAPON_KNIFE && gameplayInputEnabled && isRightMouseDown();
        const primaryAttack = gameplayInputEnabled && isMouseDown();
        const attackPressed = heavyKnifeAttack || primaryAttack;

        if (attackPressed && canAttack && canFire(weapon)) {
            const dir = lookDirFromYawPitch(camera.yaw, camera.pitch);
            if (isUtilityWeapon(selectedWeapon)) {
                fire(weapon);
                sendThrow(net, dir, selectedWeapon);
            } else if (spendWeaponAmmo(player, selectedWeapon)) {
                fire(weapon, player.aiming, heavyKnifeAttack);
                sendShoot(net, dir, selectedWeapon, player.aiming, heavyKnifeAttack);
            }
        }

        sendTimer -= dt;
        if (sendTimer <= 0 && net.connected) {
            sendInput(net, player.pos, camera.yaw, camera.pitch, player.crouching);
            sendTimer = SEND_RATE;
        }
    } else {
        setAiming(player, false);
        approachCameraFov(camera, DEFAULT_FOV, dt);
        updateCamera(camera, 0, 0, canvas.width / canvas.height);
    }

    for (let i = localImpactEffects.length - 1; i >= 0; i -= 1) {
        localImpactEffects[i].timeLeftMs = Math.max(0, localImpactEffects[i].timeLeftMs - dt * 1000);
        if (localImpactEffects[i].timeLeftMs <= 0) {
            localImpactEffects.splice(i, 1);
        }
    }

    drawWorld(renderer, camera.viewMatrix, camera.projMatrix);

    if (net.gameStarted) {
        const renderServerTimeMs = estimateServerTime(net, Date.now()) - REMOTE_RENDER_DELAY_MS;
        worldDynamicVerts.length = 0;
        for (const id in net.players) {
            if (Number(id) === net.myId) continue;

            const remote = net.players[id];
            if (!remote.alive) continue;
            const remoteView = sampleRemotePlayer(remote, renderServerTimeMs);
            appendVerts(worldDynamicVerts, buildAvatarVerts(id, remote, remoteView));
        }

        appendVerts(worldDynamicVerts, buildProjectileVerts(net.projectiles));
        mergedEffects.length = 0;
        appendItems(mergedEffects, net.effects);
        appendItems(mergedEffects, localImpactEffects);
        appendVerts(worldDynamicVerts, buildEffectVerts(mergedEffects));

        if (worldDynamicVerts.length > 0) {
            const mvp = mat4Create();
            mat4Multiply(mvp, camera.projMatrix, camera.viewMatrix);
            drawDynamic(renderer, worldDynamicVerts, mvp);
        }

        if (player.alive) {
            drawDynamic(renderer, weaponVerts(weapon), camera.projMatrix);
        }
    }

    updateHUD(hud, player, {
        visible: gameplayInputEnabled && isKeyDown('Tab') && net.gameStarted,
        players: net.players,
        myId: net.myId,
    }, {
        latencyMs: net.latencyMs,
    }, net.match, {
        buyMenuOpen,
        chatOpen,
        crosshairGap: getCrosshairGap(
            weapon,
            player.aiming,
            player.crouching,
            canMove(player, net.match) && (
                isKeyDown('KeyW')
                || isKeyDown('KeyA')
                || isKeyDown('KeyS')
                || isKeyDown('KeyD')
            )
        ),
    });
}

function appendVerts(target, source) {
    for (let i = 0; i < source.length; i += 1) {
        target.push(source[i]);
    }
}

function appendItems(target, source) {
    for (let i = 0; i < source.length; i += 1) {
        target.push(source[i]);
    }
}

requestAnimationFrame(frame);
