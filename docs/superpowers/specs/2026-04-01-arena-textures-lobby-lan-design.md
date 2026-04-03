# Arena FPS: Textures, Arena, Lobby, LAN Support

## Overview

Overhaul the black-screen FPS into a playable LAN game with procedural textures, a larger arena with varied geometry, a lobby system for player name/IP entry, and LAN connectivity.

## 1. Renderer Overhaul

- Vertex layout: position(3) + color(3) + uv(2) = 32-byte stride
- Fragment shader with procedural textures:
  - `brickPattern(uv)` — red/brown brick for walls
  - `tilePattern(uv)` — gray tile grid for floors
  - `concretePattern(uv)` — rough concrete for ceilings
  - `metalPattern(uv)` — brushed metal for pillars/accents
- Material type encoded in vertex color channels (R>0.9=brick, G>0.9=tile, B>0.9=metal, else concrete)
- Directional lighting: `diffuse = max(dot(normal, lightDir), 0.0) * 0.7 + 0.3`
- Light direction: normalized vec3 from upper-left

## 2. Arena (60x60)

- Expanded from 40x40 to 60x60
- Zones: open center courtyard, side corridors, corner platforms
- Cover: L-shaped walls, stacked crates, narrow passages
- Material types per surface (brick walls, tile floors, concrete ceilings, metal pillars)
- Updated spawn points to 6 positions around the arena
- Updated collision and boundary checks

## 3. Lobby UI

- Name input (3-12 chars, required)
- Server IP input (default: `window.location.hostname:8080`)
- Connect button
- Player list showing connected names
- Start Game button (enabled when connected)
- Controls reference text
- Overlay hidden when game starts

## 4. Server Lobby

- States: `waiting` (lobby) -> `playing` (game active)
- New messages: `lobby` (player list), `start` (game begin)
- Player name stored from join message
- Any player can trigger game start
- Server prints LAN IP on startup
- On player disconnect during lobby, update list
- Game can be restarted (back to lobby) after match

## 5. LAN Support

- Server listens on 0.0.0.0:8080 (all interfaces)
- Client defaults to `window.location.hostname`
- Manual IP override in lobby
- Server auto-detects and prints LAN IP on startup
