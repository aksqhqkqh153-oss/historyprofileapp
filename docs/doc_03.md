# Railway 설정 순서

1. `https://railway.app` 로그인
2. **New Project** 클릭
3. **Deploy from GitHub repo** 선택
4. 저장소 `aksqhqkqh153-oss/icjapp` 선택
5. 루트 `Dockerfile` 기준으로 배포 진행
6. 프로젝트 안에서 **New** → **PostgreSQL** 추가
7. 백엔드 서비스 **Settings** → **Variables** 에 아래 값 입력
   - `APP_ENV=production`
   - `APP_PUBLIC_URL=https://www.historyprofile.com`
   - `API_PUBLIC_URL=https://api.historyprofile.com`
   - `SITE_DOMAIN=www.historyprofile.com`
   - `POLICY_URL=https://www.historyprofile.com/privacy-policy`
   - `ACCOUNT_DELETION_URL=https://www.historyprofile.com/account-deletion`
   - `ALLOWED_ORIGINS=https://www.historyprofile.com,https://historyprofile.com,https://api.historyprofile.com`
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `SEED_DEMO_DATA=0`
   - `EMAIL_DEMO_MODE=0`
   - `LOG_LEVEL=INFO`
8. **Settings** → **Networking** → **Generate Domain** 실행
9. **Custom Domain** 에서 `api.historyprofile.com` 연결
10. 배포 후 `https://api.historyprofile.com/api/health` 확인
