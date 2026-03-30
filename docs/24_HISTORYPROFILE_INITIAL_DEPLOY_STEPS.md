# historyprofile_app initial deploy steps

## Frontend target
- Cloudflare Pages project
- Custom domain: https://www.historyprofile.com

## Backend target
- Railway service
- Custom domain: https://api.historyprofile.com

## Cloudflare Pages settings
- Repository: aksqhqkqh153-oss/historyprofile_app
- Production branch: main
- Root directory: frontend
- Build command: npm run build
- Build output directory: dist

## Cloudflare Pages environment variables
- VITE_API_BASE_URL=https://api.historyprofile.com
- VITE_TURNSTILE_SITE_KEY=<real_site_key>

## Railway recommended variables
- APP_ENV=production
- APP_PUBLIC_URL=https://api.historyprofile.com
- API_PUBLIC_URL=https://api.historyprofile.com
- SITE_DOMAIN=www.historyprofile.com
- POLICY_URL=https://www.historyprofile.com/privacy-policy
- ACCOUNT_DELETION_URL=https://www.historyprofile.com/account-deletion
- ALLOWED_ORIGINS=https://historyprofile.com,https://www.historyprofile.com
- DATABASE_URL=<railway_postgres_url>
- TURNSTILE_SITE_KEY=<real_site_key>
- TURNSTILE_SECRET_KEY=<real_secret_key>
- TURNSTILE_ALLOWED_HOSTNAMES=historyprofile.com,www.historyprofile.com,<pages-default-domain>
- TWILIO_ACCOUNT_SID=<real_value>
- TWILIO_AUTH_TOKEN=<real_value>
- TWILIO_VERIFY_SERVICE_SID=<real_value>

## DNS target plan
- Apex: historyprofile.com -> Cloudflare Pages custom domain
- WWW: www.historyprofile.com -> Cloudflare Pages custom domain
- API: api.historyprofile.com -> Railway custom domain

## Manual frontend build
```powershell
cd C:\Users\icj24\Downloads\historyprofile_app\frontend
npm install
npm run build
```
