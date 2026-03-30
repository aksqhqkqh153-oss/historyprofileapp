# 무료 배포 가이드

## 현재 구조

이 프로젝트는 `backend/static` 안에 React 빌드본이 포함되어 있어, FastAPI 서버 하나만 실행해도 앱 화면과 API가 함께 동작합니다.

## Render

- `render.yaml` 기준으로 `backend`만 배포하면 됩니다.
- 접속 루트 `/` 에서 앱 화면이 열립니다.
- API는 `/api/*` 로 동작합니다.

## Docker

루트 폴더에서 아래처럼 빌드/실행합니다.

```bash
docker build -t icj-moving-app .
docker run -p 8000:8000 icj-moving-app
```

## 프런트엔드 변경 후 재배포

1. `frontend`에서 `npm run build`
2. 생성된 `frontend/dist` 파일을 `backend/static` 으로 복사
3. 배포 재실행
