# Runtime facts (verified 2026-09-05)

Every claim below was web-grounded by a research agent and then attacked by a second agent trying to refute it. Where the refuter won, the corrected fact is what appears here. Re-check anything marked **re-verify at install** with `npm view <pkg> version` before pinning.

## Decisions this research changed

| Was in the spec | Now | Why |
|---|---|---|
| Piston public API for Java | **Judge0 CE on RapidAPI** behind a `runJava()` abstraction, `JUDGE_PROVIDER` env | Public Piston has been whitelist-only since 2026-02-15 (live test returned 401). Self-hosted Piston needs a privileged Docker host, impossible on Vercel today. |
| pnpm | **npm** for this repo (`package-lock.json`) | Vercel's package-manager detection breaks on pnpm 11/12 lockfiles (vercel/vercel#17434, still open). The machine has pnpm 11. |
| `deepseek-chat` | **`deepseek-v4-flash`** (default), `deepseek-v4-pro` reserved | Old names retired 2026-07-24. |
| COOP/COEP headers for Pyodide interrupts | **No cross-origin isolation.** Timeouts terminate the worker and a warm standby worker takes over | `COEP: require-corp` breaks every cross-origin asset that lacks CORP headers. Not a launch-day risk worth taking. |
| Tone-agnostic font choice | Geist is available via `next/font/google` | Earlier claim that it needs the `geist` npm package was refuted against the live create-next-app template. |

## Versions (npm `latest` on 2026-09-05)

| Package | Version | Note |
|---|---|---|
| next / create-next-app | 16.3.4 | App Router, Turbopack default for dev and build |
| tailwindcss | 4.3.3 | CSS-first `@theme`; needs `@tailwindcss/postcss` too; verify after scaffold |
| @ai-sdk/deepseek | 3.0.39 | provider options `thinking`, `reasoningEffort`, `strict`; requires Node ≥ 22 |
| ai (Vercel AI SDK) | pair with the provider above | `generateObject` maps to DeepSeek JSON mode |
| zod | 4.5.4 | Use `error` param and `z.email()`; v3 chained style is deprecated |
| zustand | 5.0.15 | |
| vitest | 5.0.0 (published 2026-09-03) | If a plugin breaks, pin 4.1.x. `clearMocks` defaults true; config lookup no longer walks up |
| @playwright/test | 1.63.0 | |
| codemirror | 6.0.2 | lang-python 6.2.1, lang-javascript 6.2.5, lang-html 6.4.12, lang-sql 6.10.0, lang-java 6.0.2, lang-css current |
| pyodide (CDN) | v314.0.6 | CPython 3.14; core wasm 9.6 MB; numpy 2.4.6, pandas 3.0.2, matplotlib 3.10.8, scikit-learn 1.8.0 prebuilt |
| sql.js | 1.14.2 | copy `sql-wasm.wasm` to `public/` with a Node script (Windows-safe) |
| mingo | 7.2.4 | find, aggregate, update, updateOne, updateMany |
| gsap / @gsap/react | 3.15.0 / 2.1.2 | Fully free incl. ScrollTrigger and SplitText since 2025 |
| motion | 13.2.0 | import from `motion/react`, not `framer-motion` |
| jspdf / jspdf-autotable / html2canvas-pro | 4.2.1 / 5.0.8 / 2.4.1 | Client-only behind `next/dynamic({ ssr:false })` inside a `'use client'` file |
| adhan | 4.4.6 | Offline prayer-time fallback, `CalculationMethod.Qatar()` |
| @supabase/ssr, @supabase/supabase-js, supabase CLI | **re-verify at install** | Multiple releases per day; ssr was 0.12.6 on 2026-09-04 |
| vercel CLI | install with `npm i -g vercel` | Docs show `npm i vercel` without `-g`; the global install is what you want |

## DeepSeek

- Base URL `https://api.deepseek.com`, OpenAI-compatible. Models: `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp` (experimental, do not use). 1M context, 384K max output.
- Pricing per 1M tokens, off-peak / peak (peak = 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri; off-peak is half):
  - flash: cache-hit input $0.007 / $0.014; cache-miss input $0.22 / $0.44; output $0.66 / $1.32
  - pro: cache-hit $0.022 / $0.044; cache-miss $0.66 / $1.32; output $1.98 / $3.96
- Doha is UTC+3, so peak is 04:00–07:00 and 09:00–13:00 local, weekdays. Students hammering the tutor at 11:00 on a Tuesday pay double. Irrelevant at beta scale, worth a dashboard note.
- **JSON mode:** `response_format: { type: 'json_object' }`; the word `json` must appear in the prompt with a schema example; can occasionally return empty content, so validate and retry. Set `max_tokens` generously.
- Reasoning is a per-request toggle (`thinking: { type: 'enabled' }`, `reasoningEffort: 'low' | 'high' | 'max'`), not a separate model. Not needed for any of the seven agents at launch.
- Rate limits are **concurrency**, not RPM: flash 2,500 concurrent, pro 500. A 429 means too many in-flight; back off and retry, do not count per-minute.
- Prompt cache is automatic on repeated prefixes; keep the static system prompt first.
- Tool calling supported; not used at launch (JSON mode is enough).

## Supabase

- **Sign-up gate:** the `before-user-created` auth hook, implemented as a Postgres function. Returning `{}` allows; returning `{"error":{"http_code":403,"message":"..."}}` rejects with a custom message. The new user does not exist yet inside the hook; only `event->'user'->>'email'` is available. Manual SQL needs `grant execute on function ... to supabase_auth_admin;` and `revoke execute ... from authenticated, anon, public;`. Register the hook in Dashboard → Authentication → Hooks after the migration is pushed.
- **Do not** put a trigger on `auth.users` for this; it is unsupported.
- Known issue supabase/supabase#38751: "Invalid payload sent to hook" in some rejection paths. Test the rejection end-to-end through `signInWithOtp`, not just password sign-up.
- `signInWithOtp({ email, options: { shouldCreateUser: false } })` has a history of not reliably blocking creation (supabase-js#637). The hook is the real gate; `shouldCreateUser` is belt and braces.
- **Magic link:** email template link → `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`; route handler calls `supabase.auth.verifyOtp({ token_hash, type: 'email' })`. Or 6-digit code via `verifyOtp({ email, token, type: 'email' })`. Codes expire in 1 hour, one request per 60 s.
- In middleware and server code use `getClaims()` or `getUser()`, never `getSession()`.
- RLS: write `(select auth.uid())` not bare `auth.uid()` for per-statement evaluation. A "banned" check in RLS is an extrapolation, not an official example; test it.
- **CLI on Windows:** install via Scoop, not npm (`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase`). Non-interactive link: `supabase link --project-ref <ref>` with `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` set. `supabase migration new <name>` → edit → `supabase db push` (omit `--include-seed`). Local `supabase start` needs Docker Desktop; skip locally today and push to the real project.

## Vercel

- `npm i -g vercel` → `vercel login` → `vercel link --yes` → `vercel env add NAME production` (also `preview`) → `vercel deploy` (preview) → `vercel deploy --prod`. The very first deploy of a new project is production regardless of flag.
- `vercel env add` stores Production/Preview values as **sensitive** (unreadable later) unless `--no-sensitive`. Keep a local copy of every secret.
- Never set a manual "Install Command" override of `pnpm install`; it pins the oldest pnpm in the image.
- Route Handlers default to the Node runtime and can stream with `ReadableStream` in a `Response`. Do not set `runtime = 'edge'`.
- Set the project's Node version to 22.x or later (provider package requires it). Node 24 locally.

## Pyodide

- Load in a dedicated Web Worker: `importScripts('https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide.js'); const pyodide = await loadPyodide();`
- `await pyodide.loadPackage(['numpy','pandas','matplotlib','scikit-learn'])` only on courses that need them; scikit-learn drags scipy, the largest wheel. Load per course, not per session.
- Capture output with `pyodide.setStdout({ batched })` and `setStderr({ batched })`.
- Grading: run student code with `runPython(studentCode)`, then a harness that calls the target function per test inside try/except and builds a results list; pull it with `pyodide.globals.get('results').toJs()`.
- **Timeouts without SharedArrayBuffer:** main thread sets a deadline; on expiry calls `worker.terminate()`, marks remaining tests as `timeout`, and promotes a pre-warmed standby worker (already past `loadPyodide`) to active, then spawns a new standby. Cost: one extra ~10 MB download per session (browser-cached after the first).
- The `pyodide` npm package exists (314.0.6) but self-hosting the package wheels is not worth it today; CDN is fine.

## In-browser SQL and Mongo

- sql.js: `postinstall` Node script copies `node_modules/sql.js/dist/sql-wasm.wasm` → `public/sql-wasm.wasm`; `initSqlJs({ locateFile: f => `/${f}` })`; `db.run()` for DDL/DML, `db.exec()` returns `[{ columns, values }]`; always `stmt.free()`, `db.close()` per exercise. Dynamic-import inside a client component only.
- mingo: `import { find, aggregate, update, updateOne, updateMany } from 'mingo'`. Covers find/aggregate/update operators for the course. No persistence, no geo. Editor highlighting reuses the JSON/JS grammar.

## Java judge (Judge0 CE)

Decision 2026-09-06: no judge provider at launch; Judge0 is not used. The section below is kept for a future provider.

- Sign up at rapidapi.com → subscribe to `judge0-ce` Basic (free) → get `X-RapidAPI-Key`. **Musa does this before the build reaches the judge task.**
- `POST https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true` with `{ language_id: 62, source_code, stdin }` (62 = Java OpenJDK 13.0.1). Response: `stdout`, `stderr`, `compile_output`, `status: { id, description }`, `time`, `memory`. With `wait=true` no polling is needed for short runs; fall back to `GET /submissions/{token}` if `wait` is refused.
- Free-tier quota could not be read (JS-rendered pricing page). Check it on the RapidAPI dashboard after subscribing and put the number in this file.
- Long-term: self-host Piston (`ghcr.io/engineer-man/piston`, needs `--privileged`) on a small VPS and flip `JUDGE_PROVIDER=piston`.

## Editor

- CodeMirror 6, not Monaco. Block clipboard with one facet: `EditorView.domEventHandlers({ paste, copy, cut, contextmenu })`, each `preventDefault()` and `return true`. Also bind `mousedown` with `button === 2` on `view.contentDOM` for Firefox.
- `visibilitychange` fires inconsistently across browsers during navigation; fine for logging.
- PrintScreen: use **`keyup`** with `key === 'PrintScreen' || keyCode === 44`; Firefox does not fire `keydown` for it. Best effort only.

## Prayer times

- `GET https://api.aladhan.com/v1/timings/DD-MM-YYYY?latitude=25.2854&longitude=51.5310&method=10` (method 10 = Qatar; do not use 8 = Gulf, and do not omit `method`, default is 3). No key. CORS `*`. About 12 requests/second limit; cache per day in `localStorage`.
- Response: `data.timings.{Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha,...}` as `HH:MM`.
- Fallback: `adhan` npm with `CalculationMethod.Qatar()` computed locally.

## PDF

- jsPDF + html2canvas-pro. Render each report page as its own A4-ratio DOM container, screenshot each, `addImage` one per page. Raster output, acceptable for v1. `@react-pdf/renderer` is blocked by a Windows-only Turbopack junction-point bug; `pdf-lib` is unmaintained.

## Fonts and UI

- `next/font/google`: Geist and Geist Mono are available there (also Outfit, JetBrains Mono). Cabinet Grotesk and Clash Display are Fontshare only and would need `next/font/local`. Inter is banned by the taste file.
- Tailwind v4: `postcss.config.mjs` with only `@tailwindcss/postcss`; `@import "tailwindcss";` in `globals.css`; fonts wired via `@theme inline { --font-sans: var(--font-geist-sans); }`.
- shadcn/ui: `npx shadcn@latest init` detects Tailwind v4.
- GSAP 3.15 + `useGSAP` from `@gsap/react` inside `'use client'` components only.

## Testing

- Vitest config per the Next.js guide: `vitest.config.mts` with `tsconfigPaths()` and `react()`, `environment: 'jsdom'`. Vitest cannot test async Server Components; the agent route is covered by a direct handler test with `AGENT_DRY_RUN=true` plus Playwright.
- Playwright: `npm init playwright@latest`; `webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI, timeout: 120_000 }`.

## GitHub

- `winget install --id GitHub.cli --source winget` → new terminal → `gh auth login` → `git init && git add . && git commit -m "init"` → `gh repo create brogram --public --source=. --remote=origin --push`.
