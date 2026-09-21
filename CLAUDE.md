# Ortona

A single-file, real-time tactical battle game: 1st Canadian Infantry Division against
1. Fallschirmjäger-Division. Custom WebGL2 renderer, no engine, no dependencies, no
build step.

Two maps ship. **Ortona**, December 1943, is the town fought one building at a time.
**The Gothic Line**, the Foglia valley at the end of August 1944, is two ridges with
fourteen hundred units of no man's land between them, laid out for four players and
mirrored about the midline to the unit. They are picked on the title screen under GROUND
and both open in the editor.

**The whole game is `ortona.html`.** Some 18,000 lines and a megabyte: CSS in one
`<style>`, markup, then all the JavaScript in one `<script>`. Open the file in a browser
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
node tools/move.mjs          # movement: routes, traffic, and whether cover is taken
node tools/brain.mjs         # the AI: what it sees, what it decides, what each rule fires
node tools/sight.mjs         # sight: the trace, what a position commands, how long spotting takes
node tools/model.mjs         # the models: the occlusion bake against shapes with known answers
node tools/terrain.mjs       # the ground: what grain is on it, at what distance, and what crawls
node tools/skirmish.mjs      # tactics: this AI against the one in the last commit
node tools/wreck.mjs         # destruction: the hole, the collapse, the falling masonry, the grids
node tools/fx.mjs            # effects: the muzzle blast, the tracer, the burst, read off the framebuffer
node tools/audio.mjs         # sound: renders every effect to WAV, with the numbers
node tools/shoot.mjs --list  # what can be photographed
node tools/shoot.mjs         # the default scene set, desktop
```

**`--map=gothic` runs a card on the other ground.** `harness.deploy` clicks the title
screen's own GROUND control, which is the one path that also decides what a later
`startGame()` inside a probe keeps, so `shoot`, `move`, `brain` and `skirmish` all take
it and nothing else had to change. A card run only on Ortona is a card that has never
seen a map with 1,400 units of open ground on it -- the movement card put the Gothic Line
at 131 paths found against Ortona's 12,177, because Ortona's are nearly all the
straight-line shortcut down a street and here the belts and the walls make the search do
real work.

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
node tools/dims.mjs --base=HEAD  # measure an older file instead
```

**`--base` is there because the tool could only ever open the working file**, so it could
say whether a model is the right size and never whether a change made it a different size.
The first thing it caught was the detail pass: the Stuart had grown half a metre and the
Sherman likewise with no vertex moved. `aoSplit` was the cause and this tool was the fault
-- it drops a whole face that reaches above a height cap, which is how two and a half
metres of rod aerial stays out of a published height, and a face cut into pieces has every
piece below the cap survive the filter. A split face carries `zt`, the top of the plate it
came off, and the filter reads that: a filter on the model rather than on how the model
happens to be tessellated.

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
node tools/duel.mjs --base=HEAD          # fight the whole card on an older file
node tools/duel.mjs --file=/tmp/x.html   # or on any file
```

A row reads `open` and `met`: where the pair were put down, and where they were when the
first round left a barrel. **Both sides are given time to find each other before the clock
starts**, which they need now that being seen takes a second or two. Unprimed, an
attack-move walks for the whole of that second and a pair staged at 381 were at 71 before
either could see the other: every row on the card was a knife fight and the reach a weapon
has was not being tested at all. The card stages a fight at a range and a fight at that
range is what it should measure; what the closing costs is a real effect and it belongs to
the sight and movement cards, where it is not confounded with the roster. `B` on a row
means the pair never saw each other from where they were staged, which is a fact about the
roster and not about the fight.

**And the hulls of the last fight are cleared between runs.** They have always been left
lying on the staging ground and have always been on the movement grid; since a burning
wreck also obscures, they were attenuating the sight line as well, so from the second run
of every row the pair were fighting through the smoke of the one before. It cost the card
about half its row-to-row spread: 36 points against 19 on the same comparison.

`--base` is there because a change that was never meant to touch the fighting still has
to be fought, and because one row moving is not evidence of anything. A near-even matchup
swings by thirty points between runs of the same code: halving the cell size came back at
65 per cent and then 38 on `us_sher ger_p4` over forty runs a side, which looks like a
finding and is not. Read the whole card, as a mean over its rows with the standard error
of that mean. Sixteen runs a row put the grid change at +0.3 points with a standard error
of 2.2; six runs a row put the whole movement and cover overhaul, hull turn rates and all,
at +4.2 with a standard error of 4.6, and the spread of the row-to-row shifts was 30.2
against the 28.9 that six runs a side produce out of nothing at all.

The card is slow, and how slow depends on what else is running: forty-three rows at
sixteen runs each is three quarters of an hour on a quiet box and does not finish at all
on a busy one. Six runs a row takes about eight minutes and resolves a ten-point
systematic shift across the card, which is usually the question being asked.

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

### `tools/move.mjs` - movement, pathing and cover, mechanically

A path is a few hundred cells of arithmetic and the eye will not hold them. A section
stuck against a wall looks exactly like a section holding a wall. A tank that took the
gardens instead of the Corso arrives late and nothing on screen says why. So it is
counted.

```sh
node tools/move.mjs                 # the whole card
node tools/move.mjs routes          # one section of it
node tools/move.mjs --base=HEAD     # the same card on an older file, side by side
node tools/move.mjs --t=360         # a longer battle probe
node tools/move.mjs --v             # every route and every drill rather than the summary
```

Five sections, because there are five questions.

**CONTACT** asks what a unit's collision body is against the model it is drawn as, and
what was actually between two models at the moment the push fired. The hull is measured off
the model's own faces here and deliberately not asked of the game, because a probe that asks
the code under test how big a tank is cannot see it being wrong about how big a tank is. The
number to read is the SPREAD of the gap over bearing rather than any one row of it: one
isotropic threshold gives a different answer on every bearing, which is both halves of the
complaint at once. It ran at 20.7 units of spread for a Sherman meeting a rifle section
(-9.7 to +11.0) and 21.3 for two Shermans; it reads 0.1 and 0.1 now.

**MOTION** is a staged move with every frame of it recorded, because rubber-banding is a
property of a path through time and there is no still picture of it. `jerk` is the mean
frame-to-frame change in velocity, `revs` counts the steps that reversed on the one before
-- which is the rubber band itself -- `flips` counts how often a hull changed which way it
was turning, and `drift` is the ground made while turning, which for a tracked pivot should
be near nought and for a wheeled vehicle cannot be. The trace STOPS when the unit arrives:
counting the frames it sits still afterwards put half of a clean run in the stall column and
said nothing about the run.

**ROUTES** asks whether a path is any good. Five journeys across the shipped map, each
for a section, tracks, wheels and the heaviest thing on the roster, priced three ways:
length against the crow, cost against a plain Dijkstra over the game's own grid and its
own `cellCost`, and the narrowest place along it against the beam of the thing that has
to fit. Then the unit is driven down it by the game's own `updateUnit`, because a path
that prices well and cannot be walked is worth nothing. The Dijkstra reference is the one
piece of arithmetic here that is deliberately *not* the game's: an optimum computed by
the code under test is not an optimum.

**TRAFFIC** is a whole battle, both brains, counted every frame, looking for the states a
unit should never be in: with a path and four seconds of no progress, with its centre off
the walkable grid, with its men inside a house, wedged inside another unit, in a gap
narrower than its own beam. Plus the rates that say how hard the pathfinder is worked.

**COVER** puts a section down at two dozen points through the town with an enemy on a
known bearing, lets it settle, and asks what tier its men are actually getting against
that bearing -- against the best tier that was there for the taking. Taken over available
is the number, because cover that is never taken is scenery.

Two things about reading it. **A metric needs a denominator you can see.** The first
version counted four-second windows in which a unit with a path went nowhere; a path is
usually spent in well under four seconds, so a whole battle produced about fifty windows
and four coincidences read as a nine per cent regression. It counts unit-frames now, and
the denominators are printed. And **`unitRadius` is half a vehicle's length**, not its
width -- it is the separation radius -- so the card measures fit against a beam derived
from it. Comparing a Sherman's 41 against the 55-unit clearance of the Corso says the
main street of the town is too narrow for the tank that is driving down it.

Where the overhaul left it, on one `--base=HEAD` run of 150 seconds a side: stuck
unit-frames 0.95 per cent to none, wedged 2.65 per cent to none, halted men in cover 72.7
per cent to 99.1, cover taken over available 0.59 to 0.76 with the two sections that
stood in the open beside medium cover down to none. Off the same card's routes: the way
across the town's grain 991 units to 840, its detour 1.37 to 1.16, and the share of that
drive on the metalling 0.58 to 0.98. Formation slots inside a house, which the card does
not print, went from 7.1 per cent of man-frames to 2.4.

### `tools/audio.mjs` - sound, mechanically

Every noise the game makes is synthesised at runtime, so a change to the sound can no
more be reviewed by reading the diff than a change to a model can. This renders the
game's own `sfx()` through an `OfflineAudioContext`, writes WAVs to `shots/audio/`, and
prints what a sound actually is.

```sh
node tools/audio.mjs                 every sound, the roster, a montage, a firefight
node tools/audio.mjs rifle mg        two of them
node tools/audio.mjs us_how8         one piece off the roster, in its own voice
node tools/audio.mjs --tag=before    keep a set to compare against
```

Nothing is reimplemented: the page's own `auAttach()` builds the graph on the offline
context and the page's own `sfx()` fills it, so what lands on disk is what a player
hears, sample for sample. A named unit key goes the same way -- the page's own
`gunVoice()` reads the voice off that unit's real weapon and the page's own `sfx()` plays
it -- so the ROSTER table is thirty-odd guns firing rather than a list somebody typed.

Two columns matter more than the rest. **Crest** is peak over rms: a crack is a high
number and a hiss is a low one. And the **first 50ms** band split is where the character
of a report lives, because a whole-buffer spectrum is dominated by whatever rings longest,
which is always the bottom end. Measuring band *power* out of a transform rather than the
magnitude at a few single frequencies is not a detail: the cheap way compares a sine,
whose energy sits in one bin, against noise, which is spread over thousands, and reports
any sound with a thump in it as ninety-nine per cent bass with no crack at all.

**ROSTER** is every gun on the roster that fires a shell, in the voice read off its own
weapon. Over eighteen guns it is about 8.9x in level (rms, because the bus ends in a
compressor and peak reads 2.2x), 10x in centroid and 3x in length:
a mortar is 523 ms with a crest of 12, a pack howitzer 835 ms at 6.2 and a heavy battery
1,513 ms at 4.6, and the Pak 40's onset sits at about 1,840 Hz against the eight-inch's
210. A row is the mean of ten takes, because every layer of every report is jittered per
shot and one take says nothing: measured once, the Pak's centroid came back at 776 Hz and
then at 1,050 on the same file. Even at ten takes the lengths and the class order hold to
a few per cent between runs while the onset colour of a single gun moves by as much as a
tenth, so read the shape of the table and not the last digit.

**And each of the three artillery pairs is measured against its own first piece rendered
twice.** A ratio with no floor under it says nothing, and the floor is not the same for
every class -- a tank gun carries most of its variance in the top end and a mortar carries
almost none, so the Panzer IV against the StuG, which is one gun on two hulls, is the
wrong control for a mortar. Measured over fourteen takes on each device, the metric that
carries each pair is rms, at 1.40x, 1.30x and 1.26x against floors of 1.00x to 1.01x --
nineteen to a hundred to one. Which metric carries which pair is the point: the two
mortars are the pair whose tails are most alike, so length separates them by 1.04x and
says nothing, while it separates the two heavy batteries by 1.33x. The gate row keeps only
the metrics that separate a pair by a real amount and then reports the one measured most
reliably, because each half of that alone fails the other's case.

**LANDING** is the burst, sized off the hole the shell dug: 1.7x to 1.9x in centroid and
1.6x in length over the six shells, every one of which was one sound before. The two
mortars land identically (213 Hz against 213 Hz), which is correct and is the point -- a
burst has no propellant in it and no side, so what separates two shells on the ground is
the size of the shell and nothing else.

The firefight is the one to listen to. A company a side is put down two hundred units
apart in the middle of the town and left to it, every sound the game really plays is
written down with where it happened, and the busiest twenty seconds are handed back to
one offline context -- one room, one compressor, one set of rate limits -- so what comes
out is a mix rather than a row of samples laid side by side.

### `tools/brain.mjs` - the AI's own account of itself

`skirmish.mjs` answers whether one brain beats another, which is the only honest verdict
on its judgement and is nearly always too coarse to see one. This answers the questions
underneath that, which are not about judgement at all and are cheap to count: what the
brain can see, what it acts on that it has never seen, whether the rules it carries ever
fire, and what a tick of it costs.

```sh
node tools/brain.mjs                # the card
node tools/brain.mjs --t=420        # a longer battle
node tools/brain.mjs --diff=2       # at veteran, where the skill-2 rules live
node tools/brain.mjs --base=HEAD    # the same card on an older file, side by side
```

It puts a brain on **both** sides, the way `skirmish --self` does, and that is not a
nicety. With one side thinking the other army stands at its base all game, the two never
meet, and the first version of this probe watched `aiPickTarget` return null on all twelve
hundred calls of a five-minute run. A probe that watches a brain fight nobody is measuring
an empty map.

**COST** is what a thinking tick costs, and how many times it takes a pass over the whole
army to answer what it asks. That number was thirteen partial passes; it is one.

**SIGHT** is the honesty boundary, and it is the reason the card exists. `acquire` refuses
anything the side cannot see, which is what the whole fog of war rests on -- but it
honours a FORCED target without asking, and the brain forces targets. Measured, one round
in five that actually left a barrel was fired at something nobody had ever seen. The card
counts picks, orders and rounds against the share of the enemy that is out of sight.

**PLAN** is what it did: the moods it held, the jobs it dealt, how many waves it formed
against how many ever went in, how long forming took, what it garrisoned and built.

**SENSE** is the situation layer: what a unit reads about its own position on a tick and
which option it chose out of it. Two numbers carry it. The share of unit-ticks with armour
in front that the unit cannot hurt is the case the calls exist for. And the spread of the
actions chosen, because an option that never wins is a block of scoring nobody is running,
which looks exactly like an option that is not there.

**CALLS** is the routing: how many were raised, how long one stood before anybody was sent,
and how they ended. Note that the three tick-counts at the foot of it are unit-ticks and
not events -- a call is worked every tick it is open, so what they say is how long was
spent holding, driving and fighting, not how often each started.

**OPS** is what the army was trying to do: how many operations of each kind were raised,
how long one ran, how much of the army was on one, and whether a feint drew anybody. The
number to read is `ran` against the timeout in `aiOpsReview` -- an operation that always
runs to its timeout has no working test for being finished, which makes it a habit rather
than a plan. The feint is the exception and is meant to expire.

**INTENT** is the second layer of inputs: how many contacts are fresh and how many of them
carry a heading, how often a body was read as massing and walking onto a held flag and how
far out, the weight the rollup expected onto held ground, the exchange, the clock, how
pinned the defenders of an enemy flag were, and the tubes heard rather than seen.

**ARMS** is each kind of thing against the line the sections make, in unit-ticks: how
often a team or a tank stood with no section within reach of it, how often it stood
forward of the nearest section to the main effort, what state the crew-served weapons were
in (in action, packing, walking, setting up, limbered), and the anti-tank guns and the
tubes on their own. It is measured off the units and not off the brain's own anchor,
because a probe that asks the code under test where the line is cannot see it being wrong
about where the line is.

**RULES** is every named decision and how often it fired, out of the brain's own counters
(`AIR`). The zeroes are the point. A rule that never fires looks exactly like a rule that
is not there, and this file already records one that parsed, passed the gate and never
fired once -- with nothing to say so. It is also how a rule that fires once a battle shows
up as one that may as well not be there: the duck rule fired exactly once in a five-minute
battle at the last commit, which is what sent the reaction to fire into the weighing.

### `tools/sight.mjs` - sight, mechanically

What a unit can see cannot be reviewed by reading the diff and cannot be reviewed from a
screenshot either, and the second half of that is the part worth saying out loud: the
picture shows what the renderer drew, and what the renderer draws is filtered by the same
vision code that is under test, so a bug in it hides itself. The fog of war ran for the
life of the game with no live-vision tier at all -- `updateFog` asked each eye for `r2`
and `computeVisibility` writes `r`, so the radius was the square root of undefined, which
fails a loop bound silently and skips the eye. Every cell the player had ever walked past
sat at 110 and nothing on the map was ever brighter, and since the terrain shader
multiplies by `0.16 + 0.84 * vis`, the whole visible map rendered at 52 per cent
brightness for the life of the game. Every screenshot ever taken of it looked plausible.
That is why the fog buffer is a section of this card.

```sh
node tools/sight.mjs                 # the whole card
node tools/sight.mjs trace           # one section of it
node tools/sight.mjs --n=400         # more sample lines
node tools/sight.mjs --base=HEAD     # the same card on an older file, side by side
```

**TRACE** asks whether the line of sight agrees with the ground. The reference is a walk
of the same line at four units a step, which is deliberately *not* what the game does, and
it reads the game's own end exemption out of `traceClear`'s source rather than restating
it. Three of the card's first four readings were wrong and the card was at fault each
time: a reference using a different end exemption reported four per cent of walls stepped
over that were not; a wall drill with the target three hundred and twenty units out
reported a dense town as men blinded by their own cover, fifty-six per cent of it other
people's buildings; and a spotting drill placed on what turned out to be a crater field
reported a prone section as never seen at all. Each correction is written into the card
beside the thing it got wrong.

**REACH** is the share of a ring at each range that an eye there can actually see, which
is the number that says whether a town is a town or an open field with houses drawn on it.
The crossroads commands 58 per cent of a ring at 150 units and 7 per cent at 800; open
ground west of the town commands 100 and 24.

**SPOT** is seconds to pick a section out, by what it is doing, which is the whole point of
making detection a rate. **FOG** is the share of the map in each of the three tiers.
**COST** is what a vision tick costs and how many traces it runs.

### `tools/model.mjs` - the models, mechanically

A vehicle is judged by looking at it, and that is right for proportion, for paint and for
whether a fitting is on the correct side. It is no use at all for the occlusion baked into
it, because the bake is arithmetic over a grid and every way of getting it wrong produces a
picture that is plausible. Too strong and the tank is a darker tank. Too weak and nothing
happened. Self-occluding and every surface is shaded evenly. Stepping over a wall and the
joint beside the wall comes back open. All four of those were written into the working file
in one afternoon and the photographs said nothing, because a shaded slab and an unshaded
slab both look like a slab.

```sh
node tools/model.mjs                 # the card
node tools/model.mjs bake            # one section of it
node tools/model.mjs --base=HEAD     # the same card on an older file, side by side
```

**BAKE** puts the bake against shapes whose answer is known before it is run. A plate alone
in the sky is occluded by nothing and has to read 1. A deck two hundred units wide is not
occluded in the middle of it. The foot of a block standing on that deck is, and so is the
deck at the block's foot, and the inside of a corner is darker than either. Those are facts
about shapes rather than judgements about tanks, and each of the four faults above breaks
at least one of them. It reads 1.000, 1.000, 0.882, 0.328, 1.000, 0.487, 1.000, 0.439.

Two things about writing a drill for it. **Read the vertex nearest the thing, not a window
round it**: occlusion at the foot of a wall falls away over a foot or two, so a window a
dozen units wide averages the joint with the open deck beyond and reports the joint as
open, which sent me hunting a bug in a bake that was answering correctly. And **a drill
builds its own faces**, because the bake writes onto the face lists it is given.

**COST** is what it costs at boot: the bake is a march over a grid at every vertex of every
vehicle and there are six hundred thousand of them. The number to read is how many marches
the quantised cache saves -- occlusion varies over the width of a joint and no faster, so
asking at every face-vertex asks the same question a dozen times. It is one march in three
and a half, and every vehicle built costs about 580 ms against 210 before.

**SIZE** is faces and vertices per vehicle, because `aoSplit` cuts the big plates and a
detail pass that quietly trebles the roster is a detail pass that does not run. It is
152,000 faces over twelve vehicles and the split adds about a hundred of them.

### `tools/terrain.mjs` - the ground, mechanically

A photograph of ground is the one thing that looks fine whatever is wrong with it. Soft
and airbrushed reads as haze. Aliased reads as detail until the camera moves. Detail at
one fixed scale reads as noise up close and as a flat wash at range, and every one of
those is a picture somebody would call acceptable. So the ground is read off the
framebuffer: the camera is pointed straight down at a patch of open ground, the frame is
rendered, and what is actually there is measured.

```sh
node tools/terrain.mjs                 # the card
node tools/terrain.mjs grain           # one section of it
node tools/terrain.mjs --base=HEAD     # the same card on an older file, side by side
```

**GRAIN** is the root-mean-square contrast of the ground at four spatial scales, at three
camera distances, and the column that matters is `fine`: the contrast living above the
eight-pixel scale, which is the difference of the squares because variance adds. Whole-
patch contrast is dominated by the painted macro drift and moves by a point or two
whatever the grain does -- the ground before this pass read 52.2 per cent at full
resolution and 49.1 boxed down by eight, which is a picture with nothing on it finer than
eight pixels at any distance. The rows are not comparable to each other, because the patch
is a fixed number of pixels and so covers more world the further back the camera is. They
are comparable across files, which is what `--base` is for.

**SHIMMER** is the level-of-detail measurement and it is the reason the card exists rather
than a screenshot. The camera is moved a third of a pixel and the same patch read again:
what changes is detail that was never filtered down to the pixel it lands in. It is
reported twice, with the props in and with them taken out, because a rubble pile a pixel
across aliases however well the ground is filtered and that is not the ground's fault --
measured, the props are very nearly half the shimmer at twelve hundred units, and without
splitting them no change to the terrain can be read at all.

Read shimmer against `fine` rather than on its own. Grain you can see at two hundred units
is grain that moves when the camera moves, and that is detail rather than aliasing; the
indictment is a large shimmer with a small `fine` beside it.

**PAINT** is what the albedo canvas carries before any of the shader's detail goes on top,
and what its filter is. **COST** is ground triangles and what the textures weigh.

Two things about writing a drill for it. **`CAM.tx`/`CAM.ty` is what the camera looks at;
`CAM.x`/`CAM.y` is not the camera at all**, and setting the wrong pair moved nothing: every
distance read the same patch of whatever the game had left on screen and the shimmer column
came back at a clean nought three times over, which reads as a perfectly filtered ground.
And the patch of ground has to be clear for two hundred units every way, because the widest
read is that across and a roof in the corner of it is not the ground.

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

**And the verdict line is not to be trusted at four pairs.** It is computed from a standard
error estimated out of four numbers, which is itself so uncertain that the sentence can come
out either way on the same code. Measured: `--base=HEAD` run on a revision *identical to the
working file*, so that the true difference is zero by construction, came back at +367 with a
standard error of 126 and the tool's own line saying it cleared twice that. Eight pairs of
the same thing came back at -181 with a standard error of 173, which the tool correctly called no result at all. A pair sum on this map swings by
five hundred points either way, so four of them can cluster anywhere. Run eight before
reading the sentence at all, and treat anything under a few hundred points as unresolvable
whatever the sentence says. A calibration is cheap and it is the only thing that tells a
finding from a run of luck: `--base=<the commit you are working on top of, before your
change>` with nothing changed is the control, and it should read zero.

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

What is actually swapped between the sides is the bundle `baselineBrain` extracts, and
nothing else: a change made anywhere outside those functions applies to both sides and the
card cannot see it at all. `aiPickTarget` is in the bundle for that reason -- it is where
every attack order comes from -- and so are `aiSense`, `aiWeigh`, `aiCall`, `aiCanAnswer`
and `aiAnswer`, which are where a unit decides what to do about what is in front of it and
who gets sent to somebody else's trouble. A revision that has none of them simply has fewer
parts; anything else whose judgement comes under test belongs there too.

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

**FACE** is the same reading on a sunlit slope. The painted map is a plan and nothing else,
so on a face it is stretched by one over the cosine and every scale of grain on top of it is
stretched with it: a face carries about two thirds of the fine contrast the open ground
beside it carries at twenty-five degrees and about two fifths at forty-five. Three rows
rather than one, because what it measures is a blend of two projections and the shape of the
answer is the point -- a card with one row at forty-five degrees, where a plan projection and
a vertical one are out by the same root two, says the pass did nothing.

Two things had to be fixed before it could say anything at all. **The steepest thing on
Ortona is a sea cliff**, so a probe that hunts the map for the steepest patch reads the
Adriatic in the corner of its square and comes back at forty-nine per cent contrast; made to
insist on a hundred and twenty units of uniformly sloped inland ground, there is nowhere on
the map that qualifies and it falls back to flat every run. And **a face has to be in the
sun**: the grain does most of its work through the normal and the sun term, so a north face
at twenty-one degrees of elevation is in its own shadow all day and reads the same whatever
is done to it.

The fine column is measured rather than inferred. `sqrt(full^2 - boxed8^2)` is right in
principle and hopeless in practice once the two are close: on the wall of a shell hole the
whole-patch contrast is 36 per cent and the boxed one 35, so the fine part is a difference of
two large numbers and moves ten per cent on nothing.

### `tools/wreck.mjs` - destruction, mechanically

A building coming down is the one change in this file that looks convincing whatever is
wrong underneath it. A hole in the wrong place is a hole. Stone that vanishes on the way
out is stone nobody counted. A chunk that falls at the wrong rate falls. A bay that comes
down on the second round instead of the eighteenth still comes down, and the photograph of
it is the same photograph. The grids are worse than that: a house knocked flat that still
stops a boot and still stops an eye is a picture of rubble laid over a building that is, as
far as everything else in the game is concerned, exactly where it was.

```sh
node tools/wreck.mjs                 # the card
node tools/wreck.mjs shell           # one section of it
node tools/wreck.mjs --base=HEAD     # the same card on an older file, side by side
```

**SHELL** is a round against a wall: the hole it cuts against the hole the burst says it
should cut, and the masonry that comes out against the masonry that left the wall. The
second is the conservation check and it is the one that matters -- the area a wall has lost
is bookkeeping until the stone it lost is in the air at the right size. It reads `kept` at
0.76 to 0.79 against a declared `RUIN_KEEP` of 0.78, averaged over twenty-four rounds a row
because two chunks with three jitters each have a spread that swamps the number.

**FALL** is the structural rule, staged by writing the damage on the walls directly rather
than by shelling until something happens: one face three quarters out takes the storey, two
faces half out take it, and one face half out does not. Underneath it is what it costs in
rounds on one wall -- 49 mortar bombs, 18 rounds of 105, or 3 out of a heavy battery.

**DEBRIS** is the integrator against arithmetic that was true before the game was written.
A 197-unit fall takes 2.000 seconds against the 2.005 that `sqrt(2h/g)` says. It bounces
back to 0.038 of the drop against the 0.04 its restitution squared gives. Everything is
lying still inside three seconds, everything that came off a collapse settles, and the heap
it builds is measured against the stone that came down.

**WORLD** is the part a screenshot cannot see at all: the same cell asked the same
questions with the bay standing and with the bay down.

**WALL** is the same question asked of an object rather than a building.

**HULK** is the other half of destruction, which is a vehicle. It is the one thing on this
page a photograph is worst at, because the effects round a dying tank were never in doubt
and its BODY never changed: from above, a dark tank and a dead tank are the same picture.
So the row renders the same Sherman alive and then dead from one camera and counts the
pixels between them, against a control of the live frame rendered twice -- which is nought
-- and it reads about 25,000 to 50,000 of a 1.44-million-pixel frame. The rest of the
section counts what the body actually did: over forty deaths each, how many threw the
turret off (a third of the Shermans, none of the StuGs, which is the casemate), how far the
hull cants and sinks, how much plate comes off it, and then one mount followed through its
flight -- how high, how far, how long, how much it tumbled, that it lies still afterwards
and that it is cover where it lands.

**COST** is what it is worth in milliseconds. Note that the two mesh times are the geometry
alone and not the upload: under SwiftShader every third consecutive `bufferData` of a tile
blocks for over a second, so a loop of whole tile rebuilds reports two and a half seconds
and reports it about the rasteriser.

### `tools/fx.mjs` - munitions, muzzle blast and bursts, mechanically

An effect is the one thing in this file a screenshot is worst at reviewing, and not for
the usual reason. A model holds still and can be photographed; a muzzle flash lasts
seventy-five milliseconds and a frame under SwiftShader is most of a second, so catching
one at all is luck. Worse, an effect that is drawn and invisible looks exactly like an
effect that is not drawn: this card's own development spent five rounds of screenshots on
a smoke column that was being packed, uploaded and rasterised correctly the whole time and
was simply the colour of the ground it was drawn over, and then on the same column
climbing three hundred units out of the top of the plate. Neither is visible in a picture.
Both are one number.

So the frame is read rather than looked at. Every row renders the same scene twice, once
with the effect and once without, and reports what the effect actually put on the screen.

```sh
node tools/fx.mjs                 # the card
node tools/fx.mjs muzzle          # one section of it
node tools/fx.mjs --base=HEAD     # the same card on an older file, side by side
```

**MUZZLE** is every weapon on the roster fired once from the same spot with the same
camera on it. The claim is that a blast is read off the weapon rather than typed per unit
key, so `spread` -- the biggest lift over the smallest -- is the number that says the
roster is differentiated rather than merely loud. It is 53x, from a Lee-Enfield at four
thousand pixels to the 210 at eight hundred and sixty thousand. `seen` says whether the
firer was on camera when it fired, because every flash in the game is gated on that and a
row reading nought otherwise has two causes that are different faults.

**BURST** is a shell landing, read at five ages, because what was wrong with the old one
was its SHAPE IN TIME: a flash and then nothing. A heavy shell now holds nearly half a
million pixels from a tenth of a second out to nearly two seconds, and its column reaches
235 units where a mortar bomb's reaches 62.

**TRACER** is the round in the world. The test that matters is occlusion, and it is done by
laying the same round across the same patch of screen twice, once on the far side of a
house and once on the near side: 17,638 pixels in front of the wall and none behind it.
Drawn on the overlay both would read the same.

**CRATER** is the hole the burst leaves. What a shell used to do to the ground was paint a
stain on it, and a stain is exactly as deep as the ground was before, so the row measures
the DEPTH the ground actually lost against the depth the carve asked it for: a mortar bomb
takes 5.8 units out and throws a 3.3 lip, a 210 takes 13.4 and throws 7.4, and `lost`
equals `asked` to the tenth on every row. Plus the cover that appeared where there was
none, that the hole is still ground a section can walk into, the merge rule (twelve rounds
into one place make one hole and not twelve), what a forty-round mission costs, and the two
refusals.

**COST** is the packer. Six bursts in the air at once is 144 effects, 228 quads, 0.17 ms to
pack and two draw calls; it was one draw call per particle.

Two things about writing a drill for it. **A screen point out of `w2s` is in CSS pixels
with y down and `readPixels` is in device pixels with y up**, and getting either wrong puts
the window somewhere else in the frame and the row reads a clean nought, which looks
exactly like an effect that is not drawn. And **stage the target inside the FIRER's reach
rather than the stage point's**: written the other way about, the two 165-reach engineer
sections were put down at 175 and fired nothing at all, and the row read as a weapon with
no muzzle flash.

### `tools/mapcheck.mjs` - the map, mechanically

A hand-placed map is a few hundred coordinates and the eye will not hold them. Craters
swallow trenches, wire runs through a bowl it should stop at, a house stands on an olive
tree, a lane is drawn as a nice curve straight through a block, and two buildings leave a
slot between them too narrow to walk down and too wide to read as a party wall. None of
it shows in a screenshot taken from the angle you happened to choose, and all of it shows
the moment a section has to walk through it. The first hand-placed draft had a hundred
and sixty-four conflicts in it and looked fine.

```sh
node tools/mapcheck.mjs          # every rule, on every map the game ships
node tools/mapcheck.mjs gothic   # one of them
node tools/mapcheck.mjs --v      # list every conflict rather than the first few
```

The rules are things that cannot be true of real ground: a crater does not sit on a
trench, wire is not laid across a bowl or a parapet, nothing stands inside a building, a
street does not run through one, and two buildings either share a wall or leave room to
walk between them. Plus two about streets -- nothing thread-width, and nothing that runs
the length of the map without a junction. A bunker is a building for every one of them,
and its footprint is derived rather than stored, so `bunkerBox` hands the same rectangle
to the game, the editor and the check. It is in `npm run verify`.

**A weapon pit is checked as an earthwork**, because the day it started going through
`carve` it became one. It was not, and two things fell out of that on maps that had read
clean for months: on the Gothic Line one pit's spoil stood 4.32 units up in the floor of a
trench 32 units away and another's bowl reached 4.4 units into one, and on Ortona a pit
stood inside the ruin at (1560, 610) -- which is why its centre had been unwalkable for as
long as it had existed -- with another undercutting a building corner by four units. Five
pits moved and both maps come back clean.

**Its radius is the BOWL and not the outer edge of the spoil**, and that is the part worth
knowing before touching it. The lip falls off as the SQUARE of the distance across its
band, so its outer half is under a unit high: taken at the geometric edge (`r + 25`) the
rule flagged five placements whose real effect on a trench was 0.11 of a unit or nothing at
all, which is a rule nobody can act on and would have had a map author moving pits for
nothing. Calibrated against what each pit actually puts on a trench -- measured per pit,
not argued about -- `r + 8` separates the two that matter from the ones that do not. Its
margin is the trench's own half-width rather than the crater's 16, because the trench is
the thing being undercut, so each entry in `digs` carries its own.

**It checks every shipped map rather than only the first**, because a rule nobody runs on
the second map is a rule the second map does not have. Pointed at the Gothic Line the
first time, it found seven faults nobody had seen in a week of photographs: six shell
holes undercutting the two farms, two outbuildings overlapping their own farmhouses, the
centre and south crossings running straight through the bunkers that cover them, the
lateral and the sunken lane each running sixteen hundred units without a junction, and
the south trench clipping the corner of its own bunker. The one worth keeping is the
craters: the scatter rejects against everything already dug, so anything laid AFTER it is
laid on top of it, and the farms were written below the shell holes in the file.

### `tools/lint.mjs` - the rules, mechanically

Checks what a screenshot cannot: that the script still parses, that the file is
still self-contained (no external `<script src>`, stylesheet, image, `fetch`,
`import` or remote URL), that the code is still ES5 (no arrow functions,
`let`/`const`, template literals, classes, spread, optional chaining), that
indentation is spaces with no trailing whitespace, and that the file stays
under 1745 kB (it was 1040 before vehicles carried a hand-laid interior, 1345 before a
battle wrote itself down, 1460 before a second map, 1520 before a building could be
knocked down, 1595 before bodies and wrecks, 1640 before a bunker could be fitted out,
1655 before the second control scheme, 1690 before the brain's second layer of inputs,
and 1720 before the arms had a doctrine). Takes under a second. Exits
non-zero on any violation. The ceiling is a budget rather than a limit and the reason for
each step is written beside it in the file: raise it deliberately, with a reason, or not
at all.

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

**It fights on the second map as well as building it**, because every other row deploys
on Ortona and a map that boots and is never played is a map nobody has run the game on.
That row is also where the Gothic Line's fairness is measured rather than asserted: 454
entities on each half with none unpaired, the ground disagreeing with its own reflection
by at most 0.23 of a unit over 1,750 samples, no flag further from one headquarters than
its twin is from the other, and 1,304 units between the bunker lines.

```sh
node tools/check.mjs                  # desktop + phone, 180s of battle
node tools/check.mjs --device=phone   # one device
node tools/check.mjs --sim=1200       # long battle, watches for late throws
node tools/check.mjs --shots          # also leave PNGs in shots/check/
```

Run this before calling any change done. It takes about 20 seconds per device.
`npm run verify` runs the linter and this together.

**And it drives both control schemes on both devices.** The simple rows switch the scheme
without storing it, measure the chrome (a strip of what he can build that agrees with
`simpleItems` to the key, the line saying what the army is doing, LOOK and PAUSE and
nothing else, the little map, the bar gone, nothing under 44px, off screen or lying over
anything else), and then run the brain on his slot for a minute and read it off the field:
a plan at veteran, every fighting unit with a job and something under orders, and not one
kind raised nor one building put up out of his till while the opposition went on buying.
Then the strip is tapped -- the post has to go down beside the headquarters with an
engineer on it for its price, a section into the queue for its, and the same button dimmed
and refused with the till emptied -- and the flags are tapped as TouchEvents at the canvas:
ATTACK on a flag that is not his has to become the wave's objective with sections dealt to
it, HOLD on one of his and FEINT on another of theirs have to raise directed operations
with men on them, the popup on the held flag has to show HOLD lit with a CLEAR beside it,
and CLEAR has to take the directive off and the review drop the operation. LOOK with
nothing picked has to look from a unit of his, a tap on a unit has to pick it and order
nothing, and a tap on the ground has to let go. Then everything the rows raised comes down
and the classic scheme is put back and asked the same of a tap and a drag, because a
scheme kept as an option is a scheme nobody runs. The drills want open ground, and
`__clearPt` finds it clear of every ring of his by more than the pick and clear of any flag
-- the first version asked `nearestOwn` at a hundred units, which is not the pick, and
found no ground at all on the spawn. And the flag row hides the enemy from his side and
empties his call board for its two ticks, because a section raised beside the headquarters
with a tank in front of it calls for help and is dealt to nobody's operation, which is the
brain being right about the wrong thing: on one desktop run the enemy was at the
headquarters when the row ran, and both directed operations were raised with nobody on
them out of ten fighters.

**And two rows read the framebuffer rather than looking at it.** An effect that is drawn
and invisible looks exactly like an effect that is not drawn, so the effects rows render
the same scene twice, once with the thing and once without, and count the pixels that
moved: every gun on the roster fires once and none of them may put nothing on the screen,
the biggest blast has to light many times the pixels of the smallest, a round laid across a
house has to be hidden by it from one side and not the other, and a heavy shell has to
still be on the screen a second and a half after it lands. The column's floor is what a
PHONE has to clear, because a phone spawns four puffs of it rather than eleven.

**And one row RENDERS the roster and reads it as numbers**, because a sound is the one
thing here a screenshot cannot review at all and an ear is not available to a gate. Every
shell weapon has to put something on the bus, since a report that is built and inaudible
looks exactly like one that is not built; the roster has to be differentiated rather than
merely loud, which is the muzzle row's `spread` asked of the ear; the three artillery
shapes have to be three lengths, a tube ringing for half a second where a battery rings
for a second and a half; and the six pieces have to be six sounds. That last one is the
fine comparison and it is measured against ITS OWN first piece rendered twice: every
layer of every report is jittered per shot, so a ratio with no floor under it says
nothing, and the floor is not the same for a mortar as for a tank gun. The row keeps only
the metrics that separate a pair by an amount worth having and reports whichever of those
is measured most reliably: choosing on signal-to-noise alone picks the smallest floor and
once reported the two mortars 1.07x apart in length, which is inaudible, while choosing
the biggest difference alone picks a metric that may be measured badly.

Over three runs on both devices -- six samples of each pair -- it reads 15 to 104 to one on
the mortars, 15 to 136 on the pack howitzers and 8 to 66 on the heavy batteries, against a
bar of three. The heavy pair is the loose one and the reason is its floor rather than its
difference: a report whose tail runs a second and a half is harder to measure twice the
same way, so twelve takes put its floor anywhere from 1.00x to 1.06x while its difference
sits steadily at 1.21x to 1.27x. That is the number to raise the take count against if the
row ever flakes, and the row prints the metric and the floor it chose so one run says
which it was. Level is rms and never peak, because the bus ends in a compressor.
Brightness is the rms of the first difference over the rms of the signal, which rises and
falls with the spectral centroid and needs no transform, because what is wanted is an
ORDER and not a hertz.

**And a mortar's mission is counted by ear as well as by where the bombs land**: ten tube
reports, ten incoming and ten bursts for ten bombs, with the incoming inside the beaten
zone rather than back at the tube. An indirect round used to make no sound at all between
the tube and the ground, and the shape of that fault is the same as the fog of war having
no live tier -- everything about it reads as working from the outside.

**And one row asks whether a shell leaves a hole or a stain.** They are the same picture
from above -- a dark patch on the ground -- so the row asks the two questions a photograph
of a dark patch cannot tell apart: did the SURFACE move, and did the picture of it move
with it. It digs rather than explodes, because an explosion also paints a scorch and the
scorch is the stain the row exists to tell apart from a hole; then it reads the frame
before and after against a control of two identical frames, which is nought. A 47.6-unit
hole moves 1.2 million pixels of a 1.44 million pixel frame. It also checks the height is
still the sum of its own layers over the whole grid, which is what `levelPad` broke.

**And two rows ask what a photograph cannot tell apart.** Two sections crossing paths are
walked past each other at three lateral offsets where their formation BOXES overlap and no
two men come near touching: the crossing has to cost about what walking alone costs, no
frame of it may make ground backwards, and then four pairs spawned inside one another have
to come apart with no man of either inside the other's footprint. Both halves are there
because either alone is satisfied by a fix that breaks the other. And a weapon pit has to
be a hole: the floor-to-crest relief of every pit the map ships, against a control taken
over the same span of open ground beside it, which is the natural roll of the country and
stays flat whatever the carve does -- with the refusal that matters, which is that a pit a
crew cannot stand in is worse than no pit. The control skips a point that has anything dug
in it, because three battles have been fought on the map by the time the row runs and a
shell hole read as the control says the country is as broken as the pit.

**And the destruction rows load Ortona to run on**, because a terrace is what they are
about and the Gothic Line is a valley floor with two farms on it. They shell an isolated
house flat with a battery and ask the SAME CELL the same questions before and after -- can
a man walk here, does it stop an eye, does it stop a round, is it rubble, may a section
hold it -- because a house knocked flat that still stops a boot and still stops an eye is
the one fault here a screenshot would call a success. The second row counts the stone: what
settles has to be what came out of the walls, since masonry that vanishes on landing is a
collapse nobody can stand in.

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
`infantry` `armour` `models` `lineup` `buildings` `smoke` `free`.

Devices: `desktop` (1600x900) `laptop` (1280x800) `wide` (1920x1080)
`veh` (900x620, for the tight edit-render-look loop on a model)
`phone` (iPhone 14 Pro Max, dpr 3) `phonefast` (same box at dpr 1, ~9x fewer
pixels, for layout-only checks) `phoneland` `phonemin` (375x667) `tablet`.

Useful flags: `--sim=<game seconds>` `--side=us|ger` `--diff=0|1|2`
`--bare` (hide all 2D UI, leaving only the 3D) `--turn` (four yaw angles)
`--dist=` `--pitch=` (override gallery framing) `--nofog` `--tag=<suffix>`
`--settle=<frames>` `--cam=x,y,dist,yaw,pitch` `--ctrl=simple|classic` (the control
scheme, whatever the device would pick; `hud` then photographs the flag's popup as well).

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
- **`openGame(browser, device, { file })`** takes the file to open, and forgetting it is
  silent: both halves of a before-and-after comparison then load the working file and
  come back identical, which reads as "the change did nothing" rather than as a broken
  probe. It happened twice in one afternoon. If two runs agree to the last digit, check
  that argument before believing them.
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
(`defaultMapData()` is Ortona and `gothicMapData()` the Gothic Line; `MAPS` is the table
the title screen, the deploy button, the briefing and the editor's load panel all read).
A separate 4-unit heightfield (`makeHeight`, `groundZ`, `groundNormal`) carries
elevation, with trenches and craters cut in by `carve`.

**The country a map stands in is a property of the map.** It was not: Ortona's landform
was the only landform there was. The coast, the cliff with its bedding, the valloni, the
railway in its cutting and two hard-coded depot coordinates were written into
`makeHeight` and into the tail of `buildMap`, so a map of anywhere at all came out with
the Adriatic along the top of it and a railway along the bottom.

`LAND` is what sort of country the ground is, and a map names one in `data.land`. It
carries the landform builder, where the coast and the railway run, the watercourses, how
much level ground each army is given to deploy onto and in what shape, and -- for a map
that wants them -- how wet the ground is and how far it has been churned. **A landlocked
country still answers `coastY` and `railY`**, with a shore far above the map and a line
far below it, because a dozen things here ask how near the sea a point is and the honest
answer for inland ground is 'further off than anything'. Gating each of them on its own
is a dozen places to forget one.

The deploy pad is a SHAPE rather than a radius (`padR`, `padY`, `depotDist`). A 1v1 wants
a circle round one headquarters; a 2v2 stands two of them 580 apart along the line and
wants a band that holds both. And `DEPOT` comes off the map's own `hq` entities rather
than off two coordinates that happened to match Ortona's.

**The Gothic Line.** The Adriatic sector at the end of August 1944: the Foglia with a
ridge either side, which is 1st Canadian Corps ground. What is built is that country and
not that battle -- the real line had one army on the high ground and the other down in
the river, and a map two people are meant to fight over cannot be. So the valley goes
down the middle with a ridge either side, each side holds one, and this is ground the
line has already been fought over and turned on.

Read from a base out at the edge toward the river: a shelf flat enough to assemble an
army on, the back of a ridge, the crest it forms up behind, the forward slope it has to
fight down, and the water at the bottom. Read north to south: the ridges stand highest
where they run up into the shoulder at the top of the map and die away into water meadow
at the bottom, so one flank is broken going and the other is open. Both teams get both,
because the map is mirrored about the midline and not about that.

**Every term is a function of the distance out from the midline and of y, the relief
included**: the sample point is folded about the midline before the noise is asked, so
the two halves are identical and not merely similar. Measured over 1,750 samples the
ground disagrees with its own reflection by at most 0.23 of a unit, which is the
smoothing pass and float rounding. Ortona does not fold and does not need to: its two
halves are a town with a headquarters at either end. Here the ground itself is what two
armies are being asked to fight over on equal terms, so it is measured rather than
eyeballed, and the gate measures it.

**There are three ways over the river and each is a victory sector**, so the whole map is
a question about which crossing to force. The roads were there before the line was and
run right across. On each forward slope: three bunkers, one on each crossing, with the
fire trench run BETWEEN them rather than through them, because the concrete is the line
where it stands and a trench dug across its front is a trench its own garrison is firing
over. The wire is close in under the bunkers and cut only by the defender's own lanes on
the three roads; the hedgehogs are out on the floor and their gaps ARE the three
crossings, which is the design of the map. An obstacle belt does not stop armour, it
tells armour where to go, and where it goes is into a bunker's arc.

**The bunker lines are 1,304 units apart, and that took two goes.** At the first spacing
the crest sat five hundred units out and the lines were eight hundred apart: a section
sent across the middle was at the far concrete before it had done anything. Widening it
then bought the opposite problem, because eight hundred units of level ground between the
belts is a car park -- a section ordered across walks in a straight line at a constant
speed and arrives or does not, and nothing in between is a decision.

What fixes that is SHAPE before it is clutter. Fourteen hand-placed brushes of dead
ground and low spur across the floor and two on the forward slope, so there is somewhere
to lie up short of the wire and somewhere to form up behind; then the enclosures, the
outpost line, the scrapes an attack dug when it was stopped, the weapon pits, the sunken
lane cut into the heightfield with its banks revetted, and half again as many shell
holes. On the ground between the belts: 62 wall runs, 244 craters, 56 trench legs and 788
pieces of cover. **Dead ground is the first thing to reach for when a battlefield reads
as too open**, and it costs nothing to look at; the first attempt reached for walls
instead and came out a maze.

**Movement.** A 20-unit occupancy grid (`grid`, `rebuildGrid`, `walkable`) with
A* in `findPath`. Squads are several models moving in formation around one unit
position; `updateModels` animates the individual soldiers. `tools/move.mjs` is the card
for all of it.

**The cell has to be small enough to hold the ground it stands for**, and at forty units
it was not. A building is marked by every cell its footprint touches, plus a pad, so the
Corso -- the widest street in Ortona, a hundred and ten units across -- came out one cell
wide, which is narrower than a Sherman; a sixty-unit lane came out as masonry; and thirty
per cent of the open ground in the town, eight per cent of it with room for a whole
section, was not on the map the pathfinder reads at all. At twenty units it costs four
times the cells (13,300 of them, a few hundred kilobytes and about a millisecond to
rebuild) and the lanes come back: the route across the town's grain fell from 991 units
to 840 and its detour from 1.37 to 1.16, and the share of that drive spent on the
metalling went from 0.58 to 0.98.

A rebuild at four times the cells cost four times as much, and it happens every time a
building goes up or a vehicle burns. Most of it was four `groundZ` samples a cell to find
the sea and the cliffs, and the shape of the ground does not change during a battle: it
is kept in `terrg` and `makeTerrain` is the only thing that throws it away, which puts a
rebuild back to 0.8 ms from 3.2 -- about what it cost at forty units to the cell.

**What is marked on it has a width.** A street is forty-eight units of metalling, a wire
apron thirty-four, a garden wall six of dry stone; `markSeg` took none of that and marked
one cell, so all three were whatever the cell happened to be -- the road narrower than the
lorries on it and the wall wider than the gap beside it. Sight and fire are marked the
same way, so the same call fixed a garden wall blocking a forty-unit swathe of view.

The grid says where a thing can go; `cellCost` says where it would want to, per
`pathKind`: tracks pay 1.35 off the metalled streets and wheels 1.5, both more on a bank
(`steep`), and men on foot pay 2.6 to cross wire and a little for a bank. A tank sent
across the town used to cut straight over the gardens at two thirds pace with the Corso
fifty units to its left. And it charges for the beaten zone when the thing crossing minds
it (`DANG`, `u.fear`) -- see the AI section, because what is dangerous is a thing only the
brain knows.

**And how much room it leaves.** `buildRoom` chamfers the grid into `roomg`, the distance
in cells to the nearest thing that stops a boot, which `cellCost` charges for: a gap is
dear in proportion to how hard it is to get through, and a lorry minds it about three
times as much as a man. Nothing is forbidden, because ground nothing may cross is ground
the army stops using -- the tight way is dear rather than closed, and when it is the only
way it is still taken. This is what keeps a hull out of the masonry: the search runs cell
centre to cell centre, which is honest, and the smoother then replaces a run of them with
one line and only asked whether the middle of that line was clear, so it cut every corner
to the wall. Priced instead, the shortcut that scrapes is weighed against the one that
does not, and `lineCost` samples every ten units to see it.

**A clear line is not the same as a good line.** Men on foot were handed any clear line
at all, however long and whatever it ran through, so every cost the pathfinder charges a
section -- wire, a bank, a field wall, a gap it has to squeeze down -- applied only to the
routes it happened to search for. A section ordered across a wire apron with a gate a
hundred units to its left walked into the wire. The line is priced now and taken only
when it costs no more than the open ground it is drawn across; one `lineCost` is cheaper
than the search it usually saves, and the battle probe came back with fewer searches
rather than more, because the paths hold better once they are worth holding.

**A step that makes no ground is blocked, however far it moves.** The stall detector
measured displacement, and a unit pressed against a house slides along it at very nearly
full speed: a section creeping sideways down a frontage read as a section making
excellent progress, never tripped the timer, never asked for another way round, and went
on grinding along the wall for as long as the order stood. A probe that put wrecks on the
grid to make the blockages worse caught it at fourteen per cent of the frames an
attacking section spent with a path in hand; on the card against the last commit it is
about one per cent, and none. What is measured is the ground made good toward the
waypoint (`u.lastGap`). Once blocked it tries the step swung off the line, the way a man
shoulders round a doorway full of the section in front; then it asks for another way to
where it was going, and not to the next waypoint, which threw the rest of the route away
and left the section treating the corner it had reached as the order carried out; and on
the second failure it gives the waypoint up rather than asking for it again every half
second until the battle ends (`u.blockN`).

**The queue was not a queue.** `findPath`'s heap compared `_f[heap[i]]` live while the
relaxation lowered `_f` of nodes already sitting in it, so eighty-nine per cent of pops
on this map returned something that was not the smallest thing in the heap. It carries
the key it was pushed with now, and a re-found node is pushed again. Worth knowing: it
bought nothing. Forty long searches across the map came back at 1.64 ms, 4.9 legs and the
same cost, before and after, because a weighted heuristic on a map this size finds the
same routes with the queue in any order. It is in because the next person to touch the
heuristic or the cost model would be building on a queue that does not order.

**There may be no way there at all.** A failed search used to hand back a straight line to
the destination, which is a lie no caller can see through. It now walks the unit to the
nearest cell the search actually reached and marks the path `noWay`. A unit standing on
ground that has stopped being ground -- a company post raised on top of it, a wreck
settled across it -- walks out to the nearest ground it can stand on rather than failing
every step it tries.

**A unit's body is the shape it is drawn as.** Every collision in the game was one
isotropic circle on two markers, and `unitRadius` is that circle: half a vehicle's LENGTH,
bucketed off its HIT POINTS. A hull is twice as long as it is wide, so a circle that holds
the nose holds a metre and a half of open ground either side of the tracks with it -- over
the roster the body ran 2.0 to 2.8 times the hull's own half-beam -- and because the
buckets key off `hp`, moving a Stuart from 480 to 510 would have jumped its collision
radius by 28 per cent with no vertex moved. Measured over eight bearings, a rifle section
walking past a Sherman was held off with eleven units of daylight between the models on
one and stood nine units inside the hull on another: a spread of 20.7 units, which is
wider than the tank. Both halves of that are what a player sees and neither shows in a
photograph, because a tank stopping short and a tank standing in a man are the same
picture from above.

`unitBody(u)` is the fix and everything about it is MEASURED. A vehicle's half-length and
half-beam come off the model's own faces the way `tools/dims.mjs` reads a published
dimension, so a plate that moves moves the body with it and there is no second list to go
out of step; the mount is left out, since a gun barrel is not a body anybody walks into. A
section's come off the offsets it was actually dealt, plus `MAN_R` -- the eleven units
`hitsUnit` already picks a man by -- so the body a tank is kept out of is the body the
player's own finger goes through.

**`sepDepth` is the four-axis separating test on two boxes**, and the shallowest overlap
is the depth and its axis the way out, which is what a box does: it puts a thing out the
near side rather than away from a centre. A capsule was tried first and is the wrong shape
for both of these -- three files of two is a block, and the capsule that holds its corners
stands four to eleven units proud of its flanks, so the gap at contact still wandered by
six units over bearing with nothing on screen to say why.

**And a hull is tested against the MEN.** A section's box has empty corners by
construction, so a tank coming in at forty-five degrees stopped seventeen units short of
the nearest soldier. `menPen` walks the living men against the hull's own rectangle, which
is exact, and it is the first thing in this file ever to ask where a man is standing before
deciding whether a tank had run into his section. Over eight bearings the gap between a
Sherman and a rifle section is 0.0 to 0.1 units, and between two Shermans 0.1 to 0.2,
against a spread of 20.7 and 21.3 before.

**And a section against a section is the MEN for the PASSING question and the box for the
RESTING one**, which sounds like a hedge and is arithmetic. A section's body is the
bounding box of its whole formation -- 106 by 66 for five riflemen, nearly three times the
plan area of a Sherman -- laid over three files of 11-unit discs with air between them and
nobody at all at the four corners. Two sections crossing at an offset where the boxes
touch and no two men come near each other were shoved apart for the length of the
crossing: measured on a staged pass, a walk that takes 7.5 seconds alone took 15.7 at a
lateral offset of 20, 17.2 at 30, 18.9 at 40 and 21.1 at 50, with five or six units of
clear ground between the nearest two men the whole way. That is the complaint word for
word, which is stuck moving past one another with daylight between every model.

The reason it is not simply the men everywhere is that a formation is a REGULAR LATTICE.
For any man-to-man reach there is an offset that slots one section's men into the other's
gaps, and raising the reach moves the hole rather than closing it: at 22 two weapon teams
interleave at 22.0 units apart, at 26 they interleave at 26.0, at 30 at 30.0 and at 42 at
42.0. Men against men can therefore never keep two formations from resting inside one
another, which is the one thing `unwedge` exists to prevent -- tried anyway, it took merged
pair-frames from 0.128 per cent of a battle to 0.431, three and a half times worse. So
`sepDepth(u, o, fine)` takes a flag: `moveUnit` asks the fine question and gets `menMen`,
one man-disc against another at `MAN_R * 2`; `unwedge` asks the coarse one and gets the box
it always got.

**And `bothAfoot` is what decides which pair is which, off `cat` rather than off a speed.**
A crew-served weapon is not a body of men on the march: what a section walks round is the
GUN, and the men are laid out on a ring round it with gaps far wider than a man. The first
version tested `def.speed > 0`, which is a different question -- only three pieces on the
roster have no speed (the eighty-eight and the two heavy batteries) and every other crew
can be manhandled or limbered, so a six-pounder at 40 and a Pak at 38 read as men on the
march and a rifle section closed to 33.9 units of a deployed Pak's gun point where the box
had held it at 48.9. `cat` is the roster's own word for it: 'inf' is the eleven sections
and 'team' is every machine gun, mortar, anti-tank gun, howitzer and battery on both sides,
and it excludes a vehicle for free. The cheap circle in front of both is sized off `selRadius` on the fine path,
because that is the ring `updateModels` actually clamps a man onto and it is wider than
`bodyL`.

Measured on the same pass, the twelve rows where a contact happens go from 7.7 to 21.1
seconds down to 7.3 to 8.1 against solo controls of 7.23 and 7.47, the clear ground between
the nearest men at the three worst offsets goes from about 5.5 units to 18 to 22, and the
frames that make ground BACKWARDS go to none. The rows where the boxes never met are
bit-for-bit identical before and after, which is the control saying the change touches only
the rows where there was a contact, and the four resting drills -- two sections spawned at
the offsets a pure man-to-man reach would weld -- are identical too, at 32.7 to 66.4 units
apart with not one man of either inside the other's footprint.

**Units are obstacles.** `unwedge` is the push, and it lives outside `moveUnit` because
`moveUnit` returns on its first line when there is nowhere to go: the only thing that had
ever pushed units apart was a steering hint inside the movement code, so a halted section
had nothing to push it off another halted section. A diagnostic that bucketed the
overlaps found nearly all of them in that one bucket -- two halted friendly sections
standing inside each other, drawn as one clump of men, firing as two and taking one shell
between them. It is a step rather than a hint, bounded by what a man walks in the time,
and the heavier thing gives way less. On the card it took wedging from 2.7 per cent of
every unit-frame to none.

**And for a long time neither of those last two things was true.** The push kept a depth
weight and a mass factor and then NORMALISED the sum to a unit vector three lines later,
which cancels both exactly. What survived was `min(u.speed * .5, 40)` -- the PUSHED unit's
own speed -- so a Sherman backed away from a rifle section faster than the section backed
away from the Sherman, the precise inverse of the sentence above it; and a pair overlapping
by a tenth of a unit came apart at the same rate as a pair standing on the same spot, with
the rate falling to nothing the instant they cleared. A step at the boundary is a limit
cycle waiting for the pathfinder to pull the unit straight back into it. It is a spring
priced on the depth now, with the give taken from the two bodies (a vehicle's plan area
against a section's men, derived rather than tabled), so a crowd eases apart and settles.

**And the push may not out-run the walk it is applied to.** The cap was a flat 60 units a
second against a rifle section's 64, so the moment anything cut the walk -- 0.5 suppressed,
0.4 in wire, 0.5 on rubble, 0.55 crossing a field wall -- the shove beat the step and the
section went backwards. Counted over three battles of three minutes, on the unit-frames
where a unit held a path and the push fired at all (31.5 to 36.2 per cent of them), the
push opposed the walk on 88.2 to 90.8, was bigger than the walk on 22.6 to 40.9, and drove
net motion BACKWARDS on 17.2 to 30.0. That is the rubber band: a unit walking forward and
being shoved back further than it walked, every frame, for as long as the contact lasts.

Half of what the walk actually made good is the bound now, so a moving unit always nets
forward, with a floor of 22 for a halted one because unsticking two sections standing in
each other is the whole reason this exists. The step is read off the unit
(`u.stepX`/`u.stepY`, written at the top of `moveUnit`) rather than out of a local at the
foot of it: six early returns sit above that line, and a bound that goes stale is a halted
frame reading the last frame that moved. The same three battles read 0 to 0.4 per cent
bigger than the walk and 0 to 0.2 backwards, and the push fires on half as many frames
(16.6 to 20.6 against 31.5 to 36.2), which is the men-test declaring the contacts that
were never contacts.

**What the two together are worth on the movement card**, over three runs of `--base` on
the commit before them: unit-frames with a path and four seconds of no progress went from
4.33, 22.1 and 15.6 per cent to 0.10, none and none; two models overlapping from 2.06,
2.31 and 2.66 to 1.33, 0.29 and 0.96; and unit-frames with a path in hand from 32.1, 34.7
and 33.9 to 23.3, 25.3 and 25.7, which is a third less searching because the paths hold
once nothing is shoving the unit off them.

And read `in cover` on that card over more than one run before believing it. The first
comparison had it 60.5 against 66.7 and it reads as six points of cover given away; three
runs put it at 60.5, 73.1 and 61.6 against 66.7, 62.3 and 70.2, which is a spread of
twelve and eight points a side and a difference of one and a third between the means. The
staged COVER drill, which is the one that is not a battle, reads 0.60 taken over available
on both. A battle here compounds, so a single run of a battle statistic is worth about as
much as a single pair on the tactics card.

**Avoidance steers; it does not push back down the line.** The same fault ran in
`moveUnit`: the avoid vector was blended into the want vector and the sum renormalised, so
a unit pressed head-on was left with a residual of a tenth whose DIRECTION was whatever
survived the near-cancellation, and that tenth was scaled straight back up to full speed.
It darted about at full pace on a bearing that flipped every frame while `unwedge` shoved
it the other way inside the same frame. One section walking past one parked Sherman
reversed on itself **198 times** in a fourteen-second walk. The push is split by what each
half of it is for now: the part ACROSS the line steers, the part ALONG it brakes, and
nothing reverses a unit that is trying to go forwards.

Two more things were needed before that settled. **Which side to go round is decided once
and held** (`u.avoidS`, 1.4 seconds), because decided afresh every frame it swaps the
instant the geometry crosses over and the section grinds along the flank of the thing for
the whole order -- 57 reversals, and it never arrived. And **the swerve is eased in and
out** (`u.avoidM`) rather than switched, because applied on the frame a contact appears and
dropped on the frame it clears the wanted bearing jumps sixty degrees and back every few
frames, which costs nothing while a heading is decoration and comes out as a tank spinning
on the spot once a hull drives on its own nose.

On the motion drills, that section walking past a tank went from 198 reversals, a jerk of
0.212 and 14.5 seconds for a 400-unit walk to **none, 0.0163 and 9.2 seconds** -- against
0.0113 on clean open ground, so the rise from meeting a tank is 1.4x rather than 19x. A
Sherman driving through three sections went from a jerk of 0.0711 and 200 units of drift to
0.0233 and 18.

**A burnt-out hull is in the way.** `killUnit` puts a wreck on the movement grid as well
as adding it as cover, so a lane blocked by a burning Panzer is blocked. It stops a boot
and not an eye: a man sees and shoots over a dead tank.

**A field wall is three things to three ways of travelling.** Tracks go over it and
flatten it, a man gets over it but not at a walk, and a lorry goes round. It was none of
them: absent from the movement grid entirely, so everything crossed a foot of dry stone
as though it were painted on. `wallg` prices it -- 1.9 to a section, nothing at all to
tracks, two and a half times to wheels -- and a man crossing one is at a little over half
pace, the way wire already worked. Priced and not blocked, because a wall nothing may
cross fences off the gardens of half the town; blocking them outright was tried and cost
2.3 per cent of the free ground for no change to any route worth the name.

**And a wall has a HEIGHT, which is the one number that says what kind of wall it is.**
Ortona's are town garden walls at 24, over a man's head -- his eye is at 17 -- so he
stands against one and cannot see or shoot through it. A dry-stone field boundary is 11,
which is his chest: he gets down behind it and comes up over it. So a wall under 16 is on
the going grid and the cover index and on NEITHER of the two grids that block, which is
both truer and the whole of why the Gothic Line's floor stopped reading as a bombed city.
Drawn at 24 out in open country a field wall reads as a prefabricated barrier and enough
of them read as a maze, which is exactly what the first pass at its enclosures came out
as.

**And it is stacked rather than extruded.** A town garden wall is a built thing --
rendered, coursed, standing plumb -- and a run of identical 34-unit boxes is a fair
drawing of one. A dry-stone field boundary is not, and in a valley shelled for a
fortnight it is down in places. Drawn the same way, every enclosure on the Gothic Line
came out as a ruled pale line two hundred units long with a level top, which was the one
thing left in the frame that read as placed by a program rather than fought over. A wall
under 16 is laid stone by stone instead: the heights wander, the depths wander, the line
wanders off its own axis by a foot, the colour is picked per stone out of the registered
stone shades, and one course in eight is down to a tumble. Stepped rather than divided,
because a fixed division reads as a row of identical blocks however much the heights
wander. It costs four per cent of the prop scene (573,936 triangles to 596,640) with the
all-tile rebuild unchanged, and Ortona reads 677,630 either way to the triangle, because
every wall in the town is 24 and takes the path it always took. Nothing about the cover,
the movement grid or the sight line moves: those come off `G.walls`, which is the
straight line it always was.

**A man gets over a field wall; he does not stand in one.** It is on neither blocking
grid by design and it is not in `G.props` either, so nothing that asks whether a man may
STAND somewhere knew it was there at all. The movement card put it at 2.72 per cent of
every man-frame of a battle on the Gothic Line against Ortona's 0.23, and a probe that
split the hits by whether the unit was moving said what it was: 992 of 1161 were HALTED
men standing inside a field wall -- men at a stop, drawn in the stones and getting
nothing from them. The cover slots were already right, standing a man ten units off a
`lowwall`'s own line; it was the FORMATION that walked through, because its test for a
place is `walkable`. `inMasonry` is the geometric question, bucketed at 120 units so it
is a handful of boxes, rebuilt with the wall list, and skipping a town wall outright
because that one is already solid. Four callers: `slotClear`, the formation's own place,
its search for a clear one, and the clamp onto the unit's ring. Men in walls went 2.72
per cent to 0.14 and halted men behind something 43.9 to 54.8, because a man who was in
the masonry now stands beside it.

**And the other way about from wire: a hedgehog holds a tank up and lets a man walk
between.** A Czech hedgehog is three lengths of angle iron welded through each other at
their centres, which makes a star that stands on three points whichever way up it lands;
it cannot be pushed flat and what it fouls is a belly rather than a track. A dragon's
tooth is a metre of concrete laid in ranks that step up toward the enemy, so a hull that
climbs the first rank grounds itself on the second. `hogg` is the grid for both: free to
anything on foot and twelve times over to anything driving, and a hull that takes the
belt anyway because it was the only way through is over it at a third of its pace. Dear
rather than closed, like everything else in this cost model.

**And wire a MAP laid did nothing at all.** Wire an engineer put up was marked on `wireg`
and held men up; `G.wire` was drawn and marked on no grid anywhere, so an apron
hand-placed across an approach was painted on. That is the fault the field walls had, it
reads identically from a photograph, and it had been there for as long as the entity had.
Measured on one cell with the mark and without it -- which is the only way to read the
effect off ground that is also steep and also near something -- a man pays 2.08 times on
wire where a tank pays 1, and on a hedgehog a man pays 1 where tracks and wheels pay 12.
Asked to cross at the same place, a section goes straight through the belt and a Sherman
goes round the end of it.

**Weight turns a hull.** Every vehicle in the game swung round at the same 2.6 radians a
second, so a Tiger II turned as smartly as a Daimler and there was nothing to be had from
getting behind the heavy thing except the thinner plate. It is 1.5, 2.1 or 2.9 by weight
now, beside the acceleration that was already graded that way.

**And a hull goes where its nose is pointing.** The position was integrated along the
bearing to the next waypoint and `u.facing` appeared nowhere in it, so the heading was
decoration: a tank crabbed sideways and backwards at up to a hundred degrees off its own
front plate, at full speed, while the turn rate and the whole weight model swung a drawing
round afterwards. That is most of what reads as unnatural about armour here, and it is why
the two fixes below could not have worked without it -- a speed that falls away with the
heading error does nothing at all if the vehicle is not travelling on its heading.

**Tracks and wheels do not turn the same way, and until now they turned identically.**
Asked for a hundred and eighty degrees, a Sherman, a Tiger II, a Universal Carrier and a
half-track all came round through the same 3.26 radians and all drove between 53 and 67
units of ground doing it. A tracked vehicle counter-rotates its tracks and turns where it
stands, so its speed falls away with the heading error and is gone by the time the error is
most of a right angle: it pivots, then drives off. A steered axle only bites while the
wheels are rolling, so a half-track or a car keeps its pace through the turn, comes round
in an arc, and turns more slowly the slower it is going. Measured on the about-turn: the
Sherman now holds its ground and turns through 3.15 radians having driven 10 units, and the
Sd.Kfz. 222 arcs through 3.33 having driven 100. `wheeled` is declared on the three defs
that carry a steered axle -- the 222 and the two half-tracks -- rather than tested by key in
two places, which is how `pathKind` and the slope grip came to disagree about which vehicles
those were. The Universal Carrier is tracked, whatever its unit key suggests.

**And the ways round an obstacle are a man's, not a hull's.** When a step is blocked the
code tried each world axis on its own and then swung the step by up to 1.8 radians, which
for a vehicle is the same fault as driving it off its nose: a tank slid sideways at full
speed with no change of heading. A hull gets one swing of 0.6 radians and its front plate
follows it round; the axis slides are infantry's alone.

**The shape of a section is the shape of the ground it is on.** Three files abreast is
right in a field and impossible in a lane a cart would fill: seven per cent of every
man-frame had its place in the formation inside a house. `u.formW` cuts the frontage to
the room there is (`roomAt`) and lengthens the column to take the men, eased over about a
second so a section does not snap between two shapes at every gateway. A man whose place
is still inside something takes the nearest clear place on the section's own axis rather
than falling back onto its point, which put every blocked man in the section on the same
square yard. A man keeps up with the section and runs up if he has fallen behind: his
allowance was a flat quarter over the section's BASE pace, so the faster it went the
further behind he fell, and a quarter never closed a gap opened by walking round a wall
the section walked straight past.
Slots inside something went from 7.1 per cent of man-frames to 2.4, and the mean distance
of a man from his own marker went from 63 units to 92 -- a section holding a wall rather
than a section standing on a dot.

**And the ground itself changes during a battle now.** A shell that lands on open ground
digs a hole in the heightfield (see *The hole a shell leaves*), so `terrg` -- which is
cached precisely because the shape of the ground was a thing that did not change -- is
read again over the hole's own footprint, and `G.gridDirty` carries the rebuild to the top
of the next frame the way a burning hull already did.

Every path carries the `gridStamp` it was found on and is found again when the grid
changes, which it does whenever a building goes up or a vehicle burns. A retreat scatters
its destination behind the headquarters and finishes when it is held up within a few
paces of it, or a dozen retreating sections arrived into each other and the last stood in
the crush for good. Halted with nothing to shoot at, a section turns to face the nearest
known threat (`u.threatAng`, the bearing its cover was chosen against) rather than
standing the way it arrived, and a machine gun is laid on that bearing before it is
needed. A halted tank with a turret brings its hull round to its target as well, slowly,
because the front plate is nearly twice the side.

**A crew-served weapon is in action or it is on the move, and getting between the two
takes time both ways.** It took time one way: `def.setup` was the seconds to bring a piece
into action after a halt, and there was no cost at all to leaving it -- a Pak in action
was ordered off and walked on the instant, the way a rifle section walks. Worse, the setup
was zeroed on the first moving frame and started again only at the END of the path, so a
team on an attack-move that halted short of its path's end because a target had come into
reach fired on the instant with the tripod still on somebody's shoulder. The whole of what
separates a team from a section is that it cannot do that.

`def.pack` is the other half of the clock, declared on the nine pieces that move (a Vickers
or an MG42 at 2.0 s, a mortar at 3.0, a Pak or a six-pounder at 5.0, a pack howitzer at
6.0, the T8 at 4.0 paid to the tow that hitches it) beside a `setup` raised to match (2.5,
3.5, 4.5, 5.0 and 4.0). The eighty-eight and the two batteries carry none, because they
never move. Two fields on the unit carry the state: `u.pack` is the seconds left taking it
down, and `u.packed` is whether it is on the men's backs. In action is `!packed` with the
setup run out. Four rules, and each is one place:

- **A piece in action packs before it goes anywhere**, in `moveUnit`, the moment it wants
  ground: it stands, `u.pack` runs, and it moves when that is done. A step of under a few
  paces is a shuffle and pays nothing; a piece ordered off in the middle of setting up is
  picked up, since a tripod half up is a tripod. `fireAt` refuses it while it is packing,
  packed or setting up, and `barrageTick` drops its mission the same way.
- **Halted, packed and with nowhere to go, a crew puts the gun into action**, in the timer
  block of `updateUnit`. That one rule is what catches an order cleared on the walk, a
  forced attack whose target came into reach, a dismount, a walk out of a house and the
  attack-move above, any of which would otherwise leave the piece limbered for the rest of
  the battle. And a crew half-way through packing a gun that has nowhere to go any more
  puts back what it took down, which is the share of the setup it had undone.
- **A tow waits on the crew.** `hitchGun` starts the pack on a gun in action and the
  vehicle's `moveUnit` returns while `u.tow.pack` runs; the clock is run inside the towed
  block itself, because that block returns before the timers below it are reached, which
  is how the first version hitched the T8 and sat there for the rest of the probe.
- **A retreat packs in half the time**, because a crew running abandons the fine points.

`gunSet` reads `packed` as well, so the model is drawn set while the crew take it down and
limbered once they have, and the overlay says PACKING and SETTING UP over the unit, because
a gun that will not move and will not fire for ten seconds with nothing on screen to say
why reads as a broken gun. `aiSetUp` asks it too: set up means set up, and a wave's support
gate was reading a team's post and never its clocks.

Measured on the gate's own row: a Vickers is in action 2.5 s after spawning; ordered off, it
packs 2.0 s with the gun drawn down the while, moves at 2.1, walks 279 units, halts and is
in action 2.5 s later; on an attack-move it halts packed on a section in sight and fires
2.5 s after halting where it fired on the instant before; and the half-track that hitches
a T8 in action moves 4.2 s after the hook goes on. The row counts the gun's OWN rounds
through `recFired`, because the section shoots back and the shot list carries both sides'
tracers: counted off `G.shots` the first version read the grenadiers' first round as the
Vickers firing through its setup. On the balance card the team rows do not move: nine rows
at eight runs a side against the commit before it, and every one inside the swing the same
row shows between two runs of one file (the machine guns 50 against 38, the Pak against
the Sherman 13 against 25, the six-pounder against the StuG 13 against 0), because a
staged pair is in reach where it stands and a piece that never moves pays only the extra
second or three of setup.

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

**Being seen takes time.** Detection was a yes or a no: in reach, with a clear line, and
the thing was seen, on the instant. So `exposure` -- the whole of what the game had to say
about keeping still, lying flat, holding fire or being in cover -- could only ever move the
RANGE at which that instant happened, and on the card it moved it by seven per cent between
a section standing still and one walking. A file that says this is what makes an ambush an
ambush was describing a seven per cent effect.

It is a rate now. `rate()` inside `computeVisibility` is how fast a side is picking a thing
out, taking the best of its eyes, and `detStep` works `u.detUs`/`u.detGer` up at that rate
and down at a fixed one. Found at 1, lost at 0.42, so a man stepping behind a wall is not
lost on the frame he does it. Everything that ought to make a man hard to find slows the
rate: how exposed he is, how far inside the reach he is, whether the eye is even looking
his way, and what is in the air between them.

    the target is                  150u     260u     360u
    walking, in the open           1.5s       3s    never
    standing still                 2.1s     4.1s    never
    flat on the ground             3.3s     6.7s    never
    at the double                  1.1s     1.6s     4.7s
    firing                         1.3s     2.2s    30.5s
    still, eye looking away        3.7s     7.5s    never
    flat, eye looking away           6s    12.1s    never
    walking, behind smoke          7.3s    14.8s    never

Two things fall out of a rate that a yes-or-no line could never say. **Facing**: `lookGain`
reads `u.facing`, or a vehicle's turret, and an eye looking the other way works at a little
over half speed, so the brain turning its halted men toward the threat it knows about is
finally worth something. And **smoke**: `smokeColumns` and `smokeOn` attenuate along the
line, so a burning hull obscures, which is a slowing rather than a wall.

**Exposure multiplies the rate, not the reach.** Scaling the reach did the same job the
distance falloff already does and did it worse: a section lying flat in a crater got a hard
ring at forty-five per cent of the reach and was literally invisible a unit outside it,
rather than slow to find. Only a loud target still gets reach for it, because a muzzle
flash at nine hundred yards is a muzzle flash. With the rate to scale, movement is worth
what movement is worth: it was twelve per cent, and a man who stops moving is doing the
single most effective thing available to him.

**`traceClear` walks the line cell by cell.** Sampled at `min(40, d/22)` the step grew with
the line -- fifty units at two thousand against a twenty-unit grid -- so a long line could
be stepped clean over a wall. A grid traversal cannot miss a cell at any range and costs
less at short range because it does not oversample. It took blockers stepped over from 1.25
per cent of lines to 0.42, which is the resolution floor of the comparison itself.

**The fog draws three tiers, and they are three different things.** Ground in sight is what
it is; ground walked past is a memory, dim with the colour out of it; ground nobody has
been near is the winter haze with only a ghost of the shape in it. Multiplying by 0.16 kept
every crater and every roof legible in ground the side had never been within half a mile
of. The live circle falls to exactly the byte an explored cell carries, so the rim of what a
section sees runs into what the side remembers rather than stepping down to it, which drew a
hard line round every unit on the map. `fogCircle` rasterises both tiers, because
`markExplored` and `updateFog` had written the aspect correction opposite ways round and
were both only correct because the fog texture happens to be proportional to the world.

**And the player is told what the side last saw.** `CONT` is a contact list per side, noted
in `computeVisibility` while a thing is visible and left where it was when it is lost, drawn
hollow and dashed on the overlay and on the little map, dropped in `killUnit` for a side
that watched him die. Detection being a rate means a thing is lost as well as found, and
until this the unit that was shooting at the player a second ago simply stopped existing.
The brain has had the other half of this since `AIM` was built; the player had nothing.

**A gunner sees as far as his gun reaches.** Every gun-armed vehicle and every anti-tank
gun on this roster was written with a sight shorter than its own weapon -- the Maus by 220
units, the eighty-eight by 170, the Tiger by 125, and every tank on the card by fifty or
more. Under a yes-or-no detection model that only capped the gun at the eye and made the
extra reach decorative, which is why it went unnoticed for so long. With detection a rate
it is worse than decorative: the rate falls away to nothing at the edge of the eye's reach,
so the unit works very slowly at picking anything out at the ranges its gun was built for,
and a pair of tanks staged at the Tiger's own 480 could not see each other at all. The
balance card was quietly fighting eight of its rows in the dark. It is a rule applied to
`UNITS` at load rather than fourteen edited numbers, because two lists of one thing go out
of step the moment somebody adds a weapon to one of them, and because every tool reads
`UNITS[k].sight` and would otherwise disagree with the game. Infantry is left alone: a
rifle section that sees a great deal further than it shoots is correct, and every one of
them already does.

Fought over 43 rows at eight runs each against the same file without the rule: -3.7 points
with a standard error of 3.4, against a row-to-row spread of 22 that eight runs produce out
of nothing. Blind rows went from two to none. The one row that moved far is the one the
rule is for: `us_ach ger_tig` went 100 per cent to 13 because the Tiger could not see at
381 and now can, which is the honest number rather than the flattering one. Whether a
17-pounder Achilles should lose seven of eight to a Tiger head-on on flat ground is a
roster question the card now flags rather than hides.

**What this cost the balance card, and why.** An attack-move walks for as long as it cannot
see, so contact now happens about a hundred units closer than the pair were staged at: a
rifle section opened at 212 against the eighty-eight and was at 130 before either could see
the other, which is inside the gun's own `closeWeak` radius. That row went from 100 per cent
to nil, and `ger_p4 us_ab` with it. Over forty rows the card moved +1.6 points with a
standard error of 5.7 against a row-to-row spread of 36, so the roster as a whole is where
it was. `tools/duel.mjs` prints `met` beside `open` now, because an opening range nobody
stays at is not a denominator. The eighty-eight loses to a rifle section at 450 on the
pre-change file too, which is a roster question and not this one.

Measured on `tools/brain.mjs --base=3ed77e0` over a five-minute battle with a brain on both
sides, the honesty boundary moved the right way on every count: targets picked that had
never been seen 36.1 per cent to 19.2, attack orders on them 21.7 to 16.3, rounds actually
fired at something unseen 13.7 to 6.66, threat weight unseen 75.4 to 61.5.

**Combat.** `computeVisibility` fills `vUs`/`vGer` and drives both fog of war
and target acquisition. `COVER` entries are graded open / light / medium /
heavy / dug-in; linear cover (walls, trenches) only protects across its face,
which is what `coverValue` computes from the firing angle. `chooseCover` and
`coverSlots` are why soldiers tuck themselves against walls. A burnt-out vehicle
is cover too (`kind: 'wreck'`, heavy for a tank and medium for a car, added by
`killUnit` where it died), because thirty tons of plate in the middle of a street
is the best thing in it to get behind, and it blocks the street as well. On desktop
the grade of cover under the pointer is shown beside it while infantry is selected, so
the player can see what a move order would land in before giving it.

**Cover is read where the men are.** `fireAt`, `fireOneSecondary`, `explode` and
`exposure` all ask `coverOf`, which averages over the men still standing, and shellfire
asks each man separately because the loop that hurts him already has him. They used to
read `coverAt(t.x, t.y)`, the section's own marker -- a bare coordinate usually in the
middle of the street, a dozen units from any of them. So `chooseCover` and `coverSlots`
went to great trouble putting each man against a wall and it changed nothing whatever
about how hard he was to hit: the whole business of taking cover was decoration. Fixing
it took halted men behind something from 73 per cent of man-frames to 99.

**A section takes cover, rather than standing in what it halted on.** The piece has to be
within a hundred and eighteen units, not sixty, because the men are allowed to walk to it
and a section that halted in a street with a garden wall eighty units off used to take
nothing at all. A tier of cover is worth about sixty units of walking, which is what the
score's distance term now says. `coverSlots` keeps the file inside the patch's own circle
rather than inside its length -- a man standing nine units off the axis at the very end
was outside the cover he had been given, so the ends of every file in the game were in
the open believing they were behind a wall -- and within a shout of the section, so a long
wall does not string one section across a whole frontage.

**A hole in the ground cannot be shelled away.** Craters and ditches were being worn down
by `damageCover` like a sandbag wall and then dropping out as cover entirely, while the
map went on drawing them: after a barrage the men lying in a crater field were in the
open and nothing on screen said so. Works still come apart, which is why a position has
to be re-dug. And every shell used to be charged against medium cover twice -- once
through the index and once by a linear walk of all two thousand patches at the foot of
`explode`, which was also a scan of the whole list on every explosion.

**A bunker has a front and a back, and that is the whole of what makes it one.** A house
is fought out of on every side. A bunker has a fighting slot and a back wall, so
`outPoint` clamps a garrison's firing point -- and the point a round arrives at -- into
its own arc (`bk.face`, `bk.arc`). Fire from behind is then a line drawn into the
concrete, which is solid on the fire grid and stops it, and nothing else in the game has
to know what a bunker is for that to work. Measured at 300 units: a shot out of the slot
is allowed and the same shot to the rear is refused by its own walls.

The rest follows from that. Its garrison stands in ONE RANK inside the slot rather than
round four walls, and the section leader takes the middle of it with the rest dealt
outward -- `povEye` reads the first living man, so dealt in order he stood at the far
left end of the embrasure with a roof pier a few units in front of his face, and a
commander looking out of his own bunker saw concrete. The cover is on the flanks and
behind and NOT in front, because the ground in front of a bunker is the beaten zone and a
patch laid there would be the map telling a section that walking up to the slot is safe.
Nothing is laid in the middle either, though that is where the garrison stands: `coverOf`
hands a garrison tier 4 outright, so the patch buys the men nothing, and **a cover patch
inside a solid footprint is a lie the whole index believes** -- `aiFirePost` reads it and
would site a machine gun in the concrete.

`canGarrison` takes anything with a `face` whatever its size, because the size test is
asking whether a thing is a strongpoint or a shed and a bunker is a strongpoint at any
size. Its footprint is axis-aligned like every solid thing here, so the bearing is taken
to the nearest quarter turn; on the Gothic Line every bunker looks along the valley,
which is the x axis, so nothing is lost by it.

**A bunker is fitted out once, and that is what makes it a decision rather than a box.**
A bunker was a hole in the ground with a roof on it: a section could stand in it and
nothing else about it was yours. On a map whose whole question is which of three
crossings to force, the thing the map is about had exactly one thing you could do with
it. `BUNKUP` is the five, one per bunker and no second go: a machine gun post, an
anti-tank casemate, a mortar pit, a repair shelter and an aid post.

**Three of the five are a weapon team off the side's OWN roster**, which is why each side
gets its own piece for nothing: a Vickers or an MG42, a six-pounder or a Pak 40, an M1 or
a Granatwerfer. The two that fire through the slot are GARRISONED, so `outPoint`'s arc
clamp is the whole of "it fires the way it is facing" and there is no new firing code
anywhere. Measured at 300 units: a shot out of the slot is allowed and the same shot to
the rear is refused by the bunker's own concrete. The tube is the other way about -- it is
dug in 92 units BEHIND the bunker, on ground `nearestFree` says a man can stand on,
firing over the top of it, and it leaves the slot free for the men holding it. That is
also why it is the one fitting that may go into an occupied bunker.

The other two are radius effects (220 units) read by machinery that already asks those
questions. `bunkerAidAt` goes beside `medicNear` in the reinforcement block, so an aid
post patches up the wounded near it and fills a section that has lost men back up without
it walking home. `bunkerRepair` is the engineer's own repair applied where the hull
stands, and it takes a shed track and a wrecked gun down with the hit points, because a
vehicle that cannot move is a vehicle that is not coming back on its own. Both are asked
three ways by the gate -- near, far and ENEMY -- because a radius with no side test in it
works perfectly in a photograph.

**The geometry is a per-bunker world-space buffer** (`bk.upBuf`, built through
`conformFaces` and `facesToBuffer`, the way a field work already is), because a bunker
lives in a static prop tile and re-meshing one is 110 ms for a mount, a bench and a few
boxes. While the work goes in, `bk.upSite` is the same buffer drawn sunk into the ground
and rising out of it, which is the only thing on screen that says anything is happening
in there.

**And a bunker answers to whoever is standing in it.** `bunkerOwner(bk)` is `bk.own` with
the map's own side as the fallback, a SLOT rather than a side so a 2v2 works, and
`enterBuilding` flips it. A fitting still being built goes with the concrete too: left
pointed at whoever paid for it, an MG post finishing under an enemy garrison would spawn
its crew, throw that garrison out and hand the position back for nothing. The fitting goes with the concrete: an aid post overrun is an
aid post patching up the men who took it, which is the whole of why walking round the
side of one is worth doing. What does NOT change is the geometry -- a Normandy casemate
does not become a sandbag sangar because the men in it are Canadian, and the buffer is
built once for that reason.

**The brain fits them, and it is deliberately NOT on the works ladder.** That ladder is
one work every fifty-two seconds against a thing there are three of on the whole map,
which is exactly the mistake the heavy battery's first version made and was measured
making. What goes in is read off the battle rather than off a list: armour on the field
wants a gun in the embrasure and nothing but infantry wants a belt, which `aiIntel`
already answers; the other two are about this side rather than the enemy, so hulls
standing about with holes in them want a workshop and under-strength sections want an aid
post, both counted off the roll. Counted gate by gate (`bunker.reached`, `bunker.money`
and one per kind), because the way to find out why a rule never fires is to count what
shut it. Measured over four minutes with a brain on both sides it reaches on 46 ticks,
can pay on 3, and fits 3: money-bound, which for a thing bought once a bunker is right.

**The emplacement outlives its crew.** A mount cast into a wall is masonry and the men on
it are a unit, so a gun whose crew has been shot off it is RE-CREWED at the same price
rather than written off for the battle -- only with the same weapon, because the
embrasure was opened out for that one. `bunkerManned` reads the id of the unit the
fitting raised rather than whether anybody is standing in the slot, so a crew merely
ordered out does not buy a second gun. And `popOf` counts the men a fitting has on the
way, the same clause it already carries for a field work: three bunkers ordered in one
tick would each see a cap with room in it and put the side over it when the last came in.

**Three things about it read as working and were not, and a photograph caught one of
them.** A tap on a bunker is two different things: with men in hand that could go into it
the tap is their order, and with none it is "show me what is in this". Picked
unconditionally, the new branch sat ABOVE `issueOrder` on the touch path and garrisoning
goes THROUGH `issueOrder`, so a phone quietly lost the only way it had of putting men in
a bunker at all. A crew the fitting raised belongs to the bunker: `aiTick`'s rule about a
section holding a house and following the fight when it moves on, applied to a fitted gun,
walks two hundred and thirty marks of machine gun out of the emplacement it was bought
for and leaves the slot empty, so `bunker.man` holds it there. And a selected bunker drew
NOTHING on the map -- `buildMarks` skips it for want of a `cat` and the overlay walks
`G.blds` -- so a player picking one of three got five different cards and nothing to say
which one he had picked.

**`G.bunks` is the short list.** Four things now ask a question of every bunker on every
frame and `G.props` is six hundred entities. They are map entities and nothing adds or
removes one during a battle, so the list is built where they are pushed and never
maintained again.

**A garrison never goes flat.** Men holding a house fight from its openings. Two of the
three pinned tests in `updateModels` did not exempt `u.gar` the way the third already
did, so a section under a machine gun lay down on the ground floor of the strongest cover
on the map and vanished out of the windows it was holding.

**A man stands clear of what he is standing behind.** `coverSlots` puts him a distance
off the piece's own line, and only the trench, the house face and the sandbags were named,
so a field wall drawn eleven units thick took the default four and a half: every man at
every garden wall on the map stood a unit inside the masonry. A drill that takes cover at
each wall run had ten men of ten in the stones before and none after. It does not move
the battle probe, because the shipped map has twelve wall runs and sections rarely halt at
one, but a generated map is laid out with field walls round every enclosure. The probe
could not see it either until it was taught that a thin thing is still a thing: it tested
buildings and solid props and no wall was on the movement grid to be caught any other way.

**A house's faces lie along its walls.** The four patches ringing every building had the
two axes the wrong way round. A patch's axis is the line it protects across, so the front
of every house in Ortona sheltered you from fire coming along the street and left you in
the open against fire coming straight at the wall; it also laid the men out at right
angles to the house, half of them inside it. And `chooseCover` now scores a piece with
`coverValue` itself, rather than its own near-copy that let trenches off the enfilade
penalty: a section would settle contentedly into a trench being raked from the end, which
is the worst place on the map to be, and never look again.

**The ground had no surface.** Detail on the earth came out of a tile of the atlas at one
fixed scale, applied as a multiply about one: a faint ripple in brightness with no colour
in it. Measured, the contrast of the ground fell three points between full resolution and
the same picture boxed down by eight, which means there was nothing on it finer than eight
pixels at any distance -- a hundred and fifty units of dry earth reading as an airbrushed
sheet.

It has a texture of its own now (`buildGrit`, `TEX.grit`), and the reason it is not another
atlas tile is worth knowing: **`tile()` wraps with a `fract()`, and a `fract()` in a
fragment shader breaks the screen-space derivative the hardware chooses a mip level from**,
so every repeat of the pattern carries a seam of the coarsest mip along it. At the strength
the old detail was applied nobody could see the seams because nobody could see the detail
either; at a strength that makes earth read as earth, the ground comes out ruled into
squares. A texture wrapped `GL_REPEAT` has nothing to fract and no seam to have. Its noise
tiles because every octave's lattice wraps on its own period.

Three channels carry three sizes of thing, so two fetches give four scales: `r` is grit,
`g` is clods, `b` is the slow drift of a field. **The fine ones are faded by distance and
that fade is the level of detail**: below a pixel, grain is not detail, it is shimmer.
The weighting is deliberately toward the fine end, because the painted map already carries
the macro drift, the slope materials and the hollows, and a second lot of thirty-unit
blotches on top of it reads as camouflage rather than as ground.

The grain carries a normal as well, which at twenty-one degrees of sun is most of what
makes ground read as a surface rather than as a photograph of one: every clod throws its
own small shadow away from the light. Two more fetches, faded out with the same distance
the grain is, and behind `#define BUMP` so a phone does not pay for them.

**And the albedo had no mip chain.** Two thousand eight hundred by nineteen hundred, one
world unit a texel, `LINEAR` with nothing under it: at any camera further off than a street
the ground is minified several to one and every frame samples a different set of texels.
It reads as sharpness in a still and as a crawl the moment anything moves. A patch upload
invalidates the chain under it and the editor paints patches, so it is regenerated there
too.

**And a cut face is not a floor seen edge-on.** The painted map is a plan, so on a slope it
is stretched by one over the cosine and every scale of grain on top of it was stretched with
it. The coastal bluff, the wadi banks and the wall of a trench all came out as broad smears,
and the old answer to that was a `tile()` of the atlas on a diagonal uv -- the one thing the
grit texture exists to avoid, since a `fract()` breaks the derivative the hardware picks a
mip from and every repeat carries a seam of the coarsest one. It was replaced with a
cylindrical projection about the face's own bearing: u runs across the face along the
horizontal tangent and v runs up it, which is stable on anything from a bank to a vertical
cut and needs no tangent frame in the vertex stream. Two fetches, and only a sloped fragment
pays for them.

**The weight between the two projections is the whole of it, and it was wrong twice.** A plan
projection stretches a pattern on a face by one over the cosine and a vertical one stretches
it by one over the sine, so each wants the ground it is the better of the two on. Written as
a threshold on how far off level the ground is, it handed the vertical frame to the gentlest
slopes on the map, which is where that frame is at its worst: the wall of a shell hole at
twenty-eight degrees came back stretched two to one where the plan projection had it
stretched by a tenth. Written as the textbook triplanar crossing at forty-five it is correct
and still costs, because the two patterns are unrelated and a half of each carries less fine
contrast than the whole of either -- measured, three points of fine contrast off every face
on the map, which is the whole natural range of this one. It is a narrow, late cross-fade
now: everything up to thirty-eight degrees keeps the plan projection, where it is stretched
by at most a quarter, and gives it up over the band where holding it costs more than the swap
does. A trench wall at seventy degrees is stretched three to one by a plan projection and by
a fifteenth by this one.

Three more things about it. **The steep test reads the geometric normal**, because the bump
can swing a flat fragment's normal most of a radian and keyed off the bumped one it painted
rock into open ground wherever the grain happened to have a steep gradient. **A gradient has
to be taken in the frame its sample came from**: differencing a blended value against a
single-frame neighbour is not a gradient, it is two unrelated noises subtracted, and it puts
the whole amplitude of the grain into the normal everywhere the two frames are both in play,
so the bump is taken twice and weighted. And **the rock is scaled to what the painter put
there**, because the reprojection is a fix for the detail on a face and not for its tone:
left absolute it lifted the inside of every shell crater to the value of a sunlit bluff and
the crater field stopped reading as holes in the ground.

The colour starts where the painted map's own geology starts -- it holds soil below eleven
degrees and is bare bedded rock above thirty-two -- because the shoulder between is already
painted as scree thinning off the face above it, and a stone wash over the whole of the
rolling ground takes the warmth out of the map. The bedding is a sample of the grit texture
at a constant u, which makes it a pure function of height, and a horizontal band is what a
cut through layered ground has: topsoil over subsoil in a trench wall, courses of sandstone
in the bluff.

On the card, against the same file without it: a face at 25 degrees is unchanged, one at 45
goes from 0.39 of the fine contrast of the open ground beside it to 0.46, and one at 48 from
0.37 to 0.42. Nothing on this map is steeper than 48 degrees and sunlit, so the trench walls
and the crater walls where it does most of its work are judged by looking at them.

**And it is December.** Ortona in that week is rain and mud, and the ground was bone dry
everywhere. How wet a piece of it is, is how well it drains, and what decides that is
whether the water has anywhere to go: a hole holds it, a natural hollow is damp, a slope
sheds it and an open field drains. Wet earth is darker than dry earth and warmer, because
water fills the air between the grains and stops them scattering, and below the water table
of a hollow it stops being wet ground and starts being a puddle, which is a surface rather
than a colour: a film of water is smooth where the ground under it is not, so it gets a
broad highlight and a piece of the sky at a grazing angle. Only a dug hollow gets that far;
a natural one is capped short of it.

Two things about it. **The hole comes off the crater and trench lists rather than off the
shape of the heightfield**, because curvature over a boot's length cannot see the bottom of
a bowl fifty units across: measured on a curvature probe, the floor of a trench came out at
0.95 and the middle of the biggest crater on the map at 0.20, and the crater is the one you
look into. It is one grid at the mesh's own resolution, marked in the same pass that marks
the cells to refine, and one lookup a vertex. And **it rides in the u of the vertex uv**,
which costs nothing whatever: the ground carries the atlas's material 9 and has never once
looked at it, since every scale of its surface comes out of the grit texture instead. Only
the ground buffers are drawn with `uUseTex`, so that channel is the terrain's alone.

Finding that out turned up the one bug in the pass. **The model bump was running on the
ground**, bending the terrain's normal by the gradient of the tile it does not use, sampled
through a `fract()` with no mip and no distance fade, on top of the bump the ground had
asked for. It is gated now. It bought nothing measurable, because material 9 has no gradient
to speak of; it is in because it saves two fetches a ground fragment and because the next
person to give that tile a texture would otherwise get a second bump on the whole map for
free.

**And a map can say that its ground is wet and that it has been churned, because the
crater and trench lists cannot.** Those say where the ground has been OPENED, and they
have nothing to say about the floor of a river valley in the rain. `LAND.wet` and
`LAND.churn` are the two, and they are separate because they are different things. Wet is
a surface: the shader darkens it, takes the scatter out of it and puts a sheen on the
worst of it, and it folds into the same `wet` channel a shell hole already uses. Churn is
a COLOUR: ground turned over, shelled, walked on and rained into until whatever the soil
had is gone.

**And nothing grows where the ground has been turned over.** The grass scatter knew about
paving, roads, trenches, bare rock and the sea, and about nothing else, so a map that
says its country has been shelled for a fortnight had bright tufts standing all over it
-- in the middle of no man's land, on ground the paint had already made bleak, the one
thing left in the frame with any colour in it. `buildGrass` reads `LAND.churn` and thins
with it rather than forbidding it, because a few come through in the lee of a bank or a
wall. Only a map that declares churn is touched.

**It is measured off the albedo canvas rather than looked at.** A churn that quietly
stopped being painted would read as a perfectly good map in every photograph ever taken
of it, which is the same shape as the fog of war having no live tier for the life of the
game. The gate reads the canvas, which is the paint on its own with no sun, no fog and
nothing standing on it, and asks for a DIFFERENCE and never an absolute: no man's land
darker than the shelf the army forms up on, and less warm, which is what separates wet
turned earth from dry stubble. It reads shelf 110/34.1, forward slope 96/15.5, no man's
land 90/16.7, the midline 88/14.5.

**A wetness is not a colour, and the Gothic Line's no man's land proves it.** The shader's
wet term darkens ground and WARMS it, because water in the grain is warm; put in on its
own, what came out was damp stubble and read as dead grass. What the paint has to take
away is the warmth the dry ground either side of it keeps, so the overlay is very nearly
colourless and the brown that comes out is the brown of water in the grain.

The churn goes on LAST of everything in `paintGround`, after the roads and the craters,
because after a fortnight of this a road through no man's land is mud with a camber. And
it is built as one quarter-scale `ImageData` and drawn once rather than as a quarter of a
million little rectangles: written the obvious way it cost 2.8 seconds on a full albedo
and DOUBLED the editor's patch repaint, 210 ms to 433, which is the one number in this
file a person waiting with a finger on the screen can feel. It is 36 ms now, a wash has
no detail finer than the noise under it so nothing is lost by painting it coarse, and
`drawImage` honours the clip where a loop over the whole world does not.

**The sea had no surface either, and for a different reason: there is no water.** What is
drawn is the sea bed, sunk to sixty units and painted blue, so the normal under a fragment of
sea is the normal of the mud at the bottom of it. On top of that sat a product of two sines
at a hundred and twenty-six units and seventy, which is a chequerboard, and that is what it
read as: broad bands of light and dark laid in a grid across the Adriatic.

The surface is made in the shader now and everything else follows from its normal. Two
scrolling samples of the grit, a swell and a chop on different bearings at different speeds,
differenced for a gradient. The colour is a Fresnel mix of what the water scatters back and
what it reflects, which is why a sea is dark under your feet and bright toward the horizon,
and the glitter is a hard specular on the same normal rather than on the sea bed's. Four
fetches, and only a fragment of sea pays for them. The grain has mips, so at range the three
gradient fetches converge, the normal flattens to straight up and the glitter goes out on its
own: level of detail for nothing, and the alternative is a sea that boils.

**A crater is three things and the paint had one of them.** There is the bowl, damp subsoil
turned up out of a dry surface, which is darker and redder than anything round it. There is
the lip, the same spoil thrown out and lying on top of what was there, which is the
brightest thing on the crater because it has not weathered. And there is what went further,
in rays, because a shell does not distribute its spoil evenly. What was painted was a soft
dark wash out to twice the radius with twenty faint ellipses scattered over it, which at the
distance a player looks from is a smudge. The rays go down first, the lip ring over them
with its clods, and the bowl last and hardest-edged, because it is a hole rather than a
stain. The shipped map has a crater field west of the town and the whole of it used to read
as weather.

**Destruction.** A town house is a set of bays and each bay is four walls built in
seven-unit courses round a list of holes, and that list being DATA is the whole of why any
of this is possible without a second geometry path. A shell records where it struck in the
wall's own frame, `holesFor` concatenates the record onto the windows and the doors, and
`wallCourses` cuts the breach out of the courses the same way it cuts out a window. Nothing
new draws a damaged building; the thing that drew the building draws it.

**What breaks is a town house and a wall.** `ruinHit` refuses anything that is not
`kind: 'ruin'`, so a bunker stands: it is reinforced concrete and a field gun was not going
to open one, which is the whole reason the Gothic Line is a question about which crossing
to force. A farm and a church stand too, and those are a scope line rather than a claim --
neither is built in bays round a list of openings, so neither has a structure to break, and
giving them one is the same work again on two more builders.

`ruinState(p)` is the structure, worked out once and kept on the prop, and it is the same
arithmetic `sceneProps` does when it meshes one -- here rather than there because the
mesher runs on a tile rebuild and this has to survive one. Per bay: the breaches cut in
each of its four walls, the share of each wall that is now out of it, and how many storeys
it has lost.

**A wall is an area rather than a pool of hit points.** `ruinHit` records the hole and adds
`2*hw*(z1-z0) / (len*h)` to that wall's `gone`. One face past three quarters is a wall that
has fallen out; two faces past a half is a box that is no longer a box. Either takes the
storey standing on them, and what comes down is the bay's whole perimeter above the new
height. It is checked per bay, which is the entire reason a town house is meshed in bays: a
terrace does not come down all at once.

**How far a blast REACHES masonry and how big a hole it makes when it gets there are two
numbers**, and written as one they fought each other. A hole scaled off the weight of the
shell is a metre across for a tank round, so a round bursting a metre and a half from a
wall -- which is where a man taking cover at a house stands, and therefore where most
rounds in a town actually land -- took nothing out of it at all. The reach is the weight of
the shell too and it is several times the hole: `hw = br * sqrt(1 - (d/reach)^2)`, so the
wall is scarred at the edge of it and breached in the middle. Two things had to be got
right with it. **The distance is to the WALL and not to its plane**: a heavy round reaches
past the end of the bay it burst against, so with only the perpendicular in it a shell on
one bay cut a full-width breach in the next bay's frontage sixty units away at exactly the
size it cut in the one it hit. And **a round in the street outside one wall does not take a
bite out of the wall on the far side of the room**: `ruinFace` measures `nd` along the
OUTWARD normal, which nothing needed while every reader took its absolute value and which
is the whole question the moment one of them asks which side the blast is on. A burst
INSIDE the bay is the other case and blows all four out, which is what a round through a
window does.

**The masonry that comes out is a rigid body.** No solver is possible here and none is
wanted: what `G.debris` carries is a position, a velocity, an orientation and an angular
velocity per chunk, integrated with semi-implicit Euler under gravity at 98 units a second
squared, with the ground as the only collider. Stone does not bounce, so the restitution is
a fifth and the friction takes most of the rest; below the speed one frame of gravity gives
it there is nothing left to model and it is lying on the ground. A shell THROWS masonry and
a collapse DROPS it, and that is not a detail: given a blast's speed, the perimeter of a
bay ended up scattered a hundred and twenty units into the street, four fifths of it too
far from the house to be its rubble at all.

**The one thing a solver would give that a heap actually needs is that masonry lands ON
masonry, and that is a height field rather than a solver.** `MND` is one coarse grid over
the whole map at fourteen units: a falling chunk collides against the ground plus whatever
is already lying there, and what settles raises it. Dropped into the same yard, a hundred
and fifty stones then build a mound where most of the wall came down and thin out at the
edges. Without it every chunk rests on bare ground and a collapsed house is a carpet of
separate blocks that reads as spilt cargo. It is one grid for the map and not one per
building, because a chunk that lands clear of a building has nowhere to go and was thrown
away -- and a garden wall blown apart in open country belongs to no building at all, so
every stone of it vanished on landing.

**A hit building leaves the merged tile and draws from its own buffer.** The tile is a
megabyte of merged geometry and cannot be edited; re-meshing one house is a thousandth of
re-meshing the tile it sits in. The tile it was merged into still has to lose it, and that
is a re-mesh of everything else in the tile with it -- about a hundred and ten
milliseconds. Done inside the burst that is the hitch once per house, which in a barrage is
several of them in one frame, so it is queued in `G.tileQ` and `flushTileQ` takes one a
frame however many houses were in the salvo. The house is drawn twice for that one frame,
which nobody sees.

**Two buffers rather than one, because the heap changes and the walls do not.** A bay's
packed vertices are cached on the bay and only the bay a round changed is re-packed: three
bays of a terrace is six thousand faces and nineteen thousand vertices, which is eighteen
milliseconds -- a whole frame, on a frame where a house was hit, and a barrage hits houses
constantly. It is five milliseconds for one bay. The settled rubble is one buffer for the
whole map, rebuilt on the frames a stone lands, and it goes through the same hand-written
packer the airborne debris uses.

**`packChunks` is written by hand and it is the only vertex packer in the file that is.**
`buildDebrisBuf` is rebuilt while the game is running, which nothing else here is. Built
the way everything else is built -- `box()`, `roll()`, `pitch()`, `place()`,
`facesToBuffer()` -- it cost 2.8 ms a frame with the cap in the air, and nearly all of that
was garbage rather than arithmetic: four arrays of six faces and thirty-six vertex arrays
per chunk, three hundred times over, on every frame. A chunk is an axis-aligned box under
one rotation, so its eight corners are the centre plus and minus three half-axes and those
half-axes are the columns of the rotation scaled by the half-extents. Written straight into
one array that is allocated once and re-uploaded it is 0.5 ms and allocates nothing.

**And the world follows the storey down.** This is the half a screenshot cannot review at
all, and it is where a destruction feature is usually a lie: a house knocked flat that goes
on stopping a boot and an eye is rubble painted over a building that has not moved. A bay
still standing blocks what a house blocks; a bay that is down is marked on `rubg` instead
-- dear to cross (2.3 to a man, 2.4 times to tracks and five times to a lorry), crossed at
half pace, and on NEITHER of the two grids that stop sight or fire, which is the same rule
a field wall under sixteen units already gets. `canGarrison` refuses a house with nothing
standing above 34, the four tier-3 patches lying along a fallen face are written off (which
drops them a tier, the way a shelled sandbag wall drops one) and their axis goes with them
because a mound of masonry is the same from every bearing, and a garrison is damaged by
every storey that comes down and put out when the last of the house goes. Nothing new is
added to the cover index, because a patch laid on ground that is now rubble is a patch
`aiFirePost` would read as somewhere to site a machine gun.

**A wall is an object, and objects break too.** A garden wall does not need a structure: it
is a LINE, and what a shell does to one is take a length out of the middle. A gap is a span
measured along the run, which is the one number every reader of a wall already works in --
the mesher steps along it stone by stone, the movement and sight grids mark it piece by
piece, and `buildWallQ` buckets it by piece as well -- so a gap is skipped in all of them
rather than modelled in any of them. `wallSpans` hands back the pieces that are still
standing and `rebuildGrid` marks those. The stones that were there come out at the size a
wall is laid in: a course at a time in six-unit lengths, because at a slab a metre long
sixty units of garden wall came apart into seven pieces. Worth knowing: the gaps are honest
and the movement grid is twenty units, so a gap under about thirty units is visible and
does not clear the cell it is in.

**A vehicle dies by changing shape rather than colour.** The effects round a dying tank
were never the fault: there is a full staged burst, a real crater, two corpses, two minutes
of streaming smoke and a fire that lights the street. The BODY never changed. The same hull
buffer was redrawn with a hard-coded tint, standing level on its suspension as though it had
parked, and the code comment beside it said the turret was thrown half off its ring when
what it actually did was move three units and turn a quarter of a radian -- most of which
was not a throw at all but the mount offset the live draw applies and the wreck draw left
off, so how far a turret appeared to move depended on where its ring happened to sit.

What a burnt-out hull looks like is four things, and each of them is a number the draw
already had somewhere. It is DOWN, because the suspension is gone and the belly is on the
ground. It is OVER, because it went down unevenly. It is STRIPPED, with the skirts and a
good deal of plate off it and lying about. And often the turret is OFF, which is the single
most recognisable shape of a dead tank. `makeWreck` decides which of the three deaths this
was at the moment it dies and keeps the answer on the wreck; `m4lean` already carried the
three rotations a cant needs, and `spawnChunk` is already a rigid body with gravity, bounce,
friction and a mound to land on that takes any colour, so torn plate is the same system the
masonry uses and the paint is read off the model's own commonest face colour.

**The mount is one more body, stepped beside the wreck's own clock.** `stepHulk` integrates
it under the same gravity as the masonry, tumbling on three axes, and where it lands is
where it is drawn from then on -- lying at the angle it stopped at, and tier-3 cover, because
a turret on the ground is a good thing to get behind. Two numbers had to come down: given a
blast's own speed it went seventeen metres into the air and seventeen metres down the street,
which is a stunt rather than a tank. It is 47 up and 54 out over 2.7 seconds now. And the
tumble is a magnitude with a sign rather than a range through zero, because written the
obvious way one throw in a hundred came down without having turned at all, which reads as a
turret somebody gently lifted off.

A casemate never throws one (`VMODEL.fixed`), which is the whole difference between a StuG
and a Panzer IV on the day they die: over forty deaths each the StuG threw none and the
Panzer's cousin threw a third of them. And a wreck is marked on the movement grid along its
OWN hull now -- `blockRect`'s fifth argument is a pad rather than an angle, so the bearing a
wreck has always carried was stored and never read, and a tank that burned across a street
was blocked as a box square to the map.

**The one-off costs, measured.** Recording a hit is 0.01 ms. Re-meshing the bay it changed
is 5.2 ms. Freeing the tile is 110 ms of geometry, once per house and queued one a frame.
Stepping 280 chunks is 0.013 ms and their buffer 0.5 ms. `tools/wreck.mjs` is the card for
all of it.

**Effects.** Every particle in the game was one `drawArrays` of one uniform-driven quad
running one fragment shader with exactly one shape in it -- `smoothstep(1.0, 0.25, d)`, a
soft disc. So a Lee-Enfield flash and the burst of a 210mm shell were the same picture at
two sizes and two alphas, nothing had an edge, and three hundred of them were three
hundred draw calls.

The quads are built in world space on the CPU now, the way `packChunks` builds falling
masonry, and go out as one buffer and one draw a blend pass. That buys the COUNT -- a
single heavy burst wants sixty particles between its fireball, its clods, its ring and its
column -- and it buys the SHAPE, because a vertex can carry a shape id and a seed where a
uniform cannot without a draw call each. Five shapes: a soft disc for haze and for a
shadow, a puff with a broken curdled rim, a flash with spikes out of a hot core, a ring,
and a streak whose falloff is the bar across it and the taper down its length. Six bursts
in the air at once is 228 quads, 0.17 ms to pack and two draw calls.

**The puff's rim is angular and its inside is not.** Modulating the interior on the angle
as well gives a spoke pattern, and three overlapping copies of it read as a starburst
rather than as a cloud -- which is what the first heavy burst came out as, a lens flare
the size of the crater. The inside is modulated on the quad's own x and y instead.

**A muzzle flash is a cone of burning propellant coming out of a bore**, and what the game
had was a round disc at the barrel tip with nothing in it to say which way the gun was
pointing. It is a streak laid along the bore now, brightest at the muzzle, with a star at
the muzzle itself; a muzzle brake throws two lobes out sideways, which is the single most
recognisable thing about a braked gun. `w.brake` is declared on the six weapons that
carried one -- the Pak 40, the KwK 40 on the Panzer IV and the StuG, the KwK 36 and 43 on
the two Tigers, and the 17-pounder on the Achilles -- the way `belly` is declared on a
vehicle rather than derived.

**And the blast is read off the WEAPON rather than typed against thirty-six unit keys**,
for the same reason the sight rule is applied to `UNITS` at load rather than written out
fourteen times: two lists of one thing go out of step the moment somebody adds a weapon to
one of them. `muzClass` sorts a weapon into one of eight profiles in `MUZ` and the size
comes off the charge behind the round, so a 37mm and a 128mm are both 'a tank gun' and are
not the same event. Measured across the roster the biggest blast lights 53 times the
pixels of the smallest. `MUZ.dust` is how far in front of the muzzle the ground is
stripped, which on a tank is most of what tells a player at a hundred units up that it
fired at all, and it is only spawned when the muzzle is low enough over the ground for the
blast to reach it -- so the Maus, whose gun is two storeys up, kicks none.

**An armoured car's autocannon and a half-track's machine gun are the vehicle's MAIN
weapon and carry no shell**, so they went down the small-arms path in `fireAt` and spawned
no flash at all. Four of the roster fired invisibly except for the belt.

**A round in flight is in the world.** Tracers and shells were drawn on the 2D overlay,
which is a separate canvas stacked over the WebGL one, so nothing on it could ever be
behind anything: a belt fired at a house was drawn straight across the front of it, and no
photograph ever said so. They go through the depth buffer now, and the card measures it by
laying the same round across the same patch of screen with a house first behind it and then
in front -- 17,638 pixels in front of the wall and none behind. A tracer is a ribbon from
tail to head whose width runs across the flight AND across the line of sight, which is the
cross product of the two, so a round crossing the view is a bar and one coming at the
camera is a point.

**A belt is one round in four or five, not every round**, and the two armies' tracer burned
different colours: Commonwealth ran red-orange and German a pale yellow-white. The tail
carries the side's colour and the head is nearly white on both, because the element burning
is white-hot -- and because a red trace drawn flat over pale dry ground disappears into a
red channel that is already at the top of its range. Measured on this map before that fix
the Canadian tracer put a sixth of the pixels on the screen that the German one did for the
same number of rounds. The rounds of a volley are staged by a few hundredths of a second as
well: fired on the same instant, five tracers read as one thick bar of light.

**A shell landing is five things at five rates.** There is the flash, which is over in a
twentieth of a second and is what the eye actually registers; the fireball, drawn as a
handful of billowing lobes that climb and go from white through orange to soot; the shock
running out along the ground, which is what gives a burst a size the eye can read off the
ground rather than off a ball of light; the DIRT, which nothing in this game was ever
thrown by before; and the column. Every count is scaled off the burst radius, so a mortar
bomb is a different event from a heavy shell rather than the same event drawn bigger.

Three things about it were wrong first and each reads as a working feature in a photograph.
**How hard a shell throws its spoil is a function of the hole and not a multiple of it**: a
clod goes up about as far as the hole is wide and lands one to two radii out, and written
as `r * rnd(2.6, 5.2)` a heavy shell threw its dirt two thousand units into the air and a
quarter of the way across the map. It is `sqrt(98 * r)` now, which is the speed that gets a
clod to about a radius of height. **The column starts ON THE GROUND and grows**, and
spreading its z at birth instead puts the whole of it in the air on the frame the shell
lands, with clear daylight between the crater and its own smoke. And **the climb is
front-loaded rather than linear** (`k^0.55`), because off a straight ramp the column is
still lying in its own crater half a second later, which is a dark puff over a dark scorch
and reads as nothing at all.

**What a puff STARTS as is the whole of whether it reads.** A pale translucent puff over
pale dry ground is invisible, and that is what every puff in this game used to be; a sooty
one over the scorch its own shell just painted is invisible in the other direction. It
comes off the ground sooty and lightens as it climbs, which is both what smoke does and
what keeps it legible against the ground it is leaving. `FXCOL` is the four things a puff
can be made of -- thrown earth, burnt propellant, oily black, and pale masonry dust -- where
there used to be one 0.34 grey for all of them.

**And anything that moves has to move the ENTRY, not the quad.** A column that climbs only
inside `drawParticles3D` is a column nothing but the rasteriser knows about: the lights
read the position, and so does anything measuring how high a burst got. `spawnFx` keeps
`x0/y0/z0` beside `x/y/z` and `updateShots` integrates both the ballistic entries (a clod,
a spark, under gravity with the ground as the only collider) and the rising ones.

**A gun going off is a light.** At twenty-one degrees of December sun a great deal of this
town is in its own shadow, and until this the only things that lit any of it were the sun
and a burning hull: a tank firing out of a side street lit nothing at all, including
itself. `gatherLights` reads a muzzle flash's own `lit` flag now, and the burst's light was
cut from 2.4 to 1.9 because a salvo is several of these at once and four slots of 2.4
bleached the whole town.

**A hull burns for two minutes and nothing drew any of it.** `smokeColumns` has been
attenuating the sight line through a wreck for as long as detection has been a rate, and
what the renderer put there was the six puffs it died with. That is the same shape of fault
as the fog of war having no live tier: the eye was being slowed by smoke that was not on
the screen. A wreck in view now streams smoke and licks flame at a rate that falls away
over the two minutes `smokeColumns` already models.

**The hole a shell leaves.** A burst painted a scorch decal, which is a stain on a
surface that is exactly where it was before, so ground a battery had worked over for ten
minutes was flat ground with dark patches on it and the men lying in it were lying on a
plain.

The machinery for a real one was already here and had only ever been run at build time.
Earthworks are kept as layers over the natural ground -- `G.cut` is the deepest cut at
each point and `G.fill` the highest spoil -- and `carve` writes a bowl into them, which is
how the map's own crater fields are dug. So a hole blown during a battle is the same call
the map makes, plus the four things that have to follow it: the worked height, the going
grid, the cover, and the mesh. `digCrater` is the one door and `tools/fx.mjs`'s CRATER
section is the card.

**What was wrong with the height was that it was not the sum of its own parts.**
`levelPad` presses a building's footprint flat and wrote the result straight into
`G.hmap`, so `hmap = hmap0 + cut + fill` held everywhere except under a pad -- which is
fine while nothing ever recomputes a piece of the height, and is exactly wrong the moment
something does. The first shell hole blown beside a house recomputed the ground under the
house off the parts it could see and put the pad back on the hillside. The pad is a third
layer now (`G.pad`) and the invariant holds everywhere, which the gate measures over the
whole grid rather than trusting.

**Everything is refreshed over the hole's own footprint.** The whole-map versions are
0.60 ms for the height and 2.70 for the terrain grid, which is not a thing to do once a
shell; over a crater they are four and eight microseconds. `terrg` is the interesting one:
it is cached because the shape of the ground does not change during a battle, which
stopped being true here, so the cells a hole touches are read again and `makeTerrain` still
throws the rest away.

**A hole is cover, and it is cover a man lies in.** `addCover(x, y, r, 1, 'crater')` is
what the map's own craters get, and the `crater` kind already carries `STAND_FLAT`. The
wall comes out at about a third of a gradient, well under the 1.0 `buildTerrGrid` calls
unwalkable and under the 0.45 it calls hard going, so a fresh crater is somewhere to lie
down rather than a pit that swallows a section. Measured: cover 0 to 1, walkable before and
after.

**Shells landing in the same place make ONE bigger hole.** `G.cut` keeps the deepest cut
so the ground would agree either way; what merging saves is the list, the cover index and
the mesh, all of which a ten-minute fire mission would otherwise fill with overlapping
copies of the same hole. The centre stays put when a hole widens, on purpose: `indexCover`
files a patch under every cell its circle reaches and has no way to unfile one, so a circle
that only grows can be filed again for the cells it has gained where one that moved would
leave cover indexed on ground that no longer has any.

**The mesh is queued, and coalesced on two clocks.** Re-meshing one ground tile is 40 to 60
ms, and a fire mission puts ten shells into one tile inside ten seconds: done as they land
that is ten rebuilds of the same tile. A tile is rebuilt once it has been quiet for 0.45 s,
which is what makes a salvo one rebuild, and at the latest 1.6 s after the first shell
landed in it -- because a battery firing steadily would otherwise keep the tile permanently
un-quiet and the ground would never change at all while it was being shelled, which is
exactly when a player is looking at it. A forty-round mission is 0.115 ms a round, four
tiles queued, four rebuilds.

**And `buildTerrain` stopped scanning the whole map to rebuild one tile of it.** The
refinement pass is four `groundZ` calls at each of eighty-three thousand cells and it is
most of what a tile costs; asked for the whole map on every partial rebuild it was being
paid twenty-four times over for a shell hole in one corner. It is restricted to the tiles
being rebuilt plus a one-cell margin, because a fine cell pins its edge midpoints against a
coarse neighbour and has to be able to see it.

**What it deliberately does not do is repaint the ground.** `buildAlbedo(rect)` is 222 ms
whatever the rect -- `paintGround` walks every road, crater, trench and cobble on the map
before the clip throws the drawing away -- and two hundred milliseconds a shell is not a
thing that can happen while a battery is firing. The hole carries its own appearance
instead: the mesh darkens its own bowl through the ambient term it already computes off its
neighbours, the wet channel fills it because a hole is where the water goes and a deep one
gets standing water, the scorch decal blackens the middle, and the fresh spoil round the
rim rides in the vertex colour off a grid marked in the same pass the wet channel's is.
Only the LIP is tinted: the bowl darkens itself twice over already, and a third darkening
on top turned a fresh crater into a pit of shadow beside the map's own.

**And the burn was drawn at a radius and a bit of the whole burst**, which was the scorch
standing in for a crater. With a real hole under it as well, a salvo painted the ground
black between its own craters; it is drawn tight round the hole when there is one.

**What will not open.** A floor somebody levelled and built on, concrete, the sea, and
anything under the size floor -- `CRATER_MIN`, which is eleven units of hole and sixteen on
a phone, because a tile re-mesh costs what it costs wherever it runs and the thing to cut
there is how often one is asked for. A crater is about a third of the burst radius, which
puts a mortar bomb at eleven and a 210 at forty-five, and those are the two ends of what
the map itself was hand-placed with. A round that burst against an upper storey scorches
the street and does not open it.

**Renderer.** Hand-written WebGL2. One vertex/fragment program for lit
geometry, plus sky, depth and particle programs. A 2048px shadow map from a
sun matrix. A procedurally painted 16-tile texture atlas (`buildAtlas`). The
static world is merged into tiled buffers by `buildScene` (a grid of prop tiles and
ground tiles, culled to the view); units and vehicles are per-model draws. Fog of war and battle damage are textures the
ground shader multiplies in. A second 2D canvas (`#ov`) carries what is text or a bar:
health bars, unit labels, cover readouts, the minimap.

**A tint has to find its own material, and for a long time it could not.** `MATS.byColour`
is keyed by the exact colour string, and `box()` shades its bevel strips with `lit()`
derivatives of the face colours, so a derived value is a colour in its own right and a
colour the table does not know falls back to the untextured `generic` tile. `tagEdges()`
exists to register those, and it was called for the vehicles and for almost nothing else.
Measured on the Gothic Line, **41.7 per cent of every face the world builder makes** was
coming out untextured: every bevel on every wall, most of the masonry, and the whole of
the sandbags.

It is invisible in a photograph, which is why it lasted. A shaded slab and an unshaded
slab both look like a slab, and a wall hemmed with a flat pinstripe along every edge reads
as a wall somebody built out of concrete rather than as a fault.

Registering the derivatives by hand is the wrong shape of fix, because it means
enumerating every factor every caller uses -- `box()` at 1.06, .92 and 1.03, a sandbag
asking for 1.12 and .9 on top of that -- and a miss anywhere is silent. `lit()` remembers
where each tint came from (`_lsrc`) and `matOf` follows the chain back to the material its
source was tagged with, keeping the answer because a scene asks about the same colour
thousands of times. One place, exact rather than fuzzy, and it covers a tint of a tint.

That took it to 14.4 per cent, and what was left was roots nobody had ever tagged. Four
fifths of it was one string: the third sandbag shade, left out of the hessian list when
the other two went in, so every parapet, every weapon pit and the whole of both bunker
lines' bagwork was flat. The rest is the tail -- the room read off a shell when nobody has
drawn one, the gun's own palette, the joists in a roof, the drums on a fuel dump, the floor
of a gutted house.

It is on the gate, because the next palette added will be missed the same way and nothing
on screen will say so. The row separates a face tagged `generic` ON PURPOSE -- skin, hair,
a painted helmet, a window recess, all of which are meant to be flat -- from a root nobody
tagged, and trips at half a per cent. Both maps read 0.1.

**What is flat goes on the ground, not over it.** The rings and the order paths are built
as ribbons lying on the terrain (`buildMarks`, `MARK`, `drawMarks3D`) and go through the
depth buffer, because the 2D canvas is stacked over the WebGL one and nothing drawn on it
can be behind anything in the world: a section's selection ring was drawn over the section
and four sections under orders put four dashed lines over every man on the screen.

**A unit is the circle it is drawn in, and `selRadius` is that circle.** It has been wrong
four times, and the two failures are different: a ring has to HOLD its unit and it has to
FIT it.

Drawn at the marker with `unitRadius + 5` it held a fraction of the ground its men were
standing on -- `unitRadius` is the SEPARATION radius, twenty-seven for a section, while the
men stand a formation's width either side of the marker. Moved onto the mean of the men it
left the marker, which is what the order line, the pathfinder and every shell are laid on,
so the mark and the thing it marked were two places. Sized to the circle that held them all
it breathed with every step they took. Then, sized to a flat ninety-two for every section,
it fitted nothing: ninety-two came off a nine-man formation and **nothing on this roster
has nine men**. The biggest is six and stands forty-eight units out; a weapon team is three
and stands thirty-two. A gun crew was drawn in a circle nearly three times the ground it
was on, and a player noticed before anything here did.

`fitRadius(u)` measures it off the unit's own formation, once, from the offsets the unit
was actually given -- which is the only way to get it right for both layouts, because a
section is laid out by `squadOffset` and a battery crew by its work's `lay` list, and those
spread to forty-eight and sixty. `def.models` would have answered for the first and not the
second. It is the formation plus twelve, a man's own width, and nothing for the lane:
`fl` is capped at 1.3 so the longest shape the formation takes already fits inside. A team
comes out at 44 and a section at 60. Measured once and kept on the unit, because a ring
that shrinks as men die is a ring that changes size.

The men are bounded to it rather than chased. Three things read it and they are what make
it true: the formation place is pulled back onto the rim along its own bearing (so the
shape is kept and only its size is bounded, and it is walked in further if the ground there
will not take a boot), a man who has fallen behind runs harder the further out he is, and
his position is clamped at the rim as a backstop. The click test reads it too, so a tap
anywhere in the circle picks the thing the circle is round. On the movement card that took
stragglers -- a man over 150 from his section -- from 2.37 per cent of man-frames to none,
and the mean distance of a man from his own marker from 76 units to 29.

**It is on the gate now**, because three of the four versions shipped and two were caught by
a player. The row measures both failures for every infantry type on the roster: the ring
against the formation it is drawn round (no smaller than it, and no more than a man's width
bigger), and then ninety seconds of battle with every living man checked against the ring
he belongs to.

**A round goes at the men and not at the marker.** `aimAt(u, t)` picks the living man
nearest the firer and `fireAt` lays the shell, the tracer and the hit on him. Laid on
`t.x, t.y` -- which is what every one of them did -- a shell burst in the middle of a
formation that had walked to a wall, every tracer went to a patch of street, and the burst
radius that decides how many men a shell actually kills was centred on nobody. It is the
visible half of the same fault the ring had: the marker is not where the unit is. A bare
point is handed straight back, because `fireAt` takes one as happily as a unit and that is
how a fire mission is laid.

**Cover is taken once, by the whole section, inside its own circle.** Three rules, and all
three are narrower than what they replaced. The piece has to be near enough that every man
gets on it without the marker moving, which is `selRadius - 16` rather than the hundred and
eighteen units it was. `chooseCover` returns a RANKED list rather than a winner, and
`updateModels` walks it until `slotsWhole` says a piece places every living man -- a piece
that takes six of nine leaves three in the open beside a wall the others are behind, which
reads on screen as half a section in cover and reads in the arithmetic as a `coverOf`
averaged between a trench and a street. And the choice belongs to the halt: `u.coverDone`
is set when a section stops and cleared only by `clearOrder`, so nothing re-picks when the
threat swings round or a man falls. The file also closes up on a short piece
(`clamp(2*lim/(n-1), 6, 9)` rather than a flat nine), because a section of nine wants
seventy-two units of wall and a garden wall twenty across gave it nineteen, so every man
past the end failed and the piece was thrown out whole.

What that cost, measured: halted men behind something 99.1 per cent to 76.1, and cover
taken over available 0.76 to 0.61 with three drills of twenty-four standing in the open
beside medium cover. **The reach is not what binds it.** Widening the circle to 108
recovered nothing at all (0.65 against 0.66 on the same card), and loosening the
`chooseCover` pre-filter from `selRadius - 16` to the whole circle changed nothing either
(0.61 both) -- what binds is the whole-section rule and the pick-once rule, and after that
`coverSlots`'s own reach. Worth knowing before anyone tries to buy the cover back by
making the circle bigger; the circle is sized to the men and is not the lever.

Fought over the whole balance card at six runs a row against the commit before it: **-3.9
points with a standard error of 3.2, against a row-to-row spread of 21.2**, which is inside
the noise and is where a change to how men stand should land. The calibration row went 0
per cent to 67 on the same comparison, which is what six runs of two identical units does
and is the reason the card is read as a mean over its rows.

**Selecting all of a kind.** `selectSame(near)` widens a selection to every unit of the
same `key`, and the two order cards are T for the whole map and Y for what is within sight
of the units already picked. Two of them because they answer two questions: moving an arm
of the army at once, and handling the fight in front of you without dragging in the section
holding a flag four hundred metres behind. The kinds come off what is already selected, so
a mixed selection widens sensibly, and a building is never swept in because a selection
with a headquarters in it shows production cards rather than order cards.

**The sun is where December puts it.** Ortona is 42 degrees north and the date on the HUD
is the 23rd. The sun reaches 24 degrees at noon that day and is under twenty by
mid-afternoon; `SUN` was set at 46 degrees, which is a June sun: shadows shorter than the
things casting them, the ground taking the light square and the faces of the houses in the
dark. At twenty-one degrees a shadow is two and a half times its caster, the ground is in
grazing light and the house fronts are lit. The direct term carries nearly twice what it
did to pay for the graze and is warmer, because a low sun is warmer, and the sky term is
raised and cooled to fill what the sun no longer reaches, since at this elevation most of
what lands on a north face is skylight.

**The sky had never been drawn.** Its quad winds counter-clockwise, the world is drawn
front-face CW with culling on, so the one draw was culled and what everyone had been
calling the sky was `gl.clearColor`: a flat grey-green with no gradient, no horizon and no
time of day in it. It reads as haze, which is exactly why nothing ever said so, and it is
the cleanest example in this file of why a screenshot cannot review a renderer. With a sky
to put it in, the sun goes in it: `uSunS` is its own place on the screen, projected on the
CPU through the same matrix as everything else so it holds under the orbit camera and the
periscope alike, and it is two lobes of warm haze rather than a disc. The distance haze
follows it -- far ground is bright and warm looking into the light and cold with the sun
behind, which is what aerial perspective is, and it now meets a sky that has a sun in it.
Note that the desktop camera can barely see the sky at all: `CAMLIM` keeps the pitch at
0.42 or more, so the view axis is always below the horizontal and the sun is off the top of
the frame. The periscope is where to look at it.

**The sun was the only light in the game.** At twenty-one degrees it leaves a great deal of
the town in its own shadow -- a street between two blocks, the floor of a trench, the inside
of a hull -- and nothing else on the map gave any light at all. A burning wreck and the
flash of a burst are the other two, and both are things the simulation already keeps: the
wreck is what makes the smoke that blocks the eye. A forward pass pays for every light on
every fragment, so `NLIGHTS` is four on a desktop and two on a phone, compiled into the
shader the way `SHADOWS` is; `gatherLights` keeps the nearest by insertion rather than a
sort, because four is short enough that a scan is cheaper and a sort would allocate every
frame; and an unused slot carries a radius of one so its own contribution is nought without
a branch to work it out. A fire is given a slow flicker off its own position, because a
steady one reads as a lamp.

**A shadow box wants fitting to the sun it is under.** `sunMatrix`'s ortho was square in
light space. A point `d` along the sun's bearing lands at `d * sin(elevation)` up the
light's vertical axis, so a square box covers `1/sin` as much ground that way as it does
across and spends the same texels on it: at twenty-one degrees that is nearly three times
the ground for the same resolution, in the one direction the long shadows actually run. The
up extent is `rad * SUN.z` plus headroom for the tallest thing that casts.

**A box against a box has no crease.** Every vehicle here is built out of boxes and
cylinders, and until this the turret met the roof, the sponson overhung the track and the
engine grille sat on the deck with nothing whatever between them: the sun was the only
light in the scene and the sun cannot reach into a joint a quarter of an inch wide. It is
the single thing that most made a procedural model read as a stack of slabs -- the
silhouette right, the plates right, and nothing at all where they meet.

`bakeAO` asks a model once, at build time, how much of the sky each of its own vertices can
see, and folds the answer into the vertex colour, which is free: the shader already reads
it and the material was chosen from the face's own hex long before. Five things about it
are worth knowing before touching it, because each one was wrong first and the picture said
nothing about any of them.

- **It is a march, not a set of sample points.** A point test steps clean through a plate
  and finds nothing, which is the mistake `traceClear` was making before it walked the grid
  cell by cell. And the step is **half a cell**: a wall is marked one cell thick, so a ray
  stepping a whole cell lands inside the box, where nothing is marked because only surfaces
  are, and reports clear.
- **A mount is built about its own ring.** `VMODEL[k].tur` is drawn on its own matrix, so
  its vertices are nowhere near the hull's in the numbers the builder wrote down. Put both
  in one grid untranslated and the turret sits inside the engine deck, every vertex of both
  comes out buried, and the only effect is a darker tank. The mount goes where `mountPose`
  puts it. Alternative mounts are baked *against* that grid rather than into it, because
  they all stand in the same place and a grid holding every variant has each of them
  shading the one that is never fitted beside it.
- **A wall beside a deck is very nearly in the deck's own plane.** One ring of six rays at
  fifty-seven degrees puts at most one anywhere near such a wall, and that one carries the
  least weight because the weight is the cosine: a deck two units from a thirty-unit block
  came back at 0.99 with the occluder right there. Three rings, and the low one nearest the
  horizon has the most rays in it.
- **Do not blur the grid.** It is the obvious cure for the striping that a binary test gives
  and it is the wrong one: a blur puts a halo of density one cell thick around every
  surface, the march's first step lands in that halo, and every vertex on the model
  self-occludes. An isolated box came back shaded on all six faces. The march origin is
  lifted clear of its own surface cell instead.
- **The calibration is the whole thing.** A crease occludes two or three of seven directions
  and not all of them, so the raw number in a joint is about four tenths against half a
  tenth on the open deck beside it. Scaled at 0.58 that is a crease at 0.85 against a deck
  at 0.97, a difference nobody can see, with the whole of the dynamic range spent on the
  inside of the hull where there is nothing to look at.

**And a face carries occlusion at its corners and nowhere else**, so a plate two hundred
units long is four numbers with a gradient smeared between them. `aoSplit` cuts the big
flat ones into a grid first, and only flat ones: a bilinear split of a face that is not
planar is a different surface from the fan the triangulator would have made of it, and the
seam against its unsplit neighbour shows as a crack. The cap is on the quad count rather
than per axis, because a cap of fourteen a side on a two-hundred-unit hull plate is a
sample every fourteen units and the joint comes out as a gradient across the whole panel.

The same march turned the other way says how solid the model is *below* the tangent plane:
all of it on a flat panel, half of it on a convex edge, a quarter at a corner. That is what
tells an edge from a panel without anything having to know which faces were neighbours, and
a convex edge on a painted vehicle is where the paint is off and the steel is showing --
`f.wear`, which lifts the colour and takes the colour out of it.

**Three things come off the one bake and they are the same fact read three ways**: how shut
in a piece of the model is, which way it faces, and how high it sits. Occlusion is a
darkening. **Grime** is what collects in what is shut in, and that is a colour rather than a
darkening -- a joint packed with oil and dust is browner than the plate round it and not a
dimmer green. **Dust** is what the road throws at the bottom of a hull and what settles on
anything that looks up, and it is read off the model's own height rather than the world's,
so a tank on a slope is still dirtiest along its belly and cleanest on its roof.

**And the plate had no surface.** The atlas tile is a luminance and the lighting read the
face's own normal, so a plate with grain painted on it was still a mathematically flat
plate: the grain went light and dark with nothing and did not move at all as the light came
round. Two more taps give the tile a gradient and the gradient bends the normal, which is
the difference between Zimmerit combed into the paste and Zimmerit printed on a slab. The
tangent frame is the triplanar axis pair the uv was projected along, which is the same test
the triangulator made. It is `#define BUMP`, off on a phone, which has not two more taps a
fragment to spare beside the nine the shadow already costs. The strength is one constant
for every material on purpose: a smooth paint tile has small gradients and bumps a little,
a combed Zimmerit tile has large ones and bumps a lot, so the material's own texture sets
it. At five it is corrugated iron; it is 1.1.

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
what it pointed at. `AI0` is what that plan is at the start of a battle and `aiInit`
copies it: the reset used to be a second hand-typed list of the same twenty-five
assignments, and two lists of one thing go out of step the moment somebody adds a field
to one of them.

**What it is allowed to look at.** Three things it stands on, and everything else reads
them.

`AIW` is **the picture**, assembled once at the top of the tick by `aiLook` and read by
every rule. Before it there were thirteen separate walks of `G.units` in a tick, each with
its own idea of what counted -- some skipped a unit the side could not see and some did
not, some skipped a retreating one, some a man inside a carrier -- so adding a rule meant
writing a fourteenth walk and choosing those conventions again, usually differently. It is
one walk now: both sides classified, both orders of battle, both strengths, the money, the
population, what is still in the queues, a rollup of every sector, and a two-hundred-unit
bucket index of the enemy so that `aiNear(x, y, r, fn)` answers a question about a piece
of ground in a handful of cells. It is rebuilt every tick and may hold unit references,
because nothing in it outlives the tick that made it.

`AIM` is **the memory**, and it is the opposite: it persists, so like `AI` it holds nothing
but numbers and ids. Where each enemy was last seen and when (`AIMEM`, thirty-four
seconds), what ground has cost it men (`lost`, fed from `killUnit`, halved every ninety
seconds by `aiFade`), what kind of thing did the killing (`lostTo`, which is a different
question from what he owns -- a Tiger parked in his own base counts once in the order of
battle and never in this, and `aiCutLadder` reads it to bring the answer to armour forward
when armour is doing most of the killing), and how long each sector has been in the hands
it is in (`held`). A brain with no memory can only be omniscient or blind. It does **not**
feed `aiThreat`, for the reason set out there.

`AIR` **counts**. Every named decision declares itself once at load and bumps a counter
when it fires, and `tools/brain.mjs` prints the list with the zeroes in it. This file
already records a duck rule that parsed, passed the gate and never fired once, with
nothing anywhere to say so; that is the hole this closes.

**The staff work is allowed the map; the guns are not -- including the brain's.** `acquire`
refuses anything the side cannot see, which is what the fog of war rests on, but it honours
a forced target without asking, and `aiPickTarget` is where forced targets come from. So
the brain was walking sections onto units nobody had laid eyes on, and one round in five
that left a barrel was fired at something unseen. `aiPickTarget` now asks `aiKnown`, which
is *seen now, or seen within the last thirty-four seconds and still about where it was* --
honest without being blind, which is the first thing the memory bought. The same test went
on the tank's back-off reflex, which was reversing away from launchers it had not seen.

Measured with `tools/brain.mjs --base=HEAD` over a four-minute battle with a brain on both
sides: targets picked that had never been seen 47.1 per cent to 29.3, attack orders on
them 36.6 to 18.0, rounds actually fired at something unseen 18.4 to 10.7. What is left of
each is the memory doing its job -- a contact half a minute old is a fair thing to shoot
at -- and of the rounds, a target that went out of sight after the gun had already picked
it, which is the combat model rather than the brain. Whole-army walks a tick went 4.8 to
1.0 and a tick went from 0.44 ms to 0.47, which is the trade: one assembly with one set of
conventions costs a little more than four partial ones with four. Named decisions counted:
none, to thirty-nine. Against the last commit the tactics card puts the whole pass at a
pair difference of -76 with a standard error of 264, and -12 with 327 on an earlier run:
twice inside the noise, which is what a framework pass should read.

**What one unit is allowed to look at.** `AIS`, filled by `aiSense(u, W)` once per unit per
tick, and read by every decision below it. `AIW` is what the side knows; this is what one
section leader knows looking out of his own position, and it exists because every per-unit
decision in the brain used to be made from a single input. Suppression alone decided
whether a section went to ground. A launcher inside a hundred and ninety alone decided
whether a tank reversed. Distance alone decided which flag a section walked at. Every one
of those is a true fact and not one of them is a situation, and a rule built on one answers
the fact correctly and the battle wrongly: a section pinned by a machine gun in a ditch and
a section being shelled by a tank it cannot scratch carry the same suppression and want
opposite things done about them. The brain could not tell them apart because it had never
asked what was firing.

So a unit reads the whole of it first and decides afterwards.

- *Itself*: strength, hit points, suppression, whether it is pinned, veterancy, whether a
  track or a gun is out, the cover its men are actually standing in, the room it has.
- *What is shooting at it*: `damage()` now writes down who did it, with what and when
  (`u.hurtId`, `u.hurtT`, `u.hurtVeh`, and `u.hurtAmt`, a running tally that fades), which
  nothing anywhere recorded before. How hurt that thing is comes with it.
- *What else is round it*, rolled up by what it can do to this rather than by what it is.
  `S.danger` is the weight of what can actually get through this unit's plate, so a Tiger
  two hundred out is a great deal of threat and no danger whatever to another Tiger's
  front. `S.canAnswer` is whether it can hurt the worst of it back, which for infantry
  against armour is usually the whole question. `S.weakest` is the nearly-dead one within
  reach, because a thing about to die is worth standing to kill.
- *Its own people*: how much weight is beside it, whether it has infantry escorting it,
  and `S.frAt` -- the nearest friend that can open the tank it cannot.
- *The job*: its objective, how far off, what is on it, and how long that ground has been
  in the hands it is in (`AIM.held`, which is what tells a position from a place somebody
  walked onto thirty seconds ago).

It is honest. `aiThreat` is deliberately allowed the map, for the reason set out on it, but
this is a man looking out of a window, so every enemy in `AIS` passes `aiKnown`.

**It weighs the options rather than taking the first one that fits.** `aiWeigh(u, S, W)`
scores what the unit could do against what each option is for and returns the winner; a
score under the floor means get on with the job, which is what most units do on most ticks.
What it replaced was a chain of reflexes tried in a fixed order, which means the decision
was made by whoever wrote the order of the lines. A tank both caught side-on to a Pak and
closed on by a launcher backed away from the launcher, presenting to the Pak the plate it
had been about to turn out of the way, because the launcher rule happened to be written
first. A section that had just shot a Sherman down to a tenth of its hit points went to
ground and let it drive off, because the duck rule fires on suppression and suppression is
all it read.

The options are `stand`, the four ways out of the open (`house`, `cover`, `back`, `ground`),
`hold`, `call`, and for armour `backoff`, `face` and `withdraw`. Each is argued with rather
than triggered: the cover it would gain against the cover it has, the ground it would give
up against what that ground is worth and whether anybody else is on it, whether there is
room in the lane to get sideways at all, how close the thing is it would be breaking
contact with, how hurt the launcher section is that it is reversing from. `stand` is the
option that did not exist, and it fires more than all four ducks together: every reason to
stay was a reason the chain never asked about.

**It can ask.** A section that meets a tank has three honest answers and the brain had one
of them: die where it stands, go home, or get behind something and say so. Nothing in this
army could say anything -- every unit decided alone out of what it could see, and there was
no way for what one of them found to become anybody else's business, so two Panzer IVs
screened an empty approach four hundred units off while the section that could have taken
the flag was shelled off it.

`AIQ` is the call board, one per side, and like everything else that outlives a tick it
holds nothing but numbers and ids. A unit that meets something it cannot answer raises a
call (`aiCall`) -- where the trouble is, what kind of thing is wanted, and what answering
it is worth. `aiCallTend` works the board once a tick inside `aiLook`: a call whose caller
is gone, whose trouble is dead or has been lost track of, or that nobody has answered in
half a minute comes off it, and the rest are kept pointed at where the trouble is now
rather than where it was. `aiAnswer` deals them after the plan has dealt everything else,
worth first and nearest capable thing within that, two to a call, and whoever is sent gets
`answer` as a job, which outranks the plan. The caller reads its own call back -- how far
off the answer is -- and that is what lets it hold the cover it has instead of walking into
the tank, which is what the plan says, or walking home, which is what the retreat rule says
once the tank has done enough.

Three things about it are worth knowing. **A gun team is never an answer**: it belongs
where it was sited covering the ground armour has to come up, and walked across the town to
somebody else's trouble it arrives in the open, out of its own arc and unset up. The weapon
test sorts the rest out on its own, because a rifle section fails it and an assault section
with a launcher does not. **Holding is only worth it if somebody is coming**: the first
version held on the call alone and sections stood still through eleven per cent of every
unit-tick of a battle while help reached a third of it, so `hold` now wants an answerer
actually dealt and `call` on its own costs a tick. And **the trouble has to be this unit's**:
a tank four hundred out shooting at somebody else is a fact about the battle, not a reason
for this section to stop, so it has to be hitting them, or inside two hundred and fifty, or
sitting on the ground they were sent to take.

Armour calls too, both ways. A Sherman that cannot open the front of what is in front of it
asks for something that can and keeps the range open while it waits, rather than sitting
and watching. And a tank backing away from a launcher asks for men: opening the range buys
time and nothing else, and that rule is the one place that knows it has no section walking
beside it.

Measured with `tools/brain.mjs --base=642882e` over a five-minute battle with a brain on
both sides. **The duck rule fired once in the whole battle at the last commit and
thirty-seven times now**, which is the real finding: the reaction to being shot at in the
open was written, gated, counted and for practical purposes absent, and nothing said so
until the weighing put it up against an alternative. `stand` is chosen on about four unit-
ticks in ten and did not exist. Sections are routed to somebody else's trouble on nine per
cent of unit-ticks, a call is answered within five to seven seconds of being raised, and an
answerer is in contact with what it was sent at for eighty to ninety unit-ticks a battle.
A thinking tick costs about 0.6 to 0.7 ms against 0.5 before, which is what reading the
whole situation for every unit on every tick costs.

How the calls end is the part still worth work. Of thirty-four raised in a battle, half
ended because the caller was dead or retreating before the answer did anything, twelve
lapsed and two ended with the tank dead. That is partly the nature of infantry meeting
armour and partly that the answer arrives late: a call is answered in five seconds and the
answerer is a tank's drive away from the trouble. What was fixed off that number is the
lapse -- a call whose answerer is in contact is not stale, the fight it asked for is
happening, and timing it out in the middle of one un-deals the tank that is in it.

Read those as orders of magnitude and nothing finer. Two runs of *identical* code came back
with thirty-four calls raised and thirteen, `stand` on 36.4 per cent of unit-ticks and 44.0,
and a tick at 0.71 ms and 0.59. A battle here compounds, and what a brain meets depends on
what it met ten seconds earlier.

On the tactics card the whole pass is a pair difference of -21 with a standard error of 302
over four pairs against the commit before it: inside the noise, which is the honest answer
for a change of this kind and the one the tool almost always gives. The control run beside
it -- the same card against a revision identical to the working file -- came back at -181
with a standard error of 173 over eight pairs, so neither number is anything but the map.
Every rule in the pass stands on whether it is right.

**The ground costs what it costs to cross alive.** Every route the army took was priced on
what it cost to walk -- the metalling, the wire, the field wall, the room it had to squeeze
through -- and on nothing whatever about what was shooting down it. So a section ordered to
a flag three hundred units off took the street, because the street is the cheap way, and
the street had a machine gun at the end of it.

`DANG` is the beaten zone: two grids a side at half the movement grid's resolution, `inf`
for what will hurt men and `veh` for what will open armour, because a rifle section and a
Tiger are frightened of different things and a Pak covering a crossroads paints the second
and barely the first. It is **cast**, not stamped: rays out of each contact until something
stops the eye. A disc of danger round a machine gun says it threatens the street on the far
side of the block it is standing behind, which is the opposite of the truth and would route
the army round the one place it was safe; casting is also cheaper than the disc. Everything
in it comes out of `AIM`, so it is only as good as where the side has been -- which is the
point rather than a limitation, and is what the probe exists to fix.

`cellCost` charges for it and `u.fear` is what a particular move will pay to stay out of
it. A wave pressing home pays almost nothing (0.3), because crossing the beaten zone under
covering fire is the whole of what a wave is; a section walking to a flag pays 1.05, a
retreat 1.4, an engineer 1.3 and a scout 1.7. Nothing is forbidden by it, for the same
reason nothing else in `cellCost` is.

Measured on a staged drill -- a machine gun sited on the direct line of five crossings of
the town, a section asked to walk past it -- exposure along the route falls ninety per cent
for ten per cent more walking, and two of the five legs find a way the gun cannot see at
all. Painting the field is 0.08 ms.

One thing had to be fixed for it, and it is the thing to know before touching the cost
model. **The straight-line shortcut has to ask two questions, not one.** Folded into a
single priced line the danger term rejected nearly every shortcut, so the full search ran
on every order at eight times the cost, for a route no different from the straight one
wherever nothing was looking. The difference between the priced and the unpriced line *is*
the danger integral, and that is the number to threshold.

**What the army is trying to do.** `AIOP`, one list a side. An objective list says what
ground is worth; it does not say what the army is doing about it, and until now nothing
did. There was one wave, kept in eight fields spread through the plan, and everything not
in it was a unit walking at the nearest flag. An army with one operation has no second
axis, can commit nothing to anything that is not ground, and cannot tell a plan that has
failed from one it has not finished.

An operation has an aim, a force, a method, a clock and a test for being over. A unit
carries the id of the one it is on (`u.op`), which outranks the job the plan dealt it, and
`aiInWave` excludes it so the wave does not stand waiting for a section that has been sent
somewhere else. Six kinds:

- **take** and **raze** are the main effort -- the wave, and in annihilation the wave
  against a building. Its state is still the wave's own, because the form post that steps
  back until the ground it gathers on is quiet, the half-strength floor, the support gate,
  the late go and the momentum re-form are a great deal of hard-won detail and moving them
  into the record would be a rewrite with nothing able to say whether a piece had been
  lost. What the record adds is that the main effort is one of the things the army is doing
  rather than the only thing it can be doing.
- **probe** sends one cheap thing to look at ground nobody has eyes on and ends the moment
  it can see it (`aiScouted`). It pays for itself twice: everything the brain knows about
  the enemy comes out of contacts, contacts come from having looked, and the beaten zone
  the whole army routes around is painted from them. A prober is not forced onto a target
  -- with no forced target its own `acquire` still fires at what is in front of it while it
  keeps walking, which is what a section moving under contact actually does, and the first
  version stopped at the first thing it saw and never scouted anything.
- **destroy** is a task force against one named thing. What is worth one is a *kind* of
  thing rather than a price: armour, a weapon team, or anything elite. Priced instead, the
  first version wanted anything over two hundred and sixty and a full-strength section is
  worth two hundred and fifty, so it never once fired.
- **feint** goes to the fire post short of a flag well away from the main effort, where it
  can be seen and can shoot at what is on it, and stays there. A demonstration that walks
  in is an attack, and a two-section attack on a defended flag is two sections spent on
  ground nobody wanted. It works on this opponent for the same reason it works on a real
  one: `aiThreat` is what sizes the effort put against a sector, so men standing where they
  can be seen pull weight off the place they are not going.
- **hold** puts weight on ground it owns that is being come for. The plan already scores a
  held sector a little higher, but a preference does not put men on a flag and keep them
  there while it is attacked.

Bounded hard: one of each at a time, and never more than a third of the fighting strength
off the main effort, because an army running five operations is an army running none.
`aiOpsReview` ends them, `aiOpsPlan` decides what should exist, `aiOpsMan` deals the force
and a unit already on an operation stays on it -- re-manned every tick it is a section that
walks halfway to two places.

**And what the ground has already cost.** `AIM.lost` has remembered where this side's men
have died since the memory was built and the objective scoring ignored it completely: an
army that had fed three sections into the same flag one at a time wanted it exactly as much
as it had the first time, and went again. It is a capped penalty, because ground that is
dear is not ground to be given up -- it is ground to be gone at with more, or later -- and
an uncapped term walks the army off the map.

Measured over a five-minute battle at veteran with a brain on both sides: two operations
open at any moment, a quarter of the army's unit-ticks spent on one that is not the main
effort, and five per cent of the map painted as dangerous to men. All five kinds fire in a
single battle. A probe runs about twenty seconds and ends because it can see the ground, a
destroy forty, a hold under a minute, the main effort twenty to fifty.

**Whether a feint draws anybody is not known.** The card measures the right thing -- the
enemy weight within 420 of the ground it demonstrated against, at the moment it started and
the moment it ended, because nothing else the brain does moves that number at that place --
and three runs of two feints each came back 410 to 661, 0 to 85, and 325 to 240. Two up and
one down out of six feints, on a battle whose absolute level is wherever the fight happened
to be. The first two runs read as a direction and the third says they were not one. Settling
it wants a staged drill rather than battle sampling: a feint put deliberately at a known
sector, the same battle run with and without it, which is the shape `tools/move.mjs` uses
for the beaten zone and the only way any of these tactical claims has ever been settled.
The rule is in because it is right, and it is cheap now -- one section out of an army of
twelve, at veteran.

**A `hold` has to hold from a position, not from the middle.** Its first version aimed at
the sector's own point, which is a coordinate in the open by construction, and parked two
sections on it for the life of the operation: halted men behind something fell from 98.8
per cent of man-frames to 90.1 on `tools/move.mjs`, which is the whole of what the cover
overhaul bought, given back by an operation that meant well. It takes a house on the flag
if there is one and otherwise the best cover within a hundred of the point, which is still
inside the circle that counts. The card caught it and nothing else would have: a screenshot
of two sections standing on a flag is two sections holding a flag.

Fixed it reads 97.3 against the 98.8 it was before the pass, and the card's own control --
the same battle run against a revision identical to the working file -- puts its two halves
0.3 apart, so the remaining point and a half is probably real and is not established. If
you are comparing against 98.8 and wondering, that is what is known about it.

**An operation is paid for in ground, and the first version could not afford it.** This is
the one thing on this page the tactics card was able to see. Against the commit before the
pass: -470 with a standard error of 154 over eight pairs, the tool's own line saying it
cleared twice that, and the working brain ahead in one of eight same-side comparisons --
with the control on identical code clean at +110 over the same eight pairs, so the tool was
not lying. Isolated to the operations commit alone it was -463 with a standard error of
146, which is the whole of it: the beaten zone costs nothing.

The per-side table said why. Ground held roughly halved (4.1 sectors against 8.8), the
sections more scattered (clump 168 against 161 on the other side of the map, and 211
against 147 on the run before) and the army pushing less far. That is the shape of an army
with a third of itself committed to things that capture nothing, because only the main
effort and `hold` take ground at all and this map pays by the second for ground held.

Two things were cut. The share is two units out of an army of eight or more rather than a
third of the fighting strength. And **an operation is manned out of what cannot capture
anyway**: `aiOpsMan` prefers armour by a long margin, because a vehicle that cannot carry
men cannot take a sector however long it stands on one, so a task force built out of the
screen costs the capture allocation nothing, while a section taken off the dealing is a
flag nobody is standing on.

The cut does not disable it: the operations still run, at 1.45 open a tick against 1.84 and
275 unit-ticks of the army's time against 827, which is nine per cent of it rather than
twenty-five. `destroy` is rare enough now to miss a battle entirely, which is what wanting
two units out of two costs it.

Refought after the cut: **-163 with a standard error of 201 over eight pairs, inside the
noise**, and the working brain ahead in four of eight same-side comparisons rather than
one. Ground held came back from 4.1 sectors to 5.6 against the baseline's 6.4, and 6.1 to
9.4 against 10.1. What is left is a small deficit in ground that the tool says would take
about fifty pairs to see, so it is not known whether it is there at all. That is the right
place for a change of this kind to land: the agency is kept and the army is paying a price
for it that nothing can measure.

**Order the planning by urgency, because room is the scarce thing.** There is room for
another operation on fewer than half the ticks -- four kinds wanting seven slots out of the
third of the army they are allowed between them -- so whichever is considered first wins.
Written with the discretionary one first, the probe is cheap, nearly always available, and
took the last slot on sixty-three per cent of ticks: the two operations that exist to
answer a tank in the rear and a flag being taken off us lost to a scout every time.
Reordered reactive-first (destroy, hold, probe, feint) the destroy operation went from
twenty-one tick-samples in a battle to fifty and the probe's churn from four hundred and
forty-five to two hundred and fifty-one.

And the way to find out why a rule never fires is to count its gates separately rather than
to guess which one shut. Guessing got the destroy threshold wrong twice. Counting said
immediately that a prize worth a task force is on the field on nine per cent of ticks, is
killable on six, and that room existed on thirty-seven -- which is a rule that is working
and rare, not a rule that is broken.

**The second layer of inputs.** Everything above reads the enemy as a set of places: where
a contact was, what is within four hundred of a flag, what is in front of a section. Five
more things are read now, each written down where it happens and read off the picture by
the rules that want it, and `tools/brain.mjs` prints them as INTENT.

*A contact carries a heading.* `aiRemember` keeps where a contact was last seen and derives
a smoothed velocity from one look to the next (`c.vx`, `c.vy`), reset when the contact was
lost for six seconds, because a heading from where it was last seen to where it turned up
is a line through whatever it did in between. `aiMass` reads the enemy's intent off those:
the heaviest cluster of fresh contacts within two hundred and sixty of one another, its
shared heading, and the held sector that heading runs onto within forty-five seconds
(`M.mass`, with `sec` and `eta`); standing still it is a position and says so with no
sector. Each held sector's rollup gains `coming`, the weight whose next twenty seconds of
line pass inside it while closing on it -- the nearest point of the segment and not the
point at its end, because a section that will be past the flag by then walks over it on
the way. Three rules read it: the `hold` operation goes up for a body twenty seconds out
and not only for weight that has arrived (`hold.coming`), the objective list gives a flag
being walked onto men now while they can still get there (`obj.coming`), and a body worth a
third of the enemy's strength closing on a held flag takes the mood off push while it is
closing (`mood.mass`). The tubes read it too: a mission into a wave while it gathers is laid
where it will be when the rounds arrive, before the objective's defenders get theirs
(`mortar.mass`), because a gathering is the one time the enemy stands still in the open.

*Fire superiority.* The rollup also carries `pinned`, the share of the known enemy weight on
a sector that is suppressed, and the wave reads it at the go. Set up is not the same as
firing and firing is not the same as the defenders being pinned, so a formed wave now
waits, bounded, for one of three things: the defenders on the objective mostly pinned, the
support firing for eight seconds (`AI.supT`), or nobody there to pin, with the form timer
bounding it at a third over so a gun that cannot find a target does not stop the battle
(`wave.wait`, `wave.pinned`). Green goes when it is formed, which is what green is for, and
a wave with a section already inside two hundred and forty of the objective goes too,
because it is already in the fight and holding it there for fire it is under without is
the queue in the open the wait exists to prevent. That exception was found on a card
whose Canadian side could not buy (see the till lock under SIMPLE): there the baseline read
forming as nought seconds on every wave that went in, because a wave that formed with its
sections already on the objective went in on the tick it formed, and the wait turned those
into twenty-six, thirty-five and fifty-three seconds of standing on three runs. With two
armies on the card and the exception in, forming reads 16 seconds against the baseline's
11, and the wave count is the number to watch: 32 formed and 13 went in against 14 and 11,
which is a wave that waits being re-keyed by the sixty-second re-pick or broken off before
it goes. The tactics card cannot see it (below), and it is left as the lever it is. And
the pinned door is not one the battle has opened: read on the wave's own objective, the
pinned share of the defenders' weight is 1.44 per cent over 658 ticks with an objective,
so `wave.pinned` has never fired in a battle and what carries the go is the support firing
for eight seconds, a section already there, or the bound. The threshold is a suppression
over 0.6 on a scale where a section is pinned past 1, and lowering it is a lever nobody
has measured. And
the wave writes down what it stepped off with (`AI.asStr`): a press that has lost half of it
without taking the ground or pinning what holds it is a queue and not an assault, so it
breaks off, re-forms, and leaves that objective alone for a minute (`AI.asAvoid`,
`wave.break`) -- which is also the moment the loss memory on that ground starts saying the
same thing. Inside a press two more things hold it together: a section that has run ahead
of its wave and is being shot at goes to ground for eight seconds until the rest close up
(`wave.cohere`), and the wave's armour takes an overwatch post short of the objective with a
line to it rather than driving onto the flag with the sections (`veh.overwatch`, found once
a wave and looked for again every fourteen seconds because `aiOverwatch` is twenty-one
traces).

*The exchange and the clock.* `killUnit` writes a kill down for the side that made it as
well as the loss for the side that took it (`M.exK`, `M.exL`, each with a minute's
half-life), and the picture carries `W.exch`, the ratio smoothed so that two kills in an
empty minute are not a rout either way. `aiClock` reads the drain `tickEconomy` applies and
says how many seconds each side has before its points are gone at the flags held now
(`W.clock`). The mood reads both after the ratio and the lead: losing on the clock it stops
holding and pushes for a victory flag, because holding a losing hand is losing; winning on
it comfortably it holds what pays (`mood.clock`); losing the exchange badly it stops pushing
unless the clock says it has no choice, and winning it two to one it pushes whatever the
count says (`mood.exch`). Dig is left alone by the clock, as it was by the lead.

*Sound ranging.* `damage` writes down whether a hit came out of the sky (`u.hurtInd`), and a
tube that shells this side is heard: `aiHeard` writes a contact for it with an error that
shrinks with every round, two hundred and twenty units on the first and sixty by the fifth,
flagged `heard` so that nothing wanting a heading or a body reads it as one and the beaten
zone is not painted from it. `aiKnown` accepts it the way it accepts a contact seen half a
minute ago, which is what lets a mission be laid on it (`mortar.counter`, second after the
massing body and before the objective's defenders) and a task force sent to it (a tube is
worth three hundred and twenty more than anything else to `destroy`, and `W.heard` puts it
in front of the planner, `op.counter`). It is honest by the same test as the rest of the
memory: a section walking to a heard tube walks to where the sound was, and finds it there
or does not. The situation carries `shelled` as well, whether or not the tube is known,
because a beaten zone is a place and the answer to it is to be somewhere else: under
shellfire going flat is worth thirty less and giving ground twenty-eight more
(`shelled.move`).

Measured on `tools/brain.mjs --t=300 --diff=2 --file=<the commit before, with the till
lock fixed>` over one battle of about 290 seconds a side with a brain on both sides and both
of them buying, which the earlier runs of this card were not (the till lock, under SIMPLE).
A thinking tick is 0.86 ms against 0.82, which is the cluster over the contacts and the
clock. The memory holds 5.2 fresh contacts a tick and 61.6 per cent of them carry a
heading; a body is read as massing on 80 per cent of ticks, weighing 667, and as walking
onto a held flag on 8.4 per cent of them, 18 seconds out; weight is expected onto held
ground on 49 per cent of ticks, 336 of it when it is. The exchange and the clock read
nearly symmetrically because both brains are sampled and one side losing is the other
winning: the exchange is lost badly on 10 per cent of ticks and won on 10, the clock lost
on 45 and won on 39. A tube was in the memory by ear on 4 per cent of ticks. Of the rules,
`obj.coming` fired 349 times, `mood.hold` 210 and `mood.clock` 163 -- on most of the ticks
the ratio said hold, the clock said the side was losing on it and pushed -- `wave.wait`
21, `mood.exch` 10, `wave.break` 5, `veh.overwatch` 4, `hold.coming` 3, `mood.mass` 2, and
`mortar.mass`, `heard` and `op.counter` once each; `wave.pinned`, `wave.cohere`,
`mortar.counter` and `shelled.move` never fired in it, and the card lists them with the
zeroes. Calls are the other thing two armies changed: `answer` is 16 per cent of the jobs
dealt where a card with one army read under one. Read those as one battle: two runs of
identical code on this card have come back with the same rule at thirty-four and thirteen.

On the tactics card, against the commit before the pass with both sides buying: **-46 with
a standard error of 170 over eight pairs, ahead in three of eight, and -18 with 161 over
eight more**, which is parity and is where a change of this kind lands on this tool; the
first run's per-side table has the working brain with more army on both sides (3,202
against 2,729 and 3,450 against 3,113) and fewer points on one, and the second has the
German side winning whichever brain ran it, which is one run's shape each and not a
finding. `tools/skirmish.mjs` swaps the operations planner with the rest
of the bundle now and carries the new readers, with one thing worth knowing about the
second half of that: the readers are reached through `aiLook`, which is not swapped, so
a baseline side is handed the working file's headings and clock and what the card judges
is what the two ticks do with them. The gate stages each input rather than sampling it: a
body massing onto a held flag read off four looks a second apart, a tube heard through five
rounds to within a fix, the exchange moved by a kill and by a loss, the clock read against
`tickEconomy`'s own drain, and a wave the opposition's plan is told it stepped off with far
more than it has, which breaks off in one tick of its own brain. Two things about that
drill. **The heading is smoothed, so one look reads two fifths of the true pace** and the
body's arrival would read at twenty-seven seconds off a section walking at sixty a second
where four looks read it at about nine. And **the picture has to be the drill's**: three battles have
been fought on the map by the time the row runs, the side's memory holds whatever it saw in
them, and `aiMass` returns the heaviest cluster on the map, which would not otherwise be the
three sections the row put down. The contacts are put aside and every enemy of the battle's
own is hidden until the drill comes down. The break-off half has the same shape: a wave does
not break off from defenders who cannot lift their heads, and on one phone run the tick
read the battle and held on, with nothing in the row's line to say why. The likeliest
reading is the flag's defenders being pinned, which is the one refusal in that branch the
battle's state can supply, so the row unpins whatever of his is on the flag for the tick
and prints what was there; the run after read 551 of weight with none of it pinned and the
wave broken off.

**The arms, and what each one is for.** Everything above deals a unit a job by what it is
-- sections take ground, teams support, armour screens -- and then sites it by what the
job is for, with nothing anywhere asking where the rest of the army is. So a Vickers was
posted a hundred and seventy short of the objective whether or not anybody else had got
there yet, which is a machine gun team attacking on its own; a Pak was posted the same
way, on the flag the army was attacking rather than the one it was holding; and the
armour's stand-off was a hundred and seventy BEYOND the main effort whatever its
ownership, which with the main effort an enemy flag put a tank past the enemy's own
position with nobody beside it. Measured on the brain card before any of this, over a
five-minute battle at veteran with a brain on both sides: a team stood with no section
within 220 of it on 48.7 per cent of its ticks and nearer the main effort than any section
on 11.5; an anti-tank gun was forward of the line on 13.9 and alone on 52.3; a tank was
alone on 48.5 and forward on 9.2.

Three helpers say what each arm is anchored on, and every rule below reads them. `aiAnchor`
is the line: the section on foot nearest a point, out of the whole team's men, skipping
anybody retreating, aboard or on somebody else's operation, because a scout walking at the
enemy's base would otherwise drag a machine gun along behind it. `aiFrontSec` is the
front: the held flag nearest the fight, which is what a gun that defends defends. And
`aiArmourNear` is the armour the side knows about, read off the memory, because a gun laid
on an approach wants to be laid on the approach the armour is actually using.

- **A team is never forward of the line and never alone.** Its post is anchored on the
  section nearest its aim: `aiOverwatch` and `aiMortarPost` take a floor on how far back
  (`minR`, the anchor's own distance plus forty), so the post is no nearer the aim than
  that section is; while the wave is still forming the floor is the forming-up point,
  because a gun that sets up short of the fup is a gun in front of the men it is meant to
  cover (`team.form`); and a post more than a leash from its section (260, a tube 420) is
  pulled back along the line to it (`team.close`), rearward or sideways by construction.
  It is found again when the line moves -- forward by a post's worth (`team.follow`), or
  back past the gun -- and with no sections left at all a team goes back to the front flag
  and defends that (`team.alone`).
- **An anti-tank gun is a defensive weapon.** It is aimed at the ground armour has to come
  up to the front held flag, two hundred and sixty out from it (`at.defend`), or at the
  armour the side knows about within 760 of that flag (`at.armour`), sited from four
  hundred and twenty back with a line, and then it is left alone: forty seconds between
  moves and a move only when the aim shifts by three hundred, because every one costs it
  ten seconds of packing and setting up during which it is a lorry-load of steel standing
  in a street. It is not in the wave's support gate and never was.
- **A tube is behind everything**, as before, and anchored the same way.
- **Armour is escorted.** Its stand-off is on the army's side of the main effort now --
  forward of a flag the side holds and nobody is contesting, two hundred short of one it
  does not -- and the post has to be within 250 of a section: with none that near the
  tank holds a little behind the nearest section to it and goes forward when they do
  (`veh.escort`), and with no sections at all it holds the front flag.
- **Light armour scouts and demonstrates; heavy armour hunts.** `aiOpsMan` still prefers
  a vehicle for any operation, and now prefers a LIGHT one for a probe or a feint and a
  heavy one for a task force (`op.light`, `op.heavy`), read off `bClassOf` rather than off
  a list, because an armoured car is fast and cheap and a Tiger sent to look at a field is
  a Tiger not on the line.

`tools/brain.mjs` prints ARMS for all of it, measured off the units and not off the brain's
own anchor. Three battles of the working file, one each as the rules went in: teams alone
26.0, 38.7 and 34.1 per cent against the 48.7 before, forward 1.14, 0.36 and 7.55 against
11.5; a team in action 45.4, 49.9 and 37.4 per cent of its ticks against 39.6 and walking
36.8, 29.5 and 42.0 against 53.9, with the setting-up share doubled by the longer setups
and four to seven per cent of it packing; the anti-tank guns forward on none of their ticks
in any of the three against 13.9; the tubes forward on none against 2.6. Armour read alone
on 66.6 and forward on 17.8 on the first battle, which is what sent the stand-off to the
army's side of the flag: 34.3 and 4.7 on the next, then 66.0 and 5.5. Read those as one
battle each -- the same rule fired four times on one run and none on the next -- and read
the anti-tank guns' own `alone` (52.3 before, 1.4, 50.2 and 47.8 after) as the doctrine
rather than a fault: a gun sited to defend the front flag stays there while the sections
go on to the next one, which is what a defensive weapon does, and `forward` is the number
that says whether it has been walked into the attack.

On the tactics card the whole pass -- the pack cycle, the doctrine and the light armour on
the operations -- is a pair difference of -78 with a standard error of 95 over eight pairs
against the commit before it, the working brain ahead in four of eight same-side
comparisons, which is parity and is where a change to how the arms are placed should land
on a tool that cannot resolve under a few hundred points. Every rule in it stands on
whether it is right, and the ARMS section is where that is read.

Per-unit intent lives on the unit (`u.job`, `u.jobSec`, `u.jobX/Y`,
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

**The section leader's decisions.** Made per unit, before the plan and out of `AIS` rather
than out of one number, at skill 1 and up (`skill >= 1`; green stands in the street and loses
men, which is what green is for). `aiWeigh` scores them against each other; what follows is
what each is for and what talks it out of firing.

- *Under fire in the open* a section gets out of it: into an empty house within a hundred and
  twenty (`aiHouse`), behind the nearest real cover within a dash that faces the fire (`aiDuck`,
  which for a wall is the nearest point of the wall and the side away from the fire), back a
  hundred and fifty the way it came, or flat where it stands. The threshold is low on purpose:
  suppression climbs from nothing to pinned in a few seconds of machine gun fire and decays at a
  fifth a second, so a rule that waited for half suppression found the men already pinned or
  already recovered. What talks it down is `stand`: a hurt enemy within reach that it can finish,
  cover it is already in, friends who outnumber what is in front of it, veterancy, and ground it
  is holding that is worth more than the walk. A house is worth less when the thing shelling it
  is a tank; going flat is worth less with armour inside two hundred and sixty; giving ground is
  worth less when nobody else is on the objective and worth nothing when the nearest enemy is
  too close to break contact from.
- *The odds*: a section outside a wave whose objective is held by more than twice what it is
  bringing (itself, the men already on the flag, the men moving with it) goes to the fire post
  three hundred short of the flag instead, the same point a wave against it would form on, and
  looks again in twenty seconds (`u.holdT`). It does not stop where it stands, because where it
  stands is usually the middle of a street: the first version froze in place and the army's
  reach fell by a third. Two things were added to it. Ground that changed hands inside the last
  twenty seconds is not a position -- nothing has been dug, nothing wired, and whoever took it
  is still sorting itself out on top of it -- so the odds are waived up to about three to one
  (`odds.weak`). And if what is holding the flag is armour this section cannot open, sitting
  three hundred back looking at it answers nothing, so it raises a call and the flag becomes
  somebody's job rather than nobody's.
- *Armour on its own backs away from infantry with a launcher* (`u.def.at`, which only the
  airborne, the Fallschirmjaeger and the Panzergrenadiere carry) inside a hundred and ninety
  when no friendly section is within a hundred and fifty, opening the range two hundred and
  firing as it goes (`u.backT`, nine seconds between), and asking for men while it does. A
  launcher section at a quarter strength is a section to shoot rather than to reverse from, and
  the scoring now says so.
- *It fights with its front to the gun*: a halted tank caught more than a radian off its facing
  from a visible gun that can open it, between two hundred and five hundred and forty out, drives
  at it a hundred and sixty-five to turn (`u.faceT`, eight seconds between). There is no pivot in
  place, and a move short of a hundred and fifty behind the vehicle is taken by the driver as an
  instruction to reverse, which would present the rear plate instead. This is the one the fixed
  order used to lose: a tank both caught side-on to a Pak and closed on by a launcher took the
  launcher rule because it was written first, and reversed showing the Pak the plate it had been
  about to turn away.
- *And it withdraws*: a tank down to a third with something in front of it that can open it, or
  one with its gun out, pulls back out of the beaten zone. `mend` is the older answer to the same
  problem and it needs an engineer to exist; without one the tank used to fight where it stood
  until it was a wreck blocking its own street.

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

**A gun's report is read off the WEAPON, the way its muzzle flash already was.** Every
piece on this roster that fires a shell played one of two sounds -- `cannon` if it was on
a vehicle or a crew and `rocket` otherwise -- so a mortar dropping an eighty-millimetre
bomb over a roof, a Pak 40 and a two-hundred-and-ten-millimetre battery were the same
noise at the same level, and the six artillery pieces were that noise six times.

`gunVoice(u, w)` is the fix and it is the same decision `muzFx` made for the eye, for the
same reason: two lists of one thing go out of step the moment somebody adds a weapon to
one of them. What separates one report from another is the shell and the charge behind
it, and the weapon already carries both -- the burst radius says how big the projectile
was and the penetration says how hard it was pushed. Those are the two numbers the flash
is sized off, so the ear and the eye read the same physical fact. `muzClass` gives the
SHAPE and it is the same list for both, because a second list of gun kinds is a second
list to keep in step: a tube (`mortar`), a bark (`how`), a blow (`heavy`), a tank gun
(`gun`) and a high-velocity crack (`at`). An even voice is the 75 the whole roster used
to fire, so nothing about a Sherman moved and everything else moved away from it.

**And the side is the ear's `FLASHC`.** German propellant is drier and cracks higher and
the Commonwealth charge is rounder with more body -- one number a player picks a side out
by, the same claim the flash colour makes. It is there because nothing read off the weapon
will ever separate an M1 81 mm from an 8 cm GrW 34: they throw nearly the same bomb on
nearly the same charge, and the numbers agree (a pitch of 1.17 against 1.16). `AUSIDE`
moves the CRACK and not the body, because the propellant sets the colour of the edge and
the shell sets the pitch of everything under it. Written the other way about, the side
shifted the body too, and since the German piece of each pair throws the heavier shell the
two effects cancelled and the two heavy batteries came out at the same pitch.

**The tube ring is where the two mortars are told apart**, so it carries rather than sits
under the thump. At a fifth of the thump's volume it was inaudible in the measurement as
well as in the ear: the pair read 1.03x in onset colour, which is what the same piece
rendered twice reads, so there was no difference to hear. At two fifths they read 1.12x
against a floor of 1.01x.

**A shell landing is the shell that landed.** `burstVoice(r)` is the other half, off the
one number `explode` already has, so a mortar bomb at thirty-four of burst and a 210's
shell at a hundred and forty are not the same event on the ground either. It has no side
in it, because a burst has no propellant.

**And a round in the air makes a sound now.** An indirect round was silent between the
tube and the ground, which is a strange thing for the one weapon on this roster a player
is meant to move out from under: the incoming is the only warning there is. It is pitched
off the same burst the landing is -- a bomb comes in as a thin whistle and a
two-hundred-kilogram shell as a freight train -- it is played at the ground it is coming
at rather than at the tube, and it is timed to FINISH where the shell does rather than to
start there (`burstVoice().lead`, half a second for a bomb and most of two for a heavy).

**Loop.** A single `frame(now)` in the last section steps every system with one
`dt` (clamped to 50ms) and then calls `render()`. There is no fixed timestep
and no separate update thread.

**The after-action record.** A battle is twenty minutes of decisions and the only thing
that used to survive it was a sentence saying who won. `REC` is what happened, kept AS it
happens rather than reconstructed at the whistle, and that is the whole design decision
here: nothing at the end of a battle knows what a section did before it died, and most of
what is interesting belongs to units that are no longer on the field.

Three layers, and the second two are read off the first. A row per UNIT -- `recBorn` opens
it, and it carries kills, men killed, vehicles, men lost, damage in and out, rounds, when
it was raised and when it died. A row per TYPE, rolled up from the units every time the
page is drawn rather than kept alongside them, because two tallies of one thing go out of
step the moment somebody adds a column and a player reading a total that does not match the
rows under it has no reason to believe either. And a row per ARMY: earned, spent, what it
raised, what it built, sectors taken, peak strength and peak population. Plus a timeline
sampled every two seconds, which is what the graphs are drawn from and which at six hundred
samples of eight numbers is small enough to keep in `localStorage`.

The hooks are `recBorn`, `recKill`, `recMan`, `recHurt`, `recFired`, `recEarn`, `recSpend`,
`recBuild`, `recWork`, `recCap` and `recTick`, each at the one place the thing actually
happens. Two of them are worth knowing about. **Damage is recorded as APPLIED**, after
every multiplier and capped at what the target had left: a forty-point round into a man with
eleven points is eleven, and the figure on paper is not the figure that mattered. And
**`recBorn` records what was raised and nothing about what it cost**, because spending is
counted in `pay`, which is the one place money leaves the till -- charged in both, the three
sections each side opens with came out as 650 marks nobody ever spent.

Everything in it is a number or a string. It outlives the battle, so like the AI's own
memory it may not hold a reference to a unit, a sector or a building.

**The page it is read on.** Five tabs over that one record, split by the question rather
than by where the numbers live: OVERVIEW is who won and by how much, ARMIES is what each
side raised and spent, BY TYPE is every Sherman against every other Sherman, EVERY UNIT is
one row for each thing that was ever on the field, and GRAPHS is the shape of the battle.
The graphs are canvases (`stDrawGraph`), two series on a shared scale, because the question
every one of them answers is who was ahead and two charts side by side cannot answer it;
each carries its own colour key, since two coloured lines with nothing to say which is which
is a picture of a battle nobody can read.

**And the map comes first.** `specStart` takes the 2D chrome away (`body.spec`) and leaves
the battle on screen with one button on it, because the moment a player most wants to look
at the ground is the moment the game-over panel used to cover it. The simulation stays
stopped: this is a look at how it finished rather than a continuation.

The record is closed and written to the history in `endGame`, at the whistle rather than
when the report is opened, so a player who presses FIGHT AGAIN without reading it still
finds the battle in PAST BATTLES next time. Two dozen are kept under `ORT_HIST`, newest
first, and the title screen opens the list without a battle behind it.

One thing caught by the gate and by nothing else: **the game-over buttons are `.obtn` and
not `.pill`**. The title screen binds every `.pill` on the page as a side picker, by class
and with a plain `onclick =`, and it runs after the wiring here -- so a button that borrowed
the look silently borrowed the handler with it and did nothing at all when pressed.

**Field works.** `WORKS` is what a section of engineers can put up during a battle:
sandbag wall, weapon pit, wire. Placement is `placeWork`, which pegs a site out on a
bearing; `finishWork` turns a finished site into a `G.works` entry, a piece of cover laid
on that bearing, and for wire a mark on a grid that holds infantry up. The scene buffer
is built once before the first shot and cannot take anything raised after it, so each
work builds its own little buffer in world coordinates (`workFaces`, `conformFaces`) and
is drawn per piece. The player aims one by pressing where it goes and dragging toward the
enemy; the bearing matters because `coverValue` strips two grades off fire that comes in
along the line of a parapet rather than across it.

**A weapon pit is a HOLE, and for the life of the game none of the thirty-three the two
maps ship was one.** `WORKS.pit.dig` sends a work through the shell hole's own `carve`,
and it had exactly one reader, `finishWork`. A map pit is a `t: 'emplace'` entity handled
in `buildMap`, which laid its cover, pushed its stack of bags and dug nothing, so eleven
pits on Ortona and twenty-two on the Gothic Line were a horseshoe of sandbags standing on
undisturbed grass. From above that is the same picture as a pit, which is the whole of why
it lasted: the bags drew, the cover indexed, the crew stood in it, and the one thing a pit
IS was missing.

Measured off the heightfield rather than looked at, the floor-to-crest relief of a shipped
pit was -0.01 units on Ortona and 0.04 on the Gothic Line, against a CONTROL of 0.56 and
1.16 taken over the same span of open ground beside it -- a pit reading flatter than the
natural roll of the country round it. It is 9.12 and 11.38 now, with the control unchanged
at 0.56 and 1.19, which is what says the carve touched the pit and not the map. The bowl
runs six units outside the bag ring the way the engineer's does, so the bags sit on the
inner face of their own parapet; the depth and the lip come off `WORKS.pit.dig` rather than
being written out again, because two lists of one thing go out of step the moment somebody
changes one. It is still ground a crew can use: walkable and tier-3 cover on every pit,
before and after, and nothing on either map turned into hard going.

**And a work's model has to be built on the ground the work dug.** The buffer is packed in
`placeWork`, which is before the hole exists, and `conformFaces` drops every face to the
ground under its own centre -- so the bags of a finished pit stood at the height the grass
had been while the parapet they revet stood up five units underneath them. Over the bag
ring's vertices, against a stack 8.4 units tall, they ran -4.35 to +14.64 with the median
at 7.26; the dig runs first now and the model is packed again after it, and they run -4.55
to +10.61 with the median at 3.81, which is the middle of the stack. `pit` is the only work
with a `dig`, and the order is the fault rather than the packer: a probe that re-derives
the model after the dig reads correctly whichever way round the game does it, so the gate
row captures the array the game actually hands the card.

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

**Artillery, and what makes it artillery.** Everything else on this roster shoots at a
thing it can see down a line it has to have. `def.indirect` is the other kind: `acquire`
and `fireAt` skip the line test entirely, the shell is given a long flight and a high arc
instead of the nearly flat one a gun's round takes, and the unit is left out of the rule
that gives a gunner a sight as long as his weapon -- a tube that could see eight hundred
units would be a tube with no reason to exist. What it does not skip is `vUs`/`vGer`: the
target still has to be seen by the side, by somebody, which is the whole of what keeps it
honest. A mortar with nobody forward is a mortar with nothing to shoot at.

**A fire mission is the other half of it.** `def.barrage` is
`{ range, r, rof, rounds }`: a longer reach than the weapon's own, a circle, a faster rate
and a fixed number of rounds. `orderBarrage(u, x, y)` lays one and `barrageTick` works it.
**A round is spent only when one leaves the tube.** An aim point may fall up to `r` beyond
the circle's centre and so past the mission's own maximum range; `fireAt` refuses it for
that, and decremented regardless a mission laid near the edge of its range quietly fired
nine bombs of ten with nothing anywhere to say so. The cooldown is the signal, because
`fireAt` is the only thing that sets it. A fixed number of rounds rather than a duration
makes a mission a decision about a scarce thing instead of a switch left on. Moving
cancels it, setting up suspends it, and the crew lay on the middle of the circle once and
then work, which is why a mission fires faster than the same tube picking its own targets.

The player lays one with F and a click (`callBarrage`, `G.mode = 'barrage'`) and the same
card cancels it. Every mission the side has running is drawn on the ground whether its
tube is selected or not, because a player who has laid one on wants to see where it is
falling while he does something else; and while a mission is being laid, each selected
tube's reach is drawn round it, because the reach is a hard edge and without it the only
feedback is a refusal after the click.

**A tube throws smoke as well.** A smoke round is the one thing on this roster that does
nothing to anybody and changes a battle anyway: a cloud on the ground that no eye sees
through and no gun is laid through. `orderBarrage(u, x, y, smoke)` is the same mission with
the flag set, K and a click on the classic bar beside F, and `barrageTick` hands the flag to
`fireAt`, whose shell carries the cloud it will make (`smk`, off `smokeOf(def)`) and hurts
nobody when it lands. What a piece throws is read off the same number its burst is sized
off, so the sizes are the roster's and not a table: a mortar bomb makes a cloud of 65 that
is gone in 29 seconds, a pack howitzer's shell 76 for 35, and a battery's 118 for 62, with a
mission at half the rounds of the HE one because each round is a cloud rather than a
burst. `G.smoke` is the clouds; `smokeAt` is a cloud's radius now, building over three
seconds and thinning over its last quarter; and `smokeBlocks` is asked at the top of
`traceClear`, which is the ONE place, because a screen that blinds the eye and leaves the
gun laid through it is a screen that does nothing -- `sightLine`, `fireLine`, `aiSightsOn`
and the overwatch all go through that trace. Wreck smoke stays what it was, a slowing
through `smokeOn`, because a burning hull is a column and not a curtain. The cloud is fed
puffs at a rate its own size sets, only while it is on screen, and drawn on the little map
as a grey disc; the mission's ring is drawn in the smoke's own colour.

Measured by the gate: a section seen across 240 units of open ground, with a line to it
and a fire line, is behind five mortar clouds inside the zone about twelve seconds after
the mission is laid, and then has neither line, is lost by the eye inside a few vision ticks,
and has not lost a hit point; a second mortar laid on it over the screen still fires; the
clouds aged out give the line back; and the card on the bar sets the mode and lays one.

**Six pieces, in three pairs, and each pair cannot do the one above it's job.** The mortars
(`us_mor`, `ger_mor`) are man-portable, set up in a couple of seconds, and will engage what
the battalion can see inside 470 at their own slow rate or take a mission out to 560. The
pack howitzers (`us_how`, the M1, and `ger_how`, the Italian 75/18 the Germans in Italy
used every one of they could recover) are `barrageOnly`, which is the whole of what they
are: `acquire` returns null for them and `fireAt` refuses without a mission, because a gun
this size is laid by somebody else's map and fired on somebody else's order. A right-click
on an enemy is a mission on the ground he is standing on, and out of reach it is nothing
at all rather than an attack order that walks a five-man crew and its howitzer toward the
enemy to get inside a range the gun will never use.

**And `barrageOnly` is a rule a player may turn off.** HOWITZER FIRE on the handicap is
the switch: at ON ORDER the pack howitzer and the dug battery fire only on a mission,
which is what separates them from a mortar, and at FREE FIRE they engage what their own
side can see on their own account as well. `onOrderOnly(u)` is the one reader, and
`acquire` and `fireAt` are its two callers; the two ORDER paths deliberately keep reading
the raw def, because a right-click is a fire mission on that ground either way. The
setting is about initiative rather than about orders.

Two numbers had to follow it, and neither was wrong before. The flat 0.85 radians a
second in the turn-to-target is the mortar's, and the only two pieces that carry a
`traverse` of their own are the two that never picked a target; the same goes for
`layTol`, which until now only `barrageTick` ever read. With free fire they do pick
targets, and an eight-inch howitzer that came round at 0.85 on a target it chose and 0.20
on a mission it was given would be a different gun depending on who laid it. Measured by
the gate: laid the other way about it takes 15.4 seconds to come round against the 15.7
its own traverse says, where a mortar takes 3.5.

The reaches are chosen against this map rather than by feel. A headquarters stands 1150
from every victory flag, so at 760 and 660 neither gun touches a victory sector from home:
it has to come four hundred forward, which puts it among the town's approaches, in front
of its own infantry, where a section working round the flank will find it. That exposure is
the price of the shell and it is the reason the reach stops where it does. The Canadian gun
reaches further and hits softer and the Italian one is the other way round, so the German
side has to come further forward for the same ground.

On the models, the trail is what tells the two apart: the M1 sits on a box trail, one beam
under the breech with a single spade on the end of it, and the 75/18 mod. 34 on split ones
that open out to either side. The 75/18 is the longer barrel of the pair at eighteen
calibres against the M1's sixteen and carries the taller shield. Neither has a muzzle
brake. Both are laid up at the elevation a gun that only fires indirect sits at, which is
what tells the class from the anti-tank guns at a glance: those have long thin barrels held
level on the same sort of carriage.

**And the heavy battery, which is a position rather than a unit.** `us_how8` (the M1
8-inch) and `ger_how210` (the Obice da 210/22 mod. 35) are never queued: `WORKS.how8` and
`WORKS.how210` are how they arrive, the engineers spend eighty seconds and a lorry-load of
fuel bedding one in, and it stands where it was bedded for the rest of the battle. Four
rules make it a decision rather than a bigger pack howitzer, and each of them is a refusal
that has to be counted rather than assumed:

- **One a side** (`limit: 1` on the unit, which `placeWork` already enforced for the
  eighty-eight). A second battery is not a second decision.
- **Not near home** (`WORKS[].minHq`, 700). A gun that reaches most of the way across the
  map and stands behind its own headquarters cannot be got at, so it has to be dug forward
  of home, which puts it somewhere a flanking section can walk to. The rule is on the work
  rather than on the player's judgement.
- **Not into the enemy's base** (`barrage.safe`, 600 round any enemy building). Five
  two-hundred-kilogram shells into a headquarters wins an annihilation match without an
  infantryman leaving home. Guns of this weight fired on map references onto ground
  somebody was fighting over; they did not break up a rear area on a whim.
- **Slow onto a bearing** (`def.traverse`, a fifth of a radian a second against the
  mortar's 0.85, with `def.layTol` for how close it has to be before it will fire). Laid
  behind itself the gun takes fifteen seconds before the first round leaves, which the
  check row measures against the arithmetic rather than trusting.

And it is the least accurate weapon in the game by a long way: a hundred and ninety units
of beaten zone against the pack howitzer's seventy-six, with `barrage.sp` on top of that
so the round-to-round scatter is the gun's own rather than the mortar's flat ten. What it
has instead is the shell -- three hundred damage over a hundred and thirty of burst, which
is the heaviest thing either side can put on the ground.

**The two rules meet in the middle, and that is the finding worth keeping.** Dug on the
first legal patch beyond `minHq`, the Canadian gun is 1575 from the German headquarters
and its reach is 1250: the range and the minimum distance from home already keep it off
the enemy base without `safe` ever being consulted. The no-fire zone is what stops a
player walking the battery forward until it can. The check row had to stand the gun
forward deliberately to ask the question at all, because from where it is dug the answer
is 'out of range' and the rule under test is never reached.

**Whether the brain ever digs one was the hard part, and it took four measurements.** The
rule lives on the engineer, and the first version sat inside the works ladder -- one work
every fifty-two seconds, and only with fewer than nine standing -- so it was consulted
seven to fourteen times in a whole battle and lost every one of them to a wall of sandbags
on money. A thing capped at one a side does not need a cooldown; it has a limit. Asked on
its own, `battery.reached` went to about 120 a battle. Then `battery.money` read nought of
ninety-seven, which looked like the price being out of reach and was not: a probe that
watched the enemy's purse frame by frame found it holding 460 marks and 170 fuel together
on 193 frames of 8270, with a peak of 568 and 231, so the money is there about two per
cent of the time and ninety-seven samples of a two per cent event coming back empty is
luck rather than a rule. What was actually shut was `battery.post`, on every tick where
the money was there: `aiMortarPost` stands a tube three hundred and eighty to five hundred
and sixty back from the front, which early in a battle is between the front and the
headquarters and so inside `minHq`. The two rules were fighting again. Sited instead by
walking the line from home out to the front sector from the floor upward, the rule fires:
over three battles of two hundred seconds it reached 113-127 times, wanted on 10-16,
could pay on 0-3 and dug one. Two hundred seconds is a walkover -- the AI beats a passive
player by then -- so in a game somebody is playing the want count is hundreds and a
battery is near certain.

Three smaller things about the emplacement. The **crew are laid out by the work**
(`WORKS[].lay`, the eighty-eight's own list generalised) rather than walking to cover,
because the pit is the cover. The **gun is two pieces the way the eighty-eight is**: the
platform is drawn once on `u.baseA` and does not turn, the gun on top of it is drawn on
`u.facing` and does, and that is the only thing on screen that shows a battery taking a
minute to come round -- with an arc drawn on the ground from the present lay to the
mission's bearing, because a battery that has been given an order otherwise looks exactly
like a battery that has ignored one. And **the position is not a ring of bags built
bigger**: that was tried, and a bag laid on an arc at about five units means a ring of
sixty-two at six courses and three deep is fourteen hundred bags and twenty thousand faces
for one object, four times the whole German roster. It is two stepped banks of revetted
earth in forty-six segments, which is six hundred faces and is also what a battery
position actually looks like.

**The opposition's guns can be switched off before the battle.** `G.aiArty`, set from the
title screen beside the difficulty and passed through `startGame(side, diff, mode, arty)`,
gates `morWant`, `howWant` and the battery dig. It gates the enemy only: the player's own
mortars, pack howitzers and battery are there either way. Artillery is the one arm a player
cannot answer in kind on the spot -- a battery is eighty seconds of engineer work away and
the shells are already falling -- so whether the other side has any is a decision about
what sort of game this is rather than a difficulty setting. `check.mjs` asserts the
negative over eight minutes of battle, with the control being that the block those rules
live in was reached at all: without that control a misspelt counter name passes the row by
never moving.

On the tactics card the whole pass -- the batteries, the switch and the brain that digs
one -- is a pair difference of -70 with a standard error of 233 over eight pairs, ahead in
five of eight, which is inside the noise and is the right place for a change that adds a
weapon neither side can usually afford. And two things the title screen gained on the way:
its option buttons were 33px on a phone, under the rule the rest of the game holds itself
to and the first thing a thumb ever touches, so `.pill`, `.mode` and `.arty` now carry a
44px floor on a coarse pointer.

**Where a tube goes is not where anything else goes.** `aiMortarPost` is the one post on
the map that wants to be further back rather than nearer, and it deliberately does not ask
whether the objective can be seen from there: `aiOverwatch` insists on a line, which for a
tube is exactly the wrong test, because a mortar that can see the ground it is shelling is
a mortar the enemy can see. It wants distance, cover, and the objective inside a mission's
reach, and it reads the piece's own reach rather than a table naming one of them.
`aiSetUp` is exempted the same way, so a wave steps off once its tube is laid rather than
waiting for a line it should not have. The mission is laid on the nearest thing the side
knows about within 190 of the objective rather than on the flag: a defended sector is
defended from somewhere, and bombs into the middle of a circle nobody is standing in are
ten bombs spent on scenery.

**The company post buys off a list, and that list is not a chain of else-ifs.** It was,
tried cheapest first, and every branch below the first WANTED one was unreachable whether
or not that one could be paid for: `brain.mjs` counted `mortar.gate.reached` at 447 and
`mortar.gate.money` at nought over one battle, which means a side with no mortar and never
250 spare marks to buy one with spent the whole battle unable to raise an assault group, a
gun or a rifleman out of the post. `buy.elite` fired nought times in three hundred seconds.
Wanting a thing and affording it are different questions and only the second should stop
the list.

**And the post's two heavy weapons are bought out of the till rather than out of `spare`.**
`spare` is what is left once the armour ladder has put its head aside, and it never once in
five hundred thinking ticks cleared the price of either the mortar or the gun, so both
rules were waiting on money nothing else wanted. **A reserve was tried first and it is the
one thing on this page the tactics card could see plainly:** saving for them the way the
head of the armour ladder is saved for came back at **-721 a pair with a standard error of
135 over eight pairs, the working brain ahead in none of eight**. The per-side table said
why -- half the units and a fifth of the ground -- and the reason is the opening. `morWant`
is true on the first tick of a battle, so a side reserved 250 marks for a mortar it had no
company post to build yet and did not raise the sections that take the empty flags in the
first three minutes, which on this map is the battle. This economy has no slack to save out
of. A cushion of 150 was tried next, on the reasoning that the armour branch keeps one, and
at that the till cleared the gun's price on none of 430 ticks. With no cushion it clears on
about one tick in twenty-five, which is plenty for a thing bought once a battle. Refought
over eight pairs each way, the two cushions came back at +182 with a standard error of 193
and -116 with 203 -- both inside the noise, straddling zero, which is the honest answer for
a change of this kind and the one the tool almost always gives. On the brain card the gun
is bought once a battle and the tube three times, and nine missions are laid.

**Difficulty is two questions and it used to be one number.** `DIFF` set how hard the
opposition is to beat and how much help the player gets, in the same row, so a player who
wanted a veteran opponent had to take a veteran economy with it and a player who wanted an
easy economy got an opponent that thinks every four seconds and shoots at a third
accuracy. They are asked separately now.

`DIFF` is the opposition and nothing else: what it earns, how often it thinks, what it
fields, how well it shoots, how much killing it takes, how it waves, how early it techs,
its own population cap, and `vp` -- the rate the player's points drain, which stays here
because being bled faster is pressure the opponent applies rather than a modifier on the
player's units.

`PD` is the player's own side, thirteen settings on the title screen behind a HANDICAP
button that lights when any of them is off even: manpower income and fuel income, what is
in the till at the first shot in each of the two, production speed (a unit out of a
queue), construction speed (a building or a field work going up), the manpower cap from a
hundred to a thousand, the damage his units take, the damage they deal, how far they
see, whether the artillery rules bind him, whether his howitzers fire on their own
account, and whether the one-a-side vehicle limits bind him. Each is an index into a named list, because
the stepper and the game have to read one table -- two lists of the same settings go out
of step the moment somebody adds another. `pdMake()` resolves the indices once in
`startGame` so the income tick and the population check read a number, and `pd()` hands
the even game to anything that reaches it before a battle. The setting is kept in
`localStorage` under `ORT_HCAP`, and a handicap carried over from the last battle opens
the panel rather than hiding in it.

**Manpower and fuel are two settings each, not one.** A single income multiplier and a
single starting purse could only ever scale the two together, and the two are not the same
scarcity: manpower is what raises sections and fuel is what puts a tank behind them, so a
player who wants to field armour without also fielding twice the infantry has to be able
to say so. `inc`/`incf` and `smp`/`sfu` are the four, and the income tick reads one
multiplier per resource rather than one for the tick. The ceilings are generous on purpose
-- income and the two speeds run to 10x, the till to 15,000 marks and 6,000 of fuel --
because a handicap is a knob the player is turning with his eyes open and not a balance
figure.

**Three of them only go one way.** Damage taken runs from 1x down to 0.1x, damage dealt
from 1x up to 4x, and sight from 1x up to 4x: each is a thumb on the scale in the player's
favour and there is no reason to offer him the other half of it, which is a difficulty
setting and lives on `DIFF`. The two damage multipliers are applied at the top of
`damage()` rather than in `damageModel`, and that placement is the whole of what makes
them work on everything: `damageModel` is only ever reached for infantry, which is why
`DIFF`'s own `tough` has never once applied to a vehicle or a building. Dealt is charged
only against an enemy (`src.side === G.side && src.side !== t.side`), so a round between
two of the opposition's is untouched and so is one the player puts into his own men.
Sight multiplies the radius the eye goes into `_eyes` with, on the unit eye and the
building eye alike, which means it moves detection as a rate and not only the ring it
happens at.

**Sight carries the tubes, which is why the row is not called vision.** A mortar, a pack
howitzer and a dug battery reach exactly as far as somebody can see for them -- that is
the whole of what `def.indirect` means and the reason those pieces are left out of the
rule giving a gunner a sight as long as his weapon. So a player who sees four times as far
and shells no further than before has bought half a setting. `barrageReach(def, side)` is
what a fire mission can reach and `reachOf(u, w)` is what an indirect piece will engage on
its own initiative, and every caller reads one of the two rather than `def.barrage.range`
or `w.range`: there are eight of them between the two, across `fireAt`, `acquire`, the
attack-move, the reach ring, `aiSetUp`, the brain's own missions and its siting, and two
lists of one thing go out of step the moment somebody adds a third. `reachOf` scales an
indirect weapon and nothing else, so a rifle section is exactly where it was. Measured at
4x: a mortar throws 2240 off a published 560 and engages at 1880 off 470, where the
opposition's throws 560 and engages at 470.

**The opposition has the same settings, and they run both ways.** `DIFF` is three
settings with nothing in between, which is right for what it is -- how the brain thinks, how
it waves, how early it techs -- and wrong for the arithmetic round it. A player who wants a
veteran opponent on half an economy, or a green one with twice the manpower to see what a
green brain does with a real army, had no way to say so; and a player handing himself ten
times the income had no way to hand any of it to the other side.

`AD` is that row, resolved by `adMake` in `startGame` beside `pdMake`, behind an OPPOSITION
button on the title screen. It MULTIPLIES what `DIFF` already says rather than replacing it,
so an even `AD` is the game as it was: income and the two speeds are factors on the
difficulty's own, and damage, sight and the artillery rules read exactly as they do on the
player's side. Two of them are absolute rather than factors and so carry a flag --
`setPop` and `setTill` are false until the setting is moved, because a cap nobody touched
should defer to green's own 175 and a till nobody touched should be the 420/20 both sides
open on. Its lists are symmetric about the even game where three of the player's are
one-way: there is no reason to offer him a way to make his own men worse and every reason to
offer him a way to make theirs better.

Measured by the gate at the top of every opposition setting, on GREEN, with the player's own
panel at even: their cap is 1000 where his stays 200, their till opens at 14,556 (it spends
as it goes) where his stays 421, their income is 44.2 against his 8.5, a hundred-point round
of theirs does 400 and one into them does 400, and their eye reaches 1600 off a 400 sight
where his stays 380 off 380. Each of those is measured on both sides, because the claim is
that it reaches one and not the other.

**And `arty` is a switch rather than a scale.** It lifts the three rules that make the
heavy battery a decision -- one a side, dug forward of home (`WORKS[].minHq`), and no
missions into the enemy's base (`barrage.safe`) -- for the player's side and for nobody
else. The test in `placeWork` is whether the work puts a piece that fires missions on the
ground (`UNITS[W.unit].barrage`), so the eighty-eight keeps its two a side whatever the
handicap says, and the population cap is not one of the three: it is what stops a
free-for-all. The rules are there because a gun that heavy is meant to cost something to
site and to be answerable once sited, and a player who would rather have the gun than the
argument can see on the panel that he has turned them off. Each of the three is measured
twice by the gate, once on his side and once on the opposition's, with the opposition
handed the money first so that a refusal is the rule and never the till.

**`free` is the second switch, and it is the one that changes what a piece IS.** The other
twelve settings scale a number the game already had; this one takes a rule off the roster
for one side. A howitzer that engages on its own account is a different weapon from one
that waits to be laid, and it is worth knowing that the rest of the piece is untouched:
the beaten zone is the same seventy-six or hundred and ninety, the rate is the same, and
the battery still takes most of a minute to come onto a new bearing. What the player buys
is initiative and nothing else. Measured by the gate over seventy seconds with nothing
ordered: his howitzer fires 22 rounds and his battery 9, where the opposition's fire none
at all, with the mortar as the control at 16 on both sides -- because a mortar always had
the initiative and a row where it moved would be measuring something other than the
switch.

**Four of green's thumbs on the scale are gone rather than moved**, and that is the point
of the split as much as the settings are. `youAim` multiplied the player's accuracy by
1.3, `youTough` divided the damage he took by 1.45, `extra` handed him three sections and
a second engineer at the whistle, and `mgHold` -- read for the player's side alone, off the
opposition's table -- gave him thirty seconds of trigger before a barrel went on green and
sixteen on veteran, so picking a harder opponent quietly burnt his own barrels out faster.
None of it was visible, switchable or mentioned anywhere. A player who wants an easier
game turns knobs he can read instead; the barrel is one number for him and the eighteen it
always was for the other side.

**Construction speed is a knob that did not exist.** `build` only ever scaled the
production queue; a building or a work went up at `dt / time` for both sides at every
difficulty. They are two settings because they are two decisions: a fast queue with a slow
spade is a side with an army and no position, and the other way round is a side dug in with
nothing in it.

Measured by the gate, with every setting at its most generous and the opposition on
GREEN: the player's cap is 1000 and the opposition's is still green's own 175, the till
opens at 15,011 marks and 6,001 of fuel, income is 85 marks and 11 fuel against 4.42 and
0.57, a second of wall clock buys ten seconds of queue against one, and a second of
digging puts up 0.3846 of a building against 0.0385. A hundred-point round takes 10 off
one of his and 400 off one of theirs, and 100 between two of theirs. His eye reaches 1520
off a 380 sight where the opposition's reaches 400 off its own 400. He digs a battery 130
units from his own headquarters inside a 700 exclusion and then a second one, where the
opposition is refused both; a mission onto the enemy headquarters is allowed for him and
refused against him. The production and construction figures are timed rather than read
back off the settings, because a setting that is stored and never multiplied into anything
looks exactly like one that works.

Two things had to be got right before that row could say anything. **The damage probe has
to hit something a round cannot kill**: fired at a rifle section it went through
`damageModel`, which picks a living man at random, so reading `models[0].hp` measured the
pick, and summing the section measured the man's remaining hit points rather than the
round. It hits a vehicle at a million hit points now. And **`computeVisibility(dt)` runs
at a tenth of the frame rate**: called with a dt it returns at once while its own timer is
still down, so a probe that passes one reads an `_eyes` list built before the units it
just spawned and comes back -1 both ways. The row calls it with no argument.

**A player is not a side, and until the 2v2 they were the same thing.** A side was a team,
an economy, an army and a brain all at once, which is exactly right while there is one
player on each of them and falls apart the moment there are two. What comes apart is this:
a TEAM shares vision, ground, the memory of where the enemy was and the victory points; a
PLAYER has his own headquarters, his own purse, his own queue, his own population cap and
his own brain, and cannot spend his ally's money or give his ally's men orders.

`u.own` and `b.own` say whose a thing is and `u.side` is still the team, which is what
makes this a change of about a page rather than a rewrite: every test about whether
something is an enemy, whether the fog shows it, whose flag a sector flies or who a shell
may hurt reads the team and is untouched, and that is most of the eighty-odd side tests in
the file. What moved to `own` is money, command, population, production and the brain.

**A slot key is a STRING, chosen so that everything already keyed by side takes it with no
change at all.** The purse, the income, the population, what has been ordered, the call
board and the operations are `[slot]` where they were `[side]`, and in a 1v1 the slots are
`'us'` and `'ger'`, which is exactly what they were. A 2v2 adds `'us2'` and `'ger2'`.
`G.slots` is what is actually being played, `G.own` is the player's own slot and
`owned(x)` is whether a thing is his. The victory points stay on a team's FIRST slot,
because a team wins or loses together and `G.res.us.vp` is what every reader of them
already asks for; `vpOf(side)` and `vpSet` are the two that know it.

**The ground pays a team and the money reaches a player.** A sector is held by a side, so
the yield is counted once for the side and split evenly between the slots on it: two
allies who hold half the map between them have half the map's income each rather than all
of it each, and a 1v1 is the arithmetic it always was because a team of one gets the whole
share. The base trickle is per player, because it is what keeps a side pushed off every
flag able to raise a section at all, and that is a thing each of them needs rather than a
thing the team needs once.

**One brain per AI slot.** `AIP` holds a plan per slot and `AI` is whichever of them is
thinking right now, reassigned rather than copied: every rule in `aiTick` reads the bare
global, and swapping twenty-five fields in and out of one object a tick is both slower and
a thing to get wrong. `aiThink` is the driver the frame loop calls and `aiTick` is still
one brain's tick, which is what keeps `tools/skirmish.mjs` working -- it wraps `aiTick`,
and in its 1v1 there is one AI slot, so it is called once and the wrapper runs both of its
brains inside that call. Which brain thinks first rotates, because running one of them
first every tick gives it the newer picture and the first orders for the whole battle,
which is a systematic edge sitting underneath every comparison anybody makes between two
AIs on a team. `AIM` and `DANG` stay per team, because what the side has seen and what
ground has been shown to be dangerous are things a team knows; `AIQ` and `AIOP` are per
slot, because a call board is a brain asking itself for help.

`AIW` gained the distinction as well. `W.fighters` is what this brain may give an order
to, which is its own slot's men, and `W.team` is the whole team's fighting strength, which
is what the odds, the friendly grid and a sector's weight are about. Getting that the
other way round is an AI that reads its ally's sections as its own and deals them jobs
they will never carry out.

**Four things had to be got right and each of them reads as working from the outside.**
`updateBuilding` spawned the finished unit with `b.side` rather than `b.own`, so on a team
of two every man either of them raised came out belonging to the FIRST slot: the ally's
till emptied at the right rate, its population never moved, and one player ran to
twenty-six units while his ally sat at three. It is the clearest case in this file of a
bug whose symptom is a plausible-looking battle. `hqOf` falls back from the slot to the
team so that a team-level caller still gets somewhere behind the line. `orderRetreat`
takes the unit's own headquarters rather than the team's first. And `placeWork`,
`placeStructure`, `siteOf` and `siteCount` all take the slot, because a work is paid for
out of one till and counts against one limit.

**Each computer player is set on its own, and the settings are stored against a ROLE.** A
slot key depends on which side the player picked -- his ally is `us2` playing Canadian and
`ger2` playing German -- so a panel storing its settings under the slot would move them to
a different AI the moment he changed sides. `AD_ROLES` is `foe1`, `foe2` and `ally`;
`ADS[role]` is that one's handicap row, `ABUY[role]` is what it is told to buy, and
`startGame` is the one place that says which slot is playing which role. The OPPOSITION
panel carries a strip of three and edits one at a time; the two that a 1v1 does not use
are shown rather than hidden, because a player who sets his ally's economy and then
switches back should be able to see the setting is still there and is not being used.

**The AI's own difficulty is on that row too.** `DIFF` is three settings with nothing in
between, which is right for what it is and wrong when there are three brains: a player who
wants a veteran opponent beside a green one had no way to say so. SAME is whatever the
three buttons say and the other three name themselves, resolved by `adDiff` in
`buildSlots`.

**And an AI can be told what to buy.** The shopping list is the brain's own judgement
about what the battle wants, and this is a thumb on it rather than a replacement: a weight
per KIND of thing, which multiplies the count the ladder wants and moves the hour the rung
opens against itself, so a heavy weight means earlier and more of them and a nought takes
the rung off the list altogether. It is a kind rather than a unit key because a panel of
twenty rows on a phone is a panel nobody reads, and because what a player wants to say is
"more tanks" or "no armoured cars" rather than a number against each Sherman. Eight of
them: rifle sections, assault groups, machine guns, anti-tank guns, the tubes, and light,
medium and heavy armour.

`bClassOf` reads the class off the def rather than off a list, so a vehicle added to the
roster falls into one without anybody remembering to say which: armour under a hundred is
light, under two hundred medium and above it heavy, a team with a two-hundred-penetration
weapon is an anti-tank gun and anything else on a crew is a machine gun, and infantry that
costs fuel is the assault group -- which is the only thing separating the two on paper as
well as on the field. `aiPrefLadder` applies it to the vehicles and the infantry side
reads `bpOf` at the five places the counts are set. The weights bind the brain and not the
roster: the Maus is off every brain's shopping list whatever this says, because a brain
saving twenty-two hundred marks buys nothing else for four minutes.

**The one-a-side vehicles are a setting rather than an edit to the roster.** `limit: 1` on
the Maus and the Tiger II, and two on the eighty-eight, is a rule about the game, so a
player who wants six Tigers -- or an AI turned loose with them -- sets it off rather than
editing the def. `unitLimit(slot, def)` is the one reader and `queueUnit` and `placeWork`
are the two doors a purchase goes through. The population cap is deliberately not one of
the things it lifts: that is what stops a free-for-all. Note that every limited vehicle on
this roster is German, which is why the gate row has to play that side to test the
player's half of it at all.

Measured by the gate on the shipped map: four headquarters on four owners, the two allies
580 apart and all four with walkable ground to march out of; three brains, one plan each;
the player's till at 904 against his ally's 159 with the strip reading his; four
populations counted separately; and an ally's section selected gives nothing at all to the
command bar. The ladder under the weights reads `ger_sd222x1@40 ger_pakx2@130 ger_p4x2@260
ger_tigx1@620` at even, and with light at NEVER, medium at 2x and heavy at 3x it reads
`ger_pakx2@130 ger_p4x4@130 ger_tigx3@207`.

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
lookup a step. The walk is horizontal with the pitch carried as a gradient, and it ends at
the far edge of the gun's reach when it meets nothing, because a level look over open
ground is the commander's commonest shot and the first version handed back nothing for it.
A mark the gun cannot shoot at is worse than no mark, so the point is tested with
`fireLine` and backed off along the bearing in twenty-four unit steps until it passes; the
first version allowed a round a height over a blocker where `fireLine` allows none, so the
crosshair sat on a wall, the button said READY, and pulling the trigger did nothing at all.
The mark on the ground is the burst drawn at its own size, with the far edge projected
rather than guessed. Houses are scenery and have no hit points, but the men in them have: a
round on the wall reaches the garrison standing along the inside of it.

**The gun is laid on the mark and not on the eye.** `DRV.want` is the bearing to whatever
is designated, the target under the crosshair or the ground point, and `u.want` takes it
while `u.manual`. The commander sits a couple of metres off the hull centre, which at two
hundred units is several degrees, and `fireAt` wants the turret inside a tenth of a radian:
laid on the raw look bearing the gun traversed for ever and the round never left.

**The loader works whether or not there is a target.** `u.cd` and `u.atcd` count down in
`updateUnit` and `fireAt` only reads them. They used to be decremented inside `fireAt`,
which is only reached with something to shoot at, so a tank under command with nothing
acquired never finished loading: the trigger did nothing and the button almost never said
READY. It also means a gun that loses its target reloads during the gap, the way a crew
does, and the balance card does not move on it, because in a duel both sides always have
something in front of them.

**He can see his own gun go off.** `fireAt` and `fireOneSecondary` skip the flash, the
tracer and the report when the firer is off screen, and `onScreen` projects the ground point
under the unit, which from the commander's own eye is behind the near plane. The one man
sitting on the gun was the one man with no evidence it had fired. Both now test
`onScreen(u.x, u.y) || u === povHost()`.

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
sliders included. The first open shows the help (`edPanelHelp`, `ED_HELPED`). Both
shipped maps load, from the panel and from the menu, through one `edLoadShipped` reading
`MAPS`: two copies of those nine statements go out of step the moment a third map is
added.

**A new kind of thing is not in the editor until five places know about it**, which the
bunker and the two anti-tank belts each had to be walked through: a tool in `ED_CATS`, a
footprint in `edBBox` so it can be marked and picked, a line in `edMark` if it levels a
pad the way a house does, a name in `edKindName`, and its own options in `edProps`. And a
sixth the moment a type starts CUTTING the ground rather than standing on it: `ED_GROUND`,
which is what `edMark` reads to set `ED.needGround`. `edRebuildNow` rebuilds the
heightfield and the walk grid whatever the edit was and gates `buildTerrain` and
`buildAlbedo` on that flag, so a carving type left off the list gives the editor a hole
that can be walked into and cannot be seen until something forces a full rebuild. The
weapon pit joined the list the day it started going through `carve`, and nothing on screen
would have said it had not: an editor that has cut the ground and not redrawn it looks
exactly like one that has not cut it yet. A
line tool also has to carry its `def` onto every piece it cuts -- without that a dragon's
teeth belt drawn with the teeth tool came out as hedgehogs, because the only thing
separating the two is one field on the def.

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

**There are two control schemes, and a phone starts on the second.** The classic scheme
is a desktop's: the bar along the bottom with the cards in a strip, every order a tap on
the ground, and the economy, the building, the repairs and the stances all the player's
to run. It is the whole game and it wants the whole of a player's attention, which a
phone does not have to give. So there is a second scheme, SIMPLE, kept beside the first
as a choice on the title screen (CONTROLS: CLASSIC / SIMPLE) and under `ORT_CTRL`.
`CTRL.simple` is the switch, `ctrlSet` stores and applies it, and `ctrlLoad` decides the
default off `MOB` when nothing is stored: a phone starts on simple and a desktop on
classic, and either may pick the other. The classic touch path is untouched, because
every branch of the new scheme is behind `CTRL.simple`, and the gate measures the classic
scheme on the phone as well.

**Under SIMPLE the player builds and the brain fights.** That is the whole of the design,
and the first two versions of the scheme were wrong for not saying it: the first laid the
classic controls out again for a thumb, and the second kept every order the player's and
handed the housekeeping to an adjutant, which is the classic game with fewer buttons.
What the player has now is a strip along the bottom of every unit his finished buildings
can turn out, and the two posts he has not got, one big button each with the price and
the count on it (`#tbuild`, `simpleItems`, `simpleBuy`, `simplePost`); the little map
above it; a line beside the map saying what the army is doing (`simpleStatus`, read off
the brain's own plan rather than kept anywhere else); LOOK and PAUSE; and, when he taps
a flag, a popup with ATTACK, HOLD and FEINT on it (`#tflag`, `simpleFlag`). Nothing
selects a unit to order it and nothing drags one. A tap on a unit of his picks it so LOOK
has something to look from, a tap on the ground lets go, and LOOK with nothing picked
looks from the unit nearest the middle of the screen.

**The army is run by the game's own brain on his slot.** `aiRuns(sl)` is what `aiThink`
walks: every AI slot, and under SIMPLE the player's own, raised lazily on the first tick
with `aiInit(slot, true)`. It is the same `aiTick` that runs the opposition, so his army
forms waves, lays its support on before it goes in, hooks round at veteran, probes ground
nobody has looked at, sends a task force after a tank loose behind the line, holds a flag
that is being come for, ducks, calls for help, falls back hurt and digs in, with nothing
written twice. Two things distinguish his slot from an AI's. `aiDiffOf` gives it veteran
whatever the opposition was set to, because a brain running an army for somebody is asked
for the best it has. And `aiBuys` locks it out of the till for units and posts, since the
strip is what those are for: every `queueUnit` and the two `placeStructure` sites in
`aiTick` are behind `spend`, `wantMp` is nought so nothing is saved for a ladder it will
never climb, and the works, the fittings and the upgrades it may still buy keep three
hundred marks back for him (`keep`). **Both of those are SIMPLE's and read `CTRL.simple`**,
because under classic the only thing that ever puts a brain on the player's slot is a
card: `tools/skirmish.mjs` and `tools/brain.mjs` run one on both sides, and a lock read
off the slot alone left the Canadian side of every card unable to raise a section. It
shipped that way, and what said so was the tactics card: eight mirror pairs at -578 and
+568 by side, a walkover for whichever brain was German, with 1,686 marks unspent on the
other side against 264. Every brain-card number taken between that commit and this one
was read off a battle with one army in it. The green grace in annihilation is the opposition's
and is gated on `aiBuys` too, or a green game froze the player's own army for three and a
half minutes. A tank he is driving from its own turret is skipped (`u.manual`), because
in the periscope he is the crew.

**And the guns serve the attack he orders.** The support weapons aimed at whichever
sector was hottest (`AI.main`), which is usually the wave's objective and was not the
moment he tapped ATTACK on another flag: the tubes went on shelling the fight the army was
leaving while the wave went in without them. The support aim is the wave's own objective
now whenever there is one, and under a directed attack the tube's mission goes on the men
holding that flag before a massing body or a heard tube gets its turn (`mortar.dir`). Then
at the go, against a defended objective, smoke goes down: `aiSmokeScreen` lays a screen a
third of the way from the flag back toward the forming-up point, which is the ground the
defenders look out over and the wave walks in across, by the tube of this slot nearest to
being able to do it -- in action, in reach, and without a mission of its own still worth
finishing -- and one tube only, because a second screen beside the first is the same
screen (`smoke.screen`). The opposition's brain does the same, since it is the same tick.

The gate found the fault that would have made all of that decoration. The target reflex
runs before the jobs and forced a tube onto any section it could see, and an attack order
clears the order before it: a mortar on its post plinked at one section at its own slow
rate while the ground the wave was about to cross went unshelled, and the smoke laid at
the go was gone by the end of the same tick, cancelled by the reflex three hundred lines
below it. A tube on a mission keeps it now, and one on its post is left to the support
job, which lays the next; its own `acquire` still shoots at what is in front of it
between missions, so nothing is silenced.

And the same row found a second one, older than anything on this page: **a tube on a
mission was turned back off its bearing every frame.** A halted section with nothing to
shoot at turns to face the nearest enemy the side can see (`u.threatAng`), and a tube on
a mission has no target by design, so it took that turn -- at the same 0.85 radians a
second `barrageTick` was laying it on with, so the two cancelled to the frame and the
crew stood with ten rounds in hand and fired none. A battery traverses at a quarter of
that and could never have laid a mission at all with anything in sight off its line. It
had not shown because the mortar row, the free-fire row and every hand-laid mission in a
quiet minute had the nearest enemy on the same bearing as the beaten zone; the directed
attack put the wave's own targets out of sight and the nearest thing in sight off to a
flank. A tube on a mission is exempt from the turn now, and the row stands an enemy
square off the line of fire while the preparation is spent, so that it stays measured.
The row also lets nobody answer a call for its two ticks: a section of his from the
battle meeting a tank raises one, an answer outranks the plan, and on one phone run the
nearest capable thing to it was one of the three sections put down beside the objective,
dealt off the flag and sent two streets away. Emptying the board is not enough there,
because a call raised inside the tick is dealt inside it.
Measured by the gate under SIMPLE: ATTACK on the nearest flag that is not his, with two
sections of theirs on it and a mortar of his in action four hundred and thirty back, lays
the mortar on the defenders on the next tick; the mission runs down with a section in
sight at a right angle to it; every section he put beside the objective is dealt to it;
and with the preparation spent and the wave ready the go lays smoke short of the flag.
The row takes the two in either order, because on a phone run a section of his from the
battle already stood inside 240 of the flag, so the wave went on the tick it formed and
the screen came before the preparation: both are the brain being right, and a row that
insists on the desktop's order is a row about the battle it happened to run in.

**He steers it by ORDERS, and an order is about anything.** It was one directive per FLAG
out of three kinds, with no way to say who was to carry it out and no way to say how hard
to press it: nine coordinates on a map of two thousand, three sentences about each, and a
player watching the army move had nothing anywhere to tell him which of its units were
doing the thing he had asked for.

`AI.ord` is the board -- a list on the plan, so like everything else that outlives a tick
it holds nothing but numbers and ids, the unit ids of the force and never the units. An
order is a KIND, a piece of ground or a thing standing on it, the FORCE he named, and a
TEMPER. `aiOrdTend` works the list once a tick between the review and the brain's own
planning, so an order is never planned over; `aiOrdMark` runs after the operations are
manned and says which order each unit is under, which is what the temper is read through
and what the player's list counts.

Nine kinds, and seven of them raise one of the brain's own OPERATIONS. That is what makes
this a table rather than nine new behaviours: going somewhere and fighting for it, holding
ground, demonstrating at it, looking at it and hunting one named thing were all here
already, each with a force, a clock and a test for being over. What an order adds is a
door into them, a name for what came out, and a force he chose himself.

| order | what it is | what it raises |
|---|---|---|
| ATTACK | take it, and keep taking it | the main effort on a flag, `push` anywhere else |
| HOLD | put men on it and keep them there | `hold` |
| SCREEN | cover this ground from a fire position | `screen` |
| PROBE | send somebody to look | `probe` |
| RAID | a task force after what is there | `destroy` |
| FEINT | demonstrate, and draw them off it | `feint` |
| SHELL | a fire mission on it | nothing: the tubes read the board |
| SMOKE | a screen on it | nothing: the tubes read the board |
| PULL BACK | break contact and rally here | `retire` |

**ATTACK ON A FLAG is deliberately not an operation.** The wave -- its forming-up point,
its support gate, the pinned wait, the hook and the break-off -- is the most worked-over
machinery in this file, and an order that went round it would be a worse attack than the
one the brain makes on its own account. It is the main effort instead, which is what the
old ATTACK directive was: it goes to the top of the objective list whatever the scores say,
with a cap of four sections and no reach limit (`aiDirAttack`), and it is done the moment
the flag is his and quiet. It was 420 points added to the score rather than the top of the
list, and 420 is not enough: a held victory flag with a body walking onto it is worth most
of a thousand, and the gate row watched two of the three sections the player had put beside
his objective dealt to that flag instead, so the wave he had asked for formed with one
section in it. The directive is a sort key now and the score decides only among the rest.

`push`, `screen` and `retire` are the three operations the brain has no use of its own for:
an attack on ground that is not a flag, a fire position covering a piece of ground found
once by `aiOverwatch` and kept, and a rally back to somewhere with the fear turned up so
the force is not fighting on the way. `hold` gained the other half of its own job at the
same time -- it reads a bare point when there is no sector, because an order to hold a
crossroads is the same order as an order to hold a flag and the only thing the sector adds
is a circle to be inside of.

**The force is his, and an order given to men who are all dead is over.** With no force
named the brain deals what the kind asks for out of `aiOpsMan`, the way it always has.
With one named, `op.want` is nought so nobody else is added, the named units are put on the
operation in `aiOrdTend`, and the objective dealing marks them picked BEFORE it runs --
because the dealing is what would otherwise take them: a section he put on the flag he is
attacking would be given the nearest objective on the list, walk off, and read afterwards
as an order nobody carried out. It is not quietly re-manned when they die, because the
force was half of what he said.

**The temper is a multiplier on rules that already existed**, which is the whole reason it
is a row of three chips rather than a new difficulty. `AGGR` is CAUTIOUS, STEADY and PRESS
HOME, and every number in it is one some rule already read: what a unit pays to stay out of
the beaten zone (`u.fear`, 1.75x to 0.35x), the odds it will walk onto a flag at (1.3 to
3.2 against the old flat 2), how hurt a section goes home (half strength to a sixth), how
much of a wave has to be left for it to still be an assault rather than a queue (0.70 to
0.32 of what it stepped off with), and which way the weighing leans between standing and
getting behind something. An order carries its own; a unit under none carries the army's.

**A POSTURE is about the plan and a REACTION is about the weighing**, and that is why
neither is a new chain of rules. `POSE` is ADVANCE, HOLD and DIG IN: a posture that is not
ADVANCE takes the unit out of the objective dealing altogether, because the one thing the
plan does to a unit that a player may want stopped is MARCH it somewhere -- a section left
to watch a crossroads, a tank kept back off the skyline. It is not a refusal to fight: the
weighing has already had its say about whatever is in front of it and its own `acquire` is
still firing. DIG IN goes one further and takes the heaviest thing there is to stand in.
`REACT` is TAKE COVER, STAND FAST and FALL BACK, and it leans `aiWeigh`'s own scores --
stand against cover against giving ground -- and moves the hit-point threshold a section
goes home at. Both are the army's by default and either may be said of one unit or of a
whole selection: `u.pose` and `u.react` undefined follow the army and anything else does
not, which is the rule a vehicle's own word over the upgrade setting already uses.

**The pad opens on whatever the tap landed on.** A flag, a thing of theirs (inside its own
ring, so a tap has to land on the tank rather than near it) or a bare piece of ground --
which is the point, because most of what a player wants to say is about a crossroads, a
house, or the tank that has just come round the corner. Three rows: the nine orders, WHO,
and HOW HARD. The last two are remembered, so an order after the first one is a tap on the
ground and a tap on the verb. WHO is ANY (the brain deals it), ALL, INF, ARMOUR, GUNS,
PICKED, and the three battle groups A to C; a unit's card carries the group chips and a
SAME chip that picks every one of its kind, because PICKED is only worth having as a force
if a selection can be made with a thumb. Tapping the order a flag already has takes it off.

**And the ORDERS panel is the half he never had.** A row per order -- what it is, what it
is about, how many are on it, how hard it is being pressed and whether the force is his own
-- with a cross that cancels it and a tap that takes the camera to it, and under them the
army's own three settings. The tool button carries the count. On the field every unit
carrying an order wears that order's glyph in that order's colour, and an order about
ground rather than a flag draws its own ring on the terrain and a dot on the little map:
the complaint the whole board was built for was that there was no way to tell whether any
of the army was doing the thing that had been asked.

**The emplacements are sited by the player.** They went where the brain would have dug
them, which is a good answer and not his: a gun that fires on a map reference is the one
thing on the roster whose whole worth is where it stands. The strip's button arms the
placement instead and the next tap on the ground is the site, with the same ghost the
classic scheme has always drawn under the finger -- green where it will go and red where
it will not -- and every refusal on the way is `placeWork`'s own. Tapping the button again
puts it away, because an armed placement a player has forgotten about is a tap that digs a
gun he did not want.

**And the brain says what it is doing.** `aiFire` is where every named decision is
counted, so it is also where the player's own brain speaks: `AIVOICE` maps a dozen of
them (a wave forming, a wave going in, a counter-attack, scouts out, a section falling
back, the engineers digging in, a bunker being fitted) to a line, and `simpleSay` puts one
up no more than every seven seconds. His howitzers fire on their own account under this
scheme (`onOrderOnly` reads `CTRL.simple`), because a gun that waits to be laid is a gun
that waits for attention nobody is giving it.

Four things about it are worth knowing before touching it. **A brain raised in the middle
of a battle must not clear what is the team's**: `aiInit` calls `aiForget`, `aiCallsClear`,
`aiOpsClear` and `dangerClear`, all of which wipe every side, and a player switching the
scheme on would have handed himself a blind opponent; the soft init clears its own call
board and its own operations and nothing else. **A directed sector has to be threaded
through every `continue` in the objective scoring**: a held sector that is quiet is skipped
outright, and a sector out of the mood's reach is skipped outright, so 420 points added
below those lines would go on a flag the loop had already thrown away. **A sector id is a string
the moment it is an object key**, so the directive map and the operation list compare with
`String()` on both sides. And **the 2v2 gate row counts the brains that exist at the
whistle** and wants exactly the AI slots, which is why the player's plan is raised on the
first tick and not in `aiSlotsInit`.

**The emplacements are on the strip.** The first version of the strip had the posts and
the units and nothing else, so a player under SIMPLE could never dig an eighty-eight or a
battery position at all: the two things on the roster that arrive as field works were
locked behind a scheme he had chosen not to use. They are the last two buttons now, the
eighty-eight on the side that has one and the heavy battery position on either, dug by the
first free engineer where the brain would have dug it. `workSite(slot, kind, at)` is that
siting, pulled out of the brain's own two rules so that the brain and the strip ask one
question -- the walk out from home from `minHq` toward the front for a battery, the
overwatch post for the eighty-eight -- and `workAim` is the front when nobody has said
otherwise, which is the held flag nearest the enemy's headquarters. Every refusal on the
way (the till, the limit, the exclusion round home, the population) is `placeWork`'s own
and it says so itself; `workFull` is the limit, asked by the strip to dim the button and by
`placeWork` to refuse, so there are not two readings of it. Measured by the gate: a tap
digs the eight-inch position 780 from home against a floor of 700, with an engineer on it,
for 460 and 170; the button then reads 1 and dims, and a second tap leaves one site.

**Field upgrades are fitted for the player by a setting, and each vehicle has its own word
over it.** The opposition has always bought its own (`buyUpgradeAuto` is the brain's
routine, pulled out so that there is one), and under SIMPLE the brain on the player's slot
bought his; under classic nothing did, and a Universal Carrier without its .30 was a
carrier nobody had had a spare minute for. UPGRADES on the title screen is AUTO or BY
HAND, kept under `ORT_AUTOUP` the way the control scheme is, and AUTO fits what the money
allows for every vehicle he owns on either scheme: under classic `autoUpTick` runs the
routine on the brain's own nine-second cadence with a floor of 150 marks left, and under
SIMPLE the brain on his slot runs it with the setting read. `u.autoUp` is one vehicle's
word over the setting -- undefined follows it, true or false does not -- set from a card on
the command bar (AUTO UPGRADE, lit while it is on, N) or from the unit's popup under
SIMPLE. That popup is the other half: a tap on a vehicle of his puts up the upgrades it
can take, one button each with its price, dimmed when the till will not cover it, and
AUTO beside them, and a tap buys one by hand. It is not an order; it is the one thing a
tap on his own unit does under SIMPLE besides giving LOOK something to look from, and a
section gets the head of it and no buttons because a section has nothing to fit.

Measured by the gate on both schemes. Under SIMPLE a tap on a Universal Carrier puts the
popup up with the .30 and AUTO, AUTO lit by the setting; the .30 bought by hand is fitted
for 70 and its button goes; AUTO tapped leaves the carrier's word at false and the button
unlit; a second carrier with the till at ten has the price dimmed and the tap refused; and
a tap on the ground takes the popup down. Under classic, with no brain on his slot, the
tick fits a Sherman its roof MG, the card on the bar is lit and a tap on it turns the word
off, a Sherman that said no keeps its word, and BY HAND fits nothing. Each of those is one
vehicle at a time, because the tick buys one a call and would otherwise fit whichever of
three it met first.

**A `body.mob` rule written after the editor's CSS beats one written before it** at the
same specificity, and there is a second block of them there: the simple block sits at the
END of the stylesheet for that reason, because placed with the first block its little map
came out at 104 by 72 rather than 132 by 90, and nothing but a measurement said so. And
**the gate opens its page pinned to classic** (`openGame`'s `ctrl`, an init script that
writes `ORT_CTRL` before the game reads it, reloads included) and switches simple on only
where it measures it, because a brain giving the player's army orders under rows that
stage his units is a gate measuring the brain.

The gate drives it through the TouchEvents a finger raises, dispatched at the canvas,
rather than by calling the functions behind them: a handler that is never reached by the
event it is written for is a handler that is not there. `node tools/shoot.mjs hud
--device=phone` photographs it, with the flag's popup up as a second frame, and
`--ctrl=classic` or `--ctrl=simple` picks the scheme whatever the device would.

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
tools/move.mjs                 movement card: routes, battle traffic, cover taken
tools/brain.mjs                the AI card: sight, plan, and which rules ever fire
tools/sight.mjs                sight card: the trace, what a position commands, spotting time
tools/model.mjs                model card: the occlusion bake, its cost, and what is in each vehicle
tools/terrain.mjs              ground card: grain by scale and distance, and what shimmers
tools/skirmish.mjs             tactics card: AI against AI, old brain against new
tools/wreck.mjs                destruction card: the breach, the collapse, the heap, the grids
tools/fx.mjs                   effects card: the muzzle blast, the tracer, the burst, off the framebuffer
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
- **A colour nobody tagged is drawn on the untextured tile, and it looks fine.**
  `registerMaterials()` maps colours to atlas materials and a miss falls back to
  `generic`, so a vehicle whose paint comes from a camouflage tile comes out hemmed
  with a bright flat pinstripe along every edge it has. `lit()` derivatives find
  their own way home now -- `matOf` follows a tint back to its source -- so what is
  left to get wrong is a ROOT colour nobody put in a `tag()` list at all. One
  sandbag shade left out of the hessian list drew every parapet on both bunker lines
  flat, and no photograph ever said so. Tag a new palette, and read the gate row that
  counts what is left: it separates a face that is `generic` on purpose from a miss.
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
- **`unitRadius` is half a vehicle's LENGTH.** It is the separation radius, so a Sherman
  reads 41 when it is 2.6 m across the tracks, which is 15. Anything asking whether a
  thing fits through a gap wants the beam, and asking with `unitRadius` reports the main
  street of Ortona as too narrow for the tank driving down it.
- **A rate needs a denominator you can see.** A movement metric counted four-second
  windows in which a unit with a path went nowhere; a path is usually spent in well under
  four seconds, so a whole battle produced fifty windows and four coincidences read as a
  nine per cent regression that sent a morning after a bug that was not there. Print the
  denominator, and prefer counting frames to counting events.
- **A screenshot cannot review the thing that draws it.** Two of the largest bugs in this
  file's history were invisible for exactly that reason. The fog of war had no live-vision
  tier for the life of the game because `updateFog` asked an eye for `r2` and gets `r`, so
  every picture ever taken came back at 52 per cent brightness and looked like weather. The
  sky quad has been culled since it was written, so what looked like a sky was
  `gl.clearColor`. Both render as something plausible. When a thing is meant to have
  structure -- a gradient, a falloff, a tier -- read the buffer, do not look at it: one
  `gl.readPixels` down a column says in three lines what an afternoon of screenshots will
  not.
- **`gl.frontFace` is CW here.** The world is left-handed and drawn front-face clockwise
  with culling on, so a full-screen quad wound the ordinary way (bottom-left, bottom-right,
  top-left) is a back face and is culled without a word. `QUAD` is wound that way. Anything
  drawing it turns culling off first; the billboards already did and the sky did not.
- **The ground-mark buffer grows now; it used to drop.** `markVert` returned on overflow,
  so the marks built last -- the fire missions, the order lines, the selection rings --
  were the ones thrown away, and a ring with a piece missing still looks like a ring. The
  sector rings alone filled nine thousand floats with the camera at its limit: a dashed
  ring is walked in 24-unit steps of six vertices each, and a gun's reach ring is 760
  units across. It was found by adding that ring and watching the frame count stick at
  exactly the buffer's capacity.
- **A probe that measures with the function under test cannot see it fail.** The gate
  row for men standing inside a field wall asked `inMasonry`, which is the function
  that keeps them out of one. Switched off to calibrate the row, the row read a clean
  nought: the men were in the stones and the thing counting them had been told there
  were no stones. It does its own geometry over `G.walls` now. The same trap is why
  `tools/sight.mjs` walks its reference line at four units a step rather than calling
  `traceClear`, and why `duel.mjs`'s optimum comes off a plain Dijkstra.
- **A rate can hide behind a denominator full of people it does not apply to.** With
  the field-wall fix switched off, a sample taken out of a running battle read 0.91
  per cent of halted men in the masonry, because most of a battle's men are nowhere
  near a wall. Twelve sections stood AT twelve walls read 9.4. When a fault is about
  a place, stage the drill at the place; when it is about a rate, print the
  denominator.
- **`fogCircle` hands its callback the SQUARE of the normalised radius**, not the radius. It
  is `dx*dx + dy*dy` and both callers want it that way, but a falloff written as though it
  were the radius comes out wrong in a way nothing will flag.
- **A `.pill` on the page is a side picker.** The title screen binds every element of that
  class as one, by class and with a plain `onclick =`, after the rest of the wiring has
  run. A button that borrows the look to sit on the game-over screen silently borrows the
  handler, loses its own, and does nothing whatever when pressed -- with no error anywhere.
  Give a new button its own class.
- **`unitRadius` is not the circle a unit is drawn in; `selRadius` is.** The first is the
  separation radius the pathfinder and `unwedge` use and is half a vehicle's length. The
  second is what the ring, the click test and the bound on where a man may stand all read.
  Asking the wrong one puts a section's ring round a sixth of its own men.
- `spawnUnit()` puts the unit on the field itself. A tool that pushes the return value
  into `G.units` as well has it in the list twice, and a unit in the list twice is
  updated twice a frame: it drives at double speed and its gun fires at twice its rate of
  fire. That is exactly how a Sherman came back off the rate probe at 1.7 seconds a round
  against a paper 3.3, with nothing wrong in the game at all.
- **A cover patch of kind `rubble` or `bags` DRAWS ITSELF.** The cover list is not only an
  index: the scene builder walks it and puts a house's worth of masonry and a roof timber
  down for every `rubble` patch. Asking for rubble as the cover on a hedgehog belt put one
  every forty units of belt, straight through the hedgehogs, while the cost model stayed
  perfectly correct. Pick the kind for what it means -- `ditch` for flat, `lowwall` for
  crouching, `pit` and `trench` for dug -- and know that two of them come with geometry.
- **A new pick inserted above `issueOrder` can silently delete an order.** On the touch
  path, garrisoning, hitching, boarding and laying a fire mission all go through
  `issueOrder`, so anything picked before it takes the tap away from all of them. The
  bunker pick did exactly that and the loss is invisible on a desktop, where the two live
  on different buttons. Give a new pick the condition it should yield on.
- **A glyph test that matches a substring is not a specific test.** `cmdGlyph` walks its
  list in order and `/HQ|POST|SUPPORT/` claims both 'Machine gun post' and 'Aid post', so
  both came out drawn as a house. A new label goes at the TOP of that list, or it gets
  whatever an earlier line happens to match.
- **`conformFaces` drops every face to the ground under its OWN centre**, which is right
  for a thing laid along the ground and wrong for a thing that is level by construction.
  On the Gothic Line's crater field the first bag ring round a mortar pit came out with
  two of its fourteen segments standing in the air over a shell hole's lip and two sunk
  into it, and a splinter shield bolted to a bunker was measured off the slope in front of
  it rather than off the concrete. A piece that has to be level is given the difference
  between the ground under it and the ground under its own datum before the conform, which
  puts it back where it was meant to be.
- **A bag laid square to the thing it is beside does not make a ring.** Twenty-two bags
  placed on a circle with their long axis pointing whichever way the bunker does read as
  two dozen stones scattered in a circle; the ring only closes when each is rotated to its
  own tangent.
- **`BUNK.canv` is tagged to the camouflage NET**, because that is what the Canadian
  emplacement uses it for. Anything else drawn in it -- an awning over a workshop, a screen
  round a dressing station, a stretcher -- comes out as a piece of scrim, which reads as a
  fault in a photograph and is a fault in the palette. `BUNK.tarp` is the proofed
  tarpaulin, tagged `canvas`, and is what a field shelter is roofed with on either side.
- **A cover patch inside a solid footprint is a lie the whole index believes.** `aiFirePost`
  and `coversNear` read the patch list and neither asks whether a man can stand there, so
  a tier-4 patch in the middle of a bunker sites a machine gun in the concrete. A garrison
  does not need one: `coverOf` returns 4 for anything with `u.gar`.
- **A rejection scatter only avoids what was placed BEFORE it.** The Gothic Line's shell
  holes are rejected against everything already dug, so the farms written below them in
  the file were invisible to them and the map check found six craters undercutting the
  two of them. Order is the mechanism, not a matter of taste. And cap the count rather
  than counting it out: a scatter that MUST place N will keep trying until it puts one
  somewhere it does not belong.
- **A signed distance is only signed if every case signs it the same way.** `ruinFace`
  handed back `ly - o` for one wall of a bay and `ly + o` for the opposite one, which is
  correct for the absolute value every reader took and is opposite in sign. The moment one
  reader asked WHICH SIDE the blast was on -- the one thing that decides whether a round in
  the street takes a bite out of the far wall of the room -- half the walls in the town
  answered backwards, and what it looked like was a feature that had simply stopped
  working. Measure a face distance along its outward normal, whichever face it is.
- **A rubble heap is a height field, not a solver.** There is no chunk-against-chunk
  contact here and there will not be. What a heap actually needs out of a solver is one
  thing, that masonry lands ON masonry, and one coarse grid gives it: a chunk falls onto
  whatever is already lying there and what settles raises it. Without it every stone rests
  on bare ground and a collapsed house is a flat carpet of blocks that reads as spilt
  cargo rather than as a building that fell over.
- **The one buffer rebuilt while the game is running is worth writing by hand.** Falling
  masonry cost 2.8 ms a frame built the way everything else here is built, and nearly all
  of it was garbage rather than arithmetic: four arrays of six faces and thirty-six vertex
  arrays per chunk, three hundred times over, every frame. `packChunks` writes into one
  preallocated `Float32Array` and it is 0.5 ms. Everything else in the file is built once
  and can go on using `box()` and `place()`.
- **`box(cx, cy, cz, l, w, h)` spans z from `cz` to `cz + h`**, so `box(0, 0, 0, ...)` sits
  ON the origin rather than around it. Rotate that about the origin and the piece swings
  round its own base; an integrator that treats the same number as the centre then rests it
  half its own height in the air. Pass `-h/2` for anything that is going to tumble.
- **A separation push that can out-run the walk is the rubber band.** `unwedge`'s cap was
  a flat 60 units a second and a rifle section walks 64, so anything that cut the walk --
  suppression, wire, rubble, a field wall, all of which halve it -- left the shove bigger
  than the step. Counted over a battle it drove net motion BACKWARDS on a quarter of the
  frames where it fired. Bound any correction by what the thing being corrected actually
  managed, and read that off the unit rather than a local: six early returns sit above the
  line at the foot of `moveUnit` where a local would be written.
- **A body derived from a bounding box has empty corners, and a formation is nearly all
  corner.** A section's contact box is 106 by 66 laid over three files of 11-unit discs, so
  two sections whose boxes touch can have forty units of clear ground between their nearest
  men. But the men alone cannot replace it: a formation is a regular lattice, so for any
  man-to-man reach there is an offset that interleaves the two and welds them together, and
  raising the reach moves the hole instead of closing it (22 gives 22.0, 30 gives 30.0, 42
  gives 42.0). Passing is the men and resting is the box; that is arithmetic rather than
  taste.
- **A rule about a KIND of thing goes stale the moment that kind changes.** `crater/trench`
  and `house/crater` are about EARTHWORKS, and a weapon pit became one the day it started
  going through `carve` -- but the rules name craters, so both shipped maps went on reading
  clean with a pit's spoil standing in a trench floor and a pit standing inside a ruin. And
  when you widen such a rule, calibrate its radius against the effect rather than the
  geometry: a pit's spoil falls off as the square of the distance across its band, so taken
  at its outer edge the rule flagged five placements whose real effect was a tenth of a unit
  or nothing.
- **A derived test has to ask the question it means.** `bothAfoot` meant "is this a body of
  men on the march or a thing in the way", and asked `def.speed > 0`. Every crew-served
  weapon on this roster except three can be manhandled and carries a speed, so a deployed
  Pak read as men and a section walked through the gun. `cat` is what the roster already
  says: 'inf' or 'team'.
- **A feature with one reader has one caller's worth of coverage.** `WORKS.pit.dig` was
  read only by `finishWork`, so the pit an engineer built during a battle was dug and all
  thirty-three the two maps ship were not -- a horseshoe of bags on undisturbed grass,
  which from above is the same picture as a pit. When a rule belongs to a KIND of thing,
  check every door that kind comes through, and measure the shipped case rather than the
  one the code you just wrote goes down.
- **A normalised vector has forgotten everything that was multiplied into it.** `unwedge`
  built a push out of an overlap depth and a mass factor and then divided the sum by its
  own length three lines later, which cancels both exactly -- with a single neighbour the
  result is the bare unit vector and the two rules above it do nothing whatever. What
  survived was the step magnitude, `min(u.speed * .5, 40)`, which is the PUSHED unit's own
  speed, so a Sherman backed away from a rifle section faster than the section backed away
  from the Sherman: the precise inverse of the comment describing it. Anything meant to
  scale a direction has to scale the STEP.
- **A separation that switches at a boundary is a limit cycle.** Priced with no softening,
  a pair overlapping by a tenth of a unit came apart at the same rate as a pair standing on
  the same spot and the rate fell to nothing the instant they cleared, so the pathfinder
  pulled the unit straight back in and the push threw it straight back out: 198 reversals
  on one section walking past one parked tank. Price it on the depth and it settles.
- **Avoidance decided afresh every frame has no side.** A unit that picks the marginally
  clearer way out each frame swaps sides the instant the geometry crosses over and grinds
  along the flank of the thing for the whole order. A man picks a side and commits; so does
  `u.avoidS`, for 1.4 seconds.
- **A wanted bearing that steps is a hull that spins.** Applied on the frame a contact
  appears and dropped on the frame it clears, an avoidance term jumps the wanted heading
  sixty degrees and back every few frames. That costs nothing while the heading is
  decoration and, the moment a hull drives on its own nose, comes out as a tank turning
  through two and a half revolutions to walk past a section. Ease it in and out.
- **`blockRect`'s fifth argument is a PAD, not an angle.** A wreck has carried its bearing
  since wrecks existed and nothing has ever read it, so a tank that burned across a street
  was blocked as a box square to the map -- the wrong sixty units of it. `markSeg` takes a
  segment and a half-width and is the right tool for anything that lies along its own axis.
- **A frame-difference probe needs `shake` cleared, and a camera that has settled.** The
  camera shake is the one thing in the frame that is random per RENDER, and `shake.t` is
  wound down inside `frame()` alone -- so a shake left running by anything earlier jitters
  the camera a few pixels on every draw for the rest of the run. And a camera moved to a
  new place takes a dozen frames to settle, because the fog is refreshed every third one
  and eases toward what it should be. Measured with neither, the control of two identical
  frames came back at 41,975 pixels of 1.44 million, which is larger than the thing being
  measured. With both, it is nought.
- **A drill staged on ground the probe did not check is a drill about `nearestFree`.** A
  spot search that asks for 340 units of open ground with no cover in it finds nothing on
  Ortona, so it falls to whatever it was initialised with -- the map's corner -- and every
  vehicle in the drill spends its time walking out to the nearest ground it can stand on,
  turning through half a radian and never doing the thing under test. Ask for the shape the
  drill needs (a corridor, not a square), ask only for what matters to it (what SLOWS a
  vehicle, not what counts as cover, since three battles of craters is cover everywhere),
  and RETURN whether one was found rather than assuming it.
- **Two background runs writing to one output file make a sparse file full of nulls**, and
  the rows that go missing look exactly like rows that never ran.
- **A first hit that re-meshes a tile is a hundred and ten millisecond hitch, and a salvo
  is several of them in one frame.** Queue the rebuild and take one tile a frame; the thing
  that left the tile is drawn twice for that frame and nobody sees it.
- **There are two blocks of `body.mob` rules and the second is after the editor's CSS.** A
  mobile override written beside the first block loses to the second at the same
  specificity, and the loss is a size or a position rather than an error: the simple
  scheme's little map read 104 by 72 against the 132 by 90 it was written at until its
  block was moved to the end of the stylesheet. Measure the rect; do not read the rule.
- **A brain raised mid-battle must not clear what is the team's.** `aiInit` wipes the
  contacts, the call boards, the operations and the beaten zone for every side, which is
  right at the whistle and hands the player a blind opponent if it runs when he switches
  the simple scheme on. A soft init clears the slot's own board and operations and nothing
  else.
- **A rule that adds weight to a sector adds nothing to a sector the loop has already
  thrown away.** The objective scoring skips a quiet held sector and a sector out of the
  mood's reach with a `continue` each, above the line where the score is built, so an
  ATTACK directive weighed only there would put 420 points on a flag that was never in
  the list. Thread a directive through every early exit, or it is decoration.
- **A sector id is a string the moment it is an object key.** `AI.dir` is keyed by it and
  an operation carries it as the sector wrote it, so the two agree only when compared with
  `String()` on both sides; compared bare, a directed hold would match no operation and be
  raised again on every tick.
- **A frame's dt has to be floored as well as capped.** `frame()` took
  `min(.05, (now - last) / 1000)` and a requestAnimationFrame stamp can sit a few
  milliseconds behind a `last` written off `performance.now()` -- the harness does exactly
  that after a fast forward. A negative dt walked a falling man's clock below zero, his
  frame list was indexed at -1, and `bindGeom` threw on an undefined buffer: `Cannot read
  properties of undefined (reading 'vbo')`, twice in forty battles and never on a run made
  to find it, because it needs a man hit on the very frame the clock steps back. The
  harness keeping three game frames of a page error is what named it: `drawWrecks3D`'s
  falls loop, and not any of the guarded lit-pass draws the message pointed at. The dt is
  clamped at nought now and the index with it.
- **Two rules that turn the same thing at the same rate cancel to the frame, and what that
  looks like is a thing that has not moved yet.** A tube on a mission was laid on its
  beaten zone by `barrageTick` and turned toward the nearest known enemy by the
  halted-facing rule, both at 0.85 radians a second, and the mission never fired a round:
  ten left, cooldown at nought, nothing packed and nothing moving, which reads as a crew
  still coming round. When a gate row says a thing has not happened yet after a minute of
  simulation, print the bearing error and not only the count, and look for a second hand
  on the same wheel.
- **An armed placement takes the next tap on the ground, and every tap is one.** The
  emplacement button arms `G.place` and the touch path answers it before anything else,
  which is right; the gate row below it then tapped four pieces of open ground to give
  orders and the first of them dug a battery instead, with every assertion after it
  reading off a pad that had never opened. A row that leaves a mode armed hands it to
  every row under it.
- **A bonus on a score is not a priority.** The player's ATTACK added 420 to a sector's
  score and the doc said it outranked everything; a held victory flag with a body walking
  onto it scores most of a thousand, so the directed flag came second and the deal gave
  it one section of the three standing beside it. When a thing has to come first, sort
  on it, and let the score decide only among the rest.
- **A rule about the player's slot is a rule about the cards.** In a game no brain runs on
  that slot under classic, so a lock on its till read off the slot alone is invisible in
  play and cripples every card that puts a brain on both sides: the tactics card came back
  a walkover for whichever brain was German on all sixteen matches before anyone looked.
  Gate such a rule on the scheme that wants it, and run `tools/skirmish.mjs --self` after
  touching anything the player's slot reads, because it is the one card that cannot be
  fooled by one side never buying.

- **`G.hmap` is the sum of its own layers, and something once broke that quietly.**
  `hmap = hmap0 + cut + fill + pad` holds everywhere, which is what lets a piece of the
  height be recomputed from its parts when a shell opens the ground. `levelPad` used to
  write a building's footprint straight into `hmap` and not into a layer, so the first
  crater blown beside a house recomputed the ground under the house off the parts it
  could see and put the pad back on the hillside. Anything that changes the height writes
  a layer.
- **A drill about the ground has to be staged on ground that is open, and prove it.**
  A crater drill put down in a trench measures a hole that is already deeper than the one
  the shell would cut; `G.cut` keeps the deeper of the two, and the row comes back saying
  a 210 moves the ground half a unit. Require `coverAt` to read nought at the point AND
  round it, and print what it read.
- **A frame-difference row needs a control of two identical frames.** The renderer has
  its own frame-to-frame variation and anything that advances `G.t` -- which is easy to do
  by accident when forcing a queue -- moves the smoke, the sea and the grass with it, and
  then the whole frame differs and the row proves nothing. Age the queue rather than the
  clock, and print the floor.
- **An effect that is drawn and invisible looks exactly like one that is not drawn.** A
  smoke column was packed, uploaded and rasterised correctly for five rounds of
  screenshots and was simply the colour of the ground it was drawn over; then, fixed, it
  climbed three hundred units clean out of the top of the plate. Neither shows in a
  picture and both are one `gl.readPixels` away. When an effect looks absent, read the
  frame with and without it before touching the code -- `tools/fx.mjs` is that reading.
- **A screen point out of `w2s` is CSS pixels with y DOWN; `readPixels` is device pixels
  with y UP.** A window built the wrong way round lands somewhere else in the frame and
  the row comes back a clean nought, which is indistinguishable from the effect not being
  drawn.
- **`frame()` takes its dt off `last`, which the last real frame set.** Under SwiftShader
  that was most of a second ago, so the first stubbed step lands on the 50ms clamp and
  ages a 75ms muzzle flash almost out of existence. Anchor `last` to the virtual clock
  before stepping, and pause before the shutter: two settling frames are a tenth of a
  second of simulation.
- **A particle's motion has to move the ENTRY and not just the quad.** A column that
  climbs only inside `drawParticles3D` is a column that nothing but the rasteriser knows
  about: `gatherLights` reads the position, and so does anything measuring how high a
  burst got. `spawnFx` keeps `x0/y0/z0` beside `x/y/z` for that reason.
- **A pale translucent puff over pale dry ground is invisible, and so is a sooty one over
  its own scorch.** What a puff STARTS as is the whole of whether it reads at all. It
  leaves the ground sooty and lightens as it climbs, which is both what smoke does and
  what keeps it legible against the ground it is leaving.
- **A red tracer over dry ground adds nothing to a red channel that is already clipped.**
  Measured on Ortona, the Canadian tracer put a sixth of the pixels on the screen that the
  German one did for the same number of rounds. The tail carries the side's colour and the
  head is near-white on both, which is also what a burning element looks like.
- **`auHiss` picks a random window out of a 1.4-second noise buffer, and a layer longer
  than the buffer has no window to pick.** The offset goes negative and `start()` throws,
  which is what a heavy battery's second and a half of tail did the first time one was
  built. It is clamped to nought and the source loops, so a long layer runs for as long as
  it was asked for.
- **A ratio is compared against its floor on the EXCESS over parity, not by multiplying.**
  A jitter floor of 1.01x is one per cent, so a pair thirty-two per cent apart clears it by
  thirty to one; asked as `d > f * 1.5` the same floor sets a bar of 1.515x that only a
  wholly different weapon would clear, and the row failed on a pair it should have passed.
- **And the floor has to come from the same kind of thing.** A tank gun's report carries
  most of its variance in the top end and a mortar's carries almost none, so a Panzer IV
  against a StuG -- one gun on two hulls, which is the obvious control -- is the wrong
  control for a mortar. Each pair is measured against its own first piece rendered twice.
  Taking a max over three metrics before comparing is wrong for the same reason in the
  other direction: it is biased upward on both sides at once and put a floor of 1.09 under
  a pair that is 1.32 apart. Compare per metric.
- **Choosing which metric to report is two questions, and either one alone gets it
  wrong.** Signal-to-noise says whether a difference is real; it does not say whether the
  difference matters, and choosing by it picks the metric with the smallest floor. The two
  mortars differ by 1.04x in length against a floor of 1.004x, which reads as ten to one
  and is inaudible, while they differ by 1.40x in rms, which is the whole thing: selected
  that way the gate row reported brightness one run and length the next from identical
  code. Choosing the biggest difference instead picks a metric that may be measured badly
  -- brightness separates the two heavy batteries by 1.46x, but its floor on a piece whose
  tail runs a second and a half wanders out to 1.14x, so the same fact that reads fifty to
  one in rms read five to one there. Filter to the metrics that separate the pair by an
  amount worth having, then among those report the one measured most reliably.
- **Do not measure loudness as peak through a compressor.** The audio bus ends in one, and
  flattening peaks is the whole of what a compressor does, so peak is the single loudness
  measure that graph is built to destroy. Measured across the shell weapons it reads 2.2x
  where rms reads 8.9x, and on the two heavy batteries it reads 1.03x -- which is the
  compressor's answer rather than the guns'. Every level in the audio card and the gate row
  is rms for that reason.
- **A phone is a different bus, so measure on both.** `auRoom` builds a 0.42-second room on
  a phone against 0.62 on a desktop, which compresses anything the reverb tail carries: the
  two mortars' length difference falls from a thing to nothing, and a row resting on it
  passed on the desktop and failed on the phone in the same run.
- **A landform is arithmetic and two halves can look identical while one is a metre
  higher.** A mirrored map is fair only if the ground agrees with its own reflection, and
  the only way to know that is to sample it: the Gothic Line is measured over 1,750 points
  and disagrees with itself by at most 0.23 of a unit. No photograph would ever have
  said so.
