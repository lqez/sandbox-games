// bike.js — 스턴트 바이크 3종 + 관절 리깅 라이더
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
    upperL: [0.9, 0, -0.25], upperR: [0.9, 0, 0.25],
    elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0],
    hipL: [-0.95, 0, -0.06], hipR: [-0.95, 0, 0.06],
    kneeL: [1.25, 0, 0], kneeR: [1.25, 0, 0],
    pelvis: [0, 0, 0], pelvisPos: [0, 0, 0],
  },
  crouch: {
    spine: [0.85, 0, 0], head: [-0.5, 0, 0],
    upperL: [1.15, 0, -0.3], upperR: [1.15, 0, 0.3],
    elbowL: [-0.8, 0, 0], elbowR: [-0.8, 0, 0],
    hipL: [-1.2, 0, -0.06], hipR: [-1.2, 0, 0.06],
    kneeL: [1.5, 0, 0], kneeR: [1.5, 0, 0],
    pelvis: [0, 0, 0], pelvisPos: [0, -0.07, -0.04],
  },
  air: {
    spine: [0.32, 0, 0], head: [-0.15, 0, 0],
    upperL: [0.7, 0, -0.45], upperR: [0.7, 0, 0.45],
    elbowL: [-0.35, 0, 0], elbowR: [-0.35, 0, 0],
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
    // 다리 가위차기 (앞뒤 교차)
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
    upperL: [0.35, 0, -0.3], upperR: [0.35, 0, 0.3],
    elbowL: [-0.05, 0, 0], elbowR: [-0.05, 0, 0],
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

  const matBlack = new THREE.MeshLambertMaterial({ color: 0x1c1c20 });
  const matDark = new THREE.MeshLambertMaterial({ color: 0x33343a });
  const matBody = new THREE.MeshLambertMaterial({ color: spec.body });
  const matAccent = new THREE.MeshLambertMaterial({ color: spec.accent });
  const matRim = new THREE.MeshLambertMaterial({ color: spec.rim });
  const matWhite = new THREE.MeshLambertMaterial({ color: 0xf2f4f2 });
  const matTealGear = new THREE.MeshLambertMaterial({ color: 0x39b8c9 });
  const matPack = new THREE.MeshLambertMaterial({ color: 0x7fd0e8 });

  function wheel() {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.085, 8, 16), matBlack));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.09, 8), matRim);
    hub.rotation.x = Math.PI / 2;
    w.add(hub);
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.56, 0.03), matRim);
      sp.rotation.z = (k / 3) * Math.PI;
      w.add(sp);
    }
    w.rotation.y = Math.PI / 2;
    return w;
  }
  const wheelF = wheel(); wheelF.position.set(0, 0.36, 0.72);
  const wheelR = wheel(); wheelR.position.set(0, 0.36, -0.68);
  model.add(wheelF, wheelR);

  // ---- 차체 ----
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.5), matBody);
  tank.position.set(0, 0.8, 0.14); tank.rotation.x = -0.15;
  model.add(tank);
  const shroudL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.4), matAccent);
  shroudL.position.set(-0.15, 0.72, 0.2); shroudL.rotation.x = -0.2;
  model.add(shroudL);
  const shroudR = shroudL.clone(); shroudR.position.x = 0.15;
  model.add(shroudR);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.58), matBlack);
  seat.position.set(0, 0.84, -0.3);
  model.add(seat);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.3), matBody);
  tail.position.set(0, 0.87, -0.62); tail.rotation.x = 0.22;
  model.add(tail);

  if (spec.id === 'emoto') {
    const battery = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.5), matDark);
    battery.position.set(0, 0.52, 0.02);
    model.add(battery);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.34), new THREE.MeshLambertMaterial({ color: spec.accent }));
    cell.position.set(0, 0.44, 0.02);
    model.add(cell);
  } else {
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.4), matDark);
    engine.position.set(0, 0.52, 0.0);
    model.add(engine);
    if (spec.id === 'st250') {
      // 2행정 챔버 파이프
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.66, 7), matRim);
      pipe.position.set(0.14, 0.6, -0.1); pipe.rotation.x = Math.PI / 2 - 0.25;
      model.add(pipe);
    } else {
      const muffler = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 7), matRim);
      muffler.position.set(0.13, 0.68, -0.45); muffler.rotation.x = Math.PI / 2 - 0.3;
      model.add(muffler);
    }
  }

  for (const side of [-1, 1]) {
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.72, 6), matRim);
    fork.position.set(side * 0.09, 0.66, 0.66); fork.rotation.x = 0.42;
    model.add(fork);
    const peg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.1), matDark);
    peg.position.set(side * 0.16, 0.42, -0.05);
    model.add(peg);
  }
  const fender = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.6), matAccent);
  fender.position.set(0, 0.95, 0.6); fender.rotation.x = 0.5;
  model.add(fender);
  const bars = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.05, 0.05), matDark);
  bars.position.set(0, 1.06, 0.44);
  model.add(bars);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.04), matAccent);
  plate.position.set(0, 0.98, 0.52); plate.rotation.x = 0.42;
  model.add(plate);

  // ---- 리깅 라이더 ----
  // pelvis 루트: 시트 위
  const rider = new THREE.Group();          // 크래시 시 통째로 날림
  const pelvis = new THREE.Group();
  pelvis.position.set(0, 1.02, -0.18);
  rider.add(pelvis);

  const joints = { pelvis };

  const hipsMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.26), matWhite);
  hipsMesh.position.set(0, 0.02, 0);
  pelvis.add(hipsMesh);

  const spine = new THREE.Group();
  spine.position.set(0, 0.1, 0.02);
  pelvis.add(spine);
  joints.spine = spine;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.22), matTealGear);
  torso.position.set(0, 0.24, 0);
  spine.add(torso);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.13), matPack);
  pack.position.set(0, 0.24, -0.17);
  spine.add(pack);

  const head = new THREE.Group();
  head.position.set(0, 0.47, 0.02);
  spine.add(head);
  joints.head = head;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), matWhite);
  helmet.position.set(0, 0.06, 0.02);
  head.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.14), matTealGear);
  visor.position.set(0, 0.1, 0.14);
  head.add(visor);

  // 팔: 어깨 → 팔꿈치 → 손(바 근처)
  for (const side of [-1, 1]) {
    const sfx = side < 0 ? 'L' : 'R';
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, 0.4, 0.03);
    spine.add(shoulder);
    joints['upper' + sfx] = shoulder;
    const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.09), matTealGear);
    upperArm.position.set(0, -0.14, 0);
    shoulder.add(upperArm);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.3, 0);
    shoulder.add(elbow);
    joints['elbow' + sfx] = elbow;
    const foreArm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.08), matWhite);
    foreArm.position.set(0, -0.12, 0);
    elbow.add(foreArm);
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), matDark);
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
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.15), matWhite);
    thigh.position.set(0, -0.16, 0);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.set(0, -0.33, 0);
    hip.add(knee);
    joints['knee' + sfx] = knee;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.32, 0.12), matWhite);
    shin.position.set(0, -0.15, 0);
    knee.add(shin);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.26), matDark);
    boot.position.set(0, -0.33, 0.05);
    knee.add(boot);
  }

  model.add(rider);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

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
