# 숨고 인증세션 저장 설명서

## 목적
숨고 로그인 세션을 Playwright storage_state JSON으로 생성한 뒤, 앱의 `결산자료 > 설정 > 숨고 인증세션` 화면에 붙여 넣어 서버에 저장합니다.

## 경로
- 프로젝트 루트: `C:\Users\icj24\Downloads\icjapp`
- 스크립트: `backend\scripts\soomgo_capture_auth_state.py`
- 생성 파일 기본 경로: `backend\playwright\.auth\soomgo-state.json`
- 앱 화면 경로: `결산자료 > 설정 > 숨고 인증세션`

## 준비물
- 숨고 로그인 가능한 계정
- backend 가상환경(.venv)
- `backend/requirements.txt` 설치
- Playwright Chromium 설치

## 터미널 명령어
```powershell
cd C:\Users\icj24\Downloads\icjapp
.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
.\backend\.venv\Scripts\python.exe -m playwright install chromium
.\backend\.venv\Scripts\python.exe .\backend\scripts\soomgo_capture_auth_state.py
```

## 진행 절차
1. 프로젝트 루트로 이동합니다.
2. requirements 와 playwright chromium 설치를 확인합니다.
3. 스크립트를 실행해 브라우저를 엽니다.
4. 숨고에 로그인합니다.
5. 추가 인증이 있으면 직접 완료합니다.
6. JSON 파일이 생성되면 파일 내용을 전체 복사합니다.
7. 앱에서 `결산자료 > 설정 > 숨고 인증세션`으로 이동합니다.
8. JSON 내용을 붙여 넣습니다.
9. 필요하면 같은 화면에서 아이디/비밀번호도 저장합니다.
10. 마지막에 `숨고 인증세션 저장` 버튼을 누릅니다.

## 버튼을 눌러야 하는 타이밍
로그인이 끝나고 JSON 파일이 실제로 생성된 뒤입니다. JSON 생성 전에는 저장 버튼을 누르면 안 됩니다.
