// 포테이토헤드식 부속 — 팔·다리·눈·머리카락.
// 책이 머리이자 몸통(가분수)이고, 여기 만드는 것들은 거기에 "꽂히는" 부품이다.
// 그래서 전부 작고 뭉툭하다. 표지가 계속 정면에 보여야 하므로 얼굴 위를 덮지 않는다.

import * as THREE from 'three';

const SKIN = 0xf2dcc0;

export function capsule(r, len, color, seg = 8) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 3, seg);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.72 }));
  m.position.y = -len / 2; // 위쪽 끝이 관절에 오도록
  m.castShadow = true;
  return m;
}

// 고무호스 사지 — 위마디/아래마디/끝(글러브·신발)
// 반환: { root, joint, end } — root와 joint의 rotation만 돌리면 FK로 움직인다.
export function makeLimb({ upperLen, lowerLen, radius, endRadius, color, endColor, boot }) {
  const root = new THREE.Group();
  root.add(capsule(radius, upperLen, color));

  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  root.add(joint);
  joint.add(capsule(radius * 0.92, lowerLen, color));

  const end = new THREE.Group();
  end.position.y = -lowerLen;
  joint.add(end);

  if (boot) {
    // 신발 — 상자 + 둥근 앞코. 앞코가 있어야 만화 신발로 읽힌다.
    const m = new THREE.MeshStandardMaterial({ color: endColor, roughness: 0.5 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(endRadius * 1.7, endRadius * 1.15, endRadius * 2.4), m);
    base.position.set(0, -endRadius * 0.55, endRadius * 0.45);
    base.castShadow = true;
    end.add(base);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(endRadius * 0.95, 12, 10), m);
    toe.position.set(0, -endRadius * 0.6, endRadius * 1.5);
    toe.scale.set(0.9, 0.75, 1);
    toe.castShadow = true;
    end.add(toe);
  } else {
    // 글러브 — 구 + 엄지
    const gm = new THREE.MeshStandardMaterial({ color: endColor, roughness: 0.42 });
    const glove = new THREE.Mesh(new THREE.SphereGeometry(endRadius, 14, 12), gm);
    glove.scale.set(1, 0.95, 1.15);
    glove.position.y = -endRadius * 0.55;
    glove.castShadow = true;
    end.add(glove);
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(endRadius * 0.42, 10, 8), gm);
    thumb.position.set(0, -endRadius * 0.45, endRadius * 0.75);
    end.add(thumb);
    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.25, radius * 1.25, radius * 1.1, 10),
      new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.8 })
    );
    cuff.position.y = radius * 0.2;
    end.add(cuff);
  }
  return { root, joint, end };
}

// 얼굴 — 표지 위에 인쇄된 스티커처럼 붙는 평면 눈·눈썹·입.
// 구체 눈알을 책 위에 얹으면 분리된 부속처럼 보였다. 평면 원판이 만화 표정을 만든다.
// MeshBasicMaterial(조명 무시)이라 어느 조명에서도 스티커처럼 또렷하다.
export function makeFace(w, h) {
  const g = new THREE.Group();
  const BLACK = new THREE.MeshBasicMaterial({ color: 0x17130f });
  const WHITE = new THREE.MeshBasicMaterial({ color: 0xfffdf4 });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CircleGeometry(0.135, 20), BLACK);
    const ball = new THREE.Mesh(new THREE.CircleGeometry(0.117, 20), WHITE);
    ball.position.z = 0.004;
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), BLACK);
    pupil.position.set(0, -0.012, 0.008);
    // KO용 X자 눈
    const xg = new THREE.Group();
    for (const a of [0.785, -0.785]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.042), BLACK);
      bar.rotation.z = a;
      bar.position.z = 0.008;
      xg.add(bar);
    }
    xg.visible = false;
    // 눈썹 — 표정의 전부. 기울기만 바꿔도 화남/아픔이 된다.
    const brow = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.05), BLACK);
    brow.position.set(0, 0.175, 0.006);
    e.add(rim, ball, pupil, xg, brow);
    e.position.set(s * w * 0.21, h * 0.2, 0);
    e.userData = { ball, pupil, x: xg, brow, side: s };
    g.add(e);
    eyes.push(e);
  }
  // 입 — 말할 때 세로로 벌어진다. 평소엔 가는 미소 선.
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.105, 20), BLACK);
  mouth.position.set(0, h * 0.0, 0.004);
  mouth.scale.set(1.2, 0.24, 1);
  g.add(mouth);
  return { group: g, eyes, mouth };
}

// ── 머리 모양 ───────────────────────────────────────────────
// 책 윗변에 꽂는다. 실루엣만으로 누구인지 알아보게 하는 게 목적.
const HAIR = {
  topknot(g, w, M) {
    g.add(dome(w * 0.5, 0.13, M.hair));
    const bun = ball(0.17, M.hair);
    bun.position.y = 0.2;
    g.add(bun);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.44, 6), M.gold);
    pin.rotation.z = Math.PI / 2;
    pin.position.y = 0.2;
    g.add(pin);
  },
  antennae(g, w, M) {
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.46, 6), M.hair);
      a.position.set(s * 0.16, 0.2, 0);
      a.rotation.z = s * 0.5;
      g.add(a);
      const tip = ball(0.055, M.hair);
      tip.position.set(s * 0.32, 0.4, 0);
      g.add(tip);
    }
  },
  bob_ribbon(g, w, M) {
    g.add(dome(w * 0.56, 0.24, M.hair));
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 3, 8), M.hair);
      side.position.set(s * w * 0.44, -0.2, 0);
      g.add(side);
    }
    for (const s of [-1, 1]) {
      const bow = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), M.accent);
      bow.scale.set(1.5, 0.75, 0.5);
      bow.position.set(s * 0.17, 0.2, 0.1);
      bow.rotation.z = s * 0.5;
      g.add(bow);
    }
  },
  bun(g, w, M) {
    g.add(dome(w * 0.5, 0.15, M.hair));
    const b = ball(0.2, M.hair);
    b.position.set(0, 0.12, -0.2);
    b.scale.set(1, 0.85, 1);
    g.add(b);
  },
  renaissance(g, w, M) {
    g.add(dome(w * 0.54, 0.2, M.hair));
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 3, 8), M.hair);
      side.position.set(s * w * 0.43, -0.16, 0);
      g.add(side);
    }
  },
  prince_crown(g, w, M) {
    g.add(dome(w * 0.52, 0.19, M.hair));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.3, 0.09, 12, 1, true), M.gold);
    band.position.y = 0.22;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 5), M.gold);
      const a = (i / 5) * Math.PI * 2;
      sp.position.set(Math.cos(a) * w * 0.3, 0.33, Math.sin(a) * w * 0.3);
      g.add(sp);
    }
  },
  half_split(g, w, M) {
    // 지킬/하이드 — 한쪽은 단정, 한쪽은 헝클어짐
    const neat = dome(w * 0.5, 0.15, M.hair);
    neat.scale.x = 0.5;
    neat.position.x = -w * 0.14;
    g.add(neat);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.3 + (i % 3) * 0.1, 5), M.hair);
      sp.position.set(w * 0.08 + i * 0.08, 0.14 + (i % 2) * 0.06, (i % 3 - 1) * 0.06);
      sp.rotation.z = -0.4 - i * 0.1;
      g.add(sp);
    }
  },
  slick_part(g, w, M) {
    const d = dome(w * 0.52, 0.14, M.hair);
    d.scale.z = 0.9;
    g.add(d);
    const part = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, w * 0.5), M.skin);
    part.position.set(-w * 0.1, 0.13, 0);
    g.add(part);
  },
  flattop_bolt(g, w, M) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 0.26, w * 0.5), M.hair);
    box.position.y = 0.12;
    box.castShadow = true;
    g.add(box);
    for (const s of [-1, 1]) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8), M.metal);
      bolt.rotation.z = Math.PI / 2;
      bolt.position.set(s * (w * 0.46 + 0.06), -0.04, 0);
      g.add(bolt);
    }
  },
  widows_peak(g, w, M) {
    const d = dome(w * 0.5, 0.16, M.hair);
    g.add(d);
    const peak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 4), M.hair);
    peak.rotation.x = Math.PI;
    peak.position.set(0, -0.06, 0.12);
    g.add(peak);
    for (const s of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 5), M.hair);
      sw.position.set(s * w * 0.3, 0.16, -0.14);
      sw.rotation.x = 0.7;
      g.add(sw);
    }
  },
  ringlets(g, w, M) {
    g.add(dome(w * 0.5, 0.14, M.hair));
    for (let i = 0; i < 8; i++) {
      const s = i < 4 ? -1 : 1;
      const k = i % 4;
      const c = ball(0.085, M.hair);
      c.position.set(s * (w * 0.4 + (k % 2) * 0.05), 0.06 - k * 0.13, (k % 2 ? 0.06 : -0.06));
      g.add(c);
    }
  },
  bald_beard(g, w, M) {
    // 다윈 — 머리는 벗어졌고 수염이 얼굴을 덮는다
    const fringe = new THREE.Mesh(new THREE.TorusGeometry(w * 0.34, 0.06, 6, 16, Math.PI), M.hair);
    fringe.rotation.set(Math.PI / 2, 0, 0);
    fringe.position.y = -0.02;
    g.add(fringe);
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), M.hair);
    beard.scale.set(1, 1.25, 0.6);
    beard.position.set(0, -2.0, 0.16);
    beard.castShadow = true;
    g.add(beard);
  },
  captain(g, w, M) {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.54, 0.06, 14), M.dark);
    brim.position.y = 0.04;
    g.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.4, w * 0.44, 0.22, 14), M.dark);
    crown.position.y = 0.17;
    crown.castShadow = true;
    g.add(crown);
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10), M.gold);
    badge.position.set(0, 0.17, w * 0.42);
    g.add(badge);
  },
  messy(g, w, M) {
    for (let i = 0; i < 9; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24 + ((i * 7) % 4) * 0.09, 5), M.hair);
      const a = (i / 9) * Math.PI * 2;
      sp.position.set(Math.cos(a) * w * 0.28, 0.1, Math.sin(a) * w * 0.2);
      sp.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      g.add(sp);
    }
    g.add(dome(w * 0.46, 0.1, M.hair));
  },
  basin_helm(g, w, M) {
    // 돈키호테 — 이발사의 놋대야를 투구라 우긴다
    const basin = new THREE.Mesh(new THREE.SphereGeometry(w * 0.46, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.metal);
    basin.position.y = 0.04;
    basin.castShadow = true;
    g.add(basin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(w * 0.46, 0.035, 6, 18), M.metal);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.04;
    g.add(rim);
  },
  big_beard(g, w, M) {
    g.add(dome(w * 0.5, 0.16, M.hair));
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), M.hair);
    beard.scale.set(1, 1.5, 0.62);
    beard.position.set(0, -2.05, 0.14);
    beard.castShadow = true;
    g.add(beard);
  },
};

function dome(r, h, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  m.scale.y = h / r;
  m.castShadow = true;
  return m;
}
function ball(r, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
  m.castShadow = true;
  return m;
}

const HAIR_COLOR = {
  topknot: 0x1a1512,
  antennae: 0x2a2118,
  bob_ribbon: 0xe0b552,
  bun: 0x4a3a2c,
  renaissance: 0x2e2318,
  prince_crown: 0x3b2a1c,
  half_split: 0x5a4632,
  slick_part: 0x2b1f16,
  flattop_bolt: 0x14120f,
  widows_peak: 0x111014,
  ringlets: 0x503a26,
  bald_beard: 0xd8d2c8,
  captain: 0x2b2621,
  messy: 0x3a2f24,
  basin_helm: 0x9aa3ad,
  big_beard: 0xd6cec2,
};

export function makeHair(style, w, accentColor) {
  const g = new THREE.Group();
  const fn = HAIR[style];
  if (!fn) return { group: g, style: null };
  const c = HAIR_COLOR[style] ?? 0x2e2318;
  const M = {
    hair: new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 0.35, metalness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.3, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.8 }),
    skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 }),
    accent: new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.6 }),
  };
  fn(g, w, M);
  return { group: g, style, materials: M };
}

export { SKIN };
