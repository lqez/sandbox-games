# 던전 배경 구현 과제 (TASKS)

> 작성일: 2026-10-24 · 근거: `ART_DIRECTION.md`, `REFERENCES.md`, 콘셉트 그림 `concept_*.png`
> 이 조사에서는 `ploh/game/`을 고치지 않았다. 아래 함수 이름은 2026-10-24 시점 `scripts/dungeon.gd`(`_materials`, `_build_floor`, `_build_walls`, `_wall_quad`, `_decorate`, `_scatter`, `_puddle`, `_flame`, `flicker`)와 `scripts/game.gd` `_build_env()` 기준이다.
> 비용 표기: **그리기 호출**(draw call), **VRAM**(ASTC 4×4 = 1바이트/픽셀, 1024² 한 장이 밉맵 포함 약 1.33 MB. 프로젝트는 `textures/vram_compression/import_etc2_astc=true`), **픽셀당 텍스처 샘플·조명 수**, **반투명 겹침**. 실제 프레임 시간은 기기에서 `?fps`로 재야 한다. 아래 숫자는 추정이다.

---

## 0. 권장 착수 순서 (상위 5)

| 순서 | 과제 | 기대 효과 | 모바일 비용 |
|---|---|---|---|
| 1 | **T06** 벽 윗면 둔덕 + 벽 밖 암반면 | 지금 화면의 12–22%를 차지하는 거의 검은 허공을 없앤다. "어둡다·덜 만들었다"는 인상이 가장 크게 바뀐다(콘셉트 그림 0.4–2.2%) | 벽 윗면 메시를 둔덕으로 바꾸면 호출 수 그대로, 암반면 +1 호출(언릿). `earth_roots` 1.33 MB(노멀 생략 가능) |
| 2 | **T02** 판석 바닥 + 거리장 마스크 | 고른 자갈이 반복되는 타일 느낌을 없앤다. 벽 가까이 흙·잔해, 길을 따라 닳은 판석이 "사람이 다닌 곳"을 만든다 | `floor_stone`을 대체하면 VRAM 증감 0(같이 두면 +2.7 MB). 픽셀당 샘플 7 → 6 |
| 3 | **T05** 벽 2단 재질 + 들쭉날쭉한 윗선 + 벽기둥·아치 | 방을 두른 "울타리"가 무너진 성벽과 동굴 암반으로 읽힌다 | 벽 셰이더 샘플 +2, VRAM +2.7 MB. 벽기둥은 MultiMesh로 +1–2 호출, 아치 문은 복도 끝마다 1개(약 8개) |
| 4 | **T04** 정점 라이트 베이크 + 실제 조명은 영웅 근처 2–3개 | 횃불·모닥불·버섯·마도등의 빛 웅덩이를 개수 제한 없이 둔다. 밝기는 유지하면서 리듬이 생긴다 | GPU는 오히려 줄어든다(픽셀당 동적 조명 수 감소). 생성 때 CPU는 SDF 격자 단위로 구우면 무시할 수준 |
| 5 | **T13 + T07 + T03** 이야기 소품과 소품 색 | 야영지·유골·게시판·버섯·뿌리·제국 잔해로 던전밥의 생활감. 복숭앗빛 장난감 통이 낡은 나무로 | 공유 아틀라스라 VRAM 0. 신규 소품 합계 1–2천 삼각형, 종류별 MultiMesh로 레벨 전체 +8–12 호출 |

---

## 1. 과제 목록

| ID | 우선 | 과제 | 종류 | 손댈 곳 | 모바일 비용 |
|---|---|---|---|---|---|
| T01 | P0 | 환경 색 조정(보라 기 빼기, 배경·안개 밝히기) | 조명 | `game.gd` `_build_env()` | 0 |
| T02 | P0 | 판석 바닥 + 거리장·정점 마스크 | 텍스처·셰이더 | `_materials()`, `_build_floor()`, `shaders/floor.gdshader` | VRAM 0(대체 시), 샘플 7→6 |
| T03 | P0 | 소품 색: 아틀라스 나무색 + 토온 셰이더 림·그늘 | 텍스처·셰이더 | `tools/mute_palette.py` → `palette_dungeon_muted.png`, `Fx.toonify()` 호출부 | 0 |
| T04 | P0 | 정점 라이트 베이크 + 동적 조명 축소 | 조명·셰이더 | `_build_floor()`, `_wall_quad()`, `_decorate()`, `flicker()`, 두 셰이더 | GPU 감소 |
| T05 | P0 | 벽 2단 재질, 윗선 높낮이, 벽기둥, 아치 문 | 셰이더·배치 | `_wall_quad()`, `shaders/wall.gdshader`, `_decorate()` | 샘플 +2, VRAM +2.7 MB, 호출 +10 안팎 |
| T06 | P0 | 벽 윗면 둔덕 + 벽 밖 암반면 | 메시·배치 | `_wall_quad()`(윗면), 새 `_build_backdrop()` | 호출 +1, VRAM +1.33 MB |
| T07 | P1 | 2번 방 야영지 세트 | 소품 메시 | `_decorate()` | 호출 +3–5, 약 400 tri |
| T08 | P1 | 전투 없는 복도의 바랜 카펫 런너 | 메시 | `_decorate()`(경로 `route` 사용) | 호출 +1 |
| T09 | P1 | 전투 흔적(떨어진 방패·검)과 제국 증기관 | 소품 메시 | `_decorate()` | 호출 +2(MultiMesh) |
| T10 | P1 | 웅덩이 색과 위치 | 셰이더·배치 | `water*.gdshader` `tint`, `_puddle()`, `_decorate()` | 0 |
| T11 | P2 | 보스 방 원형 단의 방사형 판석 | 메시·텍스처 | 보스 방 `_features` 처리, `_build_floor()` | 호출 +1 |
| T12 | P2 | (나중) 거칠기 맵을 쓸 때의 채널 묶기 규칙 | 가이드 | — | — |
| T13 | P1 | 이야기 소품 묶음(유골·게시판·버섯·뿌리·사슬·스텐실 상자·깃발·바리케이드 등) | 소품 메시 | `_decorate()`, `_scatter()` | 호출 +8–12, VRAM 0 |
| T14 | P1 | 방마다 테마(ART_DIRECTION 1.2 표)를 생성기에 넣기 | 배치 | `ROOMS` 상수, `_decorate()` | 0 |

---

## 2. 과제 상세

### T01 · 환경 색 조정 (P0, 조명)
- **왜**: 지금 앰비언트 `(0.42, 0.44, 0.60)`은 보랏빛이라 돌이 차갑고 플라스틱처럼 보이고, 보스 염력(보라) 예고와도 가깝다. 배경 `(0.03, 0.03, 0.05)`는 허공을 검게 만든다. **바닥 밝기는 이미 충분하므로 낮추지 않는다.**
- **시작값**(ART_DIRECTION 3.2):
  ```gdscript
  e.background_color = Color(0.08, 0.10, 0.12)
  e.ambient_light_color = Color(0.44, 0.47, 0.52)   # 에너지 0.62 유지 → 밝기는 지금과 같음
  e.fog_light_color = Color(0.12, 0.15, 0.17)
  e.fog_density = 0.018
  moon.light_color = Color(0.79, 0.83, 0.86)        # 천장 균열의 차가운 낮빛
  moon.light_energy = 0.6
  ```
- **검증**: `tests/shot.tscn`으로 찍어 플레이 띠(화면 세로 35–85%) 평균 휘도 0.40–0.50 유지, 거의 검은 픽셀(L<0.08) 비율 확인(T06 뒤 5% 미만 목표).
- **비용**: 0.

### T02 · 판석 바닥 + 거리장·정점 마스크 (P0, 텍스처·셰이더)
- **왜**: `floor_stone`은 크기가 고른 자갈이 빽빽한 crazy paving이라 50° 위에서 보면 화면 전체가 같은 무늬로 반복된다. 던전밥 성 내부(Ref-M05)와 프리렌 왕묘(Ref-F02)의 바닥은 큰 직사각 판석이다.
- **자산**: `research/dungeon/textures/flagstone_albedo.png`, `flagstone_normal.png`(1024², seamless, 평균 sRGB 휘도 0.44, 평균 채도 0.12). 권장 4 m/장(`meters_per_tile = 4.0`).
- **마스크는 무작위 노이즈 대신 공간 정보로**: 바닥 정점 색은 지금 회색 AO만 담는다(`COLOR.rgb` 세 채널이 같은 값). 이것을 나눠 쓴다.
  - `COLOR.r` = AO(지금 값), `COLOR.g` = 흙·잔해(벽까지 거리 0–1.5 m에서 1→0, 노이즈로 가장자리 흔들기), `COLOR.b` = 닳은 길(`route` 선분까지 거리 0–1.2 m에서 1→0).
  - 셰이더: `albedo = mix(flagstone, mud, COLOR.g)`, 닳은 길은 판석을 약간 밝고 매끈하게(`ROUGHNESS −0.15`, 밝기 +6%), 마지막에 `ALBEDO *= COLOR.r`.
  - 4 m 반복을 숨기려고 회전·축척을 바꾼 두 번째 판석 샘플을 저주파 노이즈로 섞는 지금 방식은 유지한다.
- **노멀 맵 유지**(지금 셰이더처럼 두 샘플 혼합).
- **비용**: 지금 바닥은 픽셀당 7샘플(돌 2, 흙 1, 노이즈 2, 노멀 2). 바꾼 뒤 6샘플(판석 2, 흙 1, 노이즈 1, 노멀 2). `floor_stone`을 빼면 VRAM 증감 0, 같이 두면 +2.66 MB(albedo + normal).

### T03 · 소품 색 (P0, 텍스처·셰이더)
- **왜**: 통·상자가 복숭앗빛 장난감처럼 보인다(`current/*.png`). 원인은 두 가지다.
  1. 아틀라스 `palette_dungeon_muted.png`(**1024×1024**)의 나무 칸이 밝은 주황 갈색이다.
  2. `Fx.toonify()`가 입히는 `shaders/toon.gdshader`는 윤곽에 따뜻한 림 발광(`rim_color (1.0, 0.92, 0.8) × rim_amount 0.16`)을 더하고 그늘을 보랏빛(던전 소품은 `shade_tint = Color(0.55, 0.5, 0.7)`)으로 칠한다. 캐릭터에는 맞지만 배경 소품에는 플라스틱 느낌을 준다.
- **방법**:
  - `ploh/tools/mute_palette.py`에 나무 칸 리맵을 추가: 하이라이트 `#6B533E`, 중간 `#483626`, 그림자 `#2A1D14`(채도 25–30%).
  - 배경 소품(`dungeon.gd` `_piece()`, `breakable.gd`)은 `rim_amount = 0`, `shade_tint`를 중립 회청 `Color(0.62, 0.64, 0.70)`으로 넘기거나, 아예 램버트(`StandardMaterial3D`)를 쓴다. 캐릭터는 그대로.
- **비용**: 0(같은 텍스처, 같은 셰이더 또는 더 가벼운 셰이더).

### T04 · 정점 라이트 베이크 + 동적 조명 축소 (P0, 조명·셰이더)
- **왜**: 빛 웅덩이 리듬이 분위기를 만든다. 실제 `OmniLight3D`는 메시당 8개 제한이 있고 픽셀마다 계산되므로 많이 둘 수 없다.
- **방법**(ART_DIRECTION 5.1):
  1. 광원 목록을 먼저 정한다: 횃불(지금 `_decorate()`의 벽 횃불), 모닥불, 마도등, 발광 버섯.
  2. **SDF 격자 단위로 굽는다**: `_sample()`의 격자(0.5 m, `_nx × _nz`)마다 근처 광원(반경 R 안)의 `w = (1 − smoothstep(0, R, d))²`를 더해 두 배열(따뜻한·차가운)에 저장한다. 정점은 이 배열을 이중선형 보간해 읽는다. 정점마다 모든 광원을 도는 것보다 훨씬 싸다(GDScript, 웹).
  3. 바닥 `_build_floor()`와 벽 `_wall_quad()`에서 `st.set_uv2(Vector2(warm, cool))`. 벽은 광원을 향한 면만.
  4. 셰이더: `EMISSION = ALBEDO * (warm_col * UV2.x + cool_col * UV2.y) * bake_gain;` 깜빡임은 `UV2.x` 항에 `TIME` 기반 0.9–1.0 배. 정점 색(`COLOR`)은 AO와 앞쪽 벽 정도에 이미 쓰이므로 건드리지 않는다.
  5. `flicker()` 옆에서 영웅과 가까운 횃불 2–3개만 `light.visible = true`. 나머지는 끈다(지금 `distance_fade` 대신 또는 함께).
- **비용**: 픽셀당 동적 조명 수가 줄어 GPU가 가벼워진다. 정점 속성 vec2 하나 추가. 생성 시간은 격자 1–2만 칸 × 근처 광원 몇 개라 짧다.

### T05 · 벽 2단 재질, 윗선 높낮이, 벽기둥, 아치 문 (P0, 셰이더·배치)
- **왜**: 같은 높이·같은 돌쌓기 띠가 방을 두르면 울타리처럼 보인다.
- **방법**:
  - `wall.gdshader`: 높이 0–2.2 m는 `wall_stone`(성벽), 2.2 m 위는 `research/dungeon/textures/cave_rock_*`(4 m/장). 경계는 높이 + 노이즈(±0.3 m)로 흔들고, 경계 바로 아래 띠를 살짝 어둡게 해서 무너진 단면처럼.
  - `_wall_quad()`: 윗면 높이 `top`에 저주파 노이즈 ±0.4 m. 앞쪽(카메라 쪽) 벽은 지금처럼 1.8 m로 낮춘다.
  - `_decorate()`: 긴 벽에 7–9 m 간격으로 KayKit `pillar` 또는 `column`을 벽기둥으로 반쯤 묻어 세운다(한 번에 그리려면 MultiMesh). 복도와 방이 만나는 곳에 `wall_doorway`를 통과 높이 2.8 m 이상(영웅 2.0 m 기준)이 되도록 키워 세운다.
- **비용**: 벽 픽셀당 샘플 +2(암반 albedo·normal), VRAM +2.66 MB. 벽기둥 MultiMesh 1–2 호출, 아치 문 약 8 호출(그림자 끔).

### T06 · 벽 윗면 둔덕 + 벽 밖 암반면 (P0, 메시·배치)
- **왜**: 벽 윗면(두께 0.8 m, 알베도 ×0.55)과 그 밖의 검보라 허공이 화면 위쪽을 어둡게 만든다.
- **방법**:
  - `_wall_quad()`의 윗면 사각형을 바깥으로 2.0 m 늘리고 바깥 끝을 +0.4–0.6 m 높여 둔덕으로. 재질은 `earth_roots`(3 m/장) + 벽 쪽 가장자리에 `cave_rock` 섞기. 둔덕 가장자리를 따라 `_scatter()`의 잔돌을 몇 개 올린다.
  - 새 `_build_backdrop()`: 던전 전체 아래 큰 평면 하나를 벽 윗면 높이 언저리에 깔고 같은 재질을 언릿으로, 휘도 0.15–0.25로 칠한다. 카메라에서 먼 쪽은 안개가 덮는다. (심연·낭떠러지 백드롭은 "동굴에 삼켜진 성" 개념과 맞지 않아 쓰지 않는다.)
- **비용**: 둔덕은 기존 윗면 메시를 바꾸는 것이라 호출 수 그대로, 정점 수 약 2배. 평면 +1 호출(언릿, 불투명이라 겹침 없음). VRAM `earth_roots` albedo 1.33 MB(노멀 1.33 MB는 선택).

### T07 · 2번 방 야영지 (P1, 소품)
- 삼각대 냄비 모닥불(신규 약 180 tri), 침낭 2개(각 60 tri), 상자 탁자와 랜턴(`box_small` + 신규 랜턴 40 tri), 게시판(T13), 말린 약초 줄(알파 쿼드 1장). 모닥불은 지금 `_flame()` 파티클을 0.5배로 쓰고 김 파티클 1개 추가, 빛은 T04 베이크 + 동적 1개.
- 배치: 벽 쪽 SDF −1.2 ~ −2.4 m, 방 가운데 전투 공간은 비운다(`concept_room2_camp.png`).
- **비용**: 신규 소품을 한 메시로 합치면 +1–2 호출, 아니면 +3–5. 파티클 1개.

### T08 · 바랜 카펫 런너 (P1)
- 전투가 없는 복도(2→3)에만. 경로 `route`를 따라 폭 1.4 m 리본 메시(+0.015 m), 색 `Color(0.36, 0.21, 0.21)` 바랜 와인, 끝단은 정점 알파로 닳게. **전투 방, 특히 보스 방에는 깔지 않는다**(빨강 예고와 충돌).
- **비용**: +1 호출, 약 100 tri. 알파 끝단을 쓰면 반투명 1장(복도가 좁아 겹침 작음).

### T09 · 전투 흔적과 제국 증기관 (P1)
- 떨어진 방패·검: `assets/kaykit/skeletons/weapons/`의 `Skeleton_Shield_Small_A.gltf`, `Skeleton_Blade.gltf`를 눕혀 쓰거나 신규 80 tri. 3번 방 모서리.
- 증기관: 8각 실린더(약 120 tri/구간) + 밸브. 복도 4→5와 5번 방 벽 아래. 흰 증기 퍼프 `CPUParticles3D` 4–6개 입자.
- **비용**: MultiMesh로 +2 호출. 파티클은 화면 안에 2–3개까지.

### T10 · 웅덩이 (P1)
- `tint`를 회녹색 `Color(0.23, 0.28, 0.27)`으로(지금 `(0.32, 0.40, 0.48)`). 청록·시안 금지(소총병 조준선).
- 반짝임은 실제 조명의 스펙큘러에서 나오므로(GL Compatibility에 SSR 없음) `_puddle()` 위치를 횃불 근처(2–5 m)로 끌어온다. 4번 방은 3–4개, 바닥의 1/4 이하(`concept_room4_flooded.png`).
- 모바일 `water_lite.gdshader`는 이미 화면 복사를 쓰지 않는다. 바꿀 것은 색과 위치뿐.
- **비용**: 0(웅덩이 수가 늘면 그만큼 반투명 겹침).

### T11 · 보스 방 원형 단 (P2)
- 단 윗면을 극좌표 UV로 만든 별도 메시 + 방사형 판석 텍스처(512², 신규) 또는 `flagstone`을 극좌표로 샘플. 가운데 제단 석판(신규 60 tri). 프리렌 Ref-F03, `concept_room5_boss.png`.
- **비용**: +1 호출, 512² 텍스처면 약 0.33 MB.

### T12 · 채널 묶기 규칙 (P2, 가이드)
- 지금 바닥·벽 셰이더는 거칠기·AO·금속성 텍스처를 쓰지 않는다(거칠기는 상수). 나중에 거칠기 맵을 쓰게 되면 샘플을 늘리지 말고 albedo 알파(거칠기), normal 알파(AO)에 묶는다. `textures/*_roughness.png`는 그때 쓸 수 있게 만들어 둔 것이다.

### T13 · 이야기 소품 묶음 (P1, 소품)
ART_DIRECTION 6장 표의 크기·화면 크기·배치를 따른다. 모두 KayKit 팔레트 아틀라스를 공유하고, 종류별 MultiMesh로 그린다.

| 소품 | 메시 | 방 |
|---|---|---|
| 앞선 모험가 유골(두개골·갈비뼈·녹슨 투구) | 신규 120 tri. **KayKit 해골 캐릭터는 지금 적 모델이라 쓰지 않는다** | 방마다 0–1 |
| 게시판·제국 포고문 | 신규 40 tri + 종이 쿼드 | 1, 2 |
| 발광 버섯 군락 | 신규 60 tri, `EMISSION` `Color(0.85, 0.91, 0.72)` + T04 차가운 베이크 | 복도 1→2, 4 |
| 늘어진 뿌리 | 신규 80 tri(6각 단면 스트립), 벽 윗선에서 아래로 | 모든 방 3–6가닥 |
| 쇠사슬 권양기 | 신규 60 tri + 사슬 알파 쿼드 | 4 |
| 제국 보급 상자(독수리 스텐실) | `box_large` + 아틀라스 빈칸에 스텐실 1칸 | 1, 2, 5 |
| 바랜 제국 깃발 | `banner_red` 재채색(바랜 남색 `#2E3440`, 놋쇠 독수리 `#8A7A55`) | 0–2 |
| 제국 바리케이드 | 신규 70 tri 또는 `crates_stacked` 조합 | 1 |
| 물고기 건조대·낚싯대 | 신규 60 tri | 4 |
| 삼각대 마도등 | 신규 100 tri, `EMISSION` 따뜻한 흰색 + T04 베이크 | 5, 복도 4→5 |

- **비용**: 합계 약 1–2천 삼각형. 종류별 MultiMesh면 레벨 전체 +8–12 호출(한 화면에는 4–6 종류). VRAM 0.

### T14 · 방 테마를 생성기에 (P1, 배치)
- `ROOMS` 상수에 `"theme"`(outpost, camp, hall, cistern, excavation)을 넣고 `_decorate()`가 테마별 소품 표·웅덩이 수·광원 종류를 고르게 한다(ART_DIRECTION 1.2 표).
- **비용**: 0.

---

## 3. 텍스처 자산

후보는 `research/dungeon/textures/`에 있다(게임 폴더에는 넣지 않았다). 모두 1024², 상하좌우 seamless, 노멀은 OpenGL 규약(초록 = +Y), 거칠기는 밝을수록 거침.

| 파일 | 채널 | 평균 sRGB 휘도 / 채도 | 권장 크기 | 용도 |
|---|---|---|---|---|
| `flagstone_albedo.png` | RGB sRGB | 0.44 / 0.12 | 4 m/장 | 방 바닥(T02) |
| `flagstone_normal.png`, `flagstone_roughness.png` | RGB 선형 / 그레이 | — | 같음 | 노멀은 필수, 거칠기는 선택(T12) |
| `cave_rock_albedo.png` | RGB sRGB | 0.40 / 0.12 | 4 m/장 | 벽 위쪽 암반(T05), 둔덕 가장자리(T06) |
| `cave_rock_normal.png`, `cave_rock_roughness.png` | RGB 선형 / 그레이 | — | 같음 | |
| `earth_roots_albedo.png` | RGB sRGB | 0.30 / 0.30 | 3 m/장 | 벽 윗면 둔덕, 벽 밖 암반면(T06). 전투 바닥이 아니라 채도 규칙(12%) 밖 |
| `earth_roots_normal.png`, `earth_roots_roughness.png` | RGB 선형 / 그레이 | — | 같음 | 노멀은 선택 |

**만든 방법**: gpt-image-2(`images.generate`, 1024×1024, quality high)로 생성 → 2×2 타일로 이음매 확인(세 장 모두 생성본에서 이미 이음매가 보이지 않음) → 주기·매끈 분해로 가장자리 색 차이 보정 → 선형 공간에서 휘도를 목표로 맞추고 채도를 휘도 쪽으로 눌러 목표 채도로 → 노멀은 휘도를 높이로 보고 주기 경계 미분(상위 5% 기울기 ≈ 41°, 흙은 27°. 기존 `game/assets/textures`와 같은 기준), 거칠기는 저주파로 어두운 곳을 매끈하게·줄눈을 거칠게(평균 0.80 / 0.85 / 0.86). 노멀의 이음매는 내부보다 약간 매끈하다(기존 텍스처 README와 같은 현상, 눈에 띄지 않음). 프롬프트 공통 꼬리말은 `game/assets/textures/README.md`의 `COMMON`을 바탕으로 "hand-painted anime film background"를 더했다.

- `flagstone`: "Top-down orthographic view straight down onto the floor of an ancient castle great hall: large dressed rectangular and slightly irregular flagstone slabs of very different sizes …, laid in loose broken courses that wander and stagger so there are no continuous straight lines across the image and no repeating grid … Joints … filled with dark packed earth, grit and crumbled mortar …"
- `cave_rock`: "Front orthographic view, perfectly facing a natural limestone cave wall: rough layered rock with gently undulating horizontal sedimentary strata … faint dripping mineral streaks … a few thin dark root threads in cracks …"
- `earth_roots`: "Top-down orthographic view straight down onto the dark packed earth of a cave floor where soil has spilled over old ruins … with a sparse even network of thin tangled tree roots …"

**더 만들면 좋은 것**(아직 안 만듦): 보스 단의 방사형 판석 512²(T11), 독수리 스텐실 알파 64²(T13).

---

## 4. 확인 방법
- 바꿀 때마다 `tests/shot.tscn`으로 세로 430×932 화면을 찍어 콘셉트 그림과 나란히 본다.
- 숫자 기준: 플레이 띠 평균 휘도 0.40–0.50, 거의 검은 픽셀 5% 미만, 바닥 알베도 평균 채도 12% 이하. 예고 색(빨강·금·시안·주황·보라)이 바닥과 겹쳐 묻히지 않는지 적 예고가 뜬 장면으로 확인한다.
- 저사양 아이폰에서 `?fps`로 60fps 유지를 확인한다. 특히 T05(벽 샘플 증가)와 T13(호출 증가) 뒤.
