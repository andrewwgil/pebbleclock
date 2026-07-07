# Pebble Clock

An interactive, photoreal-ish 3D floating pebble clock built with Three.js — a
satin champagne pebble with a recessed burnt-orange dial, cream hands, and a
live sweeping second hand.

## Run it

Any static file server works (ES modules require http://, not file://):

```sh
python3 -m http.server 5173
# then open http://localhost:5173
```

## Controls

- **Drag** — spin the pebble (with inertia after release)
- **Scroll / pinch** — zoom

## How it's made

- No build step: `index.html` + `main.js`, Three.js loaded from a CDN import map.
- The pebble is sculpted procedurally from a 256-segment sphere: an organic
  outline via low-order sine harmonics, a tanh depth-flatten for river-stone
  plumpness, a smoothstep crater recessed into the front for the dial, and
  subtle surface noise.
- Realism comes from image-based lighting (`RoomEnvironment` + PMREM),
  `MeshPhysicalMaterial` with a procedural bump/roughness noise texture,
  ACES filmic tone mapping, and a soft radial-gradient contact shadow that
  breathes with the idle float animation.
- Hands are driven from the real system time every frame (smooth sweep).
