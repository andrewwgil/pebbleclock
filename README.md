# Pebble Clock

Five interactive 3D clocks built with Three.js, side by side on one stage:

1. **Analog pebble** — satin champagne pebble with a recessed burnt-orange dial, cream hands and a live sweeping second hand.
2. **Digital pebble** — speckled sandstone pebble with a digital readout.
3. **Split-flap clock** — a mechanical flip-style desk clock.
4. **Wall disc** — a minimalist white wall clock.
5. **LED matrix clock** — a red LED dot-matrix display.

## Run it

Any static file server works (ES modules require http://, not file://):

```sh
python3 -m http.server 5173
# then open http://localhost:5173
```

## Controls

- **Drag** — spin a clock (with inertia after release)
- **Click** — focus a clock
- **Scroll / pinch** — zoom

## How it's made

- No build step: `index.html` + `main.js` + `style.css`, Three.js loaded from a CDN import map.
- The pebbles are sculpted procedurally from a high-segment sphere: an organic outline via low-order sine harmonics, a depth flatten for river-stone plumpness, and a recessed crater for the dial.
- Realism comes from image-based lighting (`RoomEnvironment` + PMREM), `MeshPhysicalMaterial` with procedural bump/roughness textures, ACES filmic tone mapping and soft contact shadows.
- Hands and displays are driven from the real system time every frame.
