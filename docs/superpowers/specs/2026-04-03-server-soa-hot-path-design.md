# Server SoA Hot-Path Design

**Date:** 2026-04-03

## Goal

Refactor the Go server's simulation and snapshot hot path from an array-of-structs model (`map[int]*Player`) to a struct-of-arrays layout while keeping the existing WebSocket transport and client protocol unchanged.

## Current State

The current server in [server/main.go](/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main.go) stores player state as:

- `players map[int]*Player`
- one `Player` struct per connected client
- per-player fields for gameplay, connection handles, and lag-comp history
- frequent iteration over map values in `broadcastLobby`, `stateTick`, `findHitTarget`, respawn handling, and lifecycle code

This design is simple, but it adds:

- map iteration overhead on the 60 Hz state loop
- pointer chasing through `*Player`
- repeated locking and unlocking around per-player state access
- fragmented storage for position history

## Scope

This refactor is intentionally limited to the server hot path.

Included:

- player simulation state
- lag-compensation history storage
- snapshot assembly
- hit detection iteration
- respawn/kill bookkeeping
- `id -> index` lookup

Excluded:

- WebSocket transport replacement
- client protocol shape changes
- browser/client data layout refactors
- unrelated rendering or gameplay feature work

## Design

### Data Model

Replace the `map[int]*Player` storage pattern with a dense indexed store.

Introduce a `PlayerStore` owned by `Game` with parallel slices:

- `ids []int`
- `names []string`
- `pos []Vec3`
- `yaw []float64`
- `pitch []float64`
- `hp []int`
- `alive []bool`
- `kills []int`
- `deaths []int`
- `conns []*websocket.Conn`
- `sendChs []chan []byte`
- `history [][]positionSample`

Maintain:

- `idToIndex map[int]int`
- dense indices from `0..len(ids)-1`

On removal, use swap-delete:

1. move the last player's data into the removed slot
2. update `idToIndex` for the moved player
3. shrink all slices by one

This preserves dense iteration and avoids holes.

### Ownership and Synchronization

Move away from per-player locking as the primary access pattern.

Keep locking at the `Game` level:

- write lock for connect/disconnect/input/kill/respawn mutations
- read lock for snapshot and broadcast iteration when only reading store state

The SoA store becomes the single source of truth for gameplay state. Connection write goroutines remain per-client, but indexed by store slot.

### Index-Based Operations

Rewrite hot operations to use indices:

- `addPlayer` returns a player id and appends all SoA slices
- `removePlayer` removes by index using `idToIndex`
- `stateTick` iterates `for i := range store.ids`
- `findHitTarget` iterates contiguous arrays and reads target position from `history[i]`
- kill/respawn updates mutate slices by index
- lobby/state messages are assembled from indexed slices

### Lag Compensation

Keep the current lag-compensation behavior, but move history to `history[index]`.

Each history entry remains:

- `At int64`
- `Pos Vec3`

Required helper behavior:

- append new samples on accepted input
- trim samples older than the configured window
- interpolate from `history[index]` when resolving a timestamped shot

### Message Compatibility

Do not change client message or server message formats.

The following stay stable:

- `welcome`
- `lobby`
- `state`
- `shot`
- `hit`
- `kill`
- `respawn`
- `pong`

The client should not need code changes to consume the SoA refactor.

## File Changes

### Modify

- `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main.go`

Primary responsibilities after refactor:

- `Game` owns `PlayerStore`
- connection lifecycle uses indexed storage
- state tick, lag compensation, kill/respawn, lobby/state assembly read/write SoA slices

### Modify

- `/Users/alyo/Desktop/personaltobedeleted/fps-game/server/main_test.go`

Primary responsibilities after refactor:

- verify SoA add/remove semantics
- verify swap-delete keeps indices valid
- verify snapshot contents remain correct
- verify lag-compensation helpers continue to interpolate correctly

## Error Handling

The refactor must preserve current user-visible behavior:

- late join and disconnect behavior stays intact
- empty server resets to waiting
- `server full` behavior stays intact
- stale or missing history still falls back safely to latest position

If an id lookup fails unexpectedly during disconnect or respawn, the server should no-op rather than panic.

## Testing Strategy

Add or update tests for:

- add/remove player index bookkeeping
- swap-delete correctness
- `stateTick` contents from SoA storage
- lag-comp interpolation with indexed history
- lobby broadcast correctness after removal/reorder
- kill/death persistence through SoA mutation path

Run:

- `cd /Users/alyo/Desktop/personaltobedeleted/fps-game/server && GOCACHE=$(pwd)/../.gocache go test ./...`
- `cd /Users/alyo/Desktop/personaltobedeleted/fps-game && npm test`

## Risks

### Index invalidation

Swap-delete is fast but easy to get wrong. Every moved player must update `idToIndex`.

### Connection routing

Broadcast and direct replies must use the correct indexed `sendCh`.

### Mixed old/new access paths

Leaving partial references to `*Player` alongside SoA storage would create incoherent state. The hot path should be fully migrated in one pass.

## Acceptance Criteria

The refactor is complete when:

- server hot-path state is stored in SoA form
- WebSocket protocol remains compatible with the current client
- lag compensation still works with indexed history
- `go test` and `npm test` pass
- no user-visible multiplayer regressions are introduced in lobby, state sync, shooting, kill feed, or respawn flow
