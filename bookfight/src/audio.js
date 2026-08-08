// 소리는 전부 WebAudio로 합성한다 — 오디오 파일 없이 정적 호스팅을 유지하려고.
// 종소리 / 타격 / 종이 / 관중 웅성거림 네 가지면 중계처럼 들린다.

let ctx = null;
let master = null;
let crowdGain = null;
let muted = false;

function noiseBuffer(seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02; // 브라운 노이즈 — 관중 소리에 가깝다
    d[i] = last * 3.2;
  }
  return buf;
}

export function initAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  // 관중 — 상시 깔리는 웅성거림
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(4);
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  crowdGain = ctx.createGain();
  crowdGain.gain.value = 0.05;
  src.connect(lp).connect(crowdGain).connect(master);
  src.start();
  return ctx;
}

export function resume() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setMuted(v) {
  muted = v;
  if (master) master.gain.setTargetAtTime(v ? 0 : 0.55, ctx.currentTime, 0.05);
}
export function isMuted() {
  return muted;
}

function env(node, peak, attack, decay) {
  const t = ctx.currentTime;
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

// 개시/종료 종
export function bell(times = 3) {
  if (!ctx) return;
  for (let i = 0; i < times; i++) {
    const t0 = ctx.currentTime + i * 0.42;
    for (const [f, g] of [[840, 0.24], [1290, 0.14], [2360, 0.07]]) {
      const o = ctx.createOscillator();
      const gn = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(g, t0 + 0.006);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      o.connect(gn).connect(master);
      o.start(t0);
      o.stop(t0 + 1.6);
    }
  }
}

// 타격 — 저역 쿵 + 노이즈 탁
export function impact(strength = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150 * (0.8 + strength * 0.5), t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.16);
  env(g, 0.34 * strength, 0.004, 0.19);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.28);

  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1700;
  bp.Q.value = 0.9;
  const ng = ctx.createGain();
  env(ng, 0.2 * strength, 0.002, 0.1);
  n.connect(bp).connect(ng).connect(master);
  n.start(t);
  n.stop(t + 0.2);
}

// 책장이 넘어가는/낱장이 터지는 소리
export function paper(strength = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.4);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(2600, t);
  hp.frequency.exponentialRampToValueAtTime(900, t + 0.22);
  const g = ctx.createGain();
  env(g, 0.13 * strength, 0.008, 0.26);
  n.connect(hp).connect(g).connect(master);
  n.start(t);
  n.stop(t + 0.4);
}

// 문장이 날아가는 소리
export function whoosh() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.4);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.4;
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(2800, t + 0.22);
  const g = ctx.createGain();
  env(g, 0.09, 0.03, 0.2);
  n.connect(bp).connect(g).connect(master);
  n.start(t);
  n.stop(t + 0.35);
}

// 관중 함성 — 큰 장면에서 확 올렸다가 서서히 내린다
export function roar(level = 1) {
  if (!ctx || !crowdGain) return;
  const t = ctx.currentTime;
  crowdGain.gain.cancelScheduledValues(t);
  crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
  crowdGain.gain.linearRampToValueAtTime(0.05 + 0.3 * level, t + 0.12);
  crowdGain.gain.exponentialRampToValueAtTime(0.05, t + 1.6 + level * 1.4);
}

export function crowdBase(level) {
  if (!ctx || !crowdGain) return;
  crowdGain.gain.setTargetAtTime(level, ctx.currentTime, 0.6);
}
