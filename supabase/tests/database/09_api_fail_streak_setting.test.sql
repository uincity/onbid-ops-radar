-- pgTAP 테스트 09: 연속 FAIL 횟수 설정(api_fail_streak_threshold) (R04)
-- 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

select is((select value from public.settings where key = 'api_fail_streak_threshold'), '3'::jsonb, '기본값은 3');
select is((select count(*)::int from public.settings), 16, '설정 항목은 16개');

select lives_ok($$update public.settings set value = '2'::jsonb where key = 'api_fail_streak_threshold'$$, '2는 허용 (한 칸 안)');
select lives_ok($$update public.settings set value = '10'::jsonb where key = 'api_fail_streak_threshold'$$, '10은 허용 (한 칸 안)');
select throws_ok($$update public.settings set value = '1'::jsonb where key = 'api_fail_streak_threshold'$$, '23514', null, '1은 거부 (한 칸 밖)');
select throws_ok($$update public.settings set value = '11'::jsonb where key = 'api_fail_streak_threshold'$$, '23514', null, '11은 거부 (한 칸 밖)');
select throws_ok($$update public.settings set value = 'null'::jsonb where key = 'api_fail_streak_threshold'$$, '23514', null, 'null은 거부');
select throws_ok($$insert into public.settings (key, value) values ('price_threshold', '1'::jsonb)$$, '23514', null, '목록에 없는 항목은 여전히 추가할 수 없음');

select * from finish();
rollback;
