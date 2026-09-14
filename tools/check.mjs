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

  /* --- the minimap and the tactical map --- */
  await page.click('#tMap');
  await frames(page, 1);
  const mapOpen = await page.evaluate(() => document.getElementById('mini').classList.contains('big')
                                         || document.getElementById('mini').getBoundingClientRect().width > 260);
  ok('tactical map expands', mapOpen);
  await page.click('#tMap').catch(() => {});

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
