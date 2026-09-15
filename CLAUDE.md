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

npm run verify               # lint + map check + smoke test, the gate before calling work done
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

**Read the pair difference and nothing else.** Within a pair the same ground is played twice
with the brains swapped, so the sum of the working brain's score in the two halves is what it
beat the baseline by with the map cancelled out. That number comes with the standard error of
it and a sentence saying whether it clears twice that; when it does not, the tool says how many
pairs it would take. The per-side table underneath averages the two halves separately, which
throws the pairing away and is a point estimate with no error bar on it -- and that is how
three runs of the same code came back -140, +287 and -573 and the middle one was read as an
improvement. A single pair swings by most of a thousand points on this map, so a hundred-point
change needs something like a hundred pairs to see, and the honest answer to most tactical
tweaks is that the tool cannot resolve them. Judge those on whether they are right, not on
whether the table moved.

Two more things about the numbers are worth knowing before trusting them. **The two rosters
are not the same army**, and the town is hand-placed rather than mirrored, so even with the
flags now symmetric about the midline a side can have the better of the ground: `--self` is
the calibration and it currently lands within the noise of even. That is why a run is made
of mirror pairs, each match played twice with the brains swapped. And **a battle here
compounds** -- whoever wins the first serious clash tends to walk the rest of the map -- so a
single match is nearly a coin toss weighted by a small edge. With an AI on both sides a match
is over in four to six minutes: the loser of the first clash is down to three flags by the
third minute and its victory points are gone by the fifth, at 0.8 a second per victory flag
the other side holds, so a 600-second match is nearly always cut short and the score carries
the 300-point finish. The score is averaged over the marks a match actually ran rather than
read off the final whistle, and even so a six-pair run moves by a couple of hundred points
between runs. Read the shape of the table, not the last digit.

A cheaper cross-check than the full card is a kill-switch A/B: extract the working `aiTick`,
disable one rule by text replacement, inject it against the last commit, and run six pairs.
Twelve matches give a standard error of about a hundred and ten points a match, which is
enough to see a rule that breaks the brain and not enough to rank two that both work. The
reflexes, the goal changes and the production changes were each tried alone that way and each
landed at parity (+22, +28 and +57 a match), and the full set over twenty-four matches landed
at +22 with a standard error of 81: the pass is neither better nor worse than the brain before
it by anything the tool can see, and every rule in it stands on whether it is right.

The columns after the score are the tactical picture, and they are what a change to
tactics actually moves: ground held, army left alive, how concentrated the sections are,
how much of the infantry is behind something, how many sections are holding houses, how
far it has pushed, how many different targets the sections that are firing have picked,
and how much money it is sitting on. A win rate says which brain is better; those say
why.

### `tools/mapcheck.mjs` - the map, mechanically

A hand-placed map is a few hundred coordinates and the eye will not hold them. Craters
swallow trenches, wire runs through a bowl it should stop at, a house stands on an olive
tree, a lane is drawn as a nice curve straight through a block, and two buildings leave a
slot between them too narrow to walk down and too wide to read as a party wall. None of
it shows in a screenshot taken from the angle you happened to choose, and all of it shows
the moment a section has to walk through it. The first hand-placed draft had a hundred
and sixty-four conflicts in it and looked fine.

```sh
node tools/mapcheck.mjs        # every rule
node tools/mapcheck.mjs --v    # list every conflict rather than the first few
```

The rules are things that cannot be true of real ground: a crater does not sit on a
trench, wire is not laid across a bowl or a parapet, nothing stands inside a building, a
street does not run through one, and two buildings either share a wall or leave room to
walk between them. Plus two about streets -- nothing thread-width, and nothing that runs
the length of the map without a junction. It is in `npm run verify`.

### `tools/lint.mjs` - the rules, mechanically

Checks what a screenshot cannot: that the script still parses, that the file is
still self-contained (no external `<script src>`, stylesheet, image, `fetch`,
`import` or remote URL), that the code is still ES5 (no arrow functions,
`let`/`const`, template literals, classes, spread, optional chaining), that
indentation is spaces with no trailing whitespace, and that the file stays
under 1180 kB (it was 1040 before vehicles carried a hand-laid interior). Takes
under a second. Exits non-zero on any violation.

```sh
node tools/lint.mjs
```

### `tools/check.mjs` - the runtime gate

Boots the game, deploys, simulates a battle, and asserts: WebGL comes up,
shadows are on, nothing throws, the economy and victory points move, both
sides survive, the HUD stays inside the viewport, touch targets are at least
44px, the tactical map opens, and the map editor loads, opens every category's
tray, keeps its controls at 44px and throws nothing. Exits non-zero on any
failure.

```sh
node tools/check.mjs                  # desktop + phone, 180s of battle
node tools/check.mjs --device=phone   # one device
node tools/check.mjs --sim=1200       # long battle, watches for late throws
node tools/check.mjs --shots          # also leave PNGs in shots/check/
```

Run this before calling any change done. It takes about 20 seconds per device.
`npm run verify` runs the linter and this together.

Two things the periscope block has to do to itself: it tops both sides' victory points up
to nine thousand and gives its test tank a hundred thousand hit points. A minute of
simulated battle for the gun and barrel tests on top of the three already fought is long
enough for the game to end, and a game-over screen sits over everything the rest of the
check wants to click; and a tank parked by its own headquarters for a minute of that is a
tank that can be killed, which closes the periscope and takes `POV.u` with it.

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

The grid says where a thing can go; `cellCost` says where it would want to, per
`pathKind`: tracks pay 1.35 off the metalled streets and wheels 1.5, both more on a bank
(`steep`), and men on foot pay 2.6 to cross wire and a little for a bank. A tank sent
across the town used to cut straight over the gardens at two thirds pace with the Corso
fifty units to its left. The smoother prices a shortcut against the path it replaces
(`lineCost`) rather than only asking whether it is clear, or it cut every bend of the
street back off across the gardens; and it samples every nine units, because at eighteen
a line that clipped the corner of a blocked cell passed as clear and the section stood at
that corner for the rest of the battle. Every path carries the `gridStamp` it was found
on and is found again when the grid changes, which it does whenever a building goes up:
retreating sections were found standing against their own side's new motor pool,
sliding along its wall by a hair a frame, because the wall-slide counted as a step. A
step that makes no progress for half a second now counts as blocked (`u.blockT`), and
before a blocked unit asks for a new path it tries the step swung off the line, the way
a man shoulders round a doorway full of the section in front. A retreat scatters its
destination behind the headquarters and finishes when it is held up within a few paces
of it, or a dozen retreating sections arrived into each other and the last stood in the
crush for good.

A man's place in the formation is not taken if it is inside a wall: he closes on the
centre instead, by half if that is clear and all the way if not, and his own steps keep
to the grid like the section's. Before that a section walking down a lane had its flank
files walking through the houses, half a per cent of all man-frames. Halted with nothing
to shoot at, a section turns to face the nearest known threat (`u.threatAng`, the bearing
its cover was chosen against) rather than standing the way it arrived, and a machine gun
is laid on that bearing before it is needed. A halted tank with a turret brings its hull
round to its target as well, slowly, because the front plate is nearly twice the side.

`tools/` has no card for any of this; the probe that measured it drives the working
brain on both sides for four minutes and counts man-frames inside a solid prop, halted
sections facing their threat, and unit-frames with a path and no progress over four
seconds, then prices a tank's and a section's path across the town. Old code is injected
the way `skirmish.mjs` injects a brain. Men in walls went from 0.5 per cent to none and
stuck unit-frames from up to twelve per cent to none, with the retreat crush the last
bucket to go.

**Stances.** `u.stance` is `''`, `'ground'` or `'double'`, set by the player from the
order cards (Z and C) and by the brain for its own men every tick. Gone to ground, a
halted section lies flat: lying in the open counts as light cover, it is a fifth harder
to see, a quarter slower on the trigger and shorter-sighted, and it is worth nothing in
a trench where the ground has done the work already. An MG42 at two hundred kills nearly
a whole rifle section standing in the open in fifteen seconds and a man and a half of
one that has gone to ground. At the double a section runs at 1.4 times its pace, and a
running man is easier to see, easier to hit and half again as easy to pin, so what is
gained on the crossing is paid for if the crossing is under fire. The brain runs its
sections to the forming-up point and at the objective while the ground round them is
quiet and they have no target, and goes to ground where it is when it is caught in the
open with nowhere to go.

**Combat.** `computeVisibility` fills `vUs`/`vGer` and drives both fog of war
and target acquisition. `COVER` entries are graded open / light / medium /
heavy / dug-in; linear cover (walls, trenches) only protects across its face,
which is what `coverValue` computes from the firing angle. `chooseCover` and
`coverSlots` are why soldiers tuck themselves against walls. A burnt-out vehicle
is cover too (`kind: 'wreck'`, heavy for a tank and medium for a car, added by
`killUnit` where it died), because thirty tons of plate in the middle of a street
is the best thing in it to get behind. On desktop the grade of cover under the
pointer is shown beside it while infantry is selected, so the player can see what
a move order would land in before giving it.

**Renderer.** Hand-written WebGL2. One vertex/fragment program for lit
geometry, plus sky, depth and billboard programs. A 2048px shadow map from a
sun matrix. A procedurally painted 16-tile texture atlas (`buildAtlas`). The
static world is merged into tiled buffers by `buildScene` (a grid of prop tiles and
ground tiles, culled to the view); units and vehicles are per-model draws. Fog of war and battle damage are textures the
ground shader multiplies in. A second 2D canvas (`#ov`) carries everything flat:
selection rings, health bars, unit labels, the minimap.

**Models.** `soldierModel` and `proneModel` build infantry from limb segments,
helmets and weapons. Vehicles get individual builders (`shermanHull`,
`ktTurret`, `pzivSkirts`, and so on) assembled in `buildVehicleModels`. Every
face carries a material index into the atlas. If a model looks wrong, the fix
is in one of these builders, not in a mesh file. Two vehicles share a chassis:
`p4Chassis(body, cap, sideC, stug)` is the Panzer IV's running gear, tub, glacis,
deck and tail, and `stugHull` builds the Sturmgeschütz IV casemate on it with the
flag set, which leaves off the fighting-compartment box, the driver's plate and the
guard stowage the casemate overhangs. With the flag off the face list is the Panzer
IV's in the same order.

The StuG's compartment is a `frustum` and not a `prism`: the Ausf. G superstructure the StuG IV
inherited stands out over the track guards at the bottom and slants inboard about eleven
degrees on its way up, so the roof comes out a third of a metre narrower than the base. That
slant is the single thing that most says StuG from the angle a player actually looks from,
and it is why the compartment stopped reading as a box. It also breaks `dims`: a slanted wall
straddles every station between its ends, and `widthAt` gives a straddling face its widest
point, so any roof probe below the roof plate measures the bottom of the wall. `PROBE.ger_stug.roofZ`
sits exactly on the roof for that reason.

The Maus is the one vehicle on the roster with no claim on Ortona at all. It is built
because it was asked for, it is priced like a toy (2200 marks and 700 of fuel, 44 of a
175 population cap, one per army), and it is deliberately **off the AI's shopping
ladder**: a brain saving that much buys nothing else for four minutes, which is the
starvation the money reserve exists to prevent. Only the player may have one.

A vehicle with `arc` on its def is a casemate gun: `acquire` will still pick a target
outside the arc (at a penalty) so the hull has something to turn toward, the halted
hull pivots at about a radian a second to bring it inside, `u.turret` is clamped to
the arc in `updateModels`, and `fireAt` refuses until it is inside. `VMODEL.fixed`
draws the hatches with the hull rather than the mount, and `addUp` meshes are drawn
for every fitted upgrade key, not only the one that swaps the gun.

**AI.** `aiTick` runs on a difficulty-dependent cadence (`DIFF[].tick`) and holds its
plan in `AI`, whose fields are all numbers or sector ids so nothing in it can outlive
what it pointed at. Per-unit intent lives on the unit (`u.job`, `u.jobSec`, `u.jobX/Y`,
`u.aimX/Y`). Each tick it classifies what it has into five lists (the same unit is a
different thing to the motor pool, the population cap and the capture allocation),
produces, buys field upgrades, builds, scores every sector into an objective list with a
weight of sections each is worth, deals the sections that can actually capture out to
those objectives nearest-first, and then issues one order per unit by job: `take`,
`raze`, `screen`, `support`, `defend` or `mend`. `DIFF[].skill` gates the tactics rather
than the arithmetic: 0 keeps green simple, 1 adds houses, upgrades, repair and the per-unit
reflexes below, 2 adds the quiet-side approach and the pincer.

`tools/skirmish.mjs --self` is the calibration for all of it, and the sectors now mirror about
the midline exactly because of it: the first draft of the town had Via Cavour a hundred units
nearer its headquarters than Porta Caldari was to the other, and with the same brain on both
sides the German side took its third flag twenty seconds sooner every game, which on ground that
pays by the second was the whole battle by the fifth minute. A probe that drives the working
brain on both sides and counts how often each rule fires is the way to check a new rule is
reached at all before asking whether it helps: the first version of the duck rule parsed, passed
the gate and never once fired.

**The staff work is allowed the map; the guns are not.** `acquire` checks `vUs`/`vGer` and nothing
shoots what it cannot see, but `aiThreat` reads every enemy in the radius whether it has been seen
or not. That is deliberate and it was measured twice: visible-units-only, and then a decaying
memory of contacts, both made a worse opponent by about a hundred and seventy points a side over
six mirror pairs. Threat is what sizes the effort put against a sector, so ground nobody has eyes
on reads as quiet, is capped at one section and never has a wave formed against it -- the army
stops attacking because it cannot see who it is attacking. If this is revisited, the thing to fix
first is that an unscouted sector reads as undefended rather than as unknown.

**It lays its fire support on before it goes in.** `aiOverwatch` sites a weapon by asking whether
the objective can actually be seen from the post, which `aiFirePost` never did: it took the
heaviest cover near a point stepped back from the objective, and on a town map that is a machine
gun sited behind the very block it is meant to be firing past -- it sets up, reports itself in
position, and fires nothing all battle. A wave will not step off until at least one support weapon
is set up, inside its own range and with a line to the objective (`aiSetUp`), bounded by the same
form timer so a gun that cannot find a post does not stop the battle. Anti-tank guns are sited
differently again: four hundred back rather than a hundred and fifty, on the longest sight line
onto the ground armour has to come up, because a Pak walked forward with the infantry is dead
before a tank arrives.

**A wave shoots at one thing.** Ten sections firing at ten different windows suppress nobody, and
suppression is most of what a wave is for. While a wave presses, `AI.hot` is its target and
anything in the wave that can reach it and see it takes it -- but only when that gunner has
nothing of its own in hand, or when the target is armour. Taking it unconditionally drove the
firing spread down to 0.14 and the men out of cover, because a section that drops the thing
shooting at it to join the concentration is a section standing in the open. Skill 1 and up.

**Ground changing hands is an event.** It is cheapest to take back in the half minute after it is
lost, before whoever took it has dug in or been reinforced. The brain had no memory of ownership,
so a sector that had just fallen was indistinguishable from one that had been enemy-held all
battle. `AI.ctSec`/`AI.ctT` remember it for thirty-six seconds, during which it ignores the mood's
reach limits, is worth three hundred more than anything else and is dealt three sections. The
same idea runs the other way: a sector it has just taken (`AI.momSec`/`AI.momT`) makes the one
beyond it worth more for half a minute, and the next wave forms at once rather than after the
full form timer, so a break-in is followed up while the defence is still moving.

**It reads the score.** `vpLead` is its victory points against the enemy's. Behind on points it
will not sit in `dig` or `hold`, whatever the strength ratio says, because a side that is losing
on points and holds its ground loses on points; a side comfortably ahead that is also stronger
stops spending waves and holds what pays. A thin sector -- enemy held with less than a section's
worth on it -- scores higher, and so does one that would join up what it holds, because ground
only pays while it is connected to the headquarters.

**It shops against what it can see.** `aiIntel` counts the enemy by kind (infantry, machine guns,
anti-tank guns, light, medium and heavy armour, men in houses) and `aiCutLadder` re-cuts the
shopping list against it every tick: two Paks and no armour to answer them puts the light armour
to the back, heavy armour on the field pulls whatever kills it to the front and the mediums that
cannot behind it, an enemy with no armour at all puts the anti-tank gun to the back, and armour
with nothing of ours to answer it brings the gun forward and raises the count on it. The base
order and the ratchet are unchanged; only the cut moves. The infantry follows the same logic in
two numbers: `mgCap` goes up one against an all-infantry enemy and `wantElite` drops the fuel
floor on assault groups when the enemy is sitting in houses or behind two or more machine guns.
On regular and veteran the first three minutes are an opening (`opening`): the army cap is
lifted so sections are raised as fast as the headquarters turns them out and every one of them
goes at the nearest empty flag, because ground taken before anyone is there to contest it is
held for the rest of the battle at no cost.

**The pincer.** At veteran, a wave against a defended objective splits: `AI.flkX/flkY` is a
second forming-up post square off the line of approach, three hundred and eighty out, on
whichever side of the objective `aiThreat` says is quieter, and a third of the sections (never
fewer than three in the wave, so a hook is never one section on its own) are marked `u.flank`
and gather there instead. The armour goes with the hook when `IN.gun` says the enemy has
something that kills armour, because a tank that comes at a gun line from the side comes at it
where the gun is not pointing; otherwise it stays with the main body. The post is dug once per
wave and held for the life of it -- re-dealt every tick, the hook walked up and down behind the
objective and never arrived -- and it is only dug where the far side is actually quiet, because a
hook that walks into a second position is two assaults where there was one. When the wave goes
in, the hook ends on the flag on its own side of it, inside the circle that takes it, so the
defender has two bearings to face.

**The section leader's reflexes.** Four decisions are made per unit, before the plan and from
what the unit can see, at skill 1 and up (`skill >= 1`; green stands in the street and loses men,
which is what green is for):

- *Under fire in the open* a section goes to ground: into an empty house within a hundred and
  twenty (`aiHouse`), behind the nearest real cover within a dash that faces the fire (`aiDuck`,
  which for a wall is the nearest point of the wall and the side away from the fire), or, outside
  a wave, back a hundred and fifty the way it came. The threshold is `u.sup > .4` and low on
  purpose: suppression climbs from nothing to pinned in a few seconds of machine gun fire and
  decays at a fifth a second, so a rule that waited for half suppression found the men already
  pinned or already recovered and fired perhaps once a battle. It still fires rarely, and the
  histogram says why: this combat model shoots sections down to the retreat rule faster than
  it suppresses them, so most of the time a section under fire is retreating, not ducking.
- *The odds*: a section outside a wave whose objective is held by more than twice what it is
  bringing (itself, the men already on the flag, the men moving with it) goes to the fire post
  three hundred short of the flag instead, the same point a wave against it would form on, and
  looks again in twenty seconds (`u.holdT`). By then it has been dealt to a wave, which finds it
  already on the forming-up point, or the rest have come up. It does not stop where it stands:
  the first version froze in place, usually in the middle of a street, and the army's reach fell
  by a third. Nearest-first dealing sends sections one at a time and one at a time is what a
  defended flag eats.
- *Armour on its own backs away from infantry with a launcher* (`u.def.at`, which only the
  airborne, the Fallschirmjaeger and the Panzergrenadiere carry) inside a hundred and ninety
  when no friendly section is within a hundred and thirty, opening the range two hundred and
  firing as it goes (`u.backT`, nine seconds between).
- *It fights with its front to the gun*: a halted tank caught more than a radian off its facing
  from a visible gun that can open it, between two hundred and five hundred and forty out, drives
  at it a hundred and sixty-five to turn (`u.faceT`, eight seconds between). There is no pivot in
  place, and a move short of a hundred and fifty behind the vehicle is taken by the driver as an
  instruction to reverse, which would present the rear plate instead.

Two things about it are counter-intuitive enough to be worth knowing before touching it.

**The shopping list is a ratchet.** `LADDER` is climbed against `madeOf` -- what the side
has ever ordered -- and not against what is alive, because a live count walks backwards
under fire: every armoured car that burned reopened the first line of the list, so a side
actually being fought bought twenty-two of them over twenty minutes and never saved the
fuel a tank costs. Losses are replaced in a second pass over the same list ordered by
`vehWorth`, dearest first, so the empty Tiger slot outranks a third medium and nothing
cheap is bought with fuel a heavier empty slot is waiting on.

**The infantry is bought out of what is left.** Sections are queued before vehicles in the
same tick, and on green's quarter economy they took every mark as it arrived: a Panzer IV
was refused thirty-two times in one annihilation game, every refusal for manpower, while
five assault groups at three hundred and thirty marks went out of the door. `aiWants()`
returns what the list still wants, in the order it will be bought, and the head of it is
reserved in marks and fuel (`wantMp`/`wantFu`) before a single section is queued; `spare`
is what the infantry may spend, and it is read again between the two purchases a tick can
make. The escapes matter as much as the rule: nothing is held back below three sections,
or for something there is no population for, or for something whose fuel is not within a
minute of arriving. A floor under AI *reinforcement* was tried on the same reasoning and
reverted -- it cost four hundred points against the previous brain over four mirror pairs,
with a third less army and forty per cent less ground. A side that cannot refill its
sections loses them outright, and a tank does not hold a street on its own.

**It attacks in waves.** A defended objective is not taken by sections arriving one at a
time, which is exactly what dealing them out nearest-first produces. So the units sent at
it gather at a forming-up point short of it (`aiFirePost` for a sector, `aiFormPost` for
a building, which steps back along the line to its own base because the enemy's bearing
is undefined when you are standing on his headquarters) and go in together, armour
included; `DIFF[].wave` is how many it gathers, `form` how long it will wait for them and
`press` how long the wave runs before the next one forms. Green gathers six and waits a
hundred seconds, which is what makes it a defensive game rather than a stream of targets.
In annihilation the head start (`DIFF[].grace`, green only) freezes the opposition
completely for three and a half minutes, but ends early if anything of its is shot or
anything hostile comes within nine hundred units of its headquarters -- the time is for
the player to dig a line, not for a free run at a base that is standing still. Below three
sectors the assault share is suspended and the whole army takes ground first, because an
army with no ground has no money and cannot replace the assault it just spent.
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

**The eighty-eight.** `UNITS.ger_flak88` is the one unit that is never queued: it arrives
through `WORKS.flak`, a field work the Pioneers build (hotkey 6, 420 marks and 50 fuel,
forty seconds), and `finishWork` spawns the gun inside the ring of bags facing the way the
work was aimed, with the crew laid out where a crew stands (`lay` in `finishWork`). It has
no speed, so `orderRetreat` refuses it, a right-click lays it rather than moving it (the
`!u.def.speed` clause beside `def.arc` in `issueOrder`), `canGarrison` refuses it, and its
crew are the only ones that do not walk to cover: the ring is the cover. The mesh is in
two pieces, `flak36Base` (the cruciform, laid once on `u.baseA`) and `flak36Model` (the
gun, drawn on `u.facing`), because a Flak 36 traverses on its platform and the platform
does not turn; `MODELS.gunBase` carries the second buffer and both draw passes and the
muzzle flash anchor a fixed mount at `u.x/u.y` rather than at the first crewman. Two
rounds: `def.w` is AP and `def.wUp.he` is HE, `u.up.he` picks, `setRound` costs most of a
reload to change, and because `mainW` hands back whichever is up, range, target choice,
the shot and the AI's reading of it all follow the switch with nothing else to tell. The
cards are J and L; the brain's crews pick AP while armour is in reach and HE otherwise.
The Canadians have no equivalent, on purpose. `placeWork` now checks a unit-work's
`limit` (two) and the population cap, which no wall of bags ever needed, and `popOf`
counts a pegged-out gun's men while the ring is still being built. The brain chooses
the round at the top of its per-unit loop, before the retreat rule and the target
reflex can end the tick, because a gun in contact is the one that needs asking; every
count of anti-tank guns reads `def.w`, the AP round, whatever is up. A knocked-out gun
stays in its ring as a `gunwreck` work with medium cover. The brain digs
one once the enemy has brought two vehicles or anything medium, out of money the shopping
list is not waiting on, on the overwatch post the Pak uses. Fought in the open without its
ring it takes a Sherman eight times in eight at nineteen seconds and an Achilles or a
Stuart faster; HE takes four men of a rifle section in fifteen seconds; a lone gun with
elite infantry inside two hundred of it is a dead gun, which is what the men in front of
it are for.

**The periscope.** `POV` is a first-person look from a unit: the LOOK button (V) puts the
eye where the section leader's helmet is (`povEye`, 15.5 units up, 26 on a vehicle) and
`povCamera` builds `MAT` from a yaw and a pitch instead of the orbit camera, so `CAMLIM`
never sees it and `CAM` is untouched for the return. The direction starts along the unit's
facing and a drag turns it (`povLook`), with the sign of a turn read off the camera basis
(`povTurnSign`) rather than assumed, because the world is left-handed and the sign is easy to
get wrong; a pinch or the wheel narrows the field of view (`povFov`, set by the narrower
screen axis so a portrait phone still sees sixty degrees across). The renderer draws only
what the side can see, so the view is honest by construction. In it a finger turns the head
and nothing else: taps pick nothing and give no orders, the battle runs on, the ear follows
the eye (`sfx` pans by bearing and fades by range), the minimap draws the eye and its cone,
the sky's horizon follows the pitch (`povSkyPitch`) and the haze closes in so the far town
fades. It closes on the button, on V or Escape, and on its own when the unit dies.
`check.mjs` opens it, turns it and closes it on both devices; `tools/shoot.mjs pov` is the
look at it.

In a vehicle the eye is the commander's and the vehicle has an inside. The shell is a set
of faces pointing out, so from in here it is not there at all, which is the fact the whole
thing turns on: what the commander can see is whatever the room leaves open, so the view
is something to design rather than something to measure.

**An interior is drawn, not derived.** `VIN[key]` is a builder somebody sat down and laid
out; `insideOf` reads a room off the shell for everything that has no entry yet. The
derived one exists so a new vehicle is never empty, and it can only ever make a box the
shape of the outside: the first version put a ring of eight pillars round the head and a
commander behind a fence is no use to anybody. An authored room is laid out around the eye
instead and is allowed to lie -- the wall stops below the sightline, the roof hangs above
it -- because nothing in the shell will contradict it.

A builder returns the room (`faces`, drawn on the mount or the hull by `drawInterior`),
the `lid` (the same frame, drawn only with the hatch shut, because the shut lid outside
has no underside and you would look up through it at the sky), the `hood` (drawn at the
eye and turned by the head), `crew` stations, `eyeUp`/`eyeIn`, the `hole` for `drawHole`,
and `hide`. `faceIn` is `faceOut`'s opposite and is why any of it is visible; `radialPlan`
samples a closed outline as rays from a point inside it, which is how a roof runs from a
hatch ring out to walls that share no vertices with it; `ringWall`, `ringDeck` and
`inTube` build from those plans. `INC` is the palette and is registered in the atlas like
any other.

**The Sherman V is the one that is drawn.** The commander sits at the back of the turret
on the hatch's side with the gunner low in front of him and the loader across the breech.
The wall stops at his chest and the roof hangs over his head, so there is a band of
daylight the whole way round at eye level; that band is the reason to draw a room by hand.
The gun is in gunmetal against white lead so the two read apart, the roof carries the same
periscope housings, ventilator and bomb thrower inside that the shell carries outside, and
the floor has the traverse motor and the cases that rolled where they fell. Three things
about it are worth knowing before drawing a second one. `hide: 'tur'` leaves the turret
mesh out while the lid is shut, because a culled shell stops hiding the mantlet and the
barrel and they come through the wall as slabs of paint hanging in the view. The `hood` is
his rotating periscope: drawn at the eye and turned with `POV.yaw`, so the window is ahead
of him wherever he looks and no post ever stands in the middle of it. And `povFov` clamps
to 1.3 buttoned, or a portrait phone gets ninety degrees of vertical and the world becomes
a letterbox between floor and ceiling.

**The hatch has to open the way a hatch opens.** The Sherman's two D-doors were laid out
fore and aft but hinged about the fore-and-aft centreline, so each swung up about its own
middle: half of every door went under the roof and both stood vertically through the
middle of the hatch. From outside, at the distance anyone had looked at it, that reads as
an open hatch. From the commander's own eye it is a slab of olive paint filling a third
of the screen, and it is what made the first head-out screenshots unreadable. The seam now
runs fore and aft, each door hinges on its own outer edge and opens to 1.9 radians, and
the nearest lid vertex is 5.7 units from the eye rather than nearly nothing. Every other
vehicle's lid is a single leaf and clears the eye by 3.3 to 4.8.

`vehFrames` is the one place the hull and mount matrices are made, so the draw and the eye
agree to the frame. `uInside` lights the room flat, a little dim, and ignores the shadow
map, which cannot see in there. `drawHole` draws a disc the size of the hatch into the
depth buffer alone, pushed to the far plane, so the head-out eye can see down through a
roof plate that has no hole in it; buttoned there is nothing to punch. OPEN and SHUT
(`povHatch`, `tHatch`) put the head up out of the lid or down on the seat, starting as the
crew would have it (`buttonedUp`); the pitch runs to -1.35 in a vehicle so he can look down
into his turret, and the periscope's vignette lifts inside a room that is already a frame.
`check.mjs` spawns a tank and asserts the eye drops when the lid shuts; the `pov` scene
photographs the hatch up, the window, the turret and the crew.

**And he commands it.** In the periscope of one of his own vehicles the player is its
commander, so the driver and the gunner are his. `DRV` is what he is asking for this
frame: a throttle, a steer and whether the gun is to go off. He takes over on the first
control he touches (`DRV.took`) rather than on opening the periscope, or a look out of a
tank that was going somewhere would stop it dead.

**None of the driving is written twice**, which is the only reason it is worth having.
The steer turns the hull; the throttle puts a waypoint a tank's length ahead of it and
finds it again every tick, so `moveUnit` does the rest and the weight, the gearing, the
slope, the metalled road, the walls, the separation and the track marks are the ones the
whole army drives on. Astern puts the waypoint a short way behind instead, because 120
units is the distance the driver already reads as an instruction to back up rather than
to turn round in a street the width of the tank. A parallel integrator would have been
a second set of rules to keep in step with the first, and it would have drifted.

The gun follows his eye: `u.want` is the look bearing rather than a target's, so the
turret traverses at its own rate and a Tiger II still costs twenty seconds to come
round. FIRE lays it on whatever `povTarget` finds under the crosshair -- an enemy the
side can see, inside the weapon's reach, within a hand's breadth of the middle of the
view -- and `fireAt` then refuses it for all the usual reasons, so the mark carries the
one that applies: TRAVERSING, LOADING, GUN OUT or READY. A commander who cannot see
which of the four he is waiting on will swear the tank is broken. While he has it
nothing acquires for him (`u.manual` skips `acquire` and the hull's turn-to-target),
because he is the crew now.

**The trigger is not a lock.** With nothing worth laying on, `povGround` walks the line
out of his eye until it meets a wall or the ground and the round goes there: `fireAt`
takes a bare point as happily as a unit, and with nothing aimed at, nothing is hit
directly and what lands is the burst. That is how you put HE through a window, and it is
most of what a tank in a town is for. The blocker grid answers the wall question in one
lookup a step and the block itself is only looked up for its height when the grid says
there is something, so a round goes over a garden wall and into the house behind it. The
mark on the ground is the burst drawn at its own size, with the far edge projected rather
than guessed. Houses are scenery and have no hit points, but the men in them have: a
round on the wall reaches the garrison standing along the inside of it.

**Two guns, two triggers.** The Sherman carries its coaxial as standard now (`def.sec`
on the unit rather than an upgrade, which is what `secondaryKeys` reads alongside
`u.up`), and under command neither gun fires on its own: the main gun answers GUN and the
coaxial answers MG, and `fireOneSecondary` returns at once while the trigger is up. The
coaxial is laid where he is looking, within a third of a radian, and with nothing in front
of it the belt still goes down the street -- a trigger that does nothing when pulled reads
as a broken tank.

**A machine gun has no round to load; it has a barrel.** `mgHeat` climbs while the gun is
running (`mgOnT`, set for a round and a half's worth each time one leaves, so the gauge
does not flicker between rounds at four hundred a minute) and falls while it is not, and
at the top of it the gun is out until it is back down to a third. `DIFF[].mgHold` is how
many seconds of the trigger held down it takes to get there: thirty on green, twenty-two
on regular, sixteen on veteran, and eighteen for anything the other side is driving.
Cooling from full takes a little over half as long again. Held down for ever it cycles:
twenty-two seconds of fire, eight of nothing, and round again. The roster barely notices,
because a vehicle machine gun in `duel.mjs` finishes its fight in fifteen to eighteen
seconds and never reaches the number.

The controls are a thumb pad and two triggers (`#drive`), pointer-handled so a finger
and a mouse take the same path, and on a desktop W A S D drive, space fires the gun and C
the coaxial (the right mouse button does too). **Both triggers read the same way round:**
the circle fills as the main gun loads and lights when the round is home, and the machine
gun's circle shows the barrel it has left rather than the heat it has taken. A gauge that
fills toward ready next to an identical gauge that fills toward danger is two opposite
meanings in two identical circles, and the first version had exactly that.
They are not laid out in CSS alone: a phone's right-hand edge already carries the tool
strip at the top and the little map at the bottom, so `povDriveLayout` measures the band
between them and puts the button in it, and `body.pov` takes away the three buttons that
order the rest of the army, which is not his to order while he is sitting in a tank.
`check.mjs` drives the tank three seconds under the pad and asserts it moved, turned and
then stopped.

**Map editor.** A second mode living under `ED`, sharing the renderer. Opens from the
title screen and edits `G.mapData`; the scene rebuilds a third of a second after each
change (`edTouch`, `edTick`, `edRebuildNow`). It is built for a thumb first and the
desktop gets the same layout: a dock of categories along the bottom (`ED_CATS`), a tray of
tools above it, a sheet of options that folds up over that (`edProps`: sliders and
segmented choices, never a dropdown), a menu behind the top-left button, a little map top
right that jumps the camera (`edMinimap`), and a panel that takes the screen for lists
(load, check, test, new, help). Every control is 44px or more and `check.mjs` asserts it,
sliders included. The first open shows the help (`edPanelHelp`, `ED_HELPED`).

The rule of the hand is the same with a mouse and a thumb: a drag on the ground pans, a
tap does the tool's one thing, and a press held still picks something up. Only the tools
that draw (lines, boxes, brushes) take the drag itself, and with those two fingers still
pan and zoom. The first version placed on any drag with a tool up and grabbed whatever
was under a finger in select, so in a town it could not be panned at all, and that is
what the first rating was for. The touch handlers ask `edTouchStart` (does this press
start a drawing drag, or a pan), `edHold` after 380ms still (pick up: carry a ghost of
the tool's thing seventy pixels above the fingertip, move what is selected, or box on the
ground), and finish with `edTap` or `edUp`; a second finger aborts whatever the first was
doing (`edAbortDrag`) and pinches. With a mouse `ED.press` decides tap from drag at six
pixels, and a drag in select moves what it lands on, because a pointer is precise enough
for that and a thumb is not. A tool's `kind` decides the rest: `place` and `stamp` on a
tap, `line` in one stroke simplified to its corners (`edSimplify`, Douglas-Peucker at
fourteen units) or point by point with a DONE pill, `rect` a box, `height`, `scatter` and
`erase` brushes with a radius in the sheet, `stampline` and `stamprect` several things in
one gesture (`edStampPoint`, `edStampLine`, `edStampRect`, each taking a random source so
the generator can seed them): a terrace with its own frontages, depths and setbacks, a
razed block, a courtyard, a farm compound, a gun position with its bags and wire, a
trench with wire in front of it, an olive grove, a crater field. Select picks the
smallest thing under the tap (`edPick`) and offers duplicate, copy across the midline and
delete. Undo and redo are whole-map snapshots (`edSnapshot`, sixty deep). Mirror is on by
default and every `edPush` mirrors what it adds, flags and headquarters swapping side.

**An edit rebuilds the least it can**, because the first draft rebuilt the whole scene on
every tap and on a phone that was a pause of seconds between two houses. The props are
built in tiles (`PT_W` by `PT_H`, `tileOf`, `sceneProps(tile)`, `buildTile`), a static
tile 0 for what the ground itself grows (outcrop, boulders, pavements, flag poles) and a
grid for everything placed, each piece seeded from its own position (`seedAt`) so a tile
comes out the same alone as with the rest; the ground mesh is in the same tiles
(`buildTerrain(only)`) and the ground paint repaints and uploads a clipped patch
(`buildAlbedo(rect)`), which matches because the paint is deterministic. `edMark` marks
the tiles a thing's footprint touches with a margin for what hangs off it, and sets
`ED.needGround` when its type cuts or paints the ground (`ED_GROUND`), `ED.needGrass` for
grass, and `ED.padT` for a house, whose flattened pad is caught up in the ground mesh a
few seconds later when the hand is still. Undo and redo diff the two versions thing by
thing (`edDiffMark`) so an undo costs what the edit cost. In the game the tiles are
frustum-culled (`tileInView`), so it draws fewer triangles than the single buffer did.
`makeHeight` keeps its natural heightfield (`makeHeight._base`) because it is the same
every time and took most of a second to make. The vertex stream of a tile is moved off
the heap into `Float32Array` chunks as it grows, because two million numbers in one plain
array set off collector pauses of seconds. What is left per tile is about a tenth of a
second of geometry on this container's CPU, and one thing `check.mjs` cannot see past:
under SwiftShader every third consecutive `bufferData` of a tile blocks for over a second
whatever the strategy (fresh buffer, reused buffer, `bufferSubData` in pieces), which is
the command buffer waiting on a software GPU process and not the code; a real GPU takes
the upload in milliseconds, so the rebuild time the gate prints is not a phone's.

NEW MAP is a generator (`edGenerate`, `ED_TEMPLATES`, `edPanelNew`): a seed and three
sliders, town, damage and works. It lays out the west half and the midline, a grid of
streets a little off true with a terrace along every frontage no deeper than the block
allows, a piazza north of the crossroads, farms by the outer flags, groves, field walls
and scrub outside, then razes blocks and pocks the fields by the damage slider and digs a
trench line, gun positions and a roadblock in whatever field there is between the
headquarters and the town by the works slider, mirrors the west, and runs `edTidy`, which
takes out anything the check would name. Every draw comes from the seed, so a number is
a map. `check.mjs` generates every template at three seeds and asserts the check comes
back clean. The CHECK panel can also copy one half over the other (`edMirrorAll`).

Keeping maps: a draft is written to `localStorage` a couple of seconds after every change
(`ED_DRAFT`) and is what the editor reopens; named maps live together under `ED_SLOTS`
with a load list, and the last map saved or tested (`ED_LAST`) is what the title
screen's PLAY CUSTOM MAP starts. A map goes out as a file (`edExport`), through the
phone's share sheet where there is one (`edShareFile`, the Web Share API with a JSON file,
falling back to the download) or as text on the clipboard (`edShareText`, with a
select-all fallback where the clipboard is refused) and comes in as a file or pasted text
(`edTakeText`). TEST asks for a side, an opposition and
a victory rule and deploys on the map; the game-over screen then has a way back
(`#overedit`, `ED.fromEditor`).

CHECK runs the rules of `tools/mapcheck.mjs` on the device (`edCheck`: craters on
trenches, wire through craters and trenches, anything inside a building, buildings that
overlap or leave a slot too narrow to walk, streets through buildings, streets too narrow
or too long, plus what a game needs: both headquarters, a victory flag, three flags),
each with a GO that flies the camera to it, and a balance table (`edBalance`): buildings,
cover, craters, trees, trenches and wire on each half, and every flag's distance from
each headquarters, with anything lopsided marked. The shipped map comes back clean from
both, which is the calibration.

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
- **On screen, model +y is the vehicle's right.** The world is drawn left-handed, so
  a fitting placed at +y comes out on the right-hand side of the vehicle as the
  player sees it. Verified head-on with the Panzer IV: its driver's visor is at
  +6.6 and appears on the vehicle's right, which is the wrong side for a Panzer IV.
  The Tiger II and the StuG IV were laid out with this in mind (left-hand fittings
  at -y); the Panzer IV, and possibly others, were laid out as if +y were left and
  are mirrored. Check the screen, not the axis, before calling a side correct.
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
- **A part that is right from outside can be ruinous from inside it.** The periscope puts
  the eye a couple of units from geometry nobody had ever looked at closely, and the first
  thing it found was the Sherman's open hatch hinged about the wrong line: correct enough
  in a gallery shot, a wall of paint from the commander's seat. When a model gains a
  first-person eye, photograph it from that eye before trusting the gallery.
- `spawnUnit()` puts the unit on the field itself. A tool that pushes the return value
  into `G.units` as well has it in the list twice, and a unit in the list twice is
  updated twice a frame: it drives at double speed and its gun fires at twice its rate of
  fire. That is exactly how a Sherman came back off the rate probe at 1.7 seconds a round
  against a paper 3.3, with nothing wrong in the game at all.
