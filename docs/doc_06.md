# Google Play 런칭 순서

1. 웹 배포 완료
   - `https://www.historyprofile.com`
   - `https://api.historyprofile.com/api/health`
   - `https://www.historyprofile.com/privacy-policy`
   - `https://www.historyprofile.com/account-deletion`
2. `mobile_capacitor` 폴더에서 Android 플랫폼 생성
   - `npm install`
   - `npm run init:android`
   - `npm run sync:android`
   - `npm run open:android`
3. Android Studio 에서
   - App name 확인
   - Package name 확인
   - `versionCode`, `versionName` 설정
   - Release signing 설정
   - `Generate Signed Bundle / APK` 로 AAB 생성
4. Play Console 에 등록
   - 앱 설명
   - 스크린샷
   - 개인정보처리방침 URL
   - 계정 삭제 경로 설명
   - 심사용 테스트 계정
5. 내부 테스트 → 닫힌 테스트 → 운영 출시
