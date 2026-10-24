# 효과음(ElevenLabs Sound Effects)

`tools/make_sfx_eleven.py`가 ElevenLabs `POST /v1/sound-generation`으로 만든다. 22050Hz 모노 16bit WAV,
앞뒤 무음 제거, 길이 제한(잘린 끝은 40ms 페이드), 피크 -1 dBFS. 원본 mp3와 변형별 측정값은 `raw/`에 있다(커밋 안 함).
변형이 여럿인 소리는 `<name>_<n>.wav`를 모두 두고 그중 하나를 `<name>.wav`로 복사한다(`--pick name=n`으로 바꿀 수 있다).
`beat_loop.wav`는 `tools/make_music.py`가 만든 것으로 여기와 무관하다.

모든 프롬프트 뒤에 공통 스타일 문구를 붙였다:

> Stylized anime action game sound effect, punchy, clean sharp transient, dry, no reverb tail, no music, no voice, isolated single sound.

## 소리 목록

| 이름 | 쓰임 | 길이 | 변형 | 선택 | 왜 |
|---|---|---|---|---|---|
| `arrow_hit` | (새) 화살이 살/나무에 박히는 소리 | 0.50s | 1: 0.50s, 2: 0.50s | arrow_hit_2 | 2가 피크가 앞(9ms)이고 앞 30ms에 에너지가 몰려 있다 |
| `arrow_shoot` | (새) 활시위 놓는 소리 | 0.60s | 1: 0.40s, 2: 0.60s | arrow_shoot_2 | 2가 시작부터 감쇠하는 트왕(1은 0.08초에 피크가 오는 휘파람에 가깝다) |
| `block` | (새) 검이 방패를 치는 클랭 | 0.60s | 1: 0.60s, 2: 0.60s | block_2 | 2가 짧은 클랭+나무 둔탁음(1은 4kHz 울림이 0.6초 끝까지 간다) |
| `bomb` | (새) 중간 크기 폭발, 만화풍 | 1.20s | 1: 0.68s, 2: 1.20s | bomb_2 | 2는 0.16초에 크랙 뒤 1.2초까지 몸통이 이어진다(1은 0.68초로 짧다). 자동 점수와 반대로 2 |
| `break` | (새) 나무통·상자 파손 | 0.80s | 1: 0.80s, 2: 0.80s | break_2 | 2에 0.26·0.31·0.43초의 파편 소리가 있어 통이 부서지는 느낌. 1은 한 번만 |
| `counter` | 카운터 히트 스팅 | 0.53s | 1: 0.53s, 2: 0.80s | counter_1 | 1이 0.5초 안에 끝나는 짧은 스팅(2는 0.8초를 꽉 채운다) |
| `dodge` | 회피 스텝(옷자락) | 0.50s | 1: 0.50s, 2: 0.50s | dodge_2 | 둘 다 0.15초쯤에 피크가 오는 옷자락 스윗. 2가 더 낮은 대역 |
| `getup` | (새) 일어날 때 옷자락 | 0.55s | 1: 0.55s | - | 변형 하나 |
| `glint` | 박자 신호·패링/막기 불꽃의 '팅' | 0.50s | 1: 0.50s, 2: 0.50s | glint_2 | 2가 꼬리가 깨끗하게 0.3초 안에 끝난다(1은 0.35초쯤 두 번째 울림이 있다). 박자 신호로 반복되니 짧은 쪽 |
| `heavy` | 무거운 충격(피니시·보스 내려찍기·폭탄·기물 파손, 여러 볼륨으로 재사용) | 1.20s | 1: 1.20s, 2: 1.20s | heavy_2 | 2가 피크가 더 빠르고(4ms) 더 낮은 대역(중심 ~950Hz) |
| `hit` | 칼이 살을 베는 타격(영웅↔적) | 0.40s | 1: 0.40s, 2: 0.40s, 3: 0.40s | hit_2 | 2의 트랜지언트가 가장 앞에 있고(19ms) 짧게 끊긴다 |
| `just` | JUST 강화타 | 0.80s | 1: 0.80s, 2: 0.80s | just_2 | 2가 짧고 밝다(1은 0.8초 내내 울린다) |
| `kill` | 처치 확인 | 1.00s | 1: 1.00s, 2: 1.00s | kill_2 | 2가 몸통이 두껍다(RMS -14.7 vs -21dB). 자동 점수는 1을 골랐지만 처치 확인은 묵직한 쪽으로 |
| `knockdown` | (새) 몸이 돌바닥에 쓰러지는 둔탁음 | 0.65s | 1: 0.70s, 2: 0.66s | knockdown_2 | 2가 더 낮은 대역(1.5kHz)의 둔탁음, 자르지 않았다 |
| `parry` | (새) 금속끼리 부딪히는 울림 | 0.80s | 1: 0.80s, 2: 0.80s | parry_2 | 둘 다 비슷한 금속 울림. 2가 트랜지언트가 조금 더 앞 |
| `pickup` | (새) 아이템 획득 차임 | 0.60s | 1: 0.60s, 2: 0.60s | pickup_2 | 2가 피크가 앞(1ms)이고 중심 주파수가 더 높아(6kHz) 더 '칭' 하다 |
| `step` | 돌바닥 발소리(브레이크 슬라이드 포함) | 0.29s | 1: 0.29s, 2: 0.35s, 3: 0.35s | step_1 | 1이 0.29초로 짧고 자르지 않았다. 3이 더 또렷하니(피크 9ms) 조용하다 느껴지면 3으로 |
| `stumble` | (새) 비틀거리는 두 발자국 | 0.60s | 1: 0.60s, 2: 0.42s | stumble_1 | 프롬프트를 '정확히 두 발자국'으로 고쳐 다시 만들었다. 1에 두 덩어리의 봉우리가 보인다, 2는 한 번 |
| `whoosh` | 가벼운 검 휘두름 | 0.30s | 1: 0.19s, 2: 0.24s, 3: 0.30s | whoosh_3 | 1·2는 0.2초의 짧은 스윗, 3은 프롬프트를 고쳐 다시 만든 0.3초짜리 부풀어 오르는 휘두름. 3을 기본으로 |
| `whoosh_heavy` | 무거운 검 휘두름 | 0.50s | 1: 0.50s, 2: 0.50s | whoosh_heavy_2 | 2가 한 번만 휘두른다(1은 0.16초에 두 번째 소리가 겹친다) |

## 프롬프트

요청 길이(API 최소 0.5초)보다 넉넉히 받아 `max`로 잘랐다. 공통 스타일 문구는 생략.

### arrow_hit

요청 0.7s, 최대 0.5s, prompt_influence 0.5

- Arrow impact, sharp thwack piercing into flesh with a wooden shaft vibration, short.

### arrow_shoot

요청 0.8s, 최대 0.6s, prompt_influence 0.5

- Bow string release and arrow launch, sharp twang snap followed by a quick arrow whoosh, short.

### block

요청 0.9s, 최대 0.6s, prompt_influence 0.5

- Sword blade striking a wooden shield with a metal rim, hard clang with a wooden thunk, short.

### bomb

요청 1.5s, 최대 1.2s, prompt_influence 0.45

- Mid-size cartoonish explosion, punchy boom with a sharp crack and a quick low rumble, stylized video game bomb blast.

### break

요청 1.0s, 최대 0.8s, prompt_influence 0.5

- Wooden barrel smashing apart, splintering crack of wood planks breaking and clattering, short.

### counter

요청 1.0s, 최대 0.8s, prompt_influence 0.45

- Counter attack impact sting, hard metallic crack with a quick low punch, dramatic short hit accent.

### dodge

요청 0.8s, 최대 0.5s, prompt_influence 0.5

- Quick sidestep dodge, fast cloth rustle swish with a soft air whoosh, light and agile.

### getup

요청 0.8s, 최대 0.6s, prompt_influence 0.5

- Person getting up from the ground, quick cloth and leather rustle with a small scuff, short.

### glint

요청 0.7s, 최대 0.5s, prompt_influence 0.55

- Short bright metallic ting, a single high crisp blade glint chime, sparkle of steel, very short.

### heavy

요청 1.5s, 최대 1.2s, prompt_influence 0.5

- Massive heavy impact, deep crushing boom with a hard punchy thud, finisher blow, cinematic bass hit, short decay.

### hit

요청 0.7s, 최대 0.4s, prompt_influence 0.5

- Sword blade slashing flesh, wet sharp cut impact, short meaty slice with a crisp snap.

### just

요청 1.0s, 최대 0.8s, prompt_influence 0.45

- Perfectly timed empowered sword strike, sharp metallic slash with a bright shimmering accent and a punchy impact, triumphant.

### kill

요청 1.2s, 최대 1.0s, prompt_influence 0.45

- Kill confirm, decisive final blade strike with a deep thud and a short bright metallic resonance, satisfying finishing blow.

### knockdown

요청 0.9s, 최대 0.7s, prompt_influence 0.5

- Body falling and hitting a stone floor, heavy dull thud with a slight armor rattle, short.

### parry

요청 1.0s, 최대 0.8s, prompt_influence 0.5

- Sword parry, sharp metal on metal clash with a bright ringing steel ring that fades quickly.

### pickup

요청 0.8s, 최대 0.6s, prompt_influence 0.5

- Item pickup chime, short bright two-note sparkle, cheerful magical collect sound, game pickup.

### step

요청 0.6s, 최대 0.35s, prompt_influence 0.5

- Single footstep of a leather boot on a stone floor, short dry scuff, quiet.

### stumble

요청 0.8s, 최대 0.6s, prompt_influence 0.55

- Exactly two distinct footsteps in quick succession, scuff then scuff, a person stumbling off balance on a stone floor, leather boots scraping, the second step about 150 milliseconds after the first.

### whoosh

요청 0.8s, 최대 0.5s, prompt_influence 0.5

- (변형 1, 2) Fast light sword swing cutting through air, short airy swish, sharp blade whoosh.
- (변형 3) Fast light sword swing cutting through air, a single smooth airy swish that swells and fades over about a third of a second, breathy blade whoosh, no click, no impact.

### whoosh_heavy

요청 1.0s, 최대 0.5s, prompt_influence 0.45

- Heavy two-handed greatsword swing through air, deep low wide whoosh with weight, slower swing.
