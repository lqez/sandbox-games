# 둔촌주공 10층 타워형 · 세대 구성기

재개발 이전 둔촌주공 10층 타워형의 두 번째 복원 모델과, 동 번호·40세대별 후대 부착물을 조정하는 독립형 3D 뷰어입니다. 특정 동을 실측한 모델은 아니며 두 번째 모델의 정확도에 대한 사용자 최종 승인도 아직 없습니다.

## 바로 확인하기

`dist/dunchon_jugong_viewer.html`을 WebGL2와 `DecompressionStream`을 지원하는 브라우저에서 엽니다. CDN이나 외부 렌더링 라이브러리 없이 메시가 HTML에 내장되어 있습니다.

- 사진에서 직접 확인한 타워형 후보 `302`, `324`, `420`동을 선택하거나 숫자와 내부 하이픈으로 직접 입력할 수 있습니다.
- 동 번호는 화면 제목, 모델 옥상 코어의 돌출 명판, URL, JSON, 3MF 파일명과 메타데이터에 반영됩니다. 직접 입력은 NFKC 정규화 뒤 최대 8자와 `숫자[-숫자]`만 허용합니다.
- 외부 섀시는 `없음 / 부분(거실만) / 전체`, 에어컨은 `없음 / 거치대만 / 실외기 포함` 중 세대마다 독립 선택합니다. 처음에는 40세대 모두 `없음`입니다.
- 전체 켜기·끄기, 층별·라인별 일괄 적용, 개별 상태표와 선택 집계를 제공합니다.
- 드래그·휠·두 손가락뿐 아니라 방향키와 `+`/`-`로 모델을 조작할 수 있습니다.
- 현재 구성은 3MF로 받고 JSON 또는 URL로 다시 열 수 있습니다.

기본형에는 원래의 실내 창문·문·발코니 난간이 항상 남습니다. 청록색은 선택한 외부 섀시, 갈색은 거치대·실외기, 녹색은 동 명판입니다.

## 세대 키와 근거 수준

정림건축 25T형 층 평면은 층당 4세대임을 보여 주지만 동별 실제 호수표는 찾지 못했습니다. 그래서 영구 키 `01-A`~`10-D`와 화면의 추정 호수를 분리합니다.

| 라인 | 현재 모델의 외벽 위치 | 평형 | 화면 호수 |
|---|---|---|---|
| A | 전면 좌측, -Y | 25T-B | `층×100+1` 추정 |
| B | 전면 우측, -Y | 25T-B | `층×100+2` 추정 |
| C | 후면부 좌측 외벽, -X | 25T-A | `층×100+3` 추정 |
| D | 후면부 우측 외벽, +X | 25T-A | `층×100+4` 추정 |

이 매핑은 공개 평면과 현재 복원 메시의 외벽 방향을 연결한 모델 스키마입니다. 실제 101~104호 체계를 확정했다는 뜻이 아닙니다.

## 출력과 기존 STL 호환 정책

세대 조합은 미리 STL로 전부 만들지 않습니다. 생성기는 기본 메시 1개와 세대별 `부분 섀시 / 전체 추가분 / 거치대 / 실외기` 레이어를 만들고, 뷰어는 선택 레이어만 표시합니다.

- 현재 구성 다운로드는 기본형·동 명판·선택 레이어만 객체로 담은 3MF 조립체입니다. 구성 JSON 전체도 3MF 메타데이터에 들어갑니다.
- 같은 JSON을 Python 생성기의 `--configuration`에 전달하면 선택 부재를 불리언 융합한 단일 연결 STL을 만들 수 있습니다.
- 기존 네 STL 파일명은 유지합니다. 세대 기능 이후의 의미는 아래와 같이 전 세대 일괄 프리셋으로 고정합니다.

| STL | 40세대 외부 섀시 | 40세대 에어컨 상태 |
|---|---|---|
| `dist/jugong_10f.stl` | 없음 | 없음 |
| `dist/jugong_10f_sashes.stl` | 전체 | 없음 |
| `dist/jugong_10f_ac_brackets.stl` | 없음 | 빈 거치대 |
| `dist/jugong_10f_sashes_ac_brackets.stl` | 전체 | 빈 거치대 |

STL은 mm 단위로 불러오세요. 받침 포함 120 × 132 × 174.2mm이며 기본 축척은 약 1:200입니다. 형상 검증은 실제 출력 시험을 대신하지 않습니다.

## 구성 형식

JSON의 `schemaVersion`은 1이고, `households`에는 정확히 40개 키가 들어갑니다.

```json
{
  "schemaVersion": 1,
  "dong": "324",
  "households": {
    "01-A": {"sash": "none", "ac": "none"},
    "01-B": {"sash": "partial", "ac": "bracket"}
  }
}
```

위 예시는 구조만 축약한 것으로 실제 가져오기 파일에는 `01-A`~`10-D`가 모두 필요합니다. URL은 같은 순서의 40자리 상태 문자열을 사용하고 잘못된 길이·값은 무시합니다.

## 재생성·검증

Python 3.12 이상 가상환경에서 다음을 실행합니다.

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python src/jugong_10f_model.py --all-variants --output dist/jugong_10f.stl
python scripts/build_viewer.py
python scripts/verify.py
python tools/verify_configurator.py
```

40세대가 모두 들어 있는 구성 JSON에서 연결 STL을 만들려면:

```sh
python src/jugong_10f_model.py --configuration my-config.json --output my-config.stl
```

미리보기 갱신에는 `requirements-preview.txt`를 추가 설치하고 `python scripts/render_preview.py`를 실행합니다. 로컬 뷰어는 `python -m http.server 8000 --bind 127.0.0.1 --directory dist`로 엽니다.

## 파일 안내

| 경로 | 용도 |
|---|---|
| `src/jugong_10f_model.py` | 기본형, 40세대 레이어, JSON 구성 융합 생성 |
| `viewer/viewer_template.html` | WebGL2 뷰어·세대 표·URL/JSON/3MF 처리 |
| `scripts/build_viewer.py` | 160개 주소 레이어를 HTML에 압축 내장 |
| `scripts/verify.py` | 기존 STL과 내장 데이터 검증 |
| `tools/verify_configurator.py` | 세대 수·외벽 매핑·대표 연결 조합 검증 |
| `docs/HISTORY.md` | 시설물·동 번호의 조사 근거와 불확실성 |
| `scratchpad/2026-09-08/unit-configurator/REPORT.md` | 브라우저·모바일·다운로드 검증과 캡처 |
