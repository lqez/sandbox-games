// card-icons.js — 카드별 전용 그래픽 아이콘 (SD 프라모델 톤)
// 전차는 그리지 않는다 (당연하니까) — 각 카드의 "특징"만 굵고 한눈에:
//  전진 = 내닫는 화살표 + 추진선 / 후진 = 전면 방패를 문 채 하강 /
//  좌·우 = 급격히 꺾이는 화살표 + 스키드 / 공격 = 크로스헤어에 꽂히는 예광탄.
// 굵은 다크네이비 외곽선 + 플랫 컬러 + 하이라이트 — 게임 카드와 /rules 공유.

export const CARD_ICONS = {
  // 전진 — 두툼한 청색 화살표가 위로 내닫는다, 아래엔 추진 잔상
  fwd: `<svg viewBox="0 0 48 48" aria-label="전진">
    <path d="M17 45.5 h14 M19.5 40 h9" stroke="#9fb4cc" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M24 2 L42 22 H32.5 V34.5 H15.5 V22 H6 Z"
          fill="#2f7ee0" stroke="#2b3445" stroke-width="3" stroke-linejoin="round"/>
    <path d="M24 2 L42 22 H32.5 V25 H15.5 V22 H6 Z" fill="#5d9df0" stroke="none" opacity="0.55"/>
    <path d="M18.5 17.5 L24 9 L29.5 17.5" fill="none" stroke="#cfe4ff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  // 후진 — 위쪽 전면 장갑판(방패)을 문 채, 강철색 화살표가 아래로 빠진다
  back: `<svg viewBox="0 0 48 48" aria-label="후진">
    <path d="M24 2.5 L40 6.5 V12 C40 16.5 33.5 19.5 24 21 C14.5 19.5 8 16.5 8 12 V6.5 Z"
          fill="#8b95a8" stroke="#2b3445" stroke-width="3" stroke-linejoin="round"/>
    <path d="M24 2.5 L40 6.5 V9 H8 V6.5 Z" fill="#b3bccb" stroke="none"/>
    <path d="M12.5 8 L24 5.2 L35.5 8" fill="none" stroke="#e8edf5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M24 46 L38 31 H30.5 V24.5 H17.5 V31 H10 Z"
          fill="#4a6fa5" stroke="#2b3445" stroke-width="3" stroke-linejoin="round"/>
    <path d="M27.5 32.5 L24 41 L20.5 32.5" fill="none" stroke="#c9d8ef" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  // 좌 — 굵은 화살표가 급격히 왼쪽으로 꺾인다 + 오른쪽 아래 스키드 자국
  left: `<svg viewBox="0 0 48 48" aria-label="좌">
    <path d="M36 45 q4 -2.5 6 -6 M29.5 46.5 q4 -3 6 -6.5" stroke="#8b95a8" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M21 44 V25 C21 17.5 25.5 13 33 13 H33.5 V4.5 L47 15.5 L33.5 26.5 V18.5 H33 C29.5 18.5 27.5 20.8 27.5 25 V44 Z"
          transform="translate(48 0) scale(-1 1)"
          fill="#2f7ee0" stroke="#2b3445" stroke-width="3" stroke-linejoin="round"/>
    <path d="M23.5 40 V25 C23.5 19.5 27 16 32.5 15.8"
          transform="translate(48 0) scale(-1 1)"
          fill="none" stroke="#cfe4ff" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,

  // 우 — 좌의 미러
  right: `<svg viewBox="0 0 48 48" aria-label="우">
    <path d="M12 45 q-4 -2.5 -6 -6 M18.5 46.5 q-4 -3 -6 -6.5" stroke="#8b95a8" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M21 44 V25 C21 17.5 25.5 13 33 13 H33.5 V4.5 L47 15.5 L33.5 26.5 V18.5 H33 C29.5 18.5 27.5 20.8 27.5 25 V44 Z"
          fill="#2f7ee0" stroke="#2b3445" stroke-width="3" stroke-linejoin="round"/>
    <path d="M23.5 40 V25 C23.5 19.5 27 16 32.5 15.8"
          fill="none" stroke="#cfe4ff" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,

  // 공격 — 붉은 크로스헤어 정중앙에 꽂히는 예광탄 + 포구 섬광
  atk: `<svg viewBox="0 0 48 48" aria-label="공격">
    <circle cx="28" cy="20" r="14" fill="none" stroke="#d0342c" stroke-width="3.4"/>
    <path d="M28 2 v6 M28 32 v6 M10 20 h6 M40 20 h6" stroke="#d0342c" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M12 37 L24.5 23.8" stroke="#ffd9a1" stroke-width="5.5" stroke-linecap="round" opacity="0.9"/>
    <path d="M13.5 35.5 L25 23.4" stroke="#fff3d6" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M23 26.5 L27.8 21.4 c1.6 -1.7 4.2 0.8 2.6 2.5 L25.5 29 c-1.7 1.6 -4.1 -0.8 -2.5 -2.5 Z"
          fill="#ff7a3c" stroke="#2b3445" stroke-width="1.8" stroke-linejoin="round"/>
    <g stroke="#2b3445" stroke-width="2" stroke-linejoin="round">
      <path d="M8.5 29.5 L11.2 34.5 L16.8 32.7 L13.7 37.4 L18.6 40.5 L13 41.1 L13.9 46.7 L9.5 42.8 L4.7 46.1 L6.3 40.8 L0.9 40 L5.8 37.2 L3.1 32.5 L8 34.7 Z"
            fill="#ffb43a"/>
      <circle cx="9.4" cy="38" r="2.7" fill="#ffe9a8" stroke="none"/>
    </g>
    <circle cx="28" cy="20" r="2.9" fill="#d0342c" stroke="#2b3445" stroke-width="1.8"/>
  </svg>`,
};
