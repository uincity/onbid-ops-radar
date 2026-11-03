// Design Ref: DESIGN §5.1(2. 조회), PRD 5-2 규칙 4~6, 7-6, SEC-10·11, 부록 A — PUBLIC 조회기 (온비드 부동산 물건목록·물건상세)
// 공공데이터포털 온비드 OpenAPI를 "읽기 전용(GET)"으로만 부른다.
//   public-list   = 부동산 물건목록 getRlstCltrList2   (호출 1번)
//   public-detail = 부동산 물건상세 getRlstDtlInf2     (목록에서 받은 물건마다 호출 1번)
// 안전 장치:
//   - https와 허용된 호스트(apis.data.go.kr)만 부른다. 그 밖의 주소는 호출 전에 거부한다.
//   - 서비스키는 서버 환경변수에서만 받는다. 주소(키 포함)는 로그·오류 문구·기록 어디에도 남기지 않는다.
//   - 요청마다 타임아웃(설정값), 엔진이 알려 준 남은 호출 수·남은 시간을 넘지 않는다.
//   - 서비스키·호출 한도 문제는 일반 실패와 구분하고, 그 순간 더 부르지 않는다.
//   - 저장하는 필드는 부록 A의 허용 목록뿐이다 (응답 전체를 저장하지 않는다).
import { findOperation } from "@/lib/registry";
import { checkResponseSchema, mergeSchemaChecks, type SchemaCheckResult } from "./probe/schema-check";
import { parseOnbidBody } from "./public-response";
import { LINK_VALUE_PATTERN } from "./cross-api";
import { createPacer } from "./service-limits";
import type { ApiCheckRecord, ApiFetchResult, ApiOutcome, FetchContext, FetchedRecord, Fetcher } from "./types";

export const PUBLIC_ALLOWED_HOSTS: readonly string[] = ["apis.data.go.kr"];
export const PUBLIC_LIST_URL = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2";
export const PUBLIC_DETAIL_URL = "https://apis.data.go.kr/B010003/OnbidRlstDtlSrvc2/getRlstDtlInf2";
export const PUBLIC_ENDPOINTS = ["public-list", "public-detail"] as const;
// 점검 이름 → 서비스 등록부(R01)의 오퍼레이션. 점검 상태 판정(승인·스키마)이 이 연결로 등록부 정보를 찾는다
export const PUBLIC_ENDPOINT_OPERATIONS: Record<(typeof PUBLIC_ENDPOINTS)[number], string> = {
  "public-list": "SVC-API-001/getRlstCltrList",
  "public-detail": "SVC-API-004/getRlstDtlInf",
};

// 부록 A: 저장을 허용하는 PUBLIC 필드. DB(collected_items)의 허용 목록과 같아야 한다 (마이그레이션 …_allow_public_fields).
export const PUBLIC_STORED_FIELDS = ["cltrMngNo", "pbctCdtnNo", "onbidCltrNm", "orgNm", "cltrBidBgngDt", "cltrBidEndDt", "pbctStatCd"] as const;

// 재산유형 전체(압류·국유·기타일반·불용품·공유·금융권담보·유입·수탁·공공개발·파산). 쉼표로 여러 개를 한 번에 요청할 수 있다.
const ALL_PROPERTY_TYPES = "0007,0010,0005,0004,0002,0003,0006,0008,0011,0013";
const MAX_LIST_ROWS = 100;

// 등록부의 점검 입력으로 부르는 추가 오퍼레이션 (일반 조회기). 요청은 1건(numOfRows=1)만 받아 호출 비용을 최소화하고, 응답은 저장하지 않고 판정에만 쓴다
export type ExtraOperation = {
  endpoint: string;
  operationKey: string;
  url: string;
  params: Record<string, string>;
  linkFields?: readonly string[]; // 응답에서 식별키 값을 뽑아 둘 항목 (교차 참조의 부모·자식)
  inputNames?: readonly string[]; // 엔진이 다른 오퍼레이션의 응답에서 얻어 넘겨주는 필수 입력 이름 (교차 참조의 자식)
};

export type PublicFetcherOptions = {
  serviceKey: string; // .env의 DATA_GO_KR_SERVICE_KEY (서버 전용)
  timeoutSeconds: number; // 설정값 api_timeout_seconds
  fetchImpl?: typeof fetch; // 시험에서 가짜 응답으로 바꿔 끼운다
  now?: () => number;
  extraOperations?: readonly ExtraOperation[]; // 목록·상세 외에 점검할 오퍼레이션 (generic-probe.ts가 만든다)
  callIntervalMs?: number | null; // 같은 서비스에 연달아 보내는 요청 사이의 최소 간격 (설정값 public_call_interval_ms). 비우면 기다리지 않는다
  sleep?: (ms: number) => Promise<void>; // 시험에서 바꿔 끼운다
};

// 발급받은 키가 이미 URL 인코딩된 형태(% 포함)면 그대로, 아니면 인코딩해서 쓴다. (한 번 더 인코딩하면 인증에 실패한다)
export function encodeServiceKey(raw: string): string {
  return /%[0-9A-Fa-f]{2}/.test(raw) ? raw : encodeURIComponent(raw);
}

// 호출 전에 주소를 검사한다 (SEC-10)
export function assertAllowedUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("허용되지 않은 주소입니다.");
  }
  if (parsed.protocol !== "https:" || !PUBLIC_ALLOWED_HOSTS.includes(parsed.hostname)) throw new Error("허용되지 않은 주소입니다.");
}

// 응답 값은 모두 문자열로 바꿔 담는다 (숫자로 오는 번호·날짜도 같은 모양으로). 없는 값(null·undefined)은 담지 않아 "없음"으로 남는다.
function pickStoredFields(item: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PUBLIC_STORED_FIELDS) {
    const value = item[key];
    if (value !== null && value !== undefined && typeof value !== "object") out[key] = String(value);
  }
  return out;
}

type CallResult = { check: ApiCheckRecord; items: Record<string, unknown>[] };

export function createPublicFetcher(options: PublicFetcherOptions): Fetcher {
  const { serviceKey, timeoutSeconds, fetchImpl = fetch, now = Date.now, extraOperations = [], callIntervalMs = null, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options;
  if (!serviceKey) throw new Error("DATA_GO_KR_SERVICE_KEY가 없습니다. .env을 확인해 주세요.");
  if (!(timeoutSeconds > 0)) throw new Error("타임아웃(초)은 0보다 커야 합니다.");
  const encodedKey = encodeServiceKey(serviceKey);
  const pacer = createPacer(callIntervalMs, now, sleep);

  const extraByName = new Map(extraOperations.map((e) => [e.endpoint, e]));
  // 점검 이름이 가리키는 등록부 오퍼레이션 키 ("서비스ID/오퍼레이션ID")
  const operationKeyOf = (name: string): string | undefined => PUBLIC_ENDPOINT_OPERATIONS[name as (typeof PUBLIC_ENDPOINTS)[number]] ?? extraByName.get(name)?.operationKey;

  // 목록에서 받은 물건들: 상세 조회의 입력
  let listed: { cltrMngNo: string; pbctCdtnNo: string }[] = [];

  // API 1번 호출. 어떤 일이 있어도 예외를 던지지 않고 결과(outcome)로 돌려준다. 키가 든 주소는 밖으로 나가지 않는다.
  async function call(endpointName: string, baseUrl: string, params: Record<string, string>): Promise<CallResult> {
    const url = `${baseUrl}?serviceKey=${encodedKey}&${new URLSearchParams(params).toString()}`;
    assertAllowedUrl(url);
    const [apiId, operationId] = (operationKeyOf(endpointName) ?? "/").split("/");
    await pacer.wait(apiId); // 같은 서비스로 가는 직전 요청과 최소 간격을 둔다 (응답 시간 측정에는 넣지 않는다)
    const started = now();
    // 기록용 요청 요약: 서비스키를 뺀 조회 조건만 (PRD 5-2-2 7단계, SEC-10)
    const requestSummary = new URLSearchParams(params).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    const done = (
      outcome: ApiOutcome,
      httpStatus: number | null,
      recordCount: number | null,
      items: Record<string, unknown>[] = [],
      resultCode: string | null = null,
      schema: SchemaCheckResult | null = null,
    ): CallResult => ({
      check: { endpointName, httpStatus, durationMs: Math.max(0, now() - started), outcome, recordCount, dataValid: outcome === "success" ? true : null, resultCode, schema, apiId: apiId || null, operationId: operationId || null, requestSummary },
      items,
    });
    try {
      const response = await fetchImpl(url, { method: "GET", signal: controller.signal, headers: { Accept: "application/json" } });
      if (response.status === 401 || response.status === 403 || response.status === 429) return done("auth_or_quota", response.status, null);
      if (!response.ok) return done("http_error", response.status, null);
      const parsed = parseOnbidBody(await response.text());
      if (parsed.kind === "ok") {
        // 필수 응답 항목 확인은 저장용으로 줄이기 전의 원본 항목에서 한다 (등록부의 응답 항목 기준)
        const fields = findOperation(operationKeyOf(endpointName) ?? "")?.operation.responseFields ?? [];
        return done("success", response.status, parsed.items.length, parsed.items, "00", checkResponseSchema(parsed.items, fields));
      }
      if (parsed.kind === "nodata") return done("empty_result", response.status, 0, [], parsed.code);
      if (parsed.kind === "auth_or_quota") return done("auth_or_quota", response.status, null, [], parsed.code);
      return done("http_error", response.status, null, [], parsed.code);
    } catch (error) {
      // 오류 객체에는 주소(키 포함)가 들어 있을 수 있어 문구를 옮기지 않는다
      return done(error instanceof Error && error.name === "AbortError" ? "timeout" : "http_error", null, null);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchList(context: FetchContext): Promise<ApiFetchResult> {
    // 남은 호출 중 1번은 목록에 쓰고, 나머지는 상세 조회에 쓸 수 있도록 가져올 물건 수를 정한다
    const rows = Math.min(MAX_LIST_ROWS, Math.max(1, context.remainingCalls - 1));
    const { check, items } = await call("public-list", PUBLIC_LIST_URL, {
      pageNo: "1",
      numOfRows: String(rows),
      resultType: "json",
      prptDivCd: ALL_PROPERTY_TYPES,
      pvctTrgtYn: "N",
    });
    const collectedAtMs = now();
    const seen = new Set<string>();
    const records: FetchedRecord[] = [];
    items.forEach((item, index) => {
      const fields = pickStoredFields(item);
      const itemKey = fields.cltrMngNo?.trim() ? fields.cltrMngNo : `NO-ID-${index + 1}`; // 식별값이 없어도 버리지 않고 필수정보 이상징후로 잡히게 한다
      if (seen.has(itemKey)) return; // 같은 물건이 중복 응답이면 첫 줄만 쓴다 (한 점검에서 같은 물건의 같은 종류는 한 줄)
      seen.add(itemKey);
      records.push({ itemKey, fields, collectedAtMs });
    });
    listed = records.flatMap((r) => {
      const { cltrMngNo, pbctCdtnNo } = r.fields;
      return typeof cltrMngNo === "string" && cltrMngNo && typeof pbctCdtnNo === "string" && pbctCdtnNo ? [{ cltrMngNo, pbctCdtnNo }] : [];
    });
    return { ...check, recordCount: check.outcome === "success" ? records.length : check.recordCount, records, httpCalls: 1 };
  }

  async function fetchDetails(context: FetchContext): Promise<ApiFetchResult> {
    const startedAll = now();
    const subChecks: ApiCheckRecord[] = [];
    const records: FetchedRecord[] = [];
    const requeried = { tried: 0, recovered: 0 };
    for (const target of listed) {
      if (subChecks.length >= context.remainingCalls) break; // 호출 상한
      if (now() - startedAll >= context.remainingMs) break; // 실행시간 제한
      const detailParams = { pageNo: "1", numOfRows: "1", resultType: "json", cltrMngNo: target.cltrMngNo, pbctCdtnNo: target.pbctCdtnNo };
      let { check, items } = await call("public-detail", PUBLIC_DETAIL_URL, detailParams);
      subChecks.push(check);
      // 상세가 0건이면 일시적인 응답 누락인지 구분하려고 호출 여유가 있을 때 한 번 더 조회한다. 그래도 0건이면 판정을 보류(UNVERIFIED)로 남긴다 (DQ_LIST_DETAIL_REF)
      if (check.outcome === "empty_result" && subChecks.length < context.remainingCalls && now() - startedAll < context.remainingMs) {
        requeried.tried += 1;
        ({ check, items } = await call("public-detail", PUBLIC_DETAIL_URL, detailParams));
        subChecks.push(check);
        if (check.outcome === "success" && items[0]) requeried.recovered += 1;
      }
      if (check.outcome === "success" && items[0]) {
        const fields = pickStoredFields(items[0]);
        records.push({ itemKey: target.cltrMngNo, fields, collectedAtMs: now() });
      }
      if (check.outcome === "auth_or_quota") break; // 키·한도 문제가 나면 더 부르지 않는다
    }

    // 하나의 조회 결과로 요약: 키·한도 문제 > 성공 > 전부 빈 결과 > 시간 초과 > 그 밖의 실패
    const has = (outcome: ApiOutcome) => subChecks.some((c) => c.outcome === outcome);
    const outcome: ApiOutcome = has("auth_or_quota")
      ? "auth_or_quota"
      : records.length > 0
        ? "success"
        : subChecks.length === 0 || subChecks.every((c) => c.outcome === "empty_result")
          ? "empty_result"
          : has("timeout")
            ? "timeout"
            : "http_error";
    // 요약의 결과코드: 서비스키·한도 문제가 있었다면 그 코드, 아니면 가장 마지막 호출의 코드
    const decisive = subChecks.find((c) => c.outcome === "auth_or_quota") ?? subChecks.at(-1);
    return {
      endpointName: "public-detail",
      resultCode: decisive?.resultCode ?? null,
      schema: mergeSchemaChecks(subChecks.map((c) => c.schema)),
      requestSummary: `물건관리번호·공매조건번호로 ${subChecks.length}건 조회`,
      httpStatus: subChecks.at(-1)?.httpStatus ?? null,
      durationMs: Math.max(0, now() - startedAll),
      outcome,
      recordCount: outcome === "success" ? records.length : outcome === "empty_result" ? 0 : null,
      dataValid: outcome === "success" ? true : null,
      records,
      httpCalls: subChecks.length,
      subChecks,
      requeried,
    };
  }

  // 추가 오퍼레이션 1개: 호출 1번. 조회 결과는 저장하지 않는다(records 비움)
  async function fetchExtra(extra: ExtraOperation, context: FetchContext): Promise<ApiFetchResult> {
    // 다른 오퍼레이션의 응답에서 얻은 입력값은 선언된 이름만 받고, 요청 주소에 넣어도 안전한 모양일 때만 쓴다
    const given: Record<string, string> = {};
    for (const name of extra.inputNames ?? []) {
      const value = context.inputs?.[name];
      if (value === undefined || !LINK_VALUE_PATTERN.test(value)) throw new Error(`'${extra.endpoint}'에 필요한 입력값(${name})이 없습니다.`);
      given[name] = value;
    }
    const { check, items } = await call(extra.endpoint, extra.url, { pageNo: "1", numOfRows: "1", resultType: "json", ...extra.params, ...given });
    const result: ApiFetchResult = { ...check, recordCount: check.outcome === "success" ? items.length : check.recordCount, records: [], httpCalls: 1 };
    if (extra.linkFields && check.outcome === "success") {
      result.linkValues = Object.fromEntries(
        extra.linkFields.map((field) => [field, items.slice(0, 5).map((item) => item[field]).filter((v): v is string | number => typeof v === "string" || typeof v === "number").map(String)]),
      );
    }
    return result;
  }

  return (endpoint, context) => {
    const extra = extraByName.get(endpoint);
    if (extra) return fetchExtra(extra, context);
    if (endpoint === "public-list") return fetchList(context);
    if (endpoint === "public-detail") return fetchDetails(context);
    throw new Error(`알 수 없는 PUBLIC 조회 이름입니다: ${endpoint}`);
  };
}
