// track.js — 랜덤 해안 스턴트 코스 생성
// 샘플 기반 센터라인: 수평 위치(x,z) + 데크 높이(y) + solid 여부 + 타입.
// s 는 수평 이동거리(m). 조향은 자동이므로 물리는 s 하나로 진행된다.

export const DS = 0.5;           // 샘플 간격 (m)
export const DECK = 2.0;         // 흙길 데크 높이
export const FLOAT_Y = 0.9;      // 부유 플랫폼 데크 높이
export const WATER_Y = 0.0;

export const T = { DIRT: 0, FLOAT: 1, RAMP: 2, BIGRAMP: 3, GAP: 4 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTrack(seed) {
  const rnd = mulberry32(seed);
  const samples = [];        // {x,z,y,solid,type,berm}
  const lips = [];           // {s, size:'s'|'m'|'big'} 점프 립 위치
  const checkpoints = [];    // 리스폰 지점 s
  const cur = { x: 0, z: 0, h: 0 };

  function push(y, solid, type, berm, turn) {
    cur.h += (turn || 0) * DS;
    cur.x += Math.sin(cur.h) * DS;
    cur.z += Math.cos(cur.h) * DS;
    samples.push({ x: cur.x, z: cur.z, y, solid, type, berm: berm || 0 });
  }
  const sNow = () => samples.length * DS;

  // ---- 세그먼트 빌더 ----
  function flat(len, wiggle) {
    const n = Math.round(len / DS);
    const w = wiggle ? (rnd() - 0.5) * 0.014 : 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      push(DECK + Math.sin(t * 17 + seed) * 0.02, true, T.DIRT, 0, w * Math.sin(t * Math.PI * 2));
    }
  }

  function rollers() {
    const k = 2 + Math.floor(rnd() * 2);        // 봉우리 수
    const len = k * (11 + rnd() * 3);
    const amp = 0.65 + rnd() * 0.3;
    const n = Math.round(len / DS);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const y = DECK + amp * Math.pow(Math.sin(t * Math.PI * k), 2);
      push(y, true, T.DIRT, 0, 0);
    }
  }

  function berm(dir) {
    const ang = (0.55 + rnd() * 0.4) * dir;     // 총 회전각 (rad)
    const len = 26 + rnd() * 12;
    const n = Math.round(len / DS);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const ease = Math.sin(t * Math.PI);       // 완만히 들어갔다 나오기
      push(DECK, true, T.DIRT, dir * ease, (ang / len) * ease * (Math.PI / 2 / 1));
    }
  }

  // 킥커 램프 → 물 위 갭 → 착지 램프 (섬에서 섬으로)
  function gapJump(size) {
    const big = size === 'big';
    const rise = big ? 4.5 : 2.0 + rnd() * 0.5;
    const rampLen = big ? 12 : 7;
    const gap = big ? 28 + rnd() * 4 : 14 + rnd() * 6;
    const drop = big ? 2.2 : 1.0;
    const landLen = big ? 14 : 10;
    flat(big ? 20 : 12, false);
    // 램프 위로
    let n = Math.round(rampLen / DS);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const y = DECK + rise * Math.pow(t, 1.55); // 이즈-인 후 직선에 가까운 립
      push(y, true, big ? T.BIGRAMP : T.RAMP, 0, 0);
    }
    const lipY = DECK + rise;
    lips.push({ s: sNow(), size: big ? 'big' : 'm' });
    // 갭 (레퍼런스 y만, solid=false)
    n = Math.round(gap / DS);
    const landTop = lipY - drop;
    for (let i = 0; i < n; i++) push(lipY + (landTop - lipY) * (i / n), false, T.GAP, 0, 0);
    // 착지 램프: landTop → DECK
    n = Math.round(landLen / DS);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      push(landTop + (DECK - landTop) * Math.pow(t, 0.8), true, T.DIRT, 0, 0);
    }
    flat(big ? 10 : 6, false);
  }

  // 부유 램프 체인 (물 위 플랫폼 점프 연쇄)
  function floatChain() {
    const k = 2 + Math.floor(rnd() * 2);
    // 흙 킥커에서 첫 플랫폼으로 (가속 구간 확보)
    flat(14, false);
    let n = Math.round(6 / DS);
    for (let i = 1; i <= n; i++) push(DECK + 1.7 * Math.pow(i / n, 1.5), true, T.RAMP, 0, 0);
    lips.push({ s: sNow(), size: 'm' });
    let fromY = DECK + 1.7;
    for (let p = 0; p < k; p++) {
      const gap = 11 + rnd() * 4;
      n = Math.round(gap / DS);
      for (let i = 0; i < n; i++) push(fromY + (FLOAT_Y + 0.9 - fromY) * (i / n), false, T.GAP, 0, 0);
      const plat = 15 + rnd() * 4;
      n = Math.round(plat / DS);
      for (let i = 0; i < n; i++) push(FLOAT_Y, true, T.FLOAT, 0, 0);
      // 플랫폼 끝 킥커
      const kick = 4.5, kr = 1.5;
      n = Math.round(kick / DS);
      for (let i = 1; i <= n; i++) push(FLOAT_Y + kr * Math.pow(i / n, 1.5), true, T.FLOAT, 0, 0);
      lips.push({ s: sNow(), size: 's' });
      fromY = FLOAT_Y + kr;
    }
    // 마지막 갭 → 흙 착지 램프
    const gap = 12 + rnd() * 4;
    n = Math.round(gap / DS);
    for (let i = 0; i < n; i++) push(fromY + (DECK + 0.8 - fromY) * (i / n), false, T.GAP, 0, 0);
    n = Math.round(10 / DS);
    for (let i = 0; i < n; i++) push(DECK + 0.8 * (1 - i / n), true, T.DIRT, 0, 0);
    flat(6, false);
  }

  // ---- 코스 조립 ----
  checkpoints.push(2);
  flat(46, true);
  const menu = [];
  menu.push(() => berm(rnd() < 0.5 ? 1 : -1));
  menu.push(() => gapJump('m'));
  menu.push(() => rollers());
  menu.push(() => floatChain());
  menu.push(() => gapJump('m'));
  menu.push(() => berm(rnd() < 0.5 ? 1 : -1));
  menu.push(rnd() < 0.5 ? () => rollers() : () => gapJump('m'));
  menu.push(rnd() < 0.5 ? () => floatChain() : () => gapJump('m'));
  // 셔플 (단, 첫 요소는 완만한 것부터)
  for (let i = menu.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(rnd() * i);
    [menu[i], menu[j]] = [menu[j], menu[i]];
  }
  for (const seg of menu) {
    checkpoints.push(sNow() + 1);
    seg();
    flat(10 + rnd() * 8, true);
  }
  // 피날레: 대형 블루 램프
  checkpoints.push(sNow() + 1);
  gapJump('big');
  const finishS = sNow() + 14;
  flat(46, false);

  // ---- 파생 데이터 ----
  const N = samples.length;
  const dirs = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const a = samples[Math.max(0, i - 1)], b = samples[Math.min(N - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dirs[i * 2] = dx / l; dirs[i * 2 + 1] = dz / l;
  }

  const length = N * DS;

  function idx(s) { return Math.min(N - 1.001, Math.max(0, s / DS)); }

  function posAt(s, out) {
    const f = idx(s), i = Math.floor(f), t = f - i;
    const a = samples[i], b = samples[Math.min(N - 1, i + 1)];
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }
  function dirAt(s, out) {
    const f = idx(s), i = Math.floor(f), t = f - i;
    const j = Math.min(N - 1, i + 1);
    let dx = dirs[i * 2] + (dirs[j * 2] - dirs[i * 2]) * t;
    let dz = dirs[i * 2 + 1] + (dirs[j * 2 + 1] - dirs[i * 2 + 1]) * t;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l; out.z = dz / l; out.y = 0;
    return out;
  }
  // 지면: 양쪽 샘플이 모두 solid일 때만 유효
  function groundAt(s) {
    const f = idx(s), i = Math.floor(f), t = f - i;
    const a = samples[i], b = samples[Math.min(N - 1, i + 1)];
    if (!a.solid || !b.solid) return null;
    return a.y + (b.y - a.y) * t;
  }
  // 경사 dY/ds — solid 이웃만 사용 (립에서는 후방 차분)
  function slopeAt(s) {
    const g0 = groundAt(s);
    if (g0 === null) return 0;
    const gF = groundAt(s + 1.0);
    if (gF !== null) return (gF - g0) / 1.0;
    const gB = groundAt(s - 1.0);
    if (gB !== null) return (g0 - gB) / 1.0;
    return 0;
  }
  function typeAt(s) { return samples[Math.floor(idx(s))].type; }
  function bermAt(s) { return samples[Math.floor(idx(s))].berm; }

  return {
    seed, samples, dirs, length, lips, checkpoints, finishS,
    posAt, dirAt, groundAt, slopeAt, typeAt, bermAt,
  };
}
