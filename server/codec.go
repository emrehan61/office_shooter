package main

import (
	"encoding/binary"
	"math"
)


// ─── Binary message type IDs ───────────────────────────────────────────────

// Client → Server
const (
	msgClientInput  byte = 0x02
	msgClientShoot  byte = 0x03
	msgClientThrow  byte = 0x04
	msgClientReload byte = 0x05
	msgClientSwitch byte = 0x06
	msgClientBuy    byte = 0x07
	msgClientPing   byte = 0x0F
	msgClientDCPing byte = 0x10
)

// Server → Client
const (
	msgServerDeltaState byte = 0x81
	msgServerState      byte = 0x82
	msgServerRound      byte = 0x83
	msgServerInputAck   byte = 0x84
	msgServerShot     byte = 0x85
	msgServerHit      byte = 0x86
	msgServerKill     byte = 0x87
	msgServerRespawn  byte = 0x88
	msgServerPong     byte = 0x8A
	msgServerDCPong   byte = 0x8B
)

// ─── Weapon ID enum ────────────────────────────────────────────────────────

var weaponToByteMap = map[WeaponID]byte{
	"":           0x00,
	"knife":      0x01,
	"bomb":       0x02,
	"smoke":      0x03,
	"flashbang":  0x04,
	"cz75-auto":  0x10,
	"desert-eagle": 0x11,
	"dual-berettas": 0x12,
	"five-seven": 0x13,
	"glock-18":   0x14,
	"p2000":      0x15,
	"p250":       0x16,
	"r8-revolver": 0x17,
	"tec-9":      0x18,
	"usp-s":      0x19,
	"ak-47":      0x20,
	"aug":        0x21,
	"awp":        0x22,
	"famas":      0x23,
	"g3sg1":      0x24,
	"galil-ar":   0x25,
	"m4a1-s":     0x26,
	"m4a4":       0x27,
	"scar-20":    0x28,
	"sg553":      0x29,
	"ssg08":      0x2A,
	"mac10":      0x30,
	"mp5-sd":     0x31,
	"mp7":        0x32,
	"mp9":        0x33,
	"pp-bizon":   0x34,
	"p90":        0x35,
	"ump-45":     0x36,
	"mag-7":      0x40,
	"nova":       0x41,
	"sawed-off":  0x42,
	"xm1014":     0x43,
	"m249":       0x44,
	"negev":      0x45,
}

var byteToWeaponMap [256]WeaponID

func init() {
	for w, b := range weaponToByteMap {
		byteToWeaponMap[b] = w
	}
}

func weaponToByte(w WeaponID) byte {
	if b, ok := weaponToByteMap[w]; ok {
		return b
	}
	return 0xFF
}

func byteToWeapon(b byte) WeaponID {
	return byteToWeaponMap[b]
}

// ─── Team ID enum ──────────────────────────────────────────────────────────

func teamToByte(t TeamID) byte {
	switch t {
	case TeamBlue:
		return 1
	case TeamGreen:
		return 2
	default:
		return 0
	}
}

func byteToTeam(b byte) TeamID {
	switch b {
	case 1:
		return TeamBlue
	case 2:
		return TeamGreen
	default:
		return TeamNone
	}
}

// ─── Game mode enum ────────────────────────────────────────────────────────

func gameModeToByte(m GameMode) byte {
	switch m {
	case ModeDeathmatch:
		return 1
	case ModeHostage:
		return 2
	case ModeCTF:
		return 3
	default:
		return 0
	}
}

// ─── Hit zone enum ─────────────────────────────────────────────────────────

func hitZoneToByte(z HitZone) byte {
	if z == HitZoneHead {
		return 1
	}
	return 0
}

// ─── Effect type enum ──────────────────────────────────────────────────────

func effectTypeToByte(t string) byte {
	if t == "smoke" {
		return 1
	}
	return 0 // bomb is default
}

// ─── Quantization ──────────────────────────────────────────────────────────

func quantizePosXZ(v float64) int16 {
	return int16(math.Round(v * 256))
}

func quantizePosY(v float64) int16 {
	return int16(math.Round(v * 1024))
}

func dequantizePosXZ(v int16) float64 {
	return float64(v) / 256.0
}

func dequantizePosY(v int16) float64 {
	return float64(v) / 1024.0
}

func quantizeYaw(v float64) uint16 {
	return uint16(math.Round(v*65536.0/(2*math.Pi))) & 0xFFFF
}

func dequantizeYaw(v uint16) float64 {
	return float64(v) * (2 * math.Pi) / 65536.0
}

func quantizePitch(v float64) int16 {
	return int16(math.Round(v * 32767.0 / (math.Pi / 2)))
}

func dequantizePitch(v int16) float64 {
	return float64(v) * (math.Pi / 2) / 32767.0
}

func quantizeDir(v float64) int16 {
	return int16(math.Round(v * 32767.0))
}

func dequantizeDir(v int16) float64 {
	return float64(v) / 32767.0
}

func quantizeTimeLeftMS(v int64) uint16 {
	r := (v + 50) / 100 // round to nearest
	if r < 0 {
		return 0
	}
	if r > 65535 {
		return 65535
	}
	return uint16(r)
}

// ─── Little-endian helpers ─────────────────────────────────────────────────

var le = binary.LittleEndian

func putInt16(buf []byte, v int16) {
	le.PutUint16(buf, uint16(v))
}

func getInt16(buf []byte) int16 {
	return int16(le.Uint16(buf))
}

func putUint16(buf []byte, v uint16) {
	le.PutUint16(buf, v)
}

func getUint16(buf []byte) uint16 {
	return le.Uint16(buf)
}

func putUint32(buf []byte, v uint32) {
	le.PutUint32(buf, v)
}

func getUint32(buf []byte) uint32 {
	return le.Uint32(buf)
}

func putInt64(buf []byte, v int64) {
	le.PutUint64(buf, uint64(v))
}

func getInt64(buf []byte) int64 {
	return int64(le.Uint64(buf))
}

// ─── Encode: Server → Client ───────────────────────────────────────────────

// encodePlayerStateBlock writes 39 bytes of player state into buf.
// Returns 39.
func encodePlayerStateBlock(buf []byte, id int, ps playerState, nowMS int64) int {
	_ = buf[38] // bounds check hint
	buf[0] = byte(id)
	putInt16(buf[1:], quantizePosXZ(ps.Pos[0]))
	putInt16(buf[3:], quantizePosY(ps.Pos[1]))
	putInt16(buf[5:], quantizePosXZ(ps.Pos[2]))
	putUint16(buf[7:], quantizeYaw(ps.Yaw))
	putInt16(buf[9:], quantizePitch(ps.Pitch))
	buf[11] = byte(ps.Hp)
	buf[12] = byte(ps.Armor)
	putUint16(buf[13:], uint16(ps.Credits))
	buf[15] = teamToByte(ps.Team)
	putUint16(buf[16:], uint16(ps.Kills))
	putUint16(buf[18:], uint16(ps.Deaths))
	var flags byte
	if ps.Crouching {
		flags |= 0x01
	}
	if ps.Alive {
		flags |= 0x02
	}
	if ps.InMatch {
		flags |= 0x04
	}
	if ps.IsBot {
		flags |= 0x08
	}
	if ps.Reloading {
		flags |= 0x10
	}
	buf[20] = flags
	buf[21] = weaponToByte(ps.PistolWeapon)
	buf[22] = byte(ps.PistolClip)
	buf[23] = byte(ps.PistolReserve)
	buf[24] = weaponToByte(ps.HeavyWeapon)
	buf[25] = byte(ps.HeavyClip)
	buf[26] = byte(ps.HeavyReserve)
	buf[27] = byte(ps.Bombs)
	buf[28] = byte(ps.Smokes)
	buf[29] = byte(ps.Flashbangs)
	putUint16(buf[30:], quantizeTimeLeftMS(ps.FlashTimeLeftMS))
	putUint16(buf[32:], quantizeTimeLeftMS(ps.SpawnProtectionTimeLeftMS))
	putUint16(buf[34:], quantizeTimeLeftMS(ps.LoadoutTimeLeftMS))
	buf[36] = weaponToByte(ps.ActiveWeapon)
	putUint16(buf[37:], quantizeTimeLeftMS(ps.ReloadTimeLeftMS))
	return 39
}

const playerStateBlockSize = 39

// encodeStateBinary encodes a full state tick directly from Game state.
// Must be called with g.mu held (at least RLock).
// snapshotSeq is included in the header so clients can ack it.
func (g *Game) encodeStateBinary(msgType byte, nowMS int64, snapshotSeq uint16) []byte {
	nPlayers := len(g.players.ids)
	nProjectiles := len(g.projectiles)
	nEffects := 0
	for _, e := range g.effects {
		if e.ExpiresAt > nowMS {
			nEffects++
		}
	}

	// Calculate match state sub-arrays sizes
	nHostages := len(g.hostages)
	nFlags := len(g.flags)
	nRescueZones := len(g.mapRescueZones)
	nHealthRestore := len(g.mapHealthRestorePoints)

	matchBaseSize := 25
	hostageSize := 9 * nHostages
	flagSize := 15 * nFlags
	rescueZoneSize := 5 * nRescueZones
	healthRestoreSize := 11 * nHealthRestore

	totalSize := 10 + // header (type + snapshotSeq + serverTime + counts)
		playerStateBlockSize*nPlayers +
		8*nProjectiles +
		10*nEffects +
		matchBaseSize +
		hostageSize +
		flagSize +
		rescueZoneSize +
		healthRestoreSize

	buf := make([]byte, totalSize)
	off := 0

	// Header (10 bytes)
	buf[off] = msgType
	off++
	putUint16(buf[off:], snapshotSeq)
	off += 2
	putUint32(buf[off:], uint32(nowMS))
	off += 4
	buf[off] = byte(nPlayers)
	off++
	buf[off] = byte(nProjectiles)
	off++
	buf[off] = byte(nEffects)
	off++

	// Players
	for i, id := range g.players.ids {
		ps := g.buildPlayerStateLocked(i, nowMS)
		encodePlayerStateBlock(buf[off:], id, ps, nowMS)
		off += playerStateBlockSize
	}

	// Projectiles (8 bytes each)
	for _, p := range g.projectiles {
		buf[off] = byte(p.ID)
		off++
		buf[off] = weaponToByte(p.Type)
		off++
		putInt16(buf[off:], quantizePosXZ(p.Pos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(p.Pos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(p.Pos[2]))
		off += 2
	}

	// Effects (10 bytes each)
	for _, e := range g.effects {
		timeLeft := e.ExpiresAt - nowMS
		if timeLeft <= 0 {
			continue
		}
		buf[off] = effectTypeToByte(e.Type)
		off++
		putInt16(buf[off:], quantizePosXZ(e.Pos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(e.Pos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(e.Pos[2]))
		off += 2
		radius := int(math.Round(e.Radius * 10))
		if radius > 255 {
			radius = 255
		}
		buf[off] = byte(radius)
		off++
		putUint16(buf[off:], uint16(timeLeft))
		off += 2
	}

	// Match state base (25 bytes)
	buf[off] = gameModeToByte(g.mode)
	off++
	buf[off] = byte(g.currentRound)
	off++
	buf[off] = byte(g.totalRoundsLocked())
	off++
	roundTimeLeft := int64(0)
	if g.roundEndsAt > nowMS {
		roundTimeLeft = g.roundEndsAt - nowMS
	}
	putUint32(buf[off:], uint32(roundTimeLeft))
	off += 4
	buyTimeLeft := int64(0)
	if g.buyEndsAt > nowMS {
		buyTimeLeft = g.buyEndsAt - nowMS
	}
	putUint16(buf[off:], uint16(buyTimeLeft))
	off += 2
	var matchFlags byte
	if g.buyEndsAt > nowMS {
		matchFlags |= 0x01
	}
	if g.isIntermissionLocked(nowMS) {
		matchFlags |= 0x02
	}
	if g.isDeathmatchVoteActiveLocked(nowMS) {
		matchFlags |= 0x04
	}
	buf[off] = matchFlags
	off++
	intermissionTimeLeft := int64(0)
	if g.intermissionEndsAt > nowMS {
		intermissionTimeLeft = g.intermissionEndsAt - nowMS
	}
	putUint16(buf[off:], uint16(intermissionTimeLeft))
	off += 2
	buf[off] = teamToByte(g.roundWinner)
	off++
	buf[off] = byte(g.blueScore)
	off++
	buf[off] = byte(g.greenScore)
	off++

	blueAlive, greenAlive := 0, 0
	for i := range g.players.ids {
		if g.players.alive[i] && g.players.inMatch[i] {
			switch g.players.team[i] {
			case TeamBlue:
				blueAlive++
			case TeamGreen:
				greenAlive++
			}
		}
	}
	buf[off] = byte(blueAlive)
	off++
	buf[off] = byte(greenAlive)
	off++

	dmVoteTimeLeft := int64(0)
	if g.isDeathmatchVoteActiveLocked(nowMS) && g.deathmatchVoteEnds > nowMS {
		dmVoteTimeLeft = g.deathmatchVoteEnds - nowMS
	}
	putUint16(buf[off:], uint16(dmVoteTimeLeft))
	off += 2
	buf[off] = byte(nHostages)
	off++
	buf[off] = byte(nFlags)
	off++
	buf[off] = byte(g.blueCTFCaptures)
	off++
	buf[off] = byte(g.greenCTFCaptures)
	off++
	buf[off] = byte(nRescueZones)
	off++
	buf[off] = byte(nHealthRestore)
	off++

	// Hostages (9 bytes each)
	for _, h := range g.hostages {
		buf[off] = byte(h.ID)
		off++
		putInt16(buf[off:], quantizePosXZ(h.Pos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(h.Pos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(h.Pos[2]))
		off += 2
		buf[off] = byte(h.FollowerID)
		off++
		var hFlags byte
		if h.Rescued {
			hFlags |= 0x01
		}
		if h.Alive {
			hFlags |= 0x02
		}
		buf[off] = hFlags
		off++
	}

	// Flags (15 bytes each)
	for _, f := range g.flags {
		buf[off] = teamToByte(f.Team)
		off++
		putInt16(buf[off:], quantizePosXZ(f.Pos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(f.Pos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(f.Pos[2]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(f.HomePos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(f.HomePos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(f.HomePos[2]))
		off += 2
		buf[off] = byte(f.CarrierID)
		off++
		var fFlags byte
		if f.Dropped {
			fFlags |= 0x01
		}
		if f.AtHome {
			fFlags |= 0x02
		}
		buf[off] = fFlags
		off++
	}

	// Rescue zones (5 bytes each)
	for _, rz := range g.mapRescueZones {
		putInt16(buf[off:], quantizePosXZ(rz.Cx))
		off += 2
		putInt16(buf[off:], quantizePosXZ(rz.Cz))
		off += 2
		radius := int(math.Round(rz.Radius * 10))
		if radius > 255 {
			radius = 255
		}
		buf[off] = byte(radius)
		off++
	}

	// Health restore points (11 bytes each)
	for _, hp := range g.mapHealthRestorePoints {
		putInt16(buf[off:], quantizePosXZ(hp.X))
		off += 2
		putInt16(buf[off:], quantizePosXZ(hp.Z))
		off += 2
		radius := int(math.Round(hp.Radius * 10))
		if radius > 255 {
			radius = 255
		}
		buf[off] = byte(radius)
		off++
		buf[off] = byte(hp.HealAmount)
		off++
		putUint16(buf[off:], uint16(hp.CooldownMS/100))
		off += 2
		cooldownLeft := int64(0)
		if hp.CooldownEndsAt > nowMS {
			cooldownLeft = hp.CooldownEndsAt - nowMS
		}
		putUint16(buf[off:], quantizeTimeLeftMS(cooldownLeft))
		off += 2
		var hpFlags byte
		if hp.CooldownEndsAt <= nowMS {
			hpFlags |= 0x01 // active
		}
		buf[off] = hpFlags
		off++
	}

	return buf[:off]
}

// ─── Delta Compression ────────────────────────────────────────────────────

// playerStateData holds the 38 quantized bytes of player state (excluding the
// 1-byte player ID).  The byte layout matches encodePlayerStateBlock bytes [1..38].
const playerStateDataSize = 38

// deltaFieldGroup defines a byte range [Start, End) in the 38-byte player state.
type deltaFieldGroup struct {
	Start, End int
}

// deltaFieldGroups maps each bit in the 16-bit changed mask to a contiguous
// byte range in the 38-byte player state block.
var deltaFieldGroups = [16]deltaFieldGroup{
	{0, 2},   // bit 0:  posX           (2 bytes)
	{2, 4},   // bit 1:  posY           (2 bytes)
	{4, 6},   // bit 2:  posZ           (2 bytes)
	{6, 8},   // bit 3:  yaw            (2 bytes)
	{8, 10},  // bit 4:  pitch          (2 bytes)
	{10, 11}, // bit 5:  hp             (1 byte)
	{11, 12}, // bit 6:  armor          (1 byte)
	{12, 14}, // bit 7:  credits        (2 bytes)
	{14, 19}, // bit 8:  team+kills+deaths (5 bytes)
	{19, 20}, // bit 9:  flags          (1 byte)
	{20, 23}, // bit 10: pistol         (3 bytes)
	{23, 26}, // bit 11: heavy          (3 bytes)
	{26, 29}, // bit 12: utilities      (3 bytes)
	{29, 33}, // bit 13: flash+spawn timers (4 bytes)
	{33, 36}, // bit 14: loadout+activeWeapon (3 bytes)
	{36, 38}, // bit 15: reload timer   (2 bytes)
}

// quantizePlayerBlock writes the 38 bytes of quantized player state (no ID) into dst.
func quantizePlayerBlock(dst []byte, ps playerState) {
	_ = dst[37] // bounds check hint
	putInt16(dst[0:], quantizePosXZ(ps.Pos[0]))
	putInt16(dst[2:], quantizePosY(ps.Pos[1]))
	putInt16(dst[4:], quantizePosXZ(ps.Pos[2]))
	putUint16(dst[6:], quantizeYaw(ps.Yaw))
	putInt16(dst[8:], quantizePitch(ps.Pitch))
	dst[10] = byte(ps.Hp)
	dst[11] = byte(ps.Armor)
	putUint16(dst[12:], uint16(ps.Credits))
	dst[14] = teamToByte(ps.Team)
	putUint16(dst[15:], uint16(ps.Kills))
	putUint16(dst[17:], uint16(ps.Deaths))
	var flags byte
	if ps.Crouching {
		flags |= 0x01
	}
	if ps.Alive {
		flags |= 0x02
	}
	if ps.InMatch {
		flags |= 0x04
	}
	if ps.IsBot {
		flags |= 0x08
	}
	if ps.Reloading {
		flags |= 0x10
	}
	dst[19] = flags
	dst[20] = weaponToByte(ps.PistolWeapon)
	dst[21] = byte(ps.PistolClip)
	dst[22] = byte(ps.PistolReserve)
	dst[23] = weaponToByte(ps.HeavyWeapon)
	dst[24] = byte(ps.HeavyClip)
	dst[25] = byte(ps.HeavyReserve)
	dst[26] = byte(ps.Bombs)
	dst[27] = byte(ps.Smokes)
	dst[28] = byte(ps.Flashbangs)
	putUint16(dst[29:], quantizeTimeLeftMS(ps.FlashTimeLeftMS))
	putUint16(dst[31:], quantizeTimeLeftMS(ps.SpawnProtectionTimeLeftMS))
	putUint16(dst[33:], quantizeTimeLeftMS(ps.LoadoutTimeLeftMS))
	dst[35] = weaponToByte(ps.ActiveWeapon)
	putUint16(dst[36:], quantizeTimeLeftMS(ps.ReloadTimeLeftMS))
}

// computeChangedMask compares two 38-byte player state blocks and returns a
// 16-bit mask where each set bit indicates the corresponding field group changed.
func computeChangedMask(current, baseline []byte) uint16 {
	var mask uint16
	for bit := 0; bit < 16; bit++ {
		g := deltaFieldGroups[bit]
		for j := g.Start; j < g.End; j++ {
			if current[j] != baseline[j] {
				mask |= 1 << uint(bit)
				break
			}
		}
	}
	return mask
}

// snapshotEntry stores the quantized player states for one tick.
type snapshotEntry struct {
	seq     uint16
	players map[int][]byte // player ID → 38-byte quantized state
}

const snapshotBufferSize = 64

// snapshotBuffer is a ring buffer of recent snapshots for delta computation.
type snapshotBuffer struct {
	entries [snapshotBufferSize]snapshotEntry
}

func (sb *snapshotBuffer) store(seq uint16, players map[int][]byte) {
	idx := int(seq) % snapshotBufferSize
	sb.entries[idx] = snapshotEntry{seq: seq, players: players}
}

func (sb *snapshotBuffer) find(seq uint16) *snapshotEntry {
	idx := int(seq) % snapshotBufferSize
	e := &sb.entries[idx]
	if e.seq == seq && e.players != nil {
		return e
	}
	return nil
}

// encodeDeltaStateBinary encodes a delta state snapshot.  Player state is
// delta-compressed against the baseline; projectiles, effects, and match
// state are sent in full (they're small and change frequently).
//
// Format:
//   [0x81] [snapshotSeq:u16] [baselineSeq:u16] [serverTime:u32]
//   [numPlayers:u8]
//     For each player:
//       [id:u8] [changedMask:u16] [changed field bytes...]
//       (changedMask 0xFFFF = full 38-byte state follows)
//   [numProjectiles:u8] ... (same as full snapshot)
//   [numEffects:u8] ... (same as full snapshot)
//   ... match state ... (same as full snapshot)
func (g *Game) encodeDeltaStateBinary(nowMS int64, snapshotSeq uint16, baseline *snapshotEntry, currentStates map[int][]byte) []byte {
	nPlayers := len(g.players.ids)
	nProjectiles := len(g.projectiles)
	nEffects := 0
	for _, e := range g.effects {
		if e.ExpiresAt > nowMS {
			nEffects++
		}
	}

	nHostages := len(g.hostages)
	nFlags := len(g.flags)
	nRescueZones := len(g.mapRescueZones)
	nHealthRestore := len(g.mapHealthRestorePoints)

	matchBaseSize := 25
	hostageSize := 9 * nHostages
	flagSize := 15 * nFlags
	rescueZoneSize := 5 * nRescueZones
	healthRestoreSize := 11 * nHealthRestore

	// Max size: header(10) + players(3+38 each) + projectiles + effects + match
	maxPlayerSize := nPlayers * (3 + playerStateDataSize)
	totalMax := 10 + maxPlayerSize +
		8*nProjectiles + 10*nEffects +
		matchBaseSize + hostageSize + flagSize + rescueZoneSize + healthRestoreSize

	buf := make([]byte, totalMax)
	off := 0

	// Header (10 bytes)
	buf[off] = msgServerDeltaState
	off++
	putUint16(buf[off:], snapshotSeq)
	off += 2
	putUint16(buf[off:], baseline.seq)
	off += 2
	putUint32(buf[off:], uint32(nowMS))
	off += 4
	buf[off] = byte(nPlayers)
	off++

	// Delta-compressed player blocks
	for _, id := range g.players.ids {
		current := currentStates[id]
		buf[off] = byte(id)
		off++

		baseData, hasBaseline := baseline.players[id]
		if !hasBaseline {
			// New player — send full state (mask = 0xFFFF)
			putUint16(buf[off:], 0xFFFF)
			off += 2
			copy(buf[off:], current)
			off += playerStateDataSize
		} else {
			mask := computeChangedMask(current, baseData)
			putUint16(buf[off:], mask)
			off += 2
			for bit := 0; bit < 16; bit++ {
				if mask&(1<<uint(bit)) != 0 {
					fg := deltaFieldGroups[bit]
					n := fg.End - fg.Start
					copy(buf[off:], current[fg.Start:fg.End])
					off += n
				}
			}
		}
	}

	// Projectiles — same as full snapshot (8 bytes each)
	buf[off] = byte(nProjectiles)
	off++
	for _, p := range g.projectiles {
		buf[off] = byte(p.ID)
		off++
		buf[off] = weaponToByte(p.Type)
		off++
		putInt16(buf[off:], quantizePosXZ(p.Pos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(p.Pos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(p.Pos[2]))
		off += 2
	}

	// Effects — same as full snapshot (10 bytes each)
	buf[off] = byte(nEffects)
	off++
	for _, e := range g.effects {
		timeLeft := e.ExpiresAt - nowMS
		if timeLeft <= 0 {
			continue
		}
		buf[off] = effectTypeToByte(e.Type)
		off++
		putInt16(buf[off:], quantizePosXZ(e.Pos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(e.Pos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(e.Pos[2]))
		off += 2
		radius := int(math.Round(e.Radius * 10))
		if radius > 255 {
			radius = 255
		}
		buf[off] = byte(radius)
		off++
		putUint16(buf[off:], uint16(timeLeft))
		off += 2
	}

	// Match state — identical to encodeStateBinary
	buf[off] = gameModeToByte(g.mode)
	off++
	buf[off] = byte(g.currentRound)
	off++
	buf[off] = byte(g.totalRoundsLocked())
	off++
	roundTimeLeft := int64(0)
	if g.roundEndsAt > nowMS {
		roundTimeLeft = g.roundEndsAt - nowMS
	}
	putUint32(buf[off:], uint32(roundTimeLeft))
	off += 4
	buyTimeLeft := int64(0)
	if g.buyEndsAt > nowMS {
		buyTimeLeft = g.buyEndsAt - nowMS
	}
	putUint16(buf[off:], uint16(buyTimeLeft))
	off += 2
	var matchFlags byte
	if g.buyEndsAt > nowMS {
		matchFlags |= 0x01
	}
	if g.isIntermissionLocked(nowMS) {
		matchFlags |= 0x02
	}
	if g.isDeathmatchVoteActiveLocked(nowMS) {
		matchFlags |= 0x04
	}
	buf[off] = matchFlags
	off++
	intermissionTimeLeft := int64(0)
	if g.intermissionEndsAt > nowMS {
		intermissionTimeLeft = g.intermissionEndsAt - nowMS
	}
	putUint16(buf[off:], uint16(intermissionTimeLeft))
	off += 2
	buf[off] = teamToByte(g.roundWinner)
	off++
	buf[off] = byte(g.blueScore)
	off++
	buf[off] = byte(g.greenScore)
	off++

	blueAlive, greenAlive := 0, 0
	for i := range g.players.ids {
		if g.players.alive[i] && g.players.inMatch[i] {
			switch g.players.team[i] {
			case TeamBlue:
				blueAlive++
			case TeamGreen:
				greenAlive++
			}
		}
	}
	buf[off] = byte(blueAlive)
	off++
	buf[off] = byte(greenAlive)
	off++

	dmVoteTimeLeft := int64(0)
	if g.isDeathmatchVoteActiveLocked(nowMS) && g.deathmatchVoteEnds > nowMS {
		dmVoteTimeLeft = g.deathmatchVoteEnds - nowMS
	}
	putUint16(buf[off:], uint16(dmVoteTimeLeft))
	off += 2
	buf[off] = byte(nHostages)
	off++
	buf[off] = byte(nFlags)
	off++
	buf[off] = byte(g.blueCTFCaptures)
	off++
	buf[off] = byte(g.greenCTFCaptures)
	off++
	buf[off] = byte(nRescueZones)
	off++
	buf[off] = byte(nHealthRestore)
	off++

	for _, h := range g.hostages {
		buf[off] = byte(h.ID)
		off++
		putInt16(buf[off:], quantizePosXZ(h.Pos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(h.Pos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(h.Pos[2]))
		off += 2
		buf[off] = byte(h.FollowerID)
		off++
		var hFlags byte
		if h.Rescued {
			hFlags |= 0x01
		}
		if h.Alive {
			hFlags |= 0x02
		}
		buf[off] = hFlags
		off++
	}

	for _, f := range g.flags {
		buf[off] = teamToByte(f.Team)
		off++
		putInt16(buf[off:], quantizePosXZ(f.Pos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(f.Pos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(f.Pos[2]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(f.HomePos[0]))
		off += 2
		putInt16(buf[off:], quantizePosY(f.HomePos[1]))
		off += 2
		putInt16(buf[off:], quantizePosXZ(f.HomePos[2]))
		off += 2
		buf[off] = byte(f.CarrierID)
		off++
		var fFlags byte
		if f.Dropped {
			fFlags |= 0x01
		}
		if f.AtHome {
			fFlags |= 0x02
		}
		buf[off] = fFlags
		off++
	}

	for _, rz := range g.mapRescueZones {
		putInt16(buf[off:], quantizePosXZ(rz.Cx))
		off += 2
		putInt16(buf[off:], quantizePosXZ(rz.Cz))
		off += 2
		radius := int(math.Round(rz.Radius * 10))
		if radius > 255 {
			radius = 255
		}
		buf[off] = byte(radius)
		off++
	}

	for _, hp := range g.mapHealthRestorePoints {
		putInt16(buf[off:], quantizePosXZ(hp.X))
		off += 2
		putInt16(buf[off:], quantizePosXZ(hp.Z))
		off += 2
		radius := int(math.Round(hp.Radius * 10))
		if radius > 255 {
			radius = 255
		}
		buf[off] = byte(radius)
		off++
		buf[off] = byte(hp.HealAmount)
		off++
		putUint16(buf[off:], uint16(hp.CooldownMS/100))
		off += 2
		cooldownLeft := int64(0)
		if hp.CooldownEndsAt > nowMS {
			cooldownLeft = hp.CooldownEndsAt - nowMS
		}
		putUint16(buf[off:], quantizeTimeLeftMS(cooldownLeft))
		off += 2
		var hpFlags byte
		if hp.CooldownEndsAt <= nowMS {
			hpFlags |= 0x01
		}
		buf[off] = hpFlags
		off++
	}

	return buf[:off]
}

// encodeShotBinary encodes a shot event. Returns binary bytes.
func encodeShotBinary(playerID int, pos Vec3, dir Vec3, weapon WeaponID, alternate bool) []byte {
	buf := make([]byte, 16)
	buf[0] = msgServerShot
	buf[1] = byte(playerID)
	putInt16(buf[2:], quantizePosXZ(pos[0]))
	putInt16(buf[4:], quantizePosY(pos[1]))
	putInt16(buf[6:], quantizePosXZ(pos[2]))
	putInt16(buf[8:], quantizeDir(dir[0]))
	putInt16(buf[10:], quantizeDir(dir[1]))
	putInt16(buf[12:], quantizeDir(dir[2]))
	buf[14] = weaponToByte(weapon)
	var flags byte
	if alternate {
		flags |= 0x01
	}
	buf[15] = flags
	return buf
}

// encodeHitBinary encodes a hit event. Returns binary bytes.
func encodeHitBinary(from, to, dmg int, zone HitZone, weapon WeaponID, hp, armor, absorbed int) []byte {
	buf := make([]byte, 9)
	buf[0] = msgServerHit
	buf[1] = byte(from)
	buf[2] = byte(to)
	buf[3] = byte(dmg)
	buf[4] = hitZoneToByte(zone)
	buf[5] = weaponToByte(weapon)
	buf[6] = byte(hp)
	buf[7] = byte(armor)
	buf[8] = byte(absorbed)
	return buf
}

// encodeKillBinary encodes a kill event. Returns binary bytes.
func encodeKillBinary(killer, victim int, weapon WeaponID) []byte {
	buf := make([]byte, 4)
	buf[0] = msgServerKill
	k := killer
	if k <= 0 {
		k = 0xFF
	}
	buf[1] = byte(k)
	buf[2] = byte(victim)
	buf[3] = weaponToByte(weapon)
	return buf
}

// encodePongBinary encodes a pong response. Returns binary bytes.
func encodePongBinary(clientTime, serverTime int64) []byte {
	buf := make([]byte, 17)
	buf[0] = msgServerPong
	putInt64(buf[1:], clientTime)
	putInt64(buf[9:], serverTime)
	return buf
}

// encodeRespawnBinary encodes a respawn message. Returns binary bytes.
func encodeRespawnBinary(id int, ps playerState, nowMS int64) []byte {
	buf := make([]byte, 1+playerStateBlockSize)
	buf[0] = msgServerRespawn
	encodePlayerStateBlock(buf[1:], id, ps, nowMS)
	return buf
}

// ─── Decode: Client → Server ───────────────────────────────────────────────

func decodeBinaryInput(buf []byte) (InputCommand, uint16, bool) {
	if len(buf) < 10 {
		return InputCommand{}, 0, false
	}
	flags := buf[3]
	snapshotAck := getUint16(buf[8:])
	return InputCommand{
		Seq:      getUint16(buf[1:]),
		Forward:  flags&0x01 != 0,
		Backward: flags&0x02 != 0,
		Left:     flags&0x04 != 0,
		Right:    flags&0x08 != 0,
		Jump:     flags&0x10 != 0,
		Crouch:   flags&0x20 != 0,
		Aiming:   flags&0x40 != 0,
		Yaw:      dequantizeYaw(getUint16(buf[4:])),
		Pitch:    dequantizePitch(getInt16(buf[6:])),
	}, snapshotAck, true
}

func encodeInputAck(lastProcessedSeq uint16, velY float64, onGround bool) []byte {
	buf := make([]byte, 6)
	buf[0] = msgServerInputAck
	putUint16(buf[1:], lastProcessedSeq)
	putInt16(buf[3:], int16(math.Round(velY*256))) // quantize velY: ±128 range, ~0.004 precision
	if onGround {
		buf[5] = 1
	}
	return buf
}

func decodeBinaryShoot(buf []byte, nowMS int64) (shootMessage, bool) {
	if len(buf) < 13 {
		return shootMessage{}, false
	}
	// Reconstruct full int64 from low 32 bits using current server time
	// as reference. The high 32 bits come from nowMS.
	low32 := int64(getUint32(buf[7:]))
	shotTime := (nowMS &^ 0xFFFFFFFF) | low32
	// Handle wraparound: if the reconstructed time is far in the future,
	// it was probably from the previous epoch.
	if shotTime > nowMS+5000 {
		shotTime -= 0x100000000
	} else if shotTime < nowMS-0x80000000 {
		shotTime += 0x100000000
	}
	return shootMessage{
		Dir: Vec3{
			dequantizeDir(getInt16(buf[1:])),
			dequantizeDir(getInt16(buf[3:])),
			dequantizeDir(getInt16(buf[5:])),
		},
		ShotTime:  shotTime,
		Weapon:    byteToWeapon(buf[11]),
		Aiming:    buf[12]&0x01 != 0,
		Alternate: buf[12]&0x02 != 0,
	}, true
}

type throwMessage struct {
	Dir    Vec3
	Weapon WeaponID
}

func decodeBinaryThrow(buf []byte) (throwMessage, bool) {
	if len(buf) < 8 {
		return throwMessage{}, false
	}
	return throwMessage{
		Dir: Vec3{
			dequantizeDir(getInt16(buf[1:])),
			dequantizeDir(getInt16(buf[3:])),
			dequantizeDir(getInt16(buf[5:])),
		},
		Weapon: byteToWeapon(buf[7]),
	}, true
}

func decodeBinaryPing(buf []byte) (int64, bool) {
	if len(buf) < 9 {
		return 0, false
	}
	return getInt64(buf[1:]), true
}

func decodeBinarySwitch(buf []byte) (WeaponID, bool) {
	if len(buf) < 2 {
		return "", false
	}
	return byteToWeapon(buf[1]), true
}

func decodeBinaryBuy(buf []byte) (WeaponID, bool) {
	if len(buf) < 2 {
		return "", false
	}
	return byteToWeapon(buf[1]), true
}
