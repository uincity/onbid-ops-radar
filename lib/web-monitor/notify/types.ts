// Design Ref: docs/design-homepage-monitoring.md §5.4 / Plan W12 — 알림 채널 약속(Notifier)과 발송 저장소 약속(NotifyStore)
// 발송 흐름(deliver.ts)은 채널과 DB를 직접 모르고 이 약속만 안다. 그래서 텔레그램 없이(log 채널·가짜 저장소) 시험할 수 있고, 채널을 바꿔 끼울 수 있다.
export type NotifyChannel = "telegram" | "log";

// 오류 분류 이름만 담는다(소문자·숫자·밑줄). 내부 문구·토큰·응답 본문은 담지 않는다 — DB 제약(web_notifications_error_class_check)과 같은 모양
export type SendResult = { ok: boolean; channel: NotifyChannel; responseCode?: number | null; errorClass?: string | null };

export interface Notifier {
  readonly channel: NotifyChannel;
  /** 메시지(텔레그램 HTML 형식 텍스트) 1건을 보낸다. 예외를 던지지 않고 결과로 돌려준다 */
  send(text: string): Promise<SendResult>;
}

// 아직 sent가 없는 알림 1건 (대기 줄 + 키 정보)
export type UnsentNotification = {
  key: string;
  kind: string;
  targetKey: string;
  incidentNo: number | null;
  payload: Record<string, unknown>;
  attempts: number; // 마지막 시도 번호(0 = 대기만 있음)
  createdAt: Date;
};

export type RecordAttemptInput = { key: string; attempt: number; channel: NotifyChannel; status: "sent" | "failed"; responseCode: number | null; errorClass: string | null };

export interface NotifyStore {
  /** sent가 없고 시도 5회 미만인 알림(감시 알림 제외). keys가 있으면 그 키만, olderThanMinutes로 오래된 것만 */
  listUnsent(opts: { olderThanMinutes: number; keys?: readonly string[]; limit: number }): Promise<UnsentNotification[]>;
  /** 발송 임대 선점(같은 키를 두 실행이 동시에 보내지 않게). 이미 발송됐거나 시도를 다 썼거나 임대 중이면 false */
  lease(key: string, seconds: number): Promise<boolean>;
  /** 시도 한 줄 추가 (추가 전용) */
  recordAttempt(input: RecordAttemptInput): Promise<void>;
  /** 대상의 가장 최근 WEB 이상징후 번호(메시지 링크용). 없으면 null */
  latestAnomalyId(targetKey: string): Promise<number | null>;
}
