// Design Ref: DESIGN §4.6 — 점검 실행 이력 목록 + 팀장 전용 수동 점검 패널
import type { Metadata } from "next";
import { Suspense } from "react";
import { ManualCheckForm } from "@/components/runs/manual-check-form";
import { RunsTable } from "@/components/runs/runs-table";
import type { RunRow } from "@/components/runs/format";
import { requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "점검 이력" };

export default function RunsPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">점검 이력</h1>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">불러오는 중…</p>}>
        <RunsContent />
      </Suspense>
    </section>
  );
}

async function RunsContent() {
  // 로그인·역할을 이 화면에서 직접 다시 확인한다
  const user = await requireUser();
  const supabase = await createClient(); // 로그인 사용자 권한(RLS)으로 읽는다

  const { data, error } = await supabase
    .from("check_runs")
    .select("id, trigger, source, status, started_at, finished_at, api_call_count, triggered_by, profiles(display_name)")
    .order("started_at", { ascending: false })
    .limit(30);

  return (
    <div className="mt-6 space-y-6">
      {user.role === "admin" ? (
        <ManualCheckForm />
      ) : (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300" data-testid="manual-check-notice">
          수동 점검은 팀장만 실행할 수 있습니다.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          점검 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (
        <RunsTable runs={(data ?? []) as unknown as RunRow[]} />
      )}
    </div>
  );
}
