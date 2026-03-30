# Railway 결산 연동 점검 및 해결

## 1. Railway에서 Playwright 설치 여부 확인
1. Railway 프로젝트 → 서비스 선택 → Deployments → 가장 최근 배포 선택
2. Build Log에서 아래 문구가 보이는지 확인합니다.
   - `pip install --no-cache-dir -r /app/backend/requirements.txt`
   - `python -m playwright install --with-deps chromium`
3. Deploy Log 또는 Runtime Log에서 아래 문구가 보이면 정상입니다.
   - `[entrypoint] Playwright path exists: True`
   - `[entrypoint] browser cache entry:`

### 정상 기준
- `python -m playwright install --with-deps chromium` 가 Build Log에 표시됨
- 런타임 로그에서 `/ms-playwright` 경로가 존재한다고 표시됨

### 비정상 기준
- Build Log에 playwright install 단계가 없음
- 런타임 로그에 `Executable doesn't exist` 가 표시됨

## 2. PostgreSQL ON CONFLICT 점검
이 프로젝트는 `settlement_platform_metrics` 테이블에 `(platform, metric_key)` 기본키가 있어야 합니다.

### SQL 확인 쿼리
Railway → PostgreSQL → Query 에디터에서 아래를 실행합니다.

```sql
SELECT
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
WHERE tc.table_name = 'settlement_platform_metrics'
ORDER BY tc.constraint_name, kcu.ordinal_position;
```

### 정상 기준
- `PRIMARY KEY` 제약이 존재
- 컬럼이 `platform`, `metric_key` 로 표시

## 3. 문제가 이미 생성된 스키마에 반영되지 않았을 때
아래 SQL을 Railway PostgreSQL Query 에디터에서 1회 실행합니다.

```sql
ALTER TABLE settlement_platform_metrics
DROP CONSTRAINT IF EXISTS settlement_platform_metrics_pkey;

ALTER TABLE settlement_platform_metrics
ADD CONSTRAINT settlement_platform_metrics_pkey PRIMARY KEY (platform, metric_key);
```

## 4. Railway Variables에 넣어야 할 항목
- `SOOMGO_EMAIL`
- `SOOMGO_PASSWORD`
- `SETTLEMENT_SYNC_ENABLED=1`
- `SETTLEMENT_PLAYWRIGHT_HEADLESS=1`

## 5. 재배포 후 최종 확인
1. Railway 재배포
2. `https://api.historyprofile.com/api/health` 확인
3. 앱에서 `결산자료 > 데이터 연동` 클릭
4. 서버 로그에서 500 / Playwright 오류가 사라졌는지 확인


## SOOMGO 변수 미감지(409 Conflict) 추가 점검
- Railway 로그에 `숨고 계정 정보가 설정되지 않았습니다`가 나오면, 현재 컨테이너가 숨고 변수를 못 읽는 상태입니다.
- 변수는 반드시 **백엔드 서비스 > Variables > Production** 에 넣어야 합니다. 프로젝트 전체나 다른 서비스에 넣으면 이 컨테이너가 못 읽을 수 있습니다.
- 저장 후에는 **Redeploy** 또는 **Restart** 를 해야 새 컨테이너가 값을 읽습니다.
- 앱 `결산자료` 화면에 이제 감지된 변수 이름이 표시됩니다.
- 기본 키: `SOOMGO_EMAIL`, `SOOMGO_PASSWORD`
- 호환 키: `SETTLEMENT_SOOMGO_EMAIL`, `SETTLEMENT_SOOMGO_PASSWORD`, `SOOMGO_ID`, `SOOMGO_LOGIN_ID`, `SOOMGO_PW`, `SOOMGO_LOGIN_PASSWORD`
