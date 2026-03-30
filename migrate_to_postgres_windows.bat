@echo off
setlocal
cd /d "%~dp0"

if "%DATABASE_URL%"=="" (
  echo [ERROR] DATABASE_URL 환경변수가 비어 있습니다.
  echo 먼저 PowerShell 또는 CMD에서 Railway PostgreSQL 연결문자열을 DATABASE_URL로 설정하세요.
  echo 예시:
  echo   set DATABASE_URL=postgresql://USER:PASS@HOST:PORT/railway
  exit /b 1
)

if "%SQLITE_SOURCE_PATH%"=="" (
  set SQLITE_SOURCE_PATH=%CD%\backend\data\app.db
)

echo [INFO] SQLITE_SOURCE_PATH=%SQLITE_SOURCE_PATH%
echo [INFO] PostgreSQL migration starting...

python backend\scripts\migrate_sqlite_to_postgres.py
if errorlevel 1 (
  echo [ERROR] Migration failed.
  exit /b 1
)

echo [OK] Migration completed.
endlocal
