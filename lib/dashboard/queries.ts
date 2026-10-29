// 통합 대시보드가 읽는 데이터 (서버 컴포넌트에서만 호출한다)
// 로그인한 사용자 권한(RLS)으로 읽으며, 서버 관리용 키는 쓰지 않는다. 필요한 열만 읽어 가볍게 가져온다.
import { createClient } from "@/lib/supabase/server";
import { kstDayRange, toKstDateString } from "@/lib/time";
import { RECENT_RUN_LIMIT, type AnomalyRow, type RunRow } from "./summary";

const PAGE_SIZE = 1000; // Supabase가 한 번에 돌려주는 최대 행 수
const MAX_PAGES = 50; // 무한 반복 방지 (최대 5만 행)

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// 1000행씩 이어서 읽는다. (한 번에 읽으면 1000행에서 조용히 잘려 숫자가 틀려지기 때문)
async function fetchAll<T>(load: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await load(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new Error(`대시보드 데이터를 읽지 못했습니다: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

export async function loadDashboardRows(now: Date): Promise<{ runs: RunRow[]; anomalies: AnomalyRow[] }> {
  const supabase = await createClient();
  const { start, end } = kstDayRange(toKstDateString(now));
  const runColumns = "id, trigger, source, status, started_at, finished_at";

  const [todayRuns, latestRuns, anomalies] = await Promise.all([
    // 오늘(KST) 시작한 실행: [00:00, 24:00)
    fetchAll<RunRow>((from, to) =>
      supabase
        .from("check_runs")
        .select(runColumns)
        .gte("started_at", start.toISOString())
        .lt("started_at", end.toISOString())
        .order("id", { ascending: false })
        .range(from, to),
    ),
    // 날짜와 관계없는 최근 실행 5건
    fetchAll<RunRow>(() =>
      supabase
        .from("check_runs")
        .select(runColumns)
        .order("started_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(RECENT_RUN_LIMIT),
    ),
    // 이상징후는 집계에 필요한 열만
    fetchAll<AnomalyRow>((from, to) =>
      supabase
        .from("anomalies")
        .select("source, status, rule_id, assignee_id, first_detected_at")
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  return { runs: [...todayRuns, ...latestRuns], anomalies };
}
