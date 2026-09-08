# 둔촌주공 10층 타워형 · Codex 이어가기

모델 생성 소스, 기본형과 옵션별 STL 4종, 독립형 3D 뷰어, 미리보기, 원본 참고 사진과 도면을 포함한 프로젝트입니다. 현재 상태는 두 번째 복원 모델이며, 특정 동을 실측한 모델은 아닙니다.

## Codex에서 시작

압축을 푼 `dunchon-jugong` 폴더를 Codex의 작업 폴더로 열고 다음 내용을 입력하세요.

> AGENTS.md와 CONTINUE.md를 읽고 둔촌주공 10층 타워형 모델 작업을 이어가줘. 현재 미리보기와 참고 사진을 먼저 대조하고, 양쪽 출입구·전후와 측면 구분·돌출 발코니·명확한 창틀을 유지해. 외부 섀시와 에어컨 거치대는 기본 숨김인 독립 옵션으로 유지하고, 우선 뷰어 실행과 옵션별 STL 다운로드를 확인해.

[공식 폴더 열기 안내](https://learn.chatgpt.com/docs/quickstart) · [Codex CLI 안내](https://learn.chatgpt.com/docs/codex/cli)

## 바로 확인하기

- `dist/dunchon_jugong_viewer.html`: 회전·확대, 방향 선택, 외부 섀시/거치대 show/hide 및 현재 구성 STL 다운로드. WebGL2와 DecompressionStream을 제공하는 브라우저가 필요합니다. 모델 데이터는 파일 안에 포함되어 있습니다.
- `dist/jugong_10f_preview.png`: 기본형의 전면·후면·양측면 및 입체 미리보기.

| STL | 외부 섀시 | 에어컨 거치대 |
|---|---|---|
| `dist/jugong_10f.stl` | 없음 | 없음 |
| `dist/jugong_10f_sashes.stl` | 있음 | 없음 |
| `dist/jugong_10f_ac_brackets.stl` | 없음 | 있음 |
| `dist/jugong_10f_sashes_ac_brackets.stl` | 있음 | 있음 |

STL은 mm 단위로 불러오세요. 받침 포함 120 × 132 × 174.2mm이며, 기본 축척은 약 1:200입니다. 미세 창틀을 포함하므로 실제 출력 가능성은 출력 방식과 설정으로 별도 확인해야 합니다. 형상 검증은 실제 출력 시험을 의미하지 않습니다.

## 재생성

이 폴더를 현재 디렉터리로 사용합니다. 생성·검증은 Python 3.12에서 실행했습니다.

```sh
python -m venv .venv
```

macOS/Linux는 `source .venv/bin/activate`, Windows PowerShell은 `.venv\Scripts\Activate.ps1`로 가상환경을 활성화한 뒤 실행합니다.

```sh
python -m pip install -r requirements.txt
python src/jugong_10f_model.py --all-variants --output dist/jugong_10f.stl
python scripts/build_viewer.py
python scripts/verify.py
```

미리보기 갱신은 추가 패키지가 필요합니다.

```sh
python -m pip install -r requirements-preview.txt
python scripts/render_preview.py
```

뷰어를 로컬 서버로 열려면:

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

브라우저에서 `http://127.0.0.1:8000/dunchon_jugong_viewer.html`을 엽니다.

`--scale 2`는 모델 좌표를 두 배로 확대해 약 1:100으로 만듭니다. 현재 뷰어와 미리보기의 치수·카메라 설정은 기본 크기를 기준으로 하므로, 축척 변경 시 해당 표시와 화면 범위도 함께 수정해야 합니다.

## 파일 안내

| 경로 | 용도 |
|---|---|
| `AGENTS.md` | 다음 Codex 작업에서도 유지할 사용자 요구사항 |
| `CONTINUE.md` | 수정 경과, 검증 상태, 다음 작업 |
| `src/jugong_10f_model.py` | Manifold 기반 기하 생성·STL 검증 |
| `viewer/viewer_template.html` | WebGL2 뷰어 UI·표시 소스 |
| `scripts/build_viewer.py` | STL 4종을 HTML에 포함 |
| `scripts/render_preview.py` | 실제 STL의 정면·측면 렌더링 |
| `scripts/verify.py` | STL 메시 및 HTML 내장 데이터 검증 |
| `references/` | 사용자 사진, 정림 도면·사진, 출처 기록 |
| `validation/` | 제공 파일의 검증 결과 |
| `work/` | 재생성 시 만들어지는 중간 파일 |

브라우저 상호작용 검사는 이전 환경의 접근 제한으로 미완료입니다. 현재 STL 4종은 닫힌 메시와 단일 연결체 검증을 통과했으며 HTML에 포함된 데이터와 일치합니다.
