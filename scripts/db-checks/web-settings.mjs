// web_settings(홈페이지 모니터링 설정) 테이블이 설계서 6.5·계획서 4.4대로 만들어졌는지 확인한다 (W05)
// 값의 범위 동작 시험은 pgTAP 13_web_settings.test.sql이 롤백되는 트랜잭션 안에서 한다.
export const title = "웹 설정값 (web_settings)";

// 계획서 4.4 기본값 (마이그레이션이 넣은 값과 같아야 한다)
const EXPECTED = {
  web_http_timeout_ms: 10000,
  web_http_slow_ms: 3000,
  web_confirm_retry_delay_sec: 90,
  web_realert_after_hours: 3,
  web_degraded_alert_count: 2,
  web_unverifiable_alert_count: 3,
  web_aux_alert_count: 3,
  web_cert_warn_days: 14,
  web_heartbeat_stale_min: 130,
  web_heartbeat_realert_hours: 24,
  web_freshness_max_hours: 24,
  web_result_retention_days: 90,
  web_alert_daily_cap: 12,
  web_run_time_limit_seconds: 60,
  web_stale_running_seconds: 180,
  web_request_gap_ms: 500,
  web_notify_timeout_ms: 5000,
  web_window_max_hours: 168,
  web_unplanned_escalate_hours: 6,
  web_monitor_enabled: true,
};

export async function run(ctx) {
  const { report, query, checkReadOnlyTable } = ctx;

  // 공통: 테이블·RLS·칸·정책·권한·로그인 없는 접근 거부 (web_settings는 id 칸이 없어 key로 읽기 시험)
  await checkReadOnlyTable("web_settings", ["key", "value", "updated_at"], { key: "web_http_timeout_ms", value: 10000 }, { selectColumn: "key" });

  const rows = await query("select key, value from public.web_settings order by key");
  const actual = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  report(rows.length === Object.keys(EXPECTED).length, `웹 설정 항목 ${Object.keys(EXPECTED).length}개가 모두 있음`, `${rows.length}개`);

  // 운영하며 바꾸는 값(켜기/끄기)은 값 종류만 본다. 나머지는 기본값 그대로여야 한다(다른 값으로 바꿨다면 마이그레이션과 코드 기본값을 함께 고친다)
  const OPERATIONAL = ["web_monitor_enabled"];
  report(typeof actual.web_monitor_enabled === "boolean", "web_monitor_enabled가 true/false", `현재 ${JSON.stringify(actual.web_monitor_enabled)}`);
  const wrong = Object.entries(EXPECTED)
    .filter(([key]) => !OPERATIONAL.includes(key))
    .filter(([key, value]) => JSON.stringify(actual[key]) !== JSON.stringify(value))
    .map(([key]) => key);
  report(wrong.length === 0, "웹 설정 기본값이 계획서 4.4와 같음", wrong.length ? `다른 항목: ${wrong.join(", ")}` : undefined);

  // 항목 사이 관계 (DB는 한 줄씩만 검사하므로 현재 값이 코드 규칙에도 맞는지 본다)
  report(actual.web_http_slow_ms < actual.web_http_timeout_ms, "느림 기준이 타임아웃보다 작음");
  report(actual.web_run_time_limit_seconds < actual.web_stale_running_seconds, "실행 시간 제한이 멈춘 실행 기준보다 작음");
  report(actual.web_run_time_limit_seconds < 90, "실행 시간 제한이 점검 경로 최대 실행 시간(90초)보다 작음");

  // 기존 settings와 분리되어 있는지: 기존 테이블에 웹 항목이 없어야 기존 설정 읽기가 멈추지 않는다
  const [leak] = await query("select count(*)::int as n from public.settings where key like 'web\\_%'");
  report(leak?.n === 0, "기존 settings 테이블에 웹 항목이 섞이지 않음 (설정 읽기 격리)", `${leak?.n}개`);

  // 제약·트리거
  const constraints = await query("select conname from pg_constraint where conrelid = 'public.web_settings'::regclass");
  const names = constraints.map((c) => c.conname);
  report(names.includes("web_settings_key_check") && names.includes("web_settings_value_valid_check"), "web_settings: 항목 이름 목록·값 범위 제약 있음");
  const triggers = await query("select tgname from pg_trigger where tgrelid = 'public.web_settings'::regclass and not tgisinternal");
  const trg = triggers.map((t) => t.tgname);
  report(["web_settings_set_updated_at", "web_settings_protect_update", "web_settings_protect_delete", "web_settings_protect_truncate"].every((n) => trg.includes(n)), "web_settings: 변경 시각 갱신·이름 변경/삭제/비우기 차단 트리거 있음");
}
