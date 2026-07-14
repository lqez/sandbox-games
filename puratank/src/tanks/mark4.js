// Mark IV — WWI 영국 중전차. 강데포르메(WWT/메탈슬러그풍):
// 짧고 높은 통통 마름모, 큼직한 스폰슨 + 뚱뚱한 6파운더.
// 궤도는 링크&렝스 평면 파츠 4피스/측 (마름모 4변).
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileY, cylX, cylY, cylZ, domeRivet,
  panelLine, panelRect, fastenerRow, grooveRing, beltSolid,
  beltOutlinePoints, trackLayout, trackLengthPiece, trackLinkPiece, definePart,
} from '../plamo.js';

const CIRCLES = [
  { z: -2.95, y: 1.4, r: 1.35 },
  { z: 1.6, y: 1.25, r: 1.2 },
  { z: 2.95, y: 3.65, r: 1.5 },
  { z: -1.95, y: 3.75, r: 1.2 },
];

export function buildMark4() {
  const color = 0xa08d5f; // 카키 브라운 런너
  const M = makeMats(color);
  const parts = [];
  const P = (id, name, mesh, opts) => parts.push(definePart(id, name, mesh, opts));

  // ---- B1 차체 코어
  {
    const g = new THREE.Group();
    g.add(chamferBox(3.2, 3.4, 5.8, 0.25, M.main));
    panelLine(g, [0, 1.71, -2.6], [0, 1.71, 2.6], [0, 1, 0], M.groove, 0.15);
    fastenerRow(g, [-0.9, 1.71, -2.5], [-0.9, 1.71, 2.5], 6, 0.13, [0, 1, 0], M.main);
    fastenerRow(g, [0.9, 1.71, -2.5], [0.9, 1.71, 2.5], 6, 0.13, [0, 1, 0], M.main);
    P('B1', '차체 코어', g, { pos: [0, 2.9, 0.1], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 1 });
  }

  // ---- B2/B3 마름모 트랙 프레임
  for (const [id, name, sx, order] of [['B2', '좌 트랙 프레임', -1, 2], ['B3', '우 트랙 프레임', 1, 3]]) {
    const g = new THREE.Group();
    g.add(beltSolid(CIRCLES, 0.75, 1.3, M.main));
    for (const p of beltOutlinePoints(CIRCLES, 1.15, 1.1)) {
      const r = domeRivet(0.14, M.main);
      r.position.set(sx * 0.66, p.y, p.x);
      r.rotation.z = sx * -Math.PI / 2;
      g.add(r);
    }
    panelLine(g, [sx * 0.66, 2.45, -2.4], [sx * 0.66, 2.45, 2.2], [sx, 0, 0], M.groove, 0.15);
    const port = cylX(0.42, 0.47, 0.18, M.main, 14);
    port.position.set(sx * 0.7, 2.45, -0.4);
    g.add(port);
    const portRing = grooveRing(0.44, 0.06, M.groove);
    portRing.rotation.z = Math.PI / 2;
    portRing.position.set(sx * 0.75, 2.45, -0.4);
    g.add(portRing);
    P(id, name, g, { pos: [sx * 2.45, 0, 0], lieRot: [0, Math.PI / 2, 0], order });
  }

  // ---- B4~ 트랙 (링크&렝스 — 평면 파츠, 마름모 일주)
  let idNum = 4;
  {
    let order = 4;
    for (const [side, sx] of [['좌', -1], ['우', 1]]) {
      for (const seg of trackLayout(CIRCLES, 0.5, 1.35)) {
        const mesh = seg.kind === 'length'
          ? trackLengthPiece(seg.len, 1.8, 0.5, M.main, { cleatOut: 0.3 })
          : trackLinkPiece(seg.len, 1.8, 0.5, M.main, { cleatOut: 0.3 });
        P(`B${idNum}`, `${side} 트랙 ${seg.kind === 'length' ? '렝스' : '링크'}`, mesh, {
          pos: [sx * 2.5, seg.pos[1], seg.pos[0]],
          rot: [-seg.theta, 0, 0],
          lieRot: [-Math.PI / 2, Math.PI / 2, 0],
          order: order++,
          runner: 'B',
        });
        idNum++;
      }
    }
  }

  // ---- 스폰슨 (측면 포탑실 — 큼직하게)
  for (const [name, sx, order] of [['좌 스폰슨', -1, 32], ['우 스폰슨', 1, 33]]) {
    const g = new THREE.Group();
    const pts = [
      [sx * 1.5, -1.45], [sx * 3.95, -1.05], [sx * 3.95, 0.75], [sx * 2.75, 1.75], [sx * 1.5, 1.75],
    ];
    if (sx > 0) pts.reverse();
    g.add(profileY(pts, 2.4, M.main, 0.2));
    fastenerRow(g, [sx * 4.12, -0.82, -0.85], [sx * 4.12, -0.82, 0.6], 4, 0.13, [sx, 0, 0], M.main);
    fastenerRow(g, [sx * 4.12, 0.82, -0.85], [sx * 4.12, 0.82, 0.6], 4, 0.13, [sx, 0, 0], M.main);
    panelRect(g, [sx * 4.12, 0, -0.15], [0, 0, 1], [0, 1, 0], 0.72, 0.62, [sx, 0, 0], M.groove, 0.14);
    P(`B${idNum}`, name, g, { pos: [0, 2.9, 0.1], lieRot: [Math.PI / 2, 0, 0], order });
    idNum++;
  }

  // ---- 6파운더 포 (스터비 + 뚱뚱)
  for (const [name, sx, order] of [['좌 6파운더', -1, 34], ['우 6파운더', 1, 35]]) {
    const g = new THREE.Group();
    const shield = cylZ(0.7, 0.78, 0.5, M.main, 18);
    const barrel = cylZ(0.42, 0.52, 1.4, M.main, 16);
    barrel.position.z = 0.9;
    const muzzle = cylZ(0.6, 0.6, 0.3, M.main, 16);
    muzzle.position.z = 1.6;
    g.add(shield, barrel, muzzle);
    P(`B${idNum}`, name, g, {
      pos: [sx * 3.4, 2.9, 1.6],
      rot: [0, sx * 0.3, 0],
      lieRot: [Math.PI / 2, Math.PI / 2, 0],
      order,
      runner: 'B',
    });
    idNum++;
  }

  // ---- 조종실 캡
  {
    const g = new THREE.Group();
    g.add(chamferBox(2.4, 1.5, 2.4, 0.2, M.main));
    panelRect(g, [0, 0.76, 0], [1, 0, 0], [0, 0, 1], 0.75, 0.8, [0, 1, 0], M.groove, 0.14);
    for (const sx of [-0.55, 0.55]) {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.17, 0.12), M.groove);
      slit.position.set(sx, 0.3, 1.22);
      g.add(slit);
    }
    fastenerRow(g, [-1.21, -0.15, -0.95], [-1.21, -0.15, 0.95], 4, 0.11, [-1, 0, 0], M.main);
    fastenerRow(g, [1.21, -0.15, -0.95], [1.21, -0.15, 0.95], 4, 0.11, [1, 0, 0], M.main);
    P(`B${idNum}`, '조종실 캡', g, { pos: [0, 5.2, 1.15], lieRot: [Math.PI / 2, 0, 0], order: 36, runner: 'B' });
    idNum++;
  }

  // ---- 언디칭 레일
  {
    const g = new THREE.Group();
    for (const sx of [-1.25, 1.25]) {
      const rail = chamferBox(0.26, 0.4, 6.6, 0.09, M.main);
      rail.position.set(sx, 0.18, 0);
      g.add(rail);
    }
    for (const bz of [-2.4, 0, 2.4]) {
      const beam = chamferBox(2.9, 0.26, 0.55, 0.09, M.main);
      beam.position.set(0, -0.14, bz);
      g.add(beam);
    }
    P(`B${idNum}`, '언디칭 레일', g, { pos: [0, 5.9, -0.3], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 37, runner: 'B' });
    idNum++;
  }

  // ---- 배기 머플러
  {
    const g = new THREE.Group();
    const muf = cylX(0.55, 0.55, 2.4, M.main, 16);
    g.add(muf);
    for (const bx of [-0.75, 0.75]) {
      const band = grooveRing(0.56, 0.06, M.groove);
      band.rotation.z = Math.PI / 2;
      band.position.x = bx;
      g.add(band);
    }
    const pipe = cylY(0.22, 0.22, 0.9, M.main, 10);
    pipe.position.set(0, 0.6, 0);
    g.add(pipe);
    P(`B${idNum}`, '배기 머플러', g, { pos: [0, 5.3, -1.7], lieRot: [0, 0, 0], order: 38, runner: 'B' });
  }

  return {
    key: 'mk4', label: 'Mark IV', sub: 'WWI · 영국', color,
    runnerWidths: { A: 21, B: 24 }, parts,
  };
}
