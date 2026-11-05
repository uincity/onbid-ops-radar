// 홈페이지(WEB) 이상징후의 "탐지 근거"를 화면용 글자로 바꾸는 순수 함수 (DESIGN §4.6)
// evidence 모양은 lib/web-monitor/decide.ts의 startIncident가 만든다: { verdict, reason, incident_no, started_at, trigger_run_id }
// DB의 JSON이라 모양이 틀려도 멈추지 않고, 읽을 수 없는 값은 건너뛴다. 응답 본문은 저장하지 않으므로 보여 줄 것도 없다.
import { REASON_LABEL, VERDICT_LABEL } from "@/lib/web-monitor/notify/messages";
import { formatKst } from "@/lib/time";

export type WebEvidenceView = {
  lines: { label: string; value: string }[];
  runId: number | null; // 사건을 일으킨 점검 → /web/runs/[id]
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const kst = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatKst(d);
};

export function webEvidenceView(evidence: unknown): WebEvidenceView {
  const e = isObj(evidence) ? evidence : {};
  const lines: WebEvidenceView["lines"] = [];

  if (typeof e.incident_no === "number") lines.push({ label: "사건 번호", value: `${e.incident_no}번` });
  if (typeof e.started_at === "string") lines.push({ label: "사건 시작 (KST)", value: kst(e.started_at) });
  if (typeof e.verdict === "string") lines.push({ label: "확정 판정", value: Object.hasOwn(VERDICT_LABEL, e.verdict) ? VERDICT_LABEL[e.verdict] : e.verdict });
  if (typeof e.reason === "string") lines.push({ label: "사유", value: Object.hasOwn(REASON_LABEL, e.reason) ? REASON_LABEL[e.reason as keyof typeof REASON_LABEL] : e.reason });

  const id = typeof e.trigger_run_id === "number" ? e.trigger_run_id : typeof e.trigger_run_id === "string" && /^[1-9]\d{0,17}$/.test(e.trigger_run_id) ? Number(e.trigger_run_id) : null;
  return { lines, runId: id !== null && Number.isSafeInteger(id) && id > 0 ? id : null };
}
