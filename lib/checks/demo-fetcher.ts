// Design Ref: DESIGN §5.1(2. 조회) / PRD 5-2 규칙 4 — DEMO 조회기
// 실제 네트워크 없이 "정상 · HTTP 오류 · 타임아웃 · 0건" 네 가지 응답을 흉내 낸다.
// 진짜 기다리지 않고(가상 응답시간), 지금 시각을 몰래 읽지도 않는다. 같은 입력이면 항상 같은 결과가 나온다.
// 이 조회기는 DB에 아무것도 쓰지 않는다. 결과를 api_checks 등에 기록하는 일은 점검 엔진(PLAN 22번)이 한다.
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import type { DemoFields, DemoScenario } from "@/lib/demo/types";

// 설정값 empty_allowed_by_endpoint의 키와 같은 이름이다. (api_checks.endpoint_name 형식: 영문·숫자·_.- 60자 이내)
export const DEMO_ENDPOINTS = ["demo-list", "demo-detail"] as const;
export type DemoEndpoint = (typeof DEMO_ENDPOINTS)[number];

// 흉내 낼 응답 종류
export const DEMO_MODES = ["normal", "http_error", "timeout", "empty"] as const;
export type DemoMode = (typeof DEMO_MODES)[number];

// api_checks.outcome 중 DEMO가 만드는 값 (서비스키·한도 문제는 PUBLIC 조회기 몫)
export type DemoOutcome = "success" | "http_error" | "timeout" | "empty_result";

export type FetchedRecord = {
  itemKey: string; // 물건 식별값 (demo_item_id)
  fields: DemoFields;
  collectedAtMs: number; // 이 줄을 수집한 시각. 상세는 목록 기준 detailOffsetSeconds만큼 떨어진다
};

export type DemoFetchResult = {
  endpointName: DemoEndpoint;
  httpStatus: number | null; // 응답을 못 받은 타임아웃은 null
  durationMs: number; // 타임아웃이면 제한 시간과 같다
  outcome: DemoOutcome;
  recordCount: number | null; // 응답을 못 받으면 null
  dataValid: boolean | null; // HTTP 200이어도 데이터가 쓸 만한지는 따로 본다. 판단할 데이터가 없으면 null
  records: FetchedRecord[];
};

export type DemoFetchOptions = {
  endpoint: DemoEndpoint;
  mode?: DemoMode;
  timeoutSeconds: number; // 설정값 api_timeout_seconds (10초)
  baseMs: number; // 목록을 수집한 시각 (호출하는 쪽이 정해서 넘긴다)
  scenarios?: readonly DemoScenario[]; // 기본은 DEMO 160건
  itemIds?: readonly string[]; // 주면 이 물건만 돌려준다
  latencyMs?: number; // 가상 응답시간. 기본값은 종류별로 정해져 있다
};

// 종류별 가상 응답시간(ms). timeout은 제한 시간을 넘기는 값이어야 해서 아래에서 따로 계산한다.
const DEFAULT_LATENCY_MS: Record<Exclude<DemoMode, "timeout">, number> = { normal: 120, http_error: 80, empty: 90 };

export function fetchDemo(options: DemoFetchOptions): DemoFetchResult {
  const { endpoint, mode = "normal", timeoutSeconds, baseMs, scenarios = DEMO_SCENARIOS, itemIds, latencyMs } = options;
  if (!DEMO_ENDPOINTS.includes(endpoint)) throw new Error(`알 수 없는 DEMO 조회 이름입니다: ${endpoint}`);
  if (!DEMO_MODES.includes(mode)) throw new Error(`알 수 없는 DEMO 응답 종류입니다: ${mode}`);
  if (!(timeoutSeconds > 0)) throw new Error("타임아웃(초)은 0보다 커야 합니다.");

  const timeoutMs = timeoutSeconds * 1000;
  const noRecords = (outcome: DemoOutcome, httpStatus: number | null, durationMs: number): DemoFetchResult => ({
    endpointName: endpoint,
    httpStatus,
    durationMs,
    outcome,
    recordCount: null,
    dataValid: null,
    records: [],
  });

  // 가상 응답시간이 제한 시간을 넘으면 어떤 종류든 타임아웃이다 (응답이 10초를 넘으면 실패, PRD 5-2 규칙 4)
  const wanted = mode === "timeout" ? timeoutMs + 1000 : (latencyMs ?? DEFAULT_LATENCY_MS[mode]);
  if (wanted > timeoutMs) return noRecords("timeout", null, timeoutMs);

  if (mode === "http_error") return noRecords("http_error", 500, wanted);
  if (mode === "empty") return { ...noRecords("empty_result", 200, wanted), recordCount: 0 }; // 응답은 왔지만 0건

  // 정상: 목록이면 목록 줄을, 상세면 상세 줄을 돌려준다. 없는 쪽(DEMO-0158 상세 없음 등)은 빠진다.
  const records: FetchedRecord[] = [];
  for (const s of scenarios) {
    if (itemIds && !itemIds.includes(s.id)) continue;
    if (endpoint === "demo-list" && s.list) records.push({ itemKey: s.id, fields: s.list, collectedAtMs: baseMs });
    if (endpoint === "demo-detail" && s.detail) records.push({ itemKey: s.id, fields: s.detail, collectedAtMs: baseMs + s.detailOffsetSeconds * 1000 });
  }
  // 정상 응답인데 0건이면(조회 대상이 없을 때) 빈 결과로 구분한다
  if (records.length === 0) return { ...noRecords("empty_result", 200, wanted), recordCount: 0 };
  return { endpointName: endpoint, httpStatus: 200, durationMs: wanted, outcome: "success", recordCount: records.length, dataValid: true, records };
}
