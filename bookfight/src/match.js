// 경기 시뮬레이션 — 시드를 넣으면 경기 전체가 이벤트 타임라인으로 한 번에 나온다.
// 3D/연출은 이 타임라인을 "재생"만 한다. 그래서 리플레이·되감기·시드 공유가 전부 공짜로 된다.
//
// 단판 1라운드. 5분 안에 KO/TKO가 안 나면 심판 3인 판정으로 끝난다.

import { Rng } from './rng.js';
import { rivalryFor } from './books.js';
import { buildClash, readTime } from './taunts.js';
import { Boxer, PUNCHES, VERBAL, BOXING_TUNING, initiative, choosePunch, resolvePunch, checkStagger, recover } from './boxing.js';

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
  DAMAGE_SCALE: 0.6, // 설전 치명타의 화력(권투 쪽은 boxing.js가 따로 쥔다).
  // 0.55/0.6 조합에서 KO 57% · 승률 스프레드 26pt · 권투가 전체 피해의 41%.
  DOT_PER_HIT: 1.6, // 불안 누적량. 감쇠가 0.7이라 최대 체감치는 이 값의 약 3배.
  DOT_CAP: 5.5,
  DOT_DECAY: 0.7,
  CHARGE_RECOIL: 0.45, // 풍차 돌격이 빗나갔을 때 자해가 일어날 확률
};

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
// 두 층을 엮는다.
//   권투층(boxing.js) — 쉬지 않고 짧게 오간다. 잽·보디·훅.
//   설전층(taunts.js)  — 콤비네이션 사이에 끼어들어 치명타를 만든다.
// 말하는 동안 주먹이 멈추면 리듬이 죽으므로, 설전은 '가끔 터지는 큰 사건'으로만 쓴다.
export function simulate(bookA, bookB, seed) {
  const rng = new Rng(seed);
  const A = new Boxer(bookA, 'red');
  const B = new Boxer(bookB, 'blue');
  A.usedLines = new Set();
  B.usedLines = new Set();
  const rivalry = rivalryFor(bookA.id, bookB.id);

  const events = [];
  let t = 0;
  let clock = ROUND_SECONDS;
  const push = (e) => events.push({ t: +t.toFixed(2), clock: Math.max(0, Math.round(clock)), ...e });

  const condA = rng.float(0.9, 1.1);
  const condB = rng.float(0.9, 1.1);
  A.logic = Math.round(A.logic * condA);
  B.logic = Math.round(B.logic * condB);
  A.cond = condA;
  B.cond = condB;

  push({ type: 'intro', a: A.book.id, b: B.book.id, seed: String(seed) });
  if (rivalry) push({ type: 'commentary', text: `오늘의 관전 포인트 — ${rivalry.why}.`, tone: 'hype' });
  t += 0.2;
  push({ type: 'bell', text: '1라운드, 단판 승부' });
  t += 1.1;

  let finish = null;
  let calledClockLow = false;
  let beat = 0;
  let guard = 0;

  const applyBlow = (win, lose, dmg, meta) => {
    lose.hp -= dmg;
    win.stats.dmg += dmg;
    const st = checkStagger(lose, dmg, rng, meta.staggerResist || 0);
    push({
      type: 'strike',
      by: win.corner,
      move: meta.move,
      moveLabel: meta.label,
      moveKr: meta.kr,
      finisherName: meta.finisherName || null,
      quote: meta.quote,
      source: win.book.title,
      tag: meta.tag,
      rebuttal: !!meta.rebuttal,
      dmg,
      crit: !!meta.crit,
      evaded: false,
      staggered: st.staggered && !st.knockdown,
      knockdown: st.knockdown,
      traits: meta.traits || [],
      healed: meta.healed || 0,
      transform: !!meta.transform,
      hp: { red: A.hp, blue: B.hp },
      st: { red: A.st, blue: B.st },
    });
    return st;
  };

  while (clock > 0 && A.alive && B.alive && beat < 90) {
    beat++;

    // ── 1) 권투 콤비네이션 — 여기가 경기의 기본 박자 ──
    const combo = rng.int(BOXING_TUNING.COMBO_MIN, BOXING_TUNING.COMBO_MAX);
    for (let i = 0; i < combo && clock > 0 && A.alive && B.alive; i++) {
      const atk = initiative(A, B, rng, TUNING.INITIATIVE_DIV) ? A : B;
      const def = atk === A ? B : A;
      const punch = choosePunch(atk, def, rng);
      const r = resolvePunch(atk, def, punch, rng);
      const st = r.result === 'hit' ? checkStagger(def, r.dmg, rng) : { staggered: false, knockdown: false };
      push({
        type: 'punch',
        by: atk.corner,
        punch: punch.key,
        punchLabel: punch.label,
        result: r.result,
        dmg: r.dmg,
        crit: !!r.crit,
        staggered: st.staggered && !st.knockdown,
        knockdown: st.knockdown,
        hp: { red: A.hp, blue: B.hp },
        st: { red: A.st, blue: B.st },
      });
      t += rng.float(BOXING_TUNING.PUNCH_SECONDS[0], BOXING_TUNING.PUNCH_SECONDS[1]);
      clock -= rng.float(BOXING_TUNING.PUNCH_CLOCK[0], BOXING_TUNING.PUNCH_CLOCK[1]);
      recover(A, A.d.recover * 0.5);
      recover(B, B.d.recover * 0.5);
      if (st.knockdown && def.hp > 0) {
        push({ type: 'knockdown', who: def.corner, count: def.knockdowns, hp: { red: A.hp, blue: B.hp } });
        push({ type: 'commentary', text: CALL.down(def.name), tone: 'shout' });
        t += 2.6;
        clock -= rng.float(8, 14);
      }
    }
    if (!A.alive || !B.alive || clock <= 0) break;

    // ── 2) 설전 — 콤비네이션 사이에 끼어들어 치명타를 만든다 ──
    guard++;
    if (guard < 1) continue;
    guard = 0;

    const atk = initiative(A, B, rng, TUNING.INITIATIVE_DIV) ? A : B;
    const def = atk === A ? B : A;
    const ctx = { mult: 1, beat, clock, move: null, staggered: def.staggered };
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
    clock -= rng.float(4, 7);

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
    clock -= rng.float(4, 7);

    // 논파당하면 공수가 뒤집힌다 — 반박에 성공한 쪽이 꽂는다
    const win = clash.rebutted ? def : atk;
    const lose = clash.rebutted ? atk : def;
    if (clash.rebutted) lose.stats.rebutted++;
    win.stats.verbal++;

    const canFinish = win.st >= VERBAL.finisher.cost && (win.finisherUsed || 0) < 2 && (lose.hpPct < 0.4 || lose.groggy || clock < 50);
    const move = clash.rebutted ? VERBAL.riposte : canFinish && rng.chance(0.5) ? VERBAL.finisher : VERBAL.win;
    if (move.key === 'finisher') win.finisherUsed = (win.finisherUsed || 0) + 1;
    win.st = Math.max(0, win.st - move.cost);

    const wctx = { mult: 1, beat, clock, move, staggered: lose.staggered };
    const traits = traitOnAttack(win, lose, move, wctx, rng);
    traitOnDefend(lose, win, wctx, rng);

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

    const quote = move.key === 'finisher' ? win.book.quotes.finisher.line : clash.rebutted ? clash.reply : clash.taunt;
    const st = applyBlow(win, lose, dmg, {
      move: move.key, label: move.label, kr: move.kr, quote, tag: clash.tag,
      rebuttal: clash.rebutted, crit, traits,
      finisherName: move.key === 'finisher' ? win.book.quotes.finisher.name : null,
      healed: wctx.healed, transform: wctx.transformNow, staggerResist: wctx.staggerResist,
    });

    if (wctx.transformNow) push({ type: 'commentary', text: CALL.transform(), tone: 'hype' });
    else if (move.key === 'finisher') push({ type: 'commentary', text: CALL.finisher(win.name, win.book.quotes.finisher.name), tone: 'hype' });
    else if (clash.rebutted) push({ type: 'commentary', text: `${win.name}, 되받아칩니다! ${lose.name}의 논지가 무너졌어요!`, tone: 'hype' });
    else if (crit) push({ type: 'commentary', text: CALL.bigCrit(win.name, lose.name), tone: 'hype' });

    t += move.key === 'finisher' ? 2.4 : 1.6;
    clock -= rng.float(6, 10);

    if (st.knockdown && lose.hp > 0) {
      push({ type: 'knockdown', who: lose.corner, count: lose.knockdowns, hp: { red: A.hp, blue: B.hp } });
      push({ type: 'commentary', text: CALL.down(lose.name), tone: 'shout' });
      t += 3.0;
      push({ type: 'replay', of: 'knockdown', by: win.corner, quote, source: win.book.title });
      t += 1.0;
      clock -= rng.float(10, 16);
    } else if (st.staggered) {
      push({ type: 'stagger', who: lose.corner });
      push({ type: 'commentary', text: CALL.stagger(lose.name), tone: 'shout' });
      t += 0.8;
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

    if (!calledClockLow && clock <= 60 && clock > 0) {
      calledClockLow = true;
      push({ type: 'commentary', text: CALL.clockLow(), tone: 'calm' });
      push({ type: 'commentary', text: CALL.clutch((A.hpPct < B.hpPct ? A : B).name), tone: 'hype' });
      t += 0.6;
    }
    if (lose.knockdowns >= 3 && lose.hp > 0) {
      lose.hp = 0;
      finish = { winner: win.corner, method: 'TKO', detail: '3다운 규정' };
      break;
    }
  }

  const loserByHp = A.hp <= 0 ? A : B.hp <= 0 ? B : null;
  if (!finish && loserByHp) {
    const w = loserByHp === A ? B : A;
    const last = [...events].reverse().find((e) => (e.type === 'strike' || e.type === 'punch') && e.by === w.corner && e.dmg > 0);
    finish = {
      winner: w.corner,
      method: 'KO',
      detail: last && last.quote ? `「${last.quote}」` : last ? `${last.punchLabel || last.moveLabel} 한 방` : '마무리 한 방',
      quote: last ? last.quote : null,
    };
  }

  if (finish) {
    clock = Math.max(0, clock);
    t += 0.4;
    push({ type: 'finish', ...finish, hp: { red: A.hp, blue: B.hp } });
    t += 6.5;
  } else {
    t += 0.8;
    push({ type: 'bell', text: '종료 — 판정으로 갑니다' });
    t += 1.6;
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
      const win = dA >= dB ? 'red' : 'blue';
      cards.push({ judge: ['서울', '뉴욕', '런던'][i], red: win === 'red' ? 10 : dominant ? 8 : 9, blue: win === 'blue' ? 10 : dominant ? 8 : 9 });
    }
    const redCards = cards.filter((c) => c.red > c.blue).length;
    const winner = redCards >= 2 ? 'red' : 'blue';
    const unanimous = redCards === 3 || redCards === 0;
    push({ type: 'decision', winner, cards, method: unanimous ? '만장일치 판정' : '스플릿 판정', hp: { red: A.hp, blue: B.hp } });
    finish = { winner, method: unanimous ? '만장일치 판정' : '스플릿 판정', detail: '5분 풀타임' };
    t += 5;
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
