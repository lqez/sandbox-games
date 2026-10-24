# 룩 목표 그림 — 프롬프트 기록

> 작성일: 2026-10-24
> 스크립트: `ploh/tools/look/gen_image.py`(OpenAI Images API, 생성·편집)
> 그림을 어떻게 구현할지는 `ART_TARGET.md`에 있습니다.

## 모델

이 계정에서 쓸 수 있는 이미지 모델(`/v1/models`, 2026-10-24): `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`(`-2026-04-21`), `gpt-image-2.5-flare`(`-2026-09-08`), `gpt-image-2.5-sunburst`(`-2026-09-08`), `chatgpt-image-latest`.

같은 프롬프트(`s1_gen.txt`, medium)로 세 모델을 비교했습니다.

| 모델 | 결과 | 1024×1792 high 한 장 |
|---|---|---|
| `gpt-image-2.5-flare` | 셀 셰이딩 애니메이션 톤이라 우리 툰 렌더와 가장 가깝다. 편집에서 입력 화면의 재질과 캐릭터 디자인을 잘 지킨다 | 20~26초 |
| `gpt-image-2.5-sunburst` | 재질과 조명이 더 사실적이고 세부가 많다 | 35~40초 |
| `gpt-image-2` | 어둡고 사실적이다 | 약 35초 |

본안은 `gpt-image-2.5-flare`로 만들고, 파일 이름이 `_b`로 끝나는 변형은 `gpt-image-2.5-sunburst`로 만들었습니다. 크기 `1024x1792`(9:16, 게임 화면 720×1280과 같은 비율)도 받습니다.

## 입력

- **게임 화면**: `tests/closeup.tscn`(장면 combo·boss, 카메라 game, 프라우, 720×1280)을 무비 메이커로 찍은 프레임입니다. API에는 PNG 원본을 보냈고, 저장소에는 같은 프레임을 JPEG로 `before/`에 두었습니다. 그때 카메라는 피치 50°, 고정 요 45°였습니다.
- **캐릭터**: 각 에셋 폴더의 `beauty.png`(Blender 렌더)와 `turnaround.png`입니다. 투명 바탕은 회색(200)으로 깔아 보냈습니다.
- `.orca/`의 녹화 파일은 외부로 보내지 않았습니다.
- HUD 그림(`4_hud_*`)은 카메라 그림(`1_camera_mid`, `1_camera_close`, `1_camera_boss`)을 다시 입력으로 썼습니다(2단 편집).

## 그림별 기록

모든 출력은 PNG(1024×1792에 약 3 MB)였고, 저장소 크기를 줄이려고 JPEG(품질 90, 약 0.5 MB)로 바꿔 넣었습니다. '편집'은 `images.edit`(입력 이미지 → 이미지), '생성'은 `images.generate`입니다.

| 파일 | 방식 | 모델 | 크기, 품질 | 프롬프트 | 입력(순서대로 그림 1, 2, …) |
|---|---|---|---|---|---|
| `1_camera_close.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s1_edit.txt`](prompts/s1_edit.txt) | `before/before_combat.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/conscript/beauty.png`, `ploh/game/assets/soldiers/shieldbearer/beauty.png` |
| `1_camera_mid.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s1_mid.txt`](prompts/s1_mid.txt) | `before/before_combat.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/conscript/beauty.png`, `ploh/game/assets/soldiers/shieldbearer/beauty.png` |
| `1_camera_mid_b.jpg` | 편집 | gpt-image-2.5-sunburst | 1024x1792, high | [`s1_mid.txt`](prompts/s1_mid.txt) | `before/before_room2.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/conscript/beauty.png`, `ploh/game/assets/soldiers/shieldbearer/beauty.png` |
| `1_camera_boss.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s1_boss.txt`](prompts/s1_boss.txt) | `before/before_boss.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/boss/beauty.png` |
| `1_camera_gen.jpg` | 생성 | gpt-image-2.5-flare | 1024x1536, medium | [`s1_gen.txt`](prompts/s1_gen.txt) | 없음 |
| `2_hit_frau.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s2_frau.txt`](prompts/s2_frau.txt) | `before/before_combat.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/conscript/beauty.png` |
| `2_hit_frau_b.jpg` | 편집 | gpt-image-2.5-sunburst | 1024x1792, high | [`s2_frau.txt`](prompts/s2_frau.txt) | `before/before_combat.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/conscript/beauty.png` |
| `2_hit_fram.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s2_fram.txt`](prompts/s2_fram.txt) | `before/before_combat.jpg`, `ploh/game/assets/fram/beauty.png`, `ploh/game/assets/soldiers/conscript/beauty.png` |
| `2_hit_schneider.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s2_schneider.txt`](prompts/s2_schneider.txt) | `before/before_combat.jpg`, `ploh/game/assets/schneider/beauty.png`, `ploh/game/assets/soldiers/shieldbearer/beauty.png` |
| `2_hit_sequence.jpg` | 편집 | gpt-image-2.5-flare | 1792x1024, high | [`s2_seq.txt`](prompts/s2_seq.txt) | `before/before_combat.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/conscript/beauty.png` |
| `2_vfx_elements.jpg` | 생성 | gpt-image-2.5-flare | 1536x1024, high | [`s2_sheet.txt`](prompts/s2_sheet.txt) | 없음 |
| `2_vfx_elements_b.jpg` | 생성 | gpt-image-2.5-sunburst | 1536x1024, high | [`s2_sheet.txt`](prompts/s2_sheet.txt) | 없음 |
| `3_ult_frau.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s3_frau.txt`](prompts/s3_frau.txt) | `before/before_combat.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png` |
| `3_ult_fram.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s3_fram.txt`](prompts/s3_fram.txt) | `before/before_combat.jpg`, `ploh/game/assets/fram/beauty.png` |
| `3_ult_schneider.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s3_schneider.txt`](prompts/s3_schneider.txt) | `before/before_combat.jpg`, `ploh/game/assets/schneider/beauty.png` |
| `3_ult_trio.jpg` | 편집 | gpt-image-2.5-flare | 1536x1024, high | [`s3_trio.txt`](prompts/s3_trio.txt) | `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/fram/beauty.png`, `ploh/game/assets/schneider/beauty.png` |
| `3_ult_trio_b.jpg` | 편집 | gpt-image-2.5-sunburst | 1536x1024, high | [`s3_trio.txt`](prompts/s3_trio.txt) | `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/fram/beauty.png`, `ploh/game/assets/schneider/beauty.png` |
| `4_hud_combat.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s4_combat.txt`](prompts/s4_combat.txt) | `1_camera_mid.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/fram/beauty.png`, `ploh/game/assets/schneider/beauty.png` |
| `4_hud_boss.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s4_boss.txt`](prompts/s4_boss.txt) | `1_camera_boss.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/fram/beauty.png`, `ploh/game/assets/schneider/beauty.png` |
| `4_hud_combat_close.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s4_combat.txt`](prompts/s4_combat.txt) | `1_camera_close.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/fram/beauty.png`, `ploh/game/assets/schneider/beauty.png` |
| `4_hud_combat_b.jpg` | 편집 | gpt-image-2.5-sunburst | 1024x1792, high | [`s4_combat.txt`](prompts/s4_combat.txt) | `1_camera_mid.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/fram/beauty.png`, `ploh/game/assets/schneider/beauty.png` |
| `4_hud_gen.jpg` | 생성 | gpt-image-2.5-flare | 1024x1792, high | [`s4_gen.txt`](prompts/s4_gen.txt) | 없음 |
| `5_parry.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s5_parry.txt`](prompts/s5_parry.txt) | `before/before_combat.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/shieldbearer/beauty.png` |
| `5_parry_b.jpg` | 편집 | gpt-image-2.5-sunburst | 1024x1792, high | [`s5_parry.txt`](prompts/s5_parry.txt) | `before/before_combat.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/shieldbearer/beauty.png` |
| `5_archer_ingame.jpg` | 편집 | gpt-image-2.5-flare | 1024x1792, high | [`s5_archer_ingame.txt`](prompts/s5_archer_ingame.txt) | `before/before_room2.jpg`, `ploh/game/assets/astrid/B_mid/beauty.png`, `ploh/game/assets/soldiers/conscript/beauty.png` |
| `5_archer_turnaround.jpg` | 편집 | gpt-image-2.5-flare | 1536x1024, high | [`s5_archer_sheet.txt`](prompts/s5_archer_sheet.txt) | `ploh/game/assets/soldiers/conscript/turnaround.png` |
| `5_archer_beauty.jpg` | 편집 | gpt-image-2.5-flare | 1024x1024, high | [`s5_archer_beauty.txt`](prompts/s5_archer_beauty.txt) | `ploh/game/assets/soldiers/conscript/turnaround.png` |

`before/`는 입력으로 쓴 게임 화면, `after/`는 HUD를 바꾼 뒤의 게임 화면(gpt-image가 아니라 실제 캡처)입니다.

## 프롬프트 구조

프롬프트 원문은 `prompts/*.txt`에 있습니다(셸 변수를 펼친 최종 문장).

- **편집**: 그림 1은 게임 화면(구도, 재질, 툰 셰이딩), 그림 2부터는 캐릭터 모델(디자인과 4.5등신)입니다. "Re-render THE SAME GAME … from a NEW CAMERA"처럼 써서 3D 룩은 지키고 카메라·연출만 바꾸게 했습니다. 모든 캐릭터 프롬프트에 "about 4.5 heads tall … keep exactly the designs, colours and proportions of the reference model images"를 넣었습니다.
- **카메라**: 거리(m)·높이(m)·피치(°)·세로 화각(°)과 화면 안 위치(영웅 발이 화면 높이의 몇 %)를 숫자로 줬습니다. 그림이 그 숫자를 정확히 지키지는 않으므로 구현값은 `ART_TARGET.md` 1장의 역산값을 씁니다.
- **이펙트**: 요소마다 모양, 색(hex), 블렌드를 나눠 적었습니다(`s2_*`의 VFX 단락이 공통).
- **HUD**: 화면 너비 W·높이 H의 %로 배치를 적고, "화면 아래 가운데(엄지 영역)는 비운다"를 명시했습니다. 한글 라벨("궁극기", "교대", "남은 적 3", "균열의 군주", "돌진 찌르기")은 철자대로 그려졌습니다.

## 알려진 어긋남

- 프라우는 실제 모델(검은 머리 올림머리, 뾰족한 귀, 연노랑 패딩 조끼, 흰 티셔츠, 검은 레깅스, 회색 대검)대로 묘사했습니다. 금발 기사가 아닙니다.
- `5_archer_*`는 약 5.5등신으로 나왔습니다. 디자인(짧은 상의, 후드 망토, 오른쪽 어깨 위로 솟은 화살통)만 참고하고 비율은 4.5등신을 지킵니다.
- `1_camera_gen.jpg`는 입력 없이 만들어 캐릭터가 6~7등신이고 사실적입니다. 편집 그림과 비교하려고 남겼습니다.
- `2_hit_*`의 붉은 분사는 그림에서 크고 진합니다. 실제 크기와 진하기는 `ART_TARGET.md` 2장을 따릅니다.
