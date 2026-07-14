// T-34 — WWII 소련 중형전차. 강데포르메(WWT/메탈슬러그풍):
// 짧은 차체 + 차체 길이의 2/3를 차지하는 달걀 포탑, 거대 크리스티 휠 3개,
// 뚱뚱한 주포. 궤도는 링크&렝스 평면 파츠 2피스/측.
import * as THREE from 'three';
import {
  makeMats, chamferBox, profileX, tub, cylY, cylZ, sphere,
  panelLine, panelRect, fastenerRow, grooveRing, revolveShell,
  trackLayout, trackLengthPiece, trackLinkPiece, roadWheel, wheelHoles, definePart,
} from '../plamo.js';

const CIRCLES = [
  { z: -2.75, y: 1.35, r: 1.35 },
  { z: 2.75, y: 1.35, r: 1.35 },
];

export function buildT34() {
  const color = 0x7d9b4e; // 올리브 그린 런너
  const M = makeMats(color);
  const parts = [];
  const P = (id, name, mesh, opts) => parts.push(definePart(id, name, mesh, opts));

  // ---- C1 하부 차체
  {
    const g = tub(4.6, 1.7, 7.6, 0.32, M.main);
    panelLine(g, [-2.31, 0.15, -3.5], [-2.31, 0.15, 3.5], [-1, 0, 0], M.groove, 0.15);
    panelLine(g, [2.31, 0.15, -3.5], [2.31, 0.15, 3.5], [1, 0, 0], M.groove, 0.15);
    P('C1', '하부 차체', g, { pos: [0, 1.75, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 1 });
  }

  // ---- C2 상부 차체 (급경사 글래시스 + 오버행 펜더)
  {
    const g = new THREE.Group();
    g.add(profileX(
      [[-3.8, 0], [2.8, 0], [3.8, 0.75], [1.3, 2.2], [-3.0, 2.2], [-3.8, 1.25]],
      6.6, M.main, 0.22
    ));
    // 글래시스 (법선 위+앞)
    const gn = [0, 0.86, 0.5];
    panelLine(g, [-3.2, 1.68, 2.16], [3.2, 1.68, 2.16], gn, M.groove, 0.16);
    panelRect(g, [-1.0, 2.0, 1.62], [1, 0, 0], [0, 0.5, -0.86], 0.75, 0.62, gn, M.groove, 0.15);
    fastenerRow(g, [-1.62, 2.01, 1.63], [-0.38, 2.01, 1.63], 3, 0.13, gn, M.main, 'hex');
    const mg = sphere(0.5, M.main, 16, 12);
    mg.position.set(1.35, 1.4, 2.4);
    const mgBarrel = cylZ(0.15, 0.15, 0.85, M.main, 8);
    mgBarrel.position.set(1.35, 1.6, 2.8);
    mgBarrel.rotation.x = -0.45;
    g.add(mg, mgBarrel);
    const lamp = cylZ(0.3, 0.35, 0.35, M.main, 12);
    lamp.position.set(-1.5, 1.72, 2.15);
    lamp.rotation.x = -0.45;
    g.add(lamp);
    // 엔진 데크
    panelRect(g, [0, 2.43, -1.9], [1, 0, 0], [0, 0, 1], 1.45, 0.75, [0, 1, 0], M.groove, 0.15);
    for (const lz of [-1.55, -1.9, -2.25]) {
      panelLine(g, [-1.3, 2.43, lz], [1.3, 2.43, lz], [0, 1, 0], M.groove, 0.12);
    }
    panelRect(g, [0, 2.43, -0.35], [1, 0, 0], [0, 0, 1], 0.9, 0.55, [0, 1, 0], M.groove, 0.15);
    panelLine(g, [-2.85, 2.43, -2.9], [-2.85, 2.43, 1.2], [0, 1, 0], M.groove, 0.14);
    panelLine(g, [2.85, 2.43, -2.9], [2.85, 2.43, 1.2], [0, 1, 0], M.groove, 0.14);
    P('C2', '상부 차체', g, { pos: [0, 2.5, 0], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 22 });
  }

  // ---- C3 포탑 (주조 달걀형 — 바닥 뚫린 회전체 쉘)
  {
    const g = new THREE.Group();
    const d2r = Math.PI / 180;
    const prof = [[2.15, 0], [2.15, 0.4], [2.02, 0.5]];
    for (let a = 8; a <= 90; a += 8) {
      prof.push([2.02 * Math.cos(a * d2r), 0.5 + 1.35 * Math.sin(a * d2r)]);
    }
    const shell = revolveShell(prof, 0.28, M.main, 40);
    shell.scale.set(1.05, 1, 1.2);
    g.add(shell);
    const seam = grooveRing(2.04, 0.07, M.groove, 52);
    seam.scale.set(1.05, 1.2, 1);
    seam.position.y = 0.95;
    g.add(seam);
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 8, 14, Math.PI), M.main);
      rail.position.set(sx * 2.14, 0.95, -0.4);
      rail.rotation.y = sx * Math.PI / 2;
      rail.castShadow = true;
      g.add(rail);
    }
    P('C3', '포탑', g, { pos: [0, 4.5, 0.45], lieRot: [Math.PI / 2, 0, 0], order: 24 });
  }

  // ---- C4 큐폴라
  {
    const g = new THREE.Group();
    const drum = cylY(0.85, 0.92, 0.6, M.main, 20);
    drum.position.y = 0.3;
    const cap = sphere(0.82, M.main, 18, 12);
    cap.scale.set(1, 0.5, 1);
    cap.position.y = 0.6;
    g.add(drum, cap);
    const seam = grooveRing(0.86, 0.055, M.groove);
    seam.position.y = 0.62;
    g.add(seam);
    P('C4', '큐폴라', g, { pos: [-0.95, 6.12, 0.1], lieRot: [Math.PI / 2, 0, 0], order: 26, runner: 'B' });
  }

  // ---- C5 장전수 해치
  {
    const g = new THREE.Group();
    const lid = cylY(0.72, 0.78, 0.22, M.main, 18);
    g.add(lid);
    const hinge = chamferBox(0.34, 0.16, 0.6, 0.06, M.main);
    hinge.position.set(0.62, 0.02, 0);
    g.add(hinge);
    fastenerRow(g, [-0.35, 0.12, -0.32], [-0.35, 0.12, 0.32], 2, 0.1, [0, 1, 0], M.main, 'hex');
    P('C5', '장전수 해치', g, { pos: [1.0, 6.16, 0.1], lieRot: [0, 0, 0], order: 27, runner: 'B' });
  }

  // ---- C6 주포 (85mm — 뚱뚱+길게)
  {
    const g = new THREE.Group();
    const mantlet = chamferBox(1.9, 1.4, 1.0, 0.25, M.main);
    const collar = cylZ(0.62, 0.68, 0.7, M.main, 18);
    collar.position.z = 0.7;
    const barrel = cylZ(0.36, 0.44, 3.2, M.main, 18);
    barrel.position.z = 2.5;
    const tip = cylZ(0.5, 0.5, 0.55, M.main, 18);
    tip.position.z = 4.2;
    g.add(mantlet, collar, barrel, tip);
    fastenerRow(g, [-0.7, 0.55, 0.51], [0.7, 0.55, 0.51], 3, 0.12, [0, 0, 1], M.main, 'hex');
    P('C6', '주포', g, { pos: [0, 5.4, 2.45], lieRot: [Math.PI / 2, Math.PI / 2, 0], order: 25 });
  }

  // ---- C7~ 트랙 (링크&렝스 — 평면 파츠)
  let idNum = 7;
  {
    let order = 4;
    for (const [side, sx] of [['좌', -1], ['우', 1]]) {
      for (const seg of trackLayout(CIRCLES, 0.42, 1.2)) {
        const mesh = seg.kind === 'length'
          ? trackLengthPiece(seg.len, 1.7, 0.42, M.main, { cleatOut: 0.32 })
          : trackLinkPiece(seg.len, 1.7, 0.42, M.main, { cleatOut: 0.32 });
        P(`C${idNum}`, `${side} 트랙 ${seg.kind === 'length' ? '렝스' : '링크'}`, mesh, {
          pos: [sx * 3.05, seg.pos[1], seg.pos[0]],
          rot: [-seg.theta, 0, 0],
          lieRot: [-Math.PI / 2, Math.PI / 2, 0],
          order: order++,
          runner: 'B',
        });
        idNum++;
      }
    }
  }

  // ---- 로드휠 세트 (크리스티 휠 3개 — 평면 일렬 + 보이는 연결 탭)
  for (const [name, sx, order] of [['좌 로드휠', -1, 2], ['우 로드휠', 1, 3]]) {
    const g = new THREE.Group();
    for (const wz of [-2.15, 0, 2.15]) {
      const w = roadWheel(0.98, 1.3, M.main, M.groove, { bolts: 6 });
      wheelHoles(w, 0.98, 1.3, M.groove, 5);
      w.position.z = wz;
      g.add(w);
    }
    for (const wz of [-2.75, 2.75]) {
      const w = roadWheel(0.72, 1.0, M.main, M.groove, { bolts: 5 });
      w.position.set(0, 0, wz);
      g.add(w);
    }
    for (const tz of [-1.08, 1.08, -2.5, 2.5]) {
      const tab = chamferBox(0.34, 0.3, 0.44, 0.06, M.main);
      tab.position.set(0, 0, tz);
      g.add(tab);
    }
    P(`C${idNum}`, name, g, { pos: [sx * 3.05, 1.35, 0], lieRot: [0, Math.PI / 2, 0], order, runner: 'B' });
    idNum++;
  }

  // ---- 사이드 연료탱크
  for (const [name, sx, order] of [['좌 연료탱크', -1, 28], ['우 연료탱크', 1, 29]]) {
    const g = new THREE.Group();
    const drumT = cylZ(0.62, 0.62, 2.0, M.main, 18);
    g.add(drumT);
    for (const bz of [-0.55, 0.55]) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.06, 6, 24), M.groove);
      strap.position.z = bz;
      g.add(strap);
    }
    P(`C${idNum}`, name, g, { pos: [sx * 3.1, 3.6, -2.0], lieRot: [Math.PI / 2, 0, 0], order, runner: 'B' });
    idNum++;
  }

  // ---- 후면 배기
  {
    const g = new THREE.Group();
    const plate = chamferBox(2.4, 1.4, 0.26, 0.1, M.main);
    g.add(plate);
    for (const sx of [-0.65, 0.65]) {
      const pipe = cylZ(0.34, 0.38, 0.6, M.main, 14);
      pipe.position.set(sx, 0, -0.35);
      g.add(pipe);
      const ring = grooveRing(0.36, 0.05, M.groove);
      ring.rotation.x = 0;
      ring.position.set(sx, 0, -0.52);
      g.add(ring);
    }
    fastenerRow(g, [-1.0, 0.55, 0.14], [1.0, 0.55, 0.14], 4, 0.1, [0, 0, 1], M.main, 'hex');
    const e = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0.64, -0.76).normalize()
      )
    );
    P(`C${idNum}`, '후면 배기', g, { pos: [0, 4.44, -3.66], rot: [e.x, e.y, e.z], lieRot: [0, 0, 0], order: 30, runner: 'B' });
  }

  return {
    key: 't34', label: 'T-34', sub: 'WWII · 소련', color,
    runnerWidths: { A: 20, B: 22 }, parts,
  };
}
