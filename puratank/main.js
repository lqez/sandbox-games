// PURATANK — SD 플라모델 스타일 하이트맵 턴제 탱크 게임
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { SSAOPass } from './vendor/postprocessing/SSAOPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { ShaderPass } from './vendor/postprocessing/ShaderPass.js';
import { buildKitTank, KIT_INFO, KIT_KEYS, mergeStatic } from './src/kit-tank.js';

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
  { gx: 14, gz: 6 },
  { gx: 27, gz: 8 },
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
// 컬러 그레이드: 디오라마 촬영 톤 — 과채도 억제 + 대비 + 웜 틴트 + 비네트
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 0.9 },
    contrast: { value: 1.08 },
    warm: { value: new THREE.Vector3(1.035, 1.0, 0.95) },
    vignette: { value: 0.3 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float saturation; uniform float contrast;
    uniform vec3 warm; uniform float vignette; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, saturation);       // 채도 억제
      col = (col - 0.5) * contrast + 0.5;         // 대비
      col *= warm;                                // 웜 틴트
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.15, 0.9, dot(d, d) * 2.0); // 비네트
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }
  `,
};
const gradePass = new ShaderPass(GradeShader);
composer.addPass(gradePass);
// AO 제외 레이어: 컷아웃 풀·수면·오버레이가 SSAO 노멀 패스에서
// 통짜 사각형으로 렌더되어 검은 헤일로를 만드는 것을 방지
const NO_AO_LAYER = 1;
camera.layers.enable(NO_AO_LAYER);
const noAO = (obj) => obj.traverse((o) => o.layers.set(NO_AO_LAYER));
{
  const orig = ssaoPass.render.bind(ssaoPass);
  ssaoPass.render = (r, w, rd, dt, mask) => {
    camera.layers.disable(NO_AO_LAYER);
    orig(r, w, rd, dt, mask);
    camera.layers.enable(NO_AO_LAYER);
  };
}

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

// 흙/풀 디테일 텍스처 (프로시저럴 노이즈) — 컬러 얼룩 + 범프.
// 다중 스케일 유기적 모틀 + 미세 그레인 + 흙알갱이/균열로 지면 질감을 살린다.
function makeDetailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c8c8c8';
  ctx.fillRect(0, 0, 512, 512);
  // 미세 그레인
  const img = ctx.getImageData(0, 0, 512, 512);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 188 + Math.random() * 62;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  // 다중 스케일 유기적 얼룩 (큰 흙무리 → 잔 알갱이)
  const blobs = (n, rmin, rmax, alpha) => {
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 512, y = Math.random() * 512;
      const r = rmin + Math.random() * (rmax - rmin);
      const bright = Math.random() > 0.5;
      ctx.fillStyle = bright ? `rgba(255,255,250,${alpha})` : `rgba(55,48,36,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.4 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  blobs(90, 14, 34, 0.06);   // 큰 흙무리
  blobs(700, 4, 11, 0.09);   // 중간 얼룩
  blobs(2600, 1.2, 4, 0.11); // 잔 알갱이
  // 흙 알갱이/작은 돌 점각
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(40,34,24,0.16)' : 'rgba(250,246,235,0.12)';
    ctx.fillRect(x, y, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6);
  }
  // 가는 균열/뿌리 자국
  ctx.strokeStyle = 'rgba(45,38,28,0.10)';
  for (let i = 0; i < 40; i++) {
    ctx.lineWidth = 0.6 + Math.random() * 0.9;
    let x = Math.random() * 512, y = Math.random() * 512;
    ctx.beginPath(); ctx.moveTo(x, y);
    const seg = 3 + Math.floor(Math.random() * 4);
    for (let s = 0; s < seg; s++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.anisotropy = 4;
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
  // 자연 하천/못 톤: 여울은 탁한 청록, 깊은 곳은 짙은 청록(보라빛 배제)
  const shallow = { r: 130, g: 182, b: 160 };
  const mid = { r: 60, g: 124, b: 120 };
  const deep = { r: 34, g: 82, b: 84 };
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      // PlaneGeometry.rotateX(-PI/2) 기준: u→+x, 캔버스 행(py)→+z
      const wx = (px / (N - 1) - 0.5) * GRID * TILE;
      const wz = (py / (N - 1) - 0.5) * GRID * TILE;
      const depth = WATER_Y - sampleHeight(wx, wz);
      const i = (py * N + px) * 4;
      const t = smooth01(depth / 0.4);
      // 2구간 보간: shallow→mid→deep (청록 유지)
      let r, g, b;
      if (t < 0.5) {
        const k = t / 0.5;
        r = shallow.r + (mid.r - shallow.r) * k;
        g = shallow.g + (mid.g - shallow.g) * k;
        b = shallow.b + (mid.b - shallow.b) * k;
      } else {
        const k = (t - 0.5) / 0.5;
        r = mid.r + (deep.r - mid.r) * k;
        g = mid.g + (deep.g - mid.g) * k;
        b = mid.b + (deep.b - mid.b) * k;
      }
      // 유기적 얼룩(수면 탁도/조류) — 평면 슬래브 느낌 제거
      const mot = 0.93 + 0.07 * (
        0.5 + 0.5 * Math.sin(wx * 0.9 + wz * 0.5) * Math.cos(wz * 0.8 - wx * 0.3));
      r *= mot; g *= mot; b *= mot;
      // 물가 거품: 아주 얕은 수심 띠를 밝게
      const foam = smooth01((depth - 0.005) / 0.05) * (1 - smooth01((depth - 0.06) / 0.09));
      r += (222 - r) * foam;
      g += (232 - g) * foam;
      b += (230 - b) * foam;
      cImg.data[i] = r; cImg.data[i + 1] = g; cImg.data[i + 2] = b; cImg.data[i + 3] = 255;
      // 알파(green 채널): 물가에서 0으로 부드럽게 — 지형과 만나는 면이 자연스럽다
      const a = Math.min(0.93, smooth01(depth / 0.12) * 0.34 + smooth01(depth / 0.4) * 0.56 + foam * 0.3) * 255;
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
    normalScale: new THREE.Vector2(0.38, 0.38),
    transparent: true,
    depthWrite: false,
    roughness: 0.16,
    metalness: 0,
    envMapIntensity: 0.5,
  })
);
waterMesh.rotation.x = -Math.PI / 2;
waterMesh.position.y = WATER_Y;
noAO(waterMesh);
scene.add(waterMesh);

// 지형 테두리 스커트 — 하이트필드 가장자리가 뚫려 보이지 않게 측면을 막는다
{
  const yBot = -0.58;
  const step = TILE / VRES;
  const verts = [];
  const pushWall = (x0, z0, x1, z1) => {
    const h0 = Math.max(sampleHeight(x0, z0), WATER_Y);
    const h1 = Math.max(sampleHeight(x1, z1), WATER_Y);
    verts.push(x0, h0, z0, x0, yBot, z0, x1, h1, z1);
    verts.push(x1, h1, z1, x0, yBot, z0, x1, yBot, z1);
  };
  for (let t = -HALF; t < HALF - 1e-6; t += step) {
    pushWall(t, -HALF, t + step, -HALF);
    pushWall(t + step, HALF, t, HALF);
    pushWall(-HALF, t + step, -HALF, t);
    pushWall(HALF, t, HALF, t + step);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.computeVertexNormals();
  const skirt = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x63523c, roughness: 0.96, side: THREE.DoubleSide })
  );
  skirt.receiveShadow = true;
  scene.add(skirt);
}

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

// 유닛이 서는 높이 (강이면 바닥 = 도하 연출, 다리 위는 상판)
const standHeight = (gx, gz) =>
  (typeof bridge !== 'undefined' && bridge.alive && bridge.cells.has(cellKey(gx, gz)))
    ? bridge.deckY
    : heightAt(gx, gz);

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

// 공유 팔레트(toonMat 캐시로 재질 재사용 → 드로콜 절감)
const TRUNK_COLS = [0x6d5236, 0x7c5e3d, 0x5f4a30];
const LEAF_COLS = [0x577f3b, 0x678f45, 0x496f32, 0x749a4f, 0x86813c]; // 마지막=누런 잎
const PINE_COLS = [0x3c6437, 0x47733c, 0x33562f];
const AUTUMN_COLS = [0xb0894a, 0xa88a3c, 0x9c6f3a];
function buildTreeMesh() {
  const g = new THREE.Group();
  const pine = rng() < 0.4;
  const trunkCol = TRUNK_COLS[Math.floor(rng() * TRUNK_COLS.length)];
  const th = pine ? 1.0 + rng() * 0.3 : 0.7 + rng() * 0.45;
  const trunk = part(new THREE.CylinderGeometry(0.1, 0.19, th, 7), trunkCol);
  trunk.position.y = th / 2;
  trunk.rotation.z = (rng() - 0.5) * 0.12;
  g.add(trunk);
  if (pine) {
    // 침엽수: 여러 겹 원뿔, 위로 갈수록 좁고 어둡게, 불규칙 지터
    const layers = 4 + Math.floor(rng() * 2);
    const base = th * 0.68;
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const r = 0.92 * (1 - t * 0.7) + 0.05;
      const ch = 0.8 - i * 0.05;
      const cone = part(new THREE.ConeGeometry(r, ch, 8), PINE_COLS[i % PINE_COLS.length]);
      cone.position.set((rng() - 0.5) * 0.07, base + i * 0.52 + ch * 0.2, (rng() - 0.5) * 0.07);
      cone.rotation.y = rng() * Math.PI;
      cone.scale.y = 1 + rng() * 0.18;
      g.add(cone);
    }
  } else {
    // 활엽수: 불규칙 잎 덩이 6~8개를 흩어 얹어 뭉게진 수관
    const top = th + 0.3;
    const clumps = 6 + Math.floor(rng() * 3);
    const autumn = rng() < 0.24;
    for (let i = 0; i < clumps; i++) {
      const ang = rng() * Math.PI * 2, rad = rng() * 0.52;
      const col = (autumn && rng() < 0.45)
        ? AUTUMN_COLS[Math.floor(rng() * AUTUMN_COLS.length)]
        : LEAF_COLS[Math.floor(rng() * LEAF_COLS.length)];
      const s = 0.3 + rng() * 0.34;
      const clump = part(new THREE.IcosahedronGeometry(s, 0), col);
      clump.position.set(Math.cos(ang) * rad, top + (rng() - 0.5) * 0.55, Math.sin(ang) * rad);
      clump.scale.set(1 + rng() * 0.35, 0.78 + rng() * 0.3, 1 + rng() * 0.35);
      clump.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      g.add(clump);
    }
  }
  return g;
}
function buildBushMesh() {
  const g = new THREE.Group();
  const cols = [0x5c8a40, 0x6b9848, 0x4d7534, 0x86823c, 0x74994c];
  const clumps = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < clumps; i++) {
    const ang = rng() * Math.PI * 2, rad = rng() * 0.36;
    const s = 0.26 + rng() * 0.24;
    const c = part(new THREE.IcosahedronGeometry(s, 0), cols[Math.floor(rng() * cols.length)]);
    c.position.set(Math.cos(ang) * rad, 0.2 + rng() * 0.22, Math.sin(ang) * rad);
    c.scale.set(1 + rng() * 0.35, 0.72 + rng() * 0.26, 1 + rng() * 0.35);
    c.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(c);
  }
  return g;
}
// 벽돌 벽 텍스처: 어긋쌓기 벽돌 + 모르타르 줄눈 + 개체 색 변주/풍화
function makeBrickTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5f4a3c'; // 모르타르(어두운 바탕)
  ctx.fillRect(0, 0, 256, 256);
  const rows = 13, bh = 256 / rows, bw = 256 / 6;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let cx = -1; cx < 7; cx++) {
      const x = cx * bw + off + 1.5, y = r * bh + 1.5;
      const base = 120 + Math.random() * 55;
      const rr = base, gg = base * (0.62 + Math.random() * 0.12), bb = base * (0.46 + Math.random() * 0.12);
      ctx.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
      ctx.fillRect(x, y, bw - 3, bh - 3);
      // 풍화 얼룩
      if (Math.random() < 0.3) {
        ctx.fillStyle = `rgba(40,32,24,${0.1 + Math.random() * 0.2})`;
        ctx.fillRect(x, y, bw - 3, bh - 3);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
// 슬레이트 지붕 텍스처: 겹친 기와 가로 켜 + 색 변주
function makeSlateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#50555e';
  ctx.fillRect(0, 0, 256, 256);
  const rows = 15, th = 256 / rows, tw = 256 / 9;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (tw / 2);
    for (let cx = -1; cx < 10; cx++) {
      const x = cx * tw + off, y = r * th;
      const v = 96 + Math.random() * 54;
      ctx.fillStyle = `rgb(${v | 0},${(v * 1.03) | 0},${(v * 1.12) | 0})`;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, tw - 2, th * 1.5, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,22,26,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
const brickTex = makeBrickTexture();
const slateTex = makeSlateTexture();
const brickMat = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.95, color: 0xb9a48c, side: THREE.DoubleSide });
const slateMat = new THREE.MeshStandardMaterial({ map: slateTex, roughness: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.35, metalness: 0.1, envMapIntensity: 0.5 });
function texturedPart(geo, mat, uvRepeat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function buildHouseMesh() {
  const g = new THREE.Group();
  const W = 1.55, D = 1.35, H = 1.2, RH = 0.72, ov = 0.12; // 벽/지붕 치수
  // 벽돌 본체 (면마다 벽돌 크기 비슷하게 UV 반복 조정한 박스)
  const bodyGeo = new THREE.BoxGeometry(W, H, D);
  // BoxGeometry UV는 면당 0..1 — 벽돌 텍스처를 공유 재질로 쓰되 살짝 반복
  const body = texturedPart(bodyGeo, brickMat);
  body.position.y = H / 2;
  g.add(body);
  // 박공 지붕: 두 경사면(슬레이트) + 양 끝 벽돌 박공 삼각
  const half = W / 2 + ov, dov = D / 2 + ov;
  const slopeLen = Math.hypot(dov, RH);
  for (const s of [-1, 1]) {
    const slope = texturedPart(new THREE.BoxGeometry(W + ov * 2, 0.05, slopeLen), slateMat);
    slope.position.set(0, H + RH / 2, s * dov / 2);
    slope.rotation.x = s * Math.atan2(RH, dov);
    g.add(slope);
  }
  // 박공 삼각 벽 (앞뒤가 아니라 좌우 끝)
  for (const s of [-1, 1]) {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([
      0, H, -D / 2,  0, H, D / 2,  0, H + RH, 0,
    ], 3));
    tri.setIndex([0, 1, 2]);
    tri.computeVertexNormals();
    const gable = new THREE.Mesh(tri, brickMat);
    gable.position.x = s * W / 2;
    gable.castShadow = true; gable.receiveShadow = true;
    g.add(gable);
  }
  // 굴뚝
  const chimney = texturedPart(new THREE.BoxGeometry(0.24, 0.55, 0.24), brickMat);
  chimney.position.set(0.42, H + RH * 0.55, 0.25);
  g.add(chimney);
  const cap = part(new THREE.BoxGeometry(0.3, 0.08, 0.3), 0x54453a);
  cap.position.set(0.42, H + RH * 0.55 + 0.3, 0.25);
  g.add(cap);
  // 문
  const door = part(new THREE.BoxGeometry(0.34, 0.6, 0.05), 0x6b4a2e, { outline: false });
  door.position.set(0, 0.3, D / 2 + 0.01);
  g.add(door);
  const lintel = part(new THREE.BoxGeometry(0.42, 0.07, 0.08), 0xcfc3a8, { outline: false });
  lintel.position.set(0, 0.63, D / 2 + 0.02);
  g.add(lintel);
  // 창문 4개 (앞/옆) — 유리 + 밝은 틀
  const addWindow = (x, y, z, ry) => {
    const frame = part(new THREE.BoxGeometry(0.34, 0.42, 0.05), 0xcfc3a8, { outline: false });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.32), glassMat);
    frame.position.set(x, y, z); frame.rotation.y = ry;
    glass.position.set(x + Math.sin(ry) * 0.03, y, z + Math.cos(ry) * 0.03); glass.rotation.y = ry;
    g.add(frame, glass);
  };
  addWindow(-0.42, 0.85, D / 2 + 0.005, 0);
  addWindow(0.42, 0.85, D / 2 + 0.005, 0);
  addWindow(W / 2 + 0.005, 0.8, 0.3, Math.PI / 2);
  addWindow(W / 2 + 0.005, 0.8, -0.3, Math.PI / 2);
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
  // 수목/덤불은 개체마다 크기 변주 — 같은 종이라도 들쭉날쭉
  if (type === 'tree') group.scale.setScalar(0.82 + rng() * 0.55);
  else if (type === 'bush') group.scale.setScalar(0.85 + rng() * 0.5);
  // 클릭 판정용 히트박스
  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 2.4, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.position.y = 1.2;
  group.add(hit);
  scene.add(group);
  mergeStatic(group, [hit]); // 드로콜 절감: 프랍 메시 재질별 병합
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
const decorMeshes = []; // 풀/꽃/낙엽/잔가지 — 디버그 토글용
{
  // 스태틱 그래스 텍스처: 가는 잎 다발 + 밑동 어둡고 끝 밝은 세로 그라데이션.
  // 흰색으로 그려 instanceColor로 톤을 입히면 밑동 그늘/끝 하이라이트가 자연스럽다.
  const grassTexCanvas = document.createElement('canvas');
  grassTexCanvas.width = grassTexCanvas.height = 64;
  {
    const ctx = grassTexCanvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    for (let i = 0; i < 15; i++) {
      const bx = 4 + rng() * 56;
      const lean = (rng() - 0.5) * 20;
      const hgt = 34 + rng() * 28;
      const wdt = 1.2 + rng() * 1.8;
      const tipY = 64 - hgt;
      // 밑동(그늘) → 끝(밝음) 세로 그라데이션
      const grad = ctx.createLinearGradient(0, 64, 0, tipY);
      grad.addColorStop(0, 'rgba(150,150,150,1)');
      grad.addColorStop(0.5, 'rgba(220,220,220,1)');
      grad.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(bx - wdt, 64);
      ctx.quadraticCurveTo(bx - wdt * 0.35 + lean * 0.4, 64 - hgt * 0.55, bx + lean, tipY);
      ctx.quadraticCurveTo(bx + wdt * 0.45 + lean * 0.4, 64 - hgt * 0.55, bx + wdt, 64);
      ctx.fill();
    }
  }
  const grassTex = new THREE.CanvasTexture(grassTexCanvas);

  // 교차 쿼드 지오메트리 (3장 별 배치로 어느 각도에서도 두툼하게)
  const gPos = [], gUv = [], gIdx = [];
  for (const rot of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const b = gPos.length / 3;
    const w = 0.66, h = 0.6;
    gPos.push(-w / 2 * c, 0, -w / 2 * sn,  w / 2 * c, 0, w / 2 * sn,  w / 2 * c, h, w / 2 * sn,  -w / 2 * c, h, -w / 2 * sn);
    gUv.push(0, 0, 1, 0, 1, 1, 0, 1);
    gIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const grassGeo = new THREE.BufferGeometry();
  grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
  grassGeo.setAttribute('uv', new THREE.Float32BufferAttribute(gUv, 2));
  grassGeo.setIndex(gIdx);
  grassGeo.computeVertexNormals();

  // 디오라마 스태틱 그래스 팔레트: 저주파 노이즈로 마른/젖은 무리가 뭉쳐 분포.
  // 톤 6종을 dryness(0=싱싱 초록 … 1=마른 밀짚/고사)로 가중 선택.
  const patchNoise = makeNoise(10.5); // 저주파: 마른/젖은 무리 크기
  const grassTone = (dry, out) => {
    const r = rng();
    if (dry < 0.34) {
      // 싱싱한 초록 ~ 짙은 올리브
      out.setHSL(0.24 + rng() * 0.06, 0.34 + rng() * 0.22, 0.26 + rng() * 0.14);
    } else if (dry < 0.62) {
      // 황록 전이대
      out.setHSL(0.17 + rng() * 0.06, 0.4 + rng() * 0.18, 0.36 + rng() * 0.13);
    } else if (r < 0.78) {
      // 마른 밀짚/누런 풀
      out.setHSL(0.12 + rng() * 0.04, 0.38 + rng() * 0.2, 0.44 + rng() * 0.14);
    } else {
      // 고사한 갈색 풀
      out.setHSL(0.07 + rng() * 0.03, 0.32 + rng() * 0.14, 0.3 + rng() * 0.1);
    }
    return out;
  };

  const GRASS_N = 6400;
  const grassMesh = new THREE.InstancedMesh(
    grassGeo,
    new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.96 }),
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
    if (h < WATER_Y + 0.06) continue;
    const w = surfaceWeights(wx, wz, h);
    // 풀밭일수록 촘촘, 흙/모래에도 드문드문 잡초가 돋는다
    const grassW = (1 - w.sand * 0.85) * (1 - w.rock) * (1 - w.bed);
    const lush = (1 - w.dirt) * (1 - w.mud * 0.6);
    const chance = grassW * (0.18 + lush * lush * 0.82);
    if (rng() > chance) continue;
    gq.setFromAxisAngle(up, rng() * Math.PI * 2);
    // 키 변주: 대부분 짧고, 12%는 크게 웃자란 다발
    const tall = rng() < 0.12;
    const sy = tall ? 1.5 + rng() * 0.8 : 0.55 + rng() * 0.8;
    const sxz = 0.7 + rng() * 0.7;
    gs.set(sxz, sy, sxz);
    gv.set(wx, h - 0.03, wz);
    gm.compose(gv, gq, gs);
    grassMesh.setMatrixAt(placed, gm);
    // dryness: 저주파 패치 + 흙 근처일수록 마른톤 + 약간의 개체 변주
    const dry = THREE.MathUtils.clamp(
      patchNoise(wx + HALF, wz + HALF) * 1.15 + w.dirt * 0.4 + (rng() - 0.5) * 0.3 - 0.1, 0, 1);
    grassTone(dry, gCol);
    grassMesh.setColorAt(placed, gCol);
    placed++;
  }
  grassMesh.count = placed;
  grassMesh.instanceMatrix.needsUpdate = true;
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  noAO(grassMesh);
  scene.add(grassMesh); decorMeshes.push(grassMesh);

  // 들꽃: 풀밭에 노랑/흰 야생화 무리 — 십자 쿼드에 작은 꽃송이 텍스처
  const flowerCanvas = document.createElement('canvas');
  flowerCanvas.width = flowerCanvas.height = 48;
  {
    const ctx = flowerCanvas.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    // 가는 줄기 몇 개
    ctx.strokeStyle = 'rgba(120,160,90,0.9)';
    ctx.lineWidth = 1.4;
    const heads = [];
    for (let i = 0; i < 5; i++) {
      const bx = 10 + rng() * 28, top = 6 + rng() * 16;
      ctx.beginPath(); ctx.moveTo(bx, 48); ctx.lineTo(bx + (rng() - 0.5) * 6, top); ctx.stroke();
      heads.push([bx + (rng() - 0.5) * 6, top]);
    }
    for (const [hx, hy] of heads) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(hx, hy, 2.4 + rng() * 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  const flowerTex = new THREE.CanvasTexture(flowerCanvas);
  const flPos = [], flUv = [], flIdx = [];
  for (const rot of [0, Math.PI / 2]) {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const b = flPos.length / 3; const w = 0.5, hh = 0.5;
    flPos.push(-w / 2 * c, 0, -w / 2 * sn,  w / 2 * c, 0, w / 2 * sn,  w / 2 * c, hh, w / 2 * sn,  -w / 2 * c, hh, -w / 2 * sn);
    flUv.push(0, 0, 1, 0, 1, 1, 0, 1);
    flIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const flowerGeo = new THREE.BufferGeometry();
  flowerGeo.setAttribute('position', new THREE.Float32BufferAttribute(flPos, 3));
  flowerGeo.setAttribute('uv', new THREE.Float32BufferAttribute(flUv, 2));
  flowerGeo.setIndex(flIdx);
  flowerGeo.computeVertexNormals();
  const FLOWER_N = 520;
  const flowerMesh = new THREE.InstancedMesh(
    flowerGeo,
    new THREE.MeshStandardMaterial({ map: flowerTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }),
    FLOWER_N
  );
  placed = 0; guard = 0;
  const flowerCols = [0xf4d94a, 0xf6e58d, 0xffffff, 0xe8ecef, 0xe6b8d6];
  while (placed < FLOWER_N && guard++ < FLOWER_N * 20) {
    const wx = (rng() - 0.5) * (GRID * TILE - 2);
    const wz = (rng() - 0.5) * (GRID * TILE - 2);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.1) continue;
    const w = surfaceWeights(wx, wz, h);
    const grassW = (1 - w.dirt) * (1 - w.sand) * (1 - w.mud) * (1 - w.rock) * (1 - w.bed);
    if (rng() > grassW * grassW * 0.7) continue;
    gq.setFromAxisAngle(up, rng() * Math.PI);
    gs.setScalar(0.7 + rng() * 0.7);
    gv.set(wx, h - 0.02, wz);
    gm.compose(gv, gq, gs);
    flowerMesh.setMatrixAt(placed, gm);
    gCol.set(flowerCols[Math.floor(rng() * flowerCols.length)]);
    flowerMesh.setColorAt(placed, gCol);
    placed++;
  }
  flowerMesh.count = placed;
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  noAO(flowerMesh);
  scene.add(flowerMesh); decorMeshes.push(flowerMesh);

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

  // 낙엽 리터: 지면에 깔린 작은 평면 나뭇잎 — 흙/풀 위, 수목 근처 밀도↑
  const leafGeo = new THREE.PlaneGeometry(0.17, 0.13);
  const LEAF_N = 900;
  const leafMesh = new THREE.InstancedMesh(
    leafGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide }),
    LEAF_N
  );
  leafMesh.receiveShadow = true;
  const leafCols = [0x8a6a34, 0x9c7b3c, 0x74582c, 0xa98a44, 0x6f7a38];
  placed = 0; guard = 0;
  while (placed < LEAF_N && guard++ < LEAF_N * 12) {
    const wx = (rng() - 0.5) * (GRID * TILE - 1.4);
    const wz = (rng() - 0.5) * (GRID * TILE - 1.4);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.05) continue;
    const w = surfaceWeights(wx, wz, h);
    if (w.bed > 0.2 || w.rock > 0.5) continue;
    // 나무 밑에 잘 쌓이도록 숲 노이즈 가중
    const near = props.has(cellKey(worldToCell({ x: wx, z: wz }).gx, worldToCell({ x: wx, z: wz }).gz));
    if (rng() > 0.4 + (near ? 0.4 : 0)) continue;
    gq.setFromEuler(new THREE.Euler(-Math.PI / 2 + (rng() - 0.5) * 0.5, rng() * Math.PI, 0));
    gs.setScalar(0.7 + rng() * 0.9);
    gv.set(wx, h + 0.012, wz);
    gm.compose(gv, gq, gs);
    leafMesh.setMatrixAt(placed, gm);
    gCol.set(leafCols[Math.floor(rng() * leafCols.length)]);
    leafMesh.setColorAt(placed, gCol);
    placed++;
  }
  leafMesh.count = placed;
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  noAO(leafMesh);
  scene.add(leafMesh); decorMeshes.push(leafMesh);

  // 잔가지: 흙/풀 위에 흩어진 가는 나뭇가지
  const twigGeo = new THREE.CylinderGeometry(0.018, 0.026, 0.55, 5);
  twigGeo.rotateZ(Math.PI / 2); // 눕힌다
  const TWIG_N = 260;
  const twigMesh = new THREE.InstancedMesh(
    twigGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    TWIG_N
  );
  twigMesh.castShadow = true;
  twigMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < TWIG_N && guard++ < TWIG_N * 14) {
    const wx = (rng() - 0.5) * (GRID * TILE - 1.4);
    const wz = (rng() - 0.5) * (GRID * TILE - 1.4);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.06) continue;
    const w = surfaceWeights(wx, wz, h);
    if (w.bed > 0.1) continue;
    gq.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.2, rng() * Math.PI, (rng() - 0.5) * 0.2));
    gs.set(0.7 + rng() * 0.8, 1, 1);
    gv.set(wx, h + 0.02, wz);
    gm.compose(gv, gq, gs);
    twigMesh.setMatrixAt(placed, gm);
    gCol.setHSL(0.08 + rng() * 0.03, 0.32 + rng() * 0.14, 0.22 + rng() * 0.1);
    twigMesh.setColorAt(placed, gCol);
    placed++;
  }
  twigMesh.count = placed;
  twigMesh.instanceMatrix.needsUpdate = true;
  if (twigMesh.instanceColor) twigMesh.instanceColor.needsUpdate = true;
  scene.add(twigMesh); decorMeshes.push(twigMesh);

  // 물가 갈대: 얕은 물가 띠에 키 큰 갈대 다발 (레퍼런스 강가 리드)
  const reedTexCanvas = document.createElement('canvas');
  reedTexCanvas.width = reedTexCanvas.height = 64;
  {
    const ctx = reedTexCanvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    for (let i = 0; i < 7; i++) {
      const bx = 10 + rng() * 44, lean = (rng() - 0.5) * 10, w = 1.6 + rng() * 1.4;
      const grad = ctx.createLinearGradient(0, 64, 0, 2);
      grad.addColorStop(0, 'rgba(150,150,150,1)');
      grad.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.strokeStyle = grad; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, 64); ctx.lineTo(bx + lean, 3); ctx.stroke();
      // 이삭(cattail)
      if (rng() < 0.4) {
        ctx.fillStyle = 'rgba(200,200,200,1)';
        ctx.beginPath(); ctx.ellipse(bx + lean, 10, w * 0.9, 6, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  const reedTex = new THREE.CanvasTexture(reedTexCanvas);
  const rdPos = [], rdUv = [], rdIdx = [];
  for (const rot of [0, Math.PI / 2]) {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const b = rdPos.length / 3; const w = 0.5, hh = 1.4;
    rdPos.push(-w / 2 * c, 0, -w / 2 * sn,  w / 2 * c, 0, w / 2 * sn,  w / 2 * c, hh, w / 2 * sn,  -w / 2 * c, hh, -w / 2 * sn);
    rdUv.push(0, 0, 1, 0, 1, 1, 0, 1);
    rdIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const reedGeo = new THREE.BufferGeometry();
  reedGeo.setAttribute('position', new THREE.Float32BufferAttribute(rdPos, 3));
  reedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rdUv, 2));
  reedGeo.setIndex(rdIdx);
  reedGeo.computeVertexNormals();
  const REED_N = 700;
  const reedMesh = new THREE.InstancedMesh(
    reedGeo,
    new THREE.MeshStandardMaterial({ map: reedTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.94 }),
    REED_N
  );
  reedMesh.receiveShadow = true;
  const reedCols = [0x5a7a3a, 0x6b8540, 0x4e6a30, 0x8a8a44];
  placed = 0; guard = 0;
  while (placed < REED_N && guard++ < REED_N * 14) {
    const wx = (rng() - 0.5) * (GRID * TILE - 1.2);
    const wz = (rng() - 0.5) * (GRID * TILE - 1.2);
    const h = sampleHeight(wx, wz);
    const depth = WATER_Y - h;
    // 물가 띠: 살짝 잠긴 곳~물가 위 15cm, 바위 지대 제외
    if (depth > 0.16 || depth < -0.16) continue;
    const w = surfaceWeights(wx, wz, h);
    if (w.rock > 0.4) continue;
    gq.setFromAxisAngle(up, rng() * Math.PI * 2);
    const sy = 0.7 + rng() * 0.9, sxz = 0.7 + rng() * 0.6;
    gs.set(sxz, sy, sxz);
    gv.set(wx, Math.max(h, WATER_Y - 0.02), wz);
    gm.compose(gv, gq, gs);
    reedMesh.setMatrixAt(placed, gm);
    gCol.set(reedCols[Math.floor(rng() * reedCols.length)]);
    reedMesh.setColorAt(placed, gCol);
    placed++;
  }
  reedMesh.count = placed;
  reedMesh.instanceMatrix.needsUpdate = true;
  if (reedMesh.instanceColor) reedMesh.instanceColor.needsUpdate = true;
  noAO(reedMesh);
  scene.add(reedMesh); decorMeshes.push(reedMesh);

  // 이끼: 바위/급경사 지대에 낮게 깔린 초록 이끼 패치
  const MOSS_N = 380;
  const mossMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.98 }),
    MOSS_N
  );
  mossMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < MOSS_N && guard++ < MOSS_N * 22) {
    const wx = (rng() - 0.5) * (GRID * TILE - 1.4);
    const wz = (rng() - 0.5) * (GRID * TILE - 1.4);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.05) continue;
    const w = surfaceWeights(wx, wz, h);
    if (w.rock < 0.28 || rng() > w.rock * 1.1) continue;
    gq.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * Math.PI, rng() * 0.4));
    gs.set(1 + rng() * 1.4, 0.3 + rng() * 0.3, 1 + rng() * 1.4);
    gv.set(wx, h + 0.04, wz);
    gm.compose(gv, gq, gs);
    mossMesh.setMatrixAt(placed, gm);
    gCol.setHSL(0.26 + rng() * 0.06, 0.4 + rng() * 0.18, 0.24 + rng() * 0.1);
    mossMesh.setColorAt(placed, gCol);
    placed++;
  }
  mossMesh.count = placed;
  mossMesh.instanceMatrix.needsUpdate = true;
  if (mossMesh.instanceColor) mossMesh.instanceColor.needsUpdate = true;
  noAO(mossMesh);
  scene.add(mossMesh); decorMeshes.push(mossMesh);
}

// ---------------------------------------------------------------------------
// 다리: 깊은 강 구간을 가로지르는 목교 — 유일한 안전 횡단로지만
// 포격 2~3발이면 무너진다 (내구도 100)
// ---------------------------------------------------------------------------
const bridge = { cells: new Set(), gz: -1, deckY: WATER_Y + 0.5, hp: 100, maxHp: 100, alive: false, group: null, hit: null };
{
  // 여울에서 먼(=깊은) 강 구간을 고른다
  let bestGz = -1, bestFord = Infinity;
  for (let gz = 10; gz <= GRID - 10; gz++) {
    const ford = smooth01((Math.sin((gz + 0.5) * 0.275 + riverPhase * 2.3) - 0.38) / 0.3);
    if (ford < bestFord) { bestFord = ford; bestGz = gz; }
  }
  if (bestGz >= 0) {
    // 강 중심에서 좌우로 물이 끝날 때까지 + 양쪽 강둑 1칸
    const center = cellToWorld(0, bestGz);
    const rxGrid = riverCx + Math.sin((bestGz + 0.5) * 0.21 + riverPhase) * riverAmp;
    const cgx = Math.round(rxGrid - 0.5);
    let g0 = cgx, g1 = cgx;
    const isWet = (gx) => inBounds(gx, bestGz) && WATER_Y - heightAt(gx, bestGz) > 0.0;
    while (g0 > 1 && isWet(g0 - 1) && cgx - g0 < 6) g0--;
    while (g1 < GRID - 2 && isWet(g1 + 1) && g1 - cgx < 6) g1++;
    g0 = Math.max(0, g0 - 1);
    g1 = Math.min(GRID - 1, g1 + 1);
    for (let gx = g0; gx <= g1; gx++) bridge.cells.add(cellKey(gx, bestGz));
    bridge.gz = bestGz;
    bridge.minGx = g0;
    bridge.maxGx = g1;
    bridge.alive = true;

    // 목교 메시: 상판 널빤지 + 난간 + 물속 기둥
    const g = new THREE.Group();
    const w0 = cellToWorld(g0, bestGz).x - 0.5;
    const w1 = cellToWorld(g1, bestGz).x + 0.5;
    const len = w1 - w0;
    const cx = (w0 + w1) / 2;
    const cz = center.z;
    const deck = bridge.deckY;
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x6f5334, roughness: 0.9 });
    const plankN = Math.round(len / 0.55);
    for (let i = 0; i < plankN; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(len / plankN - 0.06, 0.12, 2.6), i % 2 ? wood : woodDark);
      p.position.set(w0 + (i + 0.5) * (len / plankN), deck, cz);
      p.rotation.y = (Math.sin(i * 3.7) - 0.5) * 0.03;
      p.castShadow = true;
      p.receiveShadow = true;
      g.add(p);
    }
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1), woodDark);
      rail.position.set(cx, deck + 0.55, cz + side * 1.25);
      rail.castShadow = true;
      g.add(rail);
      for (let i = 0; i <= 4; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.12), wood);
        post.position.set(w0 + (i / 4) * len, deck + 0.28, cz + side * 1.25);
        g.add(post);
      }
      // 물속 교각
      for (let i = 1; i <= 3; i++) {
        const px = w0 + (i / 4) * len;
        const bottom = Math.min(sampleHeight(px, cz), WATER_Y);
        const h = deck - bottom + 0.1;
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, h, 8), woodDark);
        pile.position.set(px, bottom + h / 2, cz + side * 0.9);
        pile.castShadow = true;
        g.add(pile);
      }
    }
    // 클릭 판정용 히트박스
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(len, 1.2, 2.8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(cx, deck + 0.4, cz);
    g.add(hit);
    mergeStatic(g, [hit]); // 드로콜 절감
    bridge.hit = hit;
    bridge.group = g;
    bridge.worldZ = cz;
    bridge.worldX0 = w0;
    bridge.worldX1 = w1;
    scene.add(g);
  }
}
const onBridge = (gx, gz) => bridge.alive && bridge.cells.has(cellKey(gx, gz));
// 다리 붕괴: 파편 + 위에 있던 차량은 강에 추락
function damageBridge(dmg, impactPos) {
  if (!bridge.alive) return;
  bridge.hp -= dmg;
  const p = impactPos ?? new THREE.Vector3((bridge.worldX0 + bridge.worldX1) / 2, bridge.deckY, bridge.worldZ);
  popText(p, `다리 ${Math.max(0, Math.round(bridge.hp))}/${bridge.maxHp}`, '#e8c37a');
  if (bridge.hp > 0) {
    const g = bridge.group;
    tween(220, (e, k) => { g.position.y = Math.sin(k * 26) * 0.05 * (1 - k); }, linear);
    return;
  }
  bridge.alive = false;
  sfx('explode');
  breakApartGroup(bridge.group, 6);
  for (const u of units) {
    if (!u.alive || !bridge.cells.has(cellKey(u.gx, u.gz))) continue;
    popText(u.group.position, '추락!', '#ff8a5e');
    applyUnitDamage(u, 40);
    const y = sampleHeight(u.group.position.x, u.group.position.z);
    tween(500, (e) => { u.group.position.y = THREE.MathUtils.lerp(u.group.position.y, y, e); }, easeOut);
  }
}
// 차량 주행 높이: 다리 위에서는 상판 높이
function driveHeight(x, z) {
  if (bridge.alive && Math.abs(z - bridge.worldZ) < 1.3 && x > bridge.worldX0 - 0.4 && x < bridge.worldX1 + 0.4) {
    return Math.max(bridge.deckY, sampleHeight(x, z));
  }
  return sampleHeight(x, z);
}

// ---------------------------------------------------------------------------
// 헐다운 스팟: 능선 마루 칸 — 여기 서면 차체가 지형에 가려져 피격 확률 감소.
// 금색 링으로 표시되어 "저기 서면 유리하다"가 한눈에 보인다
// ---------------------------------------------------------------------------
const hullDownCells = new Set();
{
  const candidates = [];
  for (let gx = 2; gx < GRID - 2; gx++) {
    for (let gz = 2; gz < GRID - 2; gz++) {
      if (terrainAt(gx, gz) === T.WATER) continue;
      if (props.has(cellKey(gx, gz))) continue;
      const h = heightAt(gx, gz);
      // 어느 방향으로든 2칸 앞이 0.7 이상 낮으면 능선 마루
      let drop = 0;
      for (const d of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        if (!inBounds(gx + d[0], gz + d[1])) continue;
        drop = Math.max(drop, h - heightAt(gx + d[0], gz + d[1]));
      }
      // 주변 1칸보다 크게 높지 않아야(꼭대기 노출 아님) 마루 느낌
      let localRise = 0;
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        localRise = Math.max(localRise, h - heightAt(gx + d[0], gz + d[1]));
      }
      if (drop >= 0.72 && localRise <= 0.5) candidates.push({ gx, gz, drop });
    }
  }
  candidates.sort((a, b) => b.drop - a.drop);
  for (const c of candidates) {
    if (hullDownCells.size >= 10) break;
    let clash = false;
    for (const k of hullDownCells) {
      const [x, z] = k.split(',').map(Number);
      if (Math.max(Math.abs(x - c.gx), Math.abs(z - c.gz)) < 4) { clash = true; break; }
    }
    if (!clash) hullDownCells.add(cellKey(c.gx, c.gz));
  }
  // 금색 링 마커
  const ringGeo = new THREE.RingGeometry(0.55, 0.78, 26);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf0b23e, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
  for (const k of hullDownCells) {
    const [gx, gz] = k.split(',').map(Number);
    const p = cellToWorld(gx, gz);
    const m = new THREE.Mesh(ringGeo, ringMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, heightAt(gx, gz) + 0.07, p.z);
    scene.add(m);
  }
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
  const kitKey = isPlayer ? playerKit : enemyKit;
  const model = buildKitTank(kitKey);
  const hullLv = isPlayer ? PLAYER_STATS.hullLv : 1 + Math.floor(rng() * 3);
  const driverLv = isPlayer ? PLAYER_STATS.driverLv : 1 + Math.floor(rng() * 3);
  const base = isPlayer ? PLAYER_STATS : ENEMY_BASE;
  const maxHp = (isPlayer ? 110 : 60) + hullLv * 15;
  const unit = {
    isPlayer, gx, gz, kitKey,
    gun: KIT_INFO[kitKey].gun,
    reloadLeft: 0,
    movedLastTurn: false,
    aimStack: 0,
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
// 적은 모두 같은 차체 — 시드로 하나 선택
const enemyKit = enemyKits[Math.floor(rng() * enemyKits.length)];
const player = spawnUnit(true, PLAYER_SPAWN.gx, PLAYER_SPAWN.gz, Math.PI);
const enemies = ENEMY_SPAWNS.map((s) => spawnUnit(false, s.gx, s.gz, 0));

// 탱크가 2×2타일 크기이므로 다른 유닛과 체비쇼프 1칸 이내로 접근 불가
const isOccupied = (gx, gz, except = null) =>
  units.some((u) => u.alive && u !== except &&
    Math.max(Math.abs(u.gx - gx), Math.abs(u.gz - gz)) <= 1);

// ---------------------------------------------------------------------------
// 이동: 방향 상태 다익스트라 (지형비용 + 경사 + 선회비용 = 궤도 기동)
// ---------------------------------------------------------------------------
// 8방향 이동 (대각 포함) — 45° 단위 회전량에 비례한 선회 비용.
// 현재 차체가 향한 쪽은 회전이 적어 더 멀리 간다 (비대칭 이동 필드)
const DIRS = [
  { dx: 0, dz: 1 }, { dx: 1, dz: 1 }, { dx: 1, dz: 0 }, { dx: 1, dz: -1 },
  { dx: 0, dz: -1 }, { dx: -1, dz: -1 }, { dx: -1, dz: 0 }, { dx: -1, dz: 1 },
];
const DIR_LEN = DIRS.map((d) => Math.hypot(d.dx, d.dz));
// 비용 모델: 전진/후진 스텝 = 1(평지 기준), 회전은 90°당 +1.5(=45°당 0.75).
// 차체 축 방향(전·후진)으로는 멀리, 옆으로 틀려면 회전값을 크게 치른다.
const TURN_COST45 = 0.75; // 45° 선회당

function facingDir(unit) {
  // rotation.y 기준 가장 가까운 8방향
  const a = unit.group.rotation.y;
  const v = { dx: Math.sin(a), dz: Math.cos(a) };
  let best = 0, bd = -Infinity;
  DIRS.forEach((d, i) => {
    const l = DIR_LEN[i];
    const dot = (d.dx * v.dx + d.dz * v.dz) / l;
    if (dot > bd) { bd = dot; best = i; }
  });
  return best;
}

function stepCost(fromX, fromZ, toX, toZ, mover = null) {
  if (!inBounds(toX, toZ)) return Infinity;
  const dh = standHeight(toX, toZ) - standHeight(fromX, fromZ);
  if (Math.abs(dh) > MAX_CLIMB) return Infinity; // 궤도로 못 오르는 단차 (다리 상판 포함)
  const prop = props.get(cellKey(toX, toZ));
  if (prop && prop.def.blockMove) return Infinity;
  if (isOccupied(toX, toZ, mover)) return Infinity;
  // 다리 위는 통행 가능 (붕괴 전까지)
  if (onBridge(toX, toZ)) {
    const dhB = standHeight(toX, toZ) - standHeight(fromX, fromZ);
    if (Math.abs(dhB) > MAX_CLIMB) return Infinity;
    return 1.2;
  }
  // 깊은 물은 도하 불가 — 여울(얕은 구간) 또는 다리로만 강을 건널 수 있다
  if (terrainAt(toX, toZ) === T.WATER && WATER_Y - heightAt(toX, toZ) > FORD_DEPTH) return Infinity;
  const stepLen = Math.hypot(toX - fromX, toZ - fromZ); // 대각선 √2
  let c = TERRAIN_COST[terrainAt(toX, toZ)] * stepLen;
  if (prop && prop.def.moveExtra) c += prop.def.moveExtra;
  if (dh > 0) c += dh * 1.6;       // 오르막: 단차 비례
  else if (dh < 0) c += -dh * 0.3; // 내리막: 소폭
  return c;
}

// 반환: Map(cellKey -> { cost, path[{gx,gz,rev}], endDir(차체 방향), turned })
// 상태는 (셀, 차체 방향) — 각 스텝마다 전진(차체=진행 방향) 또는
// 후진(차체는 반대를 유지, 속도 페널티 ×1.3)을 선택할 수 있어
// 목표 각도를 유지한 채 뒤로 빠지는 경로가 나온다.
// turned: 차체 회전 없이(전/후진만으로) 도달했는지 여부 — 필드 2톤 표시용.
const REVERSE_COST = 1.0; // 후진도 전진과 동일 비용 (차체 축 대칭 이동)
function reachableCells(unit) {
  const startDir = facingDir(unit);
  const best = new Map(); // "x,z,hull" -> cost
  const prev = new Map(); // key -> { from, rev }
  const pq = [{ gx: unit.gx, gz: unit.gz, hull: startDir, cost: 0 }];
  best.set(`${unit.gx},${unit.gz},${startDir}`, 0);
  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i].cost < pq[bi].cost) bi = i;
    const cur = pq.splice(bi, 1)[0];
    const curKey = `${cur.gx},${cur.gz},${cur.hull}`;
    if (cur.cost > (best.get(curKey) ?? Infinity)) continue;
    for (let d = 0; d < 8; d++) {
      const nx = cur.gx + DIRS[d].dx, nz = cur.gz + DIRS[d].dz;
      const sc = stepCost(cur.gx, cur.gz, nx, nz, unit);
      if (!isFinite(sc)) continue;
      for (const rev of [false, true]) {
        const hull = rev ? (d + 4) % 8 : d;
        const turn = Math.min(Math.abs(hull - cur.hull), 8 - Math.abs(hull - cur.hull)) * TURN_COST45;
        const nc = cur.cost + turn + sc * (rev ? REVERSE_COST : 1);
        if (nc > unit.mp) continue;
        const nk = `${nx},${nz},${hull}`;
        if (nc < (best.get(nk) ?? Infinity)) {
          best.set(nk, nc);
          prev.set(nk, { from: curKey, rev });
          pq.push({ gx: nx, gz: nz, hull, cost: nc });
        }
      }
    }
  }
  const result = new Map();
  for (const [k, cost] of best) {
    const [x, z, hull] = k.split(',').map(Number);
    const ck = cellKey(x, z);
    if (x === unit.gx && z === unit.gz) continue;
    if (!result.has(ck) || cost < result.get(ck).cost) {
      // 경로 역추적 — 각 셀에 진입 기어(rev)와 회전 여부를 함께 담는다
      const path = [];
      let turned = false;
      let cur = k;
      while (cur) {
        const [px, pz, ph] = cur.split(',').map(Number);
        if (ph !== startDir) turned = true;
        const pv = prev.get(cur);
        path.unshift({ gx: px, gz: pz, rev: pv ? pv.rev : false });
        cur = pv ? pv.from : null;
      }
      path.shift(); // 시작 셀 제외
      result.set(ck, { cost, path, endDir: hull, turned });
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
    return new THREE.Vector3(u.group.position.x, standHeight(u.gx, u.gz) + 1.4, u.group.position.z);
  }
  if (target.prop) {
    const pr = target.prop;
    const p = cellToWorld(pr.gx, pr.gz);
    return new THREE.Vector3(p.x, heightAt(pr.gx, pr.gz) + 0.7, p.z);
  }
  const p = cellToWorld(target.gx, target.gz);
  if (onBridge(target.gx, target.gz)) return new THREE.Vector3(p.x, bridge.deckY + 0.3, p.z);
  return new THREE.Vector3(p.x, Math.max(heightAt(target.gx, target.gz), WATER_Y) + 0.5, p.z);
}

// 직사 탄도 추적: 부앙각 한계로 클램프한 직선 레이를 전진시키며
// 지형/프랍/유닛/다리와 충돌 체크. 반환 { x,y,z, unit?, prop?, cover, reached }
function traceDirect(attacker, from, aim, opts = {}) {
  const dx = aim.x - from.x, dz = aim.z - from.z;
  const horiz = Math.max(0.001, Math.hypot(dx, dz));
  const dirx = dx / horiz, dirz = dz / horiz;
  const pMin = THREE.MathUtils.degToRad(attacker.gun?.pitchMin ?? PITCH_MIN);
  const pMax = THREE.MathUtils.degToRad(attacker.gun?.pitchMax ?? PITCH_MAX);
  const slope = Math.tan(THREE.MathUtils.clamp(Math.atan2(aim.y - from.y, horiz), pMin, pMax));
  const maxT = opts.throughAim ? attacker.fireRange * TILE * 1.1 : horiz;
  const step = 0.35;
  const coverCells = new Map();
  const skipUnit = opts.skipTargetUnit ?? null;
  let x = from.x, y = from.y, z = from.z;
  for (let t = step; t <= maxT + 1e-6; t += step) {
    x = from.x + dirx * t;
    z = from.z + dirz * t;
    y = from.y + slope * t;
    if (Math.abs(x) > HALF + 1 || Math.abs(z) > HALF + 1) break; // 맵 밖
    const nearAim = !opts.throughAim && t > horiz - 0.8;
    // 유닛 충돌 (사수 제외; 계획 단계에서는 목표 유닛도 제외)
    for (const u of units) {
      if (!u.alive || u === attacker || u === skipUnit) continue;
      const uy = u.group.position.y;
      if (Math.hypot(u.group.position.x - x, u.group.position.z - z) < 1.05 && y > uy - 0.2 && y < uy + 2.3) {
        return { x, y, z, unit: u, cover: 0, reached: false };
      }
    }
    // 다리 상판
    if (bridge.alive && Math.abs(z - bridge.worldZ) < 1.3 && x > bridge.worldX0 - 0.4 && x < bridge.worldX1 + 0.4 &&
        y > bridge.deckY - 0.35 && y < bridge.deckY + 0.15) {
      return { x, y, z, bridgeHit: true, cover: 0, reached: false };
    }
    const c = worldToCell({ x, z });
    const prop = props.get(cellKey(c.gx, c.gz));
    if (prop) {
      const gH = heightAt(c.gx, c.gz);
      if (prop.def.blockShotH > 0 && y < gH + prop.def.blockShotH && !nearAim) {
        return { x, y, z, prop, cover: 0, reached: false };
      }
      if (prop.def.coverH > 0 && y < gH + prop.def.coverH) coverCells.set(cellKey(c.gx, c.gz), prop.def.cover);
    }
    // 지형/수면 충돌 (조준점 코앞은 착탄으로 간주)
    if (y <= Math.max(sampleHeight(x, z), WATER_Y) + 0.03) {
      return { x, y: Math.max(sampleHeight(x, z), WATER_Y), z, ground: true, cover: 0, reached: nearAim };
    }
  }
  let cover = 0;
  for (const v of coverCells.values()) cover += v;
  return { x, y, z, cover: Math.min(2, cover), reached: !opts.throughAim, ground: opts.throughAim };
}

// 반환 { ok, reason, chance, distCells, pitch, cover }
function computeShot(attacker, target, fromCell = null, facingOverride = null, lob = false) {
  const from = muzzleApprox(attacker, fromCell);
  const aim = aimPointOf(target);
  const dx = aim.x - from.x, dz = aim.z - from.z;
  const horiz = Math.hypot(dx, dz);
  const distCells = horiz / TILE;
  if (distCells > attacker.fireRange) return { ok: false, reason: `사거리 밖 (${distCells.toFixed(1)}/${attacker.fireRange}칸)` };
  if (distCells < 1.2) return { ok: false, reason: '너무 가까움' };
  if (lob && distCells < 4) return { ok: false, reason: '곡사 최소 사거리(4칸) 미만' };

  // 포신 부앙각 — 한계로 클램프해서 실제 탄도로 추적 (곡사는 포물선이라 무관)
  const pMin = attacker.gun?.pitchMin ?? PITCH_MIN;
  const pMax = attacker.gun?.pitchMax ?? PITCH_MAX;
  const pitch = THREE.MathUtils.clamp((Math.atan2(aim.y - from.y, horiz) * 180) / Math.PI, pMin, pMax);

  // 고정 포신: 사각(arc) 검사. 스폰슨 부포(Mark IV)는 좌/우 측면(±90°) 중심,
  // 일반 고정포는 정면 중심. 가상 위치 평가(fromCell)는 이동으로 선회한다고 보고 스킵.
  if (attacker.gun?.fixed && (!fromCell || facingOverride !== null)) {
    const baseYaw = facingOverride !== null ? facingOverride : attacker.group.rotation.y;
    const relDeg = Math.abs(THREE.MathUtils.radToDeg(
      normAngle(Math.atan2(dx, dz) - baseYaw)
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

  // 직사: 실제 탄도(클램프된 부앙각의 직선)를 추적 — 뭔가에 걸리면 그 지점이 착탄.
  // 조준 셀에 도달하지 못하면 직사 불가 (차폐물 셀을 보고해 곡사/굴착 판단에 사용)
  let cover = 0;
  if (!lob) {
    const tr = traceDirect(attacker, from, aim, { skipTargetUnit: target.unit ?? null });
    if (tr.unit) return { ok: false, reason: '아군/적 차량에 사선이 막힘', blockCell: { gx: tr.unit.gx, gz: tr.unit.gz } };
    if (tr.prop) return { ok: false, reason: `${tr.prop.def.name}에 사선이 막힘`, blockCell: { gx: tr.prop.gx, gz: tr.prop.gz } };
    if (tr.bridgeHit) return { ok: false, reason: '다리에 사선이 막힘', blockCell: worldToCell({ x: tr.x, z: tr.z }) };
    if (tr.ground && !tr.reached) {
      return { ok: false, reason: '지형(능선)에 사선이 막힘', blockCell: worldToCell({ x: tr.x, z: tr.z }) };
    }
    // 탄도가 조준점 위/아래로 크게 벗어나면 부앙각 한계로 조준 불가
    if (tr.reached && !tr.ground && Math.abs(tr.y - aim.y) > 1.3) {
      return { ok: false, reason: '포신 각도 한계로 조준 불가 (곡사 필요)' };
    }
    cover = tr.cover;
  }

  // 명중률
  let chance;
  if (target.unit) {
    const heightAdv = THREE.MathUtils.clamp((from.y - aim.y) * 6, -10, 12);
    // 거리 편차: 4칸까지 최고 명중, 이후 칸당 3% + 원거리 가속 페널티 (1칸=1유닛)
    const distPen = Math.max(0, distCells - 4) * 3 + Math.max(0, distCells - 12) * 1.25;
    chance = 96 - distPen - cover * 14 - target.unit.driverLv * 6 + heightAdv;
    // 정지 사격 보너스: 직전 턴 정지 +12 / 기동 사격 -8 (halt fire)
    chance += attacker.movedLastTurn ? -8 : 12;
    // 조준 스택: 허탕 경계로 쌓은 조준 보너스
    if (attacker.aimStack) chance += 15;
    // 헐다운: 능선 마루의 목표는 차체가 가려진다 — 단 곡사는 위에서 떨어져 무효
    if (!lob && hullDownCells.has(cellKey(target.unit.gx, target.unit.gz))) chance -= 16;
    if (lob) chance -= 12; // 곡사 페널티
    chance = THREE.MathUtils.clamp(Math.round(chance), 8, 97);
  } else {
    chance = THREE.MathUtils.clamp(Math.round(90 - distCells * 2.25 - cover * 10 - (lob ? 12 : 0)), 20, 95);
  }
  return { ok: true, chance, distCells, pitch, cover, lob };
}

// 사격 가능한 모든 셀 스캔: 사거리·부앙각·사선(LoS)이 유효한 셀만 반환.
// 셀에 유닛/프랍이 있으면 그것을 조준한 판정, 빈 칸이면 지면 판정.
function computeFireCells(unit, fromCell = null, facing = null) {
  const out = new Map();
  const cx = fromCell ? fromCell.gx : unit.gx;
  const cz = fromCell ? fromCell.gz : unit.gz;
  const R = Math.ceil(unit.fireRange);
  for (let gx = cx - R; gx <= cx + R; gx++) {
    for (let gz = cz - R; gz <= cz + R; gz++) {
      if (!inBounds(gx, gz)) continue;
      if (gx === cx && gz === cz) continue;
      const occ = units.find((t) => t.alive && t !== unit && t.gx === gx && t.gz === gz);
      const prop = props.get(cellKey(gx, gz));
      const target = occ ? { unit: occ } : prop ? { prop } : { gx, gz };
      let shot = computeShot(unit, target, fromCell, facing);
      if (!shot.ok) shot = computeShot(unit, target, fromCell, facing, true); // 곡사 재시도
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
// 차체 선회 각속도 (rad/s) — 전차답게 느릿하게
const DRIVE_TURN_RATE = 2.4; // 주행 중 방향 전환
const PIVOT_RATE = 1.5;      // 제자리 선회 (조준 폴백용)
async function rotateTo(unit, targetRot, rate = DRIVE_TURN_RATE) {
  const from = unit.group.rotation.y;
  let diff = targetRot - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) < 0.01) return;
  await tween((Math.abs(diff) / rate) * 1000, (e) => { unit.group.rotation.y = from + diff * e; });
}
// 차체가 지면 경사를 따라 기울어지는 각도
function groundPitch(unit) {
  const ry = unit.group.rotation.y;
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const p = unit.group.position;
  const hF = driveHeight(p.x + fx * 0.8, p.z + fz * 0.8);
  const hB = driveHeight(p.x - fx * 0.8, p.z - fz * 0.8);
  return THREE.MathUtils.clamp(Math.atan2(hB - hF, 1.6), -0.45, 0.45);
}

async function moveUnit(unit, path, finalFacing = null, onStep = null) {
  // 구간별 전/후진: 경로 셀에 기어(rev)가 담겨 있으면 그대로 따른다 —
  // 등 뒤 구간은 차체를 돌리지 않고 후진해 목표 각도를 최대한 유지.
  // 기어 정보 없는 합성 경로는 기존 휴리스틱(가깝고 등 뒤면 통째로 후진).
  const hasGear = path.length > 0 && typeof path[0].rev === 'boolean';
  let fallbackRev = false;
  if (!hasGear && path.length) {
    const first = cellToWorld(path[0].gx, path[0].gz);
    const headTo = Math.atan2(first.x - unit.group.position.x, first.z - unit.group.position.z);
    const turnNeed = Math.abs(normAngle(headTo - unit.group.rotation.y));
    fallbackRev = path.length <= 5 && turnNeed > Math.PI * 0.6;
  }
  for (const cell of path) {
    if (!unit.alive) return; // 이동 중 경계 사격에 격파되면 그 자리에서 정지
    const reverse = hasGear ? cell.rev : fallbackRev;
    const from = unit.group.position.clone();
    const to = cellToWorld(cell.gx, cell.gz);
    const travel = Math.atan2(to.x - from.x, to.z - from.z);
    // 후진이면 차체 전면은 진행 반대 방향을 유지
    await rotateTo(unit, reverse ? travel + Math.PI : travel, DRIVE_TURN_RATE);
    sfx(terrainAt(cell.gx, cell.gz) === T.WATER ? 'splash' : 'step');
    unit._trailLast ??= { x: from.x, z: from.z };
    await tween(reverse ? 145 : 105, (e) => {
      const x = THREE.MathUtils.lerp(from.x, to.x, e);
      const z = THREE.MathUtils.lerp(from.z, to.z, e);
      unit.group.position.set(x, driveHeight(x, z) + Math.sin(e * Math.PI) * 0.08, z);
      unit.group.rotation.x = groundPitch(unit);
      // 궤도 자국 샘플링 (0.5유닛 간격)
      const tl = unit._trailLast;
      if (Math.hypot(x - tl.x, z - tl.z) > 0.5) {
        addTrackRibbon(unit, tl.x, tl.z, x, z);
        tl.x = x;
        tl.z = z;
      }
    });
    unit.gx = cell.gx;
    unit.gz = cell.gz;
    unit.group.position.y = driveHeight(to.x, to.z);
    if (onStep) onStep(unit);
  }
  // 이동이 끝나면 차체는 마지막 진행 방향 그대로 — 추가 제자리 선회 없음
  unit.group.rotation.x = groundPitch(unit);
  if (hullDownCells.has(cellKey(unit.gx, unit.gz))) {
    popText(unit.group.position, '🛡 헐다운', '#ffd76e');
  }
}

// ---------------------------------------------------------------------------
// 이펙트: 파편 / 폭발 / 크레이터 / 분해
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 궤도 자국: 지나간 자리에 부드럽게 이어지는 리본 데칼 (좌우 궤도 2줄, 링버퍼)
// ---------------------------------------------------------------------------
const TRAIL_SEG = 1100;
const trailPosArr = new Float32Array(TRAIL_SEG * 12 * 3);
const trailGeoBuf = new THREE.BufferGeometry();
trailGeoBuf.setAttribute('position', new THREE.BufferAttribute(trailPosArr, 3));
const trailMesh = new THREE.Mesh(
  trailGeoBuf,
  new THREE.MeshBasicMaterial({
    color: 0x35291c, transparent: true, opacity: 0.42, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  })
);
trailMesh.frustumCulled = false;
trailMesh.renderOrder = 1;
noAO(trailMesh);
scene.add(trailMesh);
let trailIdx = 0;
const trailY = (x, z) => Math.max(sampleHeight(x, z), WATER_Y) + 0.035;
function addTrackRibbon(unit, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.02) return;
  const nx = -dz / len, nz = dx / len;
  const HW = 0.17;  // 리본 반폭
  const OFF = 0.55; // 차체 중심 → 궤도 중심
  let vi = trailIdx * 36;
  unit._trailEdge ??= [null, null];
  for (const side of [-1, 1]) {
    const si = side < 0 ? 0 : 1;
    const cx1 = x1 + nx * side * OFF, cz1 = z1 + nz * side * OFF;
    const prev = unit._trailEdge[si];
    // 이전 세그먼트의 끝 에지를 이어받아 리본이 매끄럽게 연결된다
    const ax0 = prev ? prev[0] : x0 + nx * (side * OFF - HW);
    const az0 = prev ? prev[1] : z0 + nz * (side * OFF - HW);
    const bx0 = prev ? prev[2] : x0 + nx * (side * OFF + HW);
    const bz0 = prev ? prev[3] : z0 + nz * (side * OFF + HW);
    const ax1 = cx1 - nx * HW, az1 = cz1 - nz * HW;
    const bx1 = cx1 + nx * HW, bz1 = cz1 + nz * HW;
    const ya0 = trailY(ax0, az0), yb0 = trailY(bx0, bz0);
    const ya1 = trailY(ax1, az1), yb1 = trailY(bx1, bz1);
    trailPosArr.set([
      ax0, ya0, az0, bx0, yb0, bz0, ax1, ya1, az1,
      bx0, yb0, bz0, bx1, yb1, bz1, ax1, ya1, az1,
    ], vi);
    vi += 18;
    unit._trailEdge[si] = [ax1, az1, bx1, bz1];
  }
  trailGeoBuf.attributes.position.needsUpdate = true;
  trailIdx = (trailIdx + 1) % TRAIL_SEG;
}

// ---------------------------------------------------------------------------
// 시대별 실포탄 (SD 과장 스케일): 차체별 실제 사용 탄종의 실루엣
//  ft: 37mm Puteaux — 짧고 뭉툭한 유탄
//  mk4: 6파운더(57mm) — 둥근 코의 강철 포탄
//  t34: 76.2mm BR-350 — 뾰족 오자이브 + 검은 탄두
//  tiger: 88mm PzGr.39 — 길쭉한 철갑탄 + 흰 탄도캡
// ---------------------------------------------------------------------------
const SHELL_SPECS = {
  ft:    { len: 0.55, rad: 0.115, body: 0x565c66, tip: 0x565c66, blunt: 0.55 },
  mk4:   { len: 0.72, rad: 0.13,  body: 0x4c545e, tip: 0x4c545e, blunt: 0.34 },
  t34:   { len: 0.88, rad: 0.15,  body: 0x46523f, tip: 0x1d2126, blunt: 0.16 },
  tiger: { len: 1.05, rad: 0.16,  body: 0x2e333b, tip: 0xdde2e8, blunt: 0.09 },
};
const shellBandMat = new THREE.MeshStandardMaterial({ color: 0xb08850, roughness: 0.35, metalness: 0.7 });
const shellCache = new Map();
function makeShell(kitKey) {
  const key = SHELL_SPECS[kitKey] ? kitKey : 't34';
  if (!shellCache.has(key)) {
    const sp = SHELL_SPECS[key];
    const g = new THREE.Group();
    // 탄체: 원통 하부 + 오자이브(곡선 코) 회전체 — 코가 +Z를 향하게
    const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(sp.rad, 0), new THREE.Vector2(sp.rad, sp.len * 0.5)];
    const tipStart = sp.len * 0.5;
    for (let i = 1; i <= 5; i++) {
      const t = i / 5;
      const e = 1 - (1 - t) * (1 - t); // 오자이브 곡률
      pts.push(new THREE.Vector2(THREE.MathUtils.lerp(sp.rad, sp.rad * sp.blunt, e), tipStart + (sp.len - tipStart) * t));
    }
    pts.push(new THREE.Vector2(0.001, sp.len));
    const bodyGeo = new THREE.LatheGeometry(pts, 18);
    bodyGeo.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: sp.body, roughness: 0.45, metalness: 0.55 }));
    g.add(body);
    // 탄두 (t34 검정 / tiger 흰 탄도캡)
    if (sp.tip !== sp.body) {
      const capGeo = new THREE.ConeGeometry(sp.rad * 0.62, sp.len * 0.3, 14);
      capGeo.rotateX(Math.PI / 2);
      const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: sp.tip, roughness: 0.5, metalness: 0.3 }));
      cap.position.z = sp.len * 0.88;
      g.add(cap);
    }
    // 구리 회전탄대
    const bandGeo = new THREE.CylinderGeometry(sp.rad * 1.05, sp.rad * 1.05, sp.len * 0.07, 18);
    bandGeo.rotateX(Math.PI / 2);
    const band = new THREE.Mesh(bandGeo, shellBandMat);
    band.position.z = sp.len * 0.12;
    g.add(band);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    shellCache.set(key, g);
  }
  return shellCache.get(key).clone();
}
// 예광 궤적: 포탄 뒤로 이어지는 트레일 라인
const TRACER_N = 30;
function makeTracer(startPos) {
  const arr = new Float32Array(TRACER_N * 3);
  for (let i = 0; i < TRACER_N; i++) arr.set([startPos.x, startPos.y, startPos.z], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffb45e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  line.frustumCulled = false;
  scene.add(line);
  return {
    line,
    push(p) {
      arr.copyWithin(3, 0, (TRACER_N - 1) * 3);
      arr.set([p.x, p.y, p.z], 0);
      geo.attributes.position.needsUpdate = true;
    },
    fade() {
      tween(320, (e) => { line.material.opacity = 0.85 * (1 - e); }, linear).then(() => {
        scene.remove(line);
        geo.dispose();
      });
    },
  };
}
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

// 피격 방향 표시: 사수 쪽에서 목표를 가리키는 화살촉 플래시
function hitDirectionFx(target, fromPos, color) {
  const dir = new THREE.Vector3().subVectors(target.group.position, fromPos);
  dir.y = 0;
  if (dir.lengthSq() < 0.01) return;
  dir.normalize();
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1.1, 4),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
  );
  arrow.position.copy(target.group.position).addScaledVector(dir, -2.1);
  arrow.position.y += 1.0;
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  scene.add(arrow);
  tween(850, (e) => {
    arrow.position.addScaledVector(dir, 0.012);
    arrow.material.opacity = 0.95 * (1 - e);
  }, easeOut).then(() => scene.remove(arrow));
}

// 장갑 방향: 전면 ×0.7 / 측면 ×1.2 / 후면 ×1.5 — 피격 시 화면에 표시
async function applyUnitDamage(target, rawDmg, fromPos = null) {
  let aspectMult = 1;
  let aspectLabel = null;
  let aspectColor = '#ffffff';
  if (fromPos) {
    const toShooter = Math.atan2(fromPos.x - target.group.position.x, fromPos.z - target.group.position.z);
    const rel = Math.abs(normAngle(toShooter - target.group.rotation.y)) * (180 / Math.PI);
    if (rel <= 60) { aspectMult = 0.7; aspectLabel = '전면 장갑'; aspectColor = '#8fc9ff'; }
    else if (rel >= 120) { aspectMult = 1.5; aspectLabel = '후면 직격'; aspectColor = '#ff6a5e'; }
    else { aspectMult = 1.2; aspectLabel = '측면 관통'; aspectColor = '#ffb454'; }
  }
  const dmg = Math.round(rawDmg * aspectMult * (1 - 0.07 * target.hullLv)); // 차체 레벨 = 장갑
  target.hp -= dmg;
  updateHpBar(target);
  if (target.isPlayer) updatePlayerHpUI();
  if (aspectLabel) {
    const p = target.group.position.clone();
    p.y += 1.2;
    popText(p, `${aspectLabel}!`, aspectColor);
    hitDirectionFx(target, fromPos, aspectColor);
    if (target.isPlayer) setHint(`${aspectLabel} 피격 ×${aspectMult}`);
  }
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
  // 다리 피해: 착탄 셀이 다리면 직격, 옆 칸이면 여파
  if (bridge.alive) {
    if (bridge.cells.has(cellKey(c.gx, c.gz))) damageBridge(60, impact);
    else if ([...bridge.cells].some((k) => { const [bx, bz] = k.split(',').map(Number); return Math.max(Math.abs(bx - c.gx), Math.abs(bz - c.gz)) <= 1; })) damageBridge(25, impact);
  }
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
    await applyUnitDamage(directUnit, attacker.damage, attacker.group.position);
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
// 스폰슨 트윈(Mark IV): 목표가 있는 쪽 부포를 고른다 (차체 기준 좌/우)
function pickSponson(attacker, targetYaw) {
  const rel = normAngle(targetYaw - attacker.group.rotation.y);
  const key = rel >= 0 ? 'R' : 'L';
  return {
    gun: attacker.sponsons.find((s) => s.key === key),
    other: attacker.sponsons.find((s) => s.key !== key),
  };
}
async function aimAt(attacker, aim, pitchDeg, instant = false) {
  const dx = aim.x - attacker.group.position.x;
  const dz = aim.z - attacker.group.position.z;
  const targetYaw = Math.atan2(dx, dz);
  const pitchRad = -THREE.MathUtils.degToRad(pitchDeg);
  let gunGroup = attacker.cannon;           // 부앙각/반동을 적용할 포 그룹
  attacker._activeMuzzle = attacker.muzzle;
  if (attacker.gun?.fixed) {
    const rel = clampToGunArc(attacker, normAngle(targetYaw - attacker.group.rotation.y));
    if (attacker.sponsonTwin) {
      // 좌/우 독립 부포 — 목표 쪽 포만 조준하고 반대쪽은 자기 측면(rest)으로 되돌린다
      const { gun, other } = pickSponson(attacker, targetYaw);
      gunGroup = gun.group;
      attacker._activeMuzzle = gun.muzzle;
      const from = gun.group.rotation.y;
      const diff = normAngle(rel - from);
      if (Math.abs(diff) > 0.01 && !instant) {
        await tween(140 + Math.abs(diff) * 100, (e) => { gun.group.rotation.y = from + diff * e; });
      } else gun.group.rotation.y = rel;
      const orest = other.group.userData.rest, ofrom = other.group.rotation.y;
      const od = normAngle(orest - ofrom);
      if (Math.abs(od) > 0.01 && !instant) tween(220, (e) => { other.group.rotation.y = ofrom + od * e; });
      else other.group.rotation.y = orest;
    } else {
      // 단일 고정 포신: 차체는 그대로, 포만 사각(arc) 안에서 좌우 미세 조준
      const from = attacker.cannon.rotation.y;
      const diff = normAngle(rel - from);
      if (Math.abs(diff) > 0.01 && !instant) {
        await tween(140 + Math.abs(diff) * 100, (e) => { attacker.cannon.rotation.y = from + diff * e; });
      } else attacker.cannon.rotation.y = rel;
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
    await rotateTo(attacker, targetYaw, PIVOT_RATE);
  }
  attacker._activeCannon = gunGroup;
  const fromP = gunGroup.rotation.x;
  if (instant) gunGroup.rotation.x = pitchRad;
  else await tween(140, (e) => { gunGroup.rotation.x = fromP + (pitchRad - fromP) * e; });
  return pitchRad;
}
function sfxOnce(attacker) { if (!attacker._trvSfx) { attacker._trvSfx = true; setTimeout(() => (attacker._trvSfx = false), 400); sfx('step'); } }

async function fireSequence(attacker, target, shot) {
  attacker._aiming = true;
  const aim = aimPointOf(target);
  // 포탑/차체 조준 + 포신 부앙각 자동 조절 (곡사는 포신을 크게 들어올림)
  const pitchRad = await aimAt(attacker, aim, shot.lob ? 43 : shot.pitch);

  sfx('fire');
  const muzzlePos = new THREE.Vector3();
  const activeMuzzle = attacker._activeMuzzle || attacker.muzzle;
  activeMuzzle.getWorldPosition(muzzlePos);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), flashMat.clone());
  flash.position.copy(muzzlePos);
  scene.add(flash);
  tween(160, (e) => { flash.scale.setScalar(1 + e); flash.material.opacity = 1 - e; }).then(() => scene.remove(flash));
  // 반동: 발사한 포를 자기 배럴 축(로컬 전방) 뒤로 밀었다 되돌린다.
  // 스폰슨포는 요회전돼 있으므로 로컬 전방을 방향으로 계산 (일반포는 +z와 동일).
  const recoilGun = attacker._activeCannon || attacker.cannon;
  const recoilBase = recoilGun.position.clone();
  const rfx = Math.sin(recoilGun.rotation.y), rfz = Math.cos(recoilGun.rotation.y);
  tween(200, (e, rawK) => {
    const d = Math.sin(rawK * Math.PI) * 0.2;
    recoilGun.position.set(recoilBase.x - rfx * d, recoilBase.y, recoilBase.z - rfz * d);
  }, linear);

  // 명중 굴림
  const roll = Math.random() * 100;
  const hit = roll < shot.chance;
  let impact = aim.clone();
  if (!hit) {
    const a = Math.random() * Math.PI * 2;
    // 산포 반경도 거리에 비례 — 원거리 빗나감은 크게, 곡사는 1.6배
    const r = TILE * (1.0 + Math.random() * 1.6) * (0.7 + (shot.distCells ?? 8) * 0.055) * (shot.lob ? 1.6 : 1);
    impact.x += Math.sin(a) * r;
    impact.z += Math.cos(a) * r;
    impact.y = Math.max(sampleHeight(impact.x, impact.z), WATER_Y) + 0.1;
  }
  // 직사: 실제 탄도 추적 — 도중에 걸리는 지형/차량/프랍/다리가 곧 착탄점
  let collUnit = null;
  let collProp = null;
  if (!shot.lob) {
    const tr = traceDirect(attacker, muzzlePos, impact, { throughAim: true });
    impact = new THREE.Vector3(tr.x, tr.y, tr.z);
    collUnit = tr.unit ?? null;
    collProp = tr.prop ?? null;
  }

  // 포탄 궤적
  const from = muzzlePos.clone();
  const dist = from.distanceTo(impact);
  const mid = from.clone().lerp(impact, 0.5);
  // 곡사는 하늘 높이 치솟는 포물선, 직사는 거의 직선
  mid.y = Math.max(from.y, impact.y) + (shot.lob ? 7 + dist * 0.5 : 0.3 + dist * 0.03);
  // 시대별 실포탄 + 예광 트레일 — 천천히 날아 궤적이 잘 보인다
  const shell = makeShell(attacker.kitKey);
  shell.position.copy(from);
  scene.add(shell);
  const tracer = makeTracer(from);
  const prevPos = from.clone();
  const dirTmp = new THREE.Vector3();
  const fwd = new THREE.Vector3(0, 0, 1);
  const flight = shot.lob
    ? Math.min(2600, 950 + dist * 70)
    : Math.min(1700, 550 + dist * 52);
  await tween(flight, (e, rawK) => {
    const a = from.clone().lerp(mid, e);
    const b = mid.clone().lerp(impact, e);
    a.lerp(b, e);
    shell.position.copy(a);
    // 탄체를 비행 방향으로 정렬 + 강선 회전
    dirTmp.subVectors(a, prevPos);
    if (dirTmp.lengthSq() > 1e-6) {
      shell.quaternion.setFromUnitVectors(fwd, dirTmp.normalize());
      shell.rotateZ(rawK * 22);
    }
    prevPos.copy(a);
    tracer.push(a);
  }, linear);
  scene.remove(shell);
  tracer.fade();
  tween(200, (e) => { attacker.cannon.rotation.x = pitchRad * (1 - e); });

  if (!hit && target.unit && !collUnit) popText(aimPointOf(target), 'MISS!', '#bcd2ff');
  // 직사는 탄도에 걸린 것이 곧 직격 대상 (의도한 목표든 아니든)
  const directUnit = shot.lob
    ? (hit && target.unit ? target.unit : null)
    : collUnit;
  const directProp = shot.lob
    ? (hit && target.prop ? target.prop : null)
    : collProp;
  if (directProp) damageProp(directProp, attacker.damage * 1.4);
  await resolveImpact(impact, attacker, directUnit);
  attacker._aiming = false;
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
// 각도 유지 구간(회전 없이 전/후진만으로 도달)은 같은 파랑 필드 안에서
// 살짝 더 진하게만 덧칠 — 별도 레이어처럼 도드라지지 않는다 (외곽선 없음)
const keepFillMat = new THREE.MeshBasicMaterial({
  color: 0x2f6fd0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
});
const fireFillMat = new THREE.MeshBasicMaterial({
  color: 0xff5544, transparent: true, opacity: 0.21, side: THREE.DoubleSide, depthWrite: false,
});
const fireEdgeMat = new THREE.MeshBasicMaterial({ color: 0xd0342c, transparent: true, opacity: 0.9, depthWrite: false });
const fireEdgeThinMat = new THREE.MeshBasicMaterial({ color: 0xd0342c, transparent: true, opacity: 0.32, depthWrite: false });
const fireFillDimMat = new THREE.MeshBasicMaterial({
  color: 0xd0342c, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false,
});
const lobFillDimMat = new THREE.MeshBasicMaterial({
  color: 0xe07818, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false,
});
// 곡사(주황) — 능선 너머로 넘겨 쏘는 셀
const lobFillMat = new THREE.MeshBasicMaterial({
  color: 0xff9430, transparent: true, opacity: 0.17, side: THREE.DoubleSide, depthWrite: false,
});
const lobEdgeMat = new THREE.MeshBasicMaterial({ color: 0xe07818, transparent: true, opacity: 0.85, depthWrite: false });
const lobEdgeThinMat = new THREE.MeshBasicMaterial({ color: 0xe07818, transparent: true, opacity: 0.28, depthWrite: false });

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

// 부드러운 외곽선을 따라 지형에 밀착하는 튜브 (포인트 데시메이트 + 캣멀롬 보간)
function loopTube(pts, lift, radius, mat) {
  const dec = pts.filter((_, i) => i % 3 === 0);
  const v = dec.map(([x, z]) => new THREE.Vector3(x, groundY(x, z) + lift, z));
  const curve = new THREE.CatmullRomCurve3(v, true, 'catmullrom', 0.5);
  const geo = new THREE.TubeGeometry(curve, Math.max(64, dec.length * 2), radius, 5, true);
  return new THREE.Mesh(geo, mat);
}

// 셀 집합 → 콘벡스헐 느낌의 범위 필드 (차이킨 스무딩 경계 + 지형 밀착 채움)
// fill=false면 얇은 외곽선만 (비활성 모드 표시용)
function showCellField(cellKeys, { fillMat, edgeMat, fill = true, edge = true, edgeRadius = 0.09, lift = 0 }) {
  const set = cellKeys instanceof Set ? cellKeys : new Set(cellKeys);
  if (!set.size) return;
  // 차이킨 3회 스무딩 — 타일 계단이 사라진 곡선 경계.
  // 내부 판정(PIP)은 데시메이트한 루프로 비용을 억제한다
  const loops = boundaryLoops(set).map((l) => chaikin(l, 3));
  const pipLoops = loops.map((l) => l.filter((_, i) => i % 4 === 0));
  if (fill) {
    // 채움: 0.45 간격 서브셀 래스터 → 지형 굴곡을 따라가는 쿼드
    const step = 0.45;
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
        if (!insideLoops(pipLoops, x + step / 2, z + step / 2)) continue;
        const yo = 0.05 + lift;
        const y00 = groundY(x, z) + yo, y10 = groundY(x + step, z) + yo;
        const y01 = groundY(x, z + step) + yo, y11 = groundY(x + step, z + step) + yo;
        verts.push(x, y00, z, x, y01, z + step, x + step, y10, z);
        verts.push(x + step, y10, z, x, y01, z + step, x + step, y11, z + step);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    const fillMesh = new THREE.Mesh(geo, fillMat);
    noAO(fillMesh);
    moveHighlightGroup.add(fillMesh);
  }
  if (edge) {
    for (const loop of loops) {
      const tube = loopTube(loop, 0.09 + lift, fill ? edgeRadius : edgeRadius * 0.55, edgeMat);
      noAO(tube);
      moveHighlightGroup.add(tube);
    }
  }
}

function showMoveField(cells, active) {
  const set = new Set(cells.keys());
  set.add(cellKey(player.gx, player.gz)); // 자기 칸 포함해 구멍 방지
  showCellField(set, {
    fillMat: moveFillMat,
    edgeMat: active ? moveEdgeMat : moveEdgeThinMat,
    fill: active,
  });
  if (!active) return;
  // 차체 회전 없이(전진/후진만) 갈 수 있는 구간을 같은 필드 안에서 더 진하게.
  // 외곽선 없이 아주 살짝만 덧칠 — 별도 반경처럼 도드라지지 않고 음영으로 구분.
  const keep = new Set([cellKey(player.gx, player.gz)]);
  for (const [k, v] of cells) if (!v.turned) keep.add(k);
  if (keep.size > 1) {
    showCellField(keep, {
      fillMat: keepFillMat, edge: false, fill: true, lift: 0.006,
    });
  }
}

// 사격 가능 필드: 부앙각/사거리/사선이 전부 유효한 셀만 포함 —
// 못 쏘는 구역(너무 가까움·능선 차폐 등)은 애초에 영역에서 빠진다
function showFireField(cells, active) {
  const direct = new Set();
  const lob = new Set();
  for (const [k, v] of cells) (v.shot.lob ? lob : direct).add(k);
  // 평상시에도 옅은 채움으로 사격 가능 범위가 항상 읽힌다
  showCellField(direct, {
    fillMat: active ? fireFillMat : fireFillDimMat,
    edgeMat: active ? fireEdgeMat : fireEdgeThinMat,
    fill: true,
  });
  showCellField(lob, {
    fillMat: active ? lobFillMat : lobFillDimMat,
    edgeMat: active ? lobEdgeMat : lobEdgeThinMat,
    fill: true,
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
    const sp = chanceSprite(`${t.shot.chance}%${player.movedLastTurn ? '' : '★'}`);
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
const btnGo = document.getElementById('btn-go');
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
  levelLabel.textContent = `${KIT_INFO[playerKit].label} · ${gunTxt} · 부앙 ${g.pitchMin}°~+${g.pitchMax}° · 재장전 ${g.reload}턴 · 기동 ${player.mp} · 사거리 ${player.fireRange}`;
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
// ---------------------------------------------------------------------------
// 이동 고스트: 목적지에 반투명 홀로그램 차체를 표시하고,
// 드래그로 차체 전면이 바라볼 방향을 지정한다
// ---------------------------------------------------------------------------
const ghostMat = new THREE.MeshBasicMaterial({
  color: 0x6db2ff, transparent: true, opacity: 0.4, depthWrite: false,
});
const ghostKit = buildKitTank(playerKit);
const ghost = ghostKit.group;
ghost.traverse((o) => {
  if (o.isMesh && o !== ghostKit.hitbox) {
    o.material = ghostMat;
    o.castShadow = false;
    o.receiveShadow = false;
  }
});
ghostKit.hitbox.visible = false;
ghost.visible = false;
scene.add(ghost);
// 전면 방향 화살표 (고스트 발밑)
const ghostArrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.32, 0.9, 3),
  new THREE.MeshBasicMaterial({ color: 0x9ccaff, transparent: true, opacity: 0.85, depthWrite: false })
);
ghostArrow.rotation.x = Math.PI / 2; // +z를 향하는 납작 화살표
ghostArrow.position.set(0, 0.15, 1.6);
ghost.add(ghostArrow);
function showGhost(cell, facing, turretYaw = null) {
  const p = cellToWorld(cell.gx, cell.gz);
  ghost.position.set(p.x, standHeight(cell.gx, cell.gz), p.z);
  ghost.rotation.y = facing;
  if (ghostKit.turret) ghostKit.turret.rotation.y = turretYaw === null ? 0 : normAngle(turretYaw - facing);
  ghost.visible = true;
}

// 정지 사격 보너스 표시: 직전 턴 정지 + 장전 완료면 발밑에 금색 조준 안정 링
const haltRing = new THREE.Mesh(
  new THREE.RingGeometry(1.35, 1.55, 30),
  new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
);
haltRing.rotation.x = -Math.PI / 2;
haltRing.visible = false;
scene.add(haltRing);
// 조준 스택 링: 허탕 경계 후 다음 사격 +15% 상태 표시 (점선 느낌의 안쪽 링)
const aimRing = new THREE.Mesh(
  new THREE.RingGeometry(0.95, 1.12, 26, 1),
  new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
);
aimRing.rotation.x = -Math.PI / 2;
aimRing.visible = false;
scene.add(aimRing);

// 조준 UI: 탄도 튜브(직사=낮은 직선, 곡사=높은 포물선) + 펄스 레티클.
// 셰브론(화살표) 텍스처가 탄착점 방향으로 흘러 눈에 잘 띈다
function makeChevronTex() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 16);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(10, 1); ctx.lineTo(34, 8); ctx.lineTo(10, 15);
  ctx.lineTo(20, 8); ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const trajTex = makeChevronTex();
const trajMat = new THREE.MeshBasicMaterial({
  color: 0xff4433, map: trajTex, transparent: true, opacity: 0.95,
  blending: THREE.AdditiveBlending, depthTest: false, side: THREE.DoubleSide,
});
const trajGlowMat = new THREE.MeshBasicMaterial({
  color: 0xff4433, transparent: true, opacity: 0.22,
  blending: THREE.AdditiveBlending, depthTest: false,
});
let trajTube = null;
let trajGlow = null;
function setTrajCurve(points, color) {
  if (trajTube) {
    scene.remove(trajTube); trajTube.geometry.dispose();
    scene.remove(trajGlow); trajGlow.geometry.dispose();
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const len = points[0].distanceTo(points[points.length - 1]);
  trajTex.repeat.set(Math.max(4, Math.round(len * 0.9)), 1);
  trajTube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.13, 8, false), trajMat);
  trajGlow = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.3, 8, false), trajGlowMat);
  trajTube.renderOrder = 15;
  trajGlow.renderOrder = 14;
  trajMat.color.set(color);
  trajGlowMat.color.set(color);
  scene.add(trajGlow);
  scene.add(trajTube);
}
function hideTrajCurve() {
  if (trajTube) {
    scene.remove(trajTube); trajTube.geometry.dispose(); trajTube = null;
    scene.remove(trajGlow); trajGlow.geometry.dispose(); trajGlow = null;
  }
}
const bowReticle = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.78, 26),
  new THREE.MeshBasicMaterial({ color: 0xff4433, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
);
bowReticle.rotation.x = -Math.PI / 2;
bowReticle.visible = false;
scene.add(bowReticle);
function updateBowUI(aimPoint, shot) {
  const p = player.group.position;
  const valid = !!shot;
  const lob = valid && !!shot.lob;
  const from = new THREE.Vector3(p.x, p.y + 1.4, p.z);
  const to = aimPoint;
  const dist = from.distanceTo(to);
  const mid = from.clone().lerp(to, 0.5);
  mid.y = Math.max(from.y, to.y) + (lob ? 7 + dist * 0.5 : 0.5 + dist * 0.04);
  const pts = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i <= 24; i++) {
    const e = i / 24;
    a.lerpVectors(from, mid, e);
    b.lerpVectors(mid, to, e);
    pts.push(a.clone().lerp(b, e));
  }
  const col = !valid ? 0x8b95a8 : lob ? 0xff9430 : 0xff4433;
  setTrajCurve(pts, col);
  bowReticle.position.set(to.x, groundY(to.x, to.z) + 0.12, to.z);
  bowReticle.material.color.set(col);
  bowReticle.scale.setScalar(1.5);
  bowReticle.visible = true;
}
function hideBowUI() {
  hideTrajCurve();
  bowReticle.visible = false;
}

// 동시 턴제(WeGo): 턴마다 모든 차량이 행동 1개(AP 1)를 고르고 한꺼번에 진행.
// 행동은 이동 또는 포격 — 포격은 "셀"을 조준하는 예측 사격이라
// 목표가 그 턴에 움직이면 빗나간다. 플레이어가 행동을 고르는 즉시
// 적들도 행동을 계획하고 전원 동시에 해결된다.
const COLLISION_DMG = 16; // 같은 칸 진입 충돌 시 상호 피해
let turnNo = 1;
let phase = 'plan'; // plan | resolve | gameover
let busy = false;
// ── 3동사 턴: 기동 / 사격 / 경계 ──
// 한 턴 = 동사 하나, 입력 즉시 실행:
//  기동: 이동 필드 셀 터치 → 드래그로 차체 방향 → 놓기
//  사격: 내 차량에서 바깥으로 드래그 → 목표 셀에서 놓기 (장전 완료 시)
//  경계: 👁 버튼(턴 종료) — 정지한 채 사격 필드를 지나는 적에게 스냅 사격,
//        아무도 안 걸리면 조준 스택 +15% (다음 사격에 가산)
// 상성: 기동 > 사격(예측탄 회피) · 경계 > 기동(스냅) · 사격 > 경계(정지 표적)
const SNAP_PENALTY = 15;
const dirAngle = (d) => Math.atan2(DIRS[d].dx, DIRS[d].dz);
let currentMoveCells = new Map();
let currentFireCells = new Map();

function refreshPlanUI(fireEmphasis = false) {
  if (phase !== 'plan') return;
  currentMoveCells = reachableCells(player);
  currentFireCells = player.reloadLeft > 0 ? new Map() : computeFireCells(player);
  clearHighlights();
  showMoveField(currentMoveCells, !fireEmphasis);
  showFireField(currentFireCells, fireEmphasis);
  showTargets(
    enemies
      .filter((e) => e.alive && currentFireCells.has(cellKey(e.gx, e.gz)))
      .map((e) => ({ unit: e, shot: currentFireCells.get(cellKey(e.gx, e.gz)).shot }))
  );
  btnGo.textContent = player.reloadLeft > 0 ? `⏸ 대기 (재장전 ${player.reloadLeft})` : '👁 경계';
}

function startPlanning() {
  if (checkGameEnd()) return;
  phase = 'plan';
  busy = false;
  for (const u of units) if (u.alive && u.reloadLeft > 0) u.reloadLeft -= 1;
  ghost.visible = false;
  hideBowUI();
  turnLabel.textContent = `턴 ${turnNo}`;
  refreshPlanUI();
}

async function submitPlan(plan) {
  if (phase !== 'plan' || busy) return;
  player.plan = plan;
  planEnemies();
  await resolveTurn();
}

// 적 AI — AI 레벨(driverLv):
//  Lv1: 현재 칸 조준 / Lv2: 절반 리드 + 굴착 + 경계 / Lv3: 완전 외삽 리드
let playerLastMove = null;
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
    enemy.plan = null;
    const lvl = enemy.driverLv;
    if (enemy.reloadLeft <= 0) {
      const aim = predictPlayerCell(lvl);
      const aimIsPlayer = aim.gx === player.gx && aim.gz === player.gz;
      const shot = computeShot(enemy, aimIsPlayer ? { unit: player } : aim);
      if (shot.ok && (!aimIsPlayer || shot.chance >= 30)) {
        enemy.plan = { type: 'fire', cell: aim, shot };
        continue;
      }
      // 곡사 (Lv2+): 사선이 막혔으면 능선 너머로 넘겨 쏜다
      if (lvl >= 2 && !shot.ok) {
        const lobShot = computeShot(enemy, aimIsPlayer ? { unit: player } : aim, null, null, true);
        if (lobShot.ok && (!aimIsPlayer || lobShot.chance >= 25)) {
          enemy.plan = { type: 'fire', cell: aim, shot: lobShot };
          continue;
        }
      }
      // 능선 굴착 (Lv2+): 곡사도 안 되면 막힌 지형을 포격해 포각 확보
      if (lvl >= 2 && shot.blockCell) {
        const dig = computeShot(enemy, shot.blockCell);
        if (dig.ok) {
          enemy.plan = { type: 'fire', cell: shot.blockCell, shot: dig };
          continue;
        }
      }
      // 경계 (Lv2+): 사격은 안 되지만 플레이어가 근처를 지나갈 만하면 매복
      const distP = Math.hypot(enemy.gx - player.gx, enemy.gz - player.gz);
      if (lvl >= 2 && distP <= enemy.fireRange + 3 && Math.random() < 0.5) {
        enemy.plan = { type: 'overwatch' };
        continue;
      }
    }
    const cells = reachableCells(enemy);
    let best = null;
    // 장갑 방향 관리: 도착 자세가 플레이어에게 측면(×1.2)/후면(×1.5)을
    // 내주면 감점 — 레벨이 높을수록 예민하게 전면을 유지한다 (Lv1은 무시)
    const sidePen = (lvl - 1) * 10, rearPen = (lvl - 1) * 22;
    const exposurePenalty = (gx, gz, endDir) => {
      const fd = DIRS[endDir];
      const rel = Math.abs(normAngle(
        Math.atan2(player.gx - gx, player.gz - gz) - Math.atan2(fd.dx, fd.dz)
      )) * (180 / Math.PI);
      return rel >= 120 ? rearPen : rel > 60 ? sidePen : 0;
    };
    for (const [key, info] of cells) {
      const [gx, gz] = key.split(',').map(Number);
      const sShot = computeShot(enemy, { unit: player }, { gx, gz });
      const distP = Math.hypot(gx - player.gx, gz - player.gz);
      let score = sShot.ok ? 200 + sShot.chance - info.cost * 2 : 100 - distP * 5 - info.cost;
      score -= exposurePenalty(gx, gz, info.endDir);
      if (!best || score > best.score) best = { score, info };
    }
    // 제자리 대기도 후보로 평가 — 지금 자세가 이미 노출이면 이동이 이긴다
    const stayScore = 100 - Math.hypot(enemy.gx - player.gx, enemy.gz - player.gz) * 5
      - exposurePenalty(enemy.gx, enemy.gz, facingDir(enemy));
    if (best && best.info.path.length && best.score > stayScore) {
      enemy.plan = { type: 'move', path: best.info.path.slice(), facing: null };
    } else enemy.plan = { type: 'wait' };
  }
}

// 이동 충돌 시뮬레이션: 스텝 단위로 동시 진행.
// 근접(체비쇼프 1칸) 진입·자리 맞바꿈·추돌은 충돌 —
// 이동자는 직전 타일에서 멈추고(경로 절단) 양쪽 모두 피해를 입는다.
function simulateMoves() {
  const movers = units.filter((u) => u.alive && (u.plan?.type === 'move' && u.plan.path?.length));
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
        const rival = active.find((o) => o !== it && cheb(o.to.gx, o.to.gz, it.to.gx, it.to.gz) <= 1);
        const swap = active.find((o) => {
          if (o === it) return false;
          const oc = cur.get(o.u), ic = cur.get(it.u);
          return o.to.gx === ic.gx && o.to.gz === ic.gz && it.to.gx === oc.gx && it.to.gz === oc.gz;
        });
        let occ = null;
        for (const [u2, c2] of cur) {
          if (u2 === it.u) continue;
          if (cheb(c2.gx, c2.gz, it.to.gx, it.to.gz) > 1) continue;
          if (active.some((o) => o.u === u2)) continue;
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
  const seen = new Set();
  return hits.filter((h) => {
    const key = [units.indexOf(h.a), units.indexOf(h.b)].sort((x, y) => x - y).join('-');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 포탑 사전 추적 (해결 페이즈 전용): 포탑 각속도로 목표를 향해 미리 돈다.
// 발사 시퀀스(aimAt)가 도는 동안은 간섭하지 않는다.
const TURRET_TRACK_RATE = 2.6; // rad/s
function updateTurretTracking(dt) {
  if (phase !== 'resolve') return;
  const step = TURRET_TRACK_RATE * dt;
  for (const u of units) {
    if (!u.alive || !u._track || u._aiming) continue;
    const p = u._track.point ?? u._track.unit?.group.position;
    if (!p || (u._track.unit && !u._track.unit.alive)) continue;
    const targetYaw = Math.atan2(p.x - u.group.position.x, p.z - u.group.position.z);
    if (u.sponsonTwin) {
      // 목표 쪽 부포를 사각 안에서 겨누고, 반대쪽은 자기 측면(rest)으로
      const { gun, other } = pickSponson(u, targetYaw);
      const rel = clampToGunArc(u, normAngle(targetYaw - u.group.rotation.y));
      gun.group.rotation.y += THREE.MathUtils.clamp(normAngle(rel - gun.group.rotation.y), -step, step);
      other.group.rotation.y += THREE.MathUtils.clamp(normAngle(other.group.userData.rest - other.group.rotation.y), -step, step);
      continue;
    }
    const rel = normAngle(targetYaw - u.group.rotation.y);
    const diff = normAngle(rel - u.turret.rotation.y);
    u.turret.rotation.y += THREE.MathUtils.clamp(diff, -step, step);
  }
}

// 계획된 포격 해결: 조준한 셀에 지금 무엇이 있는지로 판정 (예측 사격).
// 발사 즉시 재장전 시작.
async function resolvePlannedShot(u) {
  const { gx, gz } = u.plan.cell;
  const wasLob = !!u.plan.shot?.lob;
  const occ = units.find((t) => t.alive && t !== u && t.gx === gx && t.gz === gz);
  let target = occ ? { unit: occ } : null;
  let shot = target ? computeShot(u, target, null, null, wasLob) : null;
  if (!shot?.ok) {
    const prop = props.get(cellKey(gx, gz));
    if (prop) { target = { prop }; shot = computeShot(u, target, null, null, wasLob); }
  }
  if (!shot?.ok) { target = { gx, gz }; shot = computeShot(u, target, null, null, wasLob); }
  if (!shot.ok) { target = { gx, gz }; shot = u.plan.shot; } // 지형 변화 등 — 계획값으로 발사
  u.reloadLeft = u.gun?.reload ?? 2;
  u.aimStack = 0; // 조준 스택 소모
  await fireSequence(u, target, shot);
}

async function resolveTurn() {
  phase = 'resolve';
  busy = true;
  clearHighlights();
  ghost.visible = false;
  hideBowUI();
  turnLabel.textContent = `턴 ${turnNo} ▶`;
  const playerStart = { gx: player.gx, gz: player.gz };
  // 포탑 사전 조준: 사격 예정 유닛은 조준 셀을, 그 외 적 포탑은 플레이어를
  // 미리 추적한다 (차체 선회는 느려도 포탑은 목표를 맞춰 간다)
  for (const u of units) {
    u._track = null;
    if (!u.alive || (!u.hasTurret && !u.sponsonTwin)) continue;
    if (u.plan?.type === 'fire') {
      u._track = { point: aimPointOf({ gx: u.plan.cell.gx, gz: u.plan.cell.gz }) };
      continue;
    }
    // 경계 중엔 포탑 선회 금지 — 지금 바라보는 방향(±5°)만 지킨다
    if (u.plan?.type === 'overwatch') continue;
    // 도착 후 포탑 방향을 지정한 이동자는 추적하지 않는다 (지정 방향 우선)
    if (u.plan?.type === 'move' && u.plan.turretYaw != null) continue;
    const foes = (u.isPlayer ? enemies : [player]).filter((e) => e.alive);
    const near = foes.sort((a, b) =>
      a.group.position.distanceToSquared(u.group.position) -
      b.group.position.distanceToSquared(u.group.position))[0];
    if (near) u._track = { unit: near };
  }
  // A) 경계망 구성: 이동 스텝마다 상대편 경계자의 사선을 체크,
  //    걸리면 이동 중 "실시간" 스냅 사격 (경계자당 1회, 스냅 페널티)
  const overwatchers = units.filter((u) => u.alive && u.plan?.type === 'overwatch' && u.reloadLeft <= 0);
  for (const ow of overwatchers) ow._snapped = false;
  const snapShots = [];
  const SNAP_ARC = THREE.MathUtils.degToRad(5); // 현재 포 방향 ±5° 안에 들어와야 발사
  const onStep = (mover) => {
    for (const ow of overwatchers) {
      if (ow._snapped || !ow.alive || !mover.alive) continue;
      if (ow.isPlayer === mover.isPlayer) continue;
      const bearing = Math.atan2(
        mover.group.position.x - ow.group.position.x,
        mover.group.position.z - ow.group.position.z
      );
      // 포가 지금 실제로 향한 방향 기준 정렬 검사 — 포가 목표를 물어야 스냅.
      // 스폰슨 트윈은 좌/우 부포 중 어느 쪽이든 정렬되면 발사.
      let aligned;
      if (ow.sponsonTwin) {
        aligned = ow.sponsons.some((s) =>
          Math.abs(normAngle(bearing - (ow.group.rotation.y + s.group.rotation.y))) <= SNAP_ARC);
      } else {
        const gunYaw = ow.group.rotation.y +
          (ow.hasTurret ? ow.turret.rotation.y : (ow.cannon?.rotation.y ?? 0));
        aligned = Math.abs(normAngle(bearing - gunYaw)) <= SNAP_ARC;
      }
      if (!aligned) continue;
      const shot = computeShot(ow, { unit: mover });
      if (!shot.ok) continue;
      ow._snapped = true;
      shot.chance = Math.max(5, shot.chance - SNAP_PENALTY);
      popText(ow.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), '경계 사격!', '#ffd76e');
      ow.reloadLeft = ow.gun?.reload ?? 2;
      ow.aimStack = 0;
      snapShots.push(fireSequence(ow, { unit: mover }, shot));
    }
  };
  // B) 전 차량 동시 이동 + 충돌 — 경계 스냅은 이 단계에서 실시간 발동
  const collisions = simulateMoves();
  const movers = units.filter((u) => u.alive && u.plan?.type === 'move' && u.plan.path?.length);
  await Promise.all(movers.map(async (u) => {
    await moveUnit(u, u.plan.path, u.plan.facing, onStep);
    // 드래그로 지정한 "도착 후 포탑 방향"으로 포탑만 선회 (차체는 그대로)
    if (u.alive && u.plan.turretYaw != null && u.hasTurret) {
      const rel = normAngle(u.plan.turretYaw - u.group.rotation.y);
      const from = u.turret.rotation.y;
      const diff = normAngle(rel - from);
      if (Math.abs(diff) > 0.02) {
        await tween((Math.abs(diff) / TURRET_TRACK_RATE) * 1000, (e2) => { u.turret.rotation.y = from + diff * e2; });
      }
    }
  }));
  for (const h of collisions) {
    if (!h.a.alive || !h.b.alive) continue;
    const mid = h.a.group.position.clone().lerp(h.b.group.position, 0.5);
    mid.y += 0.8;
    sfx('hit');
    spawnDebris(mid, [0xffd24d, 0x8b95a8], 8, 4);
    popText(mid, '충돌!', '#ffd24d');
    await Promise.all([applyUnitDamage(h.a, COLLISION_DMG), applyUnitDamage(h.b, COLLISION_DMG)]);
  }
  await Promise.all(snapShots);
  // C) 일반 사격 — 모든 이동이 끝난 뒤 발사.
  //    목적지를 맞게 예측한 셀 사격은 도착한 적을 정통으로 맞춘다.
  const shooters = units.filter((u) => u.alive && u.plan?.type === 'fire');
  await Promise.all(shooters.map((u) => resolvePlannedShot(u)));
  // D) 조준 스택: 허탕 경계 = 다음 사격 +15%, 기동은 스택 소실
  for (const u of units) {
    if (!u.alive) continue;
    if (u.plan?.type === 'overwatch' && u.reloadLeft <= 0 && !u._snapped) {
      if (!u.aimStack) {
        u.aimStack = 1;
        popText(u.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), '🔭 조준 +15%', '#ffe9a8');
      }
    } else if (u.plan?.type === 'move') {
      u.aimStack = 0;
    }
    u._snapped = false;
    u.movedLastTurn = u.plan?.type === 'move' && !!u.plan.path?.length;
  }
  // AI 예측용: 이번 턴 플레이어 변위 기록
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

btnGo.addEventListener('click', () => {
  if (phase !== 'plan' || busy) return;
  submitPlan(player.reloadLeft > 0 ? { type: 'wait' } : { type: 'overwatch' });
});

// ---------------------------------------------------------------------------
// 입력
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
let ghostGesture = null; // 기동: { cell, info, facing }
let fireGesture = null;  // 사격: { cell, shot } — 내 차량에서 바깥으로 드래그
let hoverAim = null;

function setPointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
  if (phase !== 'plan' || busy) return;
  setPointer(e);
  // 1) 내 차량에서 드래그 시작 = 사격 조준 (이동/사격 필드가 겹쳐도 명확)
  if (raycaster.intersectObject(player.hitbox).length) {
    if (player.reloadLeft > 0) { setHint(`재장전 중 — ${player.reloadLeft}턴 남음`); return; }
    fireGesture = { cell: null, shot: null };
    controls.enabled = false;
    refreshPlanUI(true); // 사격 필드 강조
    return;
  }
  // 2) 이동 필드 셀 = 기동 고스트 (드래그로 차체 방향)
  const cell = raycastGroundCell(raycaster);
  if (!cell) return;
  const info = currentMoveCells.get(cellKey(cell.gx, cell.gz));
  if (!info) return;
  const endFacing = dirAngle(info.endDir);
  ghostGesture = { cell, info, facing: endFacing, turretYaw: endFacing };
  controls.enabled = false;
  showGhost(cell, endFacing, endFacing);
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (fireGesture) {
    setPointer(e);
    // 내 전차 위로 되돌리면 취소 대기 상태
    if (raycaster.intersectObject(player.hitbox).length) {
      fireGesture.cell = null;
      fireGesture.shot = null;
      hideBowUI();
      setHint('놓으면 취소');
      return;
    }
    // 목표를 향해 드래그 — 커서 아래 셀이 조준점
    let cell = null;
    const enemyHit = raycaster.intersectObjects(
      enemies.filter((en) => en.alive).map((en) => en.hitbox)
    )[0];
    if (enemyHit) {
      const u = enemyHit.object.userData.unit;
      cell = { gx: u.gx, gz: u.gz };
    } else {
      const bridgeHit = bridge.alive && bridge.hit ? raycaster.intersectObject(bridge.hit)[0] : null;
      if (bridgeHit) cell = worldToCell(bridgeHit.point);
      else {
        const ground = raycaster.intersectObject(terrainMesh, false)[0];
        if (ground) cell = worldToCell(ground.point);
      }
    }
    if (!cell) return;
    const f = currentFireCells.get(cellKey(cell.gx, cell.gz));
    fireGesture.cell = f ? { gx: cell.gx, gz: cell.gz } : null;
    fireGesture.shot = f ? f.shot : null;
    const aimP = aimPointOf(f ? fireGesture.cell : cell);
    fireGesture.aimP = aimP;
    updateBowUI(aimP, f ? f.shot : null);
    hoverAim = aimP;
    if (f) {
      const d = Math.hypot(cell.gx - player.gx, cell.gz - player.gz).toFixed(0);
      setHint(`${f.shot.lob ? '🌕 곡사' : '➡ 직사'} ${d}칸 · ${f.shot.chance}%`);
    } else {
      setHint('놓으면 취소');
    }
    return;
  }
  if (ghostGesture) {
    setPointer(e);
    // 드래그로 "도착 후 포탑 방향" 지정 — 고스트 포탑이 따라 돈다
    const hit = raycaster.intersectObject(terrainMesh, false)[0];
    if (hit) {
      const c = cellToWorld(ghostGesture.cell.gx, ghostGesture.cell.gz);
      const dx = hit.point.x - c.x, dz = hit.point.z - c.z;
      if (Math.hypot(dx, dz) > 0.4) {
        ghostGesture.turretYaw = Math.atan2(dx, dz);
        if (ghostKit.turret) ghostKit.turret.rotation.y = normAngle(ghostGesture.turretYaw - ghostGesture.facing);
      }
    }
    return;
  }
  hoverAim = null;
});

renderer.domElement.addEventListener('pointerup', async (e) => {
  if (fireGesture) {
    const g = fireGesture;
    fireGesture = null;
    controls.enabled = true;
    hideBowUI();
    hoverAim = null;
    downPos = null;
    if (g.cell && g.shot) {
      await submitPlan({ type: 'fire', cell: g.cell, shot: g.shot });
    } else {
      setHint('조준 취소');
      refreshPlanUI(false);
    }
    return;
  }
  if (ghostGesture) {
    const g = ghostGesture;
    ghostGesture = null;
    controls.enabled = true;
    downPos = null;
    setPointer(e);
    // 내 전차 위에서 놓으면 취소
    if (raycaster.intersectObject(player.hitbox).length) {
      ghost.visible = false;
      setHint('이동 취소');
      return;
    }
    await submitPlan({ type: 'move', path: g.info.path.slice(), facing: null, turretYaw: g.turretYaw });
    return;
  }
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 7 || busy || phase !== 'plan') return;
  setPointer(e);
  // 탭 안내: 적을 탭하면 조작법 힌트
  const enemyHit = raycaster.intersectObjects(
    enemies.filter((en) => en.alive).map((en) => en.hitbox)
  )[0];
  if (enemyHit) setHint('사격: 내 전차를 잡고 반대쪽으로 시위를 당기세요');
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (fireGesture) { fireGesture = null; hideBowUI(); hoverAim = null; refreshPlanUI(false); }
  if (ghostGesture) { ghostGesture = null; ghost.visible = false; }
  controls.enabled = true;
  downPos = null;
  setHint('취소');
});

renderer.domElement.addEventListener('pointercancel', () => {
  if (fireGesture) { fireGesture = null; hideBowUI(); refreshPlanUI(false); }
  if (ghostGesture) { ghostGesture = null; ghost.visible = false; }
  controls.enabled = true;
  downPos = null;
  hoverAim = null;
});

function updateAimPreview(dt) {
  if (!player.alive || phase !== 'plan' || busy || !fireGesture || !hoverAim) return;
  const k = 1 - Math.exp(-dt * 9);
  const aim = hoverAim;
  const targetYaw = Math.atan2(aim.x - player.group.position.x, aim.z - player.group.position.z);
  let pitchGun = player.cannon;
  if (player.gun?.fixed) {
    const rel = clampToGunArc(player, normAngle(targetYaw - player.group.rotation.y));
    if (player.sponsonTwin) {
      // 목표 쪽 부포만 조준 프리뷰, 반대쪽은 자기 측면으로 슬며시 복귀
      const { gun, other } = pickSponson(player, targetYaw);
      pitchGun = gun.group;
      gun.group.rotation.y += normAngle(rel - gun.group.rotation.y) * k;
      other.group.rotation.y += normAngle(other.group.userData.rest - other.group.rotation.y) * k;
    } else {
      player.cannon.rotation.y += normAngle(rel - player.cannon.rotation.y) * k;
    }
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
  pitchGun.rotation.x += (target - pitchGun.rotation.x) * k;
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
  updateTurretTracking(dt);
  const pulse = 1 + Math.sin(now * 0.006) * 0.08;
  for (const ring of targetRings) ring.scale.setScalar(pulse);
  if (ghost.visible) ghostMat.opacity = 0.32 + Math.sin(now * 0.005) * 0.1;
  // 탄도 튜브의 셰브론이 탄착점 방향으로 흐른다
  if (trajTube) trajTex.offset.x = -((now * 0.0016) % 1);
  // 조준 스택 링 (허탕 경계로 얻은 +15%)
  aimRing.visible = phase === 'plan' && player.alive && player.aimStack > 0;
  if (aimRing.visible) {
    aimRing.position.set(player.group.position.x, player.group.position.y + 0.12, player.group.position.z);
    aimRing.rotation.z = now * 0.001;
  }
  // 조준 안정(정지 사격 보너스) 링
  haltRing.visible = phase === 'plan' && player.alive && !player.movedLastTurn && player.reloadLeft === 0;
  if (haltRing.visible) {
    haltRing.position.set(player.group.position.x, player.group.position.y + 0.1, player.group.position.z);
    haltRing.material.opacity = 0.5 + Math.sin(now * 0.004) * 0.2;
  }
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
  camera,
  sun,
  hideDecor: (v = true) => decorMeshes.forEach((m) => (m.visible = !v)),
  moveHighlightGroup,
  playerUnit: player,
  bridge,
  damageBridge,
  hullDown: () => [...hullDownCells],
  get state() {
    return {
      turnNo, phase, busy,
      reload: player.reloadLeft,
      aimStack: player.aimStack,
      movedLastTurn: player.movedLastTurn,
      player: { gx: player.gx, gz: player.gz, hp: player.hp, alive: player.alive, hullLv: player.hullLv, driverLv: player.driverLv },
      enemies: enemies.map((e) => ({ gx: e.gx, gz: e.gz, hp: e.hp, alive: e.alive, hullLv: e.hullLv, driverLv: e.driverLv, reload: e.reloadLeft, rotY: e.group.rotation.y })),
      props: props.size,
    };
  },
  heightAt: (gx, gz) => heightAt(gx, gz),
  terrainAt: (gx, gz) => TERRAIN_NAME[terrainAt(gx, gz)],
  reachable: () => [...reachableCells(player).keys()],
  moveInfo: (gx, gz) => {
    const i = reachableCells(player).get(cellKey(gx, gz));
    return i ? { cost: i.cost, endDir: i.endDir, turned: i.turned, path: i.path } : null;
  },
  fireCells: () => [...computeFireCells(player).keys()],
  planMoveTo(gx, gz, facing = null) {
    const info = currentMoveCells.get(cellKey(gx, gz));
    if (!info || phase !== 'plan' || busy) return false;
    submitPlan({ type: 'move', path: info.path.slice(), facing: facing ?? dirAngle(info.endDir) });
    return true;
  },
  planFireAt(gx, gz) {
    const f = currentFireCells.get(cellKey(gx, gz));
    if (!f || phase !== 'plan' || busy) return false;
    submitPlan({ type: 'fire', cell: { gx, gz }, shot: f.shot });
    return true;
  },
  planOverwatch() {
    if (phase !== 'plan' || busy || player.reloadLeft > 0) return false;
    submitPlan({ type: 'overwatch' });
    return true;
  },
  planWait() {
    if (phase !== 'plan' || busy) return false;
    submitPlan({ type: 'wait' });
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
