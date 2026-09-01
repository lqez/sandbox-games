// camera.js — FPV 드론캠 디렉터
// chase: 광각 추격(FOV 78~95, 속도 반응) / longlens: 빅에어 망원(원거리 고정 + FOV 28)
// lowside: 부유 램프 구간 수면 스치는 측면 샷
import * as THREE from 'three';

const MODE = { CHASE: 0, LONG: 1, LOW: 2 };

export class DroneCam {
  constructor(camera) {
    this.camera = camera;
    this.mode = MODE.CHASE;
    this.pos = new THREE.Vector3(0, 6, -12);
    this.vel = new THREE.Vector3();
    this.lookPos = new THREE.Vector3();
    this.fov = 82;
    this.targetFov = 82;
    this.roll = 0;
    this.rollTarget = 0;
    this.anchor = new THREE.Vector3();  // 망원 고정 위치
    this.anchorDrift = new THREE.Vector3();
    this.longTimer = 0;
    this.noiseT = Math.random() * 100;
    this.shake = 0;
    this._tmp = new THREE.Vector3();
    this._desired = new THREE.Vector3();
  }

  snapTo(bikePos, dir) {
    this.pos.set(
      bikePos.x - dir.x * 9 + dir.z * 2,
      bikePos.y + 3.4,
      bikePos.z - dir.z * 9 - dir.x * 2
    );
    this.vel.set(0, 0, 0);
    this.mode = MODE.CHASE;
    this.fov = this.targetFov = 82;
  }

  // ctx: {bikePos, dir, speed, airborne, airTime, predictedAir, floatZone, turnRate, dt, time, crashed, finished}
  update(ctx) {
    const { bikePos, dir, dt } = ctx;
    this.noiseT += dt;

    // ---- 모드 전이 ----
    if (ctx.crashed) {
      // 크래시: 현재 위치에 멈춰 망원 줌인
      if (this.mode !== MODE.LONG) { this.anchor.copy(this.pos); this.mode = MODE.LONG; }
      this.targetFov = 34;
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

    // ---- 목표 위치/FOV ----
    const n1 = Math.sin(this.noiseT * 0.9) + Math.sin(this.noiseT * 2.17) * 0.5;
    const n2 = Math.cos(this.noiseT * 0.73) + Math.sin(this.noiseT * 1.71) * 0.5;
    const lat = this._tmp.set(dir.z, 0, -dir.x);

    if (this.mode === MODE.LONG) {
      this.anchor.addScaledVector(this.anchorDrift, dt);
      this._desired.copy(this.anchor);
      this.targetFov = ctx.crashed ? 34 : 27;
      const stiff = 7;
      this.vel.lerp(this._desired.clone().sub(this.pos).multiplyScalar(stiff), 1 - Math.exp(-10 * dt));
      this.pos.addScaledVector(this.vel, dt);
      this.rollTarget = n1 * 0.008;
    } else {
      // 속도 정규화: 저속 0 → 고속 1
      const speedT = Math.min(1, Math.max(0, (ctx.speed - 6) / 18));
      let back, up, side, fovBase, noiseAmp;
      if (this.mode === MODE.LOW) {
        back = 6.5; up = 1.15; side = 3.6; fovBase = 68 + speedT * 10; noiseAmp = 1;
      } else if (ctx.airborne) {
        // 에어: 살짝 빠지고 낮게 깔리는 중간 화각 — 하늘 배경으로 실루엣 강조
        back = 9.5; up = 2.2; side = 2.6; fovBase = 56 + speedT * 12; noiseAmp = 0.6;
      } else {
        // 저속 = 멀리서 망원 압축 / 고속 = 바짝 붙은 광각 FPV
        back = 14.5 - speedT * 8.0;   // 14.5m → 6.5m
        up = 3.9 - speedT * 1.2;      // 3.9m → 2.7m
        side = 1.1 + speedT * 1.4;
        fovBase = 40 + speedT * 46;   // 40° → 86°
        noiseAmp = 0.25 + speedT * 0.75; // 망원일 땐 드론 흔들림 억제
      }
      const swing = side * (0.6 + 0.4 * Math.sin(this.noiseT * 0.35)) + ctx.turnRate * -14;
      this._desired.set(
        bikePos.x - dir.x * back + lat.x * swing + n1 * 0.35 * noiseAmp,
        Math.max(bikePos.y + up + n2 * 0.25 * noiseAmp, 0.8),
        bikePos.z - dir.z * back + lat.z * swing + n1 * 0.3 * noiseAmp
      );
      // 에어 중엔 드론이 바이크보다 낮게 따라붙으며 하늘을 크게 보여줌
      if (ctx.airborne) this._desired.y = Math.max(bikePos.y * 0.72 + 2.0, 1.2);
      const stiff = ctx.airborne ? 5.5 : 8.5;
      this.vel.lerp(this._desired.clone().sub(this.pos).multiplyScalar(stiff), 1 - Math.exp(-9 * dt));
      this.pos.addScaledVector(this.vel, dt);
      this.targetFov = fovBase;
      this.rollTarget = ctx.turnRate * 9 + n2 * 0.012 * noiseAmp;
    }

    // ---- 룩앳 / 롤 / FOV / 셰이크 ----
    const lookAhead = this.mode === MODE.LONG ? 0 : 4.5;
    this.lookPos.lerp(
      this._tmp.set(
        bikePos.x + dir.x * lookAhead,
        bikePos.y + 0.9,
        bikePos.z + dir.z * lookAhead
      ),
      1 - Math.exp(-(this.mode === MODE.LONG ? 16 : 10) * dt)
    );

    this.shake = Math.max(0, this.shake - dt * 2.4);
    const sh = this.shake * this.shake;
    this.camera.position.copy(this.pos);
    this.camera.position.x += (Math.sin(this.noiseT * 31) * 0.5 + Math.sin(this.noiseT * 57) * 0.5) * sh * 0.5;
    this.camera.position.y += Math.sin(this.noiseT * 41) * sh * 0.4;
    this.camera.lookAt(this.lookPos);
    this.roll += (this.rollTarget - this.roll) * (1 - Math.exp(-6 * dt));
    this.camera.rotateZ(this.roll);

    const fovSpeed = this.mode === MODE.LONG ? 5.0 : 5.5;
    this.fov += (this.targetFov - this.fov) * (1 - Math.exp(-fovSpeed * dt));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  kick(amount) { this.shake = Math.min(1, this.shake + amount); }
}
