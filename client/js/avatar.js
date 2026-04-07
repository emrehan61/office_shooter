import * as THREE from 'three';
import { boxVerts, getMaterial } from './renderer.js';
import { CROUCH_EYE_HEIGHT, STAND_EYE_HEIGHT } from './player.js';
import { TEAM_BLUE, TEAM_GREEN, normalizeTeam } from './teams.js';

const BLUE_PALETTE = { primary: 6, accent: 10 };
const GREEN_PALETTE = { primary: 7, accent: 10 };
const PLAYER_PALETTES = [
    { primary: 5, accent: 10 },
    BLUE_PALETTE,
    GREEN_PALETTE,
    { primary: 8, accent: 10 },
    { primary: 11, accent: 10 },
    { primary: 12, accent: 10 },
];

const SKIN_MAT = 9;
const GEAR_MAT = 10;
const FLASH_MAT = 4;
const GUN_MAT = 3;
const GLASS_MAT = 13;

const MAX_AVATARS = 5;

export function getPlayerPalette(id, team = '') {
    const normalizedTeam = normalizeTeam(team);
    if (normalizedTeam === TEAM_BLUE) return BLUE_PALETTE;
    if (normalizedTeam === TEAM_GREEN) return GREEN_PALETTE;
    const index = Math.abs((Number(id) || 1) - 1) % PLAYER_PALETTES.length;
    return PLAYER_PALETTES[index];
}

// ─── Three.js mesh-based avatar pool (GPU transforms) ───

function makeBox(hx, hy, hz, matID) {
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const mat = getMaterial(matID);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !mat.transparent;
    mesh.receiveShadow = !mat.transparent;
    return mesh;
}

function makePivot(mesh) {
    const g = new THREE.Group();
    g.add(mesh);
    return g;
}

function createSingleAvatar() {
    const root = new THREE.Group();
    root.visible = false;

    // ═══════════════════════════════════════════════
    //  HEAD & HELMET
    // ═══════════════════════════════════════════════
    const head       = makeBox(0.17, 0.22, 0.17, SKIN_MAT);
    const headTop    = makeBox(0.18, 0.05, 0.18, GEAR_MAT);      // helmet cap (palette primary)
    const headset    = makeBox(0.08, 0.04, 0.03, GEAR_MAT);      // earpiece
    const visor      = makeBox(0.18, 0.06, 0.02, GLASS_MAT);     // tactical face visor
    const neckGuard  = makeBox(0.20, 0.04, 0.15, GEAR_MAT);      // collar / neck protection

    // ═══════════════════════════════════════════════
    //  TORSO & VEST
    // ═══════════════════════════════════════════════
    const chest      = makeBox(0.27, 0.32, 0.18, GEAR_MAT);      // torso (palette primary)
    const plate      = makeBox(0.19, 0.16, 0.03, GEAR_MAT);      // front plate (palette accent)
    const vestBack   = makeBox(0.22, 0.24, 0.04, GEAR_MAT);      // rear armor plate
    const collar     = makeBox(0.24, 0.04, 0.16, GEAR_MAT);      // vest collar rim
    const shoulderPadL = makeBox(0.12, 0.05, 0.12, GEAR_MAT);    // shoulder pad L (inside arm pivot)
    const shoulderPadR = makeBox(0.12, 0.05, 0.12, GEAR_MAT);    // shoulder pad R (inside arm pivot)

    // ═══════════════════════════════════════════════
    //  BELT & POUCHES
    // ═══════════════════════════════════════════════
    const belt       = makeBox(0.22, 0.16, 0.16, GEAR_MAT);      // belt (palette accent)
    const beltPouchL = makeBox(0.04, 0.08, 0.06, GEAR_MAT);      // left pouch
    const beltPouchR = makeBox(0.04, 0.08, 0.06, GEAR_MAT);      // right pouch

    // ═══════════════════════════════════════════════
    //  LEGS & BOOTS
    // ═══════════════════════════════════════════════
    const thighStandGeo  = new THREE.BoxGeometry(0.20, 0.64, 0.22);
    const thighCrouchGeo = new THREE.BoxGeometry(0.20, 0.44, 0.22);
    const shinStandGeo   = new THREE.BoxGeometry(0.20, 0.44, 0.22);
    const shinCrouchGeo  = new THREE.BoxGeometry(0.20, 0.32, 0.22);

    const thighL = new THREE.Mesh(thighStandGeo, getMaterial(GEAR_MAT));
    thighL.castShadow = true; thighL.receiveShadow = true;
    const thighR = new THREE.Mesh(thighStandGeo, getMaterial(GEAR_MAT));
    thighR.castShadow = true; thighR.receiveShadow = true;
    const shinL = new THREE.Mesh(shinStandGeo, getMaterial(GEAR_MAT));
    shinL.castShadow = true; shinL.receiveShadow = true;
    const shinR = new THREE.Mesh(shinStandGeo, getMaterial(GEAR_MAT));
    shinR.castShadow = true; shinR.receiveShadow = true;

    const kneePadL   = makeBox(0.08, 0.07, 0.04, GEAR_MAT);     // knee pad (palette accent)
    const kneePadR   = makeBox(0.08, 0.07, 0.04, GEAR_MAT);     // knee pad (palette accent)
    const holster    = makeBox(0.03, 0.10, 0.08, GEAR_MAT);      // thigh holster
    const footL      = makeBox(0.13, 0.05, 0.18, GEAR_MAT);
    const footR      = makeBox(0.13, 0.05, 0.18, GEAR_MAT);
    const bootToeL   = makeBox(0.10, 0.04, 0.05, GEAR_MAT);     // boot toe cap
    const bootToeR   = makeBox(0.10, 0.04, 0.05, GEAR_MAT);

    // ═══════════════════════════════════════════════
    //  ARMS & HANDS
    // ═══════════════════════════════════════════════
    const handL      = makeBox(0.06, 0.06, 0.07, SKIN_MAT);
    const wristGuardL = makeBox(0.07, 0.04, 0.08, GEAR_MAT);    // left wrist guard

    const leftShoulder = makeBox(0.08, 0.18, 0.09, GEAR_MAT);   // palette primary
    const leftShoulderPivot = makePivot(leftShoulder);
    leftShoulderPivot.add(shoulderPadL);                         // pad rotates with arm
    leftShoulderPivot.rotation.set(0.28, 0, 0.25, 'XYZ');

    const leftElbow = makeBox(0.07, 0.16, 0.08, SKIN_MAT);
    const leftElbowPivot = makePivot(leftElbow);
    leftElbowPivot.rotation.set(0.2, 0, 0.08, 'XYZ');

    const rightShoulder = makeBox(0.08, 0.18, 0.09, GEAR_MAT);  // palette primary
    const rightShoulderPivot = makePivot(rightShoulder);
    rightShoulderPivot.add(shoulderPadR);                        // pad rotates with arm

    const rightElbow = makeBox(0.07, 0.17, 0.08, SKIN_MAT);
    const rightElbowPivot = makePivot(rightElbow);

    const rightHand = makeBox(0.06, 0.06, 0.08, SKIN_MAT);
    const wristGuardR = makeBox(0.07, 0.04, 0.08, GEAR_MAT);    // right wrist guard (inside pivot)
    const rightHandPivot = makePivot(rightHand);
    rightHandPivot.add(wristGuardR);

    // ═══════════════════════════════════════════════
    //  GUN — stock, body, rail, barrel, grip, mag, sight
    // ═══════════════════════════════════════════════
    const gunBody    = makeBox(0.05, 0.05, 0.22, GUN_MAT);       // receiver
    const gunBarrel  = makeBox(0.02, 0.02, 0.10, GUN_MAT);       // barrel
    const gunStock   = makeBox(0.04, 0.06, 0.10, GUN_MAT);       // buttstock
    const gunGrip    = makeBox(0.03, 0.06, 0.04, GUN_MAT);       // pistol grip
    const gunRail    = makeBox(0.025, 0.012, 0.18, GUN_MAT);     // top rail
    const gunSight   = makeBox(0.015, 0.025, 0.015, GUN_MAT);    // front sight post

    const gunMag = makeBox(0.03, 0.08, 0.04, GUN_MAT);
    const gunMagPivot = makePivot(gunMag);
    gunMagPivot.rotation.set(0.45, 0, 0, 'XYZ');

    // ═══════════════════════════════════════════════
    //  MUZZLE FLASH (conditional, uniform scale)
    // ═══════════════════════════════════════════════
    const flashArm1 = makeBox(1.8, 0.12, 1.5, FLASH_MAT);
    const flashArm2 = makeBox(0.12, 1.5, 1.8, FLASH_MAT);
    const flashCore = makeBox(0.5, 0.5, 0.5, FLASH_MAT);

    // ── Add all to root ──
    root.add(
        head, headTop, headset, visor, neckGuard,
        chest, plate, vestBack, collar,
        belt, beltPouchL, beltPouchR,
        thighL, thighR, shinL, shinR, kneePadL, kneePadR, holster,
        footL, footR, bootToeL, bootToeR,
        handL, wristGuardL,
        leftShoulderPivot, leftElbowPivot,
        rightShoulderPivot, rightElbowPivot, rightHandPivot,
        gunBody, gunBarrel, gunStock, gunGrip, gunRail, gunSight,
        gunMagPivot,
        flashArm1, flashArm2, flashCore,
    );

    return {
        root,
        // Palette-dependent meshes
        primaryMeshes: [headTop, chest, shinL, shinR, leftShoulder, rightShoulder, shoulderPadL, shoulderPadR],
        accentMeshes: [plate, belt, kneePadL, kneePadR],
        lastPrimaryMatId: -1,
        lastAccentMatId: -1,

        // Bulk-positioned parts: { mesh/pivot, standY, crouchY, cx, cz }
        posParts: [
            // Head & helmet
            { m: head,               sY: 1.65, cY: 1.24, cx: 0,     cz: 0     },
            { m: headTop,            sY: 1.83, cY: 1.39, cx: 0,     cz: 0.01  },
            { m: headset,            sY: 1.66, cY: 1.25, cx: 0,     cz: 0.16  },
            { m: visor,              sY: 1.60, cY: 1.19, cx: 0,     cz: -0.16 },
            { m: neckGuard,          sY: 1.40, cY: 1.02, cx: 0,     cz: 0     },
            // Torso & vest
            { m: chest,              sY: 1.08, cY: 0.84, cx: 0,     cz: 0     },
            { m: plate,              sY: 1.11, cY: 0.87, cx: 0,     cz: 0.17  },
            { m: vestBack,           sY: 1.08, cY: 0.84, cx: 0,     cz: -0.16 },
            { m: collar,             sY: 1.38, cY: 1.14, cx: 0,     cz: 0     },
            // Belt
            { m: belt,               sY: 0.64, cY: 0.46, cx: 0,     cz: 0     },
            { m: beltPouchL,         sY: 0.64, cY: 0.46, cx: -0.23, cz: 0.06  },
            { m: beltPouchR,         sY: 0.64, cY: 0.46, cx: 0.23,  cz: 0.06  },
            // Legs
            { m: thighL,             sY: 0.34, cY: 0.17, cx: -0.12, cz: 0     },
            { m: thighR,             sY: 0.34, cY: 0.17, cx: 0.12,  cz: 0     },
            { m: shinL,              sY: 0.82, cY: 0.53, cx: -0.12, cz: 0.01  },
            { m: shinR,              sY: 0.82, cY: 0.53, cx: 0.12,  cz: 0.01  },
            { m: kneePadL,           sY: 0.72, cY: 0.45, cx: -0.12, cz: 0.12  },
            { m: kneePadR,           sY: 0.72, cY: 0.45, cx: 0.12,  cz: 0.12  },
            { m: holster,            sY: 0.42, cY: 0.25, cx: -0.20, cz: 0     },
            // Feet
            { m: footL,              sY: 0.05, cY: -0.01, cx: -0.12, cz: 0.08 },
            { m: footR,              sY: 0.05, cY: -0.01, cx: 0.12,  cz: 0.08 },
            { m: bootToeL,           sY: 0.04, cY: -0.02, cx: -0.12, cz: 0.18 },
            { m: bootToeR,           sY: 0.04, cY: -0.02, cx: 0.12,  cz: 0.18 },
            // Left hand
            { m: handL,              sY: 0.65, cY: 0.58, cx: -0.45, cz: -0.1  },
            { m: wristGuardL,        sY: 0.68, cY: 0.61, cx: -0.44, cz: -0.08 },
            // Pivots at joint positions (arm rotates around joint, not avatar center)
            { m: leftShoulderPivot,  sY: 1.1,  cY: 0.96, cx: -0.27, cz: 0     },
            { m: leftElbowPivot,     sY: 0.84, cY: 0.75, cx: -0.40, cz: -0.04 },
            { m: gunMagPivot,        sY: 0,    cY: 0,    cx: 0,     cz: 0     },
        ],

        // Meshes inside pivots that need their own Y updates
        leftShoulder, leftElbow, shoulderPadL,
        rightShoulder, rightElbow, rightHand, wristGuardR, shoulderPadR,
        gunMag,

        // Pivot groups for rotation updates
        rightShoulderPivot, rightElbowPivot, rightHandPivot,

        // Gun parts (Z depends on shotKick)
        gunBody, gunBarrel, gunStock, gunGrip, gunRail, gunSight,

        // Crouch geometry swaps
        thighL, thighR, shinL, shinR,
        thighStandGeo, thighCrouchGeo, shinStandGeo, shinCrouchGeo,
        lastCrouching: null,

        // Flash
        flashArm1, flashArm2, flashCore,
    };
}

function applyPalette(av, palette) {
    const primaryMat = getMaterial(palette.primary);
    for (const m of av.primaryMeshes) m.material = primaryMat;
    av.lastPrimaryMatId = palette.primary;

    const accentMat = getMaterial(palette.accent);
    for (const m of av.accentMeshes) m.material = accentMat;
    av.lastAccentMatId = palette.accent;
}

function updateAvatar(av, id, player, pose) {
    const palette = getPlayerPalette(id, player.team);
    const shotKick = Math.max(0, player.shotTime || 0) / 0.12;
    const crouching = !!pose.crouching;
    const eyeHeight = crouching ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
    const baseY = (pose.pos?.[1] ?? STAND_EYE_HEIGHT) - eyeHeight;

    // Root transform (world position + yaw)
    av.root.position.set(pose.pos?.[0] ?? 0, baseY, pose.pos?.[2] ?? 0);
    av.root.rotation.y = pose.yaw || 0;

    // Palette (only on change)
    if (av.lastPrimaryMatId !== palette.primary || av.lastAccentMatId !== palette.accent) {
        applyPalette(av, palette);
    }

    // Bulk position update for simple parts
    for (const p of av.posParts) {
        p.m.position.set(p.cx, crouching ? p.cY : p.sY, p.cz);
    }

    // Crouch geometry swap (only on state change)
    if (av.lastCrouching !== crouching) {
        av.thighL.geometry = crouching ? av.thighCrouchGeo : av.thighStandGeo;
        av.thighR.geometry = crouching ? av.thighCrouchGeo : av.thighStandGeo;
        av.shinL.geometry = crouching ? av.shinCrouchGeo : av.shinStandGeo;
        av.shinR.geometry = crouching ? av.shinCrouchGeo : av.shinStandGeo;
        av.lastCrouching = crouching;
    }

    // Y-positions for meshes inside pivots
    const lShY = crouching ? 0.96 : 1.1;
    const lElY = crouching ? 0.75 : 0.84;
    const rShY = crouching ? 0.94 : 1.08;
    const rElY = crouching ? 0.74 : 0.83;
    const rHdY = crouching ? 0.58 : 0.65;
    const gunY = crouching ? 0.74 : 0.9;

    // Left arm — local offsets relative to joint pivots
    av.leftShoulder.position.set(-0.09, 0, -0.02);
    av.shoulderPadL.position.set(-0.09, 0.19, -0.02);
    av.leftElbow.position.set(-0.02, 0, -0.02);

    // Right arm — pivot at shoulder joint, local offsets from there
    av.rightShoulderPivot.position.set(0.27, rShY, 0);
    av.rightShoulderPivot.rotation.set(-0.35 - shotKick * 0.2, -0.08, -0.15, 'XYZ');
    av.rightShoulder.position.set(0.07, 0, -0.08);
    av.shoulderPadR.position.set(0.07, 0.19, -0.08);

    av.rightElbowPivot.position.set(0.40, rElY, -0.20);
    av.rightElbowPivot.rotation.set(-0.75 - shotKick * 0.45, -0.08, -0.05, 'XYZ');
    av.rightElbow.position.set(0.02, 0, -0.05 - shotKick * 0.04);

    av.rightHandPivot.position.set(0.44, rHdY, -0.36);
    av.rightHandPivot.rotation.set(-0.2, 0, 0, 'XYZ');
    av.rightHand.position.set(0.02, 0, -0.06 - shotKick * 0.06);
    av.wristGuardR.position.set(0.01, 0.03, -0.02 - shotKick * 0.05);

    const sk = shotKick * 0.08;
    const skB = shotKick * 0.1;
    av.gunBody.position.set(0.1, gunY, -0.44 - sk);
    av.gunBarrel.position.set(0.1, gunY + 0.04, -0.69 - skB);
    av.gunStock.position.set(0.1, gunY - 0.01, -0.14 - sk);
    av.gunGrip.position.set(0.1, gunY - 0.10, -0.38 - sk);
    av.gunRail.position.set(0.1, gunY + 0.065, -0.44 - sk);
    av.gunSight.position.set(0.1, gunY + 0.08, -0.60 - skB);
    av.gunMag.position.set(0.1, gunY - 0.12, -0.28);

    // Muzzle flash
    const showFlash = shotKick > 0;
    av.flashArm1.visible = showFlash;
    av.flashArm2.visible = showFlash;
    av.flashCore.visible = showFlash;
    if (showFlash) {
        const f = 0.08 + shotKick * 0.12;
        const fy = gunY - 0.06;
        av.flashArm1.position.set(0.1, fy, -0.83);
        av.flashArm1.scale.setScalar(f);
        av.flashArm2.position.set(0.1, fy, -0.83);
        av.flashArm2.scale.setScalar(f);
        av.flashCore.position.set(0.1, fy, -0.83);
        av.flashCore.scale.setScalar(f);
    }
}

export function createAvatarPool(parentGroup) {
    const pool = [];
    for (let i = 0; i < MAX_AVATARS; i++) {
        const av = createSingleAvatar();
        parentGroup.add(av.root);
        pool.push(av);
    }
    return pool;
}

export function updateAvatarPool(pool, remotePlayers, myId, renderServerTimeMs, sampleFn) {
    let idx = 0;
    for (const id in remotePlayers) {
        if (Number(id) === myId) continue;
        if (idx >= MAX_AVATARS) break;
        const remote = remotePlayers[id];
        if (!remote.inMatch || !remote.alive) continue;
        const pose = sampleFn(remote, renderServerTimeMs);
        updateAvatar(pool[idx], id, remote, pose);
        pool[idx].root.visible = true;
        idx++;
    }
    for (let i = idx; i < MAX_AVATARS; i++) {
        pool[i].root.visible = false;
    }
}

export function hideAvatarPool(pool) {
    for (let i = 0; i < pool.length; i++) {
        pool[i].root.visible = false;
    }
}

export function createObjectivesPool(parentGroup) {
    const group = new THREE.Group();
    parentGroup.add(group);
    
    const hostageGeo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8);
    const hostageMat = getMaterial(11);
    const hostages = [];
    for(let i=0; i<4; i++) {
        const m = new THREE.Mesh(hostageGeo, hostageMat);
        m.visible = false;
        group.add(m);
        hostages.push(m);
    }
    
    const flagBoxY = new THREE.BoxGeometry(0.2, 1.5, 0.2);
    const flagBoxX = new THREE.BoxGeometry(0.8, 0.4, 0.1);
    flagBoxX.translate(0.3, 0.5, 0); // flap
    // In newer Three.js merging needs BufferGeometryUtils, but for simplicity let's just make groups
    const blueMat = getMaterial(BLUE_PALETTE.primary);
    const greenMat = getMaterial(GREEN_PALETTE.primary);
    
    const flags = [];
    [blueMat, greenMat].forEach(mat => {
        const fGroup = new THREE.Group();
        const pole = new THREE.Mesh(flagBoxY, mat);
        const flap = new THREE.Mesh(flagBoxX, mat);
        fGroup.add(pole);
        fGroup.add(flap);
        fGroup.visible = false;
        group.add(fGroup);
        flags.push(fGroup);
    });
    
    // Rescue zones
    const zoneGeo = new THREE.CylinderGeometry(1, 1, 0.05, 32);
    const zoneMat = new THREE.MeshBasicMaterial({ color: 0x28a050, transparent: true, opacity: 0.3, wireframe: true });
    const rescueZones = [];
    for(let i=0; i<4; i++) {
        const m = new THREE.Mesh(zoneGeo, zoneMat);
        m.visible = false;
        group.add(m);
        rescueZones.push(m);
    }

    const baseGeo = new THREE.TorusGeometry(1, 0.08, 12, 32);
    const flagBases = [];
    [blueMat, greenMat].forEach(mat => {
        const m = new THREE.Mesh(baseGeo, mat);
        m.rotation.x = Math.PI / 2;
        m.visible = false;
        group.add(m);
        flagBases.push(m);
    });
    
    return { group, hostages, flags, rescueZones, flagBases };
}

export function updateObjectivesPool(objs, match) {
    if (!match) return;
    
    const hd = match.hostages || [];
    for(let i=0; i<objs.hostages.length; i++) {
        const m = objs.hostages[i];
        if (i < hd.length && hd[i].alive && !hd[i].rescued && !hd[i].followerId) {
            m.visible = true;
            m.position.set(hd[i].pos[0], hd[i].pos[1] - 0.2, hd[i].pos[2]);
        } else {
            m.visible = false;
        }
    }
    
    const fd = match.flags || [];
    for(let i=0; i<objs.flags.length; i++) {
        objs.flags[i].visible = false;
    }
    for(let i=0; i<fd.length; i++) {
        const f = fd[i];
        if (f.carrierId) continue; // carried flags are invisible, wait, flag carriers are marked
        
        let m = null;
        if (f.team === TEAM_BLUE) m = objs.flags[0];
        if (f.team === TEAM_GREEN) m = objs.flags[1];
        
        if (m) {
            m.visible = true;
            m.position.set(f.pos[0], f.pos[1] - 0.6, f.pos[2]);
        }
    }

    for(let i=0; i<objs.flagBases.length; i++) {
        objs.flagBases[i].visible = false;
    }
    for(let i=0; i<fd.length; i++) {
        const f = fd[i];
        let m = null;
        if (f.team === TEAM_BLUE) m = objs.flagBases[0];
        if (f.team === TEAM_GREEN) m = objs.flagBases[1];
        const home = f.homePos || f.pos;

        if (m && Array.isArray(home)) {
            m.visible = true;
            m.position.set(home[0], 0.04, home[2]);
        }
    }
    
    const rz = match.rescueZones || [];
    for(let i=0; i<objs.rescueZones.length; i++) {
        if (i < rz.length) {
            objs.rescueZones[i].visible = true;
            objs.rescueZones[i].position.set(rz[i].cx, 0.05, rz[i].cz);
            objs.rescueZones[i].scale.set(rz[i].radius, 1, rz[i].radius);
        } else {
            objs.rescueZones[i].visible = false;
        }
    }
}

// ─── Legacy vertex-based builder (kept for tests / editor) ───

const BOX_CACHE = new Map();

export function buildAvatarVerts(playerId, player, pose = player) {
    const palette = getPlayerPalette(playerId, player?.team);
    const shotKick = Math.max(0, player.shotTime || 0) / 0.12;
    const crouching = !!pose.crouching;
    const eyeHeight = crouching ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
    const headY = crouching ? 1.24 : 1.65;
    const headTopY = crouching ? 1.39 : 1.83;
    const headsetY = crouching ? 1.25 : 1.66;
    const chestY = crouching ? 0.84 : 1.08;
    const plateY = crouching ? 0.87 : 1.11;
    const beltY = crouching ? 0.46 : 0.64;
    const thighY = crouching ? 0.17 : 0.34;
    const shinY = crouching ? 0.53 : 0.82;
    const footY = crouching ? -0.01 : 0.05;
    const leftShoulderY = crouching ? 0.96 : 1.1;
    const leftElbowY = crouching ? 0.75 : 0.84;
    const leftHandY = crouching ? 0.58 : 0.65;
    const rightShoulderY = crouching ? 0.94 : 1.08;
    const rightElbowY = crouching ? 0.74 : 0.83;
    const rightHandY = crouching ? 0.58 : 0.65;
    const gunY = crouching ? 0.74 : 0.9;
    const verts = [];

    appendPart(verts, getBoxVerts(0, headY, 0, 0.17, 0.22, 0.17, SKIN_MAT), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0, headTopY, 0.01, 0.18, 0.05, 0.18, palette.primary), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0, headsetY, 0.16, 0.08, 0.04, 0.03, GEAR_MAT), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0, chestY, 0, 0.27, 0.32, 0.18, palette.primary), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0, plateY, 0.17, 0.19, 0.16, 0.03, palette.accent), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0, beltY, 0, 0.22, 0.16, 0.16, palette.accent), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(-0.12, thighY, 0, 0.1, crouching ? 0.22 : 0.32, 0.11, GEAR_MAT), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0.12, thighY, 0, 0.1, crouching ? 0.22 : 0.32, 0.11, GEAR_MAT), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(-0.12, shinY, 0.01, 0.1, crouching ? 0.16 : 0.22, 0.11, palette.primary), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0.12, shinY, 0.01, 0.1, crouching ? 0.16 : 0.22, 0.11, palette.primary), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(-0.12, footY, 0.08, 0.13, 0.05, 0.18, GEAR_MAT), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0.12, footY, 0.08, 0.13, 0.05, 0.18, GEAR_MAT), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(-0.36, leftShoulderY, -0.02, 0.08, 0.18, 0.09, palette.primary), pose.pos, pose.yaw, eyeHeight, 0.28, 0, 0.25);
    appendPart(verts, getBoxVerts(-0.42, leftElbowY, -0.06, 0.07, 0.16, 0.08, SKIN_MAT), pose.pos, pose.yaw, eyeHeight, 0.2, 0, 0.08);
    appendPart(verts, getBoxVerts(-0.45, leftHandY, -0.1, 0.06, 0.06, 0.07, SKIN_MAT), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0.34, rightShoulderY, -0.08, 0.08, 0.18, 0.09, palette.primary), pose.pos, pose.yaw, eyeHeight, -0.35 - shotKick * 0.2, -0.08, -0.15);
    appendPart(verts, getBoxVerts(0.42, rightElbowY, -0.25 - shotKick * 0.04, 0.07, 0.17, 0.08, SKIN_MAT), pose.pos, pose.yaw, eyeHeight, -0.75 - shotKick * 0.45, -0.08, -0.05);
    appendPart(verts, getBoxVerts(0.46, rightHandY, -0.42 - shotKick * 0.06, 0.06, 0.06, 0.08, SKIN_MAT), pose.pos, pose.yaw, eyeHeight, -0.2, 0, 0);
    appendPart(verts, getBoxVerts(0.1, gunY, -0.44 - shotKick * 0.08, 0.05, 0.05, 0.22, GUN_MAT), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0.1, gunY + 0.04, -0.69 - shotKick * 0.1, 0.02, 0.02, 0.1, GUN_MAT), pose.pos, pose.yaw, eyeHeight);
    appendPart(verts, getBoxVerts(0.1, gunY - 0.12, -0.28, 0.03, 0.08, 0.04, GUN_MAT), pose.pos, pose.yaw, eyeHeight, 0.45, 0, 0);
    if (shotKick > 0) {
        const f = 0.08 + shotKick * 0.12;
        const fz = -0.83;
        appendPart(verts, getBoxVerts(0.1, gunY - 0.06, fz, f * 1.8, f * 0.12, f * 1.5, FLASH_MAT), pose.pos, pose.yaw, eyeHeight);
        appendPart(verts, getBoxVerts(0.1, gunY - 0.06, fz, f * 0.12, f * 1.5, f * 1.8, FLASH_MAT), pose.pos, pose.yaw, eyeHeight);
        appendPart(verts, getBoxVerts(0.1, gunY - 0.06, fz, f * 0.5, f * 0.5, f * 0.5, FLASH_MAT), pose.pos, pose.yaw, eyeHeight);
    }
    return verts;
}

function appendPart(out, verts, pos, yaw, eyeHeight = STAND_EYE_HEIGHT, rx = 0, ry = 0, rz = 0) {
    const sinX = Math.sin(rx), cosX = Math.cos(rx);
    const sinYLocal = Math.sin(ry), cosYLocal = Math.cos(ry);
    const sinZ = Math.sin(rz), cosZ = Math.cos(rz);
    const sinYaw = Math.sin(yaw || 0);
    const cosYaw = Math.cos(yaw || 0);
    const baseY = (pos?.[1] ?? STAND_EYE_HEIGHT) - eyeHeight;

    for (let i = 0; i < verts.length; i += 9) {
        let x = verts[i];
        let y = verts[i + 1];
        let z = verts[i + 2];
        let nx = verts[i + 6];
        let ny = verts[i + 7];
        let nz = verts[i + 8];
        let yx = y * cosX - z * sinX;
        let zx = y * sinX + z * cosX;
        y = yx; z = zx;
        let nyx = ny * cosX - nz * sinX;
        let nzx = ny * sinX + nz * cosX;
        ny = nyx; nz = nzx;
        let xy = x * cosYLocal + z * sinYLocal;
        let zy = -x * sinYLocal + z * cosYLocal;
        x = xy; z = zy;
        let nxy = nx * cosYLocal + nz * sinYLocal;
        let nzy = -nx * sinYLocal + nz * cosYLocal;
        nx = nxy; nz = nzy;
        let xz = x * cosZ - y * sinZ;
        let yz = x * sinZ + y * cosZ;
        x = xz; y = yz;
        let nxz = nx * cosZ - ny * sinZ;
        let nyz = nx * sinZ + ny * cosZ;
        nx = nxz; ny = nyz;
        const worldX = x * cosYaw - z * sinYaw + (pos?.[0] ?? 0);
        const worldZ = x * sinYaw + z * cosYaw + (pos?.[2] ?? 0);
        const worldNX = nx * cosYaw - nz * sinYaw;
        const worldNZ = nx * sinYaw + nz * cosYaw;
        out.push(worldX, y + baseY, worldZ, verts[i + 3], verts[i + 4], verts[i + 5], worldNX, ny, worldNZ);
    }
}

function getBoxVerts(cx, cy, cz, hw, hh, hd, mat) {
    const key = `${cx}|${cy}|${cz}|${hw}|${hh}|${hd}|${mat}`;
    let verts = BOX_CACHE.get(key);
    if (!verts) {
        verts = boxVerts(cx, cy, cz, hw, hh, hd, mat);
        BOX_CACHE.set(key, verts);
    }
    return verts;
}
