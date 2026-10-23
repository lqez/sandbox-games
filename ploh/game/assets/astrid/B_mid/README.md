# 프라우(아스트리드 레몽) — B_mid

비율 비교용 변형. 약 4.5–4.7 등신, 키 1.25 m(머리 크기를 A안 1.7 m와 맞춤).

## 파일
- `astrid.glb` — 몸 메시 `char1`(스킨) + 무기 메시 `weapon_sword`(오른손 본 `RightHand`의 자식) + 아마추어 1개(Meshy 휴머노이드 24본), 액션 10개, 30 fps
- `turnaround.png` — gpt-image-2 3면도(정면·좌측면·후면, 1536×1024)
- `view_front.png`, `view_side.png`, `view_back.png` — 3면도를 같은 배율로 자른 1024² 입력 이미지
- `beauty.png` — 정면 3/4, idle 0프레임(검을 든 경계 자세), Eevee 1024²
- `ingame.png` — 4×4 m 바닥, 세로 화각 50°, 피치 38°, 요 45°, 발 위 1 m 지점에서 8 m, 720×1280, attack_1 타격 프레임(10/24)
- `raw/` — Meshy 원본(`model.glb`, `rigged.glb`, `basic_walking.glb`, `basic_running.glb`, `animations.glb`, 썸네일, `tasks.json`)
- `raw/old_single_image/` — 폐기한 첫 시도(단일 정면 이미지 → image-to-3d). 결과물에는 쓰지 않음

## Meshy 작업
| 단계 | 작업 ID | 크레딧 |
|---|---|---|
| multi-image-to-3d (meshy 7.1, 2K 텍스처, 삼각형 리메시 30k, A-pose) | `01a16921-328d-7128-9bca-aaefa55f3201` | 30 |
| rigging (height_meters=1.25) | `01a16923-b3c3-7180-af89-87ab0c3fc003` | 5 |
| animations (action_ids 10개) | `01a16924-03d2-725b-9bd0-ad1d4e4f6244` | 30 |
| (폐기) image-to-3d / rigging / animations | `01a1691c-2f04-75ac-9b58-2169c5fc656e` / `01a1691e-2df4-73da-aae5-ee1d991115fe` / `01a1691e-82e4-758a-92e9-6f21790a25fd` | 65 |

이 변형 합계 130 크레딧(사용 65 + 폐기 65).

## 액션
Meshy 라이브러리를 먼저 검토했다. 미리보기 GIF로 보면 한손검을 오른손에 든 동작은 Left Slash(97), Double/Triple Combo(92/105)인데 모두 방패를 든 동작이고 길이가 3초 이상이었다. Right-hand Sword Slash(219), Charged Slash(242)는 맨손 동작처럼 보였다. 리그에 손가락 본이 없어 손이 펼쳐진 채로 남는 문제도 있었다. 그래서 공격 계열은 Meshy 리그 위에 헤드리스 Blender에서 직접 만들었다(키포즈 + 2본 IK, 매 프레임 베이크). 추가 Meshy 크레딧은 쓰지 않았다.

| 액션 | 출처 | 길이 | 내용 |
|---|---|---|---|
| idle | 직접 제작 | 2.00 s (루프) | 검을 앞으로 든 경계 자세, 호흡 |
| run | Meshy Run 02(14) + 오른팔 재작성 | 0.70 s (루프) | 하체·몸통은 Meshy, 오른팔은 검을 허리 옆에 낮게 들도록 매 프레임 IK로 덮어씀 |
| attack_1 | 직접 제작 | 0.80 s | 오른쪽→왼쪽 수평 베기. 예비 0–7, 타격 10(42%), 회복 13–24 |
| attack_2 | 직접 제작 | 0.80 s | 왼쪽 아래→오른쪽 위 올려 베기. 타격 10(42%) |
| attack_3 | 직접 제작 | 1.00 s | 머리 위에서 내려찍기 + 전진 런지. 타격 13(43%) |
| spin | 직접 제작 | 1.00 s | 검을 옆으로 뻗고 왼쪽으로 360° 회전베기. 정점 13(43%) |
| cast | 직접 제작 | 0.90 s | 찌르기형 스킬(왼손을 앞으로 내밀었다가 오른손 찌르기). 타격 11(41%) |
| dodge | Meshy Roll Dodge(158) | 1.80 s | 그대로 |
| hit | Meshy Hit Reaction(178) | 1.63 s | 그대로 |
| death | Meshy Dead(8) | 2.97 s | 그대로 |

공격·스킬 액션은 모두 idle 0프레임과 같은 경계 자세에서 시작하고 끝난다. 직접 만든 액션은 모든 프레임에 키가 있고 보간은 선형이다.

## 무기·손
- `weapon_sword`: KayKit Adventurers `Knight.glb`의 `1H_Sword`(삼각형 300개, KayKit 텍스처 1024²)를 길이 0.72 m로 줄였다. 손잡이 중심은 주먹 안쪽에 맞췄다.
- 손가락 본이 없어서 오른손 손가락 정점을 기본 메시에서 손바닥 쪽으로 약 145° 말아 주먹으로 만들었다(셰이프 키가 아니라 메시 자체를 고침). 모든 액션에서 오른손은 주먹이다. 왼손은 펼친 채로 두었다.

## 정리 결과
- 키 1.25 m, 발바닥이 원점(z=0), 수평 중심 정렬, glTF +Z 정면, 변환 적용(스케일 1)
- 삼각형: 몸 31,086 + 검 300. 텍스처: 몸 2048² 베이스 컬러 1장 + 검 1024² 1장(PBR 없음)
- 노멀 재계산, 스무스 셰이딩
- Blender 헤드리스(5.0.1)로 처리. 실시간 Blender 세션은 쓰지 않음

## 문제
- 얼굴 텍스처의 코·입 주변에 밝은 살색 얼룩이 있다(Meshy 텍스처 베이크 문제). 가까이서 보면 눈에 띈다
- 직접 만든 공격 액션은 스크립트 키포즈라서 모캡보다 딱딱하다. 발이 약간 미끄러질 수 있다(spin은 발도 같이 회전)
- dodge/hit/death는 Meshy 원본이라 검을 든 자세를 고려하지 않았다. 칼이 몸을 뚫는 프레임이 있을 수 있다
- 원작의 떠다니는 칼날 날개는 일부러 뺐다(별도 소품 예정)
- 루트 이동이 들어 있는 액션(dodge, death 등)은 Hips 위치가 움직인다

## 재현 스크립트
`ploh/tools/blender/`에 있다(모두 헤드리스 Blender용):
- `astrid_refine.py` — Meshy `raw/animations.glb`의 액션 이름 변경, 키 맞춤, 원점·변환 정리
- `astrid_author_sword.py` — 검과 주먹을 넣고 직접 만든 액션을 베이크한다. run은 오른팔만 덮어쓴다
- `astrid_render.py` — `beauty.png`, `ingame.png` 렌더
- `astrid_views.py` — 검토용 다각도 렌더
