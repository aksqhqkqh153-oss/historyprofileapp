# GitHub + Cloudflare + Railway 전체 절차

## A. GitHub 새 저장소 만들기
GitHub 사이트에서 다음처럼 입력합니다.

- Repository name: `historyprofileapp`
- Visibility: 원하는 값 선택
- Add README: 체크하지 않음
- Add .gitignore: 체크하지 않음
- Choose a license: 선택하지 않음

생성 후 저장소 주소 예시:

```text
https://github.com/본인계정/historyprofileapp.git
```

## B. 로컬 프로젝트 최초 push
PowerShell:

```powershell
cd C:\Users\최성규\Downloads\historyprofileapp

git init
git branch -M main
git config --global user.name "최성규"
git config --global user.email "본인깃허브이메일@example.com"
git remote add origin https://github.com/본인계정/historyprofileapp.git
git add .
git commit -m "chore: initial historyprofileapp project"
git push -u origin main
```

## C. Cloudflare Pages 연결
Cloudflare Dashboard > Workers & Pages > Create application > Pages > Connect to Git

입력값:
- Repository: `본인계정/historyprofileapp`
- Production branch: `main`
- Framework preset: `Vite`
- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist`

환경변수:
- `VITE_API_BASE_URL` = `https://api.historyprofile.com`
- `VITE_TURNSTILE_SITE_KEY` = 실제 Turnstile 사이트 키

## D. Railway 연결
Railway > New Project > Deploy from GitHub Repo

백엔드 서비스 입력값:
- Source Repo: `본인계정/historyprofileapp`
- Branch: `main`
- Root Directory: `backend`
- Public Networking: 켬
- Target Port: 비워두거나 자동 사용
- Healthcheck Path: `/api/health`

권장 Start Command:
```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## E. Railway Postgres 추가
Railway 프로젝트 안에서 `+ New` > `Database` > `Add PostgreSQL`

생성 후 Postgres 서비스의 연결값 또는 참조 변수를 백엔드 서비스의 `DATABASE_URL`로 넣습니다.

## F. Railway Variables 입력
백엔드 서비스 > Variables 탭 > `RAW Editor` 또는 `New Variable`

`03_RAILWAY_VARIABLES_TEMPLATE.env` 내용을 붙여넣고 실값으로 교체합니다.

## G. 도메인 연결 예시
- 프론트: `https://www.historyprofile.com`
- 백엔드: `https://api.historyprofile.com`

## H. 변경 후 최신화
```powershell
cd C:\Users\최성규\Downloads\historyprofileapp
git add .
git commit -m "feat: update historyprofileapp"
git push origin main
```
