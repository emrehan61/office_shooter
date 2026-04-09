import { HEAVY_WEAPON_DATA } from './weapon-data-heavy.js';
import { PISTOL_WEAPON_DATA } from './weapon-data-pistols.js';
import { RIFLE_WEAPON_CATALOG } from './weapon-data-rifles.js';
import { SMG_WEAPON_DATA } from './weapon-data-smgs.js';

export const STARTING_CREDITS = 800;
export const MAX_CREDITS = 16000;
export const MAX_ARMOR = 100;
export const ROUND_DURATION_MS = 5 * 60 * 1000;
export const BUY_PHASE_MS = 10 * 1000;
export const TOTAL_ROUNDS = 30;
export const LOSS_BONUS_STEPS = [1400, 1900, 2400, 2900, 3400];
export const ROUND_WIN_CREDITS = 3250;
export const RELOAD_DURATION_MS = 1800;
export const GRENADE_MAX = 1;

export const WEAPON_KNIFE = 'knife';
export const WEAPON_PISTOL = 'pistol';
export const WEAPON_MACHINE_GUN = 'machinegun';
export const DEFAULT_T_PISTOL = 'glock-18';
export const DEFAULT_CT_PISTOL = 'p2000';
export const UTILITY_BOMB = 'bomb';
export const UTILITY_SMOKE = 'smoke';
export const UTILITY_FLASHBANG = 'flashbang';
export const UTILITY_IDS = [UTILITY_BOMB, UTILITY_SMOKE, UTILITY_FLASHBANG];

const ALL_GUNS = [
    ...PISTOL_WEAPON_DATA,
    ...RIFLE_WEAPON_CATALOG,
    ...SMG_WEAPON_DATA,
    ...HEAVY_WEAPON_DATA,
];

export const WEAPON_CATALOG = Object.fromEntries(ALL_GUNS.map((weapon) => [weapon.id, weapon]));
export const PISTOL_IDS = PISTOL_WEAPON_DATA.map((weapon) => weapon.id);
export const HEAVY_IDS = [
    ...RIFLE_WEAPON_CATALOG.map((weapon) => weapon.id),
    ...SMG_WEAPON_DATA.map((weapon) => weapon.id),
    ...HEAVY_WEAPON_DATA.map((weapon) => weapon.id),
];

const KNIFE_DEF = {
    id: WEAPON_KNIFE,
    label: 'Knife',
    slot: 'knife',
    category: 'knife',
    side: 'both',
    price: 0,
    killReward: 0,
    magSize: 0,
    reserveMax: 0,
    reloadMs: 0,
    fireIntervalMs: 450,
    baseDamage: 55,
    armorPenetration: 1,
    rangeModifier: 1,
    moveSpeed: 250,
    scopedMoveSpeed: 250,
    pellets: 1,
    secondaryMode: 'stab',
    zoomLevels: [],
    renderClass: 'knife',
};

const UTILITY_DEFS = {
    [UTILITY_BOMB]: {
        id: UTILITY_BOMB,
        label: 'Nuke Grenade',
        slot: 'utility',
        category: 'utility',
        side: 'both',
        price: 1800,
        killReward: 600,
        magSize: 0,
        reserveMax: 0,
        reloadMs: 0,
        fireIntervalMs: 800,
        baseDamage: 165,
        armorPenetration: 1,
        rangeModifier: 1,
        moveSpeed: 250,
        scopedMoveSpeed: 250,
        pellets: 1,
        secondaryMode: 'throw',
        effect: 'High-yield blast radius',
        zoomLevels: [],
        renderClass: UTILITY_BOMB,
    },
    [UTILITY_SMOKE]: {
        id: UTILITY_SMOKE,
        label: 'Smoke Grenade',
        slot: 'utility',
        category: 'utility',
        side: 'both',
        price: 300,
        killReward: 0,
        magSize: 0,
        reserveMax: 0,
        reloadMs: 0,
        fireIntervalMs: 800,
        baseDamage: 0,
        armorPenetration: 1,
        rangeModifier: 1,
        moveSpeed: 250,
        scopedMoveSpeed: 250,
        pellets: 1,
        secondaryMode: 'throw',
        effect: 'Vision denial cloud',
        zoomLevels: [],
        renderClass: UTILITY_SMOKE,
    },
    [UTILITY_FLASHBANG]: {
        id: UTILITY_FLASHBANG,
        label: 'Flashbang',
        slot: 'utility',
        category: 'utility',
        side: 'both',
        price: 200,
        killReward: 0,
        magSize: 0,
        reserveMax: 0,
        reloadMs: 0,
        fireIntervalMs: 800,
        baseDamage: 0,
        armorPenetration: 1,
        rangeModifier: 1,
        moveSpeed: 250,
        scopedMoveSpeed: 250,
        pellets: 1,
        secondaryMode: 'throw',
        effect: 'Blind nearby enemies',
        zoomLevels: [],
        renderClass: UTILITY_FLASHBANG,
    },
};

const BASE_MOVE_SPEED = 240;

function hydrateWeaponDef(def) {
    return {
        ...def,
        hudAmmoLabel: def.category === 'sniper' ? 'SNIPER' : def.label.toUpperCase(),
        usesAmmo: def.magSize > 0,
        canAim: def.zoomLevels.length > 0,
        adsFovMultiplier: def.zoomLevels[0] || 1,
        moveSpeedMultiplier: (def.moveSpeed || BASE_MOVE_SPEED) / BASE_MOVE_SPEED,
        jumpMultiplier: (def.moveSpeed || BASE_MOVE_SPEED) / BASE_MOVE_SPEED,
        adsMoveSpeedMultiplier: def.zoomLevels.length > 0 && def.scopedMoveSpeed > 0
            ? def.scopedMoveSpeed / Math.max(1, def.moveSpeed)
            : 1,
        adsRecoilMultiplier: def.zoomLevels.length > 0 ? 0.72 : 1,
        recoilViewScale: def.zoomLevels.length > 0 ? 1.4 : 2.0,
        renderAs: def.slot === 'pistol'
            ? WEAPON_PISTOL
            : def.slot === 'heavy'
                ? WEAPON_MACHINE_GUN
                : def.renderClass,
    };
}

export const WEAPON_DEFS = {
    [WEAPON_KNIFE]: hydrateWeaponDef(KNIFE_DEF),
    ...Object.fromEntries(ALL_GUNS.map((weapon) => [weapon.id, hydrateWeaponDef(weapon)])),
    ...Object.fromEntries(Object.values(UTILITY_DEFS).map((utility) => [utility.id, hydrateWeaponDef(utility)])),
};

export const BUY_MENU_SECTIONS = [
    {
        id: 'pistols',
        label: 'Pistols',
        description: 'Sidearms',
        itemIds: PISTOL_IDS,
    },
    {
        id: 'rifles',
        label: 'Rifles',
        description: 'Rifles and snipers',
        itemIds: RIFLE_WEAPON_CATALOG.map((weapon) => weapon.id),
    },
    {
        id: 'smgs',
        label: 'SMGs',
        description: 'Fast-entry weapons',
        itemIds: SMG_WEAPON_DATA.map((weapon) => weapon.id),
    },
    {
        id: 'heavy',
        label: 'Heavy',
        description: 'Shotguns and machine guns',
        itemIds: HEAVY_WEAPON_DATA.map((weapon) => weapon.id),
    },
    {
        id: 'grenades',
        label: 'Grenades',
        description: 'Three utility slots',
        itemIds: [UTILITY_BOMB, UTILITY_SMOKE, UTILITY_FLASHBANG],
    },
    {
        id: 'gear',
        label: 'Gear',
        description: 'Armor',
        itemIds: ['armor'],
    },
];

export const SHOP_ITEMS = [
    ...ALL_GUNS.map((weapon) => ({
        id: weapon.id,
        slot: weapon.slot === 'pistol' ? '2' : '1',
        label: weapon.label,
        cost: weapon.price,
        effect: weapon.side === 'both'
            ? weapon.category.toUpperCase()
            : `${weapon.side.toUpperCase()} ${weapon.category.toUpperCase()}`,
    })),
    {
        id: UTILITY_BOMB,
        slot: '4',
        label: 'Nuke Grenade',
        cost: UTILITY_DEFS[UTILITY_BOMB].price,
        effect: 'High-yield area blast',
    },
    {
        id: UTILITY_SMOKE,
        slot: '4',
        label: 'Smoke Grenade',
        cost: UTILITY_DEFS[UTILITY_SMOKE].price,
        effect: 'Vision denial',
    },
    {
        id: UTILITY_FLASHBANG,
        slot: '4',
        label: 'Flashbang',
        cost: UTILITY_DEFS[UTILITY_FLASHBANG].price,
        effect: 'Blind utility',
    },
    {
        id: 'armor',
        slot: '5',
        label: 'Kevlar',
        cost: 650,
        effect: '+100 armor',
    },
];

export function getBuyItemById(id) {
    return SHOP_ITEMS.find((item) => item.id === id) || null;
}

export function getWeaponById(id) {
    return WEAPON_DEFS[id] || null;
}

export function isUtilityWeapon(weaponId) {
    return UTILITY_IDS.includes(weaponId);
}

export function isPistolWeapon(weaponId) {
    return PISTOL_IDS.includes(weaponId);
}

export function isHeavyWeapon(weaponId) {
    return HEAVY_IDS.includes(weaponId);
}

export function canAimWeapon(weaponId) {
    return !!WEAPON_DEFS[weaponId]?.canAim;
}

export function isScopedWeapon(weaponId) {
    return (WEAPON_DEFS[weaponId]?.zoomLevels?.length || 0) > 0;
}

export function getRenderableWeapon(weaponId) {
    return WEAPON_DEFS[weaponId]?.renderAs || WEAPON_KNIFE;
}

export function getWeaponSwitchByCode(code, player = null) {
    if (code === 'Digit1') return player?.heavyWeapon || null;
    if (code === 'Digit2') return player?.pistolWeapon || null;
    if (code === 'Digit3') return WEAPON_KNIFE;
    return null;
}

export function weaponAllowedForTeam(weaponId, team) {
    const side = WEAPON_DEFS[weaponId]?.side || 'both';
    if (side === 'both') return true;
    if (side === 't') return team !== 'blue';
    if (side === 'ct') return team !== 'green';
    return true;
}

export function getDefaultPistolForTeam(team) {
    return team === 'green' ? DEFAULT_T_PISTOL : DEFAULT_CT_PISTOL;
}
