"use client";
// Design Ref: docs/design-homepage-monitoring.md §4.3·§5.7 / Plan W17 — [지금 점검] 버튼 (팀장에게만 보인다. 실제 권한 검사는 서버 액션이 한다)
// 결과는 점검 이력에 "수동"으로만 남고 현재 상태·사건·알림에는 반영되지 않는다.
import Link from "next/link";
import { useActionState } from "react";
import { runWebCheckNowAction, type ManualCheckState } from "@/app/(app)/web/actions";
import { panel, sectionTitle } from "./tone";

const idle: ManualCheckState = { status: "idle" };

export function ManualCheckPanel() {
  const [state, action, pending] = useActionState(() => runWebCheckNowAction(), idle);
  return (
    <section aria-labelledby="web-manual-title" className={panel} data-testid="web-manual-check">
      <h2 id="web-manual-title" className={sectionTitle}>
        지금 점검 <span className="text-xs font-normal text-zinc-500">(팀장)</span>
      </h2>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        홈페이지를 지금 한 번 확인합니다. 결과는 점검 이력에 “수동”으로만 기록되고, 현재 상태·알림·이상징후에는 반영되지 않습니다. 최대 1분 남짓 걸릴 수 있습니다.
      </p>
      <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          data-testid="web-manual-submit"
        >
          {pending ? "점검 중… (잠시만 기다려 주세요)" : "지금 점검"}
        </button>
        {state.status === "ok" ? (
          <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300" data-testid="web-manual-message">
            {state.message}{" "}
            <Link href={`/web/runs/${state.runId}`} className="font-medium underline underline-offset-2" data-testid="web-manual-run-link">
              점검 #{state.runId} 보기
            </Link>
          </p>
        ) : null}
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-testid="web-manual-message">
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
