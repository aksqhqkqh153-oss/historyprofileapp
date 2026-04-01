# historyprofile_app

historyprofile_app 프로필/경력 중심 웹/앱 프로젝트입니다.

## 현재 핵심 구조
- 상단바: 메뉴 | 검색 | 설정
- 하단바: 홈 | 채팅 | 친구 | 질문 | 프로필
- 무료 멀티 프로필 2개, 추가 슬롯은 유료 확장 구조
- 공개 프로필 공개 방식 선택(비공개 / 링크 전용 / 검색 노출)
- 질문 허용 방식 선택(받지 않음 / 로그인 사용자만 / 누구나)
- 사진/영상 업로드 지원
- 영상 업로드 1일 총 50MB, 계정 전체 1GB 기본 제한
- 1:1 실시간 채팅 WebSocket
- 관리자 신고 / 차단 / 업로드 검수

## 내부 참고 메모
- docx/00_프로젝트_작업진행메모.txt
- docx/01_프로젝트_구조및기반메모.txt

# historyprofile_app 운영 배포 준비본

이 ZIP은 다음 운영 구조를 기준으로 정리된 프로젝트입니다.

- 프런트엔드: Cloudflare Pages
- 앱 주소: `https://www.historyprofile.com`
- 정책 페이지: `https://www.historyprofile.com/privacy-policy`
- 계정 삭제 페이지: `https://www.historyprofile.com/account-deletion`
- 백엔드 API: Railway Hobby (`https://api.historyprofile.com` 권장)
- DB: Railway PostgreSQL
- 이미지/파일 저장소: Cloudflare R2 (`https://img.historyprofile.com` 권장)
- DNS / SSL / CDN: Cloudflare
- GitHub 저장소 연결 후 배포

## 이번 ZIP에서 반영한 내용

- PostgreSQL 전환을 위한 DB 호환 계층 추가
- `DATABASE_URL` 기반 Railway PostgreSQL 대응 준비
- Cloudflare R2 업로드 지원 추가
- 채팅 첨부파일 / 일정 이미지 / 프로필 이미지 업로드를 R2 또는 로컬 개발 저장소로 분기 처리
- `/privacy-policy`, `/account-deletion`, `/api/health`, `/api/deployment/meta` 라우트 정비
- Cloudflare Pages 배포를 위한 `frontend/public/_redirects`, `_headers` 추가
- `frontend/.env.production` 추가 (`https://api.historyprofile.com` 기준)
- 운영용 `.env.example` 확장
- SQLite → PostgreSQL 마이그레이션 스크립트 추가
- JSON 백업 스크립트 및 GitHub Actions 수동 백업 워크플로 추가

## 빠른 로컬 실행

### 백엔드
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### 프런트엔드 개발 서버
```bash
cd frontend
npm install
npm run dev
```

## 운영 배포 문서

- `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`
- `docs/PLAY_CONSOLE_SUBMISSION_NOTES.md`

## 운영 권장 환경변수

`backend/.env.example`를 기준으로 Railway Variables / Cloudflare Pages Environment Variables에 입력하세요.

## 마이그레이션

기존 SQLite 데이터를 Railway PostgreSQL로 옮길 경우:

```bash
set DATABASE_URL=postgresql://...실제값...
python backend/scripts/migrate_sqlite_to_postgres.py
```

## 백업

```bash
python backend/scripts/backup_database.py
```

백업 결과는 `backend/backups/`에 JSON으로 저장됩니다.


## 가장 먼저 볼 문서

- `docs/00_가장먼저읽기.md`
- `docs/01_Cloudflare_Pages_설정.md`
- `docs/02_Railway_설정.md`
- `docs/03_Cloudflare_R2_설정.md`
- `docs/04_Cloudflare_DNS_입력값.md`
- `docs/05_Google_Play_런칭순서.md`


## Deployment quick start

See `docs/14_GIT_CLOUDFLARE_RAILWAY_DEPLOY_GUIDE.md` for the exact Windows PowerShell commands and the recommended Cloudflare Pages / Railway settings for this repository.


## Current deployment target
- Frontend custom domain: `https://www.historyprofile.com`
- Backend custom domain: `https://api.historyprofile.com`
- GitHub repository: `https://github.com/aksqhqkqh153-oss/historyprofile_app`


## Railway backend deployment (recommended)
Use a new Railway project/service with **Root Directory = `backend`**.
Do not deploy this repository root with Docker for the backend service.
See `backend/RAILWAY_BACKEND_DEPLOYMENT.md` for the exact values.
