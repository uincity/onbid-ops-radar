"use client";
// 서버 응답 표시: 성공은 role="status", 실패는 role="alert". 중복이면 열린 건 링크, 버전 충돌이면 새로고침 안내.
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/anomalies/action-input";

export function ActionResult({ state }: { state: ActionState }) {
  const router = useRouter();
  if (state.status === "idle") return null;

  if (state.status === "success") {
    return (
      <p role="status" data-testid="action-success" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-800">
        저장했습니다. {state.message}
      </p>
    );
  }

  return (
    <div role="alert" data-testid="action-error" className="space-y-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 ring-1 ring-red-300 dark:bg-red-950 dark:text-red-100 dark:ring-red-800">
      <p>{state.message}</p>
      {state.code === "ACTIVE_DUPLICATE_EXISTS" && state.duplicateId ? (
        <p>
          <Link href={`/anomalies/${state.duplicateId}`} className="font-medium underline">
            이미 열려 있는 이상징후 #{state.duplicateId} 보러 가기
          </Link>
        </p>
      ) : null}
      {state.code === "VERSION_CONFLICT" ? (
        <button type="button" onClick={() => router.refresh()} className="rounded-md border border-red-400 bg-white px-3 py-1 text-sm font-medium text-red-900 dark:bg-red-900 dark:text-red-50">
          새로고침
        </button>
      ) : null}
    </div>
  );
}
