# 로컬 비밀번호 재설정 안내

현재 프로젝트는 기본값으로 `EMAIL_DEMO_MODE=1` 입니다.

따라서 복구 이메일 코드 발송 시 실제 이메일 서버 없이도 프런트와 API만으로 테스트할 수 있습니다.

## 동작 방식
1. `POST /api/auth/password-reset/request` 호출
2. 응답 JSON의 `demo_code` 확인
3. `POST /api/auth/password-reset/confirm` 호출 시 `demo_code` 사용

## 제한
- recovery_email 당 하루 최대 2회 요청 가능
- 코드 만료 시간: 10분
