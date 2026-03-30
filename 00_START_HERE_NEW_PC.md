# historyprofileapp 새 PC 시작 가이드

이 프로젝트는 새 PC에서 아래 기준으로 시작합니다.

- 작업 폴더: `C:\Users\최성규\Downloads\historyprofileapp`
- GitHub 새 저장소 이름 권장: `historyprofileapp`
- Cloudflare Pages 연결 대상: `frontend`
- Railway 연결 대상: `backend`

## 1. 작업 폴더 만들기
```powershell
cd C:\Users\최성규\Downloads
mkdir historyprofileapp
cd .\historyprofileapp
```

## 2. 이 ZIP 압축 풀기
이 ZIP을 풀면 바로 `historyprofileapp` 프로젝트 파일이 나오도록 구성되어 있습니다.
압축을 다음 위치에 풉니다.

- 대상: `C:\Users\최성규\Downloads`

그 결과 최종 경로는 다음처럼 되어야 합니다.

```text
C:\Users\최성규\Downloads\historyprofileapp
  backend
  frontend
  docs
  Dockerfile
```

## 3. 기존 다른 폴더에서 이 프로젝트를 덮어씌우는 명령어
원본이 `C:\Users\최성규\Downloads\source_project` 에 있다고 가정하면:

```powershell
robocopy "C:\Users\최성규\Downloads\source_project" "C:\Users\최성규\Downloads\historyprofileapp" /E /R:1 /W:1 /XD node_modules .git dist build .venv __pycache__
```

## 4. Git 최초 업로드
아래 파일을 그대로 따라가면 됩니다.
- `01_GITHUB_FIRST_PUSH_COMMANDS.txt`
- `04_GITHUB_CLOUDFLARE_RAILWAY_FULL_FLOW.md`
