// 조치내용·판정 사유·재개 사유의 "공백 제외 글자 수" 계산 (PRD 5-3: 공백 제외 10자 이상)
// DB와 같은 규칙: 모든 공백문자(스페이스·탭·줄바꿈·전각 공백 등)를 지운 뒤 길이를 센다.
// 화면의 실시간 글자 수 안내와 서버 액션 검사가 같은 함수를 쓴다.

export const REASON_MIN_LENGTH = 10; // 공백 제외 최소 글자 수
export const REASON_MAX_LENGTH = 2000; // 입력 전체 길이 상한 (공백 포함)

// 공백을 뺀 글자 수. 한글·이모지 같은 글자는 사람이 보는 글자 한 개를 한 개로 센다.
export function countReasonChars(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length;
}

export function isReasonLongEnough(text: string): boolean {
  return countReasonChars(text) >= REASON_MIN_LENGTH;
}
