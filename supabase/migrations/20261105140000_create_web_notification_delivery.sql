-- 홈페이지 가용성 모니터링 W12: 알림 발송 흐름을 받치는 DB 함수 (미발송 목록, 발송 임대, 매분 함수에 "15분 넘게 미발송 알림" 조건 추가)
-- Design Ref: docs/design-homepage-monitoring.md §5.4 / Plan W12
--
-- 만드는 것
--   web_notification_leases        : 알림 키 1개를 한 번에 한 실행만 발송하도록 잠시 빌려주는 표(임대). 내용은 시각뿐이고 알림 기록(추가 전용)과 별개다
--   list_unsent_web_notifications  : 아직 sent가 없고 시도 5회 미만인 알림 목록(앱의 발송기·회수 경로가 읽음). 감시 함수가 직접 보내는 stale·resumed는 제외
--   lease_web_notification         : 발송 임대 선점. 이미 발송됐거나 시도 5회를 채웠거나 다른 실행이 임대 중이면 false
--   web_enqueue_due_retries (교체) : W11 함수에 "15분 넘게 미발송인 알림이 있을 때"도 앱(/api/cron/web-retry)을 부르는 조건을 더한다
-- 이 파일이 만들지 않는 것(뒤 작업): 모니터 정지·재개 알림(W16, DB가 pg_net으로 직접 발송)
-- 규칙: 새 함수는 서버 관리용 키(service_role)만 실행할 수 있다. 알림 줄은 기존 record_notification_attempt로만 추가한다(추가 전용 유지).

-- ===========================================================================
-- A. 발송 임대 표
-- ===========================================================================
create table public.web_notification_leases (
  key          text        primary key references public.web_notification_keys (key),
  leased_until timestamptz not null
);

comment on table public.web_notification_leases is '알림 발송 임대. 같은 키를 두 실행이 동시에 보내지 않게 한다. 쓰기는 lease_web_notification 함수만.';

alter table public.web_notification_leases enable row level security;
-- 다른 web_* 표와 같은 규칙: 로그인 사용자는 읽기만(기존 03_sec04 시험의 공통 규칙), 쓰기는 함수(소유자 권한)만. 서버 관리용 키도 직접 쓰지 못한다
revoke all on public.web_notification_leases from anon, authenticated, service_role;
grant select on public.web_notification_leases to authenticated, service_role;
create policy "로그인 사용자는 web_notification_leases를 읽을 수 있다"
  on public.web_notification_leases for select to authenticated using (true);

-- ===========================================================================
-- B. list_unsent_web_notifications
-- ===========================================================================
create or replace function public.list_unsent_web_notifications(
  p_older_minutes integer default 0,
  p_keys          text[] default null,
  p_limit         integer default 20
)
returns table (
  out_key         text,
  out_kind        text,
  out_target_key  text,
  out_incident_no integer,
  out_payload     jsonb,
  out_attempts    integer,
  out_created_at  timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_older_minutes is null or p_older_minutes < 0 or p_older_minutes > 1440 then
    raise exception '경과 분은 0~1440이어야 합니다' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception '개수는 1~50이어야 합니다' using errcode = '22023';
  end if;

  return query
    select q.key, q.kind, q.target_key, k.incident_no, q.payload,
           (select max(m.attempt)::integer from public.web_notifications m where m.key = q.key),
           q.created_at
      from public.web_notifications q
      join public.web_notification_keys k on k.key = q.key
     where q.attempt = 0
       -- 감시 함수가 pg_net으로 직접 보내는 알림은 앱이 보내지 않는다
       and q.kind not in ('stale', 'resumed')
       and q.created_at <= now() - make_interval(mins => p_older_minutes)
       and (p_keys is null or q.key = any (p_keys))
       and not exists (select 1 from public.web_notifications s where s.key = q.key and s.status = 'sent')
       and (select max(m.attempt) from public.web_notifications m where m.key = q.key) < 5
     order by q.created_at, q.id
     limit p_limit;
end;
$$;

comment on function public.list_unsent_web_notifications(integer, text[], integer) is
  '아직 sent가 없고 시도 5회 미만인 알림(감시 알림 제외)을 오래된 순으로 돌려준다. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- C. lease_web_notification
-- ===========================================================================
create or replace function public.lease_web_notification(
  p_key     text,
  p_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max  integer;
  v_sent boolean;
  v_rows integer;
begin
  if p_seconds is null or p_seconds < 1 or p_seconds > 600 then
    raise exception '임대 시간은 1~600초여야 합니다' using errcode = '22023';
  end if;

  select max(n.attempt), coalesce(bool_or(n.status = 'sent'), false) into v_max, v_sent
    from public.web_notifications n where n.key = p_key;
  if v_max is null or v_sent or v_max >= 5 then
    return false; -- 선점되지 않은 키이거나, 이미 발송됐거나, 시도를 모두 썼다
  end if;

  -- 한 문장으로 선점: 임대가 없거나 이미 끝난 경우에만 갱신한다. 동시에 들어온 두 번째 호출은 첫 호출이 끝나기를 기다린 뒤 조건에 걸려 0줄이 된다
  insert into public.web_notification_leases (key, leased_until)
  values (p_key, now() + make_interval(secs => p_seconds))
  on conflict (key) do update set leased_until = excluded.leased_until
   where public.web_notification_leases.leased_until < now();
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.lease_web_notification(text, integer) is
  '알림 발송 임대 선점. 발송 전에 부른다. 이미 발송됐거나 시도 5회를 채웠거나 다른 실행이 임대 중이면 false. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- D. web_enqueue_due_retries 교체: "15분 넘게 미발송인 알림"도 앱 호출 조건에 넣는다
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
  v_unsent  boolean;
  v_id      bigint;
begin
  -- 점검을 끄면 재시도도 멈춘다 (설정이 없거나 읽을 수 없으면 아무것도 하지 않는다)
  select (s.value #>> '{}')::boolean into v_enabled from public.web_settings s where s.key = 'web_monitor_enabled';
  if v_enabled is distinct from true then
    return null;
  end if;

  perform public.web_retry_housekeeping();

  select exists (select 1 from public.web_retry_queue q where q.status = 'pending' and q.due_at <= now()) into v_due;
  -- 15분 넘게 sent가 없고 시도 5회 미만인 알림(앱이 죽었거나 발송에 실패한 것): 앱의 회수 경로가 다시 보낸다. 감시 알림은 제외
  select exists (
    select 1 from public.web_notifications q
     where q.attempt = 0 and q.kind not in ('stale', 'resumed')
       and q.created_at < now() - interval '15 minutes'
       and not exists (select 1 from public.web_notifications s where s.key = q.key and s.status = 'sent')
       and (select max(m.attempt) from public.web_notifications m where m.key = q.key) < 5
  ) into v_unsent;
  if not v_due and not v_unsent then
    return null; -- 예정된 줄도 미발송 알림도 없으면 앱을 부르지 않는다
  end if;

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
  '매분 pg_cron이 부른다. 점검이 켜져 있고 (예정 시각이 지난 대기 줄) 또는 (15분 넘게 미발송인 알림)이 있을 때만 /api/cron/web-retry를 pg_net으로 호출하고 요청 번호를 돌려준다(없으면 null). 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- E. 실행 권한
-- ===========================================================================
revoke all on function public.list_unsent_web_notifications(integer, text[], integer) from public, anon, authenticated;
revoke all on function public.lease_web_notification(text, integer) from public, anon, authenticated;
grant execute on function public.list_unsent_web_notifications(integer, text[], integer) to service_role;
grant execute on function public.lease_web_notification(text, integer) to service_role;
-- (web_enqueue_due_retries는 create or replace라서 W11의 권한이 그대로 남지만, 분명히 하려고 다시 적는다)
revoke all on function public.web_enqueue_due_retries() from public, anon, authenticated;
grant execute on function public.web_enqueue_due_retries() to service_role;
