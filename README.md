# OnBid Ops Radar (온비드 운영·품질 통합 모니터링)

온비드 공매정보의 **데이터 품질**과 **OpenAPI 운영상태**를 자동으로 점검하고, 이상징후 탐지 → 담당자 확인·조치 → 일일 점검보고서까지 지원하는 **내부 업무용 웹서비스(교육용 PoC)** 입니다.
투자자에게 물건을 추천하는 서비스가 아니라, 온비드를 안정적으로 운영하도록 돕는 업무 자동화 서비스입니다.

- 기획서: [PRD.md](PRD.md) · 개발 계획: [PLAN.md](PLAN.md) · 설계: [DESIGN.md](DESIGN.md) · 작업 규칙: [CLAUDE.md](CLAUDE.md)
- 남은 작업 정리와 PoC 압축 계획: [PLAN-POC.md](PLAN-POC.md)

## 지금 어디까지 만들었나 (2026-10-29 기준)

개발 중인 PoC입니다. **완성본이 아닙니다.** 아래 표가 실제 상태입니다.

| 구분 | 상태 |
|---|---|
| 이메일·비밀번호 로그인, 비로그인 차단, 팀장/운영 담당자 역할 | 구현됨 |
| 로그인 후 공통 화면 틀 (메뉴 4개, 데이터 출처 DEMO/PUBLIC 배지) | 구현됨 |
| DB 테이블 + 모든 테이블 RLS + 보안 테스트(pgTAP) | 구현됨 |
| 설정값 한곳 관리·검증, KST 시각 계산 | 구현됨 |
| DEMO 시나리오 160건(정상 100·이상 30·경계 30)과 주입·확인 명령 | 구현됨 |
| 탐지 규칙 3개 (날짜 정합성·필수정보·목록/상세 정합성) | 규칙 함수 구현됨, 160건 채점에서 놓침·오탐 0 |
| 점검 엔진, 이상징후 등록, 수동/예약 점검 | 아직 |
| 이상징후 목록·상세·배정·처리·이력 | 아직 (화면은 "준비 중" 안내) |
| 대시보드, 일일 점검보고서 | 아직 (화면은 "준비 중" 안내) |
| 공공데이터포털 PUBLIC 조회기 | 아직 (API 명세 확정 전) |

모든 기능은 **DEMO 가상 데이터만으로** 동작하도록 설계했고, 실제 개인정보와 온비드 운영시스템에는 접근하지 않습니다(읽기·쓰기 모두).

## 핵심 원칙

- 탐지 결과는 "오류"가 아니라 항상 **"이상징후"** 로 표현합니다. 규칙 기반이며 LLM을 쓰지 않습니다.
- 처리상태: `open` → `investigating` → `resolved` / `dismissed` (종결 건 재개만 허용).
- 변경 이력은 **추가만** 가능합니다(수정·삭제 불가).
- 권한은 화면이 아니라 **서버와 Supabase RLS** 에서 검사합니다.

## 기술 스택

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Auth, PostgreSQL, RLS) · Zod · Vitest · Playwright · Vercel

## 로컬 실행

```bash
npm install
npm run dev
```

`.env`가 필요합니다. 변수 이름 목록은 [.env.example](.env.example)에 있고, 실제 값은 저장소에 올리지 않습니다.

| 목적 | 명령 |
|---|---|
| 단위 테스트 | `npm run test:unit` |
| 화면 자동 테스트 | `npm run test:e2e` |
| DB 보안 테스트 | `npm run test:db` |
| 타입 검사 / 린트 / 빌드 | `npx tsc --noEmit` / `npm run lint` / `npm run build` |
| DEMO 시나리오 주입 / 확인 / 지우기 | `npm run seed:demo` / `npm run check:demo` / `npm run seed:demo -- --clear` |

## 보안

- `.env`와 `node_modules`는 저장소에 올리지 않습니다.
- 서버 전용 키(`SUPABASE_SECRET_KEY` 등)는 브라우저 코드에서 쓰지 않습니다.
- 시연 계정은 가상 계정 2개(팀장·운영 담당자)뿐입니다.
