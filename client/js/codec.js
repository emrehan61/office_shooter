// ─── Binary protocol codec ─────────────────────────────────────────────────
// Matches server/codec.go exactly. All multi-byte values are little-endian.

// ─── Message type IDs ──────────────────────────────────────────────────────

// Client → Server
export const MSG_INPUT  = 0x02;
export const MSG_SHOOT  = 0x03;
export const MSG_THROW  = 0x04;
export const MSG_RELOAD = 0x05;
export const MSG_SWITCH = 0x06;
export const MSG_BUY    = 0x07;
export const MSG_PING   = 0x0F;

// Server → Client
const MSG_DELTA_STATE = 0x81;
const MSG_STATE       = 0x82;
const MSG_ROUND       = 0x83;
const MSG_INPUT_ACK = 0x84;
const MSG_SHOT      = 0x85;
const MSG_HIT     = 0x86;
const MSG_KILL    = 0x87;
const MSG_RESPAWN = 0x88;
const MSG_PONG    = 0x8A;

// ─── Weapon ID enum ────────────────────────────────────────────────────────

const WEAPON_TO_BYTE = {
    '':              0x00,
    'knife':         0x01,
    'bomb':          0x02,
    'smoke':         0x03,
    'flashbang':     0x04,
    'cz75-auto':     0x10,
    'desert-eagle':  0x11,
    'dual-berettas': 0x12,
    'five-seven':    0x13,
    'glock-18':      0x14,
    'p2000':         0x15,
    'p250':          0x16,
    'r8-revolver':   0x17,
    'tec-9':         0x18,
    'usp-s':         0x19,
    'ak-47':         0x20,
    'aug':           0x21,
    'awp':           0x22,
    'famas':         0x23,
    'g3sg1':         0x24,
    'galil-ar':      0x25,
    'm4a1-s':        0x26,
    'm4a4':          0x27,
    'scar-20':       0x28,
    'sg553':         0x29,
    'ssg08':         0x2A,
    'mac10':         0x30,
    'mp5-sd':        0x31,
    'mp7':           0x32,
    'mp9':           0x33,
    'pp-bizon':      0x34,
    'p90':           0x35,
    'ump-45':        0x36,
    'mag-7':         0x40,
    'nova':          0x41,
    'sawed-off':     0x42,
    'xm1014':        0x43,
    'm249':          0x44,
    'negev':         0x45,
};

const BYTE_TO_WEAPON = [];
for (const [name, id] of Object.entries(WEAPON_TO_BYTE)) {
    BYTE_TO_WEAPON[id] = name;
}

function weaponToByte(w) {
    const b = WEAPON_TO_BYTE[w];
    return b !== undefined ? b : 0xFF;
}

function byteToWeapon(b) {
    return BYTE_TO_WEAPON[b] || '';
}

// ─── Team / Mode / HitZone / Effect enums ──────────────────────────────────

const TEAM_BYTE = { '': 0, 'blue': 1, 'green': 2 };
const BYTE_TEAM = ['', 'blue', 'green'];

const MODE_BYTE = { 'team': 0, 'deathmatch': 1, 'hostage': 2, 'ctf': 3 };
const BYTE_MODE = ['team', 'deathmatch', 'hostage', 'ctf'];

const BYTE_HITZONE = ['body', 'head'];
const BYTE_EFFECT  = ['bomb', 'smoke'];

// ─── Quantization ──────────────────────────────────────────────────────────

const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;

function quantizePosXZ(v) { return Math.round(v * 256) | 0; }
function quantizePosY(v)  { return Math.round(v * 1024) | 0; }
function quantizeYaw(v)   { return (Math.round(v * 65536 / TWO_PI) & 0xFFFF); }
function quantizePitch(v) { return Math.round(v * 32767 / HALF_PI) | 0; }
function quantizeDir(v)   { return Math.round(v * 32767) | 0; }

function dequantizePosXZ(v) { return v / 256; }
function dequantizePosY(v)  { return v / 1024; }
function dequantizeYaw(v)   { return v * TWO_PI / 65536; }
function dequantizePitch(v) { return v * HALF_PI / 32767; }

// ─── Encode: Client → Server ───────────────────────────────────────────────

export function encodeInput(cmd, snapshotAck) {
    const buf = new ArrayBuffer(10);
    const v = new DataView(buf);
    v.setUint8(0, MSG_INPUT);
    v.setUint16(1, cmd.seq, true);
    let flags = 0;
    if (cmd.forward)  flags |= 0x01;
    if (cmd.backward) flags |= 0x02;
    if (cmd.left)     flags |= 0x04;
    if (cmd.right)    flags |= 0x08;
    if (cmd.jump)     flags |= 0x10;
    if (cmd.crouch)   flags |= 0x20;
    if (cmd.aiming)   flags |= 0x40;
    v.setUint8(3, flags);
    v.setUint16(4, quantizeYaw(cmd.yaw), true);
    v.setInt16(6, quantizePitch(cmd.pitch), true);
    v.setUint16(8, snapshotAck || 0, true);
    return buf;
}

export function encodeShoot(dir, shotTime, weapon, aiming, alternate) {
    const buf = new ArrayBuffer(13);
    const v = new DataView(buf);
    v.setUint8(0, MSG_SHOOT);
    v.setInt16(1, quantizeDir(dir[0]), true);
    v.setInt16(3, quantizeDir(dir[1]), true);
    v.setInt16(5, quantizeDir(dir[2]), true);
    v.setUint32(7, shotTime >>> 0, true); // low 32 bits
    v.setUint8(11, weaponToByte(weapon));
    v.setUint8(12, (aiming ? 1 : 0) | (alternate ? 2 : 0));
    return buf;
}

export function encodeThrow(dir, weapon) {
    const buf = new ArrayBuffer(8);
    const v = new DataView(buf);
    v.setUint8(0, MSG_THROW);
    v.setInt16(1, quantizeDir(dir[0]), true);
    v.setInt16(3, quantizeDir(dir[1]), true);
    v.setInt16(5, quantizeDir(dir[2]), true);
    v.setUint8(7, weaponToByte(weapon));
    return buf;
}

export function encodeReload() {
    const buf = new ArrayBuffer(1);
    new DataView(buf).setUint8(0, MSG_RELOAD);
    return buf;
}

export function encodeSwitch(weapon) {
    const buf = new ArrayBuffer(2);
    const v = new DataView(buf);
    v.setUint8(0, MSG_SWITCH);
    v.setUint8(1, weaponToByte(weapon));
    return buf;
}

export function encodeBuy(item) {
    const buf = new ArrayBuffer(2);
    const v = new DataView(buf);
    v.setUint8(0, MSG_BUY);
    v.setUint8(1, weaponToByte(item));
    return buf;
}

export function encodePing(clientTime) {
    const buf = new ArrayBuffer(9);
    const v = new DataView(buf);
    v.setUint8(0, MSG_PING);
    // Write int64 as two uint32s (JS doesn't have native int64)
    v.setUint32(1, clientTime & 0xFFFFFFFF, true);
    v.setUint32(5, Math.floor(clientTime / 0x100000000) & 0xFFFFFFFF, true);
    return buf;
}

// ─── Decode: Server → Client ───────────────────────────────────────────────

// decodeMessage takes an ArrayBuffer and returns a message object
// shaped identically to the old JSON messages, so handleMsg() works unchanged.
export function decodeMessage(buffer) {
    const v = new DataView(buffer);
    const type = v.getUint8(0);

    switch (type) {
        case MSG_DELTA_STATE: return decodeDeltaState(v);
        case MSG_STATE: return decodeState(v, 'state');
        case MSG_ROUND: return decodeState(v, 'round');
        case MSG_SHOT:  return decodeShot(v);
        case MSG_HIT:   return decodeHit(v);
        case MSG_KILL:  return decodeKill(v);
        case MSG_RESPAWN: return decodeRespawn(v);
        case MSG_PONG:  return decodePong(v);
        case MSG_INPUT_ACK: return decodeInputAck(v);
        default: return null;
    }
}

function readInt64(v, off) {
    const lo = v.getUint32(off, true);
    const hi = v.getInt32(off + 4, true);
    return hi * 0x100000000 + lo;
}

function decodePlayerStateBlock(v, off) {
    const id = v.getUint8(off);
    const posX = dequantizePosXZ(v.getInt16(off + 1, true));
    const posY = dequantizePosY(v.getInt16(off + 3, true));
    const posZ = dequantizePosXZ(v.getInt16(off + 5, true));
    const yaw = dequantizeYaw(v.getUint16(off + 7, true));
    const pitch = dequantizePitch(v.getInt16(off + 9, true));
    const hp = v.getUint8(off + 11);
    const armor = v.getUint8(off + 12);
    const credits = v.getUint16(off + 13, true);
    const team = BYTE_TEAM[v.getUint8(off + 15)] || '';
    const kills = v.getUint16(off + 16, true);
    const deaths = v.getUint16(off + 18, true);
    const flags = v.getUint8(off + 20);
    const crouching = !!(flags & 0x01);
    const alive = !!(flags & 0x02);
    const inMatch = !!(flags & 0x04);
    const isBot = !!(flags & 0x08);
    const reloading = !!(flags & 0x10);
    const pistolWeapon = byteToWeapon(v.getUint8(off + 21));
    const pistolClip = v.getUint8(off + 22);
    const pistolReserve = v.getUint8(off + 23);
    const heavyWeapon = byteToWeapon(v.getUint8(off + 24));
    const heavyClip = v.getUint8(off + 25);
    const heavyReserve = v.getUint8(off + 26);
    const bombs = v.getUint8(off + 27);
    const smokes = v.getUint8(off + 28);
    const flashbangs = v.getUint8(off + 29);
    const flashTimeLeftMs = v.getUint16(off + 30, true) * 100;
    const spawnProtectionTimeLeftMs = v.getUint16(off + 32, true) * 100;
    const loadoutTimeLeftMs = v.getUint16(off + 34, true) * 100;
    const activeWeapon = byteToWeapon(v.getUint8(off + 36));
    const reloadTimeLeftMs = v.getUint16(off + 37, true) * 100;

    return {
        id,
        state: {
            pos: [posX, posY, posZ],
            yaw, pitch, crouching, hp, armor, credits, team,
            kills, deaths, alive, inMatch, isBot, reloading,
            pistolWeapon, pistolClip, pistolReserve,
            heavyWeapon, heavyClip, heavyReserve,
            bombs, smokes, flashbangs,
            flashTimeLeftMs, spawnProtectionTimeLeftMs, loadoutTimeLeftMs,
            activeWeapon, reloadTimeLeftMs,
        },
    };
}

const PLAYER_BLOCK_SIZE = 39;

function decodeState(v, msgType) {
    let off = 1;
    // Header: [type:1] [snapshotSeq:2] [serverTime:4] [counts:3]
    const snapshotSeq = v.getUint16(off, true); off += 2;
    // Reconstruct full int64 server time from low 32 bits using local clock
    const low32 = v.getUint32(off, true); off += 4;
    const now = Date.now();
    let serverTime = (now - (now % 0x100000000)) + low32;
    // Handle wraparound
    if (serverTime > now + 60000) serverTime -= 0x100000000;
    else if (serverTime < now - 0x100000000 + 60000) serverTime += 0x100000000;
    const playerCount = v.getUint8(off); off++;
    const projectileCount = v.getUint8(off); off++;
    const effectCount = v.getUint8(off); off++;

    const players = {};
    for (let i = 0; i < playerCount; i++) {
        const { id, state } = decodePlayerStateBlock(v, off);
        players[id] = state;
        off += PLAYER_BLOCK_SIZE;
    }

    const projectiles = [];
    for (let i = 0; i < projectileCount; i++) {
        const id = v.getUint8(off); off++;
        const type = byteToWeapon(v.getUint8(off)); off++;
        const px = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const py = dequantizePosY(v.getInt16(off, true)); off += 2;
        const pz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        projectiles.push({ id, type, pos: [px, py, pz] });
    }

    const effects = [];
    for (let i = 0; i < effectCount; i++) {
        const type = BYTE_EFFECT[v.getUint8(off)] || 'bomb'; off++;
        const ex = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const ey = dequantizePosY(v.getInt16(off, true)); off += 2;
        const ez = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const radius = v.getUint8(off) / 10; off++;
        const timeLeftMs = v.getUint16(off, true); off += 2;
        effects.push({ type, pos: [ex, ey, ez], radius, timeLeftMs });
    }

    // Match state
    const mode = BYTE_MODE[v.getUint8(off)] || 'team'; off++;
    const currentRound = v.getUint8(off); off++;
    const totalRounds = v.getUint8(off); off++;
    const roundTimeLeftMs = v.getUint32(off, true); off += 4;
    const buyTimeLeftMs = v.getUint16(off, true); off += 2;
    const matchFlags = v.getUint8(off); off++;
    const buyPhase = !!(matchFlags & 0x01);
    const intermission = !!(matchFlags & 0x02);
    const deathmatchVoteActive = !!(matchFlags & 0x04);
    const intermissionTimeLeftMs = v.getUint16(off, true); off += 2;
    const roundWinner = BYTE_TEAM[v.getUint8(off)] || ''; off++;
    const blueScore = v.getUint8(off); off++;
    const greenScore = v.getUint8(off); off++;
    const blueAlive = v.getUint8(off); off++;
    const greenAlive = v.getUint8(off); off++;
    const deathmatchVoteTimeLeftMs = v.getUint16(off, true); off += 2;
    const hostageCount = v.getUint8(off); off++;
    const flagCount = v.getUint8(off); off++;
    const blueCTFCaptures = v.getUint8(off); off++;
    const greenCTFCaptures = v.getUint8(off); off++;
    const rescueZoneCount = v.getUint8(off); off++;
    const healthRestoreCount = v.getUint8(off); off++;

    const hostages = [];
    for (let i = 0; i < hostageCount; i++) {
        const hid = v.getUint8(off); off++;
        const hx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const hy = dequantizePosY(v.getInt16(off, true)); off += 2;
        const hz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const followerId = v.getUint8(off); off++;
        const hf = v.getUint8(off); off++;
        hostages.push({
            id: hid,
            pos: [hx, hy, hz],
            followerId,
            rescued: !!(hf & 0x01),
            alive: !!(hf & 0x02),
        });
    }

    const flags = [];
    for (let i = 0; i < flagCount; i++) {
        const fTeam = BYTE_TEAM[v.getUint8(off)] || ''; off++;
        const fx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const fy = dequantizePosY(v.getInt16(off, true)); off += 2;
        const fz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const fhx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const fhy = dequantizePosY(v.getInt16(off, true)); off += 2;
        const fhz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const carrierId = v.getUint8(off); off++;
        const ff = v.getUint8(off); off++;
        flags.push({
            team: fTeam,
            pos: [fx, fy, fz],
            homePos: [fhx, fhy, fhz],
            carrierId,
            dropped: !!(ff & 0x01),
            atHome: !!(ff & 0x02),
        });
    }

    const rescueZones = [];
    for (let i = 0; i < rescueZoneCount; i++) {
        const rx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const rz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const rRadius = v.getUint8(off) / 10; off++;
        rescueZones.push({ cx: rx, cz: rz, radius: rRadius });
    }

    const healthRestorePoints = [];
    for (let i = 0; i < healthRestoreCount; i++) {
        const hpx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const hpz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const hpRadius = v.getUint8(off) / 10; off++;
        const healAmount = v.getUint8(off); off++;
        const cooldownSec = v.getUint16(off, true) / 10; off += 2;
        const cooldownTimeLeftMs = v.getUint16(off, true) * 100; off += 2;
        const hpf = v.getUint8(off); off++;
        healthRestorePoints.push({
            x: hpx, z: hpz, radius: hpRadius,
            healAmount, cooldownSec, cooldownTimeLeftMs,
            active: !!(hpf & 0x01),
        });
    }

    const match = {
        mode, currentRound, totalRounds, roundTimeLeftMs, buyTimeLeftMs,
        buyPhase, intermission, intermissionTimeLeftMs, roundWinner,
        blueScore, greenScore, blueAlive, greenAlive,
        deathmatchVoteActive, deathmatchVoteTimeLeftMs,
        hostages, flags, blueCTFCaptures, greenCTFCaptures,
        rescueZones, healthRestorePoints,
    };

    return {
        t: msgType,
        snapshotSeq,
        serverTime,
        players,
        projectiles,
        effects,
        match,
    };
}

// Delta field groups: maps each bit in the 16-bit changed mask to byte ranges
// in the 38-byte player state block.  Must match server deltaFieldGroups exactly.
const DELTA_FIELD_GROUPS = [
    [0, 2],   // bit 0:  posX
    [2, 4],   // bit 1:  posY
    [4, 6],   // bit 2:  posZ
    [6, 8],   // bit 3:  yaw
    [8, 10],  // bit 4:  pitch
    [10, 11], // bit 5:  hp
    [11, 12], // bit 6:  armor
    [12, 14], // bit 7:  credits
    [14, 19], // bit 8:  team+kills+deaths
    [19, 20], // bit 9:  flags
    [20, 23], // bit 10: pistol
    [23, 26], // bit 11: heavy
    [26, 29], // bit 12: utilities
    [29, 33], // bit 13: flash+spawn timers
    [33, 36], // bit 14: loadout+activeWeapon
    [36, 38], // bit 15: reload timer
];

// Dequantize a full 38-byte player state block from a DataView at the given offset.
function dequantizePlayerBlock(v, off) {
    const posX = dequantizePosXZ(v.getInt16(off + 0, true));
    const posY = dequantizePosY(v.getInt16(off + 2, true));
    const posZ = dequantizePosXZ(v.getInt16(off + 4, true));
    const yaw = dequantizeYaw(v.getUint16(off + 6, true));
    const pitch = dequantizePitch(v.getInt16(off + 8, true));
    const hp = v.getUint8(off + 10);
    const armor = v.getUint8(off + 11);
    const credits = v.getUint16(off + 12, true);
    const team = BYTE_TEAM[v.getUint8(off + 14)] || '';
    const kills = v.getUint16(off + 15, true);
    const deaths = v.getUint16(off + 17, true);
    const flags = v.getUint8(off + 19);
    const crouching = !!(flags & 0x01);
    const alive = !!(flags & 0x02);
    const inMatch = !!(flags & 0x04);
    const isBot = !!(flags & 0x08);
    const reloading = !!(flags & 0x10);
    const pistolWeapon = byteToWeapon(v.getUint8(off + 20));
    const pistolClip = v.getUint8(off + 21);
    const pistolReserve = v.getUint8(off + 22);
    const heavyWeapon = byteToWeapon(v.getUint8(off + 23));
    const heavyClip = v.getUint8(off + 24);
    const heavyReserve = v.getUint8(off + 25);
    const bombs = v.getUint8(off + 26);
    const smokes = v.getUint8(off + 27);
    const flashbangs = v.getUint8(off + 28);
    const flashTimeLeftMs = v.getUint16(off + 29, true) * 100;
    const spawnProtectionTimeLeftMs = v.getUint16(off + 31, true) * 100;
    const loadoutTimeLeftMs = v.getUint16(off + 33, true) * 100;
    const activeWeapon = byteToWeapon(v.getUint8(off + 35));
    const reloadTimeLeftMs = v.getUint16(off + 36, true) * 100;

    return {
        pos: [posX, posY, posZ],
        yaw, pitch, crouching, hp, armor, credits, team,
        kills, deaths, alive, inMatch, isBot, reloading,
        pistolWeapon, pistolClip, pistolReserve,
        heavyWeapon, heavyClip, heavyReserve,
        bombs, smokes, flashbangs,
        flashTimeLeftMs, spawnProtectionTimeLeftMs, loadoutTimeLeftMs,
        activeWeapon, reloadTimeLeftMs,
    };
}

// Apply a delta to an existing player state object.  For each set bit in
// changedMask, read the corresponding bytes from the DataView and update the
// player state.  Returns the number of bytes consumed.
export function applyDeltaToPlayer(state, v, off, changedMask) {
    let consumed = 0;
    for (let bit = 0; bit < 16; bit++) {
        if (!(changedMask & (1 << bit))) continue;
        const [start, end] = DELTA_FIELD_GROUPS[bit];
        const size = end - start;
        switch (bit) {
            case 0: state.pos[0] = dequantizePosXZ(v.getInt16(off, true)); break;
            case 1: state.pos[1] = dequantizePosY(v.getInt16(off, true)); break;
            case 2: state.pos[2] = dequantizePosXZ(v.getInt16(off, true)); break;
            case 3: state.yaw = dequantizeYaw(v.getUint16(off, true)); break;
            case 4: state.pitch = dequantizePitch(v.getInt16(off, true)); break;
            case 5: state.hp = v.getUint8(off); break;
            case 6: state.armor = v.getUint8(off); break;
            case 7: state.credits = v.getUint16(off, true); break;
            case 8: // team+kills+deaths (5 bytes)
                state.team = BYTE_TEAM[v.getUint8(off)] || '';
                state.kills = v.getUint16(off + 1, true);
                state.deaths = v.getUint16(off + 3, true);
                break;
            case 9: { // flags (1 byte)
                const f = v.getUint8(off);
                state.crouching = !!(f & 0x01);
                state.alive = !!(f & 0x02);
                state.inMatch = !!(f & 0x04);
                state.isBot = !!(f & 0x08);
                state.reloading = !!(f & 0x10);
                break;
            }
            case 10: // pistol (3 bytes)
                state.pistolWeapon = byteToWeapon(v.getUint8(off));
                state.pistolClip = v.getUint8(off + 1);
                state.pistolReserve = v.getUint8(off + 2);
                break;
            case 11: // heavy (3 bytes)
                state.heavyWeapon = byteToWeapon(v.getUint8(off));
                state.heavyClip = v.getUint8(off + 1);
                state.heavyReserve = v.getUint8(off + 2);
                break;
            case 12: // utilities (3 bytes)
                state.bombs = v.getUint8(off);
                state.smokes = v.getUint8(off + 1);
                state.flashbangs = v.getUint8(off + 2);
                break;
            case 13: // flash+spawn timers (4 bytes)
                state.flashTimeLeftMs = v.getUint16(off, true) * 100;
                state.spawnProtectionTimeLeftMs = v.getUint16(off + 2, true) * 100;
                break;
            case 14: // loadout+activeWeapon (3 bytes)
                state.loadoutTimeLeftMs = v.getUint16(off, true) * 100;
                state.activeWeapon = byteToWeapon(v.getUint8(off + 2));
                break;
            case 15: // reload timer (2 bytes)
                state.reloadTimeLeftMs = v.getUint16(off, true) * 100;
                break;
        }
        off += size;
        consumed += size;
    }
    return consumed;
}

// decodeDeltaState decodes a delta-compressed state message (0x81).
// Returns the same shape as decodeState but with `t: 'deltaState'` and the
// `players` object only containing changed fields for existing players
// (or full state for new players).  The caller (net.js) must merge delta
// players onto existing state.
function decodeDeltaState(v) {
    let off = 1;
    // Header: [type:1] [snapshotSeq:2] [baselineSeq:2] [serverTime:4] [numPlayers:1]
    const snapshotSeq = v.getUint16(off, true); off += 2;
    const baselineSeq = v.getUint16(off, true); off += 2;
    const low32 = v.getUint32(off, true); off += 4;
    const now = Date.now();
    let serverTime = (now - (now % 0x100000000)) + low32;
    if (serverTime > now + 60000) serverTime -= 0x100000000;
    else if (serverTime < now - 0x100000000 + 60000) serverTime += 0x100000000;

    const playerCount = v.getUint8(off); off++;

    // Parse player deltas.  Each entry: [id:1] [changedMask:2] [changed fields...]
    const playerDeltas = {};
    const playerIds = new Set();
    for (let i = 0; i < playerCount; i++) {
        const id = v.getUint8(off); off++;
        const changedMask = v.getUint16(off, true); off += 2;
        playerIds.add(id);

        if (changedMask === 0xFFFF) {
            // Full state for this player (38 bytes).
            playerDeltas[id] = { full: true, state: dequantizePlayerBlock(v, off) };
            off += 38;
        } else {
            // Delta — store mask and the raw bytes to apply later.
            playerDeltas[id] = { full: false, changedMask, dataOffset: off };
            // Advance past the changed fields.
            for (let bit = 0; bit < 16; bit++) {
                if (changedMask & (1 << bit)) {
                    const [start, end] = DELTA_FIELD_GROUPS[bit];
                    off += end - start;
                }
            }
        }
    }

    // Projectiles — same as full snapshot
    const projectileCount = v.getUint8(off); off++;
    const projectiles = [];
    for (let i = 0; i < projectileCount; i++) {
        const id = v.getUint8(off); off++;
        const type = byteToWeapon(v.getUint8(off)); off++;
        const px = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const py = dequantizePosY(v.getInt16(off, true)); off += 2;
        const pz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        projectiles.push({ id, type, pos: [px, py, pz] });
    }

    // Effects — same as full snapshot
    const effectCount = v.getUint8(off); off++;
    const effects = [];
    for (let i = 0; i < effectCount; i++) {
        const type = BYTE_EFFECT[v.getUint8(off)] || 'bomb'; off++;
        const ex = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const ey = dequantizePosY(v.getInt16(off, true)); off += 2;
        const ez = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const radius = v.getUint8(off) / 10; off++;
        const timeLeftMs = v.getUint16(off, true); off += 2;
        effects.push({ type, pos: [ex, ey, ez], radius, timeLeftMs });
    }

    // Match state — same as full snapshot
    const mode = BYTE_MODE[v.getUint8(off)] || 'team'; off++;
    const currentRound = v.getUint8(off); off++;
    const totalRounds = v.getUint8(off); off++;
    const roundTimeLeftMs = v.getUint32(off, true); off += 4;
    const buyTimeLeftMs = v.getUint16(off, true); off += 2;
    const matchFlags = v.getUint8(off); off++;
    const buyPhase = !!(matchFlags & 0x01);
    const intermission = !!(matchFlags & 0x02);
    const deathmatchVoteActive = !!(matchFlags & 0x04);
    const intermissionTimeLeftMs = v.getUint16(off, true); off += 2;
    const roundWinner = BYTE_TEAM[v.getUint8(off)] || ''; off++;
    const blueScore = v.getUint8(off); off++;
    const greenScore = v.getUint8(off); off++;
    const blueAlive = v.getUint8(off); off++;
    const greenAlive = v.getUint8(off); off++;
    const deathmatchVoteTimeLeftMs = v.getUint16(off, true); off += 2;
    const hostageCount = v.getUint8(off); off++;
    const flagCount = v.getUint8(off); off++;
    const blueCTFCaptures = v.getUint8(off); off++;
    const greenCTFCaptures = v.getUint8(off); off++;
    const rescueZoneCount = v.getUint8(off); off++;
    const healthRestoreCount = v.getUint8(off); off++;

    const hostages = [];
    for (let i = 0; i < hostageCount; i++) {
        const hid = v.getUint8(off); off++;
        const hx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const hy = dequantizePosY(v.getInt16(off, true)); off += 2;
        const hz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const followerId = v.getUint8(off); off++;
        const hf = v.getUint8(off); off++;
        hostages.push({
            id: hid, pos: [hx, hy, hz], followerId,
            rescued: !!(hf & 0x01), alive: !!(hf & 0x02),
        });
    }

    const flags = [];
    for (let i = 0; i < flagCount; i++) {
        const fTeam = BYTE_TEAM[v.getUint8(off)] || ''; off++;
        const fx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const fy = dequantizePosY(v.getInt16(off, true)); off += 2;
        const fz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const fhx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const fhy = dequantizePosY(v.getInt16(off, true)); off += 2;
        const fhz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const carrierId = v.getUint8(off); off++;
        const ff = v.getUint8(off); off++;
        flags.push({
            team: fTeam, pos: [fx, fy, fz], homePos: [fhx, fhy, fhz],
            carrierId, dropped: !!(ff & 0x01), atHome: !!(ff & 0x02),
        });
    }

    const rescueZones = [];
    for (let i = 0; i < rescueZoneCount; i++) {
        const rx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const rz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const rRadius = v.getUint8(off) / 10; off++;
        rescueZones.push({ cx: rx, cz: rz, radius: rRadius });
    }

    const healthRestorePoints = [];
    for (let i = 0; i < healthRestoreCount; i++) {
        const hpx = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const hpz = dequantizePosXZ(v.getInt16(off, true)); off += 2;
        const hpRadius = v.getUint8(off) / 10; off++;
        const healAmount = v.getUint8(off); off++;
        const cooldownSec = v.getUint16(off, true) / 10; off += 2;
        const cooldownTimeLeftMs = v.getUint16(off, true) * 100; off += 2;
        const hpf = v.getUint8(off); off++;
        healthRestorePoints.push({
            x: hpx, z: hpz, radius: hpRadius,
            healAmount, cooldownSec, cooldownTimeLeftMs,
            active: !!(hpf & 0x01),
        });
    }

    const match = {
        mode, currentRound, totalRounds, roundTimeLeftMs, buyTimeLeftMs,
        buyPhase, intermission, intermissionTimeLeftMs, roundWinner,
        blueScore, greenScore, blueAlive, greenAlive,
        deathmatchVoteActive, deathmatchVoteTimeLeftMs,
        hostages, flags, blueCTFCaptures, greenCTFCaptures,
        rescueZones, healthRestorePoints,
    };

    return {
        t: 'deltaState',
        snapshotSeq,
        baselineSeq,
        serverTime,
        playerDeltas,
        playerIds,
        dataView: v, // needed for applyDeltaToPlayer
        projectiles,
        effects,
        match,
    };
}

function decodeShot(v) {
    return {
        t: 'shot',
        id: v.getUint8(1),
        pos: [
            dequantizePosXZ(v.getInt16(2, true)),
            dequantizePosY(v.getInt16(4, true)),
            dequantizePosXZ(v.getInt16(6, true)),
        ],
        dir: [
            v.getInt16(8, true) / 32767,
            v.getInt16(10, true) / 32767,
            v.getInt16(12, true) / 32767,
        ],
        weapon: byteToWeapon(v.getUint8(14)),
        alternate: !!(v.getUint8(15) & 0x01),
    };
}

function decodeHit(v) {
    return {
        t: 'hit',
        from: v.getUint8(1),
        to: v.getUint8(2),
        dmg: v.getUint8(3),
        zone: BYTE_HITZONE[v.getUint8(4)] || 'body',
        weapon: byteToWeapon(v.getUint8(5)),
        hp: v.getUint8(6),
        armor: v.getUint8(7),
        absorbed: v.getUint8(8),
    };
}

function decodeKill(v) {
    const killer = v.getUint8(1);
    const victim = v.getUint8(2);
    return {
        t: 'kill',
        killer: killer === 0xFF ? 0 : killer,
        victim: victim === 0xFF ? -1 : victim,
        weapon: byteToWeapon(v.getUint8(3)),
    };
}

function decodeRespawn(v) {
    const { id, state } = decodePlayerStateBlock(v, 1);
    return { t: 'respawn', id, ...state };
}

function decodePong(v) {
    return {
        t: 'pong',
        clientTime: readInt64(v, 1),
        serverTime: readInt64(v, 9),
    };
}

function decodeInputAck(v) {
    return {
        t: 'inputAck',
        lastProcessedSeq: v.getUint16(1, true),
        velY: v.getInt16(3, true) / 256,
        onGround: v.getUint8(5) !== 0,
    };
}
