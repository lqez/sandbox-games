// 파이터 명단 — 전부 퍼블릭 도메인 고전.
// pages(분량) / year(출간) / author(저자)는 실제 값이고, 능력치는 그 실제 값 + 작품 성격에서 뽑는다.
//
// 능력치 5종
//   logic   논지  — 기본 타격력. 논증이 단단할수록 아프다.
//   style   문체  — 크리티컬(치명적 한 방) 확률과 배수.
//   legacy  관록  — 피해 감소. 오래 살아남은 책일수록 잘 안 무너진다.
//   chaos   광기  — 회피 + 변칙 공격. 예측 불가능함.
//   grit    뚝심  — 스태미나 회복과 그로기 저항.
// 분량(pages)은 능력치가 아니라 체력/스태미나 총량과 기동력으로 직접 환산된다(deriveStats).

import { applyVoices } from './voices.js';

const RAW_BOOKS = [
  {
    id: 'artofwar',
    title: '손자병법',
    titleOrig: '孫子兵法',
    author: '손무',
    authorOrig: '孫武',
    year: -500,
    yearLabel: '기원전 5세기',
    pages: 108,
    nation: '🇨🇳',
    genre: '병법서',
    nickname: '싸우지 않는 자',
    cover: { bg: '#7c1f1f', fg: '#f2e2c4', accent: '#d9b45a', motif: 'seal', style: 'classic' },
    stats: { logic: 78, style: 62, legacy: 95, chaos: 74, grit: 70 },
    traits: ['간결', '실전', '기만'],
    authorTrait: {
      name: '궤도(詭道)',
      desc: '전쟁은 속임수다 — 상대의 공격을 흘려보내고 빈틈을 친다.',
      kind: 'counter', // 피격 시 일정 확률로 반격
    },
    quotes: {
      jab: [
        '적을 알고 나를 알면 백 번 싸워도 위태롭지 않다.',
        '전쟁은 속임수다.',
        '이길 수 없을 때는 지키고, 이길 수 있을 때는 친다.',
        '병법은 신속을 귀하게 여긴다.',
      ],
      heavy: [
        '최상의 병법은 적의 계략을 깨뜨리는 것이고, 그다음이 외교를 깨는 것이며, 가장 낮은 것이 성을 공격하는 것이다.',
        '무릇 전쟁이란 오래 끌어서 나라에 이로웠던 예가 없다.',
      ],
      finisher: {
        name: '부전승(不戰而屈人之兵)',
        line: '백 번 싸워 백 번 이기는 것은 최상이 아니다. 싸우지 않고 적을 굴복시키는 것이 최상이다.',
      },
    },
  },
  {
    id: 'metamorphosis',
    title: '변신',
    titleOrig: 'Die Verwandlung',
    author: '프란츠 카프카',
    authorOrig: 'Franz Kafka',
    year: 1915,
    pages: 74,
    nation: '🇦🇹',
    genre: '실존 우화',
    nickname: '불안의 벌레',
    cover: { bg: '#2b2b2f', fg: '#d8d2c4', accent: '#8a6a2f', motif: 'beetle', style: 'modern' },
    stats: { logic: 60, style: 90, legacy: 72, chaos: 88, grit: 42 },
    traits: ['악몽', '관료제', '소외'],
    authorTrait: {
      name: '불안의 잠식',
      desc: '맞히면 상대에게 불안을 남긴다 — 매 교전마다 갉아먹는 지속 피해.',
      kind: 'dot',
    },
    quotes: {
      jab: [
        '어느 날 아침 불안한 꿈에서 깨어났을 때, 그는 침대 속에서 한 마리 흉측한 벌레로 변해 있었다.',
        '"나에게 무슨 일이 일어난 걸까?" 그는 생각했다. 꿈은 아니었다.',
        '문 세 개가 모두 잠겨 있었다.',
      ],
      heavy: [
        '그는 자기 방을, 조용한 인간의 방을 둘러보았다 — 다만 조금 지나치게 작았다.',
        '가족은 그를 견뎠고, 견디는 것 외에 달리 할 수 있는 일이 없었다.',
      ],
      finisher: {
        name: '벌레가 된 아침',
        line: '"저것이 없어져야 해요." 누이가 말했다. "저건 오빠가 아니에요."',
      },
    },
  },
  {
    id: 'alice',
    title: '이상한 나라의 앨리스',
    titleOrig: "Alice's Adventures in Wonderland",
    author: '루이스 캐럴',
    authorOrig: 'Lewis Carroll',
    year: 1865,
    pages: 96,
    nation: '🇬🇧',
    genre: '난센스 동화',
    nickname: '점점 더 이상한',
    cover: { bg: '#1d5c4f', fg: '#f4ead2', accent: '#e0a53a', motif: 'rabbit', style: 'classic' },
    stats: { logic: 55, style: 84, legacy: 80, chaos: 96, grit: 58 },
    traits: ['난센스', '말장난', '변덕'],
    authorTrait: {
      name: '체셔 회피',
      desc: '몸을 지우고 미소만 남긴다 — 회피에 성공하면 다음 한 방이 커진다.',
      kind: 'evade',
    },
    quotes: {
      jab: [
        '"점점 더 이상해!" 앨리스가 소리쳤다.',
        '"우리는 모두 여기서 미쳤어. 나도 미쳤고, 너도 미쳤지."',
        '"그 애의 목을 쳐라!" 여왕이 목청껏 외쳤다.',
        '"나는 아침 식사 전에 불가능한 일을 여섯 가지나 믿은 적도 있단다."',
      ],
      heavy: [
        '"어느 길로 가야 하는지 알려줄래?" "그건 네가 어디로 가고 싶은지에 달렸지."',
        '"처음부터 시작해서 끝까지 가거라. 그러고 나서 멈추어라."',
      ],
      finisher: {
        name: '너희는 한낱 카드 뭉치야',
        line: '"당신들은 그저 카드 한 벌에 불과해!" — 그러자 카드들이 모두 공중으로 날아올라 그녀에게 쏟아졌다.',
      },
    },
  },
  {
    id: 'ownroom',
    title: '자기만의 방',
    titleOrig: "A Room of One's Own",
    author: '버지니아 울프',
    authorOrig: 'Virginia Woolf',
    year: 1929,
    pages: 112,
    nation: '🇬🇧',
    genre: '에세이',
    nickname: '연간 500파운드',
    cover: { bg: '#3d4a6b', fg: '#f0ece2', accent: '#c8a25c', motif: 'window', style: 'modern' },
    stats: { logic: 92, style: 88, legacy: 76, chaos: 52, grit: 74 },
    traits: ['논증', '반어', '해부'],
    authorTrait: {
      name: '셰익스피어의 누이',
      desc: '정전(正典)의 권위를 해체한다 — 관록이 높은 상대일수록 더 아프게 친다.',
      kind: 'giantkiller',
    },
    quotes: {
      jab: [
        '여성이 소설을 쓰려면 돈과 자기만의 방이 있어야 한다.',
        '여성은 수 세기 동안 남성을 실제 크기의 두 배로 비추어주는 거울 노릇을 해왔다.',
        '자물쇠를 채워라. 다만 내 정신에는 채울 문이 없다.',
      ],
      heavy: [
        '셰익스피어에게 주디스라는 이름의, 그와 똑같이 비범한 누이가 있었다고 가정해보자.',
        '지적 자유는 물질적 조건에 달려 있다. 시는 물질적 조건에 달려 있다.',
      ],
      finisher: {
        name: '주디스 셰익스피어',
        line: '16세기에 위대한 재능을 타고난 여성은 분명 미쳐버렸거나, 스스로 목숨을 끊었거나, 마을 외딴 오두막에서 반은 마녀 반은 마법사로 생을 마쳤을 것이다.',
      },
    },
  },
  {
    id: 'prince',
    title: '군주론',
    titleOrig: 'Il Principe',
    author: '니콜로 마키아벨리',
    authorOrig: 'Niccolò Machiavelli',
    year: 1532,
    pages: 140,
    nation: '🇮🇹',
    genre: '정치학',
    nickname: '여우이자 사자',
    cover: { bg: '#5a1e12', fg: '#efe0c0', accent: '#c9a227', motif: 'crown', style: 'classic' },
    stats: { logic: 88, style: 70, legacy: 88, chaos: 66, grit: 80 },
    traits: ['냉혹', '현실주의', '계략'],
    authorTrait: {
      name: '여우와 사자',
      desc: '함정을 알아채는 여우이자 늑대를 쫓는 사자 — 상대의 피니셔 피해를 절반으로 줄인다.',
      kind: 'foxlion',
    },
    quotes: {
      jab: [
        '사랑받는 것과 두려움의 대상이 되는 것 중 하나를 택해야 한다면, 두려움의 대상이 되는 편이 훨씬 안전하다.',
        '인간은 아버지의 죽음은 잊어도 재산의 상실은 좀처럼 잊지 못한다.',
        '누구든 남을 강하게 만들어주는 자는 스스로를 무너뜨린다.',
      ],
      heavy: [
        '군주는 짐승의 방식을 잘 쓸 줄 알아야 하므로, 여우와 사자를 본받아야 한다. 사자는 함정을 피하지 못하고, 여우는 늑대를 막지 못하기 때문이다.',
        '모든 무장한 예언자는 승리했고, 무장하지 않은 예언자는 모두 몰락했다.',
      ],
      finisher: {
        name: '단칼의 잔혹',
        line: '가해는 한꺼번에 저질러야 한다. 그래야 맛이 덜 느껴져 원한이 적게 남는다. 은혜는 조금씩 베풀어야 그 맛이 오래간다.',
      },
    },
  },
  {
    id: 'hamlet',
    title: '햄릿',
    titleOrig: 'The Tragedy of Hamlet, Prince of Denmark',
    author: '윌리엄 셰익스피어',
    authorOrig: 'William Shakespeare',
    year: 1603,
    pages: 160,
    nation: '🇬🇧',
    genre: '비극',
    nickname: '덴마크의 왕자',
    cover: { bg: '#1b2430', fg: '#e6dcc6', accent: '#9c8547', motif: 'skull', style: 'classic' },
    stats: { logic: 74, style: 98, legacy: 96, chaos: 80, grit: 56 },
    traits: ['독백', '광기 연기', '수사'],
    authorTrait: {
      name: '극중극',
      desc: '연기로 상대의 속을 들춘다 — 크리티컬이 터지면 상대 스태미나까지 깎는다.',
      kind: 'mousetrap',
    },
    quotes: {
      jab: [
        '사느냐 죽느냐, 그것이 문제로다.',
        '"무엇을 읽고 계십니까, 왕자님?" "말, 말, 말."',
        '덴마크에는 무언가 썩어 있다.',
        '세상에는 좋고 나쁨이 따로 없다. 생각이 그렇게 만들 뿐이다.',
      ],
      heavy: [
        '호레이쇼, 하늘과 땅에는 자네의 철학으로는 꿈도 꾸지 못할 것들이 있다네.',
        '인간이란 얼마나 걸작인가! 이성은 얼마나 고귀하며, 능력은 얼마나 무한한가! 그런데 내게 이 흙먼지의 정수가 무엇이란 말인가?',
      ],
      finisher: {
        name: '독 묻은 칼끝',
        line: '연극이야말로 왕의 양심을 낚아챌 덫이다.',
      },
    },
  },
  {
    id: 'jekyll',
    title: '지킬 박사와 하이드 씨',
    titleOrig: 'Strange Case of Dr Jekyll and Mr Hyde',
    author: '로버트 루이스 스티븐슨',
    authorOrig: 'Robert Louis Stevenson',
    year: 1886,
    pages: 141,
    nation: '🇬🇧',
    genre: '고딕 스릴러',
    nickname: '둘로 갈라진 자',
    cover: { bg: '#243b34', fg: '#e9e2cf', accent: '#a8452f', motif: 'flask', style: 'gothic' },
    stats: { logic: 70, style: 76, legacy: 78, chaos: 84, grit: 62 },
    traits: ['이중성', '변신', '자기파괴'],
    authorTrait: {
      name: '약을 삼킨다',
      desc: '체력이 절반 아래로 떨어지면 하이드로 변한다 — 논지와 광기가 폭증하고 관록은 무너진다.',
      kind: 'transform',
    },
    quotes: {
      jab: [
        '인간은 진실로 하나가 아니라 둘이다.',
        '나는 그 사람이 마음에 들지 않았다. 뭐라 꼬집어 말할 수 없는 기형이 느껴졌다.',
        '내가 하이드 씨라면, 당신은 유쾌하지 못한 시간을 보내게 될 겁니다.',
      ],
      heavy: [
        '나는 이 두 본성이 저마다 갈라진 집에 살 수 있다면, 견딜 수 없는 것에서 삶이 풀려나리라 생각했다.',
        '나는 그 순간 처음으로 사악함의 자유를 알았고, 그것에 취해 몸을 떨었다.',
      ],
      finisher: {
        name: '하이드로의 변신',
        line: '나는 그 약을 삼켰고, 뼈가 갈리는 고통이 왔다. 그리고 이어서 형언할 수 없는 해방감이 왔다.',
      },
    },
  },
  {
    id: 'gatsby',
    title: '위대한 개츠비',
    titleOrig: 'The Great Gatsby',
    author: 'F. 스콧 피츠제럴드',
    authorOrig: 'F. Scott Fitzgerald',
    year: 1925,
    pages: 180,
    nation: '🇺🇸',
    genre: '재즈 시대 소설',
    nickname: '초록 불빛',
    cover: { bg: '#0d2340', fg: '#f5efd8', accent: '#4fd0a3', motif: 'eyes', style: 'deco' },
    stats: { logic: 62, style: 96, legacy: 74, chaos: 60, grit: 60 },
    traits: ['서정', '환멸', '광채'],
    authorTrait: {
      name: '초록 불빛',
      desc: '닿을 수 없는 것을 향해 손을 뻗는다 — 지고 있을 때 타격이 강해진다.',
      kind: 'comeback',
    },
    quotes: {
      jab: [
        '누군가를 비판하고 싶어질 때면 이 점을 기억해라. 세상 모든 사람이 네가 누린 이점을 누린 것은 아니다.',
        '그의 미소는 영원한 확신을 담은, 평생 네댓 번밖에 만나지 못할 그런 미소였다.',
        '"그 목소리에는 돈이 가득 들어 있어." 그가 갑자기 말했다.',
      ],
      heavy: [
        '개츠비는 초록 불빛을, 해마다 우리 앞에서 멀어져 가는 그 황홀한 미래를 믿었다.',
        '그들은 부주의한 사람들이었다. 물건과 사람을 부숴놓고는 자기들의 돈 속으로 물러나 버렸다.',
      ],
      finisher: {
        name: '조류를 거스르는 배',
        line: '그리하여 우리는 물살을 거스르는 배처럼, 끊임없이 과거로 떠밀려 가면서도 앞으로 나아간다.',
      },
    },
  },
  {
    id: 'frankenstein',
    title: '프랑켄슈타인',
    titleOrig: 'Frankenstein; or, The Modern Prometheus',
    author: '메리 셸리',
    authorOrig: 'Mary Shelley',
    year: 1818,
    pages: 280,
    nation: '🇬🇧',
    genre: '고딕 SF',
    nickname: '현대의 프로메테우스',
    cover: { bg: '#1e2a24', fg: '#ded6c2', accent: '#6f9b6a', motif: 'bolt', style: 'gothic' },
    stats: { logic: 76, style: 80, legacy: 84, chaos: 70, grit: 86 },
    traits: ['비탄', '항변', '집념'],
    authorTrait: {
      name: '창조주에게 되묻기',
      desc: '피조물이 창조주를 심문한다 — 상대의 논지가 높을수록 반격이 매섭다.',
      kind: 'reversal',
    },
    quotes: {
      jab: [
        '조심하라. 나는 두려움을 모르며, 그래서 강하다.',
        '나는 당신의 피조물이오. 나는 당신의 아담이 되어야 했으나, 오히려 타락한 천사가 되었소.',
        '내가 청한 적이 있소, 흙에서 나를 빚어 인간으로 만들어 달라고?',
      ],
      heavy: [
        '나는 자비로워야 했다. 나는 선하게 태어났다. 불행이 나를 악마로 만들었다. 나를 행복하게 하라. 그러면 다시 선해지리라.',
        '내 위에 아무런 죄도 없는데, 어찌하여 인간은 나를 미워하는가.',
      ],
      finisher: {
        name: '결혼식 밤에 함께하겠다',
        line: '나는 당신의 결혼식 밤에 당신과 함께 있겠소.',
      },
    },
  },
  {
    id: 'dracula',
    title: '드라큘라',
    titleOrig: 'Dracula',
    author: '브램 스토커',
    authorOrig: 'Bram Stoker',
    year: 1897,
    pages: 418,
    nation: '🇮🇪',
    genre: '고딕 호러',
    nickname: '밤의 백작',
    cover: { bg: '#160d12', fg: '#e8dccb', accent: '#a3182a', motif: 'bat', style: 'gothic' },
    stats: { logic: 66, style: 86, legacy: 82, chaos: 78, grit: 88 },
    traits: ['서간체', '흡혈', '불사'],
    authorTrait: {
      name: '흡혈',
      desc: '가한 피해의 일부를 자신의 체력으로 되돌린다.',
      kind: 'lifesteal',
    },
    quotes: {
      jab: [
        '"내 집에 온 것을 환영하오. 자유로이 들어와, 무사히 나가시오."',
        '밤의 아이들을 들어보시오. 저들이 만들어내는 음악을!',
        '나는 그늘과 어둠을 사랑하며, 홀로 내 생각과 함께 있기를 원하오.',
      ],
      heavy: [
        '당신들은 영리하다고 생각하겠지, 신사 양반들. 하지만 나는 수 세기를 살아왔소. 시간은 내 편이오.',
        '내 복수는 이제 시작이오. 나는 그것을 수백 년에 걸쳐 펼칠 것이며, 시간은 나의 편이오.',
      ],
      finisher: {
        name: '피는 생명이다',
        line: '피는 생명이오! 피는 생명이오!',
      },
    },
  },
  {
    id: 'pride',
    title: '오만과 편견',
    titleOrig: 'Pride and Prejudice',
    author: '제인 오스틴',
    authorOrig: 'Jane Austen',
    year: 1813,
    pages: 279,
    nation: '🇬🇧',
    genre: '풍속 소설',
    nickname: '응접실의 저격수',
    cover: { bg: '#4a5a3c', fg: '#f4eddc', accent: '#d3a3b0', motif: 'rose', style: 'classic' },
    stats: { logic: 84, style: 92, legacy: 86, chaos: 48, grit: 76 },
    traits: ['아이러니', '독설', '예절'],
    authorTrait: {
      name: '정중한 독설',
      desc: '웃으면서 찌른다 — 크리티컬이 터져도 상대는 반격 타이밍을 잡지 못한다.',
      kind: 'poise',
    },
    quotes: {
      jab: [
        '재산깨나 있는 독신 남자에게 아내가 필요하다는 것은 널리 인정되는 진리다.',
        '허영과 오만은 다른 것이다. 오만은 나 자신에 대한 것이고, 허영은 남이 나를 어떻게 볼지에 대한 것이다.',
        '"그런대로 봐줄 만하군. 하지만 내 마음을 끌 만큼 아름답지는 않아."',
        '나는 어리석음과 허튼소리, 변덕과 모순을 즐긴다. 고백하건대, 나는 그것들을 비웃는다.',
      ],
      heavy: [
        '당신은 세상 어떤 남자와 결혼하더라도 내가 행복할 수 없게 만드는, 마지막 남자입니다.',
        '내 좋은 평가는 한번 잃으면 영원히 잃는 것입니다.',
      ],
      finisher: {
        name: '청혼 거절',
        line: '당신이 좀 더 신사답게 처신했더라면, 거절하면서 조금이라도 마음이 아팠을지 모르겠군요.',
      },
    },
  },
  {
    id: 'origin',
    title: '종의 기원',
    titleOrig: 'On the Origin of Species',
    author: '찰스 다윈',
    authorOrig: 'Charles Darwin',
    year: 1859,
    pages: 502,
    nation: '🇬🇧',
    genre: '자연과학',
    nickname: '느린 선택',
    cover: { bg: '#2c4033', fg: '#efe6d0', accent: '#b5843c', motif: 'finch', style: 'classic' },
    stats: { logic: 96, style: 58, legacy: 90, chaos: 40, grit: 92 },
    traits: ['관찰', '누적', '증거'],
    authorTrait: {
      name: '자연선택',
      desc: '교전이 거듭될수록 논지가 조금씩 자란다 — 길어질수록 유리하다.',
      kind: 'evolve',
    },
    quotes: {
      jab: [
        '자연선택은 매일 매시간, 세계 전역에서 가장 미세한 변이까지 낱낱이 검열하고 있다.',
        '나는 종이 불변한다는 견해에 아무런 근거가 없다고 확신한다.',
        '자연에는 비약이 없다.',
      ],
      heavy: [
        '개체마다 살아남을 수 있는 것보다 더 많이 태어나므로, 생존을 위한 투쟁이 거듭 일어난다.',
        '무지는 지식보다 더 자주 확신을 낳는다. 이러저러한 문제는 결코 과학으로 풀리지 않는다고 단언하는 이들은, 아는 자가 아니라 모르는 자다.',
      ],
      finisher: {
        name: '이런 생명관에는 장엄함이 있다',
        line: '이런 생명관에는 장엄함이 있다. 그토록 단순한 시작에서 가장 아름답고 가장 경이로운 무수한 형태들이 진화해왔고, 지금도 진화하고 있다는 것.',
      },
    },
  },
  {
    id: 'mobydick',
    title: '모비 딕',
    titleOrig: 'Moby-Dick; or, The Whale',
    author: '허먼 멜빌',
    authorOrig: 'Herman Melville',
    year: 1851,
    pages: 635,
    nation: '🇺🇸',
    genre: '해양 서사시',
    nickname: '백경의 광신도',
    cover: { bg: '#0e2a3f', fg: '#e9dcc0', accent: '#c2452d', motif: 'whale', style: 'classic' },
    stats: { logic: 80, style: 94, legacy: 88, chaos: 86, grit: 90 },
    traits: ['만연체', '탈선', '광기'],
    authorTrait: {
      name: '고래학 강의',
      desc: '분류학 여담으로 상대를 재운다 — 맞은 상대의 스태미나가 크게 깎인다.',
      kind: 'digression',
    },
    quotes: {
      jab: [
        '나를 이슈메일이라 불러다오.',
        '무엇보다도 나를 괴롭힌 것은 그 고래의 압도적인 흰빛이었다.',
        '"저놈이 물을 뿜는다! 저기 흰 혹이 솟았다!"',
        '나는 바다로 나간다. 그것이 내 권총이자 총알을 대신하는 방식이다.',
      ],
      heavy: [
        '모든 보이는 사물은 판지로 만든 가면에 지나지 않는다. 나는 저 가면을 부수고 나가겠다!',
        '나를 절름발이로 만든 저 흰 고래를 나는 희망봉을 돌아, 혼곶을 돌아, 노르웨이의 소용돌이를 돌아, 지옥의 불길을 돌아 쫓겠다.',
      ],
      finisher: {
        name: '지옥의 심장에서',
        line: '나는 끝까지 너와 맞붙겠다. 지옥의 한복판에서 너를 찌르고, 증오를 담아 마지막 숨을 너에게 뱉겠다.',
      },
    },
  },
  {
    id: 'crime',
    title: '죄와 벌',
    titleOrig: 'Преступление и наказание',
    author: '표도르 도스토옙스키',
    authorOrig: 'Fyodor Dostoevsky',
    year: 1866,
    pages: 671,
    nation: '🇷🇺',
    genre: '심리 소설',
    nickname: '페테르부르크의 도끼',
    cover: { bg: '#3a1c1c', fg: '#e6d9c2', accent: '#8a6a2a', motif: 'axe', style: 'classic' },
    stats: { logic: 90, style: 84, legacy: 90, chaos: 82, grit: 94 },
    traits: ['자의식', '고열', '심문'],
    authorTrait: {
      name: '포르피리의 심문',
      desc: '상대의 논리를 자백으로 몰아간다 — 상대가 그로기 상태면 피해가 크게 뛴다.',
      kind: 'interrogate',
    },
    quotes: {
      jab: [
        '나는 노파를 죽인 것이 아니다. 나는 원칙을 죽인 것이다.',
        '인간은 비열한 존재다. 그리고 그것을 비열하다고 부르는 자 또한 비열하다.',
        '나는 떨고 있는 벌레인가, 아니면 권리를 가진 자인가?',
      ],
      heavy: [
        '고통과 아픔은 넓은 의식과 깊은 심장을 가진 이에게 언제나 필연적이다.',
        '비범한 인간은 온갖 장애를 뛰어넘을 권리를, 자기 양심 안에서 스스로에게 허락할 수 있다.',
      ],
      finisher: {
        name: '자수하라',
        line: '지금 당장 가서, 당신이 서 있는 네거리에 입 맞추고, 온 세상을 향해 큰 소리로 외치시오. "내가 죽였다"고.',
      },
    },
  },
  {
    id: 'quixote',
    title: '돈키호테',
    titleOrig: 'Don Quijote de la Mancha',
    author: '미겔 데 세르반테스',
    authorOrig: 'Miguel de Cervantes',
    year: 1605,
    pages: 1072,
    nation: '🇪🇸',
    genre: '기사도 풍자',
    nickname: '라만차의 기사',
    cover: { bg: '#6b4a1e', fg: '#f2e6cb', accent: '#c98b2e', motif: 'windmill', style: 'classic' },
    stats: { logic: 58, style: 88, legacy: 94, chaos: 98, grit: 84 },
    traits: ['망상', '기사도', '돌격'],
    authorTrait: {
      name: '풍차 돌격',
      desc: '거인이라 믿고 달려든다 — 피해가 크게 흔들리고, 빗나가면 제 몸이 상한다.',
      kind: 'charge',
    },
    quotes: {
      jab: [
        '라만차의 어느 마을에, 그 이름은 굳이 떠올리고 싶지 않은데, 얼마 전까지 한 시골 귀족이 살고 있었다.',
        '"산초, 저기 보이는가. 서른 명이 넘는 무지막지한 거인들이 서 있네."',
        '"저건 거인이 아니라 풍차입니다, 나리." "그대는 이런 모험을 잘 모르는군."',
      ],
      heavy: [
        '사실은 진실의 적이다. 나는 있는 그대로의 세상이 아니라, 마땅히 있어야 할 세상을 본다.',
        '지나친 제정신이야말로 미친 짓일지 모른다. 그중에서도 가장 미친 짓은, 세상을 있는 그대로 보고 마땅히 되어야 할 모습을 보지 않는 것이다.',
      ],
      finisher: {
        name: '이룰 수 없는 꿈',
        line: '어디로 가는지도 모른 채, 나는 창을 겨누고 달렸다. 세상이 나를 미쳤다고 불러도 좋다.',
      },
    },
  },
  {
    id: 'warpeace',
    title: '전쟁과 평화',
    titleOrig: 'Война и мир',
    author: '레프 톨스토이',
    authorOrig: 'Leo Tolstoy',
    year: 1869,
    pages: 1225,
    nation: '🇷🇺',
    genre: '역사 대하소설',
    nickname: '움직이는 산맥',
    cover: { bg: '#2b3a4a', fg: '#ece2ca', accent: '#a8863c', motif: 'eagle', style: 'classic' },
    stats: { logic: 86, style: 78, legacy: 92, chaos: 54, grit: 98 },
    traits: ['서사', '역사철학', '중량'],
    authorTrait: {
      name: '에필로그 제2부',
      desc: '소설이 끝난 뒤 역사철학 강의가 시작된다 — 경기 후반에 관록과 논지가 함께 오른다.',
      kind: 'epilogue',
    },
    quotes: {
      jab: [
        '우리가 아는 것은 오직 하나, 우리가 아무것도 모른다는 것뿐이다.',
        '가장 강한 전사는 시간과 인내, 이 둘이다.',
        '모든 사람은 결점을 지니고 있으나, 그 결점은 그의 시대와 함께 있다.',
      ],
      heavy: [
        '왕이란 역사의 노예다.',
        '전투의 승패를 가르는 것은 장군의 명령이 아니라, 병사들의 마음속에 있는 그 알 수 없는 힘이다.',
      ],
      finisher: {
        name: '역사철학 부록',
        line: '이제 우리는 역사를 움직이는 힘이 무엇인지 물어야 한다 — 그리하여 이야기가 끝난 자리에서, 논문이 시작된다.',
      },
    },
  },
];

// 전용 설전 대사와 머리 모양을 얹는다(voices.js). 여기 없는 책은 taunts.js의 템플릿으로 굴러간다.
export const BOOKS = applyVoices(RAW_BOOKS);

// 상성 — 실제 주제/계보가 부딪히는 조합. 해설자가 경기 전에 짚어준다.
export const RIVALRIES = [
  { a: 'ownroom', b: 'hamlet', bonus: 0.22, why: '울프가 셰익스피어에게 그의 누이를 묻는다' },
  { a: 'artofwar', b: 'warpeace', bonus: 0.2, why: '전쟁을 이론으로 쓴 책과 전쟁을 살아낸 책' },
  { a: 'origin', b: 'frankenstein', bonus: 0.2, why: '진화가 창조에게 — 누가 너를 만들었는가' },
  { a: 'prince', b: 'crime', bonus: 0.18, why: '비범한 인간론의 원조와 그 병든 후계자' },
  { a: 'dracula', b: 'jekyll', bonus: 0.16, why: '같은 시대, 같은 런던의 두 괴물' },
  { a: 'quixote', b: 'mobydick', bonus: 0.18, why: '망상을 쫓는 두 광인의 추격전' },
  { a: 'pride', b: 'gatsby', bonus: 0.16, why: '결혼 시장과 신흥 부자, 두 계급 소설' },
  { a: 'alice', b: 'origin', bonus: 0.16, why: '난센스가 빅토리아 과학의 멱살을 잡는다' },
  { a: 'metamorphosis', b: 'prince', bonus: 0.16, why: '관료제의 벌레가 권력자에게' },
  { a: 'crime', b: 'warpeace', bonus: 0.14, why: '러시아 문학의 두 거인' },
];

// ── 파생 능력치 ──────────────────────────────────────────────
// 분량은 곧 체급이다. 두꺼우면 맷집과 스태미나 총량이 크지만 느리다.
// 능력치 총합 기울기 — 두꺼울수록 총합을 깎아 체력 우위를 상쇄한다. 0이면 상쇄 없음.
export const BALANCE = {
  SUM_SLOPE: 3.0, // 분량이 늘수록 능력치 총합을 깎는 기울기
  HP_BASE: 104, // 체력 = HP_BASE + pages^HP_EXP * HP_MUL
  HP_EXP: 0.26, // 크면 두꺼운 책이 훨씬 단단해진다
  HP_MUL: 3.8,
};

export function weightClass(pages) {
  if (pages < 120) return { name: '플라이급', short: 'FLY', color: '#7fd4e8' };
  if (pages < 200) return { name: '라이트급', short: 'LW', color: '#8ee08a' };
  if (pages < 350) return { name: '웰터급', short: 'WW', color: '#f2d16b' };
  if (pages < 700) return { name: '미들급', short: 'MW', color: '#f0a05a' };
  return { name: '헤비급', short: 'HW', color: '#e8705a' };
}

export function deriveStats(book) {
  const p = book.pages;
  // 체력: 분량에 따라 늘지만 수확체감. 74p 변신 ≈ 112, 1225p 전쟁과 평화 ≈ 180
  const hpMax = Math.round(BALANCE.HP_BASE + Math.pow(p, BALANCE.HP_EXP) * BALANCE.HP_MUL);
  // 스태미나: 총량도 분량을 따르되 체력만큼 벌어지지는 않는다
  const stMax = Math.round(70 + Math.pow(p, 0.4) * 3.2);
  // 기동: 얇을수록 빠르다 — 교전에서 선공을 잡을 확률
  const speed = Math.round(Math.max(18, 100 - Math.pow(p, 0.62) * 1.35));
  // 회복: 뚝심으로 벌고 분량으로 잃는다. 두꺼운 책은 숨이 늦게 돌아온다.
  const recover = +(book.stats.grit * 0.045 + 3.4 - Math.pow(p, 0.42) * 0.3).toFixed(2);

  // 능력치 정규화 — 두꺼운 책은 이미 체력으로 보상받았다.
  // 여기서 총합을 분량에 반비례로 맞춰 '두껍고 스탯도 높은' 이중 우위를 없앤다.
  // 책마다의 성격(문체형/논지형/광기형)은 비율로 보존되므로 그대로 남는다.
  const s = book.stats;
  const rawSum = s.logic + s.style + s.legacy + s.chaos + s.grit;
  const targetSum = 420 - Math.pow(p, 0.35) * BALANCE.SUM_SLOPE;
  const k = targetSum / rawSum;
  const norm = (v) => Math.round(Math.min(100, Math.max(20, v * k)));

  // 세월: 오래된 책일수록 관록 보너스 (기원전은 -500으로 계산)
  const age = 2026 - book.year;
  // 명단이 전부 고전이라 이 값은 6~11로 거의 일정하다. 크게 주면 차이는 안 만들고
  // 관록만 죄다 상한(100)에 붙어버려 '가드'가 사실상 고정값이 된다. 그래서 작게 준다.
  const ageBonus = Math.min(5, Math.round(Math.log10(Math.max(10, age)) * 1.6));
  return {
    hpMax,
    stMax,
    speed,
    recover: Math.max(1.0, recover),
    logic: norm(s.logic),
    style: norm(s.style),
    legacy: Math.min(100, norm(s.legacy) + ageBonus),
    chaos: norm(s.chaos),
    grit: norm(s.grit),
    weight: weightClass(p),
    // 계체량 — 분량을 킬로그램처럼 읽는다(방송용 농담)
    weighIn: (p / 10).toFixed(1),
  };
}

export function getBook(id) {
  return BOOKS.find((b) => b.id === id) || BOOKS[0];
}

export function rivalryFor(idA, idB) {
  for (const r of RIVALRIES) {
    if (r.a === idA && r.b === idB) return { bonus: r.bonus, why: r.why, favors: idA };
    if (r.a === idB && r.b === idA) return { bonus: r.bonus, why: r.why, favors: idB };
  }
  return null;
}
