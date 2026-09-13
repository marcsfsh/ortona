/* Ortona dev harness.
 *
 * Boots ortona.html in headless Chromium (software WebGL via SwiftShader) so a
 * developer -- human or agent -- can drive the game, pose it, and photograph it.
 *
 * Nothing here touches ortona.html on disk. Every hook is installed at runtime
 * through page.evaluate, so the shipped game stays free of test-only code.
 */

import { chromium, devices } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAME = path.join(ROOT, 'ortona.html');
export const SHOTS = path.join(ROOT, 'shots');

/* SwiftShader gives us a real WebGL2 context with shadow maps and float
 * textures on a machine with no GPU. It is slow -- seconds per frame at a
 * desktop resolution -- which is why simulation is fast-forwarded separately
 * from drawing (see fastForward below). */
const CHROME_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--force-color-profile=srgb',
  '--disable-lcd-text',
  '--font-render-hinting=none'
];

/* Named viewports. "phone" is the device the game must keep working on. */
export const DEVICES = {
  desktop:  { name: 'desktop',  viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  laptop:   { name: 'laptop',   viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  /* Half the pixels of `laptop`, for the tight edit-render-look loop on a model.
   * Enough to judge a shape; use `laptop` or better for the shot you keep. */
  veh:      { name: 'veh',      viewport: { width: 900, height: 620 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  wide:     { name: 'wide',     viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone:    { name: 'phone',    ...devices['iPhone 14 Pro Max'] },
  /* Same 430x932 CSS box, but at dpr 1. Renders ~9x fewer pixels than dpr 3,
   * so it is the one to use when you only need to check layout, not fidelity. */
  phonefast:{ name: 'phonefast', viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
              userAgent: devices['iPhone 14 Pro Max'].userAgent },
  phoneland:{ name: 'phoneland', ...devices['iPhone 14 Pro Max landscape'] },
  phonemin: { name: 'phonemin',  viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
              userAgent: devices['iPhone 14 Pro Max'].userAgent },
  tablet:   { name: 'tablet',    ...devices['iPad Pro 11'] }
};

export function deviceNames() { return Object.keys(DEVICES); }

/* ------------------------------------------------------------------ launch */

export async function launch({ headed = false, slowMo = 0 } = {}) {
  return chromium.launch({
    executablePath: process.env.ORTONA_CHROME || '/opt/pw-browsers/chromium',
    headless: !headed,
    slowMo,
    args: CHROME_ARGS
  });
}

/**
 * Open the game and wait until WebGL has come up.
 * Returns { page, log } where log collects console output and page errors.
 */
export async function openGame(browser, deviceKey = 'desktop', { file = GAME, quiet = false } = {}) {
  const dev = DEVICES[deviceKey];
  if (!dev) throw new Error(`unknown device "${deviceKey}". known: ${deviceNames().join(', ')}`);
  const { name, ...ctxOpts } = dev;

  const context = await browser.newContext({ ...ctxOpts, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);

  const log = { console: [], errors: [], requests: [] };
  page.on('console', m => {
    const rec = { type: m.type(), text: m.text() };
    log.console.push(rec);
    if (m.type() === 'error') log.errors.push(`console.error: ${rec.text}`);
    if (!quiet && m.type() === 'error') console.error('  [console.error]', rec.text);
  });
  page.on('pageerror', e => {
    log.errors.push(`pageerror: ${e.message}`);
    if (!quiet) console.error('  [pageerror]', e.message);
  });
  page.on('requestfailed', r => log.requests.push(`${r.url()} ${r.failure()?.errorText}`));

  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.GLOK !== 'undefined', null, { timeout: 60000 });

  const gl = await page.evaluate(() => ({
    ok: window.GLOK,
    gl2: window.GL2,
    shadows: window.SHADOWS,
    mob: window.MOB,
    err: document.getElementById('glerr').classList.contains('hidden') ? '' : document.getElementById('glerr').textContent
  }));
  if (!gl.ok) throw new Error(`WebGL failed to initialise: ${gl.err || 'unknown'}`);

  await installHooks(page);
  return { page, context, log, gl };
}

/* --------------------------------------------------------------- run hooks */

/** Reload the page and put the run hooks back (a reload wipes window.__o). */
export async function reload(page) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.GLOK !== 'undefined', null, { timeout: 60000 });
  await installHooks(page);
}

/* Installed once per page. Everything the CLIs need lives under window.__o. */
export async function installHooks(page) {
  await page.evaluate(() => {
    if (window.__o) return;

    const O = window.__o = {};

    /* Advance the simulation without drawing.
     *
     * frame() is the single place that steps the world, so rather than
     * duplicating its body (which would rot), we call it with a virtual clock
     * and temporarily neuter the two things that make it slow or re-entrant:
     * render() and requestAnimationFrame(). */
    O.fastForward = function (seconds, stepMs) {
      stepMs = stepMs || 25;              /* under frame()'s 30ms "device is struggling" threshold */
      const realRender = window.render;
      const realRaf = window.requestAnimationFrame;
      const realNow = performance.now.bind(performance);

      window.render = function () {};
      window.requestAnimationFrame = function () { return 0; };
      let virt = realNow();
      performance.now = function () { return virt; };

      const steps = Math.max(1, Math.ceil((seconds * 1000) / stepMs));
      for (let i = 0; i < steps && !window.G.over; i++) { virt += stepMs; window.frame(virt); }

      performance.now = realNow;
      window.render = realRender;
      window.requestAnimationFrame = realRaf;

      /* frame() left `last` on the virtual clock; hand it back the real one so
       * the next live frame does not compute an absurd dt. Same for the
       * frame-rate sampler, which the fake clock would have convinced that the
       * machine is too slow to draw every frame. */
      window.last = realNow();
      window.perf.samples = 0; window.perf.slow = 0;
      window.perf.half = false; window.perf.skip = false;
      return { t: window.G.t, units: window.G.units.length, over: window.G.over };
    };

    /* Resolve after n real animation frames, so a screenshot lands on a fully
     * drawn scene rather than a half-built one.
     *
     * The first callback has to be scheduled, not called inline: a screenshot
     * captures whatever the compositor last painted, so resolving without
     * waiting would photograph the previous camera position. */
    O.frames = function (n) {
      return new Promise(function (res) {
        var i = 0;
        requestAnimationFrame(function tick() {
          if (++i >= n) res(i); else requestAnimationFrame(tick);
        });
      });
    };

    /* Gameplay keeps the camera between 220 and 2600 units out and stops it
     * lying flat. Model review needs to get closer and lower than a player
     * ever can, so the limits are relaxed on request -- never during a
     * capture meant to represent what a player actually sees. */
    O.unlock = function (minDist, minPitch) {
      CAMLIM.distMin = minDist === undefined ? 40 : minDist;
      CAMLIM.pitchMin = minPitch === undefined ? 0.12 : minPitch;
    };

    O.camera = function (c) {
      if (c.x !== undefined && c.y !== undefined) centreOn(c.x, c.y);
      if (c.dist !== undefined) CAM.dist = c.dist;
      if (c.yaw !== undefined) CAM.yaw = c.yaw;
      if (c.pitch !== undefined) CAM.pitch = c.pitch;
      clampCam(); updateCamera();
      return { x: CAM.tx, y: CAM.ty, dist: CAM.dist, yaw: CAM.yaw, pitch: CAM.pitch };
    };

    /* Hide the flat UI so only the 3D scene remains. The overlay canvas carries
     * selection rings, health bars and unit labels, so it goes too. */
    O.chrome = function (on) {
      ['top', 'bar', 'tools', 'queue', 'tip', 'pausenote'].forEach(function (id) {
        const e = document.getElementById(id);
        if (e) e.style.visibility = on ? '' : 'hidden';
      });
      document.getElementById('ov').style.visibility = on ? '' : 'hidden';
    };

    /* render() only refreshes the fog texture every third frame, so flipping
     * the flag and grabbing a screenshot two frames later would photograph the
     * old fog. Push the texture immediately. */
    O.fog = function (on) {
      window.fog = !!on;
      if (window.GLOK) updateFog();
    };

    /* render() only draws what the player's side can see. With the battlefield
     * emptied for a photo shoot there are no friendly eyes left, so every enemy
     * model would silently vanish. Force both sides visible and clear the fog.
     *
     * This pauses the simulation, and has to: frame() calls computeVisibility()
     * on every tick, which recomputes vUs/vGer from scratch and would wipe the
     * reveal before the next screenshot lands. */
    O.reveal = function () {
      window.G.paused = true;
      window.fog = false;
      if (window.explored) window.explored.fill(255);
      if (window.GLOK) updateFog();
      window.G.units.forEach(function (u) { u.vUs = true; u.vGer = true; });
      window.G.blds.forEach(function (b) { b.vUs = true; b.vGer = true; });
    };

    /* How many units and buildings render() would actually draw right now.
     * A staged shot that reports 0 is a blank photo, not a bad model. */
    O.drawable = function () {
      const v = view();
      const G = window.G;
      const units = G.units.filter(function (u) {
        return !u.dead && inView(v, u.x, u.y, 160) && (u.side === G.side || visibleTo(G.side, u));
      }).length;
      const blds = G.blds.filter(function (b) {
        return (b.side === G.side || visibleTo(G.side, b)) && MODELS.bld[b.key];
      }).length;
      return { units: units, blds: blds, total: units + blds };
    };

    /* Wipe the battlefield and place exactly what you asked for.
     * specs: [{ side, key, x, y, facing }] with x/y relative to the anchor. */
    O.pose = function (specs, anchor) {
      window.G.units.length = 0;
      window.G.shots.length = 0;
      window.G.fx.length = 0;
      window.G.corpses.length = 0;
      window.G.wrecks.length = 0;
      window.G.sel.length = 0;
      const out = [];
      specs.forEach(function (s) {
        const u = spawnUnit(s.side || UNITS[s.key].side, s.key,
                            anchor.x + (s.x || 0), anchor.y + (s.y || 0),
                            s.facing === undefined ? -Math.PI / 2 : s.facing);
        /* Freeze them: no wandering off, no seeking cover mid-photograph. */
        u.order = null; u.path = null; u.dest = null;
        if (u.setup !== undefined) u.setup = 0;     /* weapon teams: deployed, not packing up */
        /* Field upgrades change the silhouette -- a Panzer IV wears or drops its
         * Schuerzen -- so a reference sheet has to be able to ask for them. */
        (s.up || []).forEach(function (k) { u.up[k] = true; });
        out.push({ id: u.id, key: s.key, x: u.x, y: u.y });
      });
      computeVisibility();
      O.reveal();
      window.G.paused = true;
      return out;
    };

    /* Find open, level ground to stage models on: the flattest walkable spot
     * with nothing built, grown or flying within `clear` units.
     *
     * Sector flag poles are baked into the scene buffer and cannot be hidden,
     * so the stage keeps clear of them rather than photographing a model
     * behind one. A wide lineup needs more room than a single model, and a
     * clearance nothing on the map can satisfy would return nothing at all, so
     * the search steps the requirement down until it finds ground. */
    O.flatSpot = function (clear) {
      const want = clear || 130;
      for (let r = want; r >= 60; r *= 0.75) {
        const hit = search(r);
        if (hit) { hit.clear = Math.round(r); return hit; }
      }
      return search(0);

      function search(c) {
        let best = null;
        for (let x = 260; x < WORLD.w - 260; x += 40) {
          for (let y = 260; y < WORLD.h - 260; y += 40) {
            if (!walkable(x, y)) continue;
            const z0 = groundZ(x, y);
            let dev = 0, ok = true;
            /* Sample the ring, and the two ends of the row hardest of all:
             * a lineup runs east-west, so that is where it can fall off a bank. */
            for (let a = 0; a < 12 && ok; a++) {
              const th = (a / 12) * Math.PI * 2;
              const px = x + Math.cos(th) * c, py = y + Math.sin(th) * c;
              if (!walkable(px, py)) { ok = false; break; }
              dev = Math.max(dev, Math.abs(groundZ(px, py) - z0));
            }
            if (!ok) continue;
            for (let i = 0; i < COVER.length && ok; i++) {
              const cv = COVER[i];
              if (Math.hypot(cv.x - x, cv.y - y) < c + cv.r) ok = false;
            }
            for (let b = 0; b < window.G.blds.length && ok; b++) {
              if (Math.hypot(window.G.blds[b].x - x, window.G.blds[b].y - y) < c + 90) ok = false;
            }
            /* The pole is thin; standing a little off it is enough. */
            for (let j = 0; j < window.G.sectors.length && ok; j++) {
              const sc = window.G.sectors[j];
              if (Math.hypot(sc.x - x, sc.y - y) < 130) ok = false;
            }
            if (!ok) continue;
            if (best === null || dev < best.dev) best = { x: x, y: y, z: z0, dev: dev };
          }
        }
        return best;
      }
    };

    O.state = function () {
      const G = window.G;
      return {
        running: G.running, paused: G.paused, over: G.over, t: G.t,
        side: G.side, diff: G.diff,
        units: G.units.length,
        unitsBySide: { us: G.units.filter(u => u.side === 'us').length,
                       ger: G.units.filter(u => u.side === 'ger').length },
        blds: G.blds.length,
        res: G.res, pop: G.pop,
        sceneReady: SCENE.ready, shadows: window.SHADOWS,
        view: { w: VIEW.w, h: VIEW.h, dpr: window.dpr },
        cam: { x: CAM.tx, y: CAM.ty, dist: CAM.dist, yaw: CAM.yaw, pitch: CAM.pitch },
        editor: ED.on
      };
    };

    /* How big a vehicle actually is, so a shot can be framed to the subject. A Tiger II
     * is half again the length of a Stuart; one fixed camera distance cannot serve both. */
    O.extent = function (key) {
      const V = window.VMODEL[key];
      if (!V) return null;
      let x0 = 1e9, x1 = -1e9, y1 = 0, z1 = 0;
      function scan(faces, dx) {
        faces.forEach(function (f) {
          f.v.forEach(function (p) {
            x0 = Math.min(x0, p[0] + dx); x1 = Math.max(x1, p[0] + dx);
            y1 = Math.max(y1, Math.abs(p[1])); z1 = Math.max(z1, p[2]);
          });
        });
      }
      scan(V.hull, 0);
      /* the aerial whip is 2.5 m of wire and would dominate the framing */
      scan(V.tur.filter(function (f) { return f.v.every(function (p) { return p[2] < 20; }); }), V.turX || 0);
      return { len: x1 - x0, halfW: y1, top: z1 + V.mountZ };
    };

    O.catalog = function () {
      return {
        units: Object.keys(UNITS).map(k => ({ key: k, side: UNITS[k].side, cat: UNITS[k].cat,
                                              name: UNITS[k].name, models: UNITS[k].models || 0 })),
        buildings: Object.keys(BUILDINGS).map(k => ({ key: k, side: BUILDINGS[k].side, name: BUILDINGS[k].name })),
        world: { w: WORLD.w, h: WORLD.h },
        sectors: G.sectors ? G.sectors.length : 0
      };
    };
  });
}

/* ---------------------------------------------------------------- controls */

export async function deploy(page, { side = 'us', diff = 1 } = {}) {
  await page.click(side === 'ger' ? '#pickger' : '#pickus');
  await page.click(`.pill[data-diff="${diff}"]`);
  await page.click('#deploy');
  await page.waitForFunction(() => window.G.running && window.SCENE.ready, null, { timeout: 180000 });
  await frames(page, 1);
}

export async function openEditor(page) {
  await page.click('#openeditor');
  await page.waitForFunction(() => window.ED.on, null, { timeout: 120000 });
  await frames(page, 2);
}

/** Step the world forward `seconds` of game time without drawing. */
export async function fastForward(page, seconds) {
  if (!seconds) return null;
  return page.evaluate(s => window.__o.fastForward(s), seconds);
}

/** Wait for n fully drawn frames. Slow under SwiftShader; 2 is usually enough. */
export async function frames(page, n = 2) {
  await page.evaluate(k => window.__o.frames(k), n);
}

export async function camera(page, c) { return page.evaluate(v => window.__o.camera(v), c); }
export async function chrome(page, on) { return page.evaluate(v => window.__o.chrome(v), on); }
export async function setFog(page, on) { return page.evaluate(v => window.__o.fog(v), on); }
export async function pose(page, specs, anchor) { return page.evaluate(a => window.__o.pose(a[0], a[1]), [specs, anchor]); }
export async function reveal(page) { return page.evaluate(() => window.__o.reveal()); }
export async function unlockCamera(page, minDist, minPitch) { return page.evaluate(a => window.__o.unlock(a[0], a[1]), [minDist, minPitch]); }
export async function drawable(page) { return page.evaluate(() => window.__o.drawable()); }
export async function flatSpot(page, clear) { return page.evaluate(c => window.__o.flatSpot(c), clear); }
export async function state(page) { return page.evaluate(() => window.__o.state()); }
export async function catalog(page) { return page.evaluate(() => window.__o.catalog()); }
/** Bounding extent of a vehicle's built model, in world units, for framing a shot. */
export async function modelExtent(page, key) { return page.evaluate(k => window.__o.extent(k), key); }
export async function pause(page, on = true) { await page.evaluate(v => { window.G.paused = v; }, on); }

/** Centre the camera on a unit picked by key (or the first of a side). */
export async function lookAt(page, { key, side, dist = 300, pitch = 0.8, yaw } = {}) {
  return page.evaluate(o => {
    const u = window.G.units.find(u => (!o.key || u.key === o.key) && (!o.side || u.side === o.side));
    if (!u) return null;
    return window.__o.camera({ x: u.x, y: u.y, dist: o.dist, pitch: o.pitch, yaw: o.yaw });
  }, { key, side, dist, pitch, yaw });
}

/* ------------------------------------------------------------- screenshots */

export function shotPath(...parts) {
  const p = path.join(SHOTS, ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

export async function shoot(page, file, { settle = 2, fullPage = false } = {}) {
  if (settle) await frames(page, settle);
  const out = file.startsWith('/') ? file : shotPath(file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage });
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`  ${path.relative(ROOT, out)}  (${kb} kB)`);
  return out;
}

/** Four screenshots of the same subject, one per 90 degrees of camera yaw. */
export async function turntable(page, prefix, { x, y, dist = 260, pitch = 0.72, steps = 4 } = {}) {
  const made = [];
  for (let i = 0; i < steps; i++) {
    const yaw = (Math.PI / 2) + (i * Math.PI * 2) / steps;
    await camera(page, { x, y, dist, pitch, yaw });
    made.push(await shoot(page, `${prefix}-${String(Math.round((i * 360) / steps)).padStart(3, '0')}.png`));
  }
  return made;
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    } else out._.push(a);
  }
  return out;
}
