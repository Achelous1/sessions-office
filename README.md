# sessions-office

로컬에서 실행 중인 Claude Code 세션을 3D 복셀 오피스로 보여 주는 대시보드입니다. 외부 의존성 없이 Node.js(v18 이상)만 있으면 됩니다.

## 실행

```bash
./start.sh            # macOS / Linux / WSL
PORT=5000 ./start.sh  # 포트 변경
```

Windows에서는 `start.cmd`를 더블클릭합니다(WSL에 node가 있으면 WSL에서 실행, `NO_WSL=1`로 Windows 전용 실행).

직접 실행: `node server.js` 후 http://localhost:4545 접속.

## 구성

- `server.js` — `~/.claude`의 세션·트랜스크립트를 읽는 HTTP 서버 (127.0.0.1에만 바인딩)
- `index.html` — three.js 기반 화면
- `vendor/` — three.js, OrbitControls, marked(v12.0.2) 번들 사본

환경 변수: `PORT`(기본 4545), `SHOW_SDK=1`(SDK 세션 표시)
