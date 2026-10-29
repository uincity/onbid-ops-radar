-- PLAN 작업 6: 사용자 역할을 담는 profiles 테이블
-- Design Ref: DESIGN §6.1 (profiles), §6.4 (RLS 요약), PRD 4-4 (로그인과 접근권한)
--
-- 한 줄 설명: 로그인 계정(auth.users)마다 "이름"과 "역할(operator/admin)"을 한 줄씩 적어 두는 표.
-- 역할은 화면에서 바꿀 수 없다. 서버의 관리 절차(관리용 키)로만 넣고 바꾼다. (SEC-07)

-- ---------------------------------------------------------------------------
-- 1. 공용 함수: 줄이 수정될 때 updated_at을 자동으로 현재 시각으로 바꾼다
--    (다른 테이블에서도 재사용한다)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. profiles 테이블
-- ---------------------------------------------------------------------------
create table public.profiles (
  -- 로그인 계정의 ID와 같은 값. 계정이 지워지면 이 줄도 함께 지워진다.
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  -- 역할은 두 가지만 허용 (PRD 4-1). 기본값은 권한이 낮은 operator.
  role         text not null default 'operator',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_role_check
    check (role in ('operator', 'admin')),
  constraint profiles_display_name_check
    check (char_length(btrim(display_name)) between 1 and 50)
);

comment on table public.profiles is '사용자 이름과 역할(operator/admin). 역할은 서버 관리 절차로만 변경한다.';
comment on column public.profiles.role is 'operator(운영 담당자) 또는 admin(팀장)';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. 출입 규칙 (RLS) — 최소 권한
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- 로그인하지 않은 사용자(anon)와 로그인 사용자(authenticated)의 기본 권한을 모두 거둔 뒤,
-- 로그인 사용자에게 "읽기"만 다시 준다. (담당자 이름을 화면에 보여 주려면 읽기가 필요하다)
-- 관리용 키(service_role)는 RLS를 건너뛰는 서버 전용 권한이라 그대로 둔다.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- 로그인한 사용자는 모든 사용자의 이름·역할을 읽을 수 있다. (PRD 4-1, DESIGN 6.4)
create policy "로그인 사용자는 profiles를 읽을 수 있다"
  on public.profiles
  for select
  to authenticated
  using (true);

-- insert / update / delete 정책은 일부러 만들지 않는다.
-- → 화면(브라우저)이나 사용자 권한으로는 자기 역할을 포함해 아무것도 바꿀 수 없다. (SEC-07)
