// 표지를 캔버스로 그린다. 외부 이미지를 받지 않고도(정적 호스팅) 실제 판본의 인상을 낸다 —
// 천 장정 바탕 + 금박 테두리 + 작품 상징 + 제목/저자/출간연도.

const KR_FONT = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif";
const SERIF = "'Iowan Old Style','Georgia','Times New Roman',serif";

const W = 512;
const H = 768;

function noise(ctx, w, h, amount, alpha) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // 결정론적 해시 노이즈 — 프레임마다 흔들리면 안 된다
    const p = i / 4;
    let n = (p * 2654435761) % 4294967296;
    n = ((n / 4294967296) - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  if (alpha) {
    ctx.globalAlpha = alpha;
    ctx.globalAlpha = 1;
  }
}

// 세로 천 결
function clothTexture(ctx, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 3) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = '#000000';
  for (let y = 0; y < H; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 가장자리 그늘(비네트)
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function frame(ctx, style, accent) {
  ctx.strokeStyle = accent;
  ctx.lineJoin = 'miter';
  if (style === 'classic') {
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 5;
    ctx.strokeRect(30, 30, W - 60, H - 60);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(44, 44, W - 88, H - 88);
    // 네 귀퉁이 장식
    ctx.lineWidth = 3;
    const c = 30;
    const s = 26;
    for (const [x, y, dx, dy] of [
      [c, c, 1, 1],
      [W - c, c, -1, 1],
      [c, H - c, 1, -1],
      [W - c, H - c, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * s, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + dx * 14, y + dy * 14, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
    }
  } else if (style === 'gothic') {
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    ctx.strokeRect(26, 26, W - 52, H - 52);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(26, 120);
    ctx.lineTo(W - 26, 120);
    ctx.moveTo(26, H - 120);
    ctx.lineTo(W - 26, H - 120);
    ctx.stroke();
  } else if (style === 'deco') {
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
      ctx.strokeRect(26 + i * 9, 26 + i * 9, W - 52 - i * 18, H - 52 - i * 18);
      ctx.globalAlpha -= 0.24;
    }
    ctx.globalAlpha = 0.9;
    // 상하 부채살
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2, 96);
      ctx.lineTo(W / 2 + i * 46, 26);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  } else {
    // modern — 굵은 색면 하나
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = accent;
    ctx.fillRect(0, H - 210, W, 10);
    ctx.fillRect(40, 40, 96, 10);
  }
  ctx.globalAlpha = 1;
}

// ── 작품 상징 ────────────────────────────────────────────────
const MOTIFS = {
  whale(ctx, c) {
    // 향유고래 옆모습 — 뭉툭한 사각 머리가 특징이라 그 실루엣을 살려야 고래로 읽힌다
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-150, -46); // 머리 앞 위
    ctx.lineTo(-146, 16); // 머리 앞 아래(거의 수직으로 뚝 떨어진다)
    ctx.quadraticCurveTo(-120, 34, -74, 34); // 아래턱 선
    ctx.bezierCurveTo(0, 46, 70, 34, 104, 16); // 배
    ctx.lineTo(140, 46); // 꼬리 아래 갈퀴
    ctx.quadraticCurveTo(126, 6, 150, -34); // 꼬리 위 갈퀴
    ctx.bezierCurveTo(112, -22, 60, -46, 0, -50); // 등
    ctx.quadraticCurveTo(-90, -54, -150, -46);
    ctx.closePath();
    ctx.fill();
    // 가슴지느러미
    ctx.beginPath();
    ctx.moveTo(-58, 26);
    ctx.quadraticCurveTo(-30, 62, -74, 66);
    ctx.quadraticCurveTo(-78, 44, -58, 26);
    ctx.fill();
    // 물기둥 — 향유고래는 앞쪽으로 비스듬히 뿜는다
    ctx.strokeStyle = c;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (const a of [0, 0.26, -0.22]) {
      ctx.beginPath();
      ctx.moveTo(-138, -50);
      ctx.quadraticCurveTo(-166 + a * 30, -92, -186 + a * 70, -126);
      ctx.stroke();
    }
    ctx.fillStyle = '#0b1a26';
    ctx.beginPath();
    ctx.arc(-106, -6, 7, 0, Math.PI * 2);
    ctx.fill();
  },
  axe(ctx, c) {
    ctx.fillStyle = c;
    ctx.save();
    ctx.rotate(-0.42);
    ctx.fillRect(-9, -30, 18, 176);
    ctx.beginPath();
    ctx.moveTo(-8, -102);
    ctx.bezierCurveTo(74, -104, 104, -60, 92, -8);
    ctx.lineTo(-8, -14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
  rabbit(ctx, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(0, 40, 54, 66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -34, 36, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 20, -92, 13, 46, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
    // 회중시계
    ctx.strokeStyle = c;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(74, 58, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(74, 58);
    ctx.lineTo(74, 40);
    ctx.moveTo(74, 58);
    ctx.lineTo(88, 62);
    ctx.stroke();
  },
  crown(ctx, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-110, 60);
    ctx.lineTo(-92, -56);
    ctx.lineTo(-40, 6);
    ctx.lineTo(0, -76);
    ctx.lineTo(40, 6);
    ctx.lineTo(92, -56);
    ctx.lineTo(110, 60);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-110, 72, 220, 22);
    ctx.fillStyle = '#00000055';
    for (const x of [-92, -40, 0, 40, 92]) {
      ctx.beginPath();
      ctx.arc(x, -62 + (x === 0 ? -14 : 0), 9, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  skull(ctx, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(0, -14, 76, 84, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -6, 76, 70, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillRect(-42, 52, 84, 34);
    ctx.fillStyle = '#00000088';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 32, -14, 22, 26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(-14, 40);
    ctx.lineTo(14, 40);
    ctx.closePath();
    ctx.fill();
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(i * 16 - 2, 52, 4, 34);
    }
  },
  flask(ctx, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-24, -96);
    ctx.lineTo(-24, -30);
    ctx.lineTo(-84, 84);
    ctx.lineTo(84, 84);
    ctx.lineTo(24, -30);
    ctx.lineTo(24, -96);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(-56, 30);
    ctx.lineTo(56, 30);
    ctx.lineTo(80, 78);
    ctx.lineTo(-80, 78);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillRect(-34, -110, 68, 16);
    // 기포
    for (const [x, y, r] of [[-20, 10, 7], [12, -4, 5], [30, 24, 9]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  eyes(ctx, c) {
    // 개츠비 — 재의 계곡 위 안과 광고판의 눈
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 74, 0);
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(0, 0, 58, 36, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(16, 0);
    ctx.moveTo(-132, -6);
    ctx.lineTo(-166, -22);
    ctx.moveTo(132, -6);
    ctx.lineTo(166, -22);
    ctx.stroke();
  },
  bolt(ctx, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(22, -122);
    ctx.lineTo(-58, 14);
    ctx.lineTo(-8, 14);
    ctx.lineTo(-34, 124);
    ctx.lineTo(60, -20);
    ctx.lineTo(6, -20);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 5;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, 128, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
  bat(ctx, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    for (const s of [-1, 1]) {
      ctx.moveTo(0, -18);
      ctx.bezierCurveTo(s * 44, -58, s * 96, -56, s * 156, -20);
      ctx.lineTo(s * 128, 2);
      ctx.lineTo(s * 140, 20);
      ctx.lineTo(s * 96, 12);
      ctx.lineTo(s * 100, 38);
      ctx.lineTo(s * 56, 20);
      ctx.bezierCurveTo(s * 34, 42, s * 12, 34, 0, 24);
      ctx.closePath();
    }
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -6, 18, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 6, -26);
      ctx.lineTo(s * 16, -50);
      ctx.lineTo(s * 20, -24);
      ctx.closePath();
      ctx.fill();
    }
  },
  rose(ctx, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 130; i++) {
      const a = i * 0.32;
      const r = 4 + a * 5.4;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.92;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, 60);
    ctx.quadraticCurveTo(-8, 120, 4, 158);
    ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 30, 106 + s * 10, 30, 13, s * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    }
  },
  finch(ctx, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(-6, 10, 62, 44, -0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-56, -30, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-82, -30);
    ctx.lineTo(-134, -18);
    ctx.lineTo(-80, -10);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(40, 4);
    ctx.lineTo(140, -34);
    ctx.lineTo(128, 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#00000099';
    ctx.beginPath();
    ctx.arc(-62, -36, 6, 0, Math.PI * 2);
    ctx.fill();
    // 앉은 가지
    ctx.strokeStyle = c;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-130, 78);
    ctx.lineTo(120, 62);
    ctx.stroke();
  },
  windmill(ctx, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-58, 150);
    ctx.lineTo(-34, -34);
    ctx.lineTo(34, -34);
    ctx.lineTo(58, 150);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.translate(0, -46);
    ctx.rotate(0.32);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(18, -18);
      ctx.lineTo(126, -30);
      ctx.lineTo(120, 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#00000066';
    ctx.beginPath();
    ctx.arc(0, -46, 12, 0, Math.PI * 2);
    ctx.fill();
  },
  eagle(ctx, c) {
    ctx.fillStyle = c;
    // 쌍두 독수리(러시아 문장) 단순화
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.bezierCurveTo(s * 40, -30, s * 110, -50, s * 150, -16);
      ctx.lineTo(s * 108, 16);
      ctx.lineTo(s * 132, 34);
      ctx.lineTo(s * 78, 34);
      ctx.lineTo(s * 88, 62);
      ctx.lineTo(s * 34, 40);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * 26, -52, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 46, -56);
      ctx.lineTo(s * 82, -46);
      ctx.lineTo(s * 46, -38);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(-26, 4, 52, 96);
    ctx.beginPath();
    ctx.moveTo(-26, 100);
    ctx.lineTo(26, 100);
    ctx.lineTo(0, 142);
    ctx.closePath();
    ctx.fill();
  },
  beetle(ctx, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(0, 16, 62, 88, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -74, 34, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * 46, -20 + i * 42);
        ctx.quadraticCurveTo(s * 108, -32 + i * 46, s * 122, 12 + i * 50);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(s * 16, -96);
      ctx.quadraticCurveTo(s * 44, -142, s * 78, -150);
      ctx.stroke();
    }
    ctx.strokeStyle = '#00000066';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, -46);
    ctx.lineTo(0, 100);
    ctx.stroke();
  },
  seal(ctx, c) {
    // 낙관(落款)풍 붉은 인장
    ctx.strokeStyle = c;
    ctx.lineWidth = 12;
    ctx.strokeRect(-88, -88, 176, 176);
    ctx.lineWidth = 14;
    ctx.lineCap = 'square';
    const strokes = [
      [-52, -46, 52, -46],
      [0, -46, 0, 46],
      [-52, 4, 52, 4],
      [-52, 52, 52, 52],
      [-52, -46, -52, 52],
      [52, -46, 52, 52],
    ];
    for (const [x1, y1, x2, y2] of strokes) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  },
  window(ctx, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = 11;
    ctx.strokeRect(-84, -116, 168, 232);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, -116);
    ctx.lineTo(0, 116);
    ctx.moveTo(-84, 0);
    ctx.lineTo(84, 0);
    ctx.stroke();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = c;
    ctx.fillRect(-78, -110, 72, 104);
    ctx.fillRect(6, 6, 72, 104);
    ctx.globalAlpha = 1;
    // 책상 위 펜
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(-110, 150);
    ctx.lineTo(110, 150);
    ctx.stroke();
  },
};

function wrapText(ctx, text, maxWidth) {
  // 한글은 어절 단위로 자르되, 한 어절이 너무 길면 글자 단위로 끊는다
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    if (line) lines.push(line);
    if (ctx.measureText(w).width <= maxWidth) {
      line = w;
    } else {
      let chunk = '';
      for (const ch of w) {
        if (ctx.measureText(chunk + ch).width > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function drawCover(book) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const { bg, fg, accent, motif, style } = book.cover;

  clothTexture(ctx, bg);
  frame(ctx, style, accent);

  // 상징
  ctx.save();
  ctx.translate(W / 2, H * 0.5);
  ctx.globalAlpha = 0.9;
  const draw = MOTIFS[motif] || MOTIFS.seal;
  draw(ctx, accent);
  ctx.restore();

  // 제목
  ctx.textAlign = 'center';
  ctx.fillStyle = fg;
  let size = book.title.length > 9 ? 50 : book.title.length > 6 ? 60 : 72;
  ctx.font = `800 ${size}px ${KR_FONT}`;
  let lines = wrapText(ctx, book.title, W - 130);
  // 띄어쓰기가 없는 제목(프랑켄슈타인 등)은 글자 중간에서 잘리면 안 된다 —
  // 한 줄에 들어갈 때까지 줄인다. 띄어쓰기가 있으면 두 줄까지 허용.
  const maxLines = book.title.includes(' ') ? 2 : 1;
  while (lines.length > maxLines && size > 28) {
    size -= 4;
    ctx.font = `800 ${size}px ${KR_FONT}`;
    lines = wrapText(ctx, book.title, W - 130);
  }
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 148 + i * (size + 8)));
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 원제
  ctx.globalAlpha = 0.66;
  ctx.fillStyle = accent;
  ctx.font = `italic 500 22px ${SERIF}`;
  const orig = wrapText(ctx, book.titleOrig, W - 140).slice(0, 2);
  orig.forEach((l, i) => ctx.fillText(l, W / 2, 152 + lines.length * (size + 8) + i * 26));
  ctx.globalAlpha = 1;

  // 저자
  ctx.fillStyle = fg;
  ctx.font = `700 32px ${KR_FONT}`;
  ctx.fillText(book.author, W / 2, H - 116);
  ctx.globalAlpha = 0.6;
  ctx.font = `500 19px ${SERIF}`;
  ctx.fillText(book.authorOrig, W / 2, H - 86);

  // 출간연도 + 분량
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = accent;
  ctx.font = `800 18px ${KR_FONT}`;
  ctx.fillText(`${book.yearLabel || book.year} · ${book.pages}쪽`, W / 2, H - 52);
  ctx.globalAlpha = 1;

  noise(ctx, W, H, 16);
  return cv;
}

// 뒤표지 — 오빗 컷에서 화면을 가득 채우는 면이라 비워둘 수 없다.
// 실제 책처럼 소개글(발췌) + 저자 한 줄 + 바코드/판권을 넣는다.
export function drawBackCover(book) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const { bg, fg, accent, style } = book.cover;

  clothTexture(ctx, bg);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.strokeRect(34, 34, W - 68, H - 68);
  ctx.globalAlpha = 1;

  // 소개글 — 이 책의 대표 문장을 뒤표지 카피처럼
  const blurb = book.quotes.finisher.line;
  ctx.textAlign = 'left';
  ctx.fillStyle = fg;
  let size = 30;
  ctx.font = `600 ${size}px ${KR_FONT}`;
  let lines = wrapText(ctx, `“${blurb}”`, W - 130);
  while (lines.length > 7 && size > 18) {
    size -= 2;
    ctx.font = `600 ${size}px ${KR_FONT}`;
    lines = wrapText(ctx, `“${blurb}”`, W - 130);
  }
  ctx.globalAlpha = 0.94;
  lines.forEach((l, i) => ctx.fillText(l, 66, 150 + i * (size + 12)));

  ctx.globalAlpha = 0.72;
  ctx.fillStyle = accent;
  ctx.font = `700 22px ${KR_FONT}`;
  ctx.fillText(`— ${book.author}, 『${book.title}』`, 66, 168 + lines.length * (size + 12));

  // 분류 한 줄
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = fg;
  ctx.font = `600 19px ${KR_FONT}`;
  ctx.fillText(`${book.genre} · ${book.nation} · ${book.yearLabel || book.year}`, 66, H - 250);
  ctx.fillText(`${book.traits.join(' · ')}`, 66, H - 220);

  // 바코드 + 판권
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(W - 232, H - 178, 176, 104);
  ctx.fillStyle = '#141110';
  let x = W - 220;
  // 쪽수를 씨앗 삼아 책마다 고정된 바코드. 곱셈은 Math.imul로 — 그냥 곱하면
  // 2^53을 넘겨 하위 비트가 0으로 뭉개지고 막대가 몇 개만 찍힌다.
  let seed = book.pages * 7919 + book.year;
  while (x < W - 74) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const w = 1 + ((seed >>> 3) % 4);
    if ((seed >>> 7) % 2) ctx.fillRect(x, H - 168, w, 72);
    x += w + 1 + ((seed >>> 11) % 3);
  }
  ctx.font = `700 13px ${KR_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`BF ${String(Math.abs(book.pages * 31 + book.year)).padStart(6, '0')}`, W - 144, H - 84);

  ctx.textAlign = 'left';
  ctx.fillStyle = fg;
  ctx.globalAlpha = 0.66;
  ctx.font = `800 20px ${KR_FONT}`;
  ctx.fillText('북파이트 문고', 66, H - 150);
  ctx.globalAlpha = 0.44;
  ctx.font = `600 16px ${KR_FONT}`;
  ctx.fillText(`${book.pages}쪽 · ${style}`, 66, H - 122);
  ctx.globalAlpha = 1;

  noise(ctx, W, H, 16);
  return cv;
}

// 책등 — 세로로 긴 캔버스. 제목이 위에서 아래로 읽힌다.
export function drawSpine(book) {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 768;
  const ctx = cv.getContext('2d');
  const { bg, fg, accent } = book.cover;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 768);
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 768);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.85;
  for (const y of [96, 116, 652, 672]) {
    ctx.beginPath();
    ctx.moveTo(18, y);
    ctx.lineTo(110, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(64, 384);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = fg;
  ctx.font = `800 44px ${KR_FONT}`;
  ctx.fillText(book.title, -40, 14);
  ctx.font = `600 24px ${KR_FONT}`;
  ctx.globalAlpha = 0.75;
  ctx.fillText(book.author, 200, 12);
  ctx.restore();
  return cv;
}

// 책배(페이지 단면) — 얇은 줄무늬로 종이 결을 만든다
export function drawPageEdge() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 2) {
    ctx.globalAlpha = 0.05 + ((i * 37) % 11) / 90;
    ctx.fillStyle = '#a9997a';
    ctx.fillRect(i, 0, 1, 256);
  }
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#8a7a5c';
  ctx.fillRect(0, 0, 256, 10);
  ctx.fillRect(0, 246, 256, 10);
  ctx.globalAlpha = 1;
  return cv;
}

// 날아가는 발췌문 종이 — 실제 문장을 텍스처로 구워서 던진다
export function drawQuoteSlip(quote, source, accent) {
  const w = 640;
  const h = 320;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f6f0df';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#c9bda0';
  ctx.lineWidth = 2;
  for (let y = 40; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(w - 24, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 12, h);

  ctx.fillStyle = '#241f18';
  ctx.textAlign = 'left';
  let size = quote.length > 70 ? 26 : quote.length > 40 ? 32 : 38;
  ctx.font = `700 ${size}px ${KR_FONT}`;
  let lines = wrapText(ctx, quote, w - 80);
  while (lines.length > 5 && size > 18) {
    size -= 3;
    ctx.font = `700 ${size}px ${KR_FONT}`;
    lines = wrapText(ctx, quote, w - 80);
  }
  const startY = (h - lines.length * (size + 10)) / 2 + size;
  lines.forEach((l, i) => ctx.fillText(l, 40, startY + i * (size + 10)));

  ctx.fillStyle = '#8a7a5c';
  ctx.font = `700 20px ${KR_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(`— ${source}`, w - 32, h - 22);
  return cv;
}
