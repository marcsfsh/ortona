/* Destruction, mechanically.
 *
 * A building coming down is the one change in this file that looks convincing whatever
 * is wrong underneath it. A hole in the wrong place is a hole. Stone that vanishes on
 * the way out is stone nobody counted. A chunk that falls at the wrong rate falls. A
 * bay that comes down on the second round instead of the eighth still comes down, and
 * the photograph of it is the same photograph. And the grids are worse than that: a
 * house knocked flat that still stops a boot and still stops an eye is a picture of
 * rubble laid over a building that is, as far as everything in the game is concerned,
 * exactly where it was.
 *
 *   node tools/wreck.mjs                 the card
 *   node tools/wreck.mjs shell           one section of it
 *   node tools/wreck.mjs --base=HEAD     the same card on an older file, side by side
 *
 * SHELL is a round against a wall: the hole it cuts, against the hole the burst radius
 * says it should cut, and the masonry that comes out against the masonry that left the
 * wall. The second is the conservation check and it is the one that matters -- the area
 * a wall has lost is bookkeeping until the stone it lost is in the air at the right size.
 *
 * FALL is the structural rule: one face gone, or two faces half gone, takes the storey
 * standing on them. Each is staged by writing the damage directly rather than by
 * shelling until it happens, because the question is what the rule does and not how many
 * rounds a particular wall takes.
 *
 * DEBRIS is the integrator against arithmetic that was true before the game was written.
 * A chunk dropped from a height falls in sqrt(2h/g) whatever the code does; it bounces
 * to the square of its restitution; and it stops. The heap is the other half: what
 * settles has to be what came down, and it has to pile rather than spread.
 *
 * WORLD is the part a screenshot cannot see at all. The same cell is asked the same four
 * questions with the bay standing and with the bay down: can a man walk here, does it
 * stop an eye, does it stop a round, and what does it cost to cross.
 *
 * WALL is the same question asked of an object rather than a building. A garden wall has
 * no structure and does not need one: it is a line, and what a shell does to it is take a
 * length out of the middle. What is checked is that the length comes out, that the stones
 * that were standing there are in the air, and that the three grids a wall is on stop
 * marking the piece that is no longer there.
 *
 * COST is what a hit, a rebuild and a frame of falling masonry are worth in milliseconds.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openGame, deploy, parseArgs, GAME } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const BASE = args.base === undefined ? null : String(args.base);
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const want = s => !only.length || only.includes(s);

async function run(file, label) {
  const browser = await launch();
  const { page, log } = await openGame(browser, 'desktop', { file, quiet: true });
  await deploy(page, { side: 'us', diff: 1 });
  const out = await page.evaluate(({ doShell, doFall, doDebris, doWorld, doWall, doCost }) => {
    const R = {};

    /* A house on its own, so that nothing else on the map is in the burst and every
       number below belongs to the thing under test. It is put back between drills by
       forgetting everything the shelling wrote on it. */
    function pickHouse() {
      const c = G.props.filter(p => p.kind === 'ruin' && p.style !== 'church' && p.w > 130 &&
        !G.blds.some(b => Math.hypot(b.x - p.x, b.y - p.y) < 340) &&
        !G.props.some(q => q !== p && q.solid && q.kind !== 'sea' && Math.hypot(q.x - p.x, q.y - p.y) < 260));
      return c[0] || G.props.filter(p => p.kind === 'ruin' && p.style !== 'church')[0];
    }
    function reset(p) {
      p.bay = null;
      if (p.hurt) { p.hurt = 0; const i = G.hurt.indexOf(p); if (i >= 0) G.hurt.splice(i, 1); }
      G.debris.length = 0; G.rub.length = 0; G.tileQ = {};
      MND = null;
    }

    /* ---- SHELL ---- */
    if (doShell) {
      const rows = [];
      const p = pickHouse();
      /* the wall under test is the -y face of the middle bay, which is face 1, and the
         round is put on its outside so the breach opens the way the blast went */
      const mid = () => ruinState(p)[Math.floor(ruinBays(p) / 2)];

      /* the conservation is a mean over repeats and not one draw of it: two chunks with
         three jitters each have a spread that swamps the number being asked about, and
         one shot of it reads as a finding */
      const REP = 24;
      for (const dmg of [18, 40, 90, 300]) {
        const br = Math.min(26, Math.max(4, 3 + dmg * 0.075));
        const reach = Math.min(74, Math.max(16, 12 + dmg * 0.2));
        let hw = 0, band = 0, gone = 0, area = 0, chunks = 0, wantVol = 0, gotVol = 0, hits = 0;
        for (let r = 0; r < REP; r++) {
          reset(p);
          const b = mid();
          explode(b.x, p.y - p.h / 2 - 2, 80, dmg, null, null, 22);
          const B = ruinState(p)[Math.floor(ruinBays(p) / 2)];
          const hole = B.brk[1][0] || null;
          if (!hole) continue;
          hits++;
          hw += hole.hw; band += hole.z1 - hole.z0;
          gone += B.gone[1];
          /* the area the wall has lost, worked out here rather than read back off it */
          area += (2 * hole.hw * (hole.z1 - hole.z0)) / (B.w * B.h);
          /* and the stone that should have come out, which is EVERY hole the round cut
             and not only the one in the wall it was aimed at: a big enough burst takes a
             bite out of the returns as well, and counting one against all the chunks
             reads as masonry appearing out of nowhere */
          for (let f = 0; f < 4; f++) for (const hl of B.brk[f])
            wantVol += 2 * hl.hw * (hl.z1 - hl.z0) * 4.5;
          chunks += G.debris.length;
          for (const c of G.debris) gotVol += c.l * c.w * c.h;
        }
        const d = hits || 1;
        rows.push({ dmg, br: +br.toFixed(1), reach: +reach.toFixed(0), hw: +(hw / d).toFixed(1),
                    band: +(band / d).toFixed(1), gone: +(gone / d).toFixed(3),
                    area: +(area / d).toFixed(3), chunks: +(chunks / d).toFixed(1),
                    wantVol: Math.round(wantVol / d), gotVol: Math.round(gotVol / d),
                    keep: wantVol ? +(gotVol / wantVol).toFixed(2) : 0 });
      }
      /* and the same round at a stand-off, because a shell in a town bursts where a man
         is standing and a man at a house stands a dozen units off its wall */
      const off = [];
      for (const d2 of [0, 8, 16, 26, 40]) {
        let hw2 = 0, hits = 0;
        for (let r = 0; r < 12; r++) {
          reset(p);
          const b = mid();
          explode(b.x, p.y - p.h / 2 - 2 - d2, 80, 90, null, null, 22);
          const hole = (p.bay ? p.bay[Math.floor(ruinBays(p) / 2)].brk[1][0] : null);
          if (hole) { hits++; hw2 += hole.hw; }
        }
        off.push({ d: d2, hw: hits ? +(hw2 / hits).toFixed(1) : 0, hit: hits });
      }
      /* A round that lands too far off takes nothing out of THIS house. The count has to
         be of this one and not of the debris list, because a neighbour's wall inside the
         same burst is a fair hit and reads here as a fault that is not there. */
      reset(p);
      explode(p.x, p.y - p.h / 2 - 140, 80, 300, null, null, 22);
      const far = { chunks: p.bay ? p.bay.reduce((n, b) => n + b.brk.reduce((m, k) => m + k.length, 0), 0) : 0,
                    hurt: p.hurt ? 1 : 0 };
      /* and neither does one in the right place with no weight behind it */
      reset(p);
      explode(p.x, p.y - p.h / 2 - 2, 60, 20, null, null, 22);
      const light = { chunks: p.bay ? p.bay.reduce((n, b) => n + b.brk.reduce((m, k) => m + k.length, 0), 0) : 0,
                      hurt: p.hurt ? 1 : 0 };
      reset(p);
      R.shell = { rows, off, far, light, keep: RUIN_KEEP,
                  w: Math.round(p.w), h: Math.round(p.h), bays: ruinBays(p) };
    }

    /* ---- FALL ---- */
    if (doFall) {
      const p = pickHouse();
      const rows = [];
      /* the rule is written on `gone`, so it is asked with `gone` written directly: how
         many rounds a particular wall happens to take is a different question and it is
         the row underneath */
      function stage(name, gone) {
        reset(p);
        const b = ruinState(p)[0];
        const was = ruinHeight(b);
        for (let i = 0; i < 4; i++) b.gone[i] = gone[i];
        ruinCollapse(p, b, null);
        G.tileQ = {};
        rows.push({ name, down: b.down, was: Math.round(was), now: Math.round(ruinHeight(b)),
                    shed: G.debris.length });
      }
      stage('one wall three quarters out', [0.80, 0, 0, 0]);
      stage('one wall half out', [0.50, 0, 0, 0]);
      stage('two walls half out', [0.50, 0.50, 0, 0]);
      stage('two walls a third out', [0.33, 0.33, 0, 0]);
      stage('four walls a third out', [0.33, 0.33, 0.33, 0.33]);

      /* and what it actually takes, which is the number a player feels */
      const takes = [];
      for (const dmg of [40, 90, 300]) {
        reset(p);
        const b0 = ruinState(p)[Math.floor(ruinBays(p) / 2)];
        let n = 0;
        while (b0.down < 1 && n < 60) {
          n++;
          explode(b0.x + (n % 5 - 2) * 9, p.y - p.h / 2 - 2, 80, dmg, null, null, 22);
        }
        let n2 = n;
        while (b0.down < 2 && n2 < 120) {
          n2++;
          explode(b0.x + (n2 % 5 - 2) * 9, p.y - p.h / 2 - 2, 80, dmg, null, null, 22);
        }
        takes.push({ dmg, first: n < 60 ? n : null, second: n2 < 120 ? n2 : null });
      }
      reset(p);
      R.fall = { rows, takes };
    }

    /* ---- DEBRIS ---- */
    if (doDebris) {
      const p = pickHouse();
      reset(p);
      /* a chunk let go from a known height over known ground. It falls in sqrt(2h/g)
         whatever the integrator does, which is the whole point of asking. */
      const gx = p.x + p.w, gy = p.y + 260, g0 = groundZ(gx, gy);
      const H = 200, dt = 1 / 60;
      G.debris.length = 0;
      G.debris.push({ x: gx, y: gy, z: g0 + H, l: 8, w: 4, h: 6, c: '#888',
                      vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, rest: 0, t: 0 });
      let t = 0, land = null, peak = 0, landed = false;
      for (let i = 0; i < 1200 && G.debris.length; i++) {
        const zb = G.debris[0].z;
        stepDebris(dt); t += dt;
        if (!landed && G.debris.length && G.debris[0].vz > 0) { landed = true; land = t; }
        if (landed && G.debris.length) peak = Math.max(peak, G.debris[0].z - g0 - 3);
      }
      /* the fall a sixty-hertz step of a constant acceleration actually takes is a step
         longer than the closed form, because the first step is taken at zero speed */
      const fall = Math.sqrt(2 * (H - 3) / 98);
      const rest = t;

      /* the heap: everything one collapse sheds, settled, against what came out */
      reset(p);
      const b = ruinState(p)[Math.floor(ruinBays(p) / 2)];
      for (let i = 0; i < 4; i++) b.gone[i] = 0.9;
      ruinCollapse(p, b, null);
      G.tileQ = {};
      const shed = G.debris.length;
      let outVol = 0;
      for (const c of G.debris) outVol += c.l * c.w * c.h;
      let guard = 0;
      while (G.debris.length && guard++ < 2000) stepDebris(dt);
      let inVol = 0;
      for (const r of G.rub) inVol += r.l * r.w * r.h;
      let mound = 0, cells = 0;
      if (MND) for (let i = 0; i < MND.length; i++) { if (MND[i] > 0.5) cells++; mound = Math.max(mound, MND[i]); }
      /* and how high the heap stands over how much ground, because a heap that spreads
         evenly over the whole footprint is a pavement */
      R.debris = { fall: +fall.toFixed(3), land: +land.toFixed(3), err: +Math.abs(land - fall).toFixed(3),
                   bounce: +(peak / (H - 3)).toFixed(4), restit: 0.2 * 0.2,
                   rest: +rest.toFixed(1), left: G.debris.length,
                   shed, kept: G.rub.length,
                   outVol: Math.round(outVol), inVol: Math.round(inVol),
                   mound: +mound.toFixed(1), cells, cap: MCAP };
      reset(p);
      rebuildGrid();
    }

    /* ---- WORLD ---- */
    if (doWorld) {
      const p = pickHouse();
      reset(p);
      rebuildGrid();
      const b0 = ruinState(p)[Math.floor(ruinBays(p) / 2)];
      const qx = b0.x, qy = p.y;
      /* asked at the cell, not through the thing under test */
      function ask() {
        const cx = (qx / CELL) | 0, cy = (qy / CELL) | 0, ci = cidx(cx, cy);
        return { walk: walkable(qx, qy) ? 1 : 0,
                 sight: sblk[ci] ? 1 : 0, fire: fblk[ci] ? 1 : 0, rub: rubg[ci] ? 1 : 0,
                 man: +cellCost(ci, 0, null, 0).toFixed(2),
                 track: +cellCost(ci, 1, null, 0).toFixed(2),
                 gar: canGarrison({ cat: 'inf', def: { speed: 30 }, models: [] }, p) ? 1 : 0 };
      }
      const up = ask();
      /* bring every bay down, the way a battery would, and ask the same cell again */
      const B = ruinState(p);
      for (const bb of B) { for (let i = 0; i < 4; i++) bb.gone[i] = 0.9; ruinCollapse(p, bb, null); ruinCollapse(p, bb, null); }
      G.debris.length = 0; G.tileQ = {};
      rebuildGrid();
      const down = ask();
      /* and the house's own cover, which was four heavy patches lying along four walls */
      const near = coversNear(p.x, p.y, Math.max(p.w, p.h) * 0.6)
        .filter(c => Math.abs(c.x - p.x) <= p.w / 2 + 16 && Math.abs(c.y - p.y) <= p.h / 2 + 16);
      const cov = near.map(c => ({ kind: c.kind, type: c.type, hp: c.hp,
                                   val: coverValue(c, Math.PI / 2) }));
      reset(p);
      rebuildGrid();
      R.world = { up, down, cov, standing: Math.round(ruinStanding(p)) };
    }

    /* ---- WALL ---- */
    if (doWall) {
      /* the longest run on the map, and a fresh one each drill because a gap does not
         heal */
      function pickWall() {
        const ws = G.walls.map(w => ({ w, len: Math.hypot(w.x2 - w.x1, w.y2 - w.y1) }))
          .filter(o => o.len > 110 && !o.w.gaps).sort((a, c) => c.len - a.len);
        return ws[0];
      }
      function clearWalls() { for (const w of G.walls) w.gaps = null; wallq = null; G.tileQ = {}; G.debris.length = 0; rebuildGrid(); }
      clearWalls();
      const rows = [];
      for (const dmg of [18, 40, 90, 300]) {
        clearWalls();
        const o = pickWall(); if (!o) break;
        const w = o.w, mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
        const before = G.debris.length;
        explode(mx, my, 80, dmg, null, null, 12);
        const g = w.gaps || [];
        rows.push({ dmg, h: w.h || 24, len: Math.round(o.len),
                    gaps: g.length, wide: g.length ? +(g[0][1] - g[0][0]).toFixed(1) : 0,
                    stones: G.debris.length - before });
      }
      /* a round that went clean over the top of it does nothing to it */
      clearWalls();
      const o2 = pickWall();
      explode((o2.w.x1 + o2.w.x2) / 2, (o2.w.y1 + o2.w.y2) / 2, 80, 300, null, null, 90);
      const over = (o2.w.gaps || []).length;

      /* and the grids follow: the same cell, asked with the wall standing and with a
         length of it gone. A town wall stops an eye and a field wall never did, so the
         run under test has to be a tall one for the sight row to say anything. */
      clearWalls();
      const tall = G.walls.map(w => ({ w, len: Math.hypot(w.x2 - w.x1, w.y2 - w.y1) }))
        .filter(o => o.len > 110 && (o.w.h || 24) >= 16).sort((a, c) => c.len - a.len)[0];
      const tw = tall.w, tx = (tw.x1 + tw.x2) / 2, ty = (tw.y1 + tw.y2) / 2;
      const ask = () => {
        const ci = cidx((tx / CELL) | 0, (ty / CELL) | 0);
        return { sight: sblk[ci] ? 1 : 0, fire: fblk[ci] ? 1 : 0, wall: wallg[ci] ? 1 : 0 };
      };
      rebuildGrid();
      const wup = ask();
      /* a big enough gap that the twenty-unit grid can see it: a shell that takes out a
         metre of wall is a hole a man climbs through and a cell the grid still marks */
      tw.gaps = [[0, 1e6]];
      wallq = null;
      rebuildGrid();
      const wdown = ask();
      clearWalls();
      R.wall = { rows, over, up: wup, down: wdown, len: Math.round(tall.len), h: tw.h || 24 };
    }

    /* ---- COST ---- */
    if (doCost) {
      const p = pickHouse();
      reset(p);
      const b = ruinState(p)[Math.floor(ruinBays(p) / 2)];
      /* the shell against the wall, with the house already out of its tile: this is what
         every round after the first one costs */
      reset(p);
      explode(b.x, p.y - p.h / 2 - 2, 80, 90, null, null, 22);
      G.tileQ = {}; G.debris.length = 0;
      let t0 = performance.now();
      for (let i = 0; i < 40; i++) {
        explode(b.x, p.y - p.h / 2 - 2, 80, 90, null, null, 22);
        G.debris.length = 0;
      }
      const hit = (performance.now() - t0) / 40;
      /* And the tile the first one has to re-mesh, which is the hitch worth knowing about
         and the reason it is queued rather than done inside the burst. It is the MESH
         that is timed and not `buildTile`: under SwiftShader every third consecutive
         bufferData of a tile blocks for over a second, so a loop of whole tile rebuilds
         reports two and a half seconds and reports it about the rasteriser. */
      const ti = tileOf(p.x, p.y);
      t0 = performance.now();
      for (let i = 0; i < 4; i++) sceneProps(ti);
      const tile = (performance.now() - t0) / 4;

      reset(p);
      explode(b.x, p.y - p.h / 2 - 2, 80, 300, null, null, 22);
      let guard = 0;
      while (G.debris.length && guard++ < 2000) stepDebris(1 / 60);
      /* the same reason: the vertices are timed and the upload is not. And it is ONE bay,
         because that is what a round changes and what a rebuild after one costs. */
      const bb = ruinState(p)[0];
      t0 = performance.now();
      for (let i = 0; i < 20; i++) ruinBayArray(bb);
      const rebuild = (performance.now() - t0) / 20;
      const faces = ruinState(p).reduce((n, x) => n + (x.arr ? x.arr.length / 36 : 0), 0);

      /* a frame with the cap of masonry in the air: the integrator and the buffer it
         has to remake, which is the one buffer in the file rebuilt while the game runs */
      G.debris.length = 0;
      const cap = debrisCap();
      for (let i = 0; i < cap; i++)
        G.debris.push({ x: p.x + (i % 10) * 6, y: p.y + ((i / 10) | 0) * 6, z: groundZ(p.x, p.y) + 200,
                        l: 9, w: 4.5, h: 6, c: '#888', vx: 3, vy: 3, vz: 20,
                        rx: 0.2, ry: 0.3, rz: 0.4, wx: 2, wy: 2, wz: 1, rest: 0, t: 0 });
      t0 = performance.now();
      for (let i = 0; i < 60; i++) stepDebris(1 / 60);
      const step = (performance.now() - t0) / 60;
      t0 = performance.now();
      for (let i = 0; i < 30; i++) buildDebrisBuf();
      const buf = (performance.now() - t0) / 30;
      G.debris.length = 0;
      reset(p);
      rebuildGrid();
      R.cost = { hit: +hit.toFixed(3), tile: +tile.toFixed(1), rebuild: +rebuild.toFixed(2), faces,
                 step: +step.toFixed(3), buf: +buf.toFixed(2), cap };
    }
    return R;
  }, { doShell: want('shell'), doFall: want('fall'), doDebris: want('debris'),
       doWorld: want('world'), doWall: want('wall'), doCost: want('cost') });
  await browser.close();
  return { label, errors: log.errors, ...out };
}

const pad = (s, n) => String(s).padEnd(n);
const lp = (s, n) => String(s).padStart(n);

function show(c) {
  if (c.label) console.log(`\n  ${c.label}`);
  if (c.errors && c.errors.length) console.log('  ! ' + c.errors.length + ' console errors: ' + c.errors[0]);

  if (c.shell) {
    const s = c.shell;
    console.log(`\n  SHELL    a round against one wall of a ${s.w} x ${s.h} house in ${s.bays} bays\n`);
    console.log('  ' + pad('damage', 8) + lp('breach', 8) + lp('reach', 7) + lp('hole', 7) + lp('band', 7) +
                lp('gone', 8) + lp('says', 8) + lp('chunks', 8) + lp('stone', 9) + lp('kept', 7));
    for (const r of s.rows)
      console.log('  ' + pad(r.dmg, 8) + lp(r.br, 8) + lp(r.reach, 7) + lp((r.hw * 2).toFixed(1), 7) + lp(r.band, 7) +
                  lp(r.gone.toFixed(3), 8) + lp(r.area.toFixed(3), 8) + lp(r.chunks, 8) +
                  lp(r.gotVol + '/' + r.wantVol, 9) + lp(r.keep.toFixed(2), 7));
    console.log('\n  a 90-point round bursting short of the wall\n');
    console.log('  ' + pad('units off it', 16) + lp('hole', 8) + lp('of 12 rounds', 15));
    for (const o of s.off)
      console.log('  ' + pad(o.d, 16) + lp((o.hw * 2).toFixed(1), 8) + lp(o.hit, 15));
    console.log('\n  ' + pad('a round 140 off the wall', 30) +
                (s.far.chunks || s.far.hurt ? '! cut ' + s.far.chunks + ' holes in it' : 'takes nothing out of it'));
    console.log('  ' + pad('a 20-point round on it', 30) +
                (s.light.chunks || s.light.hurt ? '! cut ' + s.light.chunks + ' holes in it' : 'takes nothing out of it'));
    console.log('\n  `gone` against `says` is the wall\'s own bookkeeping against the hole measured here.');
    console.log('  `kept` is the stone in the air over the stone that left the wall, and it is meant');
    console.log('  to read ' + s.keep.toFixed(2) + ': the rest of a broken wall is dust. Averaged over 24 rounds a row.');
  }

  if (c.fall) {
    console.log('\n  FALL     what takes a storey off a bay, written on the walls directly\n');
    console.log('  ' + pad('the walls read', 32) + lp('storeys', 9) + lp('height', 9) + lp('shed', 7));
    for (const r of c.fall.rows)
      console.log('  ' + pad(r.name, 32) + lp(r.down, 9) + lp(r.was + ' to ' + r.now, 9) + lp(r.shed, 7));
    console.log('\n  and what it takes in rounds on one wall\n');
    console.log('  ' + pad('damage a round', 18) + lp('first storey', 14) + lp('second', 10));
    for (const r of c.fall.takes)
      console.log('  ' + pad(r.dmg, 18) + lp(r.first === null ? 'never' : r.first, 14) +
                  lp(r.second === null ? 'never' : r.second, 10));
  }

  if (c.debris) {
    const d = c.debris;
    console.log('\n  DEBRIS   the integrator against arithmetic older than the game\n');
    console.log('  ' + pad('a 197-unit fall takes', 30) + lp(d.land + ' s', 10) +
                '   sqrt(2h/g) says ' + d.fall + ', out by ' + d.err);
    console.log('  ' + pad('it bounces back to', 30) + lp(d.bounce, 10) +
                '   of the drop; restitution squared is ' + d.restit);
    console.log('  ' + pad('and is lying still by', 30) + lp(d.rest + ' s', 10) +
                (d.left ? '   ! ' + d.left + ' still moving' : ''));
    console.log('\n  ' + pad('one collapse sheds', 30) + lp(d.shed, 10) + '   chunks');
    console.log('  ' + pad('what settles on the building', 30) + lp(d.kept, 10) +
                '   of them, ' + d.inVol + ' of ' + d.outVol + ' units of stone');
    console.log('  ' + pad('the heap stands', 30) + lp(d.mound + ' u', 10) +
                '   over ' + d.cells + ' cells, capped at ' + d.cap);
  }

  if (c.world) {
    const w = c.world;
    console.log('\n  WORLD    the same cell in the middle of the same bay\n');
    console.log('  ' + pad('', 22) + lp('standing', 10) + lp('down', 8));
    console.log('  ' + pad('a man may walk here', 22) + lp(w.up.walk ? 'yes' : 'no', 10) + lp(w.down.walk ? 'yes' : 'no', 8));
    console.log('  ' + pad('it stops an eye', 22) + lp(w.up.sight ? 'yes' : 'no', 10) + lp(w.down.sight ? 'yes' : 'no', 8));
    console.log('  ' + pad('it stops a round', 22) + lp(w.up.fire ? 'yes' : 'no', 10) + lp(w.down.fire ? 'yes' : 'no', 8));
    console.log('  ' + pad('it is rubble', 22) + lp(w.up.rub ? 'yes' : 'no', 10) + lp(w.down.rub ? 'yes' : 'no', 8));
    console.log('  ' + pad('a section may hold it', 22) + lp(w.up.gar ? 'yes' : 'no', 10) + lp(w.down.gar ? 'yes' : 'no', 8));
    console.log('  ' + pad('costs a man', 22) + lp(w.up.man, 10) + lp(w.down.man, 8));
    console.log('  ' + pad('costs tracks', 22) + lp(w.up.track, 10) + lp(w.down.track, 8));
    console.log('\n  the house is ' + w.standing + ' units tall with everything down, and its own cover reads\n');
    console.log('  ' + pad('patch', 14) + lp('tier', 7) + lp('hp', 6) + lp('worth', 8));
    for (const p of w.cov) console.log('  ' + pad(p.kind, 14) + lp(p.type, 7) + lp(p.hp, 6) + lp(p.val, 8));
  }

  if (c.wall) {
    const w = c.wall;
    console.log('\n  WALL     a round against a run of masonry that is not a building\n');
    console.log('  ' + pad('damage', 8) + lp('wall', 7) + lp('run', 7) + lp('gaps', 7) + lp('wide', 7) + lp('stones', 8));
    for (const r of w.rows)
      console.log('  ' + pad(r.dmg, 8) + lp(r.h, 7) + lp(r.len, 7) + lp(r.gaps, 7) + lp(r.wide, 7) + lp(r.stones, 8));
    console.log('\n  ' + pad('a round over the top of it', 30) +
                (w.over ? '! cut ' + w.over + ' gaps' : 'takes nothing out of it'));
    console.log('\n  and the grids, on a ' + w.h + '-unit run ' + w.len + ' long\n');
    console.log('  ' + pad('', 22) + lp('standing', 10) + lp('down', 8));
    console.log('  ' + pad('it stops an eye', 22) + lp(w.up.sight ? 'yes' : 'no', 10) + lp(w.down.sight ? 'yes' : 'no', 8));
    console.log('  ' + pad('it stops a round', 22) + lp(w.up.fire ? 'yes' : 'no', 10) + lp(w.down.fire ? 'yes' : 'no', 8));
    console.log('  ' + pad('it is dear to cross', 22) + lp(w.up.wall ? 'yes' : 'no', 10) + lp(w.down.wall ? 'yes' : 'no', 8));
  }

  if (c.cost) {
    const k = c.cost;
    console.log('\n  COST\n');
    console.log('  ' + pad('recording one hit', 30) + lp(k.hit + ' ms', 10));
    console.log('  ' + pad('the tile the first one frees', 30) + lp(k.tile + ' ms', 10) +
                '   once a house, and queued a tile a frame');
    console.log('  (the two mesh times are the geometry alone: under SwiftShader a tile upload blocks.)');
    console.log('  ' + pad('re-meshing one bay of it', 30) + lp(k.rebuild + ' ms', 10) + '   what a round changes');
    console.log('  ' + pad('stepping ' + k.cap + ' chunks', 30) + lp(k.step + ' ms', 10) + '   a frame');
    console.log('  ' + pad('and their buffer', 30) + lp(k.buf + ' ms', 10) + '   a frame');
  }
  console.log();
}

const cur = await run(GAME, BASE ? 'working file' : null);
show(cur);
if (BASE) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-wreck-'));
  const f = path.join(tmp, 'ortona.html');
  fs.writeFileSync(f, execFileSync('git', ['show', `${BASE}:ortona.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  show(await run(f, 'BEFORE   ' + BASE));
  fs.rmSync(tmp, { recursive: true, force: true });
}
