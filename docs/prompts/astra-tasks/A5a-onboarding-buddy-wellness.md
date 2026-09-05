<task>
Execute Task A5a from docs/superpowers/plans/2026-09-05-brogram-build-plan.md: onboarding (two phases driven by the Profiler, then course choice and a plan-refresh Planner call), the buddy drawer, and the wellness rail (prayer via Aladhan method 10 with the adhan fallback, water and stretch, pomodoro). Branch: astra/A5a. Depends on A2 and Claude's C1 (callAgent, streamAgent) and C4 (profiler fallback questions). Can start as soon as A2 is merged, before A3 and A4.
</task>

<context>
Spec sections 10 and 12 are the contract. Onboarding shows no code and finishes in under four minutes; phase-2 motivation keys arrive one per turn and must be merged into the existing profile, never replaced. After onboarding the client fetches up to 30 candidates from exercises_public for the first three CLOs of the chosen course and calls the Planner with trigger plan-refresh; if candidates are empty the dashboard shows the Planner's "still being prepared" focus line, not an error.
Prayer reminders queue while an attempt is active (a sessionStorage flag the exercise screen sets in A4; until A4 lands, the flag is simply never set). The buddy drawer sends the last 6 messages, persists to buddy_messages, renders a suggestion chip when present, and renders the off-topic refusal without a streaming cursor.
</context>

<end_state>
- Onboarding completes end to end with AGENT_DRY_RUN=true using the Profiler fallback questions and lands on a dashboard populated from the smoke exercises (run `node scripts/seed-load.mjs` first and paste the counts).
- Prayer times for today show for Doha; disabling one prayer stops its toast; with the network blocked the adhan fallback still shows times.
- Water, stretch, and pomodoro timers persist prefs to wellness.prefs and survive a reload.
- Buddy shows the fixed refusal for "what is the capital of France" and a data-backed answer for "why do I keep failing loops".
</end_state>

<verification_loop>
npm test, npm run build, and a walk-through on the preview deploy of every end-state item above with the result of each stated in the report.
</verification_loop>
