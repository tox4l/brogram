# BroGram

A coding tutor by Velocity. Built by Velocity.

BroGram uses Next.js App Router, TypeScript, and Tailwind CSS. The browser will
run exercises, grade submissions, and render progress reports. The A0 scaffold
currently displays the BroGram placeholder and shared footer.

The planned backend uses Supabase for authentication and persistence, with
Next.js route handlers for DeepSeek agents and the Java judge. The design,
contracts, and task ownership are documented in `docs/`; curriculum is in `seed/`.

## Local development

Use Node.js 22 or later and npm. In Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Installation copies the sql.js WASM binary into `public/`. The scaffold page
needs no credentials. `.env.example` documents the variables for later tasks;
never commit secrets.

```powershell
npm.cmd run build
npm.cmd run lint
node seed/validate.mjs
```

`npm.cmd test` and `npm.cmd run test:e2e` run the suites added by the Claude
lane. `npm.cmd run seed:load` is wired for the seed loader delivered in A1.

## Build status

A0 completion requires a clean build and a local scaffold commit on `astra/A0`.
Dependency installation and verification results are recorded in
`docs/build-log.md`. GitHub publishing and Vercel deployment are manual follow-up
steps for Musa under the current A0 ruling.
