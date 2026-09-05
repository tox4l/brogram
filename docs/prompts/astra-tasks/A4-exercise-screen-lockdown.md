<task>
Execute Task A4 from docs/superpowers/plans/2026-09-05-brogram-build-plan.md: the exercise screen at /exercise/[id], the CodeMirror 6 editor with clipboard blocking, useLockdown per spec section 9, useExerciseLoop implementing the fail and pass paths and the chain rule, and a local Playwright smoke. Branch: astra/A4. Depends on A3 (runtimes) and Claude's C1 (callAgent) and C2 (pickFromBank, nextInChain, applyPass, applyFail, pointsForPass). If C1 or C2 are not merged yet, code against the Interfaces blocks in the plan and stub with the fallback shapes; do not invent different names.
</task>

<context>
Spec sections 7.2 and 9 are the contract. Exact numbers: idle blur 15 s, idle log at 60 s, max 5 hints, difficulty starts at 3. Hint rule: the first hint after a failure unlocks on edit or after 60 s, whichever first; every later hint needs 60 s since the last Coach call. Integrity events are inserted in batches of at most one row per second per type. The overlay is a separate element above the editor with pointer-events enabled, not a CSS filter on the editor. Streaming agents (diagnoser, coach) come through Claude's streamAgent helper: render the partial frames optimistically and, on the terminal envelope frame, discard partials and commit only the envelope's reply.
The bank-miss branch: when pickFromBank returns null after widening (preferred patterns dropped, difficulty ±2, any unseen on the CLO), call the Author with exampleIds (two ids from the CLO) and parentExerciseId (the last passed exercise on the CLO, if any); the reply carries the new exercise with its id and reference solution; run the reference against the tests in the runtime; on success POST /api/exercises/verify { id } and open the exercise; on failure show the nearest bank exercise and log to console.
Non-code kinds (Step 3b): predict-output renders a textarea and grades by whitespace-normalised compare against the single test's expected; spot-the-bug renders the snippet with clickable line numbers and grades set-equality against expected (a JSON array of line numbers); trace renders one input per variable and grades exact per-cell compare against expected (a JSON object); schema routes through the sql adapter (fixture plus the student's DDL, then the tests' structural queries). These four never call the Coach with a diff; they call the Diagnoser on fail with the typed answer in place of code.
Design: prompt panel left, editor centre, results and fix plan right; wellness strip collapsed at the top; no decorative motion; the editor is the hero.
</context>

<end_state>
- A test with a spy on callAgent proves no agent call happens on mount, on typing, or on a timer; exactly one Diagnoser call on a failed submit; Coach only on the hint button; Reviewer exactly once on pass.
- Fake-timer test: 14 s idle no overlay, 15 s overlay, keypress clears, 60 s produces one idle event.
- Playwright smoke passes locally with AGENT_DRY_RUN=true against the smoke exercises (run `node scripts/seed-load.mjs` first and paste the counts): wrong solution, submit, fix plan shows, fixed solution passes, next exercise loads with a different pattern.
</end_state>

<verification_loop>
npm test, npm run build, the Playwright smoke. Paste outputs.
</verification_loop>
