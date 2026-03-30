# Turnstile / Twilio Verify 운영 적용 점검

## 1. 환경변수
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_ALLOWED_HOSTNAMES`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`

## 2. 관리자 점검 경로
- `/admin` > 운영 연동 상태 카드
- Turnstile 설정 여부
- Twilio Verify 설정 여부
- SMS 테스트 발송 버튼

## 3. 배포 후 점검 순서
1. 관리자 상태 화면에서 Turnstile / Twilio 설정 여부 확인
2. 실제 배포 도메인에서 회원가입/로그인/질문 작성 시 Turnstile이 보이는지 확인
3. 테스트 번호로 인증번호 요청 후 실 SMS 수신 확인
4. 업로드/신고 일괄 검수 버튼 동작 확인
5. 공개 프로필 정적 경로 `/public/p/{slug}` 확인

## 4. 주의사항
- Turnstile은 서버측 Siteverify 검증이 필수이며, 허용 호스트를 운영 도메인과 맞춰야 함.
- Twilio Verify는 실제 계정/서비스 SID가 없으면 demo 모드로만 동작함.
- 이 프로젝트는 코드상 운영 준비는 반영되었지만, 실제 외부 서비스 검증은 계정 접근이 있는 환경에서 최종 확인 필요.
