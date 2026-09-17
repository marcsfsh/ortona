#!/usr/bin/env node
/* Smoke-check Ortona.
 *
 *   node tools/check.mjs                 desktop + phone, 180s of simulated battle
 *   node tools/check.mjs --sim=900       run a long battle and watch for throws
 *   node tools/check.mjs --device=phone  one device only
 *   node tools/check.mjs --shots         also leave evidence in shots/check/
 *
 * Exits non-zero on any failure, so it works as a pre-commit gate.
 */

import { launch, openGame, deploy, openEditor, fastForward, frames, state, camera,
         shoot, reload, parseArgs, DEVICES } from './harness.mjs';
import path from 'node:path';
import { SHOTS } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const SIM = args.sim === undefined ? 180 : Number(args.sim);
const KEEP = !!args.shots;
const TARGETS = args.device ? [args.device] : ['desktop', 'phone'];

/* Apple's own guidance, and the floor for a usable control under a thumb. */
const MIN_TAP = 44;

let failures = 0, checks = 0;
function ok(name, pass, detail = '') {
  checks++;
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

const browser = await launch();

for (const device of TARGETS) {
  console.log(`\n=== ${device} (${DEVICES[device].viewport.width}x${DEVICES[device].viewport.height} @${DEVICES[device].deviceScaleFactor ?? 1}x) ===`);
  const { page, context, log, gl } = await openGame(browser, device, { quiet: true });

  ok('WebGL context', gl.ok, `${gl.gl2 ? 'webgl2' : 'webgl1'}, shadows ${gl.shadows ? 'on' : 'off'}`);
  ok('touch layout matches device', gl.mob === !!DEVICES[device].hasTouch, `MOB=${gl.mob}`);

  /* --- the title screen --- */
  const startFits = await page.evaluate(() => ({
    hScroll: document.documentElement.scrollWidth - window.innerWidth,
    offscreen: [...document.querySelectorAll('#start button, #start .brief')]
      .filter(e => { const r = e.getBoundingClientRect();
                     return r.width && (r.left < -1 || r.right > window.innerWidth + 1); })
      .map(e => e.id || e.className)
  }));
  ok('title screen does not scroll sideways', startFits.hScroll <= 0, `overflow ${startFits.hScroll}px`);
  ok('title screen controls stay on screen', startFits.offscreen.length === 0, startFits.offscreen.join(', '));

  /* --- deploy and fight --- */
  const tDeploy = Date.now();
  await deploy(page, { side: args.side || 'us', diff: args.diff === undefined ? 1 : Number(args.diff) });
  ok('deploys into a battle', true, `${((Date.now() - tDeploy) / 1000).toFixed(1)}s to first frame`);

  const before = await state(page);
  ok('scene built', before.sceneReady && before.units > 0 && before.blds === 2,
     `${before.units} units, ${before.blds} buildings`);

  const tSim = Date.now();
  const after = await fastForward(page, SIM);
  const wall = (Date.now() - tSim) / 1000;
  /* fastForward stops early when a side wins, which is a finished battle, not
   * a failure. Say which happened so a short clock does not read as a hang. */
  const ended = after && after.over;
  ok(ended ? `battle reached a decision inside ${SIM}s` : `survives ${SIM}s of battle`,
     !!after,
     `clock ${after ? after.t.toFixed(0) : '?'}s${ended ? ` (${after.over} won)` : ''}, ` +
     `${after ? after.units : '?'} units alive, ${((after ? after.t : SIM) / wall).toFixed(0)}x realtime`);

  const mid = await state(page);
  ok('economy is running', mid.res.us.mp !== 420 || mid.res.ger.mp !== 420,
     `MP us ${mid.res.us.mp | 0} / ger ${mid.res.ger.mp | 0}`);
  if (mid.over) console.log(`  note: the battle ended at ${mid.t.toFixed(0)}s (${mid.over} won); HUD checks below run on the end state`);
  ok('victory points are being contested', mid.res.us.vp !== 420 || mid.res.ger.vp !== 420,
     `VP us ${mid.res.us.vp | 0} / ger ${mid.res.ger.vp | 0}`);
  ok('both sides still in the field', mid.unitsBySide.us > 0 && mid.unitsBySide.ger > 0,
     `us ${mid.unitsBySide.us}, ger ${mid.unitsBySide.ger}`);

  /* --- the postures a battle actually reaches. A pose that is written, baked and never
     chosen looks exactly like a pose that is not there, and standing was for the life of
     the game the whole of what a man did whenever he was not pulling a trigger. Sampled
     over twenty seconds rather than at one instant, because one frame catches whatever
     the battle happened to be doing on it. Twenty samples and not ten: counted every
     frame of a forty-second battle the weapon is up on 1.7 per cent of man-frames, which
     ten instants two seconds apart can miss entirely and did. --- */
  const poses = {};
  for (let i = 0; i < 20; i++) {
    await fastForward(page, 1);
    const s = await page.evaluate(() => {
      const names = {}, out = {};
      Object.keys(window).filter(k => /^POSE_/.test(k)).forEach(k => { names[window[k]] = k.slice(5).toLowerCase(); });
      window.G.units.forEach(u => {
        if (u.dead || u.cat === 'veh' || !u.models) return;
        u.models.forEach(m => { if (m.alive) { const n = names[m.pose] || m.pose; out[n] = (out[n] || 0) + 1; } });
      });
      return out;
    });
    Object.keys(s).forEach(k => { poses[k] = (poses[k] || 0) + s[k]; });
  }
  const upright = (poses.stand || 0) + (poses.ready || 0);
  const kinds = Object.keys(poses).length;
  ok('the men reach their postures, not only standing', upright > 0 && (poses.walk || 0) > 0 && kinds >= 3,
     Object.keys(poses).sort((a, b) => poses[b] - poses[a]).map(k => `${k} ${poses[k]}`).join(', '));

  /* --- clicking the men. A section is not its marker: its men walk to their formation
     places and then to whatever cover the section chose, which the cover pass allows a
     hundred and eighteen units away. Measured on a real battle, near half of the
     player's own men stand further from their marker than a click could reach, so a
     player who clicked what he could see selected nothing. --- */
  const pick = await page.evaluate(() => {
    let men = 0, far = 0, hit = 0, worst = 0;
    window.G.units.forEach(u => {
      if (u.dead || u.inside || !u.models || u.side !== window.G.side) return;
      u.models.forEach(m => {
        if (!m.alive) return;
        men++;
        const d = Math.hypot(m.x - u.x, m.y - u.y), reach = window.unitRadius(u) + 10;
        if (d > worst) worst = d;
        if (d > reach) { far++; if (window.unitsAt(m.x, m.y, 10).indexOf(u) >= 0) hit++; }
      });
    });
    return { men, far, hit, worst: +worst.toFixed(0) };
  });
  ok('a click on a man selects his section, wherever he has walked to',
     pick.men > 0 && pick.hit === pick.far,
     `${pick.men} men, ${pick.far} of them past a click's reach of their marker, ${pick.hit} still selectable; furthest ${pick.worst}`);

  /* --- the dead, and what it costs to draw them. The list runs to two hundred and
     twenty and every one of them used to be drawn every frame wherever it lay, off
     screen or not. Count the binds in a real frame rather than reading the loop. --- */
  const dead = await page.evaluate(() => {
    const M = window.MODELS;
    if (!M.dead || !M.dead.us) return { table: false };
    const bufs = new Set([].concat(M.dead.us || [], M.dead.ger || [], M.fall.us || [], M.fall.ger || []));
    let binds = 0;
    const real = window.drawGeom;
    window.drawGeom = function (b) { if (bufs.has(b)) binds++; return real.apply(null, arguments); };
    window.render();
    window.drawGeom = real;
    const v = window.view();
    const inv = window.G.corpses.filter(c => window.inView(v, c.x, c.y, 40)).length;
    /* A battle of this length leaves a handful of bodies and they are all on screen, so
       the cull and the cap go untested by it. Stage them: two hundred off the far side of
       the map, which must add nothing at all to the binds, then two hundred under the
       camera, which must stop at sixty. Put the real list back afterwards. */
    const keep = window.G.corpses.slice();
    const lay = (x, y) => { for (let i = 0; i < 200; i++) window.G.corpses.push({ x, y, a: 0, t: 1, side: 'us', k: i & 1 }); };
    window.G.corpses.length = 0; lay(v.x + v.w + 2000, v.y + v.h + 2000);
    let away = 0; window.drawGeom = function (b) { if (bufs.has(b)) away++; return real.apply(null, arguments); };
    window.render(); window.drawGeom = real;
    window.G.corpses.length = 0; lay(v.x + v.w / 2, v.y + v.h / 2);
    let near = 0; window.drawGeom = function (b) { if (bufs.has(b)) near++; return real.apply(null, arguments); };
    window.render(); window.drawGeom = real;
    window.G.corpses.length = 0; keep.forEach(c => window.G.corpses.push(c));
    return { table: true, corpses: keep.length, falls: window.G.falls.length, inView: inv, binds, away, near };
  });
  ok('the dead are drawn where they can be seen, and sixty of them at most',
     dead.table && dead.binds <= dead.inView + dead.falls && dead.away === dead.falls && dead.near <= 60 + dead.falls,
     dead.table ? `${dead.corpses} on the ground, ${dead.inView} in view, ${dead.binds} drawn; of 200 staged off the map ${dead.away - dead.falls} drawn, of 200 under the camera ${dead.near - dead.falls}`
                : 'no MODELS.dead table in this file');

  /* --- draw rate, measured on the real renderer --- */
  const tDraw = Date.now();
  await frames(page, 4);
  const ms = (Date.now() - tDraw) / 4;
  ok('renders frames', ms > 0, `${ms.toFixed(0)} ms/frame under SwiftShader (a GPU is far faster; this is not an FPS estimate)`);

  /* --- in-game HUD fits the screen ---
   * Select an HQ and a squad first: the orders row and the production cards
   * only exist once something is selected, and those are the controls a thumb
   * actually has to hit. */
  await page.evaluate(() => {
    const b = window.G.blds.find(b => b.side === window.G.side && b.def.hq);
    if (b) { select([b]); syncHud(); }
  });
  await frames(page, 1);
  const hudBuild = await page.evaluate(() => document.querySelectorAll('#cmds .cmd').length);
  ok('production cards render when the HQ is selected', hudBuild > 0, `${hudBuild} cards`);

  await page.evaluate(() => {
    const u = window.G.units.find(u => u.side === window.G.side);
    if (u) { select([u]); syncHud(); }
  });
  await frames(page, 1);
  const hudOrders = await page.evaluate(() => document.querySelectorAll('#cmds .cmd').length);
  ok('order cards render when a squad is selected', hudOrders > 0, `${hudOrders} cards`);

  const hud = await page.evaluate(minTap => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const seen = [];
    const small = [];
    for (const sel of ['#tools .tool', '#cmds .cmd', '#bar button', '#queue .qi']) {
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        seen.push(sel);
        if (r.width < minTap || r.height < minTap) small.push(`${sel} ${r.width | 0}x${r.height | 0}`);
      }
    }
    const bar = document.getElementById('bar').getBoundingClientRect();
    const top = document.getElementById('top').getBoundingClientRect();
    return { hScroll: document.documentElement.scrollWidth - vw,
             vScroll: document.documentElement.scrollHeight - vh,
             barBelow: Math.round(bar.bottom - vh), topAbove: Math.round(-top.top),
             controls: seen.length, small };
  }, MIN_TAP);
  ok('battle HUD does not scroll', hud.hScroll <= 0 && hud.vScroll <= 0, `h ${hud.hScroll} v ${hud.vScroll}`);
  ok('command bar sits inside the viewport', hud.barBelow <= 1, `${hud.barBelow}px below the fold`);
  ok('resource strip sits inside the viewport', hud.topAbove <= 1, `${hud.topAbove}px above the fold`);
  if (DEVICES[device].hasTouch) {
    ok(`touch targets are at least ${MIN_TAP}px`, hud.small.length === 0,
       hud.small.slice(0, 4).join('; ') || `${hud.controls} controls checked`);
  }

  /* --- the periscope: a look from a unit, turned by a drag, and back --- */
  const pov = await page.evaluate(() => {
    const u = window.G.units.find(u => u.side === window.G.side && !u.dead && u.cat !== 'veh') || window.G.units.find(u => u.side === window.G.side && !u.dead);
    if (!u) return { ok: false };
    window.select([u], false);
    document.getElementById('tPov').click();
    window.updateCamera();
    const eye = window.povEye(), e = { x: window.MAT.eye.x, y: window.MAT.eye.y, z: window.MAT.eye.z };
    const yaw0 = window.POV.yaw; window.povLook(120, 0); const yaw1 = window.POV.yaw;
    return { ok: true, on: window.POV.on, near: Math.hypot(e.x - eye.x, e.y - eye.y) < 1 && Math.abs(e.z - eye.z) < 1, turned: Math.abs(yaw1 - yaw0) > .3, height: +(e.z - window.groundZ(e.x, e.y)).toFixed(1), btn: document.getElementById('tPov').classList.contains('on') };
  });
  await frames(page, 2);
  const povOff = await page.evaluate(() => { document.getElementById('tPov').click(); return !window.POV.on && !document.getElementById('tPov').classList.contains('on'); });
  ok('periscope looks from the unit, turns with a drag, and closes', pov.ok && pov.on && pov.near && pov.turned && pov.btn && povOff, `eye ${pov.height} above the ground`);

  /* --- the men's table: one buffer a pose, nothing NaN in it, and a rebuild that frees
     what it replaces. A part built from an undefined constant is NaN and vanishes with
     no error at all, and the bake used to leak every man on the roster on a restart. --- */
  const men = await page.evaluate(() => {
    const M = window.MODELS;
    if (!M.man) return { table: false };
    let poses = 0, frames = 0;
    Object.keys(M.man).forEach(v => Object.keys(M.man[v]).forEach(pz => {
      poses++; const set = M.man[v][pz]; frames += set.frames ? set.frames.length : 1;
    }));
    const before = M.nan;
    window.bakeMen();
    return { table: true, variants: Object.keys(M.man).length, poses, frames,
             nan: M.nan, wasNan: before, freed: M.freed,
             eye: M.eye.can_rifle ? +M.eye.can_rifle[window.POSE_STAND].toFixed(1) : null };
  });
  ok('the men bake into one table, with nothing NaN and nothing leaked', men.table && men.nan === 0 && men.wasNan === 0 && men.freed >= men.frames,
     men.table ? `${men.variants} variants, ${men.poses} poses, ${men.frames} buffers, ${men.freed} freed on a rebuild, eye ${men.eye} standing`
               : 'no MODELS.man table in this file');

  /* --- the mortars: the first weapon here that shoots what it cannot see. Three claims
     worth a row. It needs no line, so it drops bombs through a building. It still needs
     the target SEEN, by the side rather than by itself, which is what keeps it honest. And
     a fire mission lands where it was laid, inside the circle the player is shown.
       Staged on the map's own buildings so the blocker is the game's, and it puts back
     what it borrowed: everything after this needs the battle intact. --- */
  const mor = await page.evaluate(() => {
    const key = window.G.side === 'us' ? 'us_mor' : 'ger_mor';
    if (!window.UNITS[key] || !window.UNITS[key].indirect) return { has: false };
    const keep = window.G.units.slice(), shots = window.G.shots.slice();
    const foe = window.G.side === 'us' ? 'ger' : 'us';
    const b = window.G.blds[0], a = Math.PI / 2, R = 190;
    function stage(withEyes) {
      window.G.units.length = 0; window.G.shots.length = 0;
      const u = window.spawnUnit(window.G.side, key, b.x - Math.cos(a) * R, b.y - Math.sin(a) * R, a);
      const e = window.spawnUnit(foe, foe === 'ger' ? 'ger_gren' : 'us_rifle',
                                 b.x + Math.cos(a) * R, b.y + Math.sin(a) * R, a + Math.PI);
      u.setup = 0;
      if (withEyes) {
        const o = window.spawnUnit(window.G.side, window.G.side === 'us' ? 'us_rifle' : 'ger_gren',
                                   e.x + 120, e.y + 40, a + Math.PI);
        o.setup = 0;
      }
      window.computeVisibility();
      return { u, e };
    }
    function runFor(s, secs) {
      let fired = 0;
      for (let f = 0; f < 60 * secs; f++) {
        window.computeVisibility();
        s.u.target = window.acquire(s.u) || null;
        const n = window.G.shots.length;
        window.updateUnit(s.u, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60;
        if (window.G.shots.length > n) fired++;
      }
      return fired;
    }
    const blind = stage(false);
    const line = window.fireLine(blind.u, blind.e);
    const unobserved = runFor(blind, 40);
    const seenS = stage(true);
    const observed = runFor(seenS, 40);
    /* and a mission, laid past the range the tube engages on its own */
    window.G.units.length = 0; window.G.shots.length = 0;
    const m = window.spawnUnit(window.G.side, key, 600, 900, 0);
    m.setup = 0;
    const B = m.def.barrage, tx = 600 + Math.round((B.range + m.def.w.range) / 2), ty = 900;
    const laid = window.orderBarrage(m, tx, ty);
    const far = window.orderBarrage(m, 600 + B.range + 120, 900);
    const out = [];
    /* run on past the end: the last bomb is counted by seeing it leave the list, and a
       loop that stops the moment the list empties never sees the one that emptied it */
    let quiet = 0;
    for (let f = 0; f < 60 * 90 && quiet < 30; f++) {
      const before = window.G.shots.slice();
      window.updateUnit(m, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60;
      before.forEach(sh => {
        if (sh.kind === 'shell' && window.G.shots.indexOf(sh) < 0)
          out.push(Math.hypot(sh.tx - tx, sh.ty - ty));
      });
      quiet = (m.barrage || window.G.shots.length) ? 0 : quiet + 1;
    }
    window.G.units.length = 0; keep.forEach(q => window.G.units.push(q));
    window.G.shots.length = 0; shots.forEach(q => window.G.shots.push(q));
    /* A mission aims anywhere inside its circle and then has its own round-to-round
       scatter on top, so the honest bound on a bomb is the circle plus that scatter.
       Asserting the circle alone failed on one round in ten, which is the scatter doing
       exactly what it is there for.
         The count inside the drawn circle is the loose one and has to be read that way:
       an aim point is uniform in the circle, so a round near its edge is thrown outside
       by the scatter about as often as not. Ten runs of unchanged code put it at 7, 8, 9
       and 10 of ten, and an assertion pinned at eight failed on the fourth run of a day.
       `inBound` is the claim; this is a floor under how much of the mission the player is
       shown honestly. */
    const bound = B.r + 14;
    return { has: true, line, unobserved, observed, laid, far,
             rounds: out.length, want: B.rounds, r: B.r, bound,
             inCircle: out.filter(d => d <= B.r).length,
             inBound: out.filter(d => d <= bound).length,
             past: tx - 600 > m.def.w.range };
  });
  ok('a mortar shells what the side can see, over what is in the way, and lands where it is laid',
     !mor.has || (mor.line === false && mor.unobserved === 0 && mor.observed > 0 &&
                  mor.laid && !mor.far && mor.past && mor.rounds === mor.want &&
                  mor.inBound === mor.rounds && mor.inCircle >= mor.rounds - 4),
     !mor.has ? 'no indirect weapon in this file'
              : `through a building: ${mor.unobserved} rounds unobserved, ${mor.observed} with eyes on; ` +
                `a mission past free-fire range fired ${mor.rounds} of ${mor.want}, ${mor.inCircle} inside ${mor.r} and ` +
                `${mor.inBound} inside ${mor.bound}, and out of range was refused`);

  /* --- the pack howitzers, which are the mortar's claims turned round. The mortar fires
     on its own account and the gun never does, so what is worth asserting is the refusal:
     an enemy plainly in sight, well inside the gun's reach, and not one round in a minute
     of it. Then the same gun with a mission on it, to show the refusal is the flag and not
     a broken weapon. And the setup, which is the one mechanic the mortar row zeroed out:
     a mission laid on a gun that has just been put down waits for the crew. --- */
  const how = await page.evaluate(() => {
    const key = window.G.side === 'us' ? 'us_how' : 'ger_how';
    if (!window.UNITS[key] || !window.UNITS[key].barrageOnly) return { has: false };
    const keep = window.G.units.slice(), shots = window.G.shots.slice();
    const foe = window.G.side === 'us' ? 'ger' : 'us';
    function clear() { window.G.units.length = 0; window.G.shots.length = 0; }
    function run(u, secs) {
      let fired = 0;
      for (let f = 0; f < 60 * secs; f++) {
        window.computeVisibility();
        u.target = window.acquire(u) || null;
        const n = window.G.shots.length;
        window.updateUnit(u, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60;
        if (window.G.shots.length > n) fired++;
      }
      return fired;
    }
    /* In the open, in daylight, well inside the gun's OWN eye -- half the barrage range
       is outside it, and a target the side cannot see proves nothing about a rule that is
       meant to refuse targets it can. Seeing is a rate now, so the flag is read after the
       minute rather than off one call to computeVisibility. */
    clear();
    const g = window.spawnUnit(window.G.side, key, 600, 900, 0);
    g.setup = 0;
    const B = g.def.barrage, D = Math.round(Math.min(B.range / 2, g.def.sight - 60));
    const e = window.spawnUnit(foe, foe === 'ger' ? 'ger_gren' : 'us_rifle', 600 + D, 900, Math.PI);
    window.computeVisibility();
    const idle = run(g, 60);
    const seen = window.G.side === 'us' ? e.vUs : e.vGer;
    const picked = window.acquire(g);
    /* and the same gun, told to shell the ground he is standing on */
    const laid = window.orderBarrage(g, e.x, e.y);
    const out = [];
    let quiet = 0;
    for (let f = 0; f < 60 * 120 && quiet < 30; f++) {
      const before = window.G.shots.slice();
      window.updateUnit(g, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60;
      before.forEach(sh => {
        if (sh.kind === 'shell' && window.G.shots.indexOf(sh) < 0)
          out.push(Math.hypot(sh.tx - e.x, sh.ty - e.y));
      });
      quiet = (g.barrage || window.G.shots.length) ? 0 : quiet + 1;
    }
    /* the crew have to get it into action first: a mission on a gun just put down waits */
    clear();
    const h = window.spawnUnit(window.G.side, key, 600, 900, 0);
    h.setup = h.def.setup;
    window.orderBarrage(h, 600 + D, 900);
    let early = 0;
    for (let f = 0; f < 60 * Math.max(1, h.def.setup - 1); f++) {
      const n = window.G.shots.length;
      window.updateUnit(h, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60;
      if (window.G.shots.length > n) early++;
    }
    let after = 0;
    for (let f = 0; f < 60 * 20; f++) {
      const n = window.G.shots.length;
      window.updateUnit(h, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60;
      if (window.G.shots.length > n) after++;
    }
    window.G.units.length = 0; keep.forEach(q => window.G.units.push(q));
    window.G.shots.length = 0; shots.forEach(q => window.G.shots.push(q));
    const bound = B.r + 14;
    return { has: true, key, seen: !!seen, picked: !!picked, idle, laid, dist: D,
             rounds: out.length, want: B.rounds, r: B.r, bound,
             inCircle: out.filter(d => d <= B.r).length,
             inBound: out.filter(d => d <= bound).length,
             setup: h.def.setup, early, after };
  });
  ok('a pack howitzer fires only on an order, into an area, and only once it is in action',
     !how.has || (how.seen && !how.picked && how.idle === 0 && how.laid &&
                  how.rounds === how.want && how.inBound === how.rounds &&
                  how.inCircle >= how.rounds - 2 && how.early === 0 && how.after > 0),
     !how.has ? 'no barrage-only weapon in this file'
              : `${how.key} with a section in sight at ${how.dist}: acquired ${how.picked ? 'one' : 'nothing'}, ` +
                `fired ${how.idle} rounds in a minute; laid on him it fired ${how.rounds} of ${how.want}, ` +
                `${how.inCircle} inside ${how.r} and ${how.inBound} inside ${how.bound}; ` +
                `${how.early} rounds during ${how.setup}s of setup and ${how.after} after it`);

  /* --- the heavy battery, which is four rules rather than a weapon. It is dug as a field
     work and not queued, it may not be dug near its own headquarters, it will not fire
     into the enemy's base, and it takes the best part of a minute to come round onto a
     bearing behind it. Each of those is a refusal, and a refusal that has quietly stopped
     working looks exactly like one that never fires. --- */
  const bat = await page.evaluate(() => {
    const side = window.G.side, kind = side === 'us' ? 'how8' : 'how210';
    const W = window.WORKS[kind];
    if (!W || !W.minHq) return { has: false };
    const keep = window.G.units.slice(), shots = window.G.shots.slice();
    const sites = window.G.sites.slice(), works = window.G.works.slice();
    const mp = window.G.res[side].mp, fu = window.G.res[side].fu;
    window.G.res[side].mp = 9000; window.G.res[side].fu = 9000;
    const hq = window.G.blds.filter(b => b.side === side && b.def.hq)[0];
    const foeHq = window.G.blds.filter(b => b.side !== side && b.def.hq)[0];
    const dir = side === 'us' ? 1 : -1;
    /* inside its own back yard: refused however clear the ground is */
    const near = window.placeWork(side, kind, hq.x + dir * 200, hq.y, 0, []);
    /* and forward of it: taken, on the first patch of ground that will hold it */
    let site = null, at = null;
    for (let d = W.minHq + 60; d < W.minHq + 700 && !site; d += 60)
      for (let k = -4; k <= 4 && !site; k++) {
        const x = hq.x + dir * d, y = hq.y + k * 110;
        site = window.placeWork(side, kind, x, y, dir > 0 ? 0 : Math.PI, []);
        if (site) at = { x, y };
      }
    if (!site) { window.G.res[side].mp = mp; window.G.res[side].fu = fu; return { has: true, dug: false }; }
    site.prog = 1; window.updateSites(0);
    const g = window.G.units.filter(u => u.key === W.unit)[0];
    /* a second one, with the first already standing: one a side */
    const twice = window.placeWork(side, kind, at.x + dir * 200, at.y + 200, 0, []);
    window.G.res[side].mp = mp; window.G.res[side].fu = fu;
    const B = g.def.barrage;
    /* The enemy's own base is out of bounds, and asking that question needs a gun that
       can reach it. Dug on the first legal patch the Canadian eight-inch is 1275 from a
       point 300 short of the German headquarters and its reach is 1250, so from there the
       answer is 'out of range' and the rule under test is never consulted -- which is the
       two rules doing the same job from opposite ends and is worth knowing, but it is not
       a test of either. `homeReach` records it; the gun is then stood forward for the
       question itself and put back. The control is the same range on a bearing with
       nothing of the enemy's on it. */
    const homeReach = Math.round(Math.hypot(foeHq.x - g.x, foeHq.y - g.y));
    const gx0 = g.x, gy0 = g.y, hA = Math.atan2(hq.y - foeHq.y, hq.x - foeHq.x);
    g.x = foeHq.x + Math.cos(hA) * 900; g.y = foeHq.y + Math.sin(hA) * 900;
    const bx0 = foeHq.x + Math.cos(hA) * 300, by0 = foeHq.y + Math.sin(hA) * 300;
    const onBase = window.orderBarrage(g, bx0, by0);
    const whyBase = window.barrageWhy(g, bx0, by0);
    const dd0 = Math.hypot(bx0 - g.x, by0 - g.y);
    const cA = Math.atan2(by0 - g.y, bx0 - g.x) + 1.4;
    const clear = window.barrageWhy(g, g.x + Math.cos(cA) * dd0, g.y + Math.sin(cA) * dd0);
    g.barrage = null; g.x = gx0; g.y = gy0;
    /* a mission behind the gun, so the whole of the traverse has to be paid for */
    const tx = g.x - Math.cos(g.facing) * 700, ty = g.y - Math.sin(g.facing) * 700;
    const laid = window.orderBarrage(g, tx, ty);
    const slew = (Math.PI - (g.def.layTol || .35)) / g.def.traverse;
    let first = -1, out = [], quiet = 0;
    for (let f = 0; f < 60 * 260 && quiet < 40; f++) {
      const before = window.G.shots.slice();
      window.updateUnit(g, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60;
      if (first < 0 && window.G.shots.length > before.length) first = f / 60;
      before.forEach(sh => {
        if (sh.kind === 'shell' && window.G.shots.indexOf(sh) < 0) out.push(Math.hypot(sh.tx - tx, sh.ty - ty));
      });
      quiet = (g.barrage || window.G.shots.length) ? 0 : quiet + 1;
    }
    window.G.units.length = 0; keep.forEach(q => window.G.units.push(q));
    window.G.shots.length = 0; shots.forEach(q => window.G.shots.push(q));
    window.G.sites.length = 0; sites.forEach(q => window.G.sites.push(q));
    window.G.works.length = 0; works.forEach(q => window.G.works.push(q));
    window.computeVisibility();
    const bound = B.r + (B.sp || 10) * 1.6;
    return { has: true, dug: true, key: W.unit, minHq: W.minHq, near: !!near, twice: !!twice,
             onBase, whyBase, clear, reach: +dd0.toFixed(0), homeReach, laid, slew: +slew.toFixed(1), first: +first.toFixed(1),
             rounds: out.length, want: B.rounds, r: B.r, bound,
             inBound: out.filter(d => d <= bound).length,
             wider: B.r > window.UNITS[side === 'us' ? 'us_how' : 'ger_how'].barrage.r };
  });
  ok('a heavy battery is dug forward, fires only on an order, and is slow onto a new bearing',
     !bat.has || (bat.dug && !bat.near && !bat.twice && !bat.onBase && bat.whyBase === 'safe' &&
                  bat.clear === null && bat.laid && bat.wider && bat.first >= bat.slew * 0.9 &&
                  bat.rounds === bat.want && bat.inBound === bat.rounds),
     !bat.has ? 'no heavy battery in this file'
              : !bat.dug ? `nowhere beyond ${bat.minHq} of the headquarters would take the position`
              : `${bat.key}: refused inside ${bat.minHq} of its own HQ ${bat.near ? 'NO' : 'yes'}, ` +
                `a second one ${bat.twice ? 'NO' : 'refused'}, ${bat.homeReach} from the enemy HQ where it stands; ` +
                `stood ${bat.reach} off it, a mission 300 short of it ` +
                `${bat.onBase ? 'NO' : 'refused (' + bat.whyBase + ')'} and the same range on clear ground ` +
                `${bat.clear === null ? 'taken' : 'NO (' + bat.clear + ')'}; ` +
                `laid behind itself the first round left at ${bat.first}s against ${bat.slew}s of traverse, ` +
                `${bat.rounds} of ${bat.want} rounds, ${bat.inBound} inside ${bat.bound} on a circle of ${bat.r}`);

  /* --- and from inside a tank: the commander's eye in his cupola, the lid up and shut --- */
  const tank = await page.evaluate(() => {
    /* the gun and barrel tests run another minute of battle on top of the one already
       fought, which is long enough for the victory points to run out and the game-over
       screen to come up over everything the rest of the check wants to click.
         Topping the points up is not enough on its own once the battle has ALREADY been
       decided, which a --sim long enough to reach a decision does: G.over is set, the
       clock is stopped and the screen is up, and endGame returns on its first line so
       nothing can put it back. Put the battle back on its feet first. */
    window.G.over = null; window.G.running = true;
    document.getElementById('over').classList.add('hidden');
    window.G.res.us.vp = 9000; window.G.res.ger.vp = 9000;
    const key = window.G.side === 'us' ? 'us_sher' : 'ger_kt';
    const hq = window.G.blds.find(b => b.side === window.G.side && b.def.hq);
    /* on ground it can actually drive off, or the driving check below measures a wall */
    const sp = window.nearestFree((hq ? hq.x : 300) + 150, (hq ? hq.y : 950) + 80);
    const u = window.spawnUnit(window.G.side, key, sp.x, sp.y, 0);   /* spawnUnit adds it to the field itself */
    u.hp = u.maxhp = 9e5;                                            /* it has a minute of tests to survive */
    window.select([u], false);
    document.getElementById('tPov').click();
    const I = window.VMODEL[key].inside, hatchBtn = document.getElementById('tHatch');
    const out = { key, closed: !!(I && I.closed), hatchShown: !hatchBtn.classList.contains('hidden'), pieces: window.MODELS.veh[key].inside.n };
    window.povHatch(true); window.updateCamera(); const up = window.MAT.eye.z;
    window.povHatch(false); window.updateCamera(); const down = window.MAT.eye.z;
    out.dropped = +(up - down).toFixed(1); out.above = +(down - window.groundZ(window.MAT.eye.x, window.MAT.eye.y)).toFixed(1);
    return out;
  });
  await frames(page, 2);
  await page.evaluate(() => { window.povHatch(true); });
  await frames(page, 2);

  /* --- and he drives it: the pad turns the hull, moves it, and stops it --- */
  const drv0 = await page.evaluate(() => {
    const u = window.POV.u, pad = document.getElementById('drivepad'), fire = document.getElementById('drivefire');
    const pr = pad.getBoundingClientRect(), fr = fire.getBoundingClientRect();
    return { shown: document.getElementById('drive').classList.contains('on'),
             padOk: pr.width >= 44 && pr.height >= 44, fireOk: fr.width >= 44 && fr.height >= 44,
             clear: fr.right <= window.innerWidth + 1 && fr.top >= 0 && pr.bottom <= window.innerHeight + 1,
             x: u.x, y: u.y, facing: u.facing };
  });
  await page.evaluate(() => { window.DRV.padT = 1; window.DRV.padS = .8; });
  await fastForward(page, 3);
  const drv2 = await page.evaluate(([x, y, f]) => {
    const u = window.POV.u;
    return { moved: +Math.hypot(u.x - x, u.y - y).toFixed(1), turned: +Math.abs(u.facing - f).toFixed(2),
             took: window.DRV.took, x: u.x, y: u.y };
  }, [drv0.x, drv0.y, drv0.facing]);
  await page.evaluate(() => { window.DRV.padT = 0; window.DRV.padS = 0; });
  await fastForward(page, 3);
  const drv3 = await page.evaluate(([x, y]) => {
    const u = window.POV.u;
    return { crept: +Math.hypot(u.x - x, u.y - y).toFixed(1), sp: +(u.sp || 0).toFixed(1) };
  }, [drv2.x, drv2.y]);
  /* --- and he shoots with it: a round goes where he points, target or no target --- */
  const shot = await page.evaluate(() => {
    const u = window.POV.u;
    window.__booms = 0;
    const ex = window.explode;
    window.explode = function (x, y, r, d, o, e) { window.__booms++; return ex(x, y, r, d, o, e); };
    window.POV.yaw = u.facing; window.POV.pitch = -.22;
    window.DRV.padFire = true;
    return true;
  });
  /* The mark over the whole burst rather than at one instant. `povGround` walks the look
     out of the eye and backs it off along the bearing until `fireLine` passes, so where
     the tank happens to have ended the drive test decides whether there is a mark on any
     one frame: sampled a second in, the same assertion came back FAIL and PASS on the two
     devices of one run with the same rounds in the street beside it. What the row is for
     is that pointing and pulling puts a round somewhere, and a mark at any point in the
     nine seconds is that. */
  let markEver = false;
  for (let i = 0; i < 10; i++) {
    await fastForward(page, 1);
    if (await page.evaluate(() => !!window.DRV.mark)) markEver = true;
  }
  const aim = { mark: markEver };
  const fired = await page.evaluate(() => { window.DRV.padFire = false; return window.__booms; });
  /* The message says which half it was. Both halves have to hold -- he has to have a
     mark under the crosshair and rounds have to leave -- and printed as the round count
     alone a run that failed on the mark read identically to one that passed, which is
     how the same line came back FAIL on one device and PASS on the other with the same
     three rounds beside it. */
  ok('a round goes where the commander points, target or none', shot && aim.mark && fired > 0,
     `${fired} rounds into the street in nine seconds` + (aim.mark ? '' : ', but no mark under the crosshair'));

  /* --- the coaxial: its own trigger, no reload, and a barrel that will only take so much --- */
  const mg0 = await page.evaluate(() => {
    const u = window.POV.u;
    if (!u) return { sec: 0, btn: 0 };
    u.mgHeat = 0; u.mgCook = 0; u.mgOnT = 0;
    window.DRV.padFire = false; window.DRV.padMg = false;
    return { sec: window.secondaryKeys(u).length, btn: document.getElementById('drivemg').getBoundingClientRect().height };
  });
  await fastForward(page, 6);
  const mgIdle = await page.evaluate(() => window.POV.u ? +(window.POV.u.mgHeat || 0).toFixed(2) : -1);
  await page.evaluate(() => { window.DRV.padMg = true; });
  await fastForward(page, 8);
  const mgWarm = await page.evaluate(() => window.POV.u ? +(window.POV.u.mgHeat || 0).toFixed(2) : -1);
  /* the barrel cooks and then cools itself under a held trigger, so watch the whole
     burst rather than sampling one moment of the cycle */
  let cookedAt = 0;
  for (let t = 10; t <= 30 && !cookedAt; t += 2) {
    await fastForward(page, 2);
    if (await page.evaluate(() => !!(window.POV.u && window.POV.u.mgCook))) cookedAt = t;
  }
  await page.evaluate(() => { window.DRV.padMg = false; });
  await fastForward(page, 25);
  const mgCool = await page.evaluate(() => window.POV.u ? { heat: +(window.POV.u.mgHeat || 0).toFixed(2), cooked: !!window.POV.u.mgCook } : { heat: 9, cooked: true });
  ok('the coaxial fires on its own trigger and cooks the barrel',
     mg0.sec > 0 && mg0.btn >= 44 && mgIdle === 0 && mgWarm > .1 && mgWarm < 1 && cookedAt > 8 && mgCool.heat < .1 && !mgCool.cooked,
     `idle ${mgIdle}, ${mgWarm} after 8s on the trigger, cooked at ${cookedAt}s, cold again 25s after release`);

  ok('the commander drives his tank from the periscope',
     drv0.shown && drv0.padOk && drv0.fireOk && drv0.clear && drv2.moved > 30 && drv2.turned > .2 && drv2.took === 1 && drv3.sp < 1,
     `moved ${drv2.moved} and turned ${drv2.turned} rad under the pad, then stopped`);

  const tankOff = await page.evaluate(() => { window.povOff(); return !window.POV.on && document.getElementById('tHatch').classList.contains('hidden') && !document.getElementById('drive').classList.contains('on') && !window.POV.u; });
  ok('periscope sits in the tank commander\'s cupola, lid up or shut', tank.closed && tank.hatchShown && tank.pieces > 100 && tank.dropped > 3 && tank.above > 20 && tankOff, `${tank.key}: ${tank.pieces} inside triangles, the eye drops ${tank.dropped} when the lid shuts`);

  /* --- the minimap and the tactical map --- */
  await page.click('#tMap');
  await frames(page, 1);
  const mapOpen = await page.evaluate(() => document.getElementById('mini').classList.contains('big')
                                         || document.getElementById('mini').getBoundingClientRect().width > 260);
  ok('tactical map expands', mapOpen);
  await page.click('#tMap').catch(() => {});

  /* --- the handicap, which is the player's half of what difficulty used to be. What is
     asserted is the split: with every setting at its best and the opposition on GREEN, all
     ten numbers reach the player's side and none of them reaches the opposition's, whose
     population cap is still green's own hundred and seventy-five. Production, construction,
     damage and sight are timed or measured rather than read off the settings, because a
     setting that is stored and never multiplied into anything looks exactly like one that
     works. Damage is read against a VEHICLE both ways: `damageModel` picks a living man at
     random and caps the hit at what that man had left, so a fifty-point round on a section
     measures the pick and the man's remaining hit points rather than the multiplier. --- */
  await reload(page);
  await page.evaluate(() => {
    /* every knob to its top, through the stepper the player uses rather than by writing
       PD, so the row covers the control as well as the number */
    document.getElementById('hopen').click();
    /* DAMAGE TAKEN is the one list whose good end is the bottom, so it is stepped down */
    window.HCAP.forEach(h => {
      for (let i = 0; i < 20; i++) window.hcapStep(h, h.k === 'take' ? -1 : 1);
    });
  });
  await deploy(page, { side: args.side || 'us', diff: 0 });
  const hcap = await page.evaluate(() => {
    const side = window.G.side, foe = side === 'us' ? 'ger' : 'us';
    const pd = window.G.pd, hq = window.G.blds.filter(b => b.side === side && b.def.hq)[0];
    /* production: how much queue time one second of wall clock buys, at the handicap
       against the flat one the opposition gets */
    function qRate(s) {
      const b = window.G.blds.filter(x => x.side === s && x.def.hq)[0];
      const keep = b.queue.slice(), qt = b.qt;
      b.queue = [b.def.makes[0]]; b.qt = 0;
      for (let f = 0; f < 60; f++) window.updateBuilding(b, 1 / 60);
      const r = b.qt;
      b.queue = keep; b.qt = qt;
      return +r.toFixed(2);
    }
    const prodYou = qRate(side), prodFoe = qRate(foe);
    /* construction: an engineer put against a half-built post, a second of it each way */
    function cRate(s) {
      const e = window.G.units.filter(u => u.side === s && u.def.builder)[0];
      if (!e) return -1;
      const b = window.spawnBuilding(s, s === 'us' ? 'us_bar' : 'ger_qtr',
                                    e.x + (s === 'us' ? 90 : -90), e.y, false);
      b.built = 0;
      e.order = 'build'; e.building = b; e.x = b.x; e.y = b.y;
      for (let f = 0; f < 60; f++) window.updateUnit(e, 1 / 60);
      const r = b.built;
      b.dead = true; window.G.blds.splice(window.G.blds.indexOf(b), 1);
      e.building = null; e.order = null;
      return +r.toFixed(4);
    }
    const consYou = cRate(side), consFoe = cRate(foe);
    /* damage, both ways, against a hull that cannot be killed by one round of it */
    function hit(victim, shooter, amt) {
      const before = victim.hp;
      window.damage(victim, amt, shooter);
      const d = before - victim.hp;
      victim.hp = before; victim.dead = false;
      return +d.toFixed(2);
    }
    const mine = window.spawnUnit(side, side === 'us' ? 'us_sher' : 'ger_p4', 700, 1500, 0);
    const theirs = window.spawnUnit(foe, foe === 'us' ? 'us_sher' : 'ger_p4', 900, 1500, 0);
    mine.hp = theirs.hp = 1e6;
    const took = hit(mine, theirs, 100), dealt = hit(theirs, mine, 100);
    /* and the cross-check: a round between two of the opposition's is untouched by either */
    const theirs2 = window.spawnUnit(foe, foe === 'us' ? 'us_sher' : 'ger_p4', 1100, 1500, 0);
    theirs2.hp = 1e6;
    const neither = hit(theirs2, theirs, 100);
    /* Sight: the radius the eye actually goes into the list with. Called with NO argument
       on purpose -- `computeVisibility(dt)` runs at a tenth of the frame rate and returns
       at once while its timer is still down, so a probe that passes a dt reads whatever
       the last real pass built, which here predates the units it just spawned. */
    window.computeVisibility();
    function eyeOf(s, u) {
      const e = window._eyes[s].find(q => q.u === u);
      return e ? Math.round(e.r) : -1;
    }
    const eyeYou = eyeOf(side, mine), eyeFoe = eyeOf(foe, theirs);
    /* each vehicle's own sight, because the two are different vehicles: the Sherman's
       380 against the Panzer IV's 400, and comparing one against the other is not a test */
    const eyeDef = mine.sight, eyeFoeDef = theirs.sight;
    [mine, theirs, theirs2].forEach(u => {
      u.dead = true;
      const i = window.G.units.indexOf(u); if (i >= 0) window.G.units.splice(i, 1);
    });
    return { pd, diff: window.G.diff,
             popYou: window.popCap(side), popFoe: window.popCap(foe),
             mp: Math.round(window.G.res[side].mp), fu: Math.round(window.G.res[side].fu),
             incYou: +window.G.inc[side].mp.toFixed(2), incFoe: +window.G.inc[foe].mp.toFixed(2),
             incFuYou: +window.G.inc[side].fu.toFixed(2), incFuFoe: +window.G.inc[foe].fu.toFixed(2),
             prodYou, prodFoe, consYou, consFoe, took, dealt, neither,
             eyeYou, eyeFoe, eyeDef, eyeFoeDef,
             even: window.hcapEven(), rows: document.querySelectorAll('#hgrid .hrow').length,
             hqTime: hq.def.makes.length };
  });
  ok('the handicap is the player\'s half of the difficulty, and the opposition keeps its own',
     hcap.rows === 11 && !hcap.even && hcap.pd.pop === 1000 && hcap.popYou === 1000 &&
     hcap.popFoe === 175 && hcap.mp >= hcap.pd.mp && hcap.fu >= hcap.pd.fu &&
     hcap.incYou > hcap.incFoe * 6 && hcap.incFuYou > hcap.incFuFoe * 6 &&
     hcap.prodYou > hcap.prodFoe * 9 && hcap.prodFoe > 0 &&
     hcap.consYou > hcap.consFoe * 9 && hcap.consFoe > 0 &&
     Math.abs(hcap.took - 100 * hcap.pd.take) < 1 &&
     Math.abs(hcap.dealt - 100 * hcap.pd.deal) < 1 &&
     Math.abs(hcap.neither - 100) < 1 &&
     Math.abs(hcap.eyeYou - hcap.eyeDef * hcap.pd.eye) < 2 && hcap.eyeFoe === hcap.eyeFoeDef,
     `${hcap.rows} settings, all off even; on GREEN the player's cap is ${hcap.popYou} and the opposition's ${hcap.popFoe}; ` +
     `the till opened at ${hcap.mp}/${hcap.fu}f; income ${hcap.incYou}mp ${hcap.incFuYou}f against ` +
     `${hcap.incFoe}mp ${hcap.incFuFoe}f; a second of queue buys ${hcap.prodYou}s against ${hcap.prodFoe}s ` +
     `and a second of digging ${hcap.consYou} of a building against ${hcap.consFoe}; ` +
     `a hundred-point round took ${hcap.took} off one of his and ${hcap.dealt} off one of theirs, ` +
     `and ${hcap.neither} between two of theirs; his eye reaches ${hcap.eyeYou} off a ${hcap.eyeDef} sight ` +
     `where theirs reaches ${hcap.eyeFoe} off ${hcap.eyeFoeDef}`);
  /* --- the artillery settings, which are the two on the panel that do not simply
     multiply a number. SIGHT carries the tubes: a mortar reaches as far as somebody can
     see for it, so the handicap's eye scales `barrageReach` and the indirect half of
     `reachOf` as well as the vision radius. ARTILLERY lifts the three rules that make the
     heavy battery a decision, for the player and for nobody else -- which is why each of
     the three is measured twice, once on his side and once on the opposition's, and the
     opposition is handed the money first so that a refusal is the rule and never the
     till. --- */
  const arty = await page.evaluate(() => {
    const side = window.G.side, foe = side === 'us' ? 'ger' : 'us';
    const WK = side === 'us' ? 'how8' : 'how210', WKF = foe === 'us' ? 'how8' : 'how210';
    const WB = window.WORKS[WK], WBF = window.WORKS[WKF];
    const hq = window.hqOf(side), fhq = window.hqOf(foe);
    window.G.res[side].mp = window.G.res[foe].mp = 9000;
    window.G.res[side].fu = window.G.res[foe].fu = 4000;
    /* a patch the ground will take, at a chosen distance band from a headquarters */
    function spot(h, W, lo, hi, skip) {
      for (let r = lo; r < hi; r += 40)
        for (let a = 0; a < 16; a++) {
          const x = h.x + Math.cos(a / 16 * Math.PI * 2) * r, y = h.y + Math.sin(a / 16 * Math.PI * 2) * r;
          if (x < 90 || y < 90 || x > window.WORLD.w - 90 || y > window.WORLD.h - 90) continue;
          if (!window.workRoom(x, y, W)) continue;
          if (skip && Math.hypot(x - skip.x, y - skip.y) < 180) continue;
          return { x, y, d: Math.round(r) };
        }
      return null;
    }
    /* his: both dug inside his own exclusion, and both of them, because he has the rules off */
    const n1 = spot(hq, WB, 130, WB.minHq - 80);
    const y1 = n1 && window.placeWork(side, WK, n1.x, n1.y, 0, []);
    const n2 = spot(hq, WB, 130, WB.minHq - 80, n1);
    const y2 = n2 && window.placeWork(side, WK, n2.x, n2.y, 0, []);
    /* theirs: the same two, and both refused */
    const f1 = spot(fhq, WBF, 130, WBF.minHq - 80);
    const fNear = f1 ? window.placeWork(foe, WKF, f1.x, f1.y, 0, []) : 'nospot';
    const f2 = spot(fhq, WBF, WBF.minHq + 60, WBF.minHq + 700);
    const fOk = f2 && window.placeWork(foe, WKF, f2.x, f2.y, 0, []);
    const f3 = spot(fhq, WBF, WBF.minHq + 60, WBF.minHq + 700, f2);
    const fTwo = f3 ? window.placeWork(foe, WKF, f3.x, f3.y, 0, []) : 'nospot';
    /* the no-fire zone, from a tube standing close enough to reach the base it may not
       shell. His mission is taken; the same mission the other way round is refused. */
    const key = side === 'us' ? 'us_how8' : 'ger_how210', keyF = foe === 'us' ? 'us_how8' : 'ger_how210';
    const bA = Math.atan2(hq.y - fhq.y, hq.x - fhq.x);
    const mine = window.spawnUnit(side, key, fhq.x + Math.cos(bA) * 420, fhq.y + Math.sin(bA) * 420, 0);
    const bB = Math.atan2(fhq.y - hq.y, fhq.x - hq.x);
    const yours = window.spawnUnit(foe, keyF, hq.x + Math.cos(bB) * 420, hq.y + Math.sin(bB) * 420, 0);
    const safeYou = window.barrageWhy(mine, fhq.x, fhq.y);
    const safeFoe = window.barrageWhy(yours, hq.x, hq.y);
    /* and the reach: the def's own number, what the handicap makes of it, and the
       opposition's, which is the def's number and nothing else */
    const mor = window.spawnUnit(side, side === 'us' ? 'us_mor' : 'ger_mor', 700, 1400, 0);
    const morF = window.spawnUnit(foe, foe === 'us' ? 'us_mor' : 'ger_mor', 900, 1400, 0);
    const barDef = mor.def.barrage.range;
    const barYou = Math.round(window.barrageRange(mor)), barFoe = Math.round(window.barrageRange(morF));
    const freeYou = Math.round(window.reachOf(mor, window.mainW(mor)));
    const freeFoe = Math.round(window.reachOf(morF, window.mainW(morF)));
    const freeDef = window.mainW(mor).range;
    /* a rifle section is not carried: only an indirect piece is */
    const rif = window.spawnUnit(side, side === 'us' ? 'us_rifle' : 'ger_gren', 700, 1600, 0);
    const rifSame = Math.round(window.reachOf(rif, window.mainW(rif))) === Math.round(window.mainW(rif).range);
    [mine, yours, mor, morF, rif].forEach(u => {
      u.dead = true;
      const i = window.G.units.indexOf(u); if (i >= 0) window.G.units.splice(i, 1);
    });
    window.G.sites.length = 0;
    return { eye: window.G.pd.eye, freeArty: window.G.pd.arty,
             nearYou: !!y1, twoYou: !!y2, nearD: n1 ? n1.d : -1, minHq: WB.minHq,
             nearFoe: fNear === null ? 'refused' : String(fNear === 'nospot' ? 'nospot' : 'allowed'),
             foeLegal: !!fOk,
             twoFoe: fTwo === null ? 'refused' : String(fTwo === 'nospot' ? 'nospot' : 'allowed'),
             safeYou: safeYou || 'allowed', safeFoe: safeFoe || 'allowed',
             barDef, barYou, barFoe, freeDef, freeYou, freeFoe, rifSame };
  });
  ok('the handicap can take the artillery rules off, for the player and for nobody else',
     arty.freeArty === true && arty.nearYou && arty.twoYou &&
     arty.nearFoe === 'refused' && arty.foeLegal && arty.twoFoe === 'refused' &&
     arty.safeYou === 'allowed' && arty.safeFoe === 'safe' &&
     Math.abs(arty.barYou - arty.barDef * arty.eye) < 2 && arty.barFoe === arty.barDef &&
     Math.abs(arty.freeYou - arty.freeDef * arty.eye) < 2 && arty.freeFoe === arty.freeDef &&
     arty.rifSame,
     `at ${arty.eye}x sight with the rules off: he dug a battery ${arty.nearD} from his own HQ ` +
     `inside a ${arty.minHq} exclusion and then a second one, where the opposition was ${arty.nearFoe} ` +
     `near its own and ${arty.twoFoe} a second beyond it; a mission onto the enemy HQ was ` +
     `${arty.safeYou} for him and ${arty.safeFoe} against him; his mortar throws ${arty.barYou} ` +
     `and reaches ${arty.freeYou} off a ${arty.barDef}/${arty.freeDef} piece where theirs throws ` +
     `${arty.barFoe} and reaches ${arty.freeFoe}, and his riflemen are unchanged`);

  /* --- and the same eleven settings turned on the opposition, which is the panel that
     runs both ways. What is asserted is that each one reaches the other side and that
     none of them reaches the player's: `AD` multiplies what `DIFF` already says, so the
     control is the player's own numbers standing still while theirs move. --- */
  await reload(page);
  await page.evaluate(() => {
    /* the player's own panel back to even first: it is kept in localStorage and survives
       the reload, so without this the row reads their damage through his multipliers and
       a 4x round of theirs comes back as 40 */
    document.getElementById('heven').click();
    document.getElementById('aopen').click();
    /* every opposition knob to its top, through the stepper rather than by writing AD */
    window.ACAP.forEach(h => { for (let i = 0; i < 20; i++) window.hcapStep(h, 1, window.ACAP); });
  });
  await deploy(page, { side: args.side || 'us', diff: 0 });
  const acap = await page.evaluate(() => {
    const side = window.G.side, foe = side === 'us' ? 'ger' : 'us';
    function hit(victim, shooter, amt) {
      const before = victim.hp;
      window.damage(victim, amt, shooter);
      const d = before - victim.hp;
      victim.hp = before; victim.dead = false;
      return +d.toFixed(2);
    }
    const mine = window.spawnUnit(side, side === 'us' ? 'us_sher' : 'ger_p4', 700, 1500, 0);
    const theirs = window.spawnUnit(foe, foe === 'us' ? 'us_sher' : 'ger_p4', 900, 1500, 0);
    mine.hp = theirs.hp = 1e6;
    /* a round of theirs into him, and one of his into them */
    const dealt = hit(mine, theirs, 100), took = hit(theirs, mine, 100);
    window.computeVisibility();
    function eyeOf(s, u) {
      const e = window._eyes[s].find(q => q.u === u);
      return e ? Math.round(e.r) : -1;
    }
    const eyeFoe = eyeOf(foe, theirs), eyeYou = eyeOf(side, mine);
    [mine, theirs].forEach(u => {
      u.dead = true;
      const i = window.G.units.indexOf(u); if (i >= 0) window.G.units.splice(i, 1);
    });
    return { ad: window.G.ad, rows: document.querySelectorAll('#agrid .hrow').length,
             popFoe: window.popCap(foe), popYou: window.popCap(side),
             mpFoe: Math.round(window.G.res[foe].mp), fuFoe: Math.round(window.G.res[foe].fu),
             mpYou: Math.round(window.G.res[side].mp),
             incFoe: +window.G.inc[foe].mp.toFixed(2), incYou: +window.G.inc[side].mp.toFixed(2),
             dealt, took, eyeFoe, eyeYou, eyeFoeDef: theirs.sight, eyeDef: mine.sight,
             even: window.hcapEven(window.ACAP) };
  });
  ok('the opposition has the same eleven settings, and they run both ways',
     acap.rows === 11 && !acap.even && acap.ad.pop === 1000 && acap.popFoe === 1000 &&
     acap.popYou === 200 && acap.mpFoe > 8000 && acap.mpYou < 500 &&
     acap.incFoe > acap.incYou * 4 &&
     Math.abs(acap.dealt - 100 * acap.ad.deal) < 1 &&
     Math.abs(acap.took - 100 * acap.ad.take) < 1 &&
     Math.abs(acap.eyeFoe - acap.eyeFoeDef * acap.ad.eye) < 2 && acap.eyeYou === acap.eyeDef,
     `${acap.rows} settings, all off even; on GREEN their cap is ${acap.popFoe} where his stays ${acap.popYou}; ` +
     `their till opened at ${acap.mpFoe}/${acap.fuFoe}f (it spends as it goes) where his stayed ${acap.mpYou}; income ${acap.incFoe} ` +
     `against his ${acap.incYou}; a hundred-point round of theirs does ${acap.dealt} and one into them ` +
     `${acap.took}; their eye reaches ${acap.eyeFoe} off a ${acap.eyeFoeDef} sight where his stays ` +
     `${acap.eyeYou} off ${acap.eyeDef}`);
  await page.evaluate(() => { document.getElementById('aeven').click(); });
  const aeven = await page.evaluate(() => ({ even: window.hcapEven(window.ACAP), made: window.adMake(),
                                             badge: document.getElementById('aopen').textContent }));
  ok('the opposition EVEN button defers to the difficulty again',
     aeven.even && aeven.made.inc === 1 && aeven.made.prod === 1 && aeven.made.cons === 1 &&
     aeven.made.take === 1 && aeven.made.deal === 1 && aeven.made.eye === 1 &&
     aeven.made.setPop === false && aeven.made.setTill === false && aeven.badge.indexOf('\u00b7') < 0,
     `${aeven.made.inc}x income, ${aeven.made.prod}x production, ${aeven.made.cons}x construction, ` +
     `${aeven.made.take}x taken, ${aeven.made.deal}x dealt, ${aeven.made.eye}x sight, cap set ` +
     `${aeven.made.setPop}, till set ${aeven.made.setTill}, the button reads "${aeven.badge}"`);

  /* and EVEN puts every one of them back */
  await reload(page);
  await page.evaluate(() => {
    document.getElementById('hopen').click();
    window.HCAP.forEach(h => { for (let i = 0; i < 20; i++) window.hcapStep(h, h.k === 'take' ? -1 : 1); });
    document.getElementById('heven').click();
  });
  const evened = await page.evaluate(() => ({ even: window.hcapEven(), made: window.pdMake(),
                                              badge: document.getElementById('hopen').textContent }));

  ok('the EVEN button puts every setting back where it started',
     evened.even && evened.made.inc === 1 && evened.made.incf === 1 && evened.made.prod === 1 &&
     evened.made.cons === 1 && evened.made.pop === 200 && evened.made.mp === 420 &&
     evened.made.fu === 20 && evened.made.take === 1 && evened.made.deal === 1 &&
     evened.made.eye === 1 && evened.made.arty === false && evened.badge.indexOf('\u00b7') < 0,
     `${evened.made.inc}x/${evened.made.incf}x income, ${evened.made.prod}x production, ` +
     `${evened.made.cons}x construction, cap ${evened.made.pop}, ${evened.made.mp}/${evened.made.fu}f, ` +
     `${evened.made.take}x taken, ${evened.made.deal}x dealt, ${evened.made.eye}x sight, ` +
     `artillery ${evened.made.arty ? 'free' : 'by rule'}, the button reads "${evened.badge}"`);

  /* --- the after-action record, and the page it is read on. The record is kept AS the
     battle runs -- nothing at the end of one knows what a section did before it died --
     so what is asserted is that it agrees with the field while the field is still there:
     the units it holds against the units that were raised, its damage against hit points
     actually taken off, and its spending against what left the till. Then the page: every
     tab renders, the graphs put pixels on their canvases, and the whole thing survives a
     round trip through localStorage, which is what the history is. --- */
  await reload(page);
  await deploy(page, { side: args.side || 'us', diff: 1 });
  await fastForward(page, 200);
  const rec = await page.evaluate(() => {
    const R = window.REC, side = window.G.side, foe = side === 'us' ? 'ger' : 'us';
    /* a known round into a known hull, read on the record rather than inferred */
    const a = window.spawnUnit(side, side === 'us' ? 'us_sher' : 'ger_p4', 700, 1500, 0);
    const b = window.spawnUnit(foe, foe === 'us' ? 'us_sher' : 'ger_p4', 800, 1500, 0);
    a.hp = b.hp = 1e6;
    const beforeOut = R[foe].dmgOut, beforeIn = R[side].dmgIn;
    window.damage(a, 250, b);
    const gotOut = +(R[foe].dmgOut - beforeOut).toFixed(1), gotIn = +(R[side].dmgIn - beforeIn).toFixed(1);
    const rowA = R.units[a.id], rowB = R.units[b.id];
    /* and a kill, credited both ways */
    const kBefore = R[foe].killed, lBefore = R[side].lost;
    window.killUnit(a, b);
    const killed = R[foe].killed - kBefore, lost = R[side].lost - lBefore;
    /* the record's own unit count against the field's */
    let live = 0;
    window.G.units.forEach(u => { if (!u.dead) live++; });
    const rows = Object.keys(R.units).length;
    let alive = 0;
    for (const k in R.units) if (R.units[k].died < 0) alive++;
    return { rows, live, alive, gotOut, gotIn, killed, lost,
             rowKills: rowB.kills, rowDied: rowA.died >= 0,
             line: R.line.length, t: Math.round(R.t),
             earn: Math.round(R[side].earnMp), spend: Math.round(R[foe].spendMp),
             made: Object.keys(R[foe].made).length, caps: R[foe].caps + R[side].caps };
  });
  ok('a battle writes itself down as it is fought',
     rec.rows >= 6 && rec.alive === rec.live && rec.line > 40 &&
     Math.abs(rec.gotOut - 250) < 1 && Math.abs(rec.gotIn - 250) < 1 &&
     rec.killed === 1 && rec.lost === 1 && rec.rowKills === 1 && rec.rowDied &&
     rec.earn > 100 && rec.spend > 0 && rec.made >= 2 && rec.caps > 0,
     `${rec.rows} unit rows for ${rec.live} still on the field and ${rec.alive} the record calls alive; ` +
     `a 250-point round read back as ${rec.gotOut} dealt and ${rec.gotIn} taken; a kill counted once ` +
     `each way and written onto the firer's own row; ${rec.line} timeline samples over ${rec.t}s; ` +
     `${rec.earn} manpower earned, ${rec.spend} spent by them on ${rec.made} kinds of thing, ` +
     `${rec.caps} sectors changed hands`);

  /* the page itself, every tab, and the round trip through storage */
  const page5 = await page.evaluate(() => {
    window.endGame(window.G.side === 'us' ? 'ger' : 'us', 'the check called it');
    const out = { tabs: [], errs: 0 };
    ['over', 'army', 'type', 'unit', 'graph'].forEach(t => {
      window.ST.tab = t;
      window.stOpen(window.REC, false);
      const b = document.getElementById('stbody');
      out.tabs.push({ t, len: b.innerHTML.length, rows: b.querySelectorAll('tbody tr').length });
    });
    /* the graphs draw pixels rather than an empty canvas */
    window.ST.tab = 'graph'; window.stOpen(window.REC, false);
    const cv = document.getElementById('stg_army');
    let ink = 0;
    if (cv && cv.width) {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) ink++;
    }
    out.ink = ink;
    out.canvas = cv ? cv.width + 'x' + cv.height : 'none';
    /* the history: written at the whistle, read back as a record the page can render */
    const all = JSON.parse(localStorage.getItem('ORT_HIST') || '[]');
    out.hist = all.length;
    if (all.length) {
      window.ST.rec = all[0]; window.ST.tab = 'over'; window.stOpen(all[0], false);
      out.reread = document.getElementById('stbody').innerHTML.length;
      out.histUnits = Object.keys(all[0].units).length;
      out.histLine = all[0].line.length;
    }
    window.stOpen(null, true);
    out.listRows = document.getElementById('stbody').querySelectorAll('tbody tr').length;
    window.stClose();
    return out;
  });
  const tabsOk = page5.tabs.every(t => t.len > 200);
  ok('the after-action page reads every tab, draws its graphs and survives the history',
     tabsOk && page5.tabs[3].rows >= 6 && page5.ink > 300 && page5.hist >= 1 &&
     page5.reread > 200 && page5.histUnits >= 6 && page5.histLine > 40 && page5.listRows >= 1,
     `${page5.tabs.map(t => t.t + ' ' + t.len).join(', ')}; the army graph is ${page5.canvas} with ` +
     `${page5.ink} lit pixels; ${page5.hist} battle(s) in the history, the newest read back with ` +
     `${page5.histUnits} unit rows and ${page5.histLine} samples, listed on ${page5.listRows} row(s)`);

  /* and spectating: the chrome goes and the battle is left on screen */
  const spec = await page.evaluate(() => {
    document.getElementById('over').classList.remove('hidden');
    document.getElementById('overspec').click();
    const hid = getComputedStyle(document.getElementById('over')).display;
    const bar = !document.getElementById('specbar').classList.contains('hidden');
    document.getElementById('specdone').click();
    const back = !document.getElementById('stats').classList.contains('hidden');
    const gone = document.getElementById('specbar').classList.contains('hidden');
    window.stClose();
    return { hid, bar, back, gone, spec: document.body.classList.contains('spec') };
  });
  ok('the map can be looked at before the report',
     spec.hid === 'none' && spec.bar && spec.back && spec.gone && !spec.spec,
     `the game-over panel goes to ${spec.hid} with the bar up, and AFTER ACTION brings the report back`);

  /* --- the switch on the title screen that takes the opposition's guns away. What is
     asserted is the negative -- over eight minutes of battle the brain never once bought
     a tube, bought a gun or dug a battery, and has none on the field -- with the control
     being that the block those rules live in was reached at all. Without the control a
     misspelt counter name passes the whole row by never moving. --- */
  await reload(page);
  await page.click('.arty[data-arty="0"]');
  await deploy(page, { side: args.side || 'us', diff: args.diff === undefined ? 1 : Number(args.diff) });
  await fastForward(page, 480);
  const noArty = await page.evaluate(() => {
    const R = (window.AIR && window.AIR.fired) || {}, foe = window.G.side === 'us' ? 'ger' : 'us';
    return {
      off: window.G.aiArty === false,
      reached: R['mortar.gate.reached'] || 0,
      bought: (R['buy.mortar'] || 0) + (R['buy.how'] || 0) + (R['battery.dig'] || 0) + (R['battery.want'] || 0),
      onField: window.G.units.filter(u => u.side === foe && u.def.barrage).length,
      sites: window.G.sites.filter(q => q.side === foe && window.WORKS[q.kind] &&
                                        window.WORKS[q.kind].unit &&
                                        window.UNITS[window.WORKS[q.kind].unit].barrage).length,
      army: window.G.units.filter(u => u.side === foe).length
    };
  });
  ok('the title screen can take the opposition\'s artillery away',
     noArty.off && noArty.reached > 0 && noArty.bought === 0 && noArty.onField === 0 && noArty.sites === 0,
     `G.aiArty ${noArty.off ? 'off' : 'STILL ON'}; over 480s the post block was reached ${noArty.reached} times, ` +
     `artillery rules fired ${noArty.bought} times, and an army of ${noArty.army} has ${noArty.onField} tubes and ${noArty.sites} positions going up`);

  /* --- the map editor --- */
  await reload(page);
  const edErrorsBefore = log.errors.length;
  await page.click('#openeditor');
  await page.waitForFunction(() => window.ED.on, null, { timeout: 120000 });
  await frames(page, 2);
  const ed = await page.evaluate(() => {
    /* the first run opens the help; a thumb closes it */
    const helped = window.ED.panel;
    window.edPanelClose();
    const cats = document.querySelectorAll('#eddock .edtab').length;
    let tools = 0;
    window.ED_CATS.forEach(c => { tools += c.tools.length; });
    /* every category opens and every tool takes: the tray is rebuilt for each */
    let opened = 0;
    window.ED_CATS.forEach(c => { window.edOpenCat(c.id); if (document.querySelectorAll('#edtray .edtool').length === c.tools.length) opened++; });
    window.edOpenCat('select');
    /* and the controls a thumb has to hit are big enough */
    let small = 0, checked = 0;
    document.querySelectorAll('#edtop .edb, #eddock .edtab, #edtray .edtool, #edpill .edb').forEach(b => {
      const r = b.getBoundingClientRect(); if (!r.width) return; checked++; if (r.width < 44 || r.height < 44) small++;
    });
    /* the NEW MAP panel's controls too, sliders included */
    window.edPanelNew();
    document.querySelectorAll('#edpanel .edb, #edpanel input').forEach(b => {
      const r = b.getBoundingClientRect(); if (!r.width) return; checked++; if (r.width < 44 || r.height < 44) small++;
    });
    window.edPanelClose();
    /* the generator: every template, a few seeds, and the check comes back clean */
    let gen = 0, dirty = 0, houses = 0;
    window.ED_TEMPLATES.forEach(t => {
      if (t.town === undefined) return;
      for (let seed = 1; seed <= 3; seed++) {
        const d = window.edGenerate({ name: t.name, seed: seed * 4243, town: t.town, damage: t.damage, works: t.works });
        const keep = window.ED.data; window.ED.data = d; const probs = window.edCheck().length; window.ED.data = keep;
        gen++; if (probs) dirty++; houses += d.entities.filter(e => e.t === 'house').length;
      }
    });
    /* an edit rebuilds tiles, not the scene: a house marks a few tiles and no ground */
    window.ED.tiles = {}; window.ED.needGround = false;
    window.edAdd(window.edNewEntity({ t: 'house', def: { w: 110, h: 100, tall: 0, style: 'row' } }, 700, 700));
    const tiles = Object.keys(window.ED.tiles).length, ground = window.ED.needGround;
    const t0 = performance.now(); window.edRebuildNow(); const rebuildMs = Math.round(performance.now() - t0);
    window.edUndo(); window.edRebuildNow();
    return { on: window.ED.on, cats, tools, opened, small, checked, helped, gen, dirty, houses, tiles, ground, rebuildMs, nTiles: window.PT_N };
  });
  ok('map editor opens', ed.on, `${ed.cats} categories, ${ed.tools} tools`);
  ok('editor shows its help on first run', ed.helped === 'HOW THE EDITOR WORKS');
  ok('every editor category opens its tray', ed.opened === ed.cats, `${ed.opened}/${ed.cats}`);
  ok('editor controls are at least 44px', ed.small === 0, `${ed.checked} controls checked, ${ed.small} small`);
  ok('generated maps come back clean from the check', ed.gen > 0 && ed.dirty === 0, `${ed.gen} maps, ${ed.dirty} with problems, ${Math.round(ed.houses / ed.gen)} houses each`);
  ok('a placed house rebuilds a few tiles and no ground', ed.tiles > 0 && ed.tiles <= 8 && !ed.ground, `${ed.tiles} of ${ed.nTiles} tiles, ${ed.rebuildMs} ms under SwiftShader`);
  ok('map editor throws nothing', log.errors.length === edErrorsBefore);

  if (KEEP) {
    await camera(page, {});
    await shoot(page, path.join(SHOTS, 'check', `${device}-editor.png`), { settle: 1 });
  }

  /* --- nothing shouted at the console the whole way through --- */
  const unique = [...new Set(log.errors)];
  ok('no page errors', unique.length === 0, unique.slice(0, 3).join(' | '));

  await context.close();
}

await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
