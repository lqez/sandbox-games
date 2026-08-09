// 경기 시뮬레이션 — 시드를 넣으면 경기 전체가 이벤트 타임라인으로 한 번에 나온다.
// 3D/연출은 이 타임라인을 "재생"만 한다. 그래서 리플레이·되감기·시드 공유가 전부 공짜로 된다.
//
// 단판 1라운드. 5분 안에 KO/TKO가 안 나면 심판 3인 판정으로 끝난다.

import { Rng } from './rng.js';
import { deriveStats, rivalryFor } from './books.js';
import { buildClash, readTime } from './taunts.js';

export const ROUND_SECONDS = 300; // 단판 5분

// 밸런스 손잡이 — 한곳에 모아둔다. 아래 sweep()으로 값을 바꿔가며 승률/KO율을 재고 맞췄다.
//
// 핵심 균형: 얇은 책은 선공을 더 자주 잡고(INITIATIVE_DIV), 두꺼운 책은 체력이 많다.
// 한 라운드 동안 A가 이기려면  선공비 pA/(1-pA)  >  HP_B/HP_A  라야 한다.
// 가장 극단인 74쪽 대 1225쪽에서 두 값이 엇비슷해지도록 INITIATIVE_DIV를 잡았다.
export const TUNING = {
  INITIATIVE_DIV: 620, // 작을수록 얇은 책(기동)이 유리
  DAMAGE_BASE: 0.5, // 논지 0일 때의 타격 계수
  DAMAGE_LOGIC: 0.72, // 논지 100일 때 더해지는 계수
  DAMAGE_SCALE: 1.15, // 전체 화력. 낮추면 KO가 줄고 판정이 늘어난다. 1.15에서 KO 58% / 판정 42%.
  DOT_PER_HIT: 1.6, // 불안 누적량. 감쇠가 0.7이라 최대 체감치는 이 값의 약 3배.
  DOT_CAP: 5.5,
  DOT_DECAY: 0.7,
  CHARGE_RECOIL: 0.45, // 풍차 돌격이 빗나갔을 때 자해가 일어날 확률
};

const MOVES = {
  jab: { key: 'jab', label: '잽', power: 9.5, cost: 4, acc: 0.9, kr: '견제 인용' },
  combo: { key: 'combo', label: '연타', power: 15, cost: 9, acc: 0.78, kr: '연속 인용' },
  heavy: { key: 'heavy', label: '훅', power: 24, cost: 15, acc: 0.62, kr: '핵심 논지' },
  finisher: { key: 'finisher', label: '피니시', power: 38, cost: 26, acc: 0.72, kr: '대표 문장' },
  riposte: { key: 'riposte', label: '반박', power: 17, cost: 3, acc: 1, kr: '논파 반격' },
  breathe: { key: 'breathe', label: '호흡', power: 0, cost: -18, acc: 1, kr: '뜸 들이기' },
};

class Fighter {
  constructor(book, corner) {
    this.book = book;
    this.corner = corner; // 'red' | 'blue'
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
    this.dot = 0; // 카프카식 지속 피해
    this.transformed = false;
    this.evadeCharge = false; // 앨리스식 회피 후 강타
    this.finisherUsed = 0;
    this.usedQuotes = new Set();
    this.usedLines = new Set(); // 설전 대사 재사용 방지

    // 스코어카드용 누적
    this.stats = { landed: 0, thrown: 0, dmg: 0, crit: 0, heavy: 0, evaded: 0, rebutted: 0 };
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

// ── 저자 특성 훅 ─────────────────────────────────────────────
// 각 특성은 공격 직전/직후에 끼어들어 수치를 비튼다. 발동하면 방송 자막으로 뜬다.

function traitOnAttack(atk, def, move, ctx, rng) {
  const t = atk.book.authorTrait;
  const fired = [];
  switch (t.kind) {
    case 'giantkiller': // 자기만의 방 — 관록 높은 상대에게 강하다
      if (def.legacy >= 85) {
        ctx.mult *= 1 + (def.legacy - 80) * 0.012;
        fired.push(t.name);
      }
      break;
    case 'comeback': // 위대한 개츠비 — 지고 있을수록 강하다
      if (atk.hpPct < def.hpPct - 0.12) {
        ctx.mult *= 1 + Math.min(0.45, (def.hpPct - atk.hpPct) * 0.9);
        fired.push(t.name);
      }
      break;
    case 'interrogate': // 죄와 벌 — 그로기 상대에게 폭발
      if (def.groggy) {
        ctx.mult *= 1.42;
        fired.push(t.name);
      }
      break;
    case 'reversal': // 프랑켄슈타인 — 논지 센 상대에게 되받아친다
      if (def.logic >= atk.logic) {
        ctx.mult *= 1 + (def.logic - atk.logic + 6) * 0.009;
        fired.push(t.name);
      }
      break;
    case 'charge': // 돈키호테 — 피해 분산이 극단적. 크게 터지거나 크게 헛돈다.
      ctx.mult *= rng.float(0.65, 1.95);
      ctx.recoil = rng.chance(TUNING.CHARGE_RECOIL);
      fired.push(t.name);
      break;
    case 'evolve': // 종의 기원 — 교전마다 누적 성장
      ctx.mult *= 1 + Math.min(0.5, ctx.beat * 0.022);
      if (ctx.beat > 6) fired.push(t.name);
      break;
    case 'epilogue': // 전쟁과 평화 — 후반에 강해진다
      if (ctx.clock < ROUND_SECONDS * 0.45) {
        ctx.mult *= 1.28;
        fired.push(t.name);
      }
      break;
    case 'mousetrap': // 햄릿 — 크리티컬 시 상대 스태미나까지
      ctx.drainOnCrit = 14;
      break;
    case 'digression': // 모비 딕 — 상대를 재운다
      ctx.drain = 9;
      fired.push(t.name);
      break;
    case 'dot': // 변신 — 불안을 남긴다. 상한을 두지 않으면 정상상태에서 폭주한다.
      ctx.applyDot = TUNING.DOT_PER_HIT;
      fired.push(t.name);
      break;
    case 'lifesteal': // 드라큘라 — 흡혈
      ctx.lifesteal = 0.32;
      fired.push(t.name);
      break;
    case 'transform': // 지킬 — 절반 아래에서 하이드
      if (!atk.transformed && atk.hpPct < 0.5) {
        atk.transformed = true;
        atk.logic += 22;
        atk.chaos += 16;
        atk.legacy -= 24;
        ctx.transformNow = true;
        fired.push(t.name);
      }
      if (atk.transformed) ctx.mult *= 1.12;
      break;
  }
  if (atk.evadeCharge && move.key !== 'breathe') {
    ctx.mult *= 1.4;
    atk.evadeCharge = false;
    fired.push('체셔 회피 → 반격');
  }
  return fired;
}

function traitOnDefend(def, atk, ctx, rng) {
  const t = def.book.authorTrait;
  const fired = [];
  switch (t.kind) {
    case 'counter': // 손자병법 — 흘려 되치기. 이제 논파 확률로 흡수됐다(taunts.js buildClash).
      break;
    case 'foxlion': // 군주론 — 피니셔 반감
      if (ctx.move.key === 'finisher') {
        ctx.mult *= 0.5;
        fired.push(t.name);
      }
      break;
    case 'evade': // 앨리스 — 회피 성공 시 다음 공격 강화
      ctx.evadeBonus = 0.1;
      break;
    case 'poise': // 오만과 편견 — 크리티컬을 맞아도 흔들리지 않는다
      ctx.staggerResist = 0.5;
      break;
  }
  return fired;
}

// ── 무브 선택 AI ─────────────────────────────────────────────
function chooseMove(atk, def, ctx, rng) {
  const canFinish =
    atk.st >= MOVES.finisher.cost &&
    atk.finisherUsed < 2 &&
    (def.hpPct < 0.38 || def.groggy || ctx.clock < 45);
  if (canFinish && rng.chance(0.62)) return MOVES.finisher;

  if (atk.st < MOVES.heavy.cost + 4) {
    // 숨이 찼다 — 잽으로 버티거나 아예 호흡을 고른다
    if (atk.st < 14 && rng.chance(0.55)) return MOVES.breathe;
    return MOVES.jab;
  }
  // 공격적인 책(광기/문체 높음)일수록 큰 걸 던진다
  const aggro = (atk.chaos * 0.5 + atk.style * 0.5) / 100;
  const r = rng.next();
  if (r < 0.2 + aggro * 0.24) return MOVES.heavy;
  if (r < 0.58 + aggro * 0.18) return MOVES.combo;
  return MOVES.jab;
}

function pickQuote(f, move, rng) {
  if (move.key === 'finisher') return f.book.quotes.finisher.line;
  const pool = move.key === 'jab' ? f.book.quotes.jab : f.book.quotes.heavy.concat(f.book.quotes.jab);
  return rng.pickFresh(pool, f.usedQuotes);
}

// ── 해설 ─────────────────────────────────────────────────────
const CALL = {
  bigCrit: (a, d) => `${a} 제대로 꽂혔습니다! ${d} 완전히 굳었어요!`,
  evade: (a, d) => `${d}, 흘려보냅니다. ${a}의 문장이 허공을 갈랐어요.`,
  block: (d) => `${d}가 관록으로 막아냅니다. 오래 살아남은 책은 이렇게 버팁니다.`,
  gassed: (a) => `${a}, 숨이 찹니다. 분량이 발목을 잡네요.`,
  stagger: (d) => `${d} 휘청입니다! 다리가 풀렸어요!`,
  down: (d) => `다운! ${d}가 펼쳐진 채로 매트에 엎어졌습니다!`,
  finisher: (a, n) => `${a}, 대표 문장이 나옵니다 — 「${n}」!`,
  counter: (d) => `${d}의 반격! 상대의 힘을 그대로 되돌립니다!`,
  transform: () => `변했습니다! 지킬이 사라지고 하이드가 섰습니다!`,
  clockLow: () => `1분 남았습니다. 판정으로 갈 흐름이에요.`,
  clutch: (a) => `${a}, 마지막 러시를 갑니다!`,
};

// ── 본체 ─────────────────────────────────────────────────────
export function simulate(bookA, bookB, seed) {
  const rng = new Rng(seed);
  const A = new Fighter(bookA, 'red');
  const B = new Fighter(bookB, 'blue');
  const rivalry = rivalryFor(bookA.id, bookB.id);

  const events = [];
  let t = 0; // 재생 시각(초)
  let clock = ROUND_SECONDS; // 경기 시계(남은 초)
  const push = (e) => events.push({ t: +t.toFixed(2), clock: Math.max(0, Math.round(clock)), ...e });

  // 시드 자체가 유불리를 만든다 — 컨디션. 같은 대진도 시드마다 몸 상태가 다르다.
  const condA = rng.float(0.9, 1.1);
  const condB = rng.float(0.9, 1.1);
  A.logic = Math.round(A.logic * condA);
  B.logic = Math.round(B.logic * condB);
  A.cond = condA;
  B.cond = condB;

  push({ type: 'intro', a: A.book.id, b: B.book.id, seed: String(seed) });
  if (rivalry) {
    push({ type: 'commentary', text: `오늘의 관전 포인트 — ${rivalry.why}.`, tone: 'hype' });
  }
  t += 0.2;
  push({ type: 'bell', text: '1라운드, 단판 승부' });
  t += 1.1;

  let beat = 0;
  let last = null; // 직전 공격자 — 같은 쪽이 계속 때리면 흐름 자막
  let streak = 0;
  let finish = null;
  let calledClockLow = false;

  while (clock > 0 && A.alive && B.alive && beat < 60) {
    beat++;

    // 선공 결정 — 기동(분량)이 빠른 쪽이 유리, 휘청이면 못 잡는다.
    // 얇은 책이 체력 열세를 만회하는 유일한 통로라 분모를 좁게 잡는다.
    let pA = 0.5 + (A.speed - B.speed) / TUNING.INITIATIVE_DIV;
    if (A.staggered) pA -= 0.3;
    if (B.staggered) pA += 0.3;
    pA = Math.min(0.9, Math.max(0.1, pA));
    let atk = rng.chance(pA) ? A : B;
    let def = atk === A ? B : A;

    const ctx = { mult: 1, beat, clock, move: null, staggered: def.staggered };
    const opener = chooseMove(atk, def, ctx, rng);
    ctx.move = opener;

    // 호흡 고르기
    if (opener.key === 'breathe') {
      atk.st = Math.min(atk.stMax, atk.st - opener.cost);
      push({
        type: 'breathe',
        by: atk.corner,
        text: `${atk.name}, 페이지를 넘기며 숨을 고릅니다.`,
      });
      if (rng.chance(0.5)) push({ type: 'commentary', text: CALL.gassed(atk.name), tone: 'calm' });
      t += 1.6;
      clock -= rng.float(8, 13);
      continue;
    }

    // ── 설전 ──────────────────────────────────────────────
    // 이 게임의 한 합은 "도발 → 반박 → 판정 → 주먹" 순이다.
    // 주먹이 누구에게 들어갈지는 주사위가 아니라 말싸움 결과가 정한다.
    const clash = buildClash(rng, atk, def, ctx);

    push({
      type: 'taunt',
      by: atk.corner,
      tag: clash.tag,
      line: clash.taunt,
      speaker: atk.book.title,
      target: def.book.title,
      rival: clash.isRival,
      hold: readTime(clash.taunt),
    });
    t += readTime(clash.taunt);

    push({
      type: 'reply',
      by: def.corner,
      tag: clash.tag,
      line: clash.reply,
      speaker: def.book.title,
      rebutted: clash.rebutted,
      hold: readTime(clash.reply),
    });
    t += readTime(clash.reply);

    // 논파당하면 공수가 뒤집힌다 — 반박에 성공한 쪽이 때린다
    const win = clash.rebutted ? def : atk;
    const lose = clash.rebutted ? atk : def;
    const move = clash.rebutted ? MOVES.riposte : opener;

    win.st = Math.max(0, win.st - move.cost);
    win.stats.thrown++;
    win.stats.landed++;
    if (clash.rebutted) lose.stats.rebutted++;
    if (move.key === 'heavy' || move.key === 'finisher') win.stats.heavy++;
    if (move.key === 'finisher') win.finisherUsed++;

    // 특성은 실제로 때리는 쪽 기준으로 다시 계산한다
    const wctx = { mult: 1, beat, clock, move, staggered: lose.staggered };
    const traitsA = traitOnAttack(win, lose, move, wctx, rng);
    traitOnDefend(lose, win, wctx, rng);

    // 피해 계산
    const crit = rng.next() < 0.07 + win.style / 100 * 0.17 - lose.chaos / 100 * 0.04;
    const critMult = crit ? 1.5 + win.style / 100 * 0.55 : 1;
    const blockFactor = rng.float(0.55, 1);
    const mitigation = 1 - Math.min(0.44, (lose.legacy / 100) * 0.44 * blockFactor);
    const gassed = win.stPct < 0.22 ? 0.66 : 1;
    const rivalryMult = rivalry && rivalry.favors === win.book.id ? 1 + rivalry.bonus : 1;
    const staggerBonus = lose.staggered ? 1.3 : 1;
    const rivalLine = clash.isRival && !clash.rebutted ? 1.2 : 1;

    let dmg =
      move.power *
      (TUNING.DAMAGE_BASE + (win.logic / 100) * TUNING.DAMAGE_LOGIC) *
      wctx.mult *
      critMult *
      mitigation *
      gassed *
      rivalryMult *
      staggerBonus *
      rivalLine *
      rng.float(0.85, 1.15) *
      TUNING.DAMAGE_SCALE;
    dmg = Math.max(1, Math.round(dmg));

    // 아래 공통 처리는 "때린 쪽 = atk, 맞은 쪽 = def"으로 이어진다
    atk = win;
    def = lose;
    Object.assign(ctx, wctx);

    def.hp -= dmg;
    atk.stats.dmg += dmg;
    if (crit) atk.stats.crit++;
    // 피니시는 설전 대사 대신 그 책의 대표 문장으로 마무리한다 — 클라이맥스니까
    const quote =
      move.key === 'finisher' ? atk.book.quotes.finisher.line : clash.rebutted ? clash.reply : clash.taunt;

    // 돈키호테의 헛돌격은 제 몸이 상한다
    if (wctx.recoil) {
      const self = Math.round(rng.float(3, 7));
      atk.hp -= self;
      push({
        type: 'recoil',
        by: atk.corner,
        dmg: self,
        text: `${atk.name}, 풍차에 걸려 스스로 나가떨어집니다!`,
        hp: { red: A.hp, blue: B.hp },
      });
    }

    // 특성 후처리
    if (ctx.lifesteal) {
      const heal = Math.round(dmg * ctx.lifesteal);
      atk.hp = Math.min(atk.hpMax, atk.hp + heal);
      ctx.healed = heal;
    }
    if (ctx.drain) def.st = Math.max(0, def.st - ctx.drain);
    if (crit && ctx.drainOnCrit) def.st = Math.max(0, def.st - ctx.drainOnCrit);
    if (ctx.applyDot) def.dot = Math.min(TUNING.DOT_CAP, def.dot + ctx.applyDot);

    def.staggered = false;
    // 휘청 / 다운 판정
    const ratio = dmg / def.hpMax;
    let staggered = false;
    let knockdown = false;
    if (def.hp > 0) {
      const resist = (def.grit / 100) * 0.45 * (ctx.staggerResist ? 1 + ctx.staggerResist : 1);
      if (ratio > 0.19 && rng.next() < (ratio - 0.12) * 3.6 - resist) {
        knockdown = true;
        def.knockdowns++;
        def.st = Math.max(0, def.st - 18);
        def.staggered = true;
      } else if (ratio > 0.11 && rng.next() < (ratio - 0.07) * 3.2 - resist * 0.6) {
        staggered = true;
        def.staggered = true;
      }
    }

    push({
      type: 'strike',
      by: atk.corner,
      move: move.key,
      moveLabel: move.label,
      moveKr: move.kr,
      finisherName: move.key === 'finisher' ? atk.book.quotes.finisher.name : null,
      quote,
      source: atk.book.title,
      tag: clash.tag,
      rebuttal: clash.rebutted,
      dmg,
      crit,
      evaded: false,
      staggered,
      knockdown,
      traits: traitsA,
      healed: ctx.healed || 0,
      transform: !!ctx.transformNow,
      hp: { red: A.hp, blue: B.hp },
      st: { red: A.st, blue: B.st },
    });

    if (ctx.transformNow) push({ type: 'commentary', text: CALL.transform(), tone: 'hype' });
    if (move.key === 'finisher')
      push({ type: 'commentary', text: CALL.finisher(atk.name, atk.book.quotes.finisher.name), tone: 'hype' });
    else if (crit) push({ type: 'commentary', text: CALL.bigCrit(atk.name, def.name), tone: 'hype' });
    else if (mitigation < 0.68 && rng.chance(0.4))
      push({ type: 'commentary', text: CALL.block(def.name), tone: 'calm' });

    t += move.key === 'finisher' ? 2.4 : crit ? 2.0 : 1.5;

    if (knockdown && def.hp > 0) {
      push({ type: 'knockdown', who: def.corner, count: def.knockdowns, hp: { red: A.hp, blue: B.hp } });
      push({ type: 'commentary', text: CALL.down(def.name), tone: 'shout' });
      // 다운 모션(약 2.6초)이 끝난 뒤에 리플레이를 건다 — 겹치면 둘 다 죽는다
      t += 3.0;
      push({ type: 'replay', of: 'knockdown', by: atk.corner, quote, source: atk.book.title });
      t += 1.0;
      clock -= rng.float(10, 16);
    } else if (staggered) {
      push({ type: 'stagger', who: def.corner });
      push({ type: 'commentary', text: CALL.stagger(def.name), tone: 'shout' });
      t += 0.8;
    }

    // 지속 피해(불안) 정산
    for (const f of [A, B]) {
      if (f.dot > 0 && f.hp > 0) {
        const d = Math.round(f.dot);
        if (d > 0) {
          f.hp -= d;
          push({
            type: 'dot',
            who: f.corner,
            dmg: d,
            text: `불안이 ${f.name}를 갉아먹습니다 (-${d})`,
            hp: { red: A.hp, blue: B.hp },
          });
        }
        f.dot *= TUNING.DOT_DECAY;
        if (f.dot < 1) f.dot = 0;
      }
    }

    // 스태미나 회복
    A.st = Math.min(A.stMax, A.st + A.d.recover * 1.4);
    B.st = Math.min(B.stMax, B.st + B.d.recover * 1.4);

    // 흐름 자막
    streak = last === atk.corner ? streak + 1 : 1;
    last = atk.corner;
    if (streak === 4) {
      push({ type: 'commentary', text: `${atk.name}가 흐름을 완전히 가져왔습니다.`, tone: 'hype' });
      streak = 0;
    }

    clock -= rng.float(27, 38);
    if (!calledClockLow && clock <= 60 && clock > 0) {
      calledClockLow = true;
      push({ type: 'commentary', text: CALL.clockLow(), tone: 'calm' });
      const behind = A.hpPct < B.hpPct ? A : B;
      push({ type: 'commentary', text: CALL.clutch(behind.name), tone: 'hype' });
      t += 0.6;
    }

    // TKO — 3다운
    if (def.knockdowns >= 3 && def.hp > 0) {
      def.hp = 0;
      finish = { winner: atk.corner, method: 'TKO', detail: '3다운 규정' };
      break;
    }
  }

  // 결과
  const loserByHp = A.hp <= 0 ? A : B.hp <= 0 ? B : null;
  if (!finish && loserByHp) {
    const w = loserByHp === A ? B : A;
    const lastStrike = [...events].reverse().find((e) => e.type === 'strike' && e.by === w.corner && e.dmg > 0);
    finish = {
      winner: w.corner,
      method: lastStrike && lastStrike.move === 'finisher' ? 'KO' : 'KO',
      detail: lastStrike ? `「${lastStrike.quote}」` : '마무리 한 방',
      quote: lastStrike ? lastStrike.quote : null,
    };
  }

  if (finish) {
    clock = Math.max(0, clock);
    t += 0.4;
    push({ type: 'finish', ...finish, hp: { red: A.hp, blue: B.hp } });
    t += 6.5; // KO 후 정적 — 쓰러지는 모션 + 승자 세리머니가 다 나올 시간
  } else {
    // 판정 — 심판 3인. 데미지/유효타/피니시 시도를 섞고 시드로 흔든다.
    t += 0.8;
    push({ type: 'bell', text: '종료 — 판정으로 갑니다' });
    t += 1.6;
    const scoreOf = (f, o) =>
      f.stats.dmg * 1.0 + f.stats.landed * 2.4 + f.stats.crit * 6 + f.stats.heavy * 3 + (f.hp - o.hp) * 0.8;
    const sA = scoreOf(A, B);
    const sB = scoreOf(B, A);
    const cards = [];
    for (let i = 0; i < 3; i++) {
      const bias = rng.float(-0.14, 0.14) * (sA + sB); // 심판마다 보는 눈이 다르다
      const dA = sA + bias;
      const dB = sB - bias;
      const gap = Math.abs(dA - dB) / Math.max(1, (dA + dB) / 2);
      const dominant = gap > 0.42 || A.knockdowns + B.knockdowns > 0;
      const win = dA >= dB ? 'red' : 'blue';
      cards.push({
        judge: ['서울', '뉴욕', '런던'][i],
        red: win === 'red' ? 10 : dominant ? 8 : 9,
        blue: win === 'blue' ? 10 : dominant ? 8 : 9,
      });
    }
    const redCards = cards.filter((c) => c.red > c.blue).length;
    const winner = redCards >= 2 ? 'red' : 'blue';
    const unanimous = redCards === 3 || redCards === 0;
    push({
      type: 'decision',
      winner,
      cards,
      method: unanimous ? '만장일치 판정' : '스플릿 판정',
      hp: { red: A.hp, blue: B.hp },
    });
    finish = { winner, method: unanimous ? '만장일치 판정' : '스플릿 판정', detail: '5분 풀타임' };
    t += 5;
  }

  push({ type: 'end' });

  return {
    seed: String(seed),
    a: bookA,
    b: bookB,
    fighters: {
      red: summarize(A),
      blue: summarize(B),
    },
    rivalry,
    result: finish,
    events,
    duration: t,
  };
}

function summarize(f) {
  return {
    id: f.book.id,
    title: f.book.title,
    corner: f.corner,
    hpMax: f.hpMax,
    hpEnd: Math.max(0, Math.round(f.hp)),
    stMax: f.stMax,
    cond: +(f.cond || 1).toFixed(3),
    knockdowns: f.knockdowns,
    transformed: f.transformed,
    stats: f.stats,
    derived: f.d,
  };
}

// 시드가 정말 승부를 가르는지 확인용 — 콘솔에서 부를 수 있게 열어둔다.
export function seedSweep(bookA, bookB, count = 60) {
  let red = 0;
  const rows = [];
  for (let i = 0; i < count; i++) {
    const s = String(100000 + i);
    const m = simulate(bookA, bookB, s);
    if (m.result.winner === 'red') red++;
    rows.push(`${s} → ${m.result.winner === 'red' ? bookA.title : bookB.title} (${m.result.method})`);
  }
  return { redWinRate: red / count, rows };
}
