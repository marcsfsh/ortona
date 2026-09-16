#!/usr/bin/env node
/* The figure, mechanically.
 *
 * A man is judged by looking at him, and that is right for the read of a side and the
 * set of a pose. It is no use at all for whether his feet are on the ground, whether a
 * forearm runs through the blouse, whether a hand is on the rifle or a unit inside it,
 * whether the muzzle flash lands on the muzzle, or how many of his faces are drawn on a
 * tile with no weave in it, because every one of those is a number the eye rounds to
 * "fine" at fifty-eight units and cannot see at all at six hundred. The shipped figure
 * stood with its boots eight centimetres into the ground for the life of the game and
 * every photograph ever taken of it looked plausible.
 *
 *   node tools/men.mjs                   the card
 *   node tools/men.mjs contact grip      two sections of it
 *   node tools/men.mjs --only=can_rifle  one variant
 *   node tools/men.mjs --base=HEAD       the older file beside it: PROPORTION dims-style, the rest as a BEFORE block
 *   node tools/men.mjs --device=phone    READ and FOOTPRINT on one device (both otherwise)
 *   node tools/men.mjs --tol=4 --v       tighten every proportion row to 4 per cent; every clip pair rather than the worst
 *
 * PROPORTION is the figure against a 1943 European male at 1.73 m, Drillis and Contini
 * for the segments, the published shell for the helmets and the builders' own published
 * lengths for the weapons. CONTACT is whether the feet are on the ground in every baked
 * frame, and the drawn offsets that sink a figure on purpose are printed beside it so
 * nobody reads them as errors. SKATE is how far the planted foot slides over a stance of
 * the walk, against the ground the frame stands for. GRAVITY is whether the man stands
 * over his feet and leans the way his pose says he does, which is the check that keeps
 * the lean's sign from coming back reversed. GRIP is palm to metal, point to triangle,
 * because a plain box fore-end has vertices only at its ends and the nearest-vertex
 * version reported a hand resting on a rifle as 2.8 units off it. CLIP is one part
 * inside another, sampled at vertices and edge midpoints for the same reason. AIM is the
 * bore against the facing and the eye against the bore. MUZZLE is the flash against the
 * barrel. WIND is a limb wound inside out, which is culled and reads as a missing limb.
 * MATERIAL is what tile each face lands on: a lit() derivative nobody tagged lands on
 * the generic tile, and 433 of a rifleman's 772 faces did. SIZE is the roster's cost.
 * FOOTPRINT and READ are read off the framebuffer at play distance on both devices: the
 * outline each posture leaves and the value each side carries, which are the two things
 * the whole figure is designed for and the two a diff cannot show.
 *
 * Every section ends with its misses and the process exits non-zero on any. It does not
 * join `npm run verify`; it runs before any commit that touches the figure, the way
 * dims.mjs does for a vehicle.
 *
 * It reads a figure through one record -- faces, named parts, joints, the eye, the
 * muzzle -- whichever builder made it. A file with `manFaces` hands that record over;
 * an older one is read through `legacy()`, which wraps the primitives while the old
 * builder runs and partitions its face list by the calls it made, so nothing in the game
 * has to be edited to be measured and the counts are asserted to sum to the list.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openGame, deploy, parseArgs, GAME } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const BASE = args.base === undefined ? null : String(args.base);
const ONLY = args.only ? String(args.only).split(',') : null;
const TOLCAP = args.tol === undefined ? 1 : Number(args.tol) / 100;
const VERBOSE = !!args.v;
const SECTIONS = ['proportion', 'contact', 'skate', 'gravity', 'grip', 'clip', 'aim', 'muzzle', 'wind', 'material', 'size', 'footprint', 'read'];
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
for (const s of only) if (!SECTIONS.includes(s)) { console.error(`unknown section "${s}" (one of ${SECTIONS.join(' ')})`); process.exit(1); }
const want = s => !only.length || only.includes(s);
const DEVICES = args.device ? [String(args.device)] : ['desktop', 'phone'];

/* ================================================================ in the page: geometry
   One evaluate for everything that reads face lists. Node formats. */
function GEO(opt) {
  const R = { sections: {} };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len3 = a => Math.hypot(a[0], a[1], a[2]);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const fcen = f => { const c = [0, 0, 0]; f.v.forEach(p => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }); return c.map(v => v / f.v.length); };
  const cen = faces => { const c = [0, 0, 0]; let n = 0; faces.forEach(f => f.v.forEach(p => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; n++; })); return n ? c.map(v => v / n) : null; };
  const ext = faces => {
    const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 };
    faces.forEach(f => f.v.forEach(p => {
      if (p[0] < b.x0) b.x0 = p[0]; if (p[0] > b.x1) b.x1 = p[0];
      if (p[1] < b.y0) b.y0 = p[1]; if (p[1] > b.y1) b.y1 = p[1];
      if (p[2] < b.z0) b.z0 = p[2]; if (p[2] > b.z1) b.z1 = p[2];
    }));
    return b;
  };
  const cat = lists => [].concat.apply([], lists.filter(Boolean));
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  function faceArea(f) {
    let A = 0;
    for (let k = 1; k < f.v.length - 1; k++) {
      const u = sub(f.v[k], f.v[0]), w = sub(f.v[k + 1], f.v[0]);
      A += .5 * len3([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
    }
    return A;
  }
  /* the surface centroid: area-weighted over the fan each face is drawn as */
  function surfaceCentroid(faces) {
    let A = 0, cx = 0, cy = 0, cz = 0;
    faces.forEach(f => {
      for (let k = 1; k < f.v.length - 1; k++) {
        const a = f.v[0], b = f.v[k], c = f.v[k + 1];
        const u = sub(b, a), w = sub(c, a);
        const ar = .5 * len3([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
        A += ar; cx += ar * (a[0] + b[0] + c[0]) / 3; cy += ar * (a[1] + b[1] + c[1]) / 3; cz += ar * (a[2] + b[2] + c[2]) / 3;
      }
    });
    return A ? [cx / A, cy / A, cz / A] : [0, 0, 0];
  }
  /* point to triangle, Ericson's closest-point routine */
  function ptTri(p, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return len3(ap);
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return len3(bp);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return len3(sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v])); }
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return len3(cp);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return len3(sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w])); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return len3(sub(p, [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w])); }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return len3(sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
  }
  function ptFaces(p, faces) {
    let best = 1e9;
    for (const f of faces) for (let k = 1; k < f.v.length - 1; k++) { const d = ptTri(p, f.v[0], f.v[k], f.v[k + 1]); if (d < best) best = d; }
    return best;
  }
  /* the depth of a point inside a convex part: the least inward distance over its
     planes, so a point outside any one of them is negative. A lathe closing to the axis
     has a zero normal on that ring and is skipped, or it would cap every depth at 0. */
  function depthIn(p, faces) {
    let d = 1e9;
    for (const f of faces) {
      const n = faceNormal(f.v[0], f.v[1], f.v[2]);
      if (Math.hypot(n.x, n.y, n.z) < .5) continue;
      const s = -((p[0] - f.v[0][0]) * n.x + (p[1] - f.v[0][1]) * n.y + (p[2] - f.v[0][2]) * n.z);
      if (s < d) d = s;
    }
    return d;
  }
  /* a part's vertices and the midpoints of its edges: a limb box has vertices only at
     its ends, and a forearm through a blouse is inside it in the middle */
  function samples(faces) {
    const out = [];
    faces.forEach(f => { for (let i = 0; i < f.v.length; i++) { const a = f.v[i], b = f.v[(i + 1) % f.v.length]; out.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]); } });
    return out;
  }
  const deepest = (moving, into) => { let d = -9; samples(moving).forEach(p => { const q = depthIn(p, into); if (q > d) d = q; }); return d; };

  /* ---------------- legacy(): the primitive-wrapping partition ----------------
     The old builders concatenate what every primitive returns, in call order, and the
     two transforms they apply afterwards keep that order, so the finished list is cut
     into parts by the counts the calls logged. A composite (a head, a helmet, a weapon)
     is one part with the primitives it made as children. The counts are asserted to
     sum to the list, which is what catches a builder that starts making faces some
     other way. */
  function capture(build) {
    const LOG = [], stack = [], orig = {};
    ['box', 'cyl', 'lathe', 'tubeSmooth', 'frustum', 'limb', 'taperLimb', 'headModel', 'helmetUS', 'helmetGER', 'weaponModel'].forEach(name => {
      if (typeof window[name] !== 'function') return;
      orig[name] = window[name];
      window[name] = function () {
        const e = { name, args: Array.from(arguments).map(a => Array.isArray(a) ? a.map(v => Array.isArray(v) ? v.slice() : v) : typeof a === 'number' || typeof a === 'string' ? a : '{}'), kids: [], n: 0 };
        (stack.length ? stack[stack.length - 1].kids : LOG).push(e);
        stack.push(e);
        let r;
        try { r = orig[name].apply(this, arguments); } finally { stack.pop(); }
        e.n = r.length;
        return r;
      };
    });
    let faces;
    try { faces = build(); } finally { Object.keys(orig).forEach(k => { window[k] = orig[k]; }); }
    function assign(entries, start) {
      let i = start;
      for (const e of entries) { e.faces = faces.slice(i, i + e.n); if (e.kids.length) assign(e.kids, i); i += e.n; }
      return i;
    }
    const end = assign(LOG, 0);
    const leaves = [];
    (function walk(list) { list.forEach(e => { if (e.kids.length) walk(e.kids); else leaves.push(e); }); })(LOG);
    return { faces, log: LOG, leaves, ok: end === faces.length, logged: end };
  }
  /* what each part of the old builder is called by: its primitive and its dimensions,
     kept in one table the way dims.mjs keeps its slice heights */
  const SIG = {
    thigh: [2.0, 2.0, 5.3], shin: [1.7, 1.7, 5.0], anklet: [1.8, 1.8, 1.6], jumpboot: [1.8, 1.8, 2.4], boot: [3.2, 1.45, 1.1],
    hips: [2.9, 4.6, 3.2], chest: [3.0, 5.0, 4.4], smock: [3.4, 5.4, 8.6], plate: [3.0, 5.6, .8], pack: [1.6, 3.6, 3.0],
    pouch: [1.2, 1.5, 2.2], hand: [1, 1, 1],
    pTorso: [6.5, 4.8, 2.6], pHips: [3.6, 4.4, 2.2], pPack: [3.2, 3.6, 2.4], pThigh: [4.6, 1.8, 1.7], pShin: [4.2, 1.6, 1.5],
    pBoot: [1.6, 1.4, 2.8], pArmU: [3.6, 1.25, 1.25], pArmF: [3.0, 1.1, 1.1]
  };
  const LEGACY_LEAN = { stand: .05, walk: .11, fire: .17, crouch: .21, cfire: .21 };
  const HIP_Y = 1.15;
  function legacy(variant, P) {
    const V = SOLDIER_VARIANTS[variant], side = V.side;
    const flat = P.name === 'prone' || P.name === 'crawl';
    const cap = P.name === 'prone' ? capture(() => proneModel(variant))
      : P.name === 'crawl' ? capture(() => proneModel(variant, (P.frame + .5) / CRAWLF))
      : P.name === 'walk' ? capture(() => soldierModel(variant, P.frame / (WALKF - 1)))
      : capture(() => soldierModel(variant, -1, { stand: undefined, fire: 'fire', crouch: 'crouch', cfire: 'crouchfire' }[P.name]));
    const L = cap.log;
    const isBox = (e, s) => e.name === 'box' && near(e.args[3], s[0]) && near(e.args[4], s[1]) && near(e.args[5], s[2]);
    const all = s => L.filter(e => isBox(e, s)), one = s => all(s)[0] || null;
    const comp = n => L.filter(e => e.name === n)[0] || null;
    const F = e => (e ? e.faces : []);
    const head = comp('headModel'), helmet = comp('helmetUS') || comp('helmetGER'), weapon = comp('weaponModel');
    const parts = { skull: head ? F(head.kids[0]) : [], head: F(head), helmet: F(helmet), shell: helmet ? F(helmet.kids[0]) : [], weapon: F(weapon) };
    /* the barrel: the longest tube the weapon was built with, and the bore is its axis */
    parts.barrel = null;
    if (weapon) {
      const tubes = [];
      (function walk(list) { list.forEach(e => { if (e.name === 'tubeSmooth') tubes.push(e); if (e.kids.length) walk(e.kids); }); })(weapon.kids);
      tubes.forEach(t => { const n = t.faces.length; t.len = len3(sub(fcen(t.faces[n - 2]), fcen(t.faces[n - 1]))); });
      tubes.sort((a, b) => b.len - a.len);
      if (tubes.length) { const n = tubes[0].faces.length; parts.barrel = { front: fcen(tubes[0].faces[n - 2]), back: fcen(tubes[0].faces[n - 1]) }; }
    }
    const joints = {};
    if (!flat) {
      const thighs = all(SIG.thigh), shins = all(SIG.shin), boots = all(SIG.boot), gaiters = all(SIG.anklet).concat(all(SIG.jumpboot));
      const limbs = L.filter(e => e.name === 'limb'), hands = all(SIG.hand);
      parts.thighs = thighs.map(F); parts.shins = shins.map(F); parts.boots = boots.map(F);
      parts.legs = [0, 1].map(i => cat([F(thighs[i]), F(shins[i]), F(gaiters[i]), F(boots[i])]));
      parts.hips = F(one(SIG.hips)); parts.chest = F(one(SIG.chest)); parts.smock = F(one(SIG.smock));
      parts.plate = F(one(SIG.plate)); parts.pack = F(one(SIG.pack)); parts.pouches = all(SIG.pouch).map(F);
      parts.limbs = limbs.map(F); parts.hands = hands.map(F);
      /* joints off the parts rather than the arguments, because the upper body is
         leaned after the arguments were written: a limb's -x cap is its p0 and its +x
         cap its p1; a leg box's top face is the joint it hangs from and its bottom the
         joint below it, and those faces keep their index through every transform */
      const cp = (e, i) => (e && e.faces[i] ? fcen(e.faces[i]) : null);
      joints.hipL = cp(thighs[0], 4); joints.hipR = cp(thighs[1], 4);
      joints.kneeL = cp(thighs[0], 5); joints.kneeR = cp(thighs[1], 5);
      joints.ankleL = cp(shins[0], 5); joints.ankleR = cp(shins[1], 5);
      joints.shoulderR = cp(limbs[0], 1); joints.elbowR = cp(limbs[0], 0); joints.handR = cp(limbs[1], 0);
      joints.shoulderL = cp(limbs[2], 1); joints.elbowL = cp(limbs[2], 0); joints.handL = cp(limbs[3], 0);
    } else {
      parts.torso = F(one(SIG.pTorso)); parts.hips = F(one(SIG.pHips)); parts.pack = F(one(SIG.pPack));
      parts.thighs = all(SIG.pThigh).map(F); parts.shins = all(SIG.pShin).map(F); parts.boots = all(SIG.pBoot).map(F);
      const au = all(SIG.pArmU), af = all(SIG.pArmF);
      parts.armsU = au.map(F); parts.armsF = af.map(F);
      parts.limbs = [F(au[1]), F(af[1]), F(au[0]), F(af[0])];
      parts.legs = [0, 1].map(i => cat([parts.thighs[i], parts.shins[i], parts.boots[i]]));
      /* no hand is built lying down: the palm is the forward end of the forearm box */
      joints.handL = af[0] ? fcen(af[0].faces[0]) : null; joints.handR = af[1] ? fcen(af[1].faces[0]) : null;
    }
    if (parts.skull.length) {
      joints.skull = cen(parts.skull); joints.crown = [joints.skull[0], joints.skull[1], ext(parts.skull).z1];
      joints.eye = [joints.skull[0] + .9, joints.skull[1], joints.skull[2] + .35];
    }
    const body = cap.faces.filter(f => parts.weapon.indexOf(f) < 0);
    const id = window.__o.poseId(P.name);
    const gz = groundZ(0, 0), mz = id === null ? null : muzzlePoint({ x: 0, y: 0, f: 0, pose: id });
    return { faces: cap.faces, ok: cap.ok, logged: cap.logged, parts, joints, leaves: cap.leaves.map(e => e.faces),
             lean: LEGACY_LEAN[P.name], flat, body, legFaces: cat(parts.legs),
             runtimeMuzzle: mz ? [mz.x, mz.y, mz.z - gz] : null, weapon: V.weapon, hasWeapon: V.weapon !== 'none' };
  }
  /* ---------------- rig: the record manFaces hands over ----------------
     The rig returns faces, joints, muzzle, eye and anchors; the sections that need a
     part by name read `parts` off the same record, and say so when it is not there. */
  function rigPose(P) {
    if (P.name === 'walk') return WALK(P.frame / P.cycle.n);
    if (P.name === 'run') return RUN(P.frame / P.cycle.n);
    if (P.name === 'prone') return PRONE();
    if (P.name === 'crawl') return CRAWL(P.frame / P.cycle.n);
    if (P.name === 'fall') return FIGPOSE['fall' + P.frame];
    return FIGPOSE[P.name];
  }
  function rig(variant, P) {
    const V = SOLDIER_VARIANTS[variant];
    const r = P.name === 'dead' ? deadFaces(variant, P.frame) : manFaces(variant, rigPose(P));
    const faces = r.faces || r, joints = r.joints || {}, parts = r.parts || {};
    const flat = P.name === 'prone' || P.name === 'crawl' || P.name === 'dead';
    const pose = rigPose(P) || {};
    const weapon = parts.weapon || [];
    const body = faces.filter(f => weapon.indexOf(f) < 0);
    const hipZ = joints.hipL ? Math.min(joints.hipL[2], joints.hipR[2]) : 0;
    const legFaces = parts.legs ? cat(parts.legs) : body.filter(f => f.v.every(p => p[2] < hipZ + .3));
    const id = window.__o.poseId(P.name);
    let mz = null;
    if (MODELS.muz && MODELS.muz[variant] && id !== null) { mz = MODELS.muz[variant][id]; if (mz && mz.length && mz[0].length) mz = mz[P.frame % mz.length]; }
    return { faces, ok: true, logged: faces.length, parts, joints, leaves: parts.leaves || null,
             lean: pose.lean, flat, body, legFaces, eye: r.eye, muzzle: r.muzzle, anchors: r.anchors,
             runtimeMuzzle: mz ? mz.slice() : null, weapon: V.weapon, hasWeapon: V.weapon !== 'none' };
  }
  const RIG = typeof window.manFaces === 'function' && !!window.FIGPOSE;
  R.builder = RIG ? 'manFaces' : 'legacy partition';
  const figure = RIG ? rig : legacy;

  /* the postures each variant is baked in, as buildModels bakes them */
  function posesOf(variant) {
    const V = SOLDIER_VARIANTS[variant], out = [];
    const cycle = (name, n, len) => { for (let i = 0; i < n; i++) out.push({ name, frame: i, cycle: { n, len } }); };
    if (RIG) {
      if (V.set === 'hull') { out.push({ name: 'seat', frame: 0 }); return out; }
      out.push({ name: 'stand', frame: 0 }, { name: 'kneel', frame: 0 }, { name: 'prone', frame: 0 });
      cycle('walk', WALKF, STRIDE_LEN);
      if (!MOB) cycle('run', RUNF, RUN_LEN);
      cycle('crawl', CRAWLF, CRAWL_LEN);
      if (V.set === 'gunner') { out.push({ name: 'served', frame: 0 }, { name: 'sit', frame: 0 }); return out; }
      out.push({ name: 'ready', frame: 0 }, { name: 'fire', frame: 0 }, { name: 'kfire', frame: 0 });
      if (variant === 'can_rifle' || variant === 'fj_rifle') { for (let i = 0; i < 3; i++) out.push({ name: 'fall', frame: i }); for (let i = 0; i < 2; i++) out.push({ name: 'dead', frame: i }); }
      return out;
    }
    const crew = V.weapon === 'none';
    out.push({ name: 'stand', frame: 0 });
    cycle('walk', WALKF - 1, STRIDE_LEN);
    if (!crew) out.push({ name: 'fire', frame: 0 }, { name: 'crouch', frame: 0 }, { name: 'cfire', frame: 0 });
    out.push({ name: 'prone', frame: 0 });
    if (!crew) cycle('crawl', CRAWLF, CRAWL_LEN);
    return out;
  }
  const label = P => P.cycle ? P.name + P.frame : P.name;
  const KNEEL = { crouch: 1, cfire: 1, kneel: 1, kfire: 1, served: 1, fall: 1 };
  const AIMED = { fire: 1, cfire: 1, kfire: 1 };
  const variants = Object.keys(SOLDIER_VARIANTS).filter(v => !opt.only || opt.only.indexOf(v) >= 0);
  const REC = {};
  function rec(variant, P) {
    const k = label(P);
    REC[variant] = REC[variant] || {};
    if (!REC[variant][k]) REC[variant][k] = figure(variant, P);
    return REC[variant][k];
  }
  const t0 = performance.now();
  let refused = 0;
  variants.forEach(v => posesOf(v).forEach(P => { if (!rec(v, P).ok) refused++; }));
  R.built = { ms: performance.now() - t0, refused };

  /* ---------------- PROPORTION ---------------- */
  if (opt.do.proportion) {
    const rows = [], arms = [], weapons = [];
    variants.forEach(v => {
      const r = rec(v, { name: RIG && SOLDIER_VARIANTS[v].set === 'hull' ? 'seat' : 'stand', frame: 0 });
      const J = r.joints, P = r.parts, side = SOLDIER_VARIANTS[v].side;
      if (!r.ok || !J.crown) { rows.push({ v, refused: true }); return; }
      const sole = ext(r.legFaces).z0;
      const sk = ext(P.skull || []), hipsE = P.hips && P.hips.length ? ext(P.hips) : null;
      const bootLen = P.boots && P.boots.length ? Math.max.apply(null, P.boots.map(b => { const e = ext(b); return e.x1 - e.x0; })) : null;
      const helmE = P.helmet && P.helmet.length ? ext(P.helmet) : null;
      rows.push({
        v, side,
        stature: J.crown[2] - sole, above: J.crown[2],
        headH: sk.z1 - sk.z0, headW: sk.y1 - sk.y0,
        plate: P.plate && P.plate.length ? ext(P.plate).y1 - ext(P.plate).y0 : null,
        apart: J.shoulderR && J.shoulderL ? Math.abs(J.shoulderR[1] - J.shoulderL[1]) : null,
        hips: hipsE ? hipsE.y1 - hipsE.y0 : null,
        inseam: hipsE ? hipsE.z0 - sole : null,
        knee: J.kneeL && J.kneeR ? (J.kneeL[2] + J.kneeR[2]) / 2 - sole : null,
        foot: bootLen, helmet: helmE ? helmE.y1 - helmE.y0 : null
      });
      posesOf(v).filter(P => !P.cycle || P.frame === 0).forEach(P => {
        const q = rec(v, P), Q = q.joints;
        if (!q.ok || q.flat || !Q.shoulderR || !Q.elbowR || !Q.handR) return;
        arms.push({ v, pose: label(P),
                    upperR: len3(sub(Q.elbowR, Q.shoulderR)), foreR: len3(sub(Q.handR, Q.elbowR)),
                    upperL: len3(sub(Q.elbowL, Q.shoulderL)), foreL: len3(sub(Q.handL, Q.elbowL)) });
      });
    });
    ['lee', 'leescope', 'kar', 'sten', 'mp40', 'bren', 'piat', 'schreck', 'mg42', 'm1919', 'zook'].forEach(type => {
      const f = weaponModel(KIT[type === 'kar' || type === 'mp40' || type === 'schreck' || type === 'mg42' ? 'ger' : 'us'], type);
      if (!f || !f.length) return;
      const e = ext(f);
      weapons.push({ type, len: e.x1 - e.x0 });
    });
    R.sections.proportion = { rows, arms, weapons };
  }

  /* ---------------- CONTACT ---------------- */
  if (opt.do.contact) {
    const rows = [];
    variants.forEach(v => {
      posesOf(v).forEach(P => {
        const r = rec(v, P);
        if (!r.ok) { rows.push({ v, pose: label(P), refused: true }); return; }
        const legs = r.parts.legs || [];
        const row = { v, pose: label(P), kind: r.flat ? 'flat' : KNEEL[P.name] ? 'kneel' : P.name === 'sit' ? 'sit' : 'upright',
                      low: r.legFaces.length ? ext(r.legFaces).z0 : ext(r.body).z0, bodyLow: ext(r.body).z0,
                      legLow: legs.map(l => (l.length ? ext(l).z0 : null)),
                      soles: r.parts.boots ? r.parts.boots.map(b => (b.length ? ext(b).z0 : null)) : [],
                      hipsLow: r.parts.hips && r.parts.hips.length ? ext(r.parts.hips).z0 : null,
                      cycle: P.cycle ? P.name : null };
        rows.push(row);
      });
    });
    /* the offsets a caller applies on purpose, read off the source so they are the
       ones actually in use */
    const src = String(drawWrecks3D), m = src.match(/groundZ\(c\.x, c\.y\)\s*-\s*([\d.]+)/);
    const cs = String(commander), cm = cs.match(/zl\s*-\s*([\d.]+)/);
    R.sections.contact = { rows, corpseSink: m ? Number(m[1]) : null, commanderSink: cm ? Number(cm[1]) : null,
                           crewLift: typeof CREW_LIFT === 'number' ? CREW_LIFT : null };
  }

  /* ---------------- SKATE ---------------- */
  if (opt.do.skate) {
    const rows = [];
    variants.forEach(v => {
      ['walk', 'run'].forEach(cy => {
        const frames = posesOf(v).filter(P => P.name === cy);
        if (!frames.length) { if (cy === 'walk' || RIG) rows.push({ v, cycle: cy, none: true }); return; }
        const n = frames[0].cycle.n, len = frames[0].cycle.len, per = len / n;
        const plants = frames.map(P => {
          const r = rec(v, P), J = r.joints, B = r.parts.boots || [];
          if (!r.ok || !J.ankleL || !B.length) return null;
          const sL = ext(B[0]).z0, sR = ext(B[1]).z0, left = sL <= sR;
          return { left, x: (left ? J.ankleL : J.ankleR)[0] + (P.frame / n) * len, sole: Math.min(sL, sR) };
        });
        if (plants.some(p => !p)) { rows.push({ v, cycle: cy, refused: true }); return; }
        let sum = 0, cnt = 0, worst = 0;
        for (let i = 0; i < n; i++) {
          const a = plants[i], b = plants[(i + 1) % n], wrap = i === n - 1 ? len : 0;
          if (a.left !== b.left) continue;
          const d = Math.abs(b.x + wrap - a.x); sum += d; cnt++; if (d > worst) worst = d;
        }
        rows.push({ v, cycle: cy, n, per, frac: cnt ? sum / cnt / per : 0, worst, stances: cnt,
                    plants: plants.map(p => (p.left ? 'L' : 'R') + r2(p.x)) });
      });
    });
    R.sections.skate = { rows };
  }

  /* ---------------- GRAVITY ---------------- */
  if (opt.do.gravity) {
    const rows = [];
    variants.forEach(v => {
      posesOf(v).filter(P => !P.cycle || P.frame === 0).forEach(P => {
        const r = rec(v, P), J = r.joints;
        if (!r.ok || r.flat || !J.hipL || !J.skull || P.name === 'seat' || P.name === 'sit') return;
        const sc = surfaceCentroid(r.faces), low = ext(r.legFaces).z0;
        /* the ground contact is every boot within a boot's height of the lowest point. A
           tilted sole touches at one edge, and a range read off the lowest 0.3 collapsed
           to that edge and reported every pose as not over its feet. */
        const boots = r.parts.boots && r.parts.boots.length ? cat(r.parts.boots) : r.legFaces;
        let x0 = 1e9, x1 = -1e9;
        boots.forEach(f => f.v.forEach(p => { if (p[2] <= low + 1.2) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; } }));
        const hip = [(J.hipL[0] + J.hipR[0]) / 2, 0, (J.hipL[2] + J.hipR[2]) / 2];
        const spine = Math.atan2(J.skull[0] - hip[0], J.skull[2] - hip[2]);
        rows.push({ v, pose: label(P), cx: sc[0], x0, x1, spine, lean: r.lean === undefined ? null : r.lean });
      });
    });
    R.sections.gravity = { rows };
  }

  /* ---------------- GRIP ---------------- */
  if (opt.do.grip) {
    const rows = [];
    variants.forEach(v => {
      posesOf(v).forEach(P => {
        const r = rec(v, P);
        if (!r.ok || !r.hasWeapon) return;
        const W = r.parts.weapon;
        if (!W || !W.length) { rows.push({ v, pose: label(P), noparts: true }); return; }
        const J = r.joints;
        const gap = h => (h ? ptFaces(h, W) - .5 : null);
        rows.push({ v, pose: label(P), R: gap(J.handR), L: gap(J.handL), flat: r.flat });
      });
    });
    R.sections.grip = { rows };
  }

  /* ---------------- CLIP ---------------- */
  if (opt.do.clip) {
    const rows = [];
    variants.forEach(v => {
      posesOf(v).forEach(P => {
        const r = rec(v, P), Pp = r.parts;
        if (!r.ok) return;
        if (!Pp.limbs) { rows.push({ v, pose: label(P), noparts: true }); return; }
        const pairs = [];
        const limbName = ['right upper arm', 'right forearm', 'left upper arm', 'left forearm'];
        const into = [];
        if (!r.flat) {
          if (Pp.chest && Pp.chest.length) into.push(['chest', Pp.chest]);
          if (Pp.smock && Pp.smock.length) into.push(['smock', Pp.smock]);
          if (Pp.hips && Pp.hips.length) into.push(['hips', Pp.hips]);
          if (Pp.pack && Pp.pack.length) into.push(['pack', Pp.pack]);
          (Pp.pouches || []).forEach((q, i) => into.push(['pouch ' + i, q]));
        } else {
          if (Pp.torso && Pp.torso.length) into.push(['torso', Pp.torso]);
        }
        Pp.limbs.forEach((l, i) => { if (l.length) into.forEach(t => pairs.push([limbName[i] + ' in ' + t[0], l, t[1]])); });
        if (Pp.weapon && Pp.weapon.length) {
          into.filter(t => t[0] === 'chest' || t[0] === 'smock' || t[0] === 'torso').forEach(t => pairs.push(['weapon in ' + t[0], Pp.weapon, t[1]]));
          if (Pp.skull && Pp.skull.length) pairs.push(['weapon in skull', Pp.weapon, Pp.skull]);
          if (Pp.shell && Pp.shell.length) pairs.push(['weapon in helmet', Pp.weapon, Pp.shell]);
        }
        if (!r.flat && Pp.thighs && Pp.thighs.length === 2) {
          into.filter(t => t[0] === 'hips' || t[0] === 'smock').forEach(t => { pairs.push(['left thigh in ' + t[0], Pp.thighs[0], t[1]]); pairs.push(['right thigh in ' + t[0], Pp.thighs[1], t[1]]); });
          pairs.push(['left thigh in right thigh', Pp.thighs[0], Pp.thighs[1]]);
        }
        const out = pairs.map(p => ({ pair: p[0], d: deepest(p[1], p[2]) }));
        out.sort((a, b) => b.d - a.d);
        rows.push({ v, pose: label(P), pairs: opt.verbose ? out : out.slice(0, 1), over: out.filter(q => q.d > .35).length });
      });
    });
    R.sections.clip = { rows };
  }

  /* the bore of the weapon as laid: from the record's anchors when it has them, else
     the axis of the longest tube the weapon was built with */
  function bore(r) {
    if (r.anchors && r.anchors.muzzle && (r.anchors.butt || r.anchors.grip)) {
      const b = r.anchors.butt || r.anchors.grip, d = sub(r.anchors.muzzle, b), l = len3(d) || 1;
      return { at: b, dir: d.map(x => x / l) };
    }
    const B = r.parts.barrel; if (!B) return null;
    const d = sub(B.front, B.back), l = len3(d) || 1;
    return { at: B.back, dir: d.map(x => x / l) };
  }
  function boreEnd(r, bo) {
    let best = -1e9;
    (r.parts.weapon || []).forEach(f => f.v.forEach(p => { const t = dot(sub(p, bo.at), bo.dir); if (t > best) best = t; }));
    return [bo.at[0] + bo.dir[0] * best, bo.at[1] + bo.dir[1] * best, bo.at[2] + bo.dir[2] * best];
  }

  /* ---------------- AIM ---------------- */
  if (opt.do.aim) {
    const rows = [];
    variants.forEach(v => {
      posesOf(v).filter(P => AIMED[P.name]).forEach(P => {
        const r = rec(v, P);
        if (!r.ok || !r.hasWeapon) return;
        const bo = bore(r), eye = r.eye || r.joints.eye;
        if (!bo || !eye) { rows.push({ v, pose: label(P), noparts: true }); return; }
        const yaw = Math.atan2(bo.dir[1], bo.dir[0]), pitch = Math.atan2(bo.dir[2], Math.hypot(bo.dir[0], bo.dir[1]));
        const e = sub(eye, bo.at), along = dot(e, bo.dir), perp = [e[0] - bo.dir[0] * along, e[1] - bo.dir[1] * along, e[2] - bo.dir[2] * along];
        rows.push({ v, pose: label(P), yaw, pitch, up: perp[2], lat: Math.hypot(perp[0], perp[1]) });
      });
    });
    R.sections.aim = { rows };
  }

  /* ---------------- MUZZLE ---------------- */
  if (opt.do.muzzle) {
    const rows = [];
    variants.forEach(v => {
      posesOf(v).forEach(P => {
        const r = rec(v, P);
        if (!r.ok || !r.hasWeapon) return;
        const bo = bore(r);
        if (!bo || !r.runtimeMuzzle) { rows.push({ v, pose: label(P), noparts: !bo, noRuntime: !r.runtimeMuzzle }); return; }
        const end = boreEnd(r, bo);
        rows.push({ v, pose: label(P), d: len3(sub(r.runtimeMuzzle, end)), got: r.runtimeMuzzle.map(r2), end: end.map(r2) });
      });
    });
    R.sections.muzzle = { rows, source: RIG && MODELS.muz ? 'MODELS.muz' : 'muzzlePoint(m)' };
  }

  /* ---------------- WIND ----------------
     A part is inside out when the volume its faces enclose, by the divergence theorem
     about its own centroid, comes out negative. Counting faces whose normal points at
     the centroid is not the test, and the first version did exactly that: the Mk II is
     a concave lathe, its brim top faces the crown the centroid sits in, and eighteen
     correct faces a pose were reported on every Canadian. The count is still printed,
     as a fact about the shape rather than a miss. */
  if (opt.do.wind) {
    const rows = [];
    variants.forEach(v => {
      let inward = 0, faces = 0, parts = 0, poses = 0, inside = 0;
      const named = [];
      posesOf(v).forEach(P => {
        const r = rec(v, P);
        if (!r.ok || !r.leaves) return;
        poses++;
        r.leaves.forEach((part, pi) => {
          if (!part.length) return;
          parts++;
          const c = cen(part);
          let vol = 0;
          part.forEach(f => {
            const n = faceNormal(f.v[0], f.v[1], f.v[2]);
            if (Math.hypot(n.x, n.y, n.z) < .5) return;
            faces++;
            const fc = fcen(f), d = (fc[0] - c[0]) * n.x + (fc[1] - c[1]) * n.y + (fc[2] - c[2]) * n.z;
            if (d < -1e-4) inward++;
            vol += d * faceArea(f);
          });
          if (vol < 0) { inside++; if (named.length < 6) named.push(label(P) + ' part ' + pi + ' (' + part.length + ' faces)'); }
        });
      });
      rows.push({ v, inward, faces, parts, poses, inside, named, noparts: poses === 0 });
    });
    R.sections.wind = { rows };
  }

  /* ---------------- MATERIAL ---------------- */
  if (opt.do.material) {
    const rows = [];
    variants.forEach(v => {
      ['stand', 'prone'].forEach(name => {
        if (RIG && SOLDIER_VARIANTS[v].set === 'hull' && name !== 'seat') return;
        const r = rec(v, { name: RIG && SOLDIER_VARIANTS[v].set === 'hull' ? 'seat' : name, frame: 0 });
        if (!r.ok) return;
        const tiles = {}; let untagged = 0, alpha = 0, generic = 0;
        r.faces.forEach(f => {
          const mi = f.m !== undefined ? f.m : matOf(f.c), nm = MATS.names[mi];
          tiles[nm] = (tiles[nm] || 0) + 1;
          if (f.m === undefined && MATS.byColour[f.c] === undefined) untagged++;
          if (f.alpha) alpha++;
          if (mi === 0) generic++;
        });
        rows.push({ v, pose: name, faces: r.faces.length, untagged, alpha, generic, tiles });
      });
    });
    /* the tile means, read off the atlas canvas the shader samples */
    function tileMean(name) {
      const mi = matIndex(name); if (mi < 0 || !MATS.atlas) return null;
      const T = MATS.TILE, g = MATS.atlas.getContext('2d');
      const d = g.getImageData((mi % MATS.COLS) * T, Math.floor(mi / MATS.COLS) * T, T, T).data;
      let r = 0, gg = 0, b = 0, a = 0;
      for (let i = 0; i < T * T; i++) { r += d[i * 4]; gg += d[i * 4 + 1]; b += d[i * 4 + 2]; a += d[i * 4 + 3]; }
      const n = T * T * 255;
      return { r: r / n, g: gg / n, b: b / n, a: a / n };
    }
    R.sections.material = { rows, splinter: tileMean('splinter'), scrim: tileMean('scrim'), net: tileMean('net'), tiles: MATS.names.length };
  }

  /* ---------------- SIZE ---------------- */
  if (opt.do.size) {
    const rows = []; let bufs = 0, tris = 0, bytes = 0, runTris = 0;
    const M = MODELS;
    const add = (acc, b, run) => { if (!b) return; acc.bufs++; acc.tris += b.n / 3; acc.bytes += b.n * STRIDE; if (run) acc.run += b.n / 3; };
    Object.keys(SOLDIER_VARIANTS).forEach(v => {
      const acc = { bufs: 0, tris: 0, bytes: 0, run: 0, stand: 0, alpha: 0 };
      if (M.man) {
        const T = M.man[v] || {};
        Object.keys(T).forEach(p => { const s = T[p]; const run = Number(p) === POSE_RUN; (s.frames || [s]).forEach(b => add(acc, b, run)); });
        const st = T[POSE_STAND] || T[POSE_SEAT]; acc.stand = st ? st.n / 3 : 0;
        if (M.fall && (v === 'can_rifle' || v === 'fj_rifle')) { const s = SOLDIER_VARIANTS[v].side; (M.fall[s] || []).forEach(b => add(acc, b)); (M.dead[s] || []).forEach(b => add(acc, b)); }
      } else {
        ['sol', 'solA', 'crawl', 'crawlA'].forEach(k => (M[k][v] || []).forEach(b => add(acc, b)));
        ['prone', 'proneA', 'crouch', 'crouchA', 'fire', 'fireA', 'cfire', 'cfireA'].forEach(k => add(acc, M[k][v]));
        acc.stand = M.sol[v][0].n / 3; acc.alpha = M.solA[v][0] ? M.solA[v][0].n / 3 : 0;
      }
      rows.push({ v, bufs: acc.bufs, tris: Math.round(acc.tris), stand: acc.stand, alpha: acc.alpha, mb: acc.bytes / 1e6 });
      bufs += acc.bufs; tris += acc.tris; bytes += acc.bytes; runTris += acc.run;
    });
    /* what the bake costs, and whether anything in it is NaN */
    let ms = 0, nan = 0;
    if (typeof bakeMen === 'function') { const t = performance.now(); bakeMen(); ms = performance.now() - t; nan = MODELS.nan || 0; }
    else {
      const t = performance.now(), tmp = [];
      Object.keys(SOLDIER_VARIANTS).forEach(v => {
        const lists = [];
        for (let fr = 0; fr < WALKF; fr++) lists.push(soldierModel(v, fr === 0 ? -1 : (fr - 1) / (WALKF - 1)));
        lists.push(proneModel(v));
        if (SOLDIER_VARIANTS[v].weapon !== 'none') {
          lists.push(soldierModel(v, -1, 'crouch'), soldierModel(v, -1, 'fire'), soldierModel(v, -1, 'crouchfire'));
          for (let cf = 0; cf < CRAWLF; cf++) lists.push(proneModel(v, (cf + .5) / CRAWLF));
        }
        lists.forEach(l => { const arr = facesToArray(l); for (let i = 0; i < arr.length; i++) if (arr[i] !== arr[i]) { nan++; break; } tmp.push(makeBuffer(arr)); });
      });
      ms = performance.now() - t;
      tmp.forEach(b => freeBuffer(b));
    }
    /* the draw cost of each section on screen: its men, their standing triangles, and
       the shadow pass on top */
    const sections = [];
    Object.keys(UNITS).forEach(k => {
      const d = UNITS[k]; if (!d.models) return;
      const u = { side: d.side, key: k, target: null, def: d };
      let t = 0, draws = 0;
      for (let i = 0; i < d.models; i++) {
        const v = variantForModel(u, i), row = rows.find(r => r.v === v);
        if (!row) continue;
        t += row.stand + row.alpha; draws += 1 + (row.alpha ? 1 : 0);
      }
      sections.push({ key: k, men: d.models, tris: Math.round(t), draws, depthTris: Math.round(t), depthDraws: d.models });
    });
    R.sections.size = { rows, bufs, tris: Math.round(tris), mb: bytes / 1e6, phoneTris: Math.round(tris - runTris), phoneMb: (bytes - runTris * 3 * STRIDE) / 1e6,
                        bakeMs: ms, nan, sections, table: M.man ? 'MODELS.man' : 'MODELS.sol/prone/crouch/fire/cfire/crawl', mob: !!MOB };
  }
  return R;
}

/* ================================================================ in the page: pixels
   FOOTPRINT and READ, off the framebuffer at play distance. One man of the side's
   riflemen is staged on the flattest spot, and three frames are read for each row: A
   with the man and his shadow, C with castUnit stubbed (the man alone), B with every man
   dead (the ground alone). The figure is C against B and the shadow A against C, over a
   window round him, because a smoke column at the edge of the frame is not the man. */
function PIX(opt) {
  /* the stage is the one the readability critique measured on, so its rows and these
     agree: a spot picked with more room round it lands on brighter ground and reads
     the Canadian four levels lighter, which is a fact about the ground */
  const O = window.__o, spot = O.flatSpot(120);
  const W = cv.width, H = cv.height;
  const realCast = window.castUnit;
  function grab() { render(); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; }
  function stageMan(variant, pose, frame, f) {
    const key = variant.indexOf('fj') === 0 ? 'ger_gren' : 'us_rifle';
    O.pose([{ key, x: 0, y: 0, facing: f }], spot);
    const u = window.G.units[0];
    window.variantForModel = function () { return variant; };
    u.models.forEach((m, i) => { if (i) m.alive = false; });
    const m = u.models[0]; m.x = spot.x; m.y = spot.y; m.f = f;
    return { u, m, id: O.setPose(m, variant, pose, frame) };
  }
  const lum = (b, i) => (b[i] * .299 + b[i + 1] * .587 + b[i + 2] * .114) / 255;
  function measure(A, C, B) {
    /* the window: the man's own screen point, with room for a shadow two and a half
       lengths long */
    const p = w2s(spot.x, spot.y), px = p.x * W / VIEW.w, py = H - p.y * H / VIEW.h;
    const R = Math.round(300 * Math.min(1, W / 1600) + 120);
    const x0 = Math.max(0, Math.round(px - R)), x1 = Math.min(W - 1, Math.round(px + R));
    const y0 = Math.max(0, Math.round(py - R)), y1 = Math.min(H - 1, Math.round(py + R));
    let n = 0, lf = 0, lg = 0, ss = 0, r = 0, g = 0, b = 0, sn = 0;
    let fx0 = 1e9, fx1 = -1, fy0 = 1e9, fy1 = -1, sx0 = 1e9, sx1 = -1, sy0 = 1e9, sy1 = -1;
    const fig = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 4;
      const dc = Math.abs(C[i] - B[i]) + Math.abs(C[i + 1] - B[i + 1]) + Math.abs(C[i + 2] - B[i + 2]);
      if (dc > 18) {
        n++; const lc = lum(C, i), lb = lum(B, i);
        lf += lc; lg += lb; ss += (lc - lb) * (lc - lb); r += C[i]; g += C[i + 1]; b += C[i + 2];
        fig.push([y, lc]);
        if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y;
      }
      const da = Math.abs(A[i] - C[i]) + Math.abs(A[i + 1] - C[i + 1]) + Math.abs(A[i + 2] - C[i + 2]);
      if (da > 18) { sn++; if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y; }
    }
    /* the top fifth of the figure's own height is the crown and the shoulders, the
       bottom fifth the boots; y grows upward in the framebuffer */
    const h = fy1 - fy0, topY = fy1 - h * .2, botY = fy0 + h * .2;
    let tl = 0, tn = 0, bl = 0, bn = 0;
    fig.forEach(q => { if (q[0] >= topY) { tl += q[1]; tn++; } if (q[0] <= botY) { bl += q[1]; bn++; } });
    const k = Math.max(1, n);
    const foot = w2s(spot.x, spot.y), up = w2s(spot.x, spot.y, groundZ(spot.x, spot.y) + 10);
    return { px: n, w: n ? fx1 - fx0 + 1 : 0, h: n ? h + 1 : 0, shadowPx: sn, sw: sn ? sx1 - sx0 + 1 : 0, sh: sn ? sy1 - sy0 + 1 : 0,
             lumFig: lf / k, lumGnd: lg / k, contrast: lg ? (lf - lg) / lg : 0, rms: Math.sqrt(ss / k),
             rgb: [r / k, g / k, b / k], top: tn ? tl / tn : 0, bot: bn ? bl / bn : 0,
             pxPerUnit: Math.abs(up.y - foot.y) / 10 * H / VIEW.h };
  }
  function ground(dist, pitch) {
    const s = stageMan('can_rifle', 'stand', 0, Math.PI / 2);
    s.u.models.forEach(m => { m.alive = false; });
    O.camera({ x: spot.x, y: spot.y, dist, pitch, yaw: Math.PI / 2 });
    return grab();
  }
  function row(variant, pose, frame, f, dist, pitch, B) {
    const s = stageMan(variant, pose, frame, f);
    O.camera({ x: spot.x, y: spot.y, dist, pitch, yaw: Math.PI / 2 });
    const A = grab();
    window.castUnit = function () {};
    const C = grab();
    window.castUnit = realCast;
    const m = measure(A, C, B);
    m.missing = s.id === null;
    return m;
  }
  const FRONT = Math.PI / 2 + .7, SIDE = Math.PI;
  const R = { spot: { x: spot.x, y: spot.y, dev: spot.dev, clear: spot.clear }, W, H, dpr: window.dpr, mob: !!MOB };
  const mid = (variant, pose) => { const fg = O.figure(variant, pose, 0); return fg ? Math.floor(fg.n / 4) : 0; };
  if (opt.do.footprint) {
    R.footprint = [];
    const poses = ['stand', 'walk', 'run', 'kneel', 'prone', 'fire'];
    [600, 900].forEach(dist => {
      const B = ground(dist, .75);
      [['front34', FRONT], ['side', SIDE]].forEach(a => {
        poses.forEach(pose => {
          const m = row('can_rifle', pose, mid('can_rifle', pose), a[1], dist, .75, B);
          R.footprint.push(Object.assign({ dist, angle: a[0], pose }, m));
        });
      });
    });
  }
  if (opt.do.read) {
    R.read = [];
    const dists = MOB ? [[600, .75], [760, 1.0], [900, .75]] : [[600, .75], [900, .75]];
    dists.forEach(dp => {
      const B = ground(dp[0], dp[1]);
      [['us', 'can_rifle'], ['ger', 'fj_rifle']].forEach(sv => {
        ['stand', 'prone'].forEach(pose => {
          const m = row(sv[1], pose, 0, FRONT, dp[0], dp[1], B);
          R.read.push(Object.assign({ dist: dp[0], pitch: dp[1], side: sv[0], variant: sv[1], pose }, m));
        });
      });
    });
  }
  return R;
}

/* ================================================================ run */
async function run(file, label) {
  const browser = await launch();
  const { page } = await openGame(browser, 'desktop', { file, quiet: true });
  await deploy(page, { side: 'us', diff: 1 });
  const doGeo = {};
  SECTIONS.filter(s => s !== 'footprint' && s !== 'read').forEach(s => { doGeo[s] = want(s); });
  const out = { label, pix: {} };
  if (Object.values(doGeo).some(Boolean)) Object.assign(out, await page.evaluate(GEO, { only: ONLY, do: doGeo, verbose: VERBOSE }));
  const doPix = { footprint: want('footprint'), read: want('read') };
  if (doPix.footprint || doPix.read) {
    for (const dev of DEVICES) {
      let p = page;
      if (dev !== 'desktop') { p = (await openGame(browser, dev, { file, quiet: true })).page; await deploy(p, { side: 'us', diff: 1 }); }
      out.pix[dev] = await p.evaluate(PIX, { do: doPix });
    }
  }
  await browser.close();
  return out;
}

/* ================================================================ print */
const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
const f2 = v => (v === null || v === undefined ? '-' : v.toFixed(2));
const f3 = v => (v === null || v === undefined ? '-' : v.toFixed(3));
let MISSES = 0;
function foot(name, n, of, says) {
  MISSES += n;
  console.log('\n  ' + (n ? `${n} ${name} miss${n === 1 ? '' : 'es'}` + (of ? ` of ${of}` : '') : `${name}: all ${of || ''} right`.replace('  ', ' ')) + (says ? `.  ${says}` : ''));
}
/* got / want +err%, a `!` outside the tolerance */
function cell(got, want, tol, base) {
  if (got === null || got === undefined) return { s: pad('-', 18), bad: false };
  const t = Math.min(tol, TOLCAP), err = (got - want) / want, bad = Math.abs(err) > t;
  return { s: pad(`${got.toFixed(2)}/${want.toFixed(2)} ${err >= 0 ? '+' : ''}${(err * 100).toFixed(0)}%${bad ? '!' : ' '}` + (base !== undefined && base !== null ? ` (${base.toFixed(2)})` : ''), 18 + (base !== undefined ? 8 : 0)), bad };
}
function rangeCell(got, lo, hi) {
  if (got === null || got === undefined) return { s: pad('-', 12), bad: false };
  const bad = got < lo || got > hi;
  return { s: pad(`${got.toFixed(2)} [${lo}-${hi}]${bad ? '!' : ' '}`, 14), bad };
}

function show(c, base) {
  const S = c.sections || {};
  if (c.label) console.log(`\n  ${c.label}`);
  console.log(`\n  built through ${c.builder}` + (c.built ? `, ${c.built.ms.toFixed(0)} ms, ${c.built.refused} list${c.built.refused === 1 ? '' : 's'} refused (counts did not sum)` : ''));

  if (S.proportion) {
    const P = S.proportion, BP = base && base.sections && base.sections.proportion;
    console.log('\n  PROPORTION   model / target, units of 8.5 cm, H = 1.73 m = 20.35; got/want +err%, ! outside the tolerance' + (BP ? ', (base) beside' : '') + '\n');
    let bad = 0, of = 0;
    const W = BP ? 26 : 18;
    console.log('  ' + pad('variant', 13) + pad('stature 4%', W) + pad('head h 8%', W) + pad('head w 8%', W) + pad('shoulders 8%', W) + pad('hips 8%', W) + pad('inseam 6%', W) + pad('knee 8%', W) + pad('foot', 14) + pad('helmet 10%', W) + 'joints apart');
    for (const r of P.rows) {
      if (r.refused) { console.log('  ' + pad(r.v, 13) + 'refused: the face list did not partition'); continue; }
      const b = BP ? BP.rows.find(q => q.v === r.v) || {} : {};
      const bc = k => (BP ? (b[k] === undefined ? null : b[k]) : undefined);
      const cells = [cell(r.stature, 20.35, .04, bc('stature')), cell(r.headH, 2.65, .08, bc('headH')), cell(r.headW, 1.82, .08, bc('headW')),
                     cell(r.plate, 5.27, .08, bc('plate')), cell(r.hips, 4.4, .08, bc('hips')), cell(r.inseam, 9.56, .06, bc('inseam')),
                     cell(r.knee, 5.80, .08, bc('knee')), rangeCell(r.foot, 3.1, 3.5), cell(r.helmet, r.side === 'ger' ? 2.94 : 3.53, .10, bc('helmet'))];
      cells.forEach(q => { of++; if (q.bad) bad++; });
      console.log('  ' + pad(r.v, 13) + cells.map(q => q.s).join('') + f2(r.apart));
    }
    console.log('\n  arms, shoulder to elbow and elbow to palm, against 3.79 and 4.07 at 8%: a forearm stretched to a fore-end is what this row is for\n');
    console.log('  ' + pad('variant', 13) + pad('pose', 8) + pad('upper R', 18) + pad('fore R', 18) + pad('upper L', 18) + 'fore L');
    for (const a of P.arms) {
      const cells = [cell(a.upperR, 3.79, .08), cell(a.foreR, 4.07, .08), cell(a.upperL, 3.79, .08), cell(a.foreL, 4.07, .08)];
      cells.forEach(q => { of++; if (q.bad) bad++; });
      console.log('  ' + pad(a.v, 13) + pad(a.pose, 8) + cells.map(q => q.s).join(''));
    }
    const PUB = { lee: 13.29, leescope: 13.29, kar: 13.06, sten: 8.94, mp40: 7.41, bren: 13.6, piat: 11.65, schreck: 19.29, mg42: 14.35, m1919: 15.88, zook: 16.12 };
    console.log('\n  weapons, raw in their own frame, against the published length at 5% (the MP40 folded)\n');
    console.log('  ' + P.weapons.map(w => { const q = cell(w.len, PUB[w.type], .05); of++; if (q.bad) bad++; return pad(w.type, 9) + q.s; }).join('\n  '));
    foot('proportion', bad, of);
  }

  if (S.contact) {
    const C = S.contact;
    console.log('\n  CONTACT   the lowest leg vertex against the ground at z = 0: within 0.25 upright, 0.3 for a kneel or a seat, 0.35 lying down\n');
    let bad = 0, of = 0;
    const byV = {};
    C.rows.forEach(r => { (byV[r.v] = byV[r.v] || []).push(r); });
    console.log('  ' + pad('variant', 13) + pad('stand', 8) + pad('fire', 8) + pad('kneel', 8) + pad('kfire', 8) + pad('walk min/max (frame)', 24) + pad('run min/max', 18) + pad('prone', 8) + pad('crawl', 8) + pad('spread', 8) + 'worst');
    Object.keys(byV).forEach(v => {
      const rows = byV[v], get = n => rows.find(r => r.pose === n);
      const cyc = (name) => { const fr = rows.filter(r => r.cycle === name); if (!fr.length) return null; let lo = fr[0], hi = fr[0]; fr.forEach(r => { if (r.low < lo.low) lo = r; if (r.low > hi.low) hi = r; }); return { lo, hi, spread: hi.low - lo.low }; };
      let worst = null;
      rows.forEach(r => {
        if (r.refused) return;
        of++;
        const tol = r.kind === 'flat' ? .35 : r.kind === 'upright' ? .25 : .3;
        /* a kneel is judged on the leg furthest from the ground, signed, so the worst
           column names the leg through the floor and not the one nearer it */
        const legs = r.legLow.filter(q => q !== null);
        const kz = legs.length ? legs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) : r.low;
        const z = r.kind === 'flat' ? r.bodyLow : r.kind === 'sit' ? r.hipsLow : r.kind === 'kneel' ? kz : r.low;
        const miss = Math.abs(z) > tol;
        if (miss) bad++;
        if (!worst || Math.abs(z) > Math.abs(worst.z)) worst = { pose: r.pose, z, miss };
      });
      const w = cyc('walk'), rn = cyc('run');
      if (w && w.spread > .3) { bad++; }
      of += w ? 1 : 0;
      const p = get('stand'), fi = get('fire'), kn = get('kneel') || get('crouch'), kf = get('kfire') || get('cfire'), pr = get('prone'), cr = rows.filter(r => r.cycle === 'crawl')[0];
      console.log('  ' + pad(v, 13) + pad(p ? f2(p.low) : '-', 8) + pad(fi ? f2(fi.low) : '-', 8) + pad(kn ? f2(kn.low) : '-', 8) + pad(kf ? f2(kf.low) : '-', 8) +
                  pad(w ? `${f2(w.lo.low)}/${f2(w.hi.low)} (${w.lo.pose.replace('walk', '')}/${w.hi.pose.replace('walk', '')})` : '-', 24) +
                  pad(rn ? `${f2(rn.lo.low)}/${f2(rn.hi.low)}` : '-', 18) + pad(pr ? f2(pr.bodyLow) : '-', 8) + pad(cr ? f2(cr.bodyLow) : '-', 8) +
                  pad(w ? f2(w.spread) + (w.spread > .3 ? '!' : '') : '-', 8) + (worst ? `${worst.pose} ${f2(worst.z)}${worst.miss ? ' !' : ''}` : ''));
    });
    console.log(`\n  drawn on purpose, not contact errors: corpses at groundZ - ${C.corpseSink === null ? '?' : C.corpseSink}, commander() at zl - ${C.commanderSink === null ? '?' : C.commanderSink}` + (C.crewLift !== null ? ` + CREW_LIFT ${C.crewLift}` : ' (no CREW_LIFT in this file)'));
    foot('contact', bad, of, 'a frame off the ground by more than its tolerance, or a walk whose planted sole moves more than 0.3 between frames');
  }

  if (S.skate) {
    console.log('\n  SKATE   the planted foot\'s world x over a stance, against the ground a frame stands for: mean under 0.30 of it, no frame over 2.5 (walk) or 3.2 (run)\n');
    let bad = 0, of = 0;
    console.log('  ' + pad('variant', 13) + pad('cycle', 7) + pad('frames', 8) + pad('ground/frame', 14) + pad('skate', 8) + pad('worst', 8) + 'planted x per frame');
    for (const r of S.skate.rows) {
      if (r.none) { console.log('  ' + pad(r.v, 13) + pad(r.cycle, 7) + 'no such cycle in this file'); continue; }
      if (r.refused) { console.log('  ' + pad(r.v, 13) + pad(r.cycle, 7) + 'refused'); continue; }
      of++;
      const lim = r.cycle === 'run' ? 3.2 : 2.5, miss = r.frac > .30 || r.worst > lim;
      if (miss) bad++;
      console.log('  ' + pad(r.v, 13) + pad(r.cycle, 7) + pad(r.n, 8) + pad(f2(r.per), 14) + pad(f2(r.frac) + (r.frac > .30 ? '!' : ''), 8) + pad(f2(r.worst) + (r.worst > lim ? '!' : ''), 8) + r.plants.join(' '));
    }
    console.log('\n  a stride that matched the ground at 64 units a second would turn at 3.2 cycles a second and read as a jog: the');
    console.log('  skate is the price of a cycle turning at 2.3, and at 600 units it is one pixel of foot.');
    foot('skate', bad, of);
  }

  if (S.gravity) {
    console.log('\n  GRAVITY   the surface centroid over the feet, and the spine (hip to skull) within 0.05 rad of the pose\'s lean, forward positive\n');
    let bad = 0, of = 0;
    console.log('  ' + pad('variant', 13) + pad('pose', 8) + pad('centroid x', 12) + pad('feet x', 16) + pad('spine', 8) + pad('lean', 8) + 'note');
    for (const r of S.gravity.rows) {
      of++;
      const over = r.cx >= r.x0 && r.cx <= r.x1, sp = r.lean === null ? true : Math.abs(r.spine - r.lean) <= .05;
      if (!over || !sp) bad++;
      console.log('  ' + pad(r.v, 13) + pad(r.pose, 8) + pad(f2(r.cx) + (over ? ' ' : '!'), 12) + pad(`${f2(r.x0)}..${f2(r.x1)}`, 16) + pad(f2(r.spine) + (sp ? ' ' : '!'), 8) + pad(f2(r.lean), 8) +
                  (!over ? 'not over his feet ' : '') + (!sp ? (r.spine < 0 && r.lean > 0 ? 'leans the other way from the pose' : 'spine off the lean') : ''));
    }
    foot('gravity', bad, of);
  }

  if (S.grip) {
    console.log('\n  GRIP   palm centre to the nearest weapon face, point to triangle, less the half hand of 0.5: within -0.6 and 0.3, or the hand floats or is swallowed\n');
    let bad = 0, of = 0;
    const byV = {};
    S.grip.rows.forEach(r => { (byV[r.v] = byV[r.v] || []).push(r); });
    const gp = v => (v === null ? '-' : v.toFixed(2) + (v < -.6 || v > .3 ? '!' : ''));
    console.log('  ' + pad('variant', 13) + pad('stand R/L', 14) + pad('fire R/L', 14) + pad('kneel R/L', 14) + pad('kfire R/L', 14) + pad('walk worst (frame)', 20) + pad('prone R/L', 14) + 'crawl worst');
    Object.keys(byV).forEach(v => {
      const rows = byV[v];
      if (rows.some(r => r.noparts)) { console.log('  ' + pad(v, 13) + 'no weapon part on the record'); return; }
      const get = n => rows.find(r => r.pose === n);
      const two = r => (r ? `${gp(r.R)}/${gp(r.L)}` : '-');
      const worstOf = name => { let w = null; rows.filter(r => r.pose.indexOf(name) === 0).forEach(r => { [r.R, r.L].forEach(g => { if (g === null) return; const bad2 = Math.max(g - .3, -.6 - g); if (!w || bad2 > w.bad) w = { g, bad: bad2, pose: r.pose }; }); }); return w; };
      rows.forEach(r => { [r.R, r.L].forEach(g => { if (g === null) return; of++; if (g < -.6 || g > .3) bad++; }); });
      const w = worstOf('walk'), c = worstOf('crawl');
      console.log('  ' + pad(v, 13) + pad(two(get('stand')), 14) + pad(two(get('fire')), 14) + pad(two(get('kneel') || get('crouch')), 14) + pad(two(get('kfire') || get('cfire')), 14) +
                  pad(w ? `${gp(w.g)} (${w.pose.replace('walk', '')})` : '-', 20) + pad(two(get('prone')), 14) + (c ? `${gp(c.g)} (${c.pose.replace('crawl', '')})` : '-'));
    });
    console.log('\n  the nearest-vertex version is not to be used: a plain box fore-end has vertices only at its ends and reported a');
    console.log('  hand resting on the rifle as 2.8 units off it.');
    foot('grip', bad, of);
  }

  if (S.clip) {
    console.log('\n  CLIP   one part inside another, sampled at vertices and edge midpoints: over 0.35 is a clip' + (VERBOSE ? '' : ' (the deepest pair per pose; --v for all)') + '\n');
    let bad = 0, of = 0;
    console.log('  ' + pad('variant', 13) + pad('pose', 8) + pad('pair', 30) + 'depth');
    for (const r of S.clip.rows) {
      if (r.noparts) { console.log('  ' + pad(r.v, 13) + pad(r.pose, 8) + 'no parts on the record'); continue; }
      of++; if (r.over) bad++;
      if (!r.pairs.length) continue;
      if (VERBOSE || r.over || !r.pose.match(/^(walk|crawl)\d/) || r.pose === 'walk2') {
        r.pairs.forEach((p, i) => console.log('  ' + pad(i ? '' : r.v, 13) + pad(i ? '' : r.pose, 8) + pad(p.pair, 30) + f2(p.d) + (p.d > .35 ? ' !' : '')));
      }
    }
    foot('clip', bad, of, 'poses with a pair over 0.35');
  }

  if (S.aim) {
    console.log('\n  AIM   in the aimed poses: the bore\'s yaw within 0.05 rad of the facing and its pitch within 0.05 of level; the eye 0.5 to 1.1 above the bore and within 0.9 of it laterally\n');
    let bad = 0, of = 0;
    console.log('  ' + pad('variant', 13) + pad('pose', 8) + pad('yaw', 9) + pad('pitch', 9) + pad('eye up', 9) + 'eye lateral');
    for (const r of S.aim.rows) {
      if (r.noparts) { console.log('  ' + pad(r.v, 13) + pad(r.pose, 8) + 'no bore or eye on the record'); continue; }
      of++;
      const y = Math.abs(r.yaw) > .05, p = Math.abs(r.pitch) > .05, u = r.up < .5 || r.up > 1.1, l = r.lat > .9;
      if (y || p || u || l) bad++;
      console.log('  ' + pad(r.v, 13) + pad(r.pose, 8) + pad(f2(r.yaw) + (y ? '!' : ''), 9) + pad(f2(r.pitch) + (p ? '!' : ''), 9) + pad(f2(r.up) + (u ? '!' : ''), 9) + f2(r.lat) + (l ? '!' : ''));
    }
    foot('aim', bad, of);
  }

  if (S.muzzle) {
    console.log(`\n  MUZZLE   ${S.muzzle.source} against the weapon's furthest point along the bore: within 0.5, or the flash is off the barrel\n`);
    let bad = 0, of = 0;
    const byV = {};
    S.muzzle.rows.forEach(r => { (byV[r.v] = byV[r.v] || []).push(r); });
    console.log('  ' + pad('variant', 13) + pad('stand', 8) + pad('fire', 8) + pad('kneel', 8) + pad('walk worst', 12) + pad('prone', 8) + pad('worst pose', 12) + 'runtime -> barrel end');
    Object.keys(byV).forEach(v => {
      const rows = byV[v];
      if (rows.some(r => r.noparts)) { console.log('  ' + pad(v, 13) + 'no bore on the record'); return; }
      if (rows.some(r => r.noRuntime)) { console.log('  ' + pad(v, 13) + 'no runtime muzzle for this pose'); return; }
      let worst = rows[0];
      rows.forEach(r => { of++; if (r.d > .5) bad++; if (r.d > worst.d) worst = r; });
      const get = n => rows.find(r => r.pose === n), d = r => (r ? f2(r.d) + (r.d > .5 ? '!' : '') : '-');
      let ww = null; rows.filter(r => r.pose.indexOf('walk') === 0).forEach(r => { if (!ww || r.d > ww.d) ww = r; });
      console.log('  ' + pad(v, 13) + pad(d(get('stand')), 8) + pad(d(get('fire')), 8) + pad(d(get('kneel') || get('crouch')), 8) + pad(d(ww), 12) + pad(d(get('prone')), 8) + pad(worst.pose, 12) + `${worst.got.join(',')} -> ${worst.end.join(',')}`);
    });
    foot('muzzle', bad, of);
  }

  if (S.wind) {
    console.log('\n  WIND   parts wound inside out, by the sign of the volume their faces enclose: an inside-out limb is culled and reads as a missing limb\n');
    let bad = 0, of = 0;
    for (const r of S.wind.rows) {
      if (r.noparts) { console.log('  ' + pad(r.v, 13) + 'no parts on the record'); continue; }
      of++; if (r.inside) bad++;
      console.log('  ' + pad(r.v, 13) + lpad(r.inside, 4) + ' inside out of ' + r.parts + ' parts in ' + r.poses + ' poses' + (r.inside ? ' ! ' + r.named.join(', ') : '') +
                  '   (' + r.inward + ' of ' + r.faces + ' faces look at their part\'s centroid: a concave part has some)');
    }
    console.log('\n  the face count is not the test: the Mk II brim top faces the crown its centroid sits in, and counted that way');
    console.log('  eighteen correct faces a pose were reported on every Canadian.');
    foot('wind', bad, of);
  }

  if (S.material) {
    const M = S.material;
    console.log('\n  MATERIAL   what tile each face lands on: untagged 0, alpha 0, generic no more than a quarter of the man\n');
    let bad = 0, of = 0;
    console.log('  ' + pad('variant', 13) + pad('pose', 7) + pad('faces', 7) + pad('untagged', 10) + pad('alpha', 7) + pad('generic', 12) + 'per tile');
    for (const r of M.rows) {
      of++;
      const gshare = r.generic / r.faces, miss = r.untagged > 0 || r.alpha > 0 || gshare > .25;
      if (miss) bad++;
      const tiles = Object.keys(r.tiles).sort((a, b) => r.tiles[b] - r.tiles[a]).map(k => `${k} ${r.tiles[k]}`).join(', ');
      console.log('  ' + pad(r.v, 13) + pad(r.pose, 7) + pad(r.faces, 7) + pad(r.untagged + (r.untagged ? '!' : ''), 10) + pad(r.alpha + (r.alpha ? '!' : ''), 7) + pad(`${r.generic} (${(gshare * 100).toFixed(0)}%)${gshare > .25 ? '!' : ''}`, 12) + tiles);
    }
    const tm = t => (t ? `(${f3(t.r)}, ${f3(t.g)}, ${f3(t.b)})` + (t.a < .999 ? ` alpha ${f3(t.a)}` : '') : 'not in this file');
    console.log(`\n  ${M.tiles} tiles in the atlas. splinter mean ${tm(M.splinter)}, expected (0.396, 0.386, 0.327) repainted, (0.443, 0.438, 0.355) shipped`);
    console.log(`  scrim mean ${tm(M.scrim)}, expected (0.425, 0.431, 0.370) opaque; net mean ${tm(M.net)}`);
    foot('material', bad, of, 'a lit() derivative nobody tagged lands on the generic tile, which has no weave and a different gloss');
  }

  if (S.size) {
    const Z = S.size;
    console.log(`\n  SIZE   the roster as baked, from ${Z.table}${Z.mob ? ' (phone setting)' : ''}\n`);
    console.log('  ' + pad('variant', 13) + lpad('buffers', 8) + lpad('stand tris', 11) + lpad('alpha', 7) + lpad('tris', 9) + lpad('MB', 7));
    for (const r of Z.rows) console.log('  ' + pad(r.v, 13) + lpad(r.bufs, 8) + lpad(r.stand, 11) + lpad(r.alpha, 7) + lpad(r.tris, 9) + lpad(r.mb.toFixed(2), 7));
    console.log('  ' + pad('roster', 13) + lpad(Z.bufs, 8) + lpad('', 11) + lpad('', 7) + lpad(Z.tris, 9) + lpad(Z.mb.toFixed(2), 7) + '   today: 276760 triangles, 289 buffers, 39.85 MB');
    console.log('  ' + pad('phone', 13) + lpad('', 8) + lpad('', 11) + lpad('', 7) + lpad(Z.phoneTris, 9) + lpad(Z.phoneMb.toFixed(2), 7) + '   the same table less the run cycles');
    console.log(`\n  bake ${Z.bakeMs.toFixed(0)} ms, ${Z.nan} buffer${Z.nan === 1 ? '' : 's'} with NaN in ${Z.nan ? 'them' : 'it'}`);
    console.log('\n  a section on screen: colour triangles and draws, and the shadow pass on top\n');
    console.log('  ' + pad('section', 12) + lpad('men', 5) + lpad('tris', 8) + lpad('draws', 7) + lpad('depth tris', 12) + lpad('depth draws', 13));
    for (const s of Z.sections) console.log('  ' + pad(s.key, 12) + lpad(s.men, 5) + lpad(s.tris, 8) + lpad(s.draws, 7) + lpad(s.depthTris, 12) + lpad(s.depthDraws, 13));
    foot('size', Z.nan ? 1 : 0, 1);
  }

  Object.keys(c.pix || {}).forEach(dev => {
    const X = c.pix[dev];
    const head = `${dev} ${X.W}x${X.H} at dpr ${X.dpr}, the stage at ${Math.round(X.spot.x)},${Math.round(X.spot.y)} (height spread ${X.spot.dev.toFixed(1)}, ${X.spot.clear} clear)`;
    if (X.footprint) {
      console.log(`\n  FOOTPRINT   ${head}\n  figure and shadow bounding boxes in framebuffer pixels, one man at pitch 0.75: every pair among stand, walk, run, kneel and prone differs by 6 px in w+h at 600 and 4 at 900; fire differs from stand in width by the same\n`);
      let bad = 0, of = 0;
      console.log('  ' + pad('dist', 6) + pad('angle', 9) + pad('pose', 8) + pad('figure w x h', 15) + pad('px', 7) + pad('shadow w x h', 15) + pad('px', 7) + 'px/unit');
      X.footprint.forEach(r => console.log('  ' + pad(r.dist, 6) + pad(r.angle, 9) + pad(r.pose + (r.missing ? '*' : ''), 8) + pad(`${r.w} x ${r.h}`, 15) + pad(r.px, 7) + pad(`${r.sw} x ${r.sh}`, 15) + pad(r.shadowPx, 7) + r.pxPerUnit.toFixed(2)));
      [600, 900].forEach(dist => ['front34', 'side'].forEach(angle => {
        const need = dist === 600 ? 6 : 4, at = p => X.footprint.find(r => r.dist === dist && r.angle === angle && r.pose === p);
        const set = ['stand', 'walk', 'run', 'kneel', 'prone'];
        for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
          const a = at(set[i]), b = at(set[j]); if (!a || !b) continue;
          of++;
          const d = Math.abs(a.w - b.w) + Math.abs(a.h - b.h);
          if (d < need) { bad++; console.log(`  ! ${dist} ${angle}: ${set[i]} and ${set[j]} differ by ${d} px in w+h` + (a.missing || b.missing ? ' (a posture this file has not got, drawn standing)' : '')); }
        }
        const s = at('stand'), f = at('fire');
        if (s && f) { of++; if (Math.abs(s.w - f.w) < need) { bad++; console.log(`  ! ${dist} ${angle}: fire and stand differ by ${Math.abs(s.w - f.w)} px in width`); } }
      }));
      console.log('\n  * a posture this file has no buffer for is drawn as the standing man, which is what the draw path does with it');
      foot('footprint ' + dev, bad, of);
    }
    if (X.read) {
      console.log(`\n  READ   ${head}\n  the figure off the framebuffer: luminance 0..1, contrast to the ground he replaced, mean RGB 0..255, the top and bottom fifths of his own height, shadow pixels per figure pixel\n`);
      console.log('  ' + pad('dist', 6) + pad('side', 5) + pad('pose', 6) + pad('px', 6) + pad('w x h', 9) + pad('fig', 7) + pad('gnd', 7) + pad('contrast', 10) + pad('rms', 7) + pad('mean RGB', 14) + pad('top', 7) + pad('bot', 7) + 'shadow/fig');
      X.read.forEach(r => console.log('  ' + pad(r.dist, 6) + pad(r.side, 5) + pad(r.pose, 6) + pad(r.px, 6) + pad(`${r.w}x${r.h}`, 9) + pad(f3(r.lumFig), 7) + pad(f3(r.lumGnd), 7) + pad((r.contrast >= 0 ? '+' : '') + f3(r.contrast), 10) + pad(f3(r.rms), 7) +
                                       pad(r.rgb.map(v => Math.round(v)).join(','), 14) + pad(f3(r.top), 7) + pad(f3(r.bot), 7) + (r.px ? (r.shadowPx / r.px).toFixed(2) : '-')));
      let bad = 0, of = 0;
      const phone = X.mob, needTop = phone ? .06 : .10, needMean = phone ? .04 : .05;
      const dists = [...new Set(X.read.map(r => r.dist))];
      dists.forEach(dist => {
        const us = X.read.find(r => r.dist === dist && r.side === 'us' && r.pose === 'stand'), ger = X.read.find(r => r.dist === dist && r.side === 'ger' && r.pose === 'stand');
        if (!us || !ger) return;
        const say = (ok, s) => { of++; if (!ok) { bad++; console.log(`  ! ${dist}: ${s}`); } };
        say(ger.top - us.top >= needTop, `the FJ's top fifth is ${f3(ger.top - us.top)} above the Canadian's, wants ${needTop}`);
        say(Math.abs(ger.lumFig - us.lumFig) >= needMean, `the mean luminance gap is ${f3(Math.abs(ger.lumFig - us.lumFig))}, wants ${needMean}`);
        if (!phone) {
          say(us.top - us.bot >= .04, `the Canadian's top fifth is ${f3(us.top - us.bot)} above his bottom fifth, wants 0.04`);
          say(ger.top - ger.bot >= .18, `the FJ's top fifth is ${f3(ger.top - ger.bot)} above his bottom fifth, wants 0.18`);
          say(us.contrast >= -.45 && us.contrast <= -.10, `the Canadian's contrast to the ground is ${f3(us.contrast)}, wants -0.45 to -0.10`);
          say(ger.contrast >= -.45 && ger.contrast <= -.10, `the FJ's contrast to the ground is ${f3(ger.contrast)}, wants -0.45 to -0.10`);
          const dr = [0, 1, 2].map(i => Math.abs(us.rgb[i] - ger.rgb[i]));
          say(Math.max.apply(null, dr) >= 12, `the sides' mean RGB differ by ${dr.map(Math.round).join(',')} levels, wants 12 in one channel`);
        }
      });
      foot('read ' + dev, bad, of);
    }
  });
  console.log();
}

const cur = await run(GAME, BASE ? 'working file' : null);
let baseRun = null;
if (BASE) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-men-'));
  const f = path.join(tmp, 'ortona.html');
  fs.writeFileSync(f, execFileSync('git', ['show', `${BASE}:ortona.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  baseRun = await run(f, 'BEFORE   ' + BASE);
  fs.rmSync(tmp, { recursive: true, force: true });
}
show(cur, baseRun);
const missesNow = MISSES;
if (baseRun) { MISSES = 0; show(baseRun); }
console.log(missesNow ? `\n${missesNow} miss${missesNow === 1 ? '' : 'es'} on the working file` : '\nthe working file is clean');
process.exit(missesNow ? 1 : 0);
