-- pgTAP 테스트 12: 호출 간격 설정(public_call_interval_ms) (R04, 서비스별 호출 간격)
-- 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

select is((select value from public.settings where key = 'public_call_interval_ms'), '200'::jsonb, '기본값은 200밀리초');
select is((select count(*)::int from public.settings), 16, '설정 항목은 16개');

select lives_ok($$update public.settings set value = '0'::jsonb where key = 'public_call_interval_ms'$$, '0은 허용 (한 칸 안: 기다리지 않음)');
select lives_ok($$update public.settings set value = '5000'::jsonb where key = 'public_call_interval_ms'$$, '5000은 허용 (한 칸 안)');
select throws_ok($$update public.settings set value = '-1'::jsonb where key = 'public_call_interval_ms'$$, '23514', null, '-1은 거부 (한 칸 밖)');
select throws_ok($$update public.settings set value = '5001'::jsonb where key = 'public_call_interval_ms'$$, '23514', null, '5001은 거부 (한 칸 밖)');
select throws_ok($$update public.settings set value = 'null'::jsonb where key = 'public_call_interval_ms'$$, '23514', null, 'null은 거부');
select throws_ok($$update public.settings set value = '"fast"'::jsonb where key = 'public_call_interval_ms'$$, '23514', null, '글자는 거부');

select * from finish();
rollback;
