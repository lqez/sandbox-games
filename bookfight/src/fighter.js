// 책 파이터 — 가분수 포테이토헤드 복서.
// 책이 머리이자 몸통이고, 짧은 팔다리와 눈·머리카락이 거기 꽂힌다.
// 표지는 곧 얼굴이라 항상 상대(그리고 대개 카메라)를 향한다. 앞표지를 여닫아 말을 한다.

import * as THREE from 'three';
import { drawCover, drawBackCover, drawSpine, drawPageEdge, drawQuoteSlip } from './cover.js';
import { makeLimb, makeEyes, makeHair } from './rig.js';

const PAGE_EDGE_TEX = (() => {
  let t = null;
  return () => {
    if (!t) {
      t = new THREE.CanvasTexture(drawPageEdge());
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
    }
    return t;
  };
})();

function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn = (x) => x * x * x;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, k) => a + (b - a) * Math.min(1, Math.max(0, k));

// 가드 자세 — 글러브를 얼굴(표지) 앞에 올린 기본형
const GUARD = { sh: -0.55, el: -1.75 };

export class BookFighter {
  constructor(book, corner, opts = {}) {
    this.book = book;
    this.corner = corner;
    this.facing = opts.facing ?? 1;

    const th = Math.min(0.46, Math.max(0.075, Math.pow(book.pages, 0.62) * 0.0072));
    const scale = 1.15 + Math.pow(book.pages, 0.3) * 0.07;
    this.thickness = th;
    this.scale = scale;

    const w = 1.05;
    const h = 1.55;
    const legLen = 0.6; // 가분수 — 그래도 책 높이의 40% 아래
    this.dims = { w, h, th, legLen };

    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);

    // 엉덩이(다리가 붙는 기준) — 책이 기울어도 발은 바닥에 남는다
    this.hips = new THREE.Group();
    this.hips.position.y = legLen;
    this.root.add(this.hips);

    // body = 책. 모든 상체 모션은 여기에 건다.
    this.body = new THREE.Group();
    this.body.position.y = h / 2;
    this.hips.add(this.body);

    const coverTex = tex(drawCover(book));
    const backTex = tex(drawBackCover(book));
    const spineTex = tex(drawSpine(book));
    spineTex.wrapS = THREE.RepeatWrapping;
    spineTex.repeat.x = -1;
    spineTex.offset.x = 1;
    const edgeTex = PAGE_EDGE_TEX();
    this.ownedTextures = [coverTex, backTex, spineTex];

    const coverMat = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.78, metalness: 0.04 });
    const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.82, metalness: 0.04 });
    const spineMat = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.8 });
    const pageMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.95, color: 0xfffaf0 });
    this.materials = { coverMat, backMat, spineMat, pageMat };
    this.baseEmissive = new THREE.Color(0x000000);
    coverMat.emissive = new THREE.Color(0x000000);

    const coverT = 0.045;

    const pages = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, h * 0.96, th), pageMat);
    pages.castShadow = true;
    pages.receiveShadow = true;
    pages.position.x = 0.02;
    this.body.add(pages);

    const spine = new THREE.Mesh(new THREE.BoxGeometry(coverT * 1.4, h, th + coverT * 2), spineMat);
    spine.position.set(-w / 2, 0, 0);
    spine.castShadow = true;
    this.body.add(spine);

    // 앞표지 = 입. 말할 때 여닫는다.
    this.frontHinge = new THREE.Group();
    this.frontHinge.position.set(-w / 2, 0, th / 2 + coverT / 2);
    const front = new THREE.Mesh(new THREE.BoxGeometry(w, h, coverT), coverMat);
    front.position.x = w / 2;
    front.castShadow = true;
    front.receiveShadow = true;
    this.frontHinge.add(front);
    this.body.add(this.frontHinge);

    this.backHinge = new THREE.Group();
    this.backHinge.position.set(-w / 2, 0, -th / 2 - coverT / 2);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, coverT), backMat);
    back.position.x = w / 2;
    back.castShadow = true;
    this.backHinge.add(back);
    this.body.add(this.backHinge);

    // 눈 — 표지에 붙은 스티커. 앞표지와 함께 열리면 안 되니 body에 직접 단다.
    const { group: eyeGroup, eyes } = makeEyes(w, h);
    eyeGroup.position.z = th / 2 + coverT + 0.02;
    this.body.add(eyeGroup);
    this.eyes = eyes;

    // 머리카락 — 책 윗변에 꽂는다
    const { group: hairGroup, materials: hairMats } = makeHair(book.hair, w, book.cover.accent);
    hairGroup.position.set(0, h / 2, -0.06);
    this.body.add(hairGroup);
    this.hair = hairGroup;
    this.hairMats = hairMats;

    // ── 팔 ──
    const gloveColor = corner === 'red' ? 0xd93a30 : 0x2f63d9;
    this.arms = {};
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      const limb = makeLimb({
        upperLen: 0.4,
        lowerLen: 0.34,
        radius: 0.105,
        endRadius: 0.175,
        color: 0xf2dcc0,
        endColor: gloveColor,
      });
      limb.root.position.set(s * (w / 2 + 0.04), -h * 0.12, 0);
      limb.root.rotation.z = s * 0.24;
      this.body.add(limb.root);
      this.arms[side] = limb;
    }

    // ── 다리 ──
    this.legs = {};
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      const limb = makeLimb({
        upperLen: 0.32,
        lowerLen: 0.28,
        radius: 0.115,
        endRadius: 0.145,
        color: 0xf2dcc0,
        endColor: 0x3a2c22,
        boot: true,
      });
      limb.root.position.set(s * w * 0.24, 0, 0);
      this.hips.add(limb.root);
      this.legs[side] = limb;
    }

    // 가름끈
    const ribbonGeo = new THREE.PlaneGeometry(0.055, 0.9, 1, 8);
    this.ribbon = new THREE.Mesh(
      ribbonGeo,
      new THREE.MeshStandardMaterial({ color: new THREE.Color(book.cover.accent), side: THREE.DoubleSide, roughness: 0.6 })
    );
    this.ribbon.position.set(w * 0.32, -h * 0.32, th / 2 + 0.005);
    this.body.add(this.ribbon);
    this.ribbonBase = ribbonGeo.attributes.position.array.slice();

    // 접지 그림자
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c2 = cv.getContext('2d');
    const sg = c2.createRadialGradient(64, 64, 4, 64, 64, 62);
    sg.addColorStop(0, 'rgba(0,0,0,0.55)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    c2.fillStyle = sg;
    c2.fillRect(0, 0, 128, 128);
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 1.4),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.012;
    this.root.add(this.blob);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.86, 40),
      new THREE.MeshBasicMaterial({
        color: corner === 'red' ? 0xff4d4d : 0x4d8cff,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.root.add(this.ring);

    // 낱장 파티클
    this.paper = [];
    const paperGeo = new THREE.PlaneGeometry(0.26, 0.34);
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xfaf4e4,
      side: THREE.DoubleSide,
      roughness: 0.9,
      transparent: true,
    });
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(paperGeo, paperMat.clone());
      m.visible = false;
      this.paper.push({ mesh: m, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }

    this.anims = [];
    this.phase = Math.random() * Math.PI * 2;
    this.hurt = 0;
    this.down = false;
    this.koed = false;
    this.openAmount = 0;
    this.stanceOffset = 0;
    this.talking = 0; // >0이면 입(앞표지)이 움직인다
    this.lead = corner === 'red' ? 'R' : 'L';
    this.pose = { L: { ...GUARD }, R: { ...GUARD } };
    this.step = 0;
  }

  addTo(scene) {
    scene.add(this.root);
    for (const p of this.paper) scene.add(p.mesh);
    return this;
  }

  dispose(scene) {
    scene.remove(this.root);
    for (const p of this.paper) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    this.paper[0]?.mesh.geometry.dispose();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    });
    for (const t of this.ownedTextures) t.dispose();
    this.blob.material.map.dispose();
  }

  setPosition(x, z) {
    this.root.position.set(x, 0, z);
    this.homeX = x;
    this.homeZ = z;
  }

  lookAt(x, z) {
    this.baseRotY = Math.atan2(x - this.root.position.x, z - this.root.position.z);
    this.root.rotation.y = this.baseRotY;
  }

  play(dur, fn, onDone) {
    const a = { t: 0, dur, fn, onDone };
    this.anims.push(a);
    return a;
  }

  // 말하기 — 입(앞표지)을 대사 길이만큼 여닫는다
  speak(seconds) {
    this.talking = seconds;
  }

  // ── 복싱 모션 ──────────────────────────────────────────
  attack(moveKey, onImpact) {
    if (this.koed) return;
    const big = moveKey === 'heavy' || moveKey === 'finisher';
    const dur = moveKey === 'finisher' ? 1.0 : big ? 0.78 : 0.5;
    const reach = moveKey === 'finisher' ? 0.85 : big ? 0.6 : 0.34;
    const arm = big ? (this.lead === 'R' ? 'L' : 'R') : this.lead; // 훅은 뒷손
    const other = arm === 'R' ? 'L' : 'R';
    const s = arm === 'L' ? -1 : 1;
    let fired = false;

    const a = this.play(dur, (u) => {
      let k; // 0=준비 1=최대신장
      if (u < 0.3) k = -0.32 * easeOut(u / 0.3);
      else if (u < 0.52) k = lerp(-0.32, 1, easeOut((u - 0.3) / 0.22));
      else k = 1 - easeInOut((u - 0.52) / 0.48);

      // 뻗는 팔 — 어깨가 앞으로, 팔꿈치가 펴진다
      this.pose[arm].sh = lerp(GUARD.sh, -1.62, Math.max(0, k));
      this.pose[arm].el = lerp(GUARD.el, -0.12, Math.max(0, k));
      // 반대 팔은 가드를 조인다
      this.pose[other].sh = lerp(GUARD.sh, -0.42, Math.abs(k) * 0.6);
      this.pose[other].el = lerp(GUARD.el, -2.05, Math.abs(k) * 0.6);

      // 몸통 — 어깨를 넣으며 회전, 훅이면 크게
      this.body.rotation.y = -s * k * (big ? 0.55 : 0.3);
      this.body.rotation.z = s * k * (big ? 0.16 : 0.07);
      this.body.rotation.x = -k * 0.1;
      this.stanceOffset = k * reach;
      // 입은 공격할 때 크게 벌어진다
      this.openAmount = Math.max(0, k) * (moveKey === 'finisher' ? 0.75 : big ? 0.5 : 0.32);
      // 뒷발로 밀어낸다
      this.legs[other].root.rotation.x = k * 0.4;
      this.legs[arm].root.rotation.x = -k * 0.22;

      if (!fired && u >= 0.5) {
        fired = true;
        if (onImpact) onImpact();
      }
    }, () => {
      this.pose.L = { ...GUARD };
      this.pose.R = { ...GUARD };
    });
    a.kind = 'attack';
    return a;
  }

  hit(ratio, crit) {
    if (this.koed) return;
    const strength = Math.min(1, 0.35 + ratio * 3.4 + (crit ? 0.3 : 0));
    this.burstPages(Math.round(3 + strength * 12), strength);
    this.hurt = Math.min(1, this.hurt + strength * 0.7);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const a = this.play(0.44 + strength * 0.2, (u) => {
      const k = Math.sin(u * Math.PI) * strength;
      this.stanceOffset = -k * 0.4;
      this.body.rotation.x = k * 0.42; // 고개가 젖혀진다
      this.body.rotation.z = k * 0.22 * dir;
      this.body.rotation.y = k * 0.3 * dir;
      this.openAmount = k * 0.3;
      // 가드가 풀리며 팔이 벌어진다
      this.pose.L.sh = lerp(GUARD.sh, -0.1, k);
      this.pose.R.sh = lerp(GUARD.sh, -0.1, k);
      this.pose.L.el = lerp(GUARD.el, -0.9, k);
      this.pose.R.el = lerp(GUARD.el, -0.9, k);
      this.legs.L.root.rotation.x = -k * 0.3;
      this.legs.R.root.rotation.x = k * 0.2;
      this.materials.coverMat.emissive.setRGB(k * 0.5, k * 0.12, k * 0.06);
    });
    a.kind = 'hit';
    return a;
  }

  // 논파당했다 — 맞은 건 아니고 말문이 막힌 상태
  flinch() {
    if (this.koed) return;
    const a = this.play(0.6, (u) => {
      const k = Math.sin(u * Math.PI);
      this.body.rotation.x = k * 0.16;
      this.stanceOffset = -k * 0.16;
      this.openAmount = k * 0.15;
    });
    a.kind = 'flinch';
    return a;
  }

  stagger() {
    if (this.koed) return;
    const a = this.play(1.3, (u) => {
      const d = 1 - u;
      this.body.rotation.z = Math.sin(u * 26) * 0.26 * d;
      this.body.rotation.x = Math.sin(u * 17) * 0.16 * d;
      this.stanceOffset = -Math.sin(u * 11) * 0.2 * d;
      this.openAmount = 0.5 * d;
      this.legs.L.root.rotation.x = Math.sin(u * 20) * 0.3 * d;
      this.legs.R.root.rotation.x = -Math.sin(u * 20) * 0.3 * d;
      this.pose.L.sh = lerp(GUARD.sh, -0.2, d);
      this.pose.R.sh = lerp(GUARD.sh, -0.2, d);
    });
    a.kind = 'stagger';
    return a;
  }

  knockdown() {
    if (this.koed) return;
    this.burstPages(20, 1);
    this.down = true;
    const a = this.play(2.6, (u) => {
      const back = u < 0.28 ? easeIn(u / 0.28) : u < 0.62 ? 1 : 1 - easeOut((u - 0.62) / 0.38);
      this.body.rotation.x = back * 1.35;
      this.hips.position.y = this.dims.legLen - back * (this.dims.legLen - 0.1);
      this.openAmount = back * 2.2;
      // 다리가 앞으로 뻗어 널브러진다
      this.legs.L.root.rotation.x = -back * 1.5;
      this.legs.R.root.rotation.x = -back * 1.2;
      this.legs.L.joint.rotation.x = back * 0.9;
      this.legs.R.joint.rotation.x = back * 0.6;
      this.pose.L.sh = lerp(GUARD.sh, 0.5, back);
      this.pose.R.sh = lerp(GUARD.sh, 0.5, back);
      this.pose.L.el = lerp(GUARD.el, -0.3, back);
      this.pose.R.el = lerp(GUARD.el, -0.3, back);
    }, () => {
      this.down = false;
      this.hips.position.y = this.dims.legLen;
    });
    a.kind = 'knockdown';
    return a;
  }

  ko() {
    this.koed = true;
    this.burstPages(30, 1.4);
    this.anims = [];
    const a = this.play(2.4, (u) => {
      const k = easeIn(Math.min(1, u / 0.5));
      this.body.rotation.x = k * 1.45;
      this.body.rotation.z = k * 0.25;
      this.hips.position.y = this.dims.legLen - k * (this.dims.legLen - 0.08);
      this.openAmount = k * 2.4;
      this.legs.L.root.rotation.x = -k * 1.7;
      this.legs.R.root.rotation.x = -k * 1.2;
      this.legs.L.joint.rotation.x = k * 1.1;
      this.pose.L.sh = lerp(GUARD.sh, 0.7, k);
      this.pose.R.sh = lerp(GUARD.sh, 0.5, k);
      this.pose.L.el = lerp(GUARD.el, -0.1, k);
      this.pose.R.el = lerp(GUARD.el, -0.2, k);
    });
    a.kind = 'ko';
    this.ring.material.opacity = 0.1;
    return a;
  }

  celebrate() {
    if (this.koed) return;
    const a = this.play(6, (u) => {
      const b = Math.abs(Math.sin(u * Math.PI * 5));
      this.hips.position.y = this.dims.legLen + b * 0.34;
      this.body.rotation.x = -0.16 - b * 0.12;
      this.openAmount = 1.2 + b * 0.6;
      this.body.rotation.y = Math.sin(u * Math.PI * 2.2) * 0.4;
      // 두 팔을 번쩍
      this.pose.L.sh = 2.5 + b * 0.3;
      this.pose.R.sh = 2.5 + b * 0.3;
      this.pose.L.el = -0.3;
      this.pose.R.el = -0.3;
      this.legs.L.root.rotation.x = -b * 0.3;
      this.legs.R.root.rotation.x = b * 0.3;
    });
    a.kind = 'celebrate';
    return a;
  }

  burstPages(count, strength) {
    const origin = this.body.localToWorld(new THREE.Vector3(0, 0, this.dims.th));
    let used = 0;
    for (const p of this.paper) {
      if (used >= count) break;
      if (p.life > 0) continue;
      used++;
      p.life = 1;
      p.mesh.visible = true;
      p.mesh.position
        .copy(origin)
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.5));
      const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y);
      p.vel.set(
        (Math.random() - 0.5) * 3.2 * strength - dir.x * 1.6 * strength,
        1.8 + Math.random() * 3 * strength,
        (Math.random() - 0.5) * 3.2 * strength - dir.z * 1.6 * strength
      );
      p.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      p.mesh.material.opacity = 1;
      p.mesh.scale.setScalar(0.7 + Math.random() * 0.7);
    }
  }

  update(dt, time) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      a.fn(u);
      if (u >= 1) {
        this.anims.splice(i, 1);
        if (a.onDone) a.onDone();
      }
    }

    const busy = this.anims.length > 0;
    const t = time + this.phase;
    const K = (r) => Math.min(1, dt * r);

    if (!busy && !this.koed) {
      // 복싱 스탠스 — 무릎으로 통통 튀고 몸이 좌우로 흔들린다
      const bob = Math.abs(Math.sin(t * 3.6)) * 0.05 * (1 + this.hurt * 0.6);
      const sway = Math.sin(t * 1.8) * 0.09;
      this.hips.position.y = lerp(this.hips.position.y, this.dims.legLen + bob, K(10));
      this.body.rotation.z = lerp(this.body.rotation.z, sway * 0.3, K(6));
      this.body.rotation.y = lerp(this.body.rotation.y, sway * 0.45, K(6));
      this.body.rotation.x = lerp(this.body.rotation.x, this.hurt * 0.12, K(6));
      this.stanceOffset = lerp(this.stanceOffset, 0, K(7));
      this.pose.L.sh = lerp(this.pose.L.sh, GUARD.sh + Math.sin(t * 3.6) * 0.06, K(8));
      this.pose.R.sh = lerp(this.pose.R.sh, GUARD.sh - Math.sin(t * 3.6) * 0.06, K(8));
      this.pose.L.el = lerp(this.pose.L.el, GUARD.el, K(8));
      this.pose.R.el = lerp(this.pose.R.el, GUARD.el, K(8));
      // 스텝 — 무릎을 번갈아 굽혀 제자리 스텝을 밟는다
      this.step += dt * 3.6;
      this.legs.L.root.rotation.x = lerp(this.legs.L.root.rotation.x, Math.sin(this.step) * 0.16, K(8));
      this.legs.R.root.rotation.x = lerp(this.legs.R.root.rotation.x, -Math.sin(this.step) * 0.16, K(8));
      this.legs.L.joint.rotation.x = lerp(this.legs.L.joint.rotation.x, 0.18 + Math.max(0, Math.sin(this.step)) * 0.2, K(8));
      this.legs.R.joint.rotation.x = lerp(this.legs.R.joint.rotation.x, 0.18 + Math.max(0, -Math.sin(this.step)) * 0.2, K(8));
      this.materials.coverMat.emissive.lerp(this.baseEmissive, K(5));
    }

    // 말하기 — 입(앞표지)이 대사 리듬으로 여닫힌다
    if (this.talking > 0) {
      this.talking -= dt;
      const flap = 0.08 + Math.abs(Math.sin(time * 12)) * 0.17;
      this.openAmount = lerp(this.openAmount, flap, K(14));
    } else if (!busy && !this.koed) {
      this.openAmount = lerp(this.openAmount, 0.05 + Math.sin(t * 2.6) * 0.03, K(7));
    }

    // 팔 자세 적용
    for (const side of ['L', 'R']) {
      const a = this.arms[side];
      const s = side === 'L' ? -1 : 1;
      a.root.rotation.x = this.pose[side].sh;
      a.root.rotation.z = s * 0.24;
      a.joint.rotation.x = this.pose[side].el;
    }

    // 링 안에서 앞뒤로 파고들기
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.baseRotY || 0);
    this.root.position.x = this.homeX + fwd.x * this.stanceOffset;
    this.root.position.z = this.homeZ + fwd.z * this.stanceOffset;

    this.frontHinge.rotation.y = -this.openAmount;
    this.backHinge.rotation.y = this.openAmount * 0.3;

    // 눈 — 아프면 반쯤 감기고, 눈동자가 상대 쪽을 본다
    const lidDrop = this.koed ? 1 : Math.min(0.8, this.hurt);
    for (const e of this.eyes) {
      e.userData.lid.position.y = lerp(e.userData.lid.position.y, 0.14 - lidDrop * 0.16, K(6));
      e.userData.pupil.position.x = lerp(e.userData.pupil.position.x, e.userData.side * -0.02, K(4));
    }

    // 가름끈
    const pos = this.ribbon.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = this.ribbonBase[i * 3 + 1];
      const k = (0.45 - y) / 0.9;
      pos.array[i * 3 + 2] = Math.sin(t * 5 + k * 5) * 0.055 * k * k;
      pos.array[i * 3] = this.ribbonBase[i * 3] + Math.sin(t * 3.2 + k * 3) * 0.03 * k;
    }
    pos.needsUpdate = true;

    this.hurt = Math.max(0, this.hurt - dt * 0.35);

    for (const p of this.paper) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.42;
      p.vel.y -= dt * 6.4;
      p.vel.multiplyScalar(1 - dt * 1.1);
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vel.y = Math.abs(p.vel.y) * 0.28;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
        p.spin.multiplyScalar(0.6);
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      p.mesh.material.opacity = Math.min(1, p.life * 1.6);
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  // 말풍선이 붙을 지점 — 머리(책) 위
  headPoint(v = new THREE.Vector3()) {
    return this.body.localToWorld(v.set(0, this.dims.h * 0.62, 0));
  }
  chestPoint(v = new THREE.Vector3()) {
    return this.body.localToWorld(v.set(0, 0, this.dims.th));
  }
}

export class QuoteSlip {
  constructor(scene) {
    this.scene = scene;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.75),
      new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false })
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.active = false;
  }
  launch(quote, source, accent, from, to, dur = 0.42, big = false) {
    if (this.mesh.material.map) this.mesh.material.map.dispose();
    const t = new THREE.CanvasTexture(drawQuoteSlip(quote, source, accent));
    t.colorSpace = THREE.SRGBColorSpace;
    this.mesh.material.map = t;
    this.mesh.material.needsUpdate = true;
    this.from = from.clone();
    this.to = to.clone();
    this.dur = dur;
    this.t = 0;
    this.big = big;
    this.active = true;
    this.mesh.visible = true;
  }
  update(dt, camera) {
    if (!this.active) return;
    this.t += dt;
    const u = Math.min(1, this.t / this.dur);
    const p = this.from.clone().lerp(this.to, easeOut(u));
    p.y += Math.sin(u * Math.PI) * 0.6;
    this.mesh.position.copy(p);
    this.mesh.lookAt(camera.position);
    this.mesh.rotateZ(Math.sin(u * 9) * 0.14);
    const dist = camera.position.distanceTo(p);
    const fit = Math.min(1, Math.max(0.34, dist / 4.5));
    const s = (this.big ? 1.3 : 1) * fit * (u < 0.8 ? 1 : 1 - (u - 0.8) * 4.4);
    this.mesh.scale.setScalar(Math.max(0.01, s));
    this.mesh.material.opacity = u < 0.75 ? 1 : Math.max(0, 1 - (u - 0.75) * 4);
    if (u >= 1) {
      this.active = false;
      this.mesh.visible = false;
    }
  }
}
