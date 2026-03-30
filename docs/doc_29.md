# Git / Cloudflare Pages / Railway 배포 가이드

## 1. Git 로컬 폴더 덮어쓰기
로컬 Git 폴더 경로: `C:\Users\icj24\Downloads\historyprofile_app`

```powershell
$zip = "C:\Users\icj24\Downloads\historyprofile_app_deploy_ready_20260328.zip"
$temp = "C:\Users\icj24\Downloads\historyprofile_app_temp"
$dst = "C:\Users\icj24\Downloads\historyprofile_app"
if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
New-Item -ItemType Directory -Path $temp | Out-Null
Expand-Archive -Path $zip -DestinationPath $temp -Force
Copy-Item -Path "$temp\*" -Destination $dst -Recurse -Force
```

## 2. Git 최초 연동 / main 푸시
원격 저장소: `https://github.com/aksqhqkqh153-oss/historyprofile_app`

```powershell
cd C:\Users\icj24\Downloads\historyprofile_app
if (!(Test-Path .git)) { git init }
git branch -M main
git remote remove origin 2>$null
git remote add origin https://github.com/aksqhqkqh153-oss/historyprofile_app.git
git add .
git commit -m "chore: initial deployment-ready historyprofile_app project"
git push -u origin main
```

## 3. 이후 Git 최신화 명령어
```powershell
cd C:\Users\icj24\Downloads\historyprofile_app
git status
git add .
git commit -m "feat: update historyprofile_app"
git push origin main
```

## 4. Cloudflare Pages Git 연동 권장 설정
- Repository: `aksqhqkqh153-oss/historyprofile_app`
- Production branch: `main`
- Framework preset: `Vite`
- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist`

### Cloudflare Pages 환경변수
- `VITE_API_BASE_URL=https://api.<your-domain>`
- `VITE_TURNSTILE_SITE_KEY=<your-turnstile-site-key>`

## 5. Cloudflare Direct Upload용 빌드 준비
```powershell
cd C:\Users\icj24\Downloads\historyprofile_app\frontend
npm install
npm run build
```
업로드 폴더:
`C:\Users\icj24\Downloads\historyprofile_app\frontend\dist`

## 6. Railway 백엔드 연동 권장 설정
- Source Repo: GitHub `aksqhqkqh153-oss/historyprofile_app`
- Deploy from: Dockerfile
- Healthcheck path: `/api/health`
- Service root: repository root

### Railway 필수 Variables
- `APP_ENV=production`
- `APP_PUBLIC_URL=https://api.<your-domain>`
- `API_PUBLIC_URL=https://api.<your-domain>`
- `SITE_DOMAIN=<your-domain>`
- `DATABASE_URL=<railway-postgres-url or external postgres>`
- `ALLOWED_ORIGINS=https://<your-domain>,https://www.<your-domain>`
- `TURNSTILE_SITE_KEY=<your-turnstile-site-key>`
- `TURNSTILE_SECRET_KEY=<your-turnstile-secret-key>`
- `TURNSTILE_ALLOWED_HOSTNAMES=<your-domain>,www.<your-domain>,<pages-domain>`
- `TWILIO_ACCOUNT_SID=<twilio-account-sid>`
- `TWILIO_AUTH_TOKEN=<twilio-auth-token>`
- `TWILIO_VERIFY_SERVICE_SID=<twilio-verify-service-sid>`

## 7. 배포 전 체크
- 프론트 로컬 빌드 성공 여부
- Railway `/api/health` 200 응답 확인
- Cloudflare Pages에서 `frontend` 루트 설정 여부 확인
- Twilio / Turnstile 실키는 저장소가 아니라 플랫폼 Variables에만 저장
- `frontend/dist`, `frontend/node_modules`는 Git 추적 제외 유지

## 8. 권장 다음 단계
1. Railway PostgreSQL 연결
2. Cloudflare Pages 커스텀 도메인 연결
3. Railway API 커스텀 도메인 연결
4. Turnstile 실키 주입 후 회원가입/로그인 검증
5. Twilio Verify 실발송 테스트
6. Cloudflare R2 연결
