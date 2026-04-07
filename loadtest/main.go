package main

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v3"
)

var le = binary.LittleEndian

const (
	msgInput  = 0x02
	msgShoot  = 0x03
	msgPing   = 0x0F
	msgDCPing = 0x10
	msgPong   = 0x8A
	msgDCPong = 0x8B
	msgState  = 0x82
	msgDelta  = 0x81
)

type rttBucket struct {
	mu   sync.Mutex
	rtts []time.Duration
}

func (b *rttBucket) add(d time.Duration) {
	b.mu.Lock()
	b.rtts = append(b.rtts, d)
	b.mu.Unlock()
}

func (b *rttBucket) percentile(p float64) time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.rtts) == 0 {
		return 0
	}
	sorted := make([]time.Duration, len(b.rtts))
	copy(sorted, b.rtts)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	idx := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	return sorted[idx]
}

func (b *rttBucket) max() time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	var m time.Duration
	for _, d := range b.rtts {
		if d > m {
			m = d
		}
	}
	return m
}

func (b *rttBucket) count() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.rtts)
}

type stats struct {
	tcpRTT       rttBucket
	udpRTT       rttBucket
	msgRecv      atomic.Int64
	msgSent      atomic.Int64
	snapRecv     atomic.Int64
	connectFails atomic.Int64
	connected    atomic.Int64
	dcConnected  atomic.Int64
}

func createLobby(host, name string) (string, error) {
	resp, err := http.Post(
		fmt.Sprintf("http://%s/api/lobbies", host),
		"application/json",
		strings.NewReader(fmt.Sprintf(`{"name":"%s"}`, name)),
	)
	if err != nil {
		return "", fmt.Errorf("POST /api/lobbies: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("POST /api/lobbies returned %d: %s", resp.StatusCode, string(body))
	}
	var result struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("POST /api/lobbies: bad JSON (status %d, body: %.200s): %w", resp.StatusCode, string(body), err)
	}
	if result.ID == "" {
		return "", fmt.Errorf("POST /api/lobbies: empty lobby ID (body: %.200s)", string(body))
	}
	return result.ID, nil
}

func buildInputMsg(seq uint16, flags byte, yaw, pitch float64, snapshotSeq uint16) []byte {
	buf := make([]byte, 10)
	buf[0] = msgInput
	le.PutUint16(buf[1:], seq)
	buf[3] = flags
	le.PutUint16(buf[4:], uint16(yaw/(2*math.Pi)*65535))
	le.PutUint16(buf[6:], uint16(int16(pitch/(math.Pi/2)*32767)))
	le.PutUint16(buf[8:], snapshotSeq)
	return buf
}

func buildPingMsg(typ byte) []byte {
	buf := make([]byte, 9)
	buf[0] = typ
	le.PutUint64(buf[1:], uint64(time.Now().UnixMilli()))
	return buf
}

func buildShootMsg(yaw, pitch float64) []byte {
	buf := make([]byte, 13)
	buf[0] = msgShoot
	dx := int16(math.Sin(yaw) * math.Cos(pitch) * 32767)
	dy := int16(math.Sin(pitch) * 32767)
	dz := int16(math.Cos(yaw) * math.Cos(pitch) * 32767)
	le.PutUint16(buf[1:], uint16(dx))
	le.PutUint16(buf[3:], uint16(dy))
	le.PutUint16(buf[5:], uint16(dz))
	le.PutUint32(buf[7:], uint32(time.Now().UnixMilli()&0xFFFFFFFF))
	buf[11] = 0x14 // glock-18
	buf[12] = 0x00
	return buf
}

type sender interface {
	send(data []byte) error
}

type wsSender struct {
	conn *websocket.Conn
}

func (s *wsSender) send(data []byte) error {
	return s.conn.WriteMessage(websocket.BinaryMessage, data)
}

type dcSender struct {
	dc *webrtc.DataChannel
}

func (s *dcSender) send(data []byte) error {
	return s.dc.Send(data)
}

func runPlayer(id int, host, lobbyID string, rate int, startGame bool, done <-chan struct{}, st *stats) {
	url := fmt.Sprintf("ws://%s/ws?lobby=%s", host, lobbyID)
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		st.connectFails.Add(1)
		log.Printf("player %d: connect failed: %v", id, err)
		return
	}
	st.connected.Add(1)
	defer func() {
		conn.Close()
		st.connected.Add(-1)
	}()

	nameMsg := fmt.Sprintf(`{"t":"name","name":"bot_%d"}`, id)
	if err := conn.WriteMessage(websocket.TextMessage, []byte(nameMsg)); err != nil {
		return
	}

	welcomeCh := make(chan struct{}, 1)
	var lastSnapshotSeq atomic.Uint32

	var dc *webrtc.DataChannel
	var pc *webrtc.PeerConnection
	dcReady := make(chan struct{}, 1)

	handleBinary := func(msg []byte) {
		if len(msg) == 0 {
			return
		}
		switch msg[0] {
		case msgPong:
			if len(msg) >= 17 {
				clientTime := int64(le.Uint64(msg[1:9]))
				rtt := time.Duration(time.Now().UnixMilli()-clientTime) * time.Millisecond
				if rtt >= 0 {
					st.tcpRTT.add(rtt)
				}
			}
		case msgDCPong:
			if len(msg) >= 17 {
				clientTime := int64(le.Uint64(msg[1:9]))
				rtt := time.Duration(time.Now().UnixMilli()-clientTime) * time.Millisecond
				if rtt >= 0 {
					st.udpRTT.add(rtt)
				}
			}
		case msgState, msgDelta:
			st.snapRecv.Add(1)
			if len(msg) >= 5 {
				seq := le.Uint16(msg[3:5])
				lastSnapshotSeq.Store(uint32(seq))
			}
		}
	}

	go func() {
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			st.msgRecv.Add(1)

			if len(msg) > 0 && msg[0] == '{' {
				var j map[string]json.RawMessage
				if json.Unmarshal(msg, &j) == nil {
					var t string
					json.Unmarshal(j["t"], &t)
					switch t {
					case "welcome":
						select {
						case welcomeCh <- struct{}{}:
						default:
						}
					case "rtc-answer":
						if pc != nil {
							var sdp string
							json.Unmarshal(j["sdp"], &sdp)
							pc.SetRemoteDescription(webrtc.SessionDescription{
								Type: webrtc.SDPTypeAnswer,
								SDP:  sdp,
							})
						}
					case "rtc-ice":
						if pc != nil {
							var candidateStr string
							json.Unmarshal(j["candidate"], &candidateStr)
							var candidate webrtc.ICECandidateInit
							json.Unmarshal([]byte(candidateStr), &candidate)
							pc.AddICECandidate(candidate)
						}
					}
				}
				continue
			}

			handleBinary(msg)
		}
	}()

	select {
	case <-welcomeCh:
	case <-done:
		return
	case <-time.After(5 * time.Second):
		log.Printf("player %d: welcome timeout", id)
		return
	}

	if startGame {
		conn.WriteMessage(websocket.TextMessage, []byte(`{"t":"start"}`))
		time.Sleep(200 * time.Millisecond)
	}

	pc, err = webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		log.Printf("player %d: WebRTC PeerConnection failed: %v", id, err)
		goto noWebRTC
	}

	dc, err = pc.CreateDataChannel("game", &webrtc.DataChannelInit{
		Ordered:        boolPtr(false),
		MaxRetransmits: uint16Ptr(0),
	})
	if err != nil {
		log.Printf("player %d: DataChannel creation failed: %v", id, err)
		pc.Close()
		goto noWebRTC
	}

	dc.OnOpen(func() {
		st.dcConnected.Add(1)
		select {
		case dcReady <- struct{}{}:
		default:
		}
	})

	dc.OnClose(func() {
		st.dcConnected.Add(-1)
	})

	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		if !msg.IsString {
			st.msgRecv.Add(1)
			handleBinary(msg.Data)
		}
	})

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		candidateJSON, _ := json.Marshal(c.ToJSON())
		iceJSON, _ := json.Marshal(map[string]string{"t": "rtc-ice", "candidate": string(candidateJSON)})
		conn.WriteMessage(websocket.TextMessage, iceJSON)
	})

	{
		offer, err := pc.CreateOffer(nil)
		if err != nil {
			log.Printf("player %d: CreateOffer failed: %v", id, err)
			pc.Close()
			goto noWebRTC
		}
		if err := pc.SetLocalDescription(offer); err != nil {
			log.Printf("player %d: SetLocalDescription failed: %v", id, err)
			pc.Close()
			goto noWebRTC
		}
		offerJSON, _ := json.Marshal(map[string]string{"t": "rtc-offer", "sdp": offer.SDP})
		conn.WriteMessage(websocket.TextMessage, offerJSON)
	}

	select {
	case <-dcReady:
	case <-done:
		pc.Close()
		return
	case <-time.After(5 * time.Second):
		log.Printf("player %d: DataChannel timeout, falling back to WebSocket", id)
	}

noWebRTC:
	var unreliable sender = &wsSender{conn: conn}
	if dc != nil && dc.ReadyState() == webrtc.DataChannelStateOpen {
		unreliable = &dcSender{dc: dc}
	}
	defer func() {
		if pc != nil {
			pc.Close()
		}
	}()

	inputTicker := time.NewTicker(time.Second / time.Duration(rate))
	defer inputTicker.Stop()
	tcpPingTicker := time.NewTicker(500 * time.Millisecond)
	defer tcpPingTicker.Stop()
	dcPingTicker := time.NewTicker(500 * time.Millisecond)
	defer dcPingTicker.Stop()
	dirChangeTicker := time.NewTicker(2 * time.Second)
	defer dirChangeTicker.Stop()
	shootTicker := time.NewTicker(300 * time.Millisecond)
	defer shootTicker.Stop()

	var seq uint16
	yaw := rand.Float64() * 2 * math.Pi
	pitch := 0.0
	flags := byte(0x01)

	for {
		select {
		case <-done:
			return
		case <-dirChangeTicker.C:
			directions := []byte{0x01, 0x02, 0x04, 0x08, 0x01 | 0x04, 0x01 | 0x08, 0x02 | 0x04, 0x02 | 0x08}
			flags = directions[rand.Intn(len(directions))]
			yaw = rand.Float64() * 2 * math.Pi
			pitch = (rand.Float64() - 0.5) * math.Pi * 0.5
		case <-tcpPingTicker.C:
			if err := conn.WriteMessage(websocket.BinaryMessage, buildPingMsg(msgPing)); err != nil {
				return
			}
			st.msgSent.Add(1)
		case <-dcPingTicker.C:
			if unreliable != nil {
				unreliable.send(buildPingMsg(msgDCPing))
				st.msgSent.Add(1)
			}
		case <-shootTicker.C:
			msg := buildShootMsg(yaw, pitch)
			unreliable.send(msg)
			st.msgSent.Add(1)
		case <-inputTicker.C:
			seq++
			snapSeq := uint16(lastSnapshotSeq.Load())
			msg := buildInputMsg(seq, flags, yaw, pitch, snapSeq)
			if err := unreliable.send(msg); err != nil {
				return
			}
			st.msgSent.Add(1)
		}
	}
}

func boolPtr(v bool) *bool       { return &v }
func uint16Ptr(v uint16) *uint16 { return &v }

func fetchServerStats(host string) string {
	resp, err := http.Get(fmt.Sprintf("http://%s/debug/stats", host))
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var m map[string]int64
	if json.Unmarshal(body, &m) != nil {
		return ""
	}
	return fmt.Sprintf("tick=%dμs(avg=%dμs,max=%dμs) stTick=%dμs sendCh=%d drops=%d stalls=%d",
		m["tickUs"], m["tickAvgUs"], m["tickMaxUs"],
		m["stateTickUs"], m["sendChMaxOcc"],
		m["droppedMsgs"], m["writeStalls"])
}

func main() {
	n := flag.Int("n", 10, "number of fake players")
	host := flag.String("host", "localhost:8090", "server address")
	duration := flag.Duration("duration", 30*time.Second, "how long to run")
	rate := flag.Int("rate", 60, "input messages per second per player")
	lobby := flag.String("lobby", "loadtest", "lobby name")
	flag.Parse()

	st := &stats{}

	lobbyID, err := createLobby(*host, *lobby)
	if err != nil {
		log.Fatalf("failed to create lobby: %v", err)
	}
	log.Printf("created lobby %s", lobbyID)

	done := make(chan struct{})

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)

	var wg sync.WaitGroup
	for i := 0; i < *n; i++ {
		wg.Add(1)
		startGame := i == 0
		go func(id int) {
			defer wg.Done()
			runPlayer(id, *host, lobbyID, *rate, startGame, done, st)
		}(i)
		time.Sleep(100 * time.Millisecond)
	}

	startTime := time.Now()
	reportTicker := time.NewTicker(5 * time.Second)
	defer reportTicker.Stop()
	timer := time.NewTimer(*duration)
	defer timer.Stop()

	var lastRecv, lastSent, lastSnap int64

	for {
		select {
		case <-sigCh:
			log.Println("interrupted, shutting down...")
			close(done)
			wg.Wait()
			printSummary(st, time.Since(startTime), *n)
			return
		case <-timer.C:
			close(done)
			wg.Wait()
			printSummary(st, *duration, *n)
			return
		case <-reportTicker.C:
			elapsed := time.Since(startTime).Truncate(time.Second)
			recv := st.msgRecv.Load()
			sent := st.msgSent.Load()
			snap := st.snapRecv.Load()
			recvRate := float64(recv-lastRecv) / 5.0
			sentRate := float64(sent-lastSent) / 5.0
			snapRate := float64(snap-lastSnap) / 5.0
			lastRecv = recv
			lastSent = sent
			lastSnap = snap
			serverStats := fetchServerStats(*host)
			fmt.Printf("[%s] ws=%d dc=%d tcp(p50=%s p95=%s p99=%s) udp(p50=%s p95=%s p99=%s) snap=%.0f/s recv=%.0f/s sent=%.0f/s | %s\n",
				elapsed,
				st.connected.Load(),
				st.dcConnected.Load(),
				st.tcpRTT.percentile(50).Truncate(time.Millisecond),
				st.tcpRTT.percentile(95).Truncate(time.Millisecond),
				st.tcpRTT.percentile(99).Truncate(time.Millisecond),
				st.udpRTT.percentile(50).Truncate(time.Millisecond),
				st.udpRTT.percentile(95).Truncate(time.Millisecond),
				st.udpRTT.percentile(99).Truncate(time.Millisecond),
				snapRate,
				recvRate,
				sentRate,
				serverStats,
			)
		}
	}
}

func printSummary(st *stats, duration time.Duration, players int) {
	fmt.Println("\n=== Load Test Summary ===")
	fmt.Printf("Duration:       %s\n", duration.Truncate(time.Second))
	fmt.Printf("Players:        %d (WS) / %d (DC)\n", st.connected.Load(), st.dcConnected.Load())
	fmt.Printf("TCP RTT p50:    %s\n", st.tcpRTT.percentile(50).Truncate(time.Millisecond))
	fmt.Printf("TCP RTT p95:    %s\n", st.tcpRTT.percentile(95).Truncate(time.Millisecond))
	fmt.Printf("TCP RTT p99:    %s\n", st.tcpRTT.percentile(99).Truncate(time.Millisecond))
	fmt.Printf("TCP RTT max:    %s\n", st.tcpRTT.max().Truncate(time.Millisecond))
	fmt.Printf("UDP RTT p50:    %s\n", st.udpRTT.percentile(50).Truncate(time.Millisecond))
	fmt.Printf("UDP RTT p95:    %s\n", st.udpRTT.percentile(95).Truncate(time.Millisecond))
	fmt.Printf("UDP RTT p99:    %s\n", st.udpRTT.percentile(99).Truncate(time.Millisecond))
	fmt.Printf("UDP RTT max:    %s\n", st.udpRTT.max().Truncate(time.Millisecond))
	fmt.Printf("UDP samples:    %d\n", st.udpRTT.count())
	fmt.Printf("Snapshots recv: %d\n", st.snapRecv.Load())
	fmt.Printf("Total sent:     %d\n", st.msgSent.Load())
	fmt.Printf("Total recv:     %d\n", st.msgRecv.Load())
	fmt.Printf("Connect fails:  %d\n", st.connectFails.Load())
}
