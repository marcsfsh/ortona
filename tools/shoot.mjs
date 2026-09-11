#!/usr/bin/env node
/* Screenshot Ortona.
 *
 *   node tools/shoot.mjs                       every scene, desktop
 *   node tools/shoot.mjs battle --sim=90       90s of fighting, then a photo
 *   node tools/shoot.mjs start hud --device=phone
 *   node tools/shoot.mjs armour --turn         every vehicle, four angles each
 *   node tools/shoot.mjs free --cam=1400,950,700,1.57,0.9 --sim=30 --bare
 *
 * Output lands in shots/<device>/. Read the PNGs back to judge the visuals.
 */

import { launch, openGame, deploy, openEditor, fastForward, frames, camera, chrome,
         setFog, pose, flatSpot, state, catalog, shoot, turntable, lookAt, pause,
         reveal, drawable, unlockCamera, parseArgs, deviceNames, SHOTS, ROOT } from './harness.mjs';
import path from 'node:path';
import fs from 'node:fs';

const args = parseArgs(process.argv.slice(2));
const DEVICE = args.device || 'desktop';
const SIM = args.sim === undefined ? 0 : Number(args.sim);
const SIDE = args.side || 'us';
const DIFF = args.diff === undefined ? 1 : Number(args.diff);
const BARE = !!args.bare;               /* hide the flat UI, keep only the 3D */
const TURN = !!args.turn;               /* four angles instead of one */
const SETTLE = args.settle === undefined ? 2 : Number(args.settle);
const TAG = args.tag ? `-${args.tag}` : '';

const out = (name) => path.join(SHOTS, DEVICE, `${name}${TAG}.png`);

/* ------------------------------------------------------------------ scenes */

const SCENES = {

  start: {
    help: 'Title screen: faction picks, difficulty, briefing copy.',
    async run(page) {
      await shoot(page, out('start'), { settle: 1 });
      await page.click('#pickger');
      await shoot(page, out('start-ger'), { settle: 1 });
    }
  },

  battle: {
    help: 'The live battlefield from the default opening camera (use --sim to let it develop).',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      if (SIM) await fastForward(page, SIM);
      if (args.nofog) await setFog(page, false);
      if (BARE) await chrome(page, false);
      await shoot(page, out('battle'), { settle: SETTLE });
    }
  },

  hud: {
    help: 'In-game with a squad selected, so the command panel and orders are populated.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      if (SIM) await fastForward(page, SIM);
      if (args.nofog) await setFog(page, false);
      await page.evaluate(s => {
        const u = window.G.units.find(u => u.side === s && u.cat === 'inf');
        if (u) { select([u]); window.__o.camera({ x: u.x, y: u.y, dist: 420, pitch: 0.86 }); }
        syncHud();
      }, SIDE);
      await shoot(page, out('hud'), { settle: SETTLE });

      /* The build menu: select the HQ so its production cards show. */
      await page.evaluate(s => {
        const b = window.G.blds.find(b => b.side === s && b.def.hq);
        if (b) { select([b]); window.__o.camera({ x: b.x, y: b.y, dist: 500, pitch: 0.9 }); }
        syncHud();
      }, SIDE);
      await shoot(page, out('hud-build'), { settle: SETTLE });
    }
  },

  closeup: {
    help: 'Ground-level look at the player HQ and the squads around it.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      if (SIM) await fastForward(page, SIM);
      if (args.nofog) await setFog(page, false);
      if (BARE) await chrome(page, false);
      await lookAt(page, { side: SIDE, dist: 240, pitch: 0.62 });
      await shoot(page, out('closeup-squad'), { settle: SETTLE });
      await page.evaluate(s => {
        const b = window.G.blds.find(b => b.side === s && b.def.hq);
        if (b) window.__o.camera({ x: b.x, y: b.y, dist: 300, pitch: 0.55 });
      }, SIDE);
      await shoot(page, out('closeup-hq'), { settle: SETTLE });
    }
  },

  terrain: {
    help: 'Wide shots of the town, the coast and the rail line: read the ground and the light.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      await setFog(page, false);
      if (BARE) await chrome(page, false);
      const w = (await catalog(page)).world;
      const spots = [
        ['town',  { x: w.w * 0.50, y: w.h * 0.52, dist: 1400, pitch: 1.10 }],
        ['coast', { x: w.w * 0.50, y: w.h * 0.14, dist: 900,  pitch: 0.70 }],
        ['rail',  { x: w.w * 0.50, y: w.h * 0.90, dist: 900,  pitch: 0.70 }],
        ['west',  { x: w.w * 0.18, y: w.h * 0.55, dist: 800,  pitch: 0.75 }],
        ['east',  { x: w.w * 0.82, y: w.h * 0.55, dist: 800,  pitch: 0.75 }]
      ];
      for (const [name, cam] of spots) {
        await camera(page, cam);
        await shoot(page, out(`terrain-${name}`), { settle: SETTLE });
      }
    }
  },

  editor: {
    help: 'The map editor: palette, property panel and the placement hint line.',
    async run(page) {
      await openEditor(page);
      await shoot(page, out('editor'), { settle: SETTLE });
      await page.click('.edb[data-tool="place"]');
      await shoot(page, out('editor-place'), { settle: 1 });
    }
  },

  over: {
    help: 'The end-of-battle screen.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      await page.evaluate(s => endGame(s, 'Test capture'), SIDE);
      await shoot(page, out('over'), { settle: 1 });
    }
  },

  /* ---- model galleries: the reason this harness exists ---- */

  infantry: { help: 'Every infantry and weapon-team model, posed on level ground.',
              run: (page) => gallery(page, 'infantry', u => u.cat === 'inf' || u.cat === 'team') },

  armour:   { help: 'Every vehicle model, posed on level ground.',
              run: (page) => gallery(page, 'armour', u => u.cat === 'veh') },

  models:   { help: 'The whole roster, one photo per unit type.',
              run: (page) => gallery(page, 'models', () => true) },

  lineup: {
    help: 'One shot per side with the entire roster stood in a row.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      await setFog(page, false);
      await chrome(page, false);
      await unlockCamera(page, 40, 0.12);
      const cat = await catalog(page);
      const SPACING = 78;
      const widest = Math.max(...['us', 'ger'].map(s => cat.units.filter(u => u.side === s).length));
      /* Room for the whole row plus a margin, or the shot ends up with a
       * building in the front of frame and half the roster on a slope. */
      const spot = await flatSpot(page, ((widest - 1) * SPACING) / 2 + 90);
      console.log(`  stage at (${spot.x}, ${spot.y}), ${spot.clear} units clear, height spread ${spot.dev.toFixed(1)}`);
      for (const side of ['us', 'ger']) {
        const keys = cat.units.filter(u => u.side === side).map(u => u.key);
        const specs = keys.map((k, i) => ({ key: k, x: (i - (keys.length - 1) / 2) * SPACING, y: 0, facing: -Math.PI / 2 }));
        await pose(page, specs, spot);
        await camera(page, { x: spot.x, y: spot.y - 20, dist: Number(args.dist) || 400, pitch: Number(args.pitch) || 0.6, yaw: Math.PI / 2 });
        console.log(`  ${side}: ${(await drawable(page)).units}/${specs.length} models in the draw list`);
        await shoot(page, out(`lineup-${side}`), { settle: SETTLE });
      }
    }
  },

  buildings: {
    help: 'The six base structures, each photographed on its own.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      await setFog(page, false);
      await chrome(page, false);
      await unlockCamera(page, 40, 0.12);
      const cat = await catalog(page);
      const spot = await flatSpot(page, 170);
      for (const b of cat.buildings) {
        await page.evaluate(a => {
          window.G.blds.length = 0; window.G.units.length = 0; window.G.sel.length = 0;
          spawnBuilding(a.side, a.key, a.x, a.y, true);
          rebuildGrid(); computeVisibility(); window.__o.reveal();
        }, { side: b.side, key: b.key, x: spot.x, y: spot.y });
        await camera(page, { x: spot.x, y: spot.y, dist: Number(args.dist) || 230, pitch: Number(args.pitch) || 0.52, yaw: Math.PI / 2 + 0.5 });
        if ((await drawable(page)).blds === 0) console.error(`  WARNING: ${b.key} is not in the draw list -- the shot will be empty`);
        await shoot(page, out(`bld-${b.key}`), { settle: SETTLE });
      }
    }
  },

  /* ---- free camera: the escape hatch for anything the scenes above miss ---- */

  free: {
    help: 'Deploy, then point the camera wherever --cam=x,y,dist,yaw,pitch says.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      if (SIM) await fastForward(page, SIM);
      if (args.nofog) await setFog(page, false);
      if (BARE) await chrome(page, false);
      if (args.cam) {
        const [x, y, dist, yaw, pitch] = String(args.cam).split(',').map(Number);
        await camera(page, { x, y, dist, yaw, pitch });
      }
      await shoot(page, out(args.name || 'free'), { settle: SETTLE });
    }
  }
};

/* Pose one unit type at a time on clean ground and photograph it.
 * Camera limits are lifted here: these are model reference shots, closer than
 * any in-game camera goes. Use `battle` or `closeup` to judge playing scale. */
async function gallery(page, label, filter) {
  await deploy(page, { side: SIDE, diff: DIFF });
  await setFog(page, false);
  await chrome(page, false);
  await unlockCamera(page, 40, 0.12);
  const spot = await flatSpot(page, 150);
  const cat = await catalog(page);
  const keys = cat.units.filter(filter).map(u => u.key);
  console.log(`  staging ${keys.length} models at (${spot.x}, ${spot.y}), height spread ${spot.dev.toFixed(1)}`);

  for (const key of keys) {
    const unit = cat.units.find(u => u.key === key);
    await pose(page, [{ key, x: 0, y: 0, facing: -Math.PI / 2 }], spot);
    /* Vehicles are roughly twice the footprint of a squad, so they need twice
     * the standoff to fill the same fraction of the frame. */
    const dist = Number(args.dist) || (unit.cat === 'veh' ? 115 : 72);
    const pitch = Number(args.pitch) || 0.5;
    await camera(page, { x: spot.x, y: spot.y, dist, pitch, yaw: Math.PI / 2 + 0.6 });
    if ((await drawable(page)).units === 0) console.error(`  WARNING: ${key} is not in the draw list -- the shot will be empty`);
    if (TURN) {
      await turntable(page, path.join(SHOTS, DEVICE, `${label}-${key}`), { x: spot.x, y: spot.y, dist, pitch });
    } else {
      await shoot(page, out(`${label}-${key}`), { settle: SETTLE });
    }
  }
}

/* -------------------------------------------------------------------- main */

if (args.list || args.help) {
  console.log('scenes:');
  for (const [k, v] of Object.entries(SCENES)) console.log(`  ${k.padEnd(11)} ${v.help}`);
  console.log(`\ndevices: ${deviceNames().join(', ')}`);
  console.log('\nflags: --device= --sim=<game seconds> --side=us|ger --diff=0|1|2 --bare --turn');
  console.log('       --settle=<frames> --tag=<suffix> --cam=x,y,dist,yaw,pitch --nofog --name=');
  console.log('       --dist=<units> --pitch=<radians>   (override gallery framing)');
  process.exit(0);
}

const wanted = args._.length ? args._ : ['start', 'battle', 'hud', 'closeup', 'terrain', 'editor'];
for (const s of wanted) if (!SCENES[s]) { console.error(`unknown scene "${s}" (try --list)`); process.exit(1); }

const t0 = Date.now();
const browser = await launch();
let failed = 0;

for (const name of wanted) {
  /* A fresh page per scene: scenes mutate global game state freely, and a
   * stale one would quietly poison the next capture. */
  const { page, context, log } = await openGame(browser, DEVICE);
  console.log(`\n[${name}] ${DEVICE}`);
  try {
    await SCENES[name].run(page);
  } catch (e) {
    failed++;
    console.error(`  FAILED: ${e.message}`);
  }
  if (log.errors.length) {
    failed++;
    console.error(`  ${log.errors.length} page error(s):`);
    for (const e of [...new Set(log.errors)].slice(0, 5)) console.error(`    ${e}`);
  }
  await context.close();
}

await browser.close();
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${path.relative(ROOT, path.join(SHOTS, DEVICE))}/`);
process.exit(failed ? 1 : 0);
