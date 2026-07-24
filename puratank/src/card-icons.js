// card-icons.js — 카드별 전용 그래픽 아이콘.
// 전차는 그리지 않는다 — 특징만 한눈에. 얇은 외곽선(1.4~1.8) + 부드러운
// 그라데이션의 세련된 일러스트 톤. 게임 카드와 /rules가 공유한다.

export const CARD_ICONS = {
  // 전진 — 위로 내닫는 화살표 + 추진 잔상
  fwd: `<svg viewBox="0 0 48 48" aria-label="전진">
    <defs>
      <linearGradient id="gi-fwd" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#74aef5"/><stop offset="1" stop-color="#2c6dd2"/>
      </linearGradient>
    </defs>
    <path d="M17.5 45 h13 M20 40.2 h8" stroke="#b6c6da" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M24 3 L41 22 H32 V34 H16 V22 H7 Z"
          fill="url(#gi-fwd)" stroke="#1f3e66" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M19 17.5 L24 10 L29 17.5" fill="none" stroke="#dcebff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
  </svg>`,

  // 후진 — 전면 장갑 방패를 문 채 아래로 빠진다
  back: `<svg viewBox="0 0 48 48" aria-label="후진">
    <defs>
      <linearGradient id="gi-sh" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c6cedd"/><stop offset="1" stop-color="#8d97ab"/>
      </linearGradient>
      <linearGradient id="gi-back" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7391c2"/><stop offset="1" stop-color="#3f5f94"/>
      </linearGradient>
    </defs>
    <path d="M24 3 L39.5 7 V12.2 C39.5 16.6 33.2 19.6 24 21 C14.8 19.6 8.5 16.6 8.5 12.2 V7 Z"
          fill="url(#gi-sh)" stroke="#3c4658" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M13 8.4 L24 5.6 L35 8.4" fill="none" stroke="#eef2f8" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <path d="M24 45.5 L37.5 31 H30 V25 H18 V31 H10.5 Z"
          fill="url(#gi-back)" stroke="#243a5c" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M27 32.5 L24 40.5 L21 32.5" fill="none" stroke="#d3e0f2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
  </svg>`,

  // 좌 — 급격히 왼쪽으로 꺾이는 화살표 + 스키드 자국
  left: `<svg viewBox="0 0 48 48" aria-label="좌">
    <defs>
      <linearGradient id="gi-left" x1="1" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#2c6dd2"/><stop offset="1" stop-color="#74aef5"/>
      </linearGradient>
    </defs>
    <path d="M35.5 44.5 q4 -2.5 6 -6 M29.5 46 q4 -3 6 -6.5" stroke="#b6c6da" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <path d="M27 44 V25 C27 17.5 22.5 13 15 13 H14.5 V4.5 L1 15.5 L14.5 26.5 V18.5 H15 C18.5 18.5 20.5 20.8 20.5 25 V44 Z"
          fill="url(#gi-left)" stroke="#1f3e66" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M24.5 40 V25 C24.5 19.5 21 16 15.5 15.8"
          fill="none" stroke="#dcebff" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
  </svg>`,

  // 우 — 좌의 미러
  right: `<svg viewBox="0 0 48 48" aria-label="우">
    <defs>
      <linearGradient id="gi-right" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#2c6dd2"/><stop offset="1" stop-color="#74aef5"/>
      </linearGradient>
    </defs>
    <path d="M12.5 44.5 q-4 -2.5 -6 -6 M18.5 46 q-4 -3 -6 -6.5" stroke="#b6c6da" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <path d="M21 44 V25 C21 17.5 25.5 13 33 13 H33.5 V4.5 L47 15.5 L33.5 26.5 V18.5 H33 C29.5 18.5 27.5 20.8 27.5 25 V44 Z"
          fill="url(#gi-right)" stroke="#1f3e66" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M23.5 40 V25 C23.5 19.5 27 16 32.5 15.8"
          fill="none" stroke="#dcebff" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
  </svg>`,

  // 곡사 — 능선 너머로 넘겨 쏘는 포물선 탄도 + 낙하 포탄
  lob: `<svg viewBox="0 0 48 48" aria-label="곡사">
    <defs>
      <linearGradient id="gi-lob" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffb765"/><stop offset="1" stop-color="#e8781c"/>
      </linearGradient>
    </defs>
    <path d="M3 43 h9 l4 -9 h6 l3 9 h11" fill="none" stroke="#8a94a6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
    <path d="M6 40 C 14 6, 34 6, 42 34" fill="none" stroke="url(#gi-lob)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1.5 4.2"/>
    <path d="M40.2 24.5 L44.4 22 L44 26.9 Z" fill="url(#gi-lob)" stroke="#a5401f" stroke-width="1" stroke-linejoin="round"/>
    <g transform="translate(41.6 33.4) rotate(28)">
      <rect x="-2.1" y="-4.2" width="4.2" height="7.2" rx="1.9" fill="url(#gi-lob)" stroke="#a5401f" stroke-width="1.1"/>
      <path d="M-2.1 3 L-3.4 6 M0 3.2 L0 6.6 M2.1 3 L3.4 6" stroke="#e8781c" stroke-width="1.1" stroke-linecap="round"/>
    </g>
    <circle cx="6" cy="40" r="2.2" fill="#ffd79a" stroke="#c98a24" stroke-width="1.1"/>
  </svg>`,

  // 공격(직격) — 크로스헤어에 꽂히는 예광탄 + 포구 섬광
  atk: `<svg viewBox="0 0 48 48" aria-label="직격">
    <defs>
      <linearGradient id="gi-atk" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#ff9d54"/><stop offset="1" stop-color="#ff6a35"/>
      </linearGradient>
    </defs>
    <circle cx="28" cy="20" r="13.5" fill="none" stroke="#d64545" stroke-width="2.4"/>
    <path d="M28 2.5 v5.5 M28 32 v5.5 M10.5 20 h5.5 M39.5 20 h5.5" stroke="#d64545" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M12.5 36.5 L24.5 23.8" stroke="#ffddb0" stroke-width="4.6" stroke-linecap="round" opacity="0.85"/>
    <path d="M14 35 L25 23.4" stroke="#fff4de" stroke-width="2" stroke-linecap="round"/>
    <path d="M23 26.5 L27.8 21.4 c1.6 -1.7 4.2 0.8 2.6 2.5 L25.5 29 c-1.7 1.6 -4.1 -0.8 -2.5 -2.5 Z"
          fill="url(#gi-atk)" stroke="#a5401f" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M8.5 30 L11 34.8 L16.4 33.1 L13.4 37.6 L18.2 40.6 L12.8 41.1 L13.7 46.5 L9.4 42.7 L4.7 45.9 L6.2 40.7 L1 40 L5.7 37.2 L3.1 32.7 L7.9 34.8 Z"
          fill="#ffbb4d" stroke="#c98a24" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="9.4" cy="38" r="2.5" fill="#ffedbd"/>
    <circle cx="28" cy="20" r="2.7" fill="#d64545" stroke="#8f2f2f" stroke-width="1.2"/>
  </svg>`,
};
