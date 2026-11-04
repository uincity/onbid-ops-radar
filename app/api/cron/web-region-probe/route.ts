// Design Ref: docs/design-homepage-monitoring.md §12.3 / Plan W00-1 — 서울 리전 진단 경로(임시). W07 입구 경로 확장 때 정리한다.
// CRON_SECRET(Authorization: Bearer)으로만 열린다. 사람이 쓰는 화면이 아니다.
import { runRegionProbe } from "@/lib/web/region-probe";

export const maxDuration = 30;

export async function GET(request: Request) {
  const result = await runRegionProbe(request.headers.get("authorization"), {
    secret: () => process.env.CRON_SECRET,
    region: () => process.env.VERCEL_REGION,
    fetchImpl: fetch,
    now: () => Date.now(),
    timeoutMs: 8000,
  });
  return Response.json(result.body, { status: result.httpStatus, headers: { "Cache-Control": "no-store" } });
}
