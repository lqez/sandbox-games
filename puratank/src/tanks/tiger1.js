// 티거 I — WWII 독일 중전차. SD 데포르메: 육중한 박스 차체, 대형 편평 포탑,
// 겹배열 로드휠, 머즐브레이크 달린 길쭉한 88mm. 패널라인 + 육각 볼트 과장.
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileX, profileY, tub, cylY, cylZ, sphere,
  panelLine, panelRect, fastenerRow, grooveRing, beltMesh, roadWheel,
  centered, definePart,
} from '../plamo.js';

const CIRCLES = [
  { z: -4.3, y: 1.3, r: 1.3 },
  { z: 4.3, y: 1.3, r: 1.3 },
];

export function buildTiger1() {
  const color = 0x8d99a6; // 저먼 그레이 런너
  const M = makeMats(color);
  const parts = [];
  const P = (id, name, mesh, opts) => parts.push(definePart(id, name, mesh, opts));

  // ---- D1 하부 차체
  {
    const g = tub(5.6, 1.7, 10.2, 0.32, M.main);
    panelLine(g, [-2.81, 0.15, -4.7], [-2.81, 0.15, 4.7], [-1, 0, 0], M.groove);
    panelLine(g, [2.81, 0.15, -4.7], [2.81, 0.15, 4.7], [1, 0, 0], M.groove);
    fastenerRow(g, [-2.81, -0.45, -4.4], [-2.81, -0.45, 4.4], 7, 0.1, [-1, 0, 0], M.main, 'hex');
    fastenerRow(g, [2.81, -0.45, -4.4], [2.81, -0.45, 4.4], 7, 0.1, [1, 0, 0], M.main, 'hex');
    P('D1', '하부 차체', g, { pos: [0, 1.75, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 1 });
  }

  // ---- D2 상부 차체 (박스형 + 수직에 가까운 전면장갑)
  {
    const g = new THREE.Group();
    g.add(profileX(
      [[-5.1, 0], [4.5, 0], [5.15, 0.55], [5.0, 1.7], [-5.1, 1.7]],
      7.6, M.main
    ));
    // 상면: 포탑 링 주변 라인 + 엔진 데크
    panelLine(g, [-2.6, 1.87, 1.2], [2.6, 1.87, 1.2], [0, 1, 0], M.groove);
    panelRect(g, [0, 1.87, -3.0], [1, 0, 0], [0, 0, 1], 1.7, 1.15, [0, 1, 0], M.groove);
    for (const sx of [-1.9, 1.9]) {
      const fan = grooveRing(0.8, 0.06, M.groove, 36);
      fan.position.set(sx, 1.88, -3.0);
      g.add(fan);
      const fan2 = grooveRing(0.45, 0.05, M.groove, 24);
      fan2.position.set(sx, 1.88, -3.0);
      g.add(fan2);
    }
    // 전면 조종수 바이저
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.26, 0.14), M.groove);
    visor.position.set(-1.3, 1.25, 5.24);
    g.add(visor);
    // 전면 상판 볼트
    fastenerRow(g, [-2.6, 1.87, 4.7], [2.6, 1.87, 4.7], 6, 0.1, [0, 1, 0], M.main, 'hex');
    // 펜더 라인
    panelLine(g, [-3.35, 1.87, -4.9], [-3.35, 1.87, 4.8], [0, 1, 0], M.groove);
    panelLine(g, [3.35, 1.87, -4.9], [3.35, 1.87, 4.8], [0, 1, 0], M.groove);
    P('D2', '상부 차체', g, { pos: [0, 2.35, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 6 });
  }

  // ---- D3 포탑 (말굽형 — 오버사이즈)
  {
    const g = new THREE.Group();
    const pts = [[1.6, 1.95], [1.95, 0.9], [1.95, 0.3]];
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      pts.push([1.95 * Math.cos(a), 0.3 - 1.95 * Math.sin(a)]);
    }
    pts.push([-1.95, 0.9], [-1.6, 1.95]);
    const shell = profileY(pts, 2.1, M.main, 0.2);
    shell.position.y = 1.05;
    g.add(shell);
    // 상면: 장전수 해치 + 볼트 + 테두리 라인
    panelRect(g, [0.75, 2.11, -0.55], [1, 0, 0], [0, 0, 1], 0.55, 0.55, [0, 1, 0], M.groove);
    fastenerRow(g, [-1.2, 2.11, 1.15], [1.2, 2.11, 1.15], 4, 0.09, [0, 1, 0], M.main, 'hex');
    panelLine(g, [-1.45, 2.11, 0.9], [-1.45, 2.11, -0.6], [0, 1, 0], M.groove, 0.1);
    panelLine(g, [1.45, 2.11, 0.9], [1.45, 2.11, -0.6], [0, 1, 0], M.groove, 0.1);
    // 측면 탈출 해치 (우측 후방)
    const hatch = cylZ(0.55, 0.6, 0.12, M.main, 18);
    hatch.rotation.y = Math.PI / 2;
    hatch.position.set(2.2, 1.0, -1.2);
    g.add(hatch);
    // 측면 그랩 레일
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 8, 14, Math.PI), M.main);
      rail.position.set(sx * 2.2, 1.3, 0.6);
      rail.rotation.y = sx * Math.PI / 2;
      rail.castShadow = true;
      g.add(rail);
    }
    P('D3', '포탑', g, { pos: [0, 4.05, 0.3], lieRot: [Math.PI / 2, 0, 0], order: 7 });
  }

  // ---- D4 큐폴라 (드럼형)
  {
    const g = new THREE.Group();
    const drum = cylY(0.82, 0.86, 0.8, M.main, 20);
    drum.position.y = 0.4;
    const lid = cylY(0.9, 0.9, 0.18, M.main, 20);
    lid.position.y = 0.85;
    g.add(drum, lid);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.1), M.groove);
      slit.position.set(Math.sin(a) * 0.84, 0.45, Math.cos(a) * 0.84);
      slit.rotation.y = a;
      g.add(slit);
    }
    const knob = sphere(0.16, M.main, 10, 8);
    knob.position.set(0.4, 0.98, 0);
    g.add(knob);
    P('D4', '큐폴라', g, { pos: [-0.95, 6.1, -0.3], lieRot: [Math.PI / 2, 0, 0], order: 10 });
  }

  // ---- D5 주포 (88mm + 머즐브레이크)
  {
    const g = new THREE.Group();
    const sleeve = cylZ(0.42, 0.47, 1.5, M.main, 16);
    sleeve.position.z = 0.75;
    const barrel = cylZ(0.28, 0.36, 4.5, M.main, 16);
    barrel.position.z = 3.7;
    const brakeBody = cylZ(0.42, 0.42, 0.75, M.main, 16);
    brakeBody.position.z = 6.2;
    g.add(sleeve, barrel, brakeBody);
    for (const bz of [5.95, 6.5]) {
      const disc = cylZ(0.58, 0.58, 0.18, M.main, 16);
      disc.position.z = bz;
      g.add(disc);
    }
    P('D5', '주포', g, { pos: [0, 5.1, 2.3], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 9 });
  }

  // ---- D6 방순 (만틀렛)
  {
    const g = new THREE.Group();
    g.add(chamferBox(2.7, 1.5, 0.75, 0.25, M.main));
    const collar = cylZ(0.52, 0.58, 0.5, M.main, 16);
    collar.position.z = 0.45;
    g.add(collar);
    fastenerRow(g, [-1.05, 0.55, 0.39], [1.05, 0.55, 0.39], 4, 0.1, [0, 0, 1], M.main, 'hex');
    fastenerRow(g, [-1.05, -0.55, 0.39], [1.05, -0.55, 0.39], 4, 0.1, [0, 0, 1], M.main, 'hex');
    P('D6', '방순', g, { pos: [0, 5.1, 2.3], lieRot: [Math.PI / 2, 0, 0], order: 8 });
  }

  // ---- D7/D8 트랙 벨트 (와이드)
  for (const [id, name, sx, order] of [['D7', '좌 트랙', -1, 4], ['D8', '우 트랙', 1, 5]]) {
    const belt = beltMesh(CIRCLES, 1.9, 0.4, M.main, M.groove, { cleatCount: 32, cleatWide: 0.42 });
    const { mesh, center } = centered(belt);
    P(id, name, mesh, {
      pos: [sx * 3.55 + center.x, center.y, center.z],
      lieRot: [0, Math.PI / 2, 0],
      order,
    });
  }

  // ---- D9/D10 로드휠 패널 (겹배열 — 안/밖 두 줄 일체 몰드)
  for (const [id, name, sx, order] of [['D9', '좌 로드휠', -1, 2], ['D10', '우 로드휠', 1, 3]]) {
    const g = new THREE.Group();
    for (const wz of [-3.3, -1.1, 1.1, 3.3]) {
      const w = roadWheel(0.9, 0.5, M.main, M.groove, { bolts: 8 });
      w.position.set(sx * 0.3, 0, wz);
      g.add(w);
    }
    for (const wz of [-2.2, 0, 2.2]) {
      const w = roadWheel(0.9, 0.5, M.main, M.groove, { bolts: 8 });
      w.position.set(sx * -0.32, 0, wz);
      g.add(w);
    }
    P(id, name, g, { pos: [sx * 3.55, 1.3, 0], lieRot: [0, Math.PI / 2, 0], order });
  }

  // ---- D11 후면 배기관 (실드 포함 2본)
  {
    const g = new THREE.Group();
    for (const sx of [-1.5, 1.5]) {
      const pipe = cylY(0.36, 0.4, 1.5, M.main, 14);
      pipe.position.set(sx, 0, 0);
      const cap = sphere(0.36, M.main, 12, 8);
      cap.scale.set(1, 0.5, 1);
      cap.position.set(sx, 0.75, 0);
      const shield = chamferBox(1.0, 1.5, 0.18, 0.06, M.main);
      shield.position.set(sx, -0.1, 0.5);
      g.add(pipe, cap, shield);
    }
    P('D11', '배기관', g, { pos: [0, 3.4, -5.2], lieRot: [Math.PI / 2, 0, 0], order: 11 });
  }

  // ---- D12 전면 기관총 볼
  {
    const g = new THREE.Group();
    const ball = sphere(0.4, M.main, 14, 10);
    const stub = cylZ(0.12, 0.12, 0.65, M.main, 8);
    stub.position.z = 0.4;
    g.add(ball, stub);
    P('D12', '전면 기관총', g, { pos: [1.5, 3.5, 5.2], lieRot: [0, 0, 0], order: 12 });
  }

  return { key: 'tiger', label: '티거 I', sub: 'WWII · 독일', color, runnerWidth: 25, parts };
}
