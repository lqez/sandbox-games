// main.js — PURATANK 파츠/런너/조립 애니메이션 뷰어 (런너 A/B 2장 체제)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { plasticMaterial } from './plamo.js';
import { buildRunner } from './runner.js';
import { buildRenaultFT } from './tanks/renault-ft.js';
import { buildMark4 } from './tanks/mark4.js';
import { buildT34 } from './tanks/t34.js';
import { buildTiger1 } from './tanks/tiger1.js';

const BUILDERS = { ft: buildRenaultFT, mk4: buildMark4, t34: buildT34, tiger: buildTiger1 };
const RUNNER_KEYS = ['A', 'B'];

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1efe9);
scene.fog = new THREE.Fog(0xf1efe9, 80, 160);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
camera.position.set(15, 10, 19);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 3.2, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.52;

// ---------------------------------------------------------------- lights & floor
scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc6ba, 0.85));
const key = new THREE.DirectionalLight(0xfff1de, 2.4);
key.position.set(9, 16, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -30;
key.shadow.camera.right = key.shadow.camera.top = 30;
key.shadow.bias = -0.0004;
scene.add(key);
const fill = new THREE.DirectionalLight(0xd7e4ff, 0.7);
fill.position.set(-10, 7, -3);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.55);
rim.position.set(-4, 9, -12);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(80, 48),
  new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ---------------------------------------------------------------- state
const content = new THREE.Group(); // 현재 표시물 전체
scene.add(content);

let state = null; // { def, holders, runnerRoots, runnerData, tankRoot, duration }
let mode = 'done';
let tankKey = 't34';
let animT = 0;
let playing = false;
let spin = true;

const POP = 0.28, FLY = 0.8, STAGGER = 0.3;

function euler(arr) { return new THREE.Euler(arr[0], arr[1], arr[2]); }

function clearContent() {
  content.clear();
  content.rotation.set(0, 0, 0);
}

function buildState(keyName) {
  const def = BUILDERS[keyName]();
  const runnerMat = plasticMaterial(def.color);
  const runnerData = {}, runnerRoots = {};
  for (const rk of RUNNER_KEYS) {
    const subset = def.parts.filter((p) => p.runner === rk);
    if (!subset.length) continue;
    runnerData[rk] = buildRunner(subset, runnerMat, { width: def.runnerWidths[rk], label: rk });
    runnerRoots[rk] = new THREE.Group();
    runnerRoots[rk].add(runnerData[rk].group);
  }
  const tankRoot = new THREE.Group();

  const holders = def.parts
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((part) => {
      const holder = new THREE.Group();
      holder.add(part.mesh);
      const slot = runnerData[part.runner].slots.get(part.id);
      return { part, holder, slot, runnerKey: part.runner };
    });

  const duration = STAGGER * (holders.length - 1) + POP + FLY;
  return { def, holders, runnerRoots, runnerData, tankRoot, duration };
}

function placeOnRunner(h) {
  h.holder.position.copy(h.slot.pos);
  h.holder.quaternion.setFromEuler(h.slot.rot);
  h.holder.scale.setScalar(1);
}
function placeAssembled(h) {
  h.holder.position.set(...h.part.assembled.pos);
  h.holder.quaternion.setFromEuler(euler(h.part.assembled.rot));
  h.holder.scale.setScalar(1);
}

// ---------------------------------------------------------------- modes
function setView(nextTank, nextMode) {
  tankKey = nextTank;
  mode = nextMode;
  clearContent();
  document.getElementById('scrub-wrap').style.display = mode === 'build' ? 'flex' : 'none';
  setCaption('');

  if (mode === 'lineup') {
    const xs = { ft: -16.5, mk4: -5.5, t34: 5.5, tiger: 16.5 };
    for (const k of ['ft', 'mk4', 't34', 'tiger']) {
      const s = buildState(k);
      s.tankRoot.position.set(xs[k], 0, 0);
      s.tankRoot.rotation.y = 0.5;
      for (const h of s.holders) {
        placeAssembled(h);
        s.tankRoot.add(h.holder);
      }
      content.add(s.tankRoot);
    }
    state = null;
    frameCamera(new THREE.Vector3(0, 3.4, 0), 45, [0.12, 0.5, 1.0]);
    updateUI();
    return;
  }

  state = buildState(tankKey);
  const rd = state.runnerData;

  if (mode === 'runner') {
    // A/B 런너를 나란히 세워 표시
    const gap = 2.2;
    const totalW = rd.A.w + rd.B.w + gap;
    let x = -totalW / 2;
    let maxH = 0;
    for (const rk of RUNNER_KEYS) {
      state.runnerRoots[rk].position.set(x + rd[rk].w / 2, rd[rk].h / 2 + 1.4, 0);
      x += rd[rk].w + gap;
      maxH = Math.max(maxH, rd[rk].h);
      content.add(state.runnerRoots[rk]);
    }
    for (const h of state.holders) {
      placeOnRunner(h);
      state.runnerRoots[h.runnerKey].add(h.holder);
    }
    const dist = Math.max(totalW * 1.05, maxH * 1.7) + 6;
    frameCamera(new THREE.Vector3(0, maxH / 2 + 1.6, 0), dist, [0.25, 0.28, 1.0]);
  } else if (mode === 'done') {
    for (const h of state.holders) {
      placeAssembled(h);
      state.tankRoot.add(h.holder);
    }
    content.add(state.tankRoot);
    frameCamera(new THREE.Vector3(0, 3.6, 0), 22);
  } else if (mode === 'build') {
    state.runnerRoots.A.position.set(-16, rd.A.h / 2 + 1.2, -4);
    state.runnerRoots.A.rotation.y = 0.5;
    state.runnerRoots.B.position.set(-6.5, rd.B.h / 2 + 1.2, -7.5);
    state.runnerRoots.B.rotation.y = 0.5;
    state.tankRoot.position.set(7, 0, 0.5);
    state.tankRoot.rotation.y = -0.35;
    content.add(state.runnerRoots.A, state.runnerRoots.B, state.tankRoot);
    for (const h of state.holders) content.add(h.holder);
    animT = 0;
    playing = true;
    applyBuild(0);
    frameCamera(new THREE.Vector3(-2, 4.8, -1), 36);
  }
  updateUI();
}

function frameCamera(target, dist, dirArr = [0.62, 0.42, 0.78]) {
  controls.target.copy(target);
  const dir = new THREE.Vector3(...dirArr).normalize();
  camera.position.copy(target.clone().addScaledVector(dir, dist));
}

// ---------------------------------------------------------------- build animation
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

function worldPose(root, pos, rot) {
  root.updateMatrixWorld(true);
  _m.compose(pos, _q.setFromEuler(rot), new THREE.Vector3(1, 1, 1));
  const w = root.matrixWorld.clone().multiply(_m);
  const p = new THREE.Vector3(), q2 = new THREE.Quaternion(), s = new THREE.Vector3();
  w.decompose(p, q2, s);
  return { p, q: q2 };
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function applyBuild(t) {
  if (!state) return;
  let captionSet = false;
  state.holders.forEach((h, i) => {
    const start = i * STAGGER;
    const local = t - start;
    const runnerRoot = state.runnerRoots[h.runnerKey];
    const startPose = worldPose(runnerRoot, h.slot.pos, h.slot.rot);
    const endPose = worldPose(
      state.tankRoot,
      new THREE.Vector3(...h.part.assembled.pos),
      euler(h.part.assembled.rot)
    );
    const runnerNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(runnerRoot.quaternion);

    if (local <= 0) {
      h.holder.position.copy(startPose.p);
      h.holder.quaternion.copy(startPose.q);
      h.holder.scale.setScalar(1);
      return;
    }
    if (local < POP) {
      // 게이트에서 톡 — 런너 법선 방향으로 빠진다
      const k = easeOut(local / POP);
      h.holder.position.copy(startPose.p).addScaledVector(runnerNormal, k * 1.7);
      h.holder.quaternion.copy(startPose.q);
      h.holder.scale.setScalar(1);
      if (!captionSet) { setCaption(`${h.part.id} · ${h.part.name}`); captionSet = true; }
      return;
    }
    if (local < POP + FLY) {
      const k = easeInOut((local - POP) / FLY);
      const a = startPose.p.clone().addScaledVector(runnerNormal, 1.7);
      const b = endPose.p;
      const ctrl = a.clone().lerp(b, 0.5);
      ctrl.y = Math.max(a.y, b.y) + 3.0;
      // 2차 베지어
      const p1 = a.clone().lerp(ctrl, k), p2 = ctrl.clone().lerp(b, k);
      h.holder.position.copy(p1.lerp(p2, k));
      h.holder.quaternion.copy(startPose.q).slerp(endPose.q, k);
      // 착지 직전 통통 바운스
      const u = (k - 0.82) / 0.18;
      h.holder.scale.setScalar(u > 0 ? 1 + Math.sin(Math.PI * Math.min(1, u)) * 0.09 : 1);
      if (!captionSet) { setCaption(`${h.part.id} · ${h.part.name}`); captionSet = true; }
      return;
    }
    h.holder.position.copy(endPose.p);
    h.holder.quaternion.copy(endPose.q);
    h.holder.scale.setScalar(1);
  });
  if (t >= state.duration && !captionSet) setCaption('조립 완료!');
  document.getElementById('scrub').value = String(
    Math.min(1, t / (state ? state.duration : 1))
  );
}

// ---------------------------------------------------------------- UI
const caption = document.getElementById('caption');
function setCaption(text) {
  caption.textContent = text;
  caption.style.opacity = text ? '1' : '0';
}

function updateUI() {
  document.querySelectorAll('[data-tank]').forEach((b) =>
    b.classList.toggle('on', b.dataset.tank === tankKey && mode !== 'lineup'));
  document.querySelectorAll('[data-mode]').forEach((b) =>
    b.classList.toggle('on', b.dataset.mode === mode));
}

document.querySelectorAll('[data-tank]').forEach((b) =>
  b.addEventListener('click', () => setView(b.dataset.tank, mode === 'lineup' ? 'done' : mode)));
document.querySelectorAll('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => setView(tankKey, b.dataset.mode)));
document.getElementById('replay').addEventListener('click', () => {
  if (mode !== 'build') setView(tankKey, 'build');
  else { animT = 0; playing = true; }
});
const scrub = document.getElementById('scrub');
scrub.addEventListener('input', () => {
  if (mode !== 'build' || !state) return;
  playing = false;
  animT = parseFloat(scrub.value) * state.duration;
  applyBuild(animT);
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mode === 'build' && playing && state) {
    animT = Math.min(animT + dt, state.duration + 0.5);
    applyBuild(animT);
    if (animT >= state.duration + 0.5) playing = false;
  }
  if ((mode === 'done' || mode === 'lineup') && spin) {
    content.rotation.y += dt * 0.35;
  }
  controls.update();
  renderer.render(scene, camera);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
setView(tankKey, mode);
tick();

// ---------------------------------------------------------------- 스크린샷/테스트 API
window.__pt = {
  setView: (t, m, at = null) => {
    spin = false;
    setView(t, m);
    content.rotation.y = 0;
    if (m === 'build' && at !== null && state) {
      playing = false;
      animT = at * state.duration;
      applyBuild(animT);
    }
    renderer.render(scene, camera);
    return 'ok';
  },
  orbit: (azimuth, polar, dist) => {
    const t = controls.target;
    camera.position.set(
      t.x + dist * Math.sin(polar) * Math.sin(azimuth),
      t.y + dist * Math.cos(polar),
      t.z + dist * Math.sin(polar) * Math.cos(azimuth)
    );
    controls.update();
    renderer.render(scene, camera);
    return 'ok';
  },
};
