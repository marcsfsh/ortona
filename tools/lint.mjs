#!/usr/bin/env node
/* Lint ortona.html against the rules that keep it shippable.
 *
 *   node tools/lint.mjs
 *
 * Three things it guards, none of which a screenshot would catch:
 *   1. the script still parses;
 *   2. the file is still self-contained (no network, no build step);
 *   3. the code is still the ES5 dialect the rest of the file is written in.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'ortona.html');
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

let problems = 0;
function fail(line, msg) {
  problems++;
  console.log(`${path.relative(ROOT, FILE)}:${line}  ${msg}`);
}

/* ---- 1. the script parses ---------------------------------------------- */

const open = src.indexOf('<script>');
const close = src.lastIndexOf('</script>');
if (open < 0 || close < 0) {
  fail(1, 'no <script> block found');
} else {
  const jsStart = src.slice(0, open).split('\n').length;   /* 1-based line of <script> */
  const js = src.slice(open + '<script>'.length, close);
  const tmp = path.join(process.env.TMPDIR || '/tmp', `ortona-lint-${process.pid}.js`);
  try {
    fs.writeFileSync(tmp, js);
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`parse: ok (${js.split('\n').length} lines of script)`);
  } catch (e) {
    const out = `${e.stderr || ''}`;
    const m = out.match(/:(\d+)\n/);
    fail(m ? jsStart + Number(m[1]) - 1 : jsStart, `script does not parse\n${out.split('\n').slice(0, 6).join('\n')}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/* ---- 2. still self-contained ------------------------------------------- */

/* Anything that would make the game need a network, a server or a build. */
const EXTERNAL = [
  [/<script[^>]+\bsrc\s*=/i,                 'external <script src>: the game must stay one file'],
  [/<link[^>]+\brel\s*=\s*["']?stylesheet/i, 'external stylesheet: the game must stay one file'],
  [/<img[^>]+\bsrc\s*=\s*["']?(?!data:)/i,   'external image: assets are procedural, not files'],
  [/@import\s+url/i,                         'CSS @import: the game must stay one file'],
  [/\bimport\s*\(/,                          'dynamic import(): the game must stay one file'],
  [/^\s*import\s+.*\bfrom\b/m,               'ES module import: the game must stay one file'],
  [/\brequire\s*\(/,                         'require(): the game must stay one file'],
  [/\bfetch\s*\(/,                           'fetch(): the game must run with the network off'],
  [/\bXMLHttpRequest\b/,                     'XMLHttpRequest: the game must run with the network off'],
  [/https?:\/\/(?!www\.w3\.org)/i,           'remote URL: the game must run with the network off']
];
lines.forEach((line, i) => {
  for (const [re, msg] of EXTERNAL) if (re.test(line)) fail(i + 1, `${msg}\n    ${line.trim().slice(0, 110)}`);
});

/* ---- 3. still the same dialect ----------------------------------------- */

/* Checked only inside the script block, and only on code: a comment or a string
 * mentioning "class" or "=>" is not a dialect violation. Block comments here run to
 * dozens of lines, so comment state has to carry between lines -- stripping only
 * same-line /* ... *\/ pairs flags ordinary English prose as code. */
let inBlock = false;
function stripNoise(line) {
  let out = '', i = 0;
  while (i < line.length) {
    if (inBlock) {
      const end = line.indexOf('*/', i);
      if (end < 0) { i = line.length; break; }
      inBlock = false; i = end + 2; out += ' ';
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '/*') { inBlock = true; i += 2; continue; }
    if (two === '//') break;
    out += line[i]; i++;
  }
  /* string literals next, so a quoted "class" or "=>" is data, not dialect */
  return out
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g, '//');
}

const DIALECT = [
  [/=>/,                        'arrow function: this file is ES5, use function()'],
  [/\blet\s+[A-Za-z_$]/,        'let: this file is ES5, use var'],
  [/\bconst\s+[A-Za-z_$]/,      'const: this file is ES5, use var'],
  [/\bclass\s+[A-Za-z_$]/,      'class: this file is ES5, use a constructor function or a plain object'],
  [/\basync\s+function\b|\bawait\s/, 'async/await: the game loop is synchronous'],
  [/`/,                         'template literal: this file is ES5, use string concatenation'],
  [/\.\.\./,                    'spread or rest: this file is ES5'],
  [/\?\./,                      'optional chaining: this file is ES5'],
  [/\?\?/,                      'nullish coalescing: this file is ES5']
];

if (open >= 0 && close >= 0) {
  const first = src.slice(0, open).split('\n').length;
  const last = src.slice(0, close).split('\n').length;
  for (let i = first; i < last; i++) {
    const code = stripNoise(lines[i]);
    for (const [re, msg] of DIALECT) if (re.test(code)) fail(i + 1, `${msg}\n    ${lines[i].trim().slice(0, 110)}`);
  }
}

/* ---- 4. whitespace hygiene --------------------------------------------- */

lines.forEach((line, i) => {
  if (line.includes('\t')) fail(i + 1, 'tab character: this file uses two-space indent');
  if (/[ \t]+$/.test(line)) fail(i + 1, 'trailing whitespace');
});
if (src.includes('\r\n')) fail(1, 'CRLF line endings');

/* ---- 5. size, because it all ships on a phone -------------------------- */
/* The ceiling is a budget rather than a technical limit: the file is text over the wire
   and gzips to roughly a fifth of this, so the number that matters on a phone is parse
   time and not transfer. It was 900 while the roster was the only thing growing; it is
   1040 once the map was hand-placed entity by entity, which is the one part of the
   game where more bytes on disk are more thought rather than more code. It was 1180 once
   vehicles carried an interior somebody sat down and laid out: a room is a few hundred
   boxes and there is a tank's worth of them still to draw. It is 1260 for the detail
   pass, which is the one kind of work where the bytes are the product: occlusion baked
   into every model, faces cut fine enough to carry it, and the surface detail that goes
   on top. It is 1290 for the infantry: one jointed rig with two-bone arms and legs in
   place of a stack of boxes a posture, a pose table every one of them is built from, and
   the fall and the dead laid out by hand -- and the three weapon branches that pass
   bought back is already spent. It is 1320 for the artillery: a game about Ortona that
   had none now has mortars and pack howitzers on both sides, with the guns, the fire
   mission and the brain that lays one. It was 1345 for the heavy batteries, which are
   emplacements rather than units: two more guns, two platforms, the position they are
   dug into and the rules that keep them out of the enemy's base and out of their own
   rear. It was 1460 for the after-action record and the stats page it is read on, which
   is a battle's whole history kept per unit, per type and per army, five tabs of tables
   and a set of graphs drawn on a canvas. It is 1520 for a second map: the Gothic Line is
   a landform, a bunker, two kinds of anti-tank obstacle and some six hundred entities
   laid by hand, and a game that ships one map and cannot ship two is a game with a map
   editor nobody has a reason to open. It is 1560 for destruction: a house is four walls
   in seven-unit courses round a list of openings, a shell adds an opening to that list
   and the wall is rebuilt round it, the masonry that came out is a rigid body under
   gravity until it lands on the heap it is building, and the grids, the cover and the
   garrison all follow the storey down. It is 1595 for the effects: every particle in the
   game was one draw call of one soft disc, so a rifle flash and a 210mm burst were the
   same picture at two sizes; they go out as one packed buffer and one draw a blend pass
   now, with five shapes, a muzzle blast read off the weapon, tracers that live in the
   world instead of on the canvas stacked over it, and a burst staged into a flash, a
   fireball, thrown dirt, a shock ring and a column. It is 1625 for bodies and wrecks:
   every collision in the game was one circle at half a vehicle's length on two markers,
   so a tank held a section off with a metre of daylight on one bearing and stood in the
   middle of it on another; a hull and a formation are both boxes now, measured off the
   models rather than typed beside them, a hull is tested against the MEN, tracks pivot
   where wheels have to drive the turn, and a dead vehicle settles, cants, sheds its
   plate and sometimes throws its turret clear instead of being redrawn in a darker
   colour. It is 1655 for the bunker fittings: a bunker was a box of concrete a section
   could stand in and nothing else, on a map whose whole question is which of three
   crossings to force, so each one is now fitted out once with one of five things -- a
   belt or a gun laid through its own slot, a tube dug in behind it, a workshop, or an
   aid post -- each of which is its own geometry, its own per-bunker buffer and its own
   effect on the ground round it. It is 1690 for the simple scheme: a second set of
   controls for a phone, kept beside the classic one as a choice, under which the player
   builds from a strip and the game's own brain runs his army, steered by the flags. It
   is 1720 for the brain's second layer of inputs: contacts that carry a heading and the
   body the enemy is massing read off them, fire superiority at the wave's go and the
   break-off when it fails, the exchange and the clock in the mood, and the tubes heard
   rather than seen. It is 1745 for the arms: a crew-served weapon that has to be packed
   before it moves and set up before it fires, a doctrine that anchors every team and
   every tank on the sections and sites the anti-tank guns to defend, the emplacements on
   the SIMPLE strip, and field upgrades fitted for the player by a setting each vehicle
   can overrule. It is 1800 for command: three directives on nine flags become a board of
   orders that take any ground, anything standing on it and a force the player picks
   himself, each with a temper saying what it is worth losing men over, beside a posture
   and a reaction he can set for the army or for one unit -- and the order pad, the
   battle groups and the live order list that let him say all of it with a thumb.
   It is 1815 for three more German pieces: a 2 cm Flak 38 on its ground platform, a
   15 cm Nebelwerfer that fires a ripple of six and then reloads by hand for the best
   part of a minute, and a Wirbelwind, which is a Panzer IV with an open nine-sided
   turret and four automatic cannon in it. Most of the step is the three models; the
   rules they needed were an automatic-cannon and a rocket signature for the eye and the
   ear, a reload clock, and the blast a vehicle takes read off what is over it.
   It is 1860 for a third map and the first of a second theatre: Omaha, which is a
   country of its own -- a tidal flat, a shingle bank, a seawall, a bluff with three draws
   cut through it and the farmland behind -- laid out as a corridor with the sea along its
   bottom edge, plus what that took: a world whose size and whose sea are the map's to
   choose, the sand it is painted in, and the ground carried on past the edge of the map.
   It is 1880 for Omaha laid again by hand: a weather of its own (the overcast table the
   light, the sky and the sea read), a sea that is a depth over a shelving bed with surf
   breaking on it, and the craft that brought the first wave in -- the LCVP and the LCT
   Mk V, which is also what the American headquarters stands as on that beach.
   It is 1925 for the country behind that beach: a hundred and twenty-seven hedgerows laid
   field by field with the lanes between them, and the Norman stone and slate the villages
   there are built in, the church spires and the manor the German headquarters stands as.
   It is 1945 for what the beach is for: a post made out of a landing craft (the tents,
   the gantry and the stores laid in and round the hull), the garrison the wall can be
   manned with at the whistle, and the Normandy pieces in the editor.
   It is 1970 for the first of the American army: a third kit on the one rig (the M1941
   jacket, the leggings, the cartridge belt and the haversack), the M1 helmet swept round a
   plan ellipse under a net of its own, the Garand, and the table that says which army the
   Allied side is on which map.
   It is 2000 for the German army on that beach: a fourth kit on the rig (the field-grey
   tunic, the Y-straps, the gas mask canister, the bread bag, the marching boot and the
   gaiter), the M42 helmet with its chicken wire and foliage on a tile of its own, the
   Kar98k cut as a side profile the way the Garand is, and the German half of the army
   table.
   It is 2030 for the jeep: the Willys MB pressed out of sheet a panel at a time (the bonnet
   and wings, the nine-slot grille, the tub with its scoops and arches, the combat wheels
   with their bar tread, the folded screen, the spare and the jerrican), the .30 and the
   .50 on the M31 pedestal, and the three men who ride in it.
   It is 2090 for the M4: the American Sherman built from nothing (the vertical-volute
   bogies with their springs and trailing rollers, the dual pressed road wheels, the T48
   chevron track, the three-piece nose, the hoods and hatches, the rear plate with its air
   cleaners, the D50878 turret lofted from a plan, the M34A1 shield and the split hatch),
   its authored interior, the .50 and the tanker who stands to it, and the tanker's kit
   on the rig: his fibre helmet, his winter combat jacket and his shoulder holster.
   It is 2130 for the KS 750: the Zündapp and its sidecar (the oval-tube frame, the girder
   fork, the flat twin with its finned heads, the tank with the air cleaner on it, the
   spoked wheels on their block tread, the saddles, the panniers, and the BW 40 lofted as
   sections with its well, its coaming and the spare on its tail), the MG 34 and the MG 42
   on the sidecar mount, and the motorcyclist's kit on the rig: the rubberised coat, the
   gauntlets and the goggles.
   It is 2190 for the Panzer IV the 352nd fields: the tank built from nothing (the
   leaf-sprung bogies with their spring stacks, the twin road wheels, the drilled sprocket
   and the welded idler, the Kgs 61 track, the stepped nose with its spare track, the visor
   and the ball mount, the hexagonal turret with its side doors, its bin and its drum
   cupola, the mantlet and the L/48 with its muzzle brake, the Schürzen and their rails,
   the Balkenkreuze and the red 415), its cupola and turret interior, the MG 34 on the
   Fliegerbeschussgerät and the man who stands to it, and the panzer crewman on the rig:
   the black wrap, the M43 cap and the headset.
   It is 2230 for the American engineer squad: the man on the rig in his herringbone twill
   (the sleeves rolled above the elbow, the work gloves, the cargo pockets and the boots the
   trousers are bloused over), the assault vest, the pack with its blanket roll and the three
   loads it carries, the goggles on the M1, the M3 submachine gun, and his own prone and
   dead layouts so he falls as an engineer.
   It is 2290 for the 352nd's half-track: the Sd.Kfz. 251 Ausf. C built from nothing (the
   interleaved running gear on its torsion arms with the holed discs, the spoked sprocket
   and the idler, the steered front axle on its leaf spring and its two tyres, the faceted
   body in seven rings with the crease welded down both sides, the bonnet, the driver's
   plate and its visors, the lockers, the mudguards and their lamps, the rear doors bent
   over the crease), the open compartment with its seats, wheel, instruments and benches,
   the MG 34 on its pintle, and the driver and the gunner.
   Raise it deliberately, with a reason, or not at all. */
const kb = Buffer.byteLength(src) / 1024;
console.log(`size: ${kb.toFixed(0)} kB, ${lines.length} lines`);
if (kb > 2290) fail(1, `file is ${kb.toFixed(0)} kB; keep it under 2290 kB so it stays quick to load on a phone`);

console.log(problems ? `\n${problems} problem(s)` : '\nclean');
process.exit(problems ? 1 : 0);
