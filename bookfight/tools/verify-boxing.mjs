// 검증 2 — 권투 시뮬레이션이 제대로 도는가. 대사와 무관하게 본다.
//
//   node bookfight/tools/verify-boxing.mjs [라운드수]
//
// 여기서는 boxing.js만 직접 돌린다. taunts.js도 match.js도 부르지 않는다.
// 설전을 한 줄도 섞지 않고 권투만으로 라운드를 굴려서, 주먹 쪽이 스스로 굴러가는지 확인한다.
//
// 보는 것:
//   분포   펀치 종류가 고루 나오는가, 명중/가드/회피 비율이 말이 되는가
//   피해   한 방 피해가 체력 대비 적당한가(한 방에 훅 가지 않는가)
//   체력   스태미나가 실제로 닳고 회복되는가
//   능력치 광기↑=회피↑, 관록↑=가드↑, 기동↑=선공↑ 이 실제로 나타나는가
//   리듬   주먹이 몇 초에 한 번씩 나가는가

import { BOOKS, getBook, deriveStats } from '../src/books.js';
import {
  Boxer, PUNCHES, BOXING_TUNING, initiative, choosePunch, resolvePunch, checkStagger, recover,
} from '../src/boxing.js';
import { Rng } from '../src/rng.js';

const ROUNDS = Number(process.argv[2] || 400);
const ROUND_SECONDS = 300;
const fails = [];
const warn = (cond, msg) => { if (!cond) fails.push(msg); };

// ── 대사 없는 순수 권투 라운드 ─────────────────────────────
function boxOnly(bookA, bookB, seed) {
  const rng = new Rng(seed);
  const A = new Boxer(bookA, 'red');
  const B = new Boxer(bookB, 'blue');
  let clock = ROUND_SECONDS;
  let t = 0;
  let punches = 0;
  const stTrace = [];
  let firstA = 0;
  let total = 0;

  while (clock > 0 && A.alive && B.alive && punches < 400) {
    const aFirst = initiative(A, B, rng, 620);
    const atk = aFirst ? A : B;
    const def = atk === A ? B : A;
    if (aFirst) firstA++;
    total++;

    const punch = choosePunch(atk, def, rng);
    const r = resolvePunch(atk, def, punch, rng);
    if (r.result === 'hit') checkStagger(def, r.dmg, rng);
    punches++;
    t += rng.float(...BOXING_TUNING.PUNCH_SECONDS);
    clock -= rng.float(...BOXING_TUNING.PUNCH_CLOCK);
    recover(A, A.d.recover * 0.5);
    recover(B, B.d.recover * 0.5);
    if (punches % 8 === 0) stTrace.push([A.stPct, B.stPct]);
  }
  const ko = !A.alive || !B.alive;
  return { A, B, punches, t, ko, stTrace, initRateA: firstA / Math.max(1, total) };
}

// ── 표본 수집 ──────────────────────────────────────────────
const mix = {};
const results = { hit: 0, block: 0, slip: 0 };
let dmgSum = 0, dmgN = 0, dmgMax = 0, hpMaxSum = 0;
let koCount = 0, punchSum = 0, timeSum = 0, kdSum = 0;
let stEndSum = 0, stEndN = 0;
const perBook = new Map(BOOKS.map((b) => [b.id, { slipFor: 0, thrownAt: 0, blockFor: 0, landedAt: 0, init: 0, initN: 0 }]));

for (let i = 0; i < ROUNDS; i++) {
  const rng = new Rng('bx' + i);
  const a = rng.pick(BOOKS);
  let b = rng.pick(BOOKS);
  while (b.id === a.id) b = rng.pick(BOOKS);
  const R = boxOnly(a, b, 'B' + (500 + i * 13));

  punchSum += R.punches;
  timeSum += R.t;
  if (R.ko) koCount++;
  kdSum += R.A.knockdowns + R.B.knockdowns;
  hpMaxSum += (R.A.hpMax + R.B.hpMax) / 2;
  stEndSum += (R.A.stPct + R.B.stPct) / 2;
  stEndN++;

  for (const [f, o] of [[R.A, R.B], [R.B, R.A]]) {
    results.hit += f.stats.landed - f.stats.blocked;
    results.block += f.stats.blocked;
    results.slip += f.stats.slipped;
    dmgSum += f.stats.dmg;
    dmgN += f.stats.landed;
    // 상대(o)가 f에게 던진 것 기준으로 f의 회피/가드율을 잰다
    const rec = perBook.get(f.book.id);
    rec.slipFor += f.stats.slipped;
    rec.blockFor += f.stats.blocked;
    rec.thrownAt += o.stats.thrown;
    rec.landedAt += o.stats.landed;
  }
  const ra = perBook.get(a.id);
  ra.init += R.initRateA; ra.initN++;
}

// 펀치 종류 분포 — choosePunch만 따로 많이 돌려서 본다
{
  const rng = new Rng('mixcheck');
  for (let i = 0; i < 20000; i++) {
    const a = new Boxer(rng.pick(BOOKS), 'red');
    const b = new Boxer(rng.pick(BOOKS), 'blue');
    a.st = a.stMax * rng.float(0.15, 1); // 경기 중 스태미나 분포를 흉내낸다
    b.st = b.stMax * rng.float(0.15, 1);
    const p = choosePunch(a, b, rng);
    mix[p.key] = (mix[p.key] || 0) + 1;
  }
}

// 한 방 최대 피해 — 체력 대비 얼마나 위험한지
{
  const rng = new Rng('maxdmg');
  for (let i = 0; i < 6000; i++) {
    const a = new Boxer(rng.pick(BOOKS), 'red');
    const b = new Boxer(rng.pick(BOOKS), 'blue');
    const r = resolvePunch(a, b, PUNCHES.upper, rng);
    const ratio = r.dmg / b.hpMax;
    if (r.result === 'hit' && ratio > dmgMax) dmgMax = ratio;
  }
}

// ── 결과 ───────────────────────────────────────────────────
const pct = (x) => (x * 100).toFixed(1) + '%';
const totalOutcomes = results.hit + results.block + results.slip;
const avgPunch = punchSum / ROUNDS;
const avgTime = timeSum / ROUNDS;
const avgDmg = dmgSum / dmgN;
const avgHp = hpMaxSum / ROUNDS;

console.log('═══ 검증 2 · 권투 시뮬레이션 (대사 없음) ═══');
console.log(`표본: ${ROUNDS}라운드, 총 ${punchSum}펀치\n`);

console.log('[분포] 펀치 선택');
const mixTotal = Object.values(mix).reduce((a, c) => a + c, 0);
for (const k of Object.keys(PUNCHES)) {
  const v = mix[k] || 0;
  console.log(`   ${PUNCHES[k].label.padEnd(6)} ${pct(v / mixTotal).padStart(7)}  ${'█'.repeat(Math.round((v / mixTotal) * 50))}`);
}
warn(Object.keys(PUNCHES).every((k) => (mix[k] || 0) / mixTotal > 0.03), '거의 안 나오는 펀치가 있다');

console.log('\n[결과] 명중 / 가드 / 회피');
console.log(`   명중 ${pct(results.hit / totalOutcomes)}   가드 ${pct(results.block / totalOutcomes)}   회피 ${pct(results.slip / totalOutcomes)}`);
warn(results.hit / totalOutcomes > 0.35 && results.hit / totalOutcomes < 0.7, `깨끗한 명중률이 이상하다 ${pct(results.hit / totalOutcomes)}`);
warn(results.slip / totalOutcomes > 0.08, '회피가 거의 안 나온다');
warn(results.block / totalOutcomes > 0.08, '가드가 거의 안 나온다');

console.log('\n[피해]');
console.log(`   평균 체력 ${avgHp.toFixed(0)} · 유효타 1회 평균 ${avgDmg.toFixed(1)} (체력의 ${pct(avgDmg / avgHp)})`);
console.log(`   최악의 한 방(어퍼컷 크리티컬) 체력의 ${pct(dmgMax)}`);
console.log(`   → 이론상 KO까지 ${(avgHp / avgDmg).toFixed(0)}회 유효타 필요`);
warn(avgDmg / avgHp < 0.13, `한 방이 너무 아프다 (체력의 ${pct(avgDmg / avgHp)})`);
warn(dmgMax < 0.35, `최악의 한 방이 체력의 ${pct(dmgMax)} — 즉사에 가깝다`);

console.log('\n[체력] 스태미나');
console.log(`   라운드 종료 시 평균 잔량 ${pct(stEndSum / stEndN)}`);
warn(stEndSum / stEndN < 0.9, '스태미나가 전혀 안 닳는다');
warn(stEndSum / stEndN > 0.05, '스태미나가 완전히 고갈된다');

console.log('\n[리듬]');
console.log(`   라운드당 ${avgPunch.toFixed(1)}펀치 · 재생 ${avgTime.toFixed(1)}초 → ${(avgTime / avgPunch).toFixed(2)}초에 한 방`);
console.log(`   권투만으로 끝난 라운드(KO): ${pct(koCount / ROUNDS)} · 다운 평균 ${(kdSum / ROUNDS).toFixed(2)}회`);
warn(avgTime / avgPunch < 1.3, '주먹 간격이 너무 길다 — 리듬이 안 산다');

console.log('\n[능력치가 실제로 작동하는가]');
const rows = [...perBook.entries()].map(([id, v]) => {
  const b = getBook(id);
  const d = deriveStats(b);
  return { t: b.title, chaos: d.chaos, legacy: d.legacy, speed: d.speed,
    slip: v.thrownAt ? v.slipFor / v.thrownAt : 0,
    block: v.landedAt ? v.blockFor / v.landedAt : 0,
    init: v.initN ? v.init / v.initN : 0.5 };
}).filter((r) => r.slip > 0);
const corr = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, c) => a + c, 0) / n, my = ys.reduce((a, c) => a + c, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy || 1);
};
const cChaos = corr(rows.map((r) => r.chaos), rows.map((r) => r.slip));
const cLegacy = corr(rows.map((r) => r.legacy), rows.map((r) => r.block));
const cSpeed = corr(rows.map((r) => r.speed), rows.map((r) => r.init));
console.log(`   광기 ↔ 회피율   상관 ${cChaos.toFixed(2)}`);
console.log(`   관록 ↔ 가드율   상관 ${cLegacy.toFixed(2)}`);
console.log(`   기동 ↔ 선공률   상관 ${cSpeed.toFixed(2)}`);
warn(cChaos > 0.6, `광기가 회피로 이어지지 않는다 (상관 ${cChaos.toFixed(2)})`);
warn(cLegacy > 0.6, `관록이 가드로 이어지지 않는다 (상관 ${cLegacy.toFixed(2)})`);
warn(cSpeed > 0.6, `기동이 선공으로 이어지지 않는다 (상관 ${cSpeed.toFixed(2)})`);

console.log('\n' + (fails.length ? `✗ 실패 ${fails.length}건\n  - ` + fails.join('\n  - ') : '✓ 전부 통과'));
process.exit(fails.length ? 1 : 0);
