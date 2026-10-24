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

- 모든 클립의 모든 프레임에 24본 키가 있고 보간은 선형입니다. 반복 설정은 GLB에 없습니다(idle·walk·run은 게임에서 루프로 바꿔야 함).
- 루트 이동: 다른 병사와 같습니다. Hips의 수평 이동을 지우고 `archer_root.json`에 클립별·프레임별 X/Z(0프레임 기준, 모델 크기 m, +Z 앞, +X 캐릭터 왼쪽)로 남겼습니다. run은 한 바퀴에 1.39 m, hop_back은 −1.33 m, step_back은 −0.32 m입니다.
- 몸 메시는 모바일용으로 줄였습니다: 삼각형 20,656 → 8,000(다른 병사와 같은 `decimate_body.py` 설정).

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
