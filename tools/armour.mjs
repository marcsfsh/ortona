/* Armour, mechanically.
 *
 * Whether a round goes through is a question about where it lands, what plate is there and at
 * what angle it meets it, and the answer for one gun against one tank says nothing about the
 * next pair. So the card asks it of every pair: every weapon on the roster that goes through
 * anything against every vehicle that carries plate, from the front, from thirty degrees off
 * the nose, from the side and from behind, close in and at the edge of the weapon's reach.
 *
 *   node tools/armour.mjs                    the matrix and the sampler check
 *   node tools/armour.mjs matrix             one section of it
 *   node tools/armour.mjs --veh=hr_panther   one vehicle
 *   node tools/armour.mjs --w=am_at          one weapon (a unit key, or key.slot)
 *   node tools/armour.mjs --json=out.json    write the whole matrix out
 *   node tools/armour.mjs --file=/tmp/x.html an older file
 *
 * MATRIX is the chance a round that hits goes through, off the game's own `penVs`, which is
 * what every reader of a gun against armour asks: the brain choosing a target, the section
 * leader deciding whether he can answer a tank, the balance of every fight. Beside it, what a
 * round that goes through does and how many of them it takes.
 *
 * SAMPLE is the check, and it is the one thing here that is not the game asking itself. Where
 * a round lands (`hitLoc`) is drawn from the faces the gun can see; what the brain is told
 * (`penVs`) is the same faces integrated. If the two disagree, one of them is wrong, so the
 * card fires a few thousand rounds through the sampler and compares. And every point the
 * sampler hands back has to be on a face that turns toward the gun and on that face, because a
 * spark on the far side of the hull is a round that went through the tank to bounce.
 */

import { launch, openGame, deploy, flatSpot, parseArgs } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const want = new Set(args._ && args._.length ? args._ : ['matrix', 'sample']);
const browser = await launch();
const { page } = await openGame(browser, 'desktop', { ctrl: 'classic', ...(args.file ? { file: path.resolve(args.file) } : {}) });
await deploy(page, { side: 'us', diff: 1 });
const sp = await flatSpot(page, 300);

const R = await page.evaluate(({ sp, veh, wk }) => {
  const W = window, G = W.G, U = W.UNITS;
  G.paused = true;
  G.units.forEach(u => { u.dead = true; });
  G.units = [];
  /* the weapons: every slot that names a penetration in millimetres and goes through more
     than a rifle's ball, and no tube that only fires on a map reference */
  const weps = [];
  for (const k in U) {
    const d = U[k];
    if (d.base) continue;
    const add = (slot, w) => {
      if (!w || !w.mm || w.mm < 9 || w.indirect || d.barrageOnly) return;
      const id = slot === 'w' ? k : k + '.' + slot;
      if (wk && wk !== k && wk !== id) return;
      weps.push({ id, name: (d.short || d.name) + (slot === 'w' ? '' : ' ' + slot), side: d.side, w, dmg: w.dmg });
    };
    add('w', d.w); add('at', d.at);
    if (d.wUp) for (const s in d.wUp) add(s, d.wUp[s]);
    if (d.glUp) for (const s in d.glUp) add(s, d.glUp[s]);
  }
  /* the vehicles: everything with a plate table, the three that hang skirts with them hung
     as well, and the Priest rebuilt as the M12 */
  const vs = [];
  for (const k in W.ARM) {
    if (W.ARM[k].soft || !U[k] || U[k].base && !W.fielded(k)) continue;
    vs.push({ id: k, key: k });
    if (W.ARM[k].sk) vs.push({ id: k + '+skirts', key: k, up: 'skirts' });
  }
  vs.push({ id: 'am_m12', key: 'am_m7', fit: 'm12' });
  const out = { weps: weps.map(w => ({ id: w.id, name: w.name, side: w.side, mm: w.w.mm, heat: !!w.w.heat, range: w.w.range, dmg: w.dmg })), veh: [], cells: {}, sample: [] };
  const bears = [['front', 0], ['30', Math.PI / 6], ['side', Math.PI / 2], ['rear', Math.PI]];
  vs.forEach(V => {
    if (veh && veh !== V.id && veh !== V.key) return;
    const t = W.spawnUnit(V.key === 'am_m7' || U[V.key].side === 'us' ? 'us' : 'ger', V.key, sp.x, sp.y, 0);
    if (V.fit) W.fitUp(t, V.fit);
    if (V.up) t.up[V.up] = true;
    t.facing = 0; t.turret = 0; t.gz = undefined;
    const A = W.armOf(t), B = W.vehBox(W.vkey(t));
    out.veh.push({ id: V.id, name: t.def.short || t.def.name, side: t.side, hp: t.maxhp || t.def.hp, h: A.h, t: A.t, cm: A.cm || 0, sk: V.up ? A.sk || 0 : 0,
                   box: B ? [B.hl, B.hw, B.hz, B.t ? B.t.hl : 0, B.t ? B.t.hw : 0, B.t ? B.t.hz : 0].map(x => +x.toFixed(1)) : null });
    weps.forEach(E => {
      const row = {};
      [['close', .25], ['far', .9]].forEach(([nm, f]) => {
        const d = E.w.range * f;
        row[nm] = { pen: +W.penMM(E.w, d).toFixed(0) };
        bears.forEach(([bn, a]) => { row[nm][bn] = +W.penVs(E.w, d, t, t.x + Math.cos(a) * d, t.y + Math.sin(a) * d).toFixed(2); });
      });
      row.kills = Math.ceil((t.maxhp || t.def.hp) / E.dmg);
      out.cells[V.id + '|' + E.id] = row;
    });
    /* the sampler against the integral, and every point on the side that faces the gun */
    if (B) {
      const probe = [W.UNITS.am_sher.w, W.UNITS.am_at.w, W.UNITS.hr_p4.w, W.UNITS.am_ranger.at];
      let worst = 0, behind = 0, off = 0, n = 0;
      probe.forEach(w => [0, .5, 1.2, Math.PI / 2, 2.4, Math.PI].forEach(a => {
        const d = w.range * .5, fx = t.x + Math.cos(a) * d, fy = t.y + Math.sin(a) * d;
        const exp = W.penVs(w, d, t, fx, fy);
        let pen = 0;
        const N = 600;
        for (let i = 0; i < N; i++) {
          const L = W.hitLoc(t, A, B, fx, fy, w, d);
          pen += L.p; n++;
          /* the face it landed on faces the gun, and the point is on that face of the box */
          const nw = (L.tur ? t.turret : t.facing) + L.na, X = L.tur ? B.t : B;
          if (Math.cos(nw - a) < -1e-6) behind++;
          if (Math.abs(L.ly) > X.hw + .01 || L.lx < X.cx - X.hl - .01 || L.lx > X.cx + X.hl + .01 || L.lz < -.01 || L.lz > (L.tur ? X.hz : B.hz) + .01) off++;
        }
        worst = Math.max(worst, Math.abs(pen / N - exp));
      }));
      out.sample.push({ id: V.id, worst: +worst.toFixed(3), behind, off, n });
    }
    G.units.splice(G.units.indexOf(t), 1);
  });
  return out;
}, { sp, veh: args.veh || null, wk: args.w || null });

const pct = x => x >= .995 ? '100' : x <= .005 ? '  .' : String(Math.round(x * 100)).padStart(3);
if (want.has('matrix')) {
  console.log('\nMATRIX  the chance a round that hits goes through: front, 30 off the nose, side, rear; close in (a quarter of its reach) | at the edge (nine tenths)');
  R.veh.forEach(V => {
    console.log(`\n${V.id.padEnd(16)} ${V.name}  ${V.hp} hp  hull ${V.h.join('/')}  ${V.cm ? 'upper' : 'turret'} ${V.t.join('/')}${V.sk ? '  skirts +' + V.sk : ''}`);
    R.weps.forEach(E => {
      const c = R.cells[V.id + '|' + E.id];
      if (!c) return;
      const any = ['front', '30', 'side', 'rear'].some(b => c.close[b] > .005);
      if (!any) return;
      const q = s => ['front', '30', 'side', 'rear'].map(b => pct(s[b])).join(' ');
      console.log(`  ${E.id.padEnd(18)} ${String(E.mm).padStart(3)}${E.heat ? 'H' : ' '} ${String(c.close.pen).padStart(3)}  ${q(c.close)} | ${String(c.far.pen).padStart(3)}  ${q(c.far)}   ${String(E.dmg).padStart(4)} a round, ${c.kills} to kill`);
    });
  });
}
if (want.has('sample')) {
  console.log('\nSAMPLE  the sampler against the integral (worst gap in the chance, over 4 guns and 6 bearings at 600 rounds each), faces that turn away from the gun, and points off the face they were put on');
  let bad = 0;
  R.sample.forEach(s => {
    const ok = s.worst < .06 && s.behind === 0 && s.off === 0;
    if (!ok) bad++;
    console.log(`  ${s.id.padEnd(16)} gap ${s.worst.toFixed(3)}  facing away ${s.behind}  off the box ${s.off}  of ${s.n}${ok ? '' : '   <-- '}`);
  });
  console.log(bad ? `\n${bad} vehicle(s) where the sampler and the integral disagree` : '\nthe sampler agrees with the integral on every vehicle');
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify(R, null, 1));
await browser.close();
