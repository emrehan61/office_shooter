# Deathmatch Mode Design

**Date:** 2026-04-04

## Goal

Add a selectable free-for-all `deathmatch` mode alongside the existing team mode without regressing the current round-based game. Deathmatch should let every player damage every other player, auto-add one bot when exactly one human is present, respawn players immediately after death, run for 10 minutes, then show a 10-second rejoin vote that restarts the next deathmatch if at least one player accepts.

## Current State

The current game assumes one mode throughout the stack:

- the lobby requires blue/green team assignment before start
- the server blocks friendly fire by team
- round end depends on team elimination or team timeout scoring
- players only respawn on round transitions
- fallback bot logic exists only to fill an empty team
- the HUD and announcer present team scores and round states only

The hot path already performs well because all active players live in the dense struct-of-arrays store in [server/main.go](/Users/emrehanhosver/Desktop/projects/office_shooter/server/main.go). That layout and `idToIndex` swap-delete behavior must remain unchanged.

## Scope

Included:

- a reusable mode model with `team` and `deathmatch`
- lobby mode selection before match start
- server-authoritative deathmatch rules for targeting, spawning, match timing, and restart flow
- one fallback bot when exactly one human is present in deathmatch
- leaderboard ordering by kills descending, then deaths ascending
- a 10-second rejoin prompt after deathmatch expiry
- automated server and client tests for mode selection, timing, respawn, and restart voting

Excluded:

- changing the existing weapon/economy model unless deathmatch needs explicit gating
- adding more than one deathmatch bot
- pathfinding or advanced bot behavior
- redesigning rendering or networking beyond the new mode/rejoin metadata

## Design

### Mode Model

Introduce a small mode layer instead of scattering `if deathmatch` branches.

Server-side:

- add a `GameMode` enum-like type with `team` and `deathmatch`
- store the selected mode on `Game`
- add small helper methods for mode-sensitive behavior:
  - lobby validation
  - team assignment availability
  - target filtering
  - spawn selection
  - bot synchronization
  - death handling and respawn policy
  - match expiry and restart handling

Client-side:

- add mode constants/helpers in a dedicated file rather than overloading `teams.js`
- keep `teams.js` focused on team mode rules
- let [client/js/main.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/main.js) switch lobby controls based on the selected mode

This creates an extension point for future modes while keeping the existing team flow intact and fast.

### Lobby Flow

The waiting lobby gains mode selection controls:

- `Team` keeps the current team-select buttons and start rules
- `Deathmatch` hides team selection and instead shows mode-specific start guidance

Protocol changes:

- `lobby`, `welcome`, `start`, `round`, and `state` include the active mode in `match`
- the client sends a new `mode` message while the game is waiting

Server rules:

- mode can only change while `StateWaiting`
- switching from `team` to `deathmatch` clears any fallback team bot and ignores team requirements
- switching from `deathmatch` to `team` returns players to the existing team-assignment flow

Start validation:

- `team` keeps current behavior
- `deathmatch` requires at least one named human; if exactly one human is present, sync one bot before allowing start

### Deathmatch Runtime

Deathmatch is a continuous 10-minute match:

- set the match timer to 10 minutes at start
- disable buy phase and round cooldown
- ignore team elimination logic
- do not award team scores or alive counts as meaningful win conditions
- allow every living actor except self to be a valid target

Deaths in deathmatch:

- increment kills/deaths immediately
- strip temporary death state as needed
- schedule an immediate respawn after the existing respawn delay
- respawn at neutral spawn points chosen from the full map spawn set rather than team-only spawns

Economy:

- preserve the current loadout/economy system unless a rule explicitly blocks team-only assumptions
- deathmatch should not rely on buy-time windows, so buying remains unavailable during live play unless current logic already permits otherwise

### Bot Behavior

Reuse the existing fallback bot pattern, but make bot syncing mode-aware.

Deathmatch bot rule:

- if there is exactly one human in the waiting or active deathmatch roster, ensure exactly one bot exists
- if human count becomes `0` or `>= 2`, remove any deathmatch bot

The bot remains inside the same dense player store and uses the existing movement/shooting code paths. In deathmatch it should:

- treat every non-self living player as a valid target
- respawn using the same immediate-respawn flow as humans
- appear on the leaderboard like any other player

### Match End And Rejoin Vote

When the 10-minute deathmatch timer expires:

- stop active combat by ending the current match
- broadcast a deathmatch-end state with a 10-second vote window
- show a client prompt with `Yes` or `No`

Vote rules:

- players who click `Yes` are marked for the next deathmatch cycle
- players who click `No` return to the waiting lobby immediately
- if the 10-second window expires and at least one connected human voted `Yes`, restart deathmatch automatically with only the opted-in humans plus a bot if exactly one human remains
- if nobody votes `Yes`, drop back to the waiting lobby

The server remains authoritative for the countdown and participant list. Late or duplicate votes should be ignored once the window closes.

### HUD, Leaderboard, And Audio

The Tab leaderboard already sorts by kills then deaths. Keep that ordering authoritative for both modes and continue using credits/name as later tie-breakers.

HUD changes for deathmatch:

- mode-aware header text, replacing team-round language with deathmatch status where needed
- neutral match timer display for the 10-minute countdown
- rejoin prompt overlay during the 10-second vote

Audio:

- reuse existing kill announcer cues where they still make sense
- suppress or adapt strictly team-round victory cues during deathmatch end so they do not incorrectly announce blue/green winners

## File Changes

### Create

- [client/js/modes.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/modes.js)

Responsibilities:

- shared client mode constants
- lobby mode labels
- client-side deathmatch start validation helper

### Modify

- [client/index.html](/Users/emrehanhosver/Desktop/projects/office_shooter/client/index.html)
- [client/style.css](/Users/emrehanhosver/Desktop/projects/office_shooter/client/style.css)
- [client/js/main.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/main.js)
- [client/js/net.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/net.js)
- [client/js/hud.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/hud.js)
- [client/js/audio.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/audio.js)

Responsibilities:

- render and send lobby mode selection
- consume mode and rejoin-vote protocol updates
- show/hide team controls based on mode
- display deathmatch countdown and rejoin prompt
- keep leaderboard ordering and announcer behavior correct for both modes

### Modify

- [server/main.go](/Users/emrehanhosver/Desktop/projects/office_shooter/server/main.go)

Responsibilities:

- store selected mode and deathmatch restart state
- validate starts by mode
- sync deathmatch bot lifecycle
- allow free-for-all targeting in deathmatch
- respawn deaths immediately in deathmatch
- end deathmatch on timer and process 10-second rejoin votes
- preserve current dense player store and swap-delete correctness

### Modify

- [client/js/net.test.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/net.test.js)
- [client/js/hud.test.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/hud.test.js)
- [client/js/teams.test.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/teams.test.js)
- [server/main_test.go](/Users/emrehanhosver/Desktop/projects/office_shooter/server/main_test.go)

Responsibilities:

- cover mode selection and match metadata
- cover deathmatch lobby validation
- cover free-for-all hit selection and bomb damage
- cover immediate respawns
- cover vote-driven restart and bot syncing

## Error Handling

- Unknown mode values normalize back to `team` or are rejected while waiting.
- Mode changes during active matches are denied without changing server state.
- Rejoin votes outside an active deathmatch vote window are ignored.
- If all human players disconnect during a vote window or active deathmatch, end cleanly and return to waiting.
- Respawn scheduling must tolerate players disconnecting before their timer fires.
- All bot add/remove operations must preserve dense index updates exactly as current swap-delete code expects.

## Testing Strategy

Add or update tests for:

- mode selection appears in lobby/match snapshots
- deathmatch start requires one human and injects a bot only for solo play
- deathmatch targeting allows every non-self player and explosive damage is not team-filtered
- deathmatch kills trigger delayed respawns instead of round-only respawns
- deathmatch expires after 10 minutes and opens a 10-second vote window
- one `Yes` vote restarts deathmatch; zero `Yes` votes returns to waiting lobby
- client mode controls and rejoin prompt reflect server snapshots
- leaderboard sorting remains kills desc, deaths asc

Run:

- `cd /Users/emrehanhosver/Desktop/projects/office_shooter && npm test`
