// 유형별 "시험 알림" 문구 만들기 (순수: 네트워크·DB를 모른다) — 실제 장애 없이 텔레그램에서 알림 문구를 눈으로 확인하는 용도
// 앱이 실제로 보내는 문구와 같은 함수(buildMessage)로 만든다. 맨 앞에 "[시험]" 줄을 붙여 진짜 알림과 구분하고, 이상징후 링크는 넣지 않는다(시험이라 가리킬 이상징후가 없다).
// 모니터 정지·재개 문구만은 DB 함수(web_monitor_heartbeat)가 SQL에서 만들므로 여기서 같은 모양으로 다시 만든다 — 어긋나지 않게
// tests/unit/web-notify-samples.test.ts가 마이그레이션 SQL의 문구와 비교한다.
import { formatKst } from "@/lib/time";
import { buildMessage, type MessageContext } from "./messages";
import type { UnsentNotification } from "./types";

export type NotifySample = { id: string; kind: string; title: string; text: string };

const TARGET_LABEL = "온비드 홈페이지";

/** 시험 알림 한 벌. now는 문구에 찍히는 시각(KST로 표시) */
export function buildNotifySamples(now: Date): NotifySample[] {
  const ctx: MessageContext = { targetLabel: TARGET_LABEL, appBaseUrl: null, anomalyId: null };
  const item = (kind: string, payload: Record<string, unknown>): UnsentNotification => ({ key: `${kind}:sample`, kind, targetKey: "onbid-home", incidentNo: 1, payload, attempts: 0, createdAt: now });
  const app = (id: string, kind: string, title: string, payload: Record<string, unknown>): Omit<NotifySample, "text"> & { payload: Record<string, unknown> } => ({ id, kind, title, payload });

  const defs = [
    app("down-5xx", "down", "장애 감지 — 서버 오류(5xx)", { verdict: "FAIL", reason: "HTTP_5XX" }),
    app("down-timeout", "down", "장애 감지 — 응답 시간 초과", { verdict: "FAIL", reason: "TIMEOUT" }),
    app("down-dns", "down", "장애 감지 — 주소 조회(DNS) 실패", { verdict: "FAIL", reason: "DNS_FAILED" }),
    app("down-tls", "down", "장애 감지 — 보안 연결(TLS) 실패", { verdict: "FAIL", reason: "TLS_FAILED" }),
    app("down-marker", "down", "장애 감지 — 화면 필수 문구 없음", { verdict: "FAIL", reason: "MARKER_MISSING" }),
    app("down-cert", "down", "장애 감지 — 인증서 오류", { verdict: "FAIL", reason: "CERT_INVALID" }),
    app("degraded-slow", "degraded", "성능 저하 — 응답 느림", { verdict: "DEGRADED", reason: "SLOW_RESPONSE" }),
    app("ongoing", "ongoing", "장애 지속 (3시간 경과)", { minutes: 180, n: 1 }),
    app("recovered", "recovered", "복구 (장애 지속 약 3시간 20분)", { minutes: 200 }),
    app("cert", "cert", "인증서 만료 임박", { days_left: 12 }),
    app("unverifiable", "unverifiable", "점검 불가 지속", { count: 3 }),
    app("unplanned", "unplanned", "미등록 점검 감지", {}),
    app("aux-stub", "aux", "보조 점검 이상 — 진입 스텁", { probe: "aux-stub", count: 3 }),
    app("aux-queue", "aux", "보조 점검 이상 — 대기열 설정", { probe: "aux-queue", count: 3 }),
    app("suppressed", "suppressed", "알림 억제 (하루 상한)", { cap: 12 }),
  ];

  const samples: NotifySample[] = defs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, text: buildMessage(item(d.kind, d.payload), ctx) }));

  // 모니터 정지·재개: DB 함수(web_monitor_heartbeat)가 만드는 문구와 같은 모양
  const lastGood = new Date(now.getTime() - 135 * 60_000);
  const kst = (d: Date) => formatKst(d).slice(0, 16);
  samples.push({
    id: "stale",
    kind: "stale",
    title: "모니터 정지 (점검 프로그램 자체 멈춤)",
    text: ["⚫ <b>홈페이지 점검 정지</b>", `마지막 정상 점검: ${kst(lastGood)} (KST)`, "점검 결과가 135분째 없습니다 (기준 130분).", "Supabase 스케줄러와 배포 상태를 확인해 주세요."].join("\n"),
  });
  samples.push({
    id: "resumed",
    kind: "resumed",
    title: "모니터 재개",
    text: ["🟢 <b>홈페이지 점검 재개</b>", `${kst(now)} (KST)에 점검이 다시 정상 종료되었습니다.`].join("\n"),
  });

  // 진짜 알림과 구분하는 시험 머리말
  const total = samples.length;
  return samples.map((s, i) => ({ ...s, text: `🧪 <b>[시험 ${i + 1}/${total}] ${s.title}</b>\n실제 장애가 아닙니다. 알림 문구 확인용입니다.\n\n${s.text}` }));
}
