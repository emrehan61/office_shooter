import { createRenderer, uploadWorldGeo, drawWorld, drawDynamic } from './renderer.js';
import { DEFAULT_FOV, approachCameraFov, createCamera, updateCamera } from './camera.js';
import { init, consumeMouse, isKeyDown, isMouseDown, isRightMouseDown } from './input.js';
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
import { connect, createNet, estimateServerTime, sampleRemotePlayer, sendBuy, sendInput, sendMode, sendReload, sendRejoin, sendShoot, sendStart, sendSwitchWeapon, sendTeam, sendThrow } from './net.js';
import { buildAvatarVerts } from './avatar.js';
import { buildWebSocketURL, getDefaultServerAddress } from './config.js';
import { clamp, lookDirFromYawPitch, mat4Create, mat4Multiply } from './math.js';
import { RELOAD_DURATION_MS, WEAPON_DEFS, WEAPON_KNIFE, getRenderableWeapon, getWeaponSwitchByCode, isUtilityWeapon } from './economy.js';
import { buildEffectVerts, buildProjectileVerts } from './projectiles.js';
import { TEAM_BLUE, TEAM_GREEN, TEAM_NONE, canSelectTeam, getTeamCounts, getTeamLabel, getTeamStartState, normalizeTeam } from './teams.js';
import { MODE_DEATHMATCH, MODE_TEAM, getDeathmatchStartState, getModeLabel, normalizeMode } from './modes.js';
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
const DEATHMATCH_RESPAWN_DELAY_S = 3;

let lastTime = 0;
let sendTimer = 0;
let buyMenuOpen = false;
const localImpactEffects = [];
const worldDynamicVerts = [];
const mergedEffects = [];

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
const teamSelect = document.getElementById('team-select');
const teamBlueBtn = document.getElementById('team-blue-btn');
const teamGreenBtn = document.getElementById('team-green-btn');
const teamHint = document.getElementById('team-hint');
const modeTeamBtn = document.getElementById('mode-team-btn');
const modeDeathmatchBtn = document.getElementById('mode-deathmatch-btn');
const rejoinPrompt = document.getElementById('rejoin-prompt');
const rejoinCopy = document.getElementById('rejoin-copy');
const rejoinYesBtn = document.getElementById('rejoin-yes-btn');
const rejoinNoBtn = document.getElementById('rejoin-no-btn');
let rejoinVoteChoice = null;

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
    return isDeathmatchMode()
        ? getDeathmatchStartState(net.players)
        : getTeamStartState(net.players);
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
            : (rejoinVoteChoice ? 'You will join the next match automatically.' : 'You will return to the lobby when the vote ends.');
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
    if (teamSelect) {
        teamSelect.style.display = mode === MODE_TEAM ? 'block' : 'none';
    }

    for (const entry of buttonDefs) {
        if (!entry.el) continue;
        entry.el.textContent = `${getTeamLabel(entry.team).toUpperCase()} TEAM (${entry.count})`;
        entry.el.classList.toggle('is-active', myTeam === entry.team);
        entry.el.disabled = mode !== MODE_TEAM
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
        } else if (net.gameStarted) {
            teamHint.textContent = 'Match already in progress.';
        } else if (startState.ok) {
            teamHint.textContent = 'Teams are balanced. Ready to start.';
        } else {
            teamHint.textContent = `${startState.reason}.`;
        }
    }

    if (startBtn) {
        startBtn.textContent = mode === MODE_DEATHMATCH ? 'Start Deathmatch' : 'Start Game';
        startBtn.disabled = !net.connected || net.gameStarted || !!net.match.deathmatchVoteActive || !startState.ok;
        startBtn.title = startState.ok ? '' : startState.reason;
    }

    updateRejoinPrompt();
}

function setBuyMenuOpen(nextOpen) {
    const allowed = nextOpen && isLocalInMatch() && net.match.buyPhase && player.alive;
    buyMenuOpen = !!allowed;

    if (buyMenuOpen && document.pointerLockElement === canvas && document.exitPointerLock) {
        document.exitPointerLock();
    }
}

if (serverInput) serverInput.value = getDefaultServerAddress(window.location);

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
    setWeaponType(weapon, getRenderableWeapon(player.activeWeapon));
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
            showLobbyPanel();
            populatePlayerList();
            setLobbyStatus(net.gameStarted
                ? (player.inMatch ? 'Match in progress' : `${getModeLabel(net.match.mode)} in progress`)
                : `Connected to ${getModeLabel(net.match.mode)} lobby`);
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
    if (net.match.deathmatchVoteActive && player.inMatch) {
        setBuyMenuOpen(false);
        if (hud.overlay) hud.overlay.style.display = 'flex';
        showLobbyPanel();
        setLobbyStatus('Time expired. Vote to play again.');
    } else if (msg.state === 'playing') {
        if (player.inMatch) {
            setLobbyStatus(isDeathmatchMode()
                ? 'Deathmatch live'
                : `Round ${net.match.currentRound}/${net.match.totalRounds}`);
        } else {
            if (hud.overlay) hud.overlay.style.display = 'flex';
            showLobbyPanel();
            setLobbyStatus(`${getModeLabel(net.match.mode)} in progress. Waiting for the next match.`);
        }
    } else {
        setBuyMenuOpen(false);
        if (hud.overlay) hud.overlay.style.display = 'flex';
        showLobbyPanel();
        setLobbyStatus(net.match.currentRound === 0
            ? `Connected to ${getModeLabel(net.match.mode)} lobby`
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

net.onRejoin = (msg) => {
    if (msg.ok === false) {
        setLobbyStatus(msg.reason || 'Replay vote failed');
        updateTeamControls();
        return;
    }
    rejoinVoteChoice = !!msg.yes;
    setLobbyStatus(msg.yes ? 'Queued for the next deathmatch.' : 'You will return to the lobby.');
    updateRejoinPrompt();
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

window.addEventListener('keydown', (e) => {
    const localInMatch = isLocalInMatch();
    if (e.code === 'Escape' && buyMenuOpen) {
        e.preventDefault();
        setBuyMenuOpen(false);
        return;
    }

    if (e.code === 'KeyB') {
        if (localInMatch && net.match.buyPhase && player.alive) {
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

    if (!localInMatch) {
        return;
    }

    if (e.code === 'Space' && canMove(player, net.match)) playerJump(player);
    if (e.code === 'Tab' && localInMatch) e.preventDefault();
    if (e.code === 'KeyR' && localInMatch && player.alive) {
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
    if (msg.from == net.myId) showHitMarker(hud);
};

net.onKill = (msg) => {
    if (!player.inMatch) return;
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
    if (!player.inMatch) return;
    resetCombatState(player);
    applyAuthoritativeState(player, msg);
    syncLocalWeaponState();
    camera.position = player.pos;
    setBuyMenuOpen(false);
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
    localImpactEffects.length = 0;
    killAnnouncerState = createKillAnnouncerState(net.match.currentRound || 0);
    if (hud.overlay) hud.overlay.style.display = 'none';
};

net.onShot = (msg) => {
    if (!player.inMatch) return;
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
    resetAfterDisconnect(reason);
};

net.onMatch = (match) => {
    syncAnnouncer(match);
};

function frame(time) {
    requestAnimationFrame(frame);

    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

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

    const mouse = consumeMouse();
    updateCamera(camera, mouse.dx, mouse.dy, canvas.width / canvas.height);

    const keys = {
        forward: isKeyDown('KeyW'),
        backward: isKeyDown('KeyS'),
        left: isKeyDown('KeyA'),
        right: isKeyDown('KeyD'),
    };
    const crouchPressed = isKeyDown('ControlLeft')
        || isKeyDown('ControlRight')
        || isKeyDown('MetaLeft')
        || isKeyDown('MetaRight');

    for (const id in net.players) {
        const remote = net.players[id];
        if (remote.shotTime > 0) {
            remote.shotTime = Math.max(0, remote.shotTime - dt);
        }
    }

    if (localInMatch) {
        const movementAllowed = canMove(player, net.match);
        player.crouching = player.alive && crouchPressed;
        setAiming(player, player.alive && !net.match.intermission && isRightMouseDown() && !buyMenuOpen);
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
        const canAttack = player.alive
            && !net.match.buyPhase
            && !net.match.intermission
            && canAttackWithWeapon(player, selectedWeapon);
        const heavyKnifeAttack = selectedWeapon === WEAPON_KNIFE && isRightMouseDown();
        const primaryAttack = isMouseDown();
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

    if (localInMatch) {
        const renderServerTimeMs = estimateServerTime(net, Date.now()) - REMOTE_RENDER_DELAY_MS;
        worldDynamicVerts.length = 0;
        for (const id in net.players) {
            if (Number(id) === net.myId) continue;

            const remote = net.players[id];
            if (!remote.inMatch || !remote.alive) continue;
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
        visible: isKeyDown('Tab') && localInMatch,
        players: net.players,
        myId: net.myId,
    }, {
        latencyMs: net.latencyMs,
    }, net.match, {
        buyMenuOpen,
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
