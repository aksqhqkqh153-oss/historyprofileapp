@echo off
setlocal
cd /d "%~dp0frontend"
call npm install
call npm run build
cd /d "%~dp0"
if exist backend\static rmdir /s /q backend\static
mkdir backend\static
xcopy /e /i /y frontend\dist\* backend\static\ >nul
echo Frontend bundle copied to backend\static
endlocal
