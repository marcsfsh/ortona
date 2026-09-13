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
 *   - a street is not endless and it is not a thread. Streets that run the length of the
 *     map without a junction have nothing to fight over, and a carriageway narrower than
 *     a vehicle is a wall with a line painted on it.
 *
 *   node tools/mapcheck.mjs            every rule
 *   node tools/mapcheck.mjs --v        list every conflict rather than the first few
 */

import { launch, openGame, parseArgs } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const VERBOSE = !!args.v;

const browser = await launch();
const { page, context } = await openGame(browser, 'laptop', { quiet: true });
const map = await page.evaluate(() => defaultMapData());
await context.close();
await browser.close();

const E = map.entities;
const of = t => E.filter(e => e.t === t);
const houses = of('house'), farms = of('farm'), craters = of('crater');
const trenches = of('trench'), wires = of('wire'), roads = of('road');
const trees = of('tree').concat(of('scrub'));
const blocks = houses.concat(farms);

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

const problems = [];
function bad(rule, msg) { problems.push({ rule, msg }); }

/* ---- 1. craters do not sit on trenches ---------------------------------- */
for (const c of craters)
  for (const tr of trenches)
    for (const [x1, y1, x2, y2] of segs(tr.pts))
      if (segDist(c.x, c.y, x1, y1, x2, y2) < c.r + 16) {
        bad('crater/trench', `crater (${c.x}, ${c.y}) r${c.r} overlaps a ${tr.side} trench leg near (${Math.round((x1 + x2) / 2)}, ${Math.round((y1 + y2) / 2)})`);
        break;
      }

/* ---- 2. wire is not laid through a crater or a trench ------------------- */
for (const w of wires) {
  for (const c of craters)
    if (segDist(c.x, c.y, w.x1, w.y1, w.x2, w.y2) < c.r + 12)
      bad('wire/crater', `wire (${w.x1},${w.y1})-(${w.x2},${w.y2}) runs through the crater at (${c.x}, ${c.y}) r${c.r}`);
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
  for (const c of craters) if (segDist(c.x, c.y, bx.x0, bx.y0, bx.x1, bx.y0) < c.r || inBox(bx, c.x, c.y) ||
      Math.abs(c.x - b.x) < b.w / 2 + c.r * .7 && Math.abs(c.y - b.y) < b.h / 2 + c.r * .7)
    bad('house/crater', `crater (${c.x}, ${c.y}) r${c.r} undercuts the building at (${b.x}, ${b.y}) ${b.w}x${b.h}`);
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

/* ---- 5. streets ---------------------------------------------------------- */
for (const r of roads) {
  if (r.width < 24) bad('street/narrow', `a street of width ${r.width} at (${r.pts[0].x}, ${r.pts[0].y})`);
  let run = 0;
  for (const [x1, y1, x2, y2] of segs(r.pts)) run += Math.hypot(x2 - x1, y2 - y1);
  if (run > 1500) bad('street/long', `a street running ${Math.round(run)} units unbroken from (${r.pts[0].x}, ${r.pts[0].y}); break it with a junction`);
}

/* ---- report -------------------------------------------------------------- */
const byRule = {};
for (const p of problems) (byRule[p.rule] = byRule[p.rule] || []).push(p.msg);
console.log(`entities: ${E.length}  buildings: ${blocks.length}  craters: ${craters.length}  trenches: ${trenches.length}  wire: ${wires.length}  streets: ${roads.length}  trees: ${trees.length}`);
const rules = Object.keys(byRule);
if (!rules.length) { console.log('\nclean: nothing on the map stands in anything else'); process.exit(0); }
for (const r of rules) {
  const list = byRule[r];
  console.log(`\n${r}  (${list.length})`);
  for (const m of (VERBOSE ? list : list.slice(0, 8))) console.log('  ' + m);
  if (!VERBOSE && list.length > 8) console.log(`  ... and ${list.length - 8} more (--v for all)`);
}
console.log(`\n${problems.length} problem(s)`);
process.exit(1);
