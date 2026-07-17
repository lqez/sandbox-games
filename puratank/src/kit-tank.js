// kit-tank.js — 차고에서 조립하는 SD 프라모델 킷을 게임 유닛 모델로 변환하는 어댑터.
// 게임(main.js)의 buildTank()와 같은 인터페이스를 반환한다:
//   { group, turret, cannon, muzzle, hitbox }
// - group: 게임 스케일(1칸=2유닛)에 맞춰 축소된 전체 모델 (바깥 그룹은 무배율)
// - turret: 요 회전용 그룹, cannon: 부앙각(rotation.x)/반동(position.z)용 그룹
// - muzzle: 포구 위치 참조용 Object3D, hitbox: 클릭/피격 판정용 실린더
import * as THREE from 'three';
import { buildRenaultFT } from './tanks/renault-ft.js';
import { buildMark4 } from './tanks/mark4.js';
import { buildT34 } from './tanks/t34.js';
import { buildTiger1 } from './tanks/tiger1.js';

const BUILDERS = { ft: buildRenaultFT, mk4: buildMark4, t34: buildT34, tiger: buildTiger1 };
export const KIT_KEYS = ['ft', 'mk4', 't34', 'tiger'];

// 기체별 게임 스탯 — 성능 차별화 (기동/사거리/화력/장갑)
// gun: 포신 부앙각(도)과 고정포 여부 — 기체마다 사격 전략이 달라진다.
//  - ft: 소구경 포탑포, 부앙각 유연 (근접 요철 지형에 강함)
//  - mk4: 좌/우 스폰슨 부포 — 차체 측면(±90°) 중심 ±arc° 사각만 조준 가능.
//    정면/후방은 사각 밖이라 이동으로 차체를 돌려 측면을 내줘야 함.
//  - t34: 실차처럼 포 내림각이 나쁨 — 언덕 위에서 가까운 아래를 못 쏨.
//  - tiger: 평탄 탄도 장거리형, 중간 부앙각.
export const KIT_INFO = {
  ft: {
    label: '르노 FT',
    stats: { mp: 12, fireRange: 16, damage: 34, hullLv: 1, driverLv: 3 },
    gun: { pitchMin: -18, pitchMax: 30, fixed: false, reload: 1 },
  },
  mk4: {
    label: 'Mark IV',
    stats: { mp: 8, fireRange: 16, damage: 40, hullLv: 3, driverLv: 1 },
    gun: { pitchMin: -12, pitchMax: 8, fixed: true, sponson: true, arc: 55, reload: 2 }, // 좌우 스폰슨 부포: 측면 ±90°±55° 사각
  },
  t34: {
    label: 'T-34',
    stats: { mp: 11, fireRange: 18, damage: 45, hullLv: 2, driverLv: 2 },
    gun: { pitchMin: -5, pitchMax: 25, fixed: false, reload: 2 },
  },
  tiger: {
    label: '티거 I',
    stats: { mp: 8, fireRange: 20, damage: 60, hullLv: 3, driverLv: 1 },
    gun: { pitchMin: -8, pitchMax: 15, fixed: false, reload: 3 },
  },
};

// 파츠 이름 매칭으로 포탑/포신 서브그룹 구성 (킷 좌표계 기준 피벗)
const SPECS = {
  ft: {
    turret: ['포탑', '버섯 벤트 캡'],
    gun: ['주포'],
    turretPivot: [0, 3.65, -0.5],
    gunPivot: [0, 1.1, 2.0],
    muzzle: [0, 0, 2.1],
  },
  mk4: {
    turret: [],
    gun: [], // 주포는 좌/우 스폰슨으로 따로 조립 (아래 sponsons)
    turretPivot: null, // 무포탑 — 좌우 스폰슨 고정포
    gunPivot: [0, 2.9, 1.6],
    muzzle: [0, 0, 0],
    // 좌/우 스폰슨 부포: 각자 자기 마운트에서 독립 선회(요), 자기 포구로 발사.
    // rest = 미조준 시 향하는 방향(측면 ±90°). match로 킷 파츠를 배정.
    sponsons: [
      { key: 'L', match: ['좌 6파운더'], pivot: [-3.4, 2.9, 1.6], muzzle: [0, 0, 1.7], rest: -Math.PI / 2 },
      { key: 'R', match: ['우 6파운더'], pivot: [3.4, 2.9, 1.6], muzzle: [0, 0, 1.7], rest: Math.PI / 2 },
    ],
  },
  t34: {
    turret: ['포탑', '큐폴라', '장전수 해치'],
    gun: ['주포'],
    turretPivot: [0, 4.5, 0.45],
    gunPivot: [0, 0.9, 2.0],
    muzzle: [0, 0, 4.5],
  },
  tiger: {
    turret: ['포탑', '큐폴라'],
    gun: ['주포', '방순'],
    turretPivot: [0, 4.7, 0.1],
    gunPivot: [0, 1.15, 2.5],
    muzzle: [0, 0, 6.3],
  },
};

const SCALE = 0.22; // 킷(차체 ~8유닛) → 게임(차체 ~1.8유닛 ≈ 2×2타일, 1타일=1유닛)

// 서브그룹(차체/포탑/포) 안의 정적 메시들을 재질별로 병합 — 킷 하나가
// 수백 드로콜(볼트·리벳·트랙 링크가 전부 개별 메시)에서 재질 수만큼으로 준다.
// exclude에 속한 하위 트리(포탑 속 포 등)는 건드리지 않는다.
function relMatrix(obj, root) {
  const m = new THREE.Matrix4();
  const chain = [];
  let cur = obj;
  while (cur && cur !== root) { chain.push(cur); cur = cur.parent; }
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].updateMatrix();
    m.multiply(chain[i].matrix);
  }
  return m;
}
export function mergeStatic(root, exclude = []) {
  const excludeSet = new Set(exclude);
  const buckets = new Map(); // material -> geometry[]
  const removals = [];
  (function walk(o) {
    if (excludeSet.has(o)) return;
    for (const c of o.children) walk(c);
    if (o.isMesh && o.material && o.material.visible !== false) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(relMatrix(o, root));
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(g);
      removals.push(o);
    }
  })(root);
  for (const o of removals) o.parent?.remove(o);
  for (const [mat, geos] of buckets) {
    let total = 0;
    for (const g of geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    let off = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, off * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
      off += g.attributes.position.count;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    root.add(mesh);
  }
}

export function buildKitTank(key) {
  const def = BUILDERS[key]();
  const spec = SPECS[key];
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(SCALE);
  outer.add(inner);

  const hull = new THREE.Group();
  inner.add(hull);
  const tp = spec.turretPivot || [0, 0, 0];
  const turret = new THREE.Group();
  turret.position.set(...tp);
  hull.add(turret);
  const cannon = new THREE.Group();
  cannon.position.set(...spec.gunPivot);
  turret.add(cannon);
  const cannonInTank = new THREE.Vector3(
    tp[0] + spec.gunPivot[0], tp[1] + spec.gunPivot[1], tp[2] + spec.gunPivot[2]
  );
  const turretInTank = new THREE.Vector3(...tp);

  // 스폰슨 부포(Mark IV): 좌/우 각자 자기 마운트에서 선회하는 독립 포 그룹.
  // 각 그룹은 hull 직속(차체 고정), 자기 요각(rotation.y)으로 조준한다.
  const sponsons = (spec.sponsons || []).map((sp) => {
    const grp = new THREE.Group();
    grp.position.set(...sp.pivot);
    grp.rotation.y = sp.rest;      // 미조준 시 측면(±90°)을 향한다
    grp.userData.rest = sp.rest;
    hull.add(grp);
    const mz = new THREE.Object3D();
    mz.position.set(...sp.muzzle);
    grp.add(mz);
    return { key: sp.key, group: grp, muzzle: mz, pivot: sp.pivot, match: sp.match };
  });
  const sponsonPivot = new Map(); // holder를 배정할 스폰슨 찾기용

  for (const part of def.parts) {
    const holder = new THREE.Group();
    holder.add(part.mesh);
    holder.position.set(...part.assembled.pos);
    holder.quaternion.setFromEuler(new THREE.Euler(...part.assembled.rot));
    const sp = sponsons.find((s) => s.match.some((k) => part.name.includes(k)));
    if (sp) {
      // 스폰슨포: 자기 마운트 기준으로 옮기고, 배럴이 +z(정면)을 향하도록
      // 스플레이(요) 성분을 제거 — rest 회전이 측면 지향을 담당한다.
      holder.position.set(
        part.assembled.pos[0] - sp.pivot[0],
        part.assembled.pos[1] - sp.pivot[1],
        part.assembled.pos[2] - sp.pivot[2]
      );
      holder.quaternion.identity();
      sp.group.add(holder);
    } else if (spec.gun.some((k) => part.name.includes(k))) {
      holder.position.sub(cannonInTank);
      cannon.add(holder);
    } else if (spec.turret.some((k) => part.name.includes(k))) {
      holder.position.sub(turretInTank);
      turret.add(holder);
    } else {
      // 트랙 피스(렝스/링크)는 링크별 처리를 위해 태깅 — 처짐 베이크와
      // 격파 시 낱개 분해의 대상이 된다 ('트랙 프레임' 같은 구조물은 제외)
      if (part.name.includes('렝스') || part.name.includes('링크')) {
        holder.userData.trackName = part.name;
      }
      hull.add(holder);
    }
  }

  // ── 궤도 링크별 처리 ──
  // 1) 처짐(sag): 실차처럼 궤도에 유격이 있어 상부 런이 아래로 살짝 늘어진다.
  //    조립 시 상부 링크들을 현수선 가중치로 내리고 미세하게 들썩여 베이크
  //    — 개체마다 처짐량이 달라 런타임 비용 없이 유격감이 생긴다.
  // 2) 좌/우 트랙 밴드 분리: 차체 병합에 섞지 않고 밴드별로 병합해
  //    격파 시 밴드를 숨기고 실제 킷 링크들이 낱개로 흩어질 수 있게 한다.
  const trackHolders = hull.children.filter((h) => h.userData.trackName);
  const sagAmp = 0.18 + Math.random() * 0.16; // 킷 유닛 — 개체별 유격 변주
  for (const side of [-1, 1]) {
    const run = trackHolders.filter((h) => (h.position.x < 0 ? -1 : 1) === side);
    if (!run.length) continue;
    let yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const h of run) {
      yMin = Math.min(yMin, h.position.y); yMax = Math.max(yMax, h.position.y);
      zMin = Math.min(zMin, h.position.z); zMax = Math.max(zMax, h.position.z);
    }
    const yMid = (yMin + yMax) / 2;
    for (const h of run) {
      if (h.position.y <= yMid + 0.05) continue; // 지면에 닿는 하부 런은 그대로
      const t = Math.min(1, Math.max(0, (h.position.z - zMin) / Math.max(0.001, zMax - zMin)));
      const w = Math.sin(Math.PI * t); // 바퀴 사이 중앙이 가장 처진다
      h.position.y -= sagAmp * w;
      h.rotateX((Math.random() - 0.5) * 0.12 * w); // 낱장이 살짝 들썩인 유격
    }
  }
  const trackL = new THREE.Group();
  const trackR = new THREE.Group();
  hull.add(trackL, trackR);
  for (const h of trackHolders) (h.position.x < 0 ? trackL : trackR).add(h);
  // 분해용 레지스트리: 피스별 서브메시(슈·페그·스터드)와 탱크 로컬 행렬을
  // 병합 전에 기록 — 격파 시 이 정보로 실제 링크를 다시 세워 흩뿌린다
  const trackPieces = trackHolders.map((h) => {
    const meshes = [];
    h.traverse((m) => {
      if (m.isMesh && m.material?.visible !== false) {
        meshes.push({ geo: m.geometry, mat: m.material, rel: relMatrix(m, h) });
      }
    });
    return { meshes, m: relMatrix(h, outer), name: h.userData.trackName };
  });

  const muzzle = new THREE.Object3D();
  muzzle.position.set(...spec.muzzle);
  cannon.add(muzzle);

  // 드로콜 절감: 회전 단위(차체/포탑/포)별로 정적 메시 병합.
  // 트랙 밴드는 좌/우 각각 병합(+2 드로) — 격파 분해 시 통째로 끌 수 있다.
  // 스폰슨포는 각 포가 독립 선회하므로 개별 병합하고 hull에서 제외.
  mergeStatic(trackL);
  mergeStatic(trackR);
  if (sponsons.length) {
    for (const s of sponsons) mergeStatic(s.group);
    mergeStatic(hull, [turret, trackL, trackR, ...sponsons.map((s) => s.group)]);
  } else {
    mergeStatic(cannon);
    mergeStatic(turret, [cannon]);
    mergeStatic(hull, [turret, trackL, trackR]);
  }

  const hitbox = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 2.6, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitbox.position.y = 1.3;
  outer.add(hitbox);

  outer.traverse((o) => {
    if (o.isMesh && o !== hitbox) o.castShadow = true;
  });
  // hasTurret: 포탑 요 회전으로 조준 가능한 기체 (Mark IV는 차체 고정 스폰슨포)
  // sponsonTwin: 좌/우 독립 부포 — main.js가 목표 쪽 포를 골라 조준/발사한다.
  const twin = sponsons.length
    ? { sponsonTwin: true, sponsons, cannon: sponsons[0].group, muzzle: sponsons[0].muzzle }
    : { sponsonTwin: false };
  return {
    group: outer, turret, cannon, muzzle, hitbox, hasTurret: !!spec.turretPivot,
    trackPieces, trackBands: [trackL, trackR], ...twin,
  };
}
