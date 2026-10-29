// Design Ref: DESIGN §6.1(settings 14개 항목과 검증), §11.1(lib/settings), PRD 5-5(기본 설정값), CLAUDE.md(설정값은 한곳에서 관리)
// 설정값의 "모양·범위·기본값·항목 사이의 관계"를 한곳에 모은 순수한 파일이다. (DB·Next.js를 전혀 모른다 → 단위 테스트가 쉽다)
// DB(settings 테이블)에 같은 규칙이 한 번 더 걸려 있고, 두 곳이 어긋나지 않는지는 tests/unit/settings-drift.test.ts가 지켜본다.
import { z } from "zod";

export const SOURCES = ["DEMO", "PUBLIC"] as const;
export type Source = (typeof SOURCES)[number];

// 설정값에 문제가 있을 때 던지는 오류. 어떤 항목이 왜 문제인지를 모두 모아서 알려 준다.
export class SettingsError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`설정값에 문제가 있습니다: ${problems.join(" / ")}`);
    this.name = "SettingsError";
    this.problems = problems;
  }
}

// 정수 항목의 허용 범위 (DB의 settings_value_is_valid 함수와 같아야 한다)
export const INT_RANGES = {
  compare_window_minutes: { min: 1, max: 60 }, // 목록·상세 수집시각 허용 차이(분)
  api_timeout_seconds: { min: 1, max: 60 }, // API 요청별 타임아웃(초)
  api_call_limit_default: { min: 1, max: 100 }, // 호출 기본 상한(실행당)
  api_call_limit_max: { min: 1, max: 100 }, // 호출 최대 허용 상한(실행당)
  run_time_limit_seconds: { min: 10, max: 300 }, // 점검 작업 전체 실행시간 제한(초)
  reason_min_length: { min: 10, max: 100 }, // 사유 최소 글자 수(공백 제외). 이력 테이블이 10자 미만을 항상 거부하므로 10 아래로는 못 내린다
  schedule_missed_grace_minutes: { min: 1, max: 120 }, // 예약 점검 누락 판단 대기(분)
  stale_running_seconds: { min: 60, max: 600 }, // 멈춘 실행 정리 기준(초)
} as const;
export const PUBLIC_DAILY_BUDGET_RANGE = { min: 1, max: 1_000_000 } as const;

const intIn = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);
const fieldName = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);
const fieldList = z.array(fieldName).max(30);
const fieldsBySource = z.strictObject({ DEMO: fieldList.optional(), PUBLIC: fieldList.optional() });
const endpointName = z.string().regex(/^[A-Za-z0-9_.-]{1,60}$/);

export const SETTING_SCHEMAS = {
  compare_window_minutes: intIn(INT_RANGES.compare_window_minutes),
  api_timeout_seconds: intIn(INT_RANGES.api_timeout_seconds),
  api_call_limit_default: intIn(INT_RANGES.api_call_limit_default),
  api_call_limit_max: intIn(INT_RANGES.api_call_limit_max),
  public_daily_budget: intIn(PUBLIC_DAILY_BUDGET_RANGE).nullable(), // 승인 트래픽 확인 전에는 null(비움)
  run_time_limit_seconds: intIn(INT_RANGES.run_time_limit_seconds),
  reason_min_length: intIn(INT_RANGES.reason_min_length),
  schedule_missed_grace_minutes: intIn(INT_RANGES.schedule_missed_grace_minutes),
  stale_running_seconds: intIn(INT_RANGES.stale_running_seconds),
  scheduled_source: z.enum(SOURCES),
  required_fields: fieldsBySource,
  compare_fields: fieldsBySource,
  excluded_fields: fieldsBySource,
  empty_allowed_by_endpoint: z.record(endpointName, z.boolean()),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];
export type SettingValues = { [K in SettingKey]: z.infer<(typeof SETTING_SCHEMAS)[K]> };

// 오류 메시지에 쓰는 항목별 규칙 설명
const RULE_TEXT: Record<SettingKey, string> = {
  compare_window_minutes: `정수 ${INT_RANGES.compare_window_minutes.min}~${INT_RANGES.compare_window_minutes.max}`,
  api_timeout_seconds: `정수 ${INT_RANGES.api_timeout_seconds.min}~${INT_RANGES.api_timeout_seconds.max}`,
  api_call_limit_default: `정수 ${INT_RANGES.api_call_limit_default.min}~${INT_RANGES.api_call_limit_default.max}`,
  api_call_limit_max: `정수 ${INT_RANGES.api_call_limit_max.min}~${INT_RANGES.api_call_limit_max.max}`,
  public_daily_budget: `비움(null) 또는 정수 ${PUBLIC_DAILY_BUDGET_RANGE.min}~${PUBLIC_DAILY_BUDGET_RANGE.max}`,
  run_time_limit_seconds: `정수 ${INT_RANGES.run_time_limit_seconds.min}~${INT_RANGES.run_time_limit_seconds.max}`,
  reason_min_length: `정수 ${INT_RANGES.reason_min_length.min}~${INT_RANGES.reason_min_length.max}`,
  schedule_missed_grace_minutes: `정수 ${INT_RANGES.schedule_missed_grace_minutes.min}~${INT_RANGES.schedule_missed_grace_minutes.max}`,
  stale_running_seconds: `정수 ${INT_RANGES.stale_running_seconds.min}~${INT_RANGES.stale_running_seconds.max}`,
  scheduled_source: "DEMO 또는 PUBLIC",
  required_fields: "출처(DEMO/PUBLIC)별 필드 이름 목록",
  compare_fields: "출처(DEMO/PUBLIC)별 필드 이름 목록",
  excluded_fields: "출처(DEMO/PUBLIC)별 필드 이름 목록",
  empty_allowed_by_endpoint: "API 이름별 true/false",
};

// 코드에서 쓰기 편하게 이름을 camelCase로 바꾼 설정값
export type FieldsBySource = { DEMO?: string[]; PUBLIC?: string[] };
export type Settings = {
  compareWindowMinutes: number;
  apiTimeoutSeconds: number;
  apiCallLimitDefault: number;
  apiCallLimitMax: number;
  publicDailyBudget: number | null;
  runTimeLimitSeconds: number;
  reasonMinLength: number;
  scheduleMissedGraceMinutes: number;
  staleRunningSeconds: number;
  scheduledSource: Source;
  requiredFields: FieldsBySource;
  compareFields: FieldsBySource;
  excludedFields: FieldsBySource;
  emptyAllowedByEndpoint: Record<string, boolean>;
};

// PRD 5-5 기본값. DB 마이그레이션이 넣은 값과 같아야 한다 (tests/unit/settings-drift.test.ts가 확인).
// 코드는 이 값으로 몰래 대신하지 않는다. DB에서 읽지 못하면 오류로 멈추고, 이 값은 시험과 기준 확인에만 쓴다.
export const DEFAULT_SETTING_VALUES: SettingValues = {
  compare_window_minutes: 10,
  api_timeout_seconds: 10,
  api_call_limit_default: 20,
  api_call_limit_max: 100,
  public_daily_budget: null,
  run_time_limit_seconds: 60,
  reason_min_length: 10,
  schedule_missed_grace_minutes: 30,
  stale_running_seconds: 120,
  scheduled_source: "DEMO",
  // DEMO 필드는 PRD 부록 B. PUBLIC 항목은 부록 A 확정 후 추가한다.
  required_fields: { DEMO: ["demo_item_id", "item_name", "org_name", "bid_start_at", "bid_end_at"] },
  compare_fields: { DEMO: ["item_name", "org_name", "bid_start_at", "bid_end_at"] },
  excluded_fields: { DEMO: ["item_status"] },
  empty_allowed_by_endpoint: { "demo-list": false, "demo-detail": false },
};

function overlap(a: readonly string[] = [], b: readonly string[] = []): string[] {
  return a.filter((name) => b.includes(name));
}

// 항목 하나씩은 맞아도 서로 모순되면 안 된다. DB는 항목 하나씩만 검사하므로 두 항목 이상이 얽힌 규칙은 여기서 확인한다. (DESIGN 6.1)
export function findRelationProblems(settings: Settings): string[] {
  const problems: string[] = [];

  if (settings.apiCallLimitDefault > settings.apiCallLimitMax) {
    problems.push(
      `api_call_limit_default(${settings.apiCallLimitDefault})는 api_call_limit_max(${settings.apiCallLimitMax}) 이하여야 합니다`,
    );
  }
  if (settings.staleRunningSeconds <= settings.runTimeLimitSeconds) {
    problems.push(
      `stale_running_seconds(${settings.staleRunningSeconds})는 run_time_limit_seconds(${settings.runTimeLimitSeconds})보다 커야 합니다 (정상 실행 중인 점검을 멈춘 것으로 오해하지 않도록)`,
    );
  }
  for (const source of SOURCES) {
    const both = overlap(settings.compareFields[source], settings.excludedFields[source]);
    if (both.length > 0) {
      problems.push(`${source}: 비교 대상(compare_fields)과 비교 제외(excluded_fields)에 같은 필드가 있습니다: ${both.join(", ")}`);
    }
  }
  return problems;
}

export type SettingRow = { key: string; value: unknown };

// DB에서 읽은 줄들을 검증해서 Settings로 바꾼다. 문제가 하나라도 있으면 모아서 SettingsError로 던진다. (몰래 기본값으로 대신하지 않는다)
export function parseSettings(rows: readonly SettingRow[]): Settings {
  const problems: string[] = [];
  const raw = new Map<string, unknown>();

  for (const row of rows) {
    if (!(row.key in SETTING_SCHEMAS)) {
      problems.push(`알 수 없는 항목: ${row.key}`);
    } else if (raw.has(row.key)) {
      problems.push(`항목이 중복됨: ${row.key}`);
    } else {
      raw.set(row.key, row.value);
    }
  }

  const parsed: Partial<SettingValues> = {};
  for (const key of SETTING_KEYS) {
    if (!raw.has(key)) {
      problems.push(`항목이 없음: ${key}`);
      continue;
    }
    const result = SETTING_SCHEMAS[key].safeParse(raw.get(key));
    if (result.success) {
      (parsed as Record<string, unknown>)[key] = result.data;
    } else {
      problems.push(`${key}: 값이 규칙(${RULE_TEXT[key]})에 맞지 않습니다`);
    }
  }
  if (problems.length > 0) throw new SettingsError(problems);

  const p = parsed as SettingValues;
  const settings: Settings = {
    compareWindowMinutes: p.compare_window_minutes,
    apiTimeoutSeconds: p.api_timeout_seconds,
    apiCallLimitDefault: p.api_call_limit_default,
    apiCallLimitMax: p.api_call_limit_max,
    publicDailyBudget: p.public_daily_budget,
    runTimeLimitSeconds: p.run_time_limit_seconds,
    reasonMinLength: p.reason_min_length,
    scheduleMissedGraceMinutes: p.schedule_missed_grace_minutes,
    staleRunningSeconds: p.stale_running_seconds,
    scheduledSource: p.scheduled_source,
    requiredFields: p.required_fields,
    compareFields: p.compare_fields,
    excludedFields: p.excluded_fields,
    emptyAllowedByEndpoint: p.empty_allowed_by_endpoint,
  };

  const relationProblems = findRelationProblems(settings);
  if (relationProblems.length > 0) throw new SettingsError(relationProblems);
  return settings;
}

// 기본값을 Settings로 바꾼 것. 파일을 불러오는 순간 기본값 자체가 규칙에 맞는지도 확인된다.
export const DEFAULT_SETTINGS: Settings = parseSettings(
  SETTING_KEYS.map((key) => ({ key, value: DEFAULT_SETTING_VALUES[key] })),
);

// ----- 쓰기 편한 도우미 -----

// 출처별 필드 목록. 그 출처에 항목이 없으면 빈 목록이다. (부록 A 확정 전의 PUBLIC)
export function fieldsFor(fields: FieldsBySource, source: Source): readonly string[] {
  return fields[source] ?? [];
}

// API가 "빈 결과(0건)"를 정상으로 허용하는지. 설정에 없는 API는 허용하지 않는 것으로 본다. (PRD 5-2 규칙 4)
export function isEmptyAllowed(settings: Settings, endpoint: string): boolean {
  return settings.emptyAllowedByEndpoint[endpoint] === true;
}

// 이번 실행에서 쓸 API 호출 상한. 요청이 없으면 기본 상한, 최대 상한을 넘으면 최대 상한으로 줄인다. (PRD 5-5)
export function resolveCallLimit(settings: Settings, requested?: number): number {
  if (requested === undefined) return settings.apiCallLimitDefault;
  if (!Number.isInteger(requested) || requested < 1) throw new RangeError("호출 상한은 1 이상의 정수여야 합니다.");
  return Math.min(requested, settings.apiCallLimitMax);
}

export const apiTimeoutMs = (settings: Settings): number => settings.apiTimeoutSeconds * 1000;
export const runTimeLimitMs = (settings: Settings): number => settings.runTimeLimitSeconds * 1000;
export const compareWindowMs = (settings: Settings): number => settings.compareWindowMinutes * 60 * 1000;
