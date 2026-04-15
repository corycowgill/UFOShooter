# UFO Invasion

A browser-based first-person shooter built on [Three.js](https://threejs.org/) r160. Fight off waves of procedural aliens across three hand-crafted Chicago levels with a laser rifle, laser sword, sniper rifle, and plasma rocket launcher.

**Play now:** [ufoshooter.onrender.com](https://ufoshooter.onrender.com)

No build step, no assets pipeline, no framework. Just a single `index.html` and a handful of ES modules. Everything — meshes, materials, audio, VFX — is procedural.

---

## Gameplay

- **Wave-based combat.** Endless escalating waves, each introducing new alien compositions. Clear a wave, breather, next wave.
- **Three levels.** Downtown Chicago, Lincoln Park Zoo, Ravenswood — each with distinct urban layouts, landmarks, lighting, and spawn logic.
- **Six alien types** with unique AI behaviors and procedural animation.
- **Four weapons** with distinct roles: close-range melee, fast-fire rifle, long-range sniper, AoE rocket.
- **Input.** Keyboard + mouse, Xbox controller (Gamepad API), and iOS touch controls.

### Enemies

| Type | Role | Behavior |
| --- | --- | --- |
| **Grunt Alien** | Ranged soldier | Keeps distance, fires green energy bolts |
| **Swarmer** | Melee rush | Small, fast, rushes in packs |
| **Bloater** | Explosive kamikaze | Walks up and detonates, also explodes on death |
| **Stalker** | Stealth striker | Semi-invisible, cloaks until it strikes |
| **Acid Spitter** | Sniper | Extreme range, high-damage acid projectiles |
| **Hover Drone** | Aerial | Floats above, rains energy bolts |

### Weapons

| Weapon | Type | Damage | Fire Rate | Range |
| --- | --- | --- | --- | --- |
| **Laser Rifle** | Hitscan | 10 | 0.15s | 100m |
| **Laser Sword** | Melee arc | 40 | 0.4s | 3.5m |
| **Sniper Laser Rifle** | Hitscan | 75 | 1.0s | 200m |
| **Plasma Rocket** | Projectile AoE | 120 | 1.4s | 150m |

### Controls

**Desktop**
- `WASD` — move
- Mouse — look
- `LMB` — fire
- `1`/`2`/`3`/`4` — swap weapon
- `Shift` — sprint
- `Space` — jump
- `Esc` — pause / release mouse

**Xbox Controller** — left stick move, right stick look, RT fire, LB/RB weapon swap, A jump, B sprint.

**iOS** — virtual joysticks + fire button.

---

## Architecture

Zero dependencies except Three.js loaded via CDN. Everything else is hand-written ES modules in `js/`.

```
index.html                 # shell, CSS, HUD, importmap, bootstrap
js/
├── main.js                # entry, game loop, scene/renderer/composer setup
├── controls.js            # FPS controls (mouse/keyboard/gamepad/touch)
├── player.js              # player state (health, position)
├── weapons.js             # weapon definitions, firing, projectiles, viewmodels
├── aliens.js              # 6 alien procedural models, AI, animation
├── waves.js               # wave composition + spawn scheduling
├── levels.js              # 3 procedural Chicago levels
├── particles.js           # VFX system (beams, impacts, muzzle flashes, explosions,
│                          #   GPU point fields, light pool, shared geometries)
├── vfx.js                 # damage numbers, hit markers, screen effects
├── hud.js                 # holographic HUD renderer
├── audio.js               # procedural Web Audio synth (no audio files)
└── help.js                # bestiary/weapon guide with live 3D previews
```

### Rendering pipeline

1. **Three.js r160** loaded as an ES module via `<script type="importmap">`.
2. **WebGLRenderer** with `ACESFilmicToneMapping`, shadow maps, and `outputColorSpace: SRGBColorSpace`.
3. **EffectComposer** pipeline:
   - `RenderPass` → scene at linear-HDR float (`HalfFloatType` render target)
   - `UnrealBloomPass` — strength `0.9`, radius `0.6`, threshold `0.9`
   - `OutputPass` — final tonemap + sRGB conversion
4. **HDR-driven bloom.** VFX and light sources (laser cores, muzzle flashes, alien eyes, car headlights, neon signs, building windows) use `toneMapped:false` materials with `color.multiplyScalar(intensity)` pushing values past `[0,1]` into real HDR. The bloom pass's luminance threshold gates the halo to only those hot elements — dark interiors stay crisp.

### Procedural everything

- **Levels.** Every building, car, tree, lamp post, traffic light, street prop, and piece of trim is generated from primitive geometries at init time. ~1000+ meshes per level.
- **Aliens.** Each of the six types is built from 40–80 primitive meshes stitched into a group, with per-type materials, eye glow, insignia, armor plating, and animation params.
- **Weapons.** First-person viewmodels built from boxes, cylinders, and glow cones — no imported models.
- **Audio.** Every sound (laser, sword swing, explosion, footstep, alien death, menu drone) is synthesized on demand with `OscillatorNode` + `GainNode` envelopes in `audio.js`.

### Alien animation

A procedural animation layer (`Alien._updateAnimation`) reads horizontal speed off frame-to-frame position deltas and synthesizes a walk-cycle bob, forward/lateral lean toward velocity, idle breathing scale pulse, attack recoil, and hit flinch — all without restructuring the static alien meshes (which were authored as one flat group). Each type has its own parameter set in `ANIM_PARAMS`:

```js
grunt:   { walkRate: 4.0, bobAmp: 0.07, leanFactor: 0.05, ... },
swarmer: { walkRate: 5.0, bobAmp: 0.05, leanFactor: 0.06, ... },
bloater: { walkRate: 2.5, bobAmp: 0.14, leanFactor: 0.03, ... },
...
```

### Performance systems

Several optimization systems support a game where hundreds of meshes and thousands of particles are active simultaneously:

- **Shared geometry cache** (`cGeom`, `sharedPhongMat`, `sharedBasicMat`, `sharedLightMat`) — alien builders allocate 300+ geometries per model but only ~30 unique tuples; level builders create hundreds of identical building blocks. A module-level `Map` memoizes by constructor + args so the second alien spawn is free. Geometries flagged `__shared` so `disposeTree()` skips them across level transitions.
- **GPU point fields** — explosions, sparks, smoke, and damage particles are routed to two `THREE.Points` systems (additive + normal) with pre-allocated `Float32Array` state and a ring-buffer spawn head. One draw call per blending mode regardless of particle count. Zero allocations on spawn.
- **PointLight pool** — Three.js bakes `NUM_POINT_LIGHTS` as a shader `#define`, so adding/removing lights at runtime forces every affected material to recompile (50–200ms stalls). A fixed pool of 6 pre-allocated lights is "borrowed" per effect, repositioned, and released — shader macros stay constant.
- **Static geometry freezing** — after a level is built, world matrices are computed once and `matrixAutoUpdate` is disabled on static props.
- **Bounding-sphere raycast prefilter** — hitscan weapons check distance to each enemy's bounding sphere before running a full raycast against its mesh.
- **HUD dirty tracking** — HUD elements only touch the DOM when their underlying value changes.
- **Shared unit primitives for per-shot VFX** — laser beams, muzzle flashes, sparks, and sword slashes reference shared unit-sized geometries and scale per-instance instead of allocating new geometry per shot.

---

## Running locally

No build step. Just serve the directory.

```bash
git clone <this-repo>
cd UFOShooter
python3 -m http.server 8000
# open http://localhost:8000
```

The only runtime dependency is Three.js, loaded from `unpkg.com` via importmap in `index.html`. An online connection is needed on first load; after that, browser cache handles it.

---

## How this game was built

Every line of code in this repository was written by [Claude Code](https://claude.com/product/claude-code) (Anthropic's CLI agent), driven by an incremental sequence of natural-language prompts in a single long-running session. There is no `package.json`, no bundler, no framework, and no hand-written code — only prompts and commits.

The commit log tells the full story. Below is a reconstruction of the prompts that produced each commit, grouped by phase.

### Phase 1 — Initial build

| Prompt (paraphrased) | Commit |
| --- | --- |
| *"Build a Three.js browser FPS game with wave-based alien combat"* | `fcd6ff0` Add UFO Invasion |
| *"The loading screen hangs — fix it"* | `209acb4` CDN fallback + late DOMContentLoaded |
| *"Fix player damage, brighten lighting, upgrade aliens, let me pick the starting level"* | `e7b0589` |
| *"Add Xbox controller support"* | `0eee01b` Gamepad API |
| *"Add three more enemy types and upgrade the alien graphics"* | `6fc5323` |
| *"The bestiary cards show duplicate canvases — fix it"* | `40bb5e4` |
| *"Give the weapons detailed viewmodels"* | `4013cf3` |
| *"The Downtown Chicago map layout is wrong — make it look like a real city"* | `a7bb5b6` |

### Phase 2 — Visual effects

| Prompt | Commit |
| --- | --- |
| *"Add a comprehensive visual effects system"* | `d2d891d` |
| *"Major scenery upgrade across all three levels"* | `8fb90ae` |
| *"Add type-specific projectiles, ambient alien VFX, and damage degradation"* | `c4c09f1` |
| *"Make the alien models dramatically more detailed"* | `0037991` |
| *"Improve graphics: renderer, lighting, HUD"* | `28d21d5` |
| *"Upgrade the weapon graphics"* | `1e97378` |

### Phase 3 — Performance

| Prompt | Commit |
| --- | --- |
| *"Optimize performance — remove per-frame allocations"* | `fb6ba5f`, `42f24e5` |
| *"Freeze static level geometry and prefilter raycasts"* | `0921849` |
| *"Enhance alien visual detail again"* | `54f9b7c` |
| *"The loading screen is stuck — fix it"* | `28199e9` duplicate const declarations |

### Phase 4 — Polish

| Prompt | Commit |
| --- | --- |
| *"Add iPhone touch controls"* | `14d2e15` |
| *"Add a Plasma Rocket Launcher with AoE explosions"* | `07468b5` |
| *"Improve graphics: softer shadows, better lighting, per-level fog"* | `7308c55` |
| *"Graphics pass 2: fresnel rim-light aliens + additive beam glows"* | `3372461` |
| *"Graphics pass 3: additive explosions, weapon rim light, vignette"* | `f04b1a7` |
| *"Sci-fi UI redesign — holographic HUD, glitch titles, grid backgrounds"* | `5e42434` |
| *"Enrich scenery: cars, buildings, trees, street props"* | `f1e830e` |
| *"Frame rate degrades over time — fix the memory leak"* | `8d0b53a` dispose GPU resources |
| *"Load Three.js as an ES module via importmap"* | `287fefa` |

### Phase 5 — Deep performance passes (lettered phases)

Each "Improve" prompt in this phase triggered a targeted optimization pass. The agent chose the next bottleneck each time.

| Prompt | Phase | Commit |
| --- | --- | --- |
| *"Improve performance"* | A — route transient lights through PointLight pool | `bde3ce8` |
| *"Improve"* | B — shared material + geometry cache in levels.js | `78b6f7b` |
| *"Improve"* | B+ — merge static shared-material meshes per level | `7ddeb88`, `41f4513` |
| *"Improve"* | C — GPU point fields for explosion particles | `14520f4`, `f6d6751` |
| *"Improve"* | D — spatial opaque merge + tighter pixel ratio cap | `3083feb` |
| *"Improve"* | D+ — route vfx burst particles to GPU point fields | `2127f22` |
| *"Improve"* | E — alien damage sparks on point field, dirty-tracked HUD | `84413ed` |
| *"Improve"* | F — share unit primitive geometries across per-shot VFX | `b33c038` |
| *"Improve"* | G — share muzzle flash and sword slash geometries | `3913248` |
| *"Improve"* | H — cache and share alien model geometries across spawns | `326ded3` |

### Phase 6 — Graphics & animation deep pass

| Prompt | Phase | Commit |
| --- | --- | --- |
| *"Improve the detailed graphics of the enemies — look at adding animation"* | I — procedural animation system for aliens | `1c8c758` |
| *"Improve the graphics"* | J — UnrealBloom postprocessing pipeline | `9affd67` |
| *"Improve"* | K — HDR color boost on VFX for dramatic bloom response | `207ddf0` |
| *"Improve details"* | L — HDR glow on alien details for bloom response | `d713f69` |
| *"Improve"* | M — HDR bloom on environment lights and neon signage | `93ed793` |
| *"This error on load — fix"* (screenshot of TDZ error) | Fix swarmer `aGlow` TDZ collision | `f448451` |

### What this demonstrates

- A complete Three.js game — ~15k lines of JavaScript + CSS — can be produced entirely through natural-language prompts without the human author writing a single line of code.
- Short prompts like *"Improve"* work when the agent has enough context to identify the next meaningful bottleneck. The lettered phases A–M were all single-word prompts; the agent picked the target.
- Incremental phases preserve working state — each commit leaves the game runnable, tested, and pushed. Regressions (like the Phase L `aGlow` TDZ bug) get caught and fixed in the next turn with a bug-report prompt.
- The same agent handles high-level product decisions (alien type design, weapon balance, UI direction), architectural decisions (GPU point fields vs. per-mesh particles, importmap vs. bundler, bloom threshold tuning), and mechanical code edits (~300 geometry constructor rewrites via Python regex) within one conversation.

---

## License

MIT. Have fun.
