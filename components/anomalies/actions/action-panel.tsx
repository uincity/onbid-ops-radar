"use client";
// 이상징후 처리 조작 패널. 보여 줄 조작은 부모가 정해 넘기고(화면 편의), 서버 액션이 DB에서 다시 확인한다.
// 하나의 useActionState를 모든 폼이 나눠 쓰므로, 처리상태가 바뀌어 폼이 사라져도 "저장했습니다" 안내는 남는다.
import { useActionState, useState } from "react";
import { anomalyAction } from "@/app/(app)/anomalies/[id]/actions";
import { INITIAL_ACTION_STATE, type AvailableActions } from "@/lib/anomalies/action-input";
import { VERDICTS, VERDICT_LABEL } from "@/lib/anomalies/labels";
import { isReasonLongEnough } from "@/lib/anomalies/reason-length";
import { ActionResult } from "./action-result";
import { ReasonField } from "./reason-field";

type Props = {
  anomaly: { id: number; verdict: string; version: number; assigneeId: string | null };
  currentUserId: string;
  assignees: { id: string; displayName: string; role: string }[];
  available: AvailableActions;
};

const btn = "rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${btn} bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900`;
const secondary = `${btn} border border-zinc-400 bg-white dark:border-zinc-600 dark:bg-zinc-900`;
const box = "space-y-3 rounded-md border border-zinc-300 p-3 dark:border-zinc-700";
const selectCls = "w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900";

type SubFormProps = {
  formAction: (formData: FormData) => void;
  pending: boolean;
  hidden: (intent: string) => React.ReactNode;
  anomaly: Props["anomaly"];
};

// 판정 선택: 서버 값(판정·버전)이 바뀌면 key가 달라져 새 값 기준으로 다시 시작한다
function VerdictForm({ formAction, pending, hidden, anomaly }: SubFormProps) {
  const [verdict, setVerdict] = useState(anomaly.verdict);
  return (
    <form action={formAction} className={box} aria-label="판정 저장">
      {hidden("save_verdict")}
      <div className="space-y-1">
        <label htmlFor="verdict-select" className="block text-sm font-medium">
          판정
        </label>
        <select id="verdict-select" name="verdict" value={verdict} disabled={pending} onChange={(e) => setVerdict(e.target.value)} className={selectCls}>
          {VERDICTS.map((v) => (
            <option key={v} value={v}>
              {VERDICT_LABEL[v]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending || verdict === anomaly.verdict} className={secondary}>
        {pending ? "저장 중…" : "판정 저장"}
      </button>
    </form>
  );
}

// 팀장용 담당자 선택
function AssignPicker({ formAction, pending, hidden, anomaly, assignees }: SubFormProps & { assignees: Props["assignees"] }) {
  const [assigneeId, setAssigneeId] = useState(anomaly.assigneeId ?? assignees[0]?.id ?? "");
  return (
    <form action={formAction} className={box} aria-label="담당자 지정">
      {hidden("assign")}
      <div className="space-y-1">
        <label htmlFor="assignee-select" className="block text-sm font-medium">
          담당자
        </label>
        <select id="assignee-select" name="assigneeId" value={assigneeId} disabled={pending} onChange={(e) => setAssigneeId(e.target.value)} className={selectCls}>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName} ({a.role === "admin" ? "팀장" : "운영 담당자"})
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending || !assigneeId || assigneeId === anomaly.assigneeId} className={secondary}>
        {pending ? "저장 중…" : anomaly.assigneeId ? "재배정" : "지정"}
      </button>
    </form>
  );
}

export function ActionPanel({ anomaly, currentUserId, assignees, available }: Props) {
  const [state, formAction, pending] = useActionState(anomalyAction, INITIAL_ACTION_STATE);
  const [resolvedNote, setResolvedNote] = useState("");
  const [dismissedNote, setDismissedNote] = useState("");
  const [reopenNote, setReopenNote] = useState("");

  const hidden = (intent: string) => (
    <>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={anomaly.id} />
      <input type="hidden" name="expectedVersion" value={anomaly.version} />
    </>
  );
  const sub = { formAction, pending, hidden, anomaly };
  const nothing = !available.selfAssign && !available.assignPicker && !available.startReview && !available.verdictAndClose && !available.reopen;

  return (
    <section aria-labelledby="anomaly-actions-title" className="space-y-4" data-testid="anomaly-actions">
      <h2 id="anomaly-actions-title" className="text-base font-semibold">
        처리하기
      </h2>

      {available.selfAssign ? (
        <form action={formAction} className={box} aria-label="담당자 맡기">
          {hidden("assign")}
          <input type="hidden" name="assigneeId" value={currentUserId} />
          <p className="text-sm">아직 담당자가 없습니다. 내가 맡으면 처리할 수 있습니다.</p>
          <button type="submit" disabled={pending} className={primary}>
            {pending ? "저장 중…" : "내가 맡기"}
          </button>
        </form>
      ) : null}

      {available.assignPicker ? <AssignPicker key={`assign-${anomaly.assigneeId}-${anomaly.version}`} {...sub} assignees={assignees} /> : null}

      {available.blockedReason ? (
        <p data-testid="action-blocked" className="text-sm text-zinc-700 dark:text-zinc-300">
          {available.blockedReason}
        </p>
      ) : null}

      {available.startReview ? (
        <form action={formAction} className={box} aria-label="검토 시작">
          {hidden("start_review")}
          <p className="text-sm">내용을 확인하기 시작하면 처리상태가 &apos;검토 중&apos;으로 바뀝니다.</p>
          <button type="submit" disabled={pending} className={primary}>
            {pending ? "저장 중…" : "검토 시작"}
          </button>
        </form>
      ) : null}

      {available.verdictAndClose ? (
        <>
          <VerdictForm key={`verdict-${anomaly.verdict}-${anomaly.version}`} {...sub} />

          <form action={formAction} className={box} aria-label="조치 완료로 닫기">
            {hidden("close_resolved")}
            <ReasonField id="note-resolved" name="note" label="조치내용" hint="어떤 조치를 했는지 적어 주세요. 판정은 '실제 이상 확인'으로 저장됩니다." value={resolvedNote} onChange={setResolvedNote} disabled={pending} />
            <button type="submit" disabled={pending || !isReasonLongEnough(resolvedNote)} className={primary}>
              {pending ? "저장 중…" : "조치 완료로 닫기"}
            </button>
          </form>

          <form action={formAction} className={box} aria-label="정상 판정으로 닫기">
            {hidden("close_dismissed")}
            <ReasonField id="note-dismissed" name="note" label="판정 사유" hint="왜 정상인지 적어 주세요. 판정은 '정상(오탐)'으로 저장됩니다." value={dismissedNote} onChange={setDismissedNote} disabled={pending} />
            <button type="submit" disabled={pending || !isReasonLongEnough(dismissedNote)} className={secondary}>
              {pending ? "저장 중…" : "정상 판정으로 닫기"}
            </button>
          </form>
        </>
      ) : null}

      {available.reopen ? (
        <form action={formAction} className={box} aria-label="검토 재개">
          {hidden("reopen")}
          <ReasonField id="note-reopen" name="note" label="재개 사유" hint="다시 검토하는 이유를 적어 주세요. 판정은 '미판정'으로 돌아가고 이전 판정은 이력에 남습니다." value={reopenNote} onChange={setReopenNote} disabled={pending} />
          <button type="submit" disabled={pending || !isReasonLongEnough(reopenNote)} className={secondary}>
            {pending ? "저장 중…" : "검토 재개"}
          </button>
        </form>
      ) : null}

      {nothing && !available.blockedReason ? <p className="text-sm text-zinc-700 dark:text-zinc-300">지금 할 수 있는 처리가 없습니다.</p> : null}

      <ActionResult state={state} />
    </section>
  );
}
