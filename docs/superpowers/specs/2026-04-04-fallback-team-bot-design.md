# Fallback Team Bot Design

**Date:** 2026-04-04

## Goal

Allow a match to start and continue when one team has no human players by adding a server-authoritative fallback bot that fills the empty side, stands at spawn, turns toward enemies, and fires a pistol with simple imperfect timing.

## Current State

The current lobby and server both require:

- at least two connected players
- every player assigned to a team
- both teams populated by players
- perfectly even teams

This blocks a solo player from starting a match and blocks any live match from continuing if one side becomes empty.

The server already owns the full combat simulation in [server/main.go](/Users/emrehanhosver/Desktop/projects/office_shooter/server/main.go), including:

- authoritative team assignment
- round start and respawn flow
- hitscan combat and damage
- per-tick state broadcast

The client mirrors the lobby start rules in [client/js/teams.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/teams.js) and only uses server snapshots for gameplay.

## Scope

Included:

- server-side fallback bot lifecycle
- bot participation in lobby, snapshots, combat, kills, and respawns
- updated start-rule validation on server and client
- automatic replacement of the bot when a human joins the empty team
- automated tests for lifecycle and basic bot combat behavior

Excluded:

- pathfinding
- utility use, buying, or economy strategy
- multi-bot team balancing
- new client rendering systems or protocol redesign

## Design

### Data Model

Represent the fallback bot inside the existing dense player store so it reuses current snapshot, round, and combat paths.

Add bot metadata to the server player store:

- `isBot []bool`
- bot-only AI timing/state fields needed to decide when to rotate and fire

Bot entries keep the same `id`, `name`, `team`, loadout, health, and alive state fields as human players. Their connection-related fields remain `nil`, and broadcast helpers must safely skip nil channels.

Human capacity remains based on connected humans, not total store entries. The fallback bot must not consume one of the six human join slots.

### Bot Lifecycle

Maintain at most one fallback bot.

Server rule:

- if one team has at least one human and the other team has zero humans, ensure a bot exists on the empty team
- otherwise remove any fallback bot

Apply that rule after:

- player join and successful naming
- team selection changes in the waiting lobby
- disconnects
- match start and match end transitions when roster conditions change

The fallback bot uses a stable server-generated name:

- `BOT Blue`
- `BOT Green`

When the bot is removed, it should disappear through the same lobby/state broadcasts humans already consume.

### Join and Replacement Behavior

When a human joins during a live match and would otherwise be auto-assigned to the empty team, the server must remove the bot first, then assign the human to that team and respawn them normally.

When a human explicitly selects the bot team in the waiting lobby, the server must remove the bot before accepting the assignment so the team stays human-occupied instead of bot-occupied.

If all humans leave, the server resets to waiting and clears the bot rather than running a bot-only game.

### Match Start Rules

The start condition changes from strict even teams to valid occupancy after bot sync.

Server start rules:

- at least one human player must exist
- every human player must be assigned to a team before starting from the waiting lobby
- after fallback bot synchronization, both teams must be occupied
- team size difference may be at most one

This allows:

- 1 human vs 1 bot
- 2 humans on one team vs 1 human on the other team with no bot
- 1 human on one team and 2 humans on the other team

This still disallows:

- unassigned humans
- empty matches
- rosters with a size gap larger than one

The client lobby logic should mirror these rules so the Start button state matches the server denial rules.

### Bot Combat Behavior

Keep the first bot intentionally simple and server-authoritative.

Each server tick, when the bot is alive and the match is in active round play:

1. find the nearest living enemy
2. turn yaw and pitch toward that target
3. wait for a small reaction/cooldown window
4. fire a pistol shot using the existing server-side shooting and hit detection path

Behavior constraints:

- the bot stays at its spawn point
- the bot only uses a pistol
- the bot never buys equipment or uses utility
- when its pistol clip is empty, it may use the existing pistol reload flow instead of inventing bot-only ammo rules
- the bot should miss sometimes by adding deterministic or bounded random aim error
- the bot should fire slower than the theoretical pistol fire limit so it feels beatable

The bot should use the same damage, kill reward, and respawn rules as any other player. That keeps kill feed, round resolution, and score tracking unchanged.

### Protocol Compatibility

Keep the current WebSocket message types and snapshot structure unchanged.

The bot appears as a normal player entry in:

- `lobby`
- `welcome` state snapshots
- `state`
- `round`
- `hit`
- `kill`
- `respawn`

No client-side bot-specific protocol branch should be required. The only client change is lobby validation, because the server will now allow a start with fallback occupancy rather than human-only occupancy.

## File Changes

### Modify

- [server/main.go](/Users/emrehanhosver/Desktop/projects/office_shooter/server/main.go)

Primary responsibilities:

- store bot metadata alongside the dense player store
- count humans separately from total occupants
- synchronize fallback bot creation/removal when rosters change
- route bot aim/fire decisions through the existing combat logic
- keep direct messaging safe for nil bot channels

### Modify

- [server/main_test.go](/Users/emrehanhosver/Desktop/projects/office_shooter/server/main_test.go)

Primary responsibilities:

- verify fallback bot lifecycle
- verify updated match-start validation
- verify replacement when a human joins the bot team
- verify bot firing behavior under deterministic test setup

### Modify

- [client/js/teams.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/teams.js)

Primary responsibilities:

- update start-state validation to match the new server rule

### Modify

- [client/js/teams.test.js](/Users/emrehanhosver/Desktop/projects/office_shooter/client/js/teams.test.js)

Primary responsibilities:

- verify start-state validation allows fallback-bot-compatible rosters

## Error Handling

The fallback bot feature must fail safe:

- if bot synchronization cannot find a valid empty team, do nothing
- if replacement is attempted and the bot no longer exists, continue with normal human assignment
- if a bot has no valid target, it should only rotate idly or do nothing, never panic
- direct sends to a bot must be skipped because it has no socket or writer

Unexpected id lookup failures should remain no-ops instead of panics.

## Testing Strategy

Add or update tests for:

- waiting lobby with one human assigned to blue adds `BOT Green`
- waiting lobby start validation succeeds for one human plus fallback bot
- assigning a human to the bot team removes the bot
- live join to an empty side removes the bot before auto-assignment
- bot tick logic selects an enemy, rotates, and emits a shot under deterministic timing
- direct/broadcast helpers do not panic with nil bot channels

Run:

- `cd /Users/emrehanhosver/Desktop/projects/office_shooter/server && GOCACHE=$(pwd)/../.gocache go test ./...`
- `cd /Users/emrehanhosver/Desktop/projects/office_shooter && node --test client/js/*.test.js`
- `cd /Users/emrehanhosver/Desktop/projects/office_shooter && npm test`

## Risks

### Dense-store removal correctness

Adding `isBot` and bot AI metadata increases swap-delete surface area. Every bot-related slice must participate in remove/swap logic or indices will corrupt.

### Slot accounting

If human capacity is still checked against total store length, the bot could incorrectly block a real player from joining.

### Bot firing path duplication

If the bot uses a separate combat path, the behavior will drift from human combat rules. The implementation should extract shared shoot logic instead of cloning it.

### Lobby/server rule mismatch

If the client keeps the old even-team rule, the server may allow starts that the UI still disables.

## Acceptance Criteria

The feature is complete when:

- a single human can start a match against a fallback bot
- the fallback bot appears on the empty team and participates in snapshots
- the bot rotates toward enemies and fires a pistol with imperfect timing
- a human joining the bot team removes the bot cleanly
- the bot never blocks a human from joining
- the existing protocol remains compatible
- server and client tests pass
