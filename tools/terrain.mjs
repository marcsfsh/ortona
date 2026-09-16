/* The ground, mechanically.
 *
 * A photograph of ground is the one thing that looks fine whatever is wrong with it. Soft
 * and airbrushed reads as haze. Aliased reads as detail until the camera moves. Detail at
 * one fixed scale reads as noise up close and as a flat wash at range, and every one of
 * those is a picture somebody would call acceptable. So the ground is read off the
 * framebuffer instead: point the camera straight down at a patch of open ground, render,
 * and measure what is actually there.
 *
 *   node tools/terrain.mjs                 the card
 *   node tools/terrain.mjs grain           one section of it
 *   node tools/terrain.mjs --base=HEAD     the same card on an older file, side by side
 *
 * GRAIN is the root-mean-square contrast of the ground at four spatial scales, at three
 * camera distances. Fine structure is contrast that survives at full resolution and falls
 * away as the picture is boxed down; a wash is low contrast at every scale. The point of
 * the four columns is that one number cannot tell those apart -- an airbrushed ground and
 * a finely grained one have very nearly the same contrast once both are boxed down by
 * eight.
 *
 * SHIMMER is the level-of-detail measurement, and it is the reason this card exists at
 * all rather than a screenshot. The camera is moved a third of a pixel and the same patch
 * is read again: ground that is properly filtered and faded barely changes, and ground
 * whose detail is finer than the pixel it lands in changes a great deal. Aliasing is
 * invisible in a still and is the first thing anybody notices in motion.
 *
 * FACE is the same reading on a cut face rather than on open ground, and it is a
 * separate section because the two are sampled in different frames. The painted map is a
 * plan and nothing else, so on a slope it is stretched by one over the cosine and every
 * scale of grain on top of it was stretched with it: the coastal bluff, the wadi banks
 * and the wall of a trench all came out as broad smears. A face carries a fraction of the
 * fine contrast the flat ground beside it carries, and that fraction is the number.
 *
 * PAINT is what the albedo canvas carries before any of the shader's detail goes on top,
 * and whether it is mipmapped. A 2800 by 1900 texture with no mip chain is the whole of
 * the far-distance shimmer on its own.
 *
 * COST is ground triangles drawn and what the textures weigh.
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
const DISTS = [200, 500, 1200];

async function run(file, label) {
  const browser = await launch();
  const { page } = await openGame(browser, 'desktop', { file, quiet: true });
  await deploy(page, { side: 'us', diff: 1 });
  const out = await page.evaluate(({ DISTS, doGrain, doFace, doPaint, doCost }) => {
    const R = {};

    /* the camera has to get closer and look straighter down than a player can, because
       what is being measured is the texture and not the view */
    CAMLIM.dist = [40, 6000]; CAMLIM.pitch = [0.05, 1.5605];
    fog = false;
    /* open ground: flattest patch with nothing standing on it, so the numbers are the
       ground's and not a house's */
    function findField() {
      let best = null, bestDev = 1e9;
      /* clear for two hundred units every way, because the widest patch read is that
         across and a roof in the corner of it is not the ground */
      for (let y = 420; y < 1500; y += 40) for (let x = 500; x < 2300; x += 40) {
        let lo = 1e9, hi = -1e9, ok = true;
        for (let dx = -200; dx <= 200 && ok; dx += 25) for (let dy = -200; dy <= 200 && ok; dy += 25) {
          const z = groundZ(x + dx, y + dy);
          if (!walkable(x + dx, y + dy)) ok = false;
          const ci = cidx(((x + dx) / CELL) | 0, ((y + dy) / CELL) | 0);
          if (sblk[ci] || fblk[ci]) ok = false;
          if (z < lo) lo = z; if (z > hi) hi = z;
        }
        if (!ok) continue;
        if (hi - lo < bestDev) { bestDev = hi - lo; best = { x, y }; }
      }
      return best || { x: 1400, y: 950 };
    }
    const F = findField();

    /* a square of the framebuffer, straight down the middle, as luminance 0..1 */
    const N = 192;
    function shoot(x, y, dist) {
      /* CAM.tx/ty is what the camera looks AT; CAM.x/y is not the camera. Setting the
         wrong pair moved nothing, every distance read the same patch of whatever the
         game had left on screen, and the shimmer column came back at a clean nought
         three times over -- which reads as a perfectly filtered ground. */
      CAM.tx = x; CAM.ty = y; CAM.dist = dist; CAM.yaw = 0.7; CAM.pitch = 1.5605;
      render();
      const px = Math.round(cv.width / 2 - N / 2), py = Math.round(cv.height / 2 - N / 2);
      const b = new Uint8Array(N * N * 4);
      gl.readPixels(px, py, N, N, gl.RGBA, gl.UNSIGNED_BYTE, b);
      const l = new Float64Array(N * N);
      for (let i = 0; i < N * N; i++)
        l[i] = (b[i * 4] * 0.299 + b[i * 4 + 1] * 0.587 + b[i * 4 + 2] * 0.114) / 255;
      return l;
    }
    /* rms contrast of an image, and of the same image boxed down by 2, 4 and 8. Fine
       grain is contrast that is there at full size and gone by the time it is boxed;
       a wash has the same little contrast at every scale. */
    function contrasts(l, n) {
      const out = [];
      let cur = l, cn = n;
      for (let step = 0; step < 4; step++) {
        let s = 0, ss = 0;
        for (let i = 0; i < cn * cn; i++) { s += cur[i]; ss += cur[i] * cur[i]; }
        const m = s / (cn * cn);
        out.push(Math.sqrt(Math.max(0, ss / (cn * cn) - m * m)) / Math.max(1e-6, m));
        if (step === 3) break;
        const half = cn >> 1, nx = new Float64Array(half * half);
        for (let j = 0; j < half; j++) for (let i = 0; i < half; i++)
          nx[j * half + i] = (cur[(j * 2) * cn + i * 2] + cur[(j * 2) * cn + i * 2 + 1] +
                              cur[(j * 2 + 1) * cn + i * 2] + cur[(j * 2 + 1) * cn + i * 2 + 1]) / 4;
        cur = nx; cn = half;
      }
      return out;
    }

    /* The fine part of the contrast, taken directly rather than as the difference of
       two squares. sqrt(full^2 - boxed8^2) is right in principle and hopeless in
       practice once the two are close: on the wall of a shell hole the whole-patch
       contrast is 36 per cent and the boxed one 35, so the fine part is a difference of
       two large numbers and moves ten per cent on nothing. This boxes the image down by
       eight, puts it back up, subtracts, and takes the rms of what is left, which is the
       same quantity measured instead of inferred. */
    function fineRms(l, n) {
      const half = n >> 3, box = new Float64Array(half * half);
      for (let j = 0; j < half; j++) for (let i = 0; i < half; i++) {
        let s2 = 0;
        for (let b = 0; b < 8; b++) for (let a = 0; a < 8; a++) s2 += l[(j * 8 + b) * n + i * 8 + a];
        box[j * half + i] = s2 / 64;
      }
      let ss = 0, m = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const d = l[j * n + i] - box[Math.min(half - 1, j >> 3) * half + Math.min(half - 1, i >> 3)];
        ss += d * d; m += l[j * n + i];
      }
      m /= n * n;
      return Math.sqrt(ss / (n * n)) / Math.max(1e-6, m);
    }

    if (doGrain) {
      function shim(d) {
        const l = shoot(F.x, F.y, d);
        /* and again with the camera a third of a pixel over: what changes is what was
           never filtered down to the pixel it lands in */
        const perPx = (d * 1.1) / cv.height;
        const l2 = shoot(F.x + perPx * 0.33, F.y, d);
        let diff = 0, mean = 0;
        for (let i = 0; i < N * N; i++) { diff += Math.abs(l[i] - l2[i]); mean += l[i]; }
        mean /= N * N; diff /= N * N;
        return { l, s: diff / Math.max(1e-6, mean) };
      }
      R.grain = [];
      for (const d of DISTS) {
        const a = shim(d);
        /* and the same with the props taken out, because a rubble pile a pixel across
           aliases however well the ground is filtered and it is not the ground's fault.
           Measured, that is very nearly half the shimmer at twelve hundred units, and
           without splitting them no change to the terrain can be read at all. */
        const tiles = SCENE.tiles;
        SCENE.tiles = tiles.map(() => ({ props: { vbo: null, n: 0 }, leaves: { vbo: null, n: 0 } }));
        const b = shim(d);
        SCENE.tiles = tiles;
        R.grain.push({ d, c: contrasts(a.l, N), fine: fineRms(a.l, N), shimmer: a.s, ground: b.s });
      }
      R.at = F;
    }

    if (doFace) {
      /* A face of about twenty-five, forty-five and sixty-five degrees, whichever point
         on the map comes nearest each and is in the sun. Three rows rather than one,
         because the projection this measures is a blend of two and the shape of the
         answer is the point: a plan projection stretches a pattern on a face by one over
         the cosine and a vertical one by one over the sine, so the blend is a large win
         on a cut, about even at forty-five where both are out by root two, and a small
         loss either side of it. A card with one row at forty-five says the pass did
         nothing.

         Every point has to be in the sun, because the grain does most of its work
         through the normal and the sun term: a north face at twenty-one degrees of
         elevation is in its own shadow all day and reads the same whatever is done to
         it. And the square is read from seventy units up, which is fourteen units of
         ground, so it lands on the face and not on the crest above it -- the first
         version hunted for a hundred and twenty units of uniformly sloped ground,
         found none anywhere inland, and fell back to flat on every run. */
      const TARGETS = [0.466, 1.0, 1.428];                     /* tan 25, 45, 65 degrees */
      function faceAt(want) {
        let best = null, bd = 1e9;
        for (let y = 200; y < 1700; y += 8) for (let x = 200; x < 2600; x += 8) {
          const ci = cidx((x / CELL) | 0, (y / CELL) | 0);
          if (sblk[ci] || fblk[ci]) continue;
          const nv = groundNormal(x, y);
          if (nv.x * SUN.x + nv.y * SUN.y + nv.z * SUN.z < 0.35) continue;
          let lo = 9, hi = 0;
          for (let dx = -10; dx <= 10; dx += 10) for (let dy = -10; dy <= 10; dy += 10) {
            const gx = (groundZ(x + dx + 5, y + dy) - groundZ(x + dx - 5, y + dy)) / 10;
            const gy = (groundZ(x + dx, y + dy + 5) - groundZ(x + dx, y + dy - 5)) / 10;
            const g = Math.hypot(gx, gy);
            if (g < lo) lo = g; if (g > hi) hi = g;
          }
          if (hi > lo * 1.6 + 0.12) continue;                  /* the square is one face */
          const d = Math.abs((lo + hi) / 2 - want);
          if (d < bd) { bd = d; best = { x, y, sl: (lo + hi) / 2 }; }
        }
        return best;
      }
      const tiles = SCENE.tiles;
      const off = tiles.map(() => ({ props: { vbo: null, n: 0 }, leaves: { vbo: null, n: 0 } }));
      R.face = { rows: [] };
      SCENE.tiles = off;
      const lf = shoot(F.x, F.y, 70);
      const flatFine = fineRms(lf, N);
      SCENE.tiles = tiles;
      for (const want of TARGETS) {
        const P = faceAt(want);
        if (!P) { R.face.rows.push({ deg: Math.atan(want) * 180 / Math.PI, miss: true }); continue; }
        SCENE.tiles = off;
        const l = shoot(P.x, P.y, 70);
        const perPx = (70 * 1.1) / cv.height;
        const l2 = shoot(P.x + perPx * 0.33, P.y, 70);
        SCENE.tiles = tiles;
        let diff = 0, mean = 0;
        for (let i = 0; i < N * N; i++) { diff += Math.abs(l[i] - l2[i]); mean += l[i]; }
        R.face.rows.push({ deg: Math.atan(P.sl) * 180 / Math.PI, at: P, c: contrasts(l, N),
                           fine: fineRms(l, N), flatFine,
                           shimmer: diff / N / N / Math.max(1e-6, mean / N / N) });
      }
      R.face.flatFine = flatFine;
      R.face.flatAt = F;
    }

    if (doPaint) {
      /* the albedo canvas itself, sampled the same way */
      const cw = mbase ? mbase.width : 0, ch = mbase ? mbase.height : 0;
      let paint = null;
      if (mbase) {
        const s = document.createElement('canvas'); s.width = N; s.height = N;
        s.getContext('2d').drawImage(mbase, F.x - N / 2, F.y - N / 2, N, N, 0, 0, N, N);
        const d = s.getContext('2d').getImageData(0, 0, N, N).data;
        const l = new Float64Array(N * N);
        for (let i = 0; i < N * N; i++)
          l[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
        paint = contrasts(l, N);
      }
      /* is there a mip chain on it? a texture with none reports its level-0 size for
         every level, and WebGL will not say directly, so it is asked the only way that
         works: bind it and see whether the min filter was ever set to a mipmapped one */
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, TEX.albedo);
      const minf = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
      gl.bindTexture(gl.TEXTURE_2D, MATS.tex);
      const aminf = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
      gl.activeTexture(gl.TEXTURE0);
      const name = v => v === gl.LINEAR ? 'linear, no mips' : v === gl.NEAREST ? 'nearest' :
                        v === gl.LINEAR_MIPMAP_LINEAR ? 'trilinear' :
                        v === gl.LINEAR_MIPMAP_NEAREST ? 'linear, nearest mip' : String(v);
      R.paint = { w: cw, h: ch, unitsPerTexel: cw ? WORLD.w / cw : 0, c: paint,
                  albedoFilter: name(minf), atlasFilter: name(aminf) };
    }

    if (doCost) {
      let tris = 0;
      for (let i = 1; i < PT_N; i++) if (SCENE.ground[i]) tris += SCENE.ground[i].n / 3;
      R.cost = { groundTris: Math.round(tris), tileGrid: TG, heightGrid: HG,
                 albedoMB: mbase ? (mbase.width * mbase.height * 3) / 1048576 : 0,
                 atlasPx: MATS.TILE * MATS.COLS };
    }
    return R;
  }, { DISTS, doGrain: want('grain'), doFace: want('face'), doPaint: want('paint'), doCost: want('cost') });
  await browser.close();
  return { label, ...out };
}

function show(c) {
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  const pc = v => (v * 100).toFixed(1) + '%';
  if (c.label) console.log(`\n  ${c.label}`);
  if (c.grain) {
    console.log('\n  GRAIN    what is actually on the ground, straight down at ' +
                Math.round(c.at.x) + ',' + Math.round(c.at.y) + '\n');
    console.log('  ' + pad('camera', 10) + lpad('full', 9) + lpad('boxed 2', 9) +
                lpad('boxed 4', 9) + lpad('boxed 8', 9) + lpad('fine', 9) +
                lpad('shim gnd', 9) + lpad('shim all', 10));
    console.log('  ' + '-'.repeat(75));
    for (const g of c.grain) {
      /* the contrast that lives ABOVE the eight-pixel scale, which is the only column
         this pass can move: a whole-patch contrast is dominated by the painted macro
         drift and a doubling of the grain shifts it by a point or two. */
      const fine = g.fine;
      console.log('  ' + pad(g.d + 'u', 10) + g.c.map(v => lpad(pc(v), 9)).join('') +
                  lpad(pc(fine), 9) + lpad(pc(g.ground), 9) + lpad(pc(g.shimmer), 10));
    }
    console.log('\n  contrast is rms over the mean, so it is a share and not a level.');
    console.log('  fine is the part of it above the eight-pixel scale: whole-patch contrast');
    console.log('  is mostly the painted drift and barely moves whatever the grain does.');
    console.log('  shimmer is what a third of a pixel of camera movement changes: it is');
    console.log('  detail that was never filtered down to the pixel it lands in. `gnd` is the');
    console.log('  ground alone and `all` has the props in: a rubble pile a pixel across aliases');
    console.log('  however well the ground is filtered, and it is not the ground\'s fault.');
  }
  if (c.face) {
    const f = c.face;
    console.log('\n  FACE     three sunlit faces, read from seventy units up, against the open');
    console.log('           ground at ' + Math.round(f.flatAt.x) + ',' + Math.round(f.flatAt.y) +
                ' read the same way\n');
    console.log('  ' + pad('face', 10) + lpad('at', 14) + lpad('full', 9) + lpad('fine', 9) +
                lpad('flat fine', 11) + lpad('face/flat', 11) + lpad('shimmer', 10));
    console.log('  ' + '-'.repeat(74));
    for (const r of f.rows) {
      if (r.miss) { console.log('  ' + pad(r.deg.toFixed(0) + ' deg', 10) + '   nowhere on the map'); continue; }
      console.log('  ' + pad(r.deg.toFixed(0) + ' deg', 10) +
                  lpad(Math.round(r.at.x) + ',' + Math.round(r.at.y), 14) +
                  lpad(pc(r.c[0]), 9) + lpad(pc(r.fine), 9) + lpad(pc(r.flatFine), 11) +
                  lpad((r.fine / Math.max(1e-6, r.flatFine)).toFixed(2), 11) +
                  lpad(pc(r.shimmer), 10));
    }
    console.log('\n  the painted map is a plan and nothing else, so on a face it is stretched by');
    console.log('  one over the cosine and every scale of grain on top of it goes with it.');
    console.log('  face/flat is the share of the fine contrast a face carries against the open');
    console.log('  ground beside it, which is the one number a picture of a slope cannot give.');
  }
  if (c.paint) {
    const p = c.paint;
    console.log('\n  PAINT    the albedo canvas under all of it\n');
    console.log('  ' + pad('size', 22) + p.w + ' x ' + p.h + '   ' +
                p.unitsPerTexel.toFixed(2) + ' world units a texel');
    if (p.c) console.log('  ' + pad('its own contrast', 22) + p.c.map(v => lpad(pc(v), 9)).join(''));
    console.log('  ' + pad('albedo filter', 22) + p.albedoFilter);
    console.log('  ' + pad('atlas filter', 22) + p.atlasFilter);
  }
  if (c.cost) {
    const k = c.cost;
    console.log('\n  COST\n');
    console.log('  ' + pad('ground triangles', 22) + lpad(k.groundTris, 9));
    console.log('  ' + pad('mesh / height grid', 22) + lpad(k.tileGrid + ' / ' + k.heightGrid, 9) + '   units');
    console.log('  ' + pad('albedo texture', 22) + lpad(k.albedoMB.toFixed(1) + ' MB', 9));
    console.log('  ' + pad('atlas', 22) + lpad(k.atlasPx + ' px', 9));
  }
  console.log();
}

const cur = await run(GAME, BASE ? 'working file' : null);
show(cur);
if (BASE) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-terrain-'));
  const f = path.join(tmp, 'ortona.html');
  fs.writeFileSync(f, execFileSync('git', ['show', `${BASE}:ortona.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  show(await run(f, 'BEFORE   ' + BASE));
  fs.rmSync(tmp, { recursive: true, force: true });
}
