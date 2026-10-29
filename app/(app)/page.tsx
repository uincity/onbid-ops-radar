// 통합 운영 대시보드 자리 (DESIGN §4.3). 실제 화면은 PLAN 29번에서 만든다.
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon";

export const metadata: Metadata = { title: "대시보드" };

export default function DashboardPage() {
  return (
    <ComingSoonPage
      title="대시보드"
      description="오늘의 점검 결과, 미배정·미처리 이상징후 건수, 규칙별 신규 건수, 최근 점검 실행 목록이 이 자리에 보입니다."
      planTask="29번"
    />
  );
}
