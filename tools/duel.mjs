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

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openGame, deploy, parseArgs, GAME } from './harness.mjs';

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
  /* The mortars. A tube against a section is the row the roster is judged on -- what a
     mortar is for is men in the open and men behind something -- and tube against tube is
     the calibration row for the pair, the way us_eng against ger_pio is for the rifles.
     Note what a duel cannot show about one: it stages both sides in sight of each other,
     so a mortar here is firing at what it can see itself, which is the half of its job it
     is worst at. What it does to ground nobody can see into is not a duel question. */
  ['us_mor', 'ger_gren'],
  ['ger_mor', 'us_rifle'],
  ['us_mor', 'ger_mor'],
  ['us_eng', 'ger_pio'],
  ['us_at', 'ger_p4'],
  ['ger_pak', 'us_sher'],
  ['us_sher', 'ger_p4'],
  ['us_ach', 'ger_p4'],
  ['us_ach', 'ger_tig'],
  ['us_sher', 'ger_tig'],
  ['us_stuart', 'ger_sd222'],
  ['us_m8', 'ger_sd222'],
  /* the jeep, which is what the Americans field in the carrier's place: against the car it
     meets, the squad it meets and the paratroopers, and fitted with the .50 against the
     car and the half-track */
  ['am_jeep', 'ger_sd222'],
  ['am_jeep', 'hr_gren'],
  ['am_jeep', 'ger_gren'],
  /* and the KS 750, which the 352nd fields in the 222's place: against the squad it meets,
     the jeep, the Canadian section and the carrier */
  ['hr_ks750', 'am_rifle'],
  ['hr_ks750', 'am_jeep'],
  ['hr_ks750', 'us_rifle'],
  ['hr_ks750', 'us_m8'],
  /* and the Panzer IV the 352nd fields in the Italian one's place: against the M4 it meets
     on the beach and the squad */
  ['am_sher', 'hr_p4'],
  ['hr_p4', 'am_rifle'],
  /* and the engineer squad the Americans field in the Canadian section's place: against the
     paratroop pioneers it stands in for the calibration against, the grenadier squad it meets
     on the beach, and the Canadian section itself */
  ['am_eng', 'ger_pio'],
  ['am_eng', 'hr_gren'],
  ['am_eng', 'us_eng'],
  /* and the pioneer team the 352nd fields in the paratroop pioneers' place, which carries the
     engineers' numbers to the point and is the calibration row on the beach, and against
     the squad it meets */
  ['am_eng', 'hr_pio'],
  ['hr_pio', 'am_rifle'],
  /* and the 251 the 352nd fields in the Ausf. D's place: against the squad it meets, the
     jeep, and the M4 that opens it */
  ['hr_251', 'am_rifle'],
  ['hr_251', 'am_jeep'],
  ['am_sher', 'hr_251'],
  /* and the M3A1 the Americans field in the one Italy has: against the squad it meets, the
     251 it faces across the beach, the KS 750, and the Panzer IV that opens it */
  ['am_m3', 'hr_gren'],
  ['am_m3', 'hr_251'],
  ['am_m3', 'hr_ks750'],
  ['hr_p4', 'am_m3'],
  /* and the Ranger squad the Americans field in the Foot Guards' place: against the grenadier
     squad it meets, the Foot Guards it stands in for, the Panzergrenadiere that are the elite
     it meets on the beach (and with the two .30s issued against them, because the grenadiers
     lose every fight either way and say nothing about the upgrade), the 251 and the KS 750
     its bazookas are for, and the Panzer IV they are a nuisance to */
  ['am_ranger', 'hr_gren'],
  ['am_ranger', 'us_fg'],
  ['am_ranger', 'ger_pgren'],
  ['am_ranger', 'ger_pgren', { a: ['a6'] }],
  ['am_ranger', 'hr_251'],
  ['am_ranger', 'hr_ks750'],
  ['hr_p4', 'am_ranger'],
  /* and the M8 the Americans field in the Stuart's place: against the KS 750, the 251 and the
     grenadier squad it hunts, the FJ assault group whose Panzerschreck opens it (and with the
     sand shields hung against it), the Rangers who are meant to beat it, and the Panzer IV */
  ['am_m8', 'hr_ks750'],
  ['am_m8', 'hr_251'],
  ['am_m8', 'hr_gren'],
  ['am_m8', 'ger_pgren'],
  ['am_m8', 'ger_pgren', { a: ['fenders'] }],
  ['am_ranger', 'am_m8'],
  ['hr_p4', 'am_m8'],
  /* and the 234 the 352nd fields in the Wirbelwind's place: the 234/1 against the M8 it trades
     with, the half-track it hunts and the Rangers who hunt it, and the Puma against the M8 it
     outguns and the M4 it can open only from the flank */
  ['hr_234', 'am_m8'],
  ['hr_234', 'am_m3'],
  ['am_ranger', 'hr_234'],
  ['hr_234', 'am_m8', { a: ['puma'] }],
  ['hr_234', 'am_sher', { a: ['puma'] }],
  /* the Knight's Cross Holders, whose grenades reach 150, so a row at the pair's own reach says
     nothing about them: read these beside the same rows at --d=130 */
  ['am_ranger', 'hr_kch'],
  ['am_rifle', 'hr_kch'],
  ['am_m8', 'hr_kch'],
  ['am_m3', 'hr_kch'],
  ['am_sher', 'hr_kch'],
  /* and the American .30 team in the Vickers team's place: against the MG42 across the beach,
     the grenadier squad and the Knight's Cross Holders it is there to keep down, the KS 750
     that can ride up on it; and with the .50 issued, against the same and against the 251
     and the KS 750 it is issued to open */
  ['am_mg', 'ger_mg42'],
  ['am_mg', 'hr_gren'],
  ['am_mg', 'hr_kch'],
  ['hr_ks750', 'am_mg'],
  ['am_mg', 'ger_mg42', { a: ['m2hb'] }],
  ['am_mg', 'hr_gren', { a: ['m2hb'] }],
  ['am_mg', 'hr_ks750', { a: ['m2hb'] }],
  ['am_mg', 'hr_251', { a: ['m2hb'] }],
  /* and the 352nd's MG 34 team in the MG42 team's place: against the .30 across the beach, the
     rifle squad and the engineers it is there to keep down and the jeep that can ride up on it;
     and with the MG 42 issued, against the .30, against the .50 and against the rifle squad */
  ['hr_mg', 'am_mg'],
  ['hr_mg', 'am_rifle'],
  ['hr_mg', 'am_eng'],
  ['am_jeep', 'hr_mg'],
  ['hr_mg', 'am_mg', { a: ['mg42t'] }],
  ['hr_mg', 'am_mg', { a: ['mg42t'], b: ['m2hb'] }],
  ['hr_mg', 'am_rifle', { a: ['mg42t'] }],
  ['us_m3', 'ger_h251'],
  ['us_rifle', 'ger_sd222'],
  ['us_ab', 'ger_p4'],
  ['ger_pgren', 'us_sher'],
  ['us_t8', 'ger_p4'],
  ['ger_tig', 'us_at'],
  ['us_sher', 'ger_stug'],
  ['us_at', 'ger_stug'],
  ['us_ab', 'ger_stug'],
  /* the eighty-eight, which the Pioneers dig in: AP against what it is for, and HE
     against men. It fights here in the open, without the ring of bags it is built in,
     so its crew are worse off than in a battle. */
  ['ger_flak88', 'us_sher'],
  ['ger_flak88', 'us_ach'],
  ['ger_flak88', 'us_rifle', { a: ['he'] }],
  ['ger_flak88', 'us_ab', { a: ['he'] }],
  /* the Maus against everything that might be asked to stop one */
  ['us_ach', 'ger_maus'],
  ['us_sher', 'ger_maus'],
  ['us_at', 'ger_maus'],
  /* and the field upgrades */
  ['ger_sd222', 'us_m8', { a: ['kwk'] }],
  ['ger_sd222', 'us_stuart', { a: ['kwk'] }],
  ['us_m3', 'ger_h251', { a: ['quad50'], b: ['drill'] }],
  ['us_m3', 'ger_gren', { a: ['quad50'] }],
  ['ger_h251', 'us_rifle', { a: ['drill'] }],
  ['us_m3', 'ger_p4', { a: ['how75'] }],
  ['ger_h251', 'us_stuart', { a: ['pak36'] }],
  ['us_m8', 'ger_gren', { a: ['thirty'] }],
  ['am_jeep', 'ger_sd222', { a: ['fifty'] }],
  ['ger_sd222', 'am_jeep', { a: ['kwk'] }],
  ['am_jeep', 'hr_gren', { a: ['fifty'] }],
  ['hr_ks750', 'am_rifle', { a: ['mg42'] }],
  ['hr_ks750', 'am_jeep', { a: ['mg42'], b: ['fifty'] }],
  ['ger_p4', 'us_ab', { a: ['skirts'] }],
  ['us_sher', 'ger_p4', { a: ['mg'], b: ['mg', 'skirts'] }],
  ['us_sher', 'ger_stug', { b: ['scope', 'mgs', 'skirts'] }]
];

const browser = await launch();
/* A stat change has to be fought, and so does a change that was not meant to touch the
   fighting at all: --base fights the card on an older file, which is the only way to
   tell a real shift from the noise a near-even matchup throws off. */
let file = args.file === undefined ? GAME : String(args.file), tmp = null;
if (args.base !== undefined) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortona-duel-'));
  file = path.join(tmp, 'ortona.html');
  fs.writeFileSync(file, execFileSync('git', ['show', `${String(args.base)}:ortona.html`],
                                      { encoding: 'utf8', maxBuffer: 1 << 28 }));
}
const { page } = await openGame(browser, 'desktop', { file });
await deploy(page, { side: 'us', diff: 1 });

/* one matchup off the command line takes its upgrades the way a card row does:
   --ua=fifty fits A, --ub=kwk fits B */
const cliUps = args.ua || args.ub ? { a: args.ua ? String(args.ua).split(',') : [], b: args.ub ? String(args.ub).split(',') : [] } : undefined;
const pairs = positional.length >= 2 ? [cliUps ? [positional[0], positional[1], cliUps] : [positional[0], positional[1]]] : CARD;
const NOAB = !!args.noab;
const rows = await page.evaluate(({ pairs, N, DIST, COVER, LIMIT, NOAB }) => {
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

  /* one tick of the real game, minus everything that is not the fight -- except the
     things a squad throws, which are orders, and in a battle the brain gives them: at the
     rate the regular brain thinks, through the same routine it calls (`abAuto`). --noab
     fights the card without them, which is the way to see what they are worth. */
  let abT = 0;
  function step(dt) {
    G.t += dt;
    computeVisibility(dt);
    if (!NOAB && typeof abAuto === 'function' && (abT -= dt) <= 0) {
      abT = 1.1;
      for (const u of G.units) if (u.def.ab && !u.dead) abAuto(u);
    }
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
    abT = 0;
    G.units.length = 0; G.shots.length = 0; G.fx.length = 0; G.corpses.length = 0;
    /* and the hulls of the last fight, which were left lying on the staging ground. They
       have always been on the movement grid; since a burning wreck also obscures they
       were attenuating the sight line as well, so from the second run of every row the
       pair were fighting through the smoke of the one before and a vehicle row could not
       see across the range it was staged at. */
    G.wrecks.length = 0; rebuildGrid();
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
    /* Let both sides find each other before the clock starts. Being seen takes a second
       or two now and an attack-move walks the whole of it, so unprimed a pair staged at
       381 were at 71 before either could see the other and every row on the card was a
       knife fight: the reach a weapon has was not being tested at all. The card stages a
       fight at a range and a fight at that range is what it should measure. What the
       closing costs is a real effect and it belongs to the sight and movement cards,
       where it is not confounded with the roster. Forty seconds of detection is plenty
       for anything that can be seen from where it was put down; a pair that still cannot
       see each other is flagged rather than fought in the dark. */
    let primed = false;
    for (let s = 0; s < 400; s++) {
      computeVisibility(0);
      if (a.vGer && b.vUs) { primed = true; break; }
    }
    let t = 0;
    const dt = 1 / 20;
    /* and where they were when the first round left a barrel, which is not the staged
       range for anything that has to close to use what it carries */
    let met = -1, nsh = G.shots.length;
    while (t < LIMIT) {
      step(dt); t += dt;
      if (met < 0 && G.shots.length > nsh) met = Math.hypot(a.x - b.x, a.y - b.y);
      nsh = G.shots.length;
      if (a.dead || b.dead) break;
    }
    const sa = strength('us'), sb = strength('ger');
    G.covers = savedCovers; G.coverIdx = savedIdx;
    return { win: b.dead && !a.dead ? 0 : a.dead && !b.dead ? 1 : sa > sb ? 0 : sb > sa ? 1 : -1,
             t: t, left: Math.max(sa, sb), met: met < 0 ? dist : met, blind: primed ? 0 : 1 };
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
    let winA = 0, winB = 0, draw = 0, sumT = 0, sumLeft = 0, sumMet = 0, blind = 0;
    for (let i = 0; i < N; i++) {
      const r = once(ka, kb, dist, i % 2, ups);
      if (r.win === 0) winA++; else if (r.win === 1) winB++; else draw++;
      sumT += r.t; sumLeft += r.left; sumMet += r.met; blind += r.blind;
    }
    const cost = k => (UNITS[k].cost.mp || 0) + (UNITS[k].cost.fu || 0) * 2.4;
    const tag = ups ? ((ups.a ? '+' + ups.a.join('+') : '') + (ups.b ? ' /+' + ups.b.join('+') : '')) : '';
    out.push({ a: ka, b: kb, up: tag, dist: dist, met: Math.round(sumMet / N), blind: blind,
               winA: winA, winB: winB, draw: draw,
               pct: Math.round(100 * winA / N), t: +(sumT / N).toFixed(1),
               left: +(sumLeft / N).toFixed(2),
               costA: Math.round(cost(ka)), costB: Math.round(cost(kb)),
               popA: A.pop, popB: B.pop });
  }
  return out;
}, { pairs, N, DIST, COVER, LIMIT, NOAB });

await browser.close();
if (tmp) fs.rmSync(tmp, { recursive: true, force: true });

if (args.json) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log(`\n  ${N} runs each, opening range ${DIST || 'per pair'}, cover tier ${COVER}\n`);
  console.log('  ' + pad('A', 11) + pad('B', 11) + lpad('A wins', 7) + lpad('secs', 7) +
              lpad('open', 6) + lpad('met', 6) + lpad('left', 6) + lpad('cost A', 8) + lpad('cost B', 8) +
              lpad('pop', 7) + '  upgrades');
  console.log('  ' + '-'.repeat(90));
  for (const r of rows) {
    if (r.err) { console.log('  ' + pad(r.a, 11) + pad(r.b, 11) + r.err); continue; }
    const flag = r.blind ? 'B' : r.pct >= 40 && r.pct <= 60 ? ' ' : r.pct >= 30 && r.pct <= 70 ? '.' : '!';
    console.log('  ' + pad(r.a, 11) + pad(r.b, 11) + lpad(r.pct + '%', 7) + lpad(r.t, 7) +
                lpad(r.dist, 6) + lpad(r.met, 6) + lpad(r.left, 6) + lpad(r.costA, 8) + lpad(r.costB, 8) +
                lpad(r.popA + '/' + r.popB, 7) + ' ' + flag + ' ' + r.up);
  }
  console.log('\n  cost is manpower plus fuel at 2.4, which is roughly what fuel is worth here.');
  console.log('  open is where they were put down, with both sides given time to find each other');
  console.log('  first; met is where they were when the first round left a barrel, which is nearer');
  console.log('  for anything that has to close to use what it carries.');
  console.log('  B is a pair that never saw each other from where they were staged.');
  console.log('  ! is a matchup outside 30-70 per cent and worth looking at.\n');
}
