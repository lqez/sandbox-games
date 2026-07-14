// 르노 FT — WWI 프랑스 경전차. 강데포르메(WWT/메탈슬러그풍):
// 짧고 통통한 차체, 차체만큼 큰 돔 포탑, 거대한 전방 아이들러 휠, 뚱뚱한 주포.
// 궤도는 링크&렝스 평면 파츠 3피스/측을 서로 끼워 조립.
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileX, tub, cylY, cylZ, cylX, sphere,
  panelLine, panelRect, fastenerRow, grooveRing, trackPieces, roadWheel,
  centered, definePart,
} from '../plamo.js';

const CIRCLES = [
  { z: -1.95, y: 1.15, r: 1.15 },
  { z: 1.1, y: 1.0, r: 1.0 },
  { z: 2.1, y: 2.4, r: 1.8 },
];
const PIECE_NAMES = ['후부', '하부', '전부'];

export function buildRenaultFT() {
  const color = 0xd9a96c; // 샌드 오커 런너
  const M = makeMats(color);
  const parts = [];
  const P = (id, name, mesh, opts) => parts.push(definePart(id, name, mesh, opts));

  // ---- A1 하부 차체 (욕조형 쉘)
  {
    const g = tub(3.2, 1.7, 5.4, 0.32, M.main);
    fastenerRow(g, [-1.61, -0.35, -2.3], [-1.61, -0.35, 2.3], 6, 0.13, [-1, 0, 0], M.main);
    fastenerRow(g, [1.61, -0.35, -2.3], [1.61, -0.35, 2.3], 6, 0.13, [1, 0, 0], M.main);
    panelLine(g, [-1.61, 0.2, -2.5], [-1.61, 0.2, 2.5], [-1, 0, 0], M.groove, 0.16);
    panelLine(g, [1.61, 0.2, -2.5], [1.61, 0.2, 2.5], [1, 0, 0], M.groove, 0.16);
    P('A1', '하부 차체', g, { pos: [0, 1.85, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 1 });
  }

  // ---- A2 상부 차체 (전방 경사 드라이버 후드)
  {
    const g = new THREE.Group();
    g.add(profileX(
      [[-2.7, 0], [2.7, 0], [2.7, 0.6], [1.3, 1.75], [0.15, 1.75], [-1.2, 1.0], [-2.7, 1.0]],
      3.2, M.main, 0.2
    ));
    panelRect(g, [0, 1.2, -1.9], [1, 0, 0], [0, 0, 1], 0.95, 0.55, [0, 1, 0], M.groove, 0.15);
    panelRect(g, [0, 1.95, 0.75], [1, 0, 0], [0, 0, 1], 0.8, 0.45, [0, 1, 0], M.groove, 0.15);
    fastenerRow(g, [-1.3, 1.35, 2.15], [1.3, 1.35, 2.15], 5, 0.13, [0, 0.77, 0.63], M.main);
    fastenerRow(g, [-1.61, 0.55, -2.4], [-1.61, 0.55, 2.2], 6, 0.12, [-1, 0, 0], M.main);
    fastenerRow(g, [1.61, 0.55, -2.4], [1.61, 0.55, 2.2], 6, 0.12, [1, 0, 0], M.main);
    P('A2', '상부 차체', g, { pos: [0, 2.7, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 10 });
  }

  // ---- A3 포탑 (돔 포탑 — 차체급 오버사이즈)
  {
    const g = new THREE.Group();
    const base = cylY(2.15, 2.28, 0.45, M.main, 26);
    base.position.y = 0.22;
    const body = cylY(1.95, 2.1, 1.5, M.main, 26);
    body.position.y = 1.15;
    const dome = sphere(1.9, M.main, 30, 20);
    dome.scale.set(1, 0.62, 1);
    dome.position.y = 1.95;
    g.add(base, body, dome);
    const seam = grooveRing(1.97, 0.07, M.groove);
    seam.position.y = 1.97;
    g.add(seam);
    const seam2 = grooveRing(2.14, 0.075, M.groove);
    seam2.position.y = 0.48;
    g.add(seam2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const nx = Math.sin(a), nz = Math.cos(a);
      fastenerRow(
        g,
        [nx * 2.04, 0.7, nz * 2.04],
        [nx * 2.0, 1.7, nz * 2.0],
        3, 0.12, [nx, 0, nz], M.main
      );
    }
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.12), M.groove);
    slit.position.set(0, 1.55, 2.04);
    g.add(slit);
    P('A3', '포탑', g, { pos: [0, 3.65, -0.5], lieRot: [Math.PI / 2, 0, 0], order: 12 });
  }

  // ---- A4 버섯 벤트 캡
  {
    const g = new THREE.Group();
    const stem = cylY(0.42, 0.5, 0.55, M.main, 14);
    stem.position.y = 0.28;
    const cap = sphere(0.8, M.main, 18, 12);
    cap.scale.set(1, 0.5, 1);
    cap.position.y = 0.62;
    g.add(stem, cap);
    P('A4', '버섯 벤트 캡', g, { pos: [0, 6.42, -0.7], lieRot: [Math.PI / 2, 0, 0], order: 14 });
  }

  // ---- A5 주포 (푸토 37mm — 뚱뚱하게)
  {
    const g = new THREE.Group();
    const ball = sphere(0.78, M.main, 18, 14);
    ball.scale.set(1, 1, 0.85);
    const barrel = cylZ(0.36, 0.46, 1.6, M.main, 16);
    barrel.position.z = 1.0;
    const muzzle = cylZ(0.55, 0.55, 0.35, M.main, 16);
    muzzle.position.z = 1.85;
    g.add(ball, barrel, muzzle);
    P('A5', '주포', g, { pos: [0, 4.75, 1.55], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 13 });
  }

  // ---- A6~A11 트랙 (링크&렝스 3피스/측 — 평면 파츠 끼움 조립)
  {
    let idNum = 6, order = 4;
    for (const [side, sx] of [['좌', -1], ['우', 1]]) {
      const pieces = trackPieces(CIRCLES, 1.5, 0.5, M.main, { cleatOut: 0.32, cleatWide: 0.5 });
      pieces.forEach((piece, i) => {
        const { mesh, center } = centered(piece);
        P(`A${idNum}`, `${side} 트랙 ${PIECE_NAMES[i]}`, mesh, {
          pos: [sx * 2.35 + center.x, center.y, center.z],
          lieRot: [0, Math.PI / 2, 0],
          order: order++,
          runner: 'B',
        });
        idNum++;
      });
    }
  }

  // ---- A12/A13 서스펜션 거더 (대형 로드휠 3개 일체 몰드)
  for (const [id, name, sx, order] of [['A12', '좌 거더', -1, 2], ['A13', '우 거더', 1, 3]]) {
    const g = new THREE.Group();
    const plate = chamferBox(0.5, 1.15, 3.7, 0.14, M.main);
    g.add(plate);
    fastenerRow(g, [sx * 0.26, 0.3, -1.5], [sx * 0.26, 0.3, 1.5], 4, 0.12, [sx, 0, 0], M.main);
    for (const wz of [-1.3, -0.05, 1.2]) {
      const w = roadWheel(0.52, 0.6, M.main, M.groove, { bolts: 5 });
      w.position.set(0, -0.55, wz);
      g.add(w);
    }
    P(id, name, g, { pos: [sx * 2.35, 1.55, -0.35], lieRot: [0, Math.PI / 2, 0], order, runner: 'B' });
  }

  // ---- A14 꼬리 스키드 (청키하게)
  {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      const rail = chamferBox(0.3, 0.5, 2.1, 0.1, M.main);
      rail.position.set(sx * 0.9, 0.3, 0.1);
      rail.rotation.x = -0.55;
      g.add(rail);
    }
    const cross = cylX(0.18, 0.18, 2.1, M.main, 12);
    cross.position.set(0, -0.2, -0.75);
    const skid = chamferBox(2.25, 0.2, 1.05, 0.08, M.main);
    skid.position.set(0, -0.34, -0.68);
    skid.rotation.x = 0.35;
    g.add(cross, skid);
    fastenerRow(g, [-0.75, -0.24, -0.72], [0.75, -0.24, -0.72], 4, 0.1, [0, 0.9, -0.35], M.main);
    P('A14', '꼬리 스키드', g, { pos: [0, 1.95, -3.35], lieRot: [Math.PI / 2, 0, 0], order: 15, runner: 'B' });
  }

  // ---- A15 배기 머플러
  {
    const g = new THREE.Group();
    const muf = cylZ(0.5, 0.5, 1.6, M.main, 16);
    const band = grooveRing(0.51, 0.06, M.groove);
    band.rotation.x = 0;
    g.add(muf, band);
    const pipe = cylZ(0.2, 0.2, 0.7, M.main, 10);
    pipe.position.set(0, -0.15, -1.1);
    pipe.rotation.x = 0.5;
    g.add(pipe);
    P('A15', '배기 머플러', g, { pos: [-2.25, 3.4, -1.1], lieRot: [Math.PI / 2, 0, 0], order: 16, runner: 'B' });
  }

  // ---- A16 조종수 해치 (경사면 위)
  {
    const g = new THREE.Group();
    const plate = chamferBox(1.7, 1.15, 0.28, 0.1, M.main);
    g.add(plate);
    panelLine(g, [0, -0.52, 0.15], [0, 0.52, 0.15], [0, 0, 1], M.groove, 0.13);
    fastenerRow(g, [-0.68, -0.38, 0.15], [-0.68, 0.38, 0.15], 3, 0.1, [0, 0, 1], M.main);
    fastenerRow(g, [0.68, -0.38, 0.15], [0.68, 0.38, 0.15], 3, 0.1, [0, 0, 1], M.main);
    P('A16', '조종수 해치', g, {
      pos: [0, 3.98, 2.1],
      rot: [-0.88, 0, 0],
      lieRot: [0, 0, 0],
      order: 11,
      runner: 'B',
    });
  }

  return {
    key: 'ft', label: '르노 FT', sub: 'WWI · 프랑스', color,
    runnerWidths: { A: 15, B: 17 }, parts,
  };
}
