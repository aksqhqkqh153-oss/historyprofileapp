# 회원가입 오류 수정 및 다음 배포 단계

## 이번 수정본에서 반영한 코드

### 1) PostgreSQL + 회원가입 500 오류 보완
- 파일: `backend/app/db.py`
- 조치: PostgreSQL 환경에서 `SELECT last_insert_rowid()` 요청이 들어오면 `SELECT lastval() AS last_insert_rowid` 로 변환되도록 수정
- 목적: Railway PostgreSQL 운영에서 회원가입 직후 발생하던 SQLite 전용 함수 오류 방지

### 2) 공개 인증 라우트 Authorization 헤더 제거
- 파일: `frontend/src/api.js`
- 조치: 아래 공개 경로에는 저장된 Bearer 토큰을 붙이지 않도록 수정
  - `/api/auth/login`
  - `/api/auth/signup`
  - `/api/auth/password-reset/request`
  - `/api/auth/password-reset/confirm`
- 목적: 공개 인증 라우트에 불필요한 인증 헤더가 전달되어 발생할 수 있는 인증/CORS 혼선 방지

### 3) 프런트 오류 메시지 개선
- 파일: `frontend/src/api.js`
- 조치: JSON 응답이 없거나 detail 이 없을 때 HTTP 상태코드가 함께 보이도록 보완

## Railway 에서 바로 확인할 것
1. `Variables` 의 `ALLOWED_ORIGINS` 값이 아래처럼 콤마 구분 문자열인지 확인
   - `https://www.historyprofile.com,https://historyprofile.com,https://api.historyprofile.com`
2. `SEED_DEMO_DATA=0`
3. `EMAIL_DEMO_MODE=0`
4. `/api/auth/signup` 요청 직후 `Runtime Logs` 에서 traceback 재확인
5. 가입 성공 후 PostgreSQL 의 `users`, `preferences`, `auth_tokens` 저장 여부 확인

## 다음 단계 우선순위
1. 회원가입 성공
2. 로그인 성공
3. 세션 유지 확인
4. 계정삭제 / 정책 페이지 확인
5. 그 다음 R2 버킷 및 `img.historyprofile.com` 연결

## Cloudflare Pages 중복 프로젝트 정리
- 경로: `Workers & Pages -> 대상 프로젝트 선택 -> Settings -> Delete project`
- 실제 연결된 프로젝트만 남기고, `Latest build failed` / `No active routes` 인 오래된 중복 프로젝트는 정리 권장
