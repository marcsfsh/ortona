#!/usr/bin/env node
/* Screenshot Ortona.
 *
 *   node tools/shoot.mjs                       every scene, desktop
 *   node tools/shoot.mjs battle --sim=90       90s of fighting, then a photo
 *   node tools/shoot.mjs start hud --device=phone
 *   node tools/shoot.mjs armour --turn         every vehicle, four angles each
 *   node tools/shoot.mjs free --cam=1400,950,700,1.57,0.9 --sim=30 --bare
 *   node tools/shoot.mjs vehicle --only=ger_p4 --up=skirts   with its field upgrades on
 *   node tools/shoot.mjs man --play --only=us_rifle,ger_gren  one man at play distance, both devices
 *   node tools/shoot.mjs man --base=HEAD --side --turn        before and after in one picture
 *
 * Output lands in shots/<device>/. Read the PNGs back to judge the visuals.
 */

import { launch, openGame, deploy, openEditor, fastForward, frames, camera, chrome,
         setFog, pose, flatSpot, state, catalog, shoot, turntable, lookAt, pause,
         reveal, drawable, unlockCamera, modelExtent, parseArgs, deviceNames, SHOTS, ROOT,
         stage, unstage, hide, show, groundLum } from './harness.mjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const MAP = args.map || null;      /* which shipped map the scene is shot on */
let DEVICE = args.device || 'desktop';
const SIM = args.sim === undefined ? 0 : Number(args.sim);
const SIDE = args.side || 'us';
const DIFF = args.diff === undefined ? 1 : Number(args.diff);
const BARE = !!args.bare;               /* hide the flat UI, keep only the 3D */
const TURN = !!args.turn;               /* four angles instead of one */
const SETTLE = args.settle === undefined ? 2 : Number(args.settle);
/* field upgrades to fit before photographing, e.g. --up=skirts,mg */
const UP = args.up ? String(args.up).split(',') : [];
/* --base=<rev> photographs an older revision of the game instead, with -base on the
   name, so a before and an after of any scene can be laid side by side */
const BASE = args.base === undefined ? null : String(args.base);
let TAG = (args.tag ? `-${args.tag}` : '') + (BASE ? '-base' : '');

/* every file a pass writes, so --side can pair the base revision's with the working file's */
let WRITTEN = [];
const out = (name) => {
  const file = path.join(SHOTS, DEVICE, `${name}${TAG}.png`);
  WRITTEN.push({ name, device: DEVICE, file });
  return file;
};

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
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
      if (SIM) await fastForward(page, SIM);
      if (args.nofog) await setFog(page, false);
      if (BARE) await chrome(page, false);
      await shoot(page, out('battle'), { settle: SETTLE });
    }
  },

  hud: {
    help: 'In-game with a squad selected, so the command panel and orders are populated.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
      if (SIM) await fastForward(page, SIM);
      if (args.nofog) await setFog(page, false);
      await page.evaluate(s => {
        const u = window.G.units.find(u => u.side === s && u.cat === 'inf');
        if (u) { select([u]); window.__o.camera({ x: u.x, y: u.y, dist: 420, pitch: 0.86 }); }
        syncHud();
      }, SIDE);
      await shoot(page, out('hud'), { settle: SETTLE });
      /* under the simple scheme the cards live in a sheet, so it is photographed up as well */
      if (await page.evaluate(() => window.CTRL && window.CTRL.simple)) {
        await page.evaluate(() => window.simpleMore(true));
        await shoot(page, out('hud-more'), { settle: SETTLE });
        await page.evaluate(() => window.simpleMore(false));
      }

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
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
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
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
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
                                                ['turret', false, .7, -.75], ['crew', false, null, null],
                                                ['inside', true, 0, -1.3]]) {
        await page.evaluate(([h, t, p]) => {
          window.povHatch(h);
          const u = window.POV.u.inside || window.POV.u;
          /* hold the turret while the shot settles. Every angle here is set against
             u.turret and the settle frames run the simulation, so a tank that acquires
             something traverses out from under the framing between the two: at a radian
             a second and a field of view of one, the crew shot came back looking out over
             the hull at open ground with nobody in it. */
          u.manual = 1; u.want = undefined;
          if (t === null) {
            /* aimed at a station rather than at a fixed angle. The crew sit low and close,
               so a framing chosen before they were seated points at the floor between
               them: the gunner is all but straight down from the commander's eye, at the
               pitch limit. Take whichever station stands furthest off in plan, which is
               the one there is room to see. */
            const I = window.VMODEL[u.key].inside, e = I.eyeIn;
            let best = null, far = -1;
            I.crew.forEach(c => {
              const d = Math.hypot(c.x - e.x, c.y - e.y);
              if (d > far) { far = d; best = c; }
            });
            window.POV.yaw = u.turret + Math.atan2(best.y - e.y, best.x - e.x);
            window.POV.pitch = Math.max(-1.35, Math.atan2(best.z - e.z, far));
            return;
          }
          window.POV.yaw = u.turret + t; window.POV.pitch = p;
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
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
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
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
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
    help: 'One soldier, one posture, turned under a fixed light: --only=us_rifle --man=0 --pose=fire --turn [--strip --frame=n --dirty --play --noshadow --shadowonly --variant=v --sheet --stage=trench|wall|window --side]',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
      /* --play is the picture the player sees and the one the READ row of the men card
         measures: six hundred units, pitch 0.75, the fog on and the camera under its
         real limits. Everything else is a model reference shot and gets none of that. */
      const play = !!args.play;
      if (!play) await setFog(page, false);
      await chrome(page, false);
      if (!play) await unlockCamera(page, 12, 0.02);
      const spot = await flatSpot(page, args.stage ? 60 : 90);
      const cat = await catalog(page);
      const keys = (args.only ? String(args.only).split(',') : ['us_rifle', 'ger_gren'])
        .filter(k => cat.units.some(u => u.key === k && (u.cat === 'inf' || u.cat === 'team')));
      const poses = (args.pose ? String(args.pose).split(',') : ['stand', 'ready', 'walk', 'run', 'fire', 'kneel', 'kfire', 'prone', 'crawl']);
      const men = args.man === undefined ? [0] : String(args.man).split(',').map(Number);
      const dist = Number(args.dist) || (play ? 600 : 58), pitch = Number(args.pitch) || (play ? 0.75 : 0.30);
      const steps = Number(args.steps) || (TURN ? 4 : 1);
      /* aim at the middle of him, or at the middle of a man lying down */
      const liftOf = pz => ({ prone: 3, crawl: 3, dead: 3, crouch: 7, cfire: 7, kneel: 7, kfire: 7,
                              seat: 6, sit: 6, served: 6, fall: 6 })[pz] || 10;
      const frame = Number(args.frame) || 0, fs_ = args.frame !== undefined ? `-f${frame}` : '';
      /* the shadow is the larger half of what a man puts on the screen at play distance,
         and it is his side silhouette, so it can be left out or looked at on its own */
      const MODE = args.noshadow ? '-noshadow' : args.shadowonly ? '-shadow' : play ? '-play' : '';
      if (args.noshadow) await hide(page, 'shadow');
      if (args.shadowonly) await hide(page, 'figure');
      /* The sun stays over the camera's shoulder and the MAN turns, the way the vehicle
         scene works: a turntable that orbits the camera lights -000 from the front and
         -180 from behind, and two angles of one figure cannot be compared for shape.
         The eye sits `camYaw` round from him, so facing the camera is camYaw itself:
         the turntable's -000 is his back and -180 his face, and that stays as it is
         because the b3 set is named that way. A single shot is a three-quarter front.
         The stage is cleared of props for the same reason: a grass tuft through the
         legs and a pole behind the head are not the figure. --stage keeps them, since
         the cover the man is put in is the picture. */
      const camYaw = play ? Math.PI / 2 : Math.atan2(0.52, 0.40);
      const facing = i => steps > 1 ? camYaw + Math.PI - (i * Math.PI * 2) / steps : camYaw + 0.7;
      if (!args.dirty && !args.stage) await clearStage(page);
      const note = async (x, y) => {
        const l = await groundLum(page, x + 25, y);
        console.log(`  ground luminance ${l === null ? 'off screen' : l.toFixed(3)} at the stage`);
      };

      /* --stage puts the section into real cover and lets the game's own chain choose
         the posture, which the scene setting m.pose by hand never did: a trench, a
         sandbag wall or a window on the shipped map, with an enemy in front of it so
         the men are engaged */
      if (args.stage) {
        for (const key of keys) {
          const got = await page.evaluate(o => {
            window.__o.pose([{ key: o.key, x: 0, y: 0, facing: 0 }], o.spot);
            const u = window.G.units[0], side = u.side, enemy = side === 'us' ? 'ger' : 'us';
            const e = spawnUnit(enemy, enemy === 'us' ? 'us_rifle' : 'ger_gren', o.spot.x + 300, o.spot.y, 0);
            e.order = null; e.path = null; e.dest = null;
            const mid = c => dsq(c.x, c.y, WORLD.w / 2, WORLD.h / 2);
            /* the enemy is put where the threat is, the section is given it as a target,
               and the game's own chain places the men and chooses what they do */
            const settle = () => {
              e.x = u.threatX; e.y = u.threatY; e.models.forEach(m => { m.x = e.x + m.ox; m.y = e.y + m.oy; });
              computeVisibility(); window.__o.reveal();
              u.target = e; u.moving = false; u.retreat = 0; u.setup = 0;
              u.coverSlots = null; u.coverT = -9;
              for (let k = 0; k < 6; k++) {
                updateModels(u, .1);
                if (u.coverSlots) u.models.forEach((m, i) => { if (u.coverSlots[i]) { m.x = u.coverSlots[i].x; m.y = u.coverSlots[i].y; } });
              }
            };
            let at = null, kind = 'house';
            if (o.stage === 'window') {
              /* a house of the town, not a base structure: what a section garrisons is a
                 block, which carries the w and h canGarrison reads, and the first version
                 put up a company post that it then refused to enter */
              const houses = window.G.blocks.filter(b => canGarrison(u, b)).sort((a, b) => mid(a) - mid(b));
              if (!houses.length) return { none: true };
              enterBuilding(u, houses[0]); at = { x: houses[0].x, y: houses[0].y };
              u.threatX = at.x + (side === 'us' ? 300 : -300); u.threatY = at.y;
              settle();
            } else {
              const kinds = o.stage === 'trench' ? ['trench'] : ['bags', 'lowwall'];
              const want = o.stage === 'trench' ? STAND_DUG : STAND_LOW;
              const pieces = window.G.covers.filter(c => kinds.indexOf(c.kind) >= 0 && c.hp > 0).sort((a, b) => mid(a) - mid(b));
              if (!pieces.length) return { none: true };
              /* the section halts beside each piece in turn, nearest the centre first, with
                 the enemy beyond it, and the first piece where the stance the chain reads
                 under most of the men is the one the stage is for is kept. A probe at the
                 piece's own stand-off was not enough: the low wall nearest the centre stands
                 under a tall one, and the chain read the tall one wherever the men stood. */
              const beside = c => {
                const ax = c.axis === null || c.axis === undefined ? 0 : c.axis, nx = -Math.sin(ax), ny = Math.cos(ax);
                const dir = side === 'us' ? 1 : -1, sgn = nx * dir >= 0 ? -1 : 1;
                u.x = c.x + nx * sgn * 30; u.y = c.y + ny * sgn * 30;
                u.models.forEach(m => { m.x = u.x + m.ox; m.y = u.y + m.oy; });
                u.threatX = c.x - nx * sgn * 300; u.threatY = c.y - ny * sgn * 300;
                settle();
                const st = u.models.filter(m => m.alive).map(m => coverStanceAt(m.x, m.y));
                return st.filter(q => q === want).length * 2 >= st.length;
              };
              let best = null;
              for (let i = 0; i < Math.min(12, pieces.length) && !best; i++) if (beside(pieces[i])) best = pieces[i];
              if (!best) { best = pieces[0]; beside(best); }
              kind = best.kind; at = { x: best.x, y: best.y };
            }
            const names = {};
            Object.keys(window).filter(k => /^POSE_/.test(k)).forEach(k => { names[window[k]] = k.slice(5).toLowerCase(); });
            const alive = u.models.filter(m => m.alive);
            return { x: alive.reduce((s, m) => s + m.x, 0) / alive.length, y: alive.reduce((s, m) => s + m.y, 0) / alive.length,
                     kind, at, poses: alive.map(m => names[m.pose] || String(m.pose)) };
          }, { key, stage: args.stage, spot });
          if (!got || got.none) { console.error(`  no ${args.stage} on this map`); continue; }
          const name = `man-stage-${key}-${args.stage}${MODE}`;
          console.log(`  ${name}  in a ${got.kind} at ${Math.round(got.at.x)},${Math.round(got.at.y)}: ${got.poses.join(' ')}`);
          /* a house wants the camera back far enough to take the whole of it in */
          const sd = Number(args.dist) || (args.stage === 'window' ? 200 : 120), sp = Number(args.pitch) || (args.stage === 'window' ? 0.6 : 0.42);
          await camera(page, { x: got.x, y: got.y, dist: sd, pitch: sp, yaw: camYaw, lift: 6 });
          await note(got.x, got.y);
          /* the men are in their cover, so it is the camera that goes round */
          for (let i = 0; i < steps; i++) {
            await camera(page, { x: got.x, y: got.y, dist: sd, pitch: sp, yaw: camYaw + (i * Math.PI * 2) / steps, lift: 6 });
            await shoot(page, out(steps > 1 ? `${name}-${String(Math.round((i * 360) / steps)).padStart(3, '0')}` : name), { settle: SETTLE });
          }
        }
        return;
      }

      /* --sheet: every variant in one posture across one image, and every posture of a
         variant in a row, so a change to a shared part is checked across the roster in
         one look. Drawn straight from the baked buffers, which is how the hull crews
         get into a picture at all. */
      if (args.sheet) {
        const all = await page.evaluate(() => Object.keys(SOLDIER_VARIANTS));
        const variants = args.variant ? String(args.variant).split(',') : all;
        for (const pz of poses) {
          const gap = (pz === 'prone' || pz === 'crawl' || pz === 'dead') ? 24 : 16;
          const items = variants.map((v, i) => ({ variant: v, pose: pz, frame, x: spot.x + (i - (variants.length - 1) / 2) * gap, y: spot.y, f: Math.PI / 2 + 0.7 }));
          const n = await stage(page, items);
          const name = `sheet-variants-${pz}${fs_}${MODE}`;
          console.log(`  ${name}  ${n} of ${variants.length} variants have the posture`);
          const wide = (variants.length - 1) * gap + 40;
          await camera(page, { x: spot.x, y: spot.y, dist: Number(args.dist) || Math.max(110, wide * 0.9), pitch: Number(args.pitch) || 0.26, yaw: Math.PI / 2, lift: liftOf(pz) });
          await note(spot.x, spot.y);
          await shoot(page, out(name), { settle: SETTLE });
          await unstage(page);
        }
        const rowVariants = args.variant ? String(args.variant).split(',') : ['can_rifle', 'fj_rifle'];
        const rowPoses = ['stand', 'ready', 'walk', 'run', 'fire', 'kneel', 'kfire', 'prone', 'crawl', 'seat', 'sit', 'served', 'fall', 'dead'];
        for (const v of rowVariants) {
          /* only the postures this file has for him, a cycle at its mid-stride frame */
          const has = await page.evaluate(a => a.poses.map(p => { const f = window.__o.figure(a.v, p, 0); return f ? { p, n: f.n } : null; }).filter(Boolean), { v, poses: rowPoses });
          const gap = 26, items = has.map((h, i) => ({ variant: v, pose: h.p, frame: args.frame !== undefined ? frame : Math.floor(h.n / 4),
                                                       x: spot.x + (i - (has.length - 1) / 2) * gap, y: spot.y, f: 0 }));
          await stage(page, items);
          const name = `sheet-poses-${v}${MODE}`;
          console.log(`  ${name}  ${has.map(h => h.p).join(' ')}`);
          const wide = (has.length - 1) * gap + 40;
          await camera(page, { x: spot.x, y: spot.y, dist: Number(args.dist) || Math.max(110, wide * 0.9), pitch: Number(args.pitch) || 0.26, yaw: Math.PI / 2, lift: 7 });
          await note(spot.x, spot.y);
          await shoot(page, out(name), { settle: SETTLE });
          await unstage(page);
        }
        return;
      }

      /* --variant stages a variant directly, one baked buffer at a point: the way to
         photograph a hull crewman, a corpse or a fall frame, none of which any unit
         key reaches */
      if (args.variant) {
        for (const v of String(args.variant).split(',')) for (const pz of poses) {
          const n = await stage(page, [{ variant: v, pose: pz, frame, x: spot.x, y: spot.y, f: facing(0) }]);
          if (!n) { console.error(`  ${v} has no ${pz} buffer in this file`); await unstage(page); continue; }
          const name = `man-var-${v}-${pz}${fs_}${MODE}`;
          console.log(`  ${name}`);
          await camera(page, { x: spot.x, y: spot.y, dist, pitch, yaw: camYaw, lift: args.lift === undefined ? liftOf(pz) : Number(args.lift) });
          await note(spot.x, spot.y);
          for (let i = 0; i < steps; i++) {
            await page.evaluate(a => { window.__o._stage.list.forEach(s => { s.f = a; }); }, facing(i));
            await shoot(page, out(steps > 1 ? `${name}-${String(Math.round((i * 360) / steps)).padStart(3, '0')}` : name), { settle: SETTLE });
          }
          await unstage(page);
        }
        return;
      }

      /* --strip lays every frame of the walk or the crawl out in a row, broadside to the
         camera, so a cycle can be read in one picture instead of eight */
      if (args.strip) {
        for (const key of keys) for (const man of men) for (const pz of poses.filter(p => p === 'walk' || p === 'crawl' || p === 'run')) {
          const got = await page.evaluate(o => {
            window.__o.pose([{ key: o.key, x: 0, y: 0, facing: 0 }], o.spot);
            const u = window.G.units[0];
            const proto = u.models[o.man], variant = variantForModel(u, o.man);
            const fig = window.__o.figure(variant, o.pose, 0);
            if (!fig || fig.n < 2) return null;
            /* the roster is shorter than the cycle: the man asked for is copied until
               there is one of him per frame, each on his own frame, in a row along x.
               The draw path picks a variant by a man's index in his section, so it is
               pinned to the one he was for the life of this page. */
            window.variantForModel = function () { return variant; };
            u.models.length = 0;
            for (let k = 0; k < fig.n; k++) {
              const m = {}; for (const q in proto) m[q] = proto[q];
              m.alive = true; m.x = o.spot.x + (k - (fig.n - 1) / 2) * o.gap; m.y = o.spot.y; m.f = 0;
              window.__o.setPose(m, variant, o.pose, k);
              u.models.push(m);
            }
            return { variant: variant, n: fig.n };
          }, { key, man, pose: pz, spot, gap: pz === 'crawl' ? 26 : 16 });
          if (!got) { console.error(`  ${key} man ${man} has no ${pz} cycle in this file`); continue; }
          const name = `strip-${key}-${man}-${got.variant}-${pz}${MODE}`;
          console.log(`  ${name}  ${got.n} frames`);
          await camera(page, { x: spot.x, y: spot.y, dist: Number(args.dist) || (pz === 'crawl' ? 110 : 150), pitch: Number(args.pitch) || 0.22, yaw: Math.PI / 2, lift: pz === 'crawl' ? 3 : 10 });
          await note(spot.x, spot.y);
          await shoot(page, out(name), { settle: SETTLE });
        }
        return;
      }

      for (const key of keys) for (const man of men) for (const pz of poses) {
        const got = await page.evaluate(o => {
          /* stage the section, then leave one man of it standing in the posture asked for */
          window.__o.pose([{ key: o.key, x: 0, y: 0, facing: -Math.PI / 2 }], o.spot);
          const u = window.G.units[0];
          let kept = null, id = null;
          u.models.forEach(function (m, i) {
            if (i !== o.man) { m.alive = false; return; }
            kept = m; m.x = o.spot.x; m.y = o.spot.y; m.f = o.facing;
            id = window.__o.setPose(m, variantForModel(u, o.man), o.pose, o.frame);
          });
          if (!kept) return null;
          if (id === null) return { missing: true };
          /* at play distance the fog is on and the ground round him is lit by his own
             side's eyes, which means his side is the player's for the photograph */
          if (o.play) { window.G.side = u.side; computeVisibility(); window.__o.fog(true); }
          return { variant: variantForModel(u, o.man), x: kept.x, y: kept.y };
        }, { key, man, pose: pz, spot, frame, facing: facing(0), play });
        if (!got) { console.error(`  ${key} has no man ${man}`); continue; }
        if (got.missing) { console.error(`  this file has no ${pz} posture`); continue; }
        const name = `man-${key}-${man}-${got.variant}-${pz}${fs_}${MODE}`;
        console.log(`  ${name}`);
        const lift = args.lift === undefined ? liftOf(pz) : Number(args.lift);
        await camera(page, { x: got.x, y: got.y, dist, pitch, yaw: camYaw, lift });
        await note(got.x, got.y);
        for (let i = 0; i < steps; i++) {
          await page.evaluate(a => { window.G.units[0].models.forEach(m => { if (m.alive) m.f = a; }); }, facing(i));
          await shoot(page, out(steps > 1 ? `${name}-${String(Math.round((i * 360) / steps)).padStart(3, '0')}` : name), { settle: SETTLE });
        }
      }
      await show(page);
    }
  },

  armour:   { help: 'Every vehicle model, posed on level ground.',
              run: (page) => gallery(page, 'armour', u => u.cat === 'veh') },

  models:   { help: 'The whole roster, one photo per unit type.',
              run: (page) => gallery(page, 'models', () => true) },

  lineup: {
    help: 'One shot per side with the entire roster stood in a row.',
    async run(page) {
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
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
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
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
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
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
      await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
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
  await deploy(page, { side: SIDE, diff: DIFF, map: MAP });
  await setFog(page, false);
  await chrome(page, false);
  await unlockCamera(page, 40, 0.12);
  /* The props go, the way the man scene has always cleared them. Measured by brute force
     over every walkable point, the clearest flat ground on Ortona is 72 units from the
     nearest wire picket or trench, and a weapon team is photographed from 72: the map is
     a battlefield and simply has nowhere open on it, so every gallery shot of a team
     came back a picture of an entanglement with a helmet behind it. --dirty keeps them. */
  if (!args.dirty) await clearStage(page);
  const spot = await flatSpot(page, 150);
  const cat = await catalog(page);
  const only = args.only ? String(args.only).split(',') : null;
  const keys = cat.units.filter(filter).map(u => u.key).filter(k => !only || only.includes(k));
  if (!keys.length) { console.error(`  no units match --only=${args.only}`); return; }
  console.log(`  staging ${keys.length} model(s) at (${spot.x}, ${spot.y}), height spread ${spot.dev.toFixed(1)}, ${spot.open === undefined ? '?' : spot.open} clear of cover`);

  for (const key of keys) {
    const unit = cat.units.find(u => u.key === key);
    await pose(page, [{ key, x: 0, y: 0, facing: -Math.PI / 2 }], spot);
    /* A weapon team is photographed packed, with its piece drawn on man 0 where the
       crew carry it. Setting it up here does not work: the stage is paused, so the crew
       never walk to their stations, and driving updateModels by hand on a paused stage
       walks them out of frame instead. A set-up team is photographed in a battle. */
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

/* The props and the grass off the stage, for a shot of a model and nothing else. */
async function clearStage(page) {
  await page.evaluate(() => {
    SCENE.tiles = SCENE.tiles.map(() => ({ props: { vbo: null, n: 0 }, leaves: { vbo: null, n: 0 } }));
    SCENE.grass = null;
  });
}

/* Two photographs in one, side by side, with what each one is burnt in along the top.
 * A before and an after are two files nobody lays next to each other; this is one. The
 * page does the drawing, because the only image library on this box is a browser. */
async function composite(browser, files, labels, outFile) {
  const p = await browser.newPage();
  const data = files.map(f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
  const url = await p.evaluate(async ({ data, labels }) => {
    const imgs = await Promise.all(data.map(d => new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = d;
    })));
    const band = 28, w = imgs.reduce((s, im) => s + im.width, 0), h = Math.max(...imgs.map(im => im.height)) + band;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#141412'; g.fillRect(0, 0, w, h);
    let x = 0;
    imgs.forEach((im, i) => {
      g.drawImage(im, x, band);
      g.fillStyle = '#e6e0c8'; g.font = '16px monospace'; g.fillText(labels[i], x + 10, 19);
      x += im.width;
    });
    return c.toDataURL('image/png');
  }, { data, labels });
  await p.close();
  fs.writeFileSync(outFile, Buffer.from(url.split(',')[1], 'base64'));
  const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log(`  ${path.relative(ROOT, outFile)}  (${kb} kB)`);
}

/* an older revision of the game, written out where a browser can open it */
function revisionFile(rev) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-shoot-'));
  const file = path.join(tmp, 'ortona.html');
  fs.writeFileSync(file, execFileSync('git', ['show', `${rev}:ortona.html`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }));
  return file;
}
function shortRev(rev) {
  try { return execFileSync('git', ['rev-parse', '--short', rev], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) { return rev; }
}

/* -------------------------------------------------------------------- main */

if (args.list || args.help) {
  console.log('scenes:');
  for (const [k, v] of Object.entries(SCENES)) console.log(`  ${k.padEnd(11)} ${v.help}`);
  console.log(`\ndevices: ${deviceNames().join(', ')}`);
  console.log('\nflags: --device= --sim=<game seconds> --side=us|ger --diff=0|1|2 --bare --turn');
  console.log('       --settle=<frames> --tag=<suffix> --cam=x,y,dist,yaw,pitch --nofog --name=');
  console.log('       --dist=<units> --pitch=<radians>   (override gallery framing)');
  console.log('       --ctrl=simple|classic               (the control scheme, whatever the device would pick)');
  console.log('       --only=<key[,key]>                 (restrict a gallery to named units)');
  console.log('       --base=<rev>                       (photograph an older revision, -base on the name)');
  console.log('       --base=<rev> --side                (that and the working file, composited into one PNG)');
  process.exit(0);
}

const wanted = args._.length ? args._ : ['start', 'battle', 'hud', 'closeup', 'terrain', 'editor'];
for (const s of wanted) if (!SCENES[s]) { console.error(`unknown scene "${s}" (try --list)`); process.exit(1); }
if (args.side && !BASE) { console.error('--side needs --base=<rev> to compare against'); process.exit(1); }

const t0 = Date.now();
const browser = await launch();
let failed = 0;
/* --side photographs the base revision and then the working file, and lays each pair
   side by side; --play photographs both devices, because the phone is the one that
   has to work and a picture of the desktop alone says nothing about it */
const passes = args.side ? [{ file: revisionFile(BASE), base: true }, { file: null, base: false }]
                         : [{ file: BASE ? revisionFile(BASE) : null, base: !!BASE }];
const devices = args.play && !args.device ? ['desktop', 'phone'] : [DEVICE];
const tagOnly = args.tag ? `-${args.tag}` : '';

for (const pass of passes) {
  TAG = tagOnly + (pass.base ? '-base' : '');
  WRITTEN = pass.written = [];
  if (pass.base) console.log(`photographing ${BASE}`);
  else if (args.side) console.log('photographing the working file');
  for (const dev of devices) {
    DEVICE = dev;
    for (const name of wanted) {
      /* A fresh page per scene: scenes mutate global game state freely, and a
       * stale one would quietly poison the next capture. */
      const { page, context, log } = await openGame(browser, DEVICE, pass.file ? { file: pass.file } : {});
      console.log(`\n[${name}] ${DEVICE}`);
      /* --ctrl=simple|classic picks the control scheme for the page, without storing it:
         a phone starts on simple and a desktop on classic, and a picture of either on the
         other device is worth having */
      if (args.ctrl && !pass.base) await page.evaluate(v => { if (window.ctrlSet) window.ctrlSet(v === 'simple', true); }, String(args.ctrl));
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
  }
}

if (args.side) {
  console.log('\nside by side');
  const labels = [`base ${BASE} (${shortRev(BASE)})`, `working tree (HEAD ${shortRev('HEAD')})`];
  for (const w of passes[1].written) {
    const b = passes[0].written.find(q => q.name === w.name && q.device === w.device);
    if (!b || !fs.existsSync(b.file) || !fs.existsSync(w.file)) continue;
    await composite(browser, [b.file, w.file], labels, path.join(SHOTS, w.device, `${w.name}${tagOnly}-side.png`));
  }
}

await browser.close();
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${path.relative(ROOT, path.join(SHOTS, DEVICE))}/`);
process.exit(failed ? 1 : 0);
