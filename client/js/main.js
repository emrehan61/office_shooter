import { createRenderer, uploadWorldGeo, render, resizeRenderer, updateCamera as updateRendererCamera, clearDynamic, clearWeapon, updateVertPool } from './renderer.js';
import { DEFAULT_FOV, approachCameraFov, createCamera, updateCamera } from './camera.js';
import { init, consumeMouse, isKeyDown, isMouseDown, isRightMouseDown, isLocked, setPointerLockEnabled } from './input.js';
import { buildWorldGeometry, traceShotImpact, loadMap } from './world.js';
import {
    applyAuthoritativeState,
    canMove,
    canAttackWithWeapon,
    canOpenBuyMenu,
    canReloadWeapon,
    createPlayer,
    cycleActiveUtility,
    hasWeapon,
    hasSpawnProtection,
    playerJump,
    resetCombatState,
    resetMatchState,
    setAiming,
    setActiveWeapon,
    startReload,
    spendWeaponAmmo,
    updatePlayer,
} from './player.js';
import { canFire, consumeRecoilDelta, createWeapon, fire, getCrosshairGap, getCrosshairOffsetY, getViewPunch, setWeaponReloadTime, setWeaponType, updateWeapon, weaponVerts } from './weapon.js';
import { addKill, createHUD, showDamageFlash, showEconomyNotice, showHitMarker, updateHUD } from './hud.js';
import { connect, createNet, estimateServerTime, sampleRemotePlayer, sendBuy, sendChat, sendInput, sendLeaveMatch, sendMap, sendMode, sendReload, sendRejoin, sendShoot, sendStart, sendSwitchWeapon, sendTeam, sendThrow } from './net.js';
import { createAvatarPool, updateAvatarPool, hideAvatarPool, createObjectivesPool, updateObjectivesPool } from './avatar.js';
import { buildHttpURL, buildWebSocketURL, getDefaultServerAddress } from './config.js';
import { clamp, lookDirFromYawPitch } from './math.js';
import { WEAPON_DEFS, WEAPON_KNIFE, getWeaponSwitchByCode, isScopedWeapon, isUtilityWeapon } from './economy.js';
import { buildEffectVerts, buildProjectileVerts } from './projectiles.js';
import { TEAM_BLUE, TEAM_GREEN, TEAM_NONE, canSelectTeam, getTeamCounts, getTeamLabel, getTeamStartState, normalizeTeam } from './teams.js';
import { MODE_CTF, MODE_DEATHMATCH, MODE_HOSTAGE, MODE_TEAM, getCTFStartState, getDeathmatchStartState, getHostageStartState, getModeLabel, normalizeMode } from './modes.js';
import {
    createAnnouncer,
    createKillAnnouncerState,
    getAnnouncerKillCues,
    getAnnouncerMatchCues,
    playAnnouncerCue,
    primeAnnouncer,
    snapshotMatchForAnnouncer,
} from './audio.js';
import { createSoundEngine, updateSoundListener, soundGunshot, soundFootstep, soundHitMarker, soundImpact, primeSoundEngine } from './sound.js';
import * as THREE from 'three';

const SEND_RATE = 1 / 60;
const REMOTE_RENDER_DELAY_MS = 100;
const DEATHMATCH_RESPAWN_DELAY_S = 3;
const CHAT_HISTORY_LIMIT = 8;
const CHAT_MESSAGE_LIFETIME_MS = 8000;

let lastTime = 0;
let sendTimer = 0;
let buyMenuOpen = false;
let pauseMenuOpen = false;
let chatOpen = false;
let restorePointerLockAfterChat = false;
let lastClosedVisibleChatCount = 0;
let disconnectMessageOverride = '';
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

const soundEngine = createSoundEngine();
const activeTracers = [];
const MAX_TRACERS = 32;
const TRACER_LIFE_MS = 100;
const objectiveScreenVec = new THREE.Vector3();
const objectiveForwardVec = new THREE.Vector3();
const objectiveTargetVec = new THREE.Vector3();

window._cam = camera;
init(canvas);

// Muzzle flash dynamic point light (reusable, intensity toggled)
const muzzleFlashLight = new THREE.PointLight(0xffe080, 0, 8, 2);
muzzleFlashLight.castShadow = false;
renderer.weaponGroup.add(muzzleFlashLight);

// Pre-allocated tracer pool — avoids per-frame geometry/material allocation
const tracerGroup = new THREE.Group();
tracerGroup.name = 'tracers';
renderer.scene.add(tracerGroup);
const _tracerGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 4, 1);
const _tracerUp = new THREE.Vector3(0, 1, 0);
const _tracerDir = new THREE.Vector3();
const _tracerQuat = new THREE.Quaternion();
const tracerMeshPool = [];
for (let i = 0; i < MAX_TRACERS; i++) {
    const mat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffe080,
        emissiveIntensity: 4.0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(_tracerGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    tracerGroup.add(mesh);
    tracerMeshPool.push({ mesh, material: mat });
}

// Pre-allocated avatar mesh pool (GPU transforms instead of CPU vertex math)
const avatarPool = createAvatarPool(renderer.scene);
const objectivesPool = createObjectivesPool(renderer.scene);

// Pre-allocated remote muzzle flash light pool (avoids per-frame PointLight allocation)
const REMOTE_FLASH_POOL_SIZE = 6;
const remoteFlashPool = [];
for (let i = 0; i < REMOTE_FLASH_POOL_SIZE; i++) {
    const light = new THREE.PointLight(0xffe080, 0, 6, 2);
    light.castShadow = false;
    light.visible = false;
    renderer.scene.add(light);
    remoteFlashPool.push(light);
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    resizeRenderer(renderer, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

let currentMapName = 'office_studio';

const loadingScreen = document.getElementById('loading-screen');

async function loadMapByName(name) {
    const resp = await fetch(`maps/${name}.json?v=${Date.now()}`);
    if (!resp.ok) return false;
    const data = await resp.json();
    loadMap(data);

    // Show loading screen and yield a frame so the browser paints it
    // before the synchronous buildWorldGeometry() blocks the main thread.
    if (loadingScreen) loadingScreen.style.display = 'flex';
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const geo = buildWorldGeometry();
    uploadWorldGeo(renderer, geo);
    currentMapName = name;

    if (loadingScreen) loadingScreen.style.display = 'none';
    return true;
}

await loadMapByName(currentMapName);

function warmAudio() {
    void primeAnnouncer(announcer);
    primeSoundEngine();
}

window.addEventListener('pointerdown', warmAudio, { once: true });
window.addEventListener('keydown', warmAudio, { once: true });

const serverInput = document.getElementById('server-input');
const nameInput = document.getElementById('name-input');
const connectBtn = document.getElementById('connect-btn');
const createLobbyNameInput = document.getElementById('create-lobby-name-input');
const createLobbyBtn = document.getElementById('create-lobby-btn');
const createLobbyStatus = document.getElementById('create-lobby-status');
const privateLobbyToggle = document.getElementById('private-lobby-toggle');
const publicLobbyStatus = document.getElementById('public-lobby-status');
const publicLobbyList = document.getElementById('public-lobby-list');
const joinKeyInput = document.getElementById('join-key-input');
const joinKeyBtn = document.getElementById('join-key-btn');
const joinKeyStatus = document.getElementById('join-key-status');
const lobbyPanel = document.getElementById('lobby-panel');
const lobbyForm = document.querySelector('.lobby-form');
const currentLobbyName = document.getElementById('current-lobby-name');
const currentLobbyAccess = document.getElementById('current-lobby-access');
const lobbyStatus = document.getElementById('lobby-status');
const playerList = document.getElementById('player-list');
const startBtn = document.getElementById('start-btn');
const teamSelect = document.getElementById('team-select');
const teamBlueBtn = document.getElementById('team-blue-btn');
const teamGreenBtn = document.getElementById('team-green-btn');
const teamHint = document.getElementById('team-hint');
const chatPanel = document.getElementById('chat-panel');
const chatFeed = document.getElementById('chat-feed');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const modeTeamBtn = document.getElementById('mode-team-btn');
const modeDeathmatchBtn = document.getElementById('mode-deathmatch-btn');
const modeHostageBtn = document.getElementById('mode-hostage-btn');
const modeCtfBtn = document.getElementById('mode-ctf-btn');
const rejoinPrompt = document.getElementById('rejoin-prompt');
const rejoinCopy = document.getElementById('rejoin-copy');
const rejoinYesBtn = document.getElementById('rejoin-yes-btn');
const rejoinNoBtn = document.getElementById('rejoin-no-btn');
const mapDropdown = document.getElementById('map-dropdown');
const mapSelect = document.getElementById('map-select');
const pauseMenu = document.getElementById('pause-menu');
const pauseCopy = document.getElementById('pause-copy');
const resumeMatchBtn = document.getElementById('resume-match-btn');
const leaveMatchBtn = document.getElementById('leave-match-btn');
let rejoinVoteChoice = null;
let availableMaps = [];

function getSelfLobbyPlayer() {
    if (net.myId == null) return null;
    return net.players[String(net.myId)] || null;
}

function isDeathmatchMode() {
    return normalizeMode(net.match.mode) === MODE_DEATHMATCH;
}

function isLocalInMatch() {
    return net.gameStarted && !!player.inMatch;
}

function getLobbyStartState() {
    const mode = normalizeMode(net.match.mode);
    if (mode === MODE_DEATHMATCH) return getDeathmatchStartState(net.players);
    if (mode === MODE_HOSTAGE) return getHostageStartState(net.players);
    if (mode === MODE_CTF) return getCTFStartState(net.players);
    return getTeamStartState(net.players);
}

function buildObjectiveMarkers() {
    if (!isLocalInMatch() || !player.alive) return [];

    const markers = [];
    const carriedHostage = (net.match.hostages || []).find((h) => h.followerId === net.myId && h.alive && !h.rescued);
    if (carriedHostage && Array.isArray(net.match.rescueZones) && net.match.rescueZones.length > 0) {
        const zone = net.match.rescueZones.reduce((best, current) => {
            if (!best) return current;
            const bestDist = (best.cx - player.pos[0]) ** 2 + (best.cz - player.pos[2]) ** 2;
            const currentDist = (current.cx - player.pos[0]) ** 2 + (current.cz - player.pos[2]) ** 2;
            return currentDist < bestDist ? current : best;
        }, null);
        if (zone) {
            markers.push(projectObjectiveMarker([zone.cx, 1.7, zone.cz], 'RESCUE HOSTAGE', '#64f0a0'));
        }
    }

    const carriedFlag = (net.match.flags || []).find((f) => f.carrierId === net.myId);
    if (carriedFlag) {
        const ownBase = (net.match.flags || []).find((f) => f.team === player.team);
        const home = ownBase?.homePos || ownBase?.pos;
        if (Array.isArray(home)) {
            markers.push(projectObjectiveMarker(home, 'CAPTURE FLAG', player.team === TEAM_BLUE ? '#7ab6ff' : '#7df2a2'));
        }
    }

    return markers.filter(Boolean);
}

function projectObjectiveMarker(target, label, color) {
    objectiveTargetVec.set(target[0], target[1], target[2]).sub(renderer.camera.position);
    renderer.camera.getWorldDirection(objectiveForwardVec);

    objectiveScreenVec.set(target[0], target[1], target[2]).project(renderer.camera);

    const width = canvas.width;
    const height = canvas.height;
    const margin = 42;
    let x = (objectiveScreenVec.x * 0.5 + 0.5) * width;
    let y = (-objectiveScreenVec.y * 0.5 + 0.5) * height;

    const behind = objectiveTargetVec.dot(objectiveForwardVec) <= 0;
    if (behind) {
        x = width * 0.5;
        y = 90;
    }

    x = Math.max(margin, Math.min(width - margin, x));
    y = Math.max(90, Math.min(height - margin, y));

    return { visible: true, x, y, label, color };
}

function getServerAddress() {
    return (serverInput ? serverInput.value.trim() : '') || getDefaultServerAddress(window.location);
}

function getPlayerName() {
    return (nameInput ? nameInput.value.trim() : '') || 'Player';
}

function buildApiURL(path) {
    return buildHttpURL(getServerAddress(), path, window.location);
}

function setCreateLobbyStatus(text) {
    if (createLobbyStatus) createLobbyStatus.textContent = text;
}

function setJoinKeyStatus(text) {
    if (joinKeyStatus) joinKeyStatus.textContent = text;
}

function setPublicLobbyStatus(text) {
    if (publicLobbyStatus) publicLobbyStatus.textContent = text;
}

function updateLobbyMeta() {
    if (currentLobbyName) {
        currentLobbyName.textContent = net.lobby?.name || 'Lobby';
    }
    if (currentLobbyAccess) {
        if (!net.lobby) {
            currentLobbyAccess.textContent = '';
            return;
        }
        currentLobbyAccess.textContent = net.lobby.private
            ? `PRIVATE KEY ${net.lobby.joinKey || 'HIDDEN'}`
            : `PUBLIC LOBBY ${net.lobby.id || ''}`.trim();
    }
}

function renderPublicLobbies(lobbies = []) {
    if (!publicLobbyList) return;
    publicLobbyList.replaceChildren();

    if (!Array.isArray(lobbies) || lobbies.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'home-status';
        empty.textContent = 'No public lobbies are open yet.';
        publicLobbyList.appendChild(empty);
        return;
    }

    for (const lobby of lobbies) {
        const row = document.createElement('div');
        row.className = 'public-lobby-row';

        const copy = document.createElement('div');
        copy.className = 'public-lobby-copy';

        const name = document.createElement('div');
        name.className = 'public-lobby-name';
        name.textContent = lobby.name || lobby.id || 'Lobby';

        const meta = document.createElement('div');
        meta.className = 'public-lobby-meta';
        meta.textContent = `${getModeLabel(lobby.mode)} | ${(lobby.map || 'office_studio').replace(/_/g, ' ')} | ${lobby.playerCount || 0}/${lobby.maxPlayers || 6} PLAYERS | ${(lobby.state || 'waiting').toUpperCase()}`;

        const joinBtn = document.createElement('button');
        joinBtn.textContent = 'Join';
        joinBtn.addEventListener('click', () => {
            void connectToLobby(lobby);
        });

        copy.append(name, meta);
        row.append(copy, joinBtn);
        publicLobbyList.appendChild(row);
    }
}

function setPauseMenuOpen(nextOpen) {
    const allowed = !!nextOpen && isLocalInMatch();
    pauseMenuOpen = allowed;
    if (pauseMenu) {
        pauseMenu.style.display = pauseMenuOpen ? 'flex' : 'none';
    }
    if (pauseCopy) {
        pauseCopy.textContent = isDeathmatchMode()
            ? 'Leaving a deathmatch returns you to the main menu.'
            : 'Leaving a team match returns you to the lobby while the match continues.';
    }
    syncPointerLockAvailability();

    if (pauseMenuOpen && document.pointerLockElement === canvas && document.exitPointerLock) {
        document.exitPointerLock();
        return;
    }

    if (!pauseMenuOpen && isLocalInMatch() && !buyMenuOpen && !chatOpen && canvas.requestPointerLock) {
        try {
            canvas.requestPointerLock();
        } catch {
            // Ignore browsers that reject keyboard-triggered pointer lock restores.
        }
    }
}

function returnToMenu(message = 'Returned to menu') {
    disconnectMessageOverride = message;
    setPauseMenuOpen(false);
    setBuyMenuOpen(false);
    if (net.ws && (net.ws.readyState === WebSocket.CONNECTING || net.ws.readyState === WebSocket.OPEN)) {
        try {
            net.ws.close(1000, message);
            return;
        } catch {
            // Fall through to local reset if close fails synchronously.
        }
    }

    disconnectMessageOverride = '';
    resetAfterDisconnect(message);
    void fetchPublicLobbies();
}

function leaveCurrentMatch() {
    if (!isLocalInMatch()) return;
    if (isDeathmatchMode()) {
        returnToMenu('Returned to menu');
        return;
    }

    setPauseMenuOpen(false);
    setLobbyStatus('Returning to lobby...');
    sendLeaveMatch(net);
}

function updateRejoinPrompt() {
    const active = !!net.match.deathmatchVoteActive && !!player.inMatch && !player.isBot;
    if (!active) {
        rejoinVoteChoice = null;
        if (rejoinPrompt) rejoinPrompt.style.display = 'none';
        return;
    }

    if (rejoinPrompt) rejoinPrompt.style.display = 'block';
    if (rejoinCopy) {
        rejoinCopy.textContent = rejoinVoteChoice == null
            ? 'Play another 10-minute deathmatch?'
            : (rejoinVoteChoice ? 'You will join the next match automatically.' : 'You will return to the main menu.');
    }
    if (rejoinYesBtn) {
        rejoinYesBtn.disabled = rejoinVoteChoice === true;
        rejoinYesBtn.classList.toggle('is-active', rejoinVoteChoice === true);
    }
    if (rejoinNoBtn) {
        rejoinNoBtn.disabled = rejoinVoteChoice === false;
        rejoinNoBtn.classList.toggle('is-active', rejoinVoteChoice === false);
    }
}

async function fetchMapList() {
    try {
        const resp = await fetch(buildApiURL('/api/maps'));
        if (resp.ok) availableMaps = await resp.json();
    } catch { /* offline / no server */ }
    populateMapDropdown();
}

async function fetchPublicLobbies() {
    setPublicLobbyStatus('Loading public lobbies...');

    try {
        const resp = await fetch(buildApiURL('/api/lobbies'), {
            cache: 'no-store',
        });
        if (!resp.ok) {
            throw new Error('Could not load public lobbies');
        }
        const lobbies = await resp.json();
        renderPublicLobbies(lobbies);
        setPublicLobbyStatus(Array.isArray(lobbies) && lobbies.length > 0
            ? 'Select a lobby to join.'
            : 'No public lobbies are open yet.');
    } catch (err) {
        renderPublicLobbies([]);
        setPublicLobbyStatus(err.message || 'Could not load public lobbies');
    }
}

async function connectToLobby(lobby) {
    const name = getPlayerName();
    const server = getServerAddress();
    const url = buildWebSocketURL(server, window.location, lobby.id);

    warmAudio();
    if (connectBtn) connectBtn.disabled = true;
    if (createLobbyBtn) createLobbyBtn.disabled = true;
    if (joinKeyBtn) joinKeyBtn.disabled = true;
    setLobbyStatus('Connecting...');

    try {
        const msg = await connect(net, url, name, {
            id: lobby.id,
            name: lobby.name || 'Lobby',
            private: !!lobby.private,
            joinKey: lobby.joinKey || '',
        });
        resetMatchState(player);
        applyAuthoritativeState(player, msg);
        syncLocalWeaponState();
        camera.position = player.pos;
        clearChat();
        await fetchMapList();
        await syncMapIfNeeded();
        showLobbyPanel();
        updateLobbyMeta();
        populatePlayerList();
        setLobbyStatus(net.gameStarted
            ? (player.inMatch ? 'Match in progress' : `${getModeLabel(net.match.mode)} in progress`)
            : `Connected to ${net.lobby?.name || `${getModeLabel(net.match.mode)} lobby`}`);
        lastAnnouncerMatch = snapshotMatchForAnnouncer(net.match);
        killAnnouncerState = createKillAnnouncerState(net.match.currentRound || 0);
        setCreateLobbyStatus(net.lobby?.private && net.lobby?.joinKey
            ? `Private key: ${net.lobby.joinKey}`
            : 'Create a public lobby or generate a private join key.');
        setJoinKeyStatus('Use a 6-character private lobby key.');
    } catch (err) {
        resetAfterDisconnect(err.message || 'Connection failed');
    } finally {
        if (connectBtn) connectBtn.disabled = false;
        if (createLobbyBtn) createLobbyBtn.disabled = false;
        if (joinKeyBtn) joinKeyBtn.disabled = false;
    }
}

function populateMapDropdown() {
    if (!mapDropdown) return;
    const current = net.match.map || currentMapName;
    mapDropdown.innerHTML = '';
    for (const name of availableMaps) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name.replace(/_/g, ' ');
        if (name === current) opt.selected = true;
        mapDropdown.appendChild(opt);
    }
}

function updateMapControls() {
    if (!mapDropdown) return;
    const current = net.match.map || currentMapName;
    mapDropdown.value = current;
    mapDropdown.disabled = !net.connected || net.gameStarted;
    if (mapSelect) mapSelect.style.display = net.gameStarted ? 'none' : '';
}

if (mapDropdown) {
    mapDropdown.addEventListener('change', () => {
        const name = mapDropdown.value;
        if (name && name !== net.match.map) {
            sendMap(net, name);
        }
    });
}

async function syncMapIfNeeded() {
    const serverMap = net.match.map;
    if (serverMap && serverMap !== currentMapName) {
        await loadMapByName(serverMap);
    }
}

function updateTeamControls() {
    const mode = normalizeMode(net.match.mode);
    const counts = getTeamCounts(net.players);
    const startState = getLobbyStartState();
    const myTeam = normalizeTeam(getSelfLobbyPlayer()?.team);
    const buttonDefs = [
        { el: teamBlueBtn, team: TEAM_BLUE, count: counts.blue },
        { el: teamGreenBtn, team: TEAM_GREEN, count: counts.green },
    ];

    if (modeTeamBtn) {
        modeTeamBtn.classList.toggle('is-active', mode === MODE_TEAM);
        modeTeamBtn.disabled = !net.connected || net.gameStarted || !!net.match.deathmatchVoteActive;
    }
    if (modeDeathmatchBtn) {
        modeDeathmatchBtn.classList.toggle('is-active', mode === MODE_DEATHMATCH);
        modeDeathmatchBtn.disabled = !net.connected || net.gameStarted || !!net.match.deathmatchVoteActive;
    }
    if (modeHostageBtn) {
        modeHostageBtn.classList.toggle('is-active', mode === MODE_HOSTAGE);
        modeHostageBtn.disabled = !net.connected || net.gameStarted || !!net.match.deathmatchVoteActive;
    }
    if (modeCtfBtn) {
        modeCtfBtn.classList.toggle('is-active', mode === MODE_CTF);
        modeCtfBtn.disabled = !net.connected || net.gameStarted || !!net.match.deathmatchVoteActive;
    }
    if (teamSelect) {
        teamSelect.style.display = mode !== MODE_DEATHMATCH ? 'block' : 'none';
    }

    for (const entry of buttonDefs) {
        if (!entry.el) continue;
        entry.el.textContent = `${getTeamLabel(entry.team).toUpperCase()} TEAM (${entry.count})`;
        entry.el.classList.toggle('is-active', myTeam === entry.team);
        entry.el.disabled = mode === MODE_DEATHMATCH
            || !net.connected
            || net.gameStarted
            || (!canSelectTeam(net.players, net.myId, entry.team) && myTeam !== entry.team);
    }

    if (teamHint) {
        if (!net.connected) {
            teamHint.textContent = 'Connect first.';
        } else if (net.match.deathmatchVoteActive) {
            teamHint.textContent = 'Replay vote in progress.';
        } else if (mode === MODE_DEATHMATCH) {
            teamHint.textContent = startState.ok
                ? 'Free-for-all. Solo players get one bot. Match lasts 10:00.'
                : `${startState.reason}.`;
        } else if (mode === MODE_CTF) {
            teamHint.textContent = startState.ok
                ? 'Capture the Enemy Flag. Match lasts 10:00.'
                : `${startState.reason}.`;
        } else if (mode === MODE_HOSTAGE) {
            teamHint.textContent = startState.ok
                ? 'Blue rescues, Green defends. Map specific objective.'
                : `${startState.reason}.`;
        } else if (net.gameStarted) {
            teamHint.textContent = 'Match already in progress.';
        } else if (startState.ok) {
            teamHint.textContent = 'Teams are balanced. Ready to start.';
        } else {
            teamHint.textContent = `${startState.reason}.`;
        }
    }

    if (startBtn) {
        startBtn.textContent = (mode === MODE_DEATHMATCH || mode === MODE_CTF) ? 'Start Match' : 'Start Game';
        startBtn.disabled = !net.connected || net.gameStarted || !!net.match.deathmatchVoteActive || !startState.ok;
        startBtn.title = startState.ok ? '' : startState.reason;
    }

    updateRejoinPrompt();
    updateMapControls();
    updateLobbyMeta();
}

function setBuyMenuOpen(nextOpen) {
    const allowed = nextOpen && isLocalInMatch() && canOpenBuyMenu(player, net.match);
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
    setPointerLockEnabled(!buyMenuOpen && !chatOpen && !pauseMenuOpen);
}

function requestPointerLockIfNeeded() {
    if (!restorePointerLockAfterChat || buyMenuOpen || pauseMenuOpen || !net.gameStarted || !player.alive || !canvas.requestPointerLock) {
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
void fetchPublicLobbies();

function populatePlayerList() {
    if (!playerList) return;

    playerList.innerHTML = '';
    const ids = Object.keys(net.players).sort((a, b) => {
        if (isDeathmatchMode()) {
            const left = net.players[a] || {};
            const right = net.players[b] || {};
            if (!!left.inMatch !== !!right.inMatch) return Number(right.inMatch) - Number(left.inMatch);
            if (!!left.isBot !== !!right.isBot) return Number(left.isBot) - Number(right.isBot);
            if ((right.kills || 0) !== (left.kills || 0)) return (right.kills || 0) - (left.kills || 0);
            if ((left.deaths || 0) !== (right.deaths || 0)) return (left.deaths || 0) - (right.deaths || 0);
            return Number(a) - Number(b);
        }
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
        row.classList.toggle('is-spectating', net.gameStarted && !entry.inMatch);
        const isSelf = Number(id) === net.myId;
        const badge = document.createElement('span');
        badge.className = `player-team-badge team-${team || 'none'}`;
        if (isDeathmatchMode()) {
            badge.classList.toggle('is-bot', !!entry.isBot);
            badge.textContent = entry.isBot ? 'BOT' : (entry.inMatch ? 'FFA' : 'LOBBY');
        } else {
            badge.textContent = getTeamLabel(team).toUpperCase();
        }

        const label = document.createElement('span');
        const baseLabel = isSelf ? `${entry.name || 'You'} (You)` : (entry.name || '???');
        label.textContent = net.gameStarted && !entry.inMatch ? `${baseLabel} [LOBBY]` : baseLabel;

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
    setWeaponType(weapon, player.activeWeapon);
    setWeaponReloadTime(weapon, player.reloadTimeLeftMs);
}

function resetAfterDisconnect(message) {
    resetMatchState(player);
    player.team = TEAM_NONE;
    player.inMatch = true;
    player.isBot = false;
    rejoinVoteChoice = null;
    syncLocalWeaponState();
    sendTimer = 0;
    setBuyMenuOpen(false);
    setPauseMenuOpen(false);
    setChatOpen(false);
    clearChat();
    camera.fov = DEFAULT_FOV;
    localImpactEffects.length = 0;
    lastAnnouncerMatch = null;
    killAnnouncerState = createKillAnnouncerState();

    if (hud.overlay) hud.overlay.style.display = 'flex';
    showConnectForm();
    setLobbyStatus(message || 'Disconnected from server');
    updateLobbyMeta();
    populatePlayerList();
}

function syncAnnouncer(match) {
    if (!player.inMatch) {
        lastAnnouncerMatch = snapshotMatchForAnnouncer(match);
        return;
    }
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
    connectBtn.addEventListener('click', () => {
        void fetchPublicLobbies();
    });
}

if (createLobbyBtn) {
    createLobbyBtn.addEventListener('click', async () => {
        setCreateLobbyStatus('Creating lobby...');
        try {
            const resp = await fetch(buildApiURL('/api/lobbies'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: createLobbyNameInput ? createLobbyNameInput.value.trim() : '',
                    private: !!privateLobbyToggle?.checked,
                }),
            });
            if (!resp.ok) {
                throw new Error('Could not create lobby');
            }
            const lobby = await resp.json();
            setCreateLobbyStatus(lobby.private && lobby.joinKey
                ? `Private key: ${lobby.joinKey}`
                : 'Public lobby created.');
            await connectToLobby(lobby);
        } catch (err) {
            setCreateLobbyStatus(err.message || 'Could not create lobby');
        }
    });
}

if (joinKeyBtn) {
    joinKeyBtn.addEventListener('click', async () => {
        setJoinKeyStatus('Resolving private lobby...');
        try {
            const resp = await fetch(buildApiURL('/api/lobbies/join-key'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: (joinKeyInput ? joinKeyInput.value : '').trim().toUpperCase(),
                }),
            });
            if (!resp.ok) {
                throw new Error('Private lobby not found');
            }
            const lobby = await resp.json();
            setJoinKeyStatus(`Joining ${lobby.name || 'private lobby'}...`);
            await connectToLobby(lobby);
        } catch (err) {
            setJoinKeyStatus(err.message || 'Private lobby not found');
        }
    });
}

net.onLobby = (msg) => {
    syncMapIfNeeded();
    populatePlayerList();
    if (net.match.deathmatchVoteActive && player.inMatch) {
        setBuyMenuOpen(false);
        setPauseMenuOpen(false);
        if (hud.overlay) hud.overlay.style.display = 'flex';
        showLobbyPanel();
        setLobbyStatus('Time expired. Vote to play again.');
    } else if (msg.state === 'playing') {
        if (player.inMatch) {
            setLobbyStatus(isDeathmatchMode()
                ? 'Deathmatch live'
                : `Round ${net.match.currentRound}/${net.match.totalRounds}`);
        } else {
            setPauseMenuOpen(false);
            if (hud.overlay) hud.overlay.style.display = 'flex';
            showLobbyPanel();
            setLobbyStatus(`${getModeLabel(net.match.mode)} in progress. Waiting for the next match.`);
        }
    } else {
        setBuyMenuOpen(false);
        setPauseMenuOpen(false);
        if (hud.overlay) hud.overlay.style.display = 'flex';
        showLobbyPanel();
        setLobbyStatus(net.match.currentRound === 0
            ? `Connected to ${net.lobby?.name || `${getModeLabel(net.match.mode)} lobby`}`
            : 'Match finished');
    }
    updateTeamControls();
};

net.onTeam = (msg) => {
    if (msg.ok === false) {
        setLobbyStatus(msg.reason || 'Team selection failed');
        updateTeamControls();
        return;
    }
    setLobbyStatus(`${getTeamLabel(msg.team).toUpperCase()} team selected`);
};

net.onMode = (msg) => {
    if (msg.ok === false) {
        setLobbyStatus(msg.reason || 'Mode selection failed');
        updateTeamControls();
        return;
    }
    setLobbyStatus(`${getModeLabel(msg.mode)} mode selected`);
    populatePlayerList();
};

net.onMap = (msg) => {
    if (msg.ok === false) {
        setLobbyStatus(msg.reason || 'Map change failed');
        updateMapControls();
        return;
    }
    setLobbyStatus(`Map: ${(msg.map || '').replace(/_/g, ' ')}`);
    syncMapIfNeeded();
    updateMapControls();
};

net.onRejoin = (msg) => {
    if (msg.ok === false) {
        setLobbyStatus(msg.reason || 'Replay vote failed');
        updateTeamControls();
        return;
    }
    rejoinVoteChoice = !!msg.yes;
    setLobbyStatus(msg.yes ? 'Queued for the next deathmatch.' : 'Returning to menu...');
    updateRejoinPrompt();
    if (!msg.yes && isDeathmatchMode()) {
        returnToMenu('Returned to menu');
    }
};

net.onStartDenied = (msg) => {
    setLobbyStatus(msg.reason || 'Cannot start match');
    updateTeamControls();
};

if (startBtn) {
    startBtn.addEventListener('click', () => {
        const startState = getLobbyStartState();
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

if (modeTeamBtn) {
    modeTeamBtn.addEventListener('click', () => {
        sendMode(net, MODE_TEAM);
    });
}

if (modeDeathmatchBtn) {
    modeDeathmatchBtn.addEventListener('click', () => {
        sendMode(net, MODE_DEATHMATCH);
    });
}

if (modeHostageBtn) {
    modeHostageBtn.addEventListener('click', () => {
        sendMode(net, MODE_HOSTAGE);
    });
}

if (modeCtfBtn) {
    modeCtfBtn.addEventListener('click', () => {
        sendMode(net, MODE_CTF);
    });
}

if (teamBlueBtn) {
    teamBlueBtn.addEventListener('click', () => {
        if (isDeathmatchMode()) return;
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
        if (isDeathmatchMode()) return;
        if (!canSelectTeam(net.players, net.myId, TEAM_GREEN)) {
            setLobbyStatus('Green team would break balance');
            updateTeamControls();
            return;
        }
        sendTeam(net, TEAM_GREEN);
    });
}

if (rejoinYesBtn) {
    rejoinYesBtn.addEventListener('click', () => {
        sendRejoin(net, true);
    });
}

if (rejoinNoBtn) {
    rejoinNoBtn.addEventListener('click', () => {
        sendRejoin(net, false);
    });
}

if (resumeMatchBtn) {
    resumeMatchBtn.addEventListener('click', () => {
        setPauseMenuOpen(false);
    });
}

if (leaveMatchBtn) {
    leaveMatchBtn.addEventListener('click', () => {
        leaveCurrentMatch();
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

    if (e.code === 'Escape' && pauseMenuOpen) {
        e.preventDefault();
        setPauseMenuOpen(false);
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
    const localInMatch = isLocalInMatch();
    if (e.code === 'Escape' && buyMenuOpen) {
        e.preventDefault();
        setBuyMenuOpen(false);
        return;
    }

    if (e.code === 'Escape' && localInMatch) {
        e.preventDefault();
        setPauseMenuOpen(true);
        return;
    }

    if (e.code === 'KeyB') {
        if (localInMatch && canOpenBuyMenu(player, net.match)) {
            e.preventDefault();
            setBuyMenuOpen(true);
        }
        return;
    }

    if (buyMenuOpen || pauseMenuOpen) {
        if (e.code.startsWith('Digit')) {
            e.preventDefault();
        }
        return;
    }

    if (!localInMatch) {
        return;
    }

    if (e.code === 'Space' && canMove(player, net.match)) playerJump(player);
    if (e.code === 'Tab' && localInMatch) e.preventDefault();
    if (e.code === 'KeyR' && localInMatch && player.alive) {
        e.preventDefault();
        if (canReloadWeapon(player)) {
            startReload(player, WEAPON_DEFS[player.activeWeapon]?.reloadMs || 0);
            syncLocalWeaponState();
            sendReload(net);
        }
        return;
    }

    const switchWeapon = getWeaponSwitchByCode(e.code, player);
    if (switchWeapon) {
        e.preventDefault();
        if (player.reloading) {
            showEconomyNotice(hud, 'ACTION RELOADING');
            return;
        }
        if (hasWeapon(player, switchWeapon)) {
            setActiveWeapon(player, switchWeapon);
            syncLocalWeaponState();
            sendSwitchWeapon(net, switchWeapon);
        } else if (switchWeapon !== WEAPON_KNIFE) {
            const label = WEAPON_DEFS[switchWeapon]?.label || 'WEAPON';
            showEconomyNotice(hud, `${label.toUpperCase()} NOT OWNED`);
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
    if (e.code === 'Tab' && isLocalInMatch()) e.preventDefault();
});

net.onHit = (msg) => {
    if (!player.inMatch) return;
    if (msg.to == net.myId) {
        applyAuthoritativeState(player, {
            hp: msg.hp,
            armor: msg.armor,
            alive: msg.hp > 0,
        });
        if (msg.hp <= 0 && isDeathmatchMode()) {
            player.respawnTimer = DEATHMATCH_RESPAWN_DELAY_S;
        }
        showDamageFlash(hud, msg.zone);
    }
    if (msg.from == net.myId) {
        showHitMarker(hud, msg.zone, msg.dmg);
        soundHitMarker(msg.zone);
    }
};

net.onKill = (msg) => {
    if (!player.inMatch) return;
    const killerName = msg.killer == net.myId ? 'You' : (net.players[msg.killer]?.name || '?');
    const victimName = msg.victim == net.myId ? 'You' : (net.players[msg.victim]?.name || '?');
    addKill(hud, killerName, victimName, msg.weapon);

    const nextKillState = getAnnouncerKillCues(killAnnouncerState, msg, net.myId);
    killAnnouncerState = nextKillState.state;
    for (const cue of nextKillState.cues) {
        playAnnouncerCue(announcer, cue);
    }
};

net.onRespawn = (msg) => {
    if (!player.inMatch) return;
    resetCombatState(player);
    applyAuthoritativeState(player, msg);
    syncLocalWeaponState();
    camera.position = player.pos;
    setBuyMenuOpen(false);
    setPauseMenuOpen(false);
    localImpactEffects.length = 0;
};

net.onRound = () => {
    if (!player.inMatch) return;
    player.vel = [0, 0, 0];
    player.onGround = true;
    player.respawnTimer = 0;
    syncLocalWeaponState();
    camera.position = player.pos;
    setBuyMenuOpen(false);
    setPauseMenuOpen(false);
    localImpactEffects.length = 0;
    killAnnouncerState = createKillAnnouncerState(net.match.currentRound || 0);
    if (hud.overlay) hud.overlay.style.display = 'none';
};

net.onShot = (msg) => {
    if (!player.inMatch) return;
    if (msg.weapon === WEAPON_KNIFE || !Array.isArray(msg.pos) || !Array.isArray(msg.dir)) {
        return;
    }

    const impactPos = traceShotImpact(msg.pos, msg.dir, net.players, msg.id);
    const isLocal = msg.id === net.myId;

    // Impact effect (local player only)
    if (isLocal) {
        localImpactEffects.push({ type: 'impact', pos: impactPos, timeLeftMs: 140 });
        if (localImpactEffects.length > 16) {
            localImpactEffects.splice(0, localImpactEffects.length - 16);
        }
    }

    // Bullet tracer
    if (activeTracers.length < MAX_TRACERS) {
        activeTracers.push({
            start: [msg.pos[0], msg.pos[1], msg.pos[2]],
            end: impactPos,
            age: 0,
            maxAge: TRACER_LIFE_MS,
        });
    }

    // Gunshot sound
    soundGunshot(msg.pos, msg.weapon, isLocal, player.pos);

    // Impact sound
    soundImpact(impactPos, player.pos);
};

net.onSelfState = (state) => {
    applyAuthoritativeState(player, state);
    syncLocalWeaponState();
    updateRejoinPrompt();
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
    const message = disconnectMessageOverride || reason;
    disconnectMessageOverride = '';
    resetAfterDisconnect(message);
    void fetchPublicLobbies();
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

    if (net.match.deathmatchVoteActive && net.match.deathmatchVoteEndsAtClientMs) {
        net.match.deathmatchVoteTimeLeftMs = Math.max(0, net.match.deathmatchVoteEndsAtClientMs - Date.now());
        updateRejoinPrompt();
    }

    const localInMatch = isLocalInMatch();

    if (localInMatch) {
        if (hud.overlay && hud.overlay.style.display !== 'none') {
            hud.overlay.style.display = 'none';
        }
        if (lobbyPanel && lobbyPanel.style.display !== 'none') {
            lobbyPanel.style.display = 'none';
        }
    }

    const gameplayInputEnabled = !chatOpen && !pauseMenuOpen;
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
        isKeyDown('KeyC')
        || isKeyDown('MetaLeft')
        || isKeyDown('MetaRight')
    );

    for (const id in net.players) {
        const remote = net.players[id];
        if (remote.shotTime > 0) {
            remote.shotTime = Math.max(0, remote.shotTime - dt);
        }
    }

    if (localInMatch) {
        const movementAllowed = gameplayInputEnabled && canMove(player, net.match);
        player.crouching = player.alive && crouchPressed;
        const wantsScope = gameplayInputEnabled
            && player.alive
            && !net.match.intermission
            && isRightMouseDown()
            && !buyMenuOpen
            && isScopedWeapon(player.activeWeapon);
        setAiming(player, wantsScope);
        if ((!canOpenBuyMenu(player, net.match) || !player.alive) && buyMenuOpen) {
            setBuyMenuOpen(false);
        }

        updatePlayer(player, dt, keys, movementAllowed);
        camera.position = player.pos;

        syncLocalWeaponState();
        const moving = movementAllowed && (keys.forward || keys.backward || keys.left || keys.right);
        const strafing = movementAllowed && (keys.left || keys.right);
        updateWeapon(weapon, dt, moving, player.crouching);
        // Apply full recoil to camera — shot direction follows camera angles.
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
            && !hasSpawnProtection(player, net.match)
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
                fire(weapon, player.aiming, heavyKnifeAttack, strafing || moving);
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

    // View punch is cosmetic screen shake layered on top of the camera.
    // Aim punch (recoil) is already applied to camera.yaw/pitch above.
    const viewPunch = getViewPunch(weapon);
    const renderPitch = clamp(
        camera.pitch + viewPunch.pitch,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01
    );
    const renderYaw = camera.yaw + viewPunch.yaw;

    // Update Three.js camera from game camera state
    updateRendererCamera(renderer, camera.position, renderYaw, renderPitch, camera.fov);

    // Update sound listener position
    const fwd = lookDirFromYawPitch(renderYaw, renderPitch);
    updateSoundListener(camera.position, fwd);

    // Footsteps for local player
    if (localInMatch && player.alive) {
        const moving = canMove(player, net.match) && (isKeyDown('KeyW') || isKeyDown('KeyA') || isKeyDown('KeyS') || isKeyDown('KeyD'));
        soundFootstep(soundEngine, dt, moving, player.pos, true, player.pos);
    }

    // Clear previous frame's dynamic objects
    clearDynamic(renderer);
    clearWeapon(renderer);

    // Update tracers
    for (let i = activeTracers.length - 1; i >= 0; i--) {
        activeTracers[i].age += dt * 1000;
        if (activeTracers[i].age >= activeTracers[i].maxAge) {
            activeTracers.splice(i, 1);
        }
    }

    // Muzzle flash light
    const slot = weapon.slots[weapon.kind];
    const flashIntensity = slot && slot.flashTime > 0 ? (slot.flashTime / 0.06) : 0;
    muzzleFlashLight.intensity = flashIntensity * 5;
    muzzleFlashLight.position.set(0, 0.02, -0.7);

    // Reset remote flash pool
    let remoteFlashIdx = 0;
    for (let i = 0; i < REMOTE_FLASH_POOL_SIZE; i++) {
        remoteFlashPool[i].visible = false;
        remoteFlashPool[i].intensity = 0;
    }

    if (localInMatch) {
        const renderServerTimeMs = estimateServerTime(net, Date.now()) - REMOTE_RENDER_DELAY_MS;

        // Update avatar mesh pool (GPU transforms — no per-vertex CPU math)
        updateAvatarPool(avatarPool, net.players, net.myId, renderServerTimeMs, sampleRemotePlayer);
        updateObjectivesPool(objectivesPool, net.match);

        // Remote flash lights + footsteps (still need per-player iteration)
        for (const id in net.players) {
            if (Number(id) === net.myId) continue;
            const remote = net.players[id];
            if (!remote.inMatch || !remote.alive) continue;
            const remoteView = sampleRemotePlayer(remote, renderServerTimeMs);

            if (remote.shotTime > 0 && remoteFlashIdx < REMOTE_FLASH_POOL_SIZE) {
                const dx = (remoteView.pos?.[0] ?? 0) - camera.position[0];
                const dz = (remoteView.pos?.[2] ?? 0) - camera.position[2];
                if (dx * dx + dz * dz < 400) {
                    const rFlash = remoteFlashPool[remoteFlashIdx++];
                    rFlash.intensity = remote.shotTime / 0.12 * 3;
                    rFlash.position.set(remoteView.pos?.[0] ?? 0, (remoteView.pos?.[1] ?? 1.7) - 0.3, remoteView.pos?.[2] ?? 0);
                    rFlash.visible = true;
                }
            }

            soundFootstep(soundEngine, dt, remote.alive, remoteView.pos || [0, 0, 0], false, player.pos);
        }

        // Projectiles + effects still go through vertex pool
        worldDynamicVerts.length = 0;
        appendVerts(worldDynamicVerts, buildProjectileVerts(net.projectiles));
        mergedEffects.length = 0;
        appendItems(mergedEffects, net.effects);
        appendItems(mergedEffects, localImpactEffects);
        appendVerts(worldDynamicVerts, buildEffectVerts(mergedEffects));

        updateVertPool(renderer.dynamicVertPool, worldDynamicVerts);

        // Update pre-allocated tracer pool (no per-frame geometry/material allocation)
        let _tracerIdx = 0;
        for (const tracer of activeTracers) {
            if (_tracerIdx >= MAX_TRACERS) break;
            const t = tracer.age / tracer.maxAge;
            const headT = Math.min(1, t * 2.5);
            const tailT = Math.max(0, headT - 0.35);
            const opacity = 1 - t;
            const hx = tracer.start[0] + (tracer.end[0] - tracer.start[0]) * headT;
            const hy = tracer.start[1] + (tracer.end[1] - tracer.start[1]) * headT;
            const hz = tracer.start[2] + (tracer.end[2] - tracer.start[2]) * headT;
            const tx = tracer.start[0] + (tracer.end[0] - tracer.start[0]) * tailT;
            const ty = tracer.start[1] + (tracer.end[1] - tracer.start[1]) * tailT;
            const tz = tracer.start[2] + (tracer.end[2] - tracer.start[2]) * tailT;

            const dx = hx - tx, dy = hy - ty, dz = hz - tz;
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (length < 0.01) continue;

            const pooled = tracerMeshPool[_tracerIdx];
            pooled.mesh.position.set((tx + hx) / 2, (ty + hy) / 2, (tz + hz) / 2);
            pooled.mesh.scale.set(1, length, 1);
            _tracerDir.set(dx, dy, dz).normalize();
            _tracerQuat.setFromUnitVectors(_tracerUp, _tracerDir);
            pooled.mesh.quaternion.copy(_tracerQuat);
            pooled.material.opacity = opacity * 0.9;
            pooled.mesh.visible = true;
            _tracerIdx++;
        }
        for (let i = _tracerIdx; i < MAX_TRACERS; i++) {
            tracerMeshPool[i].mesh.visible = false;
        }

        updateVertPool(renderer.weaponVertPool, player.alive ? weaponVerts(weapon) : []);
    } else {
        hideAvatarPool(avatarPool);
        updateVertPool(renderer.dynamicVertPool, []);
        updateVertPool(renderer.weaponVertPool, []);
        for (let i = 0; i < MAX_TRACERS; i++) {
            tracerMeshPool[i].mesh.visible = false;
        }
    }

    // Update film grain time uniform
    if (renderer.vignettePass) {
        renderer.vignettePass.uniforms.time.value = performance.now() * 0.001;
    }

    render(renderer);

    updateHUD(hud, player, {
        visible: gameplayInputEnabled && isKeyDown('Tab') && localInMatch,
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
        crosshairOffsetY: getCrosshairOffsetY(weapon),
        objectiveMarkers: buildObjectiveMarkers(),
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
