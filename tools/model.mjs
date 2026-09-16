/* The models, mechanically.
 *
 * A vehicle is judged by looking at it, and that is right for proportion, for paint and
 * for whether a fitting is on the correct side. It is no use at all for the occlusion
 * baked into it, because the bake is arithmetic over a grid and every way of getting it
 * wrong produces a picture that is plausible: too strong and the tank is a darker tank,
 * too weak and nothing happened, self-occluding and every surface is shaded evenly,
 * stepping over a wall and the joint beside the wall comes back open. All five of those
 * were shipped into the working file in one afternoon and the photographs told me
 * nothing, because a shaded slab and an unshaded slab both look like a slab.
 *
 *   node tools/model.mjs                 the card
 *   node tools/model.mjs bake            one section of it
 *   node tools/model.mjs --base=HEAD     the same card on an older file, side by side
 *
 * BAKE puts the bake against shapes whose answer is known before it is run. A plate
 * alone in the sky is not occluded by anything and has to read 1. A deck two hundred
 * units wide is not occluded in the middle of it. The foot of a wall standing on that
 * deck is, and so is the deck at the foot of the wall, and the inside of a corner is
 * darker than either. Those are facts about shapes rather than judgements about tanks,
 * and every one of the five faults above breaks at least one of them.
 *
 * COST is what it costs at boot, because the bake is a march over a grid at every vertex
 * of every vehicle and there are six hundred thousand of them. The number that matters
 * is how many marches the quantised cache saves: occlusion varies over the width of a
 * joint and no faster, so asking at every face-vertex asks the same question a dozen
 * times.
 *
 * SIZE is faces and vertices per vehicle, because `aoSplit` cuts the big plates and a
 * detail pass that quietly trebles the roster is a detail pass that does not run.
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
  const { page } = await openGame(browser, 'desktop', { file, quiet: true });
  await deploy(page, { side: 'us', diff: 1 });
  const out = await page.evaluate(({ doBake, doCost, doSize }) => {
    const R = {};

    /* ---- BAKE: shapes whose answer is known ---- */
    if (doBake) {
      /* the bake reads and writes the face lists it is given, so each drill builds its
         own and nothing here can touch the roster */
      function bake(lists) {
        const parts = lists.map(f => ({ f: aoSplit(f, AOSPLIT), x: 0, y: 0, z: 0, occ: 1 }));
        bakeAO(parts);
        return parts.map(p => p.f);
      }
      /* the mean baked factor over the vertices a test picks out; 1 is unoccluded */
      function mean(faces, pick) {
        let n = 0, s = 0;
        for (const f of faces) {
          if (!f.ao) continue;
          const fn = faceNormal(f.v[0], f.v[1], f.v[2]);
          for (let i = 0; i < f.ao.length; i++) {
            if (!pick(fn, f.v[i])) continue;
            n++; s += f.ao[i];
          }
        }
        return n ? { n, v: s / n } : { n: 0, v: null };
      }
      /* the vertex NEAREST a named place rather than every vertex in a window. Occlusion
         at the foot of a wall falls away over a foot or two, so a window a dozen units
         wide averages the joint together with the open deck beyond it and reports the
         joint as open -- which is what the first version of this card did, and it sent
         me looking for a bug in a bake that was answering correctly. */
      function nearest(faces, pick, to) {
        let best = null, bd = 1e9;
        for (const f of faces) {
          if (!f.ao) continue;
          const fn = faceNormal(f.v[0], f.v[1], f.v[2]);
          for (let i = 0; i < f.ao.length; i++) {
            const p = f.v[i];
            if (!pick(fn, p)) continue;
            const d = Math.hypot(p[0] - to[0], p[1] - to[1], p[2] - to[2]);
            if (d < bd) { bd = d; best = f.ao[i]; }
          }
        }
        return best === null ? { n: 0, v: null } : { n: 1, v: best, d: bd };
      }
      const rows = [];
      function row(name, got, test, says) { rows.push({ name, n: got.n, v: got.v, ok: got.n > 0 && test(got.v), says }); }

      /* 1. a plate alone: nothing can shade it but itself, and it must not */
      let [pl] = bake([box(0, 0, 0, 200, 200, 8, '#808080')]);
      row('a plate alone in the sky', mean(pl, (fn, p) => fn.z > .9 && Math.abs(p[0]) < 60 && Math.abs(p[1]) < 60),
          v => v > .985, 'must be 1: anything less is the march finding the plate it stands on');

      /* 2. a deck with a block on it: away from the block, at its foot, and up its side */
      const [deck, blk] = bake([box(0, 0, 0, 200, 100, 16, '#808080'), box(0, 0, 16, 60, 50, 30, '#808080')]);
      row('that deck, well away from it', mean(deck, (fn, p) => fn.z > .9 && Math.abs(p[0]) > 78),
          v => v > .985, 'must be 1: eighty units is not a joint');
      row('that deck, at the block\'s foot', nearest(deck, (fn, p) => fn.z > .9 && p[0] > 30, [31, 0, 16]),
          v => v < .9, 'must be shaded: a block standing on a deck shades the deck');
      row('the block, at its own foot', mean(blk, (fn, p) => Math.abs(fn.x) > .9 && p[2] < 22),
          v => v < .85, 'must be shaded: the deck shades the foot of what stands on it');
      row('the block, at the top of it', mean(blk, (fn, p) => Math.abs(fn.x) > .9 && p[2] > 38),
          v => v > .97, 'must be near 1: the top of a block sees the sky');

      /* 3. the inside of a corner, which is the darkest thing a vehicle has */
      const [fl2, w1, w2] = bake([box(0, 0, 0, 160, 160, 8, '#808080'),
                                  box(-76, 0, 8, 8, 160, 60, '#808080'),
                                  box(0, -76, 8, 160, 8, 60, '#808080')]);
      row('the floor of a corner', mean(fl2, (fn, p) => fn.z > .9 && p[0] < -50 && p[1] < -50),
          v => v < .7, 'must be dark: two walls and a floor is the worst case on a model');
      row('that floor, out in the open', mean(fl2, (fn, p) => fn.z > .9 && p[0] > 30 && p[1] > 30),
          v => v > .97, 'must be near 1, or the corner is only a darker floor');

      /* 4. and a wall one cell thick, which the march has to see and not step over */
      const [gnd, thin] = bake([box(0, 0, 0, 200, 100, 8, '#808080'), box(0, 0, 8, 4, 100, 40, '#808080')]);
      row('a deck beside a plate 4 thick', nearest(gnd, (fn, p) => fn.z > .9 && p[0] > 2, [3, 0, 8]),
          v => v < .92, 'must be shaded: a step of a whole cell walks through a wall of one');
      R.bake = rows;
    }

    /* ---- COST ---- */
    if (doCost) {
      AOSTAT.marched = 0;
      const t0 = performance.now();
      buildVehicleModels();
      const t1 = performance.now();
      let verts = 0;
      for (const k in VMODEL) {
        const vm = VMODEL[k];
        for (const part of ['hull', 'tur', 'mg', 'skirts', 'turSkirts'])
          if (vm[part]) for (const f of vm[part]) verts += f.v.length;
      }
      R.cost = { ms: t1 - t0, verts, marched: AOSTAT.marched, dirs: AODIR.length, cell: AOC, split: AOSPLIT };
    }

    /* ---- SIZE ---- */
    if (doSize) {
      const rows = [];
      for (const k in VMODEL) {
        const vm = VMODEL[k];
        let f = 0, v = 0;
        for (const part of ['hull', 'tur', 'mg', 'skirts', 'turSkirts'])
          if (vm[part]) { f += vm[part].length; for (const q of vm[part]) v += q.v.length; }
        rows.push({ k, f, v });
      }
      rows.sort((a, b) => b.v - a.v);
      R.size = rows;
    }
    return R;
  }, { doBake: want('bake'), doCost: want('cost'), doSize: want('size') });
  await browser.close();
  return { label, ...out };
}

function show(c) {
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  if (c.label) console.log(`\n  ${c.label}`);
  if (c.bake) {
    console.log('\n  BAKE     the occlusion bake against shapes whose answer is known\n');
    let bad = 0;
    for (const r of c.bake) {
      if (!r.ok) bad++;
      console.log('  ' + (r.ok ? '    ' : '  ! ') + pad(r.name, 32) +
                  lpad(r.n ? r.v.toFixed(3) : 'no verts', 9) + '   ' + (r.ok ? '' : r.says));
    }
    console.log('\n  ' + (bad ? `${bad} of ${c.bake.length} wrong` : `all ${c.bake.length} right`) +
                '.  1.000 is a surface that can see the whole sky.');
  }
  if (c.cost) {
    const k = c.cost;
    console.log('\n  COST\n');
    console.log('  ' + pad('every vehicle built', 26) + lpad(k.ms.toFixed(0) + ' ms', 10));
    console.log('  ' + pad('face-vertices', 26) + lpad(k.verts, 10));
    console.log('  ' + pad('marches run', 26) + lpad(k.marched, 10) +
                '   one in ' + (k.verts / Math.max(1, k.marched)).toFixed(1) + ', the rest cached');
    console.log('  ' + pad('rays a march', 26) + lpad(k.dirs, 10));
    console.log('  ' + pad('grid cell / split', 26) + lpad(k.cell + ' / ' + k.split, 10) + '   model units');
  }
  if (c.size) {
    console.log('\n  SIZE     what is in each of them\n');
    console.log('  ' + pad('vehicle', 14) + lpad('faces', 8) + lpad('verts', 10));
    let f = 0, v = 0;
    for (const r of c.size) { console.log('  ' + pad(r.k, 14) + lpad(r.f, 8) + lpad(r.v, 10)); f += r.f; v += r.v; }
    console.log('  ' + pad('', 14) + lpad(f, 8) + lpad(v, 10));
  }
  console.log();
}

const cur = await run(GAME, BASE ? 'working file' : null);
show(cur);
if (BASE) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-model-'));
  const f = path.join(tmp, 'ortona.html');
  fs.writeFileSync(f, execFileSync('git', ['show', `${BASE}:ortona.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  show(await run(f, 'BEFORE   ' + BASE));
  fs.rmSync(tmp, { recursive: true, force: true });
}
