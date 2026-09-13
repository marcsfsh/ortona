/* Balance, mechanically.
 *
 * Stats on paper do not tell you who wins. Damage per volley interacts with how many
 * men are left to fire it, suppression feeds back into accuracy and rate of fire,
 * penetration interacts with facing and range, and the whole thing compounds: a side
 * that gets a little ahead gets further ahead. The only honest way to read a change is
 * to fight it.
 *
 * This stages matchups on clean flat ground with no cover, no economy, no AI and no
 * reinforcement, and steps the game's own update functions. Nothing is reimplemented
 * here: it calls updateUnit, fireAt and computeVisibility exactly as the loop does, so
 * it cannot drift away from the game.
 *
 *   node tools/duel.mjs                      the standard card
 *   node tools/duel.mjs --n=24               more repeats, tighter numbers
 *   node tools/duel.mjs us_rifle ger_gren    one matchup
 *   node tools/duel.mjs --d=200              at a chosen opening range
 *   node tools/duel.mjs --cover=3            with both sides in heavy cover
 *   node tools/duel.mjs --json               machine-readable
 *
 * A matchup line reads: A vs B, how often A won, how long it took, and what the winner
 * had left. Anything from about 40 to 60 per cent is a fair fight; the point of the
 * tool is to find the ones that are not.
 */

import { launch, openGame, deploy, parseArgs } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const N = args.n === undefined ? 12 : Number(args.n);
const DIST = args.d === undefined ? 0 : Number(args.d);      /* 0 = each pair's own reach */
const COVER = args.cover === undefined ? 0 : Number(args.cover);
const LIMIT = args.limit === undefined ? 150 : Number(args.limit);
const positional = args._ || [];

/* The card. Each row is a question the roster has to answer. A third entry fits field
   upgrades before the fight, because half of what a vehicle can do is an upgrade and a
   roster is not balanced until those are too. */
const CARD = [
  ['us_rifle', 'ger_gren'],
  ['us_ab', 'ger_pgren'],
  ['us_fg', 'ger_pgren'],
  ['us_fg', 'ger_gren'],
  ['us_mg', 'ger_mg42'],
  ['us_mg', 'ger_gren'],
  ['ger_mg42', 'us_rifle'],
  ['us_eng', 'ger_pio'],
  ['us_at', 'ger_p4'],
  ['ger_pak', 'us_sher'],
  ['us_sher', 'ger_p4'],
  ['us_ach', 'ger_p4'],
  ['us_ach', 'ger_tig'],
  ['us_sher', 'ger_tig'],
  ['us_stuart', 'ger_sd222'],
  ['us_m8', 'ger_sd222'],
  ['us_m3', 'ger_h251'],
  ['us_rifle', 'ger_sd222'],
  ['us_ab', 'ger_p4'],
  ['ger_pgren', 'us_sher'],
  ['us_t8', 'ger_p4'],
  ['ger_tig', 'us_at'],
  ['us_sher', 'ger_stug'],
  ['us_at', 'ger_stug'],
  ['us_ab', 'ger_stug'],
  /* and the field upgrades */
  ['ger_sd222', 'us_m8', { a: ['kwk'] }],
  ['ger_sd222', 'us_stuart', { a: ['kwk'] }],
  ['us_m3', 'ger_h251', { a: ['quad50'], b: ['drill'] }],
  ['us_m3', 'ger_gren', { a: ['quad50'] }],
  ['ger_h251', 'us_rifle', { a: ['drill'] }],
  ['us_m3', 'ger_p4', { a: ['how75'] }],
  ['ger_h251', 'us_stuart', { a: ['pak36'] }],
  ['us_m8', 'ger_gren', { a: ['thirty'] }],
  ['ger_p4', 'us_ab', { a: ['skirts'] }],
  ['us_sher', 'ger_p4', { a: ['mg'], b: ['mg', 'skirts'] }],
  ['us_sher', 'ger_stug', { b: ['scope', 'mgs', 'skirts'] }]
];

const browser = await launch();
const { page } = await openGame(browser, 'desktop');
await deploy(page, { side: 'us', diff: 1 });

const pairs = positional.length >= 2 ? [[positional[0], positional[1]]] : CARD;
const rows = await page.evaluate(({ pairs, N, DIST, COVER, LIMIT }) => {
  /* a wide flat patch well away from anything either side owns */
  function findField() {
    let best = null, bestDev = 1e9;
    for (let y = 520; y < 1500; y += 60) {
      for (let x = 900; x < 1900; x += 60) {
        let lo = 1e9, hi = -1e9, ok = true;
        for (let dx = -300; dx <= 300 && ok; dx += 50) {
          const z = groundZ(x + dx, y);
          if (!walkable(x + dx, y)) ok = false;
          const ci = cidx(((x + dx) / CELL) | 0, (y / CELL) | 0);
          if (sblk[ci] || fblk[ci]) ok = false;
          if (z < lo) lo = z;
          if (z > hi) hi = z;
        }
        if (!ok) continue;
        if (hi - lo < bestDev) { bestDev = hi - lo; best = { x, y }; }
      }
    }
    return best || { x: 1400, y: 950 };
  }
  const field = findField();

  /* one tick of the real game, minus everything that is not the fight */
  function step(dt) {
    G.t += dt;
    computeVisibility(dt);
    for (let i = 0; i < G.units.length; i++) updateUnit(G.units[i], dt);
    updateShots(dt);
    for (let k = G.units.length - 1; k >= 0; k--) if (G.units[k].dead) G.units.splice(k, 1);
  }

  function strength(side) {
    let s = 0;
    for (const u of G.units) {
      if (u.dead || u.side !== side) continue;
      s += u.cat === 'veh' ? u.hp / u.maxhp : u.models.filter(m => m.alive).length / u.def.models;
    }
    return s;
  }

  function once(ka, kb, dist, flip, ups) {
    G.units.length = 0; G.shots.length = 0; G.fx.length = 0; G.corpses.length = 0;
    AI.t = 1e9;
    const savedCovers = G.covers, savedIdx = G.coverIdx;
    G.covers = []; G.coverIdx = [];
    if (COVER > 0) {
      /* both sides equally dug in, so cover is tested rather than position */
      addCover(field.x - dist / 2, field.y, 90, COVER, 'test', null, 1e6);
      addCover(field.x + dist / 2, field.y, 90, COVER, 'test', null, 1e6);
    }
    /* Units are updated in the order they were raised, so within a tick whoever was
       spawned first shoots first. Over a whole fight that is a real edge, and with two
       identical units it is the only difference between them, so the order alternates. */
    let a, b;
    if (flip) {
      b = spawnUnit('ger', kb, field.x + dist / 2, field.y, Math.PI);
      a = spawnUnit('us', ka, field.x - dist / 2, field.y, 0);
    } else {
      a = spawnUnit('us', ka, field.x - dist / 2, field.y, 0);
      b = spawnUnit('ger', kb, field.x + dist / 2, field.y, Math.PI);
    }
    /* A squad is laid out in world space at spawn, not relative to its facing, so the
       east side had its men stepped away from the enemy while the west side had them
       stepped toward it. Mirror the east squad, or the tool reports a difference between
       the two sides that is its own and not the roster's. */
    if (b.models) for (const m of b.models) { m.ox = -m.ox; m.x = b.x + m.ox; }
    if (ups) {
      for (const k of (ups.a || [])) { a.up = a.up || {}; a.up[k] = 1; }
      for (const k of (ups.b || [])) { b.up = b.up || {}; b.up[k] = 1; }
    }
    a.order = 'attackmove'; b.order = 'attackmove';
    a.dest = { x: b.x, y: b.y }; b.dest = { x: a.x, y: a.y };
    computeVisibility();
    let t = 0;
    const dt = 1 / 20;
    while (t < LIMIT) {
      step(dt); t += dt;
      if (a.dead || b.dead) break;
    }
    const sa = strength('us'), sb = strength('ger');
    G.covers = savedCovers; G.coverIdx = savedIdx;
    return { win: b.dead && !a.dead ? 0 : a.dead && !b.dead ? 1 : sa > sb ? 0 : sb > sa ? 1 : -1,
             t: t, left: Math.max(sa, sb) };
  }

  const out = [];
  for (const [ka, kb, ups] of pairs) {
    const A = UNITS[ka], B = UNITS[kb];
    if (!A || !B) { out.push({ a: ka, b: kb, err: 'no such unit' }); continue; }
    /* open at the shorter of the two reaches, so neither starts out of the fight */
    const wOf = (d, list) => {
      if (d.wUp && list) for (const k of list) if (d.wUp[k]) return d.wUp[k];
      return d.w;
    };
    const wa = wOf(A, ups && ups.a), wb = wOf(B, ups && ups.b);
    const ra = Math.max(wa.range, A.at ? A.at.range : 0);
    const rb = Math.max(wb.range, B.at ? B.at.range : 0);
    const dist = DIST || Math.round(Math.min(ra, rb) * .82);
    let winA = 0, winB = 0, draw = 0, sumT = 0, sumLeft = 0;
    for (let i = 0; i < N; i++) {
      const r = once(ka, kb, dist, i % 2, ups);
      if (r.win === 0) winA++; else if (r.win === 1) winB++; else draw++;
      sumT += r.t; sumLeft += r.left;
    }
    const cost = k => (UNITS[k].cost.mp || 0) + (UNITS[k].cost.fu || 0) * 2.4;
    const tag = ups ? ((ups.a ? '+' + ups.a.join('+') : '') + (ups.b ? ' /+' + ups.b.join('+') : '')) : '';
    out.push({ a: ka, b: kb, up: tag, dist: dist, winA: winA, winB: winB, draw: draw,
               pct: Math.round(100 * winA / N), t: +(sumT / N).toFixed(1),
               left: +(sumLeft / N).toFixed(2),
               costA: Math.round(cost(ka)), costB: Math.round(cost(kb)),
               popA: A.pop, popB: B.pop });
  }
  return out;
}, { pairs, N, DIST, COVER, LIMIT });

await browser.close();

if (args.json) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log(`\n  ${N} runs each, opening range ${DIST || 'per pair'}, cover tier ${COVER}\n`);
  console.log('  ' + pad('A', 11) + pad('B', 11) + lpad('A wins', 7) + lpad('secs', 7) +
              lpad('left', 6) + lpad('cost A', 8) + lpad('cost B', 8) + lpad('pop', 7) + '  upgrades');
  console.log('  ' + '-'.repeat(78));
  for (const r of rows) {
    if (r.err) { console.log('  ' + pad(r.a, 11) + pad(r.b, 11) + r.err); continue; }
    const flag = r.pct >= 40 && r.pct <= 60 ? ' ' : r.pct >= 30 && r.pct <= 70 ? '.' : '!';
    console.log('  ' + pad(r.a, 11) + pad(r.b, 11) + lpad(r.pct + '%', 7) + lpad(r.t, 7) +
                lpad(r.left, 6) + lpad(r.costA, 8) + lpad(r.costB, 8) +
                lpad(r.popA + '/' + r.popB, 7) + ' ' + flag + ' ' + r.up);
  }
  console.log('\n  cost is manpower plus fuel at 2.4, which is roughly what fuel is worth here.');
  console.log('  ! is a matchup outside 30-70 per cent and worth looking at.\n');
}
