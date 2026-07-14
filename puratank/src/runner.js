// runner.js — 사출 런너(스프루) 생성기 (실킷 스타일)
// 실제 프라모델 런너를 따른다:
//  - 파츠마다 세로 레일로 구분된 "셀" 구조 (타미야식)
//  - 게이트는 파츠 좌/우 가장자리에서 인접 레일로 짧게
//  - 파츠 옆에 7세그먼트 각인 파츠 번호 태그
//  - 런너 모서리에 런너 기호(A/B) 명판, 중앙 레일에 장식 링
import * as THREE from 'three';

const RAIL_R = 0.28; // 런너 레일 굵기
const GATE_R = 0.12; // 게이트 굵기
const PAD = 0.7; // 파츠-레일 여백

function rail(from, to, mat, r = RAIL_R) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(r, r, len, 10);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.castShadow = true;
  return mesh;
}

function gate(from, to, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = Math.max(0.05, a.distanceTo(b));
  const geo = new THREE.CylinderGeometry(GATE_R, GATE_R * 1.5, len, 8);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

// ---- 7세그먼트 각인 문자 (파츠 번호/런너 기호)
//   A
//  F B
//   G
//  E C
//   D
const SEGS = {
  '0': 'ABCDEF', '1': 'BC', '2': 'ABGED', '3': 'ABGCD', '4': 'FGBC',
  '5': 'AFGCD', '6': 'AFGEDC', '7': 'ABC', '8': 'ABCDEFG', '9': 'ABCDFG',
  A: 'ABCEFG', B: 'CDEFG', C: 'ADEF', D: 'BCDEG',
};
const SEG_GEO = {
  A: [0, 1, 0, true], G: [0, 0, 0, true], D: [0, -1, 0, true],
  F: [-0.5, 0.5, 0, false], B: [0.5, 0.5, 0, false],
  E: [-0.5, -0.5, 0, false], C: [0.5, -0.5, 0, false],
};
function embossChar(ch, size, mat) {
  const g = new THREE.Group();
  const on = SEGS[ch] || '';
  for (const s of on) {
    const [ox, oy, , horiz] = SEG_GEO[s];
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(horiz ? size * 0.72 : size * 0.2, horiz ? size * 0.2 : size * 0.62, 0.09),
      mat
    );
    box.position.set(ox * size * 0.8, oy * size * 0.62, 0);
    g.add(box);
  }
  return g;
}
function numberTag(text, mat) {
  const size = 0.52;
  const w = Math.max(0.9, text.length * size * 0.85 + 0.35);
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 0.16), mat);
  g.add(plate);
  const chars = text.split('');
  chars.forEach((ch, i) => {
    const c = embossChar(ch, size, mat);
    c.position.set((i - (chars.length - 1) / 2) * size * 0.9, 0, 0.11);
    g.add(c);
  });
  g.userData.w = w;
  return g;
}

// 파츠의 lieRot 적용 후 XY 풋프린트와 원점 보정값
function measure(part) {
  const probe = new THREE.Group();
  const clone = part.mesh.clone(true);
  clone.rotation.set(...part.lieRot);
  probe.add(clone);
  const box = new THREE.Box3().setFromObject(probe);
  return {
    w: box.max.x - box.min.x,
    h: box.max.y - box.min.y,
    cx: (box.max.x + box.min.x) / 2,
    cy: (box.max.y + box.min.y) / 2,
  };
}

// parts를 셀 방식으로 배치. label: 런너 기호('A'/'B')
export function buildRunner(parts, mat, opts = {}) {
  const runnerW = opts.width ?? 20;
  const label = opts.label ?? 'A';
  const group = new THREE.Group();
  const slots = new Map();

  // --- 행 구성 (파츠 폭 + 번호 태그 자리)
  const rows = [];
  let row = { items: [], w: 0, h: 0 };
  for (const part of parts) {
    const m = measure(part);
    const need = m.w + PAD * 2 + 1.3; // 1.3 = 세로 레일 + 태그 여유
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
  const hw = w / 2, hh = h / 2;

  // --- 파츠 슬롯 + 셀 레일 + 게이트 + 번호 태그
  let y = hh;
  for (const r of rows) {
    const rowTop = y;
    const rowBottom = y - (r.h + PAD * 2);
    const cy = (rowTop + rowBottom) / 2;
    const slack = Math.max(0, (runnerW - r.w) / r.items.length);
    let x = -hw;
    for (const { part, m } of r.items) {
      const cellW = m.w + PAD * 2 + 1.3 + slack;
      const cellLeft = x, cellRight = x + cellW;
      // 파츠는 셀 오른쪽에, 태그는 왼쪽 레일 옆에
      const px = cellLeft + 1.15 + PAD + m.w / 2;
      slots.set(part.id, {
        pos: new THREE.Vector3(px - m.cx, cy - m.cy, 0),
        rot: new THREE.Euler(...part.lieRot),
      });
      // 셀 오른쪽 세로 레일 (마지막 셀은 프레임이 대신)
      if (cellRight < hw - 0.5) {
        group.add(rail([cellRight, rowTop, 0], [cellRight, rowBottom, 0], mat, RAIL_R * 0.9));
      }
      // 게이트: 파츠 좌/우 가장자리 → 인접 레일 (짧게)
      group.add(gate([px - m.w / 2 - 0.02, cy, 0], [cellLeft + 0.9, cy, 0], mat));
      group.add(gate([px + m.w / 2 + 0.02, cy, 0], [Math.min(cellRight, hw), cy, 0], mat));
      // 세로가 긴 파츠는 상/하단 게이트 추가
      if (m.h > 4) {
        group.add(gate([px, cy + m.h / 2 - 0.02, 0], [px, rowTop, 0], mat));
        group.add(gate([px, cy - m.h / 2 + 0.02, 0], [px, rowBottom, 0], mat));
      }
      // 번호 태그 (셀 왼쪽 레일에 부착)
      const num = part.id.replace(/[^0-9]/g, '');
      if (num) {
        const tag = numberTag(num, mat);
        tag.position.set(cellLeft + 0.62, cy + m.h / 2 - 0.4, 0);
        group.add(tag);
        group.add(gate([cellLeft + 0.62, cy + m.h / 2 - 0.4, 0], [cellLeft, cy + m.h / 2 - 0.4, 0], mat));
      }
      x = cellRight;
    }
    y = rowBottom;
  }

  // --- 프레임 레일
  group.add(rail([-hw, -hh, 0], [-hw, hh, 0], mat));
  group.add(rail([hw, -hh, 0], [hw, hh, 0], mat));
  let yy = hh;
  group.add(rail([-hw, yy, 0], [hw, yy, 0], mat));
  for (const r of rows) {
    yy -= r.h + PAD * 2;
    group.add(rail([-hw, yy, 0], [hw, yy, 0], mat));
  }
  // 모서리 마감
  for (const sx of [-hw, hw])
    for (const sy of [-hh, hh]) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(RAIL_R, 10, 8), mat);
      c.position.set(sx, sy, 0);
      group.add(c);
    }
  // 중앙 장식 링 (타미야식 이젝션 링)
  const midY = hh - (rows[0] ? rows[0].h + PAD * 2 : 0);
  if (rows.length > 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, RAIL_R * 0.85, 8, 24), mat);
    ring.position.set(0, midY, 0);
    group.add(ring);
  }

  // --- 런너 기호 명판 (좌상단)
  const badge = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 0.2), mat);
  badge.add(plate);
  const letter = embossChar(label, 0.85, mat);
  letter.position.z = 0.13;
  badge.add(letter);
  badge.position.set(-hw + 1.6, hh, 0);
  group.add(badge);

  return { group, slots, w, h };
}
