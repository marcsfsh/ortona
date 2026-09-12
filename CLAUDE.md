# Ortona

A single-file, real-time tactical battle game set in Ortona, December 1943:
1st Canadian Infantry Division against 1. Fallschirmjäger-Division. Custom
WebGL2 renderer, no engine, no dependencies, no build step.

**The whole game is `ortona.html`.** Roughly 7,800 lines: CSS in one `<style>`,
markup, then all the JavaScript in one `<script>`. Open the file in a browser
and it runs.

---

## Hard rules

1. **One file, no build.** Never add a bundler, a framework, a package import,
   a CDN `<script>`, a web font, or a second source file the game loads at
   runtime. `ortona.html` must keep working from a bare `file://` URL with the
   network off. Everything in `tools/` and `package.json` is development
   scaffolding; the game never references it.
2. **It has to run on an iPhone 14 Pro Max.** It currently does. Every change
   gets checked at phone size before it is called done (see Verifying below).
3. **Match the surrounding style.** The game is deliberate ES5: `var`, function
   declarations, no arrow functions, no `let`/`const`, no template literals, no
   classes, no `async`. Two-space indent, semicolons, single-quoted strings.
   Comments are lowercase prose that explain intent, often as
   `/* ---- section name ---- */` banners. Do not modernise code you are
   passing through.
4. **Do not reformat.** No whole-file prettier runs, no reindenting, no
   re-wrapping. A diff should only show what actually changed.
5. **Assets are procedural.** Models are built from boxes, cylinders, lathes
   and prisms in code. Textures are painted into a canvas atlas at boot. There
   are no image, audio or model files, and there must not be.

---

## Verifying

The game renders through WebGL2, so a change to geometry, shading, terrain or
layout cannot be reviewed by reading the diff. Look at it.

Headless Chromium with software WebGL (SwiftShader) is installed and wired up.

```sh
npm install                  # once; Chromium is already on disk

npm run verify               # lint + smoke test, the gate before calling work done
node tools/dims.mjs          # proportion against published dimensions
node tools/duel.mjs          # balance: who beats whom, and how often
node tools/skirmish.mjs      # tactics: this AI against the one in the last commit
node tools/audio.mjs         # sound: renders every effect to WAV, with the numbers
node tools/shoot.mjs --list  # what can be photographed
node tools/shoot.mjs         # the default scene set, desktop
```

A `SessionStart` hook (`.claude/hooks/session-start.sh`) runs `npm install` and
confirms Chromium is present, so a fresh session is ready without being asked.

### `tools/dims.mjs` - proportion, mechanically

Measures every vehicle against its published dimensions and prints model versus
real in metres with the error. Proportion is the one thing about a model that is
a fact rather than a judgement, so it gets checked rather than eyeballed.

```sh
node tools/dims.mjs              # every vehicle
node tools/dims.mjs ger_kt       # one
node tools/dims.mjs --tol=3      # tighten the tolerance to 3 per cent
```

It reports two tables. **Envelope** is hull length, length with the gun forward,
width over the tracks and height. **Internals** is the superstructure width at
the sponson, the hull roof width, and the ground clearance.

Internals matter as much as the envelope, and that is the whole reason the tool
exists: a Tiger II whose bounding box was right to one per cent still looked
wrong because the hull was a tenth too narrow for the tracks it stood on. The
eye reads the body against the track, not against a tape measure. Check both.

Ground clearance is read from a `belly` field on the model rather than measured,
because no geometric filter reliably separates a hull floor from the track
running under it: on every one of these the track's inboard edge lies inside the
hull's own width. Declare it when you add a vehicle.

### `tools/duel.mjs` - balance, mechanically

Stages matchups on clean flat ground and fights them, then prints how often each
side won, how long it took and what the winner had left.

```sh
node tools/duel.mjs                      # the standard card
node tools/duel.mjs --n=24               # more repeats, tighter numbers
node tools/duel.mjs us_rifle ger_gren    # one matchup
node tools/duel.mjs --d=200              # at a chosen opening range
node tools/duel.mjs --cover=3            # with both sides in heavy cover
```

Stats on paper do not tell you who wins. Damage per volley interacts with how
many men are left to fire it, suppression feeds back into accuracy and rate of
fire, penetration interacts with facing and range, and the whole thing compounds:
a side that gets a little ahead gets further ahead. A vehicle duel amplifies a
ten per cent edge into an eighty per cent win rate, because the loser starts
collecting track and gun hits. So a stat change has to be fought rather than
reasoned about, and `us_eng vs ger_pio` is on the card as the calibration row:
those two are identical, so anything other than about fifty per cent means the
tool has developed a bias and not the roster.

Nothing in it is a reimplementation. It calls `updateUnit`, `fireAt` and
`computeVisibility` exactly as the frame loop does, with the economy, the AI and
reinforcement left out, so it cannot drift away from the game. A third entry on a
card row fits field upgrades before the fight, because half of what a vehicle can
do is an upgrade.

### `tools/audio.mjs` - sound, mechanically

Every noise the game makes is synthesised at runtime, so a change to the sound can no
more be reviewed by reading the diff than a change to a model can. This renders the
game's own `sfx()` through an `OfflineAudioContext`, writes WAVs to `shots/audio/`, and
prints what a sound actually is.

```sh
node tools/audio.mjs                 every sound, a montage, and a firefight
node tools/audio.mjs rifle mg        two of them
node tools/audio.mjs --tag=before    keep a set to compare against
```

Nothing is reimplemented: the page's own `auAttach()` builds the graph on the offline
context and the page's own `sfx()` fills it, so what lands on disk is what a player
hears, sample for sample.

Two columns matter more than the rest. **Crest** is peak over rms: a crack is a high
number and a hiss is a low one. And the **first 50ms** band split is where the character
of a report lives, because a whole-buffer spectrum is dominated by whatever rings longest,
which is always the bottom end. Measuring band *power* out of a transform rather than the
magnitude at a few single frequencies is not a detail: the cheap way compares a sine,
whose energy sits in one bin, against noise, which is spread over thousands, and reports
any sound with a thump in it as ninety-nine per cent bass with no crack at all.

The firefight is the one to listen to. A company a side is put down two hundred units
apart in the middle of the town and left to it, every sound the game really plays is
written down with where it happened, and the busiest twenty seconds are handed back to
one offline context -- one room, one compressor, one set of rate limits -- so what comes
out is a mix rather than a row of samples laid side by side.

### `tools/skirmish.mjs` - tactics, mechanically

Puts an AI on both sides of the shipped map and lets them fight. One side runs the
`aiTick` in the working file; the other runs the one out of a git revision, extracted
and injected at runtime. Sides alternate between matches.

```sh
node tools/skirmish.mjs                  # four mirror pairs against the last commit
node tools/skirmish.mjs --self           # the working AI on both sides (calibration)
node tools/skirmish.mjs --base=HEAD~3    # fight an older revision
node tools/skirmish.mjs --n=6 --t=420    # more pairs, longer matches
node tools/skirmish.mjs --diff=2         # at veteran settings
```

An AI cannot be reviewed by reading it, for the same reason a model cannot: whether one
set of decisions beats another is a question about a whole battle, and the only honest
way to read a change is to fight the old version.

Two things about the numbers are worth knowing before trusting them. **Ortona is not a
symmetric map** and the two rosters are not the same army: with the same brain on both
sides the Canadians take thirteen points of ground to the Germans' four. That is why a
run is made of mirror pairs, each match played twice with the brains swapped, and why
`--self` is the calibration. And **a battle here compounds** -- whoever wins the first
serious clash tends to walk the rest of the map -- so a single match is nearly a coin
toss weighted by a small edge. The score is averaged over the whole match rather than
read off the final whistle, and even so a six-pair run moves by a couple of hundred
points between runs. Read the shape of the table, not the last digit.

The columns after the score are the tactical picture, and they are what a change to
tactics actually moves: ground held, army left alive, how concentrated the sections are,
how much of the infantry is behind something, how many sections are holding houses, how
far it has pushed, how many different targets the sections that are firing have picked,
and how much money it is sitting on. A win rate says which brain is better; those say
why.

### `tools/lint.mjs` - the rules, mechanically

Checks what a screenshot cannot: that the script still parses, that the file is
still self-contained (no external `<script src>`, stylesheet, image, `fetch`,
`import` or remote URL), that the code is still ES5 (no arrow functions,
`let`/`const`, template literals, classes, spread, optional chaining), that
indentation is spaces with no trailing whitespace, and that the file stays
under 900 kB. Takes under a second. Exits non-zero on any violation.

```sh
node tools/lint.mjs
```

### `tools/check.mjs` - the runtime gate

Boots the game, deploys, simulates a battle, and asserts: WebGL comes up,
shadows are on, nothing throws, the economy and victory points move, both
sides survive, the HUD stays inside the viewport, touch targets are at least
44px, the tactical map opens, and the map editor loads. Exits non-zero on any
failure.

```sh
node tools/check.mjs                  # desktop + phone, 180s of battle
node tools/check.mjs --device=phone   # one device
node tools/check.mjs --sim=1200       # long battle, watches for late throws
node tools/check.mjs --shots          # also leave PNGs in shots/check/
```

Run this before calling any change done. It takes about 20 seconds per device.
`npm run verify` runs the linter and this together.

### `tools/shoot.mjs` - looking at it

Writes PNGs to `shots/<device>/`. Read them back with the Read tool and judge
the result; that is the point of the tool.

```sh
node tools/shoot.mjs start battle hud closeup terrain editor   # the defaults
node tools/shoot.mjs battle --sim=120        # let the fight develop first
node tools/shoot.mjs hud --device=phone      # mobile layout
node tools/shoot.mjs armour                  # every vehicle, one photo each
node tools/shoot.mjs infantry --turn         # every squad, four angles each
node tools/shoot.mjs buildings
node tools/shoot.mjs lineup                  # whole roster in a row, per side
node tools/shoot.mjs free --cam=1400,950,600,1.57,0.8 --bare --sim=60
```

Scenes: `start` `battle` `hud` `closeup` `terrain` `editor` `over`
`infantry` `armour` `models` `lineup` `buildings` `free`.

Devices: `desktop` (1600x900) `laptop` (1280x800) `wide` (1920x1080)
`veh` (900x620, for the tight edit-render-look loop on a model)
`phone` (iPhone 14 Pro Max, dpr 3) `phonefast` (same box at dpr 1, ~9x fewer
pixels, for layout-only checks) `phoneland` `phonemin` (375x667) `tablet`.

Useful flags: `--sim=<game seconds>` `--side=us|ger` `--diff=0|1|2`
`--bare` (hide all 2D UI, leaving only the 3D) `--turn` (four yaw angles)
`--dist=` `--pitch=` (override gallery framing) `--nofog` `--tag=<suffix>`
`--settle=<frames>` `--cam=x,y,dist,yaw,pitch`.

**Workflow for a visual change:** shoot the relevant scene, edit, shoot again
with `--tag=after`, and compare the two PNGs side by side.

### `tools/harness.mjs` - the library

Both CLIs sit on this. Import it for anything the scenes do not cover.

```js
import { launch, openGame, deploy, fastForward, frames, camera, pose, flatSpot,
         chrome, setFog, reveal, drawable, unlockCamera, lookAt, shoot, turntable,
         state, catalog } from './tools/harness.mjs';
```

Four pieces are worth knowing about because they are not obvious:

- **`fastForward(page, seconds)`** advances the simulation without drawing.
  SwiftShader needs about a second per frame, so waiting in real time for a
  battle to develop is hopeless. Instead it calls the game's own `frame()` with
  a virtual clock while `render()` and `requestAnimationFrame()` are stubbed
  out, then restores them and repairs `last` and `perf`. It reaches roughly
  400x realtime. Because it drives the real `frame()` rather than a copy of it,
  it does not rot when the loop changes.
- **`setFog(page, false)`** pushes the fog texture immediately rather than waiting
  for `render()` to refresh it, which it only does every third frame. Without
  that, a screenshot taken two frames after clearing the fog still shows the old
  fog and the map looks black.
- **`reveal(page)`** forces `vUs`/`vGer` true on every unit and building.
  `render()` only draws what the player's side can see, so a posed model with
  no friendly units nearby is invisible. Every gallery scene calls it. A
  gallery shot that comes back empty is almost always this. `drawable(page)`
  reports `{units, blds, total}` that `render()` would actually draw, which is
  the quick way to tell a bad model from an invisible one.
- **`frames(page, n)`** waits for n real animation frames. A screenshot
  captures whatever the compositor last painted, so every camera or state
  change needs at least one frame before the picture reflects it. `shoot()`
  does this for you through its `settle` option.

`unlockCamera()` relaxes `CAMLIM` so model shots can get closer and lower than
a player ever can. Never use it for a capture meant to represent what a player
actually sees.

Nothing in `tools/` is injected into `ortona.html` on disk. Every hook is
installed at runtime through `page.evaluate`, so the shipped file stays free of
test-only code. Keep it that way.

---

## Architecture

The `<script>` declares its own section order at the top: util, data, world,
pathing, units, combat, economy, ai, input, render, hud, loop. Section banners
(`/* ---- name ---- */`) mark the boundaries. Search for a function name rather
than trusting a line number.

**State.** One global `G` holds everything mutable: `units`, `blds`, `shots`,
`fx`, `wrecks`, `corpses`, `sectors`, `res`, `sel`, `sites`, `mapData`. There
is no state container and no immutability; systems mutate `G` directly.

**World.** 2800 x 1900 units. `makeSectors` / `buildMap` / `makeTerrain` build
it from `G.mapData`, which is plain JSON the map editor also reads and writes
(`defaultMapData()` is the shipped Ortona map). A separate 4-unit heightfield
(`makeHeight`, `groundZ`, `groundNormal`) carries elevation, with trenches and
craters cut in by `carve`.

**Movement.** A 40-unit occupancy grid (`grid`, `rebuildGrid`, `walkable`) with
A* in `findPath`. Squads are several models moving in formation around one unit
position; `updateModels` animates the individual soldiers.

**Combat.** `computeVisibility` fills `vUs`/`vGer` and drives both fog of war
and target acquisition. `COVER` entries are graded open / light / medium /
heavy / dug-in; linear cover (walls, trenches) only protects across its face,
which is what `coverValue` computes from the firing angle. `chooseCover` and
`coverSlots` are why soldiers tuck themselves against walls.

**Renderer.** Hand-written WebGL2. One vertex/fragment program for lit
geometry, plus sky, depth and billboard programs. A 2048px shadow map from a
sun matrix. A procedurally painted 16-tile texture atlas (`buildAtlas`). The
static world is merged into a handful of big buffers by `buildScene`; units and
vehicles are per-model draws. Fog of war and battle damage are textures the
ground shader multiplies in. A second 2D canvas (`#ov`) carries everything flat:
selection rings, health bars, unit labels, the minimap.

**Models.** `soldierModel` and `proneModel` build infantry from limb segments,
helmets and weapons. Vehicles get individual builders (`shermanHull`,
`ktTurret`, `pzivSkirts`, and so on) assembled in `buildVehicleModels`. Every
face carries a material index into the atlas. If a model looks wrong, the fix
is in one of these builders, not in a mesh file.

**AI.** `aiTick` runs on a difficulty-dependent cadence (`DIFF[].tick`) and holds its
plan in `AI`, whose fields are all numbers or sector ids so nothing in it can outlive
what it pointed at. Per-unit intent lives on the unit (`u.job`, `u.jobSec`, `u.jobX/Y`,
`u.aimX/Y`). Each tick it classifies what it has into five lists (the same unit is a
different thing to the motor pool, the population cap and the capture allocation),
produces, buys field upgrades, builds, scores every sector into an objective list with a
weight of sections each is worth, deals the sections that can actually capture out to
those objectives nearest-first, and then issues one order per unit by job: `take`,
`raze`, `screen`, `support`, `defend` or `mend`. `DIFF[].skill` gates the tactics rather
than the arithmetic: 0 keeps green simple, 1 adds houses, upgrades and repair, 2 adds the
flanking approach.

Two things about it are counter-intuitive enough to be worth knowing before touching it.

**The shopping list is a ratchet.** `LADDER` is climbed against `madeOf` -- what the side
has ever ordered -- and not against what is alive, because a live count walks backwards
under fire: every armoured car that burned reopened the first line of the list, so a side
actually being fought bought twenty-two of them over twenty minutes and never saved the
fuel a tank costs. Losses are replaced in a second pass over the same list ordered by
`vehWorth`, dearest first, so the empty Tiger slot outranks a third medium and nothing
cheap is bought with fuel a heavier empty slot is waiting on.

**It attacks in waves.** A defended objective is not taken by sections arriving one at a
time, which is exactly what dealing them out nearest-first produces. So the units sent at
it gather at a forming-up point short of it (`aiFirePost` for a sector, `aiFormPost` for
a building, which steps back along the line to its own base because the enemy's bearing
is undefined when you are standing on his headquarters) and go in together, armour
included; `DIFF[].wave` is how many it gathers, `form` how long it will wait for them and
`press` how long the wave runs before the next one forms. Green gathers six and waits a
hundred seconds, which is what makes it a defensive game rather than a stream of targets.
In annihilation the wave objective is a building rather than a sector: a third of the
sections (one to three) are posted on ground to keep the money coming in, everything else
is in the wave, the gun teams set up at the forming-up point rather than short of the
building they would otherwise walk to alone, and the wave will not go in under half
strength, because a building does not fall to one section. While a wave is pressing, its
units ignore targets they have no fire line to: an attack order only closes to weapon
range, so a section that stops for something behind a wall stops for good.

**Audio.** Synthesised, like everything else: `auAttach` builds one bus on a context --
a procedural room (a convolver over a generated impulse), a band limit at 6kHz, a little
saturation and a compressor -- and `sfx` builds each sound out of layers on top of it
(`auHiss` for noise, `auTone` for pitch). A report is a crack, a body and a thump, in
that order of arrival, and each layer is jittered so no two shots are the same. `sfx`
also pans and attenuates from where the sound happened relative to the view, and `AUGAP`
limits how close together two of the same sound may be, because massed fire stacked
without one turns into a rattle. `auInit` makes the real context; `tools/audio.mjs` hands
`auAttach` an offline one.

**Loop.** A single `frame(now)` in the last section steps every system with one
`dt` (clamped to 50ms) and then calls `render()`. There is no fixed timestep
and no separate update thread.

**Field works.** `WORKS` is what a section of engineers can put up during a battle:
sandbag wall, weapon pit, wire. Placement is `placeWork`, which pegs a site out on a
bearing; `finishWork` turns a finished site into a `G.works` entry, a piece of cover laid
on that bearing, and for wire a mark on a grid that holds infantry up. The scene buffer
is built once before the first shot and cannot take anything raised after it, so each
work builds its own little buffer in world coordinates (`workFaces`, `conformFaces`) and
is drawn per piece. The player aims one by pressing where it goes and dragging toward the
enemy; the bearing matters because `coverValue` strips two grades off fire that comes in
along the line of a parapet rather than across it.

**Map editor.** A second mode living under `ED`, sharing the renderer. Opens
from the title screen, edits `G.mapData`, saves to `localStorage`, imports and
exports JSON.

---

## Mobile

`MOB` is decided once at load from `matchMedia('(pointer: coarse)')` or a
viewport under 820px, and switches to a compact HUD: a condensed resource
strip, a bottom command bar, right-edge tool buttons, a corner minimap.

What to watch when touching layout or input:

- The CSS uses `100dvh` and `env(safe-area-inset-*)`. Do not swap those for
  `100vh` or fixed padding; the notch and home indicator need them.
- Touch handling lives in the `touch` object and its listeners: tap to select,
  long press for orders, two-finger pinch to zoom, drag to pan. Canvas elements
  set `touch-action: none` on purpose.
- Keep tappable controls at 44px or larger. `tools/check.mjs` asserts this.
- `body` is `overflow: hidden` with `overscroll-behavior: none`. The page must
  never scroll, in either direction. The check asserts this too.
- Particle effects are trimmed on mobile (`if (MOB && G.fx) G.fx.length = 0`),
  and `frame()` halves the draw rate if it measures a struggling device. Do not
  remove those paths without a reason.

---

## Performance

The budget is a phone GPU at 60fps. The renderer is built around keeping draw
calls low: static geometry merged into few buffers, one shared atlas, billboards
for particles. Before adding anything that draws per-frame, check whether it can
be baked into `buildScene` instead.

`dpr` is clamped to 2. The shadow map is 2048px. `FOGDIV` and the decal canvas
resolution are deliberate trade-offs.

Note: frame times reported by `tools/check.mjs` come from SwiftShader, a
software rasteriser with no GPU behind it. They are useful for spotting a
change that makes rendering dramatically more expensive, and useless as an
absolute FPS figure.

---

## Repo layout

```
ortona.html                    the game, and the only thing that ships
CLAUDE.md                      this file
package.json                   dev dependencies and script aliases
tools/harness.mjs              Playwright library: boot, drive, pose, photograph
tools/check.mjs                smoke test, exits non-zero on failure
tools/duel.mjs                 balance card: staged matchups, win rates
tools/skirmish.mjs             tactics card: AI against AI, old brain against new
tools/audio.mjs                sound: renders the game's own synthesis to WAV, with numbers
tools/shoot.mjs                scene-based screenshot CLI
tools/lint.mjs                 one-file / ES5 / hygiene rules
.claude/hooks/session-start.sh installs dev dependencies on session start
shots/                         screenshot output, gitignored
```

---

## Gotchas

- `G.side` is the human player's side. `render()` and the minimap filter on it,
  so anything staged for a screenshot needs `reveal()` or it will not draw.
- `computeVisibility()` recomputes `vUs`/`vGer` from scratch on every tick, so
  setting them by hand only holds while the simulation is paused. That is why
  `reveal()` pauses. A staged model that renders for one frame and then vanishes
  is this.
- `render()` early-returns unless `GLOK && SCENE.ready`. After `startGame()`,
  wait for `SCENE.ready` before expecting a picture.
- `frame()` writes the module-level `last` and samples into `perf`. Anything
  that drives `frame()` with a clock of its own has to put both back, or the
  next real frame computes a nonsense `dt` and the renderer permanently halves
  its draw rate.
- Camera limits (`CAMLIM`) clamp distance to 220-2600 and pitch to 0.42-1.35.
  A request outside that range is silently clamped, not honoured.
- `lathe()` revolves about the **y** axis, so it builds a wheel whose axle points
  across the tank. It is the wrong tool for anything that stands out of a plate
  facing fore or aft: a ball mount built with it faces out of the side of the
  hull. Build those along z and let the plate's transform turn it, or use
  `tubeSmooth`. Three separate bow machine guns had this bug.
- `boltRing()` lays its studs out in the **x-z** plane, which is right for a road
  wheel and wrong for a plate facing forward: use `boltRingX()` there. Getting it
  wrong throws the ring of bolts out past the nose armour, where it quietly adds
  a quarter of a metre to the vehicle's measured length.
- `var` hoists. A hull constant referenced above its own `var` line is
  `undefined`, every vertex built from it is `NaN`, and the part vanishes without
  an error. `tools/dims.mjs` reports NaN when this happens.
- `box()` shades its bevel strips with `lit()` derivatives of the face colours, and
  a derived value is a colour in its own right. `registerMaterials()` maps colours
  to atlas materials, and a colour it does not know falls back to the untextured
  `generic` tile, so a vehicle whose paint comes from a camouflage tile comes out
  hemmed with a bright flat pinstripe along every edge it has. `tagEdges()` exists
  to register those derivatives; call it alongside `tag()` for any new palette.
- Terrain, scene buffers and the atlas are rebuilt only by `startGame()` and
  the editor's rebuild. Editing `G.mapData` alone changes nothing on screen.
- `updateFog()` and the decal upload happen inside `render()`, not every frame.
  Changing `fog` or painting a decal does not show up until a later frame.
- The audio context needs a user gesture in a real browser. `auInit` swallows
  the failure and sets `AU.on = false`, so silence is not necessarily a bug.
- Terrain noise is seeded (`_s = 20240606`), so the map is identical every run.
  Combat uses `Math.random()` and is not reproducible.
