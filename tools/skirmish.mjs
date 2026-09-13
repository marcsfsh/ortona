/* Tactics, mechanically.
 *
 * An AI cannot be reviewed by reading it. Whether one set of decisions beats another is
 * a question about a whole battle -- production, timing, ground, concentration, and the
 * way a small early edge compounds -- and the only honest way to read a change to it is
 * to fight the old version.
 *
 * So this puts an AI on both sides of the shipped map and lets them have it out. One
 * side runs the aiTick in the working file; the other runs the aiTick out of a git
 * revision, extracted and injected at runtime. Sides alternate between matches, because
 * the two halves of Ortona are not the same ground and the two rosters are not the same
 * army.
 *
 *   node tools/skirmish.mjs                  four matches against the last commit
 *   node tools/skirmish.mjs --self           the working AI on both sides (calibration)
 *   node tools/skirmish.mjs --base=HEAD~3    fight an older revision
 *   node tools/skirmish.mjs --n=6 --t=900    more matches, longer ones
 *   node tools/skirmish.mjs --diff=2         at veteran settings
 *   node tools/skirmish.mjs --json
 *
 * Nothing here reimplements the game. The two brains are driven by intercepting the
 * aiTick call that frame() already makes, each with its own saved state, so both sides
 * think on the game's own cadence and every other system runs exactly as it ships.
 *
 * The scoreboard is the game's own: victory points, then the ground held, then what is
 * left alive. The columns after it are the tactical picture -- how concentrated the army
 * is, how much of it is in cover, how far it has pushed, how much money it is sitting on
 * -- because a win rate says which AI is better and those say why.
 */

import { execFileSync } from 'node:child_process';
import { launch, openGame, deploy, fastForward, parseArgs } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const N = args.n === undefined ? 4 : Number(args.n);
const SECS = args.t === undefined ? 600 : Number(args.t);
const DIFF = args.diff === undefined ? 1 : Number(args.diff);
const BASE = args.base === undefined ? 'HEAD' : String(args.base);
const SELF = !!args.self;
const MARKS = 6;

/* ---- pull the baseline brain out of a revision -------------------------------- */

function brace(src, from) {
  let i = src.indexOf('{', from), d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(from, j + 1);
  }
  throw new Error('unbalanced braces');
}
function fn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(`no function ${name} in the baseline`);
  return brace(src, at);
}
function baselineBrain(rev) {
  const src = execFileSync('git', ['show', `${rev}:ortona.html`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  /* aiOwn goes with it: it is part of the brain and reads AI.side, so a baseline has to
     carry its own copy rather than borrow whatever the working file now calls it. */
  return [fn(src, 'aiOwn'), fn(src, 'aiTick')].join('\n');
}

const baseSrc = SELF ? null : baselineBrain(BASE);
const baseLabel = SELF ? 'self' : BASE;

/* ---- the page side ------------------------------------------------------------ */

async function install(page, baseSrc) {
  await page.evaluate((src) => {
    const real = window.aiTick;
    const base = src ? new Function(src + '\nreturn aiTick;')() : null;
    const SK = window.__sk = { sides: { us: 'new', ger: 'new' }, st: { us: null, ger: null } };

    /* One AI object, two brains. Each side's fields are swapped in around its own call,
       so neither can read the other's plan, and the game's own side is left in place
       afterwards because everything outside this function assumes it. */
    function snap() { const o = {}; for (const k in AI) if (k !== 'side') o[k] = AI[k]; return o; }
    function load(s) { if (s) for (const k in s) AI[k] = s[k]; }
    window.aiTick = function (dt) {
      const game = AI.side, keep = snap();
      ['us', 'ger'].forEach(function (side) {
        const impl = SK.sides[side] === 'base' && base ? base : real;
        load(SK.st[side]); AI.side = side;
        impl(dt);
        SK.st[side] = snap();
      });
      load(keep); AI.side = game;
    };

    SK.reset = function (sides, diff) {
      SK.sides = sides;
      SK.st = { us: null, ger: null };
      startGame('us', diff, 'vp');
      AI.t = 0;
      return { t: G.t, diff: G.diff };
    };

    /* What a side looks like right now. The score is the game's; the rest is the shape
       of the army, which is what a tactics change actually moves. */
    SK.look = function () {
      const val = u => (u.def.cost.mp || 0) + (u.def.cost.fu || 0) * 2.4;
      const frac = u => u.cat === 'veh' ? u.hp / u.maxhp
                                        : u.models.filter(m => m.alive).length / u.def.models;
      const out = {};
      ['us', 'ger'].forEach(function (side) {
        const mine = G.units.filter(u => !u.dead && u.side === side);
        const fight = mine.filter(u => !u.def.builder);
        const hq = hqOf(side);
        let sec = 0, secN = 0;
        G.sectors.forEach(function (s) {
          if (s.owner !== side) return;
          secN++;
          sec += (s.type === 'vp' ? 3 : s.type === 'fuel' ? 2 : 1) * (s.conn ? 1 : .4);
        });
        /* how close together it fights: the distance from each section to the nearest
           other one. A trickle reads high, a concentrated push reads low. */
        let clump = 0, cn = 0;
        fight.forEach(function (u) {
          let bd = 1e9;
          fight.forEach(function (v) { if (v !== u) { const d = dist(u, v); if (d < bd) bd = d; } });
          if (bd < 1e9) { clump += bd; cn++; }
        });
        /* how much of the infantry is behind something, and how much is in a house */
        let men = 0, covered = 0, gar = 0;
        mine.forEach(function (u) {
          if (u.cat === 'veh') return;
          if (u.gar) gar++;
          u.models.forEach(function (m) {
            if (!m.alive) return;
            men++;
            if (u.gar || coverAt(m.x, m.y) > 0) covered++;
          });
        });
        /* fire discipline: how many of the sections that are shooting are shooting at
           the same thing. 1 means everyone has picked a different target. */
        const engaged = fight.filter(u => u.target && !u.target.dead);
        const seen = {};
        engaged.forEach(function (u) { seen[u.target.id] = 1; });
        const spread = engaged.length ? Object.keys(seen).length / engaged.length : 0;
        out[side] = {
          vp: Math.round(G.res[side].vp), mp: Math.round(G.res[side].mp), fu: Math.round(G.res[side].fu),
          sec: +sec.toFixed(1), secN: secN,
          army: Math.round(mine.reduce((s, u) => s + val(u) * frac(u), 0)),
          n: mine.length, veh: mine.filter(u => u.cat === 'veh').length,
          team: mine.filter(u => u.cat === 'team').length,
          blds: G.blds.filter(b => b.side === side).length,
          done: G.blds.filter(b => b.side === side && b.built >= 1).length,
          clump: cn ? Math.round(clump / cn) : 0,
          cover: men ? +(covered / men).toFixed(2) : 0,
          gar: gar,
          idle: fight.length ? +(fight.filter(u => !u.order).length / fight.length).toFixed(2) : 0,
          push: hq && fight.length ? Math.round(fight.reduce((s, u) => s + dist(u, hq), 0) / fight.length) : 0,
          hurt: fight.filter(u => frac(u) < .5).length,
          spread: +spread.toFixed(2),
          engaged: engaged.length
        };
      });
      out.t = Math.round(G.t);
      out.over = G.over;
      return out;
    };
  }, baseSrc);
}

/* ---- run the card ------------------------------------------------------------- */

const browser = await launch();
const { page, log } = await openGame(browser, 'desktop', { quiet: true });
await deploy(page, { side: 'us', diff: DIFF });
await install(page, baseSrc);

/* Ortona is not a symmetric map and the two rosters are not the same army: with the same
   brain on both sides the Canadians take thirteen points of ground to the Germans' four,
   every time. So a single match cannot measure a brain. Each pair below is the same
   match played twice with the brains swapped, and the brains are compared to each other
   on the same side of the map, which is the only comparison the ground does not skew. */
const matches = [];
for (let i = 0; i < N; i++) {
  for (const newSide of ['us', 'ger']) {
    const sides = SELF ? { us: 'new', ger: 'new' }
                       : { us: newSide === 'us' ? 'new' : 'base', ger: newSide === 'ger' ? 'new' : 'base' };
    await page.evaluate(a => window.__sk.reset(a[0], a[1]), [sides, DIFF]);
    const trail = [];
    for (let m = 1; m <= MARKS; m++) {
      await fastForward(page, SECS / MARKS);
      trail.push(await page.evaluate(() => window.__sk.look()));
      if (trail[trail.length - 1].over) break;
    }
    const end = trail[trail.length - 1];
    const other = newSide === 'us' ? 'ger' : 'us';
    const A = end[newSide], B = end[other];
    /* Scored over the whole match rather than at the final whistle. A battle here
       compounds -- whoever wins the first serious clash tends to walk the rest of the
       map -- so an end-of-match snapshot is nearly a coin toss weighted by a small edge,
       and the mean of the trail says who actually held the ground for the duration. */
    let run = 0;
    for (const k of trail) {
      const a = k[newSide], b = k[other];
      run += 14 * (a.sec - b.sec) + (a.vp - b.vp) * .5;
    }
    const score = run / trail.length + (end.over === newSide ? 300 : end.over ? -300 : 0);
    matches.push({ pair: i, side: newSide, score: Math.round(score), t: end.t, over: end.over,
                   A: A, B: B, trail: trail });
    process.stderr.write(`  pair ${i + 1} new=${newSide}  score ${Math.round(score)}` +
                         `  vp ${A.vp}-${B.vp}  sec ${A.sec}-${B.sec}  army ${A.army}-${B.army}` +
                         `  t=${end.t}${end.over ? ' over:' + end.over : ''}\n`);
  }
}

await browser.close();

/* ---- the card ----------------------------------------------------------------- */

function mean(list, pick) { return list.length ? list.reduce((s, r) => s + pick(r), 0) / list.length : 0; }

/* A pair is one match with the brains one way round and one with them the other, so the
   two brains are compared on the same two pieces of ground. Within a pair the working
   brain's score on one side and the baseline's score on that same side are the two halves
   of the mirror, so the pair goes to whichever brain came out ahead over both. */
const bySide = {};
['us', 'ger'].forEach(function (side) {
  const mine = matches.filter(m => m.side === side);
  const theirs = matches.filter(m => m.side !== side);
  bySide[side] = { neu: mine, base: theirs.map(m => ({ A: m.B, B: m.A, score: -m.score, t: m.t, over: m.over })) };
});
let won = 0, pairs = 0;
for (let i = 0; i < N; i++) {
  const a = matches.filter(m => m.pair === i);
  if (a.length < 2) continue;
  pairs++;
  const sum = a[0].score + a[1].score;
  if (sum > 0) won++; else if (sum === 0) won += .5;
}

if (args.json) {
  console.log(JSON.stringify({ base: baseLabel, pairs: N, secs: SECS, diff: DIFF, won: won, of: pairs,
                               matches: matches }, null, 1));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const lp = (s, n) => String(s).padStart(n);
  console.log(`\n  ${N} mirror pairs of ${SECS}s at difficulty ${DIFF}, working AI against ${baseLabel}` +
              (SELF ? ' (both sides the same brain)' : '') + '\n');
  console.log('  ' + pad('', 13) + lp('score', 7) + lp('vp', 6) + lp('sec', 6) + lp('army', 7) +
              lp('units', 6) + lp('veh', 5) + lp('team', 5) + lp('blds', 7) + lp('clump', 7) +
              lp('cover', 7) + lp('gar', 5) + lp('idle', 6) + lp('push', 6) + lp('spread', 8) + lp('mp', 7));
  console.log('  ' + '-'.repeat(105));
  ['us', 'ger'].forEach(function (side) {
    [['working', bySide[side].neu], ['baseline', bySide[side].base]].forEach(function (row) {
      const [name, list] = row;
      const s = list.map(r => r.A);
      console.log('  ' + pad(side + ' ' + name, 13) + lp(Math.round(mean(list, r => r.score)), 7) +
                  lp(Math.round(mean(s, r => r.vp)), 6) + lp(mean(s, r => r.sec).toFixed(1), 6) +
                  lp(Math.round(mean(s, r => r.army)), 7) + lp(mean(s, r => r.n).toFixed(1), 6) +
                  lp(mean(s, r => r.veh).toFixed(1), 5) + lp(mean(s, r => r.team).toFixed(1), 5) +
                  lp(mean(s, r => r.done).toFixed(1) + '/' + mean(s, r => r.blds).toFixed(1), 7) +
                  lp(Math.round(mean(s, r => r.clump)), 7) + lp(mean(s, r => r.cover).toFixed(2), 7) +
                  lp(mean(s, r => r.gar).toFixed(1), 5) + lp(mean(s, r => r.idle).toFixed(2), 6) +
                  lp(Math.round(mean(s, r => r.push)), 6) + lp(mean(s, r => r.spread).toFixed(2), 8) +
                  lp(Math.round(mean(s, r => r.mp)), 7));
    });
  });
  console.log(`\n  working AI ahead in ${won} of ${pairs} same-side comparisons` +
              (SELF ? '  (a self match should land near half: the rest is noise, and worth knowing)' : ''));
  console.log('  score is victory point lead plus fourteen per point of ground held, and 300 for ending it.');
  console.log('  clump is the mean distance to the nearest friendly section, so lower is more concentrated.');
  console.log('  cover is the share of men behind something; gar is sections holding houses.');
  console.log('  push is the mean distance from its own headquarters; spread is how many different');
  console.log('  targets the sections that are firing have picked, where 1 is everyone on their own.\n');
  if (log.errors.length) console.log('  page errors: ' + log.errors.slice(0, 3).join(' | ') + '\n');
}
