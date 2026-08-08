// 책 파이터 — 표지가 입이자 주먹이다.
// 책등을 경첩 삼아 앞표지가 열리며 발췌문을 뱉고, 맞으면 낱장이 터져 나온다.

import * as THREE from 'three';
import { drawCover, drawBackCover, drawSpine, drawPageEdge, drawQuoteSlip } from './cover.js';

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

export class BookFighter {
  constructor(book, corner, opts = {}) {
    this.book = book;
    this.corner = corner;
    this.facing = opts.facing ?? 1; // +1이면 +Z를 본다

    // 분량이 곧 두께이자 덩치
    const th = Math.min(0.46, Math.max(0.075, Math.pow(book.pages, 0.62) * 0.0072));
    const scale = 1.15 + Math.pow(book.pages, 0.3) * 0.07;
    this.thickness = th;
    this.scale = scale;

    const w = 1.05;
    const h = 1.55;
    this.dims = { w, h, th };

    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);

    // body — 흔들림/기울임 전부 여기에 건다
    this.body = new THREE.Group();
    this.body.position.y = h / 2;
    this.root.add(this.body);

    const coverTex = tex(drawCover(book));
    const backTex = tex(drawBackCover(book));
    const spineTex = tex(drawSpine(book));
    // 책등이 바깥을 보는 면은 BoxGeometry의 -X 면인데, 이 면의 UV는 +X 면과 좌우가 뒤집혀 있다.
    // 그대로 두면 제목이 거울처럼 뒤집혀 읽힌다 — 텍스처를 미리 뒤집어 상쇄한다.
    spineTex.wrapS = THREE.RepeatWrapping;
    spineTex.repeat.x = -1;
    spineTex.offset.x = 1;
    const edgeTex = PAGE_EDGE_TEX();

    // 이 파이터만 쓰는 텍스처 — 정리할 때 이것만 버린다.
    // 낱장 단면(PAGE_EDGE_TEX)은 모두가 공유하므로 절대 dispose하면 안 된다.
    this.ownedTextures = [coverTex, backTex, spineTex];

    const coverMat = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.78, metalness: 0.04 });
    const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.82, metalness: 0.04 });
    const spineMat = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.8 });
    const pageMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.95, color: 0xfffaf0 });
    this.materials = { coverMat, backMat, spineMat, pageMat };
    this.baseEmissive = new THREE.Color(0x000000);
    coverMat.emissive = new THREE.Color(0x000000);

    const coverT = 0.045;

    // 낱장 뭉치
    const pages = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, h * 0.96, th), pageMat);
    pages.castShadow = true;
    pages.receiveShadow = true;
    pages.position.x = 0.02;
    this.body.add(pages);
    this.pages = pages;

    // 책등
    const spine = new THREE.Mesh(new THREE.BoxGeometry(coverT * 1.4, h, th + coverT * 2), spineMat);
    spine.position.set(-w / 2, 0, 0);
    spine.castShadow = true;
    this.body.add(spine);

    // 앞표지 — 책등을 축으로 열린다(= 입 + 주먹)
    this.frontHinge = new THREE.Group();
    this.frontHinge.position.set(-w / 2, 0, th / 2 + coverT / 2);
    const front = new THREE.Mesh(new THREE.BoxGeometry(w, h, coverT), coverMat);
    front.position.x = w / 2;
    front.castShadow = true;
    front.receiveShadow = true;
    this.frontHinge.add(front);
    this.body.add(this.frontHinge);
    this.frontCover = front;

    // 뒤표지
    this.backHinge = new THREE.Group();
    this.backHinge.position.set(-w / 2, 0, -th / 2 - coverT / 2);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, coverT), backMat);
    back.position.x = w / 2;
    back.castShadow = true;
    this.backHinge.add(back);
    this.body.add(this.backHinge);

    // 가름끈 — 흔들리면 살아 있어 보인다
    const ribbonGeo = new THREE.PlaneGeometry(0.055, 0.9, 1, 8);
    const ribbonMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(book.cover.accent),
      side: THREE.DoubleSide,
      roughness: 0.6,
    });
    this.ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
    this.ribbon.position.set(w * 0.32, -h * 0.32, th / 2 + 0.005);
    this.body.add(this.ribbon);
    this.ribbonBase = ribbonGeo.attributes.position.array.slice();

    // 접지 그림자 대용 — 바닥에 어두운 원
    const shadowTexCv = document.createElement('canvas');
    shadowTexCv.width = shadowTexCv.height = 128;
    const sctx = shadowTexCv.getContext('2d');
    const sg = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    sg.addColorStop(0, 'rgba(0,0,0,0.55)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = sg;
    sctx.fillRect(0, 0, 128, 128);
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 1.4),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowTexCv), transparent: true, depthWrite: false })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.012;
    this.root.add(this.blob);

    // 코너 색 글로우 링
    const ringColor = corner === 'red' ? 0xff4d4d : 0x4d8cff;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.86, 40),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.root.add(this.ring);

    // 낱장 파티클 풀
    this.paper = [];
    const paperGeo = new THREE.PlaneGeometry(0.26, 0.34);
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xfaf4e4,
      side: THREE.DoubleSide,
      roughness: 0.9,
      transparent: true,
    });
    for (let i = 0; i < 34; i++) {
      const m = new THREE.Mesh(paperGeo, paperMat.clone());
      m.visible = false;
      this.paper.push({ mesh: m, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }

    // 상태
    this.anims = [];
    this.phase = Math.random() * Math.PI * 2;
    this.hurt = 0;
    this.down = false;
    this.koed = false;
    this.openAmount = 0;
    this.stanceOffset = 0;
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
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
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
    const dx = x - this.root.position.x;
    const dz = z - this.root.position.z;
    this.baseRotY = Math.atan2(dx, dz);
    this.root.rotation.y = this.baseRotY;
  }

  // ── 애니메이션 트랙 ────────────────────────────────────────
  play(dur, fn, onDone) {
    const a = { t: 0, dur, fn, onDone };
    this.anims.push(a);
    return a;
  }

  clearAnims(kind) {
    this.anims = this.anims.filter((a) => (kind ? a.kind !== kind : false));
  }

  attack(moveKey, onImpact) {
    if (this.koed) return;
    const big = moveKey === 'heavy' || moveKey === 'finisher';
    const dur = moveKey === 'finisher' ? 1.05 : big ? 0.82 : 0.55;
    const reach = moveKey === 'finisher' ? 1.5 : big ? 1.1 : 0.62;
    const openMax = moveKey === 'finisher' ? 2.15 : big ? 1.75 : 1.25;
    let fired = false;
    const a = this.play(dur, (u) => {
      // 0→0.35 준비(뒤로 당김), 0.35→0.55 뻗음, 0.55→1 복귀
      let lunge, open;
      if (u < 0.32) {
        const k = u / 0.32;
        lunge = -0.22 * easeOut(k);
        open = 0.35 * easeOut(k);
      } else if (u < 0.55) {
        const k = (u - 0.32) / 0.23;
        lunge = -0.22 + (reach + 0.22) * easeOut(k);
        open = 0.35 + (openMax - 0.35) * easeOut(k);
      } else {
        const k = (u - 0.55) / 0.45;
        lunge = reach * (1 - easeInOut(k));
        open = openMax * (1 - easeInOut(k)) + 0.1 * easeInOut(k);
      }
      this.stanceOffset = lunge;
      this.openAmount = open;
      this.body.rotation.x = -lunge * 0.16;
      this.body.rotation.z = Math.sin(u * Math.PI) * (big ? 0.16 : 0.08);
      if (!fired && u >= 0.5) {
        fired = true;
        if (onImpact) onImpact();
      }
    });
    a.kind = 'attack';
    return a;
  }

  // 맞았다 — 뒤로 젖혀지고 낱장이 터진다
  hit(ratio, crit) {
    if (this.koed) return;
    const strength = Math.min(1, 0.35 + ratio * 3.4 + (crit ? 0.3 : 0));
    this.burstPages(Math.round(4 + strength * 14), strength);
    this.hurt = Math.min(1, this.hurt + strength * 0.7);
    const a = this.play(0.42 + strength * 0.2, (u) => {
      const k = Math.sin(u * Math.PI) * strength;
      this.stanceOffset = -k * 0.55;
      this.body.rotation.x = k * 0.42;
      this.body.rotation.z = k * 0.2 * (crit ? 1.6 : 1);
      this.openAmount = k * 0.5;
      this.materials.coverMat.emissive.setRGB(k * 0.5, k * 0.12, k * 0.06);
    });
    a.kind = 'hit';
    return a;
  }

  evade() {
    if (this.koed) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const a = this.play(0.5, (u) => {
      const k = Math.sin(u * Math.PI);
      this.body.position.x = dir * k * 0.55;
      this.body.rotation.z = -dir * k * 0.3;
      this.body.rotation.y = -dir * k * 0.5;
    });
    a.kind = 'evade';
    return a;
  }

  stagger() {
    if (this.koed) return;
    const a = this.play(1.3, (u) => {
      const decay = 1 - u;
      this.body.rotation.z = Math.sin(u * 26) * 0.26 * decay;
      this.body.rotation.x = Math.sin(u * 17) * 0.16 * decay;
      this.stanceOffset = -Math.sin(u * 11) * 0.22 * decay;
      this.openAmount = 0.5 * decay;
    });
    a.kind = 'stagger';
    return a;
  }

  knockdown() {
    if (this.koed) return;
    this.burstPages(24, 1);
    this.down = true;
    const a = this.play(2.6, (u) => {
      if (u < 0.28) {
        const k = easeIn(u / 0.28);
        this.body.rotation.x = k * 1.45;
        this.body.position.y = this.dims.h / 2 - k * (this.dims.h / 2 - 0.14);
        this.openAmount = k * 2.4;
      } else if (u < 0.62) {
        // 매트에 엎어져 있다
        this.body.rotation.x = 1.45 + Math.sin(u * 30) * 0.03;
        this.body.position.y = 0.14;
        this.openAmount = 2.4;
      } else {
        const k = easeOut((u - 0.62) / 0.38);
        this.body.rotation.x = 1.45 * (1 - k);
        this.body.position.y = 0.14 + (this.dims.h / 2 - 0.14) * k;
        this.openAmount = 2.4 * (1 - k) + 0.2 * k;
      }
    }, () => {
      this.down = false;
    });
    a.kind = 'knockdown';
    return a;
  }

  ko() {
    this.koed = true;
    this.burstPages(34, 1.4);
    this.anims = [];
    const a = this.play(2.2, (u) => {
      const k = easeIn(Math.min(1, u / 0.5));
      this.body.rotation.x = k * 1.52;
      this.body.position.y = this.dims.h / 2 - k * (this.dims.h / 2 - 0.13);
      this.openAmount = k * 2.6;
      this.stanceOffset = -k * 0.3;
      if (u > 0.55) {
        const w = (u - 0.55) / 0.45;
        this.body.rotation.z = Math.sin(w * 8) * 0.05 * (1 - w);
      }
    });
    a.kind = 'ko';
    this.ring.material.opacity = 0.1;
    return a;
  }

  celebrate() {
    if (this.koed) return;
    const a = this.play(6, (u) => {
      const b = Math.abs(Math.sin(u * Math.PI * 5));
      this.body.position.y = this.dims.h / 2 + b * 0.42;
      this.body.rotation.x = -0.22 - b * 0.16;
      this.openAmount = 1.5 + b * 0.7;
      this.body.rotation.y = Math.sin(u * Math.PI * 2.2) * 0.5;
    });
    a.kind = 'celebrate';
    return a;
  }

  burstPages(count, strength) {
    const origin = this.root.localToWorld(new THREE.Vector3(0, this.dims.h * 0.55, this.dims.th));
    let used = 0;
    for (const p of this.paper) {
      if (used >= count) break;
      if (p.life > 0) continue;
      used++;
      p.life = 1;
      p.mesh.visible = true;
      p.mesh.position.copy(origin).add(
        new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.5)
      );
      const dir = new THREE.Vector3(0, 0, this.facing).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y);
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
    // 트랙 진행
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

    if (!busy && !this.koed) {
      // 아이들 — 복싱 스탠스 바운스 + 좌우 스웨이
      const hurtScale = 1 + this.hurt * 0.5;
      const bob = Math.sin(t * 3.4) * 0.045 * hurtScale;
      const sway = Math.sin(t * 1.7) * 0.09;
      this.body.position.y = this.dims.h / 2 + Math.abs(bob);
      this.body.position.x += (0 - this.body.position.x) * Math.min(1, dt * 8);
      this.body.rotation.z += (sway * 0.35 - this.body.rotation.z) * Math.min(1, dt * 6);
      this.body.rotation.x += (this.hurt * 0.12 - this.body.rotation.x) * Math.min(1, dt * 6);
      this.body.rotation.y += (sway * 0.5 - this.body.rotation.y) * Math.min(1, dt * 6);
      this.openAmount += ((0.13 + Math.sin(t * 2.6) * 0.07) - this.openAmount) * Math.min(1, dt * 7);
      this.stanceOffset += (0 - this.stanceOffset) * Math.min(1, dt * 7);
      this.materials.coverMat.emissive.lerp(this.baseEmissive, Math.min(1, dt * 5));
    }

    // 링 안에서 앞뒤로 파고들기(스탠스)
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.baseRotY || 0);
    this.root.position.x = this.homeX + fwd.x * this.stanceOffset;
    this.root.position.z = this.homeZ + fwd.z * this.stanceOffset;

    // 표지 열림 — 입이자 주먹
    this.frontHinge.rotation.y = -this.openAmount;
    this.backHinge.rotation.y = this.openAmount * 0.32;

    // 가름끈 나부낌
    const pos = this.ribbon.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = this.ribbonBase[i * 3 + 1];
      const k = (0.45 - y) / 0.9;
      pos.array[i * 3 + 2] = Math.sin(t * 5 + k * 5) * 0.055 * k * k;
      pos.array[i * 3] = this.ribbonBase[i * 3] + Math.sin(t * 3.2 + k * 3) * 0.03 * k;
    }
    pos.needsUpdate = true;

    this.hurt = Math.max(0, this.hurt - dt * 0.35);
    this.blob.scale.setScalar(1 - this.stanceOffset * 0.05);

    // 낱장 파티클
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

  // 히트 지점(월드) — 카메라와 이펙트가 쓴다
  headPoint(v = new THREE.Vector3()) {
    return this.root.localToWorld(v.set(0, this.dims.h * 0.72 * this.scale, 0));
  }
  chestPoint(v = new THREE.Vector3()) {
    return this.root.localToWorld(v.set(0, this.dims.h * 0.45 * this.scale, this.dims.th));
  }
}

// ── 발췌문 종이 ────────────────────────────────────────────
// 실제 문장을 텍스처로 구워 상대에게 날린다. 이 게임의 "펀치"는 문장이다.
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
    this.mesh.scale.setScalar(big ? 1.35 : 1);
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
    // 화면에서 차지하는 크기를 일정하게 — 클로즈업 컷에서 종이가 화면을 다 덮으면 경기가 안 보인다
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
