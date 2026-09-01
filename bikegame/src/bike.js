// bike.js — 하이폴리 스턴트 바이크 3종 + 관절 리깅 라이더 (PBR)
// 리깅: pelvis(루트) > spine > head / shoulder > elbow / hip > knee
// 포즈는 조인트 오일러 목표값 테이블로 정의하고 런타임에 블렌딩한다.
import * as THREE from 'three';

export const BIKE_SPECS = [
  {
    id: 'mx450', name: 'MX 450', desc: '4행정 밸런스 · 안정적',
    body: 0x39b8c9, accent: 0xf2f4f2, rim: 0xb9bcc4,
    accel: 9.5, vmax: 26, flipDur: 0.85, stability: 1.0,
    engine: { wave: 'sawtooth', base: 44, mult: 115, filter: 240, filterMult: 850, gain: 1.0, det: 0.5 },
  },
  {
    id: 'st250', name: '250 2-STROKE', desc: '2행정 경량 · 순간 가속',
    body: 0xe8442c, accent: 0xfff5ee, rim: 0xd8d8d8,
    accel: 11.2, vmax: 25, flipDur: 0.78, stability: 0.85,
    engine: { wave: 'square', base: 68, mult: 185, filter: 420, filterMult: 1500, gain: 0.62, det: 7 },
  },
  {
    id: 'emoto', name: 'E-MOTO', desc: '전기 토크 · 저소음',
    body: 0x23262b, accent: 0x8dff57, rim: 0x3fe0d8,
    accel: 12.6, vmax: 24.5, flipDur: 0.9, stability: 1.15,
    engine: { wave: 'triangle', base: 160, mult: 430, filter: 1400, filterMult: 2400, gain: 0.34, det: 2.01 },
  },
];

// 조인트 포즈 테이블 [rx, ry, rz]
const POSES = {
  sit: {
    spine: [0.5, 0, 0], head: [-0.25, 0, 0],
    upperL: [1.05, 0, -0.25], upperR: [1.05, 0, 0.25],
    elbowL: [-0.62, 0, 0], elbowR: [-0.62, 0, 0],
    hipL: [-0.95, 0, -0.06], hipR: [-0.95, 0, 0.06],
    kneeL: [1.25, 0, 0], kneeR: [1.25, 0, 0],
    pelvis: [0, 0, 0], pelvisPos: [0, 0, 0],
  },
  crouch: {
    spine: [0.85, 0, 0], head: [-0.5, 0, 0],
    upperL: [1.28, 0, -0.3], upperR: [1.28, 0, 0.3],
    elbowL: [-0.88, 0, 0], elbowR: [-0.88, 0, 0],
    hipL: [-1.2, 0, -0.06], hipR: [-1.2, 0, 0.06],
    kneeL: [1.5, 0, 0], kneeR: [1.5, 0, 0],
    pelvis: [0, 0, 0], pelvisPos: [0, -0.07, -0.04],
  },
  air: {
    spine: [0.32, 0, 0], head: [-0.15, 0, 0],
    upperL: [0.85, 0, -0.45], upperR: [0.85, 0, 0.45],
    elbowL: [-0.45, 0, 0], elbowR: [-0.45, 0, 0],
    hipL: [-0.7, 0, -0.1], hipR: [-0.7, 0, 0.1],
    kneeL: [0.95, 0, 0], kneeR: [0.95, 0, 0],
    pelvis: [0, 0, 0], pelvisPos: [0, 0.09, 0],
  },
  tuck: {
    spine: [0.95, 0, 0], head: [-0.55, 0, 0],
    upperL: [1.3, 0, -0.2], upperR: [1.3, 0, 0.2],
    elbowL: [-1.1, 0, 0], elbowR: [-1.1, 0, 0],
    hipL: [-1.45, 0, -0.05], hipR: [-1.45, 0, 0.05],
    kneeL: [1.8, 0, 0], kneeR: [1.8, 0, 0],
    pelvis: [0, 0, 0], pelvisPos: [0, -0.05, 0],
  },
  superman: {
    // 핸들만 잡고 다리를 뒤로 쭉 — 몸 수평
    spine: [-0.5, 0, 0], head: [0.35, 0, 0],
    upperL: [0.35, 0, -0.15], upperR: [0.35, 0, 0.15],
    elbowL: [-0.06, 0, 0], elbowR: [-0.06, 0, 0],
    hipL: [1.35, 0, -0.12], hipR: [1.35, 0, 0.12],
    kneeL: [0.12, 0, 0], kneeR: [0.12, 0, 0],
    pelvis: [-0.85, 0, 0], pelvisPos: [0, 0.32, -0.62],
  },
  scissor: {
    spine: [0.1, 0, 0], head: [0, 0, 0],
    upperL: [0.55, 0, -0.3], upperR: [0.55, 0, 0.3],
    elbowL: [-0.2, 0, 0], elbowR: [-0.2, 0, 0],
    hipL: [0.9, 0, -0.2], hipR: [-1.6, 0, 0.2],
    kneeL: [0.15, 0, 0], kneeR: [0.5, 0, 0],
    pelvis: [-0.4, 0, 0], pelvisPos: [0, 0.24, -0.3],
  },
  whipL: {
    spine: [0.4, 0.25, 0.35], head: [-0.1, 0.3, 0],
    upperL: [0.5, 0, -0.7], upperR: [1.0, 0, 0.4],
    elbowL: [-0.15, 0, 0], elbowR: [-0.75, 0, 0],
    hipL: [-0.6, 0, -0.3], hipR: [-0.9, 0, 0.15],
    kneeL: [0.9, 0, 0], kneeR: [1.2, 0, 0],
    pelvis: [0, 0.18, 0.16], pelvisPos: [0.07, 0.06, 0],
  },
  wheelie: {
    spine: [0.15, 0, 0], head: [-0.3, 0, 0],
    upperL: [0.5, 0, -0.3], upperR: [0.5, 0, 0.3],
    elbowL: [-0.12, 0, 0], elbowR: [-0.12, 0, 0],
    hipL: [-0.85, 0, -0.06], hipR: [-0.85, 0, 0.06],
    kneeL: [1.15, 0, 0], kneeR: [1.15, 0, 0],
    pelvis: [0, 0, 0], pelvisPos: [0, 0.02, -0.12],
  },
};
POSES.whipR = mirrorPose(POSES.whipL);

function mirrorPose(p) {
  const m = {};
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (k === 'pelvisPos') { m[k] = [-v[0], v[1], v[2]]; continue; }
    let kk = k;
    if (k.endsWith('L')) kk = k.slice(0, -1) + 'R';
    else if (k.endsWith('R')) kk = k.slice(0, -1) + 'L';
    m[kk] = [v[0], -v[1], -v[2]];
  }
  return m;
}

// 단일 머티리얼용 지오메트리 병합 (position/normal/uv)
function mergeGeo(geoms) {
  let vCount = 0, iCount = 0;
  for (const g of geoms) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = vo + i;
      io += g.attributes.position.count;
    }
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function buildBike(specIdx) {
  const spec = BIKE_SPECS[specIdx] || BIKE_SPECS[0];
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  const wheeliePivot = new THREE.Group();
  const model = new THREE.Group();
  group.add(tilt);
  tilt.add(wheeliePivot);
  wheeliePivot.add(model);

  const REAR = new THREE.Vector3(0, 0.36, -0.68);
  wheeliePivot.position.copy(REAR);
  model.position.copy(REAR.clone().negate());

  // ---- PBR 머티리얼 ----
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x191a1e, roughness: 0.95, metalness: 0 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2b2c31, roughness: 0.55, metalness: 0.3 });
  const matBody = new THREE.MeshStandardMaterial({ color: spec.body, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.7 });
  const matAccent = new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.35, metalness: 0.05, envMapIntensity: 0.6 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0xb9bfc8, roughness: 0.32, metalness: 0.85, envMapIntensity: 1.2 });
  const matChrome = new THREE.MeshStandardMaterial({ color: 0xd7dade, roughness: 0.18, metalness: 0.95, envMapIntensity: 1.3 });
  const matGold = new THREE.MeshStandardMaterial({ color: 0xc9a34e, roughness: 0.3, metalness: 0.8, envMapIntensity: 1.2 });
  const matJersey = new THREE.MeshStandardMaterial({ color: 0x39b8c9, roughness: 0.8, metalness: 0 });
  const matPants = new THREE.MeshStandardMaterial({ color: 0xf2f4f2, roughness: 0.75, metalness: 0 });
  const matHelmet = new THREE.MeshStandardMaterial({ color: 0xf5f7f5, roughness: 0.25, metalness: 0.05, envMapIntensity: 0.7 });
  const matPack = new THREE.MeshStandardMaterial({ color: 0x7fd0e8, roughness: 0.7, metalness: 0 });
  const matGlove = new THREE.MeshStandardMaterial({ color: 0x25262b, roughness: 0.85, metalness: 0 });

  // ---- 휠 (노비 타이어 + 스포크 + 브레이크 디스크) ----
  function wheel() {
    const w = new THREE.Group();
    // 타이어 + 노비 트레드 병합
    const tireGeoms = [new THREE.TorusGeometry(0.33, 0.058, 14, 40)];
    for (let k = 0; k < 34; k++) {
      const a = (k / 34) * Math.PI * 2;
      const b = new THREE.BoxGeometry(0.05, 0.02, 0.032);
      const m = new THREE.Matrix4()
        .makeRotationZ(a)
        .multiply(new THREE.Matrix4().makeTranslation(0, 0.385, k % 2 ? 0.022 : -0.022));
      b.applyMatrix4(m);
      tireGeoms.push(b);
    }
    const tire = new THREE.Mesh(mergeGeo(tireGeoms), matRubber);
    w.add(tire);
    // 림 + 스포크
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.02, 10, 30), matMetal);
    w.add(rim);
    const spokeGeoms = [];
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const sp = new THREE.CylinderGeometry(0.006, 0.006, 0.19, 5);
      const m = new THREE.Matrix4()
        .makeRotationZ(a)
        .multiply(new THREE.Matrix4().makeTranslation(0, 0.125, k % 2 ? 0.02 : -0.02))
        .multiply(new THREE.Matrix4().makeRotationX(k % 2 ? 0.12 : -0.12));
      sp.applyMatrix4(m);
      spokeGeoms.push(sp);
    }
    w.add(new THREE.Mesh(mergeGeo(spokeGeoms), matMetal));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.1, 14), matMetal);
    hub.rotation.x = Math.PI / 2;
    w.add(hub);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.012, 26), matChrome);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = 0.055;
    w.add(disc);
    w.rotation.y = Math.PI / 2;
    w.userData.tire = tire;
    return w;
  }
  const wheelF = wheel(); wheelF.position.set(0, 0.36, 0.72);
  const wheelR = wheel(); wheelR.position.set(0, 0.36, -0.68);
  model.add(wheelF, wheelR);

  // ---- 차체 ----
  // 연료탱크 (전기: 더미 커버)
  const tank = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 14), matBody);
  tank.scale.set(0.125, 0.1, 0.19);
  tank.position.set(0, 0.8, 0.18);
  tank.rotation.x = -0.12;
  model.add(tank);

  // 라디에이터 슈라우드 (라운드 익스트루드)
  function shroudGeom() {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.02);
    sh.quadraticCurveTo(0.3, 0.16, 0.44, 0.02);
    sh.quadraticCurveTo(0.34, -0.2, 0.1, -0.24);
    sh.quadraticCurveTo(-0.05, -0.12, 0, 0.02);
    return new THREE.ExtrudeGeometry(sh, { depth: 0.028, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 10 });
  }
  for (const side of [-1, 1]) {
    const s = new THREE.Mesh(shroudGeom(), matAccent);
    s.position.set(side * 0.135, 0.78, 0.4);
    s.rotation.y = Math.PI / 2 + side * 0.22;
    s.rotation.z = -0.1;
    model.add(s);
  }

  // 시트 (라운드 캡슐)
  const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.36, 6, 14), matRubber);
  seat.rotation.x = Math.PI / 2 - 0.08;
  seat.scale.set(1, 1, 0.6);
  seat.position.set(0, 0.84, -0.26);
  model.add(seat);
  // 테일
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.028, 0.24, 14), matBody);
  tail.rotation.x = Math.PI / 2 + 0.38;
  tail.position.set(0, 0.87, -0.54);
  model.add(tail);

  // 파워트레인
  if (spec.id === 'emoto') {
    const battery = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.46, 2, 3, 4), matDark);
    battery.position.set(0, 0.54, 0.04);
    model.add(battery);
    const cell = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 4, 10),
      new THREE.MeshStandardMaterial({ color: spec.accent, emissive: spec.accent, emissiveIntensity: 0.55, roughness: 0.4 }));
    cell.rotation.x = Math.PI / 2;
    cell.position.set(0, 0.45, 0.02);
    model.add(cell);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.16, 18), matMetal);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(0, 0.42, -0.18);
    model.add(motor);
  } else {
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.24, 0.34, 2, 2, 3), matDark);
    engine.position.set(0, 0.5, 0.02);
    model.add(engine);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.2, 14), matMetal);
    head.rotation.x = -0.35;
    head.position.set(0, 0.66, 0.1);
    model.add(head);
    const clutch = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 20), matMetal);
    clutch.rotation.z = Math.PI / 2;
    clutch.position.set(0.13, 0.48, -0.02);
    model.add(clutch);
    if (spec.id === 'st250') {
      // 2행정 익스팬션 챔버 (라테)
      const pts = [];
      const prof = [[0.02, 0], [0.045, 0.08], [0.09, 0.28], [0.1, 0.44], [0.065, 0.6], [0.028, 0.78], [0.028, 0.9]];
      for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
      const pipe = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), matChrome);
      pipe.rotation.x = Math.PI / 2 - 0.18;
      pipe.position.set(0.13, 0.66, 0.32);
      model.add(pipe);
    } else {
      const muffler = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.4, 6, 14), matMetal);
      muffler.rotation.x = Math.PI / 2 - 0.28;
      muffler.position.set(0.13, 0.7, -0.42);
      model.add(muffler);
      const header = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.024, 8, 16, Math.PI * 0.8), matChrome);
      header.position.set(0.1, 0.6, 0.28);
      header.rotation.y = Math.PI / 2;
      model.add(header);
    }
  }

  // 스윙암
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.5, 1, 1, 3), matMetal);
    arm.position.set(side * 0.08, 0.4, -0.42);
    arm.rotation.x = 0.1;
    model.add(arm);
  }

  // 프론트 포크 (골드 슬라이더) + 트리플클램프
  for (const side of [-1, 1]) {
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.4, 12), matMetal);
    upper.position.set(side * 0.09, 0.9, 0.56);
    upper.rotation.x = 0.42;
    model.add(upper);
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.42, 12), matGold);
    lower.position.set(side * 0.09, 0.52, 0.73);
    lower.rotation.x = 0.42;
    model.add(lower);
  }
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.1, 2, 1, 1), matDark);
  clamp.position.set(0, 1.02, 0.5);
  clamp.rotation.x = 0.42;
  model.add(clamp);

  // 프론트 펜더 (라운드 셸, 트리플클램프 아래)
  const fender = new THREE.Mesh(new THREE.SphereGeometry(0.34, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), matAccent);
  fender.scale.set(0.4, 0.24, 1.0);
  fender.position.set(0, 0.88, 0.6);
  fender.rotation.x = 0.5;
  model.add(fender);

  // 메인 프레임 스파 (스티어링 헤드 → 스윙암 피벗) + 서브프레임
  for (const side of [-1, 1]) {
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 10), matMetal);
    spar.position.set(side * 0.05, 0.72, 0.18);
    spar.rotation.x = 0.65;
    model.add(spar);
    const sub = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.42, 8), matMetal);
    sub.position.set(side * 0.05, 0.68, -0.42);
    sub.rotation.x = -1.05;
    model.add(sub);
  }

  // 핸들바 (튜브) + 그립
  const barCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.3, 1.05, 0.4),
    new THREE.Vector3(-0.16, 1.09, 0.44),
    new THREE.Vector3(0, 1.07, 0.45),
    new THREE.Vector3(0.16, 1.09, 0.44),
    new THREE.Vector3(0.3, 1.05, 0.4),
  ]);
  const bars = new THREE.Mesh(new THREE.TubeGeometry(barCurve, 16, 0.018, 8, false), matDark);
  model.add(bars);
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.09, 4, 10), matRubber);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.3, 1.05, 0.4);
    model.add(grip);
  }

  // 프론트 넘버 플레이트
  function plateGeom() {
    const sh = new THREE.Shape();
    sh.moveTo(-0.11, 0.12);
    sh.quadraticCurveTo(0, 0.16, 0.11, 0.12);
    sh.quadraticCurveTo(0.13, -0.08, 0, -0.14);
    sh.quadraticCurveTo(-0.13, -0.08, -0.11, 0.12);
    return new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 2, curveSegments: 8 });
  }
  const plate = new THREE.Mesh(plateGeom(), matAccent);
  plate.position.set(0, 1.0, 0.52);
  plate.rotation.x = 0.42;
  model.add(plate);

  // 풋페그
  for (const side of [-1, 1]) {
    const peg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.024, 0.07, 2, 1, 1), matMetal);
    peg.position.set(side * 0.17, 0.42, -0.05);
    model.add(peg);
  }

  // ---- 리깅 라이더 (하이폴리 캡슐 사지) ----
  const rider = new THREE.Group();
  const pelvis = new THREE.Group();
  pelvis.position.set(0, 1.02, -0.18);
  rider.add(pelvis);
  const joints = { pelvis };

  const hipsMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), matPants);
  hipsMesh.scale.set(0.14, 0.1, 0.12);
  hipsMesh.position.set(0, 0.02, 0);
  pelvis.add(hipsMesh);

  const spine = new THREE.Group();
  spine.position.set(0, 0.1, 0.02);
  pelvis.add(spine);
  joints.spine = spine;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.3, 6, 16), matJersey);
  torso.scale.set(1.15, 1, 0.7);
  torso.position.set(0, 0.24, 0);
  spine.add(torso);
  const pack = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), matPack);
  pack.scale.set(0.13, 0.17, 0.065);
  pack.position.set(0, 0.25, -0.15);
  spine.add(pack);

  const head = new THREE.Group();
  head.position.set(0, 0.55, 0.03);
  spine.add(head);
  joints.head = head;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), matJersey);
  neck.position.set(0, -0.04, 0.01);
  head.add(neck);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), matHelmet);
  helmet.position.set(0, 0.06, 0.02);
  head.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 8, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.38, Math.PI * 0.24),
    new THREE.MeshStandardMaterial({ color: 0x1d2b33, roughness: 0.1, metalness: 0.4, envMapIntensity: 1.4 }));
  visor.position.set(0, 0.065, 0.025);
  head.add(visor);
  const peak = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 6, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.22, Math.PI * 0.14), matJersey);
  peak.position.set(0, 0.075, 0.02);
  peak.rotation.x = -0.15;
  head.add(peak);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.018, 8, 22), matGlove);
  strap.position.set(0, 0.07, 0.02);
  strap.rotation.x = 0.35;
  head.add(strap);

  // 팔: 어깨 → 팔꿈치 → 손
  for (const side of [-1, 1]) {
    const sfx = side < 0 ? 'L' : 'R';
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, 0.4, 0.03);
    spine.add(shoulder);
    joints['upper' + sfx] = shoulder;
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.2, 5, 12), matJersey);
    upperArm.position.set(0, -0.14, 0);
    shoulder.add(upperArm);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.3, 0);
    shoulder.add(elbow);
    joints['elbow' + sfx] = elbow;
    const foreArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.17, 5, 12), matPants);
    foreArm.position.set(0, -0.12, 0);
    elbow.add(foreArm);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), matGlove);
    glove.position.set(0, -0.28, 0);
    elbow.add(glove);
  }

  // 다리: 고관절 → 무릎 → 부츠
  for (const side of [-1, 1]) {
    const sfx = side < 0 ? 'L' : 'R';
    const hip = new THREE.Group();
    hip.position.set(side * 0.14, -0.02, 0);
    pelvis.add(hip);
    joints['hip' + sfx] = hip;
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.22, 5, 12), matPants);
    thigh.position.set(0, -0.16, 0);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.set(0, -0.33, 0);
    hip.add(knee);
    joints['knee' + sfx] = knee;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, 0.2, 5, 12), matPants);
    shin.position.set(0, -0.15, 0);
    knee.add(shin);
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 5, 12), matGlove);
    boot.rotation.x = Math.PI / 2 - 0.1;
    boot.position.set(0, -0.33, 0.06);
    knee.add(boot);
  }

  model.add(rider);

  // 그림자: 실루엣 파트만
  for (const part of [tank, seat, torso, pack, helmet, hipsMesh, fender]) part.castShadow = true;
  wheelF.userData.tire.castShadow = true;
  wheelR.userData.tire.castShadow = true;

  // ---- 포즈 블렌딩 ----
  const current = {};
  for (const k of Object.keys(joints)) current[k] = new THREE.Euler();
  const curPelvisPos = new THREE.Vector3();
  const basePelvisPos = pelvis.position.clone();

  function applyPose(name, dt, speed) {
    const pose = POSES[name] || POSES.sit;
    const a = 1 - Math.exp(-(speed || 8) * dt);
    for (const k of Object.keys(joints)) {
      const target = pose[k] || [0, 0, 0];
      const e = current[k];
      e.x += (target[0] - e.x) * a;
      e.y += (target[1] - e.y) * a;
      e.z += (target[2] - e.z) * a;
      joints[k].rotation.set(e.x, e.y, e.z);
    }
    const pp = pose.pelvisPos || [0, 0, 0];
    curPelvisPos.x += (pp[0] - curPelvisPos.x) * a;
    curPelvisPos.y += (pp[1] - curPelvisPos.y) * a;
    curPelvisPos.z += (pp[2] - curPelvisPos.z) * a;
    pelvis.position.set(
      basePelvisPos.x + curPelvisPos.x,
      basePelvisPos.y + curPelvisPos.y,
      basePelvisPos.z + curPelvisPos.z
    );
  }

  function dispose() {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }

  return {
    spec, group, tilt, wheeliePivot, model, rider, joints, wheelF, wheelR,
    applyPose, dispose,
    setWheelSpin(delta) {
      wheelF.rotation.x += delta;
      wheelR.rotation.x += delta;
    },
  };
}
