# Cloudflare DNS 입력값

## Pages 연결 후
- `www` 는 Pages Custom Domains 에서 연결하면 자동 생성되거나 안내에 따라 생성

## Railway 연결 후
- Type: `CNAME`
- Name: `api`
- Target: Railway 가 보여주는 `xxxxx.up.railway.app`
- Proxy status: `Proxied`

## R2 연결 후
- `img.historyprofile.com` 은 R2 Custom Domains 에서 연결

## 루트 도메인
- `historyprofile.com` 을 Pages 에 직접 연결하거나
- Cloudflare Redirect Rules 로 `https://www.historyprofile.com` 으로 301 리다이렉트
