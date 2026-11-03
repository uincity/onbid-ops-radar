-- 점검 오퍼레이션이 늘어(실호출 확인 15개, 일반 조회기로 추가 점검 13개) 한 번의 점검에 쓸 호출 기본 상한을 20회에서 60회로 올린다.
-- Design Ref: PRD 5-5(기존 단일 엔진 호출 상한 기본 20/최대 100 → 배치 단위로 재해석), lib/checks/run-check.ts(추가 오퍼레이션 몫을 먼저 떼어 둠)
--
-- 근거: 추가 오퍼레이션 13개가 13회를 먼저 쓰므로 20회면 목록·상세에 7회만 남는다. 60회면 상세를 40건 가까이 확인할 수 있다.
-- 한계는 호출 수가 아니라 실행시간 60초(호출 1번 평균 약 0.1~0.4초)와 PUBLIC 일일 예산 900회다. 최대 상한 100회는 그대로다.
-- 값만 바꾸고 구조·제약은 건드리지 않는다. 코드의 기본값(lib/settings/schema.ts)도 같은 값이며 tests/unit/settings-drift.test.ts가 둘이 같은지 확인한다.

update public.settings set value = '60'::jsonb where key = 'api_call_limit_default';
