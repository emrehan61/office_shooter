export const STARTING_CREDITS = 300;
export const MAX_ARMOR = 100;
export const ROUND_DURATION_MS = 5 * 60 * 1000;
export const BUY_PHASE_MS = 10 * 1000;
export const TOTAL_ROUNDS = 30;
export const RELOAD_DURATION_MS = 1800;
export const MACHINE_GUN_MAG_SIZE = 30;
export const MACHINE_GUN_AMMO_MAX = 90;
export const MACHINE_GUN_AMMO_PACK = 30;
export const PISTOL_MAG_SIZE = 7;
export const PISTOL_AMMO_MAX = 21;
export const PISTOL_AMMO_PACK = 7;
export const GRENADE_MAX = 1;

export const WEAPON_KNIFE = 'knife';
export const WEAPON_PISTOL = 'pistol';
export const WEAPON_MACHINE_GUN = 'machinegun';
export const UTILITY_BOMB = 'bomb';
export const UTILITY_SMOKE = 'smoke';
export const UTILITY_FLASHBANG = 'flashbang';
export const UTILITY_IDS = [UTILITY_BOMB, UTILITY_SMOKE, UTILITY_FLASHBANG];

export const WEAPON_DEFS = {
    [WEAPON_KNIFE]: {
        id: WEAPON_KNIFE,
        label: 'Knife',
        switchCode: 'Digit3',
        hudAmmoLabel: 'MELEE',
        usesAmmo: false,
        fireRate: 0.45,
        altFireRate: 0.9,
        moveSpeedMultiplier: 1.25,
        jumpMultiplier: 1.25,
        canAim: false,
        adsFovMultiplier: 1,
        adsMoveSpeedMultiplier: 1,
        adsRecoilMultiplier: 1,
        recoilViewScale: 1,
        renderAs: WEAPON_KNIFE,
    },
    [WEAPON_PISTOL]: {
        id: WEAPON_PISTOL,
        label: 'Pistol',
        switchCode: 'Digit2',
        hudAmmoLabel: 'PISTOL',
        usesAmmo: true,
        fireRate: 0.34,
        moveSpeedMultiplier: 1,
        jumpMultiplier: 1,
        canAim: true,
        adsFovMultiplier: 0.72,
        adsMoveSpeedMultiplier: 0.78,
        adsRecoilMultiplier: 0.66,
        recoilViewScale: 2.0,
        renderAs: WEAPON_PISTOL,
    },
    [WEAPON_MACHINE_GUN]: {
        id: WEAPON_MACHINE_GUN,
        label: 'Machine Gun',
        switchCode: 'Digit1',
        hudAmmoLabel: 'MG',
        usesAmmo: true,
        fireRate: 0.1,
        moveSpeedMultiplier: 0.75,
        jumpMultiplier: 0.75,
        canAim: true,
        adsFovMultiplier: 0.56,
        adsMoveSpeedMultiplier: 0.55,
        adsRecoilMultiplier: 0.58,
        recoilViewScale: 2.0,
        renderAs: WEAPON_MACHINE_GUN,
    },
    [UTILITY_BOMB]: {
        id: UTILITY_BOMB,
        label: 'Bomb',
        hudAmmoLabel: 'BOMB',
        usesAmmo: false,
        fireRate: 0.8,
        moveSpeedMultiplier: 1.25,
        jumpMultiplier: 1.25,
        canAim: false,
        adsFovMultiplier: 1,
        adsMoveSpeedMultiplier: 1,
        adsRecoilMultiplier: 1,
        renderAs: UTILITY_BOMB,
    },
    [UTILITY_SMOKE]: {
        id: UTILITY_SMOKE,
        label: 'Smoke',
        hudAmmoLabel: 'SMOKE',
        usesAmmo: false,
        fireRate: 0.8,
        moveSpeedMultiplier: 1.25,
        jumpMultiplier: 1.25,
        canAim: false,
        adsFovMultiplier: 1,
        adsMoveSpeedMultiplier: 1,
        adsRecoilMultiplier: 1,
        renderAs: UTILITY_SMOKE,
    },
    [UTILITY_FLASHBANG]: {
        id: UTILITY_FLASHBANG,
        label: 'Flashbang',
        hudAmmoLabel: 'FLASH',
        usesAmmo: false,
        fireRate: 0.8,
        moveSpeedMultiplier: 1.25,
        jumpMultiplier: 1.25,
        canAim: false,
        adsFovMultiplier: 1,
        adsMoveSpeedMultiplier: 1,
        adsRecoilMultiplier: 1,
        renderAs: UTILITY_FLASHBANG,
    },
};

export const BUY_MENU_SECTIONS = [
    {
        id: '1',
        label: 'Machine Gun',
        description: 'Primary weapon and ammo',
        itemIds: ['buy-machinegun', 'machinegun-ammo'],
    },
    {
        id: '2',
        label: 'Pistol',
        description: 'Sidearm and ammo',
        itemIds: ['buy-pistol', 'pistol-ammo'],
    },
    {
        id: '3',
        label: 'Grenades',
        description: 'Utility stock',
        itemIds: ['bomb', 'smoke', 'flashbang'],
    },
    {
        id: '4',
        label: 'Armor',
        description: 'Protection',
        itemIds: ['armor'],
    },
];

export const SHOP_ITEMS = [
    {
        id: 'buy-machinegun',
        slot: '1.1',
        label: 'Machine Gun',
        cost: 1800,
        effect: '+Weapon, 30/90 ammo',
    },
    {
        id: 'machinegun-ammo',
        slot: '1.2',
        label: 'Machine Gun Ammo',
        cost: 220,
        effect: '+30 reserve',
    },
    {
        id: 'buy-pistol',
        slot: '2.1',
        label: 'Pistol',
        cost: 700,
        effect: '+Weapon, 7/21 ammo',
    },
    {
        id: 'pistol-ammo',
        slot: '2.2',
        label: 'Pistol Ammo',
        cost: 140,
        effect: '+7 reserve',
    },
    {
        id: 'bomb',
        slot: '3.1',
        label: 'Bomb',
        cost: 300,
        effect: 'Explosive utility',
    },
    {
        id: 'smoke',
        slot: '3.2',
        label: 'Smoke',
        cost: 250,
        effect: 'Vision denial',
    },
    {
        id: 'flashbang',
        slot: '3.3',
        label: 'Flashbang',
        cost: 250,
        effect: 'Blind utility',
    },
    {
        id: 'armor',
        slot: '4.1',
        label: 'Armor Plate',
        cost: 180,
        effect: '+25 armor',
    },
];

export function getBuyItemById(id) {
    return SHOP_ITEMS.find((item) => item.id === id) || null;
}

export function getWeaponSwitchByCode(code) {
    return Object.values(WEAPON_DEFS).find((weapon) => weapon.switchCode === code) || null;
}

export function isUtilityWeapon(weaponId) {
    return UTILITY_IDS.includes(weaponId);
}

export function canAimWeapon(weaponId) {
    return !!WEAPON_DEFS[weaponId]?.canAim;
}

export function getRenderableWeapon(weaponId) {
    return WEAPON_DEFS[weaponId]?.renderAs || WEAPON_KNIFE;
}
