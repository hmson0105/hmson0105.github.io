# hmson0105.github.io

손혜미(KAIST I&TM 석사과정 / 중소벤처기업진흥공단 리스크준법실)의 연구 포트폴리오.
**순수 정적 HTML — 빌드 도구·프레임워크·패키지 매니저를 쓰지 않는다.**
GitHub Pages 가 파일을 그대로 서빙한다.

---

## 새 컴퓨터에서 시작할 때

저장소를 클론해도 **따라오지 않는 것**이 있다. 아래를 먼저 갖춰야 데이터 수집과
배포가 동작한다.

| 필요한 것 | 위치 | 없으면 |
|---|---|---|
| ECOS / KOSIS API 키 | `~/.config/hmson/keys.env` | 수집 스크립트 전부 실패 |
| GitHub SSH 키 | `~/.ssh/id_ed25519_github` | 푸시 불가 (배포 불가) |
| scikit-learn | `pip3 install scikit-learn` | `crawl_topic.py` 만 실패 |
| 특허 원본 CSV | 저장소 밖 (아래 참조) | patent-atlas 재생성 불가 |

`keys.env` 형식 — 파일 권한은 `chmod 600`:

```
ECOS_API_KEY=...
KOSIS_API_KEY=...
```

수집 스크립트는 이 파일 또는 동명의 환경변수에서 키를 읽는다.
**키를 저장소 안에 두지 않는다.** 공개 저장소라 커밋되는 즉시 노출된다.

---

## 로컬 실행 / 배포

```bash
python3 -m http.server 8139        # http://localhost:8139
```

컴파일도 설치도 없다. 배포는 `main` 에 푸시하면 끝이고, GitHub Pages 반영까지
보통 1~2분 걸린다.

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_github -o IdentitiesOnly=yes" git push origin main
```

`-o IdentitiesOnly=yes` 가 없으면 ssh-agent 가 다른 키를 먼저 제시해
`Permission denied (publickey)` 로 막히는 경우가 있다.

배포 확인은 캐시를 우회해서 본다:

```bash
curl -s "https://hmson0105.github.io/assets/site.css?cb=$RANDOM" | grep "찾을문자열"
```

---

## 라우팅

각 경로는 자기 `index.html` 을 가진 **실제 디렉터리**다. 직접 URL 입력과 새로고침이
모두 실제 파일로 해석된다. 해시 라우팅·클라이언트 라우터·`404.html` 우회 트릭을
쓰지 않는다 — 빌드 없이 GitHub Pages 에서 안정적인 유일한 방식이다.

| URL | 파일 |
|---|---|
| `/` | `index.html` — 커튼 영상 랜딩, 전체화면, 스크롤 없음 |
| `/about/` | `about/index.html` |
| `/research/` | `research/index.html` |
| `/projects/` | `projects/index.html` |
| `/contact/` | `contact/index.html` |

상세 페이지:

```
papers/japan-ev-battery/          dashboards/sme-crisis-index/
patents/ai-power-health-index/    dashboards/patent-atlas/
                                  dashboards/tactile-sensor-ip/
```

---

## 디자인 시스템

`assets/site.css` 하나가 전 페이지를 관장한다. 페이지별 인라인 `<style>` 은
아래 두 곳에만 있고, 둘 다 의도된 예외다.

**타이포 스케일** — 본문 17px / 행간 1.62 가 기준. 대시보드와 포트폴리오가
같은 값을 쓴다.

| 요소 | 크기 |
|---|---|
| 본문 | 17px / 1.62 |
| 페이지 제목 `.page-title` | 31px |
| 리드문 `.page-lede` | 17.5px |
| 소제목 `h2.sub` | 21px |
| 카드 본문 `.proj-desc`, `.focus-item p` | 16px |
| 라벨 `.eyebrow`, `.block-head` | 12px / letter-spacing .14em |

680px 이하에서 한 단계 낮춘 값으로 분기한다.

**색 토큰** — `--paper #F6F6F4` / `--ink #17191B` / `--ink-2 #5C6166` /
`--ink-3 #8A9095` / `--line #E0E1DE`. 폰트는 IBM Plex Sans (`--serif` 는
`--sans` 를 가리키는 별칭이라 세리프가 실제로 쓰이지는 않는다).

**예외 1 — `/research/`**: youngjun.ch 사양을 그대로 따르도록 요청받은
페이지다. 인라인 `<style>` 에서 본문 14.67px / `.rs-name` 29.33px 등을 직접
지정하며 `site.css` 의 스케일을 덮어쓴다. **여기 폰트 크기를 전역 규칙에
맞춰 고치지 말 것.**

**예외 2 — 대시보드**: 각 대시보드는 독립 문서로 자체 스타일을 갖는다.
`sme-crisis-index` 는 배경 `#FBFBFA`, 본문 `#181A1D` 17px/1.62,
컨테이너 1120px.

---

## 데이터 파이프라인

### sme-crisis-index (중소기업 조기경보)

실제 API 수집 결과로만 구성한다. 하드코딩 금지 — 과거에 하드코딩된 값이
실제 수치와 어긋난 적이 있다(2023.12 연체율 0.48 vs 실제 0.60).

실행 순서가 있다. `build_index.py` 는 `collect_ecos.py` 의 산출물을 읽는다.

```bash
cd dashboards/sme-crisis-index
python3 analysis/collect_ecos.py    # ECOS 22종 + KOSIS 2종 → analysis/ecos_result.json
python3 analysis/build_index.py     # 상관분석·종합지수      → data/ecos.json
python3 analysis/collect_region.py  # 시도별 산업·신용       → data/region.json
python3 analysis/build_map.py       # 시도 경계 SVG          → data/kmap.json
python3 analysis/crawl_topic.py     # 뉴스 크롤링 + LDA      → analysis/topic_result.json
```

주의할 점:

- **ECOS 2차원 통계표는 item1 만 지정하면 안 된다.** 은행 종류가 섞여 같은
  월이 여러 번 나온다. item2 까지 지정하고, 중복 시점이 나오면 중단하는
  검사가 `collect_ecos.py` 에 들어 있다.
- **KOSIS 는 4만 셀 제한**이 있다. `DT_1K52F01` 은 거부되어 사업체구분
  차원이 없는 `DT_1K52F08` 로 바꿨다.
- **중소기업 전용 연체율은 전국 단위 표에 없다.** 지역별 표
  `141Y005/R4AB12` 에만 있어서 지도 섹션에서만 쓴다.
- `build_index.py` 는 수준(level)이 아니라 **전년동월대비**로 상관을 잰다.
  둘 다 시간에 따라 흐른다는 이유만으로 상관이 높게 나오는 허위상관을 피하기
  위해서다. 시차는 0~6개월.
- `build_map.py` 는 7.5MB GeoJSON 을 처음 한 번 내려받아
  `analysis/_kmap_src.json` 에 캐시한다(gitignore 됨). 새 컴퓨터에서는
  자동으로 다시 받는다.
- 지도 라벨은 무게중심이 아니라 **자기 폴리곤 안 + 남의 폴리곤 밖**인 지점을
  격자 탐색으로 찾는다. 경기도처럼 서울을 감싸는 도넛 모양에서 중심이 구멍에
  떨어지는 문제 때문이다.

### patent-atlas

`analysis/patent_atlas.py`, `patent_topics.py` 는 **저장소 밖 절대경로**의
CSV 를 읽는다:

```
/Users/home/Desktop/카이스트/2025.하반기/이노베이션 경영/4.특허분석/1.데이터/(최종) patent_raw.csv
```

약 42MB, cp949 인코딩. 다른 컴퓨터에는 없으므로 스크립트가 바로 실패한다.
산출물 `data/patent_atlas.json`, `data/patent_topics.json` 은 커밋되어 있어
**페이지 자체는 정상 동작한다.** 재생성이 필요할 때만 원본을 옮기고 스크립트
상단의 `SRC` 를 고치면 된다.

특허 데이터를 API 로 다시 수집하려는 시도는 이미 한 번 막혔다 — KIPRIS,
WisDomain, WIPS ON 모두 이 사용자가 쓸 수 있는 셀프서비스 API 를 제공하지
않는다. 다시 검토하지 않아도 된다.

---

## 저장소에 넣지 않는 것

`.gitignore` 로 막아둔 것들이다.

- `*.csv` — 수집 원본
- `keys.env`, `.env` — 자격증명
- `참고논문/` — 논문 PDF (재배포 문제)
- `dashboards/*/analysis/_kmap_src.json` — 지도 원본 캐시
- `dashboards/*/analysis/raw/` — 수집 중간 산출물

`KIET/`, `_workspace/` 는 추적한 적 없는 로컬 작업 폴더다.

---

## 작업 관례

**커밋 메시지는 한국어 한 줄 요약**으로 쓴다. 무엇을 왜 바꿨는지가 드러나게
— "문체를 공공기관 보고서체로 전환", "지도에 지역명·위기지수 표기, 여백 제거".

**문체**: 사용자는 공공기관 종사자다. 한글 산출물은 `~했다/봤다` 같은 구어체
대신 객관 서술체를 쓴다. 영문 페이지도 1인칭 서술(`I examine…`)이 아니라
측정된 전문 서술(`The subject of analysis is…`)로 맞춰져 있다.

**검증**: 화면 변경은 브라우저에서 계산된 값으로 확인한다. 스크린샷이 빈
화면으로 나오는 경우가 잦으므로(브라우저 패널이 숨겨져 있을 때)
`getComputedStyle`, `scrollWidth`, `Chart.getChart` 같은 값을 직접 읽는 편이
확실하다. 데스크톱 1280px 과 모바일 375px 양쪽에서 가로 오버플로를 본다.

---

## 알려진 함정

- **`<figure>` 기본 마진** — 브라우저가 `margin: 16px 40px` 을 적용한다.
  그리드 안에서 칸 밖으로 40px 밀려나므로 `margin: 0` 을 명시해야 한다.
- **그리드 자식의 `min-width: auto`** — 모바일에서 그리드가 뷰포트를 뚫고
  나간다. `.chart-grid > *` 등에 `min-width: 0` 이 필요하다.
- **`const` TDZ** — 선언 전에 참조하면 그 시점부터 스크립트 전체가 죽는다.
  차트가 통째로 사라진 적이 있다.
- `assets/kitty.png`, `kitty.svg` 는 리디자인 때 참조가 모두 제거되어
  파일만 남아 있다. README 의 파비콘 설명은 오래된 내용이다.
