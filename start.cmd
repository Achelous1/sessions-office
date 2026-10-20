@echo off
rem Session Office: start the server (if not already running) and open it in the browser.
rem Usage: double-click start.cmd   (set PORT=5000 before running to change the port)
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if "%PORT%"=="" set PORT=4545
set URL=http://localhost:%PORT%

rem Prefer WSL when it has node: from there the server sees WSL *and* Windows sessions.
rem set NO_WSL=1 to force the Windows-only server.
if defined NO_WSL goto windows
where wsl >nul 2>&1 || goto windows
wsl.exe -e bash -ic "command -v node" >nul 2>&1 || goto windows
for /f "usebackq delims=" %%p in (`wsl.exe -e wslpath -a "%~dp0."`) do set "WSLDIR=%%p"
echo WSL에서 실행합니다 ^(WSL + Windows 세션^)
wsl.exe -e bash -ic "cd '%WSLDIR%' && PORT=%PORT% bash ./start.sh"
exit /b %errorlevel%

:windows
where node >nul 2>&1 || (
  echo node가 필요합니다 ^(v18 이상^). https://nodejs.org 에서 설치해 주세요.
  pause
  exit /b 1
)

curl -s -o nul "%URL%/api/sessions" && (
  echo 이미 실행 중입니다: %URL%
  start "" "%URL%"
  exit /b 0
)

rem open the browser once the server answers, while node runs in this window
start "" /b powershell -NoProfile -Command "for ($i=0; $i -lt 40; $i++) { try { Invoke-WebRequest -UseBasicParsing '%URL%/api/sessions' | Out-Null; break } catch { Start-Sleep -Milliseconds 250 } }; Start-Process '%URL%'"
echo Session Office: %URL%  (종료: Ctrl+C 또는 창 닫기)
node server.js
