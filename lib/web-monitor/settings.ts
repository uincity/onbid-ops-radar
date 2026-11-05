// Design Ref: docs/design-homepage-monitoring.md §6.5 / Plan W05·D8 — 홈페이지 모니터링 전용 설정의 "모양·범위·기본값·항목 사이의 관계" (순수 파일)
// 기존 lib/settings와 완전히 분리되어 있다(기존 loadSettings·settings 테이블·드리프트 시험은 바꾸지 않음).
// 웹 설정이 틀리면 웹 점검만 WebSettingsError로 멈추고, OpenAPI 점검에는 영향이 없다.
// DB(web_settings 테이블)에 같은 규칙이 한 번 더 걸려 있고, 어긋나지 않는지는 tests/unit/web-settings-drift.test.ts가 지켜본다.
// 코드는 설정을 못 읽거나 규칙에 어긋나면 기본값으로 몰래 대신하지 않고 멈춘다. DEFAULT_WEB_SETTING_VALUES는 시험과 기준 확인에만 쓴다.
import { z } from "zod";

export class WebSettingsError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`홈페이지 모니터링 설정에 문제가 있습니다: ${problems.join(" / ")}`);
    this.name = "WebSettingsError";
    this.problems = problems;
  }
}

// 정수 항목의 허용 범위 (DB의 web_settings_value_is_valid 함수와 같아야 한다)
export const WEB_INT_RANGES = {
  web_http_timeout_ms: { min: 1000, max: 30000 }, // 요청 타임아웃(ms)
  web_http_slow_ms: { min: 500, max: 29999 }, // 느림 기준(ms). 타임아웃보다 작아야 한다(관계 검사)
  web_confirm_retry_delay_sec: { min: 30, max: 600 }, // 일시 실패 확인 재시도까지 대기(초)
  web_realert_after_hours: { min: 1, max: 24 }, // 장애 지속 재알림 간격(시간)
  web_degraded_alert_count: { min: 1, max: 10 }, // 저하 알림 연속 횟수
  web_unverifiable_alert_count: { min: 1, max: 10 }, // 검증 불가 알림 연속 횟수
  web_aux_alert_count: { min: 1, max: 10 }, // 보조 점검 이상 알림 연속 횟수
  web_cert_warn_days: { min: 1, max: 60 }, // 인증서 만료 임박 기준(일)
  web_heartbeat_stale_min: { min: 90, max: 1440 }, // 모니터 정지 판단(분). 1시간 주기보다 커야 해서 90분부터
  web_heartbeat_realert_hours: { min: 1, max: 168 }, // 모니터 정지 재알림 간격(시간)
  web_freshness_max_hours: { min: 1, max: 168 }, // 신선도 기준(시간, M3)
  web_result_retention_days: { min: 7, max: 365 }, // 점검 결과 보존 기간(일)
  web_alert_daily_cap: { min: 1, max: 100 }, // 하루 알림 상한(건)
  web_run_time_limit_seconds: { min: 10, max: 85 }, // 웹 점검 전체 시간 제한(초). maxDuration 90초보다 작아야 함
  web_stale_running_seconds: { min: 60, max: 600 }, // 멈춘 실행 정리 기준(초). 실행 한도보다 커야 함(관계 검사)
  web_request_gap_ms: { min: 0, max: 5000 }, // 요청 사이 최소 간격(ms)
  web_notify_timeout_ms: { min: 1000, max: 30000 }, // 텔레그램 요청 타임아웃(ms)
  web_window_max_hours: { min: 1, max: 720 }, // 계획 점검 창 최대 길이(시간)
  web_unplanned_escalate_hours: { min: 1, max: 48 }, // 점검 문구가 창 없이 이어질 때 일반 실패로 승격하는 시간(시간)
} as const;

export const WEB_SETTING_SCHEMAS = {
  ...(Object.fromEntries(
    Object.entries(WEB_INT_RANGES).map(([key, r]) => [key, z.number().int().min(r.min).max(r.max)]),
  ) as { [K in keyof typeof WEB_INT_RANGES]: z.ZodNumber }),
  web_monitor_enabled: z.boolean(),
} as const;

export type WebSettingKey = keyof typeof WEB_SETTING_SCHEMAS;
export const WEB_SETTING_KEYS = Object.keys(WEB_SETTING_SCHEMAS) as WebSettingKey[];
export type WebSettingValues = { [K in WebSettingKey]: z.infer<(typeof WEB_SETTING_SCHEMAS)[K]> };

// 계획서 4.4 기본값. DB 마이그레이션이 넣은 값과 같아야 한다(web-settings-drift 시험이 확인)
export const DEFAULT_WEB_SETTING_VALUES: WebSettingValues = {
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

// 코드에서 쓰기 편한 이름(camelCase)의 웹 설정
export type WebSettings = {
  httpTimeoutMs: number;
  httpSlowMs: number;
  confirmRetryDelaySec: number;
  realertAfterHours: number;
  degradedAlertCount: number;
  unverifiableAlertCount: number;
  auxAlertCount: number;
  certWarnDays: number;
  heartbeatStaleMin: number;
  heartbeatRealertHours: number;
  freshnessMaxHours: number;
  resultRetentionDays: number;
  alertDailyCap: number;
  runTimeLimitSeconds: number;
  staleRunningSeconds: number;
  requestGapMs: number;
  notifyTimeoutMs: number;
  windowMaxHours: number;
  unplannedEscalateHours: number;
  monitorEnabled: boolean;
};

// 점검 경로(app/api/cron/web-check)의 maxDuration(초). 웹 점검 시간 제한은 이보다 작아야 한다
export const WEB_ROUTE_MAX_DURATION_SECONDS = 90;

// 항목 하나씩은 맞아도 서로 모순되면 안 된다. DB는 항목 하나씩만 검사하므로 둘 이상이 얽힌 규칙은 여기서 확인한다
export function findWebRelationProblems(s: WebSettings): string[] {
  const problems: string[] = [];
  if (s.httpSlowMs >= s.httpTimeoutMs) {
    problems.push(`web_http_slow_ms(${s.httpSlowMs})는 web_http_timeout_ms(${s.httpTimeoutMs})보다 작아야 합니다 (느림 판정이 타임아웃에 가려지지 않도록)`);
  }
  if (s.staleRunningSeconds <= s.runTimeLimitSeconds) {
    problems.push(`web_stale_running_seconds(${s.staleRunningSeconds})는 web_run_time_limit_seconds(${s.runTimeLimitSeconds})보다 커야 합니다 (정상 실행 중인 점검을 멈춘 것으로 오해하지 않도록)`);
  }
  if (s.runTimeLimitSeconds >= WEB_ROUTE_MAX_DURATION_SECONDS) {
    problems.push(`web_run_time_limit_seconds(${s.runTimeLimitSeconds})는 점검 경로의 최대 실행 시간(${WEB_ROUTE_MAX_DURATION_SECONDS}초)보다 작아야 합니다`);
  }
  return problems;
}

export type WebSettingRow = { key: string; value: unknown };

const RULE_TEXT = (key: WebSettingKey): string => {
  if (key === "web_monitor_enabled") return "true 또는 false";
  const r = WEB_INT_RANGES[key];
  return `정수 ${r.min}~${r.max}`;
};

// DB에서 읽은 줄들을 검증해서 WebSettings로 바꾼다. 문제가 하나라도 있으면 모아서 던진다(몰래 기본값으로 대신하지 않는다)
export function parseWebSettings(rows: readonly WebSettingRow[]): WebSettings {
  const problems: string[] = [];
  const raw = new Map<string, unknown>();
  for (const row of rows) {
    if (!(row.key in WEB_SETTING_SCHEMAS)) problems.push(`알 수 없는 항목: ${row.key}`);
    else if (raw.has(row.key)) problems.push(`항목이 중복됨: ${row.key}`);
    else raw.set(row.key, row.value);
  }

  const parsed: Partial<WebSettingValues> = {};
  for (const key of WEB_SETTING_KEYS) {
    if (!raw.has(key)) {
      problems.push(`항목이 없음: ${key}`);
      continue;
    }
    const result = WEB_SETTING_SCHEMAS[key].safeParse(raw.get(key));
    if (result.success) (parsed as Record<string, unknown>)[key] = result.data;
    else problems.push(`${key}: 값이 규칙(${RULE_TEXT(key)})에 맞지 않습니다`);
  }
  if (problems.length > 0) throw new WebSettingsError(problems);

  const p = parsed as WebSettingValues;
  const settings: WebSettings = {
    httpTimeoutMs: p.web_http_timeout_ms,
    httpSlowMs: p.web_http_slow_ms,
    confirmRetryDelaySec: p.web_confirm_retry_delay_sec,
    realertAfterHours: p.web_realert_after_hours,
    degradedAlertCount: p.web_degraded_alert_count,
    unverifiableAlertCount: p.web_unverifiable_alert_count,
    auxAlertCount: p.web_aux_alert_count,
    certWarnDays: p.web_cert_warn_days,
    heartbeatStaleMin: p.web_heartbeat_stale_min,
    heartbeatRealertHours: p.web_heartbeat_realert_hours,
    freshnessMaxHours: p.web_freshness_max_hours,
    resultRetentionDays: p.web_result_retention_days,
    alertDailyCap: p.web_alert_daily_cap,
    runTimeLimitSeconds: p.web_run_time_limit_seconds,
    staleRunningSeconds: p.web_stale_running_seconds,
    requestGapMs: p.web_request_gap_ms,
    notifyTimeoutMs: p.web_notify_timeout_ms,
    windowMaxHours: p.web_window_max_hours,
    unplannedEscalateHours: p.web_unplanned_escalate_hours,
    monitorEnabled: p.web_monitor_enabled,
  };
  const relationProblems = findWebRelationProblems(settings);
  if (relationProblems.length > 0) throw new WebSettingsError(relationProblems);
  return settings;
}

// 기본값을 WebSettings로 바꾼 것. 파일을 불러오는 순간 기본값 자체가 규칙에 맞는지도 확인된다
export const DEFAULT_WEB_SETTINGS: WebSettings = parseWebSettings(WEB_SETTING_KEYS.map((key) => ({ key, value: DEFAULT_WEB_SETTING_VALUES[key] })));

// ----- 쓰기 편한 도우미 -----
export const webTimeoutMs = (s: WebSettings): number => s.httpTimeoutMs;
export const webRunTimeLimitMs = (s: WebSettings): number => s.runTimeLimitSeconds * 1000;
export const webStaleRunningMs = (s: WebSettings): number => s.staleRunningSeconds * 1000;
export const webHeartbeatStaleMs = (s: WebSettings): number => s.heartbeatStaleMin * 60 * 1000;
