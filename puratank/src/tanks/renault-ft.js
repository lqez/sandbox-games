// 르노 FT — WWI 프랑스 경전차. 강데포르메(WWT/메탈슬러그풍).
// 포탑은 바닥이 뚫린 회전체 쉘(사출 캐비티가 보임),
// 궤도는 직선 렝스 + 개별 링크가 런너에 평면으로 눕는 링크&렝스 방식.
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileX, tub, cylY, cylZ, cylX, sphere,
  panelLine, panelRect, fastenerRow, grooveRing, revolveShell,
  trackLayout, trackLengthPiece, trackLinkPiece, roadWheel, wheelHoles, definePart,
} from '../plamo.js';

const CIRCLES = [
  { z: -1.95, y: 1.15, r: 1.15 },
  { z: 2.1, y: 2.35, r: 1.75 },
];

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
    P('A2', '상부 차체', g, { pos: [0, 2.7, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 22 });
  }

  // ---- A3 포탑 (돔 포탑 — 바닥 뚫린 회전체 쉘)
  {
    const g = new THREE.Group();
    const d2r = Math.PI / 180;
    const prof = [[2.3, 0], [2.3, 0.45], [2.05, 0.58], [2.02, 1.95]];
    for (let a = 10; a <= 90; a += 10) {
      prof.push([2.02 * Math.cos(a * d2r), 1.95 + 1.2 * Math.sin(a * d2r)]);
    }
    g.add(revolveShell(prof, 0.26, M.main, 36));
    const seam = grooveRing(2.05, 0.07, M.groove);
    seam.position.y = 1.98;
    g.add(seam);
    const seam2 = grooveRing(2.2, 0.075, M.groove);
    seam2.position.y = 0.5;
    g.add(seam2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const nx = Math.sin(a), nz = Math.cos(a);
      fastenerRow(
        g,
        [nx * 2.03, 0.75, nz * 2.03],
        [nx * 2.02, 1.75, nz * 2.02],
        3, 0.12, [nx, 0, nz], M.main
      );
    }
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.12), M.groove);
    slit.position.set(0, 1.55, 2.03);
    g.add(slit);
    P('A3', '포탑', g, { pos: [0, 3.65, -0.5], lieRot: [Math.PI / 2, 0, 0], order: 24 });
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
    P('A4', '버섯 벤트 캡', g, { pos: [0, 6.62, -0.7], lieRot: [Math.PI / 2, 0, 0], order: 26 });
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
    P('A5', '주포', g, { pos: [0, 4.75, 1.5], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 25 });
  }

  // ---- A6~ 트랙 (링크&렝스 — 평면 파츠)
  let idNum = 6;
  {
    let order = 4;
    for (const [side, sx] of [['좌', -1], ['우', 1]]) {
      for (const seg of trackLayout(CIRCLES, 0.45, 1.05)) {
        const mesh = seg.kind === 'length'
          ? trackLengthPiece(seg.len, 1.5, 0.45, M.main, { cleatOut: 0.3 })
          : trackLinkPiece(seg.len, 1.5, 0.45, M.main, { cleatOut: 0.3 });
        P(`A${idNum}`, `${side} 트랙 ${seg.kind === 'length' ? '렝스' : '링크'}`, mesh, {
          pos: [sx * 2.35, seg.pos[1], seg.pos[0]],
          rot: [-seg.theta, 0, 0],
          lieRot: [-Math.PI / 2, Math.PI / 2, 0],
          order: order++,
          runner: 'B',
        });
        idNum++;
      }
    }
  }

  // ---- 서스펜션 거더 (로드휠 3개 일체 — 평면 몰드)
  for (const [name, sx, order] of [['좌 거더', -1, 2], ['우 거더', 1, 3]]) {
    const g = new THREE.Group();
    const plate = chamferBox(0.5, 1.15, 3.7, 0.14, M.main);
    g.add(plate);
    fastenerRow(g, [sx * 0.26, 0.3, -1.5], [sx * 0.26, 0.3, 1.5], 4, 0.12, [sx, 0, 0], M.main);
    for (const wz of [-1.3, -0.05, 1.2]) {
      const w = roadWheel(0.52, 0.6, M.main, M.groove, { bolts: 5 });
      w.position.set(0, -0.55, wz);
      g.add(w);
    }
    // 대형 전방 아이들러 (르노 FT 시그니처) + 연결 암
    const idler = roadWheel(1.35, 0.7, M.main, M.groove, { bolts: 8 });
    idler.position.set(0, 0.8, 2.3);
    g.add(idler);
    wheelHoles(idler, 1.35, 0.7, M.groove, 6);
    const arm = chamferBox(0.36, 0.4, 1.3, 0.08, M.main);
    arm.position.set(0, 0.3, 1.75);
    arm.rotation.x = -0.55;
    g.add(arm);
    // 후방 스프로킷
    const sprocket = roadWheel(0.78, 0.65, M.main, M.groove, { bolts: 6 });
    sprocket.position.set(0, -0.4, -1.75);
    g.add(sprocket);
    P(`A${idNum}`, name, g, { pos: [sx * 2.35, 1.55, -0.2], lieRot: [0, Math.PI / 2, 0], order, runner: 'B' });
    idNum++;
  }

  // ---- 꼬리 스키드
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
    P(`A${idNum}`, '꼬리 스키드', g, { pos: [0, 1.95, -3.35], lieRot: [Math.PI / 2, 0, 0], order: 27, runner: 'B' });
    idNum++;
  }

  // ---- 배기 머플러
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
    P(`A${idNum}`, '배기 머플러', g, { pos: [-2.25, 3.35, -1.1], lieRot: [Math.PI / 2, 0, 0], order: 28, runner: 'B' });
    idNum++;
  }

  // ---- 조종수 해치
  {
    const g = new THREE.Group();
    const plate = chamferBox(1.7, 1.15, 0.28, 0.1, M.main);
    g.add(plate);
    panelLine(g, [0, -0.52, 0.15], [0, 0.52, 0.15], [0, 0, 1], M.groove, 0.13);
    fastenerRow(g, [-0.68, -0.38, 0.15], [-0.68, 0.38, 0.15], 3, 0.1, [0, 0, 1], M.main);
    fastenerRow(g, [0.68, -0.38, 0.15], [0.68, 0.38, 0.15], 3, 0.1, [0, 0, 1], M.main);
    P(`A${idNum}`, '조종수 해치', g, {
      pos: [0, 3.98, 2.1],
      rot: [-0.88, 0, 0],
      lieRot: [0, 0, 0],
      order: 23,
      runner: 'B',
    });
  }

  return {
    key: 'ft', label: '르노 FT', sub: 'WWI · 프랑스', color,
    runnerWidths: { A: 16, B: 20 }, parts,
  };
}
