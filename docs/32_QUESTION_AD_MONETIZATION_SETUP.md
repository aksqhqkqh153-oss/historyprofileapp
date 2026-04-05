# 광고 수익화 설정

## 적용 범위
- 질문 프로필 상단 광고
- 질문 피드 인라인 광고
- 홈 피드 10개 단위 광고
- 리워드센터 인라인 광고

## 프론트 환경변수
```env
VITE_QUESTION_PROFILE_AD_MODE=adsense
VITE_ADSENSE_CLIENT=ca-pub-xxxxxxxxxxxxxxxx
VITE_ADSENSE_SLOT_QUESTION_PROFILE=1234567890
VITE_ADSENSE_SLOT_QUESTION_FEED_INLINE=1234567891
VITE_ADSENSE_SLOT_HOME_FEED_INLINE=1234567892
VITE_ADSENSE_SLOT_REWARDS_INLINE=1234567893
VITE_ADS_HIDE_FOR_ADMIN=true
VITE_ADS_HIDDEN_GRADES=1
```

## 동작 방식
- 홈 피드는 피드 10개마다 광고 슬롯 1개를 삽입합니다.
- 직접 광고가 등록되어 있으면 20개 단위 슬롯에는 직접 광고를 우선 노출하고, 나머지 슬롯은 AdSense를 노출합니다.
- 관리자/특정 등급은 환경변수로 광고 미노출 처리할 수 있습니다.

## 로그 저장
- 광고 노출 로그: `app_ad_event_logs`
- 광고 일자별 집계: `app_ad_daily_stats`
- 관리자 확인용 API: `/api/admin/ads/overview`
- 이벤트 수집 API: `/api/ads/events`

## 참고
- AdSense 클릭은 네트워크 최종 클릭 확정값이 아니라 프론트 인터랙션 기반 로그입니다.
- 직접 광고 클릭은 `app_direct_ad_campaigns.clicks`와 이벤트 로그에 함께 반영됩니다.
