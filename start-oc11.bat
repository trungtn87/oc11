@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Chua cai dat OC11. Dang mo setup-windows.bat...
  call setup-windows.bat
  if errorlevel 1 exit /b 1
)

if not exist "manager-web\node_modules" (
  echo Chua co frontend dependencies. Dang mo setup-windows.bat...
  call setup-windows.bat
  if errorlevel 1 exit /b 1
)

echo Dang khoi dong OC11 Backend...
start "OC11 Backend" cmd /k "cd /d %~dp0 && .venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"

echo Dang khoi dong OC11 Manager Web...
start "OC11 Manager Web" cmd /k "cd /d %~dp0manager-web && npm run dev -- --host 127.0.0.1"

echo Cho he thong khoi dong...
timeout /t 4 /nobreak >nul
start "" http://127.0.0.1:5173

echo OC11 da duoc mo tren trinh duyet.
exit /b 0
