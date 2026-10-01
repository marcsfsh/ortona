/* Destruction, mechanically.
 *
 * A building coming down is the one change in this file that looks convincing whatever
 * is wrong underneath it. A hole in the wrong place is a hole. Stone that vanishes on
 * the way out is stone nobody counted. A storey that falls at the wrong rate falls. A
 * house that comes down on the second round instead of the eighteenth still comes down,
 * and the photograph of it is the same photograph. And the grids are worse than that: a
 * house knocked flat that still stops a boot and still stops an eye is a picture of
 * rubble laid over a building that is, as far as everything in the game is concerned,
 * exactly where it was.
 *
 *   node tools/wreck.mjs                 the card
 *   node tools/wreck.mjs shell           one section of it
 *   node tools/wreck.mjs --map=stlo      on another map
 *   node tools/wreck.mjs --base=HEAD     the same card on an older file, side by side
 *
 * SHELL is a round against the face of a house: how many cells it takes out, how wide and
 * how tall the hole is against the breach the burst says it should cut, what it cracks
 * round it, and whether the house is still a house three seconds later. Then the same
 * round further and further off the wall, one too far away to touch it, one with no
 * weight behind it, and one that came down through the roof against one that burst at
 * the face.
 *
 * STRUCTURE is what holds a building up, staged by taking cells out directly rather than
 * by shelling until something happens, because the question is what the structure does
 * and not how many rounds a particular wall takes: a doorway, a breach as wide as a shop
 * front, a whole storey of one face, of two faces, and every pier of the ground floor but
 * the corners. Underneath it, every building on the map cut and left alone, which has to
 * lose nothing, and what it costs in rounds of three weights to make a house a ruin.
 *
 * DEBRIS is the integrators against arithmetic that was true before the game was written.
 * A block and a whole storey dropped from a height fall in sqrt(2h/g) whatever the code
 * does; a block bounces to the square of its restitution; and both stop. The heap is the
 * other half: everything a collapse throws has to be lying on the ground or in the heap
 * afterwards, the heap has to be where the house was, and a man has to stand on it.
 *
 * WORLD is the part a screenshot cannot see at all. The same cell is asked the same
 * questions with the house standing and with the house down: can a man walk here, does it
 * stop an eye, does it stop a round, what does it cost to cross, and may a section hold it.
 *
 * WALL is the same question asked of an object rather than a building. A garden wall has
 * no structure and does not need one: it is a line, and what a shell does to it is take a
 * length out of the middle. What is checked is that the length comes out, that the stones
 * that were standing there are in the air, and that the three grids a wall is on stop
 * marking the piece that is no longer there.
 *
 * COST is what a cut, a hit, a solve, a frame of falling masonry and the heap are worth in
 * milliseconds.
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
const MAP = args.map ? String(args.map) : undefined;

async function run(file, label) {
  const browser = await launch();
  const { page, log } = await openGame(browser, 'desktop', { file, quiet: true });
  await deploy(page, { side: 'us', diff: 1, map: MAP });
  const out = await page.evaluate(({ doShell, doStruct, doDebris, doWorld, doWall, doCost, doHulk }) => {
    const R = {};

    /* A house on its own, so that nothing else on the map is in the burst and every
       number below belongs to the thing under test. It is put back between drills by
       forgetting everything the shelling wrote on it. */
    function pickHouse() {
      const c = G.props.filter(p => (p.kind === 'ruin' || p.kind === 'nhouse') && p.style !== 'church' &&
        p.style !== 'notredame' && Math.min(p.w, p.h) > 70 && frBreakable(p) &&
        !G.blds.some(b => Math.hypot(b.x - p.x, b.y - p.y) < 340) &&
        !G.props.some(q => q !== p && q.solid && q.kind !== 'sea' && Math.hypot(q.x - p.x, q.y - p.y) < 220));
      c.sort((a, b) => b.w * b.h - a.w * a.h);
      return c[0] || G.props.filter(p => p.kind === 'ruin' && frBreakable(p))[0];
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
      let hit = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
        if (d > 6) hit++;
      }
      return hit;
    }
    function reset(p) {
      if (p.fr) { freeBuffer(p.fr.buf); freeBuffer(p.fr.bufB); p.fr = null; }
      p.frNo = 0;
      if (p.hurt) { p.hurt = 0; const i = G.hurt.indexOf(p); if (i >= 0) G.hurt.splice(i, 1); }
      for (const b of G.fall) freeBuffer(b.buf);
      G.fall.length = 0; G.debris.length = 0; G.rub.length = 0; G.tileQ = {}; G.rubDirty = 2;
      MND = null; G.heapDirty = 1;
      G.frStat = { made: 0, bodies: 0, lost: 0 };
    }
    /* the simulation of what is falling and what gives, by hand: the battle is left out */
    function settle(secs) {
      let worst = 0;
      for (let s = 0; s < secs * 30; s++) {
        const t0 = performance.now();
        G.t += 1 / 30; stepDebris(1 / 30); frTick(1 / 30);
        worst = Math.max(worst, performance.now() - t0);
      }
      return worst;
    }
    function out(p) {
      const F = p.fr; if (!F) return 0;
      let n = 0;
      for (let i = 0; i < F.orig.length; i++) if (F.orig[i] && !F.alive[i]) n++;
      return n;
    }
    function left(p) { return p.fr ? p.fr.mAlive / p.fr.m0 : 1; }
    function rubVol() { let v = 0; for (const r of G.rub) v += r.l * r.w * r.h + (r.e || 0); return v; }
    /* the cells of the -y face (the wall a quarter of a cell inside the footprint's edge)
       between two x offsets off the middle and two heights off the ground */
    function faceCells(p, x0, x1, z0, z1) {
      const F = p.fr, L = [], y = p.y - p.h / 2 + 3;
      for (let x = p.x + x0 + FR_C / 2; x < p.x + x1; x += FR_C)
        for (let z = floorZ(x, y) + z0 + FR_Z / 2; z < floorZ(x, y) + z1; z += FR_Z) {
          const c = frCellAt(F, x, y, z);
          if (c >= 0 && F.alive[c]) L.push(c);
        }
      return L;
    }
    const P = pickHouse();
    R.house = { w: Math.round(P.w), h: Math.round(P.h), kind: P.kind, style: P.style || '', storeys: P.storeys || 0 };
    /* ---- SHELL ---- */
    if (doShell) {
      const p = P, rows = [], fy = p.y - p.h / 2;
      /* a mean over repeats and not one draw: the joints wander and the stones are thrown
         with jitter, so one round says nothing */
      const REP = 8;
      for (const dmg of [18, 40, 90, 150, 300, 380]) {
        const br = Math.min(70, Math.max(4, 3 + dmg * 0.075)), reach = Math.min(160, Math.max(16, 12 + dmg * 0.2));
        let cells = 0, crack = 0, wide = 0, tall = 0, stones = 0, after = 0, hold = 0, n = 0;
        for (let r = 0; r < REP; r++) {
          reset(p);
          explode(p.x + (r % 3 - 1) * 9, fy - 12, 80, dmg, null, null, 14);
          const F = p.fr;
          if (!F) continue;
          let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, k = 0, ck = 0;
          for (let c = 0; c < F.orig.length; c++) {
            if (!F.orig[c]) continue;
            if (!F.alive[c]) {
              const q = frCellC(F, c); k++;
              x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
            } else if (F.dmg[c] > 0) ck++;
          }
          n++; cells += k; crack += ck; stones += G.debris.length;
          if (k) { wide += x1 - x0 + FR_C; tall += z1 - z0 + FR_Z; }
          settle(3);
          after += 1 - left(p); hold += frHoldable(p) ? 1 : 0;
        }
        const d = n || 1;
        rows.push({ dmg, br: +br.toFixed(1), reach: Math.round(reach), cells: +(cells / d).toFixed(1),
                    crack: +(crack / d).toFixed(1), wide: +(wide / d).toFixed(1), tall: +(tall / d).toFixed(1),
                    stones: +(stones / d).toFixed(1), after: +(after / d * 100).toFixed(1), hold: hold + '/' + n });
      }
      /* the same round at a stand-off, because a shell in a town bursts where a man is
         standing and a man at a house stands a dozen units off its wall */
      const off = [];
      for (const d2 of [0, 8, 16, 26, 40, 60]) {
        let k = 0;
        for (let r = 0; r < 6; r++) { reset(p); explode(p.x + (r % 3 - 1) * 9, fy - 2 - d2, 80, 150, null, null, 14); k += out(p); }
        off.push({ d: d2, cells: +(k / 6).toFixed(1) });
      }
      /* a round too far off to touch this house, and one in the right place with no weight
         behind it; counted on this house and not on the debris list, because a neighbour's
         wall inside the same burst is a fair hit */
      reset(p);
      explode(p.x, fy - 140, 80, 300, null, null, 14);
      const far = { cut: p.fr ? 1 : 0, cells: out(p), hurt: p.hurt ? 1 : 0 };
      reset(p);
      explode(p.x, fy - 2, 60, 18, null, null, 14);
      const light = { cells: out(p) };
      /* and the 240's shell at the face against the same shell down through the roof,
         which bursts in a room */
      reset(p);
      explode(p.x, fy - 12, 150, 380, null, null, 14);
      const face = { cells: out(p), pct: +((1 - left(p)) * 100).toFixed(1) };
      reset(p);
      explode(p.x, p.y, 150, 380, null, null, 0);
      const roof = { cells: out(p), pct: +((1 - left(p)) * 100).toFixed(1) };
      reset(p);
      R.shell = { rows, off, far, light, face, roof, str: frSpec(p).str };
    }

    /* ---- STRUCTURE ---- */
    if (doStruct) {
      const p = P, rows = [];
      let hinged = 0;
      const ofb = frBody;
      frBody = function (pp, comp) {
        const n0 = G.fall.length;
        ofb(pp, comp);
        if (G.fall.length > n0 && G.fall[G.fall.length - 1].hinge) hinged++;
      };
      /* the cells are taken out directly, dropped where they stood, and the building is
         left to find out what that means */
      function stage(name, pick) {
        reset(p);
        frMake(p);
        const cells = pick(), F = p.fr;
        for (const c of cells) frKill(p, c, 2);
        F.dirty = 1; F.t = G.t;
        const b0 = G.frStat.bodies, h0 = hinged, staged = out(p);
        settle(9);
        rows.push({ name, staged, more: out(p) - staged, bodies: G.frStat.bodies - b0, hinged: hinged - h0,
                    left: +(left(p) * 100).toFixed(1), tall: Math.round(F.tall), hold: frHoldable(p) });
      }
      const half = p.w / 2;
      stage('nothing taken out', () => []);
      stage('a doorway, a cell wide', () => faceCells(p, -FR_C / 2, FR_C / 2, 0, 22));
      stage('a breach two cells wide', () => faceCells(p, -FR_C, FR_C, 0, 22));
      stage('a shop front, four cells', () => faceCells(p, -FR_C * 2, FR_C * 2, 0, 30));
      stage('a third of the face', () => faceCells(p, -p.w / 6, p.w / 6, 0, 33));
      stage('the ground storey of the face', () => faceCells(p, -half + FR_C, half - FR_C, 0, 33));
      stage('the whole face to the eaves', () => faceCells(p, -half, half, 0, 400));
      stage('every pier but the corners', () => {
        const F = p.fr, L = [];
        for (let c = 0; c < F.orig.length; c++) {
          if (!F.alive[c]) continue;
          const q = frCellC(F, c);
          if (q[2] - floorZ(q[0], q[1]) > 33) continue;
          const ex = Math.abs(q[0] - p.x) > p.w / 2 - FR_C * .75, ey = Math.abs(q[1] - p.y) > p.h / 2 - FR_C * .75;
          if ((ex || ey) && !(ex && ey)) L.push(c);
        }
        return L;
      });
      frBody = ofb;
      reset(p);

      /* every building on the map, cut and left alone: nothing may fall and nothing may give.
         The cut is timed without its buffer, for the reason the tile mesh is: under
         SwiftShader every third consecutive bufferData blocks for over a second, and a loop
         of fifty of them reported a two-and-a-half-second cut that was the rasteriser. */
      const all = G.props.filter(q => frBreakable(q)), gl0 = GLOK;
      GLOK = false;
      let built = 0, moved = 0, cellsN = 0, worst = 0, worstName = '', sum = 0, failed = 0, bad = [];
      for (const q of all) {
        const t0 = performance.now();
        if (!frMake(q)) { failed++; continue; }
        const ms = performance.now() - t0;
        sum += ms; built++;
        if (ms > worst) { worst = ms; worstName = q.kind + (q.style ? ':' + q.style : q.look ? ':' + q.look : ''); }
        const F = q.fr, m0 = F.mAlive;
        cellsN += F.orig.reduce((n, v) => n + v, 0);
        frStep(q);
        if (F.mAlive < m0 - 1e-3) { moved++; if (bad.length < 4) bad.push(q.kind + ':' + (q.style || q.look || '') + '@' + Math.round(q.x) + ',' + Math.round(q.y)); }
        reset(q);
      }
      GLOK = gl0;
      G.debris.length = 0; G.rub.length = 0; MND = null;

      /* and what it takes, which is the number a player feels: rounds into one house until
         it is no longer a house a section may hold */
      const takes = [];
      for (const dmg of [70, 150, 380]) {
        const res = {};
        for (const how of ['face', 'roof']) {
          let tot = 0, runs = 0;
          for (let r = 0; r < 2; r++) {
            reset(p);
            frMake(p);
            let n = 0;
            while (n < 60 && frHoldable(p)) {
              n++;
              if (how === 'face') {
                /* a round fired at the house strikes the first thing standing in its way,
                   so it is walked in from the street until it meets a cell */
                const F = p.fr, x = p.x + (Math.random() - .5) * p.w * .8, z = 14;
                let y = p.y - p.h / 2 - 40;
                while (F && y < p.y + p.h / 2 + 20) {
                  const c = frCellAt(F, x, y + 3, floorZ(x, y) + z);
                  if (c >= 0 && F.alive[c]) break;
                  y += 3;
                }
                explode(x, y - 2, 80, dmg, null, null, z);
              }
              else explode(p.x + (Math.random() - .5) * p.w * .8, p.y + (Math.random() - .5) * p.h * .8, 80, dmg, null, null, 0);
              settle(1.5);
            }
            tot += n; runs++;
          }
          res[how] = tot / runs >= 60 ? null : +(tot / runs).toFixed(1);
        }
        takes.push({ dmg, face: res.face, roof: res.roof });
      }
      reset(p);
      R.struct = { rows, all: all.length, built, failed, moved, bad, cells: cellsN, mean: +(sum / (built || 1)).toFixed(1),
                   worst: +worst.toFixed(1), worstName, takes, span: frSpec(p).span };
    }

    /* ---- DEBRIS ---- */
    if (doDebris) {
      const p = P;
      reset(p);
      /* a block let go from a known height over known ground. It falls in sqrt(2h/g)
         whatever the integrator does, which is the whole point of asking. */
      const gx = p.x + p.w, gy = p.y + 260, g0 = groundZ(gx, gy);
      const H = 200, dt = 1 / 60;
      G.debris.push({ x: gx, y: gy, z: g0 + H, l: 8, w: 4, h: 6, c: '#888', e: 0,
                      vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, rest: 0, t: 0 });
      let t = 0, land = null, peak = 0, landed = false;
      for (let i = 0; i < 1200 && G.debris.length; i++) {
        stepDebris(dt); t += dt;
        if (!landed && G.debris.length && G.debris[0].vz > 0) { landed = true; land = t; }
        if (landed && G.debris.length) peak = Math.max(peak, G.debris[0].z - g0 - 3);
      }
      const fall = Math.sqrt(2 * (H - 3) / 98), rest = t;

      /* a whole storey let go with nothing round it to hinge on: the top two courses of
         the house, with everything under them taken away without a stone */
      reset(p);
      frMake(p);
      const F = p.fr, NC = F.nx * F.ny, comp = [];
      let kTop = 0;
      for (let c = 0; c < F.orig.length; c++) if (F.alive[c]) kTop = Math.max(kTop, (c / NC) | 0);
      for (let c = 0; c < F.orig.length; c++) {
        if (!F.alive[c]) continue;
        if (((c / NC) | 0) >= kTop - 1) comp.push(c); else { F.alive[c] = 0; F.mAlive -= F.mass[c]; frZero(F, c); }
      }
      frTops(F);
      const n0 = G.fall.length;
      frBody(p, comp);
      frTops(F);
      let body = null;
      if (G.fall.length > n0) {
        const b = G.fall[G.fall.length - 1];
        let gmax = -1e9;
        for (let s = 0; s < 8; s++) {
          const lx = b.bb[s & 1 ? 1 : 0], ly = b.bb[s & 2 ? 3 : 2];
          gmax = Math.max(gmax, groundZ(b.x + lx, b.y + ly));
        }
        /* and not turning: the spin it is given at birth tips a corner down a few units
           over the fall and lands it early, which is right and not what is being asked */
        b.w = [0, 0, 0];
        const drop = b.z + b.bb[4] - gmax, hinge = !!b.hinge;
        let bt = 0;
        while (G.fall.indexOf(b) >= 0 && bt < 8) { frBodies(dt); bt += dt; }
        body = { drop: +drop.toFixed(1), took: +bt.toFixed(3), says: +Math.sqrt(2 * drop / 98).toFixed(3), hinge, cells: comp.length };
      }
      G.debris.length = 0;

      /* the heap: a house shelled down from above until nothing of it can be held, every
         stone left to land, and the stone counted */
      reset(p);
      let n = 0, worst = 0;
      while (n < 30 && frHoldable(p)) {
        n++;
        explode(p.x + (Math.random() - .5) * p.w * .7, p.y + (Math.random() - .5) * p.h * .7, 150, 380, null, null, 0);
        worst = Math.max(worst, settle(1.5));
      }
      worst = Math.max(worst, settle(14));
      let mound = 0, cells = 0, inFoot = 0, total = 0;
      if (MND) for (let i = 0; i < MND.length; i++) {
        if (MND[i] > .5) cells++;
        mound = Math.max(mound, MND[i]);
        const cx = ((i % MNDW) + .5) * MC, cy = (((i / MNDW) | 0) + .5) * MC;
        total += MND[i];
        if (Math.abs(cx - p.x) < p.w / 2 + 28 && Math.abs(cy - p.y) < p.h / 2 + 28) inFoot += MND[i];
      }
      let stand = 0;
      for (let dx = -p.w / 2; dx <= p.w / 2; dx += 7) for (let dy = -p.h / 2; dy <= p.h / 2; dy += 7)
        stand = Math.max(stand, groundZ(p.x + dx, p.y + dy) - floorZ(p.x + dx, p.y + dy));
      R.debris = { fall: +fall.toFixed(3), land: land === null ? null : +land.toFixed(3),
                   err: land === null ? null : +Math.abs(land - fall).toFixed(3),
                   bounce: +(peak / (H - 3)).toFixed(4), restit: 0.2 * 0.2, rest: +rest.toFixed(1),
                   body, rounds: n, air: G.debris.length, falling: G.fall.length, settled: G.rub.length,
                   made: Math.round(G.frStat.made), lying: Math.round(rubVol()), lost: Math.round(G.frStat.lost),
                   bodies: G.frStat.bodies, mound: +mound.toFixed(1), cells, cap: MCAP,
                   inFoot: total ? +(inFoot / total).toFixed(2) : 0, stand: +stand.toFixed(1), worst: +worst.toFixed(1),
                   ring: rubCap() };
      reset(p);
      rebuildGrid();
    }

    /* ---- WORLD ---- */
    if (doWorld) {
      const p = P;
      reset(p);
      rebuildGrid();
      const qx = p.x, qy = p.y;
      /* asked at the cell, not through the thing under test */
      function ask() {
        const ci = cidx((qx / CELL) | 0, (qy / CELL) | 0);
        return { walk: walkable(qx, qy) ? 1 : 0,
                 sight: sblk[ci] ? 1 : 0, fire: fblk[ci] ? 1 : 0, rub: rubg[ci] ? 1 : 0,
                 man: +cellCost(ci, 0, null, 0).toFixed(2),
                 track: +cellCost(ci, 1, null, 0).toFixed(2),
                 gar: canGarrison({ cat: 'inf', def: { speed: 30 }, models: [] }, p) ? 1 : 0,
                 heap: +(groundZ(qx, qy) - floorZ(qx, qy)).toFixed(1) };
      }
      const up = ask();
      let n = 0;
      while (n < 30 && frHoldable(p)) {
        n++;
        explode(p.x + (Math.random() - .5) * p.w * .7, p.y + (Math.random() - .5) * p.h * .7, 150, 380, null, null, 0);
        settle(1.5);
      }
      settle(12);
      rebuildGrid();
      const down = ask();
      /* and the house's own cover, which was four heavy patches lying along four walls */
      const near = coversNear(p.x, p.y, Math.max(p.w, p.h) * 0.6)
        .filter(c => Math.abs(c.x - p.x) <= p.w / 2 + 16 && Math.abs(c.y - p.y) <= p.h / 2 + 16);
      const cov = near.map(c => ({ kind: c.kind, type: c.type, hp: c.hp, val: coverValue(c, Math.PI / 2) }));
      const standing = Math.round(ruinStanding(p)), rounds = n;
      reset(p);
      rebuildGrid();
      R.world = { up, down, cov, standing, rounds };
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
      const p = P;
      /* the cut, which is paid once a building, the first time a round reaches it */
      const gl0 = GLOK;
      GLOK = false;
      let t0 = performance.now();
      for (let i = 0; i < 5; i++) { reset(p); frMake(p); }
      const cut = (performance.now() - t0) / 5;
      GLOK = gl0;
      reset(p); frMake(p);
      const verts = p.fr ? p.fr.A.length / 12 : 0, cellsN = p.fr ? p.fr.orig.reduce((n, v) => n + v, 0) : 0;
      /* what one solve of it is, which is what every round that changes it costs */
      t0 = performance.now();
      for (let i = 0; i < 20; i++) frSolve(p.fr);
      const solve = (performance.now() - t0) / 20;
      /* a round against the cut house, without the stones: what every round after the
         first costs at the moment it lands */
      let hit = 0, hn = 0;
      for (let r = 0; r < 4; r++) {
        reset(p); frMake(p);
        for (let i = 0; i < 10; i++) {
          t0 = performance.now();
          explode(p.x + (i % 5 - 2) * 14, p.y - p.h / 2 - 12, 80, 90, null, null, 14);
          hit += performance.now() - t0; hn++;
          G.debris.length = 0;
        }
      }
      hit /= hn;
      /* And the tile the first one has to re-mesh, which is the hitch worth knowing about
         and the reason it is queued rather than done inside the burst. It is the MESH
         that is timed and not `buildTile`: under SwiftShader every third consecutive
         bufferData of a tile blocks for over a second, so a loop of whole tile rebuilds
         reports two and a half seconds and reports it about the rasteriser. */
      const ti = tileOf(p.x, p.y);
      t0 = performance.now();
      for (let i = 0; i < 4; i++) sceneProps(ti);
      const tile = (performance.now() - t0) / 4;
      /* the worst frame of a house coming down, and the heap's mesh after it */
      reset(p);
      let n = 0, worst = 0;
      while (n < 30 && frHoldable(p)) {
        n++;
        explode(p.x + (Math.random() - .5) * p.w * .7, p.y + (Math.random() - .5) * p.h * .7, 150, 380, null, null, 0);
        worst = Math.max(worst, settle(1.5));
      }
      worst = Math.max(worst, settle(10));
      t0 = performance.now();
      for (let i = 0; i < 5; i++) buildHeapBuf();
      const heap = (performance.now() - t0) / 5, heapV = HEAPBUF ? HEAPBUF.n : 0;
      t0 = performance.now();
      G.rubDirty = 2; buildRubBuf();
      const ring = performance.now() - t0, ringN = G.rub.length;
      /* a frame with the cap of masonry in the air: the integrator and the buffer it has
         to remake, which is the one buffer in the file rebuilt whole while the game runs */
      G.debris.length = 0;
      const cap = debrisCap();
      for (let i = 0; i < cap; i++)
        G.debris.push({ x: p.x + (i % 10) * 6, y: p.y + ((i / 10) | 0) * 6, z: groundZ(p.x, p.y) + 200,
                        l: 9, w: 4.5, h: 6, c: '#888', e: 0, vx: 3, vy: 3, vz: 20,
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
      R.cost = { cut: +cut.toFixed(1), verts, cells: cellsN, solve: +solve.toFixed(2), hit: +hit.toFixed(2),
                 tile: +tile.toFixed(1), worst: +worst.toFixed(1), heap: +heap.toFixed(2), heapV,
                 ring: +ring.toFixed(1), ringN, step: +step.toFixed(3), buf: +buf.toFixed(2), cap };
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
      for (const key of ['am_sher', 'ger_tig', 'ger_stug', 'am_stuart']) {
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
          const u = spawnUnit('us', 'am_sher', fx0, fy0, 0);
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
        const u = spawnUnit('us', 'am_sher', fx0, fy0, .7);
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
  }, { doShell: want('shell'), doStruct: want('structure') || want('struct'), doDebris: want('debris'),
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

  if (c.house) console.log(`\n  the house under test: ${c.house.w} x ${c.house.h} ${c.house.kind}${c.house.style ? ' (' + c.house.style + ')' : ''}` +
                           (c.house.storeys ? `, ${c.house.storeys} storeys` : ''));
  if (c.shell) {
    const s = c.shell;
    console.log(`\n  SHELL    a round twelve units off the face, cells taken out (stone of strength ${s.str})\n`);
    console.log('  ' + pad('damage', 8) + lp('breach', 8) + lp('reach', 7) + lp('cells', 7) + lp('cracked', 9) +
                lp('wide', 7) + lp('tall', 7) + lp('stones', 8) + lp('then', 7) + lp('holds', 7));
    for (const r of s.rows)
      console.log('  ' + pad(r.dmg, 8) + lp(r.br, 8) + lp(r.reach, 7) + lp(r.cells, 7) + lp(r.crack, 9) +
                  lp(r.wide, 7) + lp(r.tall, 7) + lp(r.stones, 8) + lp(r.after + '%', 7) + lp(r.hold, 7));
    console.log('\n  `then` is how much of the house was gone three seconds after the round, with whatever it');
    console.log('  started still giving; a breach is the hole a burst against the wall cuts, before the');
    console.log('  stone\'s strength divides it. Eight rounds a row.');
    console.log('\n  a 150-point round bursting short of the wall\n');
    console.log('  ' + pad('units off it', 16) + lp('cells', 8));
    for (const o of s.off) console.log('  ' + pad(o.d, 16) + lp(o.cells, 8));
    console.log('\n  ' + pad('a round 140 off the wall', 30) +
                (s.far.cells || s.far.hurt ? '! took ' + s.far.cells + ' cells out of it' : 'takes nothing out of it'));
    console.log('  ' + pad('an 18-point round on it', 30) + (s.light.cells ? '! took ' + s.light.cells + ' cells' : 'takes nothing out of it'));
    console.log('  ' + pad('the 240 against the face', 30) + s.face.cells + ' cells, ' + s.face.pct + '% of the house');
    console.log('  ' + pad('the 240 down through the roof', 30) + s.roof.cells + ' cells, ' + s.roof.pct + '% of the house');
  }

  if (c.struct) {
    const s = c.struct;
    console.log(`\n  STRUCTURE  cells taken out of the -y face directly, and what the house does about it (span ${s.span})\n`);
    console.log('  ' + pad('taken out', 32) + lp('cells', 7) + lp('then', 7) + lp('pieces', 8) + lp('hinged', 8) +
                lp('left', 8) + lp('tall', 6) + lp('holds', 7));
    for (const r of s.rows)
      console.log('  ' + pad(r.name, 32) + lp(r.staged, 7) + lp(r.more, 7) + lp(r.bodies, 8) + lp(r.hinged, 8) +
                  lp(r.left + '%', 8) + lp(r.tall, 6) + lp(r.hold ? 'yes' : 'no', 7));
    console.log('\n  `then` is the cells that went after the ones taken out, by falling or by being crushed;');
    console.log('  `pieces` the ones that fell as one body, and `hinged` those that swung on a joint first.');
    console.log(`\n  ${s.built} of ${s.all} buildings on the map cut into ${s.cells} cells` +
                (s.failed ? ` (${s.failed} had nothing to cut)` : '') + `, ${s.mean} ms each and ${s.worst} ms for the` +
                ` slowest (${s.worstName});`);
    console.log('  ' + (s.moved ? `! ${s.moved} lost something standing with nothing done to them: ${s.bad.join(', ')}`
                                : 'not one of them loses a stone with nothing done to it'));
    console.log('\n  and what it takes in rounds to make it a house nobody can hold\n');
    console.log('  ' + pad('damage a round', 18) + lp('at the face', 13) + lp('through the roof', 18));
    for (const r of s.takes)
      console.log('  ' + pad(r.dmg, 18) + lp(r.face === null ? 'never' : r.face, 13) + lp(r.roof === null ? 'never' : r.roof, 18));
  }

  if (c.debris) {
    const d = c.debris;
    console.log('\n  DEBRIS   the integrators against arithmetic older than the game\n');
    console.log('  ' + pad('a 197-unit fall takes', 30) + lp(d.land + ' s', 10) + '   sqrt(2h/g) says ' + d.fall + ', out by ' + d.err);
    console.log('  ' + pad('it bounces back to', 30) + lp(d.bounce, 10) + '   of the drop; restitution squared is ' + d.restit);
    console.log('  ' + pad('and is lying still by', 30) + lp(d.rest + ' s', 10));
    if (d.body)
      console.log('  ' + pad('a storey of ' + d.body.cells + ' cells drops', 30) + lp(d.body.drop + ' u', 10) + '   in ' + d.body.took +
                  ' s against ' + d.body.says + (d.body.hinge ? ' (! it hinged)' : ''));
    else console.log('  ! the storey drill made no body');
    console.log('\n  ' + pad('a house shelled down in', 30) + lp(d.rounds, 10) + '   rounds of the 240 through the roof');
    console.log('  ' + pad('pieces that fell whole', 30) + lp(d.bodies, 10));
    console.log('  ' + pad('stone thrown', 30) + lp(d.made, 10) + '   units');
    console.log('  ' + pad('lying, in blocks and fill', 30) + lp(d.lying, 10) + '   and ' + d.lost + ' let go by the ring of ' + d.ring +
                ' or into a house nothing has hit' + (d.air || d.falling ? `; ! ${d.air} stones and ${d.falling} pieces still moving` : ''));
    console.log('  ' + pad('the heap stands', 30) + lp(d.mound + ' u', 10) + '   over ' + d.cells + ' cells, capped at ' + d.cap +
                '; ' + Math.round(d.inFoot * 100) + '% of it on the house');
    console.log('  ' + pad('a man on it stands', 30) + lp(d.stand + ' u', 10) + '   over the floor at the top of it');
    console.log('  ' + pad('the worst frame of it', 30) + lp(d.worst + ' ms', 10));
  }

  if (c.world) {
    const w = c.world;
    console.log(`\n  WORLD    the same cell in the middle of the house, standing and after ${w.rounds} heavy rounds\n`);
    console.log('  ' + pad('', 22) + lp('standing', 10) + lp('down', 8));
    console.log('  ' + pad('a man may walk here', 22) + lp(w.up.walk ? 'yes' : 'no', 10) + lp(w.down.walk ? 'yes' : 'no', 8));
    console.log('  ' + pad('it stops an eye', 22) + lp(w.up.sight ? 'yes' : 'no', 10) + lp(w.down.sight ? 'yes' : 'no', 8));
    console.log('  ' + pad('it stops a round', 22) + lp(w.up.fire ? 'yes' : 'no', 10) + lp(w.down.fire ? 'yes' : 'no', 8));
    console.log('  ' + pad('it is rubble', 22) + lp(w.up.rub ? 'yes' : 'no', 10) + lp(w.down.rub ? 'yes' : 'no', 8));
    console.log('  ' + pad('a section may hold it', 22) + lp(w.up.gar ? 'yes' : 'no', 10) + lp(w.down.gar ? 'yes' : 'no', 8));
    console.log('  ' + pad('costs a man', 22) + lp(w.up.man, 10) + lp(w.down.man, 8));
    console.log('  ' + pad('costs tracks', 22) + lp(w.up.track, 10) + lp(w.down.track, 8));
    console.log('  ' + pad('heap under his feet', 22) + lp(w.up.heap, 10) + lp(w.down.heap, 8));
    console.log('\n  the house is ' + w.standing + ' units tall at the end, and its own cover reads\n');
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
    console.log('  ' + pad('cutting the house', 32) + lp(k.cut + ' ms', 10) + `   once, into ${k.cells} cells and ${k.verts} vertices, buffer aside`);
    console.log('  ' + pad('one solve of its structure', 32) + lp(k.solve + ' ms', 10) + '   each time a round changes it');
    console.log('  ' + pad('a round against it', 32) + lp(k.hit + ' ms', 10) + '   the blast through the cells, stones aside');
    console.log('  ' + pad('the tile the first one frees', 32) + lp(k.tile + ' ms', 10) + '   once a building, queued a tile a frame');
    console.log('  (the mesh times are the geometry alone: under SwiftShader a tile upload blocks.)');
    console.log('  ' + pad('the worst frame of it coming down', 32) + lp(k.worst + ' ms', 10) + '   stones, pieces and the solve');
    console.log('  ' + pad('the heap\'s mesh', 32) + lp(k.heap + ' ms', 10) + `   ${k.heapV} vertices, a few times a second while it grows`);
    console.log('  ' + pad('the ring repacked whole', 32) + lp(k.ring + ' ms', 10) + `   ${k.ringN} blocks, which only a reset asks for`);
    console.log('  ' + pad('stepping ' + k.cap + ' stones', 32) + lp(k.step + ' ms', 10) + '   a frame');
    console.log('  ' + pad('and their buffer', 32) + lp(k.buf + ' ms', 10) + '   a frame');
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
