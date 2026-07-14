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

- **파란 칸 클릭**: 이동 — 지형(풀·흙·모래·진흙·강 도하)과 경사, 궤도 선회 비용에 따라 이동 범위가 달라짐
- **적/수목/건물/지면 클릭**: 포격 — 사거리 + 포신 부앙각(-14°~+20°) + 능선/건물 차폐 + 수목 엄폐를 반영한 명중률 표시
- **차체 레벨 = 장갑(피해 감소), 조종 레벨 = 회피(명중률 감소)**
- 수목·농가·대전차 장애물·모래주머니 등 WW 프랍은 전부 파괴 가능, 포격 지점엔 크레이터가 생겨 지형이 낮아짐
- 드래그로 카메라 회전, 휠/핀치 줌, 우클릭 드래그로 이동
- `?seed=1234` 로 맵 시드 고정 가능
