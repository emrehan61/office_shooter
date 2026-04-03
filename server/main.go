package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

const (
	maxPlayers              = 6
	tickRate                = 60
	maxHP                   = 100
	maxArmor                = 100
	standEyeHeight          = 1.7
	crouchEyeHeight         = 1.15
	grenadeMaxCount         = 1
	startingCredits         = 300
	totalRounds             = 30
	roundDurationMS         = 5 * 60 * 1000
	buyPhaseDurationMS      = 10 * 1000
	roundCooldownMS         = 5 * 1000
	roundIncomeCredits      = 1000
	respawnDelayMS          = 3 * 1000
	positionHistoryWindowMS = 1000
	maxLagCompensationMS    = 250
	hitscanRange            = 50.0
	knifeRange              = 2.6
	machineGunCost          = 1800
	machineGunMagSize       = 30
	machineGunAmmoPack      = 30
	machineGunAmmoPackCost  = 220
	machineGunAmmoMax       = 90
	pistolCost              = 700
	pistolMagSize           = 7
	pistolAmmoPack          = 7
	pistolAmmoPackCost      = 140
	pistolAmmoMax           = 21
	bombCost                = 300
	smokeCost               = 250
	flashbangCost           = 250
	armorPlateCost          = 180
	armorPlateAmount        = 25
	headHitReward           = 35
	bodyHitReward           = 20
	killReward              = 200
	reloadDurationMS        = 800
	utilityThrowIntervalMS  = 800
	projectileSpeed         = 16.0
	projectileGravity       = -18.0
	projectileBounce        = 0.45
	projectileGroundDrag    = 0.72
	projectileBounds        = 29.5
	projectileCeilingY      = 4.9
	projectileFloorY        = 0.12
	projectileFuseMS        = 1800
	bombDamage              = 100
	bombRadius              = 6.0
	flashbangRadius         = 12.0
	flashbangDurationMS     = 3 * 1000
	flashbangVisibleDot     = 0.2
	smokeRadius             = 9.0
	smokeDurationMS         = 8 * 1000
	bombEffectDurationMS    = 350
)

type GameState int

const (
	StateWaiting GameState = iota
	StatePlaying
)

type HitZone string

const (
	HitZoneHead HitZone = "head"
	HitZoneBody HitZone = "body"
)

type WeaponID string

const (
	WeaponKnife      WeaponID = "knife"
	WeaponPistol     WeaponID = "pistol"
	WeaponMachineGun WeaponID = "machinegun"
	WeaponBomb       WeaponID = "bomb"
	WeaponSmoke      WeaponID = "smoke"
	WeaponFlashbang  WeaponID = "flashbang"
)

type TeamID string

const (
	TeamNone  TeamID = ""
	TeamBlue  TeamID = "blue"
	TeamGreen TeamID = "green"
)

type Vec3 [3]float64

type positionSample struct {
	At        int64
	Pos       Vec3
	Crouching bool
}

type projectileState struct {
	ID         int
	Type       WeaponID
	OwnerID    int
	Pos        Vec3
	Vel        Vec3
	DetonateAt int64
}

type projectileSnapshot struct {
	ID   int      `json:"id"`
	Type WeaponID `json:"type"`
	Pos  Vec3     `json:"pos"`
}

type areaEffectState struct {
	Type      string
	Pos       Vec3
	Radius    float64
	ExpiresAt int64
}

type areaEffectSnapshot struct {
	Type       string  `json:"type"`
	Pos        Vec3    `json:"pos"`
	Radius     float64 `json:"radius"`
	TimeLeftMS int64   `json:"timeLeftMs"`
}

type playerStore struct {
	ids           []int
	names         []string
	pos           []Vec3
	yaw           []float64
	pitch         []float64
	crouching     []bool
	hp            []int
	armor         []int
	credits       []int
	team          []TeamID
	hasPistol     []bool
	hasMG         []bool
	pistolClip    []int
	pistolReserve []int
	mgClip        []int
	mgReserve     []int
	bombs         []int
	smokes        []int
	flashbangs    []int
	flashEndsAt   []int64
	activeWeapon  []WeaponID
	reloadWeapon  []WeaponID
	reloadEndsAt  []int64
	nextAttackAt  []int64
	shotBloom     []float64
	bloomWeapon   []WeaponID
	lastShotAt    []int64
	kills         []int
	deaths        []int
	alive         []bool
	conns         []*websocket.Conn
	sendChs       []chan []byte
	history       [][]positionSample
	idToIndex     map[int]int
}

type Game struct {
	mu                 sync.RWMutex
	players            playerStore
	nextID             int
	state              GameState
	currentRound       int
	roundEndsAt        int64
	buyEndsAt          int64
	intermissionEndsAt int64
	roundWinner        TeamID
	pendingMatchEnd    bool
	blueScore          int
	greenScore         int
	projectiles        []projectileState
	effects            []areaEffectState
	nextProjID         int
}

type hitCandidate struct {
	index int
	id    int
	zone  HitZone
	dist  float64
}

type hitBox struct {
	zone HitZone
	min  Vec3
	max  Vec3
}

type tickMessages struct {
	broadcasts [][]byte
	directs    map[int][][]byte
}

var game = &Game{
	players: newPlayerStore(),
	nextID:  1,
	state:   StateWaiting,
}

var spawnPoints = [6]Vec3{
	{-25, standEyeHeight, -25},
	{25, standEyeHeight, -25},
	{25, standEyeHeight, 25},
	{-25, standEyeHeight, 25},
	{0, standEyeHeight, -12},
	{0, standEyeHeight, 12},
}

func newPlayerStore() playerStore {
	return playerStore{
		idToIndex: make(map[int]int),
	}
}

func (ps *playerStore) indexOf(id int) (int, bool) {
	idx, ok := ps.idToIndex[id]
	return idx, ok
}

func (ps *playerStore) add(id int, conn *websocket.Conn, spawn Vec3, nowMS int64) chan []byte {
	sendCh := make(chan []byte, 64)
	idx := len(ps.ids)

	ps.ids = append(ps.ids, id)
	ps.names = append(ps.names, "")
	ps.pos = append(ps.pos, spawn)
	ps.yaw = append(ps.yaw, 0)
	ps.pitch = append(ps.pitch, 0)
	ps.crouching = append(ps.crouching, false)
	ps.hp = append(ps.hp, maxHP)
	ps.armor = append(ps.armor, 0)
	ps.credits = append(ps.credits, startingCredits)
	ps.team = append(ps.team, TeamNone)
	ps.hasPistol = append(ps.hasPistol, false)
	ps.hasMG = append(ps.hasMG, false)
	ps.pistolClip = append(ps.pistolClip, 0)
	ps.pistolReserve = append(ps.pistolReserve, 0)
	ps.mgClip = append(ps.mgClip, 0)
	ps.mgReserve = append(ps.mgReserve, 0)
	ps.bombs = append(ps.bombs, 0)
	ps.smokes = append(ps.smokes, 0)
	ps.flashbangs = append(ps.flashbangs, 0)
	ps.flashEndsAt = append(ps.flashEndsAt, 0)
	ps.activeWeapon = append(ps.activeWeapon, WeaponKnife)
	ps.reloadWeapon = append(ps.reloadWeapon, WeaponKnife)
	ps.reloadEndsAt = append(ps.reloadEndsAt, 0)
	ps.nextAttackAt = append(ps.nextAttackAt, 0)
	ps.shotBloom = append(ps.shotBloom, 0)
	ps.bloomWeapon = append(ps.bloomWeapon, WeaponKnife)
	ps.lastShotAt = append(ps.lastShotAt, 0)
	ps.kills = append(ps.kills, 0)
	ps.deaths = append(ps.deaths, 0)
	ps.alive = append(ps.alive, true)
	ps.conns = append(ps.conns, conn)
	ps.sendChs = append(ps.sendChs, sendCh)
	ps.history = append(ps.history, []positionSample{{At: nowMS, Pos: spawn, Crouching: false}})
	ps.idToIndex[id] = idx

	return sendCh
}

func (ps *playerStore) removeAt(idx int) {
	last := len(ps.ids) - 1
	removedID := ps.ids[idx]

	if idx != last {
		movedID := ps.ids[last]
		ps.ids[idx] = ps.ids[last]
		ps.names[idx] = ps.names[last]
		ps.pos[idx] = ps.pos[last]
		ps.yaw[idx] = ps.yaw[last]
		ps.pitch[idx] = ps.pitch[last]
		ps.crouching[idx] = ps.crouching[last]
		ps.hp[idx] = ps.hp[last]
		ps.armor[idx] = ps.armor[last]
		ps.credits[idx] = ps.credits[last]
		ps.team[idx] = ps.team[last]
		ps.hasPistol[idx] = ps.hasPistol[last]
		ps.hasMG[idx] = ps.hasMG[last]
		ps.pistolClip[idx] = ps.pistolClip[last]
		ps.pistolReserve[idx] = ps.pistolReserve[last]
		ps.mgClip[idx] = ps.mgClip[last]
		ps.mgReserve[idx] = ps.mgReserve[last]
		ps.bombs[idx] = ps.bombs[last]
		ps.smokes[idx] = ps.smokes[last]
		ps.flashbangs[idx] = ps.flashbangs[last]
		ps.flashEndsAt[idx] = ps.flashEndsAt[last]
		ps.activeWeapon[idx] = ps.activeWeapon[last]
		ps.reloadWeapon[idx] = ps.reloadWeapon[last]
		ps.reloadEndsAt[idx] = ps.reloadEndsAt[last]
		ps.nextAttackAt[idx] = ps.nextAttackAt[last]
		ps.shotBloom[idx] = ps.shotBloom[last]
		ps.bloomWeapon[idx] = ps.bloomWeapon[last]
		ps.lastShotAt[idx] = ps.lastShotAt[last]
		ps.kills[idx] = ps.kills[last]
		ps.deaths[idx] = ps.deaths[last]
		ps.alive[idx] = ps.alive[last]
		ps.conns[idx] = ps.conns[last]
		ps.sendChs[idx] = ps.sendChs[last]
		ps.history[idx] = ps.history[last]
		ps.idToIndex[movedID] = idx
	}

	ps.ids = ps.ids[:last]
	ps.names = ps.names[:last]
	ps.pos = ps.pos[:last]
	ps.yaw = ps.yaw[:last]
	ps.pitch = ps.pitch[:last]
	ps.crouching = ps.crouching[:last]
	ps.hp = ps.hp[:last]
	ps.armor = ps.armor[:last]
	ps.credits = ps.credits[:last]
	ps.team = ps.team[:last]
	ps.hasPistol = ps.hasPistol[:last]
	ps.hasMG = ps.hasMG[:last]
	ps.pistolClip = ps.pistolClip[:last]
	ps.pistolReserve = ps.pistolReserve[:last]
	ps.mgClip = ps.mgClip[:last]
	ps.mgReserve = ps.mgReserve[:last]
	ps.bombs = ps.bombs[:last]
	ps.smokes = ps.smokes[:last]
	ps.flashbangs = ps.flashbangs[:last]
	ps.flashEndsAt = ps.flashEndsAt[:last]
	ps.activeWeapon = ps.activeWeapon[:last]
	ps.reloadWeapon = ps.reloadWeapon[:last]
	ps.reloadEndsAt = ps.reloadEndsAt[:last]
	ps.nextAttackAt = ps.nextAttackAt[:last]
	ps.shotBloom = ps.shotBloom[:last]
	ps.bloomWeapon = ps.bloomWeapon[:last]
	ps.lastShotAt = ps.lastShotAt[:last]
	ps.kills = ps.kills[:last]
	ps.deaths = ps.deaths[:last]
	ps.alive = ps.alive[:last]
	ps.conns = ps.conns[:last]
	ps.sendChs = ps.sendChs[:last]
	ps.history = ps.history[:last]
	delete(ps.idToIndex, removedID)
}

func (g *Game) addPlayer(conn *websocket.Conn) (int, chan []byte, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if len(g.players.ids) >= maxPlayers {
		return 0, nil, false
	}

	id := g.nextID
	g.nextID++

	spawn := spawnPoints[rand.Intn(len(spawnPoints))]
	sendCh := g.players.add(id, conn, spawn, time.Now().UnixMilli())
	return id, sendCh, true
}

func (g *Game) removePlayer(id int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	idx, ok := g.players.indexOf(id)
	if !ok {
		return
	}
	g.players.removeAt(idx)
	if len(g.players.ids) == 0 {
		g.state = StateWaiting
		g.currentRound = 0
		g.roundEndsAt = 0
		g.buyEndsAt = 0
		g.intermissionEndsAt = 0
		g.roundWinner = TeamNone
		g.pendingMatchEnd = false
		g.blueScore = 0
		g.greenScore = 0
		g.projectiles = nil
		g.effects = nil
		g.nextProjID = 0
	}
}

func (g *Game) broadcast(msg []byte, exclude int) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	for i, id := range g.players.ids {
		if id == exclude {
			continue
		}
		select {
		case g.players.sendChs[i] <- msg:
		default:
		}
	}
}

func (g *Game) broadcastLobby() {
	nowMS := time.Now().UnixMilli()
	g.mu.RLock()
	defer g.mu.RUnlock()

	type LobbyPlayer struct {
		ID     int    `json:"id"`
		Name   string `json:"name"`
		Team   TeamID `json:"team"`
		Kills  int    `json:"kills"`
		Deaths int    `json:"deaths"`
	}

	players := make([]LobbyPlayer, 0, len(g.players.ids))
	for i, id := range g.players.ids {
		if g.players.names[i] != "" {
			players = append(players, LobbyPlayer{
				ID:     id,
				Name:   g.players.names[i],
				Team:   g.players.team[i],
				Kills:  g.players.kills[i],
				Deaths: g.players.deaths[i],
			})
		}
	}

	msg, _ := json.Marshal(map[string]interface{}{
		"t":       "lobby",
		"players": players,
		"state":   gameStateName(g.state),
		"match":   g.buildMatchStateLocked(nowMS),
	})

	for _, sendCh := range g.players.sendChs {
		select {
		case sendCh <- msg:
		default:
		}
	}
}

type matchState struct {
	CurrentRound         int    `json:"currentRound"`
	TotalRounds          int    `json:"totalRounds"`
	RoundTimeLeft        int64  `json:"roundTimeLeftMs"`
	BuyTimeLeft          int64  `json:"buyTimeLeftMs"`
	BuyPhase             bool   `json:"buyPhase"`
	Intermission         bool   `json:"intermission"`
	IntermissionTimeLeft int64  `json:"intermissionTimeLeftMs"`
	RoundWinner          TeamID `json:"roundWinner"`
	BlueScore            int    `json:"blueScore"`
	GreenScore           int    `json:"greenScore"`
	BlueAlive            int    `json:"blueAlive"`
	GreenAlive           int    `json:"greenAlive"`
}

type playerState struct {
	Pos               Vec3     `json:"pos"`
	Yaw               float64  `json:"yaw"`
	Pitch             float64  `json:"pitch"`
	Crouching         bool     `json:"crouching"`
	Hp                int      `json:"hp"`
	Armor             int      `json:"armor"`
	Credits           int      `json:"credits"`
	Name              string   `json:"name"`
	Team              TeamID   `json:"team"`
	Kills             int      `json:"kills"`
	Deaths            int      `json:"deaths"`
	Alive             bool     `json:"alive"`
	HasPistol         bool     `json:"hasPistol"`
	HasMachineGun     bool     `json:"hasMachineGun"`
	PistolClip        int      `json:"pistolClip"`
	PistolReserve     int      `json:"pistolReserve"`
	MachineGunClip    int      `json:"machineGunClip"`
	MachineGunReserve int      `json:"machineGunReserve"`
	Bombs             int      `json:"bombs"`
	Smokes            int      `json:"smokes"`
	Flashbangs        int      `json:"flashbangs"`
	FlashTimeLeftMS   int64    `json:"flashTimeLeftMs"`
	ActiveWeapon      WeaponID `json:"activeWeapon"`
	Reloading         bool     `json:"reloading"`
	ReloadTimeLeftMS  int64    `json:"reloadTimeLeftMs"`
}

type playerStateMessage struct {
	T           string               `json:"t"`
	Players     map[int]playerState  `json:"players"`
	Projectiles []projectileSnapshot `json:"projectiles,omitempty"`
	Effects     []areaEffectSnapshot `json:"effects,omitempty"`
	Match       matchState           `json:"match"`
}

type economyUpdate struct {
	T                 string   `json:"t"`
	PlayerID          int      `json:"id"`
	OK                bool     `json:"ok"`
	Kind              string   `json:"kind"`
	Item              string   `json:"item,omitempty"`
	Label             string   `json:"label,omitempty"`
	Reason            string   `json:"reason,omitempty"`
	Amount            int      `json:"amount,omitempty"`
	Crouching         bool     `json:"crouching"`
	Hp                int      `json:"hp"`
	Armor             int      `json:"armor"`
	Credits           int      `json:"credits"`
	Team              TeamID   `json:"team"`
	HasPistol         bool     `json:"hasPistol"`
	HasMachineGun     bool     `json:"hasMachineGun"`
	PistolClip        int      `json:"pistolClip"`
	PistolReserve     int      `json:"pistolReserve"`
	MachineGunClip    int      `json:"machineGunClip"`
	MachineGunReserve int      `json:"machineGunReserve"`
	Bombs             int      `json:"bombs"`
	Smokes            int      `json:"smokes"`
	Flashbangs        int      `json:"flashbangs"`
	FlashTimeLeftMS   int64    `json:"flashTimeLeftMs"`
	ActiveWeapon      WeaponID `json:"activeWeapon"`
	Reloading         bool     `json:"reloading"`
	ReloadTimeLeftMS  int64    `json:"reloadTimeLeftMs"`
}

type weaponConfig struct {
	ID             WeaponID
	Label          string
	Range          float64
	FireIntervalMS int64
	BodyDamage     int
	HeadDamage     int
	UsesAmmo       bool
	HipSpread      float64
	AimSpread      float64
	BloomPerShot   float64
	MaxBloom       float64
	BloomDecayMS   float64
}

func (g *Game) buildMatchStateLocked(nowMS int64) matchState {
	buyTimeLeft := int64(0)
	roundTimeLeft := int64(0)
	intermissionTimeLeft := int64(0)
	intermission := g.state == StatePlaying && g.intermissionEndsAt > nowMS
	if intermission {
		intermissionTimeLeft = g.intermissionEndsAt - nowMS
	} else if g.state == StatePlaying && g.buyEndsAt > nowMS {
		buyTimeLeft = g.buyEndsAt - nowMS
	}

	if !intermission && g.state == StatePlaying && g.roundEndsAt > nowMS {
		roundTimeLeft = g.roundEndsAt - nowMS
	}

	blueAlive, greenAlive := g.aliveCountsLocked()

	return matchState{
		CurrentRound:         g.currentRound,
		TotalRounds:          totalRounds,
		RoundTimeLeft:        roundTimeLeft,
		BuyTimeLeft:          buyTimeLeft,
		BuyPhase:             g.state == StatePlaying && !intermission && nowMS < g.buyEndsAt,
		Intermission:         intermission,
		IntermissionTimeLeft: intermissionTimeLeft,
		RoundWinner:          g.roundWinner,
		BlueScore:            g.blueScore,
		GreenScore:           g.greenScore,
		BlueAlive:            blueAlive,
		GreenAlive:           greenAlive,
	}
}

func (g *Game) reloadTimeLeftLocked(idx int, nowMS int64) int64 {
	if idx < 0 || idx >= len(g.players.reloadEndsAt) {
		return 0
	}
	if g.players.reloadEndsAt[idx] <= nowMS {
		return 0
	}
	return g.players.reloadEndsAt[idx] - nowMS
}

func (g *Game) isReloadingLocked(idx int, nowMS int64) bool {
	return g.reloadTimeLeftLocked(idx, nowMS) > 0
}

func (g *Game) flashTimeLeftLocked(idx int, nowMS int64) int64 {
	if idx < 0 || idx >= len(g.players.flashEndsAt) {
		return 0
	}
	if g.players.flashEndsAt[idx] <= nowMS {
		return 0
	}
	return g.players.flashEndsAt[idx] - nowMS
}

func (g *Game) clearReloadLocked(idx int) {
	g.players.reloadEndsAt[idx] = 0
	g.players.reloadWeapon[idx] = WeaponKnife
}

func (g *Game) buildPlayerStateLocked(idx int, nowMS int64) playerState {
	return playerState{
		Pos:               g.players.pos[idx],
		Yaw:               g.players.yaw[idx],
		Pitch:             g.players.pitch[idx],
		Crouching:         g.players.crouching[idx],
		Hp:                g.players.hp[idx],
		Armor:             g.players.armor[idx],
		Credits:           g.players.credits[idx],
		Name:              g.players.names[idx],
		Team:              g.players.team[idx],
		Kills:             g.players.kills[idx],
		Deaths:            g.players.deaths[idx],
		Alive:             g.players.alive[idx],
		HasPistol:         g.players.hasPistol[idx],
		HasMachineGun:     g.players.hasMG[idx],
		PistolClip:        g.players.pistolClip[idx],
		PistolReserve:     g.players.pistolReserve[idx],
		MachineGunClip:    g.players.mgClip[idx],
		MachineGunReserve: g.players.mgReserve[idx],
		Bombs:             g.players.bombs[idx],
		Smokes:            g.players.smokes[idx],
		Flashbangs:        g.players.flashbangs[idx],
		FlashTimeLeftMS:   g.flashTimeLeftLocked(idx, nowMS),
		ActiveWeapon:      g.players.activeWeapon[idx],
		Reloading:         g.isReloadingLocked(idx, nowMS),
		ReloadTimeLeftMS:  g.reloadTimeLeftLocked(idx, nowMS),
	}
}

func (g *Game) buildPlayerStateMessageLocked(messageType string, nowMS int64) playerStateMessage {
	state := make(map[int]playerState, len(g.players.ids))
	for i, id := range g.players.ids {
		state[id] = g.buildPlayerStateLocked(i, nowMS)
	}

	projectiles := make([]projectileSnapshot, 0, len(g.projectiles))
	for _, projectile := range g.projectiles {
		projectiles = append(projectiles, projectileSnapshot{
			ID:   projectile.ID,
			Type: projectile.Type,
			Pos:  projectile.Pos,
		})
	}

	effects := make([]areaEffectSnapshot, 0, len(g.effects))
	for _, effect := range g.effects {
		timeLeft := effect.ExpiresAt - nowMS
		if timeLeft <= 0 {
			continue
		}
		effects = append(effects, areaEffectSnapshot{
			Type:       effect.Type,
			Pos:        effect.Pos,
			Radius:     effect.Radius,
			TimeLeftMS: timeLeft,
		})
	}

	return playerStateMessage{
		T:           messageType,
		Players:     state,
		Projectiles: projectiles,
		Effects:     effects,
		Match:       g.buildMatchStateLocked(nowMS),
	}
}

func (g *Game) stateTick(nowMS int64) {
	g.mu.RLock()
	if len(g.players.ids) == 0 {
		g.mu.RUnlock()
		return
	}
	msg, _ := json.Marshal(g.buildPlayerStateMessageLocked("state", nowMS))
	g.mu.RUnlock()

	g.broadcast(msg, 0)
}

func (g *Game) isPlaying() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.state == StatePlaying
}

func (g *Game) isIntermissionLocked(nowMS int64) bool {
	return g.state == StatePlaying && g.intermissionEndsAt > nowMS
}

func (g *Game) stateName() string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return gameStateName(g.state)
}

func (g *Game) applyInputLocked(idx int, pos Vec3, yaw, pitch float64, crouching bool, nowMS int64) {
	prevPos := g.players.pos[idx]
	prevCrouching := g.players.crouching[idx]
	g.players.yaw[idx] = yaw
	g.players.pitch[idx] = pitch
	if g.isIntermissionLocked(nowMS) {
		return
	}
	g.players.crouching[idx] = crouching
	if !g.players.alive[idx] {
		return
	}

	nextPos := g.players.pos[idx]
	nextPos[1] = pos[1]
	if nowMS >= g.buyEndsAt {
		nextPos[0] = pos[0]
		nextPos[2] = pos[2]
	}

	g.players.pos[idx] = nextPos
	if nextPos == prevPos && crouching == prevCrouching {
		return
	}
	recordPositionSample(&g.players.history[idx], nowMS, nextPos, crouching)
}

func queueJSON(sendCh chan []byte, payload any) {
	if sendCh == nil {
		return
	}

	msg, err := json.Marshal(payload)
	if err != nil {
		return
	}

	select {
	case sendCh <- msg:
	default:
	}
}

func (g *Game) sendToPlayer(id int, payload any) {
	msg, err := json.Marshal(payload)
	if err != nil {
		return
	}
	g.sendRawToPlayer(id, msg)
}

func (g *Game) sendRawToPlayer(id int, msg []byte) {
	g.mu.RLock()
	idx, ok := g.players.indexOf(id)
	if !ok {
		g.mu.RUnlock()
		return
	}
	sendCh := g.players.sendChs[idx]
	g.mu.RUnlock()

	select {
	case sendCh <- msg:
	default:
	}
}

func newTickMessages() *tickMessages {
	return &tickMessages{
		directs: make(map[int][][]byte),
	}
}

func (tm *tickMessages) addBroadcast(payload any) {
	if tm == nil {
		return
	}
	msg, err := json.Marshal(payload)
	if err != nil {
		return
	}
	tm.broadcasts = append(tm.broadcasts, msg)
}

func (tm *tickMessages) addDirect(id int, payload any) {
	if tm == nil {
		return
	}
	msg, err := json.Marshal(payload)
	if err != nil {
		return
	}
	tm.directs[id] = append(tm.directs[id], msg)
}

func rewardForHitZone(zone HitZone) int {
	if zone == HitZoneHead {
		return headHitReward
	}
	return bodyHitReward
}

func applyDamage(hp, armor, damage int) (nextHP, nextArmor, absorbed int) {
	absorbed = minInt(armor, damage)
	remainingDamage := damage - absorbed
	nextArmor = armor - absorbed
	nextHP = hp - remainingDamage
	if nextHP < 0 {
		nextHP = 0
	}
	return nextHP, nextArmor, absorbed
}

func normalizeTeam(team TeamID) TeamID {
	switch team {
	case TeamBlue, TeamGreen:
		return team
	default:
		return TeamNone
	}
}

func otherTeam(team TeamID) TeamID {
	if team == TeamBlue {
		return TeamGreen
	}
	if team == TeamGreen {
		return TeamBlue
	}
	return TeamNone
}

func (g *Game) teamCountsLocked() (blue, green int) {
	for _, team := range g.players.team {
		switch normalizeTeam(team) {
		case TeamBlue:
			blue++
		case TeamGreen:
			green++
		}
	}
	return blue, green
}

func (g *Game) aliveCountsLocked() (blue, green int) {
	for i, team := range g.players.team {
		if !g.players.alive[i] {
			continue
		}
		switch normalizeTeam(team) {
		case TeamBlue:
			blue++
		case TeamGreen:
			green++
		}
	}
	return blue, green
}

func (g *Game) preferredTeamLocked() TeamID {
	blue, green := g.teamCountsLocked()
	if blue > green {
		return TeamGreen
	}
	return TeamBlue
}

func (g *Game) canAssignTeamLocked(idx int, desired TeamID) bool {
	desired = normalizeTeam(desired)
	if desired == TeamNone || idx < 0 || idx >= len(g.players.ids) {
		return false
	}

	blue, green := g.teamCountsLocked()
	current := normalizeTeam(g.players.team[idx])
	if current == desired {
		return true
	}
	if current == TeamBlue {
		blue--
	}
	if current == TeamGreen {
		green--
	}
	if desired == TeamBlue {
		blue++
	} else {
		green++
	}
	return absInt(blue-green) <= 1
}

func (g *Game) canStartMatchLocked() (bool, string) {
	if len(g.players.ids) < 2 {
		return false, "Need at least 2 players"
	}
	blue, green := g.teamCountsLocked()
	for _, team := range g.players.team {
		if normalizeTeam(team) == TeamNone {
			return false, "All players must join a team"
		}
	}
	if blue == 0 || green == 0 {
		return false, "Both teams need players"
	}
	if blue != green {
		return false, "Teams must be even"
	}
	return true, ""
}

func spawnPointsForTeam(team TeamID) []Vec3 {
	if normalizeTeam(team) == TeamGreen {
		return []Vec3{
			{25, standEyeHeight, -25},
			{25, standEyeHeight, 25},
			{0, standEyeHeight, 12},
		}
	}
	return []Vec3{
		{-25, standEyeHeight, -25},
		{-25, standEyeHeight, 25},
		{0, standEyeHeight, -12},
	}
}

func weaponConfigByID(id WeaponID) weaponConfig {
	switch id {
	case WeaponPistol:
		return weaponConfig{
			ID:             WeaponPistol,
			Label:          "Pistol",
			Range:          hitscanRange,
			FireIntervalMS: 340,
			BodyDamage:     34,
			HeadDamage:     68,
			UsesAmmo:       true,
			HipSpread:      0.018,
			AimSpread:      0.0032,
			BloomPerShot:   0.008,
			MaxBloom:       0.02,
			BloomDecayMS:   0.00001,
		}
	case WeaponMachineGun:
		return weaponConfig{
			ID:             WeaponMachineGun,
			Label:          "Machine Gun",
			Range:          hitscanRange,
			FireIntervalMS: 100,
			BodyDamage:     18,
			HeadDamage:     32,
			UsesAmmo:       true,
			HipSpread:      0.032,
			AimSpread:      0.0065,
			BloomPerShot:   0.005,
			MaxBloom:       0.028,
			BloomDecayMS:   0.000012,
		}
	default:
		return weaponConfig{
			ID:             WeaponKnife,
			Label:          "Knife",
			Range:          knifeRange,
			FireIntervalMS: 450,
			BodyDamage:     55,
			HeadDamage:     90,
			UsesAmmo:       false,
			HipSpread:      0,
			AimSpread:      0,
			BloomPerShot:   0,
			MaxBloom:       0,
			BloomDecayMS:   0,
		}
	}
}

func damageForWeapon(id WeaponID, zone HitZone) int {
	config := weaponConfigByID(id)
	return damageForConfig(config, zone)
}

func damageForConfig(config weaponConfig, zone HitZone) int {
	if zone == HitZoneHead {
		return config.HeadDamage
	}
	return config.BodyDamage
}

func effectiveWeaponConfig(id WeaponID, alternate bool) weaponConfig {
	config := weaponConfigByID(id)
	if id == WeaponKnife && alternate {
		config.FireIntervalMS *= 2
		config.BodyDamage *= 2
		config.HeadDamage *= 2
	}
	return config
}

func (g *Game) currentShotBloomLocked(idx int, weapon WeaponID, nowMS int64) float64 {
	config := weaponConfigByID(weapon)
	if config.MaxBloom <= 0 {
		g.players.shotBloom[idx] = 0
		g.players.bloomWeapon[idx] = weapon
		g.players.lastShotAt[idx] = nowMS
		return 0
	}

	bloom := g.players.shotBloom[idx]
	if g.players.bloomWeapon[idx] != weapon {
		bloom = 0
	}
	if last := g.players.lastShotAt[idx]; last > 0 && nowMS > last {
		bloom = math.Max(0, bloom-float64(nowMS-last)*config.BloomDecayMS)
	}
	return math.Min(config.MaxBloom, bloom)
}

func (g *Game) registerShotBloomLocked(idx int, weapon WeaponID, nowMS int64) float64 {
	config := weaponConfigByID(weapon)
	bloom := g.currentShotBloomLocked(idx, weapon, nowMS)
	g.players.bloomWeapon[idx] = weapon
	g.players.lastShotAt[idx] = nowMS
	if config.MaxBloom <= 0 {
		g.players.shotBloom[idx] = 0
		return 0
	}
	g.players.shotBloom[idx] = math.Min(config.MaxBloom, bloom+config.BloomPerShot)
	return bloom
}

func applyShotSpread(dir Vec3, config weaponConfig, aiming, crouching, moving bool, bloom float64, seed int64) Vec3 {
	spread := config.HipSpread
	if aiming && config.AimSpread > 0 {
		spread = config.AimSpread
	}
	if crouching {
		spread *= 0.72
		bloom *= 0.8
	}
	if moving {
		spread *= 1.42
		bloom *= 1.28
	}
	spread += bloom
	if spread <= 0 {
		return normalizeVec(dir)
	}

	forward := normalizeVec(dir)
	upHint := Vec3{0, 1, 0}
	if math.Abs(dotVec3(forward, upHint)) > 0.98 {
		upHint = Vec3{1, 0, 0}
	}
	right := normalizeVec(crossVec3(upHint, forward))
	up := normalizeVec(crossVec3(forward, right))

	yawOffset := deterministicSpreadOffset(seed+17) * spread
	pitchOffset := deterministicSpreadOffset(seed+53) * spread
	spreadDir := Vec3{
		forward[0] + right[0]*yawOffset + up[0]*pitchOffset,
		forward[1] + right[1]*yawOffset + up[1]*pitchOffset,
		forward[2] + right[2]*yawOffset + up[2]*pitchOffset,
	}
	return normalizeVec(spreadDir)
}

func isMovingAtTime(samples []positionSample, at int64) bool {
	if len(samples) == 0 {
		return false
	}

	current := sampleAtTime(samples, at).Pos
	previous := sampleAtTime(samples, at-120).Pos
	dx := current[0] - previous[0]
	dz := current[2] - previous[2]
	return dx*dx+dz*dz > 0.18*0.18
}

func deterministicSpreadOffset(seed int64) float64 {
	rng := rand.New(rand.NewSource(seed))
	return rng.Float64()*2 - 1
}

func normalizeWeaponChoice(hasPistol, hasMG bool, bombs, smokes, flashbangs int, requested WeaponID) WeaponID {
	switch requested {
	case WeaponMachineGun:
		if hasMG {
			return requested
		}
	case WeaponPistol:
		if hasPistol {
			return requested
		}
	case WeaponBomb:
		if bombs > 0 {
			return requested
		}
	case WeaponSmoke:
		if smokes > 0 {
			return requested
		}
	case WeaponFlashbang:
		if flashbangs > 0 {
			return requested
		}
	}
	return WeaponKnife
}

func (g *Game) normalizeActiveWeaponLocked(idx int, requested WeaponID) WeaponID {
	return normalizeWeaponChoice(
		g.players.hasPistol[idx],
		g.players.hasMG[idx],
		g.players.bombs[idx],
		g.players.smokes[idx],
		g.players.flashbangs[idx],
		requested,
	)
}

func isCombatWeapon(id WeaponID) bool {
	switch id {
	case WeaponKnife, WeaponPistol, WeaponMachineGun:
		return true
	default:
		return false
	}
}

func isUtilityWeaponID(id WeaponID) bool {
	switch id {
	case WeaponBomb, WeaponSmoke, WeaponFlashbang:
		return true
	default:
		return false
	}
}

func weaponClipSize(id WeaponID) int {
	switch id {
	case WeaponMachineGun:
		return machineGunMagSize
	case WeaponPistol:
		return pistolMagSize
	default:
		return 0
	}
}

func weaponReserveAmmoMax(id WeaponID) int {
	switch id {
	case WeaponMachineGun:
		return machineGunAmmoMax
	case WeaponPistol:
		return pistolAmmoMax
	default:
		return 0
	}
}

func (g *Game) currentAmmoLocked(idx int, weapon WeaponID) int {
	switch weapon {
	case WeaponMachineGun:
		return g.players.mgClip[idx]
	case WeaponPistol:
		return g.players.pistolClip[idx]
	default:
		return 0
	}
}

func (g *Game) currentReserveLocked(idx int, weapon WeaponID) int {
	switch weapon {
	case WeaponMachineGun:
		return g.players.mgReserve[idx]
	case WeaponPistol:
		return g.players.pistolReserve[idx]
	default:
		return 0
	}
}

func (g *Game) totalAmmoLocked(idx int, weapon WeaponID) int {
	return g.currentAmmoLocked(idx, weapon) + g.currentReserveLocked(idx, weapon)
}

func (g *Game) currentUtilityCountLocked(idx int, weapon WeaponID) int {
	switch weapon {
	case WeaponBomb:
		return g.players.bombs[idx]
	case WeaponSmoke:
		return g.players.smokes[idx]
	case WeaponFlashbang:
		return g.players.flashbangs[idx]
	default:
		return 0
	}
}

func (g *Game) setWeaponAmmoLocked(idx int, weapon WeaponID, clip, reserve int) {
	switch weapon {
	case WeaponMachineGun:
		g.players.mgClip[idx] = clip
		g.players.mgReserve[idx] = reserve
	case WeaponPistol:
		g.players.pistolClip[idx] = clip
		g.players.pistolReserve[idx] = reserve
	}
}

func (g *Game) giveWeaponFullAmmoLocked(idx int, weapon WeaponID) {
	clipSize := weaponClipSize(weapon)
	reserveMax := weaponReserveAmmoMax(weapon)
	if clipSize <= 0 || reserveMax <= 0 {
		return
	}
	g.setWeaponAmmoLocked(idx, weapon, clipSize, reserveMax)
}

func (g *Game) addAmmoLocked(idx int, weapon WeaponID, amount int) bool {
	reserveMax := weaponReserveAmmoMax(weapon)
	if reserveMax <= 0 || amount <= 0 {
		return false
	}

	reserve := g.currentReserveLocked(idx, weapon)
	if reserve >= reserveMax {
		return false
	}

	g.setWeaponAmmoLocked(idx, weapon, g.currentAmmoLocked(idx, weapon), minInt(reserveMax, reserve+amount))
	return true
}

func (g *Game) stripLoadoutOnDeathLocked(idx int) {
	g.players.hasPistol[idx] = true
	g.players.hasMG[idx] = false
	g.players.pistolClip[idx] = pistolMagSize
	g.players.pistolReserve[idx] = 0
	g.players.mgClip[idx] = 0
	g.players.mgReserve[idx] = 0
	g.players.bombs[idx] = 0
	g.players.smokes[idx] = 0
	g.players.flashbangs[idx] = 0
	g.players.activeWeapon[idx] = WeaponPistol
	g.players.nextAttackAt[idx] = 0
	g.players.shotBloom[idx] = 0
	g.players.bloomWeapon[idx] = WeaponPistol
	g.players.lastShotAt[idx] = 0
	g.clearReloadLocked(idx)
}

func (g *Game) grantRoundIncomeLocked(amount int) {
	if amount <= 0 {
		return
	}
	for i := range g.players.ids {
		g.players.credits[i] += amount
	}
}

func (g *Game) reloadWeaponForRoundLocked(idx int, weapon WeaponID) {
	clipSize := weaponClipSize(weapon)
	if clipSize <= 0 {
		return
	}

	totalAmmo := g.totalAmmoLocked(idx, weapon)
	if totalAmmo <= 0 {
		g.setWeaponAmmoLocked(idx, weapon, 0, 0)
		return
	}

	clip := minInt(clipSize, totalAmmo)
	g.setWeaponAmmoLocked(idx, weapon, clip, totalAmmo-clip)
}

func (g *Game) reloadLoadoutForRoundLocked(idx int) {
	if g.players.hasPistol[idx] {
		g.reloadWeaponForRoundLocked(idx, WeaponPistol)
	}
	if g.players.hasMG[idx] {
		g.reloadWeaponForRoundLocked(idx, WeaponMachineGun)
	}
}

func (g *Game) spendAmmoLocked(idx int, weapon WeaponID, amount int) bool {
	switch weapon {
	case WeaponMachineGun:
		if g.players.mgClip[idx] < amount {
			return false
		}
		g.players.mgClip[idx] -= amount
		return true
	case WeaponPistol:
		if g.players.pistolClip[idx] < amount {
			return false
		}
		g.players.pistolClip[idx] -= amount
		return true
	default:
		return true
	}
}

func (g *Game) reloadWeaponLocked(idx int, weapon WeaponID) bool {
	clipSize := weaponClipSize(weapon)
	if clipSize <= 0 {
		return false
	}

	clip := g.currentAmmoLocked(idx, weapon)
	reserve := g.currentReserveLocked(idx, weapon)
	if reserve <= 0 || clip >= clipSize {
		return false
	}

	transferred := minInt(clipSize-clip, reserve)
	g.setWeaponAmmoLocked(idx, weapon, clip+transferred, reserve-transferred)
	return transferred > 0
}

func (g *Game) startReloadLocked(idx int, weapon WeaponID, nowMS int64) bool {
	if g.isReloadingLocked(idx, nowMS) {
		return false
	}
	clipSize := weaponClipSize(weapon)
	if clipSize <= 0 {
		return false
	}
	clip := g.currentAmmoLocked(idx, weapon)
	reserve := g.currentReserveLocked(idx, weapon)
	if reserve <= 0 || clip >= clipSize {
		return false
	}
	g.players.reloadWeapon[idx] = weapon
	g.players.reloadEndsAt[idx] = nowMS + reloadDurationMS
	return true
}

func (g *Game) spendUtilityLocked(idx int, weapon WeaponID) bool {
	switch weapon {
	case WeaponBomb:
		if g.players.bombs[idx] <= 0 {
			return false
		}
		g.players.bombs[idx]--
	case WeaponSmoke:
		if g.players.smokes[idx] <= 0 {
			return false
		}
		g.players.smokes[idx]--
	case WeaponFlashbang:
		if g.players.flashbangs[idx] <= 0 {
			return false
		}
		g.players.flashbangs[idx]--
	default:
		return false
	}
	return true
}

func (g *Game) spawnProjectileLocked(ownerID int, weapon WeaponID, origin, dir Vec3, nowMS int64) {
	launchDir := normalizeVec(Vec3{dir[0], dir[1] + 0.18, dir[2]})
	g.nextProjID++
	g.projectiles = append(g.projectiles, projectileState{
		ID:         g.nextProjID,
		Type:       weapon,
		OwnerID:    ownerID,
		Pos:        Vec3{origin[0] + launchDir[0]*0.8, origin[1] - 0.18 + launchDir[1]*0.8, origin[2] + launchDir[2]*0.8},
		Vel:        Vec3{launchDir[0] * projectileSpeed, launchDir[1] * projectileSpeed, launchDir[2] * projectileSpeed},
		DetonateAt: nowMS + projectileFuseMS,
	})
}

func (g *Game) addEffectLocked(effectType string, pos Vec3, radius float64, expiresAt int64) {
	g.effects = append(g.effects, areaEffectState{
		Type:      effectType,
		Pos:       pos,
		Radius:    radius,
		ExpiresAt: expiresAt,
	})
}

func (g *Game) cleanupExpiredEffectsLocked(nowMS int64) {
	if len(g.effects) == 0 {
		return
	}
	next := g.effects[:0]
	for _, effect := range g.effects {
		if effect.ExpiresAt > nowMS {
			next = append(next, effect)
		}
	}
	g.effects = next
}

func (g *Game) handleBombDetonationLocked(projectile projectileState, nowMS int64, tm *tickMessages) {
	ownerIdx, ownerOK := g.players.indexOf(projectile.OwnerID)
	ownerTeam := TeamNone
	if ownerOK {
		ownerTeam = normalizeTeam(g.players.team[ownerIdx])
	}
	g.addEffectLocked("bomb", projectile.Pos, bombRadius, nowMS+bombEffectDurationMS)

	for idx, playerID := range g.players.ids {
		if !g.players.alive[idx] {
			continue
		}
		if ownerTeam != TeamNone && normalizeTeam(g.players.team[idx]) == ownerTeam {
			continue
		}

		dist := distanceVec3(g.players.pos[idx], projectile.Pos)
		if dist > bombRadius {
			continue
		}

		nextHP, nextArmor, absorbed := applyDamage(g.players.hp[idx], g.players.armor[idx], bombDamage)
		g.players.hp[idx] = nextHP
		g.players.armor[idx] = nextArmor

		tm.addBroadcast(map[string]interface{}{
			"t":        "hit",
			"from":     projectile.OwnerID,
			"to":       playerID,
			"dmg":      bombDamage,
			"zone":     HitZoneBody,
			"weapon":   WeaponBomb,
			"hp":       nextHP,
			"armor":    nextArmor,
			"absorbed": absorbed,
		})

		if ownerOK && projectile.OwnerID != playerID {
			rewardAmount := rewardForHitZone(HitZoneBody)
			rewardLabel := "Explosion reward"
			if nextHP <= 0 {
				rewardAmount += killReward
				rewardLabel = "Explosion elimination reward"
			}
			g.players.credits[ownerIdx] += rewardAmount
			tm.addDirect(projectile.OwnerID, g.applyEconomyUpdateLocked(ownerIdx, true, "reward", string(WeaponBomb), rewardLabel, "", rewardAmount, nowMS))
		}

		if nextHP > 0 {
			continue
		}

		g.players.alive[idx] = false
		g.players.deaths[idx]++
		g.stripLoadoutOnDeathLocked(idx)
		if ownerOK && projectile.OwnerID != playerID {
			g.players.kills[ownerIdx]++
		}

		tm.addBroadcast(map[string]interface{}{
			"t":      "kill",
			"killer": projectile.OwnerID,
			"victim": playerID,
		})
	}
}

func (g *Game) handleFlashbangDetonationLocked(projectile projectileState, nowMS int64) {
	for idx := range g.players.ids {
		if !g.players.alive[idx] || !g.canSeeFlashbangLocked(idx, projectile.Pos) {
			continue
		}
		g.players.flashEndsAt[idx] = maxInt64(g.players.flashEndsAt[idx], nowMS+flashbangDurationMS)
	}
}

func (g *Game) canSeeFlashbangLocked(idx int, origin Vec3) bool {
	eye := g.players.pos[idx]
	toFlash := Vec3{
		origin[0] - eye[0],
		origin[1] - eye[1],
		origin[2] - eye[2],
	}
	if distanceVec3(origin, eye) > flashbangRadius {
		return false
	}
	forward := lookDirFromYawPitch(g.players.yaw[idx], g.players.pitch[idx])
	return dotVec3(forward, normalizeVec(toFlash)) >= flashbangVisibleDot
}

func (g *Game) updateReloadsAndProjectilesLocked(nowMS int64) *tickMessages {
	tm := newTickMessages()
	g.cleanupExpiredEffectsLocked(nowMS)

	for idx := range g.players.ids {
		if g.players.reloadEndsAt[idx] == 0 || nowMS < g.players.reloadEndsAt[idx] {
			continue
		}
		weapon := g.players.reloadWeapon[idx]
		g.clearReloadLocked(idx)
		g.reloadWeaponLocked(idx, weapon)
	}

	if len(g.projectiles) == 0 {
		return tm
	}

	dt := 1.0 / float64(tickRate)
	nextProjectiles := g.projectiles[:0]
	for _, projectile := range g.projectiles {
		projectile.Vel[1] += projectileGravity * dt
		projectile.Pos[0] += projectile.Vel[0] * dt
		projectile.Pos[1] += projectile.Vel[1] * dt
		projectile.Pos[2] += projectile.Vel[2] * dt

		if projectile.Pos[1] <= projectileFloorY {
			projectile.Pos[1] = projectileFloorY
			projectile.Vel[1] = -projectile.Vel[1] * projectileBounce
			projectile.Vel[0] *= projectileGroundDrag
			projectile.Vel[2] *= projectileGroundDrag
			if math.Abs(projectile.Vel[1]) < 1 {
				projectile.Vel[1] = 0
			}
		}
		if projectile.Pos[1] >= projectileCeilingY {
			projectile.Pos[1] = projectileCeilingY
			projectile.Vel[1] = -math.Abs(projectile.Vel[1]) * projectileBounce
		}
		if projectile.Pos[0] <= -projectileBounds {
			projectile.Pos[0] = -projectileBounds
			projectile.Vel[0] = math.Abs(projectile.Vel[0]) * projectileBounce
		} else if projectile.Pos[0] >= projectileBounds {
			projectile.Pos[0] = projectileBounds
			projectile.Vel[0] = -math.Abs(projectile.Vel[0]) * projectileBounce
		}
		if projectile.Pos[2] <= -projectileBounds {
			projectile.Pos[2] = -projectileBounds
			projectile.Vel[2] = math.Abs(projectile.Vel[2]) * projectileBounce
		} else if projectile.Pos[2] >= projectileBounds {
			projectile.Pos[2] = projectileBounds
			projectile.Vel[2] = -math.Abs(projectile.Vel[2]) * projectileBounce
		}

		if nowMS >= projectile.DetonateAt {
			switch projectile.Type {
			case WeaponBomb:
				g.handleBombDetonationLocked(projectile, nowMS, tm)
			case WeaponSmoke:
				g.addEffectLocked("smoke", projectile.Pos, smokeRadius, nowMS+smokeDurationMS)
			case WeaponFlashbang:
				g.handleFlashbangDetonationLocked(projectile, nowMS)
			}
			continue
		}
		nextProjectiles = append(nextProjectiles, projectile)
	}
	g.projectiles = nextProjectiles
	return tm
}

func (g *Game) applyEconomyUpdateLocked(idx int, ok bool, kind, item, label, reason string, amount int, nowMS int64) economyUpdate {
	return economyUpdate{
		T:                 "economy",
		PlayerID:          g.players.ids[idx],
		OK:                ok,
		Kind:              kind,
		Item:              item,
		Label:             label,
		Reason:            reason,
		Amount:            amount,
		Crouching:         g.players.crouching[idx],
		Hp:                g.players.hp[idx],
		Armor:             g.players.armor[idx],
		Credits:           g.players.credits[idx],
		Team:              g.players.team[idx],
		HasPistol:         g.players.hasPistol[idx],
		HasMachineGun:     g.players.hasMG[idx],
		PistolClip:        g.players.pistolClip[idx],
		PistolReserve:     g.players.pistolReserve[idx],
		MachineGunClip:    g.players.mgClip[idx],
		MachineGunReserve: g.players.mgReserve[idx],
		Bombs:             g.players.bombs[idx],
		Smokes:            g.players.smokes[idx],
		Flashbangs:        g.players.flashbangs[idx],
		FlashTimeLeftMS:   g.flashTimeLeftLocked(idx, nowMS),
		ActiveWeapon:      g.players.activeWeapon[idx],
		Reloading:         g.isReloadingLocked(idx, nowMS),
		ReloadTimeLeftMS:  g.reloadTimeLeftLocked(idx, nowMS),
	}
}

func (g *Game) applyPurchaseLocked(idx int, item string, nowMS int64) economyUpdate {
	if g.state != StatePlaying {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Match has not started", 0, nowMS)
	}
	if g.isIntermissionLocked(nowMS) {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Round is over", 0, nowMS)
	}
	if nowMS >= g.buyEndsAt {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Buy time is over", 0, nowMS)
	}
	if !g.players.alive[idx] {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Only alive players can buy", 0, nowMS)
	}

	switch item {
	case "buy-machinegun":
		if g.players.hasMG[idx] {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Machine Gun", "Machine gun already owned", 0, nowMS)
		}
		if g.players.credits[idx] < machineGunCost {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Machine Gun", "Not enough credits", 0, nowMS)
		}
		g.players.credits[idx] -= machineGunCost
		g.players.hasMG[idx] = true
		g.giveWeaponFullAmmoLocked(idx, WeaponMachineGun)
		g.players.activeWeapon[idx] = WeaponMachineGun
		return g.applyEconomyUpdateLocked(idx, true, "purchase", item, "Machine Gun", "", -machineGunCost, nowMS)
	case "buy-pistol":
		if g.players.hasPistol[idx] {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Pistol", "Pistol already owned", 0, nowMS)
		}
		if g.players.credits[idx] < pistolCost {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Pistol", "Not enough credits", 0, nowMS)
		}
		g.players.credits[idx] -= pistolCost
		g.players.hasPistol[idx] = true
		g.giveWeaponFullAmmoLocked(idx, WeaponPistol)
		g.players.activeWeapon[idx] = WeaponPistol
		return g.applyEconomyUpdateLocked(idx, true, "purchase", item, "Pistol", "", -pistolCost, nowMS)
	case "machinegun-ammo":
		if !g.players.hasMG[idx] {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "MG Ammo", "Buy the machine gun first", 0, nowMS)
		}
		if g.currentReserveLocked(idx, WeaponMachineGun) >= machineGunAmmoMax {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "MG Ammo", "Machine gun ammo already full", 0, nowMS)
		}
		if g.players.credits[idx] < machineGunAmmoPackCost {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "MG Ammo", "Not enough credits", 0, nowMS)
		}
		g.players.credits[idx] -= machineGunAmmoPackCost
		g.addAmmoLocked(idx, WeaponMachineGun, machineGunAmmoPack)
		return g.applyEconomyUpdateLocked(idx, true, "purchase", item, "MG Ammo", "", -machineGunAmmoPackCost, nowMS)
	case "pistol-ammo":
		if !g.players.hasPistol[idx] {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Pistol Ammo", "Buy the pistol first", 0, nowMS)
		}
		if g.currentReserveLocked(idx, WeaponPistol) >= pistolAmmoMax {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Pistol Ammo", "Pistol ammo already full", 0, nowMS)
		}
		if g.players.credits[idx] < pistolAmmoPackCost {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Pistol Ammo", "Not enough credits", 0, nowMS)
		}
		g.players.credits[idx] -= pistolAmmoPackCost
		g.addAmmoLocked(idx, WeaponPistol, pistolAmmoPack)
		return g.applyEconomyUpdateLocked(idx, true, "purchase", item, "Pistol Ammo", "", -pistolAmmoPackCost, nowMS)
	case "bomb":
		return g.purchaseUtilityLocked(idx, item, "Bomb", bombCost, &g.players.bombs[idx], nowMS)
	case "smoke":
		return g.purchaseUtilityLocked(idx, item, "Smoke", smokeCost, &g.players.smokes[idx], nowMS)
	case "flashbang":
		return g.purchaseUtilityLocked(idx, item, "Flashbang", flashbangCost, &g.players.flashbangs[idx], nowMS)
	case "armor":
		if g.players.armor[idx] >= maxArmor {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Armor Plate", "Armor already full", 0, nowMS)
		}
		if g.players.credits[idx] < armorPlateCost {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Armor Plate", "Not enough credits", 0, nowMS)
		}
		g.players.credits[idx] -= armorPlateCost
		g.players.armor[idx] = minInt(maxArmor, g.players.armor[idx]+armorPlateAmount)
		return g.applyEconomyUpdateLocked(idx, true, "purchase", item, "Armor Plate", "", -armorPlateCost, nowMS)
	default:
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Unknown buy item", 0, nowMS)
	}
}

func (g *Game) purchaseUtilityLocked(idx int, item, label string, cost int, count *int, nowMS int64) economyUpdate {
	if *count >= grenadeMaxCount {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, label, label+" already stocked", 0, nowMS)
	}
	if g.players.credits[idx] < cost {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, label, "Not enough credits", 0, nowMS)
	}

	g.players.credits[idx] -= cost
	*count += 1
	return g.applyEconomyUpdateLocked(idx, true, "purchase", item, label, "", -cost, nowMS)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func writer(conn *websocket.Conn, sendCh <-chan []byte) {
	for msg := range sendCh {
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			break
		}
	}
	conn.Close()
}

func (g *Game) resetPlayerForNewMatchLocked(idx int, nowMS int64) {
	g.players.credits[idx] = startingCredits
	g.players.armor[idx] = 0
	g.players.hasPistol[idx] = true
	g.players.hasMG[idx] = false
	g.players.pistolClip[idx] = pistolMagSize
	g.players.pistolReserve[idx] = 0
	g.players.mgClip[idx] = 0
	g.players.mgReserve[idx] = 0
	g.players.bombs[idx] = 0
	g.players.smokes[idx] = 0
	g.players.flashbangs[idx] = 0
	g.players.flashEndsAt[idx] = 0
	g.players.kills[idx] = 0
	g.players.deaths[idx] = 0
	g.players.shotBloom[idx] = 0
	g.players.bloomWeapon[idx] = WeaponKnife
	g.players.lastShotAt[idx] = 0
	g.clearReloadLocked(idx)
	g.respawnPlayerLocked(idx, nowMS)
	g.players.activeWeapon[idx] = WeaponPistol
}

func (g *Game) scheduleRespawn(victimID int, roundNumber int) {
	go func() {
		time.Sleep(respawnDelayMS * time.Millisecond)
		nowMS := time.Now().UnixMilli()
		shouldBroadcast := false
		respawnCredits := 0
		respawnArmor := 0
		respawnHP := 0
		respawnPos := Vec3{}
		hasPistol := false
		hasMachineGun := false
		team := TeamNone
		pistolClip := 0
		pistolReserve := 0
		machineGunClip := 0
		machineGunReserve := 0
		bombs := 0
		smokes := 0
		flashbangs := 0
		activeWeapon := WeaponKnife

		g.mu.Lock()
		idx, ok := g.players.indexOf(victimID)
		if ok && g.state == StatePlaying && g.currentRound == roundNumber && !g.players.alive[idx] {
			g.respawnPlayerLocked(idx, nowMS)
			shouldBroadcast = true
			respawnPos = g.players.pos[idx]
			respawnCredits = g.players.credits[idx]
			respawnArmor = g.players.armor[idx]
			respawnHP = g.players.hp[idx]
			hasPistol = g.players.hasPistol[idx]
			hasMachineGun = g.players.hasMG[idx]
			team = g.players.team[idx]
			pistolClip = g.players.pistolClip[idx]
			pistolReserve = g.players.pistolReserve[idx]
			machineGunClip = g.players.mgClip[idx]
			machineGunReserve = g.players.mgReserve[idx]
			bombs = g.players.bombs[idx]
			smokes = g.players.smokes[idx]
			flashbangs = g.players.flashbangs[idx]
			activeWeapon = g.players.activeWeapon[idx]
		}
		g.mu.Unlock()

		if !ok || !shouldBroadcast {
			return
		}

		respawnMsg, _ := json.Marshal(map[string]interface{}{
			"t":                 "respawn",
			"id":                victimID,
			"pos":               respawnPos,
			"hp":                respawnHP,
			"armor":             respawnArmor,
			"credits":           respawnCredits,
			"team":              team,
			"hasPistol":         hasPistol,
			"hasMachineGun":     hasMachineGun,
			"pistolClip":        pistolClip,
			"pistolReserve":     pistolReserve,
			"machineGunClip":    machineGunClip,
			"machineGunReserve": machineGunReserve,
			"bombs":             bombs,
			"smokes":            smokes,
			"flashbangs":        flashbangs,
			"flashTimeLeftMs":   int64(0),
			"activeWeapon":      activeWeapon,
			"reloading":         false,
			"reloadTimeLeftMs":  int64(0),
			"crouching":         false,
			"alive":             true,
		})
		g.broadcast(respawnMsg, 0)
	}()
}

func (g *Game) respawnPlayerLocked(idx int, nowMS int64) {
	teamSpawns := spawnPointsForTeam(g.players.team[idx])
	spawn := teamSpawns[rand.Intn(len(teamSpawns))]
	g.reloadLoadoutForRoundLocked(idx)
	g.players.pos[idx] = spawn
	g.players.crouching[idx] = false
	g.players.hp[idx] = maxHP
	g.players.alive[idx] = true
	g.players.flashEndsAt[idx] = 0
	g.players.activeWeapon[idx] = g.normalizeActiveWeaponLocked(idx, g.players.activeWeapon[idx])
	g.players.shotBloom[idx] = 0
	g.players.bloomWeapon[idx] = g.players.activeWeapon[idx]
	g.players.lastShotAt[idx] = 0
	g.clearReloadLocked(idx)
	g.players.nextAttackAt[idx] = 0
	recordPositionSample(&g.players.history[idx], nowMS, spawn, false)
}

func (g *Game) startMatchLocked(nowMS int64) {
	g.state = StatePlaying
	g.currentRound = 1
	g.roundEndsAt = nowMS + roundDurationMS
	g.buyEndsAt = nowMS + buyPhaseDurationMS
	g.intermissionEndsAt = 0
	g.roundWinner = TeamNone
	g.pendingMatchEnd = false
	g.blueScore = 0
	g.greenScore = 0
	g.projectiles = nil
	g.effects = nil
	g.nextProjID = 0
	for i := range g.players.ids {
		g.resetPlayerForNewMatchLocked(i, nowMS)
	}
}

func (g *Game) startNextRoundLocked(nowMS int64) {
	g.currentRound++
	g.roundEndsAt = nowMS + roundDurationMS
	g.buyEndsAt = nowMS + buyPhaseDurationMS
	g.intermissionEndsAt = 0
	g.roundWinner = TeamNone
	g.pendingMatchEnd = false
	g.projectiles = nil
	g.effects = nil
	g.nextProjID = 0
	g.grantRoundIncomeLocked(roundIncomeCredits)
	for i := range g.players.ids {
		g.respawnPlayerLocked(i, nowMS)
	}
}

func (g *Game) endMatchLocked() {
	g.state = StateWaiting
	g.currentRound = 0
	g.roundEndsAt = 0
	g.buyEndsAt = 0
	g.intermissionEndsAt = 0
	g.roundWinner = TeamNone
	g.pendingMatchEnd = false
	g.projectiles = nil
	g.effects = nil
	g.nextProjID = 0
	for i := range g.players.ids {
		g.players.flashEndsAt[i] = 0
		g.players.shotBloom[i] = 0
		g.players.bloomWeapon[i] = g.players.activeWeapon[i]
		g.players.lastShotAt[i] = 0
		g.clearReloadLocked(i)
	}
}

func (g *Game) roundWinnerByEliminationLocked() TeamID {
	blueAlive, greenAlive := g.aliveCountsLocked()
	switch {
	case blueAlive > 0 && greenAlive == 0:
		return TeamBlue
	case greenAlive > 0 && blueAlive == 0:
		return TeamGreen
	default:
		return TeamNone
	}
}

func (g *Game) roundWinnerByTimeoutLocked() TeamID {
	blueAlive, greenAlive := g.aliveCountsLocked()
	switch {
	case blueAlive > greenAlive:
		return TeamBlue
	case greenAlive > blueAlive:
		return TeamGreen
	default:
		return TeamNone
	}
}

func (g *Game) beginRoundCooldownLocked(team TeamID, nowMS int64) {
	switch normalizeTeam(team) {
	case TeamBlue:
		g.blueScore++
	case TeamGreen:
		g.greenScore++
	}

	g.intermissionEndsAt = nowMS + roundCooldownMS
	g.roundWinner = normalizeTeam(team)
	g.pendingMatchEnd = g.currentRound >= totalRounds
	g.roundEndsAt = 0
	g.buyEndsAt = 0
	g.projectiles = nil
	g.effects = nil
	g.nextProjID = 0
	for i := range g.players.ids {
		g.players.flashEndsAt[i] = 0
		g.players.shotBloom[i] = 0
		g.players.bloomWeapon[i] = g.players.activeWeapon[i]
		g.players.lastShotAt[i] = 0
		g.players.nextAttackAt[i] = 0
		g.clearReloadLocked(i)
	}
}

func (g *Game) broadcastRoundState(nowMS int64) {
	g.mu.RLock()
	if len(g.players.ids) == 0 {
		g.mu.RUnlock()
		return
	}
	msg, _ := json.Marshal(g.buildPlayerStateMessageLocked("round", nowMS))
	g.mu.RUnlock()
	g.broadcast(msg, 0)
}

func (g *Game) tick(nowMS int64) {
	shouldBroadcastLobby := false
	shouldBroadcastRound := false
	shouldBroadcastState := false
	tickEvents := newTickMessages()

	g.mu.Lock()
	if g.state == StatePlaying {
		switch {
		case g.intermissionEndsAt > 0 && nowMS >= g.intermissionEndsAt:
			if g.pendingMatchEnd {
				g.endMatchLocked()
				shouldBroadcastLobby = true
			} else {
				g.startNextRoundLocked(nowMS)
				shouldBroadcastRound = true
			}
		case g.isIntermissionLocked(nowMS):
			shouldBroadcastState = true
		default:
			tickEvents = g.updateReloadsAndProjectilesLocked(nowMS)
			if winner := g.roundWinnerByEliminationLocked(); winner != TeamNone {
				g.beginRoundCooldownLocked(winner, nowMS)
				shouldBroadcastRound = true
			} else if g.roundEndsAt > 0 && nowMS >= g.roundEndsAt {
				g.beginRoundCooldownLocked(g.roundWinnerByTimeoutLocked(), nowMS)
				shouldBroadcastRound = true
			} else if g.state == StatePlaying {
				shouldBroadcastState = true
			}
		}
	}
	g.mu.Unlock()

	for _, msg := range tickEvents.broadcasts {
		g.broadcast(msg, 0)
	}
	for id, msgs := range tickEvents.directs {
		for _, msg := range msgs {
			g.sendRawToPlayer(id, msg)
		}
	}

	if shouldBroadcastRound {
		g.broadcastRoundState(nowMS)
		g.broadcastLobby()
	}
	if shouldBroadcastLobby {
		g.broadcastLobby()
	}
	if shouldBroadcastState {
		g.stateTick(nowMS)
	}
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade error:", err)
		return
	}

	playerID, sendCh, ok := game.addPlayer(conn)
	if !ok {
		conn.WriteJSON(map[string]string{"t": "error", "msg": "server full"})
		conn.Close()
		return
	}

	go writer(conn, sendCh)

	defer func() {
		game.removePlayer(playerID)
		game.broadcastLobby()
		close(sendCh)
	}()

	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg map[string]json.RawMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue
		}

		var t string
		json.Unmarshal(msg["t"], &t)

		game.mu.RLock()
		idx, ok := game.players.indexOf(playerID)
		named := ok && game.players.names[idx] != ""
		game.mu.RUnlock()

		if !named {
			if t == "name" {
				var name string
				json.Unmarshal(msg["name"], &name)
				if name == "" {
					name = fmt.Sprintf("Player %d", playerID)
				}

				game.mu.Lock()
				idx, ok := game.players.indexOf(playerID)
				if !ok {
					game.mu.Unlock()
					continue
				}
				game.players.names[idx] = name
				nowMS := time.Now().UnixMilli()
				if game.state == StatePlaying && normalizeTeam(game.players.team[idx]) == TeamNone {
					game.players.team[idx] = game.preferredTeamLocked()
					game.respawnPlayerLocked(idx, nowMS)
				}
				welcome := map[string]interface{}{
					"t":     "welcome",
					"id":    playerID,
					"state": gameStateName(game.state),
					"match": game.buildMatchStateLocked(nowMS),
				}
				playerState := game.buildPlayerStateLocked(idx, nowMS)
				game.mu.Unlock()

				welcome["pos"] = playerState.Pos
				welcome["hp"] = playerState.Hp
				welcome["armor"] = playerState.Armor
				welcome["credits"] = playerState.Credits
				welcome["team"] = playerState.Team
				welcome["crouching"] = playerState.Crouching
				welcome["hasPistol"] = playerState.HasPistol
				welcome["hasMachineGun"] = playerState.HasMachineGun
				welcome["pistolClip"] = playerState.PistolClip
				welcome["pistolReserve"] = playerState.PistolReserve
				welcome["machineGunClip"] = playerState.MachineGunClip
				welcome["machineGunReserve"] = playerState.MachineGunReserve
				welcome["bombs"] = playerState.Bombs
				welcome["smokes"] = playerState.Smokes
				welcome["flashbangs"] = playerState.Flashbangs
				welcome["flashTimeLeftMs"] = playerState.FlashTimeLeftMS
				welcome["activeWeapon"] = playerState.ActiveWeapon
				welcome["reloading"] = playerState.Reloading
				welcome["reloadTimeLeftMs"] = playerState.ReloadTimeLeftMS
				welcome["alive"] = playerState.Alive
				queueJSON(sendCh, welcome)
				game.broadcastLobby()
			}
			continue
		}

		switch t {
		case "ping":
			var clientTime int64
			json.Unmarshal(msg["clientTime"], &clientTime)
			queueJSON(sendCh, map[string]interface{}{
				"t":          "pong",
				"clientTime": clientTime,
				"serverTime": time.Now().UnixMilli(),
			})

		case "input":
			if !game.isPlaying() {
				continue
			}

			nowMS := time.Now().UnixMilli()
			var pos Vec3
			var yaw float64
			var pitch float64
			var crouching bool
			json.Unmarshal(msg["pos"], &pos)
			json.Unmarshal(msg["yaw"], &yaw)
			json.Unmarshal(msg["pitch"], &pitch)
			json.Unmarshal(msg["crouching"], &crouching)

			game.mu.Lock()
			idx, ok := game.players.indexOf(playerID)
			if ok {
				game.applyInputLocked(idx, pos, yaw, pitch, crouching, nowMS)
			}
			game.mu.Unlock()

		case "shoot":
			if !game.isPlaying() {
				continue
			}

			var dir Vec3
			var requestedShotTime int64
			var requestedWeapon WeaponID
			var aiming bool
			var alternate bool
			json.Unmarshal(msg["dir"], &dir)
			json.Unmarshal(msg["shotTime"], &requestedShotTime)
			json.Unmarshal(msg["weapon"], &requestedWeapon)
			json.Unmarshal(msg["aiming"], &aiming)
			json.Unmarshal(msg["alternate"], &alternate)
			dir = normalizeVec(dir)

			nowMS := time.Now().UnixMilli()
			shotTime := clampShotTime(requestedShotTime, nowMS)

			game.mu.Lock()
			idx, ok := game.players.indexOf(playerID)
			if !ok || !game.players.alive[idx] || nowMS < game.buyEndsAt || game.isIntermissionLocked(nowMS) {
				game.mu.Unlock()
				continue
			}

			weapon := game.normalizeActiveWeaponLocked(idx, requestedWeapon)
			game.players.activeWeapon[idx] = weapon
			if !isCombatWeapon(weapon) {
				game.mu.Unlock()
				continue
			}
			alternate = alternate && weapon == WeaponKnife
			if game.isReloadingLocked(idx, nowMS) {
				game.mu.Unlock()
				continue
			}
			config := effectiveWeaponConfig(weapon, alternate)
			if nowMS < game.players.nextAttackAt[idx] {
				game.mu.Unlock()
				continue
			}
			if config.UsesAmmo && !game.spendAmmoLocked(idx, weapon, 1) {
				game.mu.Unlock()
				continue
			}
			bloom := game.registerShotBloomLocked(idx, weapon, nowMS)
			moving := isMovingAtTime(game.players.history[idx], shotTime)
			dir = applyShotSpread(dir, config, aiming, game.players.crouching[idx], moving, bloom, shotTime+int64(playerID)*97+nowMS)
			game.players.nextAttackAt[idx] = nowMS + config.FireIntervalMS
			shooterPos := positionAtTime(game.players.history[idx], shotTime)
			game.mu.Unlock()

			shotMsg, _ := json.Marshal(map[string]interface{}{
				"t":         "shot",
				"id":        playerID,
				"pos":       shooterPos,
				"dir":       dir,
				"weapon":    weapon,
				"alternate": alternate,
			})
			game.broadcast(shotMsg, 0)

			hit := findHitTarget(playerID, shooterPos, dir, shotTime, config.Range)
			if hit == nil {
				continue
			}

			damage := damageForConfig(config, hit.zone)
			appliedHit := false
			killed := false
			victimID := hit.id
			victimHP := 0
			victimArmor := 0
			absorbedDamage := 0
			var shooterUpdate *economyUpdate

			game.mu.Lock()
			victimIdx, ok := game.players.indexOf(victimID)
			shooterIdx, shooterOK := game.players.indexOf(playerID)
			if ok && shooterOK && game.players.alive[victimIdx] {
				appliedHit = true
				victimHP, victimArmor, absorbedDamage = applyDamage(game.players.hp[victimIdx], game.players.armor[victimIdx], damage)
				game.players.hp[victimIdx] = victimHP
				game.players.armor[victimIdx] = victimArmor

				rewardAmount := rewardForHitZone(hit.zone)
				rewardLabel := "Hit reward"
				if hit.zone == HitZoneHead {
					rewardLabel = "Headshot reward"
				}

				if victimHP <= 0 {
					game.players.alive[victimIdx] = false
					game.players.deaths[victimIdx]++
					game.stripLoadoutOnDeathLocked(victimIdx)
					killed = true
					game.players.kills[shooterIdx]++
					rewardAmount += killReward
					rewardLabel = "Elimination reward"
				}

				game.players.credits[shooterIdx] += rewardAmount
				update := game.applyEconomyUpdateLocked(shooterIdx, true, "reward", string(weapon), rewardLabel, "", rewardAmount, nowMS)
				shooterUpdate = &update
			}
			game.mu.Unlock()

			if !appliedHit {
				continue
			}

			hitMsg, _ := json.Marshal(map[string]interface{}{
				"t":        "hit",
				"from":     playerID,
				"to":       victimID,
				"dmg":      damage,
				"zone":     hit.zone,
				"weapon":   weapon,
				"hp":       victimHP,
				"armor":    victimArmor,
				"absorbed": absorbedDamage,
			})
			game.broadcast(hitMsg, 0)
			if shooterUpdate != nil {
				game.sendToPlayer(playerID, shooterUpdate)
			}

			if !killed {
				continue
			}

			killMsg, _ := json.Marshal(map[string]interface{}{
				"t":      "kill",
				"killer": playerID,
				"victim": victimID,
			})
			game.broadcast(killMsg, 0)

		case "buy":
			var item string
			json.Unmarshal(msg["item"], &item)
			nowMS := time.Now().UnixMilli()
			game.mu.Lock()
			idx, ok := game.players.indexOf(playerID)
			if !ok {
				game.mu.Unlock()
				continue
			}
			update := game.applyPurchaseLocked(idx, item, nowMS)
			game.mu.Unlock()
			queueJSON(sendCh, update)

		case "reload":
			nowMS := time.Now().UnixMilli()
			game.mu.Lock()
			idx, ok := game.players.indexOf(playerID)
			if !ok {
				game.mu.Unlock()
				continue
			}
			weapon := game.normalizeActiveWeaponLocked(idx, game.players.activeWeapon[idx])
			var update economyUpdate
			switch {
			case game.state != StatePlaying:
				update = game.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Match has not started", 0, nowMS)
			case game.isIntermissionLocked(nowMS):
				update = game.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Round is over", 0, nowMS)
			case !game.players.alive[idx]:
				update = game.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Only alive players can reload", 0, nowMS)
			case weapon != WeaponPistol && weapon != WeaponMachineGun:
				update = game.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Current item cannot reload", 0, nowMS)
			case game.isReloadingLocked(idx, nowMS):
				update = game.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Already reloading", 0, nowMS)
			case !game.startReloadLocked(idx, weapon, nowMS):
				update = game.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Magazine is already full", 0, nowMS)
				if game.currentReserveLocked(idx, weapon) == 0 {
					update = game.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "No reserve ammo", 0, nowMS)
				}
			default:
				update = game.applyEconomyUpdateLocked(idx, true, "reload", string(weapon), "", "", 0, nowMS)
			}
			game.mu.Unlock()
			queueJSON(sendCh, update)

		case "throw":
			if !game.isPlaying() {
				continue
			}

			var dir Vec3
			var requestedWeapon WeaponID
			json.Unmarshal(msg["dir"], &dir)
			json.Unmarshal(msg["weapon"], &requestedWeapon)
			dir = normalizeVec(dir)

			nowMS := time.Now().UnixMilli()
			game.mu.Lock()
			idx, ok := game.players.indexOf(playerID)
			if !ok {
				game.mu.Unlock()
				continue
			}

			weapon := game.normalizeActiveWeaponLocked(idx, requestedWeapon)
			var update economyUpdate
			switch {
			case !game.players.alive[idx]:
				update = game.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Only alive players can throw utility", 0, nowMS)
			case game.isIntermissionLocked(nowMS):
				update = game.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Round is over", 0, nowMS)
			case nowMS < game.buyEndsAt:
				update = game.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Buy time is still active", 0, nowMS)
			case !isUtilityWeaponID(weapon):
				update = game.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Selected item is not throwable", 0, nowMS)
			case game.isReloadingLocked(idx, nowMS):
				update = game.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Cannot throw while reloading", 0, nowMS)
			case nowMS < game.players.nextAttackAt[idx]:
				update = game.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Utility is not ready yet", 0, nowMS)
			case !game.spendUtilityLocked(idx, weapon):
				update = game.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "No utility remaining", 0, nowMS)
			default:
				game.players.activeWeapon[idx] = weapon
				game.players.nextAttackAt[idx] = nowMS + utilityThrowIntervalMS
				game.spawnProjectileLocked(playerID, weapon, game.players.pos[idx], dir, nowMS)
				game.players.activeWeapon[idx] = game.normalizeActiveWeaponLocked(idx, weapon)
				update = game.applyEconomyUpdateLocked(idx, true, "throw", string(weapon), string(weapon), "", 0, nowMS)
			}
			game.mu.Unlock()
			queueJSON(sendCh, update)

		case "switch":
			var requestedWeapon WeaponID
			json.Unmarshal(msg["weapon"], &requestedWeapon)
			nowMS := time.Now().UnixMilli()
			game.mu.Lock()
			idx, ok := game.players.indexOf(playerID)
			if ok && !game.isReloadingLocked(idx, nowMS) {
				game.players.activeWeapon[idx] = game.normalizeActiveWeaponLocked(idx, requestedWeapon)
			}
			game.mu.Unlock()

		case "team":
			var requestedTeam TeamID
			json.Unmarshal(msg["team"], &requestedTeam)
			nowMS := time.Now().UnixMilli()
			response := map[string]interface{}{
				"t":    "team",
				"team": normalizeTeam(requestedTeam),
			}

			game.mu.Lock()
			idx, ok := game.players.indexOf(playerID)
			if !ok {
				game.mu.Unlock()
				continue
			}

			switch {
			case game.state != StateWaiting:
				response["ok"] = false
				response["reason"] = "Match already in progress"
			case normalizeTeam(requestedTeam) == TeamNone:
				response["ok"] = false
				response["reason"] = "Pick blue or green"
			case !game.canAssignTeamLocked(idx, requestedTeam):
				response["ok"] = false
				response["reason"] = "Teams must stay balanced"
			default:
				game.players.team[idx] = normalizeTeam(requestedTeam)
				game.respawnPlayerLocked(idx, nowMS)
				response["ok"] = true
			}
			game.mu.Unlock()
			queueJSON(sendCh, response)
			game.broadcastLobby()

		case "start":
			nowMS := time.Now().UnixMilli()
			shouldBroadcast := false
			startDeniedReason := ""
			game.mu.Lock()
			if game.state == StateWaiting {
				if ok, reason := game.canStartMatchLocked(); !ok {
					startDeniedReason = reason
				} else {
					game.startMatchLocked(nowMS)
					shouldBroadcast = true
				}
			}
			matchMessage := map[string]interface{}{
				"t":     "start",
				"match": game.buildMatchStateLocked(nowMS),
			}
			game.mu.Unlock()
			if startDeniedReason != "" {
				queueJSON(sendCh, map[string]interface{}{
					"t":      "start",
					"ok":     false,
					"reason": startDeniedReason,
				})
				break
			}
			if shouldBroadcast {
				startMsg, _ := json.Marshal(matchMessage)
				game.broadcast(startMsg, 0)
				game.broadcastRoundState(nowMS)
				game.broadcastLobby()
			}
		}
	}
}

func findHitTarget(shooterID int, origin, dir Vec3, shotTime int64, maxRange float64) *hitCandidate {
	game.mu.RLock()
	defer game.mu.RUnlock()

	var best *hitCandidate
	bestDist := maxRange
	shooterIdx, shooterOK := game.players.indexOf(shooterID)
	shooterTeam := TeamNone
	if shooterOK {
		shooterTeam = normalizeTeam(game.players.team[shooterIdx])
	}

	for i, id := range game.players.ids {
		if id == shooterID || !game.players.alive[i] {
			continue
		}
		if shooterTeam != TeamNone && normalizeTeam(game.players.team[i]) == shooterTeam {
			continue
		}

		target := sampleAtTime(game.players.history[i], shotTime)
		zone, dist, ok := tracePlayerHit(origin, dir, target.Pos, target.Crouching, maxRange)
		if !ok || dist > bestDist {
			continue
		}

		bestDist = dist
		best = &hitCandidate{
			index: i,
			id:    id,
			zone:  zone,
			dist:  dist,
		}
	}

	return best
}

func recordPositionSample(history *[]positionSample, at int64, pos Vec3, crouching bool) {
	samples := append(*history, positionSample{At: at, Pos: pos, Crouching: crouching})
	cutoff := at - positionHistoryWindowMS
	trimmed := samples[:0]
	for _, sample := range samples {
		if sample.At >= cutoff {
			trimmed = append(trimmed, sample)
		}
	}
	*history = trimmed
}

func positionAtTime(samples []positionSample, at int64) Vec3 {
	return sampleAtTime(samples, at).Pos
}

func sampleAtTime(samples []positionSample, at int64) positionSample {
	if len(samples) == 0 {
		return positionSample{}
	}
	if at <= 0 || at >= samples[len(samples)-1].At {
		return samples[len(samples)-1]
	}
	if at <= samples[0].At {
		return samples[0]
	}

	for i := 1; i < len(samples); i++ {
		prev := samples[i-1]
		next := samples[i]
		if at > next.At {
			continue
		}

		span := next.At - prev.At
		if span <= 0 {
			return next
		}
		alpha := float64(at-prev.At) / float64(span)
		crouching := prev.Crouching
		if alpha >= 0.5 {
			crouching = next.Crouching
		}
		return positionSample{
			At:        at,
			Crouching: crouching,
			Pos: Vec3{
				prev.Pos[0] + (next.Pos[0]-prev.Pos[0])*alpha,
				prev.Pos[1] + (next.Pos[1]-prev.Pos[1])*alpha,
				prev.Pos[2] + (next.Pos[2]-prev.Pos[2])*alpha,
			},
		}
	}

	return samples[len(samples)-1]
}

func clampShotTime(requested, now int64) int64 {
	if requested <= 0 {
		return now
	}

	minAllowed := now - maxLagCompensationMS
	if requested < minAllowed {
		return minAllowed
	}
	if requested > now {
		return now
	}
	return requested
}

func tracePlayerHit(origin, dir, targetPos Vec3, crouching bool, maxRange float64) (HitZone, float64, bool) {
	bestDist := maxRange
	bestZone := HitZone("")
	found := false

	for _, box := range playerHitBoxes(targetPos, crouching) {
		dist, ok := rayAABBIntersection(origin, dir, box.min, box.max, maxRange)
		if !ok || dist > bestDist {
			continue
		}
		bestDist = dist
		bestZone = box.zone
		found = true
	}

	return bestZone, bestDist, found
}

func playerHitBoxes(pos Vec3, crouching bool) []hitBox {
	eyeHeight := standEyeHeight
	if crouching {
		eyeHeight = crouchEyeHeight
	}
	footY := pos[1] - eyeHeight

	if crouching {
		return []hitBox{
			{
				zone: HitZoneHead,
				min:  Vec3{pos[0] - 0.24, footY + 0.92, pos[2] - 0.24},
				max:  Vec3{pos[0] + 0.24, footY + 1.3, pos[2] + 0.24},
			},
			{
				zone: HitZoneBody,
				min:  Vec3{pos[0] - 0.42, footY + 0.44, pos[2] - 0.32},
				max:  Vec3{pos[0] + 0.42, footY + 0.92, pos[2] + 0.32},
			},
			{
				zone: HitZoneBody,
				min:  Vec3{pos[0] - 0.32, footY, pos[2] - 0.28},
				max:  Vec3{pos[0] + 0.32, footY + 0.44, pos[2] + 0.28},
			},
		}
	}

	return []hitBox{
		{
			zone: HitZoneHead,
			min:  Vec3{pos[0] - 0.24, footY + 1.42, pos[2] - 0.24},
			max:  Vec3{pos[0] + 0.24, footY + 1.94, pos[2] + 0.24},
		},
		{
			zone: HitZoneBody,
			min:  Vec3{pos[0] - 0.42, footY + 0.72, pos[2] - 0.32},
			max:  Vec3{pos[0] + 0.42, footY + 1.38, pos[2] + 0.32},
		},
		{
			zone: HitZoneBody,
			min:  Vec3{pos[0] - 0.32, footY, pos[2] - 0.28},
			max:  Vec3{pos[0] + 0.32, footY + 0.7, pos[2] + 0.28},
		},
	}
}

func rayAABBIntersection(origin, dir, min, max Vec3, maxRange float64) (float64, bool) {
	tMin := 0.0
	tMax := maxRange

	for axis := 0; axis < 3; axis++ {
		if math.Abs(dir[axis]) < 1e-6 {
			if origin[axis] < min[axis] || origin[axis] > max[axis] {
				return 0, false
			}
			continue
		}

		invDir := 1.0 / dir[axis]
		t1 := (min[axis] - origin[axis]) * invDir
		t2 := (max[axis] - origin[axis]) * invDir
		if t1 > t2 {
			t1, t2 = t2, t1
		}

		tMin = math.Max(tMin, t1)
		tMax = math.Min(tMax, t2)
		if tMin > tMax {
			return 0, false
		}
	}

	return tMin, true
}

func normalizeVec(v Vec3) Vec3 {
	length := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
	if length < 1e-8 {
		return Vec3{0, 0, -1}
	}
	return Vec3{v[0] / length, v[1] / length, v[2] / length}
}

func distanceVec3(a, b Vec3) float64 {
	dx := a[0] - b[0]
	dy := a[1] - b[1]
	dz := a[2] - b[2]
	return math.Sqrt(dx*dx + dy*dy + dz*dz)
}

func dotVec3(a, b Vec3) float64 {
	return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
}

func crossVec3(a, b Vec3) Vec3 {
	return Vec3{
		a[1]*b[2] - a[2]*b[1],
		a[2]*b[0] - a[0]*b[2],
		a[0]*b[1] - a[1]*b[0],
	}
}

func lookDirFromYawPitch(yaw, pitch float64) Vec3 {
	return Vec3{
		-math.Sin(yaw) * math.Cos(pitch),
		math.Sin(pitch),
		-math.Cos(yaw) * math.Cos(pitch),
	}
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func gameStateName(state GameState) string {
	if state == StatePlaying {
		return "playing"
	}
	return "waiting"
}

func resolveClientDir() string {
	candidates := []string{"../client", "client"}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}
	return filepath.Join("..", "client")
}

func serverPort() string {
	if port := os.Getenv("PORT"); port != "" {
		return port
	}
	return "8080"
}

func getLANIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "127.0.0.1"
	}
	for _, addr := range addrs {
		if ipNet, ok := addr.(*net.IPNet); ok && !ipNet.IP.IsLoopback() && ipNet.IP.To4() != nil {
			return ipNet.IP.String()
		}
	}
	return "127.0.0.1"
}

func staticClientHandler(root http.FileSystem) http.Handler {
	fileServer := http.FileServer(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		fileServer.ServeHTTP(w, r)
	})
}

func main() {
	port := serverPort()
	http.Handle("/", staticClientHandler(http.Dir(resolveClientDir())))
	http.HandleFunc("/ws", handleWS)

	go func() {
		ticker := time.NewTicker(time.Second / tickRate)
		for range ticker.C {
			game.tick(time.Now().UnixMilli())
		}
	}()

	lanIP := getLANIP()
	log.Printf("FPS server running on http://%s:%s (LAN) and http://localhost:%s", lanIP, port, port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
