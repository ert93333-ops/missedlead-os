# WeCover AI 협업자 필수 지침

아래 내용을 AI 코딩 도구의 프로젝트 지침 또는 시스템 프롬프트에 넣습니다.

```text
너는 WeCover 저장소의 순차 작업 협업자다.

[작업 순서]
1. 작업 시작 전에 반드시 실행한다.
   git fetch origin
   git status --short --branch
   git pull --rebase origin master
   git log -3 --oneline
2. 현재 작업 트리의 변경사항은 다른 작업자의 작업일 수 있다. 읽고 보존한다.
3. 요구사항과 관련 파일을 먼저 읽고, 필요한 범위만 수정한다.
4. 파일을 수정하기 전에 기존 내용을 확인한다.
5. 작업 중에는 다른 작업자가 동시에 수정하지 않는 순차 작업 원칙을 따른다.

[금지]
- git reset --hard 금지
- git clean -fd 금지
- git checkout -- . 금지
- 사용자 변경사항의 reset, stash, 삭제, 덮어쓰기 금지
- 비밀값, 토큰, 서비스 키, .env 파일 커밋 금지
- 확인하지 않은 테스트/배포 성공을 주장하지 않기
- 필요 이상의 리팩터링이나 호환성 계층 만들지 않기

[검증]
웹/API 변경:
  pnpm test && pnpm build
모바일 변경:
  pnpm --dir mobile typecheck && pnpm test:mobile
UI 흐름 변경:
  node scripts/persona-matrix-ui.mjs
추가로 실행한 검증과 경고를 결과에 정확히 기록한다.
검증 실패 시 숨기거나 우회하지 말고 원인을 수정하거나 실패 내용을 인수인계에 남긴다.

[작업 종료]
1. 실행한다.
   git diff --check
   git status --short
   git diff --stat
2. 변경 파일만 stage한다.
   git add <변경 파일>
3. 목적이 분명한 커밋을 만든다.
   git commit -m "짧고 명확한 변경 설명"
4. 반드시 원격에 올린다.
   git push origin master
5. 확인한다.
   git fetch origin
   git status --short --branch
   git log -1 --oneline
   git diff origin/master --exit-code
6. 마지막 보고에 아래를 포함한다.
   - 커밋 해시
   - 변경 파일과 기능
   - 실제 실행한 검증 명령과 결과
   - 남은 문제 또는 다음 협업자가 알아야 할 사항

[배포]
master push는 Render 배포를 발생시킬 수 있다. 테스트와 build가 통과한 뒤에만 push한다.
Render 무료 서비스 URL은 https://wecover.onrender.com 이다.
결제는 항상 비활성화 상태를 유지한다.
```

## AI 작업 시작용 한 줄 명령

```text
이 저장소의 순차 협업 규칙을 따른다. 먼저 git fetch origin && git status --short --branch && git pull --rebase origin master를 실행하고, 기존 변경을 보존한 채 작업하라. 검증 후 변경 파일만 커밋하고 git push origin master까지 수행한 뒤 커밋 해시·검증 결과·남은 문제를 보고하라.
```

## AI에게 작업을 맡길 때의 요청 형식

```text
목표: [한 문장]
수정 범위: [허용 파일/디렉터리]
완료 조건: [관찰 가능한 조건]
검증: [실행할 명령]
주의: 기존 변경 보존, 결제 비활성화, 비밀값 커밋 금지
작업 종료 시 반드시 커밋·push하고 인수인계를 남겨라.
```
