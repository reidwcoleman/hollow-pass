# Hollow Pass

**Now: a first-person Iron Man sortie.** Suit up on the Stark pad by the summit mast and fly the whole valley: hover, thrust along your view, strafe, afterburner, bank into turns, land anywhere, fire repulsors (left click / right click), thread the 16-ring course above the loop, fly through cloud banks, and find every landmark on the visor HUD (horizon ladder, airspeed and altitude tapes, compass, reactor and thrust bars, radar, waypoints). Road traffic keeps driving below you. `car.html` still has the night-drive car game.

Flight keys: mouse look · W/S thrust · A/D strafe · Space lift · C descend · Shift afterburner · click repulsors · R return to pad · M mute.


A night drive over a cold mountain pass. County Route 9: a 9.9 km loop of dark, icy road through old-growth forest, a rock canyon with an abandoned mine, a frozen lake with a black-ice stretch, exposed alpine flats with an avalanche zone and an abandoned convoy, a knife-edge ridge, a dead village, a burnt forest, two gorge bridges, two tunnels, a gas station, a cemetery and a summit overlook under the aurora. Other traffic works the road at night: oncoming cars, slow pickups to overtake, a snowplough. Things stand by the road. They are not there when you get close. Some of them follow.

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
- `src/car.js` – the 4x4 (lofted body, clear-coat paint, glass, real spotlights with shadow maps, volumetric beams, per-wheel suspension) and its physics: torque curve, 6-speed automatic with kick-down, traction-limited launch on snow, aero/rolling drag, engine braking, ABS, bicycle-model yaw with understeer, and a corner assist that eases off and brakes for bends it can see coming.
- `src/collision.js` – obstacle field: every tree, rock, post, sign, building and vehicle is solid; the car is pushed out and loses speed.
- `src/traffic.js` – oncoming and same-direction vehicles with headlight glare, the plough, ghosts and the follower.
- `src/particles.js` – snow spray from the wheels, exhaust vapour.
- `src/mirror.js` – a real rear-view mirror: the world rendered from a camera on the tailgate into a small target and blitted, flipped, into the top of the screen; objects on layer 3 exist only in the mirror.
- `src/events.js` / `src/scares2.js` – sections, scares (tunnel figure, bridge jumper, engine stall, the tall one, whiteout, the lantern on the ice, the follower and the ram, vanishing oncoming cars, the wrong-way driver, the tunnel blackout and the ones on the walkways, the snowman that gets closer, the blink, the sitter on the fallen tree, the blood moon, the phone box, 03:33, the runner, the breathing when you stop, the numbers station, the ore cart, the avalanche, the convoy, cracking ice, handprints, the radio voice; then `src/scares3.js`: the passenger in the mirror, the one standing behind you, the hanged one, scarecrows that turn, the pack, the wreck in the gorge, signs that change on the second lap, the music box, whispers), mood (fog, aurora, dread, heartbeat, static).
- `src/audio.js` – synthesized engine, wind, tyres, drone, bell, stings.
- `src/postfx.js` – HDR bloom, cold film grade (blue shadows, warm highlights, S-curve), vignette, grain, chromatic aberration glitches, SMAA.

## Debugging

`tools/shot.mjs name "js" ...` drives a headless Chrome through the game and screenshots it; `tools/eval.mjs "js"` evaluates an expression. In the page, `__teleport(s)`, `__drive(frames, throttle, steer)`, `__pump(frames)`, `__cam(x,y,z,lx,ly,lz)` and `__auto(frames)` (autopilot) and `window.__game` are available.
