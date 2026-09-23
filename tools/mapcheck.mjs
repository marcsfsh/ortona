/* The map, mechanically.
 *
 * A hand-placed map is a few hundred coordinates and the eye will not hold them. Craters
 * swallow trenches, wire runs through a bowl it should stop at, a house stands on an
 * olive tree, and two buildings leave a slot between them too narrow to walk down and
 * too wide to read as a party wall. None of that shows in a screenshot taken from the
 * angle you happened to choose, and all of it shows the moment a section has to walk
 * through it.
 *
 * So the rules are written down and checked. Each one is a thing that cannot be true of
 * real ground:
 *
 *   - a crater does not sit on a trench. Artillery that lands on a trench destroys it;
 *     a bowl overlapping a parapet is a drawing error, not a battlefield.
 *   - wire is laid on ground, not across a bowl or a trench line. A belt that runs
 *     through either is uncrossable in one place and absent in the next.
 *   - nothing is inside a building. Not a tree, not a trench, not wire, not a crater:
 *     a house standing on a shell hole is a house standing on air.
 *   - two buildings either share a wall or leave room to walk between them. A gap of
 *     twelve units is neither: it reads as an alley and cannot be entered.
 *   - a hedgerow does not run through a building or across a lane: it is a bank a hull
 *     cannot climb, and one laid over a lane shuts it with nothing on the map to say so.
 *   - a street is not endless and it is not a thread. Streets that run the length of the
 *     map without a junction have nothing to fight over, and a carriageway narrower than
 *     a vehicle is a wall with a line painted on it.
 *
 *   node tools/mapcheck.mjs            every rule, on every map the game ships
 *   node tools/mapcheck.mjs gothic     one of them, by the key the game knows it by
 *   node tools/mapcheck.mjs --v        list every conflict rather than the first few
 *
 * It checks every shipped map rather than only the first, because a rule nobody runs on
 * the second map is a rule the second map does not have.
 */

import { launch, openGame, parseArgs } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const VERBOSE = !!args.v;

/* The maps come off the game's own MAPS table rather than a list here. Written as a
 * ternary on 'gothic' the third map was silently checked as Ortona, and what that looks
 * like is a new map that came back clean on the first run. */
const WANT = args._ && args._.length ? args._ : null;

const browser = await launch();
const { page, context } = await openGame(browser, 'laptop', { quiet: true });
const maps = await page.evaluate((want) => {
  const keys = want && want.length ? want : Object.keys(MAPS);
  const bad = keys.filter(k => !MAPS[k]);
  if (bad.length) throw new Error('no such map: ' + bad.join(', ') + '; the game has ' + Object.keys(MAPS).join(', '));
  return keys.map(k => ({ key: k, name: k, data: MAPS[k].make() }));
}, WANT);
await context.close();
await browser.close();

/* distance from a point to a segment, which is most of the arithmetic here */
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function segs(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push([pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y]);
  return out;
}
/* the rectangle a building actually occupies, with the margin the walls stand in */
function box(b, pad) { return { x0: b.x - b.w / 2 - pad, x1: b.x + b.w / 2 + pad, y0: b.y - b.h / 2 - pad, y1: b.y + b.h / 2 + pad }; }
function inBox(bx, x, y) { return x > bx.x0 && x < bx.x1 && y > bx.y0 && y < bx.y1; }
function segHitsBox(bx, x1, y1, x2, y2) {
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 8));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (inBox(bx, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return true;
  }
  return false;
}

/* A bunker's footprint is derived in the game rather than stored on the entity, so it is
   derived here too. It is a building for every rule below: nothing stands inside one, no
   street runs through one, no trench crosses one. */
function bunkerBox(e) {
  const ax = Math.abs(Math.cos(e.a || 0)) > Math.abs(Math.sin(e.a || 0));
  return { t: 'bunker', x: e.x, y: e.y, w: ax ? 46 : 74, h: ax ? 74 : 46 };
}

/* A landing craft aground is a steel hull standing on the sand and the game marks it
   solid on its own bearing's bounding box, so that is the box it is checked as. One lying
   in the surf is not solid and is not checked. */
const CRAFT = { lcvp: [118, 36], lct: [330, 100] };
function craftBox(e, sea) {
  const d = CRAFT[e.kind || 'lcvp'] || CRAFT.lcvp, ca = Math.abs(Math.cos(e.a || 0)), sa = Math.abs(Math.sin(e.a || 0));
  return { t: 'craft', x: e.x, y: e.y, w: Math.round(d[0] * ca + d[1] * sa), h: Math.round(d[0] * sa + d[1] * ca) };
}

function checkMap(map) {
  const E = map.entities;
  const of = t => E.filter(e => e.t === t);
  /* a Norman house is a building for every rule a house is: it stands on ground nothing
     else is dug into, no street runs through it, and it leaves room to walk or shares a
     wall */
  const houses = of('house').concat(of('nhouse')), farms = of('farm'), craters = of('crater');
  /* A weapon pit is an EARTHWORK the day it starts going through `carve`, so it is
     checked as one. Measured on the Gothic Line before this rule existed, one pit's
     spoil stood 4.32 units up in the floor of a trench 32 units away and another's
     BOWL reached 4.4 units into one -- which is exactly what `crater/trench` exists to
     forbid, and nothing said so, because a pit was not an earthwork when that rule was
     written.
       The radius is the BOWL, `r + 8`, and not the outer edge of the spoil. The spoil
     falls off as the square of the distance across its band, so the outer half of it
     is under a unit high: taken at its geometric edge the rule flagged five placements
     on the two maps whose real effect on a trench was 0.11 of a unit or nothing at all,
     which is a rule nobody can act on. Calibrated against what each pit actually puts
     on a trench, the bowl is the radius that separates the two that matter from the
     ones that do not. Its margin is the trench's own half-width rather than the
     crater's 16, because that is the thing being undercut. */
  const digs = craters.map(c => ({ x: c.x, y: c.y, r: c.r, m: 16, what: `crater (${c.x}, ${c.y}) r${c.r}` }))
    .concat(of('emplace').map(e => ({ x: e.x, y: e.y, r: (e.r || 22) + 8, m: 14,
                                      what: `the weapon pit at (${e.x}, ${e.y}) r${e.r || 22}` })))
    /* a Tobruk is sunk in a bowl nine units across the carve and sixteen to its collar */
    .concat(of('tobruk').map(e => ({ x: e.x, y: e.y, r: 16, m: 14, what: `the Tobruk at (${e.x}, ${e.y})` })));
  /* an anti-tank ditch is an earthwork dug the way a trench is, so it is one here */
  const trenches = of('trench').concat(of('ditch').map(d => ({ side: 'anti-tank', pts: d.pts })));
  const wires = of('wire'), roads = of('road');
  const trees = of('tree').concat(of('scrub'));
  const blocks = houses.concat(farms).concat(of('bunker').map(bunkerBox))
    .concat(of('craft').filter(e => !e.wreck || e.wreck === 1).map(e => craftBox(e)));
  const hedges = [];
  for (const h of of('hedge')) for (const sg of segs(h.pts)) hedges.push(sg);

  const problems = [];
  function bad(rule, msg) { problems.push({ rule, msg }); }

  /* ---- 1. craters do not sit on trenches ---------------------------------- */
  for (const c of digs)
    for (const tr of trenches)
      for (const [x1, y1, x2, y2] of segs(tr.pts))
        if (segDist(c.x, c.y, x1, y1, x2, y2) < c.r + (c.m === undefined ? 16 : c.m)) {
          bad('crater/trench', `${c.what} overlaps a ${tr.side} trench leg near (${Math.round((x1 + x2) / 2)}, ${Math.round((y1 + y2) / 2)})`);
          break;
        }

  /* ---- 2. wire is not laid through a crater or a trench ------------------- */
  for (const w of wires) {
    for (const c of digs)
      if (segDist(c.x, c.y, w.x1, w.y1, w.x2, w.y2) < c.r + 12)
        bad('wire/crater', `wire (${w.x1},${w.y1})-(${w.x2},${w.y2}) runs through ${c.what}`);
    for (const tr of trenches)
      for (const [x1, y1, x2, y2] of segs(tr.pts)) {
        const n = 24;
        let hit = false;
        for (let i = 0; i <= n && !hit; i++) {
          const t = i / n;
          if (segDist(w.x1 + (w.x2 - w.x1) * t, w.y1 + (w.y2 - w.y1) * t, x1, y1, x2, y2) < 22) hit = true;
        }
        if (hit) { bad('wire/trench', `wire (${w.x1},${w.y1})-(${w.x2},${w.y2}) crosses a ${tr.side} trench leg near (${Math.round((x1 + x2) / 2)}, ${Math.round((y1 + y2) / 2)})`); break; }
      }
  }

  /* ---- 3. nothing stands inside a building -------------------------------- */
  for (const b of blocks) {
    const bx = box(b, 10);
    for (const t of trees) if (inBox(bx, t.x, t.y)) bad('house/tree', `a tree at (${t.x}, ${t.y}) is inside the building at (${b.x}, ${b.y}) ${b.w}x${b.h}`);
    for (const c of digs) if (segDist(c.x, c.y, bx.x0, bx.y0, bx.x1, bx.y0) < c.r || inBox(bx, c.x, c.y) ||
        Math.abs(c.x - b.x) < b.w / 2 + c.r * .7 && Math.abs(c.y - b.y) < b.h / 2 + c.r * .7)
      bad('house/crater', `${c.what} undercuts the building at (${b.x}, ${b.y}) ${b.w}x${b.h}`);
    for (const tr of trenches)
      for (const [x1, y1, x2, y2] of segs(tr.pts))
        if (segHitsBox(bx, x1, y1, x2, y2)) { bad('house/trench', `a ${tr.side} trench runs through the building at (${b.x}, ${b.y}) ${b.w}x${b.h}`); break; }
    for (const w of wires)
      if (segHitsBox(bx, w.x1, w.y1, w.x2, w.y2)) bad('house/wire', `wire (${w.x1},${w.y1})-(${w.x2},${w.y2}) runs through the building at (${b.x}, ${b.y}) ${b.w}x${b.h}`);
  }

  /* ---- 4. buildings share a wall or leave room to walk between ------------ */
  const JOIN = 7, WALK = 34;
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      const gx = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
      const gy = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
      if (gx < -4 && gy < -4) { bad('house/house', `the buildings at (${a.x}, ${a.y}) and (${b.x}, ${b.y}) overlap`); continue; }
      /* only the gap on the axis they actually face each other across counts */
      const gap = gx >= -4 && gy < 0 ? gx : gy >= -4 && gx < 0 ? gy : null;
      if (gap === null) continue;
      if (gap > JOIN && gap < WALK)
        bad('house/gap', `${gap.toFixed(0)} units between (${a.x}, ${a.y}) and (${b.x}, ${b.y}): too wide for a party wall, too narrow to walk`);
    }
  }

  /* ---- 4b. a street does not run through a building ----------------------- */
  for (const r of roads) {
    const half = (r.width || 48) / 2;
    for (const b of blocks) {
      const bx = box(b, -Math.min(10, half * .4));     /* the kerb may touch the wall; the carriageway may not */
      let hit = false;
      for (const [x1, y1, x2, y2] of segs(r.pts)) if (segHitsBox(bx, x1, y1, x2, y2)) { hit = true; break; }
      if (hit) bad('street/house', `the street from (${r.pts[0].x}, ${r.pts[0].y}) runs through the building at (${b.x}, ${b.y}) ${b.w}x${b.h}`);
    }
  }

  /* ---- 4c. a hedgerow does not run through a building or across a lane --------
     A hedgerow is a bank a hull cannot get over, so one laid across a lane shuts the lane
     to everything on tracks and nothing on the map says so; and one through a house is a
     bank standing in somebody's kitchen. A lane runs between two hedgerows, so the test
     is the carriageway and not the verge. */
  for (const [x1, y1, x2, y2] of hedges) {
    for (const b of blocks)
      if (segHitsBox(box(b, -3), x1, y1, x2, y2))
        bad('house/hedge', `a hedgerow (${Math.round(x1)},${Math.round(y1)})-(${Math.round(x2)},${Math.round(y2)}) runs through the building at (${b.x}, ${b.y}) ${b.w}x${b.h}`);
    for (const r of roads) {
      const half = (r.width || 48) / 2 - 6;
      let hit = false;
      for (const [rx1, ry1, rx2, ry2] of segs(r.pts)) {
        const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 6));
        for (let i = 0; i <= n && !hit; i++) {
          const t = i / n;
          if (segDist(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, rx1, ry1, rx2, ry2) < half) hit = true;
        }
        if (hit) break;
      }
      if (hit) bad('hedge/street', `a hedgerow (${Math.round(x1)},${Math.round(y1)})-(${Math.round(x2)},${Math.round(y2)}) crosses the lane from (${r.pts[0].x}, ${r.pts[0].y})`);
    }
  }

  /* ---- 5. streets ---------------------------------------------------------- */
  for (const r of roads) {
    if (r.width < 24) bad('street/narrow', `a street of width ${r.width} at (${r.pts[0].x}, ${r.pts[0].y})`);
    let run = 0;
    for (const [x1, y1, x2, y2] of segs(r.pts)) run += Math.hypot(x2 - x1, y2 - y1);
    if (run > 1500) bad('street/long', `a street running ${Math.round(run)} units unbroken from (${r.pts[0].x}, ${r.pts[0].y}); break it with a junction`);
  }

  return { problems, counts: `entities: ${E.length}  buildings: ${blocks.length}  craters: ${craters.length}  ` +
    `trenches: ${trenches.length}  wire: ${wires.length}  streets: ${roads.length}  trees: ${trees.length}` +
    (hedges.length ? `  hedgerow legs: ${hedges.length}` : '') };
}

/* ---- report -------------------------------------------------------------- */
let total = 0;
for (const m of maps) {
  const { problems, counts } = checkMap(m.data);
  console.log(`\n${(m.data.name || m.name).toUpperCase()}`);
  console.log(counts);
  const byRule = {};
  for (const p of problems) (byRule[p.rule] = byRule[p.rule] || []).push(p.msg);
  const rules = Object.keys(byRule);
  if (!rules.length) { console.log('clean: nothing on the map stands in anything else'); continue; }
  for (const r of rules) {
    const list = byRule[r];
    console.log(`\n${r}  (${list.length})`);
    for (const msg of (VERBOSE ? list : list.slice(0, 8))) console.log('  ' + msg);
    if (!VERBOSE && list.length > 8) console.log(`  ... and ${list.length - 8} more (--v for all)`);
  }
  console.log(`\n${problems.length} problem(s)`);
  total += problems.length;
}
process.exit(total ? 1 : 0);
