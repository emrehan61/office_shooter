# Fallback Bot Movement And Accuracy Tuning Design

**Date:** 2026-04-04

## Goal

Make the existing fallback bot less static and less accurate by giving it simple pursuit/strafe movement and a deterministic low-accuracy shooting rule where only about 20% of shot opportunities receive a near-target aim solution.

## Current State

The current fallback bot in [server/main.go](/Users/emrehanhosver/Desktop/projects/office_shooter/server/main.go):

- stands at its spawn point
- rotates toward the nearest enemy
- fires pistol shots on a fixed cooldown
- uses normal shot spread, which can still feel too accurate at close range

This makes the bot look stationary and occasionally laser-like.

## Scope

Included:

- server-side X/Z movement for the fallback bot
- pursuit behavior when far from the nearest enemy
- strafing behavior when close to the nearest enemy
- deterministic aim-quality gating so only 20% of shots are "good" shots
- automated server tests for movement and low-accuracy shot selection

Excluded:

- pathfinding
- obstacle avoidance
- client protocol changes
- multiple bot archetypes or difficulty levels

## Design

### Movement Model

Keep movement server-authoritative and simple.

Each active tick:

1. find the nearest living enemy
2. compute horizontal direction to that enemy
3. if the enemy is outside a preferred combat range, move toward them
4. if the enemy is inside the preferred combat range, strafe sideways instead of stopping

Movement details:

- motion only changes X/Z coordinates
- Y remains at standing eye height
- the bot records position history after movement so hitscan and lag-comp continue to work
- movement is clamped inside `projectileBounds - 1.0` on X and Z so the bot cannot drift outside the arena
- strafe direction should flip periodically or when the bot hits the edge bound

### Accuracy Model

Do not try to measure literal long-run hit rate against live players. Make the firing decision deterministic and testable instead.

On each shot opportunity:

- classify the shot as a "good shot" or a "bad shot"
- only 1 out of every 5 shot opportunities should be a good shot
- use a deterministic counter or seed-based selector so tests can verify the exact 1-in-5 pattern
- good shots use the existing pistol spread with at most a small extra error
- bad shots apply a much larger lateral/vertical aim offset before spread so they usually miss

This gives an explicit 20% good-shot chance while keeping behavior deterministic under tests.

### Combat Behavior

Keep the existing fallback bot combat loop and pistol-only loadout.

Order of operations per eligible bot tick:

1. move the bot first
2. update yaw/pitch toward the target
3. if the bot is ready to fire, determine good-shot vs bad-shot aim
4. emit the normal `shot` broadcast
5. resolve hits with the existing server damage flow

### File Changes

### Modify

- [server/main.go](/Users/emrehanhosver/Desktop/projects/office_shooter/server/main.go)

Primary responsibilities:

- add bot movement helpers
- add deterministic good-shot selection and bad-shot aim offsets
- update the bot tick loop to move before firing

### Modify

- [server/main_test.go](/Users/emrehanhosver/Desktop/projects/office_shooter/server/main_test.go)

Primary responsibilities:

- verify the bot moves toward enemies
- verify close-range bot behavior changes X/Z position instead of camping
- verify only one of five deterministic shot opportunities is classified as a good shot

## Risks

### Visual jitter

If movement flips direction too often, the bot may jitter instead of looking intentional.

### Overly weak bot

If bad-shot error is too large, the bot becomes harmless. The implementation should degrade aim heavily, but not make all bad shots mathematically impossible.

### History drift

If movement updates position without recording history, shot origin and hit detection can desync.

## Acceptance Criteria

The tuning is complete when:

- the fallback bot no longer stands still while an enemy is alive
- it pushes toward distant enemies and strafes near close ones
- only about 20% of deterministic shot opportunities are good-shot attempts
- server tests covering movement and shot-quality gating pass
