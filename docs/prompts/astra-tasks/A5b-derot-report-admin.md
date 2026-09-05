<task>
Execute Task A5b from docs/superpowers/plans/2026-09-05-brogram-build-plan.md: the de-rot section with six drill components reading seed/drills, the PDF report, and the admin pages with their service-key routes. Branch: astra/A5b. Depends on A2, A5a, and Claude's C4 (drill seed). If the capacity valve in spec section 16 was triggered, Claude's subagents have already built some of these files on branch claude/A5b-valve; in that case your job is to review that branch against this task's end state, fix what fails, and merge it instead of rebuilding.
</task>

<context>
Spec sections 11 and 12 are the contract. hold-focus voids on blur or scroll. speed-type blocks paste with the same handler set as the editor. Each drill writes a DrillResult to wellness.drill_results and the de-rot streak increments once per day.
The report renders each page as an A4-ratio DOM container, screenshots each with html2canvas-pro, and adds one image per jsPDF page, all behind next/dynamic with ssr false inside a client component.
Admin: /admin and every /api/admin/* handler are gated server-side by `const ids = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean); if (!user || ids.length === 0 || !ids.includes(user.id)) return 404`. Invites (mint, list), users with integrity score and events, lift/restrict/ban buttons (service key writes to profiles), bank stats per CLO per pattern, agent usage counts per agent per day read from agent_usage with the service key.
</context>

<end_state>
- All six drills score and persist a DrillResult; the de-rot streak increments once per day.
- A PDF downloads with mastery per CLO, patterns passed, mistakes over time, time spent, drill scores, and the focus line.
- With ADMIN_USER_IDS empty, /admin returns 404 for a signed-in user. With Musa's id set, admin mints an invite and bans a test user; the banned user cannot read exercises_public.
</end_state>

<verification_loop>
npm test, npm run build, and a walk-through on the preview deploy of every end-state item above with the result of each stated in the report.
</verification_loop>
