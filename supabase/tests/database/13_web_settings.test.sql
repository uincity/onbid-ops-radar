-- pgTAP 테스트 13: 홈페이지 모니터링 설정 테이블 web_settings (W05)
-- 모두 begin ... rollback 안에서 돌아서 DB에 아무것도 남지 않는다.
-- (RLS·권한 일반 점검은 00_rls_guard·03_sec04가 모든 테이블에 자동으로 한다. 여기서는 이 테이블 고유의 규칙을 본다.)

begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- 기본값과 항목 수
select is((select count(*)::int from public.web_settings), 20, '웹 설정 항목은 20개');
select is((select value from public.web_settings where key = 'web_http_timeout_ms'), '10000'::jsonb, '타임아웃 기본값 10000');
select is((select value from public.web_settings where key = 'web_http_slow_ms'), '3000'::jsonb, '느림 기준 기본값 3000');
select is((select value from public.web_settings where key = 'web_monitor_enabled'), 'true'::jsonb, '켜기/끄기 기본값 true');

-- 숫자 범위 경계: 타임아웃 1000~30000
select lives_ok($$update public.web_settings set value = '1000'::jsonb where key = 'web_http_timeout_ms'$$, '타임아웃 1000 허용 (한 칸 안)');
select lives_ok($$update public.web_settings set value = '30000'::jsonb where key = 'web_http_timeout_ms'$$, '타임아웃 30000 허용 (한 칸 안)');
select throws_ok($$update public.web_settings set value = '999'::jsonb where key = 'web_http_timeout_ms'$$, '23514', null, '타임아웃 999 거부 (한 칸 밖)');
select throws_ok($$update public.web_settings set value = '30001'::jsonb where key = 'web_http_timeout_ms'$$, '23514', null, '타임아웃 30001 거부 (한 칸 밖)');

-- 느림 기준 500~29999 (타임아웃과의 관계는 앱 코드가 확인)
select lives_ok($$update public.web_settings set value = '500'::jsonb where key = 'web_http_slow_ms'$$, '느림 기준 500 허용');
select throws_ok($$update public.web_settings set value = '499'::jsonb where key = 'web_http_slow_ms'$$, '23514', null, '느림 기준 499 거부');
select throws_ok($$update public.web_settings set value = '30000'::jsonb where key = 'web_http_slow_ms'$$, '23514', null, '느림 기준 30000 거부 (타임아웃 최대보다 작아야 함)');

-- 실행 시간 제한 10~85 (점검 경로 maxDuration 90초보다 작게)
select lives_ok($$update public.web_settings set value = '85'::jsonb where key = 'web_run_time_limit_seconds'$$, '실행 제한 85 허용');
select throws_ok($$update public.web_settings set value = '86'::jsonb where key = 'web_run_time_limit_seconds'$$, '23514', null, '실행 제한 86 거부');
select throws_ok($$update public.web_settings set value = '9'::jsonb where key = 'web_run_time_limit_seconds'$$, '23514', null, '실행 제한 9 거부');

-- 모니터 정지 판단 90~1440분 (1시간 주기보다 커야 함)
select lives_ok($$update public.web_settings set value = '90'::jsonb where key = 'web_heartbeat_stale_min'$$, '정지 판단 90분 허용');
select throws_ok($$update public.web_settings set value = '89'::jsonb where key = 'web_heartbeat_stale_min'$$, '23514', null, '정지 판단 89분 거부 (1시간 주기보다 짧을 수 있음)');

-- 요청 간격 0~5000 (0은 쉬지 않음)
select lives_ok($$update public.web_settings set value = '0'::jsonb where key = 'web_request_gap_ms'$$, '요청 간격 0 허용');
select throws_ok($$update public.web_settings set value = '5001'::jsonb where key = 'web_request_gap_ms'$$, '23514', null, '요청 간격 5001 거부');

-- 값의 종류: 숫자 항목에 글자·null·소수·불리언은 거부
select throws_ok($$update public.web_settings set value = '"3000"'::jsonb where key = 'web_http_slow_ms'$$, '23514', null, '숫자 항목에 글자 거부');
select throws_ok($$update public.web_settings set value = 'null'::jsonb where key = 'web_cert_warn_days'$$, '23514', null, '숫자 항목에 null 거부');
select throws_ok($$update public.web_settings set value = '14.5'::jsonb where key = 'web_cert_warn_days'$$, '23514', null, '숫자 항목에 소수 거부');
select throws_ok($$update public.web_settings set value = 'true'::jsonb where key = 'web_cert_warn_days'$$, '23514', null, '숫자 항목에 불리언 거부');

-- 켜기/끄기: true/false만
select lives_ok($$update public.web_settings set value = 'false'::jsonb where key = 'web_monitor_enabled'$$, 'false 허용 (끄기)');
select throws_ok($$update public.web_settings set value = '1'::jsonb where key = 'web_monitor_enabled'$$, '23514', null, '켜기/끄기에 숫자 1 거부');
select throws_ok($$update public.web_settings set value = '"true"'::jsonb where key = 'web_monitor_enabled'$$, '23514', null, '켜기/끄기에 글자 거부');
select throws_ok($$update public.web_settings set value = 'null'::jsonb where key = 'web_monitor_enabled'$$, '23514', null, '켜기/끄기에 null 거부');

-- 변경 시각: 값을 바꾸면 updated_at이 갱신된다 ("다시 켠 시각" 기준)
create temp table before_ts as select updated_at as ts from public.web_settings where key = 'web_alert_daily_cap';
update public.web_settings set value = '13'::jsonb where key = 'web_alert_daily_cap';
select ok((select updated_at from public.web_settings where key = 'web_alert_daily_cap') > (select ts from before_ts), '값을 바꾸면 updated_at이 갱신됨');

-- 항목 보호: 목록에 없는 항목 추가 불가, 이름 변경·삭제·비우기 불가
select throws_ok($$insert into public.web_settings (key, value) values ('web_notify_on_manual_check', 'false'::jsonb)$$, '23514', null, '삭제된 설정(web_notify_on_manual_check)은 추가할 수 없음');
select throws_ok($$insert into public.web_settings (key, value) values ('price_threshold', '1'::jsonb)$$, '23514', null, '목록에 없는 항목은 추가할 수 없음');
select throws_ok($$update public.web_settings set key = 'web_alert_daily_cap2' where key = 'web_alert_daily_cap'$$, '23000', null, '항목 이름 변경 불가');
select throws_ok($$delete from public.web_settings where key = 'web_alert_daily_cap'$$, '23000', null, '항목 삭제 불가');
select throws_ok($$truncate public.web_settings$$, '23000', null, '표 비우기 불가');

-- 기존 settings와의 분리: 기존 테이블에 웹 항목이 없고, 넣을 수도 없다 (기존 설정 읽기가 멈추지 않도록)
select is((select count(*)::int from public.settings where key like 'web\_%'), 0, '기존 settings 테이블에는 웹 항목이 없음');
select throws_ok($$insert into public.settings (key, value) values ('web_http_timeout_ms', '10000'::jsonb)$$, '23514', null, '기존 settings에는 웹 항목을 넣을 수 없음');

select * from finish();
rollback;
