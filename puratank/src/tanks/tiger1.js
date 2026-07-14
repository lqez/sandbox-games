// 티거 I — WWII 독일 중전차. 강데포르메(WWT/메탈슬러그풍):
// 짧고 육중한 박스 차체, 거대한 말굽 포탑 + 드럼 큐폴라,
// 초대형 머즐브레이크 88mm. 궤도는 링크&렝스 평면 파츠 2피스/측.
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileX, tub, cylY, cylZ, sphere,
  panelLine, panelRect, fastenerRow, grooveRing,
  trackLayout, trackLengthPiece, trackLinkPiece, roadWheel,
  assemblyPeg, assemblySocket, rimPegs, definePart,
} from '../plamo.js';

const CIRCLES = [
  { z: -3.0, y: 1.5, r: 1.5 },
  { z: 3.0, y: 1.5, r: 1.5 },
];

export function buildTiger1() {
  const color = 0x8d99a6; // 저먼 그레이 런너
  const M = makeMats(color);
  const parts = [];
  const P = (id, name, mesh, opts) => parts.push(definePart(id, name, mesh, opts));

  // ---- D1 하부 차체
  {
    const g = tub(5.2, 1.8, 8.2, 0.34, M.main);
    panelLine(g, [-2.61, 0.2, -3.8], [-2.61, 0.2, 3.8], [-1, 0, 0], M.groove, 0.16);
    panelLine(g, [2.61, 0.2, -3.8], [2.61, 0.2, 3.8], [1, 0, 0], M.groove, 0.16);
    fastenerRow(g, [-2.61, -0.45, -3.5], [-2.61, -0.45, 3.5], 6, 0.13, [-1, 0, 0], M.main, 'hex');
    fastenerRow(g, [2.61, -0.45, -3.5], [2.61, -0.45, 3.5], 6, 0.13, [1, 0, 0], M.main, 'hex');
    rimPegs(g, 5.2, 1.8, 8.2, M.main);
    P('D1', '하부 차체', g, { pos: [0, 1.95, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 1 });
  }

  // ---- D2 상부 차체 (박스형 + 거의 수직인 전면장갑)
  {
    const g = new THREE.Group();
    g.add(profileX(
      [[-4.1, 0], [3.5, 0], [4.15, 0.75], [4.0, 2.0], [-4.1, 2.0]],
      8.4, M.main, 0.22
    ));
    panelLine(g, [-2.9, 2.23, 0.9], [2.9, 2.23, 0.9], [0, 1, 0], M.groove, 0.16);
    panelRect(g, [0, 2.23, -2.5], [1, 0, 0], [0, 0, 1], 1.85, 1.1, [0, 1, 0], M.groove, 0.15);
    for (const sx of [-2.0, 2.0]) {
      const fan = grooveRing(0.95, 0.07, M.groove, 36);
      fan.position.set(sx, 2.24, -2.5);
      g.add(fan);
      const fan2 = grooveRing(0.55, 0.06, M.groove, 24);
      fan2.position.set(sx, 2.24, -2.5);
      g.add(fan2);
    }
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.3, 0.16), M.groove);
    visor.position.set(-1.35, 1.4, 4.32);
    g.add(visor);
    fastenerRow(g, [-2.9, 2.23, 3.9], [2.9, 2.23, 3.9], 6, 0.13, [0, 1, 0], M.main, 'hex');
    panelLine(g, [-3.7, 2.23, -3.9], [-3.7, 2.23, 3.8], [0, 1, 0], M.groove, 0.15);
    panelLine(g, [3.7, 2.23, -3.9], [3.7, 2.23, 3.8], [0, 1, 0], M.groove, 0.15);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const so = assemblySocket(M.groove);
      so.position.set(sx * 1.95, 0.03, sz * 3.25);
      g.add(so);
    }
    const tSocket = grooveRing(2.3, 0.08, M.groove, 48);
    tSocket.position.set(0, 2.24, 0.1);
    g.add(tSocket);
    P('D2', '상부 차체', g, { pos: [0, 2.7, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 22 });
  }

  // ---- D3 포탑 (말굽형 — 바닥 뚫린 벽 쉘 + 일체 지붕판)
  {
    const g = new THREE.Group();
    const wall = 0.4;
    const outerPts = [[2.15, 2.4], [2.6, 1.2], [2.6, 0.3]];
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      outerPts.push([2.6 * Math.cos(a), 0.3 - 2.6 * Math.sin(a)]);
    }
    outerPts.push([-2.6, 1.2], [-2.15, 2.4]);
    const innerPts = [[1.8, 2.0], [2.2, 1.05], [2.2, 0.3]];
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      innerPts.push([2.2 * Math.cos(a), 0.3 - 2.2 * Math.sin(a)]);
    }
    innerPts.push([-2.2, 1.05], [-1.8, 2.0]);
    const shape = new THREE.Shape();
    shape.moveTo(outerPts[0][0], -outerPts[0][1]);
    for (let i = 1; i < outerPts.length; i++) shape.lineTo(outerPts[i][0], -outerPts[i][1]);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(innerPts[0][0], -innerPts[0][1]);
    for (let i = 1; i < innerPts.length; i++) hole.lineTo(innerPts[i][0], -innerPts[i][1]);
    hole.closePath();
    shape.holes.push(hole);
    const wallGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 1.9, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2, curveSegments: 6,
    });
    wallGeo.rotateX(-Math.PI / 2);
    wallGeo.translate(0, 0.12, 0);
    const wallMesh = new THREE.Mesh(wallGeo, M.main);
    wallMesh.castShadow = wallMesh.receiveShadow = true;
    g.add(wallMesh);
    // 일체 지붕판
    const roofShape = new THREE.Shape();
    roofShape.moveTo(outerPts[0][0], -outerPts[0][1]);
    for (let i = 1; i < outerPts.length; i++) roofShape.lineTo(outerPts[i][0], -outerPts[i][1]);
    roofShape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
      depth: 0.2, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2, curveSegments: 6,
    });
    roofGeo.rotateX(-Math.PI / 2);
    roofGeo.translate(0, 2.28, 0);
    const roof = new THREE.Mesh(roofGeo, M.main);
    roof.castShadow = roof.receiveShadow = true;
    g.add(roof);
    panelRect(g, [0.85, 2.42, -0.8], [1, 0, 0], [0, 0, 1], 0.62, 0.62, [0, 1, 0], M.groove, 0.15);
    fastenerRow(g, [-1.4, 2.42, 1.5], [1.4, 2.42, 1.5], 4, 0.12, [0, 1, 0], M.main, 'hex');
    panelLine(g, [-1.6, 2.42, 1.0], [-1.6, 2.42, -0.7], [0, 1, 0], M.groove, 0.13);
    panelLine(g, [1.6, 2.42, 1.0], [1.6, 2.42, -0.7], [0, 1, 0], M.groove, 0.13);
    const hatch = cylZ(0.66, 0.72, 0.16, M.main, 18);
    hatch.rotation.y = Math.PI / 2;
    hatch.position.set(2.9, 1.2, -1.5);
    g.add(hatch);
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 8, 14, Math.PI), M.main);
      rail.position.set(sx * 2.9, 1.5, 0.7);
      rail.rotation.y = sx * Math.PI / 2;
      rail.castShadow = true;
      g.add(rail);
    }
    P('D3', '포탑', g, { pos: [0, 4.7, 0.1], lieRot: [Math.PI / 2, 0, 0], order: 24 });
  }

  // ---- D4 큐폴라 (드럼형 — 크게)
  {
    const g = new THREE.Group();
    const drum = cylY(1.05, 1.12, 0.85, M.main, 22);
    drum.position.y = 0.42;
    const lid = cylY(1.16, 1.16, 0.22, M.main, 22);
    lid.position.y = 0.95;
    g.add(drum, lid);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.12), M.groove);
      slit.position.set(Math.sin(a) * 1.08, 0.48, Math.cos(a) * 1.08);
      slit.rotation.y = a;
      g.add(slit);
    }
    const knob = sphere(0.2, M.main, 10, 8);
    knob.position.set(0.5, 1.12, 0);
    g.add(knob);
    const cpeg = assemblyPeg(M.main, 0.18, 0.3);
    cpeg.position.y = -0.08;
    g.add(cpeg);
    P('D4', '큐폴라', g, { pos: [-1.15, 7.15, -0.5], lieRot: [Math.PI / 2, 0, 0], order: 27, runner: 'B' });
  }

  // ---- D5 주포 (88mm — 초대형 머즐브레이크)
  {
    const g = new THREE.Group();
    const sleeve = cylZ(0.62, 0.68, 1.7, M.main, 18);
    sleeve.position.z = 0.85;
    const barrel = cylZ(0.46, 0.56, 3.4, M.main, 18);
    barrel.position.z = 3.3;
    const brakeBody = cylZ(0.64, 0.64, 1.1, M.main, 18);
    brakeBody.position.z = 5.5;
    g.add(sleeve, barrel, brakeBody);
    for (const bz of [5.15, 5.95]) {
      const disc = cylZ(0.9, 0.9, 0.22, M.main, 18);
      disc.position.z = bz;
      g.add(disc);
    }
    P('D5', '주포', g, { pos: [0, 5.85, 2.7], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 26 });
  }

  // ---- D6 방순 (와이드 만틀렛)
  {
    const g = new THREE.Group();
    g.add(chamferBox(3.5, 2.0, 1.0, 0.32, M.main));
    const collar = cylZ(0.78, 0.85, 0.6, M.main, 18);
    collar.position.z = 0.6;
    g.add(collar);
    fastenerRow(g, [-1.4, 0.75, 0.52], [1.4, 0.75, 0.52], 4, 0.13, [0, 0, 1], M.main, 'hex');
    fastenerRow(g, [-1.4, -0.75, 0.52], [1.4, -0.75, 0.52], 4, 0.13, [0, 0, 1], M.main, 'hex');
    const mpeg = assemblyPeg(M.main, 0.22, 0.36);
    mpeg.rotation.x = Math.PI / 2;
    mpeg.position.z = -0.62;
    g.add(mpeg);
    P('D6', '방순', g, { pos: [0, 5.85, 2.55], lieRot: [Math.PI / 2, 0, 0], order: 25 });
  }

  // ---- D7~ 트랙 (링크&렝스 — 평면 파츠, 와이드)
  let idNum = 7;
  {
    let order = 4;
    for (const [side, sx] of [['좌', -1], ['우', 1]]) {
      for (const seg of trackLayout(CIRCLES, 0.45, 1.35)) {
        const mesh = seg.kind === 'length'
          ? trackLengthPiece(seg.len, 2.1, 0.45, M.main, { cleatOut: 0.34, cleatWide: 0.55, grooveMat: M.groove })
          : trackLinkPiece(seg.len, 2.1, 0.45, M.main, { cleatOut: 0.34, cleatWide: 0.55, grooveMat: M.groove });
        P(`D${idNum}`, `${side} 트랙 ${seg.kind === 'length' ? '렝스' : '링크'}`, mesh, {
          pos: [sx * 3.35, seg.pos[1], seg.pos[0]],
          rot: [-seg.theta, 0, 0],
          lieRot: [-Math.PI / 2, Math.PI / 2, 0],
          order: order++,
          runner: 'B',
        });
        idNum++;
      }
    }
  }

  // ---- 로드휠 (겹배열 — 외측/내측 평면 열 파츠로 분할, 연결 탭 + 결합 축 페그)
  for (const [name, sx, order, zs, xo] of [
    ['좌 외측 로드휠', -1, 2, [-3.0, -2.3, 0, 2.3, 3.0], 0.38],
    ['우 외측 로드휠', 1, 3, [-3.0, -2.3, 0, 2.3, 3.0], 0.38],
    ['좌 내측 로드휠', -1, 20, [-1.15, 1.15], -0.38],
    ['우 내측 로드휠', 1, 21, [-1.15, 1.15], -0.38],
  ]) {
    const g = new THREE.Group();
    for (const wz of zs) {
      const end = Math.abs(wz) > 2.9;
      const w = roadWheel(end ? 0.78 : 1.05, 0.6, M.main, M.groove, { bolts: end ? 5 : 8 });
      w.position.set(0, 0, wz);
      g.add(w);
    }
    for (let i = 0; i < zs.length - 1; i++) {
      const tab = chamferBox(0.32, 0.28, 0.5, 0.05, M.main);
      tab.position.set(0, 0, (zs[i] + zs[i + 1]) / 2);
      g.add(tab);
    }
    for (const wz of zs) {
      const peg = assemblyPeg(M.main, 0.15, 0.5);
      peg.rotation.z = Math.PI / 2;
      peg.position.set(sx * -0.45, 0, wz);
      g.add(peg);
    }
    P(`D${idNum}`, name, g, {
      pos: [sx * (3.35 + xo * sx), 1.5, 0],
      lieRot: [0, Math.PI / 2, 0],
      order,
      runner: 'B',
    });
    idNum++;
  }

  // ---- 후면 배기관 (실드 포함 2본)
  {
    const g = new THREE.Group();
    for (const sx of [-1.7, 1.7]) {
      const pipe = cylY(0.5, 0.55, 1.8, M.main, 16);
      pipe.position.set(sx, 0, 0);
      const cap = sphere(0.5, M.main, 12, 8);
      cap.scale.set(1, 0.5, 1);
      cap.position.set(sx, 0.9, 0);
      const shield = chamferBox(1.25, 1.8, 0.2, 0.08, M.main);
      shield.position.set(sx, -0.1, 0.55);
      g.add(pipe, cap, shield);
    }
    P(`D${idNum}`, '배기관', g, { pos: [0, 3.95, -4.35], lieRot: [Math.PI / 2, 0, 0], order: 28, runner: 'B' });
    idNum++;
  }

  // ---- 전면 기관총 볼
  {
    const g = new THREE.Group();
    const ball = sphere(0.5, M.main, 14, 10);
    const stub = cylZ(0.16, 0.16, 0.8, M.main, 8);
    stub.position.z = 0.5;
    g.add(ball, stub);
    P(`D${idNum}`, '전면 기관총', g, { pos: [1.5, 4.0, 4.3], lieRot: [0, 0, 0], order: 29, runner: 'B' });
  }

  return {
    key: 'tiger', label: '티거 I', sub: 'WWII · 독일', color,
    runnerWidths: { A: 22, B: 22 }, parts,
  };
}
