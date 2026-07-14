// runner.js — 사출 런너(스프루) 생성기
// 파츠들을 선반(shelf) 방식으로 자동 배치하고, 프레임 레일 + 게이트를 만든다.
// 런너는 XY 평면(정면이 +Z)에 세워진 상태를 기준으로 생성된다.
import * as THREE from 'three';

const RAIL_R = 0.3; // 런너 레일 굵기
const GATE_R = 0.13; // 게이트 굵기
const PAD = 1.05; // 파츠 간 여백

function rail(from, to, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(RAIL_R, RAIL_R, len, 10);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.castShadow = true;
  return mesh;
}

function gate(from, to, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = Math.max(0.05, a.distanceTo(b));
  const geo = new THREE.CylinderGeometry(GATE_R, GATE_R * 1.4, len, 8);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

// 파츠의 lieRot 적용 후 XY 풋프린트(폭/높이)와 Z 두께를 잰다.
function measure(part) {
  const probe = new THREE.Group();
  const clone = part.mesh.clone(true);
  clone.rotation.set(...part.lieRot);
  probe.add(clone);
  const box = new THREE.Box3().setFromObject(probe);
  return {
    w: box.max.x - box.min.x,
    h: box.max.y - box.min.y,
    d: box.max.z - box.min.z,
    // 파츠 원점이 bbox 중심에서 얼마나 어긋나 있는지 (배치 보정용)
    cx: (box.max.x + box.min.x) / 2,
    cy: (box.max.y + box.min.y) / 2,
  };
}

// parts를 런너 폭(runnerW)에 맞춰 행 단위로 배치.
// 반환: { group(런너 프레임+게이트), slots: Map(id → {pos:Vector3, rot:Euler}), w, h }
export function buildRunner(parts, mat, opts = {}) {
  const runnerW = opts.width ?? 19;
  const group = new THREE.Group();
  const slots = new Map();

  // --- 선반 배치
  const rows = [];
  let row = { items: [], w: 0, h: 0 };
  for (const part of parts) {
    const m = measure(part);
    const need = m.w + PAD * 2;
    if (row.items.length && row.w + need > runnerW) {
      rows.push(row);
      row = { items: [], w: 0, h: 0 };
    }
    row.items.push({ part, m });
    row.w += need;
    row.h = Math.max(row.h, m.h);
  }
  if (row.items.length) rows.push(row);

  const totalH = rows.reduce((s, r) => s + r.h + PAD * 2, 0);
  const w = runnerW, h = totalH;

  // --- 파츠 슬롯 + 게이트
  let y = h / 2; // 위에서부터 아래로
  for (const r of rows) {
    const rowTop = y;
    const rowBottom = y - (r.h + PAD * 2);
    const cy = (rowTop + rowBottom) / 2;
    // 행 내에서 균등 분배
    const slack = (runnerW - r.w) / (r.items.length + 1);
    let x = -w / 2;
    for (const { part, m } of r.items) {
      x += slack + PAD + m.w / 2;
      const px = x - m.cx, py = cy - m.cy; // 파츠 원점 위치(중심 보정)
      slots.set(part.id, {
        pos: new THREE.Vector3(px, py, 0),
        rot: new THREE.Euler(...part.lieRot),
      });
      // 게이트: 파츠 상/하단 → 행 레일
      const gx = x;
      group.add(gate([gx, cy + m.h / 2 - 0.05, 0], [gx, rowTop, 0], mat));
      group.add(gate([gx, cy - m.h / 2 + 0.05, 0], [gx, rowBottom, 0], mat));
      x += m.w / 2 + PAD;
    }
    y = rowBottom;
  }

  // --- 프레임 레일
  const hw = w / 2, hh = h / 2;
  group.add(rail([-hw, -hh, 0], [-hw, hh, 0], mat));
  group.add(rail([hw, -hh, 0], [hw, hh, 0], mat));
  // 행 경계 레일(맨 위/아래 프레임 포함)
  let yy = hh;
  group.add(rail([-hw, yy, 0], [hw, yy, 0], mat));
  for (const r of rows) {
    yy -= r.h + PAD * 2;
    group.add(rail([-hw, yy, 0], [hw, yy, 0], mat));
  }

  // 모서리 마감(구체)
  for (const sx of [-hw, hw])
    for (const sy of [-hh, hh]) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(RAIL_R, 10, 8), mat);
      c.position.set(sx, sy, 0);
      group.add(c);
    }

  // 런너 태그(각인 명판 느낌): 좌상단 사각 플레이트 + 돌출 바
  const tag = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.24), mat);
  tag.position.set(-hw + 2.4, hh, 0);
  group.add(tag);
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.3), mat);
    bar.position.set(-hw + 1.5 + i * 0.95, hh, 0);
    group.add(bar);
  }

  return { group, slots, w, h };
}
