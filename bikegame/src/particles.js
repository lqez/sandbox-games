// particles.js — 더트 먼지 / 물 스플래시 파티클 (Points 재사용 풀)
import * as THREE from 'three';

const MAX = 240;

export function createParticles(scene) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // 원형 소프트 스프라이트 (사각 포인트 방지)
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = 32;
  const c2 = cnv.getContext('2d');
  const grad = c2.createRadialGradient(16, 16, 2, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  c2.fillStyle = grad;
  c2.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cnv);
  const mat = new THREE.PointsMaterial({
    size: 0.6, vertexColors: true, transparent: true, opacity: 0.8,
    depthWrite: false, sizeAttenuation: true, map: tex,
  });
  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  scene.add(points);

  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  let cursor = 0;

  function spawn(x, y, z, count, spread, up, color) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = cursor; cursor = (cursor + 1) % MAX;
      positions[i * 3] = x + (Math.random() - 0.5) * 0.6;
      positions[i * 3 + 1] = y + Math.random() * 0.3;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
      vel[i * 3] = (Math.random() - 0.5) * spread;
      vel[i * 3 + 1] = Math.random() * up + up * 0.3;
      vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
      life[i] = 0.6 + Math.random() * 0.5;
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
  }

  return {
    dust(x, y, z, count) { spawn(x, y, z, count || 6, 3.2, 1.6, 0xd9bb85); },
    splash(x, z, count) { spawn(x, 0.15, z, count || 40, 5.5, 5.2, 0xd6f2f2); },
    update(dt) {
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) { positions[i * 3 + 1] = -50; continue; }
        life[i] -= dt;
        vel[i * 3 + 1] -= 7.5 * dt;
        positions[i * 3] += vel[i * 3] * dt;
        positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
        positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geom.attributes.position.needsUpdate = true;
      geom.attributes.color.needsUpdate = true;
    },
    dispose() { scene.remove(points); geom.dispose(); mat.dispose(); },
  };
}
