// plamo.js — SD 플라모델 스타일 파츠 빌더 헬퍼
// 모든 파츠는 "사출 성형된 플라스틱" 느낌을 목표로 한다:
//  - 모서리는 챔퍼(면취) 처리
//  - 판재는 두께가 보이는 쉘 구조
//  - 패널라인은 과장된 음각(어두운 셰이드 라인), 볼트/리벳은 오버사이즈 돌출
import * as THREE from 'three';

// ---------------------------------------------------------------- materials
export function plasticMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.0,
  });
}

// 패널라인용: 같은 색상 계열의 어두운 셰이드 (음각 그림자 표현)
export function grooveMaterial(color) {
  const c = new THREE.Color(color).multiplyScalar(0.42);
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.0 });
}

export function makeMats(color) {
  return { main: plasticMaterial(color), groove: grooveMaterial(color) };
}

// ---------------------------------------------------------------- primitives

// 챔퍼(면취) 박스: w×h×d, 모서리 chamfer. 중심 원점.
export function chamferBox(w, h, d, ch, mat) {
  ch = Math.min(ch, w / 2.2, h / 2.2, d / 2.2);
  const shape = roundedRectShape(w - ch * 2, h - ch * 2, ch * 0.5);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d - ch * 2,
    bevelEnabled: true,
    bevelThickness: ch,
    bevelSize: ch,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.translate(0, 0, -(d - ch * 2) / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw, hh);
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - r);
  s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hw + r, hh);
  s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + r);
  s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

// 측면 프로파일(z,y 점 목록)을 X축 방향(폭 w)으로 압출. 경사 글래시스 등에 사용.
// points: [[z,y], ...] 반시계 방향. 중심은 호출자가 점 좌표로 제어.
export function profileX(points, w, mat, bevel = 0.16) {
  const shape = new THREE.Shape();
  shape.moveTo(-points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(-points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, w - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.rotateY(Math.PI / 2);
  geo.translate(-(w - bevel * 2) / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// 상면 프로파일(x,z 점 목록)을 Y축 방향(높이 h)으로 압출 — 포탑 등 상면 형상용.
export function profileY(points, h, mat, bevel = 0.18) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], -points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], -points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, h - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  geo.rotateX(-Math.PI / 2); // shape +z(압출방향) → +y … shape y → -z
  geo.translate(0, -(h - bevel * 2) / 2 - bevel, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// 열린 상자(쉘 구조, 위가 뚫린 욕조형) — 사출 파츠의 판 두께(t)가 보인다.
export function tub(w, h, d, t, mat, ch = 0.14) {
  const g = new THREE.Group();
  const bottom = chamferBox(w, t, d, ch, mat);
  bottom.position.y = -h / 2 + t / 2;
  const front = chamferBox(w, h - t, t, ch, mat);
  front.position.set(0, t / 2, d / 2 - t / 2);
  const back = front.clone();
  back.position.z = -d / 2 + t / 2;
  const left = chamferBox(t, h - t, d - t * 2, ch, mat);
  left.position.set(-w / 2 + t / 2, t / 2, 0);
  const right = left.clone();
  right.position.x = w / 2 - t / 2;
  g.add(bottom, front, back, left, right);
  return g;
}

export function cylX(r1, r2, len, mat, seg = 24) {
  const geo = new THREE.CylinderGeometry(r1, r2, len, seg);
  geo.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
export function cylY(r1, r2, len, mat, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
export function cylZ(r1, r2, len, mat, seg = 24) {
  const geo = new THREE.CylinderGeometry(r1, r2, len, seg);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function sphere(r, mat, wSeg = 24, hSeg = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, wSeg, hSeg), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- details

const UP = new THREE.Vector3(0, 1, 0);

// 과장된 패널라인: from→to 를 잇는 어두운 음각 라인. normal = 표면 바깥 방향.
export function panelLine(parent, from, to, normal, grooveMat, width = 0.13) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const n = new THREE.Vector3(...normal).normalize();
  const len = a.distanceTo(b);
  const geo = new THREE.BoxGeometry(width, 0.09, len + width);
  const mesh = new THREE.Mesh(geo, grooveMat);
  const mid = a.clone().add(b).multiplyScalar(0.5).addScaledVector(n, 0.012);
  mesh.position.copy(mid);
  // 라인의 z축을 (b-a) 방향으로, y축을 normal 방향으로.
  const dir = b.clone().sub(a).normalize();
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3().crossVectors(n, dir).normalize();
  m.makeBasis(x, n, dir);
  mesh.quaternion.setFromRotationMatrix(m);
  parent.add(mesh);
  return mesh;
}

// 표면 위 사각 음각 프레임(해치/그릴 테두리 등)
export function panelRect(parent, center, u, v, halfU, halfV, normal, grooveMat, width = 0.13) {
  const c = new THREE.Vector3(...center);
  const U = new THREE.Vector3(...u).normalize(), V = new THREE.Vector3(...v).normalize();
  const p = (du, dv) => c.clone().addScaledVector(U, du).addScaledVector(V, dv).toArray();
  panelLine(parent, p(-halfU, -halfV), p(halfU, -halfV), normal, grooveMat, width);
  panelLine(parent, p(halfU, -halfV), p(halfU, halfV), normal, grooveMat, width);
  panelLine(parent, p(halfU, halfV), p(-halfU, halfV), normal, grooveMat, width);
  panelLine(parent, p(-halfU, halfV), p(-halfU, -halfV), normal, grooveMat, width);
}

// 오버사이즈 육각 볼트
export function hexBolt(r, h, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 6), mat);
  m.castShadow = true;
  return m;
}
// 돔 리벳 (1차대전 스타일)
export function domeRivet(r, mat) {
  const geo = new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

// from→to 표면 위에 볼트/리벳을 count개 배치. normal = 표면 바깥 방향.
export function fastenerRow(parent, from, to, count, r, normal, mat, type = 'rivet') {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const n = new THREE.Vector3(...normal).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, n);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const p = a.clone().lerp(b, t);
    let f;
    if (type === 'hex') {
      f = hexBolt(r, r * 1.1, mat);
      p.addScaledVector(n, r * 0.4);
    } else {
      f = domeRivet(r, mat);
    }
    f.position.copy(p);
    f.quaternion.copy(q);
    parent.add(f);
  }
}

// 어두운 링(포탑 돔 등 곡면용 패널라인)
export function grooveRing(r, tube, mat, seg = 40) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, seg), mat);
  m.rotation.x = Math.PI / 2;
  return m;
}

// ---------------------------------------------------------------- 트랙(궤도)

// circles: [{z, y, r}] — 측면(z-y 평면)에서 벨트가 감싸는 바퀴 원들(진행 순서대로, 볼록 배치).
// 바깥 윤곽 + 안쪽(두께 t) 윤곽으로 링을 만들어 폭 w 만큼 X축 방향 압출.
function beltPoints(circles, inset) {
  const pts = [];
  const n = circles.length;
  const arcs = [];
  for (let i = 0; i < n; i++) {
    const c1 = circles[i], c2 = circles[(i + 1) % n];
    const dz = c2.z - c1.z, dy = c2.y - c1.y;
    const L = Math.hypot(dz, dy);
    const base = Math.atan2(dy, dz);
    const r1 = c1.r - inset, r2 = c2.r - inset;
    const alpha = Math.acos(Math.min(1, Math.max(-1, (r1 - r2) / L)));
    const ang = base - alpha;
    arcs.push({ i, j: (i + 1) % n, a1: ang, r1, r2 });
  }
  // 각 원에서 도착 탄젠트각 → 출발 탄젠트각까지 호를 샘플링 (진행방향과 일치하도록 감소/증가 선택)
  for (let i = 0; i < n; i++) {
    const cur = circles[i];
    const prev = arcs[(i - 1 + n) % n]; // 이 원으로 들어오는 탄젠트
    const next = arcs[i]; // 이 원에서 나가는 탄젠트
    const r = cur.r - inset;
    let aIn = prev.a1, aOut = next.a1;
    // 바깥 벨트: 원을 시계/반시계 중 짧은 쪽이 아니라 바깥쪽으로 감아야 함.
    // 원들을 반시계(CCW) 순서로 줄 때 바깥 호는 aIn에서 aOut로 CCW(증가) 진행.
    while (aOut < aIn) aOut += Math.PI * 2;
    const steps = Math.max(2, Math.ceil((aOut - aIn) / 0.22));
    for (let k = 0; k <= steps; k++) {
      const a = aIn + ((aOut - aIn) * k) / steps;
      pts.push(new THREE.Vector2(cur.z + r * Math.cos(a), cur.y + r * Math.sin(a)));
    }
  }
  return pts;
}

export function beltMesh(circles, w, t, mat, grooveMat, opts = {}) {
  const cleatCount = opts.cleatCount ?? 22;
  const cleatOut = opts.cleatOut ?? 0.22;
  const outer = beltPoints(circles, 0);
  const inner = beltPoints(circles, t).reverse();
  const shape = new THREE.Shape();
  shape.setFromPoints(outer.map((p) => new THREE.Vector2(-p.x, p.y)));
  const hole = new THREE.Path();
  hole.setFromPoints(inner.map((p) => new THREE.Vector2(-p.x, p.y)));
  shape.holes.push(hole);
  const bevel = 0.1;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: w - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.rotateY(Math.PI / 2);
  geo.translate(-(w - bevel * 2) / 2, 0, 0);
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);

  // 클리트(트랙 슈): 바깥 윤곽을 따라 통통한 블록을 균등 배치 — 옆으로 살짝 튀어나와 청키한 맛
  const lens = [0];
  for (let i = 1; i < outer.length; i++) lens.push(lens[i - 1] + outer[i].distanceTo(outer[i - 1]));
  const total = lens[lens.length - 1];
  for (let i = 0; i < cleatCount; i++) {
    const target = (total * i) / cleatCount;
    let k = 1;
    while (k < lens.length - 1 && lens[k] < target) k++;
    const t01 = (target - lens[k - 1]) / Math.max(1e-6, lens[k] - lens[k - 1]);
    const p = outer[k - 1].clone().lerp(outer[k], t01);
    const dir = outer[k].clone().sub(outer[k - 1]).normalize();
    const cleat = new THREE.Mesh(
      new THREE.BoxGeometry(w + (opts.cleatWide ?? 0.34), cleatOut + 0.16, total / cleatCount * 0.46),
      mat
    );
    cleat.castShadow = true;
    // dir(z,y평면의 접선)과 법선(바깥) 계산
    const normal = new THREE.Vector2(dir.y, -dir.x); // 시계 회전 → CCW 윤곽의 바깥
    cleat.position.set(0, p.y + normal.y * (cleatOut * 0.25), p.x + normal.x * (cleatOut * 0.25));
    cleat.rotation.x = -Math.atan2(dir.y, dir.x);
    g.add(cleat);
  }
  return g;
}

// 벨트 윤곽을 그대로 채운 슬래브(마름모 트랙 프레임 등) — Mark IV 사이드 프레임용
export function beltSolid(circles, inset, w, mat, bevel = 0.16) {
  const pts = beltPoints(circles, inset);
  const shape = new THREE.Shape();
  shape.setFromPoints(pts.map((p) => new THREE.Vector2(-p.x, p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, w - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.rotateY(Math.PI / 2);
  geo.translate(-(w - bevel * 2) / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// 벨트 윤곽 점 목록(z,y) — 윤곽을 따라 리벳 등을 배치할 때 사용
export function beltOutlinePoints(circles, inset, spacing) {
  const pts = beltPoints(circles, inset);
  const out = [];
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = lens[lens.length - 1];
  const count = Math.floor(total / spacing);
  for (let i = 0; i < count; i++) {
    const target = (total * i) / count;
    let k = 1;
    while (k < lens.length - 1 && lens[k] < target) k++;
    const t = (target - lens[k - 1]) / Math.max(1e-6, lens[k] - lens[k - 1]);
    out.push(pts[k - 1].clone().lerp(pts[k], t)); // Vector2(x=z, y=y)
  }
  return out;
}

// ---------------------------------------------------------------- 링크&렝스 궤도
// 실킷 방식: 직선 "렝스"와 개별 "링크"가 런너에 평면으로 눕고,
// 곡선부는 조립 시 링크가 각도를 나눠 다각형으로 바퀴를 감싼다.

// 궤도 경로 분해: circles(CCW)에서 직선 런과 원호(링크 분할) 세그먼트 목록 생성.
// 반환: [{ kind:'length'|'link', len, pos:[z,y], theta }] — theta = 진행 방향 각도(z-y 평면)
export function trackLayout(circles, t, linkLen = 1.15) {
  const n = circles.length;
  const tang = [];
  for (let i = 0; i < n; i++) {
    const c1 = circles[i], c2 = circles[(i + 1) % n];
    const L = Math.hypot(c2.z - c1.z, c2.y - c1.y);
    const base = Math.atan2(c2.y - c1.y, c2.z - c1.z);
    tang.push(base - Math.acos(Math.min(1, Math.max(-1, (c1.r - c2.r) / L))));
  }
  const segs = [];
  for (let i = 0; i < n; i++) {
    const cur = circles[i], nxt = circles[(i + 1) % n];
    // 원호 → 링크들 (다각형 페이싯)
    let aIn = tang[(i - 1 + n) % n], aOut = tang[i];
    while (aOut < aIn) aOut += Math.PI * 2;
    const rc = cur.r - t / 2;
    const arcLen = (aOut - aIn) * rc;
    const m = Math.max(1, Math.round(arcLen / linkLen));
    for (let k = 0; k < m; k++) {
      const aMid = aIn + ((k + 0.5) / m) * (aOut - aIn);
      const chord = 2 * rc * Math.sin((aOut - aIn) / (2 * m));
      segs.push({
        kind: 'link',
        len: chord,
        pos: [cur.z + rc * Math.cos(aMid), cur.y + rc * Math.sin(aMid)],
        theta: aMid + Math.PI / 2,
      });
    }
    // 직선 런 → 렝스 1피스
    const p1 = [cur.z + rc * Math.cos(tang[i]), cur.y + rc * Math.sin(tang[i])];
    const rc2 = nxt.r - t / 2;
    const p2 = [nxt.z + rc2 * Math.cos(tang[i]), nxt.y + rc2 * Math.sin(tang[i])];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    segs.push({
      kind: 'length',
      len,
      pos: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2],
      theta: Math.atan2(p2[1] - p1[1], p2[0] - p1[0]),
    });
  }
  return segs;
}

// 트랙 밴드 피스 공통: 베이스 밴드(z 방향 len) + 클리트(-y) + 가이드 스터드(+y) + 연결 탭(±z)
function trackBand(len, w, t, mat, cleatCount, opts = {}) {
  const g = new THREE.Group();
  const base = chamferBox(w, t, len, Math.min(0.08, t * 0.3), mat);
  g.add(base);
  const cleatOut = opts.cleatOut ?? 0.3;
  const cleatWide = opts.cleatWide ?? 0.44;
  for (let i = 0; i < cleatCount; i++) {
    const z = cleatCount === 1 ? 0 : -len / 2 + ((i + 0.5) / cleatCount) * len;
    const cleat = new THREE.Mesh(
      new THREE.BoxGeometry(w + cleatWide, cleatOut, Math.min(0.34, len * 0.42)),
      mat
    );
    cleat.castShadow = true;
    cleat.position.set(0, -t / 2 - cleatOut / 2 + 0.06, z);
    g.add(cleat);
    // 가이드 스터드 (안쪽면)
    const stud = new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, 0.16, 0.22), mat);
    stud.position.set(0, t / 2 + 0.07, z);
    g.add(stud);
  }
  // 연결 탭: +z 끝에 수 페그, -z 끝은 소켓 블록
  const peg = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, t * 0.55, 0.3), mat);
  peg.position.set(0, 0, len / 2 + 0.13);
  g.add(peg);
  return g;
}

// 직선 렝스 (여러 슈가 이어진 평면 파츠)
export function trackLengthPiece(len, w, t, mat, opts = {}) {
  return trackBand(len, w, t, mat, Math.max(2, Math.round(len / 0.6)), opts);
}
// 개별 링크 (슈 1~2개) — 다각형 이음새가 벌어지지 않게 약간 겹치는 길이로
export function trackLinkPiece(len, w, t, mat, opts = {}) {
  const l = len * 1.16;
  return trackBand(l, w, t, mat, Math.max(1, Math.round(l / 0.62)), opts);
}

// ---------------------------------------------------------------- 회전체 쉘
// (r,y) 프로파일(바닥→정점, r은 0으로 끝남)을 두께 t의 쉘로 회전 —
// 바닥이 뚫려 있어 런너 위에서 캐비티와 판 두께가 보인다 (사출 파츠 느낌).
export function revolveShell(profile, t, mat, seg = 40) {
  const pts = [];
  for (const [r, y] of profile) pts.push(new THREE.Vector2(r, y));
  const inner = [];
  for (const [r, y] of profile) {
    if (r > t * 1.2) inner.push(new THREE.Vector2(r - t, y));
    else inner.push(new THREE.Vector2(Math.max(0.001, r * 0.5), y - t));
  }
  inner.reverse();
  pts.push(...inner);
  pts.push(new THREE.Vector2(profile[0][0], profile[0][1])); // 바닥 림 닫기
  const geo = new THREE.LatheGeometry(pts, seg);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// 로드휠: 축이 X방향인 통통한 바퀴 + 허브캡 + 육각 볼트 링
export function roadWheel(r, w, mat, grooveMat, opts = {}) {
  const g = new THREE.Group();
  const tire = cylX(r, r, w, mat, 28);
  g.add(tire);
  // 타이어 홈(음각 링)
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(r * 0.82, 0.05, 6, 32), grooveMat);
  ring1.rotation.y = Math.PI / 2;
  ring1.position.x = w / 2 + 0.005;
  g.add(ring1);
  const hub = cylX(r * 0.34, r * 0.34, w + r * 0.26, mat, 16);
  g.add(hub);
  const bolts = opts.bolts ?? 6;
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * Math.PI * 2;
    const b = hexBolt(r * 0.1, r * 0.1, mat);
    b.rotation.z = Math.PI / 2;
    b.position.set(w / 2 + 0.03, Math.sin(a) * r * 0.58, Math.cos(a) * r * 0.58);
    g.add(b);
  }
  return g;
}

// 로드휠 경량화 홀(어두운 원형 음각) — T-34 크리스티 휠 등
export function wheelHoles(wheelGroup, r, w, grooveMat, count = 5) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.3;
    const hole = cylX(r * 0.16, r * 0.16, 0.06, grooveMat, 12);
    hole.position.set(w / 2 + 0.02, Math.sin(a) * r * 0.58, Math.cos(a) * r * 0.58);
    wheelGroup.add(hole);
  }
}

// 오브젝트의 bbox 중심을 원점으로 재배치. { mesh, center } 반환 —
// 조립 위치 = center + 원하는 오프셋으로 계산하면 회전 피벗이 파츠 중심이 된다.
export function centered(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.sub(c);
  const g = new THREE.Group();
  g.add(obj);
  return { mesh: g, center: c };
}

// ---------------------------------------------------------------- part 등록 헬퍼
export function definePart(id, name, mesh, opts) {
  return {
    id,
    name,
    mesh,
    // 소속 런너 (A/B)
    runner: opts.runner ?? 'A',
    // 런너 위에 눕히는 회전 (기본: 그대로)
    lieRot: opts.lieRot ?? [0, 0, 0],
    // 완성 시 로컬 트랜스폼
    assembled: { pos: opts.pos ?? [0, 0, 0], rot: opts.rot ?? [0, 0, 0] },
    order: opts.order ?? 0,
  };
}
