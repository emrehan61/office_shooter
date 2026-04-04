# Office Shooter

**A browser-based LAN FPS set inside a stylized software office.**

Office Shooter is a fast multiplayer shooter built for quick local matches with friends on the same Wi-Fi. The game runs in the browser, the server is written in Go, and the arena is designed as an open office with meeting pods, desk clusters, reception space, cafe lanes, glass dividers, and tight sightlines that keep fights moving.

- Office-themed map instead of a plain box arena
- Browser join flow for fast LAN play
- First-person weapon view with hands, recoil, kickback, and muzzle flash
- Distinct player colors, kill feed, ammo counter, and `Tab` leaderboard
- Ping display and server-authoritative lag-compensated shooting
- Go WebSocket server running a `60` tick simulation loop

## Why It Stands Out

This project is intentionally built to feel more like a playable game page than a networking prototype. The office setting gives the map a stronger identity than a generic test arena, while the combat layer adds the details that make a small FPS feel responsive: recoil, visible weapon movement, head and body damage, live ping, remote shot feedback, and a scoreboard you can check without leaving the match.

Under the hood, the server keeps the important decisions authoritative. Shots are resolved server-side, rewound through recent position history for fairer lag compensation, and processed through a dense struct-of-arrays player store so the hot path stays cache-friendlier than a pointer-heavy map of player structs.

## Build And Run

### Prerequisites

- Go
- Node.js

### Verify The Project

Run the full client and server test suite from the repo root:

```bash
npm test
```

### Build A Server Binary

If you want a local binary build:

```bash
cd server
go build -o fps-server .
PORT=8090 ./fps-server
```

### Run In Development

For normal local development, run the Go server directly:

```bash
cd server
PORT=8090 go run .
```

The server also serves the browser client, so there is no separate frontend build step right now.

### Run With Docker

Build the container image from the repo root:

```bash
docker build -t office-shooter .
```

Run it on port `8080`:

```bash
docker run --rm -p 8080:8080 office-shooter
```

Then open:

```text
http://localhost:8080
```

### Open The Game

On the same machine as the server:

```text
http://localhost:8090
```

For friends on the same Wi-Fi:

```text
http://<your-lan-ip>:8090
```

Important notes:

- All players should be on the same local network for the current LAN flow.
- `0.0.0.0` is a bind address, not a browser address. Do not enter it in the game UI.
- Open the page, enter a player name, click `Connect`, then start the match from the lobby.

## Controls

- `WASD`: move
- `Mouse`: look
- `Left Click`: shoot
- `Space`: jump
- `Tab`: show leaderboard

## Gameplay Rules

- Headshots deal `90` damage.
- Body shots deal `20` damage.
- Players spawn with `250` ammo.
- Each kill restores `10` ammo, capped at `250`.
- The leaderboard sorts by kills first, then deaths.
- Eliminated players respawn after a short delay.

## Networking And Performance

The game uses a browser client over WebSocket, with the Go server serving both the static files and the multiplayer session. That keeps the setup simple for LAN play: one process, one port, one URL to share with friends.

Combat is server-authoritative. The client sends movement and shot intent, but hit detection is validated on the server. To make shooting feel more accurate across normal LAN delay, the server keeps a short history of player positions and resolves shots against rewound positions instead of only the latest snapshot.

The simulation runs at `60` ticks per second, and the server hot path uses a struct-of-arrays player store. Positions, health, names, kills, deaths, connection handles, and lag-comp history are kept in dense indexed slices with an `id -> index` lookup map, which reduces pointer chasing in snapshot assembly, hit detection, and player iteration.

## Project Layout

- `client/index.html`: main page, HUD, overlay, and lobby shell
- `client/js/main.js`: game loop, lobby flow, player update, shooting, HUD wiring
- `client/js/net.js`: WebSocket session handling, ping tracking, state sync, shot timestamps
- `client/js/world.js`: office map geometry, props, collision layout, and spawn points
- `client/js/weapon.js`: first-person weapon model, recoil, kickback, muzzle flash, bobbing
- `client/js/hud.js`: health, ammo, ping, kill feed, damage flash, and leaderboard
- `server/main.go`: server entrypoint, WebSocket handlers, state snapshots, lag compensation, combat, respawns, and SoA player storage

## Roadmap

- Add stronger audio, impact effects, and ambient office feedback
- Expand the office environment with more props, rooms, and alternate layouts
- Improve session UX around lobby flow, reconnects, and match start feedback
- Add a cleaner deployment story for sharing the game outside a pure LAN setup
