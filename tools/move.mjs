/* Movement, pathing and cover, mechanically.
 *
 * None of this can be read off a diff and none of it shows in a screenshot taken from
 * the angle you happened to choose. A path is a few hundred cells of arithmetic and the
 * eye will not hold them; a section stuck against a wall looks exactly like a section
 * holding a wall; a tank that took the gardens instead of the Corso arrives late and
 * nothing on screen says why. So it gets counted.
 *
 *   node tools/move.mjs                 the whole card
 *   node tools/move.mjs routes          one section of it
 *   node tools/move.mjs --base=HEAD     the same card on an older file, side by side
 *   node tools/move.mjs --t=360         a longer battle probe
 *   node tools/move.mjs --v             every route and every drill, not the summary
 *
 * Three sections, because there are three questions.
 *
 * ROUTES asks whether a path is any good. Each journey across the shipped map is priced
 * three ways: its length against the crow, its cost against a plain Dijkstra over the
 * game's own grid and the game's own cellCost (which is the thing findPath approximates,
 * so the ratio is how much the heuristic and the smoother cost you), and the narrowest
 * place along it against the beam of the thing that has to fit through. Then the unit is
 * actually driven down it with the real updateUnit, because a path that prices well and
 * cannot be walked is worth nothing. FIT is the money column, and it is measured against
 * the BEAM and not `unitRadius`: that is half a vehicle's length, so read straight it
 * reports the main street of Ortona as too narrow for the Sherman driving down it.
 *
 * TRAFFIC is the whole battle, both brains, counted every frame. What it is looking for
 * is the states a unit should never be in: with a path and four seconds of no progress,
 * with its centre off the walkable grid, with its men standing inside a house, wedged
 * inside another unit, in a gap narrower than its own beam. Plus the rates that say how
 * hard the pathfinder is being worked. The rates are unit-frames and the denominators
 * are printed, because the first version counted four-second windows, a whole battle
 * produced about fifty of them, and four coincidences read as a nine per cent
 * regression.
 *
 * COVER asks whether a section that halts in the open takes the cover that is there. A
 * section is put down at a spread of points in the town with an enemy on a known
 * bearing, left to settle, and then asked what tier its men are actually getting against
 * that bearing -- against the best tier available within a short walk. Taken over
 * available is the number: cover that is never taken is scenery.
 *
 * Nothing here reimplements the game. The routes are driven by the game's own updateUnit
 * on the game's own map, the cover drill reads the game's own coverAt, and the traffic
 * probe wraps frame() rather than stepping anything itself. The one piece of arithmetic
 * that is not the game's is the Dijkstra reference, and it is deliberately not the
 * game's: an optimum computed by the code under test is not an optimum.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openGame, deploy, fastForward, parseArgs, GAME } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const MAP = args.map || null;      /* which shipped map to fight on */
const SECS = args.t === undefined ? 240 : Number(args.t);
const DIFF = args.diff === undefined ? 1 : Number(args.diff);
const BASE = args.base === undefined ? null : String(args.base);
const VERB = !!args.v;
const WANT = args._.length ? args._ : ['routes', 'traffic', 'cover'];

/* ------------------------------------------------------------------ the page side */

/* Installed once per page. Everything below runs inside the game with the game's own
   functions in scope; nothing is injected into ortona.html on disk. */
async function install(page) {
  await page.evaluate(() => {
    const M = window.__mv = {};
    const rnow = performance.now.bind(performance);   /* fastForward stubs the other one */

    /* ---- how wide the gap really is -------------------------------------------- */
    /* Measured against the masonry rather than against the movement grid. The grid pads
       a building by six units and then rounds it up to a forty-unit cell, so read off
       the grid every street in the town comes back too narrow for a man. What a hull has
       to fit through is the distance to the nearest wall, so that is what this is: the
       solid footprints rasterised at ten units and chamfered in two passes. */
    const CQ = 10;
    M.clearance = function () {
      const W = Math.ceil(WORLD.w / CQ), H = Math.ceil(WORLD.h / CQ), n = W * H;
      const d = new Float32Array(n), BIG = 1e9;
      let x, y, i, v;
      d.fill(BIG);
      function solid(px, py, pw, ph) {
        const i0 = Math.max(0, ((px - pw / 2) / CQ) | 0), i1 = Math.min(W - 1, ((px + pw / 2) / CQ) | 0);
        const j0 = Math.max(0, ((py - ph / 2) / CQ) | 0), j1 = Math.min(H - 1, ((py + ph / 2) / CQ) | 0);
        for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) d[j * W + k] = 0;
      }
      G.props.forEach(p => { if (p.solid) solid(p.x, p.y, p.w, p.h); });
      G.blds.forEach(b => solid(b.x, b.y, b.def.w, b.def.h));
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        i = y * W + x; v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) v = Math.min(v, d[i - W] + 1);
        if (x > 0 && y > 0) v = Math.min(v, d[i - W - 1] + 1.4142);
        if (x < W - 1 && y > 0) v = Math.min(v, d[i - W + 1] + 1.4142);
        d[i] = v;
      }
      for (y = H - 1; y >= 0; y--) for (x = W - 1; x >= 0; x--) {
        i = y * W + x; v = d[i];
        if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < H - 1) v = Math.min(v, d[i + W] + 1);
        if (x < W - 1 && y < H - 1) v = Math.min(v, d[i + W + 1] + 1.4142);
        if (x > 0 && y < H - 1) v = Math.min(v, d[i + W - 1] + 1.4142);
        d[i] = v;
      }
      M.cl = d; M.clW = W; M.clH = H; M.clStamp = gridStamp;
      return d;
    };
    /* What has to fit through a gap is the beam, and unitRadius is half the LENGTH: it
       is the separation radius, so a Sherman reads 41 when it is 2.6 m across the tracks,
       which is 15. These hulls run a little over twice as long as they are wide, so half
       the beam is a shade under half of it. A section's frontage is its own. */
    M.beam = function (u) {
      return u.cat === 'veh' ? unitRadius(u) * 0.45 : 26;
    };
    M.clearAt = function (x, y) {
      if (M.clStamp !== gridStamp) M.clearance();
      const cx = (x / CQ) | 0, cy = (y / CQ) | 0;
      if (cx < 0 || cy < 0 || cx >= M.clW || cy >= M.clH) return 0;
      return (M.cl[cy * M.clW + cx] - 0.5) * CQ;
    };

    /* ---- what a man is standing in --------------------------------------------- */
    /* The walkable grid pads a building by six units and rounds it up to a cell, so a man
       correctly tucked against a wall reads as inside it. The honest question is
       geometric, so the solid shapes are bucketed once and asked directly.
         Field walls count. They are eleven units of dry stone drawn as a run of boxes and
       they are not on the movement grid at all, so a man standing in one is invisible to
       every other test there is -- which is how the cover slots came to stand every man
       at every garden wall on the map a unit inside the masonry, with this probe
       reporting no men in walls at all. A thin thing is still a thing. */
    M.solids = function () {
      const B = 120, W = Math.ceil(WORLD.w / B), H = Math.ceil(WORLD.h / B), idx = [];
      function put(x, y, w, h, a) {
        const rr = Math.max(w, h) / 2;
        const i0 = Math.max(0, ((x - rr) / B) | 0), i1 = Math.min(W - 1, ((x + rr) / B) | 0);
        const j0 = Math.max(0, ((y - rr) / B) | 0), j1 = Math.min(H - 1, ((y + rr) / B) | 0);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const n = j * W + i;
          (idx[n] || (idx[n] = [])).push([x, y, w, h, a || 0]);
        }
      }
      G.props.forEach(p => { if (p.solid && p.kind !== 'sea') put(p.x, p.y, p.w, p.h); });
      G.blds.forEach(b => put(b.x, b.y, b.def.w, b.def.h));
      /* each wall run chopped into boxes on its own bearing, the way it is drawn */
      G.walls.forEach(w => {
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
        const a = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
        const n = Math.max(2, Math.round(len / 34));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          put(w.x1 + (w.x2 - w.x1) * t, w.y1 + (w.y2 - w.y1) * t, len / n + 1, 11, a);
        }
      });
      M.sol = { B, W, H, idx };
      return M.sol;
    };
    M.inSolid = function (x, y) {
      const s = M.sol || M.solids();
      const i = (x / s.B) | 0, j = (y / s.B) | 0;
      if (i < 0 || j < 0 || i >= s.W || j >= s.H) return false;
      const list = s.idx[j * s.W + i];
      if (!list) return false;
      for (let k = 0; k < list.length; k++) {
        const r = list[k];
        let dx = x - r[0], dy = y - r[1];
        if (r[4]) {
          const c = Math.cos(-r[4]), sn = Math.sin(-r[4]);
          const rx = dx * c - dy * sn, ry = dx * sn + dy * c;
          dx = rx; dy = ry;
        }
        if (Math.abs(dx) < r[2] / 2 && Math.abs(dy) < r[3] / 2) return true;
      }
      return false;
    };

    /* ---- the reference optimum -------------------------------------------------- */
    /* A plain Dijkstra over the game's grid and the game's cellCost, with the game's own
       corner rule. No heuristic and no smoothing, so it is the cheapest route that
       exists under the cost model findPath is trying to minimise. Deliberately not
       findPath: an optimum computed by the code under test is not an optimum. */
    M.opt = function (sx, sy, tx, ty, kind) {
      const n = GW * GH, g = new Float32Array(n).fill(Infinity), done = new Uint8Array(n);
      const s0 = nearestFree(sx, sy), t0 = nearestFree(tx, ty);
      const start = cidx((s0.x / CELL) | 0, (s0.y / CELL) | 0);
      const end = cidx((t0.x / CELL) | 0, (t0.y / CELL) | 0);
      if (grid[start] || grid[end]) return null;
      const heap = [start]; let hn = 1;
      g[start] = 0;
      function push(v) {
        heap[hn++] = v; let i = hn - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (g[heap[p]] <= g[heap[i]]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; }
      }
      function pop() {
        const top = heap[0]; heap[0] = heap[--hn]; heap.length = hn; let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < hn && g[heap[l]] < g[heap[m]]) m = l;
          if (r < hn && g[heap[r]] < g[heap[m]]) m = r;
          if (m === i) break;
          const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
        return top;
      }
      while (hn > 0) {
        const cur = pop();
        if (done[cur]) continue;
        done[cur] = 1;
        if (cur === end) break;
        const cx = cur % GW, cy = (cur / GW) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const ni = cidx(nx, ny);
          if (grid[ni] || done[ni]) continue;
          if (dx && dy && (grid[cidx(cx + dx, cy)] || grid[cidx(cx, cy + dy)])) continue;
          const ng = g[cur] + (dx && dy ? 1.4142 : 1) * cellCost(ni, kind);
          if (ng < g[ni]) { g[ni] = ng; push(ni); }
        }
      }
      return isFinite(g[end]) ? g[end] * CELL : null;
    };

    /* ---- routes ----------------------------------------------------------------- */
    /* One unit alone on the shipped map, no brain and no opposition, asked to cross it.
       The drive is the game's own updateUnit on the game's own clock. */
    M.route = function (spec) {
      G.units.length = 0; G.shots.length = 0; G.fx.length = 0; G.corpses.length = 0;
      AI.t = 1e9;
      const s = nearestFree(spec.fx, spec.fy);
      const u = spawnUnit(spec.side, spec.key, s.x, s.y, 0);
      u.hp = u.maxhp = 9e5;
      let paths = 0;
      const realFind = window.findPath;
      window.findPath = function (a, b, c, d, v) { paths++; return realFind(a, b, c, d, v); };
      const t0 = rnow();
      orderMove(u, spec.tx, spec.ty, false);
      const findMs = rnow() - t0;

      /* the path as handed over, before a wheel has turned */
      const pts = [{ x: u.x, y: u.y }].concat((u.path || []).map(p => ({ x: p.x, y: p.y })));
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      /* The narrowest place on the route, measured over the route and not over the
         doorstep: both ends of most of these are a headquarters or a flag with a
         building on it, so a unit that starts correctly beside its own wall would
         otherwise report every journey as impassable. */
      let fit = 1e9, run = 0;
      const skip = 90;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(d / 12));
        for (let k = 0; k <= steps; k++) {
          const at = run + d * k / steps;
          if (at < skip || at > len - skip) continue;
          const c = M.clearAt(a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps);
          if (c < fit) fit = c;
        }
        run += d;
      }
      if (fit === 1e9) fit = M.clearAt(pts[pts.length - 1].x, pts[pts.length - 1].y);
      let cost = 0;
      const kind = pathKind(u);
      for (let i = 1; i < pts.length; i++) cost += lineCost(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, kind);
      const opt = M.opt(s.x, s.y, spec.tx, spec.ty, kind);
      const crow = Math.hypot(spec.tx - s.x, spec.ty - s.y);

      /* and then it is driven, which is the only test that counts. Arrival is judged
         against the end of the path rather than against the order: a destination inside
         a building is moved to the nearest free ground before the search starts, and a
         unit that stops correctly eighty units short of the enemy headquarters has
         arrived, whatever the click said. */
      const goal = pts.length > 1 ? pts[pts.length - 1] : { x: spec.tx, y: spec.ty };
      const dt = 1 / 30;
      let t = 0, stuck = 0, last = { x: u.x, y: u.y }, lastT = 0, road = 0, frames = 0;
      const limit = spec.limit || 240;
      while (t < limit) {
        G.t += dt; t += dt; frames++;
        updateUnit(u, dt);
        if (u.cat === 'veh' && u.moving && onRoad(u.x, u.y)) road++;
        if (t - lastT >= 4) {
          if (Math.hypot(u.x - last.x, u.y - last.y) < 30) stuck += 4;
          last = { x: u.x, y: u.y }; lastT = t;
        }
        if (Math.hypot(u.x - goal.x, u.y - goal.y) < 45) break;
        if (!u.path && t > 1) break;                  /* it stopped, wherever that is */
      }
      window.findPath = realFind;
      const gone = Math.hypot(u.x - goal.x, u.y - goal.y);
      return {
        legs: pts.length - 1, len: Math.round(len), crow: Math.round(crow),
        cost: Math.round(cost), opt: opt === null ? null : Math.round(opt),
        fit: Math.round(fit - M.beam(u)), r: Math.round(M.beam(u)),
        findMs: +findMs.toFixed(1), paths,
        secs: +t.toFixed(1), arrived: gone < 45, short: Math.round(gone),
        stuck: +stuck.toFixed(0), road: frames ? +(road / frames).toFixed(2) : 0
      };
    };

    /* ---- the cover drill --------------------------------------------------------- */
    /* A section put down on a spread of ground with an enemy on a known bearing, left
       alone long enough to make up its mind, then asked what its men are getting. */
    M.coverDrill = function (spots, secs) {
      const out = [];
      for (let i = 0; i < spots.length; i++) {
        G.units.length = 0; G.shots.length = 0; G.fx.length = 0;
        AI.t = 1e9;
        const s = nearestFree(spots[i].x, spots[i].y);
        const ang = spots[i].a;
        const u = spawnUnit('us', 'us_rifle', s.x, s.y, ang + Math.PI);
        /* something to take cover from, close enough to be seen and far enough to be a
           bearing rather than a brawl */
        const e = spawnUnit('ger', 'ger_gren', s.x + Math.cos(ang) * 420, s.y + Math.sin(ang) * 420, ang + Math.PI);
        e.hp = e.maxhp = 9e5;
        const dt = 1 / 30;
        for (let t = 0; t < secs; t += dt) {
          G.t += dt;
          computeVisibility(dt);
          updateUnit(u, dt); updateUnit(e, dt);
          updateModels(u, dt);
        }
        /* what the men got, against the bearing the fire is actually arriving on */
        const from = Math.atan2(s.y - e.y, s.x - e.x);
        let sum = 0, n = 0;
        u.models.forEach(m => { if (m.alive) { sum += coverAt(m.x, m.y, from); n++; } });
        /* and the best that was there for the taking within a short walk */
        let avail = 0;
        const near = coversNear(s.x, s.y, 130);
        for (let k = 0; k < near.length; k++) {
          const c = near[k];
          if (c.hp <= 0) continue;
          const d = c.axis === null ? Math.hypot(c.x - s.x, c.y - s.y) - c.r
                                    : distToSeg(s.x, s.y, c.x - Math.cos(c.axis) * c.r, c.y - Math.sin(c.axis) * c.r,
                                                c.x + Math.cos(c.axis) * c.r, c.y + Math.sin(c.axis) * c.r);
          if (d > 130) continue;
          const v = coverValue(c, from);
          if (v > avail) avail = v;
        }
        out.push({ x: Math.round(s.x), y: Math.round(s.y), took: n ? +(sum / n).toFixed(2) : 0,
                   avail, piece: u.coverPiece ? u.coverPiece.kind : '-',
                   moved: Math.round(Math.hypot(u.x - s.x, u.y - s.y)) });
      }
      return out;
    };

    /* ---- the traffic probe -------------------------------------------------------- */
    /* Wrapped round frame() rather than stepping anything, so what it counts is what the
       game did. Counted every frame: a unit is either in one of these states or it is
       not, and the states below are ones nothing should ever be in. */
    M.watch = function () {
      if (M.on) return;
      M.on = 1;
      const realFrame = window.frame, realFind = window.findPath;
      window.findPath = function (a, b, c, d, v) {
        const t0 = rnow();
        const r = realFind(a, b, c, d, v);
        M.c.paths++; M.c.pathMs += rnow() - t0;
        /* A single waypoint is the usual answer -- a straight line that is clear needs
           no search -- so the failure to count is the one where the line is NOT clear
           and the destination came back anyway, which is the search giving up. */
        if (r.length === 1 && !clearLine(a, b, r[0].x, r[0].y)) M.c.one++;
        return r;
      };
      window.frame = function (now) { realFrame(now); M.sample(); };
    };
    M.reset = function () {
      M.c = { frames: 0, t0: G.t, unitF: 0, vehF: 0, manF: 0,
              offGrid: 0, inSolid: 0, tight: 0, overlap: 0, pathF: 0,
              win: 0, stuck: 0, paths: 0, pathMs: 0, one: 0,
              haltSec: 0, haltKnown: 0, faced: 0, haltMen: 0, coveredMen: 0,
              vehMove: 0, vehRoad: 0, stray: 0, spread: 0 };
      M.solids();
      M.clearance();
    };
    M.sample = function () {
      const c = M.c;
      c.frames++;
      const un = G.units;
      for (let i = 0; i < un.length; i++) {
        const u = un[i];
        if (u.dead || u.inside) continue;
        c.unitF++;
        /* a garrison stands on its building's own footprint on purpose */
        if (!u.gar && !walkable(u.x, u.y)) c.offGrid++;
        if (u.cat === 'veh') {
          c.vehF++;
          if (M.clearAt(u.x, u.y) < M.beam(u)) c.tight++;
          if (u.moving) { c.vehMove++; if (onRoad(u.x, u.y)) c.vehRoad++; }
        }
        /* four-second windows in which a unit with somewhere to be went nowhere */
        if (u.path && u.pi < u.path.length) {
          c.pathF++;
          /* how long since it last got anywhere. Counted as unit-frames rather than as
             four-second windows: a path is usually spent in well under four seconds, so
             windows came to about fifty in a whole battle and four coincidences read as
             nine per cent. */
          if (u._mx === undefined || Math.hypot(u.x - u._mx, u.y - u._my) > 25) {
            u._mt = G.t; u._mx = u.x; u._my = u.y;
          }
          c.win++;
          if (G.t - u._mt > 4) c.stuck++;
        } else { u._mx = undefined; u._mt = undefined; }
        for (let j = i + 1; j < un.length; j++) {
          const o = un[j];
          if (o.dead || o.inside || o.gar) continue;
          const rr = (unitRadius(u) + unitRadius(o)) * 0.72;
          if (dsq(u.x, u.y, o.x, o.y) < rr * rr) c.overlap++;
        }
        if (u.cat === 'veh' || u.gar) continue;
        const halted = !u.moving && !u.retreat;
        if (halted) {
          c.haltSec++;
          /* threatAng is the bearing from the threat to the unit, so a section facing
             what it knows about is facing the reciprocal of it */
          if (u.threatAng !== undefined && u.threatAng !== null &&
              Math.abs(angDiff(u.facing, u.threatAng + Math.PI)) < 0.7) c.faced++;
          if (u.threatAng !== undefined && u.threatAng !== null) c.haltKnown++;
        }
        for (let k = 0; k < u.models.length; k++) {
          const m = u.models[k];
          if (!m.alive) continue;
          c.manF++;
          if (M.inSolid(m.x, m.y)) c.inSolid++;
          /* A straggler is a man who is not where his section put him. One standing at a
             cover slot a hundred units off IS where it put him -- it chose that wall for
             him -- so counting him as lost measures the cover reach rather than the
             formation. The spread underneath says how far a section is strung out, which
             is the thing the threshold was reaching for. */
          var away = Math.hypot(m.x - u.x, m.y - u.y);
          c.spread += away;
          if (away > 150 && !(u.coverSlots && u.coverSlots[k])) c.stray++;
          if (halted) {
            c.haltMen++;
            if (coverAt(m.x, m.y, u.threatAng === null ? undefined : u.threatAng) > 0) c.coveredMen++;
          }
        }
      }
    };
    M.read = function () {
      const c = M.c, r = {};
      for (const k in c) r[k] = c[k];
      r.secs = +(G.t - c.t0).toFixed(0);
      return r;
    };
  });
}

/* ------------------------------------------------------------------ the card */

/* Five journeys across the shipped map, named for what they are. The first is the whole
   width of it; the rest are the ones a battle actually asks for. */
const ROUTES = [
  ['crossing', 'hq:us', 'hq:ger'],
  ['into town', 'hq:us', 'sec:E'],
  ['the Corso', 'sec:C', 'sec:G'],
  ['across the grain', 'sec:D', 'sec:F'],
  ['the long diagonal', 'sec:A', 'sec:I']
];
/* foot, tracks, wheels, and the heaviest thing on the roster, which is the one that
   finds out how wide a street is */
const MOVERS = [
  ['foot', 'us', 'us_rifle'],
  ['tracks', 'us', 'us_sher'],
  ['wheels', 'us', 'us_m3'],
  ['heavy', 'ger', 'ger_tig']
];

async function card(file, label) {
  const browser = await launch();
  const { page } = await openGame(browser, 'desktop', { file, quiet: true });
  await deploy(page, { side: 'us', diff: DIFF, map: MAP });
  await install(page);
  const out = { label };

  if (WANT.includes('routes')) {
    out.routes = await page.evaluate(({ ROUTES, MOVERS }) => {
      function place(tag) {
        if (tag.startsWith('hq:')) { const b = hqOf(tag.slice(3)); return { x: b.x, y: b.y }; }
        const s = G.secById[tag.slice(4)];
        return { x: s.x, y: s.y };
      }
      const rows = [];
      for (const [name, a, b] of ROUTES) {
        const from = place(a), to = place(b);
        for (const [kindName, side, key] of MOVERS) {
          const r = window.__mv.route({ side, key, fx: from.x, fy: from.y, tx: to.x, ty: to.y, limit: 300 });
          rows.push(Object.assign({ route: name, mover: kindName, key }, r));
        }
      }
      return rows;
    }, { ROUTES, MOVERS });
  }

  if (WANT.includes('cover')) {
    out.cover = await page.evaluate(() => {
      /* a spread of ground through the town and the fields either side of it, each with
         the fire coming from a different quarter */
      const spots = [];
      let n = 0;
      for (let x = 700; x <= 2100; x += 200) {
        for (let y = 600; y <= 1400; y += 400) {
          spots.push({ x, y, a: (n++ % 8) / 8 * Math.PI * 2 });
        }
      }
      return window.__mv.coverDrill(spots, 12);
    });
  }

  if (WANT.includes('traffic')) {
    await page.evaluate(d => { startGame('us', d, 'vp'); }, DIFF);
    await page.evaluate(() => { window.__mv.watch(); window.__mv.reset(); });
    const marks = 4;
    for (let i = 0; i < marks; i++) {
      await fastForward(page, SECS / marks);
      if (await page.evaluate(() => !!G.over)) break;
    }
    out.traffic = await page.evaluate(() => window.__mv.read());
  }

  await browser.close();
  return out;
}

/* ------------------------------------------------------------------ printing */

function pct(a, b) { return b ? (a / b * 100).toFixed(a / b >= 0.1 ? 1 : 2) + '%' : '-'; }
function pad(s, n, right) {
  s = String(s);
  return right ? s.padStart(n) : s.padEnd(n);
}

function printRoutes(rows, older) {
  console.log('\n  ROUTES   one unit alone on the shipped map, asked to cross it\n');
  console.log('  ' + pad('route', 19) + pad('mover', 8) + pad('legs', 5, 1) + pad('len', 7, 1) +
              pad('detour', 8, 1) + pad('vs opt', 8, 1) + pad('fit', 6, 1) + pad('secs', 7, 1) +
              pad('stuck', 7, 1) + pad('road', 7, 1) + '  ');
  console.log('  ' + '-'.repeat(88));
  let bad = 0;
  for (const r of rows) {
    const detour = r.crow ? (r.len / r.crow).toFixed(2) : '-';
    const vs = r.opt ? (r.cost / r.opt).toFixed(2) : '-';
    const flag = (!r.arrived ? '!' : '') + (r.fit < 0 ? ' tight' : '');
    if (!r.arrived || r.fit < 0) bad++;
    const prev = older && older.find(o => o.route === r.route && o.mover === r.mover);
    const delta = prev ? '  (' + (prev.arrived ? prev.secs.toFixed(0) + 's' : 'lost') + ' before)' : '';
    console.log('  ' + pad(r.route, 19) + pad(r.mover, 8) + pad(r.legs, 5, 1) + pad(r.len, 7, 1) +
                pad(detour, 8, 1) + pad(vs, 8, 1) + pad(r.fit, 6, 1) +
                pad(r.arrived ? r.secs.toFixed(0) : 'lost+' + r.short, 7, 1) +
                pad(r.stuck, 7, 1) + pad(r.mover === 'foot' ? '-' : r.road, 7, 1) + '  ' + flag + delta);
  }
  console.log('\n  detour is path length over the crow; vs opt is its cost over a plain Dijkstra on the');
  console.log('  same grid and the same cellCost. fit is the narrowest place on it less half');
  console.log('  the unit\'s beam: below zero it does not go through. stuck is seconds spent not moving with a');
  console.log('  path in hand; road is the share of driven frames on the metalling.');
  if (bad) console.log('\n  ' + bad + (bad === 1 ? ' route does' : ' routes do') + ' not arrive, or not fit.');
}

function printCover(rows) {
  const took = rows.reduce((s, r) => s + r.took, 0) / rows.length;
  const avail = rows.reduce((s, r) => s + r.avail, 0) / rows.length;
  const none = rows.filter(r => r.took < 0.5 && r.avail >= 2).length;
  console.log('\n  COVER    a section halted with the fire on a known bearing\n');
  if (VERB) {
    console.log('  ' + pad('at', 14) + pad('took', 7, 1) + pad('avail', 7, 1) + pad('piece', 10) + pad('moved', 7, 1));
    console.log('  ' + '-'.repeat(46));
    for (const r of rows) {
      console.log('  ' + pad(r.x + ',' + r.y, 14) + pad(r.took.toFixed(2), 7, 1) + pad(r.avail, 7, 1) +
                  pad(r.piece, 10) + pad(r.moved, 7, 1) + (r.took < 0.5 && r.avail >= 2 ? '  missed' : ''));
    }
    console.log('');
  }
  console.log('  ' + pad('drills', 14) + pad(rows.length, 7, 1));
  console.log('  ' + pad('took', 14) + pad(took.toFixed(2), 7, 1) + '   mean tier the men are getting');
  console.log('  ' + pad('available', 14) + pad(avail.toFixed(2), 7, 1) + '   best tier within a short walk');
  console.log('  ' + pad('taken/avail', 14) + pad(avail ? (took / avail).toFixed(2) : '-', 7, 1));
  console.log('  ' + pad('missed', 14) + pad(none, 7, 1) + '   stood in the open with medium cover to hand');
}

function printTraffic(c) {
  console.log('\n  TRAFFIC  ' + c.secs + 's of battle, both brains, counted every frame\n');
  const rows = [
    ['frames', c.frames, ''],
    ['unit-frames', c.unitF, ''],
    ['man-frames', c.manF, ''],
    ['', '', ''],
    ['stuck', pct(c.stuck, c.win), 'unit-frames with a path and four seconds of no progress'],
    ['off the grid', pct(c.offGrid, c.unitF), 'a unit centre on ground it cannot stand on'],
    ['men in walls', pct(c.inSolid, c.manF), 'a man inside a house or a solid prop'],
    ['stragglers', pct(c.stray, c.manF), 'a man over 150 from his section and not sent there'],
    ['section spread', (c.manF ? (c.spread / c.manF).toFixed(0) : 0), 'mean distance of a man from his own marker'],
    ['wedged', pct(c.overlap, c.unitF), 'two units inside each other'],
    ['too tight', pct(c.tight, c.vehF), 'a vehicle in a gap narrower than its own beam'],
    ['', '', ''],
    ['paths found', c.paths, (c.frames ? (c.paths / c.frames).toFixed(2) : 0) + ' a frame, ' +
      (c.paths ? (c.pathMs / c.paths).toFixed(3) : 0) + ' ms each, ' + c.pathMs.toFixed(0) + ' ms in all'],
    ['searches lost', pct(c.one, c.paths), 'no way through, so the destination came back bare'],
    ['searching', pct(c.pathF, c.unitF), 'unit-frames with a path in hand'],
    ['', '', ''],
    ['facing the threat', pct(c.faced, c.haltKnown), 'halted sections turned toward what they know of'],
    ['in cover', pct(c.coveredMen, c.haltMen), 'halted men behind something'],
    ['on the metalling', pct(c.vehRoad, c.vehMove), 'driven frames on a street']
  ];
  for (const [k, v, note] of rows) {
    if (!k) { console.log(''); continue; }
    console.log('  ' + pad(k, 20) + pad(v, 10, 1) + '   ' + note);
  }
}

/* ------------------------------------------------------------------ run */

let older = null;
if (BASE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-move-'));
  const f = path.join(dir, 'ortona.html');
  fs.writeFileSync(f, execFileSync('git', ['show', `${BASE}:ortona.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  process.stderr.write(`  ${BASE} ...\n`);
  older = await card(f, BASE);
  fs.rmSync(dir, { recursive: true, force: true });
}
process.stderr.write('  working file ...\n');
const now = await card(GAME, 'working');

if (args.json) {
  console.log(JSON.stringify({ now, older }, null, 2));
} else {
  if (now.routes) printRoutes(now.routes, older && older.routes);
  if (now.cover) printCover(now.cover);
  if (now.traffic) printTraffic(now.traffic);
  if (older) {
    console.log('\n  BEFORE   ' + BASE + '\n');
    if (older.cover) printCover(older.cover);
    if (older.traffic) printTraffic(older.traffic);
  }
  console.log('');
}
