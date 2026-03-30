# historyprofile_app 배포 연결 가이드

## Git 로컬 작업 폴더
- `C:\Users\icj24\Downloads\historyprofile_app`

## GitHub 원격 저장소
- `https://github.com/aksqhqkqh153-oss/historyprofile_app`

## 최초 연동
```powershell
cd C:\Users\icj24\Downloads\historyprofile_app
git init
git branch -M main
git remote add origin https://github.com/aksqhqkqh153-oss/historyprofile_app.git
git add .
git commit -m "chore: initial historyprofile_app project"
git push -u origin main
```

## Cloudflare Pages
- Repository: `aksqhqkqh153-oss/historyprofile_app`
- Production branch: `main`
- Framework preset: `Vite`
- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist`

Cloudflare Pages는 Git integration으로 시작하면 push 시 자동 배포되고, Direct Upload 프로젝트는 나중에 Git integration으로 전환할 수 없습니다. citeturn403861search0turn403861search1

## Railway
- GitHub repo 연결 후 backend Dockerfile 기반 배포
- Healthcheck path: `/api/health`
- PostgreSQL 서비스 추가 후 `DATABASE_URL` 연결

Railway는 healthcheck가 설정된 경우 200 응답이 와야 Active 상태가 됩니다. citeturn403861search2turn403861search13
