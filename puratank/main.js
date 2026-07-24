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
import { CARD_ICONS } from './src/card-icons.js';

// 차고에서 선택한 기체 (?tank=ft|mk4|t34|tiger)
const kitParam = new URLSearchParams(location.search).get('tank');
const playerKit = KIT_KEYS.includes(kitParam) ? kitParam : 't34';
const enemyKits = KIT_KEYS.filter((k) => k !== playerKit);

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------
const TILE = 1;             // 한 칸의 월드 크기
const WATER_Y = -0.12;      // 수면 높이
const MAX_CLIMB = 0.5;      // 궤도로 오를 수 있는 최대 단차 (1유닛 스텝 기준)
const FORD_DEPTH = 0.22;    // 도하 가능한 최대 수심 — 더 깊은 물은 진입 불가
const PITCH_MIN = -14;      // 포신 내림각 한계(도)
const PITCH_MAX = 20;       // 포신 올림각 한계(도)

const PLAYER_STATS = KIT_INFO[playerKit].stats;
const ENEMY_BASE   = { mp: 12, fireRange: 14, damage: 24 };

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

// 맵 크기: 60~120 가로세로 독립 (비정사각 가능) — 시드 기반.
// GW = x축(가로) 칸 수, GH = z축(세로) 칸 수.
const GW = 60 + Math.floor(rng() * 61);
const GH = 60 + Math.floor(rng() * 61);
const GRID = Math.max(GW, GH); // 노이즈 격자 등 단일 스케일용
const AREA_F = (GW * GH) / 3600;  // 60×60 기준 면적 배율 (식생/프랍 개수)
const MSCALE = GRID / 60;         // 카메라/포그/섀도 스케일
// 하이트필드 밀도: 큰 맵일수록 낮춰 정점 예산(~480² 수준) 유지
const VRES = Math.max(3, Math.min(8, Math.round(480 / GRID)));
// 스폰: 플레이어는 남쪽 중앙부, 적은 북쪽 띠에 고르게 —
// 맵이 클수록 적이 많아진다 (면적 비례, 2~6)
const PLAYER_SPAWN = { gx: Math.round(GW * 0.5), gz: GH - 9 };
const N_ENEMY = Math.max(2, Math.min(6, Math.round(2 * AREA_F)));
const ENEMY_SPAWNS = [];
for (let ei = 0; ei < N_ENEMY; ei++) {
  const fr = N_ENEMY === 1 ? 0.5 : ei / (N_ENEMY - 1);
  ENEMY_SPAWNS.push({
    gx: Math.round(THREE.MathUtils.clamp(GW * (0.18 + 0.64 * fr) + (rng() - 0.5) * 5, 3, GW - 4)),
    gz: 8 + Math.floor(rng() * 7),
  });
}
// 강: 82% 확률로 존재, 폭도 구간별로 변한다 (아예 없을 수도)
const hasRiver = rng() < 0.82;

// ---------------------------------------------------------------------------
// 시간대·날씨 — 지형 rng와 분리된 시드 분기 (같은 시드 = 같은 지형 유지).
// ?tod=dawn|day|dusk|night, ?wx=clear|overcast|fog|rain|storm 으로 고정 가능.
// 안개·폭우에서는 VIS_LIMIT칸 밖의 적이 아예 보이지 않는다 —
// 풀 튕김·나무 흔들림·궤도 자국·엔진 소리로만 낌새를 챈다.
// ---------------------------------------------------------------------------
const envRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
const _urlp = new URLSearchParams(location.search);
const TOD_POOL = ['day', 'day', 'day', 'dawn', 'dusk', 'night'];
const WX_POOL = ['clear', 'clear', 'clear', 'overcast', 'fog', 'rain', 'storm'];
const TOD = ['dawn', 'day', 'dusk', 'night'].includes(_urlp.get('tod'))
  ? _urlp.get('tod') : TOD_POOL[Math.floor(envRng() * TOD_POOL.length)];
const WEATHER = ['clear', 'overcast', 'fog', 'rain', 'storm'].includes(_urlp.get('wx'))
  ? _urlp.get('wx') : WX_POOL[Math.floor(envRng() * WX_POOL.length)];
const VIS_LIMIT = WEATHER === 'fog' ? 9 : WEATHER === 'storm' ? 13 : Infinity;
const TOD_LABEL = { dawn: '🌅 새벽', day: '☀️ 낮', dusk: '🌇 석양', night: '🌙 밤' }[TOD];
const WX_LABEL = { clear: '맑음', overcast: '☁️ 흐림', fog: '🌫 짙은 안개', rain: '🌧 비', storm: '⛈ 폭우' }[WEATHER];

// 시간대 기본 조명/하늘 프리셋 → 날씨가 그 위에 감쇠·색·안개를 얹는다
const ENV = (() => {
  const base = {
    dawn: {
      sunPos: [34, 11, -26], sunCol: 0xffc9a0, sunInt: 1.5,
      hemiSky: 0xc9b8d8, hemiGnd: 0x4a4438, hemiInt: 0.42,
      fogCol: 0xd8c0b8, exposure: 0.9, warm: [1.06, 0.98, 0.94], saturation: 0.88,
      sky: { top: '#31418f', mid: '#7f6fa8', low: '#e8a06c', bot: '#f4d2a0', halo: [180, 300], haloCol: '255,205,150' },
      envGround: 0x77935e,
    },
    day: {
      sunPos: [24, 34, 16], sunCol: 0xffe9c8, sunInt: 1.95,
      hemiSky: 0xbcd4f0, hemiGnd: 0x5f5a45, hemiInt: 0.38,
      fogCol: 0xaecbe8, exposure: 0.92, warm: [1.035, 1.0, 0.95], saturation: 0.9,
      sky: { top: '#2764c4', mid: '#4b8ede', low: '#8ab8e8', bot: '#d8d2bd', halo: [700, 150], haloCol: '255,248,225' },
      envGround: 0x8aa86a,
    },
    dusk: {
      sunPos: [-32, 9, 20], sunCol: 0xff9a55, sunInt: 1.4,
      hemiSky: 0xd8a8b8, hemiGnd: 0x51443a, hemiInt: 0.42,
      fogCol: 0xdca888, exposure: 0.9, warm: [1.12, 0.97, 0.86], saturation: 0.92,
      sky: { top: '#3a3f77', mid: '#8d6a96', low: '#ef9a58', bot: '#f6c98e', halo: [260, 330], haloCol: '255,175,115' },
      envGround: 0x7d7a52,
    },
    night: {
      sunPos: [18, 30, -14], sunCol: 0xa8c4e8, sunInt: 0.55,
      hemiSky: 0x2c3a58, hemiGnd: 0x1c2028, hemiInt: 0.55,
      fogCol: 0x1a2332, exposure: 0.86, warm: [0.9, 0.96, 1.12], saturation: 0.78,
      sky: { top: '#060a18', mid: '#0c1630', low: '#1a2a48', bot: '#243248', halo: [760, 120], haloCol: '225,232,255', stars: true },
      envGround: 0x28321f,
    },
  }[TOD];
  const e = { ...base, fogNear: 95 * MSCALE, fogFar: 230 * MSCALE, windAmp: 1, windSpeed: 1, rainCount: 0, lightning: false, cloudy: false };
  const gray = (hex, t, dark = 0) => new THREE.Color(hex).lerp(new THREE.Color(0x9aa4ae), t).multiplyScalar(1 - dark).getHex();
  if (WEATHER === 'overcast') {
    e.sunInt *= 0.4; e.hemiInt += 0.3; e.saturation -= 0.1; e.windAmp = 1.25;
    e.fogCol = gray(e.fogCol, 0.75); e.cloudy = true;
    e.sky = { ...e.sky, top: null }; // 스카이 텍스처에서 흐린 그라데이션으로 대체
  } else if (WEATHER === 'fog') {
    e.sunInt *= 0.28; e.hemiInt += 0.42; e.saturation -= 0.18; e.windAmp = 0.85;
    e.fogCol = gray(e.fogCol, 0.9); e.fogNear = 5; e.fogFar = 26 + 10 * MSCALE;
    e.cloudy = true; e.sky = { ...e.sky, top: null };
  } else if (WEATHER === 'rain') {
    e.sunInt *= 0.35; e.hemiInt += 0.28; e.saturation -= 0.14; e.windAmp = 1.55; e.windSpeed = 1.4;
    e.fogCol = gray(e.fogCol, 0.8, 0.25); e.fogNear = 40 * MSCALE; e.fogFar = 150 * MSCALE;
    e.rainCount = 1300; e.cloudy = true; e.sky = { ...e.sky, top: null };
  } else if (WEATHER === 'storm') {
    e.sunInt *= 0.2; e.hemiInt += 0.24; e.saturation -= 0.2; e.windAmp = 2.4; e.windSpeed = 1.9;
    e.fogCol = gray(e.fogCol, 0.85, 0.45); e.fogNear = 14; e.fogFar = 46 + 14 * MSCALE;
    e.rainCount = 3000; e.lightning = true; e.cloudy = true; e.sky = { ...e.sky, top: null };
  }
  return e;
})();

// 2옥타브 밸류 노이즈
function makeNoise(cell) {
  const size = Math.ceil(GRID / cell) + 3;
  const lattice = [];
  for (let i = 0; i < size * size; i++) lattice.push(rng());
  // 인덱스를 격자 범위로 클램프 — 맵 크기/오프셋과 무관하게 NaN 없이 안전
  const at = (x, y) => {
    const xi = x < 0 ? 0 : x >= size ? size - 1 : x;
    const yi = y < 0 ? 0 : y >= size ? size - 1 : y;
    return lattice[yi * size + xi];
  };
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
renderer.toneMappingExposure = ENV.exposure;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(ENV.fogCol, ENV.fogNear, ENV.fogFar);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(32 * MSCALE, 37 * MSCALE, 44 * MSCALE);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 6 * MSCALE);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 12;
controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.46;
controls.enablePan = true;
controls.panSpeed = 0.6;

const hemiLight = new THREE.HemisphereLight(ENV.hemiSky, ENV.hemiGnd, ENV.hemiInt);
scene.add(hemiLight);
const sun = new THREE.DirectionalLight(ENV.sunCol, ENV.sunInt);
sun.position.set(...ENV.sunPos);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -40 * MSCALE;
sun.shadow.camera.right = 40 * MSCALE;
sun.shadow.camera.top = 40 * MSCALE;
sun.shadow.camera.bottom = -40 * MSCALE;
sun.shadow.camera.far = 130 * MSCALE;
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
  const S = ENV.sky;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  if (ENV.cloudy) {
    // 흐림·안개·비·폭우: 잿빛 덮개 — 밤/폭우일수록 어둡게
    const lum = TOD === 'night' ? 0.16 : WEATHER === 'storm' ? 0.42 : WEATHER === 'fog' ? 0.86 : 0.66;
    const tone = (l) => {
      const v = Math.round(255 * l);
      return `rgb(${v},${Math.round(v * 1.02)},${Math.round(v * 1.06)})`;
    };
    g.addColorStop(0.0, tone(lum * 0.55));
    g.addColorStop(0.45, tone(lum * 0.8));
    g.addColorStop(0.75, tone(lum));
    g.addColorStop(1.0, tone(lum * 1.08));
  } else {
    g.addColorStop(0.0, S.top);
    g.addColorStop(0.35, S.mid);
    g.addColorStop(0.62, S.low);
    g.addColorStop(1.0, S.bot);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  // 별 (맑은 밤에만)
  if (S.stars && !ENV.cloudy) {
    for (let i = 0; i < 340; i++) {
      const a = 0.25 + Math.random() * 0.75;
      ctx.fillStyle = `rgba(255,255,255,${(a * (1 - (i % 7) * 0.08)).toFixed(2)})`;
      const y = Math.random() * 300;
      ctx.fillRect(Math.random() * 1024, y, Math.random() < 0.12 ? 2 : 1, 1);
    }
  }
  // 태양(또는 달) 헤일로 — 구름 덮개에선 생략
  if (!ENV.cloudy) {
    const [hx, hy] = S.halo;
    const haloR = S.stars ? 120 : 220;
    const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, haloR);
    halo.addColorStop(0, `rgba(${S.haloCol},0.95)`);
    halo.addColorStop(0.25, `rgba(${S.haloCol},0.4)`);
    halo.addColorStop(1, `rgba(${S.haloCol},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 1024, 512);
    if (S.stars) { // 달 원반
      ctx.fillStyle = 'rgba(235,240,252,0.9)';
      ctx.beginPath(); ctx.arc(hx, hy, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(180,192,215,0.5)';
      ctx.beginPath(); ctx.arc(hx - 8, hy - 5, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx + 9, hy + 8, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 뭉게구름: 겹친 소프트 원 클러스터
  const cloud = (cx, cy, s, alpha, col = '255,255,255') => {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * s;
      const px = cx + Math.cos(a) * r * 1.9;
      const py = cy + Math.sin(a) * r * 0.55;
      const pr = s * (0.35 + Math.random() * 0.4);
      const cg = ctx.createRadialGradient(px, py, 0, px, py, pr);
      cg.addColorStop(0, `rgba(${col},${alpha})`);
      cg.addColorStop(0.7, `rgba(${col},${alpha * 0.55})`);
      cg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  if (ENV.cloudy && WEATHER !== 'fog') {
    // 낮게 깔린 먹구름 띠 — 폭우일수록 검고 조밀하게
    const dark = WEATHER === 'storm' ? '38,42,52' : '112,118,128';
    for (let i = 0; i < 11; i++) {
      cloud(50 + Math.random() * 924, 90 + Math.random() * 190,
        55 + Math.random() * 45, 0.3 + Math.random() * 0.25, dark);
    }
  } else if (!ENV.cloudy && TOD !== 'night') {
    cloud(160, 190, 55, 0.5);
    cloud(430, 130, 70, 0.42);
    cloud(840, 230, 48, 0.45);
    cloud(620, 300, 60, 0.3);
    cloud(80, 330, 42, 0.28);
  }
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
    new THREE.MeshBasicMaterial({ color: ENV.envGround })
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
ssaoPass.kernelRadius = 1.5;      // 더 넓게 — 접지·틈 음영 강하게
ssaoPass.minDistance = 0.0006;
ssaoPass.maxDistance = 0.22;
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
gradePass.uniforms.saturation.value = ENV.saturation;
gradePass.uniforms.warm.value.set(...ENV.warm);
composer.addPass(gradePass);
// AO 제외 레이어: 컷아웃 풀·수면·오버레이가 SSAO 노멀 패스에서
// 통짜 사각형으로 렌더되어 검은 헤일로를 만드는 것을 방지
const NO_AO_LAYER = 1;
camera.layers.enable(NO_AO_LAYER);
const noAO = (obj) => obj.traverse((o) => o.layers.set(NO_AO_LAYER));

// ── 바람: 식생 버텍스 셰이더에 살랑임 주입 (공유 시간 유니폼) ──
const windUniform = { value: 0 };
const windAmpUniform = { value: ENV.windAmp }; // 날씨별 흔들림 배율 (폭우 돌풍 등)
function addWind(mat, strength = 0.06, freq = 1.4) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindT = windUniform;
    shader.uniforms.uWindA = windAmpUniform;
    shader.vertexShader = ('uniform float uWindT;\nuniform float uWindA;\n' + shader.vertexShader).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float wPhase = position.x * 0.9 + position.z * 0.7;
        #ifdef USE_INSTANCING
          wPhase += instanceMatrix[3][0] * 0.45 + instanceMatrix[3][2] * 0.45;
        #endif
        // 높이(uv.y)에 비례해 끝만 크게 흔들린다 + 느린 큰 물결 + 빠른 잔떨림
        float wAmp = uv.y * uv.y;
        float sway = (sin(uWindT * ${freq.toFixed(2)} + wPhase) * ${strength.toFixed(3)}
                   + sin(uWindT * ${(freq * 2.7).toFixed(2)} + wPhase * 1.7) * ${(strength * 0.35).toFixed(3)}) * uWindA;
        transformed.x += sway * wAmp;
        transformed.z += sway * 0.6 * wAmp;
      }`
    );
  };
}
{
  const orig = ssaoPass.render.bind(ssaoPass);
  ssaoPass.render = (r, w, rd, dt, mask) => {
    camera.layers.disable(NO_AO_LAYER);
    orig(r, w, rd, dt, mask);
    camera.layers.enable(NO_AO_LAYER);
  };
}

// ── 비/폭우: 카메라 주위를 따라다니는 빗줄기 라인 파티클 + (폭우) 번개 ──
let rainGeo = null, rainGroup = null;
const RAIN_R = 44, RAIN_H = 34;
if (ENV.rainCount > 0) {
  const N = ENV.rainCount;
  const pos = new Float32Array(N * 6);
  const slantX = WEATHER === 'storm' ? 0.4 : 0.16;
  const len = WEATHER === 'storm' ? 1.15 : 0.7;
  for (let i = 0; i < N; i++) {
    const x = (Math.random() * 2 - 1) * RAIN_R;
    const y = Math.random() * RAIN_H;
    const z = (Math.random() * 2 - 1) * RAIN_R;
    pos.set([x, y, z, x + slantX * len, y - len, z + 0.08 * len], i * 6);
  }
  rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rainMat = new THREE.LineBasicMaterial({
    color: TOD === 'night' ? 0x6f88a8 : 0xbdd2e4,
    transparent: true, opacity: WEATHER === 'storm' ? 0.4 : 0.28,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(rainGeo, rainMat);
  lines.frustumCulled = false;
  rainGroup = new THREE.Group();
  rainGroup.add(lines);
  noAO(rainGroup);
  scene.add(rainGroup);
}
function updateRain(dt) {
  if (!rainGroup) return;
  rainGroup.position.set(controls.target.x, Math.max(-1, controls.target.y - 6), controls.target.z);
  const attr = rainGeo.attributes.position;
  const arr = attr.array;
  const fall = (WEATHER === 'storm' ? 30 : 21) * dt;
  const drift = (WEATHER === 'storm' ? 9 : 3.5) * dt;
  for (let i = 0; i < arr.length; i += 6) {
    arr[i + 1] -= fall; arr[i + 4] -= fall;
    arr[i] += drift; arr[i + 3] += drift;
    if (arr[i + 1] < 0) {
      const dx = arr[i + 3] - arr[i], dy = arr[i + 4] - arr[i + 1], dz = arr[i + 5] - arr[i + 2];
      const x = (Math.random() * 2 - 1) * RAIN_R;
      const z = (Math.random() * 2 - 1) * RAIN_R;
      arr[i] = x; arr[i + 1] = RAIN_H - Math.random() * 3; arr[i + 2] = z;
      arr[i + 3] = x + dx; arr[i + 4] = arr[i + 1] + dy; arr[i + 5] = z + dz;
    } else if (arr[i] > RAIN_R) {
      arr[i] -= RAIN_R * 2; arr[i + 3] -= RAIN_R * 2;
    }
  }
  attr.needsUpdate = true;
}
// 번개: 하늘 전체가 두세 번 깜빡 — 천둥은 거리감 있게 늦게 굴러온다
let lightningWait = ENV.lightning ? 4 + Math.random() * 9 : Infinity;
let flashLeft = 0;
function updateLightning(dt) {
  if (!ENV.lightning) return;
  if (flashLeft > 0) {
    flashLeft -= dt;
    const on = flashLeft > 0 && Math.sin(flashLeft * 55) > -0.35;
    hemiLight.intensity = ENV.hemiInt + (on ? 2.4 : 0);
    sun.intensity = ENV.sunInt + (on ? 1.2 : 0);
    if (flashLeft <= 0) { hemiLight.intensity = ENV.hemiInt; sun.intensity = ENV.sunInt; }
    return;
  }
  lightningWait -= dt;
  if (lightningWait <= 0) {
    lightningWait = 7 + Math.random() * 14;
    flashLeft = 0.2 + Math.random() * 0.2;
    setTimeout(() => sfx('thunder'), 500 + Math.random() * 1800);
  }
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
const inBounds = (gx, gz) => gx >= 0 && gx < GW && gz >= 0 && gz < GH;
const cellToWorld = (gx, gz) =>
  new THREE.Vector3((gx - (GW - 1) / 2) * TILE, 0, (gz - (GH - 1) / 2) * TILE);
function worldToCell(p) {
  return {
    gx: Math.max(0, Math.min(GW - 1, Math.round(p.x / TILE + (GW - 1) / 2))),
    gz: Math.max(0, Math.min(GH - 1, Math.round(p.z / TILE + (GH - 1) / 2))),
  };
}

// ---------------------------------------------------------------------------
// 지형 생성: 부드러운 하이트필드 + 하천 + 지형 종류
// ---------------------------------------------------------------------------
const VNW = GW * VRES, VNH = GH * VRES; // 하이트필드 분할 수 (축별)
const HALFW = (GW * TILE) / 2, HALFH = (GH * TILE) / 2;
const VSTEP = TILE / VRES;

const hNoise = makeNoise(10);
const hNoise2 = makeNoise(4.8);
const tNoise = makeNoise(8);
// 고주파 프랙탈 디테일 — 울퉁불퉁한 지면 + 강 테두리 불규칙화
const dNoise = makeNoise(2.4);
const dNoise2 = makeNoise(1.15);
const dNoise3 = makeNoise(0.6);
const bankNoise = makeNoise(5.0);   // 완만한 물가 사행 (저주파, 급경사 방지)
const bankNoise2 = makeNoise(1.6);  // 약간의 잔결

// 하천 경로: 스폰 지점과 겹치지 않을 때까지 리샘플링
let riverCx, riverAmp, riverPhase;
{
  let tries = 0;
  do {
    riverCx = 12 + rng() * (GW - 24);
    riverAmp = 4.5 + rng() * 3.5; // 휨 축소 — 느긋한 곡류
    riverPhase = rng() * Math.PI * 2;
    tries++;
  } while (
    tries < 40 &&
    [PLAYER_SPAWN, ...ENEMY_SPAWNS].some((s) => {
      const rx = riverCx + Math.sin(s.gz * 0.085 + riverPhase) * riverAmp;
      return Math.abs(rx - s.gx) < (s === PLAYER_SPAWN ? 8 : 6);
    })
  );
}
const riverPoints = [];
if (hasRiver) for (let zw = -HALFH; zw <= HALFH; zw += 0.5) {
  const gzf = zw / TILE + (GH - 1) / 2;
  const rx = riverCx + Math.sin(gzf * 0.085 + riverPhase) * riverAmp; // 사행 주기 완화
  riverPoints.push({ x: (rx - (GW - 1) / 2) * TILE, z: zw });
}
function distToRiver(wx, wz) {
  if (!hasRiver) return Infinity;
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
  const fx = (wx + HALFW) / TILE;
  const fz = (wz + HALFH) / TILE;
  const n = hNoise(fx, fz) * 0.72 + hNoise2(fx, fz) * 0.28;
  let h = n * 5.2 - 1.0;
  // 고주파 프랙탈 옥타브 — 표면을 자잘하게 울퉁불퉁하게
  h += (dNoise(fx, fz) - 0.5) * 0.72
     + (dNoise2(fx, fz) - 0.5) * 0.4
     + (dNoise3(fx, fz) - 0.5) * 0.22;
  return THREE.MathUtils.clamp(h, 0, 3.1);
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
  // 하천 카빙 — 물가를 완만한 저주파 노이즈로만 사행시키고(급경사 방지),
  // 강둑은 넓은 전이로 완만하게 올라간다. 얕은 선반(beach)을 거쳐 뭍으로.
  const fx = (wx + HALFW) / TILE, fz = (wz + HALFH) / TILE;
  const drRaw = distToRiver(wx, wz);
  const bankWobble = (bankNoise(fx, fz) - 0.5) * 2.0 + (bankNoise2(fx, fz) - 0.5) * 0.5;
  const dr = drRaw + bankWobble;
  if (dr < 15) {
    const gzf = wz / TILE + (GH - 1) / 2;
    const ford = smooth01((Math.sin(gzf * 0.275 + riverPhase * 2.3) - 0.38) / 0.3);
    // 강 폭 가변: 구간별 ~0.55×에서 최대 ~3.2×(기존의 2배)까지 —
    // 좁은 여울목과 훨씬 넓은 소(pool)가 생긴다
    const rw = Math.max(0.55,
      1.45 + Math.sin(gzf * 0.055 + riverPhase * 1.7) * 0.95
           + Math.sin(gzf * 0.026 + riverPhase * 4.1) * 0.8);
    const bedNoise = (dNoise2(fx, fz) - 0.5) * 0.15;
    const bed = -0.5 + ford * 0.26 + bedNoise;
    // 얕은 물가 선반: 수면 살짝 아래에서 완만하게 시작 (급격히 깎이지 않게)
    const shelf = -0.16 + bedNoise * 0.4;
    // 2단 전이: 강바닥 → 얕은 선반(짧고 완만) → 뭍(넓고 완만한 강둑)
    const tShelf = smooth01((dr - 0.3 * rw) / (2.4 * rw));  // 바닥→선반
    const tLand = smooth01((dr - 2.0 * rw) / 6.4);           // 선반→뭍 (넓게)
    const nearShore = THREE.MathUtils.lerp(bed, shelf, tShelf);
    h = THREE.MathUtils.lerp(nearShore, h, tLand);
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
const terrainGeo = new THREE.PlaneGeometry(GW * TILE, GH * TILE, VNW, VNH);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, fieldHeight(pos.getX(i), pos.getZ(i)));
}
const vIndex = (ix, iz) => iz * (VNW + 1) + ix;
function sampleHeight(wx, wz) {
  const fx = THREE.MathUtils.clamp((wx + HALFW) / VSTEP, 0, VNW - 1e-6);
  const fz = THREE.MathUtils.clamp((wz + HALFH) / VSTEP, 0, VNH - 1e-6);
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
for (let gx = 0; gx < GW; gx++) {
  cellH.push([]);
  terrain.push([]);
  for (let gz = 0; gz < GH; gz++) {
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
  const fx = (wx + HALFW) / TILE, fz = (wz + HALFH) / TILE;
  // at()가 인덱스를 클램프하므로 상한 걱정 없이 직접 샘플
  const tn = tNoise(fx - 0.5 + 7, fz - 0.5 + 3);
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
  const fx = (wx + HALFW) / TILE, fz = (wz + HALFH) / TILE;
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
// 조밀 하이트필드 — 지형 자체 캐스트는 끄고(섀도 패스 비용↓) 받기만 한다.
// 언덕 그림자는 SSAO/명암이 대체, 프랍·전차 그림자는 그대로 지면에 진다.
terrainMesh.castShadow = false;
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
  const shallow = { r: 148, g: 198, b: 184 };
  const mid = { r: 74, g: 142, b: 142 };
  const deep = { r: 40, g: 96, b: 104 };
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      // PlaneGeometry.rotateX(-PI/2) 기준: u→+x, 캔버스 행(py)→+z
      const wx = (px / (N - 1) - 0.5) * GW * TILE;
      const wz = (py / (N - 1) - 0.5) * GH * TILE;
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
      // 더 투명하게 — 얕은 곳은 바닥이 훤히 비치고 깊어도 은은히 비친다
      const a = Math.min(0.78, smooth01(depth / 0.12) * 0.22 + smooth01(depth / 0.4) * 0.44 + foam * 0.3) * 255;
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
// 윤슬 텍스처: 드문드문 반짝이는 점 — 이미시브로 수면 위를 흐른다
function makeSparkleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 130; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 0.4 + Math.random() * 0.7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.35 + Math.random() * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(13, 13);
  return tex;
}
const sparkleTex = makeSparkleTexture();
const waterMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(GW * TILE, GH * TILE),
  new THREE.MeshStandardMaterial({
    map: waterMaps.colorTex,
    alphaMap: waterMaps.alphaTex,
    normalMap: rippleTex,
    normalScale: new THREE.Vector2(0.38, 0.38),
    // 윤슬: 스크롤되는 반짝임 점 (리플 노멀과 다른 속도로 흘러 살아있는 수면)
    emissive: 0xfff6dd,
    emissiveMap: sparkleTex,
    emissiveIntensity: 0.34,
    transparent: true,
    depthWrite: false,
    roughness: 0.12,
    metalness: 0,
    envMapIntensity: 0.55,
  })
);
waterMesh.rotation.x = -Math.PI / 2;
waterMesh.position.y = WATER_Y;
noAO(waterMesh);
if (hasRiver) scene.add(waterMesh);

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
  for (let t = -HALFW; t < HALFW - 1e-6; t += step) {
    pushWall(t, -HALFH, t + step, -HALFH);
    pushWall(t + step, HALFH, t, HALFH);
  }
  for (let t = -HALFH; t < HALFH - 1e-6; t += step) {
    pushWall(-HALFW, t + step, -HALFW, t);
    pushWall(HALFW, t, HALFW, t + step);
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
  const base = part(new RoundedBoxGeometry(GW * TILE + 2.2, 1.6, GH * TILE + 2.2, 4, 0.3), 0x5c667a, { outline: false });
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
  for (let i = 0; i <= GW; i++) {
    const c = -HALFW + i * TILE;
    for (let sv = -HALFH; sv < HALFH - 1e-6; sv += step) {
      pts.push(c, yAt(c, sv), sv, c, yAt(c, sv + step), sv + step);
    }
  }
  for (let i = 0; i <= GH; i++) {
    const c = -HALFH + i * TILE;
    for (let sv = -HALFW; sv < HALFW - 1e-6; sv += step) {
      pts.push(sv, yAt(sv, c), c, sv + step, yAt(sv + step, c), c);
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
  // 2층 벽돌 건물: 2×2칸 점유, 프리컷 청크로 부분 파괴
  building: { hp: 200, blockMove: true, blockShotH: 3.2, coverH: 0,   cover: 0,   name: '벽돌 건물', footprint: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  rubble:   { hp: 35, blockMove: false, blockShotH: 0,   coverH: 0.9, cover: 0.6, name: '잔해', moveExtra: 1.6 },
  hedgehog: { hp: 40, blockMove: true,  blockShotH: 0,   coverH: 0.8, cover: 0.4, name: '대전차 장애물' },
  sandbag:  { hp: 26, blockMove: true,  blockShotH: 0,   coverH: 0.8, cover: 0.5, name: '모래주머니' },
};

// ---------------------------------------------------------------------------
// 프로시저럴 수목: 재귀 가지 스켈레톤(원통) + 가지에 겹쳐 얹는 잎 카드 쿼드.
// 종별 프로토타입 세트를 미리 구워 두고, 심을 때는 클론(지오메트리 공유)
// + 랜덤 크기/각도만 준다 — 나무당 드로콜 2(수피+잎).
// ---------------------------------------------------------------------------
// 잎 카드 텍스처: 잎 무리 실루엣 (흰색 → 재질 색으로 틴트)
function makeLeafCardTexture(needle = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.filter = 'blur(0.6px)';
  if (needle) {
    // 침엽: 중심 줄기에서 뻗는 바늘 다발
    ctx.strokeStyle = 'rgba(230,230,230,0.95)';
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const l = 18 + Math.random() * 12;
      ctx.lineWidth = 1.6 + Math.random();
      ctx.beginPath();
      ctx.moveTo(32, 34);
      ctx.lineTo(32 + Math.cos(a) * l, 34 + Math.sin(a) * l * 0.8);
      ctx.stroke();
    }
  } else {
    // 활엽: 작은 잎 타원 뭉치 (틈이 보이는 성근 실루엣)
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 22;
      const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r * 0.85;
      const s = 2.4 + Math.random() * 3.4;
      const v = 170 + Math.random() * 85;
      ctx.fillStyle = `rgba(${v},${v},${v},0.95)`;
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * 0.62, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}
const leafCardTex = makeLeafCardTexture(false);
const needleCardTex = makeLeafCardTexture(true);
const UP = new THREE.Vector3(0, 1, 0);
// 종별 재질 (잎은 바람 셰이더 적용)
function leafCardMat(color, needle = false) {
  const m = new THREE.MeshStandardMaterial({
    map: needle ? needleCardTex : leafCardTex, color,
    alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.92, envMapIntensity: 0,
  });
  addWind(m, 0.035, 1.8);
  return m;
}
const BARK_MATS = {
  oak: new THREE.MeshStandardMaterial({ color: 0x5f4a30, roughness: 0.95 }),
  birch: new THREE.MeshStandardMaterial({ color: 0xd3cfc1, roughness: 0.9 }),
  pine: new THREE.MeshStandardMaterial({ color: 0x54402c, roughness: 0.95 }),
  willow: new THREE.MeshStandardMaterial({ color: 0x6b5638, roughness: 0.95 }),
};
const LEAF_MATS = {
  oak: leafCardMat(0x5d7f3c), oak2: leafCardMat(0x71914a), autumn: leafCardMat(0xa8823c),
  birch: leafCardMat(0x86a352), willow: leafCardMat(0x8aa45e),
  pine: leafCardMat(0x3d5c33, true), pine2: leafCardMat(0x476b3a, true),
};
// 가지 스켈레톤 생성 → {barkGeo, leafGeo}
function genTreeGeometry(spec) {
  const barkGeos = [];
  const leafAnchors = []; // {p, s}
  const tmpO = new THREE.Object3D();
  const branch = (origin, dir, len, rad, depth) => {
    const end = origin.clone().addScaledVector(dir, len);
    const geo = new THREE.CylinderGeometry(Math.max(rad * 0.62, 0.012), rad, len, 5).toNonIndexed();
    tmpO.position.copy(origin).addScaledVector(dir, len / 2);
    tmpO.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    tmpO.updateMatrix();
    geo.applyMatrix4(tmpO.matrix);
    barkGeos.push(geo);
    if (depth >= spec.depth) {
      leafAnchors.push({ p: end, s: spec.leafSize * (0.85 + rng() * 0.5) });
      if (rng() < 0.7) leafAnchors.push({ p: origin.clone().lerp(end, 0.45), s: spec.leafSize * (0.7 + rng() * 0.4) });
      return;
    }
    const kids = spec.kids[0] + Math.floor(rng() * (spec.kids[1] - spec.kids[0] + 1));
    // 자식 가지를 부모 방향 둘레로 고르게(휘돌이) 분산 — 한쪽 쏠림 방지.
    // dir에 수직인 프레임(u,v)을 만들고 방위각 φ를 균등 분할해 원뿔로 벌린다.
    const u = new THREE.Vector3();
    if (Math.abs(dir.y) < 0.92) u.set(0, 1, 0).cross(dir).normalize();
    else u.set(1, 0, 0).cross(dir).normalize();
    const vv = dir.clone().cross(u).normalize();
    const basePhi = rng() * Math.PI * 2;
    for (let i = 0; i < kids; i++) {
      const phi = basePhi + (i / kids) * Math.PI * 2 + (rng() - 0.5) * (Math.PI / kids);
      const tilt = spec.spread * (0.78 + rng() * 0.5);
      const nd = dir.clone().multiplyScalar(Math.cos(tilt))
        .addScaledVector(u, Math.sin(tilt) * Math.cos(phi))
        .addScaledVector(vv, Math.sin(tilt) * Math.sin(phi));
      nd.y += spec.upBias;
      if (spec.droop) nd.y -= spec.droop * (depth + 1) * 0.5;
      nd.normalize();
      branch(end, nd, len * spec.lenK * (0.72 + rng() * 0.4), rad * 0.6, depth + 1);
    }
    // 가지 중간에도 잎을 겹쳐 무성하게
    if (depth >= spec.leafFrom) leafAnchors.push({ p: origin.clone().lerp(end, 0.65), s: spec.leafSize * (0.75 + rng() * 0.45) });
  };
  if (spec.pine) {
    // 침엽수: 곧은 줄기 + 높이별 방사형 가지 고리 (위로 갈수록 짧게)
    const th = spec.trunkLen;
    branchStraight(barkGeos, tmpO, new THREE.Vector3(0, 0, 0), th, spec.trunkRad);
    const rings = spec.rings ?? 5;
    for (let r = 0; r < rings; r++) {
      const hh = th * (0.32 + 0.62 * (r / (rings - 1)));
      const blen = spec.leafSize * 2.4 * (1 - (r / rings) * 0.72) + 0.15;
      const n = 6 - Math.floor(r * 0.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng();
        const dir = new THREE.Vector3(Math.cos(a), -0.12 - rng() * 0.1, Math.sin(a)).normalize();
        branch(new THREE.Vector3(0, hh, 0), dir, blen, spec.trunkRad * 0.3, spec.depth - 1);
      }
    }
    leafAnchors.push({ p: new THREE.Vector3(0, th + 0.1, 0), s: spec.leafSize });
  } else {
    branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3((rng() - 0.5) * 0.14, 1, (rng() - 0.5) * 0.14).normalize(), spec.trunkLen, spec.trunkRad, 0);
  }
  // 수피 병합
  let total = 0;
  for (const g of barkGeos) total += g.attributes.position.count;
  const bpos = new Float32Array(total * 3), bnor = new Float32Array(total * 3);
  let off = 0;
  for (const g of barkGeos) {
    bpos.set(g.attributes.position.array, off * 3);
    bnor.set(g.attributes.normal.array, off * 3);
    off += g.attributes.position.count;
    g.dispose();
  }
  const barkGeo = new THREE.BufferGeometry();
  barkGeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
  barkGeo.setAttribute('normal', new THREE.BufferAttribute(bnor, 3));
  // 잎 카드 병합: 앵커마다 랜덤 방향 쿼드 1~2장
  const lp = [], luv = [], lidx = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const a of leafAnchors) {
    const nCards = 1 + (rng() < 0.6 ? 1 : 0);
    for (let ci = 0; ci < nCards; ci++) {
      const s = a.s * (0.8 + rng() * 0.45);
      e.set((rng() - 0.5) * 1.2, rng() * Math.PI * 2, (rng() - 0.5) * 1.2);
      q.setFromEuler(e);
      corners[0].set(-s / 2, -s / 2, 0); corners[1].set(s / 2, -s / 2, 0);
      corners[2].set(s / 2, s / 2, 0); corners[3].set(-s / 2, s / 2, 0);
      const b = lp.length / 3;
      for (const cn of corners) {
        cn.applyQuaternion(q).add(a.p);
        lp.push(cn.x, cn.y, cn.z);
      }
      luv.push(0, 0, 1, 0, 1, 1, 0, 1);
      lidx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const leafGeo = new THREE.BufferGeometry();
  leafGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  leafGeo.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  leafGeo.setIndex(lidx);
  leafGeo.computeVertexNormals();
  return { barkGeo, leafGeo };
}
function branchStraight(barkGeos, tmpO, origin, len, rad) {
  const geo = new THREE.CylinderGeometry(rad * 0.5, rad, len, 6).toNonIndexed();
  tmpO.position.copy(origin); tmpO.position.y += len / 2;
  tmpO.quaternion.identity(); tmpO.updateMatrix();
  geo.applyMatrix4(tmpO.matrix);
  barkGeos.push(geo);
}
// 종 스펙 → 프로토타입 여러 세트 사전 생성
const TREE_SPECS = {
  oak:    { trunkLen: 0.8, trunkRad: 0.13, depth: 3, kids: [2, 3], spread: 0.65, upBias: 0.22, lenK: 0.72, leafFrom: 1, leafSize: 0.66, bark: 'oak', leaves: ['oak', 'oak2', 'autumn'] },
  birch:  { trunkLen: 1.15, trunkRad: 0.08, depth: 3, kids: [2, 2], spread: 0.5, upBias: 0.4, lenK: 0.66, leafFrom: 2, leafSize: 0.5, bark: 'birch', leaves: ['birch'] },
  willow: { trunkLen: 0.85, trunkRad: 0.12, depth: 3, kids: [2, 3], spread: 0.8, upBias: 0.05, droop: 0.55, lenK: 0.8, leafFrom: 1, leafSize: 0.58, bark: 'willow', leaves: ['willow'] },
  pine:   { trunkLen: 1.7, trunkRad: 0.1, depth: 2, kids: [1, 2], spread: 0.4, upBias: -0.05, lenK: 0.6, leafFrom: 0, leafSize: 0.5, pine: true, bark: 'pine', leaves: ['pine', 'pine2'] },
  // 키 큰 침엽수(전나무형) — 곧고 높이 솟는다
  fir:    { trunkLen: 2.9, trunkRad: 0.13, depth: 2, kids: [1, 2], spread: 0.38, upBias: -0.03, lenK: 0.58, leafFrom: 0, leafSize: 0.46, pine: true, rings: 8, bark: 'pine', leaves: ['pine', 'pine2'] },
};
const TREE_PROTOS = {}; // species -> [{barkGeo, leafGeo, leafMat}]
for (const [sp, spec] of Object.entries(TREE_SPECS)) {
  TREE_PROTOS[sp] = [];
  const variants = sp === 'oak' ? 3 : 2;
  for (let v = 0; v < variants; v++) {
    const g = genTreeGeometry(spec);
    g.leafMat = LEAF_MATS[spec.leaves[Math.floor(rng() * spec.leaves.length)]];
    g.barkMat = BARK_MATS[spec.bark];
    TREE_PROTOS[sp].push(g);
  }
}
// 덤불용 플랫 셰이딩 잎 덩이 (캐시)
const foliageCache = new Map();
function foliageMat(color) {
  if (!foliageCache.has(color)) {
    foliageCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
  }
  return foliageCache.get(color);
}
function leafPart(geo, color) {
  const m = new THREE.Mesh(geo, foliageMat(color));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const speciesNoise = makeNoise(9); // 저주파 — 수종 군락 크기
function buildTreeMesh(gx = 0, gz = 0) {
  // 수종 선택: 저주파 수종 노이즈로 "비슷한 나무끼리 군락"을 이룬다.
  // 강가(2.5칸 이내)는 버드나무/자작 위주.
  const p = cellToWorld(gx, gz);
  const nearRiver = distToRiver(p.x, p.z) < 2.5;
  const sn = speciesNoise(gx + 3, gz + 5); // 0..1, 위치별 완만 변화 → 군락
  let sp;
  if (nearRiver) {
    sp = sn < 0.5 ? 'willow' : sn < 0.8 ? 'birch' : 'oak';
  } else {
    // 노이즈 대역별 우점종: 참나무숲 / 침엽수림(소나무·전나무) / 자작나무숲
    if (sn < 0.36) sp = rng() < 0.85 ? 'oak' : 'birch';
    else if (sn < 0.68) sp = rng() < 0.55 ? 'pine' : rng() < 0.6 ? 'fir' : 'oak';
    else sp = rng() < 0.7 ? 'birch' : 'willow';
  }
  const proto = TREE_PROTOS[sp][Math.floor(rng() * TREE_PROTOS[sp].length)];
  const g = new THREE.Group();
  const bark = new THREE.Mesh(proto.barkGeo, proto.barkMat);
  const leaf = new THREE.Mesh(proto.leafGeo, proto.leafMat);
  bark.castShadow = true; bark.receiveShadow = true;
  leaf.castShadow = true;
  leaf.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: proto.leafMat.map, alphaTest: 0.38,
  });
  g.add(bark, leaf);
  g.userData.shared = true; // 지오메트리 공유 — mergeStatic 금지
  return g;
}
function buildBushMesh() {
  const g = new THREE.Group();
  const cols = [0x5c8a40, 0x6b9848, 0x4d7534, 0x86823c, 0x74994c];
  const clumps = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < clumps; i++) {
    const ang = rng() * Math.PI * 2, rad = rng() * 0.36;
    const s = 0.26 + rng() * 0.24;
    const c = leafPart(new THREE.IcosahedronGeometry(s, 0), cols[Math.floor(rng() * cols.length)]);
    c.position.set(Math.cos(ang) * rad, 0.2 + rng() * 0.22, Math.sin(ang) * rad);
    c.scale.set(1 + rng() * 0.35, 0.72 + rng() * 0.26, 1 + rng() * 0.35);
    c.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(c);
  }
  return g;
}
// 벽돌 벽 텍스처: 어긋쌓기 벽돌 + 모르타르 줄눈 + 개체 색 변주/풍화
// 벽돌 텍스처 (팔레트 파라미터) — 어긋쌓기 + 모르타르 줄눈 + 풍화
function makeBrickTexture(pal = {}) {
  const { mortar = '#5f4a3c', gMul = 0.62, bMul = 0.46, base = 120, vary = 55 } = pal;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, 256, 256);
  const rows = 13, bh = 256 / rows, bw = 256 / 6;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let cx = -1; cx < 7; cx++) {
      const x = cx * bw + off + 1.5, y = r * bh + 1.5;
      const b0 = base + Math.random() * vary;
      ctx.fillStyle = `rgb(${b0 | 0},${(b0 * (gMul + Math.random() * 0.12)) | 0},${(b0 * (bMul + Math.random() * 0.12)) | 0})`;
      ctx.fillRect(x, y, bw - 3, bh - 3);
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
// 회벽(플라스터): 얼룩 + 세로 빗물 자국 (WW1 프랑스/벨기에 농촌)
function makePlasterTexture(tone = 226) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${tone},${tone - 6},${tone - 18})`;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 1 + Math.random() * 5;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(120,108,88,0.06)' : 'rgba(255,255,250,0.05)';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  // 빗물 세로 줄
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 256, y0 = Math.random() * 90;
    ctx.fillStyle = `rgba(96,86,70,${0.04 + Math.random() * 0.07})`;
    ctx.fillRect(x, y0, 1.5 + Math.random() * 2, 60 + Math.random() * 160);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
// 석벽: 불규칙 큰 블록
function makeStoneWallTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4c463e';
  ctx.fillRect(0, 0, 256, 256);
  const rows = 7, bh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -(Math.random() * 30);
    while (x < 256) {
      const w = 26 + Math.random() * 40;
      const v = 122 + Math.random() * 46;
      ctx.fillStyle = `rgb(${v | 0},${(v * 0.96) | 0},${(v * 0.88) | 0})`;
      ctx.beginPath();
      ctx.roundRect(x + 1.5, r * bh + 1.5, w - 3, bh - 3, 3);
      ctx.fill();
      x += w;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
// 지붕 기와 텍스처 (팔레트 파라미터: 슬레이트 청회 / 점토 적갈)
function makeSlateTexture(pal = {}) {
  const { bg = '#50555e', v0 = 96, vv = 54, rMul = 1, gMul = 1.03, bMul = 1.12 } = pal;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);
  const rows = 15, th = 256 / rows, tw = 256 / 9;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (tw / 2);
    for (let cx = -1; cx < 10; cx++) {
      const x = cx * tw + off, y = r * th;
      const v = v0 + Math.random() * vv;
      ctx.fillStyle = `rgb(${(v * rMul) | 0},${(v * gMul) | 0},${(v * bMul) | 0})`;
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
// 벽/지붕 재질 사전 (스타일 → 재질)
const WALL_MATS = {
  brickRed: brickMat,
  brickBrown: new THREE.MeshStandardMaterial({ map: makeBrickTexture({ mortar: '#544838', base: 96, vary: 40, gMul: 0.74, bMul: 0.56 }), roughness: 0.95, color: 0xb0a693, side: THREE.DoubleSide }),
  plaster: new THREE.MeshStandardMaterial({ map: makePlasterTexture(228), roughness: 0.9, side: THREE.DoubleSide }),
  plasterOchre: new THREE.MeshStandardMaterial({ map: makePlasterTexture(214), color: 0xd9c49a, roughness: 0.9, side: THREE.DoubleSide }),
  stone: new THREE.MeshStandardMaterial({ map: makeStoneWallTexture(), roughness: 0.97, side: THREE.DoubleSide }),
};
const ROOF_MATS = {
  slate: slateMat,
  tile: new THREE.MeshStandardMaterial({ map: makeSlateTexture({ bg: '#5c3a2c', v0: 120, vv: 50, rMul: 1.18, gMul: 0.72, bMul: 0.52 }), roughness: 0.92 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6f5334, roughness: 0.95 }),
};
const timberMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 }); // 하프팀버 보
const shutterMat = new THREE.MeshStandardMaterial({ color: 0x3d5a40, roughness: 0.85 }); // 덧창
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

// ---------------------------------------------------------------------------
// 2층 벽돌 건물 — 프리컷 청크 구조.
// 벽/지붕/창을 작은 청크 상자로 미리 잘라 두고 재질별로 병합(bake)해 그린다.
// 피격 시 착탄 반경의 청크만 떼어 물리 낙하 → 남은 청크로 재병합 = 부분 파괴.
// ---------------------------------------------------------------------------
const trimMat = new THREE.MeshStandardMaterial({ color: 0xd8cbb0, roughness: 0.85 });
const shopMats = [
  new THREE.MeshStandardMaterial({ color: 0x2f5d43, roughness: 0.8 }), // 부티크 그린
  new THREE.MeshStandardMaterial({ color: 0x6d3630, roughness: 0.8 }), // 와인 레드
  new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: 0.8 }), // 네이비
];
// 1·2차 대전 유럽 시골/시가지 건물 30종: 벽 5종(적벽돌/갈벽돌/회벽/황토회벽/석벽)
// × 층수 1~3 × 지붕 2종(박공/평지붕 파라펫) — 회벽엔 하프팀버 보와 덧창이 붙기도.
const BUILDING_STYLES = [];
for (const wall of ['brickRed', 'brickBrown', 'plaster', 'plasterOchre', 'stone']) {
  for (const stories of [1, 2, 3]) {
    for (const roof of ['gable', 'flat']) {
      BUILDING_STYLES.push({ wall, stories, roof });
    }
  }
}
function buildBuildingMesh() {
  const style = BUILDING_STYLES[Math.floor(rng() * BUILDING_STYLES.length)];
  const wallMat = WALL_MATS[style.wall];
  const roofMat = style.wall.startsWith('brick') ? ROOF_MATS.tile : ROOF_MATS.slate;
  const isPlaster = style.wall.startsWith('plaster');
  const timber = isPlaster && style.stories <= 2 && rng() < 0.5; // 하프팀버
  const shutters = isPlaster && rng() < 0.6;                      // 덧창
  const g = new THREE.Group();
  const chunks = [];
  const tmp = new THREE.Object3D();
  const addChunk = (w, h, d, x, y, z, mat, ry = 0, rx = 0) => {
    tmp.position.set(x, y, z);
    tmp.rotation.set(rx, ry, 0);
    tmp.updateMatrix();
    chunks.push({
      size: [w, h, d], mat, matrix: tmp.matrix.clone(),
      center: new THREE.Vector3(x, y, z), dead: false,
    });
  };
  const W = 2.7 + rng() * 0.6, D = 2.0 + rng() * 0.4, WT = 0.18;
  const RH = 0.56;
  const ROWS = style.stories * 2;        // 층당 2단
  const shop = style.stories >= 2 && rng() < 0.35;
  const shopMat = shopMats[Math.floor(rng() * shopMats.length)];
  const walls = [
    { len: W, ry: 0, ox: 0, oz: D / 2 - WT / 2, front: true },
    { len: W, ry: 0, ox: 0, oz: -D / 2 + WT / 2, front: false },
    { len: D, ry: Math.PI / 2, ox: W / 2 - WT / 2, oz: 0, front: false },
    { len: D, ry: Math.PI / 2, ox: -W / 2 + WT / 2, oz: 0, front: false },
  ];
  for (const wall of walls) {
    const cols = Math.round(wall.len / 0.6);
    const cw = wall.len / cols;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < cols; c++) {
        const along = -wall.len / 2 + (c + 0.5) * cw;
        const x = wall.ry ? wall.ox : along;
        const z = wall.ry ? along : wall.oz;
        const y = (r + 0.5) * RH;
        const isDoor = wall.front && r === 0 && c === Math.floor(cols / 2);
        const isWin = !isDoor && r % 2 === 1 && c % 2 === 1; // 각 층 상단열 홀수 칸
        if (isDoor) {
          addChunk(cw * 0.94, RH, WT + 0.04, x, y, z, shop ? shopMat : trimMat, wall.ry);
        } else if (isWin) {
          addChunk(cw * 0.9, RH * 0.92, WT * 0.5, x, y, z, glassMat, wall.ry);
          addChunk(cw * 0.94, RH * 0.2, WT + 0.03, x, y + RH * 0.42, z, trimMat, wall.ry);
          if (shutters && !wall.ry) {
            // 좌우 덧창 (짙은 초록)
            const sdx = cw * 0.55;
            addChunk(cw * 0.16, RH * 0.8, WT * 0.5, x - sdx, y, z + (wall.front ? 0.02 : -0.02), shutterMat, wall.ry);
            addChunk(cw * 0.16, RH * 0.8, WT * 0.5, x + sdx, y, z + (wall.front ? 0.02 : -0.02), shutterMat, wall.ry);
          }
        } else if (shop && wall.front && r === 0) {
          addChunk(cw, RH, WT, x, y, z, shopMat, wall.ry);
        } else {
          addChunk(cw, RH, WT, x, y, z, wallMat, wall.ry);
          if (timber && !wall.ry && r > 0 && c % 2 === 0) {
            // 하프팀버: 전/후면에 어두운 세로 보 + 층 사이 가로 보
            addChunk(0.07, RH, WT * 0.4, x, y, z + (wall.front ? 0.06 : -0.06), timberMat, wall.ry);
          }
        }
      }
      // 층 경계 가로 보
      if (timber && r % 2 === 1) {
        addChunk(W * 0.98, 0.07, WT * 0.4, 0, (r + 1) * RH, D / 2 - WT / 2 + 0.06, timberMat, 0);
        addChunk(W * 0.98, 0.07, WT * 0.4, 0, (r + 1) * RH, -D / 2 + WT / 2 - 0.06, timberMat, 0);
      }
    }
  }
  const H = ROWS * RH;
  if (shop) addChunk(W * 0.96, 0.22, WT + 0.08, 0, RH * 2 + 0.1, D / 2 - WT / 2, trimMat, 0);
  if (style.roof === 'gable') {
    // 박공(계단식) + 기와/슬레이트 경사면
    const RHT = 0.62 + style.stories * 0.14;
    const gsteps = 4;
    for (const sx of [-1, 1]) {
      for (let s2 = 0; s2 < gsteps; s2++) {
        // 박공 계단이 지붕 경사면 아래에 딱 맞게 — 지붕을 뚫고 나오지 않는다.
        // 해당 단의 상단 높이에서 지붕 반깊이보다 살짝 안쪽으로.
        const topT = (s2 + 1) / gsteps;
        const halfD = (D / 2 + 0.15) * (1 - topT) - 0.04;
        addChunk(WT, RHT / gsteps, Math.max(0.16, halfD * 2), sx * (W / 2 - WT / 2), H + (s2 + 0.5) * (RHT / gsteps), 0, wallMat, 0);
      }
    }
    const slopeLen = Math.hypot(D / 2 + 0.15, RHT);
    const slabsA = 5, slabsB = 2;
    for (const sz of [-1, 1]) {
      const ang = sz * Math.atan2(RHT, D / 2 + 0.15);
      for (let a = 0; a < slabsA; a++) {
        for (let b = 0; b < slabsB; b++) {
          const alongW = -W / 2 - 0.12 + (a + 0.5) * ((W + 0.24) / slabsA);
          const alongS = (b + 0.5) / slabsB;
          addChunk((W + 0.24) / slabsA - 0.02, 0.07, slopeLen / slabsB,
            alongW, H + RHT * alongS, sz * (D / 2 + 0.15) * (1 - alongS), roofMat, 0, ang);
        }
      }
    }
    addChunk(0.26, 0.5, 0.26, W * 0.28, H + RHT + 0.2, 0, wallMat, 0);
    g.userData.height = H + RHT + 0.45;
  } else {
    // 평지붕: 슬랩 + 파라펫 (시가지 상가/창고 느낌)
    const slabs = 4;
    for (let a = 0; a < slabs; a++) {
      addChunk(W / slabs - 0.02, 0.1, D - 0.06, -W / 2 + (a + 0.5) * (W / slabs), H + 0.05, 0, ROOF_MATS.wood, 0);
    }
    for (const [len, ry, ox, oz] of [[W, 0, 0, D / 2 - 0.07], [W, 0, 0, -D / 2 + 0.07], [D, Math.PI / 2, W / 2 - 0.07, 0], [D, Math.PI / 2, -W / 2 + 0.07, 0]]) {
      const segs = Math.round(len / 0.75);
      for (let a = 0; a < segs; a++) {
        const along = -len / 2 + (a + 0.5) * (len / segs);
        addChunk(len / segs - 0.02, 0.22, 0.14, ry ? ox : along, H + 0.21, ry ? along : oz, wallMat, ry);
      }
    }
    addChunk(0.26, 0.45, 0.26, -W * 0.3, H + 0.35, -D * 0.2, wallMat, 0);
    g.userData.height = H + 0.55;
  }
  g.userData.chunks = chunks;
  return g;
}

// 남은 청크를 재질별 단일 지오메트리로 병합해 다시 그린다 (부분 파괴 후 재호출)
function bakeChunkProp(prop) {
  for (const m of prop.baked ?? []) { prop.group.remove(m); m.geometry.dispose(); }
  prop.baked = [];
  const byMat = new Map();
  for (const ch of prop.chunks) {
    if (ch.dead) continue;
    if (!byMat.has(ch.mat)) byMat.set(ch.mat, []);
    byMat.get(ch.mat).push(ch);
  }
  prop._sootMats ??= new Map();
  for (const [mat0, chs] of byMat) {
    // 화재 그을음: 이 건물 전용 어두운 재질 클론으로 교체해 병합
    let mat = mat0;
    if (prop._soot) {
      if (!prop._sootMats.has(mat0)) {
        const dm = mat0.clone();
        if (dm.color) dm.color.multiplyScalar(0.45);
        dm.roughness = 1;
        prop._sootMats.set(mat0, dm);
      }
      mat = prop._sootMats.get(mat0);
    }
    const geos = [];
    for (const ch of chs) {
      if (!ch._ngeo) ch._ngeo = new THREE.BoxGeometry(...ch.size).toNonIndexed();
      const g2 = ch._ngeo.clone();
      g2.applyMatrix4(ch.matrix);
      geos.push(g2);
    }
    let total = 0;
    for (const g2 of geos) total += g2.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    let off = 0;
    for (const g2 of geos) {
      pos.set(g2.attributes.position.array, off * 3);
      nor.set(g2.attributes.normal.array, off * 3);
      uv.set(g2.attributes.uv.array, off * 2);
      off += g2.attributes.position.count;
      g2.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    prop.group.add(mesh);
    prop.baked.push(mesh);
  }
}

// 떼어진 청크들을 물리 낙하 데브리로 — 착탄점에서 바깥으로 튄다
function spawnChunkDebris(prop, chunks, impact) {
  prop.group.updateMatrixWorld(true);
  const pieces = [];
  const m = new THREE.Matrix4();
  for (const ch of chunks) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...ch.size), ch.mat);
    m.multiplyMatrices(prop.group.matrixWorld, ch.matrix);
    m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.castShadow = true;
    scene.add(mesh);
    const dir = mesh.position.clone().sub(impact);
    dir.y = Math.abs(dir.y) * 0.4 + 0.4;
    if (dir.lengthSq() < 0.01) dir.set(rng() - 0.5, 1, rng() - 0.5);
    dir.normalize();
    pieces.push({
      mesh,
      vel: dir.multiplyScalar(2.2 + Math.random() * 3.2).add(new THREE.Vector3(0, 1.6 + Math.random() * 1.8, 0)),
      spin: new THREE.Vector3(Math.random() * 9 - 4.5, Math.random() * 9 - 4.5, Math.random() * 9 - 4.5),
    });
  }
  const floorY = sampleHeight(prop.group.position.x, prop.group.position.z);
  const dtOf = kDt(1500);
  tween(1500, (e, rawK) => {
    const dt = dtOf(rawK);
    for (const p of pieces) {
      p.vel.y -= 15 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < floorY + 0.1) {
        p.mesh.position.y = floorY + 0.1;
        p.vel.y *= -0.3; p.vel.x *= 0.72; p.vel.z *= 0.72;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (rawK > 0.78) p.mesh.scale.multiplyScalar(Math.pow(0.92, dt / 0.016));
    }
  }, linear).then(() => pieces.forEach((p) => { scene.remove(p.mesh); p.mesh.geometry.dispose(); }));
}
function buildRubbleMesh() {
  const g = new THREE.Group();
  // 부서진 콘크리트/석재 덩이 (각진 이코사면)
  const concrete = [0x9a9285, 0x847c70, 0xa8a091, 0x736c62];
  for (let i = 0; i < 5; i++) {
    const s = 0.24 + rng() * 0.28;
    const chunk = part(new THREE.IcosahedronGeometry(s, 0), concrete[Math.floor(rng() * concrete.length)]);
    chunk.position.set((rng() - 0.5) * 1.1, 0.1 + rng() * 0.22, (rng() - 0.5) * 1.1);
    chunk.scale.set(1 + rng() * 0.5, 0.5 + rng() * 0.4, 1 + rng() * 0.5);
    chunk.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(chunk);
  }
  // 부서진 벽돌 조각 (벽돌 붉은 톤 작은 상자)
  const brickCols = [0x9a5540, 0xa8654a, 0x8a4c38, 0xb07050];
  for (let i = 0; i < 6; i++) {
    const b = part(new THREE.BoxGeometry(0.2 + rng() * 0.12, 0.09, 0.1), brickCols[Math.floor(rng() * brickCols.length)]);
    b.position.set((rng() - 0.5) * 1.2, 0.05 + rng() * 0.16, (rng() - 0.5) * 1.2);
    b.rotation.set((rng() - 0.5) * 0.6, rng() * Math.PI, (rng() - 0.5) * 0.6);
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
  tree: buildTreeMesh, bush: buildBushMesh, house: buildHouseMesh, building: buildBuildingMesh,
  rubble: buildRubbleMesh, hedgehog: buildHedgehogMesh, sandbag: buildSandbagMesh,
};

function placeProp(type, gx, gz) {
  const def = PROP_DEF[type];
  const group = PROP_BUILDERS[type](gx, gz);
  // 다중 칸 풋프린트: 점유 칸 전부에 프랍을 등록, 그룹은 풋프린트 중심에
  const foot = def.footprint ?? [[0, 0]];
  const cells = foot.map(([dx, dz]) => cellKey(gx + dx, gz + dz));
  const cgx = gx + (foot.length > 1 ? 0.5 : 0);
  const cgz = gz + (foot.length > 1 ? 0.5 : 0);
  const p = cellToWorld(cgx, cgz);
  let baseY = -Infinity;
  for (const [dx, dz] of foot) baseY = Math.max(baseY, heightAt(gx + dx, gz + dz));
  group.position.set(p.x, baseY, p.z);
  // 건물은 축 정렬(90° 단위), 나머지는 자유 회전
  group.rotation.y = foot.length > 1 ? Math.floor(rng() * 4) * (Math.PI / 2) : rng() * Math.PI * 2;
  // 수목/덤불은 개체마다 크기 변주 — 같은 종이라도 들쭉날쭉
  if (type === 'tree') group.scale.setScalar(0.82 + rng() * 0.55);
  else if (type === 'bush') group.scale.setScalar(0.85 + rng() * 0.5);
  // 클릭 판정용 히트박스
  // 경사면 위 건물: 바닥 아래 빈 공간을 "다진 흙 기단 + 井자 목재 크립"으로
  // 지면까지 메꾼다 — 기단은 최저 지면보다 더 깊이 파고들어 어느 면에서도
  // 뜨지 않고, 노출된 옆면은 침목을 어긋나게 쌓은 크립이 감싼다.
  if (foot.length > 1) {
    let minH = Infinity;
    for (const [dx, dz] of foot) minH = Math.min(minH, heightAt(gx + dx, gz + dz));
    const gap = baseY - minH;
    if (gap > 0.14) {
      const earthMat = new THREE.MeshStandardMaterial({ color: 0x6b5334, roughness: 1, envMapIntensity: 0 });
      const timberMat = new THREE.MeshStandardMaterial({ color: 0x6a4c2e, roughness: 0.95 });
      const H = gap + 0.55; // 밑단이 최저 지면보다 0.4+ 아래 — 틈 없음
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.3, H, 2.5), earthMat);
      plinth.position.y = -H / 2 + 0.06;
      plinth.castShadow = true; plinth.receiveShadow = true;
      group.add(plinth);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(3.7, H * 0.45, 2.9), earthMat);
      skirt.position.y = -H + H * 0.225 + 0.06; // 바닥쪽 더 넓은 단 — 다진 흙 둔덕
      skirt.castShadow = true; skirt.receiveShadow = true;
      group.add(skirt);
      // 井자 침목 크립: 층마다 방향을 어긋 쌓아 노출면을 감싼다
      const layers = Math.min(9, Math.ceil(gap / 0.19) + 1);
      for (let li = 0; li < layers; li++) {
        const y = -0.06 - li * 0.19;
        if (li % 2 === 0) {
          for (const s of [-1, 1]) {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(3.62, 0.15, 0.17), timberMat);
            beam.position.set(0, y, s * 1.3);
            beam.rotation.y = (rng() - 0.5) * 0.03;
            beam.castShadow = true;
            group.add(beam);
          }
        } else {
          for (const s of [-1, 1]) {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.15, 2.82), timberMat);
            beam.position.set(s * 1.72, y, 0);
            beam.rotation.y = (rng() - 0.5) * 0.03;
            beam.castShadow = true;
            group.add(beam);
          }
        }
      }
    }
  }
  const bh = group.userData.height ?? 3.4; // 건물별 실제 높이
  const hit = foot.length > 1
    ? new THREE.Mesh(new THREE.BoxGeometry(3.4, bh, 3.4), new THREE.MeshBasicMaterial({ visible: false }))
    : new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.4, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = foot.length > 1 ? bh / 2 : 1.2;
  group.add(hit);
  scene.add(group);
  const prop = { type, def, gx, gz, hp: def.hp, group, hit, cells, blockShotH: group.userData.height ?? null };
  if (group.userData.chunks) {
    // 프리컷 청크 건물: 자체 bake (부분 파괴를 위해 mergeStatic 대신)
    prop.chunks = group.userData.chunks;
    prop.baked = [];
    bakeChunkProp(prop);
  } else if (!group.userData.shared) {
    // 프로토타입 공유 수목은 병합 금지(지오메트리 복제 방지) — 이미 2드로
    mergeStatic(group, [hit]); // 드로콜 절감: 프랍 메시 재질별 병합
  }
  hit.userData.prop = prop;
  for (const k of cells) props.set(k, prop);
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
  const TREE_MAX = Math.round(74 * AREA_F);
  for (let gx = 0; gx < GW && trees < TREE_MAX; gx++) {
    for (let gz = 0; gz < GH && trees < TREE_MAX; gz++) {
      if (!free(gx, gz)) continue;
      if (terrainAt(gx, gz) !== T.GRASS) continue;
      const f = fNoise(gx, gz);
      if (f > 0.62 && rng() < 0.65) { placeProp('tree', gx, gz); trees++; }
      else if (f > 0.5 && rng() < 0.16) { placeProp('bush', gx, gz); }
    }
  }
  // 강가 수목: 물가 1.2~2.8칸 띠에 버드나무/자작이 드문드문 늘어선다
  {
    let riverTrees = 0, guard = 0;
    const RT_MAX = hasRiver ? Math.round(16 * AREA_F) : 0;
    while (riverTrees < RT_MAX && guard++ < 3000) {
      const gx = 1 + Math.floor(rng() * (GW - 2)), gz = 1 + Math.floor(rng() * (GH - 2));
      if (!free(gx, gz) || terrainAt(gx, gz) === T.WATER) continue;
      const p = cellToWorld(gx, gz);
      const d = distToRiver(p.x, p.z);
      if (d < 1.1 || d > 2.8) continue;
      if (heightAt(gx, gz) < WATER_Y + 0.03) continue;
      placeProp('tree', gx, gz);
      riverTrees++;
    }
  }
  const scatter = (type, count, pred = () => true) => {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 600) {
      const gx = Math.floor(rng() * GW), gz = Math.floor(rng() * GH);
      if (!free(gx, gz) || !pred(gx, gz)) continue;
      placeProp(type, gx, gz);
      placed++;
    }
  };
  // 2층 벽돌 건물 (2×2칸): 평평하고 4칸 모두 빈 자리에 — 레퍼런스처럼
  // 벽돌 건물이 주가 되고 작은 농가는 보조
  {
    let placedB = 0, guard = 0;
    const BLD_MAX = Math.round(7 * AREA_F);
    while (placedB < BLD_MAX && guard++ < 2600) {
      const gx = 1 + Math.floor(rng() * (GW - 3)), gz = 1 + Math.floor(rng() * (GH - 3));
      const foot = PROP_DEF.building.footprint;
      if (!foot.every(([dx, dz]) => free(gx + dx, gz + dz) && terrainAt(gx + dx, gz + dz) !== T.MUD)) continue;
      let hMin = Infinity, hMax = -Infinity;
      for (const [dx, dz] of foot) {
        const h = heightAt(gx + dx, gz + dz);
        hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
      }
      if (hMax - hMin > 0.45 || hMax > 1.8) continue; // 평평한 곳만
      placeProp('building', gx, gz);
      placedB++;
    }
  }
  scatter('house', 4, (x, z) => terrainAt(x, z) !== T.MUD && heightAt(x, z) <= 1.5);
  scatter('hedgehog', 13);
  scatter('sandbag', 10);
  scatter('bush', 11);
}

// ---------------------------------------------------------------------------
// 리얼 디테일 스캐터: 풀 포기(교차 쿼드 컷아웃) + 흙 자갈 — 인스턴싱으로
// 드로콜 각 1회. 배치는 연속 지형 가중치를 따라 풀밭/흙 위에만.
// ---------------------------------------------------------------------------
const decorMeshes = []; // 풀/꽃/낙엽/잔가지 — 디버그 토글용
let grassBurnData = null;   // 화재용 풀 인스턴스 좌표
const grassBurnt = new Set();
{
  // 스태틱 그래스 텍스처: 가는 잎 다발 + 밑동 어둡고 끝 밝은 세로 그라데이션.
  // 흰색으로 그려 instanceColor로 톤을 입히면 밑동 그늘/끝 하이라이트가 자연스럽다.
  const grassTexCanvas = document.createElement('canvas');
  grassTexCanvas.width = grassTexCanvas.height = 128;
  {
    const ctx = grassTexCanvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    // 잎 가장자리를 살짝 흐리게 + 가닥을 훨씬 촘촘히(26) — 얼기설기 해소.
    // 가닥마다 밝기를 달리 베이크해 카드 하나가 "풀 포기"로 읽힌다.
    ctx.filter = 'blur(1px)';
    for (let i = 0; i < 26; i++) {
      const bx = 6 + rng() * 116;
      const lean = (rng() - 0.5) * 34;
      const hgt = 62 + rng() * 58;
      const wdt = 1.4 + rng() * 2.0;
      const tipY = 128 - hgt;
      const tone = 0.68 + rng() * 0.5; // 가닥별 밝기 변주
      const grad = ctx.createLinearGradient(0, 128, 0, tipY);
      grad.addColorStop(0, `rgba(${100 * tone | 0},${104 * tone | 0},${92 * tone | 0},1)`);
      grad.addColorStop(0.55, `rgba(${158 * tone | 0},${162 * tone | 0},${142 * tone | 0},1)`);
      grad.addColorStop(1, `rgba(${198 * tone | 0},${200 * tone | 0},${176 * tone | 0},1)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(bx - wdt, 128);
      ctx.quadraticCurveTo(bx - wdt * 0.35 + lean * 0.4, 128 - hgt * 0.55, bx + lean, tipY);
      ctx.quadraticCurveTo(bx + wdt * 0.45 + lean * 0.4, 128 - hgt * 0.55, bx + wdt, 128);
      ctx.fill();
    }
    // 하단 알파 페이드: 지면과 만나는 밑동을 부드럽게
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'destination-out';
    const fade = ctx.createLinearGradient(0, 128, 0, 94);
    fade.addColorStop(0, 'rgba(0,0,0,0.85)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 94, 128, 34);
    ctx.globalCompositeOperation = 'source-over';
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
  // 전반적으로 낮은 채도·명도로 — 배경으로 가라앉아 눈에 덜 띄게
  const grassTone = (dry, out) => {
    const r = rng();
    if (dry < 0.34) {
      // 싱싱한 초록 ~ 짙은 올리브
      out.setHSL(0.25 + rng() * 0.05, 0.28 + rng() * 0.16, 0.2 + rng() * 0.1);
    } else if (dry < 0.62) {
      // 황록 전이대
      out.setHSL(0.18 + rng() * 0.05, 0.3 + rng() * 0.14, 0.28 + rng() * 0.1);
    } else if (r < 0.78) {
      // 마른 밀짚/누런 풀 (가장 밝던 톤 — 크게 낮춤)
      out.setHSL(0.12 + rng() * 0.04, 0.3 + rng() * 0.14, 0.34 + rng() * 0.1);
    } else {
      // 고사한 갈색 풀
      out.setHSL(0.07 + rng() * 0.03, 0.28 + rng() * 0.12, 0.24 + rng() * 0.08);
    }
    return out;
  };

  const GRASS_N = Math.round(16000 * AREA_F);
  const grassWindMat = new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 1.0, metalness: 0, envMapIntensity: 0 });
  addWind(grassWindMat, 0.055, 1.3);
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassWindMat, GRASS_N);
  grassMesh.receiveShadow = true;
  // 풀도 그림자를 드리운다 — 컷아웃 실루엣 그대로 깊이 패스에 반영
  grassMesh.castShadow = true;
  grassMesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: grassTex, alphaTest: 0.42,
  });
  const gm = new THREE.Matrix4();
  const gq = new THREE.Quaternion();
  const gv = new THREE.Vector3();
  const gs = new THREE.Vector3();
  const gCol = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  let placed = 0, guard = 0;
  const grassPts = [];
  while (placed < GRASS_N && guard++ < GRASS_N * 8) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.2);
    const wz = (rng() - 0.5) * (GH * TILE - 1.2);
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
    // 키 변주를 크게 — 짧은 잔풀 다수 + 드문 큰 다발 (연속 분포)
    const r1 = rng();
    let sy;
    if (r1 < 0.1) sy = 1.7 + rng() * 1.1;        // 웃자란 큰 다발
    else if (r1 < 0.35) sy = 0.9 + rng() * 0.8;  // 중간
    else sy = 0.32 + rng() * 0.6;                // 짧은 잔풀 다수
    const sxz = 0.5 + rng() * 0.5; // 밑동 좁게 — 대신 더 빽빽하게 심는다
    gs.set(sxz, sy, sxz);
    gv.set(wx, h - 0.03, wz);
    gm.compose(gv, gq, gs);
    grassMesh.setMatrixAt(placed, gm);
    // dryness: 저주파 패치 + 흙 근처일수록 마른톤 + 약간의 개체 변주
    const dry = THREE.MathUtils.clamp(
      patchNoise(wx + HALFW, wz + HALFH) * 1.15 + w.dirt * 0.4 + (rng() - 0.5) * 0.3 - 0.1, 0, 1);
    grassTone(dry, gCol);
    grassMesh.setColorAt(placed, gCol);
    grassPts.push(wx, wz);
    placed++;
  }
  grassBurnData = { mesh: grassMesh, pts: new Float32Array(grassPts) };
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
  const FLOWER_N = Math.round(880 * AREA_F);
  const flowerMesh = new THREE.InstancedMesh(
    flowerGeo,
    (() => { const m = new THREE.MeshStandardMaterial({ map: flowerTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }); addWind(m, 0.05, 1.6); return m; })(),
    FLOWER_N
  );
  flowerMesh.castShadow = true;
  flowerMesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: flowerTex, alphaTest: 0.5,
  });
  placed = 0; guard = 0;
  const flowerCols = [0xf4d94a, 0xf6e58d, 0xffffff, 0xe8ecef, 0xe6b8d6];
  while (placed < FLOWER_N && guard++ < FLOWER_N * 20) {
    const wx = (rng() - 0.5) * (GW * TILE - 2);
    const wz = (rng() - 0.5) * (GH * TILE - 2);
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
  const PEB_N = Math.round(720 * AREA_F);
  const pebMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.09, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.92 }),
    PEB_N
  );
  pebMesh.castShadow = true;
  pebMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < PEB_N && guard++ < PEB_N * 10) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.2);
    const wz = (rng() - 0.5) * (GH * TILE - 1.2);
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

  // 바위 노두: 노이즈 변위한 울퉁불퉁 화강암 (플랫 셰이딩) + 암석 텍스처.
  // 밝은 크리스털 느낌을 없애고 어두운 이끼 낀 바위로.
  function makeRockTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#847a6d'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 128, y = Math.random() * 128, r = 1 + Math.random() * 4.5;
      const dark = Math.random() > 0.5;
      ctx.fillStyle = dark ? `rgba(42,37,30,${0.1 + Math.random() * 0.2})` : `rgba(190,182,166,${0.07 + Math.random() * 0.13})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
    // 이끼 얼룩 (녹색기)
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * 128, y = Math.random() * 128, r = 2 + Math.random() * 6;
      ctx.fillStyle = `rgba(70,86,44,${0.06 + Math.random() * 0.12})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
    // 균열
    ctx.strokeStyle = 'rgba(28,24,20,0.4)';
    for (let i = 0; i < 14; i++) {
      ctx.lineWidth = 0.5 + Math.random(); let x = Math.random() * 128, y = Math.random() * 128;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) { x += (Math.random() - 0.5) * 42; y += (Math.random() - 0.5) * 42; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  const rockTex = makeRockTexture();
  // 이코스피어를 정점별 유사난수로 변위 — 각진 크리스털 대신 울퉁불퉁 바위
  const rockGeo = new THREE.IcosahedronGeometry(0.42, 1);
  {
    const p = rockGeo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const hsh = Math.sin(v.x * 91.3 + v.y * 47.1 + v.z * 63.7) * 43758.5453;
      const disp = 0.72 + (hsh - Math.floor(hsh)) * 0.62;
      v.multiplyScalar(disp);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    rockGeo.computeVertexNormals();
  }
  const ROCK_N = Math.round(200 * AREA_F);
  const rockMesh = new THREE.InstancedMesh(
    rockGeo,
    new THREE.MeshStandardMaterial({ map: rockTex, roughness: 1, metalness: 0, envMapIntensity: 0, flatShading: true }),
    ROCK_N
  );
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < ROCK_N && guard++ < ROCK_N * 40) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.6);
    const wz = (rng() - 0.5) * (GH * TILE - 1.6);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.05) continue;
    const w = surfaceWeights(wx, wz, h);
    if (w.rock < 0.42 || rng() > w.rock * 0.85) continue; // 더 가파른 곳만, 덜 촘촘히
    gq.setFromEuler(new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI));
    const big = rng() < 0.16;
    const sc = big ? 1.6 + rng() * 1.3 : 0.55 + rng() * 0.95;
    gs.set(sc * (0.85 + rng() * 0.3), sc * (0.5 + rng() * 0.5), sc * (0.85 + rng() * 0.3));
    gv.set(wx, h - 0.2 + rng() * 0.1, wz);
    gm.compose(gv, gq, gs);
    rockMesh.setMatrixAt(placed, gm);
    // 어두운 화강암 톤 (map과 곱해져 더 어두워진다) — 밝은 흰 바위 방지
    gCol.setHSL(0.07 + rng() * 0.05, 0.08 + rng() * 0.1, 0.34 + rng() * 0.12);
    rockMesh.setColorAt(placed, gCol);
    placed++;
  }
  rockMesh.count = placed;
  rockMesh.instanceMatrix.needsUpdate = true;
  if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
  scene.add(rockMesh);

  // 여울 강돌: 도하 가능한 얕은 물에만 배치 — 수심이 얕은 곳이 한눈에 보인다
  const STONE_N = Math.round(250 * AREA_F);
  const stoneMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.11, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    STONE_N
  );
  stoneMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < STONE_N && guard++ < STONE_N * 60) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.6);
    const wz = (rng() - 0.5) * (GH * TILE - 1.6);
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
  const LEAF_N = Math.round(1500 * AREA_F);
  const leafMesh = new THREE.InstancedMesh(
    leafGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide }),
    LEAF_N
  );
  leafMesh.receiveShadow = true;
  const leafCols = [0x8a6a34, 0x9c7b3c, 0x74582c, 0xa98a44, 0x6f7a38];
  placed = 0; guard = 0;
  while (placed < LEAF_N && guard++ < LEAF_N * 12) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.4);
    const wz = (rng() - 0.5) * (GH * TILE - 1.4);
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
  const TWIG_N = Math.round(440 * AREA_F);
  const twigMesh = new THREE.InstancedMesh(
    twigGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    TWIG_N
  );
  twigMesh.castShadow = true;
  twigMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < TWIG_N && guard++ < TWIG_N * 14) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.4);
    const wz = (rng() - 0.5) * (GH * TILE - 1.4);
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
    ctx.filter = 'blur(0.6px)';
    for (let i = 0; i < 7; i++) {
      const bx = 10 + rng() * 44, lean = (rng() - 0.5) * 10, w = 1.6 + rng() * 1.4;
      const grad = ctx.createLinearGradient(0, 64, 0, 2);
      grad.addColorStop(0, 'rgba(110,110,110,1)');
      grad.addColorStop(1, 'rgba(190,190,190,1)');
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
    const b = rdPos.length / 3; const w = 0.42, hh = 0.72;
    rdPos.push(-w / 2 * c, 0, -w / 2 * sn,  w / 2 * c, 0, w / 2 * sn,  w / 2 * c, hh, w / 2 * sn,  -w / 2 * c, hh, -w / 2 * sn);
    rdUv.push(0, 0, 1, 0, 1, 1, 0, 1);
    rdIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const reedGeo = new THREE.BufferGeometry();
  reedGeo.setAttribute('position', new THREE.Float32BufferAttribute(rdPos, 3));
  reedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rdUv, 2));
  reedGeo.setIndex(rdIdx);
  reedGeo.computeVertexNormals();
  const REED_N = Math.round(700 * AREA_F);
  const reedMesh = new THREE.InstancedMesh(
    reedGeo,
    (() => { const m = new THREE.MeshStandardMaterial({ map: reedTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1.0, envMapIntensity: 0 }); addWind(m, 0.07, 1.1); return m; })(),
    REED_N
  );
  reedMesh.receiveShadow = true;
  reedMesh.castShadow = true;
  reedMesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: reedTex, alphaTest: 0.4,
  });
  const reedCols = [0x5a7a3a, 0x6b8540, 0x4e6a30, 0x8a8a44];
  placed = 0; guard = 0;
  while (placed < REED_N && guard++ < REED_N * 14) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.2);
    const wz = (rng() - 0.5) * (GH * TILE - 1.2);
    const h = sampleHeight(wx, wz);
    const depth = WATER_Y - h;
    // 물가 띠: 살짝 잠긴 곳~물가 위 15cm, 바위 지대 제외
    if (depth > 0.16 || depth < -0.16) continue;
    const w = surfaceWeights(wx, wz, h);
    if (w.rock > 0.4) continue;
    gq.setFromAxisAngle(up, rng() * Math.PI * 2);
    const sy = 0.5 + rng() * 0.5, sxz = 0.65 + rng() * 0.5;
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
  const MOSS_N = Math.round(620 * AREA_F);
  const mossMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: 0, flatShading: true }),
    MOSS_N
  );
  mossMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < MOSS_N && guard++ < MOSS_N * 22) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.4);
    const wz = (rng() - 0.5) * (GH * TILE - 1.4);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.05) continue;
    const w = surfaceWeights(wx, wz, h);
    if (w.rock < 0.32 || rng() > w.rock * 0.8) continue;
    gq.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * Math.PI, rng() * 0.4));
    gs.set(1 + rng() * 1.2, 0.22 + rng() * 0.22, 1 + rng() * 1.2); // 더 납작하게
    gv.set(wx, h + 0.03, wz);
    gm.compose(gv, gq, gs);
    mossMesh.setMatrixAt(placed, gm);
    // 어둡고 탁한 이끼 초록 (밝은 초록 조각 방지)
    gCol.setHSL(0.24 + rng() * 0.06, 0.28 + rng() * 0.14, 0.16 + rng() * 0.07);
    mossMesh.setColorAt(placed, gCol);
    placed++;
  }
  mossMesh.count = placed;
  mossMesh.instanceMatrix.needsUpdate = true;
  if (mossMesh.instanceColor) mossMesh.instanceColor.needsUpdate = true;
  noAO(mossMesh);
  scene.add(mossMesh); decorMeshes.push(mossMesh);

  // 클로버/잡초 패치: 지면에 납작 붙는 얼룩 원반 — 풀 포기 사이 틈을
  // 낮은 지피식물로 메워 맨땅 느낌을 없앤다
  const cloverCanvas = document.createElement('canvas');
  cloverCanvas.width = cloverCanvas.height = 64;
  {
    const ctx = cloverCanvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 26;
      const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r;
      const s2 = 2 + rng() * 3;
      const v = 150 + rng() * 90;
      ctx.fillStyle = `rgba(${v * 0.75 | 0},${v | 0},${v * 0.6 | 0},0.9)`;
      ctx.beginPath(); ctx.ellipse(x, y, s2, s2 * 0.8, rng() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
  }
  const cloverTex = new THREE.CanvasTexture(cloverCanvas);
  const CLOVER_N = Math.round(2600 * AREA_F);
  const cloverMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.55, 0.55),
    new THREE.MeshStandardMaterial({ map: cloverTex, alphaTest: 0.35, roughness: 1, envMapIntensity: 0, side: THREE.DoubleSide }),
    CLOVER_N
  );
  cloverMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < CLOVER_N && guard++ < CLOVER_N * 8) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.4);
    const wz = (rng() - 0.5) * (GH * TILE - 1.4);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.05) continue;
    const w = surfaceWeights(wx, wz, h);
    const grassW = (1 - w.sand * 0.7) * (1 - w.rock) * (1 - w.bed);
    if (rng() > grassW * 0.85) continue;
    gq.setFromEuler(new THREE.Euler(-Math.PI / 2 + (rng() - 0.5) * 0.24, 0, rng() * Math.PI * 2, 'ZYX'));
    gs.setScalar(0.7 + rng() * 1.1);
    gv.set(wx, h + 0.025, wz);
    gm.compose(gv, gq, gs);
    cloverMesh.setMatrixAt(placed, gm);
    gCol.setHSL(0.25 + rng() * 0.06, 0.3 + rng() * 0.16, 0.17 + rng() * 0.1);
    cloverMesh.setColorAt(placed, gCol);
    placed++;
  }
  cloverMesh.count = placed;
  cloverMesh.instanceMatrix.needsUpdate = true;
  if (cloverMesh.instanceColor) cloverMesh.instanceColor.needsUpdate = true;
  noAO(cloverMesh);
  scene.add(cloverMesh); decorMeshes.push(cloverMesh);

  // 고사리: 숲/물가 그늘에 호를 그리는 잎 — 카드 십자
  const fernCanvas = document.createElement('canvas');
  fernCanvas.width = fernCanvas.height = 64;
  {
    const ctx = fernCanvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.filter = 'blur(0.5px)';
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.38;
      ctx.strokeStyle = `rgba(${150 + rng() * 60 | 0},${190 + rng() * 50 | 0},${120 | 0},0.95)`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(32, 62);
      ctx.quadraticCurveTo(32 + Math.cos(a) * 20, 62 + Math.sin(a) * 34, 32 + Math.cos(a) * 30, 62 + Math.sin(a) * 46);
      ctx.stroke();
      // 잔잎
      for (let s2 = 0.3; s2 < 1; s2 += 0.16) {
        const px = 32 + Math.cos(a) * 28 * s2, py = 62 + Math.sin(a) * 42 * s2;
        ctx.fillStyle = 'rgba(160,200,130,0.9)';
        ctx.beginPath(); ctx.ellipse(px, py, 3.4, 1.6, a, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  const fernTex = new THREE.CanvasTexture(fernCanvas);
  const fPos = [], fUv = [], fIdx = [];
  for (const rot of [0, Math.PI / 2]) {
    const cc = Math.cos(rot), sn = Math.sin(rot);
    const b = fPos.length / 3; const w2 = 0.7, hh = 0.55;
    fPos.push(-w2 / 2 * cc, 0, -w2 / 2 * sn,  w2 / 2 * cc, 0, w2 / 2 * sn,  w2 / 2 * cc, hh, w2 / 2 * sn,  -w2 / 2 * cc, hh, -w2 / 2 * sn);
    fUv.push(0, 0, 1, 0, 1, 1, 0, 1);
    fIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const fernGeo = new THREE.BufferGeometry();
  fernGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  fernGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fUv, 2));
  fernGeo.setIndex(fIdx);
  fernGeo.computeVertexNormals();
  const FERN_N = Math.round(620 * AREA_F);
  const fernWind = new THREE.MeshStandardMaterial({ map: fernTex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 1, envMapIntensity: 0 });
  addWind(fernWind, 0.045, 1.5);
  const fernMesh = new THREE.InstancedMesh(fernGeo, fernWind, FERN_N);
  fernMesh.receiveShadow = true;
  placed = 0; guard = 0;
  while (placed < FERN_N && guard++ < FERN_N * 16) {
    const wx = (rng() - 0.5) * (GW * TILE - 1.4);
    const wz = (rng() - 0.5) * (GH * TILE - 1.4);
    const h = sampleHeight(wx, wz);
    if (h < WATER_Y + 0.04) continue;
    // 숲 근처(수목 프랍 인접) 또는 물가에 군락
    const c = worldToCell({ x: wx, z: wz });
    const nearTree = props.has(cellKey(c.gx, c.gz)) || props.has(cellKey(c.gx + 1, c.gz)) || props.has(cellKey(c.gx, c.gz + 1));
    const nearWater = distToRiver(wx, wz) < 3.5;
    if (!nearTree && !nearWater && rng() > 0.12) continue;
    gq.setFromAxisAngle(up, rng() * Math.PI * 2);
    gs.setScalar(0.7 + rng() * 0.8);
    gv.set(wx, h - 0.02, wz);
    gm.compose(gv, gq, gs);
    fernMesh.setMatrixAt(placed, gm);
    gCol.setHSL(0.29 + rng() * 0.05, 0.32 + rng() * 0.14, 0.2 + rng() * 0.09);
    fernMesh.setColorAt(placed, gCol);
    placed++;
  }
  fernMesh.count = placed;
  fernMesh.instanceMatrix.needsUpdate = true;
  if (fernMesh.instanceColor) fernMesh.instanceColor.needsUpdate = true;
  noAO(fernMesh);
  scene.add(fernMesh); decorMeshes.push(fernMesh);
}

// ---------------------------------------------------------------------------
// 다리: 깊은 강 구간을 가로지르는 목교 — 유일한 안전 횡단로지만
// 포격 2~3발이면 무너진다 (내구도 100)
// ---------------------------------------------------------------------------
const bridge = { cells: new Set(), gz: -1, deckY: WATER_Y + 0.5, hp: 100, maxHp: 100, alive: false, group: null, hit: null };
{
  // 여울에서 먼(=깊은) 강 구간을 고른다 (강이 없으면 다리도 없다)
  let bestGz = -1, bestFord = Infinity;
  if (!hasRiver) bestGz = -2;
  if (bestGz !== -2) for (let gz = 10; gz <= GH - 10; gz++) {
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
    while (g0 > 1 && isWet(g0 - 1) && cgx - g0 < 11) g0--;
    while (g1 < GW - 2 && isWet(g1 + 1) && g1 - cgx < 11) g1++;
    g0 = Math.max(0, g0 - 1);
    g1 = Math.min(GW - 1, g1 + 1);
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
  for (let gx = 2; gx < GW - 2; gx++) {
    for (let gz = 2; gz < GH - 2; gz++) {
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
// 아이템: 수리 키트(+40 HP) / 연료통(⚡ 기동 +4, 3턴) — 지나가면 획득
// ---------------------------------------------------------------------------
const items = new Map(); // cellKey -> { type, group }
{
  const crossTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#f2ede2'; x.fillRect(0, 0, 32, 32);
    x.fillStyle = '#c8342a'; x.fillRect(13, 5, 6, 22); x.fillRect(5, 13, 22, 6);
    return new THREE.CanvasTexture(c);
  })();
  function makeItemMesh(type) {
    const g = new THREE.Group();
    if (type === 'repair') {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.34, 0.5),
        [null, null, new THREE.MeshStandardMaterial({ map: crossTex, roughness: 0.8 }), null, null, null]
          .map((m) => m ?? new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.8 }))
      );
      box.position.y = 0.17;
      g.add(box);
    } else {
      // 제리캔 (연료통)
      const can = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.5, 0.42),
        new THREE.MeshStandardMaterial({ color: 0xd8a625, roughness: 0.65 })
      );
      can.position.y = 0.25;
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.09, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xa87d18, roughness: 0.65 })
      );
      handle.position.y = 0.56;
      g.add(can, handle);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    // 표식 링
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 24),
      new THREE.MeshBasicMaterial({ color: type === 'repair' ? 0xff8577 : 0xffd24d, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    noAO(ring);
    g.add(ring);
    return g;
  }
  const N_ITEM = Math.max(2, Math.round(3 * AREA_F));
  const types = [];
  for (let i = 0; i < N_ITEM; i++) types.push('repair', 'fuel');
  let placedI = 0, guard = 0;
  while (placedI < types.length && guard++ < 3000) {
    const gx = 2 + Math.floor(rng() * (GW - 4)), gz = 2 + Math.floor(rng() * (GH - 4));
    const k = cellKey(gx, gz);
    if (items.has(k) || props.has(k) || terrainAt(gx, gz) === T.WATER) continue;
    if ([PLAYER_SPAWN, ...ENEMY_SPAWNS].some((s) => Math.hypot(s.gx - gx, s.gz - gz) < 5)) continue;
    const type = types[placedI];
    const g = makeItemMesh(type);
    const p = cellToWorld(gx, gz);
    g.position.set(p.x, heightAt(gx, gz) + 0.05, p.z);
    scene.add(g);
    items.set(k, { type, group: g });
    placedI++;
  }
}
// 획득 이펙트: 솟는 링 + 반짝이 + 텍스트
function pickupFx(unit, item) {
  const pos = unit.group.position.clone();
  sfx('hit');
  const col = item.type === 'repair' ? 0x7ce287 : 0xffd24d;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.7, 26),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, pos.y + 0.2, pos.z);
  noAO(ring);
  scene.add(ring);
  const sparks = [];
  for (let i = 0; i < 10; i++) {
    const sp = makePuff(col, THREE.AdditiveBlending);
    sp.scale.setScalar(0.16);
    sp.position.set(pos.x + (rng() - 0.5) * 0.6, pos.y + 0.4, pos.z + (rng() - 0.5) * 0.6);
    scene.add(sp);
    sparks.push({ sp, vy: 1.4 + rng() * 1.6, vx: (rng() - 0.5) * 1.2, vz: (rng() - 0.5) * 1.2 });
  }
  tween(750, (e, k) => {
    ring.scale.setScalar(1 + k * 2.4);
    ring.position.y = pos.y + 0.2 + k * 0.8;
    ring.material.opacity = 0.9 * (1 - k);
    for (const s of sparks) {
      s.sp.position.y += s.vy * 0.016;
      s.sp.position.x += s.vx * 0.016;
      s.sp.position.z += s.vz * 0.016;
      s.sp.material.opacity = 1 - k;
    }
  }, easeOut).then(() => {
    scene.remove(ring);
    sparks.forEach((s) => { scene.remove(s.sp); s.sp.material.dispose(); });
  });
}
function tryPickupItem(unit) {
  const k = cellKey(unit.gx, unit.gz);
  const item = items.get(k);
  if (!item) return;
  items.delete(k);
  scene.remove(item.group);
  if (unit.isPlayer) {
    // 플레이어: 즉시 쓰지 않고 인벤토리에 담는다 — 언제 쓸지는 플레이어가 결정
    unit.inventory.push(item.type);
    popText(unit.group.position.clone().add(new THREE.Vector3(0, 1.5, 0)),
      item.type === 'repair' ? '🔧 수리킷 획득' : '⚡ 연료 획득', '#ffe9a8');
    pickupFx(unit, item);
    if (typeof updateActionBar === 'function') updateActionBar();
    return;
  }
  // 적: 즉시 적용
  if (item.type === 'repair') { unit.hp = Math.min(unit.maxHp, unit.hp + 40); updateHpBar(unit); }
  else unit.boostTurns = 3;
  pickupFx(unit, item);
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
  // 남은 HP 숫자를 바 안에 표기
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(35,42,56,0.85)';
  ctx.strokeText(`${Math.max(0, unit.hp)}`, 80, 17);
  ctx.fillStyle = '#fff';
  ctx.fillText(`${Math.max(0, unit.hp)}`, 80, 17);
  ctx.font = 'bold 17px sans-serif';
  ctx.fillStyle = '#232a38';
  ctx.fillText(unit.isPlayer ? `차체${unit.hullLv} 조종${unit.driverLv}` : `차체${unit.hullLv} AI${unit.driverLv}`, 80, 40);
  tex.needsUpdate = true;
  if (typeof updateThumbs === 'function') updateThumbs();
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
    // 리얼타임: 플레이어 재장전은 시간 기반(reloadReadyAt) — 차종별 reload×3초
    gun: KIT_INFO[kitKey].gun,
    reloadReadyAt: 0,
    reloadLeft: 0,
    movedLastTurn: false,
    aimStack: 0,
    boostTurns: 0,
    inventory: [], // 플레이어: 자동 주행 중 주운 아이템(수리/연료)을 버튼으로 사용
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
  alignToGround(unit);
  // RC 안테나: 아래는 살짝 굵고 위로 가늘어지는 채찍 안테나 —
  // 주행/선회 시 감쇠 스프링으로 대롱대롱 흔들린다
  {
    const ant = new THREE.Group();
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.03, 1.35, 5),
      new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.7 })
    );
    rod.geometry.translate(0, 0.675, 0); // 피벗을 밑동으로
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0xd04434, roughness: 0.6 })
    );
    tip.position.y = 1.35;
    ant.add(rod, tip);
    ant.position.set(-0.5, 1.05, -0.62); // 차체 뒤 좌측
    unit.group.add(ant);
    unit.antenna = ant;
    unit._antVel = { x: 0, z: 0 };
    unit._antPrev = { x: p.x, z: p.z, ry: facing };
  }
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
const REVERSE_COST = 2.0; // 후진은 전진의 2배 비용
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
        if (nc > unit.mp + (unit.boostTurns > 0 ? 4 : 0)) continue; // ⚡ 부스트 반영
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
    if (Math.abs(x) > HALFW + 1 || Math.abs(z) > HALFH + 1) break; // 맵 밖
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
      const bsh = prop.blockShotH ?? prop.def.blockShotH;
      if (bsh > 0 && y < gH + bsh && !nearAim) {
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

  // 포신 부앙각 — 한계로 클램프해서 실제 탄도로 추적 (곡사는 포물선이라 무관).
  // 차체 기울기(조준 방향 성분)가 부앙각 창을 통째로 옮긴다:
  // 오르막을 향하면 창이 위로, 내리막을 향하면 아래로 — 지형 자세가 사격에 영향.
  const tilt = fromCell
    ? hullTiltAtCellDeg(fromCell, aim.x, aim.z)
    : hullTiltTowardDeg(attacker, aim.x, aim.z);
  const pMin = (attacker.gun?.pitchMin ?? PITCH_MIN) + tilt;
  const pMax = (attacker.gun?.pitchMax ?? PITCH_MAX) + tilt;
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
function tween(dur, onUpdate, ease = easeInOut, stop = null) {
  return new Promise((resolve) => {
    activeTweens.push({ start: performance.now(), dur, onUpdate, ease, stop, resolve });
  });
}
// 파편 물리용 프레임레이트 독립 dt: 진행률 k 증가분 × 총 시간(초).
// 고정 0.016/프레임은 저FPS(모바일)에서 시뮬 시간이 트윈보다 짧아
// 낙하가 끝나기 전에 트윈이 끝나 파편이 공중에 얼어붙는다.
function kDt(durMs) {
  let prev = 0;
  return (k) => {
    const d = Math.min(0.12, Math.max(0, (k - prev) * durMs / 1000));
    prev = k;
    return d;
  };
}
const delay = (ms) => tween(ms, () => {}, linear);
function updateTweens(now) {
  for (let i = activeTweens.length - 1; i >= 0; i--) {
    const tw = activeTweens[i];
    if (tw.stop && tw.stop()) { activeTweens.splice(i, 1); tw.resolve(); continue; } // 중도 취소 — 그 자리에서 멈춤
    const k = Math.min(1, (now - tw.start) / tw.dur);
    tw.onUpdate(tw.ease(k), k);
    if (k >= 1) { activeTweens.splice(i, 1); tw.resolve(); }
  }
}
// 차체 선회 각속도 (rad/s) — 전차답게 느릿하게 (리얼타임: 템포 절반)
const DRIVE_TURN_RATE = 1.3; // 주행 중 방향 전환
const PIVOT_RATE = 1.1;      // 제자리 선회 (조준 폴백용)
async function rotateTo(unit, targetRot, rate = DRIVE_TURN_RATE, stop = null) {
  const from = unit.group.rotation.y;
  let diff = targetRot - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) < 0.01) return;
  await tween((Math.abs(diff) / rate) * 1000, (e) => { unit.group.rotation.y = from + diff * e; }, easeInOut, stop);
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
// 차체를 양쪽 궤도 접지에 맞춰 지형에 정렬 — 전후 피치 + 좌우 롤.
// 4점(전좌/전우/후좌/후우) 궤도 접지 높이로 계산한다.
// 4점 궤도 접지에서 차체 목표 자세 산출.
// rotation.order='YXZ'에서 로컬 전방 y성분 = −sin(pitch), 로컬 우측 y성분 =
// +sin(roll) — 앞이 높으면 pitch<0(기수 들림), 오른쪽이 높으면 roll>0.
function groundPose(unit) {
  const ry = unit.group.rotation.y;
  const fx = Math.sin(ry), fz = Math.cos(ry);   // 전방
  const rx = Math.cos(ry), rz = -Math.sin(ry);  // 우측
  const p = unit.group.position;
  const F = 0.8, S = 0.55; // 전후 반길이 / 궤도 좌우 오프셋
  const hFL = driveHeight(p.x + fx * F - rx * S, p.z + fz * F - rz * S);
  const hFR = driveHeight(p.x + fx * F + rx * S, p.z + fz * F + rz * S);
  const hBL = driveHeight(p.x - fx * F - rx * S, p.z - fz * F - rz * S);
  const hBR = driveHeight(p.x - fx * F + rx * S, p.z - fz * F + rz * S);
  return {
    pitch: THREE.MathUtils.clamp(Math.atan2((hBL + hBR) / 2 - (hFL + hFR) / 2, 2 * F), -0.45, 0.45),
    roll: THREE.MathUtils.clamp(Math.atan2((hFR + hBR) / 2 - (hFL + hBL) / 2, 2 * S), -0.4, 0.4),
    y: driveHeight(p.x, p.z),
  };
}
function alignToGround(unit) { // 즉시 스냅 (스폰/크레이터 침하 등)
  const g = groundPose(unit);
  unit.group.rotation.x = g.pitch;
  unit.group.rotation.z = g.roll;
  if (unit._suspVel) { unit._suspVel.p = 0; unit._suspVel.r = 0; }
}
// 로드휠 서스펜션: 차체가 지형 자세를 감쇠 스프링으로 따라간다 —
// 둔덕을 넘을 때 순간 스냅 대신 출렁이며 자세를 잡고(약한 언더댐핑),
// 크레이터로 발밑이 꺼져도 부드럽게 내려앉는다.
function updateSuspension(dt) {
  for (const u of units) {
    if (!u.alive) continue;
    const g = groundPose(u);
    u._suspVel ??= { p: 0, r: 0 };
    const K = 42, D = 9.5;
    const rot = u.group.rotation;
    u._suspVel.p += (g.pitch - rot.x) * K * dt;
    u._suspVel.r += (g.roll - rot.z) * K * dt;
    const dmp = Math.exp(-D * dt);
    u._suspVel.p *= dmp; u._suspVel.r *= dmp;
    rot.x += u._suspVel.p * dt;
    rot.z += u._suspVel.r * dt;
    // 주행 트윈이 y를 직접 굴리는 동안은 높이엔 손대지 않는다
    if (!u._driving) u.group.position.y += (g.y - u.group.position.y) * Math.min(1, dt * 8);
  }
}
// 조준 방향의 차체 기울기(도) — 포신 부앙각 한계가 차체 자세에 실려 움직인다.
// 오르막을 등지면 포를 더 들 수 있고, 내리막을 향하면 더 숙일 수 있다.
function hullTiltTowardDeg(unit, aimX, aimZ) {
  const p = unit.group.position;
  return hullTiltXZ(p.x, p.z, aimX, aimZ);
}
// 가상 셀 기준 (이동 후 사격 판정용)
function hullTiltAtCellDeg(cell, aimX, aimZ) {
  const p = cellToWorld(cell.gx, cell.gz);
  return hullTiltXZ(p.x, p.z, aimX, aimZ);
}
function hullTiltXZ(px, pz, aimX, aimZ) {
  const dx = aimX - px, dz = aimZ - pz;
  const d = Math.hypot(dx, dz);
  if (d < 0.001) return 0;
  const nx = dx / d, nz = dz / d;
  const hF = driveHeight(px + nx * 0.8, pz + nz * 0.8);
  const hB = driveHeight(px - nx * 0.8, pz - nz * 0.8);
  return THREE.MathUtils.radToDeg(
    THREE.MathUtils.clamp(Math.atan2(hF - hB, 1.6), -0.45, 0.45));
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
  if (path.length) engineOn(); // 주행 중 디젤 럼블
  unit._driving = true;
  try {
  for (const cell of path) {
    if (!unit.alive) return; // 이동 중 경계 사격에 격파되면 그 자리에서 정지
    if (unit._abortMove) break; // 카드 합성(상쇄/경로 변경)으로 기동 중단
    const abort = () => unit._abortMove || !unit.alive; // 합성 취소는 트윈 한복판에서도 즉시 멈춘다
    const reverse = hasGear ? cell.rev : fallbackRev;
    const from = unit.group.position.clone();
    const to = cellToWorld(cell.gx, cell.gz);
    const travel = Math.atan2(to.x - from.x, to.z - from.z);
    // 후진이면 차체 전면은 진행 반대 방향을 유지
    await rotateTo(unit, reverse ? travel + Math.PI : travel, DRIVE_TURN_RATE, abort);
    if (unit._abortMove) break;
    sfx(terrainAt(cell.gx, cell.gz) === T.WATER ? 'splash' : 'step');
    unit._trailLast ??= { x: from.x, z: from.z };
    unit._trailSm ??= { x: from.x, z: from.z };
    await tween((reverse ? 290 : 210) / (unit._dash ? (unit._dashMul ?? 1.6) : 1), (e) => { // 절반 템포 (돌격 1.6×/돌파 1.9×)
      const x = THREE.MathUtils.lerp(from.x, to.x, e);
      const z = THREE.MathUtils.lerp(from.z, to.z, e);
      unit.group.position.set(x, driveHeight(x, z) + Math.sin(e * Math.PI) * 0.08, z);
      // 자세는 updateSuspension의 감쇠 스프링이 따라온다 (스냅 없음)
      // 궤도 자국: 지수 평활 점을 따라 그린다 — 8방향 꺾임이 부드러운
      // 곡선으로 뭉개지고, 이따금 끊겨 자연스러운 자국이 된다
      unit._trailSm.x += (x - unit._trailSm.x) * 0.32;
      unit._trailSm.z += (z - unit._trailSm.z) * 0.32;
      const smx = unit._trailSm.x, smz = unit._trailSm.z;
      const tl = unit._trailLast;
      if (Math.hypot(smx - tl.x, smz - tl.z) > 0.34) {
        if (rng() < 0.14) unit._trailEdge = [null, null]; // 끊긴 자국 (남기다 말다)
        else addTrackRibbon(unit, tl.x, tl.z, smx, smz);
        // 지나가며 풀/잎을 튕겨 날린다 (풀밭 위에서만)
        kickFoliage(x, z);
        if (unit.hidden) {
          // 시야 밖 적: 식생 교란을 증폭해 "저기 뭔가 있다"는 단서를 남긴다
          kickFoliage(x + (rng() - 0.5) * 0.8, z + (rng() - 0.5) * 0.8);
          kickFoliage(x, z);
          rustleNearProps(x, z);
        }
        tl.x = smx;
        tl.z = smz;
      }
    }, easeInOut, abort);
    if (unit._abortMove) break; // 셀 중간에서 멈춘 채 종료 — 다음 행동이 그 자리에서 이어받는다
    unit.gx = cell.gx;
    unit.gz = cell.gz;
    unit.group.position.y = driveHeight(to.x, to.z);
    tryPickupItem(unit); // 아이템 위를 지나면 획득
    if (onStep) onStep(unit);
    rtSnapCheck(unit); // 리얼타임 경계망: 자세 잡은 상대가 있으면 스냅 사격
  }
  } finally {
    unit._driving = false;
    unit._abortMove = false;
    unit._dash = false;
    unit._lastMoveT = performance.now(); // 정지 사격 보너스 판정용
    if (path.length) engineOff();
  }
  // 이동이 끝나면 차체는 마지막 진행 방향 그대로 — 자세/높이는 서스펜션이 정착
  if (hullDownCells.has(cellKey(unit.gx, unit.gz))) {
    popText(unit.group.position, '🛡 헐다운', '#ffd76e');
  }
}

// 리얼타임 경계망: 경계 자세(_owPosture)인 유닛은 상대가 자기 포 방향
// ±12° 사선으로 이동해 들어오는 순간 스냅 사격한다 (자세 소모, 페널티 -8)
function rtSnapCheck(mover) {
  if (!mover.alive) return;
  const ARC = THREE.MathUtils.degToRad(12);
  for (const ow of units) {
    if (!ow.alive || ow === mover || ow.isPlayer === mover.isPlayer) continue;
    if (!ow._owPosture || ow._snapBusy) continue;
    if (ow.isPlayer ? (ow.reloadReadyAt ?? 0) > performance.now() : ow.reloadLeft > 0) continue;
    const dx = mover.group.position.x - ow.group.position.x;
    const dz = mover.group.position.z - ow.group.position.z;
    if (Math.hypot(dx, dz) / TILE > VIS_LIMIT) continue; // 안개·폭우 시야 밖
    const bearing = Math.atan2(dx, dz);
    let aligned;
    if (ow.sponsonTwin) {
      aligned = ow.sponsons.some((s) =>
        Math.abs(normAngle(bearing - (ow.group.rotation.y + s.group.rotation.y))) <= ARC);
    } else {
      const gunYaw = ow.group.rotation.y +
        (ow.hasTurret ? ow.turret.rotation.y : (ow.cannon?.rotation.y ?? 0));
      aligned = Math.abs(normAngle(bearing - gunYaw)) <= ARC;
    }
    if (!aligned) continue;
    const shot = computeShot(ow, { unit: mover });
    if (!shot.ok) continue;
    ow._owPosture = false;
    ow._snapBusy = true;
    shot.chance = Math.max(5, shot.chance - SNAP_PENALTY);
    popText(ow.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), '경계 사격!', '#ffd76e');
    if (ow.isPlayer) ow.reloadReadyAt = performance.now() + (ow.gun?.reload ?? 2) * RELOAD_MS_PER;
    else ow.reloadLeft = ow.gun?.reload ?? 2;
    fireSequence(ow, { unit: mover }, shot).finally(() => { ow._snapBusy = false; });
  }
}

// ---------------------------------------------------------------------------
// 이펙트: 파편 / 폭발 / 크레이터 / 분해
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 궤도 자국: 지나간 자리에 부드럽게 이어지는 리본 데칼 (좌우 궤도 2줄, 링버퍼)
// ---------------------------------------------------------------------------
// 궤도 트레드 텍스처 + 노멀맵 (반투명 데칼, 지면 눌린 자국 + 클리트 요철)
function makeTreadTextures() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 32, 32);
  // 눌린 띠 — 가장자리로 갈수록 투명 (지면과 부드럽게 섞임)
  const grad = ctx.createLinearGradient(0, 0, 32, 0);
  grad.addColorStop(0, 'rgba(58,46,32,0)');
  grad.addColorStop(0.2, 'rgba(58,46,32,0.62)');
  grad.addColorStop(0.8, 'rgba(58,46,32,0.62)');
  grad.addColorStop(1, 'rgba(58,46,32,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 32, 32);
  // 클리트 (V방향 가로 바)
  ctx.fillStyle = 'rgba(28,20,12,0.8)';
  for (let y = 1; y < 32; y += 8) ctx.fillRect(3, y, 26, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  // 노멀맵: 클리트 앞/뒤 경사로 요철감
  const n = document.createElement('canvas'); n.width = n.height = 32;
  const nx = n.getContext('2d');
  nx.fillStyle = '#8080ff'; nx.fillRect(0, 0, 32, 32);
  for (let y = 1; y < 32; y += 8) {
    nx.fillStyle = '#80b0ff'; nx.fillRect(3, y, 26, 2);     // 앞 경사(G↑)
    nx.fillStyle = '#8050ff'; nx.fillRect(3, y + 2, 26, 2); // 뒤 경사(G↓)
  }
  const ntex = new THREE.CanvasTexture(n);
  ntex.wrapS = THREE.ClampToEdgeWrapping; ntex.wrapT = THREE.RepeatWrapping;
  return { tex, ntex };
}
const { tex: treadTex, ntex: treadNorm } = makeTreadTextures();
const TRAIL_SEG = 1100;
const trailPosArr = new Float32Array(TRAIL_SEG * 12 * 3);
const trailNorArr = new Float32Array(TRAIL_SEG * 12 * 3);
const trailUvArr = new Float32Array(TRAIL_SEG * 12 * 2);
for (let i = 0; i < TRAIL_SEG * 12; i++) trailNorArr[i * 3 + 1] = 1; // 모두 위쪽 노멀
const trailGeoBuf = new THREE.BufferGeometry();
trailGeoBuf.setAttribute('position', new THREE.BufferAttribute(trailPosArr, 3));
trailGeoBuf.setAttribute('normal', new THREE.BufferAttribute(trailNorArr, 3));
trailGeoBuf.setAttribute('uv', new THREE.BufferAttribute(trailUvArr, 2));
const trailMesh = new THREE.Mesh(
  trailGeoBuf,
  new THREE.MeshStandardMaterial({
    map: treadTex, normalMap: treadNorm, normalScale: new THREE.Vector2(0.9, 0.9),
    transparent: true, opacity: 0.72, depthWrite: false,
    roughness: 1, metalness: 0, envMapIntensity: 0,
    polygonOffset: true, polygonOffsetFactor: -2,
  })
);
trailMesh.frustumCulled = false;
trailMesh.renderOrder = 1;
trailMesh.receiveShadow = true;
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
  let ui = trailIdx * 24;
  unit._trailEdge ??= [null, null];
  unit._trailV ??= 0;
  const v0 = unit._trailV;
  const v1 = v0 + len * 2.9; // 클리트 반복 간격 ~0.34u
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
    // UV: U 0(안)→1(밖), V 누적 거리 (a=안쪽 U0, b=바깥 U1)
    trailUvArr.set([
      0, v0, 1, v0, 0, v1,
      1, v0, 1, v1, 0, v1,
    ], ui);
    vi += 18; ui += 12;
    unit._trailEdge[si] = [ax1, az1, bx1, bz1];
  }
  unit._trailV = v1;
  trailGeoBuf.attributes.position.needsUpdate = true;
  trailGeoBuf.attributes.uv.needsUpdate = true;
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

// 지나가며 튕겨 날리는 풀/잎 조각 — 위로 튀었다가 바람에 실려 천천히 사라진다.
// (인스턴스 풀을 실제로 지우지 않고, 날리는 파편으로 "뜯긴" 느낌만 준다)
const kickBladeGeo = new THREE.PlaneGeometry(0.1, 0.22);
const kickPool = [];
function kickFoliage(x, z) {
  const h = sampleHeight(x, z);
  if (h < WATER_Y + 0.05) return; // 물 위에선 물 튀김(splash)만
  const w = surfaceWeights(x, z, h);
  const grassiness = (1 - w.dirt) * (1 - w.sand * 0.8) * (1 - w.rock) * (1 - w.bed);
  if (grassiness < 0.3 || rng() > grassiness) return;
  const n = 2 + Math.floor(rng() * 3);
  const cols = [0x6f9c4a, 0x86823c, 0x577f3b, 0x9c7b3c];
  const pieces = [];
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(kickBladeGeo, new THREE.MeshStandardMaterial({
      color: cols[Math.floor(rng() * cols.length)], side: THREE.DoubleSide,
      roughness: 1, envMapIntensity: 0, transparent: true, depthWrite: false,
    }));
    mesh.position.set(x + (rng() - 0.5) * 0.6, h + 0.1, z + (rng() - 0.5) * 0.6);
    mesh.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    noAO(mesh);
    scene.add(mesh);
    const a = rng() * Math.PI * 2;
    pieces.push({
      mesh,
      vel: new THREE.Vector3(Math.cos(a) * (0.6 + rng()), 1.6 + rng() * 1.8, Math.sin(a) * (0.6 + rng())),
      spin: new THREE.Vector3(rng() * 6 - 3, rng() * 6 - 3, rng() * 6 - 3),
      drift: new THREE.Vector3(0.5 + rng() * 0.6, 0, 0.2), // 바람 방향으로 흘러감
    });
  }
  // 조금씩 날리다가 서서히 사라진다 (~1.6s)
  const kickDur = 1400 + rng() * 500;
  const dtOf = kDt(kickDur);
  tween(kickDur, (e, k) => {
    const dt = dtOf(k);
    for (const p of pieces) {
      p.vel.y -= 5 * dt;                       // 약한 중력 — 오래 떠 있게
      p.vel.addScaledVector(p.drift, dt);       // 바람에 실려 표류
      p.vel.multiplyScalar(0.97);
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.material.opacity = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45; // 후반부 페이드아웃
      if (p.mesh.position.y < sampleHeight(p.mesh.position.x, p.mesh.position.z) + 0.03) {
        p.mesh.position.y = sampleHeight(p.mesh.position.x, p.mesh.position.z) + 0.03;
        p.vel.set(0, 0, 0);
      }
    }
  }, linear).then(() => pieces.forEach((p) => { scene.remove(p.mesh); p.mesh.material.dispose(); }));
}

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
  const dtOf = kDt(1100);
  tween(1100, (e, rawK) => {
    const dt = dtOf(rawK);
    for (const p of pieces) {
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < floorY + 0.11) {
        p.mesh.position.y = floorY + 0.11;
        p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      if (rawK > 0.7) p.mesh.scale.multiplyScalar(Math.pow(0.94, dt / 0.016));
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
  const dtOf = kDt(1500);
  tween(1500, (e, rawK) => {
    const dt = dtOf(rawK);
    for (const p of pieces) {
      p.vel.y -= 15 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < floorY + 0.15) {
        p.mesh.position.y = floorY + 0.15;
        p.vel.y *= -0.3; p.vel.x *= 0.75; p.vel.z *= 0.75;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (rawK > 0.75) p.mesh.scale.multiplyScalar(Math.pow(0.93, dt / 0.016));
    }
  }, linear).then(() => pieces.forEach((p) => scene.remove(p.mesh)));
}

// 크레이터: 하이트필드를 부드럽게 함몰시켜 지형 파괴
// 하이트필드 정점 노멀을 경사(중앙차분)로 국소 재계산 — 크레이터 후 빠르게.
function recomputeTerrainNormals(ix0, ix1, iz0, iz1) {
  const pos = terrainGeo.attributes.position;
  const nor = terrainGeo.attributes.normal;
  const cx0 = Math.max(0, ix0), cx1 = Math.min(VNW, ix1);
  const cz0 = Math.max(0, iz0), cz1 = Math.min(VNH, iz1);
  const gY = (ix, iz) => pos.getY(vIndex(THREE.MathUtils.clamp(ix, 0, VNW), THREE.MathUtils.clamp(iz, 0, VNH)));
  const s2 = 2 * VSTEP;
  const n = new THREE.Vector3();
  for (let iz = cz0; iz <= cz1; iz++) {
    for (let ix = cx0; ix <= cx1; ix++) {
      n.set(gY(ix - 1, iz) - gY(ix + 1, iz), s2, gY(ix, iz - 1) - gY(ix, iz + 1)).normalize();
      nor.setXYZ(vIndex(ix, iz), n.x, n.y, n.z);
    }
  }
  nor.needsUpdate = true;
}
function crater(gx, gz) {
  if (!inBounds(gx, gz)) return;
  if (terrainAt(gx, gz) === T.WATER) return;
  const c = cellToWorld(gx, gz);
  const R = 2.1, DEPTH = 0.5;
  const pos = terrainGeo.attributes.position;
  const colAttr = terrainGeo.attributes.color;
  const dirtCol = new THREE.Color();
  // 크레이터 반경의 정점만 순회 (조밀 하이트필드 성능 — 전체 순회 회피)
  const ix0 = Math.max(0, Math.floor((c.x - R + HALFW) / VSTEP));
  const ix1 = Math.min(VNW, Math.ceil((c.x + R + HALFW) / VSTEP));
  const iz0 = Math.max(0, Math.floor((c.z - R + HALFH) / VSTEP));
  const iz1 = Math.min(VNH, Math.ceil((c.z + R + HALFH) / VSTEP));
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const i = vIndex(ix, iz);
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
  }
  pos.needsUpdate = true;
  colAttr.needsUpdate = true;
  // 크레이터 영역 정점 노멀만 하이트필드 경사로 재계산 (전체 computeVertexNormals 회피)
  recomputeTerrainNormals(ix0 - 1, ix1 + 1, iz0 - 1, iz1 + 1);
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
        alignToGround(u);
      });
    }
  }
}

function damageProp(prop, dmg, impactPos = null) {
  if (!props.has(cellKey(prop.gx, prop.gz))) return;
  prop.hp -= dmg;
  // 프리컷 청크 프랍(벽돌 건물): 착탄 반경의 청크만 떼어내는 부분 파괴
  if (prop.chunks) {
    if (impactPos) {
      prop.group.updateMatrixWorld(true);
      const radius = 0.55 + dmg * 0.016; // 직격 60 → ~1.5, 여파 20 → ~0.9
      const world = new THREE.Vector3();
      const toBreak = [];
      for (const ch of prop.chunks) {
        if (ch.dead) continue;
        world.copy(ch.center).applyMatrix4(prop.group.matrixWorld);
        if (world.distanceTo(impactPos) < radius) toBreak.push(ch);
      }
      if (toBreak.length) {
        for (const ch of toBreak) ch.dead = true;
        spawnChunkDebris(prop, toBreak, impactPos);
        bakeChunkProp(prop);
        sfx('hit');
      }
    }
    const remain = prop.chunks.filter((c) => !c.dead).length / prop.chunks.length;
    if (prop.hp > 0 && remain > 0.42) {
      const g = prop.group;
      const rot = g.rotation.y;
      tween(200, (e, rawK) => { g.rotation.y = rot + Math.sin(rawK * 30) * 0.04 * (1 - rawK); }, linear);
      return;
    }
    // 붕괴: 남은 청크 전부 무너뜨리고 잔해로
    const rest = prop.chunks.filter((c) => !c.dead);
    for (const ch of rest) ch.dead = true;
    spawnChunkDebris(prop, rest, impactPos ?? prop.group.position.clone());
    for (const k of prop.cells ?? [cellKey(prop.gx, prop.gz)]) props.delete(k);
    scene.remove(prop.group);
    sfx('explode');
    for (const k of (prop.cells ?? []).slice(0, 2)) {
      const [rx, rz] = k.split(',').map(Number);
      if (!props.has(k)) placeProp('rubble', rx, rz);
    }
    return;
  }
  if (prop.hp > 0) {
    // 흔들림
    const g = prop.group;
    const rot = g.rotation.y;
    tween(200, (e, rawK) => { g.rotation.y = rot + Math.sin(rawK * 30) * 0.08 * (1 - rawK); }, linear);
    return;
  }
  for (const k of prop.cells ?? [cellKey(prop.gx, prop.gz)]) props.delete(k);
  breakApartGroup(prop.group, 6);
  sfx('hit');
  if (prop.type === 'house') {
    // 농가 → 잔해 단계
    placeProp('rubble', prop.gx, prop.gz);
  }
}

// 연기/화염 퍼프용 소프트 원형 스프라이트 텍스처
function makePuffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  return new THREE.CanvasTexture(c);
}
const puffTex = makePuffTexture();
function makePuff(color, blending = THREE.NormalBlending) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: puffTex, color, transparent: true, depthWrite: false, blending,
  }));
  noAO(sp);
  return sp;
}
// 볼류메트릭 폭발: 겹친 화염 퍼프(가산) → 불투명 연기 기둥이 피어오르고,
// 흙/풀 분수가 위로 솟구쳐 흩어진다.
async function explosionFx(pos, big = false, debrisCols = null) {
  sfx(big ? 'explode' : 'hit');
  const N_FIRE = big ? 9 : 6, N_SMOKE = big ? 13 : 7;
  const parts = [];
  // 화염 퍼프: 중심에서 밖으로 팽창하며 노랑→주황→검붉게 어두워진다
  for (let i = 0; i < N_FIRE; i++) {
    const sp = makePuff(0xffdd8a, THREE.AdditiveBlending);
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.3;
    sp.position.set(pos.x + Math.cos(a) * r, pos.y + Math.random() * 0.3, pos.z + Math.sin(a) * r);
    const s0 = (big ? 0.9 : 0.6) * (0.7 + Math.random() * 0.6);
    sp.scale.setScalar(s0);
    scene.add(sp);
    parts.push({ sp, kind: 'fire', s0, vy: 0.9 + Math.random() * 1.4, vx: Math.cos(a) * (0.5 + Math.random()), vz: Math.sin(a) * (0.5 + Math.random()), delay: Math.random() * 0.08 });
  }
  // 연기 퍼프: 위로 느리게 피어오르며 커지고 흩어진다
  for (let i = 0; i < N_SMOKE; i++) {
    const grey = 0.16 + Math.random() * 0.14;
    const sp = makePuff(new THREE.Color(grey, grey * 0.96, grey * 0.9));
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.35;
    sp.position.set(pos.x + Math.cos(a) * r, pos.y + 0.2, pos.z + Math.sin(a) * r);
    const s0 = (big ? 0.8 : 0.55) * (0.6 + Math.random() * 0.5);
    sp.scale.setScalar(s0);
    sp.material.opacity = 0.85;
    scene.add(sp);
    parts.push({ sp, kind: 'smoke', s0, vy: 1.1 + Math.random() * 1.1, vx: (Math.random() - 0.5) * 0.7, vz: (Math.random() - 0.5) * 0.7, delay: 0.12 + Math.random() * 0.25 });
  }
  // 섬광 + 지면 링
  const flash = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.8 : 0.5, 10, 10), flashMat.clone());
  flash.position.copy(pos);
  scene.add(flash);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.55, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, pos.y + 0.1, pos.z);
  scene.add(ring);
  // 흙/풀 분수: 위로 솟구쳐 포물선으로 쏟아진다 (표면색)
  spawnDebris(pos, debrisCols ?? [0xffb347, 0x8b95a8, 0x6f5a3e], big ? 26 : 15, big ? 8 : 5.5);
  const fireCol = new THREE.Color();
  const dur = big ? 1500 : 1050;
  const fxDtOf = kDt(dur);
  const fxDone = tween(dur, (e, k) => {
    const dt = fxDtOf(k);
    flash.scale.setScalar(1 + Math.min(k * 5, 1) * (big ? 2.4 : 1.5));
    flash.material.opacity = Math.max(0, 1 - k * 4);
    ring.scale.setScalar(1 + Math.min(k * 3, 1) * 4.5);
    ring.material.opacity = Math.max(0, 0.9 - k * 2.4);
    const tSec = k * dur / 1000;
    for (const p of parts) {
      if (tSec < p.delay) continue;
      const life = (tSec - p.delay) / (dur / 1000 - p.delay);
      p.sp.position.x += p.vx * dt;
      p.sp.position.z += p.vz * dt;
      p.sp.position.y += p.vy * dt;
      p.vx *= 0.97; p.vz *= 0.97;
      if (p.kind === 'fire') {
        p.vy *= 0.95;
        p.sp.scale.setScalar(p.s0 * (1 + life * 2.2));
        // 노랑 → 주황 → 검붉게
        fireCol.setHSL(0.09 - life * 0.06, 1, Math.max(0.12, 0.62 - life * 0.55));
        p.sp.material.color.copy(fireCol);
        p.sp.material.opacity = Math.max(0, 0.95 * (1 - life * 1.35));
      } else {
        p.vy *= 0.988;
        p.sp.scale.setScalar(p.s0 * (1 + life * 4.4));
        p.sp.material.opacity = Math.max(0, 0.88 * (1 - life) * (life < 0.1 ? life / 0.1 : 1));
      }
    }
  }, linear).then(() => {
    scene.remove(flash); scene.remove(ring);
    for (const p of parts) { scene.remove(p.sp); p.sp.material.dispose(); }
  });
  // 게임 흐름은 초반 임팩트만 기다린다 (연기 여운은 백그라운드로)
  await tween(big ? 430 : 300, () => {}, linear);
  void fxDone;
}

// ── 격파 잔해: 포탑 등 일부 부품이 포물선으로 날아가 떨어지고,
// 차체는 그을린 채 남아 불타다(화염) 검은 매연 기둥을 뿜는다 ──
const wreckFires = [];
function destroyToWreck(unit) {
  unit.hpBar.sprite.visible = false;
  // 날아갈 부품: 포탑(있으면), 무포탑은 스폰슨/포 — 폭압으로 뜯겨 나간다
  const part = unit.hasTurret ? unit.turret : (unit.sponsons?.[0]?.group ?? unit.cannon);
  if (part && part.parent) {
    const pieces = [];
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    part.updateWorldMatrix(true, true);
    part.traverse((o) => {
      if (!o.isMesh || o.material?.visible === false) return;
      o.getWorldPosition(wp); o.getWorldQuaternion(wq); o.getWorldScale(ws);
      const clone = new THREE.Mesh(o.geometry, o.material);
      clone.castShadow = true;
      clone.position.copy(wp); clone.quaternion.copy(wq); clone.scale.copy(ws);
      scene.add(clone);
      pieces.push({
        mesh: clone,
        vel: new THREE.Vector3((rng() - 0.5) * 3.6, 5.2 + rng() * 3.2, (rng() - 0.5) * 3.6),
        spin: new THREE.Vector3(rng() * 9 - 4.5, rng() * 9 - 4.5, rng() * 9 - 4.5),
      });
    });
    part.parent.remove(part);
    // 프록시 소부품(로드휠/해치)도 함께 터져 나간다 — 부품 단위 파괴감
    const wp0 = unit.group.position;
    for (let pi = 0; pi < 4; pi++) {
      const small = pi % 2
        ? new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10), new THREE.MeshStandardMaterial({ color: 0x3c424e, roughness: 0.8 }))
        : new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.22), new THREE.MeshStandardMaterial({ color: 0x4a5160, roughness: 0.8 }));
      small.position.set(wp0.x + (rng() - 0.5) * 0.8, wp0.y + 0.7, wp0.z + (rng() - 0.5) * 0.8);
      small.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      small.castShadow = true;
      scene.add(small);
      pieces.push({
        mesh: small,
        vel: new THREE.Vector3((rng() - 0.5) * 5, 4 + rng() * 3.5, (rng() - 0.5) * 5),
        spin: new THREE.Vector3(rng() * 12 - 6, rng() * 12 - 6, rng() * 12 - 6),
      });
    }
    // 하부 파괴 (60%): 폭압이 차체 아래로 빠지면 병합된 트랙 밴드를 끄고
    // 실제 킷 궤도 피스(렝스/링크 — 슈·페그·스터드 포함)가 낱개로 흩어진다.
    // 로드휠 몇 개도 옆으로 굴러 나간다.
    if (rng() < 0.6 && unit.trackPieces?.length) {
      const ry = unit.group.rotation.y;
      const rxs = Math.cos(ry), rzs = -Math.sin(ry); // 우측
      for (const band of unit.trackBands ?? []) band.visible = false;
      unit.group.updateMatrixWorld(true);
      const M = new THREE.Matrix4();
      for (const tp of unit.trackPieces) {
        const g = new THREE.Group();
        for (const sub of tp.meshes) {
          const m = new THREE.Mesh(sub.geo, sub.mat);
          sub.rel.decompose(m.position, m.quaternion, m.scale);
          m.castShadow = true;
          g.add(m);
        }
        M.multiplyMatrices(unit.group.matrixWorld, tp.m);
        M.decompose(g.position, g.quaternion, g.scale);
        scene.add(g);
        // 자기 쪽 궤도 방향으로 튕겨 나간다
        const ox = g.position.x - wp0.x, oz = g.position.z - wp0.z;
        const on = Math.hypot(ox, oz) || 1;
        pieces.push({
          mesh: g,
          vel: new THREE.Vector3(
            (ox / on) * (1.3 + rng() * 2.4) + (rng() - 0.5),
            1.9 + rng() * 2.7,
            (oz / on) * (1.3 + rng() * 2.4) + (rng() - 0.5)
          ),
          spin: new THREE.Vector3(rng() * 10 - 5, rng() * 10 - 5, rng() * 10 - 5),
        });
      }
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x424a58, roughness: 0.85 });
      for (let wi = 0; wi < 2 + Math.floor(rng() * 2); wi++) {
        const side = wi % 2 ? 1 : -1;
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12), wheelMat);
        wheel.position.set(wp0.x + rxs * side * 0.72, wp0.y + 0.3, wp0.z + rzs * side * 0.72);
        wheel.rotation.set(0, ry, Math.PI / 2); // 옆으로 선 자세 — 굴러 나간다
        wheel.castShadow = true;
        scene.add(wheel);
        pieces.push({
          mesh: wheel,
          vel: new THREE.Vector3(rxs * side * (2.4 + rng() * 2), 1.6 + rng() * 1.4, rzs * side * (2.4 + rng() * 2)),
          spin: new THREE.Vector3(9 + rng() * 6, 0, 0),
        });
      }
    }
    let trailT = 0;
    const dtOf = kDt(2200);
    tween(2200, (e, k) => {
      const dt = dtOf(k);
      trailT += dt;
      for (const p of pieces) {
        p.vel.y -= 13 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        const fy = sampleHeight(p.mesh.position.x, p.mesh.position.z) + 0.12;
        if (p.mesh.position.y < fy) {
          p.mesh.position.y = fy;
          p.vel.y *= -0.32; p.vel.x *= 0.6; p.vel.z *= 0.6;
          p.spin.multiplyScalar(0.6);
        }
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.z += p.spin.z * dt;
        // 공중에 떠 있는 동안 화염 꼬리를 문다
        if (k < 0.45 && p.mesh.position.y > fy + 0.25 && rng() < 0.2) {
          const fp = makePuff(0xffa03a, THREE.AdditiveBlending);
          fp.position.copy(p.mesh.position);
          fp.scale.setScalar(0.18 + rng() * 0.14);
          scene.add(fp);
          tween(420, (e2, k2) => {
            fp.position.y += 0.01;
            fp.material.opacity = 0.85 * (1 - k2);
            fp.scale.multiplyScalar(1.015);
          }, linear).then(() => { scene.remove(fp); fp.material.dispose(); });
        }
      }
    }, linear).then(() => {
      // 안전망: 아직 공중이면 지면에 내려놓는다 — 파편이 떠서 멈추는 일 방지
      for (const p of pieces) {
        const fy = sampleHeight(p.mesh.position.x, p.mesh.position.z) + 0.12;
        if (p.mesh.position.y > fy) p.mesh.position.y = fy;
      }
      // 가장 큰 부품(포탑) 착지점에 잔불 — 부서진 부품이 떨어져 불탄다
      const big = pieces[0];
      if (big) wreckFires.push({ x: big.mesh.position.x, y: big.mesh.position.y + 0.2, z: big.mesh.position.z, t0: performance.now(), last: 0, dur: 12 });
    });
  }
  // 차체를 그을린 잔해로: 재질을 어둡게 복제 (공유 재질 훼손 방지)
  const darkCache = new Map();
  unit.group.traverse((o) => {
    if (!o.isMesh || o === unit.hitbox || o.isSprite) return;
    if (o.material?.visible === false) return;
    if (!darkCache.has(o.material)) {
      const dm = o.material.clone();
      if (dm.color) dm.color.multiplyScalar(0.3);
      dm.roughness = 1;
      if ('envMapIntensity' in dm) dm.envMapIntensity = 0;
      darkCache.set(o.material, dm);
    }
    o.material = darkCache.get(o.material);
  });
  // 안테나도 힘없이 꺾임
  if (unit.antenna) { unit.antenna.rotation.z = 0.9 + rng() * 0.4; }
  const p = unit.group.position;
  wreckFires.push({ x: p.x, y: p.y + 0.9, z: p.z, t0: performance.now(), last: 0 });
}
// 화재(0~7s: 화염+검은 연기) → 매연(7~34s: 짙은 연기 기둥)
function updateWreckFires(now) {
  for (let i = wreckFires.length - 1; i >= 0; i--) {
    const f = wreckFires[i];
    const age = (now - f.t0) / 1000;
    const dur = f.dur ?? 34;
    if (age > dur) { wreckFires.splice(i, 1); continue; }
    const firePhase = age < Math.min(7, dur * 0.45);
    const interval = firePhase ? 120 : 300;
    if (now - f.last < interval) continue;
    f.last = now;
    const asSmoke = !firePhase || rng() < 0.35;
    if (asSmoke) {
      const grey = firePhase ? 0.13 : 0.08 + rng() * 0.05;
      const sp = makePuff(new THREE.Color(grey, grey, grey));
      sp.position.set(f.x + (rng() - 0.5) * 0.5, f.y + 0.3, f.z + (rng() - 0.5) * 0.5);
      const s0 = 0.45 + rng() * 0.35;
      sp.scale.setScalar(s0);
      sp.material.opacity = 0.0;
      scene.add(sp);
      const drift = (rng() - 0.5) * 0.3;
      tween(2600 + rng() * 1000, (e, k) => {
        sp.position.y += 0.016 * (0.9 + k * 0.5);
        sp.position.x += 0.016 * (0.35 + drift);
        sp.scale.setScalar(s0 * (1 + k * 3.2));
        sp.material.opacity = Math.min(k * 6, 1) * 0.5 * (1 - k);
      }, linear).then(() => { scene.remove(sp); sp.material.dispose(); });
    } else {
      const sp = makePuff(0xffb44a, THREE.AdditiveBlending);
      sp.position.set(f.x + (rng() - 0.5) * 0.55, f.y + rng() * 0.2, f.z + (rng() - 0.5) * 0.55);
      const s0 = 0.3 + rng() * 0.3;
      sp.scale.setScalar(s0);
      scene.add(sp);
      tween(650 + rng() * 350, (e, k) => {
        sp.position.y += 0.016 * 1.3;
        sp.scale.setScalar(s0 * (1 + k * 0.9));
        sp.material.color.setHSL(0.085 - k * 0.05, 1, Math.max(0.15, 0.55 - k * 0.4));
        sp.material.opacity = 0.9 * (1 - k * k);
      }, linear).then(() => { scene.remove(sp); sp.material.dispose(); });
    }
  }
}

// ── 화재 전파: 포탄 폭약이 주변 풀/나무/건물에 불을 붙인다 ──
// 풀은 타서 사라지고, 나무는 까맣게 그을리며 잎이 잿불로 날아가고,
// 건물은 그을음+지연 피해(불이 크게 나면 무너진다).
function emberFx(x, y, z) {
  const sp = makePuff(0xff9540, THREE.AdditiveBlending);
  sp.scale.setScalar(0.08 + rng() * 0.08);
  sp.position.set(x, y, z);
  scene.add(sp);
  const vx = 0.4 + rng() * 0.55, vy = 0.5 + rng() * 0.75, vz = (rng() - 0.5) * 0.5;
  tween(1800 + rng() * 1300, (e, k) => {
    sp.position.x += vx * 0.016;
    sp.position.y += vy * 0.016 * (1 - k * 0.5);
    sp.position.z += vz * 0.016;
    sp.material.opacity = (1 - k) * (0.55 + 0.45 * Math.abs(Math.sin(k * 34))); // 잿불 깜빡임
  }, linear).then(() => { scene.remove(sp); sp.material.dispose(); });
}
function burnGrassAt(cx, cz, r) {
  if (!grassBurnData) return;
  const { mesh, pts } = grassBurnData;
  const idx = [];
  const r2 = r * r;
  for (let i = 0; i < mesh.count; i++) {
    const dx = pts[i * 2] - cx, dz = pts[i * 2 + 1] - cz;
    if (dx * dx + dz * dz < r2 && !grassBurnt.has(i)) { grassBurnt.add(i); idx.push(i); }
  }
  if (!idx.length) return;
  const m = new THREE.Matrix4();
  // 몇 가닥은 잿불로 날아오른다
  for (let i = 0; i < Math.min(6, idx.length); i++) {
    const gi = idx[Math.floor(rng() * idx.length)];
    emberFx(pts[gi * 2], sampleHeight(pts[gi * 2], pts[gi * 2 + 1]) + 0.3, pts[gi * 2 + 1]);
  }
  tween(850, (e, k) => {
    const sc = 0.85; // 프레임당 수축 → 타서 사라짐
    for (const i of idx) {
      mesh.getMatrixAt(i, m);
      const el = m.elements;
      el[0] *= sc; el[1] *= sc; el[2] *= sc;
      el[4] *= sc; el[5] *= sc; el[6] *= sc;
      el[8] *= sc; el[9] *= sc; el[10] *= sc;
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, linear);
}
// 지면 그을음: 정점 색을 검게 (크레이터와 달리 높이는 유지)
function scorchTerrain(cx, cz, R) {
  const pos = terrainGeo.attributes.position;
  const colAttr = terrainGeo.attributes.color;
  const ix0 = Math.max(0, Math.floor((cx - R + HALFW) / VSTEP));
  const ix1 = Math.min(VNW, Math.ceil((cx + R + HALFW) / VSTEP));
  const iz0 = Math.max(0, Math.floor((cz - R + HALFH) / VSTEP));
  const iz1 = Math.min(VNH, Math.ceil((cz + R + HALFH) / VSTEP));
  const sc = new THREE.Color(0x241d14);
  const cur = new THREE.Color();
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const i = vIndex(ix, iz);
      const d = Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz);
      if (d >= R) continue;
      cur.setRGB(colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i));
      cur.lerp(sc, (1 - d / R) * 0.62);
      colAttr.setXYZ(i, cur.r, cur.g, cur.b);
    }
  }
  colAttr.needsUpdate = true;
}
function burnProp(prop) {
  if (prop._burning) return;
  prop._burning = true;
  const p = prop.group.position;
  if (prop.type === 'tree') {
    // 수피는 까맣게, 잎은 잿불로 날아가며 사라진다 — 그을린 채 서 있는다
    const bark = prop.group.children[0], leaf = prop.group.children[1];
    if (bark?.isMesh) {
      bark.material = bark.material.clone();
      const c0 = bark.material.color.clone();
      tween(2000, (e, k) => { bark.material.color.copy(c0).multiplyScalar(1 - k * 0.85); }, linear);
    }
    if (leaf?.isMesh) {
      leaf.material = leaf.material.clone();
      leaf.material.transparent = true;
      for (let i = 0; i < 13; i++) {
        emberFx(p.x + (rng() - 0.5) * 1.4, p.y + 1.1 + rng() * 0.9, p.z + (rng() - 0.5) * 1.4);
      }
      tween(2400, (e, k) => { leaf.material.opacity = 1 - k; }, linear).then(() => { leaf.visible = false; });
    }
    wreckFires.push({ x: p.x, y: p.y + 1.0, z: p.z, t0: performance.now(), last: 0, dur: 10 });
  } else if (prop.type === 'building' || prop.type === 'house') {
    // 그을음(재질 어둡게 재병합) + 화재 → 지연 피해 3틱 (크면 무너진다)
    if (prop.chunks) { prop._soot = true; bakeChunkProp(prop); }
    wreckFires.push({ x: p.x, y: p.y + 1.7, z: p.z, t0: performance.now(), last: 0, dur: 16 });
    let ticks = 0;
    const iv = setInterval(() => {
      ticks++;
      if (!props.has(cellKey(prop.gx, prop.gz))) { clearInterval(iv); return; }
      damageProp(prop, 15, new THREE.Vector3(p.x + (rng() - 0.5) * 1.6, p.y + 1 + rng() * 1.4, p.z + (rng() - 0.5) * 1.6));
      if (ticks >= 3) clearInterval(iv);
    }, 2300);
  } else if (prop.type === 'bush') {
    wreckFires.push({ x: p.x, y: p.y + 0.4, z: p.z, t0: performance.now(), last: 0, dur: 6 });
    for (let i = 0; i < 6; i++) emberFx(p.x + (rng() - 0.5) * 0.7, p.y + 0.5, p.z + (rng() - 0.5) * 0.7);
    damageProp(prop, 999); // 덤불은 타서 사라진다
  }
}
function igniteArea(center, r) {
  burnGrassAt(center.x, center.z, r * 0.9);
  scorchTerrain(center.x, center.z, r);
  const c = worldToCell(center);
  const seenP = new Set();
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const prop = props.get(cellKey(c.gx + dx, c.gz + dz));
      if (!prop || seenP.has(prop)) continue;
      seenP.add(prop);
      if (prop.group.position.distanceTo(center) < r + 1.2 && rng() < 0.8) burnProp(prop);
    }
  }
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
  updateThumbs(); // HP는 탱크 위 바(숫자 포함)와 섬네일 그래프로 표시
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
    setTimeout(() => checkGameEnd(), 1200); // 리얼타임: 격파 즉시 종료 판정 (연출 후)
    sfx('explode');
    await explosionFx(target.group.position.clone().add(new THREE.Vector3(0, 1, 0)), true);
    destroyToWreck(target); // 포탑이 날아가고 차체는 그을린 잔해 — 화재→매연
    // 유폭 파편: 근처 전차가 파편 직격으로 소량 피해를 입는다
    for (const u2 of units) {
      if (!u2.alive || u2 === target) continue;
      const d2 = u2.group.position.distanceTo(target.group.position);
      if (d2 < 3.4) {
        popText(u2.group.position.clone().add(new THREE.Vector3(0, 1.6, 0)), '💥 파편!', '#ffb08a');
        await applyUnitDamage(u2, Math.max(4, Math.round(13 - d2 * 2.6)), target.group.position);
      }
    }
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
// 물기둥 스플래시: 강물 착탄 — 솟는 물기둥 + 물방울 + 퍼지는 파문 링
async function waterSplashFx(pos) {
  sfx('splash');
  const surf = new THREE.Vector3(pos.x, WATER_Y + 0.02, pos.z);
  // 물기둥 (세로로 늘어난 반투명 구)
  const column = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 12),
    new THREE.MeshBasicMaterial({ color: 0xdcf2f2, transparent: true, opacity: 0.85, depthWrite: false })
  );
  column.position.copy(surf);
  column.scale.set(0.7, 0.2, 0.7);
  noAO(column);
  scene.add(column);
  // 물방울 비산
  const drops = [];
  for (let i = 0; i < 16; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xcfeaea, transparent: true, opacity: 0.9, depthWrite: false }));
    d.position.copy(surf);
    scene.add(d);
    const a = Math.random() * Math.PI * 2;
    drops.push({ mesh: d, vel: new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2.4), 3.4 + Math.random() * 3, Math.sin(a) * (1 + Math.random() * 2.4)) });
  }
  // 파문 링 2겹
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.4, 28),
      new THREE.MeshBasicMaterial({ color: 0xe8f6f4, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    r.rotation.x = -Math.PI / 2;
    r.position.set(surf.x, WATER_Y + 0.03, surf.z);
    noAO(r);
    scene.add(r);
    rings.push(r);
  }
  await tween(620, (e, k) => {
    column.scale.set(0.7 * (1 - k * 0.4), 0.2 + Math.sin(k * Math.PI) * 2.6, 0.7 * (1 - k * 0.4));
    column.material.opacity = 0.85 * (1 - k * k);
    for (const d of drops) {
      d.vel.y -= 13 * 0.016;
      d.mesh.position.addScaledVector(d.vel, 0.016);
      d.mesh.material.opacity = 0.9 * (1 - k);
      if (d.mesh.position.y < WATER_Y) d.mesh.position.y = WATER_Y;
    }
    rings.forEach((r, i) => {
      r.scale.setScalar(1 + k * (5 + i * 3.5));
      r.material.opacity = 0.75 * (1 - k) * (i ? 0.6 : 1);
    });
  }, linear);
  scene.remove(column);
  drops.forEach((d) => scene.remove(d.mesh));
  rings.forEach((r) => scene.remove(r));
}

async function resolveImpact(impact, attacker, directUnit = null) {
  const c = worldToCell(impact);
  // 착탄 지면 종류에 따라 이펙트/파편이 달라진다
  const groundH = sampleHeight(impact.x, impact.z);
  const inWater = terrainAt(c.gx, c.gz) === T.WATER && groundH < WATER_Y - 0.02;
  if (inWater) {
    // 강물: 크레이터 없이 물기둥 + 물방울
    await waterSplashFx(impact);
  } else {
    const w = surfaceWeights(impact.x, impact.z, groundH);
    const grassy = (1 - w.dirt) * (1 - w.rock) * (1 - w.sand) > 0.45;
    const rocky = w.rock > 0.4;
    // 지면별 파편 색: 풀밭=풀잎+흙, 바위=돌조각, 흙/모래=흙덩이
    const cols = grassy ? [0x5c8a40, 0x6f5a3e, 0x86823c]
      : rocky ? [0x9a9285, 0x736c62, 0xb3a385]
      : [0x8a6f4a, 0x6f5a3e, 0xa8875a];
    await explosionFx(impact.clone().add(new THREE.Vector3(0, 0.4, 0)), !!directUnit, cols);
    crater(c.gx, c.gz);
    igniteArea(impact, 1.9); // 폭약 화재: 풀/나무/건물이 불붙는다
  }
  // 다리 피해: 착탄 셀이 다리면 직격, 옆 칸이면 여파
  if (bridge.alive) {
    if (bridge.cells.has(cellKey(c.gx, c.gz))) damageBridge(60, impact);
    else if ([...bridge.cells].some((k) => { const [bx, bz] = k.split(',').map(Number); return Math.max(Math.abs(bx - c.gx), Math.abs(bz - c.gz)) <= 1; })) damageBridge(25, impact);
  }
  // 프랍 피해 (착탄 셀 + 주변 2칸, 거리 감쇠) — 같은 프랍(다중 칸)은 1회만
  const hitProps = new Map();
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const prop = props.get(cellKey(c.gx + dx, c.gz + dz));
      if (!prop) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      const dmg = ring === 0 ? 60 : ring === 1 ? 38 : 20;
      if (!hitProps.has(prop) || hitProps.get(prop) < dmg) hitProps.set(prop, dmg);
    }
  }
  for (const [prop, dmg] of hitProps) damageProp(prop, dmg, impact);
  if (directUnit) {
    // 정밀사격(공격×3)은 약점 조준 — 피해 1.25배
    const mul = attacker.plan?._dmgMul ?? 1;
    await applyUnitDamage(directUnit, attacker.damage * mul, attacker.group.position);
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

  // 명중 굴림 — 이동·조준·노출의 상충:
  //  기동 사격 −8 (돌격/돌파 중엔 −12), 조준/정밀 보너스(정지 시 +15/+30, 이동 시 절반),
  //  움직이는 표적은 맞히기 어렵다 −12, 제압당한 적 −15
  let adj = 0;
  if (attacker.isPlayer && attacker.plan?._moved) adj -= attacker._dash ? 12 : 8;
  if (attacker.isPlayer && attacker.plan?._aimBonus) adj += attacker.plan._aimBonus;
  if (target?.unit && target.unit._driving) adj -= 12; // 기동 ▶ 사격 (이동 회피)
  if (!attacker.isPlayer && attacker._suppressed) { adj -= 15; attacker._suppressed = false; }
  const effChance = THREE.MathUtils.clamp(shot.chance + adj, 3, 97);
  const roll = Math.random() * 100;
  const hit = roll < effChance;
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
// RC 안테나 흔들림: 이동/선회 가속을 감쇠 스프링으로 받아 대롱대롱.
// 멈추면 몇 번 진동하다 곧게 선다.
function updateAntennas(dt) {
  if (dt <= 0) return;
  for (const u of units) {
    if (!u.antenna) continue;
    const p = u.group.position;
    const pv = u._antPrev;
    const vx = (p.x - pv.x) / dt, vz = (p.z - pv.z) / dt;
    const wy = normAngle(u.group.rotation.y - pv.ry) / dt;
    pv.x = p.x; pv.z = p.z; pv.ry = u.group.rotation.y;
    if (!u.alive) continue;
    const ry = u.group.rotation.y;
    // 로컬 성분: 전진 속도(fwd) → 뒤로 젖혀짐, 횡/선회 → 옆으로 낭창
    const fwd = vx * Math.sin(ry) + vz * Math.cos(ry);
    const side = vx * Math.cos(ry) - vz * Math.sin(ry);
    const tx = THREE.MathUtils.clamp(fwd * 0.22, -0.85, 0.85);
    const tz = THREE.MathUtils.clamp(side * 0.16 + wy * 0.5, -0.85, 0.85);
    // 무른 스프링 + 약한 감쇠 — 멈춘 뒤에도 몇 번 크게 낭창거린다
    const K = 20, DAMP = 2.1;
    u._antVel.x += (tx - u.antenna.rotation.x) * K * dt;
    u._antVel.z += (tz - u.antenna.rotation.z) * K * dt;
    const dmp = Math.exp(-DAMP * dt);
    u._antVel.x *= dmp; u._antVel.z *= dmp;
    u.antenna.rotation.x += u._antVel.x * dt;
    u.antenna.rotation.z += u._antVel.z * dt;
  }
}

// ── 실전차 느낌의 절차 합성 사운드 ──
// 발사: 초고역 크랙 + 노이즈 몸통 + 서브 붐(60→28Hz).
// 폭발: 딥 서브 드롭 + 길게 구르는 저역 럼블 + 잔해 크래클.
// 엔진: 주행 중 저역 노이즈 + 부밍 험 루프 (참조 카운트).
function noiseBuffer(dur) {
  const buf = actx.createBuffer(1, Math.ceil(actx.sampleRate * dur), actx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    // 핑크빛 노이즈 (1차 저역 누적) — 화이트보다 묵직하다
    const w = Math.random() * 2 - 1;
    last = last * 0.82 + w * 0.18;
    d[i] = last * 3.2;
  }
  return buf;
}
function playNoise({ dur, filterType = 'lowpass', freq0 = 800, freq1 = null, q = 0.8, gain0 = 0.2, atk = 0.005 }) {
  const t = actx.currentTime;
  const src = actx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const f = actx.createBiquadFilter();
  f.type = filterType; f.Q.value = q;
  f.frequency.setValueAtTime(freq0, t);
  if (freq1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain0, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(actx.destination);
  src.start(t); src.stop(t + dur + 0.05);
}
function playSub({ f0, f1, dur, gain0 = 0.5, type = 'sine' }) {
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(18, f1), t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(gain0, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
let engineNodes = null;
let engineUsers = 0;
function engineOn() {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    engineUsers++;
    if (engineNodes) return;
    // 디젤 럼블: 저역 노이즈 + 60Hz 부밍(느린 LFO로 부하 변동)
    const src = actx.createBufferSource();
    src.buffer = noiseBuffer(2.0); src.loop = true;
    const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160; f.Q.value = 0.6;
    const hum = actx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 52;
    const humF = actx.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 110;
    const lfo = actx.createOscillator(); lfo.frequency.value = 6.5;
    const lfoG = actx.createGain(); lfoG.gain.value = 5;
    lfo.connect(lfoG).connect(hum.frequency);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, actx.currentTime + 0.25);
    src.connect(f).connect(g);
    hum.connect(humF).connect(g);
    g.connect(actx.destination);
    src.start(); hum.start(); lfo.start();
    engineNodes = { src, hum, lfo, g };
  } catch { /* ignore */ }
}
// 빗소리 앰비언스: 첫 입력 제스처에서 시작 (오토플레이 제한 회피)
let rainAudioNodes = null;
function rainAmbienceOn() {
  if (ENV.rainCount === 0 || rainAudioNodes) return;
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const src = actx.createBufferSource();
    src.buffer = noiseBuffer(3.0); src.loop = true;
    const f = actx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = WEATHER === 'storm' ? 850 : 1500; f.Q.value = 0.35;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(WEATHER === 'storm' ? 0.07 : 0.035, actx.currentTime + 1.5);
    src.connect(f).connect(g).connect(actx.destination);
    src.start();
    rainAudioNodes = { src, g };
  } catch { /* ignore */ }
}
window.addEventListener('pointerdown', rainAmbienceOn, { once: true });

function engineOff() {
  engineUsers = Math.max(0, engineUsers - 1);
  if (engineUsers > 0 || !engineNodes) return;
  try {
    const n = engineNodes; engineNodes = null;
    const t = actx.currentTime;
    n.g.gain.cancelScheduledValues(t);
    n.g.gain.setValueAtTime(n.g.gain.value, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    setTimeout(() => { try { n.src.stop(); n.hum.stop(); n.lfo.stop(); } catch {} }, 600);
  } catch { /* ignore */ }
}
function sfx(kind) {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    if (kind === 'fire') {
      // 주포 발사: 크랙(고역) + 총구 폭풍(중저역) + 서브 붐
      playNoise({ dur: 0.06, filterType: 'highpass', freq0: 2600, gain0: 0.28, atk: 0.002 });
      playNoise({ dur: 0.42, filterType: 'lowpass', freq0: 900, freq1: 120, gain0: 0.34, atk: 0.004 });
      playSub({ f0: 68, f1: 26, dur: 0.5, gain0: 0.5 });
    } else if (kind === 'explode') {
      // 폭발: 서브 드롭 + 길게 구르는 럼블 + 크래클
      playSub({ f0: 52, f1: 20, dur: 1.15, gain0: 0.6 });
      playNoise({ dur: 1.5, filterType: 'lowpass', freq0: 420, freq1: 60, gain0: 0.42, atk: 0.006 });
      playNoise({ dur: 0.35, filterType: 'bandpass', freq0: 1600, q: 1.2, gain0: 0.14, atk: 0.003 });
    } else if (kind === 'hit') {
      playNoise({ dur: 0.22, filterType: 'lowpass', freq0: 1400, freq1: 200, gain0: 0.2, atk: 0.003 });
      playSub({ f0: 90, f1: 40, dur: 0.18, gain0: 0.2 });
    } else if (kind === 'thunder') {
      // 천둥: 서브 드롭 + 오래 구르는 저역 럼블
      playSub({ f0: 58, f1: 20, dur: 2.4, gain0: 0.4 });
      playNoise({ dur: 3.0, filterType: 'lowpass', freq0: 320, freq1: 45, gain0: 0.3, atk: 0.03 });
    } else if (kind === 'splash') {
      playNoise({ dur: 0.4, filterType: 'bandpass', freq0: 700, q: 1.4, gain0: 0.16, atk: 0.02 });
    } else if (kind === 'step') {
      // 궤도 링크 철컥임
      playNoise({ dur: 0.07, filterType: 'bandpass', freq0: 500 + Math.random() * 250, q: 2.5, gain0: 0.06, atk: 0.004 });
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const turnLabel = document.getElementById('turn-label');
const hintEl = document.getElementById('hint');
const crumbsEl = document.getElementById('crumbs');
const chipRun = document.getElementById('chip-run');
const chipUndo = document.getElementById('chip-undo');
document.getElementById('env-label').textContent = ` · ${WX_LABEL} · ${TOD_LABEL}`;
const btnRestart = document.getElementById('btn-restart');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnAgain = document.getElementById('btn-again');
// ── 탱크 섬네일 HUD: 좌상단 플레이어 / 우상단 적 세로 스택.
// 오프스크린으로 킷을 히어로 앵글 렌더해 초상화로 쓰고,
// 레벨·차종·HP 그래프 오버레이. 터치하면 상세 패널 토글.
function renderKitPortraits(keys) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(112, 112);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x667755, 1.15));
  const dl = new THREE.DirectionalLight(0xfff2d8, 1.7);
  dl.position.set(3, 5, 4);
  sc.add(dl);
  const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  cam.position.set(2.6, 2.1, 3.2);
  cam.lookAt(0, 0.85, 0);
  const out = {};
  for (const k of keys) {
    const kit = buildKitTank(k);
    kit.group.rotation.y = 0.6;
    sc.add(kit.group);
    r.render(sc, cam);
    out[k] = r.domElement.toDataURL();
    sc.remove(kit.group);
  }
  r.dispose();
  return out;
}
const thumbDetail = document.getElementById('thumb-detail');
const thumbPlayerEl = document.getElementById('thumb-player');
const thumbEnemiesEl = document.getElementById('thumb-enemies');
var thumbsReady = false; // var: 초기 spawnUnit의 updateHpBar 호출 시 TDZ 방지
let detailFor = null; // 'player' | enemy index
function unitDetailHTML(u) {
  const g = u.gun;
  const gunTxt = g.sponson ? `측면 부포 90°±${g.arc}°` : g.fixed ? `고정포 ±${g.arc}°` : '포탑 선회';
  return `<b>${KIT_INFO[u.kitKey].label}</b><br>
HP ${Math.max(0, u.hp)} / ${u.maxHp}<br>
차체 Lv${u.hullLv} · ${u.isPlayer ? '조종' : 'AI'} Lv${u.driverLv}<br>
${gunTxt} · 부앙 ${g.pitchMin}°~+${g.pitchMax}°<br>
재장전 ${g.reload}턴${u.reloadLeft > 0 ? ` (남은 ${u.reloadLeft})` : ''} · 기동 ${u.mp}${u.boostTurns > 0 ? ` ⚡+4(${u.boostTurns}턴)` : ''} · 사거리 ${u.fireRange}`;
}
function makeThumb(el, u, portrait, label) {
  el.innerHTML = `<img src="${portrait}" alt=""><span class="tag">${label}</span><span class="lv">Lv${u.driverLv}</span><span class="hpbar"><i style="width:100%"></i></span>`;
}
// 섬네일 탭 → 해당 전차로 카메라 이동 (오프셋 유지, 부드럽게)
function focusCamera(u) {
  const from = controls.target.clone();
  const off = camera.position.clone().sub(controls.target);
  const to = u.group.position.clone();
  to.y += 1;
  tween(500, (e) => {
    controls.target.lerpVectors(from, to, e);
    camera.position.copy(controls.target).add(off);
  }, easeOut);
}
{
  const portraits = renderKitPortraits([playerKit, enemyKit]);
  makeThumb(thumbPlayerEl, player, portraits[playerKit], KIT_INFO[playerKit].label);
  enemies.forEach((e, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    makeThumb(div, e, portraits[enemyKit], KIT_INFO[enemyKit].label);
    div.addEventListener('click', () => {
      if (e.hidden && e.alive) { setHint('🌫 시야 밖 — 위치를 알 수 없다'); return; }
      focusCamera(e);
      if (detailFor === i) { detailFor = null; thumbDetail.classList.remove('show'); return; }
      detailFor = i;
      thumbDetail.className = 'panel right show';
      thumbDetail.innerHTML = unitDetailHTML(e);
    });
    thumbEnemiesEl.appendChild(div);
    e._thumbEl = div;
  });
  thumbPlayerEl.addEventListener('click', () => {
    focusCamera(player);
    if (detailFor === 'player') { detailFor = null; thumbDetail.classList.remove('show'); return; }
    detailFor = 'player';
    thumbDetail.className = 'panel show';
    thumbDetail.innerHTML = unitDetailHTML(player);
  });
  thumbsReady = true;
}
function updateThumbs() {
  if (!thumbsReady) return;
  const setHp = (el, u) => {
    const bar = el.querySelector('.hpbar i');
    if (bar) bar.style.width = `${Math.max(0, (u.hp / u.maxHp) * 100)}%`;
    el.classList.toggle('dead', !u.alive);
    el.classList.toggle('hid', !!u.hidden && u.alive);
  };
  setHp(thumbPlayerEl, player);
  for (const e of enemies) if (e._thumbEl) setHp(e._thumbEl, e);
  if (detailFor === 'player') thumbDetail.innerHTML = unitDetailHTML(player);
  else if (typeof detailFor === 'number' && enemies[detailFor]) thumbDetail.innerHTML = unitDetailHTML(enemies[detailFor]);
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

// ⚙ 설정 다이얼로그: 재시작/게임 종료(차고)를 구석으로 몰아넣음
const settingsEl = document.getElementById('settings');
document.getElementById('btn-settings').addEventListener('click', () => settingsEl.classList.add('show'));
document.getElementById('btn-close-settings').addEventListener('click', () => settingsEl.classList.remove('show'));
settingsEl.addEventListener('click', (ev) => { if (ev.target === settingsEl) settingsEl.classList.remove('show'); });
document.getElementById('settings-env').textContent = `${WX_LABEL} · ${TOD_LABEL} · 시드 ${seed}`;

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
// 전면 방향 표식 — 어느 쪽이 차체 전면인지 확실히 보이도록:
// 큰 주황 화살표 + 전면 범퍼 발광 바 + 이중 셰브론 (전부 depthTest 없이 항상 보임)
function makeFrontMarker(scale = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4 * scale, 1.1 * scale, 3), mat);
  arrow.rotation.x = Math.PI / 2;
  arrow.scale.y = 0.5; // 납작
  arrow.position.set(0, 0.14, 2.05 * scale);
  arrow.renderOrder = 13;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3 * scale, 0.07, 0.09), mat);
  bar.position.set(0, 0.6, 1.12 * scale);
  bar.renderOrder = 13;
  const chev = new THREE.Mesh(new THREE.ConeGeometry(0.24 * scale, 0.55 * scale, 3), mat);
  chev.rotation.x = Math.PI / 2;
  chev.scale.y = 0.5;
  chev.position.set(0, 0.14, 1.35 * scale);
  chev.renderOrder = 13;
  g.add(arrow, bar, chev);
  return g;
}
const ghostArrow = makeFrontMarker(1);
ghost.add(ghostArrow);
function showGhost(cell, facing, turretYaw = null) {
  const p = cellToWorld(cell.gx, cell.gz);
  ghost.position.set(p.x, standHeight(cell.gx, cell.gz), p.z);
  ghost.rotation.y = facing;
  if (ghostKit.turret) ghostKit.turret.rotation.y = turretYaw === null ? 0 : normAngle(turretYaw - facing);
  ghost.visible = true;
}

// 다중 턴 계획: 한 번에 최대 3턴 예약 (아래 예약 고스트 풀이 참조)
const PLAN_AHEAD = 3; // 카드 3장 = 한 라운드 3서브턴
// 예약 고스트 풀: 예약된 각 이동의 도착 자세를 옅은 홀로그램으로 미리 보여준다
const queueGhostMat = new THREE.MeshBasicMaterial({
  color: 0x7fd4c8, transparent: true, opacity: 0.26, depthWrite: false,
});
const queueGhosts = [];
for (let i = 0; i < PLAN_AHEAD; i++) {
  const gk = buildKitTank(playerKit);
  gk.group.traverse((o) => {
    if (o.isMesh && o !== gk.hitbox) { o.material = queueGhostMat; o.castShadow = false; o.receiveShadow = false; }
  });
  gk.hitbox.visible = false;
  gk.group.visible = false;
  gk.group.add(makeFrontMarker(0.85)); // 예약 고스트에도 전면 표식
  // 순번 라벨
  const badge = makeQueueBadge(i + 1);
  badge.position.set(0, 3.2, 0);
  gk.group.add(badge);
  gk._badge = badge;
  scene.add(gk.group);
  queueGhosts.push(gk);
}
function makeQueueBadge(n) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(30,120,110,0.92)';
  ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 32, 36);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.scale.set(0.9, 0.9, 1);
  sp.renderOrder = 12;
  return sp;
}
// 예약 경로 연결선
const queueLineMat = new THREE.LineBasicMaterial({ color: 0x4fd0c0, transparent: true, opacity: 0.8, depthTest: false });
let queueLine = null;
let lastMoveGhost = null; // 예약된 마지막 이동의 고스트(=사격 출발점), 없으면 null
function drawQueueGhosts() {
  for (const gk of queueGhosts) gk.group.visible = false;
  if (queueLine) { scene.remove(queueLine); queueLine.geometry.dispose(); queueLine = null; }
  lastMoveGhost = null;
  let cx = player.gx, cz = player.gz;
  const pts = [new THREE.Vector3(player.group.position.x, standHeight(player.gx, player.gz) + 0.3, player.group.position.z)];
  let gi = 0;
  for (const p of planQueue) {
    if (p.type === 'move' && p.path && p.path.length) {
      const l = p.path[p.path.length - 1];
      cx = l.gx; cz = l.gz;
      const gk = queueGhosts[gi++];
      if (gk) {
        const wp = cellToWorld(cx, cz);
        gk.group.position.set(wp.x, standHeight(cx, cz), wp.z);
        const facing = p.endDir != null ? dirAngle(p.endDir) : gk.group.rotation.y;
        gk.group.rotation.y = facing;
        if (gk.turret) gk.turret.rotation.y = p.turretYaw != null ? normAngle(p.turretYaw - facing) : 0;
        gk.group.visible = true;
        gk._gx = cx; gk._gz = cz;
        lastMoveGhost = gk; // 사격은 마지막 고스트 지점에서
      }
      pts.push(new THREE.Vector3(cellToWorld(cx, cz).x, standHeight(cx, cz) + 0.3, cellToWorld(cx, cz).z));
    }
  }
  if (pts.length > 1) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    queueLine = new THREE.Line(geo, queueLineMat);
    queueLine.renderOrder = 11;
    scene.add(queueLine);
  }
}
// 사격 출발점: 예약된 이동이 있으면 그 고스트, 없으면 현재 전차
function fireOrigin() {
  if (lastMoveGhost) {
    return {
      gx: lastMoveGhost._gx, gz: lastMoveGhost._gz,
      pos: lastMoveGhost.group.position, group: lastMoveGhost.group,
      turret: lastMoveGhost.turret, hitbox: lastMoveGhost.hitbox, ghost: true,
    };
  }
  return {
    gx: player.gx, gz: player.gz, pos: player.group.position, group: player.group,
    turret: player.turret, hitbox: player.hitbox, ghost: false,
  };
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
// 명령 대기 하이라이트: 계획 단계에 내 전차 발밑에서 시안 링이 숨쉰다 —
// "지금 이 전차에게 명령하는 중"이라는 표시
const cmdRing = new THREE.Mesh(
  new THREE.RingGeometry(1.35, 1.62, 36, 1),
  new THREE.MeshBasicMaterial({ color: 0x59d8ff, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
);
cmdRing.rotation.x = -Math.PI / 2;
cmdRing.visible = false;
noAO(cmdRing);
scene.add(cmdRing);

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
  const fo = fireOrigin();
  const p = fo.pos;
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
const SNAP_PENALTY = 8; // 경계 스냅 명중 페널티 완화
const dirAngle = (d) => Math.atan2(DIRS[d].dx, DIRS[d].dz);
let currentMoveCells = new Map();
let currentFireCells = new Map();
// ── 다중 턴 계획: 한 번에 최대 3턴 예약, 이동 후 도착 고스트에서 이어서 계획 ──
let planQueue = [];   // 예약된 플레이어 플랜(move/fire/overwatch/wait) 리스트
let projReload = 0;   // 지금 계획 중인 액션 시점의 예상 재장전 잔여

// 예약된 플랜들을 반영한 "지금 계획 중인 액션의 출발 상태"
function projectedOrigin() {
  let gx = player.gx, gz = player.gz, dir = facingDir(player), reload = player.reloadLeft;
  for (const p of planQueue) {
    if (p.type === 'fire') reload = Math.max(0, (player.gun?.reload ?? 2) - 1);
    else reload = Math.max(0, reload - 1); // 다음 턴 시작 시 감소
    if (p.type === 'move' && p.path && p.path.length) {
      const l = p.path[p.path.length - 1];
      gx = l.gx; gz = l.gz;
      if (p.endDir != null) dir = p.endDir;
    }
  }
  return { gx, gz, dir, reload };
}
// 투영 상태로 player를 잠시 바꿔 필드/도달셀을 계산 (렌더 전에 원복)
function withProjectedPlayer(fn) {
  const o = projectedOrigin();
  const sgx = player.gx, sgz = player.gz, sry = player.group.rotation.y;
  player.gx = o.gx; player.gz = o.gz; player.group.rotation.y = dirAngle(o.dir);
  try { return fn(o); } finally {
    player.gx = sgx; player.gz = sgz; player.group.rotation.y = sry;
  }
}

// ---------------------------------------------------------------------------
// 전술 카드 덱 — 완전한 가위바위보: 전술은 정해져 있고, 조합·순서만 고른다.
// 덱 20장(공격은 5장뿐), 라운드마다 5장 드로 → 최대 3장을 순서대로 사용.
// 실행 시 주사위 2개(2d6)로 운을 굴린다 — 잘 나오면 명중·전술 보정.
// ---------------------------------------------------------------------------
// 이동은 "적 기준" — 돌격(간격 좁힘)/회피(옆으로 틀며 간격 유지)/후퇴(간격 벌림).
// 공격은 직사·곡사를 가리지 않는 통합 카드, 엄호는 표적이 없어도 허공에 제압사격.
// 이동 카드와 공격/엄호 카드를 연달아 내면 한 서브턴에 "이동하며 사격"한다.
// ── 기본 5장 (차체 기준) — 전차전 교리 리팩토링 ──
// 전진/후진/좌/우/공격. 같은 카드를 실행 중에 얹으면 "단계"가 오른다:
//  전진: 전진 → 돌격 → 전속돌파 (속도↑, 명중↓, 노출↑)
//  후진: 후진 → 급후진 → 긴급이탈 (전면을 문 채 이탈)
//  좌/우: 선회 전진 → 측면전개(제동→선회→새 방향 전진) → 우회(측후면 진입)
//  공격: 즉응사격 → 조준 → 정밀사격 (연사가 아니라 사격 "품질" 강화)
// durMs = 그 전술이 점유하는 명령 슬롯 시간 (애니메이션 길이가 아님)
const CARD_DEFS = {
  fwd: { key: 'fwd', label: '전진', ico: '⬆️', kind: 'move', mv: 'fwd', typ: '이동', cls: 'move', durMs: 4000 },
  back: { key: 'back', label: '후진', ico: '⬇️', kind: 'move', mv: 'back', typ: '이동', cls: 'move', durMs: 4000 },
  left: { key: 'left', label: '좌', ico: '↰', kind: 'move', mv: 'left', typ: '이동', cls: 'move', durMs: 3500 },
  right: { key: 'right', label: '우', ico: '↱', kind: 'move', mv: 'right', typ: '이동', cls: 'move', durMs: 3500 },
  atk: { key: 'atk', label: '공격', ico: '🎯', kind: 'atk', typ: '공격', cls: 'fire', durMs: 2000 },
};
// 이동 카드 단계별 표시명
const MOVE_NAMES = {
  fwd: ['전진', '돌격', '전속돌파'],
  back: ['후진', '급후진', '긴급이탈'],
  left: ['좌선회 전진', '좌측전개', '좌측우회'],
  right: ['우선회 전진', '우측전개', '우측우회'],
};
const FIRE_NAMES = ['즉응사격', '조준사격', '정밀사격'];
// 재장전: 차종 reload(턴) × 3초 — 공격 카드를 재장전 중에 내면 제자리에서
// 장전을 기다렸다 쏜다 (그동안 새 기동 불가 — 성급한 공격의 대가)
const RELOAD_MS_PER = 3000;
const DECK_LIST = [
  'fwd', 'fwd', 'fwd', 'fwd', 'back', 'back', 'back', 'back',
  'left', 'left', 'left', 'left', 'right', 'right', 'right', 'right',
  'atk', 'atk', 'atk', 'atk',
];
let drawPile = shuffle(DECK_LIST.slice());
let discardPile = [];
let hand = [];          // [{ def }]
let activeCard = null;  // (호환용 — 리얼타임에선 항상 null)
const HAND_MAX = 5;
const REFILL_MS = 3000; // 쓰든 안 쓰든 3초마다 1장 (핸드가 가득이면 대기)
let refillT0 = 0;
// 리얼타임 행동 락: 이동은 한 번에 하나, 사격도 한 번에 하나 —
// 단 이동 "중"에도 사격 카드는 즉시 발사된다 (기동 사격)
let playerMoveBusy = false;
let playerFireBusy = false;
let fieldsDirty = true; // 필드(이동/사격 범위) 갱신 예약 — 애니 루프에서 스로틀 처리
const handEl = document.getElementById('hand');
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function drawOne() {
  if (!drawPile.length) { drawPile = shuffle(discardPile); discardPile = []; }
  return drawPile.length ? { def: CARD_DEFS[drawPile.pop()] } : null;
}
// 카드 덱/핸드는 제거됐다 (조작은 하단 액션 바). 아래는 구 턴 머신 잔재가
// 호출해도 안전하도록 남긴 무동작 스텁.
function renderHand() {}
let selectedCard = null;   // 1탭 선택(확대) → 재탭/위로 드래그 = 사용
let lastDealt = null;      // 방금 덱에서 온 카드 — 딜 애니메이션용
let handGestureActive = false; // 스와이프 중 리필이 DOM을 갈아치우지 않게
let handRenderPending = false;
let curMoveDef = null;     // 실행 중인 이동 카드 (얹기 판정용)
let curMoveLevel = 1;      // 이동 단계: 1 기본 / 2 돌격·전개 / 3 돌파·우회
let fireStage = null;      // 공격 조준 단계: { level, extendMs, fired }
// ── 사격 전용 조작 (이동은 자동 조종) ──
// 플레이어는 직격/곡사 발사와 아이템 사용만 한다. 같은 사격 버튼을 조준 창
// 안에서 다시 누르면 조준이 강화된다(즉응→조준→정밀). 재장전은 시간 기반.
function startFire(lob) {
  if (phase === 'gameover' || !player.alive) return;
  const fs = fireStage;
  if (fs && !fs.fired && !fs.cancelled) {
    if (fs.lob === lob) { levelUpFire(); return; } // 같은 모드 재탭 = 조준 강화
    cancelFire();                                  // 다른 모드 = 조준 접고 새로
  }
  if (playerFireBusy) return; // 취소 정리 중 — 다음 탭에서
  runFire(1, lob);
}
function cancelFire() {
  if (fireStage) fireStage.cancelled = true;
  player._steady = false;
  player._abortMove = false;
}
// 같은 사격 반복 = 연사가 아니라 조준 강화: 발사를 늦추는 대신 명중이 오르고
// (3단은 약점 피해 1.25배), 그만큼 자리에 묶여 노출된다.
function levelUpFire() {
  if (!fireStage || fireStage.fired) return;
  fireStage.level = Math.min(3, fireStage.level + 1);
  fireStage.extendMs += fireStage.level === 2 ? 1700 : 1600;
  if (fireStage.level >= 2) steadyForAim(); // 정조준은 사수를 위해 차를 세운다
  cardPop({ ico: fireStage.lob ? '💫' : '🎯', label: `${FIRE_NAMES[fireStage.level - 1]} 준비` }, '', '#ffe9a8');
}
// 정조준: 사수가 확실히 맞히도록 조종수가 차를 세운다 (기동을 접는다)
function steadyForAim() {
  player._steady = true;
  player._abortMove = true;
}
// 사격 러너: 재장전 대기(시간) → 조준 창(재탭 승급) → 발사.
// lob=true 곡사(포물선, 능선 너머·헐다운 관통), false 직격(직사, 사선 필요).
async function runFire(initLevel, lob) {
  playerFireBusy = true;
  fireStage = {
    level: initLevel, lob,
    extendMs: initLevel === 2 ? 1700 : initLevel === 3 ? 3300 : 0,
    fired: false, cancelled: false, phase: 'aim', t0: performance.now(), waitDur: 0,
  };
  if (initLevel >= 2) steadyForAim();
  try {
    const now0 = performance.now();
    if ((player.reloadReadyAt ?? 0) > now0) {
      const wait = player.reloadReadyAt - now0;
      fireStage.phase = 'reload'; fireStage.t0 = now0; fireStage.waitDur = wait;
      cardPop({ ico: lob ? '💫' : '🎯', label: `재장전 ${(wait / 1000).toFixed(1)}s` }, '', '#ffd76e');
      let w = 0;
      while (w < wait && !fireStage.cancelled && player.alive) { await delay(100); w += 100; }
      if (fireStage.cancelled || !player.alive || phase === 'gameover') return;
      fireStage.phase = 'aim'; fireStage.t0 = performance.now();
    }
    // 조준 창: 즉응 0.6초 + 승급 연장 — 이 사이 같은 버튼을 누르면 조준/정밀
    let waited = 0;
    while (waited < 600 + fireStage.extendMs) {
      await delay(120); waited += 120;
      if (fireStage.cancelled || !player.alive || phase === 'gameover') return;
    }
    fireStage.fired = true;
    const lvl = fireStage.level;
    const moving = playerMoveBusy && !player._steady;
    const aimBonus = lvl === 1 ? 0 : lvl === 2 ? (moving ? 8 : 15) : (moving ? 15 : 30);
    const fp = materializeFire(fireStage.lob);
    if (!fp) { cardPop({ ico: lob ? '💫' : '🎯', label: lob ? '곡사 불가' : '직격 불가' }, '', '#c8c2b4'); return; }
    cardPop({ ico: lob ? '💫' : '🎯', label: `${lob ? '곡사' : '직격'} ${FIRE_NAMES[lvl - 1]}` });
    player._owPosture = false;
    player.plan = {
      type: 'fire', cell: fp.cell, shot: fp.shot,
      _moved: moving, _aimBonus: aimBonus, _dmgMul: lvl === 3 ? 1.25 : 1,
    };
    await resolvePlannedShot(player);
    player.plan = null;
  } finally {
    playerFireBusy = false;
    fireStage = null;
    player._steady = false;
    player._abortMove = false; // 정조준으로 세운 신호 회수 — 다음 자동 기동 오염 방지
    fieldsDirty = true;
  }
}

// ── 자동 조종 드라이버 AI ──
// 사수(플레이어)가 잘 쏘도록 조종수가 알아서 기동한다: 사격각이 서는 자리로,
// 헐다운 엄폐를 끼고, 아이템을 주우며, 전면장갑을 최대 위협에게 문 채,
// HP가 낮거나 재장전 중이면 간격을 벌린다.
function decideDriver() {
  const near = nearestEnemy();
  if (!near) return { type: 'wait' };
  const lowHp = player.hp < player.maxHp * 0.35;
  const reloading = (player.reloadReadyAt ?? 0) > performance.now();
  const canSee = !near.hidden && Math.hypot(player.gx - near.gx, player.gz - near.gz) <= VIS_LIMIT;
  const ideal = Math.min(player.fireRange - 1, 9); // 적정 교전 거리
  const exposurePenalty = (gx, gz, endDir) => {
    const fd = DIRS[endDir];
    const rel = Math.abs(normAngle(
      Math.atan2(near.gx - gx, near.gz - gz) - Math.atan2(fd.dx, fd.dz)
    )) * (180 / Math.PI);
    return rel >= 120 ? 40 : rel > 60 ? 18 : 0; // 후면/측면을 적에게 내주면 감점
  };
  const cells = reachableCells(player);
  let best = null;
  for (const [key, info] of cells) {
    const [gx, gz] = key.split(',').map(Number);
    let score = -info.cost;
    if (canSee) {
      const sh = computeShot(player, { unit: near }, { gx, gz });
      if (sh.ok) score += 130 + sh.chance;           // 사선이 서는 자리 최우선
    }
    if (hullDownCells.has(key)) score += 42;          // 헐다운 엄폐
    for (const st of info.path) if (items.has(cellKey(st.gx, st.gz))) score += 55; // 길목 아이템
    const d = Math.hypot(gx - near.gx, gz - near.gz);
    score -= Math.abs(d - ideal) * 4;                 // 적정 거리 유지
    if (lowHp || reloading) score += d * 5;           // 위태로우면 간격 벌림
    score -= exposurePenalty(gx, gz, info.endDir);
    if (!best || score > best.score) best = { score, info, gx, gz };
  }
  // 제자리 점수 — 지금 자세가 이미 좋으면 굳이 움직이지 않는다 (지터 방지)
  let stay = -2;
  if (canSee) { const sh = computeShot(player, { unit: near }); if (sh.ok) stay += 130 + sh.chance; }
  if (hullDownCells.has(cellKey(player.gx, player.gz))) stay += 42;
  const dNow = Math.hypot(player.gx - near.gx, player.gz - near.gz);
  stay -= Math.abs(dNow - ideal) * 4;
  if (lowHp || reloading) stay += dNow * 5;
  stay -= exposurePenalty(player.gx, player.gz, facingDir(player));
  if (best && best.info.path.length && best.score > stay + 12) { // 히스테리시스
    return { type: 'move', path: best.info.path.slice() };
  }
  return { type: 'wait' };
}
let driverPaused = false; // 테스트용: 자동 조종 일시정지
async function playerDriverLoop() {
  await delay(1200);
  while (player.alive && phase !== 'gameover') {
    await delay(1300 + rng() * 900);
    if (!player.alive || phase === 'gameover') break;
    if (driverPaused || player._steady || playerMoveBusy) continue; // 정지/조준/기동 중이면 쉼
    if (player.boostTurns > 0) player.boostTurns -= 1;
    const plan = decideDriver();
    if (plan.type !== 'move' || !plan.path?.length) continue;
    playerMoveBusy = true;
    player._dash = player.boostTurns > 0;
    player._dashMul = 1.5;
    const from = { gx: player.gx, gz: player.gz };
    try { await moveUnit(player, plan.path, null); }
    catch { /* 격파 등 — 루프 조건이 정리 */ }
    finally {
      playerMoveBusy = false; player._dash = false; player._dashMul = 1;
      playerLastMove = { dx: player.gx - from.gx, dz: player.gz - from.gz }; // 적 리드 예측용
      fieldsDirty = true;
    }
  }
}

// ── 아이템: 자동 수집 → 인벤토리 → 버튼으로 사용 ──
function useItem(idx) {
  if (phase === 'gameover' || !player.alive) return;
  const inv = player.inventory;
  const type = inv[idx];
  if (!type) return;
  inv.splice(idx, 1);
  if (type === 'repair') {
    player.hp = Math.min(player.maxHp, player.hp + 40);
    updateHpBar(player); updatePlayerHpUI();
    popText(player.group.position.clone().add(new THREE.Vector3(0, 1.6, 0)), '🔧 +40 HP', '#8df08f');
    sfx('hit');
  } else {
    player.boostTurns = 4;
    popText(player.group.position.clone().add(new THREE.Vector3(0, 1.6, 0)), '⚡ 기동 부스트!', '#ffd24d');
    sfx('hit');
  }
  updateActionBar();
}

// ── 하단 액션 바: 직격·곡사 버튼(조준 pip + 재장전 쿨다운) + 아이템 트레이 ──
const fireBtnDirect = document.getElementById('btn-direct');
const fireBtnLob = document.getElementById('btn-lob');
const itemTrayEl = document.getElementById('item-tray');
if (fireBtnDirect) {
  const ic = fireBtnDirect.querySelector('.ico'); if (ic) ic.innerHTML = CARD_ICONS.atk;
  fireBtnDirect.addEventListener('click', () => startFire(false));
}
if (fireBtnLob) {
  const ic = fireBtnLob.querySelector('.ico'); if (ic) ic.innerHTML = CARD_ICONS.lob;
  fireBtnLob.addEventListener('click', () => startFire(true));
}
function updateActionBar() {
  const now = performance.now();
  const reloadLeft = Math.max(0, (player.reloadReadyAt ?? 0) - now);
  const reloadDur = (player.gun?.reload ?? 2) * RELOAD_MS_PER;
  const fs = fireStage;
  const dead = phase === 'gameover' || !player.alive;
  for (const el of [fireBtnDirect, fireBtnLob]) {
    if (!el) continue;
    const isLob = el === fireBtnLob;
    const staging = !!(fs && !fs.fired && fs.lob === isLob);
    const lvl = staging ? fs.level : 0;
    el.classList.toggle('staging', staging);
    el.classList.toggle('cool', reloadLeft > 0 && !staging);
    el.disabled = dead;
    const pips = el.querySelector('.pips');
    if (pips) pips.innerHTML = [1, 2, 3].map((n) => `<i class="${n <= lvl ? 'on' : ''}"></i>`).join('');
    const cd = el.querySelector('.cd');
    if (cd) cd.style.height = reloadLeft > 0 && !staging ? `${Math.min(100, (reloadLeft / reloadDur) * 100).toFixed(0)}%` : '0%';
  }
  if (itemTrayEl) {
    const inv = player.inventory;
    const sig = inv.join(',');
    if (itemTrayEl._sig !== sig) {
      itemTrayEl._sig = sig;
      itemTrayEl.innerHTML = inv.map((t, i) =>
        `<button class="item-btn ${t}" data-idx="${i}" title="${t === 'repair' ? '수리킷 (+40 HP)' : '연료 (기동 부스트)'}">${t === 'repair' ? '🔧' : '⚡'}</button>`).join('');
      itemTrayEl.querySelectorAll('.item-btn').forEach((b) =>
        b.addEventListener('click', () => useItem(+b.dataset.idx)));
    }
  }
}
// 가장 가까운 적 (안개 속에서도 엔진 소리로 대략적 위치는 안다)
function nearestEnemy() {
  let best = null, bd = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(e.gx - player.gx, e.gz - player.gz);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
// 카드 방향의 기준각: 가장 가까운 적을 향한 방향이 '전방'이다 — 차체가
// 어디를 보고 있든 전진 = 적에게, 후진 = 적 반대로. 예측 가능성이 우선.
// (적이 전멸/부재면 차체 방향 폴백)
function cardBaseAngle() {
  const near = nearestEnemy();
  return near ? Math.atan2(near.gx - player.gx, near.gz - player.gz) : player.group.rotation.y;
}
// 적 기준 상대각(도): 0 적 방향, ±180 적 반대, +우 / −좌
function cardRelDeg(gx, gz, base = cardBaseAngle()) {
  return normAngle(Math.atan2(gx - player.gx, gz - player.gz) - base) * (180 / Math.PI);
}
// 셀이 어느 이동 카드 방향인지 — 적 쪽 ≤50° / 적 반대 ≥132° / 그 사이 좌·우
function arcOfRel(rel) {
  const a = Math.abs(rel);
  if (a <= 50) return 'fwd';
  if (a >= 132) return 'back';
  return rel > 0 ? 'right' : 'left';
}
const cardPop = (def, extra = '', col = '#e8e4d8') => {
  const p = player.group.position.clone();
  p.y += 1.9;
  popText(p, `${def.ico} ${def.label}${extra}`, col);
};
// 이동 카드 구체화 (차체 기준 호 + 단계) — 사격각·아이템·헐다운을 챙기고,
// 좌/우 3단(우회)은 적의 측후면 각도가 서는 위치에 큰 가산.
function materializeMove(def, level = 1) {
  const near = nearestEnemy();
  const base = cardBaseAngle();
  const cand = [];
  for (const [k, info] of reachableCells(player)) {
    const [gx, gz] = k.split(',').map(Number);
    if (arcOfRel(cardRelDeg(gx, gz, base)) !== def.mv) continue;
    let score = -info.cost;
    for (const step of info.path) {
      if (items.has(cellKey(step.gx, step.gz))) score += def.mv === 'back' ? 22 : 48;
    }
    if (hullDownCells.has(k)) score += 25; // 헐다운 = 지형이 주는 방어
    const distMoved = Math.hypot(gx - player.gx, gz - player.gz);
    if (level >= 2) score += distMoved * 6; // 돌격/전개: 크게 움직인다
    if (near) {
      const dNow = Math.hypot(player.gx - near.gx, player.gz - near.gz);
      const dNew = Math.hypot(gx - near.gx, gz - near.gz);
      if (def.mv === 'fwd') {
        // 전진: 접근 + 사격각이 서는 위치
        const sh = !near.hidden ? computeShot(player, { unit: near }, { gx, gz }) : { ok: false };
        score += (sh.ok ? 120 + sh.chance : 0) + (dNow - dNew) * 5;
      } else if (def.mv === 'back') {
        // 후진: 전면을 문 채 간격 회복
        score += (dNew - dNow) * 10;
      } else {
        // 좌/우: 새 사격각 + 진로 변경, 3단 우회는 적 측후면 진입에 큰 가산
        const sh = !near.hidden ? computeShot(player, { unit: near }, { gx, gz }) : { ok: false };
        score += (sh.ok ? 40 + sh.chance * 0.5 : 0) + distMoved * 3;
        if (level >= 3 && !near.hidden) {
          const relE = Math.abs(normAngle(
            Math.atan2(gx - near.gx, gz - near.gz) - near.group.rotation.y
          )) * (180 / Math.PI);
          if (relE >= 120) score += 60;      // 적 후면 각
          else if (relE > 60) score += 32;   // 적 측면 각
        }
      }
    } else {
      score += distMoved;
    }
    cand.push({ score, info, gx, gz });
  }
  if (!cand.length) return { type: 'wait' };
  cand.sort((a, b) => b.score - a.score);
  const pick = cand[0];
  const turretYaw = near ? Math.atan2(near.gx - pick.gx, near.gz - pick.gz) : null;
  let path = pick.info.path.slice();
  // 후진 1단: 돌아서지 않는다 — 전 구간 후진 기어로 전면장갑을 적에게 문 채
  // 저속 이탈. 급후진(2단)부터는 돌아서 빠르게 빠지는 것도 허용 (후면 노출은 대가).
  if (def.mv === 'back' && level === 1) path = path.map((c) => ({ ...c, rev: true }));
  return {
    type: 'move', path, facing: null,
    turretYaw, endDir: pick.info.endDir,
  };
}
// 공격 구체화 — 지정 모드(lob=곡사/false=직격)로 스마트 사수가 최적 표적을
// 고른다. 보이는 적 중 그 모드로 최고 명중을 노리고, 없으면 최근접 적의
// 대략 위치(숨었으면 크게 흔들림)나 전방 허공에라도 그 모드로 쏜다.
function materializeFire(lob) {
  // 보이는 적 중 지정 모드 최고 명중 표적
  let best = null;
  for (const e of enemies) {
    if (!e.alive || e.hidden) continue;
    const shot = computeShot(player, { unit: e }, null, null, lob);
    if (shot.ok && (!best || shot.chance > best.shot.chance)) {
      best = { cell: { gx: e.gx, gz: e.gz }, shot };
    }
  }
  if (best) return best;
  // 표적 없음 → 최근접 적 근처(맹목) 또는 전방 허공
  const near = nearestEnemy();
  let tx, tz;
  if (near) {
    const wob = near.hidden ? 5 : 2;
    tx = THREE.MathUtils.clamp(near.gx + Math.round((Math.random() - 0.5) * wob), 0, GW - 1);
    tz = THREE.MathUtils.clamp(near.gz + Math.round((Math.random() - 0.5) * wob), 0, GH - 1);
  } else {
    const ry = player.group.rotation.y;
    tx = THREE.MathUtils.clamp(Math.round(player.gx + Math.sin(ry) * player.fireRange * 0.6), 0, GW - 1);
    tz = THREE.MathUtils.clamp(Math.round(player.gz + Math.cos(ry) * player.fireRange * 0.6), 0, GH - 1);
  }
  let shot = computeShot(player, { gx: tx, gz: tz }, null, null, lob);
  if (shot.ok) return { cell: { gx: tx, gz: tz }, shot };
  // 그 지점을 지정 모드로 못 때리면 사거리 안에서 가장 가까운 유효 셀 탐색
  let bestCell = null, bd = Infinity;
  for (const [k] of computeFireCells(player)) {
    const [gx, gz] = k.split(',').map(Number);
    const s = computeShot(player, { gx, gz }, null, null, lob);
    if (!s.ok) continue;
    const d = (gx - tx) * (gx - tx) + (gz - tz) * (gz - tz);
    if (d < bd) { bd = d; bestCell = { cell: { gx, gz }, shot: s }; }
  }
  return bestCell;
}
function refreshPlanUI(fireEmphasis = false) {
  if (phase !== 'plan') return;
  const o = withProjectedPlayer((o) => {
    // 이동은 자동 조종이라 이동 필드는 표시하지 않는다. 사거리 안에서 지금
    // 때릴 수 있는 사격 필드(직사=빨강/곡사=주황)와 표적만 보여준다.
    currentMoveCells = new Map();
    currentFireCells = o.reload > 0 ? new Map() : computeFireCells(player);
    clearHighlights();
    showFireField(currentFireCells, fireEmphasis);
    showTargets(
      enemies
        .filter((e) => e.alive && !e.hidden && currentFireCells.has(cellKey(e.gx, e.gz)))
        .map((e) => ({ unit: e, shot: currentFireCells.get(cellKey(e.gx, e.gz)).shot }))
    );
    return o;
  });
  projReload = o.reload;
  drawQueueGhosts();
  renderCrumbs();
}

// 상단 상태줄 (리얼타임): 격파 수 + 현재 자세
function renderCrumbs() {
  const kills = enemies.filter((e) => !e.alive).length;
  let html = `<span class="crumb">💥 ${kills}/${enemies.length}</span>`;
  if (player._owPosture) html += '<span class="crumb pending">👁 경계 자세</span>';
  crumbsEl.innerHTML = html;
  chipRun.hidden = true;
  chipUndo.hidden = true;
}

function startPlanning() {
  if (checkGameEnd()) return;
  phase = 'plan';
  busy = false;
  planQueue = [];
  for (const u of units) if (u.alive && u.reloadLeft > 0) u.reloadLeft -= 1;
  clearPending();
  ghost.visible = false;
  hideBowUI();
  refreshPlanUI();
}

// 단일 턴 즉시 해결 (테스트 훅·경계 버튼용)
async function submitPlan(plan) {
  if (phase !== 'plan' || busy) return;
  player.plan = plan;
  planEnemies();
  await resolveOneTurn();
  if (phase !== 'gameover') startPlanning();
}

// 인터랙티브: 플랜을 큐에 예약. 3턴 차거나 이동할 칸이 없으면 자동 실행.
function enqueuePlan(plan) {
  if (phase !== 'plan' || busy) return;
  // 카드 소비 (_card = 카드 탭 예약, _test = 테스트 훅의 구체 플랜 우회)
  if (!plan._card && !plan._test && (plan.type === 'move' || plan.type === 'fire')) {
    setHint('카드를 탭해 예약하세요');
    return;
  }
  if (plan._card) {
    plan._card.used = true;
    plan._card.slot = planQueue.length + 1;
    if (activeCard === plan._card) activeCard = null;
    fireMode = false;
    renderHand();
  }
  planQueue.push(plan);
  if (planQueue.length >= PLAN_AHEAD) { resolveQueue(); return; }
  ghost.visible = false;
  hideBowUI();
  refreshPlanUI();
}

// 예약된 플랜들을 순차 서브턴으로 실행. 적은 매 서브턴 새로 반응한다.
async function resolveQueue() {
  if (phase !== 'plan' || busy || !planQueue.length) return;
  clearPending();
  const queue = planQueue;
  planQueue = [];
  ghost.visible = false;
  drawQueueGhosts();
  // 이동 카드와 공격/엄호 카드가 연달아 있으면 한 서브턴으로 묶는다 —
  // "이동하며 사격" (경계는 정지 자세라 단독 서브턴)
  const subs = [];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i]._card?.def.kind;
    const nk = queue[i + 1]?._card?.def.kind;
    if (k === 'move' && (nk === 'atk' || nk === 'sup')) { subs.push({ move: queue[i], fire: queue[i + 1] }); i++; }
    else if ((k === 'atk' || k === 'sup') && nk === 'move') { subs.push({ move: queue[i + 1], fire: queue[i] }); i++; }
    else if (k === 'move') subs.push({ move: queue[i] });
    else if (k === 'atk' || k === 'sup') subs.push({ fire: queue[i] });
    else subs.push({ solo: queue[i] }); // 경계 또는 테스트 훅의 구체 플랜
  }
  for (let i = 0; i < subs.length; i++) {
    if (!player.alive) break;
    if (i > 0) for (const u of units) if (u.alive && u.reloadLeft > 0) u.reloadLeft -= 1;
    const sub = subs[i];
    if (sub.solo) {
      const q = sub.solo;
      if (q.type !== 'auto') player.plan = q; // 테스트 훅의 구체 플랜
      else { cardPop(q._card.def); player.plan = { type: 'overwatch', _card: q._card }; }
    } else if (sub.move) {
      cardPop(sub.move._card.def, sub.fire ? ` + ${sub.fire._card.def.ico} ${sub.fire._card.def.label}` : '');
      player.plan = materializeMove(sub.move);
      if (sub.fire && player.plan.type === 'move') player.plan.fireCard = sub.fire._card; // 이동 후 사격
      else if (sub.fire) player.plan = fireOrWait(sub.fire); // 길이 없으면 제자리 사격
    } else {
      cardPop(sub.fire._card.def);
      player.plan = fireOrWait(sub.fire);
    }
    planEnemies();
    await resolveOneTurn();
    if (phase === 'gameover') return;
  }
  startPlanning();
}
function fireOrWait(q) {
  const fp = materializeFire(q._card.def);
  if (!fp) { cardPop(q._card.def, ' — 사격 불가', '#c8c2b4'); return { type: 'wait', _card: q._card }; }
  return { type: 'fire', cell: fp.cell, shot: fp.shot, sup: fp.sup, _card: q._card };
}

// 적 AI — AI 레벨(driverLv):
//  Lv1: 현재 칸 조준 / Lv2: 절반 리드 + 굴착 + 경계 / Lv3: 완전 외삽 리드
let playerLastMove = null;
function predictPlayerCell(lvl) {
  if (lvl <= 1 || !playerLastMove) return { gx: player.gx, gz: player.gz };
  const f = lvl >= 3 ? 1 : 0.5;
  return {
    gx: THREE.MathUtils.clamp(Math.round(player.gx + playerLastMove.dx * f), 0, GW - 1),
    gz: THREE.MathUtils.clamp(Math.round(player.gz + playerLastMove.dz * f), 0, GH - 1),
  };
}
// 적 단일 유닛 의사결정 — 리얼타임 두뇌 루프가 주기적으로 호출한다
function decideEnemy(enemy) {
  enemy._plannedCell = { gx: enemy.gx, gz: enemy.gz }; // 도착 예정 칸 (기본: 제자리)
  const lvl = enemy.driverLv;
  // 안개·폭우: 시야 밖 플레이어는 조준 불가 — 소리로 대충 접근만 한다
  const canSee = Math.hypot(enemy.gx - player.gx, enemy.gz - player.gz) <= VIS_LIMIT;
  if (enemy.reloadLeft <= 0 && canSee) {
    const aim = predictPlayerCell(lvl);
    const aimIsPlayer = aim.gx === player.gx && aim.gz === player.gz;
    const shot = computeShot(enemy, aimIsPlayer ? { unit: player } : aim);
    if (shot.ok && (!aimIsPlayer || shot.chance >= 30)) {
      return { type: 'fire', cell: aim, shot };
    }
    // 곡사 (Lv2+): 사선이 막혔으면 능선 너머로 넘겨 쏜다
    if (lvl >= 2 && !shot.ok) {
      const lobShot = computeShot(enemy, aimIsPlayer ? { unit: player } : aim, null, null, true);
      if (lobShot.ok && (!aimIsPlayer || lobShot.chance >= 25)) {
        return { type: 'fire', cell: aim, shot: lobShot };
      }
    }
    // 능선 굴착 (Lv2+): 곡사도 안 되면 막힌 지형을 포격해 포각 확보
    if (lvl >= 2 && shot.blockCell) {
      const dig = computeShot(enemy, shot.blockCell);
      if (dig.ok) {
        return { type: 'fire', cell: shot.blockCell, shot: dig };
      }
    }
  }
  // 경계 (Lv2+): 사격은 안 되지만 플레이어가 근처를 지나갈 만하면 매복.
  // 시야 밖(안개·폭우)이어도 소리 나는 방향으로 매복은 가능하다.
  if (enemy.reloadLeft <= 0) {
    const distP = Math.hypot(enemy.gx - player.gx, enemy.gz - player.gz);
    if (lvl >= 2 && distP <= enemy.fireRange + 3 && Math.random() < 0.5) {
      return { type: 'overwatch' };
    }
  }
  const cells = reachableCells(enemy);
  let best = null;
  // 편대 간격: 아군끼리 뭉치면 파편 직격·스플래시 연쇄로 자멸한다 —
  // 서로 4~7칸 간격을 유지하도록 근접 도착지를 강하게 감점.
  // 먼저 계획한 아군의 "도착 예정 칸"(_plannedCell)도 피한다.
  const sepPenalty = (gx, gz) => {
    let pen = 0;
    for (const o of enemies) {
      if (o === enemy || !o.alive) continue;
      const tx = o._plannedCell?.gx ?? o.gx, tz = o._plannedCell?.gz ?? o.gz;
      const d = Math.hypot(gx - tx, gz - tz);
      if (d < 2.5) pen += 90;       // 파편 직격권 — 사실상 금지
      else if (d < 4.5) pen += 45;  // 폭발 스플래시 겹침
      else if (d < 7) pen += 14;    // 편대 간격 유지
    }
    return pen;
  };
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
    const sShot = canSee ? computeShot(enemy, { unit: player }, { gx, gz }) : { ok: false };
    const distP = Math.hypot(gx - player.gx, gz - player.gz);
    let score = sShot.ok ? 200 + sShot.chance - info.cost * 2 : 100 - distP * 5 - info.cost;
    score -= exposurePenalty(gx, gz, info.endDir);
    score -= sepPenalty(gx, gz);
    if (!best || score > best.score) best = { score, info, gx, gz };
  }
  // 제자리 대기도 후보로 평가 — 지금 자세가 이미 노출이면 이동이 이긴다
  const stayScore = 100 - Math.hypot(enemy.gx - player.gx, enemy.gz - player.gz) * 5
    - exposurePenalty(enemy.gx, enemy.gz, facingDir(enemy))
    - sepPenalty(enemy.gx, enemy.gz);
  if (best && best.info.path.length && best.score > stayScore) {
    enemy._plannedCell = { gx: best.gx, gz: best.gz };
    return { type: 'move', path: best.info.path.slice(), facing: null };
  }
  return { type: 'wait' };
}

// 리얼타임 적 두뇌: 각자 자기 페이스로 결심 → 실행을 반복한다.
// 레벨이 높을수록 빠릿하게 움직인다 (템포는 전체적으로 느긋하게).
async function enemyActionLoop(e) {
  await delay(1800 + rng() * 2600); // 개전 텀 — 일제히 움직이지 않게 어긋난다
  while (e.alive && phase !== 'gameover') {
    await delay(2600 + (3 - e.driverLv) * 900 + rng() * 1800);
    if (!e.alive || phase === 'gameover' || !player.alive) break;
    if (e.reloadLeft > 0) e.reloadLeft -= 1;
    const plan = decideEnemy(e);
    try {
      if (plan.type === 'fire') {
        e._owPosture = false;
        e.plan = plan;
        await resolvePlannedShot(e);
        e.plan = null;
      } else if (plan.type === 'move' && plan.path?.length) {
        e._owPosture = false;
        await moveUnit(e, plan.path, null);
      } else if (plan.type === 'overwatch') {
        e._owPosture = true;
      }
    } catch { /* 격파 등으로 중단 — 루프 조건이 정리한다 */ }
  }
}

// 구 턴 머신 호환 심 (테스트 훅 경유 시)
function planEnemies() {
  for (const e of enemies) if (e.alive) e.plan = decideEnemy(e);
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
  if (u.isPlayer) {
    u.reloadLeft = 0; // 플레이어는 시간 기반 재장전
    u.reloadReadyAt = performance.now() + (u.gun?.reload ?? 2) * RELOAD_MS_PER;
  } else {
    u.reloadLeft = u.gun?.reload ?? 2;
  }
  u.aimStack = 0; // 조준 스택 소모
  await fireSequence(u, target, shot);
}

async function resolveOneTurn() {
  phase = 'resolve';
  busy = true;
  clearHighlights();
  ghost.visible = false;
  for (const gk of queueGhosts) gk.group.visible = false;
  if (queueLine) { scene.remove(queueLine); queueLine.geometry.dispose(); queueLine = null; }
  hideBowUI();
  turnLabel.textContent = `턴 ${turnNo} ▶`;
  const playerStart = { gx: player.gx, gz: player.gz };
  // 포탑 사전 추적 없음 — 포탑은 사격 시작 시(aimAt의 선회 애니메이션)와
  // 이동 도착 시(드래그로 지정한 turretYaw 정렬)에만 돈다.
  for (const u of units) u._track = null;
  // A) 경계망 구성: 이동 스텝마다 상대편 경계자의 사선을 체크,
  //    걸리면 이동 중 "실시간" 스냅 사격 (경계자당 1회, 스냅 페널티)
  const overwatchers = units.filter((u) => u.alive && u.plan?.type === 'overwatch' && u.reloadLeft <= 0);
  for (const ow of overwatchers) ow._snapped = false;
  const snapShots = [];
  const SNAP_ARC = THREE.MathUtils.degToRad(12); // 현재 포 방향 ±12° — 경계 사선 폭 확대
  const onStep = (mover) => {
    for (const ow of overwatchers) {
      if (ow._snapped || !ow.alive || !mover.alive) continue;
      if (ow.isPlayer === mover.isPlayer) continue;
      // 안개·폭우: 시야 밖 이동은 경계로도 못 잡는다 (양측 동일)
      if (Math.hypot(
        mover.group.position.x - ow.group.position.x,
        mover.group.position.z - ow.group.position.z
      ) / TILE > VIS_LIMIT) continue;
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
  // 이동+공격 결합 카드: 이동이 끝난 "새 위치"에서 사격을 구체화
  if (player.alive && player.plan?.type === 'move' && player.plan.fireCard) {
    const fc = player.plan.fireCard;
    const fp = materializeFire(fc.def);
    if (fp) {
      player.plan = { type: 'fire', cell: fp.cell, shot: fp.shot, sup: fp.sup, _moved: true, _card: player.plan._card };
    } else {
      cardPop(fc.def, ' — 사격 불가', '#c8c2b4');
      player.plan._movedOnly = true;
    }
  }
  // C) 일반 사격 — 모든 이동이 끝난 뒤 발사.
  //    목적지를 맞게 예측한 셀 사격은 도착한 적을 정통으로 맞춘다.
  const shooters = units.filter((u) => u.alive && u.plan?.type === 'fire');
  await Promise.all(shooters.map((u) => resolvePlannedShot(u)));
  // 엄호(제압) 사격: 착탄 지점 주변 적은 다음 사격이 흔들린다
  if (player.alive && player.plan?.sup && player.plan.cell) {
    for (const e of enemies) {
      if (!e.alive || e._suppressed) continue;
      if (Math.hypot(e.gx - player.plan.cell.gx, e.gz - player.plan.cell.gz) <= 3) {
        e._suppressed = true;
        popText(e.group.position.clone().add(new THREE.Vector3(0, 1.5, 0)), '🔥 제압됨', '#ffb46e');
      }
    }
  }
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
    if (u.boostTurns > 0) u.boostTurns--;
    u.movedLastTurn = (u.plan?.type === 'move' && !!u.plan.path?.length) || !!u.plan?._moved;
  }
  // AI 예측용: 이번 턴 플레이어 변위 기록
  const pdx = player.gx - playerStart.gx, pdz = player.gz - playerStart.gz;
  playerLastMove = pdx || pdz ? { dx: pdx, dz: pdz } : null;
  for (const u of units) u.plan = null;
  if (checkGameEnd()) return;
  turnNo++;
  // startPlanning은 호출자(submitPlan/resolveQueue)가 큐를 마친 뒤 부른다
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

// ▶ 실행: 고른 카드들을 순서대로 해결. 아무것도 안 골랐으면 라운드 건너뛰기.
chipRun.addEventListener('click', () => {
  if (phase !== 'plan' || busy) return;
  clearPending();
  if (planQueue.length) resolveQueue();
  else submitPlan({ type: 'wait' });
});
chipUndo.addEventListener('click', () => cancelAction());

// ---------------------------------------------------------------------------
// 입력
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
let ghostGesture = null; // 기동: { cell, info, facing }
let fireGesture = null;  // 사격: { cell, shot } — 내 차량에서 바깥으로 드래그
let hoverAim = null;
// ── 모바일 탭 2단계 조작 ──
// 내 전차 "탭" = 사격 모드 토글 → 목표 탭 = 미리보기 → ✓ 확정.
// 이동도 셀 "탭" = 고스트 미리보기 → (고스트 드래그로 포탑 조정) → ✓ 확정.
// 드래그 제스처(데스크톱)는 기존 그대로 즉시 확정.
let fireMode = false;
let pendingPlan = null;
const confirmEl = document.getElementById('confirm');
const btnOk = document.getElementById('btn-ok');
function setConfirm(show, label = '✓ 확정') {
  btnOk.textContent = label;
  confirmEl.classList.toggle('show', !!show);
  renderCrumbs(); // 미리보기 상태를 breadcrumb에도 반영
}
function clearPending(keepMode = false) {
  pendingPlan = null;
  if (!keepMode) fireMode = false;
  setConfirm(false);
  ghost.visible = false;
  hideBowUI();
}
btnOk.addEventListener('click', () => {
  if (!pendingPlan || phase !== 'plan' || busy) return;
  const p = pendingPlan;
  clearPending();
  enqueuePlan(p);
});

function setPointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
  // 자동 결정 모드: 셀/표적을 직접 고르지 않는다 — 3D 뷰는 카메라 조작 전용.
  // (모든 계획은 하단 카드 탭, 실행 결정은 🎲 주사위)
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (fireGesture) {
    setPointer(e);
    // 사격 출발점 위로 되돌리면 취소 대기 상태
    if (raycaster.intersectObject(fireOrigin().hitbox).length) {
      fireGesture.cell = null;
      fireGesture.shot = null;
      hideBowUI();
      setHint('놓으면 취소');
      return;
    }
    // 목표를 향해 드래그 — 커서 아래 셀이 조준점
    let cell = null;
    const enemyHit = raycaster.intersectObjects(
      enemies.filter((en) => en.alive && !en.hidden).map((en) => en.hitbox)
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
      const fo = fireOrigin();
      const d = Math.hypot(cell.gx - fo.gx, cell.gz - fo.gz).toFixed(0);
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

renderer.domElement.addEventListener('pointerup', (e) => {
  // 자동 결정 모드: 3D 뷰 탭은 정보 확인용 — 적을 탭하면 조작 안내만
  const movedPx = downPos ? Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) : 99;
  const isTap = movedPx <= 8;
  downPos = null;
  if (!isTap || busy || phase !== 'plan') return;
  setPointer(e);
  const enemyHit = raycaster.intersectObjects(
    enemies.filter((en) => en.alive && !en.hidden).map((en) => en.hitbox)
  )[0];
  if (enemyHit) {
    setHint(hand.some((c) => !c.used && c.def.kind === 'fire')
      ? '공격 카드를 예약하면 🎲 주사위가 표적을 고릅니다'
      : '이번 라운드엔 공격 카드가 없습니다');
  }
});

// 취소 동작 (ESC / 모바일 ✕ 버튼 공용): 진행 중 제스처 → 마지막 예약 순
function cancelAction() {
  if (fireGesture) { fireGesture = null; hideBowUI(); hoverAim = null; controls.enabled = true; downPos = null; refreshPlanUI(false); setHint('취소'); return; }
  if (ghostGesture) { ghostGesture = null; ghost.visible = false; controls.enabled = true; downPos = null; refreshPlanUI(false); setHint('취소'); return; }
  if (pendingPlan || fireMode || activeCard) {
    activeCard = null;
    clearPending();
    renderHand();
    refreshPlanUI(false);
    setHint('취소');
    return;
  }
  if (phase === 'plan' && !busy && planQueue.length) {
    const popped = planQueue.pop();
    if (popped?._card) { popped._card.used = false; popped._card.slot = 0; renderHand(); }
    setHint(`예약 취소 (${planQueue.length}장 남음)`);
    refreshPlanUI(false);
  }
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (settingsEl.classList.contains('show')) { settingsEl.classList.remove('show'); return; }
    cancelAction();
  }
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
  // 사격 출발점이 고스트면 그 고스트의 포탑/포를 조준(현재 전차는 그대로).
  const fo = fireOrigin();
  const S = fo.ghost
    ? { group: fo.group, hasTurret: lastMoveGhost.hasTurret, sponsonTwin: lastMoveGhost.sponsonTwin,
        cannon: lastMoveGhost.cannon, turret: lastMoveGhost.turret, sponsons: lastMoveGhost.sponsons, gun: player.gun }
    : player;
  const targetYaw = Math.atan2(aim.x - S.group.position.x, aim.z - S.group.position.z);
  let pitchGun = S.cannon;
  if (S.gun?.fixed) {
    const rel = clampToGunArc(S, normAngle(targetYaw - S.group.rotation.y));
    if (S.sponsonTwin) {
      const { gun, other } = pickSponson(S, targetYaw);
      pitchGun = gun.group;
      gun.group.rotation.y += normAngle(rel - gun.group.rotation.y) * k;
      other.group.rotation.y += normAngle(other.group.userData.rest - other.group.rotation.y) * k;
    } else {
      S.cannon.rotation.y += normAngle(rel - S.cannon.rotation.y) * k;
    }
  } else if (S.hasTurret) {
    const rel = normAngle(targetYaw - S.group.rotation.y);
    S.turret.rotation.y += normAngle(rel - S.turret.rotation.y) * k;
  }
  // 포신 부앙각 미리보기: 사격 출발점 셀 기준 (차체 기울기로 창이 이동)
  const from = muzzleApprox(player, { gx: fo.gx, gz: fo.gz });
  const horiz = Math.hypot(aim.x - from.x, aim.z - from.z);
  const tiltPrev = hullTiltAtCellDeg({ gx: fo.gx, gz: fo.gz }, aim.x, aim.z);
  const pitchDeg = THREE.MathUtils.clamp(
    (Math.atan2(aim.y - from.y, Math.max(horiz, 0.001)) * 180) / Math.PI,
    (player.gun?.pitchMin ?? PITCH_MIN) + tiltPrev, (player.gun?.pitchMax ?? PITCH_MAX) + tiltPrev
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
// ── 안개·폭우 시야: VIS_LIMIT칸 밖의 적은 렌더링 자체를 끈다.
// 풀 튕김·나무 흔들림·궤도 자국·엔진음 같은 간접 신호만 남는다.
function updateVisibility() {
  if (VIS_LIMIT === Infinity) return;
  for (const e of enemies) {
    if (!e.alive) {
      // 격파 순간 은폐 해제 — 잔해·화염은 안개 속에서도 빛나 보인다
      if (e.hidden) { e.hidden = false; e.group.visible = true; if (thumbsReady) updateThumbs(); }
      continue;
    }
    const d = Math.hypot(
      e.group.position.x - player.group.position.x,
      e.group.position.z - player.group.position.z
    ) / TILE;
    const hid = d > VIS_LIMIT;
    if (hid !== !!e.hidden) {
      e.hidden = hid;
      e.group.visible = !hid;
      if (thumbsReady) updateThumbs();
    }
  }
}

// 시야 밖 전차가 지나가면 주변 나무·수풀이 눈에 띄게 술렁인다 (탐지 단서)
function rustleNearProps(x, z) {
  const c = worldToCell({ x, z });
  const seen = new Set();
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const p = props.get(cellKey(c.gx + dx, c.gz + dz));
      if (!p || seen.has(p) || (p.type !== 'tree' && p.type !== 'bush')) continue;
      seen.add(p);
      if (p._rustling || !p.group) continue;
      if (Math.hypot(p.group.position.x - x, p.group.position.z - z) > 2.4) continue;
      p._rustling = true;
      const g = p.group;
      const rx0 = g.rotation.x, rz0 = g.rotation.z;
      const ax = (rng() - 0.5) * 0.13, az = (rng() - 0.5) * 0.13;
      tween(950, (e, k) => {
        const s = Math.sin(k * Math.PI * 3.5) * (1 - k);
        g.rotation.x = rx0 + ax * s;
        g.rotation.z = rz0 + az * s;
      }, linear).then(() => {
        g.rotation.x = rx0; g.rotation.z = rz0; p._rustling = false;
      });
    }
  }
}

// 상단 중앙 사격 상태: 지금 조준/재장전 중인 사격을 카드 하나로 — 직격/곡사
// 아이콘 + 단계명 + 남은 시간 + 진행 바. (이동은 자동이라 표시하지 않는다.)
const activeCardsEl = document.getElementById('active-cards');
let activeCardsSig = '';
function updateActiveCardsHUD(now) {
  if (!activeCardsEl) return;
  let card = null;
  if (player.alive && phase !== 'gameover') {
    const fs = fireStage;
    if (fs && !fs.fired) {
      const isReload = fs.phase === 'reload';
      const dur = isReload ? fs.waitDur : 600 + fs.extendMs;
      const left = Math.max(0, dur - (now - fs.t0));
      const pct = Math.min(97, ((now - fs.t0) / Math.max(1, dur)) * 100);
      const mode = fs.lob ? '곡사' : '직격';
      const name = isReload ? `${mode} · 재장전` : `${mode} ${FIRE_NAMES[fs.level - 1]}`;
      card = {
        sig: `${fs.lob ? 'lob' : 'dir'}${fs.phase}${fs.level}`,
        cls: fs.lob ? ' lob' : ' fire', key: fs.lob ? 'lob' : 'atk', sub: null,
        name, left, pct,
      };
    }
  }
  if (!card) {
    if (activeCardsSig) { activeCardsEl.style.display = 'none'; activeCardsSig = ''; }
    return;
  }
  if (card.sig !== activeCardsSig) {
    activeCardsSig = card.sig;
    activeCardsEl.style.display = 'flex';
    activeCardsEl.innerHTML =
      `<div class="acard${card.cls}">${CARD_ICONS[card.key] ?? ''}` +
      (card.sub ? `<span class="sub">${CARD_ICONS[card.sub] ?? ''}</span>` : '') +
      `<span>${card.name}</span><span class="t"></span><span class="bar"><i></i></span></div>`;
  }
  const t = activeCardsEl.querySelector('.t');
  if (t) t.textContent = card.left > 0 ? `${(card.left / 1000).toFixed(1)}s` : '·';
  const bar = activeCardsEl.querySelector('.bar i');
  if (bar) bar.style.width = `${card.pct.toFixed(0)}%`;
}

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
  // 명령 대기 하이라이트: 내 전차 발밑 시안 링 (숨쉬는 펄스 + 느린 회전)
  cmdRing.visible = phase === 'plan' && !busy && player.alive;
  if (cmdRing.visible) {
    cmdRing.position.set(player.group.position.x, Math.max(standHeight(player.gx, player.gz), WATER_Y) + 0.09, player.group.position.z);
    const cp = 1 + Math.sin(now * 0.004) * 0.07;
    cmdRing.scale.setScalar(cp);
    cmdRing.material.opacity = 0.45 + Math.sin(now * 0.004) * 0.22;
    cmdRing.rotation.z = now * 0.0006;
  }
  // 조준 안정(정지 사격 보너스) 링
  haltRing.visible = phase === 'plan' && player.alive && !player.movedLastTurn && player.reloadLeft === 0;
  if (haltRing.visible) {
    haltRing.position.set(player.group.position.x, player.group.position.y + 0.1, player.group.position.z);
    haltRing.material.opacity = 0.5 + Math.sin(now * 0.004) * 0.2;
  }
  rippleTex.offset.set((now * 0.0000121) % 1, (now * -0.0000324) % 1);
  windUniform.value = now * 0.001 * ENV.windSpeed; // 식생 바람 (날씨별 풍속)
  sparkleTex.offset.set((now * 0.000021) % 1, (now * -0.000013) % 1); // 윤슬 흐름
  // ── 리얼타임 루프: 필드 갱신(스로틀) / 경과 시간 / 정지 판정 / 액션 바 ──
  if (phase === 'plan' && (fieldsDirty || now - (window.__lastFieldT ?? 0) > 1400)) {
    fieldsDirty = false;
    window.__lastFieldT = now;
    refreshPlanUI();
  }
  if (!liveT0) liveT0 = now; // rAF 타임스탬프 기준으로 개전 시각 고정
  {
    const sec = Math.max(0, Math.floor((now - liveT0) / 1000));
    turnLabel.textContent = `⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }
  for (const u of units) {
    if (u.alive) u.movedLastTurn = u._driving || now - (u._lastMoveT ?? -1e9) < 2500;
  }
  updateActionBar();          // 직격/곡사 버튼 상태(조준 pip·재장전 쿨다운)·아이템 트레이
  updateActiveCardsHUD(now);  // 상단 사격 상태 배지
  updateAntennas(dt); // RC 안테나 대롱대롱
  updateSuspension(dt); // 로드휠 서스펜션 — 차체가 지형을 출렁이며 따라간다
  updateWreckFires(now); // 격파 잔해 화재/매연
  updateRain(dt); // 비/폭우 빗줄기
  updateLightning(dt); // 폭우 번개
  updateVisibility(); // 안개·폭우 시야 제한
  for (const it of items.values()) { // 아이템 부유/회전
    it.group.rotation.y = now * 0.0012;
    it.group.position.y += Math.sin(now * 0.0028 + it.group.position.x) * 0.0007;
  }
  controls.update();
  renderer.info.reset();
  composer.render();
  updatePerf(now);
}
updatePlayerHpUI();
// ── 리얼타임 개전: 자동 조종 시동, 적 두뇌 가동 ──
let liveT0 = 0; // 첫 프레임의 rAF 타임스탬프로 설정
{
  phase = 'plan'; // 항상 라이브 (게임오버 전까지)
  busy = false;
  refreshPlanUI();
  updateActionBar();
  setHint('조종은 자동입니다 — 직격/곡사로 사격하고, 주운 아이템을 쓰세요');
  playerDriverLoop();                   // 자동 조종 시작
  for (const e of enemies) enemyActionLoop(e);
}
requestAnimationFrame(animate);

// ---------------------------------------------------------------------------
// 개발/테스트용 훅
// ---------------------------------------------------------------------------
window.__puratank = {
  seed,
  env: { tod: TOD, wx: WEATHER, visLimit: VIS_LIMIT, rain: ENV.rainCount, windAmp: ENV.windAmp },
  ssaoPass,
  composer,
  camera,
  controls,
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
      enemies: enemies.map((e) => ({ gx: e.gx, gz: e.gz, hp: e.hp, alive: e.alive, hidden: !!e.hidden, hullLv: e.hullLv, driverLv: e.driverLv, reload: e.reloadLeft, rotY: e.group.rotation.y })),
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
  // 리얼타임 훅: 즉시 실행 — 완료는 acting()으로 폴링
  planMoveTo(gx, gz) {
    const info = reachableCells(player).get(cellKey(gx, gz));
    if (!info || playerMoveBusy || phase === 'gameover') return false;
    (async () => {
      playerMoveBusy = true;
      try { await moveUnit(player, info.path.slice(), null); } finally { playerMoveBusy = false; }
    })();
    return true;
  },
  planFireAt(gx, gz) {
    const f = computeFireCells(player).get(cellKey(gx, gz));
    if (!f || playerFireBusy || phase === 'gameover') return false;
    (async () => {
      playerFireBusy = true;
      try {
        player.plan = { type: 'fire', cell: { gx, gz }, shot: f.shot };
        await resolvePlannedShot(player);
        player.plan = null;
      } finally { playerFireBusy = false; }
    })();
    return true;
  },
  planOverwatch() { player._owPosture = true; return true; },
  planWait() { return true; },
  // 테스트: 플레이어를 특정 칸으로 순간이동 (위치+월드좌표 동기화)
  warp(gx, gz) {
    player.gx = gx; player.gz = gz;
    const p = cellToWorld(gx, gz);
    player.group.position.set(p.x, standHeight(gx, gz), p.z);
    fieldsDirty = true;
    return { gx, gz };
  },
  pauseDriver(v = true) { driverPaused = !!v; if (v) { player._abortMove = true; } return driverPaused; },
  acting: () => ({
    move: playerMoveBusy, fire: playerFireBusy, ow: !!player._owPosture,
    steady: !!player._steady,
    fireLevel: fireStage && !fireStage.cancelled ? fireStage.level : 0,
    fireLob: fireStage ? !!fireStage.lob : null,
    firePhase: fireStage?.phase ?? null,
    reloadLeft: Math.max(0, (player.reloadReadyAt ?? 0) - performance.now()),
    inv: player.inventory.slice(),
    pos: { gx: player.gx, gz: player.gz },
  }),
  queueMoveTo(gx, gz) { return window.__puratank.planMoveTo(gx, gz); },
  itemCells: () => [...items.keys()].map((k) => k.split(',').map(Number)),
  debugPickup(gx, gz) { player.gx = gx; player.gz = gz; tryPickupItem(player); return { hp: player.hp, boost: player.boostTurns }; },
  queueLen: () => planQueue.length,
  projOrigin: () => projectedOrigin(),
  // 부분 파괴 테스트용
  propAt: (gx, gz) => {
    const p = props.get(cellKey(gx, gz));
    return p ? { type: p.type, hp: p.hp, gx: p.gx, gz: p.gz, alive: p.chunks ? p.chunks.filter((c) => !c.dead).length : null, total: p.chunks ? p.chunks.length : null } : null;
  },
  propCells: () => [...props.entries()].map(([k, p]) => ({ k, type: p.type })),
  blastAt: (gx, gz, h = 1.2) => {
    const p = cellToWorld(gx, gz);
    return resolveImpact(new THREE.Vector3(p.x, sampleHeight(p.x, p.z) + h, p.z), player);
  },
  curMoveKeys: () => [...currentMoveCells.keys()],
  curFireKeys: () => [...currentFireCells.keys()],
  fireOriginCell: () => { const o = fireOrigin(); return { gx: o.gx, gz: o.gz, ghost: o.ghost }; },
  queueFireAt(gx, gz) { return window.__puratank.planFireAt(gx, gz); },
  // 사격/아이템/자동조종 훅 (직격=false, 곡사=true)
  fire(lob = false) { startFire(!!lob); return true; },
  cancelFire() { cancelFire(); return true; },
  inventory: () => player.inventory.slice(),
  useItem(i) { useItem(i); return true; },
  giveItem(t) { player.inventory.push(t === 'fuel' ? 'fuel' : 'repair'); return player.inventory.slice(); },
  driver: () => decideDriver(),
  runQueue: () => true,
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
