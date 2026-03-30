# Security Fix and Next Steps

## What changed
- `/api/health` no longer exposes the raw `DATABASE_URL`.
- The endpoint now returns a safe value for `db_label` (`postgresql` or `sqlite`).

## Why this matters
A raw database URL exposes:
- database username
- database password
- internal host details

## Immediate action after deploy
1. Push this code to GitHub.
2. Wait for Railway to redeploy.
3. Open `https://api.historyprofile.com/api/health`.
4. Confirm `db_label` is only `postgresql`.

## Important: rotate the Postgres password
Because the full database URL was exposed earlier, rotate the database credentials in Railway after this deploy.

## Data migration
If your SQLite data matters, run:
- `backend/scripts/migrate_sqlite_to_postgres.py`

## Frontend
Set Cloudflare Pages env var:
- `VITE_API_BASE_URL=https://api.historyprofile.com`

## Storage
If you need uploads in production, configure Cloudflare R2.
