# 던전 텍스처

로드 오브 히어로즈풍 셀 셰이딩 캐릭터와 어울리도록 만든 스타일라이즈드 리얼 던전 텍스처입니다. 모든 파일은 상하좌우로 이어 붙여도 이음매가 보이지 않습니다(seamless). Godot 4.4 GL Compatibility 렌더러에서 쓰는 것을 전제로 했습니다.

## 파일

| 파일 | 크기 | 형식 | 용도 |
|---|---|---|---|
| `floor_stone_albedo.png` | 1024×1024 | RGB, sRGB | 크고 작은 판석과 자갈이 불규칙하게 섞인 바닥 |
| `floor_stone_normal.png` | 1024×1024 | RGB, 선형 | 바닥 돌 노멀 맵 |
| `floor_stone_roughness.png` | 1024×1024 | 그레이스케일 | 바닥 돌 거칠기 |
| `floor_mud_albedo.png` | 1024×1024 | RGB, sRGB | 젖은 흙과 잔자갈. 돌 사이와 웅덩이 주변 블렌딩용 |
| `floor_mud_normal.png` | 1024×1024 | RGB, 선형 | 흙 노멀 맵 |
| `floor_mud_roughness.png` | 1024×1024 | 그레이스케일 | 흙 거칠기 |
| `wall_stone_albedo.png` | 1024×1024 | RGB, sRGB | 크기가 제각각인 거친 석재 벽(같은 벽돌이 격자로 반복되지 않음) |
| `wall_stone_normal.png` | 1024×1024 | RGB, 선형 | 벽 노멀 맵 |
| `wall_stone_roughness.png` | 1024×1024 | 그레이스케일 | 벽 거칠기. 세로로 흐른 습기 자국이 더 매끈함 |
| `moss_grime.png` | 512×512 | RGBA | 이끼와 때 오버레이. 알파 약 43%(평균), 알파 0.5 초과 면적 32% |
| `water_normal.png` | 512×512 | RGB, 선형 | 웅덩이 잔물결 노멀 맵 |
| `flagstone_albedo.png`, `flagstone_normal.png` | 1024×1024 | RGB | 큰 직사각 판석 바닥(4m/장). 지금 바닥에 쓴다 |
| `cave_rock_albedo.png`, `cave_rock_normal.png` | 1024×1024 | RGB | 벽 위쪽 동굴 암반, 벽 너머 가장자리 |
| `earth_roots_albedo.png` | 1024×1024 | RGB | 벽 위와 벽 너머의 흙과 뿌리 |

판석·암반·흙 텍스처는 던전 아트 디렉션 작업에서 만들었습니다. 만든 방법과 프롬프트는 `../../../research/dungeon/TASKS.md` 3장에 있습니다.

- 노멀 맵은 OpenGL 규약(초록 = +Y)입니다. Godot가 기대하는 방식이라 뒤집지 않아도 됩니다.
- 거칠기 맵에서 밝을수록 거칩니다. 젖은 부분은 어둡게(더 매끈하게) 만들었습니다. 평균값은 바닥 돌 0.75, 흙 0.66, 벽 0.82입니다.
- 알베도 평균 밝기(sRGB 휘도)는 바닥 돌 0.38, 흙 0.33, 벽 0.40입니다. 어두운 던전에서도 지나치게 검게 보이지 않도록 중간 명도로 맞췄습니다.

## 권장 UV 스케일

월드 좌표 기준 텍스처 한 장이 덮는 크기입니다. 캐릭터 키를 1.8m 안팎으로 놓고 정했습니다.

| 텍스처 | 1장당 크기 | 근거 |
|---|---|---|
| `floor_stone_*` | 3m | 큰 판석 약 45cm, 작은 자갈 7–15cm |
| `floor_mud_*` | 2m | 잔자갈이 1–3cm로 보임 |
| `wall_stone_*` | 4m | 큰 블록 약 40cm, 작은 끼움돌 약 15cm. 벽 높이 4m면 세로로 1장 |
| `moss_grime.png` | 2m | 이끼 덩어리 수십 cm |
| `water_normal.png` | 1.5m | 두 번 샘플링하는 것을 전제로 함(아래 참고) |

StandardMaterial3D에서 `uv1_triplanar = true`, `uv1_world_triplanar = true`로 두면 텍스처가 `1 / uv1_scale`미터마다 반복됩니다. 예를 들어 바닥 돌은 `uv1_scale = Vector3(1, 1, 1) / 3.0`입니다.

## 사용 팁

- **타일 경계 숨기기**: 바닥 돌과 흙을 월드 좌표 기반 저주파 노이즈(또는 버텍스 컬러)로 섞으면 3m 반복이 잘 드러나지 않습니다. 흙은 일부러 균일하게 만들어 어디에 섞어도 튀지 않습니다.
- **웅덩이**: 웅덩이 마스크 안에서 알베도를 흙 쪽으로 섞고 0.5–0.6배로 어둡게 한 뒤 roughness를 0.05–0.1로 낮춥니다. `water_normal.png`를 서로 다른 방향으로 흐르게 두 번 샘플링합니다(예: 스케일 1배와 0.7배, 초속 0.02–0.05m). GL Compatibility에는 SSR(화면 공간 반사)이 없으므로 횃불 빛 반사는 OmniLight의 스페큘러 하이라이트로 표현됩니다. 웅덩이 근처에 횃불을 두면 반짝임이 잘 보입니다.
- **이끼와 때**: `moss_grime.png`를 벽 아래쪽과 바닥 가장자리에 높이 그라디언트나 버텍스 컬러를 곱한 알파로 덧씌웁니다. 투명한 부분에도 어두운 때 색이 들어 있어 알파 경계에 검은 테두리가 생기지 않습니다.
- **가져오기 설정**: Godot는 노멀 슬롯에 들어간 텍스처를 노멀 맵으로 자동 인식합니다. 웹 빌드 용량을 줄이려면 가져오기 모드를 VRAM Compressed로 두고 밉맵을 켭니다. 원본 PNG 합계는 약 15MB지만, 실제 빌드에는 압축된 결과가 들어갑니다.

## 만든 방법

### 1. gpt-image-2 생성

OpenAI Python SDK로 `model="gpt-image-2"`, `size="1024x1024"`, `quality="high"`를 지정했습니다. 공통 꼬리말(`COMMON`)은 다음과 같습니다.

```text
Seamless tileable texture that wraps perfectly on all four edges, no border, no frame. Stylized-realistic dark fantasy game environment texture (PBR albedo / base color map), painterly-realistic like a high-end anime action RPG dungeon. Perfectly flat, even, shadowless diffuse lighting: no directional light, no cast shadows, no specular highlights, no vignette, no perspective, no focal point, uniform detail density across the whole image. Medium values, not too dark.
```

**floor_stone** (두 번째 생성본 사용. 꼬리말이 프롬프트 안에 직접 들어 있음)

```text
Top-down orthographic view straight down onto an ancient castle dungeon floor: a random, organic mix of large flat irregular flagstones (some broken into pieces) and smaller worn cobblestones of many different sizes and polygonal shapes, laid in a non-grid crazy-paving pattern with no straight rows, no square tiles and no repeated stone shapes. Stones are smooth and worn by centuries of footsteps, slightly chipped edges, fine hairline cracks, muted warm grey, slate blue-grey and faint ochre-brown tones with gentle per-stone variation. Narrow joints of dark packed dirt, crumbling mortar and grime between stones. Uniform even appearance across the whole image: no isolated dark stains, no spots, no blotches, no puddles, no moss. Seamless tileable texture that wraps perfectly on all four edges, no border, no frame. Stylized-realistic dark fantasy game environment texture (PBR albedo / base color map), painterly-realistic like a high-end anime action RPG dungeon. Perfectly flat, even, shadowless diffuse lighting: no directional light, no cast shadows, no specular highlights, no vignette, no perspective, no focal point. Medium values, not too dark.
```

첫 생성본은 비슷한 크기의 자갈만 빽빽했고, 군데군데 있는 검은 얼룩이 2×2로 이어 붙이면 같은 자리에 반복돼 보여서 버렸습니다.

**floor_mud** (뒤에 `COMMON`을 붙임)

```text
Top-down orthographic view straight down onto damp packed dungeon earth: fine brown-grey silt and mud with scattered small pebbles, grit and tiny stone chips, subtle footprint-free smooth wet sheen variation, a few darker moist patches, faint fine cracks. No puddles, no large rocks, no objects, no plants. Fine, even, homogeneous detail suitable to blend under stone floors.
```

**wall_stone** (뒤에 `COMMON`을 붙임)

```text
Front orthographic view, perfectly facing a rough medieval castle dungeon wall built of irregular rough-cut stone blocks of varied sizes and proportions in random rubble / uncoursed ashlar masonry, with occasional small filler stones, not a uniform brick grid, no repeating identical blocks. Chipped and weathered block edges, deep recessed mortar joints with crumbling lime mortar, faint soot and moisture streaks, muted cool grey and warm brown-grey stone with subtle variation. No doors, no windows, no torches, no floor, no ceiling.
```

**moss_grime** (색 텍스처만 생성. 알파는 아래 후처리에서 만듦)

```text
Top-down orthographic view of a surface completely covered, edge to edge, by a dense continuous mat of damp dungeon moss: short clumpy dark green and olive moss cushions mixed with black-green algae slime, wet brown dirt, grime and tiny lichen specks. Fine, even, homogeneous clump detail with no bare stone, no gaps, no large shapes, no focal point. Seamless tileable texture that wraps perfectly on all four edges, no border, no frame. Stylized-realistic dark fantasy game texture (PBR albedo), perfectly flat even shadowless diffuse lighting, no directional light, no highlights, no vignette, no perspective. Medium values, not too dark.
```

gpt-image-2는 `background="transparent"`를 지원하지 않습니다(`Transparent background is not supported for this model.`). 투명 배경을 요청한 첫 시도에서는 체커보드 무늬가 그림에 그대로 그려졌고, 이끼 점이 고르게 흩어진 모양이라 반복이 눈에 띄었습니다. 그래서 빈틈없는 이끼 텍스처를 생성하고 알파는 절차적으로 만들었습니다.

### 2. 후처리 (Python, numpy + OpenCV + Pillow)

1. **이음매 보정**: 주기·매끈 분해(periodic + smooth decomposition, Moisan 2011)를 FFT 포아송 풀이로 적용했습니다. 이음매를 사이에 둔 값 차이는 가장자리 2px 평균끼리 비교하고, 이음매 방향으로 σ=48px 저역 통과한 뒤 보정했습니다. 따라서 색과 밝기 차이만 고치고 픽셀 단위 질감은 건드리지 않습니다. gpt-image 출력에는 짝수·홀수 행이 번갈아 밝아지는 희미한 무늬가 있는데, 1px 차이로 비교하면 이 무늬를 이음매로 오인해 가장자리 띠 전체가 밝아지거나 어두워졌습니다.
2. **큰 얼룩 평탄화**: 휘도를 주기 경계 가우시안(바닥 돌·벽 σ=102px, 흙 σ=64px)으로 흐린 값으로 나눠, 큰 밝기 변화가 반복 무늬로 읽히지 않게 했습니다(강도 0.6–0.85).
3. **밝기**: 평균 휘도가 목표(0.33–0.40)보다 낮을 때만 감마로 살짝 올렸습니다(벽 감마 0.95).
4. **노멀 맵**: 높이 = 휘도(σ=1px 흐림 60–80% + 넓은 흐림 20–40%)로 두고, wrap 패딩한 Sobel로 기울기를 구했습니다. 상위 5% 기울기가 tan 0.85–0.9(약 40°)가 되도록 세기를 맞췄고, 흙은 0.5로 약하게 했습니다.
5. **거칠기 맵**: 기본값(0.72–0.86)에서 저주파로 어두운 영역(젖은 곳)을 최대 0.25–0.4 낮추고, 줄눈처럼 움푹한 곳은 0.08 올렸습니다. 벽의 젖은 영역은 세로로 긴 가우시안(σ 40×12px)으로 구해 흘러내린 습기 자국처럼 보이게 했습니다.
6. **moss_grime 알파**: FFT 대역 제한 노이즈(주기성이 보장됨)에 이끼 색 텍스처의 덩어리 디테일을 더해 덮임 정도를 만들었습니다. 이끼는 smoothstep으로 불투명하게, 그 바깥은 최대 알파 0.45의 어두운 때 테두리로 처리했습니다.
7. **water_normal**: gpt-image를 쓰지 않고 numpy로 만들었습니다. 파수 7, 17, 34(사이클/장)에 봉우리가 있는 가우시안 스펙트럼을 k로 나눈 무작위 위상 노이즈를 합쳐, 기울기 스펙트럼이 부드러운 봉우리가 되게 했습니다. 방향성은 약하게 넣었습니다. 기울기는 FFT 미분으로 구해 완전히 주기적이며, 상위 5% 기울기는 약 18°입니다.
8. **축소**: 512 결과물은 wrap 패딩 후 INTER_AREA로 줄여 주기성을 유지했습니다.

### 3. 검증

- 모든 결과물을 2×2로 이어 붙여 눈으로 확인했고, 이음매나 같은 자리에 반복되는 눈에 띄는 얼룩은 보이지 않았습니다.
- 수치 확인: 이음매(마지막 열→첫 열, 마지막 행→첫 행)의 평균 인접 픽셀 차이를 내부 경계 평균과 비교했습니다. 바닥과 벽의 알베도·거칠기는 0.91–1.06배, `moss_grime.png`는 색 1.10–1.21배·알파 0.88–1.22배로, 모두 내부 경계들의 최솟값과 최댓값 사이에 있습니다.
- 노멀 맵(gpt-image 기반 3종)은 이음매 경계에서 0.72–0.84배로, 내부 경계보다 조금 매끈합니다. 생성 원본의 가장자리 1px가 약간 흐리기 때문입니다. 2배로 확대해 봐도 선은 보이지 않았습니다.
