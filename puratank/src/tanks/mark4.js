// Mark IV — WWI 영국 중전차. SD 데포르메: 통통한 마름모 실루엣,
// 좌우 스폰슨 + 스터비 6파운더, 언디칭 레일. 돔 리벳 과장.
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileY, cylX, cylY, cylZ, domeRivet,
  panelLine, panelRect, fastenerRow, grooveRing, beltMesh, beltSolid,
  beltOutlinePoints, centered, definePart,
} from '../plamo.js';

const CIRCLES = [
  { z: -4.1, y: 1.2, r: 1.15 },
  { z: 2.9, y: 1.05, r: 1.0 },
  { z: 4.3, y: 3.15, r: 1.15 },
  { z: -2.8, y: 3.35, r: 1.0 },
];

export function buildMark4() {
  const color = 0xa08d5f; // 카키 브라운 런너
  const M = makeMats(color);
  const parts = [];
  const P = (id, name, mesh, opts) => parts.push(definePart(id, name, mesh, opts));

  // ---- B1 차체 코어
  {
    const g = new THREE.Group();
    g.add(chamferBox(3.6, 3.0, 8.6, 0.2, M.main));
    panelLine(g, [0, 1.51, -4.0], [0, 1.51, 4.0], [0, 1, 0], M.groove);
    fastenerRow(g, [-1.0, 1.51, -3.9], [-1.0, 1.51, 3.9], 9, 0.1, [0, 1, 0], M.main);
    fastenerRow(g, [1.0, 1.51, -3.9], [1.0, 1.51, 3.9], 9, 0.1, [0, 1, 0], M.main);
    P('B1', '차체 코어', g, { pos: [0, 2.6, 0.2], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 1 });
  }

  // ---- B2/B3 마름모 트랙 프레임 (측면 슬래브 + 리벳 아웃라인)
  for (const [id, name, sx, order] of [['B2', '좌 트랙 프레임', -1, 2], ['B3', '우 트랙 프레임', 1, 3]]) {
    const g = new THREE.Group();
    g.add(beltSolid(CIRCLES, 0.6, 1.15, M.main));
    // 윤곽을 따라 도는 과장 리벳 (마름모 테두리)
    for (const p of beltOutlinePoints(CIRCLES, 0.95, 1.15)) {
      const r = domeRivet(0.11, M.main);
      r.position.set(sx * 0.585, p.y, p.x);
      r.rotation.z = sx * -Math.PI / 2;
      g.add(r);
    }
    // 중앙 패널라인 + 피스톨 포트
    panelLine(g, [sx * 0.58, 2.2, -3.4], [sx * 0.58, 2.2, 3.2], [sx, 0, 0], M.groove);
    const port = cylX(0.34, 0.38, 0.14, M.main, 14);
    port.position.set(sx * 0.62, 2.2, -0.6);
    g.add(port);
    const portRing = grooveRing(0.36, 0.05, M.groove);
    portRing.rotation.z = Math.PI / 2;
    portRing.position.set(sx * 0.66, 2.2, -0.6);
    g.add(portRing);
    P(id, name, g, { pos: [sx * 2.45, 0, 0], lieRot: [0, Math.PI / 2, 0], order });
  }

  // ---- B4/B5 트랙 벨트 (차체 전체를 감싸는 마름모 궤도)
  for (const [id, name, sx, order] of [['B4', '좌 트랙', -1, 4], ['B5', '우 트랙', 1, 5]]) {
    const belt = beltMesh(CIRCLES, 1.5, 0.45, M.main, M.groove, { cleatCount: 34 });
    const { mesh, center } = centered(belt);
    P(id, name, mesh, {
      pos: [sx * 2.45 + center.x, center.y, center.z],
      lieRot: [0, Math.PI / 2, 0],
      order,
    });
  }

  // ---- B6/B7 스폰슨 (측면 포탑실)
  for (const [id, name, sx, order] of [['B6', '좌 스폰슨', -1, 6], ['B7', '우 스폰슨', 1, 7]]) {
    const g = new THREE.Group();
    // 상면 프로파일: 차체에서 바깥으로 튀어나온 5각형 (전면 모서리 사선)
    const pts = [
      [sx * 1.6, -1.7], [sx * 4.05, -1.35], [sx * 4.05, 0.7], [sx * 3.0, 1.85], [sx * 1.6, 1.85],
    ];
    if (sx > 0) pts.reverse();
    g.add(profileY(pts, 2.05, M.main, 0.16));
    // 리벳 테두리 (바깥면)
    fastenerRow(g, [sx * 4.23, -0.7, -1.15], [sx * 4.23, -0.7, 0.55], 4, 0.1, [sx, 0, 0], M.main);
    fastenerRow(g, [sx * 4.23, 0.7, -1.15], [sx * 4.23, 0.7, 0.55], 4, 0.1, [sx, 0, 0], M.main);
    panelRect(g, [sx * 4.23, 0, -0.35], [0, 0, 1], [0, 1, 0], 0.75, 0.55, [sx, 0, 0], M.groove, 0.11);
    P(id, name, g, { pos: [0, 2.85, 0], lieRot: [Math.PI / 2, 0, 0], order });
  }

  // ---- B8/B9 6파운더 포 (스터비)
  for (const [id, name, sx, order] of [['B8', '좌 6파운더', -1, 8], ['B9', '우 6파운더', 1, 9]]) {
    const g = new THREE.Group();
    const shield = cylZ(0.52, 0.58, 0.45, M.main, 16);
    const barrel = cylZ(0.28, 0.36, 1.7, M.main, 14);
    barrel.position.z = 1.0;
    const muzzle = cylZ(0.4, 0.4, 0.22, M.main, 14);
    muzzle.position.z = 1.85;
    g.add(shield, barrel, muzzle);
    P(id, name, g, {
      pos: [sx * 3.5, 2.85, 1.35],
      rot: [0, sx * 0.28, 0],
      lieRot: [Math.PI / 2, Math.PI / 2, 0],
      order,
    });
  }

  // ---- B10 조종실 캡
  {
    const g = new THREE.Group();
    g.add(chamferBox(2.1, 1.15, 2.3, 0.15, M.main));
    panelRect(g, [0, 0.58, 0], [1, 0, 0], [0, 0, 1], 0.7, 0.8, [0, 1, 0], M.groove, 0.11);
    for (const sx of [-0.5, 0.5]) {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.13, 0.1), M.groove);
      slit.position.set(sx, 0.22, 1.16);
      g.add(slit);
    }
    fastenerRow(g, [-1.06, -0.1, -0.9], [-1.06, -0.1, 0.9], 4, 0.09, [-1, 0, 0], M.main);
    fastenerRow(g, [1.06, -0.1, -0.9], [1.06, -0.1, 0.9], 4, 0.09, [1, 0, 0], M.main);
    P('B10', '조종실 캡', g, { pos: [0, 4.65, 2.3], lieRot: [Math.PI / 2, 0, 0], order: 10 });
  }

  // ---- B11 배기 머플러 (상부 데크)
  {
    const g = new THREE.Group();
    const muf = cylX(0.5, 0.5, 2.3, M.main, 16);
    g.add(muf);
    for (const bx of [-0.7, 0.7]) {
      const band = grooveRing(0.51, 0.05, M.groove);
      band.rotation.z = Math.PI / 2;
      band.position.x = bx;
      g.add(band);
    }
    const pipe = cylY(0.18, 0.18, 0.8, M.main, 10);
    pipe.position.set(0, 0.55, 0);
    g.add(pipe);
    P('B11', '배기 머플러', g, { pos: [0, 4.75, -2.3], lieRot: [0, 0, 0], order: 12 });
  }

  // ---- B12 언디칭 레일
  {
    const g = new THREE.Group();
    for (const sx of [-1.15, 1.15]) {
      const rail = chamferBox(0.2, 0.32, 8.8, 0.07, M.main);
      rail.position.set(sx, 0.15, 0);
      g.add(rail);
    }
    for (const bz of [-3.2, 0, 3.2]) {
      const beam = chamferBox(2.7, 0.22, 0.5, 0.07, M.main);
      beam.position.set(0, -0.12, bz);
      g.add(beam);
    }
    P('B12', '언디칭 레일', g, { pos: [0, 5.35, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 11 });
  }

  return { key: 'mk4', label: 'Mark IV', sub: 'WWI · 영국', color, runnerWidth: 24, parts };
}
