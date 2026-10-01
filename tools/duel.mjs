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
 *   node tools/duel.mjs am_rifle hr_gren     one matchup
 *   node tools/duel.mjs --d=200              at a chosen opening range
 *   node tools/duel.mjs --cover=3            with both sides in heavy cover
 *   node tools/duel.mjs --json               machine-readable
 *   node tools/duel.mjs --sited am_at hr_p4  A set up and holding, as a gun meets armour
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
/* --turn=<radians> stages B side-on: its hull that far off the line to A, halted, with its
   turret laid along the hull, so what it has to do to answer is traverse and bring the
   front round, and what A shoots at meanwhile is the plate off the front. It is the one
   question about a vehicle whose front and sides differ that a head-on card cannot ask. */
const TURN = args.turn === undefined ? 0 : Number(args.turn);
/* --sited stages A set up and holding its ground, the way an anti-tank gun meets armour: laid
   on the ground in front of it before anything comes up it. Staged on an attack-move a gun
   halts when a target comes into reach and then spends its setup in the open while the tank
   drives in, so the card measured the setup and never the reach: the 57 on an attack-move
   against a Panzer IV staged at 520 fired its first round at 207. */
const SITED = !!args.sited;
const positional = args._ || [];

/* The card. Each row is a question the roster has to answer. A third entry fits field
   upgrades before the fight, because half of what a vehicle can do is an upgrade and a
   roster is not balanced until those are too. */
const CARD = [
  ['am_rifle', 'hr_gren'],
  /* The mortars. A tube against a squad is the row the roster is judged on -- what a
     mortar is for is men in the open and men behind something -- and tube against tube is
     the calibration row for the pair, the way am_eng against hr_pio is for the squads.
     Note what a duel cannot show about one: it stages both sides in sight of each other,
     so a mortar here is firing at what it can see itself, which is the half of its job it
     is worst at. What it does to ground nobody can see into is not a duel question. */
  ['us_mor', 'hr_gren'],
  ['ger_mor', 'am_rifle'],
  ['us_mor', 'ger_mor'],
  ['am_e8', 'hr_p4'],
  ['am_e8', 'ger_tig'],
  ['am_sher', 'ger_tig'],
  /* the jeep, the Americans' light vehicle: against the KS 750 it meets and the grenadier
     squad, and fitted with the .50 against the same two further down */
  ['am_jeep', 'hr_ks750'],
  ['am_jeep', 'hr_gren'],
  /* and the KS 750, the 352nd's light vehicle: against the squad it meets and the jeep */
  ['hr_ks750', 'am_rifle'],
  ['hr_ks750', 'am_jeep'],
  /* and the 352nd's Panzer IV: against the M4 it meets on the beach and the squad */
  ['am_sher', 'hr_p4'],
  ['hr_p4', 'am_rifle'],
  /* and the engineer squad, the Americans' builder: against the grenadier squad it meets on
     the beach */
  ['am_eng', 'hr_gren'],
  /* and the pioneer team, the 352nd's builder, which carries the engineers' numbers to the
     point: the two are one unit on two sides, so this is the calibration row, and anything
     but about fifty per cent on it says the tool has developed a bias and not the roster;
     and against the squad it meets */
  ['am_eng', 'hr_pio'],
  ['hr_pio', 'am_rifle'],
  /* and the 352nd's 251: against the squad it meets, the jeep, and the M4 that opens it */
  ['hr_251', 'am_rifle'],
  ['hr_251', 'am_jeep'],
  ['am_sher', 'hr_251'],
  /* and the Americans' M3: against the squad it meets, the 251 it faces across the beach,
     the KS 750, and the Panzer IV that opens it */
  ['am_m3', 'hr_gren'],
  ['am_m3', 'hr_251'],
  ['am_m3', 'hr_ks750'],
  ['hr_p4', 'am_m3'],
  /* and the Ranger squad, the Americans' assault squad: against the grenadier squad it meets,
     the Knight's Cross Holders with the two .30s issued against them (the row without them is
     with the Knight's Cross Holders' own below, and the grenadiers lose every fight either way
     and say nothing about the upgrade), the 251 and the KS 750 its bazookas are for, and the
     Panzer IV they are a nuisance to */
  ['am_ranger', 'hr_gren'],
  ['am_ranger', 'hr_kch', { a: ['a6'] }],
  ['am_ranger', 'hr_251'],
  ['am_ranger', 'hr_ks750'],
  ['hr_p4', 'am_ranger'],
  /* and the Americans' M8: against the KS 750, the 251 and the grenadier squad it hunts, the
     Rangers who are meant to beat it, and the Panzer IV */
  ['am_m8', 'hr_ks750'],
  ['am_m8', 'hr_251'],
  ['am_m8', 'hr_gren'],
  ['am_ranger', 'am_m8'],
  ['hr_p4', 'am_m8'],
  /* and the 352nd's 234: the 234/1 against the M8 it trades with, the half-track it hunts and
     the Rangers who hunt it, and the Puma against the M8 it outguns and the M4 it can open only
     from the flank */
  ['hr_234', 'am_m8'],
  ['hr_234', 'am_m3'],
  ['am_ranger', 'hr_234'],
  ['hr_puma', 'am_m8'],
  ['hr_puma', 'am_sher'],
  /* and the Wirbelwind the 352nd fields beside it: against the infantry and the light vehicles
     it is for, the Rangers who can open it (read beside --d=130, where the bazookas reach), and
     the M4 and the anti-tank gun that open it more easily than they open the Panzer IV */
  ['hr_wirb', 'am_rifle'],
  ['hr_wirb', 'am_ranger'],
  ['hr_wirb', 'am_m8'],
  ['hr_wirb', 'am_m3'],
  ['am_sher', 'hr_wirb'],
  ['am_at', 'hr_wirb'],
  /* and the Panther: the M4 that cannot open its front (the anti-tank gun's row is with the
     57's below), the Easy Eight that can from the flank, and what it does to infantry and to a light vehicle;
     read the first rows again beside --turn=1.57, which stages it side-on, because its sides
     are the whole answer */
  ['am_sher', 'hr_panther'],
  ['am_e8', 'hr_panther'],
  ['hr_panther', 'am_rifle'],
  ['hr_panther', 'am_m8'],
  /* the Knight's Cross Holders, whose grenades reach 150, so a row at the pair's own reach says
     nothing about them: read these beside the same rows at --d=130 */
  ['am_ranger', 'hr_kch'],
  ['am_rifle', 'hr_kch'],
  ['am_m8', 'hr_kch'],
  ['am_m3', 'hr_kch'],
  ['am_sher', 'hr_kch'],
  /* and the American .30 team: against the MG 34 team across the beach, which is the machine
     guns' calibration row, the two being one unit on two sides, and is fought from the other side
     of the card in the MG 34's rows below; against the grenadier squad and the Knight's Cross
     Holders it is there to keep down, and the KS 750 that can ride up on it; and with the .50
     issued, against the same and against the 251 and the KS 750 it is issued to open */
  ['am_mg', 'hr_mg'],
  ['am_mg', 'hr_gren'],
  ['am_mg', 'hr_kch'],
  ['hr_ks750', 'am_mg'],
  ['am_mg', 'hr_mg', { a: ['m2hb'] }],
  ['am_mg', 'hr_gren', { a: ['m2hb'] }],
  ['am_mg', 'hr_ks750', { a: ['m2hb'] }],
  ['am_mg', 'hr_251', { a: ['m2hb'] }],
  /* and the 352nd's MG 34 team: against the .30 across the beach, the rifle squad and the
     engineers it is there to keep down and the jeep that can ride up on it; and with the MG 42
     issued, against the .30, against the .50 and against the rifle squad */
  ['hr_mg', 'am_mg'],
  ['hr_mg', 'am_rifle'],
  ['hr_mg', 'am_eng'],
  ['am_jeep', 'hr_mg'],
  ['hr_mg', 'am_mg', { a: ['mg42t'] }],
  ['hr_mg', 'am_mg', { a: ['mg42t'], b: ['m2hb'] }],
  ['hr_mg', 'am_rifle', { a: ['mg42t'] }],
  /* and the American 57: against the Panzer IV and the Panther it is there to meet, the Puma and
     the half-track, and the grenadier squad that kills it. A gun meets armour set up, so read
     these beside --sited --d=520, where its reach and its eye are what is being asked; staged the
     default way it walks into the tank and pays its setup */
  ['am_at', 'hr_p4'],
  ['am_at', 'hr_panther'],
  ['am_at', 'hr_puma'],
  ['am_at', 'hr_251'],
  ['am_at', 'hr_gren'],
  /* and the 352nd's Pak 38, asked the same the other way round: the M4 it is there to meet, the
     Panzer IV as the 57's own row with the gun changed, the M8 and the half-track, and the rifle
     squad that kills it. Read these sited as well, for the 57's reason; and read the M4 row beside
     the Panzer IV one, because the M4 carries its coaxial as standard and the Panzer IV does not,
     and a coaxial on a tank that has found a gun is most of what kills the crew */
  ['hr_pak', 'am_sher'],
  ['hr_pak', 'hr_p4'],
  ['hr_pak', 'am_m8'],
  ['hr_pak', 'am_m3'],
  ['am_rifle', 'hr_pak'],
  /* and the M3 light tank the 29th fields over and above the Greyhound: the same 37 mm on half as
     much plate again, so the rows ask what that plate buys against the 352nd's light things and what
     it does not buy against a Panzer IV, the Wirbelwind, the throws and a Pak 38 laid for it */
  ['am_stuart', 'hr_ks750'],
  ['am_stuart', 'hr_251'],
  ['am_stuart', 'hr_234'],
  ['am_stuart', 'hr_puma'],
  ['am_stuart', 'hr_gren'],
  ['am_stuart', 'hr_mg'],
  ['hr_wirb', 'am_stuart'],
  ['hr_p4', 'am_stuart'],
  ['hr_kch', 'am_stuart'],
  ['am_ranger', 'am_stuart'],
  ['hr_pak', 'am_stuart'],
  /* the M26, which the 29th fields over and above the M4A1: the Panther is the row it is for,
     and the Panzer IV, the Puma and the Knight's Cross Holders are what it meets on the way */
  ['am_m26', 'hr_panther'],
  ['am_m26', 'hr_p4'],
  ['am_m26', 'hr_puma'],
  ['am_m26', 'hr_kch'],
  ['am_ranger', 'am_m26'],
  ['am_ranger', 'hr_p4'],
  ['hr_kch', 'am_sher'],
  ['us_t8', 'hr_p4'],
  ['ger_tig', 'am_at'],
  ['am_sher', 'ger_stug'],
  ['am_at', 'ger_stug'],
  ['am_ranger', 'ger_stug'],
  /* the eighty-eight, which the pioneers dig in: AP against what it is for, and HE
     against men. It fights here in the open, without the ring of bags it is built in,
     so its crew are worse off than in a battle. */
  ['ger_flak88', 'am_sher'],
  ['ger_flak88', 'am_e8'],
  ['ger_flak88', 'am_rifle', { a: ['he'] }],
  ['ger_flak88', 'am_ranger', { a: ['he'] }],
  /* the Maus against everything that might be asked to stop one */
  ['am_e8', 'ger_maus'],
  ['am_sher', 'ger_maus'],
  ['am_at', 'ger_maus'],
  /* and the field upgrades */
  ['am_gmc', 'hr_p4'],
  ['am_jeep', 'hr_ks750', { a: ['fifty'] }],
  ['am_jeep', 'hr_gren', { a: ['fifty'] }],
  ['hr_ks750', 'am_rifle', { a: ['mg42'] }],
  ['hr_ks750', 'am_jeep', { a: ['mg42'], b: ['fifty'] }],
  ['hr_p4', 'am_ranger', { a: ['skirts'] }],
  ['am_sher', 'hr_p4', { a: ['mg'], b: ['mg', 'skirts'] }],
  ['am_sher', 'ger_stug', { b: ['scope', 'mgs', 'skirts'] }]
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
   --ua=fifty fits A, --ub=mg42 fits B */
const cliUps = args.ua || args.ub ? { a: args.ua ? String(args.ua).split(',') : [], b: args.ub ? String(args.ub).split(',') : [] } : undefined;
const pairs = positional.length >= 2 ? [cliUps ? [positional[0], positional[1], cliUps] : [positional[0], positional[1]]] : CARD;
const NOAB = !!args.noab;
const rows = await page.evaluate(({ pairs, N, DIST, COVER, LIMIT, NOAB, TURN, SITED }) => {
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
    if (TURN) { b.facing = Math.PI + TURN; b.turret = 0; b.order = null; b.dest = null; b.path = null; }
    if (SITED) { a.order = null; a.dest = null; a.path = null; a.setup = 0; a.packed = false; a.pack = 0; }
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
}, { pairs, N, DIST, COVER, LIMIT, NOAB, TURN, SITED });

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
