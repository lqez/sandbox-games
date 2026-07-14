// main.js — PURATANK 차고(garage) 씬
// 책상 위에서: 박스 선택 → 박스 가져와 개봉 → 니퍼/사포 조립.
// 다른 전차를 고르면 만들던 파츠와 런너를 박스에 고이 담아 선반에 내려놓고
// 새 박스를 꺼낸다. 시작 버튼 = 게임 핸드오프(game/index.html 또는 이벤트).
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
const TANK_KEYS = ['ft', 'mk4', 't34', 'tiger'];
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
scene.fog = new THREE.Fog(0xf1efe9, 110, 220);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
camera.position.set(15, 10, 19);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 3.2, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.52;

// ---------------------------------------------------------------- lights
scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc6ba, 0.85));
const key = new THREE.DirectionalLight(0xfff1de, 2.4);
key.position.set(9, 16, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -40;
key.shadow.camera.right = key.shadow.camera.top = 40;
key.shadow.bias = -0.0004;
scene.add(key);
const fill = new THREE.DirectionalLight(0xd7e4ff, 0.7);
fill.position.set(-10, 7, -3);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.55);
rim.position.set(-4, 9, -12);
scene.add(rim);

// ---------------------------------------------------------------- 책상 + 커팅매트
{
  const desk = new THREE.Mesh(
    new THREE.CircleGeometry(110, 48),
    new THREE.MeshStandardMaterial({ color: 0x9c7a4f, roughness: 0.85 })
  );
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -0.16;
  desk.receiveShadow = true;
  scene.add(desk);

  const mat = new THREE.Mesh(
    new THREE.BoxGeometry(66, 0.16, 42),
    new THREE.MeshStandardMaterial({ color: 0x37684f, roughness: 0.92 })
  );
  mat.position.set(-3, -0.08, -3);
  mat.receiveShadow = true;
  scene.add(mat);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x2c5540, roughness: 0.9 });
  for (let gx = -30; gx <= 30; gx += 6) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 41.4), lineMat);
    l.position.set(-3 + gx, 0.005, -3);
    scene.add(l);
  }
  for (let gz = -18; gz <= 18; gz += 6) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(65.4, 0.02, 0.16), lineMat);
    l.position.set(-3, 0.005, -3 + gz);
    scene.add(l);
  }
}

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
  inner.position.z = 1.72; // 원점 = 날 끝
  g.add(inner);
  g.userData.setJaw = (a) => arms.forEach((arm) => { arm.rotation.y = arm.userData.side * a; });
  g.scale.setScalar(4.2);
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

// ---------------------------------------------------------------- 박스아트 (히어로 렌더 + 캔버스 합성)
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

  ctx.fillStyle = '#f6f2e7';
  ctx.fillRect(0, 0, 1024, 768);
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
  ctx.save();
  ctx.translate(510, 400);
  ctx.rotate(-0.12);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (const [sx, sy, sw] of [[-460, -120, 300], [-430, 30, 240], [120, -180, 330], [180, 90, 260]]) {
    ctx.fillRect(sx, sy, sw, 14);
  }
  ctx.restore();
  ctx.drawImage(hero, 150, ay - 10, 780, 585);
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
  const band = new THREE.Mesh(new THREE.BoxGeometry(LW + 0.05, 0.75, LD + 0.05), red);
  band.position.y = -LID_H + 0.55;
  lid.add(band);
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

// ---------------------------------------------------------------- 차고 배치 상수
const BOX_POS = new THREE.Vector3(-20, BOX_H / 2, -6);
const BOX_ROT_Y = 0.55;
const SHELF_SCALE = 0.62;
const SHELF = {
  ft: { pos: new THREE.Vector3(-28, (BOX_H / 2) * SHELF_SCALE, -26), yaw: 0.18 },
  mk4: { pos: new THREE.Vector3(-9.5, (BOX_H / 2) * SHELF_SCALE, -28), yaw: -0.08 },
  t34: { pos: new THREE.Vector3(9.5, (BOX_H / 2) * SHELF_SCALE, -28), yaw: 0.1 },
  tiger: { pos: new THREE.Vector3(28, (BOX_H / 2) * SHELF_SCALE, -26), yaw: -0.16 },
};
const PACK_DUR = 2.0, FETCH_DUR = 1.0;

const shelfGroup = new THREE.Group();
const kitBoxes = {}; // key → { tray, lid }
let kitBoxesReady = false;
function ensureKitBoxes() {
  if (kitBoxesReady) return;
  for (const k of TANK_KEYS) {
    const { tray, lid } = makeKitBox(makeBoxArtTexture(k));
    kitBoxes[k] = { tray, lid };
    shelfGroup.add(tray, lid);
    setBoxPose(k, SHELF[k].pos, SHELF[k].yaw, SHELF_SCALE);
  }
  kitBoxesReady = true;
}
function setBoxPose(k, pos, yaw, scale) {
  const { tray, lid } = kitBoxes[k];
  tray.position.copy(pos);
  tray.rotation.set(0, yaw, 0);
  tray.scale.setScalar(scale);
  lid.position.copy(pos).add(new THREE.Vector3(0, (BOX_H / 2 + 0.38) * scale, 0));
  lid.rotation.set(0, yaw, 0);
  lid.scale.setScalar(scale);
}

// ---------------------------------------------------------------- state
const content = new THREE.Group();
scene.add(content);

let state = null; // 현재 세션
let mode = 'build';
let tankKey = null;
let animT = 0; // 세션 마스터 클록 (pack + fetch + build)
let playing = false;
let spin = true;
let packJob = null;

const BOX = 3.4, CUT = 0.55, SAND = 0.55, FLY = 0.6, STAGGER = 0.55;

function euler(arr) { return new THREE.Euler(arr[0], arr[1], arr[2]); }
const ZERO_E = new THREE.Euler();

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

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

  const buildDur = BOX + STAGGER * (holders.length - 1) + CUT + SAND + FLY;
  return { def, holders, runnerRoots, runnerData, tankRoot, buildDur };
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
  setStubs(h.part, 1, false);
}

// ---------------------------------------------------------------- 세션 연출 준비
function makePose(pos, rot, lift = 2.2, dur = 0.55) {
  return {
    pos: new THREE.Vector3(...pos),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    lift, dur,
  };
}

// 박스 안에 눕힌 런너 포즈 (기준: 작업 위치의 박스)
function inBoxPose(idx) {
  const p = makePose(
    [BOX_POS.x - 0.7 - idx * 0.35, 1.6 + idx * 1.1, BOX_POS.z - 1.1 - idx * 0.55],
    [0, 0, 0]
  );
  p.quat
    .setFromEuler(new THREE.Euler(0, BOX_ROT_Y, 0))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
  return p;
}

function prepareBuildScene() {
  const rd = state.runnerData;
  state.tray = kitBoxes[tankKey].tray;
  state.lid = kitBoxes[tankKey].lid;
  state.lidClosed = makePose([BOX_POS.x, BOX_H + 0.38, BOX_POS.z], [0, BOX_ROT_Y, 0]);
  state.lidOpen = makePose([22, LID_H + 0.2, -14], [0, -0.65, 0]);

  const standPose = {
    A: (h) => makePose([-7.0, h / 2 + 0.4, 0], [-0.06, 0.5, 0]),
    B: (h) => makePose([-4.6, h / 2 + 0.4, 1.6], [-0.06, 0.5, 0]),
  };
  const restPose = {
    A: (h) => makePose([-18.2, (h / 2) * 0.94, -0.2], [-0.34, BOX_ROT_Y, 0]),
    B: (h) => makePose([-16.2, (h / 2) * 0.94, 1.2], [-0.34, BOX_ROT_Y, 0]),
  };

  const segs = [];
  state.holders.forEach((h, i) => {
    const t0 = BOX + i * STAGGER;
    if (!segs.length || segs[segs.length - 1].key !== h.runnerKey) {
      segs.push({ t0, key: h.runnerKey });
    }
  });
  const firstKey = segs[0].key;
  const otherKey = firstKey === 'A' ? 'B' : 'A';

  const events = { A: [], B: [] };
  events[firstKey].push({ t: 0, pose: inBoxPose(0) });
  events[otherKey].push({ t: 0, pose: inBoxPose(1) });
  events[firstKey].push({ t: 1.55, pose: { ...standPose[firstKey](rd[firstKey].h), lift: 4, dur: 0.9 } });
  events[otherKey].push({ t: 2.15, pose: { ...restPose[otherKey](rd[otherKey].h), lift: 4, dur: 0.9 } });
  for (let i = 1; i < segs.length; i++) {
    const k = segs[i].key, o = k === 'A' ? 'B' : 'A';
    events[k].push({ t: segs[i].t0 - 0.5, pose: standPose[k](rd[k].h) });
    events[o].push({ t: segs[i].t0 + 0.05, pose: restPose[o](rd[o].h) });
  }
  state.runnerEvents = events;
}

function evalPose(events, t, outObj) {
  let cur = events[0], prev = null;
  for (const e of events) {
    if (t >= e.t) { prev = cur; cur = e; } else break;
  }
  const k = prev && cur !== events[0]
    ? Math.min(1, (t - cur.t) / (cur.pose.dur ?? 0.55))
    : 1;
  if (prev && k < 1 && prev !== cur) {
    const e = easeInOut(k);
    outObj.position.lerpVectors(prev.pose.pos, cur.pose.pos, e);
    outObj.position.y += Math.sin(e * Math.PI) * (cur.pose.lift ?? 2.2);
    outObj.quaternion.slerpQuaternions(prev.pose.quat, cur.pose.quat, e);
  } else {
    outObj.position.copy(cur.pose.pos);
    outObj.quaternion.copy(cur.pose.quat);
  }
  outObj.scale.setScalar(1);
}

function poseLid(t) {
  const lid = state.lid;
  if (!lid) return;
  lid.scale.setScalar(1);
  if (t < 0.5) {
    lid.position.copy(state.lidClosed.pos);
    lid.quaternion.copy(state.lidClosed.quat);
    if (t > 0.32) lid.rotation.z = Math.sin(t * 42) * 0.01;
    return;
  }
  const k = Math.min(1, (t - 0.5) / 1.3);
  const e = easeInOut(k);
  lid.position.lerpVectors(state.lidClosed.pos, state.lidOpen.pos, e);
  lid.position.y += Math.sin(e * Math.PI) * 8;
  lid.quaternion.slerpQuaternions(state.lidClosed.quat, state.lidOpen.quat, e);
}

// ---------------------------------------------------------------- 선택 / 정리(pack) / 꺼내기(fetch)
function contentsVisible(v) {
  if (!state) return;
  for (const rk of RUNNER_KEYS) state.runnerRoots[rk].visible = v;
  for (const h of state.holders) h.holder.visible = v;
}

function chooseTank(k, instant = false) {
  if (mode !== 'build') {
    setView(k, mode);
    return;
  }
  ensureKitBoxes();
  if (tankKey === k && state) return;

  // 만들던 세션 → 박스에 정리
  if (state && tankKey) {
    if (packJob) finalizePack(); // 이전 정리가 안 끝났으면 즉시 마무리
    packJob = {
      key: tankKey,
      state,
      snap: state.holders.map((h) => ({
        holder: h.holder,
        part: h.part,
        pos: h.holder.position.clone(),
        quat: h.holder.quaternion.clone(),
        heap: new THREE.Vector3(
          BOX_POS.x + (((h.part.order * 7) % 5) - 2) * 1.7,
          1.3 + (h.part.order % 4) * 0.7,
          BOX_POS.z + (((h.part.order * 13) % 5) - 2) * 1.6
        ),
      })),
      runnerSnap: RUNNER_KEYS.map((rk, i) => ({
        root: state.runnerRoots[rk],
        pos: state.runnerRoots[rk].position.clone(),
        quat: state.runnerRoots[rk].quaternion.clone(),
        target: inBoxPose(i),
      })),
      lid: state.lid,
      lidPos: state.lid.position.clone(),
      lidQuat: state.lid.quaternion.clone(),
    };
  }

  tankKey = k;
  state = buildState(k);
  frameCamera(new THREE.Vector3(-1, 4.5, -3), 58, [0.42, 0.5, 0.75]);
  content.add(state.runnerRoots.A, state.runnerRoots.B, state.tankRoot);
  for (const h of state.holders) content.add(h.holder);
  state.tankRoot.position.set(9.5, 0, 0.5);
  state.tankRoot.rotation.y = -0.35;
  prepareBuildScene();
  contentsVisible(false);

  state.packDur = packJob ? PACK_DUR : 0;
  state.fetchEnd = state.packDur + FETCH_DUR;
  state.duration = state.fetchEnd + state.buildDur;
  state.fetched = false;
  animT = instant ? state.fetchEnd : 0;
  playing = !instant;
  applyFrame(animT);
  updateUI();
}

// 정리: 파츠/런너를 트레이에 담고 뚜껑 닫아 선반으로
function applyPack(T) {
  const pj = packJob;
  if (!pj) return;
  const e1 = easeInOut(clamp01(T / 1.15));
  for (const s of pj.snap) {
    s.holder.position.lerpVectors(s.pos, s.heap, e1);
    s.holder.quaternion.copy(s.quat);
    s.holder.scale.setScalar(1);
    setStubs(s.part, 0, false);
  }
  for (const rs of pj.runnerSnap) {
    rs.root.position.lerpVectors(rs.pos, rs.target.pos, e1);
    rs.root.quaternion.slerpQuaternions(rs.quat, rs.target.quat, e1);
    rs.root.position.y += Math.sin(e1 * Math.PI) * 2.5;
  }
  const lc = new THREE.Vector3(BOX_POS.x, BOX_H + 0.38, BOX_POS.z);
  const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, BOX_ROT_Y, 0));
  const e2 = easeInOut(clamp01((T - 0.75) / 0.55));
  pj.lid.position.lerpVectors(pj.lidPos, lc, e2);
  pj.lid.position.y += Math.sin(e2 * Math.PI) * 4;
  pj.lid.quaternion.slerpQuaternions(pj.lidQuat, lq, e2);
  pj.lid.scale.setScalar(1);
  const k3 = clamp01((T - 1.35) / 0.65);
  if (k3 > 0) {
    for (const s of pj.snap) s.holder.visible = false;
    for (const rs of pj.runnerSnap) rs.root.visible = false;
    const e3 = easeInOut(k3);
    const sh = SHELF[pj.key];
    const tray = kitBoxes[pj.key].tray;
    const scale = 1 + (SHELF_SCALE - 1) * e3;
    tray.position.lerpVectors(BOX_POS, sh.pos, e3);
    tray.position.y += Math.sin(e3 * Math.PI) * 3;
    tray.quaternion.slerpQuaternions(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, BOX_ROT_Y, 0)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sh.yaw, 0)),
      e3
    );
    tray.scale.setScalar(scale);
    pj.lid.position.copy(tray.position).add(new THREE.Vector3(0, (BOX_H / 2 + 0.38) * scale, 0));
    pj.lid.quaternion.copy(tray.quaternion);
    pj.lid.scale.setScalar(scale);
  }
  if (T >= PACK_DUR - 0.001) finalizePack();
}

function finalizePack() {
  const pj = packJob;
  if (!pj) return;
  setBoxPose(pj.key, SHELF[pj.key].pos, SHELF[pj.key].yaw, SHELF_SCALE);
  for (const s of pj.snap) content.remove(s.holder);
  for (const rs of pj.runnerSnap) content.remove(rs.root);
  content.remove(pj.state.tankRoot);
  packJob = null;
}

// 꺼내기: 선반의 박스를 작업 위치로
function applyFetch(T) {
  if (!state) return;
  const f = clamp01((T - state.packDur) / FETCH_DUR);
  if (state.fetched && f >= 1) return;
  const e = easeInOut(f);
  const sh = SHELF[tankKey];
  const tray = state.tray;
  const scale = SHELF_SCALE + (1 - SHELF_SCALE) * e;
  tray.position.lerpVectors(sh.pos, BOX_POS, e);
  tray.position.y += Math.sin(e * Math.PI) * 4.5;
  tray.quaternion.slerpQuaternions(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sh.yaw, 0)),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, BOX_ROT_Y, 0)),
    e
  );
  tray.scale.setScalar(scale);
  state.lid.position.copy(tray.position).add(new THREE.Vector3(0, (BOX_H / 2 + 0.38) * scale, 0));
  state.lid.quaternion.copy(tray.quaternion);
  state.lid.scale.setScalar(scale);
  state.fetched = f >= 1;
}

// 마스터 프레임: pack → fetch → build
function applyFrame(T) {
  if (!state) return;
  if (packJob) applyPack(T);
  applyFetch(T);
  const bT = T - state.fetchEnd;
  if (bT >= 0) {
    contentsVisible(true);
    state.tray.position.copy(BOX_POS);
    state.tray.rotation.set(0, BOX_ROT_Y, 0);
    state.tray.scale.setScalar(1);
    applyBuild(bT);
  } else {
    contentsVisible(false);
    nipper.visible = glassFile.visible = false;
    snapPool.forEach((r) => (r.visible = false));
    setCaption(packJob ? '🧹 만들던 파츠를 박스에 고이 담는 중…' : '📦 새 박스 꺼내는 중…');
    document.getElementById('scrub').value = '0';
  }
}

// ---------------------------------------------------------------- build 타임라인 (t=0: 박스 개봉)
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
  if (t >= state.buildDur && !captionText) captionText = '✅ 조립 완료! ▶ 시작을 누르면 출격';
  setCaption(captionText || '');
  document.getElementById('scrub').value = String(clamp01(t / state.buildDur));
}

// ---------------------------------------------------------------- modes
function setView(nextTank, nextMode) {
  tankKey = nextTank;
  mode = nextMode;
  clearContentAll();

  if (mode === 'lineup') {
    const xs = { ft: -16.5, mk4: -5.5, t34: 5.5, tiger: 16.5 };
    for (const k of TANK_KEYS) {
      const s = buildState(k);
      s.tankRoot.position.set(xs[k], 0, 0);
      s.tankRoot.rotation.y = 0.5;
      for (const h of s.holders) {
        placeAssembled(h);
        s.tankRoot.add(h.holder);
      }
      content.add(s.tankRoot);
    }
    frameCamera(new THREE.Vector3(0, 3.4, 0), 45, [0.12, 0.5, 1.0]);
    updateUI();
    return;
  }

  if (mode === 'build') {
    ensureKitBoxes();
    scene.add(shelfGroup);
    frameCamera(new THREE.Vector3(0, 2, -16), 42, [0.28, 0.52, 0.8]);
    if (tankKey) {
      const k = tankKey;
      tankKey = null;
      chooseTank(k);
    } else {
      setCaption('🛒 전차 박스를 선택하세요 (상단 버튼)');
    }
    updateUI();
    return;
  }

  const useKey = tankKey || 't34';
  state = buildState(useKey);
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
  }
  updateUI();
}

function clearContentAll() {
  content.clear();
  content.rotation.set(0, 0, 0);
  scene.remove(shelfGroup);
  nipper.visible = glassFile.visible = false;
  snapPool.forEach((r) => (r.visible = false));
  setCaption('');
  packJob = null;
  state = null;
  playing = false;
  if (kitBoxesReady) {
    for (const k of TANK_KEYS) setBoxPose(k, SHELF[k].pos, SHELF[k].yaw, SHELF_SCALE);
  }
}

function frameCamera(target, dist, dirArr = [0.62, 0.42, 0.78]) {
  controls.target.copy(target);
  const dir = new THREE.Vector3(...dirArr).normalize();
  camera.position.copy(target.clone().addScaledVector(dir, dist));
}

// ---------------------------------------------------------------- 게임 시작 핸드오프
async function startGame() {
  if (!tankKey || !state) {
    setCaption('먼저 전차 박스를 선택하세요!');
    return;
  }
  const detail = { tank: tankKey };
  window.dispatchEvent(new CustomEvent('puratank:start', { detail }));
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'puratank:start', ...detail }, '*');
  }
  if (typeof window.__pt.onStart === 'function') {
    window.__pt.onStart(tankKey);
    return;
  }
  try {
    const res = await fetch('game/index.html', { method: 'HEAD' });
    if (res.ok) {
      location.href = `game/index.html?tank=${tankKey}`;
      return;
    }
  } catch (e) { /* 게임 미설치 */ }
  setCaption(`🎮 게임 시작! (tank=${tankKey}) — game/index.html 연동 지점`);
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
  document.getElementById('scrub-wrap').style.display =
    mode === 'build' && state ? 'flex' : 'none';
}

document.querySelectorAll('[data-tank]').forEach((b) =>
  b.addEventListener('click', () => {
    if (mode === 'build') chooseTank(b.dataset.tank);
    else setView(b.dataset.tank, mode === 'lineup' ? 'done' : mode);
  }));
document.querySelectorAll('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => setView(tankKey, b.dataset.mode)));
document.getElementById('replay').addEventListener('click', () => {
  if (mode !== 'build') { setView(tankKey || 't34', 'build'); return; }
  if (!state) { setCaption('🛒 전차 박스를 선택하세요'); return; }
  animT = state.fetchEnd;
  playing = true;
});
document.getElementById('start').addEventListener('click', startGame);
document.getElementById('export').addEventListener('click', () => exportGlb(true));
const scrub = document.getElementById('scrub');
scrub.addEventListener('input', () => {
  if (mode !== 'build' || !state) return;
  playing = false;
  animT = state.fetchEnd + parseFloat(scrub.value) * state.buildDur;
  applyFrame(animT);
});

// ---------------------------------------------------------------- GLTF 내보내기
function exportGlb(download = true) {
  return new Promise((resolve, reject) => {
    const k = tankKey || 't34';
    const s = buildState(k);
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
          a.download = `puratank-${k}.glb`;
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

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mode === 'build' && playing && state) {
    animT = Math.min(animT + dt, state.duration + 0.5);
    applyFrame(animT);
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
setView(null, 'build');
tick();

// ---------------------------------------------------------------- 스크린샷/테스트 API
window.__pt = {
  setView: (t, m, at = null) => {
    spin = false;
    setView(t, m);
    content.rotation.y = 0;
    if (m === 'build' && at !== null && state) {
      playing = false;
      animT = state.fetchEnd + at * state.buildDur;
      applyFrame(animT);
    }
    renderer.render(scene, camera);
    return 'ok';
  },
  buildAtSec: (t, sec) => {
    spin = false;
    if (mode !== 'build') setView(null, 'build');
    if (tankKey !== t || !state) chooseTank(t, true);
    playing = false;
    animT = state.fetchEnd + sec;
    applyFrame(animT);
    renderer.render(scene, camera);
    return 'ok';
  },
  garage: () => {
    spin = false;
    setView(null, 'build');
    renderer.render(scene, camera);
    return 'ok';
  },
  selectTank: (k) => {
    if (mode !== 'build') setView(null, 'build');
    chooseTank(k);
    renderer.render(scene, camera);
    return 'ok';
  },
  setT: (T) => {
    playing = false;
    animT = T;
    applyFrame(T);
    renderer.render(scene, camera);
    return 'ok';
  },
  exportGlb: () => exportGlb(false),
  onStart: null,
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
