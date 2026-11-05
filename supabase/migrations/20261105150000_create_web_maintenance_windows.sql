-- W15: 홈페이지 모니터링 계획 점검 창 (테이블 + 등록·취소 DB 함수 + 점검 안 판정 함수)
-- Design Ref: docs/design-homepage-monitoring.md §5.3(처리표)·§5.6(등록·취소)·§6.1(web_maintenance_windows)·§6.3(함수),
--             docs/plan-homepage-monitoring.md W15
--
-- 한 줄 설명
--   web_maintenance_windows   : 팀장이 미리 등록한 점검 시간 [시작, 종료). 대상 하나를 반드시 지정한다(전체 대상 창은 없다)
--   create_maintenance_window : 팀장만. 겹침·길이 검사 후 1줄 추가
--   cancel_maintenance_window : 팀장만. 시작 전 창은 취소 표시만, 진행 중 창은 종료 시각을 지금으로 당김, 끝난 창은 거부
--   web_in_maintenance        : 이 시각이 취소되지 않은 창 [시작, 종료) 안인가 (점검 실행기용, 서버 관리용 키만)
--   mark_web_run_planned      : 창 안에서 끝난 점검 실행에 planned_maintenance 표시 (서버 관리용 키만)
-- 규칙
--   * 입력 시각은 이미 UTC 기준 시각(timestamptz)이다. DB는 시간대를 바꾸지 않는다. KST→UTC 변환은 서버 액션 한 곳에서만 한다.
--   * 같은 대상의 취소되지 않은 창은 시간이 겹칠 수 없다(배제 제약). 서로 이어 붙이는 것(종료 = 다음 시작)은 허용한다.
--   * 최대 길이는 web_settings의 web_window_max_hours(기본 168시간). 설정이 바뀌어도 이미 있는 창은 그대로 둔다.
--   * 쓰기 정책은 없다: 창은 위 두 함수로만 바뀐다. 읽기는 로그인 사용자만.

create extension if not exists btree_gist with schema extensions;

create table public.web_maintenance_windows (
  id           bigint generated always as identity primary key,
  target_key   text        not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  reason       text        not null,
  created_by   uuid        not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid        references public.profiles (id),

  constraint web_maintenance_windows_target_check
    check (target_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint web_maintenance_windows_range_check
    check (ends_at > starts_at),
  -- 설정(web_window_max_hours)이 아무리 커져도 넘을 수 없는 절대 상한: 720시간(설정 허용 범위의 끝)
  constraint web_maintenance_windows_max_len_check
    check (ends_at - starts_at <= interval '720 hours'),
  constraint web_maintenance_windows_reason_check
    check (char_length(btrim(reason)) between 1 and 200 and reason = btrim(reason)),
  -- 취소 시각과 취소한 사람은 함께 있거나 함께 없다
  constraint web_maintenance_windows_cancel_pair_check
    check ((cancelled_at is null) = (cancelled_by is null)),
  -- 같은 대상의 취소되지 않은 창은 겹칠 수 없다 ([시작, 종료) 이므로 이어 붙이기는 허용)
  constraint web_maintenance_windows_no_overlap
    exclude using gist (target_key with =, tstzrange(starts_at, ends_at, '[)') with &&) where (cancelled_at is null)
);

comment on table public.web_maintenance_windows is
  '홈페이지 모니터링 계획 점검 창. 대상 하나를 반드시 지정하고, 같은 대상의 취소되지 않은 창은 겹칠 수 없다. 쓰기는 create/cancel_maintenance_window 함수로만.';
comment on column public.web_maintenance_windows.cancelled_at is
  '취소 시각. 시작 전에 취소했으면 이 값이 starts_at 이전이고 창은 판정에서 빠진다. 진행 중에 취소했으면 ends_at을 이 시각으로 당긴다.';

create index web_maintenance_windows_target_start_idx on public.web_maintenance_windows (target_key, starts_at desc);

alter table public.web_maintenance_windows enable row level security;
revoke all on public.web_maintenance_windows from anon, authenticated;
grant select on public.web_maintenance_windows to authenticated;
create policy "로그인 사용자는 web_maintenance_windows를 읽을 수 있다"
  on public.web_maintenance_windows for select to authenticated using (true);
-- 쓰기(insert/update/delete) 정책은 만들지 않는다: 서버 관리용 키 포함, 아래 함수로만 바꾼다.

-- ===========================================================================
-- web_in_maintenance : 이 시각이 취소되지 않은 창 [시작, 종료) 안인가
--   시작 전에 취소된 창(cancelled_at <= starts_at)은 판정에서 빠진다. 진행 중에 취소된 창은 당겨진 종료 시각까지만 유효하다.
-- ===========================================================================
create or replace function public.web_in_maintenance(p_target text, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.web_maintenance_windows w
     where w.target_key = p_target
       and w.starts_at <= p_at and p_at < w.ends_at
       and (w.cancelled_at is null or w.cancelled_at > w.starts_at)
  );
$$;

comment on function public.web_in_maintenance(text, timestamptz) is
  '이 시각이 대상의 취소되지 않은 계획 점검 창 [시작, 종료) 안인가. 시작 전에 취소된 창은 제외. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- mark_web_run_planned : 창 안에서 끝난 정시·재확인 실행에 계획 점검 표시 (수동 점검·진행 중 실행은 바꾸지 않는다)
-- ===========================================================================
create or replace function public.mark_web_run_planned(p_run_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.web_check_runs r
     set planned_maintenance = true
   where r.id = p_run_id
     and r."trigger" in ('scheduled', 'retry')
     and r.status in ('succeeded', 'partial');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.mark_web_run_planned(bigint) is
  '창 안에서 정상 종료된 정시·재확인 실행에 planned_maintenance를 표시한다. 수동 점검·진행 중 실행은 건드리지 않는다. 서버 관리용 키만 실행할 수 있다.';

-- ===========================================================================
-- create_maintenance_window : 팀장만. 오류는 코드 문구로 알린다 (FORBIDDEN / WINDOW_INVALID / WINDOW_OVERLAP)
-- ===========================================================================
create or replace function public.create_maintenance_window(
  p_target text,
  p_start  timestamptz,
  p_end    timestamptz,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_max_h   integer;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_id      bigint;
begin
  -- 1. 누구인가: 로그인한 팀장만
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 2. 입력 검사: 대상은 반드시 지정, 종료 > 시작, 이미 끝난 창 불가, 사유 1~200자, 최대 길이
  if p_target is null or p_target !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or p_start is null or p_end is null
     or p_end <= p_start or p_end <= now()
     or char_length(v_reason) not between 1 and 200 then
    raise exception 'WINDOW_INVALID' using errcode = 'P0001';
  end if;
  select (s.value #>> '{}')::integer into v_max_h from public.web_settings s where s.key = 'web_window_max_hours';
  if v_max_h is null then
    v_max_h := 168; -- 설정 줄이 없을 때만 설계 기본값 (설정 검사는 web_settings 쪽에서 한다)
  end if;
  if p_end - p_start > make_interval(hours => v_max_h) then
    raise exception 'WINDOW_INVALID' using errcode = 'P0001';
  end if;

  -- 3. 추가 (겹치면 배제 제약이 거부 → 문구로 바꿔 알린다)
  begin
    insert into public.web_maintenance_windows (target_key, starts_at, ends_at, reason, created_by)
    values (p_target, p_start, p_end, v_reason, v_uid)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'WINDOW_OVERLAP' using errcode = 'P0001';
  end;
  return v_id;
end;
$$;

comment on function public.create_maintenance_window(text, timestamptz, timestamptz, text) is
  '계획 점검 창을 등록한다(팀장만). 대상 필수, 종료>시작, 사유 1~200자, 최대 길이(web_window_max_hours), 같은 대상 창과 겹치면 거부. 시각은 UTC 기준 그대로 저장한다(시간대 변환 없음).';

-- ===========================================================================
-- cancel_maintenance_window : 팀장만.
--   시작 전 창  → cancelled_at만 기록 (줄은 남고 판정에서 빠짐)
--   진행 중 창  → ends_at을 지금으로 당기고 cancelled_at 기록
--   끝난 창·이미 취소된 창 → 거부 (WINDOW_NOT_FOUND 아님: WINDOW_INVALID)
--   없는 창     → WINDOW_NOT_FOUND
-- ===========================================================================
create or replace function public.cancel_maintenance_window(p_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_w    public.web_maintenance_windows%rowtype;
  v_now  timestamptz := now();
begin
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_w from public.web_maintenance_windows w where w.id = p_id for update;
  if not found then
    raise exception 'WINDOW_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_w.cancelled_at is not null or v_w.ends_at <= v_now then
    raise exception 'WINDOW_INVALID' using errcode = 'P0001';
  end if;

  if v_now < v_w.starts_at then
    -- 시작 전: 취소 표시만 (cancelled_at <= starts_at 이므로 판정에서 빠진다)
    update public.web_maintenance_windows w set cancelled_at = v_now, cancelled_by = v_uid where w.id = p_id;
  else
    -- 진행 중: 종료 시각을 지금으로 당긴다. 지금 == 시작이면 길이가 0이 되므로 그 경우에도 시작 전 취소와 같게 처리한다
    if v_now = v_w.starts_at then
      update public.web_maintenance_windows w set cancelled_at = v_now, cancelled_by = v_uid where w.id = p_id;
    else
      update public.web_maintenance_windows w set ends_at = v_now, cancelled_at = v_now, cancelled_by = v_uid where w.id = p_id;
    end if;
  end if;
  return p_id;
end;
$$;

comment on function public.cancel_maintenance_window(bigint) is
  '계획 점검 창을 취소한다(팀장만). 시작 전이면 취소 표시만, 진행 중이면 종료 시각을 지금으로 당기고, 끝났거나 이미 취소된 창은 거부한다.';

-- ===========================================================================
-- 실행 권한: 먼저 모두 닫고 필요한 쪽에만 연다.
--   등록·취소는 로그인 사용자가 서버 액션을 거쳐 부른다(함수 안에서 팀장 확인). 판정·표시 함수는 서버 관리용 키만.
-- ===========================================================================
revoke all on function public.web_in_maintenance(text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_web_run_planned(bigint) from public, anon, authenticated;
revoke all on function public.create_maintenance_window(text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.cancel_maintenance_window(bigint) from public, anon, authenticated;
grant execute on function public.web_in_maintenance(text, timestamptz) to service_role;
grant execute on function public.mark_web_run_planned(bigint) to service_role;
grant execute on function public.create_maintenance_window(text, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.cancel_maintenance_window(bigint) to authenticated, service_role;
