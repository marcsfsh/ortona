/* Sound, mechanically.
 *
 * Every noise the game makes is synthesised at runtime -- there are no audio files, for
 * the same reason there are no image files -- so a change to the sound cannot be checked
 * by reading the diff any more than a change to a model can. This renders the game's own
 * sfx() through an OfflineAudioContext, writes what comes out as WAV, and prints the
 * numbers that say what a sound actually is: how hard it starts, how long it lasts, where
 * its energy sits and how much of it is body rather than hiss.
 *
 *   node tools/audio.mjs                 every sound, plus a montage and a firefight
 *   node tools/audio.mjs rifle mg        two of them
 *   node tools/audio.mjs --tag=before    keep a set to compare against
 *
 * Nothing is reimplemented. The page's own auAttach() builds the graph on the offline
 * context and the page's own sfx() fills it, so what is written here is what a player
 * hears, sample for sample.
 */

import fs from 'node:fs';
import path from 'node:path';
import { launch, openGame, parseArgs, ROOT } from './harness.mjs';

const args = parseArgs(process.argv.slice(2));
const TAG = args.tag === undefined ? '' : '-' + String(args.tag);
const SR = 44100;
const KINDS = ['rifle', 'mg', 'cannon', 'rocket', 'boom', 'cap', 'spawn', 'click'];
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

async function render(kind, secs) {
  const b64 = await page.evaluate(async ([kind, secs, sr]) => {
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
    sfx(kind);
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
  }, [kind, secs, SR]);
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
const takes = {};
const rows = [];
let fight = '';
for (const kind of want) {
  const secs = kind === 'boom' || kind === 'cannon' ? 2.6 : 1.6;
  takes[kind] = [];
  for (let v = 0; v < VARIANTS; v++) takes[kind].push(await render(kind, secs));
  const [L, R] = takes[kind][0];
  const mono = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) * .5;
  rows.push([kind, measure(mono, SR)]);
  fs.writeFileSync(path.join(OUT, kind + TAG + '.wav'), wav([L, R], SR));
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

if (want.length === KINDS.length) {
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
if (fight) { console.log(''); console.log(fight); }
console.log('  wrote ' + path.relative(ROOT, OUT) + '/');
console.log('');
await browser.close();
