// 르노 FT — WWI 프랑스 경전차. SD 데포르메: 커다란 전방 아이들러 휠,
// 오버사이즈 돔 포탑 + 버섯 벤트 캡, 꼬리 스키드. 리벳 과장.
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileX, tub, cylY, cylZ, cylX, sphere,
  panelLine, panelRect, fastenerRow, grooveRing, beltMesh, roadWheel,
  centered, definePart,
} from '../plamo.js';

export function buildRenaultFT() {
  const color = 0xd9a96c; // 샌드 오커 런너
  const M = makeMats(color);
  const parts = [];
  const P = (id, name, mesh, opts) => parts.push(definePart(id, name, mesh, opts));

  // ---- A1 하부 차체 (욕조형 쉘 — 판 두께가 보임)
  {
    const g = tub(3.4, 1.6, 6.6, 0.3, M.main);
    fastenerRow(g, [-1.71, -0.35, -2.9], [-1.71, -0.35, 2.9], 8, 0.1, [-1, 0, 0], M.main);
    fastenerRow(g, [1.71, -0.35, -2.9], [1.71, -0.35, 2.9], 8, 0.1, [1, 0, 0], M.main);
    panelLine(g, [-1.71, 0.15, -3.1], [-1.71, 0.15, 3.1], [-1, 0, 0], M.groove);
    panelLine(g, [1.71, 0.15, -3.1], [1.71, 0.15, 3.1], [1, 0, 0], M.groove);
    P('A1', '하부 차체', g, { pos: [0, 1.7, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 1 });
  }

  // ---- A2 상부 차체 (전방 경사 드라이버 후드)
  {
    const g = new THREE.Group();
    g.add(profileX(
      [[-3.3, 0], [3.3, 0], [3.3, 0.55], [1.85, 1.55], [0.5, 1.55], [-1.5, 0.95], [-3.3, 0.95]],
      3.4, M.main
    ));
    // 후면 데크 패널 + 상면 해치 라인
    panelRect(g, [0, 1.12, -2.35], [1, 0, 0], [0, 0, 1], 1.15, 0.65, [0, 1, 0], M.groove);
    panelRect(g, [0, 1.72, 1.15], [1, 0, 0], [0, 0, 1], 0.95, 0.5, [0, 1, 0], M.groove);
    // 전방 경사면 리벳(법선: 위+앞)
    fastenerRow(g, [-1.45, 1.16, 2.68], [1.45, 1.16, 2.68], 7, 0.1, [0, 0.83, 0.57], M.main);
    // 측면 리벳
    fastenerRow(g, [-1.71, 0.55, -2.9], [-1.71, 0.55, 2.7], 8, 0.1, [-1, 0, 0], M.main);
    fastenerRow(g, [1.71, 0.55, -2.9], [1.71, 0.55, 2.7], 8, 0.1, [1, 0, 0], M.main);
    P('A2', '상부 차체', g, { pos: [0, 2.5, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 6 });
  }

  // ---- A3 포탑 (돔 포탑 — 오버사이즈)
  {
    const g = new THREE.Group();
    const base = cylY(1.9, 2.0, 0.4, M.main, 24);
    base.position.y = 0.2;
    const body = cylY(1.7, 1.82, 1.3, M.main, 24);
    body.position.y = 1.0;
    const dome = sphere(1.68, M.main, 28, 18);
    dome.scale.set(1, 0.66, 1);
    dome.position.y = 1.65;
    g.add(base, body, dome);
    // 돔-몸통 이음새 음각 링 + 포탑 링 음각
    const seam = grooveRing(1.73, 0.055, M.groove);
    seam.position.y = 1.66;
    g.add(seam);
    const seam2 = grooveRing(1.86, 0.06, M.groove);
    seam2.position.y = 0.42;
    g.add(seam2);
    // 8방향 세로 리벳열 (리벳 조립식 포탑 느낌)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const nx = Math.sin(a), nz = Math.cos(a);
      fastenerRow(
        g,
        [nx * 1.78, 0.55, nz * 1.78],
        [nx * 1.74, 1.45, nz * 1.74],
        3, 0.09, [nx, 0, nz], M.main
      );
    }
    // 전방 관측 슬릿
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.1), M.groove);
    slit.position.set(0, 1.35, 1.78);
    g.add(slit);
    P('A3', '포탑', g, { pos: [0, 3.4, -0.5], lieRot: [Math.PI / 2, 0, 0], order: 8 });
  }

  // ---- A4 버섯 벤트 캡
  {
    const g = new THREE.Group();
    const stem = cylY(0.36, 0.42, 0.5, M.main, 14);
    stem.position.y = 0.25;
    const cap = sphere(0.62, M.main, 18, 12);
    cap.scale.set(1, 0.55, 1);
    cap.position.y = 0.58;
    g.add(stem, cap);
    P('A4', '버섯 벤트 캡', g, { pos: [0, 5.85, -0.72], lieRot: [Math.PI / 2, 0, 0], order: 10 });
  }

  // ---- A5 주포 (푸토 37mm — 뭉툭하게)
  {
    const g = new THREE.Group();
    const ball = sphere(0.62, M.main, 18, 14);
    ball.scale.set(1, 1, 0.85);
    const barrel = cylZ(0.24, 0.3, 1.7, M.main, 16);
    barrel.position.z = 0.95;
    const muzzle = cylZ(0.35, 0.35, 0.28, M.main, 16);
    muzzle.position.z = 1.8;
    g.add(ball, barrel, muzzle);
    P('A5', '주포', g, { pos: [0, 4.5, 1.2], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 9 });
  }

  // ---- A6/A7 트랙 벨트 (앞쪽 대형 아이들러로 치켜올라간 실루엣)
  const ftCircles = [
    { z: -2.7, y: 1.05, r: 1.05 },
    { z: 1.7, y: 0.92, r: 0.92 },
    { z: 2.75, y: 2.05, r: 1.42 },
  ];
  for (const [id, name, sx, order] of [['A6', '좌 트랙', -1, 4], ['A7', '우 트랙', 1, 5]]) {
    const belt = beltMesh(ftCircles, 1.3, 0.42, M.main, M.groove, { cleatCount: 24 });
    const { mesh, center } = centered(belt);
    P(id, name, mesh, {
      pos: [sx * 2.35 + center.x, center.y, center.z],
      lieRot: [0, Math.PI / 2, 0],
      order,
    });
  }

  // ---- A8/A9 서스펜션 거더 (로드휠 몰드 일체형)
  for (const [id, name, sx, order] of [['A8', '좌 거더', -1, 2], ['A9', '우 거더', 1, 3]]) {
    const g = new THREE.Group();
    const plate = chamferBox(0.42, 1.05, 4.6, 0.12, M.main);
    g.add(plate);
    fastenerRow(g, [sx * 0.22, 0.25, -2.0], [sx * 0.22, 0.25, 2.0], 6, 0.09, [sx, 0, 0], M.main);
    for (const wz of [-1.75, -0.65, 0.45, 1.55]) {
      const w = roadWheel(0.42, 0.5, M.main, M.groove, { bolts: 5 });
      w.position.set(0, -0.5, wz);
      g.add(w);
    }
    P(id, name, g, { pos: [sx * 2.35, 1.4, -0.25], lieRot: [0, Math.PI / 2, 0], order });
  }

  // ---- A10 꼬리 스키드
  {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      const rail = chamferBox(0.24, 0.4, 2.4, 0.08, M.main);
      rail.position.set(sx * 0.95, 0.35, 0.1);
      rail.rotation.x = -0.5;
      g.add(rail);
    }
    const cross = cylX(0.15, 0.15, 2.15, M.main, 10);
    cross.position.set(0, -0.15, -0.95);
    const skid = chamferBox(2.1, 0.16, 0.95, 0.06, M.main);
    skid.position.set(0, -0.28, -0.85);
    skid.rotation.x = 0.35;
    g.add(cross, skid);
    fastenerRow(g, [-0.7, -0.2, -0.9], [0.7, -0.2, -0.9], 4, 0.08, [0, 0.9, -0.35], M.main);
    P('A10', '꼬리 스키드', g, { pos: [0, 1.75, -4.15], lieRot: [Math.PI / 2, 0, 0], order: 11 });
  }

  // ---- A11 배기 머플러 (좌측 후방, 트랙 위)
  {
    const g = new THREE.Group();
    const muf = cylZ(0.42, 0.42, 1.5, M.main, 16);
    const band = grooveRing(0.43, 0.05, M.groove);
    band.rotation.x = 0;
    g.add(muf, band);
    const pipe = cylZ(0.16, 0.16, 0.7, M.main, 10);
    pipe.position.set(0, -0.1, -1.05);
    pipe.rotation.x = 0.5;
    g.add(pipe);
    P('A11', '배기 머플러', g, { pos: [-2.35, 3.15, -1.5], lieRot: [Math.PI / 2, 0, 0], order: 12 });
  }

  // ---- A12 전방 해치 (경사면 위)
  {
    const g = new THREE.Group();
    const plate = chamferBox(1.55, 1.05, 0.24, 0.08, M.main);
    g.add(plate);
    panelLine(g, [0, -0.5, 0.13], [0, 0.5, 0.13], [0, 0, 1], M.groove, 0.11);
    fastenerRow(g, [-0.62, -0.35, 0.13], [-0.62, 0.35, 0.13], 3, 0.08, [0, 0, 1], M.main);
    fastenerRow(g, [0.62, -0.35, 0.13], [0.62, 0.35, 0.13], 3, 0.08, [0, 0, 1], M.main);
    P('A12', '조종수 해치', g, {
      pos: [0, 3.55, 2.62],
      rot: [-0.97, 0, 0],
      lieRot: [0, 0, 0],
      order: 7,
    });
  }

  return { key: 'ft', label: '르노 FT', sub: 'WWI · 프랑스', color, runnerWidth: 18, parts };
}
