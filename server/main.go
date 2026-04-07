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
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

const (
	maxPlayers                  = 6
	tickRate                    = 60
	maxHP                       = 100
	maxArmor                    = 100
	maxCredits                  = 16000
	standEyeHeight              = 1.7
	crouchEyeHeight             = 1.15
	grenadeMaxCount             = 1
	startingCredits             = 800
	totalRounds                 = 30
	roundDurationMS             = 5 * 60 * 1000
	buyPhaseDurationMS          = 10 * 1000
	roundCooldownMS             = 5 * 1000
	roundWinCredits             = 3250
	pistolRoundLossBonus        = 1900
	respawnDelayMS              = 3 * 1000
	deathmatchDurationMS        = 10 * 60 * 1000
	deathmatchVoteMS            = 10 * 1000
	deathmatchSpawnProtectionMS = 5 * 1000
	deathmatchLoadoutWindowMS   = 7 * 1000
	deathmatchKillAmmoReward    = 10
	positionHistoryWindowMS     = 1000
	maxLagCompensationMS        = 250
	hitscanRange                = 50.0
	knifeRange                  = 2.6
	utilityThrowIntervalMS      = 800
	projectileSpeed             = 16.0
	projectileGravity           = -18.0
	projectileBounce            = 0.45
	projectileGroundDrag        = 0.72
	projectileBounds            = 29.5
	projectileCeilingY          = 4.9
	projectileFloorY            = 0.12
	projectileFuseMS            = 1800
	bombDamage                  = 100
	bombRadius                  = 6.0
	flashbangRadius             = 12.0
	flashbangDurationMS         = 3 * 1000
	flashbangVisibleDot         = 0.2
	smokeRadius                 = 9.0
	smokeDurationMS             = 8 * 1000
	bombEffectDurationMS        = 350
	botThinkIntervalMS          = 650
	botPreferredRange           = 6.0
	botAdvanceSpeed             = 4.8
	botStrafeSpeed              = 3.6
	botStrafeFlipMS             = 700
	botBoundMargin              = 1.0
	maxChatMessageRunes         = 120
	worldStepHeight             = 0.6
	worldStepDown               = 0.75
	playerHeadClearance         = 0.1
)

// ─── Map wall segments for collision (mirrored from client world.js) ───

const (
	arenaSize = 30.0
	wallThick = 0.3
)

type wallSegment struct {
	x1, z1, x2, z2 float64
}

var mapWalls = []wallSegment{
	// Outer shell
	{-arenaSize, -arenaSize, arenaSize, -arenaSize},
	{arenaSize, -arenaSize, arenaSize, arenaSize},
	{arenaSize, arenaSize, -arenaSize, arenaSize},
	{-arenaSize, arenaSize, -arenaSize, -arenaSize},
	// Northwest meeting pod
	{-26, -26, -14, -26}, {-26, -26, -26, -14},
	{-14, -26, -14, -20}, {-14, -18, -14, -14},
	{-26, -14, -21, -14}, {-18, -14, -14, -14},
	// Northeast meeting pod
	{14, -26, 26, -26}, {26, -26, 26, -14},
	{14, -26, 14, -20}, {14, -18, 14, -14},
	{14, -14, 19, -14}, {22, -14, 26, -14},
	// Southwest meeting pod
	{-26, 14, -14, 14}, {-26, 14, -26, 26},
	{-14, 14, -14, 19}, {-14, 22, -14, 26},
	{-26, 26, -14, 26},
	// Southeast meeting pod
	{14, 14, 26, 14}, {26, 14, 26, 26},
	{14, 14, 14, 19}, {14, 22, 14, 26},
	{14, 26, 26, 26},
	// Open workspace dividers, west
	{-18, -9, -9, -9}, {-18, 9, -9, 9},
	{-18, -9, -18, -3}, {-18, 3, -18, 9},
	{-9, -9, -9, -5}, {-9, 5, -9, 9},
	// Open workspace dividers, east
	{9, -9, 18, -9}, {9, 9, 18, 9},
	{18, -9, 18, -3}, {18, 3, 18, 9},
	{9, -9, 9, -5}, {9, 5, 9, 9},
	// Central huddle screens
	{-4, -2, 4, -2}, {-4, 2, 4, 2},
	// South reception desk
	{-6, 17, 6, 17}, {-6, 17, -6, 22}, {6, 17, 6, 22},
	// North cafe counter
	{-7, -17, 7, -17}, {-7, -22, -7, -17}, {7, -22, 7, -17},
}

const playerRadius = 0.4

func closestPointOnSegment(px, pz, ax, az, bx, bz float64) (float64, float64) {
	abx := bx - ax
	abz := bz - az
	len2 := abx*abx + abz*abz
	if len2 < 1e-12 {
		return ax, az
	}
	t := ((px-ax)*abx + (pz-az)*abz) / len2
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	return ax + t*abx, az + t*abz
}

func collideCircleAgainstRect(px, pz, radius, bx0, bx1, bz0, bz1 float64) (float64, float64) {
	cx := math.Max(bx0, math.Min(px, bx1))
	cz := math.Max(bz0, math.Min(pz, bz1))
	dx := px - cx
	dz := pz - cz
	dist := math.Sqrt(dx*dx + dz*dz)
	if dist < radius && dist > 1e-8 {
		push := (radius - dist) / dist
		return px + dx*push, pz + dz*push
	}
	if dist < 1e-8 && px >= bx0 && px <= bx1 && pz >= bz0 && pz <= bz1 {
		pushXn := px - bx0 + radius
		pushXp := bx1 - px + radius
		pushZn := pz - bz0 + radius
		pushZp := bz1 - pz + radius
		minPush := math.Min(math.Min(pushXn, pushXp), math.Min(pushZn, pushZp))
		if minPush == pushXn {
			return bx0 - radius, pz
		}
		if minPush == pushXp {
			return bx1 + radius, pz
		}
		if minPush == pushZn {
			return px, bz0 - radius
		}
		return px, bz1 + radius
	}
	return px, pz
}

func platformBounds(platform platformEntry) (minX, maxX, minZ, maxZ, top, bottom float64) {
	minX = math.Min(platform.X1, platform.X2)
	maxX = math.Max(platform.X1, platform.X2)
	minZ = math.Min(platform.Z1, platform.Z2)
	maxZ = math.Max(platform.Z1, platform.Z2)
	top = platform.Y
	thickness := platform.Thickness
	if thickness <= 0 {
		thickness = 0.35
	}
	bottom = top - thickness
	return
}

func (g *Game) groundHeightAt(x, z, maxTopY float64) float64 {
	best := 0.0
	for _, platform := range g.mapPlatformsRuntime {
		minX, maxX, minZ, maxZ, top, _ := platformBounds(platform)
		if top > maxTopY+1e-6 {
			continue
		}
		if x < minX || x > maxX || z < minZ || z > maxZ {
			continue
		}
		if top > best {
			best = top
		}
	}
	return best
}

func (g *Game) ceilingHeightAt(x, z, fromHeadY, toHeadY float64) (float64, bool) {
	best := 0.0
	found := false
	for _, platform := range g.mapPlatformsRuntime {
		minX, maxX, minZ, maxZ, _, bottom := platformBounds(platform)
		if x < minX || x > maxX || z < minZ || z > maxZ {
			continue
		}
		if bottom+1e-6 < fromHeadY || bottom-1e-6 > toHeadY {
			continue
		}
		if !found || bottom < best {
			best = bottom
			found = true
		}
	}
	return best, found
}

func (g *Game) collideWalls(pos *Vec3, eyeHeight float64) {
	px := pos[0]
	pz := pos[2]
	thick := g.mapWallThickness
	if thick == 0 {
		thick = wallThick
	}
	r := playerRadius + thick

	for _, w := range g.mapWallsRuntime {
		cx, cz := closestPointOnSegment(px, pz, w.x1, w.z1, w.x2, w.z2)
		dx := px - cx
		dz := pz - cz
		dist := math.Sqrt(dx*dx + dz*dz)
		if dist < r && dist > 1e-8 {
			push := (r - dist) / dist
			px += dx * push
			pz += dz * push
		}
	}

	playerFoot := pos[1] - eyeHeight
	playerTop := pos[1] + playerHeadClearance
	for _, platform := range g.mapPlatformsRuntime {
		minX, maxX, minZ, maxZ, top, bottom := platformBounds(platform)
		stepDelta := top - playerFoot
		standingOnTop := playerFoot >= top-0.08
		canStepOnto := stepDelta >= -0.08 && stepDelta <= worldStepHeight+0.02
		if standingOnTop || canStepOnto {
			continue
		}
		if playerTop < bottom || playerFoot > top {
			continue
		}
		px, pz = collideCircleAgainstRect(px, pz, playerRadius, minX, maxX, minZ, maxZ)
	}
	for _, box := range g.mapBoxesRuntime {
		bMinY := box.Cy - box.Hy
		bMaxY := box.Cy + box.Hy
		if playerTop < bMinY || playerFoot > bMaxY {
			continue
		}
		bx0 := box.Cx - box.Hx
		bx1 := box.Cx + box.Hx
		bz0 := box.Cz - box.Hz
		bz1 := box.Cz + box.Hz
		px, pz = collideCircleAgainstRect(px, pz, playerRadius, bx0, bx1, bz0, bz1)
	}

	pos[0] = px
	pos[2] = pz
}

type GameState int

const (
	StateWaiting GameState = iota
	StatePlaying
)

type GameMode string

const (
	ModeTeam       GameMode = "team"
	ModeDeathmatch GameMode = "deathmatch"
	ModeHostage    GameMode = "hostage"
	ModeCTF        GameMode = "ctf"
)

const (
	hostagePickupRadius = 2.5
	hostageFollowDist   = 1.5
	flagPickupRadius    = 1.5
	flagCaptureRadius   = 2.0
	ctfCapturesToWin    = 3
	flagAutoReturnSec   = 30
	ctfDurationMS       = 10 * 60 * 1000
	hostageDeathPenalty = 500
	hostageFollowSpeed  = 4.5
	hostageRescueReward = 1000
)

type HitZone string

const (
	HitZoneHead HitZone = "head"
	HitZoneBody HitZone = "body"
)

type WeaponID string

const (
	WeaponKnife     WeaponID = "knife"
	WeaponBomb      WeaponID = "bomb"
	WeaponSmoke     WeaponID = "smoke"
	WeaponFlashbang WeaponID = "flashbang"
)

var lossBonusSteps = [...]int{1400, 1900, 2400, 2900, 3400}

type TeamID string

const (
	TeamNone  TeamID = ""
	TeamBlue  TeamID = "blue"
	TeamGreen TeamID = "green"
)

type Vec3 [3]float64

type shootMessage struct {
	Dir       Vec3     `json:"dir"`
	ShotTime  int64    `json:"shotTime"`
	Weapon    WeaponID `json:"weapon"`
	Aiming    bool     `json:"aiming"`
	Alternate bool     `json:"alternate"`
}

type positionSample struct {
	At        int64
	Pos       Vec3
	Crouching bool
}

const posRingCap = 64

type positionRingBuffer struct {
	buf   [posRingCap]positionSample
	head  int
	count int
}

func (r *positionRingBuffer) add(s positionSample) {
	r.buf[(r.head+r.count)%posRingCap] = s
	if r.count < posRingCap {
		r.count++
	} else {
		r.head = (r.head + 1) % posRingCap
	}
}

// at returns the i-th element in chronological order (0 = oldest).
func (r *positionRingBuffer) at(i int) positionSample {
	return r.buf[(r.head+i)%posRingCap]
}

// trimBefore removes all samples with At < cutoff.
func (r *positionRingBuffer) trimBefore(cutoff int64) {
	for r.count > 0 && r.buf[r.head].At < cutoff {
		r.head = (r.head + 1) % posRingCap
		r.count--
	}
}

type projectileState struct {
	ID         int
	Type       WeaponID
	OwnerID    int
	Pos        Vec3
	Vel        Vec3
	DetonateAt int64
}

type areaEffectState struct {
	Type      string
	Pos       Vec3
	Radius    float64
	ExpiresAt int64
}

type healthRestorePointJSON struct {
	X           float64 `json:"x"`
	Z           float64 `json:"z"`
	Radius      float64 `json:"radius"`
	HealAmount  int     `json:"healAmount"`
	CooldownSec float64 `json:"cooldownSec"`
}

type healthRestorePointState struct {
	X              float64
	Z              float64
	Radius         float64
	HealAmount     int
	CooldownEndsAt int64
	CooldownMS     int64
}

type healthRestorePointSnapshot struct {
	X                  float64 `json:"x"`
	Z                  float64 `json:"z"`
	Radius             float64 `json:"radius"`
	HealAmount         int     `json:"healAmount"`
	CooldownSec        float64 `json:"cooldownSec"`
	CooldownTimeLeftMS int64   `json:"cooldownTimeLeftMs"`
	Active             bool    `json:"active"`
}

type playerStore struct {
	ids                  []int
	names                []string
	isBot                []bool
	pos                  []Vec3
	yaw                  []float64
	pitch                []float64
	crouching            []bool
	hp                   []int
	armor                []int
	credits              []int
	team                 []TeamID
	pistolWeapon         []WeaponID
	heavyWeapon          []WeaponID
	pistolClip           []int
	pistolReserve        []int
	heavyClip            []int
	heavyReserve         []int
	bombs                []int
	smokes               []int
	flashbangs           []int
	flashEndsAt          []int64
	spawnProtectedUntil  []int64
	loadoutEndsAt        []int64
	activeWeapon         []WeaponID
	reloadWeapon         []WeaponID
	reloadEndsAt         []int64
	nextAttackAt         []int64
	shotBloom            []float64
	bloomWeapon          []WeaponID
	lastShotAt           []int64
	recoilPitch          []float64
	recoilYaw            []float64
	recoilShotIndex      []int
	kills                []int
	deaths               []int
	alive                []bool
	inMatch              []bool
	velY                 []float64
	onGround             []bool
	lastProcessedSeq     []uint16
	inputQueue           [][]InputCommand
	lastAckedSnapshotSeq []uint16
	botNextThink         []int64
	botShotCount         []int64
	conns                []*websocket.Conn
	sendChs              []chan []byte
	history              []positionRingBuffer
	idToIndex            map[int]int
}

type hostageState struct {
	ID         int
	Pos        Vec3
	FollowerID int // player carrying/leading this hostage, 0 = none
	Rescued    bool
	Alive      bool
}

type flagState struct {
	Team      TeamID
	Pos       Vec3
	HomePos   Vec3
	CarrierID int // player carrying this flag, 0 = none
	Dropped   bool
	DroppedAt int64
	AtHome    bool
}

type Game struct {
	mu                     sync.RWMutex
	players                playerStore
	nextID                 int
	mode                   GameMode
	state                  GameState
	currentRound           int
	roundEndsAt            int64
	buyEndsAt              int64
	intermissionEndsAt     int64
	roundWinner            TeamID
	pendingMatchEnd        bool
	blueScore              int
	greenScore             int
	blueLossStreak         int
	greenLossStreak        int
	projectiles            []projectileState
	effects                []areaEffectState
	nextProjID             int
	deathmatchVoteEnds     int64
	deathmatchVotes        map[int]bool
	mapName                string
	mapSpawns              []Vec3
	mapBlueSpawns          []Vec3
	mapGreenSpawns         []Vec3
	mapWallsRuntime        []wallSegment
	mapPlatformsRuntime    []platformEntry
	mapBoxesRuntime        []boxEntry
	mapArenaSize           float64
	mapWallHeight          float64
	mapWallThickness       float64
	mapHealthRestorePoints []healthRestorePointState
	// Hostage rescue state
	mapHostages    []hostageJSON
	mapRescueZones []rescueZoneJSON
	hostages       []hostageState
	nextHostageID  int
	// CTF state
	mapFlagBases     []flagBaseJSON
	flags            [2]flagState // 0=blue flag, 1=green flag
	blueCTFCaptures  int
	greenCTFCaptures int
	snapshotSeq      uint16
	snapshotBuf      snapshotBuffer
}

type hitCandidate struct {
	index     int
	id        int
	zone      HitZone
	dist      float64
	isHostage bool
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

type Lobby struct {
	ID      string
	Name    string
	Private bool
	JoinKey string
	Game    *Game
}

type lobbySummary struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Private     bool     `json:"private"`
	JoinKey     string   `json:"joinKey,omitempty"`
	Mode        GameMode `json:"mode"`
	Map         string   `json:"map"`
	State       string   `json:"state"`
	PlayerCount int      `json:"playerCount"`
	MaxPlayers  int      `json:"maxPlayers"`
}

type LobbyManager struct {
	mu      sync.RWMutex
	lobbies map[string]*Lobby
	keys    map[string]string
	nextID  int
}

var defaultSpawns = []Vec3{
	{-25, standEyeHeight, -25},
	{25, standEyeHeight, -25},
	{25, standEyeHeight, 25},
	{-25, standEyeHeight, 25},
	{0, standEyeHeight, -12},
	{0, standEyeHeight, 12},
}

const defaultMapName = "office_studio"

func newGame() *Game {
	g := &Game{
		players:                newPlayerStore(),
		nextID:                 1,
		mode:                   ModeTeam,
		state:                  StateWaiting,
		deathmatchVotes:        make(map[int]bool),
		mapName:                defaultMapName,
		mapSpawns:              defaultSpawns,
		mapBlueSpawns:          []Vec3{{-25, standEyeHeight, -25}, {-25, standEyeHeight, 25}},
		mapGreenSpawns:         []Vec3{{25, standEyeHeight, -25}, {25, standEyeHeight, 25}, {0, standEyeHeight, -12}, {0, standEyeHeight, 12}},
		mapWallsRuntime:        mapWalls,
		mapPlatformsRuntime:    nil,
		mapArenaSize:           arenaSize,
		mapWallHeight:          5.0,
		mapWallThickness:       wallThick,
		mapHealthRestorePoints: nil,
	}

	if result, err := loadMapFull(resolveClientDir(), defaultMapName); err == nil {
		g.mapSpawns = result.spawns
		g.mapBlueSpawns = append([]Vec3(nil), result.blueSpawns...)
		g.mapGreenSpawns = append([]Vec3(nil), result.greenSpawns...)
		g.mapWallsRuntime = result.walls
		g.mapPlatformsRuntime = append([]platformEntry(nil), result.platforms...)
		g.mapBoxesRuntime = result.boxes
		g.mapArenaSize = result.arena
		g.mapWallHeight = result.wallHeight
		g.mapWallThickness = result.wallThick
		g.mapHealthRestorePoints = append([]healthRestorePointState(nil), result.healthRestorePoints...)
		g.mapHostages = append([]hostageJSON(nil), result.hostages...)
		g.mapRescueZones = append([]rescueZoneJSON(nil), result.rescueZones...)
		g.mapFlagBases = append([]flagBaseJSON(nil), result.flagBases...)
	}

	return g
}

func newLobbyManager() *LobbyManager {
	return &LobbyManager{
		lobbies: make(map[string]*Lobby),
		keys:    make(map[string]string),
		nextID:  1,
	}
}

var lobbyManager = newLobbyManager()
var game = newGame()

func (m *LobbyManager) createLobby(name string, private bool) *Lobby {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := fmt.Sprintf("lobby-%d", m.nextID)
	m.nextID++
	if strings.TrimSpace(name) == "" {
		name = fmt.Sprintf("Lobby %d", m.nextID-1)
	}

	lobby := &Lobby{
		ID:      id,
		Name:    strings.TrimSpace(name),
		Private: private,
		Game:    newGame(),
	}
	if private {
		lobby.JoinKey = m.generateJoinKeyLocked()
		m.keys[lobby.JoinKey] = lobby.ID
	}
	m.lobbies[lobby.ID] = lobby
	return lobby
}

func (m *LobbyManager) generateJoinKeyLocked() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for {
		var builder strings.Builder
		for i := 0; i < 6; i++ {
			builder.WriteByte(alphabet[rand.Intn(len(alphabet))])
		}
		key := builder.String()
		if _, exists := m.keys[key]; !exists {
			return key
		}
	}
}

func (m *LobbyManager) getLobby(id string) (*Lobby, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	lobby, ok := m.lobbies[id]
	return lobby, ok
}

func (m *LobbyManager) findLobbyByKey(key string) (*Lobby, bool) {
	key = strings.ToUpper(strings.TrimSpace(key))
	if key == "" {
		return nil, false
	}

	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.keys[key]
	if !ok {
		return nil, false
	}
	lobby, ok := m.lobbies[id]
	return lobby, ok
}

func (m *LobbyManager) listPublicLobbies() []lobbySummary {
	m.mu.RLock()
	lobbies := make([]*Lobby, 0, len(m.lobbies))
	for _, lobby := range m.lobbies {
		if !lobby.Private {
			lobbies = append(lobbies, lobby)
		}
	}
	m.mu.RUnlock()

	sort.Slice(lobbies, func(i, j int) bool {
		return lobbies[i].ID < lobbies[j].ID
	})

	summaries := make([]lobbySummary, 0, len(lobbies))
	for _, lobby := range lobbies {
		summaries = append(summaries, lobby.summary())
	}
	return summaries
}

func (m *LobbyManager) removeLobbyIfEmpty(id string) {
	if strings.TrimSpace(id) == "" {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	lobby, ok := m.lobbies[id]
	if !ok {
		return
	}
	if lobby.Game.playerCount() > 0 {
		return
	}
	delete(m.lobbies, id)
	if lobby.JoinKey != "" {
		delete(m.keys, lobby.JoinKey)
	}
}

func (m *LobbyManager) tickAll(nowMS int64) {
	m.mu.RLock()
	lobbies := make([]*Lobby, 0, len(m.lobbies))
	for _, lobby := range m.lobbies {
		lobbies = append(lobbies, lobby)
	}
	m.mu.RUnlock()

	for _, lobby := range lobbies {
		lobby.Game.tick(nowMS)
	}
}

func (l *Lobby) summary() lobbySummary {
	l.Game.mu.RLock()
	defer l.Game.mu.RUnlock()

	return lobbySummary{
		ID:          l.ID,
		Name:        l.Name,
		Private:     l.Private,
		JoinKey:     l.JoinKey,
		Mode:        normalizeMode(l.Game.mode),
		Map:         l.Game.mapName,
		State:       gameStateName(l.Game.state),
		PlayerCount: l.Game.humanCountLocked(),
		MaxPlayers:  maxPlayers,
	}
}

type mapJSON struct {
	Arena               float64                  `json:"arena"`
	WallHeight          float64                  `json:"wallHeight"`
	WallThick           float64                  `json:"wallThick"`
	Walls               []wallEntry              `json:"walls"`
	FloorInsets         []floorEntry             `json:"floorInsets"`
	Platforms           []platformEntry          `json:"platforms"`
	Boxes               []boxEntry               `json:"boxes"`
	SpawnPoints         [][]float64              `json:"spawnPoints"`
	BlueSpawns          [][]float64              `json:"blueSpawns"`
	GreenSpawns         [][]float64              `json:"greenSpawns"`
	HealthRestorePoints []healthRestorePointJSON `json:"healthRestorePoints"`
	Hostages            []hostageJSON            `json:"hostages"`
	RescueZones         []rescueZoneJSON         `json:"rescueZones"`
	FlagBases           []flagBaseJSON           `json:"flagBases"`
}

type hostageJSON struct {
	X float64 `json:"x"`
	Z float64 `json:"z"`
}

type rescueZoneJSON struct {
	Cx     float64 `json:"cx"`
	Cz     float64 `json:"cz"`
	Radius float64 `json:"radius"`
}

type flagBaseJSON struct {
	Team string  `json:"team"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

type wallEntry struct {
	X1     float64 `json:"x1"`
	Z1     float64 `json:"z1"`
	X2     float64 `json:"x2"`
	Z2     float64 `json:"z2"`
	MatID  int     `json:"matID"`
	Height float64 `json:"height,omitempty"`
}

type floorEntry struct {
	X1    float64 `json:"x1"`
	Z1    float64 `json:"z1"`
	X2    float64 `json:"x2"`
	Z2    float64 `json:"z2"`
	MatID int     `json:"matID"`
}

type platformEntry struct {
	X1        float64 `json:"x1"`
	Z1        float64 `json:"z1"`
	X2        float64 `json:"x2"`
	Z2        float64 `json:"z2"`
	Y         float64 `json:"y"`
	Thickness float64 `json:"thickness"`
	MatID     int     `json:"matID"`
}

type boxEntry struct {
	Cx    float64 `json:"cx"`
	Cy    float64 `json:"cy"`
	Cz    float64 `json:"cz"`
	Hx    float64 `json:"hx"`
	Hy    float64 `json:"hy"`
	Hz    float64 `json:"hz"`
	MatID int     `json:"matID"`
}

type mapLoadResult struct {
	spawns              []Vec3
	blueSpawns          []Vec3
	greenSpawns         []Vec3
	walls               []wallSegment
	platforms           []platformEntry
	boxes               []boxEntry
	arena               float64
	wallHeight          float64
	wallThick           float64
	healthRestorePoints []healthRestorePointState
	hostages            []hostageJSON
	rescueZones         []rescueZoneJSON
	flagBases           []flagBaseJSON
}

func normalizePlatforms(raw []platformEntry) []platformEntry {
	platforms := make([]platformEntry, 0, len(raw))
	for _, platform := range raw {
		if platform.Thickness <= 0 {
			platform.Thickness = 0.35
		}
		platforms = append(platforms, platform)
	}
	return platforms
}

func loadMapGeometry(clientDir, name string) ([]Vec3, []wallSegment, []platformEntry, []boxEntry, float64, float64, float64, error) {
	result, err := loadMapFull(clientDir, name)
	if err != nil {
		return nil, nil, nil, nil, 0, 0, 0, err
	}
	return result.spawns, result.walls, result.platforms, result.boxes, result.arena, result.wallHeight, result.wallThick, nil
}

func parseSpawnList(raw [][]float64) []Vec3 {
	spawns := make([]Vec3, 0, len(raw))
	for _, sp := range raw {
		if len(sp) >= 3 {
			spawns = append(spawns, Vec3{sp[0], sp[1], sp[2]})
		}
	}
	return spawns
}

func parseHealthRestorePoints(raw []healthRestorePointJSON) []healthRestorePointState {
	points := make([]healthRestorePointState, 0, len(raw))
	for _, point := range raw {
		radius := point.Radius
		if radius <= 0 {
			radius = 1.5
		}
		healAmount := point.HealAmount
		if healAmount <= 0 {
			healAmount = 35
		}
		cooldownSec := point.CooldownSec
		if cooldownSec <= 0 {
			cooldownSec = 12
		}
		points = append(points, healthRestorePointState{
			X:          point.X,
			Z:          point.Z,
			Radius:     radius,
			HealAmount: healAmount,
			CooldownMS: int64(math.Round(cooldownSec * 1000)),
		})
	}
	return points
}

func loadMapFull(clientDir, name string) (mapLoadResult, error) {
	path := filepath.Join(clientDir, "maps", name+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return mapLoadResult{}, err
	}
	var m mapJSON
	if err := json.Unmarshal(data, &m); err != nil {
		return mapLoadResult{}, err
	}

	arena := m.Arena
	if arena == 0 {
		arena = 30
	}
	wHeight := m.WallHeight
	if wHeight == 0 {
		wHeight = 5
	}
	wThick := m.WallThick
	if wThick == 0 {
		wThick = 0.3
	}

	walls := make([]wallSegment, 0, len(m.Walls))
	for _, w := range m.Walls {
		walls = append(walls, wallSegment{x1: w.X1, z1: w.Z1, x2: w.X2, z2: w.Z2})
	}

	spawns := parseSpawnList(m.SpawnPoints)
	if len(spawns) == 0 {
		return mapLoadResult{}, fmt.Errorf("no spawn points in map %s", name)
	}
	blueSpawns := parseSpawnList(m.BlueSpawns)
	greenSpawns := parseSpawnList(m.GreenSpawns)

	return mapLoadResult{
		spawns:              spawns,
		blueSpawns:          blueSpawns,
		greenSpawns:         greenSpawns,
		walls:               walls,
		platforms:           normalizePlatforms(m.Platforms),
		boxes:               m.Boxes,
		arena:               arena,
		wallHeight:          wHeight,
		wallThick:           wThick,
		healthRestorePoints: parseHealthRestorePoints(m.HealthRestorePoints),
		hostages:            m.Hostages,
		rescueZones:         m.RescueZones,
		flagBases:           m.FlagBases,
	}, nil
}

func listMaps(clientDir string) []string {
	pattern := filepath.Join(clientDir, "maps", "*.json")
	matches, _ := filepath.Glob(pattern)
	names := make([]string, 0, len(matches))
	for _, m := range matches {
		base := filepath.Base(m)
		names = append(names, strings.TrimSuffix(base, ".json"))
	}
	return names
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

func (ps *playerStore) add(id int, conn *websocket.Conn, spawn Vec3, nowMS int64, isBot bool) chan []byte {
	var sendCh chan []byte
	if !isBot {
		sendCh = make(chan []byte, 64)
	}
	idx := len(ps.ids)

	ps.ids = append(ps.ids, id)
	ps.names = append(ps.names, "")
	ps.isBot = append(ps.isBot, isBot)
	ps.pos = append(ps.pos, spawn)
	ps.yaw = append(ps.yaw, 0)
	ps.pitch = append(ps.pitch, 0)
	ps.crouching = append(ps.crouching, false)
	ps.hp = append(ps.hp, maxHP)
	ps.armor = append(ps.armor, 0)
	ps.credits = append(ps.credits, startingCredits)
	ps.team = append(ps.team, TeamNone)
	ps.pistolWeapon = append(ps.pistolWeapon, "")
	ps.heavyWeapon = append(ps.heavyWeapon, "")
	ps.pistolClip = append(ps.pistolClip, 0)
	ps.pistolReserve = append(ps.pistolReserve, 0)
	ps.heavyClip = append(ps.heavyClip, 0)
	ps.heavyReserve = append(ps.heavyReserve, 0)
	ps.bombs = append(ps.bombs, 0)
	ps.smokes = append(ps.smokes, 0)
	ps.flashbangs = append(ps.flashbangs, 0)
	ps.flashEndsAt = append(ps.flashEndsAt, 0)
	ps.spawnProtectedUntil = append(ps.spawnProtectedUntil, 0)
	ps.loadoutEndsAt = append(ps.loadoutEndsAt, 0)
	ps.activeWeapon = append(ps.activeWeapon, WeaponKnife)
	ps.reloadWeapon = append(ps.reloadWeapon, WeaponKnife)
	ps.reloadEndsAt = append(ps.reloadEndsAt, 0)
	ps.nextAttackAt = append(ps.nextAttackAt, 0)
	ps.shotBloom = append(ps.shotBloom, 0)
	ps.bloomWeapon = append(ps.bloomWeapon, WeaponKnife)
	ps.lastShotAt = append(ps.lastShotAt, 0)
	ps.recoilPitch = append(ps.recoilPitch, 0)
	ps.recoilYaw = append(ps.recoilYaw, 0)
	ps.recoilShotIndex = append(ps.recoilShotIndex, 0)
	ps.kills = append(ps.kills, 0)
	ps.deaths = append(ps.deaths, 0)
	ps.alive = append(ps.alive, true)
	ps.inMatch = append(ps.inMatch, true)
	ps.velY = append(ps.velY, 0)
	ps.onGround = append(ps.onGround, true)
	ps.lastProcessedSeq = append(ps.lastProcessedSeq, 0)
	ps.inputQueue = append(ps.inputQueue, nil)
	ps.lastAckedSnapshotSeq = append(ps.lastAckedSnapshotSeq, 0)
	ps.botNextThink = append(ps.botNextThink, 0)
	ps.botShotCount = append(ps.botShotCount, 0)
	ps.conns = append(ps.conns, conn)
	ps.sendChs = append(ps.sendChs, sendCh)
	var rb positionRingBuffer
	rb.add(positionSample{At: nowMS, Pos: spawn, Crouching: false})
	ps.history = append(ps.history, rb)
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
		ps.isBot[idx] = ps.isBot[last]
		ps.pos[idx] = ps.pos[last]
		ps.yaw[idx] = ps.yaw[last]
		ps.pitch[idx] = ps.pitch[last]
		ps.crouching[idx] = ps.crouching[last]
		ps.hp[idx] = ps.hp[last]
		ps.armor[idx] = ps.armor[last]
		ps.credits[idx] = ps.credits[last]
		ps.team[idx] = ps.team[last]
		ps.pistolWeapon[idx] = ps.pistolWeapon[last]
		ps.heavyWeapon[idx] = ps.heavyWeapon[last]
		ps.pistolClip[idx] = ps.pistolClip[last]
		ps.pistolReserve[idx] = ps.pistolReserve[last]
		ps.heavyClip[idx] = ps.heavyClip[last]
		ps.heavyReserve[idx] = ps.heavyReserve[last]
		ps.bombs[idx] = ps.bombs[last]
		ps.smokes[idx] = ps.smokes[last]
		ps.flashbangs[idx] = ps.flashbangs[last]
		ps.flashEndsAt[idx] = ps.flashEndsAt[last]
		ps.spawnProtectedUntil[idx] = ps.spawnProtectedUntil[last]
		ps.loadoutEndsAt[idx] = ps.loadoutEndsAt[last]
		ps.activeWeapon[idx] = ps.activeWeapon[last]
		ps.reloadWeapon[idx] = ps.reloadWeapon[last]
		ps.reloadEndsAt[idx] = ps.reloadEndsAt[last]
		ps.nextAttackAt[idx] = ps.nextAttackAt[last]
		ps.shotBloom[idx] = ps.shotBloom[last]
		ps.bloomWeapon[idx] = ps.bloomWeapon[last]
		ps.lastShotAt[idx] = ps.lastShotAt[last]
		ps.recoilPitch[idx] = ps.recoilPitch[last]
		ps.recoilYaw[idx] = ps.recoilYaw[last]
		ps.recoilShotIndex[idx] = ps.recoilShotIndex[last]
		ps.kills[idx] = ps.kills[last]
		ps.deaths[idx] = ps.deaths[last]
		ps.alive[idx] = ps.alive[last]
		ps.inMatch[idx] = ps.inMatch[last]
		ps.velY[idx] = ps.velY[last]
		ps.onGround[idx] = ps.onGround[last]
		ps.lastProcessedSeq[idx] = ps.lastProcessedSeq[last]
		ps.inputQueue[idx] = ps.inputQueue[last]
		ps.lastAckedSnapshotSeq[idx] = ps.lastAckedSnapshotSeq[last]
		ps.botNextThink[idx] = ps.botNextThink[last]
		ps.botShotCount[idx] = ps.botShotCount[last]
		ps.conns[idx] = ps.conns[last]
		ps.sendChs[idx] = ps.sendChs[last]
		ps.history[idx] = ps.history[last]
		ps.idToIndex[movedID] = idx
	}

	ps.ids = ps.ids[:last]
	ps.names = ps.names[:last]
	ps.isBot = ps.isBot[:last]
	ps.pos = ps.pos[:last]
	ps.yaw = ps.yaw[:last]
	ps.pitch = ps.pitch[:last]
	ps.crouching = ps.crouching[:last]
	ps.hp = ps.hp[:last]
	ps.armor = ps.armor[:last]
	ps.credits = ps.credits[:last]
	ps.team = ps.team[:last]
	ps.pistolWeapon = ps.pistolWeapon[:last]
	ps.heavyWeapon = ps.heavyWeapon[:last]
	ps.pistolClip = ps.pistolClip[:last]
	ps.pistolReserve = ps.pistolReserve[:last]
	ps.heavyClip = ps.heavyClip[:last]
	ps.heavyReserve = ps.heavyReserve[:last]
	ps.bombs = ps.bombs[:last]
	ps.smokes = ps.smokes[:last]
	ps.flashbangs = ps.flashbangs[:last]
	ps.flashEndsAt = ps.flashEndsAt[:last]
	ps.spawnProtectedUntil = ps.spawnProtectedUntil[:last]
	ps.loadoutEndsAt = ps.loadoutEndsAt[:last]
	ps.activeWeapon = ps.activeWeapon[:last]
	ps.reloadWeapon = ps.reloadWeapon[:last]
	ps.reloadEndsAt = ps.reloadEndsAt[:last]
	ps.nextAttackAt = ps.nextAttackAt[:last]
	ps.shotBloom = ps.shotBloom[:last]
	ps.bloomWeapon = ps.bloomWeapon[:last]
	ps.lastShotAt = ps.lastShotAt[:last]
	ps.recoilPitch = ps.recoilPitch[:last]
	ps.recoilYaw = ps.recoilYaw[:last]
	ps.recoilShotIndex = ps.recoilShotIndex[:last]
	ps.kills = ps.kills[:last]
	ps.deaths = ps.deaths[:last]
	ps.alive = ps.alive[:last]
	ps.inMatch = ps.inMatch[:last]
	ps.velY = ps.velY[:last]
	ps.onGround = ps.onGround[:last]
	ps.lastProcessedSeq = ps.lastProcessedSeq[:last]
	ps.inputQueue = ps.inputQueue[:last]
	ps.lastAckedSnapshotSeq = ps.lastAckedSnapshotSeq[:last]
	ps.botNextThink = ps.botNextThink[:last]
	ps.botShotCount = ps.botShotCount[:last]
	ps.conns = ps.conns[:last]
	ps.sendChs = ps.sendChs[:last]
	ps.history = ps.history[:last]
	delete(ps.idToIndex, removedID)
}

func (g *Game) addPlayer(conn *websocket.Conn) (int, chan []byte, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.humanCountLocked() >= maxPlayers {
		return 0, nil, false
	}

	id := g.nextID
	g.nextID++

	spawn := g.mapSpawns[rand.Intn(len(g.mapSpawns))]
	sendCh := g.players.add(id, conn, spawn, time.Now().UnixMilli(), false)
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
	nowMS := time.Now().UnixMilli()
	g.syncModeBotsLocked(nowMS)
	if g.humanCountLocked() == 0 {
		g.mode = ModeTeam
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
		g.deathmatchVoteEnds = 0
		clear(g.deathmatchVotes)
	}
}

func (g *Game) playerCount() int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return len(g.players.ids)
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
		ID      int    `json:"id"`
		Name    string `json:"name"`
		Team    TeamID `json:"team"`
		Kills   int    `json:"kills"`
		Deaths  int    `json:"deaths"`
		IsBot   bool   `json:"isBot"`
		InMatch bool   `json:"inMatch"`
	}

	players := make([]LobbyPlayer, 0, len(g.players.ids))
	for i, id := range g.players.ids {
		if g.players.names[i] != "" {
			players = append(players, LobbyPlayer{
				ID:      id,
				Name:    g.players.names[i],
				Team:    g.players.team[i],
				Kills:   g.players.kills[i],
				Deaths:  g.players.deaths[i],
				IsBot:   g.players.isBot[i],
				InMatch: g.players.inMatch[i],
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

type hostageSnapshot struct {
	ID         int  `json:"id"`
	Pos        Vec3 `json:"pos"`
	FollowerID int  `json:"followerId"`
	Rescued    bool `json:"rescued"`
	Alive      bool `json:"alive"`
}

type flagSnapshot struct {
	Team      TeamID `json:"team"`
	Pos       Vec3   `json:"pos"`
	HomePos   Vec3   `json:"homePos"`
	CarrierID int    `json:"carrierId"`
	Dropped   bool   `json:"dropped"`
	AtHome    bool   `json:"atHome"`
}

type matchState struct {
	Mode                 GameMode                     `json:"mode"`
	Map                  string                       `json:"map"`
	CurrentRound         int                          `json:"currentRound"`
	TotalRounds          int                          `json:"totalRounds"`
	RoundTimeLeft        int64                        `json:"roundTimeLeftMs"`
	BuyTimeLeft          int64                        `json:"buyTimeLeftMs"`
	BuyPhase             bool                         `json:"buyPhase"`
	Intermission         bool                         `json:"intermission"`
	IntermissionTimeLeft int64                        `json:"intermissionTimeLeftMs"`
	RoundWinner          TeamID                       `json:"roundWinner"`
	BlueScore            int                          `json:"blueScore"`
	GreenScore           int                          `json:"greenScore"`
	BlueAlive            int                          `json:"blueAlive"`
	GreenAlive           int                          `json:"greenAlive"`
	DeathmatchVoteActive bool                         `json:"deathmatchVoteActive"`
	DeathmatchVoteTimeMS int64                        `json:"deathmatchVoteTimeLeftMs"`
	Hostages             []hostageSnapshot            `json:"hostages,omitempty"`
	Flags                []flagSnapshot               `json:"flags,omitempty"`
	BlueCTFCaptures      int                          `json:"blueCTFCaptures,omitempty"`
	GreenCTFCaptures     int                          `json:"greenCTFCaptures,omitempty"`
	RescueZones          []rescueZoneJSON             `json:"rescueZones,omitempty"`
	HealthRestorePoints  []healthRestorePointSnapshot `json:"healthRestorePoints,omitempty"`
}

type playerState struct {
	Pos                       Vec3     `json:"pos"`
	Yaw                       float64  `json:"yaw"`
	Pitch                     float64  `json:"pitch"`
	Crouching                 bool     `json:"crouching"`
	Hp                        int      `json:"hp"`
	Armor                     int      `json:"armor"`
	Credits                   int      `json:"credits"`
	Name                      string   `json:"name"`
	Team                      TeamID   `json:"team"`
	Kills                     int      `json:"kills"`
	Deaths                    int      `json:"deaths"`
	Alive                     bool     `json:"alive"`
	InMatch                   bool     `json:"inMatch"`
	IsBot                     bool     `json:"isBot"`
	PistolWeapon              WeaponID `json:"pistolWeapon"`
	PistolClip                int      `json:"pistolClip"`
	PistolReserve             int      `json:"pistolReserve"`
	HeavyWeapon               WeaponID `json:"heavyWeapon"`
	HeavyClip                 int      `json:"heavyClip"`
	HeavyReserve              int      `json:"heavyReserve"`
	Bombs                     int      `json:"bombs"`
	Smokes                    int      `json:"smokes"`
	Flashbangs                int      `json:"flashbangs"`
	FlashTimeLeftMS           int64    `json:"flashTimeLeftMs"`
	SpawnProtectionTimeLeftMS int64    `json:"spawnProtectionTimeLeftMs"`
	LoadoutTimeLeftMS         int64    `json:"loadoutTimeLeftMs"`
	ActiveWeapon              WeaponID `json:"activeWeapon"`
	Reloading                 bool     `json:"reloading"`
	ReloadTimeLeftMS          int64    `json:"reloadTimeLeftMs"`
}

type economyUpdate struct {
	T                         string   `json:"t"`
	PlayerID                  int      `json:"id"`
	OK                        bool     `json:"ok"`
	Kind                      string   `json:"kind"`
	Item                      string   `json:"item,omitempty"`
	Label                     string   `json:"label,omitempty"`
	Reason                    string   `json:"reason,omitempty"`
	Amount                    int      `json:"amount,omitempty"`
	Crouching                 bool     `json:"crouching"`
	Hp                        int      `json:"hp"`
	Armor                     int      `json:"armor"`
	Credits                   int      `json:"credits"`
	Team                      TeamID   `json:"team"`
	PistolWeapon              WeaponID `json:"pistolWeapon"`
	PistolClip                int      `json:"pistolClip"`
	PistolReserve             int      `json:"pistolReserve"`
	HeavyWeapon               WeaponID `json:"heavyWeapon"`
	HeavyClip                 int      `json:"heavyClip"`
	HeavyReserve              int      `json:"heavyReserve"`
	Bombs                     int      `json:"bombs"`
	Smokes                    int      `json:"smokes"`
	Flashbangs                int      `json:"flashbangs"`
	FlashTimeLeftMS           int64    `json:"flashTimeLeftMs"`
	SpawnProtectionTimeLeftMS int64    `json:"spawnProtectionTimeLeftMs"`
	LoadoutTimeLeftMS         int64    `json:"loadoutTimeLeftMs"`
	ActiveWeapon              WeaponID `json:"activeWeapon"`
	Reloading                 bool     `json:"reloading"`
	ReloadTimeLeftMS          int64    `json:"reloadTimeLeftMs"`
}

type chatMessage struct {
	T    string `json:"t"`
	ID   int    `json:"id"`
	Name string `json:"name"`
	Text string `json:"text"`
}

type weaponConfig struct {
	ID                  WeaponID
	Label               string
	Range               float64
	FireIntervalMS      int64
	BodyDamage          int
	HeadDamage          int
	UsesAmmo            bool
	HipSpread           float64
	AimSpread           float64
	BloomPerShot        float64
	MaxBloom            float64
	BloomDecayMS        float64
	RecoilTable         [][2]float64
	RecoveryThresholdMS int64
	PunchDecayExp       float64
	PunchDecayLin       float64
}

type weaponRecoilBase struct {
	pitch float64
	yaw   float64
}

var recoilCategoryBase = map[string]weaponRecoilBase{
	"pistol":     {pitch: 0.088, yaw: 0.014},
	"smg":        {pitch: 0.074, yaw: 0.018},
	"rifle":      {pitch: 0.084, yaw: 0.016},
	"sniper":     {pitch: 0.104, yaw: 0.008},
	"shotgun":    {pitch: 0.096, yaw: 0.015},
	"machinegun": {pitch: 0.081, yaw: 0.022},
}

var weaponRecoilTableCache sync.Map

func clampFloat64(value, min, max float64) float64 {
	return math.Min(max, math.Max(min, value))
}

func hashWeaponID(id WeaponID) uint32 {
	hash := uint32(2166136261)
	for i := 0; i < len(id); i++ {
		hash ^= uint32(id[i])
		hash *= 16777619
	}
	return hash
}

func recoilCategoryForEntry(entry WeaponCatalogEntry) string {
	if _, ok := recoilCategoryBase[entry.Category]; ok {
		return entry.Category
	}
	if entry.Slot == "pistol" {
		return "pistol"
	}
	return "rifle"
}

func buildWeaponRecoilPattern(entry WeaponCatalogEntry) [][2]float64 {
	category := recoilCategoryForEntry(entry)
	base := recoilCategoryBase[category]
	shotCountByCategory := map[string]int{
		"pistol":     12,
		"smg":        22,
		"rifle":      24,
		"sniper":     14,
		"shotgun":    10,
		"machinegun": 30,
	}
	shotCount := shotCountByCategory[category]
	hash := hashWeaponID(WeaponID(entry.ID))
	cadenceScale := clampFloat64(130.0/math.Max(55, float64(entry.FireIntervalMS)), 0.7, 2.2)
	damageScale := clampFloat64(0.82+float64(entry.BaseDamage)/70.0, 0.82, 2.05)
	magScale := clampFloat64(1.1-math.Min(float64(entry.MagSize), 80.0)/180.0, 0.68, 1.12)
	zoomScale := 1.0
	if len(entry.ZoomLevels) > 0 {
		zoomScale = 0.9
	}
	specialScale := 1.0
	switch entry.SecondaryMode {
	case "revolver":
		specialScale = 1.25
	case "auto":
		specialScale = 0.9
	}
	pitchScale := cadenceScale * damageScale * magScale * zoomScale * specialScale
	yawScale := clampFloat64(0.85+float64((hash>>3)%11)/18.0, 0.8, 1.45)
	driftSign := 1.0
	if ((hash >> 9) & 1) == 0 {
		driftSign = -1.0
	}
	driftBase := ((float64(hash%17) - 8.0) / 1200.0) * driftSign

	pattern := make([][2]float64, 0, shotCount)
	for i := 0; i < shotCount; i++ {
		t := 0.0
		if shotCount > 1 {
			t = float64(i) / float64(shotCount-1)
		}
		spiral := math.Sin(float64(i+1)*0.82 + float64(hash)*0.0009)
		weave := math.Cos(float64(i+1)*0.46 + float64(hash)*0.0017)
		stairDir := 1.0
		if (i/2)%2 != 0 {
			stairDir = -1.0
		}
		stairDir *= driftSign

		pitch := base.pitch * pitchScale * (0.6 + t*1.05)
		if category == "machinegun" {
			pitch = base.pitch * pitchScale * (0.6 + t*1.3)
		}
		yaw := base.yaw*yawScale*((spiral*0.55)+(stairDir*(0.28+t*0.48))+(weave*0.12)) + driftBase*(1+t*4)

		switch category {
		case "sniper":
			pitch *= 0.85 + t*0.55
			yaw *= 0.65
		case "shotgun":
			pitch *= 1.08
			yaw *= 0.5
		case "pistol":
			pitch *= 1.05 + t*0.15
			yaw *= 0.75
		}

		pattern = append(pattern, [2]float64{pitch, yaw})
	}
	return pattern
}

func recoilTableForEntry(id WeaponID, entry WeaponCatalogEntry) [][2]float64 {
	if cached, ok := weaponRecoilTableCache.Load(id); ok {
		return cached.([][2]float64)
	}
	table := buildWeaponRecoilPattern(entry)
	weaponRecoilTableCache.Store(id, table)
	return table
}

func (g *Game) buildMatchStateLocked(nowMS int64) matchState {
	buyTimeLeft := int64(0)
	roundTimeLeft := int64(0)
	intermissionTimeLeft := int64(0)
	deathmatchVoteTimeLeft := int64(0)
	intermission := g.state == StatePlaying && g.intermissionEndsAt > nowMS
	if g.deathmatchVoteEnds > nowMS {
		deathmatchVoteTimeLeft = g.deathmatchVoteEnds - nowMS
	}
	if intermission {
		intermissionTimeLeft = g.intermissionEndsAt - nowMS
	} else if g.state == StatePlaying && g.buyEndsAt > nowMS {
		buyTimeLeft = g.buyEndsAt - nowMS
	}

	if !intermission && g.state == StatePlaying && g.roundEndsAt > nowMS {
		roundTimeLeft = g.roundEndsAt - nowMS
	}

	blueAlive, greenAlive := g.aliveCountsLocked()

	// Build hostage snapshots
	var hostageSnaps []hostageSnapshot
	if normalizeMode(g.mode) == ModeHostage && len(g.hostages) > 0 {
		hostageSnaps = make([]hostageSnapshot, 0, len(g.hostages))
		for _, h := range g.hostages {
			hostageSnaps = append(hostageSnaps, hostageSnapshot{
				ID: h.ID, Pos: h.Pos, FollowerID: h.FollowerID,
				Rescued: h.Rescued, Alive: h.Alive,
			})
		}
	}

	// Build flag snapshots
	var flagSnaps []flagSnapshot
	if normalizeMode(g.mode) == ModeCTF {
		flagSnaps = make([]flagSnapshot, 0, 2)
		for _, f := range g.flags {
			if f.Team == TeamNone {
				continue
			}
			flagSnaps = append(flagSnaps, flagSnapshot{
				Team: f.Team, Pos: f.Pos, HomePos: f.HomePos, CarrierID: f.CarrierID,
				Dropped: f.Dropped, AtHome: f.AtHome,
			})
		}
	}

	var rescueZones []rescueZoneJSON
	if normalizeMode(g.mode) == ModeHostage {
		rescueZones = g.mapRescueZones
	}

	var healthRestorePoints []healthRestorePointSnapshot
	if normalizeMode(g.mode) == ModeDeathmatch && len(g.mapHealthRestorePoints) > 0 {
		healthRestorePoints = make([]healthRestorePointSnapshot, 0, len(g.mapHealthRestorePoints))
		for _, point := range g.mapHealthRestorePoints {
			cooldownLeft := point.CooldownEndsAt - nowMS
			if cooldownLeft < 0 {
				cooldownLeft = 0
			}
			healthRestorePoints = append(healthRestorePoints, healthRestorePointSnapshot{
				X:                  point.X,
				Z:                  point.Z,
				Radius:             point.Radius,
				HealAmount:         point.HealAmount,
				CooldownSec:        float64(point.CooldownMS) / 1000,
				CooldownTimeLeftMS: cooldownLeft,
				Active:             cooldownLeft == 0,
			})
		}
	}

	return matchState{
		Mode:                 normalizeMode(g.mode),
		Map:                  g.mapName,
		CurrentRound:         g.currentRound,
		TotalRounds:          g.totalRoundsLocked(),
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
		DeathmatchVoteActive: g.deathmatchVoteEnds > nowMS,
		DeathmatchVoteTimeMS: deathmatchVoteTimeLeft,
		Hostages:             hostageSnaps,
		Flags:                flagSnaps,
		BlueCTFCaptures:      g.blueCTFCaptures,
		GreenCTFCaptures:     g.greenCTFCaptures,
		RescueZones:          rescueZones,
		HealthRestorePoints:  healthRestorePoints,
	}
}

func (g *Game) resetHealthRestorePointsLocked() {
	for i := range g.mapHealthRestorePoints {
		g.mapHealthRestorePoints[i].CooldownEndsAt = 0
	}
}

func (g *Game) tickHealthRestorePointsLocked(nowMS int64) {
	if normalizeMode(g.mode) != ModeDeathmatch || len(g.mapHealthRestorePoints) == 0 {
		return
	}

	for pointIdx := range g.mapHealthRestorePoints {
		point := &g.mapHealthRestorePoints[pointIdx]
		if point.CooldownEndsAt > nowMS {
			continue
		}
		radiusSq := point.Radius * point.Radius
		for idx := range g.players.ids {
			if !g.players.alive[idx] || !g.players.inMatch[idx] || g.players.hp[idx] >= maxHP {
				continue
			}
			dx := g.players.pos[idx][0] - point.X
			dz := g.players.pos[idx][2] - point.Z
			if dx*dx+dz*dz > radiusSq {
				continue
			}
			g.players.hp[idx] = min(maxHP, g.players.hp[idx]+point.HealAmount)
			point.CooldownEndsAt = nowMS + point.CooldownMS
			break
		}
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

func (g *Game) spawnProtectionTimeLeftLocked(idx int, nowMS int64) int64 {
	if idx < 0 || idx >= len(g.players.spawnProtectedUntil) {
		return 0
	}
	if g.players.spawnProtectedUntil[idx] <= nowMS {
		return 0
	}
	return g.players.spawnProtectedUntil[idx] - nowMS
}

func (g *Game) loadoutTimeLeftLocked(idx int, nowMS int64) int64 {
	if idx < 0 || idx >= len(g.players.loadoutEndsAt) {
		return 0
	}
	if g.players.loadoutEndsAt[idx] <= nowMS {
		return 0
	}
	return g.players.loadoutEndsAt[idx] - nowMS
}

func (g *Game) clearDeathmatchSpawnStateLocked(idx int) {
	g.players.spawnProtectedUntil[idx] = 0
	g.players.loadoutEndsAt[idx] = 0
}

func (g *Game) isDeathmatchLoadoutActiveLocked(idx int, nowMS int64) bool {
	return normalizeMode(g.mode) == ModeDeathmatch && g.loadoutTimeLeftLocked(idx, nowMS) > 0
}

func (g *Game) hasSpawnProtectionLocked(idx int, nowMS int64) bool {
	return normalizeMode(g.mode) == ModeDeathmatch && g.spawnProtectionTimeLeftLocked(idx, nowMS) > 0
}

func (g *Game) clearReloadLocked(idx int) {
	g.players.reloadEndsAt[idx] = 0
	g.players.reloadWeapon[idx] = WeaponKnife
}

func (g *Game) buildPlayerStateLocked(idx int, nowMS int64) playerState {
	return playerState{
		Pos:                       g.players.pos[idx],
		Yaw:                       g.players.yaw[idx],
		Pitch:                     g.players.pitch[idx],
		Crouching:                 g.players.crouching[idx],
		Hp:                        g.players.hp[idx],
		Armor:                     g.players.armor[idx],
		Credits:                   g.players.credits[idx],
		Name:                      g.players.names[idx],
		Team:                      g.players.team[idx],
		Kills:                     g.players.kills[idx],
		Deaths:                    g.players.deaths[idx],
		Alive:                     g.players.alive[idx],
		InMatch:                   g.players.inMatch[idx],
		IsBot:                     g.players.isBot[idx],
		PistolWeapon:              g.players.pistolWeapon[idx],
		PistolClip:                g.players.pistolClip[idx],
		PistolReserve:             g.players.pistolReserve[idx],
		HeavyWeapon:               g.players.heavyWeapon[idx],
		HeavyClip:                 g.players.heavyClip[idx],
		HeavyReserve:              g.players.heavyReserve[idx],
		Bombs:                     g.players.bombs[idx],
		Smokes:                    g.players.smokes[idx],
		Flashbangs:                g.players.flashbangs[idx],
		FlashTimeLeftMS:           g.flashTimeLeftLocked(idx, nowMS),
		SpawnProtectionTimeLeftMS: g.spawnProtectionTimeLeftLocked(idx, nowMS),
		LoadoutTimeLeftMS:         g.loadoutTimeLeftLocked(idx, nowMS),
		ActiveWeapon:              g.players.activeWeapon[idx],
		Reloading:                 g.isReloadingLocked(idx, nowMS),
		ReloadTimeLeftMS:          g.reloadTimeLeftLocked(idx, nowMS),
	}
}

func (g *Game) stateTick(nowMS int64) {
	g.mu.RLock()
	if len(g.players.ids) == 0 {
		g.mu.RUnlock()
		return
	}

	// Advance snapshot sequence.
	g.snapshotSeq = (g.snapshotSeq + 1) & 0xFFFF
	seq := g.snapshotSeq

	// Build current quantized player states for delta comparison.
	currentStates := make(map[int][]byte, len(g.players.ids))
	for i, id := range g.players.ids {
		ps := g.buildPlayerStateLocked(i, nowMS)
		data := make([]byte, playerStateDataSize)
		quantizePlayerBlock(data, ps)
		currentStates[id] = data
	}

	// Store in ring buffer for future baselines.
	g.snapshotBuf.store(seq, currentStates)

	// For each human client, send delta or full snapshot.
	for idx, id := range g.players.ids {
		if g.players.isBot[idx] {
			continue
		}
		sendCh := g.players.sendChs[idx]
		if sendCh == nil {
			continue
		}

		ackedSeq := g.players.lastAckedSnapshotSeq[idx]
		baseline := g.snapshotBuf.find(ackedSeq)

		var msg []byte
		if baseline == nil || ackedSeq == 0 {
			// No valid baseline — send full snapshot.
			msg = g.encodeStateBinary(msgServerState, nowMS, seq)
		} else {
			// Send delta-compressed snapshot.
			msg = g.encodeDeltaStateBinary(nowMS, seq, baseline, currentStates)
		}

		select {
		case sendCh <- msg:
		default:
		}
		_ = id
	}
	g.mu.RUnlock()
}

func normalizeMode(mode GameMode) GameMode {
	switch mode {
	case ModeDeathmatch, ModeHostage, ModeCTF:
		return mode
	}
	return ModeTeam
}

func isTeamBased(mode GameMode) bool {
	n := normalizeMode(mode)
	return n == ModeTeam || n == ModeHostage || n == ModeCTF
}

func (g *Game) setModeLocked(mode GameMode, nowMS int64) bool {
	if g.state != StateWaiting || g.isDeathmatchVoteActiveLocked(nowMS) {
		return false
	}
	g.mode = normalizeMode(mode)
	g.syncModeBotsLocked(nowMS)
	return true
}

func (g *Game) setMapLocked(name string) (bool, string) {
	if g.state != StateWaiting {
		return false, "Map can only change in the waiting lobby"
	}
	if name == g.mapName {
		return true, ""
	}
	result, err := loadMapFull(resolveClientDir(), name)
	if err != nil {
		return false, "Map not found: " + name
	}
	g.mapName = name
	g.mapSpawns = result.spawns
	g.mapBlueSpawns = append([]Vec3(nil), result.blueSpawns...)
	g.mapGreenSpawns = append([]Vec3(nil), result.greenSpawns...)
	g.mapWallsRuntime = result.walls
	g.mapPlatformsRuntime = append([]platformEntry(nil), result.platforms...)
	g.mapBoxesRuntime = result.boxes
	g.mapArenaSize = result.arena
	g.mapWallHeight = result.wallHeight
	g.mapWallThickness = result.wallThick
	g.mapHealthRestorePoints = append([]healthRestorePointState(nil), result.healthRestorePoints...)
	g.resetHealthRestorePointsLocked()

	g.mapHostages = append([]hostageJSON(nil), result.hostages...)
	g.mapRescueZones = append([]rescueZoneJSON(nil), result.rescueZones...)
	g.mapFlagBases = append([]flagBaseJSON(nil), result.flagBases...)

	return true, ""
}

func (g *Game) totalRoundsLocked() int {
	if normalizeMode(g.mode) == ModeDeathmatch {
		return 1
	}
	return totalRounds
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

// processInputsLocked drains each player's input queue, runs server-authoritative
// movement simulation for each buffered command, and sends an input ack.
// Must be called once per tick with g.mu held.
func (g *Game) processInputsLocked(nowMS int64) {
	dt := 1.0 / float64(tickRate)
	isIntermission := g.isIntermissionLocked(nowMS)
	canMove := nowMS >= g.buyEndsAt && !isIntermission

	for idx := range g.players.ids {
		if g.players.isBot[idx] {
			continue // bots use their own AI movement
		}
		queue := g.players.inputQueue[idx]
		if len(queue) == 0 {
			continue
		}

		prevPos := g.players.pos[idx]
		prevCrouching := g.players.crouching[idx]

		for _, cmd := range queue {
			if canMove {
				g.simulateMovement(idx, cmd, dt)
			} else {
				// During buy phase / intermission: only accept crouch toggle, no movement.
				g.players.crouching[idx] = cmd.Crouch
			}
			g.players.lastProcessedSeq[idx] = cmd.Seq
		}
		g.players.inputQueue[idx] = queue[:0] // clear processed

		// Send input ack to this player.
		sendCh := g.players.sendChs[idx]
		if sendCh != nil {
			ack := encodeInputAck(g.players.lastProcessedSeq[idx], g.players.velY[idx], g.players.onGround[idx])
			select {
			case sendCh <- ack:
			default:
			}
		}

		// Record position history for lag compensation.
		newPos := g.players.pos[idx]
		newCrouching := g.players.crouching[idx]
		if newPos != prevPos || newCrouching != prevCrouching {
			// Moving cancels spawn protection so the player becomes shootable.
			if g.hasSpawnProtectionLocked(idx, nowMS) {
				g.clearDeathmatchSpawnStateLocked(idx)
			}
			recordPositionSample(&g.players.history[idx], nowMS, newPos, newCrouching)
		}
	}
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

func sanitizeChatText(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return ""
	}

	runes := []rune(text)
	if len(runes) > maxChatMessageRunes {
		return string(runes[:maxChatMessageRunes])
	}
	return text
}

func (g *Game) broadcastChat(id int, text string) {
	text = sanitizeChatText(text)
	if text == "" {
		return
	}

	g.mu.RLock()
	idx, ok := g.players.indexOf(id)
	if !ok {
		g.mu.RUnlock()
		return
	}
	name := g.players.names[idx]
	g.mu.RUnlock()

	msg, err := json.Marshal(chatMessage{
		T:    "chat",
		ID:   id,
		Name: name,
		Text: text,
	})
	if err != nil {
		return
	}

	g.broadcast(msg, 0)
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

func clampCredits(value int) int {
	if value < 0 {
		return 0
	}
	if value > maxCredits {
		return maxCredits
	}
	return value
}

func (g *Game) addCreditsLocked(idx int, amount int) int {
	if idx < 0 || idx >= len(g.players.credits) || amount == 0 {
		return 0
	}
	before := g.players.credits[idx]
	g.players.credits[idx] = clampCredits(before + amount)
	return g.players.credits[idx] - before
}

func killRewardForWeapon(id WeaponID) int {
	if entry, ok := weaponCatalogEntryByID(id); ok {
		return entry.KillReward
	}
	switch id {
	case WeaponKnife:
		return 1500
	case WeaponBomb, WeaponSmoke, WeaponFlashbang:
		return 300
	default:
		return 300
	}
}

func lossBonusForRound(currentRound, streak int) int {
	if currentRound <= 1 {
		return pistolRoundLossBonus
	}
	if streak < 1 {
		streak = 1
	}
	index := streak - 1
	if index >= len(lossBonusSteps) {
		index = len(lossBonusSteps) - 1
	}
	return lossBonusSteps[index]
}

func (g *Game) grantTeamCreditsLocked(team TeamID, amount int) {
	if amount == 0 {
		return
	}
	for i := range g.players.ids {
		if !g.players.inMatch[i] || normalizeTeam(g.players.team[i]) != normalizeTeam(team) {
			continue
		}
		g.addCreditsLocked(i, amount)
	}
}

func (g *Game) awardRoundEconomyLocked(winner TeamID) {
	switch normalizeTeam(winner) {
	case TeamBlue:
		g.blueLossStreak = 0
		g.greenLossStreak++
		g.grantTeamCreditsLocked(TeamBlue, roundWinCredits)
		g.grantTeamCreditsLocked(TeamGreen, lossBonusForRound(g.currentRound, g.greenLossStreak))
	case TeamGreen:
		g.greenLossStreak = 0
		g.blueLossStreak++
		g.grantTeamCreditsLocked(TeamGreen, roundWinCredits)
		g.grantTeamCreditsLocked(TeamBlue, lossBonusForRound(g.currentRound, g.blueLossStreak))
	default:
		g.blueLossStreak++
		g.greenLossStreak++
		g.grantTeamCreditsLocked(TeamBlue, lossBonusForRound(g.currentRound, g.blueLossStreak))
		g.grantTeamCreditsLocked(TeamGreen, lossBonusForRound(g.currentRound, g.greenLossStreak))
	}
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

func teamDisplayName(team TeamID) string {
	switch normalizeTeam(team) {
	case TeamBlue:
		return "Blue"
	case TeamGreen:
		return "Green"
	default:
		return "None"
	}
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

func (g *Game) humanCountLocked() int {
	count := 0
	for i := range g.players.ids {
		if !g.players.isBot[i] && g.players.names[i] != "" {
			count++
		}
	}
	return count
}

func (g *Game) deathmatchHumanCountLocked(participantOnly bool) int {
	count := 0
	for i := range g.players.ids {
		if g.players.isBot[i] || g.players.names[i] == "" {
			continue
		}
		if participantOnly && !g.players.inMatch[i] {
			continue
		}
		count++
	}
	return count
}

func (g *Game) humanTeamCountsLocked() (blue, green int) {
	for i, team := range g.players.team {
		if g.players.isBot[i] {
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

func (g *Game) aliveCountsLocked() (blue, green int) {
	for i, team := range g.players.team {
		if !g.players.alive[i] || !g.players.inMatch[i] {
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

func (g *Game) removeAllBotsLocked() {
	for i := len(g.players.ids) - 1; i >= 0; i-- {
		if g.players.isBot[i] {
			g.players.removeAt(i)
		}
	}
}

func (g *Game) setAllNamedPlayersInMatchLocked(inMatch bool) {
	for i := range g.players.ids {
		if g.players.names[i] == "" {
			continue
		}
		g.players.inMatch[i] = inMatch
		if !inMatch {
			g.players.alive[i] = false
		}
	}
}

func (g *Game) leaveMatchLocked(playerID int) bool {
	if g.state != StatePlaying || normalizeMode(g.mode) != ModeTeam {
		return false
	}

	idx, ok := g.players.indexOf(playerID)
	if !ok || g.players.isBot[idx] {
		return false
	}

	g.players.inMatch[idx] = false
	g.players.alive[idx] = false
	g.players.flashEndsAt[idx] = 0
	g.clearDeathmatchSpawnStateLocked(idx)
	g.players.shotBloom[idx] = 0
	g.players.bloomWeapon[idx] = g.players.activeWeapon[idx]
	g.players.lastShotAt[idx] = 0
	g.players.recoilPitch[idx] = 0
	g.players.recoilYaw[idx] = 0
	g.players.recoilShotIndex[idx] = 0
	g.players.nextAttackAt[idx] = 0
	g.clearReloadLocked(idx)
	return true
}

func (g *Game) isDeathmatchVoteActiveLocked(nowMS int64) bool {
	return normalizeMode(g.mode) == ModeDeathmatch && g.deathmatchVoteEnds > nowMS
}

func (g *Game) syncModeBotsLocked(nowMS int64) {
	if g.isDeathmatchVoteActiveLocked(nowMS) {
		return
	}
	if normalizeMode(g.mode) == ModeDeathmatch {
		g.syncDeathmatchBotLocked(nowMS, g.state == StatePlaying)
		return
	}
	g.syncFallbackBotLocked(nowMS)
}

func (g *Game) preferredTeamLocked() TeamID {
	blue, green := g.humanTeamCountsLocked()
	if blue > green {
		return TeamGreen
	}
	return TeamBlue
}

func (g *Game) canAssignTeamLocked(idx int, desired TeamID) bool {
	if !isTeamBased(g.mode) {
		return false
	}
	desired = normalizeTeam(desired)
	if desired == TeamNone || idx < 0 || idx >= len(g.players.ids) {
		return false
	}

	blue, green := g.humanTeamCountsLocked()
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

func (g *Game) addFallbackBotLocked(team TeamID, nowMS int64) {
	team = normalizeTeam(team)
	if team == TeamNone {
		return
	}

	id := g.nextID
	g.nextID++
	spawns := g.spawnPointsForTeamLocked(team)
	spawn := spawns[rand.Intn(len(spawns))]
	g.players.add(id, nil, spawn, nowMS, true)
	idx, ok := g.players.indexOf(id)
	if !ok {
		return
	}
	g.players.names[idx] = fmt.Sprintf("BOT %s", teamDisplayName(team))
	g.players.team[idx] = team
	g.players.inMatch[idx] = true
	g.resetPlayerForNewMatchLocked(idx, nowMS)
}

func (g *Game) addDeathmatchBotLocked(nowMS int64, inMatch bool) {
	id := g.nextID
	g.nextID++
	spawn := g.mapSpawns[rand.Intn(len(g.mapSpawns))]
	g.players.add(id, nil, spawn, nowMS, true)
	idx, ok := g.players.indexOf(id)
	if !ok {
		return
	}
	g.players.names[idx] = "BOT"
	g.players.team[idx] = TeamNone
	g.players.inMatch[idx] = inMatch || g.state != StatePlaying
	g.resetPlayerForNewMatchLocked(idx, nowMS)
}

func (g *Game) syncFallbackBotLocked(nowMS int64) {
	if !isTeamBased(g.mode) {
		g.removeAllBotsLocked()
		return
	}

	blueHumans, greenHumans := g.humanTeamCountsLocked()
	desiredTeam := TeamNone
	switch {
	case blueHumans > 0 && greenHumans == 0:
		desiredTeam = TeamGreen
	case greenHumans > 0 && blueHumans == 0:
		desiredTeam = TeamBlue
	}

	for i := len(g.players.ids) - 1; i >= 0; i-- {
		if !g.players.isBot[i] {
			continue
		}
		if desiredTeam == TeamNone || normalizeTeam(g.players.team[i]) != desiredTeam {
			g.players.removeAt(i)
		}
	}

	if desiredTeam == TeamNone {
		return
	}

	for i := range g.players.ids {
		if g.players.isBot[i] && normalizeTeam(g.players.team[i]) == desiredTeam {
			return
		}
	}

	g.addFallbackBotLocked(desiredTeam, nowMS)
}

func (g *Game) syncDeathmatchBotLocked(nowMS int64, participantOnly bool) {
	if normalizeMode(g.mode) != ModeDeathmatch {
		g.removeAllBotsLocked()
		return
	}

	humanCount := g.deathmatchHumanCountLocked(participantOnly)
	for i := len(g.players.ids) - 1; i >= 0; i-- {
		if g.players.isBot[i] {
			g.players.removeAt(i)
		}
	}

	if humanCount != 1 {
		return
	}

	g.addDeathmatchBotLocked(nowMS, participantOnly)
}

func (g *Game) canStartMatchLocked() (bool, string) {
	if normalizeMode(g.mode) == ModeDeathmatch {
		if g.humanCountLocked() < 1 {
			return false, "Need at least 1 player"
		}
		return true, ""
	}
	if g.humanCountLocked() < 1 {
		return false, "Need at least 1 player"
	}
	blue, green := g.teamCountsLocked()
	for i, team := range g.players.team {
		if g.players.isBot[i] {
			continue
		}
		if normalizeTeam(team) == TeamNone {
			return false, "All players must join a team"
		}
	}
	if blue == 0 || green == 0 {
		return false, "Both teams need players"
	}
	if absInt(blue-green) > 1 {
		return false, "Teams must stay within one player"
	}
	return true, ""
}

func (g *Game) canPlayersDamageLocked(attackerIdx, targetIdx int) bool {
	return g.canPlayersDamageAtLocked(attackerIdx, targetIdx, time.Now().UnixMilli())
}

func (g *Game) canPlayersDamageAtLocked(attackerIdx, targetIdx int, nowMS int64) bool {
	if attackerIdx < 0 || targetIdx < 0 || attackerIdx >= len(g.players.ids) || targetIdx >= len(g.players.ids) {
		return false
	}
	if attackerIdx == targetIdx || !g.players.inMatch[targetIdx] || !g.players.alive[targetIdx] {
		return false
	}
	if normalizeMode(g.mode) == ModeDeathmatch {
		return !g.hasSpawnProtectionLocked(targetIdx, nowMS)
	}
	attackerTeam := normalizeTeam(g.players.team[attackerIdx])
	return attackerTeam == TeamNone || normalizeTeam(g.players.team[targetIdx]) != attackerTeam
}

func (g *Game) nearestEnemyLocked(idx int, nowMS int64) int {
	if idx < 0 || idx >= len(g.players.ids) {
		return -1
	}

	bestIdx := -1
	bestDist := math.MaxFloat64
	for i := range g.players.ids {
		if !g.canPlayersDamageAtLocked(idx, i, nowMS) {
			continue
		}

		dist := distanceVec3(g.players.pos[idx], g.players.pos[i])
		if dist >= bestDist {
			continue
		}
		bestDist = dist
		bestIdx = i
	}

	return bestIdx
}

func isAccurateBotShot(shotIndex int64) bool {
	return (shotIndex+1)%5 == 0
}

func (g *Game) clampBotAxis(v float64) float64 {
	limit := g.mapArenaSize - botBoundMargin
	return math.Max(-limit, math.Min(limit, v))
}

func applyBotAimProfile(dir Vec3, shotIndex int64) Vec3 {
	dir = normalizeVec(dir)
	if isAccurateBotShot(shotIndex) {
		return normalizeVec(Vec3{dir[0], dir[1] + 0.01, dir[2]})
	}

	right := crossVec3(Vec3{0, 1, 0}, dir)
	if right[0] == 0 && right[1] == 0 && right[2] == 0 {
		right = Vec3{1, 0, 0}
	}
	right = normalizeVec(right)
	lateralSign := 1.0
	if shotIndex%2 == 1 {
		lateralSign = -1
	}
	verticalSign := 1.0
	if (shotIndex/2)%2 == 1 {
		verticalSign = -1
	}

	return normalizeVec(Vec3{
		dir[0] + right[0]*0.55*lateralSign,
		dir[1] + 0.18*verticalSign,
		dir[2] + right[2]*0.55*lateralSign,
	})
}

func (g *Game) moveFallbackBotLocked(idx, targetIdx int, nowMS int64) {
	if idx < 0 || idx >= len(g.players.ids) || targetIdx < 0 || targetIdx >= len(g.players.ids) {
		return
	}

	pos := g.players.pos[idx]
	target := g.players.pos[targetIdx]
	flat := Vec3{target[0] - pos[0], 0, target[2] - pos[2]}
	dist := math.Sqrt(flat[0]*flat[0] + flat[2]*flat[2])
	if dist < 1e-6 {
		return
	}

	dir := normalizeVec(flat)
	next := pos
	advanceStep := botAdvanceSpeed / float64(tickRate)
	strafeStep := botStrafeSpeed / float64(tickRate)

	if dist > botPreferredRange {
		next[0] += dir[0] * advanceStep
		next[2] += dir[2] * advanceStep
	} else {
		strafeSign := 1.0
		if ((nowMS/botStrafeFlipMS)+int64(g.players.ids[idx]))%2 == 1 {
			strafeSign = -1
		}
		strafe := Vec3{-dir[2] * strafeSign, 0, dir[0] * strafeSign}
		next[0] += strafe[0] * strafeStep
		next[2] += strafe[2] * strafeStep
		if dist < botPreferredRange*0.55 {
			next[0] -= dir[0] * advanceStep * 0.35
			next[2] -= dir[2] * advanceStep * 0.35
		}
	}

	next[0] = g.clampBotAxis(next[0])
	next[2] = g.clampBotAxis(next[2])
	footY := pos[1] - standEyeHeight
	groundHeight := g.groundHeightAt(next[0], next[2], footY+worldStepHeight)
	if footY-groundHeight <= worldStepDown {
		next[1] = groundHeight + standEyeHeight
	} else {
		next[1] = pos[1]
	}
	g.collideWalls(&next, standEyeHeight)
	next[0] = math.Max(-g.mapArenaSize+0.5, math.Min(g.mapArenaSize-0.5, next[0]))
	next[2] = math.Max(-g.mapArenaSize+0.5, math.Min(g.mapArenaSize-0.5, next[2]))
	if next == pos {
		return
	}

	g.players.pos[idx] = next
	recordPositionSample(&g.players.history[idx], nowMS, next, false)
}

// Split map spawns by X sign: negative X → blue side, non-negative → green side
func (g *Game) spawnPointsForTeamLocked(team TeamID) []Vec3 {
	if normalizeTeam(team) == TeamBlue && len(g.mapBlueSpawns) > 0 {
		return g.mapBlueSpawns
	}
	if normalizeTeam(team) == TeamGreen && len(g.mapGreenSpawns) > 0 {
		return g.mapGreenSpawns
	}

	var blue, green []Vec3
	for _, sp := range g.mapSpawns {
		if sp[0] < 0 {
			blue = append(blue, sp)
		} else {
			green = append(green, sp)
		}
	}
	if len(blue) == 0 {
		blue = g.mapSpawns
	}
	if len(green) == 0 {
		green = g.mapSpawns
	}
	if normalizeTeam(team) == TeamGreen {
		return green
	}
	return blue
}

func weaponConfigByID(id WeaponID) weaponConfig {
	if id == WeaponKnife {
		return weaponConfig{
			ID:                  WeaponKnife,
			Label:               "Knife",
			Range:               knifeRange,
			FireIntervalMS:      450,
			BodyDamage:          55,
			HeadDamage:          90,
			UsesAmmo:            false,
			HipSpread:           0,
			AimSpread:           0,
			BloomPerShot:        0,
			MaxBloom:            0,
			BloomDecayMS:        0,
			RecoilTable:         nil,
			RecoveryThresholdMS: 0,
			PunchDecayExp:       6.0,
			PunchDecayLin:       1.0,
		}
	}
	if isUtilityWeaponID(id) {
		return weaponConfig{
			ID:                  id,
			Label:               weaponLabel(id),
			Range:               hitscanRange,
			FireIntervalMS:      utilityThrowIntervalMS,
			BodyDamage:          0,
			HeadDamage:          0,
			UsesAmmo:            false,
			HipSpread:           0,
			AimSpread:           0,
			BloomPerShot:        0,
			MaxBloom:            0,
			BloomDecayMS:        0,
			RecoilTable:         nil,
			RecoveryThresholdMS: 0,
			PunchDecayExp:       2.0,
			PunchDecayLin:       0.4,
		}
	}
	entry, ok := weaponCatalogEntryByID(id)
	if !ok {
		return weaponConfigByID(WeaponKnife)
	}
	recoilTable := recoilTableForEntry(id, entry)
	hipSpread := 0.006
	aimSpread := 0.003
	bloomPerShot := 0.001
	maxBloom := 0.008
	recovery := int64(180)
	punchExp := 3.5
	punchLin := 0.5
	switch entry.Category {
	case "pistol":
		hipSpread = 0.006
		aimSpread = 0.006
		bloomPerShot = 0.002
		maxBloom = 0.01
		recovery = 240
		punchExp = 4.0
		punchLin = 0.6
	case "sniper":
		hipSpread = 0.025
		aimSpread = 0.0008
		bloomPerShot = 0.003
		maxBloom = 0.02
		recovery = 360
	case "shotgun":
		hipSpread = 0.018
		aimSpread = 0.018
		bloomPerShot = 0.0025
		maxBloom = 0.02
		recovery = 220
	case "smg":
		hipSpread = 0.008
		aimSpread = 0.008
		bloomPerShot = 0.0014
		maxBloom = 0.012
	case "machinegun":
		hipSpread = 0.01
		aimSpread = 0.01
		bloomPerShot = 0.0012
		maxBloom = 0.012
	default:
		hipSpread = 0.006
		if len(entry.ZoomLevels) > 0 {
			aimSpread = 0.002
		} else {
			aimSpread = 0.006
		}
	}
	bodyDamage := entry.BaseDamage
	if entry.Category == "shotgun" {
		pellets := entry.Pellets
		if pellets < 1 {
			pellets = 1
		}
		bodyDamage *= pellets
	}
	headDamage := int(math.Round(float64(bodyDamage) * 4))
	return weaponConfig{
		ID:                  id,
		Label:               entry.Label,
		Range:               hitscanRange,
		FireIntervalMS:      int64(entry.FireIntervalMS),
		BodyDamage:          bodyDamage,
		HeadDamage:          headDamage,
		UsesAmmo:            entry.MagSize > 0,
		HipSpread:           hipSpread,
		AimSpread:           aimSpread,
		BloomPerShot:        bloomPerShot,
		MaxBloom:            maxBloom,
		BloomDecayMS:        0.000008,
		RecoilTable:         recoilTable,
		RecoveryThresholdMS: recovery,
		PunchDecayExp:       punchExp,
		PunchDecayLin:       punchLin,
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
		elapsed := nowMS - last
		// Only start decaying after recovery threshold
		if elapsed > config.RecoveryThresholdMS {
			decayTime := elapsed - config.RecoveryThresholdMS
			bloom = math.Max(0, bloom-float64(decayTime)*config.BloomDecayMS)
		}
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

// decayRecoilLocked decays accumulated aim punch based on time since last shot,
// using combined exponential + linear decay after a recovery threshold.
func (g *Game) decayRecoilLocked(idx int, weapon WeaponID, nowMS int64) {
	config := weaponConfigByID(weapon)
	last := g.players.lastShotAt[idx]
	if last <= 0 || nowMS <= last {
		return
	}
	// Reset recoil if weapon changed
	if g.players.bloomWeapon[idx] != weapon {
		g.players.recoilPitch[idx] = 0
		g.players.recoilYaw[idx] = 0
		g.players.recoilShotIndex[idx] = 0
		return
	}
	elapsedMS := nowMS - last
	if elapsedMS <= config.RecoveryThresholdMS {
		return
	}
	decaySec := float64(elapsedMS-config.RecoveryThresholdMS) / 1000.0
	// Exponential decay
	expFactor := math.Exp(-config.PunchDecayExp * decaySec)
	g.players.recoilPitch[idx] *= expFactor
	g.players.recoilYaw[idx] *= expFactor
	// Linear decay
	linDecay := config.PunchDecayLin * decaySec
	if g.players.recoilPitch[idx] > 0 {
		g.players.recoilPitch[idx] = math.Max(0, g.players.recoilPitch[idx]-linDecay)
	} else if g.players.recoilPitch[idx] < 0 {
		g.players.recoilPitch[idx] = math.Min(0, g.players.recoilPitch[idx]+linDecay)
	}
	if g.players.recoilYaw[idx] > 0 {
		g.players.recoilYaw[idx] = math.Max(0, g.players.recoilYaw[idx]-linDecay)
	} else if g.players.recoilYaw[idx] < 0 {
		g.players.recoilYaw[idx] = math.Min(0, g.players.recoilYaw[idx]+linDecay)
	}
	// Reset shot index if fully recovered
	if math.Abs(g.players.recoilPitch[idx]) < 0.001 && math.Abs(g.players.recoilYaw[idx]) < 0.001 {
		g.players.recoilPitch[idx] = 0
		g.players.recoilYaw[idx] = 0
		g.players.recoilShotIndex[idx] = 0
	}
}

// registerShotRecoilLocked decays existing recoil, applies the next recoil table
// entry, and returns the accumulated (pitch, yaw) aim punch to offset the shot.
func (g *Game) registerShotRecoilLocked(idx int, weapon WeaponID, nowMS int64, aiming, moving bool) (float64, float64) {
	config := weaponConfigByID(weapon)
	g.decayRecoilLocked(idx, weapon, nowMS)

	table := config.RecoilTable
	if len(table) == 0 {
		return 0, 0
	}

	shotIdx := g.players.recoilShotIndex[idx]
	if shotIdx >= len(table) {
		shotIdx = len(table) - 1
	}

	pitchAdd := table[shotIdx][0]
	yawAdd := table[shotIdx][1]

	// First-shot accuracy: zero recoil on first shot when standing still
	if shotIdx == 0 && !moving {
		pitchAdd = 0
		yawAdd = 0
	}

	// ADS reduces recoil
	if aiming {
		pitchAdd *= 0.58
		yawAdd *= 0.58
	}
	// Moving increases recoil
	if moving {
		pitchAdd *= 1.35
		yawAdd *= 1.35
	}

	g.players.recoilPitch[idx] += pitchAdd
	g.players.recoilYaw[idx] += yawAdd
	g.players.recoilShotIndex[idx] = shotIdx + 1

	return g.players.recoilPitch[idx], g.players.recoilYaw[idx]
}

// applyRecoilToDirection offsets a shot direction by the server-side aim punch.
func applyRecoilToDirection(dir Vec3, recoilPitch, recoilYaw float64) Vec3 {
	if recoilPitch == 0 && recoilYaw == 0 {
		return dir
	}
	forward := normalizeVec(dir)
	upHint := Vec3{0, 1, 0}
	if math.Abs(dotVec3(forward, upHint)) > 0.98 {
		upHint = Vec3{1, 0, 0}
	}
	right := normalizeVec(crossVec3(upHint, forward))
	up := normalizeVec(crossVec3(forward, right))
	return normalizeVec(Vec3{
		forward[0] + up[0]*recoilPitch + right[0]*recoilYaw,
		forward[1] + up[1]*recoilPitch + right[1]*recoilYaw,
		forward[2] + up[2]*recoilPitch + right[2]*recoilYaw,
	})
}

func applyShotSpread(dir Vec3, config weaponConfig, aiming, crouching, moving bool, bloom float64, seed int64) Vec3 {
	// First shot accuracy: when bloom is zero and standing still, near-perfect accuracy
	if bloom <= 0 && !moving {
		spread := config.HipSpread * 0.08
		if aiming && config.AimSpread > 0 {
			spread = config.AimSpread * 0.05
		}
		if spread <= 0 {
			return normalizeVec(dir)
		}
		return applySpreadVector(dir, spread, seed)
	}

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
	return applySpreadVector(dir, spread, seed)
}

func applySpreadVector(dir Vec3, spread float64, seed int64) Vec3 {
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

func isMovingAtTime(r *positionRingBuffer, at int64) bool {
	if r.count == 0 {
		return false
	}

	current := sampleAtTime(r, at).Pos
	previous := sampleAtTime(r, at-120).Pos
	dx := current[0] - previous[0]
	dz := current[2] - previous[2]
	return dx*dx+dz*dz > 0.18*0.18
}

func deterministicSpreadOffset(seed int64) float64 {
	rng := rand.New(rand.NewSource(seed))
	return rng.Float64()*2 - 1
}

func (g *Game) normalizeActiveWeaponLocked(idx int, requested WeaponID) WeaponID {
	switch requested {
	case WeaponBomb:
		if g.players.bombs[idx] > 0 {
			return requested
		}
	case WeaponSmoke:
		if g.players.smokes[idx] > 0 {
			return requested
		}
	case WeaponFlashbang:
		if g.players.flashbangs[idx] > 0 {
			return requested
		}
	default:
		if requested != "" && (g.players.pistolWeapon[idx] == requested || g.players.heavyWeapon[idx] == requested) {
			return requested
		}
	}
	return WeaponKnife
}

func isCombatWeapon(id WeaponID) bool {
	return id == WeaponKnife || isPistolWeapon(id) || isHeavyWeapon(id)
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
	if entry, ok := weaponCatalogEntryByID(id); ok {
		return entry.MagSize
	}
	return 0
}

func weaponReserveAmmoMax(id WeaponID) int {
	if entry, ok := weaponCatalogEntryByID(id); ok {
		return entry.ReserveMax
	}
	return 0
}

func weaponReloadMS(id WeaponID) int64 {
	if entry, ok := weaponCatalogEntryByID(id); ok {
		return int64(entry.ReloadMS)
	}
	return 0
}

func (g *Game) currentAmmoLocked(idx int, weapon WeaponID) int {
	switch {
	case g.players.heavyWeapon[idx] == weapon:
		return g.players.heavyClip[idx]
	case g.players.pistolWeapon[idx] == weapon:
		return g.players.pistolClip[idx]
	default:
		return 0
	}
}

func (g *Game) currentReserveLocked(idx int, weapon WeaponID) int {
	switch {
	case g.players.heavyWeapon[idx] == weapon:
		return g.players.heavyReserve[idx]
	case g.players.pistolWeapon[idx] == weapon:
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
	switch {
	case g.players.heavyWeapon[idx] == weapon:
		g.players.heavyClip[idx] = clip
		g.players.heavyReserve[idx] = reserve
	case g.players.pistolWeapon[idx] == weapon:
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

func (g *Game) awardDeathmatchKillAmmoLocked(idx int, weapon WeaponID) bool {
	if normalizeMode(g.mode) != ModeDeathmatch {
		return false
	}
	switch {
	case g.players.pistolWeapon[idx] == weapon, g.players.heavyWeapon[idx] == weapon:
		return g.addAmmoLocked(idx, weapon, deathmatchKillAmmoReward)
	}
	return false
}

func (g *Game) stripLoadoutOnDeathLocked(idx int) {
	defaultPistol := defaultPistolForTeam(g.players.team[idx])
	g.players.pistolWeapon[idx] = defaultPistol
	g.players.heavyWeapon[idx] = ""
	g.players.pistolClip[idx] = weaponClipSize(defaultPistol)
	g.players.pistolReserve[idx] = 0
	g.players.heavyClip[idx] = 0
	g.players.heavyReserve[idx] = 0
	g.players.bombs[idx] = 0
	g.players.smokes[idx] = 0
	g.players.flashbangs[idx] = 0
	g.players.activeWeapon[idx] = defaultPistol
	g.players.nextAttackAt[idx] = 0
	g.players.shotBloom[idx] = 0
	g.players.bloomWeapon[idx] = defaultPistol
	g.players.lastShotAt[idx] = 0
	g.players.recoilPitch[idx] = 0
	g.players.recoilYaw[idx] = 0
	g.players.recoilShotIndex[idx] = 0
	g.clearReloadLocked(idx)
	g.clearDeathmatchSpawnStateLocked(idx)
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
	if g.players.pistolWeapon[idx] != "" {
		g.reloadWeaponForRoundLocked(idx, g.players.pistolWeapon[idx])
	}
	if g.players.heavyWeapon[idx] != "" {
		g.reloadWeaponForRoundLocked(idx, g.players.heavyWeapon[idx])
	}
}

func (g *Game) spendAmmoLocked(idx int, weapon WeaponID, amount int) bool {
	switch {
	case g.players.heavyWeapon[idx] == weapon:
		if g.players.heavyClip[idx] < amount {
			return false
		}
		g.players.heavyClip[idx] -= amount
		return true
	case g.players.pistolWeapon[idx] == weapon:
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
	reloadMS := weaponReloadMS(weapon)
	clipSize := weaponClipSize(weapon)
	if clipSize <= 0 || reloadMS <= 0 {
		return false
	}
	clip := g.currentAmmoLocked(idx, weapon)
	reserve := g.currentReserveLocked(idx, weapon)
	if reserve <= 0 || clip >= clipSize {
		return false
	}
	g.players.reloadWeapon[idx] = weapon
	g.players.reloadEndsAt[idx] = nowMS + reloadMS
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
	g.addEffectLocked("bomb", projectile.Pos, bombRadius, nowMS+bombEffectDurationMS)

	for idx, playerID := range g.players.ids {
		if !g.players.inMatch[idx] || !g.players.alive[idx] {
			continue
		}
		if ownerOK && !g.canPlayersDamageAtLocked(ownerIdx, idx, nowMS) {
			continue
		}
		if !ownerOK && g.hasSpawnProtectionLocked(idx, nowMS) {
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

		if nextHP > 0 {
			continue
		}

		g.players.alive[idx] = false
		g.players.deaths[idx]++
		g.dropCarrierLocked(playerID, nowMS)
		g.stripLoadoutOnDeathLocked(idx)
		if ownerOK && projectile.OwnerID != playerID {
			g.players.kills[ownerIdx]++
			rewardAmount := g.addCreditsLocked(ownerIdx, killRewardForWeapon(WeaponBomb))
			if rewardAmount != 0 {
				tm.addDirect(projectile.OwnerID, g.applyEconomyUpdateLocked(ownerIdx, true, "reward", string(WeaponBomb), "Explosion elimination reward", "", rewardAmount, nowMS))
			}
		}
		if normalizeMode(g.mode) == ModeDeathmatch {
			g.scheduleRespawn(playerID, g.currentRound)
		}

		tm.addBroadcast(map[string]interface{}{
			"t":      "kill",
			"killer": projectile.OwnerID,
			"victim": playerID,
			"weapon": WeaponBomb,
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

func (g *Game) tickFallbackBotsLocked(nowMS int64, tm *tickMessages) {
	if g.state != StatePlaying || nowMS < g.buyEndsAt || g.isIntermissionLocked(nowMS) {
		return
	}

	for idx, botID := range g.players.ids {
		if !g.players.isBot[idx] || !g.players.inMatch[idx] || !g.players.alive[idx] {
			continue
		}
		if g.hasSpawnProtectionLocked(idx, nowMS) {
			continue
		}

		targetIdx := g.nearestEnemyLocked(idx, nowMS)
		if targetIdx < 0 {
			continue
		}

		g.moveFallbackBotLocked(idx, targetIdx, nowMS)

		dir := normalizeVec(Vec3{
			g.players.pos[targetIdx][0] - g.players.pos[idx][0],
			g.players.pos[targetIdx][1] - g.players.pos[idx][1],
			g.players.pos[targetIdx][2] - g.players.pos[idx][2],
		})
		g.players.yaw[idx], g.players.pitch[idx] = yawPitchFromDirection(dir)

		if nowMS < g.players.botNextThink[idx] || nowMS < g.players.nextAttackAt[idx] {
			continue
		}
		if g.isReloadingLocked(idx, nowMS) {
			continue
		}

		botWeapon := g.players.pistolWeapon[idx]
		g.players.activeWeapon[idx] = botWeapon
		if g.currentAmmoLocked(idx, botWeapon) <= 0 {
			if g.currentReserveLocked(idx, botWeapon) > 0 {
				g.startReloadLocked(idx, botWeapon, nowMS)
			}
			g.players.botNextThink[idx] = nowMS + botThinkIntervalMS
			continue
		}

		config := weaponConfigByID(botWeapon)
		if !g.spendAmmoLocked(idx, botWeapon, 1) {
			g.players.botNextThink[idx] = nowMS + botThinkIntervalMS
			continue
		}

		shotTime := nowMS
		bloom := g.registerShotBloomLocked(idx, botWeapon, nowMS)
		dir = applyBotAimProfile(dir, g.players.botShotCount[idx])
		moving := isMovingAtTime(&g.players.history[idx], shotTime)
		// Track recoil state for bots (used for bloom/reset sync)
		g.registerShotRecoilLocked(idx, botWeapon, nowMS, false, moving)
		dir = applyShotSpread(dir, config, false, g.players.crouching[idx], moving, bloom, shotTime+int64(botID)*97+nowMS)
		g.players.nextAttackAt[idx] = nowMS + config.FireIntervalMS
		g.players.botNextThink[idx] = nowMS + botThinkIntervalMS
		g.players.botShotCount[idx]++
		shooterPos := positionAtTime(&g.players.history[idx], shotTime)

		shotMsg, _ := json.Marshal(map[string]interface{}{
			"t":         "shot",
			"id":        botID,
			"pos":       shooterPos,
			"dir":       dir,
			"weapon":    botWeapon,
			"alternate": false,
		})
		tm.broadcasts = append(tm.broadcasts, shotMsg)

		hit := g.findHitTargetLocked(botID, shooterPos, dir, shotTime, config.Range)
		if hit == nil || !g.players.alive[hit.index] {
			continue
		}

		damage := damageForConfig(config, hit.zone)
		victimID := hit.id
		victimHP, victimArmor, absorbedDamage := applyDamage(g.players.hp[hit.index], g.players.armor[hit.index], damage)
		g.players.hp[hit.index] = victimHP
		g.players.armor[hit.index] = victimArmor

		if victimHP <= 0 {
			g.players.alive[hit.index] = false
			g.players.deaths[hit.index]++
			g.dropCarrierLocked(victimID, nowMS)
			g.stripLoadoutOnDeathLocked(hit.index)
			g.players.kills[idx]++
			g.awardDeathmatchKillAmmoLocked(idx, botWeapon)
			g.addCreditsLocked(idx, killRewardForWeapon(botWeapon))
			if normalizeMode(g.mode) == ModeDeathmatch {
				g.scheduleRespawn(victimID, g.currentRound)
			}
		}

		hitMsg, _ := json.Marshal(map[string]interface{}{
			"t":        "hit",
			"from":     botID,
			"to":       victimID,
			"dmg":      damage,
			"zone":     hit.zone,
			"weapon":   botWeapon,
			"hp":       victimHP,
			"armor":    victimArmor,
			"absorbed": absorbedDamage,
		})
		tm.broadcasts = append(tm.broadcasts, hitMsg)

		if victimHP > 0 {
			continue
		}

		killMsg, _ := json.Marshal(map[string]interface{}{
			"t":      "kill",
			"killer": botID,
			"victim": victimID,
			"weapon": botWeapon,
		})
		tm.broadcasts = append(tm.broadcasts, killMsg)
	}
}

func (g *Game) applyEconomyUpdateLocked(idx int, ok bool, kind, item, label, reason string, amount int, nowMS int64) economyUpdate {
	return economyUpdate{
		T:                         "economy",
		PlayerID:                  g.players.ids[idx],
		OK:                        ok,
		Kind:                      kind,
		Item:                      item,
		Label:                     label,
		Reason:                    reason,
		Amount:                    amount,
		Crouching:                 g.players.crouching[idx],
		Hp:                        g.players.hp[idx],
		Armor:                     g.players.armor[idx],
		Credits:                   g.players.credits[idx],
		Team:                      g.players.team[idx],
		PistolWeapon:              g.players.pistolWeapon[idx],
		PistolClip:                g.players.pistolClip[idx],
		PistolReserve:             g.players.pistolReserve[idx],
		HeavyWeapon:               g.players.heavyWeapon[idx],
		HeavyClip:                 g.players.heavyClip[idx],
		HeavyReserve:              g.players.heavyReserve[idx],
		Bombs:                     g.players.bombs[idx],
		Smokes:                    g.players.smokes[idx],
		Flashbangs:                g.players.flashbangs[idx],
		FlashTimeLeftMS:           g.flashTimeLeftLocked(idx, nowMS),
		SpawnProtectionTimeLeftMS: g.spawnProtectionTimeLeftLocked(idx, nowMS),
		LoadoutTimeLeftMS:         g.loadoutTimeLeftLocked(idx, nowMS),
		ActiveWeapon:              g.players.activeWeapon[idx],
		Reloading:                 g.isReloadingLocked(idx, nowMS),
		ReloadTimeLeftMS:          g.reloadTimeLeftLocked(idx, nowMS),
	}
}

func (g *Game) applyPurchaseLocked(idx int, item string, nowMS int64) economyUpdate {
	freeLoadout := g.isDeathmatchLoadoutActiveLocked(idx, nowMS)
	if g.state != StatePlaying {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Match has not started", 0, nowMS)
	}
	if g.isIntermissionLocked(nowMS) {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Round is over", 0, nowMS)
	}
	if !freeLoadout && nowMS >= g.buyEndsAt {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Buy time is over", 0, nowMS)
	}
	if !g.players.alive[idx] {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Only alive players can buy", 0, nowMS)
	}

	if entry, ok := weaponCatalogEntryByID(WeaponID(item)); ok {
		if !weaponAllowedForTeam(WeaponID(item), g.players.team[idx]) {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, entry.Label, "Wrong side for this weapon", 0, nowMS)
		}
		if !freeLoadout && g.players.credits[idx] < entry.Price {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, entry.Label, "Not enough credits", 0, nowMS)
		}
		if !freeLoadout {
			g.players.credits[idx] -= entry.Price
		}
		weaponID := WeaponID(item)
		if entry.Slot == "pistol" {
			g.players.pistolWeapon[idx] = weaponID
			g.players.pistolClip[idx] = entry.MagSize
			g.players.pistolReserve[idx] = entry.ReserveMax
		} else {
			g.players.heavyWeapon[idx] = weaponID
			g.players.heavyClip[idx] = entry.MagSize
			g.players.heavyReserve[idx] = entry.ReserveMax
		}
		g.players.activeWeapon[idx] = weaponID
		amount := 0
		if !freeLoadout {
			amount = -entry.Price
		}
		return g.applyEconomyUpdateLocked(idx, true, "purchase", item, entry.Label, "", amount, nowMS)
	}

	switch item {
	case "bomb":
		return g.purchaseUtilityLocked(idx, item, "HE Grenade", 300, &g.players.bombs[idx], freeLoadout, nowMS)
	case "smoke":
		return g.purchaseUtilityLocked(idx, item, "Smoke Grenade", 300, &g.players.smokes[idx], freeLoadout, nowMS)
	case "flashbang":
		return g.purchaseUtilityLocked(idx, item, "Flashbang", 200, &g.players.flashbangs[idx], freeLoadout, nowMS)
	case "armor":
		if g.players.armor[idx] >= maxArmor {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Kevlar", "Armor already full", 0, nowMS)
		}
		if !freeLoadout && g.players.credits[idx] < 650 {
			return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "Kevlar", "Not enough credits", 0, nowMS)
		}
		if !freeLoadout {
			g.players.credits[idx] -= 650
		}
		g.players.armor[idx] = maxArmor
		amount := 0
		if !freeLoadout {
			amount = -650
		}
		return g.applyEconomyUpdateLocked(idx, true, "purchase", item, "Kevlar", "", amount, nowMS)
	default:
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, "", "Unknown buy item", 0, nowMS)
	}
}

func (g *Game) purchaseUtilityLocked(idx int, item, label string, cost int, count *int, free bool, nowMS int64) economyUpdate {
	if *count >= grenadeMaxCount {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, label, label+" already stocked", 0, nowMS)
	}
	if !free && g.players.credits[idx] < cost {
		return g.applyEconomyUpdateLocked(idx, false, "purchase", item, label, "Not enough credits", 0, nowMS)
	}

	if !free {
		g.players.credits[idx] -= cost
	}
	*count += 1
	amount := 0
	if !free {
		amount = -cost
	}
	return g.applyEconomyUpdateLocked(idx, true, "purchase", item, label, "", amount, nowMS)
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
		// Binary messages start with a non-'{' byte; JSON always starts with '{'.
		msgType := websocket.TextMessage
		if len(msg) > 0 && msg[0] != '{' {
			msgType = websocket.BinaryMessage
		}
		if err := conn.WriteMessage(msgType, msg); err != nil {
			break
		}
	}
	conn.Close()
}

func (g *Game) resetPlayerForNewMatchLocked(idx int, nowMS int64) {
	g.players.credits[idx] = startingCredits
	g.players.armor[idx] = 0
	defaultPistol := defaultPistolForTeam(g.players.team[idx])
	g.players.pistolWeapon[idx] = defaultPistol
	g.players.heavyWeapon[idx] = ""
	g.players.pistolClip[idx] = weaponClipSize(defaultPistol)
	g.players.pistolReserve[idx] = 0
	g.players.heavyClip[idx] = 0
	g.players.heavyReserve[idx] = 0
	g.players.bombs[idx] = 0
	g.players.smokes[idx] = 0
	g.players.flashbangs[idx] = 0
	g.players.flashEndsAt[idx] = 0
	g.players.kills[idx] = 0
	g.players.deaths[idx] = 0
	g.players.botShotCount[idx] = 0
	g.players.shotBloom[idx] = 0
	g.players.bloomWeapon[idx] = WeaponKnife
	g.players.lastShotAt[idx] = 0
	g.players.recoilPitch[idx] = 0
	g.players.recoilYaw[idx] = 0
	g.players.recoilShotIndex[idx] = 0
	g.clearDeathmatchSpawnStateLocked(idx)
	g.clearReloadLocked(idx)
	g.respawnPlayerLocked(idx, nowMS)
	if normalizeMode(g.mode) != ModeDeathmatch {
		g.players.activeWeapon[idx] = defaultPistol
	}
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
		pistolWeapon := WeaponKnife
		heavyWeapon := WeaponKnife
		team := TeamNone
		pistolClip := 0
		pistolReserve := 0
		heavyClip := 0
		heavyReserve := 0
		bombs := 0
		smokes := 0
		flashbangs := 0
		activeWeapon := WeaponKnife
		spawnProtectionTimeLeft := int64(0)
		loadoutTimeLeft := int64(0)

		g.mu.Lock()
		idx, ok := g.players.indexOf(victimID)
		if ok && g.state == StatePlaying && g.currentRound == roundNumber && !g.players.alive[idx] && g.players.inMatch[idx] {
			g.respawnPlayerLocked(idx, nowMS)
			shouldBroadcast = true
			respawnPos = g.players.pos[idx]
			respawnCredits = g.players.credits[idx]
			respawnArmor = g.players.armor[idx]
			respawnHP = g.players.hp[idx]
			pistolWeapon = g.players.pistolWeapon[idx]
			heavyWeapon = g.players.heavyWeapon[idx]
			team = g.players.team[idx]
			pistolClip = g.players.pistolClip[idx]
			pistolReserve = g.players.pistolReserve[idx]
			heavyClip = g.players.heavyClip[idx]
			heavyReserve = g.players.heavyReserve[idx]
			bombs = g.players.bombs[idx]
			smokes = g.players.smokes[idx]
			flashbangs = g.players.flashbangs[idx]
			activeWeapon = g.players.activeWeapon[idx]
			spawnProtectionTimeLeft = g.spawnProtectionTimeLeftLocked(idx, nowMS)
			loadoutTimeLeft = g.loadoutTimeLeftLocked(idx, nowMS)
		}
		g.mu.Unlock()

		if !ok || !shouldBroadcast {
			return
		}

		ps := playerState{
			Pos:                       respawnPos,
			Hp:                        respawnHP,
			Armor:                     respawnArmor,
			Credits:                   respawnCredits,
			Team:                      team,
			PistolWeapon:              pistolWeapon,
			PistolClip:                pistolClip,
			PistolReserve:             pistolReserve,
			HeavyWeapon:               heavyWeapon,
			HeavyClip:                 heavyClip,
			HeavyReserve:              heavyReserve,
			Bombs:                     bombs,
			Smokes:                    smokes,
			Flashbangs:                flashbangs,
			FlashTimeLeftMS:           0,
			SpawnProtectionTimeLeftMS: spawnProtectionTimeLeft,
			LoadoutTimeLeftMS:         loadoutTimeLeft,
			ActiveWeapon:              activeWeapon,
			Reloading:                 false,
			ReloadTimeLeftMS:          0,
			Crouching:                 false,
			Alive:                     true,
		}
		respawnMsg := encodeRespawnBinary(victimID, ps, nowMS)
		g.broadcast(respawnMsg, 0)
	}()
}

func (g *Game) respawnPlayerLocked(idx int, nowMS int64) {
	teamSpawns := g.spawnPointsForTeamLocked(g.players.team[idx])
	if normalizeMode(g.mode) == ModeDeathmatch {
		teamSpawns = g.mapSpawns
		if g.players.pistolWeapon[idx] == "" {
			g.players.pistolWeapon[idx] = defaultPistolForTeam(g.players.team[idx])
		}
		g.giveWeaponFullAmmoLocked(idx, g.players.pistolWeapon[idx])
		if g.players.heavyWeapon[idx] == "" {
			if normalizeTeam(g.players.team[idx]) == TeamGreen {
				g.players.heavyWeapon[idx] = WeaponID("ak-47")
			} else {
				g.players.heavyWeapon[idx] = WeaponID("m4a4")
			}
		}
		if g.players.heavyWeapon[idx] != "" {
			g.giveWeaponFullAmmoLocked(idx, g.players.heavyWeapon[idx])
			g.players.activeWeapon[idx] = g.players.heavyWeapon[idx]
		} else {
			g.players.activeWeapon[idx] = g.players.pistolWeapon[idx]
		}
		g.players.spawnProtectedUntil[idx] = nowMS + deathmatchSpawnProtectionMS
		g.players.loadoutEndsAt[idx] = nowMS + deathmatchLoadoutWindowMS
	} else {
		g.clearDeathmatchSpawnStateLocked(idx)
		g.reloadLoadoutForRoundLocked(idx)
	}
	spawn := teamSpawns[rand.Intn(len(teamSpawns))]
	g.players.pos[idx] = spawn
	g.players.crouching[idx] = false
	g.players.velY[idx] = 0
	g.players.onGround[idx] = true
	g.players.hp[idx] = maxHP
	g.players.alive[idx] = true
	g.players.flashEndsAt[idx] = 0
	g.players.activeWeapon[idx] = g.normalizeActiveWeaponLocked(idx, g.players.activeWeapon[idx])
	g.players.shotBloom[idx] = 0
	g.players.bloomWeapon[idx] = g.players.activeWeapon[idx]
	g.players.lastShotAt[idx] = 0
	g.players.recoilPitch[idx] = 0
	g.players.recoilYaw[idx] = 0
	g.players.recoilShotIndex[idx] = 0
	g.clearReloadLocked(idx)
	g.players.nextAttackAt[idx] = 0
	recordPositionSample(&g.players.history[idx], nowMS, spawn, false)
}

func (g *Game) startMatchLocked(nowMS int64) {
	g.state = StatePlaying
	g.currentRound = 1
	g.blueLossStreak = 0
	g.greenLossStreak = 0
	if normalizeMode(g.mode) == ModeDeathmatch {
		g.roundEndsAt = nowMS + deathmatchDurationMS
		g.buyEndsAt = 0
	} else {
		g.roundEndsAt = nowMS + roundDurationMS
		g.buyEndsAt = nowMS + buyPhaseDurationMS
	}
	g.intermissionEndsAt = 0
	g.roundWinner = TeamNone
	g.pendingMatchEnd = false
	g.blueScore = 0
	g.greenScore = 0
	g.projectiles = nil
	g.effects = nil
	g.nextProjID = 0
	g.deathmatchVoteEnds = 0
	clear(g.deathmatchVotes)
	g.resetHealthRestorePointsLocked()
	for i := range g.players.ids {
		if g.players.inMatch[i] {
			g.resetPlayerForNewMatchLocked(i, nowMS)
			continue
		}
		g.players.alive[i] = false
		g.dropCarrierLocked(g.players.ids[i], nowMS)
		g.players.flashEndsAt[i] = 0
		g.clearDeathmatchSpawnStateLocked(i)
		g.players.shotBloom[i] = 0
		g.players.bloomWeapon[i] = WeaponKnife
		g.players.lastShotAt[i] = 0
		g.players.recoilPitch[i] = 0
		g.players.recoilYaw[i] = 0
		g.players.recoilShotIndex[i] = 0
		g.players.nextAttackAt[i] = 0
		g.clearReloadLocked(i)
	}
	g.resetObjectivesLocked(nowMS)
}

func (g *Game) resetObjectivesLocked(nowMS int64) {
	g.blueCTFCaptures = 0
	g.greenCTFCaptures = 0

	blueBase := Vec3{0, 1.7, 0}
	greenBase := Vec3{0, 1.7, 0}
	if len(g.mapFlagBases) == 2 {
		for _, b := range g.mapFlagBases {
			if normalizeTeam(TeamID(b.Team)) == TeamBlue {
				blueBase = Vec3{b.X, 1.7, b.Z}
			} else if normalizeTeam(TeamID(b.Team)) == TeamGreen {
				greenBase = Vec3{b.X, 1.7, b.Z}
			}
		}
	} else {
		// Fallback to spawn centroids
		var blueSum, greenSum Vec3
		var blueCount, greenCount int
		for i := range g.players.ids {
			if g.players.inMatch[i] && g.players.team[i] == TeamBlue {
				blueSum[0] += g.players.pos[i][0]
				blueSum[1] += g.players.pos[i][1]
				blueSum[2] += g.players.pos[i][2]
				blueCount++
			} else if g.players.inMatch[i] && g.players.team[i] == TeamGreen {
				greenSum[0] += g.players.pos[i][0]
				greenSum[1] += g.players.pos[i][1]
				greenSum[2] += g.players.pos[i][2]
				greenCount++
			}
		}
		if blueCount > 0 {
			blueBase = Vec3{blueSum[0] / float64(blueCount), blueSum[1] / float64(blueCount), blueSum[2] / float64(blueCount)}
		}
		if greenCount > 0 {
			greenBase = Vec3{greenSum[0] / float64(greenCount), greenSum[1] / float64(greenCount), greenSum[2] / float64(greenCount)}
		}
	}

	g.flags[0] = flagState{Team: TeamBlue, Pos: blueBase, HomePos: blueBase, AtHome: true}
	g.flags[1] = flagState{Team: TeamGreen, Pos: greenBase, HomePos: greenBase, AtHome: true}

	g.hostages = nil
	g.nextHostageID = 0
	for _, hm := range g.mapHostages {
		g.nextHostageID++
		g.hostages = append(g.hostages, hostageState{
			ID:    g.nextHostageID,
			Pos:   Vec3{hm.X, 1.7, hm.Z},
			Alive: true,
		})
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
	g.resetHealthRestorePointsLocked()
	for i := range g.players.ids {
		if g.players.inMatch[i] {
			g.respawnPlayerLocked(i, nowMS)
		}
	}

	g.hostages = nil
	g.nextHostageID = 0
	for _, hm := range g.mapHostages {
		g.nextHostageID++
		g.hostages = append(g.hostages, hostageState{
			ID:    g.nextHostageID,
			Pos:   Vec3{hm.X, 1.7, hm.Z},
			Alive: true,
		})
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
	g.blueLossStreak = 0
	g.greenLossStreak = 0
	g.deathmatchVoteEnds = 0
	g.resetHealthRestorePointsLocked()
	clear(g.deathmatchVotes)
	for i := range g.players.ids {
		g.players.inMatch[i] = false
		g.players.alive[i] = false
		g.players.flashEndsAt[i] = 0
		g.clearDeathmatchSpawnStateLocked(i)
		g.players.shotBloom[i] = 0
		g.players.bloomWeapon[i] = g.players.activeWeapon[i]
		g.players.lastShotAt[i] = 0
		g.players.recoilPitch[i] = 0
		g.players.recoilYaw[i] = 0
		g.players.recoilShotIndex[i] = 0
		g.clearReloadLocked(i)
	}
}

func (g *Game) startDeathmatchVoteLocked(nowMS int64) {
	g.state = StateWaiting
	g.roundEndsAt = 0
	g.buyEndsAt = 0
	g.intermissionEndsAt = 0
	g.roundWinner = TeamNone
	g.pendingMatchEnd = false
	g.projectiles = nil
	g.effects = nil
	g.nextProjID = 0
	g.blueLossStreak = 0
	g.greenLossStreak = 0
	g.deathmatchVoteEnds = nowMS + deathmatchVoteMS
	g.resetHealthRestorePointsLocked()
	clear(g.deathmatchVotes)
	g.removeAllBotsLocked()
	for i := range g.players.ids {
		if g.players.isBot[i] {
			continue
		}
		g.players.alive[i] = false
		g.players.flashEndsAt[i] = 0
		g.clearDeathmatchSpawnStateLocked(i)
		g.players.shotBloom[i] = 0
		g.players.bloomWeapon[i] = g.players.activeWeapon[i]
		g.players.lastShotAt[i] = 0
		g.players.recoilPitch[i] = 0
		g.players.recoilYaw[i] = 0
		g.players.recoilShotIndex[i] = 0
		g.players.nextAttackAt[i] = 0
		g.clearReloadLocked(i)
	}
}

func (g *Game) resolveDeathmatchVoteLocked(nowMS int64) bool {
	if !g.isDeathmatchVoteActiveLocked(nowMS) && g.deathmatchVoteEnds == 0 {
		return false
	}

	accepted := 0
	for i := range g.players.ids {
		if g.players.isBot[i] || g.players.names[i] == "" {
			continue
		}
		yes := g.deathmatchVotes[g.players.ids[i]]
		g.players.inMatch[i] = yes
		if yes {
			accepted++
			continue
		}
		g.players.alive[i] = false
	}
	g.deathmatchVoteEnds = 0
	clear(g.deathmatchVotes)

	if accepted == 0 {
		g.endMatchLocked()
		return false
	}

	g.syncDeathmatchBotLocked(nowMS, true)
	g.startMatchLocked(nowMS)
	return true
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
	g.awardRoundEconomyLocked(team)

	g.intermissionEndsAt = nowMS + roundCooldownMS
	g.roundWinner = normalizeTeam(team)
	g.pendingMatchEnd = g.currentRound >= totalRounds
	g.roundEndsAt = 0
	g.buyEndsAt = 0
	g.projectiles = nil
	g.effects = nil
	g.nextProjID = 0
	g.resetHealthRestorePointsLocked()
	for i := range g.players.ids {
		g.players.flashEndsAt[i] = 0
		g.players.shotBloom[i] = 0
		g.players.bloomWeapon[i] = g.players.activeWeapon[i]
		g.players.lastShotAt[i] = 0
		g.players.recoilPitch[i] = 0
		g.players.recoilYaw[i] = 0
		g.players.recoilShotIndex[i] = 0
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
	// Round messages always use full snapshot (reliable, resets baselines).
	g.snapshotSeq = (g.snapshotSeq + 1) & 0xFFFF
	seq := g.snapshotSeq
	msg := g.encodeStateBinary(msgServerRound, nowMS, seq)

	// Also store in snapshot buffer so clients can ack it as a baseline.
	currentStates := make(map[int][]byte, len(g.players.ids))
	for i, id := range g.players.ids {
		ps := g.buildPlayerStateLocked(i, nowMS)
		data := make([]byte, playerStateDataSize)
		quantizePlayerBlock(data, ps)
		currentStates[id] = data
	}
	g.snapshotBuf.store(seq, currentStates)

	g.mu.RUnlock()
	g.broadcast(msg, 0)
}

func (g *Game) tick(nowMS int64) {
	shouldBroadcastLobby := false
	shouldBroadcastRound := false
	shouldBroadcastState := false
	tickEvents := newTickMessages()

	g.mu.Lock()
	if g.deathmatchVoteEnds > 0 && nowMS >= g.deathmatchVoteEnds {
		if g.resolveDeathmatchVoteLocked(nowMS) {
			shouldBroadcastRound = true
		} else {
			shouldBroadcastLobby = true
		}
	}
	if g.state == StatePlaying {
		g.processInputsLocked(nowMS)
		modeNorm := normalizeMode(g.mode)
		if modeNorm == ModeDeathmatch || modeNorm == ModeCTF {
			tickEvents = g.updateReloadsAndProjectilesLocked(nowMS)
			g.tickFallbackBotsLocked(nowMS, tickEvents)
			if modeNorm == ModeDeathmatch {
				g.tickHealthRestorePointsLocked(nowMS)
			}
			if modeNorm == ModeCTF {
				g.tickCTFLocked(nowMS, tickEvents)
			}
			if g.roundEndsAt > 0 && nowMS >= g.roundEndsAt || (modeNorm == ModeCTF && (g.blueCTFCaptures >= ctfCapturesToWin || g.greenCTFCaptures >= ctfCapturesToWin)) {
				g.startDeathmatchVoteLocked(nowMS)
				shouldBroadcastLobby = true
			} else {
				shouldBroadcastState = true
			}
		} else {
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
				g.tickFallbackBotsLocked(nowMS, tickEvents)
				if modeNorm == ModeHostage {
					g.tickHostageLocked(nowMS, tickEvents)
				}
				if winner := g.roundWinnerByEliminationLocked(); winner != TeamNone {
					g.beginRoundCooldownLocked(winner, nowMS)
					shouldBroadcastRound = true
				} else if g.roundEndsAt > 0 && nowMS >= g.roundEndsAt {
					winner := g.roundWinnerByTimeoutLocked()
					if modeNorm == ModeHostage {
						winner = TeamGreen // defenders win on timeout
					}
					g.beginRoundCooldownLocked(winner, nowMS)
					shouldBroadcastRound = true
				} else if g.state == StatePlaying {
					shouldBroadcastState = true
				}
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

func (g *Game) handleBinaryMessage(playerID int, sendCh chan []byte, buf []byte) {
	if len(buf) == 0 {
		return
	}

	switch buf[0] {
	case msgClientInput:
		if !g.isPlaying() {
			return
		}
		cmd, snapshotAck, ok := decodeBinaryInput(buf)
		if !ok {
			return
		}
		g.mu.Lock()
		idx, ok := g.players.indexOf(playerID)
		if ok && g.players.inMatch[idx] {
			// Buffer input for processing in the next tick.
			g.players.inputQueue[idx] = append(g.players.inputQueue[idx], cmd)
			// Set yaw/pitch immediately so lag comp and bot targeting see current aim.
			g.players.yaw[idx] = cmd.Yaw
			g.players.pitch[idx] = cmd.Pitch
			// Track last acked snapshot for delta compression.
			if snapshotAck != 0 {
				g.players.lastAckedSnapshotSeq[idx] = snapshotAck
			}
		}
		g.mu.Unlock()

	case msgClientShoot:
		if !g.isPlaying() {
			return
		}
		nowMS := time.Now().UnixMilli()
		sh, ok := decodeBinaryShoot(buf, nowMS)
		if !ok {
			return
		}
		dir := normalizeVec(sh.Dir)
		shotTime := clampShotTime(sh.ShotTime, nowMS)
		aiming := sh.Aiming
		alternate := sh.Alternate

		g.mu.Lock()
		idx, ok := g.players.indexOf(playerID)
		if !ok || !g.players.inMatch[idx] || !g.players.alive[idx] || g.hasSpawnProtectionLocked(idx, nowMS) || nowMS < g.buyEndsAt || g.isIntermissionLocked(nowMS) {
			g.mu.Unlock()
			return
		}
		weapon := g.normalizeActiveWeaponLocked(idx, sh.Weapon)
		g.players.activeWeapon[idx] = weapon
		if !isCombatWeapon(weapon) {
			g.mu.Unlock()
			return
		}
		alternate = alternate && weapon == WeaponKnife
		if g.isReloadingLocked(idx, nowMS) {
			g.mu.Unlock()
			return
		}
		config := effectiveWeaponConfig(weapon, alternate)
		if nowMS < g.players.nextAttackAt[idx] {
			g.mu.Unlock()
			return
		}
		if config.UsesAmmo && !g.spendAmmoLocked(idx, weapon, 1) {
			g.mu.Unlock()
			return
		}
		bloom := g.registerShotBloomLocked(idx, weapon, nowMS)
		moving := isMovingAtTime(&g.players.history[idx], shotTime)
		g.registerShotRecoilLocked(idx, weapon, nowMS, aiming, moving)
		dir = applyShotSpread(dir, config, aiming, g.players.crouching[idx], moving, bloom, shotTime+int64(playerID)*97+nowMS)
		g.players.nextAttackAt[idx] = nowMS + config.FireIntervalMS
		shooterPos := positionAtTime(&g.players.history[idx], shotTime)
		g.mu.Unlock()

		shotMsg := encodeShotBinary(playerID, shooterPos, dir, weapon, alternate)
		g.broadcast(shotMsg, 0)

		hit := g.findHitTargetLocked(playerID, shooterPos, dir, shotTime, config.Range)
		if hit == nil {
			return
		}

		damage := damageForConfig(config, hit.zone)
		appliedHit := false
		killed := false
		victimID := hit.id

		g.mu.Lock()
		if hit.isHostage {
			if hit.index >= 0 && hit.index < len(g.hostages) && g.hostages[hit.index].Alive {
				g.hostages[hit.index].Alive = false
				g.hostages[hit.index].FollowerID = 0
				shooterIdx, ok := g.players.indexOf(playerID)
				if ok {
					g.players.credits[shooterIdx] -= hostageDeathPenalty
					if g.players.credits[shooterIdx] < 0 {
						g.players.credits[shooterIdx] = 0
					}
					update := g.applyEconomyUpdateLocked(shooterIdx, true, "penalty", "hostage", "Hostage Killed Penalty", "", -hostageDeathPenalty, nowMS)
					g.mu.Unlock()
					killMsg := encodeKillBinary(playerID, 0xFF, weapon)
					g.broadcast(killMsg, 0)
					g.sendToPlayer(playerID, &update)
					return
				}
			}
			g.mu.Unlock()
			return
		}

		victimHP := 0
		victimArmor := 0
		absorbedDamage := 0
		var shooterUpdate *economyUpdate

		victimIdx, ok := g.players.indexOf(victimID)
		shooterIdx, shooterOK := g.players.indexOf(playerID)
		if ok && shooterOK && g.players.alive[victimIdx] && g.canPlayersDamageAtLocked(shooterIdx, victimIdx, shotTime) {
			appliedHit = true
			victimHP, victimArmor, absorbedDamage = applyDamage(g.players.hp[victimIdx], g.players.armor[victimIdx], damage)
			g.players.hp[victimIdx] = victimHP
			g.players.armor[victimIdx] = victimArmor

			if victimHP <= 0 {
				g.players.alive[victimIdx] = false
				g.players.deaths[victimIdx]++
				g.dropCarrierLocked(victimID, nowMS)
				g.stripLoadoutOnDeathLocked(victimIdx)
				killed = true
				g.players.kills[shooterIdx]++
				g.awardDeathmatchKillAmmoLocked(shooterIdx, weapon)
				rewardAmount := g.addCreditsLocked(shooterIdx, killRewardForWeapon(weapon))
				if rewardAmount != 0 {
					update := g.applyEconomyUpdateLocked(shooterIdx, true, "reward", string(weapon), "Elimination reward", "", rewardAmount, nowMS)
					shooterUpdate = &update
				}
				if normalizeMode(g.mode) == ModeDeathmatch {
					g.scheduleRespawn(victimID, g.currentRound)
				}
			}
		}
		g.mu.Unlock()

		if !appliedHit {
			return
		}

		hitMsg := encodeHitBinary(playerID, victimID, damage, hit.zone, weapon, victimHP, victimArmor, absorbedDamage)
		g.broadcast(hitMsg, 0)
		if shooterUpdate != nil {
			g.sendToPlayer(playerID, shooterUpdate)
		}

		if killed {
			killMsg := encodeKillBinary(playerID, victimID, weapon)
			g.broadcast(killMsg, 0)
		}

	case msgClientThrow:
		if !g.isPlaying() {
			return
		}
		th, ok := decodeBinaryThrow(buf)
		if !ok {
			return
		}
		dir := normalizeVec(th.Dir)
		nowMS := time.Now().UnixMilli()
		g.mu.Lock()
		idx, ok := g.players.indexOf(playerID)
		if !ok {
			g.mu.Unlock()
			return
		}
		weapon := g.normalizeActiveWeaponLocked(idx, th.Weapon)
		var update economyUpdate
		switch {
		case !g.players.inMatch[idx]:
			update = g.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Join the next match first", 0, nowMS)
		case !g.players.alive[idx]:
			update = g.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Only alive players can throw utility", 0, nowMS)
		case g.hasSpawnProtectionLocked(idx, nowMS):
			update = g.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Spawn protection is still active", 0, nowMS)
		case g.isIntermissionLocked(nowMS):
			update = g.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Round is over", 0, nowMS)
		case nowMS < g.buyEndsAt:
			update = g.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Buy time is still active", 0, nowMS)
		case !isUtilityWeaponID(weapon):
			update = g.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Selected item is not throwable", 0, nowMS)
		case g.isReloadingLocked(idx, nowMS):
			update = g.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Cannot throw while reloading", 0, nowMS)
		case nowMS < g.players.nextAttackAt[idx]:
			update = g.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "Utility is not ready yet", 0, nowMS)
		case !g.spendUtilityLocked(idx, weapon):
			update = g.applyEconomyUpdateLocked(idx, false, "throw", string(weapon), "", "No utility remaining", 0, nowMS)
		default:
			g.players.activeWeapon[idx] = weapon
			g.players.nextAttackAt[idx] = nowMS + utilityThrowIntervalMS
			g.spawnProjectileLocked(playerID, weapon, g.players.pos[idx], dir, nowMS)
			g.players.activeWeapon[idx] = g.normalizeActiveWeaponLocked(idx, weapon)
			update = g.applyEconomyUpdateLocked(idx, true, "throw", string(weapon), string(weapon), "", 0, nowMS)
		}
		g.mu.Unlock()
		queueJSON(sendCh, update)

	case msgClientReload:
		nowMS := time.Now().UnixMilli()
		g.mu.Lock()
		idx, ok := g.players.indexOf(playerID)
		if !ok {
			g.mu.Unlock()
			return
		}
		weapon := g.normalizeActiveWeaponLocked(idx, g.players.activeWeapon[idx])
		var update economyUpdate
		switch {
		case g.state != StatePlaying:
			update = g.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Match has not started", 0, nowMS)
		case g.isIntermissionLocked(nowMS):
			update = g.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Round is over", 0, nowMS)
		case !g.players.inMatch[idx]:
			update = g.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Join the next match first", 0, nowMS)
		case !g.players.alive[idx]:
			update = g.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Only alive players can reload", 0, nowMS)
		case !(isPistolWeapon(weapon) || isHeavyWeapon(weapon)):
			update = g.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Current item cannot reload", 0, nowMS)
		case g.isReloadingLocked(idx, nowMS):
			update = g.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Already reloading", 0, nowMS)
		case !g.startReloadLocked(idx, weapon, nowMS):
			update = g.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "Magazine is already full", 0, nowMS)
			if g.currentReserveLocked(idx, weapon) == 0 {
				update = g.applyEconomyUpdateLocked(idx, false, "reload", string(weapon), "", "No reserve ammo", 0, nowMS)
			}
		default:
			update = g.applyEconomyUpdateLocked(idx, true, "reload", string(weapon), "", "", 0, nowMS)
		}
		g.mu.Unlock()
		queueJSON(sendCh, update)

	case msgClientSwitch:
		w, ok := decodeBinarySwitch(buf)
		if !ok {
			return
		}
		nowMS := time.Now().UnixMilli()
		g.mu.Lock()
		idx, ok := g.players.indexOf(playerID)
		if ok && g.players.inMatch[idx] && !g.isReloadingLocked(idx, nowMS) {
			g.players.activeWeapon[idx] = g.normalizeActiveWeaponLocked(idx, w)
		}
		g.mu.Unlock()

	case msgClientBuy:
		item, ok := decodeBinaryBuy(buf)
		if !ok {
			return
		}
		nowMS := time.Now().UnixMilli()
		g.mu.Lock()
		idx, ok := g.players.indexOf(playerID)
		if !ok {
			g.mu.Unlock()
			return
		}
		update := g.applyPurchaseLocked(idx, string(item), nowMS)
		g.mu.Unlock()
		queueJSON(sendCh, update)

	case msgClientPing:
		clientTime, ok := decodeBinaryPing(buf)
		if !ok {
			return
		}
		pongMsg := encodePongBinary(clientTime, time.Now().UnixMilli())
		select {
		case sendCh <- pongMsg:
		default:
		}
	}
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	lobbyID := strings.TrimSpace(r.URL.Query().Get("lobby"))
	lobby, ok := lobbyManager.getLobby(lobbyID)
	if !ok {
		http.Error(w, "Unknown lobby", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade error:", err)
		return
	}

	game := lobby.Game
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
		lobbyManager.removeLobbyIfEmpty(lobby.ID)
		close(sendCh)
	}()

	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			break
		}

		// Binary messages have first byte != '{' (0x7B)
		if len(msgBytes) > 0 && msgBytes[0] != '{' {
			game.handleBinaryMessage(playerID, sendCh, msgBytes)
			continue
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
				if game.state == StatePlaying && normalizeMode(game.mode) == ModeTeam && normalizeTeam(game.players.team[idx]) == TeamNone {
					game.players.team[idx] = game.preferredTeamLocked()
					game.players.inMatch[idx] = true
					game.respawnPlayerLocked(idx, nowMS)
				} else if game.state == StatePlaying && normalizeMode(game.mode) == ModeDeathmatch {
					game.players.inMatch[idx] = false
					game.players.alive[idx] = false
				}
				game.syncModeBotsLocked(nowMS)
				idx, ok = game.players.indexOf(playerID)
				if !ok {
					game.mu.Unlock()
					continue
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
				welcome["pistolWeapon"] = playerState.PistolWeapon
				welcome["pistolClip"] = playerState.PistolClip
				welcome["pistolReserve"] = playerState.PistolReserve
				welcome["heavyWeapon"] = playerState.HeavyWeapon
				welcome["heavyClip"] = playerState.HeavyClip
				welcome["heavyReserve"] = playerState.HeavyReserve
				welcome["bombs"] = playerState.Bombs
				welcome["smokes"] = playerState.Smokes
				welcome["flashbangs"] = playerState.Flashbangs
				welcome["flashTimeLeftMs"] = playerState.FlashTimeLeftMS
				welcome["spawnProtectionTimeLeftMs"] = playerState.SpawnProtectionTimeLeftMS
				welcome["loadoutTimeLeftMs"] = playerState.LoadoutTimeLeftMS
				welcome["activeWeapon"] = playerState.ActiveWeapon
				welcome["reloading"] = playerState.Reloading
				welcome["reloadTimeLeftMs"] = playerState.ReloadTimeLeftMS
				welcome["alive"] = playerState.Alive
				welcome["inMatch"] = playerState.InMatch
				welcome["isBot"] = playerState.IsBot
				queueJSON(sendCh, welcome)
				game.broadcastLobby()
			}
			continue
		}

		switch t {
		case "chat":
			var text string
			json.Unmarshal(msg["text"], &text)
			game.broadcastChat(playerID, text)

		case "leaveMatch":
			nowMS := time.Now().UnixMilli()
			game.mu.Lock()
			left := game.leaveMatchLocked(playerID)
			if left {
				game.syncModeBotsLocked(nowMS)
			}
			game.mu.Unlock()
			if left {
				game.broadcastLobby()
			}

		case "mode":
			var requestedMode GameMode
			json.Unmarshal(msg["mode"], &requestedMode)
			nowMS := time.Now().UnixMilli()
			response := map[string]interface{}{
				"t":    "mode",
				"mode": normalizeMode(requestedMode),
			}

			game.mu.Lock()
			switch {
			case !game.setModeLocked(requestedMode, nowMS):
				response["ok"] = false
				response["reason"] = "Mode can only change in the waiting lobby"
			default:
				response["ok"] = true
			}
			game.mu.Unlock()
			queueJSON(sendCh, response)
			game.broadcastLobby()

		case "map":
			var requestedMap string
			json.Unmarshal(msg["map"], &requestedMap)
			response := map[string]interface{}{
				"t":   "map",
				"map": requestedMap,
			}
			game.mu.Lock()
			ok, reason := game.setMapLocked(requestedMap)
			if !ok {
				response["ok"] = false
				response["reason"] = reason
			} else {
				response["ok"] = true
				response["map"] = game.mapName
			}
			game.mu.Unlock()
			queueJSON(sendCh, response)
			if ok {
				game.broadcastLobby()
			}

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
			case !isTeamBased(game.mode):
				response["ok"] = false
				response["reason"] = "Team selection is only available in team mode"
			case normalizeTeam(requestedTeam) == TeamNone:
				response["ok"] = false
				response["reason"] = "Pick blue or green"
			case !game.canAssignTeamLocked(idx, requestedTeam):
				response["ok"] = false
				response["reason"] = "Teams must stay balanced"
			default:
				game.players.team[idx] = normalizeTeam(requestedTeam)
				game.respawnPlayerLocked(idx, nowMS)
				game.syncModeBotsLocked(nowMS)
				response["ok"] = true
			}
			game.mu.Unlock()
			queueJSON(sendCh, response)
			game.broadcastLobby()

		case "rejoin":
			var playAgain bool
			json.Unmarshal(msg["yes"], &playAgain)
			nowMS := time.Now().UnixMilli()
			response := map[string]interface{}{
				"t":  "rejoin",
				"ok": false,
			}

			game.mu.Lock()
			idx, ok := game.players.indexOf(playerID)
			switch {
			case !ok:
			case !game.isDeathmatchVoteActiveLocked(nowMS):
				response["reason"] = "No active replay vote"
			case game.players.isBot[idx]:
				response["reason"] = "Bots cannot vote"
			default:
				game.deathmatchVotes[playerID] = playAgain
				if !playAgain {
					game.players.inMatch[idx] = false
					game.players.alive[idx] = false
				}
				response["ok"] = true
				response["yes"] = playAgain
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
				if game.isDeathmatchVoteActiveLocked(nowMS) {
					startDeniedReason = "Replay vote in progress"
				} else {
					game.setAllNamedPlayersInMatchLocked(true)
					game.syncModeBotsLocked(nowMS)
					if ok, reason := game.canStartMatchLocked(); !ok {
						startDeniedReason = reason
					} else {
						game.startMatchLocked(nowMS)
						shouldBroadcast = true
					}
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

func (g *Game) findHitTargetLocked(shooterID int, origin, dir Vec3, shotTime int64, maxRange float64) *hitCandidate {
	var best *hitCandidate
	bestDist := maxRange
	shooterIdx, shooterOK := g.players.indexOf(shooterID)

	for i, id := range g.players.ids {
		if !shooterOK || !g.canPlayersDamageAtLocked(shooterIdx, i, shotTime) {
			continue
		}

		target := sampleAtTime(&g.players.history[i], shotTime)
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

	if normalizeMode(g.mode) == ModeHostage {
		for i, h := range g.hostages {
			if !h.Alive || h.Rescued {
				continue
			}
			zone, dist, ok := tracePlayerHit(origin, dir, h.Pos, false, maxRange)
			if !ok || dist > bestDist {
				continue
			}
			bestDist = dist
			best = &hitCandidate{
				index:     i,
				id:        h.ID,
				zone:      zone, // HitZone maps nicely
				dist:      dist,
				isHostage: true,
			}
		}
	}

	return best
}

func findHitTargetLocked(shooterID int, origin, dir Vec3, shotTime int64, maxRange float64) *hitCandidate {
	return game.findHitTargetLocked(shooterID, origin, dir, shotTime, maxRange)
}

func findHitTarget(shooterID int, origin, dir Vec3, shotTime int64, maxRange float64) *hitCandidate {
	game.mu.RLock()
	defer game.mu.RUnlock()
	return game.findHitTargetLocked(shooterID, origin, dir, shotTime, maxRange)
}

func recordPositionSample(history *positionRingBuffer, at int64, pos Vec3, crouching bool) {
	history.add(positionSample{At: at, Pos: pos, Crouching: crouching})
	history.trimBefore(at - positionHistoryWindowMS)
}

func positionAtTime(r *positionRingBuffer, at int64) Vec3 {
	return sampleAtTime(r, at).Pos
}

func sampleAtTime(r *positionRingBuffer, at int64) positionSample {
	n := r.count
	if n == 0 {
		return positionSample{}
	}
	last := r.at(n - 1)
	if at <= 0 || at >= last.At {
		return last
	}
	first := r.at(0)
	if at <= first.At {
		return first
	}

	// Binary search: find the first index where r.at(i).At >= at
	i := sort.Search(n, func(j int) bool {
		return r.at(j).At >= at
	})
	if i == 0 {
		return r.at(0)
	}
	if i >= n {
		return r.at(n - 1)
	}

	prev := r.at(i - 1)
	next := r.at(i)
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

func playerHitBoxes(pos Vec3, crouching bool) [3]hitBox {
	eyeHeight := standEyeHeight
	if crouching {
		eyeHeight = crouchEyeHeight
	}
	footY := pos[1] - eyeHeight

	if crouching {
		return [3]hitBox{
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

	return [3]hitBox{
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

func yawPitchFromDirection(dir Vec3) (yaw, pitch float64) {
	dir = normalizeVec(dir)
	yaw = math.Atan2(-dir[0], -dir[2])
	pitch = math.Asin(math.Max(-1, math.Min(1, dir[1])))
	return yaw, pitch
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

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func handleLobbyListOrCreate(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, lobbyManager.listPublicLobbies())
	case http.MethodPost:
		var req struct {
			Name    string `json:"name"`
			Private bool   `json:"private"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid lobby request"})
			return
		}
		lobby := lobbyManager.createLobby(req.Name, req.Private)
		writeJSON(w, http.StatusCreated, lobby.summary())
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleLobbyJoinKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid join key request"})
		return
	}

	lobby, ok := lobbyManager.findLobbyByKey(req.Key)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Lobby not found"})
		return
	}
	writeJSON(w, http.StatusOK, lobby.summary())
}

func main() {
	port := serverPort()
	clientDir := resolveClientDir()

	// Load default map geometry from JSON at startup
	if spawns, walls, platforms, boxes, arena, wHeight, wThick, err := loadMapGeometry(clientDir, defaultMapName); err == nil {
		defaultSpawns = spawns
		game.mapWallsRuntime = walls
		game.mapPlatformsRuntime = platforms
		game.mapBoxesRuntime = boxes
		game.mapArenaSize = arena
		game.mapWallHeight = wHeight
		game.mapWallThickness = wThick
		log.Printf("Loaded %d spawn points, %d walls, %d platforms, %d boxes from %s", len(spawns), len(walls), len(platforms), len(boxes), defaultMapName)
	} else {
		log.Printf("Using hardcoded spawns: %v", err)
	}

	http.Handle("/", staticClientHandler(http.Dir(clientDir)))
	http.HandleFunc("/api/lobbies", handleLobbyListOrCreate)
	http.HandleFunc("/api/lobbies/join-key", handleLobbyJoinKey)
	http.HandleFunc("/ws", handleWS)
	http.HandleFunc("/api/maps", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		names := listMaps(clientDir)
		json.NewEncoder(w).Encode(names)
	})

	go func() {
		ticker := time.NewTicker(time.Second / tickRate)
		for range ticker.C {
			lobbyManager.tickAll(time.Now().UnixMilli())
		}
	}()

	lanIP := getLANIP()
	log.Printf("FPS server running on http://%s:%s (LAN) and http://localhost:%s", lanIP, port, port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func (g *Game) tickHostageLocked(nowMS int64, tm *tickMessages) {
	dt := 1.0 / float64(tickRate)
	hostageRescued := false

	for i := range g.hostages {
		h := &g.hostages[i]
		if !h.Alive || h.Rescued {
			continue
		}

		if h.FollowerID == 0 {
			// Check pickup
			for j, pid := range g.players.ids {
				if g.players.inMatch[j] && g.players.alive[j] && g.players.team[j] == TeamBlue {
					if distanceVec3(h.Pos, g.players.pos[j]) <= hostagePickupRadius {
						h.FollowerID = pid
						break
					}
				}
			}
		} else {
			// Follow
			fIdx, ok := g.players.indexOf(h.FollowerID)
			if !ok || !g.players.alive[fIdx] || !g.players.inMatch[fIdx] || g.players.team[fIdx] != TeamBlue {
				h.FollowerID = 0
			} else {
				fPos := g.players.pos[fIdx]
				dist := distanceVec3(h.Pos, fPos)
				if dist > hostageFollowDist {
					dir := normalizeVec(Vec3{fPos[0] - h.Pos[0], 0, fPos[2] - h.Pos[2]})
					h.Pos[0] += dir[0] * hostageFollowSpeed * dt
					h.Pos[2] += dir[2] * hostageFollowSpeed * dt
				}

				// Check rescue
				for _, rz := range g.mapRescueZones {
					if distanceVec3(h.Pos, Vec3{rz.Cx, h.Pos[1], rz.Cz}) <= rz.Radius {
						h.Rescued = true
						h.FollowerID = 0
						g.players.credits[fIdx] += hostageRescueReward
						tm.addDirect(g.players.ids[fIdx], g.applyEconomyUpdateLocked(fIdx, true, "reward", "rescue", "Hostage Rescue Reward", "", hostageRescueReward, nowMS))
						hostageRescued = true
						break
					}
				}
			}
		}
	}

	if hostageRescued {
		allRescued := true
		for _, h := range g.hostages {
			if h.Alive && !h.Rescued {
				allRescued = false
				break
			}
		}
		if allRescued {
			g.beginRoundCooldownLocked(TeamBlue, nowMS)
		}
	}
}

func (g *Game) tickCTFLocked(nowMS int64, tm *tickMessages) {
	for i := range g.flags {
		f := &g.flags[i]
		if f.CarrierID == 0 {
			if f.Dropped && nowMS >= f.DroppedAt+flagAutoReturnSec*1000 {
				f.Dropped = false
				f.AtHome = true
				f.Pos = f.HomePos
			}

			// Check pickup/return
			for j, pid := range g.players.ids {
				if g.players.inMatch[j] && g.players.alive[j] {
					fTeam := g.flags[i].Team
					pTeam := g.players.team[j]
					dist := distanceVec3(f.Pos, g.players.pos[j])
					if dist <= flagPickupRadius {
						if pTeam != fTeam {
							// Pickup enemy flag
							if f.CarrierID == 0 {
								// make sure a player only carries one flag at a time
								carrying := false
								for k := range g.flags {
									if g.flags[k].CarrierID == pid {
										carrying = true
									}
								}
								if !carrying {
									f.CarrierID = pid
									f.Dropped = false
									f.AtHome = false
								}
							}
						} else if f.Dropped {
							// Return friendly flag
							f.Dropped = false
							f.AtHome = true
							f.Pos = f.HomePos
						}
					}
				}
			}
		} else {
			// Update carrier pos
			cIdx, ok := g.players.indexOf(f.CarrierID)
			if !ok || !g.players.alive[cIdx] || !g.players.inMatch[cIdx] {
				f.CarrierID = 0
				f.Dropped = true
				f.DroppedAt = nowMS
			} else {
				f.Pos = g.players.pos[cIdx]
				pTeam := g.players.team[cIdx]

				// Ensure they don't carry their own team's flag due to team swap
				if pTeam == f.Team {
					f.CarrierID = 0
					f.Dropped = true
					f.DroppedAt = nowMS
					continue
				}

				// Check capture
				homeFlagIdx := 0
				if pTeam == TeamGreen {
					homeFlagIdx = 1
				}
				homeFlag := &g.flags[homeFlagIdx]
				if homeFlag.AtHome && distanceVec3(f.Pos, homeFlag.Pos) <= flagCaptureRadius {
					f.CarrierID = 0
					f.Dropped = false
					f.AtHome = true
					f.Pos = f.HomePos
					if pTeam == TeamBlue {
						g.blueCTFCaptures++
					} else {
						g.greenCTFCaptures++
					}
				}
			}
		}
	}
}

func (g *Game) dropCarrierLocked(playerID int, nowMS int64) {
	for i := range g.hostages {
		if g.hostages[i].FollowerID == playerID {
			g.hostages[i].FollowerID = 0
		}
	}
	for i := range g.flags {
		if g.flags[i].CarrierID == playerID {
			g.flags[i].CarrierID = 0
			g.flags[i].Dropped = true
			g.flags[i].DroppedAt = nowMS
		}
	}
}
