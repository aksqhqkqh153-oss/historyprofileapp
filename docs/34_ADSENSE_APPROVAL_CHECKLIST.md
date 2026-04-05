# 34. AdSense 승인 체크리스트

## 1) 사이트 추가 시 입력 도메인
- AdSense 사이트 추가 입력값은 `www.historyprofile.com` 이 아니라 `historyprofile.com` 루트 도메인으로 입력합니다.
- `www` 서브도메인은 최상위 도메인이 아니므로 경고가 뜰 수 있습니다.

## 2) 현재 프로젝트에 반영한 승인 보강 항목
- `/about` 서비스 소개 정적 페이지 추가
- `/terms` 이용약관 정적 페이지 추가
- `/contact` 문의하기 정적 페이지 추가
- `/privacy-policy` 개인정보처리방침 유지
- `/account-deletion` 계정 삭제 안내 유지
- `/ads.txt` 템플릿 추가
- `sitemap.xml` 공개 페이지 확장
- `robots.txt` 유지

## 3) 배포 후 확인할 URL
- https://www.historyprofile.com/about
- https://www.historyprofile.com/terms
- https://www.historyprofile.com/contact
- https://www.historyprofile.com/privacy-policy
- https://www.historyprofile.com/account-deletion
- https://www.historyprofile.com/ads.txt
- https://www.historyprofile.com/sitemap.xml

## 4) 반드시 직접 교체할 항목
- `frontend/public/ads.txt` 의 `pub-xxxxxxxxxxxxxxxx` 를 실제 Publisher ID로 변경
- Cloudflare Pages에 `historyprofile.com` 과 `www.historyprofile.com` 둘 다 연결되어 있는지 확인
- apex 도메인(`historyprofile.com`)이 `www.historyprofile.com` 으로 리다이렉트되도록 Cloudflare에서 설정

## 5) 운영 정책 고정
- 무료 기능: DM(채팅), 질문(하기/받기)
- 유료 기능: 출금 수수료 5%
- 미사용 기능: 키워드 입찰, DM 과금
- 광고 수익: AdSense / 영상 광고 중심
