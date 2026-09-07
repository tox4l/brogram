# Self-hosting BroGram

Everything below runs against your own **local** Supabase project. No Vercel
account, no BroGram-hosted service of any kind, and — with one setting — no
DeepSeek API key either. Requires Node.js 22 or later, npm, and Docker
Desktop (Supabase's local stack runs in containers).

## 1. Install

```bash
git clone <your fork's URL>
cd brogram
npm install
```

`postinstall` also runs `scripts/fetch-java-tools.mjs`, which downloads
OpenJDK 8's `tools.jar` (18 MB, GPLv2 with the Classpath Exception — see
`public/java/TOOLS-JAR-LICENSE.md`) so Java exercises can compile in the
browser. It warns and moves on if the download fails; only Java exercises
are affected, everything else in this guide works either way.

## 2. Start a local Supabase project

```bash
npx supabase@latest start
```

The first run pulls several Postgres/Auth/Storage container images (a few
minutes); every run after that is fast. When it finishes it prints an API
URL, a DB URL, and two JWTs — keep that output, the next step copies from
it. (`npx supabase@latest status` reprints the same block later if you lose
it.)

## 3. Configure `.env.local`

```bash
cp .env.example .env.local
```

Fill in, from the `supabase start` output:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the "anon key" line>
SUPABASE_SERVICE_ROLE_KEY=<the "service_role key" line>
SUPABASE_DB_URL=<the "DB URL" line>?sslmode=disable   # e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable
```

`SUPABASE_DB_URL` is not one of the four variables in `.env.example` — it is
`scripts/db-apply.mjs`'s override for exactly this case. That script's
default connection shape (`SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD`)
builds a connection string for Supabase's **hosted** pooler, which does not
exist for a project running on your own machine; setting `SUPABASE_DB_URL`
directly skips that and points it straight at your local Postgres.

The `?sslmode=disable` suffix matters and is not optional: the script always
opens with TLS verification on (it deliberately refuses to turn verification
off on its own — see its header comment), which is correct for the hosted
pooler but wrong for a local container that speaks plaintext Postgres on
`127.0.0.1`. `pg` lets the connection string's own `sslmode` override that,
so this one token is what lets `npm run db:apply` reach a local project at
all; leaving it off fails step 4 below either with "the server does not
support SSL connections" or, if the container does present a certificate,
with a self-signed-cert error that names a hosted-pooler root CA this local
setup has no use for.

If you would rather skip `db:apply` entirely for local work, `npx
supabase@latest db reset` applies everything in `supabase/migrations/`
directly against the local project as part of resetting it — a second,
equally valid path for a project that only ever runs locally. `db:apply` is
the applier this guide uses because it is also how a fork pushes the same
migrations to a **hosted** Supabase project later.

Leave `DEEPSEEK_API_KEY` blank and set:

```bash
AGENT_DRY_RUN=true
```

The remaining keys can stay at their `.env.example` defaults
(`JUDGE_PROVIDER=none`, `NEXT_PUBLIC_JUDGE_PROVIDER=browser`,
`NEXT_PUBLIC_AUTH_MAGIC_LINK=false`). `INVITES_REQUIRED` and `ADMIN_USER_IDS`
gate a hosted deployment's sign-up and admin panel (see
`docs/supabase-auth-setup.md`); a fresh local project has neither the
before-user-created hook registered nor an admin row, so both are no-ops
here — sign up with any email and you're in.

## 4. Apply the schema

```bash
npm run db:apply
```

Applies every file in `supabase/migrations/` in order, in one transaction
each, recording what it applied in `supabase_migrations.schema_migrations`
so re-running it later only applies what's new. Add `-- --dry-run` to list
what's pending without touching the database:

```bash
npm run db:apply -- --dry-run
```

`--dry-run` reads that same ledger table rather than writing to it, so on a
project that has never had a migration applied yet — the exact state right
after `supabase start` on a brand-new clone — it has nothing to read and
refuses with "ledger table not found" instead of listing anything. Run the
real `npm run db:apply` first (or `supabase db reset`, which records the
ledger for you); `--dry-run` is for previewing what a *later* edit to
`supabase/migrations/` would add, once the ledger already exists.

## 5. Load the curriculum

```bash
npm run seed:verify   # sanity-checks seed/ before it touches a database
npm run seed:load     # writes courses, CLOs, patterns, exercises, drills, lessons
```

See `docs/CONTENT.md` if you want to edit or replace the courses before this
step — that document is the full authoring workflow, end to end.

## 6. Build the curriculum bundle

```bash
npm run curriculum:build
```

The browser never queries Supabase for course content directly; it fetches a
static bundle under `public/curriculum/`, which is gitignored and written
only by this command (or by `npm run build`'s `prebuild` step). **`npm run
dev` does not build it for you** — skip this step and every course, lesson,
and exercise 404s the moment you open one, even though the server is running
and the database is loaded. See `docs/CONTENT.md` for what it writes.

## 7. Run it

```bash
npm run dev
```

Open `http://127.0.0.1:3000`. Sign up with any email address — a local
Supabase project leaves email confirmation off by default, so sign-up
completes immediately and you land straight in the app; there is no message
to go looking for. (If you turn confirmations on in `supabase/config.toml`,
`supabase start`'s output links a local mail catcher — Mailpit on current
Supabase CLI versions — that holds it instead.)

## What `AGENT_DRY_RUN=true` actually gives you

With no DeepSeek key at all, every one of the seven agents still answers,
instantly, with the same deterministic fallback reply it would give in
production if DeepSeek itself timed out or returned something invalid — the
fallback is not a stub added for self-hosting, it already ships in every
deployment as the last line of defence in `src/app/api/agent/route.ts`. What
you will actually see:

- **A walkthrough** (a lesson) is unaffected either way — lessons are static
  content authored offline (`docs/CONTENT.md`) and served from the seed
  bundle, not generated by an agent at request time. Every walkthrough in
  the seeded courses reads exactly the same in dry-run mode as it does in a
  full production deploy.
- **A fix plan**, from the Diagnoser after a failed attempt, always reads:
  *"You were going for a solution that handles the example, but at least one
  test still disagrees with it,"* naming `unclassified` as the mistake and a
  four-step generic plan ending, as every fix plan does, with "Run the
  visible examples before you submit again."
- **A hint**, from the Coach, is always: *"Pick the first visible example,
  run your code on it in your head, and write down the value of every
  variable at each step until it disagrees with the expected output."*

Every other agent behaves the same way — a fixed, on-brand reply instead of
a model call — except Author, which has no fallback (dry run answers its
request with a `502`, since a variant it cannot generate cannot be honestly
faked as one). Nothing about this is exercise-grading or points logic: the
browser still runs the learner's code and grades it against real tests
either way, exactly as `AGENT_DRY_RUN` never touches anything but the
`/api/agent` route. This is also the mode `npm run perf:timings` runs the
performance suite in, so DeepSeek's latency never pollutes a timing budget.

## Verify it's really working

```bash
npm test            # vitest, unit and component tests — needs no network
```

`npx playwright test` needs two things this guide's steps above don't set up
on their own, both covered in full in `e2e/README.md`:

- Its own `webServer` config starts `npm run dev` on `127.0.0.1:3000` and
  refuses to reuse one already running there — either stop the `npm run dev`
  from step 7 first, or export `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000` so
  Playwright reuses it instead of starting a second one.
- Every spec skips itself unless `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
  `E2E_TEST_EMAIL` are all set (`E2E_TEST_EMAIL` is any address ending in
  `.edu.qa`) — without them the run is green because it asserted nothing, not
  because anything passed.

```bash
npx playwright test
```
