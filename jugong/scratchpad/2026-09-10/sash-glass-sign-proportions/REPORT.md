# 섀시 두께·유리·주공 표식 비례 재보정

## 사용자 원문

> 전체적으로 섀시 두께를 현실감있게 줄이고 유리 매터리얼을 넣어서 섀시가 설치된 경우에는 안이 덜 보이도록 해야지.

> 그리고 주공 마크와 동 숫자가 실제와 다르잖아. 폭도 제대로 신경써서 해

이 보고서는 앞선 [사진 5장 관찰·입면 변형 작업](../facade-mark-window-ac-variants/REPORT.md)에 대한 추가 수정이다. 기존 결과의 과도한 표식 폭과 창틀 두께, 유리판 누락을 수정했다.

## 사진 재관찰과 치수 근거

원본은 `/Users/lqez/Desktop/Screenshot 2026-09-10 at {시각}.png`이다. 원본 크기, 해시, 확대 영역 좌표는 [기존 sources.json](../facade-mark-window-ac-variants/photo-details/sources.json)에 있다. 이번 재검토에서는 324동 숫자와 세 사진의 마크를 교차 비교했고 324·303 전체 입면을 원본 해상도로 다시 열었다.

| 사진 | 입면 및 관찰 | 보정에 적용한 내용 |
|---|---|---|
| 17.51.41 | 324동 작은방 옆 빈 측벽의 상층 마크. 인접 작은방 창과 비슷한 폭이며, 백색 집 모양의 넓은 처마·수직 다리·둥근 문이 파란 타원 안에 들어간다. | 기존 13.2 mm 폭은 인접 8.1 mm 창보다 지나치게 컸다. 다른 두 마크 사진과 함께 약 8.6 mm로 줄이고 집 외곽과 문 곡선을 재작성했다. |
| 17.51.37 | 324동 저층 숫자의 가장 선명한 사진. 대략 x1514~1650, y289~367 영역; 인접 작은방 창 폭과 숫자 전체 폭이 비슷하다. 층간 간격은 해당 높이에서 약 210~220 px다. | 숫자는 좁고 긴 굵은 획, 수평 절단 끝, 닫힌 4의 삼각형 속공간이다. 숫자 높이는 14 mm 층간 간격에 대해 약 5.3 mm로 추정, 전체 폭은 8.321 mm로 조정했다. |
| 17.51.23 | 304동 반대쪽 시점의 마크. 카메라 때문에 타원과 지붕이 대각선으로 기울지만, 문 위 둥근 끝과 곧은 양쪽 다리가 확인된다. | 카메라 기울기를 모델에 복사하지 않고 정면 윤곽을 구성했다. 흰 집을 단순 삼각형으로 처리했던 부분을 수정했다. |
| 17.51.18 | 정면 발코니의 가는 금속 테두리와 넓은 유리 면. 창 뒤 내부 구조보다 유리의 청회색 반사와 어두운 면이 먼저 보인다. | 창틀을 줄이고 선택형 섀시에 유리 면을 추가했다. 물성 화면의 정면 불투명도는 78%, 비스듬한 각도에서는 최대 95%다. |
| 17.51.01 | 303동의 작은방 돌출창과 상부 차양. 얇은 중앙 만남대와 유리, 차양 아래 좁은 상부 부재가 확인된다. 상층 마크도 창과 비슷한 폭이다. | 작은방 전면 유리 및 얇은 지지대, 대창 끝면 유리까지 적용했다. 303의 0은 좁고 긴 타원형 속공간으로 다시 그렸다. |

사진의 원근·가림·픽셀 흐림 때문에 위 치수는 실측값이 아니다. 국부 창 폭과 층간 간격으로 추정한 크기이며 약 10~15% 정도의 불확실성이 있다. 8.321 mm 같은 세 자릿수는 코드의 계산 결과일 뿐 사진 측정 정밀도를 뜻하지 않는다. 직접 확인한 숫자 0·2·3·4 외의 입력 숫자는 기존 획을 같은 좁은 비례로 정규화한 추정이다.

## 구현 결과

| 부재 | 수정 전 | 수정 후 |
|---|---|---|
| 외부 섀시 외곽 획 | 0.55~0.75 mm | 0.26~0.32 mm (약 1:200에서 52~64 mm) |
| 창짝 획 | 0.45 mm | 0.16 mm |
| 원래 실내 창틀 | 외곽 0.60 mm | 외곽 0.30 mm, 원래 유리 뒤판 유지 |
| 유리 | 선택형 섀시에 없음 | 대창 4유형·작은방 3유형·대창 끝면의 0.12 mm 판 |
| 마크 | 13.2 × 8.8 mm | 8.6 × 5.8 mm, 넓은 처마와 둥근 문 |
| 324 숫자 | 임의 13 mm 폭으로 가로 압축 | 8.321 × 5.3 mm, 문자별 실제 외곽 폭 + 0.5565 mm 자간 |
| 표식 깊이 | 0.18 mm | 0.025 mm 도장 표현용 relief |

- `src/facade_signs.py`에서 표식 윤곽·폭·높이·자간을 관리한다. Python 완성형/전개형과 HTML 동적 숫자가 같은 데이터를 쓴다. 긴 동 번호는 가로세로를 함께 축소해 글꼴 폭 비례가 찌그러지지 않는다.
- 마크·숫자는 이전에 확보한 빈 측벽 상층/저층 영역에 남고, 축소된 폭은 같은 중심에 정렬한다. 절대 방위나 특정 동의 반대 측면 번호 유무는 여전히 미확정이다.
- 선택 레이어의 삼각형에 프레임과 유리 재료를 따로 기록한다. 프레임을 은회·밝음·어둠으로 바꿔도 유리는 기존 슬롯 2를 유지한다. 네 슬롯 제한은 같다.
- WebGL은 기본형·프레임을 먼저 그리고 선택 섀시의 유리 면만 깊이 순서로 정렬하여 반투명으로 그린다. 같은 슬롯 2를 사용하는 파란 마크와 원래 창 뒤판은 불투명하게 남는다. 유리는 시선 각도에 따라 반사와 불투명도가 달라진다.
- 인쇄 화면, 완성형/전개형 3MF에는 유리 판이 불투명한 슬롯 2 부재로 들어간다. STL은 유리와 창틀을 건물에 융합한다. 유리 상단의 미세 통기 틈으로 밀폐된 내부 빈 공간을 피했다.
- seed·직접 지정·호버·클릭·원래 창과 난간·최초 전체 꺼짐을 유지한다.

## 캡처

- [사진 / 마크 외곽 비교](photo-outline-mark.png), [사진 / 324 외곽 비교](photo-outline-324.png), [계산 치수](measurements.json)
- 동일 뷰포트·카메라·05-B 설정: [수정 전 입면](comparison/before-right.png), [수정 후 입면](comparison/after-right.png)
- [마크 전후](comparison/mark-pair.png), [숫자 전후](comparison/number-pair.png), [섀시 전후](comparison/sash-pair.png), [작은방 전후](comparison/small-pair.png)
- [유리 없음](captures/glass-off.png), [은회 프레임 + 유리](captures/glass-metal.png), [밝은 프레임 + 유리](captures/glass-light.png), [어두운 프레임 + 유리](captures/glass-dark.png)
- [작은방 차양과 유리](captures/small-glass.png), [전체 배치](captures/configured-iso.png), [4색 출력](captures/four-color.png), [접이식 전개](captures/unfolded.png)
- `captures/`에 대창 4종, 작은방 4상태, 실외기 5위치, 모바일과 seed별 캡처를 함께 보존했다.

## 검증

- `--all-variants`: 기존 STL 4종·4색 3MF·세대별 레이어·전개/옥상/하부 키트 재생성. [build.log](build.log)
- 프로젝트 기존 검증과 seed/전개/모든 variant 융합 검사 7개 모두 성공. [checks.json](checks.json)
- 40세대 × 대창/작은방 11종 × 완성/전개 = **880개 유리 레이어**에서 프레임/유리 재료 공존, 4색 제한, 프레임 재색상 후 유리 유지 검사 성공. [glass-layer-validation.json](glass-layer-validation.json)
- 실제 브라우저 seed `0`, `324`, `20260910`의 재적용 일치 및 Python 결과 일치. 모든 seed에서 대창 4종, 작은방 4상태, 실외기 5위치 확인. [browser-validation.json](captures/browser-validation.json)
- 실제 포인터 호버·클릭은 05-B 선택, 작은방 hit 영역도 05-B. 직접 지정 후 seed 77 재배치에도 설정 유지. JSON/URL 왕복, 최초 전체 꺼짐, 동 번호 유효성, 접기/전개 구성 일치, 모바일 가로 넘침 없음.
- 유리 없음 상태의 투명 삼각형 0개, 대창/작은방 선택 시 증가, 프레임 3색에서 유리 수 동일, 여러 회전 각도에서 WebGL 오류 0개. [glass-browser-validation.json](captures/glass-browser-validation.json)
- 실제 브라우저에서 받은 완성/전개 3MF를 닫힌 메시·양의 체적·4색 참조로 검증. [browser-export-validation.json](browser-export-validation.json)
- 기본 STL 소프트웨어 미리보기 재생성, `git diff --check` 성공.

## 변경 파일

기하·표식: `src/jugong_10f_model.py`, `src/facade_variants.py`, `src/facade_signs.py`.

뷰어·패킹: `viewer/viewer_template.html`, `scripts/build_viewer.py`.

검사·비교 도구: `tools/inspect_sign_proportions.py`, `tools/verify_sash_glass.py`, `tools/verify_glass_browser.py`, `tools/capture_facade_comparison.py`, `tools/verify_print_kit.py`.

문서·결과: `AGENTS.md`, `README.md`, `CONTINUE.md`, `SHA256SUMS.txt`, 갱신된 `dist/`, `validation/`, 이 보고서 폴더. `work/configurator`는 규약에 따라 로컬 생성 결과이며 HTML에 내장된다. `.DS_Store`는 포함하지 않는다.

## 커밋·배포

구현·검증 커밋 `61d5ea8d2a5db5d2b0fa52a01c628b61d26bfecb`를 `origin/main`에 force 없이 push했다. Pages가 `2026-09-10T11:15:52Z`에 해당 커밋을 `built`로 보고했으며, 공개 HTML 응답 200·6,684,947 bytes·SHA256 `914f2eef4c28e956cfa9f7793f9396ba3fcf097b49e1d7be138bd8da68226415`가 로컬과 일치했다. [배포 기록](deployment.json)과 [배포 페이지의 유리 검사](deployed-captures/glass-browser-validation.json)를 보존했다.

공개 뷰어: https://lqez.github.io/sandbox-games/jugong/dist/dunchon_jugong_viewer.html

배포 확인 기록만 별도 후속 커밋으로 push한다. 해당 커밋은 모델·뷰어 바이트를 바꾸지 않는다.

## 남은 한계

실측 도면이 없는 표식의 정확한 크기·도장 두께·방위와 사진에 없는 숫자 윤곽은 추정이다. 유리 표현은 경량 WebGL의 반사·알파 합성이며 실내 굴절을 계산하지 않는다. 0.12 mm 유리판은 출력용 연결 면이기도 하므로 실물 유리 두께의 정확한 축척 표현은 아니다. 얇은 창틀·도장 relief의 실제 출력 재현성은 장비와 축척에 따라 달라지며 실물 인쇄 시험은 수행하지 않았다.
