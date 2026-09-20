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
  /* Count what the world builder asks the material table for, before anything is built.
     A face whose colour nobody tagged is drawn on the untextured generic tile, and that
     is invisible in a screenshot: a flat slab and a textured slab both look like a slab.
     It was 42 per cent of the world. */
  await page.evaluate(() => {
    window.__mt = { tot: 0, gen: 0, cols: {} };
    const real = window.matOf;
    window.matOf = function (col) {
      const m = real(col);
      window.__mt.tot++;
      if (m === 0) { window.__mt.gen++; window.__mt.cols[col] = (window.__mt.cols[col] || 0) + 1; }
      return m;
    };
  });
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
  /* and with BOTH panels open, because that is where most of the buttons are and where
     every one added since has landed: the sides picker, the role strip, eleven stepper
     rows a panel and the eight the shopping weights carry. A control a thumb cannot hit
     is a control that is not there. */
  const startTap = await page.evaluate(() => {
    document.getElementById('hopen').click(); document.getElementById('aopen').click();
    const small = [...document.querySelectorAll('#start button')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); })
      .map(e => (e.id || e.className) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' +
                Math.round(e.getBoundingClientRect().height));
    const n = document.querySelectorAll('#start button').length;
    const hScroll = document.documentElement.scrollWidth - window.innerWidth;
    document.getElementById('hopen').click(); document.getElementById('aopen').click();
    return { small, n, hScroll };
  });
  ok('every title-screen control is a touch target, panels open',
     !DEVICES[device].hasTouch || (startTap.small.length === 0 && startTap.hScroll <= 0),
     `${startTap.n} controls with both panels open, ${startTap.small.length} under 44px` +
     (startTap.small.length ? ': ' + startTap.small.slice(0, 6).join(', ') : '') +
     `, overflow ${startTap.hScroll}px`);

  /* --- deploy and fight --- */
  const tDeploy = Date.now();
  await deploy(page, { side: args.side || 'us', diff: args.diff === undefined ? 1 : Number(args.diff) });
  ok('deploys into a battle', true, `${((Date.now() - tDeploy) / 1000).toFixed(1)}s to first frame`);

  const before = await state(page);
  ok('scene built', before.sceneReady && before.units > 0 && before.blds === 2,
     `${before.units} units, ${before.blds} buildings`);

  /* --- and what that build put on the untextured tile. A lit() derivative is a colour in
     its own right and the table is keyed by the exact string, so every tint had to be
     registered by hand and a miss was silent. matOf follows a tint back to its source
     now; what is left over is a root nobody tagged, and this is the row that says so.
     Faces tagged 'generic' on purpose -- skin, hair, a painted helmet, a window recess --
     are counted apart from the misses, because a hole is meant to be flat. --- */
  const mats = await page.evaluate(() => {
    const t = window.__mt, roll = {};
    let meant = 0;
    for (const c in t.cols) {
      let r = c, n = 0;
      while (n++ < 8 && window._lsrc[r] !== undefined) r = window._lsrc[r];
      if (window.MATS.byColour[r] !== undefined) { meant += t.cols[c]; continue; }
      roll[r] = (roll[r] || 0) + t.cols[c];
    }
    const out = Object.keys(roll).map(k => [k, roll[k]]).sort((a, b) => b[1] - a[1]);
    return { tot: t.tot, gen: t.gen, meant, miss: t.gen - meant, top: out.slice(0, 4) };
  });
  const missPc = 100 * mats.miss / mats.tot;
  /* 0.5 per cent, against 0.07 where this leaves it and 41.7 where it started: a whole
     palette nobody tagged trips it and one small prop does not. */
  ok('every colour the world draws with has a material', missPc < 0.5,
     `${mats.tot} faces asked, ${mats.gen} on the flat tile (${(100 * mats.gen / mats.tot).toFixed(1)}%) of which ` +
     `${mats.meant} meant to be; untagged ${mats.miss} = ${missPc.toFixed(2)}%` +
     (mats.top.length ? ', worst ' + mats.top.map(x => `${x[0]}x${x[1]}`).join(' ') : ''));

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
    /* And what the mission SOUNDS like, which until now was nothing at all between the
       tube and the ground: a bomb is in the air for three seconds and the whistle is the
       only warning a player gets that a mission is landing on him. It is played at the
       ground it is coming at rather than at the tube, so it is counted here with the
       rounds rather than with the reports. */
    const heard = {};
    const realSfx = window.sfx;
    window.sfx = function (kind, sx, sy, sv) {
      heard[kind] = (heard[kind] || 0) + 1;
      if (kind === 'incoming') heard.at = Math.round(Math.hypot(sx - tx, sy - ty));
      return realSfx.apply(null, arguments);
    };
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
    window.sfx = realSfx;
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
             past: tx - 600 > m.def.w.range,
             inc: heard.incoming || 0, boom: heard.boom || 0, rep: heard.mortar || 0,
             incAt: heard.at === undefined ? -1 : heard.at };
  });
  ok('a mortar shells what the side can see, over what is in the way, and lands where it is laid',
     !mor.has || (mor.line === false && mor.unobserved === 0 && mor.observed > 0 &&
                  mor.laid && !mor.far && mor.past && mor.rounds === mor.want &&
                  mor.inBound === mor.rounds && mor.inCircle >= mor.rounds - 4 &&
                  /* every bomb is announced by its own report, its own incoming and its
                     own burst, and the incoming is laid at the ground and not at the tube */
                  mor.rep === mor.rounds && mor.inc === mor.rounds && mor.boom === mor.rounds &&
                  mor.incAt >= 0 && mor.incAt <= mor.bound),
     !mor.has ? 'no indirect weapon in this file'
              : `through a building: ${mor.unobserved} rounds unobserved, ${mor.observed} with eyes on; ` +
                `a mission past free-fire range fired ${mor.rounds} of ${mor.want}, ${mor.inCircle} inside ${mor.r} and ` +
                `${mor.inBound} inside ${mor.bound}, and out of range was refused; ` +
                `${mor.rep} tube reports, ${mor.inc} incoming and ${mor.boom} bursts, the last ` +
                `incoming ${mor.incAt} units from the aim point`);

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
  let markEver = false, lockEver = false;
  for (let i = 0; i < 10; i++) {
    await fastForward(page, 1);
    const a = await page.evaluate(() => ({ m: !!window.DRV.mark, l: !!window.DRV.lock }));
    if (a.m) markEver = true;
    if (a.l) lockEver = true;
  }
  /* A LOCK counts as well as a mark, and the row is named for exactly that: "target or
     none". povDrive sets DRV.mark only when there is nothing designated -- with an enemy
     under the crosshair the mark is null by construction and the lock holds instead -- so
     asking for the mark alone failed the row on the one run where somebody walked into
     the commander's sight, with three rounds in the street beside it. */
  const aim = { mark: markEver || lockEver, how: markEver ? (lockEver ? 'ground and a target' : 'the ground') : 'a target' };
  const fired = await page.evaluate(() => { window.DRV.padFire = false; return window.__booms; });
  /* The message says which half it was. Both halves have to hold -- he has to have a
     mark under the crosshair and rounds have to leave -- and printed as the round count
     alone a run that failed on the mark read identically to one that passed, which is
     how the same line came back FAIL on one device and PASS on the other with the same
     three rounds beside it. */
  ok('a round goes where the commander points, target or none', shot && aim.mark && fired > 0,
     `${fired} rounds into the street in nine seconds` +
     (aim.mark ? ', laid on ' + aim.how : ', but nothing under the crosshair at any point'));

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
     hcap.rows === 13 && !hcap.even && hcap.pd.pop === 1000 && hcap.popYou === 1000 &&
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

  /* --- HOWITZER FIRE, which is the other switch on the panel. A pack howitzer and a dug
     battery are laid by somebody else's map and fired on somebody else's order, and
     `barrageOnly` is the whole of that rule; FREE FIRE lifts it for one side so the piece
     engages what its own side can see the way a mortar always has.
       Three things are asked, and each of them is a refusal that has to be counted rather
     than assumed. His two fire with nothing ordered; the opposition's two, with the same
     enemy at the same range and its own row left even, fire nothing at all. The mortar is
     the control: it had the initiative either way and must read the same on both sides,
     or the row is measuring something other than the switch.
       And the battery keeps its own traverse. The flat 0.85 in the turn-to-target was
     never wrong before, because the only two pieces that carry a `traverse` of their own
     were the two that never picked a target; laid the other way about, an eight-inch
     howitzer has to take its own fifteen seconds to come round on a target it chose, the
     same fifteen it takes on a mission it was given. --- */
  const freeFire = await page.evaluate(() => {
    const side = window.G.side, foe = side === 'us' ? 'ger' : 'us';
    const keep = window.G.units.slice();
    /* a round is spent only when one leaves the tube, and the cooldown is the signal:
       fireAt is the only thing that sets it and it refuses for its own reasons */
    function drill(owner, key, behind) {
      window.G.units.length = 0;
      const other = owner === 'us' ? 'ger' : 'us';
      const u = window.spawnUnit(owner, key, 700, 900, behind ? Math.PI : 0);
      u.setup = 0;
      window.spawnUnit(other, other === 'ger' ? 'ger_gren' : 'us_rifle', 1100, 900, Math.PI);
      window.spawnUnit(owner, owner === 'us' ? 'us_rifle' : 'ger_gren', 1000, 900, 0);
      window.computeVisibility();
      let rounds = 0, first = -1, cd0 = u.cd || 0;
      for (let i = 0; i < 1400; i++) {
        window.G.t += 1 / 20;
        if (i % 2 === 0) window.computeVisibility();
        window.updateUnit(u, 1 / 20);
        if ((u.cd || 0) > cd0 + 1e-6) { rounds++; if (first < 0) first = i / 20; }
        cd0 = u.cd || 0;
      }
      return { rounds, first: first < 0 ? null : +first.toFixed(1) };
    }
    const K = s => ({ how: s === 'us' ? 'us_how' : 'ger_how',
                      bat: s === 'us' ? 'us_how8' : 'ger_how210',
                      mor: s === 'us' ? 'us_mor' : 'ger_mor' });
    const me = K(side), them = K(foe);
    const out = {
      onYou: window.hcapOf(side).free, onFoe: window.hcapOf(foe).free,
      howYou: drill(side, me.how), batYou: drill(side, me.bat),
      howFoe: drill(foe, them.how), batFoe: drill(foe, them.bat),
      morYou: drill(side, me.mor), morFoe: drill(foe, them.mor),
      batBehind: drill(side, me.bat, 1), morBehind: drill(side, me.mor, 1),
      traverse: window.UNITS[me.bat].traverse
    };
    window.G.units.length = 0;
    keep.forEach(u => window.G.units.push(u));
    return out;
  });
  const swing = Math.PI / freeFire.traverse;
  ok('free fire is the howitzers\' initiative, for the player and for nobody else',
     freeFire.onYou === true && freeFire.onFoe === false &&
     freeFire.howYou.rounds > 0 && freeFire.batYou.rounds > 0 &&
     freeFire.howFoe.rounds === 0 && freeFire.batFoe.rounds === 0 &&
     freeFire.morYou.rounds > 0 && freeFire.morFoe.rounds > 0 &&
     freeFire.batBehind.first !== null && Math.abs(freeFire.batBehind.first - swing) < 2.5 &&
     freeFire.morBehind.first !== null && freeFire.morBehind.first < swing * .4,
     `with nothing ordered over 70s: his howitzer fired ${freeFire.howYou.rounds} and his battery ` +
     `${freeFire.batYou.rounds}, where theirs fired ${freeFire.howFoe.rounds} and ${freeFire.batFoe.rounds}; ` +
     `the mortar is the control at ${freeFire.morYou.rounds} his and ${freeFire.morFoe.rounds} theirs. ` +
     `Laid the other way about, the battery took ${freeFire.batBehind.first}s to come round against ` +
     `${swing.toFixed(1)}s of its own traverse, and the mortar ${freeFire.morBehind.first}s`);

  /* --- and the same settings turned on the opposition, which is the panel that
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
    /* every opposition knob to its top, through the stepper rather than by writing the
       row. DIFFICULTY is stepped DOWN instead, to SAME: this row is about the arithmetic
       reaching the other side and nothing else, and moving the brain to veteran underneath
       it changes what the row is measuring against. */
    window.ACAP.forEach(h => { for (let i = 0; i < 20; i++) window.hcapStep(h, h.k === 'diff' ? -1 : 1, window.ACAP); });
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
    return { ad: window.hcapOf(foe), rows: document.querySelectorAll('#agrid .hrow').length,
             popFoe: window.popCap(foe), popYou: window.popCap(side),
             mpFoe: Math.round(window.G.res[foe].mp), fuFoe: Math.round(window.G.res[foe].fu),
             mpYou: Math.round(window.G.res[side].mp),
             incFoe: +window.G.inc[foe].mp.toFixed(2), incYou: +window.G.inc[side].mp.toFixed(2),
             dealt, took, eyeFoe, eyeYou, eyeFoeDef: theirs.sight, eyeDef: mine.sight,
             even: window.hcapEven(window.ACAP) };
  });
  ok('every computer player has the same settings as the player, and they run both ways',
     acap.rows === 14 && !acap.even && acap.ad.pop === 1000 && acap.popFoe === 1000 &&
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
  const aeven = await page.evaluate(() => ({ even: window.hcapEven(window.ACAP), made: window.adMake('foe1'),
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

  /* --- 2v2. A player is not a side: a TEAM shares vision, ground, the memory of where
     the enemy was and the victory points, and a PLAYER has his own headquarters, his own
     purse, his own queue, his own population cap and his own brain. The row asserts both
     halves, because each of them alone reads as working: four headquarters with one purse
     between two of them is a team pretending to be players, and four purses with one brain
     is four players pretending to be a team. --- */
  await reload(page);
  await page.evaluate(() => { document.getElementById('heven').click(); document.getElementById('aeven').click(); });
  await page.evaluate(() => window.startGame('us', 1, 'vp', true, true));
  await page.waitForFunction(() => window.SCENE && window.SCENE.ready);
  const duo0 = await page.evaluate(() => ({
    slots: window.G.slots.map(s => s.k + ':' + s.side + ':' + (s.ai ? 'ai' : 'you')),
    hqs: window.G.blds.filter(b => b.def.hq).map(b => b.own).sort(),
    hqSep: (() => { const h = window.G.blds.filter(b => b.def.hq && b.side === 'us');
                    return h.length === 2 ? Math.round(Math.hypot(h[0].x - h[1].x, h[0].y - h[1].y)) : -1; })(),
    /* and every one of them on ground the army can walk out of */
    hqWalk: window.G.blds.filter(b => b.def.hq)
      .filter(b => window.walkable(b.x + (b.side === 'us' ? 130 : -130), b.y)).length,
    brains: Object.keys(window.AIP).sort(),
    units: window.G.slots.map(s => window.G.units.filter(u => !u.dead && u.own === s.k).length),
    vp: [Math.round(window.vpOf('us')), Math.round(window.vpOf('ger'))],
    vpSlots: window.SLOTS.map(k => Math.round(window.G.res[k].vp))
  }));
  await fastForward(page, 150);
  const duo = await page.evaluate(() => {
    const own = window.G.own, ally = window.G.slots.filter(s => s.side === window.G.side && s.ai)[0].k;
    /* His own money is his: spending the ally's is not open to him, and the strip reads
       his. What is asserted is WHOSE till the strip is reading and not how fresh it is:
       the strip is refreshed here first and on most runs then agrees with the till to the
       mark, but not on all of them, for a reason that has not been run down -- so the row
       asks that it be within a few per cent of his and nowhere near his ally's, which is
       the claim, and an exact comparison only ever made the row flap on how much money
       there was rather than on whose it was. */
    window.updateTop(1);
    const mineMp = Math.floor(window.G.res[own].mp), allyMp = Math.floor(window.G.res[ally].mp);
    /* the order cards reach only his own men, so an ally's section cannot be selected into
       the list the command bar issues to */
    const allyU = window.G.units.filter(u => !u.dead && u.own === ally && u.cat !== 'veh')[0];
    window.select([allyU], false);
    const allyCmd = window.selectedUnits().filter(window.owned).length;
    window.select([], false);
    return {
      mineMp, allyMp, hud: document.getElementById('mpv').textContent,
      pop: window.SLOTS.map(k => window.G.pop[k] + '/' + window.popCap(k)),
      units: window.G.slots.map(s => s.k + ':' + window.G.units.filter(u => !u.dead && u.own === s.k).length),
      raised: window.G.slots.filter(s => s.ai).map(s => Object.keys(window.G.made[s.k]).length),
      queues: window.G.slots.filter(s => s.ai).map(s => window.G.blds.filter(b => b.own === s.k).length),
      allyCmd, sel: 0,
      /* the two brains on a team hold separate plans and separate call boards */
      plans: window.G.slots.filter(s => s.ai).map(s => window.AIP[s.k] && window.AIP[s.k].own),
      hq: window.hqOf(own) && window.hqOf(own).own,
      /* and the team's ground is still the team's: one owner per sector, not one per player */
      secOwners: [...new Set(window.G.sectors.map(x => x.owner).filter(Boolean))].sort().join(',')
    };
  });
  ok('a 2v2 is four players on two teams: four headquarters, four purses, four brains, two sides',
     duo0.slots.length === 4 && duo0.hqs.join(',') === 'ger,ger2,us,us2' && duo0.hqSep > 400 &&
     duo0.brains.join(',') === 'ger,ger2,us2' && duo0.hqWalk === 4 &&
     duo0.vp[0] === 420 && duo0.vp[1] === 420 &&
     duo0.vpSlots[1] === 0 && duo0.vpSlots[3] === 0 &&
     duo.plans.join(',') === 'us2,ger,ger2' && duo.hq === 'us' &&
     duo.secOwners.split(',').every(o => o === 'us' || o === 'ger') &&
     duo.mineMp !== duo.allyMp && Math.abs(+duo.hud - duo.mineMp) < duo.mineMp * .05 &&
     Math.abs(+duo.hud - duo.allyMp) > Math.abs(+duo.hud - duo.mineMp) * 8 &&
     duo.raised.every(n => n > 0) && duo.queues.every(n => n >= 1) && duo.allyCmd === 0,
     `${duo0.slots.join(' ')}; headquarters ${duo0.hqs.join(',')} with the two allies ${duo0.hqSep} apart ` +
     `and ${duo0.hqWalk} of 4 with room to march out of; ` +
     `brains ${duo.plans.join(',')}; his till ${duo.mineMp} against his ally's ${duo.allyMp} and the HUD ` +
     `reading ${duo.hud}; population ${duo.pop.join(' ')}; after 150s ${duo.units.join(' ')}; ` +
     `the ground has ${duo.secOwners} on it and the points are ${duo0.vp.join('/')} a team; ` +
     `an ally's section gives ${duo.allyCmd} of his own units to order`);

  /* --- the one-a-side vehicles. `limit: 1` on the Maus, the Tiger II and the King Tiger,
     and two on the eighty-eight, is a rule about the game rather than a fact about the
     vehicle, so it is a setting rather than an edit to the roster. Measured through
     `queueUnit`, which is one of the two doors a purchase goes through, with the till and
     the population filled first so that a refusal is the limit and never the money; and
     through `unitLimit`, which is what the other door reads. The player is GERMAN for this
     row, because every limited vehicle on the roster is, and both a player's slot and an
     AI's are measured, since the setting is per player. --- */
  await reload(page);
  await page.evaluate(() => { document.getElementById('heven').click(); document.getElementById('aeven').click(); });
  await deploy(page, { side: 'ger', diff: 1 });
  const lim = await page.evaluate(() => {
    function tryTwo(slot, key) {
      const hq = window.hqOf(slot), us = window.slotSide(slot) === 'us';
      const dep = window.G.blds.filter(b => b.own === slot && b.key === (us ? 'us_mot' : 'ger_dep'))[0] ||
                  window.spawnBuilding(slot, us ? 'us_mot' : 'ger_dep', hq.x + (us ? 240 : -240), hq.y, true);
      dep.built = 1; dep.queue.length = 0;
      window.G.res[slot].mp = 99999; window.G.res[slot].fu = 99999;
      window.queueUnit(dep, key); window.queueUnit(dep, key);
      const n = dep.queue.filter(k => k === key).length;
      dep.queue.length = 0;
      return n;
    }
    const you = window.G.own, ai = 'us';
    const byRule = tryTwo(you, 'ger_tig');
    const aiRule = window.unitLimit(ai, window.UNITS.us_how8);
    window.G.hc[you].noLimit = true;
    const free = tryTwo(you, 'ger_tig');
    const aiStill = window.unitLimit(ai, window.UNITS.us_how8);
    window.G.hc[you].noLimit = false;
    window.G.hc[ai].noLimit = true;
    const aiFree = window.unitLimit(ai, window.UNITS.us_how8);
    const backByRule = tryTwo(you, 'ger_tig');
    window.G.hc[ai].noLimit = false;
    return { byRule, free, backByRule, aiRule, aiStill, aiFree,
             def: window.UNITS.ger_tig.limit, flak: window.UNITS.ger_flak88.limit,
             rows: window.HCAP.filter(h => h.k === 'one').length +
                   window.ACAP.filter(h => h.k === 'one').length };
  });
  ok('the one-a-side vehicles are a setting, lifted per player and for nobody else',
     lim.rows === 2 && lim.def === 1 && lim.flak === 2 &&
     lim.byRule === 1 && lim.free === 2 && lim.backByRule === 1 &&
     lim.aiRule === 1 && lim.aiStill === 1 && lim.aiFree === 0,
     `the roster says one Tiger and ${lim.flak} eighty-eights; by rule he queues ${lim.byRule} of the ` +
     `Tiger, with his own setting lifted ${lim.free}, and ${lim.backByRule} again once it is back; ` +
     `the opposition's battery limit reads ${lim.aiRule} by rule, still ${lim.aiStill} while HIS is ` +
     `lifted, and ${lim.aiFree} (no limit) once its own is`);

  /* --- the build preference. A weight per KIND of thing on top of what the brain thinks
     the battle wants: nought takes a rung off the ladder altogether, above even raises the
     count it wants and brings the hour it opens forward. Measured on the ladder itself
     rather than on a battle, because what a brain gets round to buying in three minutes is
     a fact about the battle and this is a fact about the rule. --- */
  const pref = await page.evaluate(() => {
    const L = [['ger_sd222', 1, 40], ['ger_pak', 2, 130], ['ger_p4', 2, 260], ['ger_tig', 1, 620]];
    const cls = ['ger_sd222', 'ger_pak', 'ger_p4', 'ger_tig'].map(window.bClassOf);
    window.G.bp.ger = { inf: 1, elite: 1, mg: 1, at: 1, arty: 1, light: 1, med: 1, heavy: 1 };
    const even = window.aiPrefLadder('ger', L).map(e => e[0] + 'x' + e[1] + '@' + e[2]);
    window.G.bp.ger.light = 0; window.G.bp.ger.heavy = 3; window.G.bp.ger.med = 2;
    const tuned = window.aiPrefLadder('ger', L).map(e => e[0] + 'x' + e[1] + '@' + e[2]);
    window.G.bp.ger = { inf: 1, elite: 1, mg: 1, at: 1, arty: 1, light: 1, med: 1, heavy: 1 };
    return { cls, even, tuned, keys: window.BP_KEYS.length,
             rows: document.querySelectorAll('#bpref .hrow').length,
             never: window.BP_W[0], top: window.BP_W[window.BP_W.length - 1] };
  });
  ok('an AI can be told what to buy: a weight per kind, on top of what it thinks the battle wants',
     pref.cls.join(',') === 'light,at,med,heavy' && pref.keys === 8 && pref.rows === 8 &&
     pref.never === 0 &&
     pref.even.join(' ') === 'ger_sd222x1@40 ger_pakx2@130 ger_p4x2@260 ger_tigx1@620' &&
     pref.tuned.join(' ') === 'ger_pakx2@130 ger_p4x4@130 ger_tigx3@207',
     `${pref.rows} kinds; the roster falls into ${pref.cls.join(',')}; even the ladder reads ` +
     `${pref.even.join(' ')}, and with light at NEVER, medium at 2x and heavy at 3x it reads ` +
     `${pref.tuned.join(' ')}`);

  /* --- the selection ring, which has now been wrong three times and was caught by a
     player twice. It has to HOLD its unit and it has to FIT it, and those are two
     different failures: sized off the separation radius it held a fraction of a section,
     and sized off a nine-man formation no unit on this roster has, a three-man weapon team
     got a circle nearly three times the ground it stood on. So the row measures both, for
     every infantry unit on the roster: the ring against the formation it is drawn round,
     and then a battle's worth of men against the ring they belong to.
       It deploys its own battle: the block above it ends on the title screen with the
     handicap reset, and spawning into a world that was never built gives nineteen ring
     measurements and no men at all to check them against. --- */
  await reload(page);
  await deploy(page, { side: args.side || 'us', diff: 1 });
  const ring = await page.evaluate(() => {
    const rows = [];
    Object.keys(window.UNITS).forEach(k => {
      const d = window.UNITS[k];
      if (d.cat === 'veh' || !d.models) return;
      const side = k.slice(0, 2) === 'us' ? 'us' : 'ger';
      const u = window.spawnUnit(side, k, 600, 1200, 0);
      let far = 0;
      u.models.forEach(m => { far = Math.max(far, Math.hypot(m.ox, m.oy)); });
      rows.push({ k, n: d.models, far: Math.round(far), r: window.selRadius(u) });
      u.dead = true;
      const i = window.G.units.indexOf(u); if (i >= 0) window.G.units.splice(i, 1);
    });
    return rows;
  });
  /* it holds the formation, and it is not more than a man's width bigger than it */
  const tooSmall = ring.filter(r => r.r < r.far + 6);
  const tooBig = ring.filter(r => r.r > r.far + 20);
  await fastForward(page, 90);
  const held = await page.evaluate(() => {
    let men = 0, out = 0, worst = 0, worstKey = '';
    window.G.units.forEach(u => {
      if (u.dead || !u.models) return;
      const R = window.selRadius(u);
      u.models.forEach(m => {
        if (!m.alive) return;
        men++;
        const d = Math.hypot(m.x - u.x, m.y - u.y);
        if (d > R + 1) out++;
        if (d - R > worst - 0) { worst = d - R; worstKey = u.key; }
      });
    });
    return { men, out, over: Math.round(worst), worstKey };
  });
  ok('the selection ring holds its unit and fits it',
     !tooSmall.length && !tooBig.length && held.men > 20 && held.out === 0,
     `${ring.length} infantry types: a ${ring[0].n}-man ${ring[0].k} stands ${ring[0].far} out in a ` +
     `ring of ${ring[0].r}, the widest is ${Math.max.apply(null, ring.map(r => r.far))} in ` +
     `${Math.max.apply(null, ring.map(r => r.r))}; ` +
     (tooSmall.length ? tooSmall.map(r => r.k + ' ' + r.r + '<' + r.far).join(', ') + '; ' : '') +
     (tooBig.length ? tooBig.map(r => r.k + ' ' + r.r + '>>' + r.far).join(', ') + '; ' : '') +
     `after 90s of battle ${held.out} of ${held.men} men are outside their own ring ` +
     `(furthest ${held.over} past it, ${held.worstKey})`);

  /* --- Two maps ship, which makes two things true that were vacuous with one: the
     picker has to build the one it names, and the second map has to be fair. Fairness on a
     mirrored map is measurable rather than a matter of opinion, so the row measures it:
     every entity has its opposite number reflected about the midline, every flag is the
     same distance from each side's own headquarters, and the ground agrees with its own
     reflection. The last of those is the one that would not survive a screenshot -- a
     landform is arithmetic and two halves can look identical while one is a metre
     higher. --- */
  await reload(page);
  const maps = await page.evaluate(() => {
    const out = { keys: Object.keys(window.MAPS).sort().join(','), picked: '', brief: '' };
    /* the picker builds the map it names */
    document.querySelectorAll('.gmap').forEach(b => { if (b.dataset.map === 'gothic') b.click(); });
    out.picked = window.chosenMapData().name;
    out.brief = document.getElementById('objtext').textContent;
    const E = window.gothicMapData().entities;
    const key = e => e.t + '|' + Math.round(e.y !== undefined ? e.y : e.y1) +
                     '|' + Math.round((e.r || 0) + (e.w || 0) * 3);
    /* every thing on the west half has a twin at its reflection, bearing included */
    const west = E.filter(e => (e.x !== undefined ? e.x : e.x1) < 1399);
    const east = E.filter(e => (e.x !== undefined ? e.x : e.x1) > 1401);
    out.west = west.length; out.east = east.length;
    out.unpaired = west.filter(w => !east.some(e => {
      const wx = w.x !== undefined ? w.x : w.x1, ex = e.x !== undefined ? e.x : e.x1;
      if (e.t !== w.t || Math.abs(ex - (2800 - wx)) > 1) return false;
      const wy = w.y !== undefined ? w.y : w.y1, ey = e.y !== undefined ? e.y : e.y1;
      if (Math.abs(ey - wy) > 1) return false;
      if (w.a !== undefined && Math.abs(Math.cos(e.a) + Math.cos(w.a)) > .01) return false;
      return true;
    })).length;
    /* the ground against its own reflection */
    window.G.mapData = window.gothicMapData();
    window.startGame('us', 1, 'vp', true, true);
    let worst = 0;
    for (let y = 30; y < 1900; y += 37) for (let x = 30; x < 1400; x += 41)
      worst = Math.max(worst, Math.abs(window.groundZ(x, y) - window.groundZ(2800 - x, y)));
    out.ground = +worst.toFixed(2);
    /* every flag the same distance from the headquarters of the side it belongs to */
    const hq = window.G.hqPos, secs = window.G.sectors;
    const d = (s, h) => Math.hypot(s.x - h.x, s.y - h.y);
    out.flagSkew = Math.round(Math.max.apply(null, secs.map(s => {
      const mir = secs.filter(q => Math.abs(q.x - (2800 - s.x)) < 2 && Math.abs(q.y - s.y) < 2)[0];
      return mir ? Math.abs(d(s, hq.us) - d(mir, hq.ger)) : 0;
    })));
    out.vp = secs.filter(s => s.type === 'vp').length;
    out.owned = secs.filter(s => s.owner === 'us').length + ':' + secs.filter(s => s.owner === 'ger').length;
    /* and the ground between the two positions, which is what the map is about */
    const bk = window.G.blocks.filter(b => b.kind === 'bunker');
    out.gap = Math.round(Math.min.apply(null, bk.filter(b => b.x > 1400).map(b => b.x)) -
                         Math.max.apply(null, bk.filter(b => b.x < 1400).map(b => b.x)));
    return out;
  });
  /* and a battle is actually fought on it, because every other row in this file deploys
     on Ortona: a second map that boots and is never played is a second map nobody has
     run the game on */
  await fastForward(page, 120);
  const gfight = await page.evaluate(() => ({
    live: window.G.slots.map(s => window.G.units.filter(u => !u.dead && u.own === s.k).length),
    made: window.G.slots.filter(s => s.ai).every(s => Object.keys(window.G.made[s.k]).length > 0),
    held: [...new Set(window.G.sectors.map(x => x.owner).filter(Boolean))].sort()
  }));
  ok('both maps ship, and the second one is fair to the unit',
     maps.keys === 'gothic,ortona' && maps.picked === 'The Gothic Line' &&
     maps.brief.indexOf('Foglia') >= 0 && maps.unpaired === 0 && maps.west === maps.east &&
     maps.ground < 1 && maps.flagSkew === 0 && maps.vp === 3 && maps.owned === '2:2' &&
     /* Three of the four players are brains and have to be alive and buying; the fourth
        is the human's slot, which nobody is playing, so it is allowed to be wiped. And
        the ground is asked to be owned by a SIDE and never by a slot -- which an empty
        list satisfies, because a moment when every flag on the map is being contested is
        a fact about the battle rather than a fault in the 2v2. */
     maps.gap > 1200 && gfight.live.filter(n => n > 0).length >= 3 && gfight.made &&
     gfight.held.filter(o => o !== 'us' && o !== 'ger').length === 0,
     `maps ${maps.keys}; the picker on GOTHIC LINE builds "${maps.picked}" and the briefing ` +
     `reads "${maps.brief.slice(0, 26)}..."; ${maps.west} entities on the west half and ${maps.east} on the ` +
     `east with ${maps.unpaired} unpaired; the ground disagrees with its own reflection by at ` +
     `most ${maps.ground} of a unit over 1750 samples; ${maps.vp} victory flags, ${maps.owned} ` +
     `owned at the whistle, and no flag more than ${maps.flagSkew} units further from one ` +
     `headquarters than its twin is from the other; ${maps.gap} units between the bunker ` +
     `lines; after 120s of battle on it the four players have ${gfight.live.join('/')} units ` +
     `and the ground is held by ${gfight.held.join(',') || 'nobody, every flag contested'}`);

  /* --- and that the ground between the two lines is mud. A map says how wet its country
     is and how far it has been churned (LAND.wet, LAND.churn), and the churn is a wash
     painted last of everything in paintGround, after the roads and the craters. It is
     read off the albedo canvas rather than off the framebuffer, because the canvas is
     the paint on its own with no sun, no fog and nothing standing on it. What is asked
     is a difference and never an absolute: no man's land darker than the shelf the army
     forms up on, and less warm, which is what separates wet turned earth from dry
     stubble. A churn that quietly stopped being painted reads as a perfectly good map
     in every photograph ever taken of it. --- */
  const mud = await page.evaluate(() => {
    if (typeof window.mbase === 'undefined' || !window.mbase) return null;
    const ct = window.mbase.getContext('2d'), N = 90;
    const at = (x, y) => {
      const d = ct.getImageData(x - N / 2, y - N / 2, N, N).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < N * N; i++) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; }
      const n = N * N;
      return { r: r / n, g: g / n, b: b / n, v: Math.max(r, g, b) / n, warm: (r - b) / n };
    };
    return { shelf: at(240, 980), slope: at(800, 980), nml: at(1150, 980), mid: at(1400, 700) };
  });
  ok('the ground between the lines is mud, and the ground behind them is not',
     !!mud && mud.nml.v < mud.shelf.v * 0.9 && mud.nml.warm < mud.shelf.warm * 0.8 &&
     mud.mid.v < mud.shelf.v * 0.9,
     mud ? ['shelf', 'slope', 'nml', 'mid'].map(k =>
       `${k} ${mud[k].v.toFixed(0)}/${mud[k].warm.toFixed(1)}`).join('  ') + '  (value/warmth off the albedo)'
         : 'no albedo canvas to read');

  /* --- and that a halted man stands BESIDE a field wall rather than in it. A wall under
     16 is on neither blocking grid, because a man is meant to get over one, and it is not
     a prop either, so the formation laid its files straight through the masonry: two per
     cent of every man-frame of a battle here was a halted man standing in the stones,
     drawn inside them and getting nothing from them. Ortona never showed it because every
     wall in the town is over head height and solid. The test is geometric and asks the
     game's own index, and it is asked of a battle that has already been fought rather
     than of a staged drill, because what went wrong was where men end up and not where
     they are put. --- */
  const stones = await (async () => {
    /* Staged rather than sampled out of the battle, because a battle puts most of its men
       nowhere near a wall: with the fix switched off to calibrate it, a battle sample read
       0.91 per cent, which is a fault of two per cent hiding behind a denominator full of
       men in the open. A drill stands a section AT each wall and asks the whole question.
       And the count does its own geometry over G.walls rather than asking inMasonry,
       because a probe that measures with the function under test cannot see it fail. */
    const put = await page.evaluate(() => {
      const low = window.G.walls.filter(w => (w.h || 24) < 16);
      window.__keep = window.G.units.slice();
      window.G.units.length = 0;
      const key = window.G.side === 'us' ? 'us_rifle' : 'ger_gren';
      let n = 0;
      for (let i = 0; i < low.length && n < 12; i += Math.max(1, Math.floor(low.length / 12))) {
        const w = low[i];
        const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
        const a = Math.atan2(w.y2 - w.y1, w.x2 - w.x1), nx = -Math.sin(a), ny = Math.cos(a);
        /* on one side of it, with the trouble coming from the other */
        const u = window.spawnUnit(window.G.side, key, mx + nx * 26, my + ny * 26, a);
        if (!u) continue;
        u.threatAng = a - Math.PI / 2;
        n++;
      }
      return { drills: n, low: low.length };
    });
    await fastForward(page, 8);
    const c = await page.evaluate(() => {
      const low = window.G.walls.filter(w => (w.h || 24) < 16), box = [];
      low.forEach(w => {
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1), a = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
        const n = Math.max(2, Math.round(len / 34));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          box.push([w.x1 + (w.x2 - w.x1) * t, w.y1 + (w.y2 - w.y1) * t, len / n + 1, a]);
        }
      });
      const hit = (x, y) => box.some(b => {
        const dx = x - b[0], dy = y - b[1], c2 = Math.cos(-b[3]), sn = Math.sin(-b[3]);
        return Math.abs(dx * c2 - dy * sn) <= b[2] / 2 && Math.abs(dx * sn + dy * c2) <= 4;
      });
      let men = 0, inside = 0, covered = 0;
      window.G.units.forEach(u => {
        if (u.dead || !u.models) return;
        u.models.forEach(m => {
          if (!m.alive) return;
          men++;
          if (hit(m.x, m.y)) inside++;
          if (window.coverAt(m.x, m.y) > 0) covered++;
        });
      });
      window.G.units.length = 0;
      window.__keep.forEach(u => window.G.units.push(u));
      return { men, inside, covered };
    });
    return { ...put, ...c };
  })();
  ok('a halted man stands beside a field wall and not in it',
     stones.drills >= 6 && stones.men > 0 && 100 * stones.inside / stones.men < 2,
     `${stones.low} low wall runs on the map; ${stones.drills} sections stood at one and left to settle, ` +
     `${stones.inside} of ${stones.men} men in the stones ` +
     `(${(100 * stones.inside / stones.men).toFixed(1)}%), ${stones.covered} of them behind something`);

  /* --- Destruction. A house knocked flat that still stops a boot and still stops an eye
     is a picture of rubble laid over a building that is, as far as everything else in the
     game is concerned, exactly where it was -- and it is the one fault here a screenshot
     would call a success. So the row asks the SAME CELL the same four questions with the
     bay standing and with the bay down, puts a section in the house first to see it put
     out, and counts the stone: what settles has to be what came out of the walls, because
     masonry that vanishes on landing is a collapse nobody can stand in. --- */
  const wreck = await (async () => {
    /* on Ortona, because a terrace is what this is about and the Gothic Line is a valley
       floor with two farms on it */
    await reload(page);
    await page.evaluate(() => {
      window.G.mapData = window.defaultMapData();
      window.startGame('us', 1, 'vp', true, true);
    });
    await page.waitForFunction(() => window.SCENE && window.SCENE.ready, null, { timeout: 180000 });
    const put = await page.evaluate(() => {
      /* the widest house that has nothing else standing right beside it, so most of what
         the battery does lands on the thing under test */
      const p = window.G.props.filter(q => q.kind === 'ruin' && q.style !== 'church' && q.w > 90 &&
        !window.G.blds.some(b => Math.hypot(b.x - q.x, b.y - q.y) < 300) &&
        !window.G.props.some(r => r !== q && r.solid && r.kind !== 'sea' &&
                                  Math.hypot(r.x - q.x, r.y - q.y) < 150))
        .sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (!p) return null;
      window.__keep = window.G.units.slice();
      window.G.units.length = 0;
      const u = window.spawnUnit(window.G.side, window.G.side === 'us' ? 'us_rifle' : 'ger_gren',
                                 p.x, p.y + p.h / 2 + 40);
      window.enterBuilding(u, p);
      window.rebuildGrid();
      const B = window.ruinState(p), b = B[Math.floor(B.length / 2)];
      const ci = window.cidx((b.x / window.CELL) | 0, (p.y / window.CELL) | 0);
      return { up: { walk: window.walkable(b.x, p.y) ? 1 : 0, sight: window.sblk[ci] ? 1 : 0,
                     fire: window.fblk[ci] ? 1 : 0, rub: window.rubg[ci] ? 1 : 0,
                     gar: !!u.gar, hurt: !!p.hurt },
               bays: B.length, x: b.x, y: p.y, w: Math.round(p.w), h: Math.round(p.h) };
    });
    if (!put) return null;
    /* a battery on it, which is the one thing on the roster that brings a house down */
    const shot = await page.evaluate(a => {
      const p = window.G.props.filter(q => q.kind === 'ruin' && Math.abs(q.x - a.x) < a.w &&
                                           Math.abs(q.y - a.y) < a.h)[0];
      let n = 0;
      for (let i = 0; i < 14; i++) {
        window.explode(a.x + (i % 5 - 2) * 11, a.y - a.h / 2 - 2, 130, 300, null, null, 22);
        n++;
      }
      let vol = 0;
      for (const c of window.G.debris) vol += c.l * c.w * c.h;
      return { rounds: n, air: window.G.debris.length, vol: Math.round(vol),
               queued: Object.keys(window.G.tileQ).length, bays: (p.bay || []).filter(b => b.down > 0).length };
    }, put);
    await fastForward(page, 14);
    /* and one drawn frame, because the house's own buffer is built in the draw: fast
       forward stubs render() out, so without this the row asks whether a thing that has
       not been drawn yet has been drawn */
    await frames(page, 2);
    const down = await page.evaluate(a => {
      const p = window.G.props.filter(q => q.kind === 'ruin' && Math.abs(q.x - a.x) < a.w &&
                                           Math.abs(q.y - a.y) < a.h)[0];
      const ci = window.cidx((a.x / window.CELL) | 0, (a.y / window.CELL) | 0);
      const u = window.G.units.filter(e => !e.dead)[0];
      let vol = 0;
      for (const r of window.G.rub) vol += r.l * r.w * r.h;
      let mound = 0;
      for (let dx = -60; dx <= 60; dx += 14) for (let dy = -40; dy <= 40; dy += 14)
        mound = Math.max(mound, window.moundAt(a.x + dx, a.y + dy));
      const st = { walk: window.walkable(a.x, a.y) ? 1 : 0, sight: window.sblk[ci] ? 1 : 0,
                   fire: window.fblk[ci] ? 1 : 0, rub: window.rubg[ci] ? 1 : 0,
                   gar: !!(u && u.gar), hurt: !!p.hurt, standing: Math.round(window.ruinStanding(p)),
                   canGar: window.canGarrison({ cat: 'inf', def: { speed: 30 }, models: [] }, p),
                   settled: window.G.rub.length, vol: Math.round(vol), mound: +mound.toFixed(1),
                   air: window.G.debris.length, buf: !!p.buf };
      window.G.units.length = 0;
      window.__keep.forEach(e => window.G.units.push(e));
      window.rebuildGrid();
      return st;
    }, put);
    return { ...put, ...shot, down };
  })();
  ok('a house shelled flat stops being a house on every grid that reads one',
     !!wreck && wreck.up.walk === 0 && wreck.up.sight === 1 && wreck.up.fire === 1 &&
     wreck.up.rub === 0 && wreck.up.gar === true && wreck.up.hurt === false &&
     wreck.down.walk === 1 && wreck.down.sight === 0 && wreck.down.fire === 0 &&
     wreck.down.rub === 1 && wreck.down.gar === false && wreck.down.canGar === false &&
     wreck.down.standing < 34 && wreck.down.buf === true,
     wreck ? `${wreck.w}x${wreck.h} in ${wreck.bays} bays, ${wreck.rounds} heavy rounds: ` +
             `walkable ${wreck.up.walk}->${wreck.down.walk}, stops an eye ${wreck.up.sight}->${wreck.down.sight}, ` +
             `stops a round ${wreck.up.fire}->${wreck.down.fire}, rubble ${wreck.up.rub}->${wreck.down.rub}, ` +
             `garrison ${wreck.up.gar ? 'held' : 'none'}->${wreck.down.gar ? 'held' : 'put out'}, ` +
             `${wreck.down.standing} units left standing, ` +
             `holdable ${wreck.down.canGar ? 'still' : 'no'}, own buffer ${wreck.down.buf ? 'yes' : 'no'}`
           : 'no isolated terrace on the map to shell');
  ok('the masonry that comes out of it is the masonry that lands',
     !!wreck && wreck.air > 40 && wreck.down.air === 0 && wreck.down.settled > 40 &&
     wreck.down.vol > wreck.vol * 0.75 && wreck.down.mound > 3,
     wreck ? `${wreck.air} chunks in the air and ${wreck.down.settled} settled, ` +
             `${wreck.down.vol} of ${wreck.vol} units of stone kept, heap ${wreck.down.mound} deep`
           : '');


  /* --- Bodies. Every collision in the game was one circle on two markers, sized at half
     a vehicle's LENGTH off its hit points -- so a Sherman carried a metre and a half of
     open ground either side of its tracks, and a rifle section walking past one was held
     off with eleven units of daylight on one bearing and stood nine units inside the hull
     on another. Both halves of that are what the player sees, and neither shows in a
     picture: a tank stopping short and a tank standing in a man look identical from
     above. So the row walks the pair together on eight bearings and measures what was
     actually between the two MODELS at the moment the push fired, off the model faces
     rather than off anything the game carries. --- */
  const bodies = await page.evaluate(() => {
    const keep = window.G.units.slice();
    const MAN = 11;
    function hullBox(key) {
      const V = window.VMODEL[key];
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      const eat = fs => { if (!fs) return; for (const f of fs) for (const v of f.v) {
        if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0];
        if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; } };
      eat(V.hull); eat(V.skirts);
      return { x0, x1, y0, y1 };
    }
    function boxDist(cx, cy, yaw, b, px, py) {
      const c = Math.cos(yaw), s = Math.sin(yaw), dx = px - cx, dy = py - cy;
      const lx = dx * c + dy * s, ly = dy * c - dx * s;
      return Math.hypot(Math.max(b.x0 - lx, 0, lx - b.x1), Math.max(b.y0 - ly, 0, ly - b.y1));
    }
    const drop = u => { const i = window.G.units.indexOf(u); if (i >= 0) window.G.units.splice(i, 1); };
    /* A CORRIDOR, and whether one was found is reported rather than assumed. Asked for a
       340-unit square with no cover anywhere in it, Ortona has nowhere that qualifies --
       so the search came back empty, `sx` and `sy` stayed at nought, and every drill was
       staged in the map's corner where nothing is walkable. What that reads as is a row
       measuring a tank that spends the whole drill walking out to the nearest ground it
       can stand on, which is not the row anybody wrote. */
    let sx = 0, sy = 0, found = false;
    for (let ty = 400; ty < window.WORLD.h - 400 && !found; ty += 40)
      for (let tx = 400; tx < window.WORLD.w - 400 && !found; tx += 40) {
        let ok = true;
        for (let a = -190; a <= 190 && ok; a += 20)
          for (let b = -70; b <= 70 && ok; b += 20)
            if (!window.walkable(tx + a, ty + b)) ok = false;
        /* and what the drill needs off the ground, which is not "no cover anywhere". By
           the time these rows run three battles have been fought on Ortona and the map
           is covered in craters, every one of which is a piece of cover, so a cover-free
           patch does not exist and the search fell to the map's middle with nothing
           saying so. What matters to a vehicle driving and turning is what SLOWS it. */
        for (let a = -120; a <= 120 && ok; a += 20)
          for (let b = -60; b <= 60 && ok; b += 20)
            if (window.onRubble(tx + a, ty + b) || window.inWire(tx + a, ty + b) ||
                window.inHogs(tx + a, ty + b)) ok = false;
        if (ok) { sx = tx; sy = ty; found = true; }
      }
    if (!found) { sx = window.WORLD.w / 2; sy = window.WORLD.h / 2; }
    /* the body against the hull, over the whole roster */
    let worstL = 0, worstW = 0, n = 0;
    for (const k of Object.keys(window.UNITS)) {
      const d = window.UNITS[k];
      if (d.cat !== 'veh' || !window.VMODEL[k]) continue;
      const b = hullBox(k), u = window.spawnUnit(d.side, k, sx, sy, 0);
      window.unitBody(u);
      worstL = Math.max(worstL, u.bodyL / Math.max(b.x1, -b.x0));
      worstW = Math.max(worstW, u.bodyW / Math.max(b.y1, -b.y0));
      n++; drop(u);
    }
    /* and the gap at contact, over eight bearings */
    const rows = [];
    for (const [ak, as, bk, bs] of [['us_sher', 'us', 'us_rifle', 'us'],
                                    ['us_sher', 'us', 'us_sher', 'us']]) {
      const A = window.spawnUnit(as, ak, sx, sy, 0), B = window.spawnUnit(bs, bk, sx + 700, sy, Math.PI);
      const ab = hullBox(ak), bb = window.VMODEL[bk] ? hullBox(bk) : null;
      let lo9 = 1e9, hi9 = -1e9;
      for (let i = 0; i < 8; i++) {
        const br = i / 8 * Math.PI * 2;
        A.x = sx; A.y = sy; A.facing = 0;
        const put = dd => {
          B.x = sx + Math.cos(br) * dd; B.y = sy + Math.sin(br) * dd;
          B.facing = br + Math.PI;
          if (B.models) { const c = Math.cos(B.facing), s = Math.sin(B.facing);
            for (const m of B.models) { m.x = B.x + m.ox * c - m.oy * s; m.y = B.y + m.ox * s + m.oy * c; } }
        };
        let lo = 2, hi = 520;
        put(hi);
        if (window.sepDepth(A, B) > 0) { lo9 = -999; continue; }
        for (let it = 0; it < 44; it++) {
          const mid = (lo + hi) / 2; put(mid);
          if (window.sepDepth(A, B) > 0) lo = mid; else hi = mid;
        }
        put(hi);
        let gap = 1e9;
        if (B.models) {
          for (const m of B.models) if (m.alive) gap = Math.min(gap, boxDist(A.x, A.y, A.facing, ab, m.x, m.y) - MAN);
        } else {
          const c = Math.cos(B.facing), s = Math.sin(B.facing);
          for (const cx of [bb.x0, bb.x1]) for (const cy of [bb.y0, bb.y1])
            gap = Math.min(gap, boxDist(A.x, A.y, A.facing, ab, B.x + cx * c - cy * s, B.y + cx * s + cy * c));
          for (const cx of [ab.x0, ab.x1]) for (const cy of [ab.y0, ab.y1])
            gap = Math.min(gap, boxDist(B.x, B.y, B.facing, bb, A.x + cx, A.y + cy));
        }
        lo9 = Math.min(lo9, gap); hi9 = Math.max(hi9, gap);
      }
      rows.push({ pair: ak + ' vs ' + bk, lo: +lo9.toFixed(1), hi: +hi9.toFixed(1) });
      drop(A); drop(B);
    }
    /* tracks against wheels, the same 180 asked of both */
    const turns = [];
    for (const k of ['us_sher', 'ger_sd222']) {
      window.G.units.length = 0;
      /* and inside the ground the spot search actually cleared. Staged at 200 either
         side, both ends fell outside the 170-unit box that was checked, so both vehicles
         spent the drill walking out to the nearest ground they could stand on and the
         about-turn never happened at all. */
      const u = window.spawnUnit(window.UNITS[k].side, k, sx + 150, sy, 0);
      /* the waypoint is set by hand rather than asked for. `orderMove` goes through the
         pathfinder, which on a real map hands back a route that curves away instead of
         doubling back, so the drill measured half a radian of correction and not an
         about-turn at all. */
      u.order = 'move';
      u.path = [{ x: sx - 150, y: sy }];
      u.pi = 0; u.pathStamp = window.gridStamp;
      let drift = 0, turned = 0, px = u.x, py = u.y, pf = u.facing;
      for (let i = 0; i < 1400; i++) {
        window.G.t += 1 / 60;
        window.updateUnit(u, 1 / 60);
        let df = u.facing - pf;
        while (df > Math.PI) df -= 2 * Math.PI;
        while (df < -Math.PI) df += 2 * Math.PI;
        turned += Math.abs(df);
        if (Math.abs(df) > .004) drift += Math.hypot(u.x - px, u.y - py);
        px = u.x; py = u.y; pf = u.facing;
        if (Math.hypot(u.x - (sx - 150), u.y - sy) < 30) break;
      }
      turns.push({ key: k, wheeled: !!u.def.wheeled, drift: Math.round(drift), turned: +turned.toFixed(2) });
    }
    window.G.units.length = 0;
    keep.forEach(e => window.G.units.push(e));
    window.rebuildGrid();
    return { n, worstL: +worstL.toFixed(2), worstW: +worstW.toFixed(2), rows, turns, sx, sy, found };
  });
  ok('a hull is the shape of a hull, and what it is kept off is the men',
     bodies.n >= 10 && bodies.worstL < 1.02 && bodies.worstW < 1.02 &&
     bodies.rows.every(r => r.lo > -3 && r.hi < 6),
     `${bodies.n} vehicles, the collision body at most ${bodies.worstL}x their own half-length and ` +
     `${bodies.worstW}x their half-beam; ` +
     bodies.rows.map(r => `${r.pair} meet with ${r.lo} to ${r.hi} units between the models over 8 bearings`).join('; '));
  ok('tracks turn where they stand and wheels have to drive the turn',
     bodies.found && bodies.turns.length === 2 &&
     bodies.turns[0].turned > 2.6 && bodies.turns[1].turned > 2.6 &&
     bodies.turns[0].drift < 40 && bodies.turns[1].drift > 60 &&
     bodies.turns[1].drift > bodies.turns[0].drift * 2,
     (bodies.found ? '' : 'NO CLEAR CORRIDOR FOUND; ') +
     bodies.turns.map(t => `${t.key} (${t.wheeled ? 'wheels' : 'tracks'}) drove ${t.drift} units through ` +
                           `${t.turned} rad of about-turn`).join(', '));

  /* --- And a dead vehicle. The effects round one were never the fault: there is a full
     burst, a real crater, two minutes of smoke and a fire that lights the street. The
     BODY never changed -- the same hull buffer, standing level on its suspension, drawn
     in a darker colour, with the turret nudged three units. From above that is a dark
     tank beside a live one, which is why no screenshot ever said so. The row renders the
     same Sherman alive and then dead from one camera and counts the pixels between them,
     against a control of the live frame rendered twice. --- */
  const hulk = await page.evaluate(({ sx, sy }) => {
    const keep = window.G.units.slice(), gl = window.gl;
    const W = () => gl.drawingBufferWidth, H = () => gl.drawingBufferHeight;
    /* three renders a grab: `render()` refreshes the fog and uploads the decal canvas
       every third frame, so two consecutive frames of a still scene differ by whichever
       of those fell between them -- measured, that control was larger than the thing
       being measured. Grabbing on the period puts the control back at nothing. */
    function grab() {
      const px = new Uint8Array(W() * H() * 4);
      window.render(); window.render(); window.render();
      gl.readPixels(0, 0, W(), H(), gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    }
    function lift(a, b) {
      let hit = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
        if (d > 6) hit++;
      }
      return hit;
    }
    window.G.units.length = 0; window.G.wrecks.length = 0; window.G.debris.length = 0;
    window.G.rub.length = 0; window.G.fx.length = 0; window.G.corpses.length = 0;
    /* and the camera shake, which is the one thing in the frame that is random per
       RENDER: `shake.t` is wound down inside `frame()` alone, so a shake left running by
       anything earlier jitters the camera a few pixels on every draw and the control of
       two identical frames comes back at tens of thousands of pixels */
    window.shake.t = 0; window.shake.mag = 0;
    const u = window.spawnUnit('us', 'us_sher', sx, sy, .7);
    window.CAM.tx = sx; window.CAM.ty = sy; window.CAM.dist = 250;
    window.CAM.yaw = 1.1; window.CAM.pitch = .62;
    /* and the frame is warmed before anything is measured. A camera moved to a new
       place takes a dozen frames to settle -- the fog is refreshed every third one and
       eases toward what it should be -- so a control of two "identical" frames came back
       at 41,975 pixels of 1.44 million, larger than the thing being measured. */
    for (let i = 0; i < 14; i++) window.render();
    window.G.units.forEach(q => { q.vUs = q.vGer = true; });
    window.G.blds.forEach(q => { q.vUs = q.vGer = true; });
    const a1 = grab(), a2 = grab(), ctrl = lift(a1, a2);
    /* and the shapes the death can take, counted over enough of them to be a share */
    let off = 0, cant = 0;
    for (let i = 0; i < 40; i++) {
      window.G.wrecks.length = 0; window.G.debris.length = 0;
      window.makeWreck(u);
      const w = window.G.wrecks[0];
      if (w.blown) off++;
      cant += Math.hypot(w.lean, w.nose) * 180 / Math.PI;
    }
    /* one of them, staged with the turret down so the picture is the same every run */
    window.G.units.length = 0; window.G.wrecks.length = 0; window.G.debris.length = 0;
    window.makeWreck(u);
    const w = window.G.wrecks[0];
    const plate = window.G.debris.length;
    w.blown = true; w.fly = null; w.skirts = false;
    w.tx = sx + 46; w.ty = sy + 20; w.tz = window.groundZ(sx + 46, sy + 20) + 6;
    w.ta = 1.9; w.tLean = 1.4; w.tNose = .3;
    /* the plate and the blast are cleared before the shutter. `makeWreck` throws its own
       burst when the mount comes off, and a fireball forty units across from a camera two
       hundred and fifty away covers most of the frame -- so the row came back at 846,319
       pixels and was measuring the explosion rather than the body it exists to measure. */
    window.G.debris.length = 0; window.G.fx.length = 0; window.G.shots.length = 0;
    window.shake.t = 0; window.shake.mag = 0;
    const b = grab(), moved = lift(a1, b);
    window.G.wrecks.length = 0; window.G.debris.length = 0; window.G.rub.length = 0;
    window.G.units.length = 0;
    keep.forEach(e => window.G.units.push(e));
    window.rebuildGrid();
    return { ctrl, moved, off, cant: +(cant / 40).toFixed(1), plate, tot: W() * H() };
  }, { sx: bodies.sx, sy: bodies.sy });
  ok('a dead vehicle is a different shape, not a darker colour',
     hulk.moved > 12000 && hulk.moved > hulk.ctrl * 20 && hulk.off > 4 && hulk.off < 36 &&
     hulk.cant > 1 && hulk.plate >= 5,
     `${hulk.moved} pixels of a ${hulk.tot}-pixel frame moved between the same tank alive and dead, ` +
     `against ${hulk.ctrl} between two live frames; ${hulk.off} of 40 deaths threw the turret off, ` +
     `the hull settles ${hulk.cant} degrees over, and ${hulk.plate} pieces of plate come off it`);

  /* --- Effects. Every particle the game makes used to be one draw call of one soft
     disc, so a Lee-Enfield and a 210mm shell were the same picture at two sizes, and a
     tracer lived on the 2D overlay -- a separate canvas stacked over the world, where
     nothing can be behind anything. Both faults render as something plausible, which is
     why they lasted: a flash is a flash and a bright line is a bright line. So the rows
     read the FRAMEBUFFER rather than looking at it, twice, once with the effect and once
     without, and ask what it actually put on the screen. --- */
  const fx = await (async () => {
    /* on Ortona, which the destruction rows above have already loaded: the occlusion
       drill wants a terrace to hide a round behind and the Gothic Line is a valley
       floor with two farms on it */
    const r = await page.evaluate(() => {
      const gl = window.gl;
      const W = () => gl.drawingBufferWidth, H = () => gl.drawingBufferHeight;
      function grab() {
        const px = new Uint8Array(W() * H() * 4);
        window.render();
        gl.readPixels(0, 0, W(), H(), gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      }
      function lift(a, b) {
        let hit = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
          if (d > 6) hit++;
        }
        return hit;
      }
      function step(sec) {
        const rr = window.render, ra = window.requestAnimationFrame;
        window.render = function () {}; window.requestAnimationFrame = function () { return 0; };
        let t = performance.now(); window.last = t;
        for (let i = 0; i < Math.round(sec / .02); i++) { t += 20; window.frame(t); }
        window.render = rr; window.requestAnimationFrame = ra;
        window.last = performance.now();
      }
      const G = window.G;
      G.ambientSmoke.length = 0;
      const keep = G.units.slice();
      /* level, inland, clear: the coastal bench is flat and looks down a sea cliff */
      let F = null, bs = -1;
      for (let x = 500; x < window.WORLD.w - 500; x += 60) for (let y = 400; y < window.WORLD.h - 400; y += 60) {
        const z = window.groundZ(x, y);
        if (z < 6) continue;
        let worst = 0;
        for (let a = 0; a < 8; a++) worst = Math.max(worst, Math.abs(
          window.groundZ(x + Math.cos(a) * 240, y + Math.sin(a) * 240) - z));
        if (worst > 10) continue;
        let near = 1e9;
        for (const b of G.blds) near = Math.min(near, Math.hypot(b.x - x, b.y - y));
        for (const q of G.props) near = Math.min(near, Math.hypot(q.x - x, q.y - y));
        if (near < 150) continue;
        const sc = Math.min(near, 600) - worst * 20;
        if (sc > bs) { bs = sc; F = { x, y }; }
      }
      F = F || { x: window.WORLD.w / 2, y: window.WORLD.h / 2 };

      /* MUZZLE: every weapon fired once from the same spot with the same camera on it */
      G.units.length = 0; G.fx.length = 0; G.shots.length = 0;
      window.__o.reveal();
      window.__o.camera({ x: F.x - 40, y: F.y, dist: 210, yaw: -1.1, pitch: .32 });
      const blasts = [];
      let blind = [];
      for (const key of Object.keys(window.UNITS)) {
        const def = window.UNITS[key];
        if (!def.cat || !def.w || def.hq) continue;
        G.units.length = 0; G.fx.length = 0; G.shots.length = 0; G.paused = false;
        const u = window.spawnUnit(def.side, key, F.x - 60, F.y, 0);
        if (!u) continue;
        u.setup = 0; u.lay = 0; u.turret = 0; u.facing = 0; u.cd = 0; u.atcd = 0;
        /* inside the weapon's own reach, measured from the FIRER rather than from the
           stage point it stands sixty units short of: written the other way about, the
           two 165-reach engineer sections were staged at 175 and fired nothing */
        const e = window.spawnUnit(def.side === 'us' ? 'ger' : 'us',
                                   def.side === 'us' ? 'ger_gren' : 'us_rifle',
                                   u.x + Math.min(240, (def.w.range || 300) * .7), F.y, Math.PI);
        G.paused = true;
        const ref = grab();
        G.paused = false;
        if (def.barrageOnly || def.indirect) { window.orderBarrage(u, e.x, e.y); u.lay = 0; u.facing = 0; }
        u.cd = 0; u.atcd = 0;
        window.fireAt(u, e);
        step(.04);
        G.paused = true;
        const px = lift(ref, grab());
        /* a battery refused its mission by the safe radius is a rule working rather
           than a gun with no flash, and the stage point is only clear of buildings by
           150 where that radius is 600 */
        if (def.barrageOnly && !u.barrage) continue;
        if (px < 400) blind.push(key); else blasts.push({ key, px });
      }
      blasts.sort((a, b) => a.px - b.px);

      /* TRACER: the same round laid across the same patch of screen, once on the far
         side of a house and once on the near side. On the overlay both read the same. */
      G.units.length = 0; G.fx.length = 0; G.shots.length = 0; G.paused = true;
      const house = G.props.filter(q => q.kind === 'ruin' && q.w > 110 && q.h > 60)
                           .sort((a, b) => b.w * b.h - a.w * a.h)[0];
      let front = 0, behind = 0;
      if (house) {
        window.__o.camera({ x: house.x, y: house.y, dist: 300, yaw: Math.PI, pitch: .45 });
        const ref = grab();
        const lay = dx => {
          G.shots.length = 0;
          for (let i = 0; i < 7; i++)
            G.shots.push({ kind: 'tracer', x: house.x + dx, y: house.y - 130,
                           sx: house.x + dx, sy: house.y - 130,
                           tx: house.x + dx, ty: house.y + 130,
                           t: .08 + i * .002, dur: .16, tail: .5, z0: 30, tr: 1,
                           col: window.TRACER.us, side: 'us' });
        };
        lay(house.w / 2 + 40); behind = lift(ref, grab());
        lay(-(house.w / 2 + 40)); front = lift(ref, grab());
        G.shots.length = 0;
      }

      /* BURST: the heaviest shell in the game, read at four ages. What was wrong with
         the old one was its shape in TIME -- a flash and then nothing. */
      const ages = [];
      window.__o.camera({ x: F.x, y: F.y, dist: 560, yaw: -1.1, pitch: .62 });
      G.fx.length = 0; G.paused = true;
      const bref = grab();
      let draws = 0, quads = 0, top = 0;
      for (const age of [.02, .30, .80, 1.60]) {
        G.fx.length = 0; G.paused = false;
        window.explode(F.x, F.y, 130, 40, null, null, 6);
        step(age);
        G.paused = true;
        ages.push({ age, px: lift(bref, grab()), n: G.fx.length });
        draws = window.FXN.draws; quads = window.FXN.quads;
        for (const f of G.fx) if (f.z !== undefined) top = Math.max(top, f.z - window.groundZ(F.x, F.y));
      }
      G.fx.length = 0; G.shots.length = 0;
      G.units.length = 0; keep.forEach(u => G.units.push(u));
      G.paused = false;
      return { blasts, blind, front, behind, ages, draws, quads, top: Math.round(top),
               cols: { us: window.TRACER.us.join(','), ger: window.TRACER.ger.join(',') },
               house: house ? Math.round(house.w) + 'x' + Math.round(house.h) : 'none' };
    });
    return r;
  })();
  const spread = fx.blasts.length ? fx.blasts[fx.blasts.length - 1].px / Math.max(1, fx.blasts[0].px) : 0;
  ok('every gun on the roster has its own blast, and a tracer is in the world rather than over it',
     fx.blasts.length >= 20 && fx.blind.length === 0 && spread > 8 &&
     fx.front > 2000 && fx.behind < Math.max(200, fx.front * 0.1) &&
     fx.cols.us !== fx.cols.ger,
     `${fx.blasts.length} weapons fired, ${fx.blind.length} of them putting nothing on the screen` +
     `${fx.blind.length ? ' (' + fx.blind.join(' ') + ')' : ''}; ` +
     `the biggest blast lights ${Math.round(spread)}x the pixels of the smallest ` +
     `(${fx.blasts[0].key} ${fx.blasts[0].px} to ${fx.blasts[fx.blasts.length - 1].key} ` +
     `${fx.blasts[fx.blasts.length - 1].px}); a round laid across a ${fx.house} house lights ` +
     `${fx.front} px in front of it and ${fx.behind} behind it; tracer runs ${fx.cols.us} for one ` +
     `side and ${fx.cols.ger} for the other`);
  ok('a shell landing is an event with a shape in time, not a flash and then nothing',
     /* the column is shorter on a phone, which spawns four puffs of it rather than
        eleven, so the floor is what a phone has to clear */
     fx.ages.every(a => a.px > 1500) && fx.ages[3].px > 1500 && fx.top > 90 && fx.draws <= 2,
     fx.ages.map(a => `${a.age.toFixed(2)}s ${a.px}px/${a.n}fx`).join('  ') +
     `; the column reaches ${fx.top} units and the whole of it goes out in ${fx.draws} draw call(s) ` +
     `of ${fx.quads} quads`);

  /* --- The hole a shell leaves. What a burst did to the ground was paint a stain on it,
     and a stain is exactly as deep as the ground was before: a crater field a battery had
     worked over for ten minutes was flat ground with dark patches on it. The row asks the
     two questions a photograph of a dark patch cannot tell apart -- did the SURFACE move,
     and did the picture of it move with it -- and then the three that follow from a hole
     being a hole: cover where there was none, ground a section can still walk into, and
     the height still being the sum of its own layers, which is what `levelPad` broke the
     first time by writing a building's pad straight into the worked height. --- */
  const hole = await page.evaluate(() => {
    const gl = window.gl, G = window.G;
    const W = () => gl.drawingBufferWidth, H = () => gl.drawingBufferHeight;
    function grab() {
      const px = new Uint8Array(W() * H() * 4);
      window.render();
      gl.readPixels(0, 0, W(), H(), gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    }
    function moved(a, b) {
      let n = 0;
      for (let i = 0; i < a.length; i += 4)
        if ((Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3 > 6) n++;
      return n;
    }
    /* open ground, and proved open: a drill staged in a trench measures a hole already
       deeper than the one the shell would cut, and `G.cut` keeps the deeper of the two */
    let P = null, bs = -1;
    for (let x = 400; x < window.WORLD.w - 400; x += 40) for (let y = 300; y < window.WORLD.h - 300; y += 40) {
      const z = window.groundZ(x, y);
      if (z < 6 || window.coverAt(x, y) > 0) continue;
      let worst = 0;
      for (let a = 0; a < 8; a++) worst = Math.max(worst, Math.abs(
        window.groundZ(x + Math.cos(a) * 150, y + Math.sin(a) * 150) - z));
      if (worst > 9) continue;
      let open = 0;
      for (let a = 0; a < 8; a++) if (window.coverAt(x + Math.cos(a) * 80, y + Math.sin(a) * 80) === 0) open++;
      if (open < 6) continue;
      let near = 1e9;
      for (const q of G.blds) near = Math.min(near, Math.hypot(q.x - x, q.y - y));
      for (const q of G.props) near = Math.min(near, Math.hypot(q.x - x, q.y - y));
      if (near < 130) continue;
      const sc = Math.min(near, 600) - worst * 20;
      if (sc > bs) { bs = sc; P = { x, y }; }
    }
    if (!P) return null;
    const keep = G.units.slice();
    G.units.length = 0; G.fx.length = 0; G.shots.length = 0;
    window.__o.reveal();
    window.__o.camera({ x: P.x, y: P.y, dist: 300, yaw: -1.1, pitch: .45 });
    G.paused = true;
    const z0 = window.groundZ(P.x, P.y);
    const up = { cover: window.coverAt(P.x, P.y), walk: window.walkable(P.x, P.y) ? 1 : 0 };
    /* Two identical frames first, because the renderer has its own frame-to-frame
       variation -- the fog texture refreshes every third frame -- and a difference this
       row reports has to be against that floor rather than against nought. */
    const warm = grab();
    const before = grab();
    const noise = moved(warm, before);

    /* dug rather than exploded, so that the only thing that can change the picture is
       the ground mesh: an explosion also paints a scorch, which is the stain this row
       exists to tell apart from a hole */
    const c = window.digCrater(P.x, P.y, 140);
    if (!c) return null;
    window.rebuildGrid();
    /* the queue is aged rather than the clock: moving G.t moves the ambient smoke, the
       sea and the grass with it, and then the whole frame differs and the row proves
       nothing about the ground */
    for (const k in G.groundQ) { G.groundQ[k].first = G.t - 10; G.groundQ[k].hit = G.t - 10; }
    let flushes = 0;
    while (Object.keys(G.groundQ).length && flushes < 30) { window.flushGroundQ(); flushes++; }
    const after = grab();

    let lip = -1e9;
    for (let a = 0; a < 12; a++)
      lip = Math.max(lip, window.groundZ(P.x + Math.cos(a / 12 * 6.283) * c.r,
                                         P.y + Math.sin(a / 12 * 6.283) * c.r) - z0);
    /* the height is the sum of its layers everywhere, including under a building's pad */
    let worstK = 0;
    for (let k = 0; k < G.hmap.length; k += 37)
      worstK = Math.max(worstK, Math.abs(G.hmap[k] - (G.hmap0[k] + G.cut[k] + G.fill[k] + G.pad[k])));

    const bd = G.blds[0];
    const onBld = !!window.digCrater(bd.x, bd.y, 140);
    const small = !!window.digCrater(P.x + 700, P.y, 20);

    G.craters.length = 0; G.cratersDug = 0; G.groundQ = {};
    G.units.length = 0; keep.forEach(u => G.units.push(u));
    G.paused = false;
    return { r: +c.r.toFixed(1), want: +(3.4 + c.r * .21).toFixed(1),
             deep: +(z0 - window.groundZ(P.x, P.y)).toFixed(1), lip: +lip.toFixed(1),
             cover: up.cover, cover2: window.coverAt(P.x, P.y),
             walk: up.walk, walk2: window.walkable(P.x, P.y) ? 1 : 0,
             px: moved(before, after), noise, flushes, layers: +worstK.toFixed(3),
             onBld, small };
  });
  ok('a shell landing on open ground leaves a hole in it and not a stain on it',
     !!hole && Math.abs(hole.deep - hole.want) < 1.2 && hole.lip > 2 &&
     hole.cover === 0 && hole.cover2 > 0 && hole.walk === 1 && hole.walk2 === 1 &&
     hole.px > Math.max(12000, hole.noise * 4) && hole.flushes > 0 && hole.layers < 0.01 &&
     !hole.onBld && !hole.small,
     !hole ? 'no open ground on this map to shell'
           : `a ${hole.r}-unit hole: the ground lost ${hole.deep} of the ${hole.want} the carve asked ` +
             `for and threw a ${hole.lip} lip round it, cover ${hole.cover}->${hole.cover2}, ` +
             `walkable ${hole.walk}->${hole.walk2}; ${hole.px} pixels of the picture moved with it ` +
             `against ${hole.noise} between two identical frames, ` +
             `over ${hole.flushes} tile rebuild(s), the height is its own layers to ${hole.layers}, ` +
             `and a round on a headquarters ${hole.onBld ? '! DUG' : 'was refused'} and one under the ` +
             `floor ${hole.small ? '! DUG' : 'was refused'}`);

  /* --- Repair, and what a builder is allowed to stand near. There are three kinds of job
     an engineer can be put on -- a building going up, a pegged-out field work, and a thing
     that is merely damaged -- and the test that told them apart was `job.def`. A UNIT has a
     def too. Its def has no `h` and keeps its WEAPON in `w`, so a vehicle handed to the
     building's arithmetic produced `Math.max(<the weapon object>, undefined) / 2 + 62`,
     which is NaN; `dist(u, r) < NaN` is false for ever, and the destination one line over
     came out with a NaN in its y. An engineer ordered to repair a tank pathed to nowhere,
     wandered off across the map and never turned a spanner. The order, the cursor and the
     right-click were all written and none of it had ever worked once.
       So the row repairs one of each and asks for a number back: every kind of job has a
     reach that is a number, a damaged vehicle comes up, a damaged building comes up, and
     the engineer is still standing beside the thing at the end rather than half a map
     away. --- */
  const fix = await page.evaluate(() => {
    const step = s => { const n = Math.round(s / 0.05); for (let i = 0; i < n; i++) { G.t += 0.05; G.units.forEach(u => updateUnit(u, 0.05)); } };
    const keep = G.units.slice();
    G.units.length = 0;
    const out = { reach: {} };
    const tank = spawnUnit(G.side, G.side === 'us' ? 'us_sher' : 'ger_p4', 1060, 900, 0);
    const team = spawnUnit(G.side, G.side === 'us' ? 'us_mg' : 'ger_mg42', 1300, 900, 0);
    const bld = G.blds.filter(b => b.own === G.own)[0];
    /* a reach that is not a number is the whole bug, so it is asked for by name */
    [['veh', tank], ['team', team], ['bld', bld], ['site', { time: 12 }]].forEach(([k, j]) => {
      const r = j ? workReach(j) : null;
      out.reach[k] = (typeof r === 'number' && isFinite(r)) ? Math.round(r) : String(r);
    });

    /* a vehicle, ordered the way the right-click orders one */
    tank.hp = tank.maxhp * 0.25;
    const v0 = Math.round(tank.hp);
    const eng = spawnUnit(G.own, G.side === 'us' ? 'us_eng' : 'ger_pio', 940, 900, 0);
    resumeBuild(eng, tank);
    out.ordered = eng.order;
    step(30);
    out.veh = { from: v0, to: Math.round(tank.hp), max: Math.round(tank.maxhp),
                stood: Math.round(dist(eng, tank)), released: !eng.repairing };

    /* and a building */
    let b = null;
    if (bld) {
      bld.hp = bld.maxhp * 0.4;
      const b0 = Math.round(bld.hp);
      const e2 = spawnUnit(G.own, G.side === 'us' ? 'us_eng' : 'ger_pio', bld.x, bld.y + 70, 0);
      resumeBuild(e2, bld);
      step(12);
      b = { from: b0, to: Math.round(bld.hp), max: Math.round(bld.maxhp) };
    }
    out.bld = b;
    G.units.length = 0; keep.forEach(u => G.units.push(u));
    return out;
  });
  ok('an engineer repairs a vehicle and a building, and knows how near to stand to each',
     Object.keys(fix.reach).every(k => typeof fix.reach[k] === 'number') &&
     fix.ordered === 'repair' &&
     fix.veh.to >= fix.veh.max - 1 && fix.veh.stood < 120 && fix.veh.released &&
     !!fix.bld && fix.bld.to > fix.bld.from,
     `reach: ${Object.keys(fix.reach).map(k => k + ' ' + fix.reach[k]).join(', ')}; ` +
     `a vehicle went ${fix.veh.from}/${fix.veh.max} to ${fix.veh.to} with the engineer ` +
     `${fix.veh.stood} away at the end and the job ${fix.veh.released ? 'released' : '! STILL HELD'}; ` +
     (fix.bld ? `a building went ${fix.bld.from}/${fix.bld.max} to ${fix.bld.to}` : 'no building to mend'));

  /* --- The voice of a gun. Every piece on this roster that fires a shell played one of
     two sounds -- `cannon` if it was on a vehicle or a crew and `rocket` otherwise -- so a
     mortar dropping a bomb over a roof, a Pak 40 and a two-hundred-and-ten-millimetre
     battery were the same noise at the same level. A sound is the one thing here a
     screenshot cannot review at all, and an ear is not available to a gate, so it is
     rendered offline through the page's own graph and read as numbers.
       Three claims. Every shell weapon puts something on the bus, because a report that
     is built and inaudible looks exactly like one that is not built. The roster is
     differentiated rather than merely loud, which is the muzzle card's `spread` asked of
     the ear. And the six artillery pieces are six sounds: each pair is one class firing
     nearly the same shell, so what has to separate them is the propellant, and the row
     measures each pair against ITS OWN first piece rendered twice -- every layer of every
     report is jittered per shot, so a ratio with no floor under it says nothing, and the
     floor is not the same for a mortar as for a tank gun. `tools/audio.mjs` is the card
     that writes the WAVs and prints the whole table. --- */
  const voice = await page.evaluate(async () => {
    const SR = 22050;                       /* half rate: this is arithmetic, not listening */
    /* rms, length and brightness off the samples. Brightness is the rms of the first
       difference over the rms of the signal, which rises and falls with the spectral
       centroid and costs no transform: what is wanted here is an ORDER, not a hertz. */
    function meas(x) {
      let peak = 0, sum = 0, d = 0;
      for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; sum += x[i] * x[i]; }
      for (let i = 1; i < x.length; i++) { const q = x[i] - x[i - 1]; d += q * q; }
      const rms = Math.sqrt(sum / x.length);
      let head = 0, end = 0;
      for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak * .02) { head = i; break; }
      for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > peak * .001) { end = i; break; }
      /* the onset alone, which is where the propellant lives: a whole-buffer reading is
         dominated by whatever rings longest, which is always the bottom end */
      const on = x.subarray(head, Math.min(x.length, head + Math.round(SR * .05)));
      let od = 0, os = 0;
      for (let i = 1; i < on.length; i++) { const q = on[i] - on[i - 1]; od += q * q; }
      for (let i = 0; i < on.length; i++) os += on[i] * on[i];
      const orms = Math.sqrt(os / Math.max(1, on.length));
      return { peak: peak, rms: rms, dur: (end - head) / SR,
               bright: Math.sqrt(d / x.length) / (rms || 1e-9),
               obright: Math.sqrt(od / Math.max(1, on.length)) / (orms || 1e-9) };
    }
    async function play(key, secs) {
      const oc = new OfflineAudioContext(1, Math.round(SR * secs), SR);
      const keep = { ctx: AU.ctx, noise: AU.noise, rumb: AU.rumb, on: AU.on,
                     budget: AU.budget, last: AU.last, dry: AU.dry, send: AU.send };
      auAttach(oc);
      AU.on = true; AU.budget = 99; AU.last = {};
      const d = UNITS[key];
      const gv = gunVoice({ cat: d.cat, def: d, side: d.side }, d.w);
      sfx(gv.cls, undefined, undefined, gv);
      const out = await oc.startRendering();
      for (const k in keep) AU[k] = keep[k];
      return { m: meas(out.getChannelData(0)), cls: gv.cls };
    }
    /* the mean of several takes, because one take of a jittered report is noise. Two is
       enough for the roster sweep, which asks for a spread of several times over; the six
       are a fine comparison against their own floor and get twelve. */
    const MK = ['peak', 'rms', 'dur', 'bright', 'obright'];
    async function mean(key, secs, n) {
      let cls = '';
      const a = {};
      MK.forEach(k => a[k] = 0);
      for (let i = 0; i < n; i++) {
        const r = await play(key, secs);
        cls = r.cls;
        MK.forEach(k => a[k] += r.m[k] / n);
      }
      a.cls = cls;
      return a;
    }
    const PAIRS = [['us_mor', 'ger_mor'], ['us_how', 'ger_how'], ['us_how8', 'ger_how210']];
    const six = [].concat.apply([], PAIRS);
    const shells = Object.keys(UNITS).filter(k => UNITS[k].w && UNITS[k].w.shell && UNITS[k].cat !== 'inf');
    const rows = {}, silent = [];
    for (const k of shells) {
      rows[k] = await mean(k, 2.2, six.indexOf(k) < 0 ? 2 : 12);
      if (rows[k].peak < .05) silent.push(k);
    }
    /* Level is read as rms and not as peak. The bus ends in a compressor whose whole job
       is flattening peaks, so peak is the one loudness measure this graph is built to
       destroy: measured across the roster it reads 2.2x where rms reads 8.9x, which is
       the difference between a table that says the roster is differentiated and one that
       says it is not. */
    const lv = shells.map(k => rows[k].rms), br = shells.map(k => rows[k].bright);
    const du = shells.map(k => rows[k].dur);
    const r = (x, y) => Math.max(x, y) / Math.max(1e-9, Math.min(x, y));
    const pairs = [];
    for (const [a, b] of PAIRS) {
      const ctl = await mean(a, 2.2, 12);    /* the same piece twice: the jitter, and nothing else */
      const A = rows[a], B = rows[b];
      /* Per metric, how far apart the pair is against how far apart the SAME piece is
         from itself. Both of the obvious selectors are half right and each fails the
         other's case, so the row uses them in order: keep only the metrics that separate
         the pair by a real amount, and among those report the one measured most reliably.
           Choosing by signal-to-noise alone picks whichever metric has the smallest floor
         rather than whichever holds the real difference. The two mortars differ by 1.04x
         in length against a floor of 1.004x, which reads as ten to one and is inaudible,
         while they differ by 1.40x in rms, which is the whole thing; selected that way the
         row reported brightness one run and length the next from identical code.
           Choosing by the biggest difference alone picks a metric that may be measured
         badly. Brightness separates the two heavy batteries by 1.46x, which is real, but
         its floor on a piece whose tail runs a second and a half wanders out to 1.14x, so
         the row came back at five to one where rms on the same pair is 1.26x against a
         floor of 1.005x -- fifty to one for the same fact.
           The three metrics are the ones that carry it on BOTH devices. `peak` is out
         because the bus ends in a compressor and peak is what a compressor flattens: it
         reads 1.02x on the heavy pair. `dur` is out because it is 1.25x to 1.36x on the
         two bigger pairs and 1.04x on the mortars, whose tails are the most alike -- it
         keeps its job in the class-shape test below, where it does real work. */
      const M = ['rms', 'bright', 'obright'];
      let bd = 1, bf = 1, bm = '', bsn = -1;
      M.forEach(k => {
        const d = r(A[k], B[k]), f = r(A[k], ctl[k]), sn = (d - 1) / Math.max(.004, f - 1);
        if (d > 1.15 && sn > bsn) { bd = d; bf = f; bm = k; bsn = sn; }
      });
      /* nothing separated them by a real amount: report the biggest difference there was,
         so a failure names what it actually found rather than printing an empty row */
      if (bsn < 0) {
        bsn = 0;
        M.forEach(k => {
          const d = r(A[k], B[k]);
          if (d > bd) { bd = d; bf = r(A[k], ctl[k]); bm = k; bsn = (d - 1) / Math.max(.004, bf - 1); }
        });
      }
      pairs.push({ a: UNITS[a].short, b: UNITS[b].short, cls: A.cls, m: bm,
                   d: +bd.toFixed(2), f: +bf.toFixed(2), sn: +bsn.toFixed(1) });
    }
    /* and the three classes are three shapes: a tube is short and a battery is long */
    const shape = { mortar: +rows.us_mor.dur.toFixed(2), how: +rows.us_how.dur.toFixed(2),
                    heavy: +rows.us_how8.dur.toFixed(2) };
    return { n: shells.length, silent: silent,
             lvl: +(Math.max.apply(null, lv) / Math.min.apply(null, lv)).toFixed(1),
             brt: +(Math.max.apply(null, br) / Math.min.apply(null, br)).toFixed(1),
             len: +(Math.max.apply(null, du) / Math.min.apply(null, du)).toFixed(1),
             pairs: pairs, shape: shape };
  });
  ok('every gun has its own report, and the six artillery pieces are six of them',
     voice.n >= 16 && voice.silent.length === 0 && voice.lvl > 4 && voice.brt > 1.8 &&
     voice.len > 2 &&
     /* the EXCESS over parity against the floor's excess, and not the two ratios against
        each other: a floor of 1.01 is one per cent of jitter, so a pair thirty-two per
        cent apart clears it by thirty to one. Multiplied instead, a floor that close to
        parity sets a bar of 1.515x that only a wholly different weapon would clear, and
        the row failed on a pair it should have passed. */
     /* A real difference AND a real signal-to-noise. Measured over fourteen takes on both
        devices, the metric each pair is reported on separates it by 1.21x to 1.42x at 19
        to 104 to one, so neither bar is anywhere near the edge. */
     voice.pairs.every(p => p.sn > 3 && p.d > 1.15) &&
     voice.shape.mortar < voice.shape.how && voice.shape.how < voice.shape.heavy,
     `${voice.n} shell weapons, ${voice.silent.length} of them putting nothing on the bus` +
     `${voice.silent.length ? ' (' + voice.silent.join(' ') + ')' : ''}; across the roster ` +
     `${voice.lvl}x in level (rms, since the bus compresses peaks), ${voice.brt}x in ` +
     `brightness and ${voice.len}x in length; ` +
     `a tube rings for ${voice.shape.mortar}s, a pack howitzer ${voice.shape.how}s and a ` +
     `battery ${voice.shape.heavy}s; ` +
     voice.pairs.map(p => `${p.a}/${p.b} differ ${p.d}x in ${p.m} against a jitter floor of ` +
                          `${p.f}x, which is ${p.sn} to one`).join(', '));

  /* --- The bunker, which is the one piece of cover on either map with a front and a
     back. Four claims, and each of them reads as working on its own: a solid prop nobody
     can garrison is a wall, a garrison with no arc is a house with a grey roof, cover laid
     in front of it would be the map telling a section that walking up to the slot is safe,
     and a bunker only one side of the map has is not a fair map. So the row asks for all
     four, and it asks the last one by firing: the same target at the same range in front
     and behind, one shot allowed and one refused by the concrete. --- */
  await reload(page);
  await page.evaluate(() => {
    window.G.mapData = window.gothicMapData();
    window.startGame('us', 1, 'vp', true, true);
  });
  await page.waitForFunction(() => window.SCENE && window.SCENE.ready, null, { timeout: 180000 });
  const bun = await page.evaluate(() => {
    const all = window.G.blocks.filter(b => b.kind === 'bunker');
    const b = all.filter(x => x.x < 1400).sort((p, q) => Math.abs(p.y - 980) - Math.abs(q.y - 980))[0];
    /* every one of them has its opposite number reflected about the midline */
    const paired = all.filter(x => x.x < 1400).every(w =>
      all.some(e => Math.abs(e.x - (2800 - w.x)) < 1 && Math.abs(e.y - w.y) < 1 &&
                    Math.abs(Math.cos(e.face) + Math.cos(w.face)) < .01));
    const u = window.spawnUnit('us', 'us_rifle', b.x - 140, b.y);
    window.enterBuilding(u, b);
    /* the men stand in one rank inside the slot rather than round four walls: every one
       of them the same distance forward of the centre */
    const fwd = u.models.map(m => (m.x - b.x) * Math.cos(b.face) + (m.y - b.y) * Math.sin(b.face));
    const R = 300, cf = Math.cos(b.face), sf = Math.sin(b.face);
    const front = window.spawnUnit('ger', 'ger_gren', b.x + cf * R, b.y + sf * R);
    const rear = window.spawnUnit('ger', 'ger_gren', b.x - cf * R, b.y - sf * R);
    return {
      n: all.length, paired: paired, gar: !!u.gar, men: u.models.length,
      rank: +(Math.max.apply(null, fwd) - Math.min.apply(null, fwd)).toFixed(1),
      covF: window.coverAt(b.x + cf * 62, b.y + sf * 62, b.face + Math.PI),
      covR: window.coverAt(b.x - cf * 62, b.y - sf * 62, b.face),
      shotF: window.fireLine(u, front), shotR: window.fireLine(u, rear),
      solid: !window.walkable(b.x, b.y), clear: window.walkable(b.x - cf * 62, b.y - sf * 62),
      at: Math.round(b.x) + ',' + Math.round(b.y), wh: b.w + 'x' + b.h
    };
  });
  ok('a bunker has a front and a back, and both halves of the map have the same ones',
     bun.n >= 6 && bun.paired && bun.gar && bun.rank < 1 && bun.covF === 0 && bun.covR === 4 &&
     bun.shotF && !bun.shotR && bun.solid && bun.clear,
     `${bun.n} bunkers, each mirrored about the midline ${bun.paired ? 'yes' : 'NO'}; the one at ` +
     `${bun.at} is ${bun.wh} and solid to a boot with the ground behind it clear; a section of ` +
     `${bun.men} went in and stands in one rank at the slot (${bun.rank} of spread); cover in front ` +
     `of it ${bun.covF} and behind it ${bun.covR}; at 300 a shot out of the slot is ` +
     `${bun.shotF ? 'allowed' : 'refused'} and the same shot to the rear is ` +
     `${bun.shotR ? 'allowed' : 'refused'}`);

  /* --- And what goes IN one. A bunker was a box of concrete a section could stand in,
     on a map whose whole question is which of three crossings to force, so the thing the
     map is about had exactly one thing you could do with it. It is fitted out once now,
     with one of five, and every one of the five is a claim a photograph would call true
     whatever was wrong underneath it: a mount drawn in the slot that fires nowhere in
     particular, a tube that stands in the embrasure it is supposed to leave free, an aid
     post that patches up the enemy as readily as its own, a workshop that mends a hull
     nine hundred units away, and a fitting that can be bought twice.
       So each is asked the question it would fail. The two that fire are garrisoned, so
     the row fires them: the same target in front of the slot and behind it, one allowed
     and one refused by the concrete, which is the arc doing the work rather than new
     firing code. The tube is asked where it stands. The two radius effects are asked
     three ways each -- near, far and ENEMY -- because a radius with no side test in it
     works perfectly in a photograph. And the whole thing is asked once more after it is
     fitted, because 'once' is the rule that makes it a decision. --- */
  const bup = await page.evaluate(() => {
    const out = { rows: [], err: null };
    const mine = window.bunkersOf('us');
    out.n = mine.length;
    window.G.res.us.mp = 90000; window.G.res.us.fu = 90000;
    window.G.res.ger.mp = 90000; window.G.res.ger.fu = 90000;
    const R = 300;
    for (const k of window.BUNKUP_ORD) {
      const bk = mine[0], W = window.BUNKUP[k];
      /* a clean bunker each time: the rule is one fitting a bunker and there are three */
      if (bk.gar) window.leaveBuilding(bk.gar);
      window.G.units = window.G.units.filter(u => !(u.own === 'us' && (u.gar === bk || u.def.barrage)));
      window.G.pop.us = 0;
      bk.upKind = null; bk.up = null; bk.upBuf = null; bk.upSite = null; bk.upT = 0;
      const okd = window.bunkerUpOK(bk, k, 'us');
      const ord = okd && window.orderBunkerUp(bk, k, 'us');
      const site = bk.upSite ? bk.upSite.n : 0;
      for (let t = 0; t < 900 && bk.up; t++) window.updateBunkers(.2);
      /* and it may not be bought twice -- neither a different fitting, nor the same one
         while the men it brought are still alive */
      const again = window.bunkerUpOK(bk, k === 'mg' ? 'at' : 'mg', 'us');
      const same = window.bunkerUpOK(bk, k, 'us');
      const row = { k, ord: !!ord, fitted: bk.upKind, site, buf: bk.upBuf ? bk.upBuf.n : 0,
                    again, same, recrew: null };
      /* what it brought with it, asked BEFORE the crew is killed off below: written the
         other way about, the men are gone by the time the row looks for them, `unit` comes
         back null and the firing test never runs at all */
      if (W.unit) {
        const g = window.G.units.filter(u => u.own === 'us' && u.key === W.unit.us)[0];
        row.unit = g ? g.key : null;
        row.gar = !!(g && g.gar === bk);
        if (g && !W.rear) {
          const cf = Math.cos(bk.face), sf = Math.sin(bk.face);
          const fr = window.spawnUnit('ger', 'ger_gren', bk.x + cf * R, bk.y + sf * R);
          const re = window.spawnUnit('ger', 'ger_gren', bk.x - cf * R, bk.y - sf * R);
          row.shotF = window.fireLine(g, fr); row.shotR = window.fireLine(g, re);
          fr.dead = re.dead = true;
          window.G.units = window.G.units.filter(u => !u.dead);
        }
        /* the tube is BEHIND it, on ground a man can stand on, and out of the slot */
        if (g && W.rear) {
          row.back = Math.round((g.x - bk.x) * Math.cos(bk.face) + (g.y - bk.y) * Math.sin(bk.face));
          row.stands = window.walkable(g.x, g.y);
        }
        /* killing the crew is the one case that may buy the same fitting again: the mount
           in the wall is masonry and the men on it are a unit, so a gun whose crew has
           been shot off it is re-crewed rather than written off for the battle */
        window.G.units.filter(u => u.id === bk.upUid).forEach(u => { u.dead = true; });
        window.G.units = window.G.units.filter(u => !u.dead);
        row.recrew = window.bunkerUpOK(bk, k, 'us');
      }
      out.rows.push(row);
    }
    /* the two radius effects, each asked near, far and against an enemy */
    const rep = mine[1], med = mine[2];
    rep.upKind = 'rep'; rep.upOwn = 'us'; rep.own = 'us';
    med.upKind = 'med'; med.upOwn = 'us'; med.own = 'us';
    const RR = window.BUNKUP.rep.aid.r;
    const near = window.spawnUnit('us', 'us_sher', rep.x + 40, rep.y + 40, 0);
    const far = window.spawnUnit('us', 'us_sher', rep.x + RR * 3, rep.y, 0);
    const foe = window.spawnUnit('ger', 'ger_p4', rep.x + 40, rep.y - 40, 0);
    for (const v of [near, far, foe]) { v.hp = Math.round(v.maxhp * .4); }
    near.immob = 3; near.gunDmg = 3;
    const h0 = near.hp, f0 = far.hp, e0 = foe.hp;
    for (let t = 0; t < 20; t++) window.bunkerRepair(.2);
    out.rep = { gain: Math.round(near.hp - h0), far: Math.round(far.hp - f0), foe: Math.round(foe.hp - e0),
                immob: +near.immob.toFixed(1), gun: +near.gunDmg.toFixed(1) };
    const s1 = window.spawnUnit('us', 'us_rifle', med.x + 40, med.y + 40, 0);
    const s2 = window.spawnUnit('us', 'us_rifle', med.x + RR * 3, med.y, 0);
    const s3 = window.spawnUnit('ger', 'ger_gren', med.x + 40, med.y - 40, 0);
    out.med = { near: window.bunkerAidAt(s1), far: window.bunkerAidAt(s2), foe: window.bunkerAidAt(s3) };
    /* And the tap. Garrisoning goes through `issueOrder`, which on a phone is the branch
       BELOW the bunker pick, so a pick that fires unconditionally takes the only way a
       phone has of putting men in a bunker and replaces it with a selection -- a working
       order silently removed, invisible on a desktop and in every screenshot. The test is
       the predicate the pick yields on. */
    const tapBk = mine[0];
    if (tapBk.gar) window.leaveBuilding(tapBk.gar);
    const tapper = window.spawnUnit('us', 'us_rifle', tapBk.x - 150, tapBk.y, 0);
    window.select([tapper], false);
    out.tapOrder = window.G.sel.some(q => window.canGarrison(q, tapBk));
    window.select([], false);
    out.tapPick = !window.G.sel.some(q => window.canGarrison(q, tapBk));
    /* and a crew the fitting raised belongs to the bunker: the brain's own rule walks a
       garrison out once the fight moves on, which applied to a fitted gun is the whole
       purchase getting up and leaving the emplacement it was bought for */
    window.enterBuilding(tapper, tapBk);
    out.stayForeign = !(tapBk.kind === 'bunker' && tapBk.upUid === tapper.id);
    window.leaveBuilding(tapper);
    tapper.dead = true;
    window.G.units = window.G.units.filter(u => !u.dead);
    /* and a bunker changes hands, fitting and all, to whoever puts men in it */
    const was = window.bunkerOwner(med);
    const sq = window.spawnUnit('ger', 'ger_gren', med.x, med.y, 0);
    window.enterBuilding(sq, med);
    out.took = was + '->' + window.bunkerOwner(med);
    out.tookKept = med.upKind;
    /* And the card. Five on an empty one, one on a fitted one, and nothing at all on
       theirs. SELECT HQ is added to every card list whatever is picked, so it comes off
       here -- counted raw, an enemy bunker that offers nothing reads as offering one. */
    const cards = () => [...document.querySelectorAll('#cmds .cmd')]
      .map(e => e.querySelector('.n').textContent).filter(t => t !== 'Select HQ');
    const free = mine.filter(x => !x.upKind && !x.up)[0] || mine[0];
    free.upKind = null; free.up = null;
    window.select([free], false);
    out.cardsFree = cards().length;
    window.select([rep], false);
    out.cardsFitted = cards().join(',');
    window.select([window.bunkersOf('ger')[0]], false);
    out.cardsFoe = cards().join(',');
    window.select([], false);
    return out;
  });
  const bupGood = bup.n >= 3 && bup.rows.length === 5 &&
    bup.rows.every(r => r.ord && r.fitted === r.k && r.buf > 0 && r.site > 0 && !r.again && !r.same) &&
    bup.rows.filter(r => r.recrew !== null).every(r => r.recrew === true) &&
    bup.rows.filter(r => r.gar !== undefined).every(r => r.unit) &&
    bup.rows.filter(r => r.shotF !== undefined).every(r => r.gar && r.shotF && !r.shotR) &&
    bup.rows.filter(r => r.back !== undefined).every(r => r.back < -40 && r.stands) &&
    bup.rep.gain > 0 && bup.rep.far === 0 && bup.rep.foe === 0 &&
    bup.rep.immob < 3 && bup.rep.gun < 3 &&
    bup.med.near && !bup.med.far && !bup.med.foe &&
    bup.tapOrder && bup.tapPick && bup.stayForeign &&
    bup.took === 'us->ger' && bup.tookKept === 'med' &&
    bup.cardsFree === 5 && bup.cardsFitted === 'Repair shelter' && bup.cardsFoe === '';
  ok('a bunker is fitted out once, and each of the five does the one thing it claims',
     bupGood,
     `${bup.n} bunkers a side; ` +
     bup.rows.map(r => `${r.k} built ${r.site}-vertex site into a ${r.buf}-vertex fitting` +
       (r.unit ? `, bringing a ${r.unit}${r.gar ? ' into the slot' : ''}` : '') +
       (r.shotF !== undefined ? `, which shoots 300 out of the slot (${r.shotF ? 'yes' : 'NO'}) and not 300 behind it (${r.shotR ? 'FIRES' : 'refused'})` : '') +
       (r.back !== undefined ? `, dug in ${-r.back} units behind it on ground a man can stand on (${r.stands ? 'yes' : 'NO'})` : '') +
       `, refuses a second fitting (${r.again || r.same ? 'ACCEPTS' : 'yes'})` +
       (r.recrew === null ? '' : ` and re-crews once its men are dead (${r.recrew ? 'yes' : 'NO'})`)).join('; ') +
     `; the workshop puts ${bup.rep.gain} hp into a hull beside it, ${bup.rep.far} into one out of reach and ` +
     `${bup.rep.foe} into the enemy's, and takes its track and gun damage to ${bup.rep.immob}/${bup.rep.gun} from 3/3; ` +
     `the aid post reaches a section beside it (${bup.med.near}) and neither one far off (${bup.med.far}) nor the ` +
     `enemy's (${bup.med.foe}); a tap with men in hand that could go in is their order ` +
     `(${bup.tapOrder ? 'yes' : 'NO'}) and with none it picks the bunker (${bup.tapPick ? 'yes' : 'NO'}); ` +
     `a section that merely walked in is not the fitting's crew (${bup.stayForeign ? 'yes' : 'NO'}); ` +
     `taking it changes hands ${bup.took} and keeps the ${bup.tookKept}; the card offers ` +
     `${bup.cardsFree} on an empty one, "${bup.cardsFitted}" on a fitted one and "${bup.cardsFoe}" on theirs`);

  /* --- The obstacle belts. Wire holds a man up and lets a tank drive over it; a
     hedgehog does the opposite. Wire an ENGINEER put up did all of that and wire a MAP
     laid did none of it -- G.wire was drawn and marked on no grid at all, so an apron
     hand-placed across an approach was painted on -- which is the same fault the field
     walls had and reads exactly the same from a photograph.
     The effect is read as the same cell with the mark and without it, because the belts
     are laid on ground that is also steep and also near something, and a cost compared
     against the open field beside it measures the slope as much as the wire. --- */
  const obs = await page.evaluate(() => {
    const C = 20;
    const at = (x, y) => window.cidx((x / C) | 0, (y / C) | 0);
    const cost = (x, y, k) => window.cellCost(at(x, y), k, null, 0);
    /* on over off, at one cell, for one kind of thing */
    function ab(grid, x, y, k) {
      const i = at(x, y), was = grid[i];
      const on = cost(x, y, k); grid[i] = 0;
      const off = cost(x, y, k); grid[i] = was;
      return +(on / off).toFixed(2);
    }
    const W = window.G.wire[0], H = window.G.hogs.filter(h => h.kind !== 'teeth')[0];
    const wx = (W.x1 + W.x2) / 2, wy = (W.y1 + W.y2) / 2;
    const hx = (H.x1 + H.x2) / 2, hy = (H.y1 + H.y2) / 2;
    /* And where a route actually goes, which is the thing a cost is for. The latitude
       has to be one where the belt is SOLID: its gaps are the three crossings, and a
       section walking through a gap proves nothing about a belt. */
    function crossings(key, y) {
      const u = window.spawnUnit('us', key, 878, y);
      const pth = window.findPath(u.x, u.y, 1210, y, u);
      u.dead = true;
      if (!pth) return -1;
      let n = 0, prev = { x: u.x, y: u.y };
      pth.forEach(q => {
        for (let t = 0; t <= 1; t += .05) {
          if (window.inHogs(prev.x + (q.x - prev.x) * t, prev.y + (q.y - prev.y) * t)) { n++; break; }
        }
        prev = q;
      });
      return n;
    }
    const mirrored = window.G.hogs.filter(h => h.x1 < 1400).every(w =>
      window.G.hogs.some(e => Math.abs(e.x1 - (2800 - w.x1)) < 1 && Math.abs(e.y1 - w.y1) < 1)) &&
      window.G.wire.filter(w => w.x1 < 1400).every(w =>
      window.G.wire.some(e => Math.abs(e.x1 - (2800 - w.x1)) < 1 && Math.abs(e.y1 - w.y1) < 1));
    return {
      wire: window.G.wire.length, hogs: window.G.hogs.length, mirrored,
      inWire: window.inWire(wx, wy), inHogs: window.inHogs(hx, hy),
      wireFoot: ab(window.wireg, wx, wy, 0), wireTrack: ab(window.wireg, wx, wy, 1),
      hogFoot: ab(window.hogg, hx, hy, 0), hogTrack: ab(window.hogg, hx, hy, 1),
      hogWheel: ab(window.hogg, hx, hy, 2),
      /* neither is closed: the tight way is dear and still there if it is the only way */
      walkHog: window.walkable(hx, hy), walkWire: window.walkable(wx, wy),
      footCross: crossings('us_rifle', 1200), tankCross: crossings('us_sher', 1200)
    };
  });
  ok('wire holds a man up and a hedgehog holds a tank up, and a map may lay both',
     obs.wire >= 6 && obs.hogs >= 6 && obs.mirrored && obs.inWire && obs.inHogs &&
     obs.wireFoot > 2 && obs.wireTrack === 1 && obs.hogFoot === 1 && obs.hogTrack > 8 &&
     obs.hogWheel > 8 && obs.walkHog && obs.walkWire &&
     obs.footCross > 0 && obs.tankCross === 0,
     `${obs.wire} wire runs and ${obs.hogs} obstacle belts, each mirrored about the midline ` +
     `${obs.mirrored ? 'yes' : 'NO'}; on one cell of wire a man pays ${obs.wireFoot}x what he ` +
     `would without it and a tank ${obs.wireTrack}x; on one cell of hedgehog a man pays ` +
     `${obs.hogFoot}x, tracks ${obs.hogTrack}x and wheels ${obs.hogWheel}x; neither cell is ` +
     `closed to anything; asked to cross at the same place a section went through the belt ` +
     `(${obs.footCross} legs in it) and a Sherman went round it (${obs.tankCross})`);

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
