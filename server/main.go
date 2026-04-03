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
	hitscanRange            = 50.0
	headDamage              = 90
	bodyDamage              = 20
	positionHistoryWindowMS = 1000
	maxLagCompensationMS    = 250
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

type Vec3 [3]float64

type positionSample struct {
	At  int64
	Pos Vec3
}

type playerStore struct {
	ids       []int
	names     []string
	pos       []Vec3
	yaw       []float64
	pitch     []float64
	hp        []int
	kills     []int
	deaths    []int
	alive     []bool
	conns     []*websocket.Conn
	sendChs   []chan []byte
	history   [][]positionSample
	idToIndex map[int]int
}

type Game struct {
	mu      sync.RWMutex
	players playerStore
	nextID  int
	state   GameState
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

var game = &Game{
	players: newPlayerStore(),
	nextID:  1,
	state:   StateWaiting,
}

var spawnPoints = [6]Vec3{
	{-25, 1.7, -25},
	{25, 1.7, -25},
	{25, 1.7, 25},
	{-25, 1.7, 25},
	{0, 1.7, -12},
	{0, 1.7, 12},
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
	ps.hp = append(ps.hp, 100)
	ps.kills = append(ps.kills, 0)
	ps.deaths = append(ps.deaths, 0)
	ps.alive = append(ps.alive, true)
	ps.conns = append(ps.conns, conn)
	ps.sendChs = append(ps.sendChs, sendCh)
	ps.history = append(ps.history, []positionSample{{At: nowMS, Pos: spawn}})
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
		ps.hp[idx] = ps.hp[last]
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
	ps.hp = ps.hp[:last]
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
	g.mu.RLock()
	defer g.mu.RUnlock()

	type LobbyPlayer struct {
		ID     int    `json:"id"`
		Name   string `json:"name"`
		Kills  int    `json:"kills"`
		Deaths int    `json:"deaths"`
	}

	players := make([]LobbyPlayer, 0, len(g.players.ids))
	for i, id := range g.players.ids {
		if g.players.names[i] != "" {
			players = append(players, LobbyPlayer{
				ID:     id,
				Name:   g.players.names[i],
				Kills:  g.players.kills[i],
				Deaths: g.players.deaths[i],
			})
		}
	}

	msg, _ := json.Marshal(map[string]interface{}{
		"t":       "lobby",
		"players": players,
		"state":   gameStateName(g.state),
	})

	for _, sendCh := range g.players.sendChs {
		select {
		case sendCh <- msg:
		default:
		}
	}
}

func (g *Game) stateTick() {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if len(g.players.ids) == 0 {
		return
	}

	type PlayerState struct {
		Pos    Vec3    `json:"pos"`
		Yaw    float64 `json:"yaw"`
		Pitch  float64 `json:"pitch"`
		Hp     int     `json:"hp"`
		Name   string  `json:"name"`
		Kills  int     `json:"kills"`
		Deaths int     `json:"deaths"`
	}

	state := make(map[int]PlayerState, len(g.players.ids))
	for i, id := range g.players.ids {
		state[id] = PlayerState{
			Pos:    g.players.pos[i],
			Yaw:    g.players.yaw[i],
			Pitch:  g.players.pitch[i],
			Hp:     g.players.hp[i],
			Name:   g.players.names[i],
			Kills:  g.players.kills[i],
			Deaths: g.players.deaths[i],
		}
	}

	msg, _ := json.Marshal(map[string]interface{}{
		"t":       "state",
		"players": state,
	})

	for _, sendCh := range g.players.sendChs {
		select {
		case sendCh <- msg:
		default:
		}
	}
}

func (g *Game) isPlaying() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.state == StatePlaying
}

func (g *Game) stateName() string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return gameStateName(g.state)
}

func writer(conn *websocket.Conn, sendCh <-chan []byte) {
	for msg := range sendCh {
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			break
		}
	}
	conn.Close()
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
				welcomePos := game.players.pos[idx]
				stateName := gameStateName(game.state)
				game.mu.Unlock()

				welcome, _ := json.Marshal(map[string]interface{}{
					"t":     "welcome",
					"id":    playerID,
					"pos":   welcomePos,
					"state": stateName,
				})
				select {
				case sendCh <- welcome:
				default:
				}
				game.broadcastLobby()
			}
			continue
		}

		switch t {
		case "ping":
			var clientTime int64
			json.Unmarshal(msg["clientTime"], &clientTime)
			pong, _ := json.Marshal(map[string]interface{}{
				"t":          "pong",
				"clientTime": clientTime,
				"serverTime": time.Now().UnixMilli(),
			})
			select {
			case sendCh <- pong:
			default:
			}

		case "input":
			if !game.isPlaying() {
				continue
			}

			nowMS := time.Now().UnixMilli()
			var pos Vec3
			var yaw float64
			var pitch float64
			json.Unmarshal(msg["pos"], &pos)
			json.Unmarshal(msg["yaw"], &yaw)
			json.Unmarshal(msg["pitch"], &pitch)

			game.mu.Lock()
			idx, ok := game.players.indexOf(playerID)
			if ok {
				game.players.yaw[idx] = yaw
				game.players.pitch[idx] = pitch
				if game.players.alive[idx] {
					game.players.pos[idx] = pos
					recordPositionSample(&game.players.history[idx], nowMS, pos)
				}
			}
			game.mu.Unlock()

		case "shoot":
			if !game.isPlaying() {
				continue
			}

			var dir Vec3
			var requestedShotTime int64
			json.Unmarshal(msg["dir"], &dir)
			json.Unmarshal(msg["shotTime"], &requestedShotTime)
			dir = normalizeVec(dir)

			nowMS := time.Now().UnixMilli()
			shotTime := clampShotTime(requestedShotTime, nowMS)

			game.mu.RLock()
			idx, ok := game.players.indexOf(playerID)
			if !ok || !game.players.alive[idx] {
				game.mu.RUnlock()
				continue
			}
			shooterPos := positionAtTime(game.players.history[idx], shotTime)
			game.mu.RUnlock()

			shotMsg, _ := json.Marshal(map[string]interface{}{
				"t":   "shot",
				"id":  playerID,
				"pos": shooterPos,
				"dir": dir,
			})
			game.broadcast(shotMsg, 0)

			hit := findHitTarget(playerID, shooterPos, dir, shotTime)
			if hit == nil {
				continue
			}

			damage := damageForHitZone(hit.zone)
			appliedHit := false
			killed := false
			victimID := hit.id

			game.mu.Lock()
			victimIdx, ok := game.players.indexOf(victimID)
			if ok && game.players.alive[victimIdx] {
				appliedHit = true
				game.players.hp[victimIdx] -= damage
				if game.players.hp[victimIdx] <= 0 {
					game.players.hp[victimIdx] = 0
					game.players.alive[victimIdx] = false
					game.players.deaths[victimIdx]++
					killed = true
					if shooterIdx, ok := game.players.indexOf(playerID); ok {
						game.players.kills[shooterIdx]++
					}
				}
			}
			game.mu.Unlock()

			if !appliedHit {
				continue
			}

			hitMsg, _ := json.Marshal(map[string]interface{}{
				"t":    "hit",
				"from": playerID,
				"to":   victimID,
				"dmg":  damage,
				"zone": hit.zone,
			})
			game.broadcast(hitMsg, 0)

			if !killed {
				continue
			}

			killMsg, _ := json.Marshal(map[string]interface{}{
				"t":      "kill",
				"killer": playerID,
				"victim": victimID,
			})
			game.broadcast(killMsg, 0)

			go func(victimID int) {
				time.Sleep(3 * time.Second)
				spawn := spawnPoints[rand.Intn(len(spawnPoints))]
				nowMS := time.Now().UnixMilli()

				game.mu.Lock()
				idx, ok := game.players.indexOf(victimID)
				if ok {
					game.players.pos[idx] = spawn
					game.players.hp[idx] = 100
					game.players.alive[idx] = true
					recordPositionSample(&game.players.history[idx], nowMS, spawn)
				}
				game.mu.Unlock()

				if ok {
					respawnMsg, _ := json.Marshal(map[string]interface{}{
						"t":   "respawn",
						"id":  victimID,
						"pos": spawn,
					})
					game.broadcast(respawnMsg, 0)
				}
			}(victimID)

		case "start":
			game.mu.Lock()
			if game.state == StateWaiting {
				game.state = StatePlaying
				game.mu.Unlock()

				startMsg, _ := json.Marshal(map[string]interface{}{
					"t": "start",
				})
				game.broadcast(startMsg, 0)
				game.broadcastLobby()
			} else {
				game.mu.Unlock()
			}
		}
	}
}

func findHitTarget(shooterID int, origin, dir Vec3, shotTime int64) *hitCandidate {
	game.mu.RLock()
	defer game.mu.RUnlock()

	var best *hitCandidate
	bestDist := hitscanRange

	for i, id := range game.players.ids {
		if id == shooterID || !game.players.alive[i] {
			continue
		}

		tpos := positionAtTime(game.players.history[i], shotTime)
		zone, dist, ok := tracePlayerHit(origin, dir, tpos)
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

func recordPositionSample(history *[]positionSample, at int64, pos Vec3) {
	samples := append(*history, positionSample{At: at, Pos: pos})
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
	if len(samples) == 0 {
		return Vec3{}
	}
	if at <= 0 || at >= samples[len(samples)-1].At {
		return samples[len(samples)-1].Pos
	}
	if at <= samples[0].At {
		return samples[0].Pos
	}

	for i := 1; i < len(samples); i++ {
		prev := samples[i-1]
		next := samples[i]
		if at > next.At {
			continue
		}

		span := next.At - prev.At
		if span <= 0 {
			return next.Pos
		}
		alpha := float64(at-prev.At) / float64(span)
		return Vec3{
			prev.Pos[0] + (next.Pos[0]-prev.Pos[0])*alpha,
			prev.Pos[1] + (next.Pos[1]-prev.Pos[1])*alpha,
			prev.Pos[2] + (next.Pos[2]-prev.Pos[2])*alpha,
		}
	}

	return samples[len(samples)-1].Pos
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

func tracePlayerHit(origin, dir, targetPos Vec3) (HitZone, float64, bool) {
	bestDist := hitscanRange
	bestZone := HitZone("")
	found := false

	for _, box := range playerHitBoxes(targetPos) {
		dist, ok := rayAABBIntersection(origin, dir, box.min, box.max)
		if !ok || dist > bestDist {
			continue
		}
		bestDist = dist
		bestZone = box.zone
		found = true
	}

	return bestZone, bestDist, found
}

func playerHitBoxes(pos Vec3) []hitBox {
	return []hitBox{
		{
			zone: HitZoneHead,
			min:  Vec3{pos[0] - 0.24, pos[1] - 0.28, pos[2] - 0.24},
			max:  Vec3{pos[0] + 0.24, pos[1] + 0.24, pos[2] + 0.24},
		},
		{
			zone: HitZoneBody,
			min:  Vec3{pos[0] - 0.42, pos[1] - 0.98, pos[2] - 0.32},
			max:  Vec3{pos[0] + 0.42, pos[1] - 0.32, pos[2] + 0.32},
		},
		{
			zone: HitZoneBody,
			min:  Vec3{pos[0] - 0.32, pos[1] - 1.7, pos[2] - 0.28},
			max:  Vec3{pos[0] + 0.32, pos[1] - 1.0, pos[2] + 0.28},
		},
	}
}

func rayAABBIntersection(origin, dir, min, max Vec3) (float64, bool) {
	tMin := 0.0
	tMax := hitscanRange

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

func damageForHitZone(zone HitZone) int {
	if zone == HitZoneHead {
		return headDamage
	}
	return bodyDamage
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
			game.mu.RLock()
			playing := game.state == StatePlaying
			game.mu.RUnlock()
			if playing {
				game.stateTick()
			}
		}
	}()

	lanIP := getLANIP()
	log.Printf("FPS server running on http://%s:%s (LAN) and http://localhost:%s", lanIP, port, port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
