# Session Office

내 PC에서 돌아가는 **Claude Code 세션들을 3D 복셀 사무실로 보여 주는 대시보드**입니다.
세션 하나가 직원 한 명이 되어, 일할 때는 자리에 앉아 타이핑하고, 쉴 때는 탕비실·라운지로 가고, 종료되면 짐을 싸서 퇴근합니다.
캐릭터를 클릭하면 그 세션의 대화 내역을 오른쪽 패널에서 바로 볼 수 있습니다.

외부 의존성이 없습니다. Node.js(v18 이상)만 있으면 됩니다.

![Session Office 전체 화면](docs/media/overview.png)

## 주요 기능

### 세션 = 직원
- **작업 중** 세션은 자기 책상에 앉아 타이핑합니다. 셸 명령이나 백그라운드 작업이 돌고 있으면 노트북 화면에 터미널 출력이 스크롤됩니다.
- **답변 대기** 중인 세션(권한 확인, 질문 등) 머리 위에는 `?`가 빙글빙글 돕니다.
- **휴식 중**(idle) 세션은 탕비실로 가서 커피·간식을 먹거나, 라운지에서 빈백에 앉거나 탁구를 칩니다.
- 사용자(파란 옷의 방문자)는 평소 화이트보드에 무언가를 쓰다가, 세션에 질문이 생기면 해당 책상까지 걸어가 말풍선으로 질문합니다.
- 이름표의 아이콘은 세션이 돌아가는 곳을 나타냅니다. 🐧 Linux/WSL, 🪟 Windows.

### 대화 내역 패널
캐릭터나 직원 목록을 클릭하면 카메라가 그 직원에게 다가가고, 오른쪽 패널에 상태·턴 수·작업 경로·최근 도구와 함께 대화 내역이 열립니다(위 스크린샷 오른쪽).
답변은 마크다운으로 렌더링되고, 도구 호출은 접을 수 있는 묶음으로 정리됩니다. 패널 왼쪽 가장자리를 드래그하면 너비를 조절할 수 있습니다.

### 서브에이전트 = 작은 Clawd
세션이 서브에이전트를 돌리는 동안, 서브에이전트 하나당 작은 복셀 Claude(Clawd) 한 마리가 노트북 주변에 올라앉아 들썩거리며 일합니다. 표정도 수시로 바뀝니다.

| 정지 화면 | 동작 ([원본 영상](docs/media/subagents.mp4)) |
|---|---|
| ![노트북 주변의 서브에이전트들](docs/media/subagents.png) | ![서브에이전트 애니메이션](docs/media/subagents.gif) |

### 원격 PC · 클라우드 세션 (원격 사무실)
Remote Control이 켜진 **다른 PC의 세션**과 **claude.ai/code 클라우드 세션**도 함께 보입니다. 자세한 내용은 아래 [원격 세션](#원격-세션) 항목을 참고하세요.
- 원격 PC마다 본사 뒤쪽에 작은 별관 사무실이 생깁니다. 각 별관은 전선으로 커다란 위성 안테나와 연결되어 있고, 안테나는 좌우로 고개를 까딱거립니다.
- 클라우드 세션은 본사 옆 하늘에 떠 있는 구름 사무실에서 일합니다.
- 원격 세션을 해고하면 아카이브되고, 직원은 자리에서 스르륵 사라집니다.
- `☰ 직원 목록`의 **사무실** 탭에서 로컬 / 원격 PC / 클라우드 사무실 목록을 보고, 클릭하면 그 사무실로 확대됩니다. `⤢ 전체 보기`는 모든 사무실을 한 화면에 담습니다.

### OpenRig 팀 시각화 (선택)
[OpenRig](https://github.com/mvschwarz/openrig)로 여러 에이전트를 한 팀(rig)으로 돌리고 있다면, 같은 팀 세션들이 한 pod에 모여 앉고 누가 누구에게 일을 넘기는지가 책상 사이의 비행 경로로 그려집니다. 자세한 내용은 아래 [OpenRig 연동](#openrig-연동) 항목을 참고하세요.

![OpenRig 위임 관계 표시](docs/media/openrig-links.png)

### 해고(세션 종료)와 복구
`☰ 직원 목록`에서 **해고**를 누르면 확인 후 해당 Claude Code 프로세스를 종료합니다(터미널에서 Ctrl+C를 누른 것과 같습니다).
해고된 직원은 "ㅠㅠ 그동안 감사했습니다…"라고 울면서 사무실을 나갑니다. 그냥 끝난 세션은 울지 않고 퇴근합니다.

![해고된 직원이 울면서 퇴근하는 모습](docs/media/fired.png)

종료된 세션은 **히스토리 (복구)** 탭에 남습니다. `복사` 버튼으로 `cd <작업 경로> && claude --resume <세션 ID>` 명령을 복사해 터미널에 붙여 넣으면 이어서 작업할 수 있습니다.

### 기타
- **낮/밤 테마**: 7시~19시는 낮, 그 외는 밤 테마로 자동 설정되며 상단 버튼으로 바꿀 수 있습니다. 밤에는 펜던트 조명이 켜집니다.
- **⤢ 전체 보기**: 현재 시점을 유지한 채 사무실 전체가 화면에 들어오도록 맞춥니다.
- 카메라 쪽 벽은 심즈처럼 무릎 높이로 낮아져 안이 잘 보입니다. 마우스로 회전·확대할 수 있습니다.

## 실행 방법

### 요구 사항
- Node.js **v18 이상**
- Claude Code를 쓰고 있는 PC (`~/.claude` 폴더를 읽습니다)

### macOS / Linux / WSL
```bash
git clone https://github.com/Achelous1/sessions-office.git
cd sessions-office
./start.sh
```
서버를 띄우고 브라우저를 자동으로 엽니다. 이미 실행 중이면 브라우저만 엽니다. 종료는 `Ctrl+C`입니다.

### Windows
`start.cmd`를 더블클릭합니다.
- WSL에 node가 설치돼 있으면 WSL에서 실행합니다. 이 경우 **WSL 세션과 Windows 세션을 모두** 볼 수 있습니다.
- WSL을 쓰지 않으려면 실행 전에 `set NO_WSL=1`을 지정합니다.

### 직접 실행
```bash
node server         # 또는 npm start
```
그다음 브라우저에서 http://localhost:4545 를 엽니다.

### 환경 변수
| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `4545` | 서버 포트 (`PORT=5000 ./start.sh`) |
| `SHOW_SDK` | (꺼짐) | `1`이면 SDK로 띄운 세션(claude-mem observer 등)도 표시 |
| `NO_WSL` | (꺼짐) | Windows `start.cmd`에서 WSL 대신 Windows node로 실행 |
| `REMOTE` | (켜짐) | `0`이면 원격 PC·클라우드 세션을 불러오지 않음 |
| `MAX_CLOUD_SESSIONS` | `24` | 구름 사무실에 보여 줄 클라우드 세션 수 (최근 생성 순) |

## 원격 세션

Remote Control이 켜진 다른 PC의 세션과 claude.ai/code 클라우드 세션을 보여 줍니다. 따로 설정할 것은 없습니다. 이 PC에서 Claude Code에 로그인되어 있으면 자동으로 불러옵니다.

> ⚠️ **비공식 API를 씁니다.** 세션 목록은 claude.ai 웹과 Remote Control이 쓰는 `api.anthropic.com/v1/code/sessions`에서 가져옵니다. 이 API는 공개 문서가 없어서, Anthropic이 바꾸면 예고 없이 동작하지 않을 수 있습니다. 그래도 로컬 사무실은 영향을 받지 않습니다. 원치 않으면 `REMOTE=0`으로 끄세요.

### 어떤 세션이 어디에 앉나
| 세션 | 표시 조건 | 사무실 |
|---|---|---|
| 다른 PC의 Remote Control 세션 | 아카이브되지 않았고 PC와 연결된 상태 | PC마다 별관 1개 (📡) |
| 클라우드 세션 (claude.ai/code) | 아카이브되지 않은 세션 중 최근 `MAX_CLOUD_SESSIONS`개 | 구름 사무실 1개 (☁️) |
| 이 PC의 세션 | — | 본사 (원격 목록에서는 빠짐) |

- 원격 직원은 항상 자기 자리에 앉아 있습니다. 상태는 작업 중 / 답변 대기(`?`) / 휴식으로 표시되고, 매 턴 끝의 한 줄 요약이 말풍선으로 뜹니다.
- 클릭하면 대화 내역 패널에 최근 대화가 열립니다.
- **해고**하면 세션을 아카이브합니다. 원격 세션은 히스토리 탭에서 다시 열 수 없습니다.

### 알려진 제한: 원격 PC 구분
API의 세션 정보에는 "어느 PC인지"를 알려 주는 필드가 없습니다. 그래서 Remote Control이 자동으로 붙이는 제목(`<호스트명>-<단어>-<단어>`, 예: `mac-mini-local-happy-otter`)에서 호스트명을 읽습니다.
- 첫 메시지 뒤에 제목이 바뀌어도 알아볼 수 있도록, 처음 본 호스트명을 `~/.session-office/remote-hosts.json`에 기억해 둡니다.
- Session Office가 꺼져 있는 동안 시작해서 이미 제목이 바뀐 세션은 PC를 알 수 없어 **원격 PC (미확인)** 사무실로 갑니다.
- 이 PC의 호스트명과 같은 세션은 본사에 이미 있으므로 원격 목록에서 뺍니다.

### 로그인 정보
- `~/.claude/.credentials.json`에서 Claude Code의 로그인 토큰을 읽습니다. macOS는 키체인(`Claude Code-credentials`)에서 읽습니다.
- 조직 정보는 `~/.claude.json`에서 읽습니다.
- 토큰은 `api.anthropic.com`에만 보냅니다. 만료된 토큰은 Claude Code를 한 번 실행하면 갱신됩니다.
- 목록은 5초마다 백그라운드에서 갱신합니다. API가 느리거나 연결되지 않아도 로컬 사무실은 기다리지 않습니다.

## OpenRig 연동

[OpenRig](https://github.com/mvschwarz/openrig)는 Claude Code와 Codex 세션 여러 개를 하나의 팀(**rig**)으로 묶어 실행하는 오픈소스 멀티 에이전트 하네스입니다. 팀 구성을 YAML로 적어 두면 한 번에 띄울 수 있고, 로컬 데몬이 각 세션과 세션 사이의 관계(토폴로지)를 관리합니다.
Session Office는 이 데몬을 읽기만 합니다. OpenRig를 쓰지 않아도 다른 기능은 모두 그대로 동작합니다.

### 켜는 방법
따로 설정할 것은 없습니다. OpenRig 데몬이 실행 중이면 자동으로 연결됩니다.
1. OpenRig로 rig를 띄웁니다(설치와 사용법은 [OpenRig 저장소](https://github.com/mvschwarz/openrig)를 참고하세요).
2. Session Office를 실행합니다. 이미 실행 중이면 10초 안에 반영됩니다.

### 화면에 보이는 것
| 표시 | 의미 |
|---|---|
| 같은 pod에 모여 앉은 직원들 | 같은 rig에 속한 세션. rig 멤버가 먼저, rig 안의 순서대로 자리를 잡습니다 |
| 책상 사이의 흰 곡선 + 날아가는 복셀 비행기 | rig 그래프의 연결(edge). 비행기는 보내는 쪽에서 받는 쪽으로 날아갑니다. 멀리 떨어진 책상일수록 곡선이 높게 뜹니다 |
| 대화 패널 상단의 `rig <이름>/<logicalId>` | 이 세션이 속한 rig와 그 안에서의 역할 ID |
| 휴식 중이어도 자리에 앉아 있음 | rig 멤버는 대기 중에도 탕비실로 가지 않고 자리를 지킵니다 |

### 동작 원리
- 서버가 `~/.openrig/daemon.json`에서 데몬 포트를 읽고, `http://127.0.0.1:<port>/api/rigs`와 `/api/rigs/<id>/graph`를 조회합니다. 결과는 10초 동안 캐시하고, 요청마다 2초 타임아웃이 걸려 있습니다.
- 그래프 노드의 `resumeToken`(= Claude Code 세션 ID)으로 화면의 직원과 짝을 맞춥니다. 토큰이 오래돼 맞지 않으면 세션 이름(`canonicalSessionName`)으로 찾습니다.
- 데몬이 없거나 응답이 없으면 `/api/rigs`는 빈 목록을 돌려주고, 연동 표시만 사라집니다.
- 데몬 접속은 로컬(127.0.0.1)에서만 하며, OpenRig 쪽 상태는 바꾸지 않습니다.

## 동작 방식과 보안

- 서버는 `~/.claude/sessions/*.json`에서 살아 있는 세션을 찾고, `~/.claude/projects/` 아래의 트랜스크립트(`.jsonl`)를 읽어 대화 내역과 상태를 만듭니다. WSL에서는 `/mnt/c/Users/*/.claude`도 함께 읽습니다.
- 세션 파일의 PID와 프로세스 시작 시각을 대조해, PID가 재사용된 오래된 세션은 걸러 냅니다.
- 서버는 **127.0.0.1에만 바인딩**되므로 다른 PC에서는 접속할 수 없습니다. 해고 API는 커스텀 헤더를 요구해, 다른 웹사이트가 브라우저를 통해 세션을 종료할 수 없게 막습니다.
- 외부로는 원격 세션을 불러올 때 `api.anthropic.com`에만 접속합니다(`REMOTE=0`이면 이것도 하지 않음). 그 밖에는 로컬 파일과 (있다면) 로컬 OpenRig 데몬만 읽습니다. three.js와 marked는 `client/vendor/`에 포함되어 있어 CDN 접속도 필요 없습니다.

## 구성

서버와 클라이언트로 나뉘어 있습니다. 서버는 로컬 파일을 읽어 JSON API를 제공하고, 클라이언트는 그 API만 보고 화면을 그립니다.

```
server/                Node.js HTTP 서버 (의존성 없음)
  index.js             진입점: 서버 생성·실행
  config.js            포트, 읽을 ~/.claude 위치(WSL이면 Windows 쪽 포함)
  processes.js         세션 프로세스 생존 확인(PID 재사용 검사)과 종료
  transcripts.js       트랜스크립트(.jsonl) → 대화 내역·셸 활동 파싱 (변경 시에만 다시 읽음)
  sessions.js          살아 있는 세션 목록·요약, 서브에이전트, 히스토리와 복구 명령
  rigs.js              OpenRig 데몬 조회 (선택)
  anthropic-api.js     claude.ai 세션 API 호출 (로그인 토큰 사용)
  remote.js            원격 PC·클라우드 세션 → 세션 요약, PC별 사무실 구분, 아카이브
  static.js            client/ 정적 파일 제공 (폴더 밖 접근 차단)
  routes.js            API 라우팅
client/                브라우저 (빌드 없이 ES 모듈 그대로 사용)
  index.html, styles.css
  js/main.js           진입점: 초기화와 렌더 루프
  js/api.js            서버 API 호출
  js/sync.js           2초마다 폴링해 사무실 상태를 맞춤
  js/core/             three.js 엔진, 복셀 헬퍼, 낮/밤 테마, 화면 오버레이(이름표·말풍선)
  js/world/            배치(layout), 사무실(room), 원격·구름 사무실(offices), 위성 안테나, 길찾기, 책상·직원,
                       방문자, OpenRig 연결선, 노트북 화면
  js/characters/       사람, Clawd(서브에이전트), 물음표, 우는 효과
  js/ui/               대화 패널, 사무실·직원 목록·히스토리, 카메라 이동, 클릭 선택, 마크다운
  vendor/              three.js, OrbitControls, marked v12.0.2
test/                  서버 단위 테스트 (npm test)
start.sh, start.cmd    실행 스크립트
docs/media/            README용 스크린샷·영상
```

### API
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/sessions` | 살아 있는 세션 요약 목록 (로컬 + 원격 PC + 클라우드, 각각 `workspace` 포함) |
| GET | `/api/session/:id` | 세션 하나와 최근 대화 300개 |
| POST | `/api/session/:id/fire` | 로컬 세션 종료 / 원격 세션 아카이브 (`x-office: 1` 헤더 필요) |
| GET | `/api/history` | 지난 세션과 복구 명령 |
| GET | `/api/rigs` | OpenRig 팀과 위임 관계 |
| GET | `/api/remote` | 원격 세션 표시 여부와 마지막 오류 |

### 테스트
```bash
npm test
```

## 라이선스

[The Unlicense](LICENSE) — 퍼블릭 도메인. 상업적 이용을 포함해 누구나 조건 없이 자유롭게 사용·수정·배포할 수 있습니다. 단, `client/vendor/`의 서드파티 파일은 각 파일에 명시된 MIT 라이선스를 따릅니다.
