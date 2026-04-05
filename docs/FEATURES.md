# Planned Features

## 1. Improved Spray Pattern
- First shot is dead-center when standing still and weapon has fully recovered
- All recoil climbs UP first, then drifts left/right (never random)
- Crouching increases recovery speed (crosshair settles faster)
- Strafing (A/D) increases recoil climb and spread
- Stopping between shots rewards accuracy (pattern resets when heat reaches zero)
- Machine gun: strong upward climb for first 8 shots, then horizontal weave
- Pistol: consistent upward kick with slight lateral drift per shot
- Server-side: first-shot accuracy bonus when stationary with zero bloom

## 2. Bullet Tracers
- Visible bright tracer lines from muzzle to impact point
- Tracers travel from start to end over ~80-120ms with a fading tail
- Visible for both local player and remote players
- Only for gun weapons (not knife/utility)
- Max 32 active tracers for performance

## 3. Muzzle Flash with Dynamic Lighting
- Existing emissive flash box enhanced with a Three.js PointLight
- Brief warm-white light burst (~60ms) that illuminates nearby walls and players
- Local player: light attached to weapon group, positioned at barrel tip
- Remote players: temporary light at their gun position (within 20 units only)

## 4. Dynamic Sound System
- **Gunshots**: Synthesized per-weapon audio (Web Audio API oscillator + noise + filters)
  - Machine gun: short sharp burst, higher frequency
  - Pistol: punchier, lower frequency, slightly longer
- **Spatial audio**: Remote gunshots use HRTF panning based on distance and direction
- **Footsteps**: Filtered noise bursts triggered every ~2.5 units of horizontal movement
  - Audible for both local and remote players with distance falloff
- **Hit sounds (COD-style)**:
  - Body hit: short metallic tick/click (non-spatial, constant volume)
  - Headshot: deeper thunk + high ding layered (distinctly different)
- **Impact sounds**: Bullet hitting surfaces

## 5. COD-Style Hit Markers
- X-shaped overlay centered on screen on hit confirmation
- Body hit: white X, scale pop animation, fades over 200ms
- Headshot: red X, larger, with shake animation, fades over 300ms
- Combined with existing crosshair-turns-red behavior
- Paired with distinct audio feedback from the sound system
