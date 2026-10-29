// DB 테이블 확인 스크립트들이 함께 쓰는 도우미 (PLAN 작업 6, 7~)
// - 구조 확인은 읽기 전용 조회만 한다. (Supabase 관리 API의 SQL 조회)
// - 동작 확인은 두 가지 방식만 쓴다. 어느 쪽도 저장되는 줄이 남지 않는다.
//     1) 일부러 틀린 값을 보내 보고 거부되는지 본다. (rest)
//     2) 트랜잭션 안에서 넣어 보고 마지막에 되돌린다. (rollbackProbe)
// 비밀 값은 출력하지 않는다.

export function createChecker() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (![ref, token, url, publishable, secret].every(Boolean)) {
    console.error("실패: 환경변수가 부족합니다. npm run check:env를 먼저 실행해 주세요.");
    process.exit(1);
  }

  let failed = 0;

  function report(ok, label, detail = "") {
    if (!ok) failed += 1;
    console.log(`${ok ? "통과" : "실패"} | ${label}${detail ? ` — ${detail}` : ""}`);
  }

  async function sql(text) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: text }),
      signal: AbortSignal.timeout(30_000),
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  }

  // 읽기 전용 조회
  async function query(text) {
    const res = await sql(text);
    if (!res.ok) throw new Error(`조회 실패 (응답 ${res.status})`);
    return JSON.parse(res.body);
  }

  // 데이터 API 요청: 응답 상태와 오류 코드만 돌려준다
  async function rest(table, method, key, body) {
    const res = await fetch(`${url}/rest/v1/${table}${method === "GET" ? "?select=id&limit=1" : ""}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    let code = "";
    try {
      code = (await res.json())?.code ?? "";
    } catch {
      // 본문이 비어 있으면 코드 없음
    }
    return { status: res.status, code };
  }

  // 되돌리는 시험: DO 블록 안에서 넣어 보고 결과(JSON)를 오류 메시지에 실어 마지막에 일부러 중단시킨다.
  // 중단되면 안에서 넣은 모든 줄이 취소되므로 DB에는 아무것도 남지 않는다.
  async function rollbackProbe(body) {
    const res = await sql(`do $probe$ declare r jsonb := '{}'::jsonb; ${body} raise exception 'RESULT:%', r::text; end $probe$;`);
    const match = res.body.match(/RESULT:(\{.*?\})(?:\\n|"|\n|$)/);
    if (!match) throw new Error(`되돌리는 시험의 결과를 읽지 못했습니다 (응답 ${res.status})`);
    return JSON.parse(match[1].replace(/\\"/g, '"'));
  }

  // 읽기 전용 테이블(로그인 사용자 읽기, 쓰기는 서버만)의 공통 확인
  // sampleRow: 규칙에는 맞는 올바른 줄. 로그인 없이 보냈을 때 "모양이 틀려서"가 아니라 "권한이 없어서" 거부되는지 보려는 것이다.
  async function checkReadOnlyTable(table, requiredColumns, sampleRow) {
    const [found] = await query(
      `select c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = '${table}' and c.relkind = 'r'`,
    );
    report(Boolean(found), `public.${table} 테이블 있음`);
    if (!found) return;

    report(found.rls === true, `${table}: RLS(출입 규칙) 켜짐`);

    const columns = await query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = '${table}'`,
    );
    const names = new Set(columns.map((c) => c.column_name));
    const missing = requiredColumns.filter((c) => !names.has(c));
    report(missing.length === 0, `${table}: 칸 ${requiredColumns.length}개 모두 있음`, missing.length ? `없음: ${missing.join(",")}` : "");

    const policies = await query(
      `select cmd, roles from pg_policies where schemaname = 'public' and tablename = '${table}'`,
    );
    report(
      policies.length === 1 && policies[0].cmd === "SELECT" && String(policies[0].roles).includes("authenticated"),
      `${table}: 정책은 '로그인 사용자 읽기' 하나뿐 (쓰기 정책 없음)`,
      `정책 ${policies.length}개`,
    );

    const grants = await query(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = '${table}' and grantee in ('anon', 'authenticated')`,
    );
    const authPrivs = grants.filter((g) => g.grantee === "authenticated").map((g) => g.privilege_type);
    report(grants.every((g) => g.grantee !== "anon"), `${table}: 비로그인(anon)은 아무 권한 없음`);
    report(authPrivs.length === 1 && authPrivs[0] === "SELECT", `${table}: 로그인 사용자는 읽기(SELECT)만 가능`, `권한: ${authPrivs.join(",") || "없음"}`);

    const read = await rest(table, "GET", publishable);
    report([401, 403].includes(read.status), `${table}: 로그인 없이 읽기 시도 → 거부`, `응답 ${read.status}`);
    const write = await rest(table, "POST", publishable, sampleRow);
    report(
      [401, 403].includes(write.status) && write.code === "42501",
      `${table}: 로그인 없이 (올바른 모양의) 줄 쓰기 시도 → 권한 없음으로 거부`,
      `응답 ${write.status}, 오류 ${write.code}`,
    );
  }

  async function expectEmpty(tables) {
    for (const table of tables) {
      const [{ count }] = await query(`select count(*)::int as count from public.${table}`);
      report(count === 0, `${table}: 시험 후에도 비어 있음 (저장된 줄 없음)`, `${count}줄`);
    }
  }

  function finish() {
    return failed;
  }

  return { report, sql, query, rest, rollbackProbe, checkReadOnlyTable, expectEmpty, finish, keys: { publishable, secret } };
}
