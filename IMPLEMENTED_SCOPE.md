# Implemented Scope

- 홈 질문 탐색 루프 제거
- 친구 화면 profile 참조 오류 수정 (`profile is not defined`)
- 잘못된 정적 AdSense 스크립트 제거 및 실제 광고 변수 검증 로직 추가
- 채팅 화면을 목록 전용으로 변경하고 대화 입력/전송 UI 제거
- 홈 피드 광고 슬롯을 10개당 1개 기준으로 유지
- 홈 피드 광고를 AdSense 수동 스타일 인피드(`data-ad-format="fluid"`, `data-ad-layout-key`) 방식으로 반영
- 상대방 질문 화면 광고 슬롯이 기존 Question Top / Profile / Feed Inline 변수로 정상 렌더링되도록 유지
- Cloudflare Pages 환경변수 안내 파일 갱신

- 광고 기본 표시 정책을 관리자/1등급 숨김에서 전체 표시 기준으로 변경
