# Railway backend deployment (Root Directory = backend)

This backend is intended to be deployed to Railway without Docker.

## Required Railway service settings
- Source Repo: `aksqhqkqh153-oss/historyprofile_app`
- Branch: `main`
- Root Directory: `backend`
- Builder: default Railway builder (Railpack)
- Build Command: leave blank
- Start Command: leave blank
- Healthcheck Path: `/api/health`

## Required service variables
- `ACCOUNT_DELETION_URL=https://www.historyprofile.com/account-deletion`
- `ALLOWED_ORIGINS=https://historyprofile.com,https://www.historyprofile.com`
- `API_PUBLIC_URL=https://api.historyprofile.com`
- `APP_ENV=production`
- `APP_PUBLIC_URL=https://api.historyprofile.com`
- `DATABASE_URL=postgresql://postgres:xEQOLnRFtETkMKcFyYTSprPbrLuUoIRj@postgres.railway.internal:5432/railway`
- `POLICY_URL=https://www.historyprofile.com/privacy-policy`
- `SITE_DOMAIN=www.historyprofile.com`

## Why this structure is used
Railway config-as-code is defined in `backend/railway.json`.
When the service Root Directory is set to `backend`, Railway reads config from this directory and runs the backend as a standard Python/FastAPI service.
This avoids the Docker runtime start-command conflict that repeatedly forced `uvicorn ... --port $PORT` in exec form.
