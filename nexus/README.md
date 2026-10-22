# Project Nexus

A browser game engine for the arcade, built 2026-10-21/22 in one marathon
session. Vision: high-end first — smooth (non-blocky) 3D, real physics,
one engine under every future 3D arcade game. Reference architecture:
Unreal Engine, translated to the web.

## Layout

- `core/engine.js` — renderer (Three r170, ACES, soft shadows), fixed
  60 Hz simulation loop decoupled from rendering, post chain (bloom),
  and the quality governor (sheds render scale, never simulation time).
- `core/input.js` — keyboard/mouse/touch state behind named actions
  (axis, buttons), incl. a left-thumb stick + right-thumb look on touch.
- `world/environment.js` — deterministic island heightfield (one function
  feeds both the mesh and the physics collider), gradient sky dome with
  sun disc, day/night keyframes, water, clouds, stars, instanced scatter.
- `world/physics.js` — Rapier (WASM): terrain trimesh, character
  controller (autostep, snap-to-ground, slope limits), dynamic props.
- `game/character.js` — the Character: skeletal GLB + idle/walk/run
  animation state machine, velocity-smoothed movement, coyote time and
  jump buffering, third-person follow camera (orbit + zoom).
- `game/sandbox.js` — Sandbox Of Nexus, the proving-ground game: spawn
  toys (crate/ball/barrel/plank/tower/bomb), rain, explosion impulses.
- `services/net.js` — multiplayer: Supabase Realtime presence +
  8 Hz position broadcast, skeleton-cloned ghosts with name tags and
  per-peer tints, silent solo fallback.
- `services/audio.js` — all-synthesized WebAudio: wind, rain, footsteps,
  jump/land, spawn pops, explosions. No audio assets.
- `vendor/` — pinned dependencies (three 0.170 module + the addon
  closure actually used, rapier3d-compat 0.14, all vendored: the site
  must work without a CDN).
- `assets/models/Soldier.glb` — the character (three.js example model,
  Idle/Walk/Run clips, authored facing −Z: the engine adds π).

## Making a new game on Nexus

1. Copy `games/sandbox-of-nexus.html` as your page shell; keep the
   import map (`three`, `three/addons/`, `rapier` → `nexus/vendor/`).
2. In your boot module: create `Engine`, `Environment` (or your own
   world), `Physics`, a `Character`, and register systems with
   `engine.addSystem({ step, render })`. Simulation code goes in
   `step(dt)` (always 1/60), visuals in `render(alpha, frameDt)`.
3. Budgets (from the master plan): ≤200 draw calls in view, ≤1.5M
   triangles, 60 fps on a high-end laptop at 1440p. The perf HUD
   (`engine.frame`) shows draws/tris/sim ms live.
4. Multiplayer: instantiate `services/net.js` with your own channel
   name and a state getter; ghosts are free.

## Known v1 limits

- Physics runs on the main thread (a worker move is planned at scale).
- No render interpolation yet; the 60 Hz sim reads directly.
- Ghosts are visual only (no collision with remote players).
- Netlify serves the arcade only when its build credits reset
  (2026-11-19); until then the live mirror is surge.sh.
