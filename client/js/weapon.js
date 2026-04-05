import { boxVerts } from './renderer.js';
import {
    RELOAD_DURATION_MS,
    UTILITY_BOMB,
    UTILITY_FLASHBANG,
    UTILITY_SMOKE,
    WEAPON_DEFS,
    WEAPON_KNIFE,
    WEAPON_MACHINE_GUN,
    WEAPON_PISTOL,
} from './economy.js';

const KNIFE_SLASH_ANIM_SCALE = 1.45;
const KNIFE_STAB_ANIM_SCALE = 1.3;

// Machine gun 30-shot spray pattern: [pitchAdd, yawAdd]
const MG_SPRAY_PATTERN = [
    [0.176, 0.000], [0.160, 0.000], [0.152, 0.000], [0.144, 0.000],
    [0.136, 0.000], [0.128, 0.004], [0.120, 0.004],
    [0.104, 0.024], [0.096, 0.028], [0.088, 0.030], [0.080, 0.030],
    [0.072, 0.028], [0.064, 0.024], [0.056, 0.019],
    [0.048,-0.027], [0.040,-0.030], [0.040,-0.032], [0.032,-0.032],
    [0.032,-0.030], [0.024,-0.027], [0.024,-0.022], [0.016,-0.016],
    [0.016, 0.019], [0.016, 0.016], [0.012, 0.013], [0.012, 0.010],
    [0.008, 0.006], [0.008, 0.004], [0.008, 0.000], [0.008, 0.000],
];

const PISTOL_SPRAY_PATTERN = [
    [0.18, 0.000], [0.16, 0.008], [0.14, 0.012], [0.12, 0.008],
    [0.10, 0.005], [0.09,-0.005], [0.08,-0.008],
];

export function createWeapon() {
    return {
        kind: WEAPON_KNIFE,
        reloadTimeMs: 0,
        slots: {
            [WEAPON_KNIFE]: createSlotState(),
            [WEAPON_PISTOL]: createSlotState(),
            [WEAPON_MACHINE_GUN]: createSlotState(),
            [UTILITY_BOMB]: createSlotState(),
            [UTILITY_SMOKE]: createSlotState(),
            [UTILITY_FLASHBANG]: createSlotState(),
        },
    };
}

export function setWeaponType(weapon, kind) {
    if (weapon.slots[kind]) {
        weapon.kind = kind;
    }
}

export function getWeaponType(weapon) {
    return weapon.kind;
}

export function setWeaponReloadTime(weapon, reloadTimeMs) {
    weapon.reloadTimeMs = Math.max(0, reloadTimeMs || 0);
}

export function updateWeapon(weapon, dt, moving, crouching = false) {
    for (const [kind, slot] of Object.entries(weapon.slots)) {
        updateSlot(slot, dt, kind === weapon.kind ? moving : false, crouching);
    }
}

export function canFire(weapon) {
    return weapon.slots[weapon.kind].cooldown <= 0;
}

export function fire(weapon, aiming = false, alternate = false, moving = false) {
    const slot = weapon.slots[weapon.kind];
    const kind = weapon.kind;
    const def = WEAPON_DEFS[kind] || WEAPON_DEFS[WEAPON_KNIFE];
    const aimRecoilMultiplier = aiming && def.canAim ? def.adsRecoilMultiplier : 1;
    const moveRecoilMultiplier = moving ? 1.35 : 1;
    const isFirstShot = slot.shotIndex === 0;
    const fireDuration = alternate && kind === WEAPON_KNIFE
        ? (WEAPON_DEFS[kind].altFireRate || WEAPON_DEFS[kind].fireRate)
        : WEAPON_DEFS[kind].fireRate;
    const attackDuration = getAttackDuration(kind, alternate, fireDuration);
    slot.cooldown = fireDuration;
    slot.attackDuration = attackDuration;
    slot.attackTimeLeft = attackDuration;
    slot.attackStyle = alternate && kind === WEAPON_KNIFE ? 'alternate' : 'primary';
    slot.attackDirection = kind === WEAPON_KNIFE && !alternate
        ? (Math.random() < 0.5 ? 1 : -1)
        : 0;
    slot.flashTime = kind === WEAPON_KNIFE || kind === UTILITY_BOMB || kind === UTILITY_SMOKE || kind === UTILITY_FLASHBANG
        ? 0
        : 0.06;
    slot.shotIndex += 1;
    slot.timeSinceLastShot = 0;

    if (kind === WEAPON_MACHINE_GUN) {
        const patternIdx = Math.min(slot.shotIndex - 1, MG_SPRAY_PATTERN.length - 1);
        const [pitchAdd, yawAdd] = MG_SPRAY_PATTERN[patternIdx] || [0.005, 0];
        const firstShotMul = isFirstShot && !moving ? 0 : 1;
        slot.kickback = Math.min(1.2, slot.kickback + 0.8 * aimRecoilMultiplier);
        slot.recoilTargetPitch += pitchAdd * firstShotMul * aimRecoilMultiplier * moveRecoilMultiplier;
        slot.recoilTargetYaw += yawAdd * firstShotMul * aimRecoilMultiplier * moveRecoilMultiplier;
        slot.viewPunchPitch += 0.015 * aimRecoilMultiplier;
        slot.viewPunchYaw += (Math.random() - 0.5) * 0.01;
        slot.heat = Math.min(1, slot.heat + 0.12);
        return;
    }

    if (kind === WEAPON_PISTOL) {
        const patternIdx = Math.min(slot.shotIndex - 1, PISTOL_SPRAY_PATTERN.length - 1);
        const [pitchAdd, yawAdd] = PISTOL_SPRAY_PATTERN[patternIdx] || [0.02, 0];
        const firstShotMul = isFirstShot && !moving ? 0 : 1;
        slot.kickback = Math.min(1.0, slot.kickback + 0.7 * aimRecoilMultiplier);
        slot.recoilTargetPitch += pitchAdd * firstShotMul * aimRecoilMultiplier * moveRecoilMultiplier;
        slot.recoilTargetYaw += yawAdd * firstShotMul * aimRecoilMultiplier * moveRecoilMultiplier;
        slot.viewPunchPitch += 0.02 * aimRecoilMultiplier;
        slot.viewPunchYaw += (Math.random() - 0.5) * 0.012;
        slot.heat = Math.min(1, slot.heat + 0.25);
        return;
    }

    if (kind === UTILITY_BOMB || kind === UTILITY_SMOKE || kind === UTILITY_FLASHBANG) {
        slot.kickback = Math.min(0.8, slot.kickback + 0.75);
        slot.recoilTargetPitch += 0.06;
        slot.recoilTargetYaw += [-1, 1][slot.shotIndex % 2] * 0.02;
        slot.heat = Math.min(1, slot.heat + 0.18);
        return;
    }

    if (alternate && kind === WEAPON_KNIFE) {
        slot.kickback = Math.min(1.1, slot.kickback + 0.95);
        slot.recoilTargetPitch += 0.06;
        slot.recoilTargetYaw += [-1, 1][slot.shotIndex % 2] * 0.028;
        slot.heat = Math.min(1, slot.heat + 0.2);
        return;
    }

    slot.kickback = Math.min(0.9, slot.kickback + 0.65);
    slot.recoilTargetPitch += 0.03;
    slot.recoilTargetYaw += [-1, 1][slot.shotIndex % 2] * 0.01;
    slot.heat = Math.min(1, slot.heat + 0.14);
}

export function weaponVerts(weapon) {
    const slot = weapon.slots[weapon.kind];
    const reloadPhase = getReloadPhase(weapon);
    if (weapon.kind === WEAPON_MACHINE_GUN) return machineGunVerts(slot, reloadPhase);
    if (weapon.kind === WEAPON_PISTOL) return pistolVerts(slot, reloadPhase);
    if (weapon.kind === UTILITY_BOMB) return bombVerts(slot, reloadPhase);
    if (weapon.kind === UTILITY_SMOKE) return smokeVerts(slot, reloadPhase);
    if (weapon.kind === UTILITY_FLASHBANG) return flashbangVerts(slot, reloadPhase);
    return knifeVerts(slot, reloadPhase);
}

export function getCrosshairGap(weapon, aiming = false, crouching = false, moving = false) {
    const kind = weapon.kind;
    const slot = weapon.slots[kind];
    if (!slot) return 12;
    const crouchMultiplier = crouching ? 0.72 : 1;
    const moveBonus = moving ? 3 : 0;

    if (kind === WEAPON_MACHINE_GUN) {
        return (aiming ? 5 : 12) * crouchMultiplier + moveBonus + slot.heat * 4;
    }
    if (kind === WEAPON_PISTOL) {
        return (aiming ? 4 : 10) * crouchMultiplier + moveBonus + slot.heat * 3;
    }
    if (kind === WEAPON_KNIFE) {
        return 10 + slot.heat * 3;
    }
    return 12 + slot.heat * 3;
}

export function getCrosshairOffsetY(weapon) {
    const slot = weapon.slots[weapon.kind];
    if (!slot) return 0;
    const viewScale = WEAPON_DEFS[weapon.kind]?.recoilViewScale || 1;
    return -(slot.recoilTargetPitch / viewScale * 80);
}

export function consumeRecoilDelta(weapon) {
    const slot = weapon.slots[weapon.kind];
    const pitch = slot.recoilPitch - slot.appliedPitch;
    const yaw = slot.recoilYaw - slot.appliedYaw;
    slot.appliedPitch = slot.recoilPitch;
    slot.appliedYaw = slot.recoilYaw;
    return { pitch, yaw };
}

export function getViewPunch(weapon) {
    const slot = weapon.slots[weapon.kind];
    if (!slot) return { pitch: 0, yaw: 0 };
    return {
        pitch: slot.viewPunchPitch,
        yaw: slot.viewPunchYaw,
    };
}

function createSlotState() {
    return {
        cooldown: 0,
        attackDuration: 0,
        attackTimeLeft: 0,
        attackStyle: '',
        attackDirection: 0,
        bobPhase: 0,
        bobWeight: 0,
        kickback: 0,
        recoilTargetPitch: 0,
        recoilTargetYaw: 0,
        recoilPitch: 0,
        recoilYaw: 0,
        viewPunchPitch: 0,
        viewPunchYaw: 0,
        flashTime: 0,
        appliedPitch: 0,
        appliedYaw: 0,
        shotIndex: 0,
        heat: 0,
        timeSinceLastShot: Infinity,
    };
}

const RECOIL_APPROACH_SPEED = 18;
const RECOIL_RECOVERY_THRESHOLD = 0.18;
const RECOIL_DECAY_EXP = 3.5;
const RECOIL_DECAY_LIN = 0.5;
const VIEW_PUNCH_DECAY = 12;

function updateSlot(slot, dt, moving, crouching = false) {
    slot.cooldown = Math.max(0, slot.cooldown - dt);
    slot.attackTimeLeft = Math.max(0, slot.attackTimeLeft - dt);
    if (slot.attackTimeLeft <= 0) {
        slot.attackDuration = 0;
        slot.attackStyle = '';
        slot.attackDirection = 0;
    }

    const crouchRecovery = crouching ? 1.5 : 1;
    slot.kickback = Math.max(0, slot.kickback - dt * 14);
    slot.heat = Math.max(0, slot.heat - dt * 0.8 * crouchRecovery);
    slot.flashTime = Math.max(0, slot.flashTime - dt);
    slot.timeSinceLastShot += dt;

    if (slot.timeSinceLastShot > RECOIL_RECOVERY_THRESHOLD) {
        const decayDt = dt * crouchRecovery;
        const expFactor = Math.exp(-RECOIL_DECAY_EXP * decayDt);
        slot.recoilTargetPitch *= expFactor;
        slot.recoilTargetYaw *= expFactor;
        const linDecay = RECOIL_DECAY_LIN * decayDt;
        if (slot.recoilTargetPitch > 0) {
            slot.recoilTargetPitch = Math.max(0, slot.recoilTargetPitch - linDecay);
        } else {
            slot.recoilTargetPitch = Math.min(0, slot.recoilTargetPitch + linDecay);
        }
        if (slot.recoilTargetYaw > 0) {
            slot.recoilTargetYaw = Math.max(0, slot.recoilTargetYaw - linDecay);
        } else {
            slot.recoilTargetYaw = Math.min(0, slot.recoilTargetYaw + linDecay);
        }
    }

    const blend = Math.min(1, dt * RECOIL_APPROACH_SPEED);
    slot.recoilPitch += (slot.recoilTargetPitch - slot.recoilPitch) * blend;
    slot.recoilYaw += (slot.recoilTargetYaw - slot.recoilYaw) * blend;

    const vpDecay = Math.min(1, dt * VIEW_PUNCH_DECAY);
    slot.viewPunchPitch *= (1 - vpDecay);
    slot.viewPunchYaw *= (1 - vpDecay);
    if (Math.abs(slot.viewPunchPitch) < 0.0001) slot.viewPunchPitch = 0;
    if (Math.abs(slot.viewPunchYaw) < 0.0001) slot.viewPunchYaw = 0;

    if (Math.abs(slot.recoilPitch) < 0.0001 && slot.recoilTargetPitch === 0) slot.recoilPitch = 0;
    if (Math.abs(slot.recoilYaw) < 0.0001 && slot.recoilTargetYaw === 0) slot.recoilYaw = 0;

    if (slot.heat <= 0) {
        slot.shotIndex = 0;
    }

    if (moving) {
        slot.bobWeight = Math.min(1, slot.bobWeight + dt * 6);
        slot.bobPhase += dt * 10;
    } else {
        slot.bobWeight = Math.max(0, slot.bobWeight - dt * 4);
        slot.bobPhase += dt * 3;
    }
}

function getAttackBlend(slot, kind) {
    const phase = getAttackPhase(slot, kind);
    if (phase <= 0) return 0;
    return Math.sin(phase * Math.PI);
}

function getAttackPhase(slot, kind) {
    const duration = slot.attackDuration || WEAPON_DEFS[kind]?.fireRate || 0;
    if (duration <= 0 || slot.attackTimeLeft <= 0) return 0;
    return Math.min(1, Math.max(0, 1 - slot.attackTimeLeft / duration));
}

// ─── Reload animation phases ───
// Phase 0.00-0.15: tilt weapon down + hand reaches mag well
// Phase 0.15-0.40: pull mag out (left hand pulls down)
// Phase 0.40-0.55: mag out of frame / hand goes to pocket
// Phase 0.55-0.75: new mag comes up and inserts
// Phase 0.75-0.90: hand slaps mag home, weapon returns
// Phase 0.90-1.00: settle back to idle

function reloadTransform(phase) {
    if (phase <= 0) return { ox: 0, oy: 0, oz: 0, pitch: 0, yaw: 0, roll: 0, magOff: 0 };

    // Mag offset: 0 = seated, 1 = fully removed
    let magOff = 0;
    let ox = 0, oy = 0, oz = 0, pitch = 0, yaw = 0, roll = 0;

    if (phase < 0.15) {
        // Tilt down, prepare
        const t = phase / 0.15;
        const s = smoothstep(t);
        pitch = s * 0.35;
        roll = s * 0.12;
        oy = -s * 0.04;
        yaw = s * 0.06;
    } else if (phase < 0.40) {
        // Pull mag out
        const t = (phase - 0.15) / 0.25;
        const s = smoothstep(t);
        pitch = 0.35 + s * 0.15;
        roll = 0.12 + s * 0.08;
        oy = -0.04 - s * 0.06;
        yaw = 0.06;
        magOff = s;
    } else if (phase < 0.55) {
        // Mag out of frame, hand to pocket
        const t = (phase - 0.40) / 0.15;
        const s = smoothstep(t);
        pitch = 0.50 - s * 0.1;
        roll = 0.20 - s * 0.06;
        oy = -0.10 + s * 0.02;
        yaw = 0.06 - s * 0.02;
        magOff = 1;
    } else if (phase < 0.75) {
        // New mag comes up and inserts
        const t = (phase - 0.55) / 0.20;
        const s = smoothstep(t);
        pitch = 0.40 - s * 0.15;
        roll = 0.14 - s * 0.06;
        oy = -0.08 + s * 0.04;
        yaw = 0.04;
        magOff = 1 - s;
    } else if (phase < 0.90) {
        // Slap mag home, weapon returns
        const t = (phase - 0.75) / 0.15;
        const s = smoothstep(t);
        pitch = 0.25 - s * 0.25;
        roll = 0.08 - s * 0.08;
        oy = -0.04 + s * 0.04;
        oz = -s * 0.03;
        yaw = 0.04 - s * 0.04;
        // Slap bump at start of this phase
        const bump = Math.sin(t * Math.PI) * 0.015;
        oy -= bump;
    } else {
        // Settle to idle
        const t = (phase - 0.90) / 0.10;
        const s = smoothstep(t);
        oz = -0.03 * (1 - s);
    }

    return { ox, oy, oz, pitch, yaw, roll, magOff };
}

// ─── Weapon models ───

function machineGunVerts(slot, reloadPhase) {
    const { ox, oy, oz, pitch, yaw, roll } = baseTransform(slot, 0.3, -0.22, -0.68, reloadPhase);
    const reload = reloadTransform(reloadPhase);
    const v = [];

    // ── Right hand (trigger hand) — follows weapon ──
    // Wrist
    appendPart(v, boxVerts(-0.04, -0.09, 0.11, 0.085, 0.18, 0.1, 10), ox, oy, oz, pitch * 0.55, yaw * 0.28, roll * 0.58);
    // Forearm
    appendPart(v, boxVerts(-0.015, -0.26, 0.21, 0.074, 0.145, 0.09, 10), ox, oy, oz, pitch * 0.28, yaw * 0.16, roll * 0.48);
    // Fingers curled on grip
    appendPart(v, boxVerts(0.015, -0.37, 0.3, 0.066, 0.06, 0.075, 9), ox, oy, oz, pitch * 0.18, yaw * 0.08, roll * 0.34);
    // Trigger finger
    appendPart(v, boxVerts(-0.035, -0.06, -0.01, 0.012, 0.035, 0.04, 9), ox, oy, oz, pitch * 0.5, yaw * 0.2, roll * 0.4);

    // ── Left hand (support / reload hand) ──
    const lhPitch = -0.33 + pitch + reload.pitch * 0.8;
    const lhYaw = yaw * 0.46 + reload.yaw * 0.5;
    const lhRoll = roll * 0.28 + reload.roll * 0.4;
    const lhOy = oy + reload.oy * 1.5;
    // Wrist
    appendPart(v, boxVerts(0.19, -0.035, -0.06, 0.058, 0.16, 0.082, 10), ox, lhOy, oz, lhPitch, lhYaw, lhRoll);
    // Forearm
    appendPart(v, boxVerts(0.24, -0.2, 0.025, 0.055, 0.135, 0.07, 10), ox, lhOy, oz, -0.54 + pitch + reload.pitch * 0.6, yaw * 0.3, roll * 0.18);
    // Fingers
    appendPart(v, boxVerts(0.275, -0.3, 0.11, 0.05, 0.06, 0.06, 9), ox, lhOy, oz, -0.18 + pitch * 0.4, yaw * 0.18, roll * 0.12);
    // Thumb
    appendPart(v, boxVerts(0.14, -0.02, -0.08, 0.012, 0.04, 0.05, 9), ox, lhOy, oz, lhPitch, lhYaw, lhRoll);

    // ── Receiver / upper body ──
    appendPart(v, boxVerts(0.0, 0.0, 0.06, 0.072, 0.058, 0.28, 10), ox, oy, oz, pitch, yaw, roll);
    // Top rail
    appendPart(v, boxVerts(0.0, 0.046, 0.0, 0.056, 0.022, 0.24, 3), ox, oy, oz, pitch, yaw, roll);
    // Rail detail
    appendPart(v, boxVerts(0.0, 0.062, 0.0, 0.042, 0.006, 0.22, 3), ox, oy, oz, pitch, yaw, roll);
    // Side rail
    appendPart(v, boxVerts(0.054, -0.004, 0.07, 0.014, 0.048, 0.14, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.054, -0.004, 0.07, 0.014, 0.048, 0.14, 3), ox, oy, oz, pitch, yaw, roll);
    // Ejection port
    appendPart(v, boxVerts(0.06, 0.01, -0.04, 0.008, 0.03, 0.06, 10), ox, oy, oz, pitch, yaw, roll);

    // ── Handguard ──
    appendPart(v, boxVerts(0.0, 0.002, 0.36, 0.066, 0.05, 0.16, 10), ox, oy, oz, pitch, yaw, roll);
    // Handguard top rail
    appendPart(v, boxVerts(0.0, 0.042, 0.22, 0.046, 0.02, 0.17, 3), ox, oy, oz, pitch, yaw, roll);
    // Handguard vents (heat shield details)
    appendPart(v, boxVerts(0.058, 0.002, 0.32, 0.006, 0.028, 0.04, 10), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0.058, 0.002, 0.40, 0.006, 0.028, 0.04, 10), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.058, 0.002, 0.32, 0.006, 0.028, 0.04, 10), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.058, 0.002, 0.40, 0.006, 0.028, 0.04, 10), ox, oy, oz, pitch, yaw, roll);

    // ── Magazine (animated during reload) ──
    const magDrop = reload.magOff * 0.22;
    appendPart(v, boxVerts(0.0, -0.12 - magDrop, 0.09, 0.04, 0.09, 0.052, 3), ox, oy + (reload.magOff > 0.5 ? -0.15 : 0), oz, pitch + reload.magOff * 0.1, yaw, roll);
    // Mag base plate
    appendPart(v, boxVerts(0.0, -0.215 - magDrop, 0.09, 0.044, 0.008, 0.056, 3), ox, oy + (reload.magOff > 0.5 ? -0.15 : 0), oz, pitch + reload.magOff * 0.1, yaw, roll);

    // ── Mag well ──
    appendPart(v, boxVerts(0.0, -0.058, 0.0, 0.028, 0.024, 0.028, 3), ox, oy, oz, pitch, yaw, roll);

    // ── Pistol grip ──
    appendPart(v, boxVerts(0.0, -0.115, -0.18, 0.03, 0.092, 0.032, 10), ox, oy, oz, pitch, yaw, roll);
    // Grip texture
    appendPart(v, boxVerts(0.032, -0.115, -0.18, 0.004, 0.075, 0.026, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.032, -0.115, -0.18, 0.004, 0.075, 0.026, 3), ox, oy, oz, pitch, yaw, roll);

    // ── Stock ──
    appendPart(v, boxVerts(0.0, 0.008, -0.36 - slot.kickback * 0.05, 0.038, 0.034, 0.27, 3), ox, oy, oz, pitch, yaw, roll);
    // Stock cheek rest
    appendPart(v, boxVerts(0.0, 0.038, -0.42 - slot.kickback * 0.04, 0.03, 0.012, 0.12, 10), ox, oy, oz, pitch, yaw, roll);
    // Stock butt pad
    appendPart(v, boxVerts(0.0, 0.012, -0.63 - slot.kickback * 0.06, 0.042, 0.04, 0.02, 10), ox, oy, oz, pitch, yaw, roll);

    // ── Barrel ──
    appendPart(v, boxVerts(0.0, 0.018, -0.64 - slot.kickback * 0.06, 0.013, 0.013, 0.13, 3), ox, oy, oz, pitch, yaw, roll);
    // Muzzle device / flash hider
    appendPart(v, boxVerts(0.0, 0.024, -0.78 - slot.kickback * 0.06, 0.02, 0.02, 0.026, 10), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0.014, 0.024, -0.80 - slot.kickback * 0.06, 0.006, 0.014, 0.012, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.014, 0.024, -0.80 - slot.kickback * 0.06, 0.006, 0.014, 0.012, 3), ox, oy, oz, pitch, yaw, roll);

    // ── Sights ──
    // Rear sight
    appendPart(v, boxVerts(0.0, 0.078, 0.18, 0.018, 0.018, 0.018, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0.016, 0.078, 0.18, 0.006, 0.022, 0.008, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.016, 0.078, 0.18, 0.006, 0.022, 0.008, 3), ox, oy, oz, pitch, yaw, roll);
    // Front sight
    appendPart(v, boxVerts(0.0, 0.08, -0.49, 0.012, 0.018, 0.012, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0.0, 0.094, -0.67, 0.006, 0.03, 0.006, 3), ox, oy, oz, pitch, yaw, roll);

    // ── Charging handle ──
    appendPart(v, boxVerts(0.042, 0.022, 0.13, 0.01, 0.01, 0.07, 10), ox, oy, oz, pitch, yaw, roll);

    // ── Bolt carrier (visible through ejection port) ──
    appendPart(v, boxVerts(0.0, 0.02, 0.0, 0.04, 0.025, 0.18, 3), ox, oy, oz, pitch, yaw, roll);

    appendFlash(v, slot, ox, oy, oz, pitch, yaw, roll, -0.84);
    return v;
}

function pistolVerts(slot, reloadPhase) {
    const { ox, oy, oz, pitch, yaw, roll } = baseTransform(slot, 0.29, -0.19, -0.54, reloadPhase);
    const reload = reloadTransform(reloadPhase);
    const v = [];

    // ── Right hand (gripping) ──
    appendPart(v, boxVerts(0.17, -0.03, -0.03, 0.056, 0.15, 0.078, 10), ox, oy, oz, -0.28 + pitch, yaw * 0.42, roll * 0.24);
    appendPart(v, boxVerts(0.212, -0.18, 0.035, 0.054, 0.138, 0.07, 10), ox, oy, oz, -0.61 + pitch, yaw * 0.32, roll * 0.18);
    appendPart(v, boxVerts(0.248, -0.285, 0.095, 0.046, 0.055, 0.055, 9), ox, oy, oz, -0.16, yaw * 0.18, roll * 0.1);
    // Thumb
    appendPart(v, boxVerts(0.12, -0.015, -0.06, 0.012, 0.035, 0.05, 9), ox, oy, oz, -0.2 + pitch * 0.4, yaw * 0.3, roll * 0.2);
    // Trigger finger
    appendPart(v, boxVerts(-0.02, -0.04, -0.015, 0.01, 0.03, 0.035, 9), ox, oy, oz, pitch * 0.5, yaw * 0.2, roll * 0.3);

    // ── Left hand (support / reload) ──
    const lhPitch = -0.45 + pitch + reload.pitch * 1.0;
    const lhOy = oy + reload.oy * 2.0;
    const lhOz = oz + reload.oz * 1.5;
    appendPart(v, boxVerts(0.0, -0.012, 0.025, 0.048, 0.046, 0.13, 10), ox, lhOy, lhOz, lhPitch, yaw * 0.3, roll * 0.2);
    // Left fingers wrapping
    appendPart(v, boxVerts(0.04, -0.04, 0.04, 0.02, 0.035, 0.04, 9), ox, lhOy, lhOz, lhPitch - 0.2, yaw * 0.2, roll * 0.15);

    // ── Slide ──
    appendPart(v, boxVerts(0.0, 0.032, -0.06, 0.055, 0.028, 0.2, 3), ox, oy, oz, pitch, yaw, roll);
    // Slide serrations (rear)
    appendPart(v, boxVerts(0.048, 0.032, 0.08, 0.01, 0.024, 0.03, 10), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.048, 0.032, 0.08, 0.01, 0.024, 0.03, 10), ox, oy, oz, pitch, yaw, roll);
    // Slide top flat
    appendPart(v, boxVerts(0.0, 0.056, -0.06, 0.036, 0.006, 0.16, 3), ox, oy, oz, pitch, yaw, roll);
    // Ejection port
    appendPart(v, boxVerts(0.048, 0.038, -0.08, 0.008, 0.018, 0.04, 10), ox, oy, oz, pitch, yaw, roll);

    // ── Barrel ──
    appendPart(v, boxVerts(0.0, 0.026, -0.31 - slot.kickback * 0.06, 0.014, 0.014, 0.1, 3), ox, oy, oz, pitch, yaw, roll);
    // Muzzle
    appendPart(v, boxVerts(0.0, 0.03, -0.415 - slot.kickback * 0.06, 0.018, 0.018, 0.024, 10), ox, oy, oz, pitch, yaw, roll);

    // ── Frame / grip ──
    appendPart(v, boxVerts(0.0, -0.085, 0.055, 0.028, 0.06, 0.038, 10), ox, oy, oz, pitch, yaw, roll);
    // Grip texture
    appendPart(v, boxVerts(0.03, -0.085, 0.055, 0.004, 0.05, 0.032, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.03, -0.085, 0.055, 0.004, 0.05, 0.032, 3), ox, oy, oz, pitch, yaw, roll);
    // Trigger guard
    appendPart(v, boxVerts(0.0, -0.123, 0.1, 0.03, 0.012, 0.04, 3), ox, oy, oz, pitch, yaw, roll);
    // Trigger
    appendPart(v, boxVerts(0.0, -0.058, -0.004, 0.012, 0.022, 0.008, 3), ox, oy, oz, pitch, yaw, roll);
    // Beaver tail
    appendPart(v, boxVerts(0.0, -0.025, -0.04, 0.016, 0.018, 0.03, 10), ox, oy, oz, pitch, yaw, roll);

    // ── Magazine (animated during reload) ──
    const magDrop = reload.magOff * 0.16;
    const magVis = reload.magOff > 0.95 ? 0 : 1; // hide mag briefly when swapping
    if (magVis) {
        appendPart(v, boxVerts(0.0, -0.085 - magDrop, 0.055, 0.022, 0.054, 0.032, 3), ox, oy + (reload.magOff > 0.5 ? -0.1 : 0), oz, pitch + reload.magOff * 0.08, yaw, roll);
        // Mag base plate
        appendPart(v, boxVerts(0.0, -0.143 - magDrop, 0.055, 0.025, 0.006, 0.035, 3), ox, oy + (reload.magOff > 0.5 ? -0.1 : 0), oz, pitch + reload.magOff * 0.08, yaw, roll);
    }

    // ── Sights ──
    appendPart(v, boxVerts(0.0, 0.062, 0.04, 0.016, 0.014, 0.014, 3), ox, oy, oz, pitch, yaw, roll);
    // Front sight blade
    appendPart(v, boxVerts(0.0, 0.06, -0.305, 0.009, 0.014, 0.009, 3), ox, oy, oz, pitch, yaw, roll);
    // Rear sight notch
    appendPart(v, boxVerts(0.012, 0.062, 0.04, 0.004, 0.018, 0.008, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.012, 0.062, 0.04, 0.004, 0.018, 0.008, 3), ox, oy, oz, pitch, yaw, roll);

    // ── Accessory rail ──
    appendPart(v, boxVerts(0.0, -0.042, -0.1, 0.02, 0.006, 0.08, 3), ox, oy, oz, pitch, yaw, roll);

    appendFlash(v, slot, ox, oy, oz, pitch, yaw, roll, -0.46);
    return v;
}

function knifeVerts(slot, reloadPhase) {
    const phase = getAttackPhase(slot, WEAPON_KNIFE);
    const attack = getAttackBlend(slot, WEAPON_KNIFE);
    const heavyAttack = slot.attackStyle === 'alternate' && attack > 0;
    const base = baseTransform(slot, 0.34, -0.12, -0.3, reloadPhase);
    let ox = base.ox + 0.06 - attack * 0.05;
    let oy = base.oy - 0.02 + attack * 0.03;
    let oz = base.oz - 0.05 - attack * 0.29;
    let pitch = base.pitch * 0.16 + 0.18 - attack * 1.28;
    let yaw = base.yaw * 0.2 + 0.34 * (1 - attack);
    let roll = base.roll * 0.1 - 0.62 * (1 - attack) - attack * 0.08;

    if (heavyAttack) {
        const windup = Math.min(1, phase / 0.26);
        const stab = phase <= 0.26 ? 0 : Math.min(1, (phase - 0.26) / 0.42);
        const recover = phase <= 0.68 ? 0 : Math.min(1, (phase - 0.68) / 0.32);
        const leftX = mix(0.04, -0.7, windup);
        const leftY = mix(-0.03, 0.12, windup);
        const leftZ = mix(-0.04, 0.08, windup);
        const stabX = mix(-0.7, -0.08, stab);
        const stabY = mix(0.12, 0.01, stab);
        const stabZ = mix(0.08, -0.42, stab);
        ox = base.ox + (phase <= 0.26 ? leftX : phase <= 0.68 ? stabX : mix(-0.08, 0.62, recover));
        oy = base.oy + (phase <= 0.26 ? leftY : phase <= 0.68 ? stabY : mix(0.01, -0.02, recover));
        oz = base.oz + (phase <= 0.26 ? leftZ : phase <= 0.68 ? stabZ : mix(-0.42, 0.04, recover));
        pitch = base.pitch * 0.14 + (phase <= 0.26 ? mix(0.08, -0.52, windup) : phase <= 0.68 ? mix(-0.52, -1.22, stab) : mix(-1.22, -0.08, recover));
        yaw = base.yaw * 0.16 + (phase <= 0.26 ? mix(0.28, 0.94, windup) : phase <= 0.68 ? mix(0.94, 0.06, stab) : mix(0.06, -0.64, recover));
        roll = base.roll * 0.08 + (phase <= 0.26 ? mix(-0.44, -1.16, windup) : phase <= 0.68 ? mix(-1.16, -0.18, stab) : mix(-0.18, 0.92, recover));
    } else if (attack > 0) {
        const swingDir = slot.attackDirection || 1;
        const windup = Math.min(1, phase / 0.18);
        const slash = phase <= 0.18 ? 0 : Math.min(1, (phase - 0.18) / 0.82);
        const side = ((slash * 2) - 1) * swingDir;
        ox = base.ox + side * 0.78;
        oy = base.oy + 0.05 + windup * 0.07 - slash * 0.03;
        oz = base.oz - 0.02 + windup * 0.05 - slash * 0.12;
        pitch = base.pitch * 0.12 - 0.12 + windup * 0.08 - slash * 0.26;
        yaw = base.yaw * 0.16 - side * 1.22;
        roll = base.roll * 0.08 + side * 2.2;
    }

    const v = [];

    // ── Hand ──
    appendPart(v, boxVerts(0.17, -0.035, 0.045, 0.056, 0.15, 0.078, 10), ox, oy, oz, -0.36 + pitch * 0.28, yaw * 0.42, roll * 0.24);
    appendPart(v, boxVerts(0.212, -0.19, 0.11, 0.053, 0.136, 0.07, 10), ox, oy, oz, -0.55 + pitch * 0.18, yaw * 0.28, roll * 0.16);
    appendPart(v, boxVerts(0.245, -0.29, 0.18, 0.047, 0.055, 0.055, 9), ox, oy, oz, -0.14 + pitch * 0.08, yaw * 0.14, roll * 0.08);
    // Thumb wrapping handle
    appendPart(v, boxVerts(0.12, -0.02, 0.02, 0.01, 0.03, 0.04, 9), ox, oy, oz, -0.3 + pitch * 0.2, yaw * 0.3, roll * 0.18);

    // ── Handle ──
    appendPart(v, boxVerts(0.0, -0.075, 0.05, 0.018, 0.08, 0.032, 14), ox, oy, oz, pitch, yaw, roll);
    // Handle texture grooves
    appendPart(v, boxVerts(0.019, -0.075, 0.05, 0.003, 0.065, 0.026, 10), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.019, -0.075, 0.05, 0.003, 0.065, 0.026, 10), ox, oy, oz, pitch, yaw, roll);
    // Pommel
    appendPart(v, boxVerts(0.0, -0.155, 0.085, 0.02, 0.012, 0.028, 3), ox, oy, oz, pitch, yaw, roll);

    // ── Guard ──
    appendPart(v, boxVerts(0.0, 0.0, 0.01, 0.052, 0.014, 0.022, 3), ox, oy, oz, pitch, yaw, roll);
    // Guard tips
    appendPart(v, boxVerts(0.048, 0.0, 0.01, 0.01, 0.01, 0.015, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.048, 0.0, 0.01, 0.01, 0.01, 0.015, 3), ox, oy, oz, pitch, yaw, roll);

    // ── Blade ──
    // Flat of blade
    appendPart(v, boxVerts(0.0, 0.09, -0.015 - slot.kickback * 0.03, 0.012, 0.16, 0.026, 3), ox, oy, oz, pitch, yaw, roll);
    // Blade spine (thicker back edge)
    appendPart(v, boxVerts(0.0, 0.09, 0.012 - slot.kickback * 0.03, 0.008, 0.15, 0.008, 3), ox, oy, oz, pitch, yaw, roll);
    // Blade upper section (narrows)
    appendPart(v, boxVerts(0.0, 0.31, -0.035 - slot.kickback * 0.05, 0.009, 0.14, 0.018, 3), ox, oy, oz, pitch, yaw, roll);
    // Blade tip
    appendPart(v, boxVerts(0.0, 0.47, -0.05 - slot.kickback * 0.06, 0.005, 0.055, 0.01, 4), ox, oy, oz, pitch, yaw, roll);
    // Fuller (blood groove)
    appendPart(v, boxVerts(0.0, 0.16, 0.005, 0.005, 0.12, 0.005, 10), ox, oy, oz, pitch, yaw, roll);

    return v;
}

function bombVerts(slot, reloadPhase) {
    const { ox, oy, oz, pitch, yaw, roll } = baseTransform(slot, 0.24, -0.15, -0.38, reloadPhase);
    const v = [];

    // Hand
    appendPart(v, boxVerts(0.16, -0.01, -0.01, 0.055, 0.14, 0.075, 10), ox, oy, oz, -0.35 + pitch, yaw * 0.35, roll * 0.2);
    appendPart(v, boxVerts(0.19, -0.16, 0.03, 0.05, 0.12, 0.07, 9), ox, oy, oz, -0.62 + pitch, yaw * 0.2, roll * 0.1);
    // Fingers wrapping
    appendPart(v, boxVerts(0.10, -0.01, 0.02, 0.02, 0.04, 0.04, 9), ox, oy, oz, -0.3 + pitch * 0.5, yaw * 0.3, roll * 0.15);

    // Body
    appendPart(v, boxVerts(0.0, 0.0, 0.0, 0.05, 0.05, 0.05, 3), ox, oy, oz, pitch, yaw, roll);
    // Neck
    appendPart(v, boxVerts(0.0, 0.055, 0.0, 0.012, 0.02, 0.012, 14), ox, oy, oz, pitch, yaw, roll);
    // Spoon
    appendPart(v, boxVerts(0.0, 0.085, 0.0, 0.008, 0.012, 0.008, 4), ox, oy, oz, pitch, yaw, roll);
    // Pin ring
    appendPart(v, boxVerts(0.025, 0.06, 0.0, 0.008, 0.008, 0.003, 3), ox, oy, oz, pitch, yaw, roll);

    return v;
}

function smokeVerts(slot, reloadPhase) {
    const { ox, oy, oz, pitch, yaw, roll } = baseTransform(slot, 0.23, -0.14, -0.37, reloadPhase);
    const v = [];

    appendPart(v, boxVerts(0.16, -0.01, -0.01, 0.055, 0.14, 0.075, 10), ox, oy, oz, -0.35 + pitch, yaw * 0.35, roll * 0.2);
    appendPart(v, boxVerts(0.19, -0.16, 0.03, 0.05, 0.12, 0.07, 9), ox, oy, oz, -0.62 + pitch, yaw * 0.2, roll * 0.1);

    appendPart(v, boxVerts(0.0, 0.0, 0.0, 0.03, 0.06, 0.03, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0.0, 0.038, 0.0, 0.032, 0.01, 0.032, 13), ox, oy, oz, pitch, yaw, roll);

    return v;
}

function flashbangVerts(slot, reloadPhase) {
    const { ox, oy, oz, pitch, yaw, roll } = baseTransform(slot, 0.23, -0.14, -0.37, reloadPhase);
    const v = [];

    appendPart(v, boxVerts(0.16, -0.01, -0.01, 0.055, 0.14, 0.075, 10), ox, oy, oz, -0.35 + pitch, yaw * 0.35, roll * 0.2);
    appendPart(v, boxVerts(0.19, -0.16, 0.03, 0.05, 0.12, 0.07, 9), ox, oy, oz, -0.62 + pitch, yaw * 0.2, roll * 0.1);

    appendPart(v, boxVerts(0.0, 0.0, 0.0, 0.028, 0.055, 0.028, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0.0, 0.0, 0.0, 0.024, 0.051, 0.024, 4), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0.0, 0.04, 0.0, 0.03, 0.008, 0.03, 9), ox, oy, oz, pitch, yaw, roll);

    return v;
}

function appendFlash(v, slot, ox, oy, oz, pitch, yaw, roll, offsetZ) {
    if (slot.flashTime <= 0) return;
    const flashScale = 0.5 + (slot.flashTime / 0.06) * 0.5;
    // Flash core
    appendPart(
        v,
        boxVerts(0, 0.02, offsetZ, 0.035 * flashScale, 0.03 * flashScale, 0.05 * flashScale, 4),
        ox, oy, oz, pitch, yaw, roll
    );
    // Flash spikes (cross shape)
    appendPart(
        v,
        boxVerts(0, 0.02, offsetZ - 0.04 * flashScale, 0.008 * flashScale, 0.008 * flashScale, 0.06 * flashScale, 4),
        ox, oy, oz, pitch, yaw, roll
    );
    appendPart(
        v,
        boxVerts(0, 0.02, offsetZ, 0.06 * flashScale, 0.008 * flashScale, 0.008 * flashScale, 4),
        ox, oy, oz, pitch, yaw, roll
    );
}

function baseTransform(slot, baseX, baseY, baseZ, reloadPhase = 0) {
    const bob = Math.sin(slot.bobPhase) * 0.02 * slot.bobWeight;
    const bobX = Math.cos(slot.bobPhase * 0.5) * 0.015 * slot.bobWeight;
    const kick = slot.kickback * 0.12;
    const reload = reloadTransform(reloadPhase);
    const pitch = reload.pitch;
    const yaw = slot.recoilYaw * 0.3 + reload.yaw;
    const roll = -slot.recoilYaw * 0.6 + reload.roll;

    return {
        ox: baseX + bobX + reload.ox,
        oy: baseY + bob + reload.oy,
        oz: baseZ + kick + reload.oz,
        pitch,
        yaw,
        roll,
    };
}

function getReloadPhase(weapon) {
    if (!weapon.reloadTimeMs) return 0;
    return Math.min(1, Math.max(0, 1 - weapon.reloadTimeMs / RELOAD_DURATION_MS));
}

function getAttackDuration(kind, alternate, fireDuration) {
    if (kind !== WEAPON_KNIFE) {
        return fireDuration;
    }
    return fireDuration * (alternate ? KNIFE_STAB_ANIM_SCALE : KNIFE_SLASH_ANIM_SCALE);
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
    return a + (b - a) * t;
}

function appendPart(out, verts, tx, ty, tz, rx, ry, rz) {
    const sinX = Math.sin(rx);
    const cosX = Math.cos(rx);
    const sinY = Math.sin(ry);
    const cosY = Math.cos(ry);
    const sinZ = Math.sin(rz);
    const cosZ = Math.cos(rz);

    for (let i = 0; i < verts.length; i += 6) {
        let x = verts[i];
        let y = verts[i + 1];
        let z = verts[i + 2];

        const yx = y * cosX - z * sinX;
        const zx = y * sinX + z * cosX;
        y = yx;
        z = zx;

        const xy = x * cosY + z * sinY;
        const zy = -x * sinY + z * cosY;
        x = xy;
        z = zy;

        const xz = x * cosZ - y * sinZ;
        const yz = x * sinZ + y * cosZ;
        x = xz;
        y = yz;

        out.push(
            x + tx,
            y + ty,
            z + tz,
            verts[i + 3],
            verts[i + 4],
            verts[i + 5]
        );
    }
}
