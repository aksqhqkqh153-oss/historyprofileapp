# Railway PORT 오류 해결

증상:
- `Error: Invalid value for --port: '$PORT' is not a valid integer.`

원인:
- Railway 서비스 설정 또는 시작 명령이 셸 변수 치환 없이 `--port $PORT` 형태로 실행됨

조치:
1. Railway 서비스 > Settings > Start Command 항목이 있다면 비우거나 삭제
2. GitHub 최신 커밋 반영 후 재배포
3. 임시 Railway 도메인에서 `/api/health` 확인

현재 프로젝트 수정사항:
- Docker 시작 방식을 entrypoint 스크립트로 변경
- `PORT` 값을 셸에서 먼저 정수로 확정한 뒤 uvicorn 실행
