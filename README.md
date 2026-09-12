# Hollow Pass

A night drive over a cold mountain pass. County Route 9: a 9.9 km loop of dark, icy road through old-growth forest, a rock canyon, a frozen lake, exposed alpine flats and a burnt forest, with a gorge bridge, a tunnel with dying sodium lights, an abandoned gas station, a cemetery and a summit overlook under the aurora. Other traffic works the road at night: oncoming cars, slow pickups to overtake, a snowplough. Things stand by the road. They are not there when you get close. Some of them follow.

Play it: https://reidwcoleman.github.io/hollow-pass/

Everything is generated in code: terrain, road, trees, the car, every texture, the sky, and every sound. There are no asset files.

## Run

```
npm install
npm run dev        # http://localhost:5190
npm run build      # static bundle in dist/
```

## Controls

| Key | Action |
| --- | --- |
| W / ↑, S / ↓ | throttle / brake (hold brake at a stop to reverse) |
| A / D, ← / → | steer |
| Space | handbrake |
| V | camera: chase → hood → cinematic |
| H | headlights |
| R | recover to the road |
| M | mute |

Touch: left/right half of the screen steers, top 70% accelerates, bottom brakes.

## How it is built

- `src/road.js` – closed Catmull-Rom loop, heights smoothed and grade-limited to 9.5 %, spatial hash for nearest-sample queries.
- `src/terrain.js` – ridged-noise mountains, the road cut with a plough bank, chunked meshes (2.5 m spacing near the road) with skirts; snow/rock PBR blend in a patched `MeshStandardMaterial`.
- `src/world.js` – plans the loop (bridge and tunnel are detected from road/terrain mismatch), instanced forest, guardrails, pooled point lights for fixtures, snowfall lit by the headlights, valley cloud decks.
- `src/setpieces.js` – Widow's Bridge, Mercy Tunnel, Last Chance Gas, Hallow Chapel, the overlook, the radio mast.
- `src/car.js` – the 4x4 (lofted body, clear-coat paint, glass, real spotlights with shadow maps, volumetric beams, per-wheel suspension) and its physics.
- `src/collision.js` – obstacle field: every tree, rock, post, sign, building and vehicle is solid; the car is pushed out and loses speed.
- `src/traffic.js` – oncoming and same-direction vehicles with headlight glare, the plough, ghosts and the follower.
- `src/particles.js` – snow spray from the wheels, exhaust vapour.
- `src/events.js` – sections, scares (tunnel figure, bridge jumper, engine stall, the tall one in the canyon, whiteout, the lantern on the ice, the follower, vanishing oncoming cars, handprints, the radio voice), mood (fog, aurora, dread, heartbeat, static).
- `src/audio.js` – synthesized engine, wind, tyres, drone, bell, stings.
- `src/postfx.js` – HDR bloom, grade, vignette, grain, chromatic aberration, SMAA.

## Debugging

`tools/shot.mjs name "js" ...` drives a headless Chrome through the game and screenshots it; `tools/eval.mjs "js"` evaluates an expression. In the page, `__teleport(s)`, `__drive(frames, throttle, steer)`, `__pump(frames)`, `__cam(x,y,z,lx,ly,lz)` and `__auto(frames)` (autopilot) and `window.__game` are available.
