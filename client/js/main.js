import { createRenderer, uploadWorldGeo, drawWorld, drawDynamic } from './renderer.js';
import { createCamera, updateCamera } from './camera.js';
import { init, consumeMouse, isKeyDown, isMouseDown } from './input.js';
import { buildWorldGeometry } from './world.js';
import { addAmmo, consumeAmmo, createPlayer, playerJump, playerTakeDamage, resetCombatState, updatePlayer } from './player.js';
import { createWeapon, updateWeapon, canFire, fire, weaponVerts, consumeRecoilDelta } from './weapon.js';
import { createHUD, updateHUD, addKill, showDamageFlash, showHitMarker } from './hud.js';
import { createNet, connect, sendInput, sendShoot, sendStart } from './net.js';
import { clamp, lookDirFromYawPitch, mat4Create, mat4Multiply } from './math.js';
import { buildAvatarVerts } from './avatar.js';
import { buildWebSocketURL, getDefaultServerAddress } from './config.js';

const SEND_RATE = 1 / 60;

let lastTime = 0;
let sendTimer = 0;

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const camera = createCamera();
const player = createPlayer();
const weapon = createWeapon();
const hud = createHUD();
const net = createNet();

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

// ─── Lobby UI ───
const serverInput = document.getElementById('server-input');
const nameInput = document.getElementById('name-input');
const connectBtn = document.getElementById('connect-btn');
const lobbyPanel = document.getElementById('lobby-panel');
const lobbyForm = document.querySelector('.lobby-form');
const lobbyStatus = document.getElementById('lobby-status');
const playerList = document.getElementById('player-list');
const startBtn = document.getElementById('start-btn');

if (serverInput) serverInput.value = getDefaultServerAddress(window.location);

function populatePlayerList() {
    if (!playerList) return;

    playerList.innerHTML = '';
    const ids = Object.keys(net.players).sort((a, b) => Number(a) - Number(b));

    if (ids.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'player-row empty';
        empty.textContent = 'Waiting for players...';
        playerList.appendChild(empty);
    }

    for (const id of ids) {
        const row = document.createElement('div');
        row.className = 'player-row';
        const isSelf = Number(id) === net.myId;
        row.textContent = isSelf ? `${net.players[id].name || 'You'} (You)` : (net.players[id].name || '???');
        playerList.appendChild(row);
    }

    if (startBtn) {
        startBtn.disabled = !net.connected || net.gameStarted;
    }
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

function resetAfterDisconnect(message) {
    resetCombatState(player);
    sendTimer = 0;

    if (hud.overlay) hud.overlay.style.display = 'flex';
    showConnectForm();
    setLobbyStatus(message || 'Disconnected from server');
    populatePlayerList();
}

if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
        const name = (nameInput ? nameInput.value.trim() : '') || 'Player';
        const server = (serverInput ? serverInput.value.trim() : '') || 'localhost:8080';
        const url = buildWebSocketURL(server, window.location);

        connectBtn.disabled = true;
        setLobbyStatus('Connecting...');

        try {
            const msg = await connect(net, url, name);
            resetCombatState(player);
            player.pos = [...msg.pos];
            camera.position = player.pos;
            showLobbyPanel();
            populatePlayerList();
            setLobbyStatus(net.gameStarted ? 'Match in progress' : 'Connected to lobby');
        } catch (err) {
            resetAfterDisconnect(err.message || 'Connection failed');
        } finally {
            connectBtn.disabled = false;
        }
    });
}

net.onLobby = (msg) => {
    populatePlayerList();
    setLobbyStatus(msg.state === 'playing' ? 'Match in progress' : 'Connected to lobby');
    if (msg.state !== 'playing') {
        showLobbyPanel();
    }
};

if (startBtn) {
    startBtn.addEventListener('click', () => {
        if (startBtn) startBtn.disabled = true;
        setLobbyStatus('Starting match...');
        sendStart(net);
    });
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') playerJump(player);
    if (e.code === 'Tab' && net.gameStarted) e.preventDefault();
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab' && net.gameStarted) e.preventDefault();
});

net.onHit = (msg) => {
    if (msg.to == net.myId) {
        playerTakeDamage(player, msg.dmg);
        showDamageFlash(hud, msg.zone);
    }
    if (msg.from == net.myId) showHitMarker(hud);
};

net.onKill = (msg) => {
    const kn = msg.killer == net.myId ? 'You' : (net.players[msg.killer]?.name || '?');
    const vn = msg.victim == net.myId ? 'You' : (net.players[msg.victim]?.name || '?');
    if (msg.killer == net.myId) addAmmo(player, 10);
    addKill(hud, kn, vn);
};

net.onRespawn = (msg) => {
    resetCombatState(player);
    player.pos = [...msg.pos];
};

net.onDisconnect = ({ reason }) => {
    resetAfterDisconnect(reason);
};

// ─── Game Loop ───
function frame(time) {
    requestAnimationFrame(frame);

    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    if (net.gameStarted) {
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
    const moving = keys.forward || keys.backward || keys.left || keys.right;

    for (const id in net.players) {
        const remote = net.players[id];
        if (remote.shotTime > 0) {
            remote.shotTime = Math.max(0, remote.shotTime - dt);
        }
    }

    if (net.gameStarted) {
        updatePlayer(player, dt, keys);
        camera.position = player.pos;

        updateWeapon(weapon, dt, moving);
        const recoilDelta = consumeRecoilDelta(weapon);
        camera.pitch = clamp(camera.pitch + recoilDelta.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
        camera.yaw += recoilDelta.yaw;
        updateCamera(camera, 0, 0, canvas.width / canvas.height);

        if (isMouseDown() && canFire(weapon) && player.alive && consumeAmmo(player)) {
            fire(weapon);
            const dir = lookDirFromYawPitch(camera.yaw, camera.pitch);
            sendShoot(net, dir);
        }

        sendTimer -= dt;
        if (sendTimer <= 0 && net.connected) {
            sendInput(net, player.pos, camera.yaw, camera.pitch);
            sendTimer = SEND_RATE;
        }
    }

    drawWorld(renderer, camera.viewMatrix, camera.projMatrix);

    if (net.gameStarted) {
        const pv = [];
        for (const id in net.players) {
            if (Number(id) === net.myId) continue;

            const p = net.players[id];
            if (!p.alive) continue;
            pv.push(...buildAvatarVerts(id, p));
        }

        if (pv.length > 0) {
            const mvp = mat4Create();
            mat4Multiply(mvp, camera.projMatrix, camera.viewMatrix);
            drawDynamic(renderer, pv, mvp);
        }

        if (player.alive) {
            drawDynamic(renderer, weaponVerts(weapon), camera.projMatrix);
        }

        updateHUD(hud, player, {
            visible: isKeyDown('Tab'),
            players: net.players,
            myId: net.myId,
        }, {
            latencyMs: net.latencyMs,
        });
    }
}

requestAnimationFrame(frame);
