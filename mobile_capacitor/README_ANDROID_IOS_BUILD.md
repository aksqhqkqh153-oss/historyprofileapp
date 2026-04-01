# Android / iOS 패키징 안내

이 폴더는 기존 `frontend/` + `backend/` 웹앱을 **Capacitor**로 Android/iOS 앱으로 감싸기 위한 래퍼입니다.

## 왜 Flutter가 아니라 Capacitor인가
현재 프로젝트는 이미 **React + FastAPI** 구조로 화면과 기능이 많이 구현되어 있습니다.
이 상태에서 Flutter로 전환하면 사실상 **프런트 전체를 다시 작성**해야 하므로, 현재 기준에서는 Capacitor가 가장 현실적입니다.

## 현재 상태
- 웹 원본(`frontend/`, `backend/`) 유지
- Android/iOS 패키징 래퍼 준비
- 운영 API 주소 분리 준비 (`VITE_API_BASE_URL`)
- 개인정보처리방침 / 계정 삭제 웹 템플릿 추가

## 로컬에서 해야 할 일
### 1) 운영용 API 주소 준비
`frontend/.env.production` 파일을 만들고 실제 HTTPS API 주소를 넣습니다.

예시
```
VITE_API_BASE_URL=https://api.historyprofile.com
```

### 2) Android 플랫폼 추가
```bash
cd mobile_capacitor
npm install
npm run init:android
npm run sync:android
npm run open:android
```

### 3) iOS 플랫폼 추가 (Mac + Xcode 필수)
```bash
cd mobile_capacitor
npm install
npm run init:ios
npm run sync:ios
npm run open:ios
```

## 출시 전 필수 확인
- 백엔드 HTTPS 운영 배포
- 개인정보처리방침 URL 공개
- 계정 삭제 기능 + 웹 삭제 링크
- 심사용 로그인 계정 준비
- Android 서명키 / iOS 서명 설정
- 스토어 설명, 스크린샷, 아이콘, 카테고리 준비

## 권장 실행 순서
1. 웹 프로젝트 수정 완료
2. `frontend/.env.production` 설정
3. `npm run prepare:web`
4. `npm run init:android` / `npm run init:ios`
5. `npm run sync:android` / `npm run sync:ios`
6. Android Studio / Xcode 에서 최종 빌드 및 서명
