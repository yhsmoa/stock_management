@echo off
chcp 65001 > nul
echo Starting development server...

REM Start Vite dev server in background
start /B cmd /c "npx vite --port 5173"

REM Wait for server to start
timeout /t 3 /nobreak > nul

REM Run Electron with dev server URL
set VITE_DEV_SERVER_URL=http://localhost:5173
npx electron .