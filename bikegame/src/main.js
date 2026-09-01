// main.js — BIKEGAME: 원버튼 해안 스턴트 바이크
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildTrack, T } from './track.js';
import { buildWorld } from './world.js';
import { buildBike, BIKE_SPECS } from './bike.js';
import { DroneCam } from './camera.js';
import { setupInput } from './input.js';
import { createAudio } from './audio.js';
import { createParticles } from './particles.js';

// ---------- 상수 ----------
const G = 14;
const DRAG = 3.0;
const V_CREEP = 4;
const POP_WINDOW = 14;
const POP_PERFECT = 6;
const BAR_RANGE = 45;
const WHEELIE_CRASH = 1.05;
const LAND_SKETCHY = 0.40;
const LAND_CRASH = 0.85;
const TIME_BONUS_RATE = 120;   // 파 대비 초당 보너스
const PACE_SPEED = 15.5;       // 파 타임 기준 평균 속도

const TRICKS = {
  'up':         { name: 'BACKFLIP',     pts: 500, dur: 0.85, kind: 'flip', dir: +1 },
  'down':       { name: 'FRONTFLIP',    pts: 550, dur: 0.85, kind: 'flip', dir: -1 },
  'left':       { name: 'WHIP L',       pts: 250, dur: 0.70, kind: 'whip', dir: -1 },
  'right':      { name: 'WHIP R',       pts: 250, dur: 0.70, kind: 'whip', dir: +1 },
  'circle-cw':  { name: 'BARREL ROLL',  pts: 700, dur: 1.05, kind: 'roll', dir: +1 },
  'circle-ccw': { name: 'BARREL ROLL',  pts: 700, dur: 1.05, kind: 'roll', dir: -1 },
  'zigzag':     { name: 'SCISSOR KICK', pts: 600, dur: 0.95, kind: 'scissor', dir: +1 },
  'vee':        { name: 'SUPERMAN',     pts: 450, dur: 0.90, kind: 'superman', dir: +1 },
};

// ---------- 렌더러 / 후처리 ----------
const app = document.getElementById('app');
const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
// AA는 컴포저 MSAA 타깃으로 처리 — 캔버스 MSAA는 컴포저 경유 시 낭비
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2);
renderer.setPixelRatio(DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfeef7, 320, 1500);
const camera = new THREE.PerspectiveCamera(82, window.innerWidth / window.innerHeight, 0.1, 3200);

// 블룸: 태양 디스크 + 수면 윤슬 하이라이트가 HDR 임계 초과분만 번지게
// MSAA 샘플을 지정한 HDR 타깃으로 지오메트리 AA 확보
const composerRT = new THREE.WebGLRenderTarget(
  window.innerWidth * DPR, window.innerHeight * DPR,
  { type: THREE.HalfFloatType, samples: IS_MOBILE ? 2 : 4 }
);
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.42, 0.35, 1.0
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// 포트레이트 보정: 세로 화면에선 수직 FOV를 키워 좌우 시야 확보
function applyFov(base) {
  const a = camera.aspect;
  camera.fov = a < 1 ? Math.min(112, base * (1 + (1 - a) * 0.5)) : base;
  camera.updateProjectionMatrix();
}

const audio = createAudio();
const particles = createParticles(scene);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const elTime = $('time'), elScore = $('score');
const elJumpbar = $('jumpbar'), elNeedle = $('needle');
const elPopups = $('popups'), elWarn = $('warn');
const elIntro = $('intro'), elResults = $('results'), elFlash = $('flash');
const speedCanvas = $('speedGraph');
const sctx = speedCanvas.getContext('2d');
const elSpeedNum = $('speedNum');

function popup(text, cls) {
  const d = document.createElement('div');
  d.className = 'popup ' + (cls || '');
  d.textContent = text;
  d.style.left = (40 + Math.random() * 20) + '%';
  elPopups.appendChild(d);
  setTimeout(() => d.remove(), 1400);
}
function flash(color, ms) {
  elFlash.style.background = color;
  elFlash.style.opacity = '0.55';
  setTimeout(() => { elFlash.style.opacity = '0'; }, ms || 120);
}

// ---------- 게임 상태 ----------
let track, world, bikeM, cam;
let spec = BIKE_SPECS[0];
let specIdx = 0;
const bikePos = new THREE.Vector3();
const bikeDir = new THREE.Vector3(0, 0, 1);
const tmpV = new THREE.Vector3();

const game = {
  phase: 'intro',
  s: 2, v: 0, y: 2, vy: 0,
  airVX: 0, airborne: false,
  airTime: 0, predictedAir: 0,
  pitch: 0, pitchVel: 0, roll: 0,
  wheelie: 0, landWindow: 0,
  trick: null, whipYaw: 0,
  airBank: 0, airTrickNames: [],
  stunt: 0, tricksDone: 0, bestAir: 0,
  raceTime: 0,
  crashed: false, crashTimer: 0,
  crashSpin: new THREE.Vector3(),
  riderFly: null,
  seed: (Math.random() * 0xffffffff) >>> 0,
  releasedAt: -999, releasedS: -999,
  speedHist: [], finishTimer: 0,
};

const input = setupInput(app, {
  onHold() { audio.unlock(); },
  onRelease() {
    game.releasedAt = game.raceTime;
    game.releasedS = game.s;
  },
  onGesture(g) {
    // false 반환 = 미수락 → 입력측이 버퍼를 리셋하고 계속 감시 (이륙 직전 스와이프 구제)
    if (game.phase !== 'run' || !game.airborne || game.crashed || game.trick) return false;
    const t = TRICKS[g];
    if (!t) return false;
    game.trick = { ...t, t: 0 };
    if (t.kind === 'flip') game.trick.dur = spec.flipDur;
    audio.trick();
    return true;
  },
  isGestureContext() {
    return game.phase === 'run' && game.airborne && !game.crashed;
  },
});

function selectBike(i) {
  specIdx = i;
  spec = BIKE_SPECS[i];
  if (bikeM) { scene.remove(bikeM.group); bikeM.dispose(); }
  bikeM = buildBike(i);
  scene.add(bikeM.group);
  audio.setEngine(spec.engine);
  placeBike();
  document.querySelectorAll('.bikeCard').forEach((c, k) => {
    c.classList.toggle('active', k === i);
  });
}

function newGame(seed) {
  if (world) world.dispose();
  track = buildTrack(seed);
  world = buildWorld(track, scene, renderer);
  if (!cam) cam = new DroneCam(camera);
  Object.assign(game, {
    phase: 'intro', s: 2, v: 0, y: 2, vy: 0, airborne: false,
    airTime: 0, pitch: 0, pitchVel: 0, roll: 0, wheelie: 0, landWindow: 0,
    trick: null, whipYaw: 0, airBank: 0, airTrickNames: [],
    stunt: 0, tricksDone: 0, bestAir: 0, raceTime: 0,
    crashed: false, crashTimer: 0, riderFly: null,
    crashS: null, crashSplashed: false,
    releasedAt: -999, releasedS: -999, speedHist: [], finishTimer: 0,
  });
  game.seed = seed;
  if (!bikeM) selectBike(specIdx);
  placeBike();
  cam.snapTo(bikePos, bikeDir);
  elResults.classList.remove('show');
  elIntro.classList.add('show');
  elTime.textContent = '0.0';
  elScore.textContent = '0';
}

function startRun() {
  if (game.phase !== 'intro') return;
  audio.unlock();
  game.phase = 'run';
  elIntro.classList.remove('show');
  cam.snapTo(bikePos, bikeDir);
}

function placeBike() {
  if (!track) return;
  track.posAt(game.s, bikePos);
  track.dirAt(game.s, bikeDir);
  bikePos.y = game.y;
  bikeM.group.position.copy(bikePos);
  bikeM.group.rotation.y = Math.atan2(bikeDir.x, bikeDir.z);
}

function respawn() {
  let cp = track.checkpoints[0];
  const base = game.crashS ?? game.s; // 슬라이드로 넘어간 진행은 인정하지 않음
  for (const c of track.checkpoints) if (c <= base + 1) cp = c;
  game.crashS = null;
  game.crashSplashed = false;
  game.s = cp;
  game.v = 15;
  game.y = track.groundAt(cp) ?? 2;
  game.vy = 0;
  game.airborne = false; game.airTime = 0;
  game.pitch = 0; game.pitchVel = 0; game.roll = 0;
  game.wheelie = 0; game.landWindow = 0;
  game.trick = null; game.whipYaw = 0;
  game.airBank = 0; game.airTrickNames = [];
  game.crashed = false; game.riderFly = null;
  bikeM.rider.position.set(0, 0, 0);
  bikeM.rider.rotation.set(0, 0, 0);
  placeBike();
  cam.snapTo(bikePos, bikeDir);
}

function doCrash(splashed) {
  if (game.crashed) return;
  game.crashed = true;
  game.crashS = game.s;          // 리스폰 기준: 크래시 발생 지점
  game.crashSplashed = splashed;
  game.crashTimer = 1.5;
  game.trick = null;
  game.airBank = 0; game.airTrickNames = [];
  game.crashSpin.set((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8);
  game.riderFly = {
    vel: new THREE.Vector3((Math.random() - 0.5) * 3, 5 + Math.random() * 2, game.v * 0.4),
    rot: (Math.random() - 0.5) * 10,
  };
  cam.kick(1.0);
  if (splashed) {
    particles.splash(bikePos.x, bikePos.z, 60);
    audio.splash();
    flash('#bfeef2', 200);
    popup('SPLASH!', 'bad');
  } else {
    particles.dust(bikePos.x, bikePos.y, bikePos.z, 24);
    audio.crash();
    flash('#ffffff', 130);
    popup('CRASH!', 'bad');
  }
}

// ---------- 착지 판정 ----------
function evaluateLanding(groundSlope) {
  // 마이크로 홉(노면 요철)은 판정/점수/파워윈도우 없이 조용히 접지
  if (game.airTime < 0.35 && !game.trick) {
    game.pitchVel = 0;
    game.airBank = Math.max(0, game.airBank);
    return;
  }
  const slopeAngle = Math.atan(groundSlope);
  let d = game.pitch - slopeAngle;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const whipAmt = Math.abs(game.whipYaw) + Math.abs(game.roll) * 0.7;
  let trickPenalty = 0;
  if (game.trick) {
    const prog = game.trick.t / game.trick.dur;
    if (prog < 0.8) { doCrash(false); return; }
    if (prog < 0.97) trickPenalty = 1;
    game.trick = null;
  }
  if (Math.abs(d) > LAND_CRASH || whipAmt > 0.6) { doCrash(false); return; }

  const airPts = Math.round(game.airTime * 120);
  const sketchy = Math.abs(d) > LAND_SKETCHY || whipAmt > 0.3 || trickPenalty;
  let gained = game.airBank + airPts;
  if (sketchy) {
    gained = Math.round(gained * 0.5);
    game.v *= 0.55;
    audio.sketchy();
    if (game.airTime > 0.45) popup('SKETCHY… +' + gained, 'warn');
  } else {
    if (game.airTime > 0.45) {
      gained += 150;
      popup('CLEAN +' + (150 + airPts), 'good');
      audio.land();
    }
    cam.kick(0.25);
  }
  game.stunt += Math.max(0, gained);
  game.bestAir = Math.max(game.bestAir, game.airTime);
  game.airBank = 0; game.airTrickNames = [];
  // 착지 순간 스로틀을 쥐고 있을 때만 윌리 파워 윈도우 발동
  game.landWindow = input.held ? 1.1 : 0;
  game.wheelie = Math.max(0, d) * 0.55;
  particles.dust(bikePos.x, bikePos.y, bikePos.z, 10);
  game.pitchVel = 0;
}

// ---------- 물리 스텝 ----------
function step(dt) {
  if (game.phase !== 'run') return;
  game.raceTime += dt;

  if (game.crashed) {
    game.crashTimer -= dt;
    game.v = Math.max(0, game.v - 14 * dt);
    game.s += game.v * dt;
    game.vy -= G * dt;
    game.y += game.vy * dt;
    const g = track.groundAt(game.s);
    if (g !== null && game.y < g) { game.y = g; game.vy = 0; }
    if (game.y < 0.1) {
      game.y = 0.1; game.vy = 0;
      if (g === null) {
        // 갭 위 수면: 활주 정지 + 최초 1회 스플래시
        game.v = 0;
        if (!game.crashSplashed) {
          game.crashSplashed = true;
          particles.splash(bikePos.x, bikePos.z, 40);
          audio.splash();
        }
      }
    }
    game.pitch += game.crashSpin.x * dt;
    game.roll += game.crashSpin.z * dt;
    if (game.riderFly) {
      bikeM.rider.position.x += game.riderFly.vel.x * dt;
      bikeM.rider.position.y += game.riderFly.vel.y * dt;
      bikeM.rider.position.z += game.riderFly.vel.z * dt;
      game.riderFly.vel.y -= G * dt;
      bikeM.rider.rotation.x += game.riderFly.rot * dt;
    }
    if (game.crashTimer <= 0) respawn();
    updateBikeVisual(dt);
    return;
  }

  const held = input.held;
  const slope = track.slopeAt(game.s);

  if (!game.airborne) {
    // ---- 지상 ----
    if (held) game.v += spec.accel * (1 - game.v / spec.vmax) * dt;
    else game.v -= DRAG * dt;
    game.v -= slope * 4.5 * dt;
    game.v = Math.max(V_CREEP, Math.min(spec.vmax, game.v));

    const cos = 1 / Math.sqrt(1 + slope * slope);
    game.s += game.v * cos * dt;

    const g2 = track.groundAt(game.s);
    const newSlope = track.slopeAt(game.s);
    const freeY = game.y + game.vy * dt - 0.5 * G * dt * dt;
    if (g2 === null || freeY > g2 + 0.06) {
      takeOff(held, slope, cos);
    } else {
      game.y = g2;
      game.vy = game.v * cos * newSlope;
      const targetPitch = Math.atan(newSlope);
      game.pitch += (targetPitch - game.pitch) * Math.min(1, 12 * dt);
      game.landWindow = Math.max(0, game.landWindow - dt);
      if (!held) game.landWindow = 0; // 한 번 떼면 윈도우 종료 (재가속은 안전)
      if (held && game.landWindow > 0) {
        game.wheelie += (2.3 + game.v * 0.02) / spec.stability * dt;
      } else if (held && game.v < spec.vmax * 0.55) {
        game.wheelie = Math.min(game.wheelie + 1.2 * dt, 0.16);
      } else {
        game.wheelie -= 3.0 * dt;
      }
      game.wheelie = Math.max(0, game.wheelie);
      if (game.wheelie > WHEELIE_CRASH) { doCrash(false); return; }
      if (game.wheelie > 0.3) game.stunt += Math.round(40 * dt);
      game.roll += (0 - game.roll) * Math.min(1, 8 * dt);
      game.whipYaw += (0 - game.whipYaw) * Math.min(1, 8 * dt);
      if (game.v > 15 && Math.random() < dt * 8) {
        particles.dust(bikePos.x, bikePos.y - 0.2, bikePos.z, 2);
      }
    }
  } else {
    // ---- 공중 ----
    game.airTime += dt;
    game.s += game.airVX * dt;
    const prevY = game.y;
    game.vy -= G * dt;
    game.y += game.vy * dt;

    if (game.trick) {
      const tr = game.trick;
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      if (tr.kind === 'flip') {
        game.pitch += tr.dir * (Math.PI * 2 / tr.dur) * dt;
      } else if (tr.kind === 'roll') {
        game.roll = tr.dir * Math.PI * 2 * k;
      } else if (tr.kind === 'whip') {
        game.whipYaw = tr.dir * Math.sin(Math.PI * k) * 1.15;
        game.roll = tr.dir * Math.sin(Math.PI * k) * 0.5;
      } else if (tr.kind === 'scissor') {
        game.whipYaw = Math.sin(Math.PI * 2 * k) * 0.85;
        game.roll = Math.sin(Math.PI * 2 * k) * 0.35;
      }
      // superman: 회전 없음 — 포즈만
      if (tr.t >= tr.dur) {
        game.airBank += tr.pts;
        game.airTrickNames.push(tr.name);
        game.tricksDone++;
        popup(tr.name + ' +' + tr.pts, 'trick');
        if (tr.kind === 'roll') game.roll = 0;
        if (tr.kind === 'whip' || tr.kind === 'scissor') game.whipYaw = 0;
        game.trick = null;
        audio.trick();
      }
    } else {
      game.pitchVel *= Math.exp(-0.6 * spec.stability * dt);
      game.pitch += game.pitchVel * dt;
      game.whipYaw += (0 - game.whipYaw) * Math.min(1, 3 * dt);
      game.roll += (0 - game.roll) * Math.min(1, 3 * dt);
    }

    const g2 = track.groundAt(game.s);
    // 착지: 하강 접촉 / 이번 프레임 하향 교차(상승 중 램프 측면) / 터널링 폴백
    if (g2 !== null && (
      (game.y <= g2 + 0.02 && game.vy <= 0.5) ||
      (prevY >= g2 && game.y < g2) ||
      (game.y < g2 - 0.5)
    )) {
      game.y = g2;
      game.airborne = false;
      evaluateLanding(track.slopeAt(game.s));
      if (!game.crashed) game.vy = 0;
    } else if (g2 === null && game.y < 0.25) {
      doCrash(true);
      return;
    }
  }

  if (game.s >= track.finishS && game.phase === 'run') finishRun();

  updateBikeVisual(dt);
}

function takeOff(held, slope, cos) {
  game.airborne = true;
  game.airTime = 0;
  game.airVX = game.v * cos;
  game.vy = game.v * cos * Math.max(0, slope);

  let nearLip = null;
  for (const lip of track.lips) {
    if (Math.abs(lip.s - game.s) < 3.5) { nearLip = lip; break; }
  }
  if (nearLip) {
    const dRel = nearLip.s - game.releasedS;
    const recent = (game.raceTime - game.releasedAt) < 1.6;
    if (!held && recent && dRel > 0 && dRel < POP_WINDOW) {
      const perfect = dRel < POP_PERFECT;
      game.vy *= perfect ? 1.30 : 1.20;
      game.pitchVel = -0.25;
      game.airBank += perfect ? 150 : 80;
      popup(perfect ? 'PERFECT POP +150' : 'CLEAN POP +80', perfect ? 'perfect' : 'good');
      audio.pop();
      cam.kick(0.2);
    } else if (held) {
      game.pitchVel = 1.85 / spec.stability;
      popup('TOO MUCH GAS!', 'warn');
    } else {
      game.pitchVel = 0.45;
    }
    game.predictedAir = 2 * game.vy / G + (nearLip.size === 'big' ? 0.55 : 0.25);
  } else {
    game.pitchVel = held ? 0.5 : 0.15;
    game.predictedAir = Math.max(0.1, 2 * game.vy / G);
  }
}

function finishRun() {
  game.phase = 'finish';
  game.finishTimer = 0;
  audio.finish();
  flash('#ffffff', 200);
  const par = track.length / PACE_SPEED;
  const bonus = Math.max(0, Math.round((par - game.raceTime) * TIME_BONUS_RATE));
  const total = game.stunt + bonus;
  $('resTime').textContent = game.raceTime.toFixed(1) + 's';
  $('resStunt').textContent = game.stunt.toLocaleString();
  $('resBonus').textContent = '+' + bonus.toLocaleString();
  $('resTotal').textContent = total.toLocaleString();
  $('resTricks').textContent = game.tricksDone + '회 / 최장 에어 ' + game.bestAir.toFixed(1) + 's';
  setTimeout(() => elResults.classList.add('show'), 1100);
}

// ---------- 비주얼 갱신 ----------
function updateBikeVisual(dt) {
  track.posAt(game.s, bikePos);
  track.dirAt(game.s, bikeDir);
  bikePos.y = game.y;
  bikeM.group.position.copy(bikePos);
  bikeM.group.rotation.y = Math.atan2(bikeDir.x, bikeDir.z);
  bikeM.tilt.rotation.x = -game.pitch;
  bikeM.tilt.rotation.z = game.roll + track.bermAt(game.s) * -0.18;
  bikeM.wheeliePivot.rotation.x = -game.wheelie;
  bikeM.model.rotation.y = game.whipYaw;
  bikeM.setWheelSpin(game.v * dt / 0.32);

  // 라이더 포즈 선택
  if (!game.crashed) {
    let pose = 'sit';
    if (game.airborne) {
      pose = 'air';
      if (game.trick) {
        const k = game.trick.kind;
        if (k === 'flip' || k === 'roll') pose = 'tuck';
        else if (k === 'whip') pose = game.trick.dir < 0 ? 'whipL' : 'whipR';
        else if (k === 'scissor') pose = 'scissor';
        else if (k === 'superman') pose = 'superman';
      }
    } else if (game.wheelie > 0.3) pose = 'wheelie';
    else if (game.v > 17) pose = 'crouch';
    bikeM.applyPose(pose, dt, game.airborne ? 10 : 7);
  }
}

// ---------- HUD ----------
let lastGraph = 0;
function updateHUD(time) {
  if (game.phase === 'run') {
    elTime.textContent = game.raceTime.toFixed(1);
    elScore.textContent = game.stunt.toLocaleString();
  }
  elWarn.classList.toggle('show', game.phase === 'run' && game.wheelie > 0.45 && !game.crashed);

  let barShown = false;
  if (game.phase === 'run' && !game.airborne && !game.crashed) {
    let next = null;
    for (const lip of track.lips) {
      if (lip.s > game.s && lip.s - game.s < BAR_RANGE) { next = lip; break; }
    }
    if (next) {
      barShown = true;
      const p = 1 - (next.s - game.s) / BAR_RANGE;
      elNeedle.style.left = (p * 100).toFixed(1) + '%';
      elJumpbar.classList.toggle('inzone', next.s - game.s < POP_WINDOW);
    }
  }
  elJumpbar.classList.toggle('show', barShown);

  // 속도 그래프 (좌측, 최근 6초)
  if (time - lastGraph > 1 / 30) {
    lastGraph = time;
    game.speedHist.push(game.v);
    if (game.speedHist.length > 180) game.speedHist.shift();
    const w = speedCanvas.width, h = speedCanvas.height;
    sctx.clearRect(0, 0, w, h);
    sctx.strokeStyle = 'rgba(255,255,255,0.15)';
    sctx.lineWidth = 1;
    for (let yv = 0; yv <= 30; yv += 10) {
      const yy = h - 4 - (yv / 30) * (h - 10);
      sctx.beginPath(); sctx.moveTo(0, yy); sctx.lineTo(w, yy); sctx.stroke();
    }
    sctx.strokeStyle = '#3fe0d8';
    sctx.lineWidth = 2;
    sctx.beginPath();
    const n = game.speedHist.length;
    for (let i = 0; i < n; i++) {
      const x = (i / 179) * w;
      const yy = h - 4 - (Math.min(30, game.speedHist[i]) / 30) * (h - 10);
      if (i === 0) sctx.moveTo(x, yy); else sctx.lineTo(x, yy);
    }
    sctx.stroke();
    elSpeedNum.textContent = Math.round(game.v * 3.6);
  }
}

// ---------- UI 바인딩 ----------
document.querySelectorAll('.bikeCard').forEach((c, i) => {
  c.addEventListener('pointerdown', (e) => e.stopPropagation());
  c.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); selectBike(i); });
});
$('startBtn').addEventListener('click', (e) => { e.stopPropagation(); startRun(); });
$('btnRetry').addEventListener('click', (e) => { e.stopPropagation(); newGame(game.seed); });
$('btnNew').addEventListener('click', (e) => { e.stopPropagation(); newGame((Math.random() * 0xffffffff) >>> 0); });
for (const id of ['startBtn', 'btnRetry', 'btnNew']) {
  $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
}

// ---------- 메인 루프 ----------
let lastT = performance.now();
let introSpin = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(1 / 30, (nowMs - lastT) / 1000);
  lastT = nowMs;
  const time = nowMs / 1000;

  step(dt);
  particles.update(dt);

  if (game.phase === 'intro') {
    introSpin += dt * 0.22;
    track.posAt(14, tmpV);
    camera.position.set(
      tmpV.x + Math.sin(introSpin) * 16,
      tmpV.y + 7 + Math.sin(introSpin * 0.7) * 2,
      tmpV.z + Math.cos(introSpin) * 16
    );
    camera.lookAt(tmpV.x, tmpV.y + 1, tmpV.z);
    applyFov(62);
  } else if (game.phase === 'finish') {
    game.finishTimer += dt;
    game.v = Math.max(0, game.v - 8 * dt);
    game.s += game.v * dt;
    const g = track.groundAt(game.s);
    if (g !== null) game.y = g;
    updateBikeVisual(dt);
    if (!game.crashed) bikeM.applyPose('sit', dt, 5);
    introSpin += dt * 0.3;
    camera.position.set(
      bikePos.x + Math.sin(introSpin) * 10,
      bikePos.y + 4,
      bikePos.z + Math.cos(introSpin) * 10
    );
    camera.lookAt(bikePos.x, bikePos.y + 1, bikePos.z);
    applyFov(56);
  } else {
    const turnRate = track.bermAt(game.s) * 0.045 * game.v * 0.04;
    cam.update({
      bikePos, dir: bikeDir, speed: game.v,
      airborne: game.airborne, airTime: game.airTime,
      predictedAir: game.airborne ? game.predictedAir : 0,
      floatZone: track.typeAt(game.s) === T.FLOAT,
      turnRate, dt, time,
      crashed: game.crashed, finished: false,
    });
    applyFov(cam.fov);
  }

  // 디버그: 클로즈업 카메라 (스크린샷 검수용)
  if (window.__closeup) {
    const a = performance.now() / 4000;
    camera.position.set(
      bikePos.x + Math.sin(a) * 2.8,
      bikePos.y + 1.0,
      bikePos.z + Math.cos(a) * 2.8
    );
    camera.lookAt(bikePos.x, bikePos.y + 0.72, bikePos.z);
    camera.fov = 42;
    camera.updateProjectionMatrix();
  }

  world.update(time, bikePos, game.s);
  audio.engine(game.v, input.held && game.phase === 'run' && !game.crashed, game.airborne, game.phase === 'run');
  updateHUD(time);
  composer.render();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend(); else audio.resume();
});

newGame(game.seed);
requestAnimationFrame(frame);

// 디버그/테스트 훅
window.__bike = {
  get: () => {
    let lipDist = 999;
    for (const lip of track.lips) {
      if (lip.s > game.s) { lipDist = lip.s - game.s; break; }
    }
    return {
      phase: game.phase, s: game.s, v: game.v, y: game.y,
      airborne: game.airborne, crashed: game.crashed,
      stunt: game.stunt, time: game.raceTime,
      trackLen: track.length, finishS: track.finishS,
      spec: spec.id, lipDist, airTime: game.airTime,
      predictedAir: game.predictedAir, trick: !!game.trick,
      drawCalls: renderer.info.render.calls,
    };
  },
  start: startRun,
  selectBike,
  gesture: (g) => {
    if (game.phase === 'run' && game.airborne && !game.crashed && !game.trick && TRICKS[g]) {
      game.trick = { ...TRICKS[g], t: 0 };
    }
  },
  newGame: (seed) => newGame(seed >>> 0),
};
