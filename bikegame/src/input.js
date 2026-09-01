// input.js — 원버튼 홀드 + 공중 제스처 인식
// 직선 스와이프(상/하/좌/우) + 도형 제스처(원형 O, 지그재그 Z)를 인식한다.
// 인식은 라이브로 수행: 조건이 충족되는 즉시 onGesture 발화 (터치당 1회).

export function setupInput(el, cb) {
  const state = {
    held: false,
    heldSince: 0,
    releasedAt: -999,
  };

  const pointers = new Map(); // id → {pts:[{x,y,t}], fired}
  let anyDown = 0;

  function now() { return performance.now() / 1000; }

  function setHeld(v) {
    if (state.held === v) return;
    state.held = v;
    if (v) { state.heldSince = now(); cb.onHold && cb.onHold(); }
    else { state.releasedAt = now(); cb.onRelease && cb.onRelease(); }
  }

  function down(id, x, y) {
    pointers.set(id, { pts: [{ x, y, t: now() }], fired: false });
    anyDown++;
    setHeld(true);
  }
  function move(id, x, y) {
    const p = pointers.get(id);
    if (!p) return;
    const last = p.pts[p.pts.length - 1];
    if (Math.hypot(x - last.x, y - last.y) < 6) return;
    p.pts.push({ x, y, t: now() });
    if (p.pts.length > 90) p.pts.shift();
    if (!p.fired) {
      const g = classify(p.pts);
      if (g) { p.fired = true; cb.onGesture && cb.onGesture(g); }
    }
  }
  function up(id) {
    const p = pointers.get(id);
    if (p && !p.fired) {
      const g = classify(p.pts, true);
      if (g) cb.onGesture && cb.onGesture(g);
    }
    if (pointers.delete(id)) anyDown = Math.max(0, anyDown - 1);
    if (anyDown === 0) setHeld(false);
  }

  // ---- 제스처 분류 ----
  // 반환: 'up' | 'down' | 'left' | 'right' | 'circle-cw' | 'circle-ccw' | 'zigzag' | null
  function classify(pts, final) {
    if (pts.length < 3) return null;
    let pathLen = 0;
    for (let i = 1; i < pts.length; i++) {
      pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (pathLen < 55) return null;
    const dx = pts[pts.length - 1].x - pts[0].x;
    const dy = pts[pts.length - 1].y - pts[0].y;
    const straight = Math.hypot(dx, dy) / pathLen;

    // 누적 회전각 (원형 감지)
    let turn = 0;
    let prevA = null;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y;
      if (Math.hypot(ax, ay) < 4) continue;
      const a = Math.atan2(ay, ax);
      if (prevA !== null) {
        let d = a - prevA;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        turn += d;
      }
      prevA = a;
    }
    if (Math.abs(turn) > Math.PI * 1.7 && pathLen > 130) {
      return turn > 0 ? 'circle-cw' : 'circle-ccw';
    }

    // 코너 검출 (지그재그)
    const corners = countCorners(pts);
    if (corners >= 2 && pathLen > 150 && straight < 0.72) return 'zigzag';

    // 직선 스와이프: 충분히 곧고 (final 이거나 충분히 길면 즉시)
    if (straight > 0.82 && (final || pathLen > 85)) {
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
      return dy > 0 ? 'down' : 'up';
    }
    // 도형이 미완성일 수 있으니 final 전에는 보류
    if (final && corners === 1 && pathLen > 110) {
      return 'vee'; // V자 → 슈퍼맨
    }
    return null;
  }

  function countCorners(pts) {
    // 리샘플 후 급격한 방향 반전 카운트
    let corners = 0;
    let lastDir = null;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y;
      const len = Math.hypot(ax, ay);
      if (len < 8) { acc += len; continue; }
      const a = Math.atan2(ay, ax);
      if (lastDir !== null) {
        let d = Math.abs(a - lastDir);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d > 1.9) corners++; // ~110도 이상 꺾임
      }
      lastDir = a;
    }
    return corners;
  }

  // ---- 이벤트 바인딩 ----
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    down(e.pointerId, e.clientX, e.clientY);
  });
  el.addEventListener('pointermove', (e) => move(e.pointerId, e.clientX, e.clientY));
  el.addEventListener('pointerup', (e) => up(e.pointerId));
  el.addEventListener('pointercancel', (e) => up(e.pointerId));
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  // 데스크톱 보조: Space = 홀드, 화살표 = 트릭, Z = 지그재그, C = 원형, V = 슈퍼맨
  const KEYG = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyZ: 'zigzag', KeyC: 'circle-cw', KeyV: 'vee' };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') { e.preventDefault(); setHeld(true); }
    else if (KEYG[e.code]) cb.onGesture && cb.onGesture(KEYG[e.code]);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') setHeld(false);
  });
  window.addEventListener('blur', () => { pointers.clear(); anyDown = 0; setHeld(false); });

  return state;
}
