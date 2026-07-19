// card-icons.js — 카드별 전용 그래픽 아이콘 (이모지 대체, SD 프라모델 톤)
// 굵은 다크네이비 외곽선 + 플랫 컬러 + 하이라이트 한 줄 — 게임 카드와
// /rules 페이지가 같은 아트를 공유한다.

// 공용: 탑뷰 SD 전차 (위를 향함) — cx 중심, top이 차체 앞머리 y
const tankTop = (cx = 24, top = 20) => `
  <g stroke="#2b3445" stroke-linejoin="round">
    <rect x="${cx - 13}" y="${top + 2}" width="7" height="22" rx="3" fill="#454c5c" stroke-width="2.4"/>
    <rect x="${cx + 6}" y="${top + 2}" width="7" height="22" rx="3" fill="#454c5c" stroke-width="2.4"/>
    <path d="M${cx - 11.5} ${top + 6} h4 M${cx - 11.5} ${top + 11} h4 M${cx - 11.5} ${top + 16} h4 M${cx - 11.5} ${top + 21} h4
             M${cx + 7.5} ${top + 6} h4 M${cx + 7.5} ${top + 11} h4 M${cx + 7.5} ${top + 16} h4 M${cx + 7.5} ${top + 21} h4"
          stroke="#2b3445" stroke-width="1.3" opacity="0.55"/>
    <rect x="${cx - 8}" y="${top + 4}" width="16" height="18" rx="3" fill="#7d9b4e" stroke-width="2.4"/>
    <path d="M${cx - 6} ${top + 6.5} h12" stroke="#a6bf74" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
    <rect x="${cx - 1.4}" y="${top - 6}" width="2.8" height="14" rx="1" fill="#5e6b78" stroke-width="1.7"/>
    <circle cx="${cx}" cy="${top + 14}" r="5.4" fill="#93ac62" stroke-width="2.2"/>
    <circle cx="${cx - 1.6}" cy="${top + 12.4}" r="1.5" fill="#c3d49a" stroke="none"/>
  </g>`;

export const CARD_ICONS = {
  // 전진 ⬆ — 앞으로 내닫는 전차 + 큰 청색 화살표, 궤도 뒤 속도선
  fwd: `<svg viewBox="0 0 48 48" aria-label="전진">
    <path d="M10 45.5 v-5 M38 45.5 v-5 M24 47 v-3.5" stroke="#9fb4cc" stroke-width="2.4" stroke-linecap="round"/>
    ${tankTop(24, 20)}
    <path d="M24 1.5 L35 13.5 H29.2 V18 H18.8 V13.5 H13 Z"
          fill="#2f7ee0" stroke="#2b3445" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M21.5 12.5 L24 5 L26.5 12.5" fill="none" stroke="#bcd9ff" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,

  // 후진 ⬇ — 전면(포)을 위로 문 채 뒤로 빠진다: 아래로 강철색 화살표 + 전면 방패 광택
  back: `<svg viewBox="0 0 48 48" aria-label="후진">
    ${tankTop(24, 6)}
    <path d="M24 46.5 L13 34.5 H18.8 V30 H29.2 V34.5 H35 Z"
          fill="#4a6fa5" stroke="#2b3445" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M26.5 35.5 L24 43 L21.5 35.5" fill="none" stroke="#c9d8ef" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,

  // 좌 ↰ — 제동 후 좌선회 전진: 왼쪽으로 감기는 굵은 화살표 + 기울어진 차체 + 스키드 자국
  left: `<svg viewBox="0 0 48 48" aria-label="좌">
    <path d="M35 44 q3 -2 4.5 -5 M40 45 q3 -2.5 4.5 -5.5" stroke="#8b95a8" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <g transform="rotate(-20 26 30)">${tankTop(27, 20)}</g>
    <path d="M34 12 C28 4.5 16 4.5 10 11.5 L5.5 7.5 L4 20.5 L17 19 L12.8 15.2 C17 10.5 26 10.5 30.5 15.5 Z"
          fill="#2f7ee0" stroke="#2b3445" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M14.5 12.5 C19 8.8 25 8.8 29 12" fill="none" stroke="#bcd9ff" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,

  // 우 ↱ — 좌의 미러
  right: `<svg viewBox="0 0 48 48" aria-label="우">
    <path d="M13 44 q-3 -2 -4.5 -5 M8 45 q-3 -2.5 -4.5 -5.5" stroke="#8b95a8" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <g transform="rotate(20 22 30)">${tankTop(21, 20)}</g>
    <path d="M14 12 C20 4.5 32 4.5 38 11.5 L42.5 7.5 L44 20.5 L31 19 L35.2 15.2 C31 10.5 22 10.5 17.5 15.5 Z"
          fill="#2f7ee0" stroke="#2b3445" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M33.5 12.5 C29 8.8 23 8.8 19 12" fill="none" stroke="#bcd9ff" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,

  // 공격 🎯 — 붉은 크로스헤어 + 중심으로 파고드는 예광탄 + 포구 화염
  atk: `<svg viewBox="0 0 48 48" aria-label="공격">
    <circle cx="27" cy="21" r="13.5" fill="none" stroke="#d0342c" stroke-width="3"/>
    <path d="M27 4 v5.5 M27 32.5 v5.5 M10 21 h5.5 M38.5 21 h5.5"
          stroke="#d0342c" stroke-width="3" stroke-linecap="round"/>
    <path d="M13 36 L23.8 24.6" stroke="#ffd9a1" stroke-width="5" stroke-linecap="round" opacity="0.9"/>
    <path d="M14.5 34.5 L24.2 24.2" stroke="#fff3d6" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M22.5 27.2 L27.3 22.1 c1.5 -1.6 3.9 0.7 2.4 2.3 L25 29.5 c-1.6 1.5 -3.9 -0.7 -2.4 -2.3 Z"
          fill="#ff7a3c" stroke="#2b3445" stroke-width="1.7" stroke-linejoin="round"/>
    <g stroke="#2b3445" stroke-width="1.8" stroke-linejoin="round">
      <path d="M9 30.5 L11.4 35 L16.4 33.4 L13.6 37.6 L18 40.4 L13 40.9 L13.8 45.9 L9.9 42.4 L5.6 45.4 L7 40.6 L2.2 39.9 L6.6 37.4 L4.2 33.2 L8.6 35.2 Z"
            fill="#ffb43a"/>
      <circle cx="9.8" cy="38.6" r="2.4" fill="#ffe9a8" stroke="none"/>
    </g>
    <circle cx="27" cy="21" r="2.6" fill="#d0342c" stroke="#2b3445" stroke-width="1.6"/>
  </svg>`,
};
