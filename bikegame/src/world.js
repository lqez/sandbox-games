// world.js — 하이폴리 해안 코스 비주얼 (텍스처 + PBR + PMREM 환경광)
// 카메라가 항상 바이크 뒤에서 전방을 보므로, 지형은 s 구간 청크로 나눠
// 바이크 뒤쪽 청크는 visible=false 처리(+전방 원거리 컷)로 드로우콜을 아낀다.
import * as THREE from 'three';
import { DS, T, mulberry32 } from './track.js';

export const SUN_DIR = new THREE.Vector3(0.32, 0.46, 0.83).normalize();

const CHUNK_LEN = 70;
const CULL_BEHIND = 45;
const CULL_AHEAD = 560;

// ---------- 텍스처 (모듈 전역 캐시 — 코스 리빌드에도 유지) ----------
let TEX = null;
function initTextures(renderer) {
  if (TEX) return TEX;
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function load(url, mirrored) {
    const t = loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    if (mirrored) t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    else t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    return t;
  }
  TEX = {
    sand: load('./tex/sand.jpg', true),
    dirt: load('./tex/dirt.jpg', true),
    plywood: load('./tex/plywood.jpg', true),
    bark: load('./tex/bark.jpg', true),
    container: load('./tex/container.jpg', true),
    frond: load('./tex/frond.png', false),
    scrub: load('./tex/scrub.png', false),
  };
  return TEX;
}

// ---------- 하늘 / 바다 셰이더 ----------
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;
}`;
const SKY_FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 sunDir;
void main(){
  float h = clamp(vDir.y, -0.05, 1.0);
  vec3 zen = vec3(0.045, 0.34, 0.80);
  vec3 mid = vec3(0.34, 0.67, 0.94);
  vec3 hor = vec3(0.84, 0.94, 0.97);
  vec3 col = mix(hor, mix(mid, zen, smoothstep(0.07, 0.36, h)), smoothstep(0.0, 0.05, h));
  float sd = max(dot(normalize(vDir), sunDir), 0.0);
  col += vec3(1.0, 0.97, 0.88) * pow(sd, 900.0) * 3.0;
  col += vec3(1.0, 0.95, 0.8) * pow(sd, 60.0) * 0.4;
  col += vec3(0.9, 0.95, 1.0) * pow(sd, 6.0) * 0.05;
  gl_FragColor = vec4(col, 1.0);
}`;

const WATER_VERT = /* glsl */`
varying vec3 vWorld;
uniform float time;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += sin(wp.x * 0.11 + time * 1.1) * cos(wp.z * 0.09 + time * 0.8) * 0.14;
  wp.y += sin(wp.x * 0.33 - time * 1.6) * cos(wp.z * 0.28 + time * 1.2) * 0.045;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const WATER_FRAG = /* glsl */`
varying vec3 vWorld;
uniform float time;
uniform vec3 sunDir;
uniform vec3 fogColor;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
void main(){
  vec3 view = normalize(cameraPosition - vWorld);
  vec2 uv = vWorld.xz;
  float n1 = noise(uv * 0.35 + time * 0.55);
  float n2 = noise(uv * 0.9 - time * 0.4);
  float n3 = noise(uv * 2.3 + vec2(time * 0.8, -time * 0.6));
  vec3 nrm = normalize(vec3((n1 - 0.5) * 0.6 + (n3 - 0.5) * 0.25, 1.0, (n2 - 0.5) * 0.6 + (n3 - 0.5) * 0.25));
  vec3 deep = vec3(0.03, 0.44, 0.54);
  vec3 teal = vec3(0.10, 0.64, 0.68);
  vec3 glass = vec3(0.28, 0.82, 0.78);
  float patches = noise(uv * 0.045 + 7.0);
  vec3 col = mix(deep, teal, smoothstep(0.3, 0.75, patches));
  col = mix(col, glass, smoothstep(0.82, 0.98, patches) * 0.5);
  col = mix(col, glass * 0.92, smoothstep(0.62, 0.9, n1) * 0.22);
  // 슐릭 프레넬: 정면은 물 본색, 그레이징은 하늘 반사 지배
  float cosV = max(dot(view, nrm), 0.0);
  float fres = 0.025 + 0.975 * pow(1.0 - cosV, 5.0);
  vec3 skyRef = mix(vec3(0.12, 0.50, 0.72), vec3(0.06, 0.40, 0.85), clamp(view.y * 1.6, 0.0, 1.0));
  float sunSide = pow(max(dot(normalize(vec3(-view.x, 0.0, -view.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0), 3.0);
  skyRef = mix(skyRef, vec3(0.9, 0.88, 0.76), sunSide * 0.3);
  col = mix(col, skyRef, clamp(fres * 0.72, 0.0, 0.42));
  vec3 refl = reflect(-view, nrm);
  float sr = max(dot(refl, sunDir), 0.0);
  float spec = pow(sr, 160.0);
  float glitter = smoothstep(0.55, 0.95, n3) * smoothstep(0.4, 0.8, n1);
  col += vec3(1.0, 0.98, 0.9) * (spec * 3.8 * (0.3 + glitter * 1.7));
  col += vec3(1.0, 0.96, 0.82) * pow(sr, 14.0) * 0.24;
  float dist = length(cameraPosition - vWorld);
  col = mix(col, fogColor, smoothstep(480.0, 1600.0, dist));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------- 지오메트리 병합 (position/normal/color/uv) ----------
function mergeGeoms(geoms) {
  let vCount = 0, iCount = 0;
  for (const g of geoms) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geoms) {
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color, u = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (c) col.set(c.array, vo * 3);
    else for (let i = 0; i < p.count * 3; i++) col[vo * 3 + i] = 1;
    if (u) uv.set(u.array, vo * 2);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
      io += p.count;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function buildWorld(track, scene, renderer) {
  const group = new THREE.Group();
  const rnd = mulberry32(track.seed ^ 0x9e3779b9);
  const S = track.samples, N = S.length;
  const tex = initTextures(renderer);

  // ---------- 하늘 ----------
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    uniforms: { sunDir: { value: SUN_DIR } },
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 40, 22), skyMat);
  sky.frustumCulled = false;
  group.add(sky);

  // PMREM 환경광: 하늘을 구워 PBR 반사/앰비언트로 사용
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  const envRT = pmrem.fromScene(envScene, 0.04, 1, 500);
  scene.environment = envRT.texture;
  pmrem.dispose();

  // ---------- 바다 ----------
  const waterUniforms = {
    time: { value: 0 },
    sunDir: { value: SUN_DIR },
    fogColor: { value: new THREE.Color(0xbfe8f2) },
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400, 96, 96),
    new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      uniforms: waterUniforms, fog: false,
    })
  );
  water.rotation.x = -Math.PI / 2;
  group.add(water);

  // ---------- 헬퍼 ----------
  const latV = new THREE.Vector3();
  function lateral(i) {
    latV.set(track.dirs[i * 2 + 1], 0, -track.dirs[i * 2]);
    return latV;
  }

  const cWhite = new THREE.Color(1, 1, 1);
  const cGrassTint = new THREE.Color(0.72, 0.78, 0.5);
  const cWetTint = new THREE.Color(0.82, 0.8, 0.72);
  const cUnderTint = new THREE.Color(0.55, 0.95, 0.9);
  const cShallow = new THREE.Color(0x49c8bd);

  // ---------- 머티리얼 ----------
  const sandMat = new THREE.MeshStandardMaterial({
    map: tex.sand, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.35,
  });
  const dirtMat = new THREE.MeshStandardMaterial({
    map: tex.dirt, roughness: 1, metalness: 0, envMapIntensity: 0.3,
  });
  const plyMat = new THREE.MeshStandardMaterial({
    map: tex.plywood, roughness: 0.75, metalness: 0, envMapIntensity: 0.5,
  });
  const navyMat = new THREE.MeshStandardMaterial({
    color: 0x1d3f78, roughness: 0.65, metalness: 0.05, envMapIntensity: 0.5,
  });
  const shallowMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false,
  });
  const lipMat = new THREE.MeshBasicMaterial({
    color: 0xf4efe4, transparent: true, opacity: 0.85, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0x4a382a, roughness: 0.95, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  const foamMat = new THREE.ShaderMaterial({
    uniforms: { time: waterUniforms.time },
    transparent: true, depthWrite: false, fog: false, vertexColors: true,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying float vFade;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vFade = color.r;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vWorld;
      varying float vFade;
      uniform float time;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      void main(){
        float n = noise(vWorld.xz * 0.8 + vec2(time * 0.35, -time * 0.25));
        float n2 = noise(vWorld.xz * 2.2 - time * 0.5);
        float a = vFade * smoothstep(0.4, 0.8, n * 0.65 + n2 * 0.35) * 0.5;
        gl_FragColor = vec4(0.96, 1.0, 0.99, a);
      }`,
  });

  // ---------- 스트립 빌더 ----------
  function rowsOf(i0, i1, step) {
    const rows = [];
    for (let i = i0; i < i1; i += step) rows.push(i);
    if (rows[rows.length - 1] !== i1 - 1) rows.push(i1 - 1);
    return rows;
  }
  function stripIndices(nRows, cols) {
    const idx = [];
    for (let r = 0; r < nRows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    return idx;
  }
  // colFn(i) → [x, y, z, color, u, v] 목록
  function makeStrip(rows, colFn, cols) {
    const pos = [], col = [], uv = [];
    for (const i of rows) {
      for (const [x, y, z, c, tu, tv] of colFn(i)) {
        pos.push(x, y, z);
        col.push(c.r, c.g, c.b);
        uv.push(tu || 0, tv || 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(stripIndices(rows.length, cols));
    g.computeVertexNormals();
    return g;
  }

  // ---------- 섬 단면 (하이폴리: 14열 스무스 듄) ----------
  function islandProfileY(a, w, deck, i, off) {
    const slopeEnd = w + 2.5;
    if (a <= 2.7) return deck - 0.02;
    if (a >= slopeEnd) {
      const k = Math.min(1, (a - slopeEnd) / 3.6);
      return -0.45 - k * 0.85;
    }
    const k = (a - 2.7) / (slopeEnd - 2.7);
    const base = -0.45 + (deck + 0.43) * 0.5 * (1 + Math.cos(Math.PI * k));
    const dune = Math.sin(i * 0.045 + off * 0.5 + track.seed) *
                 Math.sin(i * 0.021 - off * 0.23) * 0.4 * Math.sin(Math.PI * k);
    return base + dune;
  }
  function islandCols(w) {
    return [-(w + 6), -(w + 2.5), -(w * 0.8), -(w * 0.55), -(w * 0.32), -3.4, -2.7,
            2.7, 3.4, w * 0.32, w * 0.55, w * 0.8, w + 2.5, w + 6];
  }
  function islandRow(i, w) {
    const s = S[i];
    const lat = lateral(i);
    const grassy = (Math.sin(i * 0.055 + track.seed * 3) + Math.sin(i * 0.021 + 1.3)) * 0.25 + 0.5;
    const out = [];
    for (const off of islandCols(w)) {
      const a = Math.abs(off);
      const y = islandProfileY(a, w, s.y, i, off);
      const x = s.x + lat.x * off, z = s.z + lat.z * off;
      let c = cWhite;
      if (y < -0.1) c = cUnderTint;                            // 수중 모래: 터콰이즈 투과
      else if (a > w + 0.8) c = cWetTint;                      // 젖은 모래 밴드
      else if (a > 3.2 && a < w * 0.85) {
        const g = Math.max(0, Math.sin((a - 3.2) / (w * 0.85 - 3.2) * Math.PI)) * grassy;
        c = cWhite.clone().lerp(cGrassTint, Math.min(0.85, g * 1.1)); // 마른 풀 패치
      }
      out.push([x, y, z, c, x / 9, z / 9]);
    }
    return out;
  }
  function shallowRow(i, w) {
    const s = S[i];
    const lat = lateral(i);
    return [-1, 1].map((side) => {
      const off = (w + 7) * side;
      return [s.x + lat.x * off, 0.05, s.z + lat.z * off, cShallow, 0, 0];
    });
  }
  function foamRow(i, w) {
    const s = S[i];
    const lat = lateral(i);
    const cIn = new THREE.Color(1, 1, 1);
    const cOut = new THREE.Color(0, 1, 1);
    return [
      [s.x - lat.x * (w + 2.4), 0.09, s.z - lat.z * (w + 2.4), cOut, 0, 0],
      [s.x - lat.x * (w + 1.1), 0.09, s.z - lat.z * (w + 1.1), cIn, 0, 0],
      [s.x + lat.x * (w + 1.1), 0.09, s.z + lat.z * (w + 1.1), cIn, 0, 0],
      [s.x + lat.x * (w + 2.4), 0.09, s.z + lat.z * (w + 2.4), cOut, 0, 0],
    ];
  }

  // ---------- 주행면 리본 ----------
  function ribbonRow(i, isFloat) {
    const s = S[i];
    const lat = lateral(i);
    const half = isFloat ? 2.1 : 2.6;
    const offs = isFloat ? [-half, half] : [-half, -0.95, 0.95, half];
    const out = [];
    for (const off of offs) {
      const side = Math.sign(off);
      const lift = (!isFloat && s.berm * side < 0 && Math.abs(off) > 1) ? 0.55 * Math.abs(s.berm) : 0;
      const u = (off + half) / (half * 2);
      const v = i * DS / (isFloat ? 5.5 : 11);
      out.push([s.x + lat.x * off, s.y + 0.04 + lift, s.z + lat.z * off, cWhite, u, v]);
    }
    return out;
  }
  function stripeRow(i) {
    const s = S[i];
    const lat = lateral(i);
    return [-1, 1].map((side) => [
      s.x + lat.x * 0.55 * side, s.y + 0.055, s.z + lat.z * 0.55 * side, cWhite, 0, 0,
    ]);
  }
  function skirtGeom(rows) {
    const pos = [], col = [], uv = [], idx = [];
    let vo = 0;
    for (const side of [-1, 1]) {
      for (const i of rows) {
        const s = S[i];
        const lat = lateral(i);
        pos.push(s.x + lat.x * 2.1 * side, s.y + 0.03, s.z + lat.z * 2.1 * side);
        pos.push(s.x + lat.x * 2.1 * side, -0.35, s.z + lat.z * 2.1 * side);
        col.push(1, 1, 1, 1, 1, 1);
        uv.push(i * DS / 4, 1, i * DS / 4, 0);
      }
      for (let r = 0; r < rows.length - 1; r++) {
        const a = vo + r * 2;
        if (side < 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      vo += rows.length * 2;
    }
    const L0 = 0, R0 = rows.length * 2;
    idx.push(L0, L0 + 1, R0, R0, L0 + 1, R0 + 1);
    const Le = (rows.length - 1) * 2, Re = rows.length * 2 + Le;
    idx.push(Le, Re, Le + 1, Le + 1, Re, Re + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---------- 립 페인트 오버레이 (릴리즈 타이밍 시각 큐) ----------
  function buildLipOverlays() {
    const geoms = [];
    for (const lip of track.lips) {
      const li = Math.floor(lip.s / DS);
      const rows = [];
      for (let d = -5; d <= 0; d++) rows.push(Math.max(0, li + d));
      geoms.push(makeStrip(rows, (i) => {
        const s = S[i];
        const lat = lateral(i);
        return [-1, 1].map((side) => [
          s.x + lat.x * 2.2 * side, s.y + 0.075, s.z + lat.z * 2.2 * side, cWhite, 0, 0,
        ]);
      }, 2));
    }
    if (!geoms.length) return null;
    const m = new THREE.Mesh(mergeGeoms(geoms), lipMat);
    m.renderOrder = 1;
    return m;
  }

  // ---------- 청크 ----------
  const chunks = [];
  const grassMats = [], palmMats = [];

  function scatterVegetation(i, w) {
    const s = S[i];
    if (s.type !== T.DIRT) return;
    const lat = lateral(i);
    for (let k = 0; k < 3; k++) {
      if (rnd() < 0.6) {
        const side = rnd() < 0.5 ? -1 : 1;
        const off = (3.4 + rnd() * Math.max(0.6, w * 0.6 - 3.4)) * side;
        const y = islandProfileY(Math.abs(off), w, s.y, i, off);
        if (y < 0.2) continue;
        const m = new THREE.Matrix4();
        const sc = 0.75 + rnd() * 0.7;
        m.makeRotationY(rnd() * Math.PI);
        m.scale(new THREE.Vector3(sc, sc * (0.85 + rnd() * 0.4), sc));
        m.setPosition(s.x + lat.x * off, y - 0.04, s.z + lat.z * off);
        grassMats.push(m);
      }
    }
    if (rnd() < 0.058 && palmMats.length < 30) {
      const side = rnd() < 0.5 ? -1 : 1;
      const off = (4.2 + rnd() * 2.5) * side;
      const y = islandProfileY(Math.abs(off), w, s.y, i, off);
      const m = new THREE.Matrix4();
      const sc = 0.8 + rnd() * 0.5;
      m.makeRotationY(rnd() * Math.PI * 2);
      m.scale(new THREE.Vector3(sc, sc, sc));
      m.setPosition(s.x + lat.x * off, Math.max(0.1, y - 0.2), s.z + lat.z * off);
      palmMats.push(m);
    }
  }

  {
    let i = 0;
    while (i < N) {
      if (!S[i].solid) { i++; continue; }
      let j = i;
      while (j < N && S[j].solid) j++;
      const chunkSamples = Math.round(CHUNK_LEN / DS);
      for (let c0 = i; c0 < j; c0 += chunkSamples) {
        const c1 = Math.min(j, c0 + chunkSamples + 1);
        buildChunk(c0, c1);
      }
      i = j;
    }
  }

  function buildChunk(i0, i1) {
    const isFloat = S[i0].type === T.FLOAT || S[Math.min(i1 - 1, i0 + 6)].type === T.FLOAT;
    const rowsFine = rowsOf(i0, i1, 2); // 1m
    const cg = new THREE.Group();

    const ribbon = new THREE.Mesh(
      makeStrip(rowsFine, (i) => ribbonRow(i, isFloat), isFloat ? 2 : 4),
      isFloat ? plyMat : dirtMat
    );
    ribbon.receiveShadow = true;
    cg.add(ribbon);

    if (isFloat) {
      const stripe = new THREE.Mesh(makeStrip(rowsFine, stripeRow, 2), stripeMat);
      cg.add(stripe);
      const skirt = new THREE.Mesh(skirtGeom(rowsOf(i0, i1, 4)), navyMat);
      cg.add(skirt);
    } else {
      const widths = new Map();
      for (const i of rowsFine) {
        widths.set(i, 6.5 + 4.5 * Math.abs(Math.sin(i * 0.045 + track.seed)) + 1.2 * Math.sin(i * 0.013 + 1.7));
      }
      const island = new THREE.Mesh(
        makeStrip(rowsFine, (i) => islandRow(i, widths.get(i)), 14),
        sandMat
      );
      island.receiveShadow = true;
      cg.add(island);
      const rowsCoarse = rowsOf(i0, i1, 4);
      const sh = new THREE.Mesh(makeStrip(rowsCoarse, (i) => shallowRow(i, widths.get(i) ?? 8), 2), shallowMat);
      sh.renderOrder = 1;
      cg.add(sh);
      const fm = new THREE.Mesh(makeStrip(rowsCoarse, (i) => foamRow(i, widths.get(i) ?? 8), 4), foamMat);
      fm.renderOrder = 2;
      cg.add(fm);
      for (const i of rowsCoarse) scatterVegetation(i, widths.get(i) ?? 8);
    }
    group.add(cg);
    chunks.push({ group: cg, s0: i0 * DS, s1: i1 * DS });
  }

  const lipOverlay = buildLipOverlays();
  if (lipOverlay) group.add(lipOverlay);

  // ---------- 식생 ----------
  function scrubGeom() {
    // 교차 빌보드 3장 + 알파 텍스처
    const geoms = [];
    for (let k = 0; k < 3; k++) {
      const p = new THREE.PlaneGeometry(1.5, 1.1);
      p.translate(0, 0.5, 0);
      p.rotateY((k / 3) * Math.PI);
      geoms.push(p);
    }
    return mergeGeoms(geoms);
  }
  function palmTrunkGeom() {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.12, 1.6, 0.04),
      new THREE.Vector3(0.5, 3.1, 0.1),
      new THREE.Vector3(1.05, 4.45, 0.16),
    ]);
    const g = new THREE.TubeGeometry(curve, 14, 0.15, 10, false);
    const u = g.attributes.uv;
    for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 3, u.getY(i) * 1.2);
    return g;
  }
  function palmCrownGeom() {
    const geoms = [];
    for (let k = 0; k < 11; k++) {
      const leaf = new THREE.PlaneGeometry(2.4, 0.85, 6, 1);
      const pa = leaf.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i) + 1.2;
        pa.setZ(i, pa.getZ(i) - Math.pow(x / 2.4, 2) * 1.05); // 아래로 처지는 커브
      }
      leaf.rotateX(-Math.PI / 2);
      leaf.translate(1.05, 0, 0);
      leaf.rotateZ(0.15 + (rnd() - 0.5) * 0.3);
      leaf.rotateY((k / 11) * Math.PI * 2 + rnd() * 0.3);
      geoms.push(leaf);
    }
    const crown = mergeGeoms(geoms);
    crown.translate(1.08, 4.62, 0.16);
    return crown;
  }

  function makeInstanced(geom, mats, material, shadow) {
    const im = new THREE.InstancedMesh(geom, material, Math.max(1, mats.length));
    for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
    im.count = mats.length;
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = !!shadow;
    return im;
  }

  // ---------- 소품 ----------
  const tmpPos = new THREE.Vector3(), tmpDir = new THREE.Vector3();
  const bigLip = track.lips.find((l) => l.size === 'big');
  if (bigLip) {
    track.posAt(bigLip.s - 5, tmpPos);
    track.dirAt(bigLip.s - 5, tmpDir);
    const contMat = new THREE.MeshStandardMaterial({
      map: tex.container, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.8,
    });
    const contTop = new THREE.MeshStandardMaterial({ color: 0x2b5fd0, roughness: 0.6, metalness: 0.3 });
    const contain = new THREE.Mesh(new THREE.BoxGeometry(6.5, 4.2, 11), [
      contMat, contMat, contTop, contTop, contMat, contMat,
    ]);
    contain.position.set(tmpPos.x, tmpPos.y - 2.6, tmpPos.z);
    contain.rotation.y = Math.atan2(tmpDir.x, tmpDir.z);
    contain.castShadow = true;
    group.add(contain);
    const lat = new THREE.Vector3(tmpDir.z, 0, -tmpDir.x);
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 0.8, roughness: 0.35 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 8, 12), metal);
    pole.position.set(tmpPos.x + lat.x * 3.6, tmpPos.y + 2, tmpPos.z + lat.z * 3.6);
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0, 6, 3),
      new THREE.MeshStandardMaterial({ color: 0xe8442c, side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(pole.position.x + 0.8, tmpPos.y + 5.4, pole.position.z);
    group.add(flag);
    // 윈드삭
    track.posAt(bigLip.s - 30, tmpPos);
    track.dirAt(bigLip.s - 30, tmpDir);
    const lat2 = new THREE.Vector3(tmpDir.z, 0, -tmpDir.x);
    const wx = tmpPos.x + lat2.x * 5, wz = tmpPos.z + lat2.z * 5;
    const wpole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 5, 10), metal);
    wpole.position.set(wx, tmpPos.y + 2, wz);
    group.add(wpole);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 14),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.8 }));
    sock.rotation.z = Math.PI / 2;
    sock.position.set(wx - 0.8, tmpPos.y + 4.4, wz);
    group.add(sock);
  }

  // 피니시 게이트
  {
    track.posAt(track.finishS, tmpPos);
    track.dirAt(track.finishS, tmpDir);
    const lat = new THREE.Vector3(tmpDir.z, 0, -tmpDir.x);
    const matPost = new THREE.MeshStandardMaterial({ color: 0x2456c9, roughness: 0.4, metalness: 0.2 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.5, 14), matPost);
      post.position.set(tmpPos.x + lat.x * 3.4 * side, tmpPos.y + 2.4, tmpPos.z + lat.z * 3.4 * side);
      post.castShadow = true;
      group.add(post);
    }
    const bannerG = new THREE.Group();
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(7.4, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 })
    );
    bannerG.add(banner);
    for (let k = 0; k < 12; k++) {
      const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55),
        new THREE.MeshBasicMaterial({ color: k % 2 ? 0x111111 : 0xffffff, side: THREE.DoubleSide }));
      sq.position.set(-3.2 + k * 0.58, 0, 0.01);
      bannerG.add(sq);
    }
    bannerG.position.set(tmpPos.x, tmpPos.y + 4.7, tmpPos.z);
    bannerG.rotation.y = Math.atan2(tmpDir.x, tmpDir.z);
    group.add(bannerG);
  }

  // 원경: 트리라인 + 오프코스 작은 섬
  {
    const treeMat = new THREE.MeshLambertMaterial({ color: 0x6d8a70 });
    let cx = 0, cz = 0;
    const cnt = Math.ceil(N / 40);
    for (let i = 0; i < N; i += 40) { cx += S[i].x; cz += S[i].z; }
    cx /= cnt; cz /= cnt;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rnd();
      const dist = 880 + rnd() * 320;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(130 + rnd() * 110, 3.5 + rnd() * 3.5, 12), treeMat);
      strip.position.set(cx + Math.sin(a) * dist, 1.2, cz + Math.cos(a) * dist);
      strip.rotation.y = -a + Math.PI / 2 + (rnd() - 0.5);
      group.add(strip);
    }
    const isletMat = new THREE.MeshStandardMaterial({ map: tex.sand, roughness: 1 });
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(rnd() * N);
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = lateral(i).clone();
      const off = 55 + rnd() * 120;
      const px = S[i].x + lat.x * off * side, pz = S[i].z + lat.z * off * side;
      const isl = new THREE.Mesh(new THREE.SphereGeometry(10 + rnd() * 9, 20, 12), isletMat);
      isl.scale.y = 0.22;
      isl.position.set(px, -1.3, pz);
      group.add(isl);
      if (rnd() < 0.8) {
        const m = new THREE.Matrix4();
        m.makeRotationY(rnd() * Math.PI * 2);
        m.setPosition(px + rnd() * 4 - 2, 0.35, pz + rnd() * 4 - 2);
        palmMats.push(m);
      }
    }
  }

  if (grassMats.length) {
    // 빌보드는 언릿: 수직면 램버트 음영이 검게 뭉치는 것 방지
    const scrubMat = new THREE.MeshBasicMaterial({
      map: tex.scrub, alphaTest: 0.4, side: THREE.DoubleSide, color: 0xd9d5bd,
    });
    group.add(makeInstanced(scrubGeom(), grassMats, scrubMat, false));
  }
  if (palmMats.length) {
    const barkMat = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.95 });
    const frondMat = new THREE.MeshLambertMaterial({
      map: tex.frond, alphaTest: 0.35, side: THREE.DoubleSide,
    });
    group.add(makeInstanced(palmTrunkGeom(), palmMats.map((m) => m.clone()), barkMat, true));
    group.add(makeInstanced(palmCrownGeom(), palmMats.map((m) => m.clone()), frondMat, false));
  }

  // ---------- 조명 ----------
  const hemi = new THREE.HemisphereLight(0xcfe8f5, 0xd8c194, 0.55);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
  sun.shadow.camera.near = 2; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  group.add(sun);
  group.add(sun.target);

  scene.add(group);

  return {
    group, waterUniforms,
    update(time, focus, bikeS) {
      waterUniforms.time.value = time;
      water.position.x = focus.x; water.position.z = focus.z;
      sky.position.copy(focus);
      sun.position.set(focus.x + SUN_DIR.x * 60, focus.y + SUN_DIR.y * 60, focus.z + SUN_DIR.z * 60);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
      if (bikeS !== undefined) {
        for (const c of chunks) {
          c.group.visible = c.s1 > bikeS - CULL_BEHIND && c.s0 < bikeS + CULL_AHEAD;
        }
      }
    },
    dispose() {
      scene.remove(group);
      scene.environment = null;
      envRT.dispose();
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        if (o.isLight) o.dispose();
        if (o.geometry) o.geometry.dispose();
        // 텍스처는 전역 캐시라 유지 — 머티리얼 객체만 해제
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    },
  };
}
