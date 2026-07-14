# sandbox-games

a series of minigames — 정적 파일만으로 동작해서 GitHub Pages로 바로 플레이할 수 있습니다.

## 게임 목록

| 게임 | 설명 | 플레이 |
| --- | --- | --- |
| 🛠 [PURATANK](./puratank/) | three.js로 만든 SD 플라모델 스타일 턴제 탱크 전투 | `/puratank/` |

## GitHub Pages 설정

1. 리포지터리 **Settings → Pages**
2. Source: **Deploy from a branch**, Branch: `main` / `/ (root)` 선택
3. `https://<계정>.github.io/sandbox-games/` 에서 게임 목록 확인

## 로컬 실행

빌드 과정이 없으므로 정적 서버만 있으면 됩니다.

```bash
python3 -m http.server 8000
# http://localhost:8000/puratank/
```

## PURATANK 조작법

- **파란 칸 클릭**: 이동 (한 턴에 3칸)
- **붉은 링의 적 클릭**: 포격 (사거리 4칸, 장애물이 사선을 막음)
- **이동 생략 / 턴 종료** 버튼으로 단계 건너뛰기
- 드래그로 카메라 회전, 휠/핀치로 줌
