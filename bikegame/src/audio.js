// audio.js — WebAudio 신스 사운드 (바이크별 엔진 프로필 + 효과음)
// 프로필: { wave, base, mult, filter, filterMult, gain, det }
//   det < 1 → 배음 디튠 비율, det >= 1 → 세컨드 오실레이터 주파수 배수
export function createAudio() {
  let ctx = null;
  let osc1 = null, osc2 = null, engineGain = null, engineFilter = null;
  let noiseSrc = null, noiseGain = null;
  let started = false;
  let profile = { wave: 'sawtooth', base: 44, mult: 115, filter: 240, filterMult: 850, gain: 1.0, det: 0.5 };

  function applyProfile() {
    if (!started) return;
    osc1.type = profile.wave;
    osc2.type = profile.wave === 'triangle' ? 'sine' : profile.wave;
  }

  function ensure() {
    if (started) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      osc1 = ctx.createOscillator();
      osc1.frequency.value = 55;
      osc2 = ctx.createOscillator();
      osc2.frequency.value = 110;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 300;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const g2 = ctx.createGain();
      g2.gain.value = 0.4;
      osc1.connect(engineFilter);
      osc2.connect(g2).connect(engineFilter);
      engineFilter.connect(engineGain).connect(ctx.destination);
      osc1.start(); osc2.start();
      // 롤링 노이즈
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = buf; noiseSrc.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 0.7;
      noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
      noiseSrc.connect(nf).connect(noiseGain).connect(ctx.destination);
      noiseSrc.start();
      started = true;
      applyProfile();
    } catch (e) { /* 오디오 미지원 무시 */ }
    return started;
  }

  function blip(freq, dur, type, gain, slide) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseBurst(dur, freq, gain) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setEngine(p) { profile = { ...profile, ...p }; applyProfile(); },
    engine(speed, throttle, airborne) {
      if (!started) return;
      const rpm = airborne && throttle ? 1.25 : speed / 27;
      const f = profile.base + rpm * profile.mult + (throttle ? profile.base * 0.35 : 0);
      osc1.frequency.setTargetAtTime(f, ctx.currentTime, 0.06);
      const f2 = profile.det >= 1 ? f * profile.det : f * 2 + profile.det * 10;
      osc2.frequency.setTargetAtTime(f2, ctx.currentTime, 0.06);
      engineFilter.frequency.setTargetAtTime(profile.filter + rpm * profile.filterMult, ctx.currentTime, 0.08);
      const g = (throttle ? 0.055 : 0.02 + rpm * 0.012) * profile.gain;
      engineGain.gain.setTargetAtTime(g, ctx.currentTime, 0.09);
      noiseGain.gain.setTargetAtTime(airborne ? 0.0 : Math.min(0.03, speed * 0.0013), ctx.currentTime, 0.12);
    },
    pop() { blip(300, 0.25, 'sine', 0.14, 500); noiseBurst(0.18, 1800, 0.1); },
    trick() { blip(660, 0.12, 'square', 0.06, 220); },
    land() { noiseBurst(0.16, 700, 0.22); },
    sketchy() { blip(200, 0.3, 'sawtooth', 0.1, -80); },
    crash() { noiseBurst(0.5, 500, 0.4); blip(120, 0.5, 'sawtooth', 0.16, -70); },
    splash() { noiseBurst(0.55, 1200, 0.3); },
    finish() {
      blip(523, 0.16, 'square', 0.1);
      setTimeout(() => blip(659, 0.16, 'square', 0.1), 140);
      setTimeout(() => blip(784, 0.3, 'square', 0.12), 280);
    },
  };
}
