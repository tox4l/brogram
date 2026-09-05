<task>
Execute Task A3 from docs/superpowers/plans/2026-09-05-brogram-build-plan.md: implement getRuntime(language) and six RuntimeAdapter implementations (pyodide with active plus warm standby workers, javascript/typescript worker, sandboxed iframe web runner, sql.js, mingo, and the Judge0 client adapter) plus POST /api/judge, each with one golden-exercise test in Vitest. Branch: astra/A3.
</task>

<context>
Read docs/research/runtime-facts.md sections Pyodide, In-browser SQL and Mongo, Java judge, and Editor before writing a line. The Python grading harness and the timeout strategy are spelled out in the plan; use them as written. Test inputs and expected strings follow the TestCase conventions in docs/prompts/agents/03-author.md (function tests: input is a json array of args, expected is the json-serialized return; program tests: stdin and stdout; sql: query and json rows; web: DOM assertion returning "ok"; mongo: { op, args } json).
Judge0: POST https://${JUDGE0_HOST}/submissions?base64_encoded=false&wait=true with X-RapidAPI-Key and X-RapidAPI-Host headers, body { language_id: 62, source_code, stdin, cpu_time_limit: 10, wall_time_limit: 15 }. If the response is non-2xx or lacks status.id, re-POST with wait=false and poll GET /submissions/{token}?base64_encoded=false every 500 ms for up to 10 s. Map status.id 3 to pass, 5 to timeout, 6 to compile-error, everything else to runtime-error. If JUDGE0_API_KEY is absent, the route returns 503 with error "judge-not-configured" and the adapter surfaces that as a single failed test with failureKind "runtime-error" and a clear stderr.
The judge route has the same preamble as the agent route: getUserAndProfile() (401 when signed out, 403 when banned), a per-user limit of 30 submissions per hour (in-memory bucket keyed by user id), a 64,000-character cap on code plus stdin (413), and a server-side language check (java, or anything when JUDGE_ALL_LANGUAGES=true; otherwise 503 judge-disabled).
</context>

<end_state>
- Each adapter passes its golden test in npm test (Pyodide via the pyodide npm package in Node; web via jsdom; judge via a fetch stub).
- An infinite loop in Python is cut at 5 seconds, remaining tests marked timeout, and the next run starts within 500 ms because the standby worker was warm.
- Package loading for the data science course reports progress events the UI can show.
- A signed-out POST to /api/judge returns 401; a 65,000-character body returns 413; a python submission with JUDGE_ALL_LANGUAGES unset returns 503.
- Every adapter grades the matching exercise in seed/exercises/smoke.json green using its reference solution as the student code (java through a fetch stub that returns the expected stdout).
</end_state>

<verification_loop>
Run npm test and paste the adapter test results. Manually run the infinite-loop case in the browser on the preview and time it.
</verification_loop>

<action_safety>
Do not add COOP/COEP headers. Do not switch the editor or judge choices. Do not implement the exercise screen here; that is A4.
</action_safety>
