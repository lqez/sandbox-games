// world.js — 하늘/바다/섬/램프 비주얼 구축
// 카메라가 항상 바이크 뒤에서 전방을 보므로, 지형은 s 구간 청크로 나눠
// 바이크 뒤쪽 청크는 visible=false 처리(+전방 원거리 컷)로 드로우콜을 아낀다.
import * as THREE from 'three';
import { DS, T, DECK, mulberry32 } from './track.js';

export const SUN_DIR = new THREE.Vector3(0.32, 0.46, 0.83).normalize();

const CHUNK_LEN = 70;      // m
const CULL_BEHIND = 45;    // 바이크 뒤 유지 거리
const CULL_AHEAD = 560;    // 전방 유지 거리

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
  // 태양 방향 그레이징엔 따뜻한 톤 가미
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

function mergeGeoms(geoms) {
  let vCount = 0, iCount = 0;
  for (const g of geoms) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geoms) {
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (c) col.set(c.array, vo * 3);
    else for (let i = 0; i < p.count * 3; i++) col[vo * 3 + i] = 1;
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
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function tintGeom(geom, hex, vary, rnd) {
  const c = new THREE.Color(hex);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = vary ? 1 - rnd() * vary : 1;
    arr[i * 3] = c.r * v; arr[i * 3 + 1] = c.g * v; arr[i * 3 + 2] = c.b * v;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

export function buildWorld(track, scene) {
  const group = new THREE.Group();
  const rnd = mulberry32(track.seed ^ 0x9e3779b9);
  const S = track.samples, N = S.length;

  // ---------- 하늘 / 바다 ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 28, 16),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: { sunDir: { value: SUN_DIR } },
      side: THREE.BackSide, depthWrite: false, fog: false,
    })
  );
  sky.frustumCulled = false;
  group.add(sky);

  const waterUniforms = {
    time: { value: 0 },
    sunDir: { value: SUN_DIR },
    fogColor: { value: new THREE.Color(0xbfe8f2) },
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400, 48, 48),
    new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      uniforms: waterUniforms, fog: false,
    })
  );
  water.rotation.x = -Math.PI / 2;
  group.add(water);

  // ---------- 공용 헬퍼 ----------
  const latV = new THREE.Vector3();
  function lateral(i) {
    latV.set(track.dirs[i * 2 + 1], 0, -track.dirs[i * 2]);
    return latV;
  }
  const lipSet = new Set();
  for (const lip of track.lips) {
    const li = Math.floor(lip.s / DS);
    for (let d = -3; d <= 0; d++) lipSet.add(li + d);
  }

  const cDirt = new THREE.Color(0xdbaf74), cDirtDark = new THREE.Color(0xcc9c5e);
  const cPly = new THREE.Color(0xc9a86a), cStripe = new THREE.Color(0x5e4426);
  const cLip = new THREE.Color(0xf2ede2);
  const cSand = new THREE.Color(0xe6c48d), cGrassCol = new THREE.Color(0xa3a862);
  const cWet = new THREE.Color(0xd6c194), cNavy = new THREE.Color(0x1d3f78);
  const cShallow = new THREE.Color(0x49c8bd);
  const cUnder = new THREE.Color(0x58cabc); // 수중 모래(터콰이즈 투과)

  // ---------- 청크 시스템 ----------
  // chunk = { group, s0, s1 } — update()에서 바이크 s 기준 컬링
  const chunks = [];
  const terraMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const shallowMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false,
  });
  const foamMat = new THREE.ShaderMaterial({
    uniforms: { time: waterUniforms.time },
    transparent: true, depthWrite: false, fog: false,
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
  foamMat.vertexColors = true;

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
  function makeStrip(rows, colFn, cols) {
    const pos = [], col = [];
    for (const i of rows) {
      const pts = colFn(i);
      for (const [x, y, z, c] of pts) { pos.push(x, y, z); col.push(c.r, c.g, c.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(stripIndices(rows.length, cols));
    g.computeVertexNormals();
    return g;
  }

  // 리본(주행면) 단면 — 4열: 가장자리 + 타이어 라인용 중앙 밴드
  function smoothN(x) {
    return 0.5 + 0.28 * Math.sin(x * 0.061) + 0.22 * Math.sin(x * 0.017 + 2.1);
  }
  function ribbonRow(i) {
    const s = S[i];
    const lat = lateral(i);
    const fl = s.type === T.FLOAT;
    const half = fl ? 2.1 : 2.6;
    const out = [];
    const isLip = lipSet.has(i);
    const blend = smoothN(i);
    for (const off of [-half, -0.95, 0.95, half]) {
      const side = Math.sign(off);
      // 코너 바깥쪽(회전중심 반대편) 에지를 올려 뱅크 표현
      const lift = (s.berm * side < 0 && Math.abs(off) > 1) ? 0.55 * Math.abs(s.berm) : 0;
      let c;
      if (fl) c = cPly;
      else {
        c = cDirt.clone().lerp(cDirtDark, blend);
        if (Math.abs(off) < 1.5) c.multiplyScalar(0.92); // 타이어 자국 밴드
      }
      if (isLip) c = cLip;
      out.push([s.x + lat.x * off, s.y + 0.02 + lift, s.z + lat.z * off, c]);
    }
    return out;
  }
  function stripeRow(i) {
    const s = S[i];
    const lat = lateral(i);
    return [-1, 1].map((side) => [s.x + lat.x * 0.55 * side, s.y + 0.035, s.z + lat.z * 0.55 * side, cStripe]);
  }

  // 섬 본체 단면 (6열)
  function islandRow(i, w) {
    const s = S[i];
    const lat = lateral(i);
    const grassy = (Math.sin(i * 0.11 + track.seed * 3) + 1) / 2;
    const mixC = (g) => cSand.clone().lerp(cGrassCol, Math.min(1, g));
    // 물가 쪽은 젖은 모래 → 수중 터콰이즈로 그라데이션 (해안 투과감)
    const shoreL = cWet.clone().lerp(cUnder, 0.75 + rnd() * 0.2);
    const shoreR = cWet.clone().lerp(cUnder, 0.75 + rnd() * 0.2);
    return [
      [s.x - lat.x * (w + 3.5), -0.7, s.z - lat.z * (w + 3.5), shoreL],
      [s.x - lat.x * w * 0.62, s.y - 0.6, s.z - lat.z * w * 0.62, mixC(grassy * (0.35 + rnd() * 0.55))],
      [s.x - lat.x * 2.55, s.y + 0.01, s.z - lat.z * 2.55, mixC(grassy * 0.18)],
      [s.x + lat.x * 2.55, s.y + 0.01, s.z + lat.z * 2.55, mixC(grassy * 0.18)],
      [s.x + lat.x * w * 0.62, s.y - 0.6, s.z + lat.z * w * 0.62, mixC((1 - grassy) * (0.35 + rnd() * 0.55))],
      [s.x + lat.x * (w + 3.5), -0.7, s.z + lat.z * (w + 3.5), shoreR],
    ];
  }
  // 해안 거품 라인: 파도가 스치는 흰 띠 (시간 노이즈로 알파 변조)
  function foamRow(i, w) {
    const s = S[i];
    const lat = lateral(i);
    const cIn = new THREE.Color(1, 1, 1);       // r=fade 용도로도 사용
    const cOut = new THREE.Color(0, 1, 1);
    return [
      [s.x - lat.x * (w + 2.2), 0.09, s.z - lat.z * (w + 2.2), cOut],
      [s.x - lat.x * (w + 1.0), 0.09, s.z - lat.z * (w + 1.0), cIn],
      [s.x + lat.x * (w + 1.0), 0.09, s.z + lat.z * (w + 1.0), cIn],
      [s.x + lat.x * (w + 2.2), 0.09, s.z + lat.z * (w + 2.2), cOut],
    ];
  }
  function shallowRow(i, w) {
    const s = S[i];
    const lat = lateral(i);
    return [-1, 1].map((side) => [s.x + lat.x * (w + 6.5) * side, 0.05, s.z + lat.z * (w + 6.5) * side, cShallow]);
  }

  // 부유 플랫폼 스커트 (양 측면 수직벽, 4열 스트립 2개로 구성)
  function skirtGeom(rows) {
    const pos = [], col = [], idx = [];
    let vo = 0;
    for (const side of [-1, 1]) {
      for (const i of rows) {
        const s = S[i];
        const lat = lateral(i);
        pos.push(s.x + lat.x * 2.1 * side, s.y + 0.02, s.z + lat.z * 2.1 * side);
        pos.push(s.x + lat.x * 2.1 * side, -0.35, s.z + lat.z * 2.1 * side);
        col.push(cNavy.r, cNavy.g, cNavy.b, cNavy.r, cNavy.g, cNavy.b);
      }
      for (let r = 0; r < rows.length - 1; r++) {
        const a = vo + r * 2;
        if (side < 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      vo += rows.length * 2;
    }
    // 전/후면 캡
    const L0 = 0, R0 = rows.length * 2;
    idx.push(L0, L0 + 1, R0, R0, L0 + 1, R0 + 1);
    const Le = (rows.length - 1) * 2, Re = rows.length * 2 + Le;
    idx.push(Le, Re, Le + 1, Le + 1, Re, Re + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---------- 런 → 청크 빌드 ----------
  const grassMats = [], palmMats = [];
  function scatterVegetation(i, w) {
    const s = S[i];
    if (s.type !== T.DIRT) return; // 램프 경사면엔 식생 금지
    const lat = lateral(i);
    for (let k = 0; k < 3; k++) {
      if (rnd() < 0.66) {
        const side = rnd() < 0.5 ? -1 : 1;
        const off = (3.2 + rnd() * Math.max(0.5, w * 0.55 - 3.2)) * side;
        const m = new THREE.Matrix4();
        const sc = 0.6 + rnd() * 0.55;
        m.makeRotationY(rnd() * Math.PI);
        m.scale(new THREE.Vector3(sc, sc * (0.8 + rnd() * 0.5), sc));
        m.setPosition(s.x + lat.x * off, s.y - 0.32, s.z + lat.z * off);
        grassMats.push(m);
      }
    }
    if (rnd() < 0.058 && palmMats.length < 26) {
      const side = rnd() < 0.5 ? -1 : 1;
      const off = (4.2 + rnd() * 2.5) * side;
      const m = new THREE.Matrix4();
      const sc = 0.8 + rnd() * 0.5;
      m.makeRotationY(rnd() * Math.PI * 2);
      m.scale(new THREE.Vector3(sc, sc, sc));
      m.setPosition(s.x + lat.x * off, s.y - 0.45, s.z + lat.z * off);
      palmMats.push(m);
    }
  }

  {
    let i = 0;
    while (i < N) {
      if (!S[i].solid) { i++; continue; }
      let j = i;
      while (j < N && S[j].solid) j++;
      // 런을 CHUNK_LEN 단위로 분할
      const chunkSamples = Math.round(CHUNK_LEN / DS);
      for (let c0 = i; c0 < j; c0 += chunkSamples) {
        const c1 = Math.min(j, c0 + chunkSamples + 1); // 이음새 겹침 1샘플
        buildChunk(c0, c1);
      }
      i = j;
    }
  }

  function buildChunk(i0, i1) {
    const isFloat = S[i0].type === T.FLOAT || S[Math.min(i1 - 1, i0 + 6)].type === T.FLOAT;
    const geoms = [];
    const rowsFine = rowsOf(i0, i1, 2);   // 1m
    geoms.push(makeStrip(rowsFine, ribbonRow, 4));
    let shallowG = null, foamG = null;
    if (isFloat) {
      geoms.push(makeStrip(rowsFine, stripeRow, 2));
      geoms.push(skirtGeom(rowsOf(i0, i1, 4)));
    } else {
      const rowsCoarse = rowsOf(i0, i1, 4); // 2m
      const widths = new Map();
      for (const i of rowsCoarse) {
        // 행간 연속성 유지 (저주파 사인 조합 — 지그재그 방지)
        widths.set(i, 6.5 + 4.5 * Math.abs(Math.sin(i * 0.045 + track.seed)) + 1.2 * Math.sin(i * 0.013 + 1.7));
      }
      geoms.push(makeStrip(rowsCoarse, (i) => islandRow(i, widths.get(i)), 6));
      shallowG = makeStrip(rowsCoarse, (i) => shallowRow(i, widths.get(i)), 2);
      foamG = makeStrip(rowsCoarse, (i) => foamRow(i, widths.get(i)), 4);
      for (const i of rowsCoarse) scatterVegetation(i, widths.get(i));
    }
    const cg = new THREE.Group();
    const terra = new THREE.Mesh(mergeGeoms(geoms), terraMat);
    terra.receiveShadow = true;
    cg.add(terra);
    if (shallowG) {
      const sh = new THREE.Mesh(shallowG, shallowMat);
      sh.renderOrder = 1;
      cg.add(sh);
    }
    if (foamG) {
      const fm = new THREE.Mesh(foamG, foamMat);
      fm.renderOrder = 2;
      cg.add(fm);
    }
    group.add(cg);
    chunks.push({ group: cg, s0: i0 * DS, s1: i1 * DS });
  }

  // ---------- 식생 (전역 인스턴싱: 드로우콜 3개) ----------
  function grassGeom() {
    // 마른 관목: 부채꼴 잎 6장 (밝은 올리브/카키)
    const geoms = [];
    for (let k = 0; k < 6; k++) {
      const p = new THREE.PlaneGeometry(0.11, 0.6);
      p.translate(0, 0.26, 0);
      const tiltm = new THREE.Matrix4().makeRotationX(-0.45 - rnd() * 0.35);
      p.applyMatrix4(tiltm);
      p.rotateY((k / 6) * Math.PI * 2 + rnd());
      geoms.push(tintGeom(p, k % 2 ? 0xc9bd7e : 0xb0a866, 0.22, rnd));
    }
    return mergeGeoms(geoms);
  }
  function palmTrunkGeom() {
    const t = new THREE.CylinderGeometry(0.1, 0.17, 4.4, 6, 6);
    const posA = t.attributes.position;
    for (let i = 0; i < posA.count; i++) {
      const y = posA.getY(i) + 2.2;
      posA.setX(i, posA.getX(i) + Math.pow(y / 4.4, 2) * 1.1);
    }
    t.translate(0, 2.2, 0);
    t.computeVertexNormals();
    return tintGeom(t, 0x9d8a68, 0.25, rnd);
  }
  function palmCrownGeom() {
    const geoms = [];
    for (let k = 0; k < 9; k++) {
      const leaf = new THREE.PlaneGeometry(1.9, 0.42, 4, 1);
      const pa = leaf.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i) + 0.95;
        pa.setY(i, pa.getY(i) - Math.pow(x / 1.9, 2) * 0.85);
        pa.setZ(i, pa.getZ(i) * (1 - x / 2.6));
      }
      leaf.translate(0.8, 0, 0);
      leaf.rotateX((rnd() - 0.5) * 0.25);
      leaf.rotateY((k / 9) * Math.PI * 2 + 0.3);
      geoms.push(tintGeom(leaf, k % 2 ? 0x7fa14e : 0x93b45c, 0.22, rnd));
    }
    const crown = mergeGeoms(geoms);
    crown.translate(1.1, 4.5, 0);
    return crown;
  }
  function makeInstanced(geom, mats, opts, shadow, unlit) {
    const Mat = unlit ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial;
    const mat = new Mat({ vertexColors: true, side: THREE.DoubleSide, ...opts });
    const im = new THREE.InstancedMesh(geom, mat, Math.max(1, mats.length));
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
    const contain = new THREE.Mesh(
      new THREE.BoxGeometry(6.5, 4.2, 11),
      new THREE.MeshLambertMaterial({ color: 0x2b5fd0 })
    );
    contain.position.set(tmpPos.x, tmpPos.y - 2.6, tmpPos.z);
    contain.rotation.y = Math.atan2(tmpDir.x, tmpDir.z);
    contain.castShadow = true;
    group.add(contain);
    const lat = new THREE.Vector3(tmpDir.z, 0, -tmpDir.x);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 8, 5),
      new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.position.set(tmpPos.x + lat.x * 3.6, tmpPos.y + 2, tmpPos.z + lat.z * 3.6);
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0),
      new THREE.MeshLambertMaterial({ color: 0xe8442c, side: THREE.DoubleSide }));
    flag.position.set(pole.position.x + 0.8, tmpPos.y + 5.4, pole.position.z);
    group.add(flag);
    // 윈드삭
    track.posAt(bigLip.s - 30, tmpPos);
    track.dirAt(bigLip.s - 30, tmpDir);
    const lat2 = new THREE.Vector3(tmpDir.z, 0, -tmpDir.x);
    const wx = tmpPos.x + lat2.x * 5, wz = tmpPos.z + lat2.z * 5;
    const wpole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 5, 5),
      new THREE.MeshLambertMaterial({ color: 0xcccccc }));
    wpole.position.set(wx, tmpPos.y + 2, wz);
    group.add(wpole);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 8),
      new THREE.MeshLambertMaterial({ color: 0xff7a1a }));
    sock.rotation.z = Math.PI / 2;
    sock.position.set(wx - 0.8, tmpPos.y + 4.4, wz);
    group.add(sock);
  }

  // 피니시 게이트
  {
    track.posAt(track.finishS, tmpPos);
    track.dirAt(track.finishS, tmpDir);
    const lat = new THREE.Vector3(tmpDir.z, 0, -tmpDir.x);
    const matPost = new THREE.MeshLambertMaterial({ color: 0x2456c9 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.5, 8), matPost);
      post.position.set(tmpPos.x + lat.x * 3.4 * side, tmpPos.y + 2.4, tmpPos.z + lat.z * 3.4 * side);
      post.castShadow = true;
      group.add(post);
    }
    const bannerG = new THREE.Group();
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(7.4, 1.1),
      new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })
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
    const sandMat = new THREE.MeshLambertMaterial({ color: 0xe2c795 });
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(rnd() * N);
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = lateral(i).clone();
      const off = 55 + rnd() * 120;
      const px = S[i].x + lat.x * off * side, pz = S[i].z + lat.z * off * side;
      const isl = new THREE.Mesh(new THREE.SphereGeometry(10 + rnd() * 9, 10, 7), sandMat);
      isl.scale.y = 0.22;
      isl.position.set(px, -1.3, pz);
      group.add(isl);
      if (rnd() < 0.8) {
        const m = new THREE.Matrix4();
        m.makeRotationY(rnd() * Math.PI * 2);
        m.setPosition(px + rnd() * 4 - 2, 0.4, pz + rnd() * 4 - 2);
        palmMats.push(m);
      }
    }
  }

  if (grassMats.length) group.add(makeInstanced(grassGeom(), grassMats, {}, false, true));
  if (palmMats.length) {
    group.add(makeInstanced(palmTrunkGeom(), palmMats.map((m) => m.clone()), { side: THREE.FrontSide }, true));
    group.add(makeInstanced(palmCrownGeom(), palmMats.map((m) => m.clone()), {}, false));
  }

  // ---------- 조명 ----------
  const hemi = new THREE.HemisphereLight(0xcfe8f5, 0xd8c194, 0.95);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -14; sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = 2; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
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
      // 후방/원거리 청크 컬링
      if (bikeS !== undefined) {
        for (const c of chunks) {
          c.group.visible = c.s1 > bikeS - CULL_BEHIND && c.s0 < bikeS + CULL_AHEAD;
        }
      }
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();      // instanceMatrix GPU 버퍼
        if (o.isLight) o.dispose();              // 그림자 렌더타깃
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    },
  };
}
