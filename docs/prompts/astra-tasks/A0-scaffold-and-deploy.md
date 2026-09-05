<task>
Execute Task A0 from docs/superpowers/plans/2026-09-05-brogram-build-plan.md: scaffold the Next.js 16 app INTO this folder (scaffold beside it, copy in, keep docs/ and seed/), install the fixed dependency set with npm, add the sql.js wasm copy script and package scripts, extend .gitignore per the plan, create .env.example, copy the contracts to src/lib/contracts.ts, render a placeholder home page with the "Built by Velocity" footer, build clean, and deploy a preview with the Vercel CLI. Branch: astra/A0.
</task>

<end_state>
- npm run build exits 0 on a fresh clone.
- The first Vercel deploy (which is production for a new project) renders the placeholder; every later deploy is a preview unless --prod.
- The curated .gitignore survived the scaffold copy (git check-ignore -v "UDST START" prints a match; git status shows no raw-condensed.txt).
- Tailwind v4 confirmed in package.json and postcss.config.mjs.
- public/sql-wasm.wasm exists after npm install.
- No pnpm-lock.yaml anywhere.
- Repo initialised, first commit "chore: scaffold brogram", pushed via gh repo create brogram --public --source=. --remote=origin --push (install gh with winget if missing; if gh auth is not possible, stop and report the exact command Musa must run).
</end_state>

<verification_loop>
Run npm run build, node seed/validate.mjs, vercel deploy, and paste the preview URL. Confirm node -e "require('./package.json')" shows name "brogram".
</verification_loop>

<action_safety>
Do not touch docs/ or seed/ content except moving nothing; they stay in place. Do not add dependencies outside the plan's Step 4 list.
</action_safety>
