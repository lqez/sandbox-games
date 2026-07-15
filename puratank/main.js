// PURATANK — SD 플라모델 스타일 하이트맵 턴제 탱크 게임
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { SSAOPass } from './vendor/postprocessing/SSAOPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { buildKitTank, KIT_INFO, KIT_KEYS } from './src/kit-tank.js';

// 차고에서 선택한 기체 (?tank=ft|mk4|t34|tiger)
const kitParam = new URLSearchParams(location.search).get('tank');
const playerKit = KIT_KEYS.includes(kitParam) ? kitParam : 't34';
const enemyKits = KIT_KEYS.filter((k) => k !== playerKit);

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------
const GRID = 40;            // 40x40 그리드 (2배 조밀 — 탱크 ≈ 2×2타일)
const TILE = 1;             // 한 칸의 월드 크기
const VRES = 2;             // 타일당 하이트필드 분할 수 (하이트필드 해상도는 동일)
const WATER_Y = -0.12;      // 수면 높이
const MAX_CLIMB = 0.5;      // 궤도로 오를 수 있는 최대 단차 (1유닛 스텝 기준)
const FORD_DEPTH = 0.22;    // 도하 가능한 최대 수심 — 더 깊은 물은 진입 불가
const PITCH_MIN = -14;      // 포신 내림각 한계(도)
const PITCH_MAX = 20;       // 포신 올림각 한계(도)

const PLAYER_STATS = KIT_INFO[playerKit].stats;
const ENEMY_BASE   = { mp: 12, fireRange: 14, damage: 24 };

const PLAYER_SPAWN = { gx: 20, gz: 34 };
const ENEMY_SPAWNS = [
  { gx: 6, gz: 4 },
  { gx: 18, gz: 4 },
  { gx: 32, gz: 6 },
  { gx: 26, gz: 10 },
];

// 지형 종류
const T = { GRASS: 0, DIRT: 1, SAND: 2, MUD: 3, WATER: 4 };
const TERRAIN_COST = { [T.GRASS]: 1.0, [T.DIRT]: 1.3, [T.SAND]: 1.7, [T.MUD]: 2.3, [T.WATER]: 3.2 };
const TERRAIN_NAME = { [T.GRASS]: '풀밭', [T.DIRT]: '흙', [T.SAND]: '모래', [T.MUD]: '진흙', [T.WATER]: '하천' };

// ---------------------------------------------------------------------------
// 시드 랜덤 (?seed=1234 로 고정 가능)
// ---------------------------------------------------------------------------
const seed =
  Number(new URLSearchParams(location.search).get('seed')) ||
  (Math.floor(Math.random() * 1e9) + 1);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);

// 2옥타브 밸류 노이즈
function makeNoise(cell) {
  const size = Math.ceil(GRID / cell) + 2;
  const lattice = [];
  for (let i = 0; i < size * size; i++) lattice.push(rng());
  const at = (x, y) => lattice[y * size + x];
  return (fx, fz) => {
    const x = fx / cell, z = fz / cell;
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const tx = x - x0, tz = z - z0;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const a = at(x0, z0), b = at(x0 + 1, z0), c = at(x0, z0 + 1), d = at(x0 + 1, z0 + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}

// ---------------------------------------------------------------------------
// 렌더러 / 씬 / 카메라
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xaecbe8, 75, 160);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(22, 26, 30);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 4);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 12;
controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.46;
controls.enablePan = true;
controls.panSpeed = 0.6;

scene.add(new THREE.HemisphereLight(0xbcd4f0, 0x5f5a45, 0.38));
const sun = new THREE.DirectionalLight(0xffe9c8, 1.95);
sun.position.set(24, 34, 16);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26;
sun.shadow.camera.bottom = -26;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 4;
scene.add(sun);

// ---------------------------------------------------------------------------
// 야외 하늘: 캔버스 스카이돔(그라데이션 + 뭉게구름 + 태양 헤일로)
// + PMREM 환경맵 → 물/플라스틱 표면에 하늘 반사 (이슈 #7)
// ---------------------------------------------------------------------------
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#2764c4');
  g.addColorStop(0.35, '#4b8ede');
  g.addColorStop(0.62, '#8ab8e8');
  g.addColorStop(0.78, '#c3daee');
  g.addColorStop(1.0, '#d8d2bd');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  // 태양 헤일로 (sun 방향과 비슷한 쪽)
  const halo = ctx.createRadialGradient(700, 150, 0, 700, 150, 220);
  halo.addColorStop(0, 'rgba(255,248,225,0.95)');
  halo.addColorStop(0.25, 'rgba(255,244,214,0.4)');
  halo.addColorStop(1, 'rgba(255,244,214,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 1024, 512);
  // 뭉게구름: 겹친 소프트 원 클러스터
  const cloud = (cx, cy, s, alpha) => {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * s;
      const px = cx + Math.cos(a) * r * 1.9;
      const py = cy + Math.sin(a) * r * 0.55;
      const pr = s * (0.35 + Math.random() * 0.4);
      const cg = ctx.createRadialGradient(px, py, 0, px, py, pr);
      cg.addColorStop(0, `rgba(255,255,255,${alpha})`);
      cg.addColorStop(0.7, `rgba(250,252,255,${alpha * 0.55})`);
      cg.addColorStop(1, 'rgba(250,252,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  cloud(160, 190, 55, 0.5);
  cloud(430, 130, 70, 0.42);
  cloud(840, 230, 48, 0.45);
  cloud(620, 300, 60, 0.3);
  cloud(80, 330, 42, 0.28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
const skyTex = makeSkyTexture();
scene.background = skyTex;
{
  // 환경맵: 하늘 + 지면색으로 구성한 미니 씬을 PMREM으로 변환
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = skyTex;
  const groundDisc = new THREE.Mesh(
    new THREE.CircleGeometry(80, 24),
    new THREE.MeshBasicMaterial({ color: 0x8aa86a })
  );
  groundDisc.rotation.x = -Math.PI / 2;
  groundDisc.position.y = -6;
  envScene.add(groundDisc);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
}

// SSAO 포스트프로세싱 체인 (이슈 #7)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssaoPass.kernelRadius = 0.9;
ssaoPass.minDistance = 0.0004;
ssaoPass.maxDistance = 0.12;
composer.addPass(ssaoPass);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// 툰 재질 / 외곽선
// ---------------------------------------------------------------------------
const gradientMap = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([84, 168, 238]), 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();
const matCache = new Map();
function toonMat(color) {
  // 디오라마 룩: 프랍/파편은 툰 대신 무광 스탠다드 재질
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 }));
  return matCache.get(color);
}
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x232a38, side: THREE.BackSide });
function addOutline(mesh, scale = 1.05) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(scale);
  o.userData.isOutline = true;
  mesh.add(o);
  return mesh;
}
function part(geo, color, { outline = false, shadow = true, outlineScale = 1.05 } = {}) {
  const m = new THREE.Mesh(geo, toonMat(color));
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  if (outline) addOutline(m, outlineScale);
  return m;
}

// ---------------------------------------------------------------------------
// 좌표 유틸
// ---------------------------------------------------------------------------
const cellKey = (gx, gz) => `${gx},${gz}`;
const inBounds = (gx, gz) => gx >= 0 && gx < GRID && gz >= 0 && gz < GRID;
const cellToWorld = (gx, gz) =>
  new THREE.Vector3((gx - (GRID - 1) / 2) * TILE, 0, (gz - (GRID - 1) / 2) * TILE);
function worldToCell(p) {
  return {
    gx: Math.max(0, Math.min(GRID - 1, Math.round(p.x / TILE + (GRID - 1) / 2))),
    gz: Math.max(0, Math.min(GRID - 1, Math.round(p.z / TILE + (GRID - 1) / 2))),
  };
}

// ---------------------------------------------------------------------------
// 지형 생성: 부드러운 하이트필드 + 하천 + 지형 종류
// ---------------------------------------------------------------------------
const VN = GRID * VRES;               // 하이트필드 분할 수
const HALF = (GRID * TILE) / 2;
const VSTEP = TILE / VRES;

const hNoise = makeNoise(10);
const hNoise2 = makeNoise(4.8);
const tNoise = makeNoise(8);

// 하천 경로: 스폰 지점과 겹치지 않을 때까지 리샘플링
let riverCx, riverAmp, riverPhase;
{
  let tries = 0;
  do {
    riverCx = 8 + rng() * 24;
    riverAmp = 4.8 + rng() * 3.6;
    riverPhase = rng() * Math.PI * 2;
    tries++;
  } while (
    tries < 40 &&
    [PLAYER_SPAWN, ...ENEMY_SPAWNS].some((s) => {
      const rx = riverCx + Math.sin(s.gz * 0.21 + riverPhase) * riverAmp;
      return Math.abs(rx - s.gx) < (s === PLAYER_SPAWN ? 8 : 6);
    })
  );
}
const riverPoints = [];
for (let zw = -HALF; zw <= HALF; zw += 0.5) {
  const gzf = zw / TILE + (GRID - 1) / 2;
  const rx = riverCx + Math.sin(gzf * 0.21 + riverPhase) * riverAmp;
  riverPoints.push({ x: (rx - (GRID - 1) / 2) * TILE, z: zw });
}
function distToRiver(wx, wz) {
  let d = Infinity;
  for (const p of riverPoints) {
    const dd = Math.hypot(wx - p.x, wz - p.z);
    if (dd < d) d = dd;
  }
  return d;
}

const smooth01 = (x) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
function baseHeight(wx, wz) {
  // 노이즈 좌표는 0 이상이어야 함 (격자 인덱스)
  const fx = (wx + HALF) / TILE;
  const fz = (wz + HALF) / TILE;
  const n = hNoise(fx, fz) * 0.72 + hNoise2(fx, fz) * 0.28;
  return THREE.MathUtils.clamp(n * 5.2 - 1.0, 0, 2.6);
}
const spawnTargets = [PLAYER_SPAWN, ...ENEMY_SPAWNS].map((s) => {
  const p = cellToWorld(s.gx, s.gz);
  return { x: p.x, z: p.z, h: Math.max(baseHeight(p.x, p.z), 0.15) };
});
function fieldHeight(wx, wz) {
  let h = baseHeight(wx, wz);
  // 스폰 주변 완만화
  for (const s of spawnTargets) {
    const d = Math.hypot(wx - s.x, wz - s.z);
    if (d < 5) h = THREE.MathUtils.lerp(s.h, h, smooth01((d - 1.5) / 3.5));
  }
  // 하천 카빙 (부드러운 강바닥) — 구간별 깊이 변화로 여울(얕은 도하 지점) 생성
  const dr = distToRiver(wx, wz);
  if (dr < 5.5) {
    const gzf = wz / TILE + (GRID - 1) / 2;
    const ford = smooth01((Math.sin(gzf * 0.275 + riverPhase * 2.3) - 0.38) / 0.3);
    const bed = -0.52 + ford * 0.27; // 여울 -0.25(수심 0.13) ↔ 깊은 곳 -0.52(수심 0.4)
    h = THREE.MathUtils.lerp(bed, h, smooth01((dr - 1.3) / 4.2));
  }
  return h;
}

// 하이트필드 메시 (정점 색으로 지형 표현)
const TERRAIN_COLORS = {
  [T.GRASS]: [0x79b055, 0x6fa64d],
  [T.DIRT]: [0xa8875a, 0x9e7f54],
  [T.SAND]: [0xd2bb7e, 0xc8b175],
  [T.MUD]: [0x80664a, 0x775f44],
  [T.WATER]: [0x94805d, 0x8b7857], // 강바닥
};
const terrainGeo = new THREE.PlaneGeometry(GRID * TILE, GRID * TILE, VN, VN);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, fieldHeight(pos.getX(i), pos.getZ(i)));
}
const vIndex = (ix, iz) => iz * (VN + 1) + ix;
function sampleHeight(wx, wz) {
  const fx = THREE.MathUtils.clamp((wx + HALF) / VSTEP, 0, VN - 1e-6);
  const fz = THREE.MathUtils.clamp((wz + HALF) / VSTEP, 0, VN - 1e-6);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const pos = terrainGeo.attributes.position;
  const a = pos.getY(vIndex(ix, iz)), b = pos.getY(vIndex(ix + 1, iz));
  const c = pos.getY(vIndex(ix, iz + 1)), d = pos.getY(vIndex(ix + 1, iz + 1));
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

// 셀 단위 캐시: 높이 / 지형 종류
const cellH = [];
const terrain = [];
for (let gx = 0; gx < GRID; gx++) {
  cellH.push([]);
  terrain.push([]);
  for (let gz = 0; gz < GRID; gz++) {
    const p = cellToWorld(gx, gz);
    const h = sampleHeight(p.x, p.z);
    cellH[gx].push(h);
    let type;
    if (h < WATER_Y - 0.03) type = T.WATER;
    else if (distToRiver(p.x, p.z) < 3.2) type = T.MUD;
    else {
      const tn = tNoise(gx + 7, gz + 3);
      type = tn > 0.68 ? T.DIRT : tn < 0.24 ? T.SAND : T.GRASS;
    }
    terrain[gx].push(type);
  }
}
for (const s of [PLAYER_SPAWN, ...ENEMY_SPAWNS]) {
  if (terrain[s.gx][s.gz] === T.WATER) terrain[s.gx][s.gz] = T.GRASS;
}
const heightAt = (gx, gz) => cellH[gx][gz];
const terrainAt = (gx, gz) => terrain[gx][gz];

// ---------------------------------------------------------------------------
// 지형 렌더링: 스무스 메시 + 수면 + 지면을 따라가는 그리드 라인
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 연속 지형 블렌딩: 타일 경계가 아니라 노이즈/강 거리/경사 기반 가중치로
// 풀·흙·모래·진흙·강바닥·바위 색을 정점 단위로 자연스럽게 섞는다.
// (게임 규칙용 셀 지형 분류는 그대로 — 시각 표현만 연속화)
// ---------------------------------------------------------------------------
const BLEND_COLORS = {
  grass: [new THREE.Color(0x79b055), new THREE.Color(0x639a45)],
  dirt:  [new THREE.Color(0xa8875a), new THREE.Color(0x8f7048)],
  sand:  [new THREE.Color(0xd2bb7e), new THREE.Color(0xc3ac6e)],
  mud:   [new THREE.Color(0x7d6446), new THREE.Color(0x6f583e)],
  bed:   [new THREE.Color(0x8b7857), new THREE.Color(0x7d6c4e)],
  rock:  [new THREE.Color(0xb3a385), new THREE.Color(0x97876a)],
  dry:   [new THREE.Color(0xa3985e), new THREE.Color(0x8f8752)], // 마른 풀 패치
};
// 지형 종류 가중치 (0..1) — 셀 분류와 같은 노이즈/규칙을 연속값으로 사용
function surfaceWeights(wx, wz, h) {
  const fx = (wx + HALF) / TILE, fz = (wz + HALF) / TILE;
  // tNoise 격자(size 7, cell 8)의 안전 입력 상한 (x0+1 ≤ size-1)
  const tn = tNoise(Math.min(fx - 0.5 + 7, 47.9), Math.min(fz - 0.5 + 3, 47.9));
  const dirt = smooth01((tn - 0.58) / 0.2);
  const sand = smooth01((0.3 - tn) / 0.2) * (1 - dirt);
  const mud = 1 - smooth01((distToRiver(wx, wz) - 2.2) / 2.0);
  const bed = smooth01((WATER_Y + 0.05 - h) / 0.22);
  const sxp = sampleHeight(wx + 0.5, wz), sxm = sampleHeight(wx - 0.5, wz);
  const szp = sampleHeight(wx, wz + 0.5), szm = sampleHeight(wx, wz - 0.5);
  const rock = smooth01((Math.hypot(sxp - sxm, szp - szm) - 0.72) / 0.6) * 0.85;
  return { dirt, sand, mud, bed, rock };
}
const _sc = new THREE.Color();
function surfaceColorAt(wx, wz, h, out) {
  const w = surfaceWeights(wx, wz, h);
  const fx = (wx + HALF) / TILE, fz = (wz + HALF) / TILE;
  // 얼룩 노이즈 2종: 팔레트 내 변주 + 밝기 모틀
  const v1 = hNoise2(fx, fz);
  const v2 = hNoise(fz * 0.8 + 2, fx * 0.8 + 5);
  const pick = (pair) => _sc.lerpColors(pair[0], pair[1], v1);
  out.copy(pick(BLEND_COLORS.grass));
  // 마른 풀 패치: 실제 디오라마처럼 초지 안에 누런 풀 무리가 섞인다
  const dry = smooth01((v2 - 0.52) / 0.22);
  out.lerp(pick(BLEND_COLORS.dry), dry * 0.55);
  out.lerp(pick(BLEND_COLORS.dirt), w.dirt);
  out.lerp(pick(BLEND_COLORS.sand), w.sand);
  out.lerp(pick(BLEND_COLORS.mud), w.mud);
  out.lerp(pick(BLEND_COLORS.rock), w.rock);
  out.lerp(pick(BLEND_COLORS.bed), w.bed);
  out.multiplyScalar(0.9 + v2 * 0.2);
  return out;
}
{
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i), wz = pos.getZ(i);
    surfaceColorAt(wx, wz, pos.getY(i), col);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
terrainGeo.computeVertexNormals();

// 흙/풀 디테일 텍스처 (프로시저럴 노이즈) — 컬러 얼룩 + 범프
function makeDetailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cfcfcf';
  ctx.fillRect(0, 0, 512, 512);
  const img = ctx.getImageData(0, 0, 512, 512);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 196 + Math.random() * 59; // 밝기 얼룩
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  // 굵은 얼룩(풀 뭉치/흙덩이 느낌) 오버레이
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const r = 1.5 + Math.random() * 5;
    const bright = Math.random() > 0.5;
    ctx.fillStyle = bright ? 'rgba(255,255,255,0.10)' : 'rgba(60,55,40,0.10)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.4 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  return tex;
}
const detailTex = makeDetailTexture();
const terrainMesh = new THREE.Mesh(
  terrainGeo,
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detailTex,
    bumpMap: detailTex,
    bumpScale: 0.9,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.16,
  })
);
terrainMesh.receiveShadow = true;
terrainMesh.castShadow = true;
scene.add(terrainMesh);

// ---------------------------------------------------------------------------
// 수면 — 깊이 기반 색/알파(얕은 곳은 투명하게 지형과 자연스럽게 만나고,
// 물가에는 거품 라인), 스크롤되는 리플 노멀맵으로 흐름 표현
// ---------------------------------------------------------------------------
function makeWaterMaps() {
  const N = 256;
  const colorC = document.createElement('canvas');
  const alphaC = document.createElement('canvas');
  colorC.width = colorC.height = alphaC.width = alphaC.height = N;
  const cc = colorC.getContext('2d');
  const ac = alphaC.getContext('2d');
  const cImg = cc.createImageData(N, N);
  const aImg = ac.createImageData(N, N);
  const shallow = { r: 158, g: 218, b: 214 };
  const deep = { r: 16, g: 78, b: 132 };
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      // PlaneGeometry.rotateX(-PI/2) 기준: u→+x, 캔버스 행(py)→+z
      const wx = (px / (N - 1) - 0.5) * GRID * TILE;
      const wz = (py / (N - 1) - 0.5) * GRID * TILE;
      const depth = WATER_Y - sampleHeight(wx, wz);
      const i = (py * N + px) * 4;
      const t = smooth01(depth / 0.38); // 수심 대비: 여울(~0.13)은 밝고 깊은 곳(~0.4)은 진하게
      let r = shallow.r + (deep.r - shallow.r) * t;
      let g = shallow.g + (deep.g - shallow.g) * t;
      let b = shallow.b + (deep.b - shallow.b) * t;
      // 물가 거품: 아주 얕은 수심 띠를 밝게
      const foam = smooth01((depth - 0.005) / 0.05) * (1 - smooth01((depth - 0.06) / 0.09));
      r += (235 - r) * foam;
      g += (243 - g) * foam;
      b += (246 - b) * foam;
      cImg.data[i] = r; cImg.data[i + 1] = g; cImg.data[i + 2] = b; cImg.data[i + 3] = 255;
      // 알파(green 채널): 물가에서 0으로 부드럽게 — 지형과 만나는 면이 자연스럽다
      const a = Math.min(0.82, smooth01(depth / 0.14) * 0.26 + smooth01(depth / 0.4) * 0.52 + foam * 0.3) * 255;
      aImg.data[i] = a; aImg.data[i + 1] = a; aImg.data[i + 2] = a; aImg.data[i + 3] = 255;
    }
  }
  cc.putImageData(cImg, 0, 0);
  ac.putImageData(aImg, 0, 0);
  const colorTex = new THREE.CanvasTexture(colorC);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  const alphaTex = new THREE.CanvasTexture(alphaC);
  return { colorTex, alphaTex };
}
// 리플 노멀맵 (스무스 노이즈 → 소벨 노멀)
function makeRippleNormal() {
  const N = 128;
  const vals = new Float32Array(N * N);
  const lat = [];
  const L = 9;
  for (let i = 0; i < L * L; i++) lat.push(Math.random());
  const latAt = (x, y) => lat[((y % L) + L) % L * L + ((x % L) + L) % L];
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const x = (px / N) * L, y = (py / N) * L;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const tx = x - x0, ty = y - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = latAt(x0, y0), b = latAt(x0 + 1, y0), c = latAt(x0, y0 + 1), d = latAt(x0 + 1, y0 + 1);
      vals[py * N + px] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N);
  const at = (x, y) => vals[((y + N) % N) * N + ((x + N) % N)];
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const i = (py * N + px) * 4;
      img.data[i] = 128 + (at(px - 1, py) - at(px + 1, py)) * 340;
      img.data[i + 1] = 128 + (at(px, py - 1) - at(px, py + 1)) * 340;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  return tex;
}
const waterMaps = makeWaterMaps();
const rippleTex = makeRippleNormal();
const waterMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID * TILE, GRID * TILE),
  new THREE.MeshStandardMaterial({
    map: waterMaps.colorTex,
    alphaMap: waterMaps.alphaTex,
    normalMap: rippleTex,
    normalScale: new THREE.Vector2(0.26, 0.26),
    transparent: true,
    depthWrite: false,
    roughness: 0.05,
    metalness: 0,
    envMapIntensity: 1.35,
  })
);
waterMesh.rotation.x = -Math.PI / 2;
waterMesh.position.y = WATER_Y;
scene.add(waterMesh);

// 받침대
{
  const baseSize = GRID * TILE + 2.2;
  const base = part(new RoundedBoxGeometry(baseSize, 1.6, baseSize, 4, 0.3), 0x5c667a, { outline: false });
  base.position.y = -1.35;
  scene.add(base);
}

// 그리드 라인 (지면 굴곡을 따라감, 크레이터 후 재생성)
let gridLines = null;
function rebuildGridLines() {
  if (gridLines) {
    scene.remove(gridLines);
    gridLines.geometry.dispose();
  }
  const pts = [];
  const step = 0.5;
  const yAt = (x, z) => Math.max(sampleHeight(x, z), WATER_Y) + 0.035;
  for (let i = 0; i <= GRID; i++) {
    const c = -HALF + i * TILE;
    for (let s = -HALF; s < HALF - 1e-6; s += step) {
      pts.push(c, yAt(c, s), s, c, yAt(c, s + step), s + step);
      pts.push(s, yAt(s, c), c, s + step, yAt(s + step, c), c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  gridLines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x2b3445, transparent: true, opacity: 0.2 })
  );
  scene.add(gridLines);
}
rebuildGridLines();

// 유닛이 서는 높이 (강이면 바닥 = 도하 연출)
const standHeight = (gx, gz) => heightAt(gx, gz);

// ---------------------------------------------------------------------------
// 프랍 (WW 시대 오브젝트, 전부 파괴 가능)
// ---------------------------------------------------------------------------
// type: tree(수목) / bush(덤불) / house(농가) / rubble(잔해) / hedgehog(대전차 장애물) / sandbag(모래주머니)
const props = new Map(); // cellKey -> prop

const PROP_DEF = {
  tree:     { hp: 30, blockMove: true,  blockShotH: 0,   coverH: 2.4, cover: 1.0, name: '수목' },
  bush:     { hp: 12, blockMove: false, blockShotH: 0,   coverH: 0.9, cover: 0.5, name: '덤불', moveExtra: 1.0 },
  house:    { hp: 85, blockMove: true,  blockShotH: 2.3, coverH: 0,   cover: 0,   name: '농가' },
  rubble:   { hp: 35, blockMove: false, blockShotH: 0,   coverH: 0.9, cover: 0.6, name: '잔해', moveExtra: 1.6 },
  hedgehog: { hp: 40, blockMove: true,  blockShotH: 0,   coverH: 0.8, cover: 0.4, name: '대전차 장애물' },
  sandbag:  { hp: 26, blockMove: true,  blockShotH: 0,   coverH: 0.8, cover: 0.5, name: '모래주머니' },
};

function buildTreeMesh() {
  const g = new THREE.Group();
  const trunk = part(new THREE.CylinderGeometry(0.14, 0.2, 0.9, 8), 0x8a6844);
  trunk.position.y = 0.45;
  g.add(trunk);
  if (rng() < 0.45) {
    // 침엽수
    for (let i = 0; i < 3; i++) {
      const cone = part(new THREE.ConeGeometry(0.85 - i * 0.22, 0.9, 8), i % 2 ? 0x5f9e57 : 0x699f4f);
      cone.position.y = 1.1 + i * 0.55;
      g.add(cone);
    }
  } else {
    // 활엽수 (브로콜리 스타일)
    const s1 = part(new THREE.SphereGeometry(0.75, 10, 10), 0x74b25d);
    s1.position.y = 1.45;
    g.add(s1);
    const s2 = part(new THREE.SphereGeometry(0.5, 10, 10), 0x83bd68);
    s2.position.set(0.42, 1.15, 0.2);
    g.add(s2);
  }
  return g;
}
function buildBushMesh() {
  const g = new THREE.Group();
  const s = part(new THREE.SphereGeometry(0.55, 9, 9), 0x7fb069);
  s.scale.y = 0.62;
  s.position.y = 0.32;
  g.add(s);
  return g;
}
function buildHouseMesh() {
  const g = new THREE.Group();
  const body = part(new RoundedBoxGeometry(1.55, 1.15, 1.35, 2, 0.08), 0xe7dcc3);
  body.position.y = 0.57;
  g.add(body);
  const roof = part(new THREE.ConeGeometry(1.28, 0.85, 4), 0xb75c4a);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 1.55;
  g.add(roof);
  const chimney = part(new RoundedBoxGeometry(0.22, 0.5, 0.22, 1, 0.04), 0x8b7264);
  chimney.position.set(0.4, 1.85, 0.3);
  g.add(chimney);
  const door = part(new RoundedBoxGeometry(0.34, 0.55, 0.06, 1, 0.02), 0x7a5c3e, { outline: false });
  door.position.set(0, 0.32, 0.69);
  g.add(door);
  return g;
}
function buildRubbleMesh() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const b = part(
      new RoundedBoxGeometry(0.45 + rng() * 0.4, 0.22 + rng() * 0.2, 0.45 + rng() * 0.3, 1, 0.05),
      i % 2 ? 0xcfc4ac : 0xb0a28a
    );
    b.position.set((rng() - 0.5) * 1.1, 0.12 + rng() * 0.25, (rng() - 0.5) * 1.1);
    b.rotation.y = rng() * Math.PI;
    g.add(b);
  }
  return g;
}
function buildHedgehogMesh() {
  const g = new THREE.Group();
  const beam = () => part(new RoundedBoxGeometry(0.16, 1.5, 0.16, 1, 0.04), 0x55606f);
  const b1 = beam(); b1.rotation.set(0, 0, Math.PI / 4); g.add(b1);
  const b2 = beam(); b2.rotation.set(Math.PI / 4, Math.PI / 2, 0); g.add(b2);
  const b3 = beam(); b3.rotation.set(-Math.PI / 4, -Math.PI / 4, 0); g.add(b3);
  g.children.forEach((c) => (c.position.y = 0.5));
  return g;
}
function buildSandbagMesh() {
  const g = new THREE.Group();
  const bagGeo = new RoundedBoxGeometry(0.5, 0.26, 0.3, 2, 0.1);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const bag = part(bagGeo, row ? 0xd6c294 : 0xc9b384);
      const a = (i / (3 - row * 0.5)) * Math.PI * 0.8 - Math.PI * 0.4;
      bag.position.set(Math.sin(a) * 0.6, 0.14 + row * 0.24, Math.cos(a) * 0.55 - 0.15);
      bag.rotation.y = a;
      g.add(bag);
    }
  }
  return g;
}
const PROP_BUILDERS = {
  tree: buildTreeMesh, bush: buildBushMesh, house: buildHouseMesh,
  rubble: buildRubbleMesh, hedgehog: buildHedgehogMesh, sandbag: buildSandbagMesh,
};

function placeProp(type, gx, gz) {
  const def = PROP_DEF[type];
  const group = PROP_BUILDERS[type]();
  const p = cellToWorld(gx, gz);
  group.position.set(p.x, heightAt(gx, gz), p.z);
  group.rotation.y = rng() * Math.PI * 2;
  // 클릭 판정용 히트박스
  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 2.4, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.position.y = 1.2;
  group.add(hit);
  scene.add(group);
  const prop = { type, def, gx, gz, hp: def.hp, group, hit };
  hit.userData.prop = prop;
  props.set(cellKey(gx, gz), prop);
  return prop;
}

// 랜덤 배치
{
  const forbidden = new Set();
  for (const s of [PLAYER_SPAWN, ...ENEMY_SPAWNS]) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) forbidden.add(cellKey(s.gx + dx, s.gz + dz));
  }
  const free = (gx, gz) =>
    inBounds(gx, gz) &&
    !forbidden.has(cellKey(gx, gz)) &&
    !props.has(cellKey(gx, gz)) &&
    terrainAt(gx, gz) !== T.WATER;

  // 수목: 숲 노이즈 군락
  const fNoise = makeNoise(6.8);
  let trees = 0;
  for (let gx = 0; gx < GRID && trees < 42; gx++) {
    for (let gz = 0; gz < GRID && trees < 42; gz++) {
      if (!free(gx, gz)) continue;
      if (terrainAt(gx, gz) !== T.GRASS) continue;
      const f = fNoise(gx, gz);
      if (f > 0.62 && rng() < 0.65) { placeProp('tree', gx, gz); trees++; }
      else if (f > 0.5 && rng() < 0.16) { placeProp('bush', gx, gz); }
    }
  }
  const scatter = (type, count, pred = () => true) => {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 600) {
      const gx = Math.floor(rng() * GRID), gz = Math.floor(rng() * GRID);
      if (!free(gx, gz) || !pred(gx, gz)) continue;
      placeProp(type, gx, gz);
      placed++;
    }
  };
  scatter('house', 5, (x, z) => terrainAt(x, z) !== T.MUD && heightAt(x, z) <= 1.5);
  scatter('hedgehog', 8);
  scatter('sandbag', 6);
  scatter('bush', 6);
}

// ---------------------------------------------------------------------------
// 리얼 디테일 스캐터: 풀 포기(교차 쿼드 컷아웃) + 흙 자갈 — 인스턴싱으로
// 드로콜 각 1회. 배치는 연속 지형 가중치를 따라 풀밭/흙 위에만.
// ---------------------------------------------------------------------------
{
  // 풀잎 실루엣 텍스처 (흰색으로 그려 instanceColor로 틴트)
  const grassTexCanvas = document.createElement('canvas');
  grassTexCanvas.width = grassTexCanvas.height = 64;
  {
    const ctx = grassTexCanvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 9; i++) {
      const bx = 6 + rng() * 52;
      const lean = (rng() - 0.5) * 14;
      const hgt = 30 + rng() * 30;
      const wdt = 2.2 + rng() * 2.4;
      ctx.beginPath();
      ctx.moveTo(bx - wdt, 64);
      ctx.quadraticCurveTo(bx - wdt * 0.4 + lean * 0.4, 64 - hgt * 0.6, bx + lean, 64 - hgt);
      ctx.quadraticCurveTo(bx + wdt * 0.5 + lean * 0.4, 64 - hgt * 0.6, bx + wdt, 64);
      ctx.fill();
    }
  }
  const grassTex = new THREE.CanvasTexture(grassTexCanvas);

  // 교차 쿼드 지오메트리 (2장 십자)
  const gPos = [], gUv = [], gIdx = [];
  for (const rot of [0, Math.PI / 2]) {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const b = gPos.length / 3;
    const w = 0.62, h = 0.55;
    gPos.push(-w / 2 * c, 0, -w / 2 * sn,  w / 2 * c, 0, w / 2 * sn,  w / 2 * c, h, w / 2 * sn,  -w / 2 * c, h, -w / 2 * sn);
    gUv.push(0, 0, 1, 0, 1, 1, 0, 1);
    gIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const grassGeo = new THREE.BufferGeometry();
  grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
  grassGeo.setAttribute('uv', new THREE.Float32BufferAttribute(gUv, 2));
  grassGeo.setIndex(gIdx);
  grassGeo.computeVertexNormals();

  const GRASS_N = 3200;
  const grassMesh = new THREE.InstancedMesh(
    grassGeo,
    new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 }),
    GRASS_N
  );
  grassMesh.receiveShadow = true;
  const gm = new THREE.Matrix4();
  const gq = new THREE.Quaternion();
  const gv = new THREE.Vector3();
  const gs = new THREE.Vector3();
  const gCol = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  let placed = 0, guard = 0;
  while (placed < GRASS_N && guard++ < GRASS_N * 8) {
    const wx = (rng() - 0.5) * (GRID * TILE - 1.2);
    const wz = (rng() - 0.5) * (GRID * TILE - 1.2);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.07) continue;
    const w = surfaceWeights(wx, wz, h);
    const grassW = (1 - w.dirt) * (1 - w.sand) * (1 - w.mud * 0.7) * (1 - w.rock) * (1 - w.bed);
    if (rng() > grassW * grassW) continue; // 풀밭일수록 촘촘히
    gq.setFromAxisAngle(up, rng() * Math.PI);
    gs.setScalar(0.7 + rng() * 0.9);
    gv.set(wx, h - 0.02, wz);
    gm.compose(gv, gq, gs);
    grassMesh.setMatrixAt(placed, gm);
    if (rng() < 0.38) gCol.setHSL(0.14 + rng() * 0.04, 0.42 + rng() * 0.15, 0.4 + rng() * 0.12); // 마른 풀
    else gCol.setHSL(0.23 + rng() * 0.07, 0.45 + rng() * 0.2, 0.3 + rng() * 0.13);
    grassMesh.setColorAt(placed, gCol);
    placed++;
  }
  grassMesh.count = placed;
  grassMesh.instanceMatrix.needsUpdate = true;
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  scene.add(grassMesh);

  // 자갈: 흙/진흙/바위 지대에 낮은 다면체
  const PEB_N = 420;
  const pebMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.09, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.92 }),
    PEB_N
  );
  pebMesh.castShadow = true;
  pebMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < PEB_N && guard++ < PEB_N * 10) {
    const wx = (rng() - 0.5) * (GRID * TILE - 1.2);
    const wz = (rng() - 0.5) * (GRID * TILE - 1.2);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.03) continue;
    const w = surfaceWeights(wx, wz, h);
    const dirtW = Math.min(1, w.dirt + w.mud * 0.8 + w.rock * 1.2 + w.sand * 0.35);
    if (rng() > dirtW * 0.85) continue;
    gq.setFromEuler(new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI));
    gs.set(0.5 + rng() * 1.1, 0.35 + rng() * 0.5, 0.5 + rng() * 1.1);
    gv.set(wx, h + 0.015, wz);
    gm.compose(gv, gq, gs);
    pebMesh.setMatrixAt(placed, gm);
    gCol.setHSL(0.09 + rng() * 0.03, 0.18 + rng() * 0.12, 0.2 + rng() * 0.13);
    pebMesh.setColorAt(placed, gCol);
    placed++;
  }
  pebMesh.count = placed;
  pebMesh.instanceMatrix.needsUpdate = true;
  if (pebMesh.instanceColor) pebMesh.instanceColor.needsUpdate = true;
  scene.add(pebMesh);

  // 바위 노두: 급경사면에 반쯤 묻힌 각진 암석 (레퍼런스 절벽 톤)
  const ROCK_N = 110;
  const rockMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.42, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    ROCK_N
  );
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < ROCK_N && guard++ < ROCK_N * 40) {
    const wx = (rng() - 0.5) * (GRID * TILE - 1.6);
    const wz = (rng() - 0.5) * (GRID * TILE - 1.6);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.05) continue;
    const w = surfaceWeights(wx, wz, h);
    if (w.rock < 0.3 || rng() > w.rock) continue;
    gq.setFromEuler(new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI));
    gs.set(0.6 + rng() * 1.3, 0.45 + rng() * 0.7, 0.6 + rng() * 1.3);
    gv.set(wx, h - 0.12 + rng() * 0.1, wz);
    gm.compose(gv, gq, gs);
    rockMesh.setMatrixAt(placed, gm);
    gCol.setHSL(0.1 + rng() * 0.03, 0.2 + rng() * 0.1, 0.4 + rng() * 0.13);
    rockMesh.setColorAt(placed, gCol);
    placed++;
  }
  rockMesh.count = placed;
  rockMesh.instanceMatrix.needsUpdate = true;
  if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
  scene.add(rockMesh);

  // 여울 강돌: 도하 가능한 얕은 물에만 배치 — 수심이 얕은 곳이 한눈에 보인다
  const STONE_N = 150;
  const stoneMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.11, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    STONE_N
  );
  stoneMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < STONE_N && guard++ < STONE_N * 60) {
    const wx = (rng() - 0.5) * (GRID * TILE - 1.6);
    const wz = (rng() - 0.5) * (GRID * TILE - 1.6);
    const h = sampleHeight(wx, wz);
    const depth = WATER_Y - h;
    if (depth < 0.02 || depth > FORD_DEPTH - 0.03) continue;
    gq.setFromEuler(new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI));
    const sc = 0.7 + rng() * 1.2;
    gs.set(sc, sc * (0.55 + rng() * 0.3), sc);
    gv.set(wx, h + 0.05, wz); // 바닥에 얹혀 머리가 수면 위로 살짝 나온다
    gm.compose(gv, gq, gs);
    stoneMesh.setMatrixAt(placed, gm);
    gCol.setHSL(0.09 + rng() * 0.04, 0.1 + rng() * 0.1, 0.34 + rng() * 0.16);
    stoneMesh.setColorAt(placed, gCol);
    placed++;
  }
  stoneMesh.count = placed;
  stoneMesh.instanceMatrix.needsUpdate = true;
  if (stoneMesh.instanceColor) stoneMesh.instanceColor.needsUpdate = true;
  scene.add(stoneMesh);
}

// ---------------------------------------------------------------------------
// 지면 클릭 → 셀 계산 (하이트필드 직접 레이캐스트)
// ---------------------------------------------------------------------------
function raycastGroundCell(raycaster) {
  const hit = raycaster.intersectObject(terrainMesh, false)[0];
  if (!hit) return null;
  return worldToCell(hit.point);
}

// ---------------------------------------------------------------------------
// SD 탱크 모델
// ---------------------------------------------------------------------------
function buildTank(bodyColor, accentColor) {
  const g = new THREE.Group();
  const trackGeo = new RoundedBoxGeometry(0.55, 0.75, 2.0, 3, 0.26);
  const wheelGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.6, 12);
  for (const side of [-1, 1]) {
    const track = part(trackGeo, 0x3d4454);
    track.position.set(side * 0.72, 0.42, 0);
    g.add(track);
    for (const z of [-0.62, 0, 0.62]) {
      const wheel = part(wheelGeo, 0x8b95a8, { outline: false });
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.72, 0.33, z);
      g.add(wheel);
    }
  }
  const hull = part(new RoundedBoxGeometry(1.34, 0.62, 1.75, 3, 0.16), bodyColor);
  hull.position.y = 0.78;
  g.add(hull);
  const glacis = part(new RoundedBoxGeometry(1.0, 0.3, 0.34, 2, 0.1), accentColor);
  glacis.position.set(0, 0.86, 0.86);
  g.add(glacis);

  const turret = new THREE.Group();
  turret.position.y = 1.28;
  const dome = part(new RoundedBoxGeometry(1.3, 0.95, 1.3, 4, 0.4), bodyColor);
  dome.position.y = 0.3;
  turret.add(dome);
  const hatch = part(new THREE.CylinderGeometry(0.3, 0.34, 0.18, 14), accentColor);
  hatch.position.set(-0.25, 0.85, -0.18);
  turret.add(hatch);
  const antenna = part(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), 0x3d4454, { outline: false, shadow: false });
  antenna.position.set(0.42, 1.1, -0.35);
  turret.add(antenna);
  const antennaTip = part(new THREE.SphereGeometry(0.07, 8, 8), accentColor, { outline: false });
  antennaTip.position.set(0.42, 1.5, -0.35);
  turret.add(antennaTip);

  const cannon = new THREE.Group();
  cannon.position.set(0, 0.32, 0.55);
  const barrel = part(new THREE.CylinderGeometry(0.15, 0.17, 1.25, 12), 0x3d4454);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.62;
  cannon.add(barrel);
  const muzzle = part(new THREE.CylinderGeometry(0.23, 0.23, 0.32, 12), accentColor);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = 1.28;
  cannon.add(muzzle);
  turret.add(cannon);
  g.add(turret);

  const hitbox = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 2.6, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitbox.position.y = 1.3;
  g.add(hitbox);
  return { group: g, turret, cannon, muzzle, hitbox };
}

// HP/레벨 바 스프라이트
function makeHpBar() {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 44;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2.0, 0.55, 1);
  sprite.position.y = 3.3;
  sprite.renderOrder = 10;
  return { sprite, canvas, tex };
}
function updateHpBar(unit) {
  const { canvas, tex } = unit.hpBar;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 160, 44);
  ctx.fillStyle = '#232a38';
  ctx.beginPath();
  ctx.roundRect(0, 0, 160, 22, 9);
  ctx.fill();
  const ratio = Math.max(0, unit.hp / unit.maxHp);
  ctx.fillStyle = unit.isPlayer ? '#4da3ff' : ratio > 0.4 ? '#7ddb5a' : '#ff8a4d';
  ctx.beginPath();
  ctx.roundRect(3, 3, 154 * ratio, 16, 6);
  ctx.fill();
  ctx.font = 'bold 17px sans-serif';
  ctx.fillStyle = '#232a38';
  ctx.textAlign = 'center';
  ctx.fillText(unit.isPlayer ? `차체${unit.hullLv} 조종${unit.driverLv}` : `차체${unit.hullLv} AI${unit.driverLv}`, 80, 40);
  tex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// 유닛
// ---------------------------------------------------------------------------
const units = [];
function spawnUnit(isPlayer, gx, gz, facing) {
  // 차고에서 조립한 SD 킷 모델 사용 — 플레이어는 선택 기체, 적은 나머지 기체
  const kitKey = isPlayer
    ? playerKit
    : enemyKits[units.filter((u) => !u.isPlayer).length % enemyKits.length];
  const model = buildKitTank(kitKey);
  const hullLv = isPlayer ? PLAYER_STATS.hullLv : 1 + Math.floor(rng() * 3);
  const driverLv = isPlayer ? PLAYER_STATS.driverLv : 1 + Math.floor(rng() * 3);
  const base = isPlayer ? PLAYER_STATS : ENEMY_BASE;
  const maxHp = (isPlayer ? 110 : 60) + hullLv * 15;
  const unit = {
    isPlayer, gx, gz, kitKey,
    gun: KIT_INFO[kitKey].gun,
    mp: base.mp, fireRange: base.fireRange, damage: base.damage,
    hullLv, driverLv,
    hp: maxHp, maxHp,
    alive: true,
    ...model,
  };
  const p = cellToWorld(gx, gz);
  unit.group.position.set(p.x, standHeight(gx, gz), p.z);
  unit.group.rotation.order = 'YXZ';
  unit.group.rotation.y = facing;
  unit.group.rotation.x = groundPitch(unit);
  unit.hpBar = makeHpBar();
  unit.group.add(unit.hpBar.sprite);
  unit.hitbox.userData.unit = unit;
  updateHpBar(unit);
  scene.add(unit.group);
  units.push(unit);
  return unit;
}
const player = spawnUnit(true, PLAYER_SPAWN.gx, PLAYER_SPAWN.gz, Math.PI);
const enemies = ENEMY_SPAWNS.map((s) => spawnUnit(false, s.gx, s.gz, 0));

// 탱크가 2×2타일 크기이므로 다른 유닛과 체비쇼프 1칸 이내로 접근 불가
const isOccupied = (gx, gz, except = null) =>
  units.some((u) => u.alive && u !== except &&
    Math.max(Math.abs(u.gx - gx), Math.abs(u.gz - gz)) <= 1);

// ---------------------------------------------------------------------------
// 이동: 방향 상태 다익스트라 (지형비용 + 경사 + 선회비용 = 궤도 기동)
// ---------------------------------------------------------------------------
const DIRS = [
  { dx: 0, dz: 1 },  // 0: +z
  { dx: 1, dz: 0 },  // 1: +x
  { dx: 0, dz: -1 }, // 2: -z
  { dx: -1, dz: 0 }, // 3: -x
];
const TURN_COST = 0.6; // 90도 선회당

function facingDir(unit) {
  // rotation.y 기준 가장 가까운 4방향
  const a = unit.group.rotation.y;
  const v = { dx: Math.sin(a), dz: Math.cos(a) };
  let best = 0, bd = -Infinity;
  DIRS.forEach((d, i) => {
    const dot = d.dx * v.dx + d.dz * v.dz;
    if (dot > bd) { bd = dot; best = i; }
  });
  return best;
}

function stepCost(fromX, fromZ, toX, toZ, mover = null) {
  if (!inBounds(toX, toZ)) return Infinity;
  const dh = heightAt(toX, toZ) - heightAt(fromX, fromZ);
  if (Math.abs(dh) > MAX_CLIMB) return Infinity; // 궤도로 못 오르는 단차
  const prop = props.get(cellKey(toX, toZ));
  if (prop && prop.def.blockMove) return Infinity;
  if (isOccupied(toX, toZ, mover)) return Infinity;
  // 깊은 물은 도하 불가 — 여울(얕은 구간)로만 강을 건널 수 있다
  if (terrainAt(toX, toZ) === T.WATER && WATER_Y - heightAt(toX, toZ) > FORD_DEPTH) return Infinity;
  let c = TERRAIN_COST[terrainAt(toX, toZ)];
  if (prop && prop.def.moveExtra) c += prop.def.moveExtra;
  if (dh > 0) c += dh * 1.6;       // 오르막: 단차 비례
  else if (dh < 0) c += -dh * 0.3; // 내리막: 소폭
  return c;
}

// 반환: Map(cellKey -> { cost, path[{gx,gz}], endDir })
function reachableCells(unit) {
  const startDir = facingDir(unit);
  const best = new Map(); // "x,z,dir" -> cost
  const prev = new Map();
  const pq = [{ gx: unit.gx, gz: unit.gz, dir: startDir, cost: 0 }];
  best.set(`${unit.gx},${unit.gz},${startDir}`, 0);
  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i].cost < pq[bi].cost) bi = i;
    const cur = pq.splice(bi, 1)[0];
    const curKey = `${cur.gx},${cur.gz},${cur.dir}`;
    if (cur.cost > (best.get(curKey) ?? Infinity)) continue;
    for (let d = 0; d < 4; d++) {
      const turn = Math.min(Math.abs(d - cur.dir), 4 - Math.abs(d - cur.dir)) * TURN_COST;
      const nx = cur.gx + DIRS[d].dx, nz = cur.gz + DIRS[d].dz;
      const sc = stepCost(cur.gx, cur.gz, nx, nz, unit);
      if (!isFinite(sc)) continue;
      const nc = cur.cost + turn + sc;
      if (nc > unit.mp) continue;
      const nk = `${nx},${nz},${d}`;
      if (nc < (best.get(nk) ?? Infinity)) {
        best.set(nk, nc);
        prev.set(nk, curKey);
        pq.push({ gx: nx, gz: nz, dir: d, cost: nc });
      }
    }
  }
  const result = new Map();
  for (const [k, cost] of best) {
    const [x, z, d] = k.split(',').map(Number);
    const ck = cellKey(x, z);
    if (x === unit.gx && z === unit.gz) continue;
    if (!result.has(ck) || cost < result.get(ck).cost) {
      // 경로 역추적
      const path = [];
      let cur = k;
      while (cur) {
        const [px, pz] = cur.split(',').map(Number);
        path.unshift({ gx: px, gz: pz });
        cur = prev.get(cur);
      }
      // 시작 셀 중복 제거 (제자리 선회 노드)
      const clean = path.filter(
        (c, i) => i === 0 || c.gx !== path[i - 1].gx || c.gz !== path[i - 1].gz
      );
      clean.shift(); // 시작 셀 제외
      result.set(ck, { cost, path: clean, endDir: d });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 포격 판정: 사거리 + 포신 각도 + 지형/프랍 차폐 + 명중률
// ---------------------------------------------------------------------------
function muzzleApprox(unit, cell = null) {
  const gx = cell ? cell.gx : unit.gx;
  const gz = cell ? cell.gz : unit.gz;
  const p = cellToWorld(gx, gz);
  return new THREE.Vector3(p.x, standHeight(gx, gz) + 1.6, p.z);
}
function aimPointOf(target) {
  if (target.unit) {
    const u = target.unit;
    return new THREE.Vector3(u.group.position.x, standHeight(u.gx, u.gz) + 0.9, u.group.position.z);
  }
  if (target.prop) {
    const pr = target.prop;
    const p = cellToWorld(pr.gx, pr.gz);
    return new THREE.Vector3(p.x, heightAt(pr.gx, pr.gz) + 0.7, p.z);
  }
  const p = cellToWorld(target.gx, target.gz);
  return new THREE.Vector3(p.x, Math.max(heightAt(target.gx, target.gz), WATER_Y) + 0.5, p.z);
}

// 반환 { ok, reason, chance, distCells, pitch, cover }
function computeShot(attacker, target, fromCell = null) {
  const from = muzzleApprox(attacker, fromCell);
  const aim = aimPointOf(target);
  const dx = aim.x - from.x, dz = aim.z - from.z;
  const horiz = Math.hypot(dx, dz);
  const distCells = horiz / TILE;
  if (distCells > attacker.fireRange) return { ok: false, reason: `사거리 밖 (${distCells.toFixed(1)}/${attacker.fireRange}칸)` };
  if (distCells < 1.2) return { ok: false, reason: '너무 가까움' };

  // 포신 부앙각 — 차종별 한계 (T-34는 내림각이 나쁘고, FT는 유연)
  const pMin = attacker.gun?.pitchMin ?? PITCH_MIN;
  const pMax = attacker.gun?.pitchMax ?? PITCH_MAX;
  const pitch = (Math.atan2(aim.y - from.y, horiz) * 180) / Math.PI;
  if (pitch < pMin) return { ok: false, reason: `목표가 너무 낮음 (포신 내림각 ${pMin}° 한계)` };
  if (pitch > pMax) return { ok: false, reason: `목표가 너무 높음 (포신 올림각 +${pMax}° 한계)` };

  // 고정 포신: 사각(arc) 검사. 스폰슨 부포(Mark IV)는 좌/우 측면(±90°) 중심,
  // 일반 고정포는 정면 중심. 가상 위치 평가(fromCell)는 이동으로 선회한다고 보고 스킵.
  if (attacker.gun?.fixed && !fromCell) {
    const relDeg = Math.abs(THREE.MathUtils.radToDeg(
      normAngle(Math.atan2(dx, dz) - attacker.group.rotation.y)
    ));
    const arcDeg = attacker.gun.arc ?? 55;
    if (attacker.gun.sponson) {
      if (Math.abs(relDeg - 90) > arcDeg) {
        return { ok: false, reason: `측면 부포 사각(좌우 90°±${arcDeg}°) 밖 — 이동으로 측면을 내주세요` };
      }
    } else if (relDeg > arcDeg) {
      return { ok: false, reason: `고정 포신 — 차체 정면 ±${arcDeg}° 밖 (이동으로 선회 필요)` };
    }
  }

  // 사선 차폐 검사 (직선 샘플링)
  const attackerKey = cellKey(fromCell ? fromCell.gx : attacker.gx, fromCell ? fromCell.gz : attacker.gz);
  const targetKey = target.unit
    ? cellKey(target.unit.gx, target.unit.gz)
    : target.prop
      ? cellKey(target.prop.gx, target.prop.gz)
      : cellKey(target.gx, target.gz);
  const steps = Math.max(8, Math.ceil(distCells * 5));
  const coverCells = new Map();
  const pt = new THREE.Vector3();
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    pt.lerpVectors(from, aim, t);
    const c = worldToCell(pt);
    const ck = cellKey(c.gx, c.gz);
    if (ck === attackerKey || ck === targetKey) continue;
    if (sampleHeight(pt.x, pt.z) > pt.y + 0.05) return { ok: false, reason: '지형(능선)에 사선이 막힘', blockCell: { gx: c.gx, gz: c.gz } };
    const prop = props.get(ck);
    if (prop) {
      const groundH = heightAt(c.gx, c.gz);
      if (prop.def.blockShotH > 0 && pt.y < groundH + prop.def.blockShotH) {
        return { ok: false, reason: `${prop.def.name}에 사선이 막힘` };
      }
      if (prop.def.coverH > 0 && pt.y < groundH + prop.def.coverH) {
        coverCells.set(ck, prop.def.cover);
      }
    }
  }
  let cover = 0;
  for (const v of coverCells.values()) cover += v;
  cover = Math.min(2, cover);

  // 명중률
  let chance;
  if (target.unit) {
    const heightAdv = THREE.MathUtils.clamp((from.y - aim.y) * 6, -10, 12);
    // 거리 편차: 4칸까지 최고 명중, 이후 칸당 3% + 원거리 가속 페널티 (1칸=1유닛)
    const distPen = Math.max(0, distCells - 4) * 3 + Math.max(0, distCells - 12) * 1.25;
    chance = 96 - distPen - cover * 14 - target.unit.driverLv * 6 + heightAdv;
    chance = THREE.MathUtils.clamp(Math.round(chance), 8, 96);
  } else {
    chance = THREE.MathUtils.clamp(Math.round(90 - distCells * 2.25 - cover * 10), 20, 95);
  }
  return { ok: true, chance, distCells, pitch, cover };
}

// 사격 가능한 모든 셀 스캔: 사거리·부앙각·사선(LoS)이 유효한 셀만 반환.
// 셀에 유닛/프랍이 있으면 그것을 조준한 판정, 빈 칸이면 지면 판정.
function computeFireCells(unit) {
  const out = new Map();
  const R = Math.ceil(unit.fireRange);
  for (let gx = unit.gx - R; gx <= unit.gx + R; gx++) {
    for (let gz = unit.gz - R; gz <= unit.gz + R; gz++) {
      if (!inBounds(gx, gz)) continue;
      if (gx === unit.gx && gz === unit.gz) continue;
      const occ = units.find((t) => t.alive && t !== unit && t.gx === gx && t.gz === gz);
      const prop = props.get(cellKey(gx, gz));
      const target = occ ? { unit: occ } : prop ? { prop } : { gx, gz };
      const shot = computeShot(unit, target);
      if (shot.ok) out.set(cellKey(gx, gz), { gx, gz, shot });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 트윈
// ---------------------------------------------------------------------------
const activeTweens = [];
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const linear = (k) => k;
function tween(dur, onUpdate, ease = easeInOut) {
  return new Promise((resolve) => {
    activeTweens.push({ start: performance.now(), dur, onUpdate, ease, resolve });
  });
}
const delay = (ms) => tween(ms, () => {}, linear);
function updateTweens(now) {
  for (let i = activeTweens.length - 1; i >= 0; i--) {
    const tw = activeTweens[i];
    const k = Math.min(1, (now - tw.start) / tw.dur);
    tw.onUpdate(tw.ease(k), k);
    if (k >= 1) { activeTweens.splice(i, 1); tw.resolve(); }
  }
}
async function rotateTo(unit, targetRot, dur = 130) {
  const from = unit.group.rotation.y;
  let diff = targetRot - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) < 0.01) return;
  await tween(dur, (e) => { unit.group.rotation.y = from + diff * e; });
}
// 차체가 지면 경사를 따라 기울어지는 각도
function groundPitch(unit) {
  const ry = unit.group.rotation.y;
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const p = unit.group.position;
  const hF = sampleHeight(p.x + fx * 0.8, p.z + fz * 0.8);
  const hB = sampleHeight(p.x - fx * 0.8, p.z - fz * 0.8);
  return THREE.MathUtils.clamp(Math.atan2(hB - hF, 1.6), -0.45, 0.45);
}

async function moveUnit(unit, path) {
  for (const cell of path) {
    const from = unit.group.position.clone();
    const to = cellToWorld(cell.gx, cell.gz);
    await rotateTo(unit, Math.atan2(to.x - from.x, to.z - from.z), 80);
    sfx(terrainAt(cell.gx, cell.gz) === T.WATER ? 'splash' : 'step');
    await tween(105, (e) => {
      const x = THREE.MathUtils.lerp(from.x, to.x, e);
      const z = THREE.MathUtils.lerp(from.z, to.z, e);
      unit.group.position.set(x, sampleHeight(x, z) + Math.sin(e * Math.PI) * 0.08, z);
      unit.group.rotation.x = groundPitch(unit);
    });
    unit.gx = cell.gx;
    unit.gz = cell.gz;
    unit.group.position.y = sampleHeight(to.x, to.z);
  }
  unit.group.rotation.x = groundPitch(unit);
}

// ---------------------------------------------------------------------------
// 이펙트: 파편 / 폭발 / 크레이터 / 분해
// ---------------------------------------------------------------------------
const shellGeo = new THREE.SphereGeometry(0.17, 10, 10);
const shellMat = new THREE.MeshBasicMaterial({ color: 0x2f3542 });
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd24d, transparent: true });
const debrisGeo = new RoundedBoxGeometry(0.22, 0.22, 0.22, 1, 0.05);

function spawnDebris(center, colors, count, power) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(debrisGeo, toonMat(colors[i % colors.length]));
    mesh.castShadow = true;
    mesh.position.copy(center);
    mesh.scale.setScalar(0.5 + Math.random());
    scene.add(mesh);
    pieces.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * power, Math.random() * power * 0.9 + 2, (Math.random() - 0.5) * power),
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
    });
  }
  const floorY = center.y - 1;
  tween(1100, (e, rawK) => {
    const dt = 0.016;
    for (const p of pieces) {
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < floorY + 0.11) {
        p.mesh.position.y = floorY + 0.11;
        p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      if (rawK > 0.7) p.mesh.scale.multiplyScalar(0.94);
    }
  }, linear).then(() => pieces.forEach((p) => scene.remove(p.mesh)));
}

function breakApartGroup(group, power = 8) {
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  const ws = new THREE.Vector3();
  const meshes = [];
  group.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline && o.material.visible !== false && !o.isSprite) meshes.push(o);
  });
  const pieces = [];
  for (const mesh of meshes) {
    mesh.getWorldPosition(worldPos);
    mesh.getWorldQuaternion(worldQuat);
    mesh.getWorldScale(ws);
    const clone = new THREE.Mesh(mesh.geometry, mesh.material);
    clone.castShadow = true;
    clone.position.copy(worldPos);
    clone.quaternion.copy(worldQuat);
    clone.scale.copy(ws);
    scene.add(clone);
    pieces.push({
      mesh: clone,
      vel: new THREE.Vector3((Math.random() - 0.5) * power, Math.random() * 6 + 3, (Math.random() - 0.5) * power),
      spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5),
    });
  }
  const floorY = group.position.y;
  scene.remove(group);
  tween(1500, (e, rawK) => {
    const dt = 0.016;
    for (const p of pieces) {
      p.vel.y -= 15 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < floorY + 0.15) {
        p.mesh.position.y = floorY + 0.15;
        p.vel.y *= -0.3; p.vel.x *= 0.75; p.vel.z *= 0.75;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (rawK > 0.75) p.mesh.scale.multiplyScalar(0.93);
    }
  }, linear).then(() => pieces.forEach((p) => scene.remove(p.mesh)));
}

// 크레이터: 하이트필드를 부드럽게 함몰시켜 지형 파괴
function crater(gx, gz) {
  if (!inBounds(gx, gz)) return;
  if (terrainAt(gx, gz) === T.WATER) return;
  const c = cellToWorld(gx, gz);
  const R = 2.1, DEPTH = 0.5;
  const pos = terrainGeo.attributes.position;
  const colAttr = terrainGeo.attributes.color;
  const dirtCol = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i) - c.x, pos.getZ(i) - c.z);
    if (d >= R) continue;
    const dep = DEPTH * (0.5 + 0.5 * Math.cos((d / R) * Math.PI));
    pos.setY(i, Math.max(pos.getY(i) - dep, WATER_Y + 0.04));
    if (d < R * 0.72) {
      const vc = worldToCell({ x: pos.getX(i), z: pos.getZ(i) });
      if (terrain[vc.gx][vc.gz] !== T.WATER) {
        dirtCol.set(TERRAIN_COLORS[T.DIRT][0]).multiplyScalar(0.72 + 0.1 * (d / R));
        colAttr.setXYZ(i, dirtCol.r, dirtCol.g, dirtCol.b);
      }
    }
  }
  pos.needsUpdate = true;
  colAttr.needsUpdate = true;
  terrainGeo.computeVertexNormals();
  terrain[gx][gz] = T.DIRT;
  // 주변 셀 높이 캐시 갱신 + 프랍 높이 보정 (크레이터 R 2.1 = 약 2칸)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const x = gx + dx, z = gz + dz;
      if (!inBounds(x, z)) continue;
      const p = cellToWorld(x, z);
      cellH[x][z] = sampleHeight(p.x, p.z);
      const prop = props.get(cellKey(x, z));
      if (prop) prop.group.position.y = heightAt(x, z);
    }
  }
  rebuildGridLines();
  // 근처 유닛 높이/기울기 보정
  for (const u of units) {
    if (!u.alive) continue;
    const d = Math.hypot(u.group.position.x - c.x, u.group.position.z - c.z);
    if (d < R + 1) {
      const y = sampleHeight(u.group.position.x, u.group.position.z);
      tween(220, (e) => {
        u.group.position.y = THREE.MathUtils.lerp(u.group.position.y, y, e);
        u.group.rotation.x = groundPitch(u);
      });
    }
  }
}

function damageProp(prop, dmg) {
  if (!props.has(cellKey(prop.gx, prop.gz))) return;
  prop.hp -= dmg;
  if (prop.hp > 0) {
    // 흔들림
    const g = prop.group;
    const rot = g.rotation.y;
    tween(200, (e, rawK) => { g.rotation.y = rot + Math.sin(rawK * 30) * 0.08 * (1 - rawK); }, linear);
    return;
  }
  props.delete(cellKey(prop.gx, prop.gz));
  breakApartGroup(prop.group, 6);
  sfx('hit');
  if (prop.type === 'house') {
    // 농가 → 잔해 단계
    placeProp('rubble', prop.gx, prop.gz);
  }
}

async function explosionFx(pos, big = false) {
  sfx(big ? 'explode' : 'hit');
  const flash = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.9 : 0.55, 12, 12), flashMat.clone());
  flash.position.copy(pos);
  scene.add(flash);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.55, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, pos.y + 0.1, pos.z);
  scene.add(ring);
  spawnDebris(pos, [0xffb347, 0x8b95a8, 0x6f5a3e], big ? 16 : 9, big ? 7 : 4.5);
  await tween(big ? 420 : 300, (e) => {
    flash.scale.setScalar(1 + e * (big ? 2.6 : 1.6));
    flash.material.opacity = 1 - e;
    ring.scale.setScalar(1 + e * 4);
    ring.material.opacity = 1 - e;
  }, easeOut);
  scene.remove(flash);
  scene.remove(ring);
}

// 떠오르는 텍스트 (명중/빗나감/데미지)
function popText(pos, text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 192; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#232a38';
  ctx.strokeText(text, 96, 46);
  ctx.fillStyle = color;
  ctx.fillText(text, 96, 46);
  const tex = new THREE.CanvasTexture(canvas);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.6, 0.9, 1);
  sp.position.copy(pos).add(new THREE.Vector3(0, 2.6, 0));
  sp.renderOrder = 20;
  scene.add(sp);
  tween(900, (e) => {
    sp.position.y = pos.y + 2.6 + e * 1.2;
    sp.material.opacity = 1 - e * e;
  }, linear).then(() => scene.remove(sp));
}

// ---------------------------------------------------------------------------
// 전투 처리
// ---------------------------------------------------------------------------
function updatePlayerHpUI() {
  playerHpNum.textContent = `${Math.max(0, player.hp)} / ${player.maxHp}`;
  playerHpFill.style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;
}

async function applyUnitDamage(target, rawDmg) {
  const dmg = Math.round(rawDmg * (1 - 0.07 * target.hullLv)); // 차체 레벨 = 장갑
  target.hp -= dmg;
  updateHpBar(target);
  if (target.isPlayer) updatePlayerHpUI();
  popText(target.group.position, `-${dmg}`, target.isPlayer ? '#ff8a8a' : '#ffe28a');
  if (target.hp <= 0) {
    target.alive = false;
    await explosionFx(target.group.position.clone().add(new THREE.Vector3(0, 1, 0)), true);
    breakApartGroup(target.group, 8);
    sfx('explode');
  } else {
    const base = target.group.position.clone();
    await tween(240, (e, rawK) => {
      const decay = 1 - rawK;
      target.group.position.x = base.x + Math.sin(rawK * 40) * 0.09 * decay;
      target.group.position.z = base.z + Math.cos(rawK * 34) * 0.09 * decay;
    }, linear);
    target.group.position.copy(base);
  }
}

// 착탄 처리: 크레이터 + 프랍 피해 + 스플래시
async function resolveImpact(impact, attacker, directUnit = null) {
  await explosionFx(impact.clone().add(new THREE.Vector3(0, 0.4, 0)), !!directUnit);
  const c = worldToCell(impact);
  crater(c.gx, c.gz);
  // 프랍 피해 (착탄 셀 + 주변 2칸, 거리 감쇠)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const prop = props.get(cellKey(c.gx + dx, c.gz + dz));
      if (!prop) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      damageProp(prop, ring === 0 ? 60 : ring === 1 ? 38 : 20);
    }
  }
  if (directUnit) {
    await applyUnitDamage(directUnit, attacker.damage);
  }
  // 스플래시 (직격 대상 제외)
  for (const u of units) {
    if (!u.alive || u === directUnit) continue;
    const d = Math.hypot(u.group.position.x - impact.x, u.group.position.z - impact.z);
    if (d < 2.0) await applyUnitDamage(u, attacker.damage * 0.4); // 스플래시 반경 (월드 유닛)
  }
}

// 목표를 향해 조준: 포탑 기체는 포탑 요 회전, 무포탑(Mark IV)은 차체 선회.
// 포신 부앙각은 목표 고도차에 맞춰 자동 조절 (이슈 #6)
const normAngle = (a) => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;
// 고정포의 사각 창으로 상대 요각을 클램프 (스폰슨은 좌/우 ±90° 중심 창)
function clampToGunArc(unit, rel) {
  const arc = THREE.MathUtils.degToRad(unit.gun?.arc ?? 55);
  if (unit.gun?.sponson) {
    const side = rel >= 0 ? 1 : -1;
    const half = Math.PI / 2;
    return side * THREE.MathUtils.clamp(Math.abs(rel), half - arc, half + arc);
  }
  return THREE.MathUtils.clamp(rel, -arc, arc);
}
async function aimAt(attacker, aim, pitchDeg, instant = false) {
  const dx = aim.x - attacker.group.position.x;
  const dz = aim.z - attacker.group.position.z;
  const targetYaw = Math.atan2(dx, dz);
  const pitchRad = -THREE.MathUtils.degToRad(pitchDeg);
  if (attacker.gun?.fixed) {
    // 고정 포신: 차체는 그대로, 포만 사각(arc) 안에서 좌우 미세 조준.
    // 스폰슨 부포는 목표 쪽 측면(±90°) 창으로 클램프.
    const rel = clampToGunArc(attacker, normAngle(targetYaw - attacker.group.rotation.y));
    const from = attacker.cannon.rotation.y;
    const diff = normAngle(rel - from);
    if (Math.abs(diff) > 0.01 && !instant) {
      await tween(140 + Math.abs(diff) * 100, (e) => { attacker.cannon.rotation.y = from + diff * e; });
    } else {
      attacker.cannon.rotation.y = rel;
    }
  } else if (attacker.hasTurret) {
    const rel = normAngle(targetYaw - attacker.group.rotation.y);
    const from = attacker.turret.rotation.y;
    const diff = normAngle(rel - from);
    if (Math.abs(diff) > 0.01 && !instant) {
      sfxOnce(attacker);
      await tween(160 + Math.abs(diff) * 130, (e) => { attacker.turret.rotation.y = from + diff * e; });
    } else {
      attacker.turret.rotation.y = rel;
    }
  } else {
    await rotateTo(attacker, targetYaw, 200);
  }
  const fromP = attacker.cannon.rotation.x;
  if (instant) attacker.cannon.rotation.x = pitchRad;
  else await tween(140, (e) => { attacker.cannon.rotation.x = fromP + (pitchRad - fromP) * e; });
  return pitchRad;
}
function sfxOnce(attacker) { if (!attacker._trvSfx) { attacker._trvSfx = true; setTimeout(() => (attacker._trvSfx = false), 400); sfx('step'); } }

async function fireSequence(attacker, target, shot) {
  const aim = aimPointOf(target);
  // 포탑/차체 조준 + 포신 부앙각 자동 조절
  const pitchRad = await aimAt(attacker, aim, shot.pitch);

  sfx('fire');
  const muzzlePos = new THREE.Vector3();
  attacker.muzzle.getWorldPosition(muzzlePos);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), flashMat.clone());
  flash.position.copy(muzzlePos);
  scene.add(flash);
  tween(160, (e) => { flash.scale.setScalar(1 + e); flash.material.opacity = 1 - e; }).then(() => scene.remove(flash));
  const cz = attacker.cannon.position.z;
  tween(200, (e, rawK) => { attacker.cannon.position.z = cz - Math.sin(rawK * Math.PI) * 0.2; }, linear);

  // 명중 굴림
  const roll = Math.random() * 100;
  const hit = roll < shot.chance;
  let impact = aim.clone();
  if (!hit) {
    const a = Math.random() * Math.PI * 2;
    // 산포 반경도 거리에 비례 — 원거리 빗나감은 크게 벗어난다
    const r = TILE * (1.0 + Math.random() * 1.6) * (0.7 + (shot.distCells ?? 8) * 0.055);
    impact.x += Math.sin(a) * r;
    impact.z += Math.cos(a) * r;
    impact.y = Math.max(sampleHeight(impact.x, impact.z), WATER_Y) + 0.1;
  }

  // 포탄 궤적
  const from = muzzlePos.clone();
  const dist = from.distanceTo(impact);
  const mid = from.clone().lerp(impact, 0.5);
  mid.y = Math.max(from.y, impact.y) + 1.6 + dist * 0.12;
  const shell = new THREE.Mesh(shellGeo, shellMat);
  scene.add(shell);
  await tween(Math.min(700, 260 + dist * 26), (e) => {
    const a = from.clone().lerp(mid, e);
    const b = mid.clone().lerp(impact, e);
    shell.position.copy(a.lerp(b, e));
  }, linear);
  scene.remove(shell);
  tween(200, (e) => { attacker.cannon.rotation.x = pitchRad * (1 - e); });

  if (!hit && target.unit) popText(aimPointOf(target), 'MISS!', '#bcd2ff');
  const directUnit = hit && target.unit ? target.unit : null;
  const directProp = hit && target.prop ? target.prop : null;
  if (directProp) damageProp(directProp, attacker.damage * 1.4);
  await resolveImpact(impact, attacker, directUnit);
}

// ---------------------------------------------------------------------------
// 하이라이트
// ---------------------------------------------------------------------------
const moveHighlightGroup = new THREE.Group();
scene.add(moveHighlightGroup);
// 이동(파랑)/포격(빨강) 필드 재질 — 활성 모드는 채움+굵은 외곽선,
// 비활성 모드는 얇은 외곽선만 그려 두 영역이 겹쳐도 읽기 쉽게 한다
const moveFillMat = new THREE.MeshBasicMaterial({
  color: 0x4da3ff, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false,
});
const moveEdgeMat = new THREE.MeshBasicMaterial({ color: 0x2f7fe0, transparent: true, opacity: 0.9, depthWrite: false });
const moveEdgeThinMat = new THREE.MeshBasicMaterial({ color: 0x2f7fe0, transparent: true, opacity: 0.3, depthWrite: false });
const fireFillMat = new THREE.MeshBasicMaterial({
  color: 0xff5544, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
});
const fireEdgeMat = new THREE.MeshBasicMaterial({ color: 0xd0342c, transparent: true, opacity: 0.9, depthWrite: false });
const fireEdgeThinMat = new THREE.MeshBasicMaterial({ color: 0xd0342c, transparent: true, opacity: 0.32, depthWrite: false });

const groundY = (x, z) => Math.max(sampleHeight(x, z), WATER_Y);

// 셀 집합의 외곽 경계를 방향 있는 에지로 추출해 루프로 연결
function boundaryLoops(cellSet) {
  const h = TILE / 2;
  const pending = new Map(); // "x,z" 시작점 -> [{ax,az,bx,bz}]
  const pkey = (x, z) => `${Math.round(x * 4)},${Math.round(z * 4)}`;
  for (const key of cellSet) {
    const [gx, gz] = key.split(',').map(Number);
    const c = cellToWorld(gx, gz);
    // (인접 셀이 집합 밖) → 공유 에지, 영역이 왼쪽에 오도록 방향 부여
    const edges = [
      [0, 1,  c.x + h, c.z + h, c.x - h, c.z + h],
      [1, 0,  c.x + h, c.z - h, c.x + h, c.z + h],
      [0, -1, c.x - h, c.z - h, c.x + h, c.z - h],
      [-1, 0, c.x - h, c.z + h, c.x - h, c.z - h],
    ];
    for (const [dx, dz, ax, az, bx, bz] of edges) {
      if (!cellSet.has(cellKey(gx + dx, gz + dz))) {
        const k = pkey(ax, az);
        if (!pending.has(k)) pending.set(k, []);
        pending.get(k).push({ ax, az, bx, bz });
      }
    }
  }
  const loops = [];
  while (pending.size) {
    const firstArr = pending.values().next().value;
    let seg = firstArr[0];
    const loop = [];
    while (seg) {
      const k = pkey(seg.ax, seg.az);
      const arr = pending.get(k);
      arr.splice(arr.indexOf(seg), 1);
      if (!arr.length) pending.delete(k);
      loop.push([seg.ax, seg.az]);
      const nk = pkey(seg.bx, seg.bz);
      seg = pending.get(nk)?.[0] ?? null;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

// 차이킨 코너 커팅으로 다각형을 부드럽게 (닫힌 루프)
function chaikin(loop, iterations = 2) {
  let pts = loop;
  for (let it = 0; it < iterations; it++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    pts = next;
  }
  return pts;
}

// 홀짝 규칙 점-다각형 판정 (루프 여러 개 → 구멍 자동 처리)
function insideLoops(loops, x, z) {
  let inside = false;
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, zi] = loop[i];
      const [xj, zj] = loop[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

// 부드러운 외곽선을 따라 지형에 밀착하는 튜브
function loopTube(pts, lift, radius, mat) {
  const v = pts.map(([x, z]) => new THREE.Vector3(x, groundY(x, z) + lift, z));
  const curve = new THREE.CatmullRomCurve3(v, true, 'catmullrom', 0.1);
  const geo = new THREE.TubeGeometry(curve, Math.max(48, pts.length), radius, 5, true);
  return new THREE.Mesh(geo, mat);
}

// 셀 집합 → 콘벡스헐 느낌의 범위 필드 (차이킨 스무딩 경계 + 지형 밀착 채움)
// fill=false면 얇은 외곽선만 (비활성 모드 표시용)
function showCellField(cellKeys, { fillMat, edgeMat, fill = true, edgeRadius = 0.09 }) {
  const set = cellKeys instanceof Set ? cellKeys : new Set(cellKeys);
  if (!set.size) return;
  const loops = boundaryLoops(set).map((l) => chaikin(l, 2));
  if (fill) {
    // 채움: 0.5 간격 서브셀 래스터 → 지형 굴곡을 따라가는 쿼드
    const step = 0.5;
    const verts = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const loop of loops) {
      for (const [x, z] of loop) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
    for (let x = minX; x < maxX; x += step) {
      for (let z = minZ; z < maxZ; z += step) {
        if (!insideLoops(loops, x + step / 2, z + step / 2)) continue;
        const y00 = groundY(x, z) + 0.05, y10 = groundY(x + step, z) + 0.05;
        const y01 = groundY(x, z + step) + 0.05, y11 = groundY(x + step, z + step) + 0.05;
        verts.push(x, y00, z, x, y01, z + step, x + step, y10, z);
        verts.push(x + step, y10, z, x, y01, z + step, x + step, y11, z + step);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    moveHighlightGroup.add(new THREE.Mesh(geo, fillMat));
  }
  for (const loop of loops) moveHighlightGroup.add(loopTube(loop, 0.09, fill ? edgeRadius : edgeRadius * 0.55, edgeMat));
}

function showMoveField(cells, active) {
  const set = new Set(cells.keys());
  set.add(cellKey(player.gx, player.gz)); // 자기 칸 포함해 구멍 방지
  showCellField(set, {
    fillMat: moveFillMat,
    edgeMat: active ? moveEdgeMat : moveEdgeThinMat,
    fill: active,
  });
}

// 사격 가능 필드: 부앙각/사거리/사선이 전부 유효한 셀만 포함 —
// 못 쏘는 구역(너무 가까움·능선 차폐 등)은 애초에 영역에서 빠진다
function showFireField(cells, active) {
  showCellField(new Set(cells.keys()), {
    fillMat: fireFillMat,
    edgeMat: active ? fireEdgeMat : fireEdgeThinMat,
    fill: active,
  });
}
const targetRings = [];
const targetRingGeo = new THREE.RingGeometry(1.15, 1.42, 32);
const targetRingMat = new THREE.MeshBasicMaterial({
  color: 0xff5544, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
});
const chanceSprites = [];

function clearHighlights() {
  for (const ch of moveHighlightGroup.children) ch.geometry.dispose();
  moveHighlightGroup.clear();
  for (const r of targetRings) scene.remove(r);
  targetRings.length = 0;
  for (const s of chanceSprites) scene.remove(s);
  chanceSprites.length = 0;
}
function chanceSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 52;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(35,42,56,0.92)';
  ctx.beginPath();
  ctx.roundRect(6, 2, 116, 48, 12);
  ctx.fill();
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd24d';
  ctx.fillText(text, 64, 37);
  const tex = new THREE.CanvasTexture(canvas);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(1.9, 0.78, 1);
  sp.renderOrder = 15;
  return sp;
}
function showTargets(targets) {
  for (const t of targets) {
    const ring = new THREE.Mesh(targetRingGeo, targetRingMat);
    ring.rotation.x = -Math.PI / 2;
    const u = t.unit;
    ring.position.set(u.group.position.x, Math.max(standHeight(u.gx, u.gz), WATER_Y) + 0.12, u.group.position.z);
    scene.add(ring);
    targetRings.push(ring);
    const sp = chanceSprite(`${t.shot.chance}%`);
    sp.position.set(u.group.position.x, u.group.position.y + 4.0, u.group.position.z);
    scene.add(sp);
    chanceSprites.push(sp);
  }
}

// ---------------------------------------------------------------------------
// 효과음
// ---------------------------------------------------------------------------
let actx = null;
function sfx(kind) {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    const gain = actx.createGain();
    gain.connect(actx.destination);
    if (kind === 'fire') {
      const osc = actx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(240, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.16);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain); osc.start(t); osc.stop(t + 0.2);
    } else if (kind === 'step' || kind === 'splash') {
      const osc = actx.createOscillator();
      osc.type = kind === 'splash' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(kind === 'splash' ? 130 : 190 + Math.random() * 40, t);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.connect(gain); osc.start(t); osc.stop(t + 0.08);
    } else {
      const dur = kind === 'explode' ? 0.5 : 0.16;
      const buf = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = actx.createBufferSource();
      src.buffer = buf;
      const filter = actx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = kind === 'explode' ? 900 : 2200;
      gain.gain.setValueAtTime(kind === 'explode' ? 0.22 : 0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter).connect(gain);
      src.start(t);
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const turnLabel = document.getElementById('turn-label');
const hintEl = document.getElementById('hint');
const btnMoveMode = document.getElementById('btn-move-mode');
const btnFireMode = document.getElementById('btn-fire-mode');
const btnWait = document.getElementById('btn-wait');
const btnRestart = document.getElementById('btn-restart');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnAgain = document.getElementById('btn-again');
const playerHpNum = document.getElementById('player-hp-num');
const playerHpFill = document.getElementById('player-hp-fill');
const levelLabel = document.getElementById('level-label');
if (levelLabel) {
  const g = player.gun;
  const gunTxt = g.sponson ? `측면 부포 90°±${g.arc}°` : g.fixed ? `고정포 ±${g.arc}°` : '포탑';
  levelLabel.textContent = `${KIT_INFO[playerKit].label} · ${gunTxt} · 부앙 ${g.pitchMin}°~+${g.pitchMax}° · 기동 ${player.mp} · 사거리 ${player.fireRange}`;
}

// 상태 메시지: 짧게 표시 후 자동 소거 (포격 불가 사유 등 값만)
let hintTimer = 0;
const setHint = (t) => {
  hintEl.textContent = t;
  clearTimeout(hintTimer);
  if (t) hintTimer = setTimeout(() => { hintEl.textContent = ''; }, 2600);
};
btnRestart.addEventListener('click', () => location.reload());
const btnGarage = document.getElementById('btn-garage');
if (btnGarage) btnGarage.addEventListener('click', () => { location.href = './index.html'; });
btnAgain.addEventListener('click', () => location.reload());

// 성능 표시: 기본 FPS만, 클릭하면 프레임타임/드로콜/트라이앵글 펼침
const perfEl = document.getElementById('perf');
const perfFps = document.getElementById('perf-fps');
const perfMs = document.getElementById('perf-ms');
const perfDc = document.getElementById('perf-dc');
const perfTri = document.getElementById('perf-tri');
perfEl.addEventListener('click', () => perfEl.classList.toggle('open'));
renderer.info.autoReset = false; // 컴포저 다중 패스 합산을 위해 수동 리셋
let perfFrames = 0;
let perfT0 = performance.now();
function updatePerf(now) {
  perfFrames++;
  if (now - perfT0 < 500) return;
  const fps = (perfFrames * 1000) / (now - perfT0);
  perfFps.textContent = `${fps.toFixed(0)} FPS`;
  perfMs.textContent = `${(1000 / fps).toFixed(1)} ms`;
  perfDc.textContent = `DC ${renderer.info.render.calls}`;
  perfTri.textContent = `TRI ${renderer.info.render.triangles.toLocaleString('en-US')}`;
  perfFrames = 0;
  perfT0 = now;
}

// ---------------------------------------------------------------------------
// 턴 상태 머신
// ---------------------------------------------------------------------------
// 동시 턴제(WeGo): 턴마다 모든 차량이 행동 1개(AP 1)를 고르고 한꺼번에 진행.
// 행동은 이동 또는 포격 — 포격은 "셀"을 조준하는 예측 사격이라
// 목표가 그 턴에 움직이면 빗나간다. 플레이어가 행동을 고르는 즉시
// 적들도 행동을 계획하고 전원 동시에 해결된다.
const COLLISION_DMG = 16; // 같은 칸 진입 충돌 시 상호 피해
let turnNo = 1;
let phase = 'plan'; // plan | resolve | gameover
let busy = false;
let planMode = 'move'; // move | fire
let currentMoveCells = new Map();
let currentFireCells = new Map();

function setPlanMode(mode) {
  planMode = mode;
  btnMoveMode.classList.toggle('on', mode === 'move');
  btnFireMode.classList.toggle('on', mode === 'fire');
  if (phase === 'plan' && !busy) renderFields();
}

// 겹침 해법: 활성 모드의 필드만 채워 그리고, 비활성 필드는 얇은 외곽선으로만
// 남긴다 — 두 영역이 겹치는 곳에서도 항상 한 가지 의미(현재 모드)로 읽힌다
function renderFields() {
  clearHighlights();
  if (phase !== 'plan') return;
  if (planMode === 'move') {
    showMoveField(currentMoveCells, true);
    showFireField(currentFireCells, false);
  } else {
    showFireField(currentFireCells, true);
    showMoveField(currentMoveCells, false);
    showTargets(
      enemies
        .filter((e) => e.alive && currentFireCells.has(cellKey(e.gx, e.gz)))
        .map((e) => ({ unit: e, shot: currentFireCells.get(cellKey(e.gx, e.gz)).shot }))
    );
  }
}

function startPlanning() {
  if (checkGameEnd()) return;
  phase = 'plan';
  busy = false;
  turnLabel.textContent = `턴 ${turnNo}`;
  currentMoveCells = reachableCells(player);
  currentFireCells = computeFireCells(player);
  renderFields();
}

async function submitPlayerPlan(plan) {
  if (phase !== 'plan' || busy) return;
  player.plan = plan;
  planEnemies();
  await resolveTurn();
}

// 적 AI 계획 — AI 레벨(driverLv)에 따라 다르게 행동한다:
//  Lv1: 플레이어의 현재 칸만 조준 (예측 없음)
//  Lv2: 지난 턴 이동 방향의 절반만큼 리드 사격 + 능선 굴착
//  Lv3: 지난 턴 이동을 그대로 외삽한 칸을 리드 사격 + 능선 굴착
// 굴착: 사선이 능선에 막히면 그 지형을 포격해 크레이터로 포각을 확보한다.
let playerLastMove = null; // 지난 턴 플레이어 변위 {dx, dz}
function predictPlayerCell(lvl) {
  if (lvl <= 1 || !playerLastMove) return { gx: player.gx, gz: player.gz };
  const f = lvl >= 3 ? 1 : 0.5;
  return {
    gx: THREE.MathUtils.clamp(Math.round(player.gx + playerLastMove.dx * f), 0, GRID - 1),
    gz: THREE.MathUtils.clamp(Math.round(player.gz + playerLastMove.dz * f), 0, GRID - 1),
  };
}
function planEnemies() {
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const lvl = enemy.driverLv;
    const aim = predictPlayerCell(lvl);
    const aimIsPlayer = aim.gx === player.gx && aim.gz === player.gz;
    const shot = computeShot(enemy, aimIsPlayer ? { unit: player } : aim);
    if (shot.ok && (!aimIsPlayer || shot.chance >= 30)) {
      enemy.plan = { type: 'fire', cell: aim, shot };
      continue;
    }
    // 능선 굴착 (Lv2+): 막힌 능선 지형을 포격해 다음 턴 포각 확보
    if (lvl >= 2 && shot.blockCell) {
      const dig = computeShot(enemy, shot.blockCell);
      if (dig.ok) {
        enemy.plan = { type: 'fire', cell: shot.blockCell, shot: dig };
        continue;
      }
    }
    const cells = reachableCells(enemy);
    let best = null;
    for (const [key, info] of cells) {
      const [gx, gz] = key.split(',').map(Number);
      const s = computeShot(enemy, { unit: player }, { gx, gz });
      const distP = Math.hypot(gx - player.gx, gz - player.gz);
      const score = s.ok ? 200 + s.chance - info.cost * 2 : 100 - distP * 5 - info.cost;
      if (!best || score > best.score) best = { score, info };
    }
    if (best && best.info.path.length) enemy.plan = { type: 'move', path: best.info.path.slice() };
    else if (shot.ok && shot.chance >= 12) enemy.plan = { type: 'fire', cell: { gx: player.gx, gz: player.gz }, shot };
    else enemy.plan = { type: 'wait' };
  }
}

// 이동 충돌 시뮬레이션: 스텝 단위로 동시 진행.
// 같은 칸 진입·자리 맞바꿈·비켜나지 않는 점유자와의 접촉은 충돌 —
// 이동자는 직전 타일에서 멈추고(경로 절단) 양쪽 모두 피해를 입는다.
function simulateMoves() {
  const movers = units.filter((u) => u.alive && u.plan?.type === 'move' && u.plan.path.length);
  const cellOf = new Map();
  const cur = new Map();
  for (const u of units) {
    if (!u.alive) continue;
    cellOf.set(cellKey(u.gx, u.gz), u);
    cur.set(u, { gx: u.gx, gz: u.gz });
  }
  const stopped = new Set();
  const cut = new Map();
  const hits = [];
  const maxLen = Math.max(0, ...movers.map((u) => u.plan.path.length));
  for (let k = 0; k < maxLen; k++) {
    const intents = movers
      .filter((u) => !stopped.has(u) && u.plan.path.length > k)
      .map((u) => ({ u, to: u.plan.path[k] }));
    let changed = true;
    while (changed) {
      changed = false;
      const active = intents.filter((it) => !stopped.has(it.u));
      const cheb = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
      for (const it of active) {
        // 목적지끼리 1칸 이내로 근접하는 다른 이동자 (2×2 차체 충돌)
        const rival = active.find((o) => o !== it && cheb(o.to.gx, o.to.gz, it.to.gx, it.to.gz) <= 1);
        const swap = active.find((o) => {
          if (o === it) return false;
          const oc = cur.get(o.u), ic = cur.get(it.u);
          return o.to.gx === ic.gx && o.to.gz === ic.gz && it.to.gx === oc.gx && it.to.gz === oc.gz;
        });
        // 이번 스텝에 비켜나지 않는 유닛과 1칸 이내로 접촉
        let occ = null;
        for (const [u2, c2] of cur) {
          if (u2 === it.u) continue;
          if (cheb(c2.gx, c2.gz, it.to.gx, it.to.gz) > 1) continue;
          if (active.some((o) => o.u === u2)) continue; // 같은 스텝에 이동 중이면 rival 검사가 처리
          occ = u2;
          break;
        }
        if (rival || swap || occ) {
          const other = rival?.u ?? swap?.u ?? occ;
          stopped.add(it.u);
          cut.set(it.u, k);
          if (rival) { stopped.add(rival.u); cut.set(rival.u, k); }
          if (swap) { stopped.add(swap.u); cut.set(swap.u, k); }
          hits.push({ a: it.u, b: other });
          changed = true;
          break;
        }
      }
    }
    // 두 패스 적용: 동시 이동 시 방금 비운 칸을 다른 유닛이 차지해도
    // 점유 맵이 깨지지 않도록 삭제를 먼저 전부 처리한다
    const winners = intents.filter((it) => !stopped.has(it.u));
    for (const it of winners) {
      const c = cur.get(it.u);
      cellOf.delete(cellKey(c.gx, c.gz));
    }
    for (const it of winners) {
      const c = cur.get(it.u);
      c.gx = it.to.gx;
      c.gz = it.to.gz;
      cellOf.set(cellKey(c.gx, c.gz), it.u);
    }
  }
  for (const u of movers) if (cut.has(u)) u.plan.path = u.plan.path.slice(0, cut.get(u));
  // 같은 쌍 중복 제거
  const seen = new Set();
  return hits.filter((h) => {
    const key = [units.indexOf(h.a), units.indexOf(h.b)].sort((x, y) => x - y).join('-');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 계획된 포격 해결: 조준한 셀에 지금 무엇이 있는지로 판정 (예측 사격)
async function resolvePlannedShot(u) {
  const { gx, gz } = u.plan.cell;
  const occ = units.find((t) => t.alive && t !== u && t.gx === gx && t.gz === gz);
  let target = occ ? { unit: occ } : null;
  let shot = target ? computeShot(u, target) : null;
  if (!shot?.ok) {
    const prop = props.get(cellKey(gx, gz));
    if (prop) { target = { prop }; shot = computeShot(u, target); }
  }
  if (!shot?.ok) { target = { gx, gz }; shot = computeShot(u, target); }
  if (!shot.ok) { target = { gx, gz }; shot = u.plan.shot; } // 지형 변화 등 — 계획값으로 발사
  await fireSequence(u, target, shot);
}

async function resolveTurn() {
  phase = 'resolve';
  busy = true;
  clearHighlights();
  turnLabel.textContent = `턴 ${turnNo} ▶`;
  const collisions = simulateMoves();
  const playerStart = { gx: player.gx, gz: player.gz };
  // 1) 전 차량 동시 이동
  const movers = units.filter((u) => u.alive && u.plan?.type === 'move' && u.plan.path.length);
  await Promise.all(movers.map((u) => moveUnit(u, u.plan.path)));
  // 2) 충돌 정산: 스파크 + 상호 피해
  for (const h of collisions) {
    if (!h.a.alive || !h.b.alive) continue;
    const mid = h.a.group.position.clone().lerp(h.b.group.position, 0.5);
    mid.y += 0.8;
    sfx('hit');
    spawnDebris(mid, [0xffd24d, 0x8b95a8], 8, 4);
    popText(mid, '충돌!', '#ffd24d');
    await Promise.all([applyUnitDamage(h.a, COLLISION_DMG), applyUnitDamage(h.b, COLLISION_DMG)]);
  }
  // 3) 전원 동시 포격
  const shooters = units.filter((u) => u.alive && u.plan?.type === 'fire');
  await Promise.all(shooters.map((u) => resolvePlannedShot(u)));
  // AI 예측용: 이번 턴 플레이어 변위 기록 (이동 안 했으면 null → 현재 칸 조준)
  const pdx = player.gx - playerStart.gx, pdz = player.gz - playerStart.gz;
  playerLastMove = pdx || pdz ? { dx: pdx, dz: pdz } : null;
  for (const u of units) u.plan = null;
  if (checkGameEnd()) return;
  turnNo++;
  startPlanning();
}

function checkGameEnd() {
  if (!player.alive) {
    phase = 'gameover';
    overlayTitle.textContent = '💥 패배...';
    overlaySub.textContent = '내 탱크가 격파되었습니다. 다시 조립해 봅시다!';
    overlay.classList.add('show');
    return true;
  }
  if (enemies.every((e) => !e.alive)) {
    phase = 'gameover';
    overlayTitle.textContent = '🏆 승리!';
    overlaySub.textContent = `${turnNo}턴 만에 모든 적 탱크를 격파했습니다!`;
    overlay.classList.add('show');
    return true;
  }
  return false;
}

btnMoveMode.addEventListener('click', () => setPlanMode('move'));
btnFireMode.addEventListener('click', () => setPlanMode('fire'));
btnWait.addEventListener('click', async () => {
  if (phase === 'plan' && !busy) await submitPlayerPlan({ type: 'wait' });
});

// ---------------------------------------------------------------------------
// 입력
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', async (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 7 || busy) return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  if (phase !== 'plan') return;

  // 1) 적 클릭 = 그 적의 "현재 칸"을 예측 사격 (모드 무관)
  const enemyHits = raycaster.intersectObjects(
    enemies.filter((e) => e.alive).map((e) => e.hitbox)
  );
  if (enemyHits.length) {
    const unit = enemyHits[0].object.userData.unit;
    const f = currentFireCells.get(cellKey(unit.gx, unit.gz));
    if (!f) { setHint(computeShot(player, { unit }).reason ?? '포격 불가'); return; }
    await submitPlayerPlan({ type: 'fire', cell: { gx: unit.gx, gz: unit.gz }, shot: f.shot });
    return;
  }
  // 2) 프랍 클릭 = 포격
  const propHits = raycaster.intersectObjects([...props.values()].map((p) => p.hit));
  if (propHits.length) {
    const prop = propHits[0].object.userData.prop;
    const f = currentFireCells.get(cellKey(prop.gx, prop.gz));
    if (!f) { setHint(computeShot(player, { prop }).reason ?? '포격 불가'); return; }
    await submitPlayerPlan({ type: 'fire', cell: { gx: prop.gx, gz: prop.gz }, shot: f.shot });
    return;
  }
  // 3) 지면: 현재 모드에 따라 이동 또는 예측 포격
  const cell = raycastGroundCell(raycaster);
  if (!cell) return;
  const ck = cellKey(cell.gx, cell.gz);
  if (planMode === 'move') {
    const info = currentMoveCells.get(ck);
    if (!info) {
      if (currentFireCells.has(ck)) setHint('이동 불가 — 🎯 포격 모드로 조준 가능');
      return;
    }
    await submitPlayerPlan({ type: 'move', path: info.path });
  } else {
    const f = currentFireCells.get(ck);
    if (!f) { setHint(computeShot(player, cell).reason ?? '포격 불가'); return; }
    await submitPlayerPlan({ type: 'fire', cell: { gx: cell.gx, gz: cell.gz }, shot: f.shot });
  }
});

// ---------------------------------------------------------------------------
// 호버 조준 프리뷰: 커서를 따라 포탑이 돌고 포신이 부앙각을 미리 잡는다 (이슈 #6)
// ---------------------------------------------------------------------------
let hoverAim = null;
let lastHoverCheck = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (phase !== 'plan' || busy) { hoverAim = null; return; }
  const now = performance.now();
  if (now - lastHoverCheck < 60) return;
  lastHoverCheck = now;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const enemyHit = raycaster.intersectObjects(
    enemies.filter((en) => en.alive).map((en) => en.hitbox)
  )[0];
  if (enemyHit) {
    hoverAim = aimPointOf({ unit: enemyHit.object.userData.unit });
    return;
  }
  const ground = raycaster.intersectObject(terrainMesh, false)[0];
  hoverAim = ground ? aimPointOf(worldToCell(ground.point)) : null;
});
function updateAimPreview(dt) {
  if (!player.alive || phase !== 'plan' || busy || !hoverAim) return;
  const k = 1 - Math.exp(-dt * 9);
  const aim = hoverAim;
  const targetYaw = Math.atan2(aim.x - player.group.position.x, aim.z - player.group.position.z);
  if (player.gun?.fixed) {
    const rel = clampToGunArc(player, normAngle(targetYaw - player.group.rotation.y));
    player.cannon.rotation.y += normAngle(rel - player.cannon.rotation.y) * k;
  } else if (player.hasTurret) {
    const rel = normAngle(targetYaw - player.group.rotation.y);
    player.turret.rotation.y += normAngle(rel - player.turret.rotation.y) * k;
  }
  // 포신 부앙각 미리보기: 목표 고도차 기준, 차종 한계각으로 클램프
  const from = muzzleApprox(player);
  const horiz = Math.hypot(aim.x - from.x, aim.z - from.z);
  const pitchDeg = THREE.MathUtils.clamp(
    (Math.atan2(aim.y - from.y, Math.max(horiz, 0.001)) * 180) / Math.PI,
    player.gun?.pitchMin ?? PITCH_MIN, player.gun?.pitchMax ?? PITCH_MAX
  );
  const target = -THREE.MathUtils.degToRad(pitchDeg);
  player.cannon.rotation.x += (target - player.cannon.rotation.x) * k;
}

// ---------------------------------------------------------------------------
// 메인 루프
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
let lastNow = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastNow) / 1000 || 0.016);
  lastNow = now;
  updateTweens(now);
  updateAimPreview(dt);
  const pulse = 1 + Math.sin(now * 0.006) * 0.08;
  for (const ring of targetRings) ring.scale.setScalar(pulse);
  rippleTex.offset.set((now * 0.0000121) % 1, (now * -0.0000324) % 1);
  controls.update();
  renderer.info.reset();
  composer.render();
  updatePerf(now);
}
updatePlayerHpUI();
startPlanning();
requestAnimationFrame(animate);

// ---------------------------------------------------------------------------
// 개발/테스트용 훅
// ---------------------------------------------------------------------------
window.__puratank = {
  seed,
  ssaoPass,
  composer,
  moveHighlightGroup,
  playerUnit: player,
  get state() {
    return {
      turnNo, phase, busy, planMode,
      player: { gx: player.gx, gz: player.gz, hp: player.hp, alive: player.alive, hullLv: player.hullLv, driverLv: player.driverLv },
      enemies: enemies.map((e) => ({ gx: e.gx, gz: e.gz, hp: e.hp, alive: e.alive, hullLv: e.hullLv, driverLv: e.driverLv })),
      props: props.size,
    };
  },
  heightAt: (gx, gz) => heightAt(gx, gz),
  terrainAt: (gx, gz) => TERRAIN_NAME[terrainAt(gx, gz)],
  reachable: () => [...reachableCells(player).keys()],
  fireCells: () => [...computeFireCells(player).keys()],
  setPlanMode,
  planMoveTo(gx, gz) {
    const info = currentMoveCells.get(cellKey(gx, gz));
    if (!info || phase !== 'plan' || busy) return false;
    submitPlayerPlan({ type: 'move', path: info.path });
    return true;
  },
  planFireAt(gx, gz) {
    const f = currentFireCells.get(cellKey(gx, gz));
    if (!f || phase !== 'plan' || busy) return false;
    submitPlayerPlan({ type: 'fire', cell: { gx, gz }, shot: f.shot });
    return true;
  },
  planWait() {
    if (phase !== 'plan' || busy) return false;
    submitPlayerPlan({ type: 'wait' });
    return true;
  },
  shotAt: (gx, gz) => {
    const enemy = enemies.find((e) => e.alive && e.gx === gx && e.gz === gz);
    return computeShot(player, enemy ? { unit: enemy } : { gx, gz });
  },
  screenPos(gx, gz) {
    const p = cellToWorld(gx, gz);
    p.y = standHeight(gx, gz) + 0.8;
    p.project(camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((-p.y + 1) / 2) * window.innerHeight };
  },
  screenPosGround(gx, gz) {
    const p = cellToWorld(gx, gz);
    p.y = sampleHeight(p.x, p.z) + 0.02;
    p.project(camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((-p.y + 1) / 2) * window.innerHeight };
  },
};
