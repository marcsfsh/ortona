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
  /* on classic whatever the device would pick, because the simple scheme's adjutant spends
     the till and sites a post from the first frame and half the rows below read a pristine
     deploy; the simple rows switch it on where they measure it */
  /* --file runs the gate on a copy, so the working file can go on being edited while it runs:
     every reload below reads the file again from disk */
  const { page, context, log, gl } = await openGame(browser, device, { quiet: true, ctrl: 'classic', ...(args.file ? { file: path.resolve(args.file) } : {}) });

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
     is a control that is not there. The panels live under the standing orders, which
     fold up, so the fold is opened first and put back after. */
  const startTap = await page.evaluate(() => {
    const fold = document.getElementById('morders'), shut = fold && !fold.classList.contains('open');
    if (shut) document.getElementById('moret').click();
    document.getElementById('hopen').click(); document.getElementById('aopen').click();
    const small = [...document.querySelectorAll('#start button')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); })
      .map(e => (e.id || e.className) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' +
                Math.round(e.getBoundingClientRect().height));
    const n = document.querySelectorAll('#start button').length;
    const hScroll = document.documentElement.scrollWidth - window.innerWidth;
    document.getElementById('hopen').click(); document.getElementById('aopen').click();
    if (shut) document.getElementById('moret').click();
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
    if (!M.dead || !M.dead.usa) return { table: false };
    const bufs = new Set([].concat(M.dead.usa || [], M.dead.heer || [], M.fall.usa || [], M.fall.heer || []));
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
    const lay = (x, y) => { for (let i = 0; i < 200; i++) window.G.corpses.push({ x, y, a: 0, t: 1, side: 'us', nat: 'usa', k: i & 1 }); };
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
    /* under the simple scheme the strip and the flag's popup are measured with the rest */
    const simple = document.body.classList.contains('simple');
    for (const sel of ['#tools .tool', '#cmds .cmd', '#bar button', '#queue .qi', '#simple button']) {
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        seen.push(sel);
        if (r.width < minTap || r.height < minTap) small.push(`${sel} ${r.width | 0}x${r.height | 0}`);
      }
    }
    /* the bar, or under simple the strip that stands where it stood */
    const bar = (simple ? document.getElementById('tbuild') : document.getElementById('bar')).getBoundingClientRect();
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

  /* --- the simple scheme. A second set of controls kept beside the classic one: a phone
     starts on it and a desktop does not, and either may pick the other. Under it the
     player builds and the brain fights, so what is measured is the strip he builds from,
     the brain running his slot without his money, and the flags he steers it by. Every
     row runs on both devices, because the touch handlers are one piece of code whatever
     the pointer is, and each switches the scheme without storing it. The gestures are
     driven through the same TouchEvents a finger raises, dispatched at the canvas, rather
     than by calling the functions behind them: a handler that is never reached by the
     event it is written for is a handler that is not there. The rest of the gate then
     runs on classic, because a brain giving the player's army orders under rows that
     read where his units are is a gate measuring the brain. --- */
  const ctrl0 = await page.evaluate(() => {
    /* the page was opened pinned to classic; the default is what ctrlLoad decides with
       nothing stored, so it is asked that way and the pin put back */
    localStorage.removeItem('ORT_CTRL'); window.ctrlLoad();
    const d = window.CTRL.simple;
    localStorage.setItem('ORT_CTRL', 'classic'); window.ctrlLoad(); window.ctrlApply();
    return { simple: d, pinned: !window.CTRL.simple };
  });
  ok('the control scheme starts on simple on a phone and classic on a desktop, with nothing stored',
     ctrl0.simple === !!DEVICES[device].hasTouch && ctrl0.pinned, `simple=${ctrl0.simple} with nothing stored`);
  /* what the player had before the scheme, and the brain that comes with it, was switched on */
  const pre = await page.evaluate(() => {
    const own = window.G.own, him = window.foe(window.G.side);
    window.__preIds = window.G.units.filter(u => window.owned(u)).map(u => u.id);
    window.__preBld = window.G.blds.filter(b => window.owned(b)).map(b => b.id);
    /* the battle is three minutes old and the player's points are most of the way down,
       so both sides are topped up before another minute is run: a game that ends inside
       the minute stops the brain with everything else */
    window.vpSet('us', 9000); window.vpSet('ger', 9000);
    return { made: Object.keys(window.G.made[own]).length, blds: window.G.blds.filter(b => window.owned(b)).length,
             foeMade: Object.keys(window.G.made[him]).length, mp: Math.round(window.G.res[own].mp), brains: Object.keys(window.AIP).sort().join(',') };
  });
  await page.evaluate(() => {
    window.ctrlSet(true, true); window.select([], false);
    const hq = window.hqOf(window.G.own);
    window.__o.camera({ x: hq.x, y: hq.y, dist: 560, pitch: 0.95 });
  });
  await frames(page, 1);
  const th = await page.evaluate(minTap => {
    const vw = innerWidth, vh = innerHeight, inside = r => r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1;
    const rects = sel => [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
    const strip = rects('#tbuild .tb'), mini = document.getElementById('mini').getBoundingClientRect(), line = document.getElementById('tsel').getBoundingClientRect();
    const small = strip.filter(r => r.width < minTap || r.height < minTap).length;
    const off = [...strip, mini, line].filter(r => !inside(r)).length;
    /* and nothing of the chrome lies over anything else of it, the tool strip and the
       resource strip included */
    const all = [...strip, mini, line, ...rects('#tools .tool'), document.getElementById('top').getBoundingClientRect()];
    let overlap = 0;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++;
    }
    /* the strip is the post he has not got and every unit his finished buildings make */
    const want = window.simpleItems().map(it => it.key).join(',');
    const have = [...document.querySelectorAll('#tbuild .tb')].map(e => e.dataset.key).join(',');
    return { on: document.body.classList.contains('simple'), bar: getComputedStyle(document.getElementById('bar')).display,
             strip: strip.length, want, have, post: (document.querySelector('#tbuild .tb.post') || {}).dataset,
             tools: [...document.querySelectorAll('#tools .tool')].filter(e => e.getBoundingClientRect().width).map(e => e.id).join('+'),
             small, off, overlap, miniIn: document.getElementById('mini').parentNode.id,
             flag: document.getElementById('tord').classList.contains('hidden') &&
                   document.getElementById('tlist').classList.contains('hidden'),
             hScroll: document.documentElement.scrollWidth - vw, vScroll: document.documentElement.scrollHeight - vh,
             label: document.getElementById('tselname').textContent.trim() };
  }, MIN_TAP);
  ok('simple: a strip of what he can build, a line saying what the army is doing, LOOK and PAUSE, the little map, the bar gone, nothing small, off screen or overlapping',
     th.on && th.bar === 'none' && th.strip >= 3 && th.want === th.have && th.tools === 'tOrders+tPov+tPause' && th.small === 0 && th.off === 0 &&
     th.overlap === 0 && th.miniIn === 'simple' && th.flag && th.hScroll <= 0 && th.vScroll <= 0 && th.label.length > 0,
     `${th.strip} buttons (${th.have}), tools ${th.tools}, ${th.small} small, ${th.off} off screen, ${th.overlap} overlapping, map in #${th.miniIn}, line "${th.label}"`);

  /* --- the brain on his slot: it thinks at veteran, deals every fighting unit a job and
     orders it, and never spends a mark of his. Driven the way the frame loop drives it,
     for a minute, and read off the field. On fresh sections, because the three minutes
     of battle above are fought with nobody running his army and what is left of it by
     now is sometimes nothing at all. --- */
  await page.evaluate(() => {
    const own = window.G.own, us = window.G.side === 'us', hq = window.hqOf(own);
    for (let i = 0; i < 4; i++) {
      const sp = window.nearestFree(hq.x + (us ? 200 : -200) + i * 50, hq.y - 100 + i * 70);
      window.spawnUnit(own, us ? 'am_rifle' : 'hr_gren', sp.x, sp.y, 0);
    }
  });
  await fastForward(page, 60);
  const brain = await page.evaluate(() => {
    const own = window.G.own, him = window.foe(window.G.side), P = window.AIP[own];
    const mine = window.G.units.filter(u => window.owned(u) && !u.dead && u.cat && !u.inside);
    const fighters = mine.filter(u => !u.def.builder);
    return { plan: !!P && P.own === own, skill: window.aiDiffOf(own).skill, runs: window.aiRuns(window.slotOf(own)), buys: window.aiBuys(own),
             n: fighters.length, jobs: fighters.filter(u => u.job || u.op).length, ordered: mine.filter(u => u.order).length,
             made: Object.keys(window.G.made[own]).length, blds: window.G.blds.filter(b => window.owned(b)).length,
             foeMade: Object.keys(window.G.made[him]).length, foeBuys: window.aiBuys(him),
             status: document.getElementById('tselname').textContent, mood: P && P.mood,
             fired: ['opening', 'stand', 'wave.form'].filter(k => window.AIR.fired[k] > 0).join('+') };
  });
  ok('simple: the brain runs his slot at veteran, deals every section a job and orders it, and buys nothing out of his till',
     brain.plan && brain.skill === 2 && brain.runs && !brain.buys && brain.n > 0 && brain.jobs === brain.n && brain.ordered > 0 &&
     brain.made === pre.made && brain.blds === pre.blds && brain.foeBuys && brain.foeMade >= 1 && brain.status.length > 0,
     `plan ${brain.plan} at skill ${brain.skill}; ${brain.jobs} of ${brain.n} fighters with a job, ${brain.ordered} under orders; ` +
     `raised ${brain.made} kinds against ${pre.made} before and ${brain.blds} buildings against ${pre.blds}, the opposition ${brain.foeMade}; ` +
     `line "${brain.status}", mood ${brain.mood}, fired ${brain.fired}`);

  /* a finger on the canvas, installed before the first row that needs one: the strip's
     emplacement is sited by the player's own tap now, so the helper cannot wait until the
     flag rows further down */
  await page.evaluate(() => {
    const cv = document.getElementById('cv');
    window.__tev = function (type, x, y) {
      const r = cv.getBoundingClientRect();
      const t = new Touch({ identifier: 1, target: cv, clientX: r.left + x, clientY: r.top + y, pageX: r.left + x, pageY: r.top + y });
      const up = type === 'touchend';
      cv.dispatchEvent(new TouchEvent(type, { touches: up ? [] : [t], changedTouches: [t], targetTouches: up ? [] : [t], bubbles: true, cancelable: true }));
    };
  });

  /* --- the strip: a tap builds. The post goes down beside the headquarters with an
     engineer on it, a section goes into the headquarters' queue, and a thing he cannot
     pay for is dimmed and refused. --- */
  const strip = await page.evaluate(() => {
    const own = window.G.own, us = window.G.side === 'us', hq = window.hqOf(own);
    const K1 = us ? 'us_bar' : 'ger_qtr', secKey = us ? 'am_rifle' : 'hr_gren';
    /* on a fresh engineer, because after four minutes of a battle nobody is running the
       one he started with is whatever the battle left of it */
    const esp = window.nearestFree(hq.x + (us ? 150 : -150), hq.y - 60);
    window.spawnUnit(own, us ? 'am_eng' : 'hr_pio', esp.x, esp.y, 0);
    const mp0 = Math.round(window.G.res[own].mp);
    const postBtn = document.querySelector('#tbuild .tb.post');
    if (postBtn) postBtn.click();
    const site = window.siteOf(own, K1);
    const onIt = window.G.units.some(u => window.owned(u) && !u.dead && u.def.builder && u.building === site);
    const mp1 = Math.round(window.G.res[own].mp);
    /* four minutes into a battle the till after the post is whatever that battle left in
       it, so it is topped up to what a section costs, and what the tap met is written down */
    const secDef = window.UNITS[secKey];
    window.G.res[own].mp = Math.max(window.G.res[own].mp, secDef.cost.mp + 50); window.simpleSync();
    const mp1b = Math.round(window.G.res[own].mp), pop1 = window.popOf(own) + '+' + secDef.pop + '/' + window.popCap(own);
    const secBtn = document.querySelector(`#tbuild .tb[data-key="${secKey}"]`);
    const q0 = hq.queue.length;
    if (secBtn) secBtn.click();
    const queued = hq.queue.length - q0, mp2 = Math.round(window.G.res[own].mp);
    /* and with the till empty the same button is dimmed and does nothing */
    const keep = window.G.res[own].mp; window.G.res[own].mp = 0; window.simpleSync();
    const poor = secBtn && secBtn.classList.contains('poor');
    if (secBtn) secBtn.click();
    const refused = hq.queue.length === q0 + queued;
    window.G.res[own].mp = keep; window.simpleSync();
    /* and the emplacement, which the PLAYER sites: the button arms the placement and the
       next tap on the ground is where the gun goes, so the row taps the button, reads
       that it is armed and lit, then taps a piece of ground forward of home. A second is
       refused by the limit and the button says so. Put back afterwards, because the rows
       below count his men and his sites. */
    const wk = us ? 'how240' : 'how210', W = window.WORKS[wk];
    window.G.res[own].mp = 5000; window.G.res[own].fu = 2000; window.simpleSync();
    const wBtn = document.querySelector(`#tbuild .tb.work[data-key="${wk}"]`);
    const s0 = window.siteCount(own, wk), mp3 = window.G.res[own].mp, fu3 = window.G.res[own].fu;
    if (wBtn) wBtn.click();
    const armed = !!(window.G.place && window.G.place.work === wk);
    window.simpleSync();
    const wLit = wBtn && wBtn.classList.contains('on');
    /* the ground he picks: forward of home by more than the exclusion, and clear */
    const dir = us ? 1 : -1;
    let gp = null;
    for (let d = W.minHq + 90; d <= W.minHq + 460 && !gp; d += 60) {
      const c = window.nearestFree(hq.x + dir * d, hq.y);
      if (window.workRoom(c.x, c.y, W)) gp = c;
    }
    if (gp) {
      window.__o.camera({ x: gp.x, y: gp.y, dist: 560, pitch: 0.95 }); window.render();
      const p = window.w2s(gp.x, gp.y);
      window.__tev('touchstart', p.x, p.y); window.__tev('touchend', p.x, p.y);
    }
    const wSite = window.G.sites.find(q => q.own === own && q.kind === wk);
    const wOn = !!wSite && window.G.units.some(u => window.owned(u) && !u.dead && u.def.builder && u.building === wSite);
    const wFar = wSite ? Math.round(Math.hypot(wSite.x - hq.x, wSite.y - hq.y)) : -1;
    const wCost = [mp3 - window.G.res[own].mp, fu3 - window.G.res[own].fu];
    window.simpleSync();
    const wFull = wBtn && wBtn.classList.contains('poor'), wCount = wBtn && wBtn.lastChild.textContent;
    if (wBtn) wBtn.click();
    const armed2 = !!(window.G.place && window.G.place.work === wk);
    window.G.place = null;
    const wAgain = window.siteCount(own, wk);
    if (wSite) {
      window.G.sites.splice(window.G.sites.indexOf(wSite), 1);
      window.G.units.forEach(u => { if (u.building === wSite) window.clearOrder(u); });
    }
    window.G.res[own].mp = keep; window.G.res[own].fu = Math.max(0, fu3 - 400); window.simpleSync();
    return { postBtn: !!postBtn, postKey: postBtn && postBtn.dataset.key, site: !!site, onIt, postCost: mp0 - mp1, secBtn: !!secBtn, queued, secCost: mp1b - mp2, poor, refused, mp1b, pop1, q0,
             wk, wBtn: !!wBtn, armed, wLit, gp: !!gp, wSite: !!wSite, wOn, wFar, minHq: W.minHq, wCost,
             want: [W.cost.mp || 0, W.cost.fu || 0], wFull, wCount, armed2, wAgain: wAgain - s0,
             wWhere: gp && wSite ? Math.round(Math.hypot(wSite.x - gp.x, wSite.y - gp.y)) : -1 };
  });
  ok('simple: a tap on the strip pegs the post out with an engineer, queues a section, and is refused when the till is empty',
     strip.postBtn && strip.site && strip.onIt && strip.postCost === 200 && strip.secBtn && strip.queued === 1 && strip.secCost > 0 && strip.poor && strip.refused,
     `post ${strip.postKey} placed ${strip.site} with an engineer ${strip.onIt} for ${strip.postCost}; section queued ${strip.queued} for ${strip.secCost} (a till of ${strip.mp1b}, population ${strip.pop1}, ${strip.q0} in the queue); empty till dimmed ${strip.poor} and refused ${strip.refused}`);
  ok('simple: the strip arms the battery position and the player\'s own tap sites it, forward of home with an engineer; a second is refused',
     strip.wBtn && strip.armed && strip.wLit && strip.gp && strip.wSite && strip.wOn && strip.wWhere >= 0 && strip.wWhere < 40 &&
     strip.wFar >= strip.minHq && strip.wCost[0] === strip.want[0] && strip.wCost[1] === strip.want[1] &&
     strip.wFull && strip.wCount === '1' && !strip.armed2 && strip.wAgain === 1,
     `${strip.wk} button ${strip.wBtn}: armed ${strip.armed} and lit ${strip.wLit}; his tap sited it ${strip.wWhere} from where he put his finger, ` +
     `${strip.wFar} from home against ${strip.minHq}, with an engineer ${strip.wOn}, for ${strip.wCost.join('/')} of ${strip.want.join('/')}; ` +
     `then dimmed ${strip.wFull} reading ${JSON.stringify(strip.wCount)}, a second tap armed nothing ${!strip.armed2} and left ${strip.wAgain}`);

  /* --- the unit's popup under SIMPLE: a tap on a vehicle of his puts up the upgrades it
     can take with their prices and AUTO; an upgrade bought by hand is fitted and paid
     for, AUTO is lit by the setting and tapping it is this one vehicle's own word over
     it. Under classic, below, the same setting fits them for him on the tick. --- */
  const upg = await page.evaluate(() => {
    const own = window.G.own, us = window.G.side === 'us', hq = window.hqOf(own);
    const key = us ? 'am_jeep' : 'hr_ks750', upKey = us ? 'fifty' : 'mg42';
    const sp = window.nearestFree(hq.x + (us ? 220 : -220), hq.y + 90);
    const v = window.spawnUnit(own, key, sp.x, sp.y, 0);
    window.G.res[own].mp = 3000; window.G.res[own].fu = 500;
    window.simpleTap(v.x, v.y);
    const box = document.getElementById('tunit');
    const up = !box.classList.contains('hidden');
    const name = document.getElementById('tunitname').textContent;
    const btn = document.querySelector(`#tunit .tf[data-up="${upKey}"]`), auto = document.querySelector('#tunit .tf[data-up="auto"]');
    const cost = window.UPGRADES[upKey].cost.mp || 0, mp0 = window.G.res[own].mp;
    const autoLit0 = auto && auto.classList.contains('on'), globalOn = window.AUTOUP.on;
    if (btn) btn.click();
    const fitted = !!(v.up && v.up[upKey]), paid = mp0 - window.G.res[own].mp;
    const gone = !document.querySelector(`#tunit .tf[data-up="${upKey}"]`);
    if (auto) auto.click();
    const autoAfter = window.autoUpOf(v), autoLit1 = !!document.querySelector('#tunit .tf[data-up="auto"].on');
    const word = v.autoUp;
    /* and with the till empty the price is dimmed and refused */
    const v2 = window.spawnUnit(own, key, sp.x + 60, sp.y, 0);
    window.simpleTap(v2.x, v2.y);
    window.G.res[own].mp = 10; window.simpleSync();
    const btn2 = document.querySelector(`#tunit .tf[data-up="${upKey}"]`);
    const poor = btn2 && btn2.classList.contains('poor');
    if (btn2) btn2.click();
    const refused = !(v2.up && v2.up[upKey]);
    window.simpleTap(sp.x + 400, sp.y + 400);   /* the ground: the popup comes down */
    const down = box.classList.contains('hidden');
    window.G.units.splice(window.G.units.indexOf(v), 1); window.G.units.splice(window.G.units.indexOf(v2), 1);
    window.select([], false);
    return { key, upKey, up, name, btn: !!btn, auto: !!auto, autoLit0, globalOn, fitted, paid, cost, gone, autoAfter, autoLit1, word, poor, refused, down };
  });
  ok('simple: a tap on a vehicle puts up its upgrades and AUTO; one bought by hand is fitted and paid for, AUTO is this vehicle\'s word over the setting, and an empty till is refused',
     upg.up && upg.btn && upg.auto && upg.globalOn && upg.autoLit0 && upg.fitted && upg.paid === upg.cost && upg.gone &&
     upg.autoAfter === false && !upg.autoLit1 && upg.word === false && upg.poor && upg.refused && upg.down,
     `${upg.key} popup ${upg.up} "${upg.name}": ${upg.upKey} button ${upg.btn}, AUTO ${upg.auto} lit ${upg.autoLit0} with the setting ${upg.globalOn ? 'on' : 'off'}; ` +
     `bought: fitted ${upg.fitted} for ${upg.paid} of ${upg.cost}, button gone ${upg.gone}; AUTO tapped: ${upg.autoAfter} (word ${upg.word}), lit ${upg.autoLit1}; ` +
     `empty till dimmed ${upg.poor} and refused ${upg.refused}; ground tap took it down ${upg.down}`);

  /* and the rest of the finger's helpers */
  await page.evaluate(() => {
    /* a point of open ground on the screen with nothing of either side on it and no flag
       near it, so that a tap there is a tap on bare ground */
    window.__clearPt = function (sx, sy, rad) {
      for (const f of [1, 1.3, 1.6, .8, .6]) for (let k = 0; k < 24; k++) {
        const a = k * Math.PI / 12 + .3, x = sx + Math.cos(a) * rad * f, y = sy + Math.sin(a) * rad * f;
        if (x < 30 || y < 90 || x > innerWidth - 80 || y > innerHeight - 150) continue;
        const w = window.s2w(x, y);
        if (window.G.units.some(u => !u.dead && !u.inside && window.owned(u) && window.hitsUnit(u, w.x, w.y, 34))) continue;
        if (window.unitsAt(w.x, w.y, 30).length || window.buildingAt(w.x, w.y) || window.bunkerAt(w.x, w.y) || !window.walkable(w.x, w.y)) continue;
        if (window.blockAt(w.x, w.y) || window.simpleSectorAt(w.x, w.y)) continue;
        return { x, y, w };
      }
      return null;
    };
    /* a tap on a flag: the camera goes to it first, because a tap is a point on the screen */
    window.__tapFlag = function (s) {
      window.__o.camera({ x: s.x, y: s.y, dist: 560, pitch: 0.95 }); window.render();
      const p = window.w2s(s.x, s.y);
      /* A tap on one of his own picks the unit, and his own men stand on his own flags:
         the pole point is not always a tap on the flag. So it is nudged round the pole
         until the pad is open on THAT sector -- the flag is a circle of a hundred and
         thirty and the pick radius is a few dozen, so there is always room. */
      const tryAt = (x, y) => {
        window.__tev('touchstart', x, y); window.__tev('touchend', x, y);
        return !!(window.SIMPLEORD && window.SIMPLEORD.sec === s);
      };
      /* two rings, because on one desktop run his own men stood thick enough round the
         pole of the flag he was told to hold that all eight taps of the first one picked a
         man, the HOLD went nowhere, and the row read a hold order the brain had never
         been given */
      let got = tryAt(p.x, p.y);
      for (const rr of [46, 92]) {
        for (let k = 0; k < 8 && !got; k++) {
          const a = (k + (rr > 46 ? .5 : 0)) * Math.PI / 4;
          got = tryAt(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
        }
      }
      /* and since the brains dig works, his engineers and the men they dig for stand round
         the flags he holds as well, so a desktop run had every one of those sixteen taps on
         a man. The rest of the flag's circle is walked in the world for a point where no
         man of his is under the finger, and that point is tapped. */
      const pickR = Math.min(90, Math.max(26, window.CAM.dist * .05));
      for (const wr of [30, 55, 80, 105, 122]) {
        for (let k = 0; k < 16 && !got; k++) {
          const a = k * Math.PI / 8 + wr * .01, wx = s.x + Math.cos(a) * wr, wy = s.y + Math.sin(a) * wr;
          if (window.nearestOwn(wx, wy, pickR) || window.simpleFoeAt(wx, wy) || window.simpleSectorAt(wx, wy) !== s) continue;
          const q = window.w2s(wx, wy);
          if (q.x < 30 || q.y < 90 || q.x > innerWidth - 80 || q.y > innerHeight - 150) continue;
          got = tryAt(q.x, q.y);
        }
      }
      const box = document.getElementById('tord');
      return { shown: !box.classList.contains('hidden'), name: document.getElementById('tordname').textContent,
               on: !!(window.SIMPLEORD && window.SIMPLEORD.sec === s),
               btns: [...box.querySelectorAll('#tordbtns .tf')].map(b => { const r = b.getBoundingClientRect(); return { dir: b.dataset.ord, w: r.width | 0, h: r.height | 0, on: b.classList.contains('on') }; }),
               who: [...box.querySelectorAll('#tordwho .chip')].map(b => { const r = b.getBoundingClientRect(); return { k: b.dataset.who, w: r.width | 0, h: r.height | 0, on: b.classList.contains('on') }; }),
               how: [...box.querySelectorAll('#tordhow .chip')].map(b => { const r = b.getBoundingClientRect(); return { k: b.dataset.how, w: r.width | 0, h: r.height | 0, on: b.classList.contains('on') }; }) };
    };
    /* A tap on a piece of open ground, which is the thing the board added. The point is
       found ON THE SCREEN rather than in the world: `clampCam` will not centre the camera
       near the edge of the map, so a world point chosen by arithmetic and projected after
       the camera has refused to go there lands somewhere else entirely -- the first
       version tapped (141, 824), the camera was looking a long way off it, and the row
       read a pad that had never opened. `__clearPt` already answers the question the
       drill is asking: a point on screen with nothing of either side on it and no flag
       near it. */
    window.__tapGround = function (nearX, nearY) {
      window.__o.camera({ x: nearX, y: nearY, dist: 620, pitch: 0.95 }); window.render();
      const p = window.__clearPt(innerWidth / 2, innerHeight / 2, 140);
      if (!p) return null;
      window.__tev('touchstart', p.x, p.y); window.__tev('touchend', p.x, p.y);
      return document.getElementById('tord').classList.contains('hidden') ? null : p.w;
    };
    window.__ordOp = function (slot, id) {
      const o = window.aiOrdById(slot, id);
      return o && o.opId ? window.aiOpById(slot, o.opId) : null;
    };
  });

  /* --- the flags: a tap on one puts its directives up, and each directive is read off
     the brain's own plan rather than off what the popup said. Staged on fresh sections,
     because after four minutes of battle the ones on the field are whatever the battle
     left of them and a hold wants two and a feint wants three; and the brain is ticked
     by hand rather than run, because a battle the player is losing takes the flag he
     was told to hold off him while the clock runs. --- */
  const flags = await page.evaluate(minTap => {
    const own = window.G.own, side = window.G.side, us = side === 'us', hq = window.hqOf(own);
    const secKey = us ? 'am_rifle' : 'hr_gren';
    for (let i = 0; i < 5; i++) {
      const sp = window.nearestFree(hq.x + (us ? 220 : -220) + i * 40, hq.y - 120 + i * 60);
      window.spawnUnit(own, secKey, sp.x, sp.y, 0);
    }
    const P = window.AIP[own];
    /* and the enemy is out of sight for the two ticks: a section raised beside the
       headquarters with a tank in front of it calls for help and is dealt to nobody's
       operation, which is right and is not what the row measures. On one desktop run the
       enemy was at the headquarters when the row ran, and the two directed operations
       were raised with nobody on them out of ten fighters. */
    const M0 = window.aiMemOf(side), con0 = M0.con, n0 = M0.n, hid = [];
    M0.con = {}; M0.n = 0;
    for (const e of window.G.units) if (!e.dead && e.side !== side) { hid.push([e, us ? e.vUs : e.vGer]); if (us) e.vUs = false; else e.vGer = false; }
    const Qc = window.AIQ[own], calls0 = Qc ? Qc.list.slice() : null; if (Qc) Qc.list.length = 0;
    const unhide = () => {
      M0.con = con0; M0.n = n0;
      for (const h of hid) { if (us) h[0].vUs = h[1]; else h[0].vGer = h[1]; }
      if (Qc) { Qc.list.length = 0; for (const c of calls0) Qc.list.push(c); }
    };
    const byD = window.G.sectors.slice().sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y));
    const theirs = byD.filter(s => s.owner !== side);
    if (theirs.length < 3) { unhide(); return { none: true }; }
    /* his nearest flag, taken for him if the battle has taken it off him */
    const H = byD[0]; H.owner = side; H.contest = false;
    const A = theirs.filter(s => s !== H)[0], F = theirs.filter(s => s !== H && s !== A).slice(-1)[0];
    /* ATTACK on a flag that is not his */
    const tapA = window.__tapFlag(A);
    const small = tapA.btns.concat(tapA.who, tapA.how).filter(b => b.w < minTap || b.h < minTap).length;
    const kinds = tapA.btns.map(b => b.dir).join(',');
    document.querySelector('#tordbtns .tf[data-ord="attack"]').click();
    const shutA = document.getElementById('tord').classList.contains('hidden');
    const dirA = window.aiDirOf(own, A.id);
    /* HOLD on one of his, FEINT on another of theirs */
    const onH = window.__tapFlag(H).on; document.querySelector('#tordbtns .tf[data-ord="hold"]').click();
    const onF = window.__tapFlag(F).on; document.querySelector('#tordbtns .tf[data-ord="feint"]').click();
    const tick = P.t, dirH = window.aiDirOf(own, H.id), dirF = window.aiDirOf(own, F.id);
    /* one tick of the brain, and what it made of the three */
    window.aiThink(1);
    const Q = window.AIOP[own], main = window.aiOpKind(own, 'take');
    const takers = window.G.units.filter(u => window.owned(u) && !u.dead && u.jobSec === A.id && !u.retreat).length;
    const oH = window.aiOrdAt(own, H.id), oF = window.aiOrdAt(own, F.id);
    const hold = oH && window.__ordOp(own, oH.id), feint = oF && window.__ordOp(own, oF.id);
    const onHold = hold ? window.G.units.filter(u => window.owned(u) && !u.dead && u.op === hold.id).length : 0;
    const onFeint = feint ? window.G.units.filter(u => window.owned(u) && !u.dead && u.op === feint.id).length : 0;
    const status = document.getElementById('tselname').textContent;
    /* the pad on the held flag shows HOLD lit, and tapping the lit one again takes it
       off; the review then drops the operation it stood on */
    const again = window.__tapFlag(H);
    const lit = again.btns.filter(b => b.on).map(b => b.dir).join('+');
    document.querySelector('#tordbtns .tf[data-ord="hold"]').click();
    const cleared = !window.aiDirOf(own, H.id);
    window.aiThink(1);
    const dropped = !window.aiOpById(own, hold ? hold.id : 0);
    unhide();
    return { A: A.id, F: F.id, H: H.id, name: tapA.name, shown: tapA.shown, small, kinds, shutA, dirA, dirH, dirF, tick, onA: tapA.on, onH, onF,
             asSec: P.asSec, mainSec: main && main.sec, takers, hold: !!hold, onHold, feint: !!feint, onFeint, lit, cleared, dropped, status,
             who: tapA.who.length, how: tapA.how.length,
             ops: Q ? Q.list.map(o => o.kind + (o.dir ? '!' : '')).join('+') : '',
             n: window.G.units.filter(u => window.owned(u) && !u.dead && !u.def.builder && u.cat).length };
  }, MIN_TAP);
  ok('simple: a tap on a flag puts the whole order pad up; ATTACK is the wave\'s objective, HOLD and FEINT raise operations with men on them, and the lit one taps off',
     !flags.none && flags.shown && flags.onA && flags.name.length > 0 && flags.small === 0 && flags.kinds.split(',').length === 9 &&
     flags.who === 9 && flags.how === 3 && flags.shutA && flags.dirA === 'attack' && flags.dirH === 'hold' &&
     flags.dirF === 'feint' && flags.tick === 0 && flags.asSec === flags.A && flags.mainSec === flags.A && flags.takers >= 1 && flags.hold &&
     flags.onHold >= 1 && flags.feint && flags.onFeint >= 1 && flags.lit === 'hold' && flags.cleared && flags.dropped,
     flags.none ? 'fewer than three flags that are not his' :
     `${flags.name} (on the flag ${flags.onA}, wanted ${flags.A}): ${flags.kinds} with ${flags.who} who-chips and ${flags.how} tempers, none under ${MIN_TAP}px; ` +
     `attack -> wave on ${flags.asSec} (main ${flags.mainSec}) with ${flags.takers} sent; ` +
     `hold (pad on it ${flags.onH}, order ${flags.dirH}) ${flags.hold} with ${flags.onHold} on it; feint (pad ${flags.onF}, order ${flags.dirF}) ${flags.feint} with ${flags.onFeint} on it, out of ${flags.n} fighters; ` +
     `lit ${flags.lit} -> cleared ${flags.cleared}, dropped ${flags.dropped}; ops ${flags.ops}; line "${flags.status}"`);

  /* --- the rest of the board: an order about a piece of open ground with a force he
     named himself, an order about a thing of theirs, the list of what is standing with a
     way to take one off, and the three settings every unit not under an order runs on.
     None of it existed: three directives on nine flags was the whole of what a player
     could say, and there was nothing anywhere that told him which of his units were
     carrying one out. Driven through the events a finger raises, at the canvas. --- */
  const board = await page.evaluate(minTap => {
    const own = window.G.own, side = window.G.side, us = side === 'us', hq = window.hqOf(own);
    if (!window.AIP[own]) window.aiInit(own, true);
    const P = window.AIP[own];
    /* a clean board, no placement left armed by the row above -- an armed emplacement
       takes the next tap on the ground and every tap below is one -- and a few sections
       of his own, away from the flags */
    window.G.place = null;
    window.aiOrds(own).length = 0;
    const raised = [];
    for (let i = 0; i < 4; i++) {
      const sp = window.nearestFree(hq.x + (us ? 300 : -300) + i * 30, hq.y - 160 + i * 90);
      const u = window.spawnUnit(own, us ? 'am_rifle' : 'hr_gren', sp.x, sp.y, 0);
      u.setup = 0; raised.push(u);
    }
    const mine = window.G.units.filter(u => window.owned(u) && !u.dead && u.cat === 'inf' && !u.def.builder);
    /* the section the posture is said of, held back from the screen order below: with
       INF as the force every section on the field is on it, and a unit under an order is
       not the plan's to march either -- which would have made the posture unreadable */
    const poseSec = mine[mine.length - 1] || null;
    /* ---- a piece of open ground, given to his infantry, pressed home.
       Clear of his own men and of any flag, because a tap on one of his picks it and a
       tap near a pole is a tap on the flag: the first version put the point six hundred
       units out toward the enemy, which after four minutes of battle is exactly where his
       sections are, and every assertion under it read off a pad that had never opened. */
    window.ORDWHO = 'inf'; window.ORDAGG = 2;
    let gp = null;
    for (const d of [340, 520, 700, 180]) {
      gp = window.__tapGround(hq.x + (us ? d : -d), hq.y + (d & 1 ? 120 : -80));
      if (gp) break;
    }
    const padG = !!gp;
    const headG = document.getElementById('tordname').textContent;
    document.querySelector('#tordbtns .tf[data-ord="screen"]').click();
    const oG = window.aiOrds(own).filter(o => o.k === 'screen')[0];
    const forceN = oG ? oG.force.length : -1, aggr = oG ? oG.aggr : -1;
    /* ---- a thing of theirs: the pad opens on it and RAID names it */
    /* and a thing of theirs with nobody of his standing on top of it, for the same reason */
    const foe = window.G.units.find(u => !u.dead && u.side !== side && !u.inside &&
      !window.G.units.some(o => !o.dead && !o.inside && window.owned(o) && Math.hypot(o.x - u.x, o.y - u.y) < 170)) ||
      window.G.units.find(u => !u.dead && u.side !== side && !u.inside);
    let padF = false, headF = '', tid = 0;
    if (foe) {
      if (us) foe.vUs = true; else foe.vGer = true;
      window.__o.camera({ x: foe.x, y: foe.y, dist: 520, pitch: 0.95 }); window.render();
      const p = window.w2s(foe.x, foe.y);
      /* and only if the camera could actually be put there: the clamp keeps it off the
         edge of the map and a projection of a point the camera is not looking at is a
         tap somewhere else */
      const on = !p.behind && p.x > 10 && p.y > 10 && p.x < innerWidth - 10 && p.y < innerHeight - 10;
      if (on) { window.__tev('touchstart', p.x, p.y); window.__tev('touchend', p.x, p.y); }
      padF = on && !document.getElementById('tord').classList.contains('hidden');
      headF = document.getElementById('tordname').textContent;
      window.ORDWHO = 'any';
      const b = document.querySelector('#tordbtns .tf[data-ord="raid"]');
      if (b) b.click();
      const oR = window.aiOrds(own).filter(o => o.k === 'raid')[0];
      tid = oR ? oR.tid : 0;
    }
    /* ---- one tick, and who is under what. The force is read again after it, because
       the tend prunes whoever has died or is falling back and those are not carrying
       anything: the count to check against is what the order still has, not what he
       named a moment before. */
    window.aiThink(1);
    const forceAfter = oG ? oG.force.length : -1;
    const onG = oG ? window.G.units.filter(u => window.owned(u) && !u.dead && u.ord === oG.id).length : 0;
    const opG = oG && oG.opId ? window.aiOpById(own, oG.opId) : null;
    const fearOn = oG ? window.G.units.filter(u => window.owned(u) && u.ord === oG.id && u.fear !== undefined)
                                      .map(u => +u.fear.toFixed(2))[0] : -1;
    /* ---- the list: the button's count, a row per order, and the cross that cancels */
    const badge = document.getElementById('tordn').textContent;
    document.getElementById('tOrders').click();
    const listUp = !document.getElementById('tlist').classList.contains('hidden');
    const rows = [...document.querySelectorAll('#tlistrows .orow')].map(r => ({
      id: r.dataset.ord, h: r.getBoundingClientRect().height | 0, t: r.querySelector('b').textContent }));
    const nOrd = window.aiOrds(own).length;
    const cross = document.querySelector('.orow button');
    if (cross) cross.click();
    const afterX = window.aiOrds(own).length;
    /* ---- and the army's own three, off the same panel */
    const chips = [...document.querySelectorAll('#tarmypose .chip, #tarmyreact .chip, #tarmyhow .chip')];
    const smallC = chips.filter(c => { const r = c.getBoundingClientRect(); return r.width < minTap || r.height < minTap; }).length;
    document.querySelector('#tarmypose .chip[data-pose="dig"]').click();
    document.querySelector('#tarmyreact .chip[data-react="fight"]').click();
    document.querySelector('#tarmyhow .chip[data-how="0"]').click();
    const army = { pose: P.pose, react: P.react, aggr: P.aggr };
    document.getElementById('tlistx').click();
    const listDown = document.getElementById('tlist').classList.contains('hidden');
    /* ---- a posture on one section: the plan stops marching it, and its own weighing
       still has it, which is the whole distinction the posture rests on */
    const sec = poseSec;
    let posed = null;
    if (sec) {
      /* off whatever order it is under, because an order outranks a posture by design */
      for (const o of window.aiOrds(own)) { const i = o.force.indexOf(sec.id); if (i >= 0) o.force.splice(i, 1); }
      sec.ord = 0; sec.op = 0;
      window.select([sec], false); window.simpleUnit(sec);
      document.querySelector('#tunitpose .chip[data-pose="hold"]').click();
      const before = sec.jobSec;
      window.aiThink(1);
      posed = { pose: sec.pose, of: window.poseOf(sec), before, after: sec.jobSec, posed: window.aiPosed(sec) };
      window.simpleUnit(null); window.select([], false);
    }
    /* ---- and the temper is read where it is spent: the same section under a cautious
       order and under a press-home one pays a different price for the beaten zone */
    P.aggr = 1; const t0 = window.aiAggr({ own: own, ord: 0 });
    P.aggr = 2; const tPress = window.aiAggr({ own: own, ord: 0 }).fear;
    P.aggr = 0; const tCaut = window.aiAggr({ own: own, ord: 0 }).fear;
    P.aggr = 1; P.pose = 'advance'; P.react = 'cover';
    /* down again */
    window.aiOrds(own).length = 0;
    for (const u of raised) { const i = window.G.units.indexOf(u); if (i >= 0) window.G.units.splice(i, 1); }
    window.ORDWHO = 'any'; window.ORDAGG = null;
    window.simpleOrdOpen(null); window.select([], false);
    return { padG, headG, gpAt: gp ? [Math.round(gp.x), Math.round(gp.y)] : null, foeOn: padF,
             forceN, forceAfter, aggr, mine: mine.length, onG, opKind: opG && opG.kind, opWant: opG && opG.want,
             fearOn, padF, headF, tid, foeId: foe ? foe.id : -1, badge, listUp, rows, nOrd, afterX, smallC, army,
             listDown, posed, t0: t0.fear, tPress, tCaut };
  }, MIN_TAP);
  ok('simple: an order on open ground with a force he named, one on a thing of theirs, the list that says what is standing, and the army\'s own posture, reaction and temper',
     board.padG && board.headG === 'OPEN GROUND' && board.forceN === board.mine && board.aggr === 2 &&
     board.onG === board.forceAfter && board.onG > 0 && board.opKind === 'screen' && board.opWant === 0 && board.fearOn > 0 && board.fearOn < .6 &&
     board.padF && board.headF.length > 0 && board.tid === board.foeId &&
     board.badge === String(board.nOrd) && board.listUp && board.rows.length === board.nOrd &&
     board.rows.every(r => r.h >= MIN_TAP) && board.afterX === board.nOrd - 1 && board.smallC === 0 &&
     board.army.pose === 'dig' && board.army.react === 'fight' && board.army.aggr === 0 && board.listDown &&
     board.posed && board.posed.pose === 'hold' && board.posed.of === 'hold' && board.posed.posed && !board.posed.after &&
     board.tPress < board.t0 && board.tCaut > board.t0,
     `ground pad ${board.padG} at ${board.gpAt} "${board.headG}" -> screen on ${board.forceN} of ${board.mine} sections at ${board.aggr}, ` +
     `${board.onG} of the ${board.forceAfter} it still has carrying it (op ${board.opKind} want ${board.opWant}, fear ${board.fearOn}); ` +
     `a tap on theirs "${board.headF}" -> raid on ${board.tid}/${board.foeId}; badge ${board.badge} with ${board.rows.length} of ${board.nOrd} rows, ` +
     `cross -> ${board.afterX}; army ${JSON.stringify(board.army)}; posture ${JSON.stringify(board.posed)}; ` +
     `fear ${board.tCaut}/${board.t0}/${board.tPress}`);

  /* --- and the guns serve the attack he ordered: a tube of his in action and in reach,
     ATTACK tapped on a defended flag, and on the next tick the tube is laid on the men
     holding it; with the wave ready to go and its preparation spent, the go lays smoke short
     of the flag. Staged rather than sampled, with the tube's post set to where it stands so
     the row is about the mission and not about the walk to a post. --- */
  const dirArty = await page.evaluate(() => {
    const own = window.G.own, side = window.G.side, foe = side === 'us' ? 'ger' : 'us';
    const P = window.AIP[own]; if (!P) return { none: 'no plan on his slot' };
    const hq = window.hqOf(own);
    const S = window.G.sectors.filter(s => s.owner !== side).sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
    if (!S) return { none: 'no flag that is not his' };
    const mk = side === 'us' ? 'us_mor' : 'ger_mor', rk = side === 'us' ? 'am_rifle' : 'hr_gren', fk = foe === 'ger' ? 'hr_gren' : 'am_rifle';
    const ang = Math.atan2(hq.y - S.y, hq.x - S.x), raised = [];
    const at = (d, o) => window.nearestFree(S.x + Math.cos(ang) * d + Math.cos(ang + Math.PI / 2) * o, S.y + Math.sin(ang) * d + Math.sin(ang + Math.PI / 2) * o);
    const mp = at(430, 0), m = window.spawnUnit(own, mk, mp.x, mp.y, 0); raised.push(m);
    m.setup = 0; m.packed = false;
    const d1 = window.spawnUnit(foe, fk, S.x + 24, S.y, 0), d2 = window.spawnUnit(foe, fk, S.x - 24, S.y + 20, 0); raised.push(d1, d2);
    [-70, 0, 70].forEach(o => { const p = at(300, o); const u = window.spawnUnit(own, rk, p.x, p.y, 0); u.setup = 0; raised.push(u); });
    for (let k = 0; k < 400; k++) { window.computeVisibility(); if ((side === 'us' ? d1.vUs : d1.vGer) && (side === 'us' ? d2.vUs : d2.vGer)) break; }
    const known = !!(side === 'us' ? d1.vUs : d1.vGer);
    /* the tube stands on its post, aimed at the flag, so the plan finds it in position */
    m.jobX = m.x; m.jobY = m.y; m.aimX = S.x; m.aimY = S.y; m.jobT = window.G.t; m.jobAnc = 300;
    const f0 = Object.assign({}, window.AIR.fired);
    /* and nobody answers a call for the drill's two ticks: a section of his from the
       battle meeting a tank raises one, an answer outranks the plan, and the nearest
       capable thing to it was one of the three put down here, dealt off the flag and sent
       two streets away. The flag row empties the board for the same reason; this one has
       to stop the dealing as well, because a call raised inside the tick is dealt inside it */
    const realAns = window.aiAnswer; window.aiAnswer = function () {};
    /* and no operation raised or manned for them either: on Saint-Lô a hold raised on the
       first tick borrowed two of the three, a unit on an operation is not in the wave, and the
       wave went in with one section or not at all. The operations outrank the plan by design,
       which is the brain being right about the wrong thing for a row about the plan. */
    const realPlan = window.aiOpsPlan, realMan = window.aiOpsMan;
    window.aiOpsPlan = function () {}; window.aiOpsMan = function () {};
    /* ATTACK given through the pad with the three sections he put down NAMED as its
       force, which is the board's own way of saying it and is what makes the deal
       readable: dealt by nearest-first they compete with whatever the battle's army has
       left standing nearer the flag, and one of the three went to another objective. */
    const secs3 = raised.filter(u => u.own === own && u.cat === 'inf');
    window.select(secs3, false);
    window.ORDWHO = 'sel'; window.ORDAGG = null;
    window.simpleOrdOpen({ sec: S, x: S.x, y: S.y });
    document.querySelector('#tordbtns .tf[data-ord="attack"]').click();
    window.select([], false); window.ORDWHO = 'any';
    secs3.forEach(u => { u.op = 0; });
    P.asKey = null; P.asT = -99; P.t = 0;
    const tick = () => { window.AIP[own].t = 0; window.aiThink(1); };
    tick();
    /* what the tube was laid on after a tick: the preparation on the flag's defenders, or
       the screen short of the flag. Either may come first. On the desktop the wave waits
       for its fire and the go has to be forced below; on one phone run a section of his
       from the battle already stood inside 240 of the flag, so the wave went on the tick
       it formed and the screen came before the preparation rather than after it. Both are
       the brain being right, so the row reads both ticks and asks for one of each. */
    /* any tube of his, because `aiSmokeScreen` sends the screen to whichever is nearest
       to being able to lay it and the battle has tubes of its own: the row stages one so
       that there is certainly a gun in reach, not so that it is the only one */
    const anyMis = (want) => {
      const t = window.G.units.filter(u => window.owned(u) && !u.dead && u.barrage && !!u.barrage.smoke === want)[0];
      return t ? { smoke: want, d: Math.round(Math.hypot(t.barrage.x - S.x, t.barrage.y - S.y)), x: t.barrage.x, y: t.barrage.y } : null;
    };
    const mis = () => m.barrage ? { smoke: !!m.barrage.smoke, d: Math.round(Math.hypot(m.barrage.x - S.x, m.barrage.y - S.y)), x: m.barrage.x, y: m.barrage.y } : null;
    const m1 = mis(), went1 = P.asT >= 0;
    const obj = String(P.asSec) === String(S.id);
    /* the preparation is spent before the go, the way it is in a battle -- with the
       nearest thing the side can see standing square off the line of fire, because a
       halted crew turns toward the nearest known enemy and a tube on a mission used to be
       turned back off its bearing every frame by exactly that, at the rate the mission
       laid it on: ten rounds in hand and none of them fired, on a row that read as a
       mission that had simply not run down yet */
    const tp = at(430, 190), th = window.spawnUnit(foe, fk, tp.x, tp.y, 0); raised.push(th);
    th.vUs = th.vGer = true;
    const want = Math.atan2(m.barrage ? m.barrage.y - m.y : 0, m.barrage ? m.barrage.x - m.x : 1);
    let fired = 0;
    for (let f = 0; f < 60 * 60 && m.barrage; f++) { const n = window.G.shots.length; window.updateUnit(m, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60; if (window.G.shots.length > n) fired++; }
    const spent = !m.barrage, thD = Math.round(Math.hypot(th.x - m.x, th.y - m.y)), thOff = Math.abs(window.angDiff(want, Math.atan2(th.y - m.y, th.x - m.x))).toFixed(2);
    const state = (m.barrage ? `left ${m.barrage.left} fired ${fired} moving ${m.moving} order ${m.order} packed ${m.packed} setup ${m.setup.toFixed(1)} cd ${m.cd.toFixed(1)} lay ${Math.abs(window.angDiff(m.facing, want)).toFixed(2)}` : `fired ${fired}`) +
                  ` with the nearest enemy ${thD} off at ${thOff} rad from the line`;
    if (P.asT < 0) { P.asForm = window.G.t - 200; P.asT = -99; }
    tick();
    const m2 = mis(), went = P.asT >= 0;
    const he = m1 && !m1.smoke ? m1 : m2 && !m2.smoke ? m2 : anyMis(false);
    const sm = m1 && m1.smoke ? m1 : m2 && m2.smoke ? m2 : anyMis(true);
    const dirFired = (window.AIR.fired['mortar.dir'] || 0) - (f0['mortar.dir'] || 0);
    /* what the wave was dealt, because the go wants half of it near the forming-up point
       and the first version of this row lost two of the three sections to a held flag
       that outscored the directive */
    const mo = ((window.AIOP[own] || {}).list || []).find(o => o.main) || {};
    const secs = raised.filter(u => u.own === own && u.cat === 'inf');
    /* by the job the deal gave, and not by aiInWave: an operation raised the same tick
       borrows a section the deal had already put on the flag, which is the operations
       outranking the plan by design, and on one run a hold took two of the three */
    const dealt = secs.filter(u => String(u.jobSec) === String(S.id)).length;
    const deal = secs.map(u => `${u.job}/${u.jobSec}${u.op ? '/op' : ''}`).join(' ');
    const fD = sm && mo.fupX ? Math.round(Math.hypot(sm.x - mo.fupX, sm.y - mo.fupY)) : -1;
    const screenFired = (window.AIR.fired['smoke.screen'] || 0) - (f0['smoke.screen'] || 0);
    const kind = (q) => q ? (q.smoke ? 'smoke' : 'HE') + ' ' + q.d + ' from the flag' : 'nothing';
    /* down again */
    window.aiAnswer = realAns; window.aiOpsPlan = realPlan; window.aiOpsMan = realMan;
    window.aiDirSet(own, S.id, null);
    P.asKey = null; P.asT = -99; P.asSec = null;
    raised.forEach(u => { u.barrage = null; const i = window.G.units.indexOf(u); if (i >= 0) window.G.units.splice(i, 1); });
    window.G.smoke.length = 0; window.G.shots.length = 0;
    window.select([], false);
    return { name: S.label || S.id, known, obj, dirFired, spent, state, went1, went, fD, screenFired, dealt, deal, n: secs.length,
             m1: kind(m1), m2: kind(m2), heD: he ? he.d : -1, smD: sm ? sm.d : -1 };
  });
  ok('simple: ATTACK with a tube in reach lays it on the men holding the flag, and the go lays smoke short of the flag',
     !dirArty.none && dirArty.obj && dirArty.heD >= 0 && dirArty.heD <= 190 && dirArty.dirFired >= 1 && dirArty.spent && dirArty.dealt === dirArty.n &&
     dirArty.went && dirArty.screenFired >= 1 && dirArty.smD > 0 && dirArty.smD <= 170,
     dirArty.none ? dirArty.none : `${dirArty.name}: defenders seen ${dirArty.known}; tick 1 laid ${dirArty.m1} (objective ${dirArty.obj}, went ${dirArty.went1}); ` +
                            `spent ${dirArty.spent} (${dirArty.state}); tick 2 dealt ${dirArty.dealt} of ${dirArty.n} to it (${dirArty.deal}), went ${dirArty.went}, laid ${dirArty.m2}; ` +
                            `mortar.dir ${dirArty.dirFired}, smoke.screen ${dirArty.screenFired}, the screen ${dirArty.fD} from the fup`);

  /* --- LOOK with nothing picked, a tap on a unit that picks it and gives no order, and
     a tap on the ground that lets go --- */
  /* the section the two rows below tap is one standing clear of any flag and of any other
     unit of his: under SIMPLE a tap within 130 of a flag is a tap on the flag, and a tap on a
     section standing in another picks whichever is nearer, so the first section in the list
     read as a picked-nothing on one run in ten */
  await page.evaluate(() => {
    window.__aloneSec = function () {
      return window.G.units.find(q => window.owned(q) && !q.dead && q.cat === 'inf' && !q.retreat && !q.inside && !q.gar &&
        !window.G.sectors.some(s => Math.hypot(s.x - q.x, s.y - q.y) < 170) &&
        !window.G.units.some(o => o !== q && !o.dead && !o.inside && window.owned(o) && Math.hypot(o.x - q.x, o.y - q.y) < 80)) ||
        window.G.units.find(q => window.owned(q) && !q.dead && q.cat === 'inf' && !q.retreat && !q.inside && !q.gar);
    };
  });
  const look = await page.evaluate(() => {
    window.select([], false);
    document.getElementById('tPov').click();
    const on = window.POV.on, from = window.POV.u && window.owned(window.POV.u) && !window.POV.u.dead;
    window.povOff();
    const u = window.__aloneSec();
    if (!u) return { on, from, none: true };
    window.__o.camera({ x: u.x, y: u.y, dist: 520, pitch: 0.9 }); window.render();
    const p = window.w2s(u.x, u.y), o0 = u.order, d0 = JSON.stringify(u.dest && [u.dest.x, u.dest.y]);
    window.__tev('touchstart', p.x, p.y); window.__tev('touchend', p.x, p.y);
    const picked = window.G.sel.length === 1 && window.G.sel[0] === u;
    const tap = window.__clearPt(p.x, p.y, 150);
    if (tap) { window.__tev('touchstart', tap.x, tap.y); window.__tev('touchend', tap.x, tap.y); }
    const same = u.order === o0 && JSON.stringify(u.dest && [u.dest.x, u.dest.y]) === d0;
    return { on, from, picked, tap: !!tap, let_: window.G.sel.length, same };
  });
  ok('simple: LOOK looks from the nearest unit with nothing picked, a tap on a unit picks it and orders nothing, and a tap on the ground lets go',
     look.on && look.from && !look.none && look.picked && look.tap && look.let_ === 0 && look.same,
     look.none ? 'no section to tap' : `look ${look.on} from his ${look.from}; picked ${look.picked}; ground tap left ${look.let_} selected with the order unchanged ${look.same}`);

  /* and the classic scheme is what it was: the bar back, the strip gone, a tap an order */
  const classic = await page.evaluate(() => {
    window.ctrlSet(false, true);
    const u = window.__aloneSec();
    if (!u) return { none: true };
    window.clearOrder(u);
    window.select([u], false);
    window.__o.camera({ x: u.x, y: u.y, dist: 520, pitch: 0.9 });
    const p = window.w2s(u.x, u.y), tap = window.__clearPt(p.x, p.y, 150);
    if (!tap) return { none: true };
    window.__tev('touchstart', tap.x, tap.y); window.__tev('touchend', tap.x, tap.y);
    const dest = u.dest ? Math.hypot(u.dest.x - tap.w.x, u.dest.y - tap.w.y) : -1;
    /* and a drag from the unit pans */
    const cam0 = [window.CAM.tx, window.CAM.ty];
    window.__tev('touchstart', p.x, p.y); window.__tev('touchmove', p.x + 30, p.y + 40); window.__tev('touchmove', p.x + 90, p.y + 120); window.__tev('touchend', p.x + 90, p.y + 120);
    const panned = Math.hypot(window.CAM.tx - cam0[0], window.CAM.ty - cam0[1]);
    return { off: !document.body.classList.contains('simple'), bar: getComputedStyle(document.getElementById('bar')).display,
             hidden: document.getElementById('simple').classList.contains('hidden'), miniIn: document.getElementById('mini').parentNode.id,
             order: u.order, dest: +dest.toFixed(1), panned: +panned.toFixed(0), brains: Object.keys(window.AIP).sort().join(',') };
  });
  ok('classic: the bar is back, the strip is gone, a tap on the ground orders, a drag from the unit pans, and the brain on his slot stops',
     !classic.none && classic.off && classic.bar !== 'none' && classic.hidden && classic.miniIn === 'bar' && classic.order === 'move' &&
     classic.dest >= 0 && classic.dest < 1 && classic.panned > 20,
     classic.none ? 'no section or no open ground on screen' : `tap: ${classic.order} ${classic.dest} from the finger, drag panned ${classic.panned}, map in #${classic.miniIn}, brains ${classic.brains}`);
  /* the setting under classic: the tick fits an upgrade to a vehicle of his that can take
     one, leaves alone the one that said no, and fits nothing with the setting off. One
     vehicle at a time, because the tick buys one a call and would otherwise pick whichever
     of three it met first. The command bar's card is read off the same selection. */
  const aup = await page.evaluate(() => {
    const own = window.G.own, us = window.G.side === 'us', hq = window.hqOf(own);
    const key = us ? 'am_sher' : 'hr_p4', uk = 'mg';
    const sp = window.nearestFree(hq.x + (us ? 260 : -260), hq.y - 120);
    window.G.res[own].mp = 3000; window.G.res[own].fu = 500;
    const brainRuns = window.aiRuns(window.slotOf(own));
    function tick() { window.autoUpT = -99; window.autoUpTick(); }
    const a = window.spawnUnit(own, key, sp.x, sp.y, 0);
    window.autoUpSet(true, true); tick();
    const autoFit = !!a.up[uk];
    /* the card, on the selection */
    window.select([a], false); window.syncHud();
    const card = Array.from(document.querySelectorAll('#cmds .cmd')).find(b => /Auto upgrade/i.test(b.textContent));
    const lit0 = card && card.classList.contains('act');
    if (card) card.click();
    const word = a.autoUp, lit1 = !!Array.from(document.querySelectorAll('#cmds .cmd')).find(b => /Auto upgrade/i.test(b.textContent) && b.classList.contains('act'));
    window.G.units.splice(window.G.units.indexOf(a), 1);
    const b = window.spawnUnit(own, key, sp.x, sp.y, 0);
    b.autoUp = false; tick();
    const saidNo = !b.up[uk];
    window.G.units.splice(window.G.units.indexOf(b), 1);
    const c = window.spawnUnit(own, key, sp.x, sp.y, 0);
    window.autoUpSet(false, true); tick();
    const off = !c.up[uk];
    window.autoUpSet(true, true);
    window.G.units.splice(window.G.units.indexOf(c), 1);
    window.select([], false); window.syncHud();
    return { key, brainRuns, autoFit, card: !!card, lit0, word, lit1, saidNo, off };
  });
  ok('classic: the setting fits a vehicle its upgrade on the tick, the card on the bar is its own word over it, and BY HAND fits nothing',
     !aup.brainRuns && aup.autoFit && aup.card && aup.lit0 && aup.word === false && !aup.lit1 && aup.saidNo && aup.off,
     `${aup.key}: brain on his slot ${aup.brainRuns}; AUTO fitted the roof MG ${aup.autoFit}; card ${aup.card} lit ${aup.lit0}, tapped -> ${aup.word} lit ${aup.lit1}; ` +
     `a vehicle that said no ${aup.saidNo ? 'kept its word' : 'was fitted anyway'}; BY HAND fitted nothing ${aup.off}`);
  /* and what the rows raised comes down again, because the rows below park a tank
     beside the headquarters on ground the post now stands on; the rest of the gate runs
     on classic on both devices, since the brain would otherwise be ordering the units
     the rows below stage */
  await page.evaluate(() => {
    const own = window.G.own, hadU = new Set(window.__preIds || []), hadB = new Set(window.__preBld || []);
    window.ctrlSet(false, true);
    window.G.units.forEach(q => { if (window.owned(q) && (q.building || q.repairing)) window.clearOrder(q); });
    window.G.units = window.G.units.filter(q => !(window.owned(q) && !hadU.has(q.id) && !q.inside && !q.gar));
    window.G.blds = window.G.blds.filter(b => !(b.own === own && !hadB.has(b.id)));
    window.G.blds.forEach(b => { if (b.own === own) { b.queue.length = 0; b.qt = 0; } });
    if (window.AIP[own]) { window.AIP[own].dir = null; }
    window.AIOP[own] = null; window.AIQ[own] = null;
    window.rebuildGrid(); window.select([], false);
  });
  await frames(page, 1);

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
             eye: M.eye.gi_rifle ? +M.eye.gi_rifle[window.POSE_STAND].toFixed(1) : null };
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
    /* across the player's own headquarters, along the row it stands in: square to the line
       the two armies face each other on, so both ends are in the open ground of his base
       area. Staged off the first building at a fixed bearing, on Saint-Lô the far end was
       off the bottom of the map with the observer beyond it, and nobody saw anything. */
    const b = window.hqOf(window.G.own), F0 = window.frontOf(window.G.side), a = Math.atan2(F0.y, F0.x) + Math.PI / 2, R = 190;
    function stage(withEyes) {
      window.G.units.length = 0; window.G.shots.length = 0;
      const u = window.spawnUnit(window.G.side, key, b.x - Math.cos(a) * R, b.y - Math.sin(a) * R, a);
      const e = window.spawnUnit(foe, foe === 'ger' ? 'hr_gren' : 'am_rifle',
                                 b.x + Math.cos(a) * R, b.y + Math.sin(a) * R, a + Math.PI);
      u.setup = 0;
      if (withEyes) {
        const o = window.spawnUnit(window.G.side, window.G.side === 'us' ? 'am_rifle' : 'hr_gren',
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
    /* where each of the eight shells lands is two rolls, a point in the circle and the gun's
       own scatter on top, and three of eight just past the circle comes up about one run in a
       hundred: the row is thrown with seeded rolls, as the burst rows are */
    const rand = Math.random;
    let seed = 2024;
    Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
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
    /* on the open ground of his base area, a hundred and fifty in front of his headquarters
       and along its row: at fixed coordinates, which were open on Ortona, the gun and the
       section stood in a Saint-Lô street with houses between them and nobody saw anybody */
    const U = window.UNITS[key], D = Math.round(Math.min(U.barrage.range / 2, U.sight - 60));
    const hq0 = window.hqOf(window.G.own), F1 = window.frontOf(window.G.side);
    const at1 = (al, fw) => window.nearestFree(hq0.x + F1.x * fw - F1.y * al, hq0.y + F1.y * fw + F1.x * al);
    const p0 = at1(-D / 2, 150), p1 = at1(D / 2, 150), fa = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const g = window.spawnUnit(window.G.side, key, p0.x, p0.y, fa);
    g.setup = 0;
    const B = g.def.barrage;
    const e = window.spawnUnit(foe, foe === 'ger' ? 'hr_gren' : 'am_rifle', p1.x, p1.y, fa + Math.PI);
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
    const h = window.spawnUnit(window.G.side, key, p0.x, p0.y, fa);
    h.setup = h.def.setup;
    window.orderBarrage(h, p1.x, p1.y);
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
    Math.random = rand;
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

  /* --- a crew-served weapon is in action or it is on the move, and getting from one to the
     other takes time both ways. The row walks a machine gun through the whole cycle on the
     game's own updateUnit: set up after spawning; ordered off, it stands and packs for the
     def's own clock with nothing leaving the barrel and the men still on the tripod; walks;
     halts and sets up again. Then the loophole the old timer had is asked for: a team on an
     attack-move that halts short of its path's end, which used to fire on the instant with
     the gun still on somebody's shoulder, has to set up first. And a towed gun's hitch has
     to wait on the crew taking it out of action. --- */
  const pk = await page.evaluate(() => {
    const side = window.G.side, foe = side === 'us' ? 'ger' : 'us';
    const key = side === 'us' ? 'am_mg' : 'hr_mg';
    const D = window.UNITS[key];
    if (!D || !D.pack) return { has: false };
    const keep = window.G.units.slice(), shots = window.G.shots.slice();
    window.G.units.length = 0; window.G.shots.length = 0;
    const sp = window.__o.flatSpot(160);
    const dt = 1 / 30;
    let fired = 0;
    const step = (units, n, fn) => {
      for (let i = 0; i < n; i++) {
        const ns = window.G.shots.length;
        units.forEach(u => window.updateUnit(u, dt));
        window.updateShots(dt); window.G.t += dt;
        if (window.G.shots.length > ns) fired++;
        if (fn) fn(i * dt);
      }
    };
    /* 1. the cycle, alone on open ground */
    const mg = window.spawnUnit(side, key, sp.x, sp.y, 0);
    const r = { has: true, key, setup: D.setup, pack: D.pack, spawnSetup: mg.setup, spawnPacked: !!mg.packed };
    step([mg], 30 * (D.setup + .5));
    r.inAction = !mg.packed && mg.setup <= 0 && window.gunSet(mg);
    window.orderMove(mg, sp.x, sp.y + 300, false);
    const x0 = mg.x, y0 = mg.y;
    let packEnd = -1, firstMove = -1, arrive = -1, setEnd = -1, maxPack = 0, gunDownWhilePacking = true;
    step([mg], 30 * 24, t => {
      if (mg.pack > maxPack) maxPack = mg.pack;
      if (mg.pack > 0 && !window.gunSet(mg)) gunDownWhilePacking = false;
      if (packEnd < 0 && mg.packed) packEnd = t;
      if (firstMove < 0 && Math.hypot(mg.x - x0, mg.y - y0) > 2) firstMove = t;
      if (arrive < 0 && firstMove >= 0 && !mg.path) arrive = t;
      if (setEnd < 0 && arrive >= 0 && mg.setup <= 0 && !mg.packed) setEnd = t;
    });
    Object.assign(r, { packEnd, firstMove, arrive, setEnd, maxPack, gunDownWhilePacking,
                       walked: Math.round(Math.hypot(mg.x - x0, mg.y - y0)), endInAction: !mg.packed && mg.setup <= 0 });
    /* 2. the loophole: an attack-move that halts on a target in reach sets up before it fires */
    window.G.units.length = 0;
    const am = window.spawnUnit(side, key, sp.x, sp.y, 0);
    am.setup = 0;
    step([am], 3);
    window.orderMove(am, sp.x, sp.y + 600, true);
    step([am], 30 * (D.pack + 2));
    const e = window.spawnUnit(foe, foe === 'ger' ? 'hr_gren' : 'am_rifle', am.x, am.y + Math.round(D.w.range * .6), Math.PI / 2);
    e.setup = 0;
    for (let k = 0; k < 400; k++) { window.computeVisibility(); if (side === 'us' ? e.vUs : e.vGer) break; }
    const seen = side === 'us' ? e.vUs : e.vGer;
    /* the section shoots back, so what is counted is the gun's own rounds and not the
       shot list, which the tracers of both sides go into */
    let haltedAt = -1, setupAtHalt = -1, firedAt = -1, packedAtHalt = null, own = 0;
    const realRec = window.recFired;
    window.recFired = function (u, n) { if (u === am) own += n; return realRec(u, n); };
    step([am, e], 30 * (D.setup + 6), t => {
      window.computeVisibility();
      if (haltedAt < 0 && !am.path && !am.moving) { haltedAt = t; setupAtHalt = am.setup; packedAtHalt = !!am.packed; }
      if (firedAt < 0 && own > 0) firedAt = t;
    });
    window.recFired = realRec;
    Object.assign(r, { seen: !!seen, haltedAt, setupAtHalt, packedAtHalt, firedAt, target: !!am.target });
    /* 3. the hitch: a gun in action packs behind the tow and the tow waits for it */
    window.G.units.length = 0; window.G.shots.length = 0;
    const gk = side === 'us' ? 'us_t8' : null, tk = side === 'us' ? 'am_m3' : null;
    if (gk && window.UNITS[gk] && window.UNITS[gk].pack) {
      const g = window.spawnUnit(side, gk, sp.x, sp.y, 0);
      g.setup = 0;
      const v = window.spawnUnit(side, tk, sp.x, sp.y - 150, Math.PI / 2);
      step([g, v], 3);
      v.order = 'hitch'; v.hitchT = g;
      let hitched = -1, moved = -1, hx = 0, hy = 0, packAtHitch = 0;
      step([g, v], 30 * (window.UNITS[gk].pack + 8), t => {
        if (hitched < 0 && g.towedBy) { hitched = t; hx = v.x; hy = v.y; packAtHitch = g.pack; window.orderMove(v, v.x, v.y + 400, false); }
        else if (hitched >= 0 && moved < 0 && Math.hypot(v.x - hx, v.y - hy) > 2) moved = t;
      });
      Object.assign(r, { hasTow: true, towPack: window.UNITS[gk].pack, hitched, towMoved: moved, packAtHitch, towedPacked: !!g.packed, towedGun: !!g.towedBy });
    } else r.hasTow = false;
    window.G.units.length = 0; keep.forEach(q => window.G.units.push(q));
    window.G.shots.length = 0; shots.forEach(q => window.G.shots.push(q));
    return r;
  });
  ok('a crew-served weapon packs before it moves and sets up before it fires',
     !pk.has || (pk.spawnSetup === pk.setup && !pk.spawnPacked && pk.inAction &&
                 Math.abs(pk.maxPack - pk.pack) < .05 && pk.packEnd >= pk.pack - .1 && pk.firstMove >= pk.packEnd - .1 &&
                 pk.gunDownWhilePacking && pk.arrive > pk.firstMove && pk.walked > 200 &&
                 pk.setEnd >= pk.arrive + pk.setup - .1 && pk.endInAction &&
                 pk.seen && pk.haltedAt >= 0 && pk.packedAtHalt && pk.firedAt >= 0 && pk.firedAt >= pk.haltedAt + pk.setup - .1 &&
                 (!pk.hasTow || (pk.hitched >= 0 && Math.abs(pk.packAtHitch - pk.towPack) < .05 && pk.towMoved >= pk.hitched + pk.towPack - .1 && pk.towedPacked && pk.towedGun))),
     !pk.has ? 'no packing weapon in this file'
             : `${pk.key}: set up ${pk.setup}s after spawning; ordered off it packed ${pk.maxPack.toFixed(1)}s (gun ${pk.gunDownWhilePacking ? 'down' : 'UP'} the while) and ` +
               `moved at ${pk.firstMove.toFixed(1)}s, walked ${pk.walked}, halted at ${pk.arrive.toFixed(1)}s and was in action at ${pk.setEnd.toFixed(1)}s; ` +
               `on an attack-move it halted ${pk.packedAtHalt ? 'packed' : 'IN ACTION'} on a section ${pk.seen ? 'in sight' : 'UNSEEN'} at ${pk.haltedAt.toFixed(1)}s ` +
               `and fired at ${pk.firedAt.toFixed(1)}s` +
               (pk.hasTow ? `; the tow hitched at ${pk.hitched.toFixed(1)}s and moved at ${pk.towMoved.toFixed(1)}s` : ''));

  /* --- an automatic cannon's damage is a BURST and not a shell, which is the one
     correction the two new 2 cm pieces needed. Everything else on this roster fires a
     single round a volley, so `dmg` is what that round does and every reader of it is
     right; a 2 cm volley is five rounds walked across a few paces and `dmg` says what the
     five of them do to men. The two readers that scale a ROUND's own effect off it are
     therefore wrong for it, and read the usual way a Flak 38 took a bay out of a terrace
     in fifteen seconds of fire and a Wirbelwind killed a Sherman by MISSING it, at thirty
     points a second of splash whatever the plate said.
       Both are asked as an A/B against the identical burst with the flag off, staged at
     the SAME point one after the other so that the cover, the ground and the geometry are
     the same by construction rather than by hope. And the men are the control: the rule is
     about stone and about plate, so what a burst does to a section may not move at all. --- */
  const bst = await page.evaluate(() => {
    const keep = window.G.units.slice(), shots = window.G.shots.slice(), t0 = window.G.t;
    window.G.units.length = 0; window.G.shots.length = 0;
    const sp = window.__o.flatSpot(200);
    const AUTO = { auto: 1 }, D = 48, R = 26, OFF = 14;
    /* the owner is one unit of the other side, well clear, so both halves of every A/B
       carry the same multipliers and neither is standing in its own burst */
    const own = window.spawnUnit('us', 'am_rifle', sp.x + 900, sp.y + 900, 0);
    const hull = () => {
      const v = window.spawnUnit('ger', 'hr_p4', sp.x, sp.y, 0);
      return v;
    };
    const blast = (w) => {
      const v = hull();
      for (let i = 0; i < 10; i++) window.explode(v.x + OFF, v.y, R, D, own, null, 10, w);
      const lost = v.def.hp - v.hp;
      v.dead = true; window.G.units.splice(window.G.units.indexOf(v), 1);
      return Math.round(lost);
    };
    const r = { autoHull: blast(AUTO), shellHull: blast(null) };
    /* the men, at the same point and with the same two bursts, and the same dice: whether a
       splinter finds a man is a roll, so each half is thrown with the same seeded rolls and
       the two have to agree to the point */
    const men = (w) => {
      const rand = Math.random;
      let seed = 2024;
      Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const s = window.spawnUnit('ger', 'hr_gren', sp.x, sp.y, 0);
      const full = s.models.reduce((a, m) => a + m.hp, 0);
      for (let i = 0; i < 10; i++) window.explode(s.x + OFF, s.y, R, D, own, null, 10, w);
      const lost = full - s.models.reduce((a, m) => a + (m.alive ? m.hp : 0), 0);
      s.dead = true; window.G.units.splice(window.G.units.indexOf(s), 1);
      Math.random = rand;
      return Math.round(lost);
    };
    r.autoMen = men(AUTO); r.shellMen = men(null);
    /* and the masonry, on a garden wall rather than a house: a wall's damage is one field
       and resetting it leaves the map where it was, where a terrace pulls its tile out of
       the merged scene on the first hit */
    const wl = window.G.walls.find(q => window.wallLen(q) > 60);
    if (wl) {
      const was = wl.gaps;
      const mid = { x: (wl.x1 + wl.x2) / 2, y: (wl.y1 + wl.y2) / 2 };
      /* driven through explode itself rather than through wallHit, because the clause under
         test lives in explode and a probe that reproduces the arithmetic cannot see it
         being wrong about the arithmetic */
      wl.gaps = null;
      for (let i = 0; i < 10; i++) window.explode(mid.x, mid.y, R, D, own, null, 10, AUTO);
      r.autoWall = Math.round((wl.gaps || []).reduce((a, g) => a + (g[1] - g[0]), 0));
      wl.gaps = null;
      for (let i = 0; i < 10; i++) window.explode(mid.x, mid.y, R, D, own, null, 10, null);
      r.shellWall = Math.round((wl.gaps || []).reduce((a, g) => a + (g[1] - g[0]), 0));
      wl.gaps = was; r.hasWall = true;
    } else r.hasWall = false;
    window.G.units.length = 0; keep.forEach(q => window.G.units.push(q));
    window.G.shots.length = 0; shots.forEach(q => window.G.shots.push(q));
    window.G.t = t0;
    window.rebuildGrid();
    return r;
  });
  ok('an automatic cannon\'s burst is not a shell: the plate and the stone know it and the men do not',
     bst.shellHull > 0 && bst.autoHull * 4 < bst.shellHull &&
     bst.shellMen > 0 && bst.autoMen === bst.shellMen &&
     (!bst.hasWall || (bst.shellWall > 0 && bst.autoWall === 0)),
     `ten identical bursts: a hull lost ${bst.autoHull} to the burst and ${bst.shellHull} to the shell; ` +
     `a section lost ${bst.autoMen} to both (shell ${bst.shellMen}); ` +
     (bst.hasWall ? `a garden wall lost ${bst.autoWall} units of run to the burst and ${bst.shellWall} to the shell`
                  : 'no wall long enough on this map'));

  /* --- and the three pieces themselves. A rack of tubes fires its ripple and is then
     reloaded by hand, which is the whole of what makes a projector a different weapon from
     a howitzer rather than a bigger one; an open turret takes the blast the men's branch of
     `explode` has always taken and the vehicle branch never did; a two-piece gun that can
     walk is laid on the bearing the crew set it down on, where `u.baseA` was written once
     at spawn and never again; and each of the three has a signature of its own, because
     `muzClass` read an automatic cannon as a machine gun and a rocket projector as a
     howitzer. --- */
  const ger = await page.evaluate(async () => {
    const keep = window.G.units.slice(), shots = window.G.shots.slice(), t0 = window.G.t;
    window.G.units.length = 0; window.G.shots.length = 0;
    const sp = window.__o.flatSpot(220), dt = 1 / 30;
    const r = {};
    const step = (units, n, fn) => {
      for (let i = 0; i < n; i++) {
        units.forEach(u => window.updateUnit(u, dt));
        window.updateShots(dt); window.G.t += dt;
        if (fn) fn(i * dt);
      }
    };
    /* 1. the ripple and the reload, counted off the gun's own rounds */
    const N = window.UNITS.ger_neb, nb = window.spawnUnit('ger', 'ger_neb', sp.x, sp.y, 0);
    nb.setup = 0; nb.packed = false;
    let own = 0;
    const realRec = window.recFired;
    window.recFired = function (u, n) { if (u === nb) own += n; return realRec(u, n); };
    const aim = { x: sp.x + Math.round(N.barrage.range * .5), y: sp.y };
    window.orderBarrage(nb, aim.x, aim.y);
    step([nb], 30 * 12);
    r.ripple = own; r.rounds = N.barrage.rounds; r.reload = N.reload;
    r.reloading = +nb.reload.toFixed(1);
    /* a fresh mission during the reload fires nothing at all */
    window.orderBarrage(nb, aim.x, aim.y);
    const before = own;
    step([nb], 30 * (N.reload - 14));
    r.duringReload = own - before;
    step([nb], 30 * 18);
    r.afterReload = own - before;
    window.recFired = realRec;
    /* 2. the open turret takes the blast, and a roof does not */
    window.G.units.length = 0;
    const foe = window.spawnUnit('us', 'am_rifle', sp.x + 900, sp.y + 900, 0);
    const hit = (k) => {
      const v = window.spawnUnit('ger', k, sp.x, sp.y, 0);
      /* radius 30 rather than 60: a crater is 0.34 of the burst against a floor of 11, so
         anything wider digs a hole at the flat spot and the next row's section lies in it.
         A prone section in a crater is a section nothing ever sees, which is a fault this
         file has already recorded once against a spotting drill. */
      window.explode(v.x + 10, v.y, 30, 120, foe, null, 10, null);
      const lost = v.def.hp - v.hp;
      v.dead = true; window.G.units.splice(window.G.units.indexOf(v), 1);
      return lost;
    };
    r.openTurret = +hit('hr_wirb').toFixed(1); r.roofed = +hit('hr_p4').toFixed(1);
    r.blastRes = window.UNITS.hr_wirb.blastRes;
    /* 3. a mount that walks is laid again where it stopped */
    window.G.units.length = 0;
    const fk = window.spawnUnit('ger', 'ger_flak20', sp.x, sp.y, 0);
    fk.setup = 0; fk.packed = false;
    r.baseA0 = +fk.baseA.toFixed(2);
    window.orderMove(fk, sp.x, sp.y + 320, false);
    step([fk], 30 * 40);
    r.baseA1 = +fk.baseA.toFixed(2); r.facing1 = +fk.facing.toFixed(2);
    r.walked = Math.round(Math.hypot(fk.x - sp.x, fk.y - sp.y));
    r.inAction = !fk.packed && fk.setup <= 0;
    /* 4. and each of the three sounds and looks like what it is, against a shoulder
       launcher, which is a rocket too (the Rangers' bazooka), an anti-tank gun and a
       machine gun */
    const cls = (k, at) => { const d = window.UNITS[k]; return window.muzClass({ cat: d.cat, def: d, side: d.side }, at ? d.at : d.w); };
    r.muz = { flak20: cls('ger_flak20'), wirb: cls('hr_wirb'), neb: cls('ger_neb'),
              zook: cls('am_ranger', 1), pak: cls('hr_pak'), mg34: cls('hr_mg') };
    window.G.units.length = 0; keep.forEach(q => window.G.units.push(q));
    window.G.shots.length = 0; shots.forEach(q => window.G.shots.push(q));
    window.G.t = t0;
    return r;
  });
  ok('the projector ripples and reloads, the open turret takes the blast, and the walking mount is laid again',
     ger.ripple === ger.rounds && ger.reloading > ger.reload * .5 &&
     ger.duringReload === 0 && ger.afterReload === ger.rounds &&
     ger.openTurret > ger.roofed * (ger.blastRes - .15) && ger.roofed > 0 &&
     ger.baseA1 !== ger.baseA0 && Math.abs(ger.baseA1 - ger.facing1) < .01 && ger.walked > 200 && ger.inAction &&
     ger.muz.flak20 === 'auto' && ger.muz.wirb === 'auto' && ger.muz.neb === 'werfer' &&
     ger.muz.zook === 'werfer' && ger.muz.pak === 'at' && ger.muz.mg34 === 'mg',
     `the Nebelwerfer put ${ger.ripple} of ${ger.rounds} rockets up and then reloaded for ${ger.reloading}s, ` +
     `firing ${ger.duringReload} during it and ${ger.afterReload} after; a 120-point burst took ` +
     `${ger.openTurret} off the open turret against ${ger.roofed} off the roofed hull beside it (blastRes ${ger.blastRes}); ` +
     `the Flak 38 walked ${ger.walked} and laid its platform on ${ger.baseA1} against ${ger.baseA0} at spawn; ` +
     `flash classes ${ger.muz.flak20}/${ger.muz.wirb}/${ger.muz.neb} against ${ger.muz.zook}, ${ger.muz.pak} and ${ger.muz.mg34}`);

  /* --- smoke. A tube throws it as a mission of its own, each round a cloud rather than a
     burst, and the cloud is a wall to the eye and to the gun until it thins: a section seen
     across open ground is lost behind it and a rifle cannot be laid through it, an indirect
     round still goes over it, and nobody under it is hurt. Bigger pieces throw bigger clouds
     that stand longer, and the card on the bar lays one the same way the fire mission is
     laid. Everything is put back afterwards. --- */
  const smk = await page.evaluate(() => {
    const side = window.G.side, foe = side === 'us' ? 'ger' : 'us';
    const mk = side === 'us' ? 'us_mor' : 'ger_mor', hk = side === 'us' ? 'us_how' : 'ger_how', bk = side === 'us' ? 'am_240' : 'ger_how210';
    const S = k => window.smokeOf(window.UNITS[k]);
    if (!S(mk)) return { has: false };
    const sizes = { mor: S(mk), how: S(hk), bat: S(bk) };
    const keep = window.G.units.slice(), shots = window.G.shots.slice(), sm0 = window.G.smoke.slice(), sel0 = window.G.sel.slice();
    window.G.units.length = 0; window.G.shots.length = 0; window.G.smoke.length = 0;
    const sp = window.__o.flatSpot(220), nf = (x, y) => window.nearestFree(x, y);
    const p0 = nf(sp.x, sp.y), p1 = nf(sp.x + 240, sp.y), p2 = nf(sp.x - 120, sp.y + 60), p3 = nf(sp.x - 120, sp.y - 60);
    const eye = window.spawnUnit(side, side === 'us' ? 'am_rifle' : 'hr_gren', p0.x, p0.y, 0); eye.setup = 0;
    const foeU = window.spawnUnit(foe, foe === 'ger' ? 'hr_gren' : 'am_rifle', p1.x, p1.y, Math.PI);
    const m = window.spawnUnit(side, mk, p2.x, p2.y, 0); m.setup = 0; m.packed = false;
    const hp0 = foeU.models.map(q => q.hp);
    let seen = false;
    for (let k = 0; k < 400 && !seen; k++) { window.computeVisibility(); seen = !!(side === 'us' ? foeU.vUs : foeU.vGer); }
    const gz = (x, y) => window.groundZ(x, y);
    const line = () => window.traceClear(eye.x, eye.y, gz(eye.x, eye.y) + 17, foeU.x, foeU.y, gz(foeU.x, foeU.y) + 12, window.sblk);
    const before = { line: line(), fire: window.fireLine(eye, foeU), seen };
    const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
    const laid = window.orderBarrage(m, mx, my, true);
    const rounds = m.barrage ? m.barrage.left : -1, isSmoke = !!(m.barrage && m.barrage.smoke);
    let t = 0;
    /* once the mission is spent the tube is held, because the section is in sight and in its
       reach, and a round of its own laid on it while the last cloud was still in the air put
       HE on the men the row says nobody hurt (on one phone run, 2.2 s longer than the rest) */
    for (let f = 0; f < 60 * 30 && (m.barrage || window.G.shots.length); f++) {
      if (!m.barrage) m.cd = 1e9;
      window.updateUnit(m, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60; t += 1 / 60;
    }
    const clouds = window.G.smoke.length, inZone = window.G.smoke.filter(c => Math.hypot(c.x - mx, c.y - my) <= m.def.barrage.r + 14).length;
    const hurt = foeU.models.some((q, i) => q.hp !== hp0[i]) || window.aliveModels(foeU) !== foeU.models.length;
    const during = { line: line(), fire: window.fireLine(eye, foeU) };
    let lost = -1;
    for (let k = 0; k < 200 && lost < 0; k++) { window.computeVisibility(); if (!(side === 'us' ? foeU.vUs : foeU.vGer)) lost = k; }
    /* an indirect round goes over it: a second tube laid on the section beyond the screen fires */
    const m2 = window.spawnUnit(side, mk, p3.x, p3.y, 0); m2.setup = 0; m2.packed = false;
    const laid2 = window.orderBarrage(m2, foeU.x, foeU.y);
    let fired2 = 0;
    for (let f = 0; f < 60 * 12; f++) { const n = window.G.shots.length; window.updateUnit(m2, 1 / 60); window.updateShots(1 / 60); window.G.t += 1 / 60; if (window.G.shots.length > n) fired2++; }
    /* the clouds thin and go, and the line is back */
    window.G.smoke.forEach(c => { c.t = c.dur + 1; });
    window.updateShots(1 / 60);
    const after = { clouds: window.G.smoke.length, line: line() };
    /* the card: with the tube picked the bar offers a smoke mission, and it lays one */
    window.select([m], false); window.syncHud();
    const card = Array.from(document.querySelectorAll('#cmds .cmd')).find(b => /Smoke mission/i.test(b.textContent));
    if (card) card.click();
    const mode = window.G.mode;
    m.barrage = null;
    window.callBarrage(mx, my, window.G.mode === 'smoke'); window.G.mode = null;
    const cardLaid = !!(m.barrage && m.barrage.smoke);
    m.barrage = null; m2.barrage = null;
    window.G.units.length = 0; keep.forEach(q => window.G.units.push(q));
    window.G.shots.length = 0; shots.forEach(q => window.G.shots.push(q));
    window.G.smoke.length = 0; sm0.forEach(q => window.G.smoke.push(q));
    window.select(sel0, false); window.syncHud();
    return { has: true, mk, sizes, before, laid, rounds, isSmoke, t: +t.toFixed(1), clouds, inZone, hurt, during, lost, laid2, fired2, after, card: !!card, mode, cardLaid };
  });
  ok('a smoke mission lays clouds that stop the eye and the gun and hurt nobody, an indirect round still goes over, and the bigger the piece the bigger and longer the cloud',
     !smk.has || (smk.before.line && smk.before.fire && smk.before.seen && smk.laid && smk.isSmoke && smk.rounds === smk.sizes.mor.rounds &&
                  smk.clouds >= smk.rounds - 1 && smk.inZone === smk.clouds && !smk.hurt && !smk.during.line && !smk.during.fire && smk.lost >= 0 &&
                  smk.laid2 && smk.fired2 > 0 && smk.after.clouds === 0 && smk.after.line &&
                  smk.sizes.mor.r < smk.sizes.how.r && smk.sizes.how.r < smk.sizes.bat.r && smk.sizes.mor.dur < smk.sizes.how.dur && smk.sizes.how.dur < smk.sizes.bat.dur &&
                  smk.card && smk.mode === 'smoke' && smk.cardLaid),
     !smk.has ? 'no tube in this file'
              : `${smk.mk}: seen ${smk.before.seen}, line ${smk.before.line}, fire line ${smk.before.fire} before; ${smk.rounds} smoke rounds laid ${smk.laid}, ` +
                `${smk.clouds} clouds in ${smk.t}s (${smk.inZone} inside the zone), hurt ${smk.hurt}; line ${smk.during.line}, fire line ${smk.during.fire}, ` +
                `lost after ${smk.lost} vision ticks; a mission over it fired ${smk.fired2}; thinned: ${smk.after.clouds} clouds, line ${smk.after.line}; ` +
                `mortar ${smk.sizes.mor.r}/${smk.sizes.mor.dur.toFixed(0)}s, howitzer ${smk.sizes.how.r}/${smk.sizes.how.dur.toFixed(0)}s, battery ${smk.sizes.bat.r}/${smk.sizes.bat.dur.toFixed(0)}s; ` +
                `card ${smk.card} -> mode ${smk.mode}, laid ${smk.cardLaid}`);

  /* --- the heavy battery, which is four rules rather than a weapon. It is dug as a field
     work and not queued, it may not be dug near its own headquarters, it will not fire
     into the enemy's base, and it takes the best part of a minute to come round onto a
     bearing behind it. Each of those is a refusal, and a refusal that has quietly stopped
     working looks exactly like one that never fires. --- */
  const bat = await page.evaluate(() => {
    const side = window.G.side, kind = side === 'us' ? 'how240' : 'how210';
    const W = window.WORKS[kind];
    if (!W || !W.minHq) return { has: false };
    const keep = window.G.units.slice(), shots = window.G.shots.slice();
    /* and the sky cleared, because the row counts every shell that lands while it runs and a
       round the battle left in the air was one more of its five */
    window.G.shots.length = 0;
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
       can reach it. Dug on the first legal patch the American 240 is 1275 from a point 300
       short of the German headquarters and its reach is 1350, so from there `safe` is what
       answers; the eight-inch before it reached 1250 and was out of range there, which
       asked neither rule. `homeReach` records it; the gun is then stood forward for the
       question itself and put back, so every battery is asked the same thing. The control is the same range on a bearing with
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
    /* a mission behind the gun, so the whole of the traverse has to be paid for. A piece
       whose top carriage turns on its trails (`carr`) is laid across that arc for next to
       nothing and pays the trails' rate for the rest of the half turn. */
    const tx = g.x - Math.cos(g.facing) * 700, ty = g.y - Math.sin(g.facing) * 700;
    const laid = window.orderBarrage(g, tx, ty);
    const slew = (Math.PI - (g.def.carr || 0) - (g.def.layTol || .35)) / g.def.traverse;
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

  /* --- and the 240 rebuilt as Little David, the 36-inch mortar, which is another piece
     altogether and the player's decision alone: nothing offers him AUTO for it and the brain's
     own routine never fits it; fitted by hand it costs its price, draws as the mortar, carries
     the mortar's weapon and reach, puts the crew where the mortar is served from and leaves the
     240's own def as it was, and then it waits out the change-over before three rounds go into
     its circle. The rounds are taken off the list as they leave the tube, because a ton and
     three quarters of shell digs a hole seventy units in radius and the rows below stage on the
     ground this one would leave. --- */
  const dav = await page.evaluate(() => {
    const W = window, U = W.UNITS.am_240, D = U && U.defUp && U.defUp.david;
    if (!D) return { has: false };
    const keep = W.G.units.slice(), shots = W.G.shots.slice(), mp = W.G.res.us.mp, fu = W.G.res.us.fu;
    const sp = W.__o.flatSpot(160), p = W.nearestFree(sp.x, sp.y);
    const g = W.spawnUnit('us', 'am_240', p.x, p.y, 0); g.setup = 0;
    const before = { piece: W.gmKey(g), reach: Math.round(W.barrageRange(g)), auto: W.autoFits(g), up: W.upgradable(g) };
    W.G.res.us.mp = 9000; W.G.res.us.fu = 9000;
    const autoGot = W.buyUpgradeAuto('us', [g], { floor: 0 }), autoFitted = !!g.up.david;
    const mp0 = W.G.res.us.mp, fu0 = W.G.res.us.fu;
    W.pay('us', W.UPGRADES.david.cost); W.fitUp(g, 'david');
    const k = W.gmKey(g);
    const after = { piece: k, built: !!(W.MODELS.gun[k] && W.MODELS.gunBase[k] && W.MODELS.gunRec[k]),
                    cost: [mp0 - W.G.res.us.mp, fu0 - W.G.res.us.fu], name: W.nameOf(g), reach: Math.round(W.barrageRange(g)),
                    dmg: W.mainW(g).dmg, aoe: W.mainW(g).aoe, setup: g.setup,
                    lay: g.models.every((m, i) => !D.lay[i] || (m.ox === D.lay[i][0] && m.oy === D.lay[i][1])),
                    base: U.w.dmg, baseKey: W.gmKey({ def: U, key: 'am_240' }) };
    /* a mission on clear ground six hundred off, on a bearing the no-fire zone leaves alone */
    let bear = null, tx = 0, ty = 0;
    for (let a = 0; a < Math.PI * 2 && bear === null; a += .2) {
      const x = g.x + Math.cos(a) * 600, y = g.y + Math.sin(a) * 600;
      if (x < 60 || y < 60 || x > W.WORLD.w - 60 || y > W.WORLD.h - 60) continue;
      if (W.barrageWhy(g, x, y) === null) { bear = a; tx = x; ty = y; }
    }
    let laid = false, first = -1, t = 0;
    const out = [];
    if (bear !== null) {
      g.facing = g.baseA = bear;
      laid = !!W.orderBarrage(g, tx, ty);
      for (let f = 0; f < 60 * 170 && out.length < D.barrage.rounds; f++) {
        const n0 = W.G.shots.length;
        W.updateUnit(g, 1 / 60); W.G.t += 1 / 60; t += 1 / 60;
        for (let i = W.G.shots.length - 1; i >= n0; i--) {
          const sh = W.G.shots[i];
          if (sh.kind === 'shell') { out.push(Math.hypot(sh.tx - tx, sh.ty - ty)); if (first < 0) first = t; }
          W.G.shots.splice(i, 1);
        }
      }
    }
    W.G.units.length = 0; keep.forEach(q => W.G.units.push(q));
    W.G.shots.length = 0; shots.forEach(q => W.G.shots.push(q));
    W.G.res.us.mp = mp; W.G.res.us.fu = fu;
    const bound = D.barrage.r + D.barrage.sp * 1.6;
    return { has: true, before, autoGot: !!autoGot, autoFitted, after, want: [W.UPGRADES.david.cost.mp || 0, W.UPGRADES.david.cost.fu || 0],
             D: { dmg: D.w.dmg, aoe: D.w.aoe, setup: D.setup, rounds: D.barrage.rounds, piece: D.piece }, bear: bear !== null, laid,
             first: +first.toFixed(1), rounds: out.length, inBound: out.filter(d => d <= bound).length, bound: Math.round(bound) };
  });
  ok('the 240 is rebuilt as Little David by hand and by nothing else, and becomes the mortar whole',
     !dav.has || (dav.before.piece === 'am_240' && dav.before.up && !dav.before.auto && !dav.autoGot && !dav.autoFitted &&
                  dav.after.cost[0] === dav.want[0] && dav.after.cost[1] === dav.want[1] &&
                  dav.after.piece === dav.D.piece && dav.after.built && /Little David/.test(dav.after.name) &&
                  dav.after.reach < dav.before.reach && dav.after.dmg === dav.D.dmg && dav.after.aoe === dav.D.aoe &&
                  dav.after.setup === dav.D.setup && dav.after.lay && dav.after.base !== dav.D.dmg && dav.after.baseKey === 'am_240' &&
                  dav.bear && dav.laid && dav.first >= dav.D.setup * .95 && dav.rounds === dav.D.rounds && dav.inBound === dav.rounds),
     !dav.has ? 'no Little David in this file'
              : `AUTO offered ${dav.before.auto ? 'YES' : 'no'}, the routine fitted it ${dav.autoGot || dav.autoFitted ? 'YES' : 'no'}; ` +
                `by hand for ${dav.after.cost.join('/')} of ${dav.want.join('/')}: drawn as ${dav.after.piece} (buffers ${dav.after.built}), ` +
                `"${dav.after.name}", reach ${dav.before.reach} to ${dav.after.reach}, a round of ${dav.after.dmg} over ${dav.after.aoe}, ` +
                `crew laid ${dav.after.lay}, the 240 itself still ${dav.after.base} as ${dav.after.baseKey}; ` +
                `change-over ${dav.after.setup}s and the first round at ${dav.first}s, ${dav.rounds} of ${dav.D.rounds} rounds, ` +
                `${dav.inBound} inside ${dav.bound}`);

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
    const key = window.G.side === 'us' ? 'am_sher' : 'ger_kt';
    const hq = window.G.blds.find(b => b.side === window.G.side && b.def.hq);
    /* On ground it can drive off ALONG ITS OWN FACING, which is what the throttle asks
       for: `povDrive` puts a waypoint 320 units up the hull's nose and nothing else, so a
       tank staged square to a wall drives into the wall and the row measures the wall.
       And after four minutes of battle the ground round the headquarters is his own army,
       so what the drill wants is a CORRIDOR rather than a spot -- the same fault
       `nearestFree` has been caught with before. Staged on a spot it read 11 units of
       ground in three seconds on one run and 33 on the next, on identical code. */
    const hx = hq ? hq.x : 300, hy = hq ? hq.y : 950;
    /* The run is asked along three lines, the middle and a line either side a little
       outside the hull's own beam, because the hull is two and a half metres across and a
       line down its middle is not. Asked along the middle alone, one desktop run ended the
       drive 1.65 radians off the bearing it was parked on with 47 units made and nothing in
       front of it. The likeliest reading, not established, is a corner catching the hull's
       side in the first second: a blocked step swings a hull, and the throttle's waypoint
       swings with the nose. */
    const clearRun = (x, y, a) => {
      const sx = -Math.sin(a), sy = Math.cos(a);
      for (let d = 30; d <= 300; d += 20) {
        for (const o of [-20, 0, 20]) {
          const px = x + Math.cos(a) * d + sx * o, py = y + Math.sin(a) * d + sy * o;
          if (!window.walkable(px, py) || window.blockAt(px, py)) return false;
          if (window.buildingAt(px, py) || window.bunkerAt(px, py)) return false;
        }
        if (window.unitsAt(x + Math.cos(a) * d, y + Math.sin(a) * d, 42).length) return false;
      }
      return true;
    };
    let sp = null, face = 0;
    for (const r of [150, 260, 380, 500]) {
      for (let k = 0; k < 12 && !sp; k++) {
        const c = window.nearestFree(hx + Math.cos(k * Math.PI / 6) * r, hy + Math.sin(k * Math.PI / 6) * r);
        if (window.unitsAt(c.x, c.y, 50).length) continue;
        for (let j = 0; j < 16; j++) {
          const a = j * Math.PI / 8;
          if (clearRun(c.x, c.y, a)) { sp = c; face = a; break; }
        }
      }
      if (sp) break;
    }
    const staged = !!sp;
    if (!sp) sp = window.nearestFree(hx + 150, hy + 80);
    const u = window.spawnUnit(window.G.side, key, sp.x, sp.y, face);   /* spawnUnit adds it to the field itself */
    u.hp = u.maxhp = 9e5;                                            /* it has a minute of tests to survive */
    /* and it is not to be pinned by whoever is shelling the base by now: a hull over
       full suppression cannot turn (`povDrive` zeroes the turn), and the driving row is
       about the pad and not about how the battle above happened to end up. Nor is it to
       lose a track to it: a track hit sets `immob` for five to nine seconds, which zeroes
       the turn the same way, and cleared only at the top of each leg a hit inside the
       steer leg read 0.04 radians on a phone run and 0.9 on the next, on the same code */
    const pd = window.povDrive;
    window.__povDrive0 = pd;
    window.povDrive = function (v, dt) { if (v === u) { v.sup = 0; v.shaken = 0; v.immob = 0; } return pd(v, dt); };
    window.select([u], false);
    document.getElementById('tPov').click();
    const I = window.VMODEL[key].inside, hatchBtn = document.getElementById('tHatch');
    const out = { key, staged, closed: !!(I && I.closed), hatchShown: !hatchBtn.classList.contains('hidden'), pieces: window.MODELS.veh[key].inside.n };
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
  /* Driving and turning are measured one at a time, because a TRACKED hull does one or
     the other: its speed falls away with the heading error and is gone by the time the
     error is a right angle, so full throttle against a near-full steer is a pivot. Read
     together they swung between 202 units of ground with 1.4 radians of turn and 29 units
     with 8 radians, on the same code, and the row passed or failed on where the tank
     happened to be pointing when it started. */
  /* The tank is parked by its own headquarters while a battle runs, and a hull that is
     being shot at does not answer its own controls: povDrive zeroes the turn outright at
     a suppression over 1 and eases it off below that. The periscope block already gives
     this tank a hundred thousand hit points for the same reason -- what the row is about
     is the pad, not what the opposition is doing to it -- so it is unpinned before each
     leg. Without it the steer leg came back at 0.22 radians of three seconds on a phone
     run and 1.61 on the desktop beside it, on the same code. */
  const unpin = () => page.evaluate(() => { const u = window.POV.u; if (u) { u.sup = 0; u.immob = 0; u.shaken = 0; } });
  await page.evaluate(() => { window.DRV.padT = 1; window.DRV.padS = 0; });
  await unpin();
  await fastForward(page, 3);
  const drvA = await page.evaluate(([x, y, f0]) => {
    const u = window.POV.u;
    /* and what stopped it, if something did: the pace it ended at, how far it swung off the
       bearing it was parked on, and the nearest thing standing in front of it */
    let near = '', nd = 1e9;
    for (const o of window.G.units) {
      if (o === u || o.dead) continue;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d < 90 && d < nd && Math.cos(Math.atan2(o.y - u.y, o.x - u.x) - u.facing) > .3) { nd = d; near = o.key + '@' + Math.round(d); }
    }
    const ax = u.x + Math.cos(u.facing) * 40, ay = u.y + Math.sin(u.facing) * 40;
    return { moved: +Math.hypot(u.x - x, u.y - y).toFixed(1), took: window.DRV.took, f: u.facing,
             sp: +(u.sp || 0).toFixed(1), swung: +Math.abs(window.angDiff(u.facing, f0)).toFixed(2), near: near || 'nothing',
             ahead: window.walkable(ax, ay) && !window.blockAt(ax, ay) && !window.buildingAt(ax, ay) ? 'open' : 'blocked',
             up: Object.keys(u.up || {}).filter(k => u.up[k]).join(',') || 'none' };
  }, [drv0.x, drv0.y, drv0.facing]);
  /* And the steer leg starts where the drive leg did, on the heading the drive left it on.
     The drive takes the tank a hundred and eighty units or more along whatever bearing it
     was parked on, which is most of the clear going the staging asked for, and on one phone
     run the steer that followed turned 0.14 radians of three seconds against 0.42 and 1.77
     on the runs either side of it on the same file: a hull pressed against whatever ended
     its drive. The aim row below puts it back for the same reason. */
  await page.evaluate(([x, y, f]) => {
    const u = window.POV.u;
    u.x = x; u.y = y; u.facing = f; u.turret = f; u.dest = null; u.path = null; u.sp = 0; u._matT = null;
  }, [drv0.x, drv0.y, drvA.f]);
  await page.evaluate(() => { window.DRV.padT = .35; window.DRV.padS = 1; });
  await unpin();
  await fastForward(page, 3);
  const drv2 = await page.evaluate(([f]) => {
    const u = window.POV.u;
    return { turned: +Math.abs(window.angDiff(u.facing, f)).toFixed(2), x: u.x, y: u.y };
  }, [drvA.f]);
  drv2.moved = drvA.moved; drv2.took = drvA.took; drv2.why = drvA;
  await page.evaluate(() => { window.DRV.padT = 0; window.DRV.padS = 0; });
  await fastForward(page, 3);
  const drv3 = await page.evaluate(([x, y]) => {
    const u = window.POV.u;
    if (window.__povDrive0) { window.povDrive = window.__povDrive0; window.__povDrive0 = null; }
    return { crept: +Math.hypot(u.x - x, u.y - y).toFixed(1), sp: +(u.sp || 0).toFixed(1) };
  }, [drv2.x, drv2.y]);
  /* --- and he shoots with it: a round goes where he points, target or no target --- */
  /* Where the drive test left the tank decides whether anything straight ahead can be shot
     at at all: stopped facing a house across a lane, the look meets the wall inside the
     24-unit back-off, there is no mark on any frame, and the row failed twice on one file
     that passed it on the run between. So he turns his head until there is something to
     lay on, which is what a commander does, and the burst goes where he is looking. A clear
     patch of ground is looked for first: a mark has already passed `fireLine`, where a lock
     is taken up to four per cent past the gun's reach so that the sight can say OUT OF RANGE,
     and is refused by the gun for that and for a wall in the way. Accepting the first lock,
     the row locked onto somebody the gun could not reach and put nothing in the street. */
  /* And he raises his eye if looking down finds nothing. The row failed on one phone run with
     no mark on any of the ten bearings and the same file passing it on the run before. By this
     row three battles have been fought round the headquarters the tank is parked by, and the
     likeliest reading is a hull in a shell hole looking 0.22 radians down into the rim, which
     `povGround` meets inside its 44-unit floor; a level look over the rim ends at the gun's
     reach. The message says how the ground round the tank stands, so a failure says which. */
  /* And he is put back where the drive began, turned toward the middle of the map. The drive
     test takes the tank two hundred units along whatever bearing it was parked on, and on one
     phone run that was west, to x 24: the edge of the map, where ten bearings at three pitches
     found nothing to lay on and nothing left the barrel. The message printed the tank's place,
     which is how that was known. */
  await page.evaluate(([x, y]) => {
    const u = window.POV.u, W = window;
    u.x = x; u.y = y; u.dest = null; u.path = null; u.sp = 0; u._matT = null;
    u.facing = Math.atan2(W.WORLD.h / 2 - y, W.WORLD.w / 2 - x); u.turret = u.facing;
  }, [drv0.x, drv0.y]);
  await fastForward(page, .5);
  const bearings = [0, .5, -.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI];
  let laid = false;
  for (const want of ['mark', 'any']) {
    for (const pitch of [-.22, -.08, 0]) {
      for (const dy of bearings) {
        await page.evaluate(([d, p]) => { window.POV.yaw = window.POV.u.facing + d; window.POV.pitch = p; }, [dy, pitch]);
        await fastForward(page, .2);
        laid = await page.evaluate(w => { const D = window.DRV; return w === 'mark' ? !!D.mark && !D.lock : !!(D.mark || D.lock); }, want);
        if (laid) break;
      }
      if (laid) break;
    }
    if (laid) break;
  }
  /* what the ground round the tank is doing, for the message if it fails */
  const lie = await page.evaluate(() => {
    const u = window.POV.u, gz = window.groundZ(u.x, u.y);
    let rim = 0;
    for (let k = 0; k < 8; k++) rim += window.groundZ(u.x + Math.cos(k * Math.PI / 4) * 60, u.y + Math.sin(k * Math.PI / 4) * 60) - gz;
    return { x: Math.round(u.x), y: Math.round(u.y), rim: +(rim / 8).toFixed(1), gun: u.gunDmg > 0 };
  });
  const shot = await page.evaluate(() => {
    window.__booms = 0;
    const ex = window.explode;
    window.explode = function (x, y, r, d, o, e) { window.__booms++; return ex(x, y, r, d, o, e); };
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
     (aim.mark ? ', laid on ' + aim.how : ', but nothing under the crosshair at any point, with the tank at ' +
      lie.x + ',' + lie.y + ', the ground 60 out standing ' + lie.rim + ' over it on average' + (lie.gun ? ' and its gun OUT' : '')));

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
     tank.staged && drv0.shown && drv0.padOk && drv0.fireOk && drv0.clear && drv2.moved > 60 && drv2.turned > .35 && drv2.took === 1 && drv3.sp < 1,
     tank.staged ? `drove ${drv2.moved} straight in three seconds, then turned ${drv2.turned} rad on the steer, then stopped` +
       (drv2.moved > 60 ? '' : ` (the drive ended at ${drv2.why.sp} a second, ${drv2.why.swung} rad off its bearing, the ground 40 ahead ${drv2.why.ahead}, in front of it ${drv2.why.near}, fitted ${drv2.why.up})`)
                 : 'nowhere round the headquarters with 300 units of clear going in front of it');

  const tankOff = await page.evaluate(() => { window.povOff(); return !window.POV.on && document.getElementById('tHatch').classList.contains('hidden') && !document.getElementById('drive').classList.contains('on') && !window.POV.u; });
  ok('periscope sits in the tank commander\'s cupola, lid up or shut', tank.closed && tank.hatchShown && tank.pieces > 100 && tank.dropped > 3 && tank.above > 20 && tankOff, `${tank.key}: ${tank.pieces} inside triangles, the eye drops ${tank.dropped} when the lid shuts`);

  /* --- the minimap and the tactical map --- */
  await page.click('#tMap');
  await frames(page, 1);
  const mapOpen = await page.evaluate(() => document.getElementById('mini').classList.contains('big')
                                         || document.getElementById('mini').getBoundingClientRect().width > 260);
  ok('tactical map expands', mapOpen);
  await page.click('#tMap').catch(() => {});

  /* --- the brain's second layer of inputs, staged rather than sampled: a body massing
     against a held flag read off contacts that carry a heading, a tube heard rather than
     seen, the exchange and the clock, and a wave that breaks off once it has been fed into
     a defended flag. Each is asked of the function the brain reads it from, on the
     player's side, whose brain is not running under classic and so moves nothing under
     the row; the break-off is asked of the opposition's own plan through one tick of its
     own brain. --- */
  const intent = await page.evaluate(() => {
    const D2 = window.DIFF[2], hq = window.hqOf('us'), M = window.aiMemOf('us'), W0 = window.WORLD;
    const cl = (x, y) => [window.clamp(x, 60, W0.w - 60), window.clamp(y, 60, W0.h - 60)];
    const spawned = [];
    const put = (own, key, x, y) => { const [px, py] = cl(x, y), sp = window.nearestFree(px, py); const u = window.spawnUnit(own, key, sp.x, sp.y, 0); spawned.push(u); return u; };
    /* a flag of his, taken for the drill if the battle has taken it, and no flag but that
       one for the clock's arithmetic */
    const secs = window.G.sectors.slice().sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y));
    const owners = window.G.sectors.map(x => [x.owner, x.conn, x.contest]);
    const S = secs[1]; S.owner = 'us'; S.conn = true; S.contest = false;
    /* the picture has to be the drill's: three battles have been fought on this map by now
       and the side's memory holds whatever it saw in them, so the contacts are put aside
       and every enemy of the battle's own is hidden until the drill comes down */
    const con0 = M.con, n0 = M.n, exK0 = M.exK, exL0 = M.exL, lost0 = M.lost, hid = [];
    M.con = {}; M.n = 0; M.lost = {};
    for (const e of window.G.units) if (!e.dead && e.side === 'ger') { hid.push([e, e.vUs]); e.vUs = false; }
    /* --- three enemy sections seven hundred out, seen, walking at it: four looks a second
       apart give the memory a heading (it is smoothed, and one look reads two fifths of the
       true pace), and the picture reads a body massing onto the flag */
    /* on the far side of it from home, or the nearest bearing to that which keeps seven
       hundred units of ground inside the map: this flag stands four hundred from the
       bottom edge, and clamped to it the body started 468 from the flag and its arrival
       read 4.1 seconds, on the row's own floor */
    const ang0 = Math.atan2(S.y - hq.y, S.x - hq.x);
    let ang = ang0;
    for (let q = 0; q < 16; q++) {
      const a = ang0 + Math.ceil(q / 2) * Math.PI / 8 * (q % 2 ? 1 : -1);
      const px = S.x + Math.cos(a) * 700, py = S.y + Math.sin(a) * 700;
      if (px > 100 && px < W0.w - 100 && py > 100 && py < W0.h - 100) { ang = a; break; }
    }
    const foes = [];
    for (let i = 0; i < 3; i++) {
      const e = put('ger', 'hr_gren', S.x + Math.cos(ang) * 700 + Math.cos(ang + Math.PI / 2) * (i - 1) * 60,
                    S.y + Math.sin(ang) * 700 + Math.sin(ang + Math.PI / 2) * (i - 1) * 60);
      e.vUs = true; foes.push(e);
    }
    const t0 = window.G.t;
    window.aiRemember('us', t0);
    let W = null;
    for (let k = 1; k <= 4; k++) {
      for (const e of foes) { e.x -= Math.cos(ang) * 60; e.y -= Math.sin(ang) * 60; for (const m of e.models) { m.x -= Math.cos(ang) * 60; m.y -= Math.sin(ang) * 60; } }
      window.G.t = t0 + k;
      W = window.aiLook('us', D2, 2);
    }
    const c0 = M.con[foes[0].id], R = W.bySec[S.id], mass = W.mass;
    const out = { headed: c0 ? +Math.hypot(c0.vx, c0.vy).toFixed(0) : -1, mass: !!mass, massSec: mass ? mass.sec : null, secId: S.id,
                  dist: Math.round(Math.hypot(foes[0].x - S.x, foes[0].y - S.y)),
                  massW: mass ? Math.round(mass.w) : 0, eta: mass ? +mass.eta.toFixed(1) : -1, coming: Math.round(R.coming), pinned: +R.pinned.toFixed(2) };
    /* --- the exchange: kills lift it and losses sink it */
    M.exK = 0; M.exL = 0;
    window.aiKill('us', 600); W = window.aiLook('us', D2, 2); out.exWin = +W.exch.toFixed(2);
    window.aiLoss('us', hq.x, hq.y, 2400); W = window.aiLook('us', D2, 2); out.exLose = +W.exch.toFixed(2);
    M.exK = 0; M.exL = 0;
    /* --- the clock: one victory flag of theirs drains his points and nothing drains
       theirs; two of his, the other way about */
    const vps = window.G.sectors.filter(x => x.type === 'vp');
    for (const x of window.G.sectors) { x.owner = null; x.conn = false; }
    vps[0].owner = 'ger'; vps[0].conn = true;
    const k1 = window.aiClock('us'), bleed = window.diffOf('ger').vp;
    out.clock1 = { me: +k1.me.toFixed(1), him: k1.him, want: +(window.vpOf('us') / (.8 * bleed)).toFixed(1) };
    vps[0].owner = 'us'; vps[1].owner = 'us'; vps[1].conn = true;
    const k2 = window.aiClock('us');
    out.clock2 = { me: k2.me, him: +k2.him.toFixed(1), want: +(window.vpOf('ger') / (2 * .8)).toFixed(1) };
    window.G.sectors.forEach((x, i) => { x.owner = owners[i][0]; x.conn = owners[i][1]; x.contest = owners[i][2]; });
    S.owner = 'us'; S.conn = true; S.contest = false;
    /* --- a tube heard rather than seen: a mortar out of sight shells a section of his
       five times, and the memory has it to within a few dozen units, flagged, known, and
       worth a task force; his own tube then lays on it */
    const mor = put('ger', 'ger_mor', hq.x + 1100, hq.y + 60); mor.vUs = false;
    const tgt = put('us', 'am_rifle', hq.x + 200, hq.y + 120);
    for (let i = 0; i < 8; i++) put('us', 'am_rifle', hq.x + 120 + i * 40, hq.y - 160 + (i % 3) * 60);
    window.damage(tgt, .5, mor);
    const c1 = M.con[mor.id];
    const heard = { first: c1 ? c1.err : -1, flag: c1 ? c1.heard : -1, ind: tgt.hurtInd };
    for (let k = 0; k < 4; k++) { c1.t -= 2; window.damage(tgt, .5, mor); }
    heard.after = c1.err; heard.off = +Math.hypot(c1.x - mor.x, c1.y - mor.y).toFixed(0);
    heard.known = window.aiKnown('us', mor, window.G.t); heard.tube = M.tubeId === mor.id;
    W = window.aiLook('us', D2, 2);
    heard.listed = W.heard.indexOf(mor) >= 0; heard.painted = false;
    window.AIOP.us = null;
    const fired0 = window.AIR.fired['op.counter'] || 0;
    window.aiOpsPlan(W, [], 2);
    const Q = window.AIOP.us;
    heard.op = !!(Q && Q.list.some(o => o.kind === 'destroy' && o.tid === mor.id));
    heard.counter = (window.AIR.fired['op.counter'] || 0) - fired0;
    heard.fighters = W.fighters.length;
    window.AIOP.us = null;
    out.heard = heard;
    /* --- the break-off, asked of the opposition's own plan: told it stepped off against
       the flag twenty seconds ago with far more than it has, one tick of its brain breaks
       off, re-forms, and will not pick that flag again for a minute */
    const P = window.AIP.ger, brk0 = window.AIR.fired['wave.break'] || 0;
    P.asSec = S.id; P.asPick = window.G.t; P.asKey = 's' + S.id; P.asT = window.G.t - 20; P.asStr = 30000; P.asAvoid = null; P.t = 0;
    /* and whoever of his is holding the flag is unpinned for the tick, because a wave does
       not break off from defenders who cannot lift their heads: read off the battle, the
       section holding this flag was pinned when the phone's row ran and the row read that */
    const sup0 = [];
    for (const e of window.G.units) if (!e.dead && e.side === 'us' && Math.hypot(e.x - S.x, e.y - S.y) < 420) { sup0.push([e, e.sup]); e.sup = 0; }
    const keepAI = window.AI; window.AI = P; window.aiTick(1); window.AI = keepAI;
    const RB = window.AIW.bySec[S.id];
    out.brk = { fired: (window.AIR.fired['wave.break'] || 0) - brk0, avoid: P.asAvoid === S.id, off: P.asT < 0, key: P.asKey,
                pinned: RB ? +RB.pinned.toFixed(2) : -1, th: RB ? Math.round(RB.th) : -1 };
    for (const h of sup0) h[0].sup = h[1];
    /* every new decision is declared, so the card can list the ones that never fire */
    out.declared = ['hold.coming', 'obj.coming', 'mood.mass', 'mortar.mass', 'wave.wait', 'wave.pinned', 'wave.break', 'wave.cohere',
                    'veh.overwatch', 'mood.clock', 'mood.exch', 'heard', 'op.counter', 'mortar.counter', 'shelled.move']
      .filter(k => window.AIR.fired[k] === undefined);
    /* and the drill comes down again */
    for (const u of spawned) u.dead = true;
    window.G.units = window.G.units.filter(u => !u.dead);
    M.con = con0; M.n = n0; M.exK = exK0; M.exL = exL0; M.lost = lost0;
    M.tubeId = 0; M.tubeT = -99; M.mass = null;
    for (const h of hid) h[0].vUs = h[1];
    window.G.t = t0;
    window.rebuildGrid();
    return out;
  });
  ok('the brain reads a body massing onto its flag off the contacts\' headings, the exchange and the clock',
     intent.headed > 40 && intent.mass && intent.massSec === intent.secId && intent.eta > 4 && intent.eta < 20 && intent.coming > 160 &&
     intent.exWin > 1.5 && intent.exLose < .6 &&
     Math.abs(intent.clock1.me - intent.clock1.want) < 1 && intent.clock1.him === 9999 &&
     Math.abs(intent.clock2.him - intent.clock2.want) < 1 && intent.clock2.me === 9999 && intent.declared.length === 0,
     `heading ${intent.headed}/s; a body of ${intent.massW} at ${intent.dist} walking onto ${intent.massSec} (want ${intent.secId}) ${intent.eta}s out, ${intent.coming} coming; ` +
     `exchange ${intent.exWin} after a kill and ${intent.exLose} after a loss; clock ${intent.clock1.me}s (want ${intent.clock1.want}) against ${intent.clock1.him}, ` +
     `then ${intent.clock2.me} against ${intent.clock2.him}s (want ${intent.clock2.want})` +
     (intent.declared.length ? '; undeclared: ' + intent.declared.join(',') : ''));
  const H = intent.heard;
  ok('a tube heard rather than seen is in the memory to within a fix that tightens, worth a task force, and a wave fed into a flag breaks off',
     H.ind === 1 && H.first === 220 && H.flag === 1 && H.after < 100 && H.off <= 220 && H.known && H.listed && H.tube && H.op && H.counter === 1 &&
     intent.brk.fired === 1 && intent.brk.avoid && intent.brk.off,
     `heard: hit flagged ${H.ind}, first fix ${H.first} then ${H.after} after four more rounds, ${H.off} off the truth, known ${H.known}, listed ${H.listed}, ` +
     `tube ${H.tube}, task force ${H.op} (${H.counter}) out of ${H.fighters} fighters; break-off fired ${intent.brk.fired}, avoiding ${intent.brk.avoid}, re-forming ${intent.brk.off} (${intent.brk.th} on the flag, ${intent.brk.pinned} of it pinned)`);

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
    const mine = window.spawnUnit(side, side === 'us' ? 'am_sher' : 'hr_p4', 700, 1500, 0);
    const theirs = window.spawnUnit(foe, foe === 'us' ? 'am_sher' : 'hr_p4', 900, 1500, 0);
    mine.hp = theirs.hp = 1e6;
    const took = hit(mine, theirs, 100), dealt = hit(theirs, mine, 100);
    /* and the cross-check: a round between two of the opposition's is untouched by either */
    const theirs2 = window.spawnUnit(foe, foe === 'us' ? 'am_sher' : 'hr_p4', 1100, 1500, 0);
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
             /* what went out of the till since the whistle, because with a till this size the
                AUTO setting fits the rifle squad its BARs before the row reads it */
             spMp: Math.round(window.REC && window.REC[side] ? window.REC[side].spendMp : 0),
             spFu: Math.round(window.REC && window.REC[side] ? window.REC[side].spendFu : 0),
             incYou: +window.G.inc[side].mp.toFixed(2), incFoe: +window.G.inc[foe].mp.toFixed(2),
             incFuYou: +window.G.inc[side].fu.toFixed(2), incFuFoe: +window.G.inc[foe].fu.toFixed(2),
             prodYou, prodFoe, consYou, consFoe, took, dealt, neither,
             eyeYou, eyeFoe, eyeDef, eyeFoeDef,
             even: window.hcapEven(), rows: document.querySelectorAll('#hgrid .hrow').length,
             hqTime: hq.def.makes.length };
  });
  ok('the handicap is the player\'s half of the difficulty, and the opposition keeps its own',
     hcap.rows === 13 && !hcap.even && hcap.pd.pop === 1000 && hcap.popYou === 1000 &&
     hcap.popFoe === 175 && hcap.mp + hcap.spMp >= hcap.pd.mp && hcap.fu + hcap.spFu >= hcap.pd.fu &&
     hcap.incYou > hcap.incFoe * 6 && hcap.incFuYou > hcap.incFuFoe * 6 &&
     hcap.prodYou > hcap.prodFoe * 9 && hcap.prodFoe > 0 &&
     hcap.consYou > hcap.consFoe * 9 && hcap.consFoe > 0 &&
     Math.abs(hcap.took - 100 * hcap.pd.take) < 1 &&
     Math.abs(hcap.dealt - 100 * hcap.pd.deal) < 1 &&
     Math.abs(hcap.neither - 100) < 1 &&
     Math.abs(hcap.eyeYou - hcap.eyeDef * hcap.pd.eye) < 2 && hcap.eyeFoe === hcap.eyeFoeDef,
     `${hcap.rows} settings, all off even; on GREEN the player's cap is ${hcap.popYou} and the opposition's ${hcap.popFoe}; ` +
     `the till opened at ${hcap.mp + hcap.spMp}/${hcap.fu + hcap.spFu}f (${hcap.spMp}/${hcap.spFu}f spent since); income ${hcap.incYou}mp ${hcap.incFuYou}f against ` +
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
    const WK = side === 'us' ? 'how240' : 'how210', WKF = foe === 'us' ? 'how240' : 'how210';
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
    const key = side === 'us' ? 'am_240' : 'ger_how210', keyF = foe === 'us' ? 'am_240' : 'ger_how210';
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
    const rif = window.spawnUnit(side, side === 'us' ? 'am_rifle' : 'hr_gren', 700, 1600, 0);
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
     were the two that never picked a target; laid the other way about, a battery has to take
     its own time to come round on a target it chose, the same time it takes on a mission it
     was given -- the trails' rate for the half turn less the arc its carriage swings through
     (`layOn`). --- */
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
      window.spawnUnit(other, other === 'ger' ? 'hr_gren' : 'am_rifle', 1100, 900, Math.PI);
      window.spawnUnit(owner, owner === 'us' ? 'am_rifle' : 'hr_gren', 1000, 900, 0);
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
                      bat: s === 'us' ? 'am_240' : 'ger_how210',
                      mor: s === 'us' ? 'us_mor' : 'ger_mor' });
    const me = K(side), them = K(foe);
    const out = {
      onYou: window.hcapOf(side).free, onFoe: window.hcapOf(foe).free,
      howYou: drill(side, me.how), batYou: drill(side, me.bat),
      howFoe: drill(foe, them.how), batFoe: drill(foe, them.bat),
      morYou: drill(side, me.mor), morFoe: drill(foe, them.mor),
      batBehind: drill(side, me.bat, 1), morBehind: drill(side, me.mor, 1),
      traverse: window.UNITS[me.bat].traverse, carr: window.UNITS[me.bat].carr || 0,
      layTol: window.UNITS[me.bat].layTol || .35
    };
    window.G.units.length = 0;
    keep.forEach(u => window.G.units.push(u));
    return out;
  });
  const swing = (Math.PI - freeFire.carr - freeFire.layTol) / freeFire.traverse;
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
    const mine = window.spawnUnit(side, side === 'us' ? 'am_sher' : 'hr_p4', 700, 1500, 0);
    const theirs = window.spawnUnit(foe, foe === 'us' ? 'am_sher' : 'hr_p4', 900, 1500, 0);
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

  /* --- 3v3. Three players a side, three headquarters, three purses and five brains: the
     2v2's machinery with a third slot on each team. Ortona names one headquarters a side,
     so the three stand either side of it across the line the two armies are separated on,
     and every one of them has its own level pad to march out of. The same row takes the
     rule that a team is out when its LAST headquarters falls and not its first: with
     three a side, losing one used to lose the battle for the two players still fighting,
     and the rule is asked both ways round, an ally's going and then the last. --- */
  await reload(page);
  await page.evaluate(() => { document.getElementById('heven').click(); document.getElementById('aeven').click(); });
  const tri0 = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.team')].map(b => b.textContent.trim());
    document.querySelector('.team[data-team="3"]').click();
    const roles = [...document.querySelectorAll('#arole .arole')].map(b => b.textContent.trim());
    return { btns, chosen: window.chosenTeam, roles };
  });
  await page.evaluate(() => window.startGame('us', 1, 'vp', true, 3));
  await page.waitForFunction(() => window.SCENE && window.SCENE.ready);
  const tri = await page.evaluate(() => {
    const G = window.G, hq = G.blds.filter(b => b.def.hq);
    const sep = side => { const h = hq.filter(b => b.side === side); let m = 1e9;
      for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) m = Math.min(m, Math.hypot(h[i].x - h[j].x, h[i].y - h[j].y));
      return Math.round(m); };
    /* the ground under each: a pad is a PLANE fitted through the country, which keeps the
       shelf's own fall and takes out the relief, so what is read is the worst departure
       from the least-squares plane over the footprint and a margin, and not the spread of
       the heights, which on Ortona's shelf is thirty units of fall that is meant to be there */
    const flat = hq.map(b => { const P = [];
      for (let dx = -80; dx <= 80; dx += 20) for (let dy = -60; dy <= 60; dy += 20) P.push([dx, dy, window.groundZ(b.x + dx, b.y + dy)]);
      const n = P.length, mz = P.reduce((a, p) => a + p[2], 0) / n;
      const sxx = P.reduce((a, p) => a + p[0] * p[0], 0), syy = P.reduce((a, p) => a + p[1] * p[1], 0);
      const bx = P.reduce((a, p) => a + p[0] * (p[2] - mz), 0) / sxx, by = P.reduce((a, p) => a + p[1] * (p[2] - mz), 0) / syy;
      return Math.round(Math.max(...P.map(p => Math.abs(p[2] - mz - bx * p[0] - by * p[1]))) * 10) / 10; });
    return {
      slots: G.slots.map(s => s.k + ':' + s.role).join(' '), team: G.team,
      hqs: hq.map(b => b.own).sort().join(','), sepUs: sep('us'), sepGer: sep('ger'),
      hqWalk: hq.filter(b => { const f = window.frontOf(b.side); return window.walkable(b.x + f.x * 130, b.y + f.y * 130); }).length,
      flat, brains: Object.keys(window.AIP).sort().join(','),
      vp: [Math.round(window.vpOf('us')), Math.round(window.vpOf('ger'))],
      vpOthers: ['us2', 'us3', 'ger2', 'ger3'].map(k => Math.round(G.res[k].vp))
    };
  });
  await fastForward(page, 120);
  const tri2 = await page.evaluate(() => {
    const G = window.G, ai = G.slots.filter(s => s.ai);
    const out = {
      raised: ai.map(s => Object.keys(G.made[s.k]).length),
      queues: ai.map(s => G.blds.filter(b => b.own === s.k).length),
      units: G.slots.map(s => s.k + ':' + G.units.filter(u => !u.dead && u.own === s.k).length).join(' '),
      labels: ['us', 'us2', 'us3', 'ger', 'ger2', 'ger3'].map(k => window.stOwn(window.REC, { own: k, side: window.slotSide(k) }).replace(/^ \u00b7 /, '')).join('|')
    };
    /* an ally's headquarters and then the second: the battle goes on; then the player's own,
       which is the last, and it is over */
    const kill = k => { const b = G.blds.filter(q => q.def.hq && q.own === k)[0]; if (b) window.killBuilding(b); };
    kill('us2'); out.after1 = G.over; kill('us3'); out.after2 = G.over; kill('us'); out.after3 = !!G.over;
    return out;
  });
  ok('a 3v3 is six players on two teams: six headquarters on their own ground, six purses, five brains, and out on the last headquarters',
     tri0.btns.join(',') === '1 v 1,2 v 2,3 v 3' && tri0.chosen === 3 && tri0.roles.length === 5 &&
     tri.team === 3 && tri.hqs === 'ger,ger2,ger3,us,us2,us3' && tri.sepUs >= 280 && tri.sepGer >= 280 &&
     tri.hqWalk === 6 && tri.flat.every(f => f < 12) && tri.brains === 'ger,ger2,ger3,us2,us3' &&
     tri.vp[0] === 420 && tri.vp[1] === 420 && tri.vpOthers.every(v => v === 0) &&
     tri2.raised.every(n => n > 0) && tri2.queues.every(n => n >= 1) &&
     tri2.labels === 'YOU|ALLY|SECOND ALLY|OPPONENT 1|OPPONENT 2|OPPONENT 3' &&
     !tri2.after1 && !tri2.after2 && tri2.after3,
     `buttons ${tri0.btns.join('/')}, ${tri0.roles.length} roles on the panel; ${tri.slots}; headquarters ${tri.hqs}, ` +
     `allies ${tri.sepUs} and ${tri.sepGer} apart at the nearest, ${tri.hqWalk} of 6 with room to march out, ` +
     `the ground under them ${tri.flat.join('/')} from high to low; brains ${tri.brains}; points ${tri.vp.join('/')} ` +
     `and ${tri.vpOthers.join('/')} on the other slots; after 120s ${tri2.units}; raised ${tri2.raised.join('/')}; ` +
     `labelled ${tri2.labels}; over after an ally's headquarters ${tri2.after1}, after the second ${tri2.after2}, after the last ${tri2.after3}`);

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
      const dep = window.G.blds.filter(b => b.own === slot && b.key === (us ? 'us_tank' : 'ger_pz'))[0] ||
                  window.spawnBuilding(slot, us ? 'us_tank' : 'ger_pz', hq.x + (us ? 240 : -240), hq.y, true);
      dep.built = 1; dep.queue.length = 0;
      window.G.res[slot].mp = 99999; window.G.res[slot].fu = 99999;
      window.queueUnit(dep, key); window.queueUnit(dep, key);
      const n = dep.queue.filter(k => k === key).length;
      dep.queue.length = 0;
      return n;
    }
    const you = window.G.own, ai = 'us';
    const byRule = tryTwo(you, 'ger_tig');
    const aiRule = window.unitLimit(ai, window.UNITS.am_240);
    window.G.hc[you].noLimit = true;
    const free = tryTwo(you, 'ger_tig');
    const aiStill = window.unitLimit(ai, window.UNITS.am_240);
    window.G.hc[you].noLimit = false;
    window.G.hc[ai].noLimit = true;
    const aiFree = window.unitLimit(ai, window.UNITS.am_240);
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
    const L = [['hr_ks750', 1, 40], ['hr_pak', 2, 130], ['hr_p4', 2, 260], ['ger_tig', 1, 620]];
    const cls = ['hr_ks750', 'hr_pak', 'hr_p4', 'ger_tig'].map(window.bClassOf);
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
     pref.even.join(' ') === 'hr_ks750x1@40 hr_pakx2@130 hr_p4x2@260 ger_tigx1@620' &&
     pref.tuned.join(' ') === 'hr_pakx2@130 hr_p4x4@130 ger_tigx3@207',
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
      const side = d.side === 'ger' ? 'ger' : 'us';
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
    let men = 0, out = 0, worst = 0, worstKey = '', gar = 0;
    window.G.units.forEach(u => {
      if (u.dead || !u.models) return;
      /* a garrison's men stand at the openings of the building it holds and the clamp leaves
         them there on purpose; Ortona's houses were small enough that they stood inside the
         ring anyway, and a Saint-Lô town house is nine metres deep */
      if (u.gar) { gar += u.models.filter(m => m.alive).length; return; }
      const R = window.selRadius(u);
      u.models.forEach(m => {
        if (!m.alive) return;
        men++;
        const d = Math.hypot(m.x - u.x, m.y - u.y);
        if (d > R + 1) out++;
        if (d - R > worst - 0) { worst = d - R; worstKey = u.key; }
      });
    });
    return { men, out, over: Math.round(worst), worstKey, gar };
  });
  ok('the selection ring holds its unit and fits it',
     !tooSmall.length && !tooBig.length && held.men > 20 && held.out === 0,
     `${ring.length} infantry types: a ${ring[0].n}-man ${ring[0].k} stands ${ring[0].far} out in a ` +
     `ring of ${ring[0].r}, the widest is ${Math.max.apply(null, ring.map(r => r.far))} in ` +
     `${Math.max.apply(null, ring.map(r => r.r))}; ` +
     (tooSmall.length ? tooSmall.map(r => r.k + ' ' + r.r + '<' + r.far).join(', ') + '; ' : '') +
     (tooBig.length ? tooBig.map(r => r.k + ' ' + r.r + '>>' + r.far).join(', ') + '; ' : '') +
     `after 90s of battle ${held.out} of ${held.men} men are outside their own ring ` +
     `(furthest ${held.over} past it, ${held.worstKey}), ${held.gar} men holding buildings left out`);

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
    /* the Gothic Line is hidden, so there is no button for it: what the title screen offers
       is read, and the ground is set the way the harness sets a hidden one */
    out.offered = [...document.querySelectorAll('.gmap')].map(b => b.dataset.map).join(',');
    window.chosenMap = 'gothic'; window.objSync(); window.brandSync();
    out.picked = window.chosenMapData().name;
    out.brief = document.getElementById('objtext').textContent;
    /* and the page above the buttons names the ground it is going to be fought over */
    out.head = document.getElementById('btitle').textContent;
    out.lede = document.getElementById('bsub').textContent;
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
  ok('two maps are offered and the hidden third is kept, and the mirrored one is fair to the unit',
     maps.keys === 'gothic,omaha,stlo' && maps.offered === 'omaha,stlo' && maps.picked === 'The Gothic Line' &&
     maps.head === 'GOTHIC LINE' && maps.lede.indexOf('Foglia') >= 0 &&
     maps.brief.indexOf('Foglia') >= 0 && maps.unpaired === 0 && maps.west === maps.east &&
     maps.ground < 1 && maps.flagSkew === 0 && maps.vp === 3 && maps.owned === '2:2' &&
     /* Three of the four players are brains and have to be alive and buying; the fourth
        is the human's slot, which nobody is playing, so it is allowed to be wiped. And
        the ground is asked to be owned by a SIDE and never by a slot -- which an empty
        list satisfies, because a moment when every flag on the map is being contested is
        a fact about the battle rather than a fault in the 2v2. */
     maps.gap > 1200 && gfight.live.filter(n => n > 0).length >= 3 && gfight.made &&
     gfight.held.filter(o => o !== 'us' && o !== 'ger').length === 0,
     `maps ${maps.keys}; the picker on GOTHIC LINE builds "${maps.picked}", heads the page "${maps.head}" and the briefing ` +
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
    const al = window.albedoFull ? window.albedoFull() : window.mbase;
    if (!al) return null;
    const ct = al.getContext('2d'), N = 90;
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
      const key = window.G.side === 'us' ? 'am_rifle' : 'hr_gren';
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

  /* --- The fourth map, and the first laid for three a side. Saint-Lo is mirrored about
     y 1400 in everything that plays and dressed differently on each half, and what it
     claims is arithmetic a photograph cannot check:
     - the ground is its own reflection (read with `bareZ`, because the two bridges on the
       forward rows are one stone and one girder and their decks hump differently);
     - six headquarters stand on the map's own spots in the map's own order;
     - every solid thing has a twin on the same footprint, however each half dresses it --
       a gasholder on one side is a goods shed on the other and stops the same boot;
     - every flag has tier-3 cover inside 110 of its point, which two did not until the
       crossing got its cottage and the Champ de Mars its pits;
     - a man gets from every headquarters to every flag, Notre-Dame included, which a
       house's pad dropping the ramp into a trough once made impossible, and the two halves
       walk the same to a per cent;
     - and a battle is fought on it with every brain raising something.
     It runs before the Omaha rows, which reload. --- */
  await reload(page);
  await page.evaluate(() => { document.getElementById('heven').click(); document.getElementById('aeven').click(); });
  await page.evaluate(() => { window.G.mapData = window.MAPS.stlo.make(); window.startGame('us', 1, 'vp', true, 3); });
  await page.waitForFunction(() => window.SCENE && window.SCENE.ready);
  const stlo = await page.evaluate(() => {
    const G = window.G, MY = 1400, out = {};
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const x = 30 + (i * 137.71) % 3740, y = 30 + (i * 71.37) % 1340;
      worst = Math.max(worst, Math.abs(window.bareZ(x, y) - window.bareZ(x, 2 * MY - y)));
    }
    out.ground = Math.round(worst * 100) / 100;
    const ents = G.mapData.entities.filter(e => e.t === 'hq'), hq = G.blds.filter(b => b.def.hq);
    out.hqs = hq.length;
    out.spots = ents.filter(e => hq.some(b => b.side === e.side && b.own === (e.side + ((e.n || 1) > 1 ? e.n : '')) &&
                                        Math.hypot(b.x - e.x, b.y - e.y) < 8)).length;
    out.hqWalk = hq.filter(b => { const f = window.frontOf(b.side); return window.walkable(b.x + f.x * 130, b.y + f.y * 130); }).length;
    const sol = G.props.filter(p => p.solid && p.kind !== 'sea');
    out.solids = sol.length;
    out.unpaired = sol.filter(p => Math.abs(p.y - MY) > 1 &&
      !sol.some(q => q !== p && Math.abs(q.x - p.x) < 1 && Math.abs(q.y - (2 * MY - p.y)) < 1 && Math.abs(q.w - p.w) < 1 && Math.abs(q.h - p.h) < 1))
      .slice(0, 4).map(p => (p.look || p.style || p.kind) + '@' + Math.round(p.x) + ',' + Math.round(p.y));
    out.bare = G.sectors.filter(sc => !G.covers.some(c => c.type >= 3 && Math.hypot(c.x - sc.x, c.y - sc.y) < 110)).map(sc => sc.id);
    out.flags = G.sectors.length;
    const man = { cat: 'inf', def: {} }, walk = {};
    let noWay = [], lost = 0;
    for (const b of hq) for (const sc of G.sectors) {
      const f = window.frontOf(b.side), p = window.findPath(b.x + f.x * 110, b.y + f.y * 110, sc.x, sc.y, man);
      let L = 0, px = b.x + f.x * 110, py = b.y + f.y * 110;
      for (const q of p) { L += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y; }
      if (p.noWay || Math.hypot(px - sc.x, py - sc.y) > 60) noWay.push(b.own + '>' + sc.id);
      walk[b.own + '>' + sc.id] = L;
    }
    const twin = id => id[0] === 'g' ? 'a' + id.slice(1) : id[0] === 'a' ? 'g' + id.slice(1) : id;
    let us = 0, ger = 0;
    for (const k in walk) if (k.indexOf('us') === 0) { const [o, id] = k.split('>'); us += walk[k]; ger += walk[o.replace('us', 'ger') + '>' + twin(id)]; }
    out.noWay = noWay.slice(0, 4); out.walks = Object.keys(walk).length;
    out.walkUs = Math.round(us); out.walkGer = Math.round(ger);
    return out;
  });
  await fastForward(page, 90);
  const stloFight = await page.evaluate(() => {
    const G = window.G, ai = G.slots.filter(s => s.ai);
    return { raised: ai.filter(s => Object.keys(G.made[s.k]).length > 0).length, brains: ai.length,
             held: [...new Set(G.sectors.map(x => x.owner).filter(Boolean))].filter(o => o !== 'us' && o !== 'ger').length };
  });
  const walkSkew = Math.abs(stlo.walkUs - stlo.walkGer) / Math.max(1, stlo.walkGer);
  ok('Saint-Lô: the ground is its own reflection, every solid thing has a twin, every flag has cover and every walk arrives, the same both ways',
     stlo.ground < .5 && stlo.hqs === 6 && stlo.spots === 6 && stlo.hqWalk === 6 && stlo.unpaired.length === 0 &&
     stlo.flags === 16 && stlo.bare.length === 0 && stlo.noWay.length === 0 && stlo.walks === 96 && walkSkew < .02 &&
     stloFight.raised === stloFight.brains && stloFight.brains === 5 && stloFight.held === 0,
     `the ground disagrees with its reflection by ${stlo.ground} at most over 2000 samples; ${stlo.hqs} headquarters, ` +
     `${stlo.spots} on the map's own spots and ${stlo.hqWalk} with ground to march out onto; ${stlo.solids} solid things, ` +
     `unpaired: ${stlo.unpaired.join(' ') || 'none'}; flags without cover: ${stlo.bare.join(' ') || 'none'} of ${stlo.flags}; ` +
     `${stlo.walks} walks, no way: ${stlo.noWay.join(' ') || 'none'}; ${stlo.walkUs} units from the American ` +
     `headquarters against ${stlo.walkGer} from the German (${(walkSkew * 100).toFixed(2)}%); ` +
     `${stloFight.raised} of ${stloFight.brains} brains raised something in 90 s`);

  /* --- The base areas. Ortona, the Gothic Line and Saint-Lo give each side ground to build a
     base on (`LAND.base`): an area round every headquarters spot of the full three a side,
     levelled very nearly flat and laid with nothing but roads, flags and grass. Omaha gives it
     to the Germans in the bocage, and the Americans build out of the craft on the sand, of which
     there are twelve aground and whole. Asked of each map in a 3v3: how flat each area is (the
     most the ground rises or falls between two points twenty units apart, the most it stands
     off the plane fitted through it, and that plane's own grade, which is allowed two in a
     hundred and across an area a thousand units long is twenty units from one end to the
     other), that nothing solid stands in one, and that every one of the six players
     sites his barracks, his motor pool and his tank yard where the brain's own routine puts
     them, inside his own side's area where it has one, or on a craft. --- */
  const bases = [];
  for (const map of ['gothic', 'stlo', 'omaha']) {
    await reload(page);
    await page.evaluate(m => { window.G.mapData = window.MAPS[m].make(); window.startGame('us', 1, 'vp', true, 3); }, map);
    await page.waitForFunction(() => window.SCENE && window.SCENE.ready);
    bases.push(await page.evaluate(m => {
      const W = window, G = W.G, out = { map: m, zones: W.BASEZ.length, area: 0, off: 0, tilt: 0, grade: 0, solid: 0, sited: 0, outside: 0, craft: 0, fails: [] };
      W.BASEZ.forEach(Z => {
        out.area += (Z.x1 - Z.x0) * (Z.y1 - Z.y0);
        const P = [];
        for (let x = Z.x0 + 30; x <= Z.x1 - 30; x += 20) for (let y = Z.y0 + 30; y <= Z.y1 - 30; y += 20) {
          const z = W.groundZ(x, y); P.push([x, y, z]);
          out.grade = Math.max(out.grade, Math.abs(W.groundZ(x + 20, y) - z) / 20, Math.abs(W.groundZ(x, y + 20) - z) / 20);
        }
        /* the plane through the area by least squares, and how far the ground stands off it */
        let n = P.length, mx = 0, my = 0, mz = 0;
        P.forEach(p => { mx += p[0] / n; my += p[1] / n; mz += p[2] / n; });
        let cxx = 0, cyy = 0, cxy = 0, cxz = 0, cyz = 0;
        P.forEach(p => { const dx = p[0] - mx, dy = p[1] - my, dz = p[2] - mz; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; cxz += dx * dz; cyz += dy * dz; });
        const det = cxx * cyy - cxy * cxy, b = (cxz * cyy - cyz * cxy) / det, c = (cyz * cxx - cxz * cxy) / det;
        out.tilt = Math.max(out.tilt, Math.abs(b), Math.abs(c));
        P.forEach(p => { out.off = Math.max(out.off, Math.abs(p[2] - (mz + b * (p[0] - mx) + c * (p[1] - my)))); });
        out.solid += G.props.filter(p => p.solid && p.kind !== 'sea' && p.x + p.w / 2 > Z.x0 && p.x - p.w / 2 < Z.x1 && p.y + p.h / 2 > Z.y0 && p.y - p.h / 2 < Z.y1).length;
      });
      out.area = Math.round(out.area / 1000);
      out.off = +out.off.toFixed(1); out.tilt = +out.tilt.toFixed(3); out.grade = +out.grade.toFixed(3);
      out.craft = G.craft.filter(W.craftFree).length;
      G.slots.forEach(s => {
        const sl = s.k, us = W.slotSide(sl) === 'us', K = us ? ['us_bar', 'us_mot', 'us_tank'] : ['ger_qtr', 'ger_dep', 'ger_pz'];
        K.forEach(k => {
          G.res[sl].mp = 9000; G.res[sl].fu = 9000;
          let at = null;
          if (W.craftPosts(sl)) { const hq = W.hqOf(sl), c = W.craftNear(hq.x, hq.y, 1e5); at = c && { x: c.x, y: c.y }; }
          else at = W.baseSite(sl, k);
          const b = at && W.placeStructure(sl, k, at.x, at.y, []);
          if (!b) { out.fails.push(sl + ':' + k); return; }
          b.built = 1; b.hp = b.maxhp; W.rebuildGrid();
          out.sited++;
          if (m !== 'omaha' && W.baseDist(b.x, b.y) > 0) out.outside++;
        });
      });
      return out;
    }, map));
  }
  const bz = Object.fromEntries(bases.map(b => [b.map, b]));
  ok('the base areas: big, level and empty, and every player of a 3v3 sites his three buildings in his own',
     bases.every(b => b.off < 6 && b.tilt < .025 && b.grade < .2 && b.solid === 0 && b.sited === 18) &&
     ['gothic', 'stlo'].every(m => bz[m].zones >= 2 && bz[m].outside === 0) &&
     bz.omaha.zones >= 1 && bz.omaha.craft >= 12,
     bases.map(b => `${b.map}: ${b.zones} areas over ${b.area}k square units, the ground ${b.off} at most off a plane whose grade ` +
       `is ${b.tilt}, and ${b.grade} at the steepest, ${b.solid} solid things in them` + (b.map === 'omaha' ? `, ${b.craft} craft aground and whole` : '') +
       `; ${b.sited} of 18 buildings sited${b.outside ? ', ' + b.outside + ' OUTSIDE their area' : ''}` +
       (b.fails.length ? ' (NONE for ' + b.fails.join(' ') + ')' : '')).join('; '));

  /* This row runs LAST of the map rows on purpose: it leaves the world on Omaha, and
     the two rows above it -- the churn wash and the field wall -- read the Gothic Line
     the row before them left standing. Put between them it took both down, and what
     that looked like was a churn that had stopped being painted. A row that changes
     the world puts it back or goes after everything that reads it. */
  /* --- The third map, and the first of a second theatre. Omaha is a corridor rather
     than a field: 1500 across and 4000 deep, with the sea along the BOTTOM of it, the
     American army starting on the sand among the craft that brought it and the German
     one in the bocage at the top, the seawall and the Atlantic Wall across the middle,
     and two draws up the bluff behind it. What it claims is arithmetic over the going
     grid and the cost model, and none of it is anything a photograph could check:
     - the world is the size the map says and the sea is at the edge the country says;
     - armour gets off the beach up a draw and nowhere else, where a section climbs the
       face wherever it likes;
     - the seawall is a firing line to a man and a barrier to a hull: he crosses it at a
       climb and fires over it, and a tank pays for it the way it pays for teeth, except
       in the two lanes and the two casemate gaps;
     - the bank and the wall are the cover on a beach that has none;
     - the flank casemates fire ALONG the beach and are refused to their own rear;
     - sixteen flags in two lanes of eight, each tied to its neighbours, and the only
       victory flags the two at each end, which a side's own does not count against;
     - and the walk from each headquarters to the OTHER side's victory flags is about the
       same, which is what makes an unmirrored map a fair one. --- */
  await reload(page);
  const om = await page.evaluate(() => {
    const W = window, out = {};
    document.querySelectorAll('.gmap').forEach(b => { if (b.dataset.map === 'omaha') b.click(); });
    out.picked = W.chosenMapData().name;
    out.brief = document.getElementById('objtext').textContent;
    out.head = document.getElementById('btitle').textContent;
    out.lede = document.getElementById('bsub').textContent;
    out.cards = document.getElementById('bcard0h').textContent + '/' + document.getElementById('bcard1h').textContent;
    W.G.mapData = W.omahaMapData();
    W.startGame('us', 1, 'vp', true, false);
    const G = W.G, OM = W.OM, line = W.omLine;
    out.world = W.WORLD.w + 'x' + W.WORLD.h;
    out.grid = W.GW + 'x' + W.GH;
    out.sea = +W.groundZ(750, W.WORLD.h - 10).toFixed(1);
    out.top = +W.groundZ(750, 300).toFixed(1);
    out.hq = { us: Math.round(G.hqPos.us.y), ger: Math.round(G.hqPos.ger.y) };
    function nearDraw(x, y) {
      let best = 1e9;
      for (const d of OM.draws) for (let i = 0; i < d.pts.length - 1; i++)
        best = Math.min(best, W.distToSeg(x, y, d.pts[i][0], d.pts[i][1], d.pts[i + 1][0], d.pts[i + 1][1]));
      return best;
    }
    function walk(sx, sy, tx, ty, veh) {
      const u = { cat: veh ? 'veh' : 'inf', def: { wheeled: 0 }, side: 'us', fear: 1 };
      const p = W.findPath(sx, sy, tx, ty, u);
      if (!p || p.noWay) return { len: -1, draw: -1, over: 0 };
      let len = 0, far = 1e9, prev = { x: sx, y: sy };
      for (let i = 0; i < p.length; i++) {
        len += Math.hypot(p[i].x - prev.x, p[i].y - prev.y);
        /* sampled along the LEG and not at its corners, and only while it is on the face
           between the toe and the crest: the smoother replaces a run of cells with one
           line, so a route that crosses the face in one leg has no corner on it at all */
        for (let t = 0; t <= 1; t += .05) {
          const qx = prev.x + (p[i].x - prev.x) * t, qy = prev.y + (p[i].y - prev.y) * t;
          if (qy < line(OM.toe, qx) && qy > line(OM.crest, qx)) far = Math.min(far, nearDraw(qx, qy));
        }
        prev = p[i];
      }
      const crow = Math.hypot(tx - sx, ty - sy);
      return { len: Math.round(len), over: +(len / crow).toFixed(2), draw: far > 1e8 ? -1 : Math.round(far) };
    }
    /* five places across the beach, each straight up to the plateau: both flanks, the
       middle, and the two stretches between the draws and the middle */
    out.veh = [150, 560, 750, 940, 1350].map(x => walk(x, 3300, x, 1700, 1));
    out.inf = [150, 750, 1350].map(x => walk(x, 3300, x, 1700, 0));
    /* the seawall, on one piece that is standing and in the Vierville lane */
    const cc = (x, y, v) => +W.cellCost(W.cidx((x / 20) | 0, (y / 20) | 0), v).toFixed(2);
    out.seaWall = G.walls.filter(w => w.sea).length;
    out.wallMan = cc(180, line(OM.wall, 180), 0);
    out.wallHull = cc(180, line(OM.wall, 180), 1);
    out.laneHull = cc(400, 2640, 1);
    out.overWall = W.traceClear(180, 2680, W.groundZ(180, 2680) + 12, 180, 2540, W.groundZ(180, 2540) + 12, W.fblk);
    /* the cover: none on the open flat, the bank, and the wall */
    out.flatCov = W.coverAt(800, 3100);
    out.bankCov = W.coverAt(560, 2648);
    out.wallCov = W.coverAt(640, 2600);
    /* the paint: the flat is sand and the farmland at the top is not, read off the
       albedo canvas rather than looked at, because a beach that quietly stopped being
       painted reads as a perfectly good map in every photograph ever taken of it */
    const g = (W.albedoFull ? W.albedoFull() : W.mbase).getContext('2d');
    const px = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    out.sand = px(750, 3300); out.field = px(620, 1300);
    out.skirt = W.SCENE.skirt ? W.SCENE.skirt.n : 0;
    /* the casemates in the wall look ALONG the beach; a round out of the slot is allowed
       and the same round to the rear is refused by the bunker's own concrete */
    const bk = G.bunks.slice().sort((p, q) => Math.hypot(p.x - 300, p.y - 2596) - Math.hypot(q.x - 300, q.y - 2596))[0];
    const gar = W.spawnUnit('ger', 'hr_gren', bk.x, bk.y);
    gar.gar = bk; bk.occ = gar;
    const mark = (d) => ({ x: bk.x + Math.cos(bk.face) * 300 * d, y: bk.y + Math.sin(bk.face) * 300 * d,
                           cat: 'inf', side: 'us' });
    out.slot = W.fireLine(gar, mark(1));
    out.rear = W.fireLine(gar, mark(-1));
    out.along = +Math.abs(Math.cos(bk.face)).toFixed(2);
    gar.dead = true; bk.occ = null;
    /* the flags, and the walk from each headquarters to the other side's victory flags */
    out.secN = G.sectors.length;
    out.linked = G.sectors.filter(s => (s.nb || []).length >= 2).length;
    const vps = side => G.sectors.filter(s => s.type === 'vp' && s.home === side);
    out.vp = G.sectors.filter(s => s.type === 'vp').length;
    out.vpHome = vps('us').length + vps('ger').length;
    out.walkUs = vps('ger').map(f => walk(G.hqPos.us.x, G.hqPos.us.y - 90, f.x, f.y, 0).len);
    out.walkGer = vps('us').map(f => walk(G.hqPos.ger.x, G.hqPos.ger.y + 90, f.x, f.y, 0).len);
    out.secs = G.sectors.map(s => s.type + (s.owner || '-')).sort().join(' ');
    return out;
  });
  /* and a battle is fought on it, because a map that boots and is never played is a map
     nobody has run the game on */
  await fastForward(page, 120);
  const ofight = await page.evaluate(() => ({
    live: [window.G.units.filter(u => !u.dead && u.side === 'us').length,
           window.G.units.filter(u => !u.dead && u.side === 'ger').length],
    held: [...new Set(window.G.sectors.map(x => x.owner).filter(Boolean))].sort().join(',')
  }));
  const omGreen = om.field[1] - om.field[0], omWarm = om.sand[0] - om.sand[2];
  const wUs = om.walkUs.reduce((a, b) => a + b, 0), wGer = om.walkGer.reduce((a, b) => a + b, 0);
  ok('Omaha: a corridor with the sea at the bottom, the wall across the middle, and a draw the only way off for armour',
     om.picked === 'Omaha Beach' && om.brief.indexOf('wall') >= 0 && om.head === 'OMAHA' &&
     /29th/.test(om.lede) && /352/.test(om.lede) && !/Ortona|Canadian/.test(om.lede) && om.cards === 'THE SEAWALL/THE DRAWS' &&
     om.world === '1500x4000' && om.grid === '75x200' && om.sea < 0 && om.top > 200 &&
     om.hq.us > 3650 && om.hq.ger < 400 &&
     /* every vehicle route off the beach passes up a draw */
     om.veh.every(r => r.len > 0 && r.draw >= 0 && r.draw < 40) &&
     /* and a section climbs straight up the face, nowhere near one */
     om.inf.every(r => r.len > 0 && r.over < 1.15 && (r.draw < 0 || r.draw > 80)) &&
     /* the wall: a man climbs it and fires over it, a hull pays for it and the lane is open */
     om.seaWall >= 8 && om.wallMan > 1.5 && om.wallMan < 3 && om.wallHull > 10 && om.laneHull < 3 && om.overWall &&
     om.flatCov === 0 && om.bankCov >= 2 && om.wallCov >= 2 &&
     om.sand[0] > 130 && omWarm > 12 && omGreen > 4 && om.field[0] < 130 &&
     om.skirt > 10000 &&
     om.slot && !om.rear && om.along > .9 &&
     om.secN === 16 && om.linked === 16 && om.vp === 4 && om.vpHome === 4 &&
     om.walkUs.every(l => l > 0) && om.walkGer.every(l => l > 0) &&
     Math.abs(wUs - wGer) / Math.max(wUs, wGer) < .12 &&
     ofight.live[0] > 0 && ofight.live[1] > 0,
     `the picker builds "${om.picked}", heads the page "${om.head}" over ${om.cards} and the briefing reads "${om.brief.slice(0, 30)}..."; ` +
     `the world is ${om.world} (grid ${om.grid}), the ground ${om.sea} at the bottom edge and ${om.top} on the plateau, ` +
     `headquarters at y ${om.hq.us} and ${om.hq.ger}; ` +
     `armour off the beach: ${om.veh.map(r => r.len + 'u (x' + r.over + '), ' + r.draw + ' from a draw').join('; ')}; ` +
     `a section: ${om.inf.map(r => r.len + 'u (x' + r.over + '), ' +
       (r.draw < 0 ? 'never on a draw' : r.draw + ' from one')).join('; ')}; ` +
     `${om.seaWall} lengths of seawall, a man pays ${om.wallMan} on it and a tank ${om.wallHull} ` +
     `against ${om.laneHull} in the lane, and a round goes ${om.overWall ? 'over' : 'NOT over'} it; ` +
     `cover ${om.flatCov} on the flat, ${om.bankCov} on the bank and ${om.wallCov} at the wall; ` +
     `the flat is ${om.sand.join(',')} against ${om.field.join(',')} on the farmland; ` +
     `${om.skirt} vertices of ground past the edge; the casemate looks along the beach (${om.along}), ` +
     `a shot out of the slot ${om.slot ? 'allowed' : 'REFUSED'} and the same shot to the rear ` +
     `${om.rear ? 'ALLOWED' : 'refused'}; ${om.secN} flags, ${om.linked} tied to two or more, ${om.vp} victory flags ` +
     `(${om.vpHome} a side's own); the walk to the enemy's victory flags is ${om.walkUs.join('/')} from the beach ` +
     `and ${om.walkGer.join('/')} from the bocage; flags ${om.secs}; ` +
     `after 120s of battle ${ofight.live.join('/')} units and the ground is held by ${ofight.held || 'nobody'}`);

  /* --- The bocage. A hedgerow is a bank of earth with a hedge on it, and what it claims
     is four things a photograph of a hedge cannot say: it stops the eye and the round of
     anybody not up against it, the man lying along it sees and shoots over it, a man
     gets over it slowly, and a hull does not except at a gate -- the last of which was
     quietly wiped by a grid fill two blocks below its own mark, so every tank on the map
     drove through the bocage at the price of open ground and the plateau read as a field
     with hedges painted on it. And a Norman house is a strongpoint however small: every
     one on the map is thirty-four to forty-four units deep, and the size test that says
     a shed from a house shut them all out. --- */
  const boc = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const cc = (x, y, v) => +W.cellCost(W.cidx((x / 20) | 0, (y / 20) | 0), v).toFixed(2);
    const zA = (x, y) => W.groundZ(x, y) + 17;
    out.n = G.hedges.length;
    let blocked = 0, seen = 0, lie = 0, man = 0, hull = 0, cov = 0, n = 0;
    /* every leg long enough to have a middle and with no other hedgerow within seventy of
       it, asked across its middle. The second half of that is what lets the question be
       about THIS hedge: a lane is thirty units between two of them, so a line drawn across
       a hedge that lines a lane meets the lane's other hedge as well, and a man lying
       against the first was reported as blind because of the second */
    const joins = (h, o) => Math.hypot(h.x1 - o.x2, h.y1 - o.y2) < 1 || Math.hypot(h.x2 - o.x1, h.y2 - o.y1) < 1;
    const alone = h => G.hedges.every(o => o === h || joins(h, o) ||
      W.distToSeg((h.x1 + h.x2) / 2, (h.y1 + h.y2) / 2, o.x1, o.y1, o.x2, o.y2) > 70);
    /* and a hedge standing on the verge of a lane is left out: where the two share a cell
       the lane wins, on purpose, because a lane shut to the eye and the hull down its
       length is the worse fault of the two -- see rebuildGrid */
    const verge = (x, y) => G.roads.some(rd => { for (let i = 0; i < rd.length - 1; i++)
      if (W.distToSeg(x, y, rd[i].x, rd[i].y, rd[i + 1].x, rd[i + 1].y) < (rd.width || 48) / 2 + 20) return true; return false; });
    let lieOf = 0;
    for (let i = 0; i < G.hedges.length; i++) {
      const h = G.hedges[i], L = Math.hypot(h.x2 - h.x1, h.y2 - h.y1);
      if (L < 60 || !alone(h)) continue;
      const hx = (h.x1 + h.x2) / 2, hy = (h.y1 + h.y2) / 2, a = Math.atan2(h.y2 - h.y1, h.x2 - h.x1);
      if (verge(hx, hy)) continue;
      const nx = -Math.sin(a), ny = Math.cos(a);
      const ax = hx + nx * 60, ay = hy + ny * 60, bx = hx - nx * 60, by = hy - ny * 60, lx = hx + nx * 14, ly = hy + ny * 14;
      n++;
      if (!W.traceClear(ax, ay, zA(ax, ay), bx, by, zA(bx, by), W.fblk)) blocked++;
      if (!W.traceClear(ax, ay, zA(ax, ay), bx, by, zA(bx, by), W.sblk)) seen++;
      /* the man lying against it, asked only where the far point can be seen from just
         across the hedge -- the control -- because a house or a yard wall out in the next
         field blinds him for a reason that is not the hedge he is lying against */
      const cx = hx - nx * 14, cy = hy - ny * 14;
      if (W.traceClear(cx, cy, zA(cx, cy), bx, by, zA(bx, by), W.fblk)) {
        lieOf++;
        if (W.traceClear(lx, ly, zA(lx, ly), bx, by, zA(bx, by), W.fblk)) lie++;
      }
      man = Math.max(man, cc(hx, hy, 0)); hull += cc(hx, hy, 1) > 10 ? 1 : 0;
      cov += W.coverAt(lx, ly) >= 3 ? 1 : 0;
    }
    Object.assign(out, { legs: n, blocked, seen, lie, lieOf, man, hull, cov });
    /* and a lane is open down its length: every straight run of lane on the plateau long
       enough to look down, asked from one end of it to the other at a man's eye */
    let lanes = 0, laneClear = 0, laneHull = 0;
    for (const rd of G.roads) for (let i = 0; i < rd.length - 1; i++) {
      const p = rd[i], q = rd[i + 1], L = Math.hypot(q.x - p.x, q.y - p.y);
      if (L < 140 || p.y > 1900 || q.y > 1900) continue;
      const ux = (q.x - p.x) / L, uy = (q.y - p.y) / L;
      const x0 = p.x + ux * 20, y0 = p.y + uy * 20, x1 = q.x - ux * 20, y1 = q.y - uy * 20;
      lanes++;
      if (W.traceClear(x0, y0, zA(x0, y0), x1, y1, zA(x1, y1), W.sblk)) laneClear++;
      laneHull = Math.max(laneHull, cc((x0 + x1) / 2, (y0 + y1) / 2, 1));
    }
    Object.assign(out, { lanes, laneClear, laneHull });
    /* a tank asked to cross three fields goes by the lanes and the gates */
    const u = { cat: 'veh', def: { wheeled: 0 }, side: 'us', fear: 1 };
    const p = W.findPath(300, 1500, 1200, 1100, u);
    /* counted as the route's legs crossing a hedgerow's own line, which is exact and is
       what a gate saves: sampled off the grid instead, the smoothed line clipping the
       corner of a marked cell beside a diagonal gate read as a tank through a hedge */
    const cross = (ax, ay, bx, by, cx, cy, dx, dy) => {
      const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      return d1 * d2 < 0 && d3 * d4 < 0;
    };
    /* and only off the metalling: a lane is thirty units between two hedgerows on a
       twenty-unit grid, so the hedge that lines it shares its cells, and the lane is given
       those cells on purpose -- a route down a lane crosses its own verge hedge's line
       inside the lane's cells, which is driving down the lane */
    let through = 0, inLane = 0, prev = { x: 300, y: 1500 };
    for (const q of p || []) {
      for (const h of G.hedges) if (cross(prev.x, prev.y, q.x, q.y, h.x1, h.y1, h.x2, h.y2)) {
        const t = ((h.x1 - prev.x) * (h.y2 - h.y1) - (h.y1 - prev.y) * (h.x2 - h.x1)) /
                  ((q.x - prev.x) * (h.y2 - h.y1) - (q.y - prev.y) * (h.x2 - h.x1));
        const x = prev.x + (q.x - prev.x) * t, y = prev.y + (q.y - prev.y) * t;
        if (W.road[W.cidx((x / 20) | 0, (y / 20) | 0)]) inLane++; else through++;
      }
      prev = q;
    }
    out.inLane = inLane;
    out.tankThrough = through;
    /* the houses */
    const nh = G.props.filter(q => q.kind === 'nhouse');
    const sec = { cat: 'inf', def: { speed: 30 }, models: [] };
    out.houses = nh.length;
    /* one already held counts: the battle in the row above has been going two minutes and
       the brain puts sections into houses */
    out.holdable = nh.filter(q => q.gar || W.canGarrison(sec, q)).length;
    const hq = nh.filter(q => q.style === 'house' && !q.gar)[0];
    const s = W.spawnUnit('ger', 'hr_gren', hq.x, hq.y + hq.h / 2 + 30);
    W.enterBuilding(s, hq);
    out.held = !!s.gar;
    W.leaveBuilding(s); s.dead = true;
    return out;
  });
  ok('Omaha: a hedgerow stops the eye, the round and the hull and not the man lying up against it, and a Norman house can be held',
     boc.n > 200 && boc.legs >= 16 && boc.blocked === boc.legs && boc.seen === boc.legs &&
     boc.lieOf >= boc.legs * .6 && boc.lie === boc.lieOf && boc.man > 1.5 && boc.hull === boc.legs && boc.cov >= boc.legs * .9 &&
     boc.lanes >= 20 && boc.laneClear >= boc.lanes * .9 && boc.laneHull < 3 &&
     boc.tankThrough <= 1 && boc.houses >= 30 && boc.holdable === boc.houses && boc.held,
     `${boc.n} hedgerow legs; across the middle of ${boc.legs} of them a round is stopped on ${boc.blocked} and an ` +
     `eye on ${boc.seen}, a man lying against one shoots over it on ${boc.lie} of the ${boc.lieOf} where the far field is open, a man pays up to ${boc.man} ` +
     `and a hull is held up on ${boc.hull}, tier-3 cover along ${boc.cov}; ${boc.laneClear} of ${boc.lanes} ` +
     `straight runs of lane can be seen down, a tank paying ${boc.laneHull} in one; a tank sent across three fields ` +
     `crosses a hedgerow ${boc.tankThrough} times off the lanes (its verge hedges ${boc.inLane} times in them); ${boc.holdable} of ${boc.houses} Norman houses ` +
     `can be held and a section ${boc.held ? 'went into' : 'could NOT get into'} one`);

  /* --- The craft and the wall. On a beach a post is a landing craft that is aground and
     whole, turned into one for the usual price: refused on open sand, allowed on a craft,
     the craft spent, a second post on it refused, and the craft free again once its post
     is knocked down. And the title screen's ATLANTIC WALL puts the garrison in: a gun in
     each casemate through the bunker's own fitting, the Tobruks and the trench manned,
     none of it on the German cap, and all of it still where it was put after a minute of
     battle, because a garrison the brain walks off to take a flag is not a garrison. --- */
  const cw = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    G.res.us.mp += 2000; G.res.us.fu += 400;
    out.free0 = G.craft.filter(W.craftFree).length;
    out.open = !!W.placeStructure('us', 'us_bar', 750, 3300, []);
    const cr = G.craft.filter(W.craftFree)[0];
    const mp0 = G.res.us.mp;
    const b = W.placeStructure('us', 'us_bar', cr.x + 30, cr.y, []);
    out.onCraft = !!b; out.paid = Math.round(mp0 - G.res.us.mp);
    out.buf = !!(b && b.buf); out.fp = b ? b.def.w + 'x' + b.def.h : '-';
    out.spent = !W.craftFree(cr);
    const b2 = W.placeStructure('us', 'us_mot', cr.x, cr.y, []);
    out.second = !!b2 && b2.craft === cr.i;
    if (b2) W.killBuilding(b2);
    out.free1 = G.craft.filter(W.craftFree).length;
    if (b) W.killBuilding(b);
    out.freed = W.craftFree(cr);
    return out;
  });
  await reload(page);
  const man = await page.evaluate(() => {
    const W = window;
    document.querySelectorAll('.gmap').forEach(b => { if (b.dataset.map === 'omaha') b.click(); });
    const row = [...document.querySelectorAll('.wallrow')].every(e => !e.classList.contains('hidden'));
    document.querySelector('.wall[data-wall="1"]').click();
    W.G.mapData = W.omahaMapData();
    W.startGame('us', 1, 'vp', true, false);
    const G = W.G, wu = G.units.filter(u => u.wall);
    W.__wall = wu.map(u => [u.id, u.x, u.y]);
    return { row, n: wu.length, fitted: G.bunks.filter(b => b.upKind).length, gar: wu.filter(u => u.gar).length,
             pop: W.popOf('ger'), popAll: wu.reduce((a, u) => a + u.def.pop, 0),
             popRest: G.units.filter(u => u.own === 'ger' && !u.wall && !u.dead).reduce((a, u) => a + u.def.pop, 0) };
  });
  await fastForward(page, 60);
  const man2 = await page.evaluate(() => {
    const W = window, G = W.G;
    let moved = 0, far = 0;
    for (const [id, x, y] of W.__wall) {
      const u = G.units.filter(q => q.id === id)[0];
      if (!u || u.dead) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      far = Math.max(far, d);
      if (d > 60) moved++;
    }
    /* and the wall is empty when it is not asked for */
    document.querySelector('.wall[data-wall="0"]').click();
    return { moved, far: Math.round(far) };
  });
  ok('Omaha: a post is a landing craft, and the Atlantic Wall is manned when the title screen asks for it',
     cw.free0 >= 12 && !cw.open && cw.onCraft && cw.paid === 200 && cw.buf && cw.spent && !cw.second &&
     cw.freed && man.row && man.n === 14 && man.fitted === 7 && man.gar >= 6 && man.pop === man.popRest &&
     man2.moved === 0,
     `${cw.free0} craft aground and whole; a company post on open sand ${cw.open ? 'ALLOWED' : 'refused'}, on a ` +
     `craft ${cw.onCraft ? 'allowed' : 'REFUSED'} for ${cw.paid} with its own dressing ${cw.buf} on a ${cw.fp} ` +
     `footprint, the craft ${cw.spent ? 'spent' : 'STILL FREE'}, a second post on it ${cw.second ? 'ALLOWED' : 'refused'}, ` +
     `free again ${cw.freed} once the post is down; the wall row ${man.row ? 'shows' : 'is HIDDEN'} on Omaha and MANNED ` +
     `puts ${man.n} units in, ${man.fitted} bunkers fitted and ${man.gar} garrisoned, the German cap reading ` +
     `${man.pop} (what it raised itself: ${man.popRest}) with ${man.popAll} of wall not on it; after a minute of battle ${man2.moved} of them had left ` +
     `their post (furthest ${man2.far})`);

  /* --- The army. The Allied side is the 29th Infantry Division: the side button on the
     title screen names it, the headquarters turns out the American rifle squad and queues
     it, the sections the side opens with are rifle squads of six, a brain playing the
     Allied side buys the squad, and a man of it who is killed goes down and lies as an
     American. Every map fields the same two armies, so the Italian ground names the 29th
     on the button as well. --- */
  const natA = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    out.name = W.FACTION.us.name;
    out.pick = document.getElementById('pickus').querySelector('h3').textContent;
    const mine = G.units.filter(u => u.own === 'us' && u.cat === 'inf' && !u.dead && !u.wall);
    out.am = mine.filter(u => u.key === 'am_rifle').length;
    const sq = mine.filter(u => u.key === 'am_rifle')[0];
    out.men = sq ? sq.models.length : 0;
    /* read as the squad was raised: with a till this far into the gate the AUTO setting has
       fitted it its BARs or its grenades, and those men are the fittings' and not the squad's */
    const up0 = sq ? sq.up : null;
    out.fitted = up0 ? Object.keys(up0).filter(k => up0[k]).join(',') : '';
    if (sq) sq.up = {};
    out.vars = sq ? [...new Set(sq.models.map((m, i) => W.variantForModel(sq, i)))].sort().join(',') : '-';
    if (sq) sq.up = up0;
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    out.makes = hq ? W.makesOf(hq).join(',') : '-';
    G.res.us.mp += 2000;
    out.qAm = hq ? W.queueUnit(hq, 'am_rifle') : null;
    if (hq) hq.queue.length = 0;
    if (sq) {
      /* the record from the list that grew: a man on his feet goes on the falls and one
         lying down straight onto the corpses, and either may already hold older bodies */
      const m = sq.models.filter(q => q.alive)[0], nf = G.falls.length, nc = G.corpses.length;
      W.damageModel(sq, m, 1e4, null);
      const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
      out.fell = !!rec; out.fellNat = rec ? rec.nat : '-';
    }
    out.bodies = !!(W.MODELS.fall.usa && W.MODELS.dead.usa && W.MODELS.fall.usa.length === 3 && W.MODELS.dead.usa.length === 2);
    /* and the German side, which on the beach is the 352nd Infantry Division: its button,
       what its headquarters makes, the sections its brain has bought in the minute of battle
       the wall row ran, the three sections the wall row put in the fire trench, and a man of
       it killed. This is the game the wall row started, with the brain on the German side. */
    const G2 = { name: W.FACTION.ger.name, pick: document.getElementById('pickger').querySelector('h3').textContent };
    const theirs = G.units.filter(u => u.side === 'ger' && u.cat === 'inf' && !u.dead);
    G2.hr = theirs.filter(u => u.key === 'hr_gren').length;
    G2.wallHr = theirs.filter(u => u.wall && u.key === 'hr_gren').length;
    const gm = G.made.ger || {};
    G2.madeHr = gm.hr_gren || 0;
    const gs = theirs.filter(u => u.key === 'hr_gren' && !u.wall)[0] || theirs.filter(u => u.key === 'hr_gren')[0];
    G2.men = gs ? gs.def.models : 0;
    G2.vars = gs ? [...new Set(gs.models.map((m, i) => W.variantForModel(gs, i)))].sort().join(',') : '-';
    const ghq = G.blds.filter(b => b.own === 'ger' && b.def.hq)[0];
    G2.makes = ghq ? W.makesOf(ghq).join(',') : '-';
    if (ghq) {
      const q0 = ghq.queue.length;
      G.res.ger.mp += 2000;
      G2.qHr = W.queueUnit(ghq, 'hr_gren') ? ghq.queue.slice(-1)[0] : 'refused';
      ghq.queue.length = q0;
    }
    if (gs) {
      const m = gs.models.filter(q => q.alive)[0], nf = G.falls.length, nc = G.corpses.length;
      W.damageModel(gs, m, 1e4, null);
      const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
      G2.fell = !!rec; G2.fellNat = rec ? rec.nat : '-';
    }
    G2.bodies = !!(W.MODELS.fall.heer && W.MODELS.dead.heer && W.MODELS.fall.heer.length === 3 && W.MODELS.dead.heer.length === 2);
    out.ger = G2;
    /* and a brain on the Allied side, from the whistle */
    W.G.mapData = W.omahaMapData();
    W.startGame('ger', 1, 'vp', true, false);
    return out;
  });
  await fastForward(page, 45);
  const natB = await page.evaluate(() => {
    const W = window, G = W.G, made = G.made.us || {};
    const out = { am: made.am_rifle || 0,
                  live: G.units.filter(u => u.own === 'us' && u.key === 'am_rifle' && !u.dead).length };
    document.querySelectorAll('.gmap').forEach(b => { if (b.dataset.map === 'stlo') b.click(); });
    out.back = document.getElementById('pickus').querySelector('h3').textContent;
    out.backGer = document.getElementById('pickger').querySelector('h3').textContent;
    document.querySelectorAll('.gmap').forEach(b => { if (b.dataset.map === 'omaha') b.click(); });
    return out;
  });
  ok('Omaha: the Allied side is the 29th Infantry Division, and its headquarters, its opening and its brain field the American rifle squad',
     /29th/.test(natA.name) && /29TH/.test(natA.pick) && natA.am >= 2 &&
     natA.men === 6 && natA.vars === 'gi_rifle,gi_rifle_b,gi_sgt' && /am_rifle/.test(natA.makes) &&
     natA.qAm === true && natA.fell && natA.fellNat === 'usa' && natA.bodies &&
     natB.am >= 1 && /29TH/.test(natB.back),
     `army ${natA.name}, the button reads ${natA.pick}; ${natA.am} rifle squads at the whistle, ${natA.men} men of ` +
     `${natA.vars}${natA.fitted ? ' (fitted ' + natA.fitted + ')' : ''}; the headquarters makes ${natA.makes}, and asked for the squad ${natA.qAm ? 'queued it' : 'REFUSED it'}; a man killed ` +
     `${natA.fell ? 'went down' : 'DID NOT go down'} as ${natA.fellNat}, American bodies ${natA.bodies ? 'baked' : 'MISSING'}; ` +
     `a brain on the Allied side ordered ${natB.am} rifle squads in 45 s (${natB.live} standing); ` +
     `Saint-Lô's button reads ${natB.back}`);
  const ng = natA.ger;
  ok('Omaha: the German side is the 352nd Infantry Division, and its headquarters, its opening, its wall and its brain field the grenadier squad',
     /352/.test(ng.name) && /352/.test(ng.pick) && ng.hr >= 2 && ng.wallHr === 3 &&
     ng.madeHr >= 1 && ng.men === 6 && ng.vars === 'gr_mp40,gr_rifle,gr_rifle_b' &&
     /hr_gren/.test(ng.makes) && ng.qHr === 'hr_gren' && ng.fell && ng.fellNat === 'heer' &&
     ng.bodies && /352/.test(natB.backGer),
     `army ${ng.name}, the button reads ${ng.pick}; ${ng.hr} grenadier squads on the field, ${ng.wallHr} of them in the ` +
     `wall; its brain ordered ${ng.madeHr} grenadier squads in the wall row's minute; ${ng.men} men of ${ng.vars}; the ` +
     `headquarters makes ${ng.makes}, and the squad asked for queues ${ng.qHr}; a man killed ` +
     `${ng.fell ? 'went down' : 'DID NOT go down'} as ${ng.fellNat}, German bodies ${ng.bodies ? 'baked' : 'MISSING'}; ` +
     `Saint-Lô's German button reads ${natB.backGer}`);

  /* --- The jeep. The Americans' light vehicle is the jeep: the motor pool turns it out and
     queues it, the count and the order book read it, the men riding in it are drawn with it
     and are not in its wreck, a wreck never throws the gun off the pedestal the way a tank
     throws a turret, and the eye in the periscope is the gunner's, standing to the gun.
     Forty deaths are asked for the throw, because one is a coin with the old rule showing
     heads four times in five. --- */
  const jp = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const mot = W.spawnBuilding('us', 'us_bar', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(mot).join(',');
    G.res.us.mp += 2000; G.res.us.fu += 600;
    const q0 = mot.queue.length, m0 = W.madeOf('us', 'am_jeep');
    out.q = W.queueUnit(mot, 'am_jeep') ? mot.queue.slice(-1)[0] : 'refused';
    out.madeJ = W.madeOf('us', 'am_jeep') - m0;
    mot.queue.length = q0;
    const j = W.spawnUnit('us', 'am_jeep', hq.x + 140, hq.y - 220, 0);
    out.count = W.countOf('us', 'am_jeep');
    const B = W.MODELS.veh.am_jeep;
    out.crew = B && B.crew ? B.crew.n : 0; out.gunner = B && B.turCrew ? B.turCrew.n : 0;
    W.povOn(j);
    const e = W.povEye();
    out.eye = +(e.z - W.groundZ(j.x, j.y)).toFixed(1);
    W.povOff();
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(j); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(j);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(mot);
    return out;
  });
  ok('Omaha: the Americans\' light vehicle is the jeep, with its crew riding in it and none of them in the wreck',
     /am_jeep/.test(jp.makes) && jp.q === 'am_jeep' && jp.madeJ === 1 &&
     jp.count >= 1 && jp.crew > 0 && jp.gunner > 0 && jp.eye > 22 && jp.eye < 29 &&
     jp.blown === 0 && jp.sink < 1.7 && jp.bodies === 2 && jp.bodyNat === 'usa',
     `the barracks makes ${jp.makes}; asked for the jeep it queues ${jp.q}, counted as ${jp.madeJ} made; ` +
     `${jp.count} on the field; crew ${jp.crew} vertices seated and ${jp.gunner} at the gun; the periscope's eye ${jp.eye} up; ` +
     `${jp.blown} of 40 wrecks threw the gun, sat down at most ${jp.sink}; killed, it left ${jp.bodies} bodies of ${jp.bodyNat}`);

  /* --- The M4A1. The Americans' tank: the motor pool turns it out and queues it, the count
     and the order book read it, the man in its hatch is a tanker in the tanker's helmet
     rather than a rifleman in an M1, the eye in the periscope drops from the hatch to the
     seat when the lid shuts, a wreck throws the turret some of the time and not all of it,
     and killed it leaves American bodies. --- */
  const m4 = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const mot = W.spawnBuilding('us', 'us_tank', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(mot).join(',');
    G.res.us.mp += 2000; G.res.us.fu += 600;
    const q0 = mot.queue.length, m0 = W.madeOf('us', 'am_sher');
    out.q = W.queueUnit(mot, 'am_sher') ? mot.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('us', 'am_sher') - m0;
    mot.queue.length = q0;
    const t = W.spawnUnit('us', 'am_sher', hq.x + 140, hq.y - 220, 0);
    out.count = W.countOf('us', 'am_sher');
    const B = W.MODELS.veh.am_sher, H = W.HATCHES.am_sher, A = W.KIT.usa;
    out.bufs = !!(B && B.hull && B.tur && B.mg && B.hatch && B.cmdr && B.leaf && B.inside);
    out.tanker = H.open.filter(f => f.c === A.hide).length;
    out.m1 = H.open.filter(f => f.c === A.helm || f.c === A.helmD).length;
    out.seat = !!(W.MODELS.man.gi_tank && W.MODELS.man.gi_tank[W.POSE_SEAT]);
    W.povOn(t);
    /* the eye off the hull's own footing (`u.gz`), which is where it stands now that it lies on the
       ground: off the ground under its middle, a tank bridging a crater the rows above left there
       read its eye seven units high */
    W.povHatch(true); const up = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povHatch(false); const dn = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povOff();
    out.eyeUp = +up.toFixed(1); out.eyeIn = +dn.toFixed(1);
    const nw = G.wrecks.length;
    let blown = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; }
    G.wrecks.length = nw;
    out.blown = blown;
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(mot);
    return out;
  });
  ok('Omaha: the Americans\' tank is the M4A1, with a tanker in its hatch and American bodies when it burns',
     /am_sher/.test(m4.makes) && m4.q === 'am_sher' && m4.made === 1 &&
     m4.count >= 1 && m4.bufs && m4.tanker > 0 && m4.m1 === 0 && m4.seat &&
     m4.eyeUp > 33 && m4.eyeUp < 40 && m4.eyeIn > 26 && m4.eyeIn < m4.eyeUp - 4 &&
     m4.blown > 2 && m4.blown < 30 && m4.bodies >= 1 && m4.bodyNat === 'usa',
     `the tank yard makes ${m4.makes}; asked for the M4A1 it queues ${m4.q}, counted as ${m4.made} made; ` +
     `${m4.count} on the field; buffers ${m4.bufs ? 'all built' : 'MISSING'}; the man in the hatch has ${m4.tanker} faces of tanker's helmet ` +
     `and ${m4.m1} of M1; the seated tanker ${m4.seat ? 'baked' : 'MISSING'}; the eye ${m4.eyeUp} up out of the hatch and ` +
     `${m4.eyeIn} on the seat; ${m4.blown} of 40 wrecks threw the turret; killed, it left ${m4.bodies} bodies of ${m4.bodyNat}`);

  /* --- The Easy Eight. The M4A3E8 is a tank of its own, made at the tank yard beside the M4A1:
     another hull on other running gear under another turret, drawn from a model of its own,
     with the 76 mm's reach in its eye from the first. The M4A1 has no rebuild left on it. The
     body it is kept out of things by is wider than the M4A1's over the wider track, the eye in
     the periscope stands in the cupola and drops to the seat, and a wreck of one is a wreck of
     the Easy Eight. --- */
  const e8 = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const yard = W.spawnBuilding('us', 'us_tank', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(yard).join(',');
    G.res.us.mp += 2000; G.res.us.fu += 600;
    const q0 = yard.queue.length;
    out.q = W.queueUnit(yard, 'am_e8') ? yard.queue.slice(-1)[0] : 'refused';
    yard.queue.length = q0;
    out.m4ups = (W.UNITS.am_sher.upgrades || []).join(',');
    const m4 = W.spawnUnit('us', 'am_sher', hq.x + 60, hq.y - 260, 0);
    out.eye0 = W.eyeOf(m4); W.unitBody(m4); out.wid0 = +m4.bodyW.toFixed(1);
    W.killUnit(m4);
    const t = W.spawnUnit('us', 'am_e8', hq.x + 140, hq.y - 220, 0);
    out.fitted = !!t.up.e8;
    out.k1 = W.vkey(t); out.n1 = W.nameOf(t); out.s1 = W.shortOf(t);
    const w = W.mainW(t); out.pen = w.pen; out.range = w.range; out.brake = !!w.brake;
    out.eye1 = W.eyeOf(t);
    W.unitBody(t); out.wid1 = +t.bodyW.toFixed(1);
    const B = W.MODELS.veh.am_e8;
    out.bufs = !!(B && B.hull && B.tur && B.mg && B.hatch && B.cmdr && B.leaf && B.inside);
    const mz = W.gunMuzzle(t); out.muz = +Math.hypot(mz.x - t.x, mz.y - t.y).toFixed(1);
    t._matT = -1;
    W.povOn(t);
    W.povHatch(true); const up = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povHatch(false); const dn = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povOff();
    out.eyeUp = +up.toFixed(1); out.eyeIn = +dn.toFixed(1);
    const nw = G.wrecks.length;
    let blown = 0, vk = 0;
    for (let i = 0; i < 40; i++) { const wr = W.makeWreck(t); if (wr.blown) blown++; if (wr.vk === 'am_e8') vk++; }
    G.wrecks.length = nw;
    out.blown = blown; out.vk = vk;
    W.killUnit(t);
    W.killBuilding(yard);
    return out;
  });
  ok('Omaha: the Easy Eight is a tank of its own off the tank yard, drawn, armed and wrecked as one',
     /am_e8/.test(e8.makes) && e8.q === 'am_e8' && !/e8/.test(e8.m4ups) && e8.fitted && e8.k1 === 'am_e8' &&
     e8.pen === 250 && e8.range === 420 && e8.brake && e8.eye1 === 420 && e8.eye0 < e8.eye1 && e8.wid1 > e8.wid0 + 1 &&
     e8.bufs && e8.muz > 50 && e8.eyeUp > 34 && e8.eyeUp < 42 && e8.eyeIn > 26 && e8.eyeIn < e8.eyeUp - 4 &&
     e8.blown > 2 && e8.blown < 30 && e8.vk === 40 && e8.n1 === 'M4A3E8 Sherman' && e8.s1 === 'EASY 8',
     `the tank yard makes ${e8.makes}; asked for the Easy Eight it queues ${e8.q}; the M4A1's fittings ${e8.m4ups || 'none'}; ` +
     `the ${e8.n1} (${e8.s1}) drawn from ${e8.k1}, its rebuild ${e8.fitted ? 'on' : 'NOT on'}, the gun ${e8.pen} of penetration at ` +
     `${e8.range} ${e8.brake ? 'with' : 'WITHOUT'} a brake and an eye of ${e8.eye1} against the M4A1's ${e8.eye0}; its body ${e8.wid1} ` +
     `half-wide against the M4A1's ${e8.wid0}; buffers ${e8.bufs ? 'all built' : 'MISSING'}; the muzzle ${e8.muz} out; the eye ${e8.eyeUp} up out of the ` +
     `cupola and ${e8.eyeIn} on the seat; ${e8.blown} of 40 wrecks threw the turret and ${e8.vk} of them were the Easy Eight`);

  /* --- The KS 750. The 352nd's light vehicle: the depot turns it out and queues it, the
     count and the order book read it, the two men riding it are drawn with it and none of
     them is in its wreck, the gun on the sidecar mount comes round no further than the
     mount lets it, the periscope's eye is the gunner's, low in the sidecar, a wreck never
     throws the gun off, and killed it leaves two bodies of the 352nd. --- */
  const ks = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.side === 'ger' && b.def.hq)[0];
    const dep = W.spawnBuilding(hq.own, 'ger_qtr', hq.x - 240, hq.y + 120, true);
    out.makes = W.makesOf(dep).join(',');
    G.res[hq.own].mp += 2000; G.res[hq.own].fu += 600;
    const q0 = dep.queue.length, m0 = W.madeOf(hq.own, 'hr_ks750');
    out.q = W.queueUnit(dep, 'hr_ks750') ? dep.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf(hq.own, 'hr_ks750') - m0;
    dep.queue.length = q0;
    const k = W.spawnUnit(hq.own, 'hr_ks750', hq.x - 140, hq.y + 220, 0);
    out.count = W.countOf(hq.own, 'hr_ks750');
    const B = W.MODELS.veh.hr_ks750;
    out.crew = B && B.crew ? B.crew.n : 0; out.gunner = B && B.turCrew ? B.turCrew.n : 0;
    out.alt = !!(B && B.turUp && B.turUp.mg42);
    out.seat = !!(W.MODELS.man.hr_krad && W.MODELS.man.hr_krad[W.POSE_SEAT]);
    k.facing = 0; k.turret = 0; k.want = 1.2;
    W.updateModels(k, 1.0);
    out.lay = +Math.abs(W.angDiff(k.facing, k.turret)).toFixed(3);
    out.arc = k.def.arc / 2;
    W.povOn(k);
    const e = W.povEye();
    out.eye = +(e.z - W.groundZ(k.x, k.y)).toFixed(1);
    W.povOff();
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(k); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(k);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(dep);
    return out;
  });
  ok('Omaha: the 352nd\'s light vehicle is the KS 750, its crew riding it, its gun inside the mount\'s arc and none of them in the wreck',
     /hr_ks750/.test(ks.makes) && ks.q === 'hr_ks750' && ks.made === 1 &&
     ks.count >= 1 && ks.crew > 0 && ks.gunner > 0 && ks.alt && ks.seat &&
     ks.lay <= ks.arc + 1e-3 && ks.eye > 12 && ks.eye < 17 &&
     ks.blown === 0 && ks.sink < 1.7 && ks.bodies === 2 && ks.bodyNat === 'heer',
     `the Kaserne makes ${ks.makes}; asked for the KS 750 it queues ${ks.q}, counted as ${ks.made} made; ` +
     `${ks.count} on the field; crew ${ks.crew} vertices on the machine and ${ks.gunner} turning with the gun, the MG 42 ` +
     `${ks.alt ? 'built' : 'MISSING'}, the seated rider ${ks.seat ? 'baked' : 'MISSING'}; asked to lay 1.2 off the nose ` +
     `the gun came to ${ks.lay} against an arc of ${ks.arc}; the periscope's eye ${ks.eye} up; ` +
     `${ks.blown} of 40 wrecks threw the gun, sat down at most ${ks.sink}; killed, it left ${ks.bodies} bodies of ` +
     `${ks.bodyNat}`);

  /* --- The Panzer IV. The 352nd's tank: the depot turns it out and queues it, the count and
     the order book read it, it wears the Wehrmacht's grey and none of the sand camouflage
     the older German armour carries, the man in its cupola wears the black cap and the
     headset and no steel helmet, the seated crewman is baked, the Schürzen and their rails
     go on with the upgrade so the bare hull stands inside its own guards, the eye is a
     little under three metres up out of the cupola and drops to the vision blocks when the
     lid shuts, forty wrecks throw the turret some of the time and not all of it, and killed
     it leaves bodies of the 352nd. --- */
  const p4 = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.side === 'ger' && b.def.hq)[0];
    const dep = W.spawnBuilding(hq.own, 'ger_pz', hq.x - 240, hq.y + 160, true);
    out.makes = W.makesOf(dep).join(',');
    G.res[hq.own].mp += 2000; G.res[hq.own].fu += 600;
    const q0 = dep.queue.length, m0 = W.madeOf(hq.own, 'hr_p4');
    out.q = W.queueUnit(dep, 'hr_p4') ? dep.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf(hq.own, 'hr_p4') - m0;
    dep.queue.length = q0;
    const t = W.spawnUnit(hq.own, 'hr_p4', hq.x - 140, hq.y + 260, 0);
    out.count = W.countOf(hq.own, 'hr_p4');
    const V = W.VMODEL.hr_p4, B = W.MODELS.veh.hr_p4, H = W.HATCHES.hr_p4, K = W.KIT.heer;
    out.bufs = !!(B && B.hull && B.tur && B.mg && B.hatch && B.cmdr && B.leaf && B.inside && B.skirts && B.turSkirts);
    out.grey = V.hull.filter(f => f.c === W.HRG.body).length;
    out.camo = V.hull.concat(V.tur).filter(f => f.c === W.PZ.body).length;
    out.cap = H.open.filter(f => f.c === K.pz).length;
    out.helm = H.open.filter(f => f.c === K.helm || f.c === K.helmD).length;
    out.seat = !!(W.MODELS.man.hr_tank && W.MODELS.man.hr_tank[W.POSE_SEAT]);
    out.hullY = +Math.max.apply(null, V.hull.map(f => Math.max.apply(null, f.v.map(p => Math.abs(p[1]))))).toFixed(2);
    out.skirtY = +Math.max.apply(null, V.skirts.map(f => Math.max.apply(null, f.v.map(p => Math.abs(p[1]))))).toFixed(2);
    W.povOn(t);
    W.povHatch(true); const up = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povHatch(false); const dn = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povOff();
    out.eyeUp = +up.toFixed(1); out.eyeIn = +dn.toFixed(1);
    const nw = G.wrecks.length;
    let blown = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; }
    G.wrecks.length = nw;
    out.blown = blown;
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(dep);
    return out;
  });
  ok('Omaha: the 352nd\'s tank is its own Panzer IV, in the grey, with a panzer man in the cupola and its Schürzen an upgrade',
     /hr_p4/.test(p4.makes) && p4.q === 'hr_p4' && p4.made === 1 &&
     p4.count >= 1 && p4.bufs && p4.grey > 50 && p4.camo === 0 && p4.cap > 0 && p4.helm === 0 &&
     p4.seat && p4.hullY < 17.6 && p4.skirtY > 19 && p4.eyeUp > 32 && p4.eyeUp < 38 && p4.eyeIn > 26 && p4.eyeIn < p4.eyeUp - 4 &&
     p4.blown > 2 && p4.blown < 30 && p4.bodies >= 1 && p4.bodyNat === 'heer',
     `the Panzerpark makes ${p4.makes}; asked for the Panzer IV it queues ${p4.q}, counted as ${p4.made} made; ` +
     `${p4.count} on the field; buffers ${p4.bufs ? 'all built' : 'MISSING'}; ${p4.grey} hull faces in the grey and ${p4.camo} in the sand camouflage; ` +
     `the man in the cupola has ${p4.cap} faces of the black cap and ${p4.helm} of a helmet; the seated crewman ` +
     `${p4.seat ? 'baked' : 'MISSING'}; the bare hull reaches ${p4.hullY} out and the Schürzen ${p4.skirtY}; the eye ${p4.eyeUp} ` +
     `up out of the cupola and ${p4.eyeIn} at the blocks; ${p4.blown} of 40 wrecks threw the turret; killed, it left ` +
     `${p4.bodies} bodies of ${p4.bodyNat}`);

  /* --- The 251. The 352nd's half-track is the Ausf. C: the depot turns it out and queues it,
     the count and the order book read it, it wears the grey and none of the sand, the driver
     rides with the hull and the gunner with the MG 34, both in field grey under a helmet,
     and nobody else is drawn on it. It takes one squad aboard and puts it down again, and a
     squad aboard when it burns comes out alive. The gun comes round no further than the
     pintle lets it, the periscope's eye is the gunner's, standing, forty wrecks never throw
     the gun off and all sit down onto the belly, and killed it leaves bodies of the
     352nd. --- */
  const hk = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.side === 'ger' && b.def.hq)[0];
    const dep = W.spawnBuilding(hq.own, 'ger_dep', hq.x - 240, hq.y + 200, true);
    out.makes = W.makesOf(dep).join(',');
    G.res[hq.own].mp += 2000; G.res[hq.own].fu += 600;
    const q0 = dep.queue.length, m0 = W.madeOf(hq.own, 'hr_251');
    out.q = W.queueUnit(dep, 'hr_251') ? dep.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf(hq.own, 'hr_251') - m0;
    dep.queue.length = q0;
    const v = W.spawnUnit(hq.own, 'hr_251', hq.x - 140, hq.y + 300, 0);
    out.count = W.countOf(hq.own, 'hr_251');
    const V = W.VMODEL.hr_251, B = W.MODELS.veh.hr_251, K = W.KIT.heer;
    out.bufs = !!(B && B.hull && B.tur && B.crew && B.turCrew);
    out.grey = V.hull.filter(f => f.c === W.HRG.body).length;
    out.sand = V.hull.concat(V.tur).filter(f => f.c === W.PZ.body).length;
    out.helm = V.crew.concat(V.turCrew).filter(f => f.c === K.helm || f.c === K.helmD).length;
    out.coat = V.crew.concat(V.turCrew).filter(f => f.c === K.coat || f.c === K.coatD).length;
    out.seat = !!(W.MODELS.man.hr_crew && W.MODELS.man.hr_crew[W.POSE_SEAT]);
    /* one squad aboard, and down again behind it */
    const g = W.spawnUnit(hq.own, 'hr_gren', v.x - 60, v.y, 0);
    out.can = W.canBoard(g, v);
    W.boardVehicle(g, v);
    out.aboard = g.inside === v && v.cargo === g;
    const g2 = W.spawnUnit(hq.own, 'hr_gren', v.x + 60, v.y, 0);
    out.second = W.canBoard(g2, v);
    W.unloadVehicle(v);
    out.down = !g.inside && !v.cargo && Math.hypot(g.x - v.x, g.y - v.y) > 20;
    v.facing = 0; v.turret = 0; v.want = 1.2;
    W.updateModels(v, 1.0);
    out.lay = +Math.abs(W.angDiff(v.facing, v.turret)).toFixed(3);
    out.arc = v.def.arc / 2;
    W.povOn(v);
    out.eye = +(W.povEye().z - (v.gz === undefined ? W.groundZ(v.x, v.y) : v.gz)).toFixed(1);
    W.povOff();
    const nw = G.wrecks.length;
    let blown = 0, sink = 99;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(v); if (w.blown) blown++; sink = Math.min(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    /* and a squad aboard when it burns comes out of it */
    W.boardVehicle(g, v);
    const nc = G.corpses.length;
    W.killUnit(v);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.updateUnit(g, .02);
    out.out = !g.inside && !g.dead && g.models.some(m => m.alive);
    W.killUnit(g); W.killUnit(g2);
    W.killBuilding(dep);
    return out;
  });
  ok('Omaha: the 352nd\'s half-track is its own 251, in the grey, with a driver and a gunner and room for one squad',
     /hr_251/.test(hk.makes) && hk.q === 'hr_251' && hk.made === 1 &&
     hk.count >= 1 && hk.bufs && hk.grey > 50 && hk.sand === 0 && hk.helm > 0 && hk.coat > 0 &&
     hk.seat && hk.can && hk.aboard && !hk.second && hk.down && hk.lay <= hk.arc + 1e-3 && hk.eye > 21 && hk.eye < 27 &&
     hk.blown === 0 && hk.sink >= 2 && hk.bodies >= 1 && hk.bodyNat === 'heer' && hk.out,
     `the depot makes ${hk.makes}; asked for the 251 it queues ${hk.q}, counted as ${hk.made} made; ` +
     `${hk.count} on the field; ` +
     `buffers ${hk.bufs ? 'all built' : 'MISSING'}; ${hk.grey} hull faces in the grey and ${hk.sand} in the sand; the crew have ` +
     `${hk.helm} faces of helmet and ${hk.coat} of field grey, the seated man ${hk.seat ? 'baked' : 'MISSING'}; a squad ` +
     `${hk.can ? 'may board' : 'REFUSED'}, ${hk.aboard ? 'is aboard' : 'is NOT aboard'}, a second ${hk.second ? 'MAY board too' : 'is refused'}, ` +
     `and it is ${hk.down ? 'put down behind' : 'NOT put down'}; asked to lay 1.2 off the nose the gun came to ${hk.lay} against ` +
     `an arc of ${hk.arc}; the periscope's eye ${hk.eye} up; ${hk.blown} of 40 wrecks threw the gun, the least sat down ${hk.sink}; ` +
     `killed, it left ${hk.bodies} bodies of ${hk.bodyNat} and the squad aboard ${hk.out ? 'came out' : 'DID NOT come out'}`);

  /* --- The M3. The Americans' half-track: the motor pool turns it out and queues it, the
     count and the order book read it, it is in olive drab with the driver riding with the
     hull and the gunner with the .50, both in the American's kit, and nobody else is drawn
     on it. It takes one squad aboard and puts it down again, and a squad aboard when it
     burns comes out alive. The pedestal goes all the way round, so the gun is asked to lay
     over the tail; the periscope's eye is the gunner's, standing on the floor behind the
     pedestal, forty wrecks never throw the gun off and all sit down onto the belly, and
     killed it leaves American bodies. --- */
  const mh = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const mot = W.spawnBuilding('us', 'us_mot', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(mot).join(',');
    G.res.us.mp += 2000; G.res.us.fu += 600;
    const q0 = mot.queue.length, m0 = W.madeOf('us', 'am_m3');
    out.q = W.queueUnit(mot, 'am_m3') ? mot.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('us', 'am_m3') - m0;
    mot.queue.length = q0;
    const v = W.spawnUnit('us', 'am_m3', hq.x + 140, hq.y - 220, 0);
    out.count = W.countOf('us', 'am_m3');
    const V = W.VMODEL.am_m3, B = W.MODELS.veh.am_m3, K = W.KIT.usa;
    out.bufs = !!(B && B.hull && B.tur && B.crew && B.turCrew);
    out.od = V.hull.filter(f => f.c === W.MHC.od).length;
    out.helm = V.crew.concat(V.turCrew).filter(f => f.c === K.helm || f.c === K.helmD).length;
    out.coat = V.crew.concat(V.turCrew).filter(f => f.c === K.coat || f.c === K.coatD).length;
    out.seat = !!(W.MODELS.man.gi_crew && W.MODELS.man.gi_crew[W.POSE_SEAT]);
    /* one squad aboard, and down again behind it */
    const g = W.spawnUnit('us', 'am_rifle', v.x - 60, v.y, 0);
    out.can = W.canBoard(g, v);
    W.boardVehicle(g, v);
    out.aboard = g.inside === v && v.cargo === g;
    const g2 = W.spawnUnit('us', 'am_rifle', v.x + 60, v.y, 0);
    out.second = W.canBoard(g2, v);
    W.unloadVehicle(v);
    out.down = !g.inside && !v.cargo && Math.hypot(g.x - v.x, g.y - v.y) > 20;
    v.facing = 0; v.turret = 0; v.want = Math.PI;
    for (let i = 0; i < 3; i++) W.updateModels(v, 1.0);
    out.lay = +Math.abs(W.angDiff(v.facing, v.turret)).toFixed(3);
    W.povOn(v);
    out.eye = +(W.povEye().z - (v.gz === undefined ? W.groundZ(v.x, v.y) : v.gz)).toFixed(1);
    W.povOff();
    const nw = G.wrecks.length;
    let blown = 0, sink = 99;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(v); if (w.blown) blown++; sink = Math.min(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    /* and a squad aboard when it burns comes out of it */
    W.boardVehicle(g, v);
    const nc = G.corpses.length;
    W.killUnit(v);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.updateUnit(g, .02);
    out.out = !g.inside && !g.dead && g.models.some(m => m.alive);
    W.killUnit(g); W.killUnit(g2);
    W.killBuilding(mot);
    return out;
  });
  ok('Omaha: the Americans\' half-track is its own M3, in olive drab, with a driver and a gunner and room for one squad',
     /am_m3/.test(mh.makes) && mh.q === 'am_m3' && mh.made === 1 &&
     mh.count >= 1 && mh.bufs && mh.od > 50 && mh.helm > 0 && mh.coat > 0 && mh.seat &&
     mh.can && mh.aboard && !mh.second && mh.down && mh.lay > 3.1 && mh.eye > 25 && mh.eye < 32 &&
     mh.blown === 0 && mh.sink >= 2 && mh.bodies >= 1 && mh.bodyNat === 'usa' && mh.out,
     `the motor pool makes ${mh.makes}; asked for the M3 it queues ${mh.q}, counted as ${mh.made} made; ` +
     `${mh.count} on the field; ` +
     `buffers ${mh.bufs ? 'all built' : 'MISSING'}; ${mh.od} hull faces in olive drab; the crew have ${mh.helm} faces of ` +
     `helmet and ${mh.coat} of jacket, the seated man ${mh.seat ? 'baked' : 'MISSING'}; a squad ` +
     `${mh.can ? 'may board' : 'REFUSED'}, ${mh.aboard ? 'is aboard' : 'is NOT aboard'}, a second ${mh.second ? 'MAY board too' : 'is refused'}, ` +
     `and it is ${mh.down ? 'put down behind' : 'NOT put down'}; asked to lay over the tail the gun came round ${mh.lay}; ` +
     `the periscope's eye ${mh.eye} up; ${mh.blown} of 40 wrecks threw the gun, the least sat down ${mh.sink}; killed, it ` +
     `left ${mh.bodies} bodies of ${mh.bodyNat} and the squad aboard ${mh.out ? 'came out' : 'DID NOT come out'}`);

  /* --- The 75 mm GMC. A vehicle of its own off the motor pool, which the M3's conversion was:
     the gun, its shield and its two men stand where the pedestal does on the half-track, the
     weapon is the 75, and the carriage traverses about twenty degrees either way, so a gun asked
     to lay over the tail stops at the edge of it and the hull turns to bring it round. There is
     no room in it for a squad, and the half-track has no conversion left on it. The periscope's
     eye is the gunner's stood up behind the shield to look over its roof; the man and the round
     in the loader's hands are drawn with the gun, forty wrecks throw nothing and sit down onto
     the belly, and killed it leaves American bodies. --- */
  const gm = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    G.res.us.mp += 2000; G.res.us.fu += 600;
    const mot = W.spawnBuilding('us', 'us_mot', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(mot).join(',');
    const q0 = mot.queue.length;
    out.q = W.queueUnit(mot, 'am_gmc') ? mot.queue.slice(-1)[0] : 'refused';
    mot.queue.length = q0;
    out.m3ups = (W.UNITS.am_m3.upgrades || []).join(',');
    const v = W.spawnUnit('us', 'am_gmc', hq.x + 140, hq.y - 220, 0);
    out.fit = !!v.up.how75;
    out.mount = W.mountUp(v);
    const g2 = W.spawnUnit('us', 'am_rifle', v.x + 60, v.y, 0);
    out.board = W.canBoard(g2, v);
    const w = W.mainW(v);
    out.dmg = w.dmg; out.pen = w.pen; out.shell = !!w.shell;
    out.arc = W.arcOf(v);
    const V = W.VMODEL.am_m3, B = W.MODELS.veh.am_m3, K = W.KIT.usa;
    out.bufs = !!(B.turUp.how75 && B.turCrewUp.how75 && B.addUp.how75 && B.downUp.how75);
    out.bar = V.barUp.how75.bar;
    out.helm = V.turCrewUp.how75.filter(f => f.c === K.helm || f.c === K.helmD).length;
    out.brass = V.turCrewUp.how75.filter(f => f.c === W.M8C.brass).length;
    v.facing = 0; v.turret = 0; v.want = Math.PI;
    for (let i = 0; i < 3; i++) W.updateModels(v, 1.0);
    out.lay = +Math.abs(W.angDiff(v.facing, v.turret)).toFixed(3);
    v.turret = 0;
    W.povOn(v);
    out.eye = +(W.povEye().z - (v.gz === undefined ? W.groundZ(v.x, v.y) : v.gz)).toFixed(1);
    W.povOff();
    const nw = G.wrecks.length;
    let blown = 0, sink = 99;
    for (let i = 0; i < 40; i++) { const wk = W.makeWreck(v); if (wk.blown) blown++; sink = Math.min(sink, wk.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(v);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killUnit(g2); W.killBuilding(mot);
    return out;
  });
  ok('Omaha: the 75 mm GMC is a vehicle of its own off the motor pool, a gun behind a shield on a twenty-degree carriage with no room for a squad',
     /am_gmc/.test(gm.makes) && gm.q === 'am_gmc' && !/how75/.test(gm.m3ups) && gm.fit && gm.mount === 'how75' && !gm.board &&
     gm.dmg > 50 && gm.pen > 100 && gm.shell && gm.arc > .6 && gm.arc < .8 && gm.bufs && gm.bar > 25 &&
     gm.helm > 0 && gm.brass > 0 && gm.lay > .3 && gm.lay < .4 && gm.eye > 26 && gm.eye < 34 &&
     gm.blown === 0 && gm.sink >= 2 && gm.bodies >= 1 && gm.bodyNat === 'usa',
     `the motor pool makes ${gm.makes}; asked for the GMC it queues ${gm.q}; the half-track's fittings ${gm.m3ups || 'none'}; ` +
     `the gun ${gm.fit ? 'on' : 'NOT on'}, the mount ${gm.mount}, a squad ${gm.board ? 'MAY board' : 'refused'}; ` +
     `the weapon ${gm.dmg} a round at ${gm.pen} of penetration${gm.shell ? ', a shell' : ', NOT a shell'}; the arc ${gm.arc}; ` +
     `buffers ${gm.bufs ? 'all built' : 'MISSING'}, the muzzle ${gm.bar} out; the crew ${gm.helm} faces of helmet and ${gm.brass} of brass; ` +
     `asked to lay over the tail the gun stopped at ${gm.lay}; the periscope's eye ${gm.eye} up; ${gm.blown} of 40 wrecks threw ` +
     `the gun, the least sat down ${gm.sink}; killed, it left ${gm.bodies} bodies of ${gm.bodyNat}`);

  /* --- The Rangers. The Americans' assault squad: the company post makes it and queues it,
     the count and the order book read it, its six men are the leader, three Thompsons and
     the two BAR men, and the two BAR men turn into the bazooka variant when the target is a
     vehicle and fire it turn about, each round leaving from the man who fired it. With both
     of them dead the squad fights with what it has left. The .30 is a field upgrade a squad
     takes through the same doors a vehicle's does, it changes the weapon and two of the
     Thompson men, and a man killed goes down as a Ranger. --- */
  const rg = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const bar = W.spawnBuilding('us', 'us_bar', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(bar).join(',');
    G.res.us.mp += 3000; G.res.us.fu += 600;
    const q0 = bar.queue.length, m0 = W.madeOf('us', 'am_ranger');
    out.q = W.queueUnit(bar, 'am_ranger') ? bar.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('us', 'am_ranger') - m0;
    bar.queue.length = q0;
    const u = W.spawnUnit('us', 'am_ranger', hq.x + 140, hq.y - 220, 0);
    out.count = W.countOf('us', 'am_ranger') >= 1;
    out.men = u.models.length;
    out.vars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.baked = ['rg_lead', 'rg_tommy', 'rg_tommy_b', 'rg_bar', 'rg_zook', 'rg_30']
      .every(v => W.MODELS.man[v] && W.MODELS.man[v][W.POSE_FIRE]);
    /* a vehicle in reach: the swap, the weapon and the man each round leaves from */
    const ks = W.spawnUnit('ger', 'hr_ks750', u.x + 130, u.y, Math.PI);
    u.target = ks;
    out.swap = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.at = W.weaponFor(u, ks) === u.def.at;
    const from = [];
    for (let k = 0; k < 4; k++) {
      u.atcd = 0; u.cd = 0; u.moving = false; u.sup = 0;
      const n = G.shots.length;
      W.fireAt(u, ks, .02);
      const s = G.shots[n];
      if (s && s.kind === 'shell') {
        const who = u.models.findIndex(m => Math.hypot(m.x - s.sx, m.y - s.sy) < .01);
        from.push(who);
      } else from.push('none');
    }
    out.from = from.join(',');
    u.models[1].alive = false; u.models[3].alive = false;
    out.gone = W.weaponFor(u, ks) === W.mainW(u) && !W.launcherLive(u);
    u.models[1].alive = true; u.models[3].alive = true;
    u.target = null;
    W.killUnit(ks);
    /* the upgrade, bought through the brain's own routine and read back off the weapon */
    out.upg = W.upgradable(u) && !!W.UPGRADES.a6;
    const w0 = W.mainW(u);
    const got = W.buyUpgradeAuto('us', [u], { floor: 0, fuFloor: 0 });
    out.fitted = got === u && !!u.up.a6;
    out.wUp = W.mainW(u) === u.def.wUp.a6 && w0 === u.def.w;
    out.up30 = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    /* and a man of it goes down as a Ranger: a man on his feet goes on the falls and one lying
       down straight onto the corpses */
    const m = u.models.filter(q => q.alive)[0], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.bodies = rec ? 1 : 0; out.bodyNat = rec ? rec.nat : '-';
    W.killUnit(u);
    out.fall = !!(W.MODELS.fall.usa_rgr && W.MODELS.dead.usa_rgr);
    W.killBuilding(bar);
    return out;
  });
  ok('Omaha: the Rangers are the Americans\' assault squad, and the BAR men take up the bazookas against armour',
     /am_ranger/.test(rg.makes) && rg.q === 'am_ranger' && rg.made === 1 && rg.count &&
     rg.men === 6 && rg.vars === 'rg_lead,rg_bar,rg_tommy,rg_bar,rg_tommy_b,rg_tommy' && rg.baked &&
     rg.swap === 'rg_lead,rg_zook,rg_tommy,rg_zook,rg_tommy_b,rg_tommy' && rg.at && rg.from === '3,1,3,1' && rg.gone &&
     rg.upg && rg.fitted && rg.wUp && rg.up30 === 'rg_lead,rg_bar,rg_tommy,rg_bar,rg_30,rg_30' &&
     rg.bodies >= 1 && rg.bodyNat === 'usa_rgr' && rg.fall,
     `the barracks makes ${rg.makes}; asked for the Rangers it queues ${rg.q}, counted as ${rg.made} made, ` +
     `${rg.count ? 'one' : 'NONE'} on the field; ${rg.men} men as ${rg.vars}, ` +
     `every variant ${rg.baked ? 'baked' : 'NOT baked'}; with a vehicle in reach ${rg.swap}, the weapon ${rg.at ? 'the bazooka' : 'NOT the bazooka'} ` +
     `and four rounds left from men ${rg.from}; with both BAR men dead the squad ${rg.gone ? 'fights with what it has' : 'STILL FIRES the tube'}; ` +
     `the .30 ${rg.upg ? 'is on offer' : 'is NOT on offer'}, ${rg.fitted ? 'was fitted' : 'was NOT fitted'} and ` +
     `${rg.wUp ? 'changes the weapon' : 'does NOT change the weapon'}, the men then ${rg.up30}; killed, it left ${rg.bodies} bodies ` +
     `of ${rg.bodyNat}, the fall ${rg.fall ? 'baked' : 'MISSING'}`);

  /* --- The Greyhound. The Americans' armoured car: the motor pool makes it and queues it,
     the count and the order book read it, it is in olive drab with the drivers in M1s and
     the turret crew in the tanker's helmet, the coaxial comes with it, and the turret goes
     all the way round. The sand shields and the .30 are the two fittings, bought through
     the brain's own routine: the .30 takes the commander out of the turret to stand up to
     it, and the shields are skirts to a hollow charge the way Schürzen are. The periscope's
     eye is the commander's over the rim, forty wrecks throw the turret some of the time and
     a wreck carries shields only if it had them, and it leaves American bodies. --- */
  const gh = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const mot = W.spawnBuilding('us', 'us_mot', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(mot).join(',');
    G.res.us.mp += 2000; G.res.us.fu += 600;
    const q0 = mot.queue.length, m0 = W.madeOf('us', 'am_m8');
    out.q = W.queueUnit(mot, 'am_m8') ? mot.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('us', 'am_m8') - m0;
    mot.queue.length = q0;
    const v = W.spawnUnit('us', 'am_m8', hq.x + 140, hq.y - 220, 0);
    out.count = W.countOf('us', 'am_m8') >= 1;
    const V = W.VMODEL.am_m8, B = W.MODELS.veh.am_m8, K = W.KIT.usa;
    out.bufs = !!(B && B.hull && B.tur && B.crew && B.turCrew && B.turCrewMg && B.mg && B.skirts);
    out.od = V.hull.filter(f => f.c === W.M8C.od).length;
    out.m1 = V.crew.filter(f => f.c === K.helm || f.c === K.helmD).length;
    out.tanker = V.turCrew.filter(f => f.c === K.hide).length;
    out.mgTanker = V.mgMan.filter(f => f.c === K.hide).length;
    out.gunner = V.turCrewMg.length < V.turCrew.length && V.turCrewMg.filter(f => f.c === K.hide).length > 0;
    out.coax = W.secondaryKeys(v).indexOf('coax') >= 0;
    v.facing = 0; v.turret = 0; v.want = 1.2;
    for (let i = 0; i < 3; i++) W.updateModels(v, 1.0);
    out.lay = +Math.abs(W.angDiff(v.turret, 1.2)).toFixed(3);
    W.povOn(v);
    out.eye = +(W.povEye().z - (v.gz === undefined ? W.groundZ(v.x, v.y) : v.gz)).toFixed(1);
    W.povOff();
    /* the two fittings, the .30 first because the routine reaches it first */
    /* a weak hollow charge into the side, which the shields make burst early */
    const hc = { mm: 14, heat: 1, pen: 30, range: 200 };
    const side0 = W.penVs(hc, 100, v, v.x, v.y + 100);
    const a = W.buyUpgradeAuto('us', [v], { floor: 0, fuFloor: 0, foeAt: true });
    const b = W.buyUpgradeAuto('us', [v], { floor: 0, fuFloor: 0, foeAt: true });
    out.fit = (a === v ? 'x' : '-') + (b === v ? 'x' : '-') + ' ' + Object.keys(v.up).filter(k => v.up[k]).sort().join(',');
    out.sec = W.secondaryKeys(v).join(',');
    out.skirted = W.skirted(v);
    out.side = +(W.penVs(hc, 100, v, v.x, v.y + 100) / Math.max(side0, .01)).toFixed(2);
    const nw = G.wrecks.length;
    let blown = 0, sink = 99, sk = 0;
    for (let i = 0; i < 80; i++) { const w = W.makeWreck(v); if (w.blown) blown++; if (w.skirts) sk++; sink = Math.min(sink, w.sink); }
    const bare = W.spawnUnit('us', 'am_m8', hq.x + 180, hq.y - 260, 0);
    let skBare = 0;
    for (let i = 0; i < 40; i++) { if (W.makeWreck(bare).skirts) skBare++; }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2); out.sk = sk; out.skBare = skBare;
    W.killUnit(bare);
    const nc = G.corpses.length;
    W.killUnit(v);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(mot);
    return out;
  });
  ok('Omaha: the Americans\' armoured car is the M8, with the sand shields and the .30 on the ring as its two fittings',
     /am_m8/.test(gh.makes) && gh.q === 'am_m8' && gh.made === 1 && gh.count &&
     gh.bufs && gh.od > 50 && gh.m1 > 0 && gh.tanker > 0 && gh.mgTanker > 0 && gh.gunner && gh.coax && gh.lay < .05 &&
     gh.eye > 22 && gh.eye < 30 && gh.fit === 'xx fenders,mg' && /coax/.test(gh.sec) && /mg/.test(gh.sec) && gh.skirted &&
     gh.side < .5 && gh.blown > 0 && gh.blown < 80 && gh.sink >= 2 && gh.sk > 0 && gh.skBare === 0 &&
     gh.bodies >= 1 && gh.bodyNat === 'usa',
     `the motor pool makes ${gh.makes}; asked for the M8 it queues ${gh.q}, counted as ${gh.made} made, ` +
     `${gh.count ? 'one' : 'NONE'} on the field; buffers ${gh.bufs ? 'all built' : 'MISSING'}; ` +
     `${gh.od} hull faces in olive drab; the drivers have ${gh.m1} faces of M1 and the turret ${gh.tanker} of the tanker's helmet, ` +
     `the man at the .30 ${gh.mgTanker}, and with it fitted the turret keeps ${gh.gunner ? 'the gunner alone' : 'BOTH MEN'}; the coaxial ` +
     `${gh.coax ? 'comes with it' : 'is MISSING'}; asked to lay 1.2 off the nose the gun is ${gh.lay} short; the periscope's eye ${gh.eye} up; ` +
     `the routine fitted ${gh.fit}, the guns then ${gh.sec}, ${gh.skirted ? 'skirted' : 'NOT skirted'}, a weak hollow charge then through the side ${gh.side}x as often; ` +
     `${gh.blown} of 80 wrecks threw the turret, the least sat down ${gh.sink}, ${gh.sk} of 80 kept shields and ${gh.skBare} of 40 ` +
     `without them; killed, it left ${gh.bodies} bodies of ${gh.bodyNat}`);

  /* --- The 234. The 352nd's armoured car: the depot makes it and queues it, the count and
     the order book read it, it wears the grey and none of the sand camouflage, the gunner
     and the commander are in the black of the Panzer arm and sit with their heads under the
     ridge of the screens, the coaxial comes with it, the turret goes all the way round and
     the periscope's eye is the commander's over the rim. The Puma is a car of its own off the
     same Kraftfahrpark, the 234 under the other turret, and its weapon, its mount, the men in it
     and its eye are the turret's; the 234/1 has no turret swap left on it. Eighty wrecks throw
     the turret some of the time, and killed it leaves bodies of the 352nd. --- */
  const k4 = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.side === 'ger' && b.def.hq)[0];
    const dep = W.spawnBuilding(hq.own, 'ger_dep', hq.x - 240, hq.y + 160, true);
    out.makes = W.makesOf(dep).join(',');
    G.res[hq.own].mp += 2000; G.res[hq.own].fu += 600;
    const q0 = dep.queue.length, m0 = W.madeOf(hq.own, 'hr_234');
    out.q = W.queueUnit(dep, 'hr_234') ? dep.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf(hq.own, 'hr_234') - m0;
    dep.queue.length = q0;
    const v = W.spawnUnit(hq.own, 'hr_234', hq.x - 140, hq.y + 260, 0);
    out.count = W.countOf(hq.own, 'hr_234') >= 1;
    const V = W.VMODEL.hr_234, B = W.MODELS.veh.hr_234, K = W.KIT.heer;
    out.bufs = !!(B && B.hull && B.tur && B.turUp.puma && B.turCrew && B.turCrewUp.puma && B.inside);
    out.grey = V.hull.filter(f => f.c === W.HRG.body || f.c === W.HRG.lit).length;
    out.camo = V.hull.concat(V.tur, V.turUp.puma).filter(f => f.c === W.PZ.body).length;
    out.cap = V.turCrew.filter(f => f.c === K.pz).length;
    out.pumaCap = V.turCrewUp.puma.filter(f => f.c === K.pz).length;
    out.helm = V.turCrew.concat(V.turCrewUp.puma).filter(f => f.c === K.helm || f.c === K.helmD).length;
    /* every point of the two men against the screen over it, which is a plane from each side
       rim up to the ridge */
    const T = W.K41, yh = W.k4Inset(T.plan, T.lean)[2][1];
    out.poke = 0;
    V.turCrew.forEach(f => f.v.forEach(p => { if (p[2] > T.h + T.hinge + (yh - Math.abs(p[1])) * Math.tan(T.close)) out.poke++; }));
    out.coax = W.secondaryKeys(v).indexOf('coax') >= 0;
    v.facing = 0; v.turret = 0; v.want = 1.2;
    for (let i = 0; i < 3; i++) W.updateModels(v, 1.0);
    out.lay = +Math.abs(W.angDiff(v.turret, 1.2)).toFixed(3);
    W.povOn(v);
    out.eye = +(W.povEye().z - (v.gz === undefined ? W.groundZ(v.x, v.y) : v.gz)).toFixed(1);
    W.povOff();
    /* the Puma, a car of its own off the same building */
    const w0 = W.mainW(v), b0 = W.mountPose(v, V).bar;
    out.ups = (W.UNITS.hr_234.upgrades || []).join(',');
    const qp = dep.queue.length;
    out.qp = W.queueUnit(dep, 'hr_puma') ? dep.queue.slice(-1)[0] : 'refused';
    dep.queue.length = qp;
    const pm = W.spawnUnit(hq.own, 'hr_puma', hq.x - 40, hq.y + 260, 0);
    out.fitted = !!pm.up.puma && W.mountUp(pm) === 'puma' && W.vkey(pm) === 'hr_234';
    out.wUp = W.mainW(pm) === pm.def.wUp.puma && w0 === v.def.w;
    out.bar = +b0.toFixed(1) + '>' + (+W.mountPose(pm, V).bar.toFixed(1));
    out.crewUp = W.turCrewOf(pm, B) === B.turCrewUp.puma;
    pm._matT = -1;
    W.povOn(pm);
    out.eyeP = +(W.povEye().z - (pm.gz === undefined ? W.groundZ(pm.x, pm.y) : pm.gz)).toFixed(1);
    W.povOff();
    W.killUnit(pm);
    const nw = G.wrecks.length;
    let blown = 0, sink = 99;
    for (let i = 0; i < 80; i++) { const w = W.makeWreck(v); if (w.blown) blown++; sink = Math.min(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(v);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(dep);
    return out;
  });
  ok('Omaha: the 352nd\'s armoured car is the 234, the 2 cm under its screens, and the Puma a car of its own',
     /hr_234/.test(k4.makes) && k4.q === 'hr_234' && k4.made === 1 && k4.count &&
     k4.bufs && k4.grey > 50 && k4.camo === 0 && k4.cap > 0 && k4.pumaCap > 0 && k4.helm === 0 && k4.poke === 0 && k4.coax &&
     k4.lay < .05 && k4.eye > 22 && k4.eye < 27 && k4.qp === 'hr_puma' && !/puma/.test(k4.ups) && k4.fitted && k4.wUp && k4.bar === '22>37.4' && k4.crewUp &&
     k4.eyeP > 30 && k4.eyeP < 38 && k4.blown > 0 && k4.blown < 80 && k4.sink >= 2 &&
     k4.bodies >= 1 && k4.bodyNat === 'heer',
     `the Kraftfahrpark makes ${k4.makes}; asked for the 234 it queues ${k4.q}, counted as ${k4.made} made, ` +
     `${k4.count ? 'one' : 'NONE'} on the field; buffers ${k4.bufs ? 'all built' : 'MISSING'}; ` +
     `${k4.grey} hull faces in the grey and ${k4.camo} in the sand camouflage; the 234/1's men have ${k4.cap} faces of the black ` +
     `cap, the Puma's commander ${k4.pumaCap}, and ${k4.helm} of a helmet between them; ${k4.poke} points of the two men above the ` +
     `screens; the coaxial ${k4.coax ? 'comes with it' : 'is MISSING'}; asked to lay 1.2 off the nose the turret is ${k4.lay} short; ` +
     `the eye ${k4.eye} up; the 234's fittings ${k4.ups || 'none'}; asked for the Puma it queues ${k4.qp}, its turret ${k4.fitted ? 'on' : 'NOT on'}, ` +
     `the weapon ${k4.wUp ? 'the 5 cm' : 'NOT the 5 cm'}, the muzzle ` +
     `${k4.bar}, the crew ${k4.crewUp ? 'the Puma\'s' : 'NOT the Puma\'s'} and the eye ${k4.eyeP} up; ${k4.blown} of 80 wrecks threw ` +
     `the turret, the least sat down ${k4.sink}; killed, it left ${k4.bodies} bodies of ${k4.bodyNat}`);

  /* --- The Knight's Cross Holders. The 352nd's assault squad: the company post makes it and
     queues it, the count and the order book read it, its four men are the four variants
     carrying the StG 44 and every one of them is baked winding up and letting go, with a
     stick grenade and with the bundle. Then the two throws, as the player gives them and not
     by calling the functions behind them: the GRENADES card sends one grenade from every man
     at a squad in reach, each lies on the ground three quarters of a second after it lands
     before it goes off, the card then reads a cooldown and a second volley is refused, and
     with nothing in reach it is refused for that; the BUNDLE CHARGE card arms the pick, a
     tap on a Panzer IV sends the squad after it, one man throws, the charge lodges on the
     hull, goes off three quarters of a second later and takes a third of the tank. The
     brain's own routine uses both, the SIMPLE card carries both at 44px, and a man killed
     goes down as `heer_kch`. The drill is staged on ground of its own with the battle's
     units put aside, and the squad is on the player's slot, because the cards are his. --- */
  const kc = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    /* on whichever side the player is on by now, and under the classic scheme, because the
       cards are his and the rows above leave him on either */
    const me = G.own, foe = G.side === 'us' ? 'ger' : 'us', ctrl0 = W.CTRL.simple;
    W.ctrlSet(false, true);
    /* the finger is installed on the window, and the map rows above have reloaded it since */
    if (!W.__tev) {
      const cv = document.getElementById('cv');
      W.__tev = function (type, x, y) {
        const r = cv.getBoundingClientRect();
        const t = new Touch({ identifier: 1, target: cv, clientX: r.left + x, clientY: r.top + y, pageX: r.left + x, pageY: r.top + y });
        const up = type === 'touchend';
        cv.dispatchEvent(new TouchEvent(type, { touches: up ? [] : [t], changedTouches: [t], targetTouches: up ? [] : [t], bubbles: true, cancelable: true }));
      };
    }
    const hq = G.blds.filter(b => b.side === 'ger' && b.def.hq)[0];
    const post = W.spawnBuilding(hq.own, 'ger_qtr', hq.x - 240, hq.y + 200, true);
    out.makes = W.makesOf(post).join(',');
    G.res[hq.own].mp += 2000; G.res[hq.own].fu += 600;
    const q0 = post.queue.length, m0 = W.madeOf(hq.own, 'hr_kch');
    out.q = W.queueUnit(post, 'hr_kch') ? post.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf(hq.own, 'hr_kch') - m0;
    post.queue.length = q0;
    W.killBuilding(post);
    out.baked = ['kc_lead', 'kc_stg', 'kc_stg_b', 'kc_bund'].every(v => {
      const T = W.MODELS.man[v];
      return T && T[W.POSE_FIRE] && T[W.POSE_THROW] && T[W.POSE_THROW].frames.length === 2 &&
             T[W.POSE_THROWB] && T[W.POSE_THROWB].frames.length === 2;
    });
    const keep = G.units.slice(), mode0 = G.mode;
    G.units.length = 0;
    const sp = W.__o.flatSpot(260), dt = 1 / 30;
    let posed = 0;
    const step = n => {
      for (let i = 0; i < n; i++) {
        G.t += dt; W.computeVisibility(dt);
        G.units.slice().forEach(q => W.updateUnit(q, dt)); W.updateShots(dt);
        if (G.units.some(q => q.key === 'hr_kch' && q.models.some(m => m.alive && m.pose === W.POSE_THROW))) posed++;
      }
    };
    const prime = (a, b) => { for (let s = 0; s < 400; s++) { W.computeVisibility(0); if (W.visibleTo(a.side, b) && W.visibleTo(b.side, a)) break; } };
    const menHp = e => e.models.reduce((s, m) => s + (m.alive ? m.hp : 0), 0);
    const u = W.spawnUnit(me, 'hr_kch', sp.x + 70, sp.y, Math.PI);
    out.count = W.countOf(me, 'hr_kch') >= 1;
    out.men = u.models.length; out.vet = u.vet;
    out.vars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.weap = [...new Set(u.models.map((m, i) => W.SOLDIER_VARIANTS[W.variantForModel(u, i)].weapon))].join(',');
    /* GRENADES, off the card */
    const e = W.spawnUnit(foe, 'hr_gren', sp.x - 60, sp.y, 0);
    e.order = null; e.path = null;
    prime(u, e);
    const land = [], b0 = W.grenBurst;
    W.grenBurst = function (s) {
      const h0 = menHp(e);
      const r = b0(s);
      /* and where it lay on the hull: on top of it, and not inside the turret */
      let oz = null, clear = false;
      if (s.on) {
        const D = W.deckGrid(s.on.key), mp = W.mountPose(s.on, W.VMODEL[s.on.key]), tr = s.on.turret - s.on.facing;
        const qx = s.ox - mp.x, qy = s.oy - mp.y;
        const tz = D.tur ? W.deckAt(D.tur, qx * Math.cos(tr) + qy * Math.sin(tr), -qx * Math.sin(tr) + qy * Math.cos(tr)) + mp.z : -1e9;
        oz = +s.oz.toFixed(1); clear = tz < s.oz + 1.5 && Math.abs(W.deckAt(D.hull, s.ox, s.oy) - s.oz) < .01;
      }
      land.push({ fuse: G.t - s.landT, bund: s.bund, on: s.on ? s.on.key : '', oz, clear, hurt: h0 - menHp(e) });
      return r;
    };
    W.select([u], false); W.syncHud();
    const card = [...document.querySelectorAll('#cmds .cmd')].find(b => /Grenades/.test(b.title));
    out.card = card ? card.querySelector('.c').textContent : 'MISSING';
    if (card) card.click();
    out.cd = u.abCd && u.abCd.gren;
    out.again = W.abGren(u);
    const rel = new Set();
    for (let k = 0; k < 150; k++) { step(1); G.shots.forEach(s => { if (s.kind === 'gren' && s.owner === u) rel.add(s); }); }
    W.refreshCmdState();
    const card2 = [...document.querySelectorAll('#cmds .cmd')].find(b => /Grenades/.test(b.title));
    out.cardAfter = card2 ? card2.querySelector('.c').textContent + (card2.disabled ? ' (dimmed)' : '') : 'MISSING';
    out.thrown = rel.size; out.posed = posed;
    out.fuse = land.filter(q => !q.bund).map(q => +q.fuse.toFixed(3));
    out.gHurt = Math.round(land.filter(q => !q.bund).reduce((s, q) => s + q.hurt, 0));
    W.killUnit(e);
    u.abCd.gren = 0;
    out.none = W.abGren(u);
    /* BUNDLE CHARGE: the card arms the pick and a finger on the tank sends them */
    const v = W.spawnUnit(foe, 'hr_p4', sp.x - 150, sp.y, 0);
    v.order = null; v.path = null; v.cd = 1e9; v.atcd = 1e9;
    W.secondaryKeys(v).forEach(k => { v.cdSec[k] = 1e9; });
    prime(u, v);
    W.select([u], false); W.syncHud();
    const bcard = [...document.querySelectorAll('#cmds .cmd')].find(b => /Bundle charge/.test(b.title));
    out.bcard = !!bcard;
    if (bcard) bcard.click();
    out.mode = G.mode;
    W.__o.camera({ x: v.x, y: v.y, dist: 420, pitch: 0.95 }); W.render();
    const p = W.w2s(v.x, v.y, W.groundZ(v.x, v.y) + 10);
    W.__tev('touchstart', p.x, p.y); W.__tev('touchend', p.x, p.y);
    out.order = u.order; out.modeAfter = G.mode || 'none';
    const hv0 = v.hp, x0 = u.x;
    land.length = 0;
    for (let k = 0; k < 30 * 25 && !land.some(q => q.bund); k++) step(1);
    const bl = land.filter(q => q.bund)[0];
    out.bFuse = bl ? +bl.fuse.toFixed(3) : -1; out.bOn = bl ? bl.on : '-';
    out.bOz = bl ? bl.oz : null; out.bClear = !!(bl && bl.clear);
    out.walked = Math.round(Math.abs(u.x - x0));
    out.pzLost = Math.round(hv0 - v.hp); out.bcd = Math.round(u.abCd && u.abCd.bund || 0);
    /* the brain's own routine, with both back */
    u.abCd.gren = 0; u.abCd.bund = 0; W.clearOrder(u);
    const e2 = W.spawnUnit(foe, 'hr_gren', u.x - 110, u.y, 0);
    e2.order = null; e2.path = null;
    prime(u, e2);
    out.auto = W.abAuto(u);
    out.autoOrder = u.order;
    /* the SIMPLE card */
    u.abCd.bund = 0; W.clearOrder(u); G.mode = null;
    W.ctrlSet(true, true); W.simpleUnit(u);
    out.simple = ['ab_gren', 'ab_bund'].map(k => {
      const b = document.querySelector('#tunitbtns [data-up="' + k + '"]');
      return b ? Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height) | 0 : 0;
    });
    const sb = document.querySelector('#tunitbtns [data-up="ab_bund"]');
    if (sb) sb.click();
    out.simpleMode = G.mode || 'none';
    W.simpleUnit(null); W.ctrlSet(ctrl0, true); G.mode = mode0;
    /* a man of it goes down as the 352nd's Knight's Cross Holders */
    const m = u.models.filter(q => q.alive)[0], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.fellNat = rec ? rec.nat : '-';
    out.bodies = !!(W.MODELS.fall.heer_kch && W.MODELS.dead.heer_kch);
    W.grenBurst = b0;
    [u, v, e2].forEach(q => { if (!q.dead) W.killUnit(q); });
    for (let k = G.shots.length - 1; k >= 0; k--) if (G.shots[k].kind === 'gren') G.shots.splice(k, 1);
    G.units.length = 0; keep.forEach(q => G.units.push(q));
    W.select([], false); W.syncHud();
    return out;
  });
  ok('Omaha: the Knight\'s Cross Holders are the 352nd\'s assault squad, and throw grenades and a bundle charge on the player\'s word',
     /hr_kch/.test(kc.makes) && kc.q === 'hr_kch' && kc.made === 1 && kc.count &&
     kc.men === 4 && kc.vet === 1 && kc.vars === 'kc_lead,kc_stg,kc_stg_b,kc_bund' && kc.weap === 'stg' && kc.baked &&
     kc.card === 'ready' && kc.cd > 30 && kc.again === 'cooling' && kc.thrown === 4 && kc.posed > 0 &&
     kc.fuse.length === 4 && kc.fuse.every(f => f > .72 && f < .79) && kc.gHurt > 0 && /s \(dimmed\)$/.test(kc.cardAfter) &&
     kc.none === 'nothing in reach' && kc.bcard && kc.mode === 'bundle' && kc.order === 'bundle' && kc.modeAfter === 'none' &&
     kc.bFuse > .72 && kc.bFuse < .79 && kc.bOn === 'hr_p4' && kc.bClear && kc.pzLost >= 200 && kc.bcd > 40 && kc.walked > 20 &&
     kc.auto === 3 && kc.autoOrder === 'bundle' && kc.simple.every(s => s >= 44) && kc.simpleMode === 'bundle' &&
     kc.fellNat === 'heer_kch' && kc.bodies,
     `the Kaserne makes ${kc.makes}; asked for the squad it queues ${kc.q}, counted as ${kc.made} made, ` +
     `${kc.count ? 'one' : 'NONE'} on the field; ${kc.men} men at ` +
     `veterancy ${kc.vet} as ${kc.vars} carrying ${kc.weap}, the throw ${kc.baked ? 'baked' : 'NOT baked'}; the GRENADES card read ` +
     `${kc.card} and threw ${kc.thrown} (a man in the throw on ${kc.posed} frames), each going off ${kc.fuse.join(', ')} s after it ` +
     `landed and ${kc.gHurt} off the squad between them; the cooldown ${kc.cd}, a second volley ${kc.again}, the card then ` +
     `${kc.cardAfter}; with nothing near, ${kc.none}; the BUNDLE card ${kc.bcard ? 'armed ' + kc.mode : 'MISSING'}, a tap on the ` +
     `tank left the squad ${kc.order} and the pick ${kc.modeAfter}; it walked ${kc.walked}, the charge went off ${kc.bFuse} s after ` +
     `it came down on ${kc.bOn}, lying ${kc.bOz} up and ${kc.bClear ? 'clear of' : 'INSIDE'} the turret, and took ${kc.pzLost} off it, cooling ${kc.bcd}; the brain's routine answered ${kc.auto} and left ` +
     `the squad ${kc.autoOrder}; the SIMPLE card's two are ${kc.simple.join(' and ')}px and BUNDLE armed ${kc.simpleMode}; a man ` +
     `killed went down as ${kc.fellNat}, bodies ${kc.bodies ? 'baked' : 'MISSING'}`);

  /* --- The .30 cal team. The Americans' machine gun team: the company post makes it and
     queues it, the count and the order book read it, and it is four men -- the gunner and
     his number two, and two ammunition bearers with the M1 carbine -- every one of them with
     two belts of rounds crossed on his chest. Packed, the gun is on the gunner's shoulder
     and the tripod on his number two's, drawn at the point the bake read off each man's
     shoulder, and a box in each bearer's hand; set up, the gunner sits behind the gun, his
     number two kneels at its left where the belt goes in and the bearers are back either
     side. The .50 is a field upgrade bought through the brain's own routine, and it changes
     the weapon, the piece, the pieces carried, the men's places and the bodies at the gun.
     A man killed goes down as one of the team. --- */
  const mg = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const bar = W.spawnBuilding('us', 'us_bar', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(bar).join(',');
    G.res.us.mp += 3000; G.res.us.fu += 600;
    const q0 = bar.queue.length, m0 = W.madeOf('us', 'am_mg');
    out.q = W.queueUnit(bar, 'am_mg') ? bar.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('us', 'am_mg') - m0;
    bar.queue.length = q0;
    /* On open ground with nothing to take cover in. Four battles have been fought on this
       beach by the time the row runs, and a halt in cover beside something solid leaves the
       number two in his slot when the gun is across the wall from him, which is right and is
       not what the row is asking. So the walk and the halt are both on clear sand. */
    const openAt = (x, y) => {
      for (let dx = -60; dx <= 360; dx += 20) for (let dy = -60; dy <= 60; dy += 20)
        if (!W.walkable(x + dx, y + dy) || W.inMasonry(x + dx, y + dy)) return false;
      return !G.covers.some(c => Math.hypot(c.x - x - 300, c.y - y) < c.r + 110);
    };
    let at = null;
    for (let r = 0; r < 1400 && !at; r += 40)
      for (let k = 0; k < 24 && !at; k++) {
        const x = hq.x - 150 + r * Math.cos(k * Math.PI / 12), y = hq.y - 500 + r * Math.sin(k * Math.PI / 12);
        if (openAt(x, y)) at = { x, y };
      }
    out.open = !!at; out.at = at ? Math.round(at.x - hq.x) + ',' + Math.round(at.y - hq.y) : '-';
    if (!at) at = W.nearestFree(hq.x + 160, hq.y - 260);
    const u = W.spawnUnit('us', 'am_mg', at.x, at.y, 0);
    out.count = W.countOf('us', 'am_mg') >= 1;
    out.men = u.models.length;
    out.baked = ['gi_mgg', 'gi_mgc', 'gi_mga'].every(v => W.MODELS.man[v] && W.MODELS.man[v][W.POSE_STAND] && W.MODELS.man[v][W.POSE_WALK]) &&
                !!W.MODELS.man.gi_mga[W.POSE_FIRE] && !!(W.MODELS.served.am_mg && W.MODELS.served.am_mg.mate) &&
                !!(W.MODELS.served['am_mg:m2hb'] && W.MODELS.served['am_mg:m2hb'].mate);
    /* the belts, which are what the four of them have that the rifleman has not */
    const K = W.KIT.usa, belt = W.manFaces('gi_mga', W.FIGPOSE.stand).faces.filter(f => f.c === K.brass || f.c === K.mgbelt).length;
    const plain = W.manFaces('gi_rifle', W.FIGPOSE.stand).faces.filter(f => f.c === K.brass || f.c === K.mgbelt).length;
    out.belts = belt + '/' + plain;
    /* packed and walking: the pieces on the two men's shoulders and a box in each bearer's hand */
    const step = function (s) { for (let i = 0; i < s * 30; i++) { G.t += 1 / 30; W.updateUnit(u, 1 / 30); W.updateModels(u, 1 / 30); } };
    u.packed = true; u.setup = 0; u.pack = 0;
    u.dest = { x: u.x + 300, y: u.y }; u.path = W.findPath(u.x, u.y, u.x + 300, u.y, u); u.pi = 0;
    step(1.5);
    out.walkVars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.carried = W.carried(u);
    const piece = i => { const v = W.variantForModel(u, i); return W.mgCarryAt(u, u.models[i], i, v) ? W._mgc.buf : null; };
    const C = W.MODELS.carry;
    out.pieces = [piece(0) === C.a4, piece(1) === C.m2, piece(2) === C.can30, piece(3) === C.can30].join(',');
    const h = W.holdAt('gi_mgc', u.models[0]), hb = W.holdAt('gi_mga', u.models[2]);
    out.shoulder = h ? +h[2].toFixed(1) : -1; out.hand = hb ? +hb[2].toFixed(1) : -1;
    /* halted: set up, and each man at his place round the gun */
    u.path = null; u.dest = null;
    step(5);
    out.set = W.gunSet(u);
    out.setVars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.poses = u.models.map(m => m.pose).join(',');
    const gp = W.gunPost(u), cs = Math.cos(u.facing), sn = Math.sin(u.facing);
    const rel = m => { const dx = m.x - gp.x, dy = m.y - gp.y; return [dx * cs + dy * sn, -dx * sn + dy * cs]; };
    const r1 = rel(u.models[1]), r2 = rel(u.models[2]), r3 = rel(u.models[3]);
    out.mate = r1.map(v => +v.toFixed(1)).join(','); out.mateLeft = r1[1] < -3;
    /* the bearers are back either side of the gun, or in whatever cover the halt gave them */
    out.bearers = (u.coverSlots && u.coverSlots[2] && u.coverSlots[3]) ? 'cover' : r2[0] < -4 && r3[0] < -4 && r2[1] * r3[1] < 0;
    out.mateFaces = Math.abs(W.angDiff(u.models[1].f, u.facing + Math.PI / 2)) < .25;
    /* and when he is not, where he was sent and whether he could stand there */
    const ma = gd0 => { const a = gd0.gunMate.at, k = W.FIG_SCALE; return { x: gp.x + (a[0] * cs - a[1] * sn) * k, y: gp.y + (a[0] * sn + a[1] * cs) * k }; };
    const mt = ma(W.gunOf(u)), g0 = u.models[0];
    out.why = 'gunner ' + Math.hypot(g0.x - u.x, g0.y - u.y).toFixed(1) + ' off the mark of ' + W.selRadius(u).toFixed(1) +
      ', his place ' + Math.hypot(mt.x - u.x, mt.y - u.y).toFixed(1) + ' off it ' + (W.walkable(mt.x, mt.y) ? 'walkable' : 'NOT walkable') +
      (W.inMasonry(mt.x, mt.y) ? ' in masonry' : '') + ', ' + (u.target ? 'a target' : 'no target') + (u.moving ? ', moving' : '') +
      (u.gar ? ', garrisoned' : '') + (u.coverSlots ? ', in cover' : '');
    out.mesh = W.teamMesh(u) === W.MODELS.gun.am_mg;
    /* the flash leaves the gun's muzzle, not the man: the point, and not only its distance from
       the gun, because the layer sits a little off the gun's line and a flash laid off him came
       out beside the muzzle at the right distance from the gun */
    const mz = W.muzzlePoint(u, u.models[0], 0), gd = W.gunOf(u);
    out.muz = Math.hypot(mz.x - gp.x - Math.cos(u.facing) * gd.gunMuz[0] * W.FIG_SCALE, mz.y - gp.y - Math.sin(u.facing) * gd.gunMuz[0] * W.FIG_SCALE) < 1;
    /* the .50 */
    out.upg = W.upgradable(u) && !!W.UPGRADES.m2hb;
    const w0 = W.mainW(u);
    const got = W.buyUpgradeAuto('us', [u], { floor: 0, fuFloor: 0 });
    out.fitted = got === u && !!u.up.m2hb;
    out.wUp = W.mainW(u) === u.def.wUp.m2hb && w0 === u.def.w && W.mainW(u).pen > w0.pen && W.mainW(u).range > w0.range;
    out.mesh50 = W.teamMesh(u) === W.MODELS.gun['am_mg:m2hb'] && W.gunOf(u) === u.def.gunUp.m2hb &&
                 W.servedOf(u) === W.MODELS.served['am_mg:m2hb'];
    u.packed = true; u.setup = 0;
    out.pieces50 = [piece(0) === C.m2hb, piece(1) === C.m3, piece(2) === C.can50].join(',');
    u.packed = false;
    /* a man of it goes down as one of the team */
    const m = u.models[2], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.bodyNat = rec ? rec.nat : '-';
    out.fall = !!(W.MODELS.fall.usa_mg && W.MODELS.dead.usa_mg);
    W.killUnit(u);
    W.killBuilding(bar);
    return out;
  });
  ok('Omaha: the .30 cal team carries its gun and tripod, and is issued the .50',
     /am_mg/.test(mg.makes) && mg.q === 'am_mg' && mg.made === 1 && mg.count &&
     mg.open && mg.men === 4 && mg.baked && +mg.belts.split('/')[0] > 20 && +mg.belts.split('/')[1] === 0 &&
     mg.walkVars === 'gi_mgc,gi_mgc,gi_mga,gi_mga' && mg.carried && mg.pieces === 'true,true,true,true' &&
     mg.shoulder > 15 && mg.shoulder < 20 && mg.hand > 7 && mg.hand < 12 &&
     mg.set && mg.setVars === 'gi_mgg,gi_mgg,gi_mga,gi_mga' && /^10,11,/.test(mg.poses) && mg.mateLeft && mg.mateFaces && mg.bearers &&
     mg.mesh && mg.muz && mg.upg && mg.fitted && mg.wUp && mg.mesh50 && mg.pieces50 === 'true,true,true' &&
     mg.bodyNat === 'usa_mg' && mg.fall,
     (mg.open ? '' : 'NO open ground to stage on; ') + `the barracks makes ${mg.makes}; asked for the team it queues ${mg.q}, counted as ${mg.made} made, ` +
     `${mg.count ? 'one' : 'NONE'} on the field; ${mg.men} men, every variant ` +
     `and both pieces' bodies at the gun ${mg.baked ? 'baked' : 'NOT baked'}; belt faces on a bearer against a rifleman ${mg.belts}; ` +
     `walking ${mg.walkVars}, ${mg.carried ? 'carried' : 'NOT carried'}, gun, tripod and boxes ${mg.pieces}, the load at ${mg.shoulder} ` +
     `on the shoulder and ${mg.hand} in the hand; halted ${mg.set ? 'set up' : 'NOT set up'} as ${mg.setVars} in poses ${mg.poses}, ` +
     `the number two at ${mg.mate} ${mg.mateFaces ? 'facing the gun' : 'NOT facing the gun'}${mg.mateLeft && mg.mateFaces ? '' : ' (' + mg.why + ')'}, the bearers ${mg.bearers === 'cover' ? 'in cover' : mg.bearers ? 'back either side' : 'NOT in place'}, ` +
     `the piece ${mg.mesh ? 'the .30' : 'WRONG'} and the flash ${mg.muz ? 'at the muzzle' : 'OFF the muzzle'}; the .50 ${mg.upg ? 'on offer' : 'NOT on offer'}, ` +
     `${mg.fitted ? 'fitted' : 'NOT fitted'}, the weapon ${mg.wUp ? 'changed' : 'NOT changed'}, the piece and bodies ${mg.mesh50 ? 'changed' : 'NOT changed'}, ` +
     `carried ${mg.pieces50}; killed went down as ${mg.bodyNat}, bodies ${mg.fall ? 'baked' : 'MISSING'}`);

  /* --- The MG 34 team. The 352nd's machine gun team: the company post makes it and queues
     it, the count and the order book read it, and it is four men -- the gunner and his
     number two, and two riflemen with the Kar98k -- every one of them with two belts crossed
     on his chest. Packed, the gun is on the gunner's right shoulder and the Lafette folded on
     his number two's back, drawn at the points the bake read off each man, and a box in each
     bearer's hand; set up, the gunner sits behind the gun with the butt in his right
     shoulder, which is measured off the model, his number two kneels at its left where the
     belt goes in and the bearers are back either side. The MG 42 is a field upgrade bought
     through the brain's own routine, and it changes the weapon, the gun in the cradle, the
     gun carried and the bodies at it. A man killed goes down as one of the team. --- */
  const hmg = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0], ghq = G.blds.filter(b => b.own === 'ger' && b.def.hq)[0];
    const post = W.spawnBuilding('ger', 'ger_qtr', ghq.x - 240, ghq.y + 120, true);
    out.makes = W.makesOf(post).join(',');
    G.res.ger.mp += 3000; G.res.ger.fu += 600;
    const q0 = post.queue.length, m0 = W.madeOf('ger', 'hr_mg');
    out.q = W.queueUnit(post, 'hr_mg') ? post.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('ger', 'hr_mg') - m0;
    post.queue.length = q0;
    /* staged on the open sand, for the .30 cal row's reason */
    const openAt = (x, y) => {
      for (let dx = -60; dx <= 360; dx += 20) for (let dy = -60; dy <= 60; dy += 20)
        if (!W.walkable(x + dx, y + dy) || W.inMasonry(x + dx, y + dy)) return false;
      return !G.covers.some(c => Math.hypot(c.x - x - 300, c.y - y) < c.r + 110);
    };
    let at = null;
    for (let r = 0; r < 1400 && !at; r += 40)
      for (let k = 0; k < 24 && !at; k++) {
        const x = hq.x - 150 + r * Math.cos(k * Math.PI / 12 + .13), y = hq.y - 500 + r * Math.sin(k * Math.PI / 12 + .13);
        if (openAt(x, y)) at = { x, y };
      }
    out.open = !!at;
    if (!at) at = W.nearestFree(hq.x + 160, hq.y - 260);
    const u = W.spawnUnit('ger', 'hr_mg', at.x, at.y, 0);
    out.count = W.countOf('ger', 'hr_mg') >= 1;
    out.men = u.models.length;
    out.baked = ['hr_mgg', 'hr_mgc', 'hr_mgl', 'hr_mga', 'hr_mga_b'].every(v => W.MODELS.man[v] && W.MODELS.man[v][W.POSE_STAND] && W.MODELS.man[v][W.POSE_WALK]) &&
                !!W.MODELS.man.hr_mga[W.POSE_FIRE] && !!(W.MODELS.served.hr_mg && W.MODELS.served.hr_mg.mate) &&
                !!(W.MODELS.served['hr_mg:mg42t'] && W.MODELS.served['hr_mg:mg42t'].mate);
    const K = W.KIT.heer, belt = W.manFaces('hr_mga', W.FIGPOSE.stand).faces.filter(f => f.c === K.brass || f.c === K.mgbelt).length;
    const plain = W.manFaces('gr_rifle', W.FIGPOSE.stand).faces.filter(f => f.c === K.brass || f.c === K.mgbelt).length;
    out.belts = belt + '/' + plain;
    /* the butt in his right shoulder: the heel of each gun's butt, off the gun's own faces and
       put where the cradle holds it, against the seated gunner's shoulder joint moved to the
       side of the bore he sits on */
    const heel = (g, gd) => {
      const f = W.weaponModel(K, g), xs = [];
      f.forEach(q => q.v.forEach(v => xs.push(v)));
      const x0 = Math.min(...xs.map(v => v[0])), back = xs.filter(v => v[0] < x0 + .15);
      const zc = back.reduce((a, v) => a + v[2], 0) / back.length;
      return [gd.gunAt + x0 + W.LAF.gx, -gd.gunY, zc + W.LAF.gz];
    };
    const P = W.FIGPOSE[u.def.gunSit], sh = W.manFaces('hr_mgg', { legs: P.legs, lean: P.lean, carry: 'grips', grips: P.grips }).joints.shoulderR;
    const gap = h => +Math.hypot(h[0] - sh[0], h[1] - sh[1], h[2] - sh[2]).toFixed(2);
    out.butt34 = gap(heel('mg34', u.def)); out.butt42 = gap(heel('mg42', u.def.gunUp.mg42t));
    const step = function (s) { for (let i = 0; i < s * 30; i++) { G.t += 1 / 30; W.updateUnit(u, 1 / 30); W.updateModels(u, 1 / 30); } };
    u.packed = true; u.setup = 0; u.pack = 0;
    u.dest = { x: u.x + 300, y: u.y }; u.path = W.findPath(u.x, u.y, u.x + 300, u.y, u); u.pi = 0;
    step(1.5);
    out.walkVars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.carried = W.carried(u);
    const piece = i => { const v = W.variantForModel(u, i); return W.mgCarryAt(u, u.models[i], i, v) ? W._mgc.buf : null; };
    const C = W.MODELS.carry;
    out.pieces = [piece(0) === C.mg34, piece(1) === C.laf, piece(2) === C.pk34, piece(3) === C.pk34].join(',');
    const h = W.holdAt('hr_mgc', u.models[0]), hl = W.holdAt('hr_mgl', u.models[1]), hb = W.holdAt('hr_mga', u.models[2]);
    out.shoulder = h ? +h[2].toFixed(1) : -1; out.hand = hb ? +hb[2].toFixed(1) : -1;
    out.back = hl ? +hl[0].toFixed(1) + ',' + hl[2].toFixed(1) : '-';
    u.path = null; u.dest = null;
    step(5);
    out.set = W.gunSet(u);
    out.setVars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.poses = u.models.map(m => m.pose).join(',');
    const gp = W.gunPost(u), cs = Math.cos(u.facing), sn = Math.sin(u.facing);
    const rel = m => { const dx = m.x - gp.x, dy = m.y - gp.y; return [dx * cs + dy * sn, -dx * sn + dy * cs]; };
    const r1 = rel(u.models[1]), r2 = rel(u.models[2]), r3 = rel(u.models[3]);
    out.mate = r1.map(v => +v.toFixed(1)).join(','); out.mateLeft = r1[1] < -3;
    out.bearers = (u.coverSlots && u.coverSlots[2] && u.coverSlots[3]) ? 'cover' : r2[0] < -4 && r3[0] < -4 && r2[1] * r3[1] < 0;
    out.mateFaces = Math.abs(W.angDiff(u.models[1].f, u.facing + Math.PI / 2)) < .25;
    out.mesh = W.teamMesh(u) === W.MODELS.gun.hr_mg;
    const mz = W.muzzlePoint(u, u.models[0], 0), gd = W.gunOf(u);
    out.muz = Math.hypot(mz.x - gp.x - Math.cos(u.facing) * gd.gunMuz[0] * W.FIG_SCALE, mz.y - gp.y - Math.sin(u.facing) * gd.gunMuz[0] * W.FIG_SCALE) < 1;
    /* the MG 42 */
    out.upg = W.upgradable(u) && !!W.UPGRADES.mg42t;
    const w0 = W.mainW(u);
    const got = W.buyUpgradeAuto('ger', [u], { floor: 0, fuFloor: 0 });
    out.fitted = got === u && !!u.up.mg42t;
    out.wUp = W.mainW(u) === u.def.wUp.mg42t && w0 === u.def.w && W.mainW(u).rof < w0.rof && W.mainW(u).sup > w0.sup;
    out.mesh42 = W.teamMesh(u) === W.MODELS.gun['hr_mg:mg42t'] && W.gunOf(u) === u.def.gunUp.mg42t &&
                 W.servedOf(u) === W.MODELS.served['hr_mg:mg42t'];
    u.packed = true; u.setup = 0;
    out.pieces42 = [piece(0) === C.mg42, piece(1) === C.laf, piece(2) === C.pk34].join(',');
    u.packed = false;
    const m = u.models[2], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.bodyNat = rec ? rec.nat : '-';
    out.fall = !!(W.MODELS.fall.heer_mg && W.MODELS.dead.heer_mg);
    W.killUnit(u);
    W.killBuilding(post);
    return out;
  });
  ok('Omaha: the MG 34 team carries its gun and Lafette, and is issued the MG 42',
     /hr_mg/.test(hmg.makes) && hmg.q === 'hr_mg' && hmg.made === 1 && hmg.count &&
     hmg.open && hmg.men === 4 && hmg.baked && +hmg.belts.split('/')[0] > 20 && +hmg.belts.split('/')[1] === 0 &&
     hmg.butt34 < 1.3 && hmg.butt42 < 1.3 &&
     hmg.walkVars === 'hr_mgc,hr_mgl,hr_mga,hr_mga_b' && hmg.carried && hmg.pieces === 'true,true,true,true' &&
     hmg.shoulder > 15 && hmg.shoulder < 20 && hmg.hand > 7 && hmg.hand < 12 && /^-/.test(hmg.back) &&
     hmg.set && hmg.setVars === 'hr_mgg,hr_mgg,hr_mga,hr_mga_b' && /^10,11,/.test(hmg.poses) && hmg.mateLeft && hmg.mateFaces && hmg.bearers &&
     hmg.mesh && hmg.muz && hmg.upg && hmg.fitted && hmg.wUp && hmg.mesh42 && hmg.pieces42 === 'true,true,true' &&
     hmg.bodyNat === 'heer_mg' && hmg.fall,
     (hmg.open ? '' : 'NO open ground to stage on; ') + `the Kaserne makes ${hmg.makes}; asked for the team it queues ${hmg.q}, counted as ${hmg.made} made, ` +
     `${hmg.count ? 'one' : 'NONE'} on the field; ${hmg.men} men, every variant ` +
     `and both guns' bodies at the gun ${hmg.baked ? 'baked' : 'NOT baked'}; belt faces on a bearer against a rifleman ${hmg.belts}; ` +
     `the butt ${hmg.butt34} and ${hmg.butt42} off the gunner's shoulder joint; ` +
     `walking ${hmg.walkVars}, ${hmg.carried ? 'carried' : 'NOT carried'}, gun, Lafette and boxes ${hmg.pieces}, the gun at ${hmg.shoulder} ` +
     `on the shoulder, the Lafette at ${hmg.back} on the back and a box at ${hmg.hand} in the hand; halted ${hmg.set ? 'set up' : 'NOT set up'} as ${hmg.setVars} in poses ${hmg.poses}, ` +
     `the number two at ${hmg.mate} ${hmg.mateFaces ? 'facing the gun' : 'NOT facing the gun'}, the bearers ${hmg.bearers === 'cover' ? 'in cover' : hmg.bearers ? 'back either side' : 'NOT in place'}, ` +
     `the piece ${hmg.mesh ? 'the MG 34' : 'WRONG'} and the flash ${hmg.muz ? 'at the muzzle' : 'OFF the muzzle'}; the MG 42 ${hmg.upg ? 'on offer' : 'NOT on offer'}, ` +
     `${hmg.fitted ? 'fitted' : 'NOT fitted'}, the weapon ${hmg.wUp ? 'changed' : 'NOT changed'}, the piece and bodies ${hmg.mesh42 ? 'changed' : 'NOT changed'}, ` +
     `carried ${hmg.pieces42}; killed went down as ${hmg.bodyNat}, bodies ${hmg.fall ? 'baked' : 'MISSING'}`);

  /* --- The Wirbelwind. The 352nd's flak tank, on the depot's list beside the 234: the depot
     makes it and queues it by its own key. It is the Panzer IV's hull in the grey under an
     open turret with no roof over the middle of it, four barrels out through the front plate
     and four men in it, three under a helmet and the commander in the cap; the turret goes
     all the way round, the eye is the commander's over the rim, a burst beside it takes more
     off it than off the Panzer IV, and its plate and its hit points are both under the
     tank's. Forty wrecks throw the turret some of the time, and killed it leaves bodies of
     the 352nd. --- */
  const wb = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.side === 'ger' && b.def.hq)[0];
    const dep = W.spawnBuilding(hq.own, 'ger_dep', hq.x - 240, hq.y + 160, true);
    out.makes = W.makesOf(dep).join(',');
    out.fielded = W.fielded('hr_wirb');
    G.res[hq.own].mp += 2000; G.res[hq.own].fu += 600;
    const q0 = dep.queue.length, m0 = W.madeOf(hq.own, 'hr_wirb');
    out.q = W.queueUnit(dep, 'hr_wirb') ? dep.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf(hq.own, 'hr_wirb') - m0;
    dep.queue.length = q0;
    const v = W.spawnUnit(hq.own, 'hr_wirb', hq.x - 140, hq.y + 260, 0);
    const V = W.VMODEL.hr_wirb, B = W.MODELS.veh.hr_wirb, K = W.KIT.heer, T = W.WBT, rim = T.z0 + T.hl + T.hu;
    out.bufs = !!(B && B.hull && B.tur && B.turCrew && B.skirts && B.inside);
    out.grey = V.hull.filter(f => f.c === W.HRG.body || f.c === W.HRG.lit).length;
    out.turGrey = V.tur.filter(f => f.c === W.HRG.body).length;
    out.camo = V.hull.concat(V.tur).filter(f => f.c === W.PZ.body).length;
    /* open: nothing of the turret over the middle of it at the rim or above */
    out.roof = V.tur.filter(f => f.v.every(p => p[2] >= rim - .1 && Math.hypot(p[0], p[1]) < 7)).length;
    /* four muzzles, each the dark end of a flash hider out past the front plate */
    const muz = new Set();
    V.tur.forEach(f => { if (f.c === W.HP4C.hole && f.v.every(p => p[0] > T.muz - .2)) {
      const c = f.v.reduce((a, p) => [a[0] + p[1], a[1] + p[2]], [0, 0]); muz.add(Math.round(c[0] / f.v.length) + ',' + Math.round(c[1] / f.v.length)); } });
    out.muz = muz.size;
    out.helm = V.turCrew.filter(f => f.c === K.helm || f.c === K.helmD).length;
    out.black = V.turCrew.filter(f => f.c === K.pz).length;
    out.over = V.turCrew.filter(f => f.v.some(p => p[2] > rim + 2)).length;
    v.facing = 0; v.turret = 0; v.want = 1.2;
    for (let i = 0; i < 3; i++) W.updateModels(v, 1.0);
    out.lay = +Math.abs(W.angDiff(v.turret, 1.2)).toFixed(3);
    W.povOn(v);
    out.eye = +(W.povEye().z - (v.gz === undefined ? W.groundZ(v.x, v.y) : v.gz)).toFixed(1);
    W.povOff();
    out.auto = !!v.def.w.auto;
    const P4 = W.UNITS.hr_p4;
    out.plate = v.def.armor + '<' + P4.armor; out.hp = v.def.hp + '<' + P4.hp;
    /* the same burst beside each, the Panzer IV staged where the Wirbelwind stood */
    const foe = W.spawnUnit(G.slots.filter(s => s.side === 'us')[0].k, 'am_rifle', v.x + 900, v.y + 900, 0);
    /* burst thirty up, which is over the height a round opens the ground from, so the row
       leaves no hole where the next one stands its men */
    const burst = (u) => { const h0 = u.hp; W.explode(u.x + 10, u.y, 30, 120, foe, null, 30, null); return h0 - u.hp; };
    out.lost = +burst(v).toFixed(1);
    const p4 = W.spawnUnit(hq.own, 'hr_p4', v.x, v.y + 120, 0);
    out.lostP4 = +burst(p4).toFixed(1);
    [foe, p4].forEach(u => { u.dead = true; G.units.splice(G.units.indexOf(u), 1); });
    v.hp = v.def.hp;
    const nw = G.wrecks.length;
    let blown = 0, sink = 99;
    for (let i = 0; i < 80; i++) { const w = W.makeWreck(v); if (w.blown) blown++; sink = Math.min(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(v);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(dep);
    return out;
  });
  ok('Omaha: the 352nd fields the Wirbelwind beside the 234, open, with four guns and four men',
     /hr_wirb/.test(wb.makes) && /hr_234/.test(wb.makes) && wb.fielded && wb.q === 'hr_wirb' && wb.made === 1 &&
     wb.bufs && wb.grey > 50 && wb.turGrey > 20 && wb.camo === 0 && wb.roof === 0 && wb.muz === 4 &&
     wb.helm > 0 && wb.black > 0 && wb.over > 0 && wb.lay < .05 && wb.eye > 30 && wb.eye < 40 && wb.auto &&
     wb.lost > wb.lostP4 * 1.3 && wb.lostP4 > 0 && wb.blown > 0 && wb.blown < 80 && wb.sink >= 2 &&
     wb.bodies >= 1 && wb.bodyNat === 'heer',
     `the depot makes ${wb.makes}; asked for the Wirbelwind by its own key it queues ${wb.q}, ` +
     `counted as ${wb.made} made; buffers ${wb.bufs ? 'all built' : 'MISSING'}; ${wb.grey} hull and ${wb.turGrey} turret faces in the ` +
     `grey and ${wb.camo} in the sand camouflage; ${wb.roof} faces roofing it over, ${wb.muz} muzzles; the men have ${wb.helm} ` +
     `faces of a helmet and ${wb.black} of the panzer troops' black, ${wb.over} of them more than 2 over the rim; asked to lay 1.2 off the nose the turret is ${wb.lay} ` +
     `short; the eye ${wb.eye} up; the gun ${wb.auto ? 'automatic' : 'NOT automatic'}, plate ${wb.plate} and hit points ${wb.hp} ` +
     `against the Panzer IV; a 120-point burst took ${wb.lost} off it and ${wb.lostP4} off the Panzer IV; ${wb.blown} of 80 wrecks ` +
     `threw the turret, the least sat down ${wb.sink}; killed, it left ${wb.bodies} bodies of ${wb.bodyNat}`);

  /* --- The Panther. The 352nd's second tank, on the depot's list beside the Panzer IV. It
     is in the grey with none of the sand camouflage, the man in the cupola wears the black
     cap and no helmet, the long gun reaches further past the nose than any gun on the beach,
     and the turret comes all the way round. What the row is mostly about is the plate: two
     hundred and twenty across the front and a side worth less of its front than any other
     tank's, so an M4's round at three hundred never goes through the front and always goes
     through the side, and the Schürzen make a rifle grenade burst on the plates hung over the
     side. The eye is up out of the cupola and drops to the blocks when the lid shuts,
     forty wrecks throw the turret some of the time, and killed it leaves bodies of the
     352nd. --- */
  const pv = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.side === 'ger' && b.def.hq)[0];
    const dep = W.spawnBuilding(hq.own, 'ger_pz', hq.x - 240, hq.y + 160, true);
    out.makes = W.makesOf(dep).join(',');
    out.fielded = W.fielded('hr_panther');
    G.res[hq.own].mp += 3000; G.res[hq.own].fu += 900;
    const q0 = dep.queue.length, m0 = W.madeOf(hq.own, 'hr_panther');
    out.q = W.queueUnit(dep, 'hr_panther') ? dep.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf(hq.own, 'hr_panther') - m0;
    dep.queue.length = q0;
    const v = W.spawnUnit(hq.own, 'hr_panther', hq.x - 140, hq.y + 260, 0);
    const V = W.VMODEL.hr_panther, B = W.MODELS.veh.hr_panther, H = W.HATCHES.hr_panther, K = W.KIT.heer;
    out.bufs = !!(B && B.hull && B.tur && B.mg && B.hatch && B.cmdr && B.leaf && B.inside && B.skirts);
    out.grey = V.hull.filter(f => f.c === W.HRG.body || f.c === W.HRG.lit).length;
    out.turGrey = V.tur.filter(f => f.c === W.HRG.body || f.c === W.HRG.lit).length;
    out.camo = V.hull.concat(V.tur).filter(f => f.c === W.PZ.body).length;
    out.cap = H.open.filter(f => f.c === K.pz).length;
    out.helm = H.open.filter(f => f.c === K.helm || f.c === K.helmD).length;
    /* the muzzle past the nose, in the hull's frame */
    const nose = Math.max.apply(null, V.hull.map(f => Math.max.apply(null, f.v.map(p => p[0]))));
    out.reach = +(V.turX + V.bar - nose).toFixed(1);
    v.facing = 0; v.turret = 0; v.want = Math.PI - .05;
    for (let i = 0; i < 12; i++) W.updateModels(v, 1.0);
    out.lay = +Math.abs(W.angDiff(v.turret, Math.PI - .05)).toFixed(3);
    out.sight = v.def.sight >= v.def.w.range;
    /* the plate from the front, the side and the back, and an M4's round at three hundred
       against the first two; then the same side with the Schürzen hung */
    v.turret = 0; v.want = undefined;
    const d = 300, A = W.ARM.hr_panther, m4w = W.UNITS.am_sher.w, rg = W.UNITS.am_rifle.glUp.rgren;
    out.front = A.h[0]; out.side = A.h[1]; out.rear = A.h[2]; out.p4Side = W.ARM.hr_p4.h[1];
    out.pFront = +W.penVs(m4w, d, v, v.x + d, v.y).toFixed(2); out.pSide = +W.penVs(m4w, d, v, v.x, v.y + d).toFixed(2);
    out.rgBare = +W.penVs(rg, 150, v, v.x, v.y + 150).toFixed(2);
    v.up.skirts = true;
    out.rgSkirt = +W.penVs(rg, 150, v, v.x, v.y + 150).toFixed(2);
    v.up.skirts = false;
    W.povOn(v);
    W.povHatch(true); const up = W.povEye().z - (v.gz === undefined ? W.groundZ(v.x, v.y) : v.gz);
    W.povHatch(false); const dn = W.povEye().z - (v.gz === undefined ? W.groundZ(v.x, v.y) : v.gz);
    W.povOff();
    out.eyeUp = +up.toFixed(1); out.eyeIn = +dn.toFixed(1);
    const nw = G.wrecks.length;
    let blown = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(v); if (w.blown) blown++; }
    G.wrecks.length = nw;
    out.blown = blown;
    const nc = G.corpses.length;
    W.killUnit(v);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(dep);
    return out;
  });
  ok('Omaha: the 352nd fields the Panther beside the Panzer IV, in the grey, hard in front and soft in the side',
     /hr_panther/.test(pv.makes) && /hr_p4/.test(pv.makes) && pv.fielded && pv.q === 'hr_panther' && pv.made === 1 &&
     pv.bufs && pv.grey > 50 && pv.turGrey > 50 && pv.camo === 0 && pv.cap > 0 && pv.helm === 0 && pv.reach > 18 &&
     pv.lay < .05 && pv.sight && pv.side < pv.front * .4 && pv.side > pv.p4Side && pv.pFront < .05 && pv.pSide > .95 &&
     pv.rgSkirt < pv.rgBare && pv.eyeUp > 34 && pv.eyeUp < 42 && pv.eyeIn > 28 && pv.eyeIn < pv.eyeUp - 4 &&
     pv.blown > 2 && pv.blown < 30 && pv.bodies >= 1 && pv.bodyNat === 'heer',
     `the Panzerpark makes ${pv.makes}; asked for the Panther it queues ${pv.q}, counted as ${pv.made} made; buffers ` +
     `${pv.bufs ? 'all built' : 'MISSING'}; ${pv.grey} hull and ${pv.turGrey} turret faces in the grey and ${pv.camo} in the ` +
     `sand camouflage; the man in the cupola has ${pv.cap} faces of the black cap and ${pv.helm} of a helmet; the muzzle ` +
     `${pv.reach} past the nose; asked to lay over the tail the turret is ${pv.lay} short; the gunner ${pv.sight ? 'sees' : 'does NOT see'} ` +
     `as far as he shoots; plate ${pv.front} in front, ${pv.side} on the side against the Panzer IV's ${pv.p4Side}, ${pv.rear} ` +
     `behind; an M4's round at 300 goes through the front ${pv.pFront} and the side ${pv.pSide}, and a rifle grenade the side ` +
     `${pv.rgBare} bare and ${pv.rgSkirt} with the Schürzen; the eye ${pv.eyeUp} up out of the cupola and ${pv.eyeIn} at the blocks; ${pv.blown} of 40 wrecks threw the turret; ` +
     `killed, it left ${pv.bodies} bodies of ${pv.bodyNat}`);

  /* --- The four the first roster left on the German depot, the Tiger, the King Tiger, the Maus
     and the StuH 42, wear the 352nd's grey. Not one face of any of them is the sand, and the two
     Zimmerit tiles carry no colour of their own, which they did while they held the first
     roster's three-tone; the plate under Zimmerit finds the ridged or the combed tile, the Maus's
     finds the plain paint, and the wheels, the hatches and the fittings of all four are the plain
     paint too. Each has the cross in black and white on both sides, and the two Tigers the
     number in red on both sides of the turret. --- */
  const heavy = await page.evaluate(() => {
    const W = window, out = { tiles: {} };
    const T = W.MATS.TILE, C = W.MATS.COLS, g = W.MATS.atlas.getContext('2d');
    ['zimrow', 'zimsq', 'paint'].forEach(nm => {
      const mi = W.matIndex(nm), d = g.getImageData((mi % C) * T, Math.floor(mi / C) * T, T, T).data;
      let cr = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { cr += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); n++; }
      out.tiles[nm] = +(cr / n).toFixed(1);
    });
    const plate = { ger_tig: [W.TIG.body, 'zimrow'], ger_kt: [W.KT.body, 'zimrow'], ger_stug: [W.SUC.body, 'zimsq'], ger_maus: [W.MSC.body, 'paint'] };
    const sand = [W.PZ.body, W.PZ.lit, W.PZ.dark], mat = c => W.MATS.names[W.matOf(c)];
    const vals = o => Object.keys(o || {}).reduce((a, u) => a.concat(o[u]), []);
    Object.keys(plate).forEach(k => {
      const V = W.VMODEL[k], H = W.HATCHES[k] || {};
      const all = V.hull.concat(V.tur, V.skirts || [], V.mg || [], H.shut || [], H.leaf || [], vals(V.addUp), vals(V.mgUp));
      out[k] = {
        sand: all.filter(f => sand.indexOf(f.c) >= 0).length,
        plate: all.filter(f => f.c === plate[k][0]).length, tile: mat(plate[k][0]), want: plate[k][1],
        paint: all.filter(f => f.c === W.HRG.body || f.c === W.HRG.lit || f.c === W.HRG.dark).length, paintTile: mat(W.HRG.body),
        white: V.hull.filter(f => f.c === W.HP4C.white).length, black: V.hull.filter(f => f.c === W.HP4C.black).length,
        red: V.tur.filter(f => f.c === W.HP4C.red).length
      };
    });
    return out;
  });
  const hvk = ['ger_tig', 'ger_kt', 'ger_stug', 'ger_maus'];
  ok('The Tiger, the King Tiger, the Maus and the StuH 42 are in the 352nd\'s grey, with the cross and the numbers',
     heavy.tiles.zimrow < 8 && heavy.tiles.zimsq < 8 &&
     hvk.every(k => { const h = heavy[k]; return h.sand === 0 && h.plate > 50 && h.tile === h.want && h.paintTile === 'paint' &&
                                                 h.paint > 50 && h.white > 0 && h.black > 0; }) &&
     heavy.ger_tig.red > 0 && heavy.ger_kt.red > 0 && heavy.ger_stug.red === 0 && heavy.ger_maus.red === 0,
     `the Zimmerit tiles carry ${heavy.tiles.zimrow} and ${heavy.tiles.zimsq} of colour against the paint tile's ` +
     `${heavy.tiles.paint}; ` + hvk.map(k => { const h = heavy[k]; return `${k}: ${h.sand} faces of sand, ${h.plate} of plate ` +
       `on ${h.tile} (want ${h.want}), ${h.paint} of plain paint on ${h.paintTile}, the cross in ${h.white} white and ` +
       `${h.black} black faces, ${h.red} red on the turret`; }).join('; '));

  /* --- The 57 mm Gun M1. The Americans' anti-tank gun: the motor pool makes it and queues
     it, the count and the order book read it, and it is five men -- the gunner and the
     loader at the gun, and three bringing the rounds up a box each. Its eye stands past
     every eye on the German depot and its reach
     past every gun on it but the Maus's, and sited on open sand with a Panzer IV coming at it
     from past its own reach it has the first round off, from further out than the tank can
     answer and before the tank has found it. Halted, the trails open and the gunner kneels at
     the sight on the left with the loader at the breech on the right, facing it; on the move
     the trails close and the piece rides beside the gunner, with him at the left wheel. The
     tube runs back in its cradle and the carriage does not. The bearers carry their boxes, a
     man killed goes down as one of the crew, and an American bunker's anti-tank fitting is
     this gun. --- */
  const at57 = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const mot = W.spawnBuilding('us', 'us_bar', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(mot).join(',');
    G.res.us.mp += 3000; G.res.us.fu += 600;
    const q0 = mot.queue.length, m0 = W.madeOf('us', 'am_at');
    out.q = W.queueUnit(mot, 'am_at') ? mot.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('us', 'am_at') - m0;
    mot.queue.length = q0;
    /* its eye and its reach against every vehicle the German depot makes on this beach, the
       self-propelled howitzers aside, whose reach is a fire mission's and not a gun's */
    const D = W.UNITS.am_at;
    const vk = W.BUILDINGS.ger_dep.makes.concat(W.BUILDINGS.ger_pz.makes).filter(k => W.fielded(k) && W.UNITS[k].cat === 'veh');
    const reach = d => Math.max(d.w ? d.w.range : 0, ...Object.keys(d.wUp || {}).map(k => d.wUp[k].range || 0));
    out.eyeBest = Math.max(...vk.map(k => W.UNITS[k].sight));
    out.reachBest = Math.max(...vk.filter(k => k !== 'ger_maus' && !W.UNITS[k].indirect).map(k => reach(W.UNITS[k])));
    out.eye = D.sight; out.reach = D.w.range;
    /* open sand long enough for the drill: the gun at one end and a Panzer IV 520 off at the
       other, both walkable, nothing cover near either, and a clear line between them */
    const clear = (x, y) => x > 60 && y > 60 && x < W.WORLD.w - 60 && y < W.WORLD.h - 60 && W.walkable(x, y) &&
                            !W.inMasonry(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 60);
    /* and room round it for the crew's places, which a spot found beside something did not have:
       the bearers' places were refused and they stood where they were */
    const roomy = (x, y) => [30, 60].every(rr => [...Array(12).keys()].every(k => {
      const px = x + rr * Math.cos(k * Math.PI / 6), py = y + rr * Math.sin(k * Math.PI / 6);
      return W.walkable(px, py) && !W.inMasonry(px, py);
    }));
    let st = null;
    for (let r = 0; r < 1600 && !st; r += 60)
      for (let k = 0; k < 16 && !st; k++) {
        const ax = hq.x + r * Math.cos(k * Math.PI / 8), ay = hq.y - 300 + r * Math.sin(k * Math.PI / 8);
        if (!clear(ax, ay)) continue;
        for (let j = 0; j < 8 && !st; j++) {
          const th = j * Math.PI / 4, bx = ax + 520 * Math.cos(th), by = ay + 520 * Math.sin(th);
          if (!clear(bx, by)) continue;
          let ok = true;
          for (let s = 1; s < 13 && ok; s++) ok = W.walkable(ax + (bx - ax) * s / 13, ay + (by - ay) * s / 13);
          if (ok && W.traceClear(ax, ay, W.groundZ(ax, ay) + 12, bx, by, W.groundZ(bx, by) + 20, W.sblk) &&
              W.traceClear(bx, by, W.groundZ(bx, by) + 20, ax, ay, W.groundZ(ax, ay) + 12, W.sblk)) st = { ax, ay, bx, by, th };
        }
      }
    out.staged = !!st;
    /* the drill: the two of them alone on the field, the gun laid toward the tank and the tank
       driving at the gun, and who fires first, from where, and whether the tank had found it */
    const saved = G.units.slice();
    if (st) {
      G.units.length = 0;
      const a = W.spawnUnit('us', 'am_at', st.ax, st.ay, st.th);
      a.setup = 0; a.packed = false; a.pack = 0; a.order = null; a.dest = null; a.path = null;
      const b = W.spawnUnit('ger', 'hr_p4', st.bx, st.by, st.th + Math.PI);
      b.order = 'attackmove'; b.dest = { x: a.x, y: a.y };
      const seen = new Set(G.shots);
      let t = 0, first = null, bFirst = null;
      const dt = 1 / 20;
      while (t < 40 && !(first && bFirst)) {
        G.t += dt; t += dt;
        W.computeVisibility(dt);
        W.updateUnit(a, dt); W.updateUnit(b, dt); W.updateModels(a, dt);
        W.updateShots(dt);
        for (const s of G.shots) {
          if (seen.has(s)) continue;
          seen.add(s);
          const d = Math.round(Math.hypot(a.x - b.x, a.y - b.y));
          if (s.owner === a && !first) first = { t: +t.toFixed(1), d, found: +(a.detGer || 0).toFixed(2) };
          if (s.owner === b && !bFirst) bFirst = { t: +t.toFixed(1), d };
        }
        if (a.dead || b.dead) break;
      }
      out.first = first; out.bFirst = bFirst;
      G.units.length = 0; saved.forEach(u => G.units.push(u));
      G.shots.length = 0;
    }
    /* the five of them, set up and walking, on open sand: the row is about where each man
       stands round the gun, and with cover in reach the loader keeps the slot beside his
       gunner instead, which on one phone run was a shell hole the battle had left. The spot
       is asked again after the drill, whose rounds dig holes of their own. */
    let at = null;
    for (let r = 0; r < 900 && !at; r += 40)
      for (let k = 0; k < 16 && !at; k++) {
        const x0 = st ? st.ax : hq.x + 120, y0 = st ? st.ay : hq.y - 320;
        const x = x0 + r * Math.cos(k * Math.PI / 8), y = y0 + r * Math.sin(k * Math.PI / 8);
        if (clear(x, y) && roomy(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 140)) at = { x, y };
      }
    out.openSand = !!at;
    if (!at) at = W.nearestFree(hq.x + 120, hq.y - 320);
    const u = W.spawnUnit('us', 'am_at', at.x, at.y, 0);
    out.count = W.countOf('us', 'am_at') >= 1;
    out.men = u.models.length;
    out.baked = ['gi_atg', 'gi_atb'].every(v => W.MODELS.man[v] && W.MODELS.man[v][W.POSE_STAND] && W.MODELS.man[v][W.POSE_WALK]) &&
                !!W.MODELS.man.gi_atb[W.POSE_FIRE] && !!(W.MODELS.served.am_at && W.MODELS.served.am_at.mate) &&
                !!(W.MODELS.gunRec.am_at && W.MODELS.gunPk.am_at);
    const step = function (s) { for (let i = 0; i < s * 30; i++) { G.t += 1 / 30; W.updateUnit(u, 1 / 30); W.updateModels(u, 1 / 30); } };
    /* set down on its own bearing, as a right-drag gives one: halted with nothing to shoot at, a piece
       turns toward the nearest enemy its side can see, and since the brains could pay for their works a
       pioneer out digging off to a flank kept the gun traversing and all five men walking to places
       that would not stand still, on one run of the gate and not the one before it */
    u.setup = 0; u.packed = false; u.pack = 0; u.faceA = u.facing;
    step(4);
    /* and up to four seconds more while a bearer is still walking to his place: on one run of the Pak
       38's row a bearer was a unit short of it, mid-stride, when the row looked */
    for (let k = 0; k < 4 && u.models.some((m, i) => i > 1 && m.alive && m.pose === W.POSE_WALK); k++) step(1);
    out.set = W.gunSet(u);
    out.setVars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.poses = u.models.map(m => m.pose).join(',');
    const gp = W.gunPost(u), cs = Math.cos(u.facing), sn = Math.sin(u.facing);
    const rel = m => { const dx = m.x - gp.x, dy = m.y - gp.y; return [(dx * cs + dy * sn) / W.FIG_SCALE, (-dx * sn + dy * cs) / W.FIG_SCALE]; };
    const r1 = rel(u.models[1]);
    out.loader = r1.map(v => +v.toFixed(1)).join(',');
    out.loaderRight = r1[1] > 2 && r1[0] < -6;
    out.loaderFaces = Math.abs(W.angDiff(u.models[1].f, u.facing - Math.PI / 2)) < .25;
    out.bearers = u.coverSlots && u.coverSlots[2] ? 'cover' : [2, 3, 4].every(i => rel(u.models[i])[0] < -14);
    out.bpos = [2, 3, 4].map(i => rel(u.models[i]).map(q => Math.round(q)).join(',')).join(' ');
    out.why = (out.openSand ? 'on open sand' : 'NO open sand found') + (u.coverSlots ? ', in cover' : '') + (u.target ? ', a target' : '');
    out.mesh = W.teamMesh(u) === W.MODELS.gun.am_at;
    const mz = W.muzzlePoint(u, u.models[0], 0);
    out.muz = Math.hypot(mz.x - gp.x - Math.cos(u.facing) * D.gunMuz[0] * W.FIG_SCALE, mz.y - gp.y - Math.sin(u.facing) * D.gunMuz[0] * W.FIG_SCALE) < 1;
    const box = W.mgCarryAt(u, u.models[2], 2, 'gi_atb') ? W._mgc.buf : null;
    out.box = box === W.MODELS.carry.box57;
    u.packed = true;
    out.packMesh = W.teamMesh(u) === W.MODELS.gunPk.am_at;
    const gq = W.gunPost(u), g0 = u.models[0];
    out.runs = +(Math.hypot(gq.x - g0.x, gq.y - g0.y) / W.FIG_SCALE).toFixed(1);
    u.packed = false;
    /* a man of it goes down as one of the crew */
    const m = u.models[2], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.bodyNat = rec ? rec.nat : '-';
    out.fall = !!(W.MODELS.fall.usa_at && W.MODELS.dead.usa_at);
    W.killUnit(u);
    /* an American bunker's anti-tank fitting is the 57 */
    out.bunkKey = W.BUNKUP.at.unit.us;
    const bk = G.bunks.filter(k => !k.up && !k.upKind && !k.gar)[0];
    if (bk) {
      const was = { own: bk.own, upKind: bk.upKind, upUid: bk.upUid, upBuf: bk.upBuf, upOwn: bk.upOwn };
      const n0 = G.units.length;
      bk.own = 'us'; bk.up = 'at'; bk.upT = 0; bk.upOwn = 'us';
      W.finishBunkerUp(bk, true);
      const g = G.units.slice(n0).filter(q => q.id === bk.upUid)[0];
      out.bunkGun = g ? g.key : '-';
      if (g) { if (g.gar) W.leaveBuilding(g); g.dead = true; G.units.splice(G.units.indexOf(g), 1); }
      Object.keys(was).forEach(k => { bk[k] = was[k]; });
      bk.up = null;
    } else out.bunkGun = 'no bunker';
    W.killBuilding(mot);
    return out;
  });
  const f57 = at57.first, b57 = at57.bFirst;
  ok('Omaha: the 57 mm Gun M1 is the Americans\' anti-tank gun, with five men, sees and reaches past the armour, and fires first',
     /am_at/.test(at57.makes) && at57.q === 'am_at' && at57.made === 1 && at57.count &&
     at57.eye > at57.eyeBest && at57.reach > at57.reachBest &&
     at57.staged && !!f57 && (!b57 || b57.t >= f57.t + 1) && f57.found < 1 &&
     at57.men === 5 && at57.baked && at57.set && at57.setVars === 'gi_atg,gi_atg,gi_atb,gi_atb,gi_atb' && /^11,11,/.test(at57.poses) &&
     at57.loaderRight && at57.loaderFaces && at57.bearers && at57.mesh && at57.muz && at57.box && at57.packMesh &&
     at57.runs > 9 && at57.runs < 13 && at57.bodyNat === 'usa_at' && at57.fall &&
     at57.bunkKey === 'am_at' && (at57.bunkGun === 'am_at' || at57.bunkGun === 'no bunker'),
     `the barracks makes ${at57.makes}; asked for the gun it queues ${at57.q}, counted as ${at57.made} made, ` +
     `${at57.count ? 'one' : 'NONE'} on the field; its eye ${at57.eye} against the ` +
     `352nd's vehicles' best ${at57.eyeBest} and its reach ${at57.reach} against ${at57.reachBest} (the Maus and the howitzers aside); ` +
     (at57.staged ? `sited against a Panzer IV at 520 it fired ${f57 ? 'at ' + f57.t + ' s from ' + f57.d + ' with the tank ' + (f57.found < 1 ? 'yet to find it (' + f57.found + ')' : 'ALREADY on it') : 'NEVER'} ` +
       `and the tank ${b57 ? 'answered at ' + b57.t + ' s from ' + b57.d : 'never fired'}; ` : 'NO open sand to stage the drill on; ') +
     `${at57.men} men, every variant, the served bodies and the three meshes ${at57.baked ? 'baked' : 'NOT baked'}; halted ` +
     `${at57.set ? 'set up' : 'NOT set up'} as ${at57.setVars} in poses ${at57.poses}, the loader at ${at57.loader} ` +
     `${at57.loaderRight ? 'on the right' : 'NOT on the right'} and ${at57.loaderFaces ? 'facing the breech' : 'NOT facing it'}` +
     `${at57.loaderRight && at57.loaderFaces ? '' : ' (' + at57.why + ')'}, the bearers ` +
     `${at57.bearers === 'cover' ? 'in cover' : at57.bearers ? 'back behind the gun' : 'NOT in place (' + at57.bpos + ')'}, the piece ${at57.mesh ? 'open' : 'WRONG'}, ` +
     `the flash ${at57.muz ? 'at the muzzle' : 'OFF the muzzle'}, a bearer's box ${at57.box ? 'in his hand' : 'MISSING'}; packed the trails ` +
     `${at57.packMesh ? 'closed' : 'NOT closed'} and the piece ${at57.runs} from the gunner; killed went down as ${at57.bodyNat}, bodies ` +
     `${at57.fall ? 'baked' : 'MISSING'}; the bunker's anti-tank fitting is ${at57.bunkKey} and put in ${at57.bunkGun}`);

  /* --- The 5 cm Pak 38. The 352nd's anti-tank gun, laid the way the 57 across the beach is:
     the depot makes it and queues it, the count and the order book read it, and it is five
     men -- the gunner and the loader at the gun, and three bringing the rounds up a case
     each. Its eye stands past every eye on the American motor pool and its reach past every
     gun on it, and sited on open sand with an M4 coming at it from past its own reach it has
     the first round off before the tank has found it. Halted, the trails open and the gunner
     kneels at the sight on the left with the loader at the breech on the right, facing it;
     on the move the trails close and the piece rides beside the gunner. The bearers carry
     their cases, a man killed goes down as one of the crew, and a German bunker's anti-tank
     fitting is this gun. --- */
  const pk38 = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'ger' && b.def.hq)[0], uhq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const dep = W.spawnBuilding('ger', 'ger_qtr', hq.x + 240, hq.y + 120, true);
    out.makes = W.makesOf(dep).join(',');
    G.res.ger.mp += 3000; G.res.ger.fu += 600;
    const q0 = dep.queue.length, m0 = W.madeOf('ger', 'hr_pak');
    out.q = W.queueUnit(dep, 'hr_pak') ? dep.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('ger', 'hr_pak') - m0;
    dep.queue.length = q0;
    /* its eye and its reach against every vehicle the American motor pool makes on this beach,
       the self-propelled howitzers aside, whose reach is a fire mission's and not a gun's */
    const D = W.UNITS.hr_pak;
    const vk = W.BUILDINGS.us_mot.makes.concat(W.BUILDINGS.us_tank.makes).filter(k => W.fielded(k) && W.UNITS[k].cat === 'veh');
    const reach = d => Math.max(d.w ? d.w.range : 0, ...Object.keys(d.wUp || {}).map(k => d.wUp[k].range || 0));
    out.eyeBest = Math.max(...vk.map(k => W.UNITS[k].sight));
    out.reachBest = Math.max(...vk.filter(k => !W.UNITS[k].indirect).map(k => reach(W.UNITS[k])));
    out.eye = D.sight; out.reach = D.w.range;
    /* open sand for the drill, found the way the 57's is: the bocage behind the German
       headquarters is hedgerow and lane and has nowhere 520 across with nothing on it */
    const clear = (x, y) => x > 60 && y > 60 && x < W.WORLD.w - 60 && y < W.WORLD.h - 60 && W.walkable(x, y) &&
                            !W.inMasonry(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 60);
    /* and room round it for the crew's places, which a spot found beside something did not have:
       the bearers' places were refused and they stood where they were */
    const roomy = (x, y) => [30, 60].every(rr => [...Array(12).keys()].every(k => {
      const px = x + rr * Math.cos(k * Math.PI / 6), py = y + rr * Math.sin(k * Math.PI / 6);
      return W.walkable(px, py) && !W.inMasonry(px, py);
    }));
    let st = null;
    for (let r = 0; r < 1600 && !st; r += 60)
      for (let k = 0; k < 16 && !st; k++) {
        const ax = uhq.x + r * Math.cos(k * Math.PI / 8), ay = uhq.y - 300 + r * Math.sin(k * Math.PI / 8);
        if (!clear(ax, ay)) continue;
        for (let j = 0; j < 8 && !st; j++) {
          const th = j * Math.PI / 4, bx = ax + 520 * Math.cos(th), by = ay + 520 * Math.sin(th);
          if (!clear(bx, by)) continue;
          let ok = true;
          for (let s = 1; s < 13 && ok; s++) ok = W.walkable(ax + (bx - ax) * s / 13, ay + (by - ay) * s / 13);
          if (ok && W.traceClear(ax, ay, W.groundZ(ax, ay) + 12, bx, by, W.groundZ(bx, by) + 20, W.sblk) &&
              W.traceClear(bx, by, W.groundZ(bx, by) + 20, ax, ay, W.groundZ(ax, ay) + 12, W.sblk)) st = { ax, ay, bx, by, th };
        }
      }
    out.staged = !!st;
    /* the drill: the gun laid toward the tank and the tank driving at it, and who fires first,
       from where, and whether the tank had found the gun */
    const saved = G.units.slice();
    if (st) {
      G.units.length = 0;
      const a = W.spawnUnit('ger', 'hr_pak', st.ax, st.ay, st.th);
      a.setup = 0; a.packed = false; a.pack = 0; a.order = null; a.dest = null; a.path = null;
      const b = W.spawnUnit('us', 'am_sher', st.bx, st.by, st.th + Math.PI);
      b.order = 'attackmove'; b.dest = { x: a.x, y: a.y };
      const seen = new Set(G.shots);
      let t = 0, first = null, bFirst = null;
      const dt = 1 / 20;
      while (t < 40 && !(first && bFirst)) {
        G.t += dt; t += dt;
        W.computeVisibility(dt);
        W.updateUnit(a, dt); W.updateUnit(b, dt); W.updateModels(a, dt);
        W.updateShots(dt);
        for (const s of G.shots) {
          if (seen.has(s)) continue;
          seen.add(s);
          const d = Math.round(Math.hypot(a.x - b.x, a.y - b.y));
          if (s.owner === a && !first) first = { t: +t.toFixed(1), d, found: +(a.detUs || 0).toFixed(2) };
          if (s.owner === b && !bFirst) bFirst = { t: +t.toFixed(1), d };
        }
        if (a.dead || b.dead) break;
      }
      out.first = first; out.bFirst = bFirst;
      G.units.length = 0; saved.forEach(u => G.units.push(u));
      G.shots.length = 0;
    }
    /* the five of them, set up and walking, on open sand asked again after the drill, as the
       57's are, because with cover in reach the loader keeps the slot beside his gunner */
    let at = null;
    for (let r = 0; r < 900 && !at; r += 40)
      for (let k = 0; k < 16 && !at; k++) {
        const x0 = st ? st.ax : uhq.x + 120, y0 = st ? st.ay : uhq.y - 320;
        const x = x0 + r * Math.cos(k * Math.PI / 8), y = y0 + r * Math.sin(k * Math.PI / 8);
        if (clear(x, y) && roomy(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 140)) at = { x, y };
      }
    out.openSand = !!at;
    if (!at) at = W.nearestFree(uhq.x + 120, uhq.y - 320);
    const u = W.spawnUnit('ger', 'hr_pak', at.x, at.y, 0);
    out.count = W.countOf('ger', 'hr_pak') >= 1;
    out.men = u.models.length;
    out.baked = ['hr_atg', 'hr_atb', 'hr_atb_b'].every(v => W.MODELS.man[v] && W.MODELS.man[v][W.POSE_STAND] && W.MODELS.man[v][W.POSE_WALK]) &&
                !!W.MODELS.man.hr_atb[W.POSE_FIRE] && !!(W.MODELS.served.hr_pak && W.MODELS.served.hr_pak.mate) &&
                !!(W.MODELS.gunRec.hr_pak && W.MODELS.gunPk.hr_pak);
    const step = function (s) { for (let i = 0; i < s * 30; i++) { G.t += 1 / 30; W.updateUnit(u, 1 / 30); W.updateModels(u, 1 / 30); } };
    /* set down on its own bearing, as a right-drag gives one: halted with nothing to shoot at, a piece
       turns toward the nearest enemy its side can see, and since the brains could pay for their works a
       pioneer out digging off to a flank kept the gun traversing and all five men walking to places
       that would not stand still, on one run of the gate and not the one before it */
    u.setup = 0; u.packed = false; u.pack = 0; u.faceA = u.facing;
    step(4);
    /* and up to four seconds more while a bearer is still walking to his place: on one run of the Pak
       38's row a bearer was a unit short of it, mid-stride, when the row looked */
    for (let k = 0; k < 4 && u.models.some((m, i) => i > 1 && m.alive && m.pose === W.POSE_WALK); k++) step(1);
    out.set = W.gunSet(u);
    out.setVars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.poses = u.models.map(m => m.pose).join(',');
    const gp = W.gunPost(u), cs = Math.cos(u.facing), sn = Math.sin(u.facing);
    const rel = m => { const dx = m.x - gp.x, dy = m.y - gp.y; return [(dx * cs + dy * sn) / W.FIG_SCALE, (-dx * sn + dy * cs) / W.FIG_SCALE]; };
    const r1 = rel(u.models[1]);
    out.loader = r1.map(v => +v.toFixed(1)).join(',');
    out.loaderRight = r1[1] > 2 && r1[0] < -6;
    out.loaderFaces = Math.abs(W.angDiff(u.models[1].f, u.facing - Math.PI / 2)) < .25;
    out.bearers = u.coverSlots && u.coverSlots[2] ? 'cover' : [2, 3, 4].every(i => rel(u.models[i])[0] < -12);
    out.bpos = [2, 3, 4].map(i => rel(u.models[i]).map(q => Math.round(q)).join(',')).join(' ');
    out.why = (out.openSand ? 'on open sand' : 'NO open sand found') + (u.coverSlots ? ', in cover' : '') + (u.target ? ', a target' : '');
    out.mesh = W.teamMesh(u) === W.MODELS.gun.hr_pak;
    const mz = W.muzzlePoint(u, u.models[0], 0);
    out.muz = Math.hypot(mz.x - gp.x - Math.cos(u.facing) * D.gunMuz[0] * W.FIG_SCALE, mz.y - gp.y - Math.sin(u.facing) * D.gunMuz[0] * W.FIG_SCALE) < 1;
    const box = W.mgCarryAt(u, u.models[2], 2, 'hr_atb') ? W._mgc.buf : null;
    out.box = box === W.MODELS.carry.box50;
    u.packed = true;
    out.packMesh = W.teamMesh(u) === W.MODELS.gunPk.hr_pak;
    const gq = W.gunPost(u), g0 = u.models[0];
    out.runs = +(Math.hypot(gq.x - g0.x, gq.y - g0.y) / W.FIG_SCALE).toFixed(1);
    u.packed = false;
    /* a man of it goes down as one of the crew */
    const m = u.models[2], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.bodyNat = rec ? rec.nat : '-';
    out.fall = !!(W.MODELS.fall.heer_at && W.MODELS.dead.heer_at);
    W.killUnit(u);
    /* a German bunker's anti-tank fitting is the Pak 38 */
    out.bunkKey = W.BUNKUP.at.unit.ger;
    const bk = G.bunks.filter(k => !k.up && !k.upKind && !k.gar)[0];
    if (bk) {
      const was = { own: bk.own, upKind: bk.upKind, upUid: bk.upUid, upBuf: bk.upBuf, upOwn: bk.upOwn };
      const n0 = G.units.length;
      bk.own = 'ger'; bk.up = 'at'; bk.upT = 0; bk.upOwn = 'ger';
      W.finishBunkerUp(bk, true);
      const g = G.units.slice(n0).filter(q => q.id === bk.upUid)[0];
      out.bunkGun = g ? g.key : '-';
      if (g) { if (g.gar) W.leaveBuilding(g); g.dead = true; G.units.splice(G.units.indexOf(g), 1); }
      Object.keys(was).forEach(k => { bk[k] = was[k]; });
      bk.up = null;
    } else out.bunkGun = 'no bunker';
    W.killBuilding(dep);
    return out;
  });
  const fpk = pk38.first, bpk = pk38.bFirst;
  ok('Omaha: the 5 cm Pak 38 is the 352nd\'s anti-tank gun, with five men, sees and reaches past the American armour, and fires first',
     /hr_pak/.test(pk38.makes) && pk38.q === 'hr_pak' && pk38.made === 1 && pk38.count &&
     pk38.eye > pk38.eyeBest && pk38.reach > pk38.reachBest &&
     pk38.staged && !!fpk && (!bpk || bpk.t >= fpk.t + 1) && fpk.found < 1 &&
     pk38.men === 5 && pk38.baked && pk38.set && pk38.setVars === 'hr_atg,hr_atg,hr_atb,hr_atb,hr_atb_b' && /^11,11,/.test(pk38.poses) &&
     pk38.loaderRight && pk38.loaderFaces && pk38.bearers && pk38.mesh && pk38.muz && pk38.box && pk38.packMesh &&
     pk38.runs > 8 && pk38.runs < 12 && pk38.bodyNat === 'heer_at' && pk38.fall &&
     pk38.bunkKey === 'hr_pak' && (pk38.bunkGun === 'hr_pak' || pk38.bunkGun === 'no bunker'),
     `the Kaserne makes ${pk38.makes}; asked for the gun it queues ${pk38.q}, counted as ${pk38.made} made, ` +
     `${pk38.count ? 'one' : 'NONE'} on the field; its eye ${pk38.eye} against the ` +
     `29th's vehicles' best ${pk38.eyeBest} and its reach ${pk38.reach} against ${pk38.reachBest} (the howitzers aside); ` +
     (pk38.staged ? `sited against an M4 at 520 it fired ${fpk ? 'at ' + fpk.t + ' s from ' + fpk.d + ' with the tank ' + (fpk.found < 1 ? 'yet to find it (' + fpk.found + ')' : 'ALREADY on it') : 'NEVER'} ` +
       `and the tank ${bpk ? 'answered at ' + bpk.t + ' s from ' + bpk.d : 'never fired'}; ` : 'NO open sand to stage the drill on; ') +
     `${pk38.men} men, every variant, the served bodies and the three meshes ${pk38.baked ? 'baked' : 'NOT baked'}; halted ` +
     `${pk38.set ? 'set up' : 'NOT set up'} as ${pk38.setVars} in poses ${pk38.poses}, the loader at ${pk38.loader} ` +
     `${pk38.loaderRight ? 'on the right' : 'NOT on the right'} and ${pk38.loaderFaces ? 'facing the breech' : 'NOT facing it'}` +
     `${pk38.loaderRight && pk38.loaderFaces ? '' : ' (' + pk38.why + ')'}, the bearers ` +
     `${pk38.bearers === 'cover' ? 'in cover' : pk38.bearers ? 'back behind the gun' : 'NOT in place (' + pk38.bpos + ')'}, the piece ${pk38.mesh ? 'open' : 'WRONG'}, ` +
     `the flash ${pk38.muz ? 'at the muzzle' : 'OFF the muzzle'}, a bearer's case ${pk38.box ? 'in his hand' : 'MISSING'}; packed the trails ` +
     `${pk38.packMesh ? 'closed' : 'NOT closed'} and the piece ${pk38.runs} from the gunner; killed went down as ${pk38.bodyNat}, bodies ` +
     `${pk38.fall ? 'baked' : 'MISSING'}; the bunker's anti-tank fitting is ${pk38.bunkKey} and put in ${pk38.bunkGun}`);

  /* --- The M3 light tank. The 29th's tracked light tank, on the tank yard's list while the
     M8 is on the motor pool's, and queued by its own key. It is in olive drab, the man in its hatch is a tanker, the
     37 mm stays inside the nose, and the turret comes all the way round. The row is mostly
     the plate: an inch and a half of it in front, half as much again as the Greyhound
     carries, which the 234/1's 2 cm and the Wirbelwind's seldom open where they open the M8
     more often, and which a Panzer IV's round always opens. The eye is up out of the hatch
     and drops to the band when the lid shuts, forty wrecks throw the turret some of the
     time, and killed it leaves American bodies. --- */
  const s3 = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const mot = W.spawnBuilding('us', 'us_tank', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(mot).join(',');
    out.motMakes = W.BUILDINGS.us_mot.makes.join(',');
    out.fielded = W.fielded('am_stuart');
    G.res.us.mp += 2000; G.res.us.fu += 600;
    const q0 = mot.queue.length, m0 = W.madeOf('us', 'am_stuart');
    out.q = W.queueUnit(mot, 'am_stuart') ? mot.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('us', 'am_stuart') - m0;
    mot.queue.length = q0;
    const t = W.spawnUnit('us', 'am_stuart', hq.x + 140, hq.y - 220, 0);
    const V = W.VMODEL.am_stuart, B = W.MODELS.veh.am_stuart, H = W.HATCHES.am_stuart, A = W.KIT.usa;
    out.bufs = !!(B && B.hull && B.tur && B.hatch && B.cmdr && B.leaf && B.inside);
    out.od = V.hull.filter(f => f.c === W.M4C.od || f.c === W.M4C.odL).length;
    out.turOd = V.tur.filter(f => f.c === W.M4C.od || f.c === W.M4C.odL).length;
    out.tanker = H.open.filter(f => f.c === A.hide).length;
    out.m1 = H.open.filter(f => f.c === A.helm || f.c === A.helmD).length;
    const nose = Math.max.apply(null, V.hull.map(f => Math.max.apply(null, f.v.map(p => p[0]))));
    out.reach = +(V.turX + V.bar - nose).toFixed(1);
    t.facing = 0; t.turret = 0; t.want = Math.PI - .05;
    for (let i = 0; i < 12; i++) W.updateModels(t, 1.0);
    out.lay = +Math.abs(W.angDiff(t.turret, Math.PI - .05)).toFixed(3);
    t.turret = 0; t.want = undefined;
    /* the plate in front against the three light guns and the Panzer IV's, at two hundred */
    const d = 200, m8 = W.spawnUnit('us', 'am_m8', t.x, t.y + 150, 0);
    out.front = W.ARM.am_stuart.h[0]; out.m8 = W.ARM.am_m8.h[0];
    const pc = (k, v) => +W.penVs(W.UNITS[k].w, d, v, v.x + d, v.y).toFixed(2);
    out.p234 = pc('hr_234', t); out.pWirb = pc('hr_wirb', t); out.pKs = pc('hr_ks750', t); out.pP4 = pc('hr_p4', t);
    out.p234m8 = pc('hr_234', m8);
    G.units.splice(G.units.indexOf(m8), 1);
    W.povOn(t);
    W.povHatch(true); const up = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povHatch(false); const dn = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povOff();
    out.eyeUp = +up.toFixed(1); out.eyeIn = +dn.toFixed(1);
    const nw = G.wrecks.length;
    let blown = 0;
    for (let i = 0; i < 80; i++) { const w = W.makeWreck(t); if (w.blown) blown++; }
    G.wrecks.length = nw;
    out.blown = blown;
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(mot);
    return out;
  });
  /* A tank under 500 hit points throws its turret on eighteen deaths in a hundred, so forty
     wrecks throw two or fewer on one run in sixty; asked for three, the row failed a gate on
     two. It asks what the M8's and the 234's rows ask: some of the time and not all of it.
     And it asks it of eighty, as they do: forty of them threw none on one desktop run, which
     forty do once in 2,800 at that rate and eighty once in seven million. */
  ok('Omaha: the 29th fields the M3 light tank out of the tank yard, in olive drab, on plate the light guns seldom open',
     /am_stuart/.test(s3.makes) && /am_m8/.test(s3.motMakes) && s3.fielded && s3.q === 'am_stuart' && s3.made === 1 &&
     s3.bufs && s3.od > 50 && s3.turOd > 20 && s3.tanker > 0 && s3.m1 === 0 && s3.reach < 0 && s3.lay < .05 &&
     s3.front > s3.m8 * 1.4 && s3.p234 < .1 && s3.pWirb < .1 && s3.pKs < .05 && s3.p234m8 > .8 && s3.pP4 > .95 &&
     s3.eyeUp > 28 && s3.eyeUp < 35 && s3.eyeIn > 21 && s3.eyeIn < s3.eyeUp - 4 &&
     s3.blown > 0 && s3.blown < 60 && s3.bodies >= 1 && s3.bodyNat === 'usa',
     `the tank yard makes ${s3.makes} and the motor pool ${s3.motMakes}; asked for the M3 it queues ${s3.q}, counted as ${s3.made} made; buffers ` +
     `${s3.bufs ? 'all built' : 'MISSING'}; ${s3.od} hull and ${s3.turOd} turret faces in olive drab; the man in the hatch has ` +
     `${s3.tanker} faces of tanker's helmet and ${s3.m1} of M1; the muzzle ${s3.reach} past the nose; asked to lay over the tail ` +
     `the turret is ${s3.lay} short; plate ${s3.front} in front against the M8's ${s3.m8}; at 200 the 234/1's 2 cm goes through it ` +
     `${s3.p234} (and the M8 ${s3.p234m8}), the Wirbelwind's ${s3.pWirb}, the KS 750's MG 34 ${s3.pKs} and the Panzer IV's ${s3.pP4}; ` +
     `the eye ${s3.eyeUp} up out of the hatch and ${s3.eyeIn} at the band; ${s3.blown} of 80 wrecks threw the turret; killed, it ` +
     `left ${s3.bodies} bodies of ${s3.bodyNat}`);

  /* --- The M26 Pershing. The 29th's heavy tank: the motor pool lists it beside the M4A1 and
     queues it by its own key. It is in olive drab, the man in its cupola is a tanker, the
     90 mm stands well out past the nose, and the turret comes all the way round. Most of
     the row is the plate and the gun against the two German tanks on
     the beach: four inches at forty-six degrees in front that a Panzer IV's round opens less
     than two times in three and a side it opens every time, and a 90 mm that goes through a
     Panther's front most of the time and a Panzer IV's every time. The eye is up out of the
     cupola and drops when the lid shuts, forty wrecks throw the turret some of the time, and
     killed it leaves American bodies. --- */
  const m26 = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const mot = W.spawnBuilding('us', 'us_tank', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(mot).join(',');
    out.fielded = W.fielded('am_m26');
    G.res.us.mp += 2000; G.res.us.fu += 600;
    const q0 = mot.queue.length, m0 = W.madeOf('us', 'am_m26');
    out.q = W.queueUnit(mot, 'am_m26') ? mot.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('us', 'am_m26') - m0;
    mot.queue.length = q0;
    const t = W.spawnUnit('us', 'am_m26', hq.x + 140, hq.y - 220, 0);
    const V = W.VMODEL.am_m26, B = W.MODELS.veh.am_m26, H = W.HATCHES.am_m26, A = W.KIT.usa;
    out.bufs = !!(B && B.hull && B.tur && B.hatch && B.cmdr && B.leaf && B.inside);
    out.od = V.hull.filter(f => f.c === W.M4C.od || f.c === W.M4C.odL).length;
    out.turOd = V.tur.filter(f => f.c === W.M4C.od || f.c === W.M4C.odL).length;
    out.tanker = H.open.filter(f => f.c === A.hide).length;
    out.m1 = H.open.filter(f => f.c === A.helm || f.c === A.helmD).length;
    const nose = Math.max.apply(null, V.hull.map(f => Math.max.apply(null, f.v.map(p => p[0]))));
    out.reach = +(V.turX + V.bar - nose).toFixed(1);
    t.facing = 0; t.turret = 0; t.want = Math.PI - .05;
    for (let i = 0; i < 14; i++) W.updateModels(t, 1.0);
    out.lay = +Math.abs(W.angDiff(t.turret, Math.PI - .05)).toFixed(3);
    t.turret = 0; t.want = undefined;
    /* the plate and the gun against the two German tanks, at three hundred */
    const d = 300, AR = W.ARM.am_m26;
    out.front = AR.h[0]; out.side = AR.h[1];
    const pc = (w, v, fx, fy) => +W.penVs(w, d, v, fx, fy).toFixed(2);
    out.pP4 = pc(W.UNITS.hr_p4.w, t, t.x + d, t.y); out.pP4S = pc(W.UNITS.hr_p4.w, t, t.x, t.y + d);
    const pan = W.spawnUnit('ger', 'hr_panther', hq.x + 400, hq.y - 220, 0);
    const p4 = W.spawnUnit('ger', 'hr_p4', hq.x + 400, hq.y - 340, 0);
    out.onPan = pc(t.def.w, pan, pan.x + d, pan.y);
    out.onP4 = pc(t.def.w, p4, p4.x + d, p4.y);
    out.m4OnPan = pc(W.UNITS.am_sher.w, pan, pan.x + d, pan.y);
    W.killUnit(pan); W.killUnit(p4);
    W.povOn(t);
    W.povHatch(true); const up = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povHatch(false); const dn = W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz);
    W.povOff();
    out.eyeUp = +up.toFixed(1); out.eyeIn = +dn.toFixed(1);
    const nw = G.wrecks.length;
    let blown = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; }
    G.wrecks.length = nw;
    out.blown = blown;
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(mot);
    return out;
  });
  ok('Omaha: the 29th fields the M26 beside the M4A1, in olive drab, its 90 mm through a Panther\'s front',
     /am_m26/.test(m26.makes) && /am_sher/.test(m26.makes) && m26.fielded && m26.q === 'am_m26' && m26.made === 1 &&
     m26.bufs && m26.od > 80 && m26.turOd > 20 && m26.tanker > 0 && m26.m1 === 0 && m26.reach > 20 && m26.lay < .05 &&
     m26.pP4 < .2 && m26.pP4S > .95 && m26.onPan > .3 && m26.onP4 > .95 && m26.onPan > m26.m4OnPan &&
     m26.eyeUp > 30 && m26.eyeUp < 40 && m26.eyeIn > 22 && m26.eyeIn < m26.eyeUp - 4 &&
     m26.blown > 2 && m26.blown < 30 && m26.bodies >= 1 && m26.bodyNat === 'usa',
     `the tank yard makes ${m26.makes}; asked for the M26 it queues ${m26.q}, counted as ${m26.made} made; buffers ` +
     `${m26.bufs ? 'all built' : 'MISSING'}; ${m26.od} hull and ${m26.turOd} turret faces in olive drab; the man in the cupola has ` +
     `${m26.tanker} faces of tanker's helmet and ${m26.m1} of M1; the muzzle ${m26.reach} past the nose; asked to lay over the tail ` +
     `the turret is ${m26.lay} short; plate ${m26.front} in front and ${m26.side} on the side; at 300 the Panzer IV's round goes through ` +
     `the front ${m26.pP4} and the side ${m26.pP4S}; the 90 mm goes through a Panther's front ${m26.onPan} (the M4A1's 75 ${m26.m4OnPan}) ` +
     `and a Panzer IV's ${m26.onP4}; the eye ${m26.eyeUp} up out of the cupola and ${m26.eyeIn} with the lid shut; ${m26.blown} of 40 ` +
     `wrecks threw the turret; killed, it left ${m26.bodies} bodies of ${m26.bodyNat}`);

  /* --- The M18 Hellcat. The 29th's tank destroyer: the tank yard lists it beside the M26 and
     queues it by its own key. It is in olive drab under an open turret with nothing roofing it
     over, the three men in it wear the tanker's helmet and no M1, the commander stands with his
     head over the rim, the .50 on the rim is standard, the 76 mm stands out past the nose and the
     turret comes all the way round. It is the fastest thing in the yard. Most of the row is the
     trade it makes: a front any German gun opens at three hundred, a 76 mm that goes through a
     Panzer IV's front most of the time and a Panther's side every time and its front about two
     times in three, and an open turret that takes more off a burst beside it than the M4A1 does.
     The eye is the commander's over the rim, forty wrecks throw the turret some of the time, and
     killed it leaves American bodies. --- */
  const hc = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const yard = W.spawnBuilding('us', 'us_tank', hq.x + 240, hq.y - 120, true);
    out.makes = W.makesOf(yard).join(',');
    out.fielded = W.fielded('am_m18');
    G.res.us.mp += 2000; G.res.us.fu += 600;
    const q0 = yard.queue.length, m0 = W.madeOf('us', 'am_m18');
    out.q = W.queueUnit(yard, 'am_m18') ? yard.queue.slice(-1)[0] : 'refused';
    out.made = W.madeOf('us', 'am_m18') - m0;
    yard.queue.length = q0;
    const t = W.spawnUnit('us', 'am_m18', hq.x + 140, hq.y - 220, 0);
    const V = W.VMODEL.am_m18, B = W.MODELS.veh.am_m18, A = W.KIT.usa, rim = W.HCT.zr;
    out.bufs = !!(B && B.hull && B.tur && B.turCrew && B.mg && B.inside);
    out.od = V.hull.filter(f => f.c === W.M4C.od || f.c === W.M4C.odL).length;
    out.turOd = V.tur.filter(f => f.c === W.M4C.od || f.c === W.M4C.odL).length;
    out.roof = V.tur.filter(f => f.v.every(p => p[2] >= rim - .1 && Math.hypot(p[0], p[1]) < 7)).length;
    out.tanker = V.turCrew.filter(f => f.c === A.hide).length;
    out.m1 = V.turCrew.filter(f => f.c === A.helm || f.c === A.helmD).length;
    out.over = V.turCrew.filter(f => f.v.some(p => p[2] > rim + 2)).length;
    out.sec = W.secondaryKeys(t).join(',');
    const nose = Math.max.apply(null, V.hull.map(f => Math.max.apply(null, f.v.map(p => p[0]))));
    out.reach = +(V.turX + V.bar - nose).toFixed(1);
    t.facing = 0; t.turret = 0; t.want = Math.PI - .05;
    for (let i = 0; i < 14; i++) W.updateModels(t, 1.0);
    out.lay = +Math.abs(W.angDiff(t.turret, Math.PI - .05)).toFixed(3);
    t.turret = 0; t.want = undefined;
    out.fastest = W.makesOf(yard).filter(k => k !== 'am_m18').every(k => W.UNITS[k].speed < t.def.speed);
    /* the trade, at three hundred */
    const d = 300;
    out.front = W.ARM.am_m18.h[0];
    const pc = (w, v, fx, fy) => +W.penVs(w, d, v, fx, fy).toFixed(2);
    out.pP4 = pc(W.UNITS.hr_p4.w, t, t.x + d, t.y); out.pPak = pc(W.UNITS.hr_pak.w, t, t.x + d, t.y);
    const pan = W.spawnUnit('ger', 'hr_panther', hq.x + 400, hq.y - 220, 0);
    const p4 = W.spawnUnit('ger', 'hr_p4', hq.x + 400, hq.y - 340, 0);
    out.onP4 = pc(t.def.w, p4, p4.x + d, p4.y);
    out.onPan = pc(t.def.w, pan, pan.x + d, pan.y);
    out.onPanS = pc(t.def.w, pan, pan.x, pan.y + d);
    W.killUnit(pan); W.killUnit(p4);
    /* the same burst beside it and beside an M4A1 staged where it stood, thirty up so it opens
       no ground for the rows below */
    const foe = W.spawnUnit('ger', 'hr_gren', t.x + 900, t.y + 900, 0);
    const burst = (u) => { const h0 = u.hp; W.explode(u.x + 10, u.y, 30, 120, foe, null, 30, null); return h0 - u.hp; };
    out.lost = +burst(t).toFixed(1);
    const m4 = W.spawnUnit('us', 'am_sher', t.x, t.y + 120, 0);
    out.lostM4 = +burst(m4).toFixed(1);
    [foe, m4].forEach(u => { u.dead = true; G.units.splice(G.units.indexOf(u), 1); });
    t.hp = t.def.hp;
    W.povOn(t);
    out.eye = +(W.povEye().z - (t.gz === undefined ? W.groundZ(t.x, t.y) : t.gz)).toFixed(1);
    W.povOff();
    const nw = G.wrecks.length;
    let blown = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; }
    G.wrecks.length = nw;
    out.blown = blown;
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    W.killBuilding(yard);
    return out;
  });
  ok('Omaha: the 29th fields the M18 beside the M26, open, fast and thin, its 76 mm through a Panzer IV\'s front',
     /am_m18/.test(hc.makes) && /am_m26/.test(hc.makes) && hc.fielded && hc.q === 'am_m18' && hc.made === 1 &&
     hc.bufs && hc.od > 80 && hc.turOd > 20 && hc.roof === 0 && hc.tanker > 0 && hc.m1 === 0 && hc.over > 0 &&
     /mg/.test(hc.sec) && hc.reach > 12 && hc.lay < .05 && hc.fastest &&
     hc.pP4 > .95 && hc.pPak > .95 && hc.onP4 > .8 && hc.onPan < .1 && hc.onPanS > .95 &&
     hc.lost > hc.lostM4 * 1.25 && hc.lostM4 > 0 && hc.eye > 24 && hc.eye < 36 &&
     hc.blown > 2 && hc.blown < 38 && hc.bodies >= 1 && hc.bodyNat === 'usa',
     `the tank yard makes ${hc.makes}; asked for the M18 it queues ${hc.q}, counted as ${hc.made} made; buffers ` +
     `${hc.bufs ? 'all built' : 'MISSING'}; ${hc.od} hull and ${hc.turOd} turret faces in olive drab; ${hc.roof} faces roofing it ` +
     `over; the men have ${hc.tanker} faces of tanker's helmet and ${hc.m1} of M1, ${hc.over} of them more than 2 over the rim; ` +
     `secondary ${hc.sec || 'none'}; the muzzle ${hc.reach} past the nose; asked to lay over the tail the turret is ${hc.lay} short; ` +
     `${hc.fastest ? 'the fastest in the yard' : 'NOT the fastest in the yard'}; plate ${hc.front} in front, which at 300 the Panzer ` +
     `IV's round opens ${hc.pP4} and the Pak 38's ${hc.pPak}; the 76 mm goes through a Panzer IV's front ${hc.onP4}, a Panther's ` +
     `front ${hc.onPan} and its side ${hc.onPanS}; a 120-point burst took ${hc.lost} off it and ${hc.lostM4} off the M4A1; the eye ` +
     `${hc.eye} up; ${hc.blown} of 40 wrecks threw the turret; killed, it left ${hc.bodies} bodies of ${hc.bodyNat}`);

  /* --- Where a round lands on a vehicle decides whether it goes through. The 57 never goes
     through a Panther's front and always through its side and rear; a round is landed on a face
     that turns toward the gun, the sampler that lands it agrees with the chance the brain is
     told, and a gun met head on is hit on its front. Then a real round: an M4 to the east of a
     Panther fires until one hits, the shell is flown to the point on the plate, glances off and
     neither hurts the tank nor opens the ground under it; from the north it goes into the side
     and does its damage. The Panther is given a million hit points so that it is there to be
     shot at, and the rounds that missed are taken off the list before they land. --- */
  const ar = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const px = hq.x, py = hq.y - 520, d = 300;
    const pan = W.spawnUnit('ger', 'hr_panther', px, py, 0);
    pan.facing = 0; pan.turret = 0; pan.gz = undefined; pan.hp = pan.maxhp = 1e6;
    const at = W.UNITS.am_at.w, m4w = W.UNITS.am_sher.w;
    out.atFront = +W.penVs(at, d, pan, px + d, py).toFixed(3);
    out.atClose = +W.penVs(at, 40, pan, px + 40, py).toFixed(3);
    out.atSide = +W.penVs(at, d, pan, px, py + d).toFixed(3);
    out.atRear = +W.penVs(at, d, pan, px - d, py).toFixed(3);
    const A = W.armOf(pan), B = W.vehBox(W.vkey(pan));
    let worst = 0, away = 0, fronts = 0, sides = 0;
    [[0, 'f'], [.5, ''], [Math.PI / 2, 's'], [Math.PI, '']].forEach(([a, tag]) => {
      const fx = px + Math.cos(a) * d, fy = py + Math.sin(a) * d, N = 500;
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const L = W.hitLoc(pan, A, B, fx, fy, m4w, d);
        sum += L.p;
        if (Math.cos((L.tur ? pan.turret : pan.facing) + L.na - a) < -1e-6) away++;
        if (tag === 'f' && L.f.charAt(1) === 'f') fronts++;
        if (tag === 's' && L.f.charAt(1) === 's') sides++;
      }
      worst = Math.max(worst, Math.abs(sum / N - W.penVs(m4w, d, pan, fx, fy)));
    });
    out.worst = +worst.toFixed(3); out.away = away; out.fronts = fronts; out.sides = sides;
    const fire = (fx, fy) => {
      const m4 = W.spawnUnit('us', 'am_sher', fx, fy, 0), r = {};
      m4.facing = m4.turret = Math.atan2(py - fy, px - fx);
      r.line = W.fireLine(m4, pan);
      let shell = null;
      for (let k = 0; k < 60 && !shell; k++) {
        m4.cd = 0; m4.sup = 0;
        const n0 = G.shots.length;
        W.fireAt(m4, pan, 0);
        const sh = G.shots.slice(n0).filter(q => q.kind === 'shell');
        sh.forEach(q => { if (q.loc && !shell) shell = q; else G.shots.splice(G.shots.indexOf(q), 1); });
      }
      G.units.splice(G.units.indexOf(m4), 1);
      if (!shell) return r;
      const lw = W.locWorld(pan, shell.loc);
      r.pen = shell.loc.pen; r.face = shell.loc.f;
      r.onPlate = +Math.hypot(shell.tx - lw.x, shell.ty - lw.y).toFixed(2);
      r.z1 = +shell.z1.toFixed(1);
      const hp0 = pan.hp, dug0 = G.cratersDug;
      for (let i = 0; i < 200 && G.shots.indexOf(shell) >= 0; i++) W.updateShots(1 / 30);
      r.lost = +(hp0 - pan.hp).toFixed(1); r.dug = G.cratersDug - dug0;
      return r;
    };
    out.front = fire(px + d, py);
    out.side = fire(px, py + d);
    G.units.splice(G.units.indexOf(pan), 1);
    return out;
  });
  ok('a round lands on the face of a vehicle the gun can see, and the plate there decides it',
     ar.atFront === 0 && ar.atClose === 0 && ar.atSide > .95 && ar.atRear > .95 && ar.worst < .06 && ar.away === 0 &&
     ar.fronts > 450 && ar.sides > 450 && ar.front.line && ar.front.pen === 0 && ar.front.onPlate < .5 && ar.front.z1 > 2 &&
     ar.front.lost === 0 && ar.front.dug === 0 && ar.side.pen === 1 && ar.side.lost >= 140 && ar.side.dug === 0,
     `the 57 through a Panther's front ${ar.atFront} at 300 and ${ar.atClose} at 40, its side ${ar.atSide} and its rear ${ar.atRear}; ` +
     `the sampler within ${ar.worst} of the integral, ${ar.away} rounds on a face turned away from the gun, ${ar.fronts} of 500 head-on ` +
     `rounds on a front face and ${ar.sides} of 500 broadside on a side face; an M4's round at the front ` +
     `(${ar.front.line ? 'a line' : 'NO LINE'}) landed on ${ar.front.face} ${ar.front.onPlate} off the plate, ${ar.front.z1} up, ` +
     `${ar.front.pen ? 'WENT IN' : 'glanced off'}, took ${ar.front.lost} off it and dug ${ar.front.dug}; at the side it landed on ` +
     `${ar.side.face}, ${ar.side.pen ? 'went in' : 'GLANCED OFF'}, took ${ar.side.lost} and dug ${ar.side.dug}`);

  /* --- The 29th's second batch. The motor pool makes the M16 beside the M3, the 3-inch gun and
     the 105, and the barracks the 81. The M16's buffers are built and its quad mount
     goes the whole way round; the 3-inch is seven men who run it along with the trails closed,
     and a half-track can still hitch it and draws it at its own tail; the 105 is five and
     fires only on an order; the 81 is its own mortar and not the German one's. The rifle
     squad takes both its fittings at once, which put the BAR in two men's hands and the
     launcher on two men's Garands, and the grenadiers' launcher goes off on a clock of its
     own at the section the squad is shooting at. --- */
  const us2 = await page.evaluate(() => {
    const W = window, G = W.G, out = {}, dt = 1 / 30;
    const keep = G.units.slice(), shots = G.shots.slice();
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    const mot = W.spawnBuilding('us', 'us_mot', hq.x + 240, hq.y - 120, true);
    const bar = W.spawnBuilding('us', 'us_bar', hq.x - 240, hq.y - 120, true);
    out.mot = W.makesOf(mot).join(','); out.bar = W.makesOf(bar).join(',');
    G.res.us.mp += 3000; G.res.us.fu += 600;
    const q0 = mot.queue.length;
    out.q = W.queueUnit(mot, 'am_m16') ? mot.queue.slice(-1)[0] : 'refused';
    mot.queue.length = q0;
    const B = W.MODELS.veh.am_m16;
    out.bufs = !!(B && B.hull && B.tur && B.turCrew);
    const v = W.spawnUnit('us', 'am_m16', hq.x + 140, hq.y - 220, 0);
    v.facing = 0; v.turret = 0; v.want = Math.PI - .05;
    for (let i = 0; i < 12; i++) W.updateModels(v, 1.0);
    out.lay = +Math.abs(W.angDiff(v.turret, Math.PI - .05)).toFixed(3);
    out.carries = W.carriesOf(v); out.tows = !!v.def.tows;
    /* the two guns and the mortar */
    const g = W.spawnUnit('us', 'us_t8', hq.x + 200, hq.y - 320, 0), h = W.spawnUnit('us', 'us_how', hq.x - 200, hq.y - 320, 0);
    out.t8 = g.models.length; out.t8speed = g.def.speed; out.t8tow = !!(g.def.towable && g.def.towAt);
    out.t8pk = !!(W.MODELS.gunPk.us_t8 && W.MODELS.gunRec.us_t8 && W.MODELS.served.us_t8);
    out.how = h.models.length; out.howOrder = !!W.onOrderOnly(h); out.howPk = !!(W.MODELS.gunPk.us_how && W.MODELS.served.us_how);
    out.mor = W.GUNMODEL.us_mor.mesh.length; out.morGer = W.GUNMODEL.ger_mor.mesh.length;
    /* hitched, the 3-inch rides at the tow's tail */
    const ht = W.spawnUnit('us', 'am_m3', g.x, g.y - 150, Math.PI / 2);
    g.setup = 0; g.packed = true; g.pack = 0;
    W.hitchGun(ht, g);
    W.updateUnit(g, dt);
    const back = Math.hypot(g.x - ht.x, g.y - ht.y);
    out.towBack = +(back - (ht.bodyL - (ht.bodyX || 0))).toFixed(1);
    out.towed = g.towedBy === ht;
    /* the rifle squad with both fittings */
    const sp = window.__o.flatSpot(260);
    G.units.length = 0; G.shots.length = 0;
    const u = W.spawnUnit('us', 'am_rifle', sp.x, sp.y, 0);
    W.fitUp(u, 'bar2'); W.fitUp(u, 'rgren');
    out.vars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.baked = !!(W.MODELS.man.gi_bar && W.MODELS.man.gi_rgren);
    out.bar2 = W.mainW(u) === W.UNITS.am_rifle.wUp.bar2;
    out.gl = !!W.glOf(u);
    const e = W.spawnUnit('ger', 'hr_gren', sp.x + 170, sp.y, Math.PI);
    let gl = 0;
    const real = W.fireAt;
    W.fireAt = function (a, b, c, o) { const was = a.glcd || 0, r = real(a, b, c, o); if (o && o.gl && (a.glcd || 0) > was + .5) gl++; return r; };
    for (let i = 0; i < 30 * 20; i++) {
      if (i % 3 === 0) W.computeVisibility();
      [u, e].forEach(q => { if (!q.dead) W.updateUnit(q, dt); });
      W.updateShots(dt); G.t += dt;
    }
    W.fireAt = real;
    out.glFired = gl;
    G.units.length = 0; keep.forEach(q => G.units.push(q));
    G.shots.length = 0; shots.forEach(q => G.shots.push(q));
    W.killBuilding(mot); W.killBuilding(bar);
    return out;
  });
  ok('Omaha: the 29th fields the M16, the 3-inch gun, the 105 and its own 81, and the rifle squad takes the BAR and rifle grenades together',
     /am_m16/.test(us2.mot) && /us_t8/.test(us2.mot) && /us_how/.test(us2.mot) && /us_mor/.test(us2.bar) && us2.q === 'am_m16' &&
     us2.bufs && us2.lay < .05 && !us2.carries && !us2.tows &&
     us2.t8 === 7 && us2.t8speed > 0 && us2.t8tow && us2.t8pk && us2.towed && Math.abs(us2.towBack - 47) < 20 &&
     us2.how === 5 && us2.howOrder && us2.howPk && us2.mor > us2.morGer &&
     us2.vars === 'gi_sgt,gi_rifle_b,gi_rgren,gi_rgren,gi_bar,gi_bar' && us2.baked && us2.bar2 && us2.gl && us2.glFired > 0,
     `the motor pool makes ${us2.mot} and the barracks ${us2.bar}; asked for the M16 it queues ${us2.q}; its buffers ` +
     `${us2.bufs ? 'all built' : 'MISSING'}, the mount laid over the tail ${us2.lay} short, carrying ${us2.carries} and ` +
     `${us2.tows ? 'TOWING' : 'towing nothing'}; the 3-inch is ${us2.t8} men at ${us2.t8speed} with the closed piece and the served ` +
     `bodies ${us2.t8pk ? 'built' : 'MISSING'}, ${us2.towed ? 'hitched' : 'NOT hitched'} and riding ${us2.towBack} past the tow's tail; ` +
     `the 105 is ${us2.how} men, ${us2.howOrder ? 'on order only' : 'FIRING FREE'}; the 81 is ${us2.mor} faces against the German's ` +
     `${us2.morGer}; the rifle squad with both fittings is ${us2.vars} (${us2.baked ? 'baked' : 'NOT BAKED'}), the BARs ` +
     `${us2.bar2 ? 'in' : 'NOT in'} its line, the launcher ${us2.gl ? 'issued' : 'MISSING'}, ${us2.glFired} grenades in twenty seconds`);

  /* --- The self-propelled guns, the Marder and the Weasel. The Priest and the Wespe come out of
     their motor pools and fire a mission as the towed guns do, laying the mount inside the arc
     and turning the hull for the rest; the Priest rebuilt as the M12 is another vehicle and
     another piece, with the 155's reach and its own name; the Marder's Pak 40 comes round only
     as far as the casemate lets it; and the Weasel comes out of the barracks and carries one
     squad. The rounds are counted off the mission as they leave the tube, with the bursts
     switched off, because a mission that lands near a headquarters on the beach digs holes and
     cuts craft that every row below would stand on. --- */
  const sp5 = await page.evaluate(() => {
    const W = window, G = W.G, out = {}, dt = 1 / 30;
    const keep = G.units.slice(), shots = G.shots.slice(), boom = W.explode;
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0], gq = G.blds.filter(b => b.own === 'ger' && b.def.hq)[0];
    const mot = W.spawnBuilding('us', 'us_mot', hq.x + 240, hq.y - 120, true);
    const bar = W.spawnBuilding('us', 'us_bar', hq.x - 240, hq.y - 120, true);
    const dep = W.spawnBuilding('ger', 'ger_dep', gq.x - 240, gq.y + 120, true);
    G.res.us.mp += 4000; G.res.us.fu += 900; G.res.ger.mp += 4000; G.res.ger.fu += 900;
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = [q(mot, 'am_m7'), q(bar, 'am_weasel'), q(dep, 'hr_wespe'), q(dep, 'hr_marder')].join(',');
    out.bufs = ['am_m7', 'am_m12', 'hr_wespe', 'hr_marder', 'am_weasel'].filter(k => {
      const B = W.MODELS.veh[k]; return !(B && B.hull && B.tur && B.turCrew && B.crew); }).join(',') || 'all';
    W.explode = function () {};
    function mission(side, key, up) {
      const h = side === 'us' ? hq : gq, s = side === 'us' ? 1 : -1;
      const sp = W.nearestFree(h.x + s * 260, h.y);
      const u = W.spawnUnit(side, key, sp.x, sp.y, side === 'us' ? 0 : Math.PI);
      if (up) W.fitUp(u, up);
      u.setup = 0;
      let a = u.facing + Math.PI / 2, tx = u.x + Math.cos(a) * 600, ty = u.y + Math.sin(a) * 600;
      if (ty < 80 || ty > W.WORLD.h - 80) { a = u.facing - Math.PI / 2; tx = u.x + Math.cos(a) * 600; ty = u.y + Math.sin(a) * 600; }
      const f0 = u.facing, ok = W.orderBarrage(u, tx, ty), n = u.barrage ? u.barrage.left : 0;
      for (let i = 0; i < 30 * 60 && u.barrage; i++) { W.updateUnit(u, dt); W.updateShots(dt); G.t += dt; }
      return { ok: !!ok, n: n, left: u.barrage ? u.barrage.left : 0, turn: +Math.abs(W.angDiff(u.facing, f0)).toFixed(2),
               name: W.nameOf(u), vk: W.vkey(u), reach: W.barrageRange(u), arc: +W.arcOf(u).toFixed(2) };
    }
    out.m7 = mission('us', 'am_m7');
    out.m12 = mission('us', 'am_m7', 'm12');
    out.ws = mission('ger', 'hr_wespe');
    /* the Calliope: out of the tank yard, its gun and rack and the rod and springs between them
       built, laid up to the mission's range before a rocket leaves, thirty rockets to a mission,
       each leaving its tube along it and bending onto its mark, the rack half empty after one
       mission and empty after two with the reload begun, and smoke refused */
    const ty3 = W.spawnBuilding('us', 'us_tank', hq.x - 240, hq.y + 120, true);
    out.calQ = q(ty3, 'am_t34');
    const CB = W.MODELS.veh.am_t34;
    out.calBufs = !!(CB && CB.elv && CB.elv.gun && CB.elv.rack && CB.lk && CB.lk.length === 3 && W.MODELS.rkt && W.MODELS.rkt.m8 && W.MODELS.rkt.wgr);
    (function () {
      const sp = W.nearestFree(hq.x + 260, hq.y), u = W.spawnUnit('us', 'am_t34', sp.x, sp.y, 0);
      u.setup = 0;
      let a = Math.PI / 2, tx = u.x + Math.cos(a) * 600, ty = u.y + Math.sin(a) * 600;
      if (ty < 80 || ty > W.WORLD.h - 80) { a = -Math.PI / 2; tx = u.x; ty = u.y - 600; }
      out.calOk = !!W.orderBarrage(u, tx, ty); out.calN = u.barrage ? u.barrage.left : 0;
      let elAt = -1, rk = 0, bent = 0, off = 0, z0 = 1e9;
      const seen = new Set(), tubes = [], rl = W.rkLaunch;
      /* the tube each rocket left, as the game laid it, hull's own lie on the sand and all */
      W.rkLaunch = function (v) { const L = rl(v); if (L && v === u) tubes.push(L); return L; };
      for (let i = 0; i < 30 * 40 && u.barrage; i++) {
        W.updateUnit(u, dt);
        G.shots.forEach(s => {
          if (s.rk !== 'm8' || s.owner !== u || seen.has(s)) return;
          seen.add(s); rk++; if (s.cx !== undefined) bent++; z0 = Math.min(z0, s.z0);
          if (elAt < 0) elAt = +(u.el || 0).toFixed(3);
          /* the rocket's first step against the tube it left: the climb and the bearing */
          const A = W.rocketAt(s), L = Math.atan2(A.dz, Math.hypot(A.dx, A.dy)), T = tubes.shift();
          off = T ? Math.max(off, Math.abs(L - T.el), Math.abs(W.angDiff(Math.atan2(A.dy, A.dx), T.a))) : 9;
        });
        W.updateShots(dt); G.t += dt;
      }
      W.rkLaunch = rl;
      out.calRk = rk; out.calBent = bent; out.calEl = elAt; out.calWant = +(u.elWant || 0).toFixed(3); out.calOff = +off.toFixed(3);
      out.calZ0 = +z0.toFixed(1); out.calRack1 = u.rack;
      W.orderBarrage(u, tx, ty);
      for (let i = 0; i < 30 * 40 && u.barrage; i++) { W.updateUnit(u, dt); W.updateShots(dt); G.t += dt; }
      out.calRack2 = u.rack; out.calReload = +u.reload.toFixed(0);
      out.calSmoke = W.orderBarrage(u, tx, ty, true) ? 'TAKEN' : 'refused';
      out.calName = W.nameOf(u);
    })();
    /* and the Nebelwerfer's are rockets as well */
    (function () {
      const sp = W.nearestFree(gq.x - 260, gq.y), u = W.spawnUnit('ger', 'ger_neb', sp.x, sp.y, Math.PI);
      u.setup = 0; u.packed = false;
      W.orderBarrage(u, u.x, u.y + (u.y > W.WORLD.h / 2 ? -500 : 500));
      let wgr = 0;
      for (let i = 0; i < 30 * 20 && u.barrage; i++) {
        W.updateUnit(u, dt); G.shots.forEach(s => { if (s.owner === u && s.rk === 'wgr' && s.t === 0) wgr++; }); W.updateShots(dt); G.t += dt;
      }
      out.nebRk = wgr;
    })();
    W.killBuilding(ty3);
    W.explode = boom;
    /* the Marder asked to lay further round than its casemate goes */
    const mr = W.spawnUnit('ger', 'hr_marder', gq.x - 140, gq.y + 220, 0);
    mr.facing = 0; mr.turret = 0; mr.want = 1.2;
    for (let i = 0; i < 30; i++) W.updateModels(mr, .2);
    out.mrArc = +W.arcOf(mr).toFixed(2); out.mrTur = +mr.turret.toFixed(3);
    /* the Weasel takes one squad and refuses a second */
    const wz = W.spawnUnit('us', 'am_weasel', hq.x + 140, hq.y - 220, 0);
    const s1 = W.spawnUnit('us', 'am_rifle', wz.x + 30, wz.y, 0), s2 = W.spawnUnit('us', 'am_rifle', wz.x - 30, wz.y, 0);
    W.boardVehicle(s1, wz); out.wz1 = wz.cargo === s1; out.wz2 = W.canBoard(s2, wz);
    G.units.length = 0; keep.forEach(u => G.units.push(u));
    G.shots.length = 0; shots.forEach(s => G.shots.push(s));
    W.killBuilding(mot); W.killBuilding(bar); W.killBuilding(dep);
    return out;
  });
  ok('Omaha: the Priest and the Wespe fire missions from their motor pools, the Priest rebuilt is the M12, the Marder lays inside its casemate and the Weasel carries a squad',
     sp5.q === 'am_m7,am_weasel,hr_wespe,hr_marder' && sp5.bufs === 'all' &&
     sp5.m7.ok && sp5.m7.n === 8 && sp5.m7.left === 0 && sp5.m7.turn > .5 && sp5.m7.vk === 'am_m7' &&
     sp5.m12.ok && sp5.m12.n === 6 && sp5.m12.left === 0 && sp5.m12.vk === 'am_m12' && sp5.m12.name === 'M12 Gun Motor Carriage' &&
     sp5.m12.reach > sp5.m7.reach && sp5.m12.arc < sp5.m7.arc &&
     sp5.ws.ok && sp5.ws.n === 8 && sp5.ws.left === 0 && sp5.ws.turn > .5 &&
     Math.abs(Math.abs(sp5.mrTur) - sp5.mrArc / 2) < .03 && sp5.wz1 && !sp5.wz2 &&
     sp5.calQ === 'am_t34' && sp5.calBufs && sp5.calOk && sp5.calN === 30 && sp5.calRk === 30 && sp5.calBent === 30 &&
     sp5.calEl > .15 && Math.abs(sp5.calEl - sp5.calWant) < .025 && sp5.calOff < .08 && sp5.calZ0 > 40 &&
     sp5.calRack1 === 30 && sp5.calRack2 === 0 && sp5.calReload > 70 && sp5.calSmoke === 'refused' && sp5.calName === 'M4A1 Calliope' &&
     sp5.nebRk >= 6,
     `queued ${sp5.q}; buffers built: ${sp5.bufs}; the Priest laid ${sp5.m7.ok ? '' : 'NOT '}and fired ${sp5.m7.n - sp5.m7.left} of ` +
     `${sp5.m7.n}, turning ${sp5.m7.turn}; rebuilt it is ${sp5.m12.name} drawn as ${sp5.m12.vk}, reaching ${sp5.m12.reach} against ` +
     `${sp5.m7.reach} on an arc of ${sp5.m12.arc} against ${sp5.m7.arc}, and fired ${sp5.m12.n - sp5.m12.left} of ${sp5.m12.n}; the Wespe ` +
     `fired ${sp5.ws.n - sp5.ws.left} of ${sp5.ws.n}, turning ${sp5.ws.turn}; the Marder asked for 1.2 laid ${sp5.mrTur} on an arc of ` +
     `${sp5.mrArc}; the Weasel ${sp5.wz1 ? 'took' : 'REFUSED'} a squad and ${sp5.wz2 ? 'TOOK' : 'refused'} a second; the tank yard ` +
     `queued ${sp5.calQ}, its buffers ${sp5.calBufs ? 'built' : 'MISSING'}; the ${sp5.calName} laid ${sp5.calOk ? '' : 'NOT '}a mission of ` +
     `${sp5.calN}, the first rocket away at ${sp5.calEl} of elevation against ${sp5.calWant} wanted, ${sp5.calRk} rockets of which ` +
     `${sp5.calBent} bent onto their marks, the worst leaving ${sp5.calOff} off its tube, from ${sp5.calZ0} up; ${sp5.calRack1} left in ` +
     `the rack after one mission and ${sp5.calRack2} after two, reloading for ${sp5.calReload} s, smoke ${sp5.calSmoke}; the ` +
     `Nebelwerfer fired ${sp5.nebRk} rockets as rockets`);

  /* --- The engineers. The Americans' engineer squad: the headquarters makes it and queues
     it, the Allied side opens the battle with one, its three men are the three engineer
     variants and carry the M3, the sleeves are rolled and the hands gloved, the goggles are
     on the helmet, it can peg out a work and go and build it, and a man of it killed goes
     down as an engineer rather than as a rifleman. --- */
  const eng = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.own === 'us' && b.def.hq)[0];
    out.makes = W.makesOf(hq).join(',');
    const made = W.REC.us.made || {};
    out.openAm = made.am_eng || 0;
    G.res.us.mp += 2000;
    const q0 = hq.queue.length;
    out.q = W.queueUnit(hq, 'am_eng') ? hq.queue.slice(-1)[0] : 'refused';
    hq.queue.length = q0;
    const u = W.spawnUnit('us', 'am_eng', hq.x + 120, hq.y - 200, 0);
    out.men = u.models.length; out.builder = !!u.def.builder;
    out.vars = [...new Set(u.models.map((m, i) => W.variantForModel(u, i)))].sort().join(',');
    out.weap = [...new Set(u.models.map((m, i) => W.SOLDIER_VARIANTS[W.variantForModel(u, i)].weapon))].join(',');
    const K = W.KIT.usa, r = W.manFaces('gi_eng', W.FIGPOSE.stand), P = r.parts;
    out.bare = P.limbs[1].filter(f => f.c === K.skin).length;
    out.gloved = P.hands[0].filter(f => f.c === K.glove).length;
    out.skinHand = P.hands[0].filter(f => f.c === K.skin).length;
    out.goggle = P.helmet.filter(f => f.c === K.goggle).length;
    /* on the first ground round the headquarters a wall will go on: the beach in front of it
       is the hedgehog band */
    let wx = hq.x + 60, wy = hq.y - 280;
    for (let r = 160; r < 600 && !W.workRoom(wx, wy, W.WORKS.bags); r += 40)
      for (let a = 0; a < 12; a++) { wx = hq.x + Math.cos(a / 12 * Math.PI * 2) * r; wy = hq.y + Math.sin(a / 12 * Math.PI * 2) * r; if (W.workRoom(wx, wy, W.WORKS.bags)) break; }
    const site = W.placeWork('us', 'bags', wx, wy, 0, [u]);
    out.site = !!site; out.building = u.building === site && u.order === 'work';
    if (site) G.sites.splice(G.sites.indexOf(site), 1);
    W.clearOrder(u);
    const m = u.models.filter(q => q.alive)[0], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.fellNat = rec ? rec.nat : '-';
    out.bodies = !!(W.MODELS.fall.usa_eng && W.MODELS.dead.usa_eng && W.MODELS.fall.usa_eng.length === 3 && W.MODELS.dead.usa_eng.length === 2);
    W.killUnit(u);
    return out;
  });
  ok('Omaha: the Americans\' engineers are their own squad of three, with M3s, sleeves rolled, gloves on, and bodies of their own',
     /am_eng/.test(eng.makes) && eng.openAm >= 1 && eng.q === 'am_eng' &&
     eng.men === 3 && eng.builder && eng.vars === 'gi_eng,gi_eng_b,gi_eng_c' && eng.weap === 'm3' && eng.bare > 0 &&
     eng.gloved > 0 && eng.skinHand === 0 && eng.goggle > 0 && eng.site && eng.building && eng.fellNat === 'usa_eng' &&
     eng.bodies,
     `the headquarters makes ${eng.makes}; the side opened with ${eng.openAm} engineer squads; asked for the squad ` +
     `it queues ${eng.q}; ${eng.men} men of ${eng.vars} carrying ${eng.weap}, ` +
     `${eng.builder ? 'a builder' : 'NOT A BUILDER'}; the forearm has ${eng.bare} bare faces, the hand ${eng.gloved} of glove ` +
     `and ${eng.skinHand} of skin, the helmet ${eng.goggle} of goggle; a sandbag wall ${eng.site ? 'pegged out' : 'REFUSED'} ` +
     `and the squad ${eng.building ? 'sent to build it' : 'NOT SENT'}; a man killed went down as ${eng.fellNat}, engineer ` +
     `bodies ${eng.bodies ? 'baked' : 'MISSING'}`);

  /* --- The pioneers. The 352nd's pioneer team: the headquarters makes it and queues it, the
     German side opens the battle with one, its three men are the three pioneer variants with
     the MP40, goggles on the helmet, the pack on the back and the collar in bottle green, it
     can peg out a work and go and build it, and a man of it killed goes down as a
     pioneer. --- */
  const pio = await page.evaluate(() => {
    const W = window, G = W.G, out = {};
    const hq = G.blds.filter(b => b.side === 'ger' && b.def.hq)[0], sl = hq.own;
    out.makes = W.makesOf(hq).join(',');
    const made = W.REC.ger.made || {};
    out.openHr = made.hr_pio || 0;
    G.res[sl].mp += 2000;
    const q0 = hq.queue.length;
    out.q = W.queueUnit(hq, 'hr_pio') ? hq.queue.slice(-1)[0] : 'refused';
    hq.queue.length = q0;
    const u = W.spawnUnit(sl, 'hr_pio', hq.x - 120, hq.y + 200, 0);
    out.men = u.models.length; out.builder = !!u.def.builder;
    out.vars = [...new Set(u.models.map((m, i) => W.variantForModel(u, i)))].sort().join(',');
    out.weap = [...new Set(u.models.map((m, i) => W.SOLDIER_VARIANTS[W.variantForModel(u, i)].weapon))].join(',');
    const K = W.KIT.heer, r = W.manFaces('gr_pio', W.FIGPOSE.stand), P = r.parts;
    out.goggle = P.helmet.filter(f => f.c === K.goggle).length;
    out.pack = (P.kit || []).filter(f => f.c === K.torn || f.c === W.lit(K.torn, .95) || f.c === W.lit(K.torn, 1.12)).length;
    out.collar = (P.collar || []).filter(f => f.c === W.lit(K.bottle, .95) || f.c === W.lit(K.bottle, .9) || f.c === W.lit(K.bottle, .92)).length;
    /* the German headquarters stands in a walled yard among the hedgerows, so the first
       spot a wall is tried at may be refused for the ground and not for the team */
    let site = null;
    for (const [dx, dy] of [[-60, 280], [60, 280], [0, 200], [160, 160], [-160, 160], [220, 0], [-220, 0], [0, -220], [260, 260], [-260, 260]]) {
      site = W.placeWork(sl, 'bags', hq.x + dx, hq.y + dy, 0, [u]);
      if (site) break;
    }
    out.site = !!site; out.building = u.building === site && u.order === 'work';
    if (site) G.sites.splice(G.sites.indexOf(site), 1);
    W.clearOrder(u);
    const m = u.models.filter(q => q.alive)[0], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.fellNat = rec ? rec.nat : '-';
    out.bodies = !!(W.MODELS.fall.heer_pio && W.MODELS.dead.heer_pio && W.MODELS.fall.heer_pio.length === 3 && W.MODELS.dead.heer_pio.length === 2);
    W.killUnit(u);
    return out;
  });
  ok('Omaha: the 352nd\'s pioneers are their own team of three, with MP40s, goggles, the pioneer pack, and bodies of their own',
     /hr_pio/.test(pio.makes) && pio.openHr >= 1 && pio.q === 'hr_pio' &&
     pio.men === 3 && pio.builder && pio.vars === 'gr_pio,gr_pio_b,gr_pio_c' && pio.weap === 'mp40' && pio.goggle > 0 &&
     pio.pack > 0 && pio.collar > 0 && pio.site && pio.building && pio.fellNat === 'heer_pio' && pio.bodies,
     `the headquarters makes ${pio.makes}; the side opened with ${pio.openHr} pioneer teams; asked for the team it ` +
     `queues ${pio.q}; ${pio.men} men of ${pio.vars} carrying ${pio.weap}, ` +
     `${pio.builder ? 'a builder' : 'NOT A BUILDER'}; the helmet has ${pio.goggle} faces of goggle, the pack ${pio.pack} of ` +
     `its brown and the collar ${pio.collar} of bottle green; a sandbag wall ${pio.site ? 'pegged out' : 'REFUSED'} and the ` +
     `team ${pio.building ? 'sent to build it' : 'NOT SENT'}; a man killed went down as ${pio.fellNat}, pioneer bodies ` +
     `${pio.bodies ? 'baked' : 'MISSING'}`);

  /* --- Destruction. A house knocked flat that still stops a boot and still stops an eye
     is a picture of rubble laid over a building that is, as far as everything else in the
     game is concerned, exactly where it was -- and it is the one fault here a screenshot
     would call a success. So the row asks the SAME CELL the same four questions with the
     house standing and with the house down, puts a section in it first to see it put out,
     and counts the stone: everything the cells threw has to be lying on the ground or in
     the heap at the end, because masonry that vanishes on landing is a collapse nobody can
     stand in. Before any of that one field-gun round goes against the face, because a
     building that comes down on the first hole in it is as wrong as one that never does. --- */
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
      window.__wreckH = p;
      window.__keep = window.G.units.slice();
      window.G.units.length = 0;
      const u = window.spawnUnit(window.G.side, window.G.side === 'us' ? 'am_rifle' : 'hr_gren',
                                 p.x, p.y + p.h / 2 + 40);
      window.enterBuilding(u, p);
      window.rebuildGrid();
      window.G.frStat = { made: 0, bodies: 0, lost: 0 };
      const ci = window.cidx((p.x / window.CELL) | 0, (p.y / window.CELL) | 0);
      return { up: { walk: window.walkable(p.x, p.y) ? 1 : 0, sight: window.sblk[ci] ? 1 : 0,
                     fire: window.fblk[ci] ? 1 : 0, rub: window.rubg[ci] ? 1 : 0,
                     gar: !!u.gar, hurt: !!p.hurt, can: window.frBreakable(p) },
               x: p.x, y: p.y, w: Math.round(p.w), h: Math.round(p.h) };
    });
    if (!put) return null;
    /* a 105's round twelve units off the middle of the face: a hole, and the house still a
       house with the section still in it */
    const hole = await page.evaluate(() => {
      const p = window.__wreckH;
      window.explode(p.x, p.y + p.h / 2 + 12, 40, 150, null, null, 14);
      const R = p.fr;
      return { cut: !!R, cells: R ? R.orig.reduce((n, v) => n + v, 0) : 0,
               gone: R ? R.orig.reduce((n, v, i) => n + (v && !R.alive[i] ? 1 : 0), 0) : 0 };
    });
    await fastForward(page, 3);
    Object.assign(hole, await page.evaluate(() => {
      const p = window.__wreckH, R = p.fr;
      return { left: R ? Math.round(R.mAlive / R.m0 * 1000) / 10 : 100, hold: window.frHoldable(p),
               held: window.G.units.some(u => !u.dead && u.gar === p) };
    }));
    /* then the battery: five salvos of three 240 rounds down through the roof */
    let air = 0;
    for (let s = 0; s < 5; s++) {
      air = Math.max(air, await page.evaluate(s => {
        const p = window.__wreckH, pts = [[-.3, -.25], [.3, .25], [.3, -.25], [-.3, .25], [0, 0]];
        for (let i = 0; i < 3; i++) {
          const q = pts[(s * 3 + i) % pts.length];
          window.explode(p.x + q[0] * p.w, p.y + q[1] * p.h, 150, 380, null, null, 0);
        }
        return window.G.debris.length;
      }, s));
      await fastForward(page, 2.5);
    }
    await fastForward(page, 12);
    /* and one drawn frame, because the house's own buffer is uploaded in the draw: fast
       forward stubs render() out */
    await frames(page, 2);
    const down = await page.evaluate(() => {
      const p = window.__wreckH, R = p.fr;
      const ci = window.cidx((p.x / window.CELL) | 0, (p.y / window.CELL) | 0);
      const u = window.G.units.filter(e => !e.dead)[0];
      let vol = 0;
      for (const r of window.G.rub) vol += r.l * r.w * r.h + (r.e || 0);
      let mound = 0;
      for (let dx = -60; dx <= 60; dx += 14) for (let dy = -40; dy <= 40; dy += 14)
        mound = Math.max(mound, window.moundAt(p.x + dx, p.y + dy));
      const st = { walk: window.walkable(p.x, p.y) ? 1 : 0, sight: window.sblk[ci] ? 1 : 0,
                   fire: window.fblk[ci] ? 1 : 0, rub: window.rubg[ci] ? 1 : 0,
                   gar: !!(u && u.gar), hurt: !!p.hurt, standing: Math.round(window.ruinStanding(p)),
                   left: R ? Math.round(R.mAlive / R.m0 * 100) : 100,
                   canGar: window.canGarrison({ cat: 'inf', def: { speed: 30 }, models: [] }, p),
                   settled: window.G.rub.length, vol: Math.round(vol), made: Math.round(window.G.frStat.made),
                   lost: Math.round(window.G.frStat.lost), bodies: window.G.frStat.bodies,
                   mound: +mound.toFixed(1), stand: +(window.groundZ(p.x, p.y) - window.floorZ(p.x, p.y)).toFixed(1),
                   air: window.G.debris.length, fall: window.G.fall.length, buf: !!(R && R.buf),
                   heap: window.HEAPBUF ? window.HEAPBUF.n : 0 };
      window.G.units.length = 0;
      window.__keep.forEach(e => window.G.units.push(e));
      window.rebuildGrid();
      return st;
    });
    return { ...put, hole, air, down };
  })();
  ok('a field-gun round against a house opens a hole in it and leaves it a house',
     !!wreck && wreck.up.can && wreck.hole.cut && wreck.hole.gone >= 1 && wreck.hole.left > 90 &&
     wreck.hole.hold && wreck.hole.held,
     wreck ? `${wreck.w}x${wreck.h}, cut into ${wreck.hole.cells} cells: one 150-point round took ${wreck.hole.gone} out, ` +
             `${wreck.hole.left}% of it standing three seconds later, ` +
             `${wreck.hole.hold ? 'still holdable' : 'NOT HOLDABLE'} and the section ${wreck.hole.held ? 'still in it' : 'PUT OUT'}`
           : 'no isolated terrace on the map to shell');
  ok('a house shelled flat stops being a house on every grid that reads one',
     !!wreck && wreck.up.walk === 0 && wreck.up.sight === 1 && wreck.up.fire === 1 &&
     wreck.up.rub === 0 && wreck.up.gar === true && wreck.up.hurt === false &&
     wreck.down.walk === 1 && wreck.down.sight === 0 && wreck.down.fire === 0 &&
     wreck.down.rub === 1 && wreck.down.gar === false && wreck.down.canGar === false &&
     wreck.down.standing < 34 && wreck.down.buf === true,
     wreck ? `fifteen heavy rounds: ${wreck.down.left}% of it left; ` +
             `walkable ${wreck.up.walk}->${wreck.down.walk}, stops an eye ${wreck.up.sight}->${wreck.down.sight}, ` +
             `stops a round ${wreck.up.fire}->${wreck.down.fire}, rubble ${wreck.up.rub}->${wreck.down.rub}, ` +
             `garrison ${wreck.up.gar ? 'held' : 'none'}->${wreck.down.gar ? 'held' : 'put out'}, ` +
             `${wreck.down.standing} units left standing, ` +
             `holdable ${wreck.down.canGar ? 'still' : 'no'}, own buffer ${wreck.down.buf ? 'yes' : 'no'}`
           : '');
  ok('the masonry that comes out of it is the masonry that lands, and the heap is ground',
     !!wreck && wreck.air > 40 && wreck.down.air === 0 && wreck.down.fall === 0 && wreck.down.bodies >= 1 &&
     wreck.down.settled > 40 && wreck.down.vol + wreck.down.lost >= wreck.down.made * .97 &&
     wreck.down.mound > 3 && wreck.down.stand > 1 && wreck.down.heap > 0,
     wreck ? `${wreck.air} stones in the air at once and ${wreck.down.bodies} pieces fell whole; ` +
             `${wreck.down.settled} stones settled, ${wreck.down.vol} units of stone lying and ${wreck.down.lost} ` +
             `let go by the ring against ${wreck.down.made} thrown; heap ${wreck.down.mound} deep, ` +
             `a man in the middle of it stands ${wreck.down.stand} over the floor, the heap drawn in ${wreck.down.heap} vertices`
           : '');

  /* --- Fire, crumbling, and what a burst does to the men round it. A house on fire and a
     house standing in the sun are the same picture from above until the roof goes; a wall
     that goes on shedding stone after the barrage has lifted and one that stands as it was
     are the same picture as well; and a burst whose splinters reach out past its blast
     reads like one that stops at it until somebody counts. So the rows count: what caught
     and what burnt through, who was put out of it and whether anybody may go in; what a
     cracked wall sheds with nothing firing at it; whether rubble a burst throws is counted
     twice; and the same burst at the same place against men standing, men lying down and
     men in the lee of a house. Still on Ortona, beside the house the row above shelled
     flat. --- */
  const frag = await page.evaluate(() => {
    const keep = window.G.units.slice();
    /* open ground, a hundred and sixty units of it every way with nothing that stops a round,
       level, and with as little as there is of anything a man lies behind where the men of the
       four sections stand, or the far reading is a reading of the cover */
    let ox = -1, oy = -1, best = 1e9;
    for (let y = 300; y < window.WORLD.h - 300 && best > 0; y += 20) for (let x = 300; x < window.WORLD.w - 300 && best > 0; x += 20) {
      let clear = Math.abs(window.groundZ(x - 150, y) - window.groundZ(x + 150, y)) < 6;
      for (let dy = -160; dy <= 160 && clear; dy += 20) for (let dx = -160; dx <= 160 && clear; dx += 20) {
        const cx = ((x + dx) / window.CELL) | 0, cy = ((y + dy) / window.CELL) | 0;
        if (window.fblk[window.cidx(cx, cy)] || !window.walkable(x + dx, y + dy)) clear = false;
      }
      if (!clear) continue;
      let cov = 0;
      for (const dx of [36, 45, 54, 80, 90, 100, 110, 120, 126, 135, 144, 150, 231, 240, 249])
        for (const dy of [-6, 0, 6]) cov += window.coverAt(x + dx, y + dy);
      if (cov < best) { best = cov; ox = x; oy = y; }
    }
    /* and a house with open ground either side of it, for the lee */
    const h = window.G.props.filter(q => q.kind === 'ruin' && q.style !== 'church' && !q.hurt && q.h > 50 && q.h < 110 &&
      window.walkable(q.x, q.y - q.h / 2 - 16) && window.walkable(q.x, q.y + q.h / 2 + 16))[0];
    /* Every trial is thrown with the same seeded rolls, and the two at one and a half radii
       with twice the bursts. Whether a splinter finds a man is a roll, and at that range a
       burst finds about one man in sixteen standing and one in fifty lying down, so sixty
       bursts are a score of hits against half a dozen: thrown with fresh dice, one phone run
       read 1.1 standing against 0.82 lying down, where the other runs on record read under
       half. The dice do not stay in step between the two (a hit takes a second roll for
       how much), so the seed makes the row the same throw on every run of one file and the
       count is what makes the throw a fair one. */
    function trial(x, y, bx, by, prone, n, r) {
      const rand = Math.random;
      let seed = 4049;
      Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const u = window.spawnUnit(window.G.side, 'am_rifle', x, y);
      let lost = 0;
      for (let i = 0; i < n; i++) {
        u.models.forEach((m, k) => { m.x = x + (k % 3 - 1) * 9; m.y = y + ((k / 3) | 0) * 9 - 4; m.hp = 1e6; m.alive = true;
                                     m.pose = prone ? window.POSE_PRONE : 0; });
        u.dead = false;
        /* twenty, which is under what a wall notices, so the house standing in the way is the
           house that stood there for every burst */
        window.explode(bx, by, r || 90, 20, null, null, 30);
        u.models.forEach(m => { lost += 1e6 - m.hp; });
      }
      Math.random = rand;
      const i2 = window.G.units.indexOf(u); if (i2 >= 0) window.G.units.splice(i2, 1);
      return +(lost / n).toFixed(2);
    }
    if (ox < 0 || !h) return { none: ox < 0 ? 'no open ground' : 'no house with open ground either side of it' };
    const out = { at: ox + ',' + oy, cover: best, house: Math.round(h.x) + ',' + Math.round(h.y) };
    out.near = trial(ox + 45, oy, ox, oy, false, 40);
    out.far = trial(ox + 135, oy, ox, oy, false, 120);
    out.farDown = trial(ox + 135, oy, ox, oy, true, 120);
    out.beyond = trial(ox + 240, oy, ox, oy, false, 40);
    const d = h.h + 30, by = h.y - h.h / 2 - 12;
    out.leeD = d;
    /* a burst big enough that the men across the house are well inside its blast */
    out.leeR = Math.round(d * 1.6);
    out.lee = trial(h.x, h.y + h.h / 2 + 18, h.x, by, false, 40, out.leeR);
    out.open = trial(ox + d, oy, ox, oy, false, 40, out.leeR);
    window.G.units.length = 0; keep.forEach(e => window.G.units.push(e));
    return out;
  });
  ok('a burst kills by blast close and by splinters past it, less for men lying down and little for men in the lee of a house',
     !!frag && !frag.none && frag.near > frag.far && frag.far > 0 && frag.farDown < frag.far * .7 && frag.beyond === 0 &&
     frag.lee < frag.open * .6,
     frag && !frag.none ? `a 90-unit burst on open ground at ${frag.at} (cover ${frag.cover} summed where the men stand): a section at half the radius takes ${frag.near} a burst, at one and a ` +
            `half ${frag.far} standing and ${frag.farDown} lying down, at ${240} ${frag.beyond}; across the house at ${frag.house} ` +
            `${frag.lee} against ${frag.open} at the same ${frag.leeD} in the open, under a ${frag.leeR}-unit burst`
          : frag ? frag.none : 'no answer');

  /* a burst in what the first row shelled flat throws the heap's blocks out again, and the
     heap is not built up twice by them */
  /* the heap is read over the ground round the burst only, and the battle is taken off the
     map for the ten seconds, so nothing else lands in it. It goes before the fire: a phone
     keeps 900 blocks lying, and a burning house that comes down pushes the first house's
     heap off the list */
  const kick = await page.evaluate(async () => {
    const p = window.__wreckH, near = window.G.rub.filter(r => Math.hypot(r.x - p.x, r.y - p.y) < 36).length;
    window.__kickHeap = () => {
      let m = 0;
      for (let j = 0; j < window.MNDH; j++) for (let i = 0; i < window.MNDW; i++)
        if (Math.hypot((i + .5) * 14 - p.x, (j + .5) * 14 - p.y) < 160) m += window.MND[j * window.MNDW + i];
      return m;
    };
    window.__kickM = window.__kickHeap();
    window.__keepK = window.G.units.slice(); window.G.units.length = 0;
    window.explode(p.x, p.y, 70, 20, null, null, 0);
    return { near, thrown: window.G.debris.filter(d => d.kick).length };
  });
  await fastForward(page, 10);
  const kicked = await page.evaluate(() => {
    const p = window.__wreckH;
    const out = { heap: +(window.__kickHeap() / window.__kickM).toFixed(4),
                  air: window.G.debris.filter(d => Math.hypot(d.x - p.x, d.y - p.y) < 300).length };
    window.G.units.length = 0; window.__keepK.forEach(e => window.G.units.push(e));
    return out;
  });
  ok('a burst throws the rubble lying round it out again without building the heap twice',
     kick.thrown > 0 && kicked.air === 0 && Math.abs(kicked.heap - 1) < .01,
     `${kick.near} blocks lying within 36 of the burst, ${kick.thrown} thrown out again; ten seconds on ` +
     `${kicked.air} still in the air and the heap ${kicked.heap} of what it was`);

  const burn = await (async () => {
    const put = await page.evaluate(() => {
      const p = window.G.props.filter(q => q.kind === 'ruin' && q.style !== 'church' && q.w > 70 && q !== window.__wreckH &&
        !q.hurt && !window.G.blds.some(b => Math.hypot(b.x - q.x, b.y - q.y) < 300) &&
        Math.hypot(q.x - window.__wreckH.x, q.y - window.__wreckH.y) > 260)
        .sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (!p) return null;
      window.__fireH = p;
      /* five minutes of fire and crumbling with the battle taken off the map: the points are
         topped up so the clock cannot end the game under the rows below */
      window.vpSet('us', 9000); window.vpSet('ger', 9000);
      window.__keep = window.G.units.slice();
      window.G.units.length = 0;
      const u = window.spawnUnit(window.G.side, window.G.side === 'us' ? 'am_rifle' : 'hr_gren', p.x, p.y + p.h / 2 + 40);
      window.enterBuilding(u, p);
      window.frMake(p);
      const R = p.fr, NC = R.nx * R.ny;
      let fuel = 0, lit = 0;
      for (let c = 0; c < R.alive.length; c++) if (R.alive[c] && R.fuel[c] >= .15) fuel++;
      /* a shell through an upper window: four cells of the first floor up nearest the middle
         of the house with something in them to burn, alight, which is what `frHit` does to a
         room it bursts in. Lit at the corner of the roof instead, the fire on Ortona's
         biggest house took most of a minute to find its feet, which is a fire on a roof edge
         and not the one the row is about. */
      const room = [];
      for (let k = 1; k < R.nz && !room.length; k++)
        for (let c = k * NC; c < (k + 1) * NC; c++) if (R.alive[c] && R.fuel[c] >= .3) room.push(c);
      /* and the room is the one with something round it to burn, the middle of the house only
         breaking a tie: the four cells nearest the middle of Ortona's biggest house sit among
         empty cells and stone, and from them the fire took or died out about as often as a
         coin comes down heads, on the commit before as on this one. A fire that dies in the
         first room says nothing about how a fire behaves in a house. */
      const mid = c => { const q = window.frCellC(R, c); return Math.hypot(q[0] - p.x, q[1] - p.y); };
      const round = c => { let f = 0; [NC, -NC, 1, -1, R.nx, -R.nx].forEach(d => { const n = c + d; if (n >= 0 && n < R.alive.length && R.alive[n]) f += R.fuel[n]; }); return f; };
      room.sort((a, b) => round(b) - round(a) || mid(a) - mid(b));
      for (let i = 0; i < room.length && lit < 4; i++) if (window.frIgnite(p, room[i], .6)) lit++;
      return { lit, fuel, cells: R.orig.reduce((a, v) => a + v, 0), gar: !!u.gar };
    });
    if (!put) return null;
    await fastForward(page, 60);
    const mid = await page.evaluate(() => {
      const p = window.__fireH, R = p.fr;
      let ch = 0;
      for (let c = 0; c < R.char.length; c++) if (R.alive[c] && R.char[c] > .4) ch++;
      window.smokeColumns();
      return { burning: R.fire.length, sumH: +R.sumH.toFixed(1), ch,
               gar: window.G.units.some(u => !u.dead && u.gar === p),
               canGar: window.canGarrison({ cat: 'inf', def: { speed: 30 }, models: [] }, p),
               smoke: window._smoke.some(m => Math.hypot(m.x - p.x, m.y - p.y) < Math.max(p.w, p.h)) };
    });
    await fastForward(page, 120);
    const end = await page.evaluate(() => {
      const p = window.__fireH, R = p.fr;
      let burnt = 0, alive = 0;
      for (let c = 0; c < R.alive.length; c++) { if (R.burn[c] >= 1) burnt++; if (R.alive[c]) alive++; }
      return { burning: R.fire.length, burnt, alive, left: Math.round(R.mAlive / R.m0 * 100) };
    });
    return { put, mid, end };
  })();
  ok('a house catches from a shell, burns, chars, smokes, puts out its garrison and lets its roof down',
     !!burn && burn.put.lit >= 1 && burn.put.gar && burn.mid.burning >= 4 && burn.mid.ch >= 4 &&
     !burn.mid.gar && !burn.mid.canGar && burn.mid.smoke && burn.end.burnt >= 4 && burn.end.alive < burn.put.cells,
     burn ? `${burn.put.cells} cells, ${burn.put.fuel} with something in them to burn; ${burn.put.lit} lit in a room upstairs; ` +
            `a minute on ${burn.mid.burning} burning at a heat of ${burn.mid.sumH}, ${burn.mid.ch} charred, the section ` +
            `${burn.mid.gar ? 'STILL IN IT' : 'put out'}, ${burn.mid.canGar ? 'STILL ENTERABLE' : 'nobody may go in'}, ` +
            `smoke ${burn.mid.smoke ? 'on the sight line' : 'NOT ON THE SIGHT LINE'}; three minutes on ${burn.end.burning} ` +
            `still burning, ${burn.end.burnt} burnt through and ${burn.put.cells - burn.end.alive} cells come down, ` +
            `${burn.end.left}% of it standing`
          : 'no isolated house on the map to set alight');

  const crumble = await page.evaluate(async () => {
    const p = window.G.props.filter(q => q.kind === 'ruin' && q.style !== 'church' && q.w > 70 && !q.hurt &&
      q !== window.__fireH && q !== window.__wreckH && Math.hypot(q.x - window.__fireH.x, q.y - window.__fireH.y) > 300 &&
      Math.hypot(q.x - window.__wreckH.x, q.y - window.__wreckH.y) > 300)
      .sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!p) return null;
    window.__crumH = p;
    window.frMake(p);
    const R = p.fr, cells = [];
    /* ten cells of wall cracked through half and more, as a breach leaves the stone round it */
    for (let c = 0; c < R.alive.length && cells.length < 10; c++)
      if (R.alive[c] && R.fuel[c] < .15 && R.flat[c] < .3 && R.mass[c] > 20) { R.dmg[c] = .7; cells.push(c); }
    const m0 = cells.reduce((a, c) => a + R.mass[c], 0);
    window.__crumC = cells; window.__crumM = m0; window.__crumMade = window.G.frStat.made;
    return { n: cells.length };
  });
  await fastForward(page, 90);
  const crum = crumble && await page.evaluate(() => {
    const R = window.__crumH.fr, cells = window.__crumC;
    const m1 = cells.reduce((a, c) => a + (R.alive[c] ? R.mass[c] : 0), 0);
    const out = { n: cells.length, gone: cells.filter(c => !R.alive[c]).length, shed: +(1 - m1 / window.__crumM).toFixed(2),
                  made: Math.round(window.G.frStat.made - window.__crumMade) };
    /* and the town put back for the rows below: the army back on the map, every fire out and
       the cracked wall at rest, because a house left burning goes on spreading down the
       street through every row after this one */
    window.G.units.length = 0; window.__keep.forEach(e => window.G.units.push(e));
    for (const q of window.G.props) {
      const Q = q.fr;
      if (!Q) continue;
      for (const c of Q.fire) Q.heat[c] = 0;
      Q.fire.length = 0; Q.sumH = 0;
    }
    for (const c of cells) R.dmg[c] = 0;
    return out;
  });
  ok('a cracked wall goes on shedding its stone with nothing firing at it',
     !!crum && crum.n >= 6 && crum.shed > .05 && crum.made > 0,
     crum ? `${crum.n} cells of wall cracked to seven tenths: in a minute and a half they shed ${Math.round(crum.shed * 100)}% ` +
            `of their stone as ${crum.made} units of rubble, ${crum.gone} of them gone altogether`
          : 'no third house to crack');



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
      /* the body's two ends against the hull's, because the box stands on the hull's own
         middle and not on the unit's origin */
      worstL = Math.max(worstL, Math.abs((u.bodyX || 0) + u.bodyL - b.x1),
                        Math.abs((u.bodyX || 0) - u.bodyL - b.x0));
      worstW = Math.max(worstW, u.bodyW / Math.max(b.y1, -b.y0));
      n++; drop(u);
    }
    /* and the gap at contact, over eight bearings */
    const rows = [];
    /* on the M4A1, whose hull stands furthest off its own origin (-37.2 to 32.8): while the
       body was a box about the origin it stood 4.4 units proud of the nose and a pair of them
       met with 4.4 to 8.7 units between the models. And on the Panzer IV, which is off it the
       other way by less (-36.2 to 33.6). */
    for (const [ak, as, bk, bs] of [['am_sher', 'us', 'am_rifle', 'us'],
                                    ['am_sher', 'us', 'am_sher', 'us'],
                                    ['hr_p4', 'ger', 'hr_p4', 'ger']]) {
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
    /* tracks against wheels, the same 180 asked of both: the M4A1 on its tracks and the
       234 on its eight wheels */
    const turns = [];
    for (const k of ['am_sher', 'hr_234']) {
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
     bodies.n >= 10 && bodies.worstL < .5 && bodies.worstW < 1.02 &&
     bodies.rows.every(r => r.lo > -3 && r.hi < 6),
     `${bodies.n} vehicles, the collision body's ends within ${bodies.worstL} units of the hull's and ` +
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

  /* --- And two sections walking past each other, which is the half of the same fault a
     vehicle row cannot reach. A section's contact body is the bounding box of its whole
     formation -- 106 by 66 for five riflemen, nearly three times the plan area of a
     Sherman -- laid over three files of 11-unit discs with air between them and nobody at
     all at the four corners. So two sections crossing at an offset where the BOXES touch
     and no two MEN come near each other were shoved apart for the length of the crossing,
     which is the player's complaint word for word: stuck moving past one another with
     daylight between every model.
       Both halves are measured, because either one alone is satisfied by a fix that
     breaks the other. A section has to thread the gap (the crossing costs about what
     walking alone costs, and no frame may go backwards), and two sections standing inside
     one another still have to come apart (men against men can never do that: a formation
     is a regular lattice, so for any man-to-man reach there is an offset that slots one
     section's men into the other's gaps, and raising the reach moves the hole rather than
     closing it -- 22 gives 22.0, 30 gives 30.0, 42 gives 42.0). The passing question is
     the men and the resting question is the box. --- */
  const thread = await page.evaluate(() => {
    const keep = window.G.units.slice();
    window.G.units.length = 0;
    const drop = u => { const i = window.G.units.indexOf(u); if (i >= 0) window.G.units.splice(i, 1); };
    /* a corridor, and whether one was found is reported rather than assumed */
    let sx = 0, sy = 0, found = false;
    for (let ty = 400; ty < window.WORLD.h - 400 && !found; ty += 40)
      for (let tx = 400; tx < window.WORLD.w - 400 && !found; tx += 40) {
        let good = true;
        for (let a = -260; a <= 260 && good; a += 20)
          for (let b = -100; b <= 100 && good; b += 20)
            if (!window.walkable(tx + a, ty + b)) good = false;
        if (good) { sx = tx; sy = ty; found = true; }
      }
    if (!found) { sx = window.WORLD.w / 2; sy = window.WORLD.h / 2; }
    const put = (side, key, x, y, f) => {
      const u = window.spawnUnit(side, key, x, y, f);
      const c = Math.cos(f), s2 = Math.sin(f);
      if (u.models) for (const m of u.models) { m.x = u.x + m.ox * c - m.oy * s2; m.y = u.y + m.ox * s2 + m.oy * c; }
      return u;
    };
    /* the crossing, and the same walk with nobody in the way as the control */
    const walk = (lat) => {
      window.G.units.length = 0;
      const A = put('us', 'am_rifle', sx - 200, sy, 0);
      const B = lat === null ? null : put('us', 'am_rifle', sx + 200, sy + lat, Math.PI);
      const goA = { x: sx + 200, y: sy }, goB = { x: sx - 200, y: sy + lat };
      A.order = 'move'; A.path = [goA]; A.pi = 0; A.pathStamp = window.gridStamp;
      if (B) { B.order = 'move'; B.path = [goB]; B.pi = 0; B.pathStamp = window.gridStamp; }
      let t = 0, back = 0, frames = 0, minMan = 1e9, px = A.x, py = A.y;
      for (let i = 0; i < 1800; i++) {
        window.G.t += 1 / 60;
        window.updateUnit(A, 1 / 60);
        if (B) window.updateUnit(B, 1 / 60);
        t += 1 / 60;
        /* ground made good toward the goal, which is what a shove that out-runs the walk
           drives negative; displacement alone reads a unit sliding down a wall as
           excellent progress */
        const was = Math.hypot(px - goA.x, py - goA.y), now = Math.hypot(A.x - goA.x, A.y - goA.y);
        if (Math.hypot(A.x - px, A.y - py) > 1e-6) { frames++; if (now > was + 1e-6) back++; }
        px = A.x; py = A.y;
        if (B) for (const m of A.models) { if (!m.alive) continue;
          for (const o of B.models) if (o.alive) minMan = Math.min(minMan, Math.hypot(m.x - o.x, m.y - o.y)); }
        if (now < 30) break;
      }
      const r = { lat, secs: +t.toFixed(2), arrived: Math.hypot(A.x - goA.x, A.y - goA.y) < 30,
                  backPct: frames ? +(back / frames * 100).toFixed(1) : 0,
                  minMan: B ? +minMan.toFixed(1) : null };
      window.G.units.length = 0;
      return r;
    };
    const solo = walk(null);
    const cross = [30, 40, 50].map(walk);
    /* and the resting case: two sections spawned at the four offsets a pure man-to-man
       reach would weld, settled, and asked whether any man of one is standing inside the
       other's own footprint. Measured geometrically rather than by asking `sepDepth`,
       because the thing under test is what `sepDepth` returns. */
    const rest = [];
    for (const [key, ox, oy] of [['am_mg', 0, -22], ['hr_gren', -7, -21], ['am_rifle', 0, 0], ['am_ranger', -4, 49]]) {
      window.G.units.length = 0;
      const A = put('us', 'am_rifle', sx, sy, 0);
      const B = put(window.UNITS[key].side, key, sx + ox, sy + oy, 0);
      for (let i = 0; i < 480; i++) { window.G.t += 1 / 60; window.updateUnit(A, 1 / 60); window.updateUnit(B, 1 / 60); }
      window.unitBody(A);
      const c = Math.cos(A.facing), s2 = Math.sin(A.facing);
      let inside = 0, live = 0;
      for (const m of B.models) {
        if (!m.alive) continue;
        live++;
        const dx = m.x - A.x, dy = m.y - A.y;
        const lx = dx * c + dy * s2, ly = dy * c - dx * s2;
        if (Math.abs(lx) < A.bodyL && Math.abs(ly) < A.bodyW) inside++;
      }
      rest.push({ key, inside, live, markers: +Math.hypot(A.x - B.x, A.y - B.y).toFixed(1) });
      window.G.units.length = 0;
    }
    keep.forEach(e => window.G.units.push(e));
    window.rebuildGrid();
    return { found, solo, cross, rest };
  });
  ok('two sections thread past each other, and two standing in each other come apart',
     thread.found && thread.solo.arrived && thread.cross.every(r => r.arrived) &&
     thread.cross.every(r => r.secs < thread.solo.secs * 1.35) &&
     thread.cross.every(r => r.backPct < 1) &&
     thread.rest.every(r => r.inside === 0),
     (thread.found ? '' : 'NO CLEAR CORRIDOR FOUND; ') +
     `walking alone takes ${thread.solo.secs}s; past another section at ` +
     thread.cross.map(r => `${r.lat} it takes ${r.secs}s with ${r.minMan} units between the nearest men`).join(', ') +
     `, and no frame of any of them goes backwards (${thread.cross.map(r => r.backPct).join('/')}%); ` +
     `settled inside each other, ` +
     thread.rest.map(r => `${r.key} ends ${r.markers} off with ${r.inside} of ${r.live} men inside the other`).join(', '));

  /* --- And a gun in action is not shouldered aside. It moves when its crew have packed
     it and not before, and a push is a move: weighed like any three men, a set-up MG42 in
     a Tobruk at the Vierville exit was carried 232 units down the draw and onto the sand
     by a section of its own side walking through it, on one battle in six, and the manned
     wall row failed on it. Staged here, because a battle only finds it when a route
     happens to run through a gun: a section walked straight through a set-up MG 34 at
     three offsets and through a Pak 38, then both again down a lane, with the same walks
     and no gun as the controls, and a section spawned standing on the gun, which still has
     to come off it. Before the fix the gun was shoved 81, 111 and 275 units and the Pak
     111 in the open, and 271 and 282 down the lane, still in action. The lane is also
     where the first fix failed the other way: a gun that pushed back at full strength
     held a section up behind it for good. --- */
  const plant = await page.evaluate(() => {
    const W = window, G = W.G, keep = G.units.slice();
    G.units.length = 0;
    let sx = 0, sy = 0, found = false;
    for (let ty = 400; ty < W.WORLD.h - 400 && !found; ty += 40)
      for (let tx = 400; tx < W.WORLD.w - 400 && !found; tx += 40) {
        let good = true;
        for (let a = -260; a <= 260 && good; a += 20)
          for (let b = -100; b <= 100 && good; b += 20)
            if (!W.walkable(tx + a, ty + b)) good = false;
        if (good) { sx = tx; sy = ty; found = true; }
      }
    if (!found) { sx = W.WORLD.w / 2; sy = W.WORLD.h / 2; }
    const put = (side, key, x, y, f) => {
      const u = W.spawnUnit(side, key, x, y, f);
      const c = Math.cos(f), s2 = Math.sin(f);
      if (u.models) for (const m of u.models) { m.x = u.x + m.ox * c - m.oy * s2; m.y = u.y + m.ox * s2 + m.oy * c; }
      return u;
    };
    const gunUp = g => { g.setup = 0; g.pack = 0; g.packed = false; };
    /* the open ground, and a lane: sixty units of it between two solid blocks, which is
       where the push used to win -- a section braked by its own steering to a third of
       its pace behind a gun that would not give way stood there for good */
    const run = (gunKey, lat, lane) => {
      G.units.length = 0;
      let ly = sy + lat, wy = sy;
      if (lane) { W.blockRect(sx, sy - 60.5, 500, 79, 0); W.blockRect(sx, sy + 80, 500, 80, 0); W.buildRoom(); ly = wy = sy + 10; }
      const g = gunKey ? put('ger', gunKey, sx, ly, Math.PI / 2) : null;
      if (g) gunUp(g);
      const A = put('ger', 'hr_gren', sx - 220, wy, 0), go = { x: sx + 220, y: wy };
      A.order = 'move'; A.path = [go]; A.pi = 0; A.pathStamp = W.gridStamp;
      let t = 0, far = 0;
      for (let i = 0; i < 1800; i++) {
        G.t += 1 / 60; t += 1 / 60;
        W.updateUnit(A, 1 / 60);
        if (g) { W.updateUnit(g, 1 / 60); far = Math.max(far, Math.hypot(g.x - sx, g.y - ly)); }
        if (Math.hypot(A.x - go.x, A.y - go.y) < 30) break;
      }
      const r = { gun: gunKey, lat, lane: !!lane, secs: +t.toFixed(2), arrived: Math.hypot(A.x - go.x, A.y - go.y) < 30,
                  shoved: +far.toFixed(1), set: g ? !g.packed && !(g.setup > 0) && !(g.pack > 0) : true,
                  room: lane ? Math.round(W.roomAt(sx, ly) * 2) : null };
      G.units.length = 0;
      if (lane) W.rebuildGrid();
      return r;
    };
    const solo = run(null, 0), laneSolo = run(null, 0, true);
    const through = [0, 20, 40].map(l => run('hr_mg', l)).concat([run('hr_pak', 0)]);
    const lanes = [run('hr_mg', 0, true), run('hr_pak', 0, true)];
    G.units.length = 0;
    const g2 = put('ger', 'hr_mg', sx, sy, 0); gunUp(g2);
    const B = put('ger', 'hr_gren', sx + 6, sy + 4, 0);
    for (let i = 0; i < 480; i++) { G.t += 1 / 60; W.updateUnit(B, 1 / 60); W.updateUnit(g2, 1 / 60); }
    const rest = { depth: +W.sepDepth(B, g2).toFixed(1), moved: +Math.hypot(g2.x - sx, g2.y - sy).toFixed(1),
                   apart: +Math.hypot(B.x - g2.x, B.y - g2.y).toFixed(1) };
    G.units.length = 0;
    keep.forEach(e => G.units.push(e));
    W.rebuildGrid();
    return { found, solo, laneSolo, through, lanes, rest };
  });
  const gunName = r => `${r.gun === 'hr_pak' ? 'Pak 38' : 'MG 34'}`;
  ok('a gun in action is not shoved off its ground by men walking through it',
     plant.found && plant.solo.arrived && plant.laneSolo.arrived &&
     plant.through.every(r => r.arrived && r.shoved < 1 && r.set && r.secs < plant.solo.secs * 2) &&
     plant.lanes.every(r => r.arrived && r.shoved < 1 && r.set && r.secs < plant.laneSolo.secs * 2) &&
     plant.rest.depth === 0 && plant.rest.moved < 1,
     (plant.found ? '' : 'NO CLEAR CORRIDOR FOUND; ') +
     `a section walks 440 units in ${plant.solo.secs}s alone; past a set-up ` +
     plant.through.map(r => `${gunName(r)} at ${r.lat} it takes ${r.secs}s and the gun is ` +
       `shoved ${r.shoved} units${r.set ? '' : ' and OUT OF ACTION'}`).join(', ') +
     `; down a lane ${plant.lanes[0].room} wide it takes ${plant.laneSolo.secs}s alone and ` +
     plant.lanes.map(r => `${r.secs}s through a ${gunName(r)}, shoved ${r.shoved}${r.set ? '' : ' and OUT OF ACTION'}`).join(' and ') +
     `; a section spawned standing on the gun ends ${plant.rest.apart} off it, overlapping by ${plant.rest.depth}, ` +
     `with the gun moved ${plant.rest.moved}`);

  /* --- And a weapon pit is a HOLE. This is the shape of fault a photograph is worst at:
     a horseshoe of bags on flat grass and a horseshoe of bags round a pit are the same
     picture from above, so the bags drew, the cover indexed, the crew stood in it, and
     the one thing a pit IS was missing on all thirty-three the two maps ship.
     `WORKS.pit.dig` had exactly one reader, `finishWork`, and a map pit never goes
     through it. So the ground is read rather than looked at, and against a CONTROL: the
     same profile taken 200 units off each pit, where there is no pit, which is the
     natural roll of the country and has to stay flat whatever the carve does. Plus the
     refusal that matters, which is that a hole a crew cannot stand in is worse than no
     hole at all. --- */
  const pit = await page.evaluate(() => {
    const pits = (window.G.mapData.entities || []).filter(e => e.t === 'emplace');
    const relief = (x, y, r) => {
      let datum = 0;
      for (let a = 0; a < 6.28; a += Math.PI / 2) datum += window.groundZ(x + Math.cos(a) * 120, y + Math.sin(a) * 120);
      datum /= 4;
      let rim = 0, n = 0;
      for (let a = 0; a < 6.28; a += Math.PI / 6) { rim += window.groundZ(x + Math.cos(a) * (r + 8), y + Math.sin(a) * (r + 8)); n++; }
      return (rim / n - datum) - (window.groundZ(x, y) - datum);
    };
    let dug = 0, ctrl = 0, nc = 0, walk = 0, cov = 0, shot = 0;
    for (const e of pits) {
      const r = e.r || 22;
      dug += relief(e.x, e.y, r);
      /* The control point has to be ground with nothing dug in it. By the time this row
         runs three battles have been fought on this map, so a fixed offset lands in a
         shell hole often enough to matter -- and a shell hole read as the control says
         the country is as broken as the pit and fails a row that is working. Four
         offsets are tried and only the clear ones counted. */
      for (const [ox, oy] of [[200, 200], [-200, 200], [200, -200], [-200, -200]]) {
        const cx = e.x + ox, cy = e.y + oy;
        if (cx < 140 || cy < 140 || cx > window.WORLD.w - 140 || cy > window.WORLD.h - 140) continue;
        if (window.coverAt(cx, cy) > 0 || !window.walkable(cx, cy)) continue;
        /* the MAGNITUDE, because a mean of signed reliefs cancels: measured over sixteen
           control spans on a battled map it summed to exactly nought, which reads as a
           control proving the ground is flat and is really two hollows and two rises
           agreeing to disagree. The claim is that the country beside a pit does not have
           a pit's relief in it, whichever way up. */
        ctrl += Math.abs(relief(cx, cy, r)); nc++;
      }
      if (window.walkable(e.x, e.y)) walk++;
      if (window.coverAt(e.x, e.y) >= 3) cov++;
      /* a pit whose bags the battles have shelled down is a work that came apart, which is
         what works do, and not a pit the carve took the cover out of */
      else if (window.G.covers.some(c => c.maxhp && c.hp < c.maxhp && Math.hypot(c.x - e.x, c.y - e.y) < (e.r || 22) + 12)) shot++;
    }
    const out = { n: pits.length, dug: +(dug / Math.max(1, pits.length)).toFixed(2),
                  ctrl: +(ctrl / Math.max(1, nc)).toFixed(2), nc, walk, cov, shot };
    /* and the engineer's own pit, whose model has to settle onto the ground it dug. The
       array the GAME hands the card is captured rather than re-derived: a probe that
       builds the model again after the dig reads correctly whichever order the game does
       it in, and the order is the whole fault. */
    const keep = window.G.units.slice();
    let spot = null;
    for (let t = 0; t < 6000 && !spot; t++) {
      const x = 300 + (t * 137) % (window.WORLD.w - 600), y = 300 + (t * 211) % (window.WORLD.h - 600);
      if (!window.walkable(x, y) || window.coverAt(x, y) > 0) continue;
      let good = true;
      for (let a = 0; a < 6.28 && good; a += Math.PI / 4) if (!window.walkable(x + Math.cos(a) * 70, y + Math.sin(a) * 70)) good = false;
      if (good) spot = { x, y };
    }
    out.spot = !!spot;
    if (spot) {
      /* the till, because a refusal for forty-five marks is not the rule under test */
      window.G.res.us.mp = Math.max(window.G.res.us.mp, 4000);
      window.G.res.us.fu = Math.max(window.G.res.us.fu, 4000);
      const z0 = window.groundZ(spot.x, spot.y), packed = [];
      const real = window.facesToBuffer;
      window.facesToBuffer = function (f) { packed.push(window.facesToArray(f)); return real(f); };
      const site = window.placeWork('us', 'pit', spot.x, spot.y, 0, []);
      if (site) { site.prog = 1; window.finishWork(site); window.G.sites.length = 0; }
      window.facesToBuffer = real;
      out.built = { packs: packed.length, dug: +(window.groundZ(spot.x, spot.y) - z0).toFixed(2) };
      const arr = packed[packed.length - 1];
      if (arr) {
        const gaps = [];
        for (let i = 0; i < arr.length; i += 12) {
          const d = Math.hypot(arr[i] - spot.x, arr[i + 1] - spot.y);
          if (d < 20 || d > 34) continue;                 /* the bag ring alone */
          gaps.push(arr[i + 2] - window.groundZ(arr[i], arr[i + 1]));
        }
        gaps.sort((a, c) => a - c);
        out.built.med = +gaps[(gaps.length / 2) | 0].toFixed(2);
        out.built.hi = +gaps[gaps.length - 1].toFixed(2);
      }
    }
    window.G.units.length = 0;
    keep.forEach(e => window.G.units.push(e));
    return out;
  });
  /* The one pit of tolerance on `walk` and `cov` is for BATTLE DAMAGE and not for a map
     fault. It used to be the fault: Ortona shipped a pit at (1480, 620) standing inside
     the ruin at (1560, 610), whose centre has been unwalkable for as long as it has
     existed, so the row had no headroom at all and a regression that took one more pit
     would have been the first thing it had to catch. That pit has been moved clear and
     the row reads 11 of 11 (8 since the base areas took three of Ortona's pits out). What
     the tolerance covers now is that three battles are fought on this map before this row
     runs, and a shell hole dug on a pit's own centre can make it steep on its own. A pit
     whose bags were shelled down in those battles is counted apart, because a work coming
     apart under fire is what a work does. On one phone run two of the eight read under heavy
     cover after the battles, which is one more than the tolerance; the run after read all
     eight, so it was not caught which of the two causes it was.
       A pit is dug about nine units deep with the spoil thrown up round it, so the crest
     stands a good way over the floor. The bar is six, well clear of the 1.2 the natural
     roll of this country gives over the same span, which the control measures rather than
     assumes. The built pit's bag ring runs six courses at 1.4 apart, so a median vertex
     of a stack sitting ON the ground is about the middle of it; packed before the dig the
     median stood at most of a stack height clear. */
  ok('a weapon pit is a hole in the ground, and its bags sit on the parapet',
     pit.n > 0 && pit.nc > 0 && pit.dug > 6 && Math.abs(pit.ctrl) < 3 && pit.dug > Math.abs(pit.ctrl) * 3 &&
     pit.walk >= pit.n - 1 && pit.cov + pit.shot >= pit.n - 1 &&
     pit.spot && pit.built && pit.built.packs >= 2 && pit.built.dug < -4 && pit.built.med < 5,
     `${pit.n} pits on this map stand ${pit.dug} units from floor to crest against a mean ` +
     `magnitude of ${pit.ctrl} ` +
     `over ${pit.nc} spans of open ground beside them, with ${pit.walk} of ${pit.n} still walkable ` +
     `and ${pit.cov} of ${pit.n} still heavy cover (${pit.shot} more shelled down in the battles); an engineer's pit digs ` +
     `${pit.built ? pit.built.dug : '-'} and packs its model ${pit.built ? pit.built.packs : '-'} times, ` +
     `leaving its bag ring at a median ${pit.built ? pit.built.med : '-'} over the ground ` +
     `(top ${pit.built ? pit.built.hi : '-'}) on a stack 8.4 tall`);

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
    const u = window.spawnUnit('us', 'am_sher', sx, sy, .7);
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

  /* --- And a live one rolling. Every wheel and every link of track on the roster was part of
     the hull and stood still whatever the tank did, which at play distance is a tank sliding
     over the ground on a picture of its tracks. So the row asks first that every vehicle's
     wheels came out of the hull into the running gear and its belt has a period, counted per
     model against what its drawing shows; then the roll: a Sherman driven straight runs both
     tracks the distance it drove, and turned on the spot runs them opposite ways; and then the
     picture, the same Sherman with its tracks half a link on against two frames of it standing. --- */
  const rolling = await page.evaluate(({ sx, sy }) => {
    const Wn = window, keep = Wn.G.units.slice(), gl = Wn.gl;
    const W = () => gl.drawingBufferWidth, H = () => gl.drawingBufferHeight;
    function grab() {
      const px = new Uint8Array(W() * H() * 4);
      Wn.render(); Wn.render(); Wn.render();
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
    /* the wheels each model turns, both sides together: road wheels, return rollers, the
       sprocket and the idler, and on a wheeled car its wheels and no spare */
    const want = { am_sher: 22, am_t34: 22, am_e8: 26, am_m26: 26, am_m18: 22, am_m7: 22, am_m12: 22, hr_wespe: 20, hr_marder: 16,
                   am_weasel: 26, am_stuart: 18, ger_kt: 22, ger_maus: 28, ger_tig: 20, ger_stug: 22, am_jeep: 4,
                   am_m3: 16, am_m16: 16, am_m8: 6, hr_ks750: 3, hr_251: 18, hr_p4: 28, hr_234: 8, hr_panther: 20, hr_wirb: 28,
                   sv_t20: 16, sv_ba64: 4, sv_su76: 22, sv_zsu37: 22 };
    const bad = [];
    let belts = 0;
    Object.keys(want).forEach(k => {
      const B = Wn.MODELS.veh[k];
      if (!B || (B.rgW || 0) !== want[k] || !B.rgA || B.rgA.n !== B.rg.n) bad.push(k + ' ' + (B ? B.rgW : '-'));
      if (B && B.rgL > 0) belts++;
    });
    Wn.G.units.length = 0; Wn.G.wrecks.length = 0; Wn.G.fx.length = 0; Wn.G.shots.length = 0;
    Wn.shake.t = 0; Wn.shake.mag = 0;
    /* straight: driven on its own order, with the frame stepped and nothing drawn */
    const u = Wn.spawnUnit('us', 'am_sher', sx, sy, 0);
    u.facing = 0;
    const x0 = u.x, y0 = u.y;
    Wn.orderMove(u, sx + 260, sy, false);
    const rr = Wn.render, ra = Wn.requestAnimationFrame;
    Wn.render = function () {}; Wn.requestAnimationFrame = function () { return 0; };
    let t = performance.now(); Wn.last = t;
    for (let i = 0; i < 150; i++) { t += 20; Wn.frame(t); }
    Wn.render = rr; Wn.requestAnimationFrame = ra; Wn.last = performance.now();
    const drove = Math.hypot(u.x - x0, u.y - y0), L1 = u.rollL, R1 = u.rollR;
    /* on the spot: half a radian and not a unit of ground */
    u.path = null; u.rlX = u.x; u.rlY = u.y; u.rlA = u.facing;
    const L0 = u.rollL, R0 = u.rollR;
    u.facing += .5; Wn.rollTick(u);
    const pl = u.rollL - L0, pr = u.rollR - R0;
    /* and the picture: two frames standing, then the tracks half a link on */
    Wn.G.units.length = 0;
    const v = Wn.spawnUnit('us', 'am_sher', sx, sy, 0);
    v.facing = 0; v.turret = 0; v.rollL = 0; v.rollR = 0; v.path = null;
    Wn.CAM.tx = sx; Wn.CAM.ty = sy; Wn.CAM.dist = 230; Wn.CAM.yaw = Math.PI / 2; Wn.CAM.pitch = .45;
    for (let i = 0; i < 14; i++) Wn.render();
    Wn.G.units.forEach(q => { q.vUs = q.vGer = true; });
    const a1 = grab(), a2 = grab(), ctrl = lift(a1, a2);
    v.rollL = v.rollR = .9; v._matT = -1;
    const b = grab(), moved = lift(a1, b);
    Wn.G.units.length = 0;
    keep.forEach(e => Wn.G.units.push(e));
    Wn.rebuildGrid();
    return { bad, belts, drove: +drove.toFixed(1), L1: +L1.toFixed(1), R1: +R1.toFixed(1), pl: +pl.toFixed(2), pr: +pr.toFixed(2),
             w: +(u.bodyW * .85 * .5).toFixed(2), ctrl, moved };
  }, { sx: bodies.sx, sy: bodies.sy });
  ok('tracks and wheels move with the vehicle',
     !rolling.bad.length && rolling.belts === 24 && rolling.drove > 60 &&
     Math.abs(rolling.L1 - rolling.drove) < rolling.drove * .12 && Math.abs(rolling.R1 - rolling.drove) < rolling.drove * .12 &&
     Math.abs(rolling.pl - rolling.w) < .05 && Math.abs(rolling.pr + rolling.w) < .05 &&
     rolling.moved > 1500 && rolling.moved > rolling.ctrl * 20,
     `${rolling.bad.length ? 'wheels miscounted on ' + rolling.bad.join(', ') : 'every model turns the wheels its drawing has'}, ` +
     `${rolling.belts} belts repeat; a Sherman that drove ${rolling.drove} rolled its tracks ${rolling.L1} and ${rolling.R1}, ` +
     `turned half a radian on the spot it ran them ${rolling.pl} and ${rolling.pr} (${rolling.w} each way wanted), ` +
     `and half a link of roll moved ${rolling.moved} pixels against ${rolling.ctrl} between two frames standing`);

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
                                   def.side === 'us' ? 'hr_gren' : 'am_rifle',
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
      /* and no hole already there: a new one inside three quarters of an old one's reach
         widens the old one about its own centre, and the row then measures a hole dug
         somewhere else */
      if (G.craters.some(e => Math.hypot(e.x - x, e.y - y) < Math.max(e.r, 50) * .75 + 50)) continue;
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
             onBld, small, at: P.x + ',' + P.y };
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
             `floor ${hole.small ? '! DUG' : 'was refused'}, at ${hole.at}`);

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
    const tank = spawnUnit(G.side, G.side === 'us' ? 'am_sher' : 'hr_p4', 1060, 900, 0);
    const team = spawnUnit(G.side, G.side === 'us' ? 'am_mg' : 'hr_mg', 1300, 900, 0);
    const bld = G.blds.filter(b => b.own === G.own)[0];
    /* a reach that is not a number is the whole bug, so it is asked for by name */
    [['veh', tank], ['team', team], ['bld', bld], ['site', { time: 12 }]].forEach(([k, j]) => {
      const r = j ? workReach(j) : null;
      out.reach[k] = (typeof r === 'number' && isFinite(r)) ? Math.round(r) : String(r);
    });

    /* a vehicle, ordered the way the right-click orders one */
    tank.hp = tank.maxhp * 0.25;
    const v0 = Math.round(tank.hp);
    const eng = spawnUnit(G.own, G.side === 'us' ? 'am_eng' : 'hr_pio', 940, 900, 0);
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
      const e2 = spawnUnit(G.own, G.side === 'us' ? 'am_eng' : 'hr_pio', bld.x, bld.y + 70, 0);
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
    const PAIRS = [['us_mor', 'ger_mor'], ['us_how', 'ger_how'], ['am_240', 'ger_how210']];
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
                    heavy: +rows.ger_how210.dur.toFixed(2) };
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
    const u = window.spawnUnit('us', 'am_rifle', b.x - 140, b.y);
    window.enterBuilding(u, b);
    /* the men stand in one rank inside the slot rather than round four walls: every one
       of them the same distance forward of the centre */
    const fwd = u.models.map(m => (m.x - b.x) * Math.cos(b.face) + (m.y - b.y) * Math.sin(b.face));
    const R = 300, cf = Math.cos(b.face), sf = Math.sin(b.face);
    const front = window.spawnUnit('ger', 'hr_gren', b.x + cf * R, b.y + sf * R);
    const rear = window.spawnUnit('ger', 'hr_gren', b.x - cf * R, b.y - sf * R);
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
          const fr = window.spawnUnit('ger', 'hr_gren', bk.x + cf * R, bk.y + sf * R);
          const re = window.spawnUnit('ger', 'hr_gren', bk.x - cf * R, bk.y - sf * R);
          row.shotF = window.fireLine(g, fr); row.shotR = window.fireLine(g, re);
          fr.dead = re.dead = true;
          window.G.units = window.G.units.filter(u => !u.dead);
        }
        /* the tube is BEHIND it, on ground a man can stand on, and out of the slot */
        if (g && W.rear) {
          row.back = Math.round((g.x - bk.x) * Math.cos(bk.face) + (g.y - bk.y) * Math.sin(bk.face));
          row.stands = window.walkable(g.x, g.y);
        }
        /* Killing the crew is the one case that may buy the same fitting again: the mount
           in the wall is masonry and the men on it are a unit, so a gun whose crew has
           been shot off it is re-crewed rather than written off for the battle.
             Through `killUnit` and not by setting `dead`, because a probe that kills a
           unit with a flag is not testing a death: the flag leaves the bunker holding a
           reference to the corpse, `bk.gar` is still set, and the row reported a re-crew
           refused that the game would have allowed. */
        window.G.units.filter(u => u.id === bk.upUid).forEach(u => window.killUnit(u));
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
    const near = window.spawnUnit('us', 'am_sher', rep.x + 40, rep.y + 40, 0);
    const far = window.spawnUnit('us', 'am_sher', rep.x + RR * 3, rep.y, 0);
    const foe = window.spawnUnit('ger', 'hr_p4', rep.x + 40, rep.y - 40, 0);
    for (const v of [near, far, foe]) { v.hp = Math.round(v.maxhp * .4); }
    near.immob = 3; near.gunDmg = 3;
    const h0 = near.hp, f0 = far.hp, e0 = foe.hp;
    for (let t = 0; t < 20; t++) window.bunkerRepair(.2);
    out.rep = { gain: Math.round(near.hp - h0), far: Math.round(far.hp - f0), foe: Math.round(foe.hp - e0),
                immob: +near.immob.toFixed(1), gun: +near.gunDmg.toFixed(1) };
    const s1 = window.spawnUnit('us', 'am_rifle', med.x + 40, med.y + 40, 0);
    const s2 = window.spawnUnit('us', 'am_rifle', med.x + RR * 3, med.y, 0);
    const s3 = window.spawnUnit('ger', 'hr_gren', med.x + 40, med.y - 40, 0);
    out.med = { near: window.bunkerAidAt(s1), far: window.bunkerAidAt(s2), foe: window.bunkerAidAt(s3) };
    /* And the tap. Garrisoning goes through `issueOrder`, which on a phone is the branch
       BELOW the bunker pick, so a pick that fires unconditionally takes the only way a
       phone has of putting men in a bunker and replaces it with a selection -- a working
       order silently removed, invisible on a desktop and in every screenshot. The test is
       the predicate the pick yields on. */
    const tapBk = mine[0];
    if (tapBk.gar) window.leaveBuilding(tapBk.gar);
    const tapper = window.spawnUnit('us', 'am_rifle', tapBk.x - 150, tapBk.y, 0);
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
    const sq = window.spawnUnit('ger', 'hr_gren', med.x, med.y, 0);
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
      footCross: crossings('am_rifle', 1200), tankCross: crossings('am_sher', 1200)
    };
  });
  ok('wire holds a man up and a hedgehog holds a tank up, and a map may lay both',
     obs.wire >= 6 && obs.hogs >= 6 && obs.mirrored && obs.inWire && obs.inHogs &&
     /* 1.8 rather than 2, because what a man pays WITHOUT the wire is now his own
        gradient rather than a flat 1.25 and these belts are laid on a forward slope: the
        ratio fell from 2.08 to 1.94 with nothing about the wire changed. */
     obs.wireFoot > 1.8 && obs.wireTrack === 1 && obs.hogFoot === 1 && obs.hogTrack > 8 &&
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
    const a = window.spawnUnit(side, side === 'us' ? 'am_sher' : 'hr_p4', 700, 1500, 0);
    const b = window.spawnUnit(foe, foe === 'us' ? 'am_sher' : 'hr_p4', 800, 1500, 0);
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
  /* under the standing orders, which fold up, so it is pressed rather than clicked at */
  await page.evaluate(() => document.querySelector('.arty[data-arty="0"]').click());
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
      army: window.G.units.filter(u => u.side === foe).length,
      /* and at the doors, which nothing else can get past: a finished motor pool of theirs with
         the till full refuses a self-propelled howitzer, a Priest of theirs is not rebuilt as the
         M12, and the same two asked of the player's side and of theirs with the switch back on go
         through, so a refusal is the switch and never the till or the building */
      door: (() => {
        const W = window, G = W.G, me = G.own, fo = W.slotsOf ? W.slotsOf(foe)[0] : foe;
        const fs = G.side === 'us' ? 'ger_dep' : 'us_mot', ms = G.side === 'us' ? 'us_mot' : 'ger_dep';
        const fk = G.side === 'us' ? 'hr_wespe' : 'am_m7', mk = G.side === 'us' ? 'am_m7' : 'hr_wespe';
        const hf = W.hqOf(fo), hm = W.hqOf(me);
        [fo, me].forEach(s => { G.res[s].mp += 5000; G.res[s].fu += 2000; });
        /* eight minutes in, an army may stand at its cap, which would refuse the controls */
        const pc0 = W.popCap; W.popCap = () => 9999;
        const bf = W.spawnBuilding(fo, fs, hf.x, hf.y + 260, true), bm = W.spawnBuilding(me, ms, hm.x, hm.y + 260, true);
        const off = W.queueUnit(bf, fk), mine = W.queueUnit(bm, mk);
        const pr = W.spawnUnit(foe, 'am_m7', hf.x + 200, hf.y, 0); pr.own = fo;
        const m12off = !!W.buyUpgradeAuto(fo, [pr], {});
        G.aiArty = true;
        const on = W.queueUnit(bf, fk), m12on = !!W.buyUpgradeAuto(fo, [pr], {});
        G.aiArty = false;
        [bf, bm].forEach(b => { b.queue.length = 0; G.blds.splice(G.blds.indexOf(b), 1); });
        pr.dead = true; G.units.splice(G.units.indexOf(pr), 1);
        W.popCap = pc0; W.rebuildGrid();
        return { off, mine, on, m12off, m12on, fk, mk };
      })()
    };
  });
  ok('the title screen can take the opposition\'s artillery away',
     noArty.off && noArty.reached > 0 && noArty.bought === 0 && noArty.onField === 0 && noArty.sites === 0 &&
     !noArty.door.off && noArty.door.mine && noArty.door.on && !noArty.door.m12off && noArty.door.m12on,
     `G.aiArty ${noArty.off ? 'off' : 'STILL ON'}; over 480s the post block was reached ${noArty.reached} times, ` +
     `artillery rules fired ${noArty.bought} times, and an army of ${noArty.army} has ${noArty.onField} tubes and ${noArty.sites} positions going up; ` +
     `at the door their ${noArty.door.fk} is ${noArty.door.off ? 'QUEUED' : 'refused'} (${noArty.door.on ? 'queued' : 'REFUSED'} with the switch on), ` +
     `the player's ${noArty.door.mk} ${noArty.door.mine ? 'queued' : 'REFUSED'}, and their Priest ${noArty.door.m12off ? 'REBUILT' : 'not rebuilt'} as the M12 ` +
     `(${noArty.door.m12on ? 'rebuilt' : 'NOT REBUILT'} with the switch on)`);

  /* --- The Red Army, the third army, which fights on the Allied side. The title screen
     offers it as a card of its own; picked, the player's slot fields it and every brain
     still fields the 29th or the 352nd. Its headquarters is the Shtab and makes the Sapery and
     the Strelki, the side opens with a squad of Sapery and two of Strelki, the Shtab refuses the
     29th's rifle squad, the
     sapper's card offers his own army's works (the minefield among them) and no other's,
     and a bunker's fitting is no fitting of his where his army has no team for it. Then the
     squad: four men of the four sapper variants with the PPS-43, the SN-42 plates on the
     second, the greatcoat in its ring on the first and the SSh-40 on all of them. --- */
  await reload(page);
  await deploy(page, { side: 'sov', diff: 1 });
  const sov = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    W.vpSet('us', 9000); W.vpSet('ger', 9000);
    out.card = (document.querySelector('#picksov h3') || {}).textContent || '-';
    out.nat = W.natOfSlot(own); out.army = W.armyOf('us').name; out.foeNat = W.natOfSlot('ger');
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    out.hq = hq ? hq.key : '-'; out.hqName = hq ? hq.def.name : '-';
    out.makes = hq ? W.makesOf(hq).join(',') : '-';
    out.open = G.units.filter(u => u.own === own && !u.dead).map(u => u.key).sort().join(',');
    G.res[own].mp += 2000; G.res[own].fu += 200;
    const q0 = hq.queue.length;
    out.q = W.queueUnit(hq, 'sv_sap') ? hq.queue.slice(-1)[0] : 'refused';
    out.qUs = W.queueUnit(hq, 'am_rifle') ? 'QUEUED' : 'refused';
    hq.queue.length = q0;
    const u = W.spawnUnit(own, 'sv_sap', hq.x + 140, hq.y - 160, 0);
    out.men = u.models.length; out.builder = !!u.def.builder; out.hpPer = u.models[0].hp;
    out.vars = [...new Set(u.models.map((m, i) => W.variantForModel(u, i)))].sort().join(',');
    out.weap = [...new Set(u.models.map((m, i) => W.SOLDIER_VARIANTS[W.variantForModel(u, i)].weapon))].join(',');
    const K = W.KIT.sov, cnt = (fs, cols) => fs.filter(f => cols.indexOf(f.c) >= 0).length;
    const ra = W.manFaces('sv_sap', W.FIGPOSE.stand), rb = W.manFaces('sv_sap_b', W.FIGPOSE.stand);
    const plate = [W.lit(K.armour, 1.1), K.armourD, W.lit(K.armour, .95), W.lit(K.armour, 1.06), W.lit(K.armour, .93)];
    out.sn42 = cnt(rb.faces, plate); out.sn42a = cnt(ra.faces, plate);
    out.roll = cnt(ra.faces, [K.roll, W.lit(K.roll, .95)]);
    out.helm = cnt(rb.parts.helmet, [K.helm, W.lit(K.helm, 1.1), W.lit(K.helm, .9)]);
    W.select([u], false); W.buildCmds();
    out.cards = W.cmdList.map(c => c.btn.title.replace(/ \[.*\]$/, ''));
    W.select([], false);
    out.bunk = W.bunkUnit(W.BUNKUP.mg, own); out.bunkGer = W.bunkUnit(W.BUNKUP.mg, 'ger');
    const m = u.models.filter(q => q.alive)[0], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.fell = rec ? rec.nat : '-';
    out.bodies = !!(W.MODELS.fall.sov_sap && W.MODELS.dead.sov_sap && W.MODELS.fall.sov_sap.length === 3 && W.MODELS.dead.sov_sap.length === 2);
    W.killUnit(u);
    return out;
  });
  const sovWorks = ['SANDBAGS', 'WEAPON PIT', 'WIRE', 'MINES'].filter(t => sov.cards.indexOf(t) >= 0);
  const sovStray = sov.cards.filter(t => /240 MM|MRS 18|FLAK 88|BARRACKS|MOTOR POOL|TANK YARD|KASERNE/.test(t));
  ok('the Red Army: a card of its own, the Shtab, and the Sapery in a kit of their own with bodies of their own',
     sov.card === 'RED ARMY' && sov.nat === 'sov' && sov.army === 'Red Army' && sov.foeNat === 'heer' &&
     sov.hq === 'sov_hq' && sov.hqName === 'Shtab' && sov.makes === 'sv_sap,sv_strel' && sov.open === 'sv_sap,sv_strel,sv_strel' &&
     sov.q === 'sv_sap' && sov.qUs === 'refused' && sov.men === 4 && sov.hpPer === 64 && sov.builder &&
     sov.vars === 'sv_sap,sv_sap_b,sv_sap_c,sv_sap_d' && sov.weap === 'pps' && sov.sn42 > 0 && sov.sn42a === 0 &&
     sov.roll > 0 && sov.helm > 0 && sovWorks.length === 4 && sov.cards.indexOf('ROKS-3') >= 0 && !sovStray.length &&
     sov.bunk === null && sov.bunkGer === 'hr_mg' && sov.fell === 'sov_sap' && sov.bodies,
     `the card reads ${sov.card}; his slot fields ${sov.nat} (${sov.army}) against ${sov.foeNat}; his headquarters is the ` +
     `${sov.hq} (${sov.hqName}) making ${sov.makes}; he opened with ${sov.open}; the Shtab queues ${sov.q} and ` +
     `${sov.qUs} the 29th's rifle squad; ${sov.men} men of ${sov.hpPer} hp of ${sov.vars} carrying ${sov.weap}, ` +
     `${sov.builder ? 'a builder' : 'NOT A BUILDER'}; ${sov.sn42} faces of SN-42 on the second man and ${sov.sn42a} on the first, ` +
     `${sov.roll} of greatcoat ring, ${sov.helm} of SSh-40; the card offers ${sovWorks.join(', ')} and ` +
     `${sov.cards.indexOf('ROKS-3') >= 0 ? 'the ROKS-3' : 'NO ROKS-3'}${sovStray.length ? ' and ' + sovStray.join(', ') : ''}; ` +
     `a machine gun fitting raises ${sov.bunk} for him and ${sov.bunkGer} for the 352nd; a man killed went down as ` +
     `${sov.fell}, sapper bodies ${sov.bodies ? 'baked' : 'MISSING'}`);

  /* --- A brain on the Red Army's slot, which is what SIMPLE puts there. Its line is the
     Strelki now, so its Sapery dig the way every army's builders do: it keeps its one squad of
     them as its engineer, deals the rifle squads jobs, and buys nothing that is not of its own
     army. --- */
  await page.evaluate(() => {
    const W = window, G = W.G, own = G.own;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.__sbq = []; W.__sqU = W.queueUnit; W.__sal = W.aiLook; W.__seng = -1;
    W.queueUnit = function (b) { const r = W.__sqU.apply(this, arguments); if (r && b.own === own) W.__sbq.push(arguments[1]); return r; };
    W.aiLook = function (sl) { const r = W.__sal.apply(this, arguments); if (sl === own) W.__seng = r.engs.length; return r; };
  });
  await fastForward(page, 45);
  const sovAi = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own;
    W.queueUnit = W.__sqU; W.aiLook = W.__sal; W.slotOf(own).ai = 0;
    const mine = G.units.filter(u => u.own === own && !u.dead);
    return { q: W.__sbq.join(',') || 'nothing', stray: W.__sbq.filter(k => W.UNITS[k].nat !== 'sov').length,
             n: mine.length, jobs: mine.filter(u => u.job).length, engs: W.__seng,
             kinds: [...new Set(mine.map(u => u.job || 'dig'))].join(',') };
  });
  ok('a brain on the Red Army\'s slot keeps its sappers to dig and fights with the Strelki',
     sovAi.q !== 'nothing' && sovAi.stray === 0 && sovAi.engs === 1 && sovAi.jobs >= sovAi.n - 1 && sovAi.jobs >= 2,
     `in 45 s it queued ${sovAi.q} (${sovAi.stray} of another army); of its ${sovAi.n} squads ${sovAi.jobs} had a job ` +
     `(${sovAi.kinds}) and ${sovAi.engs} was kept as its engineer`);

  /* --- The ROKS-3 and the minefield. The flamethrowers go to the third and fourth men for
     their price, and against a grenadier squad holding a house the jet is thrown from inside
     its 80 units of the wall, the jet is drawn, the garrison is burnt and the house catches.
     Then a minefield laid in front of the headquarters is shown to its own side and not to
     the enemy's, takes men walking across it and a half-track driven across it, and once it
     has gone off is shown to the side it went off under. The German brain is switched off for
     the drill, or it gives its own units their orders and drives the half-track elsewhere. --- */
  const fl0 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own;
    W.slotOf('ger').ai = 0;
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const p = G.props.filter(q => q.kind === 'ruin' && q.style !== 'church' && q.w > 60 && !q.hurt &&
      !G.blds.some(b => Math.hypot(b.x - q.x, b.y - q.y) < 300)).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!p) return { none: 1 };
    const e = W.spawnUnit('ger', 'hr_gren', p.x, p.y + p.h / 2 + 40);
    W.enterBuilding(e, p);
    const u = W.spawnUnit(own, 'sv_sap', p.x, p.y + p.h / 2 + 70, -Math.PI / 2);
    G.res[own].mp += 500; G.res[own].fu += 100;
    const mp0 = G.res[own].mp, fu0 = G.res[own].fu;
    W.pay(own, W.UPGRADES.roks.cost); W.fitUp(u, 'roks');
    const F = W.__fl = { u, e, p, jets: 0, fl: 0, far: 0 };
    F.sf = W.spawnFx; F.fa = W.fireAt;
    W.spawnFx = function (k) { if (k === 'jet') F.jets++; return F.sf.apply(this, arguments); };
    W.fireAt = function (a, t, dt, o) {
      const c0 = a.glcd || 0, jd = a === F.u && o && o.gl ? W.jetDist(a, t) : 0;
      const r = F.fa.apply(this, arguments);
      if (a === F.u && o && o.gl && (a.glcd || 0) > c0) { F.fl++; F.far = Math.max(F.far, jd); }
      return r;
    };
    W.centreOn(u.x, u.y); W.CAM.dist = 320;
    u.target = e; u.forced = e; u.order = 'attack';
    F.hp0 = e.models.reduce((s, m) => s + (m.alive ? m.hp : 0), 0);
    return { vars: [0, 1, 2, 3].map(i => W.variantForModel(u, i)).join(','), reach: W.glOf(u) ? W.glOf(u).range : 0,
             spent: (mp0 - G.res[own].mp) + '/' + (fu0 - G.res[own].fu), gar: !!e.gar };
  });
  await frames(page, 2);
  await fastForward(page, 12);
  const fl1 = await page.evaluate(() => {
    const W = window, F = W.__fl, e = F.e, fr = F.p.fr;
    W.spawnFx = F.sf; W.fireAt = F.fa;
    return { jets: F.jets, fl: F.fl, far: Math.round(F.far), hp0: F.hp0,
             hp: Math.round(e.dead ? 0 : e.models.reduce((s, m) => s + (m.alive ? m.hp : 0), 0)),
             gar: !!e.gar && !e.dead, fire: fr ? fr.fire.length : 0 };
  });
  const mf0 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, s = W.__o.flatSpot(150);
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const u = W.spawnUnit(own, 'sv_sap', s.x - 60, s.y, 0);
    const site = W.placeWork(own, 'mines', s.x, s.y, 0, [u]);
    if (!site) return { none: 1 };
    site.prog = 1; W.updateSites(0);
    W.killUnit(u); G.units.length = 0;
    const f = G.mines[G.mines.length - 1], wk = G.works.find(w => w.mf === f);
    const e = W.spawnUnit('ger', 'hr_gren', s.x + 110, s.y, Math.PI);
    W.orderMove(e, s.x - 160, s.y);
    W.__mf = { f, e, s, n0: f.n, hp0: e.models.reduce((a, m) => a + m.hp, 0) };
    return { n: f.n, us: W.mineShown(wk, 'us'), ger: W.mineShown(wk, 'ger') };
  });
  for (let i = 0; i < 4 && !mf0.none; i++) {
    await fastForward(page, 4);
    if (await page.evaluate(() => {
      const W = window, F = W.__mf, e = F.e;
      if (F.f.n < F.n0) return true;
      if (!e.moving && !e.dead) W.orderMove(e, e.x < F.s.x ? F.s.x + 110 : F.s.x - 160, F.s.y);
      return false;
    })) break;
  }
  const mf1 = mf0.none ? {} : await page.evaluate(() => {
    const W = window, F = W.__mf, wk = W.G.works.find(w => w.mf === F.f);
    const r = { n: F.f.n, n0: F.n0, shown: wk ? W.mineShown(wk, 'ger') : true, hp0: F.hp0,
                hp: Math.round(F.e.dead ? 0 : F.e.models.reduce((a, m) => a + (m.alive ? m.hp : 0), 0)) };
    /* six men crossing a strip forty-four deep are on it for about fifteen of the mine ticks, so
       they set off four of the five on average, and on one phone run all five: the half-track
       then had nothing to drive into. It gets a field of its own where the first one was, with
       the squad off the ground it drives over */
    if (!F.e.dead) W.killUnit(F.e);
    if (F.f.n <= 0) {
      W.G.res[W.G.own].mp = Math.max(W.G.res[W.G.own].mp, 400);
      const u2 = W.spawnUnit(W.G.own, 'sv_sap', F.s.x - 60, F.s.y, 0);
      const site2 = W.placeWork(W.G.own, 'mines', F.s.x, F.s.y, 0, [u2]);
      if (site2) { site2.prog = 1; W.updateSites(0); F.f = W.G.mines[W.G.mines.length - 1]; r.fresh = 1; }
      W.killUnit(u2);
    }
    if (F.f.n > 0) {
      /* the half-track goes along the strip and not across it: across its 44 units at speed
         it is inside for about four of the mine ticks and gets through two times in five,
         which is a minefield's arithmetic and a drill's coin toss; along it, five or six ticks
         a pass and three times in ten, so it is given ten passes and stops at the first mine */
      const ax = Math.cos(F.f.a), ay = Math.sin(F.f.a);
      const v = W.spawnUnit('ger', 'hr_251', F.f.x + ax * 140, F.f.y + ay * 140, Math.atan2(-ay, -ax));
      W.orderMove(v, F.f.x - ax * 150, F.f.y - ay * 150);
      F.v = v; F.vhp = v.hp; F.vn = F.f.n; F.ax = ax; F.ay = ay;
    }
    return r;
  });
  for (let i = 0; i < 10 && !mf0.none; i++) {
    await fastForward(page, 4);
    if (await page.evaluate(() => {
      const W = window, F = W.__mf, v = F.v;
      if (!v || F.f.n < F.vn || v.dead) return true;
      if (!v.moving) {
        const k = (v.x - F.f.x) * F.ax + (v.y - F.f.y) * F.ay < 0 ? 140 : -150;
        W.orderMove(v, F.f.x + F.ax * k, F.f.y + F.ay * k);
      }
      return false;
    })) break;
  }
  const mf2 = mf0.none ? {} : await page.evaluate(() => {
    const W = window, F = W.__mf;
    return F.v ? { lost: Math.round(F.vhp - (F.v.dead ? 0 : F.v.hp)), immob: +(F.v.immob || 0).toFixed(1), dead: !!F.v.dead } : { lost: -1, immob: 0 };
  });
  ok('the Sapery\'s ROKS-3 burns a garrison out from inside its reach, and their minefield takes men and a half-track',
     !fl0.none && fl0.vars === 'sv_sap,sv_sap_b,sv_flame,sv_flame' && fl0.reach === 80 && fl0.spent === '70/15' && fl0.gar &&
     fl1.fl > 0 && fl1.jets > 0 && fl1.far <= 82 && fl1.hp < fl1.hp0 * .6 && (fl1.fire > 0 || !fl1.gar) &&
     !mf0.none && mf0.us && !mf0.ger && mf1.n < mf1.n0 && mf1.hp < mf1.hp0 && mf1.shown &&
     (mf2.lost >= 150 || mf2.dead) && (mf2.immob > 0 || mf2.dead),
     `fitted for ${fl0.spent}, the men are ${fl0.vars} with a reach of ${fl0.reach}; against a garrison of ${fl1.hp0} hp ` +
     `${fl1.fl} jets left the tubes, the furthest from ${fl1.far} units of the wall, ${fl1.jets} gouts drawn, the garrison ` +
     `left at ${fl1.hp} and ${fl1.gar ? 'STILL IN' : 'out'}, ${fl1.fire} cells alight; the minefield ` +
     `${mf0.none ? 'REFUSED' : `shown to us ${mf0.us} and to them ${mf0.ger}`}; walked across, ${mf1.n0 - mf1.n} mines went off ` +
     `and the squad went from ${mf1.hp0} to ${mf1.hp} hp, the field then ${mf1.shown ? 'shown' : 'STILL HIDDEN'} to them${mf1.fresh ? ', and a fresh one laid' : ''}; ` +
     `a 251 driven across lost ${mf2.lost}${mf2.dead ? ' and died' : ''} and was held for ${mf2.immob} s`);

  /* --- The Kazarma and the T-20. The sapper's card offers the Kazarma, which makes the T-20,
     and the Shtab refuses the tractor. The T-20 has every buffer it needs and its own name, its
     DT asked to lay 1.2 radians off the nose stops at the edge of twenty degrees, it takes one
     squad, refuses a second and tows, the commander head out of its door wears the padded
     helmet and is the eye, a rifle round never goes through its front and a Pak 38's always
     goes through its side, forty wrecks throw nothing, and killed it leaves two of the army's
     crewmen. Then a brain on the Soviet slot with a Kazarma standing buys a T-20 there. --- */
  const kz = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 300;
    const u0 = W.spawnUnit(own, 'sv_sap', hq.x + 140, hq.y - 160, 0);
    W.select([u0], false); W.buildCmds();
    out.cards = W.cmdList.map(c => c.btn.title.replace(/ \[.*\]$/, ''));
    W.select([], false); W.killUnit(u0); G.units.length = 0;
    const at = W.baseSite(own, 'sov_bar') || W.nearestFree(hq.x, hq.y - 260);
    const kb = W.spawnBuilding(own, 'sov_bar', at.x, at.y, true);
    out.makes = W.makesOf(kb).join(','); out.bname = kb.def.name;
    out.bld = W.buildingModel(kb.def, 'sov_bar').length;
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(kb, 'sv_t20'); out.qHq = q(hq, 'sv_t20');
    const B = W.MODELS.veh.sv_t20;
    out.bufs = !!(B && B.hull && B.tur && B.crew);
    const sp = W.nearestFree(hq.x + 200, hq.y + 120), t = W.spawnUnit(own, 'sv_t20', sp.x, sp.y, 0);
    out.name = W.nameOf(t); out.arc = +W.arcOf(t).toFixed(2);
    t.facing = 0; t.turret = 0; t.want = 1.2;
    for (let i = 0; i < 30; i++) W.updateModels(t, .2);
    out.tur = +t.turret.toFixed(3);
    const s1 = W.spawnUnit(own, 'sv_sap', t.x + 30, t.y + 40, 0), s2 = W.spawnUnit(own, 'sv_sap', t.x - 30, t.y + 40, 0);
    W.boardVehicle(s1, t); out.t1 = t.cargo === s1; out.t2 = W.canBoard(s2, t); out.tows = !!t.def.tows;
    /* and the squad aboard is drawn on the seats: every living man on a cushion, his hip at
       its height, facing outward with his feet out at the rail, read in the hull's own frame */
    const I4 = W.m4model(0, 0, 0, 0, 1), H = W.TZH, sm = W.seatMen(t, I4);
    out.aboard = s1.models.filter(m => m.alive).length; out.seated = sm.length;
    out.seats = sm.map(e => {
      const J = W.MODELS.rideJ[e.v], h = W.m4apply(e.mat, J.hip[0], J.hip[1], J.hip[2]),
            a = W.m4apply(e.mat, J.ankleR[0], J.ankleR[1], J.ankleR[2]);
      return [+h.z.toFixed(1), +Math.abs(h.y).toFixed(1), +Math.abs(a.y).toFixed(1), +a.z.toFixed(1)];
    });
    out.seatOk = sm.length > 0 && out.seats.every(r => Math.abs(r[0] - H.zCush - 1.2) < .3 && r[1] > H.yCush[0] && r[1] < H.yCush[1] &&
                                                       r[2] > H.half && r[2] < H.half + 2 && r[3] > 12.2 && r[3] < 14.6);
    W.unloadVehicle(t); out.unseated = W.seatMen(t, I4).length; W.boardVehicle(s1, t);
    const K = W.KIT.sov, V = W.VMODEL.sv_t20;
    out.shlem = V.crew.filter(f => f.c === K.shlem || f.c === K.shlemD).length;
    out.ssh = V.crew.filter(f => f.c === K.helm || f.c === K.helmD).length;
    out.paint = V.hull.filter(f => f.c === W.TZC.body).length;
    const E = W.VIN.sv_t20(V);
    out.eye = +E.eyeUp.z.toFixed(1); out.roof = W.TZH.zRoof;
    t.facing = 0;
    out.rifle = +W.penVs(W.UNITS.hr_gren.w, 150, t, t.x + 150, t.y).toFixed(2);
    out.pak = +W.penVs(W.UNITS.hr_pak.w, 300, t, t.x, t.y + 300).toFixed(2);
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    out.baked = !!(W.MODELS.fall.sov && W.MODELS.dead.sov && W.MODELS.fall.sov.length === 3);
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    /* and the brain on his slot, with the Kazarma standing and money in the till */
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_sap', hq.x + 160, hq.y, 0);
    W.__kzq = []; W.__kzU = W.queueUnit;
    W.queueUnit = function (b) { const r = W.__kzU.apply(this, arguments); if (r && b.own === own) W.__kzq.push(b.key + ':' + arguments[1]); return r; };
    return out;
  });
  await fastForward(page, 40);
  const kzAi = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__kzU; W.slotOf(own).ai = 0;
    return { q: W.__kzq.join(',') || 'nothing' };
  });
  ok('the Red Army\'s Kazarma raises the Komsomolets T-20: a tractor with a DT in its ball, six seats and a hook',
     kz.cards.indexOf('KAZARMA') >= 0 && kz.makes === 'sv_shturm,sv_mor,sv_t20,sv_zis3' && kz.bname === 'Kazarma' && kz.bld > 100 &&
     kz.q === 'sv_t20' && kz.qHq === 'refused' && kz.bufs && kz.name === 'Komsomolets T-20' &&
     kz.arc === .7 && Math.abs(Math.abs(kz.tur) - kz.arc / 2) < .03 && kz.t1 && !kz.t2 && kz.tows &&
     kz.aboard === 4 && kz.seated === kz.aboard && kz.seatOk && kz.unseated === 0 &&
     kz.shlem > 0 && kz.ssh === 0 && kz.paint > 0 && kz.eye > kz.roof + 2 && kz.eye < kz.roof + 6 &&
     kz.rifle === 0 && kz.pak === 1 && kz.blown === 0 && kz.sink > 0 && kz.bodies === 2 && kz.bodyNat === 'sov' && kz.baked &&
     /sov_bar:sv_t20/.test(kzAi.q),
     `the card ${kz.cards.indexOf('KAZARMA') >= 0 ? 'offers' : 'does NOT offer'} the Kazarma; the ${kz.bname} makes ${kz.makes} ` +
     `(${kz.bld} faces) and queues ${kz.q}, the Shtab ${kz.qHq} it; buffers ${kz.bufs ? 'built' : 'MISSING'}; named ${kz.name}; ` +
     `asked for 1.2 the DT laid ${kz.tur} on an arc of ${kz.arc}; it ${kz.t1 ? 'took' : 'REFUSED'} a squad and ` +
     `${kz.t2 ? 'TOOK' : 'refused'} a second, ${kz.tows ? 'tows' : 'DOES NOT TOW'}; ${kz.seated} of the ${kz.aboard} aboard on the ` +
     `seats (hip z, hip y, ankle y, ankle z: ${JSON.stringify(kz.seats)})${kz.seatOk ? '' : ' OFF THEIR SEATS'}, ${kz.unseated} after ` +
     `they got down; the commander has ${kz.shlem} faces of the padded ` +
     `helmet and ${kz.ssh} of the SSh-40, the hull ${kz.paint} of its green; the eye at ${kz.eye} over a roof at ${kz.roof}; ` +
     `a Kar98k through the front ${kz.rifle} and a Pak 38 through the side ${kz.pak}; forty wrecks threw ${kz.blown} and sat ` +
     `down ${kz.sink}; killed it left ${kz.bodies} bodies of ${kz.bodyNat}, ${kz.baked ? 'baked' : 'NOT BAKED'}; a brain with ` +
     `the Kazarma standing queued ${kzAi.q}`);

  /* --- The Strelki. The Shtab makes them and queues them and the Kazarma refuses them: seven men
     of 64 hp in five variants carrying the Mosin with its bayonet fixed, the leader in the pilotka
     and a rifleman under the SSh-40, filled at three fifths of another army's price a man. The two
     fittings are one or the other, and the DP-28s are fired by the two men they were issued to and
     nobody else. A Molotov at a squad in the open burns the ground it breaks on and hurts the men
     on it, and one in through the window of a held house sets the house alight. The shout sends
     the squad forward at four tenths again its pace. A man killed goes down as `sov_str`, and a
     brain on his slot buys them as its line. --- */
  const st = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    W.slotOf('ger').ai = 0;
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0; G.fires.length = 0;
    G.res[own].mp += 3000; G.res[own].fu += 300;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0], kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar')[0];
    function q(b, k) { if (!b) return 'no building'; const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(hq, 'sv_strel'); out.qKz = q(kb, 'sv_strel');
    const P = W.__o.flatSpot(360);
    const u = W.spawnUnit(own, 'sv_strel', P.x - 100, P.y, 0);
    out.men = u.models.length; out.hpPer = u.models[0].hp;
    out.vars = [...new Set(u.models.map((m, i) => W.variantForModel(u, i)))].sort().join(',');
    out.weap = [...new Set(u.models.map((m, i) => W.SOLDIER_VARIANTS[W.variantForModel(u, i)].weapon))].join(',');
    const K = W.KIT.sov, ext = fs => { let a = 1e9, b = -1e9; fs.forEach(f => f.v.forEach(p => { a = Math.min(a, p[0]); b = Math.max(b, p[0]); })); return b - a; };
    out.mosin = +ext(W.weaponModel(K, 'mosin')).toFixed(2);
    const pil = [K.pil, K.pilD, W.lit(K.pil, .94), W.lit(K.pil, .96)], helm = [K.helm, W.lit(K.helm, 1.1), W.lit(K.helm, .9)];
    out.pil = W.manFaces('sv_str_lead', W.FIGPOSE.stand).parts.helmet.filter(f => pil.indexOf(f.c) >= 0).length;
    out.ssh = W.manFaces('sv_str', W.FIGPOSE.stand).parts.helmet.filter(f => helm.indexOf(f.c) >= 0).length;
    out.price = W.reinfCost(u); out.full = Math.round(230 * .22 / 7 * 4);
    W.select([u], false); W.buildCmds();
    out.cards = W.cmdList.map(c => c.btn.title.replace(/ \[.*\]$/, ''));
    W.pay(own, W.UPGRADES.dp28.cost); W.fitUp(u, 'dp28');
    W.select([u], false); W.buildCmds();
    out.cards2 = W.cmdList.map(c => c.btn.title.replace(/ \[.*\]$/, ''));
    W.select([], false);
    out.dpMen = u.models.map((m, i) => W.variantForModel(u, i)).filter(v => v === 'sv_str_dp').length;
    out.excl = W.hasExclusive(u, W.UPGRADES.ppsh.excl);
    /* the pair: fired by the two men it was issued to and by nobody else */
    const e = W.spawnUnit('ger', 'hr_gren', P.x + 100, P.y, Math.PI);
    u.vGer = u.vUs = e.vUs = e.vGer = true; u.moving = false; u.glcd = 0; u.facing = 0;
    u.models.forEach(m => { m.fire = 0; m.fireQ = 0; });
    W.fireAt(u, e, .05, { gl: 1 });
    out.pairCd = u.glcd > 0;
    out.pairMen = u.models.map((m, i) => m.fire > 0 || m.fireQ > 0 ? i : -1).filter(i => i >= 0).join(',');
    W.killUnit(e);
    /* the Molotov at a squad in the open, 110 off */
    const g = W.spawnUnit('ger', 'hr_gren', P.x + 10, P.y, Math.PI);
    g.vUs = g.vGer = true;
    W.__st = { u, g, P, hp0: g.models.reduce((a, m) => a + m.hp, 0) };
    out.molo = W.abGren(u, g, 'molo') || 'thrown';
    return out;
  });
  await fastForward(page, 2.5);
  const st2 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, S = W.__st, out = {};
    out.fires = G.fires.length;
    out.fireAt = G.fires.length ? Math.round(Math.hypot(G.fires[0].x - S.g.x, G.fires[0].y - S.g.y)) : -1;
    out.hurt = Math.round(S.hp0 - S.g.models.reduce((a, m) => a + (m.alive ? m.hp : 0), 0));
    W.killUnit(S.g); G.fires.length = 0;
    /* the shout: how far the squad walks in two seconds, without it and then with it */
    const u = S.u;
    u.x = S.P.x - 100; u.y = S.P.y; u.models.forEach(m => { m.x = u.x + (m.ox || 0); m.y = u.y + (m.oy || 0); });
    W.orderMove(u, S.P.x + 300, S.P.y);
    S.x0 = u.x;
    return out;
  });
  await fastForward(page, 2);
  const st3 = await page.evaluate(() => {
    const W = window, S = W.__st, u = S.u, out = {};
    out.walk = Math.round(u.x - S.x0);
    u.x = S.P.x - 100; u.y = S.P.y; u.models.forEach(m => { m.x = u.x + (m.ox || 0); m.y = u.y + (m.oy || 0); });
    W.orderMove(u, S.P.x + 300, S.P.y);
    out.ura = W.abUra(u) || 'shouted';
    S.x0 = u.x;
    return out;
  });
  await fastForward(page, 2);
  const st4 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, S = W.__st, u = S.u, out = {};
    out.run = Math.round(u.x - S.x0);
    /* the Molotov in through the window of a held house */
    const p = G.props.filter(q => q.kind === 'ruin' && q.style !== 'church' && q.w > 60 && !q.hurt && !q.fr &&
      !G.blds.some(b => Math.hypot(b.x - q.x, b.y - q.y) < 300)).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!p) { out.none = 1; return out; }
    const e = W.spawnUnit('ger', 'hr_gren', p.x, p.y + p.h / 2 + 40);
    W.enterBuilding(e, p);
    u.x = p.x; u.y = p.y + p.h / 2 + 100; u.models.forEach(m => { m.x = u.x + (m.ox || 0); m.y = u.y + (m.oy || 0); });
    u.path = null; u.dest = null; u.order = null; u.abCd = {};
    e.vUs = e.vGer = true;
    out.garWhy = W.abGren(u, e, 'molo') || 'thrown';
    S.p = p; S.e = e;
    return out;
  });
  await fastForward(page, 5);
  const st5 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, S = W.__st, u = S.u, out = {};
    const R = S.p && S.p.fr;
    out.alight = R ? R.heat.filter(h => h > 0).length + R.burn.filter(b => b > 0).length : 0;
    if (S.e && !S.e.dead) W.killUnit(S.e);
    /* every fire put out, as the fire rows do, before anything else is staged in the town */
    if (R) { for (let c = 0; c < R.heat.length; c++) R.heat[c] = 0; if (R.burning) R.burning.length = 0; }
    const m = u.models.filter(q => q.alive)[0], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.fell = rec ? rec.nat : '-';
    out.bodies = !!(W.MODELS.fall.sov_str && W.MODELS.dead.sov_str && W.MODELS.fall.sov_str.length === 3);
    G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    G.units.length = 0;
    /* and the brain on his slot buys them as its line, with its queues empty and money in the till. It
       ran on what the rows above had left: once the Kazarma made a mortar, the row above queued one there,
       it came out during this row with the Shturmoviki behind it, and the brain counted two sections of
       its own and bought no Strelki. A row that leans on what the rows above it bought is a row about
       those rows */
    G.blds.forEach(b => { if (b.own === own) { b.queue.length = 0; b.qt = 0; } });
    G.res[own].mp += 2000; G.res[own].fu += 200;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.__stq = []; W.__stU = W.queueUnit;
    W.queueUnit = function (b) { const r = W.__stU.apply(this, arguments); if (r && b.own === own) W.__stq.push(b.key + ':' + arguments[1]); return r; };
    return out;
  });
  await fastForward(page, 25);
  const stAi = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__stU; W.slotOf(own).ai = 0;
    W.G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    return { q: W.__stq.join(',') || 'nothing' };
  });
  Object.assign(st, st2, st3, st4, st5);
  ok('the Red Army\'s Strelki: seven riflemen with the Mosin, the DP-28 or the PPSh-41, the Molotov and the shout',
     st.q === 'sv_strel' && st.qKz === 'refused' && st.men === 7 && st.hpPer === 64 &&
     st.vars === 'sv_str,sv_str_b,sv_str_c,sv_str_lead,sv_str_m' && st.weap === 'mosin' && Math.abs(st.mosin - 19.53) < .2 &&
     st.pil > 10 && st.ssh > 10 && st.price === 17 && st.full === 29 &&
     ['TWO DP-28', 'TWO PPSH', 'Molotov', 'Ura!'].every(t => st.cards.indexOf(t) >= 0) &&
     st.cards2.indexOf('TWO PPSH') < 0 && st.dpMen === 2 && st.excl && st.pairCd && st.pairMen === '4,5' &&
     st.molo === 'thrown' && st.fires === 1 && st.fireAt < 60 && st.hurt > 10 &&
     st.ura === 'shouted' && st.walk > 60 && st.run > st.walk * 1.25 && !st.none && st.garWhy === 'thrown' && st.alight > 0 &&
     st.fell === 'sov_str' && st.bodies && /sov_hq:sv_strel/.test(stAi.q),
     `the Shtab queues ${st.q} and the Kazarma ${st.qKz} it; ${st.men} men of ${st.hpPer} hp of ${st.vars} carrying ${st.weap}, ` +
     `the Mosin ${st.mosin} units with its bayonet; ${st.pil} faces of pilotka on the leader and ${st.ssh} of SSh-40 on a rifleman; ` +
     `a man refilled at ${st.price} where the full price is ${st.full}; the card offers ${st.cards.filter(t => /DP|PPSH|Molotov|Ura/.test(t)).join(', ')}` +
     ` and with the DP-28s ${st.cards2.indexOf('TWO PPSH') < 0 ? 'no PPSh' : 'STILL THE PPSH'}; ${st.dpMen} men carry the DP-28 and ` +
     `men ${st.pairMen} fired it${st.pairCd ? '' : ' (NO CLOCK SET)'}; the bottle ${st.molo}, ${st.fires} fire on the ground ${st.fireAt} ` +
     `off the squad, which lost ${st.hurt}; walked ${st.walk} in two seconds and ${st.run} after the shout (${st.ura}); a bottle into a ` +
     `held house ${st.garWhy}${st.none ? ' (NO HOUSE)' : ''} and ${st.alight} cells of it caught; a man killed went down as ${st.fell}, ` +
     `bodies ${st.bodies ? 'baked' : 'MISSING'}; a brain on his slot queued ${stAi.q}`);

  /* --- The Shturmoviki. The Kazarma makes them and queues them and the Shtab refuses them: six men
     of 96 hp with the PPSh-41, every one in the SN-42. From in front the plate takes a fifth off
     what a rifle squad does to them, thrown with the same rolls as from behind, and nothing off a
     shell. A volley of RGD-33s goes from every man and hurts the squad it was thrown at; the
     satchel charge is carried up to a half-track and to a building of theirs and does its weight to
     each; and the smoke grenade puts a cloud on the ground it was thrown at. A man killed goes down
     as `sov_sht`, and a brain on his slot buys them out of the Kazarma. --- */
  const sh = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    W.slotOf('ger').ai = 0;
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    G.res[own].mp += 3000; G.res[own].fu += 300;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0], kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar')[0];
    function q(b, k) { if (!b) return 'no building'; const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(kb, 'sv_shturm'); out.qHq = q(hq, 'sv_shturm');
    const P = W.__o.flatSpot(360);
    const u = W.spawnUnit(own, 'sv_shturm', P.x - 100, P.y, 0);
    out.men = u.models.length; out.hpPer = u.models[0].hp;
    out.vars = [...new Set(u.models.map((m, i) => W.variantForModel(u, i)))].sort().join(',');
    out.weap = [...new Set(u.models.map((m, i) => W.SOLDIER_VARIANTS[W.variantForModel(u, i)].weapon))].join(',');
    const K = W.KIT.sov, plate = [W.lit(K.armour, 1.1), K.armourD, W.lit(K.armour, .95), W.lit(K.armour, 1.06), W.lit(K.armour, .93)];
    out.sn42 = out.vars.split(',').map(v => W.manFaces(v, W.FIGPOSE.stand).faces.filter(f => plate.indexOf(f.c) >= 0).length);
    W.select([u], false); W.buildCmds();
    out.cards = W.cmdList.map(c => c.btn.title.replace(/ \[.*\]$/, ''));
    W.select([], false);
    /* the plate: a rifle squad's volleys from in front and from behind, with the same rolls */
    const e = W.spawnUnit('ger', 'hr_gren', P.x + 100, P.y, Math.PI);
    u.vUs = u.vGer = e.vUs = e.vGer = true; u.target = e; e.target = u; e.moving = false; u.moving = false;
    function volleys(face) {
      const rand = Math.random; let seed = 7;
      Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      u.facing = face; u.sup = 0;
      u.models.forEach(m => { m.alive = true; m.hp = 1e5; });
      let took = 0;
      for (let i = 0; i < 40; i++) {
        const h0 = u.models.reduce((a, m) => a + m.hp, 0);
        e.cd = 0; e.sup = 0; W.fireAt(e, u, .05);
        took += h0 - u.models.reduce((a, m) => a + m.hp, 0);
      }
      Math.random = rand;
      return took;
    }
    out.front = Math.round(volleys(0)); out.back = Math.round(volleys(Math.PI));
    out.shell = W.plateOf(u, e, W.UNITS.hr_p4.w);
    u.models.forEach(m => { m.hp = 96; }); u.sup = 0;
    W.killUnit(e);
    /* the volley of RGD-33s at a squad 120 off */
    const g = W.spawnUnit('ger', 'hr_gren', P.x + 20, P.y, Math.PI);
    g.vUs = g.vGer = true;
    out.gren = W.abGren(u, g, 'gren') || 'thrown';
    W.__sh = { u, g, P, hp0: g.models.reduce((a, m) => a + m.hp, 0), n0: G.shots.length };
    return out;
  });
  await fastForward(page, 3);
  const sh2 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, S = W.__sh, u = S.u, out = {};
    out.hurt = Math.round(S.hp0 - S.g.models.reduce((a, m) => a + (m.alive ? m.hp : 0), 0));
    W.killUnit(S.g);
    /* the satchel at a half-track and at a building of theirs */
    u.abCd = {}; u.sup = 0;
    const v = W.spawnUnit('ger', 'hr_251', S.P.x + 60, S.P.y, Math.PI);
    v.vUs = v.vGer = true; v.order = null; v.path = null;
    S.v = v; S.vh0 = v.hp;
    out.satch = W.abBundle(u, v, 'satch') || 'sent';
    out.order = u.order;
    return out;
  });
  await fastForward(page, 8);
  const sh3 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, S = W.__sh, u = S.u, out = {};
    out.veh = Math.round(S.vh0 - (S.v.dead ? 0 : S.v.hp));
    if (!S.v.dead) W.killUnit(S.v);
    u.abCd = {}; u.sup = 0; u.order = null; u.path = null;
    const at = W.nearestFree(S.P.x + 180, S.P.y);
    const b = W.spawnBuilding('ger', 'ger_qtr', at.x, at.y, true);
    b.vUs = b.vGer = true;
    S.b = b; S.bh0 = b.hp;
    out.bld = W.abBundle(u, b, 'satch') || 'sent';
    return out;
  });
  await fastForward(page, 10);
  const sh4 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, S = W.__sh, u = S.u, out = {};
    out.bldHurt = Math.round(S.bh0 - (S.b.dead ? 0 : S.b.hp));
    if (G.blds.indexOf(S.b) >= 0) { G.blds.splice(G.blds.indexOf(S.b), 1); W.rebuildGrid(); }
    /* the smoke grenade on a piece of ground 90 off */
    u.abCd = {}; u.sup = 0; u.order = null; u.path = null;
    S.sx = u.x + 90; S.sy = u.y + 20; S.s0 = G.smoke.length;
    out.smk = W.abBundle(u, { x: S.sx, y: S.sy }, 'smk') || 'thrown';
    return out;
  });
  await fastForward(page, 2.5);
  const sh5 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, S = W.__sh, u = S.u, out = {};
    const cl = G.smoke.slice(S.s0).filter(c => Math.hypot(c.x - S.sx, c.y - S.sy) < 40);
    out.cloud = cl.length ? cl[0].r : 0;
    G.smoke.length = S.s0;
    const m = u.models.filter(q => q.alive)[0], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, m, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.fell = rec ? rec.nat : '-';
    out.bodies = !!(W.MODELS.fall.sov_sht && W.MODELS.dead.sov_sht && W.MODELS.fall.sov_sht.length === 3);
    G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    G.units.length = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.__shq = []; W.__shU = W.queueUnit;
    W.queueUnit = function (b) { const r = W.__shU.apply(this, arguments); if (r && b.own === own) W.__shq.push(b.key + ':' + arguments[1]); return r; };
    return out;
  });
  await fastForward(page, 25);
  const shAi = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__shU; W.slotOf(own).ai = 0;
    W.G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    W.G.units.length = 0;
    return { q: W.__shq.join(',') || 'nothing' };
  });
  Object.assign(sh, sh2, sh3, sh4, sh5);
  ok('the Red Army\'s Shturmoviki: six men in the SN-42 with the PPSh-41, grenades, a satchel charge and smoke',
     sh.q === 'sv_shturm' && sh.qHq === 'refused' && sh.men === 6 && sh.hpPer === 96 &&
     sh.vars === 'sv_sht,sv_sht_b,sv_sht_lead,sv_sht_s' && sh.weap === 'ppsh' && sh.sn42.every(n => n > 0) &&
     ['Grenades', 'Satchel charge', 'Smoke grenade'].every(t => sh.cards.indexOf(t) >= 0) &&
     sh.back > 0 && Math.abs(sh.front / sh.back - .8) < .02 && sh.shell === 1 &&
     sh.gren === 'thrown' && sh.hurt > 40 && sh.satch === 'sent' && sh.order === 'bundle' && sh.veh >= 150 &&
     sh.bld === 'sent' && sh.bldHurt >= 200 && sh.smk === 'thrown' && sh.cloud > 40 &&
     sh.fell === 'sov_sht' && sh.bodies && /sov_bar:sv_shturm/.test(shAi.q),
     `the Kazarma queues ${sh.q} and the Shtab ${sh.qHq} it; ${sh.men} men of ${sh.hpPer} hp of ${sh.vars} carrying ${sh.weap}, ` +
     `SN-42 faces ${sh.sn42.join('/')}; the card offers ${sh.cards.filter(t => /Grenades|Satchel|Smoke/.test(t)).join(', ')}; forty ` +
     `volleys from in front took ${sh.front} and from behind ${sh.back} (${sh.back ? (sh.front / sh.back).toFixed(3) : '-'}), a shell ` +
     `${sh.shell}; the RGD-33s ${sh.gren} and the squad lost ${sh.hurt}; the satchel ${sh.satch} (${sh.order}) took ${sh.veh} off a ` +
     `251 and ${sh.bld} took ${sh.bldHurt} off a Kaserne; the smoke grenade ${sh.smk} and made a cloud of ${sh.cloud}; a man killed ` +
     `went down as ${sh.fell}, bodies ${sh.bodies ? 'baked' : 'MISSING'}; a brain on his slot queued ${shAi.q}`);

  /* --- The Avtopark and the BA-64B. The Avtopark needs the Kazarma and makes the BA-64B, which the
     Kazarma refuses. The car has every buffer it needs and its own name, its turret asked to lay
     over the tail comes all the way round, the DT's flash leaves its own muzzle off the middle of
     the turret, the commander standing in the turret wears the padded helmet and is the eye, a
     rifle round never goes through its front and a Pak 38's always does, eighty wrecks throw the
     turret some of the time, and killed it leaves two of the army's crewmen. Then a brain on the
     Soviet slot with the Kazarma standing pegs out an Avtopark, and with one standing buys the car
     out of it. --- */
  const ba = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 300;
    const u0 = W.spawnUnit(own, 'sv_sap', hq.x + 140, hq.y - 160, 0);
    W.select([u0], false); W.buildCmds();
    out.cards = W.cmdList.map(c => c.btn.title.replace(/ \[.*\]$/, ''));
    W.select([], false); W.killUnit(u0); G.units.length = 0;
    out.need = W.BUILDINGS.sov_mot.need; out.ready = W.bldReady(own, 'sov_mot');
    const at = W.baseSite(own, 'sov_mot') || W.nearestFree(hq.x, hq.y + 260);
    const ab = W.spawnBuilding(own, 'sov_mot', at.x, at.y, true);
    out.makes = W.makesOf(ab).join(','); out.bname = ab.def.name;
    out.bld = W.buildingModel(ab.def, 'sov_mot').length;
    const kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar')[0];
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(ab, 'sv_ba64'); out.qBar = kb ? q(kb, 'sv_ba64') : 'no Kazarma';
    const B = W.MODELS.veh.sv_ba64;
    out.bufs = !!(B && B.hull && B.tur && B.turCrew);
    const sp = W.nearestFree(hq.x + 200, hq.y + 120), t = W.spawnUnit(own, 'sv_ba64', sp.x, sp.y, 0);
    out.name = W.nameOf(t); out.arc = W.arcOf(t) || 0;
    t.facing = 0; t.turret = 0; t.want = 3.1;
    for (let i = 0; i < 60; i++) W.updateModels(t, .2);
    out.tur = +Math.abs(t.turret).toFixed(2);
    t.turret = 0; t._matT = -1;
    const mz = W.gunMuzzle(t);
    out.muzY = +(mz.y - t.y).toFixed(2); out.barY = W.BAT.gy;
    const K = W.KIT.sov, V = W.VMODEL.sv_ba64;
    out.shlem = V.turCrew.filter(f => f.c === K.shlem || f.c === K.shlemD).length;
    out.paint = V.hull.filter(f => f.c === W.TZC.body).length;
    const E = W.VIN.sv_ba64(V);
    out.eye = +E.eyeUp.z.toFixed(1); out.rim = W.BAT.h; out.frame = E.frame;
    out.rifle = +W.penVs(W.UNITS.hr_gren.w, 150, t, t.x + 150, t.y).toFixed(2);
    out.pak = +W.penVs(W.UNITS.hr_pak.w, 300, t, t.x + 300, t.y).toFixed(2);
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 80; i++) { const w = W.makeWreck(t); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    /* the brain on his slot, with the Kazarma standing and the Avtopark taken away again, and the
       clock past the hour the ladder opens the car's rung, so the row does not depend on how long
       the rows before it ran */
    G.blds.splice(G.blds.indexOf(ab), 1); W.rebuildGrid();
    G.t = Math.max(G.t, 600);
    /* and the ZiS-2 written into what the side has ordered, because it comes out of the same
       building a rung later and is one of the things that kill a heavy, which the brain brings
       forward whenever the enemy has one on the field */
    G.made[own].sv_zis2 = Math.max(2, G.made[own].sv_zis2 || 0);
    /* and the rest of the Avtopark and the park beside it, so that the car is the one rung left:
       on one desktop run the brain had a Tankovyy park by now and bought a T-34 first */
    ['sv_t34', 'sv_t3485'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    ['sv_su76', 'sv_zsu37', 'sv_su85', 'sv_su122', 'sv_is2', 'sv_bm13', 'sv_bs3'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    /* and the car itself taken off it: the row queued one above to ask the Avtopark, which the
       list counts as ordered, and a rung ordered once is only bought again as a replacement,
       dearest first, behind the ZiS-2 and whatever the park makes */
    G.made[own].sv_ba64 = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_sap', hq.x + 160, hq.y, 0);
    W.__baA = at;
    W.__baq = []; W.__baU = W.queueUnit;
    W.queueUnit = function (b) { const r = W.__baU.apply(this, arguments); if (r && b.own === own) W.__baq.push(b.key + ':' + arguments[1]); return r; };
    return out;
  });
  await fastForward(page, 30);
  const baAi = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    out.site = G.blds.filter(b => b.own === own && b.key === 'sov_mot').length;
    /* and with an Avtopark standing, what it buys out of it: the one it pegged out may be up
       already and have bought the car, which the hook has heard */
    if (!G.blds.some(b => b.own === own && b.key === 'sov_mot' && b.built >= 1)) {
      W.spawnBuilding(own, 'sov_mot', W.__baA.x, W.__baA.y, true); W.rebuildGrid();
    }
    G.res[own].mp += 2000; G.res[own].fu += 200;
    return out;
  });
  await fastForward(page, 30);
  Object.assign(baAi, await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__baU; W.slotOf(own).ai = 0;
    return { q: W.__baq.join(',') || 'nothing' };
  }));
  ok('the Red Army\'s Avtopark raises the BA-64B: an armoured car with a DT in an open turret that goes all the way round',
     ba.cards.indexOf('AVTOPARK') >= 0 && ba.need === 'sov_bar' && ba.ready && ba.makes === 'sv_ba64,sv_zis2,sv_bs3,sv_bm13,sv_su76,sv_zsu37' && ba.bname === 'Avtopark' &&
     ba.bld > 100 && ba.q === 'sv_ba64' && ba.qBar === 'refused' && ba.bufs && ba.name === 'BA-64B' && !ba.arc && ba.tur > 3.0 &&
     Math.abs(ba.muzY - ba.barY) < .2 && ba.shlem > 0 && ba.paint > 0 && ba.frame === 'tur' &&
     ba.eye > ba.rim + 2 && ba.eye < ba.rim + 6 && ba.rifle === 0 && ba.pak === 1 && ba.blown > 0 && ba.blown < 80 && ba.sink > 0 &&
     ba.bodies === 2 && ba.bodyNat === 'sov' && baAi.site > 0 && /sov_mot:sv_ba64/.test(baAi.q),
     `the card ${ba.cards.indexOf('AVTOPARK') >= 0 ? 'offers' : 'does NOT offer'} the Avtopark, which needs ${ba.need} ` +
     `(${ba.ready ? 'standing' : 'NOT STANDING'}); the ${ba.bname} makes ${ba.makes} (${ba.bld} faces) and queues ${ba.q}, ` +
     `the Kazarma ${ba.qBar} it; buffers ${ba.bufs ? 'built' : 'MISSING'}; named ${ba.name}; asked to lay over the tail the ` +
     `turret came to ${ba.tur}${ba.arc ? ' on an ARC of ' + ba.arc : ''}; the flash ${ba.muzY} off the middle against the DT's ` +
     `${ba.barY}; the commander has ${ba.shlem} faces of the padded helmet, the hull ${ba.paint} of its green; the eye in the ` +
     `${ba.frame} at ${ba.eye} over a rim at ${ba.rim}; a Kar98k through the front ${ba.rifle} and a Pak 38 ${ba.pak}; eighty ` +
     `wrecks threw ${ba.blown} and sat down ${ba.sink}; killed it left ${ba.bodies} bodies of ${ba.bodyNat}; a brain with the ` +
     `Kazarma standing pegged out ${baAi.site} Avtopark and with one standing queued ${baAi.q}`);

  /* --- The Tankovyy park, the T-34/76 and its riders. The park needs the Avtopark and makes the
     T-34, which the Avtopark refuses. The tank has every buffer it needs and its name, a coaxial
     DT, a turret asked to lay over the tail comes all the way round, the commander up in the hatch
     wears the padded helmet and his eye is over the roof and drops when the lid shuts, a rifle
     round never goes through its front and a Panzer IV's always does, forty wrecks throw the
     turret some of the time and sit down, and killed it leaves the army's crewmen. Then a squad of
     Sapery climbs onto its deck: the men kneel on the deck in the hull's frame and go where the
     tank goes, a second squad is refused, the squad has no cover, shoots a grenadier squad put in
     front of it, is hurt by a burst beside the tank, stays on for a move order the tank is in and
     gets down for one it is not, and is thrown off when the tank is killed. Then a brain on the
     Soviet slot with the Avtopark standing pegs out a Tankovyy park and buys a T-34 out of it. --- */
  const tp = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    if (!G.blds.some(b => b.own === own && b.key === 'sov_mot' && b.built >= 1)) {
      const am = W.baseSite(own, 'sov_mot') || W.nearestFree(hq.x, hq.y + 260); W.spawnBuilding(own, 'sov_mot', am.x, am.y, true);
    }
    const u0 = W.spawnUnit(own, 'sv_sap', hq.x + 140, hq.y - 160, 0);
    W.select([u0], false); W.buildCmds();
    out.cards = W.cmdList.map(c => c.btn.title.replace(/ \[.*\]$/, ''));
    W.select([], false); W.killUnit(u0); G.units.length = 0;
    out.need = W.BUILDINGS.sov_tank.need; out.ready = W.bldReady(own, 'sov_tank');
    const at = W.baseSite(own, 'sov_tank') || W.nearestFree(hq.x - 200, hq.y + 260);
    const tb = W.spawnBuilding(own, 'sov_tank', at.x, at.y, true);
    out.makes = W.makesOf(tb).join(','); out.bname = tb.def.name;
    out.bld = W.buildingModel(tb.def, 'sov_tank').length;
    const ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot')[0];
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(tb, 'sv_t34'); out.qMot = ab ? q(ab, 'sv_t34') : 'no Avtopark';
    const B = W.MODELS.veh.sv_t34;
    out.bufs = !!(B && B.hull && B.tur && B.hatch && B.cmdr && B.leaf);
    const sp = W.nearestFree(hq.x + 220, hq.y + 140), t = W.spawnUnit(own, 'sv_t34', sp.x, sp.y, 0);
    out.name = W.nameOf(t); out.arc = W.arcOf(t) || 0; out.coax = W.secondaryKeys(t).join(',');
    out.tows = !!t.def.tows;
    t.facing = 0; t.turret = 0; t.want = 3.1;
    for (let i = 0; i < 80; i++) W.updateModels(t, .2);
    out.tur = +Math.abs(t.turret).toFixed(2);
    t.turret = 0; t._matT = -1;
    const K = W.KIT.sov, V = W.VMODEL.sv_t34;
    out.shlem = W.HATCHES.sv_t34.open.filter(f => f.c === K.shlem || f.c === K.shlemD).length;
    out.paint = V.hull.filter(f => f.c === W.TZC.body).length;
    const E = W.VIN.sv_t34(V);
    out.eyeUp = +E.eyeUp.z.toFixed(1); out.eyeIn = +E.eyeIn.z.toFixed(1); out.roof = W.TTT.zr; out.frame = E.frame;
    out.rifle = +W.penVs(W.UNITS.hr_gren.w, 150, t, t.x + 150, t.y).toFixed(2);
    out.p4 = +W.penVs(W.UNITS.hr_p4.w, 300, t, t.x + 300, t.y).toFixed(2);
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    /* the riders: a squad stood beside the tank boards it, and a second is refused */
    const r = W.spawnUnit(own, 'sv_sap', t.x - 40, t.y + 30, 0), r2 = W.spawnUnit(own, 'sv_sap', t.x - 40, t.y - 50, 0);
    W.boardVehicle(r, t);
    out.ride = r.ride === t && t.cargo === r && !r.inside;
    out.second = W.canBoard(r2, t);
    W.killUnit(r2);
    for (let i = 0; i < 4; i++) { W.updateUnit(r, .05); W.updateModels(r, .05); }
    t._matT = -1;
    /* each man against the ground under himself: on ground that slopes across the hull the men
       on the low side are on the deck and lower than the ground under the tank's middle */
    const deck = r.models.filter(m => m.alive && m.rz !== undefined && m.rz > W.groundZ(m.x, m.y) + 12 &&
      Math.abs((m.x - t.x) * Math.cos(t.facing) + (m.y - t.y) * Math.sin(t.facing)) < 30);
    out.deckZ = r.models.filter(m => m.alive).map(m => +((m.rz === undefined ? NaN : m.rz) - W.groundZ(m.x, m.y)).toFixed(1)).join(',');
    out.onDeck = deck.length + '/' + r.models.filter(m => m.alive).length;
    out.cover = W.coverOf(r);
    W.__tp = { t, r, x0: t.x, y0: t.y };
    t.manual = true;
    W.orderMove(t, t.x + 160, t.y);
    return out;
  });
  await fastForward(page, 5);
  Object.assign(tp, await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, T = W.__tp, t = T.t, r = T.r, out = {};
    out.drove = +Math.hypot(t.x - T.x0, t.y - T.y0).toFixed(1);
    out.with = +Math.hypot(r.x - t.x, r.y - t.y).toFixed(1) + '/' + (r.ride === t ? 'riding' : 'OFF');
    /* a grenadier squad in front of them, which the tank, under command, leaves to the riders */
    W.clearOrder(t);
    const e = W.spawnUnit('ger', 'hr_gren', t.x + 120, t.y, Math.PI);
    T.e = e; T.rounds0 = (W.recOf(r) || {}).rounds || 0;
    T.ehp0 = e.models.reduce((s, m) => s + (m.alive ? m.hp : 0), 0);
    return out;
  }));
  await fastForward(page, 8);
  Object.assign(tp, await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, T = W.__tp, t = T.t, r = T.r, e = T.e, out = {};
    out.fired = ((W.recOf(r) || {}).rounds || 0) - T.rounds0;
    out.hitE = +(T.ehp0 - e.models.reduce((s, m) => s + (m.alive ? m.hp : 0), 0)).toFixed(0);
    W.killUnit(e);
    const hp0 = r.models.reduce((s, m) => s + (m.alive ? m.hp : 0), 0);
    W.explode(t.x + 6, t.y, 30, 140, null, null);
    out.burst = +(hp0 - r.models.reduce((s, m) => s + (m.alive ? m.hp : 0), 0)).toFixed(0);
    out.stillOn = r.dead ? 'dead' : r.ride === t ? 'riding' : 'OFF';
    if (r.dead || r.ride !== t) { const r3 = W.spawnUnit(own, 'sv_sap', t.x - 40, t.y + 30, 0); W.boardVehicle(r3, t); T.r = r3; }
    const rr = T.r;
    W.select([t, rr], false); W.orderMove(rr, t.x + 300, t.y);
    out.stay = rr.ride === t;
    W.select([], false); W.orderMove(rr, t.x - 200, t.y + 100);
    out.down = !rr.ride && !t.cargo && rr.models.every(m => m.rz === undefined);
    const r4 = W.spawnUnit(own, 'sv_sap', t.x - 40, t.y + 30, 0); W.boardVehicle(r4, t);
    W.killUnit(t); W.updateUnit(r4, .05);
    out.thrown = !r4.ride && r4.models.every(m => m.rz === undefined) ? 'off' : 'STILL ON';
    const nc = G.corpses.length;
    const t2 = W.spawnUnit(own, 'sv_t34', t.x, t.y + 150, 0); W.killUnit(t2);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    /* the brain on his slot, with the Avtopark standing and the park taken away again */
    const tb = G.blds.filter(b => b.own === own && b.key === 'sov_tank')[0];
    T.at = { x: tb.x, y: tb.y };
    G.blds.splice(G.blds.indexOf(tb), 1); W.rebuildGrid();
    G.t = Math.max(G.t, 700);
    G.res[own].mp += 2000; G.res[own].fu += 400;
    /* and everything else the park and the Avtopark make written into what the side has ordered:
       with a heavy of the enemy's on the field the brain brings the guns that kill one forward and
       sends the T-34, which cannot, to the back */
    ['sv_su76', 'sv_zsu37', 'sv_su85', 'sv_su122', 'sv_is2', 'sv_bm13', 'sv_bs3'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    ['sv_t3485', 'sv_zis2'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    W.slotOf(own).ai = 1; W.aiInit(own);
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_sap', hq.x + 160, hq.y, 0);
    W.__tpq = []; W.__tpU = W.queueUnit;
    W.queueUnit = function (b) { const q = W.__tpU.apply(this, arguments); if (q && b.own === own) W.__tpq.push(b.key + ':' + arguments[1]); return q; };
    return out;
  }));
  await fastForward(page, 30);
  const tpAi = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    out.site = G.blds.filter(b => b.own === own && b.key === 'sov_tank').length;
    if (!G.blds.some(b => b.own === own && b.key === 'sov_tank' && b.built >= 1)) {
      W.spawnBuilding(own, 'sov_tank', W.__tp.at.x, W.__tp.at.y, true); W.rebuildGrid();
    }
    G.res[own].mp += 2000; G.res[own].fu += 400;
    return out;
  });
  await fastForward(page, 30);
  Object.assign(tpAi, await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__tpU; W.slotOf(own).ai = 0;
    return { q: W.__tpq.join(',') || 'nothing' };
  }));
  ok('the Red Army\'s Tankovyy park raises the T-34/76, and a squad rides on its deck, shooting and in the open',
     tp.cards.indexOf('TANK PARK') >= 0 && tp.need === 'sov_mot' && tp.ready && tp.makes === 'sv_t34,sv_t3485,sv_su85,sv_su122,sv_is2' && tp.bname === 'Tankovyy park' &&
     tp.bld > 100 && tp.q === 'sv_t34' && tp.qMot === 'refused' && tp.bufs && tp.name === 'T-34/76' && !tp.arc && tp.tur > 3.0 &&
     tp.coax === 'coax' && tp.tows && tp.shlem > 0 && tp.paint > 0 && tp.frame === 'tur' && tp.eyeUp > tp.roof + 2 &&
     tp.eyeUp < tp.roof + 9 && tp.eyeIn < tp.eyeUp && tp.rifle === 0 && tp.p4 === 1 && tp.blown > 0 && tp.blown < 40 && tp.sink > 0 &&
     tp.ride && !tp.second && /^(\d)\/\1$/.test(tp.onDeck) && tp.cover === 0 && tp.drove > 60 && /^0(\.\d)?\/riding$/.test(tp.with) &&
     tp.fired > 0 && tp.hitE > 0 && tp.burst > 0 && tp.stay && tp.down && tp.thrown === 'off' && tp.bodies >= 2 &&
     tp.bodyNat === 'sov' && tpAi.site > 0 && /sov_tank:sv_t34/.test(tpAi.q),
     `the card ${tp.cards.indexOf('TANK PARK') >= 0 ? 'offers' : 'does NOT offer'} the Tankovyy park, which needs ${tp.need} ` +
     `(${tp.ready ? 'standing' : 'NOT STANDING'}); the ${tp.bname} makes ${tp.makes} (${tp.bld} faces) and queues ${tp.q}, the ` +
     `Avtopark ${tp.qMot} it; buffers ${tp.bufs ? 'built' : 'MISSING'}; named ${tp.name}, secondary ${tp.coax}, ` +
     `${tp.tows ? 'tows' : 'does NOT tow'}; asked to lay over the tail the turret came to ${tp.tur}${tp.arc ? ' on an ARC of ' + tp.arc : ''}; ` +
     `the commander has ${tp.shlem} faces of the padded helmet, the hull ${tp.paint} of its green; the eye in the ${tp.frame} at ` +
     `${tp.eyeUp} head out and ${tp.eyeIn} head in, over a roof at ${tp.roof}; a Kar98k through the front ${tp.rifle} and a ` +
     `Panzer IV ${tp.p4}; forty wrecks threw ${tp.blown} and sat down ${tp.sink}; a squad ${tp.ride ? 'rides' : 'does NOT ride'} ` +
     `it with a second ${tp.second ? 'ALLOWED' : 'refused'}, ${tp.onDeck} men on the deck (${tp.deckZ} over the ground under them), cover ${tp.cover}; the tank drove ` +
     `${tp.drove} with the squad ${tp.with} off it; the riders fired ${tp.fired} rounds and took ${tp.hitE} off the grenadiers; ` +
     `a burst beside the tank took ${tp.burst} off them (${tp.stillOn}); in the tank's order they ${tp.stay ? 'stayed on' : 'GOT OFF'}, ` +
     `in their own they ${tp.down ? 'got down' : 'DID NOT'}; the tank killed under riders threw them ${tp.thrown}; killed it ` +
     `left ${tp.bodies} bodies of ${tp.bodyNat}; a brain with the Avtopark standing pegged out ${tpAi.site} Tankovyy park and ` +
     `with one standing queued ${tpAi.q}`);

  /* --- The SU-85. The Tankovyy park makes it beside the T-34 and queues it, and the Avtopark
     refuses it. Every buffer it needs is built, the hatch's three among them, it is a casemate
     named the SU-85 with no machine gun, and its gun asked to lay 1.2 radians off the nose stops
     at the edge of its ten degrees. The commander up in the hatch wears the padded helmet, and the
     eye is over the roof head out and drops when the lid shuts. A Kar98k never goes through its
     front and a Panzer IV always does; its own 85 mm goes through a Panzer IV's front every time
     at three hundred and a Panther's front less often than its side. Forty wrecks throw nothing
     and sit down, killed it leaves the army's crewmen, and a brain on his slot with the Tankovyy
     park standing and two T-34s bought buys one. --- */
  const su = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let tb = G.blds.filter(b => b.own === own && b.key === 'sov_tank' && b.built >= 1)[0];
    if (!tb) { const at = W.baseSite(own, 'sov_tank') || W.nearestFree(hq.x - 200, hq.y + 260); tb = W.spawnBuilding(own, 'sov_tank', at.x, at.y, true); }
    out.makes = W.makesOf(tb).join(',');
    const ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot')[0];
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(tb, 'sv_su85'); out.qMot = ab ? q(ab, 'sv_su85') : 'no Avtopark';
    const B = W.MODELS.veh.sv_su85, V = W.VMODEL.sv_su85;
    out.bufs = !!(B && B.hull && B.tur && B.hatch && B.cmdr && B.leaf);
    out.fixed = !!V.fixed;
    const sp = W.nearestFree(hq.x + 220, hq.y + 140), t = W.spawnUnit(own, 'sv_su85', sp.x, sp.y, 0);
    out.name = W.nameOf(t); out.arc = +(W.arcOf(t) || 0).toFixed(2); out.sec = W.secondaryKeys(t).join(',') || 'none';
    t.facing = 0; t.turret = 0; t.want = 1.2;
    for (let i = 0; i < 30; i++) W.updateModels(t, .2);
    out.tur = +t.turret.toFixed(3);
    t.turret = 0; t._matT = -1;
    const K = W.KIT.sov;
    out.shlem = W.HATCHES.sv_su85.open.filter(f => f.c === K.shlem || f.c === K.shlemD).length;
    out.paint = V.hull.filter(f => f.c === W.TZC.body).length;
    const E = W.insideOf('sv_su85', V);
    out.eyeUp = +E.eyeUp.z.toFixed(1); out.eyeIn = +E.eyeIn.z.toFixed(1); out.roof = W.S85.zRoof; out.frame = E.frame;
    out.rifle = +W.penVs(W.UNITS.hr_gren.w, 150, t, t.x + 150, t.y).toFixed(2);
    out.p4 = +W.penVs(W.UNITS.hr_p4.w, 300, t, t.x + 300, t.y).toFixed(2);
    /* its own gun against the two German tanks, a Panzer IV and a Panther met head on and the
       Panther met broadside, three hundred out */
    const p4 = W.spawnUnit('ger', 'hr_p4', t.x + 300, t.y, Math.PI), pa = W.spawnUnit('ger', 'hr_panther', t.x + 300, t.y + 200, Math.PI);
    out.onP4 = +W.penVs(t.def.w, 300, p4, t.x, t.y).toFixed(2);
    pa.x = t.x + 300; pa.y = t.y; out.paF = +W.penVs(t.def.w, 300, pa, t.x, t.y).toFixed(2);
    pa.facing = Math.PI / 2; pa._matT = -1; out.paS = +W.penVs(t.def.w, 300, pa, t.x, t.y).toFixed(2);
    [p4, pa].forEach(e => G.units.splice(G.units.indexOf(e), 1));
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    /* the brain on his slot, with the park standing, the rungs under the SU-85 on the ladder
       already bought and none of it bought yet, so that what it does next is the SU-85's rung
       and not the rows above: the T-34 row's brain buys one when it has the money */
    G.t = Math.max(G.t, 700);
    G.res[own].mp += 3000; G.res[own].fu += 600;
    ['sv_su76', 'sv_zsu37', 'sv_t20', 'sv_ba64', 'sv_su122', 'sv_bm13', 'sv_bs3'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    ['sv_zis3', 'sv_zis2', 'sv_t3485'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    G.made[own].sv_t34 = Math.max(2, G.made[own].sv_t34 || 0); out.madeSu = G.made[own].sv_su85 || 0; G.made[own].sv_su85 = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    W.__suq = []; W.__suU = W.queueUnit;
    W.queueUnit = function (b) { const q = W.__suU.apply(this, arguments); if (q && b.own === own) W.__suq.push(b.key + ':' + arguments[1]); return q; };
    return out;
  });
  await fastForward(page, 40);
  const suAi = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__suU; W.slotOf(own).ai = 0;
    return { q: W.__suq.join(',') || 'nothing' };
  });
  ok('the Red Army\'s Tankovyy park raises the SU-85, a casemate with the 85 mm in its front plate',
     /sv_su85/.test(su.makes) && su.q === 'sv_su85' && su.qMot === 'refused' && su.bufs && su.fixed && su.name === 'SU-85' &&
     su.sec === 'none' && su.arc === .35 && Math.abs(Math.abs(su.tur) - su.arc / 2) < .03 && su.shlem > 0 && su.paint > 0 &&
     su.frame === 'hull' && su.eyeUp > su.roof + 2 && su.eyeUp < su.roof + 9 && su.eyeIn < su.eyeUp && su.rifle === 0 && su.p4 === 1 &&
     su.onP4 === 1 && su.paF < .5 && su.paS > .8 && su.blown === 0 && su.sink > 0 && su.bodies >= 2 && su.bodyNat === 'sov' &&
     /sov_tank:sv_su85/.test(suAi.q),
     `the Tankovyy park makes ${su.makes} and queues ${su.q}, the Avtopark ${su.qMot} it; buffers ${su.bufs ? 'built' : 'MISSING'}, ` +
     `${su.fixed ? 'a casemate' : 'NOT A CASEMATE'}; named ${su.name}, secondary ${su.sec}; asked for 1.2 the gun laid ${su.tur} on an ` +
     `arc of ${su.arc}; the commander has ${su.shlem} faces of the padded helmet, the hull ${su.paint} of its green; the eye in the ` +
     `${su.frame} at ${su.eyeUp} head out and ${su.eyeIn} head in, over a roof at ${su.roof}; a Kar98k through the front ${su.rifle} ` +
     `and a Panzer IV ${su.p4}; its 85 mm through a Panzer IV's front ${su.onP4}, a Panther's front ${su.paF} and its side ${su.paS}; ` +
     `forty wrecks threw ${su.blown} and sat down ${su.sink}; killed it left ${su.bodies} bodies of ${su.bodyNat}; a brain with the ` +
     `park standing (and ${su.madeSu} SU-85 on the tally already, which the row takes off it) queued ${suAi.q}`);

  /* --- The T-34-85. The Tankovyy park makes it beside the T-34/76 and queues it, and the
     Avtopark refuses it. Every buffer it needs is built, the cupola's three among them, it is
     named the T-34-85 with a coaxial DT and tows, its gun is right of the middle and the turret
     asked to lay over the tail comes all the way round. The commander up in the cupola wears the
     padded helmet and the eye is over the roof head out and drops when the lid shuts. A Kar98k
     never goes through its front and a Panzer IV always does, and its 85 mm goes through a Panzer
     IV's front every time at three hundred and a Panther's front less often than its side. A
     squad rides it, every man of it kneeling on the deck behind the turret and clear of it.
     Forty wrecks throw the turret some of the time, killed it leaves the army's crewmen, and a
     brain on his slot with the park standing, the T-34s and the SU-85 bought, buys one. --- */
  const t85 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let tb = G.blds.filter(b => b.own === own && b.key === 'sov_tank' && b.built >= 1)[0];
    if (!tb) { const at = W.baseSite(own, 'sov_tank') || W.nearestFree(hq.x - 200, hq.y + 260); tb = W.spawnBuilding(own, 'sov_tank', at.x, at.y, true); }
    out.makes = W.makesOf(tb).join(',');
    const ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot')[0];
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(tb, 'sv_t3485'); out.qMot = ab ? q(ab, 'sv_t3485') : 'no Avtopark';
    const B = W.MODELS.veh.sv_t3485, V = W.VMODEL.sv_t3485;
    out.bufs = !!(B && B.hull && B.tur && B.hatch && B.cmdr && B.leaf);
    out.barY = V.barY || 0;
    const sp = W.nearestFree(hq.x + 220, hq.y + 140), t = W.spawnUnit(own, 'sv_t3485', sp.x, sp.y, 0);
    out.name = W.nameOf(t); out.arc = W.arcOf(t) || 0; out.coax = W.secondaryKeys(t).join(','); out.tows = !!t.def.tows;
    t.facing = 0; t.turret = 0; t.want = 3.1;
    for (let i = 0; i < 80; i++) W.updateModels(t, .2);
    out.tur = +Math.abs(t.turret).toFixed(2);
    t.turret = 0; t._matT = -1;
    const K = W.KIT.sov;
    out.shlem = W.HATCHES.sv_t3485.open.filter(f => f.c === K.shlem || f.c === K.shlemD).length;
    out.paint = V.hull.filter(f => f.c === W.TZC.body).length;
    const E = W.VIN.sv_t3485(V);
    out.eyeUp = +E.eyeUp.z.toFixed(1); out.eyeIn = +E.eyeIn.z.toFixed(1); out.roof = W.T85.zr; out.frame = E.frame;
    out.rifle = +W.penVs(W.UNITS.hr_gren.w, 150, t, t.x + 150, t.y).toFixed(2);
    out.p4 = +W.penVs(W.UNITS.hr_p4.w, 300, t, t.x + 300, t.y).toFixed(2);
    const p4 = W.spawnUnit('ger', 'hr_p4', t.x + 300, t.y, Math.PI), pa = W.spawnUnit('ger', 'hr_panther', t.x + 300, t.y + 200, Math.PI);
    out.onP4 = +W.penVs(t.def.w, 300, p4, t.x, t.y).toFixed(2);
    pa.x = t.x + 300; pa.y = t.y; out.paF = +W.penVs(t.def.w, 300, pa, t.x, t.y).toFixed(2);
    pa.facing = Math.PI / 2; pa._matT = -1; out.paS = +W.penVs(t.def.w, 300, pa, t.x, t.y).toFixed(2);
    [p4, pa].forEach(e => G.units.splice(G.units.indexOf(e), 1));
    /* the riders: every man on the deck, and each a hand clear of the back of the turret */
    const r = W.spawnUnit(own, 'sv_strel', t.x - 40, t.y + 30, 0);
    W.boardVehicle(r, t);
    out.ride = r.ride === t && t.cargo === r && !r.inside;
    for (let i = 0; i < 4; i++) { W.updateUnit(r, .05); W.updateModels(r, .05); }
    const live = r.models.filter(m => m.alive), c = Math.cos(t.facing), sn = Math.sin(t.facing);
    out.onDeck = live.filter(m => m.rz !== undefined && m.rz > W.groundZ(m.x, m.y) + 12).length + '/' + live.length;
    out.clear = +Math.min.apply(null, live.map(m => {
      const lx = (m.x - t.x) * c + (m.y - t.y) * sn, ly = -(m.x - t.x) * sn + (m.y - t.y) * c;
      return W.t85At(-16, ly, .7, 0).x + W.TTH.turX - lx;
    })).toFixed(1);
    W.killUnit(r);
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    /* the brain on his slot with every rung under the T-34-85's written into what the side has
       ordered and none of it, so that what it buys next is the T-34-85 */
    G.t = Math.max(G.t, 700);
    G.res[own].mp += 3000; G.res[own].fu += 600;
    ['sv_su76', 'sv_zsu37', 'sv_t20', 'sv_ba64', 'sv_su85', 'sv_su122', 'sv_bm13', 'sv_bs3'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    ['sv_t34', 'sv_zis3', 'sv_zis2'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    G.made[own].sv_t3485 = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    W.__t85q = []; W.__t85U = W.queueUnit;
    W.queueUnit = function (b) { const q = W.__t85U.apply(this, arguments); if (q && b.own === own) W.__t85q.push(b.key + ':' + arguments[1]); return q; };
    return out;
  });
  await fastForward(page, 40);
  const t85Ai = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__t85U; W.slotOf(own).ai = 0;
    return { q: W.__t85q.join(',') || 'nothing' };
  });
  ok('the Red Army\'s Tankovyy park raises the T-34-85, with the 85 mm in a cast turret and a squad behind it on the deck',
     /sv_t3485/.test(t85.makes) && t85.q === 'sv_t3485' && t85.qMot === 'refused' && t85.bufs && t85.name === 'T-34-85' &&
     t85.coax === 'coax' && t85.tows && !t85.arc && t85.tur > 3.0 && t85.barY > 0 && t85.shlem > 0 && t85.paint > 0 &&
     t85.frame === 'tur' && t85.eyeUp > t85.roof + 2 && t85.eyeUp < t85.roof + 9 && t85.eyeIn < t85.eyeUp && t85.rifle === 0 &&
     t85.p4 === 1 && t85.onP4 === 1 && t85.paF < t85.paS && t85.paS > .8 && t85.ride && /^(\d)\/\1$/.test(t85.onDeck) &&
     t85.clear > 1 && t85.blown > 0 && t85.blown < 40 && t85.sink > 0 && t85.bodies >= 2 && t85.bodyNat === 'sov' &&
     /sov_tank:sv_t3485/.test(t85Ai.q),
     `the Tankovyy park makes ${t85.makes} and queues ${t85.q}, the Avtopark ${t85.qMot} it; buffers ${t85.bufs ? 'built' : 'MISSING'}; ` +
     `named ${t85.name}, secondary ${t85.coax}, ${t85.tows ? 'tows' : 'does NOT tow'}, the gun ${t85.barY} right of the middle; ` +
     `asked to lay over the tail the turret came to ${t85.tur}${t85.arc ? ' on an ARC of ' + t85.arc : ''}; the commander has ` +
     `${t85.shlem} faces of the padded helmet, the hull ${t85.paint} of its green; the eye in the ${t85.frame} at ${t85.eyeUp} head ` +
     `out and ${t85.eyeIn} head in, over a roof at ${t85.roof}; a Kar98k through the front ${t85.rifle} and a Panzer IV ${t85.p4}; its ` +
     `85 mm through a Panzer IV's front ${t85.onP4}, a Panther's front ${t85.paF} and its side ${t85.paS}; a squad ` +
     `${t85.ride ? 'rides' : 'does NOT ride'} it with ${t85.onDeck} men on the deck, the nearest ${t85.clear} behind the turret; ` +
     `forty wrecks threw ${t85.blown} and sat down ${t85.sink}; killed it left ${t85.bodies} bodies of ${t85.bodyNat}; a brain with ` +
     `the park standing queued ${t85Ai.q}`);

  /* --- The SU-122. The Tankovyy park makes it and queues it, and the Avtopark refuses it. Every
     buffer it needs is built, the hatch's three among them, it is a casemate named the SU-122 with
     no machine gun, and its mount asked to lay 1.2 radians off the nose stops at the edge of its
     ten degrees. The commander up in the hatch wears the padded helmet, and the eye is over the
     roof head out and drops when the lid shuts. A Kar98k never goes through its front and a Panzer
     IV always does; its hollow charge goes through a Panzer IV's front more often than not at three
     hundred and a Panther's front less often than its side. Forty wrecks throw nothing and sit
     down, killed it leaves the army's crewmen, and a brain on his slot with the park standing and
     the rungs under it bought buys one. --- */
  const s122 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let tb = G.blds.filter(b => b.own === own && b.key === 'sov_tank' && b.built >= 1)[0];
    if (!tb) { const at = W.baseSite(own, 'sov_tank') || W.nearestFree(hq.x - 200, hq.y + 260); tb = W.spawnBuilding(own, 'sov_tank', at.x, at.y, true); }
    out.makes = W.makesOf(tb).join(',');
    const ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot')[0];
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(tb, 'sv_su122'); out.qMot = ab ? q(ab, 'sv_su122') : 'no Avtopark';
    const B = W.MODELS.veh.sv_su122, V = W.VMODEL.sv_su122;
    out.bufs = !!(B && B.hull && B.tur && B.hatch && B.cmdr && B.leaf);
    out.fixed = !!V.fixed;
    const sp = W.nearestFree(hq.x + 220, hq.y + 140), t = W.spawnUnit(own, 'sv_su122', sp.x, sp.y, 0);
    out.name = W.nameOf(t); out.arc = +(W.arcOf(t) || 0).toFixed(2); out.sec = W.secondaryKeys(t).join(',') || 'none';
    t.facing = 0; t.turret = 0; t.want = 1.2;
    for (let i = 0; i < 30; i++) W.updateModels(t, .2);
    out.tur = +t.turret.toFixed(3);
    t.turret = 0; t._matT = -1;
    const K = W.KIT.sov;
    out.shlem = W.HATCHES.sv_su122.open.filter(f => f.c === K.shlem || f.c === K.shlemD).length;
    out.paint = V.hull.filter(f => f.c === W.TZC.body).length;
    const E = W.insideOf('sv_su122', V);
    out.eyeUp = +E.eyeUp.z.toFixed(1); out.eyeIn = +E.eyeIn.z.toFixed(1); out.roof = W.S85.zRoof; out.frame = E.frame;
    out.rifle = +W.penVs(W.UNITS.hr_gren.w, 150, t, t.x + 150, t.y).toFixed(2);
    out.p4 = +W.penVs(W.UNITS.hr_p4.w, 300, t, t.x + 300, t.y).toFixed(2);
    const p4 = W.spawnUnit('ger', 'hr_p4', t.x + 300, t.y, Math.PI), pa = W.spawnUnit('ger', 'hr_panther', t.x + 300, t.y + 200, Math.PI);
    out.onP4 = +W.penVs(t.def.w, 300, p4, t.x, t.y).toFixed(2);
    pa.x = t.x + 300; pa.y = t.y; out.paF = +W.penVs(t.def.w, 300, pa, t.x, t.y).toFixed(2);
    pa.facing = Math.PI / 2; pa._matT = -1; out.paS = +W.penVs(t.def.w, 300, pa, t.x, t.y).toFixed(2);
    [p4, pa].forEach(e => G.units.splice(G.units.indexOf(e), 1));
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    G.t = Math.max(G.t, 700);
    G.res[own].mp += 3000; G.res[own].fu += 600;
    ['sv_su76', 'sv_zsu37', 'sv_t20', 'sv_ba64', 'sv_su85', 'sv_bm13', 'sv_bs3'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    ['sv_t34', 'sv_zis3', 'sv_zis2', 'sv_t3485'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    G.made[own].sv_su122 = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    W.__s122q = []; W.__s122U = W.queueUnit;
    W.queueUnit = function (b) { const q = W.__s122U.apply(this, arguments); if (q && b.own === own) W.__s122q.push(b.key + ':' + arguments[1]); return q; };
    return out;
  });
  await fastForward(page, 40);
  const s122Ai = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__s122U; W.slotOf(own).ai = 0;
    return { q: W.__s122q.join(',') || 'nothing' };
  });
  ok('the Red Army\'s Tankovyy park raises the SU-122, a casemate with the 122 mm howitzer behind its mantlet',
     /sv_su122/.test(s122.makes) && s122.q === 'sv_su122' && s122.qMot === 'refused' && s122.bufs && s122.fixed &&
     s122.name === 'SU-122' && s122.sec === 'none' && s122.arc === .35 && Math.abs(Math.abs(s122.tur) - s122.arc / 2) < .03 &&
     s122.shlem > 0 && s122.paint > 0 && s122.frame === 'hull' && s122.eyeUp > s122.roof + 2 && s122.eyeUp < s122.roof + 9 &&
     s122.eyeIn < s122.eyeUp && s122.rifle === 0 && s122.p4 === 1 && s122.onP4 > .5 && s122.paF < s122.paS && s122.blown === 0 &&
     s122.sink > 0 && s122.bodies >= 2 && s122.bodyNat === 'sov' && /sov_tank:sv_su122/.test(s122Ai.q),
     `the Tankovyy park makes ${s122.makes} and queues ${s122.q}, the Avtopark ${s122.qMot} it; buffers ${s122.bufs ? 'built' : 'MISSING'}, ` +
     `${s122.fixed ? 'a casemate' : 'NOT A CASEMATE'}; named ${s122.name}, secondary ${s122.sec}; asked for 1.2 the mount laid ` +
     `${s122.tur} on an arc of ${s122.arc}; the commander has ${s122.shlem} faces of the padded helmet, the hull ${s122.paint} of its ` +
     `green; the eye in the ${s122.frame} at ${s122.eyeUp} head out and ${s122.eyeIn} head in, over a roof at ${s122.roof}; a Kar98k ` +
     `through the front ${s122.rifle} and a Panzer IV ${s122.p4}; its hollow charge through a Panzer IV's front ${s122.onP4}, a ` +
     `Panther's front ${s122.paF} and its side ${s122.paS}; forty wrecks threw ${s122.blown} and sat down ${s122.sink}; killed it ` +
     `left ${s122.bodies} bodies of ${s122.bodyNat}; a brain with the park standing queued ${s122Ai.q}`);

  /* --- The IS-2. The Tankovyy park makes it and queues it, the Avtopark refuses it, and with one
     on the field a second is refused. Every buffer it needs is built, the cupola's three and the
     DShK's among them, it is named the IS-2 with a coaxial DT and tows, its gun is left of the
     middle and the turret asked to lay over the tail comes all the way round. The commander up in
     the cupola wears the padded helmet and the eye is over the roof head out and drops when the
     lid shuts. A Kar98k never goes through its front and a Panzer IV's round goes through its side
     more often than its front; its 122 mm goes through a Panzer IV's front every time at three
     hundred and a Panther's front less often than its side. The DShK fitted is a secondary of its
     own. Forty wrecks throw the turret some of the time, killed it leaves the army's crewmen, and
     a brain on his slot with the park standing and the rungs under it bought buys one. --- */
  const is2 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let tb = G.blds.filter(b => b.own === own && b.key === 'sov_tank' && b.built >= 1)[0];
    if (!tb) { const at = W.baseSite(own, 'sov_tank') || W.nearestFree(hq.x - 200, hq.y + 260); tb = W.spawnBuilding(own, 'sov_tank', at.x, at.y, true); }
    out.makes = W.makesOf(tb).join(',');
    const ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot')[0];
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(tb, 'sv_is2'); out.qMot = ab ? q(ab, 'sv_is2') : 'no Avtopark';
    const B = W.MODELS.veh.sv_is2, V = W.VMODEL.sv_is2;
    out.bufs = !!(B && B.hull && B.tur && B.hatch && B.cmdr && B.leaf && B.mgUp && B.mgUp.dshk);
    out.barY = V.barY || 0;
    const sp = W.nearestFree(hq.x + 220, hq.y + 140), t = W.spawnUnit(own, 'sv_is2', sp.x, sp.y, 0);
    out.q2 = q(tb, 'sv_is2');
    out.name = W.nameOf(t); out.arc = W.arcOf(t) || 0; out.coax = W.secondaryKeys(t).join(','); out.tows = !!t.def.tows;
    W.fitUp(t, 'dshk'); out.dshk = W.secondaryKeys(t).join(',');
    t.facing = 0; t.turret = 0; t.want = 3.1;
    for (let i = 0; i < 100; i++) W.updateModels(t, .2);
    out.tur = +Math.abs(t.turret).toFixed(2);
    t.turret = 0; t._matT = -1;
    const K = W.KIT.sov;
    out.shlem = W.HATCHES.sv_is2.open.filter(f => f.c === K.shlem || f.c === K.shlemD).length;
    out.paint = V.hull.filter(f => f.c === W.TZC.body).length;
    const E = W.VIN.sv_is2(V);
    out.eyeUp = +E.eyeUp.z.toFixed(1); out.eyeIn = +E.eyeIn.z.toFixed(1); out.roof = W.IST.zr; out.frame = E.frame;
    out.rifle = +W.penVs(W.UNITS.hr_gren.w, 150, t, t.x + 150, t.y).toFixed(2);
    out.p4F = +W.penVs(W.UNITS.hr_p4.w, 300, t, t.x + 300, t.y).toFixed(2);
    out.p4S = +W.penVs(W.UNITS.hr_p4.w, 300, t, t.x, t.y + 300).toFixed(2);
    const p4 = W.spawnUnit('ger', 'hr_p4', t.x + 300, t.y, Math.PI), pa = W.spawnUnit('ger', 'hr_panther', t.x + 300, t.y + 200, Math.PI);
    out.onP4 = +W.penVs(t.def.w, 300, p4, t.x, t.y).toFixed(2);
    pa.x = t.x + 300; pa.y = t.y; out.paF = +W.penVs(t.def.w, 300, pa, t.x, t.y).toFixed(2);
    pa.facing = Math.PI / 2; pa._matT = -1; out.paS = +W.penVs(t.def.w, 300, pa, t.x, t.y).toFixed(2);
    [p4, pa].forEach(e => G.units.splice(G.units.indexOf(e), 1));
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    /* the brain on his slot with every rung under the IS-2's written into what the side has
       ordered and none of it, so that what it buys next is the IS-2 */
    G.t = Math.max(G.t, 800);
    G.res[own].mp += 3000; G.res[own].fu += 600;
    ['sv_su76', 'sv_zsu37', 'sv_t20', 'sv_ba64', 'sv_su85', 'sv_su122', 'sv_bm13', 'sv_bs3'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    ['sv_t34', 'sv_zis3', 'sv_zis2', 'sv_t3485'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    G.made[own].sv_is2 = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    W.__is2q = []; W.__is2U = W.queueUnit;
    W.queueUnit = function (b) { const q = W.__is2U.apply(this, arguments); if (q && b.own === own) W.__is2q.push(b.key + ':' + arguments[1]); return q; };
    return out;
  });
  await fastForward(page, 40);
  const is2Ai = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__is2U; W.slotOf(own).ai = 0;
    return { q: W.__is2q.join(',') || 'nothing' };
  });
  ok('the Red Army\'s Tankovyy park raises the IS-2, one at a time, with the 122 mm in its cast turret',
     /sv_is2/.test(is2.makes) && is2.q === 'sv_is2' && is2.qMot === 'refused' && is2.q2 === 'refused' && is2.bufs &&
     is2.name === 'IS-2' && is2.coax === 'coax' && is2.dshk === 'coax,dshk' && is2.tows && !is2.arc && is2.tur > 3.0 &&
     is2.barY < 0 && is2.shlem > 0 && is2.paint > 0 && is2.frame === 'tur' && is2.eyeUp > is2.roof + 2 &&
     is2.eyeUp < is2.roof + 9 && is2.eyeIn < is2.eyeUp && is2.rifle === 0 && is2.p4F < is2.p4S && is2.onP4 === 1 &&
     is2.paF < is2.paS && is2.blown > 0 && is2.blown < 40 && is2.sink > 0 && is2.bodies >= 2 && is2.bodyNat === 'sov' &&
     /sov_tank:sv_is2/.test(is2Ai.q),
     `the Tankovyy park makes ${is2.makes} and queues ${is2.q}, the Avtopark ${is2.qMot} it, a second with one on the field ` +
     `${is2.q2}; buffers ${is2.bufs ? 'built' : 'MISSING'}; named ${is2.name}, secondary ${is2.coax} and with the fitting ` +
     `${is2.dshk}, ${is2.tows ? 'tows' : 'does NOT tow'}, the gun ${is2.barY} off the middle; asked to lay over the tail the turret ` +
     `came to ${is2.tur}${is2.arc ? ' on an ARC of ' + is2.arc : ''}; the commander has ${is2.shlem} faces of the padded helmet, ` +
     `the hull ${is2.paint} of its green; the eye in the ${is2.frame} at ${is2.eyeUp} head out and ${is2.eyeIn} head in, over a ` +
     `roof at ${is2.roof}; a Kar98k through the front ${is2.rifle}, a Panzer IV through the front ${is2.p4F} and the side ` +
     `${is2.p4S}; its 122 mm through a Panzer IV's front ${is2.onP4}, a Panther's front ${is2.paF} and its side ${is2.paS}; ` +
     `forty wrecks threw ${is2.blown} and sat down ${is2.sink}; killed it left ${is2.bodies} bodies of ${is2.bodyNat}; a brain ` +
     `with the park standing queued ${is2Ai.q}`);

  /* --- The ZiS-3, the Red Army's divisional gun, out of the Kazarma: the Kazarma makes it and
     queues it and the Shtab refuses it, and it is six men, the gunner and the loader at the gun
     and four bringing the rounds up a case each. Sited on open ground with a Panzer IV coming at
     it from 520 it has the first round off. Halted, the trails open and the gunner kneels at the
     sight on the left with the loader at the breech on the right, facing it; on the move the
     trails close and the piece rides beside the gunner. With the AP round up it picks the tank
     out of a grenadier squad beside it and nothing at all with the squad alone; with the HE round
     up it reaches further and fires at the squad; and a brain on his slot puts HE up with only
     men in front of it and AP up when a tank comes into reach. A man of it killed goes down as
     one of the crew, and the Red Army's bunker takes it as its anti-tank fitting. --- */
  const zs = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar' && b.built >= 1)[0];
    if (!kb) { const at = W.baseSite(own, 'sov_bar') || W.nearestFree(hq.x, hq.y - 260); kb = W.spawnBuilding(own, 'sov_bar', at.x, at.y, true); }
    out.makes = W.makesOf(kb).join(',');
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(kb, 'sv_zis3'); out.qHq = q(hq, 'sv_zis3');
    const D = W.UNITS.sv_zis3;
    out.name = D.name; out.bunk = W.bunkUnit(W.BUNKUP.at, own);
    /* open ground for the drill, found the way the Pak 38's is */
    const clear = (x, y) => x > 60 && y > 60 && x < W.WORLD.w - 60 && y < W.WORLD.h - 60 && W.walkable(x, y) &&
                            !W.inMasonry(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 60);
    /* and room round it for the crew's places: beside the headquarters the loader's place at the
       breech was inside the building and he stood where he was */
    const roomy = (x, y) => [30, 60].every(rr => [...Array(12).keys()].every(k => {
      const px = x + rr * Math.cos(k * Math.PI / 6), py = y + rr * Math.sin(k * Math.PI / 6);
      return W.walkable(px, py) && !W.inMasonry(px, py);
    }));
    let st = null;
    for (let r = 200; r < 1600 && !st; r += 60)
      for (let k = 0; k < 16 && !st; k++) {
        const ax = hq.x + r * Math.cos(k * Math.PI / 8), ay = hq.y + r * Math.sin(k * Math.PI / 8);
        if (!clear(ax, ay) || !roomy(ax, ay)) continue;
        for (let j = 0; j < 8 && !st; j++) {
          const th = j * Math.PI / 4, bx = ax + 520 * Math.cos(th), by = ay + 520 * Math.sin(th);
          if (!clear(bx, by)) continue;
          let okL = true;
          for (let s = 1; s < 13 && okL; s++) okL = W.walkable(ax + (bx - ax) * s / 13, ay + (by - ay) * s / 13);
          if (okL && W.traceClear(ax, ay, W.groundZ(ax, ay) + 12, bx, by, W.groundZ(bx, by) + 20, W.sblk) &&
              W.traceClear(bx, by, W.groundZ(bx, by) + 20, ax, ay, W.groundZ(ax, ay) + 12, W.sblk)) st = { ax, ay, bx, by, th };
        }
      }
    out.staged = !!st;
    if (st) {
      const a = W.spawnUnit(own, 'sv_zis3', st.ax, st.ay, st.th);
      a.setup = 0; a.packed = false; a.pack = 0; a.order = null; a.dest = null; a.path = null;
      const b = W.spawnUnit('ger', 'hr_p4', st.bx, st.by, st.th + Math.PI);
      b.order = 'attackmove'; b.dest = { x: a.x, y: a.y };
      const seen = new Set(G.shots);
      let t = 0, first = null, bFirst = null;
      const dt = 1 / 20;
      while (t < 40 && !(first && bFirst)) {
        G.t += dt; t += dt;
        W.computeVisibility(dt);
        W.updateUnit(a, dt); W.updateUnit(b, dt); W.updateModels(a, dt);
        W.updateShots(dt);
        for (const s of G.shots) {
          if (seen.has(s)) continue;
          seen.add(s);
          const d = Math.round(Math.hypot(a.x - b.x, a.y - b.y));
          if (s.owner === a && !first) first = { t: +t.toFixed(1), d, found: +(a.detGer || 0).toFixed(2) };
          if (s.owner === b && !bFirst) bFirst = { t: +t.toFixed(1), d };
        }
        if (a.dead || b.dead) break;
      }
      out.first = first; out.bFirst = bFirst;
      G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
      G.units.length = 0; G.shots.length = 0;
    }
    /* the six of them, set up and walking, on open ground away from cover */
    let at = null;
    for (let r = 0; r < 900 && !at; r += 40)
      for (let k = 0; k < 16 && !at; k++) {
        const x0 = st ? st.ax : hq.x, y0 = st ? st.ay : hq.y;
        const x = x0 + r * Math.cos(k * Math.PI / 8), y = y0 + r * Math.sin(k * Math.PI / 8);
        if (clear(x, y) && roomy(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 140)) at = { x, y };
      }
    out.open = !!at;
    if (!at) at = W.nearestFree(hq.x + 200, hq.y);
    const u = W.spawnUnit(own, 'sv_zis3', at.x, at.y, 0);
    out.men = u.models.length;
    out.baked = ['sv_atg', 'sv_atb', 'sv_atb_b'].every(v => W.MODELS.man[v] && W.MODELS.man[v][W.POSE_STAND] && W.MODELS.man[v][W.POSE_WALK]) &&
                !!(W.MODELS.served.sv_zis3 && W.MODELS.served.sv_zis3.mate) && !!(W.MODELS.gunRec.sv_zis3 && W.MODELS.gunPk.sv_zis3);
    const step = function (s) { for (let i = 0; i < s * 30; i++) { G.t += 1 / 30; W.updateUnit(u, 1 / 30); W.updateModels(u, 1 / 30); } };
    u.setup = 0; u.packed = false; u.pack = 0;
    step(4);
    out.set = W.gunSet(u);
    out.vars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.poses = u.models.map(m => m.pose).join(',');
    const gp = W.gunPost(u), cs = Math.cos(u.facing), sn = Math.sin(u.facing);
    const rel = m => { const dx = m.x - gp.x, dy = m.y - gp.y; return [(dx * cs + dy * sn) / W.FIG_SCALE, (-dx * sn + dy * cs) / W.FIG_SCALE]; };
    const r1 = rel(u.models[1]);
    out.loader = r1.map(v => +v.toFixed(1)).join(',');
    out.loaderRight = r1[1] > 2 && r1[0] < -6;
    out.loaderFaces = Math.abs(W.angDiff(u.models[1].f, u.facing - Math.PI / 2)) < .25;
    out.bearers = u.coverSlots && u.coverSlots[2] ? 'cover' : [2, 3, 4, 5].every(i => rel(u.models[i])[0] < -10);
    out.bpos = [2, 3, 4, 5].map(i => rel(u.models[i]).map(q => Math.round(q)).join(',')).join(' ');
    out.mesh = W.teamMesh(u) === W.MODELS.gun.sv_zis3;
    const mz = W.muzzlePoint(u, u.models[0], 0);
    out.muz = Math.hypot(mz.x - gp.x - Math.cos(u.facing) * D.gunMuz[0] * W.FIG_SCALE, mz.y - gp.y - Math.sin(u.facing) * D.gunMuz[0] * W.FIG_SCALE) < 1;
    out.box = (W.mgCarryAt(u, u.models[2], 2, 'sv_atb') ? W._mgc.buf : null) === W.MODELS.carry.box76;
    u.packed = true;
    out.packMesh = W.teamMesh(u) === W.MODELS.gunPk.sv_zis3;
    const gq = W.gunPost(u), g0 = u.models[0];
    out.runs = +(Math.hypot(gq.x - g0.x, gq.y - g0.y) / W.FIG_SCALE).toFixed(1);
    u.packed = false;
    /* a man of it goes down as one of the crew */
    const mk = u.models[2], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, mk, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.bodyNat = rec ? rec.nat : '-';
    out.fall = !!(W.MODELS.fall.sov_at && W.MODELS.dead.sov_at);
    W.killUnit(u);
    G.units.length = 0;
    /* the two rounds, on the drill's own line, which was traced clear both ways: a grenadier squad
       280 out alone and then with a Panzer IV behind it, under the AP round and then the HE. Put
       down three hundred out on whatever bearing the gun faced, a house or a rise was in the way
       on one run and the gun picked nothing at all */
    const ln = st || { ax: at.x, ay: at.y, th: 0 };
    const v = W.spawnUnit(own, 'sv_zis3', ln.ax, ln.ay, ln.th);
    v.setup = 0; v.packed = false; v.pack = 0; v.facing = ln.th; v.order = null; v.path = null;
    const along = d => ({ x: ln.ax + Math.cos(ln.th) * d, y: ln.ay + Math.sin(ln.th) * d });
    const gp0 = along(280), tp0 = along(340);
    const g = W.spawnUnit('ger', 'hr_gren', gp0.x, gp0.y, ln.th + Math.PI);
    const see = e => { e.vUs = true; e.detUs = 1; };
    see(g);
    v.up = {}; v.forced = null; v.target = null;
    out.apMen = (W.acquire(v) || { key: 'nothing' }).key;
    const tk = W.spawnUnit('ger', 'hr_p4', tp0.x, tp0.y, ln.th + Math.PI); see(tk);
    out.apBoth = (W.acquire(v) || { key: 'nothing' }).key;
    W.setRound([v], true);
    const hw = W.mainW(v);
    out.he = hw.dmg + '/' + hw.aoe + '/' + hw.range;
    out.heBoth = (W.acquire(v) || { key: 'nothing' }).key;
    W.setRound([v], false);
    out.apRange = W.mainW(v).range;
    G.units.splice(G.units.indexOf(tk), 1);
    /* the brain on his slot picks the round off what is in front of the gun */
    v.up = {}; v.setup = 0; v.packed = false;
    W.__zsU = v; W.__zsT0 = tp0; W.__zsAi = W.slotOf('ger').ai; W.slotOf('ger').ai = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    return out;
  });
  await fastForward(page, 4);
  const zsAi = await page.evaluate(() => {
    const W = window, G = W.G, u = W.__zsU, out = {};
    out.menOnly = !!(u.up && u.up.he);
    const tk = W.spawnUnit('ger', 'hr_p4', W.__zsT0.x, W.__zsT0.y, u.facing + Math.PI);
    tk.vUs = true; tk.detUs = 1; tk.hp = tk.maxHp = 1e6; W.__zsT = tk;
    return out;
  });
  await fastForward(page, 4);
  const zsAi2 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, u = W.__zsU, out = {};
    out.withTank = !(u.up && u.up.he);
    W.slotOf(own).ai = 0; W.slotOf('ger').ai = W.__zsAi;
    G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    G.units.length = 0;
    return out;
  });
  const fzs = zs.first, bzs = zs.bFirst;
  ok('the Red Army\'s Kazarma raises the ZiS-3, with six men, an AP round for armour and an HE round for anything',
     /sv_zis3/.test(zs.makes) && zs.q === 'sv_zis3' && zs.qHq === 'refused' && zs.name === '76 mm ZiS-3' && zs.bunk === 'sv_zis3' &&
     zs.staged && !!fzs && (!bzs || bzs.t >= fzs.t + 1) && fzs.found < 1 &&
     zs.men === 6 && zs.baked && zs.set && zs.vars === 'sv_atg,sv_atg,sv_atb,sv_atb_b,sv_atb,sv_atb_b' && /^11,11,/.test(zs.poses) &&
     zs.loaderRight && zs.loaderFaces && zs.bearers && zs.mesh && zs.muz && zs.box && zs.packMesh && zs.runs > 8 && zs.runs < 12 &&
     zs.apMen === 'nothing' && zs.apBoth === 'hr_p4' && zs.he === '90/45/600' && zs.heBoth === 'hr_gren' && zs.apRange === 540 &&
     zsAi.menOnly && zsAi2.withTank && zs.bodyNat === 'sov_at' && zs.fall,
     `the Kazarma makes ${zs.makes} and queues ${zs.q}, the Shtab ${zs.qHq} it; named ${zs.name}, the bunker's anti-tank fitting ` +
     `${zs.bunk}; ` + (zs.staged ? `sited against a Panzer IV at 520 it fired ${fzs ? 'at ' + fzs.t + ' s from ' + fzs.d + ' with the tank ' + (fzs.found < 1 ? 'yet to find it (' + fzs.found + ')' : 'ALREADY on it') : 'NEVER'} ` +
       `and the tank ${bzs ? 'answered at ' + bzs.t + ' s from ' + bzs.d : 'never fired'}; ` : 'NO open ground to stage the drill on; ') +
     `${zs.men} men, the variants, the served bodies and the three meshes ${zs.baked ? 'baked' : 'NOT baked'}; halted ` +
     `${zs.set ? 'set up' : 'NOT set up'} as ${zs.vars} in poses ${zs.poses}, the loader at ${zs.loader} ${zs.loaderRight ? 'on the right' : 'NOT on the right'} ` +
     `and ${zs.loaderFaces ? 'facing the breech' : 'NOT facing it'}${zs.open ? '' : ' (no open ground)'}, the bearers ` +
     `${zs.bearers === 'cover' ? 'in cover' : zs.bearers ? 'back behind the gun' : 'NOT in place (' + zs.bpos + ')'}, the piece ${zs.mesh ? 'open' : 'WRONG'}, ` +
     `the flash ${zs.muz ? 'at the muzzle' : 'OFF the muzzle'}, a bearer's case ${zs.box ? 'in his hand' : 'MISSING'}; packed the trails ` +
     `${zs.packMesh ? 'closed' : 'NOT closed'} and the piece ${zs.runs} from the gunner; with AP up it picked ${zs.apMen} with the squad alone ` +
     `and ${zs.apBoth} with the tank beside it, with HE up (${zs.he}) ${zs.heBoth}, and AP reaches ${zs.apRange}; the brain put HE up ` +
     `${zsAi.menOnly ? 'with men in front' : 'NOT with men in front'} and AP ${zsAi2.withTank ? 'with the tank in reach' : 'NOT with the tank in reach'}; ` +
     `killed went down as ${zs.bodyNat}, bodies ${zs.fall ? 'baked' : 'MISSING'}`);

  /* --- The ZiS-2, the Red Army's anti-tank gun, out of the Avtopark: the Avtopark makes it and
     queues it and the Kazarma refuses it, and it is the ZiS-3's six men on the ZiS-3's carriage
     with its own long tube. Sited on open ground with a Panzer IV coming at it from 520 it has the
     first round off, before the tank has found it. Halted, the loader kneels at the right of the
     breech facing it and the bearers are back behind the gun, the flash comes off the muzzle and a
     bearer has his case in his hand; packed, the trails close. It has the AP round alone: it picks
     nothing out of a grenadier squad and the Panzer IV out of the two, out to 620. A T-20 hitches
     it. A man killed goes down as one of the crew, and a brain on his slot with the Avtopark
     standing buys one. --- */
  const z2 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar' && b.built >= 1)[0];
    if (!kb) { const at = W.baseSite(own, 'sov_bar') || W.nearestFree(hq.x, hq.y - 260); kb = W.spawnBuilding(own, 'sov_bar', at.x, at.y, true); }
    let ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot' && b.built >= 1)[0];
    if (!ab) { const at = W.baseSite(own, 'sov_mot') || W.nearestFree(hq.x, hq.y + 260); ab = W.spawnBuilding(own, 'sov_mot', at.x, at.y, true); }
    out.makes = W.makesOf(ab).join(',');
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(ab, 'sv_zis2'); out.qKaz = q(kb, 'sv_zis2');
    const D = W.UNITS.sv_zis2;
    out.name = D.name;
    const clear = (x, y) => x > 60 && y > 60 && x < W.WORLD.w - 60 && y < W.WORLD.h - 60 && W.walkable(x, y) &&
                            !W.inMasonry(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 60);
    const roomy = (x, y) => [30, 60].every(rr => [...Array(12).keys()].every(k => {
      const px = x + rr * Math.cos(k * Math.PI / 6), py = y + rr * Math.sin(k * Math.PI / 6);
      return W.walkable(px, py) && !W.inMasonry(px, py);
    }));
    let st = null;
    for (let r = 200; r < 1600 && !st; r += 60)
      for (let k = 0; k < 16 && !st; k++) {
        const ax = hq.x + r * Math.cos(k * Math.PI / 8), ay = hq.y + r * Math.sin(k * Math.PI / 8);
        if (!clear(ax, ay) || !roomy(ax, ay)) continue;
        for (let j = 0; j < 8 && !st; j++) {
          const th = j * Math.PI / 4, bx = ax + 520 * Math.cos(th), by = ay + 520 * Math.sin(th);
          if (!clear(bx, by)) continue;
          let okL = true;
          for (let s = 1; s < 13 && okL; s++) okL = W.walkable(ax + (bx - ax) * s / 13, ay + (by - ay) * s / 13);
          if (okL && W.traceClear(ax, ay, W.groundZ(ax, ay) + 12, bx, by, W.groundZ(bx, by) + 20, W.sblk) &&
              W.traceClear(bx, by, W.groundZ(bx, by) + 20, ax, ay, W.groundZ(ax, ay) + 12, W.sblk)) st = { ax, ay, bx, by, th };
        }
      }
    out.staged = !!st;
    if (st) {
      const a = W.spawnUnit(own, 'sv_zis2', st.ax, st.ay, st.th);
      a.setup = 0; a.packed = false; a.pack = 0; a.order = null; a.dest = null; a.path = null;
      const b = W.spawnUnit('ger', 'hr_p4', st.bx, st.by, st.th + Math.PI);
      b.order = 'attackmove'; b.dest = { x: a.x, y: a.y };
      const seen = new Set(G.shots);
      let t = 0, first = null, bFirst = null;
      const dt = 1 / 20;
      while (t < 40 && !(first && bFirst)) {
        G.t += dt; t += dt;
        W.computeVisibility(dt);
        W.updateUnit(a, dt); W.updateUnit(b, dt); W.updateModels(a, dt);
        W.updateShots(dt);
        for (const s of G.shots) {
          if (seen.has(s)) continue;
          seen.add(s);
          const d = Math.round(Math.hypot(a.x - b.x, a.y - b.y));
          if (s.owner === a && !first) first = { t: +t.toFixed(1), d, found: +(a.detGer || 0).toFixed(2) };
          if (s.owner === b && !bFirst) bFirst = { t: +t.toFixed(1), d };
        }
        if (a.dead || b.dead) break;
      }
      out.first = first; out.bFirst = bFirst;
      G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
      G.units.length = 0; G.shots.length = 0;
    }
    let at = null;
    for (let r = 0; r < 900 && !at; r += 40)
      for (let k = 0; k < 16 && !at; k++) {
        const x0 = st ? st.ax : hq.x, y0 = st ? st.ay : hq.y;
        const x = x0 + r * Math.cos(k * Math.PI / 8), y = y0 + r * Math.sin(k * Math.PI / 8);
        if (clear(x, y) && roomy(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 140)) at = { x, y };
      }
    if (!at) at = W.nearestFree(hq.x + 200, hq.y);
    const u = W.spawnUnit(own, 'sv_zis2', at.x, at.y, 0);
    out.men = u.models.length;
    out.baked = !!(W.MODELS.served.sv_zis2 && W.MODELS.served.sv_zis2.mate) && !!(W.MODELS.gunRec.sv_zis2 && W.MODELS.gunPk.sv_zis2);
    const step = function (s) { for (let i = 0; i < s * 30; i++) { G.t += 1 / 30; W.updateUnit(u, 1 / 30); W.updateModels(u, 1 / 30); } };
    u.setup = 0; u.packed = false; u.pack = 0;
    step(4);
    out.set = W.gunSet(u);
    out.vars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    const gp = W.gunPost(u), cs = Math.cos(u.facing), sn = Math.sin(u.facing);
    const rel = m => { const dx = m.x - gp.x, dy = m.y - gp.y; return [(dx * cs + dy * sn) / W.FIG_SCALE, (-dx * sn + dy * cs) / W.FIG_SCALE]; };
    const r1 = rel(u.models[1]);
    out.loader = r1.map(v => +v.toFixed(1)).join(',');
    out.loaderRight = r1[1] > 2 && r1[0] < -6;
    out.loaderFaces = Math.abs(W.angDiff(u.models[1].f, u.facing - Math.PI / 2)) < .25;
    out.bearers = u.coverSlots && u.coverSlots[2] ? 'cover' : [2, 3, 4, 5].every(i => rel(u.models[i])[0] < -10);
    out.bpos = [2, 3, 4, 5].map(i => rel(u.models[i]).map(q => Math.round(q)).join(',')).join(' ');
    out.mesh = W.teamMesh(u) === W.MODELS.gun.sv_zis2;
    const mz = W.muzzlePoint(u, u.models[0], 0);
    out.muz = Math.hypot(mz.x - gp.x - Math.cos(u.facing) * D.gunMuz[0] * W.FIG_SCALE, mz.y - gp.y - Math.sin(u.facing) * D.gunMuz[0] * W.FIG_SCALE) < 1;
    out.box = (W.mgCarryAt(u, u.models[2], 2, 'sv_atb') ? W._mgc.buf : null) === W.MODELS.carry.box76;
    u.packed = true;
    out.packMesh = W.teamMesh(u) === W.MODELS.gunPk.sv_zis2;
    u.packed = false;
    /* a T-20 hitches it */
    const tw = W.spawnUnit(own, 'sv_t20', u.x + 90, u.y, 0);
    out.canHitch = W.canHitch(tw, u);
    W.hitchGun(tw, u);
    out.towed = u.towedBy === tw;
    W.unhitchGun(tw); W.killUnit(tw);
    const mk = u.models[2], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, mk, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.bodyNat = rec ? rec.nat : '-';
    W.killUnit(u);
    G.units.length = 0;
    const ln = st || { ax: at.x, ay: at.y, th: 0 };
    const v = W.spawnUnit(own, 'sv_zis2', ln.ax, ln.ay, ln.th);
    v.setup = 0; v.packed = false; v.pack = 0; v.facing = ln.th; v.order = null; v.path = null;
    const along = d => ({ x: ln.ax + Math.cos(ln.th) * d, y: ln.ay + Math.sin(ln.th) * d });
    const gp0 = along(280), tp0 = along(340);
    const g = W.spawnUnit('ger', 'hr_gren', gp0.x, gp0.y, ln.th + Math.PI);
    const see = e => { e.vUs = true; e.detUs = 1; };
    see(g);
    v.up = {}; v.forced = null; v.target = null;
    out.apMen = (W.acquire(v) || { key: 'nothing' }).key;
    const tk = W.spawnUnit('ger', 'hr_p4', tp0.x, tp0.y, ln.th + Math.PI); see(tk);
    out.apBoth = (W.acquire(v) || { key: 'nothing' }).key;
    out.range = W.mainW(v).range;
    G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    G.units.length = 0;
    /* the brain on his slot, with the Avtopark standing and the rungs under the ZiS-2's bought */
    G.t = Math.max(G.t, 700);
    G.res[own].mp += 3000; G.res[own].fu += 600;
    ['sv_su76', 'sv_zsu37', 'sv_t20', 'sv_ba64', 'sv_bs3'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    G.made[own].sv_zis3 = Math.max(2, G.made[own].sv_zis3 || 0); G.made[own].sv_zis2 = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    W.__z2q = []; W.__z2U = W.queueUnit;
    W.queueUnit = function (b) { const q = W.__z2U.apply(this, arguments); if (q && b.own === own) W.__z2q.push(b.key + ':' + arguments[1]); return q; };
    return out;
  });
  await fastForward(page, 40);
  const z2Ai = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__z2U; W.slotOf(own).ai = 0;
    W.G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    W.G.units.length = 0;
    return { q: W.__z2q.join(',') || 'nothing' };
  });
  const fz2 = z2.first, bz2 = z2.bFirst;
  ok('the Red Army\'s Avtopark raises the ZiS-2, the ZiS-3\'s carriage and crew with a long 57 mm tube',
     /sv_zis2/.test(z2.makes) && z2.q === 'sv_zis2' && z2.qKaz === 'refused' && z2.name === '57 mm ZiS-2' &&
     z2.staged && !!fz2 && (!bz2 || bz2.t >= fz2.t + 1) && fz2.found < 1 &&
     z2.men === 6 && z2.baked && z2.set && z2.vars === 'sv_atg,sv_atg,sv_atb,sv_atb_b,sv_atb,sv_atb_b' &&
     z2.loaderRight && z2.loaderFaces && z2.bearers && z2.mesh && z2.muz && z2.box && z2.packMesh && z2.canHitch && z2.towed &&
     z2.apMen === 'nothing' && z2.apBoth === 'hr_p4' && z2.range === 620 && z2.bodyNat === 'sov_at' && /sov_mot:sv_zis2/.test(z2Ai.q),
     `the Avtopark makes ${z2.makes} and queues ${z2.q}, the Kazarma ${z2.qKaz} it; named ${z2.name}; ` +
     (z2.staged ? `sited against a Panzer IV at 520 it fired ${fz2 ? 'at ' + fz2.t + ' s from ' + fz2.d + ' with the tank ' + (fz2.found < 1 ? 'yet to find it (' + fz2.found + ')' : 'ALREADY on it') : 'NEVER'} ` +
       `and the tank ${bz2 ? 'answered at ' + bz2.t + ' s from ' + bz2.d : 'never fired'}; ` : 'NO open ground to stage the drill on; ') +
     `${z2.men} men, the served bodies and the three meshes ${z2.baked ? 'baked' : 'NOT baked'}; halted ${z2.set ? 'set up' : 'NOT set up'} ` +
     `as ${z2.vars}, the loader at ${z2.loader} ${z2.loaderRight ? 'on the right' : 'NOT on the right'} and ${z2.loaderFaces ? 'facing the breech' : 'NOT facing it'}, ` +
     `the bearers ${z2.bearers === 'cover' ? 'in cover' : z2.bearers ? 'back behind the gun' : 'NOT in place (' + z2.bpos + ')'}, the piece ` +
     `${z2.mesh ? 'open' : 'WRONG'}, the flash ${z2.muz ? 'at the muzzle' : 'OFF the muzzle'}, a bearer's case ${z2.box ? 'in his hand' : 'MISSING'}; ` +
     `packed the trails ${z2.packMesh ? 'closed' : 'NOT closed'}; a T-20 ${z2.canHitch ? 'may' : 'may NOT'} hitch it and ${z2.towed ? 'did' : 'DID NOT'}; ` +
     `it picked ${z2.apMen} with the squad alone and ${z2.apBoth} with the tank beside it, out to ${z2.range}; killed went down as ` +
     `${z2.bodyNat}; a brain with the Avtopark standing queued ${z2Ai.q}`);

  /* --- The BM-13N Katyusha, out of the Avtopark. The Avtopark makes it and queues it and the
     Kazarma refuses it; every buffer it needs is built, the rack, the two screws, the rockets lying
     on the rails and the M-13 in the air; it is a soft lorry named the BM-13N Katyusha with a
     traverse of ten degrees either way. Laid on a point six hundred off and square to it, it brings
     the truck round, lays the rack up to the elevation the range asks for before the first rocket
     leaves, and fires all sixteen, every one bent onto its mark and leaving its rail along the rail;
     the rails are empty after it with the reload begun, and smoke is refused. Forty wrecks throw
     nothing, killed it leaves the army's crewmen, and a brain on his slot with the Avtopark standing
     and the rungs under it bought buys one. The bursts are switched off, for the reason the
     Calliope's are. --- */
  const bm = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {}, dt = 1 / 30;
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot' && b.built >= 1)[0];
    if (!ab) { const at = W.baseSite(own, 'sov_mot') || W.nearestFree(hq.x - 200, hq.y - 260); ab = W.spawnBuilding(own, 'sov_mot', at.x, at.y, true); }
    out.makes = W.makesOf(ab).join(',');
    const kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar')[0];
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(ab, 'sv_bm13'); out.qKaz = kb ? q(kb, 'sv_bm13') : 'no Kazarma';
    const B = W.MODELS.veh.sv_bm13, V = W.VMODEL.sv_bm13;
    out.bufs = !!(B && B.hull && B.tur && B.elv && B.elv.rack && B.lk && B.lk.length === 2 && B.rkLoad && W.MODELS.rkt && W.MODELS.rkt.m13);
    out.soft = !!V.soft && !!(W.ARM.sv_bm13 && W.ARM.sv_bm13.soft);
    out.load = V.rkLoad.p.length;
    const boom = W.explode;
    W.explode = function () {};
    const sp = W.nearestFree(hq.x + 260, hq.y), u = W.spawnUnit(own, 'sv_bm13', sp.x, sp.y, 0);
    u.setup = 0;
    out.name = W.nameOf(u); out.arc = +(W.arcOf(u) || 0).toFixed(2);
    let a = u.facing + Math.PI / 2, tx = u.x + Math.cos(a) * 600, ty = u.y + Math.sin(a) * 600;
    if (ty < 80 || ty > W.WORLD.h - 80) { a = u.facing - Math.PI / 2; tx = u.x + Math.cos(a) * 600; ty = u.y + Math.sin(a) * 600; }
    const f0 = u.facing;
    out.ok = !!W.orderBarrage(u, tx, ty); out.n = u.barrage ? u.barrage.left : 0;
    let elAt = -1, rk = 0, bent = 0, off = 0, z0 = 1e9;
    const seen = new Set(), tubes = [], rl = W.rkLaunch;
    W.rkLaunch = function (v) { const L = rl(v); if (L && v === u) tubes.push(L); return L; };
    for (let i = 0; i < 30 * 50 && u.barrage; i++) {
      W.updateUnit(u, dt); W.updateModels(u, dt);
      G.shots.forEach(s => {
        if (s.rk !== 'm13' || s.owner !== u || seen.has(s)) return;
        seen.add(s); rk++; if (s.cx !== undefined) bent++; z0 = Math.min(z0, s.z0);
        if (elAt < 0) elAt = +(u.el || 0).toFixed(3);
        const A = W.rocketAt(s), L = Math.atan2(A.dz, Math.hypot(A.dx, A.dy)), T = tubes.shift();
        off = T ? Math.max(off, Math.abs(L - T.el), Math.abs(W.angDiff(Math.atan2(A.dy, A.dx), T.a))) : 9;
      });
      W.updateShots(dt); G.t += dt;
    }
    W.rkLaunch = rl;
    out.rk = rk; out.bent = bent; out.el = elAt; out.want = +(u.elWant || 0).toFixed(3); out.off = +off.toFixed(3); out.z0 = +z0.toFixed(1);
    out.turn = +Math.abs(W.angDiff(u.facing, f0)).toFixed(2); out.rack = u.rack; out.reload = +(u.reload || 0).toFixed(0);
    out.smoke = W.orderBarrage(u, tx, ty, true) ? 'TAKEN' : 'refused';
    W.explode = boom;
    G.shots.length = 0;
    const nw = G.wrecks.length;
    let blown = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(u); if (w.blown) blown++; }
    G.wrecks.length = nw;
    out.blown = blown;
    const nc = G.corpses.length;
    W.killUnit(u);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    G.units.slice().forEach(q2 => { if (!q2.dead) W.killUnit(q2); });
    G.units.length = 0;
    /* the brain on his slot, with the Avtopark standing and the rungs ahead of the lorry's and the park's
       written into what the side has ordered: a park standing from the rows above would otherwise sell it
       whatever the brain brings forward against a heavy */
    G.t = Math.max(G.t, 700);
    G.res[own].mp += 3000; G.res[own].fu += 600;
    ['sv_su76', 'sv_zsu37', 'sv_t20', 'sv_ba64', 'sv_su85', 'sv_su122', 'sv_is2', 'sv_bs3'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    ['sv_zis3', 'sv_zis2', 'sv_t34', 'sv_t3485'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    G.made[own].sv_bm13 = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    W.__bmq = []; W.__bmU = W.queueUnit;
    W.queueUnit = function (b) { const r = W.__bmU.apply(this, arguments); if (r && b.own === own) W.__bmq.push(b.key + ':' + arguments[1]); return r; };
    return out;
  });
  await fastForward(page, 40);
  const bmAi = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__bmU; W.slotOf(own).ai = 0;
    W.G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    W.G.units.length = 0;
    return { q: W.__bmq.join(',') || 'nothing' };
  });
  ok('the Red Army\'s Avtopark raises the BM-13N Katyusha, and it fires its sixteen rockets off the rails on a mission',
     /sv_bm13/.test(bm.makes) && bm.q === 'sv_bm13' && bm.qKaz === 'refused' && bm.bufs && bm.soft && bm.load === 16 &&
     bm.name === 'BM-13N Katyusha' && bm.arc === .35 && bm.ok && bm.n === 16 && bm.rk === 16 && bm.bent === 16 &&
     bm.el > .15 && Math.abs(bm.el - bm.want) < .025 && bm.off < .08 && bm.z0 > 20 && bm.turn > .9 && bm.rack === 0 &&
     bm.reload > 50 && bm.smoke === 'refused' && bm.blown === 0 && bm.bodies >= 1 && bm.bodyNat === 'sov' &&
     /sov_mot:sv_bm13/.test(bmAi.q),
     `the Avtopark makes ${bm.makes} and queues ${bm.q}, the Kazarma ${bm.qKaz} it; buffers ${bm.bufs ? 'built' : 'MISSING'}, ` +
     `${bm.soft ? 'soft' : 'NOT SOFT'}, ${bm.load} rockets on the rails; named ${bm.name} on an arc of ${bm.arc}; it laid ` +
     `${bm.ok ? '' : 'NOT '}a mission of ${bm.n}, turning ${bm.turn}, the first rocket away at ${bm.el} of elevation against ` +
     `${bm.want} wanted, ${bm.rk} rockets of which ${bm.bent} bent onto their marks, the worst leaving ${bm.off} off its rail, from ` +
     `${bm.z0} up; ${bm.rack} left on the rails, reloading for ${bm.reload} s, smoke ${bm.smoke}; forty wrecks threw ${bm.blown}; ` +
     `killed it left ${bm.bodies} bodies of ${bm.bodyNat}; a brain with the Avtopark standing queued ${bmAi.q}`);

  /* --- The BS-3, the Red Army's heavy anti-tank gun, out of the Avtopark: the Avtopark makes it
     and queues it and the Kazarma refuses it, and it is seven men on its own carriage with the tube
     at two thirds of a metre over the ZiS-3's. Sited on open ground with a Panther coming at it from
     560 it has the first round off, before the tank has found it. Halted, the gunner stands bent at
     the sight and the loader stands at the right of the breech facing it, the bearers are back
     behind the gun, the flash comes off the muzzle and a bearer has his case in his hand; packed,
     the trails close. It has the AP round alone and picks nothing out of a grenadier squad and the
     Panzer IV out of the two, out to 680. A T-20 hitches it. A man killed goes down as one of the
     crew, and a brain on his slot with the Avtopark standing and the rungs under it bought buys
     one. --- */
  const b3 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar' && b.built >= 1)[0];
    if (!kb) { const at = W.baseSite(own, 'sov_bar') || W.nearestFree(hq.x, hq.y - 260); kb = W.spawnBuilding(own, 'sov_bar', at.x, at.y, true); }
    let ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot' && b.built >= 1)[0];
    if (!ab) { const at = W.baseSite(own, 'sov_mot') || W.nearestFree(hq.x, hq.y + 260); ab = W.spawnBuilding(own, 'sov_mot', at.x, at.y, true); }
    out.makes = W.makesOf(ab).join(',');
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(ab, 'sv_bs3'); out.qKaz = q(kb, 'sv_bs3');
    const D = W.UNITS.sv_bs3;
    out.name = D.name;
    const clear = (x, y) => x > 60 && y > 60 && x < W.WORLD.w - 60 && y < W.WORLD.h - 60 && W.walkable(x, y) &&
                            !W.inMasonry(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 60);
    const roomy = (x, y) => [30, 60].every(rr => [...Array(12).keys()].every(k => {
      const px = x + rr * Math.cos(k * Math.PI / 6), py = y + rr * Math.sin(k * Math.PI / 6);
      return W.walkable(px, py) && !W.inMasonry(px, py);
    }));
    let st = null;
    for (let r = 200; r < 1600 && !st; r += 60)
      for (let k = 0; k < 16 && !st; k++) {
        const ax = hq.x + r * Math.cos(k * Math.PI / 8), ay = hq.y + r * Math.sin(k * Math.PI / 8);
        if (!clear(ax, ay) || !roomy(ax, ay)) continue;
        for (let j = 0; j < 8 && !st; j++) {
          const th = j * Math.PI / 4, bx = ax + 560 * Math.cos(th), by = ay + 560 * Math.sin(th);
          if (!clear(bx, by)) continue;
          let okL = true;
          for (let s = 1; s < 14 && okL; s++) okL = W.walkable(ax + (bx - ax) * s / 14, ay + (by - ay) * s / 14);
          if (okL && W.traceClear(ax, ay, W.groundZ(ax, ay) + 16, bx, by, W.groundZ(bx, by) + 20, W.sblk) &&
              W.traceClear(bx, by, W.groundZ(bx, by) + 20, ax, ay, W.groundZ(ax, ay) + 16, W.sblk)) st = { ax, ay, bx, by, th };
        }
      }
    out.staged = !!st;
    if (st) {
      const a = W.spawnUnit(own, 'sv_bs3', st.ax, st.ay, st.th);
      a.setup = 0; a.packed = false; a.pack = 0; a.order = null; a.dest = null; a.path = null;
      const b = W.spawnUnit('ger', 'hr_panther', st.bx, st.by, st.th + Math.PI);
      b.order = 'attackmove'; b.dest = { x: a.x, y: a.y };
      const seen = new Set(G.shots);
      let t = 0, first = null, bFirst = null;
      const dt = 1 / 20;
      while (t < 40 && !(first && bFirst)) {
        G.t += dt; t += dt;
        W.computeVisibility(dt);
        W.updateUnit(a, dt); W.updateUnit(b, dt); W.updateModels(a, dt);
        W.updateShots(dt);
        for (const s of G.shots) {
          if (seen.has(s)) continue;
          seen.add(s);
          const d = Math.round(Math.hypot(a.x - b.x, a.y - b.y));
          if (s.owner === a && !first) first = { t: +t.toFixed(1), d, found: +(a.detGer || 0).toFixed(2) };
          if (s.owner === b && !bFirst) bFirst = { t: +t.toFixed(1), d };
        }
        if (a.dead || b.dead) break;
      }
      out.first = first; out.bFirst = bFirst;
      G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
      G.units.length = 0; G.shots.length = 0;
    }
    let at = null;
    for (let r = 0; r < 900 && !at; r += 40)
      for (let k = 0; k < 16 && !at; k++) {
        const x0 = st ? st.ax : hq.x, y0 = st ? st.ay : hq.y;
        const x = x0 + r * Math.cos(k * Math.PI / 8), y = y0 + r * Math.sin(k * Math.PI / 8);
        if (clear(x, y) && roomy(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 140)) at = { x, y };
      }
    if (!at) at = W.nearestFree(hq.x + 200, hq.y);
    const u = W.spawnUnit(own, 'sv_bs3', at.x, at.y, 0);
    out.men = u.models.length;
    out.baked = !!(W.MODELS.served.sv_bs3 && W.MODELS.served.sv_bs3.mate) && !!(W.MODELS.gunRec.sv_bs3 && W.MODELS.gunPk.sv_bs3);
    const step = function (s) { for (let i = 0; i < s * 30; i++) { G.t += 1 / 30; W.updateUnit(u, 1 / 30); W.updateModels(u, 1 / 30); } };
    u.setup = 0; u.packed = false; u.pack = 0;
    step(4);
    out.set = W.gunSet(u);
    out.vars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    const gp = W.gunPost(u), cs = Math.cos(u.facing), sn = Math.sin(u.facing);
    const rel = m => { const dx = m.x - gp.x, dy = m.y - gp.y; return [(dx * cs + dy * sn) / W.FIG_SCALE, (-dx * sn + dy * cs) / W.FIG_SCALE]; };
    const r1 = rel(u.models[1]);
    out.loader = r1.map(v => +v.toFixed(1)).join(',');
    out.loaderRight = r1[1] > 2 && r1[0] < -2;
    out.loaderFaces = Math.abs(W.angDiff(u.models[1].f, u.facing - Math.PI / 2)) < .25;
    out.bearers = u.coverSlots && u.coverSlots[2] ? 'cover' : [2, 3, 4, 5, 6].every(i => rel(u.models[i])[0] < -10);
    out.bpos = [2, 3, 4, 5, 6].map(i => rel(u.models[i]).map(q => Math.round(q)).join(',')).join(' ');
    out.mesh = W.teamMesh(u) === W.MODELS.gun.sv_bs3;
    const mz = W.muzzlePoint(u, u.models[0], 0);
    out.muz = Math.hypot(mz.x - gp.x - Math.cos(u.facing) * D.gunMuz[0] * W.FIG_SCALE, mz.y - gp.y - Math.sin(u.facing) * D.gunMuz[0] * W.FIG_SCALE) < 1;
    out.box = (W.mgCarryAt(u, u.models[2], 2, 'sv_atb') ? W._mgc.buf : null) === W.MODELS.carry.box76;
    u.packed = true;
    out.packMesh = W.teamMesh(u) === W.MODELS.gunPk.sv_bs3;
    u.packed = false;
    const tw = W.spawnUnit(own, 'sv_t20', u.x + 90, u.y, 0);
    out.canHitch = W.canHitch(tw, u);
    W.hitchGun(tw, u);
    out.towed = u.towedBy === tw;
    W.unhitchGun(tw); W.killUnit(tw);
    const mk = u.models[2], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, mk, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.bodyNat = rec ? rec.nat : '-';
    W.killUnit(u);
    G.units.length = 0;
    const ln = st || { ax: at.x, ay: at.y, th: 0 };
    const v = W.spawnUnit(own, 'sv_bs3', ln.ax, ln.ay, ln.th);
    v.setup = 0; v.packed = false; v.pack = 0; v.facing = ln.th; v.order = null; v.path = null;
    const along = d => ({ x: ln.ax + Math.cos(ln.th) * d, y: ln.ay + Math.sin(ln.th) * d });
    const gp0 = along(280), tp0 = along(340);
    const g = W.spawnUnit('ger', 'hr_gren', gp0.x, gp0.y, ln.th + Math.PI);
    const see = e => { e.vUs = true; e.detUs = 1; };
    see(g);
    v.up = {}; v.forced = null; v.target = null;
    out.apMen = (W.acquire(v) || { key: 'nothing' }).key;
    const tk = W.spawnUnit('ger', 'hr_p4', tp0.x, tp0.y, ln.th + Math.PI); see(tk);
    out.apBoth = (W.acquire(v) || { key: 'nothing' }).key;
    out.range = W.mainW(v).range;
    G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    G.units.length = 0;
    /* the brain on his slot, with the Avtopark standing and every rung under the BS-3's bought */
    G.t = Math.max(G.t, 700);
    G.res[own].mp += 3000; G.res[own].fu += 600;
    ['sv_su76', 'sv_zsu37', 'sv_t20', 'sv_ba64', 'sv_bm13', 'sv_su85', 'sv_su122', 'sv_is2'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    ['sv_zis3', 'sv_zis2', 'sv_t34', 'sv_t3485'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    G.made[own].sv_bs3 = 0;
    /* and the queues emptied, because the brain runs of the rows above leave what they queued
       standing in them, and a population that is nearly full has room for a fifteen-point tank
       and none for a sixteen-point gun */
    G.blds.forEach(b => { if (b.own === own) b.queue.length = 0; });
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    W.__b3q = []; W.__b3U = W.queueUnit;
    W.queueUnit = function (b) { const r = W.__b3U.apply(this, arguments); if (r && b.own === own) W.__b3q.push(b.key + ':' + arguments[1]); return r; };
    return out;
  });
  await fastForward(page, 40);
  const b3Ai = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__b3U; W.slotOf(own).ai = 0;
    W.G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    W.G.units.length = 0;
    return { q: W.__b3q.join(',') || 'nothing' };
  });
  const fb3 = b3.first, bb3 = b3.bFirst;
  ok('the Red Army\'s Avtopark raises the BS-3, seven men on a carriage of its own with a 100 mm tube',
     /sv_bs3/.test(b3.makes) && b3.q === 'sv_bs3' && b3.qKaz === 'refused' && b3.name === '100 mm BS-3' &&
     b3.staged && !!fb3 && (!bb3 || bb3.t >= fb3.t + 1) && fb3.found < 1 &&
     b3.men === 7 && b3.baked && b3.set && b3.vars === 'sv_atg,sv_atg,sv_atb,sv_atb_b,sv_atb,sv_atb_b,sv_atb' &&
     b3.loaderRight && b3.loaderFaces && b3.bearers && b3.mesh && b3.muz && b3.box && b3.packMesh && b3.canHitch && b3.towed &&
     b3.apMen === 'nothing' && b3.apBoth === 'hr_p4' && b3.range === 680 && b3.bodyNat === 'sov_at' && /sov_mot:sv_bs3/.test(b3Ai.q),
     `the Avtopark makes ${b3.makes} and queues ${b3.q}, the Kazarma ${b3.qKaz} it; named ${b3.name}; ` +
     (b3.staged ? `sited against a Panther at 560 it fired ${fb3 ? 'at ' + fb3.t + ' s from ' + fb3.d + ' with the tank ' + (fb3.found < 1 ? 'yet to find it (' + fb3.found + ')' : 'ALREADY on it') : 'NEVER'} ` +
       `and the tank ${bb3 ? 'answered at ' + bb3.t + ' s from ' + bb3.d : 'never fired'}; ` : 'NO open ground to stage the drill on; ') +
     `${b3.men} men, the served bodies and the three meshes ${b3.baked ? 'baked' : 'NOT baked'}; halted ${b3.set ? 'set up' : 'NOT set up'} ` +
     `as ${b3.vars}, the loader at ${b3.loader} ${b3.loaderRight ? 'on the right' : 'NOT on the right'} and ${b3.loaderFaces ? 'facing the breech' : 'NOT facing it'}, ` +
     `the bearers ${b3.bearers === 'cover' ? 'in cover' : b3.bearers ? 'back behind the gun' : 'NOT in place (' + b3.bpos + ')'}, the piece ` +
     `${b3.mesh ? 'open' : 'WRONG'}, the flash ${b3.muz ? 'at the muzzle' : 'OFF the muzzle'}, a bearer's case ${b3.box ? 'in his hand' : 'MISSING'}; ` +
     `packed the trails ${b3.packMesh ? 'closed' : 'NOT closed'}; a T-20 ${b3.canHitch ? 'may' : 'may NOT'} hitch it and ${b3.towed ? 'did' : 'DID NOT'}; ` +
     `it picked ${b3.apMen} with the squad alone and ${b3.apBoth} with the tank beside it, out to ${b3.range}; killed went down as ` +
     `${b3.bodyNat}; a brain with the Avtopark standing queued ${b3Ai.q}`);

  /* --- The SU-76M, out of the Avtopark: the Avtopark makes it and queues it and the Kazarma refuses
     it. Every buffer it needs is built, the gunner who turns with the gun and the loader and the
     commander on the hull among them; it is a casemate named the SU-76M, and its gun asked to lay
     1.2 radians off the nose stops at the edge of its fifteen degrees. The commander standing in the
     open compartment wears the padded helmet and is the eye, with his head over the walls. A Kar98k
     never goes through its front and a Pak 38 always does, and its own AP round goes through a
     Panzer IV's side every time and its front less often. With the AP round up it picks nothing out
     of a grenadier squad and the Panzer IV out of the two; with the HE round up it picks the squad,
     out to 480; and a brain on his slot puts HE up with only men in front of it and AP when a tank
     comes into reach. Forty wrecks throw nothing, killed it leaves the army's crewmen, and a brain
     on his slot with the Avtopark standing and the rungs under it bought buys one. The rounds are
     asked along a line of open ground traced clear both ways, for the ZiS-3's reason. --- */
  const sm = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar' && b.built >= 1)[0];
    if (!kb) { const at = W.baseSite(own, 'sov_bar') || W.nearestFree(hq.x, hq.y - 260); kb = W.spawnBuilding(own, 'sov_bar', at.x, at.y, true); }
    let ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot' && b.built >= 1)[0];
    if (!ab) { const at = W.baseSite(own, 'sov_mot') || W.nearestFree(hq.x, hq.y + 260); ab = W.spawnBuilding(own, 'sov_mot', at.x, at.y, true); }
    out.makes = W.makesOf(ab).join(',');
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(ab, 'sv_su76'); out.qKaz = q(kb, 'sv_su76');
    const B = W.MODELS.veh.sv_su76, V = W.VMODEL.sv_su76;
    out.bufs = !!(B && B.hull && B.tur && B.crew && B.turCrew);
    out.fixed = !!V.fixed;
    const clear = (x, y) => x > 60 && y > 60 && x < W.WORLD.w - 60 && y < W.WORLD.h - 60 && W.walkable(x, y) &&
                            !W.inMasonry(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 40);
    let st = null;
    for (let r = 200; r < 1600 && !st; r += 60)
      for (let k = 0; k < 16 && !st; k++) {
        const ax = hq.x + r * Math.cos(k * Math.PI / 8), ay = hq.y + r * Math.sin(k * Math.PI / 8);
        if (!clear(ax, ay)) continue;
        for (let j = 0; j < 8 && !st; j++) {
          const th = j * Math.PI / 4, bx = ax + 380 * Math.cos(th), by = ay + 380 * Math.sin(th);
          if (!clear(bx, by)) continue;
          if (W.traceClear(ax, ay, W.groundZ(ax, ay) + 18, bx, by, W.groundZ(bx, by) + 14, W.sblk) &&
              W.traceClear(bx, by, W.groundZ(bx, by) + 14, ax, ay, W.groundZ(ax, ay) + 18, W.sblk) &&
              W.fireLine({ x: ax, y: ay, side: 'us' }, { x: bx, y: by })) st = { ax, ay, th };
        }
      }
    out.staged = !!st;
    const ln = st || { ax: hq.x + 220, ay: hq.y + 140, th: 0 };
    const t = W.spawnUnit(own, 'sv_su76', ln.ax, ln.ay, ln.th);
    out.name = W.nameOf(t); out.arc = +(W.arcOf(t) || 0).toFixed(2);
    t.facing = ln.th; t.turret = ln.th; t.want = ln.th + 1.2;
    for (let i = 0; i < 30; i++) W.updateModels(t, .2);
    out.tur = +W.angDiff(t.facing, t.turret).toFixed(3);
    t.turret = t.facing; t.want = t.facing; t._matT = -1;
    const K = W.KIT.sov;
    out.shlem = V.crew.concat(V.turCrew).filter(f => f.c === K.shlem || f.c === K.shlemD).length;
    out.paint = V.hull.filter(f => f.c === W.TZC.body).length;
    const E = W.VIN.sv_su76(V);
    out.eye = +E.eyeUp.z.toFixed(1); out.top = +W.smTopZ(E.eyeUp.x).toFixed(1); out.frame = E.frame;
    const ahead = d => ({ x: t.x + d * Math.cos(ln.th), y: t.y + d * Math.sin(ln.th) });
    let p = ahead(150); out.rifle = +W.penVs(W.UNITS.hr_gren.w, 150, t, p.x, p.y).toFixed(2);
    p = ahead(300); out.pak = +W.penVs(W.UNITS.hr_pak.w, 300, t, p.x, p.y).toFixed(2);
    const see = e => { e.vUs = true; e.detUs = 1; };
    const gp = ahead(280), tp = ahead(340);
    const g = W.spawnUnit('ger', 'hr_gren', gp.x, gp.y, ln.th + Math.PI); see(g);
    t.up = {}; t.forced = null; t.target = null;
    out.apMen = (W.acquire(t) || { key: 'nothing' }).key;
    const tk = W.spawnUnit('ger', 'hr_p4', tp.x, tp.y, ln.th + Math.PI); see(tk);
    out.apBoth = (W.acquire(t) || { key: 'nothing' }).key;
    out.onP4F = +W.penVs(t.def.w, 340, tk, t.x, t.y).toFixed(2);
    tk.facing = ln.th + Math.PI / 2; tk._matT = -1;
    out.onP4S = +W.penVs(t.def.w, 340, tk, t.x, t.y).toFixed(2);
    G.units.splice(G.units.indexOf(tk), 1);
    W.setRound([t], true);
    const hw = W.mainW(t);
    out.he = hw.dmg + '/' + hw.aoe + '/' + hw.range;
    t.target = null; t.forced = null;
    out.heMen = (W.acquire(t) || { key: 'nothing' }).key;
    W.setRound([t], false);
    /* the brain on his slot picks the round off what is in front of the gun */
    t.up = {};
    W.__smU = t; W.__smT0 = tp; W.__smAi = W.slotOf('ger').ai; W.slotOf('ger').ai = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    return out;
  });
  await fastForward(page, 4);
  const smR = await page.evaluate(() => {
    const W = window, u = W.__smU, out = {};
    out.menOnly = !!(u.up && u.up.he);
    const tk = W.spawnUnit('ger', 'hr_p4', W.__smT0.x, W.__smT0.y, u.facing + Math.PI);
    tk.vUs = true; tk.detUs = 1; tk.hp = tk.maxHp = 1e6;
    return out;
  });
  await fastForward(page, 4);
  Object.assign(smR, await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, u = W.__smU, out = {};
    out.withTank = !(u.up && u.up.he);
    W.slotOf(own).ai = 0; W.slotOf('ger').ai = W.__smAi;
    G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    const sp = W.nearestFree(hq.x + 220, hq.y + 140), t = W.spawnUnit(own, 'sv_su76', sp.x, sp.y, 0);
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    G.units.length = 0;
    /* the brain on his slot, with the Avtopark standing, every rung under the SU-76M's and beside
       it bought and the queues emptied, for the BS-3's reason */
    G.t = Math.max(G.t, 700);
    G.res[own].mp += 3000; G.res[own].fu += 600;
    ['sv_zsu37', 'sv_t20', 'sv_ba64', 'sv_bm13', 'sv_bs3', 'sv_su85', 'sv_su122', 'sv_is2'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    ['sv_zis3', 'sv_zis2', 'sv_t34', 'sv_t3485'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    G.made[own].sv_su76 = 0;
    G.blds.forEach(b => { if (b.own === own) b.queue.length = 0; });
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    W.__smq = []; W.__smQ = W.queueUnit;
    W.queueUnit = function (b) { const r = W.__smQ.apply(this, arguments); if (r && b.own === own) W.__smq.push(b.key + ':' + arguments[1]); return r; };
    return out;
  }));
  await fastForward(page, 40);
  Object.assign(smR, await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__smQ; W.slotOf(own).ai = 0;
    W.G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    W.G.units.length = 0;
    return { q: W.__smq.join(',') || 'nothing' };
  }));
  ok('the Red Army\'s Avtopark raises the SU-76M, the 76 mm in an open compartment on a light chassis, with both rounds',
     /sv_su76/.test(sm.makes) && sm.q === 'sv_su76' && sm.qKaz === 'refused' && sm.bufs && sm.fixed && sm.name === 'SU-76M' &&
     sm.arc === .52 && Math.abs(Math.abs(sm.tur) - sm.arc / 2) < .03 && sm.shlem > 0 && sm.paint > 0 && sm.frame === 'hull' &&
     sm.eye > sm.top && sm.eye < sm.top + 6 && sm.rifle === 0 && sm.pak === 1 && sm.onP4S === 1 && sm.onP4F < sm.onP4S &&
     sm.staged && sm.apMen === 'nothing' && sm.apBoth === 'hr_p4' && sm.he === '90/45/480' && sm.heMen === 'hr_gren' &&
     smR.menOnly && smR.withTank && smR.blown === 0 && smR.bodies >= 1 && smR.bodyNat === 'sov' && /sov_mot:sv_su76/.test(smR.q),
     `the Avtopark makes ${sm.makes} and queues ${sm.q}, the Kazarma ${sm.qKaz} it; buffers ${sm.bufs ? 'built' : 'MISSING'}, ` +
     `${sm.fixed ? 'a casemate' : 'NOT FIXED'}; named ${sm.name}; asked to lay 1.2 off the nose the gun came to ${sm.tur} on an arc ` +
     `of ${sm.arc}; the crew have ${sm.shlem} faces of the padded helmet, the hull ${sm.paint} of its green; the eye in the ` +
     `${sm.frame} at ${sm.eye} over walls at ${sm.top}; a Kar98k through the front ${sm.rifle} and a Pak 38 ${sm.pak}; its AP ` +
     `round through a Panzer IV's front ${sm.onP4F} and side ${sm.onP4S}; ${sm.staged ? '' : 'NO clear line to ask the rounds along; '}` +
     `with AP up it picked ${sm.apMen} with the squad alone and ${sm.apBoth} with the tank beside it, with HE up (${sm.he}) ` +
     `${sm.heMen}; the brain put HE up with men only ${smR.menOnly ? 'yes' : 'NO'} and AP with a tank ${smR.withTank ? 'yes' : 'NO'}; ` +
     `forty wrecks threw ${smR.blown} and sat down ${smR.sink}; killed it left ${smR.bodies} bodies of ${smR.bodyNat}; a brain ` +
     `with the Avtopark standing queued ${smR.q}`);

  /* --- The ZSU-37, out of the Avtopark: the Avtopark makes it and queues it and the Kazarma refuses
     it. Every buffer it needs is built, the gun laid up and down on its trunnions among them, and it
     is named the ZSU-37. Its gun asked to lay over the tail comes all the way round, and turned away
     from the slot it is laid up over the walls, its muzzle well over the box's top; brought back
     into the slot it comes down level again. The eye is the commander's at the back of the box. A
     Kar98k never goes through its front and a Pak 38 always does, and its own 37 mm goes through a
     Panzer IV's side more than eight times in ten at two hundred and never through its front: the
     hull's and the turret's sides open square on, and the turret's rear corners, met at forty-five
     degrees, do not. Forty wrecks throw
     nothing, killed it leaves the army's crewmen, and a brain on his slot with the Avtopark standing
     and the rungs under it bought buys one. --- */
  const zk = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar' && b.built >= 1)[0];
    if (!kb) { const at = W.baseSite(own, 'sov_bar') || W.nearestFree(hq.x, hq.y - 260); kb = W.spawnBuilding(own, 'sov_bar', at.x, at.y, true); }
    let ab = G.blds.filter(b => b.own === own && b.key === 'sov_mot' && b.built >= 1)[0];
    if (!ab) { const at = W.baseSite(own, 'sov_mot') || W.nearestFree(hq.x, hq.y + 260); ab = W.spawnBuilding(own, 'sov_mot', at.x, at.y, true); }
    out.makes = W.makesOf(ab).join(',');
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(ab, 'sv_zsu37'); out.qKaz = q(kb, 'sv_zsu37');
    const B = W.MODELS.veh.sv_zsu37, V = W.VMODEL.sv_zsu37;
    out.bufs = !!(B && B.hull && B.tur && B.crew && B.turCrew && B.elv && B.elv.gun);
    out.fixed = !!V.fixed;
    const sp = W.nearestFree(hq.x + 220, hq.y + 140), t = W.spawnUnit(own, 'sv_zsu37', sp.x, sp.y, 0);
    out.name = W.nameOf(t); out.arc = W.arcOf(t) || 0;
    t.facing = 0; t.turret = 0; t.el = 0; t.want = 3.1;
    for (let i = 0; i < 40; i++) W.updateModels(t, .2);
    out.tur = +Math.abs(W.angDiff(t.facing, t.turret)).toFixed(2); out.elUp = +(t.el || 0).toFixed(2);
    t._matT = -1;
    const gz = W.groundZ(t.x, t.y);
    out.muzUp = +(W.gunMuzzle(t).z - gz).toFixed(1); out.boxTop = W.ZKH.zT;
    t.want = 0;
    for (let i = 0; i < 40; i++) W.updateModels(t, .2);
    out.back = +Math.abs(W.angDiff(t.facing, t.turret)).toFixed(2); out.elDown = +(t.el || 0).toFixed(2);
    t._matT = -1;
    out.muzDown = +(W.gunMuzzle(t).z - gz).toFixed(1);
    const K = W.KIT.sov;
    out.shlem = V.crew.concat(V.turCrew).filter(f => f.c === K.shlem || f.c === K.shlemD).length;
    const E = W.VIN.sv_zsu37(V);
    out.eye = +E.eyeUp.z.toFixed(1); out.frame = E.frame;
    out.rifle = +W.penVs(W.UNITS.hr_gren.w, 150, t, t.x + 150, t.y).toFixed(2);
    out.pak = +W.penVs(W.UNITS.hr_pak.w, 300, t, t.x + 300, t.y).toFixed(2);
    const p4 = W.spawnUnit('ger', 'hr_p4', t.x + 200, t.y, Math.PI);
    out.onP4F = +W.penVs(t.def.w, 200, p4, t.x, t.y).toFixed(2);
    p4.facing = Math.PI / 2; p4._matT = -1;
    out.onP4S = +W.penVs(t.def.w, 200, p4, t.x, t.y).toFixed(2);
    G.units.splice(G.units.indexOf(p4), 1);
    out.auto = !!t.def.w.auto;
    const nw = G.wrecks.length;
    let blown = 0, sink = 0;
    for (let i = 0; i < 40; i++) { const w = W.makeWreck(t); if (w.blown) blown++; sink = Math.max(sink, w.sink); }
    G.wrecks.length = nw;
    out.blown = blown; out.sink = +sink.toFixed(2);
    const nc = G.corpses.length;
    W.killUnit(t);
    const bodies = G.corpses.slice(nc);
    out.bodies = bodies.length; out.bodyNat = [...new Set(bodies.map(c => c.nat))].join(',');
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    G.t = Math.max(G.t, 700);
    G.res[own].mp += 3000; G.res[own].fu += 600;
    ['sv_su76', 'sv_t20', 'sv_ba64', 'sv_bm13', 'sv_bs3', 'sv_su85', 'sv_su122', 'sv_is2'].forEach(k => { G.made[own][k] = Math.max(1, G.made[own][k] || 0); });
    ['sv_zis3', 'sv_zis2', 'sv_t34', 'sv_t3485'].forEach(k => { G.made[own][k] = Math.max(2, G.made[own][k] || 0); });
    G.made[own].sv_zsu37 = 0;
    G.blds.forEach(b => { if (b.own === own) b.queue.length = 0; });
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    W.__zkq = []; W.__zkQ = W.queueUnit;
    W.queueUnit = function (b) { const r = W.__zkQ.apply(this, arguments); if (r && b.own === own) W.__zkq.push(b.key + ':' + arguments[1]); return r; };
    return out;
  });
  await fastForward(page, 40);
  const zkAi = await page.evaluate(() => {
    const W = window, own = W.G.own;
    W.queueUnit = W.__zkQ; W.slotOf(own).ai = 0;
    W.G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    W.G.units.length = 0;
    return { q: W.__zkq.join(',') || 'nothing' };
  });
  ok('the Red Army\'s Avtopark raises the ZSU-37, the 37 mm on its turntable in an open box, laid up over the walls',
     /sv_zsu37/.test(zk.makes) && zk.q === 'sv_zsu37' && zk.qKaz === 'refused' && zk.bufs && zk.fixed && zk.name === 'ZSU-37' &&
     !zk.arc && zk.tur > 3.0 && zk.elUp > .85 && zk.muzUp > zk.boxTop + 6 && zk.back < .05 && zk.elDown < .05 &&
     zk.muzDown < zk.boxTop - 3 && zk.shlem > 0 && zk.frame === 'hull' && zk.eye > zk.boxTop && zk.eye < zk.boxTop + 6 &&
     zk.rifle === 0 && zk.pak === 1 && zk.onP4S > .8 && zk.onP4F === 0 && zk.auto && zk.blown === 0 && zk.bodies >= 1 &&
     zk.bodyNat === 'sov' && /sov_mot:sv_zsu37/.test(zkAi.q),
     `the Avtopark makes ${zk.makes} and queues ${zk.q}, the Kazarma ${zk.qKaz} it; buffers ${zk.bufs ? 'built' : 'MISSING'}, ` +
     `${zk.fixed ? 'nothing to throw' : 'NOT FIXED'}; named ${zk.name}${zk.arc ? ' on an ARC of ' + zk.arc : ''}; asked to lay over the tail ` +
     `the gun came round ${zk.tur} and was laid up ${zk.elUp}, its muzzle ${zk.muzUp} up over a box ${zk.boxTop} tall; brought back ` +
     `to the nose it came to ${zk.back} and ${zk.elDown}, the muzzle at ${zk.muzDown}; the crew have ${zk.shlem} faces of the padded ` +
     `helmet; the eye in the ${zk.frame} at ${zk.eye}; a Kar98k through the front ${zk.rifle} and a Pak 38 ${zk.pak}; its 37 mm ` +
     `through a Panzer IV's side ${zk.onP4S} and front ${zk.onP4F}, ${zk.auto ? 'automatic' : 'NOT AUTOMATIC'}; forty wrecks threw ` +
     `${zk.blown} and sat down ${zk.sink}; killed it left ${zk.bodies} bodies of ${zk.bodyNat}; a brain with the Avtopark standing ` +
     `queued ${zkAi.q}`);


  /* --- The B-4, the Red Army's heavy battery, dug by the Sapery. The army names it as its battery
     and the sapper's card offers it; it is refused inside seven hundred of home and a second is
     refused with the first standing. Dug forward, the howitzer stands on its tracks with its seven
     men where the work lays them and every buffer built; laid on clear ground six hundred off it
     fires its five rounds into its circle, and stood within reach of the enemy's base a mission 300
     short of his headquarters is refused. Then the Br-5: AUTO is not offered on it and the brain's
     routine will not fit it; fitted by hand for its price it is drawn as the Br-5, reaches 900 with a
     round of 950, and after its change-over three rounds go into the circle. A brain on his slot
     with two Sapery, four squads and the money digs one. The rounds come off the list as they leave the
     tube. --- */
  const b4 = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {};
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0; G.shots.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    const foeHq = G.blds.filter(b => b.side !== G.side && b.def.hq)[0];
    const mp = G.res[own].mp, fu = G.res[own].fu;
    W.__b4mp = mp; W.__b4fu = fu;
    /* the brain rows above it ran with the money in the till and the clock past seven hundred,
       and a brain on his slot digs a battery, so a site of one may be standing: it holds the
       limit and the population, and every placement below would be refused for it */
    W.slotOf(own).ai = 0;
    G.sites.slice().forEach(s => { if (s.own === own) G.sites.splice(G.sites.indexOf(s), 1); });
    G.works.slice().forEach(w => { if (w.own === own && w.kind === 'howb4') G.works.splice(G.works.indexOf(w), 1); });
    G.blds.forEach(b => { if (b.own === own) b.queue.length = 0; });
    G.res[own].mp = 9000; G.res[own].fu = 9000;
    const sap = W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0);
    W.select([sap], false); W.buildCmds();
    out.cards = W.cmdList.map(c => c.btn.title.replace(/ \[.*\]$/, ''));
    W.select([], false);
    out.battery = W.NATIONS.sov.battery;
    const WK = W.WORKS.howb4;
    const fx = foeHq.x - hq.x, fy = foeHq.y - hq.y, fl = Math.hypot(fx, fy), ux = fx / fl, uy = fy / fl;
    out.near = !!W.placeWork(own, 'howb4', hq.x + ux * 220, hq.y + uy * 220, Math.atan2(uy, ux), [sap]);
    let site = null, at = null;
    for (let d = WK.minHq + 60; d < WK.minHq + 800 && !site; d += 60)
      for (let k = -4; k <= 4 && !site; k++) {
        const x = hq.x + ux * d - uy * k * 110, y = hq.y + uy * d + ux * k * 110;
        site = W.placeWork(own, 'howb4', x, y, Math.atan2(uy, ux), [sap]);
        if (site) at = { x, y };
      }
    out.dug = !!site;
    if (!site) {
      const x = hq.x + ux * (WK.minHq + 120), y = hq.y + uy * (WK.minHq + 120);
      out.why = 'room ' + W.workRoom(x, y, WK) + ', full ' + W.workFull(own, 'howb4') + ', pop ' + W.popOf(own) + '/' + W.popCap(own) +
                ', noArty ' + W.aiNoArty(own) + ', sites ' + G.sites.filter(s => s.own === own).map(s => s.kind).join('+');
      G.res[own].mp = mp; G.res[own].fu = fu; return out;
    }
    site.prog = 1; W.updateSites(0);
    const g = G.units.filter(u => u.key === 'sv_b4' && u.own === own)[0];
    out.spawned = !!g;
    if (!g) { G.res[own].mp = mp; G.res[own].fu = fu; return out; }
    out.twice = !!W.placeWork(own, 'howb4', at.x + ux * 240, at.y + uy * 240 + 200, 0, [sap]);
    out.men = g.models.length;
    out.lay = g.models.every((m, i) => !WK.lay[i] || (m.ox === WK.lay[i][0] && m.oy === WK.lay[i][1]));
    out.vars = g.models.map((m, i) => W.variantForModel(g, i)).join(',');
    out.built = !!(W.MODELS.gun.sv_b4 && W.MODELS.gunBase.sv_b4 && W.MODELS.gunRec.sv_b4);
    out.name = W.nameOf(g);
    out.reach = Math.round(W.barrageRange(g));
    function mission(D) {
      let bear = null, tx = 0, ty = 0;
      for (let a = 0; a < Math.PI * 2 && bear === null; a += .2) {
        const x = g.x + Math.cos(a) * 600, y = g.y + Math.sin(a) * 600;
        if (x < 60 || y < 60 || x > W.WORLD.w - 60 || y > W.WORLD.h - 60) continue;
        if (W.barrageWhy(g, x, y) === null) { bear = a; tx = x; ty = y; }
      }
      const r = { bear: bear !== null, laid: false, first: -1, out: [] };
      if (bear === null) return r;
      g.facing = g.baseA = bear;
      r.laid = !!W.orderBarrage(g, tx, ty);
      let t = 0;
      for (let f = 0; f < 60 * 200 && r.out.length < D.barrage.rounds; f++) {
        const n0 = G.shots.length;
        W.updateUnit(g, 1 / 60); G.t += 1 / 60; t += 1 / 60;
        for (let i = G.shots.length - 1; i >= n0; i--) {
          const sh = G.shots[i];
          if (sh.kind === 'shell') { r.out.push(Math.hypot(sh.tx - tx, sh.ty - ty)); if (r.first < 0) r.first = +t.toFixed(1); }
          G.shots.splice(i, 1);
        }
      }
      const bound = D.barrage.r + D.barrage.sp * 1.6;
      r.rounds = r.out.length; r.inBound = r.out.filter(d => d <= bound).length; r.bound = Math.round(bound);
      return r;
    }
    const U = W.UNITS.sv_b4;
    out.m1 = mission(U);
    /* the enemy's base: stood 900 off his headquarters, a mission 300 short of it */
    const gx0 = g.x, gy0 = g.y, hA = Math.atan2(hq.y - foeHq.y, hq.x - foeHq.x);
    g.x = foeHq.x + Math.cos(hA) * 900; g.y = foeHq.y + Math.sin(hA) * 900;
    out.whyBase = W.barrageWhy(g, foeHq.x + Math.cos(hA) * 300, foeHq.y + Math.sin(hA) * 300);
    g.barrage = null; g.x = gx0; g.y = gy0;
    /* the Br-5 */
    const BD = U.defUp.br5;
    out.auto = W.autoFits(g); out.up = W.upgradable(g);
    out.autoGot = !!W.buyUpgradeAuto(own, [g], { floor: 0 }) || !!g.up.br5;
    const mp0 = G.res[own].mp, fu0 = G.res[own].fu;
    W.pay(own, W.UPGRADES.br5.cost); W.fitUp(g, 'br5');
    const k = W.gmKey(g);
    out.br = { piece: k, built: !!(W.MODELS.gun[k] && W.MODELS.gunBase[k] && W.MODELS.gunRec[k]),
               cost: [mp0 - G.res[own].mp, fu0 - G.res[own].fu], want: [W.UPGRADES.br5.cost.mp, W.UPGRADES.br5.cost.fu],
               name: W.nameOf(g), reach: Math.round(W.barrageRange(g)), dmg: W.mainW(g).dmg, setup: g.setup, D: BD.setup,
               baseKey: W.gmKey({ def: U, key: 'sv_b4' }) };
    out.m2 = mission(BD);
    W.killUnit(g); W.killUnit(sap);
    G.units.length = 0; G.shots.length = 0;
    G.works.slice().forEach(w => { if (w.own === own && w.kind === 'howb4') G.works.splice(G.works.indexOf(w), 1); });
    /* the brain on his slot digs one, with a Sapery, men about him and the money */
    G.t = Math.max(G.t, 700);
    G.res[own].mp = 9000; G.res[own].fu = 9000;
    W.slotOf(own).ai = 1; W.aiInit(own);
    G.blds.forEach(b => { if (b.own === own) b.queue.length = 0; });
    W.AIR.fired['battery.dig'] = 0;
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_sap', hq.x + 140, hq.y + 90, 0);
    for (let i = 0; i < 4; i++) W.spawnUnit(own, 'sv_strel', hq.x + 120 + i * 40, hq.y - 60, 0);
    W.__b4mp = mp; W.__b4fu = fu;
    return out;
  });
  await fastForward(page, 40);
  const b4Ai = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own;
    W.slotOf(own).ai = 0;
    const dug = G.sites.some(s => s.own === own && s.kind === 'howb4') || G.units.some(u => u.own === own && u.key === 'sv_b4');
    G.units.slice().forEach(q => { if (!q.dead) W.killUnit(q); });
    G.units.length = 0;
    G.sites.slice().forEach(s => { if (s.own === own && s.kind === 'howb4') G.sites.splice(G.sites.indexOf(s), 1); });
    G.works.slice().forEach(w => { if (w.own === own && w.kind === 'howb4') G.works.splice(G.works.indexOf(w), 1); });
    G.res[own].mp = W.__b4mp; G.res[own].fu = W.__b4fu;
    return { dug, fired: W.AIR.fired['battery.dig'] || 0 };
  });
  const m1 = b4.m1 || {}, m2 = b4.m2 || {}, br = b4.br || {};
  ok('the Red Army\'s Sapery dig the B-4, its heavy battery, and it can be rebuilt by hand as the Br-5',
     b4.battery === 'howb4' && (b4.cards || []).indexOf('B-4') >= 0 && !(b4.cards || []).some(t => /240 MM|MRS 18/.test(t)) &&
     !b4.near && b4.dug && b4.spawned && !b4.twice && b4.men === 7 && b4.lay && b4.built &&
     b4.vars === 'sv_atg,sv_atg,sv_atb,sv_atb_b,sv_atb,sv_atb,sv_atb_b' && /B-4/.test(b4.name) && b4.reach === 1250 &&
     m1.bear && m1.laid && m1.rounds === 5 && m1.inBound === 5 && b4.whyBase === 'safe' &&
     b4.up && !b4.auto && !b4.autoGot && br.piece === 'sv_b4:br5' && br.built && br.cost[0] === br.want[0] && br.cost[1] === br.want[1] &&
     /Br-5/.test(br.name) && br.reach === 900 && br.dmg === 950 && br.setup === br.D && br.baseKey === 'sv_b4' &&
     m2.bear && m2.laid && m2.first >= br.D * .95 && m2.rounds === 3 && m2.inBound === 3 && b4Ai.dug,
     `the army's battery is ${b4.battery}; the sapper's card ${(b4.cards || []).indexOf('B-4') >= 0 ? 'offers' : 'does NOT offer'} it ` +
     `${(b4.cards || []).some(t => /240 MM|MRS 18/.test(t)) ? 'and ANOTHER army\'s' : 'and no other army\'s'}; inside 700 of home ` +
     `${b4.near ? 'TAKEN' : 'refused'}, dug forward ${b4.dug ? 'yes' : 'NO (' + b4.why + ')'}, the gun ${b4.spawned ? 'stood' : 'NEVER stood'}, a second ` +
     `${b4.twice ? 'TAKEN' : 'refused'}; ${b4.men} men laid ${b4.lay} as ${b4.vars}, buffers ${b4.built}; "${b4.name}" reaching ${b4.reach}; ` +
     `a mission six hundred off laid ${m1.laid}, ${m1.rounds} rounds, ${m1.inBound} inside ${m1.bound}; at the enemy's base ${b4.whyBase}; ` +
     `the Br-5: AUTO ${b4.auto ? 'OFFERED' : 'not offered'}, the routine ${b4.autoGot ? 'FITTED it' : 'did not fit it'}; by hand for ` +
     `${(br.cost || []).join('/')} of ${(br.want || []).join('/')}, drawn as ${br.piece} (buffers ${br.built}), "${br.name}", reach ${br.reach}, ` +
     `a round of ${br.dmg}, change-over ${br.setup}s, the B-4 itself still ${br.baseKey}; first round at ${m2.first}s, ${m2.rounds} rounds, ` +
     `${m2.inBound} inside ${m2.bound}; a brain on his slot ${b4Ai.dug ? 'dug one' : 'dug NONE'} (battery.dig ${b4Ai.fired})`);

  /* --- The 82-PM-41, the Red Army's battalion mortar, out of the Kazarma: the Kazarma makes it
     and queues it and the Shtab refuses it, it is named and the bunker's mortar pit is it, and it is
     three men, the gunner and the loader at the tube and one bringing the bombs up. Halted, the
     gunner kneels at the left of the bipod and the loader at the right of the tube facing it, with
     the bearer beside the gunner, the flash comes off the muzzle and the bearer has his tray in his
     hand; on the move the piece rides on its wheels behind the gunner with the strap at his right
     hand. Laid on a point five hundred off it fires its ten rounds, it reaches 570 and it takes a
     smoke mission, with the bursts switched off for the reason the self-propelled guns' row gives.
     A man of it killed goes down as one of the crew, and a brain on his slot with a Kazarma standing
     buys one. --- */
  const pm = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own, out = {}, dt = 1 / 30;
    G.units.slice().forEach(u => { if (!u.dead) W.killUnit(u); });
    G.units.length = 0;
    const hq = G.blds.filter(b => b.own === own && b.def.hq)[0];
    G.res[own].mp += 3000; G.res[own].fu += 400;
    let kb = G.blds.filter(b => b.own === own && b.key === 'sov_bar' && b.built >= 1)[0];
    if (!kb) { const at = W.baseSite(own, 'sov_bar') || W.nearestFree(hq.x, hq.y - 260); kb = W.spawnBuilding(own, 'sov_bar', at.x, at.y, true); }
    out.makes = W.makesOf(kb).join(',');
    function q(b, k) { const n = b.queue.length, r = W.queueUnit(b, k) ? b.queue.slice(-1)[0] : 'refused'; b.queue.length = n; return r; }
    out.q = q(kb, 'sv_mor'); out.qHq = q(hq, 'sv_mor');
    const D = W.UNITS.sv_mor;
    out.name = D.name; out.bunk = W.bunkUnit(W.BUNKUP.mor, own);
    /* open ground with room round it for the crew's places, found the way the ZiS-3's is */
    const clear = (x, y) => x > 60 && y > 60 && x < W.WORLD.w - 60 && y < W.WORLD.h - 60 && W.walkable(x, y) &&
                            !W.inMasonry(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 60);
    const roomy = (x, y) => [30, 60].every(rr => [...Array(12).keys()].every(k => {
      const px = x + rr * Math.cos(k * Math.PI / 6), py = y + rr * Math.sin(k * Math.PI / 6);
      return W.walkable(px, py) && !W.inMasonry(px, py);
    }));
    let at = null;
    for (let r = 200; r < 1400 && !at; r += 40)
      for (let k = 0; k < 16 && !at; k++) {
        const x = hq.x + r * Math.cos(k * Math.PI / 8), y = hq.y + r * Math.sin(k * Math.PI / 8);
        if (clear(x, y) && roomy(x, y) && !G.covers.some(c => Math.hypot(c.x - x, c.y - y) < c.r + 140)) at = { x, y };
      }
    out.open = !!at;
    if (!at) at = W.nearestFree(hq.x + 200, hq.y);
    const u = W.spawnUnit(own, 'sv_mor', at.x, at.y, 0);
    out.men = u.models.length;
    out.baked = ['sv_atg', 'sv_atb'].every(v => W.MODELS.man[v] && W.MODELS.man[v][W.POSE_STAND] && W.MODELS.man[v][W.POSE_WALK]) &&
                !!(W.MODELS.served.sv_mor && W.MODELS.served.sv_mor.mate) && !!(W.MODELS.gun.sv_mor && W.MODELS.gunPk.sv_mor);
    const step = function (s) { for (let i = 0; i < s * 30; i++) { G.t += 1 / 30; W.updateUnit(u, 1 / 30); W.updateModels(u, 1 / 30); } };
    u.setup = 0; u.packed = false; u.pack = 0;
    step(4);
    out.set = W.gunSet(u);
    out.vars = u.models.map((m, i) => W.variantForModel(u, i)).join(',');
    out.poses = u.models.map(m => m.pose).join(',');
    const gp = W.gunPost(u), cs = Math.cos(u.facing), sn = Math.sin(u.facing);
    const rel = m => { const dx = m.x - gp.x, dy = m.y - gp.y; return [(dx * cs + dy * sn) / W.FIG_SCALE, (-dx * sn + dy * cs) / W.FIG_SCALE]; };
    const r1 = rel(u.models[1]), r2 = rel(u.models[2]);
    out.loader = r1.map(v => +v.toFixed(1)).join(',');
    out.loaderRight = r1[1] > 2 && Math.abs(r1[0] - D.gunMate.at[0]) < 2;
    out.loaderFaces = Math.abs(W.angDiff(u.models[1].f, u.facing - Math.PI / 2)) < .25;
    out.bearer = u.coverSlots && u.coverSlots[2] ? 'cover' : r2[0] < 0 && r2[1] < -6;
    out.bpos = r2.map(v => Math.round(v)).join(',');
    out.mesh = W.teamMesh(u) === W.MODELS.gun.sv_mor;
    const mz = W.muzzlePoint(u, u.models[0], 0);
    out.muz = Math.hypot(mz.x - gp.x - cs * D.gunMuz[0] * W.FIG_SCALE, mz.y - gp.y - sn * D.gunMuz[0] * W.FIG_SCALE) < 1;
    out.tray = (W.mgCarryAt(u, u.models[2], 2, 'sv_atb') ? W._mgc.buf : null) === W.MODELS.carry.box82;
    /* packed, the piece is behind the gunner in his own frame, with the strap's end at his side */
    u.packed = true;
    out.packMesh = W.teamMesh(u) === W.MODELS.gunPk.sv_mor;
    const gq = W.gunPost(u), g0 = u.models[0], ex = gq.x - g0.x, ey = gq.y - g0.y;
    out.back = +((ex * cs + ey * sn) / W.FIG_SCALE).toFixed(1); out.side = +((-ex * sn + ey * cs) / W.FIG_SCALE).toFixed(1);
    u.packed = false;
    /* a mission on a point five hundred off, on whichever bearing of eight keeps it on the map */
    const boom = W.explode;
    W.explode = function () {};
    let tx = 0, ty = 0;
    for (let k = 0; k < 8; k++) {
      const a = u.facing + k * Math.PI / 4;
      tx = gp.x + Math.cos(a) * 500; ty = gp.y + Math.sin(a) * 500;
      if (tx > 80 && ty > 80 && tx < W.WORLD.w - 80 && ty < W.WORLD.h - 80) break;
    }
    out.reach = W.barrageRange(u);
    out.laid = !!W.orderBarrage(u, tx, ty); out.n = u.barrage ? u.barrage.left : 0;
    let fired = 0;
    for (let i = 0; i < 30 * 60 && u.barrage; i++) {
      const n0 = u.barrage.left;
      W.updateUnit(u, dt); W.updateModels(u, dt); W.updateShots(dt); G.t += dt;
      if (!u.barrage || u.barrage.left < n0) fired++;
    }
    out.fired = fired; out.left = u.barrage ? u.barrage.left : 0;
    out.smoke = W.orderBarrage(u, tx, ty, true) && u.barrage && u.barrage.smoke ? u.barrage.left : 0;
    u.barrage = null;
    W.explode = boom; G.shots.length = 0;
    /* a man of it goes down as one of the crew */
    const mk = u.models[2], nf = G.falls.length, nc = G.corpses.length;
    W.damageModel(u, mk, 1e4, null);
    const rec = G.falls.length > nf ? G.falls[G.falls.length - 1] : G.corpses.length > nc ? G.corpses[G.corpses.length - 1] : null;
    out.bodyNat = rec ? rec.nat : '-';
    W.killUnit(u);
    G.units.slice().forEach(v => { if (!v.dead) W.killUnit(v); });
    G.units.length = 0;
    /* the brain on his slot, with the Kazarma standing and nothing of the mortar on its tally, and a
       machine gun team of theirs by their own headquarters to want a tube against: with the German
       brain switched off for the earlier rows the Red Army held more ground than the enemy, and a
       brain holding more ground with nothing for a tube to do buys none */
    out.madePm = G.made[own].sv_mor || 0; G.made[own].sv_mor = 0;
    const ghq = G.blds.filter(b => b.side === 'ger' && b.def.hq)[0], mp0 = W.nearestFree(ghq.x, ghq.y + 160);
    W.__pmMg = W.spawnUnit('ger', 'hr_mg', mp0.x, mp0.y, 0);
    W.__pmAi = W.slotOf('ger').ai; W.slotOf('ger').ai = 0;
    W.slotOf(own).ai = 1; W.aiInit(own);
    W.spawnUnit(own, 'sv_sap', hq.x + 120, hq.y + 60, 0); W.spawnUnit(own, 'sv_strel', hq.x + 120, hq.y - 60, 0);
    W.spawnUnit(own, 'sv_strel', hq.x + 160, hq.y, 0);
    /* the Kazarma's own vehicles standing, its queues empty and money in the till: the ladder buys
       back whatever has died, the row above killed everything, and a T-20 bought back at the Kazarma
       holds its queue for the whole of the row, so the post's list with the tube on it never ran */
    G.blds.forEach(b => { if (b.own === own) b.queue.length = 0; });
    const kz = W.nearestFree(hq.x - 160, hq.y);
    W.spawnUnit(own, 'sv_t20', kz.x, kz.y, 0);
    W.spawnUnit(own, 'sv_zis3', kz.x - 60, kz.y + 70, 0); W.spawnUnit(own, 'sv_zis3', kz.x - 60, kz.y - 70, 0);
    W.__pmTill = [G.res[own].mp, G.res[own].fu];
    G.res[own].mp = Math.max(G.res[own].mp, 3000); G.res[own].fu = Math.max(G.res[own].fu, 600);
    W.__pmq = []; W.__pmU = W.queueUnit;
    W.queueUnit = function (b) { const r = W.__pmU.apply(this, arguments); if (r && b.own === own) W.__pmq.push(b.key + ':' + arguments[1]); return r; };
    return out;
  });
  await fastForward(page, 40);
  const pmAi = await page.evaluate(() => {
    const W = window, G = W.G, own = G.own;
    W.queueUnit = W.__pmU; W.slotOf(own).ai = 0; W.slotOf('ger').ai = W.__pmAi;
    G.units.slice().forEach(u => { if (!u.dead && (u.own === own || u === W.__pmMg)) W.killUnit(u); });
    G.res[own].mp = W.__pmTill[0]; G.res[own].fu = W.__pmTill[1];
    return { q: W.__pmq.join(',') || 'nothing' };
  });
  ok('the Red Army\'s Kazarma raises the 82-PM-41, a mortar of three men that rides on its wheels',
     /sv_mor/.test(pm.makes) && pm.q === 'sv_mor' && pm.qHq === 'refused' && pm.name === '82 mm Mortar 82-PM-41' && pm.bunk === 'sv_mor' &&
     pm.men === 3 && pm.baked && pm.set && pm.vars === 'sv_atg,sv_atg,sv_atb' && /^11,11,/.test(pm.poses) &&
     pm.loaderRight && pm.loaderFaces && pm.bearer && pm.mesh && pm.muz && pm.tray && pm.packMesh &&
     pm.back < -18 && pm.back > -27 && pm.side > 1 && pm.side < 4 &&
     pm.reach === 570 && pm.laid && pm.n === 10 && pm.fired === 10 && pm.left === 0 && pm.smoke > 0 &&
     pm.bodyNat === 'sov_at' && /sov_bar:sv_mor/.test(pmAi.q),
     `the Kazarma makes ${pm.makes} and queues ${pm.q}, the Shtab ${pm.qHq} it; named ${pm.name}, the bunker's mortar pit ${pm.bunk}; ` +
     `${pm.men} men, the variants, the served bodies and the two meshes ${pm.baked ? 'baked' : 'NOT baked'}; halted ` +
     `${pm.set ? 'set up' : 'NOT set up'} as ${pm.vars} in poses ${pm.poses}, the loader at ${pm.loader} ` +
     `${pm.loaderRight ? 'at the right of the tube' : 'NOT at the right of the tube'} and ${pm.loaderFaces ? 'facing it' : 'NOT facing it'}` +
     `${pm.open ? '' : ' (no open ground)'}, the bearer ${pm.bearer === 'cover' ? 'in cover' : pm.bearer ? 'beside the gunner' : 'NOT in place (' + pm.bpos + ')'}, ` +
     `the piece ${pm.mesh ? 'set up' : 'WRONG'}, the flash ${pm.muz ? 'at the muzzle' : 'OFF the muzzle'}, the tray ${pm.tray ? 'in his hand' : 'MISSING'}; ` +
     `packed ${pm.packMesh ? 'on its wheels' : 'NOT on its wheels'} at ${pm.back},${pm.side} from the gunner; it reaches ${pm.reach}, laid ` +
     `${pm.laid ? 'a mission of ' + pm.n : 'NO mission'} and fired ${pm.fired} with ${pm.left} left, and a smoke mission of ${pm.smoke}; ` +
     `killed went down as ${pm.bodyNat}; a brain with the Kazarma standing (and ${pm.madePm} on the tally already, which the row ` +
     `takes off it) queued ${pmAi.q}`);

  /* --- what a battle holds on the card. An iPhone tab is killed for memory without a word
     on the console, and a phone ran Saint-Lô for four seconds before it was: the buffers were
     550 MB at the whistle, every infantry pose on the roster was baked whether or not anybody
     fielded it, the occlusion bake's arrays stayed on every vehicle face after they had been
     packed, and a second battle in the same page put another 135 MB on top of the first. So
     the bytes are counted as they are uploaded and freed, on the heaviest map, and a second
     battle has to come out no bigger than the first. The hook goes in before the deploy and
     counts only what is made after it, which is the whole of a battle. --- */
  await reload(page);
  await page.evaluate(() => {
    const P = window.WebGL2RenderingContext.prototype, sz = new WeakMap();
    const M = window.__mem = { bytes: 0, live: 0 };
    const bd = P.bufferData, db = P.deleteBuffer;
    M.restore = () => { P.bufferData = bd; P.deleteBuffer = db; };
    P.bufferData = function (t, d, u) {
      const b = this.getParameter(t === this.ELEMENT_ARRAY_BUFFER ? this.ELEMENT_ARRAY_BUFFER_BINDING : this.ARRAY_BUFFER_BINDING);
      const n = typeof d === 'number' ? d : (d ? d.byteLength : 0);
      if (b) { if (!sz.has(b)) M.live++; M.bytes += n - (sz.get(b) || 0); sz.set(b, n); }
      return bd.apply(this, arguments);
    };
    P.deleteBuffer = function (b) { if (b && sz.has(b)) { M.bytes -= sz.get(b); M.live--; sz.delete(b); } return db.call(this, b); };
  });
  await deploy(page, { side: args.side || 'us', diff: 1, map: 'stlo' });
  /* the bytes are read before anything else is asked, and a vehicle is looked at only if it
     has been built: reading `VMODEL[k]` builds it, and a probe that walked the roster to count
     faces built nineteen vehicles to measure a battle that had none */
  const memRead = () => page.evaluate(() => {
    const mb = window.__mem.bytes / 1048576, live = window.__mem.live, keys = Object.keys(window.VMODEL);
    let built = 0;
    keys.forEach(k => { const d = Object.getOwnPropertyDescriptor(window.VMODEL, k); if (d && 'value' in d) built++; });
    return { mb, live, built, of: keys.length, baked: window.MANBUF ? window.MANBUF.length : -1, packed: window.SCENE.tiles[1] && window.SCENE.tiles[1].props.pk ? 1 : 0 };
  });
  const mem1 = await memRead();
  /* and one asked for afterwards is built, buffered, and lets its bake go behind it */
  const vb = await page.evaluate(() => {
    const b0 = window.__mem.bytes, B = window.MODELS.veh.am_sher, V = window.VMODEL.am_sher;
    let ao = 0, faces = 0;
    ['hull', 'tur', 'crew', 'turCrew'].forEach(p => (V[p] || []).forEach(f => { faces++; if (f.ao) ao++; }));
    return { mb: (window.__mem.bytes - b0) / 1048576, hull: !!(B && B.hull && B.hull.n), ao, faces };
  });
  await page.evaluate(() => window.startGame(window.G.side, window.G.diff));
  await page.waitForFunction(() => window.G.running && window.SCENE.ready, null, { timeout: 180000 });
  await frames(page, 1);
  const mem2 = await memRead();
  await page.evaluate(() => window.__mem.restore());
  const memCap = DEVICES[device].hasTouch ? 160 : 190;
  ok('a battle on the heaviest map holds its buffers to a budget, and a second battle frees the first',
     mem1.mb < memCap && mem2.mb <= mem1.mb * 1.06 + 2 && mem1.packed && mem1.baked < 400 &&
     mem1.built * 2 < mem1.of && vb.hull && vb.faces > 0 && vb.ao === 0,
     `Saint-Lô ${mem1.mb.toFixed(0)} MB in ${mem1.live} buffers against ${memCap}, then ${mem2.mb.toFixed(0)} MB in ${mem2.live} after a second deploy; ` +
     `${mem1.built} of ${mem1.of} vehicles built at the whistle, and the M4A1 asked for after it ${vb.hull ? 'built' : 'NOT built'} in ${vb.mb.toFixed(1)} MB ` +
     `with ${vb.ao} of ${vb.faces} faces still carrying the bake; ${mem1.baked} men's buffers baked at the whistle; tiles ${mem1.packed ? 'packed' : 'NOT packed'}`);

  /* --- a building's queue. A player whose income is past twice the even game could bank the
     whole of it in a queue, so a building holds QMAX (eight) for him and refuses the ninth;
     at the even game it holds as many as he can pay for. --- */
  const qcap = await page.evaluate(() => {
    const W = window, G = W.G, P = W.pd(), hq = G.blds.filter(b => b.own === G.own && b.def.hq)[0];
    const key = W.makesOf(hq).filter(k => W.UNITS[k].cat === 'inf')[0];
    const inc = P.inc, keep = hq.queue.slice(), mp = G.res[G.own].mp, fu = G.res[G.own].fu;
    P.inc = 3; G.res[G.own].mp = 1e6; G.res[G.own].fu = 1e6; hq.queue.length = 0;
    let n = 0; for (let i = 0; i < 12; i++) if (W.queueUnit(hq, key)) n++;
    P.inc = 1; let even = 0; for (let i = 0; i < 2; i++) if (W.queueUnit(hq, key)) even++;
    hq.queue.length = 0; keep.forEach(k => hq.queue.push(k));
    P.inc = inc; G.res[G.own].mp = mp; G.res[G.own].fu = fu;
    return { n, even, key, max: W.QMAX };
  });
  ok('a building holds eight in its queue for a player on more than twice the income, and more at the even game',
     qcap.max === 8 && qcap.n === 8 && qcap.even === 2,
     `QMAX ${qcap.max}; on 3x income ${qcap.n} of twelve ${qcap.key} queued, and at the even game ${qcap.even} more on top of them`);

  /* --- and when the phone takes the graphics away anyway. A lost context draws nothing
     and throws nothing, so a battle that lost it went on running behind a canvas that had
     stopped: the row loses it on purpose and asks that the battle stops where it stood and
     the page says so, with a button a thumb can hit. The editor's reload below gives the
     rows after it a context again. --- */
  const lost = await page.evaluate(async () => {
    const X = window.gl && window.gl.getExtension('WEBGL_lose_context');
    if (!X) return null;
    const t0 = window.G.t;
    X.loseContext();
    await new Promise(r => setTimeout(r, 300));
    const b = document.getElementById('glerr'), btn = b && b.querySelector('button'), r = btn ? btn.getBoundingClientRect() : null;
    return { shown: !!b && !b.classList.contains('hidden'), text: b ? b.textContent.slice(0, 60) : '', paused: window.G.paused,
             glok: window.GLOK, btn: r ? Math.round(Math.min(r.width, r.height)) : 0, t0 };
  });
  ok('a lost graphics context stops the battle and says so',
     !!lost && lost.shown && lost.paused && !lost.glok && lost.btn >= 44,
     lost ? `message ${lost.shown ? 'shown' : 'NOT shown'} ("${lost.text}..."), battle ${lost.paused ? 'stopped' : 'STILL RUNNING'}, ` +
            `renderer ${lost.glok ? 'STILL ON' : 'off'}, RELOAD ${lost.btn}px` : 'no WEBGL_lose_context to test it with');

  /* --- the map editor --- */
  await reload(page);
  const edErrorsBefore = log.errors.length;
  /* the editor opens on a choice of how to start, and on nothing else: three columns of
     cards, every one of them a control a thumb can hit, and no page of instructions */
  await page.click('#openeditor');
  await page.waitForSelector('#edstart:not(.hidden)', { timeout: 30000 });
  const chooser = await page.evaluate(() => {
    let small = 0, checked = 0;
    document.querySelectorAll('#edstart .edb').forEach(b => { const r = b.getBoundingClientRect(); if (!r.width) return; checked++; if (r.width < 44 || r.height < 44) small++; });
    return { tpl: document.querySelectorAll('#edstart [data-tpl]').length, dup: document.querySelectorAll('#edstart [data-dup]').length,
             cols: document.querySelectorAll('#edstart .edscol').length, on: window.ED.on, small, checked,
             hScroll: document.documentElement.scrollWidth - window.innerWidth };
  });
  await page.click('#edsdup-stlo');
  await page.waitForFunction(() => window.ED.on, null, { timeout: 120000 });
  await frames(page, 2);
  const ed = await page.evaluate(() => {
    const helped = window.ED.panel, named = window.ED.name;
    const cats = window.ED_CATS.length;
    let tools = 0;
    window.ED_CATS.forEach(c => { tools += c.tools.length; });
    /* every category opens and every tool takes: the tray is rebuilt for each */
    let opened = 0;
    window.ED_CATS.forEach(c => { window.edOpenCat(c.id); if (document.querySelectorAll('#edtray .edtool').length === c.tools.length) opened++; });
    window.edOpenCat('select');
    /* a tool is found by what it is called and by what it is for, and the noun comes first */
    const find = {}; ['road', 'house', 'crater', 'houses', 'trees', 'bridge'].forEach(q => { find[q] = window.edSearch(q).map(t => t.id); });
    const found = find.road[0] === 'road' && find.house[0] === 'house' && find.crater[0] === 'crater' && find.houses[0] === 'house' &&
                  find.trees.indexOf('road') < 0 && find.trees.indexOf('olive') >= 0 && find.bridge.length === 3;
    /* a star keeps a tool at the top and a tool that puts something down is kept as used */
    localStorage.removeItem('ortona.edfav'); localStorage.removeItem('ortona.edrecent');
    window.edFavToggle('crater');
    const tOlive = window.edToolById('olive').t; window.edSetTool(tOlive);
    const sp = window.w2s(1400, 950); window.edTap(sp.x, sp.y);
    const placed = window.ED.data.entities.length;
    window.edOpenCat('mine');
    const mine = Array.from(document.querySelectorAll('#edtray .edtool')).map(b => b.getAttribute('data-tool'));
    window.edPalette();
    const pal = window.MOB ? null : Array.from(document.querySelectorAll('#edlist [data-tool]')).slice(0, 4).map(b => b.getAttribute('data-tool'));
    window.edUndo(); window.edFavToggle('crater');
    /* Escape: a half-drawn line goes, then the selection, then the tool */
    window.edSetTool(window.edToolById('road').t); window.ED.line = [{ x: 600, y: 600 }, { x: 700, y: 640 }];
    window.edEscape(); const lineGone = !window.ED.line;
    window.ED.sel = [window.ED.data.entities[0]]; window.edEscape(); const selKept = window.ED.sel.length === 0 && window.ED.tool && window.ED.tool.id === 'road';
    window.edEscape(); const toolDown = !window.ED.tool;
    /* every tool says what its next action is */
    let modes = {}; window.ED_CATS.forEach(c => c.tools.forEach(t => { modes[window.edModeOf(t)] = (modes[window.edModeOf(t)] || 0) + 1; }));
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
    /* a desktop's tools down the left and what is picked down the right, the map between */
    const L = document.getElementById('edleft').getBoundingClientRect(), R = document.getElementById('edright').getBoundingClientRect();
    const cols = window.MOB ? 'thumb' : (L.width > 200 && R.width > 200 && L.left === 0 && Math.round(R.right) === window.innerWidth ? 'ok' : `left ${Math.round(L.width)} right ${Math.round(R.width)}`);
    let rowsSmall = 0; if (!window.MOB) document.querySelectorAll('#edlist .edptool').forEach(b => { if (b.getBoundingClientRect().height < 32) rowsSmall++; });
    return { on: window.ED.on, cats, tools, opened, small, checked, helped, named, gen, dirty, houses, tiles, ground, rebuildMs, nTiles: window.PT_N,
             find, found, placed, mine, pal, lineGone, selKept, toolDown, modes, cols, rowsSmall,
             saved: document.getElementById('edsaved').textContent };
  });
  ok('the editor opens on three ways to start', chooser.cols === 3 && chooser.tpl === 5 && chooser.dup === 4 && !chooser.on && chooser.small === 0 && chooser.hScroll <= 0,
     `${chooser.tpl} templates, ${chooser.dup} maps to copy, ${chooser.checked} controls with ${chooser.small} small, editor ${chooser.on ? 'ALREADY OPEN' : 'not yet open'}`);
  ok('map editor opens on the copy, with no page of instructions over it', ed.on && !ed.helped && ed.named === 'Saint-Lô (copy)',
     `${ed.cats} categories, ${ed.tools} tools, named "${ed.named}", ${ed.helped ? 'panel ' + ed.helped + ' OPEN' : 'nothing over the map'}, "${ed.saved}"`);
  ok('a tool is found by what it is called or what it is for', ed.found,
     `road: ${ed.find.road.slice(0, 3)} | house: ${ed.find.house.slice(0, 3)} | crater: ${ed.find.crater.slice(0, 3)} | trees: ${ed.find.trees.slice(0, 3)}`);
  ok('a starred tool and a used one are kept at hand', ed.mine[0] === 'crater' && ed.mine.indexOf('olive') > 0 && (ed.pal === null || (ed.pal[1] === 'crater' && ed.pal.indexOf('olive') >= 0)),
     `MINE ${ed.mine.join(',')}${ed.pal ? `, column ${ed.pal.join(',')}` : ''}`);
  ok('Escape takes back the half-drawn line, then the selection, then the tool', ed.lineGone && ed.selKept && ed.toolDown);
  ok('every tool says whether it takes a click, a stroke, a box or a brush', Object.keys(ed.modes).every(m => ['CLICK', 'STROKE', 'BOX', 'BRUSH', 'PAINT'].indexOf(m) >= 0),
     Object.keys(ed.modes).map(m => `${m} ${ed.modes[m]}`).join(', '));
  ok('a desktop has the tools on the left and the options on the right', ed.cols === 'ok' || ed.cols === 'thumb', `${ed.cols}${ed.rowsSmall ? `, ${ed.rowsSmall} rows under 32px` : ''}`);
  ok('every editor category opens its tray', ed.opened === ed.cats, `${ed.opened}/${ed.cats}`);
  ok('editor controls are at least 44px', ed.small === 0, `${ed.checked} controls checked, ${ed.small} small`);
  ok('generated maps come back clean from the check', ed.gen > 0 && ed.dirty === 0, `${ed.gen} maps, ${ed.dirty} with problems, ${Math.round(ed.houses / ed.gen)} houses each`);
  ok('a placed house rebuilds a few tiles and no ground', ed.tiles > 0 && ed.tiles <= 8 && !ed.ground, `${ed.tiles} of ${ed.nTiles} tiles, ${ed.rebuildMs} ms under SwiftShader`);
  /* the overhaul, asked as arithmetic: shapes edited on the map, a placement shown before it is
     put down, snapping that knows what it is snapping, streets that meet, groups, the planning
     view and its layers, the guide, the advisor and its fix, restore points, the layout fill,
     the area brush and the whole map moved. Every edit in it is undone at the end, and the map
     has to come back to the byte, because an editor whose undo misses one kind of edit loses
     somebody's afternoon. */
  const ov = await page.evaluate(() => {
    const W = window, ED = W.ED, E = () => ED.data.entities, out = {};
    W.edSetTool(null); ED.sel = []; ED.undo = []; ED.redo = [];
    const start = JSON.stringify(ED.data);
    function look(x, y, d) { W.CAM.tx = x; W.CAM.ty = y; W.CAM.dist = d; W.CAM.pitch = 1.1; W.CAM.yaw = Math.PI / 2; W.clampCam(); W.updateCamera(); }
    function drag(h, dx, dy) { const s = W.w2s(h.x, h.y), d = W.edHandleDown(h, h.x, h.y, s.x, s.y); W.edHandleMove(d, h.x + dx, h.y + dy); d.moved = true; W.edHandleUp(d); ED.drag = null; }
    /* a house: four corners, four edges and a turn; a corner dragged out makes it bigger and the
       turn carried a quarter of the way round turns it a quarter, because a house is square to the map */
    const h = E().find(e => e.t === 'house' && e.w && e.x > 600 && e.x < 2200);
    ED.sel = [h]; look(h.x, h.y, 520);
    const hs = W.edHandles(), hk = {}; hs.forEach(q => { hk[q.k] = (hk[q.k] || 0) + 1; });
    const w0 = h.w, h0 = h.h, c = hs.find(q => q.k === 'corner'); drag(c, 20 * c.sx, 14 * c.sy);
    const dw = Math.round(h.w - w0), dh = Math.round(h.h - h0), w1 = h.w, h1 = h.h;
    const rot = W.edHandles().find(q => q.k === 'rot'), hf = W.edFoot(h), R = Math.hypot(rot.x - hf.x, rot.y - hf.y);
    drag(rot, hf.x + R - rot.x, hf.y - rot.y);
    out.house = { hk, dw, dh, turned: h.w === h1 && h.h === w1 };
    /* a line: a handle at every point and between every two; a mid dragged is a new point, a
       point can be taken out, and a line keeps two */
    const road = E().find(e => e.t === 'road' && e.pts && e.pts.length >= 2);
    ED.sel = [road]; look(road.pts[0].x, road.pts[0].y, 600);
    const rh = W.edHandles(), n0 = road.pts.length, mids = rh.filter(q => q.k === 'mid').length, pts = rh.filter(q => q.k === 'pt').length;
    drag(rh.find(q => q.k === 'mid'), 10, 10); const ins = road.pts.length;
    W.edDeletePoint(road, 1); const del = road.pts.length;
    const two = { t: 'trench', pts: [{ x: 500, y: 500 }, { x: 600, y: 500 }] }; W.edDeletePoint(two, 0);
    out.line = { n0, pts, mids, ins, del, two: two.pts.length };
    /* a house carried over another says so before it goes down, and shows the far side's copy */
    ED.sel = []; const oh = E().find(e => e.t === 'house' && e.w && e.x > 600 && e.x < 1100 && e !== h);
    W.edSetTool(W.edToolById('house').t); ED.hover = { x: oh.x + 6, y: oh.y + 4 }; ED.pv = null;
    if (W.MOB) ED.drag = { kind: 'ghost', moved: true, x: oh.x + 6, y: oh.y + 4 };
    const pv = W.edPreviewList(); ED.drag = null;
    out.preview = { n: pv ? pv.list.length : -1, mir: pv && pv.mir ? pv.mir.length : -1, over: pv ? pv.conf.filter(q => /^Overlaps/.test(q.msg)).length : -1, worst: pv ? pv.worst : -1 };
    W.edSetTool(null);
    /* a road's end finds a road's end, and Alt lets the hand go */
    const e0 = road.pts[0], sp = W.edSnapPt(e0.x + 5, e0.y + 4, 'road');
    W.keys.alt = true; const raw = W.edSnapPt(e0.x + 5, e0.y + 4, 'road'); delete W.keys.alt;
    out.snap = { end: sp.k, endAt: Math.round(Math.hypot(sp.x - e0.x, sp.y - e0.y)), alt: raw.k, altAt: Math.round(Math.hypot(raw.x - e0.x, raw.y - e0.y)) };
    /* widths by name, and the one lit is the one the street is */
    out.presets = W.ED_PRESETS.road.map(p => { W.edPresetApply('road', p, road); return W.edPresetOn('road', p, road) ? road.width : -1; });
    /* two streets drawn across each other meet at a junction: four pieces end there */
    const rt = W.edToolById('road').t;
    W.edAddRoads(W.edLineEntity(rt, [{ x: 300, y: 600 }, { x: 300, y: 1300 }]));
    W.edAddRoads(W.edLineEntity(rt, [{ x: 150, y: 950 }, { x: 520, y: 950 }]));
    out.atX = E().filter(e => e.t === 'road' && e.pts.some(p => Math.hypot(p.x - 300, p.y - 950) < 1)).length;
    /* a composition is one group: a tap takes all of it, it turns and spreads as one, a filter
       keeps a layer of it, and it comes apart */
    const g = W.edGroup(W.edCompose('farmstead', 420, 1500, () => .5)); W.edAddMany(g);
    const gid = g[0].gid, members = E().filter(e => e.gid === gid).length;
    const hit = W.edPick(g[0].x + (W.edBoxy(g[0]) ? g[0].w / 2 : 0), g[0].y + (W.edBoxy(g[0]) ? g[0].h / 2 : 0));
    ED.sel = W.edGroupOf(hit); const groupSel = ED.sel.length;
    const spreadOf = m => ED.sel.reduce((s, e) => { const f = W.edFoot(e); return s + (f.k === 'line' ? 0 : Math.hypot(f.x - m.x, f.y - m.y)); }, 0);
    const mid0 = W.edSelMid(ED.sel); W.edRotateSel(Math.PI / 2); const mid1 = W.edSelMid(ED.sel), sp0 = spreadOf(mid1);
    W.edSpaceSel(1.25); const sp1 = spreadOf(W.edSelMid(ED.sel));
    W.edFilterSel(o => W.edLayerOf(o) === 'foliage'); const kept = ED.sel.length, keptAll = ED.sel.every(o => W.edLayerOf(o) === 'foliage');
    ED.sel = W.edGroupOf(hit); W.edBreakApart(); const broke = E().filter(e => e.gid === gid).length;
    ED.sel = g.filter(e => E().indexOf(e) >= 0); W.edDeleteSel(); ED.sel = [];
    out.group = { members, groupSel, held: Math.round(Math.hypot(mid1.x - mid0.x, mid1.y - mid0.y)), spread: +(sp1 / sp0).toFixed(2), kept, keptAll, broke };
    /* a box held over a block takes everything in it */
    W.edMarquee(1250, 850); W.edMove(1550, 1050); W.edUp(); out.marquee = ED.sel.length; ED.sel = [];
    /* the planning view looks straight down; the roofs are a layer of their own; a locked layer is not picked */
    W.edPlanSet(true); W.updateCamera();
    const lays = {}; W.SCENE.tiles.forEach(t => (t.parts || []).forEach(p => { lays[p.lay] = (lays[p.lay] || 0) + 1; }));
    out.plan = { pitch: +W.MAT.pitch.toFixed(3), lays };
    W.edLaySet('roofs', 'hide', 1); out.plan.roofsHidden = !W.edLayShown('roofs'); W.edLaySet('roofs', 'hide', 0);
    W.edLaySet('buildings', 'lock', 1); const lp = W.edPick(oh.x, oh.y); W.edLaySet('buildings', 'lock', 0); const fp = W.edPick(oh.x, oh.y);
    out.plan.locked = lp ? lp.t : null; out.plan.unlocked = fp ? fp.t : null;
    W.edPlanSet(false); W.updateCamera(); out.plan.back = +W.MAT.pitch.toFixed(3);
    /* the guide is as wide as the thing it stands for, in metres */
    out.guide = {}; ['squad', 'jeep', 'tank', 'heavy'].forEach(k => { W.edGuideSet(k); ED.hover = { x: 1400, y: 950 }; const q = W.edGuideAt(); out.guide[k] = q ? +(q.hw * 2 / 11.7).toFixed(2) : null; });
    W.edGuideSet('');
    /* the advisor: every finding has a place, a reason and a suggestion, and no street is measured from inside a house */
    let t1 = performance.now(); const L = W.edAdvise(); const advMs = Math.round(performance.now() - t1);
    const by = {}; L.forEach(i => { by[i.kind] = (by[i.kind] || 0) + 1; });
    out.advise = { n: L.length, by, ms: advMs, whole: L.every(i => isFinite(i.x) && isFinite(i.y) && i.title && i.msg && i.tip), zeroRoom: L.filter(i => i.room && i.room.w < 1).length };
    /* and a fix opens the street it was asked to, with a restore point taken first */
    const fi = L.find(i => i.fix === 'choke' || i.fix === 'road');
    if (fi) {
      const r0 = W.edRoomAt(W.edSolids(), fi.x, fi.y, fi.a || 0, 70).w;
      W.edFixStart(W.edFixFor(fi)); const nm = ED.fix ? ED.fix.moves.length : -1; W.edFixApply();
      out.fix = { kind: fi.kind, moves: nm, room: [Math.round(r0), Math.round(W.edRoomAt(W.edSolids(), fi.x, fi.y, fi.a || 0, 70).w)], why: W.edPointList()[0] ? W.edPointList()[0].why : null };
    } else out.fix = null;
    /* a restore point puts the map back as it was */
    W.edPointAdd('gate'); const nBefore = E().length;
    W.edAdd(W.edNewEntity(W.edToolById('house').t, 1700, 300)); const nMid = E().length;
    W.edPointRestore(W.edPointList().findIndex(p => p.why === 'gate'));
    out.points = { nBefore, nMid, nAfter: E().length };
    /* a house put down beside a street stands back off its kerb with its front to it, either
       side, asked of that street alone so the rule and not the town round it is measured */
    W.edAddRoads(W.edLineEntity(rt, [{ x: 180, y: 300 }, { x: 600, y: 300 }]));
    const nr = E().find(e => e.t === 'road' && e.pts.some(p => Math.hypot(p.x - 600, p.y - 300) < 1)), nhw = (nr.width || 48) / 2;
    const keepE = ED.data.entities; ED.data.entities = [nr];
    const sbS = W.edSnapBuilding({ x: 390, y: 300 + nhw + 70, w: 90, h: 80 }), sbN = W.edSnapBuilding({ x: 390, y: 300 - nhw - 70, w: 90, h: 80 });
    ED.data.entities = keepE;
    out.frontage = sbS && sbN ? { front: [sbS.front, sbN.front], kerb: [Math.round(sbS.y - 40 - (300 + nhw)), Math.round((300 - nhw) - (sbN.y + 40))] } : null;
    /* an area sketched round that street fills with houses along it that clash with nothing,
       and the far side's twin with as many; fields and woods fill too */
    const mk = (kind, p) => { const e = W.edLineEntity(W.edToolById('z' + kind).t, p)[0]; W.edAddMany([e]); return e; };
    const v = mk('village', [{ x: 150, y: 180 }, { x: 640, y: 180 }, { x: 640, y: 430 }, { x: 150, y: 430 }]);
    const fz = mk('fields', [{ x: 150, y: 1380 }, { x: 700, y: 1380 }, { x: 700, y: 1780 }, { x: 150, y: 1780 }]);
    const wz = mk('woods', [{ x: 760, y: 1450 }, { x: 980, y: 1400 }, { x: 1020, y: 1700 }, { x: 800, y: 1760 }]);
    t1 = performance.now(); W.edFill([v, fz, wz]); const fillMs = Math.round(performance.now() - t1);
    const of = z => E().filter(e => e.gid && e.gid === z.fill), vm = of(v), tw = W.edTwinZone(v);
    out.fill = { ms: fillMs, houses: vm.filter(e => e.t === 'house').length, conf: W.edConflicts(vm, vm).map(q => q.msg), twin: tw ? of(tw).filter(e => e.t === 'house').length : 0,
                 fields: of(fz).filter(e => e.t === 'field').length, trees: of(wz).filter(e => e.t === 'tree').length };
    /* an area brush lays its trees no nearer each other than its gap, as one group */
    const ab = W.edToolById('agrove').t; W.edSetTool(ab); ED.brush.r = 70; const gap = W.edAreaSet(ab).gap, nb = E().length;
    W.edAreaFill(ab, [{ x: 1100, y: 1650 }, { x: 1160, y: 1680 }, { x: 1220, y: 1700 }]);
    const br = E().slice(nb).filter(e => e.t === 'tree' && e.x < 1400); let near = 1e9;
    for (let i = 0; i < br.length; i++) for (let j = i + 1; j < br.length; j++) near = Math.min(near, Math.hypot(br[i].x - br[j].x, br[i].y - br[j].y));
    W.edSetTool(null);
    out.brush = { n: br.length, gap, near: Math.round(near), grouped: br.length > 1 && br.every(e => e.gid && e.gid === br[0].gid) };
    /* the whole map: room added along one edge moves everything over, a quarter turn swaps its
       sides, and turning back and taking the room away again puts every headquarters where it was */
    const S0 = W.edWorldSize(), hq = E().find(e => e.t === 'hq'), hx = hq.x, hy = hq.y, ent0 = E().length;
    W.edWorldGrow(0, 200, 0, 200); const S1 = W.edWorldSize(), dy1 = Math.round(E().find(e => e.t === 'hq').y - hy);
    W.edWorldTurn(1); const S2 = W.edWorldSize();
    W.edWorldTurn(3); W.edWorldGrow(0, -200, 0, -200); const S3 = W.edWorldSize(), hq3 = E().find(e => e.t === 'hq');
    out.world = { S0: [S0.w, S0.h], S1: [S1.w, S1.h], S2: [S2.w, S2.h], S3: [S3.w, S3.h], dy1, back: [Math.round(hq3.x - hx), Math.round(hq3.y - hy)], kept: E().length === ent0 };
    let steps = 0; while (ED.undo.length && steps < 80) { W.edUndo(); steps++; }
    out.undo = { steps, same: JSON.stringify(ED.data) === start };
    W.edRebuildNow();
    return out;
  });
  ok('a house has corner, edge and turn handles, and they size it and turn it a quarter', ov.house.hk.corner === 4 && ov.house.hk.edge === 4 && ov.house.hk.rot === 1 && ov.house.dw > 0 && ov.house.dh > 0 && ov.house.turned,
     `${JSON.stringify(ov.house.hk)}, a corner grew it ${ov.house.dw} by ${ov.house.dh}, ${ov.house.turned ? 'turned' : 'NOT turned'}`);
  ok('a line takes a point at a mid handle, gives one up, and keeps two', ov.line.pts === ov.line.n0 && ov.line.mids === ov.line.n0 - 1 && ov.line.ins === ov.line.n0 + 1 && ov.line.del === ov.line.n0 && ov.line.two === 2,
     `${ov.line.n0} points with ${ov.line.mids} between, ${ov.line.ins} after a mid drag, ${ov.line.del} after a delete, a line of two keeps ${ov.line.two}`);
  ok('a placement shows its mirrored copy and what it would overlap before it goes down', ov.preview.n === 1 && ov.preview.mir === 1 && ov.preview.over > 0 && ov.preview.worst === 2,
     `${ov.preview.n} placed, ${ov.preview.mir} mirrored, ${ov.preview.over} overlaps, worst ${ov.preview.worst}`);
  ok('a house snaps to a street frontage either side, a road end to a road end, and Alt lets go',
     ov.frontage && ov.frontage.front[0] === 1 && ov.frontage.front[1] === 0 && ov.frontage.kerb.every(k => k >= 0 && k <= 12) && ov.snap.end === 'end' && ov.snap.endAt === 0 && !ov.snap.alt && ov.snap.altAt > 0,
     `${ov.frontage ? `fronts ${ov.frontage.front}, ${ov.frontage.kerb} off the kerb` : 'NO FRONTAGE'}, end ${ov.snap.end} at ${ov.snap.endAt}, Alt ${ov.snap.alt || 'free'} at ${ov.snap.altAt}`);
  ok('a street\'s widths are offered by name and the lit one is its width', ov.presets.join() === '34,52,76', ov.presets.join(', '));
  ok('two streets drawn across each other meet at a junction', ov.atX === 4, `${ov.atX} pieces end at the crossing`);
  ok('a composition is one group: picked, turned and spaced as one, filtered, broken apart',
     ov.group.members > 3 && ov.group.groupSel === ov.group.members && ov.group.held <= 1 && Math.abs(ov.group.spread - 1.25) < .03 && ov.group.keptAll && ov.group.kept > 0 && ov.group.kept < ov.group.members && ov.group.broke === 0,
     `${ov.group.members} in it, a tap took ${ov.group.groupSel}, turned about its middle (moved ${ov.group.held}), spread ${ov.group.spread}x, foliage kept ${ov.group.kept}, ${ov.group.broke} left grouped after breaking`);
  ok('a box held over a block takes everything in it', ov.marquee >= 5, `${ov.marquee} taken`);
  ok('the planning view looks straight down, the roofs are a layer, and a locked layer is not picked',
     ov.plan.pitch > 1.5 && ov.plan.back < 1.4 && ov.plan.lays.roofs > 0 && ov.plan.lays.buildings > 0 && ov.plan.roofsHidden && ov.plan.locked !== 'house' && ov.plan.unlocked === 'house',
     `pitch ${ov.plan.pitch} and back to ${ov.plan.back}, ${JSON.stringify(ov.plan.lays)}, locked picks ${ov.plan.locked}, unlocked ${ov.plan.unlocked}`);
  ok('the guide is as wide as the thing it stands for', ov.guide.tank > 2.4 && ov.guide.tank < 2.9 && ov.guide.jeep < ov.guide.tank && ov.guide.heavy > ov.guide.tank && ov.guide.squad > ov.guide.heavy,
     Object.keys(ov.guide).map(k => `${k} ${ov.guide[k]} m`).join(', '));
  ok('every finding of the advisor has a place, a reason and a suggestion, and none is measured from inside a house', ov.advise.n > 0 && ov.advise.whole && ov.advise.zeroRoom === 0,
     `${ov.advise.n} findings ${JSON.stringify(ov.advise.by)} in ${ov.advise.ms} ms`);
  ok('a fix opens the street it was asked to, with a restore point first', ov.fix && ov.fix.moves > 0 && ov.fix.room[1] > ov.fix.room[0] && ov.fix.room[1] >= 60 && ov.fix.why === 'before a fix',
     ov.fix ? `${ov.fix.kind}: ${ov.fix.moves} moved, ${ov.fix.room[0]} to ${ov.fix.room[1]} units of room, point "${ov.fix.why}"` : 'NOTHING TO FIX');
  ok('a restore point puts the map back as it was', ov.points.nMid > ov.points.nBefore && ov.points.nAfter === ov.points.nBefore, `${ov.points.nBefore}, ${ov.points.nMid}, ${ov.points.nAfter} things`);
  ok('an area round a street fills with houses that clash with nothing, mirrored, and fields and woods fill',
     ov.fill.houses >= 3 && ov.fill.conf.length === 0 && ov.fill.twin === ov.fill.houses && ov.fill.fields >= 1 && ov.fill.trees >= 8,
     `${ov.fill.houses} houses (${ov.fill.twin} across), ${ov.fill.conf.length} clashes ${ov.fill.conf.slice(0, 2).join('; ')}, ${ov.fill.fields} fields, ${ov.fill.trees} trees, ${ov.fill.ms} ms`);
  ok('an area brush keeps its gap and lays one group', ov.brush.n >= 2 && ov.brush.near >= ov.brush.gap && ov.brush.grouped, `${ov.brush.n} trees, nearest two ${ov.brush.near} apart against a gap of ${ov.brush.gap}`);
  ok('the whole map grows, turns and comes back', ov.world.S1[1] === ov.world.S0[1] + 200 && ov.world.dy1 === 200 && ov.world.S2[0] === ov.world.S1[1] && ov.world.S3.join() === ov.world.S0.join() && ov.world.back.join() === '0,0' && ov.world.kept,
     `${ov.world.S0.join('x')} to ${ov.world.S1.join('x')}, turned ${ov.world.S2.join('x')}, back ${ov.world.S3.join('x')}, headquarters off by ${ov.world.back}`);
  ok('every one of those edits undoes back to the map it started from', ov.undo.same, `${ov.undo.steps} undos`);

  /* what a thumb has to hit in the sheet and the panels the overhaul added: 44px on a phone,
     and on a desktop's columns nothing a mouse cannot find */
  const ctl = await page.evaluate(() => {
    const W = window, ED = W.ED, E = ED.data.entities, floor = W.MOB ? 44 : 24, out = { checked: 0, small: [] };
    function measure(where, sel) {
      document.querySelectorAll(sel).forEach(b => { const r = b.getBoundingClientRect(); if (!r.width || !r.height) return; out.checked++; if (r.height < floor - .5 || r.width < floor - .5) out.small.push(where + ':' + (b.id || b.textContent.trim().slice(0, 14)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
    }
    const sheet = '#edsheet .edb, #edsheet input, #edsheet select', panel = '#edpanel .edb, #edpanel input';
    ED.sel = [E.find(e => e.t === 'house' && e.w)]; W.edProps(); measure('house', sheet);
    ED.sel = [E.find(e => e.t === 'road' && e.pts)]; W.edProps(); measure('road', sheet);
    ED.sel = E.filter(e => e.t === 'tree').slice(0, 6); W.edProps(); measure('many', sheet);
    ED.sel = []; ED.issues = W.edAdvise(); W.edIssueGo(0); measure('issue', sheet); ED.issues = null; ED.issue = -1;
    W.edPanelView(); measure('view', panel); W.edPanelClose();
    W.edPanelWorld(); measure('world', panel); W.edPanelClose();
    W.edPanelPoints(); measure('points', panel); W.edPanelClose();
    W.edPanel('CHECK', ''); ED.issues = W.edAdvise(); W.edPanelCheckShow(); measure('check', panel); W.edPanelClose(); ED.issues = null;
    W.edOpenCat('layout'); measure('layout', '#edtray .edtool, #edlist [data-tool]');
    ED.sel = []; W.edProps(); W.edOpenCat('select');
    return out;
  });
  ok(`the overhaul's sheets and panels are ${device === 'phone' ? '44px' : 'big enough for a mouse'}`, ctl.small.length === 0, `${ctl.checked} controls checked${ctl.small.length ? ', small: ' + ctl.small.slice(0, 4).join(', ') : ''}`);

  /* TEST and back: one click into the battle and one out of it, with the camera, the tool, the
     selection and the undo history where they were */
  const edPre = await page.evaluate(() => {
    const W = window, ED = W.ED; W.edSetTool(null);
    W.CAM.tx = 900; W.CAM.ty = 700; W.CAM.dist = 640; W.CAM.pitch = 1.05; W.CAM.yaw = Math.PI / 2;
    const h = ED.data.entities.find(e => e.t === 'house' && e.w); W.edSnapshot(); ED.sel = [h]; W.edSetTool(W.edToolById('crater').t); ED.sel = [h];
    return { cam: [W.CAM.tx, W.CAM.ty, W.CAM.dist], tool: ED.tool && ED.tool.id, undo: ED.undo.length, sel: ED.sel.length };
  });
  await page.click('#edtest');
  await page.waitForFunction(() => window.G.running && window.SCENE.ready && !window.ED.on, null, { timeout: 180000 });
  await frames(page, 2);
  const edTedit = await page.evaluate(() => { const b = document.getElementById('tedit'), r = b.getBoundingClientRect(); return { shown: !b.classList.contains('hidden') && r.width > 0, w: Math.round(r.width), h: Math.round(r.height) }; });
  await page.click('#tedit');
  await page.waitForFunction(() => window.ED.on && !window.G.running, null, { timeout: 180000 });
  await frames(page, 2);
  const edPost = await page.evaluate(() => { const W = window, ED = W.ED; return { cam: [Math.round(W.CAM.tx), Math.round(W.CAM.ty), Math.round(W.CAM.dist)], tool: ED.tool && ED.tool.id, undo: ED.undo.length, sel: ED.sel.length,
                                                 back: !document.getElementById('tedit').classList.contains('hidden') }; });
  ok('TEST goes into the battle and EDIT MAP comes back to the same camera, tool, selection and undo',
     edTedit.shown && edTedit.w >= 44 && edTedit.h >= 44 && edPost.cam.join() === edPre.cam.map(Math.round).join() && edPost.tool === edPre.tool && edPost.undo === edPre.undo && edPost.sel === edPre.sel && !edPost.back,
     `EDIT MAP ${edTedit.shown ? `${edTedit.w}x${edTedit.h}` : 'NOT SHOWN'}; camera ${edPost.cam} against ${edPre.cam.map(Math.round)}, tool ${edPost.tool} against ${edPre.tool}, undo ${edPost.undo}/${edPre.undo}, selected ${edPost.sel}/${edPre.sel}`);
  await page.evaluate(() => { window.edSetTool(null); window.ED.sel = []; });

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
