-- W16: 홈페이지 점검 자체 감시 (앱과 독립: DB 함수 + pg_cron + Vault + pg_net으로 텔레그램을 직접 호출)
-- Design Ref: docs/design-homepage-monitoring.md §5.5(자체 감시)·§5.4(멱등 키)·§6.3, docs/plan-homepage-monitoring.md W16
--
-- 한 줄 설명
--   web_heartbeat_sends     : 감시 알림을 pg_net으로 보낸 요청 번호 표(응답을 다음 주기에 읽어 sent/failed로 기록하려고 쓴다). 쓰기는 감시 함수로만
--   web_heartbeat_post      : 텔레그램 sendMessage를 pg_net으로 호출(요청 번호만 돌려줌, 전송은 커밋 뒤 비동기). Vault 비밀값이 없으면 null. 서버 관리용 키만
--   web_monitor_heartbeat   : 10분마다 도는 감시. ① 지난 요청의 응답을 읽어 결과 기록 ② 실패한 감시 알림 재발송(최대 3회) ③ 정지·재개 판단과 알림
-- 살아 있음의 기준(설계서 5.5): trigger가 scheduled·retry이고 succeeded·partial로 끝난 실행만 센다. 수동 점검·차단·실패 실행은 세지 않는다.
--   기준 시각 = greatest(마지막 정상 실행의 종료 시각, 점검을 다시 켠 시각(web_settings.web_monitor_enabled.updated_at))
-- 정지 알림 키 stale:{마지막 정상 실행 번호}:{n}, 재개 알림 키 resumed:{정지 알림의 마지막 정상 실행 번호} (둘 다 claim_notification으로 선점)
-- 지켜야 할 것: 텔레그램 토큰은 로그·표·오류 문구에 남기지 않는다(주소에 들어가므로 이 함수는 주소를 어디에도 저장하지 않는다). 오류는 분류 이름만 기록한다.

-- ===========================================================================
-- A. web_heartbeat_sends : 감시 알림 발송 요청 번호 (응답 확인 전까지만 settled=false)
-- ===========================================================================
create table public.web_heartbeat_sends (
  key            text        not null references public.web_notification_keys (key),
  attempt        smallint    not null,
  net_request_id bigint      not null,
  sent_at        timestamptz not null default now(),
  settled        boolean     not null default false,

  primary key (key, attempt),
  constraint web_heartbeat_sends_attempt_check check (attempt between 1 and 3)
);

comment on table public.web_heartbeat_sends is
  '감시 알림(stale·resumed)을 pg_net으로 보낸 요청 번호. 다음 감시 주기에 net._http_response에서 응답을 읽어 알림 시도 줄(sent/failed)을 남기고 settled로 바꾼다. 감시 함수로만 쓴다.';

alter table public.web_heartbeat_sends enable row level security;
revoke all on public.web_heartbeat_sends from anon, authenticated;
grant select on public.web_heartbeat_sends to authenticated;
create policy "로그인 사용자는 web_heartbeat_sends를 읽을 수 있다"
  on public.web_heartbeat_sends for select to authenticated using (true);

-- ===========================================================================
-- B. web_heartbeat_post : 텔레그램 호출 (비동기). 토큰은 Vault에서만 읽고 어디에도 저장하지 않는다
-- ===========================================================================
create or replace function public.web_heartbeat_post(p_text text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token   text;
  v_chat    text;
  v_timeout integer;
begin
  select ds.decrypted_secret into v_token from vault.decrypted_secrets ds where ds.name = 'onbid_telegram_token';
  select ds.decrypted_secret into v_chat from vault.decrypted_secrets ds where ds.name = 'onbid_telegram_chat_id';
  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then
    return null; -- 비밀값이 없으면 보내지 않는다 (호출한 쪽이 secret_missing 실패로 기록)
  end if;
  select (s.value #>> '{}')::integer into v_timeout from public.web_settings s where s.key = 'web_notify_timeout_ms';

  return net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('chat_id', v_chat, 'text', left(coalesce(p_text, ''), 4000), 'parse_mode', 'HTML', 'disable_web_page_preview', true),
    timeout_milliseconds := coalesce(v_timeout, 5000)
  );
end;
$$;

comment on function public.web_heartbeat_post(text) is
  '텔레그램 sendMessage를 pg_net으로 호출하고 요청 번호를 돌려준다(전송은 커밋 뒤 비동기). Vault 비밀값이 없으면 null. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- C. web_monitor_heartbeat : 10분 주기 자체 감시
--   출력(jsonb): { action: disabled|busy|no_baseline|stale_sent|resumed_sent|ok, settled, resent, idle_min }
-- ===========================================================================
create or replace function public.web_monitor_heartbeat()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled   boolean;
  v_since     timestamptz;
  v_stale_min integer;
  v_realert_h integer;
  v_good      record;
  v_good_id   bigint;
  v_target    text;
  v_base      timestamptz;
  v_idle_min  integer;
  v_settled   integer := 0;
  v_resent    integer := 0;
  v_action    text := 'ok';
  s           record;
  r           record;
  v_resp      record;
  v_status    text;
  v_code      integer;
  v_class     text;
  v_req       bigint;
  v_cnt       integer;
  v_last_at   timestamptz;
  v_n         integer;
  v_key       text;
  v_text      text;
  v_prev      record;
  v_prev_id   bigint;
begin
  -- 1. 점검이 꺼져 있거나 설정이 없으면 아무것도 하지 않는다
  select (s2.value #>> '{}')::boolean, s2.updated_at into v_enabled, v_since from public.web_settings s2 where s2.key = 'web_monitor_enabled';
  if v_enabled is distinct from true then
    return jsonb_build_object('action', 'disabled');
  end if;
  -- 같은 감시가 겹쳐 돌지 않게 한다 (겹치면 이번 주기는 건너뜀)
  if not pg_try_advisory_xact_lock(hashtextextended('web_heartbeat', 0)) then
    return jsonb_build_object('action', 'busy');
  end if;

  select coalesce((s2.value #>> '{}')::integer, 130) into v_stale_min from public.web_settings s2 where s2.key = 'web_heartbeat_stale_min';
  select coalesce((s2.value #>> '{}')::integer, 24) into v_realert_h from public.web_settings s2 where s2.key = 'web_heartbeat_realert_hours';
  v_stale_min := coalesce(v_stale_min, 130);
  v_realert_h := coalesce(v_realert_h, 24);

  -- 2. 지난 요청의 응답을 읽어 알림 시도 줄을 남긴다 (pg_net은 비동기라 응답은 다음 주기에 읽는다)
  for s in select hs.key, hs.attempt, hs.net_request_id, hs.sent_at from public.web_heartbeat_sends hs where not hs.settled order by hs.key, hs.attempt loop
    select * into v_resp from net._http_response nr where nr.id = s.net_request_id;
    v_status := null;
    if found then
      v_code := v_resp.status_code;
      if v_resp.timed_out is true then
        v_status := 'failed'; v_class := 'timeout'; v_code := null;
      elsif v_code is null then
        v_status := 'failed'; v_class := 'network_error';
      elsif v_code between 200 and 299 then
        v_status := 'sent'; v_class := null;
      elsif v_code = 429 then
        v_status := 'failed'; v_class := 'rate_limited';
      elsif v_code >= 500 then
        v_status := 'failed'; v_class := 'http_5xx';
      else
        v_status := 'failed'; v_class := 'http_4xx';
      end if;
    elsif s.sent_at < now() - interval '30 minutes' then
      -- 응답 표에서 사라졌거나 끝내 오지 않은 요청 (응답 보존 시간이 지났을 수 있다)
      v_status := 'failed'; v_class := 'no_response'; v_code := null;
    end if;

    if v_status is not null then
      begin
        perform public.record_notification_attempt(s.key, s.attempt, 'telegram', v_status, case when v_code between 100 and 599 then v_code end, v_class, s.net_request_id);
      exception when others then
        null; -- 이미 기록된 시도 등: 이 요청은 정리만 한다
      end;
      update public.web_heartbeat_sends hs set settled = true where hs.key = s.key and hs.attempt = s.attempt;
      v_settled := v_settled + 1;
    end if;
  end loop;

  -- 3. 실패한 감시 알림을 다시 보낸다 (시도 최대 3회, 10분 간격 = 감시 주기)
  for r in
    select k.key, k.kind,
           (select max(n.attempt) from public.web_notifications n where n.key = k.key) as last_attempt,
           (select n.payload ->> 'text' from public.web_notifications n where n.key = k.key and n.attempt = 0) as text
      from public.web_notification_keys k
     where k.kind in ('stale', 'resumed')
       and not exists (select 1 from public.web_heartbeat_sends hs where hs.key = k.key and not hs.settled)
       and not exists (select 1 from public.web_notifications n where n.key = k.key and n.status = 'sent')
       and (select max(n.attempt) from public.web_notifications n where n.key = k.key) between 1 and 2
  loop
    v_req := public.web_heartbeat_post(r.text);
    if v_req is null then
      perform public.record_notification_attempt(r.key, r.last_attempt + 1, 'telegram', 'failed', null, 'secret_missing', null);
    else
      insert into public.web_heartbeat_sends (key, attempt, net_request_id) values (r.key, r.last_attempt + 1, v_req);
    end if;
    v_resent := v_resent + 1;
  end loop;

  -- 4. 기준 시각: 마지막 정상 정시·재확인 실행의 종료 시각과 점검을 다시 켠 시각 중 늦은 쪽
  select run.id, run.target_key, run.finished_at into v_good
    from public.web_check_runs run
   where run."trigger" in ('scheduled', 'retry') and run.status in ('succeeded', 'partial')
   order by run.finished_at desc, run.id desc limit 1;
  v_good_id := coalesce(v_good.id, 0);
  v_target := coalesce(v_good.target_key, 'onbid-home');
  v_base := greatest(v_good.finished_at, v_since);
  if v_base is null then
    return jsonb_build_object('action', 'no_baseline', 'settled', v_settled, 'resent', v_resent);
  end if;
  v_idle_min := floor(extract(epoch from (now() - v_base)) / 60)::integer;

  -- '넘게'는 초 단위로 비교한다(130분 정각까지는 정상, 130분 1초부터 정지)
  if (now() - v_base) > make_interval(mins => v_stale_min) then
    -- 5-a. 정지: 처음이면 즉시, 이어지면 realert 시간마다 다시 알린다
    select count(*), max(k.created_at) into v_cnt, v_last_at from public.web_notification_keys k where k.kind = 'stale' and k.key like 'stale:' || v_good_id || ':%';
    if v_cnt = 0 or v_last_at < now() - make_interval(hours => v_realert_h) then
      v_n := v_cnt + 1;
      v_key := 'stale:' || v_good_id || ':' || v_n;
      v_text := '⚫ <b>홈페이지 점검 정지</b>' || E'\n'
        || case when v_good.finished_at is null then '정상 종료된 점검 기록이 없습니다.'
                else '마지막 정상 점검: ' || to_char(v_good.finished_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ' (KST)' end || E'\n'
        || '점검 결과가 ' || v_idle_min || '분째 없습니다 (기준 ' || v_stale_min || '분).' || E'\n'
        || 'Supabase 스케줄러와 배포 상태를 확인해 주세요.' || case when v_n > 1 then E'\n' || '(' || v_n || '번째 알림)' else '' end;
      if public.claim_notification(v_key, 'stale', v_target, null, jsonb_build_object('last_good_run_id', v_good_id, 'idle_min', v_idle_min, 'n', v_n, 'text', v_text)) then
        v_req := public.web_heartbeat_post(v_text);
        if v_req is null then
          perform public.record_notification_attempt(v_key, 1, 'telegram', 'failed', null, 'secret_missing', null);
        else
          insert into public.web_heartbeat_sends (key, attempt, net_request_id) values (v_key, 1, v_req);
        end if;
        v_action := 'stale_sent';
      end if;
    end if;
  else
    -- 5-b. 정상으로 돌아옴: 가장 최근 정지 알림이 있고, 그 뒤 새 정상 실행이 있고, 재개 알림을 아직 안 보냈으면 1회 보낸다
    select k.key, k.created_at into v_prev from public.web_notification_keys k where k.kind = 'stale' order by k.created_at desc, k.key desc limit 1;
    if found then
      v_prev_id := split_part(v_prev.key, ':', 2)::bigint;
      if v_good_id > v_prev_id and not exists (select 1 from public.web_notification_keys k where k.key = 'resumed:' || v_prev_id) then
        v_key := 'resumed:' || v_prev_id;
        v_text := '🟢 <b>홈페이지 점검 재개</b>' || E'\n'
          || to_char(v_good.finished_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ' (KST)에 점검이 다시 정상 종료되었습니다.';
        if public.claim_notification(v_key, 'resumed', v_target, null, jsonb_build_object('last_good_run_id', v_good_id, 'stale_run_id', v_prev_id, 'text', v_text)) then
          v_req := public.web_heartbeat_post(v_text);
          if v_req is null then
            perform public.record_notification_attempt(v_key, 1, 'telegram', 'failed', null, 'secret_missing', null);
          else
            insert into public.web_heartbeat_sends (key, attempt, net_request_id) values (v_key, 1, v_req);
          end if;
          v_action := 'resumed_sent';
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('action', v_action, 'settled', v_settled, 'resent', v_resent, 'idle_min', v_idle_min);
end;
$$;

comment on function public.web_monitor_heartbeat() is
  '10분 주기 자체 감시. 정시·재확인으로 정상 종료한 마지막 실행(또는 점검을 다시 켠 시각) 이후 web_heartbeat_stale_min을 넘기면 pg_net으로 텔레그램 정지 알림을 직접 보낸다(앱 독립). 응답은 다음 주기에 읽어 기록하고 실패는 최대 3회 재발송, 정상으로 돌아오면 재개 알림 1회. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- 실행 권한: 모두 닫고 서버 관리용 키(크론 포함)에게만 연다
-- ===========================================================================
revoke all on function public.web_heartbeat_post(text) from public, anon, authenticated;
revoke all on function public.web_monitor_heartbeat() from public, anon, authenticated;
grant execute on function public.web_heartbeat_post(text) to service_role;
grant execute on function public.web_monitor_heartbeat() to service_role;
