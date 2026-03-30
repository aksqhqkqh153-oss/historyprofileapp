# 배포 복구 실행 순서

## 1. 도메인 기준
- 프런트: `https://www.historyprofile.com`
- API: `https://api.historyprofile.com`
- 이미지: `https://img.historyprofile.com`

## 2. Railway 백엔드 복구
1. Railway 프로젝트에서 기존 Removed 서비스는 버리고 새 서비스로 다시 연결합니다.
2. **New Project** 또는 기존 프로젝트에서 **New -> Service -> GitHub Repo** 를 선택합니다.
3. 저장소 `aksqhqkqh153-oss/icjapp` 를 연결합니다.
4. 루트 `Dockerfile` 이 자동 감지되는지 확인합니다.
5. 서비스 Variables 에 `backend/.env.example` 내용을 기준으로 입력합니다.
6. PostgreSQL 서비스를 추가하고 `DATABASE_URL=${{Postgres.DATABASE_URL}}` 를 연결합니다.
7. Settings -> Networking -> **Generate Domain** 으로 Railway 임시 도메인을 만듭니다.
8. 임시 도메인에서 `/api/health` 가 열리면, 그 다음 `api.historyprofile.com` 커스텀 도메인을 연결합니다.
9. 커스텀 도메인 연결 후에도 `https://api.historyprofile.com/api/health` 를 다시 확인합니다.

### Railway 필수 변수
```env
APP_ENV=production
APP_PUBLIC_URL=https://www.historyprofile.com
API_PUBLIC_URL=https://api.historyprofile.com
SITE_DOMAIN=www.historyprofile.com
POLICY_URL=https://www.historyprofile.com/privacy-policy
ACCOUNT_DELETION_URL=https://www.historyprofile.com/account-deletion
ALLOWED_ORIGINS=https://www.historyprofile.com,https://historyprofile.com,https://api.historyprofile.com
DATABASE_URL=${{Postgres.DATABASE_URL}}
SEED_DEMO_DATA=0
EMAIL_DEMO_MODE=0
LOG_LEVEL=INFO
```

## 3. Cloudflare Pages 최신 커밋 미반영 복구
1. Cloudflare Dashboard -> **Workers & Pages** -> 해당 Pages 프로젝트로 이동합니다.
2. **Deployments** 에서 최신 커밋 SHA 가 `df17bc9` 인지 먼저 확인합니다.
3. 최신 커밋이 안 보이면 **Settings -> Builds & deployments** 에서 다음을 다시 확인합니다.
   - Production branch: `main`
   - Root directory: `frontend`
   - Build command: `npm run build`
   - Build output directory: `dist`
4. GitHub 연결 저장소가 `aksqhqkqh153-oss/icjapp` 로 되어 있는지 확인합니다.
5. 설정이 맞는데도 이전 커밋만 보이면 **Retry deployment** 또는 **Create deployment** 로 `main` 최신 커밋을 다시 배포합니다.
6. 배포 성공 후 `www.historyprofile.com` 커스텀 도메인 상태가 Active 인지 확인합니다.

## 4. Cloudflare DNS 권장 연결
- `www` -> Pages 커스텀 도메인
- `api` -> Railway 커스텀 도메인 CNAME
- `img` -> R2 Custom Domain
- Apex(`historyprofile.com`)는 `https://www.historyprofile.com` 으로 301 리다이렉트 권장

## 5. 확인 순서
1. `https://api.historyprofile.com/api/health`
2. `https://www.historyprofile.com/privacy-policy`
3. `https://www.historyprofile.com/account-deletion`
4. `https://www.historyprofile.com` 접속 후 로그인/회원가입
