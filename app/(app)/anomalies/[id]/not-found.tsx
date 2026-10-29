// 없는 이상징후 번호를 열었을 때 보여 주는 안내
import Link from "next/link";

export default function AnomalyNotFound() {
  return (
    <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 dark:border-zinc-700 dark:bg-zinc-950">
      <h1 className="text-xl font-bold">이상징후를 찾을 수 없습니다 (404)</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">번호가 잘못되었거나 존재하지 않는 이상징후입니다.</p>
      <p className="mt-4">
        <Link href="/anomalies" className="text-sm text-blue-700 underline underline-offset-2 dark:text-blue-300">
          이상징후 목록으로 돌아가기
        </Link>
      </p>
    </section>
  );
}
