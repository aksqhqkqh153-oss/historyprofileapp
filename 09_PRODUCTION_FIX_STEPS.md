# Production fix steps

## Cloudflare Pages
- VITE_API_BASE_URL 를 `https://api.historyprofile.com` 으로 유지해도 됩니다.
- 단, `api.historyprofile.com` 이 Railway 백엔드 커스텀 도메인으로 실제 연결되어 있어야 합니다.
- 아직 연결되지 않았다면 임시로 `https://historyprofile-app-backend-production-c222.up.railway.app` 로 변경하세요.
- 선택값: `VITE_API_BASE_FALLBACKS=https://historyprofile-app-backend-production-c222.up.railway.app`

## Railway Variables
- `APP_ENV=production`
- `ALLOWED_ORIGINS=https://historyprofile.com,https://www.historyprofile.com,https://ecc8d748.historyprofileapp.pages.dev,https://api.historyprofile.com`
- `SEED_DEMO_DATA=1`
- `DATABASE_URL` 는 Railway Postgres 연결값 유지

## Browser cleanup
브라우저 콘솔에서 아래를 1회 실행하세요.

```js
localStorage.removeItem('historyprofile_successful_api_base');
localStorage.removeItem('icj_token');
localStorage.removeItem('icj_user');
sessionStorage.removeItem('icj_token');
sessionStorage.removeItem('icj_user');
location.reload();
```
