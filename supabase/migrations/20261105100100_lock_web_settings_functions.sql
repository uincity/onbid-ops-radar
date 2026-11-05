-- W05 후속: web_settings가 쓰는 DB 함수를 API로 직접 부를 수 없게 잠근다
-- Design Ref: 기존 20261029012205_create_reports_and_settings.sql의 settings 함수 처리 방식과 같음, CLAUDE.md(권한은 서버와 RLS에서 검사)
--
-- 왜: 새 함수는 기본으로 "누구나 실행 가능"이라 비로그인(anon)이 API로 직접 부를 수 있었고, 보안 점검 00_rls_guard 8번이 이를 잡아냈다.
-- 앞 마이그레이션(20261105100000)은 이미 적용되어 고치지 않고, 이 파일이 권한만 정리한다. 값 검사는 DB 안에서(제약 조건) 그대로 동작한다.

revoke all on function public.web_settings_value_is_valid(text, jsonb) from public, anon, authenticated;
revoke all on function public.web_settings_protect_keys() from public, anon, authenticated;
grant execute on function public.web_settings_value_is_valid(text, jsonb) to service_role;
