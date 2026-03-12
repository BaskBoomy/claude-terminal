---
description: npm 배포. "npm 배포", "npm publish", "npm에 배포", "패키지 배포" 등의 요청 시 자동 실행
user_invocable: true
---

# npm 배포 스킬

`create-claude-terminal` 패키지를 npm에 배포합니다.

## 실행 절차

1. 현재 npm/package.json 버전 확인
2. 사용자에게 bump 타입 확인 (patch/minor/major) — 명시하지 않으면 patch
3. `scripts/npm-publish.sh` 실행
4. 결과 보고

## 명령어

```bash
# patch (0.2.0 → 0.2.1)
bash scripts/npm-publish.sh patch

# minor (0.2.0 → 0.3.0)
bash scripts/npm-publish.sh minor

# major (0.2.0 → 1.0.0)
bash scripts/npm-publish.sh major
```

## 참고
- 토큰: `.env` 파일의 `NPM_TOKEN` (gitignored)
- 패키지 경로: `npm/`
- 레지스트리: https://www.npmjs.com/package/create-claude-terminal
