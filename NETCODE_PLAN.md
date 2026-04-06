# FPS Netcode Overhaul Plan

## Current State Summary

- **Transport**: WebSocket over TCP, binary-encoded hot-path messages (Phase 1 complete)
- **Trust Model**: Server-authoritative movement (Phase 2 complete). Client sends raw inputs, server simulates
- **State Sync**: Delta-compressed binary snapshots per-client at ~60Hz (Phase 3 complete)
- **Hit Detection**: Server-authoritative with lag compensation (good, keep)
- **Clock Sync**: Multi-sample probing with outlier rejection (Phase 6 complete)
- **Interpolation**: Linear with adaptive jitter buffer (33-200ms), per-player snapshot ring (Phase 6 complete)
- **Visibility**: All player data sent to all clients (no culling)

---

## Phase 1: Binary Protocol over WebSocket ✅ COMPLETE

**Goal**: Replace JSON with binary encoding on all hot-path messages. ~10x bandwidth reduction.

**Status**: Implemented 2026-04-06. Binary codec in `server/codec.go` and `client/js/codec.js`. WebSocket transport retained (TCP).

**What was done**:
- All hot-path messages (state, round, input, shoot, throw, reload, switch, buy, ping/pong, shot, hit, kill, respawn) use binary encoding
- Low-frequency messages (welcome, lobby, chat, team, mode, map, start, rejoin, leaveMatch) remain JSON
- No backwards compatibility — all JSON paths for hot-path messages removed
- Per-player state block: 39 bytes (vs ~300+ bytes JSON)
- Little-endian throughout, quantized positions/angles/directions

**Encoding rules**:
- Message type: 1 byte (Client→Server `0x01-0x0F`, Server→Client `0x81-0x91`)
- Positions: int16 (×256 for XZ, ×1024 for Y)
- Angles: uint16 yaw (×65536/2π), int16 pitch (×32767/(π/2))
- Directions: int16 ×3 (×32767)
- Timestamps: uint32 (low 32 bits of unix ms)
- Booleans: bitfield packed into uint8 flags
- Weapon/player IDs: uint8 enums

**Transport detection**: Binary messages start with byte < `0x7B` (ASCII `{`), JSON starts with `{`. Writer auto-detects via `msg[0]`.

### Files
| File | Status |
|------|--------|
| `server/codec.go` | **New** — Go binary codec (enums, quantization, encode/decode) |
| `client/js/codec.js` | **New** — JS binary codec (matching) |
| `server/main.go` | Modified — binary state tick, binary message routing, dead JSON paths removed |
| `client/js/net.js` | Modified — binary send/receive, `ws.binaryType = 'arraybuffer'` |

---

## Future: WebRTC DataChannel Migration (deferred)

**Goal**: Replace WebSocket/TCP with unreliable WebRTC DataChannel for UDP semantics. Eliminates TCP head-of-line blocking.

**Why deferred**: High implementation complexity (SDP signaling, ICE/STUN/TURN, browser quirks, NAT traversal), and the binary protocol works identically over any transport. All remaining phases (2-8) are transport-agnostic — they build on the binary codec, not on the transport layer. WebRTC can be swapped in at any time without changing the protocol.

**When to revisit**: When the game has real players and TCP head-of-line blocking is measurably impacting gameplay (>2% packet loss scenarios). Until then, WebSocket binary is sufficient.

**Approach when ready**:
- `RTCPeerConnection` with `ordered: false, maxRetransmits: 0` = unreliable UDP semantics
- Signaling via existing HTTP endpoints (exchange SDP offer/answer)
- Server: Go pion/webrtc library or raw UDP socket with custom reliability
- Packet header: `[uint32 protocol_id] [uint16 seq] [uint16 ack] [uint32 ack_bitfield]` (12 bytes)
- Selective reliability: Channel 0 unreliable (state/input), Channel 1 reliable-ordered (kills, economy, chat)
- Fragment to 1200 bytes max payload (safe below IPv6 minimum MTU)

---

## Phase 2: Input-Based Movement (Server-Authoritative) ✅ COMPLETE

**Goal**: Client sends raw inputs, server simulates movement. Eliminates teleport/speed hacks.

**Status**: Implemented 2026-04-06. Server now runs movement physics; clients send raw WASD/jump/crouch inputs + yaw/pitch. Client-side prediction with server reconciliation provides smooth visuals while maintaining server authority.

**What was done**:
- Client sends 10-byte input packets: `[type:u8=0x02] [seq:u16] [flags:u8] [yaw:u16] [pitch:i16] [snapshotAck:u16]` (extended to 10 bytes in Phase 3)
- `flags` bitfield: forward(0), backward(1), left(2), right(3), jump(4), crouch(5), aiming(6)
- Server buffers inputs per-player, processes all queued inputs each tick at fixed dt=1/60
- Server sends 6-byte input ack: `[type:u8=0x84] [seq:u16] [velY:i16] [onGround:u8]`
- velY quantized as int16 × 256 (±128 range), onGround as boolean byte
- Client prediction replays unacked inputs on top of server authoritative position (snap, no blend)
- Physics determinism: client `predictStep()` and server `simulateMovement()` produce identical results
- Weapon mobility multipliers (MoveSpeed/baseMoveSpeed) applied on both sides
- uint16 sequence numbers with modular wraparound comparison
- Bots unchanged — still use existing `moveFallbackBotLocked()`

**Key constants** (matched on both sides):
- `BASE_SPEED = 10`, `GRAVITY = -20`, `BASE_JUMP_VEL = 7`
- `STAND_EYE_HEIGHT = 1.7`, `CROUCH_EYE_HEIGHT = 1.15`, `CEILING_Y = 4.9`
- `PLAYER_RADIUS = 0.4`, `baseMoveSpeed = 240`

**Architecture**:
- Input flow: keypress → `captureInput()` → `encodeInput()` → WS → server `inputQueue` → `processInputsLocked()` → `simulateMovement()` → `encodeInputAck()` → client `onInputAck()`
- Reconciliation flow: state snapshot → `applySnapshot()` stores `serverAuthPos` → `reconcile()` replays pending inputs → snap player position
- Local prediction: `updatePlayer()` still runs at frame rate for smooth visuals; reconciliation corrects drift on each server snapshot

### Files
| File | Status |
|------|--------|
| `server/movement.go` | **New** — `InputCommand` struct, `simulateMovement()`, `getMoveSpeedServer()`, `getJumpVelServer()` |
| `server/codec.go` | Modified — `decodeBinaryInput()` returns `(InputCommand, snapshotAck, ok)` from 10-byte format, `encodeInputAck()` with velY+onGround |
| `server/main.go` | Modified — `velY`/`onGround`/`lastProcessedSeq`/`inputQueue` in playerStore, `processInputsLocked()` replaces old `applyInputLocked()` |
| `client/js/prediction.js` | **New** — `captureInput()`, `reconcile()`, `predictStep()`, `onInputAck()`, `resetPrediction()` |
| `client/js/codec.js` | Modified — `encodeInput()` 10-byte format (with snapshotAck), `decodeInputAck()` |
| `client/js/net.js` | Modified — `sendInput()` takes cmd, inputAck handling, `serverAuthPos`+`onReconcile` in applySnapshot |
| `client/js/main.js` | Modified — prediction wired into game loop, 60Hz capture+send, jump via `requestJump()` flag |

---

## Phase 3: Delta Compression + Binary State Snapshots ✅ COMPLETE

**Goal**: Reduce bandwidth ~10-20x. Send only what changed since client's last ack'd snapshot.

**Status**: Implemented 2026-04-06. Server tracks per-client baselines, sends delta-compressed player state. Projectiles, effects, and match state are sent in full every tick (small and change frequently).

**What was done**:
- Added snapshot sequence (uint16) to all state messages (full and delta)
- 64-entry snapshot ring buffer stores quantized player states per tick
- Per-client `lastAckedSnapshotSeq` tracks each client's baseline
- Client piggybacks snapshot ack in input message (extended from 8 to 10 bytes)
- Delta message (0x81): per-player 16-bit changed mask + only changed field bytes
- Full snapshot (0x82) fallback when no valid baseline exists (first connect, too old)
- Round messages (0x83) always use full snapshot for reliability
- Self player handling: delta position extracted for reconciliation, not applied directly

**Delta encoding**:
- 16-bit changed mask groups 38-byte player state into 16 field groups
- Bit 0-4: posX, posY, posZ, yaw, pitch (2 bytes each)
- Bit 5-6: hp, armor (1 byte each)
- Bit 7: credits (2 bytes)
- Bit 8: team+kills+deaths (5 bytes)
- Bit 9: flags/crouching/alive/inMatch/isBot/reloading (1 byte)
- Bit 10-12: pistol, heavy, utilities (3 bytes each)
- Bit 13-15: timers (2-4 bytes each)
- Unchanged player: 3 bytes (id + mask=0x0000) vs 39 bytes full
- Moving player: ~9 bytes (id + mask + posX + posZ + yaw) vs 39 bytes full

**Message formats**:
- Full state (0x82/0x83): `[type:1] [snapshotSeq:2] [serverTime:4] [counts:3] [players...] [rest...]`
- Delta state (0x81): `[type:1] [snapshotSeq:2] [baselineSeq:2] [serverTime:4] [numPlayers:1] [deltas...] [projectiles...] [effects...] [match...]`
- Input (0x02): `[type:1] [cmdSeq:2] [flags:1] [yaw:2] [pitch:2] [snapshotAck:2]` (10 bytes)

### Files
| File | Status |
|------|--------|
| `server/codec.go` | Modified — `quantizePlayerBlock()`, `computeChangedMask()`, `encodeDeltaStateBinary()`, snapshotSeq in full state header, `decodeBinaryInput()` reads 10-byte input with snapshot ack |
| `server/main.go` | Modified — `snapshotSeq`+`snapshotBuf` in Game, `lastAckedSnapshotSeq` in playerStore, `stateTick()` sends per-client delta or full, input handler reads ack |
| `client/js/codec.js` | Modified — `decodeDeltaState()`, `applyDeltaToPlayer()`, `dequantizePlayerBlock()`, `encodeInput()` sends 10-byte with ack, `decodeState()` reads snapshotSeq |
| `client/js/net.js` | Modified — `lastRecvSnapshotSeq` tracking, `applyDeltaSnapshot()`, `sendInput()` passes ack, delta state handler in `handleMsg()` |

---

## Phase 4: Visibility Culling + Interest Management (deferred)

**Goal**: Only send entity data that the client should know about. Anti-wallhack at the network level.

**Why deferred**: With small player counts and delta compression already reducing bandwidth significantly, visibility culling adds complexity without meaningful gain. Revisit when player counts grow or anti-wallhack becomes a priority.

### 4.1 — Server: PVS (Potentially Visible Set) from Map Data

**Approach**: Pre-compute visibility between map regions at map load time.

1. Divide map into a grid of cells (e.g., 4m × 4m)
2. For each cell pair, ray-test between center points through wall geometry
3. Store as a bitfield: `pvs[cellA]` = bitfield of visible cells
4. At runtime: player in cell A → only replicate players in cells where `pvs[A]` bit is set

**New file**: `server/visibility.go` — grid division, PVS precomputation, runtime lookup

**Fallback for open areas**: If PVS is too coarse, add distance-based fallback — entities beyond 60m are not replicated (most FPS maps are smaller than this anyway).

### 4.2 — Server: Per-Client Entity Filtering

In `stateTick()`, for each client:
1. Determine client's grid cell
2. Look up PVS bitfield
3. For each other player: include in snapshot only if their cell is in PVS
4. For projectiles/effects: include only if within relevant radius

**Anti-wallhack guarantee**: If a player's data never reaches the client, no hack can reveal them.

### 4.3 — Client: Handle Missing Players

Client must handle players appearing/disappearing from snapshots gracefully:
- Player appears: initialize interpolation state, fade-in model
- Player disappears: keep rendering at last known position briefly (200ms), then hide
- Prevents pop-in when rounding corners

### Files Changed
| File | Change |
|------|--------|
| `server/visibility.go` | **New** — PVS precomputation from map walls, grid system, runtime queries |
| `server/main.go` | `stateTick()` → filter per-client based on PVS before delta encoding |
| `server/collision.go` | Expose wall data for PVS ray tests |
| `client/js/net.js` | Handle partial player lists gracefully (appear/disappear logic) |
| `client/js/main.js` | Add fade-in/fade-out for players entering/leaving visibility |

---

## Phase 5: Priority-Based Entity Updates (deferred)

**Goal**: Allocate bandwidth intelligently. Nearby/active entities update more often.

**Why deferred**: Delta compression (Phase 3) already keeps bandwidth low. Priority-based updates add server-side complexity for marginal gains at current player counts. Revisit alongside Phase 4 when scaling up.

### 5.1 — Server: Priority Accumulator System

Each entity gets a per-client **priority accumulator** (float64):

**Priority factors**:
- Distance: `priority += 1.0 / max(distance, 1.0)` — closer = higher
- Recent state change: `priority += 3.0` if entity state changed this tick
- In crosshair: `priority += 2.0` if entity is near client's aim direction
- Relevance: `priority += 5.0` if entity damaged or was damaged by this client recently
- Minimum: every entity accumulates at least `0.1` per tick (guarantees eventual update)

**Per tick**:
1. Accumulate priority for all entities
2. Sort by accumulated priority
3. Fill packet up to max size (1200 bytes) with highest-priority entity deltas
4. Reset sent entities' accumulators to 0; unsent entities keep accumulating

**Result**: Nearby enemies update at full 60Hz. Distant, stationary players update at ~10-15Hz. No entity is starved.

### 5.2 — Adaptive Precision

- Entities within 20m: full precision (16-bit positions)
- Entities 20-50m: reduced precision (12-bit positions, ~1.5cm)
- Angles: always full precision (aim direction matters at all ranges)

### Files Changed
| File | Change |
|------|--------|
| `server/priority.go` | **New** — per-client priority accumulators, sorting, bandwidth budgeting |
| `server/main.go` | Wire priority system into `stateTick()` entity selection |
| `server/snapshot.go` | Support variable precision encoding per entity |

---

## Phase 6: Improved Clock Sync + Jitter Buffer ✅ COMPLETE

**Goal**: Tighter time synchronization, smoother interpolation under jitter.

**Status**: Implemented 2026-04-07. Multi-sample clock sync replaces single-sample EMA. Adaptive jitter buffer replaces fixed 100ms render delay. Per-player snapshot ring buffer with extrapolation replaces prev/target pair interpolation.

**What was done**:

### 6.1 — Multi-Sample Clock Sync
- On connect: 8 sync probes spaced 100ms apart via existing ping/pong binary messages
- Probes collected, sorted by RTT ascending, outliers (RTT > median + 1σ) discarded
- Remaining offsets averaged → initial `serverClockOffset`
- Ongoing: re-probe every 10 seconds with 3 samples, 5% EMA blend for stability
- Latency tracked with same 0.7/0.3 EMA as before per individual pong
- Snapshot-based clock offset retained as backup (0.85/0.15 EMA)

### 6.2 — Adaptive Jitter Buffer
- Tracks inter-snapshot arrival jitter: `jitter = EMA(|actual_interval - expected_interval|)`, weight 0.1
- Render delay = `max(2 × tick_interval, 3 × jitter)`, clamped [33ms, 200ms]
- Good connections: delay settles to ~33ms (2 ticks at 60Hz) — 3× better than fixed 100ms
- Bad connections: delay grows to absorb jitter, prevents stutter
- Starts at 100ms (old value) and adapts from there

### 6.3 — Per-Player Snapshot Ring Buffer
- 6-entry ring buffer per remote player stores {serverTimeMs, pos, yaw, pitch, crouching}
- `sampleRemotePlayer()` finds bounding snapshots for render time and interpolates
- Packet loss: linear extrapolation from last two entries for up to 100ms, then freeze
- Replaces old prev/target pair interpolation — more robust, handles gaps and reordering
- No server changes needed — probes use existing ping/pong protocol

### Files
| File | Status |
|------|--------|
| `client/js/clock.js` | **New** — `createClockSync()`, `startClockSync()`, `stopClockSync()`, `onPong()`, outlier rejection, batch finalization |
| `client/js/jitter.js` | **New** — `createJitterBuffer()`, `onSnapshotArrival()`, `getRenderDelayMs()`, `createSnapRing()`, `pushSnapRing()`, `sampleSnapRing()` with extrapolation |
| `client/js/net.js` | Modified — imports clock.js/jitter.js, `createNet()` adds clockSync+jitterBuffer, `startHeartbeat()`→`startClockSync()`, `applyPong()`→clock module, `sampleRemotePlayer()`→snapshot ring, `ensurePlayer()` adds snapRing, `applyTransformState()`→`pushSnapRing()`, removed prev/target fields and old lerp helpers, `syncSnapshotClock()` tracks jitter, new `getAdaptiveRenderDelay()` export |
| `client/js/main.js` | Modified — imports `getAdaptiveRenderDelay`, replaces fixed `REMOTE_RENDER_DELAY_MS=100` with adaptive delay |

---

## Phase 7: Hermite Interpolation

**Goal**: Smoother remote player motion, especially at direction changes.

### 7.1 — Velocity-Aware Interpolation

Current: linear lerp between two position snapshots.
New: Hermite (cubic) interpolation using position + velocity at each sample point.

**Server change**: Include velocity in player state (already computed during movement simulation in Phase 2). Add `vel_x`, `vel_z` to snapshot — 4 extra bytes per player.

**Client change** in `sampleRemotePlayer()`:
```
Given: p0, v0 (start pos/vel), p1, v1 (end pos/vel), t (0..1)
h00 = 2t³ - 3t² + 1
h10 = t³ - 2t² + t
h01 = -2t³ + 3t²
h11 = t³ - t²
result = h00×p0 + h10×(dt×v0) + h01×p1 + h11×(dt×v1)
```

This eliminates the "linear zig-zag" artifact when a player changes direction — the curve smoothly transitions through velocity changes.

### 7.2 — Angle Interpolation

- Yaw: already handles wraparound — keep as-is but use slerp for smoother turns
- Pitch: linear is fine (small range, no wraparound issues)

### Files Changed
| File | Change |
|------|--------|
| `server/snapshot.go` | Add velocity fields to player snapshot |
| `server/codec.go` | Encode velocity in delta snapshots |
| `client/js/codec.js` | Decode velocity fields |
| `client/js/net.js` | Store velocity in player state, pass to interpolation |
| `client/js/net.js` | Replace linear lerp in `sampleRemotePlayer()` with Hermite interpolation |

---

## Phase 8: Enhanced Lag Compensation

**Goal**: Bring lag comp to industry parity. The foundation is already good — refine it.

### 8.1 — Animation-State Rewind

Currently: only position + crouching are rewound.
Add: store hitbox state (standing/crouching transition progress) in position history so hitboxes during crouch transitions are accurate.

### 8.2 — Bounding Sphere Pre-Test

Before full AABB ray intersection on rewound hitboxes:
1. Compute bounding sphere around player (center = chest height, radius = 1.2m)
2. Ray-sphere test first (very cheap)
3. Only do AABB tests on candidates that pass sphere test

Reduces cost from O(players × 3 hitboxes) to O(players × 1 sphere) + O(candidates × 3 hitboxes).

### 8.3 — Configurable Lag Compensation Cap

Expose `maxLagCompensationMS` as a server config variable (currently hardcoded 250ms). Allow server operators to tune based on their player base latency.

### Files Changed
| File | Change |
|------|--------|
| `server/main.go` | Add crouch-transition state to ring buffer samples |
| `server/main.go` | Add bounding sphere pre-test in `findHitTargetLocked()` |
| `server/main.go` | Make `maxLagCompensationMS` configurable via env var |

---

## Implementation Order & Dependencies

```
Phase 1 ✅ ──→ Phase 2 ✅ ──→ Phase 3 ✅ ──→ Phase 5
                  │               │
                  │               └──→ Phase 4
                  │
                  └──→ Phase 7

Phase 6 ✅ (independent)
Phase 8 (independent, anytime)
WebRTC migration (independent, anytime — transport swap only)
```

**Recommended order**:

| Order | Phase | Status |
|-------|-------|--------|
| 1st | **Phase 1: Binary Protocol** | ✅ Complete |
| 2nd | **Phase 2: Input-Based Movement** | ✅ Complete |
| 3rd | **Phase 3: Delta Compression** | ✅ Complete |
| 4th | **Phase 6: Clock Sync + Jitter** | ✅ Complete |
| 5th | **Phase 7: Hermite Interpolation** | Next candidate. Requires velocity from Phase 2 |
| 6th | **Phase 8: Enhanced Lag Comp** | Polish. Independent |
| — | **Phase 4: Visibility Culling** | Deferred. Low priority with small player counts |
| — | **Phase 5: Priority Updates** | Deferred. Low priority with small player counts |
| — | **WebRTC Migration** | Deferred. Revisit when TCP head-of-line blocking is measurable |

---

## Bandwidth Estimates

**Before Phase 1** (10 players, 60Hz, JSON):
- Per snapshot: ~10 players × ~300 bytes JSON = ~3KB
- Per second: 3KB × 60 = **180 KB/s per client**
- Total outbound (10 clients): **1.8 MB/s**

**After Phase 1 ✅** (binary encoding, measured):
- Per-player state block: 39 bytes (includes full weapon slots, timers, flags)
- Per snapshot: header(10B) + 10 players × 39B + match state = ~432 bytes
- Per second: 432 × 60 = **25.9 KB/s per client** (~7x reduction)

**After Phase 3 ✅** (delta compression):
- Delta header: 10 bytes (vs 10 bytes full). Player delta: 3 bytes (unchanged) to 9 bytes (moving)
- Moving player: id(1) + mask(2) + posX(2) + posZ(2) + yaw(2) = 9 bytes vs 39 bytes full
- Stationary player: id(1) + mask(2) = 3 bytes vs 39 bytes full
- Projectiles/effects/match: sent in full (small, change frequently)
- Average with 5 moving / 5 stationary: 5×9 + 5×3 + ~60 match = ~120 bytes
- Per second: 120 × 60 = **7.2 KB/s per client** (~3.5x reduction from Phase 1, ~25x from JSON)

**After Phases 4+5** (visibility + priority):
- Only visible players sent, distant players at lower rate
- Typical: 3-5 visible players × ~6 bytes = ~30 bytes
- Per second: 30 × 60 = **1.8 KB/s per client** (~100x reduction from current)

---

## Testing Strategy

Each phase should be validated before moving to the next:

| Phase | Validation |
|-------|-----------|
| Phase 1 | ✅ Binary encode → decode roundtrip tests. Server builds, tests pass |
| Phase 2 | ✅ Server-authoritative movement. Client prediction + reconciliation. 69 client tests, server tests pass |
| Phase 3 | ✅ Delta encode against per-client baselines. Full snapshot fallback. All tests pass |
| Phase 4 | Players behind walls never appear in network dumps. No pop-in at corners |
| Phase 5 | Nearby entities update at 60Hz, distant at <15Hz. No entity starved >500ms |
| Phase 6 | ✅ Multi-sample clock sync, adaptive jitter buffer, snapshot ring interpolation. 69 client tests pass |
| Phase 7 | Visual smoothness comparison: record interpolated positions, compare linear vs Hermite |
| Phase 8 | Hit registration accuracy at various latencies (50ms, 100ms, 200ms) |

---

## Risk Areas

| Risk | Mitigation |
|------|-----------|
| Browser UDP (WebRTC DataChannel) is complex to set up | Deferred — using WebSocket binary. All phases are transport-agnostic. Revisit when TCP HOL blocking is measurable |
| Client/server physics divergence causes constant reconciliation corrections | Use fixed-point arithmetic or quantize before simulation. Extensive determinism testing with recorded inputs |
| Delta compression bugs cause desynced state | Full snapshot fallback every N seconds as safety net. Server tracks per-client "health" and forces full snapshot on mismatch |
| PVS precomputation is expensive for large maps | Compute at map load (one-time cost). Cache to disk. Grid resolution is tunable |
| Increased server CPU from movement simulation | Profile. SoA layout already cache-friendly. Movement sim is simple arithmetic — 10 players at 60Hz is trivial |
