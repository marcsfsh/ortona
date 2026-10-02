#!/usr/bin/env node
/* Audit every vehicle against its published dimensions.
 *
 *   node tools/dims.mjs              every vehicle
 *   node tools/dims.mjs ger_kt       one
 *   node tools/dims.mjs --tol=3      tighten the tolerance to 3 per cent
 *   node tools/dims.mjs --base=HEAD  measure an older file instead
 *   node tools/dims.mjs --file=x.html
 *
 * It could only ever open the working file, which meant it could say whether a model is
 * the right size and never whether a change made it a different size. A pass that cuts
 * every big face into a grid has to be able to prove it moved nothing, and this is the
 * only thing that can say so.
 *
 * Proportion is the one thing about a model that is a fact rather than a
 * judgement, so it gets checked rather than eyeballed. Figures below are the
 * standard published ones; where sources differ the common value is used and
 * the note says so.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openGame, deploy, parseArgs, GAME } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const TOL = Number(args.tol || 5) / 100;
const ONLY = args._.length ? args._ : null;

/* metres. len = hull nose to tail, gun = overall with the gun forward, wid = over the
   tracks, hgt = ground to the top of the turret including its cupola and hatches, which
   is what the published overall height normally measures.

   `body` is the superstructure width at the sponson lip and `roof` the width of the
   hull roof. Those two matter as much as the envelope: a Tiger II whose bounding box
   is right to one per cent still looks wrong if the hull is a tenth too narrow for the
   tracks it stands on, because the eye reads the body against the track, not against
   a tape measure. `clear` is the ground clearance under the belly. */
const REAL = {
  am_stuart: { name: 'M3 light tank',       len: 4.53,  gun: 4.53,   wid: 2.24,  hgt: 2.39,
               body: 2.24, bodyZ: 1.41, roof: 2.24, clear: 0.42 },   /* 178.4 in long with the 37 mm inside
               it, 88 in wide, which is over the sponsons and the tracks alike, 94 in high and 16.5 in of
               clearance (afvdatabase). The drawing puts the roof of the turret at 2.32 m and the domes of
               the two periscopes at 2.45, either side of the published height */
  am_sher:   { name: 'M4A1 (75 mm)',        len: 5.84,  gun: 5.84,   wid: 2.62,  hgt: 2.74,
               body: 2.62, bodyZ: 1.37, roof: 2.49, clear: 0.43 },   /* 19 ft 2 in long, 8 ft 7 in wide,
               9 ft to the top of the hatch and 17 in of clearance. The four-view the model is laid
               over (tools/ref/am_sher.json) puts the muzzle of the 75 a tenth of a metre behind the front
               of the tracks, so the length with the gun forward is the length, and it runs 5.95 m from the
               tracks to the turned-down ends of the rear mudguards. The body is the cast hull over the
               sponsons, 2.65 m in the front view and 2.63 in the plan; the roof is the width across the
               rounded shoulders a hand under the top of the hull, 2.49 m in the front view */
  am_e8:     { name: 'M4A3E8 (76 mm)',      len: 6.27,  gun: 7.54,   wid: 2.99,  hgt: 2.97,
               body: 2.62, bodyZ: 1.54, roof: 2.62, clear: 0.44 },   /* the Easy Eight an M4A1 is rebuilt as:
               20 ft 7 in long over the fenders, 24 ft 8 in with the 76 mm forward, 9 ft 10 in over the
               tracks, 2.97 m to the cupola and 17.5 in of clearance. The four-view it is laid over
               (tools/ref/am_e8.json) puts the top of the cupola at 2.91 m, which is the height taken, and
               the brake a few centimetres past 7.54. The welded hull is the full width of the sponsons from
               the fenders to the roof, 2.61 m in the plan */
  am_m26:    { name: 'M26 Pershing (90 mm)', len: 6.34,  gun: 8.65,   wid: 3.51,  hgt: 2.78,
               body: 3.43, bodyZ: 1.44, roof: 2.18, clear: 0.44 },   /* 20 ft 9.5 in long over the fenders,
               28 ft 4.5 in with the 90 mm forward, 11 ft 6 in wide over the fenders, 9 ft 1.5 in to the cupola
               and 17.2 in of clearance. The two sheets it is laid over (tools/ref/am_m26.json and am_m26_b.json)
               draw the cupola at 2.66 and 2.72 m against their own lengths, which is the height taken off the
               published figure rather than off them. The body is over the stowage bins on the fenders, 3.43 m
               in the plan of the T26E4; the roof is the upper hull between them, 2.24 m in that plan and 2.12 in
               the T26E5's */
  am_m18:    { name: 'M18 Hellcat (76 mm)', len: 5.28,  gun: 6.65,   wid: 2.87,  hgt: 2.17,
               body: 2.87, bodyZ: 1.17, roof: 2.57, clear: 0.36 },   /* 17 ft 4 in long, 21 ft 10 in with the
               76 mm forward, 9 ft 5 in wide and 14 in of clearance. The published 8 ft 5 in is over the .50,
               which this card does not measure, so the height taken is to the turret's rim off the four-view
               it is laid over (tools/ref/am_m18.json), whose .50 stands at the published 2.57 m. The body is
               over the sponsons at their lower edge, which is the full width in the front view; the roof is
               between the sponsons' top edges, 2.59 m in the plan and 2.55 m in the front view */
  am_m7:     { name: 'M7 Priest (105 mm)',  len: 6.02,  gun: 6.02,   wid: 2.87,  hgt: 2.54,
               clear: 0.43 },   /* 19 ft 9 in long, 9 ft 5 in wide and 8 ft 4 in to the pulpit's ring. The
               drawing it is laid over (tools/ref/am_m7.json) agrees with the M4A1's running gear at 140 px/m
               and is 5.79 m long at that scale, and its pulpit stands out past the side to 3.1 m across; the
               drawing was taken, and the length reads short and the width wide for it */
  am_m12:    { name: 'M12 GMC (155 mm)',    len: 6.73,  gun: 6.73,   wid: 2.67,
               clear: 0.43 },   /* 22 ft 1 in to the folded spade and 8 ft 9 in wide. The drawing it is laid
               over (tools/ref/am_m12.json) is 6.5 m to the spade and 2.56 m across the hull at the scale of the
               M4A1's running gear, and was taken. The published 9 ft 5 in is not measured: the card measures the
               gun as the game lays it, and there it is the muzzle that is highest */
  hr_wespe:  { name: 'Wespe (Sd.Kfz. 124)', len: 4.81,  gun: 4.81,   wid: 2.28,  hgt: 2.30,
               clear: 0.34 },   /* 4.81 m long, the leFH 18/2's muzzle brake short of the nose, 2.28 m across
               the fenders and 2.30 m to the top of the casemate */
  hr_marder: { name: 'Marder III Ausf. M',  len: 4.95,  gun: 4.95,   wid: 2.15,  hgt: 2.48,
               clear: 0.40 },   /* 4.95 m over everything, the Pak 40's muzzle short of the nose, 2.15 m wide and
               2.48 m high over the frame on the casemate. The four-view it is laid over (tools/ref/hr_marder.json)
               agrees with the length and the width at one scale and its running gear with the 38(t)'s at another;
               the envelope was taken */
  am_weasel: { name: 'M29C Weasel',         len: 4.79,  gun: 4.79,   wid: 1.70,  hgt: 1.80,
               clear: 0.28 },   /* 15 ft 8.5 in over the cells, 5 ft 7 in wide over the tracks, 5 ft 11 in high
               and 11 in of clearance. The drawing it is laid over (tools/ref/am_weasel.json) stands the
               windscreen's frame at 1.93 m against the same length */
  ger_kt:    { name: 'Tiger II (Henschel)', len: 7.38,  gun: 10.286, wid: 3.755, hgt: 3.09,
               body: 3.66, bodyZ: 1.15, roof: 2.87, clear: 0.495 },   /* 3.09 m to the top of the cupola
               is Jentz's, and what the four-view drawing (tools/ref/ger_kt.json) stands the cupola at;
               3.27 was over the anti-aircraft ring */
  ger_tig:   { name: 'Tiger I Ausf. E',     len: 6.316, gun: 8.45,   wid: 3.705, hgt: 3.00,
               body: 3.14, bodyZ: 1.60, roof: 3.14, clear: 0.47 },   /* body and roof are the same
               number: the Tiger's hull sides are one vertical plate from the sponson to the roof.
               3.14 m is the published width on transport tracks, which is that plate with the outer
               wheels off, and it is what the four-view drawing (tools/ref/ger_tig.json) measures the
               superstructure at in plan and in front; the 2.97 m it was built to was a quarter of a
               metre narrow. 3.705 m is over the fenders, which stand a hand outside the tracks */
  hr_251:    { name: 'Sd.Kfz. 251/1 Ausf. C', len: 5.80, gun: 5.80,  wid: 2.10,  hgt: 1.75,
               body: 2.00, clear: 0.32 },   /* the Ausf. A to C, which is the 5.80 m in most tables:
               2.10 m over the lockers, 1.75 m to the rim of the compartment and 320 mm under the belly.
               The body is read off the four-view drawing in shots/ref (tools/ref/hr_251.json): 2.00 m
               across the crease in plan, at the scale its own 5.80 m of length gives it. The first version
               was built to 1.73, which the drawing puts a quarter of a metre narrow. */
  ger_maus:  { name: 'Panzer VIII Maus',    len: 9.52, gun: 10.61,  wid: 3.67,  hgt: 3.63,
               body: 3.67, bodyZ: 1.71, roof: 3.67, clear: 0.50 },   /* Jentz's 9.03 m of hull, 10.085 m
               over the gun, 3.67 m wide and 3.63 m high, and the four-view drawing it is laid over
               (tools/ref/ger_maus.json) agrees with all four at one scale, the height being to the top of
               the commander's periscope. The hull and the gun are measured here with the jettison tank
               across the tail, which stands 0.49 m behind the rear plate and is in neither published
               figure: 9.03 and 10.12 without it. The body and the roof are the full width, because the
               hull is one slab over the tracks and the deck runs out to the side plates */
  hr_p4:     { name: 'Panzer IV Ausf. H (Heer)', len: 5.92, gun: 7.02,  wid: 2.88,  hgt: 2.68,
               body: 2.36, bodyZ: 1.45, roof: 2.36, clear: 0.40 },   /* the width is over the track
               guards, which is what it is without the Schürzen, and 3.33 m with them; the body is the
               superstructure, which sits well inboard of the guards and leaves the walkable shelf */
  hr_wirb:   { name: 'Flakpanzer IV Wirbelwind (Heer)', len: 5.92, gun: 5.92, wid: 2.90, hgt: 2.76,
               body: 2.36, bodyZ: 1.45, roof: 2.36, clear: 0.40 },   /* the Heer's Panzer IV hull under a
               turret built from nothing, so the hull's figures are that tank's; gun is len because the
               four barrels stop short of the nose */
  hr_panther: { name: 'Panther Ausf. A (Heer)', len: 6.87, gun: 8.66, wid: 3.27, hgt: 2.99,
               body: 3.25, bodyZ: 1.50, roof: 2.52, clear: 0.56 },   /* the envelope is Jentz's; the body
               and the roof are read off the factory's plan and front views, the body over the sponsons,
               which stand flush with the outside of the tracks at 1.49 m, and the roof between the upper
               sides, which lean in forty degrees over only 0.43 m of plate */
  ger_stug:  { name: 'StuH 42 (Sd.Kfz. 142/2)', len: 5.40, gun: 6.14,   wid: 2.95,  hgt: 2.15,
               body: 2.33, bodyZ: 1.39, roof: 2.16, clear: 0.39 },   /* the StuG III Ausf. G hull with the
               10.5 cm howitzer: 5.40 m of hull, 6.14 m over the brake, 2.95 m over the fenders, 2.15 m to
               the cupola and 390 mm of clearance. The body and the roof are the casemate at the foot and at
               the roof, read off the four-view it is laid over (tools/ref/ger_stug.json): 2.31 m and 2.17 m
               in the front view, leaning in ten degrees between them, with the fenders running out past it */
  am_jeep:   { name: 'Willys MB',           len: 3.36,  gun: 3.36,   wid: 1.575, hgt: 1.321,
               clear: 0.222 },   /* 132.25 in long, 62 in over the grab handles on the rear body,
               8.75 in under the differentials, and 52 in to the top of the steering wheel, which is
               the height it is reducible to with the windscreen folded flat, which is how it is
               built. The drawing it is laid over agrees with all four; it was 62 in over the wings
               and 40 in folded until then, and the drawing has neither. The pedestal and the men
               standing up out of it are no more part of that height than an aerial is */
  hr_ks750:  { name: 'Zündapp KS 750',      len: 2.49,  gun: 2.49,   wid: 1.65,  hgt: 1.01,
               clear: 0.15 },   /* 1,650 x 1,010 mm with the BW 40, and 150 mm of clearance laden; the
               height is to the handlebars, and the men and the gun on the sidecar mount are no more part
               of it than they are of the jeep's. The published length is 2,385 mm; the drawing it is laid
               over agrees with the wheelbase, the height and the width and puts it at 2.25 m to the spare
               on the tail and 2.49 m over the trailer coupling behind that, which the model carries, so
               the length is the drawing's */
  am_m3:     { name: 'M3 Half-Track (US)', len: 6.18, gun: 6.18, wid: 1.962, hgt: 2.261,
               body: 1.962, clear: 0.286 },   /* the M3 the drawing is of: 20 ft 3.5 in over the roller
               and the pintle, 6 ft 5.25 in across the body, which is the widest thing on it once there
               are no mine racks, 7 ft 5 in over the .50 on its pedestal, 11.25 in under the front
               differential */
  am_m8:     { name: 'M8 Light Armored Car', len: 4.70, gun: 4.70, wid: 2.31, hgt: 1.91,
               body: 2.31, clear: 0.29 },   /* 15 ft 5 in long, with the 37 mm ending short of the nose,
               7 ft 7 in wide at the crease, 6 ft 3 in to the top of the turret and 11.5 in under the axles.
               The other set of figures in circulation, 100 in wide and 88.5 in high, is over the sand shields
               and over the ring mount, and both of those are fittings here */
  hr_234:    { name: 'Sd.Kfz. 234/1',       len: 6.02,  gun: 6.02,   wid: 2.33,  hgt: 2.10,
               clear: 0.35 },   /* 6.02 m over the bumper and 2.33 m over the crease, 350 mm under the belly,
               and 2.10 m to the top of the 2 cm turret, which is the rim with the screens held out */
  'hr_234:puma': { name: 'Sd.Kfz. 234/2 Puma', len: 6.02, gun: 6.80, wid: 2.33, hgt: 2.38,
               clear: 0.35 }   /* the same hull with the Puma's turret on the ring, the 5 cm reaching 6.80 m
               overall and the roof at 2.38 m, measured through the fitting rather than a second model */
};

/* Where to slice each hull, in model units: the sponson lip and the roof plate.
   xLo/xHi narrow the slice to a station along the hull where nothing is strapped to
   the side. Without it a Panzer IV measures 2.88 m across the body, because the
   slice runs through the spare road wheels racked on its guard. `straddle` lets a
   face that crosses the slice plane contribute its widest point, which is what a
   plain box side needs: its only vertices are at the top and bottom of the plate.

   `topZ` and `hullZ` are the height cap: a face reaching above the cap is dropped
   whole from the height measurement. Two metres of rod aerial is not part of any
   published height, and half the fleet mounts its aerial on the hull rather than on
   the turret, so the cap has to be available on both. */
const PROBE = {
  am_e8:     { bodyZ: 18.0, roofZ: 22.0, xLo: 8.0, xHi: 16.0, straddle: true, topZ: 12.0 },   /* the slice is taken
               ahead of the racks of spare shoes on the sponsons; topZ keeps the lid's periscope and the aerial out */
  am_stuart: { bodyZ: 16.5, roofZ: 19.0, xLo: -5.0, xHi: -1.0, straddle: true, hullZ: 21.0 },   /* the slice is
               taken halfway up the sponson between its two seams of rivets; hullZ holds the aerial out */
  am_sher:   { bodyZ: 16.0, roofZ: 22.0, xLo: -5.0, xHi: -1.0, straddle: true, topZ: 9.3 },   /* the slice is
               taken under the turret, where the roof is flat and nothing is strapped to the sides; topZ
               holds the periscope heads out of a height measured to the top of the hatch */
  am_m26:    { bodyZ: 16.8, roofZ: 18.7, xLo: 1.0, xHi: 4.0, straddle: true, topZ: 13.8 },   /* the slice is taken
               through the second bin on each fender; topZ holds the lid's periscope and the aerial out */
  am_m18:    { bodyZ: 13.65, roofZ: 17.15, xLo: -5.0, xHi: -1.0, topZ: 8.45 },   /* the slices are
               taken under the turret at the sponson's two edges, where nothing is hung on it; topZ holds
               the lifting eyes on the rim out */
  am_m7:     { hullZ: 30.0 },   /* hullZ holds the .50 on the pulpit's ring out of a height published to the ring */
  am_m12:    { topZ: 0 },   /* the gun is laid up in the game and is not part of the height, which is not measured */
  hr_wespe:  { topZ: 4.5, tailX: -28.7 },   /* topZ holds the tube, laid up as the game lays it, out of the
               casemate's height, and tailX the silencer across the tail out of the length */
  hr_marder: { hullZ: 29.5 },   /* hullZ holds the aerial out and keeps the frame over the casemate in */
  am_weasel: { noMount: true, hullZ: 23.0, tailX: -28.2 },   /* the mount is a gun on a post, hullZ holds the
               aerial out and tailX the rudders folded up behind the stern cell */
  ger_kt:    { bodyZ: 13.5, roofZ: 22.4 },
  ger_tig:   { bodyZ: 18.5, roofZ: 22.0, xLo: 22.2, xHi: 23.4, straddle: true },   /* the hull side is one
               plate the whole length, so the slice is taken at the one stretch of it with no cables,
               tools or fender bolts hung on the outside */
  am_jeep:   { noMount: true, hullZ: 15.6 },   /* the mount is a gun on a post, and hullZ holds the
               post and the top of the spare, which stands a little over the steering wheel on the
               tail, out of the folded height */
  hr_ks750:  { noMount: true },   /* the mount is the gunner and his MG 34, turning on the sidecar seat */
  am_m3:     { bodyZ: 16.0, xLo: -31.5, xHi: -27.0, straddle: true },   /* the slice is taken aft of the
               seam and forward of the rear chamfer, under the hooks for the canvas, where the plate is bare;
               the published height is over the .50 on its pedestal, so the mount is in it */
  hr_251:    { noMount: true, hullZ: 21.0, bodyZ: 15.6, xLo: -28.8, xHi: -26.5, straddle: true },   /* the
               slice is taken just under the crease aft of the last locker, where the side is bare; the
               MG 34 on its pintle and the man standing to it are no more part of the published height
               than the jeep's gun is */
  ger_maus:  { bodyZ: 20.0, roofZ: 24.6, xLo: -20.0, xHi: 0.0, straddle: true, hullZ: 30 },   /* roofZ sits just
               under the deck, where the side plate runs up to it; hullZ drops the two rod aerials */
  hr_p4:     { bodyZ: 17.0, roofZ: 19.6, xLo: -10.0, xHi: -5.2, straddle: true, hullZ: 24 },   /* the slice is
               taken aft of the cross and ahead of the louvres, where the superstructure side is bare, and
               clear of the guard under it: the guards are 0.4 m below the roof, so a slice any lower
               reads them; hullZ drops the rod aerial on the left rear of the deck */
  hr_wirb:   { bodyZ: 17.0, roofZ: 19.6, xLo: -10.0, xHi: -5.2, straddle: true, hullZ: 24 },   /* the Heer
               Panzer IV's hull, so its slices */
  hr_panther: { bodyZ: 17.6, roofZ: 22.65, xLo: -7.0, xHi: -1.0, straddle: true },   /* the slice is taken
               just over the sponsons' floor at the station of the cross, which is clear of the rods, the
               tools and the jack on both sides, and the roof slice on the weld along its edge */
  ger_stug:  { bodyZ: 17.0, roofZ: 22.75, xLo: 14.5, xHi: 18.0, straddle: true, hullZ: 27 },   /* the slice is
               taken at the front of the casemate, ahead of the spare links on its right and the tow cable on
               its left and over the cables on the fenders; the roof slice sits on the roof plate, because the
               leaning wall under it would report its foot; hullZ drops the rod aerial on the engine deck */
  am_m8:     { topZ: 6.0, hullZ: 24, bodyZ: 14.45, xLo: -20.0, xHi: -12.0, straddle: true },   /* the slice is
               taken at the crease over the rear bogie, behind the stowage box; topZ holds the lifting eyes on the
               rim out of the height and hullZ the whip aerial */
  hr_234:    { topZ: 4.3, hullZ: 24, tailX: -34.2 },   /* topZ holds the screens and their hinges out of the
               height, which is published to the rim with the screens held out, hullZ the aerial on the engine
               deck, and tailX the spare wheel hung on the lower rear plate out of the length */
  'hr_234:puma': { of: 'hr_234', up: 'puma', topZ: 7.7, hullZ: 24, tailX: -34.2 }   /* `of` and `up` measure a vehicle with a
               fitting that changes the mount; topZ holds the hatch lids and the ventilator out of the roof height */
};
const SCALE = 11.7;   /* units per metre: 8.5 cm to the unit, the scale the fleet is built at */

const browser = await launch();
let file = args.file === undefined ? GAME : String(args.file), tmp = null;
if (args.base !== undefined) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-dims-'));
  file = path.join(tmp, 'ortona.html');
  fs.writeFileSync(file, execFileSync('git', ['show', `${String(args.base)}:ortona.html`],
                                      { encoding: 'utf8', maxBuffer: 1 << 28 }));
}
const { page, context } = await openGame(browser, 'laptop', { file, quiet: true });
await deploy(page, { side: 'us' });

const measured = await page.evaluate(probe => {
  const out = {};
  const keys = Object.keys(window.VMODEL).concat(Object.keys(probe).filter(k => probe[k].of));
  keys.forEach(function (k) {
    const pr0 = probe[k] || {};
    /* a fitting that swaps the mount is measured with that mount on it, placed where the fitting
       puts it (`barUp`), because a published figure over the gun is a figure over the gun fitted */
    let V = window.VMODEL[pr0.of || k];
    if (pr0.of) V = Object.assign({}, V, { tur: V.turUp[pr0.up] }, (V.barUp && V.barUp[pr0.up]) || {});
    const tx = V.turX || 0;
    const hullCap = pr0.hullZ === undefined ? 1e9 : pr0.hullZ;
    let hx0 = 1e9, hx1 = -1e9, hy = 0, hz = 0;
    /* `zt` is the top of the plate a piece was cut off, where the piece is a piece: a
       face that reaches above the cap is dropped whole, and a cut one has to be dropped
       on its parent's extent or the filter is only a filter on tessellation */
    const topOf = f => (f.zt === undefined ? Math.max.apply(null, f.v.map(p => p[2])) : f.zt);
    /* `tailX` leaves out of the length a face whose middle lies aft of it: a spare wheel hung on
       the tail plate is on every drawing of the vehicle and in no published length of its hull */
    const tailX = pr0.tailX === undefined ? -1e9 : pr0.tailX;
    V.hull.forEach(function (f) {
      const tall = topOf(f) > hullCap;
      let mx = 0;
      f.v.forEach(p => { mx += p[0] / f.v.length; });
      const aft = mx < tailX;
      f.v.forEach(p => {
        if (!aft) { hx0 = Math.min(hx0, p[0]); hx1 = Math.max(hx1, p[0]); }
        hy = Math.max(hy, Math.abs(p[1]));
        if (!tall) hz = Math.max(hz, p[2]);
      });
    });

    /* Slice the hull at a height and take the widest armour there. Faces are skipped
       when they sit outside the track line, which is where the stowage and the track
       itself live, so the number is the body rather than what is strapped to it. */
    const pr = pr0;
    function widthAt(z, band) {
      let w = 0;
      const xLo = pr.xLo === undefined ? -1e9 : pr.xLo, xHi = pr.xHi === undefined ? 1e9 : pr.xHi;
      V.hull.forEach(function (f) {
        let lo = 1e9, hi = -1e9, x0 = 1e9, x1 = -1e9;
        f.v.forEach(p => {
          lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]);
          x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        });
        if (hi < z - band || lo > z + band) return;
        /* The station is matched by overlap, not per vertex: the side of a long box
           has vertices only at its ends, so a per-vertex test throws away the very
           plate the slice is meant to measure. */
        if (x1 < xLo || x0 > xHi) return;
        /* And a plain box side has vertices only at its top and bottom, so a slice
           through the middle of one finds nothing unless a face that crosses the
           plane may contribute its widest point. */
        const straddles = pr.straddle && lo < z && hi > z;
        f.v.forEach(p => { if (straddles || Math.abs(p[2] - z) <= band) w = Math.max(w, Math.abs(p[1])); });
      });
      return w * 2;
    }
    /* the aerial whip is two and a half metres of wire and is not part of the height */
    let tz = 0, tx1 = -1e9;
    const hCap = pr.topZ === undefined ? 20 : pr.topZ;
    V.tur.forEach(function (f) {
      const tall = topOf(f) > hCap;
      f.v.forEach(function (p) {
        if (!tall) tz = Math.max(tz, p[2]);
        tx1 = Math.max(tx1, p[0]);
      });
    });
    /* Ground clearance comes from the model's own declared belly height. No geometric
       filter reliably separates the hull floor from the track running under it: on
       every one of these the track's inboard edge lies inside the hull's own width. */
    out[k] = { len: hx1 - hx0, gun: Math.max(hx1, tx + tx1) - hx0, wid: hy * 2,
               hgt: pr.noMount ? hz : Math.max(hz, V.mountZ + tz),
               body: pr.bodyZ ? widthAt(pr.bodyZ, 1.0) : null,
               roof: pr.roofZ ? widthAt(pr.roofZ, 0.45) : null,
               clear: V.belly === undefined ? null : V.belly };
  });
  return out;
}, PROBE);

await context.close();
await browser.close();
if (tmp) fs.rmSync(tmp, { recursive: true, force: true });

let bad = 0;
const keys = (ONLY || Object.keys(REAL)).filter(k => measured[k]);
const envelope = [], internals = [];
for (const k of keys) {
  const r = REAL[k], m = measured[k];
  if (!r) { console.error(`no published figures for ${k}`); continue; }
  const row = { vehicle: r.name }, inner = { vehicle: r.name };
  function cell(target, dim, got, want) {
    if (got === null || want === undefined) { target[dim] = '-'; return; }
    const err = (got - want) / want;
    if (Math.abs(err) > TOL) bad++;
    target[dim] = `${got.toFixed(2)} / ${want.toFixed(2)}  ${err >= 0 ? '+' : ''}${(err * 100).toFixed(0)}%`;
  }
  for (const dim of ['len', 'gun', 'wid', 'hgt']) cell(row, dim, m[dim] / SCALE, r[dim]);
  for (const dim of ['body', 'roof', 'clear']) cell(inner, dim, m[dim] === null ? null : m[dim] / SCALE, r[dim]);
  envelope.push(row);
  if (r.body || r.clear !== undefined) internals.push(inner);
}

console.log(`\nmodel / published, in metres, at ${SCALE} units per metre`);
console.log('\nenvelope\n');
console.table(envelope);
if (internals.length) {
  console.log('internals: body = superstructure width at the sponson, roof = hull roof width,');
  console.log('clear = ground clearance. A right envelope round a wrong body still looks wrong.\n');
  console.table(internals);
}
console.log(bad ? `\n${bad} dimension(s) outside ${(TOL * 100).toFixed(0)}%` : `\nall within ${(TOL * 100).toFixed(0)}%`);
process.exit(bad ? 1 : 0);
