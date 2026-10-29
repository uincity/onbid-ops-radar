// 일일 점검보고서 목록 자리 (DESIGN §4.7). 실제 화면은 PLAN 30번에서 만든다.
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon";

export const metadata: Metadata = { title: "보고서" };

export default function ReportsPage() {
  return (
    <ComingSoonPage
      title="보고서"
      description="일일 점검보고서 목록과 미리보기, Markdown 다운로드 화면입니다. 팀장은 날짜와 출처를 골라 보고서를 만들 수 있게 됩니다."
      planTask="30번"
    />
  );
}
