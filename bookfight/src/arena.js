// 옥타곤 — 팔각 케이지, 방송 조명, 관중석.
// 카메라가 어디로 가든 그림이 되도록 케이지 안쪽/바깥쪽을 모두 채운다.

import * as THREE from 'three';

export const CAGE_RADIUS = 6.4;
const POSTS = 8;

function matTexture() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const F = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif";

  ctx.fillStyle = '#e9e0cc';
  ctx.fillRect(0, 0, S, S);

  // 종이 결
  for (let i = 0; i < 2600; i++) {
    const x = (i * 7919) % S;
    const y = (i * 104729) % S;
    ctx.fillStyle = `rgba(140,124,96,${0.02 + ((i * 13) % 7) / 260})`;
    ctx.fillRect(x, y, 3, 2);
  }

  // 팔각 외곽선
  ctx.save();
  ctx.translate(S / 2, S / 2);
  const oct = (r) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  ctx.strokeStyle = '#8b7c58';
  ctx.lineWidth = 6;
  oct(S * 0.455);
  ctx.stroke();
  ctx.lineWidth = 2;
  oct(S * 0.43);
  ctx.stroke();

  // 코너 색면
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#c8392f';
  ctx.beginPath();
  ctx.arc(0, S * 0.34, S * 0.115, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2f5fc8';
  ctx.beginPath();
  ctx.arc(0, -S * 0.34, S * 0.115, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 가운데 로고
  ctx.textAlign = 'center';
  ctx.fillStyle = '#2b241a';
  ctx.globalAlpha = 0.82;
  ctx.font = `900 118px ${F}`;
  ctx.fillText('BOOKFIGHT', 0, -6);
  ctx.font = `800 44px ${F}`;
  ctx.globalAlpha = 0.55;
  ctx.fillText('북 파 이 트  ·  단 판 승 부', 0, 56);
  ctx.globalAlpha = 0.3;
  ctx.font = `700 30px ${F}`;
  ctx.fillText('THE OCTAGON OF LETTERS', 0, 104);

  // 가장자리 문구 — 방송용 스폰서 자리처럼
  ctx.globalAlpha = 0.34;
  ctx.font = `900 40px ${F}`;
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i / 4) * Math.PI * 2);
    ctx.fillText('입 씨 름 은  문 장 으 로', 0, -S * 0.395);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  return cv;
}

function fenceTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(188,194,206,0.95)';
  ctx.lineWidth = 2.2; // 굵으면 화면을 덮는다 — 실제 케이지처럼 가늘게
  ctx.lineCap = 'square';
  const step = 64;
  for (let i = -S; i < S * 2; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + S, 0);
    ctx.lineTo(i, S);
    ctx.stroke();
  }
  return cv;
}

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.flickers = [];
    this.fenceStrength = 0.55;

    scene.background = new THREE.Color(0x05060a);
    scene.fog = new THREE.FogExp2(0x05060a, 0.021);

    this.buildFloor();
    this.buildMat();
    this.buildCage();
    this.buildCrowd();
    this.buildLights();
    this.buildBanners();
  }

  buildFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(70, 64),
      new THREE.MeshStandardMaterial({ color: 0x0a0b11, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.62;
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  buildMat() {
    // 팔각 매트 + 그 아래 받침
    const tx = new THREE.CanvasTexture(matTexture());
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    const mat = new THREE.Mesh(
      new THREE.CylinderGeometry(CAGE_RADIUS, CAGE_RADIUS, 0.12, 8, 1),
      [
        new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ map: tx, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: 0x1d1a14, roughness: 0.9 }),
      ]
    );
    mat.rotation.y = Math.PI / 8;
    mat.position.y = -0.06;
    mat.receiveShadow = true;
    this.group.add(mat);
    this.mat = mat;

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(CAGE_RADIUS + 0.9, CAGE_RADIUS + 1.4, 0.55, 8, 1),
      new THREE.MeshStandardMaterial({ color: 0x15161d, roughness: 0.85 })
    );
    base.rotation.y = Math.PI / 8;
    base.position.y = -0.4;
    base.receiveShadow = true;
    this.group.add(base);
  }

  buildCage() {
    const ftex = new THREE.CanvasTexture(fenceTexture());
    ftex.wrapS = ftex.wrapT = THREE.RepeatWrapping;
    ftex.repeat.set(9, 5.5);
    this.fenceTex = ftex;
    // 패널마다 재질을 따로 준다 — 카메라와 선수 사이에 낀 패널만 지워야 하기 때문.
    // 실제 중계도 앞쪽 철망은 초점이 나가 사라지고 뒤쪽 철망만 보인다.
    this.panels = [];
    this.fence = new THREE.Group();

    const H = 2.9;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1b1f2a, roughness: 0.55, metalness: 0.6 });
    const padMat = new THREE.MeshStandardMaterial({ color: 0x0f1420, roughness: 0.85 });

    for (let i = 0; i < POSTS; i++) {
      const a1 = (i / POSTS) * Math.PI * 2 + Math.PI / 8;
      const a2 = ((i + 1) / POSTS) * Math.PI * 2 + Math.PI / 8;
      const p1 = new THREE.Vector3(Math.cos(a1) * CAGE_RADIUS, 0, Math.sin(a1) * CAGE_RADIUS);
      const p2 = new THREE.Vector3(Math.cos(a2) * CAGE_RADIUS, 0, Math.sin(a2) * CAGE_RADIUS);
      const mid = p1.clone().add(p2).multiplyScalar(0.5);
      const len = p1.distanceTo(p2);

      // 그물
      const pmat = new THREE.MeshStandardMaterial({
        map: ftex,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.5,
        metalness: 0.5,
        depthWrite: false,
        opacity: 0.55,
      });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, H), pmat);
      panel.position.set(mid.x, H / 2, mid.z);
      panel.lookAt(0, H / 2, 0);
      panel.renderOrder = 2;
      this.fence.add(panel);
      // 바깥을 향하는 법선 — 카메라가 이 패널 바깥에 있으면 시야를 가리는 패널이다
      this.panels.push({ mesh: pmat, normal: mid.clone().setY(0).normalize(), center: mid.clone().setY(H / 2) });

      // 기둥 + 패딩
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, H + 0.2, 10), postMat);
      post.position.set(p1.x, (H + 0.2) / 2, p1.z);
      post.castShadow = true;
      this.fence.add(post);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.3, H, 0.3), padMat);
      pad.position.set(p1.x * 1.02, H / 2, p1.z * 1.02);
      pad.lookAt(0, H / 2, 0);
      this.fence.add(pad);

      // 상단 레일
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.13, 0.13), postMat);
      rail.position.set(mid.x, H + 0.06, mid.z);
      rail.lookAt(0, H + 0.06, 0);
      rail.rotateY(Math.PI / 2);
      this.fence.add(rail);

      // 하단 패딩(빨/파 교차)
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.34, 0.1),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2a3550 : 0x4a2029, roughness: 0.9 })
      );
      skirt.position.set(mid.x, 0.17, mid.z);
      skirt.lookAt(0, 0.17, 0);
      this.fence.add(skirt);
    }
    this.group.add(this.fence);
    this.cageHeight = H;
  }

  buildCrowd() {
    // 관중 — 어두운 실루엣 인스턴스. 개별 모델은 필요 없다, 덩어리로 읽히면 된다.
    const geo = new THREE.CapsuleGeometry(0.16, 0.42, 3, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0d0f16, roughness: 1 });
    const rows = 9;
    const perRow = 74;
    const count = rows * perRow;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    this.crowdData = [];
    for (let r = 0; r < rows; r++) {
      const rad = CAGE_RADIUS + 4.6 + r * 1.5;
      const y = -0.4 + r * 0.52;
      for (let i = 0; i < perRow; i++) {
        const a = (i / perRow) * Math.PI * 2 + r * 0.04;
        const jx = (Math.sin(i * 12.9898 + r * 78.233) * 43758.5453) % 1;
        dummy.position.set(Math.cos(a) * (rad + jx * 0.4), y + 0.35, Math.sin(a) * (rad + jx * 0.4));
        dummy.rotation.set(0, -a + Math.PI / 2, 0);
        dummy.scale.setScalar(0.85 + Math.abs(jx) * 0.5);
        dummy.updateMatrix();
        inst.setMatrixAt(n, dummy.matrix);
        this.crowdData.push({ a, rad, y, base: dummy.position.y, phase: Math.abs(jx) * 9 });
        n++;
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    this.crowd = inst;
    this.crowdDummy = dummy;
    this.group.add(inst);

    // 관중석 휴대폰 플래시 — 어두운 배경에 점이 반짝이면 단번에 '경기장'이 된다
    const fgeo = new THREE.SphereGeometry(0.06, 6, 5);
    const fmat = new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true });
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = CAGE_RADIUS + 5 + Math.random() * 12;
      const m = new THREE.Mesh(fgeo, fmat.clone());
      m.position.set(Math.cos(a) * rad, -0.2 + Math.random() * 4.4, Math.sin(a) * rad);
      m.material.opacity = 0;
      this.group.add(m);
      this.flickers.push({ mesh: m, next: Math.random() * 4, on: 0 });
    }

    // 관중석 뒤 어두운 벽
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(30, 30, 16, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x070810, side: THREE.BackSide, roughness: 1 })
    );
    wall.position.y = 6;
    this.group.add(wall);
  }

  buildLights() {
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.32));
    const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x120e08, 0.38);
    this.scene.add(hemi);

    // 케이지 위 메인 조명 4개 — 하나만 그림자를 만든다(비용)
    const rigY = 9.2;
    this.spots = [];
    const angles = [0.4, 2.0, 3.6, 5.2];
    angles.forEach((a, i) => {
      const sp = new THREE.SpotLight(0xfff4e2, i === 0 ? 165 : 95, 30, 0.62, 0.45, 1.6);
      sp.position.set(Math.cos(a) * 5.2, rigY, Math.sin(a) * 5.2);
      sp.target.position.set(0, 0.6, 0);
      if (i === 0) {
        sp.castShadow = true;
        sp.shadow.mapSize.set(1024, 1024);
        sp.shadow.camera.near = 2;
        sp.shadow.camera.far = 26;
        sp.shadow.bias = -0.0016;
        sp.shadow.normalBias = 0.02;
      }
      this.scene.add(sp);
      this.scene.add(sp.target);
      this.spots.push(sp);

      // 조명 하우징 + 빛기둥
      const housing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.5, 0.5, 10),
        new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.7 })
      );
      housing.position.copy(sp.position);
      this.group.add(housing);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(4.6, rigY, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff0d0,
          transparent: true,
          opacity: 0.045,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      cone.position.set(sp.position.x * 0.5, rigY / 2, sp.position.z * 0.5);
      this.group.add(cone);
    });

    // 코너 림라이트 — 빨강/파랑이 책 옆면을 긁어준다
    const red = new THREE.PointLight(0xff3b30, 42, 16, 2);
    red.position.set(0, 2.4, CAGE_RADIUS + 1.6);
    this.scene.add(red);
    const blue = new THREE.PointLight(0x2f6bff, 42, 16, 2);
    blue.position.set(0, 2.4, -CAGE_RADIUS - 1.6);
    this.scene.add(blue);
    this.cornerLights = { red, blue };

    // 타격 플래시용
    this.flash = new THREE.PointLight(0xffffff, 0, 14, 2);
    this.flash.position.set(0, 1.6, 0);
    this.scene.add(this.flash);
  }

  buildBanners() {
    // 케이지 아래를 두르는 광고판 — 방송 화면의 아래쪽을 채워준다
    const S = 1024;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = 128;
    const ctx = cv.getContext('2d');
    const F = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
    ctx.fillStyle = '#101522';
    ctx.fillRect(0, 0, S, 128);
    const words = ['BOOKFIGHT', '단판승부', '입씨름 리그', '古典 OCTAGON', '발췌 금지 없음'];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#f0c463' : '#dfe6f5';
      ctx.font = `900 ${i % 2 ? 40 : 46}px ${F}`;
      ctx.fillText(words[i], (i + 0.5) * (S / 5), 64);
    }
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.wrapS = THREE.RepeatWrapping;
    tx.repeat.x = 2.4;
    const board = new THREE.Mesh(
      new THREE.CylinderGeometry(CAGE_RADIUS + 1.45, CAGE_RADIUS + 1.45, 0.62, 8, 1, true),
      new THREE.MeshStandardMaterial({ map: tx, side: THREE.DoubleSide, roughness: 0.7, emissive: 0x0a0d16, emissiveIntensity: 0.6 })
    );
    board.rotation.y = Math.PI / 8;
    board.position.y = -0.3;
    this.group.add(board);
  }

  // 컷 성격에 따른 그물 세기. cageCam처럼 일부러 철망 너머로 잡는 컷은 진하게,
  // 그 외에는 옅게. 실제로 시야를 가리는 패널만 골라내는 일은 update()가 한다.
  setFenceStrength(k) {
    this.fenceStrength = k;
  }

  punchFlash(pos, strength = 1) {
    this.flash.position.copy(pos);
    this.flash.intensity = 26 * strength;
  }

  update(dt, time, excitement = 0, camera = null) {
    this.flash.intensity *= Math.max(0, 1 - dt * 9);

    // 카메라와 링 사이에 낀 그물은 지운다. 반대편 그물은 남겨서 케이지 안이라는 걸 알린다.
    if (camera) {
      const k = this.fenceStrength ?? 0.55;
      for (const p of this.panels) {
        const toCam = camera.position.clone().sub(p.center);
        const blocking = toCam.dot(p.normal) > 0; // 카메라가 이 패널 바깥 = 시야를 가림
        const target = blocking ? 0.06 * k : 0.62 * k;
        p.mesh.opacity += (target - p.mesh.opacity) * Math.min(1, dt * 12);
      }
    }

    // 관중 웅성거림 — 흥분도가 높을수록 크게 들썩인다
    const amp = 0.03 + excitement * 0.16;
    const inst = this.crowd;
    const d = this.crowdDummy;
    // 전부 갱신하면 비싸다 — 매 프레임 일부만 훑는다
    const stride = 3;
    this.crowdCursor = ((this.crowdCursor || 0) + 1) % stride;
    for (let i = this.crowdCursor; i < this.crowdData.length; i += stride) {
      const c = this.crowdData[i];
      const y = c.base + Math.abs(Math.sin(time * (2.2 + excitement * 3.4) + c.phase)) * amp;
      d.position.set(Math.cos(c.a) * c.rad, y, Math.sin(c.a) * c.rad);
      d.rotation.set(0, -c.a + Math.PI / 2, 0);
      d.scale.setScalar(0.85 + (c.phase / 9) * 0.5);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;

    for (const f of this.flickers) {
      f.next -= dt * (1 + excitement * 3);
      if (f.next <= 0) {
        f.next = 0.6 + Math.random() * 3.5;
        f.on = 0.14;
      }
      if (f.on > 0) {
        f.on -= dt;
        f.mesh.material.opacity = Math.max(0, f.on * 7);
      } else f.mesh.material.opacity *= 0.8;
    }

    // 조명 미세 흔들림 — 고정 조명은 CG처럼 보인다
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      s.intensity = (i === 0 ? 165 : 95) * (1 + Math.sin(time * 3.1 + i) * 0.02);
    }
  }
}
