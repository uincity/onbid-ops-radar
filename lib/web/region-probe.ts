// Design Ref: docs/design-homepage-monitoring.md §3.2(서울 리전)·§12.3 / Plan W00-1 — 서울 리전 확인용 진단 경로의 핵심 흐름
// 목적: Vercel 함수가 서울(icn1)에서 실행되는지, 그 위치에서 온비드 홈페이지에 접속되는지(차단 여부)를 1회 확인한다.
// 점검은 GET만 보낸다(쓰기 요청 금지). 본문 내용은 보관하지 않고 상태 코드·시간·크기만 남긴다. 응답에 비밀값·내부 오류 문구를 담지 않는다.
// W07에서 실제 입구 경로(/api/cron/web-check)로 확장하기 전의 임시 진단 도구다.
import { bearerToken, sameSecret } from "@/lib/schedule/cron-check";

export const REGION_PROBE_TARGETS = [
  { key: "main", url: "https://www.onbid.co.kr/op/meminf/lgnmng/prtllgn/PrtlLgnController/main.do" }, // 실제 화면
  { key: "stub", url: "https://www.onbid.co.kr/" }, // 이동 스텁(보조 확인)
  { key: "queue", url: "https://wait.onbid.co.kr/assets/nf-setting/1/nf-setting.json" }, // 대기열 설정(보조 확인)
] as const;

export type RegionProbeItem = { key: string; ok: boolean; status: number | null; ms: number; bytes: number | null; error: "timeout" | "network" | null };
export type RegionProbeResponse = {
  httpStatus: number;
  body: { ok: boolean; message: string; region?: string; items?: RegionProbeItem[] };
};

export type RegionProbeDeps = {
  secret: () => string | undefined; // CRON_SECRET
  region: () => string | undefined; // 함수가 실제 실행된 지역(VERCEL_REGION)
  fetchImpl: typeof fetch;
  now: () => number;
  timeoutMs: number;
};

const reply = (httpStatus: number, message: string, extra: Partial<RegionProbeResponse["body"]> = {}): RegionProbeResponse => ({
  httpStatus,
  body: { ok: httpStatus === 200, message, ...extra },
});

async function probeOne(target: { key: string; url: string }, deps: RegionProbeDeps): Promise<RegionProbeItem> {
  const start = deps.now();
  try {
    const res = await deps.fetchImpl(target.url, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(deps.timeoutMs) });
    const buf = await res.arrayBuffer(); // 크기만 잰다
    return { key: target.key, ok: res.status >= 200 && res.status < 400, status: res.status, ms: deps.now() - start, bytes: buf.byteLength, error: null };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { key: target.key, ok: false, status: null, ms: deps.now() - start, bytes: null, error: timeout ? "timeout" : "network" };
  }
}

export async function runRegionProbe(authorization: string | null, deps: RegionProbeDeps): Promise<RegionProbeResponse> {
  const expected = deps.secret();
  if (!expected) return reply(503, "진단 경로가 설정되지 않았습니다."); // 설정 누락이 "인증 없음"이 되지 않게 거부
  const given = bearerToken(authorization);
  if (!given || !sameSecret(given, expected)) return reply(401, "인증에 실패했습니다.");
  const items: RegionProbeItem[] = [];
  for (const t of REGION_PROBE_TARGETS) items.push(await probeOne(t, deps)); // 서버 부담을 줄이려고 하나씩 순서대로
  return reply(200, "서울 리전 진단을 마쳤습니다.", { region: deps.region() ?? "unknown", items });
}
