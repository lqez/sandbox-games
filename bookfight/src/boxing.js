// 권투 층 — 설전과 완전히 분리된 시스템.
//
// 이 파일은 books.js와 rng.js만 안다. 대사·태그·논파를 전혀 모른다.
// 그래서 대사 없이 단독으로 시뮬레이션하고 검증할 수 있다(verify-boxing.mjs).
//
// 리듬 설계: 권투는 쉬지 않고 돈다. 잽·스트레이트·보디가 짧게 계속 오가고,
// 설전은 그 위에 얹혀 가끔 치명타를 만든다. 말하는 동안 주먹이 멈추면 리듬이 죽는다.

import { deriveStats } from './books.js';

export const PUNCHES = {
  jab: { key: 'jab', label: '잽', power: 5.5, cost: 2.5, acc: 0.92, kr: '견제' },
  cross: { key: 'cross', label: '스트레이트', power: 9, cost: 4.5, acc: 0.83, kr: '뻗기' },
  hook: { key: 'hook', label: '훅', power: 12, cost: 6.5, acc: 0.73, kr: '휘두르기' },
  upper: { key: 'upper', label: '어퍼컷', power: 14, cost: 7.5, acc: 0.66, kr: '올려치기' },
  body: { key: 'body', label: '보디', power: 6.5, cost: 4, acc: 0.87, kr: '몸통', drain: 7 },
};

// 설전에서 이긴 쪽이 꽂는 한 방. 권투 펀치보다 훨씬 무겁다 — 이게 이 게임의 치명타다.
export const VERBAL = {
  win: { key: 'verbal', label: '정타', power: 24, cost: 5, kr: '논지 적중' },
  riposte: { key: 'riposte', label: '반박', power: 20, cost: 3, kr: '논파 반격' },
  finisher: { key: 'finisher', label: '피니시', power: 34, cost: 12, kr: '대표 문장' },
};

export const BOXING_TUNING = {
  COMBO_MIN: 2, // 설전 사이에 오가는 펀치 수
  COMBO_MAX: 5,
  PUNCH_SECONDS: [0.4, 0.65], // 재생 시간 — 짧아야 리듬이 산다
  PUNCH_CLOCK: [3.5, 6.0], // 경기 시계 소모
  DAMAGE_SCALE: 0.5, // 권투는 기본 박자 — 깎고, 설전이 꺾는다.
  SLIP_MAX: 0.2, // 광기가 만드는 최대 회피율
  BLOCK_MAX: 0.46, // 관록이 만드는 최대 방어율
  BLOCK_FLOOR: 60, // 이 값 이하의 관록은 가드 보정 0 — 실제 분포 구간에 맞춰 차이를 살린다
  BLOCK_SPAN: 42,
};

// ── 파이터 ─────────────────────────────────────────────────
// 권투 층이 쓰는 최소한의 상태만 갖는다. 설전 상태(usedLines, lastTag)는 match.js가 얹는다.
export class Boxer {
  constructor(book, corner) {
    this.book = book;
    this.corner = corner;
    const d = deriveStats(book);
    this.d = d;
    this.hpMax = d.hpMax;
    this.hp = d.hpMax;
    this.stMax = d.stMax;
    this.st = d.stMax;
    this.logic = d.logic;
    this.style = d.style;
    this.legacy = d.legacy;
    this.chaos = d.chaos;
    this.grit = d.grit;
    this.speed = d.speed;
    this.staggered = false;
    this.knockdowns = 0;
    this.stats = { thrown: 0, landed: 0, blocked: 0, slipped: 0, dmg: 0, crit: 0, body: 0, verbal: 0, rebutted: 0 };
  }
  get alive() {
    return this.hp > 0;
  }
  get hpPct() {
    return Math.max(0, this.hp / this.hpMax);
  }
  get stPct() {
    return Math.max(0, this.st / this.stMax);
  }
  get groggy() {
    return this.hpPct < 0.3 || this.stPct < 0.18;
  }
  get name() {
    return this.book.title;
  }
}

// 누가 선공을 잡는가 — 기동(분량)이 빠른 쪽. 휘청이면 못 잡는다.
export function initiative(A, B, rng, div) {
  let pA = 0.5 + (A.speed - B.speed) / div;
  if (A.staggered) pA -= 0.3;
  if (B.staggered) pA += 0.3;
  return rng.chance(Math.min(0.9, Math.max(0.1, pA)));
}

// 어떤 펀치를 낼지. 스태미나가 바닥이면 잽으로 버티고, 공격적인 책일수록 큰 걸 휘두른다.
export function choosePunch(atk, def, rng) {
  if (atk.st < PUNCHES.hook.cost + 2) return rng.chance(0.75) ? PUNCHES.jab : PUNCHES.body;
  const aggro = (atk.chaos * 0.5 + atk.style * 0.5) / 100;
  // 상대가 지쳤으면 보디를 더 판다. 다만 조건부로만 두면 초반에 아예 안 나오므로 기본 확률도 준다.
  if (rng.chance(def.stPct < 0.45 ? 0.3 : 0.13)) return PUNCHES.body;
  const r = rng.next();
  if (r < 0.1 + aggro * 0.12) return PUNCHES.upper;
  if (r < 0.3 + aggro * 0.2) return PUNCHES.hook;
  if (r < 0.62 + aggro * 0.14) return PUNCHES.cross;
  return PUNCHES.jab;
}

// 한 번의 주고받기. 결과는 'hit' | 'block' | 'slip' 셋 중 하나.
export function resolvePunch(atk, def, punch, rng, T = BOXING_TUNING) {
  atk.st -= punch.cost;
  atk.stats.thrown++;

  const slip = Math.min(T.SLIP_MAX, (def.chaos / 100) * 0.24);
  const acc = punch.acc + (atk.style / 100) * 0.08 - (atk.stPct < 0.25 ? 0.12 : 0);
  if (rng.next() > acc * (1 - slip)) {
    def.stats.slipped++;
    return { result: 'slip', dmg: 0, punch };
  }

  // 가드 — 관록이 높을수록 잘 막는다. 막으면 피해가 크게 준다.
  const blockRaw = Math.min(1, Math.max(0, (def.legacy - T.BLOCK_FLOOR) / T.BLOCK_SPAN));
  const blockChance = blockRaw * T.BLOCK_MAX * (def.staggered ? 0.5 : 1);
  const blocked = rng.chance(blockChance);

  const crit = !blocked && rng.next() < 0.05 + (atk.style / 100) * 0.12;
  const gassed = atk.stPct < 0.22 ? 0.66 : 1;
  let dmg =
    punch.power *
    (0.55 + (atk.logic / 100) * 0.5) *
    (blocked ? 0.28 : 1) *
    (crit ? 1.7 : 1) *
    (def.staggered ? 1.3 : 1) *
    gassed *
    rng.float(0.85, 1.15) *
    T.DAMAGE_SCALE;
  dmg = Math.max(1, Math.round(dmg));

  def.hp -= dmg;
  atk.stats.landed++;
  atk.stats.dmg += dmg;
  if (crit) atk.stats.crit++;
  if (blocked) def.stats.blocked++;
  if (punch.drain) {
    def.st = Math.max(0, def.st - punch.drain);
    atk.stats.body++;
  }
  return { result: blocked ? 'block' : 'hit', dmg, crit, punch };
}

// 큰 걸 맞으면 휘청이거나 다운된다. 권투/설전 양쪽에서 같은 규칙을 쓴다.
export function checkStagger(def, dmg, rng, resist = 0) {
  def.staggered = false;
  if (def.hp <= 0) return { staggered: false, knockdown: false };
  const ratio = dmg / def.hpMax;
  const base = (def.grit / 100) * 0.45 * (1 + resist);
  if (ratio > 0.19 && rng.next() < (ratio - 0.12) * 3.6 - base) {
    def.knockdowns++;
    def.st = Math.max(0, def.st - 18);
    def.staggered = true;
    return { staggered: true, knockdown: true };
  }
  if (ratio > 0.11 && rng.next() < (ratio - 0.07) * 3.2 - base * 0.6) {
    def.staggered = true;
    return { staggered: true, knockdown: false };
  }
  return { staggered: false, knockdown: false };
}

export function recover(f, amount) {
  f.st = Math.min(f.stMax, f.st + amount);
}
