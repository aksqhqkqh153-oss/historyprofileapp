# 결산자료 > 플랫폼 발송 건수 자동연동

## 개요
- 평일(월~금) 09:00~18:00 사이에 30~60분 랜덤 간격으로 숨고 데이터를 갱신합니다.
- 18:00에는 마지막 1회 최종 갱신을 시도합니다.
- 결산자료 화면 우측 상단의 **데이터 연동** 버튼으로 즉시 1회 수동 갱신할 수 있습니다.

## 비밀정보 저장
- `backend/.secrets/settlement.local.env` 에 숨고 계정 정보가 저장됩니다.
- 루트 `.gitignore` 에서 해당 경로와 Playwright 인증 상태 파일을 제외 처리했습니다.
- 실제 실행 전에 `backend/.env` 에서 아래처럼 secrets 파일을 직접 불러오거나, 해당 값을 시스템 환경변수로 등록하세요.

PowerShell 예시:
```powershell
Get-Content .\backend\.secrets\settlement.local.env | ForEach-Object {
  if ($_ -match '=') {
    $name, $value = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}
```

## Playwright 설치
공식 Playwright 권장 방식에 맞춰 브라우저 바이너리는 별도로 설치하고, 인증 상태 파일은 로컬 파일 시스템에 두고 Git 제외 처리하도록 구성했습니다.

Windows:
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m playwright install chromium
```

## 주의
- 숨고 로그인 시 추가 인증, 캡차, 로그인 UI 변경이 발생하면 자동 수집이 실패할 수 있습니다.
- 첫 실행은 `SETTLEMENT_PLAYWRIGHT_HEADLESS=0` 으로 두고 눈으로 로그인 동작을 확인하는 편이 안전합니다.
- 이 구현은 현재 **숨고**만 실제 자동 수집하며, `오늘`, `공홈`은 추후 같은 구조로 확장 가능하도록 기본 자리를 만들어 두었습니다.
