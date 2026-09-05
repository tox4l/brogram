<task>
Execute Task A2 from docs/superpowers/plans/2026-09-05-brogram-build-plan.md: Supabase browser, server, and middleware clients per the @supabase/ssr App Router guide using getClaims(); magic-link login page; /auth/confirm route; the (app) layout with the banned and restricted gates; the app shell (nav: Courses, De-rot, Reports, Buddy button; wellness rail slot; footer); the Zustand session store; and the dashboard skeleton with designed empty states. Branch: astra/A2.
</task>

<context>
The login page must display the auth hook's rejection message verbatim when signInWithOtp errors, because that message is the product's only explanation of the .edu.qa and invite rules. After confirm, route to /onboarding when learner_state is missing or profile.onboardingComplete is false, otherwise /dashboard.
Dashboard sections (spec section 12): current course, next three exercises, exercise streak and de-rot streak, points, mastery grid per CLO, wellness rail, buddy button, de-rot shortcut. Wire every section to useSession(); where data is not yet available (Claude's Learner State compile lands in C2), render the designed empty state, not lorem or a spinner.
</context>

<end_state>
- npm run build clean.
- A signed-out visit to /dashboard redirects to /login.
- Login with an uninvited gmail address shows the hook message.
- Restricted account sees the banner with restricted_until; banned account is signed out with the one-line message.
- Preview deploy URL in the report.
</end_state>

<verification_loop>
Run npm run build and npm test. Exercise the redirect and the restricted/banned gates by temporarily setting account_status on your test user through the SQL editor, then reset it.
</verification_loop>
