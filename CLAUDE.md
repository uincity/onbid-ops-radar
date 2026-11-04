# CLAUDE.md — OnBid Ops Radar 프로젝트 규칙서 (초안)

@AGENTS.md

## 프로젝트 한 줄 요약

온비드 공매정보의 데이터 품질과 OpenAPI 운영상태를 자동 점검하고, 이상징후 탐지 → 담당자 확인·조치 → 일일 보고서까지 지원하는 내부 업무용 웹서비스(교육용 PoC)입니다. 투자자용 서비스가 아닙니다.

- **기준 문서:** 무엇을 만들지는 [PRD.md](PRD.md)(v2.0, 2026-10-29 개정)가 정합니다. PRD와 이 문서가 다르면 PRD를 따르고, 충돌을 사용자에게 알립니다. 이전 버전은 `docs/PRD_v1.md`이며, 코드 주석·DESIGN에 적힌 "PRD 5-2 규칙 N"·"U번호"는 v1 번호입니다. 새 PRD의 어느 절인지는 PRD 부록 E의 대응표로 찾습니다.
- **폴더:** 프롬프트에 `my-app`이라고 나와도 이 폴더(`onbid_rader`)를 뜻합니다. 공식 이름은 **OnBid Ops Radar**입니다.

## 소통 방식

- 모든 설명과 코드 주석은 한국어로 작성합니다. 초보자도 이해할 수 있게 쓰고, 코드·명령어·파일 이름은 그대로 둡니다.
- 코드를 바꾸면 반드시 무엇을 왜 바꿨는지 한 줄로 알려줍니다.
- 사용자가 결정해야 할 것은 선택지를 붙여 질문하고, 추천안을 먼저 제시합니다.

## 작업 방식

- **파일 위치:** 새 파일은 이 프로젝트 폴더(`onbid_rader`) 안에만 만듭니다.
- **파일 삭제:** 파일을 바로 삭제하지 않습니다. 프로젝트 폴더 안에 `trash-can` 폴더를 만들어 그 안으로 옮겨만 두고, 사용자가 작업 후 직접 확인하고 삭제합니다. `trash-can`은 타입 검사(`tsconfig.json`)와 린트(`eslint.config.mjs`)에서 제외되어 있어, 옮겨 둔 코드 파일이 검사를 깨뜨리지 않습니다.
- **서브에이전트:** 이미 설치된 서브에이전트(bkit 에이전트 등)를 필요할 때마다 적극 활용합니다.
- **외부 서비스 인증:** 토큰 값을 사용자에게 묻거나 채팅에 출력하지 않고, `.env`에 있는 값을 읽어서 사용합니다.
  - Supabase 작업이 필요하면 Supabase CLI를 설치해 `.env`의 `SUPABASE_ACCESS_TOKEN`으로 인증합니다.
  - Vercel 작업(배포 등)이 필요하면 Vercel CLI를 설치해 `.env`의 `VERCEL_TOKEN`으로 인증합니다.
  - 토큰은 명령에 직접 적지 말고 환경변수로 넘겨, 화면 출력과 로그에 값이 남지 않게 합니다.

## 작업 절차 (검증 루프)

코드를 바꿀 때마다 아래 순서를 매번 반복합니다.

1. **변경한다.**
2. **검사한다:** `npm run lint`와 `npm run build`를 실행해 오류가 없는지 확인한다.
3. **화면을 확인한다:** 화면이 바뀐 작업이면 `npm run dev`로 띄워 실제로 보이는지 확인한다.
4. **고친다:** 문제가 있으면 고치고 다시 1번으로 돌아간다.
5. **커밋한다:** 통과하면 git 커밋으로 그 상태를 남긴다.
   - 커밋 메시지는 한국어로, 무엇을 왜 바꿨는지 한 줄로 적는다.
   - 검증을 통과하지 못한 상태는 커밋하지 않는다.
6. **알린다:** 무엇을 왜 바꿨는지 한 줄로 요약해 알려준다.

## 작업 절차 (브랜치)

- **브랜치 만들기:** 새 기능이나 눈에 띄는 변경을 시작할 때는, 먼저 `main`에서 작업용 브랜치를 만들고 그 브랜치에서 작업한다.
  - 브랜치 이름은 `feature/기능이름` 형태로, 한글 없이 영문으로 짓는다. 예: `feature/login`, `feature/date-rule`
- **커밋 위치:** 커밋은 그 작업 브랜치에만 쌓는다. `main`에서 직접 작업하지 않는다.
- **병합:** 검증을 통과해 작업이 끝나도 `main`에 바로 합치지 않는다. "합칠 준비가 됐다"고 사용자에게 알리고, 사용자가 확인한 뒤 병합해달라고 말하면 그때 `main`에 합친다.

## 명령어

| 목적 | 명령 |
|---|---|
| 개발 서버 | `npm run dev` (http://localhost:3000) |
| 프로덕션 빌드 | `npm run build` |
| 린트 | `npm run lint` |
| 타입 검사 | `npx tsc --noEmit` |
| Supabase·Vercel CLI 로그인 확인 | `npm run check:cli` |
| Supabase 프로젝트 만들기·연결 | `npm run setup:supabase` |
| Supabase 연결 확인 | `npm run check:supabase` |
| 앱 환경변수 채우기 (`.env`) | `npm run setup:env` |
| 환경변수·키 확인 | `npm run check:env` |
| 시연·테스트 계정 만들기·역할 부여 (팀장 1, 운영 담당자 1) | `npm run setup:accounts` |
| 시연·테스트 계정을 실제 로그인으로 확인 | `npm run check:accounts` |
| DB 반영 미리 보기 | `npm run db:push -- --dry-run` |
| DB 반영 (`supabase/migrations`의 새 파일) | `npm run db:push` |
| DB 테이블 전체 확인 (새 테이블은 `scripts/db-checks/`에 확인 파일 추가) | `npm run check:db` |
| DB 보안 테스트 pgTAP (`supabase/tests/database/*.test.sql`, Docker Desktop 필요) | `npm run test:db` |
| 단위 테스트 Vitest (`tests/unit/*.test.ts`, DB·브라우저 없이 빠르게) | `npm run test:unit` |
| DEMO 시나리오 160건 파일 다시 만들기 (`data/demo/scenarios.json`, 손으로 고치지 않음) | `npm run generate:demo` |
| DEMO 시나리오를 DB에 주입 (다시 실행하면 이전 주입분을 지우고 새로 넣음, 지우기만: `-- --clear`) | `npm run seed:demo` |
| DB에 주입된 DEMO 시나리오가 파일과 같은지 확인 | `npm run check:demo` |
| 점검 엔진을 실제 DB에 한 번 돌려 보는 시험 (`tests/unit/check-engine-live.test.ts`, 시험이 만든 기록은 끝나면 지움, 서버 관리용 키 필요) | `npm run test:engine-live` |
| 예시 운영 데이터 한 번 넣기 (과거 점검 이력·이상징후·처리 이력, 이력은 지울 수 없어 처음 한 번만 동작) | `npm run seed:sample` |
| PUBLIC 조회기를 실제 온비드 OpenAPI에 붙여 보는 시험 (`tests/unit/public-live.test.ts`, 호출 2번, DB에는 쓰지 않음, `DATA_GO_KR_SERVICE_KEY` 필요) | `npm run test:public-live` |
| 온비드 서비스 등록부 다시 만들기 (명세서 .docx → `data/registry/api-registry.json`·`docs/api-registry.md`, 읽기 전용, Python 필요, 손으로 고치지 않음) | `python scripts/build-api-registry.py "<명세서 폴더>"` |
| 화면 자동 테스트 Playwright (`tests/e2e/*.spec.ts`, 개발 서버를 3100번 포트로 자동 실행, Edge 사용, `.env`의 시연 계정 필요) | `npm run test:e2e` |

DB 구조는 `supabase/migrations/`에 마이그레이션 파일을 추가하는 방식으로만 바꿉니다(대시보드에서 직접 고치지 않음). DB를 바꾼 작업은 `npm run check:db`와 `npm run test:db`를 모두 통과해야 합니다. 새 테이블이나 DB 함수를 만들면 해당 pgTAP 테스트 파일도 함께 추가합니다. 화면(로그인·권한이 걸린 화면)을 바꾼 작업은 `npm run test:e2e`도 통과해야 하고, 로그인이 필요한 화면 확인에는 `.env`의 `DEMO_*` 계정을 Playwright로 입력합니다(비밀번호를 채팅·로그에 출력하지 않음). `npm run test:e2e`는 로그인을 약 20번 하므로 Supabase 제한(5분에 약 30회) 때문에 5분 안에 연달아 두 번 돌리면 실패할 수 있습니다. 규칙·계산 같은 순수한 코드를 바꾼 작업은 `npm run test:unit`도 통과해야 하고, 새 규칙에는 경계값(한 칸 안·밖)을 포함한 단위 테스트를 함께 만듭니다.

## 기술 스택 (고정)

- Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · ESLint
- Supabase (Auth, PostgreSQL, RLS, Cron, pgTAP) · Vercel 배포 · 공공데이터포털 온비드 OpenAPI
- 2026-10-29 설계 단계에서 추가 승인: `@supabase/supabase-js`·`@supabase/ssr`(Supabase 연결), Zod(입력값 검사), Vitest(단위 테스트), Playwright(화면 자동 테스트). 자세한 이유는 [DESIGN.md](DESIGN.md) 3장
- 기술 스택은 PRD에 정한 대로 Next.js로 고정합니다. 다른 프레임워크로 바꾸거나 마이그레이션을 제안하지 않습니다.
- 배포는 Vercel을 사용합니다.
- 이 목록 밖의 라이브러리·프레임워크·외부 서비스는 사유·영향·대안을 설명하고 승인받은 뒤에만 추가합니다.
- Next.js 16은 이전 버전과 API가 다를 수 있습니다. 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 관련 문서를 확인합니다. `next.config.ts`에서 `cacheComponents`가 켜져 있습니다.
- import 경로는 `@/*` 별칭(프로젝트 루트 기준)을 사용합니다.

## 개발 진행 규칙

1. **순서:** PRD 부록 E-3의 개발 단위 `R01 → R02 → … → R08`을 순서대로, 한 번에 한 단위씩 진행합니다. 이미 끝난 v1 단위(U01~U20)는 다시 만들지 않고 확장합니다. 예약 점검(PLAN 31·32)은 R07, 보안·성공 기준·배포(PLAN 34~37)는 R08입니다.
2. **단위 완료 조건:** 단위마다 타입 검사·린트·빌드를 통과하고, 관련 테스트를 통과해야 다음 단위로 넘어갑니다(PRD 8-4).
3. **Nice 금지:** Must 1~5의 테스트와 Vercel 배포가 끝나기 전에는 Nice 기능을 만들지 않습니다.
4. **범위 밖 금지:** PRD 6-3의 비범위(운영 시스템 수정, 내부망 접근, 투자자 기능, 금액 이상 탐지, LLM 기능, 외부 알림, 회원가입 화면 등)는 만들지 않습니다.
5. **요청하지 않은 기능 금지:** 사용자가 요청하지 않은 기능이나 화면을 임의로 추가하지 않습니다.

## 도메인 규칙 (코드에서 반드시 지킬 것)

- **표현:** 탐지 결과는 "오류"가 아니라 항상 "이상징후"로 표현합니다. 최초 판정값은 `undetermined`입니다.
- **서비스의 정체:** 이 서비스는 서버 내부 모니터링이 아니라 **외부 이용자 관점의 합성 점검(Synthetic Monitoring)** 입니다. 점검 결과는 "우리 점검 요청에 관측된 결과"일 뿐이며, 전체 이용자의 호출 건수·서버 성공률·원천 DB 전체 건수·내부 장애 원인을 알 수 있는 것처럼 표시하지 않습니다(PRD 1-2). 개별 요청의 `totalCount`는 "점검요청 결과값"으로만 기록합니다.
- **API 상태 6종:** `PASS_DATA`·`PASS_NO_DATA`·`DEGRADED`·`FAIL`·`UNVERIFIED`·`NOT_RUN`을 구분합니다. `UNVERIFIED`(검증 불가)와 `NOT_RUN`(미점검)을 정상으로도 실패로도 합산하지 않고(판정은 `lib/checks/probe`, 점검 전 판단 불가 이유는 `UNVERIFIED`로 남기며 PUBLIC 점검은 요청을 보내기 전에 준비 상태를 확인합니다), DEMO와 PUBLIC 성과를 합산하지 않으며, 26종 전체가 정상이라고 주장하지 않습니다(PRD 5-2-3, 3-3).
- **탐지 규칙:** 현재 구현된 `DATE_ORDER`·`REQUIRED_FIELD`·`LIST_DETAIL_MISMATCH`는 유지합니다(기존 기록·DEMO 회귀 테스트 보존). PUBLIC 핵심 품질 규칙은 PRD 5-2A의 `DQ_SCHEMA`·`DQ_REQUIRED`·`DQ_LIST_DETAIL_REF`·`DQ_CROSS_API_REF` 4개이며 R06에서 구현합니다. 날짜 역전은 PUBLIC 핵심 지표에서 제외합니다. 결정적인 규칙 기반 로직으로 만들고 LLM을 쓰지 않습니다.
- **빈 결과(0건):** 0건은 기본적으로 정상 무데이터 후보입니다. `EMPTY_RESULT`는 이전 기록과의 호환 코드로만 남기고, **새 PUBLIC 점검에서는 새로 만들지 않습니다**(PRD 5-2-3). PUBLIC 점검의 0건은 R02에서 이미 이 정책으로 바꿨습니다(`lib/checks/probe`, PUBLIC 0건은 `PASS_NO_DATA` 또는 `UNVERIFIED(NO_DATA_UNCONFIRMED)`로만 남고 이상징후를 만들지 않음). DEMO 점검은 이전 정책(`EMPTY_RESULT`)을 회귀 테스트용으로 유지하고, DB 설정값 `empty_allowed_by_endpoint`의 `public-*` 항목은 PUBLIC에서 쓰지 않으며 R03에서 정리합니다. 서비스키·한도 문제로 데이터를 받지 못한 실행에서는 데이터 이상징후를 만들지 않습니다.
- **API 필드:** PRD 부록 A에 확정되지 않은 API 필드·호출 파라미터·서비스명은 임의로 만들지 않습니다. 26종 서비스 등록부는 `docs/api-registry.md`(초안, 미확정 항목 표시)를 따릅니다. DEMO 데이터는 PRD 부록 B의 가상 스키마만 사용합니다.
- **데이터 출처:** DEMO와 PUBLIC 데이터를 항상 구분해 저장하고, 화면과 보고서에 출처를 표시합니다. 모든 기능은 DEMO 데이터만으로 동작해야 합니다.
- **처리상태:** `open` → `investigating` → `resolved`/`dismissed`, 종결 건의 재개(`investigating`)만 허용합니다. 나머지 전이는 거부합니다(PRD 5-3).
- **감사이력:** 이벤트는 추가만 하고 수정·삭제하지 않습니다. 업무 데이터 변경과 이력 기록은 같은 DB 트랜잭션에서 저장합니다.
- **설정값:** 타임아웃 10초, 호출 상한 20/100회, 실행시간 60초(기본값, 운영 DB는 2026-11-04에 서비스 27종 점검이 60초를 넘겨 80초로 조정) 등은 코드에 흩어 두지 않고 한곳(PRD 5-5)에서 관리합니다. 코드는 숫자를 직접 쓰지 않고 `lib/settings`의 `loadSettings()`로 읽은 `Settings`를 씁니다. 설정을 읽지 못하거나 규칙에 어긋나면 기본값으로 대신하지 않고 `SettingsError`로 멈춥니다. 설정값 규칙(DB와 코드)을 바꾸면 두 곳을 함께 고치고 `tests/unit/settings-drift.test.ts`가 통과해야 합니다.
- **시각 계산:** KST 날짜·하루 범위·예약 시각 계산은 `lib/time.ts`를 씁니다. `new Date()`로 직접 날짜를 잘라 쓰지 않습니다(서버 시각은 UTC이므로 날짜가 하루 어긋날 수 있음).
- **시간대:** 집계와 표시는 KST 기준입니다. Supabase Cron은 UTC이므로 예약 점검 시각 KST 08:00은 전날 UTC 23:00으로 설정합니다(2026-11-03 사용자 요청으로 PRD 5-5의 09:00에서 변경. PRD와 다르며 코드의 기준은 `lib/time.ts`의 `SCHEDULED_RUN_KST`).

## 보안 규칙

- **`.env` 내용 금지:** `.env`의 값을 읽어서 출력하거나 로그·답변·커밋에 넣지 않습니다. 확인이 필요하면 "값 있음/없음"으로만 말합니다.
- **서버 전용 키:** `SUPABASE_SECRET_KEY`, `DATA_GO_KR_SERVICE_KEY`, `CRON_SECRET` 등에는 `NEXT_PUBLIC_`을 붙이지 않고, 브라우저 코드에서 사용하지 않습니다.
- **키 마스킹:** API 요청 URL을 로그에 남길 때는 `serviceKey` 등 인증정보를 가립니다. 오류 응답에 서버 내부정보를 노출하지 않습니다.
- **권한 검사:** 권한은 화면이 아니라 서버와 Supabase RLS에서 검사합니다. 모든 테이블에 RLS를 적용합니다.
- **LLM 키:** `.env`에 `OPENAI_API_KEY`가 있지만, MVP에서는 앱 코드에서 사용하지 않습니다.
- **`.env` 하나로 관리:** 개발 도구용 토큰과 앱용 변수가 모두 `.env`에 있습니다. 변수 목록과 구분은 `.env.example`을 따르고, Vercel에는 "앱용" 변수만 등록합니다. `GITHUB_TOKEN`·`SUPABASE_ACCESS_TOKEN`·`VERCEL_TOKEN`·`OPENAI_API_KEY`·`SUPABASE_PROJECT_REF`·`SUPABASE_DB_PASSWORD`·`DEMO_*`(시연 계정)는 등록하지 않습니다. `DATA_GO_KR_SERVICE_KEY`(공공데이터포털 키)도 **기관의 보안·클라우드 이용 승인을 확인하기 전에는 Vercel에 등록하지 않습니다**(PRD 6-4). 2026-11-03에 사용자가 승인을 확인하고 Production에 Secret으로 등록했으며(`vercel env ls`로 이름만 확인), 배포 환경에서도 PUBLIC 수동 점검이 실행됩니다.
- **시연·테스트 계정:** 팀장(admin)과 운영 담당자(operator) 가상 계정 2개만 있고, 가상 데이터만 다룹니다. 비밀번호(`DEMO_ADMIN_PASSWORD`, `DEMO_OPERATOR_PASSWORD`)는 사용자에게 묻거나 채팅에 출력하지 않고 `.env`에서 읽어 씁니다(Playwright 로그인 등). 역할은 `npm run setup:accounts`(서버 관리 절차)로만 부여하고, 화면·API로 바꾸는 기능은 만들지 않습니다.
- **실사용 계정(2026-11-04~):** 실제 점검 이력을 쓰는 단계라 실명 계정(팀장 1, 팀원 1)을 `npm run add:account -- --email 주소 --name 이름 --role admin|operator`로 추가합니다(서버 관리 절차, 화면에서 만드는 기능 없음). 비밀번호는 아무도 모르고 본인이 일회용 링크(`/auth/confirm` → `/reset-password`)로 직접 정합니다. 링크는 터미널에만 출력하고 채팅·문서에 남기지 않으며, 다시 필요하면 `-- --email 주소 --link-only`로 새로 만듭니다. 퇴사·교체 때는 계정을 지우지 않고 정지합니다(처리 이력·보고서가 계정을 가리킴).
- **공개 회원가입 금지:** Supabase Auth의 "Allow new users to sign up"은 꺼 둡니다(PRD 6-3 7번). 이 설정은 사용자가 대시보드에서 직접 바꾸며, `npm run check:accounts`가 켜져 있으면 "주의"로 알려 줍니다.
- **개인정보:** 실제 개인정보를 저장하지 않습니다. 공개 API 응답에서도 필요한 필드만 골라 저장합니다.
- **쓰기 요청 금지:** 실제 온비드 운영시스템이나 공개 API에 쓰기 요청을 보내지 않습니다.

## Git 규칙

- 커밋은 "작업 절차 (검증 루프)"의 5번에서, 검증을 통과했을 때만 합니다. 푸시는 사용자가 요청할 때만 합니다.
- `.env` 등 비밀 정보 파일과 `node_modules` 폴더는 `.gitignore`에 등록해 두고, 절대 커밋하지 않습니다. 현재 `.env*`, `node_modules`, `.next`, `.bkit`, `trash-can`이 등록되어 있습니다.
- 커밋하기 전에 `git status`와 스테이징된 파일 목록을 보고, `.env` 같은 비밀 값 파일이 커밋에 들어가지 않았는지 확인합니다.
- 커밋 메시지는 한국어로, 무엇을 왜 바꿨는지 한 줄로 적습니다.
- 개발 환경은 Windows입니다. 경로와 셸 명령은 Windows에서 동작하는지 확인합니다.
