// T-34 — WWII 소련 중형전차. SD 데포르메: 급경사 글래시스, 달걀형 주조 포탑,
// 대형 크리스티 로드휠, 길쭉한 주포. 용접 라인 + 육각 볼트 과장.
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileX, tub, cylY, cylZ, sphere,
  panelLine, panelRect, fastenerRow, grooveRing, beltMesh, roadWheel, wheelHoles,
  centered, definePart,
} from '../plamo.js';

const CIRCLES = [
  { z: -3.9, y: 1.25, r: 1.25 },
  { z: 3.9, y: 1.25, r: 1.25 },
];

export function buildT34() {
  const color = 0x7d9b4e; // 올리브 그린 런너
  const M = makeMats(color);
  const parts = [];
  const P = (id, name, mesh, opts) => parts.push(definePart(id, name, mesh, opts));

  // ---- C1 하부 차체
  {
    const g = tub(5.0, 1.5, 9.6, 0.3, M.main);
    panelLine(g, [-2.51, 0.1, -4.4], [-2.51, 0.1, 4.4], [-1, 0, 0], M.groove);
    panelLine(g, [2.51, 0.1, -4.4], [2.51, 0.1, 4.4], [1, 0, 0], M.groove);
    P('C1', '하부 차체', g, { pos: [0, 1.55, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 1 });
  }

  // ---- C2 상부 차체 (경사장갑 + 오버행 펜더)
  {
    const g = new THREE.Group();
    g.add(profileX(
      [[-5.0, 0], [4.2, 0], [5.05, 0.6], [2.2, 1.95], [-4.0, 1.95], [-5.0, 1.1]],
      6.9, M.main
    ));
    // 글래시스: 용접 라인 + 조종수 해치 + 볼트
    const gn = [0, 0.9, 0.42]; // 글래시스 법선(위+앞)
    panelLine(g, [-3.4, 1.45, 3.6], [3.4, 1.45, 3.6], gn, M.groove);
    panelRect(g, [-1.1, 1.7, 3.07], [1, 0, 0], [0, 0.42, -0.9], 0.8, 0.6, gn, M.groove);
    fastenerRow(g, [-1.75, 1.71, 3.07], [-0.45, 1.71, 3.07], 3, 0.1, gn, M.main, 'hex');
    // 기관총 볼 (우측)
    const mg = sphere(0.42, M.main, 16, 12);
    mg.position.set(1.5, 1.35, 3.42);
    const mgBarrel = cylZ(0.11, 0.11, 0.7, M.main, 8);
    mgBarrel.position.set(1.5, 1.5, 3.75);
    mgBarrel.rotation.x = -0.4;
    g.add(mg, mgBarrel);
    // 전조등 (좌측)
    const lamp = cylZ(0.24, 0.28, 0.3, M.main, 12);
    lamp.position.set(-1.6, 1.62, 3.35);
    lamp.rotation.x = -0.4;
    g.add(lamp);
    // 엔진 데크: 그릴 패널 + 라인
    panelRect(g, [0, 2.13, -2.5], [1, 0, 0], [0, 0, 1], 1.55, 0.95, [0, 1, 0], M.groove);
    for (const lz of [-2.0, -2.5, -3.0]) {
      panelLine(g, [-1.4, 2.13, lz], [1.4, 2.13, lz], [0, 1, 0], M.groove, 0.1);
    }
    panelRect(g, [0, 2.13, -0.6], [1, 0, 0], [0, 0, 1], 1.0, 0.75, [0, 1, 0], M.groove);
    // 펜더 라인
    panelLine(g, [-2.95, 2.13, -3.9], [-2.95, 2.13, 2.0], [0, 1, 0], M.groove);
    panelLine(g, [2.95, 2.13, -3.9], [2.95, 2.13, 2.0], [0, 1, 0], M.groove);
    P('C2', '상부 차체', g, { pos: [0, 2.3, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 6 });
  }

  // ---- C3 포탑 (주조 달걀형 — 오버사이즈)
  {
    const g = new THREE.Group();
    const ring = cylY(1.75, 1.88, 0.5, M.main, 28);
    ring.position.y = 0.25;
    const egg = sphere(1.85, M.main, 30, 20);
    egg.scale.set(1.05, 0.66, 1.25);
    egg.position.y = 1.08;
    g.add(ring, egg);
    // 용접 심 (스케일 맞춘 음각 링)
    const seam = grooveRing(1.86, 0.06, M.groove, 48);
    seam.scale.set(1.05, 1.25, 1);
    seam.position.y = 1.15;
    g.add(seam);
    // 측면 그랩 레일
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 14, Math.PI), M.main);
      rail.position.set(sx * 1.98, 1.15, -0.3);
      rail.rotation.y = sx * Math.PI / 2;
      rail.castShadow = true;
      g.add(rail);
    }
    P('C3', '포탑', g, { pos: [0, 4.15, 0.7], lieRot: [Math.PI / 2, 0, 0], order: 7 });
  }

  // ---- C4 큐폴라
  {
    const g = new THREE.Group();
    const drum = cylY(0.72, 0.78, 0.55, M.main, 20);
    drum.position.y = 0.28;
    const cap = sphere(0.7, M.main, 18, 12);
    cap.scale.set(1, 0.5, 1);
    cap.position.y = 0.55;
    g.add(drum, cap);
    const seam = grooveRing(0.73, 0.045, M.groove);
    seam.position.y = 0.56;
    g.add(seam);
    P('C4', '큐폴라', g, { pos: [-0.85, 6.1, 0.35], lieRot: [Math.PI / 2, 0, 0], order: 9 });
  }

  // ---- C5 장전수 해치
  {
    const g = new THREE.Group();
    const lid = cylY(0.62, 0.66, 0.2, M.main, 18);
    g.add(lid);
    const hinge = chamferBox(0.3, 0.14, 0.5, 0.05, M.main);
    hinge.position.set(0.55, 0.02, 0);
    g.add(hinge);
    fastenerRow(g, [-0.3, 0.11, -0.3], [-0.3, 0.11, 0.3], 2, 0.08, [0, 1, 0], M.main, 'hex');
    P('C5', '장전수 해치', g, { pos: [0.9, 6.28, 0.35], lieRot: [0, 0, 0], order: 10 });
  }

  // ---- C6 주포 (85mm — 길게 과장)
  {
    const g = new THREE.Group();
    const mantlet = chamferBox(1.5, 1.05, 0.9, 0.18, M.main);
    const collar = cylZ(0.45, 0.5, 0.6, M.main, 16);
    collar.position.z = 0.6;
    const barrel = cylZ(0.26, 0.33, 4.4, M.main, 16);
    barrel.position.z = 2.9;
    const tip = cylZ(0.3, 0.3, 0.4, M.main, 16);
    tip.position.z = 5.15;
    g.add(mantlet, collar, barrel, tip);
    fastenerRow(g, [-0.55, 0.4, 0.46], [0.55, 0.4, 0.46], 3, 0.09, [0, 0, 1], M.main, 'hex');
    P('C6', '주포', g, { pos: [0, 5.05, 2.75], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 8 });
  }

  // ---- C7/C8 트랙 벨트
  for (const [id, name, sx, order] of [['C7', '좌 트랙', -1, 4], ['C8', '우 트랙', 1, 5]]) {
    const belt = beltMesh(CIRCLES, 1.5, 0.35, M.main, M.groove, { cleatCount: 30 });
    const { mesh, center } = centered(belt);
    P(id, name, mesh, {
      pos: [sx * 3.2 + center.x, center.y, center.z],
      lieRot: [0, Math.PI / 2, 0],
      order,
    });
  }

  // ---- C9/C10 로드휠 세트 (크리스티 대형 휠 4개 일체 몰드)
  for (const [id, name, sx, order] of [['C9', '좌 로드휠', -1, 2], ['C10', '우 로드휠', 1, 3]]) {
    const g = new THREE.Group();
    const beam = chamferBox(0.5, 0.55, 6.4, 0.1, M.main);
    beam.position.x = sx * -0.45;
    g.add(beam);
    for (const wz of [-2.85, -0.95, 0.95, 2.85]) {
      const w = roadWheel(0.88, 1.15, M.main, M.groove, { bolts: 6 });
      wheelHoles(w, 0.88, 1.15, M.groove, 5);
      w.position.z = wz;
      g.add(w);
    }
    P(id, name, g, { pos: [sx * 3.2, 1.25, 0], lieRot: [0, Math.PI / 2, 0], order });
  }

  // ---- C11/C12 사이드 연료탱크
  for (const [id, name, sx, order] of [['C11', '좌 연료탱크', -1, 11], ['C12', '우 연료탱크', 1, 12]]) {
    const g = new THREE.Group();
    const drumT = cylZ(0.52, 0.52, 1.8, M.main, 18);
    g.add(drumT);
    for (const bz of [-0.5, 0.5]) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.05, 6, 24), M.groove);
      strap.position.z = bz;
      g.add(strap);
    }
    P(id, name, g, { pos: [sx * 3.3, 3.4, -3.4], lieRot: [Math.PI / 2, 0, 0], order });
  }

  // ---- C13 후면 배기
  {
    const g = new THREE.Group();
    const plate = chamferBox(2.3, 1.3, 0.22, 0.08, M.main);
    g.add(plate);
    for (const sx of [-0.62, 0.62]) {
      const pipe = cylZ(0.28, 0.32, 0.55, M.main, 14);
      pipe.position.set(sx, 0, -0.3);
      g.add(pipe);
      const ring = grooveRing(0.3, 0.04, M.groove);
      ring.rotation.x = 0;
      ring.position.set(sx, 0, -0.45);
      g.add(ring);
    }
    fastenerRow(g, [-0.95, 0.5, 0.12], [0.95, 0.5, 0.12], 4, 0.08, [0, 0, 1], M.main, 'hex');
    const e = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0.65, -0.76).normalize()
      )
    );
    P('C13', '후면 배기', g, { pos: [0, 3.9, -4.7], rot: [e.x, e.y, e.z], lieRot: [0, 0, 0], order: 13 });
  }

  return { key: 't34', label: 'T-34', sub: 'WWII · 소련', color, runnerWidth: 24, parts };
}
