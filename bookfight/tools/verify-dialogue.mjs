// 검증 1 — 대화와 논파가 제대로 이뤄지는가. 스크립트 레벨만 본다(3D·브라우저 없음).
//
//   node bookfight/tools/verify-dialogue.mjs [샘플수]
//
// 보는 것:
//   구조   도발과 반박이 같은 주제(태그)로 맞물리는가
//   문장   슬롯이 남아 있지 않은가, 한국어 조사가 맞는가, 한 경기에서 같은 말을 반복하지 않는가
//   판정   논파율이 한쪽으로 쏠리지 않는가
//   범위   16권 전부, 태그 10종 전부가 실제로 쓰이는가
//   확장   전용 대사가 한 줄도 없는 낯선 책도 성립하는가 (검색으로 긁어올 책들)

import { BOOKS, getBook } from '../src/books.js';
import { simulate } from '../src/match.js';
import { TAGS, TAG_QUOTE, deriveTags, readTime } from '../src/taunts.js';
import { Rng } from '../src/rng.js';

const N = Number(process.argv[2] || 240);
const fails = [];
const warn = (cond, msg) => { if (!cond) fails.push(msg); };

// ── 한국어 조사 검사 ───────────────────────────────────────
// 「제목」 뒤에 붙은 은/는·이/가·을/를이 앞말 받침과 맞는지 본다.
const RIGHT = { 은: 1, 는: 0, 이: 1, 가: 0, 을: 1, 를: 0 }; // 1 = 받침 있는 말 뒤
function hasJong(ch) {
  if (!ch) return null;
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0 ? 1 : 0;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch) ? 1 : 0;
  return null; // 한자·영문은 판정하지 않는다
}
function josaErrors(line) {
  const out = [];
  for (const m of line.matchAll(/「([^」]+)」\s?(은|는|이|가|을|를)/g)) {
    const need = hasJong(m[1][m[1].length - 1]);
    if (need === null) continue;
    if (RIGHT[m[2]] !== need) out.push(`${m[0]}  (「${m[1]}」 뒤에는 '${need ? Object.keys(RIGHT).find((k) => RIGHT[k] === 1 && '은이을'.includes(k) && '은는'.includes(m[2]) ? k : null) || '' : ''}')`);
  }
  return out;
}

// ── 본 검사 ────────────────────────────────────────────────
const seenSpeakers = new Set();
const seenTags = new Set();
const tagPairs = { ok: 0, bad: 0 };
let rebutted = 0;
let clashes = 0;
let dupTotal = 0;
let matchesWithDup = 0;
const placeholders = [];
const josaBad = [];
const perBookRebut = new Map(BOOKS.map((b) => [b.id, { def: 0, win: 0 }]));
const readTimes = [];
// 스레드(이어지는 논쟁) 검사
let link2ok = 0, link2bad = 0, cb_ok = 0, cb_bad = 0, over45 = 0, durMax = 0;
let sampleThread = null;

for (let i = 0; i < N; i++) {
  const rng = new Rng('pick' + i);
  const a = rng.pick(BOOKS);
  let b = rng.pick(BOOKS);
  while (b.id === a.id) b = rng.pick(BOOKS);
  const m = simulate(a, b, 'V' + (1000 + i * 7));
  if (m.duration > 52) over45++;
  if (m.duration > durMax) durMax = m.duration;

  // 스레드: 2합은 접속구(link)로 1합을 물고, 3합은 앞서 들었던 태그를 인용해야 한다
  const taunts = m.events.filter((e) => e.type === 'taunt');
  if (taunts[1]) {
    if (taunts[1].link === 'press' || taunts[1].link === 'comeback') link2ok++; else link2bad++;
  }
  if (taunts[2]) {
    const q = TAG_QUOTE[taunts[2].tag];
    if (taunts[2].link === 'callback' && q && taunts[2].line.includes(q)) cb_ok++; else cb_bad++;
  }
  if (!sampleThread && taunts.length === 3) sampleThread = m;

  const lines = [];
  let pendingTaunt = null;
  for (const e of m.events) {
    if (e.type === 'taunt') {
      pendingTaunt = e;
      seenSpeakers.add(e.speaker);
      seenTags.add(e.tag);
      lines.push(e.line);
      readTimes.push(readTime(e.line));
    } else if (e.type === 'reply') {
      clashes++;
      lines.push(e.line);
      readTimes.push(readTime(e.line));
      // 구조: 도발과 반박은 같은 태그를 놓고 붙어야 한다
      if (pendingTaunt && pendingTaunt.tag === e.tag) tagPairs.ok++;
      else tagPairs.bad++;
      if (e.rebutted) rebutted++;
      const defender = e.speaker === a.title ? a : b;
      const rec = perBookRebut.get(defender.id);
      if (rec) { rec.def++; if (e.rebutted) rec.win++; }
      pendingTaunt = null;
    }
  }

  for (const l of lines) {
    if (/\{[^}]*\}/.test(l)) placeholders.push(l);
    const je = josaErrors(l);
    if (je.length) josaBad.push(...je);
  }
  const counts = new Map();
  for (const l of lines) counts.set(l, (counts.get(l) || 0) + 1);
  const dups = [...counts.values()].filter((v) => v > 1).length;
  if (dups) { matchesWithDup++; dupTotal += dups; }
}

// ── 낯선 책 — 전용 대사 0줄로도 성립해야 한다 ───────────────
const STRANGER = {
  id: 'stranger', title: '데미안', titleOrig: 'Demian', author: '헤르만 헤세', authorOrig: 'Hermann Hesse',
  year: 1919, pages: 176, nation: '🇩🇪', genre: '성장 소설', nickname: '알을 깨는 자',
  cover: { bg: '#2a3340', fg: '#eee', accent: '#c8a25c', motif: 'seal', style: 'modern' },
  stats: { logic: 74, style: 82, legacy: 78, chaos: 70, grit: 68 }, traits: ['자아', '상징'],
  authorTrait: { name: '알을 깨다', desc: '', kind: 'comeback' },
  quotes: { jab: ['새는 알에서 나오려고 투쟁한다.'], heavy: ['알은 세계다.'], finisher: { name: '아프락사스', line: '새는 신에게로 날아간다. 그 신의 이름은 아프락사스다.' } },
};
const strangerTags = deriveTags(STRANGER);
const sm = simulate(STRANGER, getBook('mobydick'), 'STRANGER1');
const strangerLines = sm.events.filter((e) => e.type === 'taunt' || e.type === 'reply');
const strangerBad = strangerLines.filter((e) => /\{[^}]*\}/.test(e.line));

// 낯선 책이 실제로 상대를 찌르기도 하고 스스로 변호도 하는지
const strangerSpoke = strangerLines.some((e) => e.speaker === STRANGER.title);

// ── 결과 ───────────────────────────────────────────────────
const pct = (x) => (x * 100).toFixed(1) + '%';
console.log('═══ 검증 1 · 대화와 논파 ═══');
console.log(`표본: ${N}경기, 설전 ${clashes}합, 대사 ${clashes * 2}줄\n`);

console.log('[구조] 도발과 반박이 같은 주제로 맞물리는가');
console.log(`   일치 ${tagPairs.ok} / 불일치 ${tagPairs.bad}  → ${pct(tagPairs.ok / (tagPairs.ok + tagPairs.bad))}`);
warn(tagPairs.bad === 0, `도발/반박 태그 불일치 ${tagPairs.bad}건`);

console.log('\n[문장]');
console.log(`   미치환 슬롯: ${placeholders.length}건 ${placeholders.length ? '← ' + placeholders[0] : ''}`);
console.log(`   조사 오류  : ${josaBad.length}건 ${josaBad.length ? '← ' + josaBad[0] : ''}`);
console.log(`   대사 중복  : ${matchesWithDup}/${N}경기에서 발생 (총 ${dupTotal}종)`);
warn(placeholders.length === 0, `치환 안 된 슬롯 ${placeholders.length}건`);
warn(josaBad.length === 0, `조사 오류 ${josaBad.length}건`);
warn(matchesWithDup / N < 0.25, `대사 중복이 잦다 (${pct(matchesWithDup / N)})`);

console.log('\n[스레드] 대사가 앞 합을 무는가');
console.log(`   2합 접속구: ${link2ok} 정상 / ${link2bad} 누락`);
console.log(`   3합 콜백(들었던 태그 인용): ${cb_ok} 정상 / ${cb_bad} 누락`);
console.log(`   45초 상한: 초과(52초+) ${over45}건, 최장 ${durMax.toFixed(1)}초`);
warn(link2bad === 0, `2합이 1합을 물지 않은 경기 ${link2bad}건`);
warn(cb_bad === 0, `3합 콜백 누락 ${cb_bad}건`);
warn(over45 === 0, `52초를 넘긴 경기 ${over45}건 (최장 ${durMax.toFixed(1)})`);
if (sampleThread) {
  console.log('   ── 표본 스레드 ──');
  for (const e of sampleThread.events) {
    if (e.type === 'taunt') console.log(`      ▶ [${e.speaker}] r${e.round}/${e.link} #${e.tag} 「${e.line}」`);
    if (e.type === 'reply') console.log(`      ↩ [${e.speaker}] ${e.rebutted ? '논파' : e.laststand ? '항변' : '못 막음'} 「${e.line}」`);
  }
}

console.log('\n[판정] 논파율');
console.log(`   전체 ${pct(rebutted / clashes)} (합당 논파 ${rebutted}/${clashes})`);
warn(rebutted / clashes > 0.15 && rebutted / clashes < 0.55, `논파율이 치우쳤다 ${pct(rebutted / clashes)}`);
const rates = [...perBookRebut.entries()]
  .filter(([, v]) => v.def >= 8)
  .map(([id, v]) => ({ t: getBook(id).title, r: v.win / v.def }))
  .sort((x, y) => y.r - x.r);
console.log('   책별 방어 성공률 상위/하위:');
for (const r of rates.slice(0, 3)) console.log(`      ${pct(r.r).padStart(6)}  ${r.t}`);
console.log('      …');
for (const r of rates.slice(-3)) console.log(`      ${pct(r.r).padStart(6)}  ${r.t}`);

console.log('\n[범위]');
console.log(`   등장한 책 : ${seenSpeakers.size}/${BOOKS.length}`);
console.log(`   쓰인 태그 : ${seenTags.size}/${Object.keys(TAGS).length}  (${[...seenTags].map((t) => '#' + t).join(' ')})`);
warn(seenSpeakers.size === BOOKS.length, `말을 안 한 책이 있다 (${seenSpeakers.size}/${BOOKS.length})`);
warn(seenTags.size >= 8, `안 쓰인 태그가 많다 (${seenTags.size}/10)`);

console.log('\n[확장] 전용 대사 0줄인 낯선 책 —', STRANGER.title, `(${STRANGER.pages}쪽, ${STRANGER.year})`);
console.log(`   자동 도출 태그: ${strangerTags.map((t) => '#' + t).join(' ')}`);
console.log(`   생성된 대사   : ${strangerLines.length}줄, 미치환 ${strangerBad.length}건, 본인 발화 ${strangerSpoke ? '있음' : '없음'}`);
for (const e of strangerLines.slice(0, 4)) console.log(`      ${e.type === 'taunt' ? '▶' : '↩'} [${e.speaker}] ${e.line}`);
warn(strangerBad.length === 0, '낯선 책 대사에 미치환 슬롯');
warn(strangerSpoke, '낯선 책이 한 마디도 못 했다');
warn(strangerTags.length > 0, '낯선 책의 약점 태그가 안 뽑혔다');

const avgRead = readTimes.reduce((a, c) => a + c, 0) / readTimes.length;
console.log(`\n[템포] 대사 1줄 평균 읽기 시간 ${avgRead.toFixed(2)}초 (최소 ${Math.min(...readTimes).toFixed(1)} / 최대 ${Math.max(...readTimes).toFixed(1)})`);

console.log('\n' + (fails.length ? `✗ 실패 ${fails.length}건\n  - ` + fails.join('\n  - ') : '✓ 전부 통과'));
process.exit(fails.length ? 1 : 0);
