# Cloudflare R2 설정 순서

1. Cloudflare 대시보드에서 **R2** 클릭
2. **Create bucket** 클릭
3. 버킷명 예시: `icj2424app-prod`
4. 버킷 생성 후 **Settings** → **Custom Domains**
5. `img.historyprofile.com` 연결
6. **Manage R2 API tokens** 에서 Access Key 생성
7. Railway Variables 에 아래 값 입력
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET=icj2424app-prod`
   - `R2_PUBLIC_BASE_URL=https://img.historyprofile.com`
8. 업로드 동작 확인
