# CS:GO Arsenal And Economy Refactor

## Goal

Replace the current placeholder `knife/pistol/machinegun` system with a data-driven Counter-Strike: Global Offensive arsenal while preserving the game's existing one-heavy, one-pistol, one-knife, three-utility slot model.

## Constraints

- Keep the server authoritative for damage, ammo, recoil timing, and purchases.
- Preserve SoA player storage semantics on the server.
- Do not model multiple stored heavy weapons or multiple stored pistols.
- Use CS:GO-era prices, ammo counts, firing cadence, and kill rewards where the current game rules permit.
- Where the current game rules diverge from CS:GO (no bomb objective, no weapon drops, no armor helmet split), prefer the closest compatible behavior rather than adding an entire new game mode.

## Inventory Model

Each player owns:

- `heavyWeapon`: `WeaponID` or empty
- `heavyClip`: current magazine ammo for `heavyWeapon`
- `heavyReserve`: reserve ammo for `heavyWeapon`
- `pistolWeapon`: `WeaponID`
- `pistolClip`: current magazine ammo for `pistolWeapon`
- `pistolReserve`: reserve ammo for `pistolWeapon`
- `activeWeapon`: one of `knife`, current pistol, current heavy, or a utility id
- three utility counters: explosive, smoke, flashbang

Rules:

- Exactly one heavy weapon can be equipped at a time.
- Exactly one pistol can be equipped at a time.
- Knife is always available.
- Utilities are independent inventory counts.
- Buying a different heavy or pistol replaces the current weapon in that slot and resets that slot's ammo to the purchased weapon's default clip and reserve.

## Weapon Data Contract

Client and server both use mirrored catalogs. Each weapon definition should include:

- `id`
- `slot`: `heavy`, `pistol`, `knife`, or `utility`
- `category`: `rifle`, `smg`, `shotgun`, `machinegun`, `sniper`, `pistol`, `knife`, `utility`
- `side`: `t`, `ct`, or `both`
- `label`
- `price`
- `killReward`
- `magSize`
- `reserveMax`
- `reloadMs`
- `fireIntervalMs`
- `baseDamage`
- `armorPenetration`
- `rangeModifier`
- `moveSpeed`
- `scopedMoveSpeed` when applicable
- `pellets` for shotguns
- `burstSize` or `secondaryMode` when applicable
- `zoomLevels` when applicable
- `renderClass`: broad visual class used by existing low-poly weapon rendering

## Economy Model

Competitive-style constants to adopt:

- starting money: `$800`
- money cap: `$16000`
- elimination/time win team reward: `$3250`
- loss bonus ladder: `$1400/$1900/$2400/$2900/$3400`
- pistol-round loss bonus: `$1900`
- heavy/pistol/utility kill reward exceptions should come from weapon data

Utilities:

- explosive grenade price should align with HE grenade pricing
- smoke and flashbang prices should align with CS:GO prices

Given the game has no plant/defuse objective, skip bomb-plant and defuse bonuses.

## Protocol Changes

Replace legacy state payload fields:

- remove dependence on `hasPistol`, `hasMachineGun`, `machineGunClip`, `machineGunReserve`
- add `pistolWeapon`, `heavyWeapon`, `heavyClip`, `heavyReserve`
- keep `pistolClip`, `pistolReserve`
- keep `activeWeapon`

Economy updates and respawn payloads must use the same new fields.

## Gameplay Mapping

- Rifles, SMGs, pistols, LMGs, and auto-snipers use single-hit hitscan.
- Shotguns fire multiple pellets server-side.
- Snipers and scoped rifles reuse the current ADS system with weapon-specific FOV and movement penalties.
- Knife keeps the current slash/stab split.
- Burst weapons should be represented in the data model even if the first integration pass maps them to the existing fire input model.

## UI Mapping

Replace the current flat shop with a CS-like buy screen:

- left rail: sections for pistols, heavy weapons, grenades, armor
- center content: grouped weapon cards
- right pane: selected weapon stats and current slot status
- weapon cards show `price`, side restriction, equipped state, and affordability
- loadout bar should show actual equipped heavy and pistol labels instead of generic `Machine Gun` and `Pistol`

## File Layout

Data slices:

- `client/js/weapon-data-pistols.js`
- `client/js/weapon-data-rifles.js`
- `client/js/weapon-data-smgs.js`
- `client/js/weapon-data-heavy.js`
- `server/weapon_data_pistols.go`
- `server/weapon_data_rifles.go`
- `server/weapon_data_smgs.go`
- `server/weapon_data_heavy.go`

Integration points:

- `client/js/economy.js`
- `client/js/player.js`
- `client/js/weapon.js`
- `client/js/hud.js`
- `client/js/net.js`
- `client/js/main.js`
- `client/style.css`
- `client/index.html`
- `server/main.go`

## Sources

- Counter-Strike Wiki buy menu page for CS:GO-era buy prices
- Counter-Strike Wiki money page for competitive starting money, loss bonuses, and kill rewards
- Counter-Strike Wiki weapon pages for damage, magazine size, reserve ammo, reload times, fire rate, movement speed, and role-specific traits
