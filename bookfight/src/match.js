// 경기 시뮬레이션 — 시드를 넣으면 45초 경기 전체가 이벤트 타임라인으로 나온다.
// 3D/연출은 이 타임라인을 "재생"만 한다. 같은 시드는 언제나 같은 경기다.
//
// 45초 초단판. 경기 시계 = 재생 시간(1:1) — 시계가 0이 되는 순간 실제로 종이 울린다.
// 구조는 3막이고, 설전은 3합짜리 하나의 논쟁으로 이어진다:
//
//   오프닝 러시(펀치) → 1합 탐색 → 펀치 → 2합 되받기(1합을 문다) → 펀치
//     → 결정타(3합 — 처음 들었던 말을 콜백) → 잔여 난타 → 종 → KO 또는 채점
//
// 다운 2회면 그대로 TKO — 45초 경기에 3다운까지 갈 시간은 없다.

import { Rng } from './rng.js';
import { rivalryFor } from './books.js';
import { buildClash, readTime } from './taunts.js';
import {
  Boxer, VERBAL, BOXING_TUNING, initiative, choosePunch, resolvePunch, checkStagger, recover,
} from './boxing.js';

export const ROUND_SECONDS = 45;

export const TUNING = {
  INITIATIVE_DIV: 620, // 작을수록 얇은 책(기동)이 유리
  DAMAGE_BASE: 0.5, // 논지 0일 때의 타격 계수
  DAMAGE_LOGIC: 0.72, // 논지 100일 때 더해지는 계수
  DAMAGE_SCALE: 0.75, // 설전 치명타 화력. HP70/권투0.5와 함께 KO 85% · 스프레드 23pt · 평균 44.8초.
  DOT_PER_HIT: 1.6,
  DOT_CAP: 5.5,
  DOT_DECAY: 0.7,
  CHARGE_RECOIL: 0.45,
  UPSET_RIPOSTE: 1.35, // 결정타를 논파당했을 때 약자 반격 배율 — 대반전은 아파야 한다
};

// ── 저자 특성 훅 ─────────────────────────────────────────────
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
    case 'charge': // 돈키호테 — 크게 터지거나 크게 헛돈다
      ctx.mult *= rng.float(0.65, 1.95);
      ctx.recoil = rng.chance(TUNING.CHARGE_RECOIL);
      fired.push(t.name);
      break;
    case 'evolve': // 종의 기원 — 경기가 흐를수록 자란다
      ctx.mult *= 1 + Math.min(0.5, ((ROUND_SECONDS - ctx.clock) / ROUND_SECONDS) * 0.55);
      if (ctx.clock < ROUND_SECONDS * 0.5) fired.push(t.name);
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
    case 'dot': // 변신 — 불안을 남긴다
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
  return fired;
}

function traitOnDefend(def, atk, ctx) {
  const t = def.book.authorTrait;
  const fired = [];
  switch (t.kind) {
    case 'foxlion': // 군주론 — 피니셔 반감
      if (ctx.move.key === 'finisher') {
        ctx.mult *= 0.5;
        fired.push(t.name);
      }
      break;
    case 'poise': // 오만과 편견 — 크리티컬을 맞아도 흔들리지 않는다
      ctx.staggerResist = 0.5;
      break;
    // counter/evade는 논파 확률로 흡수됐다(taunts.js buildClash)
  }
  return fired;
}

// ── 해설 ─────────────────────────────────────────────────────
const CALL = {
  bigCrit: (a, d) => `${a} 제대로 꽂혔습니다! ${d} 완전히 굳었어요!`,
  down: (d) => `다운! ${d}가 펼쳐진 채로 매트에 엎어졌습니다!`,
  finisher: (a, n) => `${a}, 대표 문장이 나옵니다 — 「${n}」!`,
  transform: () => `변했습니다! 지킬이 사라지고 하이드가 섰습니다!`,
};

// ── 본체 ─────────────────────────────────────────────────────
export function simulate(bookA, bookB, seed) {
  const rng = new Rng(seed);
  const A = new Boxer(bookA, 'red');
  const B = new Boxer(bookB, 'blue');
  A.usedLines = new Set();
  B.usedLines = new Set();
  const byCorner = { red: A, blue: B };
  const rivalry = rivalryFor(bookA.id, bookB.id);

  const events = [];
  let t = 0;
  const push = (e) => events.push({ t: +t.toFixed(2), clock: Math.max(0, Math.round(ROUND_SECONDS - t)), ...e });

  // 시드 컨디션 — 같은 대진도 시드마다 몸 상태가 다르다
  const condA = rng.float(0.9, 1.1);
  const condB = rng.float(0.9, 1.1);
  A.logic = Math.round(A.logic * condA);
  B.logic = Math.round(B.logic * condB);
  A.cond = condA;
  B.cond = condB;

  push({ type: 'intro', a: A.book.id, b: B.book.id, seed: String(seed) });
  if (rivalry) push({ type: 'commentary', text: `오늘의 관전 포인트 — ${rivalry.why}.`, tone: 'hype' });
  t += 0.2;
  push({ type: 'bell', text: '45초 단판 — 시작' });
  t += 1.1;

  const thread = { clashes: [] };
  let finish = null;

  // ── 펀치 러시 — 경기의 기본 박자. 한 방에 0.4~0.65초. ──
  const burstUntil = (target) => {
    while (t < target) {
      if (!A.alive || !B.alive || t >= ROUND_SECONDS - 0.7) return;
      const atk = initiative(A, B, rng, TUNING.INITIATIVE_DIV) ? A : B;
      const def = atk === A ? B : A;
      const punch = choosePunch(atk, def, rng);
      const r = resolvePunch(atk, def, punch, rng);
      const st = r.result === 'hit' ? checkStagger(def, r.dmg, rng) : { staggered: false, knockdown: false };
      push({
        type: 'punch', by: atk.corner, punch: punch.key, punchLabel: punch.label,
        result: r.result, dmg: r.dmg, crit: !!r.crit,
        staggered: st.staggered && !st.knockdown, knockdown: st.knockdown,
        hp: { red: A.hp, blue: B.hp }, st: { red: A.st, blue: B.st },
      });
      t += rng.float(BOXING_TUNING.PUNCH_SECONDS[0], BOXING_TUNING.PUNCH_SECONDS[1]);
      recover(A, A.d.recover * 0.35);
      recover(B, B.d.recover * 0.35);
      if (st.knockdown && def.hp > 0) {
        push({ type: 'knockdown', who: def.corner, count: def.knockdowns, hp: { red: A.hp, blue: B.hp } });
        push({ type: 'commentary', text: CALL.down(def.name), tone: 'shout' });
        t += 2.4;
        if (def.knockdowns >= 2) {
          def.hp = 0;
          finish = { winner: atk.corner, method: 'TKO', detail: '2다운 — 45초 룰' };
          return;
        }
      }
    }
  };

  // ── 설전 한 합 — 이어지는 논쟁. 3합은 콜백 결정타. ──
  const clashRound = () => {
    const round = thread.clashes.length + 1;
    let atk;
    if (round === 1) atk = initiative(A, B, rng, TUNING.INITIATIVE_DIV) ? A : B;
    else if (round === 2) atk = byCorner[thread.clashes[0].defCorner]; // 1합의 수비수가 되받는다
    else atk = A.hpPct >= B.hpPct ? A : B; // 앞서는 쪽이 끝을 낸다
    const def = atk === A ? B : A;

    const clash = buildClash(rng, atk, def, { staggered: def.staggered }, thread);
    thread.clashes.push({ tag: clash.tag, atkCorner: atk.corner, defCorner: def.corner, rebutted: clash.rebutted });

    push({
      type: 'taunt', by: atk.corner, round, link: clash.link, tag: clash.tag,
      line: clash.taunt, speaker: atk.book.title, target: def.book.title,
      rival: clash.isRival, hold: readTime(clash.taunt),
    });
    t += readTime(clash.taunt);

    push({
      type: 'reply', by: def.corner, round, tag: clash.tag, line: clash.reply,
      speaker: def.book.title, rebutted: clash.rebutted,
      laststand: !!clash.decisive && !clash.rebutted, hold: readTime(clash.reply),
    });
    t += readTime(clash.reply);

    // 논파하면 공수가 뒤집힌다. 결정타를 뒤집으면 대반전 — 약자의 반격이 크게 들어간다.
    const win = clash.rebutted ? def : atk;
    const lose = clash.rebutted ? atk : def;
    if (clash.rebutted) lose.stats.rebutted++;
    win.stats.verbal++;

    const move = clash.rebutted ? VERBAL.riposte : clash.decisive ? VERBAL.finisher : VERBAL.win;
    win.st = Math.max(0, win.st - move.cost);

    const wctx = { mult: 1, clock: ROUND_SECONDS - t, move, staggered: lose.staggered };
    const traits = traitOnAttack(win, lose, move, wctx, rng);
    traitOnDefend(lose, win, wctx);
    if (clash.decisive && clash.rebutted) wctx.mult *= TUNING.UPSET_RIPOSTE;

    const crit = rng.next() < 0.12 + (win.style / 100) * 0.2;
    const critMult = crit ? 1.5 + (win.style / 100) * 0.5 : 1;
    const mitigation = 1 - Math.min(0.4, (lose.legacy / 100) * 0.4 * rng.float(0.55, 1));
    const rivalryMult = rivalry && rivalry.favors === win.book.id ? 1 + rivalry.bonus : 1;
    const rivalLine = clash.isRival && !clash.rebutted ? 1.2 : 1;

    let dmg =
      move.power *
      (TUNING.DAMAGE_BASE + (win.logic / 100) * TUNING.DAMAGE_LOGIC) *
      wctx.mult * critMult * mitigation * rivalryMult * rivalLine *
      (lose.staggered ? 1.25 : 1) *
      rng.float(0.85, 1.15) * TUNING.DAMAGE_SCALE;
    dmg = Math.max(1, Math.round(dmg));

    if (wctx.lifesteal) {
      const heal = Math.round(dmg * wctx.lifesteal);
      win.hp = Math.min(win.hpMax, win.hp + heal);
      wctx.healed = heal;
    }
    if (wctx.drain) lose.st = Math.max(0, lose.st - wctx.drain);
    if (crit && wctx.drainOnCrit) lose.st = Math.max(0, lose.st - wctx.drainOnCrit);
    if (wctx.applyDot) lose.dot = Math.min(TUNING.DOT_CAP, (lose.dot || 0) + wctx.applyDot);

    lose.hp -= dmg;
    win.stats.dmg += dmg;
    if (crit) win.stats.crit++;
    const st = checkStagger(lose, dmg, rng, wctx.staggerResist || 0);

    const quote = move.key === 'finisher' ? win.book.quotes.finisher.line : clash.rebutted ? clash.reply : clash.taunt;
    push({
      type: 'strike', by: win.corner, move: move.key, moveLabel: move.label, moveKr: move.kr,
      finisherName: move.key === 'finisher' ? win.book.quotes.finisher.name : null,
      quote, source: win.book.title, tag: clash.tag, rebuttal: clash.rebutted,
      dmg, crit, evaded: false, staggered: st.staggered && !st.knockdown, knockdown: st.knockdown,
      traits, healed: wctx.healed || 0, transform: !!wctx.transformNow,
      hp: { red: A.hp, blue: B.hp }, st: { red: A.st, blue: B.st },
    });

    // 스레드 해설 — 앞 합과의 관계를 짚는다
    if (wctx.transformNow) push({ type: 'commentary', text: CALL.transform(), tone: 'hype' });
    else if (clash.decisive && clash.rebutted) push({ type: 'commentary', text: `대반전! ${win.name}가 마지막 문장을 뒤집었습니다!`, tone: 'shout' });
    else if (clash.decisive) push({ type: 'commentary', text: `${win.name}, 처음 들었던 말을 그대로 돌려줍니다! 승부가 기울었어요!`, tone: 'hype' });
    else if (round === 2 && clash.link === 'comeback' && !clash.rebutted) push({ type: 'commentary', text: `${win.name}, 1합의 빚을 그대로 갚습니다!`, tone: 'hype' });
    else if (clash.rebutted) push({ type: 'commentary', text: `${win.name}, 되받아칩니다! ${lose.name}의 논지가 무너졌어요!`, tone: 'hype' });
    else if (crit) push({ type: 'commentary', text: CALL.bigCrit(win.name, lose.name), tone: 'hype' });

    t += clash.decisive ? 2.0 : 1.4;

    if (wctx.recoil) {
      const self = Math.round(rng.float(3, 7));
      win.hp -= self;
      push({ type: 'recoil', by: win.corner, dmg: self, text: `${win.name}, 풍차에 걸려 스스로 나가떨어집니다!`, hp: { red: A.hp, blue: B.hp } });
      t += 0.8;
    }

    if (st.knockdown && lose.hp > 0) {
      push({ type: 'knockdown', who: lose.corner, count: lose.knockdowns, hp: { red: A.hp, blue: B.hp } });
      push({ type: 'commentary', text: CALL.down(lose.name), tone: 'shout' });
      t += 2.6;
      if (lose.knockdowns >= 2) {
        lose.hp = 0;
        finish = { winner: win.corner, method: 'TKO', detail: '2다운 — 45초 룰' };
        return;
      }
    } else if (st.staggered) {
      push({ type: 'stagger', who: lose.corner });
      t += 0.6;
    }

    // 불안(카프카) 정산
    for (const f of [A, B]) {
      if (f.dot > 0 && f.hp > 0) {
        const d = Math.round(f.dot);
        if (d > 0) {
          f.hp -= d;
          push({ type: 'dot', who: f.corner, dmg: d, text: `불안이 ${f.name}를 갉아먹습니다 (-${d})`, hp: { red: A.hp, blue: B.hp } });
        }
        f.dot *= TUNING.DOT_DECAY;
        if (f.dot < 1) f.dot = 0;
      }
    }
    recover(A, A.d.recover);
    recover(B, B.d.recover);
  };

  // ── 3막 진행 ── 시간표는 t 기준. 시계가 곧 재생 시간이다.
  burstUntil(4.5);
  if (!finish && A.alive && B.alive) clashRound(); // 1합 — 탐색
  if (!finish && A.alive && B.alive) burstUntil(17);
  if (!finish && A.alive && B.alive) clashRound(); // 2합 — 되받기
  if (!finish && A.alive && B.alive) burstUntil(31);
  if (!finish && A.alive && B.alive && t < ROUND_SECONDS - 9) {
    push({ type: 'final' }); // 감독이 여기서 텐션 컷을 잡는다
    t += 2.2;
    clashRound(); // 3합 — 콜백 결정타
  }
  if (!finish && A.alive && B.alive) burstUntil(ROUND_SECONDS - 1); // 잔여 난타

  // ── 결말 ──
  const loserByHp = A.hp <= 0 ? A : B.hp <= 0 ? B : null;
  if (!finish && loserByHp) {
    const w = loserByHp === A ? B : A;
    const last = [...events].reverse().find((e) => (e.type === 'strike' || e.type === 'punch') && e.by === w.corner && e.dmg > 0);
    finish = {
      winner: w.corner, method: 'KO',
      detail: last && last.quote ? `「${last.quote}」` : last ? `${last.punchLabel || last.moveLabel} 한 방` : '마무리 한 방',
      quote: last ? last.quote : null,
    };
  }

  if (finish) {
    t += 0.4;
    push({ type: 'finish', ...finish, hp: { red: A.hp, blue: B.hp } });
    t += 6.0;
  } else {
    t = Math.max(t, ROUND_SECONDS);
    push({ type: 'bell', text: '종료 — 채점으로' });
    t += 1.4;
    const scoreOf = (f, o) => f.stats.dmg * 1.0 + f.stats.landed * 1.2 + f.stats.verbal * 8 + f.stats.crit * 5 + (f.hp - o.hp) * 0.8;
    const sA = scoreOf(A, B);
    const sB = scoreOf(B, A);
    const cards = [];
    for (let i = 0; i < 3; i++) {
      const bias = rng.float(-0.14, 0.14) * (sA + sB);
      const dA = sA + bias;
      const dB = sB - bias;
      const gap = Math.abs(dA - dB) / Math.max(1, (dA + dB) / 2);
      const dominant = gap > 0.42 || A.knockdowns + B.knockdowns > 0;
      const winC = dA >= dB ? 'red' : 'blue';
      cards.push({ judge: ['서울', '뉴욕', '런던'][i], red: winC === 'red' ? 10 : dominant ? 8 : 9, blue: winC === 'blue' ? 10 : dominant ? 8 : 9 });
    }
    const redCards = cards.filter((c) => c.red > c.blue).length;
    const winner = redCards >= 2 ? 'red' : 'blue';
    const unanimous = redCards === 3 || redCards === 0;
    push({ type: 'decision', winner, cards, method: unanimous ? '만장일치 판정' : '스플릿 판정', hp: { red: A.hp, blue: B.hp } });
    finish = { winner, method: unanimous ? '만장일치 판정' : '스플릿 판정', detail: '45초 풀타임' };
    t += 4.5;
  }

  push({ type: 'end' });

  return {
    seed: String(seed),
    a: bookA,
    b: bookB,
    fighters: { red: summarize(A), blue: summarize(B) },
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
    transformed: !!f.transformed,
    stats: f.stats,
    derived: f.d,
  };
}

// 콘솔 확인용 — 시드가 정말 승부를 가르는지
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
