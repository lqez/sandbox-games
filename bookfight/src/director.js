// 중계 카메라 감독.
// 규칙: (1) 컷은 붙인다, 절대 부드럽게 넘어가지 않는다 — 방송은 컷으로 말한다.
//       (2) 컷 하나하나는 안에서 계속 움직인다(달리/푸시인/오빗). 고정 카메라는 CG처럼 보인다.
//       (3) 사건이 크면 즉시 끊고 들어간다. 잽은 와이드, 크리티컬은 로우앵글 클로즈업.

import * as THREE from 'three';
import { CAGE_RADIUS } from './arena.js';

const V = () => new THREE.Vector3();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 샷의 화각은 전부 16:9 가로 기준으로 잡혀 있다.
// three.js의 fov는 '세로' 화각이라, 세로로 긴 폰 화면(비율 0.46)에서 그대로 쓰면
// 가로 화각이 15°까지 좁아져 책 표지에 코를 박은 그림이 된다.
// 가로로 담기는 폭을 유지하되, 세로 화각은 62°에서 끊고 모자란 만큼 카메라를 뒤로 뺀다.
const REF_ASPECT = 16 / 9;
const MAX_VFOV = 62;
const D2R = Math.PI / 180;

function fitToAspect(out, aspect) {
  if (aspect >= REF_ASPECT) return;
  const halfH = Math.tan(out.fov * 0.5 * D2R) * REF_ASPECT; // 기준 화면의 가로 반각
  const needTan = halfH / Math.max(0.3, aspect); // 이 비율에서 필요한 세로 반각
  const needFov = 2 * Math.atan(needTan) / D2R;
  const capped = Math.min(needFov, MAX_VFOV);
  out.fov = capped;
  const pull = needTan / Math.tan(capped * 0.5 * D2R); // 화각으로 못 채운 만큼은 달리로
  if (pull > 1.001) {
    out.pos.sub(out.target).multiplyScalar(pull).add(out.target);
  }
}

// 각 샷: (ctx) => { pos, target, fov, roll, outside }
// ctx = { u(0~1 진행), t(초), red, blue, focus, other, mid, impact, side }
const SHOTS = {
  // 케이지사이드 와이드 — 기본 컷. 천천히 옆으로 흐른다.
  wide: {
    dur: [2.4, 3.6],
    outside: true,
    weight: 3,
    fn: (c) => {
      const a = c.side * 1.35 + c.t * 0.06;
      const r = CAGE_RADIUS + 3.2 - c.u * 0.9;
      return {
        pos: V().set(Math.cos(a) * r, 3.1 - c.u * 0.35, Math.sin(a) * r),
        target: c.mid.clone().setY(1.15),
        fov: 42 - c.u * 3,
      };
    },
  },

  // 매트 높이 로우앵글 — 책이 커 보인다
  lowAngle: {
    dur: [1.8, 2.6],
    weight: 2.4,
    fn: (c) => {
      const dir = c.focus.clone().sub(c.other).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(c.side * 1.5);
      return {
        pos: c.focus.clone().addScaledVector(dir, 2.5 + c.u * -0.7).add(side).setY(0.42 + c.u * 0.16),
        target: c.focus.clone().setY(1.4),
        fov: 36 - c.u * 2,
      };
    },
  },

  // 오버헤드 — 크레인. 링 전체를 잡고 천천히 돈다.
  overhead: {
    dur: [2.2, 3.2],
    weight: 1.1,
    fn: (c) => {
      const a = c.t * 0.28 + c.side * 2;
      return {
        pos: V().set(Math.cos(a) * 3.4, 7.4 - c.u * 1.6, Math.sin(a) * 3.4),
        target: c.mid.clone().setY(0.8),
        fov: 52,
      };
    },
  },

  // 클로즈업 — 좁은 화각으로 푸시인. 표지가 화면을 채운다.
  closeUp: {
    dur: [1.6, 2.3],
    weight: 2.2,
    fn: (c) => {
      const dir = c.focus.clone().sub(c.other).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(c.side * 0.9);
      return {
        pos: c.focus.clone().addScaledVector(dir, 2.5 - c.u * 0.4).add(side).setY(1.6),
        target: c.focus.clone().setY(1.32),
        fov: 30 - c.u * 3,
      };
    },
  },

  // 오버 더 숄더 — 상대 어깨 너머로 본다. 대치감이 산다.
  ots: {
    dur: [1.9, 2.8],
    weight: 2.6,
    fn: (c) => {
      const dir = c.other.clone().sub(c.focus).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(c.side * 0.95);
      return {
        pos: c.other.clone().addScaledVector(dir, 1.75).add(side).setY(2.0 - c.u * 0.15),
        target: c.focus.clone().setY(1.25),
        fov: 38 - c.u * 4,
      };
    },
  },

  // 더치 앵글 — 화면을 기울인다. 큰 게 터졌을 때만.
  dutch: {
    dur: [1.5, 2.0],
    weight: 0.9,
    fn: (c) => {
      const dir = c.focus.clone().sub(c.other).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(c.side * 1.7);
      return {
        pos: c.focus.clone().addScaledVector(dir, 2.0).add(side).setY(0.95 + c.u * 0.5),
        target: c.focus.clone().setY(1.35),
        fov: 33,
        roll: c.side * (0.18 + c.u * 0.1),
      };
    },
  },

  // 케이지캠 — 그물 너머로 본다. 철망이 앞에 걸리는 그 화면.
  cageCam: {
    dur: [2.0, 3.0],
    outside: true,
    weight: 2,
    fn: (c) => {
      const a = Math.atan2(c.mid.z, c.mid.x) + c.side * 0.9 + c.t * 0.05;
      const r = CAGE_RADIUS + 0.85;
      return {
        pos: V().set(Math.cos(a) * r, 1.55 + c.u * 0.25, Math.sin(a) * r),
        target: c.focus.clone().setY(1.2),
        fov: 40 - c.u * 5,
      };
    },
  },

  // 스카이캠 — 링 위를 가로질러 훑고 지나간다
  skyCam: {
    dur: [2.6, 3.4],
    weight: 0.8,
    fn: (c) => {
      const a = c.side * 1.2;
      const from = V().set(Math.cos(a) * 9, 5.6, Math.sin(a) * 9);
      const to = V().set(Math.cos(a + 1.5) * 3.2, 2.4, Math.sin(a + 1.5) * 3.2);
      const u = c.u * c.u * (3 - 2 * c.u);
      return {
        pos: from.lerp(to, u),
        target: c.mid.clone().setY(1.1),
        fov: 46 - u * 8,
      };
    },
  },

  // 코너캠 — 코너 기둥 뒤 대각선
  corner: {
    dur: [1.9, 2.6],
    weight: 1.5,
    fn: (c) => {
      const a = c.side > 0 ? Math.PI * 0.25 : Math.PI * 1.25;
      const r = CAGE_RADIUS - 0.6;
      return {
        pos: V().set(Math.cos(a) * r, 2.1 - c.u * 0.5, Math.sin(a) * r),
        target: c.mid.clone().setY(1.1),
        fov: 40,
      };
    },
  },

  // 매트캠 — 바닥에 붙었다. 다운 장면 전용.
  matCam: {
    dur: [2.4, 3.0],
    weight: 0,
    fn: (c) => {
      const dir = c.focus.clone().sub(c.other).setY(0).normalize();
      return {
        pos: c.focus.clone().addScaledVector(dir, 1.9).setY(0.18),
        target: c.focus.clone().setY(0.42),
        fov: 34,
        roll: c.side * 0.06,
      };
    },
  },

  // 오빗 — 슬로모 리플레이/KO 전용. 대상을 축으로 크게 돈다.
  orbit: {
    dur: [3.0, 4.2],
    weight: 0,
    fn: (c) => {
      const a = c.t * 0.85 + c.side * 2.2;
      const r = 4.0 - c.u * 0.9;
      return {
        pos: V().set(c.focus.x + Math.cos(a) * r, 1.1 + Math.sin(c.t * 0.5) * 0.5 + c.u * 0.8, c.focus.z + Math.sin(a) * r),
        target: c.focus.clone().setY(1.05),
        fov: 40 - c.u * 6,
      };
    },
  },

  // 소개 컷 — 경기 전 파이터 소개
  intro: {
    dur: [3.4, 3.4],
    weight: 0,
    fn: (c) => {
      const dir = c.focus.clone().sub(c.other).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const a = c.u * 1.7;
      return {
        pos: c.focus
          .clone()
          .addScaledVector(dir, Math.cos(a) * 2.5)
          .addScaledVector(side, Math.sin(a) * 2.5)
          .setY(0.8 + c.u * 1.0),
        target: c.focus.clone().setY(1.15),
        fov: 38,
      };
    },
  },

  // 대치 — 경기 직전 두 책이 마주 본 옆모습
  staredown: {
    dur: [3.0, 3.0],
    weight: 0,
    fn: (c) => {
      const a = Math.PI / 2 + c.u * 0.5;
      const r = 4.6 - c.u * 1.2;
      return {
        pos: V().set(Math.cos(a) * r, 1.9 - c.u * 0.5, Math.sin(a) * r),
        target: c.mid.clone().setY(1.25),
        fov: 34 - c.u * 4,
      };
    },
  },
};

export class Director {
  constructor(camera, arena) {
    this.camera = camera;
    this.arena = arena;
    this.shot = null;
    this.shotName = null;
    this.shotT = 0;
    this.shotDur = 2.5;
    this.side = 1;
    this.recent = [];
    this.focusCorner = 'red';
    this.shake = 0;
    this.shakeDecay = 3.2;
    this.hitstop = 0;
    this._pos = V();
    this._tgt = V();
    this._fov = 42;
    this._roll = 0;
    this.free = false; // 자유 시점 모드에서는 감독이 손을 뗀다
    this.rngState = 1;
  }

  // 감독 전용 난수 — 경기 시뮬레이션 시드를 오염시키지 않는다(연출은 판정과 무관)
  rand() {
    this.rngState = (this.rngState * 1664525 + 1013904223) % 4294967296;
    return this.rngState / 4294967296;
  }

  cut(name, opts = {}) {
    const s = SHOTS[name];
    if (!s) return;
    this.shot = s;
    this.shotName = name;
    this.shotT = 0;
    this.shotDur = opts.dur ?? s.dur[0] + this.rand() * (s.dur[1] - s.dur[0]);
    this.side = opts.side ?? (this.rand() < 0.5 ? 1 : -1);
    if (opts.focus) this.focusCorner = opts.focus;
    this.recent.unshift(name);
    if (this.recent.length > 3) this.recent.pop();
    // cageCam은 일부러 철망 너머로 잡는 컷이라 진하게, 나머지는 옅게
    this.arena.setFenceStrength(name === 'cageCam' ? 1 : s.outside ? 0.6 : 0.35);
  }

  // 사건에 맞는 컷을 고른다
  onEvent(ev) {
    if (this.free) return;
    switch (ev.type) {
      case 'strike': {
        const focus = ev.evaded ? (ev.by === 'red' ? 'blue' : 'red') : ev.by === 'red' ? 'blue' : 'red';
        if (ev.move === 'finisher') {
          this.cut('lowAngle', { focus: ev.by, dur: 2.4 });
        } else if (ev.crit || ev.knockdown) {
          this.cut(this.rand() < 0.55 ? 'dutch' : 'closeUp', { focus, dur: 1.9 });
        } else if (ev.evaded) {
          if (this.shotT > 1.4) this.cut(this.pickAmbient(), { focus });
        } else if (ev.move === 'heavy') {
          if (this.shotT > 1.2) this.cut(this.rand() < 0.5 ? 'ots' : 'cageCam', { focus });
        } else if (this.shotT > this.shotDur * 0.75) {
          this.cut(this.pickAmbient(), { focus });
        }
        break;
      }
      case 'knockdown':
        this.cut('matCam', { focus: ev.who, dur: 2.6 });
        break;
      case 'replay':
        this.cut('orbit', { focus: ev.by === 'red' ? 'blue' : 'red', dur: 3.6 });
        break;
      case 'finish':
        this.cut('orbit', { focus: ev.winner, dur: 4.4 });
        break;
      case 'decision':
        this.cut('overhead', { dur: 4 });
        break;
      case 'stagger':
        this.cut('closeUp', { focus: ev.who, dur: 1.7 });
        break;
      case 'counter':
        this.cut('dutch', { focus: ev.by, dur: 1.8 });
        break;
      case 'breathe':
        this.cut(this.rand() < 0.5 ? 'skyCam' : 'overhead', {});
        break;
      case 'bell':
        this.cut('staredown', {});
        break;
    }
  }

  pickAmbient() {
    const names = Object.keys(SHOTS).filter((n) => SHOTS[n].weight > 0 && !this.recent.slice(0, 2).includes(n));
    let total = 0;
    for (const n of names) total += SHOTS[n].weight;
    let r = this.rand() * total;
    for (const n of names) {
      r -= SHOTS[n].weight;
      if (r <= 0) return n;
    }
    return names[0] || 'wide';
  }

  punch(strength = 1) {
    this.shake = Math.min(1.4, this.shake + strength);
    this.hitstop = Math.min(0.14, 0.045 + strength * 0.07);
  }

  update(dt, fighters) {
    if (this.free) return;
    if (!this.shot) this.cut('wide');
    this.shotT += dt;

    const red = fighters.red.chestPoint();
    const blue = fighters.blue.chestPoint();
    const focus = this.focusCorner === 'red' ? red : blue;
    const other = this.focusCorner === 'red' ? blue : red;
    const mid = red.clone().add(blue).multiplyScalar(0.5);

    const ctx = {
      u: clamp(this.shotT / this.shotDur, 0, 1),
      t: this.shotT,
      red,
      blue,
      focus,
      other,
      mid,
      side: this.side,
    };
    const out = this.shot.fn(ctx);
    fitToAspect(out, this.camera.aspect);

    // 손각도 흔들림 — 삼각대가 아니라 사람이 들고 있다
    const t = performance.now() * 0.001;
    const hh = 0.028 + this.shake * 0.05;
    out.pos.x += Math.sin(t * 2.3) * hh + Math.sin(t * 5.7) * hh * 0.4;
    out.pos.y += Math.sin(t * 1.9 + 1.3) * hh * 0.8;
    out.pos.z += Math.cos(t * 2.1 + 0.7) * hh;

    // 타격 흔들림
    if (this.shake > 0.001) {
      const s = this.shake;
      out.pos.x += (this.rand() - 0.5) * s * 0.42;
      out.pos.y += (this.rand() - 0.5) * s * 0.42;
      out.pos.z += (this.rand() - 0.5) * s * 0.42;
      out.target.x += (this.rand() - 0.5) * s * 0.16;
      out.target.y += (this.rand() - 0.5) * s * 0.16;
      this.shake = Math.max(0, this.shake - dt * this.shakeDecay);
    }

    // 컷 직후 살짝 스냅 — 완전 순간이동보다 손맛이 산다
    const snap = this.shotT < 0.12 ? 1 : Math.min(1, dt * 22);
    this._pos.lerp(out.pos, snap);
    this._tgt.lerp(out.target, Math.min(1, dt * 14));
    this._fov += (out.fov - this._fov) * Math.min(1, dt * 8);
    this._roll += ((out.roll || 0) - this._roll) * Math.min(1, dt * 6);

    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._tgt);
    this.camera.rotateZ(this._roll);
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }

    // 컷 만료 — 사건이 없으면 알아서 다음 컷
    if (this.shotT >= this.shotDur) {
      this.cut(this.pickAmbient());
    }
  }

  setFree(v) {
    this.free = v;
    this.arena.setFenceStrength(0.7);
  }
}
