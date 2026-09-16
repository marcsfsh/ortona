#!/usr/bin/env node
/* Screenshot Ortona.
 *
 *   node tools/shoot.mjs                       every scene, desktop
 *   node tools/shoot.mjs battle --sim=90       90s of fighting, then a photo
 *   node tools/shoot.mjs start hud --device=phone
 *   node tools/shoot.mjs armour --turn         every vehicle, four angles each
 *   node tools/shoot.mjs free --cam=1400,950,700,1.57,0.9 --sim=30 --bare
 *   node tools/shoot.mjs vehicle --only=ger_p4 --up=skirts   with its field upgrades on
 *
 * Output lands in shots/<device>/. Read the PNGs back to judge the visuals.
 */

import { launch, openGame, deploy, openEditor, fastForward, frames, camera, chrome,
         setFog, pose, flatSpot, state, catalog, shoot, turntable, lookAt, pause,
         reveal, drawable, unlockCamera, modelExtent, parseArgs, deviceNames, SHOTS, ROOT } from './harness.mjs';
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
/* field upgrades to fit before photographing, e.g. --up=skirts,mg */
const UP = args.up ? String(args.up).split(',') : [];
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

  pov: {
    help: 'The periscope: a first-person look from a section, ahead and to either side.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      if (SIM) await fastForward(page, SIM);
      if (args.nofog) await setFog(page, false);
      if (BARE) await chrome(page, false);
      await page.evaluate(() => {
        const own = window.G.units.filter(u => u.side === window.G.side && !u.dead && u.cat !== 'veh');
        own.sort((a, b) => Math.abs(a.x - window.WORLD.w / 2) - Math.abs(b.x - window.WORLD.w / 2));
        window.select([own[0]], false); window.povOn(own[0]);
      });
      await shoot(page, out('pov-ahead'), { settle: SETTLE });
      for (const [name, turn] of [['left', -Math.PI / 2], ['right', Math.PI / 2]]) {
        await page.evaluate(t => { window.POV.yaw = (window.POV.u.facing || 0) + t; }, turn);
        await shoot(page, out('pov-' + name), { settle: SETTLE });
      }
      await page.evaluate(() => { window.POV.yaw = window.POV.u.facing || 0; window.POV.zoom = 2.5; });
      await shoot(page, out('pov-zoom'), { settle: SETTLE });
      await page.evaluate(() => window.povOff());
      /* and a tank: the commander up out of his hatch, then down on his seat behind the
         periscope, then looking round the turret he is sitting in */
      await page.evaluate(() => {
        const key = window.G.side === 'us' ? 'us_sher' : 'ger_kt';
        /* with its own side, or the whole town is unexplored and the view is a black wall */
        const own = window.G.units.filter(q => q.side === window.G.side && !q.dead && q.cat !== 'veh');
        own.sort((a, b) => Math.abs(a.x - window.WORLD.w / 2) - Math.abs(b.x - window.WORLD.w / 2));
        const at = own.length ? window.nearestFree(own[0].x - 70, own[0].y + 40)
                              : { x: window.WORLD.w / 2 - 220, y: window.WORLD.h / 2 };
        const u = window.spawnUnit(window.G.side, key, at.x, at.y, 0);
        window.select([u], false); window.povOn(u); window.povHatch(true); window.POV.pitch = -.12;
      });
      await shoot(page, out('pov-tank-up'), { settle: SETTLE });
      for (const [name, hatch, turn, pitch] of [['shut', false, 0, 0], ['shut-left', false, -.8, 0],
                                                ['turret', false, .7, -.75], ['crew', false, .35, -.95],
                                                ['inside', true, 0, -1.3]]) {
        await page.evaluate(([h, t, p]) => {
          window.povHatch(h);
          window.POV.yaw = (window.POV.u.inside || window.POV.u).turret + t; window.POV.pitch = p;
        }, [hatch, turn, pitch]);
        await shoot(page, out('pov-tank-' + name), { settle: SETTLE });
      }
      /* and the gun laid on something, which is what the marks in the view are for */
      await page.evaluate(() => {
        const u = window.POV.u;
        let best = null;
        for (let a = 0; a < 64 && !best; a++) {
          const ang = a * Math.PI / 32, q = window.nearestFree(u.x + Math.cos(ang) * 230, u.y + Math.sin(ang) * 230);
          if (window.fireLine(u, q) && window.dist(u, q) > 150) best = { q, ang };
        }
        if (!best) return;
        const e = window.spawnUnit(u.side === 'us' ? 'ger' : 'us', u.side === 'us' ? 'ger_p4' : 'us_sher',
                                   best.q.x, best.q.y, best.ang + Math.PI);
        window.povHatch(true); window.POV.yaw = best.ang; window.POV.pitch = -.06;
        window.DRV.took = 1; window.DRV.padFire = true;
      });
      await fastForward(page, 2);
      await shoot(page, out('pov-tank-lay'), { settle: SETTLE });
      /* and the coaxial running, so the heat on its button is in the picture */
      await page.evaluate(() => { window.DRV.padFire = false; window.DRV.padMg = true; });
      await fastForward(page, 9);
      await shoot(page, out('pov-tank-mg'), { settle: SETTLE });
      await page.evaluate(() => { window.DRV.padMg = false; window.povOff(); });
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

  /* One man, close. The infantry gallery stages a whole section at seventy-two units
     and gets a row of helmets over a sandbag wall; a model is judged one figure at a
     time, from lower than a player looks, in each posture it can hold, and against the
     distance the player really sees it from. */
  man: {
    help: 'One soldier, one posture, from four angles: --only=us_rifle --man=0 --pose=fire --dist=60',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      await setFog(page, false);
      await chrome(page, false);
      await unlockCamera(page, 12, 0.02);
      const spot = await flatSpot(page, 90);
      const cat = await catalog(page);
      const keys = (args.only ? String(args.only).split(',') : ['us_rifle', 'ger_gren'])
        .filter(k => cat.units.some(u => u.key === k && (u.cat === 'inf' || u.cat === 'team')));
      const poses = (args.pose ? String(args.pose).split(',') : ['stand', 'walk', 'fire', 'crouch', 'cfire', 'prone', 'crawl']);
      const men = args.man === undefined ? [0] : String(args.man).split(',').map(Number);
      const dist = Number(args.dist) || 58, pitch = Number(args.pitch) || 0.30;
      const steps = Number(args.steps) || (TURN ? 4 : 1);
      /* aim at the middle of him, or at the middle of a man lying down */
      const liftOf = pz => (pz === 'prone' || pz === 'crawl') ? 3 : (pz === 'crouch' || pz === 'cfire') ? 7 : 10;
      for (const key of keys) for (const man of men) for (const pz of poses) {
        const got = await page.evaluate(o => {
          /* stage the section, then leave one man of it standing in the posture asked for */
          const specs = [{ key: o.key, x: 0, y: 0, facing: -Math.PI / 2 }];
          window.__o.pose(specs, o.spot);
          const u = window.G.units[0];
          const P = { stand: POSE_STAND, walk: POSE_WALK, crouch: POSE_CROUCH, fire: POSE_FIRE,
                      cfire: POSE_CFIRE, prone: POSE_PRONE, crawl: POSE_CRAWL }[o.pose];
          let kept = null;
          u.models.forEach(function (m, i) {
            if (i !== o.man) { m.alive = false; return; }
            kept = m; m.x = o.spot.x; m.y = o.spot.y; m.f = -Math.PI / 2; m.pose = P;
            m.prone = P === POSE_PRONE || P === POSE_CRAWL;
            m.gait = o.frame * (P === POSE_CRAWL ? CRAWL_LEN / CRAWLF : STRIDE_LEN / (WALKF - 1)) + 0.01;
          });
          return kept ? { variant: variantForModel(u, o.man), x: kept.x, y: kept.y } : null;
        }, { key, man, pose: pz, spot, frame: Number(args.frame) || 0 });
        if (!got) { console.error(`  ${key} has no man ${man}`); continue; }
        const name = `man-${key}-${man}-${got.variant}-${pz}`;
        console.log(`  ${name}`);
        const lift = args.lift === undefined ? liftOf(pz) : Number(args.lift);
        if (steps > 1) await turntable(page, path.join(SHOTS, DEVICE, name + TAG), { x: got.x, y: got.y, dist, pitch, steps, lift });
        else { await camera(page, { x: got.x, y: got.y, dist, pitch, yaw: Math.PI / 2 + 0.6, lift }); await shoot(page, out(name), { settle: SETTLE }); }
      }
    }
  },

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

  vehicle: {
    help: 'Reference sheet for one vehicle: front, front 3/4, side, rear 3/4, rear, top. Use --only=<key>, --up=<upgrades>.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF });
      await setFog(page, false);
      await chrome(page, false);
      await unlockCamera(page, 30, 0.02);
      const spot = await flatSpot(page, 150);
      const cat = await catalog(page);
      const only = args.only ? String(args.only).split(',') : cat.units.filter(u => u.cat === 'veh').map(u => u.key);

      /* The camera stays put and the vehicle turns under it. The sun is fixed in
       * world space, so orbiting the camera would light a different face in every
       * frame and make the sheet useless for comparing shapes. This yaw puts the
       * sun over the camera's shoulder, which is where it flatters armour plate. */
      const CAM_YAW = Math.atan2(0.52, 0.40);
      const VIEWS = [
        ['front',   0,              0.34],
        ['front34', 0.70,           0.38],
        ['side',    Math.PI / 2,    0.20],
        ['rear34',  Math.PI - 0.70, 0.38],
        ['rear',    Math.PI,        0.34],
        ['top',     Math.PI / 2,    1.30]
      ];
      for (const key of only) {
        const u = cat.units.find(q => q.key === key);
        if (!u) { console.error(`  unknown unit "${key}"`); continue; }
        await pose(page, [{ key, x: 0, y: 0, up: UP }], spot);
        /* frame to the subject: a Tiger II is half again the length of a Stuart */
        const e = await modelExtent(page, key);
        const dist = Number(args.dist) || (e ? Math.max(70, e.len * 1.38) : 104);
        for (const [name, turn, pitch] of VIEWS) {
          await page.evaluate(a => {
            const v = window.G.units[0];
            v.facing = a.face; v.turret = a.face; v.recoil = 0; v.moving = false;
          }, { face: CAM_YAW + turn });
          await camera(page, { x: spot.x, y: spot.y, dist, yaw: CAM_YAW, pitch });
          if ((await drawable(page)).units === 0) console.error(`  WARNING: ${key} is not in the draw list`);
          await shoot(page, out(`veh-${key}-${name}`), { settle: SETTLE });
        }
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
  const only = args.only ? String(args.only).split(',') : null;
  const keys = cat.units.filter(filter).map(u => u.key).filter(k => !only || only.includes(k));
  if (!keys.length) { console.error(`  no units match --only=${args.only}`); return; }
  console.log(`  staging ${keys.length} model(s) at (${spot.x}, ${spot.y}), height spread ${spot.dev.toFixed(1)}`);

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
  console.log('       --only=<key[,key]>                 (restrict a gallery to named units)');
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
