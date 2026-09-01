// camera.js — FPV 드론캠 디렉터
// chase: 속도 반응 추격(저속 망원 ↔ 고속 광각) / long: 빅에어·크래시 망원 고정
// low: 부유 램프 구간 수면 스치는 측면 샷
//
// 스무딩 원칙: 모드가 바뀌어도 카메라가 튀지 않도록 리그 파라미터
// (거리·높이·측면·화각·룩어헤드)를 각각 1차 필터로 보간한 뒤, 그 결과로
// 목표 위치를 만들고 위치 자체도 다시 스프링으로 따라간다. 즉 2단 스무딩.
import * as THREE from 'three';

const MODE = { CHASE: 0, LONG: 1, LOW: 2 };

// 1차 필터: 시정수 기반 (프레임률 독립)
function damp(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

export class DroneCam {
  constructor(camera) {
    this.camera = camera;
    this.mode = MODE.CHASE;
    this.pos = new THREE.Vector3(0, 6, -12);
    this.vel = new THREE.Vector3();
    this.lookPos = new THREE.Vector3();
    this.fov = 60;
    this.roll = 0;
    this.rollVel = 0;
    this.rollTarget = 0;
    this.anchor = new THREE.Vector3();  // 망원 고정 위치
    this.anchorDrift = new THREE.Vector3();
    this.longTimer = 0;
    this.noiseT = Math.random() * 100;
    this.shake = 0;
    // 스무딩되는 리그 파라미터
    this.rig = { back: 13, up: 7, side: 1.2, fov: 60, lookAhead: 12, swing: 0 };
    this._tmp = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._targetVel = new THREE.Vector3();
    this._dv = new THREE.Vector3();
  }

  // 목표 위치로 향하는 속도를 1차 필터로 따라가되, 최고 속도와 가속(추력)에
  // 상한을 둬 모드 전환 같은 목표 점프에서도 화면이 튀지 않게 한다.
  _follow(stiff, maxV, maxAccel, dt) {
    this._targetVel.copy(this._desired).sub(this.pos).multiplyScalar(stiff);
    if (this._targetVel.lengthSq() > maxV * maxV) this._targetVel.setLength(maxV);
    this._dv.copy(this._targetVel).sub(this.vel).multiplyScalar(1 - Math.exp(-5.5 * dt));
    const maxDv = maxAccel * dt;
    if (this._dv.lengthSq() > maxDv * maxDv) this._dv.setLength(maxDv);
    this.vel.add(this._dv);
    this.pos.addScaledVector(this.vel, dt);
  }

  snapTo(bikePos, dir) {
    this.pos.set(
      bikePos.x - dir.x * 13 + dir.z * 1.5,
      bikePos.y + 7.4,
      bikePos.z - dir.z * 13 - dir.x * 1.5
    );
    this.vel.set(0, 0, 0);
    this.mode = MODE.CHASE;
    this.rig.back = 13; this.rig.up = 7.4; this.rig.side = 1.2;
    this.rig.fov = 40; this.rig.lookAhead = 14; this.rig.swing = 0;
    this.fov = 40;
    this.roll = 0; this.rollVel = 0;
    this.lookPos.set(bikePos.x + dir.x * 14, bikePos.y + 0.9, bikePos.z + dir.z * 14);
  }

  // 다중 옥타브 드론 부유 노이즈 (기계적 반복감이 안 나도록 무리수 주파수)
  _drift(axis) {
    const t = this.noiseT;
    if (axis === 0) return Math.sin(t * 0.61) * 0.6 + Math.sin(t * 1.37 + 1.1) * 0.28 + Math.sin(t * 2.9 + 2.3) * 0.11;
    if (axis === 1) return Math.cos(t * 0.47 + 0.5) * 0.55 + Math.cos(t * 1.13 + 2.2) * 0.25 + Math.sin(t * 2.41) * 0.1;
    return Math.sin(t * 0.53 + 1.9) * 0.6 + Math.cos(t * 1.21 + 0.3) * 0.26 + Math.sin(t * 3.1 + 1.2) * 0.1;
  }

  // ctx: {bikePos, dir, dirAhead, speed, accel, airborne, predictedAir, floatZone,
  //       turnRate, minY, dt, time, crashed}
  update(ctx) {
    const { bikePos, dir, dt } = ctx;
    this.noiseT += dt;

    // ---- 모드 전이 ----
    if (ctx.crashed) {
      if (this.mode !== MODE.LONG) { this.anchor.copy(this.pos); this.mode = MODE.LONG; }
    } else if (ctx.airborne && ctx.predictedAir > 1.05 && this.mode !== MODE.LONG) {
      this.mode = MODE.LONG;
      this.anchor.copy(this.pos);
      this.anchorDrift.set(dir.z, 0.12, -dir.x).multiplyScalar(2.2); // 옆으로 슬로 드리프트
      this.longTimer = 0;
    } else if (this.mode === MODE.LONG) {
      if (!ctx.airborne && !ctx.crashed) {
        this.longTimer += dt;
        if (this.longTimer > 0.45) this.mode = ctx.floatZone ? MODE.LOW : MODE.CHASE;
      }
    } else {
      this.mode = ctx.floatZone ? MODE.LOW : MODE.CHASE;
    }

    const lat = this._tmp.set(dir.z, 0, -dir.x);
    const speedT = Math.min(1, Math.max(0, (ctx.speed - 6) / 18));
    const accel = Math.max(-4, Math.min(8, ctx.accel || 0));

    if (this.mode === MODE.LONG) {
      // ---- 망원 고정 샷 ----
      this.anchor.addScaledVector(this.anchorDrift, dt);
      this._desired.copy(this.anchor);
      this.rig.fov = damp(this.rig.fov, ctx.crashed ? 34 : 27, 3.4, dt);
      this.rig.lookAhead = damp(this.rig.lookAhead, 0, 4, dt);
      // 고정 샷은 좀 더 단단하게 붙잡되 여전히 스프링으로
      this._follow(6.5, 40, 60, dt);
      this.rollTarget = this._drift(1) * 0.02;
    } else {
      // ---- 목표 리그 (모드별) ----
      let tBack, tUp, tSide, tFov, tLook;
      if (this.mode === MODE.LOW) {
        tBack = 7.5; tUp = 5.2; tSide = 3.6; tFov = 68 + speedT * 10; tLook = 9;
      } else if (ctx.airborne) {
        tBack = 10.5; tUp = 6.0; tSide = 2.6; tFov = 56 + speedT * 12; tLook = 8;
      } else {
        tBack = 15.5 - speedT * 6.5;   // 15.5m → 9.0m
        tUp = 7.4 - speedT * 1.5;      // 7.4m → 5.9m
        tSide = 1.1 + speedT * 1.4;
        tFov = 32 + speedT * 54;       // 32° → 86°
        tLook = 16 - speedT * 10;      // 망원일수록 멀리 조준(지평선 유지)
      }
      // 가속 반응: 밟으면 드론이 뒤로 밀리며 화각이 열린다
      tBack += Math.max(-1.2, accel * 0.32);
      tFov += Math.max(-5, accel * 1.6);

      // 리그 파라미터를 개별 보간 — 모드 전환/속도 변화가 화면에서 부드럽게 흐른다
      const R = this.rig;
      R.back = damp(R.back, tBack, 2.6, dt);
      R.up = damp(R.up, tUp, 2.2, dt);
      R.side = damp(R.side, tSide, 2.0, dt);
      R.fov = damp(R.fov, tFov, 2.8, dt);
      R.lookAhead = damp(R.lookAhead, tLook, 2.4, dt);

      // 코너 스윙: 바깥쪽으로 크게 돌아나가되 천천히 붙는다
      const turnSwing = Math.max(-4.5, Math.min(4.5, ctx.turnRate * -7.5));
      const idleSwing = R.side * (0.6 + 0.4 * this._drift(0));
      R.swing = damp(R.swing, idleSwing + turnSwing, 1.9, dt);

      const noiseAmp = 0.35 + speedT * 0.85;
      this._desired.set(
        bikePos.x - dir.x * R.back + lat.x * R.swing + this._drift(0) * 0.5 * noiseAmp,
        Math.max(bikePos.y + R.up + this._drift(1) * 0.42 * noiseAmp, 0.8),
        bikePos.z - dir.z * R.back + lat.z * R.swing + this._drift(2) * 0.45 * noiseAmp
      );
      // 에어 중엔 상승분을 절반만 따라가 점프 높이가 드러난다
      if (ctx.airborne) this._desired.y = Math.max(bikePos.y * 0.55 + 5.4, 3.0);

      // 위치 스프링: 낮은 강성 + 관성 = 드론이 날아와 붙는 느낌
      // 속도/추력 상한이 망원샷 복귀 때의 순간이동 같은 추격을 막는다
      this._follow(ctx.airborne ? 3.4 : 5.2, 14 + ctx.speed * 2.0, 75, dt);

      // 업벡터 뱅킹: 코너에서 드론이 크게 기울었다가 천천히 돌아온다
      this.rollTarget = Math.max(-0.52, Math.min(0.52, ctx.turnRate * 1.05))
        + this._drift(1) * 0.028 * noiseAmp;
      if (accel > 2.5) this.shake = Math.max(this.shake, 0.2); // 엔진 진동
    }

    // 지형 클리어런스: 하드 스냅 대신 부드럽게 밀어올림 (끊김 방지)
    if (ctx.minY !== undefined && this.pos.y < ctx.minY) {
      this.pos.y = damp(this.pos.y, ctx.minY, 14, dt);
      if (this.vel.y < 0) this.vel.y *= 0.4;
    }

    // ---- 룩앳 ----
    const ld = ctx.dirAhead || dir;
    this._lookTarget.set(
      bikePos.x + ld.x * this.rig.lookAhead,
      bikePos.y + 0.9,
      bikePos.z + ld.z * this.rig.lookAhead
    );
    this.lookPos.lerp(this._lookTarget, 1 - Math.exp(-(this.mode === MODE.LONG ? 9 : 5.5) * dt));

    // ---- 셰이크 / 롤 / FOV 적용 ----
    this.shake = Math.max(0, this.shake - dt * 1.9);
    const sh = this.shake * this.shake;
    const hf = this.noiseT * 34;
    this.camera.position.copy(this.pos);
    this.camera.position.x += (Math.sin(hf) * 0.6 + Math.sin(hf * 1.77 + 1.3) * 0.4) * sh * 0.9;
    this.camera.position.y += (Math.cos(hf * 1.31) * 0.6 + Math.sin(hf * 2.3) * 0.4) * sh * 0.75;
    this.camera.position.z += Math.sin(hf * 1.13 + 2.1) * sh * 0.6;
    this.camera.lookAt(this.lookPos);

    // 롤은 스프링(관성)으로 — 코너 진입/탈출에 무게감이 생긴다
    const rollK = 14, rollC = 6.4;
    this.rollVel += ((this.rollTarget - this.roll) * rollK - this.rollVel * rollC) * dt;
    this.roll += this.rollVel * dt;
    this.camera.rotateZ(this.roll + Math.sin(hf * 0.9) * sh * 0.05);

    this.fov = damp(this.fov, this.rig.fov, this.mode === MODE.LONG ? 3.4 : 4.0, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  kick(amount) { this.shake = Math.min(1, this.shake + amount); }
}
