// 아직 만들지 않은 화면의 임시 자리 (메뉴를 눌렀을 때 404가 나지 않도록 공통 틀 안에 보여 준다)
// 화면을 실제로 만드는 작업에서 이 컴포넌트를 쓰는 페이지를 진짜 화면으로 바꾼다.
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/current-user";

type Props = {
  title: string;
  description: string;
  // 이 화면을 만드는 PLAN 작업 번호 (예: "29번")
  planTask: string;
};

export function ComingSoonPage(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
      <ComingSoonContent {...props} />
    </Suspense>
  );
}

async function ComingSoonContent({ title, description, planTask }: Props) {
  // 이 화면에서도 로그인과 역할을 직접 다시 확인한다. (레이아웃은 화면 이동 때 다시 확인되지 않는다)
  await requireUser();

  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-8 dark:border-zinc-700 dark:bg-zinc-950">
        <p className="text-zinc-700 dark:text-zinc-300">{description}</p>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          이 화면은 PLAN {planTask} 작업에서 만들어집니다. 지금은 메뉴와 공통 틀만 보입니다.
        </p>
      </div>
    </section>
  );
}
