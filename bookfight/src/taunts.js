// 설전 엔진 — 이 게임의 심장.
//
// 규칙: 공격은 "상대 책의 약점 태그를 찌르는 것"이고, 방어는 "그 태그를 변호하는 것"이다.
// 둘이 같은 주제를 놓고 말하므로 앞뒤가 맞는 언쟁이 된다. 서로 명대사를 읊는 게 아니다.
//
// 2층 구조:
//   1층 templates — 쪽수/출간연도/장르만 있으면 어떤 책이든 대사가 나온다(폴백이 아니라 기본).
//   2층 books.js의 barbs/defends — 큐레이션된 책은 전용 대사가 우선한다.
// 덕분에 검색으로 긁어온 낯선 책도 링에 올릴 수 있다.

export const TAGS = {
  장황함: '너무 길다',
  얄팍함: '너무 짧고 가볍다',
  난해함: '어렵고 현학적이다',
  유치함: '애들 책이다',
  낡음: '시대에 뒤처졌다',
  통속: '자극적이고 대중영합적이다',
  설교조: '훈계한다',
  편협: '보는 세계가 좁다',
  허황: '현실성이 없다',
  음울: '우울하고 염세적이다',
};

// ── 1층: 메타데이터 → 약점 태그 ────────────────────────────
// books.js가 tags를 직접 적어두면 그걸 쓰고, 없으면 여기서 뽑는다.
const GENRE_TAGS = [
  [/동화|아동|난센스|우화/, ['유치함', '허황']],
  [/철학|과학|정치|병법|경제|에세이|자연/, ['난해함', '설교조']],
  [/호러|고딕|스릴러|괴기/, ['통속', '음울']],
  [/풍속|로맨스|연애/, ['편협', '통속']],
  [/서사시|대하|역사/, ['장황함', '설교조']],
  [/비극|심리|실존/, ['음울', '난해함']],
  [/풍자|기사도|모험/, ['허황']],
];

export function deriveTags(book) {
  if (book.tags && book.tags.length) return book.tags;
  const t = new Set();
  if (book.pages >= 600) t.add('장황함');
  if (book.pages <= 120) t.add('얄팍함');
  if (book.year <= 1650) t.add('낡음');
  const g = `${book.genre || ''} ${(book.traits || []).join(' ')}`;
  for (const [re, tags] of GENRE_TAGS) {
    if (re.test(g)) tags.forEach((x) => t.add(x));
  }
  if (!t.size) t.add('통속'); // 아무것도 안 걸리면 최소 하나는 있어야 싸움이 된다
  return [...t].slice(0, 3);
}

// ── 1층: 태그별 도발/방어 템플릿 ───────────────────────────
// 슬롯: {너} {너쪽} {너해} {너저자} {너장르}  {나} {나쪽} {나해} {나저자}
const ATTACK = {
  장황함: [
    '「{너}」 {너쪽}쪽이오. 그중 몇 쪽이 이야기고, 몇 쪽이 변명이오?',
    '{너저자} 선생, {너쪽}쪽을 끝까지 견딘 독자에게는 상을 줘야 하지 않겠소?',
    '당신 책은 읽는 것이 아니라 통과하는 것이오.',
    '{너쪽}쪽 중에 덜어낼 곳이 없다고 정말 믿으시오?',
  ],
  얄팍함: [
    '{너쪽}쪽이라니. 나는 그 분량을 서문에 쓰오.',
    '「{너}」{는} 하룻밤이면 끝나지 않소? 잊히는 데도 하룻밤이면 되겠군.',
    '얇은 것이 죄는 아니오. 다만 얇은 줄 모르는 것이 죄지.',
  ],
  난해함: [
    '당신 책을 끝까지 읽은 사람과 읽은 척하는 사람, 어느 쪽이 많겠소?',
    '어렵게 쓰면 깊어 보인다고 누가 그럽디까.',
    '「{너}」{는} 서가에 꽂아두기 좋은 책이오. 꺼내지만 않으면.',
  ],
  유치함: [
    '「{너}」{는} 아이들 머리맡에나 어울리오.',
    '당신 책에는 피 한 방울 흐르지 않소.',
    '{너해}년에도 어른들은 그것을 진지하게 읽었소?',
  ],
  낡음: [
    '{너해}년이오. 그때의 상식이 지금도 상식이겠소?',
    '당신 책은 읽히는 것이 아니라 전시되는 것이오.',
    '{너저자} 선생의 세계는 이미 문을 닫았소.',
  ],
  통속: [
    '「{너}」{는} 팔리려고 쓴 티가 나오.',
    '자극을 걷어내면 무엇이 남소?',
    '당신은 독자를 설득한 게 아니라 놀래킨 것이오.',
  ],
  설교조: [
    '「{너}」{는} 이야기가 아니라 훈계요.',
    '누가 당신에게 가르쳐달라 했소?',
    '{너쪽}쪽 내내 옳은 말만 하는 책만큼 지루한 것도 없소.',
  ],
  편협: [
    '당신의 세계는 응접실만 하오.',
    '「{너}」에 나오지 않는 사람들이 세상의 대부분이오.',
    '{너해}년의 한 귀퉁이를 세상 전부인 양 쓰셨더군.',
  ],
  허황: [
    '「{너}」에서 벌어지는 일 중 실제로 있을 법한 게 하나라도 있소?',
    '당신은 세상을 그린 게 아니라 꿈을 적었소.',
    '{너저자} 선생, 눈을 뜨고 쓰셨소?',
  ],
  음울: [
    '「{너}」{을} 덮고 나면 창문을 열고 싶어지오.',
    '당신 책에서 웃는 사람을 본 적이 없소.',
    '{너쪽}쪽 동안 한 번쯤은 해가 떠도 되지 않았겠소?',
  ],
};

const DEFEND = {
  장황함: [
    '짧게 쓸 수 있는 이야기였다면 짧게 썼소. {너쪽}쪽으로 이걸 해보시오.',
    '{나쪽}쪽이 길다면, 당신이 서두른 것이오.',
    '덜어낼 곳이 없어서 남긴 것이오.',
  ],
  얄팍함: [
    '{나쪽}쪽으로 {나해}년을 버텼소. 당신은 몇 쪽으로 몇 해를 버티겠소?',
    '칼날은 두껍지 않소.',
    '짧다고 얕다 하지 마시오. 우물은 넓어서 깊은 게 아니오.',
  ],
  난해함: [
    '어려운 것을 쉬운 척 파는 게 더 나쁜 짓이오.',
    '읽는 데 힘이 든다면, 그만한 것이 안에 있기 때문이오.',
  ],
  유치함: [
    '아이가 읽는다고 얕은 것은 아니오. 어른이 못 읽을 뿐이지.',
    '당신이 잃어버린 것을 나는 아직 갖고 있소.',
  ],
  낡음: [
    '{나해}년에 쓰였고 아직 읽히오. 「{너}」{는} 몇 해나 가겠소?',
    '낡았다는 말은 살아남았다는 말이오.',
  ],
  통속: [
    '읽히지 않는 책이 무슨 소용이오?',
    '나는 독자를 두려워하지 않소. 당신은 두려워하는 것 같군.',
  ],
  설교조: [
    '말할 것이 있어서 썼소. 당신은 무엇을 위해 썼소?',
    '가르치려 든 게 아니라, 아는 것을 숨기지 않았을 뿐이오.',
  ],
  편협: [
    '작게 그렸다고 얕게 본 것은 아니오.',
    '한 사람을 끝까지 들여다본 적은 있소? 나는 있소.',
  ],
  허황: [
    '있는 그대로만 적을 거면 장부를 쓰지 왜 책을 쓰겠소.',
    '내가 꾸며낸 것 중에 당신이 못 본 진실이 있소.',
  ],
  음울: [
    '웃기려고 쓴 책이 아니오.',
    '어두운 것을 어둡다고 적은 게 죄요?',
  ],
};

// 조사 처리 — 「{너}」{는} 처럼 쓰면 앞 낱말의 받침을 보고 은/는, 이/가, 을/를, 과/와를 고른다.
// 이게 없으면 "「오만과 편견」는" 같은 문장이 나와서 대사가 통째로 우스워진다.
const JOSA = { 는: ['은', '는'], 이: ['이', '가'], 을: ['을', '를'], 와: ['과', '와'] };
const NUM_JONG = '013678'; // 일 삼 육 칠 팔 영 — 받침 있는 숫자

function hasJong(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return NUM_JONG.includes(ch);
  return true; // 한자·영문은 받침 있는 쪽으로 (원제 등)
}

// 조사 바로 앞의 닫는 괄호·따옴표는 건너뛰고 진짜 낱말 끝 글자를 찾는다
function tailChar(s) {
  let i = s.length - 1;
  while (i >= 0 && '」』"\'’”)）]】'.includes(s[i])) i--;
  return s[i];
}

function resolveJosa(s) {
  return s.replace(/\{(는|이|을|와)\}/g, (m, j, off) => {
    const pair = JOSA[j];
    return hasJong(tailChar(s.slice(0, off))) ? pair[0] : pair[1];
  });
}

function fill(line, me, you) {
  return resolveJosa(
    line
    .replace(/\{너\}/g, you.title)
    .replace(/\{너쪽\}/g, you.pages)
    .replace(/\{너해\}/g, you.year < 0 ? '기원전' : you.year)
    .replace(/\{너저자\}/g, you.author)
    .replace(/\{너장르\}/g, you.genre || '')
    .replace(/\{나\}/g, me.title)
    .replace(/\{나쪽\}/g, me.pages)
    .replace(/\{나해\}/g, me.year < 0 ? '기원전' : me.year)
    .replace(/\{나저자\}/g, me.author)
  );
}

// ── 조회 ────────────────────────────────────────────────────
// 2층(책별 전용) → 1층(템플릿) 순으로 찾는다.

export function attackLines(me, you, tag) {
  const bespoke = (me.barbs && me.barbs[tag]) || [];
  const generic = ATTACK[tag] || [];
  return { bespoke, generic };
}

export function defendLines(me, you, tag) {
  const bespoke = (me.defends && me.defends[tag]) || [];
  const generic = DEFEND[tag] || [];
  return { bespoke, generic };
}

// 실제로 한 줄을 고른다. 전용 대사가 있으면 우선하되, 이미 쓴 줄은 피한다.
function choose(rng, { bespoke, generic }, used, me, you) {
  // 전용 대사를 먼저 소진하고, 떨어지면 일반 템플릿으로 넘어간다.
  // 둘 다 동나면 그때서야 이 태그의 기록만 지운다 — 안 그러면 같은 문장이 한 경기에 세 번 나온다.
  const freshB = bespoke.filter((l) => !used.has(l));
  const freshG = generic.filter((l) => !used.has(l));
  let pick;
  if (freshB.length) pick = rng.pick(freshB);
  else if (freshG.length) pick = rng.pick(freshG);
  else {
    for (const l of bespoke.concat(generic)) used.delete(l);
    const all = bespoke.length ? bespoke : generic;
    pick = rng.pick(all);
  }
  used.add(pick);
  return fill(pick, me, you);
}

// 공격자가 어떤 태그를 찌를지 고른다.
// 상대가 방어 대사를 못 가진 태그(= 진짜 약점)를 노리는 게 유리하지만, 늘 그러면 뻔해진다.
export function pickTag(rng, me, you, lastTag) {
  const youTags = deriveTags(you);
  if (!youTags.length) return null;
  const scored = youTags.map((tag) => {
    const canDefend = !!(you.defends && you.defends[tag]);
    const iHaveBarb = !!(me.barbs && me.barbs[tag]);
    // 전용 도발이 있으면 그쪽을 선호하고, 상대가 못 막는 태그면 더 선호한다
    let w = 1;
    if (iHaveBarb) w += 1.4;
    if (!canDefend) w += 0.9;
    if (tag === lastTag) w *= 0.15; // 방금 찌른 곳을 또 찌르면 대화가 제자리를 돈다
    return { tag, w };
  });
  const total = scored.reduce((s, x) => s + x.w, 0);
  let r = rng.float(0, total);
  for (const s of scored) {
    r -= s.w;
    if (r <= 0) return s.tag;
  }
  return scored[0].tag;
}

// 한 합의 설전을 만든다. 판정(누가 이겼나)까지 여기서 낸다.
//   rebutted=true  → 방어측이 논파했다. 반격이 들어간다.
//   rebutted=false → 공격이 꽂혔다.
export function buildClash(rng, atk, def, ctx) {
  const tag = pickTag(rng, atk.book, def.book, atk.lastTag);
  if (!tag) return null;

  // 상성 대진이면 전용 저격을 먼저 쓴다 — 그 경기의 클라이맥스가 되라고 넣어둔 대사다.
  const rivalPool = (atk.book.rivalBarbs && atk.book.rivalBarbs[def.book.id]) || [];
  const rivalFresh = rivalPool.filter((l) => !atk.usedLines.has(l));
  let taunt;
  let isRival = false;
  if (rivalFresh.length && rng.chance(0.7)) {
    taunt = fill(rng.pick(rivalFresh), atk.book, def.book);
    atk.usedLines.add(rivalFresh.find((l) => fill(l, atk.book, def.book) === taunt));
    isRival = true;
  } else {
    taunt = choose(rng, attackLines(atk.book, def.book, tag), atk.usedLines, atk.book, def.book);
  }
  const reply = choose(rng, defendLines(def.book, atk.book, tag), def.usedLines, def.book, atk.book);

  // 논파 판정.
  // 중요: 전용 방어 대사를 가졌다는 사실이 승률을 좌우하면 안 된다. 그러면 손으로 쓴 대사가 많은 책이
  // 그냥 세지고, 검색으로 긁어온 책(전용 대사 0줄)은 이길 방법이 없어진다.
  // 그래서 전용 대사는 맛만 더하고(+0.06), 실제 판정은 이미 균형이 맞춰진 능력치로 가른다.
  //
  // 찌르는 힘과 받아치는 힘은 서로 다른 능력치로 잰다.
  // 논지가 양쪽을 다 결정하면 논지 높은 책이 피해량과 논파율을 동시에 챙겨 승률이 폭주한다.
  //   설득력(공격) = 논지 + 문체      — 피해량도 논지가 정하므로 여기 몰아둔다
  //   반박력(방어) = 뚝심 + 광기 + 관록 — 기존에 놀고 있던 능력치를 여기로 돌린다
  const hasRealDefense = !!(def.book.defends && def.book.defends[tag]);
  const persuade = atk.logic * 0.65 + atk.style * 0.35;
  const rebut = def.grit * 0.45 + def.chaos * 0.3 + def.legacy * 0.25;
  let p = 0.34;
  if (hasRealDefense) p += 0.06;
  p += (rebut - persuade) / 300;
  // 저자 특성 중 '흘려 받아치는' 쪽은 여기에 붙는다 — 이제 논파가 곧 반격이므로
  const kind = def.book.authorTrait && def.book.authorTrait.kind;
  if (kind === 'counter') p += 0.14;
  if (kind === 'evade') p += 0.12;
  if (kind === 'foxlion' && ctx.move && ctx.move.key === 'finisher') p += 0.2;
  if (def.groggy) p -= 0.16;
  if (ctx.staggered) p -= 0.12;
  if (isRival) p -= 0.1; // 전용 저격은 아프다
  p = Math.min(0.62, Math.max(0.05, p));

  atk.lastTag = tag;
  const rebutted = rng.chance(p);
  return { tag, taunt, reply, rebutted, hasRealDefense, isRival };
}

// 읽을 시간 — 글자 수에 비례. 이게 곧 컷 길이가 되고, 경기 템포를 정한다.
export function readTime(line) {
  return Math.min(4.8, Math.max(2.5, 1.2 + line.length * 0.055));
}

export function tagLabel(tag) {
  return `#${tag}`;
}
