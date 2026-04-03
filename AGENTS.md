# AGENTS.md

## Project

Browser-based LAN FPS game with:

- Go WebSocket server in `server/`
- browser client in `client/`
- tests driven by `npm test`

## Run

- Server: `cd server && PORT=8090 go run .`
- Open locally: `http://localhost:8090`
- Open on LAN: `http://<your-lan-ip>:8090`

## Test

- Full suite: `npm test`
- Server only: `cd server && GOCACHE=$(pwd)/../.gocache go test ./...`
- Client only: `node --test client/js/*.test.js`

## Structure

- `client/js/main.js`: game loop, HUD wiring, lobby flow
- `client/js/net.js`: browser networking, ping, state sync
- `client/js/world.js`: map geometry and collision
- `client/js/weapon.js`: recoil, muzzle flash, first-person weapon
- `server/main.go`: multiplayer server, snapshots, lag compensation, combat

## Notes

- Keep the client/server WebSocket protocol compatible unless a coordinated change is intended.
- Prefer small gameplay changes with tests before changing the rendering or network model.
- The server hot path uses a struct-of-arrays player store; preserve dense index semantics and `idToIndex` correctness.
- When removing players, swap-delete all SoA slices and update `idToIndex`.
- Keep `.gocache/` untracked.
