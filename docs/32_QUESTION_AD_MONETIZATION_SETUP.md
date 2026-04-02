# 질문 화면 광고 수익화 설정

## 추천 방식
- 기본 추천: Google AdSense 반응형 디스플레이 광고
- 추가 고수익 전략: 특정 업종 스폰서를 직접 판매하는 direct 모드

## 프론트 환경변수
```env
VITE_QUESTION_PROFILE_AD_MODE=adsense
VITE_ADSENSE_CLIENT=ca-pub-xxxxxxxxxxxxxxxx
VITE_ADSENSE_SLOT_QUESTION_PROFILE=1234567890
```

직접 판매형 광고를 쓰려면:
```env
VITE_QUESTION_PROFILE_AD_MODE=direct
VITE_DIRECT_AD_LABEL=추천 광고
VITE_DIRECT_AD_TITLE=브랜드 제휴 광고를 연결해 보세요
VITE_DIRECT_AD_DESC=이 영역에 고정 스폰서 설명을 넣습니다.
VITE_DIRECT_AD_CTA=광고 문의
VITE_DIRECT_AD_LINK=https://your-domain.com/ads
VITE_DIRECT_AD_IMAGE=https://your-domain.com/ad-banner.png
```

## Cloudflare Pages Variables 예시
- `VITE_QUESTION_PROFILE_AD_MODE`
- `VITE_ADSENSE_CLIENT`
- `VITE_ADSENSE_SLOT_QUESTION_PROFILE`

## 적용 순서
1. AdSense 승인 후 사이트용 코드에서 publisher id를 확인합니다.
2. 질문 화면 전용 광고 단위를 만들고 slot id를 발급받습니다.
3. Cloudflare Pages > Settings > Variables에 값을 등록합니다.
4. 프론트 재배포 후 공개 질문 화면에서 광고가 노출되는지 확인합니다.
5. 개발/테스트에서는 실제 광고 클릭 테스트를 하지 않습니다.

## 운영 메모
- 공개 질문/답변처럼 UGC가 포함된 화면은 신고/차단/검수 정책을 유지하는 편이 안전합니다.
- 직접 스폰서를 붙일 수 있으면 `direct` 모드가 더 높은 단가를 만들 가능성이 큽니다.
