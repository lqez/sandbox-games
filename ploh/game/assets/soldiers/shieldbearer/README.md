# 제국 방벽병 (Aegis Shieldbearer) — shieldbearer

갈루스 제국의 방패 중장보병입니다(`design/enemies/ROSTER.md` 3장). 프라우 `astrid/B_mid`와 같은 약 4.5등신 비율(투구가 머리), 같은 키 1.25 m, 같은 Meshy 휴머노이드 리그를 씁니다. 폭은 징집병보다 넓습니다(A-pose 몸 폭 0.80 m, 징집병 0.65 m).

## 파일
- `shieldbearer.glb`: 몸 메시 `body`(스킨) + `weapon_shield`(`LeftHand` 본의 자식) + `weapon_sword`(`RightHand` 본의 자식) + 아마추어 1개(24본), 액션 11개, 30 fps
- `turnaround.png`: gpt-image-2 3면도(정면·좌측면·후면, 1536×1024)
- `view_front.png`, `view_side.png`, `view_back.png`: 같은 배율·같은 발 높이로 자른 1024² 입력 이미지
- `beauty.png`: 정면 3/4, idle 0프레임, Eevee 1024². 방패가 몸을 다 가리지 않도록 캐릭터 오른쪽 앞(-35°)에서 찍었습니다
- `raw/`: Meshy 원본과 작업 JSON(`.gdignore`), `raw/rejected_sheets/`: 폐기한 3면도 v1, v2

## 제작 과정
징집병과 같습니다(`../conscript/README.md`의 제작 과정과 재현 스크립트). 3면도는 v3(B_mid + `design/enemies/shieldbearer/turnaround_sd.png`)를 채택했고, 증기 연기는 그리지 않게 했습니다. Meshy 사망 동작은 무릎을 꿇었다가 앞으로 쓰러지는 188번을 골랐습니다(로스터의 `death` 설명과 맞춤).

## Meshy 작업
| 단계 | 작업 ID | 크레딧 |
|---|---|---|
| multi-image-to-3d (latest, 2K 텍스처, PBR 없음, 삼각형 리메시 20k, A-pose) | `01a16963-d57c-7112-9aa9-2b14254fa2c7` | 30 |
| rigging (height_meters=1.25) | `01a16967-4ced-7165-bfde-517992b60fff` | 5 |
| animations (action_id 188 Fall Dead from Abdominal Injury) | `01a16968-5546-7288-81b7-87409ed1e3ad` | 3 |
| 합계 |  | 38 |

## 본 이름
징집병·B_mid와 같은 Meshy 24본입니다: `Hips`, `Spine02`, `Spine01`, `Spine`, `neck`, `Head`, `head_end`, `headfront`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, `RightShoulder`, `RightArm`, `RightForeArm`, `RightHand`, `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftToeBase`, `RightUpLeg`, `RightLeg`, `RightFoot`, `RightToeBase`. Godot는 `weapon_shield`(LeftHand 자식)와 `weapon_sword`(RightHand 자식)를 본으로도 만들어 26본이 되고, 각 메시는 같은 이름의 BoneAttachment3D 아래에 있습니다.

## 모캡 액션(현재 `shieldbearer.glb`, 30 fps)
손으로 키를 준 액션을 Meshy 애니메이션 라이브러리의 모캡 클립으로 바꿨습니다(2026-10-24). 클립은 이 캐릭터의 리깅 작업(`01a16967-4ced-7165-bfde-517992b60fff`)에 요청해 받았고, 몸 메시·텍스처·무기 노드(`weapon_*`는 손 본의 자식, 가장 먼 정점이 끝)·주먹 고침은 이전 GLB에서 그대로 가져왔습니다. 이전 GLB는 `raw/shieldbearer_handkeyed.glb`이고, 아래 '손 키 액션' 절은 그 버전 설명입니다.

| 액션 | 라이브러리 액션(ID) | 원본 프레임 | 길이 | 타격 프레임(빠른 구간), 칼끝 최고 속도 | 손질 |
|---|---|---|---|---|---|
| idle | Combat Idel (89) | 0–50 | 51 (1.67 s) | – | 루프 |
| walk | Walk Fight Forward (21) | 0–50 | 51 (1.67 s) | – | 루프. v2: 왼팔을 idle 자세로 두고 방패를 정면으로 세움(원본은 두 손으로 검을 쥐어 방패가 오른다리를, 검이 방패를 지나감) |
| run | 리깅 기본 달리기 | 0–19 | 20 (0.63 s) | – | 루프. v2: 왼팔 idle 자세, 방패 정면(원본 팔 흔들기는 방패를 눕혀 몸통에 넣음) |
| attack_1 | Triple Combo Attack (105) | 0–29 | 44 (1.43 s) | 23 (21–29), 16 m/s | idle에서 6프레임 섞어 시작, idle 복귀 14프레임 덧붙임 |
| shield_bash | Boxing Guard, Prep Straight Punch (210) | 30–84 | 45 (1.47 s) | 20 (19–21), 9.8 m/s(방패 모서리) | 좌우 반전, v2: 내지르는 6프레임을 3프레임으로 줄이고 방패를 내내 정면으로 세움, idle에서 10프레임 섞어 시작, 끝 12프레임 idle로 섞음, 무기 팔 idle 고정 |
| block | Block2 (139) | 0–47 | 48 (1.57 s) | – | 루프. v2: 복싱 가드 몸 + 방패를 정면으로 세우고 10 cm 내림, 무기 팔 idle 고정 |
| block_hit | Block4 (141) | 0–32 | 20 (0.63 s) | – | v2: 가드가 가슴 쪽으로 밀렸다 돌아옴(1.7배 빠르게), block에서 3프레임 섞어 시작, block으로 4프레임 복귀 |
| parry | Left Jab from Guard (191) | 2–40 | 25 (0.80 s) | 방패 타격 4 (2–5), 4.9 m/s, 방패 앞 구간 3–9 | 새 클립. block에서 3프레임 섞어 시작, 방패를 3프레임 만에 앞으로 내밀었다 회수, block으로 4프레임 복귀 |
| counter | Right Jab from Guard (192) | 6–30 | 35 (1.13 s) | 11 (11–12), 9.8 m/s | 새 클립. parry 끝(block 자세)에서 6프레임 섞어 시작, 검을 앞으로 겨눠 찌르기, 방패는 왼쪽으로 열림, idle 복귀 10프레임 |
| hit | Hit Reaction 1 (179) | 0–22 | 23 (0.73 s) | – | idle에서 3프레임 섞어 시작, 끝 8프레임 idle로 섞음, 양팔 idle 고정 |
| death | Fall Dead from Abdominal Injury (188) | 0–105 | 106 (3.50 s) | – | idle에서 4프레임 섞어 시작 |

- 모든 클립의 모든 프레임에 24본 키가 있고 보간은 선형입니다. 반복 설정은 GLB에 없습니다(idle·run·walk·block은 게임에서 루프로 바꿔야 함).
- 타격 프레임은 칼끝(무기 메시에서 손 본 원점과 가장 먼 정점) 속도가 가장 빠른 프레임이고, 빠른 구간은 최고 속도의 25% 이상인 연속 프레임입니다(`hero_measure.py`).
- 루트 이동: Hips의 수평 이동은 지우고(세로 이동은 남김) `shieldbearer_root.json`에 클립별·프레임별 X/Z로 남겼습니다. 값은 0프레임 기준이고 모델 크기 m(게임 배율을 곱해 씀), 캐릭터 기준 +Z 앞, +X 캐릭터 왼쪽입니다. 루프 클립은 평균·드리프트만 지우고 작은 흔들림은 남겼습니다.
- 공격·스킬은 idle 0프레임 자세에서 시작하고(콤보 2·3타는 앞 타의 마지막 프레임에서 이어짐) 마지막 타는 idle로 끝납니다. 자세를 섞는 구간에서 발이 미끄러지지 않게 발을 들어 옮기는 2본 IK를 넣었습니다.
- hit는 맞는 동안 무기 팔을 idle 자세로 고정한 짧은 움찔(23프레임)입니다.
- 몸 메시는 모바일용으로 줄였습니다: 삼각형 20,585 → 8,000. Blender Decimate(collapse) 전에 같은 위치·같은 방향 법선의 정점만 붙이고(UV 이음매 중복), 얼굴(가중치 0)·머리(0.1)·손(0.2)·UV 이음매(0.35)를 보호했습니다. 게임 카메라 거리에서는 원본과 구분되지 않습니다.
- Meshy 요청(라이브러리 애니메이션, 액션당 3 크레딧):

| 작업 ID | action_id | 크레딧 |
|---|---|---|
| `01a169eb-ae39-71f0-8439-c505c37f4537` | 89, 21, 92, 220, 147, 148, 151, 179 | 24 |
| `01a169f8-a810-7092-9dee-f2c7e11d3acd` | 105 | 3 |
| `01a16a08-f395-7502-bcde-b347fb44b526` | 210 | 3 |
| `01a16bdd-9a08-71f7-a491-099b8c366118` | 139, 140, 141, 191, 192 (막기·패리·반격, 140 Block3은 안 씀) | 15 |

### 막기·패리·반격 (2026-10-24, v2)
방패 병사가 막고(block), 영웅의 공격을 방패로 쳐내고(parry), 찌르기로 반격(counter)하는 흐름입니다. 방패 징집병(`../conscript_shield/`)과 같은 설정(`mocap_build.py`의 `SHIELD_NEW`)을 씁니다.
- 흐름: `block`(루프) → 맞는 순간 `parry` → `counter` → idle. parry는 block 자세로 시작하고 끝나며, counter는 그 자세에서 시작합니다. 막는 중 맞으면 `block_hit`(block 자세로 시작·끝).
- 라이브러리에 방패 막기가 없습니다. 복싱 가드(Block2, Block4)와 잽(Left/Right Jab from Guard)의 몸과 방패 팔을 쓰고, 주먹 방향 그대로면 방패가 머리 위로 눕기 때문에 방패 바깥면이 캐릭터 정면(약간 위), 세로축이 위를 향하도록 손 회전을 덮어썼습니다(`motion.orient_prop`, `shield_axes`). block·block_hit·parry·counter에서는 방패 손을 10 cm 내려(IK) 투구부터 무릎 위까지 가립니다.
- parry는 방패로 쳐내는 짧은 동작입니다. 방패 앞 구간(3–9프레임, 0.10–0.30 s)을 패리 판정 창으로 쓸 수 있습니다.
- counter는 영웅의 thrust와 같은 방법(Right Jab + 검 방향 덮어쓰기 + IK로 10 cm 더 뻗음)입니다. 찌르는 동안 방패를 왼쪽 뒤로 16 cm 열고 바깥쪽으로 돌려 검이 방패를 지나가지 않게 했습니다.
- 이전 block(Sword Parry)·block_hit(Sword Parry Backward)은 손바닥을 편 칼 막기라 방패가 머리 위에 우산처럼 눕고 검이 방패를 지나갔습니다. 이전 shield_bash는 내지르는 순간 방패가 옆으로 서 있었습니다(4 m/s).

### 문제
- 라이브러리에 방패 치기가 없습니다. Shield Push Left는 방패를 옆으로 세워 미는 동작이라 쓰지 않았고, 주먹(=방패 앞면)이 앞으로 나가는 Boxing Guard, Prep Straight Punch를 좌우 반전해 방패 팔에 입혔습니다. 칼 든 팔은 idle 자세를 유지합니다. 준비 자세에서 방패를 머리 높이로 듭니다.
- 방패로 막는 전용 동작은 라이브러리에 없어서 복싱 가드에 방패 방향을 덮어썼습니다(위 '막기·패리·반격').
- 이전 버전의 'attack_1 5프레임에서 칼날이 투구를 9.5 cm 지나감'은 캡슐 검사의 과대 추정이었습니다. 실제 몸 메시 검사로는 20프레임에 1.5 cm였고 v2에서 고쳤습니다(아래 표).
- 라이브러리 클립은 레퍼런스(예비 150–250 ms, 베기 50–130 ms)보다 예비 동작이 깁니다. 시간 재배치는 게임 코드가 맡습니다.

### 무기 관통 검사·수정 (2026-10-24)
`ploh/tools/mocap/clipcheck.py`로 실제 몸 메시(감축 전 `raw/shieldbearer_handkeyed.glb`)에 대해 무기 관통을 프레임마다 검사하고, `mocap_build.py`가 클립마다 손목 회전과 팔 IK로 고칩니다(방법은 `../../astrid/B_mid/README.md`의 '무기 관통 검사·수정'). 무기를 쥔 손과 아래팔은 검사에서 빼고(방패는 왼팔 전체), 검이 자기 방패를 지나가는 것도 관통으로 셉니다. 무기 관통 수정으로 공격 클립의 타격 프레임은 바뀌지 않았습니다(attack_1 23, shield_bash 20, counter 11). 아래는 이전 GLB(`raw/shieldbearer_mocap1.glb`)와 새 GLB를 같은 검사로 비교한 결과입니다(1 cm 복셀 기준, ±0.5 cm).

| 액션 | 무기 | 이전 GLB: 최대 깊이 / 1 cm 넘는 프레임 (부위) | 새 GLB | 수정: 손목 회전 최대 / 팔 IK 이동 최대 |
|---|---|---|---|---|
| idle | 방패 | 1.6 cm / 12 (오른팔) | 0.6 cm / 0 | 6.0° / 0.0 cm |
| walk | 방패 | 7.3 cm / 51 (오른다리) | 0.0 cm / 0 | 0.0° / 0.0 cm |
| walk | 검 | 7.1 cm / 51 (자기 방패) | 0.0 cm / 0 | 0.0° / 0.0 cm |
| run | 방패 | 6.8 cm / 13 (왼다리, 오른다리) | 0.0 cm / 0 | 0.0° / 0.0 cm |
| run | 검 | 7.8 cm / 10 (자기 방패) | 0.6 cm / 0 | 21.2° / 0.0 cm |
| attack_1 | 방패 | 4.9 cm / 15 (왼다리, 오른팔, 오른다리) | 0.6 cm / 0 | 10.8° / 0.0 cm |
| attack_1 | 검 | 1.5 cm / 1 (머리) | 0.5 cm / 0 | 5.4° / 0.0 cm |
| shield_bash | 방패 | 2.7 cm / 7 (오른팔, 머리) | 0.7 cm / 0 | 17.4° / 0.0 cm |
| shield_bash | 검 | 3.1 cm / 2 (자기 방패) | 0.0 cm / 0 | 0.0° / 0.0 cm |
| block | 검 | 6.8 cm / 55 (자기 방패) | 0.0 cm / 0 | 0.0° / 0.0 cm |
| block_hit | 방패 | 3.0 cm / 31 (머리) | 0.4 cm / 0 | 5.7° / 0.0 cm |
| block_hit | 검 | 7.8 cm / 32 (왼팔, 자기 방패) | 0.1 cm / 0 | 59.3° / 8.4 cm |
| hit | 방패 | 1.2 cm / 12 (오른팔) | 0.1 cm / 0 | 0.0° / 0.0 cm |
| death | 방패 | 5.6 cm / 103 (왼다리, 오른팔, 오른다리) | 5.5 cm / 19 (왼다리, 오른팔, 오른다리) | 60.0° / 18.8 cm |
| death | 검 | 7.8 cm / 99 (자기 방패) | 7.8 cm / 56 (왼팔, 왼다리, 오른팔, 오른다리, 머리, 자기 방패, 몸통) | 60.0° / 30.5 cm |

- death는 앞으로 쓰러지며 검·방패를 몸 아래에 깔아서 다 빼지 못했습니다(검이 방패를 56프레임, 방패가 다리를 19프레임 지나감). 적의 죽음은 게임에서 래그돌을 쓰고 이 클립은 래그돌이 없을 때만 쓰므로 그대로 두었습니다.

### 재현
- Meshy 요청: `uv run --no-project --with requests python ploh/tools/heroes/meshy.py soldiers/shieldbearer anim <action_id,...> <태그>` (`raw/animations_<태그>.glb`)
- GLB·사이드카: `uv run --no-project --with numpy --with scipy python ploh/tools/mocap/mocap_build.py shieldbearer` (클립 표는 이 스크립트의 `SPEC`, 몸 감축은 `decimate_body.py`를 헤드리스 Blender로 실행, 무기 관통 검사·수정은 `clipcheck.py`, 그 밖의 검사는 `qa.py`)
- 무기 관통 검사만: `uv run --no-project --with numpy --with scipy python ploh/tools/mocap/clipcheck.py ploh/game/assets/soldiers/shieldbearer/shieldbearer.glb`
- 이전 GLB: 모캡 1차 버전은 `raw/shieldbearer_mocap1.glb`(+ `raw/shieldbearer_root_mocap1.json`), 손 키 버전은 `raw/shieldbearer_handkeyed.glb`

## 손 키 액션(이전 버전, `raw/shieldbearer_handkeyed.glb`, 30 fps)
이 절과 아래 하위 절은 모캡으로 바꾸기 전의 액션 설명입니다.
공격 구조는 징집병과 같습니다: 가드(idle 0프레임) → 예비(무기를 크게 당김) → 4프레임 타격(접촉까지 가속) → 오버슈트 → 가드로 복귀.

| 액션 | 출처 | 길이 | 예비 끝 / **접촉** / 타격 끝 | 내용 |
|---|---|---|---|---|
| `idle` | 직접 제작 | 2.00 s(60f, 루프) | – | 가드: 왼발 앞, 상체를 살짝 오른쪽으로 틀어 방패를 정면에 세움. 검은 오른쪽 허리에서 앞·바깥으로 |
| `walk` | Meshy 기본 걷기 + 양팔 재작성 | 1.03 s(31f, 루프) | – | 방패를 가슴 앞에 세운 채 전진(`walk_guard` 겸용), 검은 허리 옆 |
| `run` | Meshy 기본 달리기 + 양팔 재작성 | 0.63 s(19f, 루프) | – | 방패는 앞에, 검은 뒤로 낮게 |
| `attack_1` | 직접 제작 | 1.00 s(30f) | 12 / **14 (0.467 s, 47%)** / 16 | 짧은 검 내려베기. 0–12 검을 머리 뒤로 들고 방패를 왼쪽으로 젖힘(정면이 열림, 로스터 패턴 3의 틈), 14 오른발 런지와 함께 접촉, 20 칼끝이 바닥 쪽으로 끌리며 상체가 숙여짐, 30 복귀 |
| `shield_bash` | 직접 제작 | 1.00 s(30f) | 12 / **14 (0.467 s, 47%)** / 16 | 몸을 오른쪽으로 −46° 감고 방패를 끌어당겨 웅크렸다가(0–12) 왼발 런지와 함께 방패를 앞으로 밀어 침(14), 20 상체가 더 쏠림, 30 복귀 |
| `block` | 직접 제작 | 2.00 s(60f, 루프) | – | 방어 대기(가드/블록 idle): 더 웅크리고 방패를 투구 높이까지 올림, 검은 낮게 겨눔 |
| `block_hit` | 직접 제작 | 0.50 s(15f) | 충격 3 | `block` 자세에서 정면 타격을 받는 반동. `block` 자세로 시작하고 끝남 |
| `hit` | 직접 제작 | 0.40 s(12f) | 정점 3 | 가벼운 움찔(상체·머리 뒤로, 방패가 조금 내려감) |
| `death` | Meshy 188 | 3.50 s(105f) | – | 무릎 꿇고 앞으로 쓰러짐. 루트(Hips) 이동 있음 |

- 방패 면의 방향은 손목이 아니라 가슴 방향을 따라가게 키를 잡았습니다. 몸을 틀어도 방패가 수직으로 정면을 향합니다.
- 반복 설정은 GLB에 없습니다(`idle`, `walk`, `run`, `block`은 Godot에서 LOOP_LINEAR로).

### 도달 거리(모델 1.25 m 기준, 캐릭터 원점에서 앞쪽 m / 높이 m)
| 액션 | 무기 | 접촉 프레임 끝점 | 접촉 프레임 손잡이 | 타격 구간에서 높이 0.45–0.95 m를 지나는 최대 앞 거리 |
|---|---|---|---|---|
| `attack_1` | `weapon_sword` | 0.88 / 0.63 | 0.42 / 0.91 | 0.88 m |
| `shield_bash` | `weapon_shield` | 0.59 / 0.38 | 0.51 / 0.78 | 0.58 m |

방패의 "가장 먼 정점"은 방패 모서리라서 끝점 판정이 짧게 나옵니다. 방패 면은 접촉 때 몸 앞 약 0.5–0.6 m에서 높이 0.35–1.15 m를 막습니다. 방패 강타는 판정을 범위(부채꼴)로 처리하는 편이 맞습니다.

## 무기·손
- `weapon_shield`: 스크립트로 만든 사각 탑 방패. 0.50 × 0.80 m(테두리 포함), 건메탈 판 + 금색 테두리 + 남색 안쪽 판 + 금색 마름모·날개(독수리 문장 단순화) + 호박색 발광 코어. 삼각형 184개, 단색 재질 6개. 로컬 축: +X = 방패 바깥면 법선, +Y = 방패 세로, +Z = 손잡이(가로) 축, 원점 = 주먹 안 손잡이.
- `weapon_sword`: 짧은 검(전체 0.62 m, 칼날 0.46 m, 폭 6 cm, 주황 열선). 삼각형 102개. 축 규칙은 징집병과 같습니다(+Z 칼날, +X 날).
- 양손 모두 메시를 말아 주먹으로 만들었습니다(건틀릿).
- 요청에 따라 로스터의 전투 곡괭이 대신 짧은 검을 들렸습니다.

## 정리 결과
- 키 1.25 m(Godot AABB 높이 1.250), 발바닥 원점, 정면 +Z, 변환 적용
- 머리(투구) 폭 0.177 m(B_mid 0.217 m), 목 관절~깃 장식 끝 0.299 m(B_mid 0.313 m)
- 삼각형: 몸 20,585 + 방패 184 + 검 102 = 20,871
- 텍스처: 몸 베이스 컬러 1024² JPEG 1장. 소품은 텍스처 없음

## 문제
- 방패가 커서(몸 높이의 64%) 정면에서는 다리와 투구만 보입니다. 로스터 의도(정면을 막는 벽)대로지만, 옆·뒤에서 봐야 몸이 잘 보입니다.
- 방패는 손 본에 고정된 강체라 손목 회전이 크게 바뀌는 `death`에서는 몸을 뚫거나 이상한 각도가 될 수 있습니다(게임은 래그돌 예정).
- 직접 만든 동작은 키포즈 + IK라 딱딱하고 런지 때 발이 조금 미끄러질 수 있습니다.
- 로스터의 `attack_pick`, `attack_shockwave`, `shield_break`, `spawn` 등은 만들지 않았습니다. 방패 파괴 뒤에는 `weapon_shield`를 숨기고 기존 동작을 그대로 쓰면 됩니다(왼팔은 방패를 든 자세로 남음).
