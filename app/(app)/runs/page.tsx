// 점검 이력 목록 자리 (DESIGN §4.6). 실제 화면은 PLAN 24번(수동 점검 실행 버튼)과 25번 이후에서 만든다.
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon";

export const metadata: Metadata = { title: "점검 이력" };

export default function RunsPage() {
  return (
    <ComingSoonPage
      title="점검 이력"
      description="점검 실행 이력과 API 호출별 응답시간·결과를 보여 주고, 팀장은 여기서 수동 점검을 실행할 수 있게 됩니다."
      planTask="24번"
    />
  );
}
