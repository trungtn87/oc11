@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   OC11 - Cai dat moi truong Windows
echo ==========================================
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua tim thay Python.
  echo Hay cai Python 3.12+ tu python.org va chon Add Python to PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua tim thay Node.js / npm.
  echo Hay cai Node.js 22+ tu nodejs.org.
  pause
  exit /b 1
)

if not exist ".venv" (
  echo [1/3] Tao Python virtual environment...
  py -m venv .venv
)

echo [2/3] Cai backend dependencies...
call .venv\Scripts\python.exe -m pip install --upgrade pip
call .venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if errorlevel 1 goto :error

echo [3/3] Cai manager web dependencies...
pushd manager-web
call npm install
if errorlevel 1 (
  popd
  goto :error
)
popd

echo.
echo ==========================================
echo   Cai dat xong.
echo   Lan sau chi can chay start-oc11.bat
echo ==========================================
pause
exit /b 0

:error
echo.
echo [LOI] Cai dat that bai. Xem thong bao phia tren.
pause
exit /b 1
