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
  ger_kt:    { name: 'Tiger II (Henschel)', len: 7.38,  gun: 10.286, wid: 3.755, hgt: 3.27,
               body: 3.66, bodyZ: 1.15, roof: 2.87, clear: 0.495 },
  ger_p4:    { name: 'Panzer IV Ausf. H',   len: 5.92,  gun: 7.02,   wid: 2.88,  hgt: 2.68,
               body: 2.36, bodyZ: 1.10, roof: 2.36, clear: 0.40 },   /* body: the superstructure sits
               well inboard of the 2.88 m over the guards, which is what leaves the walkable shelf */
  us_m8:     { name: 'Universal Carrier',   len: 3.65,  gun: 3.65,   wid: 2.06,  hgt: 1.57 },
  ger_puma:  { name: 'Sd.Kfz. 222',         len: 4.80,  gun: 4.80,   wid: 1.95,  hgt: 2.00,
               body: 1.01, roof: 1.05 }   /* the two ends of the diamond section: the floor
               plate and the roof deck. On this one the knuckle and the mudguard line are the
               same measurement as the width over all, so the section is checked at its ends */
};

/* Where to slice each hull, in model units: the sponson lip and the roof plate.
   xLo/xHi narrow the slice to a station along the hull where nothing is strapped to
   the side. Without it a Panzer IV measures 2.88 m across the body, because the
   slice runs through the spare road wheels racked on its guard. `straddle` lets a
   face that crosses the slice plane contribute its widest point, which is what a
   plain box side needs: its only vertices are at the top and bottom of the plate. */
const PROBE = {
  us_stuart: { bodyZ: 13.5, roofZ: 19.6 },
  us_sher:   { bodyZ: 14.5, roofZ: 21.6 },
  ger_kt:    { bodyZ: 13.5, roofZ: 21.8 },
  ger_p4:    { bodyZ: 16.0, roofZ: 18.4, xLo: -8.0, xHi: -2.0, straddle: true },
  ger_puma:  { bodyZ: 3.4, roofZ: 14.7, xLo: -6.0, xHi: 6.0 }   /* lofted: real vertices sit at each ring */
};
const SCALE = 11.7;   /* units per metre: 8.5 cm to the unit, the scale the fleet is built at */

const browser = await launch();
const { page, context } = await openGame(browser, 'laptop', { quiet: true });
await deploy(page, { side: 'us' });

const measured = await page.evaluate(probe => {
  const out = {};
  Object.keys(window.VMODEL).forEach(function (k) {
    const V = window.VMODEL[k], tx = V.turX || 0;
    let hx0 = 1e9, hx1 = -1e9, hy = 0;
    V.hull.forEach(f => f.v.forEach(p => {
      hx0 = Math.min(hx0, p[0]); hx1 = Math.max(hx1, p[0]); hy = Math.max(hy, Math.abs(p[1]));
    }));

    /* Slice the hull at a height and take the widest armour there. Faces are skipped
       when they sit outside the track line, which is where the stowage and the track
       itself live, so the number is the body rather than what is strapped to it. */
    const pr = probe[k] || {};
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
    V.tur.forEach(function (f) {
      const tall = f.v.some(p => p[2] > 20);
      f.v.forEach(function (p) {
        if (!tall) tz = Math.max(tz, p[2]);
        tx1 = Math.max(tx1, p[0]);
      });
    });
    /* Ground clearance comes from the model's own declared belly height. No geometric
       filter reliably separates the hull floor from the track running under it: on
       every one of these the track's inboard edge lies inside the hull's own width. */
    out[k] = { len: hx1 - hx0, gun: Math.max(hx1, tx + tx1) - hx0, wid: hy * 2, hgt: V.mountZ + tz,
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
  if (r.body) internals.push(inner);
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
