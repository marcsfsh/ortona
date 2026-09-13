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
under 1040 kB. Takes under a second. Exits non-zero on any violation.

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
