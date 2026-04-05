import { boxVerts } from './renderer.js';
import {
    RELOAD_DURATION_MS,
    UTILITY_BOMB,
    UTILITY_FLASHBANG,
    UTILITY_SMOKE,
    WEAPON_DEFS,
    WEAPON_KNIFE,
} from './economy.js';

const KNIFE_SLASH_ANIM_SCALE = 1.45;
const KNIFE_STAB_ANIM_SCALE = 1.3;

const WEAPON_RECOIL_PROFILE_CACHE = new Map();
const WEAPON_VISUAL_PROFILE_CACHE = new Map();

const CATEGORY_RECOIL_BASE = {
    pistol: { pitch: 0.088, yaw: 0.014, kickGain: 0.68, kickMax: 1.02, viewPunchPitch: 0.015, viewPunchYaw: 0.009, heatGain: 0.2, heatSpread: 3.1, hipGap: 9.5, aimGap: 9.5 },
    smg: { pitch: 0.074, yaw: 0.018, kickGain: 0.78, kickMax: 1.14, viewPunchPitch: 0.012, viewPunchYaw: 0.008, heatGain: 0.14, heatSpread: 4.0, hipGap: 11.5, aimGap: 11.5 },
    rifle: { pitch: 0.084, yaw: 0.016, kickGain: 0.82, kickMax: 1.2, viewPunchPitch: 0.013, viewPunchYaw: 0.008, heatGain: 0.13, heatSpread: 4.2, hipGap: 11, aimGap: 11 },
    sniper: { pitch: 0.104, yaw: 0.008, kickGain: 0.88, kickMax: 1.24, viewPunchPitch: 0.016, viewPunchYaw: 0.005, heatGain: 0.12, heatSpread: 4.6, hipGap: 15, aimGap: 3.8 },
    shotgun: { pitch: 0.096, yaw: 0.015, kickGain: 0.9, kickMax: 1.22, viewPunchPitch: 0.017, viewPunchYaw: 0.007, heatGain: 0.16, heatSpread: 4.4, hipGap: 13, aimGap: 13 },
    machinegun: { pitch: 0.081, yaw: 0.022, kickGain: 0.86, kickMax: 1.28, viewPunchPitch: 0.013, viewPunchYaw: 0.009, heatGain: 0.12, heatSpread: 4.2, hipGap: 12.5, aimGap: 12.5 },
};

const LONG_GUN_VISUAL_BASE = {
    rifle: {
        family: 'long-gun',
        baseX: 0.3,
        baseY: -0.22,
        baseZ: -0.68,
        receiverWidth: 0.072,
        receiverHeight: 0.058,
        receiverLen: 0.28,
        receiverZ: 0.06,
        topRailLen: 0.24,
        handguardWidth: 0.066,
        handguardHeight: 0.05,
        handguardLen: 0.16,
        handguardZ: 0.36,
        magType: 'box',
        magWidth: 0.04,
        magHeight: 0.09,
        magDepth: 0.052,
        magZ: 0.09,
        magY: -0.12,
        magAngle: 0.06,
        gripZ: -0.18,
        stockWidth: 0.038,
        stockHeight: 0.034,
        stockLen: 0.27,
        stockZ: -0.36,
        stockY: 0.008,
        cheekRest: true,
        cheekRestLen: 0.12,
        barrelRadius: 0.013,
        barrelLen: 0.13,
        barrelY: 0.018,
        barrelZ: -0.64,
        muzzleRadius: 0.02,
        muzzleLen: 0.026,
        muzzleZ: -0.78,
        supportZ: 0.12,
        supportY: -0.03,
        frontSightZ: -0.67,
        rearSightZ: 0.18,
        bodyMat: 10,
        accentMat: 3,
        stockMat: 3,
        handguardMat: 10,
        magMat: 3,
        foregrip: false,
        scope: null,
        suppressorLen: 0,
        topMag: false,
        helicalMag: false,
        ammoBox: false,
        tubeMagazine: false,
        pump: false,
        bullpup: false,
        carryHandle: false,
        boltHandle: false,
        bipod: false,
        woodFurniture: false,
        frontSightStyle: 'post',
        rearSightStyle: 'post',
        magInGrip: false,
    },
    sniper: {
        family: 'long-gun',
        baseX: 0.32,
        baseY: -0.23,
        baseZ: -0.76,
        receiverWidth: 0.078,
        receiverHeight: 0.064,
        receiverLen: 0.34,
        receiverZ: 0.04,
        topRailLen: 0.3,
        handguardWidth: 0.07,
        handguardHeight: 0.054,
        handguardLen: 0.2,
        handguardZ: 0.42,
        magType: 'box',
        magWidth: 0.04,
        magHeight: 0.085,
        magDepth: 0.048,
        magZ: 0.04,
        magY: -0.12,
        magAngle: 0.03,
        gripZ: -0.18,
        stockWidth: 0.042,
        stockHeight: 0.036,
        stockLen: 0.33,
        stockZ: -0.41,
        stockY: 0.008,
        cheekRest: true,
        cheekRestLen: 0.16,
        barrelRadius: 0.015,
        barrelLen: 0.22,
        barrelY: 0.02,
        barrelZ: -0.72,
        muzzleRadius: 0.021,
        muzzleLen: 0.03,
        muzzleZ: -0.95,
        supportZ: 0.22,
        supportY: -0.02,
        frontSightZ: -0.84,
        rearSightZ: 0.18,
        bodyMat: 10,
        accentMat: 3,
        stockMat: 3,
        handguardMat: 10,
        magMat: 3,
        foregrip: false,
        scope: 'tube',
        scopeZ: -0.02,
        scopeLen: 0.3,
        scopeHeight: 0.12,
        scopeWidth: 0.022,
        suppressorLen: 0,
        topMag: false,
        helicalMag: false,
        ammoBox: false,
        tubeMagazine: false,
        pump: false,
        bullpup: false,
        carryHandle: false,
        boltHandle: true,
        bipod: false,
        woodFurniture: false,
        frontSightStyle: 'none',
        rearSightStyle: 'none',
        magInGrip: false,
    },
    smg: {
        family: 'long-gun',
        baseX: 0.3,
        baseY: -0.22,
        baseZ: -0.64,
        receiverWidth: 0.07,
        receiverHeight: 0.056,
        receiverLen: 0.24,
        receiverZ: 0.02,
        topRailLen: 0.2,
        handguardWidth: 0.062,
        handguardHeight: 0.048,
        handguardLen: 0.12,
        handguardZ: 0.28,
        magType: 'straight',
        magWidth: 0.034,
        magHeight: 0.1,
        magDepth: 0.045,
        magZ: 0.05,
        magY: -0.13,
        magAngle: 0,
        gripZ: -0.12,
        stockWidth: 0.03,
        stockHeight: 0.028,
        stockLen: 0.2,
        stockZ: -0.3,
        stockY: 0.01,
        cheekRest: false,
        barrelRadius: 0.012,
        barrelLen: 0.1,
        barrelY: 0.02,
        barrelZ: -0.56,
        muzzleRadius: 0.018,
        muzzleLen: 0.024,
        muzzleZ: -0.67,
        supportZ: 0.02,
        supportY: -0.045,
        frontSightZ: -0.51,
        rearSightZ: 0.1,
        bodyMat: 10,
        accentMat: 3,
        stockMat: 3,
        handguardMat: 10,
        magMat: 3,
        foregrip: false,
        scope: null,
        suppressorLen: 0,
        topMag: false,
        helicalMag: false,
        ammoBox: false,
        tubeMagazine: false,
        pump: false,
        bullpup: false,
        carryHandle: false,
        boltHandle: false,
        bipod: false,
        woodFurniture: false,
        frontSightStyle: 'post',
        rearSightStyle: 'post',
        magInGrip: false,
    },
    shotgun: {
        family: 'long-gun',
        baseX: 0.31,
        baseY: -0.22,
        baseZ: -0.7,
        receiverWidth: 0.075,
        receiverHeight: 0.06,
        receiverLen: 0.3,
        receiverZ: 0.04,
        topRailLen: 0.18,
        handguardWidth: 0.074,
        handguardHeight: 0.056,
        handguardLen: 0.17,
        handguardZ: 0.38,
        magType: 'tube',
        magWidth: 0.028,
        magHeight: 0.028,
        magDepth: 0.22,
        magZ: 0.18,
        magY: -0.05,
        magAngle: 0,
        gripZ: -0.18,
        stockWidth: 0.04,
        stockHeight: 0.036,
        stockLen: 0.29,
        stockZ: -0.38,
        stockY: 0.008,
        cheekRest: true,
        cheekRestLen: 0.14,
        barrelRadius: 0.016,
        barrelLen: 0.2,
        barrelY: 0.022,
        barrelZ: -0.72,
        muzzleRadius: 0.022,
        muzzleLen: 0.024,
        muzzleZ: -0.93,
        supportZ: 0.2,
        supportY: -0.04,
        frontSightZ: -0.74,
        rearSightZ: 0.12,
        bodyMat: 10,
        accentMat: 3,
        stockMat: 14,
        handguardMat: 14,
        magMat: 3,
        foregrip: false,
        scope: null,
        suppressorLen: 0,
        topMag: false,
        helicalMag: false,
        ammoBox: false,
        tubeMagazine: true,
        pump: true,
        bullpup: false,
        carryHandle: false,
        boltHandle: false,
        bipod: false,
        woodFurniture: true,
        frontSightStyle: 'post',
        rearSightStyle: 'post',
        magInGrip: false,
    },
    machinegun: {
        family: 'long-gun',
        baseX: 0.32,
        baseY: -0.23,
        baseZ: -0.76,
        receiverWidth: 0.082,
        receiverHeight: 0.066,
        receiverLen: 0.35,
        receiverZ: 0.02,
        topRailLen: 0.3,
        handguardWidth: 0.076,
        handguardHeight: 0.058,
        handguardLen: 0.22,
        handguardZ: 0.42,
        magType: 'box',
        magWidth: 0.06,
        magHeight: 0.09,
        magDepth: 0.09,
        magZ: 0.08,
        magY: -0.11,
        magAngle: 0,
        gripZ: -0.16,
        stockWidth: 0.04,
        stockHeight: 0.036,
        stockLen: 0.31,
        stockZ: -0.42,
        stockY: 0.01,
        cheekRest: true,
        cheekRestLen: 0.16,
        barrelRadius: 0.016,
        barrelLen: 0.18,
        barrelY: 0.022,
        barrelZ: -0.74,
        muzzleRadius: 0.022,
        muzzleLen: 0.03,
        muzzleZ: -0.95,
        supportZ: 0.18,
        supportY: -0.03,
        frontSightZ: -0.8,
        rearSightZ: 0.14,
        bodyMat: 10,
        accentMat: 3,
        stockMat: 3,
        handguardMat: 10,
        magMat: 3,
        foregrip: false,
        scope: null,
        suppressorLen: 0,
        topMag: false,
        helicalMag: false,
        ammoBox: true,
        tubeMagazine: false,
        pump: false,
        bullpup: false,
        carryHandle: false,
        boltHandle: false,
        bipod: true,
        woodFurniture: false,
        frontSightStyle: 'post',
        rearSightStyle: 'post',
        magInGrip: false,
    },
};

const SIDEARM_VISUAL_BASE = {
    pistol: {
        family: 'sidearm',
        baseX: 0.29,
        baseY: -0.19,
        baseZ: -0.54,
        slideWidth: 0.055,
        slideHeight: 0.028,
        slideLen: 0.2,
        slideZ: -0.06,
        barrelRadius: 0.014,
        barrelLen: 0.1,
        barrelZ: -0.31,
        muzzleRadius: 0.018,
        muzzleLen: 0.024,
        muzzleZ: -0.415,
        gripWidth: 0.028,
        gripHeight: 0.06,
        gripDepth: 0.038,
        gripZ: 0.055,
        gripAngle: 0.1,
        magWidth: 0.022,
        magHeight: 0.054,
        magDepth: 0.032,
        magZ: 0.055,
        magY: -0.085,
        triggerZ: -0.004,
        rearSightZ: 0.04,
        frontSightZ: -0.305,
        supportX: 0.0,
        supportY: -0.012,
        supportZ: 0.025,
        bodyMat: 10,
        accentMat: 3,
        gripMat: 10,
        suppressorLen: 0,
        shroud: false,
        dual: false,
        revolver: false,
    },
};

const LONG_GUN_VISUAL_OVERRIDES = {
    'ak-47': { magType: 'curved', magHeight: 0.11, magAngle: 0.2, bodyMat: 3, handguardMat: 14, stockMat: 14, handguardLen: 0.17, frontSightStyle: 'hood', rearSightStyle: 'notch' },
    'aug': { bullpup: true, carryHandle: true, scope: 'block', scopeLen: 0.2, scopeHeight: 0.14, scopeZ: 0.02, stockLen: 0.22, magZ: -0.02, gripZ: -0.08, handguardZ: 0.28, frontSightStyle: 'none', rearSightStyle: 'none' },
    'awp': { scope: 'tube', scopeLen: 0.34, scopeHeight: 0.13, scopeZ: -0.06, barrelLen: 0.26, muzzleZ: -1.0, handguardLen: 0.22, stockLen: 0.36, boltHandle: true, frontSightStyle: 'none', rearSightStyle: 'none' },
    'famas': { bullpup: true, carryHandle: true, stockLen: 0.22, handguardZ: 0.24, magZ: -0.02, gripZ: -0.08, frontSightStyle: 'none', rearSightStyle: 'none' },
    'g3sg1': { scope: 'tube', scopeLen: 0.26, scopeHeight: 0.13, scopeZ: -0.02, magWidth: 0.045, magHeight: 0.1, magZ: 0.02, bodyMat: 3, stockLen: 0.3, frontSightStyle: 'none', rearSightStyle: 'none' },
    'galil-ar': { magType: 'curved', magHeight: 0.105, magAngle: 0.16, bodyMat: 3, handguardMat: 14, stockMat: 3, handguardLen: 0.18, carryHandle: true },
    'm4a1-s': { suppressorLen: 0.12, muzzleZ: -0.9, handguardLen: 0.18, frontSightStyle: 'post', rearSightStyle: 'notch' },
    'm4a4': { handguardLen: 0.18, frontSightStyle: 'post', rearSightStyle: 'notch' },
    'scar-20': { scope: 'tube', scopeLen: 0.28, scopeHeight: 0.14, scopeZ: -0.02, magWidth: 0.045, magHeight: 0.1, magZ: 0.02, frontSightStyle: 'none', rearSightStyle: 'none' },
    'sg553': { scope: 'block', scopeLen: 0.19, scopeHeight: 0.13, scopeZ: 0.0, bodyMat: 3, handguardLen: 0.19, frontSightStyle: 'none', rearSightStyle: 'none' },
    'ssg08': { scope: 'tube', scopeLen: 0.26, scopeHeight: 0.12, scopeZ: -0.02, stockLen: 0.28, barrelLen: 0.24, muzzleZ: -0.98, magHeight: 0.075, frontSightStyle: 'none', rearSightStyle: 'none' },
    mac10: { receiverLen: 0.2, handguardLen: 0.08, barrelLen: 0.09, barrelZ: -0.52, muzzleZ: -0.62, magInGrip: true, magZ: -0.12, gripZ: -0.12, stockLen: 0.14, stockWidth: 0.018, stockHeight: 0.018, supportZ: -0.02, supportY: -0.02 },
    'mp5-sd': { suppressorLen: 0.1, muzzleZ: -0.78, stockLen: 0.16, stockWidth: 0.02, stockHeight: 0.02, frontSightStyle: 'hood', rearSightStyle: 'ring' },
    mp7: { receiverLen: 0.22, handguardLen: 0.09, stockLen: 0.14, stockWidth: 0.02, stockHeight: 0.02, supportZ: 0.0, frontSightStyle: 'post', rearSightStyle: 'ring' },
    mp9: { receiverLen: 0.2, handguardLen: 0.08, stockLen: 0.12, stockWidth: 0.018, stockHeight: 0.018, supportZ: -0.02, frontSightStyle: 'post', rearSightStyle: 'ring' },
    'pp-bizon': { helicalMag: true, magType: 'helical', magZ: 0.18, magY: -0.07, handguardLen: 0.16, stockLen: 0.22, frontSightStyle: 'hood', rearSightStyle: 'ring' },
    p90: { topMag: true, magType: 'top', handguardLen: 0.18, handguardZ: 0.2, receiverLen: 0.28, receiverZ: 0.0, stockLen: 0.18, stockZ: -0.2, stockWidth: 0.05, stockHeight: 0.03, barrelZ: -0.58, muzzleZ: -0.72, supportZ: 0.1, supportY: -0.005, frontSightStyle: 'none', rearSightStyle: 'none' },
    'ump-45': { receiverWidth: 0.074, receiverLen: 0.22, magWidth: 0.038, magHeight: 0.1, magDepth: 0.05, stockLen: 0.16, frontSightStyle: 'post', rearSightStyle: 'ring' },
    'mag-7': { bullpup: true, magType: 'box', magWidth: 0.045, magHeight: 0.1, magDepth: 0.06, magZ: -0.04, gripZ: -0.07, handguardLen: 0.12, handguardZ: 0.26, stockLen: 0.18, stockZ: -0.18, tubeMagazine: false, pump: false, frontSightStyle: 'post', rearSightStyle: 'none' },
    nova: { tubeMagazine: true, pump: true, handguardLen: 0.15, barrelLen: 0.23, muzzleZ: -0.96, stockLen: 0.31, frontSightStyle: 'post', rearSightStyle: 'notch' },
    'sawed-off': { stockLen: 0.18, stockZ: -0.24, stockMat: 14, handguardMat: 14, handguardLen: 0.1, barrelLen: 0.13, muzzleZ: -0.82, supportZ: 0.1, frontSightStyle: 'none', rearSightStyle: 'none' },
    xm1014: { pump: false, tubeMagazine: true, handguardMat: 10, stockMat: 10, receiverLen: 0.32, handguardLen: 0.14, barrelLen: 0.21, frontSightStyle: 'post', rearSightStyle: 'notch' },
    m249: { ammoBox: true, bipod: true, carryHandle: true, receiverLen: 0.38, handguardLen: 0.24, barrelLen: 0.22, muzzleZ: -0.99, stockLen: 0.34, scope: null, frontSightStyle: 'hood', rearSightStyle: 'ring' },
    negev: { ammoBox: true, bipod: true, receiverLen: 0.4, handguardLen: 0.26, barrelLen: 0.24, muzzleZ: -1.0, stockLen: 0.3, handguardMat: 3, frontSightStyle: 'hood', rearSightStyle: 'ring' },
};

const SIDEARM_VISUAL_OVERRIDES = {
    'cz75-auto': { slideLen: 0.16, slideHeight: 0.034, barrelLen: 0.09, gripHeight: 0.064, magHeight: 0.05, shroud: true },
    'desert-eagle': { slideWidth: 0.068, slideHeight: 0.036, slideLen: 0.24, barrelLen: 0.12, muzzleZ: -0.46, gripWidth: 0.034, gripHeight: 0.075, magHeight: 0.06 },
    'dual-berettas': { dual: true, slideLen: 0.22, barrelLen: 0.11, gripHeight: 0.068, magHeight: 0.06 },
    'five-seven': { slideLen: 0.21, barrelLen: 0.105, gripHeight: 0.066, bodyMat: 3, accentMat: 10, gripMat: 10 },
    'glock-18': { slideLen: 0.2, slideHeight: 0.026, barrelLen: 0.1, gripHeight: 0.068, accentMat: 10 },
    p2000: { slideLen: 0.19, barrelLen: 0.1, gripHeight: 0.064 },
    p250: { slideLen: 0.18, barrelLen: 0.095, gripHeight: 0.064, gripAngle: 0.12 },
    'r8-revolver': { revolver: true, slideLen: 0.18, barrelLen: 0.13, muzzleZ: -0.43, gripHeight: 0.07, magHeight: 0, bodyMat: 3, gripMat: 10 },
    'tec-9': { shroud: true, slideLen: 0.2, slideHeight: 0.038, barrelLen: 0.11, gripHeight: 0.074, magHeight: 0.075, bodyMat: 3, accentMat: 10 },
    'usp-s': { suppressorLen: 0.1, muzzleZ: -0.5, slideLen: 0.2, barrelLen: 0.11, gripHeight: 0.065 },
};

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function hashWeaponId(kind) {
    let hash = 2166136261;
    for (let i = 0; i < kind.length; i += 1) {
        hash ^= kind.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function getWeaponCategory(def) {
    if (!def) return 'rifle';
    if (CATEGORY_RECOIL_BASE[def.category]) {
        return def.category;
    }
    if (def.slot === 'pistol') return 'pistol';
    return 'rifle';
}

function buildRecoilPattern(def, hash) {
    const category = getWeaponCategory(def);
    const base = CATEGORY_RECOIL_BASE[category] || CATEGORY_RECOIL_BASE.rifle;
    const shotCountByCategory = {
        pistol: 12,
        smg: 22,
        rifle: 24,
        sniper: 14,
        shotgun: 10,
        machinegun: 30,
    };
    const shotCount = shotCountByCategory[category] || 20;
    const cadenceScale = clampNumber(130 / Math.max(55, def.fireIntervalMs || 130), 0.7, 2.2);
    const damageScale = clampNumber(0.82 + (def.baseDamage || 30) / 70, 0.82, 2.05);
    const magScale = clampNumber(1.1 - Math.min((def.magSize || 30), 80) / 180, 0.68, 1.12);
    const zoomScale = def.zoomLevels?.length ? 0.9 : 1;
    const specialScale = def.secondaryMode === 'revolver'
        ? 1.25
        : def.secondaryMode === 'auto'
            ? 0.9
            : 1;
    const pitchScale = cadenceScale * damageScale * magScale * zoomScale * specialScale;
    const yawScale = clampNumber(0.85 + ((hash >>> 3) % 11) / 18, 0.8, 1.45);
    const driftSign = ((hash >>> 9) & 1) === 0 ? -1 : 1;
    const driftBase = (((hash % 17) - 8) / 1200) * driftSign;
    const pattern = [];

    for (let i = 0; i < shotCount; i += 1) {
        const t = shotCount <= 1 ? 0 : i / (shotCount - 1);
        const spiral = Math.sin((i + 1) * 0.82 + hash * 0.0009);
        const weave = Math.cos((i + 1) * 0.46 + hash * 0.0017);
        const stairDir = ((Math.floor(i / 2) % 2) === 0 ? 1 : -1) * driftSign;
        let pitch = base.pitch * pitchScale * (0.6 + t * (category === 'machinegun' ? 1.3 : 1.05));
        let yaw = base.yaw * yawScale * ((spiral * 0.55) + stairDir * (0.28 + t * 0.48) + weave * 0.12) + driftBase * (1 + t * 4);

        if (category === 'sniper') {
            pitch *= 0.85 + t * 0.55;
            yaw *= 0.65;
        } else if (category === 'shotgun') {
            pitch *= 1.08;
            yaw *= 0.5;
        } else if (category === 'pistol') {
            pitch *= 1.05 + t * 0.15;
            yaw *= 0.75;
        }

        pattern.push([pitch, yaw]);
    }

    return { category, base, pattern };
}

function buildWeaponRecoilProfile(kind) {
    const def = WEAPON_DEFS[kind];
    if (!def || kind === WEAPON_KNIFE || kind === UTILITY_BOMB || kind === UTILITY_SMOKE || kind === UTILITY_FLASHBANG) {
        return null;
    }
    const hash = hashWeaponId(kind);
    const { category, base, pattern } = buildRecoilPattern(def, hash);
    const cadenceScale = clampNumber(130 / Math.max(55, def.fireIntervalMs || 130), 0.7, 2.2);
    const damageScale = clampNumber(0.85 + (def.baseDamage || 30) / 75, 0.85, 2.1);
    const movementScale = clampNumber((240 - (def.moveSpeed || 220)) / 110, -0.2, 0.8);
    const scoped = def.zoomLevels?.length ? 1 : 0;

    return {
        pattern,
        kickGain: base.kickGain * clampNumber(0.86 + cadenceScale * 0.18 + movementScale * 0.14, 0.7, 1.35),
        kickMax: base.kickMax * clampNumber(0.92 + damageScale * 0.14, 0.9, 1.4),
        viewPunchPitch: base.viewPunchPitch * clampNumber(0.88 + damageScale * 0.18, 0.85, 1.45),
        viewPunchYaw: base.viewPunchYaw * clampNumber(0.85 + cadenceScale * 0.15, 0.8, 1.3),
        heatGain: base.heatGain * clampNumber(0.92 + cadenceScale * 0.16, 0.8, 1.35),
        heatSpread: base.heatSpread * clampNumber(0.92 + cadenceScale * 0.09, 0.8, 1.25),
        hipGap: base.hipGap + (category === 'sniper' ? 1.8 : 0) + movementScale * 1.5,
        aimGap: Math.max(category === 'sniper' ? 2.8 : 4.2, base.aimGap - scoped * 1.5),
    };
}

function getWeaponRecoilProfile(kind) {
    if (!WEAPON_RECOIL_PROFILE_CACHE.has(kind)) {
        WEAPON_RECOIL_PROFILE_CACHE.set(kind, buildWeaponRecoilProfile(kind));
    }
    return WEAPON_RECOIL_PROFILE_CACHE.get(kind);
}

function buildWeaponVisualProfile(kind) {
    const def = WEAPON_DEFS[kind];
    if (!def) return null;
    const category = getWeaponCategory(def);
    if (def.slot === 'pistol') {
        return {
            ...SIDEARM_VISUAL_BASE.pistol,
            ...(SIDEARM_VISUAL_OVERRIDES[kind] || {}),
        };
    }
    if (def.slot !== 'heavy') {
        return null;
    }
    const base = LONG_GUN_VISUAL_BASE[category] || LONG_GUN_VISUAL_BASE.rifle;
    return {
        ...base,
        ...(LONG_GUN_VISUAL_OVERRIDES[kind] || {}),
    };
}

function getWeaponVisualProfile(kind) {
    if (!WEAPON_VISUAL_PROFILE_CACHE.has(kind)) {
        WEAPON_VISUAL_PROFILE_CACHE.set(kind, buildWeaponVisualProfile(kind));
    }
    return WEAPON_VISUAL_PROFILE_CACHE.get(kind);
}

export function createWeapon() {
    return {
        kind: WEAPON_KNIFE,
        reloadTimeMs: 0,
        slots: {
            [WEAPON_KNIFE]: createSlotState(),
            [UTILITY_BOMB]: createSlotState(),
            [UTILITY_SMOKE]: createSlotState(),
            [UTILITY_FLASHBANG]: createSlotState(),
        },
    };
}

export function setWeaponType(weapon, kind) {
    ensureSlotState(weapon, kind);
    weapon.kind = kind;
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
    return ensureSlotState(weapon, weapon.kind).cooldown <= 0;
}

export function fire(weapon, aiming = false, alternate = false, moving = false) {
    const slot = ensureSlotState(weapon, weapon.kind);
    const kind = weapon.kind;
    const def = WEAPON_DEFS[kind] || WEAPON_DEFS[WEAPON_KNIFE];
    const recoilProfile = getWeaponRecoilProfile(kind);
    const aimRecoilMultiplier = aiming && def.canAim ? def.adsRecoilMultiplier : 1;
    const moveRecoilMultiplier = moving ? 1.35 : 1;
    const isFirstShot = slot.shotIndex === 0;
    const fireDuration = getFireDuration(kind, alternate);
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

    if (recoilProfile) {
        const patternIdx = Math.min(slot.shotIndex - 1, recoilProfile.pattern.length - 1);
        const [pitchAdd, yawAdd] = recoilProfile.pattern[patternIdx] || [0.02, 0];
        const firstShotMul = isFirstShot && !moving ? 0 : 1;
        slot.kickback = Math.min(recoilProfile.kickMax, slot.kickback + recoilProfile.kickGain * aimRecoilMultiplier);
        slot.recoilTargetPitch += pitchAdd * firstShotMul * aimRecoilMultiplier * moveRecoilMultiplier;
        slot.recoilTargetYaw += yawAdd * firstShotMul * aimRecoilMultiplier * moveRecoilMultiplier;
        slot.viewPunchPitch += recoilProfile.viewPunchPitch * aimRecoilMultiplier;
        slot.viewPunchYaw += (Math.random() - 0.5) * recoilProfile.viewPunchYaw;
        slot.heat = Math.min(1, slot.heat + recoilProfile.heatGain);
        return;
    }

    if (kind === UTILITY_BOMB || kind === UTILITY_SMOKE || kind === UTILITY_FLASHBANG) {
        slot.kickback = Math.min(0.8, slot.kickback + 0.75);
        slot.recoilTargetPitch += 0.048;
        slot.recoilTargetYaw += [-1, 1][slot.shotIndex % 2] * 0.016;
        slot.heat = Math.min(1, slot.heat + 0.18);
        return;
    }

    if (alternate && kind === WEAPON_KNIFE) {
        slot.kickback = Math.min(1.1, slot.kickback + 0.95);
        slot.recoilTargetPitch += 0.048;
        slot.recoilTargetYaw += [-1, 1][slot.shotIndex % 2] * 0.022;
        slot.heat = Math.min(1, slot.heat + 0.2);
        return;
    }

    slot.kickback = Math.min(0.9, slot.kickback + 0.65);
    slot.recoilTargetPitch += 0.024;
    slot.recoilTargetYaw += [-1, 1][slot.shotIndex % 2] * 0.008;
    slot.heat = Math.min(1, slot.heat + 0.14);
}

export function weaponVerts(weapon) {
    const slot = ensureSlotState(weapon, weapon.kind);
    const reloadPhase = getReloadPhase(weapon);
    if (weapon.kind === UTILITY_BOMB) return bombVerts(slot, reloadPhase);
    if (weapon.kind === UTILITY_SMOKE) return smokeVerts(slot, reloadPhase);
    if (weapon.kind === UTILITY_FLASHBANG) return flashbangVerts(slot, reloadPhase);
    if (WEAPON_DEFS[weapon.kind]?.slot === 'pistol') return pistolVerts(weapon.kind, slot, reloadPhase);
    if (WEAPON_DEFS[weapon.kind]?.slot === 'heavy') return machineGunVerts(weapon.kind, slot, reloadPhase);
    return knifeVerts(slot, reloadPhase);
}

export function getCrosshairGap(weapon, aiming = false, crouching = false, moving = false) {
    const kind = weapon.kind;
    const slot = ensureSlotState(weapon, kind);
    const crouchMultiplier = crouching ? 0.72 : 1;
    const moveBonus = moving ? 3 : 0;
    const recoilProfile = getWeaponRecoilProfile(kind);

    if (recoilProfile) {
        const baseGap = aiming ? recoilProfile.aimGap : recoilProfile.hipGap;
        return baseGap * crouchMultiplier + moveBonus + slot.heat * recoilProfile.heatSpread;
    }
    if (kind === WEAPON_KNIFE) {
        return 10 + slot.heat * 3;
    }
    return 12 + slot.heat * 3;
}

export function getCrosshairOffsetY(weapon) {
    const slot = ensureSlotState(weapon, weapon.kind);
    const viewScale = WEAPON_DEFS[weapon.kind]?.recoilViewScale || 1;
    return -(slot.recoilTargetPitch / viewScale * 80);
}

export function consumeRecoilDelta(weapon) {
    const slot = ensureSlotState(weapon, weapon.kind);
    const pitch = slot.recoilPitch - slot.appliedPitch;
    const yaw = slot.recoilYaw - slot.appliedYaw;
    slot.appliedPitch = slot.recoilPitch;
    slot.appliedYaw = slot.recoilYaw;
    return { pitch, yaw };
}

export function getViewPunch(weapon) {
    const slot = ensureSlotState(weapon, weapon.kind);
    return {
        pitch: slot.viewPunchPitch,
        yaw: slot.viewPunchYaw,
    };
}

function ensureSlotState(weapon, kind) {
    if (!weapon.slots[kind]) {
        weapon.slots[kind] = createSlotState();
    }
    return weapon.slots[kind];
}

function getFireDuration(kind, alternate = false) {
    const baseDuration = Math.max(0.04, (WEAPON_DEFS[kind]?.fireIntervalMs || 450) / 1000);
    if (kind === WEAPON_KNIFE && alternate) {
        return Math.max(baseDuration, 0.75);
    }
    return baseDuration;
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
    const duration = slot.attackDuration || getFireDuration(kind) || 0;
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

function appendLongGunMagazine(v, profile, reload, ox, oy, oz, pitch, yaw, roll) {
    const magDrop = reload.magOff * 0.22;
    const magLift = reload.magOff > 0.5 ? -0.12 : 0;
    const magPitch = pitch + reload.magOff * 0.12 + profile.magAngle;
    const magYaw = yaw;
    const magRoll = roll;
    const mat = profile.magMat || profile.accentMat;

    if (profile.magType === 'top') {
        appendPart(v, boxVerts(0, 0.092 - reload.magOff * 0.04, profile.handguardZ, 0.048, 0.022, 0.17, mat), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, 0.116 - reload.magOff * 0.04, profile.handguardZ, 0.034, 0.008, 0.15, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
        return;
    }
    if (profile.magType === 'helical') {
        appendPart(v, boxVerts(0, profile.magY - 0.005 - magDrop * 0.4, profile.magZ, 0.03, 0.03, 0.17, mat), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, profile.magY - 0.005 - magDrop * 0.4, profile.magZ + 0.09, 0.034, 0.034, 0.016, mat), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, profile.magY - 0.005 - magDrop * 0.4, profile.magZ - 0.09, 0.034, 0.034, 0.016, mat), ox, oy, oz, pitch, yaw, roll);
        return;
    }
    if (profile.magType === 'tube') {
        return;
    }
    if (profile.ammoBox) {
        appendPart(v, boxVerts(0.07, -0.09 - magDrop * 0.4, profile.magZ, 0.05, 0.075, 0.075, mat), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0.075, -0.01, profile.magZ + 0.02, 0.004, 0.06, 0.1, 14), ox, oy, oz, pitch, yaw, roll);
        return;
    }
    if (profile.magType === 'curved') {
        appendPart(v, boxVerts(0, profile.magY - 0.035 - magDrop, profile.magZ - 0.012, profile.magWidth * 0.94, profile.magHeight * 0.42, profile.magDepth * 0.9, mat), ox, oy + magLift, oz, magPitch + 0.08, magYaw, magRoll);
        appendPart(v, boxVerts(0, profile.magY - 0.11 - magDrop, profile.magZ + 0.02, profile.magWidth, profile.magHeight * 0.46, profile.magDepth, mat), ox, oy + magLift, oz, magPitch + 0.24, magYaw, magRoll);
        appendPart(v, boxVerts(0, profile.magY - 0.19 - magDrop, profile.magZ + 0.05, profile.magWidth * 1.05, 0.008, profile.magDepth * 1.06, mat), ox, oy + magLift, oz, magPitch + 0.24, magYaw, magRoll);
        return;
    }

    appendPart(v, boxVerts(0, profile.magY - magDrop, profile.magZ, profile.magWidth, profile.magHeight, profile.magDepth, mat), ox, oy + magLift, oz, magPitch, magYaw, magRoll);
    appendPart(v, boxVerts(0, profile.magY - profile.magHeight - 0.006 - magDrop, profile.magZ, profile.magWidth * 1.06, 0.008, profile.magDepth * 1.08, mat), ox, oy + magLift, oz, magPitch, magYaw, magRoll);
}

function appendLongGunSights(v, profile, ox, oy, oz, pitch, yaw, roll, kickback) {
    if (profile.scope === 'tube') {
        appendPart(v, boxVerts(0, profile.scopeHeight - 0.005, profile.scopeZ, 0.024, 0.018, profile.scopeLen, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, profile.scopeHeight - 0.005, profile.scopeZ - profile.scopeLen * 0.48, 0.03, 0.024, 0.02, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, profile.scopeHeight - 0.005, profile.scopeZ + profile.scopeLen * 0.48, 0.03, 0.024, 0.02, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, profile.scopeHeight - 0.045, profile.scopeZ - 0.08, 0.012, 0.04, 0.012, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, profile.scopeHeight - 0.045, profile.scopeZ + 0.08, 0.012, 0.04, 0.012, 3), ox, oy, oz, pitch, yaw, roll);
        return;
    }
    if (profile.scope === 'block') {
        appendPart(v, boxVerts(0, profile.scopeHeight - 0.01, profile.scopeZ, 0.04, 0.03, profile.scopeLen, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, profile.scopeHeight - 0.045, profile.scopeZ, 0.016, 0.04, profile.scopeLen * 0.4, 3), ox, oy, oz, pitch, yaw, roll);
        return;
    }

    if (profile.rearSightStyle === 'ring') {
        appendPart(v, boxVerts(0, 0.078, profile.rearSightZ, 0.02, 0.022, 0.012, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, 0.094, profile.rearSightZ, 0.006, 0.02, 0.006, 3), ox, oy, oz, pitch, yaw, roll);
    } else if (profile.rearSightStyle === 'notch' || profile.rearSightStyle === 'post') {
        appendPart(v, boxVerts(0, 0.078, profile.rearSightZ, 0.018, 0.018, 0.018, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0.016, 0.078, profile.rearSightZ, 0.006, 0.022, 0.008, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(-0.016, 0.078, profile.rearSightZ, 0.006, 0.022, 0.008, 3), ox, oy, oz, pitch, yaw, roll);
    }

    if (profile.frontSightStyle === 'hood') {
        appendPart(v, boxVerts(0, 0.092, profile.frontSightZ, 0.014, 0.026, 0.014, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0, 0.11, profile.frontSightZ, 0.006, 0.022, 0.006, 3), ox, oy, oz, pitch, yaw, roll);
    } else if (profile.frontSightStyle === 'post') {
        appendPart(v, boxVerts(0, 0.094, profile.frontSightZ, 0.006, 0.03, 0.006, 3), ox, oy, oz, pitch, yaw, roll);
    }

    if (profile.carryHandle) {
        appendPart(v, boxVerts(0, 0.1, profile.receiverZ + 0.02, 0.02, 0.03, 0.18, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(0.03, 0.08, profile.receiverZ + 0.02, 0.006, 0.05, 0.16, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(-0.03, 0.08, profile.receiverZ + 0.02, 0.006, 0.05, 0.16, 3), ox, oy, oz, pitch, yaw, roll);
    }

    if (profile.bipod) {
        const frontZ = profile.frontSightZ - kickback * 0.04;
        appendPart(v, boxVerts(0.03, -0.07, frontZ, 0.005, 0.08, 0.005, 3), ox, oy, oz, pitch - 0.1, yaw, roll);
        appendPart(v, boxVerts(-0.03, -0.07, frontZ, 0.005, 0.08, 0.005, 3), ox, oy, oz, pitch - 0.1, yaw, roll);
    }
}

function machineGunVerts(kind, slot, reloadPhase) {
    const profile = getWeaponVisualProfile(kind);
    const { ox, oy, oz, pitch, yaw, roll } = baseTransform(slot, profile.baseX, profile.baseY, profile.baseZ, reloadPhase);
    const reload = reloadTransform(reloadPhase);
    const v = [];

    appendPart(v, boxVerts(-0.04, -0.09, profile.gripZ + 0.29, 0.085, 0.18, 0.1, 10), ox, oy, oz, pitch * 0.55, yaw * 0.28, roll * 0.58);
    appendPart(v, boxVerts(-0.015, -0.26, profile.gripZ + 0.39, 0.074, 0.145, 0.09, 10), ox, oy, oz, pitch * 0.28, yaw * 0.16, roll * 0.48);
    appendPart(v, boxVerts(0.015, -0.37, profile.gripZ + 0.48, 0.066, 0.06, 0.075, 9), ox, oy, oz, pitch * 0.18, yaw * 0.08, roll * 0.34);
    appendPart(v, boxVerts(-0.035, -0.06, profile.gripZ + 0.17, 0.012, 0.035, 0.04, 9), ox, oy, oz, pitch * 0.5, yaw * 0.2, roll * 0.4);

    const lhPitch = -0.33 + pitch + reload.pitch * 0.8;
    const lhYaw = yaw * 0.46 + reload.yaw * 0.5;
    const lhRoll = roll * 0.28 + reload.roll * 0.4;
    const lhOy = oy + reload.oy * 1.5;
    appendPart(v, boxVerts(0.19, profile.supportY, profile.supportZ - 0.18, 0.058, 0.16, 0.082, 10), ox, lhOy, oz, lhPitch, lhYaw, lhRoll);
    appendPart(v, boxVerts(0.24, profile.supportY - 0.165, profile.supportZ - 0.095, 0.055, 0.135, 0.07, 10), ox, lhOy, oz, -0.54 + pitch + reload.pitch * 0.6, yaw * 0.3, roll * 0.18);
    appendPart(v, boxVerts(0.275, profile.supportY - 0.265, profile.supportZ - 0.01, 0.05, 0.06, 0.06, 9), ox, lhOy, oz, -0.18 + pitch * 0.4, yaw * 0.18, roll * 0.12);
    appendPart(v, boxVerts(0.14, profile.supportY + 0.015, profile.supportZ - 0.2, 0.012, 0.04, 0.05, 9), ox, lhOy, oz, lhPitch, lhYaw, lhRoll);

    appendPart(v, boxVerts(0, 0, profile.receiverZ, profile.receiverWidth, profile.receiverHeight, profile.receiverLen, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0, 0.046, profile.receiverZ - 0.06, profile.receiverWidth * 0.78, 0.022, profile.topRailLen, profile.accentMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(profile.receiverWidth * 0.75, -0.004, profile.receiverZ + 0.01, 0.014, 0.048, profile.receiverLen * 0.48, profile.accentMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-profile.receiverWidth * 0.75, -0.004, profile.receiverZ + 0.01, 0.014, 0.048, profile.receiverLen * 0.48, profile.accentMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(profile.receiverWidth * 0.82, 0.01, profile.receiverZ - 0.08, 0.008, 0.03, 0.06, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);

    appendPart(v, boxVerts(0, 0.002, profile.handguardZ, profile.handguardWidth, profile.handguardHeight, profile.handguardLen, profile.handguardMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0, 0.042, profile.handguardZ - 0.02, profile.handguardWidth * 0.72, 0.02, profile.handguardLen * 0.92, profile.accentMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(profile.handguardWidth * 0.88, 0.002, profile.handguardZ - profile.handguardLen * 0.16, 0.006, 0.028, 0.04, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(profile.handguardWidth * 0.88, 0.002, profile.handguardZ + profile.handguardLen * 0.16, 0.006, 0.028, 0.04, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-profile.handguardWidth * 0.88, 0.002, profile.handguardZ - profile.handguardLen * 0.16, 0.006, 0.028, 0.04, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-profile.handguardWidth * 0.88, 0.002, profile.handguardZ + profile.handguardLen * 0.16, 0.006, 0.028, 0.04, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);

    if (profile.tubeMagazine) {
        appendPart(v, boxVerts(0, -0.032, profile.handguardZ - 0.03, 0.016, 0.016, profile.handguardLen + 0.12, 3), ox, oy, oz, pitch, yaw, roll);
    }
    if (profile.pump) {
        appendPart(v, boxVerts(0, -0.02, profile.handguardZ + 0.02, profile.handguardWidth * 0.9, 0.036, profile.handguardLen * 0.45, profile.handguardMat), ox, oy, oz, pitch, yaw, roll);
    }
    if (profile.foregrip) {
        appendPart(v, boxVerts(0, -0.08, profile.handguardZ - 0.03, 0.016, 0.06, 0.018, 3), ox, oy, oz, pitch, yaw, roll);
    }

    appendLongGunMagazine(v, profile, reload, ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0, -0.058, profile.magZ - 0.09, 0.028, 0.024, 0.028, profile.accentMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0, -0.115, profile.gripZ, 0.03, 0.092, 0.032, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0.032, -0.115, profile.gripZ, 0.004, 0.075, 0.026, profile.accentMat), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.032, -0.115, profile.gripZ, 0.004, 0.075, 0.026, profile.accentMat), ox, oy, oz, pitch, yaw, roll);

    if (profile.magInGrip) {
        appendPart(v, boxVerts(0, -0.17 - reload.magOff * 0.08, profile.gripZ + 0.02, profile.magWidth * 0.9, profile.magHeight * 0.85, profile.magDepth, profile.magMat), ox, oy, oz, pitch + reload.magOff * 0.12, yaw, roll);
    }

    appendPart(v, boxVerts(0, profile.stockY, profile.stockZ - slot.kickback * 0.05, profile.stockWidth, profile.stockHeight, profile.stockLen, profile.stockMat), ox, oy, oz, pitch, yaw, roll);
    if (profile.cheekRest) {
        appendPart(v, boxVerts(0, profile.stockY + 0.03, profile.stockZ - profile.stockLen * 0.25 - slot.kickback * 0.04, profile.stockWidth * 0.8, 0.012, profile.cheekRestLen, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
    }
    appendPart(v, boxVerts(0, profile.stockY + 0.004, profile.stockZ - profile.stockLen - 0.02 - slot.kickback * 0.06, profile.stockWidth * 1.12, 0.04, 0.02, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);

    appendPart(v, boxVerts(0, profile.barrelY, profile.barrelZ - slot.kickback * 0.06, profile.barrelRadius, profile.barrelRadius, profile.barrelLen, 3), ox, oy, oz, pitch, yaw, roll);
    appendPart(v, boxVerts(0, profile.barrelY + 0.006, profile.muzzleZ - slot.kickback * 0.06, profile.muzzleRadius, profile.muzzleRadius, profile.muzzleLen, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
    if (profile.suppressorLen > 0) {
        appendPart(v, boxVerts(0, profile.barrelY + 0.006, profile.muzzleZ - profile.suppressorLen * 0.58 - slot.kickback * 0.06, profile.muzzleRadius * 0.95, profile.muzzleRadius * 0.95, profile.suppressorLen, 3), ox, oy, oz, pitch, yaw, roll);
    } else {
        appendPart(v, boxVerts(profile.muzzleRadius * 0.7, profile.barrelY + 0.006, profile.muzzleZ - 0.02 - slot.kickback * 0.06, 0.006, 0.014, 0.012, 3), ox, oy, oz, pitch, yaw, roll);
        appendPart(v, boxVerts(-profile.muzzleRadius * 0.7, profile.barrelY + 0.006, profile.muzzleZ - 0.02 - slot.kickback * 0.06, 0.006, 0.014, 0.012, 3), ox, oy, oz, pitch, yaw, roll);
    }

    if (profile.topMag) {
        appendPart(v, boxVerts(0, 0.02, profile.receiverZ - 0.08, profile.receiverWidth * 0.8, profile.receiverHeight * 0.9, profile.receiverLen * 0.8, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
    }
    if (profile.woodFurniture) {
        appendPart(v, boxVerts(0, -0.004, profile.handguardZ, profile.handguardWidth * 0.84, 0.026, profile.handguardLen * 0.88, 14), ox, oy, oz, pitch, yaw, roll);
    }
    if (profile.boltHandle) {
        appendPart(v, boxVerts(profile.receiverWidth * 0.85, 0.02, profile.receiverZ + 0.05, 0.01, 0.01, 0.07, profile.bodyMat), ox, oy, oz, pitch, yaw, roll);
    }

    appendLongGunSights(v, profile, ox, oy, oz, pitch, yaw, roll, slot.kickback);
    appendPart(v, boxVerts(0, 0.02, profile.receiverZ - 0.02, profile.receiverWidth * 0.55, 0.025, profile.receiverLen * 0.65, profile.accentMat), ox, oy, oz, pitch, yaw, roll);

    const flashOffset = profile.suppressorLen > 0
        ? profile.muzzleZ - profile.suppressorLen - 0.05
        : profile.muzzleZ - 0.06;
    appendFlash(v, slot, ox, oy, oz, pitch, yaw, roll, flashOffset);
    return v;
}

function appendSingleSidearm(v, profile, slot, reload, originX, originY, originZ, pitch, yaw, roll) {
    if (profile.revolver) {
        appendPart(v, boxVerts(0, 0.03, -0.02, profile.slideWidth * 0.78, 0.03, 0.11, profile.bodyMat), originX, originY, originZ, pitch, yaw, roll);
        appendPart(v, boxVerts(0, 0.04, -0.14, profile.slideWidth * 0.55, 0.026, 0.18, 3), originX, originY, originZ, pitch, yaw, roll);
        appendPart(v, boxVerts(0, 0.01, 0.02, 0.038, 0.036, 0.05, 3), originX, originY, originZ, pitch, yaw, roll);
        appendPart(v, boxVerts(0, -0.085, 0.055, profile.gripWidth, profile.gripHeight, profile.gripDepth, profile.gripMat), originX, originY, originZ, pitch, yaw, roll);
        appendPart(v, boxVerts(0, 0.064, 0.03, 0.016, 0.014, 0.014, 3), originX, originY, originZ, pitch, yaw, roll);
        appendPart(v, boxVerts(0, 0.064, -0.28, 0.009, 0.014, 0.009, 3), originX, originY, originZ, pitch, yaw, roll);
        appendPart(v, boxVerts(0, -0.058, -0.004, 0.012, 0.022, 0.008, 3), originX, originY, originZ, pitch, yaw, roll);
        return;
    }

    appendPart(v, boxVerts(0, 0.032, profile.slideZ, profile.slideWidth, profile.slideHeight, profile.slideLen, profile.accentMat), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(profile.slideWidth * 0.88, 0.032, profile.slideZ + profile.slideLen * 0.34, 0.01, profile.slideHeight * 0.85, 0.03, profile.bodyMat), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(-profile.slideWidth * 0.88, 0.032, profile.slideZ + profile.slideLen * 0.34, 0.01, profile.slideHeight * 0.85, 0.03, profile.bodyMat), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(0, 0.056, profile.slideZ, profile.slideWidth * 0.65, 0.006, profile.slideLen * 0.8, profile.bodyMat), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(profile.slideWidth * 0.9, 0.038, profile.slideZ - 0.02, 0.008, 0.018, 0.04, profile.bodyMat), originX, originY, originZ, pitch, yaw, roll);

    appendPart(v, boxVerts(0, 0.026, profile.barrelZ - slot.kickback * 0.06, profile.barrelRadius, profile.barrelRadius, profile.barrelLen, 3), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(0, 0.03, profile.muzzleZ - slot.kickback * 0.06, profile.muzzleRadius, profile.muzzleRadius, profile.muzzleLen, profile.bodyMat), originX, originY, originZ, pitch, yaw, roll);
    if (profile.suppressorLen > 0) {
        appendPart(v, boxVerts(0, 0.03, profile.muzzleZ - profile.suppressorLen * 0.58 - slot.kickback * 0.06, profile.muzzleRadius * 0.94, profile.muzzleRadius * 0.94, profile.suppressorLen, 3), originX, originY, originZ, pitch, yaw, roll);
    }

    appendPart(v, boxVerts(0, -0.085, profile.gripZ, profile.gripWidth, profile.gripHeight, profile.gripDepth, profile.gripMat), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(profile.gripWidth + 0.002, -0.085, profile.gripZ, 0.004, profile.gripHeight * 0.84, profile.gripDepth * 0.84, profile.accentMat), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(-profile.gripWidth - 0.002, -0.085, profile.gripZ, 0.004, profile.gripHeight * 0.84, profile.gripDepth * 0.84, profile.accentMat), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(0, -0.123, 0.1, 0.03, 0.012, 0.04, 3), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(0, -0.058, profile.triggerZ, 0.012, 0.022, 0.008, 3), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(0, -0.025, -0.04, 0.016, 0.018, 0.03, profile.bodyMat), originX, originY, originZ, pitch, yaw, roll);

    const magDrop = reload.magOff * 0.16;
    if (profile.magHeight > 0 && reload.magOff <= 0.95) {
        appendPart(v, boxVerts(0, profile.magY - magDrop, profile.magZ, profile.magWidth, profile.magHeight, profile.magDepth, 3), originX, originY - (reload.magOff > 0.5 ? 0.1 : 0), originZ, pitch + reload.magOff * 0.08, yaw, roll);
        appendPart(v, boxVerts(0, profile.magY - profile.magHeight - 0.004 - magDrop, profile.magZ, profile.magWidth * 1.08, 0.006, profile.magDepth * 1.08, 3), originX, originY - (reload.magOff > 0.5 ? 0.1 : 0), originZ, pitch + reload.magOff * 0.08, yaw, roll);
    }

    if (profile.shroud) {
        appendPart(v, boxVerts(0, 0.044, profile.slideZ - 0.02, profile.slideWidth * 0.86, 0.012, profile.slideLen * 0.76, profile.bodyMat), originX, originY, originZ, pitch, yaw, roll);
        appendPart(v, boxVerts(0, 0.056, profile.slideZ - 0.12, profile.slideWidth * 0.6, 0.008, 0.04, 14), originX, originY, originZ, pitch, yaw, roll);
        appendPart(v, boxVerts(0, 0.056, profile.slideZ + 0.04, profile.slideWidth * 0.6, 0.008, 0.04, 14), originX, originY, originZ, pitch, yaw, roll);
    }

    appendPart(v, boxVerts(0, 0.062, profile.rearSightZ, 0.016, 0.014, 0.014, 3), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(0, 0.06, profile.frontSightZ, 0.009, 0.014, 0.009, 3), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(0.012, 0.062, profile.rearSightZ, 0.004, 0.018, 0.008, 3), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(-0.012, 0.062, profile.rearSightZ, 0.004, 0.018, 0.008, 3), originX, originY, originZ, pitch, yaw, roll);
    appendPart(v, boxVerts(0, -0.042, -0.1, 0.02, 0.006, 0.08, 3), originX, originY, originZ, pitch, yaw, roll);
}

function pistolVerts(kind, slot, reloadPhase) {
    const profile = getWeaponVisualProfile(kind);
    const { ox, oy, oz, pitch, yaw, roll } = baseTransform(slot, profile.baseX, profile.baseY, profile.baseZ, reloadPhase);
    const reload = reloadTransform(reloadPhase);
    const v = [];

    if (profile.dual) {
        const rightX = ox + 0.08;
        const leftX = ox - 0.08;
        appendPart(v, boxVerts(0.17, -0.03, -0.03, 0.056, 0.15, 0.078, 10), rightX, oy, oz, -0.28 + pitch, yaw * 0.42, roll * 0.24);
        appendPart(v, boxVerts(0.212, -0.18, 0.035, 0.054, 0.138, 0.07, 10), rightX, oy, oz, -0.61 + pitch, yaw * 0.32, roll * 0.18);
        appendPart(v, boxVerts(0.248, -0.285, 0.095, 0.046, 0.055, 0.055, 9), rightX, oy, oz, -0.16, yaw * 0.18, roll * 0.1);
        appendPart(v, boxVerts(-0.17, -0.03, -0.03, 0.056, 0.15, 0.078, 10), leftX, oy, oz, -0.28 + pitch, yaw * 0.42, -roll * 0.24);
        appendPart(v, boxVerts(-0.212, -0.18, 0.035, 0.054, 0.138, 0.07, 10), leftX, oy, oz, -0.61 + pitch, yaw * 0.32, -roll * 0.18);
        appendPart(v, boxVerts(-0.248, -0.285, 0.095, 0.046, 0.055, 0.055, 9), leftX, oy, oz, -0.16, yaw * 0.18, -roll * 0.1);
        appendSingleSidearm(v, profile, slot, reload, rightX, oy, oz, pitch, yaw, roll);
        appendSingleSidearm(v, profile, slot, reload, leftX, oy, oz, pitch, yaw, roll);
        appendFlash(v, slot, rightX, oy, oz, pitch, yaw, roll, profile.suppressorLen > 0 ? profile.muzzleZ - profile.suppressorLen - 0.04 : profile.muzzleZ - 0.05);
        appendFlash(v, slot, leftX, oy, oz, pitch, yaw, roll, profile.suppressorLen > 0 ? profile.muzzleZ - profile.suppressorLen - 0.04 : profile.muzzleZ - 0.05);
        return v;
    }

    appendPart(v, boxVerts(0.17, -0.03, -0.03, 0.056, 0.15, 0.078, 10), ox, oy, oz, -0.28 + pitch, yaw * 0.42, roll * 0.24);
    appendPart(v, boxVerts(0.212, -0.18, 0.035, 0.054, 0.138, 0.07, 10), ox, oy, oz, -0.61 + pitch, yaw * 0.32, roll * 0.18);
    appendPart(v, boxVerts(0.248, -0.285, 0.095, 0.046, 0.055, 0.055, 9), ox, oy, oz, -0.16, yaw * 0.18, roll * 0.1);
    appendPart(v, boxVerts(0.12, -0.015, -0.06, 0.012, 0.035, 0.05, 9), ox, oy, oz, -0.2 + pitch * 0.4, yaw * 0.3, roll * 0.2);
    appendPart(v, boxVerts(-0.02, -0.04, -0.015, 0.01, 0.03, 0.035, 9), ox, oy, oz, pitch * 0.5, yaw * 0.2, roll * 0.3);

    const lhPitch = -0.45 + pitch + reload.pitch;
    const lhOy = oy + reload.oy * 2.0;
    const lhOz = oz + reload.oz * 1.5;
    appendPart(v, boxVerts(profile.supportX, profile.supportY, profile.supportZ, 0.048, 0.046, 0.13, 10), ox, lhOy, lhOz, lhPitch, yaw * 0.3, roll * 0.2);
    appendPart(v, boxVerts(profile.supportX + 0.04, profile.supportY - 0.028, profile.supportZ + 0.015, 0.02, 0.035, 0.04, 9), ox, lhOy, lhOz, lhPitch - 0.2, yaw * 0.2, roll * 0.15);

    appendSingleSidearm(v, profile, slot, reload, ox, oy, oz, pitch, yaw, roll);
    appendFlash(v, slot, ox, oy, oz, pitch, yaw, roll, profile.suppressorLen > 0 ? profile.muzzleZ - profile.suppressorLen - 0.04 : profile.muzzleZ - 0.05);
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
    const reloadDuration = WEAPON_DEFS[weapon.kind]?.reloadMs || RELOAD_DURATION_MS;
    return Math.min(1, Math.max(0, 1 - weapon.reloadTimeMs / reloadDuration));
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
