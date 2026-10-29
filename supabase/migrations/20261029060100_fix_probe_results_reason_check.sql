-- R03 보완: probe_results 상태·사유 짝 검사가 "사유가 비어 있는 경우"를 막지 못하던 허점을 고친다.
-- 원인: SQL에서 `reason in ('A', 'B')`는 reason이 NULL이면 거짓이 아니라 NULL(알 수 없음)이 되고, CHECK 제약은 NULL을 통과시킨다.
--       그래서 FAIL·UNVERIFIED·NOT_RUN·DEGRADED를 사유 없이 저장할 수 있었다. (pgTAP 08_probe_results가 잡아냈다)
-- 앞 마이그레이션(20261029060000)은 이미 DB에 적용되어 고치지 않고, 이 파일에서 제약을 다시 만든다. 이 테이블은 아직 비어 있어 안전하다.
-- (같은 제약의 마지막 정의가 코드의 상태·사유 상수와 같은지 tests/unit/rule-id-drift.test.ts가 지킨다)

alter table public.probe_results drop constraint probe_results_status_reason_check;

alter table public.probe_results add constraint probe_results_status_reason_check
  check (
    (status in ('PASS_DATA', 'PASS_NO_DATA') and attempted and reason is null)
    or (status = 'DEGRADED' and attempted and reason is not null and reason in ('RETRIED_THEN_OK', 'FIELD_WARNING', 'SLOW_RESPONSE'))
    or (status = 'FAIL' and attempted and reason is not null and reason in ('HTTP_ERROR', 'TIMEOUT', 'BUSINESS_ERROR', 'SCHEMA_ERROR', 'POSITIVE_DATA_MISSING', 'AUTH_ERROR', 'QUOTA_EXCEEDED'))
    or (status = 'UNVERIFIED' and reason is not null and reason in ('NO_VALID_INPUT', 'APPROVAL_UNCONFIRMED', 'NOT_APPROVED', 'MISSING_DOC', 'PRECONDITION_FAILED', 'NO_DATA_UNCONFIRMED', 'EXPECTATION_MISMATCH'))
    or (status = 'NOT_RUN' and not attempted and reason is not null and reason in ('BUDGET_SKIP', 'SCHEDULE_MISSED', 'RUN_BLOCKED', 'NO_SCHEDULE', 'OPERATOR_STOPPED'))
  );
