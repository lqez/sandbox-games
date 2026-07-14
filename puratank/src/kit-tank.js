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
export const KIT_INFO = {
  ft: {
    label: '르노 FT',
    stats: { mp: 9, fireRange: 8, damage: 34, hullLv: 1, driverLv: 3 },
  },
  mk4: {
    label: 'Mark IV',
    stats: { mp: 6, fireRange: 8, damage: 40, hullLv: 3, driverLv: 1 },
  },
  t34: {
    label: 'T-34',
    stats: { mp: 8, fireRange: 9, damage: 45, hullLv: 2, driverLv: 2 },
  },
  tiger: {
    label: '티거 I',
    stats: { mp: 6, fireRange: 10, damage: 60, hullLv: 3, driverLv: 1 },
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
    gun: ['6파운더'],
    turretPivot: null, // 무포탑 — 스폰슨 고정포
    gunPivot: [0, 2.9, 1.6],
    muzzle: [3.4, 0, 2.0],
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

const SCALE = 0.22; // 킷(차체 ~8유닛) → 게임(차체 ~1.8유닛)

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

  for (const part of def.parts) {
    const holder = new THREE.Group();
    holder.add(part.mesh);
    holder.position.set(...part.assembled.pos);
    holder.quaternion.setFromEuler(new THREE.Euler(...part.assembled.rot));
    if (spec.gun.some((k) => part.name.includes(k))) {
      holder.position.sub(cannonInTank);
      cannon.add(holder);
    } else if (spec.turret.some((k) => part.name.includes(k))) {
      holder.position.sub(turretInTank);
      turret.add(holder);
    } else {
      hull.add(holder);
    }
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(...spec.muzzle);
  cannon.add(muzzle);

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
  return { group: outer, turret, cannon, muzzle, hitbox, hasTurret: !!spec.turretPivot };
}
