// 티거 I — WWII 독일 중전차. 강데포르메(WWT/메탈슬러그풍):
// 짧고 육중한 박스 차체, 거대한 말굽 포탑 + 드럼 큐폴라,
// 초대형 머즐브레이크 88mm. 궤도는 링크&렝스 평면 파츠 2피스/측.
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileX, profileY, tub, cylY, cylZ, sphere,
  panelLine, panelRect, fastenerRow, grooveRing, trackPieces, roadWheel,
  centered, definePart,
} from '../plamo.js';

const CIRCLES = [
  { z: -3.0, y: 1.6, r: 1.6 },
  { z: 3.0, y: 1.6, r: 1.6 },
];
const PIECE_NAMES = ['후부', '전부'];

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
    P('D2', '상부 차체', g, { pos: [0, 2.7, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 8 });
  }

  // ---- D3 포탑 (말굽형 — 거대)
  {
    const g = new THREE.Group();
    const pts = [[2.15, 2.4], [2.6, 1.2], [2.6, 0.3]];
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      pts.push([2.6 * Math.cos(a), 0.3 - 2.6 * Math.sin(a)]);
    }
    pts.push([-2.6, 1.2], [-2.15, 2.4]);
    const shell = profileY(pts, 2.4, M.main, 0.25);
    shell.position.y = 1.2;
    g.add(shell);
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
    P('D3', '포탑', g, { pos: [0, 4.7, 0.1], lieRot: [Math.PI / 2, 0, 0], order: 9 });
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
    P('D4', '큐폴라', g, { pos: [-1.15, 7.05, -0.5], lieRot: [Math.PI / 2, 0, 0], order: 12, runner: 'B' });
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
    P('D5', '주포', g, { pos: [0, 5.85, 2.7], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 11 });
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
    P('D6', '방순', g, { pos: [0, 5.85, 2.55], lieRot: [Math.PI / 2, 0, 0], order: 10 });
  }

  // ---- D7~D10 트랙 (링크&렝스 2피스/측 — 와이드)
  {
    let idNum = 7, order = 4;
    for (const [side, sx] of [['좌', -1], ['우', 1]]) {
      const pieces = trackPieces(CIRCLES, 2.1, 0.45, M.main, { cleatOut: 0.36, cleatWide: 0.55 });
      pieces.forEach((piece, i) => {
        const { mesh, center } = centered(piece);
        P(`D${idNum}`, `${side} 트랙 ${PIECE_NAMES[i]}`, mesh, {
          pos: [sx * 3.35 + center.x, center.y, center.z],
          lieRot: [0, Math.PI / 2, 0],
          order: order++,
          runner: 'B',
        });
        idNum++;
      });
    }
  }

  // ---- D11/D12 로드휠 패널 (겹배열 3+2 일체 몰드)
  for (const [id, name, sx, order] of [['D11', '좌 로드휠', -1, 2], ['D12', '우 로드휠', 1, 3]]) {
    const g = new THREE.Group();
    for (const wz of [-2.3, 0, 2.3]) {
      const w = roadWheel(1.15, 0.62, M.main, M.groove, { bolts: 8 });
      w.position.set(sx * 0.38, 0, wz);
      g.add(w);
    }
    for (const wz of [-1.15, 1.15]) {
      const w = roadWheel(1.15, 0.62, M.main, M.groove, { bolts: 8 });
      w.position.set(sx * -0.38, 0, wz);
      g.add(w);
    }
    P(id, name, g, { pos: [sx * 3.35, 1.6, 0], lieRot: [0, Math.PI / 2, 0], order, runner: 'B' });
  }

  // ---- D13 후면 배기관 (실드 포함 2본)
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
    P('D13', '배기관', g, { pos: [0, 3.95, -4.35], lieRot: [Math.PI / 2, 0, 0], order: 13, runner: 'B' });
  }

  // ---- D14 전면 기관총 볼
  {
    const g = new THREE.Group();
    const ball = sphere(0.5, M.main, 14, 10);
    const stub = cylZ(0.16, 0.16, 0.8, M.main, 8);
    stub.position.z = 0.5;
    g.add(ball, stub);
    P('D14', '전면 기관총', g, { pos: [1.5, 4.0, 4.3], lieRot: [0, 0, 0], order: 14, runner: 'B' });
  }

  return {
    key: 'tiger', label: '티거 I', sub: 'WWII · 독일', color,
    runnerWidths: { A: 22, B: 20 }, parts,
  };
}
