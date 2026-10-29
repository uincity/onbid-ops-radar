// Design Ref: PRD 5-2 규칙 4·6, 부록 A — 온비드 OpenAPI 응답 해석 (순수 함수, 네트워크·DB를 모른다)
// 응답은 세 가지 모양으로 올 수 있다.
//   1) 정상 JSON: { header: { resultCode }, body: { items: { item: [...] | {...} }, totalCount } }
//   2) 오류·데이터없음 JSON: { result: { resultCode: "03", resultMsg: "NODATA_ERROR" } }   (명세 3장 결과코드표)
//   3) 공공데이터포털 관문이 키 문제를 XML로 돌려주는 경우: <OpenAPI_ServiceResponse>…<returnReasonCode>30</returnReasonCode>…
// 인증·한도 문제(코드 20·21·22·30·31·32·33)는 일반 실패와 구분한다. 이런 실행에서는 데이터 이상징후를 만들지 않는다.

export type OnbidParsed =
  | { kind: "ok"; items: Record<string, unknown>[]; totalCount: number | null }
  | { kind: "nodata" } // 결과코드 03, 또는 정상인데 0건
  | { kind: "auth_or_quota"; code: string }
  | { kind: "error"; code: string };

// 명세 3장 "응답 메시지 결과코드" 중 서비스키·호출 한도와 관련된 것
export const AUTH_OR_QUOTA_CODES: ReadonlySet<string> = new Set(["20", "21", "22", "30", "31", "32", "33"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function classify(code: string): OnbidParsed {
  if (code === "03") return { kind: "nodata" };
  if (AUTH_OR_QUOTA_CODES.has(code)) return { kind: "auth_or_quota", code };
  return { kind: "error", code };
}

// item이 한 건이면 배열이 아니라 객체로 오기도 하고, 0건이면 빈 문자열이 오기도 한다
function toItemArray(items: unknown): Record<string, unknown>[] {
  if (!isObject(items)) return [];
  const item = items.item;
  if (Array.isArray(item)) return item.filter(isObject);
  return isObject(item) ? [item] : [];
}

function parseXmlError(text: string): OnbidParsed {
  const code = /<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/.exec(text)?.[1] ?? /<resultCode>\s*(\d+)\s*<\/resultCode>/.exec(text)?.[1];
  return code ? classify(code) : { kind: "error", code: "XML" };
}

export function parseOnbidBody(bodyText: string): OnbidParsed {
  const text = bodyText.trim();
  if (text.startsWith("<")) return parseXmlError(text);

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: "error", code: "PARSE" };
  }
  if (!isObject(data)) return { kind: "error", code: "PARSE" };

  const header = isObject(data.header) ? data.header : isObject(data.result) ? data.result : null;
  const code = header && header.resultCode != null ? String(header.resultCode) : "";
  if (code !== "00") return code ? classify(code) : { kind: "error", code: "NO_CODE" };

  const body = isObject(data.body) ? data.body : {};
  const items = toItemArray(body.items);
  const totalCount = typeof body.totalCount === "number" ? body.totalCount : body.totalCount != null && /^\d+$/.test(String(body.totalCount)) ? Number(body.totalCount) : null;
  if (items.length === 0) return { kind: "nodata" };
  return { kind: "ok", items, totalCount };
}
