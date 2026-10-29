-- R03: 점검 상태 판정(PASS_DATA 등 6종)의 저장 구조 + API·품질 규칙 ID 확장 (보존형 마이그레이션)
-- Design Ref: PRD v2.0 5-2-2 7단계(기록), 5-2-3(판정 상태), 4-6(공통 원칙), 부록 D·D-1(보존·이관 정책), 부록 E-3 R03
--
-- 원칙 (PRD D-1): 기존 테이블·행·감사 이벤트·보고서·권한을 삭제하거나 초기화하지 않는다.
--   - 새 칸은 모두 비워 둘 수 있게(nullable) 추가한다. 이전 행은 그대로 통과한다.
--   - 이전 규칙 ID(DATE_ORDER·REQUIRED_FIELD·LIST_DETAIL_MISMATCH·EMPTY_RESULT)와 그 기록은 그대로 둔다. 새 ID만 더한다.
--
-- 바꾸는 것 네 가지
--   1) api_checks      : "호출 1번"의 기록에 어떤 API·오퍼레이션이었는지(api_id·operation_id), 업무 결과코드, 마스킹한 요청 요약을 더한다.
--   2) probe_results   : (새 테이블) 한 번의 점검에서 오퍼레이션마다 "판정 1줄" — 상태 6종과 세부 사유. API 호출 결과와 데이터 품질 이상징후를 섞지 않는다.
--   3) anomalies       : 허용하는 규칙 ID에 데이터 품질 4개(DQ_*)와 API 상태 7개(API_*)를 더한다.
--                        동일성 키는 기존 구조 그대로다: (출처, 대상 식별값 item_key, 규칙 rule_id).
--                          · 데이터 이상징후: item_key = 업무 식별값(물건관리번호 등), rule_id = DQ_* (또는 이전 규칙)
--                          · API 이상징후   : item_key = "서비스ID/오퍼레이션ID", rule_id = API_<세부 오류 코드>
--                        이렇게 하면 중복 방지 제약·재발 연결·record_detection 함수를 바꾸지 않고도 PRD 4-6의
--                        "api_id + operation_id + issue_code"를 지킨다. api_id·operation_id는 evidence에 함께 담는다.
--   4) settings        : 빈 결과 허용 여부 설정에서 PUBLIC 항목(public-*)을 뺀다. PUBLIC의 0건은 더 이상 이상징후 규칙이 아니라
--                        점검 판정(PASS_NO_DATA·UNVERIFIED)으로만 남는다 (PRD 5-2-3, R02). 코드 기본값도 같이 고쳤다.

-- ---------------------------------------------------------------------------
-- 1. api_checks: 어떤 API 오퍼레이션을 호출한 기록인지
-- ---------------------------------------------------------------------------
alter table public.api_checks
  add column api_id          text,
  add column operation_id    text,
  add column result_code     text,
  add column request_summary text;

alter table public.api_checks
  add constraint api_checks_api_id_check
    check (api_id is null or api_id ~ '^SVC-API-[0-9]{3}$'),
  add constraint api_checks_operation_id_check
    check (operation_id is null or operation_id ~ '^[A-Za-z][A-Za-z0-9]{1,59}$'),
  -- 둘 중 하나만 있는 줄은 만들지 않는다
  add constraint api_checks_api_operation_pair_check
    check ((api_id is null) = (operation_id is null)),
  -- 응답 본문의 업무 결과코드 (00 정상, 03 데이터없음, 22 호출 한도 초과 …)
  add constraint api_checks_result_code_check
    check (result_code is null or result_code ~ '^[A-Za-z0-9_]{1,20}$'),
  -- 요청 요약은 인증키를 뺀 조건만 담는다. 키가 섞이면 저장을 거부한다 (PRD 7-3 규칙 6·7, SEC-10)
  add constraint api_checks_request_summary_check
    check (request_summary is null or (char_length(request_summary) <= 500 and request_summary !~* 'servicekey'));

comment on column public.api_checks.api_id is '서비스ID(SVC-API-NNN). 서비스 등록부(data/registry)와 연결된다. 이전 기록은 비어 있다.';
comment on column public.api_checks.operation_id is '오퍼레이션 ID(예: getRlstCltrList). 이전 기록은 비어 있다.';
comment on column public.api_checks.result_code is '응답 본문의 업무 결과코드. HTTP 상태와 별도로 기록한다(PRD 5-2 규칙 4).';
comment on column public.api_checks.request_summary is '마스킹된 요청 요약(인증키 제외). 어떤 조건으로 호출했는지 재현할 때 쓴다.';

create index api_checks_operation_idx on public.api_checks (api_id, operation_id, checked_at desc) where api_id is not null;

-- ---------------------------------------------------------------------------
-- 2. probe_results: 오퍼레이션별 점검 판정 (한 점검에서 오퍼레이션마다 1줄)
-- ---------------------------------------------------------------------------
create table public.probe_results (
  id              bigint generated always as identity primary key,
  run_id          bigint      not null,
  -- 출처는 점검 실행의 출처와 항상 같아야 한다 (DEMO/PUBLIC 섞임 방지, collected_items와 같은 방식)
  source          text        not null,
  api_id          text        not null,
  operation_id    text        not null,
  -- PASS_DATA 정상(실데이터) / PASS_NO_DATA 정상(무데이터) / DEGRADED 주의 / FAIL 실패 / UNVERIFIED 검증 불가 / NOT_RUN 미점검
  status          text        not null,
  -- 요청을 실제로 보냈는가. UNVERIFIED·NOT_RUN은 "보내지 않았다"가 흔하다
  attempted       boolean     not null,
  -- 세부 사유: FAIL 코드 · UNVERIFIED 사유 · NOT_RUN 사유 · DEGRADED 사유. PASS는 비어 있다
  reason          text,
  -- DEGRADED일 때만: 데이터가 있었는지
  had_data        boolean,
  result_code     text,
  http_status     integer,
  duration_ms     integer,
  record_count    integer,
  -- 응답 구조 확인 요약 {checked, ok, inspected, warnings, problems:[{field,count}]}. 응답 본문은 저장하지 않는다
  schema_summary  jsonb,
  -- 판정 규칙의 버전. 규칙이 바뀌면 올려서 이전 판정과 구분한다
  probe_version   integer     not null default 1,
  request_summary text,
  checked_at      timestamptz not null default now(),

  constraint probe_results_run_source_fkey
    foreign key (run_id, source) references public.check_runs (id, source),
  constraint probe_results_source_check
    check (source in ('DEMO', 'PUBLIC')),
  constraint probe_results_api_id_check
    check (api_id ~ '^SVC-API-[0-9]{3}$'),
  constraint probe_results_operation_id_check
    check (operation_id ~ '^[A-Za-z][A-Za-z0-9]{1,59}$'),
  constraint probe_results_status_check
    check (status in ('PASS_DATA', 'PASS_NO_DATA', 'DEGRADED', 'FAIL', 'UNVERIFIED', 'NOT_RUN')),
  -- 상태와 사유·요청 여부의 짝 (PRD 5-2-3): 맞지 않는 조합은 저장할 수 없다
  constraint probe_results_status_reason_check
    check (
      (status in ('PASS_DATA', 'PASS_NO_DATA') and attempted and reason is null)
      or (status = 'DEGRADED' and attempted and reason in ('RETRIED_THEN_OK', 'FIELD_WARNING', 'SLOW_RESPONSE'))
      or (status = 'FAIL' and attempted and reason in ('HTTP_ERROR', 'TIMEOUT', 'BUSINESS_ERROR', 'SCHEMA_ERROR', 'POSITIVE_DATA_MISSING', 'AUTH_ERROR', 'QUOTA_EXCEEDED'))
      or (status = 'UNVERIFIED' and reason in ('NO_VALID_INPUT', 'APPROVAL_UNCONFIRMED', 'NOT_APPROVED', 'MISSING_DOC', 'PRECONDITION_FAILED', 'NO_DATA_UNCONFIRMED', 'EXPECTATION_MISMATCH'))
      or (status = 'NOT_RUN' and not attempted and reason in ('BUDGET_SKIP', 'SCHEDULE_MISSED', 'RUN_BLOCKED', 'NO_SCHEDULE', 'OPERATOR_STOPPED'))
    ),
  constraint probe_results_had_data_check
    check ((status = 'DEGRADED') = (had_data is not null)),
  constraint probe_results_result_code_check
    check (result_code is null or result_code ~ '^[A-Za-z0-9_]{1,20}$'),
  constraint probe_results_http_status_check
    check (http_status is null or http_status between 100 and 599),
  constraint probe_results_duration_check
    check (duration_ms is null or duration_ms >= 0),
  constraint probe_results_record_count_check
    check (record_count is null or record_count >= 0),
  constraint probe_results_schema_summary_check
    check (schema_summary is null or (jsonb_typeof(schema_summary) = 'object' and octet_length(schema_summary::text) <= 2000)),
  constraint probe_results_probe_version_check
    check (probe_version >= 1),
  constraint probe_results_request_summary_check
    check (request_summary is null or (char_length(request_summary) <= 500 and request_summary !~* 'servicekey')),
  -- 한 번의 점검에서 같은 오퍼레이션의 판정은 1줄만
  constraint probe_results_run_operation_key
    unique (run_id, api_id, operation_id)
);

comment on table public.probe_results is '오퍼레이션별 점검 판정(상태 6종과 세부 사유). 쓰기는 서버 점검 엔진만 한다. 우리 점검 요청에 관측된 결과이며 서버 전체의 가용성이 아니다.';
comment on column public.probe_results.status is 'PASS_DATA/PASS_NO_DATA/DEGRADED/FAIL/UNVERIFIED/NOT_RUN. UNVERIFIED·NOT_RUN은 정상으로도 실패로도 세지 않는다.';
comment on column public.probe_results.reason is '세부 사유(FAIL 코드·UNVERIFIED 사유·NOT_RUN 사유·DEGRADED 사유). 상태와 짝이 맞아야 한다.';

create index probe_results_run_id_idx on public.probe_results (run_id);
-- "서비스별 최근 결과·마지막 실데이터 성공" 조회용
create index probe_results_operation_idx on public.probe_results (api_id, operation_id, checked_at desc);

-- 출입 규칙 (RLS): "로그인 사용자 읽기, 쓰기는 서버만" — check_runs·api_checks와 같다 (DESIGN 6.4)
alter table public.probe_results enable row level security;
revoke all on public.probe_results from anon, authenticated;
grant select on public.probe_results to authenticated;

create policy "로그인 사용자는 probe_results를 읽을 수 있다"
  on public.probe_results for select to authenticated using (true);

-- insert / update / delete 정책은 일부러 만들지 않는다 → 쓰기는 RLS를 건너뛰는 서버 관리용 키(점검 엔진)만 한다.

-- ---------------------------------------------------------------------------
-- 3. anomalies: 허용 규칙 ID 확장 (이전 4개 + 데이터 품질 4개 + API 상태 7개)
-- ---------------------------------------------------------------------------
alter table public.anomalies drop constraint anomalies_rule_id_check;

alter table public.anomalies add constraint anomalies_rule_id_check
  check (rule_id in (
    -- 이전 규칙 (기존 기록·DEMO 회귀 테스트 보존)
    'DATE_ORDER', 'REQUIRED_FIELD', 'LIST_DETAIL_MISMATCH', 'EMPTY_RESULT',
    -- 데이터 품질 핵심 4규칙 (PRD 5-2A)
    'DQ_SCHEMA', 'DQ_REQUIRED', 'DQ_LIST_DETAIL_REF', 'DQ_CROSS_API_REF',
    -- API 상태 이상징후: 점검 판정 FAIL의 세부 오류 코드별 (PRD 4-6, 5-2-3)
    'API_HTTP_ERROR', 'API_TIMEOUT', 'API_BUSINESS_ERROR', 'API_SCHEMA_ERROR', 'API_POSITIVE_DATA_MISSING', 'API_AUTH_ERROR', 'API_QUOTA_EXCEEDED'
  ));

comment on column public.anomalies.item_key is '대상 식별값. 데이터 이상징후는 업무 식별값(물건관리번호 등), API 상태 이상징후(API_*)는 "서비스ID/오퍼레이션ID".';

-- ---------------------------------------------------------------------------
-- 4. settings: PUBLIC 빈 결과 허용 설정 정리 (DEMO 항목만 남긴다)
-- ---------------------------------------------------------------------------
update public.settings set value = '{"demo-list": false, "demo-detail": false}'::jsonb
 where key = 'empty_allowed_by_endpoint';
