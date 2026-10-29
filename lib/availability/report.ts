// 가용성 요약 → 일일 보고서에 저장하는 작은 모양 (reports.summary는 크기 제한이 있어 표시에 꼭 필요한 값만 담는다)
// 비율은 저장하지 않고 분자·분모만 담는다. 보여 줄 때 계산한다.
import { z } from "zod";
import type { AvailabilitySummary } from "./summary";

const count = z.number().int().min(0);
const fraction = z.object({ num: count, den: count });

export const reportAvailabilitySchema = z.object({
  registry: z.object({ target: count, registered: count, unconfirmed: count, operations: count }),
  counts: z.record(z.string(), count),
  noRecord: count,
  ready: z.object({ ready: count, notReady: count }),
  attemptRate: fraction,
  basicOk: fraction,
  realData: z.object({ passData: count, positiveRegistered: count }),
  serviceCoverage: fraction,
  failByCode: z.record(z.string(), count),
  reasons: z.object({ unverified: z.record(z.string(), count), notRun: z.record(z.string(), count) }),
  lastCheckedAt: z.string().nullable(),
  operations: z.array(z.object({ key: z.string(), status: z.string(), reason: z.string().nullable(), lastOkAt: z.string().nullable() })),
});

export type ReportAvailability = z.infer<typeof reportAvailabilitySchema>;

export function toReportAvailability(s: AvailabilitySummary): ReportAvailability {
  const frac = (r: { num: number; den: number }) => ({ num: r.num, den: r.den });
  return {
    registry: s.registry,
    counts: s.counts,
    noRecord: s.noRecord,
    ready: s.ready,
    attemptRate: frac(s.attemptRate),
    basicOk: frac(s.basicOk),
    realData: { passData: s.realData.passData, positiveRegistered: s.realData.positiveRegistered },
    serviceCoverage: frac(s.serviceCoverage),
    failByCode: s.failByCode,
    reasons: s.reasons,
    lastCheckedAt: s.lastCheckedAt,
    operations: s.services.flatMap((svc) => svc.operations.map((o) => ({ key: o.key, status: o.status, reason: o.reason, lastOkAt: o.lastOkAt }))),
  };
}
