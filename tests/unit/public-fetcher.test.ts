// PUBLIC 조회기 시험 (PLAN 작업 33) — 가짜 fetch로 돌린다. 실제 네트워크는 쓰지 않는다.
// 확인하는 것: 허용 호스트·https만 · 서비스키 처리(이중 인코딩 방지, 기록에 키가 남지 않음) · 목록/상세 호출 방식 ·
//              호출 상한·시간 제한 · 오류 구분(타임아웃/HTTP 오류/서비스키·한도 문제/빈 결과) · 저장 필드 제한
import { describe, expect, it } from "vitest";
import { PUBLIC_STORED_FIELDS, assertAllowedUrl, createPublicFetcher, encodeServiceKey } from "@/lib/checks/public-fetcher";

const KEY_ENCODED = "abc%2Fdef%2Bghi%3D%3D"; // 발급 형태: 이미 URL 인코딩된 키
const SECRET_PART = "def%2Bghi";
const CTX = { remainingCalls: 20, remainingMs: 60_000 };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const okBody = (item: unknown) => ({ header: { resultCode: "00", resultMsg: "NORMAL_CODE" }, body: { items: { item }, numOfRows: 1, pageNo: 1, totalCount: Array.isArray(item) ? item.length : 1 } });
const listItem = (n: number, over: Record<string, unknown> = {}) => ({
  cltrMngNo: `2026-1100-00000${n}`,
  pbctCdtnNo: 3600000 + n, // 숫자로 오는 번호
  onbidCltrNm: `물건 ${n}`,
  orgNm: "한국자산관리공사",
  cltrBidBgngDt: "202605180900",
  cltrBidEndDt: "202605201700",
  pbctStatCd: "0002",
  cltrRadr: "개인정보가 섞일 수 있는 주소", // 저장하면 안 되는 필드
  thnlImgUrlAdr: "https://example.invalid/x.png",
  ...over,
});

type Handler = (url: string, init: RequestInit | undefined, call: number) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    return handler(url, init, urls.length);
  }) as typeof fetch;
  return { impl, urls };
}

const make = (handler: Handler, over: { timeoutSeconds?: number; now?: () => number; serviceKey?: string } = {}) => {
  const f = fakeFetch(handler);
  const fetcher = createPublicFetcher({ serviceKey: KEY_ENCODED, timeoutSeconds: 10, fetchImpl: f.impl, ...over });
  return { fetcher, urls: f.urls };
};
const param = (url: string, name: string) => new URL(url).searchParams.get(name);

describe("주소와 서비스키", () => {
  it("https와 허용 호스트(apis.data.go.kr)만 통과한다", () => {
    expect(() => assertAllowedUrl("https://apis.data.go.kr/B010003/x")).not.toThrow();
    for (const bad of ["http://apis.data.go.kr/x", "https://evil.example.com/x", "https://apis.data.go.kr.evil.com/x", "ftp://apis.data.go.kr/x", "not a url"]) {
      expect(() => assertAllowedUrl(bad), bad).toThrow();
    }
  });

  it("이미 인코딩된 키는 그대로, 원본 키는 인코딩해서 쓴다 (이중 인코딩 방지)", () => {
    expect(encodeServiceKey(KEY_ENCODED)).toBe(KEY_ENCODED);
    expect(encodeServiceKey("abc/def+ghi==")).toBe("abc%2Fdef%2Bghi%3D%3D");
    expect(encodeServiceKey("plainkey123")).toBe("plainkey123");
  });

  it("요청 주소에 키가 인코딩된 그대로 한 번만 들어간다", async () => {
    const { fetcher, urls } = make(() => json(okBody([listItem(1)])));
    await fetcher("public-list", CTX);
    expect(urls[0]).toContain(`serviceKey=${KEY_ENCODED}&`);
    expect(urls[0]).not.toContain("%252F"); // 한 번 더 인코딩되지 않았다
    expect(urls[0].startsWith("https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2?")).toBe(true);
  });

  it("키가 없으면 만들 때 멈춘다", () => {
    expect(() => createPublicFetcher({ serviceKey: "", timeoutSeconds: 10 })).toThrow();
  });

  it("모르는 조회 이름은 멈춘다", () => {
    const { fetcher } = make(() => json(okBody([])));
    expect(() => fetcher("x-list", CTX)).toThrow();
  });
});

describe("public-list (부동산 물건목록)", () => {
  it("명세대로 요청한다: 1쪽·JSON·재산유형 전체·수의계약 N, 가져올 수는 남은 호출 − 1", async () => {
    const { fetcher, urls } = make(() => json(okBody([listItem(1)])));
    await fetcher("public-list", CTX);
    expect(param(urls[0], "pageNo")).toBe("1");
    expect(param(urls[0], "resultType")).toBe("json");
    expect(param(urls[0], "pvctTrgtYn")).toBe("N");
    expect(param(urls[0], "prptDivCd")).toBe("0007,0010,0005,0004,0002,0003,0006,0008,0011,0013");
    expect(param(urls[0], "numOfRows")).toBe("19");
  });

  it.each([
    [1, "1"],
    [2, "1"],
    [21, "20"],
    [500, "100"], // 한 쪽 최대 100건
  ])("남은 호출 %i회 → numOfRows %s", async (remaining, rows) => {
    const { fetcher, urls } = make(() => json(okBody([listItem(1)])));
    await fetcher("public-list", { remainingCalls: remaining, remainingMs: 60_000 });
    expect(param(urls[0], "numOfRows")).toBe(rows);
  });

  it("저장하는 필드는 허용 목록 7개뿐이고, 숫자는 문자열로 바꾼다 (주소·이미지 같은 필드는 버린다)", async () => {
    const { fetcher } = make(() => json(okBody([listItem(1)])));
    const r = await fetcher("public-list", CTX);
    expect(r).toMatchObject({ endpointName: "public-list", outcome: "success", httpStatus: 200, recordCount: 1, dataValid: true, httpCalls: 1 });
    const fields = r.records[0].fields;
    expect(Object.keys(fields).sort()).toEqual([...PUBLIC_STORED_FIELDS].sort());
    expect(fields.pbctCdtnNo).toBe("3600001");
    expect(r.records[0].itemKey).toBe("2026-1100-000001");
  });

  it("같은 물건이 두 번 오면 첫 줄만 쓰고, 식별값이 없는 물건도 버리지 않고 자리표시 키로 남긴다", async () => {
    const { fetcher } = make(() => json(okBody([listItem(1), listItem(1, { onbidCltrNm: "중복" }), listItem(2, { cltrMngNo: undefined })])));
    const r = await fetcher("public-list", CTX);
    expect(r.records.map((x) => x.itemKey)).toEqual(["2026-1100-000001", "NO-ID-3"]);
    expect(r.records[0].fields.onbidCltrNm).toBe("물건 1");
    expect(r.records[1].fields.cltrMngNo).toBeUndefined();
  });

  it("item이 한 건이라 객체로 와도 읽는다", async () => {
    const { fetcher } = make(() => json(okBody(listItem(1))));
    expect((await fetcher("public-list", CTX)).records).toHaveLength(1);
  });
});

describe("public-detail (부동산 물건상세)", () => {
  // 목록 → 상세 순서로 부르는 도우미
  async function listThenDetail(detailHandler: (cltrMngNo: string, call: number) => Response | Promise<Response>, items = [listItem(1), listItem(2), listItem(3)], ctx = CTX, over = {}) {
    let detailCalls = 0;
    const { fetcher, urls } = make((url) => {
      if (url.includes("getRlstCltrList2")) return json(okBody(items));
      detailCalls += 1;
      return detailHandler(param(url, "cltrMngNo")!, detailCalls);
    }, over);
    await fetcher("public-list", CTX);
    const detail = await fetcher("public-detail", ctx);
    return { detail, urls };
  }
  const detailBody = (id: string, over: Record<string, unknown> = {}) => json(okBody(listItem(Number(id.slice(-1)), { ...over })));

  it("목록에서 받은 물건마다 물건관리번호·공매조건번호로 한 번씩 부른다", async () => {
    const { detail, urls } = await listThenDetail((id) => detailBody(id));
    const detailUrls = urls.filter((u) => u.includes("getRlstDtlInf2"));
    expect(detailUrls).toHaveLength(3);
    expect(param(detailUrls[0], "cltrMngNo")).toBe("2026-1100-000001");
    expect(param(detailUrls[0], "pbctCdtnNo")).toBe("3600001");
    expect(param(detailUrls[0], "numOfRows")).toBe("1");
    expect(detail).toMatchObject({ endpointName: "public-detail", outcome: "success", recordCount: 3, httpCalls: 3 });
    expect(detail.subChecks).toHaveLength(3);
    expect(detail.records.map((r) => r.itemKey)).toEqual(["2026-1100-000001", "2026-1100-000002", "2026-1100-000003"]);
  });

  it("남은 호출 수를 넘지 않는다 (경계: 2회 남으면 2번만, 3회 남으면 3번)", async () => {
    const two = await listThenDetail((id) => detailBody(id), undefined, { remainingCalls: 2, remainingMs: 60_000 });
    expect(two.detail.httpCalls).toBe(2);
    expect(two.detail.records).toHaveLength(2);
    const three = await listThenDetail((id) => detailBody(id), undefined, { remainingCalls: 3, remainingMs: 60_000 });
    expect(three.detail.httpCalls).toBe(3);
  });

  it("남은 시간을 넘지 않는다 (호출마다 1초가 흐르고 2.5초 남으면 3번째 호출 뒤 멈춘다)", async () => {
    let t = 0;
    const { detail } = await listThenDetail(
      (id) => {
        t += 1000;
        return detailBody(id);
      },
      [listItem(1), listItem(2), listItem(3), listItem(4), listItem(5)],
      { remainingCalls: 20, remainingMs: 2_500 },
      { now: () => t },
    );
    expect(detail.httpCalls).toBe(3);
  });

  it("상세가 데이터없음(03)이면 그 물건은 상세 줄이 없다. 일부만 없으면 성공, 전부 없으면 빈 결과", async () => {
    const nodata = json({ result: { resultCode: "03", resultMsg: "NODATA_ERROR" } });
    // 두 번째 물건의 상세가 두 번 다 0건: 한 번 더 조회해도 같으면 그대로 빈 결과로 남는다
    const some = await listThenDetail((id, call) => (call === 2 || call === 3 ? nodata.clone() : detailBody(id)));
    expect(some.detail).toMatchObject({ outcome: "success", recordCount: 2 });
    expect(some.detail.subChecks?.map((c) => c.outcome)).toEqual(["success", "empty_result", "empty_result", "success"]);
    expect(some.detail.requeried).toEqual({ tried: 1, recovered: 0 });

    // 전부 0건: 물건 3개를 각각 2번씩(처음 + 재조회) 조회한다
    const all = await listThenDetail(() => json({ result: { resultCode: "03", resultMsg: "NODATA_ERROR" } }));
    expect(all.detail).toMatchObject({ outcome: "empty_result", recordCount: 0, httpCalls: 6, requeried: { tried: 3, recovered: 0 } });
  });

  it("상세가 0건이어도 재조회에서 받으면 그 물건은 상세 줄이 생기고 복구로 센다", async () => {
    const nodata = json({ result: { resultCode: "03", resultMsg: "NODATA_ERROR" } });
    const { detail } = await listThenDetail((id, call) => (call === 2 ? nodata.clone() : detailBody(id)));
    expect(detail).toMatchObject({ outcome: "success", recordCount: 3, httpCalls: 4, requeried: { tried: 1, recovered: 1 } });
    expect(detail.subChecks?.map((c) => c.outcome)).toEqual(["success", "empty_result", "success", "success"]);
  });

  it("재조회도 남은 호출 수를 넘지 않는다 (경계: 1회만 남으면 재조회 없이 멈추고, 2회 남으면 재조회까지)", async () => {
    const nodataBody = () => json({ result: { resultCode: "03", resultMsg: "NODATA_ERROR" } });
    const one = await listThenDetail(nodataBody, undefined, { remainingCalls: 1, remainingMs: 60_000 });
    expect(one.detail).toMatchObject({ httpCalls: 1, requeried: { tried: 0, recovered: 0 } });
    const two = await listThenDetail(nodataBody, undefined, { remainingCalls: 2, remainingMs: 60_000 });
    expect(two.detail).toMatchObject({ httpCalls: 2, requeried: { tried: 1, recovered: 0 } });
  });

  it("서비스키·한도 문제가 나면 그 자리에서 멈춘다 (더 부르지 않는다)", async () => {
    const { detail, urls } = await listThenDetail((id, call) => (call === 2 ? json({ result: { resultCode: "22", resultMsg: "LIMITED" } }) : detailBody(id)));
    expect(detail.outcome).toBe("auth_or_quota");
    expect(detail.httpCalls).toBe(2);
    expect(urls.filter((u) => u.includes("getRlstDtlInf2"))).toHaveLength(2);
  });

  it("목록 없이 상세만 부르면 호출하지 않고 빈 결과로 돌려준다", async () => {
    const { fetcher, urls } = make(() => json(okBody([])));
    const r = await fetcher("public-detail", CTX);
    expect(r).toMatchObject({ outcome: "empty_result", httpCalls: 0, subChecks: [] });
    expect(urls).toHaveLength(0);
  });

  it("모두 HTTP 오류면 http_error, 시간 초과가 섞이면 timeout", async () => {
    const down = await listThenDetail(() => new Response("err", { status: 500 }));
    expect(down.detail.outcome).toBe("http_error");
    const slow = await listThenDetail((id, call) => {
      if (call === 1) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return new Response("err", { status: 500 });
    });
    expect(slow.detail.outcome).toBe("timeout");
  });
});

describe("오류 구분 (목록 호출 기준)", () => {
  const outcomeOf = async (res: () => Response | Promise<Response>) => (await make(res).fetcher("public-list", CTX)).outcome;

  it("HTTP 500 → http_error, 401·403·429 → 서비스키·한도 문제", async () => {
    expect(await outcomeOf(() => new Response("x", { status: 500 }))).toBe("http_error");
    for (const status of [401, 403, 429]) expect(await outcomeOf(() => new Response("x", { status })), String(status)).toBe("auth_or_quota");
  });

  it("관문의 XML 오류(등록되지 않은 키 30) → 서비스키·한도 문제", async () => {
    expect(await outcomeOf(() => new Response("<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>", { status: 200 }))).toBe("auth_or_quota");
  });

  it("결과코드 03 → 빈 결과(0건, 응답은 정상), 그 밖의 결과코드 → http_error", async () => {
    const empty = await make(() => json({ result: { resultCode: "03", resultMsg: "NODATA_ERROR" } })).fetcher("public-list", CTX);
    expect(empty).toMatchObject({ outcome: "empty_result", httpStatus: 200, recordCount: 0, dataValid: null, records: [] });
    expect(await outcomeOf(() => json({ result: { resultCode: "02", resultMsg: "DB_ERROR" } }))).toBe("http_error");
  });

  it("제한 시간을 넘기면 타임아웃: 호출을 중단하고 응답 코드는 비운다", async () => {
    const { fetcher } = make((_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))), { timeoutSeconds: 0.02 });
    const r = await fetcher("public-list", CTX);
    expect(r).toMatchObject({ outcome: "timeout", httpStatus: null, recordCount: null, records: [] });
  });

  it("네트워크 예외가 나도 던지지 않고 결과로 돌려주며, 오류 문구(키 포함 주소)를 옮기지 않는다", async () => {
    const { fetcher } = make(() => {
      throw new Error(`fetch failed: https://apis.data.go.kr/x?serviceKey=${KEY_ENCODED}`);
    });
    const r = await fetcher("public-list", CTX);
    expect(r.outcome).toBe("http_error");
    expect(JSON.stringify(r)).not.toContain(SECRET_PART);
    expect(JSON.stringify(r)).not.toContain("serviceKey");
  });

  it("어떤 결과에도 서비스키가 들어 있지 않다", async () => {
    const { fetcher } = make((url) => (url.includes("List") ? json(okBody([listItem(1)])) : new Response("x", { status: 500 })));
    const list = await fetcher("public-list", CTX);
    const detail = await fetcher("public-detail", CTX);
    for (const r of [list, detail]) expect(JSON.stringify(r)).not.toContain(SECRET_PART);
  });
});
