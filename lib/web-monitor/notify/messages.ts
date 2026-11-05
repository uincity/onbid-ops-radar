// Design Ref: docs/design-homepage-monitoring.md §5.4 / PRD §8 / Plan W12 — 알림 메시지 만들기 (순수 함수)
// 텔레그램 sendMessage(parse_mode=HTML)용 텍스트. KST로 표기하고, 동적 값은 모두 HTML 이스케이프한다.
// 비밀값·내부 요청 헤더·개인정보·OpenAPI 점검 문구는 넣지 않는다(재료는 decide가 만든 payload의 정해진 칸뿐이다).
import { formatKst } from "@/lib/time";
import type { WebReason } from "../classify";
import type { UnsentNotification } from "./types";

export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const REASON_LABEL: Record<WebReason, string> = {
  TIMEOUT: "응답 시간 초과",
  SLOW_RESPONSE: "응답 느림",
  DNS_FAILED: "주소 조회(DNS) 실패",
  TCP_FAILED: "접속(TCP) 실패",
  TLS_FAILED: "보안 연결(TLS) 실패",
  HTTP_5XX: "서버 오류(5xx)",
  HTTP_BLOCKED: "접근 거부(401·403·429)",
  HTTP_4XX_OTHER: "요청 오류(4xx)",
  HTTP_NOT_FOUND: "화면을 찾을 수 없음(404·410)",
  MARKER_MISSING: "화면 필수 문구 없음",
  TOO_SMALL: "화면 크기 비정상",
  MAINTENANCE_DETECTED: "점검 안내 감지",
  BLOCK_PHRASE: "차단 문구 감지",
  CERT_EXPIRING: "인증서 만료 임박",
  CERT_INVALID: "인증서 오류",
  REDIRECT_LIMIT: "이동 횟수 초과",
  HOST_NOT_ALLOWED: "허용되지 않은 주소",
  STUB_CHANGED: "진입 화면 변경",
  FILE_NOT_FOUND: "파일 없음",
  UPSTREAM_FAILED: "앞 단계 실패로 점검 못 함",
  BUDGET_SKIP: "시간 부족으로 점검 못 함",
  INTERNAL_ERROR: "점검기 내부 오류",
};
export const VERDICT_LABEL: Record<string, string> = { FAIL: "실패", DEGRADED: "저하", UNVERIFIED: "검증 불가", NOT_RUN: "미점검", PASS_DATA: "정상", PASS_NO_DATA: "정상(데이터 없음)" };
const AUX_LABEL: Record<string, string> = { "aux-stub": "진입 스텁", "aux-queue": "대기열 설정" };

export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "알 수 없음";
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${Math.floor(minutes % 60)}분` : `${Math.floor(minutes)}분`;
}

export type MessageContext = {
  targetLabel: string; // 화면에 보일 이름 (등록부의 label)
  appBaseUrl?: string | null; // 예: https://onbid-ops-radar.vercel.app (없거나 https가 아니면 링크를 넣지 않는다)
  anomalyId?: number | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function detailLink(ctx: MessageContext): string | null {
  const base = ctx.appBaseUrl?.replace(/\/+$/, "");
  if (!base || !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(base) || !ctx.anomalyId) return null;
  return `${base}/anomalies/${ctx.anomalyId}`;
}

export function buildMessage(item: UnsentNotification, ctx: MessageContext): string {
  const p = item.payload;
  const label = `[${escapeHtml(ctx.targetLabel)}]`;
  const when = `시각: ${escapeHtml(formatKst(item.createdAt).slice(0, 16))} KST`;
  const link = detailLink(ctx);
  const reason = str(p.reason) as WebReason | null;
  const reasonText = reason ? escapeHtml(REASON_LABEL[reason] ?? reason) : null;
  const verdictText = escapeHtml(VERDICT_LABEL[str(p.verdict) ?? ""] ?? str(p.verdict) ?? "알 수 없음");

  const lines: string[] = [];
  switch (item.kind) {
    case "down":
      lines.push(`🔴 ${label} 장애 감지`, when, `판정: ${verdictText}${reasonText ? ` — ${reasonText}` : ""}`);
      break;
    case "degraded":
      lines.push(`🟠 ${label} 성능 저하`, when, `판정: ${verdictText}${reasonText ? ` — ${reasonText}` : ""}`);
      break;
    case "recovered": {
      const m = num(p.minutes);
      lines.push(`🟢 ${label} 복구`, when, `장애 지속: ${m === null ? "알 수 없음" : `약 ${escapeHtml(formatMinutes(m))}`} (1시간 간격 관측 기준, 오차 있음)`);
      break;
    }
    case "ongoing": {
      const m = num(p.minutes);
      lines.push(`⏳ ${label} 장애 지속`, when, `경과: ${m === null ? "알 수 없음" : `약 ${escapeHtml(formatMinutes(m))}`}${num(p.n) !== null ? ` (${num(p.n)}번째 지속 알림)` : ""}`);
      break;
    }
    case "cert": {
      const d = num(p.days_left);
      lines.push(`🟡 ${label} 인증서 만료 임박`, when, `남은 기간: ${d === null ? "알 수 없음" : `${d}일`}`);
      break;
    }
    case "unverifiable":
      lines.push(`⚪ ${label} 점검 불가 지속`, when, `연속 ${num(p.count) ?? "?"}회 검증 불가·미점검 (홈페이지 상태를 판단하지 못했습니다)`);
      break;
    case "unplanned":
      lines.push(`🔧 ${label} 미등록 점검 감지`, when, "등록된 점검 시간이 아닌데 점검 안내가 감지되었습니다 (이상징후는 만들지 않았습니다)");
      break;
    case "aux":
      lines.push(`🟡 ${label} 보조 점검 이상`, when, `${escapeHtml(AUX_LABEL[str(p.probe) ?? ""] ?? str(p.probe) ?? "보조 확인")}: 연속 ${num(p.count) ?? "?"}회 이상 (대표 판정에는 반영하지 않음)`);
      break;
    case "suppressed":
      lines.push(`🔕 ${label} 알림 억제`, when, `하루 알림 상한(${num(p.cap) ?? "?"}건)을 넘어 이후 알림은 보내지 않고 기록만 합니다`);
      break;
    default:
      lines.push(`ℹ️ ${label} 알림`, when);
  }
  // 상세 링크는 이상징후가 있는 알림에만 의미가 있다 (인증서·보조·점검 불가·미등록·억제는 사건이 아니라서 링크를 넣지 않는다)
  if (link && ["down", "degraded", "recovered", "ongoing"].includes(item.kind)) lines.push(`상세: ${escapeHtml(link)}`);
  return lines.join("\n");
}
