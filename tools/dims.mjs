#!/usr/bin/env node
/* Audit every vehicle against its published dimensions.
 *
 *   node tools/dims.mjs              every vehicle
 *   node tools/dims.mjs ger_kt       one
 *   node tools/dims.mjs --tol=3      tighten the tolerance to 3 per cent
 *
 * Proportion is the one thing about a model that is a fact rather than a
 * judgement, so it gets checked rather than eyeballed. Figures below are the
 * standard published ones; where sources differ the common value is used and
 * the note says so.
 */

import { launch, openGame, deploy, parseArgs } from './harness.mjs';

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
  ger_p4:    { name: 'Panzer IV Ausf. H',   len: 5.92,  gun: 7.02,   wid: 2.88,  hgt: 2.68,
               body: 2.36, bodyZ: 1.10, roof: 2.36, clear: 0.40 },   /* body: the superstructure sits
               well inboard of the 2.88 m over the guards, which is what leaves the walkable shelf */
  us_m8:     { name: 'Universal Carrier',   len: 3.65,  gun: 3.65,   wid: 2.06,  hgt: 1.57 },
  us_m3:     { name: 'M3A1 Half-Track',     len: 6.172, gun: 6.172,  wid: 2.222, hgt: 2.261,
               body: 2.222, clear: 0.286 },   /* 20 ft 3 in over the roller, 7 ft 3.5 in wide,
               7 ft 5 in to the top of the M49 ring mount, 11.25 in of clearance */
  ger_sd222:  { name: 'Sd.Kfz. 222',         len: 4.80,  gun: 4.80,   wid: 1.95,  hgt: 1.70,
               clear: 0.25 }
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
  us_ach:    { bodyZ: 22.0, topZ: 8.0 },   /* bodyZ is a hand's breadth under the deck, above the
               tools and the jerricans and below the lifting eyes, where the side plate is bare.
               topZ keeps the turret crew out of the height: three of them stand in an open turret
               with their heads over the rim, and a man is no more part of a vehicle's height than
               an aerial is */
  ger_kt:    { bodyZ: 13.5, roofZ: 21.8 },
  ger_tig:   { bodyZ: 21.0, roofZ: 22.8, xLo: 22.2, xHi: 23.4, straddle: true },   /* the hull side is one
               plate the whole length, so the slice is taken at the one stretch of it with no cables,
               tools or fender bolts hung on the outside */
  us_m3:     { topZ: 0.4, bodyZ: 17.0, xLo: -22.0, xHi: -19.0, straddle: true },   /* the .50 stands
               above the 7 ft 5 in the ring mount tops out at, so the mount is held out of it */
  ger_h251:  { topZ: 0.4, hullZ: 21.0, bodyZ: 15.0, xLo: -28.0, xHi: -25.0, straddle: true },   /* the slice
               is taken aft of the last bin and forward of the rear chamfer, where the side plate is bare */   /* the shield mount, the rear pintle MG and the aerial
               socket all stand above the 1.75 m top of the compartment, and none of them is part
               of a published height */
  ger_p4:    { bodyZ: 16.6, roofZ: 18.4, xLo: -8.0, xHi: -2.0, straddle: true, hullZ: 24 },   /* the body slice
               clears the Schuerzen stanchions on the guard, which top out at 15.2, and hullZ drops the
               rod aerial standing off the right rear of the superstructure */
  ger_sd222:  { bodyZ: 3.0, roofZ: 14.7, xLo: -10.5, xHi: -9.0, topZ: 6.0, hullZ: 20 }   /* clear of the rear
               tyre and the wing tools; hullZ drops the rod aerial on the right of the bonnet */
};
const SCALE = 11.7;   /* units per metre: 8.5 cm to the unit, the scale the fleet is built at */

const browser = await launch();
const { page, context } = await openGame(browser, 'laptop', { quiet: true });
await deploy(page, { side: 'us' });

const measured = await page.evaluate(probe => {
  const out = {};
  Object.keys(window.VMODEL).forEach(function (k) {
    const V = window.VMODEL[k], tx = V.turX || 0;
    const pr0 = probe[k] || {};
    const hullCap = pr0.hullZ === undefined ? 1e9 : pr0.hullZ;
    let hx0 = 1e9, hx1 = -1e9, hy = 0, hz = 0;
    V.hull.forEach(function (f) {
      const tall = f.v.some(p => p[2] > hullCap);
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
      const tall = f.v.some(p => p[2] > hCap);
      f.v.forEach(function (p) {
        if (!tall) tz = Math.max(tz, p[2]);
        tx1 = Math.max(tx1, p[0]);
      });
    });
    /* Ground clearance comes from the model's own declared belly height. No geometric
       filter reliably separates the hull floor from the track running under it: on
       every one of these the track's inboard edge lies inside the hull's own width. */
    out[k] = { len: hx1 - hx0, gun: Math.max(hx1, tx + tx1) - hx0, wid: hy * 2,
               hgt: Math.max(hz, V.mountZ + tz),
               body: pr.bodyZ ? widthAt(pr.bodyZ, 1.0) : null,
               roof: pr.roofZ ? widthAt(pr.roofZ, 0.45) : null,
               clear: V.belly === undefined ? null : V.belly };
  });
  return out;
}, PROBE);

await context.close();
await browser.close();

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
