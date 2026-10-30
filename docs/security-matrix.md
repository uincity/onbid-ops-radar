# 보안 테스트 대응표 (SEC-01 ~ SEC-12)

PRD 7-5의 보안 테스트 12개가 **어떤 자동 시험으로 확인되는지**를 한곳에 모았다. 표의 파일은 `tests/unit/security-matrix.test.ts`가 실제로 있는지 확인한다.
새 보안 시험을 만들면 이 표에도 적는다. 한 줄이라도 시험이 없으면 "통과"라고 말하지 않는다.

| ID | 검증 항목 | 기대 결과 | 자동 시험 |
|---|---|---|---|
| SEC-01 | 비로그인 사용자의 보호된 화면·API 접근 | 거부 | `tests/e2e/login.spec.ts` |
| SEC-02 | operator의 타인 담당 건 상태변경 | 거부 | `supabase/tests/database/06_anomaly_user_functions.test.sql`, `tests/e2e/anomaly-actions.spec.ts` |
| SEC-03 | operator의 관리자 기능 실행 | 거부 | `tests/unit/manual-check.test.ts`, `tests/e2e/runs.spec.ts`, `tests/e2e/reports.spec.ts` |
| SEC-04 | Supabase 직접 접근으로 RLS 우회 시도 | 거부 | `supabase/tests/database/03_sec04_direct_access.test.sql`, `supabase/tests/database/00_rls_guard.test.sql` |
| SEC-05 | 감사이력 수정·삭제 시도 | 거부 | `supabase/tests/database/02_sec05_append_only.test.sql` |
| SEC-06 | 브라우저 코드 및 배포 산출물의 비밀키 노출 검사 | 노출 0건 | `tests/unit/security-scan.test.ts`, `scripts/test-deployed.mjs` |
| SEC-07 | operator의 admin 역할 변경 시도 | 거부 | `supabase/tests/database/01_sec07_role_protection.test.sql` |
| SEC-08 | 타인 담당 건 ID를 직접 입력한 무단 상태변경·판정·배정 | 거부 | `supabase/tests/database/06_anomaly_user_functions.test.sql` |
| SEC-09 | 인증 없는 예약 점검 API 호출 | 거부 | `tests/unit/cron-check.test.ts`, `tests/e2e/cron.spec.ts`, `scripts/test-deployed.mjs` |
| SEC-10 | API 원본·로그·보고서의 인증키·개인정보 검사 | 금지정보 0건 | `tests/unit/security-scan.test.ts`, `tests/unit/public-fetcher.test.ts`, `supabase/tests/database/08_probe_results.test.sql` |
| SEC-11 | 외부 API 오류 시 서버 내부정보 노출 검사 | 노출 0건 | `tests/unit/cron-check.test.ts`, `tests/unit/manual-check.test.ts`, `tests/unit/supabase-store.test.ts`, `tests/unit/settings-load.test.ts` |
| SEC-12 | 업무 데이터 변경과 감사이력의 트랜잭션 검증 | 함께 성공하거나 함께 롤백 | `supabase/tests/database/06_anomaly_user_functions.test.sql`, `supabase/tests/database/11_success_state_changes.test.sql` |

## 실행 방법

| 무엇을 | 명령 |
|---|---|
| SEC-06·10 비밀키·개인정보 검사, 이 표의 시험 파일 존재 확인 | `npm run test:unit` (빌드 뒤에 하면 `.next/static`도 검사한다) |
| SEC-02·04·05·07·08·12 DB 시험 | `npm run test:db` (Docker Desktop 필요) |
| SEC-01·03·09 화면·입구 시험 | `npm run test:e2e` |
| **배포한 사이트**의 SEC-01·06·09 재검증 | `npm run test:deployed -- --url https://배포주소` |
