# 제국 징집병 (Conscripted Soldier) — conscript

갈루스 제국의 기본 졸개입니다(`design/enemies/ROSTER.md` 2장). 프라우 `astrid/B_mid`와 같은 약 4.5등신 비율, 같은 키 1.25 m, 같은 Meshy 휴머노이드 리그를 씁니다.

## 파일
- `conscript.glb`: 몸 메시 `body`(스킨) + 무기 메시 `weapon_sword`(`RightHand` 본의 자식) + 아마추어 1개(24본), 액션 7개, 30 fps
- `turnaround.png`: gpt-image-2 3면도(정면·좌측면·후면, 1536×1024)
- `view_front.png`, `view_side.png`, `view_back.png`: 3면도를 같은 배율·같은 발 높이로 자른 1024² 입력 이미지
- `beauty.png`: 정면 3/4(캐릭터 왼쪽 앞 35°), idle 0프레임, Eevee 1024²
- `raw/`: Meshy 원본(`model.glb`, `rigged.glb`, `basic_walking.glb`, `basic_running.glb`, `animations.glb`, `thumb.png`, 작업 JSON, `tasks.json`). `.gdignore`로 Godot 가져오기에서 뺐습니다
- `raw/rejected_sheets/`: 폐기한 3면도 `sheet_v1.png`, `sheet_v2.png`

## 제작 과정
1. 3면도: `ploh/tools/soldiers/gen_sheet.py conscript`(gpt-image-2 `images.edit`, quality high)
   - v1(원작 비율 시트 + B_mid 입력), v2(B_mid + 원작 + SD 입력)는 둘 다 6–7등신으로 나와 폐기했습니다.
   - v3(채택): B_mid 3면도를 첫 입력(비율·포즈·렌더 기준), `design/enemies/conscript/turnaround_sd.png`를 둘째 입력(디자인)으로 넣고, 머리 22%·가랑이 높이 46% 같은 픽셀 기준을 프롬프트에 적었습니다. 무기는 그리지 않았습니다.
2. `ploh/tools/soldiers/crop_views.py`로 세 면을 잘랐습니다(측면은 반전하지 않은 왼쪽 옆모습).
3. Meshy multi-image-to-3d → rigging(height 1.25 m) → animation(사망 1개): `ploh/tools/soldiers/meshy.py`
4. 헤드리스 Blender 5.0: `ploh/tools/blender/soldier_build.py -- conscript <out.glb>`

## Meshy 작업
| 단계 | 작업 ID | 크레딧 |
|---|---|---|
| multi-image-to-3d (latest, 2K 텍스처, PBR 없음, 삼각형 리메시 20k, A-pose) | `01a16963-d58e-7564-b475-a1fac34bda9c` | 30 |
| rigging (height_meters=1.25, 기본 걷기·달리기 포함) | `01a16967-4ce2-74a3-8d72-761cec6b34d8` | 5 |
| animations (action_id 189 Dying Backwards) | `01a16968-554e-715b-b2dd-5a4f851e07a1` | 3 |
| 합계 |  | 38 |

## 본 이름(Meshy 휴머노이드 24본, B_mid와 같음)
- 몸통: `Hips` → `Spine02` → `Spine01` → `Spine`(가슴) → `neck` → `Head` → `head_end`, `headfront`(Head 앞쪽 표식)
- 팔: `Spine` → `LeftShoulder` → `LeftArm` → `LeftForeArm` → `LeftHand` (오른쪽은 `Right…`)
- 다리: `Hips` → `LeftUpLeg` → `LeftLeg` → `LeftFoot` → `LeftToeBase` (오른쪽은 `Right…`)

손가락 본은 없습니다. Godot는 `weapon_sword`를 `RightHand`의 자식 본(25번째)으로도 만들고, 메시는 `Skeleton3D/weapon_sword`(BoneAttachment3D) 아래에 둡니다(B_mid와 같은 구조).

## 액션(`conscript.glb`, 30 fps)
공격 구조: 경계 자세(idle 0프레임) → 예비 동작(검을 크게 뒤로 당기고 끝에서 천천히 더 당김) → 4프레임 타격(접촉 프레임까지 가속, 이후 감속) → 팔로스루 오버슈트(검 무게에 상체가 끌려감) → 경계 자세로 복귀.

| 액션 | 출처 | 길이 | 예비 끝 / **접촉** / 타격 끝 | 내용 |
|---|---|---|---|---|
| `idle` | 직접 제작 | 2.00 s(60f, 루프) | – | 검을 앞으로 든 경계 자세, 오른발 앞, 호흡 |
| `walk` | Meshy 기본 걷기 + 오른팔 재작성 | 1.03 s(31f, 루프) | – | 하체·몸통은 Meshy. 오른팔은 매 프레임 IK로 검을 허리 앞에 겨누고, 원래 팔 흔들기 위상에 맞춰 조금 흔듦 |
| `run` | Meshy 기본 달리기 + 오른팔 재작성 | 0.63 s(19f, 루프) | – | 검을 허리 옆 뒤로 낮게 늘어뜨림 |
| `attack_1` | 직접 제작 | 1.00 s(30f) | 12 / **14 (0.467 s, 47%)** / 16 | 내려베기(로스터 패턴 1). 0–9 검을 머리 뒤로 들고 뒤로 기댐, 9–12 더 당김, 13 머리 위, 14 앞 아래로 접촉하며 오른발 런지, 16 아래로, 20 칼끝이 앞발 옆 바닥 근처까지 끌려가고 상체가 숙여짐, 30 복귀 |
| `attack_2` | 직접 제작 | 1.00 s(30f) | 12 / **14 (0.467 s, 47%)** / 16 | 오른쪽→왼쪽 수평 베기. 0–12 검을 오른쪽 뒤 높이 감아올림(상체 −56° 비틀기), 13 오른쪽, 14 정면 통과(런지), 16 왼쪽, 20 왼쪽 뒤까지 감기며 상체가 따라 돎, 30 복귀 |
| `hit` | 직접 제작 | 0.40 s(12f) | 정점 3 | 가벼운 움찔: 상체·머리가 뒤로 젖혀졌다가 경계 자세로 복귀 |
| `death` | Meshy Dying Backwards(189) | 2.20 s(66f) | – | 뒤로 쓰러짐. 루트(Hips)가 뒤로 이동 |

- 직접 만든 액션은 idle 0프레임과 같은 자세로 시작하고 끝나며, 모든 프레임에 모든 본 키가 있습니다(선형 보간).
- Meshy 액션은 0프레임에서 시작하도록 옮겼습니다. 걷기·달리기는 제자리 동작입니다(Hips 흔들림 5 cm 이하).
- GLB에는 반복 설정이 없습니다. Godot에서 `idle`, `walk`, `run`은 `loop_mode = Animation.LOOP_LINEAR`로 바꿔야 합니다.
- 모든 액션의 트랙 구성이 같습니다(Hips 위치 + 23개 본 회전, Godot 기준 24트랙).

### 칼날 도달 거리(모델 1.25 m 기준, 캐릭터 원점에서 앞쪽 m / 높이 m)
게임 `weapon.gd`와 같은 규칙(손잡이 원점에서 가장 먼 정점 = 칼끝)으로 측정했습니다.

| 액션 | 접촉 프레임 칼끝 | 접촉 프레임 손잡이 | 타격 구간(12–16)에서 높이 0.45–0.95 m를 지나는 날의 최대 앞 거리 |
|---|---|---|---|
| `attack_1` | 1.04 / 0.56 | 0.46 / 0.92 | 1.04 m |
| `attack_2` | 1.10 / 0.75 | 0.45 / 0.86 | 1.10 m |

영웅 캡슐 반지름 0.45 m + 여유 0.1 m를 더하면 중심 거리 약 1.6 m까지 닿습니다.

## 무기·손
- `weapon_sword`: 스크립트로 만든 군용 세이버. 전체 0.76 m(칼날 0.60 m, 폭 5.2 cm), 놋쇠 가드·폼멜, 가죽 손잡이, 날 앞쪽 주황 열선(발광 재질). 삼각형 102개. 텍스처 없이 단색 재질 4개(`prop_steel`, `prop_brass`, `prop_leather`, `prop_heatline`).
- 로컬 축: +Z = 칼날 방향(손잡이에서 멀어지는 쪽, 칼끝이 가장 먼 정점), +X = 날(주먹 마디 쪽), 원점 = 손잡이 중심(주먹 안).
- 오른손은 기본 메시의 손가락 정점을 손바닥 쪽으로 말아 주먹으로 만들었습니다(셰이프 키가 아니라 메시 자체를 고침). 왼손은 편 손입니다.

## 정리 결과
- 키 1.25 m(Godot AABB 높이 1.250), 발바닥이 원점, 수평 중심 정렬, 변환 적용(스케일 1)
- 정면 +Z(Godot에서 `headfront - Head` = (0, 0, 1))
- 머리 크기: 머리 폭 0.238 m(군모 챙 포함, B_mid 0.217 m), 목 관절~정수리 0.282 m(B_mid 0.313 m, 올림머리 포함)
- 삼각형: 몸 20,286 + 검 102 = 20,388
- 텍스처: 몸 베이스 컬러 1024² JPEG 1장. 소품은 텍스처 없음
- 노멀 재계산, 스무스 셰이딩

## 문제
- 주먹은 메시만 구부린 것이라 가까이서 보면 손가락이 손잡이를 조금 뚫습니다. 게임 카메라 거리에서는 보이지 않습니다.
- 직접 만든 공격은 키포즈 + 2본 IK라서 모캡보다 딱딱하고, 런지 때 발이 조금 미끄러질 수 있습니다.
- 디자인대로 군모가 눈을 가립니다(얼굴은 살색 면에 입만 보임).
- `death`는 Meshy 원본이라 검 자세를 고려하지 않았습니다. 게임은 래그돌을 쓸 예정이라 선택 사항입니다.
- 로스터의 `attack_double`, `attack_thrust`, `shout`, `stagger`, `knockdown` 등은 만들지 않았습니다.

## 재현 스크립트(세 병종 공통)
- `ploh/tools/soldiers/gen_sheet.py <type> [파일명]`: gpt-image-2 3면도(`OPENAI_API_KEY`)
- `ploh/tools/soldiers/crop_views.py <turnaround.png> <폴더>`: `view_front/side/back.png` 자르기
- `ploh/tools/soldiers/meshy.py <type> mi23d | rig 1.25 | anim <action_id>`: Meshy 작업(`MESHY_API_KEY`), `raw/tasks.json`에 기록
- `ploh/tools/blender/soldier_build.py -- <type> <out.glb>`: 최종 GLB. 키포즈 표와 칼날 도달 거리 측정이 들어 있습니다(헤드리스 Blender. 공장 초기화를 쓰지 않고 `soldier_lib.clear()`로 장면을 비움)
- `ploh/tools/blender/soldier_render.py -- <glb> <beauty.png> [방위각]`: beauty 렌더
- `ploh/tools/blender/soldier_views.py`, `soldier_inspect.py`: 검토용 렌더와 GLB 정보 출력
