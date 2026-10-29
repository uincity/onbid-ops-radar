# PLAN-POC — 남은 작업 보관과 PoC 압축 계획

작성일: 2026-10-29. 기준은 PLAN.md이고, 이 문서는 "지금까지 만든 것으로 작게 시험해 보기 위한 압축판"입니다.

## 1. 지금까지 끝난 작업

PLAN 1~18번 (준비·DB·로그인·화면 틀·설정값·DEMO 160건·날짜 정합성 규칙).
병합 대기 브랜치(쌓인 순서): `feature/login` → `feature/app-frame` → `feature/settings-module` → `feature/demo-scenarios` → `feature/date-rule` → `feature/poc-detect`.

## 2. 남은 작업 (PLAN.md 19~39번)

| 묶음 | 작업 |
|---|---|
| Must 1 탐지 | 19 필수정보 규칙 · 20 목록·상세 규칙 · 21 DEMO 조회기 · 22 점검 실행 엔진(`start_check_run`) · 23 중복·재발 처리(`record_detection`) · 24 팀장 수동 점검 버튼 |
| Must 2 확인·조치 | 25 이상징후 목록·상세 화면 · 26 배정(`assign_anomaly`) · 27 상태·판정 변경 · 28 이벤트 이력 화면 |
| 대시보드·보고서 | 29 통합 대시보드 · 30 일일 점검보고서 |
| 자동화·실데이터 | 31 09:00 예약 점검 Cron · 32 09:30 누락 감지 · 33 PUBLIC 조회기(부록 A 확정 후) |
| 검증·배포 | 34~39 (PLAN.md 84행 이후 참고) |

사용자 몫: 공개 회원가입 끄기(Supabase 대시보드), 온비드 활용신청(5번).

## 3. PoC 압축 계획 (이번에 진행)

목표: 지금까지의 결과로 "탐지 3개 규칙이 DEMO 160건을 정답표와 똑같이 판정한다"를 한 번에 눈으로 확인한다.

| PoC 단계 | 원래 작업 | 내용 | 상태 |
|---|---|---|---|
| P1 | 19 | 필수정보 규칙 `lib/rules/required-fields.ts` | 완료 |
| P2 | 20 | 목록·상세 규칙 `lib/rules/list-detail.ts` (허용 시간은 설정값에서 받음) | 완료 |
| P3 | 압축 | 3규칙 묶음 `lib/rules/detect-item.ts` (저장 없이 판정만) | 완료 |
| P4 | 압축 | 시험 `tests/unit/poc-detect.test.ts` — 경계값 + 160건 채점 + 요약표 | 완료 |

PoC에서 일부러 하지 않는 것: DB 저장·이상징후 생성(23번), 점검 엔진(22번), 화면(25번~), DEMO 조회기(21번).

확인 방법: `npm run test:unit -- poc-detect` (요약표가 출력되고 모두 통과)
