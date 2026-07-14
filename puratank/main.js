// PURATANK — SD 플라모델 스타일 턴제 탱크 게임
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------
const GRID = 10;          // 10x10 보드
const TILE = 2;           // 한 칸의 월드 크기
const TILE_TOP = 0.2;     // 타일 윗면 높이

const PLAYER_STATS = { hp: 120, moveRange: 3, fireRange: 4, damage: 40 };
const ENEMY_STATS  = { hp: 80,  moveRange: 2, fireRange: 3, damage: 20 };

const PLAYER_SPAWN = { gx: 4, gz: 8 };
const ENEMY_SPAWNS = [
  { gx: 1, gz: 1 },
  { gx: 5, gz: 1 },
  { gx: 8, gz: 2 },
];

// 장애물 배치 — 스폰 지점과 겹치지 않게 수동 배치
const OBSTACLE_CELLS = [
  [2, 3], [3, 3], [6, 2], [7, 5], [2, 6],
  [5, 5], [4, 2], [8, 6], [1, 4], [6, 7],
];

// ---------------------------------------------------------------------------
// 렌더러 / 씬 / 카메라
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc8ee);
scene.fog = new THREE.Fog(0x9cc8ee, 42, 90);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(15, 17, 17);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 1);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 10;
controls.maxDistance = 45;
controls.maxPolarAngle = Math.PI * 0.44;
controls.enablePan = false;

// 조명
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x9a8f7d, 0.9));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
sun.position.set(14, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0005;
scene.add(sun);

// ---------------------------------------------------------------------------
// 툰 셰이딩 재질 헬퍼
// ---------------------------------------------------------------------------
const gradientMap = (() => {
  const data = new Uint8Array([96, 176, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

const matCache = new Map();
function toonMat(color) {
  if (!matCache.has(color)) {
    matCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap }));
  }
  return matCache.get(color);
}

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x232a38, side: THREE.BackSide });

// 프라모델풍 먹선(외곽선): 뒤집힌 확대 메시
function addOutline(mesh, scale = 1.05) {
  const outline = new THREE.Mesh(mesh.geometry, outlineMat);
  outline.scale.setScalar(scale);
  outline.userData.isOutline = true;
  mesh.add(outline);
  return mesh;
}

function part(geo, color, { outline = true, shadow = true, outlineScale = 1.05 } = {}) {
  const mesh = new THREE.Mesh(geo, toonMat(color));
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  if (outline) addOutline(mesh, outlineScale);
  return mesh;
}

// ---------------------------------------------------------------------------
// 좌표 유틸
// ---------------------------------------------------------------------------
const cellKey = (gx, gz) => `${gx},${gz}`;
const inBounds = (gx, gz) => gx >= 0 && gx < GRID && gz >= 0 && gz < GRID;
const cellToWorld = (gx, gz) =>
  new THREE.Vector3((gx - (GRID - 1) / 2) * TILE, 0, (gz - (GRID - 1) / 2) * TILE);
function worldToCell(point) {
  const gx = Math.round(point.x / TILE + (GRID - 1) / 2);
  const gz = Math.round(point.z / TILE + (GRID - 1) / 2);
  return { gx, gz };
}
const chebDist = (a, b) => Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gz - b.gz));

const obstacleSet = new Set(OBSTACLE_CELLS.map(([x, z]) => cellKey(x, z)));
const isObstacle = (gx, gz) => obstacleSet.has(cellKey(gx, gz));

// ---------------------------------------------------------------------------
// 보드 (프라모델 전시 베이스 느낌)
// ---------------------------------------------------------------------------
{
  const baseSize = GRID * TILE + 1.8;
  const base = part(new RoundedBoxGeometry(baseSize, 1.0, baseSize, 4, 0.3), 0x5c667a, {
    outline: false,
  });
  base.position.y = -0.5;
  base.receiveShadow = true;
  scene.add(base);

  const tileGeo = new RoundedBoxGeometry(TILE - 0.14, TILE_TOP, TILE - 0.14, 2, 0.06);
  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) {
      const light = (gx + gz) % 2 === 0;
      const tile = new THREE.Mesh(tileGeo, toonMat(light ? 0xe8ecf2 : 0xccd5e0));
      const p = cellToWorld(gx, gz);
      tile.position.set(p.x, TILE_TOP / 2, p.z);
      tile.receiveShadow = true;
      scene.add(tile);
    }
  }

  // 장애물: 부서진 플라스틱 블록 더미
  for (const [gx, gz] of OBSTACLE_CELLS) {
    const p = cellToWorld(gx, gz);
    const group = new THREE.Group();
    const big = part(new RoundedBoxGeometry(1.5, 1.1, 1.5, 3, 0.18), 0xb9a88f);
    big.position.y = 0.55;
    group.add(big);
    const small = part(new RoundedBoxGeometry(0.85, 0.6, 0.85, 3, 0.12), 0xa08e74);
    small.position.set(0.22, 1.35, -0.15);
    small.rotation.y = 0.5 + ((gx * 7 + gz * 3) % 10) / 10;
    group.add(small);
    group.position.set(p.x, TILE_TOP, p.z);
    group.rotation.y = ((gx * 13 + gz * 5) % 10) / 10 - 0.5;
    scene.add(group);
  }
}

// 클릭 판정용 투명 바닥판
const clickPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID * TILE, GRID * TILE),
  new THREE.MeshBasicMaterial({ visible: false })
);
clickPlane.rotation.x = -Math.PI / 2;
clickPlane.position.y = TILE_TOP;
scene.add(clickPlane);

// ---------------------------------------------------------------------------
// SD 탱크 모델
// ---------------------------------------------------------------------------
function buildTank(bodyColor, accentColor) {
  const g = new THREE.Group();

  // 궤도(트랙) — SD답게 크고 둥글게
  const trackGeo = new RoundedBoxGeometry(0.55, 0.75, 2.0, 3, 0.26);
  const wheelGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.6, 12);
  for (const side of [-1, 1]) {
    const track = part(trackGeo, 0x3d4454);
    track.position.set(side * 0.72, 0.42, 0);
    g.add(track);
    for (const z of [-0.62, 0, 0.62]) {
      const wheel = part(wheelGeo, 0x8b95a8, { outline: false });
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.72, 0.33, z);
      g.add(wheel);
    }
  }

  // 차체 — 짧고 통통하게
  const hull = part(new RoundedBoxGeometry(1.34, 0.62, 1.75, 3, 0.16), bodyColor);
  hull.position.y = 0.78;
  g.add(hull);

  // 전면 장갑 악센트
  const glacis = part(new RoundedBoxGeometry(1.0, 0.3, 0.34, 2, 0.1), accentColor);
  glacis.position.set(0, 0.86, 0.86);
  g.add(glacis);

  // 포탑 — 차체보다 과장되게 크고 둥글게 (SD 비율의 핵심)
  const turret = new THREE.Group();
  turret.position.y = 1.28;

  const dome = part(new RoundedBoxGeometry(1.3, 0.95, 1.3, 4, 0.4), bodyColor);
  dome.position.y = 0.3;
  turret.add(dome);

  const hatch = part(new THREE.CylinderGeometry(0.3, 0.34, 0.18, 14), accentColor);
  hatch.position.set(-0.25, 0.85, -0.18);
  turret.add(hatch);

  const antenna = part(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), 0x3d4454, {
    outline: false,
    shadow: false,
  });
  antenna.position.set(0.42, 1.1, -0.35);
  turret.add(antenna);
  const antennaTip = part(new THREE.SphereGeometry(0.07, 8, 8), accentColor, { outline: false });
  antennaTip.position.set(0.42, 1.5, -0.35);
  turret.add(antennaTip);

  // 주포 — 짧고 굵게, 큼직한 머즐
  const cannon = new THREE.Group();
  cannon.position.set(0, 0.32, 0.55);
  const barrel = part(new THREE.CylinderGeometry(0.15, 0.17, 1.25, 12), 0x3d4454);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.62;
  cannon.add(barrel);
  const muzzle = part(new THREE.CylinderGeometry(0.23, 0.23, 0.32, 12), accentColor);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = 1.28;
  cannon.add(muzzle);
  turret.add(cannon);

  g.add(turret);

  // 클릭 판정용 히트박스
  const hitbox = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 2.6, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitbox.position.y = 1.3;
  g.add(hitbox);

  return { group: g, turret, cannon, muzzle, hitbox };
}

// HP 바 스프라이트
function makeHpBar() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 24;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.7, 0.32, 1);
  sprite.position.y = 3.15;
  sprite.renderOrder = 10;
  return { sprite, canvas, tex };
}

function updateHpBar(unit) {
  const { canvas, tex } = unit.hpBar;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#232a38';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
  ctx.fill();
  const ratio = Math.max(0, unit.hp / unit.maxHp);
  ctx.fillStyle = unit.isPlayer ? '#4da3ff' : ratio > 0.4 ? '#7ddb5a' : '#ff8a4d';
  ctx.beginPath();
  ctx.roundRect(3, 3, (canvas.width - 6) * ratio, canvas.height - 6, 7);
  ctx.fill();
  tex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// 유닛 생성
// ---------------------------------------------------------------------------
const units = [];

function spawnUnit(isPlayer, gx, gz, facing) {
  const stats = isPlayer ? PLAYER_STATS : ENEMY_STATS;
  const model = isPlayer ? buildTank(0x3b82f6, 0xffd24d) : buildTank(0xe2574c, 0xf2e6c8);
  const unit = {
    isPlayer,
    gx,
    gz,
    hp: stats.hp,
    maxHp: stats.hp,
    ...stats,
    alive: true,
    ...model,
  };
  const p = cellToWorld(gx, gz);
  unit.group.position.set(p.x, TILE_TOP, p.z);
  unit.group.rotation.y = facing;
  unit.hpBar = makeHpBar();
  unit.group.add(unit.hpBar.sprite);
  unit.hitbox.userData.unit = unit;
  updateHpBar(unit);
  scene.add(unit.group);
  units.push(unit);
  return unit;
}

const player = spawnUnit(true, PLAYER_SPAWN.gx, PLAYER_SPAWN.gz, Math.PI);
const enemies = ENEMY_SPAWNS.map((s) => spawnUnit(false, s.gx, s.gz, 0));

const isOccupied = (gx, gz, except = null) =>
  units.some((u) => u.alive && u !== except && u.gx === gx && u.gz === gz);

// ---------------------------------------------------------------------------
// 경로 탐색
// ---------------------------------------------------------------------------
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// unit이 이동 가능한 칸들 (BFS) — key → 경로(칸 배열)
function reachableCells(unit) {
  const result = new Map();
  const visited = new Set([cellKey(unit.gx, unit.gz)]);
  let frontier = [{ gx: unit.gx, gz: unit.gz, path: [] }];
  for (let step = 0; step < unit.moveRange; step++) {
    const next = [];
    for (const node of frontier) {
      for (const [dx, dz] of DIRS) {
        const gx = node.gx + dx;
        const gz = node.gz + dz;
        const key = cellKey(gx, gz);
        if (!inBounds(gx, gz) || visited.has(key)) continue;
        if (isObstacle(gx, gz) || isOccupied(gx, gz)) continue;
        visited.add(key);
        const path = [...node.path, { gx, gz }];
        result.set(key, path);
        next.push({ gx, gz, path });
      }
    }
    frontier = next;
  }
  return result;
}

// 목표(goal 칸)까지의 최단 경로 BFS — goal 칸 자체는 도착 불가(직전에 멈춤)
function pathToward(unit, goal) {
  const goalKey = cellKey(goal.gx, goal.gz);
  const prev = new Map();
  const visited = new Set([cellKey(unit.gx, unit.gz)]);
  let frontier = [{ gx: unit.gx, gz: unit.gz }];
  let found = false;
  while (frontier.length && !found) {
    const next = [];
    for (const node of frontier) {
      for (const [dx, dz] of DIRS) {
        const gx = node.gx + dx;
        const gz = node.gz + dz;
        const key = cellKey(gx, gz);
        if (!inBounds(gx, gz) || visited.has(key)) continue;
        if (isObstacle(gx, gz)) continue;
        if (isOccupied(gx, gz, unit) && key !== goalKey) continue;
        visited.add(key);
        prev.set(key, node);
        if (key === goalKey) {
          found = true;
          break;
        }
        next.push({ gx, gz });
      }
      if (found) break;
    }
    frontier = next;
  }
  if (!found) return [];
  // goal에서 역추적, goal 칸은 제외
  const path = [];
  let cur = prev.get(goalKey);
  while (cur && !(cur.gx === unit.gx && cur.gz === unit.gz)) {
    path.unshift({ gx: cur.gx, gz: cur.gz });
    cur = prev.get(cellKey(cur.gx, cur.gz));
  }
  return path;
}

// 시야(LOS): 장애물이 사선을 막는지 브레젠험으로 검사
function hasLOS(a, b) {
  let x0 = a.gx, y0 = a.gz;
  const x1 = b.gx, y1 = b.gz;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx)  { err += dx; y0 += sy; }
    if (x0 === x1 && y0 === y1) break;
    if (isObstacle(x0, y0)) return false;
  }
  return true;
}

const canAttack = (attacker, target) =>
  target.alive && chebDist(attacker, target) <= attacker.fireRange && hasLOS(attacker, target);

// ---------------------------------------------------------------------------
// 트윈(애니메이션) 시스템
// ---------------------------------------------------------------------------
const activeTweens = [];
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const linear = (k) => k;

function tween(dur, onUpdate, ease = easeInOut) {
  return new Promise((resolve) => {
    activeTweens.push({ start: performance.now(), dur, onUpdate, ease, resolve });
  });
}
const delay = (ms) => tween(ms, () => {}, linear);

function updateTweens(now) {
  for (let i = activeTweens.length - 1; i >= 0; i--) {
    const tw = activeTweens[i];
    const k = Math.min(1, (now - tw.start) / tw.dur);
    tw.onUpdate(tw.ease(k), k);
    if (k >= 1) {
      activeTweens.splice(i, 1);
      tw.resolve();
    }
  }
}

// 최단 각도로 회전
async function rotateTo(unit, targetRot, dur = 140) {
  const from = unit.group.rotation.y;
  let diff = targetRot - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) < 0.01) return;
  await tween(dur, (e) => {
    unit.group.rotation.y = from + diff * e;
  });
}

// 경로를 따라 통통 튀며 이동
async function moveUnit(unit, path) {
  for (const cell of path) {
    const from = unit.group.position.clone();
    const to = cellToWorld(cell.gx, cell.gz);
    to.y = TILE_TOP;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    await rotateTo(unit, Math.atan2(dx, dz), 110);
    sfx('step');
    await tween(170, (e) => {
      unit.group.position.lerpVectors(from, to, e);
      unit.group.position.y = TILE_TOP + Math.sin(e * Math.PI) * 0.22;
    });
    unit.gx = cell.gx;
    unit.gz = cell.gz;
  }
  unit.group.position.y = TILE_TOP;
}

// ---------------------------------------------------------------------------
// 전투 이펙트
// ---------------------------------------------------------------------------
const shellGeo = new THREE.SphereGeometry(0.16, 10, 10);
const shellMat = new THREE.MeshBasicMaterial({ color: 0x2f3542 });
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd24d, transparent: true });
const debrisGeo = new RoundedBoxGeometry(0.22, 0.22, 0.22, 1, 0.05);

function spawnDebris(center, colors, count, power) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(debrisGeo, toonMat(colors[i % colors.length]));
    mesh.castShadow = true;
    mesh.position.copy(center);
    const s = 0.5 + Math.random();
    mesh.scale.setScalar(s);
    scene.add(mesh);
    pieces.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * power,
        Math.random() * power * 0.9 + 2,
        (Math.random() - 0.5) * power
      ),
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
    });
  }
  tween(
    1100,
    (e, rawK) => {
      const dt = 0.016;
      for (const p of pieces) {
        p.vel.y -= 14 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        if (p.mesh.position.y < TILE_TOP + 0.11) {
          p.mesh.position.y = TILE_TOP + 0.11;
          p.vel.y *= -0.35;
          p.vel.x *= 0.7;
          p.vel.z *= 0.7;
        }
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        if (rawK > 0.7) p.mesh.scale.multiplyScalar(0.94);
      }
    },
    linear
  ).then(() => pieces.forEach((p) => scene.remove(p.mesh)));
}

async function explosionAt(pos, big = false) {
  sfx(big ? 'explode' : 'hit');
  const flash = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.9 : 0.55, 12, 12), flashMat.clone());
  flash.position.copy(pos);
  scene.add(flash);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.55, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, TILE_TOP + 0.12, pos.z);
  scene.add(ring);
  spawnDebris(pos, [0xffb347, 0x8b95a8, 0x555e70], big ? 16 : 8, big ? 7 : 4.5);
  await tween(big ? 420 : 300, (e) => {
    flash.scale.setScalar(1 + e * (big ? 2.6 : 1.6));
    flash.material.opacity = 1 - e;
    ring.scale.setScalar(1 + e * 4);
    ring.material.opacity = 1 - e;
  }, easeOut);
  scene.remove(flash);
  scene.remove(ring);
}

// 격파 연출: 프라모델 부품이 튕겨 나가듯 분해
function breakApart(unit) {
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  const meshes = [];
  unit.group.traverse((obj) => {
    if (obj.isMesh && !obj.userData.isOutline && obj.material.visible !== false) meshes.push(obj);
  });
  const pieces = [];
  for (const mesh of meshes) {
    mesh.getWorldPosition(worldPos);
    mesh.getWorldQuaternion(worldQuat);
    const clone = new THREE.Mesh(mesh.geometry, mesh.material);
    clone.castShadow = true;
    clone.position.copy(worldPos);
    clone.quaternion.copy(worldQuat);
    const ws = new THREE.Vector3();
    mesh.getWorldScale(ws);
    clone.scale.copy(ws);
    scene.add(clone);
    pieces.push({
      mesh: clone,
      vel: new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6 + 3, (Math.random() - 0.5) * 8),
      spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5),
    });
  }
  scene.remove(unit.group);
  tween(
    1500,
    (e, rawK) => {
      const dt = 0.016;
      for (const p of pieces) {
        p.vel.y -= 15 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        if (p.mesh.position.y < TILE_TOP + 0.15) {
          p.mesh.position.y = TILE_TOP + 0.15;
          p.vel.y *= -0.3;
          p.vel.x *= 0.75;
          p.vel.z *= 0.75;
        }
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.z += p.spin.z * dt;
        if (rawK > 0.75) p.mesh.scale.multiplyScalar(0.93);
      }
    },
    linear
  ).then(() => pieces.forEach((p) => scene.remove(p.mesh)));
}

async function applyDamage(target, dmg) {
  target.hp -= dmg;
  updateHpBar(target);
  if (target.isPlayer) updatePlayerHpUI();
  if (target.hp <= 0) {
    target.alive = false;
    await explosionAt(target.group.position.clone().add(new THREE.Vector3(0, 1, 0)), true);
    breakApart(target);
    sfx('explode');
  } else {
    // 피격 흔들림
    const base = target.group.position.clone();
    await tween(240, (e, rawK) => {
      const decay = 1 - rawK;
      target.group.position.x = base.x + Math.sin(rawK * 40) * 0.09 * decay;
      target.group.position.z = base.z + Math.cos(rawK * 34) * 0.09 * decay;
    }, linear);
    target.group.position.copy(base);
  }
}

async function fireAt(attacker, target) {
  // 목표를 향해 회전
  const dx = target.group.position.x - attacker.group.position.x;
  const dz = target.group.position.z - attacker.group.position.z;
  await rotateTo(attacker, Math.atan2(dx, dz), 160);

  sfx('fire');

  // 머즐 플래시 + 반동
  const muzzlePos = new THREE.Vector3();
  attacker.muzzle.getWorldPosition(muzzlePos);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), flashMat.clone());
  flash.position.copy(muzzlePos);
  scene.add(flash);
  tween(160, (e) => {
    flash.scale.setScalar(1 + e);
    flash.material.opacity = 1 - e;
  }).then(() => scene.remove(flash));
  const cz = attacker.cannon.position.z;
  tween(200, (e, rawK) => {
    attacker.cannon.position.z = cz - Math.sin(rawK * Math.PI) * 0.2;
  }, linear);

  // 포탄 포물선
  const from = muzzlePos.clone();
  const to = target.group.position.clone().add(new THREE.Vector3(0, 1.1, 0));
  const dist = from.distanceTo(to);
  const mid = from.clone().lerp(to, 0.5);
  mid.y += 1.6 + dist * 0.22;
  const shell = new THREE.Mesh(shellGeo, shellMat);
  scene.add(shell);
  await tween(
    Math.min(650, 260 + dist * 32),
    (e) => {
      // 2차 베지어
      const a = from.clone().lerp(mid, e);
      const b = mid.clone().lerp(to, e);
      shell.position.copy(a.lerp(b, e));
    },
    linear
  );
  scene.remove(shell);

  await explosionAt(to);
  await applyDamage(target, attacker.damage);
}

// ---------------------------------------------------------------------------
// 하이라이트 (이동 가능 칸 / 공격 대상)
// ---------------------------------------------------------------------------
const moveHighlightGroup = new THREE.Group();
scene.add(moveHighlightGroup);
const moveTileGeo = new THREE.PlaneGeometry(TILE - 0.3, TILE - 0.3);
const moveTileMat = new THREE.MeshBasicMaterial({
  color: 0x4da3ff,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const targetRings = [];
const targetRingGeo = new THREE.RingGeometry(1.0, 1.3, 28);
const targetRingMat = new THREE.MeshBasicMaterial({
  color: 0xff5544,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
  depthWrite: false,
});

function clearHighlights() {
  moveHighlightGroup.clear();
  for (const ring of targetRings) scene.remove(ring);
  targetRings.length = 0;
}

function showMoveHighlights(cells) {
  for (const key of cells.keys()) {
    const [gx, gz] = key.split(',').map(Number);
    const m = new THREE.Mesh(moveTileGeo, moveTileMat);
    m.rotation.x = -Math.PI / 2;
    const p = cellToWorld(gx, gz);
    m.position.set(p.x, TILE_TOP + 0.06, p.z);
    moveHighlightGroup.add(m);
  }
}

function showTargetRings(targets) {
  for (const t of targets) {
    const ring = new THREE.Mesh(targetRingGeo, targetRingMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(t.group.position.x, TILE_TOP + 0.07, t.group.position.z);
    ring.userData.unit = t;
    scene.add(ring);
    targetRings.push(ring);
  }
}

// ---------------------------------------------------------------------------
// 효과음 (WebAudio 신스)
// ---------------------------------------------------------------------------
let actx = null;
function sfx(kind) {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    const gain = actx.createGain();
    gain.connect(actx.destination);

    if (kind === 'fire') {
      const osc = actx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(240, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.16);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 0.2);
    } else if (kind === 'step') {
      const osc = actx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190 + Math.random() * 40, t);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 0.08);
    } else {
      // hit / explode: 노이즈 버스트
      const dur = kind === 'explode' ? 0.5 : 0.16;
      const buf = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const src = actx.createBufferSource();
      src.buffer = buf;
      const filter = actx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = kind === 'explode' ? 900 : 2200;
      gain.gain.setValueAtTime(kind === 'explode' ? 0.22 : 0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter).connect(gain);
      src.start(t);
    }
  } catch {
    /* 오디오 실패는 무시 */
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const turnLabel = document.getElementById('turn-label');
const hintEl = document.getElementById('hint');
const btnAction = document.getElementById('btn-action');
const btnRestart = document.getElementById('btn-restart');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnAgain = document.getElementById('btn-again');
const playerHpNum = document.getElementById('player-hp-num');
const playerHpFill = document.getElementById('player-hp-fill');

function setHint(text) {
  hintEl.textContent = text;
}
function updatePlayerHpUI() {
  playerHpNum.textContent = `${Math.max(0, player.hp)} / ${player.maxHp}`;
  playerHpFill.style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;
}

btnRestart.addEventListener('click', () => location.reload());
btnAgain.addEventListener('click', () => location.reload());

// ---------------------------------------------------------------------------
// 턴 진행 상태 머신
// ---------------------------------------------------------------------------
let turnNo = 1;
let phase = 'player-move'; // 'player-move' | 'player-fire' | 'enemy' | 'gameover'
let busy = false; // 애니메이션 중 입력 잠금
let currentMoveCells = new Map();
let currentTargets = [];

function updateActionButton() {
  if (phase === 'player-move') {
    btnAction.textContent = '이동 생략';
    btnAction.disabled = busy;
  } else if (phase === 'player-fire') {
    btnAction.textContent = '턴 종료';
    btnAction.disabled = busy;
  } else {
    btnAction.textContent = '적 턴...';
    btnAction.disabled = true;
  }
}

function startPlayerTurn() {
  if (checkGameEnd()) return;
  phase = 'player-move';
  busy = false;
  turnLabel.textContent = `턴 ${turnNo} — 아군 차례`;
  clearHighlights();
  currentMoveCells = reachableCells(player);
  showMoveHighlights(currentMoveCells);
  setHint('이동할 칸(파란색)을 클릭하세요. 이동 후 사격할 수 있습니다.');
  updateActionButton();
}

function enterFirePhase() {
  phase = 'player-fire';
  busy = false;
  clearHighlights();
  currentTargets = enemies.filter((e) => canAttack(player, e));
  if (currentTargets.length) {
    showTargetRings(currentTargets);
    setHint(`사거리 안의 적 ${currentTargets.length}대! 붉은 링이 표시된 적을 클릭해 포격하세요.`);
  } else {
    setHint('사거리 안에 적이 없습니다. (사거리 4칸, 장애물에 사선이 막힙니다) 턴을 종료하세요.');
  }
  updateActionButton();
}

async function endPlayerTurn() {
  clearHighlights();
  phase = 'enemy';
  busy = true;
  turnLabel.textContent = `턴 ${turnNo} — 적 차례`;
  setHint('적 탱크가 움직이는 중...');
  updateActionButton();

  for (const enemy of enemies) {
    if (!player.alive) break;
    if (!enemy.alive) continue;
    await delay(280);
    if (!canAttack(enemy, player)) {
      const path = pathToward(enemy, player).slice(0, enemy.moveRange);
      if (path.length) await moveUnit(enemy, path);
    }
    if (canAttack(enemy, player)) {
      await fireAt(enemy, player);
    }
  }

  if (checkGameEnd()) return;
  turnNo++;
  startPlayerTurn();
}

function checkGameEnd() {
  if (!player.alive) {
    phase = 'gameover';
    overlayTitle.textContent = '💥 패배...';
    overlaySub.textContent = '내 탱크가 격파되었습니다. 다시 조립해 봅시다!';
    overlay.classList.add('show');
    return true;
  }
  if (enemies.every((e) => !e.alive)) {
    phase = 'gameover';
    overlayTitle.textContent = '🏆 승리!';
    overlaySub.textContent = `${turnNo}턴 만에 모든 적 탱크를 격파했습니다!`;
    overlay.classList.add('show');
    return true;
  }
  return false;
}

btnAction.addEventListener('click', async () => {
  if (busy) return;
  if (phase === 'player-move') {
    enterFirePhase();
  } else if (phase === 'player-fire') {
    await endPlayerTurn();
  }
});

// ---------------------------------------------------------------------------
// 입력 (클릭 vs 카메라 드래그 구분)
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', async (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 7 || busy) return;

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  if (phase === 'player-move') {
    const hit = raycaster.intersectObject(clickPlane)[0];
    if (!hit) return;
    const { gx, gz } = worldToCell(hit.point);
    const path = currentMoveCells.get(cellKey(gx, gz));
    if (!path) return;
    busy = true;
    clearHighlights();
    updateActionButton();
    await moveUnit(player, path);
    enterFirePhase();
  } else if (phase === 'player-fire') {
    const hitboxes = currentTargets.map((t) => t.hitbox);
    const hit = raycaster.intersectObjects(hitboxes)[0];
    if (!hit) return;
    const target = hit.object.userData.unit;
    busy = true;
    clearHighlights();
    updateActionButton();
    await fireAt(player, target);
    if (!checkGameEnd()) await endPlayerTurn();
  }
});

// ---------------------------------------------------------------------------
// 메인 루프
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate(now) {
  requestAnimationFrame(animate);
  updateTweens(now);
  // 타겟 링 펄스
  const pulse = 1 + Math.sin(now * 0.006) * 0.08;
  for (const ring of targetRings) ring.scale.setScalar(pulse);
  controls.update();
  renderer.render(scene, camera);
}

updatePlayerHpUI();
startPlayerTurn();
requestAnimationFrame(animate);

// ---------------------------------------------------------------------------
// 개발/테스트용 훅 (게임 로직에는 영향 없음)
// ---------------------------------------------------------------------------
window.__puratank = {
  get state() {
    return {
      turnNo,
      phase,
      busy,
      player: { gx: player.gx, gz: player.gz, hp: player.hp, alive: player.alive },
      enemies: enemies.map((e) => ({ gx: e.gx, gz: e.gz, hp: e.hp, alive: e.alive })),
    };
  },
  screenPos(gx, gz) {
    const v = cellToWorld(gx, gz);
    v.y = TILE_TOP + 0.8;
    v.project(camera);
    return {
      x: ((v.x + 1) / 2) * window.innerWidth,
      y: ((-v.y + 1) / 2) * window.innerHeight,
    };
  },
};
