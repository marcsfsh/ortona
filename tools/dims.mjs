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
  us_stuart: { name: 'Stuart V (M3A3)',     len: 5.03,  gun: 5.03,   wid: 2.51,  hgt: 2.64,
               body: 2.51, bodyZ: 1.10, roof: 2.05, clear: 0.42 },
  us_sher:   { name: 'Sherman V (M4A4)',    len: 6.06,  gun: 6.06,   wid: 2.62,  hgt: 2.97,
               body: 2.62, bodyZ: 1.20, roof: 2.62, clear: 0.43 },
  am_sher:   { name: 'M4 (75 mm)',          len: 5.84,  gun: 5.89,   wid: 2.62,  hgt: 2.74,
               body: 2.56, bodyZ: 1.37, roof: 2.56, clear: 0.43 },   /* 19 ft 2 in long and 19 ft 4 in with
               the 75 forward, 8 ft 7 in over the sand shields, 9 ft to the top of the turret and 17 in of
               clearance. The body is the hull over the sponsons: 83 in between the track centres and a
               16.56 in track put the tracks' outer edges 2.53 m apart and the sponson sides stand just
               outside them, which is what leaves the sand shields their two inches a side */
  us_ach:    { name: '17pdr SP Achilles',   len: 5.97,  gun: 7.85,   wid: 3.05,  hgt: 2.57,
               body: 3.05, bodyZ: 1.88, clear: 0.43 },   /* the M10 is the one vehicle here whose
               widest point is not its tracks: the sponsons stand eight inches proud of them each
               side, so body is checked at the deck to confirm the flare is carrying the width.
               7.85 m over the gun is off the La Roche car, scaled on its bogie centres; the 7.5 m
               in most tables is the 3-inch M10 with a bit added for the 17-pounder. */
  ger_kt:    { name: 'Tiger II (Henschel)', len: 7.38,  gun: 10.286, wid: 3.755, hgt: 3.27,
               body: 3.66, bodyZ: 1.15, roof: 2.87, clear: 0.495 },
  ger_tig:   { name: 'Tiger I Ausf. E',     len: 6.316, gun: 8.45,   wid: 3.56,  hgt: 3.00,
               body: 2.97, bodyZ: 1.55, roof: 2.97, clear: 0.47 },   /* body and roof are the same
               number: the Tiger's hull sides are one vertical plate from the sponson to the roof */
  ger_h251:  { name: 'Sd.Kfz. 251 Ausf. D', len: 5.98,  gun: 5.98,   wid: 2.10,  hgt: 1.75,
               body: 1.73,   /* the armoured body is 1.73 m across and the track guards
               take it out to 2.10. Getting that step wrong is what made the first attempt look like
               a box on tracks rather than a Hanomag. 5.98 m is the Ausf. D; the 5.80 m in most
               tables is the Ausf. A to C. */
               clear: 0.32 },
  hr_251:    { name: 'Sd.Kfz. 251/1 Ausf. C', len: 5.80, gun: 5.80,  wid: 2.10,  hgt: 1.75,
               body: 1.73, clear: 0.32 },   /* the Ausf. A to C, which is the 5.80 m in most tables:
               2.10 m over the lockers and 1.73 m across the body at the crease, 1.75 m to the rim of the
               compartment, 320 mm under the belly */
  ger_maus:  { name: 'Panzer VIII Maus',    len: 10.09, gun: 10.20,  wid: 3.71,  hgt: 3.63,
               body: 3.71, bodyZ: 1.71, roof: 3.47, clear: 0.50 },   /* body: the hull is full width
               above the tracks, which is the whole shape of the thing -- the crew sit over the running
               gear because two 1.1 m tracks leave only 1.51 m between them. roof is that 3.71 taken in
               by the small lean on the last half metre, and is derived rather than published. 10.2 m
               over the gun against 10.09 m of hull: the muzzle clears the nose by 110 mm */
  ger_p4:    { name: 'Panzer IV Ausf. H',   len: 5.92,  gun: 7.02,   wid: 2.88,  hgt: 2.68,
               body: 2.36, bodyZ: 1.10, roof: 2.36, clear: 0.40 },   /* body: the superstructure sits
               well inboard of the 2.88 m over the guards, which is what leaves the walkable shelf */
  hr_p4:     { name: 'Panzer IV Ausf. H (Heer)', len: 5.92, gun: 7.02,  wid: 2.88,  hgt: 2.68,
               body: 2.36, bodyZ: 1.10, roof: 2.36, clear: 0.40 },   /* the same tank as the one above,
               built again from nothing, so the same published figures: the width is over the track
               guards, which is what it is without the Schürzen, and 3.33 m with them */
  hr_wirb:   { name: 'Flakpanzer IV Wirbelwind (Heer)', len: 5.92, gun: 5.92, wid: 2.90, hgt: 2.76,
               body: 2.36, bodyZ: 1.10, roof: 2.36, clear: 0.40 },   /* the Heer's Panzer IV hull under a
               turret built from nothing, so the hull's figures are that tank's; gun is len because the
               four barrels stop short of the nose */
  hr_panther: { name: 'Panther Ausf. A (Heer)', len: 6.87, gun: 8.66, wid: 3.27, hgt: 2.99,
               body: 3.25, bodyZ: 1.50, roof: 2.52, clear: 0.56 },   /* the envelope is Jentz's; the body
               and the roof are read off the factory's plan and front views, the body over the sponsons,
               which stand flush with the outside of the tracks at 1.49 m, and the roof between the upper
               sides, which lean in forty degrees over only 0.43 m of plate */
  ger_wirb:  { name: 'Flakpanzer IV Wirbelwind', len: 5.92, gun: 5.92, wid: 2.90,  hgt: 2.76,
               body: 2.36, bodyZ: 1.10, roof: 2.36, clear: 0.40 },   /* the Panzer IV hull unchanged
               underneath, so length, body, roof and clearance are its figures. gun equals len because
               the Flakvierling's barrels stop well short of the nose: the turret sits 0.37 m forward
               of centre and the muzzles reach 1.31 m past it, against 2.72 m of hull in front. hgt is
               to the top of the open turret's plate, which is what a published height is measured to
               on an open vehicle -- the magazines and the layer's head are not part of one */
  ger_stug:  { name: 'StuG IV (Sd.Kfz. 167)', len: 5.93, gun: 6.70,   wid: 2.95,  hgt: 2.20,
               body: 2.95, bodyZ: 1.55, roof: 2.59, clear: 0.40 },   /* the casemate stands out over the
               Panzer IV's guards at the bottom, so body is the published 2.95; but the Ausf. G compartment
               slants inboard on its way up, so the roof is a third of a metre narrower. 2.59 is that
               2.95 taken in at eleven degrees over the compartment's height, which is the slant the
               photographs show; it is derived rather than published, and it is the number that decides
               whether the thing reads as a StuG or as a box. 5.93 m is the Panzer IV hull; the 6.70 m
               over the gun is what every table gives for the StuG IV */
  us_m8:     { name: 'Universal Carrier',   len: 3.65,  gun: 3.65,   wid: 2.06,  hgt: 1.57 },
  am_jeep:   { name: 'Willys MB',           len: 3.36,  gun: 3.36,   wid: 1.575, hgt: 1.016,
               clear: 0.222 },   /* 132.25 in long, 62 in over the front wings, 8.75 in under the
               differentials; the height is the 40 in it is reducible to with the windscreen folded
               flat on the bonnet, which is how it is built, and the steering wheel, the pedestal
               and the men standing up out of it are no more part of that than an aerial is */
  hr_ks750:  { name: 'Zündapp KS 750',      len: 2.385, gun: 2.385,  wid: 1.65,  hgt: 1.01,
               clear: 0.15 },   /* 2,385 x 1,650 x 1,010 mm with the BW 40, and 150 mm of clearance
               laden; the height is to the handlebars, and the men and the gun on the sidecar mount are
               no more part of it than they are of the jeep's */
  us_m3:     { name: 'M3A1 Half-Track',     len: 6.172, gun: 6.172,  wid: 2.222, hgt: 2.261,
               body: 2.222, clear: 0.286 },   /* 20 ft 3 in over the roller, 7 ft 3.5 in wide,
               7 ft 5 in to the top of the M49 ring mount, 11.25 in of clearance */
  am_m3:     { name: 'M3A1 Half-Track (US)', len: 6.172, gun: 6.172, wid: 2.222, hgt: 2.261,
               body: 1.96, clear: 0.286 },   /* the same White as the old model's figures: 20 ft 3 in
               over the roller, 7 ft 3.5 in over the mine racks and 6 ft 5 in across the plates, 7 ft 5 in
               to the top of the M49 ring, 11.25 in under the front differential */
  am_m8:     { name: 'M8 Light Armored Car', len: 4.70, gun: 4.70, wid: 2.31, hgt: 1.91,
               body: 2.31, clear: 0.29 },   /* 15 ft 5 in long, with the 37 mm ending short of the nose,
               7 ft 7 in wide at the crease, 6 ft 3 in to the top of the turret and 11.5 in under the axles.
               The other set of figures in circulation, 100 in wide and 88.5 in high, is over the sand shields
               and over the ring mount, and both of those are fittings here */
  ger_sd222:  { name: 'Sd.Kfz. 222',         len: 4.80,  gun: 4.80,   wid: 1.95,  hgt: 1.70,
               clear: 0.25 },
  hr_234:    { name: 'Sd.Kfz. 234/1',       len: 6.02,  gun: 6.02,   wid: 2.33,  hgt: 2.10,
               clear: 0.35 },   /* 6.02 m over the bumper and 2.33 m over the crease, 350 mm under the belly,
               and 2.10 m to the top of the 2 cm turret, which is the rim with the screens held out */
  'hr_234:puma': { name: 'Sd.Kfz. 234/2 Puma', len: 6.02, gun: 6.80, wid: 2.33, hgt: 2.38,
               clear: 0.35 }   /* the same hull with the Puma's turret on the ring, the 5 cm reaching 6.80 m
               overall and the roof at 2.38 m, measured through the fitting rather than a second model */
  /* Two heights are published for the 222 and both are right: 1.70 m to the turret rim,
     2.00 m with the anti-grenade screens raised. The rim is the one that can be checked,
     so PROBE.topZ holds the screens out of the measurement. No body or deck width is
     given for it anywhere I can find, and a target invented from the model it is meant
     to be checking is worth nothing, so this one is checked on its envelope and its
     published 254 mm of clearance alone. */
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
  us_stuart: { bodyZ: 13.5, roofZ: 19.6 },
  us_sher:   { bodyZ: 14.5, roofZ: 21.6 },
  am_sher:   { bodyZ: 16.0, roofZ: 21.8, xLo: -25.0, xHi: -21.0, straddle: true, topZ: 10.2 },   /* the slice is
               taken halfway up the sponson, aft of the appliqué and the star; topZ holds the
               periscope heads and the aerial out of a height measured to the top of the turret */
  us_ach:    { bodyZ: 22.0, topZ: 8.0 },   /* bodyZ is a hand's breadth under the deck, above the
               tools and the jerricans and below the lifting eyes, where the side plate is bare.
               topZ keeps the turret crew out of the height: three of them stand in an open turret
               with their heads over the rim, and a man is no more part of a vehicle's height than
               an aerial is */
  ger_kt:    { bodyZ: 13.5, roofZ: 21.8 },
  ger_tig:   { bodyZ: 21.0, roofZ: 22.8, xLo: 22.2, xHi: 23.4, straddle: true },   /* the hull side is one
               plate the whole length, so the slice is taken at the one stretch of it with no cables,
               tools or fender bolts hung on the outside */
  us_m8:     { topZ: 4.0, hullZ: 18.4 },   /* an open vehicle is measured to its plate, not to
               the top of the man standing in it */
  am_jeep:   { noMount: true, hullZ: 12.0 },   /* the mount is a gun on a post, and hullZ holds the
               steering wheel, the rolled hood and the top of the spare out of the folded height */
  hr_ks750:  { noMount: true },   /* the mount is the gunner and his MG 34, turning on the sidecar seat */
  us_m3:     { topZ: 0.4, bodyZ: 17.0, xLo: -22.0, xHi: -19.0, straddle: true, hullZ: 24.0 },   /* the .50 stands
               above the 7 ft 5 in the ring mount tops out at, so the mount is held out of it */
  am_m3:     { noMount: true, bodyZ: 14.8, xLo: -31.5, xHi: -27.0, straddle: true },   /* the slice is
               taken between the clips of the pioneer tools aft of the mine racks, where the plate is bare;
               the ring is part of the hull and of the published height, and the .50 and its gunner
               standing on it are no more part of it than the jeep's gun is */
  ger_h251:  { topZ: 0.4, hullZ: 21.0, bodyZ: 15.0, xLo: -28.0, xHi: -25.0, straddle: true },   /* the slice
               is taken aft of the last bin and forward of the rear chamfer, where the side plate is bare */   /* the shield mount, the rear pintle MG and the aerial
               socket all stand above the 1.75 m top of the compartment, and none of them is part
               of a published height */
  hr_251:    { noMount: true, hullZ: 21.0, bodyZ: 14.8, xLo: -27.5, xHi: -25.5, straddle: true },   /* the
               slice is taken just under the crease aft of the last locker, where the side is bare; the
               MG 34 on its pintle and the man standing to it are no more part of the published height
               than the jeep's gun is */
  ger_maus:  { bodyZ: 20.0, roofZ: 28.0, xLo: -20.0, xHi: 20.0, straddle: true },   /* roofZ sits on the
               roof plate itself: the leaning side straddles every station below it and would report the
               full width of the base */
  ger_p4:    { bodyZ: 16.6, roofZ: 18.4, xLo: -8.0, xHi: -2.0, straddle: true, hullZ: 24 },   /* the body slice
               clears the Schuerzen stanchions on the guard, which top out at 15.2, and hullZ drops the
               rod aerial standing off the right rear of the superstructure */
  hr_p4:     { bodyZ: 16.0, roofZ: 19.6, xLo: 8.0, xHi: 12.0, straddle: true, hullZ: 24 },   /* the slice is taken
               between the second and third Schürzen brackets and forward of the cross, where the
               superstructure side is bare; hullZ drops the rod aerial on the left rear of the deck */
  hr_wirb:   { bodyZ: 16.0, roofZ: 19.6, xLo: 8.0, xHi: 12.0, straddle: true, hullZ: 24 },   /* the Heer
               Panzer IV's hull, so its slices */
  hr_panther: { bodyZ: 17.6, roofZ: 22.65, xLo: -7.0, xHi: -1.0, straddle: true },   /* the slice is taken
               just over the sponsons' floor at the station of the cross, which is clear of the rods, the
               tools and the jack on both sides, and the roof slice on the weld along its edge */
  ger_wirb:  { bodyZ: 16.6, roofZ: 18.4, xLo: -8.0, xHi: -2.0, straddle: true, hullZ: 24 },   /* the same
               hull as the Panzer IV, so the same two slices: the body clears the Schuerzen stanchions and
               roofZ sits on the superstructure roof, which on this vehicle is the plate the open turret
               is welded to rather than one under a turret */
  ger_stug:  { bodyZ: 18.0, roofZ: 23.2, xLo: -14.0, xHi: -9.0, straddle: true, hullZ: 27 },   /* the roof
               slice sits exactly on the roof plate: a slant that straddles a station reports its widest
               point, which is the base, so any station below the roof measures the bottom of the wall */   /* the slice
               is taken through the casemate wall aft of the spare-link rack and forward of the rear
               bins, where the plate is bare; hullZ drops the rod aerial on the right rear */
  am_m8:     { topZ: 6.0, hullZ: 24, bodyZ: 14.45, xLo: -20.0, xHi: -12.0, straddle: true },   /* the slice is
               taken at the crease over the rear bogie, behind the stowage box; topZ holds the lifting eyes on the
               rim out of the height and hullZ the whip aerial */
  ger_sd222:  { bodyZ: 3.0, roofZ: 14.7, xLo: -10.5, xHi: -9.0, topZ: 6.0, hullZ: 20 },   /* clear of the rear
               tyre and the wing tools; hullZ drops the rod aerial on the right of the bonnet */
  hr_234:    { topZ: 4.3, hullZ: 24 },   /* topZ holds the screens and their hinges out of the height the way the
               222's are, and hullZ the aerial on the engine deck */
  'hr_234:puma': { of: 'hr_234', up: 'puma', topZ: 7.7, hullZ: 24 }   /* `of` and `up` measure a vehicle with a
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
    V.hull.forEach(function (f) {
      const tall = topOf(f) > hullCap;
      f.v.forEach(p => {
        hx0 = Math.min(hx0, p[0]); hx1 = Math.max(hx1, p[0]); hy = Math.max(hy, Math.abs(p[1]));
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
