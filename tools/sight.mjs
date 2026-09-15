/* Sight, mechanically.
 *
 * What a unit can see cannot be reviewed by reading the diff and cannot be reviewed from
 * a screenshot either: the picture shows what the renderer drew, and what the renderer
 * draws is filtered by the same vision code that is under test, so a bug in it hides
 * itself. The fog of war ran for the life of the game with no live-vision tier at all --
 * `updateFog` asked each eye for `r2` and `computeVisibility` writes `r`, so the radius
 * was the square root of undefined -- and every screenshot ever taken of this game looked
 * plausible. That is why the fog buffer is a section here.
 *
 *   node tools/sight.mjs                 the whole card
 *   node tools/sight.mjs trace           one section of it
 *   node tools/sight.mjs --n=400         more sample lines
 *   node tools/sight.mjs --base=HEAD     the same card on an older file, side by side
 *
 * TRACE asks whether the line of sight agrees with the ground. The reference is a walk of
 * the same line at four units a step, which is deliberately NOT what the game does: the
 * game steps at up to fifty units at long range, and a garden wall is fourteen units
 * thick. An optimum computed by the code under test is not an optimum, and a sight line
 * checked by the sight code is not checked.
 *
 * REACH asks what a position commands: the share of a ring at each range that an eye
 * there can actually see, which is the number that says whether a town is a town or an
 * open field with houses drawn on it.
 *
 * SPOT asks how far off a thing is picked up, for each of the things `exposure` claims to
 * care about -- moving, still, flat, running, firing, in cover, in a house. A model that
 * says it rewards keeping still has to be asked by how much.
 *
 * FOG is the buffer the terrain shader multiplies in: the share of the map in each of its
 * three tiers. Never seen, seen once, seen now.
 *
 * COST is what a vision tick costs and how many traces it runs, because everything above
 * is affordable or it is not.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openGame, deploy, fastForward, parseArgs, GAME } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const N = args.n === undefined ? 240 : Number(args.n);
const SECS = args.t === undefined ? 90 : Number(args.t);
const BASE = args.base === undefined ? null : String(args.base);
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const want = s => !only.length || only.includes(s);

/* ------------------------------------------------------------------ the page side */

async function install(page) {
  await page.evaluate((n) => {
    const S = window.__s = { n };

    /* --- the independent reference: the same line, walked finely --- */
    /* Four units a step against the game's up-to-fifty, and the same near-end exemption
       the game grants, so the only thing being compared is how finely the line is
       sampled. Anything the reference calls blocked and the game calls clear is a wall
       the trace stepped over. */
    S.refClear = function (x0, y0, z0, x1, y1, z1, blk) {
      const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
      if (d < 30) return true;
      const near = 22, skip = Math.min(.3, 30 / d);
      const steps = Math.max(8, Math.ceil(d / 4));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = x0 + dx * t, y = y0 + dy * t;
        if (t * d < near || (1 - t) * d < near) continue;
        const cx = (x / CELL) | 0, cy = (y / CELL) | 0;
        if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) continue;
        if (blk[cidx(cx, cy)]) return false;
        if (t > skip && t < 1 - skip) {
          const z = z0 + (z1 - z0) * t;
          if (groundZ(x, y) > z + 2) return false;
        }
      }
      return true;
    };

    /* --- TRACE: many lines across the shipped map, both ways --- */
    S.trace = function () {
      const R = { n: 0, agree: 0, falseClear: 0, falseBlocked: 0, byRange: {}, refBlocked: 0 };
      let seed = 987654321;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let i = 0; i < S.n; i++) {
        const a = nearestFree(60 + rnd() * (WORLD.w - 120), 60 + rnd() * (WORLD.h - 120));
        const b = nearestFree(60 + rnd() * (WORLD.w - 120), 60 + rnd() * (WORLD.h - 120));
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < 60) continue;
        const z0 = groundZ(a.x, a.y) + 15.5, z1 = groundZ(b.x, b.y) + 12;
        const got = traceClear(a.x, a.y, z0, b.x, b.y, z1, sblk);
        const ref = S.refClear(a.x, a.y, z0, b.x, b.y, z1, sblk);
        const bk = d < 400 ? '0-400' : d < 900 ? '400-900' : d < 1600 ? '900-1600' : '1600+';
        const e = R.byRange[bk] || (R.byRange[bk] = { n: 0, agree: 0, fc: 0, fb: 0, refBlocked: 0 });
        R.n++; e.n++;
        if (!ref) { R.refBlocked++; e.refBlocked++; }
        if (got === ref) { R.agree++; e.agree++; }
        else if (got && !ref) { R.falseClear++; e.fc++; }
        else { R.falseBlocked++; e.fb++; }
      }
      /* and the calibration the file records: a man just behind his own wall still sees */
      R.ownWall = (function () {
        let ok = 0, tried = 0;
        for (let cy = 2; cy < GH - 2; cy++) for (let cx = 2; cx < GW - 2; cx++) {
          if (!sblk[cidx(cx, cy)] || sblk[cidx(cx + 1, cy)]) continue;
          /* a wall cell with clear ground the far side of it: stand a man nine units back */
          const wx = (cx + .5) * CELL, wy = (cy + .5) * CELL;
          const mx = wx - 9 - CELL / 2, my = wy;
          if (!walkable(mx, my)) continue;
          const tx = wx + 320, ty = wy;
          if (!walkable(tx, ty)) continue;
          tried++;
          if (traceClear(mx, my, groundZ(mx, my) + 15.5, tx, ty, groundZ(tx, ty) + 12, sblk)) ok++;
          if (tried >= 60) break;
        }
        return { tried, ok };
      })();
      return R;
    };

    /* --- REACH: what a position commands --- */
    S.reach = function () {
      const SPOTS = [
        ['the crossroads', 1400, 950],
        ['the piazza', 1400, 700],
        ['a back lane', 1180, 1120],
        ['the shelf', 900, 380],
        ['the vallone', 1750, 1500],
        ['open ground west', 520, 950]
      ];
      const out = [];
      for (const [name, x0, y0] of SPOTS) {
        const p = nearestFree(x0, y0);
        const z = groundZ(p.x, p.y) + 15.5;
        const row = { name, x: p.x, y: p.y, rings: {} };
        for (const r of [150, 300, 500, 800]) {
          let clear = 0, n = 0;
          for (let a = 0; a < 72; a++) {
            const th = a * Math.PI * 2 / 72;
            const tx = p.x + Math.cos(th) * r, ty = p.y + Math.sin(th) * r;
            if (tx < 20 || ty < 20 || tx > WORLD.w - 20 || ty > WORLD.h - 20) continue;
            n++;
            if (traceClear(p.x, p.y, z, tx, ty, groundZ(tx, ty) + 12, sblk)) clear++;
          }
          row.rings[r] = n ? clear / n : 0;
        }
        out.push(row);
      }
      return out;
    };

    /* --- SPOT: how far off each kind of thing is picked up --- */
    /* One watcher, one target walked in from beyond any possible reach until the watcher
       has it. What comes back is the range at which each state was detected, which is the
       only honest way to read `exposure`: the multiplier is on the WATCHER's reach, so
       what it means in units of ground is a thing to measure rather than to read off. */
    S.spot = function () {
      const keep = G.units.slice();
      G.units.length = 0;
      const wx = 700, wy = 950;
      const watcher = spawnUnit('ger', 'ger_gren', wx, wy, 0);
      const t = spawnUnit('us', 'us_rifle', wx + 900, wy, Math.PI);
      const CASES = [
        ['standing still', u => { u.moving = false; u.stance = ''; u.fireT = 0; u.sup = 0; }],
        ['walking', u => { u.moving = true; u.stance = ''; u.fireT = 0; u.sup = 0; }],
        ['at the double', u => { u.moving = true; u.stance = 'double'; u.fireT = 0; u.sup = 0; }],
        ['flat on the ground', u => { u.moving = false; u.stance = 'ground'; u.fireT = 0; u.sup = 0; }],
        ['firing', u => { u.moving = false; u.stance = ''; u.fireT = .4; u.sup = 0; }],
        ['pinned', u => { u.moving = false; u.stance = ''; u.fireT = 0; u.sup = .9; }]
      ];
      const out = [];
      for (const [name, set] of CASES) {
        let found = 0;
        for (let d = 900; d > 40; d -= 5) {
          t.x = wx + d; t.y = wy;
          for (const m of t.models) { m.x = t.x; m.y = t.y; m.alive = true; }
          set(t);
          t.seenGer = -1; t.vGer = false;
          computeVisibility(0);
          if (t.vGer) { found = d; break; }
        }
        set(t);
        out.push({ name, range: found, exposure: +exposure(t).toFixed(3) });
      }
      G.units.length = 0;
      for (const u of keep) G.units.push(u);
      return out;
    };

    /* --- FOG: the three tiers of the buffer the ground shader reads --- */
    S.fog = function () {
      updateFog();
      let now = 0, seen = 0, never = 0;
      for (let i = 0; i < fogBuf.length; i++) {
        if (fogBuf[i] > 150) now++;
        else if (fogBuf[i] > 40) seen++;
        else never++;
      }
      return { cells: fogBuf.length, now, seen, never,
               eyes: (_eyes[G.side] || []).length };
    };

    /* --- COST --- */
    S.cost = function () {
      const realTrace = window.traceClear;
      let traces = 0;
      window.traceClear = function () { traces++; return realTrace.apply(this, arguments); };
      const t0 = performance.now();
      const REP = 24;
      for (let i = 0; i < REP; i++) computeVisibility(0);
      const ms = (performance.now() - t0) / REP;
      window.traceClear = realTrace;
      const t1 = performance.now();
      for (let i = 0; i < REP; i++) updateFog();
      const fms = (performance.now() - t1) / REP;
      return { ms, fms, traces: traces / REP, units: G.units.filter(u => !u.dead).length,
               eyes: _eyes.us.length + _eyes.ger.length };
    };
  }, N);
}

/* ------------------------------------------------------------------ the card */

async function card(file, label) {
  const browser = await launch();
  const { page } = await openGame(browser, 'desktop', { file, quiet: true });
  await deploy(page, { side: 'us', diff: 1 });
  await page.evaluate(() => { startGame('us', 1, 'vp'); });
  await install(page);
  const out = { label };
  if (want('trace')) out.trace = await page.evaluate(() => window.__s.trace());
  if (want('reach')) out.reach = await page.evaluate(() => window.__s.reach());
  if (want('spot')) out.spot = await page.evaluate(() => window.__s.spot());
  /* the battle first, so the fog and the cost are read off a real position */
  if (want('fog') || want('cost')) {
    for (let m = 0; m < 3; m++) await fastForward(page, SECS / 3);
    if (want('fog')) out.fog = await page.evaluate(() => window.__s.fog());
    if (want('cost')) out.cost = await page.evaluate(() => window.__s.cost());
  }
  await browser.close();
  return out;
}

/* ------------------------------------------------------------------ printing */

const pad = (s, n, right) => right ? String(s).padStart(n) : String(s).padEnd(n);
const pct = (a, b) => b ? (a / b * 100).toFixed(a / b >= .1 ? 1 : 2) + '%' : '-';

function show(c) {
  if (c.trace) {
    const t = c.trace;
    console.log('\n  TRACE    the game\'s sight line against a four-unit walk of the same line\n');
    console.log('  ' + pad('lines', 22) + pad(t.n, 9, 1) + '   of which the ground blocks: ' +
                pct(t.refBlocked, t.n));
    console.log('  ' + pad('agree', 22) + pad(pct(t.agree, t.n), 9, 1));
    console.log('  ' + pad('said clear, is blocked', 22) + pad(pct(t.falseClear, t.n), 9, 1) +
                '   a wall the trace stepped over');
    console.log('  ' + pad('said blocked, is clear', 22) + pad(pct(t.falseBlocked, t.n), 9, 1));
    console.log('\n  ' + pad('by range', 12) + pad('lines', 8, 1) + pad('step', 7, 1) +
                pad('agree', 9, 1) + pad('false clear', 13, 1));
    for (const k of ['0-400', '400-900', '900-1600', '1600+']) {
      const e = t.byRange[k];
      if (!e) continue;
      /* what the game's own step size is in that bucket: min(40, max(3, d/22)) samples */
      const mid = { '0-400': 250, '400-900': 650, '900-1600': 1250, '1600+': 2000 }[k];
      const step = (mid / Math.min(40, Math.max(3, Math.ceil(mid / 22)))).toFixed(0);
      console.log('  ' + pad(k, 12) + pad(e.n, 8, 1) + pad(step + 'u', 7, 1) +
                  pad(pct(e.agree, e.n), 9, 1) + pad(pct(e.fc, e.n), 13, 1));
    }
    console.log('\n  ' + pad('a man behind his wall', 22) +
                pad(pct(t.ownWall.ok, t.ownWall.tried), 9, 1) +
                '   still sees past it, over ' + t.ownWall.tried +
                '\n    (the exemption at the near end; anything under 100% is men blinded by');
    console.log('    their own cover, which is what the distance-not-cell rule was for)');
  }
  if (c.reach) {
    console.log('\n  REACH    the share of a ring at each range an eye there can see\n');
    console.log('  ' + pad('from', 20) + ['150', '300', '500', '800'].map(r => pad(r + 'u', 9, 1)).join(''));
    console.log('  ' + '-'.repeat(58));
    for (const r of c.reach)
      console.log('  ' + pad(r.name, 20) +
                  [150, 300, 500, 800].map(k => pad((r.rings[k] * 100).toFixed(0) + '%', 9, 1)).join(''));
  }
  if (c.spot) {
    console.log('\n  SPOT     the range a section is picked up at, by what it is doing\n');
    console.log('  ' + pad('the target is', 22) + pad('seen at', 10, 1) + pad('exposure', 11, 1));
    console.log('  ' + '-'.repeat(45));
    const base = c.spot.find(r => r.name === 'walking');
    for (const r of c.spot) {
      const rel = base && base.range ? ((r.range / base.range - 1) * 100) : 0;
      console.log('  ' + pad(r.name, 22) + pad(r.range ? r.range + 'u' : 'never', 10, 1) +
                  pad(r.exposure.toFixed(2), 11, 1) +
                  (r === base ? '   (the baseline)' :
                   r.range ? '   ' + (rel >= 0 ? '+' : '') + rel.toFixed(0) + '%' : ''));
    }
  }
  if (c.fog) {
    const f = c.fog;
    console.log('\n  FOG      the buffer the ground shader multiplies in\n');
    console.log('  ' + pad('seen now', 22) + pad(pct(f.now, f.cells), 9, 1) +
                '   drawn at full brightness');
    console.log('  ' + pad('seen once', 22) + pad(pct(f.seen, f.cells), 9, 1) +
                '   drawn at about half');
    console.log('  ' + pad('never seen', 22) + pad(pct(f.never, f.cells), 9, 1) +
                '   drawn at a sixth');
    console.log('  ' + pad('eyes on the map', 22) + pad(f.eyes, 9, 1));
    if (!f.now) console.log('\n    NOTHING is seen now. The live tier is not drawing at all.');
  }
  if (c.cost) {
    const k = c.cost;
    console.log('\n  COST\n');
    console.log('  ' + pad('a vision tick', 22) + pad(k.ms.toFixed(2) + ' ms', 9, 1) +
                '   ' + k.units + ' units alive, ' + k.eyes + ' eyes');
    console.log('  ' + pad('sight lines a tick', 22) + pad(Math.round(k.traces), 9, 1));
    console.log('  ' + pad('painting the fog', 22) + pad(k.fms.toFixed(2) + ' ms', 9, 1));
  }
}

const now = await card(GAME, 'working file');
let older = null;
if (BASE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-'));
  const f = path.join(dir, 'ortona.html');
  fs.writeFileSync(f, execFileSync('git', ['show', `${BASE}:ortona.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  older = await card(f, BASE);
}
if (args.json) console.log(JSON.stringify({ now, older }, null, 2));
else {
  show(now);
  if (older) { console.log('\n\n  BEFORE   ' + BASE); show(older); }
  console.log('');
}
