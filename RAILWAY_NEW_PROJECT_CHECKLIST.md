# Railway new project checklist (backend only)

## 1. Create a fresh Railway project
1. Open Railway dashboard.
2. Click `New Project`.
3. Click `GitHub Repository`.
4. Select `aksqhqkqh153-oss/historyprofile_app`.
5. Create one backend service only.

## 2. Service settings
Open the backend service `Settings` and set:
- Branch: `main`
- Root Directory: `backend`
- Builder: default Railway builder / Railpack
- Build Command: blank
- Start Command: blank
- Healthcheck Path: `/api/health`

Important: with `Root Directory = backend`, Railway reads `backend/railway.json`, and config defined in code overrides dashboard build/deploy values.

## 3. Variables
Add these service variables:
- `ACCOUNT_DELETION_URL=https://www.historyprofile.com/account-deletion`
- `ALLOWED_ORIGINS=https://historyprofile.com,https://www.historyprofile.com`
- `API_PUBLIC_URL=https://api.historyprofile.com`
- `APP_ENV=production`
- `APP_PUBLIC_URL=https://api.historyprofile.com`
- `DATABASE_URL=postgresql://postgres:xEQOLnRFtETkMKcFyYTSprPbrLuUoIRj@postgres.railway.internal:5432/railway`
- `POLICY_URL=https://www.historyprofile.com/privacy-policy`
- `SITE_DOMAIN=www.historyprofile.com`

## 4. First deployment checks
After the first deployment starts, confirm in the latest deployment details:
- Build command is blank or auto-detected by Railpack
- Start command comes from `backend/railway.json`
- Healthcheck path is `/api/health`

## 5. Backend health URL
Check:
- `https://<railway-domain>/api/health`

Expected response:
- HTTP 200
- JSON payload

## 6. Only after backend health is OK
1. Add a Railway Custom Domain: `api.historyprofile.com`
2. In Cloudflare DNS add `api` CNAME to the Railway target shown by Railway.
3. Update Cloudflare Pages frontend variable:
   - `VITE_API_BASE_URL=https://api.historyprofile.com`
