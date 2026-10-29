// 이상징후 상세 화면의 "배정·검토 시작·판정·조치 완료·정상 판정·재개" 조작 모음 (PLAN 26·27)
// 어떤 버튼을 보여 줄지는 화면 편의일 뿐이고, 진짜 권한·전이 검사는 서버 액션과 DB 함수가 한다.
import { availableActions } from "@/lib/anomalies/action-input";
import { ActionPanel } from "./actions/action-panel";

export type AnomalyActionsProps = {
  anomaly: { id: number; status: string; verdict: string; version: number; assigneeId: string | null };
  currentUser: { id: string; role: "operator" | "admin" };
  // 팀장이 담당자를 고를 때 보여 줄 사용자 목록
  assignees: { id: string; displayName: string; role: string }[];
};

export function AnomalyActions({ anomaly, currentUser, assignees }: AnomalyActionsProps) {
  const available = availableActions(anomaly, currentUser);
  return <ActionPanel anomaly={anomaly} currentUserId={currentUser.id} assignees={assignees} available={available} />;
}
