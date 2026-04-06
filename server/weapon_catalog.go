package main

type WeaponCatalogEntry struct {
	ID               string    `json:"id"`
	Slot             string    `json:"slot"`
	Category         string    `json:"category"`
	Side             string    `json:"side"`
	Label            string    `json:"label"`
	Price            int       `json:"price"`
	KillReward       int       `json:"killReward"`
	MagSize          int       `json:"magSize"`
	ReserveMax       int       `json:"reserveMax"`
	ReloadMS         int       `json:"reloadMs"`
	FireIntervalMS   int       `json:"fireIntervalMs"`
	BaseDamage       int       `json:"baseDamage"`
	ArmorPenetration float64   `json:"armorPenetration"`
	RangeModifier    float64   `json:"rangeModifier"`
	MoveSpeed        float64   `json:"moveSpeed"`
	ScopedMoveSpeed  float64   `json:"scopedMoveSpeed"`
	Pellets          int       `json:"pellets"`
	SecondaryMode    string    `json:"secondaryMode"`
	ZoomLevels       []float64 `json:"zoomLevels"`
	RenderClass      string    `json:"renderClass"`
}

var weaponCatalog = buildWeaponCatalog()

func buildWeaponCatalog() map[WeaponID]WeaponCatalogEntry {
	catalog := make(map[WeaponID]WeaponCatalogEntry, len(PistolWeaponCatalog)+len(RifleWeaponCatalog)+len(SMGWeaponCatalog)+len(HeavyWeaponCatalog))
	for _, item := range PistolWeaponCatalog {
		catalog[WeaponID(item.ID)] = item
	}
	for _, item := range RifleWeaponCatalog {
		catalog[WeaponID(item.ID)] = item
	}
	for _, item := range SMGWeaponCatalog {
		catalog[WeaponID(item.ID)] = item
	}
	for _, item := range HeavyWeaponCatalog {
		catalog[WeaponID(item.ID)] = item
	}
	return catalog
}

func weaponCatalogEntryByID(id WeaponID) (WeaponCatalogEntry, bool) {
	entry, ok := weaponCatalog[id]
	return entry, ok
}

func weaponLabel(id WeaponID) string {
	if entry, ok := weaponCatalogEntryByID(id); ok {
		return entry.Label
	}
	switch id {
	case WeaponKnife:
		return "Knife"
	case WeaponBomb:
		return "HE Grenade"
	case WeaponSmoke:
		return "Smoke Grenade"
	case WeaponFlashbang:
		return "Flashbang"
	default:
		return string(id)
	}
}

func weaponAllowedForTeam(id WeaponID, team TeamID) bool {
	entry, ok := weaponCatalogEntryByID(id)
	if !ok {
		return id == WeaponKnife || isUtilityWeaponID(id)
	}
	switch entry.Side {
	case "both":
		return true
	case "t":
		return normalizeTeam(team) != TeamBlue
	case "ct":
		return normalizeTeam(team) != TeamGreen
	default:
		return true
	}
}

func defaultPistolForTeam(team TeamID) WeaponID {
	if normalizeTeam(team) == TeamGreen {
		return WeaponID("glock-18")
	}
	return WeaponID("p2000")
}

func isPistolWeapon(id WeaponID) bool {
	entry, ok := weaponCatalogEntryByID(id)
	return ok && entry.Slot == "pistol"
}

func isHeavyWeapon(id WeaponID) bool {
	entry, ok := weaponCatalogEntryByID(id)
	return ok && entry.Slot == "heavy"
}

func isScopedWeapon(id WeaponID) bool {
	entry, ok := weaponCatalogEntryByID(id)
	return ok && len(entry.ZoomLevels) > 0
}
