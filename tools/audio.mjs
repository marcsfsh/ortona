/* Sound, mechanically.
 *
 * Every noise the game makes is synthesised at runtime -- there are no audio files, for
 * the same reason there are no image files -- so a change to the sound cannot be checked
 * by reading the diff any more than a change to a model can. This renders the game's own
 * sfx() through an OfflineAudioContext, writes what comes out as WAV, and prints the
 * numbers that say what a sound actually is: how hard it starts, how long it lasts, where
 * its energy sits and how much of it is body rather than hiss.
 *
 *   node tools/audio.mjs                 every sound, the roster, a montage, a firefight
 *   node tools/audio.mjs rifle mg        two of them
 *   node tools/audio.mjs us_how8         one piece off the roster, in its own voice
 *   node tools/audio.mjs --tag=before    keep a set to compare against
 *
 * Nothing is reimplemented. The page's own auAttach() builds the graph on the offline
 * context and the page's own sfx() fills it, so what is written here is what a player
 * hears, sample for sample. A named unit key goes the same way: the page's own gunVoice()
 * reads the voice off that unit's real weapon and the page's own sfx() plays it, so the
 * roster table below is thirty-odd guns firing rather than a list somebody typed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { launch, openGame, parseArgs, ROOT } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const TAG = args.tag === undefined ? '' : '-' + String(args.tag);
const SR = 44100;
const KINDS = ['rifle', 'mg', 'gun', 'at', 'mortar', 'how', 'heavy', 'rocket',
               'incoming', 'boom', 'cap', 'spawn', 'click'];
const want = args._ && args._.length ? args._ : KINDS;
const OUT = path.join(ROOT, 'shots', 'audio');
const VARIANTS = 4;

/* ---- wav ---------------------------------------------------------------------- */

function wav(chans, sr) {
  const n = chans[0].length, ch = chans.length, bytes = n * ch * 2;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(ch, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    b.writeInt16LE(Math.round(v * 32767), o); o += 2;
  }
  return b;
}

/* ---- what a sound is ------------------------------------------------------------ */

/* A real spectrum, because the cheap way is wrong here. Reading the magnitude at a
   handful of single frequencies compares a sine, whose energy sits in one bin, against
   noise, whose energy is spread over thousands of them, and the sine wins every time:
   measured that way a rifle with any thump at all reads as ninety-nine per cent bass and
   the crack reads as nothing. Band power out of a windowed transform is the honest
   answer. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
/* power per bin over the whole of x, in overlapping Hann windows */
function spectrum(x, sr, N) {
  const n = N || 1024, half = n >> 1, acc = new Float64Array(half);
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / n);
  let frames = 0;
  for (let off = 0; off + n <= x.length; off += half) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = x[off + i] * win[i];
    fft(re, im);
    for (let k = 0; k < half; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  return { acc, frames: frames || 1, df: sr / n, half };
}
function bands(sp) {
  let lo = 0, mid = 0, hi = 0, num = 0, den = 0;
  for (let k = 1; k < sp.half; k++) {
    const f = k * sp.df, p = sp.acc[k];
    num += f * p; den += p;
    if (f < 250) lo += p; else if (f < 2200) mid += p; else hi += p;
  }
  const tot = lo + mid + hi || 1;
  return { lo: lo / tot * 100, mid: mid / tot * 100, hi: hi / tot * 100, centroid: den ? num / den : 0 };
}

function measure(x, sr) {
  let peak = 0, sum = 0, at = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) { peak = a; at = i; }
    sum += x[i] * x[i];
  }
  const rms = Math.sqrt(sum / x.length);
  /* the graph has a compressor in it and a compressor has a look-ahead, so every sound
     starts a few milliseconds late. Measure from where it actually starts. */
  let head = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak * .02) { head = i; break; }
  let end = head;
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > peak * .001) { end = i; break; }
  const b = bands(spectrum(x.subarray(head), sr));
  /* the first fifty milliseconds decide whether a report cracks or thuds: a whole-buffer
     spectrum is dominated by whatever rings longest, which is always the bottom end */
  const onHead = x.subarray(head, Math.min(x.length, head + Math.round(sr * .05)));
  const on = bands(spectrum(onHead, sr, 512));
  let p6 = 0;
  for (let i = head; i < Math.min(x.length, head + Math.round(sr * .006)); i++) p6 = Math.max(p6, Math.abs(x[i]));
  return {
    peak, rms, crest: peak / (rms || 1e-9),
    attack: (at - head) / sr * 1000, dur: (end - head) / sr * 1000,
    centroid: b.centroid, lo: b.lo, mid: b.mid, hi: b.hi,
    on: { lo: on.lo, mid: on.mid, hi: on.hi, centroid: on.centroid, p6: p6 }
  };
}

/* ---- render ---------------------------------------------------------------------- */

const browser = await launch();
const { page } = await openGame(browser, 'desktop', { quiet: true });

/* Which units on the roster fire a shell, in the order the roster lists them. The page
   answers this rather than a list here: a weapon added to one army and not to a list in
   this file is exactly the drift `gunVoice` exists to stop. */
const ROSTER = await page.evaluate(() => Object.keys(UNITS).filter(k => {
  const d = UNITS[k];
  return (d.w && d.w.shell) && d.cat !== 'inf';
}));

async function render(kind, secs, unit, burst) {
  const b64 = await page.evaluate(async ([kind, secs, sr, unit, burst]) => {
    const oc = new OfflineAudioContext(2, Math.round(sr * secs), sr);
    const keep = { ctx: AU.ctx, noise: AU.noise, on: AU.on, budget: AU.budget, last: AU.last };
    /* the page builds its own graph on the offline context, so this cannot drift from
       what ships: if auAttach changes, this changes with it */
    if (typeof auAttach === 'function') auAttach(oc);
    else {
      AU.ctx = oc;
      const len = Math.round(oc.sampleRate * 1.2), buf = oc.createBuffer(1, len, oc.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      AU.noise = buf;
    }
    AU.on = true; AU.budget = 99; AU.last = {};
    if (unit) {
      /* the page's own voice, off the page's own def: a stand-in unit is enough because
         gunVoice and muzClass read the category, the side and the weapon and nothing else */
      const d = UNITS[unit], gv = gunVoice({ cat: d.cat, def: d, side: d.side }, d.w);
      sfx(gv.cls, undefined, undefined, gv);
    } else if (kind === 'incoming' || kind === 'boom') sfx(kind, undefined, undefined, burstVoice(burst || 44));
    else sfx(kind);
    const out = await oc.startRendering();
    for (const k in keep) AU[k] = keep[k];
    const L = out.getChannelData(0), R = out.numberOfChannels > 1 ? out.getChannelData(1) : L;
    const pcm = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) {
      pcm[i * 2] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
      pcm[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
    }
    let s = '';
    const u8 = new Uint8Array(pcm.buffer);
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(s);
  }, [kind, secs, SR, unit || null, burst || 0]);
  const raw = Buffer.from(b64, 'base64');
  const n = raw.length / 4;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = raw.readInt16LE(i * 4) / 32767;
    R[i] = raw.readInt16LE(i * 4 + 2) / 32767;
  }
  return [L, R];
}

fs.mkdirSync(OUT, { recursive: true });
function mono1(take) {
  const [L, R] = take, m = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) m[i] = (L[i] + R[i]) * .5;
  return m;
}
const takes = {};
const rows = [];
let fight = '';
/* a named unit key is a piece off the roster rather than a class, and it is rendered
   through the game's own gunVoice: this is the whole point of the roster table */
const wantKinds = want.filter(k => !ROSTER.includes(k));
const wantUnits = want.filter(k => ROSTER.includes(k));
for (const kind of wantKinds) {
  const secs = kind === 'boom' || kind === 'heavy' || kind === 'gun' ? 2.6 : 1.6;
  takes[kind] = [];
  for (let v = 0; v < VARIANTS; v++) takes[kind].push(await render(kind, secs));
  rows.push([kind, measure(mono1(takes[kind][0]), SR)]);
  fs.writeFileSync(path.join(OUT, kind + TAG + '.wav'), wav(takes[kind][0], SR));
}

/* ---- the roster: every gun that fires a shell, in its own voice ------------------
   A class table says a mortar is not a tank gun. It cannot say whether the two mortars
   are two mortars, and that is the question: what is claimed is that a report is read
   off the weapon, so six artillery pieces with six different shells behind them are six
   different sounds without anybody typing one. Each row is the game's own gunVoice
   against that unit's own def, played through the game's own sfx. */
const ART_KEYS = ['us_mor', 'ger_mor', 'us_how', 'ger_how', 'us_how8', 'ger_how210'];
/* Every layer of every report is jittered on purpose, so one take of a gun says almost
   nothing: measured once, the Pak 40's centroid came back at 776 Hz and then at 1050 on
   the same file. A row here is the mean of several, which is the difference between a
   table that can support the word 'different' and a table that cannot. */
const ROSTER_TAKES = 10;
function meanOf(ms) {
  const o = { on: {} };
  ['peak', 'rms', 'crest', 'attack', 'dur', 'centroid', 'lo', 'mid', 'hi'].forEach(k => {
    o[k] = ms.reduce((a, m) => a + m[k], 0) / ms.length;
  });
  ['lo', 'mid', 'hi', 'centroid', 'p6'].forEach(k => {
    o.on[k] = ms.reduce((a, m) => a + m.on[k], 0) / ms.length;
  });
  return o;
}
const pieces = [];
/* named pieces if any were named, the whole roster on a bare run, and nothing at all when
   the run was for a class or two -- `node tools/audio.mjs rifle mg` should be quick */
const rosterWant = wantUnits.length ? wantUnits : want === KINDS ? ROSTER : [];
for (const key of rosterWant) {
  const v = await page.evaluate(k => {
    const d = UNITS[k], gv = gunVoice({ cat: d.cat, def: d, side: d.side }, d.w);
    return { name: d.short || k, side: d.side, cls: gv.cls, pit: gv.pit, wt: gv.wt,
             crk: gv.crk, aoe: d.w.aoe || 0, pen: d.w.pen || 0 };
  }, key);
  const secs = v.cls === 'heavy' || v.cls === 'gun' ? 2.6 : 1.8, ms = [];
  let first = null;
  for (let i = 0; i < ROSTER_TAKES; i++) {
    const take = await render(null, secs, key);
    if (!first) first = take;
    ms.push(measure(mono1(take), SR));
  }
  pieces.push([key, v, meanOf(ms)]);
  fs.writeFileSync(path.join(OUT, 'gun-' + key + TAG + '.wav'), wav(first, SR));
}

/* Each pair's own calibration. A ratio with no floor under it says nothing, and the
   floor is not the same for every class: a tank gun's crack carries most of its variance
   in the top end and a mortar's carries almost none, so the Panzer IV against the StuG,
   which is one gun on two hulls, is the wrong control for a mortar. Each of the three
   pairs is measured against ITS OWN first piece rendered a second time, which is the
   duel card's identical row and nothing more. */
const selfCtrl = {};
for (const key of ['us_mor', 'us_how', 'us_how8']) {
  const row = pieces.filter(p => p[0] === key)[0];
  if (!row) continue;
  const secs = row[1].cls === 'heavy' ? 2.6 : 1.8, ms = [];
  for (let i = 0; i < ROSTER_TAKES; i++) ms.push(measure(mono1(await render(null, secs, key)), SR));
  selfCtrl[key] = meanOf(ms);
}

/* ---- and what it put on the ground ---------------------------------------------- */
const landings = [];
for (const [key, v] of pieces.map(p => [p[0], p[1]])) {
  if (!ART_KEYS.includes(key)) continue;
  const secs = v.aoe > 90 ? 3.4 : 2.6, ms = [];
  let first = null;
  for (let i = 0; i < ROSTER_TAKES; i++) {
    const take = await render('boom', secs, null, v.aoe);
    if (!first) first = take;
    ms.push(measure(mono1(take), SR));
  }
  landings.push([v.name, v.aoe, meanOf(ms)]);
  fs.writeFileSync(path.join(OUT, 'land-' + key + TAG + '.wav'), wav(first, SR));
  const inc = await render('incoming', 2.2, null, v.aoe);
  fs.writeFileSync(path.join(OUT, 'incoming-' + key + TAG + '.wav'), wav(inc, SR));
}

/* ---- montage, and a real battle ------------------------------------------------- */

function mix(into, take, at, gain, pan) {
  const [L, R] = take;
  const gl = gain * (pan <= 0 ? 1 : 1 - pan), gr = gain * (pan >= 0 ? 1 : 1 + pan);
  for (let i = 0; i < L.length; i++) {
    const j = at + i;
    if (j >= into[0].length) break;
    into[0][j] += L[i] * gl; into[1][j] += R[i] * gr;
  }
}
function blank(secs) { return [new Float32Array(Math.round(SR * secs)), new Float32Array(Math.round(SR * secs))]; }

if (wantKinds.length === KINDS.length) {
  const mont = blank(KINDS.length * 1.3 + 1);
  KINDS.forEach((k, i) => mix(mont, takes[k][0], Math.round(SR * (.3 + i * 1.3)), 1, 0));
  fs.writeFileSync(path.join(OUT, 'montage' + TAG + '.wav'), wav(mont, SR));

  /* And then the thing itself. A battle is fought, every sound the game actually plays is
     written down with where it happened, and the busiest twenty seconds of it are handed
     back to the same graph in one offline context -- one room, one compressor, one set of
     rate limits -- so what comes out is a mix rather than a row of samples laid side by
     side. It is the only honest way to hear whether massed fire holds together. */
  const { deploy, fastForward } = await import('./harness.mjs');
  await deploy(page, { side: 'us', diff: 1 });
  /* A battle with a player who does nothing in it plays about one sound a second, which
     says nothing about how a fight holds together. So a fight is staged: two companies
     put down two hundred units apart in the middle of the town, with the armour, and left
     to it. Every sound in the mix below is one the game really played. */
  await page.evaluate(() => {
    const mx = WORLD.w * .5, my = WORLD.h * .5;
    const line = [['us_rifle', 'ger_gren', 5], ['us_mg', 'ger_mg42', 2], ['us_at', 'ger_pak', 1],
                  ['us_sher', 'ger_p4', 2], ['us_ab', 'ger_pgren', 2]];
    let n = 0;
    line.forEach(([uk, gk, count]) => {
      for (let k = 0; k < count; k++) {
        const oy = my - 300 + n * 52;
        const a = nearestFree(mx - 150, oy), b = nearestFree(mx + 150, oy);
        spawnUnit('us', uk, a.x, a.y, 0);
        spawnUnit('ger', gk, b.x, b.y, Math.PI);
        n++;
      }
    });
    computeVisibility(0);
  });
  await page.evaluate(() => {
    window.__ev = [];
    /* The battle is fought with the camera stubbed out -- fastForward never calls
       render(), so the view matrices are stale and the game's own off-screen cull throws
       away nearly everything. A view the size of the map keeps the record complete; the
       replay applies a real one. */
    const realView = window.view;
    window.view = function () { return { x: -400, y: -400, w: WORLD.w + 800, h: WORLD.h + 800, corners: [] }; };
    window.__restoreView = function () { window.view = realView; };
    const real = window.sfx;
    window.sfx = function (kind, x, y) {
      const before = AU.budget;
      /* fastForward runs ninety seconds of battle in five seconds of wall clock, and the
         rate limit inside sfx is measured against the audio clock, which is wall clock.
         Left alone it throws away nineteen sounds in twenty. The limit belongs to the
         replay, where the timeline is the battle's own. */
      AU.last = {};
      real(kind, x, y);
      /* only what was really audible: the budget only falls when a sound is played */
      if (AU.budget < before) window.__ev.push({ t: G.t, kind: kind, x: x === undefined ? null : x, y: y === undefined ? null : y });
    };
  });
  await fastForward(page, 90);
  const b64 = await page.evaluate(async ([secs, sr]) => {
    window.__restoreView();
    const ev = window.__ev;
    /* the busiest window in the battle */
    let bestAt = 0, best = 0;
    for (let i = 0; i < ev.length; i++) {
      let n = 0;
      for (let j = i; j < ev.length && ev[j].t < ev[i].t + secs; j++) n++;
      if (n > best) { best = n; bestAt = ev[i].t; }
    }
    const win = ev.filter(e => e.t >= bestAt && e.t < bestAt + secs);
    let cx = 0, cy = 0, n = 0;
    win.forEach(e => { if (e.x !== null) { cx += e.x; cy += e.y; n++; } });
    cx = n ? cx / n : 1400; cy = n ? cy / n : 950;
    const oc = new OfflineAudioContext(2, Math.round(sr * (secs + 2)), sr);
    const keep = { ctx: AU.ctx, noise: AU.noise, rumb: AU.rumb, on: AU.on, budget: AU.budget,
                   last: AU.last, dry: AU.dry, send: AU.send };
    const realView = window.view;
    /* a camera parked over the fighting, so the panning and the distance rolloff are the
       ones a player watching that street would hear */
    window.view = function () { return { x: cx - 900, y: cy - 560, w: 1800, h: 1120, corners: [] }; };
    if (typeof auAttach === 'function') auAttach(oc);
    else {
      AU.ctx = oc;
      const len = Math.round(oc.sampleRate * 1.2), nb = oc.createBuffer(1, len, oc.sampleRate), nd = nb.getChannelData(0);
      for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
      AU.noise = nb;
    }
    AU.on = true; AU.last = {};
    const jobs = [];
    win.forEach(e => {
      const at = Math.max(.01, e.t - bestAt);
      jobs.push(oc.suspend(Math.min(at, secs)).then(() => {
        AU.budget = 7;
        window.sfxReal ? window.sfxReal(e.kind, e.x === null ? undefined : e.x, e.y === null ? undefined : e.y)
                       : sfx(e.kind, e.x === null ? undefined : e.x, e.y === null ? undefined : e.y);
        return oc.resume();
      }));
    });
    const out = await oc.startRendering();
    window.view = realView;
    for (const k in keep) AU[k] = keep[k];
    const L = out.getChannelData(0), R = out.getChannelData(1);
    const pcm = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) {
      pcm[i * 2] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
      pcm[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
    }
    let str = '';
    const u8 = new Uint8Array(pcm.buffer);
    for (let i = 0; i < u8.length; i += 8192) str += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return { b64: btoa(str), events: win.length, at: Math.round(bestAt) };
  }, [20, SR]);
  const raw = Buffer.from(b64.b64, 'base64');
  const n = raw.length / 4;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = raw.readInt16LE(i * 4) / 32767; R[i] = raw.readInt16LE(i * 4 + 2) / 32767; }
  fs.writeFileSync(path.join(OUT, 'firefight' + TAG + '.wav'), wav([L, R], SR));
  const fm = measure(L, SR);
  fight = '  firefight: ' + b64.events + ' sounds out of twenty seconds of a real battle at ' +
          b64.at + 's, peak ' + fm.peak.toFixed(2) + ', rms ' + fm.rms.toFixed(3) +
          ', ' + fm.lo.toFixed(0) + '/' + fm.mid.toFixed(0) + '/' + fm.hi.toFixed(0) + ' low/mid/high';
}

/* ---- the table -------------------------------------------------------------------- */

console.log('');
console.log('  ' + 'sound'.padEnd(8) + 'peak   rms   crest  attack    length     whole sound      first 50ms   6ms');
console.log('  ' + ' '.repeat(8) + ' '.repeat(41) + 'low  mid  high   low  mid  high  peak');
console.log('  ' + '-'.repeat(88));
rows.forEach(([k, m]) => {
  console.log('  ' + k.padEnd(8) +
    m.peak.toFixed(3).padStart(5) + ' ' + m.rms.toFixed(3).padStart(5) + ' ' +
    m.crest.toFixed(1).padStart(6) + ' ' + (m.attack.toFixed(1) + 'ms').padStart(8) + ' ' +
    (m.dur.toFixed(0) + 'ms').padStart(9) + '  ' +
    m.lo.toFixed(0).padStart(4) + m.mid.toFixed(0).padStart(5) + m.hi.toFixed(0).padStart(5) + '  ' +
    m.on.lo.toFixed(0).padStart(5) + m.on.mid.toFixed(0).padStart(5) + m.on.hi.toFixed(0).padStart(5) +
    m.on.p6.toFixed(2).padStart(7));
});
console.log('');
console.log('  low is under 250Hz, high over 2.2kHz, as a share of the energy in that window.');
console.log('  crest is peak over rms: a crack is a high number, a hiss is a low one.');
console.log('  the last column is the peak in the first six milliseconds, which is the crack.');

if (pieces.length) {
  console.log('');
  console.log('  ROSTER -- every gun that fires a shell, in the voice read off its own weapon');
  console.log('');
  console.log('  each row is the mean of ' + ROSTER_TAKES + ' takes, because every layer is jittered per shot');
  console.log('');
  console.log('  ' + 'piece'.padEnd(13) + 'sd  class   burst  pen    pitch  wt   crack   ' +
              'peak   crest  length   whole   onset');
  console.log('  ' + ' '.repeat(63) + 'centroid');
  console.log('  ' + '-'.repeat(94));
  pieces.forEach(([k, v, m]) => {
    console.log('  ' + v.name.padEnd(13) + v.side.padEnd(4) + v.cls.padEnd(8) +
      String(v.aoe).padStart(4) + String(v.pen).padStart(7) + '  ' +
      v.pit.toFixed(2).padStart(6) + v.wt.toFixed(2).padStart(6) + v.crk.toFixed(2).padStart(7) + '  ' +
      m.peak.toFixed(3).padStart(6) + m.crest.toFixed(1).padStart(7) +
      (m.dur.toFixed(0) + 'ms').padStart(8) + (m.centroid.toFixed(0) + 'Hz').padStart(9) +
      (m.on.centroid.toFixed(0) + 'Hz').padStart(9));
  });
  /* the two numbers that say the roster is differentiated rather than merely loud, in the
     same shape as the muzzle card's `spread`: the loudest report over the quietest, and
     the highest centroid over the lowest. A roster that is one sound reads 1.0 on both. */
  const pk = pieces.map(p => p[2].peak), ce = pieces.map(p => p[2].centroid).filter(c => c > 0);
  const du = pieces.map(p => p[2].dur);
  console.log('');
  console.log('  spread: ' + (Math.max(...pk) / Math.min(...pk)).toFixed(1) + 'x in level, ' +
              (Math.max(...ce) / Math.min(...ce)).toFixed(1) + 'x in centroid, ' +
              (Math.max(...du) / Math.min(...du)).toFixed(1) + 'x in length, over ' +
              pieces.length + ' guns.');
  /* And the six pieces the question was about, paired by key rather than by where they
     happen to sit in the roster. Each pair is the same class firing nearly the same
     shell, which is the hard case: what has to separate them is the propellant, and if
     the side timbre were doing nothing these three would read 1.00x across the board. */
  const by = {};
  pieces.forEach(p => { by[p[0]] = p; });
  const PAIRS = [['us_mor', 'ger_mor'], ['us_how', 'ger_how'], ['us_how8', 'ger_how210']];
  const rat = (x, y) => (Math.max(x, y) / Math.max(1e-9, Math.min(x, y))).toFixed(2);
  function ratLine(label, A, B) {
    return '    ' + label.padEnd(24) +
      rat(A.on.centroid, B.on.centroid) + 'x onset  ' + rat(A.peak, B.peak) + 'x level  ' +
      rat(A.dur, B.dur) + 'x length  ' + rat(A.crest, B.crest) + 'x crest';
  }
  if (PAIRS.every(([a, b]) => by[a] && by[b])) {
    console.log('');
    console.log('  the six: each pair is one class firing nearly the same shell, so what is left to');
    console.log('  separate them is the propellant -- the onset colour, the edge and the tail.');
    console.log('  Under each pair is that pair\'s own first piece rendered twice, which is what the');
    console.log('  jitter alone produces and what the row above it has to beat.');
    PAIRS.forEach(([a, b]) => {
      console.log('');
      console.log(ratLine(by[a][1].name + ' / ' + by[b][1].name, by[a][2], by[b][2]));
      if (selfCtrl[a]) console.log(ratLine('  (' + by[a][1].name + ' twice)', by[a][2], selfCtrl[a]));
    });
  }
}

if (landings.length) {
  /* And what the piece put on the ground, which is the other half of a gun's voice: every
     shell on the map used to land as the same `boom` whatever made the hole. */
  console.log('');
  console.log('  LANDING -- the burst, sized off the hole the shell dug');
  console.log('');
  console.log('  ' + 'shell'.padEnd(13) + 'burst   peak   rms    length  centroid   low  mid');
  console.log('  ' + '-'.repeat(66));
  landings.forEach(([n, r, m]) => {
    console.log('  ' + n.padEnd(13) + String(r).padStart(4) + '  ' +
      m.peak.toFixed(3).padStart(6) + m.rms.toFixed(3).padStart(7) +
      (m.dur.toFixed(0) + 'ms').padStart(9) + (m.centroid.toFixed(0) + 'Hz').padStart(10) +
      m.lo.toFixed(0).padStart(6) + m.mid.toFixed(0).padStart(5));
  });
  const lc = landings.map(l => l[2].centroid), ld = landings.map(l => l[2].dur);
  console.log('');
  console.log('  spread: ' + (Math.max(...lc) / Math.min(...lc)).toFixed(1) + 'x in centroid and ' +
              (Math.max(...ld) / Math.min(...ld)).toFixed(1) + 'x in length, over ' +
              landings.length + ' shells. Every one of them was one sound before.');
}
if (fight) { console.log(''); console.log(fight); }
console.log('  wrote ' + path.relative(ROOT, OUT) + '/');
console.log('');
await browser.close();
