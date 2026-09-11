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
 * mentioning "class" or "=>" is not a dialect violation. */
function stripNoise(line) {
  return line
    .replace(/\/\*.*?\*\//g, ' ')
    .replace(/\/\/.*$/, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
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

const kb = Buffer.byteLength(src) / 1024;
console.log(`size: ${kb.toFixed(0)} kB, ${lines.length} lines`);
if (kb > 900) fail(1, `file is ${kb.toFixed(0)} kB; keep it under 900 kB so it stays quick to load on a phone`);

console.log(problems ? `\n${problems} problem(s)` : '\nclean');
process.exit(problems ? 1 : 0);
