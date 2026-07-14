// main.js — PURATANK 파츠/런너/조립 애니메이션 뷰어
// 조립 연출: 박스 오픈 → 런너 꺼내기(작업대/거치) → 니퍼 커팅 → 유리사포 → 비행 → 딸깍 스냅
// 커팅 중인 런너만 작업대에 서고, 나머지는 박스에 기대 세워둔다.
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
const BOX_TITLES = {
  ft: ['RENAULT FT', 'WWI FRENCH LIGHT TANK'],
  mk4: ['MARK IV', 'WWI BRITISH HEAVY TANK'],
  t34: ['T-34', 'SOVIET MEDIUM TANK'],
  tiger: ['TIGER I', 'GERMAN HEAVY TANK'],
};
const BOX_SKIES = {
  ft: ['#f2d9a6', '#c08a4c'],
  mk4: ['#d8dcc0', '#84905e'],
  t34: ['#c2e4f2', '#5f97c4'],
  tiger: ['#f2e2bd', '#c99e57'],
};

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1efe9);
scene.fog = new THREE.Fog(0xf1efe9, 90, 180);

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
key.shadow.camera.left = key.shadow.camera.bottom = -34;
key.shadow.camera.right = key.shadow.camera.top = 34;
key.shadow.bias = -0.0004;
scene.add(key);
const fill = new THREE.DirectionalLight(0xd7e4ff, 0.7);
fill.position.set(-10, 7, -3);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.55);
rim.position.set(-4, 9, -12);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(90, 48),
  new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ---------------------------------------------------------------- 공구 (니퍼 / 유리사포)
function makeNipper() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, metalness: 0.65, roughness: 0.3 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2f6bb0, roughness: 0.55 });
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.36, 1.15), metal);
    jaw.position.set(s * 0.12, 0, -0.62);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.32, 0.66), metal);
    blade.position.set(s * 0.05, 0, -1.36);
    blade.rotation.y = -s * 0.16;
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 1.7, 4, 10), grip);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(s * 0.38, 0, 1.15);
    handle.rotation.z = s * 0.1;
    arm.add(jaw, blade, handle);
    arm.userData.side = s;
    arm.traverse((o) => { o.castShadow = true; });
    arms.push(arm);
    inner.add(arm);
  }
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.46, 12), metal);
  inner.add(bolt);
  inner.position.z = 1.72; // 원점을 날 끝으로 이동
  g.add(inner);
  g.userData.setJaw = (a) => arms.forEach((arm) => { arm.rotation.y = arm.userData.side * a; });
  g.scale.setScalar(4.2); // 실제 니퍼 크기감 (SD 킷 대비 큼직하게)
  g.visible = false;
  return g;
}

function makeGlassFile() {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xaadfee, transparent: true, opacity: 0.55,
    roughness: 0.12, metalness: 0, side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 4.2), glass);
  const tip = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.24, 0.85),
    new THREE.MeshStandardMaterial({ color: 0xf3f6f8, roughness: 0.4 })
  );
  tip.position.z = 2.15;
  g.add(body, tip);
  g.scale.setScalar(1.35);
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

// ---------------------------------------------------------------- 박스 (타미야/아카데미풍 박스아트)
// 완성 모델을 히어로 앵글로 렌더링해 캔버스 박스아트에 합성한다.
function renderHeroShot(defKey) {
  const s2 = buildState(defKey);
  const root = new THREE.Group();
  for (const h of s2.holders) {
    placeAssembled(h);
    root.add(h.holder);
  }
  root.rotation.y = 0.65;
  const sc = new THREE.Scene();
  sc.add(root);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x998f7a, 0.9));
  const dl = new THREE.DirectionalLight(0xfff2dd, 2.6);
  dl.position.set(6, 10, 8);
  sc.add(dl);
  const dl2 = new THREE.DirectionalLight(0xbcd8ff, 1.0);
  dl2.position.set(-8, 4, -4);
  sc.add(dl2);
  const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 200);
  cam.position.set(10.5, 5.5, 14.5);
  cam.lookAt(0, 3.4, 0);

  const W = 640, H = 480;
  const rt = new THREE.WebGLRenderTarget(W, H);
  const prevRT = renderer.getRenderTarget();
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(sc, cam);
  const buf = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  renderer.setRenderTarget(prevRT);
  rt.dispose();

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeBoxArtTexture(defKey) {
  const hero = renderHeroShot(defKey);
  const [title, sub] = BOX_TITLES[defKey];
  const [skyTop, skyBottom] = BOX_SKIES[defKey];
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 768;
  const ctx = c.getContext('2d');

  // 바탕 + 테두리
  ctx.fillStyle = '#f6f2e7';
  ctx.fillRect(0, 0, 1024, 768);
  // 아트 영역 (하늘 그라데이션 + 지면)
  const ax = 26, ay = 108, aw = 972, ah = 610;
  const grad = ctx.createLinearGradient(0, ay, 0, ay + ah);
  grad.addColorStop(0, skyTop);
  grad.addColorStop(1, skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(ax, ay, aw, ah);
  ctx.fillStyle = 'rgba(60,45,25,0.28)';
  ctx.beginPath();
  ctx.ellipse(520, ay + ah - 40, 430, 90, 0, 0, Math.PI * 2);
  ctx.fill();
  // 액션 스트릭
  ctx.save();
  ctx.translate(510, 400);
  ctx.rotate(-0.12);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (const [sx, sy, sw] of [[-460, -120, 300], [-430, 30, 240], [120, -180, 330], [180, 90, 260]]) {
    ctx.fillRect(sx, sy, sw, 14);
  }
  ctx.restore();
  // 히어로 렌더 합성
  ctx.drawImage(hero, 150, ay - 10, 780, 585);
  // 로고 밴드 (상단)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1024, 92);
  ctx.fillStyle = '#d0342c';
  ctx.fillRect(26, 14, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 44px sans-serif';
  ctx.fillText('P', 44, 62);
  ctx.fillStyle = '#2b2723';
  ctx.font = '900 52px sans-serif';
  ctx.fillText('PURATANK', 112, 62);
  ctx.fillStyle = '#8b8378';
  ctx.font = '700 22px sans-serif';
  ctx.fillText('SD SNAP KIT SERIES', 118, 86);
  ctx.fillStyle = '#d0342c';
  ctx.fillRect(0, 92, 1024, 10);
  // 스케일 배지
  ctx.beginPath();
  ctx.arc(940, 180, 54, 0, Math.PI * 2);
  ctx.fillStyle = '#d0342c';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SD', 940, 196);
  ctx.textAlign = 'left';
  // 타이틀 (하단 좌측)
  ctx.font = '900 92px sans-serif';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeText(title, 44, 660);
  ctx.fillStyle = '#26221d';
  ctx.fillText(title, 44, 660);
  ctx.font = '800 30px sans-serif';
  ctx.lineWidth = 7;
  ctx.strokeText(sub, 48, 702);
  ctx.fillStyle = '#3d372f';
  ctx.fillText(sub, 48, 702);
  // 하단 밴드
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 718, 1024, 50);
  ctx.fillStyle = '#6b6356';
  ctx.font = '700 24px sans-serif';
  ctx.fillText('NO GLUE SNAP-FIT  ·  RUNNER A + B  ·  MADE OF PURA', 30, 752);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const BOX_W = 27, BOX_D = 23.5, BOX_H = 5.8, LID_H = 2.2;
function makeKitBox(artTex) {
  const card = new THREE.MeshStandardMaterial({ color: 0xf2ecdc, roughness: 0.82 });
  const cardIn = new THREE.MeshStandardMaterial({ color: 0xe4dac2, roughness: 0.85 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd0342c, roughness: 0.6 });
  const t = 0.35;
  // 트레이 (열린 상자)
  const tray = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(BOX_W, t, BOX_D), cardIn);
  tb.position.y = -BOX_H / 2 + t / 2;
  tray.add(tb);
  for (const [w, d, x, z] of [
    [BOX_W, t, 0, BOX_D / 2 - t / 2], [BOX_W, t, 0, -BOX_D / 2 + t / 2],
    [t, BOX_D - t * 2, -BOX_W / 2 + t / 2, 0], [t, BOX_D - t * 2, BOX_W / 2 - t / 2, 0],
  ]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, BOX_H, d), card);
    wall.position.set(x, 0, z);
    tray.add(wall);
  }
  tray.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  // 뚜껑 (원점 = 상판 중앙, 스커트는 아래로)
  const lid = new THREE.Group();
  const LW = BOX_W + 0.7, LD = BOX_D + 0.7;
  const top = new THREE.Mesh(new THREE.BoxGeometry(LW, t, LD), card);
  lid.add(top);
  for (const [w, d, x, z] of [
    [LW, t, 0, LD / 2 - t / 2], [LW, t, 0, -LD / 2 + t / 2],
    [t, LD - t * 2, -LW / 2 + t / 2, 0], [t, LD - t * 2, LW / 2 - t / 2, 0],
  ]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, LID_H, d), card);
    wall.position.set(x, -LID_H / 2, z);
    lid.add(wall);
  }
  // 측면 인쇄 밴드
  const band = new THREE.Mesh(new THREE.BoxGeometry(LW + 0.05, 0.75, LD + 0.05), red);
  band.position.y = -LID_H + 0.55;
  lid.add(band);
  // 박스아트 상판
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(LW - 0.3, LD - 0.3),
    new THREE.MeshBasicMaterial({ map: artTex })
  );
  art.rotation.x = -Math.PI / 2;
  art.position.y = t / 2 + 0.02;
  lid.add(art);
  lid.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  return { tray, lid };
}

// ---------------------------------------------------------------- state
const content = new THREE.Group();
scene.add(content);

let state = null;
let mode = 'done';
let tankKey = 't34';
let animT = 0;
let playing = false;
let spin = true;

// 타임라인: 박스 인트로 후 파츠당 커팅→사포→비행 파이프라인
const BOX = 3.4, CUT = 0.55, SAND = 0.55, FLY = 0.6, STAGGER = 0.55;

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

  const duration = BOX + STAGGER * (holders.length - 1) + CUT + SAND + FLY;
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

// ---------------------------------------------------------------- build 씬 연출 데이터
const BOX_POS = new THREE.Vector3(-20, BOX_H / 2, -6);
const BOX_ROT_Y = 0.55;

function makePose(pos, rot, lift = 2.2, dur = 0.55) {
  return {
    pos: new THREE.Vector3(...pos),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    lift, dur,
  };
}

// build 모드 연출 준비: 박스 + 런너 포즈 이벤트
function prepareBuildScene() {
  const rd = state.runnerData;
  const artTex = makeBoxArtTexture(tankKey);
  const { tray, lid } = makeKitBox(artTex);
  tray.position.copy(BOX_POS);
  tray.rotation.y = BOX_ROT_Y;
  content.add(tray, lid);
  state.lid = lid;
  // 뚜껑 포즈: 닫힘 → 바닥에 아트가 보이게 내려놓음
  state.lidClosed = makePose(
    [BOX_POS.x, BOX_H + 0.35, BOX_POS.z], [0, BOX_ROT_Y, 0]
  );
  state.lidOpen = makePose([22, LID_H + 0.2, -14], [0, -0.65, 0]);

  // 런너 포즈들
  const standPose = {
    A: (h) => makePose([-7.0, h / 2 + 0.4, 0], [-0.06, 0.5, 0]),
    B: (h) => makePose([-4.6, h / 2 + 0.4, 1.6], [-0.06, 0.5, 0]),
  };
  const restPose = {
    A: (h) => makePose([-18.2, (h / 2) * 0.94, -0.2], [-0.34, BOX_ROT_Y, 0]),
    B: (h) => makePose([-16.2, (h / 2) * 0.94, 1.2], [-0.34, BOX_ROT_Y, 0]),
  };
  // 박스 안: 눕힌 뒤 박스 방향으로 요 회전 (q = Ry · Rx)
  const boxPose = (idx) => {
    const p = makePose(
      [BOX_POS.x - 0.7 - idx * 0.35, 1.6 + idx * 1.1, BOX_POS.z - 1.1 - idx * 0.55],
      [0, 0, 0]
    );
    p.quat
      .setFromEuler(new THREE.Euler(0, BOX_ROT_Y, 0))
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    return p;
  };

  // 커팅 순서에서 활성 런너 구간 추출
  const segs = [];
  state.holders.forEach((h, i) => {
    const t0 = BOX + i * STAGGER;
    if (!segs.length || segs[segs.length - 1].key !== h.runnerKey) {
      segs.push({ t0, key: h.runnerKey });
    }
  });
  const firstKey = segs[0].key;
  const otherKey = firstKey === 'A' ? 'B' : 'A';

  // 런너별 포즈 이벤트: {t, pose}
  const events = { A: [], B: [] };
  events[firstKey].push({ t: 0, pose: boxPose(0) });
  events[otherKey].push({ t: 0, pose: boxPose(1) });
  // 인트로: 활성 런너 → 작업대, 나머지 → 박스에 기대기
  events[firstKey].push({ t: 1.55, pose: { ...standPose[firstKey](rd[firstKey].h), lift: 4, dur: 0.9 } });
  events[otherKey].push({ t: 2.15, pose: { ...restPose[otherKey](rd[otherKey].h), lift: 4, dur: 0.9 } });
  // 커팅 대상이 바뀔 때마다 교대
  for (let i = 1; i < segs.length; i++) {
    const k = segs[i].key, o = k === 'A' ? 'B' : 'A';
    events[k].push({ t: segs[i].t0 - 0.5, pose: standPose[k](rd[k].h) });
    events[o].push({ t: segs[i].t0 + 0.05, pose: restPose[o](rd[o].h) });
  }
  state.runnerEvents = events;
}

const _pA = new THREE.Vector3(), _pB = new THREE.Vector3();
function evalPose(events, t, outObj) {
  let cur = events[0], prev = null;
  for (const e of events) {
    if (t >= e.t) { prev = cur; cur = e; } else break;
  }
  const k = prev && cur !== events[0]
    ? Math.min(1, (t - cur.t) / (cur.pose.dur ?? 0.55))
    : 1;
  if (prev && k < 1 && prev !== cur) {
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    outObj.position.lerpVectors(prev.pose.pos, cur.pose.pos, e);
    outObj.position.y += Math.sin(e * Math.PI) * (cur.pose.lift ?? 2.2);
    outObj.quaternion.slerpQuaternions(prev.pose.quat, cur.pose.quat, e);
  } else {
    outObj.position.copy(cur.pose.pos);
    outObj.quaternion.copy(cur.pose.quat);
  }
}

// 뚜껑 애니메이션 (0.5s~1.8s: 들려서 바닥으로)
function poseLid(t) {
  const lid = state.lid;
  if (!lid) return;
  if (t < 0.5) {
    lid.position.copy(state.lidClosed.pos);
    lid.quaternion.copy(state.lidClosed.quat);
    if (t > 0.32) lid.rotation.z = Math.sin(t * 42) * 0.01; // 흔들림 (기대감)
    return;
  }
  const k = Math.min(1, (t - 0.5) / 1.3);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  lid.position.lerpVectors(state.lidClosed.pos, state.lidOpen.pos, e);
  lid.position.y += Math.sin(e * Math.PI) * 8;
  lid.quaternion.slerpQuaternions(state.lidClosed.quat, state.lidOpen.quat, e);
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
    state.tankRoot.position.set(9.5, 0, 0.5);
    state.tankRoot.rotation.y = -0.35;
    content.add(state.runnerRoots.A, state.runnerRoots.B, state.tankRoot);
    for (const h of state.holders) content.add(h.holder);
    prepareBuildScene();
    animT = 0;
    playing = true;
    applyBuild(0);
    frameCamera(new THREE.Vector3(-2, 5.2, 0), 54, [0.45, 0.5, 0.75]);
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

// 니퍼: 게이트로 접근 → 날 닫힘(커팅) → 후퇴. 원점 = 날 끝.
function poseNipper(gate, normal, k) {
  nipper.visible = true;
  let d;
  if (k < 0.35) d = 5.5 - 5.35 * easeOut(k / 0.35);
  else if (k < 0.85) d = 0.15;
  else d = 0.15 + ((k - 0.85) / 0.15) * 5.0;
  nipper.position.copy(gate).addScaledVector(normal, d);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.55)));
  nipper.quaternion.copy(q);
  let jaw;
  if (k < 0.35) jaw = 0.42;
  else if (k < 0.55) jaw = 0.42 - 0.38 * ((k - 0.35) / 0.2);
  else if (k < 0.85) jaw = 0.04;
  else jaw = 0.35;
  nipper.userData.setJaw(jaw);
}

// 유리사포: 파츠 가장자리를 왕복하며 게이트 자국을 다듬는다
function poseFile(partPos, normal, k) {
  glassFile.visible = true;
  const up = new THREE.Vector3(0, 1, 0);
  const strokeDir = new THREE.Vector3().crossVectors(normal, up).normalize();
  const stroke = Math.sin(k * Math.PI * 3) * 0.95;
  glassFile.position
    .copy(partPos)
    .addScaledVector(strokeDir, stroke)
    .addScaledVector(normal, 0.55)
    .addScaledVector(up, 0.32 + Math.abs(Math.cos(k * Math.PI * 3)) * 0.07);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), strokeDir);
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0, 0.1)));
  glassFile.quaternion.copy(q);
}

function applyBuild(t) {
  if (!state) return;
  // 박스/런너 연출 포즈 (파츠 계산 전에 반영)
  poseLid(t);
  for (const rk of RUNNER_KEYS) {
    if (state.runnerEvents) evalPose(state.runnerEvents[rk], t, state.runnerRoots[rk]);
  }

  let captionText = null;
  if (t < 1.8) captionText = '📦 박스 오픈!';
  else if (t < BOX - 0.2) captionText = '런너 꺼내기 — 지금 쓸 런너만 작업대로';

  let nipperSet = false, fileSet = false;
  let snapIdx = 0;
  snapPool.forEach((r) => (r.visible = false));

  state.holders.forEach((h, i) => {
    const local = t - BOX - i * STAGGER;
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
    const landT = BOX + i * STAGGER + CUT + SAND + FLY;
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
