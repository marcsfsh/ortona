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
  const out = await page.evaluate(({ doShell, doFall, doDebris, doWorld, doWall, doCost, doHulk }) => {
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
    /* the frame, read rather than looked at */
    /* Three renders a grab, and that is not padding. `render()` refreshes the fog
       texture and uploads the decal canvas every THIRD frame, so two consecutive frames
       of a perfectly still scene differ by whichever of those happened to fall between
       them: the control came back at 35,063 pixels of a 1.44-million-pixel frame, which
       is larger than the thing being measured. Grabbing on the period puts the control
       where a control belongs. */
    function grab() {
      const w = cv.width, h = cv.height, px = new Uint8Array(w * h * 4);
      render(); render(); render();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    }
    function diffAll(a, b) {
      let hit = 0, n = a.length / 4;
      for (let i = 0; i < a.length; i += 4) {
        const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
        if (d > 6) hit++;
      }
      return hit;
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
    /* ---- HULK ---- */
    if (doHulk) {
      /* A dying vehicle is the one thing on this page a photograph is worst at. The
         effects round it were never in doubt -- a full burst, a real crater, two minutes
         of smoke and a fire that lights the street -- and the BODY never changed: the
         same hull buffer, standing level, drawn in a different colour. From above, at the
         distance a player looks from, a dark tank and a dead tank are the same picture.
           So the first row renders the two and counts the pixels between them, and the
         rest count what the body actually did. */
      const H = {};
      /* a corridor rather than a square: asked for 340 units of open ground every way,
         Ortona has nowhere that qualifies and the spot fell silently to the map's corner */
      let fx0 = 0, fy0 = 0, fOK = false;
      for (let ty = 400; ty < WORLD.h - 400 && !fOK; ty += 40)
        for (let tx = 400; tx < WORLD.w - 400 && !fOK; tx += 40) {
          let ok = true;
          for (let a = -190; a <= 190 && ok; a += 20)
            for (let b = -70; b <= 70 && ok; b += 20)
              if (!walkable(tx + a, ty + b)) ok = false;
          for (let a = -120; a <= 120 && ok; a += 20)
            for (let b = -60; b <= 60 && ok; b += 20)
              if (onRubble(tx + a, ty + b) || inWire(tx + a, ty + b) || inHogs(tx + a, ty + b)) ok = false;
          if (ok) { fx0 = tx; fy0 = ty; fOK = true; }
        }
      if (!fOK) { fx0 = WORLD.w / 2; fy0 = WORLD.h / 2; }
      H.spot = { x: fx0, y: fy0, found: fOK };
      function clear() {
        G.units.length = 0; G.wrecks.length = 0; G.debris.length = 0; G.rub.length = 0;
        G.fx.length = 0; G.corpses.length = 0; G.falls.length = 0; G.shots.length = 0;
        /* And the camera shake, which is the one thing here that is random per FRAME.
           A turret coming down hard adds one, `shake.t` is only wound down inside
           `frame()`, and nothing in a probe calls `frame()` -- so the camera jittered by
           a few pixels on every render for the rest of the run and the control of two
           identical frames came back at 37,737 pixels of 1.44 million. */
        shake.t = 0; shake.mag = 0;
        MND = null;
      }
      function reveal() {
        G.units.forEach(q => { q.vUs = q.vGer = true; });
        G.blds.forEach(q => { q.vUs = q.vGer = true; });
      }

      /* how far the body moved: the cant it settled at, how far it went down, and
         whether the turret is still on the hull it was bolted to */
      H.out = [];
      for (const key of ['us_sher', 'ger_tig', 'ger_stug', 'us_stuart']) {
        let off = 0, broke = 0, burn = 0, cant = 0, sink = 0, chunks = 0, n = 0;
        for (let i = 0; i < 40; i++) {
          clear();
          const u = spawnUnit(UNITS[key].side, key, fx0, fy0, 0);
          G.debris.length = 0;
          makeWreck(u);
          const w = G.wrecks[G.wrecks.length - 1];
          n++;
          if (w.blown) off++;
          else if (Math.abs(w.lean) > .15) broke++;
          else burn++;
          cant += Math.hypot(w.lean, w.nose) * 180 / Math.PI;
          sink += w.sink;
          chunks += G.debris.length;
        }
        H.out.push({ key, n, off, broke, burn, cant: +(cant / n).toFixed(1),
                     sink: +(sink / n).toFixed(1), chunks: +(chunks / n).toFixed(1) });
      }

      /* the mount in the air: how high, how far, how long, and that it stays where it
         lands rather than going on for ever or sinking through the ground */
      clear();
      {
        let tries = 0, w = null;
        while (tries++ < 60 && (!w || !w.fly)) {
          clear();
          const u = spawnUnit('us', 'us_sher', fx0, fy0, 0);
          makeWreck(u);
          w = G.wrecks[G.wrecks.length - 1];
        }
        if (w && w.fly) {
          const z0 = w.fly.z, x0 = w.fly.x, y0 = w.fly.y;
          let apex = z0, t = 0, spun = 0, la = w.fly.a;
          while (w.fly && t < 12) {
            stepHulk(w, 1 / 60); t += 1 / 60;
            if (w.fly) {
              if (w.fly.z > apex) apex = w.fly.z;
              let d = w.fly.a - la; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
              spun += Math.abs(d); la = w.fly.a;
            }
          }
          const rest = { x: w.tx, y: w.ty, z: w.tz };
          for (let i = 0; i < 240; i++) if (w.fly) stepHulk(w, 1 / 60);
          H.fly = { apex: +(apex - z0).toFixed(1), range: +Math.hypot(w.tx - x0, w.ty - y0).toFixed(1),
                    secs: +t.toFixed(2), spun: +spun.toFixed(1),
                    still: w.tx === rest.x && w.ty === rest.y && w.tz === rest.z,
                    onGround: +(w.tz - groundZ(w.tx, w.ty)).toFixed(1),
                    cover: coverAt(w.tx, w.ty) };
        }
      }

      /* the picture. One camera, one Sherman, rendered alive and then rendered dead, and
         the pixels between them counted -- against a control of the same live frame
         rendered twice, which is what says the number is the wreck and not the renderer. */
      clear();
      {
        const u = spawnUnit('us', 'us_sher', fx0, fy0, .7);
        CAM.tx = fx0; CAM.ty = fy0; CAM.dist = 240; CAM.yaw = 1.1; CAM.pitch = .62;
        reveal();
        /* and the frame is warmed before anything is measured. A camera moved to a new
           place takes a dozen frames to settle -- the fog texture is refreshed every
           third one and eases toward what it should be -- so the control of two
           "identical" frames came back at 41,975 pixels of 1.44 million, which is larger
           than the thing being measured. Warmed, it is nought. */
        for (let i = 0; i < 14; i++) render();
        const a1 = grab(), a2 = grab();
        const ctrl = diffAll(a1, a2);
        G.units.length = 0;
        makeWreck(u);
        /* the plate and the blast are cleared before the shutter: `makeWreck` throws its
           own burst when the mount comes off, and a fireball forty units across from a
           camera two hundred and fifty away covers most of the frame, so the row would be
           measuring the explosion rather than the body it exists to measure */
        G.debris.length = 0; G.fx.length = 0; G.shots.length = 0;
        shake.t = 0; shake.mag = 0;
        const w = G.wrecks[G.wrecks.length - 1];
        w.blown = true; w.fly = null;
        w.tx = fx0 + 46; w.ty = fy0 + 18; w.tz = groundZ(fx0 + 46, fy0 + 18) + 6;
        w.ta = 1.9; w.tLean = 1.4; w.tNose = .3;
        reveal();
        const b = grab();
        H.pic = { moved: diffAll(a1, b), ctrl };
      }
      clear();
      rebuildGrid();
      R.hulk = H;
    }
    return R;
  }, { doShell: want('shell'), doFall: want('fall'), doDebris: want('debris'),
       doWorld: want('world'), doWall: want('wall'), doCost: want('cost'), doHulk: want('hulk') });
  await browser.close();
  return { label, errors: log.errors, ...out };
}

const pad = (s, n) => String(s).padEnd(n);
const lp = (s, n) => String(s).padStart(n);

function show(c) {
  if (c.label) console.log(`\n  ${c.label}`);
  if (c.errors && c.errors.length) console.log('  ! ' + c.errors.length + ' console errors: ' + c.errors[0]);

  if (c.hulk) {
    const h = c.hulk;
    console.log('\n  HULK     what is left of a vehicle, and whether it is a different thing\n');
    console.log('  ' + pad('vehicle', 12) + lp('deaths', 8) + lp('turret off', 12) + lp('broken', 8) +
                lp('burnt', 8) + lp('cant', 8) + lp('sank', 7) + lp('plate', 8));
    for (const r of h.out)
      console.log('  ' + pad(r.key, 12) + lp(r.n, 8) + lp(r.off, 12) + lp(r.broke, 8) + lp(r.burn, 8) +
                  lp(r.cant + ' deg', 8) + lp(r.sink, 7) + lp(r.chunks, 8));
    if (h.fly)
      console.log('\n  ' + pad('a mount thrown off its ring', 30) + h.fly.apex + ' up, ' + h.fly.range +
                  ' out, down in ' + h.fly.secs + 's after ' + h.fly.spun + ' rad of tumble; ' +
                  (h.fly.still ? 'lies still' : '! still moving') + ', ' + h.fly.onGround +
                  ' off the ground, cover ' + h.fly.cover);
    if (h.spot && !h.spot.found) console.log('  ! no clear corridor on the map; drills staged at the middle of it');
    if (h.pic)
      console.log('  ' + pad('the same tank alive and dead', 30) + h.pic.moved +
                  ' pixels of the picture moved, against ' + h.pic.ctrl + ' between two live frames');
  }

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
