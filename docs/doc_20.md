# Railway PostgreSQL 전환 빠른 절차

현재 프로젝트는 이미 PostgreSQL을 지원합니다.
별도 코드 수정 없이 `DATABASE_URL`만 PostgreSQL로 연결하면 다음 배포부터 PostgreSQL로 기동됩니다.

## 1. Railway에서 PostgreSQL 추가
1. Railway 프로젝트 메인 화면으로 이동
2. `New` 클릭
3. `Database` 선택
4. `PostgreSQL` 선택
5. 생성 완료 후 서비스 이름 확인 (예: `Postgres`, `postgres`, `database`)

## 2. 백엔드 서비스 Variables 수정
백엔드 서비스 `icj-moving-app-backend` > `Variables`에서 아래처럼 설정합니다.

예시:
```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

주의:
- `Postgres` 부분은 Railway에 실제 생성된 DB 서비스 이름과 정확히 같아야 합니다.
- 기존 값이 있다면 덮어쓰기 합니다.

## 3. Redeploy
1. `Deployments`
2. 최신 배포 우측 메뉴
3. `Redeploy`

## 4. 상태 확인
아래 주소 확인:

```text
https://api.historyprofile.com/api/health
```

정상 목표:
```json
{
  "ok": true,
  "app_env": "production",
  "db_engine": "postgresql"
}
```

## 5. 기존 SQLite 데이터가 이미 있으면 마이그레이션
로컬 PC에서 아래 순서로 실행합니다.

### PowerShell 예시
```powershell
cd "프로젝트폴더\icj2424app_launch_ready_bundle"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r .\backend\requirements.txt
$env:DATABASE_URL="여기에 Railway Postgres 연결문자열"
$env:SQLITE_SOURCE_PATH=".\backend\data\app.db"
python .\backend\scripts\migrate_sqlite_to_postgres.py
```

정상 완료 시 각 테이블별 `[ok]` 메시지가 출력됩니다.

## 6. 마이그레이션 후 최종 점검
1. Railway에서 다시 `Redeploy`
2. `/api/health`에서 `db_engine`이 `postgresql`인지 확인
3. 회원가입/로그인/기존 데이터 조회 확인

## 운영 권장
- SQLite는 테스트/초기 연결 확인용
- 운영은 PostgreSQL 권장
- 이미지 업로드는 다음 단계에서 R2 연결
