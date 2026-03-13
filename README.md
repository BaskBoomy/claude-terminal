<p align="center">
  <a href="README.en.md">English</a> · <a href="README.md">한국어</a>
</p>

<p align="center">
  <img src="public/icon-192.png" width="80" alt="Claude Web Terminal">
</p>

<h1 align="center">Claude Web Terminal</h1>

<p align="center">
  어디서든 <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>에 접속하세요 — 셀프 호스팅 가능한 모바일 웹 터미널.
</p>

<p align="center">
  <a href="https://github.com/BaskBoomy/claude-terminal/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License"></a>
  <a href="https://github.com/BaskBoomy/claude-terminal/releases"><img src="https://img.shields.io/github/v/release/BaskBoomy/claude-terminal?style=flat-square" alt="Release"></a>
  <img src="https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go 1.22+">
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macOS-lightgrey?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/binary-~8MB-green?style=flat-square" alt="Binary Size">
</p>

<br>

> **이게 뭔가요?** Claude Code를 모바일 친화적인 웹 UI로 감싼 셀프 호스팅 PWA입니다. 라즈베리파이, VPS, 또는 항상 켜져 있는 아무 서버에 설치하면 — 폰, 태블릿, 어떤 브라우저에서든 접속할 수 있습니다. 서버 하나로, 어디서든 코딩.

<br>

<p align="center"><img src="docs/screenshot.png" width="800" alt="Claude Web Terminal 스크린샷"></p>

> **📱 PWA 권장** — 모바일에서 최고의 경험을 위해, 브라우저 메뉴에서 **"홈 화면에 추가"** 를 눌러 PWA로 설치하세요. 네이티브 앱처럼 전체 화면으로 사용할 수 있고, 화면 꺼짐 방지와 백그라운드 알림도 지원됩니다.

## 왜 만들었나

Claude Code는 강력하지만, 로컬 터미널에서만 실행됩니다. 만약:

- 책상을 떠나서도 **폰으로 코딩**하고 싶다면
- 노트북을 열어두지 않고도 **장시간 작업을 모니터링**하고 싶다면
- Claude의 **메모리와 스킬을 시각적으로 관리**하고 싶다면
- **Git 상태와 서버 상태를 한눈에** 확인하고 싶다면

...터미널에 원격으로 접근할 방법이 필요합니다. Claude Web Terminal은 ~8MB 단일 바이너리로, 외부 의존성 없이 이 모든 걸 제공합니다.

## 기능

| 탭 | 설명 |
|-----|-------------|
| **Terminal** | xterm.js 기반 터미널 — 터치 스크롤, 스와이프로 tmux 윈도우 전환, 가상 키 바 |
| **Preview** | 멀티탭 브라우저 — 코드로 만들고 있는 웹앱을 바로 미리보기 |
| **Notes** | 자동 저장 메모 — 메모 내용을 Claude에게 바로 전송 가능 |
| **Brain** | Claude Code의 메모리, 스킬, 에이전트, 규칙, 훅을 탐색하고 편집 |
| **Files** | 서버 파일 시스템 탐색 — 디렉토리 조회, 파일 보기/편집 |
| **Launch** | 자주 쓰는 URL·서비스 북마크 — 한 번 탭으로 바로 접속 |
| **Dash** | Git 상태, Claude API 사용량, CPU/메모리/디스크/온도 한눈에 |

**추가 기능:** 커스텀 명령어 스니펫, 글꼴 크기 조절, 탭 드래그 정렬, 당겨서 새로고침, 복사 모드 (화면 + 스크롤백), 화면 꺼짐 방지, 백그라운드 알림, iOS/Android 홈 화면 앱 설치.

## 빠른 시작

**방법 1 — 한 줄 명령 (Node.js 필요):**

```bash
npx create-claude-terminal
```

대화형 설치 프로그램이 비밀번호, 포트, 도메인을 물어보고 systemd/launchd 서비스까지 자동으로 설정합니다.

**방법 2 — Git clone:**

```bash
git clone https://github.com/BaskBoomy/claude-terminal.git
cd claude-terminal
./install.sh
```

**방법 3 — 수동 설치:**

```bash
# 1. 필수 패키지 설치
sudo apt install tmux    # macOS: brew install tmux

# 2. ttyd 설치
sudo bash scripts/setup-ttyd.sh

# 3. 설정
cp .env.example .env
nano .env                # 최소한 PASSWORD만 설정

# 4. 빌드 & 실행
go build -ldflags="-s -w" -o claude-terminal .
ttyd -p 7681 -W -b /ttyd scripts/ttyd-start.sh &
./claude-terminal
```

`http://<서버-IP>:7680`에 접속해서 로그인하세요.

## 아키텍처

```
 폰 / 태블릿 / 데스크톱
          │
          │  HTTPS (자동 Let's Encrypt) 또는 HTTP
          ▼
 ┌──────────────────────┐
 │   claude-terminal    │  Go 단일 바이너리 (~8MB)
 │                      │
 │  ┌────────────────┐  │
 │  │  정적 파일      │  │  PWA 프론트엔드 (HTML/CSS/JS)
 │  │  API 라우트     │  │  인증, 메모, 브레인, 설정, git, 사용량
 │  │  ttyd 프록시    │  │  WebSocket 터널링 리버스 프록시
 │  └────────────────┘  │
 └──────────┬───────────┘
            │ localhost
            ▼
 ┌──────────────────────┐
 │       ttyd           │  웹 터미널 에뮬레이터
 └──────────┬───────────┘
            │
            ▼
 ┌──────────────────────┐
 │       tmux           │  영속 터미널 세션
 │  ┌────────────────┐  │
 │  │  Claude Code   │  │  AI 코딩 어시스턴트
 │  └────────────────┘  │
 └──────────────────────┘
```

Docker 없이, Nginx 없이, Caddy 없이 — 바이너리 하나 + ttyd + tmux면 끝.

## 설정

모든 설정은 `.env` 파일에서 관리합니다 ([`.env.example`](.env.example) 참고):

| 변수 | 기본값 | 설명 |
|----------|---------|-------------|
| `PASSWORD` | *(필수)* | 로그인 비밀번호 — 첫 실행 시 자동으로 해시 처리 |
| `PORT` | `7680` | 서버 포트 |
| `TTYD_PORT` | `7681` | ttyd 포트 |
| `DOMAIN` | | 도메인 — 설정하면 Let's Encrypt HTTPS 자동 활성화 |
| `CLAUDE_CMD` | `claude` | Claude Code 실행 명령어 |
| `TMUX_SESSION` | `claude` | tmux 세션 이름 |
| `SESSION_MAX_AGE` | `86400` | 로그인 세션 유지 시간 (초, 기본 24시간) |

<details>
<summary>전체 변수 목록</summary>

| 변수 | 기본값 | 설명 |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | 바인드 주소 |
| `TMUX_SOCKET` | *(자동)* | tmux 소켓 경로 |
| `UPLOAD_DIR` | `/tmp/claude-uploads` | 파일 업로드 디렉토리 |
| `NOTIFY_DIR` | `/tmp/claude-notify` | 알림 디렉토리 |
| `RATE_LIMIT_MAX` | `5` | IP당 최대 로그인 실패 횟수 |
| `RATE_LIMIT_WINDOW` | `900` | 로그인 제한 시간 (초, 기본 15분) |

</details>

## HTTPS

**내장 방식 (단일 서비스 환경 추천):**

`.env`에 `DOMAIN=your.domain.com`을 설정하면 자동으로 Let's Encrypt 인증서를 발급하고 갱신합니다.

**리버스 프록시 방식:**

이미 Caddy, Nginx 등을 사용하고 있다면:

```
# Caddyfile 예시
your.domain.com {
    reverse_proxy localhost:7680
}
```

## 보안

- **비밀번호 해싱** — PBKDF2-SHA256, 600,000회 반복
- **세션 쿠키** — `HttpOnly`, `Secure` (HTTPS 시), `SameSite=Strict`
- **요청 제한** — IP당 15분 내 5회 로그인 실패 시 차단
- **경로 탐색 보호** — Brain 파일 접근을 알려진 프로젝트 디렉토리로 제한
- **소스에 인증 정보 없음** — 비밀번호 해시는 `data/`에 저장 (gitignored)

## 프로젝트 구조

```
claude-terminal/
├── main.go              # HTTP 서버, ttyd 리버스 프록시, 자동 HTTPS
├── config.go            # .env 로딩, 비밀번호 해싱
├── auth.go              # 세션, 요청 제한, 미들웨어
├── routes.go            # API 핸들러 (tmux, 메모, 브레인, git, 사용량)
├── brain.go             # Claude Code 메모리/스킬 파일 스캐너
├── public/              # PWA 프론트엔드
│   ├── index.html
│   ├── login.html
│   ├── css/style.css
│   └── js/              # ES 모듈 (app, terminal, preview, notes, brain, dash, ...)
├── scripts/
│   ├── ttyd-start.sh    # tmux 세션 진입점
│   └── setup-ttyd.sh    # ttyd 설치 스크립트
├── npm/                 # npx create-claude-terminal 패키지
├── install.sh           # 원클릭 설치 스크립트
├── .env.example         # 설정 템플릿
└── data/                # 런타임 데이터 — 메모, 설정, 비밀번호 해시 (gitignored)
```

## 요구 사항

| 의존성 | 용도 | 설치 |
|-----------|---------|---------|
| **tmux** | 영속 터미널 세션 | `apt install tmux` / `brew install tmux` |
| **ttyd** | 웹 터미널 에뮬레이터 | `bash scripts/setup-ttyd.sh` (자동 설치) |
| **Claude Code** | AI 코딩 어시스턴트 | [설치 가이드](https://docs.anthropic.com/en/docs/claude-code) |
| **Go 1.22+** | 소스에서 빌드 시 | [golang.org](https://go.dev/dl/) *(미리 빌드된 바이너리 사용 시 불필요)* |

## 기여

기여를 환영합니다! 이슈와 풀 리퀘스트를 자유롭게 열어주세요.

1. 저장소를 Fork합니다
2. 브랜치를 만듭니다 (`git checkout -b feature/amazing-feature`)
3. 변경사항을 커밋합니다
4. 브랜치에 Push합니다 (`git push origin feature/amazing-feature`)
5. Pull Request를 열어주세요

## 라이선스

MIT 라이선스로 배포됩니다. 자세한 내용은 [`LICENSE`](LICENSE)를 참고하세요.

---

<p align="center">
  어디서든 코딩하는 개발자를 위해 만들었습니다.
</p>
