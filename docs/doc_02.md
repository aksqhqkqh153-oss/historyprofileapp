# Cloudflare Pages 설정 순서

1. `https://dash.cloudflare.com` 로그인
2. **Workers & Pages** 클릭
3. **Create application** 클릭
4. **Pages** 선택
5. **Import an existing Git repository** 선택
6. 저장소 `aksqhqkqh153-oss/icjapp` 선택
7. 아래 값 입력
   - Project name: `icjapp`
   - Production branch: `main`
   - Framework preset: `React (Vite)`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `frontend`
8. Environment variables 추가
   - Variable name: `VITE_API_BASE_URL`
   - Value: `https://api.historyprofile.com`
9. **Save and Deploy** 클릭
10. 배포 성공 후 **Custom domains** 에서 `www.historyprofile.com` 연결
11. 필요하면 루트 도메인 `historyprofile.com` 도 추가하거나 Redirect Rules 로 `www` 로 리다이렉트
