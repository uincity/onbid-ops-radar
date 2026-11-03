# 설계 대비 구현 Gap 분석 (PLAN 38번)

- 기준: [PRD.md](../PRD.md) v2.0, [DESIGN.md](../DESIGN.md), 부록 E-3 (R01~R08)
- 분석일: 2026-11-03 · 브랜치 `feature/gap-analysis` · 기준 커밋: `29e9fdc` + 이 문서의 개선 2건
- 방법: 코드·테스트·마이그레이션을 직접 확인했다. PLAN.md의 "완료" 표시는 근거로 쓰지 않았다. 분석을 맡긴 에이전트 3개는 보고서를 내지 못해, 도메인 원칙 점검(§3)까지 모두 직접 검색으로 했다.
- 한계: 일치율은 **코드와 자동 시험 기준**이다. 실제 온비드 API로 확인한 것은 부동산 목록·상세 2개 오퍼레이션뿐이다.

## 1. 요약

| 판정 | 개수 |
|---|---|
| 구현됨 | 36 |
| 부분 구현 | 5 |
| 실환경 증거 필요 (코드는 있으나 운영 확인 안 됨) | 3 |
| 의도적 보류 | 2 |
| 미구현 | 0 |
| **전체** | **46** |

**일치율 = (구현됨 36 + 0.5 × 부분 구현 5) ÷ (전체 46 − 의도적 보류 2) = 38.5 ÷ 44 = 87.5%** (2026-11-03 보고서 절 보강 후. 보강 전 85.2%)

(실환경 증거 필요 3개는 분모에 넣고 점수는 주지 않았다.) 이번 분석 중 고친 2건(F1·F2)을 반영하기 전에는 83.0%였다. **90% 미만**이다.

남은 차이는 대부분 사용자 확인·승인이나 실제 환경이 있어야 메워진다(§4). 코드만으로 더 올릴 수 있는 것은 보고서의 품질·실행 품질 절(#36·37)이다.

## 2. 항목별 판정

### A. 가용성·점검·예약 (PRD 5-1, 5-2-1~5-2-5, 5-5, 3-1)

| # | 요구사항 | 판정 | 근거 |
|---|---|---|---|
| 1 | 서비스 등록부(25종·28개 오퍼레이션)를 파일로 관리하고 Zod로 검증 | 구현됨 | `data/registry/api-registry.json`, `lib/registry/schema.ts` |
| 2 | 26번째 서비스는 "미확정"으로 표시하고 분모에 넣지 않음 | 구현됨 | `lib/registry/index.ts`, `components/dashboard/availability-section.tsx` |
| 3 | 오퍼레이션별 승인·유효 입력값·무데이터 정책·쿼터 채우기 | 부분 구현 | 스키마는 있으나 값은 28개 중 승인 확인 2개뿐, 점검 방식·쿼터는 전부 비어 있음 |
| 4 | 점검 전 준비 상태 확인(승인 미확인·입력값 없음·선행 실패 → 검증 불가) | 구현됨 | `lib/checks/probe/readiness.ts` |
| 5 | 판정 상태 6종 분류 | 구현됨 | `lib/checks/probe/classify.ts`, `status.ts` |
| 6 | FAIL 세부 코드 7종 구분 | 구현됨 | `lib/checks/probe/status.ts` |
| 7 | 응답 구조(필수 항목·자료형) 확인 | 구현됨 | `lib/checks/probe/schema-check.ts` |
| 8 | PUBLIC 0건은 이상징후 없이 정상 무데이터 또는 검증 불가로 판정 | 구현됨 | `lib/checks/run-check.ts`, `tests/unit/run-check.test.ts` |
| 9 | 26종 각각 실제 요청 점검 | 부분 구현 | 조회기가 있는 것은 2개 오퍼레이션뿐. 나머지는 검증 불가로 기록 |
| 10 | 한 API의 실패·예외가 다른 API를 막지 않음 | 구현됨 | `lib/checks/run-check.ts` (FETCH_ERROR) |
| 11 | 서비스 단위 배치로 나눠 실행 | 부분 구현 | `lib/checks/batch-plan.ts`는 계획과 미점검 기록까지만, 서비스별로 따로 실행하는 배치 실행기는 없음 |
| 12 | 서비스별 호출 예산·초당 제한 | 의도적 보류 | 승인·쿼터가 확정된 뒤 도입(등록부 쿼터가 비어 있음). 현재는 일일 예산 900회 1개 |
| 13 | 오퍼레이션별 판정을 DB에 저장 | 구현됨 | `supabase/migrations/20261029060000_create_probe_results.sql`, pgTAP 08 |
| 14 | 같은 오퍼레이션 연속 FAIL N회 → API 상태 이상징후 | 구현됨 | `lib/checks/api-streak.ts`, 설정 `api_fail_streak_threshold` |
| 15 | 일일 호출 예산 적용 | 구현됨 | `lib/checks/run-check.ts` (publicDailyBudget) |
| 16 | 예약 점검 입구 + CRON_SECRET 인증 | 구현됨 | `app/api/cron/daily-check/route.ts`, `lib/schedule/cron-check.ts` |
| 17 | 09:30 예약 누락 감지 DB 함수 | 구현됨 | `20261029080000_create_mark_schedule_missed.sql`, pgTAP 10 |
| 18 | Supabase Cron 실제 등록 | 실환경 증거 필요 | `scripts/setup-cron.mjs`(기본 미리 보기)만 있고 등록은 하지 않음 |
| 19 | "실행됨"과 "완료됨" 분리(차단·일부 완료 경고) | 구현됨 | `lib/schedule/status.ts` |
| 20 | 동시 실행 차단 | 구현됨 | `start_check_run`, pgTAP 04 |
| 21 | 지표 4개(시도율·기본 정상 비율·실데이터 검증률·전체 목표 대비) | 구현됨 | `lib/availability/summary.ts` |
| 22 | 서비스 전체 점검 완료 시각과 API별 마지막 성공 시각 분리 | 구현됨 | `lib/availability/summary.ts` (checkedAt / lastOkAt) |
| 23 | 설정값을 한곳에서 관리하고 못 읽으면 멈춤 | 구현됨 | `lib/settings/schema.ts`, `load.ts`, drift 시험 |

### B. 품질 규칙·조치·보고서·화면 (PRD 5-2A, 5-2B, 5-3, 5-4, 5-6, 6-3)

| # | 요구사항 | 판정 | 근거 |
|---|---|---|---|
| 24 | DQ_SCHEMA | 구현됨 | `lib/rules/dq-rules.ts`, `tests/unit/dq-rules.test.ts` |
| 25 | DQ_REQUIRED (PUBLIC 필수정보) | 구현됨 | `lib/checks/run-check.ts` (asRule) |
| 26 | DQ_LIST_DETAIL_REF | 부분 구현 | 참조 불일치 판정은 있음. 상세 0건 재조회는 미구현(판정 보류 메모만) |
| 27 | DQ_CROSS_API_REF | 부분 구현 | 판정 함수만 있고, 연결해서 비교할 API 점검이 없어 적용 제외로 기록 |
| 28 | 품질 이상징후를 확인 전까지 "의심"으로 표시 | 구현됨 | `lib/anomalies/labels.ts` (이번 개선 F1), `lib/checks/dq-evidence.ts` |
| 29 | 중복 탐지·재발 연결·정상 판정 건 억제 | 구현됨 | `record_detection`, pgTAP 05 |
| 30 | 허용 상태 전이·종결 조건·재개 사유 | 구현됨 | `change_anomaly_status`, pgTAP 06 |
| 31 | 오래된 화면 대응(버전 충돌) | 구현됨 | pgTAP 06 |
| 32 | 감사이력 추가 전용(수정·삭제 거부) | 구현됨 | pgTAP 02 |
| 33 | 권한을 서버·RLS에서 검증 | 구현됨 | pgTAP 00·03·06 |
| 34 | 일일 보고서: DB 집계·60초·스냅샷·Markdown | 구현됨 | `lib/reports/*`, `npm run test:success`(10회 통과) |
| 35 | 보고서의 26종 가용성 절 | 구현됨 | `lib/reports/markdown.ts` (7절) |
| 36 | 보고서의 데이터 품질 절(적용 대상 수, 규칙별 실행·보류·제외 건수) | 구현됨 | `lib/reports/quality.ts`, 보고서 8절(Markdown·미리보기), `tests/unit/report-quality.test.ts` |
| 37 | 보고서의 실행 품질(예정 점검 시작 여부, 차단·부분 완료 사유) | 구현됨 | 보고서 실행 품질 절(예약 점검 시작·완료 상태, 마지막 완료 시각). 차단·부분 완료 횟수와 사유는 2절·6절 |
| 38 | 최초 탐지가 오래된 미처리 최대 10건 | 구현됨 | `lib/reports/model.ts` (이번 개선 F2) |
| 39 | 대시보드: 6종 상태·예약 상태·출처 구분·규칙 15개 | 구현됨 | `components/dashboard/*`, e2e `dashboard.spec.ts` |
| 40 | 비범위 기능(금액 이상 탐지·외부 알림·LLM·회원가입 화면)을 만들지 않음 | 구현됨 | §3 검색 결과 |

### C. 보안·성공 기준·배포 (PRD 7-5, 3-1, 6-4)

| # | 요구사항 | 판정 | 근거 |
|---|---|---|---|
| 41 | SEC-01~12 자동 시험 | 구현됨 | `docs/security-matrix.md`, `tests/unit/security-*.test.ts`, pgTAP |
| 42 | 배포 후 보안 재검증 | 구현됨 | `npm run test:deployed`(13개 통과), 배포 주소 e2e 통과 |
| 43 | Supabase 공개 회원가입 꺼 두기 | 실환경 증거 필요 | 대시보드 설정이라 코드로 확인 불가(`check:accounts`가 켜져 있으면 경고) |
| 44 | PUBLIC 실호출 증거 | 실환경 증거 필요 | 목록 1회·상세 1회뿐. 나머지 26개 오퍼레이션은 호출한 적 없음 |
| 45 | 기관 보안·클라우드 이용 승인 확인(PRD 6-4) | 의도적 보류 | 사용자 확인 사항. 확인 전에는 PUBLIC 키를 Vercel에 등록하지 않음 |
| 46 | 성공 기준: DEMO 160건 · 상태 변경 20건·이력 누락 0 · 보고서 10회 60초 | 구현됨 | `run-check.test.ts`, pgTAP 11, `test:success` |

## 3. 도메인 원칙 점검 (직접 검색)

| 원칙 | 결과 |
|---|---|
| 탐지 결과를 "오류"가 아니라 "이상징후"로 표현 | 위반 없음. 화면의 "오류"는 "HTTP 오류"와 시스템 오류 안내에만 쓰임 |
| DEMO와 PUBLIC 합산 금지 | 가용성 집계는 PUBLIC만 읽음. 이상징후 집계는 출처별로 나눔 |
| 검증 불가·미점검을 정상·실패로 세지 않음 | 집계 함수와 화면 문구가 지킴 |
| 서버 전체 가용성처럼 표현 금지 | 위반 없음. 해당 표현은 모두 "아니다"라는 부정 문구 |
| 설정 숫자를 코드에 흩어 두지 않음 | 낮은 심각도 2건: ① `app/(app)/reports/actions.ts` 보고서 60초(PRD 3-1 보고서 기준이라 정당) ② `lib/checks/sample-plan.ts` 10초(시연 데이터용) |
| KST 날짜 계산은 `lib/time.ts` | 날짜 자르기는 `lib/time.ts` 안에서만 함 |
| LLM·비범위 기능 없음 | 코드에 없음 |
| `'use client'` 파일이 서버 전용 모듈·비밀을 쓰지 않음 | `security-scan.test.ts`가 확인 |

## 4. 상위 Gap과 개선 방향

| 순위 | 심각도 | Gap | 고치려면 |
|---|---|---|---|
| 1 | 높음 | 26종 중 실제 점검은 2개 오퍼레이션뿐(#3·9·11·44) | 승인 상태·쿼터·유효 입력값을 사용자가 확인해 등록부에 채우고, 오퍼레이션별 조회기와 배치 실행기를 추가 |
| 2 | 중간 | 보고서의 품질 절·실행 품질 절이 PRD 필수 지표에 못 미침(#36·37) | 규칙별 실행·보류·제외 건수와 예약 시작 여부를 집계해 보고서에 추가(코드만으로 가능) |
| 3 | 중간 | DQ_LIST_DETAIL_REF 재조회·DQ_CROSS_API_REF 적용 대상 없음(#26·27) | 상세 0건 재조회(호출 예산 설계 필요), 공고·입찰결과 API 점검이 생기면 교차 참조 적용 |
| 4 | 중간 | 예약 점검 Cron 미등록(#18) | Vercel `CRON_SECRET` 확인 후 `npm run setup:cron -- --app-url … --apply` (사용자 실행) |
| 5 | 중간 | 공개 회원가입 설정 미확인(#43) | Supabase 대시보드에서 끄고 `npm run check:accounts` 확인 |
| 6 | 낮음 | 서비스별 예산·초당 제한 없음(#12) | 쿼터 확정 후 등록부 `quota`로 도입 |

## 5. 이번 분석 중 고친 것

- **F1 (#28):** 품질 규칙 4개의 표시 이름에 "(의심)"을 붙였다(`lib/anomalies/labels.ts`).
- **F2 (#38):** 보고서의 미처리 목록 상한을 50건에서 10건으로 바꿨다(`lib/reports/model.ts`). 경계 시험도 10 기준으로 고쳤다.

## 6. 90% 도달 조건

위 F1·F2 후 85.2%다. #36·37(보고서 절 보강)을 구현하면 87.5%, 여기에 #3·9·11(등록부 채움과 배치 실행기)까지 끝내면 90%를 넘는다. 이 마지막 묶음은 사용자 확인(승인·쿼터)과 실제 API 호출이 필요하다.
