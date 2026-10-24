# 제국 궁수 (Skirmisher Archer) — archer

갈루스 제국의 원거리 졸개입니다(새로 만듦, 2026-10-24). 넓은 방에서 활을 쏘고, 달려서 자리를 옮긴 뒤 다시 쏩니다. 징집병과 같은 약 4.5등신, 키 1.25 m, 같은 Meshy 휴머노이드 리그(24본)를 씁니다. 디자인은 로스터 4장 '마도 소총병'의 색과 소품(남색 제복과 금색 파이핑, 왼쪽 어깨 진홍 반망토, 시안 고글, 검은 마스크, 은발)을 가져와 활잡이로 바꿨습니다. 시안 발광은 로스터의 원거리 신호색입니다.

## 파일
- `archer.glb`: 몸 메시 `body`(스킨) + 활 메시 `weapon_bow`(`LeftHand` 본의 자식) + 아마추어 1개(24본), 액션 8개, 30 fps
- `archer_root.json`: 클립별 루트 이동(다른 병사와 같은 형식)
- `turnaround.png`: gpt-image-2 3면도(정면·좌측면·후면, 1536×1024). 후보 2장 중 v2를 골랐습니다(`raw/sheets/`)
- `view_front.png`, `view_side.png`, `view_back.png`: 3면도를 같은 배율·같은 발 높이로 자른 1024² 입력 이미지
- `beauty.png`: 정면 3/4(캐릭터 오른쪽 앞 -20°), idle 0프레임, Eevee 1024²
- `raw/`: Meshy 원본(`model.glb`, `rigged.glb`, `basic_walking.glb`, `basic_running.glb`, `animations_mocap.glb`, `animations_mocap2.glb`, `animations_idle.glb`, `thumb.png`, 작업 JSON, `tasks.json`), 기준 GLB `archer_handkeyed.glb`, 감축한 몸 `archer_body8000.glb`, 3면도 후보 `sheets/`. `.gdignore`로 Godot 가져오기에서 뺐습니다

## 제작 과정
1. 3면도: `ploh/tools/soldiers/gen_sheet.py archer raw/sheets/sheet_v2.png`(gpt-image-2 `images.edit`, quality high)
   - 첫 입력을 징집병 3면도(`soldiers/conscript/turnaround.png`)로 바꿔 병사들과 같은 렌더 스타일·비율·군모 모양을 따르게 했습니다. 둘째 입력은 소총병 SD(`design/enemies/rifleman/turnaround_sd.png`)이고, 소총·등 탱크·호스는 빼라고 적었습니다.
   - v1은 화살통이 등에서 왼쪽 엉덩이까지 길게 내려와 v2(등 위쪽의 짧은 화살통, 화살 깃이 어깨를 넘지 않음)를 골랐습니다. 활과 화살은 그리지 않았습니다.
2. `ploh/tools/soldiers/crop_views.py`로 세 면을 잘랐습니다.
3. Meshy multi-image-to-3d → rigging(height 1.25 m) → 라이브러리 애니메이션: `ploh/tools/soldiers/meshy.py archer mi23d|rig`, `ploh/tools/heroes/meshy.py soldiers/archer anim <id,...> <태그>`
4. 기준 GLB: 헤드리스 Blender `ploh/tools/blender/archer_base.py -- raw/archer_handkeyed.glb`. 키 1.25 m·발바닥 원점·변환 적용·노멀 재계산·텍스처 1024²(병사 공통 정리), 왼손 주먹(메시 수정), 활 `weapon_bow`를 왼손에 붙입니다. 손 키 동작은 만들지 않았습니다(파일 이름은 파이프라인 규칙을 따름).
5. 최종 GLB·사이드카: `uv run --no-project --with numpy --with scipy python ploh/tools/mocap/mocap_build.py archer`(클립 표는 `SPEC["archer"]`, 몸 감축은 `decimate_body.py`, 무기 관통 검사·수정은 `clipcheck.py`)

## Meshy 작업
| 단계 | 작업 ID | 크레딧 |
|---|---|---|
| multi-image-to-3d (latest, 2K 텍스처, PBR 없음, 삼각형 리메시 20k, A-pose) | `01a16bd2-b4cc-73ea-980f-fc883ec151dd` | 30 |
| rigging (height_meters=1.25, 기본 걷기·달리기 포함) | `01a16bd4-e52b-756e-8c88-df476ddd36b4` | 5 |
| animations (224, 225, 226, 227, 228, 514, 543, 468, 150, 189) | `01a16bd5-68a2-707a-8dc7-d0272cf0f6b4` | 30 |
| animations (545 Walk Backward with Bow) | `01a16bd5-d724-746d-a203-157fff272193` | 3 |
| animations (89 Combat Idel) | `01a16bd8-7e96-71d8-b135-67dd8f461989` | 3 |
| 합계 |  | 71 |

요청 한 번에 action_id는 10개까지입니다. 228(활을 겨누고 걷기), 545(활 들고 뒷걸음)는 받았지만 지금 클립에는 쓰지 않았습니다.

## 본과 노드
징집병과 같은 Meshy 24본입니다(`Hips`, `Spine02`, `Spine01`, `Spine`, `neck`, `Head`, `head_end`, `headfront`, 양팔 `Shoulder`·`Arm`·`ForeArm`·`Hand`, 양다리 `UpLeg`·`Leg`·`Foot`·`ToeBase`). Godot는 `weapon_bow`(LeftHand 자식)를 본으로도 만들어 25본이 되고, 메시는 `Skeleton3D/weapon_bow`(BoneAttachment3D) 아래에 있습니다. 손가락 본은 없습니다.

## 모캡 액션(`archer.glb`, 30 fps)
| 액션 | 라이브러리 액션(ID) | 원본 프레임 | 길이 | 이벤트 | 손질 |
|---|---|---|---|---|---|
| idle | Combat Idel (89) + 팔: Archery Shot (224) 2프레임 | 0–50 | 51 (1.67 s) | – | 루프. 몸(체중 이동·호흡)은 전투 대기, 두 팔은 활을 몸 앞에 낮게 든 자세로 고정 |
| walk | 리깅 기본 걷기 | 0–31 | 32 (1.03 s) | – | 루프 |
| run | Female Bow Charge Left Hand (514) | 0–15 | 16 (0.50 s) | – | 루프. 왼손에 활을 낮게 든 채 숙여 달림 |
| shoot | Archery Shot 1 (225) + Archery Shot 2 (226) + Archery Shot 3 (227) | 0–30, 0–8, 0–20 | 71 (2.33 s) | **release 41 (1.367 s)** | 등 화살통에서 화살을 뽑아(0–14) 시위에 걸고(14–20) 당겨(20–30) 겨눈 뒤(31–40) 놓음(41). 세 원본은 한 동작을 셋으로 나눈 것이라 이음매가 맞습니다. 전체를 −102° 돌려 화살이 캐릭터 +Z로 날게 했습니다. idle에서 8프레임 섞어 시작, idle 복귀 10프레임 덧붙임 |
| hop_back | Back Jump (468) | 0–28 | 29 (0.93 s) | – | 뒤로 뛰어 물러남(루트 −1.33 m). idle에서 4프레임 섞어 시작, 끝 6프레임 idle로 섞음 |
| step_back | Step Back (543) | 0–26 | 27 (0.87 s) | – | 짧은 뒷걸음(루트 −0.32 m). 시작·끝 4프레임 idle로 섞음 |
| hit | Hit Reaction with Bow (150) | 0–24 | 33 (1.07 s) | – | 활을 든 채 팔로 막으며 움찔. idle에서 3프레임 섞어 시작, idle 복귀 8프레임 덧붙임 |
| death | Dying Backwards (189) | 0–66 | 67 (2.20 s) | – | 뒤로 쓰러짐. idle에서 4프레임 섞어 시작 |
| stumble | Crouch and Step Back (404) | 16–60 | 36 (1.17 s) | 발 디딤 왼발 0–2·10–14·24–26·35, 오른발 0–4·19–24·30–35(디딘 동안 미끄러짐 최대 0.1 cm) | 가슴이 뒤로 젖혀지는 프레임부터 1.25배 빠르게, idle에서 4프레임 섞어 시작, 끝 8프레임 idle로, 양팔 idle 고정, 발 디딤 고정(replant). 루트 X +0.00 m, Z -1.11 m |
| knockdown | Shot and Blown Back (182) | 22–68 | 63 (2.07 s) | 골반이 바닥에 닿는 프레임 13 | 맞는 순간부터. idle에서 4프레임 섞어 시작, 끝 16프레임에 평평하게 누운 자세(lie_up)로 가라앉음. 루트 X +0.02 m, Z -3.21 m |
| getup | Spin Down and Stand Up (100) | 96–212 | 82 (2.70 s) | 두 발이 몸 아래 디딤 55 | 누운 자세(lie_up = knockdown 마지막 프레임)에서 12프레임 섞어 시작, 1.43배 빠르게, 끝 8프레임 idle로, 발 디딤 고정. 루트 X +0.13 m, Z +0.54 m |
| getup_front | Stand Up 8 (351) | 0–70 | 71 (2.33 s) | 두 발이 몸 아래 디딤 31 | 엎드린 자세(lie_down)에서 12프레임 섞어 시작, 끝 8프레임 idle로, 발 디딤 고정. 루트 X +0.04 m, Z -0.22 m |

- 모든 클립의 모든 프레임에 24본 키가 있고 보간은 선형입니다. 반복 설정은 GLB에 없습니다(idle·walk·run은 게임에서 루프로 바꿔야 함).
- 루트 이동: 다른 병사와 같습니다. Hips의 수평 이동을 지우고 `archer_root.json`에 클립별·프레임별 X/Z(0프레임 기준, 모델 크기 m, +Z 앞, +X 캐릭터 왼쪽)로 남겼습니다. run은 한 바퀴에 1.39 m, hop_back은 −1.33 m, step_back은 −0.32 m입니다.
- 몸 메시는 모바일용으로 줄였습니다: 삼각형 20,656 → 8,000(다른 병사와 같은 `decimate_body.py` 설정).

### 피격 반응·넘어짐·기상 (v3, 2026-10-24 추가)
세게 맞았을 때 쓰는 클립입니다. 8명이 같은 설정(`mocap_build.py`의 `react()`)을 씁니다. 라이브러리 동작은 이 캐릭터의 리깅 작업에 요청했습니다(위 Meshy 요청 표).
- `stumble`: 가슴을 세게 맞고 상체가 뒤로 젖혀진 뒤 뒤로 걸음을 디디며 물러나 idle로 돌아옵니다. 라이브러리에 뒷걸음 디딤이 깨끗한 피격 반응이 없어서(Hit Reaction 178은 옆으로 미끄러지고, Face Punch Reaction 174·175는 발이 그대로이며, Walk Backward(544)는 맞는 반응 없이 차분히 걷는 걸음) Crouch and Step Back(404)을 상체가 젖혀지는 프레임(원본 16)부터 썼습니다. 왼발이 낮게 뒤로 뛰고(최고 10 cm), 오른발이 크게 들려 뒤로 디딘 뒤(최고 30 cm) 왼발·오른발이 한 번씩 더 디딥니다. 발 디딤 구간(프레임): 왼발 0–2·10–14·24–26·35, 오른발 0–4·19–24·30–35. 디딘 동안 발 미끄러짐은 최대 0.11 cm입니다. 디딤 구간마다 발을 바닥의 한 점에 고정하고, 첫 디딤과 마지막 디딤은 idle 자세의 발 위치에 놓았습니다(`motion.replant`). 그래서 idle로 섞는 구간에 따로 발을 끌지 않습니다. 루트 이동은 X +0.00 m, Z -1.11 m(모델 크기)입니다.
- `knockdown`: Shot and Blown Back(182)의 맞는 순간(원본 22)부터 씁니다. 발이 바닥을 떠나 뒤로 날아가 등으로 떨어지고(골반이 바닥에 닿는 프레임 13), 미끄러진 뒤 멈춥니다. 마지막 16프레임에 평평하게 누운 자세(`lie_up`)로 가라앉으며, 이때 손은 몸 바깥쪽으로 돌아 움직이고 무기는 바깥을 향해 내려놓습니다(`motion.settle_arms`). idle로 돌아가지 않고 누운 채 끝납니다. 루트 이동은 X +0.02 m, Z -3.21 m로 깁니다(게임에서 줄여 써도 됨).
- `getup`: Spin Down and Stand Up(100)의 누운 구간부터(원본 96–212, 1.43배 빠르게) 씁니다. 앉아 일어나 한쪽 무릎을 짚고 서서 idle로 끝납니다. 0프레임은 `lie_up`이고 `knockdown`의 마지막 프레임과 같습니다(모든 본 회전 차이 0.0°). 두 발이 몸 아래에 디딘 프레임은 55입니다. 루트 이동 X +0.13 m, Z +0.54 m.
- `getup_front`: Stand Up 8(351). 엎드린 자세(`lie_down`)에서 팔굽혀 펴듯 밀고 일어나 웅크렸다가 섭니다. 두 발이 몸 아래에 디딘 프레임은 31입니다. 루트 이동 X +0.04 m, Z -0.22 m. 팔굽혀 펴는 동안 무기는 머리 쪽으로 바닥에 평평하게 둡니다(원본은 일어서며 날을 바닥에 43 cm까지 박음).
- 누운 자세 `lie_up`/`lie_down`(`motion.lying_pose`): 기본 자세에서 몸을 곧게 펴고, 팔을 편하게 둔 뒤(등: 몸 옆, 엎드림: 팔꿈치를 벌려 손을 머리 옆 바닥에) 몸을 눕힙니다. 실제 몸 메시로 골반 높이를 정해 등(가슴)·어깨·다리가 바닥에 닿게 하고, 머리가 바닥에 닿도록 목을 조금 굽힙니다. 엎드릴 때는 발끝을 뻗습니다. 무기는 손 쪽 바깥으로 17° 벌려 몸을 따라 바닥에 평평하게 둡니다(등: 발 쪽, 엎드림: 머리 쪽). 래그돌에서 섞어 들어갈 때 맞출 0프레임 위치(모델 m, 캐릭터 기준 +Z 앞, +X 캐릭터 왼쪽): `getup` Hips [0.0, 0.126, 0.012], Head [-0.0, 0.128, -0.281] / `getup_front` Hips [0.0, 0.093, 0.012], Head [0.0, 0.101, 0.306].
- 무기 관통(실제 몸 메시, 바닥 포함): stumble weapon_bow: 3.7→1.0 cm(1 cm 넘는 프레임 22→0); knockdown weapon_bow: 4.3→0.8 cm(1 cm 넘는 프레임 8→0); getup weapon_bow: 7.1→2.1 cm(1 cm 넘는 프레임 39→1); getup_front weapon_bow: 3.7→0.8 cm(1 cm 넘는 프레임 27→0).

### 몸 텍스처 다시 굽기 (v3, 2026-10-24)
모바일용으로 감축한 몸의 UV가 잘게 쪼개진 Meshy 아틀라스 섬을 가로질러, 머리카락·얼굴에 흰색·살색 조각이 보이고 몸 색이 얼룩졌습니다(원본 텍스처에는 없음). 감축한 몸에 새 UV(xatlas, 큰 섬 몇 개)를 펴고 원본 몸에서 기본색을 2048²로 구워 넣었습니다(`ploh/tools/mocap/rebake_body.py`, 캐시 `raw/*_body*_baked.glb`·`_baked.png`). 이제 UV 이음매를 보호할 필요가 없어 감축할 때 이음매 보호를 끄고(seam_keep=1) 삼각형을 형태에 썼습니다. 몸 삼각형 8000개(이전과 같은 예산). 이전 방식은 `NO_REBAKE=1`로 다시 만들 수 있습니다.

## 화살 발사(게임 연동)
- 게임이 `shoot`의 **41프레임(1.367 s)**에 오른손에서 화살을 만들어 목표 쪽으로 쏘면 됩니다. 이 프레임은 당긴 손이 얼굴 옆 고정점에서 떨어지기 시작하는 첫 프레임입니다(`mocap_build.py`의 `release`: 오른손–머리 거리가 프레임당 8 mm 넘게 늘어나는 첫 프레임).
- 쓸 본: `RightHand`(시위를 당긴 손). 41프레임에서 Hips 기준 오른손은 (X −0.15, Y +0.28, Z 0.00) m, 활 쥔 왼손은 (−0.15, +0.25, +0.39) m입니다(모델 크기, +X 캐릭터 왼쪽). 오른손 → 왼손 방향이 캐릭터 +Z(약간 아래)라서, 궁수를 목표 쪽으로 돌려 두면 화살 방향과 겨눈 방향이 맞습니다.
- 활 노드: `weapon_bow`(Godot에서는 `Skeleton3D/weapon_bow` BoneAttachment3D 아래 MeshInstance3D). 끝에서 끝까지 0.88 m의 리커브 활(나무 날개, 놋쇠 끝 장식, 가죽 손잡이, 활 등의 시안 결정)이고 삼각형 220개, 텍스처 없는 단색 재질 5개(`prop_wood`, `prop_brass`, `prop_leather`, `prop_cyan`(발광), `prop_string`)입니다. 로컬 축(glTF): +Y = 위쪽 날개(엄지 쪽), +X = 활 등(주먹 마디 쪽 = 겨누는 쪽), 시위는 −X 쪽, 원점 = 주먹 안 손잡이.
- 무기 규칙("손 본 원점에서 가장 먼 정점 = 끝")을 그대로 쓰면 활의 끝은 날개 끝입니다. 궁수는 칼날 판정이 없으므로 `blade` 목록에 넣지 않는 편이 맞습니다.

## 무기 관통 검사
`ploh/tools/mocap/clipcheck.py`(실제 몸 메시 기준, 방법은 `../../astrid/B_mid/README.md`의 '무기 관통 검사·수정')로 활이 몸을 1 cm 넘게 파고드는 프레임을 찾아 손목 회전과 팔 IK로 뺐습니다. 활을 쥔 왼팔은 검사에서 뺍니다.

| 액션 | 무기 | 수정 전 최대 깊이 / 프레임 수 (부위) | 수정 후 | 손목 회전 최대 | 팔 IK 이동 최대 |
|---|---|---|---|---|---|
| idle | 활 | 2.2 cm / 26 (왼다리) | 0.6 cm / 0 | 11.9° | 0.0 cm |
| walk | 활 | 3.6 cm / 13 (왼다리, 오른다리) | 0.9 cm / 0 | 54.9° | 7.7 cm |
| shoot | 활 | 2.5 cm / 5 (왼다리) | 0.9 cm / 0 | 13.9° | 1.9 cm |
| hop_back | 활 | 3.1 cm / 5 (왼다리, 오른다리) | 1.0 cm / 0 | 35.4° | 2.9 cm |
| step_back | 활 | 5.2 cm / 21 (왼다리, 머리) | 0.8 cm / 0 | 60.0° | 10.6 cm |
| hit | 활 | 2.9 cm / 2 (왼다리) | 0.6 cm / 0 | 24.5° | 0.0 cm |
| death | 활 | 3.4 cm / 3 (왼다리) | 1.0 cm / 0 | 53.2° | 13.0 cm |

수정 뒤 GLB를 다시 검사하면 모든 클립에서 1 cm 넘게 파고드는 프레임이 없습니다(가장 깊은 곳 1.0 cm).

## 문제
- 시위는 활에 붙은 직선 메시라서 당길 때 늘어나지 않습니다. 손에 든 화살 메시도 없습니다(게임이 release 프레임에 화살을 만듦). 게임 카메라 거리에서 시위는 1픽셀 안팎입니다.
- shoot은 등 뒤 화살통에서 화살을 뽑는 동작부터 시작해 2.33 s로 깁니다. 빠른 연사가 필요하면 시위를 당기기 시작하는 20프레임부터 재생해도 됩니다(그때 release는 21프레임째).
- shoot 동안 몸이 옆으로 섭니다(왼쪽 어깨가 목표 쪽). idle에서 섞어 들어가는 8프레임 동안 발을 들어 옮기며 돕니다.
- 화살통은 몸 메시의 일부입니다(따로 숨길 수 없음).
- 로스터 소총병 패턴의 3점사·관통 차지샷·개머리판 치기 같은 동작은 만들지 않았습니다.
