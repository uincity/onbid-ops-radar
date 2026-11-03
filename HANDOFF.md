# HANDOFF — OnBid Ops Radar 작업 인수인계

> 작성: 2026-10-29 · 기준 커밋: `6e2cc8e` (`feature/db-v2`) · 이 문서만 읽고 이어서 작업할 수 있도록 정리했다.
> 규칙의 원본은 [CLAUDE.md](CLAUDE.md), 요구사항은 [PRD.md](PRD.md)(v2.0), 설계는 [DESIGN.md](DESIGN.md), 작업 목록은 [PLAN.md](PLAN.md)다. 이 문서는 "지금 어디까지 왔고 무엇을 조심할지"만 모았다.

---

## ⚠ 0. 가장 먼저 알아야 할 것 (현재 깨져 있는 것)

**배포된 사이트(https://onbid-ops-radar.vercel.app)의 코드가 DB보다 오래되어 일부가 동작하지 않는다.**

- 배포된 코드는 `feature/ops-screens`(`00d64da`) 버전이다. 그 코드는 설정값의 필드 이름을 **소문자만** 허용한다.
- 그 뒤 PUBLIC 작업(`50a1144`)에서 DB `settings`에 `cltrMngNo` 같은 **대소문자 혼합 이름**을 넣었다. 배포 앱과 로컬이 **같은 Supabase DB**를 쓰므로 배포 앱의 `loadSettings()`가 실패한다.
- 실제로 확인했다: 배포 사이트 로그인 뒤 헤더의 출처 배지가 **"출처 확인 불가"** 로 나온다. 같은 이유로 배포 환경의 **[수동 점검 실행]도 실패**할 것이다(설정값을 읽지 못함). 로그인·이상징후 목록·상세 처리·보고서 화면 등은 설정값을 안 읽어 영향이 작을 것으로 보이나 전수 확인은 하지 않았다.
- **해결:** 최신 코드를 다시 배포하면 된다(최신 코드는 대소문자 혼합 이름을 허용). 배포는 사용자가 요청할 때만 한다. 방법은 아래 §8.
- `DATA_GO_KR_SERVICE_KEY`는 2026-11-03에 사용자가 Vercel Production에 등록했다(승인 확인 후). 배포 환경에서도 PUBLIC 점검이 실행된다.

---

## 1. 목표

**OnBid Ops Radar** — 온비드 OpenAPI를 **외부 이용자 관점으로 합성 점검(Synthetic Monitoring)** 하고, 이상징후를 탐지 → 담당자 확인·조치 → 일일 보고서까지 이어 주는 내부 업무용 웹서비스(교육용 PoC).

- 스택(고정): Next.js 16 App Router · TypeScript · Tailwind 4 · Supabase(Auth·Postgres·RLS·Cron·pgTAP) · Vercel · Zod · Vitest · Playwright.
- PRD v2.0(2026-10-29)에서 방향이 바뀌었다: **온비드 OpenAPI 26종의 정상 작동 여부(가용성)를 1순위**, 응답 데이터 품질을 2순위, 기존 확인·조치·보고 기능은 유지. 서버 전체 호출량·원천 DB 건수·내부 장애 원인은 공개 API로 알 수 없으므로 **표시하지 않는다**(PRD 1-2).
- 사용자: 비개발자(초보자 눈높이). **모든 답변·주석·화면 문구는 한국어**.

---

## 2. 현재 상태 한눈에

| 항목 | 상태 |
|---|---|
| 작업 브랜치 | `feature/db-v2` (미병합). 아래 "브랜치 구조" 참고 |
| 배포 | Vercel 1회 시범 배포됨(구버전, §0 문제 있음). GitHub: https://github.com/uincity/onbid-ops-radar (공개) |
| 테스트 | 단위 562개 통과(6개는 실제 DB·API용이라 건너뜀) · pgTAP 431개 통과 · `check:db` 통과 · 빌드·린트·타입 검사 통과 · 화면 자동 테스트(Playwright) 관련 스펙 통과 |
| DB(원격 Supabase 1개, 배포와 공유) | 마이그레이션 13개 적용 완료(최신 `20261029060100`). 시연 데이터가 들어 있음(§5-D) |
| 실제 온비드 API 호출 | 목록 1건·상세 1건만 확인(총 4번 호출). 나머지 26개 오퍼레이션은 한 번도 호출하지 않음 |

### 브랜치 구조 (모두 쌓여 있음, `main`에는 일부만 병합)

```
main (0e6c4cc) ─ origin/main 과 같음. feature/poc-detect 까지 병합된 상태 (PLAN 1~20번, PoC)
 └ feature/demo-fetcher    7a619b4  PLAN 21  DEMO 조회기
    └ feature/check-engine 9841b1b  PLAN 22  점검 엔진 + start_check_run
       └ feature/record-detection 49d3e17  PLAN 23  record_detection
          └ feature/ops-screens   00d64da  PLAN 24~30 화면·DB 함수 3개  ← 배포된 버전, GitHub에 푸시됨
             └ feature/public-fetcher 49d760f  PLAN 33 PUBLIC 조회기 (로컬만)
                └ feature/prd-v2      685b89e  PRD v2.0 + R01 등록부 (로컬만)
                   └ feature/probe-status 0729105  R02 점검 상태 판정 (로컬만)
                      └ feature/db-v2  6e2cc8e  R03 DB 확장 ← 지금 여기 (로컬만)
```

- **GitHub에 올라간 것:** `main`, `feature/login`~`feature/poc-detect`, `feature/ops-screens`. 그 뒤 4개 브랜치는 **로컬에만** 있다(푸시 안 함).
- **병합 규칙:** 사용자가 "병합해줘"라고 말하기 전에는 `main`에 합치지 않는다. 푸시도 요청이 있을 때만.

---

## 3. 완료된 것

### 3-1. 기반·화면·핵심 기능 (PLAN 1~30번, 33번)
- 환경·CLI·Supabase 연결, DB 테이블 10개(+RLS, 이력 추가 전용), 가상 시연 계정 2개(팀장/운영 담당자), 로그인·공통 화면 틀, 설정값 모듈(`lib/settings`)과 KST 시각 도우미(`lib/time.ts`).
- DEMO 시나리오 160건(정상 100·이상 30·경계 30)과 주입 스크립트.
- 탐지 규칙 3개(`DATE_ORDER`·`REQUIRED_FIELD`·`LIST_DETAIL_MISMATCH`) — 출처별 **필드 프로필**(`lib/rules/field-profile.ts`)로 DEMO·PUBLIC 모두 지원.
- DEMO 조회기, 점검 엔진(`lib/checks/run-check.ts`: 중복 실행 차단·호출 상한·60초 제한·일일 예산), `start_check_run`·`record_detection` DB 함수, 이상징후 배정·판정·상태 변경 DB 함수 3개.
- 화면: 대시보드, 이상징후 목록·상세(근거·원본 데이터·이력), 처리 버튼, 점검 이력·팀장 수동 점검(DEMO/PUBLIC 선택), 일일 보고서(생성·미리보기·Markdown 다운로드).
- 시연 데이터: `npm run seed:sample`(1회만, §5-D).
- PUBLIC 조회기(`lib/checks/public-fetcher.ts`): 온비드 **부동산 물건목록 `getRlstCltrList2` + 물건상세 `getRlstDtlInf2`**, 읽기 전용, https·허용 호스트만, 서비스키 보호, 호출 상한·일일 예산 900회, 오류 구분(서비스키·한도 vs 일반 실패). PRD 부록 A 확정.

### 3-2. PRD v2.0 개정과 R01~R03 (이번 세션 후반)
- **PRD v2.0 교체**(`PRD.md`): v1은 `docs/PRD_v1.md`에 보관. 코드·주석의 "PRD 5-2 규칙 N", "U번호"는 v1 번호 → PRD 부록 E 대응표로 찾는다.
- **R01 서비스 등록부:** 명세서 25개 → `data/registry/api-registry.json`(서비스 25종·오퍼레이션 28개) + `lib/registry`(Zod 검증) + `docs/api-registry.md`. 26번째 1종은 **미확정**.
- **R02 점검 상태 판정:** `lib/checks/probe/` — 상태 6종(`PASS_DATA`·`PASS_NO_DATA`·`DEGRADED`·`FAIL`·`UNVERIFIED`·`NOT_RUN`) 분류, 점검 전 준비 상태, 응답 구조 확인, 집계. PUBLIC 점검에 연결, **PUBLIC 0건은 이상징후를 만들지 않음**(DEMO는 이전 정책 유지). 실호출 확인: 목록·상세 모두 `PASS_DATA`.
- **R03 DB 확장:** 새 테이블 `probe_results`(판정 저장), `api_checks`에 `api_id`·`operation_id`·`result_code`·`request_summary`, 허용 규칙 ID 15개(`DQ_*` 4 + `API_*` 7 추가), PUBLIC 빈 결과 설정 정리. 기존 행·이력 보존.

---

## 4. 남은 작업

PRD 부록 E-3 기준 `R04 → R08`을 순서대로. (기존 PLAN 번호와 대응은 PLAN.md 상단 표)

| 단위 | 내용 | 비고 |
|---|---|---|
| **R04** | 개별 API·배치별 점검 엔진 | 지금 엔진은 "한 번 20회·60초, 목록→상세 2개 오퍼레이션" 고정. 26종을 작은 배치로 나눠 오퍼레이션별로 따로 실행·기록, **한 API 실패가 다른 API를 막지 않게**(격리), 시도 못 한 것은 `NOT_RUN` + 사유. 점검 판정을 **실행 상태(성공·일부·실패)에 반영**(지금은 응답 구조 오류가 있어도 `succeeded`일 수 있음). API 상태 이상징후(`API_*`)를 **언제 만들지** 규칙 정하기(예: 연속 N회). 서비스별 호출 예산·초당 제한(명세에 없는 5개 오퍼레이션은 확인 필요) |
| **R05** | 26종 가용성 대시보드·일일 보고서 | 대시보드·보고서의 "규칙별 신규" 집계가 아직 **이전 규칙 4개만** 센다(`RULE_IDS`). 상태 6종·분모(미점검·검증 불가)를 PRD 3-1 산식대로 표시. `summarizeProbes()`는 이미 있음 |
| **R06** | 데이터 품질 4규칙 `DQ_*` | `DQ_SCHEMA`·`DQ_REQUIRED`·`DQ_LIST_DETAIL_REF`·`DQ_CROSS_API_REF`. 지금은 DB·상수에 ID만 있고 생성 로직 없음. 이전 `DATE_ORDER` 등은 회귀용 유지 |
| **R07** | 예약 점검 KST 09:00 + 09:30 누락·미완료 감지 | PLAN 31·32. Supabase Cron + Vault(`CRON_SECRET`). 예정·시작·완료·차단·부분완료 구분. `mark_schedule_missed()` DB 함수 |
| **R08** | 보안 SEC-01~12 일괄, 성공 기준 테스트, 배포·배포 후 재검증 | PLAN 34~37. 배포 전 기관 보안·클라우드 승인 확인(PRD 6-4) |
| 그 뒤 | PLAN 38(Gap 분석)·39(완료 보고서) | |

### 다음에 바로 할 일 (추천 순서)
1. (사용자 결정) §0의 배포 불일치를 고치려면 재배포 — 사용자가 요청하면 §8 절차로.
2. R04 설계를 먼저 사용자에게 보여 주기: ① 오퍼레이션 단위 실행 모델 ② `check_runs`와 배치(그룹)의 관계 ③ API 이상징후 생성 조건 ④ 호출 예산을 서비스별로 어디에 둘지(등록부 JSON의 `quota` vs DB). 큰 설계 결정이 있으므로 선택지+추천안을 먼저 제시한다.
3. 등록부(`data/registry`)에 승인 상태·유효 입력값·무데이터 정책을 채우는 일은 사용자 확인이 필요한 항목이 많다(§7 열린 질문).

---

## 5. 주요 결정사항과 이유

### A. 제품·문서
| 결정 | 이유 |
|---|---|
| PRD를 v2.0(외부 이용자 관점 26종 가용성 우선)으로 교체, v1은 `docs/PRD_v1.md` 보관 | 공개 API로는 서버 전체 호출량·원천 DB 건수를 알 수 없다. 그걸 아는 것처럼 표시하면 오해를 만든다. 코드·문서가 v1 번호를 가리키므로 대응표(부록 E)와 보관본이 필요 |
| "26종"을 **25종 등록 + 1종 미확정**으로 확정 | 명세서 파일 번호 16번이 없고 서비스ID `SVC-API-008`·`009`도 없다. 임의로 26번째를 만들지 않는다 |
| 미점검·검증 불가를 정상으로도 실패로도 세지 않음. DEMO와 PUBLIC 성과를 합산하지 않음 | PRD 3-3. 지표 부풀리기 방지 |
| PUBLIC 0건은 이상징후를 만들지 않고 `PASS_NO_DATA`/`UNVERIFIED(NO_DATA_UNCONFIRMED)`로 판정 | 조회 조건에 따라 정상적으로 0건일 수 있다. "실데이터가 반드시 있다고 확인된 Positive 점검"에서만 `POSITIVE_DATA_MISSING` |
| DEMO는 이전 정책(`EMPTY_RESULT`) 유지 | 기존 DEMO 160건 회귀 테스트·기록 보존(PRD D-1) |
| `DATE_ORDER` 등 이전 규칙은 삭제하지 않고 회귀용으로 유지 | 기존 행·테스트 보존 |

### B. PUBLIC 조회기
| 결정 | 이유 |
|---|---|
| 목록↔상세 짝으로 **부동산 물건목록/상세**를 선택 | 같은 필드(물건명·기관·입찰시작/종료)를 공유해 목록·상세 정합성 비교에 맞다 |
| 일일 호출 예산 **900회** | 승인 트래픽 서비스별 1,000회/일에서 여유 100회. **다른 서비스에는 자동 적용하지 않음**(서비스별 예산은 R04) |
| 서비스키는 URL 인코딩된 상태 그대로 주소에 붙임(이중 인코딩 방지), 로그·기록에 주소 대신 **키를 뺀 요청 요약**만 | 일반 방식으로 넘기면 인증 실패. SEC-10 |
| 날짜 `yyyyMMddHHmm`(KST)을 프로필의 `parseDate`로 직접 해석 | 응답을 ISO로 바꿔 저장하면 원본 값이 사라진다. 원본을 그대로 저장·표시 |
| 조회기가 응답에서 **7개 필드만** 저장(주소·이미지 등은 버림) | 개인정보·불필요 데이터 저장 금지(PRD 7-2). DB 제약도 같은 7개만 허용 |
| `pbctsn`(차수)은 명세상 필수지만 "필수로 가정하지 않음" | 명세 문구: 2026.1.1 이후 공고는 차수가 표시되지 않음. 근거 없이 예외를 늘리지 않는다(`CONDITIONALLY_ABSENT_FIELDS`) |

### C. R03 DB 설계
| 결정 | 이유 |
|---|---|
| 이상징후 동일성 키는 **기존 구조 그대로** `(source, item_key, rule_id)`. API 이상징후는 `item_key="SVC-API-001/getRlstCltrList"`, `rule_id="API_<코드>"` | 열린 건 중복 방지 제약·재발 연결·`record_detection`을 바꾸지 않고 PRD 4-6의 `api_id+operation_id+issue_code`를 만족. 별도 컬럼은 evidence에 `apiId`·`operationId`로 담음 |
| API 호출 결과(`probe_results`)와 데이터 품질 이상징후(`anomalies`)를 **다른 테이블**에 | PRD 4-6 "섞지 않는다" |
| 서비스 등록부는 **DB 테이블이 아니라 파일(JSON)** + Zod 검증 | 단일 출처. DB 테이블로 두면 JSON과 이중 관리. 판정 결과만 DB에 |
| **보존형** 마이그레이션: 새 칸은 모두 nullable, 이전 규칙 ID·행·권한 유지, 지우는 문장 없음(제약 재생성만) | PRD D-1. 드리프트 테스트가 "지우는 문장 없음"을 지킨다 |
| `settings` 14개 고정 항목은 그대로 두고 `empty_allowed_by_endpoint`에서 `public-*`만 뺌 | 서비스별 Probe·예산은 R04에서 등록부가 맡는다 |

### D. 운영·안전
| 결정 | 이유 |
|---|---|
| 이상징후 이력은 **지울 수 없음**(append-only) → `seed:sample`은 처음 한 번만, 시험이 만드는 실제 이상징후는 가짜로 대체 | 한 번 만들면 되돌릴 수 없어 시연 데이터 오염 방지. 점검 엔진 실제 DB 시험은 이상징후 등록을 흉내만 냄 |
| 실제 API 호출은 사용자가 승인한 횟수만(목록 1·상세 1), 직접 실행 명령(`test:public-live`)으로 넘김 | 외부 서비스 호출·쿼터 소모. 승인 범위를 넘지 않는다 |
| `DATA_GO_KR_SERVICE_KEY`는 Vercel에 Secret으로만 등록 | 2026-11-03 사용자가 승인 확인 후 등록(PRD 6-4). 값은 대시보드·pull로 볼 수 없음 |
| 삭제 대신 `trash-can/`으로 이동 | CLAUDE.md 규칙. `trash-can`은 타입 검사·린트·Git에서 제외 |

---

## 6. 수정한 파일 목록

`main` 대비 125개 파일(전체: `git diff --name-status main..HEAD`). 영역별 핵심만:

**문서·규칙**
- `PRD.md`(v2.0) · `docs/PRD_v1.md`(보관) · `docs/api-registry.md`(자동 생성) · `PLAN.md` · `DESIGN.md` · `CLAUDE.md` · `README.md` · `HANDOFF.md`(이 문서)

**DB (`supabase/`)** — 마이그레이션 7개(이 구간) + pgTAP 6개
- `migrations/20261029020000_create_start_check_run.sql` · `…030000_create_record_detection.sql` · `…040000_create_assign_anomaly.sql` · `…040100_create_status_functions.sql` · `…050000_allow_public_fields_and_settings.sql` · `…060000_create_probe_results.sql` · `…060100_fix_probe_results_reason_check.sql`
- `tests/database/00_rls_guard`(테이블 10개로) · `04_start_check_run` · `05_record_detection` · `06_anomaly_user_functions` · `07_public_fields_and_settings` · `08_probe_results`

**점검 엔진·조회기·판정 (`lib/checks/`)**
- `run-check.ts`(엔진) · `types.ts` · `supabase-store.ts` · `evidence.ts` · `manual-check.ts` · `sample-plan.ts`
- `demo-fetcher.ts` · `public-fetcher.ts` · `public-response.ts`
- `probe/` : `classify.ts` · `readiness.ts` · `schema-check.ts` · `from-check.ts` · `status.ts`

**규칙·등록부·이상징후 도메인**
- `lib/rules/` : `field-profile.ts`(출처별 필드 프로필) · `iso-datetime.ts` · `date-order.ts` · `required-fields.ts` · `list-detail.ts` · `detect-item.ts`
- `lib/registry/` : `index.ts` · `schema.ts` + `data/registry/api-registry.json`
- `lib/anomalies/` : `labels.ts`(규칙 ID 15개·표시 이름) · `rpc.ts` · `list-query.ts` · `event-view.ts` · `action-input.ts` · `reason-length.ts` · `queries.ts`
- `lib/dashboard/` · `lib/reports/` · `lib/settings/schema.ts`

**화면 (`app/(app)/`, `components/`)**
- `app/(app)/page.tsx`(대시보드) · `anomalies/`(목록·상세·처리 액션) · `runs/`(점검 이력·수동 점검) · `reports/`(보고서)
- `components/anomalies/` · `components/dashboard/` · `components/runs/` · `components/reports/` · `components/ui/badges.tsx`

**스크립트 (`scripts/`)**
- `build-api-registry.py`(등록부 생성, Python) · `seed-sample-ops.mjs` · `test-engine-live.mjs` · `test-public-live.mjs` · `check-db.mjs` · `db-checks/` (`check-runs`·`collected-items`·`reports`·`settings`·`probe-results`)

**테스트 (`tests/`)**
- 단위 테스트는 전체 30개 파일(이 구간에서 새로 만들거나 고친 것 25개: `probe-*`·`public-*`·`api-registry`·`rule-id-drift`·`supabase-store`·`run-check`·`field-profile` 등) · 화면 스펙은 전체 7개 파일(이 구간 5개: `anomalies`·`anomaly-actions`·`dashboard`·`reports`·`runs`, 기존 `login`·`frame`)

**설정**: `package.json`(명령 추가: `test:engine-live`·`test:public-live`·`seed:sample`)

**커밋하지 않은 것(의도적):** `.claude/`(도구가 만든 폴더), `docs/온비드 OPEN API.md`(사용자 자료, 내 PC 경로 포함).

---

## 7. 열린 질문 (사용자 결정 대기)

1. **26번째 서비스는 무엇인가?** 확정되면 `python scripts/build-api-registry.py "<명세서 폴더>"`로 등록부를 갱신.
2. **기관 보안·클라우드 이용 승인**을 받았는가? (받기 전에는 PUBLIC 키를 Vercel에 등록하지 않음)
3. **재배포 시점**(§0). 병합 시점("병합해줘")과 순서(쌓인 브랜치 8개).
4. **Supabase 공개 회원가입 끄기** — 대시보드에서 사용자가 직접. `npm run check:accounts`가 켜져 있으면 "주의"로 알려 준다. 배포 주소가 공개이므로 우선순위 높음.
5. API 이상징후(`API_*`)를 **언제 생성할지**(R04에서 제안·확정).

---

## 8. 자주 쓰는 명령·상태 확인

```bash
npm run lint && npx tsc --noEmit && npm run test:unit      # 빠른 점검 (단위 562개)
npm run build
npm run test:db                                           # pgTAP 431개 (Docker Desktop 필요)
npm run check:db                                          # DB 구조 전체 확인
npm run test:engine-live                                  # 실제 DB에 엔진·저장소 확인 (끝나면 자기 기록 삭제)
npm run test:public-live                                  # ⚠ 실제 온비드 API 2번 호출 (쿼터 사용)
npm run test:e2e                                          # 화면 자동 테스트 (로그인 ~20회, 5분 안에 두 번 돌리지 말 것)
npm run db:push -- --dry-run   →  npm run db:push         # 새 마이그레이션 반영 (⚠ 배포와 같은 DB에 즉시 적용)
```

**재배포(사용자가 요청할 때만):** `.env`의 `VERCEL_TOKEN`을 환경변수로 넘겨 `npx vercel deploy --prod --yes`. 앱용 환경변수는 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`·`SUPABASE_SECRET_KEY` 3개만 등록돼 있다. 푸시는 `GITHUB_TOKEN`을 환경변수로 넘겨 일회성 URL로(명령·출력에 토큰을 남기지 말 것).

**인증:** 토큰·비밀번호는 `.env`에서 읽어 쓰고 **출력하지 않는다.** 시연 계정 비밀번호도 Playwright 입력창에만 넣는다.

---

## 9. 주의할 점 (실패했던 방법 포함)

### 도구·셸
- **Bash 도구의 heredoc에 따옴표(`'`)가 많이 섞인 파이썬/긴 텍스트를 넣으면 `unexpected EOF while looking for matching`으로 통째로 실패**한다. 파일은 **Write/Edit 도구**로 만들고, 치환이 필요하면 짧은 파이썬 스크립트를 파일로 쓰거나 Edit을 쓴다. (이번 작업에서 세 번 겪음)
- **내가 쓴 임시 파이썬 치환 도우미가 `open(path, "w")`를 먼저 실행한 뒤 치환을 계산**해서, 치환 중 오류가 나면 **파일이 0바이트로 비워진다.** 새 파일 `rule-id-drift.test.ts`가 한 번 날아갔다(다시 만듦). 반드시 **먼저 계산하고 성공했을 때만 파일을 연다.** 의심되면 `git ls-files -m -o --exclude-standard | while read f; do [ ! -s "$f" ] && echo EMPTY $f; done`.
- Windows: PowerShell 5.1과 Git Bash가 섞여 있다. 줄바꿈은 CRLF 경고(`LF will be replaced by CRLF`)가 뜨지만 무시해도 된다. 한글 경로(`C:\Users\정민철`) 때문에 일부 출력이 깨질 수 있다.

### 테스트·환경
- **개발 서버 충돌:** 다른 세션이 이 폴더에서 `next dev`를 3000번으로 띄워 두면 `npm run test:e2e`의 자동 서버(3100번)가 "Another next dev server is already running"으로 시작하지 못한다. 임시 설정 파일(`webServer: undefined`, `baseURL` 변경)로 기존 서버에 붙여 돌렸고 끝나면 `trash-can/`으로 옮겼다. 그 서버가 죽어 있으면 정상적으로 `npm run test:e2e`가 동작한다.
- **Supabase 로그인 제한:** 5분에 약 30회. e2e를 연달아 돌리면 로그인이 막힌다(스펙 단위로 나눠 실행).
- **로컬 시계 ≠ DB 시계:** 이 PC가 DB보다 ~0.5초 느렸다. 점검 `finished_at`을 이 PC 시계로 찍으면 `finished_at < started_at` 제약에 걸려 마감 실패 → 점검이 `running`으로 남아 **다음 점검을 막는다.** `finishRun`이 시작 시각 +1ms 이상으로 보정하도록 고쳤다(마이크로초 잘림까지 고려). 새 시간 계산을 추가할 때 같은 함정을 조심.
- **SQL `CHECK (reason in (...))`는 `reason`이 NULL이면 통과한다**(NULL은 거짓이 아니라 "알 수 없음"). 그래서 `FAIL`을 사유 없이 저장할 수 있었고 pgTAP이 잡았다. `reason is not null and reason in (...)`로 고침. **이미 적용한 마이그레이션 파일은 고치지 않고** 새 마이그레이션(`…060100`)으로 고쳤다. 새 CHECK를 쓸 때 NULL 경우를 꼭 시험할 것.
- **마이그레이션은 되돌릴 수 없다고 가정:** `db:push`는 배포와 같은 원격 DB에 즉시 적용된다. 항상 `--dry-run` 먼저. 이상징후 이력(anomaly_events)·보고서(reports)는 삭제 불가라 시험은 롤백되는 트랜잭션(pgTAP)이나 가짜 저장소로 한다.
- **PUBLIC 응답은 형태가 세 가지:** 정상 JSON(`header.resultCode`), 오류·무데이터 JSON(`result.resultCode`, 예: `03 NODATA_ERROR`), 관문의 **XML 오류**(`returnReasonCode`, 키 미등록 등, HTTP 200으로 옴). 정상 코드인데 항목이 0건이어도 무데이터로 본다. 항목이 1건이면 배열이 아니라 객체로 온다.
- 실제 응답 한 건의 입찰기간이 `2999-12-30`(상시 공고성)이었다 — 정상 값으로 처리됨. 표본이 작아 응답 구조 확인을 일반화하지 말 것.

### 보안·정보
- **인증키 노출 사고:** `D:\python\onbid_openapi\onbid_real_estate_list.py`에 **서비스키가 평문**으로 들어 있고, 키를 여러 줄로 쪼개 적어서 내 가림 처리가 놓쳐 **키 일부가 도구 출력에 한 번 보였다.** 값은 어떤 파일·문서·커밋에도 옮기지 않았다(검사 완료). 사용자에게 **재발급 권고**를 했다. 비슷한 외부 파일을 읽을 때는 `head`로 코드 앞부분을 통째로 보지 말고 필요한 줄만 grep.
- Vercel에는 서버 전용 키(`SUPABASE_SECRET_KEY`)를 "민감" 항목으로 등록했다. `OPENAI_API_KEY`·`GITHUB_TOKEN` 등 관리용 토큰은 절대 등록하지 않는다.
- 보고서 한 건(#329 등)과 이상징후 #795의 상태 변경 등 **시연 중 만든 데이터는 이력이라 지울 수 없다.**

### 코드 규칙(자주 어기기 쉬움)
- 설정값(타임아웃·호출 상한 등)은 코드에 숫자를 쓰지 말고 `Settings`로. (화면 문구에도 "20회·900회" 같은 숫자를 직접 쓰지 않았다)
- `new Date()`로 날짜를 직접 자르지 말고 `lib/time.ts`.
- 새 DB 테이블·함수는 pgTAP과 `scripts/db-checks/` 확인 파일을 함께. 새 규칙에는 한 칸 안·밖 경계 테스트.
- 탐지 결과는 "오류"가 아니라 **"이상징후"** 로 표현. LLM 사용 금지.
- 코드·DB 양쪽에 있는 목록(설정값 필드, 규칙 ID, 상태·사유)은 **드리프트 테스트**(`settings-drift`, `rule-id-drift`)가 어긋남을 잡는다. 한쪽만 고치지 말 것.
- 대시보드·보고서의 "규칙별 신규"가 `RULE_IDS`(이전 4개)만 순회한다 — 새 규칙 ID가 생겨도 R05 전까지는 안 보인다. 의도된 상태.

### 작업 방식(사용자 선호)
- 한 번에 한 작업만, 끝나면 **실행해 확인하는 방법**과 **다음 작업 1개 추천**을 알려 달라는 패턴이 반복된다.
- 선택지가 있으면 추천안을 먼저, 큰 결정은 구현 전에 보여 주기. 검증을 통과해야 커밋, 커밋 메시지는 한국어 한 줄 + `Co-Authored-By` 줄.
- 실제로 확인하지 않은 것은 "확인하지 못했다"고 정직하게 적는다(예: R02 이전의 응답 구조 가정은 실호출로 확인한 뒤에야 확정 표기).

---

## 10. 이어서 시작하는 방법 (새 세션용 체크리스트)

1. `git status`·`git branch --show-current`로 `feature/db-v2`인지 확인. `.claude/`와 `docs/온비드 OPEN API.md`는 미추적이 정상.
2. `npm run lint && npx tsc --noEmit && npm run test:unit` — 562 통과 / 6 건너뜀이 정상.
3. 이 문서 §0(배포 불일치)와 §7(열린 질문)을 사용자와 먼저 정리.
4. 새 브랜치를 `feature/db-v2`에서 파서 R04부터(예: `feature/batch-engine`). `main`에 병합은 사용자가 말할 때만.
