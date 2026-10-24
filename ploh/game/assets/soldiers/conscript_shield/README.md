# 방패 징집병 (Conscript with Shield) — conscript_shield

일반 징집병(`../conscript/`)에 방벽병의 탑 방패를 들린 변형입니다(2026-10-24). 막고(block), 영웅의 공격을 방패로 쳐내고(parry), 바로 찌르기로 반격(counter)합니다. 몸·텍스처·검·키·리그는 징집병과 같고, 동작은 징집병 리깅 작업에 요청한 Meshy 라이브러리 모캡입니다. 새 Meshy 3D 생성이나 리깅은 하지 않았습니다.

## 왜 방패 소품을 붙였나
징집병 메시를 새로 만들지 않고 방패만 붙이는 편이 낫다고 판단했습니다.
- 같은 병종이 방패 유무로만 달라야 플레이어가 "막는 징집병"을 바로 알아봅니다. 새 3면도로 다시 만들면 얼굴·코트가 조금씩 달라집니다.
- 방패는 손 본의 자식인 강체 소품이라 게임이 `weapon_shield`를 숨기면 방패를 잃은 상태가 됩니다(방벽병과 같은 방식).
- Meshy 크레딧이 라이브러리 동작 3개(9 크레딧)만 들었습니다.

## 파일
- `conscript_shield.glb`: 몸 메시 `body`(스킨, 징집병과 같은 메시를 8,000 삼각형으로 감축) + `weapon_shield`(`LeftHand` 본의 자식) + `weapon_sword`(`RightHand` 본의 자식) + 아마추어 1개(24본), 액션 9개, 30 fps
- `conscript_shield_root.json`: 클립별 루트 이동(다른 병사와 같은 형식)
- `beauty.png`: 정면 3/4(캐릭터 오른쪽 앞 -35°, 방패가 몸을 다 가리지 않는 쪽), idle 0프레임, Eevee 1024²
- `raw/conscript_shield_handkeyed.glb`: 기준 GLB(징집병 기준 GLB + 왼손 주먹 + 방패). `raw/conscript_shield_body8000.glb`: 감축한 몸. `.gdignore`로 Godot 가져오기에서 뺐습니다

## 제작 과정
1. 기준 GLB: 헤드리스 Blender `ploh/tools/blender/graft_shield.py -- soldiers/conscript/raw/conscript_handkeyed.glb soldiers/shieldbearer/raw/shieldbearer_handkeyed.glb soldiers/conscript_shield/raw/conscript_shield_handkeyed.glb 0.85`
   - 징집병의 왼손 손가락을 말아 주먹을 만들고(`soldier_lib.make_fist`, 메시 자체 수정), 방벽병의 `weapon_shield` 메시를 0.85배(0.43 × 0.68 m, 테두리 포함)로 줄여 왼손 주먹에 붙였습니다. 축 규칙은 방벽병과 같습니다(+X = 방패 바깥면 = 주먹 마디 쪽, 세로 = 엄지 축과 직각).
2. Meshy 라이브러리 동작 요청(징집병 리깅 작업): `ploh/tools/heroes/meshy.py soldiers/conscript anim 139,191,192 shield` → `soldiers/conscript/raw/animations_shield.glb`
3. GLB·사이드카: `uv run --no-project --with numpy --with scipy python ploh/tools/mocap/mocap_build.py conscript_shield`(클립 표는 `SPEC["conscript_shield"]`와 방벽병과 공유하는 `SHIELD_NEW`, 라이브러리 클립은 `anim_raw`로 징집병 `raw/`에서 읽음)

| 작업 ID | action_id | 크레딧 |
|---|---|---|
| `01a16bdd-9a10-7219-b093-0dfe99f17140` | 139 Block2, 191 Left Jab from Guard, 192 Right Jab from Guard | 9 |

## 모캡 액션(`conscript_shield.glb`, 30 fps)
| 액션 | 라이브러리 액션(ID) | 원본 프레임 | 길이 | 이벤트 | 손질 |
|---|---|---|---|---|---|
| idle | Combat Idel (89) | 0–50 | 51 (1.67 s) | – | 루프(검·방패 전투 대기라 방패가 몸 앞에 옴) |
| walk | Walk Fight Forward (21) | 0–50 | 51 (1.67 s) | – | 루프. 원본은 두 손으로 검을 쥐어서 왼팔을 idle 자세로 두고 방패를 정면으로 세움 |
| run | 리깅 기본 달리기 | 0–19 | 20 (0.63 s) | – | 루프. 왼팔을 idle 자세로 두고 방패를 정면으로 세움(원본 팔 흔들기는 방패를 눕혀 몸통에 넣음) |
| attack_1 | Left Slash (97) | 0–34 | 47 (1.53 s) | 타격 26 (13–32), 20 m/s | 징집병 attack_1과 같음(검·방패 모캡) |
| block | Block2 (139) | 0–47 | 48 (1.57 s) | – | 루프. 방패를 정면으로 세우고 10 cm 내림, 검 팔은 idle 자세 |
| parry | Left Jab from Guard (191) | 2–40 | 25 (0.80 s) | 방패 타격 4 (2–5), 방패 앞 구간 3–9 (0.10–0.30 s) | block에서 3프레임 섞어 시작, 방패를 3프레임 만에 앞으로 내밀었다 회수, block 자세로 4프레임 복귀 |
| counter | Right Jab from Guard (192) | 6–30 | 35 (1.13 s) | 타격 11 (11–12), 8.3 m/s | parry 끝(block 자세)에서 6프레임 섞어 시작, 검을 앞으로 겨눠 찌르기, 방패는 왼쪽으로 열림, idle 복귀 10프레임 덧붙임 |
| hit | Hit Reaction 1 (179) | 0–22 | 23 (0.73 s) | – | 징집병 hit과 같음 |
| death | Dying Backwards (189) | 0–66 | 67 (2.20 s) | – | 징집병 death와 같음 |

- 흐름: `block`(루프) → 영웅의 공격을 맞는 순간 `parry` → `counter` → idle. parry의 마지막 프레임과 counter의 첫 프레임이 같은 block 자세라 바로 이어집니다. parry는 block 자세로 끝나므로 막기를 계속하려면 다시 block으로 돌아가면 됩니다.
- 방패 방향: 복싱 동작의 주먹은 방패를 머리 위로 눕힙니다. 그래서 block·parry·counter·walk·run에서는 방패 바깥면이 캐릭터 정면(약간 위)을, 방패 세로축이 위를 향하도록 손 회전을 덮어썼습니다(`motion.orient_prop`).
- 타격 프레임은 칼끝(무기 메시에서 손 본 원점과 가장 먼 정점) 속도가 가장 빠른 프레임이고, 빠른 구간은 최고 속도의 25% 이상인 연속 프레임입니다. parry는 방패 모서리 기준입니다.
- 루트 이동·반복 설정·감축은 징집병과 같습니다(idle·walk·run·block은 게임에서 루프로 바꿔야 함).

## 무기 관통 검사
`ploh/tools/mocap/clipcheck.py`로 검·방패가 몸(또는 검이 자기 방패)을 1 cm 넘게 파고드는 프레임을 찾아 손목 회전과 팔 IK로 뺐습니다. 결과는 아래 표와 같습니다(검사 방법은 `../../astrid/B_mid/README.md`의 '무기 관통 검사·수정').

| 액션 | 무기 | 수정 전 최대 깊이 / 프레임 수 (부위) | 수정 후 | 손목 회전 최대 | 팔 IK 이동 최대 |
|---|---|---|---|---|---|
| walk | 검 | 1.4 cm / 11 (머리) | 0.5 cm / 0 | 6.0° | 0.0 cm |
| run | 검 | 6.6 cm / 7 (머리, 자기 방패) | 0.9 cm / 0 | 25.3° | 0.0 cm |
| attack_1 | 검 | 1.6 cm / 1 (자기 방패) | 0.2 cm / 0 | 10.7° | 0.0 cm |
| counter | 방패 | 2.4 cm / 1 (오른팔) | 0.6 cm / 0 | 5.2° | 0.0 cm |
| counter | 검 | 5.1 cm / 10 (자기 방패) | 0.3 cm / 0 | 34.9° | 2.6 cm |
| death | 방패 | 3.8 cm / 8 (왼다리, 오른다리) | 1.6 cm / 1 | 22.7° | 16.2 cm |
| death | 검 | 6.5 cm / 8 (자기 방패) | 1.3 cm / 1 | 60.0° | 18.2 cm |

수정 뒤 GLB를 다시 검사하면 death에만 짧게 남습니다(방패가 다리를 2.0 cm/2프레임, 검이 머리를 1.3 cm/1프레임). 적의 죽음은 게임에서 래그돌을 쓰므로 그대로 두었습니다. 공격 클립(attack_1, counter)의 타격 프레임은 바뀌지 않았습니다.

## 문제
- 방패는 손 본에 고정된 강체라 death에서는 방패가 다리를 지나갈 수 있습니다(게임은 래그돌 예정).
- 방패를 쥔 주먹은 메시만 구부린 것이라 가까이서 보면 손가락이 손잡이를 조금 뚫습니다.
- block_hit은 만들지 않았습니다(요청 목록에 없음). 필요하면 방벽병처럼 Block4(141)를 징집병 리그로 요청하면 됩니다.
