/* Munitions, muzzle blast and bursts, mechanically.
 *
 * An effect is the one thing in this file a screenshot is worst at reviewing, and not
 * for the usual reason. A model holds still and can be photographed; a muzzle flash
 * lasts seventy-five milliseconds and a frame under SwiftShader is most of a second, so
 * catching one at all is luck. Worse, an effect that is drawn and invisible looks
 * exactly like an effect that is not drawn: this card's own development spent five
 * rounds of screenshots on a smoke column that was being packed, uploaded and rasterised
 * correctly the whole time and was simply the colour of the ground it was drawn over,
 * and then on the same column climbing three hundred units out of the top of the plate.
 * Neither is visible in a picture. Both are one number.
 *
 * So the frame is read rather than looked at. Every row here renders the same scene
 * twice, once with the effect and once without, and reports what the effect actually put
 * on the screen: how many pixels it changed, by how much, and over what patch of world.
 *
 *   node tools/fx.mjs                 the card
 *   node tools/fx.mjs muzzle          one section of it
 *   node tools/fx.mjs --base=HEAD     the same card on an older file, side by side
 *   node tools/fx.mjs --map=gothic    on the other ground
 *
 * MUZZLE is every weapon on the roster fired once from the same spot with the same
 * camera on it. A flash has to be visible, it has to lie along the bore, and a 210mm
 * howitzer has to be a different event from a Lee-Enfield -- which is the whole claim,
 * since every gun in the game used to spawn the same disc at two sizes. `lift` is the
 * mean change over the window and `px` how much of it changed at all; `spread` is the
 * ratio of the biggest to the smallest lift on the card, which is the number that says
 * the roster is differentiated rather than merely loud.
 *
 * BURST is a shell landing, read at five ages, because what was wrong with the old one
 * was its SHAPE IN TIME: a flash and then nothing, with the column and the dust it was
 * supposed to leave behind either absent or invisible. A burst that has gone by three
 * tenths of a second is a burst nobody saw.
 *
 * TRACER is the round in the world. The test that matters is occlusion: these were drawn
 * on the 2D overlay, which is a separate canvas stacked over the WebGL one, so a belt
 * fired at a house was drawn straight across the front of it and no photograph ever said
 * so. The drill puts a wall between the camera and the round and asks whether the round
 * is still on the screen.
 *
 * COST is the packer: quads, bytes and milliseconds a frame, and the draw calls it comes
 * to. The old path was one drawArrays per particle.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openGame, deploy, parseArgs, GAME } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const BASE = args.base === undefined ? null : String(args.base);
const MAP = args.map === undefined ? null : String(args.map);
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const want = s => !only.length || only.includes(s);

async function run(file, label) {
  const browser = await launch();
  const { page, log } = await openGame(browser, 'desktop', { file, quiet: true });
  await deploy(page, { side: 'us', diff: 1, map: MAP || undefined });
  const out = await page.evaluate(({ doMuzzle, doBurst, doTracer, doCost }) => {
    const R = {};

    /* Level, inland, clear for a long way. `flatSpot` hunts for flat ground and finds
       the coastal bench, where the camera looks down a sea cliff and the subject is a
       silhouette; this insists the ground round it is level too. */
    function stage() {
      let best = null, bs = -1;
      for (let x = 500; x < WORLD.w - 500; x += 40) for (let y = 400; y < WORLD.h - 400; y += 40) {
        const z = groundZ(x, y);
        if (z < 6) continue;
        let worst = 0;
        for (let a = 0; a < 12; a++) {
          const dx = Math.cos(a / 12 * 6.283) * 240, dy = Math.sin(a / 12 * 6.283) * 240;
          worst = Math.max(worst, Math.abs(groundZ(x + dx, y + dy) - z));
        }
        if (worst > 10) continue;
        let near = 1e9;
        for (const b of G.blds) near = Math.min(near, Math.hypot(b.x - x, b.y - y));
        for (const p of G.props) near = Math.min(near, Math.hypot(p.x - x, p.y - y));
        if (near < 150) continue;
        const sc = Math.min(near, 600) - worst * 20;
        if (sc > bs) { bs = sc; best = { x, y }; }
      }
      return best || { x: WORLD.w / 2, y: WORLD.h / 2 };
    }
    const F = stage();

    /* ---- reading the frame.
       render() draws to the default framebuffer and the context is not preserved, so the
       pixels have to be read in the same task that drew them. Everything below renders,
       reads, and compares against a reference frame of the same scene with nothing in
       the air: what an effect IS, for the purposes of this card, is the difference. */
    const VW = () => gl.drawingBufferWidth, VH = () => gl.drawingBufferHeight;
    function grab() {
      const w = VW(), h = VH(), px = new Uint8Array(w * h * 4);
      render();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    }
    /* the difference inside a screen box, as the mean lift per pixel (0..1), the share of
       pixels that moved at all, and the box the change actually occupies */
    function diff(a, b, box) {
      const w = VW(), h = VH();
      const x0 = Math.max(0, Math.floor(box.x0)), x1 = Math.min(w, Math.ceil(box.x1));
      const y0 = Math.max(0, Math.floor(box.y0)), y1 = Math.min(h, Math.ceil(box.y1));
      let sum = 0, n = 0, hit = 0, mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
        sum += d; n++;
        if (d > 6) { hit++; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
      }
      return { lift: n ? sum / n / 255 : 0, px: hit, frac: n ? hit / n : 0,
               w: hit ? mxx - mnx : 0, h: hit ? mxy - mny : 0 };
    }
    /* the whole viewport, which is the honest box when the thing under test can go
       anywhere in the frame -- a column climbs and a clod is thrown */
    const FULL = () => ({ x0: 0, y0: 0, x1: VW(), y1: VH() });
    /* A screen point out of w2s is in CSS pixels with y down; readPixels is in device
       pixels with y UP. Getting either wrong puts the window somewhere else in the frame
       and the row reads a clean nought, which looks exactly like an effect that is not
       drawn. */
    function fbBox(p, hw, hh) {
      const sx = VW() / VIEW.w, sy = VH() / VIEW.h;
      return { x0: (p.x - hw) * sx, x1: (p.x + hw) * sx,
               y0: (VIEW.h - p.y - hh) * sy, y1: (VIEW.h - p.y + hh) * sy };
    }

    function look(o) { return window.__o.camera(o); }
    /* advance the simulation by an exact amount without drawing. frame() takes dt off
       `last`, which the previous real frame set most of a second ago, so the first step
       lands on the 50ms clamp and ages a 75ms flash nearly out of existence. */
    function step(sec) {
      const rr = window.render, ra = window.requestAnimationFrame;
      window.render = function () {}; window.requestAnimationFrame = function () { return 0; };
      let t = performance.now(); window.last = t;
      for (let i = 0; i < Math.round(sec / .02); i++) { t += 20; frame(t); }
      window.render = rr; window.requestAnimationFrame = ra;
      window.last = performance.now();
    }
    function clear() { G.units.length = 0; G.fx.length = 0; G.shots.length = 0; G.debris.length = 0; }
    function quiet() { G.ambientSmoke.length = 0; }
    const r2 = v => Math.round(v * 100) / 100;
    const r3 = v => Math.round(v * 1000) / 1000;

    quiet();
    window.__o.reveal();
    G.paused = true;

    /* ---- MUZZLE ---------------------------------------------------------------- */
    if (doMuzzle) {
      const rows = [];
      const KEYS = Object.keys(UNITS).filter(k => UNITS[k].cat && UNITS[k].w && !UNITS[k].hq);
      look({ x: F.x - 40, y: F.y, dist: 210, yaw: -1.1, pitch: .32 });
      for (const key of KEYS) {
        clear(); G.paused = false;
        const def = UNITS[key];
        const u = spawnUnit(def.side, key, F.x - 60, F.y, 0);
        if (!u) continue;
        u.setup = 0; u.lay = 0; u.turret = 0; u.facing = 0; u.cd = 0; u.atcd = 0;
        /* inside the weapon's own reach, measured from the FIRER and not from the stage
           point it is standing sixty units short of: written the other way about, the
           two 165-reach engineer sections were staged at 175 and fired nothing at all,
           and the row read as a weapon with no muzzle flash */
        const e = spawnUnit(def.side === 'us' ? 'ger' : 'us',
                            def.side === 'us' ? 'ger_gren' : 'us_rifle',
                            u.x + Math.min(240, (def.w.range || 300) * .7), F.y, Math.PI);
        G.paused = true;
        const ref = grab();
        G.paused = false;
        u.cd = 0; u.atcd = 0; u.barrage = 0;
        if (def.barrageOnly || def.indirect) { orderBarrage(u, e.x, e.y); u.lay = 0; u.facing = 0; }
        /* Every flash in the game is gated on the firer being on screen, so a row that
           reads nought has two possible causes and they are different faults: the gun
           did not fire, or it fired off camera. The column says which. */
        const on = u.models && u.models[0] ? onScreen(u.models[0].x, u.models[0].y) : onScreen(u.x, u.y);
        fireAt(u, e);
        /* The infantry flash is spawned by updateModels on the frame the man fires and
           lasts 75ms, so what the flash columns are read at matters: read after the
           whole step, two of the roster came back with no flash at all when the game
           was spawning one correctly. */
        step(.02);
        const n = G.fx.filter(f => f.kind === 'flash').length;
        const fl = G.fx.filter(f => f.kind === 'flash')[0];
        step(.02);
        G.paused = true;
        const d = diff(ref, grab(), FULL());
        /* a battery refused its mission is a rule working, not a missing flash: the
           safe radius keeps a gun this heavy out of the enemy's base, and the stage
           point is only guaranteed clear of buildings by 150 */
        rows.push({ key, on: on ? 'yes' : 'NO',
                    cls: fl ? muzClass(u, weaponFor(u, e)) : (def.barrageOnly && !u.barrage ? 'no msn' : '-'),
                    brake: (weaponFor(u, e).brake ? 'yes' : '-'),
                    flash: n, quads: FXN.quads, lift: r3(d.lift), px: d.px,
                    w: d.w, h: d.h, r: fl ? Math.round(fl.r) : 0 });
        clear();
      }
      const lifts = rows.map(r => r.lift).filter(v => v > 0);
      R.muzzle = { rows, spread: lifts.length ? r2(Math.max(...lifts) / Math.min(...lifts)) : 0,
                   blind: rows.filter(r => r.px < 40).map(r => r.key) };
    }

    /* ---- BURST ----------------------------------------------------------------- */
    if (doBurst) {
      const rows = [];
      const AGES = [.02, .15, .40, .90, 1.80];
      look({ x: F.x, y: F.y, dist: 430, yaw: -1.1, pitch: .55 });
      clear(); G.paused = true;
      const ref = grab();
      for (const [name, r] of [['mortar', 58], ['105', 90], ['heavy', 130]]) {
        for (const age of AGES) {
          clear(); G.paused = false;
          explode(F.x, F.y, r, 40, null, null, 6);
          step(age);
          G.paused = true;
          const d = diff(ref, grab(), FULL());
          const zs = G.fx.filter(f => f.z !== undefined).map(f => f.z - groundZ(F.x, F.y));
          rows.push({ name, r, age, fx: G.fx.length, quads: FXN.quads,
                      lift: r3(d.lift), px: d.px, w: d.w, h: d.h,
                      top: zs.length ? Math.round(Math.max.apply(null, zs)) : 0,
                      kinds: [...new Set(G.fx.map(f => f.kind))].join(' ') });
        }
      }
      clear();
      R.burst = { rows };
    }

    /* ---- TRACER ---------------------------------------------------------------- */
    if (doTracer) {
      const rows = [];
      for (const side of ['us', 'ger']) {
        clear(); G.paused = false;
        const u = spawnUnit(side, side === 'us' ? 'us_rifle' : 'ger_gren', F.x - 100, F.y, 0);
        const e = spawnUnit(side === 'us' ? 'ger' : 'us', side === 'us' ? 'ger_gren' : 'us_rifle',
                            F.x + 100, F.y, Math.PI);
        look({ x: F.x, y: F.y, dist: 300, yaw: -1.1, pitch: .30 });
        G.paused = true;
        const ref = grab();
        G.paused = false;
        for (let q = 0; q < 6; q++) { u.cd = 0; fireAt(u, e); }
        step(.03);
        G.paused = true;
        const lit = G.shots.filter(s => s.kind === 'tracer' && s.tr).length;
        const all = G.shots.filter(s => s.kind === 'tracer').length;
        const d = diff(ref, grab(), FULL());
        rows.push({ side, all, lit, lift: r3(d.lift), px: d.px, w: d.w, h: d.h,
                    col: TRACER[side].map(v => Math.round(v * 255)).join(',') });
        clear();
      }

      /* Occlusion, which is the whole reason these moved out of the 2D overlay. A round
         is laid across the SAME patch of screen twice -- once on the far side of a house
         and once on the near side of it -- and what is read is the box the house
         occupies. Drawn on a canvas stacked over the world, both read the same. */
      let occ = null;
      const house = G.props.filter(p => p.kind === 'ruin' && p.w > 110 && p.h > 60)
                           .sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (house) {
        clear(); G.paused = true;
        const hz = groundZ(house.x, house.y);
        /* straight at the house's face, low enough that the wall stands across the view */
        look({ x: house.x, y: house.y, dist: 300, yaw: Math.PI, pitch: .45 });
        const ref = grab();
        const lay = (dx) => {
          G.shots.length = 0;
          for (let i = 0; i < 7; i++)
            G.shots.push({ kind: 'tracer', x: house.x + dx, y: house.y - 130,
                           sx: house.x + dx, sy: house.y - 130,
                           tx: house.x + dx, ty: house.y + 130,
                           /* mid-flight, so the round is across the middle of the box */
                           t: .08 + i * .002, dur: .16, tail: .5, z0: 30, tr: 1,
                           col: TRACER.us, side: 'us' });
        };
        /* The whole frame rather than a window on the wall: the two rounds are 320
           units apart in depth and so land on different patches of screen, and a window
           sized to either one reads a nought for the other. Nothing else in the scene
           moves between the two grabs, so the frame IS the measurement. */
        lay(house.w / 2 + 40);                       /* behind the house from here */
        let g = grab();
        const behind = diff(ref, g, FULL());
        lay(-(house.w / 2 + 40));                    /* in front of it */
        g = grab();
        const front = diff(ref, g, FULL());
        G.shots.length = 0;
        occ = { w: Math.round(house.w), h: Math.round(house.h),
                behind: r3(behind.lift), front: r3(front.lift),
                bpx: behind.px, fpx: front.px,
                hidden: behind.px < Math.max(20, front.px * .1) };
      }
      R.tracer = { rows, occ };
    }

    /* ---- COST ------------------------------------------------------------------ */
    if (doCost) {
      clear(); G.paused = false;
      look({ x: F.x, y: F.y, dist: 600, yaw: -1.1, pitch: .7 });
      for (let i = 0; i < 6; i++) explode(F.x + rnd(-200, 200), F.y + rnd(-200, 200), 110, 40, null, null, 6);
      step(.1);
      G.paused = true;
      render();
      const quads = FXN.quads, draws = FXN.draws;
      let t0 = performance.now();
      for (let i = 0; i < 40; i++) { PART.a.n = 0; PART.b.n = 0; drawParticles3D(); }
      const pack = (performance.now() - t0) / 40;
      PART.a.n = 0; PART.b.n = 0;
      t0 = performance.now();
      for (let i = 0; i < 20; i++) render();
      const frameMs = (performance.now() - t0) / 20;
      R.cost = { fx: G.fx.length, quads, draws, pack: Math.round(pack * 100) / 100,
                 frame: Math.round(frameMs), cap: FXCAP,
                 bytes: Math.round((PART.a.f.length + PART.b.f.length) * 4 / 1024),
                 stride: PSTRIDE };
      clear();
    }
    return R;
  }, { doMuzzle: want('muzzle'), doBurst: want('burst'), doTracer: want('tracer'), doCost: want('cost') });
  out.label = label;
  out.errors = log.errors;
  await browser.close();
  return out;
}

const pad = (s, n) => String(s).padEnd(n);
const lp = (s, n) => String(s).padStart(n);

function show(c) {
  if (c.label) console.log(`\n  ${c.label}`);
  if (c.errors && c.errors.length) console.log('  ! ' + c.errors.length + ' console errors: ' + c.errors[0]);

  if (c.muzzle) {
    console.log('\n  MUZZLE   one round from each weapon, from the same spot with the same camera on it\n');
    console.log('  ' + pad('unit', 14) + pad('class', 8) + lp('brake', 6) + lp('seen', 6) + lp('r', 5) +
                lp('quads', 7) + lp('lift', 8) + lp('px', 7) + lp('w', 5) + lp('h', 5));
    for (const r of c.muzzle.rows)
      console.log('  ' + pad(r.key, 14) + pad(r.cls, 8) + lp(r.brake, 6) + lp(r.on, 6) + lp(r.r, 5) +
                  lp(r.quads, 7) + lp(r.lift.toFixed(3), 8) + lp(r.px, 7) + lp(r.w, 5) + lp(r.h, 5));
    console.log('\n  ' + pad('biggest blast over smallest', 32) + lp(c.muzzle.spread + 'x', 8) +
                '   a roster, not one disc at two sizes');
    console.log('  ' + pad('weapons that put nothing on screen', 32) +
                lp(c.muzzle.blind.length, 8) + (c.muzzle.blind.length ? '   ' + c.muzzle.blind.join(' ') : ''));
  }

  if (c.burst) {
    console.log('\n  BURST    a shell landing, read at five ages: what is on the screen, and how high it has got\n');
    console.log('  ' + pad('shell', 8) + lp('r', 5) + lp('age', 7) + lp('fx', 5) + lp('quads', 7) +
                lp('lift', 8) + lp('px', 8) + lp('w', 6) + lp('h', 6) + lp('top', 6) + '  what is left');
    for (const r of c.burst.rows)
      console.log('  ' + pad(r.name, 8) + lp(r.r, 5) + lp(r.age.toFixed(2), 7) + lp(r.fx, 5) + lp(r.quads, 7) +
                  lp(r.lift.toFixed(3), 8) + lp(r.px, 8) + lp(r.w, 6) + lp(r.h, 6) + lp(r.top, 6) + '  ' + r.kinds);
  }

  if (c.tracer) {
    console.log('\n  TRACER   a section\'s volley, by side\n');
    console.log('  ' + pad('side', 6) + lp('rounds', 8) + lp('burning', 9) + lp('lift', 8) +
                lp('px', 7) + lp('w', 5) + lp('h', 5) + '   colour');
    for (const r of c.tracer.rows)
      console.log('  ' + pad(r.side, 6) + lp(r.all, 8) + lp(r.lit, 9) + lp(r.lift.toFixed(3), 8) +
                  lp(r.px, 7) + lp(r.w, 5) + lp(r.h, 5) + '   ' + r.col);
    const o = c.tracer.occ;
    if (o) {
      console.log(`\n  and the same round laid across the same patch of screen, with a ${o.w} x ${o.h} house`);
      console.log('  on the near side of it and then on the far side\n');
      console.log('  ' + pad('', 22) + lp('lift', 8) + lp('px', 9));
      console.log('  ' + pad('in front of the wall', 22) + lp(o.front.toFixed(3), 8) + lp(o.fpx, 9));
      console.log('  ' + pad('behind it', 22) + lp(o.behind.toFixed(3), 8) + lp(o.bpx, 9) +
                  '   ' + (o.hidden ? 'the wall hides it' : '! drawn straight through the wall'));

    }
  }

  if (c.cost) {
    const k = c.cost;
    console.log('\n  COST     six bursts in the air at once\n');
    console.log('  ' + pad('effects live', 26) + lp(k.fx, 8) + '   of a cap of ' + k.cap);
    console.log('  ' + pad('quads packed', 26) + lp(k.quads, 8));
    console.log('  ' + pad('draw calls for all of them', 26) + lp(k.draws, 8) + '   it was one a particle');
    console.log('  ' + pad('packing them', 26) + lp(k.pack.toFixed(2) + ' ms', 8) + '   a frame');
    console.log('  ' + pad('the whole frame', 26) + lp(k.frame + ' ms', 8) + '   SwiftShader, so a shape and not a figure');
    console.log('  ' + pad('the two buffers', 26) + lp(k.bytes + ' kB', 8) + '   at ' + k.stride + ' floats a vertex');
  }
  console.log();
}

const cur = await run(GAME, BASE ? 'working file' : null);
show(cur);
if (BASE) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-fx-'));
  const f = path.join(tmp, 'ortona.html');
  fs.writeFileSync(f, execFileSync('git', ['show', `${BASE}:ortona.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  show(await run(f, 'BEFORE   ' + BASE));
  fs.rmSync(tmp, { recursive: true, force: true });
}
