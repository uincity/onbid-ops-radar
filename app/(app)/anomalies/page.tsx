// 이상징후 목록 자리 (DESIGN §4.4). 실제 화면은 PLAN 25번에서 만든다.
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon";

export const metadata: Metadata = { title: "이상징후" };

export default function AnomaliesPage() {
  return (
    <ComingSoonPage
      title="이상징후"
      description="탐지된 이상징후 목록과 상세 화면입니다. 미확인·내 담당 건을 걸러 보고 배정·판정·조치를 할 수 있게 됩니다."
      planTask="25번"
    />
  );
}
