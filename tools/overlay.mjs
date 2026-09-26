#!/usr/bin/env node
/* Lay a model over its reference drawing.
 *
 *   node tools/overlay.mjs --grid shots/ref/hr_251.jpg              the drawing with a pixel grid
 *   node tools/overlay.mjs --grid shots/ref/hr_251.jpg --crop=0,0,500,200 --k=3
 *   node tools/overlay.mjs tools/ref/hr_251.json                    every view in the spec
 *   node tools/overlay.mjs tools/ref/hr_251.json --only=side,plan   some of them
 *   node tools/overlay.mjs tools/ref/hr_251.json --grid             with the pixel grid on top
 *   node tools/overlay.mjs tools/ref/hr_251.json --file=/tmp/x.html an older file
 *   node tools/overlay.mjs tools/ref/hr_251.json --faces            every face toward the viewer, hidden or not
 *
 * A photograph of a model says whether it looks like the thing, and a published envelope
 * says whether it is the right size; neither says whether the turret stands where the
 * turret stands. The Panther's was half a metre too far forward and read as a tank in every
 * photograph ever taken of it, and `tools/dims.mjs` could not see it, because an envelope
 * does not care where anything is inside it. So the model's own faces are projected
 * orthographically onto the drawing, at the drawing's own scale, view by view, and the two
 * are read against each other line for line.
 *
 * A spec is a JSON file:
 *
 *   { "image": "shots/ref/hr_251.jpg", "key": "hr_251", "up": [], "crew": false,
 *     "views": {
 *       "side":  { "nose": "left", "crop": [x, y, w, h], "ppm": 72.4, "at": [0, 0, 0], "px": [X, Y], "k": 3 },
 *       "plan":  { "nose": "left", ... },
 *       "front": { ... }, "rear": { ... } } }
 *
 * `ppm` is pixels per metre in that view, taken off a published figure measured IN THAT VIEW
 * (the views of one sheet are not always drawn to one scale); `ppmv` is a vertical scale where
 * the view is stretched. `at` is a point of the model, in model units, and `px` is the pixel of
 * the drawing it lands on: pin something the model is known to have right (the front axle on
 * the ground, the centreline at the nose) and read everything else off it. `nose` says which
 * way the vehicle points in a side or plan view. `k` magnifies the output.
 *
 * The key may be a vehicle (`VMODEL`) or a crew-served gun (`GUNMODEL`, with `pack: true` for
 * the piece as it travels). `up` names fittings: a mount that swaps the turret, the skirts,
 * the roof gun, anything in `addUp`. `crew` draws the men.
 *
 * What is drawn is what a draughtsman draws: the edges where two faces meet at an angle or a
 * face ends, and only where nothing nearer the viewer covers them, through a depth buffer at the
 * output's resolution. The first version drew every face turned toward the viewer, and in plan
 * that put the tracks and all twelve road wheels on top of the guards that hide them. Blue is the
 * hull, red the mount, green the men and magenta a fitting. The ticks along the edges are
 * every ten model units from the pinned point, the numbers in metres.
 *
 * It prints each view's scale and the model's extent in the drawing's own pixels, so a
 * mismatch can be read as a number as well as looked at. Output is shots/overlay/.
 */

import fs from 'node:fs';
import path from 'node:path';
import { launch, openGame, parseArgs, GAME } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const ROOT = path.dirname(GAME);
const SCALE = 11.7;   /* units per metre, as tools/dims.mjs has it */
const OUT = path.join(ROOT, 'shots', 'overlay');
fs.mkdirSync(OUT, { recursive: true });

const rel = p => (path.isAbsolute(p) ? p : path.join(ROOT, p));
let spec, imgPath;
if (args.grid && args._[0] && !args._[0].endsWith('.json')) {
  imgPath = rel(args._[0]);
  spec = null;
} else {
  if (!args._[0]) { console.error('usage: node tools/overlay.mjs <spec.json> | --grid <image>'); process.exit(2); }
  spec = JSON.parse(fs.readFileSync(rel(args._[0]), 'utf8'));
  imgPath = rel(spec.image);
}
if (!fs.existsSync(imgPath)) {
  console.error(`no drawing at ${imgPath}: reference drawings live outside the repository (shots/ref/ is ignored); save the one you were given there first`);
  process.exit(2);
}
const img = fs.readFileSync(imgPath).toString('base64');
const mime = /\.png$/i.test(imgPath) ? 'image/png' : 'image/jpeg';

const browser = await launch();
const file = args.file === undefined ? GAME : String(args.file);
const { page } = await openGame(browser, 'veh', { quiet: true, file });
/* a grid in the drawing's own pixels: a line every ten, a heavier one and a number every fifty */
await page.evaluate(() => {
  window.__grid = function (g, cx, cy, cw, ch, k) {
    g.save(); g.strokeStyle = 'rgba(255,0,0,.45)'; g.fillStyle = 'rgba(200,0,0,.9)'; g.font = '12px sans-serif';
    for (let x = Math.ceil(cx / 10) * 10; x < cx + cw; x += 10) {
      g.lineWidth = x % 50 ? .3 : 1; g.beginPath(); g.moveTo((x - cx) * k, 0); g.lineTo((x - cx) * k, ch * k); g.stroke();
      if (x % 50 === 0) g.fillText(x, (x - cx) * k + 2, 12);
    }
    for (let y = Math.ceil(cy / 10) * 10; y < cy + ch; y += 10) {
      g.lineWidth = y % 50 ? .3 : 1; g.beginPath(); g.moveTo(0, (y - cy) * k); g.lineTo(cw * k, (y - cy) * k); g.stroke();
      if (y % 50 === 0) g.fillText(y, 2, (y - cy) * k - 2);
    }
    g.restore();
  };
});

/* the drawing on its own, with a grid in its own pixels to read positions off; `--crop` may
   carry several boxes separated by semicolons, each written out as its own file */
if (!spec) {
  const crops = args.crop ? String(args.crop).split(';').map(c => c.split(',').map(Number)) : [[0, 0, 0, 0]];
  const base = path.basename(imgPath).replace(/\.\w+$/, '');
  for (let i = 0; i < crops.length; i++) {
    const out = await page.evaluate(async ({ img, mime, crop, k }) => {
      const im = new Image(); await new Promise(r => { im.onload = r; im.src = 'data:' + mime + ';base64,' + img; });
      const [cx, cy] = crop, cw = crop[2] || im.width, ch = crop[3] || im.height;
      const c = document.createElement('canvas'); c.width = cw * k; c.height = ch * k;
      const g = c.getContext('2d'); g.drawImage(im, cx, cy, cw, ch, 0, 0, cw * k, ch * k);
      window.__grid(g, cx, cy, cw, ch, k);
      return { url: c.toDataURL('image/png'), w: im.width, h: im.height };
    }, { img, mime, crop: crops[i], k: +(args.k || 2) });
    const name = path.join(OUT, base + '-grid' + (crops.length > 1 ? '-' + (i + 1) : '') + '.png');
    fs.writeFileSync(name, Buffer.from(out.url.split(',')[1], 'base64'));
    if (!i) console.log(`drawing ${out.w} x ${out.h} px`);
    console.log(`  ${path.relative(ROOT, name)}  (${crops[i].join(',')})`);
  }
  await browser.close();
  process.exit(0);
}

const only = args.only ? String(args.only).split(',') : null;
const views = Object.keys(spec.views).filter(v => !only || only.includes(v));
const res = await page.evaluate(async ({ spec, views, img, mime, SCALE, grid, faces }) => {
  if (!window.VMODEL[spec.key] && !window.GUNMODEL[spec.key]) buildVehicleModels();
  const V = window.VMODEL[spec.key], GM = window.GUNMODEL[spec.key];
  if (!V && !GM) return { err: 'no model called ' + spec.key };
  const up = spec.up || [], parts = [];
  function add(faces, t, off) {
    (faces || []).forEach(f => parts.push({ v: off ? f.v.map(p => [p[0] + off[0], p[1] + off[1], p[2] + off[2]]) : f.v, t }));
  }
  if (V) {
    /* the mount goes where mountPose puts it, with the fitting's own placement if one swaps it */
    const uk = up.find(k => V.turUp && V.turUp[k]), o = uk && V.barUp ? V.barUp[uk] || {} : {};
    const pick = (n, d) => (o[n] !== undefined ? o[n] : d);
    const mo = [pick('turX', V.turX || 0), pick('turY', V.turY || 0), pick('mountZ', V.mountZ || 0)];
    add(V.hull, 0);
    add(uk ? V.turUp[uk] : V.tur, 1, mo);
    if (spec.crew) {
      add(V.crew, 2);
      const tc = uk && V.turCrewUp && V.turCrewUp[uk] ? V.turCrewUp[uk] : up.includes('mg') && V.turCrewMg ? V.turCrewMg : V.turCrew;
      add(tc, 2, mo);
      if (up.includes('mg')) add(V.mgMan, 2, mo);
    }
    if (up.includes('mg')) add(V.mg, 3, mo);
    if (up.includes('skirts') || up.includes('fenders')) { add(V.skirts, 3); add(V.turSkirts, 3, mo); }
    up.forEach(k => { if (V.addUp && V.addUp[k]) add(V.addUp[k], 3); });
  } else {
    /* the tube is drawn with the carriage whichever way the trails are, as the game draws it */
    add(spec.pack && GM.pack ? GM.pack : GM.mesh, 0);
    add(GM.rec, 1);
    if (!spec.pack) add(GM.base, 0);
  }
  function normal(v) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
  }
  /* which way round a face is wound is read off the model rather than assumed: the world is
     left-handed, and a sign got backwards here draws the far side of every view */
  let upSign = 0;
  parts.forEach(f => { if (!f.t) { const n = normal(f.v); const zc = f.v.reduce((s, p) => s + p[2], 0) / f.v.length; upSign += n[2] * zc; } });
  const flip = upSign < 0 ? -1 : 1;
  /* h across the drawing and v down it, in model units, and which faces look at the viewer */
  /* h across the drawing and v down it, in model units; d is toward the viewer, which is what
     the depth buffer keeps the most of; see is which faces look at the viewer, for --faces */
  const PROJ = {
    side:  s => s.nose === 'right' ? { h: p => p[0], v: p => -p[2], d: p => p[1], see: n => n[1] > .15 }
                                   : { h: p => -p[0], v: p => -p[2], d: p => -p[1], see: n => n[1] < -.15 },
    plan:  s => s.nose === 'right' ? { h: p => p[0], v: p => p[1], d: p => p[2], see: n => n[2] > .15 }
                                   : { h: p => -p[0], v: p => -p[1], d: p => p[2], see: n => n[2] > .15 },
    front: () => ({ h: p => -p[1], v: p => -p[2], d: p => p[0], see: n => n[0] > .15 }),
    rear:  () => ({ h: p => p[1], v: p => -p[2], d: p => -p[0], see: n => n[0] < -.15 })
  };
  /* The edges worth drawing are the ones a draughtsman draws: where two faces meet at an angle,
     or where a face ends. An edge between two faces in one plane is how the model happens to be
     cut up (a lathe's segments, a plate split for the occlusion bake) and is left out. */
  const key = p => p.map(q => Math.round(q * 50)).join(',');
  const edges = new Map();
  parts.forEach(f => {
    const n = normal(f.v);
    for (let i = 0; i < f.v.length; i++) {
      const a = f.v[i], b = f.v[(i + 1) % f.v.length], ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const kk = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const e = edges.get(kk);
      if (e) e.n.push(n); else edges.set(kk, { a, b, t: f.t, n: [n] });
    }
  });
  const feat = [];
  edges.forEach(e => {
    if (e.n.length === 2 && Math.abs(e.n[0][0] * e.n[1][0] + e.n[0][1] * e.n[1][1] + e.n[0][2] * e.n[1][2]) > .996) return;
    feat.push(e);
  });
  const im = new Image(); await new Promise(r => { im.onload = r; im.src = 'data:' + mime + ';base64,' + img; });
  const out = [];
  const COL = ['rgba(0,90,255,.55)', 'rgba(225,0,0,.7)', 'rgba(0,150,40,.7)', 'rgba(200,0,200,.7)'];
  views.forEach(name => {
    const s = spec.views[name], kind = s.kind || name.replace(/[-_]\w*$/, ''), P = PROJ[kind] && PROJ[kind](s);
    if (!P) { out.push({ name, err: 'no such view ' + kind }); return; }
    const ph = s.ppm / SCALE, pv = (s.ppmv || s.ppm) / SCALE, at = s.at || [0, 0, 0];
    const [cx, cy, cw, ch] = s.crop || [0, 0, im.width, im.height], k = s.k || 2;
    const c = document.createElement('canvas'); c.width = cw * k; c.height = ch * k;
    const g = c.getContext('2d'); g.drawImage(im, cx, cy, cw, ch, 0, 0, cw * k, ch * k);
    const X = p => s.px[0] + (P.h(p) - P.h(at)) * ph, Y = p => s.px[1] + (P.v(p) - P.v(at)) * pv;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    parts.forEach(f => f.v.forEach(p => { if (f.t < 2) { const a = X(p), b = Y(p);
      x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); } }));
    const sx = p => (X(p) - cx) * k, sy = p => (Y(p) - cy) * k;
    g.lineWidth = 1;
    if (faces) {
      /* every face that looks at the viewer, hidden or not: the first version of this card */
      parts.forEach(f => {
        if (!P.see(normal(f.v).map(q => q * flip))) return;
        g.strokeStyle = COL[f.t]; g.beginPath();
        f.v.forEach((p, i) => { i ? g.lineTo(sx(p), sy(p)) : g.moveTo(sx(p), sy(p)); });
        g.closePath(); g.stroke();
      });
    } else {
      /* a depth buffer at the output's own resolution, then each feature edge walked a pixel at
         a time and drawn only where nothing nearer the viewer covers it */
      const W = c.width, H = c.height, zb = new Float32Array(W * H).fill(-1e9);
      const tri = (a, b, q) => {
        const ar = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
        if (Math.abs(ar) < 1e-6) return;
        const mx = Math.max(0, Math.floor(Math.min(a[0], b[0], q[0]))), Mx = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], q[0])));
        const my = Math.max(0, Math.floor(Math.min(a[1], b[1], q[1]))), My = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], q[1])));
        for (let y = my; y <= My; y++) for (let x = mx; x <= Mx; x++) {
          const px = x + .5, py = y + .5;
          const w0 = ((b[0] - px) * (q[1] - py) - (b[1] - py) * (q[0] - px)) / ar;
          const w1 = ((q[0] - px) * (a[1] - py) - (q[1] - py) * (a[0] - px)) / ar, w2 = 1 - w0 - w1;
          if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue;
          const d = w0 * a[2] + w1 * b[2] + w2 * q[2], i = y * W + x;
          if (d > zb[i]) zb[i] = d;
        }
      };
      parts.forEach(f => {
        const q = f.v.map(p => [sx(p), sy(p), P.d(p)]);
        for (let i = 1; i + 1 < q.length; i++) tri(q[0], q[i], q[i + 1]);
      });
      const eps = .35;
      feat.forEach(e => {
        const a = [sx(e.a), sy(e.a), P.d(e.a)], b = [sx(e.b), sy(e.b), P.d(e.b)];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.5));
        g.strokeStyle = COL[e.t]; g.beginPath();
        let on = false;
        for (let i = 0; i <= n; i++) {
          const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, d = a[2] + (b[2] - a[2]) * t;
          const xi = Math.floor(x), yi = Math.floor(y);
          let vis = xi >= 0 && yi >= 0 && xi < W && yi < H;
          if (vis) {
            /* the nearest the buffer holds round the pixel, so an edge on its own face's rim is
               not lost to the face behind it and one under a nearer plate is */
            let zmax = -1e9;
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
              const u = xi + ox, v = yi + oy; if (u >= 0 && v >= 0 && u < W && v < H) zmax = Math.max(zmax, zb[v * W + u]);
            }
            vis = d >= zmax - eps;
          }
          if (vis && !on) { g.moveTo(x, y); on = true; } else if (vis) g.lineTo(x, y); else on = false;
        }
        g.stroke();
      });
    }
    /* ticks every ten model units from the pinned point, labelled in metres */
    g.fillStyle = 'rgba(160,0,0,.9)'; g.strokeStyle = 'rgba(160,0,0,.9)'; g.font = '11px sans-serif';
    const ax = (s.px[0] - cx) * k, ay = (s.px[1] - cy) * k;
    for (let i = -60; i <= 60; i++) {
      const tx = ax + i * 10 * ph * k, ty = ay + i * 10 * pv * k, big = i % 5 === 0;
      if (tx >= 0 && tx <= c.width) { g.beginPath(); g.moveTo(tx, c.height); g.lineTo(tx, c.height - (big ? 10 : 5)); g.stroke();
        if (big) g.fillText((i * 10 / SCALE).toFixed(1), tx + 2, c.height - 12); }
      if (ty >= 0 && ty <= c.height) { g.beginPath(); g.moveTo(0, ty); g.lineTo(big ? 10 : 5, ty); g.stroke();
        if (big) g.fillText((i * 10 / SCALE).toFixed(1), 12, ty + 4); }
    }
    g.beginPath(); g.arc(ax, ay, 4, 0, Math.PI * 2); g.stroke();
    if (grid) window.__grid(g, cx, cy, cw, ch, k);
    g.fillStyle = '#000'; g.font = '14px sans-serif';
    g.fillText(`${spec.key} ${name}: ${s.ppm} px/m`, 6, 16);
    out.push({ name, url: c.toDataURL('image/png'), ppm: s.ppm, ppmv: s.ppmv || s.ppm,
               span: [x0, x1, y0, y1].map(q => +q.toFixed(1)),
               m: [((x1 - x0) / s.ppm).toFixed(3), ((y1 - y0) / (s.ppmv || s.ppm)).toFixed(3)] });
  });
  return { out };
}, { spec, views, img, mime, SCALE, grid: !!args.grid, faces: !!args.faces });

if (res.err) { console.error(res.err); await browser.close(); process.exit(2); }
console.log(`${spec.key} over ${path.relative(ROOT, imgPath)}${args.file ? ' (' + args.file + ')' : ''}`);
res.out.forEach(o => {
  if (o.err) { console.log(`  ${o.name}: ${o.err}`); return; }
  const name = path.join(OUT, `${spec.key}-${o.name}${args.tag ? '-' + args.tag : ''}.png`);
  fs.writeFileSync(name, Buffer.from(o.url.split(',')[1], 'base64'));
  console.log(`  ${o.name.padEnd(8)} ${String(o.ppm).padStart(6)} px/m   model spans x ${o.span[0]}..${o.span[1]}  y ${o.span[2]}..${o.span[3]} px` +
              `  (${o.m[0]} x ${o.m[1]} m)   ${path.relative(ROOT, name)}`);
});
await browser.close();
