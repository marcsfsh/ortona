/* The brain, mechanically.
 *
 * An AI cannot be reviewed by reading it. `skirmish.mjs` answers whether one brain beats
 * another, which is the only honest verdict on a change to its judgement -- and it is
 * nearly always too coarse to see one, because a battle on this map compounds and a
 * single pair swings by most of a thousand points. This answers the questions underneath
 * that one, which are not about judgement at all: what the brain can see, what it acts on
 * that it has never seen, whether the rules it carries ever fire, and what a tick of it
 * costs. Those are facts, and they are cheap to count.
 *
 *   node tools/brain.mjs                the card
 *   node tools/brain.mjs --t=420        a longer battle
 *   node tools/brain.mjs --diff=2       at veteran
 *   node tools/brain.mjs --base=HEAD    the same card on an older file, side by side
 *   node tools/brain.mjs --n=3          average over three battles
 *
 * It puts the working brain on BOTH sides, the way `skirmish.mjs --self` does. That is
 * not a nicety: with only one side thinking, the other army stands at its base for the
 * whole game, the two never meet, and the target-picking rule -- which the brain calls
 * six times a tick -- returned null on all twelve hundred calls of a five-minute run. A
 * probe that watches a brain fight nobody is measuring an empty map.
 *
 * Four sections.
 *
 * COST is what a thinking tick costs and how much of that is the same walk of G.units
 * done again by another rule with its own idea of what counts.
 *
 * SIGHT is the honesty boundary. `acquire` refuses anything the side cannot see, which is
 * the guarantee the whole fog of war rests on -- but a FORCED target skips that test, and
 * the brain forces targets. So this counts what it picked, ordered and actually fired at
 * that had never been seen, against the share of the enemy that is out of sight at the
 * time. Staff work is allowed the map on purpose (see aiThreat); gunnery is not.
 *
 * PLAN is the shape of what it did over the battle: the moods it held, the jobs it dealt,
 * how many waves it formed and how many of those ever went in, how long they took, what
 * it garrisoned, built and bought. A brain with a rule it never reaches looks identical
 * to one without the rule, and this is where that shows.
 *
 * SENSE is the situation layer: what a unit reads about its own position on a tick, and
 * what it decided out of it. The two numbers to watch are the share of unit-ticks where
 * the unit could not hurt the armour in front of it -- which is the case the calls exist
 * for -- and the spread of the actions chosen, because an option that is never chosen is
 * a line of scoring nobody is running.
 *
 * CALLS is the routing: how many were raised, how long one stood before anybody was sent,
 * and how they ended. A call that always lapses is an army that never answers.
 *
 * RULES is every named decision and how often it fired, straight out of the brain's own
 * counters. A rule that never fires is a rule that is not there.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openGame, deploy, fastForward, parseArgs, GAME } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const SECS = args.t === undefined ? 300 : Number(args.t);
const DIFF = args.diff === undefined ? 1 : Number(args.diff);
const N = args.n === undefined ? 1 : Number(args.n);
const BASE = args.base === undefined ? null : String(args.base);

/* ------------------------------------------------------------------ the page side */

async function install(page) {
  await page.evaluate(() => {
    const rnow = performance.now.bind(performance);
    const B = window.__b = {};

    /* One AI object, two sides, the way skirmish does it: each side's plan is swapped in
       around its own call and the game's own side is put back afterwards, because
       everything outside aiTick assumes it. */
    const realTick = window.aiTick;
    B.st = { us: null, ger: null };
    B.turn = 0;
    function snap() { const o = {}; for (const k in AI) if (k !== 'side') o[k] = AI[k]; return o; }
    function load(s) { if (s) for (const k in s) AI[k] = s[k]; }

    B.reset = function (diff) {
      B.st = { us: null, ger: null };
      B.c = {
        ticks: 0, ms: 0, worst: 0, walks: 0, overFrame: 0, army: 0, calls: {},
        picks: 0, blindPicks: 0, orders: 0, blindOrders: 0, shots: 0, blindShots: 0,
        threatCalls: 0, threatUnseen: 0, threatAll: 0,
        frames: 0, foeF: 0, unseenF: 0,
        mood: {}, jobs: {}, waves: 0, wentIn: 0, formMs: [], gar: 0, works: 0, ups: 0,
        queued: {}, marks: 0, fuel: 0, sample: 0, rules: {},
        sense: { n: 0, contact: 0, arm: 0, cannot: 0, friendCan: 0, covered: 0, weak: 0,
                 knowsWho: 0, hurt: 0 },
        acts: {}, callOpen: 0, callWait: [], callSeen: {}
      };
      startGame('us', diff, 'vp');
      AI.t = 0;
      return { t: G.t };
    };

    /* --- what the brain calls, and what each call walks --- */
    /* What it calls, and how many times it takes a pass over the whole army to answer a
       question. `aiLook` takes one by design -- that is the point of it. Everything else
       taking one is the thing worth watching, so the walkers are counted separately from
       the rest. */
    const WALKS = { aiLook: 1, aiIntel: 1, aiStrength: 1, aiOwn: 1 };
    const WATCH = ['aiLook', 'aiThreat', 'aiIntel', 'aiStrength', 'aiOwn', 'aiPickTarget',
                   'aiHouse', 'aiDuck', 'aiOverwatch', 'aiFirePost', 'aiFormPost',
                   'aiSetUp', 'aiSightsOn'];
    for (const name of WATCH) {
      const real = window[name];
      if (typeof real !== 'function') continue;
      window[name] = function () {
        const c = B.c;
        if (c) { c.calls[name] = (c.calls[name] || 0) + 1; if (WALKS[name]) c.walks++; }
        return real.apply(this, arguments);
      };
    }

    /* --- the situation, and what was decided out of it --- */
    /* Counted off the layer's own output rather than re-derived: what a unit read, and
       which option won. An option that never wins is scoring nobody runs, and it looks
       exactly like an option that is not there -- which is the same hole the rule
       counters were dug for. */
    if (typeof window.aiSense === 'function') {
      const realSense = window.aiSense;
      window.aiSense = function (u, W) {
        const S = realSense(u, W), c = B.c;
        if (c && c.sense) {
          const q = c.sense;
          q.n++;
          if (S.thN) q.contact++;
          if (S.hurt) q.knowsWho++;
          if (S.hurtAmt > 4) q.hurt++;
          if (S.cover >= 2) q.covered++;
          if (S.weakest) q.weak++;
          if (S.arm) { q.arm++; if (!S.canAnswer) q.cannot++; if (S.frAt) q.friendCan++; }
        }
        return S;
      };
    }
    if (typeof window.aiWeigh === 'function') {
      const realWeigh = window.aiWeigh;
      window.aiWeigh = function (u, S, W) {
        const a = realWeigh(u, S, W), c = B.c;
        if (c) c.acts[a || 'plan'] = (c.acts[a || 'plan'] || 0) + 1;
        return a;
      };
    }

    /* --- the honesty boundary --- */
    const realPick = window.aiPickTarget;
    window.aiPickTarget = function (u, reach) {
      const r = realPick(u, reach);
      if (r && B.c) { B.c.picks++; if (!visibleTo(u.side, r)) B.c.blindPicks++; }
      return r;
    };
    const realOrderAttack = window.orderAttack;
    window.orderAttack = function (u, t) {
      if (B.c && t && t.side && t.side !== u.side) {
        B.c.orders++; if (!visibleTo(u.side, t)) B.c.blindOrders++;
      }
      return realOrderAttack(u, t);
    };
    const realFireAt = window.fireAt;
    window.fireAt = function (u, t, dt) {
      const cd0 = u.cd, at0 = u.atcd;
      const r = realFireAt(u, t, dt);
      if (B.c && t && t.side && t.side !== u.side && (u.cd > cd0 || u.atcd > at0)) {
        B.c.shots++; if (!visibleTo(u.side, t)) B.c.blindShots++;
      }
      return r;
    };
    /* how much of the weight aiThreat reads is weight nobody has eyes on. Deliberate --
       see the note on aiThreat -- but it should be a number somebody looked at. */
    const realThreat = window.aiThreat;
    window.aiThreat = function (side, x, y, r) {
      const out = realThreat(side, x, y, r);
      if (B.c) {
        B.c.threatCalls++;
        for (const e of G.units) {
          if (e.dead || e.side === side || e.inside || e.retreat) continue;
          if (dsq(e.x, e.y, x, y) >= r * r) continue;
          const v = aiValue(e);
          B.c.threatAll += v;
          if (!visibleTo(side, e)) B.c.threatUnseen += v;
        }
      }
      return out;
    };

    /* --- the plan, sampled --- */
    const realFrame = window.frame;
    window.frame = function (now) {
      realFrame(now);
      const c = B.c;
      if (!c) return;
      c.frames++;
      for (const e of G.units) {
        if (e.dead || e.side === AI.side || e.def.builder) continue;
        c.foeF++;
        if (!visibleTo(AI.side, e)) c.unseenF++;
      }
    };

    /* both brains think on the game's own cadence, alternating who thinks first */
    window.aiTick = function (dt) {
      const c = B.c, game = AI.side, keep = snap();
      const order = (B.turn++ & 1) ? ['ger', 'us'] : ['us', 'ger'];
      for (const side of order) {
        load(B.st[side]); AI.side = side;
        const before = c ? c.calls.__n : 0;
        const t0 = rnow();
        const ticked = AI.t - dt <= 0;
        realTick(dt);
        if (c && ticked) {
          const ms = rnow() - t0;
          c.ticks++; c.ms += ms;
          if (ms > c.worst) c.worst = ms;
          if (ms > 16.7) c.overFrame++;
          c.army += G.units.filter(x => !x.dead).length;
          c.mood[AI.mood] = (c.mood[AI.mood] || 0) + 1;
          if (AI.asKey) { if (AI.asT >= 0) c.pressT = 1; }
          for (const u of G.units) {
            if (u.dead || u.side !== side) continue;
            const j = u.job || 'none';
            c.jobs[j] = (c.jobs[j] || 0) + 1;
            if (u.gar) c.gar++;
          }
          c.works = G.works.length;
          /* the call board: how many are standing, and how long one stood before anybody
             was sent. Kept outside the call itself so the probe writes nothing into the
             game's own objects. */
          const Q = window.AIQ && AIQ[side];
          if (Q) {
            c.callOpen += Q.list.length;
            for (const q of Q.list) {
              const key = side + ':' + q.id;
              if (q.ans.length && !c.callSeen[key]) {
                c.callSeen[key] = 1; c.callWait.push(+(G.t - q.t).toFixed(1));
              }
            }
          }
          c.sample++;
          c.marks += G.res[side].mp; c.fuel += G.res[side].fu;
          /* every named rule the brain counts for itself */
          if (window.AIR && AIR.fired) for (const k in AIR.fired) c.rules[k] = AIR.fired[k];
        }
        B.st[side] = snap();
      }
      load(keep); AI.side = game;
    };

    /* waves: watched rather than counted inside the brain, so the card works on a file
       that has no counters in it */
    B.waveWatch = function () {
      let lastKey = { us: null, ger: null }, formAt = { us: 0, ger: 0 }, pressing = { us: false, ger: false };
      return function (side) {
        const c = B.c;
        if (!c) return;
        const k = AI.asKey;
        if (k !== lastKey[side]) { lastKey[side] = k; formAt[side] = G.t; pressing[side] = false; if (k) c.waves++; }
        if (k && AI.asT >= 0 && !pressing[side]) {
          pressing[side] = true; c.wentIn++;
          c.formMs.push(+(G.t - formAt[side]).toFixed(1));
        }
      };
    }();

    B.read = function () {
      const c = B.c;
      const out = {};
      for (const k in c) out[k] = c[k];
      out.t = Math.round(G.t);
      out.over = G.over || '';
      out.units = G.units.filter(u => !u.dead).length;
      return out;
    };
  });
}

/* the wave watch has to run inside the two-sided tick, so it is hooked after install */
async function hookWaves(page) {
  await page.evaluate(() => {
    const B = window.__b, realTick = window.aiTick;
    window.aiTick = function (dt) {
      realTick(dt);
      /* read the plan of each side after both have thought */
      const game = AI.side;
      for (const side of ['us', 'ger']) {
        const s = B.st[side];
        if (!s) continue;
        const keep = {}; for (const k in AI) if (k !== 'side') keep[k] = AI[k];
        for (const k in s) AI[k] = s[k];
        AI.side = side;
        B.waveWatch(side);
        for (const k in keep) AI[k] = keep[k];
        AI.side = game;
      }
    };
  });
}

/* ------------------------------------------------------------------ the card */

async function card(file, label) {
  const browser = await launch();
  const { page } = await openGame(browser, 'desktop', { file, quiet: true });
  await deploy(page, { side: 'us', diff: DIFF });
  await install(page);
  await hookWaves(page);

  const runs = [];
  for (let r = 0; r < N; r++) {
    await page.evaluate(d => window.__b.reset(d), DIFF);
    const marks = 5;
    for (let m = 0; m < marks; m++) {
      await fastForward(page, SECS / marks);
      if (await page.evaluate(() => !!G.over)) break;
    }
    runs.push(await page.evaluate(() => window.__b.read()));
    process.stderr.write(`  run ${r + 1}: ${runs[r].t}s, ${runs[r].ticks} thinking ticks, ` +
                         `${runs[r].waves} waves\n`);
  }
  await browser.close();
  return { label, runs };
}

/* ------------------------------------------------------------------ printing */

const pad = (s, n, right) => right ? String(s).padStart(n) : String(s).padEnd(n);
const pct = (a, b) => b ? (a / b * 100).toFixed(a / b >= 0.1 ? 1 : 2) + '%' : '-';

function sum(runs, pick) { return runs.reduce((s, r) => s + (pick(r) || 0), 0); }
function mergeMap(runs, key) {
  const out = {};
  runs.forEach(r => { for (const k in r[key]) out[k] = (out[k] || 0) + r[key][k]; });
  return out;
}

function show(c) {
  const runs = c.runs, n = runs.length;
  const ticks = sum(runs, r => r.ticks), ms = sum(runs, r => r.ms);
  const secs = sum(runs, r => r.t);

  console.log('\n  COST     ' + n + (n === 1 ? ' battle, ' : ' battles, ') + secs +
              's of it, a brain on both sides\n');
  console.log('  ' + pad('thinking ticks', 22) + pad(ticks, 9, 1));
  console.log('  ' + pad('a tick', 22) + pad((ms / ticks).toFixed(2) + ' ms', 9, 1) +
              '   worst ' + Math.max(...runs.map(r => r.worst)).toFixed(1) + ' ms');
  console.log('  ' + pad('whole-army walks', 22) + pad((sum(runs, r => r.walks) / ticks).toFixed(1), 9, 1) +
              '   a tick, to answer everything it asks');
  console.log('  ' + pad('over a frame', 22) + pad(sum(runs, r => r.overFrame), 9, 1) +
              '   ticks costing more than 16.7 ms');
  console.log('  ' + pad('army', 22) + pad(Math.round(sum(runs, r => r.army) / ticks), 9, 1) +
              '   mean units alive while thinking');
  const calls = mergeMap(runs, 'calls');
  console.log('\n  ' + pad('calls a tick', 22));
  Object.entries(calls).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log('    ' + pad(k, 20) + pad((v / ticks).toFixed(1), 7, 1)));

  console.log('\n  SIGHT    what it acts on that it has never seen\n');
  const foeF = sum(runs, r => r.foeF), unseenF = sum(runs, r => r.unseenF);
  console.log('  ' + pad('enemy out of sight', 22) + pad(pct(unseenF, foeF), 9, 1) +
              '   of enemy-unit-frames');
  const picks = sum(runs, r => r.picks), bp = sum(runs, r => r.blindPicks);
  const orders = sum(runs, r => r.orders), bo = sum(runs, r => r.blindOrders);
  const shots = sum(runs, r => r.shots), bs = sum(runs, r => r.blindShots);
  console.log('  ' + pad('targets picked', 22) + pad(picks, 9, 1) + '   never seen: ' + pct(bp, picks));
  console.log('  ' + pad('attack orders', 22) + pad(orders, 9, 1) + '   never seen: ' + pct(bo, orders));
  console.log('  ' + pad('rounds away', 22) + pad(shots, 9, 1) + '   at something unseen: ' + pct(bs, shots));
  const tAll = sum(runs, r => r.threatAll), tUn = sum(runs, r => r.threatUnseen);
  console.log('  ' + pad('threat weight unseen', 22) + pad(pct(tUn, tAll), 9, 1) +
              '   deliberate: the staff work is allowed the map');

  console.log('\n  PLAN     what it actually did\n');
  const mood = mergeMap(runs, 'mood'), jobs = mergeMap(runs, 'jobs');
  const moodT = Object.values(mood).reduce((a, b) => a + b, 0);
  console.log('  ' + pad('mood', 22) + Object.entries(mood).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k + ' ' + pct(v, moodT)).join('   '));
  const jobT = Object.values(jobs).reduce((a, b) => a + b, 0);
  console.log('  ' + pad('jobs dealt', 22) + Object.entries(jobs).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k + ' ' + pct(v, jobT)).join('  '));
  const waves = sum(runs, r => r.waves), went = sum(runs, r => r.wentIn);
  const forms = runs.flatMap(r => r.formMs);
  console.log('  ' + pad('waves formed', 22) + pad(waves, 9, 1) + '   went in: ' + went +
              (waves ? ' (' + pct(went, waves) + ')' : ''));
  if (forms.length) console.log('  ' + pad('forming took', 22) +
    pad((forms.reduce((a, b) => a + b, 0) / forms.length).toFixed(0) + ' s', 9, 1) +
    '   longest ' + Math.max(...forms).toFixed(0) + ' s');
  console.log('  ' + pad('men in houses', 22) + pad((sum(runs, r => r.gar) / ticks).toFixed(2), 9, 1) +
              '   sections garrisoned, a tick');
  console.log('  ' + pad('works standing', 22) + pad(sum(runs, r => r.works), 9, 1));
  console.log('  ' + pad('sitting on', 22) +
              pad(Math.round(sum(runs, r => r.marks) / sum(runs, r => r.sample)), 9, 1) + ' marks, ' +
              Math.round(sum(runs, r => r.fuel) / sum(runs, r => r.sample)) + ' fuel');

  const rules = mergeMap(runs, 'rules');
  const sense = runs.reduce((a, r) => {
    for (const k in r.sense) a[k] = (a[k] || 0) + r.sense[k];
    return a;
  }, {});
  if (sense.n) {
    console.log('\n  SENSE    what a unit reads about its own position, and what it chose\n');
    console.log('  ' + pad('unit-ticks read', 22) + pad(sense.n, 9, 1));
    console.log('  ' + pad('in contact', 22) + pad(pct(sense.contact, sense.n), 9, 1) +
                '   knows what hit it: ' + pct(sense.knowsWho, sense.n));
    console.log('  ' + pad('behind something', 22) + pad(pct(sense.covered, sense.n), 9, 1) +
                '   a hurt enemy in reach: ' + pct(sense.weak, sense.n));
    console.log('  ' + pad('armour in front', 22) + pad(pct(sense.arm, sense.n), 9, 1) +
                '   cannot answer it: ' + pct(sense.cannot, sense.n) +
                ', a friend can: ' + pct(sense.friendCan, sense.n));
    const acts = mergeMap(runs, 'acts'), actN = Object.values(acts).reduce((a, b) => a + b, 0);
    console.log('\n  ' + pad('chose', 22) + Object.entries(acts).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => k + ' ' + pct(v, actN)).join('  '));
  }

  const waited = runs.flatMap(r => r.callWait || []);
  console.log('\n  CALLS    asking for what it cannot do itself\n');
  console.log('  ' + pad('raised', 22) +
              pad((rules['call.armour'] || 0) + (rules['call.men'] || 0), 9, 1) +
              '   answered: ' + (rules['call.answer'] || 0) +
              ', settled: ' + (rules['call.done'] || 0) +
              ', lapsed: ' + (rules['call.lapsed'] || 0));
  console.log('  ' + pad('standing a tick', 22) +
              pad((sum(runs, r => r.callOpen) / ticks).toFixed(2), 9, 1));
  if (waited.length) console.log('  ' + pad('waited to be answered', 22) +
    pad((waited.reduce((a, b) => a + b, 0) / waited.length).toFixed(1) + 's', 9, 1) +
    '   worst ' + Math.max(...waited).toFixed(1) + 's over ' + waited.length);
  /* the three below are unit-ticks rather than events: a call is worked every tick it is
     open, so what these count is how long was spent doing each, not how often it started */
  console.log('  ' + pad('unit-ticks held', 22) + pad(rules['hold.help'] || 0, 9, 1) +
              '   driving to a call: ' + (rules['answer.go'] || 0) +
              ', answerer in contact: ' + (rules['answer.here'] || 0));

  console.log('\n  RULES    every named decision, and how often it fired\n');
  const rk = Object.keys(rules);
  if (!rk.length) {
    console.log('    this file keeps no counters. A rule that never fires looks exactly');
    console.log('    like a rule that is not there, so the brain counts its own.');
  } else {
    rk.sort((a, b) => rules[b] - rules[a]).forEach(k => {
      const v = rules[k];
      console.log('    ' + pad(k, 22) + pad(v, 8, 1) + (v ? '' : '   never fired'));
    });
  }
}

/* ------------------------------------------------------------------ run */

let older = null;
if (BASE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-brain-'));
  const f = path.join(dir, 'ortona.html');
  fs.writeFileSync(f, execFileSync('git', ['show', `${BASE}:ortona.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  process.stderr.write(`  ${BASE} ...\n`);
  older = await card(f, BASE);
  fs.rmSync(dir, { recursive: true, force: true });
}
process.stderr.write('  working file ...\n');
const now = await card(GAME, 'working');

if (args.json) {
  console.log(JSON.stringify({ now, older }, null, 2));
} else {
  show(now);
  if (older) { console.log('\n\n  BEFORE   ' + BASE); show(older); }
  console.log('');
}
