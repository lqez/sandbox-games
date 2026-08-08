// 시드 기반 결정론적 난수 — 같은 시드 + 같은 대진이면 언제나 같은 경기가 나온다.
// 경기 시뮬레이션은 전부 이 RNG만 쓴다(Math.random 금지). 그래야 리플레이/공유가 성립.

// 문자열 시드를 32bit 정수로 (xmur3)
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

// mulberry32 — 빠르고 분포가 균일한 32bit PRNG
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.seed = String(seed);
    const h = hashSeed(this.seed);
    h(); // 첫 값은 버려서 짧은 시드끼리 상관관계를 끊는다
    this.next = mulberry32(h());
  }
  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }
  int(min, max) {
    // [min, max] 양끝 포함
    return Math.floor(this.float(min, max + 1 - 1e-9));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  // 같은 배열에서 연속으로 뽑을 때 직전 값을 피한다 — 발췌문이 반복되면 김이 샌다
  pickFresh(arr, used) {
    if (!arr.length) return null;
    const fresh = arr.filter((v) => !used.has(v));
    const pool = fresh.length ? fresh : arr;
    const v = this.pick(pool);
    if (!fresh.length) used.clear();
    used.add(v);
    return v;
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// 표시용 랜덤 시드 — 읽고 부르기 쉬운 6자리
export function randomSeed() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}
