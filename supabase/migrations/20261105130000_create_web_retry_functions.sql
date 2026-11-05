-- 홈페이지 가용성 모니터링 W11: 확인 재시도·정시 대체 실행 대기 줄(web_retry_queue)의 수명주기 DB 함수와 매분 확인 함수
-- Design Ref: docs/design-homepage-monitoring.md §5.2·§6.3 / Plan W11
--
-- 대기 줄 상태: pending(예약) → claimed(처리 선점) → done 또는 cancelled.  종류: confirm(일시 실패 확인 재시도), replace(정시 점검 대체 실행; 줄은 start_web_check_run이 만든다)
-- 만드는 함수 (모두 서버 관리용 키(service_role)만 실행, 소유자 권한, 빈 search_path):
--   enqueue_web_confirm(대상, 원래 정시 실행, 대기 초)  : 확인 재시도 예약. 대상에 이미 대기/처리 중 줄이 있으면 만들지 않고 null
--   web_retry_housekeeping()                           : 멈춘 처리 중 줄 되돌리기(최대 3번, 그 뒤 취소), 만료(다음 정시 점검이 시작된 confirm 줄·원래 실행이 없는 줄) 취소
--   claim_due_web_retry()                              : 정리 후, 예정 시각이 지난 가장 오래된 대기 줄 1개를 한 문장으로 잠가(for update skip locked) 처리 중으로 바꿔 돌려줌
--   finish_web_retry(줄, 결과)                          : done / cancelled / retry(1분 뒤 다시; 3번째 시도 뒤에는 취소)
--   web_enqueue_due_retries()                          : pg_cron이 매분 부른다. 예정된 줄이 있을 때만 앱(/api/cron/web-retry)을 pg_net으로 부른다
-- 이 파일이 만들지 않는 것(뒤 작업): 미발송 알림 회수 조건(W12에서 web_enqueue_due_retries에 더한다)

-- ===========================================================================
-- A. enqueue_web_confirm
-- ===========================================================================
create or replace function public.enqueue_web_confirm(
  p_target        text,
  p_origin_run_id bigint,
  p_delay_sec     integer
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run record;
  v_id  bigint;
begin
  if p_delay_sec is null or p_delay_sec < 0 or p_delay_sec > 3600 then
    raise exception '대기 시간은 0~3600초여야 합니다' using errcode = '22023';
  end if;

  select r.target_key, r."trigger", r.status into v_run from public.web_check_runs r where r.id = p_origin_run_id;
  if not found or v_run.target_key is distinct from p_target then
    raise exception '원래 점검 실행을 찾을 수 없거나 대상이 다릅니다' using errcode = 'P0002';
  end if;
  -- 확인 재시도는 정상 종료된 정시 실행에만 붙는다
  if v_run."trigger" <> 'scheduled' or v_run.status not in ('succeeded', 'partial') then
    raise exception '정상 종료된 정시 실행만 확인 재시도를 예약할 수 있습니다' using errcode = 'integrity_constraint_violation';
  end if;

  -- 대상별 대기/처리 중 줄은 하나뿐이다(부분 유니크). 이미 있으면 새로 만들지 않는다
  insert into public.web_retry_queue (target_key, kind, origin_run_id, due_at)
  values (p_target, 'confirm', p_origin_run_id, now() + make_interval(secs => p_delay_sec))
  on conflict (target_key) where status in ('pending', 'claimed') do nothing
  returning id into v_id;

  return v_id; -- 만들지 못했으면 null
end;
$$;

comment on function public.enqueue_web_confirm(text, bigint, integer) is
  '확인 재시도 예약. 대상에 대기/처리 중 줄이 이미 있으면 null. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- B. web_retry_housekeeping : 멈춘 줄 정리와 만료
-- ===========================================================================
create or replace function public.web_retry_housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 멈춘 처리 중 줄(앱이 죽음): 5분 넘게 끝나지 않았으면 대기로 되돌린다(최대 3번 시도, 그 뒤 취소)
  update public.web_retry_queue
     set status = 'pending', claimed_at = null, due_at = now()
   where status = 'claimed' and claimed_at < now() - interval '5 minutes' and attempts < 3;
  update public.web_retry_queue
     set status = 'cancelled', processed_at = now()
   where status = 'claimed' and claimed_at < now() - interval '5 minutes' and attempts >= 3;

  -- 만료: 원래 정시 실행이 지워졌거나, 그 뒤 다음 정시 점검이 시작되었으면 오래된 확인 재시도는 하지 않는다
  update public.web_retry_queue q
     set status = 'cancelled', processed_at = now()
   where q.status = 'pending' and q.kind = 'confirm'
     and (
       q.origin_run_id is null
       or exists (
         select 1
           from public.web_check_runs o
           join public.web_check_runs n
             on n.target_key = q.target_key and n."trigger" = 'scheduled' and n.status <> 'blocked' and n.started_at > o.started_at
          where o.id = q.origin_run_id
       )
     );
end;
$$;

comment on function public.web_retry_housekeeping() is
  '대기 줄 정리: 멈춘 처리 중 줄 되돌리기(최대 3번), 만료된 확인 재시도 취소. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- C. claim_due_web_retry : 원자적 선점
-- ===========================================================================
create or replace function public.claim_due_web_retry()
returns table (out_id bigint, out_target_key text, out_kind text, out_origin_run_id bigint, out_attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.web_retry_housekeeping();

  -- 한 문장으로 가장 오래된 예정 줄을 잠그고(다른 호출이 잡은 줄은 건너뜀) 처리 중으로 바꾼다
  return query
    with c as (
      select q.id from public.web_retry_queue q
       where q.status = 'pending' and q.due_at <= now()
       order by q.due_at, q.id
       limit 1
       for update skip locked
    )
    update public.web_retry_queue q
       set status = 'claimed', claimed_at = now(), attempts = q.attempts + 1
      from c
     where q.id = c.id
    returning q.id, q.target_key, q.kind, q.origin_run_id, q.attempts;
end;
$$;

comment on function public.claim_due_web_retry() is
  '정리 후 예정 시각이 지난 가장 오래된 대기 줄 1개를 원자적으로 선점해 돌려준다(없으면 0줄). 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- D. finish_web_retry : 처리 결과 기록
-- ===========================================================================
create or replace function public.finish_web_retry(
  p_id      bigint,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_rows     integer;
begin
  if p_outcome not in ('done', 'cancelled', 'retry') then
    raise exception '결과는 done, cancelled, retry 중 하나여야 합니다' using errcode = '22023';
  end if;

  select q.attempts into v_attempts from public.web_retry_queue q where q.id = p_id and q.status = 'claimed';
  if not found then
    return false; -- 처리 중인 줄이 아니다(정리로 이미 되돌려졌거나 끝남)
  end if;

  if p_outcome = 'retry' and v_attempts < 3 then
    -- 다른 실행 때문에 막혔거나 일시 오류: 다음 분에 다시 시도한다
    update public.web_retry_queue
       set status = 'pending', claimed_at = null, due_at = now() + interval '1 minute'
     where id = p_id and status = 'claimed';
  else
    update public.web_retry_queue
       set status = case when p_outcome = 'done' then 'done' else 'cancelled' end, processed_at = now()
     where id = p_id and status = 'claimed';
  end if;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.finish_web_retry(bigint, text) is
  '처리 결과 기록: done / cancelled / retry(1분 뒤 다시, 3번째 시도 뒤에는 취소). 처리 중인 줄만 바꾸며 바꿨으면 true. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- E. web_enqueue_due_retries : 매분 확인 (예정된 줄이 있을 때만 앱 호출)
-- ===========================================================================
create or replace function public.web_enqueue_due_retries()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_due     boolean;
  v_id      bigint;
begin
  -- 점검을 끄면 재시도도 멈춘다 (설정이 없거나 읽을 수 없으면 아무것도 하지 않는다)
  select (s.value #>> '{}')::boolean into v_enabled from public.web_settings s where s.key = 'web_monitor_enabled';
  if v_enabled is distinct from true then
    return null;
  end if;

  perform public.web_retry_housekeeping();

  select exists (select 1 from public.web_retry_queue q where q.status = 'pending' and q.due_at <= now()) into v_due;
  if not v_due then
    return null; -- 빈 큐에서는 앱을 부르지 않는다
  end if;

  -- 앱 주소와 비밀값은 Vault에서 읽는다(setup-cron 스크립트가 넣어 둔 값). pg_net은 비동기라 요청 번호만 돌려준다
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'onbid_app_url') || '/api/cron/web-retry',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'onbid_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 85000
  ) into v_id;
  return v_id;
end;
$$;

comment on function public.web_enqueue_due_retries() is
  '매분 pg_cron이 부른다. 점검이 켜져 있고 예정 시각이 지난 대기 줄이 있을 때만 /api/cron/web-retry를 pg_net으로 호출하고 요청 번호를 돌려준다(없으면 null). 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- F. 실행 권한: 기본으로 모두에게 열려 있으므로 먼저 모두 닫고, 서버 관리용 키에게만 연다.
-- ===========================================================================
revoke all on function public.enqueue_web_confirm(text, bigint, integer) from public, anon, authenticated;
revoke all on function public.web_retry_housekeeping() from public, anon, authenticated;
revoke all on function public.claim_due_web_retry() from public, anon, authenticated;
revoke all on function public.finish_web_retry(bigint, text) from public, anon, authenticated;
revoke all on function public.web_enqueue_due_retries() from public, anon, authenticated;
grant execute on function public.enqueue_web_confirm(text, bigint, integer) to service_role;
grant execute on function public.web_retry_housekeeping() to service_role;
grant execute on function public.claim_due_web_retry() to service_role;
grant execute on function public.finish_web_retry(bigint, text) to service_role;
grant execute on function public.web_enqueue_due_retries() to service_role;
