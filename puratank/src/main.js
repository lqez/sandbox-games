// main.js — PURATANK 파츠/런너/조립 애니메이션 뷰어
// 조립 연출: 니퍼 커팅 → 게이트 자국(스텁) 남김 → 유리사포 다듬기 → 비행 → 딸깍 스냅
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
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

// ---------------------------------------------------------------- 공구 (니퍼 / 유리사포)
function makeNipper() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, metalness: 0.65, roughness: 0.3 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2f6bb0, roughness: 0.55 });
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.32, 1.15), metal);
    jaw.position.set(s * 0.11, 0, -0.62);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.62), metal);
    blade.position.set(s * 0.045, 0, -1.35);
    blade.rotation.y = -s * 0.16;
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.5, 4, 10), grip);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(s * 0.34, 0, 1.05);
    handle.rotation.z = s * 0.1;
    arm.add(jaw, blade, handle);
    arm.userData.side = s;
    arm.traverse((o) => { o.castShadow = true; });
    arms.push(arm);
    g.add(arm);
  }
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.4, 12), metal);
  g.add(bolt);
  g.userData.setJaw = (a) => arms.forEach((arm) => { arm.rotation.y = arm.userData.side * a; });
  g.scale.setScalar(2.3);
  g.visible = false;
  return g;
}

function makeGlassFile() {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xaadfee, transparent: true, opacity: 0.55,
    roughness: 0.12, metalness: 0, side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.2, 3.6), glass);
  const tip = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.21, 0.75),
    new THREE.MeshStandardMaterial({ color: 0xf3f6f8, roughness: 0.4 })
  );
  tip.position.z = 1.85;
  g.add(body, tip);
  g.visible = false;
  return g;
}

const nipper = makeNipper();
const glassFile = makeGlassFile();
scene.add(nipper, glassFile);

// 딸깍 스냅 링 이펙트 풀
const snapPool = [];
for (let i = 0; i < 8; i++) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.06, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false })
  );
  ring.visible = false;
  scene.add(ring);
  snapPool.push(ring);
}

// ---------------------------------------------------------------- state
const content = new THREE.Group(); // 현재 표시물 전체
scene.add(content);

let state = null;
let mode = 'done';
let tankKey = 't34';
let animT = 0;
let playing = false;
let spin = true;

// 파츠당 단계: 커팅(니퍼) → 사포질 → 비행. 스태거 = 공구가 한 파츠씩 처리하는 파이프라인.
const CUT = 0.55, SAND = 0.55, FLY = 0.6, STAGGER = 0.55;

function euler(arr) { return new THREE.Euler(arr[0], arr[1], arr[2]); }
const ZERO_E = new THREE.Euler();

function clearContent() {
  content.clear();
  content.rotation.set(0, 0, 0);
}

function setStubs(part, scale, visible = true) {
  if (!part.gateStubs) return;
  for (const s of part.gateStubs) {
    s.visible = visible && scale > 0.02;
    s.scale.setScalar(Math.max(0.001, scale));
  }
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

  const duration = STAGGER * (holders.length - 1) + CUT + SAND + FLY;
  return { def, holders, runnerRoots, runnerData, tankRoot, duration };
}

function placeOnRunner(h) {
  h.holder.position.copy(h.slot.pos);
  h.holder.quaternion.setFromEuler(h.slot.rot);
  h.holder.scale.setScalar(1);
  setStubs(h.part, 1);
}
function placeAssembled(h) {
  h.holder.position.set(...h.part.assembled.pos);
  h.holder.quaternion.setFromEuler(euler(h.part.assembled.rot));
  h.holder.scale.setScalar(1);
  setStubs(h.part, 1, false); // 완성품 — 사포로 다듬어 자국 없음
}

// ---------------------------------------------------------------- modes
function setView(nextTank, nextMode) {
  tankKey = nextTank;
  mode = nextMode;
  clearContent();
  nipper.visible = glassFile.visible = false;
  snapPool.forEach((r) => (r.visible = false));
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
    state.runnerRoots.A.position.set(-16, rd.A.h / 2 + 0.6, -4);
    state.runnerRoots.A.rotation.x = -0.12;
    state.runnerRoots.A.rotation.y = 0.5;
    state.runnerRoots.B.position.set(-6.5, rd.B.h / 2 + 0.6, -7.5);
    state.runnerRoots.B.rotation.x = -0.12;
    state.runnerRoots.B.rotation.y = 0.5;
    state.tankRoot.position.set(7, 0, 0.5);
    state.tankRoot.rotation.y = -0.35;
    content.add(state.runnerRoots.A, state.runnerRoots.B, state.tankRoot);
    for (const h of state.holders) content.add(h.holder);
    animT = 0;
    playing = true;
    applyBuild(0);
    frameCamera(new THREE.Vector3(-3.5, 6.5, -2), 46, [0.5, 0.52, 0.72]);
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
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 니퍼: 게이트로 접근 → 날 닫힘(커팅) → 후퇴
function poseNipper(gate, normal, k) {
  nipper.visible = true;
  let d;
  if (k < 0.35) d = 2.4 - 1.9 * easeOut(k / 0.35);
  else if (k < 0.85) d = 0.5;
  else d = 0.5 + ((k - 0.85) / 0.15) * 1.9;
  nipper.position.copy(gate).addScaledVector(normal, d);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.55)));
  nipper.quaternion.copy(q);
  let jaw;
  if (k < 0.35) jaw = 0.5;
  else if (k < 0.55) jaw = 0.5 - 0.46 * ((k - 0.35) / 0.2);
  else if (k < 0.85) jaw = 0.04;
  else jaw = 0.4;
  nipper.userData.setJaw(jaw);
}

// 유리사포: 파츠 가장자리를 왕복하며 게이트 자국을 다듬는다
function poseFile(partPos, normal, k) {
  glassFile.visible = true;
  const up = new THREE.Vector3(0, 1, 0);
  const strokeDir = new THREE.Vector3().crossVectors(normal, up).normalize();
  const stroke = Math.sin(k * Math.PI * 3) * 0.85;
  glassFile.position
    .copy(partPos)
    .addScaledVector(strokeDir, stroke)
    .addScaledVector(normal, 0.5)
    .addScaledVector(up, 0.3 + Math.abs(Math.cos(k * Math.PI * 3)) * 0.06);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), strokeDir);
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0, 0.1)));
  glassFile.quaternion.copy(q);
}

function applyBuild(t) {
  if (!state) return;
  let captionText = null;
  let nipperSet = false, fileSet = false;
  let snapIdx = 0;
  snapPool.forEach((r) => (r.visible = false));

  state.holders.forEach((h, i) => {
    const local = t - i * STAGGER;
    const runnerRoot = state.runnerRoots[h.runnerKey];
    const startPose = worldPose(runnerRoot, h.slot.pos, h.slot.rot);
    const endPose = worldPose(
      state.tankRoot,
      new THREE.Vector3(...h.part.assembled.pos),
      euler(h.part.assembled.rot)
    );
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(runnerRoot.quaternion);
    const label = `${h.part.id} · ${h.part.name}`;

    if (local <= 0) {
      h.holder.position.copy(startPose.p);
      h.holder.quaternion.copy(startPose.q);
      h.holder.scale.setScalar(1);
      setStubs(h.part, 1);
      return;
    }

    const popPos = startPose.p.clone().addScaledVector(normal, 1.6);
    const sandPos = popPos.clone().addScaledVector(normal, 1.0);
    sandPos.y += 0.9;

    // ── ① 니퍼 커팅
    if (local < CUT) {
      setStubs(h.part, 1);
      const k = local / CUT;
      if (!nipperSet) {
        const gateWorld = worldPose(runnerRoot, h.slot.pos.clone().add(h.slot.gate), ZERO_E).p;
        poseNipper(gateWorld, normal, k);
        nipperSet = true;
        if (!captionText) captionText = `✂ ${label} — 니퍼 커팅`;
      }
      if (k < 0.65) {
        h.holder.position.copy(startPose.p);
      } else {
        const u = easeOut((k - 0.65) / 0.35);
        h.holder.position.copy(startPose.p).lerp(popPos, u);
      }
      h.holder.quaternion.copy(startPose.q);
      h.holder.scale.setScalar(1);
      return;
    }

    // ── ② 유리사포 다듬기 (게이트 자국 제거)
    if (local < CUT + SAND) {
      const k = (local - CUT) / SAND;
      const move = easeOut(clamp01(k / 0.22));
      h.holder.position.copy(popPos).lerp(sandPos, move);
      // 사포질 반동
      h.holder.position.x += Math.sin(k * Math.PI * 6) * 0.04;
      h.holder.quaternion.copy(startPose.q).slerp(endPose.q, 0.25 * k);
      h.holder.scale.setScalar(1);
      setStubs(h.part, 1 - clamp01((k - 0.2) / 0.65));
      if (!fileSet) {
        poseFile(h.holder.position, normal, k);
        fileSet = true;
        if (!captionText) captionText = `${label} — 유리사포로 게이트 자국 정리`;
      }
      return;
    }

    // ── ③ 비행 + 착지
    if (local < CUT + SAND + FLY) {
      const k = easeInOut((local - CUT - SAND) / FLY);
      setStubs(h.part, 0, false);
      const a = sandPos, b = endPose.p;
      const ctrl = a.clone().lerp(b, 0.5);
      ctrl.y = Math.max(a.y, b.y) + 2.8;
      const p1 = a.clone().lerp(ctrl, k), p2 = ctrl.clone().lerp(b, k);
      h.holder.position.copy(p1.lerp(p2, k));
      const q0 = startPose.q.clone().slerp(endPose.q, 0.25);
      h.holder.quaternion.copy(q0).slerp(endPose.q, k);
      const u = (k - 0.82) / 0.18;
      h.holder.scale.setScalar(u > 0 ? 1 + Math.sin(Math.PI * Math.min(1, u)) * 0.09 : 1);
      if (!captionText) captionText = label;
      return;
    }

    // ── 착지 완료 (+ 딸깍 스냅 링)
    h.holder.position.copy(endPose.p);
    h.holder.quaternion.copy(endPose.q);
    h.holder.scale.setScalar(1);
    setStubs(h.part, 0, false);
    const landT = i * STAGGER + CUT + SAND + FLY;
    const ph = (t - landT) / 0.3;
    if (ph > 0 && ph < 1 && snapIdx < snapPool.length) {
      const ring = snapPool[snapIdx++];
      ring.visible = true;
      ring.position.copy(endPose.p);
      ring.quaternion.copy(camera.quaternion);
      ring.scale.setScalar(0.5 + ph * 1.6);
      ring.material.opacity = (1 - ph) * 0.85;
    }
  });

  if (!nipperSet) nipper.visible = false;
  if (!fileSet) glassFile.visible = false;
  if (t >= state.duration && !captionText) captionText = '조립 완료!';
  setCaption(captionText || '');
  document.getElementById('scrub').value = String(
    Math.min(1, t / (state ? state.duration : 1))
  );
}

// ---------------------------------------------------------------- GLTF 내보내기
function exportGlb(download = true) {
  return new Promise((resolve, reject) => {
    const s = buildState(tankKey);
    const root = new THREE.Group();
    for (const h of s.holders) {
      placeAssembled(h);
      root.add(h.holder);
    }
    new GLTFExporter().parse(
      root,
      (result) => {
        if (download) {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `puratank-${tankKey}.glb`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
        resolve(result.byteLength ?? 0);
      },
      (err) => reject(err),
      { binary: true }
    );
  });
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
document.getElementById('export').addEventListener('click', () => exportGlb(true));
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
  buildAtSec: (t, sec) => {
    spin = false;
    setView(t, 'build');
    content.rotation.y = 0;
    playing = false;
    animT = sec;
    applyBuild(animT);
    renderer.render(scene, camera);
    return 'ok';
  },
  exportGlb: () => exportGlb(false),
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
