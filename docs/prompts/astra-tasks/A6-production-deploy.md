<task>
Execute Task A6 from docs/superpowers/plans/2026-09-05-brogram-build-plan.md: set every variable in .env.example on Vercel for production and preview, set the project Node version to 22.x or later, deploy to production, confirm the Supabase auth hook is registered, then after Musa's first sign-in set ADMIN_USER_IDS on Vercel and app.admin_user_ids in Postgres and redeploy, and run the three Playwright flows against the latest preview deploy with AGENT_DRY_RUN=true and a service-key test session (the same environment C5 wrote them for; only baseURL changes). The real-user production checks (magic link, gmail rejection, Java run) are Claude's C6 manual smoke with Musa in the loop. Branch: main (deploy only; no code changes unless a deploy blocker needs one, in which case branch astra/A6-fix and PR).
</task>

<context>
vercel env add stores production values as sensitive; Musa must keep local copies. The first deploy of a new project is production regardless of the flag; every later deploy needs --prod. The auth hook registration is a dashboard step; verify it by attempting a gmail sign-up on production and reading the rejection message.
</context>

<end_state>
- Production URL live with the footer and the login page.
- gmail sign-up rejected with the hook message on production (you can test this one yourself without an inbox).
- Three Playwright flows green against the preview deploy.
- ADMIN_USER_IDS set on Vercel and app.admin_user_ids in Postgres, followed by a redeploy.
- Report includes the URL, the list of env vars set (names only), and any manual step still pending.
</end_state>

<verification_loop>
Paste the deploy output, the Playwright summary, and the exact rejection message observed.
</verification_loop>

<action_safety>
Never print secret values in the report. Never run migrations from this task; if a migration is missing, stop and report which.
</action_safety>
