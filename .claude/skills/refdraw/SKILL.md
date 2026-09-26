---
name: refdraw
description: Check a model in ortona.html against a reference drawing (a factory drawing, a four-view, a plan and elevations) and correct it until the two agree line for line. Use when the user supplies a drawing or blueprint of a vehicle or gun and asks for the model to be built to it, checked against it, or improved from it.
---

# A model against its drawing

A photograph of a model says whether it looks like the thing and `tools/dims.mjs` says whether
its envelope is the right size. Neither says whether a part stands where the part stands: the
Panther's turret was half a metre too far forward and the 251's running gear a third of a metre
too far aft, and every photograph of both read as the vehicle. So the model's own faces are
projected onto the drawing at the drawing's scale, view by view, and read against it.

`tools/overlay.mjs` does the projecting. This file is the method round it.

## 1. Save the drawing where the tool can find it

An attached image arrives under `/root/.claude/uploads/<session>/`. Copy it to
`shots/ref/<key>.jpg` (or `.png`). `shots/` is ignored by git, and it has to stay that way: the
repository carries no image files (hard rule 5). The drawing therefore lives only as long as the
container does; the spec in `tools/ref/` names the path, and a later session needs the drawing
supplied again to rerun it.

## 2. Read the sheet before measuring anything

```sh
node tools/overlay.mjs --grid shots/ref/<key>.jpg --k=2                     # the whole sheet with a pixel grid
node tools/overlay.mjs --grid shots/ref/<key>.jpg --crop="x,y,w,h;x,y,w,h" --k=6   # zoomed boxes, one file each
```

Output goes to `shots/overlay/<name>-grid-N.png`; read each one with the Read tool. Find the
views (side, plan, front, rear), which way the nose points in the side and the plan, and the
ground line. Then read every position you are going to use at a zoom of six or more. A reading
at two is not a reading: the 251's road wheel came off the whole sheet at 36.5 px and off a zoom
at 43.

Decide what a drawn outline IS by looking at it in every view before building it. A box on the
side of the 251's bonnet read as the upper side plate from the side view alone; the plan showed
it standing out past the crease and the front view showed louvres in its face, and it is the
Ausf. C's armoured cover over the engine intake.

## 3. A scale per view, off a published figure measured in that view

Each view gets its own pixels per metre, taken off a published figure that the view shows square:
the length in the side and the plan, the width in the plan, the front and the rear, the height in
the side, the front and the rear. Then check it against a third figure the drawing also shows (a
tyre, a wheelbase, a track). The views of one sheet are often not drawn to one scale:

- the 57 mm gun's plan came out five per cent bigger than its side elevation;
- the 251's side view is four per cent taller than its own length says, so the side takes a
  vertical scale of its own (`ppmv`) while its front and rear views agree with 1.75 m.

The game is 11.7 units to the metre, so one drawing pixel is `11.7 / ppm` units.

## 4. Write the spec

`tools/ref/<key>.json`, committed (it is text):

```json
{ "image": "shots/ref/hr_251.jpg", "key": "hr_251", "up": [], "crew": false,
  "views": {
    "side":  { "nose": "left", "crop": [0, 0, 500, 190], "ppm": 81.0, "ppmv": 85.2, "at": [33.8, 0, 0], "px": [20.75, 182.5], "k": 3 },
    "plan":  { "nose": "left", "crop": [0, 372, 500, 190], "ppm": 80.7, "at": [33.8, 0, 0], "px": [18.75, 466.6], "k": 3 },
    "front": { "crop": [30, 190, 210, 180], "ppm": 82.9, "at": [0, 0, 0], "px": [131.5, 365], "k": 4 },
    "rear":  { "crop": [270, 190, 215, 180], "ppm": 80.8, "at": [0, 0, 0], "px": [374.5, 363.75], "k": 4 } } }
```

`at` is a model point in model units and `px` the drawing pixel it lands on. Pin something the
model is certain to have right: the nose at the centreline on the ground, the middle of the
track on the ground line. `key` may be a `VMODEL` vehicle or a `GUNMODEL` gun (`pack: true` for
the piece travelling). `up` names fittings to draw (a swapped mount, `skirts`, `mg`, anything in
`addUp`); `crew: true` draws the men.

## 5. Lay the model over it

```sh
node tools/overlay.mjs tools/ref/<key>.json --tag=before
node tools/overlay.mjs tools/ref/<key>.json --only=side,plan --tag=v2
node tools/overlay.mjs tools/ref/<key>.json --file=/tmp/old.html          # an older file
```

Each view is written to `shots/overlay/<key>-<view>-<tag>.png`, with only the edges a
draughtsman would draw (creases and outlines, with hidden lines removed through a depth buffer).
Blue is the hull, red the mount, green the men, magenta a fitting. It prints each view's scale
and the model's span in drawing pixels and metres, so a length or a width that is out shows as a
number before it is looked at.

To read one region closely, copy the spec to the scratchpad with a tighter `crop` and a `k` of
seven or eight, and run the copy.

## 6. Turn what you see into model units, then write the list

Before editing anything, write down every disagreement as drawing value against model value, in
model units. The projections, all orthographic, with `px` in the spec as `(px0, py0)`:

| view | across the image | down the image |
|---|---|---|
| side, nose left | `x = at.x - (px - px0) * 11.7 / ppm` | `z = at.z + (py0 - py) * 11.7 / ppmv` |
| side, nose right | `x = at.x + (px - px0) * 11.7 / ppm` | as above |
| plan, nose left | `x` as the side | `y = at.y + (py0 - py) * 11.7 / ppm` (the vehicle's right is up) |
| front | `y = at.y - (px - px0) * 11.7 / ppm` (its right is on the image's left) | `z` as the side, with `ppm` |
| rear | `y = at.y + (px - px0) * 11.7 / ppm` | `z` as the side, with `ppm` |

Take a position ALONG the vehicle only from a view that shows it square (the side or the plan), a
height from the side, the front or the rear, and a width from the plan, the front or the rear.
Where two views disagree about a part, believe the one that sees it square and use the other as
the check. A three-quarter photograph is never a source of position.

## 7. Fix the builders, then look again

Edit the builders in `ortona.html`, keeping to the file's ES5 and its style. Script larger edits
in Python with every anchor asserted to occur exactly once before anything is written, because an
edit script that dies on a later anchor writes nothing and the change you think you made is not in
the file. `node tools/lint.mjs` after every edit.

Then rerun the overlay with a new tag and read all four views again, including the ones you did
not mean to touch. Check each move in the direction it went: the 251's headlamps were moved a unit
aft on one view's reading, and the next overlay put them a unit too far aft in both the side and
the plan.

## 8. Close it out

- `node tools/dims.mjs <key>`: if the drawing changed a figure the card measures (the 251's body
  across the crease went from 1.73 m to the drawing's 2.00), change `REAL` and say in its comment
  where the new figure came from; move a `PROBE` slice if the parts under it moved.
- Read the unit's gate row in `tools/check.mjs` for anything the geometry feeds: the periscope
  eye's height, a mount's arc, how far a wreck sits down, where the men dismount.
- Photograph it: the four quarters close to and at play distance, on `veh` and on `phone`.
- `npm run verify`, alone (never two Chromium tools at once).
- Say in the builder's comment what the drawing moved and by how much, and in CLAUDE.md beside
  the vehicle.

## Gotchas

- On screen, model +y is the vehicle's right. In a plan with the nose left the right is at the
  top; in a front view it is on the image's left.
- `at` is model units and `px` drawing pixels. Pin with a point you trust, or every reading
  inherits the pin's error.
- A spec reads the model the page builds, not a live unit: the mount at `turX`, `turY`, `mountZ`
  (or `barUp` for a fitting), the crew only with `crew: true`.
- A drawing shows what its vehicle carried, which may be a fitting here. Pass it in `up`, or read
  it as a thing the model is right to lack.
- The drawing is somebody's drawing. Where it disagrees with a published figure by more than its
  own line weight, say so in the comment and pick one on purpose.
