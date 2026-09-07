# BroGram v2 Build Plan — "the program with a b"

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` for every Claude task, `superpowers:requesting-code-review` before every merge point. Codex tasks go through `/codex:rescue --background --fresh` with a prompt file under `docs/prompts/astra-tasks/v2/`. Steps use checkbox (`- [ ]`) syntax; tick them in `openspec/changes/brogram-launch/tasks.md`, not here.

**Goal.** The v1 mechanism survives untouched; the experience is rebuilt on top of it. Ship the spec `docs/superpowers/specs/2026-09-06-brogram-v2-bro.md` in four waves, executed by parallel Claude subagents (and Codex when its sandbox recovers) working on **disjoint paths in one shared working tree on `main`**.

**Spec:** `docs/superpowers/specs/2026-09-06-brogram-v2-bro.md` (v2, authoritative)
**Superseded for anything it contradicts:** `docs/superpowers/specs/2026-09-05-brogram-design.md` (v1)
**Ledger:** `openspec/changes/brogram-launch/tasks.md` — this plan adds a `## v2` section with one row per task below
**Build log:** `docs/build-log.md` — every ruling in this plan gets a dated line as it is implemented
**Contracts:** `src/lib/contracts.ts`, byte-identical to `docs/contracts/brogram-contracts.ts`. Frozen except for the one PR in T0.1.

---

## 1. How this plan is executed

### 1.1 The parallel model

One working tree. One branch: `main`. No worktrees, no branch switching, no PRs against a fork of the tree.

- A **wave** is a set of tasks. Inside a wave, tasks run **in parallel** as separate subagents.
- Inside a wave, tasks are further split into **groups**. Group A starts immediately. Group B starts when every task it names under `Depends on:` has committed. Group C is the serialized tail (usually a sweep across files other tasks own).
- **Every task owns an exclusive set of paths for the whole wave.** Two tasks in the same wave never name the same file. The ownership map in §4 is the contract; if a task discovers it needs a file it does not own, it stops and reports rather than editing it.
- A wave closes only when its **gate** (§8) is green. Between commits inside a wave the tree may fail `tsc` (a Group B task can import a Group A module that has not landed yet); it must never fail at the gate.

### 1.2 Git discipline — non-negotiable

```bash
# the only commit shape allowed
git add <exact paths this task owns> && git commit -m "<type>(<scope>): <subject>"
```

- **Never** `git reset`, `git checkout --`, `git stash`, `git clean`, `git restore <path>` (without `--staged`), or `git rebase` in this tree. The 15:58 incident on 2026-09-06 wiped two lanes' uncommitted work; it does not happen twice.
- Unstage with `git restore --staged <path>` only.
- `git add -A` and `git add .` are **banned**: they sweep in another agent's in-flight edits.
- Never push until the wave gate is green. `git push origin main` is a controller action, once per wave.
- If a task finds a file it does not own already modified in the tree, that is another agent working. Leave it alone.

### 1.3 Models

| Work | Implement | Review |
|---|---|---|
| Contracts, SQL, pure math, learner-state logic, scoring, voice bank, workflows | **Sonnet** | **Opus** (+ Codex cross-review when up) |
| Screens, components, hooks, shell | **Sonnet** (or **Codex** when its sandbox is up — see §1.4) | **Opus** |
| Lesson authoring (23 lessons) | **Sonnet**, one agent per CLO | **Opus** critic phase, then one human read of the first lesson per course |
| Whole-branch review, wave gates, palette verification | — | **Opus** |

Every task lists its own `Model:` and `Review:` lines. **Every task gets an Opus review before the wave gate.** A review that finds a Critical sends a fix round to the same implementing agent; a review that finds nothing is recorded in the build log with the word "clean".

### 1.4 Codex, if its sandbox recovers

Codex ran one write-capable task at a time in this tree during v1 and its sandbox has been down since the v2 program opened. The plan does **not** depend on it. If it recovers:

- Give it, in this order, the tasks marked `Codex-preferred` below: **T0.2** (migrations), **T2.4** (wellness dock), **T2.9b** (the six Playground games), **T2.1** (layout + dashboard data layer).
- Codex is **serial**: one write-capable Codex task at a time in this tree. Everything else in that wave stays on Claude subagents in parallel.
- **Capacity valve (v1 §16, restated and made the default).** If Codex is the critical path at any wave checkpoint, the Claude lane builds the pure-presentation pieces with parallel subagents following `docs/prompts/astra-tasks/v2/OPERATING.md`, and Codex reviews before merge instead of writing. Do not wait on Codex. Ever.
- Codex cross-review is reached through Bash, not a tool call:
  `node "C:/Users/musal/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs" review --base main` with `run_in_background: true`.

---

## 2. Standing constraints (every task, every wave)

1. **840 existing tests stay green.** `npx vitest run` is part of every task's acceptance and every wave gate. A task may change **only** the existing test files listed in its own `Existing tests it may change` block; touching any other existing test is a review failure. The full licence table is §7.
2. **The seven agent triggers are frozen.** No eighth agent, no eighth trigger, no agent call on mount, keystroke, timer, lesson block, check, drill, celebration, theme change, dock move, or `/courses` render. `callAgent` / `streamAgent` in `src/lib/agents/client.ts` are the single choke point; T3.4 makes the guarantee a test.
3. **The browser runs and grades code.** Nothing moves to the server. `/api/judge` stays 503 (`JUDGE_PROVIDER=none`); Java runs through the CheerpJ browser adapter that landed at 23:13.
4. **Contracts are frozen after T0.1.** Any further change is a new PR both reviewers sign in the same hour.
5. **No client role reads `public.exercises`.** Clients read `exercises_public` or the static curriculum bundle. `referenceSolution` and lesson `expectedStdout` never reach the browser (T0.3 makes this a test).
6. **English only. No emoji in UI copy. No institution names anywhere.** Sound and motion carry the celebratory register.
7. **Geist, never Inter.**
8. **Next.js 16 App Router on Vercel, Supabase, DeepSeek only (`deepseek-v4-flash` behind `src/app/api/agent/route.ts`), npm, Tailwind 4 + shadcn primitives.** Before writing any Next.js code, read the relevant guide under `node_modules/next/dist/docs/` — this Next is not the one in training data.
9. **MIT, open source, no Vercel-only learner-facing path.** `@vercel/speed-insights` mounts only when `NEXT_PUBLIC_VERCEL_ENV` is set. There is no telemetry route handler.
10. **Juice fires at transitions, never during composition.** Nothing animates or sounds while the learner is typing or reading.
11. **Enforcement surfaces get no personality and no juice.** Flat register, no "bro", no sound, no animation on any lockdown, integrity or account-status surface.
12. **Reduced motion is a resolved boolean, not a media query.** Every animating component reads `useReducedMotion()` (T0.5). A component that animates without reading it fails review (R7.9).
13. **Every reward has a visible channel.** Nothing is sound-only or haptics-only.
14. `.env.example` is the only committed env file and never holds a value.

---

## 3. Corrections this plan carries against the spec

The spec was written before two things landed and against two facts that are not true in the tree. These are rulings for the implementers; each gets a `docs/build-log.md` line when its task lands.

**C1 — Java is live, not `coming-soon`.** The build log at 23:13 records the CheerpJ browser adapter shipped (`d8b494c`, `f832d3f`, `78cb488`), 17 of 17 Java exercises certified, INFS3102 flipped back to `live`, 111 exercises loaded, `NEXT_PUBLIC_JUDGE_PROVIDER=browser`. Spec §1.13, §5.5 and §5.6 assume Java is parked. Consequences:
- **Lesson Java snippets still ship `runnable: false` at launch** (spec R3.4 as written), because the Java adapter's fix round 1 was still open when the spec was frozen. T1.1's verifier reports `unverified` for Java and the validator rejects `runnable: true` on a Java snippet. Re-decide in the pilot week, not here.
- **The `public/` budget is re-stated.** Only 6 files under `public/` are tracked (`git ls-files public` — two Java notices, two tree-sitter wasm, one spike html, `sql-wasm.wasm`); `tools.jar` is gitignored and fetched at build by `npm run prepare:java`. So the gate is **tracked `public/` ≤ 3 MB** (T3.1 asserts this), and the **deployed** `public/` carries `tools.jar` under its own named ledger row, exactly as spec R5.7(b) requires. `public/spikes/cheerpj/index.html` is deleted (T0.0); its e2e spec is already env-gated.

**C2 — the test the spec says exists, does not.** §11.2 R11.2 says "the existing test asserting `INTEGRITY_WEIGHTS` equals the SQL weights now compares against a table". No such test exists (`INTEGRITY_WEIGHTS` appears only in `contracts.ts`, `docs/contracts/brogram-contracts.ts`, `src/lib/learner/integrity.ts`, `src/app/api/admin/users/route.ts`). T0.2 **creates** it (`src/lib/learner/integrity.sql.test.ts`) rather than editing one.

**C3 — `/account` is not behind the proxy.** `src/proxy.ts`'s matcher lists dashboard, onboarding, courses, exercise, derot, reports, admin, login, auth — **not** `/account`, and not the two new routes. Session refresh and the ban/restrict gate therefore never run on `/account`. T1.6 fixes the matcher and adds `/course/:path*`, `/lesson/:path*`, `/account/:path*`.

**C4 — `WellnessPrefs`' new keys are required, not optional.** Every consumer in the tree passes `DEFAULT_WELLNESS` or a merged value (`Rail.tsx:22 mergePrefs`); no test constructs a bare `WellnessPrefs` literal. Required keys therefore break nothing and remove `?? DEFAULT` noise from every read site. The **runtime** fallback for stored rows that predate the keys is `resolveWellnessPrefs()` (T0.1), a deep merge — a shallow spread would hand back a half-built `dock` object.

**C5 — the sound source set is BroGram's own.** Rather than fetch Kenney packs and Freesound ids over a network the build machine may not have, `scripts/synth-sounds.mjs` generates every source clip procedurally (pure Node, 16-bit PCM WAV, additive synthesis with exponential envelopes) and `scripts/build-sound-sprite.mjs` encodes the sprite with `audiosprite` (ffmpeg 8.1.1 is installed and verified on this machine). Every clip is then BroGram-authored and **CC0**, which satisfies §1.12's openness rule with no third-party licence risk, no pinned id list, and no network step. The spec's Kenney/Freesound path stays documented in `public/sounds/CREDITS.md` as the optional upgrade. Howler still owns playback and unlock (R7.7 stands — no hand-rolled `AudioContext` unlocking).

---

## 4. File ownership map

One row per task. **Inside a wave, no path appears twice.** `→` means "created by".

### Wave 0

| Task | Owns |
|---|---|
| T0.0 | `package.json`, `package-lock.json`, `.gitignore`, `public/spikes/**` (delete) |
| T0.1 | `src/lib/contracts.ts`, `docs/contracts/brogram-contracts.ts`, `src/lib/contracts.v2.test.ts`→, `src/lib/wellness/prefs.ts`→, `src/lib/wellness/prefs.test.ts`→, `src/app/(app)/derot/lib.ts`, `src/components/report/derive.ts` |
| T0.2 | `supabase/migrations/0006_lessons.sql`→ `0007_achievements.sql`→ `0008_integrity_breakdown.sql`→ `0009_drill_lanes.sql`→, `scripts/seed-load.mjs`, `scripts/db-apply.mjs`→, `seed/validate.mjs`, `seed/lessons/lesson.schema.json`→, `seed/lessons/INFS1101.json`→, `src/lib/learner/integrity.sql.test.ts`→ |
| T0.3 | `scripts/build-static-curriculum.mjs`→, `src/lib/curriculum/**`→, `next.config.ts`, `public/curriculum/**`→ |
| T0.4 | `src/lib/query/**`→, `src/components/shell/QueryProvider.tsx`→, `src/components/shell/QuerySeed.tsx`→, `src/app/(app)/layout.tsx` |
| T0.5 | `src/lib/sound/**`→, `src/lib/motion/**`→, `src/components/shell/SoundToggle.tsx`→, `scripts/synth-sounds.mjs`→, `scripts/build-sound-sprite.mjs`→, `public/sounds/**`→, `assets/sounds-src/**`→ |
| T0.6 | `src/app/globals.css`, `src/app/layout.tsx`, `src/app/providers.tsx`→, `src/lib/theme/**`→, `src/components/shell/ThemeQuickSwitch.tsx`→, `src/components/ui/sonner.tsx` |
| T0.7 | `src/components/shell/AppShell.tsx`, `src/components/shell/ShellLayout.tsx`→, `src/components/shell/ShellHeaderControls.tsx`→, `src/components/shell/DockControl.tsx`→, `src/components/shell/useSecondTick.ts`→, `src/components/shell/WellnessSlot.tsx` |

### Wave 1

| Task | Owns |
|---|---|
| T1.1 | `docs/prompts/agents/08-lesson-author.md`→, `docs/workflows/lesson-generation.js`→, `scripts/verify-lesson.mjs`→, `seed/lessons/**` (except `lesson.schema.json`) |
| T1.2 | `src/lib/lesson/**`→, `src/lib/exercise/grading.ts`, `src/lib/exercise/grading.test.ts` |
| T1.3 | `src/app/(app)/lesson/**`→, `src/components/lesson/**`→ |
| T1.4 | `src/app/(app)/course/**`→, `src/components/course/PathMap.tsx`→ `NodeItem.tsx`→ `NextUpStack.tsx`→ `CourseFlatList.tsx`→, `src/lib/course/**`→ |
| T1.5 | `src/app/(app)/onboarding/**`, `src/lib/onboarding/**`→ |
| T1.6 | `src/app/(app)/courses/**`→, `src/components/course/CourseCard.tsx`→, `src/lib/learner/provisional.ts`→ `provisional.test.ts`→, `src/proxy.ts`, `src/lib/supabase/middleware.ts`, `src/app/(app)/dashboard/page.tsx` (link targets only) |

### Wave 2

| Task | Owns |
|---|---|
| T2.1 | `src/app/(app)/layout.tsx`, `src/app/(app)/layout.test.tsx`, `src/app/(app)/dashboard/**` |
| T2.2 | `src/hooks/useExerciseLoop.ts`, `src/hooks/useExerciseLoop.test.tsx`, `src/app/(app)/exercise/**` |
| T2.3 | `src/app/(app)/reports/**`, `src/app/(app)/account/**` |
| T2.4 | `src/components/wellness/**`, `src/components/shell/ShellLayout.tsx`, `src/components/shell/WellnessSlot.tsx`, `src/components/shell/DockControl.tsx`, `src/lib/wellness/prayer.ts`, `src/lib/wellness/dock.ts`→ |
| T2.5 | `src/lib/rewards/**`→ |
| T2.6 | `src/components/rewards/**`→ |
| T2.7a | `src/lib/voice/**`→ |
| T2.7b | *(Group C sweep — call sites across every W2 owner's files, run after they commit)* |
| T2.8 | `src/hooks/useLockdown.ts`, `src/hooks/useLockdown.test.tsx`, `src/components/exercise/LockdownOverlay.tsx`, `src/components/account/IntegrityPanel.tsx`→, `src/lib/integrity/**`→ |
| T2.9a | `src/app/(app)/derot/page.tsx`, `src/app/(app)/derot/lib.ts`, `src/app/(app)/derot/arcade/**`→, `src/components/derot/scoring.ts`, `src/components/derot/DrillRunner.tsx`, `src/components/derot/RunSummary.tsx`→, `src/components/derot/ComboMeter.tsx`→, `src/components/derot/CountdownRing.tsx`→ |
| T2.9b | `src/app/(app)/derot/play/**`→, `src/components/derot/play/**`→ |
| T2.10 | `src/lib/agents/{profiler,planner,author,diagnoser,coach,reviewer,buddy}.ts`, `src/lib/agents/prompts.test.ts` |
| T2.11 | `src/components/buddy/**` |

### Wave 3

| Task | Owns |
|---|---|
| T3.1 | `scripts/check-bundle-budget.mjs`→, `perf-budget.json`→ |
| T3.2 | `e2e/perf.spec.ts`→, `src/lib/perf/**`→ |
| T3.3 | `e2e/**` (except `perf.spec.ts`), `playwright.config.ts` |
| T3.4 | `src/lib/agents/no-agent-surfaces.test.tsx`→ |
| T3.5 | `docs/CONTENT.md`→, `SETUP.md`→, `README.md`, `public/sounds/CREDITS.md` |
| T3.6 | *(review only — no writes; fixes are dispatched back to the owning task's agent)* |
| T3.7 | `.github/workflows/ci.yml`→, `docs/build-log.md`, `openspec/changes/brogram-launch/tasks.md` |

---

## Wave 0 — Foundations

Nothing in W1–W3 starts until the W0 gate is green. Every later wave consumes what W0 produces.

**Groups.** A: T0.0 alone, first, serial. B (parallel, after T0.0): T0.1, T0.2, T0.3, T0.4, T0.5, T0.6. C (after T0.5 and T0.6 commit): T0.7.

---

### T0.0 — Dependency and script bootstrap (serial, first, alone)

**Model:** Sonnet. **Review:** Opus (10 minutes, diff-only).
**Depends on:** —
**Why it is alone:** `package.json`, `package-lock.json` and `.gitignore` are the three highest-contention files in the repo. One task installs every dependency and adds every script that any of W0–W3 will need, so no other task ever edits them.

**Files**
- Edit: `package.json`, `package-lock.json`, `.gitignore`
- Delete: `public/spikes/cheerpj/index.html` (and the now-empty directory)

**Interfaces produced:** the npm scripts every later task's acceptance block calls.
**Interfaces consumed:** —

- [ ] **Step 1: install runtime dependencies**

```bash
npm i @tanstack/react-query@^5.102.8 howler@2.2.4 canvas-confetti@^1.9.3
npm i -D @types/howler @types/canvas-confetti audiosprite web-vitals
```

`gsap`, `@gsap/react`, `motion`, `next-themes` are already installed and currently imported nowhere; they are the animation and theming stack and no third library is added.

- [ ] **Step 2: scripts**

Add to `package.json` `"scripts"`, keeping the existing five:

```json
"prebuild": "node scripts/build-static-curriculum.mjs",
"curriculum:build": "node scripts/build-static-curriculum.mjs",
"curriculum:check": "node scripts/build-static-curriculum.mjs --check",
"sounds:synth": "node scripts/synth-sounds.mjs",
"sounds:sprite": "node scripts/build-sound-sprite.mjs",
"lesson:verify": "node scripts/verify-lesson.mjs",
"db:apply": "node scripts/db-apply.mjs",
"perf:bundle": "node scripts/check-bundle-budget.mjs",
"perf:timings": "playwright test e2e/perf.spec.ts --project=chromium",
"typecheck": "tsc --noEmit"
```

- [ ] **Step 3: gitignore and the spike**

Append to `.gitignore`:
```
# Spike leftovers and build-fetched Java runtime. tools.jar is fetched by
# scripts/fetch-java-tools.mjs at prebuild; the notice that travels with it is
# public/java/TOOLS-JAR-LICENSE.md and stays tracked.
public/spikes/
# Generated by prebuild from seed/. Never hand-edited, never a source of truth.
public/curriculum/
# Local source clips for the sound sprite; the sprite itself is committed.
assets/sounds-src/
```
Delete `public/spikes/cheerpj/index.html` with `git rm`. `e2e/spikes/cheerpj.spec.ts` is already excluded from the default Playwright run by `testIgnore`; leave it and add a one-line comment pointing at `docs/build-log.md` 22:33.

- [ ] **Step 4: pin**

Every new specifier is pinned to the installed version (v1's final fix wave rule). `npm ls @tanstack/react-query howler canvas-confetti` resolves cleanly.

**Acceptance**
```bash
npx vitest run            # 840 green, unchanged
npx tsc --noEmit          # exit 0
npm run build             # exit 0  (prebuild will fail until T0.3 lands — see note)
git ls-files public | wc -l   # 5, down from 6
```
*Note:* `prebuild` names a script T0.3 has not written yet, so `npm run build` fails between this commit and T0.3's. That is the one accepted mid-wave red; the W0 gate re-runs it.

**Existing tests it may change:** none.
**Review:** no dependency added beyond the five named; no version specifier left as `^latest`; `.gitignore` does not shadow anything currently tracked (`git status --porcelain` shows no deletions beyond the spike html).
**Commit:** `git add package.json package-lock.json .gitignore public/spikes && git commit -m "chore(v2): dependency and script bootstrap"`

---

### T0.1 — The contracts PR

**Model:** Sonnet. **Review:** Opus, then a second adversarial Opus pass (frozen surface). **Codex cross-review** if up.
**Depends on:** T0.0
**Codex-preferred:** no — this is the Claude lane's file by v1 §16.

**Files**
- Edit: `src/lib/contracts.ts` and `docs/contracts/brogram-contracts.ts` (**byte-identical**; `src/lib/contracts.test.ts` compares them and must stay green without being edited)
- Edit: `src/app/(app)/derot/lib.ts` (`DRILL_KINDS`, `DRILL_META` — exhaustive over `DrillKind`, will not compile otherwise)
- Edit: `src/components/report/derive.ts` (`DRILL_KIND_ORDER` — same)
- Create: `src/lib/contracts.v2.test.ts`, `src/lib/wellness/prefs.ts`, `src/lib/wellness/prefs.test.ts`

**Interfaces produced:** every type and constant below, plus `resolveWellnessPrefs`.
**Interfaces consumed:** —

- [ ] **Step 1: append the v2 block to both contract copies**

Append **below** everything existing. Nothing above is renamed, removed or re-typed, with the two named exceptions in Step 2.

```ts
// ---------------------------------------------------------------------------
// v2 additions (2026-09-06). Additive only. See
// docs/superpowers/specs/2026-09-06-brogram-v2-bro.md section 11.4.
// ---------------------------------------------------------------------------

// --- Look, sound, motion, dock ---------------------------------------------

export type ThemeName = 'midnight' | 'amber' | 'paper' | 'arcade'
export type DockPlacement = 'left' | 'right' | 'top' | 'float' | 'hidden'
export type DockCorner = 'tl' | 'tr' | 'bl' | 'br'
export type MotionPreference = 'system' | 'full' | 'reduced'

export interface WellnessDockPrefs {
  placement: DockPlacement
  collapsed: boolean
  /** Collapse automatically on the exercise and walkthrough screens. */
  compactOnExercise: boolean
  /** Only meaningful for placement 'float'. */
  corner: DockCorner
}

// --- Levels -----------------------------------------------------------------

export const MAX_LEVEL = 30

/** Cumulative XP needed to BE at a level. Level 1 = 0. Rounded to 50. */
export function xpToReach(level: number): number {
  if (level <= 1) return 0
  const capped = Math.min(level, MAX_LEVEL)
  return Math.round((500 * Math.pow(capped - 1, 1.5)) / 50) * 50
}

/** Largest n with xpToReach(n) <= xp, capped at MAX_LEVEL. Never below 1. */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1
  let level = 1
  while (level < MAX_LEVEL && xpToReach(level + 1) <= xp) level += 1
  return level
}

// --- Achievements -----------------------------------------------------------

export type AchievementTier = 'bronze' | 'silver' | 'gold'

export interface Achievement {
  id: string
  /** In voice, at most 3 words. */
  name: string
  /** Shown on unlock, at most 12 words. */
  line: string
  tier: AchievementTier
  /** Human-readable rule, shown on the locked card. Nothing is a mystery box. */
  how: string
  visibleWhenLocked: boolean
  /** Display order. A product decision, not an array index. */
  ordinal: number
}

export interface UserAchievement {
  userId: string
  achievementId: string
  unlockedAt: string
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-blood', name: 'First Blood', line: 'First one down. That feeling is the whole product.', tier: 'bronze', how: 'Pass your first rep.', visibleWhenLocked: true, ordinal: 1 },
  { id: 'no-wheels', name: 'No Training Wheels', line: 'Medium or harder, zero hints.', tier: 'bronze', how: 'Pass a medium or harder rep with zero hints.', visibleWhenLocked: true, ordinal: 2 },
  { id: 'three-angles', name: 'Three Angles', line: 'Three passes, three angles, one skill locked.', tier: 'silver', how: 'Lock your first skill: three passes, three different angles.', visibleWhenLocked: true, ordinal: 3 },
  { id: 'five-locked', name: 'Five Locked', line: 'Five skills, locked.', tier: 'silver', how: 'Lock five skills.', visibleWhenLocked: true, ordinal: 4 },
  { id: 'course-clear', name: 'Cleared It', line: 'Whole course. Go look at where you started.', tier: 'gold', how: 'Lock every skill in a course.', visibleWhenLocked: true, ordinal: 5 },
  { id: 'read-the-manual', name: 'Reads the Manual', line: 'Five walkthroughs, read properly.', tier: 'bronze', how: 'Finish five walkthroughs.', visibleWhenLocked: true, ordinal: 6 },
  { id: 'full-read', name: 'Full Read', line: 'Every walkthrough in a course.', tier: 'silver', how: 'Finish every walkthrough in a course.', visibleWhenLocked: true, ordinal: 7 },
  { id: 'comeback', name: 'Comeback', line: 'Failed it three times, then took it.', tier: 'bronze', how: 'Pass a rep you failed three times or more, in your recent history.', visibleWhenLocked: true, ordinal: 8 },
  { id: 'under-a-minute', name: 'Under a Minute', line: 'Sixty seconds, no hints.', tier: 'silver', how: 'Pass a rep in under 60 seconds with no hints.', visibleWhenLocked: true, ordinal: 9 },
  { id: 'two-tongues', name: 'Two Tongues', line: 'Two languages, same head.', tier: 'bronze', how: 'Pass reps in two different languages.', visibleWhenLocked: true, ordinal: 10 },
  { id: 'pattern-hunter', name: 'Pattern Hunter', line: 'Ten angles. Nothing catches you sideways.', tier: 'silver', how: 'Pass ten different angles across any skills.', visibleWhenLocked: true, ordinal: 11 },
  { id: 'day-three', name: 'Three Deep', line: 'Three days straight.', tier: 'bronze', how: 'Three-day streak.', visibleWhenLocked: true, ordinal: 12 },
  { id: 'week-strong', name: 'Week Strong', line: 'Seven days. That is a habit now.', tier: 'silver', how: 'Seven-day streak.', visibleWhenLocked: true, ordinal: 13 },
  { id: 'thirty', name: 'Thirty', line: 'Thirty days straight. That is not luck.', tier: 'gold', how: 'Thirty-day streak.', visibleWhenLocked: true, ordinal: 14 },
  { id: 'kept-the-promise', name: 'Kept the Promise', line: 'Seven days, goal met.', tier: 'silver', how: 'Hit your daily goal seven times.', visibleWhenLocked: true, ordinal: 15 },
  { id: 'sharp', name: 'Sharp', line: 'Ten Arcade runs.', tier: 'bronze', how: 'Finish ten Arcade runs.', visibleWhenLocked: true, ordinal: 16 },
  { id: 'touch-grass', name: 'Touch Grass', line: 'Ten Playground runs.', tier: 'bronze', how: 'Finish ten Playground runs.', visibleWhenLocked: true, ordinal: 17 },
  { id: 'beat-yourself', name: 'Beat Yourself', line: 'Five personal bests. Only yours.', tier: 'silver', how: 'Set five personal bests.', visibleWhenLocked: true, ordinal: 18 },
  { id: 'level-five', name: 'Level Five', line: 'Level 5. Wired in.', tier: 'silver', how: 'Reach level 5.', visibleWhenLocked: true, ordinal: 19 },
  { id: 'machine', name: 'Machine', line: 'Level 25. Machine.', tier: 'gold', how: 'Reach level 25.', visibleWhenLocked: true, ordinal: 20 },
] as const

// --- Walkthroughs (lessons) -------------------------------------------------

export interface LessonConcept {
  type: 'concept'
  id: string
  /** <= 60 chars. */
  heading: string
  /** Markdown, <= 120 words, plain language, second person. */
  body: string
  /** Optional inline SVG. No external assets, no <script>, no <foreignObject>. */
  figure?: string
}

export interface LessonSnippet {
  type: 'snippet'
  id: string
  language: Language
  code: string
  /** true = a Run button appears; the learner may edit and re-run. Nothing is graded. */
  runnable: boolean
  /** Certified by the verifier, never shown to the learner, stripped from LessonPublic. */
  expectedStdout: string
  caption?: string
  /** 1-indexed inclusive line ranges to highlight when the block enters view. */
  highlight?: [number, number][]
  /** Pyodide packages, mirrors RunRequest.packages. Usually omitted. */
  packages?: string[]
}

export interface LessonWorked {
  type: 'worked'
  id: string
  language: Language
  code: string
  /** Revealed one at a time. 2-6 steps. `say` <= 22 words. */
  steps: { line: number | [number, number]; say: string }[]
  caption?: string
}

export type LessonCheck =
  | { type: 'check'; id: string; kind: 'predict-output'; prompt: string; language: Language; code: string
      expected: string; normalize: 'lines' | 'exact'; hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'choose'; prompt: string
      options: string[]; correctIndex: number
      /** One line per option, shown the instant that option is chosen. */
      why: string[]; hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'spot-the-bug'; prompt: string; language: Language; code: string
      bugLines: number[]; hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'fill-blank'; prompt: string; language: Language
      /** Template with __1__, __2__ markers. */
      template: string
      /** `accept` is compared trimmed and case-insensitively. */
      blanks: { id: string; accept: string[] }[]
      hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'micro-code'; prompt: string; language: Language
      starterCode: string
      /** 2-3 tests, ALL visible. A check is never a hidden-test wall. */
      tests: TestCase[]
      /** Stripped from LessonPublic at build. */
      referenceSolution: string
      hint: string; explain: string }

export interface LessonRecap {
  type: 'recap'
  id: string
  /** Exactly 2 or 3, <= 14 words each. */
  bullets: string[]
  /** One line the learner should still have in a week. */
  remember: string
}

export interface LessonBridge {
  type: 'bridge'
  id: string
  /** The handoff, in voice, <= 20 words. */
  say: string
}

export type LessonBlock =
  | LessonConcept | LessonSnippet | LessonWorked | LessonCheck | LessonRecap | LessonBridge

export interface Lesson {
  /** EXACTLY the cloId. One walkthrough per skill; `version` alone carries staleness. */
  id: CloId
  cloId: CloId
  course: CourseCode
  language: Language
  version: number
  title: string
  hook: string
  /** 4-8. The workflow rejects anything over 8. */
  estimatedMinutes: number
  draft: boolean
  tags: string[]
  blocks: LessonBlock[]
  exitLine: string
}

/** The shipped shape. Every micro-code referenceSolution and every snippet
 *  expectedStdout is removed by scripts/build-static-curriculum.mjs. Written
 *  out explicitly, the same way ExercisePublic is. */
export type LessonPublicBlock =
  | LessonConcept
  | Omit<LessonSnippet, 'expectedStdout'>
  | LessonWorked
  | Exclude<LessonCheck, { kind: 'micro-code' }>
  | (Omit<Extract<LessonCheck, { kind: 'micro-code' }>, 'referenceSolution'>)
  | LessonRecap
  | LessonBridge

export type LessonPublic = Omit<Lesson, 'blocks'> & { blocks: LessonPublicBlock[] }

export interface LessonProgress {
  userId: string
  lessonId: CloId
  cloId: CloId
  status: 'started' | 'completed' | 'skipped'
  blockIndex: number
  checksPassed: number
  checksFailed: number
  lessonVersion: number
  startedAt: string
  completedAt: string | null
  updatedAt: string
}

// --- De-rot lanes -----------------------------------------------------------

export type DrillLane = 'arcade' | 'play'
```

- [ ] **Step 2: the two in-place edits**

Both are additive-in-effect and named here so the reviewer looks for exactly two.

```ts
// (a) Clo gains one optional field. The column already exists in seed/clos.json
//     and public.clos; the interface never carried it. Optional means every
//     existing fixture and every one of the 840 tests stays valid.
export interface Clo {
  // ...unchanged...
  assessableInCode: boolean
  draft?: boolean          // ADDED
}

// (b) DrillKind gains the six Playground ids.
export type DrillKind =
  | 'predict-output' | 'spot-the-bug' | 'trace' | 'hold-focus' | 'n-back' | 'speed-type'
  | 'follow-the-dot' | 'color-nback' | 'reaction' | 'rhythm' | 'breathe' | 'memory-grid'
```

`DrillItem` gains `lane: DrillLane`; `DrillResult` gains `lane: DrillLane`. `WellnessPrefs` gains, as **required** keys (see §3 C4):

```ts
export interface WellnessPrefs {
  // ...unchanged seven keys...
  dock: WellnessDockPrefs
  theme: ThemeName
  sound: { enabled: boolean; volume: number; interface: boolean }
  motion: MotionPreference
  /** 1-10. */
  dailyGoal: number
  /** UTC date keys, most recent 120. Durable source for `kept-the-promise`. */
  goalDays: string[]
}

export const DEFAULT_WELLNESS: WellnessPrefs = {
  // ...unchanged seven values...
  dock: { placement: 'right', collapsed: false, compactOnExercise: true, corner: 'br' },
  theme: 'midnight',
  sound: { enabled: true, volume: 0.6, interface: false },
  motion: 'system',
  dailyGoal: 3,
  goalDays: [],
}
```

`sound.interface` is R7.8's second toggle (interface tier default off); the spec listed the tier but not the key.

- [ ] **Step 3: unblock the three exhaustive records**

`src/app/(app)/derot/lib.ts`: `DRILL_KINDS` keeps the six Arcade ids **in order** and gains a sibling `PLAY_KINDS`; `DRILL_META` gains the six Playground entries with the voice titles from spec §7.9 (Call It, Find the Break, Run It in Your Head, Don't Blink, Two Back, Hands for Arcade; Follow the Dot, Colour Back, Twitch, Keep Time, Breathe, Grid for Playground) plus a `lane` field. `src/components/report/derive.ts`: `DRILL_KIND_ORDER` gains the six ids after the existing six. Both files compile or the type is wrong.

- [ ] **Step 4: `src/lib/wellness/prefs.ts`**

```ts
import { DEFAULT_WELLNESS, type WellnessPrefs } from '@/lib/contracts'

/** Deep merge over DEFAULT_WELLNESS. A shallow spread hands back a half-built
 *  `dock` for every row stored before v2, which is a runtime crash, not a
 *  fallback. Unknown keys are dropped; out-of-range values are clamped. */
export function resolveWellnessPrefs(raw: unknown): WellnessPrefs
/** The inverse: only the keys that differ from DEFAULT_WELLNESS, for the write. */
export function prefsPatch(next: WellnessPrefs): Partial<WellnessPrefs>
/** Append today's UTC date key, dedupe, keep the most recent 120. */
export function recordGoalDay(days: string[], dateKey: string): string[]
```

- [ ] **Step 5: `src/lib/contracts.v2.test.ts`** — pin every number the way `pointsForPass` is pinned:
  - `xpToReach(1) === 0`, `xpToReach(2) === 500`, `xpToReach(3) === 1400`, `xpToReach(5) === 4000`, `xpToReach(10) === 13500`, `xpToReach(30) === 78100`, `xpToReach(31) === xpToReach(30)`.
  - `levelForXp(0) === 1`, `levelForXp(499) === 1`, `levelForXp(500) === 2`, `levelForXp(1339) === 2` (four medium passes do **not** reach level 3 — the spec's own corrected arithmetic), `levelForXp(1400) === 3`, `levelForXp(10_000_000) === 30`, `levelForXp(-5) === 1`, `levelForXp(NaN) === 1`.
  - `xpToReach` is monotonic over 1..31.
  - `ACHIEVEMENTS` has 20 entries, unique ids, unique ordinals 1..20, every `name` <= 3 words, every `line` <= 12 words, every entry `visibleWhenLocked === true`, no entry's text starts with `"Your "`, no emoji (`/\p{Extended_Pictographic}/u`).
  - `DEFAULT_WELLNESS` round-trips through `resolveWellnessPrefs(JSON.parse(JSON.stringify(DEFAULT_WELLNESS)))`.
  - `resolveWellnessPrefs({ waterIntervalMin: 30 })` returns the full shape with `dock.placement === 'right'`.
  - `resolveWellnessPrefs({ dock: { placement: 'left' } }).dock.collapsed === false` — the deep-merge case that a shallow spread fails.
  - `resolveWellnessPrefs({ dailyGoal: 99 }).dailyGoal === 10`, `({ dailyGoal: 0 }).dailyGoal === 1`, `({ sound: { volume: 5 } }).sound.volume === 1`.
  - `recordGoalDay` dedupes and caps at 120, newest last.

**Acceptance**
```bash
npx vitest run src/lib/contracts.test.ts src/lib/contracts.v2.test.ts src/lib/wellness/prefs.test.ts
npx vitest run                 # 840 + new, all green
npx tsc --noEmit               # exit 0 — proves the three exhaustive records were extended
node seed/validate.mjs         # unchanged, exit 0
```
`src/lib/contracts.test.ts` (the byte-for-byte guard) must pass **without being edited** — if it fails, the two copies diverged.

**Existing tests it may change:** none. (`src/app/(app)/derot/lib.test.ts` and `src/components/report/derive.test.ts` may need *additions* if they assert array lengths; if so, additions only, and list them in the commit body.)
**Review (Opus):** every addition is additive; `AgentTrigger`, `AgentName`, `AGENT_TOKEN_BUDGETS`, `INTEGRITY_WEIGHTS`, `INTEGRITY_THRESHOLDS`, `LOCKDOWN`, `pointsForPass`, `nextMasteryScore`, `LearnerState`, `LearnerProfile`, `Exercise`, `ExercisePublic`, `Course`, `TestCase`, `RunRequest`, `RunResult`, `RuntimeAdapter`, `Attempt`, `Mastery` and every agent request/reply are byte-identical to the previous commit (`git diff HEAD~1 -- src/lib/contracts.ts` shows additions and the two named edits only). `LessonPublic` genuinely cannot carry a `referenceSolution` (try to assign one in a scratch file; it must not compile). The two files are byte-identical.
**Commit:** `git add src/lib/contracts.ts docs/contracts/brogram-contracts.ts src/lib/contracts.v2.test.ts src/lib/wellness/prefs.ts src/lib/wellness/prefs.test.ts "src/app/(app)/derot/lib.ts" src/components/report/derive.ts && git commit -m "feat(contracts): v2 additions - lessons, achievements, levels, dock, themes, drill lanes"`

---

### T0.2 — Migrations, seed loader, validator, golden lesson

**Model:** Sonnet (**Codex-preferred** if the sandbox is up). **Review:** Opus.
**Depends on:** T0.1 (imports `ACHIEVEMENTS`, `DrillLane`)

**Files**
- Create: `supabase/migrations/0006_lessons.sql`, `0007_achievements.sql`, `0008_integrity_breakdown.sql`, `0009_drill_lanes.sql`
- Create: `scripts/db-apply.mjs`, `seed/lessons/lesson.schema.json`, `seed/lessons/INFS1101.json`, `src/lib/learner/integrity.sql.test.ts`
- Edit: `scripts/seed-load.mjs`, `seed/validate.mjs`

**Interfaces produced:** tables `lessons`, `lesson_progress`, `achievements`, `user_achievements`, `integrity_weights`; functions `my_integrity_breakdown()`, `my_activity_days(int)`, `append_drill_result(jsonb)`; redefined `integrity_score(uuid)`; `drills.lane`. Seed loader reports lesson, achievement and play-drill counts. `seed/lessons/lesson.schema.json` is the shape T1.1 authors against and T1.3 renders.
**Interfaces consumed:** `ACHIEVEMENTS`, `INTEGRITY_WEIGHTS`, `DrillLane` (T0.1).

- [ ] **Step 1: `0006_lessons.sql`** — exactly as spec §11.2. `lessons.id` is the `clo_id` (one walkthrough per skill; `version` alone carries staleness — the two-versioning-mechanisms bug the spec's critic caught). `lessons` gets **no** grant to `anon` or `authenticated`: it holds `micro-code` reference solutions and the browser reads the static bundle. `lesson_progress` gets select/insert/update own, all gated on `public.is_not_banned()`.

- [ ] **Step 2: `0007_achievements.sql`** — exactly as spec §11.2, including `ordinal int not null` (T0.1 gave `Achievement` the matching field). `user_achievements` is **insert-only**: no update policy, no delete policy, PK `(user_id, achievement_id)` so a duplicate unlock is impossible.

- [ ] **Step 3: `0008_integrity_breakdown.sql`** — the corrected version. It **creates and seeds `integrity_weights` first**, then redefines `integrity_score()` to read it, then adds the two read paths. The printed spec SQL joins a table that does not exist; this is the fixed order:

```sql
create table public.integrity_weights (
  type   text primary key,
  weight int  not null
);
insert into public.integrity_weights (type, weight) values
  ('paste-blocked', 2), ('copy-blocked', 2), ('printscreen', 3),
  ('blur', 1), ('contextmenu-blocked', 0), ('idle', 0);
alter table public.integrity_weights enable row level security;
-- The policy IS the honesty of section 9: a learner can read the weights.
create policy integrity_weights_read on public.integrity_weights
  for select to authenticated using (true);

-- Same numbers, one source. apply_integrity_escalation() is untouched: it
-- calls integrity_score(), which keeps its signature and its results.
create or replace function public.integrity_score(uid uuid) returns int
language sql stable as $$
  select coalesce(sum(coalesce(w.weight, 0)), 0)::int
  from public.integrity_events e
  left join public.integrity_weights w on w.type = e.type::text
  where e.user_id = uid and e.created_at > now() - interval '7 days'
$$;

-- Aggregate counts only, for the calling user only, over the same 7-day
-- window. No raw rows, no timestamps, no other users. integrity_events keeps
-- zero SELECT grants for non-admins.
create or replace function public.my_integrity_breakdown()
returns table (event_type text, events int, weight int, points int)
language sql security definer set search_path = public, pg_temp stable as $$
  select e.type::text, count(*)::int, coalesce(w.weight, 0)::int,
         (count(*) * coalesce(w.weight, 0))::int
  from public.integrity_events e
  left join public.integrity_weights w on w.type = e.type::text
  where e.user_id = (select auth.uid())
    and e.created_at >= now() - interval '7 days'
  group by e.type, w.weight
  order by 4 desc, 1 asc;
$$;
revoke all on function public.my_integrity_breakdown() from public, anon;
grant execute on function public.my_integrity_breakdown() to authenticated;

-- Distinct UTC activity dates for the calling user only. Bounded, aggregate,
-- and the only thing streak math needs. Replaces the layout's unbounded pager.
create or replace function public.my_activity_days(window_days int default 120)
returns table (kind text, day date)
language sql security definer set search_path = public, pg_temp stable as $$
  select 'exercise', (created_at at time zone 'utc')::date
  from public.attempts
  where user_id = (select auth.uid()) and passed
    and created_at >= now() - make_interval(days => window_days)
  group by 2
  union all
  select 'derot', (r->>'at')::timestamptz::date
  from public.wellness w, jsonb_array_elements(w.drill_results) r
  where w.user_id = (select auth.uid())
    and (r->>'at')::timestamptz >= now() - make_interval(days => window_days)
  group by 2;
$$;
revoke all on function public.my_activity_days(int) from public, anon;
grant execute on function public.my_activity_days(int) to authenticated;
```

- [ ] **Step 4: `0009_drill_lanes.sql`** — the column plus the capped append (R7.6b: the array is unbounded and written read-modify-write today, so two tabs race a run away).

```sql
alter table public.drills add column lane text not null default 'arcade'
  check (lane in ('arcade','play'));
create index drills_lane_idx on public.drills (lane);

-- One statement: read-modify-write happens inside the database, capped at the
-- most recent 300, so two tabs cannot lose a run and the array cannot grow
-- without bound now that Playground runs are 60-120 seconds each.
create or replace function public.append_drill_result(result jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare trimmed jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  if not public.is_not_banned() then raise exception 'account is banned'; end if;
  update public.wellness w
     set drill_results = (
           select coalesce(jsonb_agg(x), '[]'::jsonb)
           from (
             select x from jsonb_array_elements(w.drill_results || jsonb_build_array(result)) x
             offset greatest(jsonb_array_length(w.drill_results) + 1 - 300, 0)
           ) s
         ),
         updated_at = now()
   where w.user_id = (select auth.uid())
   returning w.drill_results into trimmed;
  return coalesce(trimmed, '[]'::jsonb);
end $$;
revoke all on function public.append_drill_result(jsonb) from public, anon;
grant execute on function public.append_drill_result(jsonb) to authenticated;
```

- [ ] **Step 5: `scripts/db-apply.mjs`** — the applier that lived in the session scratchpad during v1 becomes a committed, reproducible script (openness, R1.12). Reads `SUPABASE_DB_URL` from the environment (session pooler; the direct host is IPv6-only and unreachable from this machine — build log 20:43), applies every file in `supabase/migrations/` not present in `supabase_migrations.schema_migrations`, records each one, and prints the list. **It never prints a connection string, a password or a key**, and it refuses to run if `SUPABASE_DB_URL` is absent. `--dry-run` lists what it would apply.

- [ ] **Step 6: `seed/lessons/lesson.schema.json`** — JSON Schema for the file shape, encoding every invariant from spec §3.2 so both the validator and the authoring agents have one source:
  exactly one `concept`; exactly one `worked`; one to three `check`; exactly one `recap`; exactly one `bridge`; blocks in that order; total blocks <= 8; every code string <= 20 lines and <= 90 columns; no string matching `/\b(CLO|learning outcome|syllabus)\b/i`; no string containing any pattern id from `seed/patterns.json`; no emoji; `id === cloId`; `language` matches the CLO's course language (or `sql`/`mongo` for the two mixed CLOs); `estimatedMinutes` between 4 and 8; **a Java snippet must have `runnable: false`** (§3 C1).

- [ ] **Step 7: `seed/lessons/INFS1101.json` — one hand-written golden lesson.** This is the register-setter and the fixture T1.3 renders against before any generated content exists. Write it for the first code-assessable CLO in INFS1101, in the voice of spec §2, with a `concept`, a runnable Python `snippet`, a `worked` with four steps, a `predict-output` check and a `choose` check, a `recap` and a `bridge`. It must pass `node seed/validate.mjs` and, once T1.1 lands, `node scripts/verify-lesson.mjs`.

- [ ] **Step 8: `seed/validate.mjs`** — load `lesson.schema.json` and validate every `seed/lessons/*.json` against it plus the cross-file invariants (`cloId` exists in `seed/clos.json`; `course` matches that CLO's course; no duplicate `id` across files). Exit non-zero with a per-lesson failure list.

- [ ] **Step 9: `scripts/seed-load.mjs`** — five additions, each printing its count:
  1. `seed/lessons/*.json` → upsert `lessons` on `id`.
  2. `ACHIEVEMENTS` (imported from the contracts module, so the table can never drift from the constant) → upsert `achievements` on `id`.
  3. One synthetic `DrillItem` per Playground game: `id: 'play-<kind>'`, `kind`, `lane: 'play'`, `difficulty: 3`, `timeLimitS` from spec §7.9 (75, 90, 60, 60, 90, 90), `payload: {}`.
  4. `lane: 'arcade'` on every existing seeded drill.
  5. `--dry-run` reports every count, including the three new ones.

- [ ] **Step 10: `src/lib/learner/integrity.sql.test.ts`** (new — see §3 C2). Read `supabase/migrations/0008_integrity_breakdown.sql`, parse the `insert into public.integrity_weights ... values` tuple list, and assert it equals `INTEGRITY_WEIGHTS` from the contracts, key for key and number for number. Also assert `0008` contains no second `case` expression over event types (there is exactly one place the weights live).

**Acceptance**
```bash
node seed/validate.mjs                      # exit 0, reports 1 lesson
node scripts/seed-load.mjs --dry-run        # courses 6, clos 26, patterns 42, exercises 111,
                                            # drills 150 (144 + 6 play), lessons 1, achievements 20
npx vitest run src/lib/learner/integrity.sql.test.ts
npx vitest run                              # 840 + new, green
SUPABASE_DB_URL=... node scripts/db-apply.mjs --dry-run   # lists 0006..0009
```
Applied against the live project (controller, not the subagent), verify in SQL:
- `select public.integrity_score('<a user with 5 blurs and 1 paste>')` returns the same number it returned before the migration.
- `set role authenticated; select * from public.lessons limit 1;` → permission denied. `reset role;`
- `select * from public.my_integrity_breakdown();` as a signed-in learner returns their own rows only.
- `select * from public.my_activity_days(120);` returns at most 240 rows.
- `select public.append_drill_result('{"drillId":"play-breathe","kind":"breathe","lane":"play","correct":true,"timeMs":90000,"score":100,"at":"2026-09-06T00:00:00.000Z"}'::jsonb);` appends one and the array never exceeds 300.

**Existing tests it may change:** none.
**Review (Opus):** every new table has RLS enabled; every learner-facing policy carries `public.is_not_banned()`; every `security definer` function pins `search_path`; `integrity_score`'s numbers are unchanged (diff the before/after result on real data); `append_drill_result` cannot append for another user; `my_activity_days` is bounded; `db-apply.mjs` cannot print a secret; the golden lesson has no institution name, no pattern id, no emoji, and opens no line with "Your".
**Commit:** `git add supabase/migrations scripts/seed-load.mjs scripts/db-apply.mjs seed/validate.mjs seed/lessons src/lib/learner/integrity.sql.test.ts && git commit -m "feat(db): lessons, achievements, integrity weights table, drill lanes, capped drill append"`

---

### T0.3 — The static curriculum bundle

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.1 (`LessonPublic`, `Clo.draft`)

This is the single change that removes most of the latency: the curriculum leaves the network entirely (R5.1). `/dashboard`, `/course/[code]` and `/lesson/[cloId]` go to **zero** Supabase round trips for curriculum data.

**Files**
- Create: `scripts/build-static-curriculum.mjs`, `src/lib/curriculum/index.ts`, `src/lib/curriculum/index.test.ts`, `src/lib/curriculum/generated.ts` (generated, **committed**), `src/lib/curriculum/secrets.test.ts`
- Edit: `next.config.ts`

**Interfaces produced**
```ts
// src/lib/curriculum/generated.ts  — GENERATED by prebuild. Never hand-edited.
export const BUILD_ID: string
export const COURSES: readonly Course[]
export const CLOS: readonly Clo[]
export const PATTERNS: readonly { id: string; name: string; description: string; family: string }[]
export const COURSE_HASHES: Readonly<Record<CourseCode, string>>

// src/lib/curriculum/index.ts  — the only API screens use
export function courses(): readonly Course[]                       // live + coming-soon, by level
export function liveCourses(): readonly Course[]
export function course(code: CourseCode): Course | null
export function closFor(code: CourseCode): readonly Clo[]          // ordinal order
export function clo(id: CloId): Clo | null
export function patternName(id: PatternId): string
export interface CourseBundle { code: CourseCode; clos: Clo[]; exercises: ExercisePublic[]; lessons: LessonPublic[] }
/** Fetched once per session per course, memoised in a module Map, force-cache. */
export function loadCourseBundle(code: CourseCode): Promise<CourseBundle>
/** Synchronous read of an already-loaded bundle; null if not loaded yet. */
export function loadedBundle(code: CourseCode): CourseBundle | null
export function lessonFor(code: CourseCode, cloId: CloId): LessonPublic | null
export function exerciseFrom(code: CourseCode, id: string): ExercisePublic | null
```
**Interfaces consumed:** `Course`, `Clo`, `ExercisePublic`, `LessonPublic` (T0.1); `seed/*.json`.

- [ ] **Step 1: `scripts/build-static-curriculum.mjs`**

Reads `seed/courses.json`, `seed/clos.json`, `seed/patterns.json`, every `seed/exercises/*.json` **except `unverified/`**, and every `seed/lessons/*.json`. Applies exactly the filters the current Supabase queries apply — `courses.status === 'live'` for the per-course files (coming-soon courses still appear in `COURSES` so `/courses` can show them honestly and disabled), and `verified === true` for exercises. Strips, in this order and with an assertion after each:

1. `referenceSolution` from every exercise;
2. `referenceSolution` from every `micro-code` check;
3. `expectedStdout` from every snippet.

Writes:
```
src/lib/curriculum/generated.ts        COURSES, CLOS, PATTERNS, COURSE_HASHES, BUILD_ID
public/curriculum/manifest.json        { buildId, files: { "<CODE>": "<sha1>" } }
public/curriculum/course/<CODE>.json   { clos, exercises: ExercisePublic[], lessons: LessonPublic[] }
public/curriculum/drills/<kind>.json   DrillItem[]
```

`--check` re-generates into a temp directory and exits non-zero if anything differs from what is on disk. That is the CI gate that keeps the committed `generated.ts` honest without making every build non-deterministic.

Determinism rules, because `--check` depends on them: stable key order (stringify over sorted keys), stable array order (courses by `level` then `code`, clos by `course` then `ordinal`, exercises by `cloId` then `pattern` then `difficulty` then `title`, lessons by `cloId`), and `BUILD_ID` = sha1 of the concatenated per-course hashes — **not** a timestamp, which would make `--check` fail on every run.

- [ ] **Step 2: `src/lib/curriculum/index.ts`**

`loadCourseBundle` uses
```ts
fetch(`/curriculum/course/${code}.json?v=${COURSE_HASHES[code]}`, { cache: 'force-cache' })
```
memoised in a module-level `Map<CourseCode, Promise<CourseBundle>>` so two components mounting in the same frame share one request. On failure it rejects with a typed error the screens render through `<ErrorRetry>`; it never falls back to a Supabase read, because a silent fallback is exactly what hides a slow path.

- [ ] **Step 3: `next.config.ts`**

```ts
async headers() {
  return [{
    source: '/curriculum/:path*',
    headers: [{ key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=604800' }],
  }]
}
```

- [ ] **Step 4: record R5.1a on the ledger, not just in prose.** A file under `public/` has no RLS gate: anyone with the URL, signed out or banned, reads every seed exercise including each hidden test's `expected`. Accepted **only** because `seed/exercises/*.json` is already in a public MIT repository, so the marginal loss is a URL and not a secret. One line in `docs/build-log.md`, one ledger row. **Not a precedent for moving anything user-owned into `public/`.**

- [ ] **Step 5: `src/lib/curriculum/secrets.test.ts`** — the test spec §11.3 requires. Walk every file under `public/curriculum/` and assert none contains the string `referenceSolution` or `expectedStdout`; additionally assert no exercise object carries a key matching `/reference|solution|answer/i`, and that each course file's exercise count equals the count of verified seed exercises for that course.

- [ ] **Step 6: `src/lib/curriculum/index.test.ts`** — `closFor` is in ordinal order; `clo('INFS1201-1').draft === true`; `course('INFS3102').status === 'live'` (Java landed, §3 C1); `loadCourseBundle` issues exactly one `fetch` for two concurrent calls (spy) and none for a third after resolution; `exerciseFrom` returns `null` for an id not in the bundle — the runtime-generated case that must fall through to `exercises_public` (R5.1b).

**Acceptance**
```bash
node scripts/build-static-curriculum.mjs
node scripts/build-static-curriculum.mjs --check   # exit 0 immediately after
npx vitest run src/lib/curriculum
npx vitest run                                     # green
npm run build                                      # exit 0 (prebuild now exists)
du -sh public/curriculum                           # recorded in the commit body
```

**Existing tests it may change:** none.
**Review (Opus):** the three strips are asserted inside the script itself, not only in the test; `--check` is genuinely deterministic (run twice, then `touch` a seed file and confirm it fails); `generated.ts` carries a GENERATED header; no screen can reach a reference solution through the bundle; the coming-soon course is in `COURSES` but has no per-course file.
**Commit:** `git add scripts/build-static-curriculum.mjs src/lib/curriculum next.config.ts && git commit -m "feat(curriculum): static bundle at prebuild, zero round trips for curriculum"`

---

### T0.4 — TanStack Query provider, hydration, query keys

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.1

Read `node_modules/next/dist/docs/` on providers in the App Router before writing. The Query client is a **singleton per browser, one per server render** — the documented pattern; getting it wrong leaks one user's cache into another's render.

**Files**
- Create: `src/lib/query/keys.ts`, `src/lib/query/client.ts`, `src/lib/query/hooks.ts`, `src/lib/query/hooks.test.tsx`, `src/lib/query/optimistic.ts`, `src/lib/query/optimistic.test.ts`, `src/components/shell/QueryProvider.tsx`, `src/components/shell/QuerySeed.tsx`, `src/components/shell/QuerySeed.test.tsx`
- Edit: `src/app/(app)/layout.tsx` (mount `<QueryProvider>` + `<QuerySeed>` **only** — the pager deletion and the header-forwarded profile are T2.1's, next wave)

**Interfaces produced**
```ts
// src/lib/query/keys.ts — every key in one place so an invalidation cannot miss one
export const qk = {
  curriculum: (code: CourseCode) => ['curriculum', code] as const,
  learnerState: (userId: string) => ['learner-state', userId] as const,
  attempts: (userId: string) => ['attempts', userId] as const,
  reportAttempts: (userId: string) => ['report-attempts', userId] as const,
  activityDays: (userId: string) => ['activity-days', userId] as const,
  wellness: (userId: string) => ['wellness', userId] as const,
  lessonProgress: (userId: string) => ['lesson-progress', userId] as const,
  achievements: (userId: string) => ['achievements', userId] as const,
  integrityBreakdown: (userId: string) => ['integrity-breakdown', userId] as const,
}

// src/lib/query/client.ts
export function makeQueryClient(): QueryClient
export function getQueryClient(): QueryClient     // browser singleton / fresh per server render

// src/lib/query/hooks.ts  (client hooks, each keyed on the signed-in user)
export function useLearnerState(): UseQueryResult<LearnerState>
export function useAttempts(): UseQueryResult<Attempt[]>          // capped 50, newest first
export function useActivityDays(): UseQueryResult<{ kind: 'exercise' | 'derot'; day: string }[]>
export function useWellness(): UseQueryResult<WellnessRow>
export function useLessonProgress(): UseQueryResult<LessonProgress[]>
export function useAchievements(): UseQueryResult<UserAchievement[]>

// src/lib/query/optimistic.ts — the one shape every mutation uses
export function optimistic<TData, TVars>(opts: {
  key: readonly unknown[]
  apply: (prev: TData | undefined, vars: TVars) => TData
  mutate: (vars: TVars) => Promise<unknown>
  onSettledInvalidate?: readonly unknown[][]
}): UseMutationOptions<unknown, Error, TVars, { previous: TData | undefined }>
```

Stale times, exactly as spec §5.2: `curriculum` `Infinity`/`Infinity`; `learner-state` and `attempts` `30_000`/`300_000`; `wellness`, `lesson-progress`, `achievements`, `activity-days` `Infinity`/`Infinity`. **No agent call is ever a query** — `useMutation` only, `retry: false`, `gcTime: 0`.

- [ ] **Step 1: `client.ts`** — the documented singleton: on the server return a fresh client, in the browser `browserClient ??= makeQueryClient()`. Global defaults `refetchOnWindowFocus: false` (a learner alt-tabbing back into an exercise must not trigger a refetch storm — and the blur guard already fires there), `retry: 1`, `throwOnError: false`.

- [ ] **Step 2: `QueryProvider.tsx`** — `'use client'`, wraps children in `<QueryClientProvider client={getQueryClient()}>`. It wraps `SessionProvider`: the two are complementary — Zustand holds the synchronous session snapshot the whole shell reads, Query owns fetching, dedupe and mutations.

- [ ] **Step 3: `QuerySeed.tsx`** — takes the layout's already-fetched rows as props and calls `queryClient.setQueryData` once, **before paint** (`useState(() => { …seed… })`, not `useEffect`, so the first render already reads seeded data) for `learnerState`, `attempts`, `wellness`, `lessonProgress`, `achievements`, `activityDays`. This is the lighter documented alternative to `dehydrate`/`HydrationBoundary`, and it is the right one here because the layout reads through the Supabase server client, not `fetch`. Full `HydrationBoundary` is deferred with Cache Components (spec §5.8).

- [ ] **Step 4: mount in `(app)/layout.tsx`** — the minimal edit: wrap the existing `<SessionProvider>` in `<QueryProvider>` and render `<QuerySeed …/>` with the data the layout already reads. **Do not** delete the pager or change the auth reads here; T2.1 owns that, and doing it twice is how a conflict gets hand-written.

- [ ] **Step 5: tests**
  - `hooks.test.tsx`: a seeded key does not fetch on mount; `Infinity` keys never refetch on remount; a `30_000` key refetches after the fake clock passes it.
  - `optimistic.test.ts`: `apply` runs before the network; a rejected `mutate` restores the snapshot exactly; a resolved one keeps the applied value and invalidates the named keys; two concurrent mutations on one key roll back to the right snapshot (cancel-then-snapshot order).
  - `QuerySeed.test.tsx`: seeded data is readable in the **same** render pass, not one tick later.

**Acceptance**
```bash
npx vitest run src/lib/query src/components/shell/QuerySeed.test.tsx
npx vitest run          # green, including src/app/(app)/layout.test.tsx
npx tsc --noEmit
npm run build
```
Plus, with the dev server up: open `/dashboard` and confirm the layout's Supabase reads happen once and no client-side duplicate fires.

**Existing tests it may change:** `src/app/(app)/layout.test.tsx` — **additions only** (a provider now wraps the tree; its render helper may need it). No existing assertion may be deleted or weakened.
**Review (Opus):** the client is a true per-request singleton on the server (render twice, assert two distinct clients server-side and one in the browser); no agent call is a query; seeding happens before paint; `refetchOnWindowFocus: false` is deliberate and commented.
**Commit:** `git add src/lib/query src/components/shell/QueryProvider.tsx src/components/shell/QuerySeed.tsx src/components/shell/QuerySeed.test.tsx "src/app/(app)/layout.tsx" && git commit -m "feat(query): TanStack Query provider, SSR seeding, optimistic mutation shape"`

---

### T0.5 — Sound manager and motion manager

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.1 (`WellnessPrefs.sound`, `WellnessPrefs.motion`)

**Files**
- Create: `src/lib/sound/events.ts`, `src/lib/sound/tiers.ts`, `src/lib/sound/manager.ts`, `src/lib/sound/manager.test.ts`
- Create: `src/lib/motion/useReducedMotion.ts`, `src/lib/motion/useReducedMotion.test.tsx`, `src/lib/motion/tokens.ts`, `src/lib/motion/timing.test.ts`
- Create: `src/components/shell/SoundToggle.tsx`, `src/components/shell/SoundToggle.test.tsx`
- Create: `scripts/synth-sounds.mjs`, `scripts/build-sound-sprite.mjs`, `public/sounds/CREDITS.md`
- Create (generated, committed): `public/sounds/brogram.json`, `public/sounds/brogram.webm`, `public/sounds/brogram.mp3`

**Interfaces produced**
```ts
// src/lib/sound/events.ts — client-only, deliberately NOT a contract
export type SoundEventId =
  | 'ui.tap' | 'run.go' | 'submit.send'
  | 'pass' | 'fail' | 'chain.tick' | 'clo.close' | 'first.win'
  | 'level.up' | 'xp.settle' | 'streak.light' | 'streak.milestone' | 'streak.lost' | 'best'
  | 'hint' | 'drill.hit' | 'drill.miss' | 'goal.done' | 'wellness.chime'

// src/lib/sound/tiers.ts — R7.8: two tiers, two toggles
export const REWARD_TIER: readonly SoundEventId[]     // 12 ids, default ON, killed by the header mute
export const INTERFACE_TIER: readonly SoundEventId[]  // 7 ids, default OFF, Account toggle
export const RANK: Record<SoundEventId, number>       // first.win > level.up > clo.close > pass > chain.tick > rest

// src/lib/sound/manager.ts — module singleton, 'use client', never imported from a server path
export function initSoundOnFirstGesture(): void   // one pointerdown/keydown listener, removed after it fires
export function play(id: SoundEventId): void      // no-op-and-queue before load or unlock; never throws
export function setEnabled(on: boolean): void
export function setInterfaceEnabled(on: boolean): void
export function setVolume(v: number): void
/** Arcade turns the drill ticks on for a run regardless of the tier toggle: there the tick IS the game. */
export function withInterfaceSounds<T>(run: () => T): T

// src/lib/motion/useReducedMotion.ts
export function useReducedMotion(): boolean
export function resolveMotion(pref: MotionPreference, osReduce: boolean): boolean

// src/lib/motion/tokens.ts — the timing law as values, so review can be mechanical
export const DUR = { instant: 100, fast: 150, base: 200, slow: 320, celebration: 700 } as const
export const EASE = {
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  enter:    'cubic-bezier(0.22, 1, 0.36, 1)',
  move:     'cubic-bezier(0.25, 1, 0.5, 1)',
  drawer:   'cubic-bezier(0.32, 0.72, 0, 1)',
} as const
export const SPRING = { duration: 0.5, bounce: 0.2 } as const
export const STAGGER = { step: 40, max: 300 } as const
```

- [ ] **Step 1: `scripts/synth-sounds.mjs`** — pure Node, no dependency, no network (§3 C5). Writes 19 mono 44.1 kHz 16-bit PCM WAVs into `assets/sounds-src/` by additive synthesis with exponential decay envelopes. Every clip well under a second; `first.win` and `level.up` are layered arpeggios and may reach 900 ms. All BroGram-authored, therefore **CC0**. Deterministic — the same seed produces byte-identical output, so re-running never churns the sprite.

  Register per id, so the sound design is a decision and not an accident: `pass` a warm two-note rise; `fail` a soft low thud, never a buzzer; `chain.tick` a short ascending blip clearly distinct from `pass`; `clo.close` the biggest sound short of `first.win`; `hint` a page turn, deliberately unexciting; `wellness.chime` the most conservative in the set; `streak.milestone` used nowhere else so it keeps meaning.

- [ ] **Step 2: `scripts/build-sound-sprite.mjs`** — runs `audiosprite` (devDependency, ffmpeg-backed; ffmpeg 8.1.1 is installed and verified on this machine) over `assets/sounds-src/` and emits `public/sounds/brogram.{json,webm,mp3}`. **Both** formats: webm primary, mp3 the fallback that actually protects Safari before 18.4. The script fails if either output exceeds **120 KB**. The sprite outputs are committed so a fork with no ffmpeg still gets sound.

- [ ] **Step 3: `manager.ts`** — Howler 2.2.4 (MIT): Web Audio first with an HTML5 Audio fallback, first-class sprites, and an `autoUnlock` that plays a silent buffer on the first gesture, which is exactly what every browser's autoplay policy requires. Do **not** hand-roll `AudioContext` unlocking. `init()` dynamic-imports Howler and fetches the sprite JSON, so nothing audio-related sits on any route's critical path. Living in the manager and nowhere else:
  - **rank debounce** — no two reward sounds overlap; inside a 250 ms window only the higher-ranked plays (R7.3);
  - **repetition attenuation** — the same id played more than four times inside sixty seconds drops 6 dB for the rest of that window (R7.8);
  - **tier gate** — an `INTERFACE_TIER` id is silent unless `sound.interface` is on or `withInterfaceSounds` is active;
  - **master gate** — the header mute kills both tiers.
  No call site ever thinks about any of it.

- [ ] **Step 4: `useReducedMotion`** — `useSyncExternalStore` over `matchMedia('(prefers-reduced-motion: reduce)')`, combined with `wellness.prefs.motion`. `resolveMotion('full', true) === false` is the load-bearing case: **an in-app override beats the OS**, which `gsap.matchMedia()` structurally cannot do (it evaluates media queries; `matchMediaRefresh()` knows nothing about React state). Hence the resolved boolean is passed into every timeline as a parameter, and `gsap.matchMedia()` is reserved for genuinely query-shaped variants (viewport, `hover: hover`).

- [ ] **Step 5: `SoundToggle.tsx`** — one icon button in the shell header, not buried in settings, mirrored in Account. `aria-pressed`, an accessible name that changes with state, writes through the wellness prefs mutation. Default **on**: nothing can play before the first gesture anyway, so defaulting on costs nothing.

- [ ] **Step 6: `public/sounds/CREDITS.md`** — one row per file: filename, source (`BroGram, scripts/synth-sounds.mjs`), author (BroGram), licence (CC0), URL (n/a). Plus a paragraph naming Kenney (CC0) and Freesound (CC0 / CC-BY with a row) as the documented optional upgrade, and the rule that **Mixkit and Pixabay are never committed**, because their terms forbid redistributing content standalone and a public MIT repo is exactly that.

- [ ] **Step 7: tests**
  - `manager.test.ts` with a stubbed Howl: `play` before `init` queues and flushes on load; two ids inside 250 ms play only the higher rank; the fifth play of one id inside 60 s is attenuated; an interface-tier id is silent by default and audible inside `withInterfaceSounds`; `setEnabled(false)` silences both tiers; `play` never throws when the sprite fetch rejects.
  - `useReducedMotion.test.tsx`: OS reduce + `'system'` → true; OS reduce + `'full'` → **false**; no OS signal + `'reduced'` → true; the store re-renders when the query changes.
  - `timing.test.ts`: every `DUR` value sits inside the spec's band for its tier, and no `EASE` value is an `ease-in`.

**Acceptance**
```bash
node scripts/synth-sounds.mjs && node scripts/build-sound-sprite.mjs
ls -l public/sounds/brogram.webm public/sounds/brogram.mp3   # each <= 120 KB
npx vitest run src/lib/sound src/lib/motion src/components/shell/SoundToggle.test.tsx
npx vitest run          # green
npm run build           # howler must NOT appear in any route's initial chunk
```

**Existing tests it may change:** none.
**Review (Opus):** Howler and the sprite load on first gesture only (grep the build output for `howler` in an initial chunk); `play` cannot throw on any path; rank, attenuation and tier logic live entirely in the manager; `useReducedMotion` is the only place `matchMedia` is read for motion; every clip is BroGram-authored and CREDITS.md says so; both sprite formats exist and are under budget.
**Commit:** `git add src/lib/sound src/lib/motion src/components/shell/SoundToggle.tsx src/components/shell/SoundToggle.test.tsx scripts/synth-sounds.mjs scripts/build-sound-sprite.mjs public/sounds && git commit -m "feat(sound,motion): two-tier sound manager on a CC0 synthesized sprite, resolved reduced-motion"`

---

### T0.6 — Themes: four palettes, tokens, provider, no flash

**Model:** Sonnet. **Review:** Opus — and the palette verification is a **named review step with a test behind it**, not a hope.
**Depends on:** T0.4 (`QueryProvider`, composed in `providers.tsx`), T0.5 (`initSoundOnFirstGesture`)

**Files**
- Edit: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/ui/sonner.tsx`
- Create: `src/app/providers.tsx`, `src/lib/theme/themes.ts`, `src/lib/theme/contrast.ts`, `src/lib/theme/contrast.test.ts`, `src/components/shell/ThemeQuickSwitch.tsx`, `src/components/shell/ThemeQuickSwitch.test.tsx`

**Interfaces produced**
```ts
// src/lib/theme/themes.ts
export const THEMES: readonly { id: ThemeName; name: string; blurb: string; swatch: [string, string, string] }[]
// midnight "Midnight" dark default | amber "Amber" warm dark | paper "Paper" light | arcade "Arcade" high contrast

// src/lib/theme/contrast.ts — pure colour math, so R8.3 is a test and not a promise
export function oklchToSrgb(l: number, c: number, h: number): [number, number, number]
export function wcagRatio(fg: string, bg: string): number     // takes 'oklch(...)' strings
export function apcaLc(fg: string, bg: string): number
```

- [ ] **Step 1: `globals.css` — four theme blocks.** Copy the four OKLCH palettes from spec §8.3 verbatim into `[data-theme="midnight"|"amber"|"paper"|"arcade"]`. Each block sets its own `color-scheme`, which also fixes the latent bug where `:root` sets `color-scheme: dark` immediately above a *light* `--background` (R8.2). The `@theme inline` block at `globals.css:43-85` keeps its shape and only gains the new names. **No component ever branches on which theme is active** — that indirection is the entire point and is why this is additive rather than a rewrite.

  New semantic tokens, defined in **all four** blocks (§8.4): `--destructive-foreground`, `--success` / `--success-foreground`, `--warning` / `--warning-foreground`, `--celebration` / `--celebration-foreground`, `--glow`.

  Elevation (§8.5) as `--shadow-{xs,sm,md,lg}` redefined per theme: Paper a conventional soft shadow; **Midnight and Amber lighten the surface** instead, because a black shadow on a near-black ground is invisible; Arcade a two-radius coloured glow in the hero hue — never `text-shadow`, which destroys legibility.

  Motion tokens (§8.6) as `--duration-*` and `--ease-*`, mirroring `src/lib/motion/tokens.ts` value for value, with a comment in each file naming the other.

  Typography (§8.7): BroGram's own scale on Geist, 14 px body, tracking tightening as size grows. A `.tabular` utility applying `font-variant-numeric: tabular-nums` for every counter that ticks live — streak days, XP, level, hint countdown, drill timer, combo — so an animating number never jitters the layout around it.

  Delete the `.dark` block and `@custom-variant dark`: there is no light/dark binary any more, there are four personalities on one axis.

- [ ] **Step 2: `src/app/providers.tsx`** — one client component composing, outermost first, `ThemeProvider` → `QueryProvider` → children. Sound and motion are module singletons, not context; `providers.tsx` calls `initSoundOnFirstGesture()` in a mount effect.

```tsx
'use client'
<ThemeProvider
  attribute="data-theme"
  themes={['midnight', 'amber', 'paper', 'arcade']}
  defaultTheme="midnight"
  enableSystem={false}
  storageKey="brogram:theme"
  disableTransitionOnChange
>
  <QueryProvider>{children}</QueryProvider>
</ThemeProvider>
```

- [ ] **Step 3: `src/app/layout.tsx`** — `<html lang="en" suppressHydrationWarning>`, the hardcoded `dark` class **removed**, `<Providers>` mounted. `suppressHydrationWarning` is required because next-themes' injected pre-hydration script sets the attribute before React mounts, and that script **is** the no-flash mechanism.

- [ ] **Step 4: the empty-storage accessibility seed.** In the pre-hydration path, **only when `localStorage['brogram:theme']` is empty**: `prefers-contrast: more` → `arcade`; else `prefers-color-scheme: light` → `paper`; else `midnight`. Two media-query reads inside a script that already runs before paint. It never overrides an explicit choice, and `enableSystem` stays `false` — this is a one-time seed of the stored value, not ongoing system following. Without it, a learner whose OS asks for high contrast or light gets a low-contrast dark theme on their very first screen, before they know a picker exists.

- [ ] **Step 5:** `[data-theme-switching] * { transition: none !important }` alongside `disableTransitionOnChange`, so a hundred elements do not cross-fade independently on a switch.

- [ ] **Step 6: `ThemeQuickSwitch.tsx`** — the shell-header popover. Four **live swatch previews** (background, primary and accent dots plus the name), not a segmented control: four full personalities are not four steps on a scale. `role="radiogroup"` with `role="radio"` children, arrow-key navigable, each with an accessible name. Optional progressive enhancement: `document.startViewTransition` for a circular wipe from the trigger — feature-detected **and** gated on `useReducedMotion()`.

- [ ] **Step 7: `src/components/ui/sonner.tsx`** — currently the only `next-themes` consumer, mapping to light/dark. Map the four themes onto Sonner's `theme` prop (`paper` → `light`, the other three → `dark`) so toasts stop being the one component that ignores the palette.

- [ ] **Step 8: `contrast.test.ts` — the palette gate (R8.3, and change-log open item 2).** Parse every `oklch(...)` token out of `globals.css` per theme and assert, for every foreground/background pair the design actually uses (`foreground`/`background`, `card-foreground`/`card`, `muted-foreground`/`card`, `primary-foreground`/`primary`, `destructive-foreground`/`destructive`, `success-foreground`/`success`, `warning-foreground`/`warning`, `celebration-foreground`/`celebration`, `border`/`background`, `ring`/`background`):
  - body text APCA `Lc >= 75` **and** WCAG 2.2 AA (4.5:1);
  - large text and UI components `Lc >= 60` and 3:1;
  - focus rings and dividers `Lc >= 45`.
  Plus the Arcade case the spec's critic flagged: `--success` and `--warning` must differ by at least `0.10` in OKLCH `L`, so a green/amber verdict separates by luminance and not only by hue. A failing pair is a **failing test**, not a design note. No theme ships on the document's numbers alone.

- [ ] **Step 9: `ThemeQuickSwitch.test.tsx`** — keyboard-only traversal of all four; choosing one writes `data-theme` on `<html>`; the choice survives a remount; `startViewTransition` is not called under reduced motion.

**Acceptance**
```bash
npx vitest run src/lib/theme src/components/shell/ThemeQuickSwitch.test.tsx
npx vitest run          # green
npm run build
```
Manual: pick each of the four in turn — background, text, primary and accent change together, no white flash, no half-themed component. Reload on Paper: still Paper, no flash of Midnight. Set the OS to high contrast, clear `localStorage`, reload: Arcade.

**Existing tests it may change:** none. (If a test asserts the `dark` class on `<html>`, that change is legitimate — list it in the commit body.)
**Review (Opus):** no component branches on theme; the four blocks define an **identical key set** (a token missing from one theme is the classic half-themed bug — assert it); `color-scheme` is per theme; `suppressHydrationWarning` is present; the contrast test genuinely fails when a value is nudged (prove it by breaking one temporarily and re-running).
**Commit:** `git add src/app/globals.css src/app/layout.tsx src/app/providers.tsx src/lib/theme src/components/shell/ThemeQuickSwitch.tsx src/components/shell/ThemeQuickSwitch.test.tsx src/components/ui/sonner.tsx && git commit -m "feat(theme): four OKLCH themes, semantic tokens, no-flash provider, verified contrast"`

---

### T0.7 — Shell recomposition (Group C)

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.5 (`SoundToggle`), T0.6 (`ThemeQuickSwitch`)

`AppShell.tsx` is the most contended file in v2: it receives the dock placement, the sound toggle and the theme quick-switch, and it is one file with one writer at a time. This task changes it **once**, into a shape where every later task edits its own small component instead.

**Files**
- Edit: `src/components/shell/AppShell.tsx`, `src/components/shell/WellnessSlot.tsx`
- Create: `src/components/shell/ShellLayout.tsx`, `src/components/shell/ShellHeaderControls.tsx`, `src/components/shell/DockControl.tsx`, `src/components/shell/useSecondTick.ts`, `src/components/shell/useSecondTick.test.tsx`, `src/components/shell/ShellLayout.test.tsx`

**Interfaces produced**
```ts
// src/components/shell/ShellLayout.tsx — owns the grid; T2.4 makes it placement-aware
export function ShellLayout({ dock, children }: { dock: ReactNode; children: ReactNode }): JSX.Element

// src/components/shell/ShellHeaderControls.tsx — the controls, one mount point
export function ShellHeaderControls(): JSX.Element   // DockControl + SoundToggle + ThemeQuickSwitch + Account + Buddy

// src/components/shell/DockControl.tsx — the re-open glyph. Hidden is never a dead end.
export function DockControl(): JSX.Element

// src/components/shell/useSecondTick.ts
/** ONE shared 1 Hz interval for the whole app, suspended while document.hidden.
 *  Only components that actually display seconds subscribe. */
export function useSecondTick(): number
```

- [ ] **Step 1: extract the grid.** Move the `grid` + `<main>` + `<aside>` block out of `AppShell` into `ShellLayout`, unchanged in behaviour for now (right rail, 15rem, the existing exercise-route case). T2.4 turns it into the five-placement renderer; nobody else touches it after this.

- [ ] **Step 2: extract the header controls.** The right-hand cluster becomes `<ShellHeaderControls />`, rendering `DockControl`, `SoundToggle`, `ThemeQuickSwitch`, the Account link and the Buddy button. After this commit, adding a header control is an edit to **one small owned file**, not to the shell.

- [ ] **Step 3: `useSecondTick`** — `useSyncExternalStore` over a single module-level `setInterval(…, 1000)` created on the first subscriber, cleared on the last, and **paused while `document.hidden`**, re-syncing on `visibilitychange` so a returning tab shows the right second immediately. This replaces `Rail.tsx:30-37,120`, which re-renders the whole rail every second on every route; T2.4 does the swap.

- [ ] **Step 4: nav copy.** While the file is open: "Courses" points at `/courses` (T1.6's route) rather than `/dashboard#course`, and "Reports" becomes "Progress". Label and `href` only; no restyling.

- [ ] **Step 5: tests.** `useSecondTick.test.tsx` with fake timers: one interval for three subscribers; cleared when the last unsubscribes; no tick while `document.hidden`; resyncs on `visibilitychange`. `ShellLayout.test.tsx`: renders `main` and the dock slot; `main` keeps `id="main-content"` and `tabIndex={-1}` so the skip link still works.

**Acceptance**
```bash
npx vitest run src/components/shell
npx vitest run          # green — the shell is rendered by many existing tests
npx tsc --noEmit
npm run build
```

**Existing tests it may change:** any test that renders `AppShell` and asserts the old header or grid DOM — most likely `src/app/(app)/dashboard/page.test.tsx` and `src/app/(app)/layout.test.tsx`. **Selector updates and additions only**; no behavioural assertion may be deleted.
**Review (Opus):** `AppShell` is now short and holds no layout logic; the skip link still lands on `main`; `/preview` renders every section unchanged; `useSecondTick` creates exactly one interval (spy on `setInterval`).
**Commit:** `git add src/components/shell && git commit -m "refactor(shell): extract ShellLayout and ShellHeaderControls, one shared second tick"`

---

### Wave 0 gate

Run by the controller after all eight tasks commit. Nothing in W1 starts until every line is green.

```bash
npx tsc --noEmit                                   # exit 0
npx eslint src                                     # exit 0
npx vitest run                                     # >= 840, zero failures, zero unhandled errors
node seed/validate.mjs                             # exit 0
node scripts/build-static-curriculum.mjs --check   # exit 0
node scripts/seed-load.mjs --dry-run               # counts recorded in the build log
npm run build                                      # exit 0, route list recorded
npx playwright test                                # the three existing flows still pass
```
Then: apply `0006`–`0009` to the live project with `npm run db:apply`; run `node scripts/seed-load.mjs`; record every count and every ruling in `docs/build-log.md`; tick the W0 rows in `openspec/changes/brogram-launch/tasks.md`; `git push origin main`.

**Gate owner:** Opus, running the whole-wave review at the same time — contracts diff, migration safety, no secret in any generated file, no agent call added anywhere, no existing test weakened.

---

## Wave 1 — It teaches

The wave that answers "a beginner cannot learn". A course stops opening on a list of exercises and opens on a **path map** with a **walkthrough** as the first card, onboarding asks six local questions **once per account ever**, and switching courses never asks again.

**Groups.** A (parallel, immediately): T1.1, T1.2, T1.4, T1.5, T1.6. B (after T1.2 commits): T1.3.

Content and screens run in parallel because W0 already shipped `lesson.schema.json` and one golden lesson — T1.3 renders the golden lesson from day one and never waits on T1.1's batch.

---

### T1.1 — Lesson generation workflow, verifier, and the first batch

**Model:** Sonnet for the workflow and verifier; **Sonnet, one agent per CLO** for authoring (batched, 6 at a time); **Opus** for the critic phase. **Review:** Opus, plus one human read of the first lesson per course.
**Depends on:** W0 (`lesson.schema.json`, `Lesson` types, `seed/validate.mjs`)

**Files**
- Create: `docs/prompts/agents/08-lesson-author.md`, `docs/workflows/lesson-generation.js`, `scripts/verify-lesson.mjs`
- Create: `seed/lessons/by-clo/<cloId>.json` (intermediate), `seed/lessons/<COURSE_CODE>.json` (six merged files)

**Interfaces produced:** `seed/lessons/*.json` — the content T0.3's build script bundles and T1.3 renders. `scripts/verify-lesson.mjs <file>` → exit 0 or a per-lesson failure list.
**Interfaces consumed:** `LessonBlock` and `TestCase` (T0.1), `seed/lessons/lesson.schema.json` (T0.2), `getRuntime` (v1), `seed/clos.json`, `docs/prompts/agents/03-author.md` (house style).

- [ ] **Step 1: `docs/prompts/agents/08-lesson-author.md`** — the author prompt, verbatim from spec §3.6, plus the three additions this plan makes explicit: Java snippets ship `runnable: false` (§3 C1); a `micro-code` check carries at most three tests and **all of them are visible**; and the check must require a step the learner takes themselves, never a restatement of the worked example (the redundancy rule the owner asked for by name).

- [ ] **Step 2: `scripts/verify-lesson.mjs`** — sibling of the proven `scripts/verify-exercise.mjs`, reusing its runtime harness. Per lesson:
  - every `snippet` with `runnable: true` is executed in the real runtime and its stdout must equal `expectedStdout`;
  - every `predict-output` check's `code` is executed and its stdout must equal `expected` under the declared normalisation;
  - every `micro-code` check's `referenceSolution` is run against its `tests` and all must pass;
  - every `spot-the-bug` check's `bugLines` must be inside the code's line count (structural);
  - every `fill-blank` template's markers must match the blank ids, and filling with `accept[0]` must parse.
  Java lessons report `unverified` and **must** carry `runnable: false`. Exit non-zero with the failing lesson id and check id.

- [ ] **Step 3: `docs/workflows/lesson-generation.js`** — the same four-phase shape as `exercise-bank-generation.js`, so the runner, journal and resume behaviour are already proven:
```
phase('Author')    one agent per CLO   -> seed/lessons/by-clo/<cloId>.json
phase('Verify')    node scripts/verify-lesson.mjs <file>
phase('Merge')     concatenate into seed/lessons/<COURSE>.json
phase('Critique')  voice, redundancy, leak and reading-level pass
```

- [ ] **Step 4: run Author + Verify** for all 26 CLOs. Target: one lesson per code-assessable CLO across the live courses (**23**), plus honestly-shortened lessons for the three non-code-assessable CLOs. INFS1201's four drafted CLOs get lessons marked `draft: true`.

- [ ] **Step 5: the Critique phase (Opus)** rejects and fixes in place: any §2.3 voice violation (a line opening with "Your", an emoji, over-length celebration copy, "bro" in a guard string); **any check whose correct answer is stated verbatim in the concept or worked block**; any lesson over 8 estimated minutes; any duplicated story or variable-naming tic across lessons in the same course; any leak (institution name, pattern id, the string "CLO").

- [ ] **Step 6: the human gate.** Execution verification plus the critic pass **is** the review for content — the same discipline as the bank. One human read of the **first lesson per course** before the batch is committed, because the first lesson sets the register for the rest.

**Acceptance**
```bash
node scripts/verify-lesson.mjs seed/lessons/INFS1101.json    # exit 0
for f in seed/lessons/*.json; do node scripts/verify-lesson.mjs "$f" || exit 1; done
node seed/validate.mjs                                       # exit 0, reports 26 lessons
node scripts/build-static-curriculum.mjs && node scripts/build-static-curriculum.mjs --check
npx vitest run src/lib/curriculum/secrets.test.ts             # no referenceSolution, no expectedStdout in public/
npx vitest run                                               # green
```

**Existing tests it may change:** none.
**Review (Opus):** every lesson teaches exactly one idea; no check restates its worked example; every runnable snippet was actually executed (the verifier's log is in the commit body); no institution name, no pattern id, no emoji, no line opening "Your"; the three non-code-assessable CLOs got honest short lessons rather than padded ones.
**Commit:** `git add docs/prompts/agents/08-lesson-author.md docs/workflows/lesson-generation.js scripts/verify-lesson.mjs seed/lessons && git commit -m "feat(content): lesson generation workflow, verifier, 26 walkthroughs"`

---

### T1.2 — Lesson grading and progress (pure)

**Model:** Sonnet. **Review:** Opus.
**Depends on:** W0

The spec's critic caught the wrong function being named for this: `gradeAnswer` (`src/lib/exercise/grading.ts:12`) takes an `ExercisePublic`, which a `LessonCheck` is not, and its `predict-output` path normalises with `text.trim().replace(/\s+/g, ' ')` — it **collapses newlines**, which is the exact bug the 23:07 ruling fixed in a different module. The correct per-line implementation lives in `src/components/derot/scoring.ts`.

**Files**
- Create: `src/lib/lesson/grade.ts`, `src/lib/lesson/grade.test.ts`, `src/lib/lesson/progress.ts`, `src/lib/lesson/progress.test.ts`
- Edit: `src/lib/exercise/grading.ts`, `src/lib/exercise/grading.test.ts` (the follow-on fix, below)

**Interfaces produced**
```ts
// src/lib/lesson/grade.ts — every non-micro-code kind is graded locally, no agent, ever
export interface CheckVerdict {
  right: boolean
  /** 'hint' after the first wrong answer, 'explain' after the second. Nothing is ever consumed. */
  reveal: 'none' | 'hint' | 'explain'
  /** For `choose`: the line for the option actually chosen — this is where the teaching happens. */
  why?: string
}
export function gradeCheck(check: LessonCheck, answer: CheckAnswer, attemptNumber: number): CheckVerdict
export type CheckAnswer =
  | { kind: 'predict-output'; text: string }
  | { kind: 'choose'; index: number }
  | { kind: 'spot-the-bug'; lines: number[] }
  | { kind: 'fill-blank'; values: Record<string, string> }
  | { kind: 'micro-code'; results: TestResult[] }

// src/lib/lesson/progress.ts
export function lessonStatus(p: LessonProgress | null): 'unseen' | 'started' | 'completed' | 'skipped'
export function isStale(p: LessonProgress, lesson: LessonPublic): boolean   // lessonVersion < lesson.version
export function nextProgress(prev: LessonProgress | null, event: LessonEvent, now: string): LessonProgress
export type LessonEvent =
  | { type: 'opened'; lesson: LessonPublic }
  | { type: 'block-advanced'; index: number }
  | { type: 'check'; right: boolean }
  | { type: 'completed' }
  | { type: 'skipped' }
```

- [ ] **Step 1: the grader table.** Reuse what exists; do not re-implement.

| Check kind | Grader |
|---|---|
| `predict-output` | `gradePredictOutput` from `src/components/derot/scoring.ts` when `normalize: 'lines'`; strict `===` on the raw strings when `normalize: 'exact'` |
| `spot-the-bug` | `gradeSpotTheBug` from `src/components/derot/scoring.ts` — already set-based, already tested |
| `choose` | new pure function; returns `why[index]` for the option actually chosen, right or wrong |
| `fill-blank` | new pure function; compares trimmed and case-insensitively against `accept` |
| `micro-code` | the caller runs `getRuntime(language).run(...)` with the two or three **visible** tests and hands the results in |

`normalize` exists on the block because a lesson sometimes wants trailing-space significance and neither existing grader supports it, so `grade.ts` owns that switch and nothing else.

- [ ] **Step 2: checks never punish (R3.7).** Unlimited attempts. Nothing is consumed. No red flash. First wrong answer reveals `hint`; second reveals `explain` and marks the check answered so the learner can move on. A wrong check is recorded in `lesson_progress.checks_failed` **for content quality only** — it never touches `mastery`, `points`, or the integrity score. `gradeCheck` has no access to any of those, which is how the rule is enforced rather than remembered.

- [ ] **Step 3: the v1 follow-on fix.** `gradeAnswer`'s `predict-output` branch still collapses newlines, so the exercise loop and the walkthroughs would disagree about the same answer. Switch it to `normalizeOutput` from `src/components/derot/scoring.ts` and add the regression test: a two-line expected output where the learner's answer has the right lines in the right order passes, and one where the lines are joined onto one line **fails**. This is a live v1 inconsistency, not something v2 introduces, and it is one line plus a test.

- [ ] **Step 4: tests** — every kind right and wrong; `normalize: 'exact'` distinguishes a trailing space and `'lines'` does not; `choose` returns the chosen option's `why` on a wrong answer (that is the teaching); `fill-blank` accepts any entry in `accept`, case- and whitespace-insensitively, and rejects a near-miss; `spot-the-bug` accepts any line in the set and rejects a line outside it; attempt 1 wrong → `reveal: 'hint'`, attempt 2 wrong → `'explain'`, attempt 5 wrong → still `'explain'` and never a lockout; `nextProgress` never regresses `completed` to `started`; `isStale` is true only when the stored version is lower.

**Acceptance**
```bash
npx vitest run src/lib/lesson src/lib/exercise
npx vitest run          # green, including the existing grading tests
```

**Existing tests it may change:** `src/lib/exercise/grading.test.ts` — **additions plus one corrected assertion** for the newline behaviour. Name the changed assertion in the commit body; it is a bug fix, and the old assertion encoded the bug.
**Review (Opus):** no agent import anywhere under `src/lib/lesson/`; `gradeCheck` cannot reach `mastery`, `points` or integrity; the reused graders are imported, not copied; the `gradeAnswer` change does not alter any other kind's behaviour.
**Commit:** `git add src/lib/lesson src/lib/exercise && git commit -m "feat(lesson): local check grading and progress math; fix predict-output newline collapse"`

---

### T1.3 — The walkthrough screen (Group B)

**Model:** Sonnet. **Review:** Opus (with the accessibility checklist below as named review items).
**Depends on:** T1.2

**Files**
- Create: `src/app/(app)/lesson/[cloId]/page.tsx`, `src/app/(app)/lesson/[cloId]/loading.tsx`, `src/app/(app)/lesson/[cloId]/page.test.tsx`
- Create: `src/components/lesson/LessonView.tsx`, `ConceptBlock.tsx`, `SnippetBlock.tsx`, `WorkedBlock.tsx`, `CheckBlock.tsx`, `RecapBlock.tsx`, `BridgeBlock.tsx`, `ProgressRail.tsx`, `SkipButton.tsx`, `lesson.test.tsx`

**Interfaces consumed:** `lessonFor`, `loadCourseBundle` (T0.3); `gradeCheck`, `nextProgress` (T1.2); `getRuntime` (v1); `useReducedMotion`, `play` (T0.5); `optimistic`, `qk` (T0.4).
**Interfaces produced:** the route `/lesson/[cloId]`; `useLessonRunner(cloId)` inside `LessonView`.

- [ ] **Step 1: the screen.** One column, max width 720 px. Blocks render as a vertical sequence: hook line, concept, optional runnable snippet, worked example with steppable callouts, one to three checks, recap, bridge to the rep. A slim left progress rail shows block count. A "skip this" affordance is in the header, **always** — R3.3: a walkthrough is a strong default, never a lock. "I've got this" records `status: 'skipped'` and the map node carries a small skipped marker.

- [ ] **Step 2: the editor is lazy and single-grammar.** Reuse `src/components/exercise/Editor.tsx` through `next/dynamic({ ssr: false })` with a skeleton, loading exactly one CodeMirror grammar for the lesson's `language`. A walkthrough must not pull the whole 658 KB grammar set.

- [ ] **Step 3: runnable snippets reuse the runtimes unchanged (R3.4).** A `snippet` with `runnable: true` calls
  `getRuntime(language).run({ language, code, tests: [], fixture, timeoutMs: 5000, packages })` — the same free-run path the exercise Run button already uses. A `micro-code` check calls the same adapter with its two or three visible tests. `web`, `sql` and `mongo` snippets carry their `fixture` exactly as an exercise does. **Java snippets are static** (§3 C1) and say so in one honest line. While a runtime is warming, show **real progress**, never a spinner alone.

- [ ] **Step 4: checks.** Every kind from T1.2, graded in place with a verdict in **under 120 ms** for the non-`micro-code` kinds. Unlimited attempts. First wrong reveals `hint`; second reveals `explain`. `lesson_progress` writes are fire-and-forget through `optimistic()`; a failed write is queued for the next mount and **never** reverts a check the learner actually answered.

- [ ] **Step 5: accessibility — two named gaps the spec's critic caught, both review items.**
  - **`spot-the-bug` is not click-only.** Every code line is a focusable control whose accessible name is the line number and its text; arrow keys move between lines; Enter selects. A mouse is never required.
  - **A verdict is never carried by colour alone.** Right pairs `--success` with a check glyph **and the word "Right"**; wrong pairs amber with a distinct glyph **and the words "Not yet"**. This is also what makes the two states legible in Arcade, where both tokens are saturated. The verdict is announced in an `aria-live="polite"` region so a screen-reader user is told the outcome without moving focus, and the `hint` and `explain` reveals follow it **in DOM order**, never injected above the learner's position.

- [ ] **Step 6: motion (§10.5), all of it reading `useReducedMotion()`.** Blocks reveal on scroll into view, once, 8 px rise and fade over 300 ms on the enter curve. Worked-example steps advance on click or Enter: the previous callout fades to 40 %, the highlight band slides to the new lines on the move curve over 200 ms. A right check draws its checkmark; a wrong check settles amber with one 4 px shake. The bridge card slides up at the end. **No looping motion anywhere** — this is a reading surface. Under reduced motion (R7.9): reveals render immediately at full opacity with no transform and no `IntersectionObserver` gating, the shake does not play, and the verdict is unchanged.

- [ ] **Step 7: sound.** `drill.hit` on a right check (light), `drill.miss` on a wrong one (soft and low, never harsh), `pass` at 70 % volume when the walkthrough is finished. Both check sounds are **interface tier**, so they are silent by default — the visible channel carries them.

- [ ] **Step 8: `loading.tsx`** — the shape of the page: rail, hook, concept block, code block. Not a spinner, not a grey sentence. This also turns router prefetching on for the route (a dynamic route without `loading.js` is not prefetched by `<Link>` at all).

- [ ] **Step 9: states** — loading skeleton, in-progress, check-pending, check-right, check-wrong (hint), check-explained, complete, skipped, draft marker, runtime warming, Java-static notice, and the shared `<ErrorRetry>` for a failed bundle fetch.

**Acceptance**
```bash
npx vitest run src/components/lesson "src/app/(app)/lesson"
npx vitest run          # green
npm run build           # /lesson/[cloId] appears in the route list
```
Component tests must cover: the golden lesson renders every block type in order; a wrong `predict-output` reveals the hint and the second wrong reveals the explain; the verdict text is announced through `aria-live`; every `spot-the-bug` line is reachable by keyboard; **`callAgent` is never called** (spy) across a full open-to-complete run including every check kind answered right and wrong; under reduced motion no `IntersectionObserver` is constructed and every block is present at full opacity on first render.

**Existing tests it may change:** none.
**Review (Opus):** zero agent calls (this is the surface most likely to grow one); the editor is dynamic and single-grammar; every verdict has a glyph and a word; keyboard-only completion of a whole lesson is possible; nothing loops; `lesson_progress` failure never loses a learner's answered check.
**Commit:** `git add src/components/lesson "src/app/(app)/lesson" && git commit -m "feat(lesson): the walkthrough screen - concept, worked example, local checks, recap, bridge"`

---

### T1.4 — Course home and the path map

**Model:** Sonnet. **Review:** Opus (accessibility items named).
**Depends on:** W0

The centrepiece of the new product. A course now opens here, not on "Next exercises".

**Files**
- Create: `src/app/(app)/course/[code]/page.tsx`, `loading.tsx`, `page.test.tsx`
- Create: `src/components/course/PathMap.tsx`, `NodeItem.tsx`, `NextUpStack.tsx`, `CourseFlatList.tsx`, `course.test.tsx`
- Create: `src/lib/course/map.ts`, `src/lib/course/map.test.ts`

**Interfaces produced**
```ts
// src/lib/course/map.ts — every node state is a pure derivation of data that already exists
export type NodeState = 'locked' | 'available' | 'walkthrough-ready' | 'in-progress' | 'locked-in'
export interface MapNode {
  cloId: CloId; title: string; ordinal: number
  state: NodeState; chain: number; closed: boolean; draft: boolean
  /** In-course prerequisites only. Out-of-course ones are advisory and never gate. */
  prerequisites: CloId[]
  /** Drawn faint, labelled "comes from another course", never gating. */
  externalPrerequisites: CloId[]
}
export function buildMap(args: {
  clos: readonly Clo[]; code: CourseCode
  mastery: LearnerState['mastery']; lessonProgress: readonly LessonProgress[]
}): MapNode[]
/** First CLO in path order whose mastery is not closed; the last one when all are closed. */
export function currentCloId(path: readonly CloId[], mastery: LearnerState['mastery']): CloId | null
export function nextUp(args: { … }): NextUpCard[]   // always exactly three
```

- [ ] **Step 1: node states, and the three corrections that would otherwise ship as bugs.**

| State | Derivation |
|---|---|
| Locked | some prerequisite CLO **that is in this course** is not `closed` |
| Available | prerequisites closed, `chain === 0`, not `closed` |
| Walkthrough ready | Available **and** there is no `lesson_progress` row for this lesson, or one with `status = 'started'` |
| In progress | `chain > 0 && !closed` |
| Locked in | `closed === true` |
| Draft | `clo.draft === true` — muted, "drafted" marker, **still usable** (the 22:33 ruling) |

  1. `Clo.draft` is a real field now (T0.1 item 14) — read it, do not invent a parallel row type.
  2. **`unseen` is not a status.** The `lesson_progress` check constraint is `('started','completed','skipped')`; unseen is the *absence* of a row, and the derivation says so.
  3. **Locked ignores cross-course prerequisites.** `Clo.prerequisites` crosses course boundaries in the shipped seed (`INFS1201-1` lists `INFS1101-4`). Under the naive rule, a learner whose first course is INFS1201 sees **every node permanently locked**. Out-of-course prerequisites are advisory: draw them as a faint inbound edge labelled "comes from another course", and never gate on them.

- [ ] **Step 2: the "Next up" stack is always exactly three cards (R3.8).**
  - If the current CLO has no `lesson_progress` row, or one with `status = 'started'`: card 1 is **Walkthrough — {title}**; cards 2 and 3 are the Planner's first two `nextExerciseIds`, at **full opacity**, with a one-line "after the walkthrough, or skip it" caption. Nothing is disabled.
  - Otherwise the three cards are `LearnerState.nextExerciseIds` in Planner order.
  - If `nextExerciseIds` is short (fresh account, bank widening), fill from `pickFromBank` **locally** against the bundle and mark the card "picked for you". Never render an empty slot, and **never wait on an agent to render**.

- [ ] **Step 3: accessibility — the map is a progressive enhancement over a real list.** The DOM is an **ordered list of links** in `path` order. Each item's accessible name is the skill plus its state plus its progress ("Loops that stop when you tell them to — in progress, 2 of 3"). Prerequisite relationships are exposed with `aria-describedby` pointing at the prerequisite item, which is what an edge *means*. Tab moves through nodes in path order; Enter opens. The SVG edges are `aria-hidden` decoration drawn on top. **Node state is never carried by colour alone** — locked, available, in-progress and locked-in each get a distinct shape or fill pattern as well as a token, because six states across four themes cannot be told apart by hue by every learner. The collapsed "everything in this course" flat list stays, and it is the same data, not a second implementation.

- [ ] **Step 4: motion (§10.4).** Nodes stagger along the path on first paint, 30 ms apart, capped at 300 ms total. A node that just locked plays its fill **once** and then stays lit permanently. Hovering a node lifts it 2 px and **prefetches its walkthrough and its first rep**. Edges draw once on first visit only (`stroke-dashoffset`, 600 ms), never again. Under reduced motion (R7.9): no stagger, edges render complete, no hover lift.

- [ ] **Step 5: the 13-inch check (change-log open item 1).** The map, the three-card stack and the collapsible list must all be usable at **1280×800 at 100 % zoom with the dock expanded**. This is a named acceptance item with a screenshot in the commit body, not a hope.

- [ ] **Step 6: zero round trips.** Everything on this screen comes from the static bundle plus the SSR-seeded learner state. No Supabase read fires on mount.

**Acceptance**
```bash
npx vitest run src/lib/course src/components/course "src/app/(app)/course"
npx vitest run          # green
npm run build
```
Unit tests must include the three corrections above by name: a learner whose only course is INFS1201 sees available nodes, not a wall of locked ones; a CLO with no progress row is `walkthrough-ready`, not `unseen`; a drafted CLO renders with the marker and is still openable. Plus: `nextUp` returns exactly three cards for an empty `nextExerciseIds`; `currentCloId` returns the last CLO when everything is closed; no `fetch` to Supabase on mount (spy).

**Existing tests it may change:** none.
**Review (Opus):** the DOM is a list, not a canvas; every node is keyboard-reachable in path order; state is carried by shape as well as colour; out-of-course prerequisites never gate; zero Supabase reads; the 1280×800 screenshot is attached.
**Commit:** `git add src/lib/course src/components/course "src/app/(app)/course" && git commit -m "feat(course): course home with the path map, next-up stack and flat list"`

---

### T1.5 — Onboarding once: six local questions

**Model:** Sonnet. **Review:** Opus.
**Depends on:** W0

The cause, named so nobody re-diagnoses it: `onboarding/page.tsx:47` initialises `stage` to `'question'` unconditionally and **never reads `profile.onboardingComplete`**, which the same file sets at `:158`. Both dashboard entry points link straight there. And each of up to thirteen questions costs one blocking, non-streamed DeepSeek call behind ~4 server round trips, while the whole flow is already computable client-side with zero model calls.

**Files**
- Create: `src/lib/onboarding/questions.ts`, `src/lib/onboarding/derive.ts`, `src/lib/onboarding/derive.test.ts`, `src/lib/onboarding/questions.test.ts`
- Edit: `src/app/(app)/onboarding/page.tsx`, `src/app/(app)/onboarding/lib.ts`, `src/app/(app)/onboarding/page.test.tsx`
- Create: `src/app/(app)/onboarding/loading.tsx`

**Interfaces produced**
```ts
// src/lib/onboarding/questions.ts — the whole flow ships in the bundle
export interface OnboardingQuestion { id: string; phase: 1 | 2; text: string; options: { label: string; value: string }[] }
export const QUESTIONS: readonly OnboardingQuestion[]   // exactly 6: p1q1..p1q4, p2q1, p2q2
export const MAX_QUESTIONS = 6

// src/lib/onboarding/derive.ts — pure, moved out of the agent module so the client can call it
export function styleFromAnswers(answers: { questionId: string; answer: string }[]): Pick<LearnerProfile, 'styleVector' | 'learningStyle'>
export function motivationFromAnswers(answers: { questionId: string; answer: string }[]): Pick<LearnerProfile, 'motivation' | 'tone'>
export function provisionalProfile(answers: { questionId: string; answer: string }[]): WorkingProfile
```

- [ ] **Step 1: the six questions, all local.**

| # | Phase | Question | Options | Feeds |
|---|---|---|---|---|
| 1 | 1 | "A new idea lands better as…" | a diagram / a paragraph | `styleVector.visual`/`verbal` |
| 2 | 1 | "Show me…" | a worked example first / the rule first | `styleVector.example`/`theory` |
| 3 | 1 | "When something breaks you…" | read the code / read the error | `styleVector.verbal`, `learningStyle` |
| 4 | 1 | "You'd rather…" | watch it run / reason it out on paper | `styleVector.visual`/`theory` |
| 5 | 2 | "Why are you here?" | pass the course / actually understand this / get good enough to build things | `motivation.why`, `motivation.depth` |
| 6 | 2 | "How should this thing talk to you?" | hype me up / keep me steady / push me hard / just the facts | `tone` |

  `MAX_QUESTIONS` becomes **6**. The `p1q*` / `p2q*` id prefixes are preserved so the Profiler's own id-prefix counting (fixed in C1 round 4) still works. Cut and defaulted: `verbosity: 'short'`, `motivation.beyondCourses: false`, `motivation.wantsAgenticCoding: false` — all three editable in Account under "How the Bro talks", and the Buddy offers the `beyondCourses` question once, after the third session, in conversation, **never as a gate**.

- [ ] **Step 2: `questions.test.ts` — the anti-drift test.** Assert `QUESTIONS`' ids and text stay identical to `src/lib/agents/fixtures/profiler-fallback.json` plus the hardcoded phase-2 set in `src/lib/agents/profiler.ts:53-60`, so the local bank and the agent's own fallback can never drift apart.

- [ ] **Step 3: `derive.ts` — move, do not rewrite.** `styleFromAnswers` and the phase-2 switch are already pure in `profiler.ts:70-101`. Move them into `src/lib/onboarding/derive.ts` and have `profiler.ts` import them, so the client can call them without importing the agent module and there is still exactly one implementation. *(This is the one edit T1.5 makes inside `src/lib/agents/` — a re-export, no behaviour change. T2.10 owns the rest of that directory in a later wave, so there is no conflict.)*

- [ ] **Step 4: answers apply in the same frame (R4.2).** Tapping a card applies the answer to a provisional profile through the pure scorer and renders the next card **in the same frame**. There is **no busy state between cards, ever**. No spinner, no "thinking", no network.

- [ ] **Step 5: one Profiler call, at the end, non-blocking (R4.2).** On the sixth answer:
  1. the provisional profile is complete and in the Zustand session store;
  2. the UI advances straight to the course picker — **no spinner**;
  3. in the background, **one** `callAgent({ agent: 'profiler', trigger: 'onboarding-answer', phase: 2, answers: <all six, cumulative> })` fires — the contract already models this: `ProfilerRequest.answers` is cumulative and `phase` is a plain discriminator;
  4. on success the reply's `profileDelta` is merged over the provisional profile (motivation merged **key by key**, never replaced — the contract's own note). If `tone` or `learningStyle` changed, nothing visible happens; the next agent call simply carries better values;
  5. on failure, timeout, rate-limit, or `AGENT_DRY_RUN`, **the provisional profile stands**. `onboardingComplete` is set to `true` either way, in the same `learner_state` write.

- [ ] **Step 6: the redirect (R4.4).** `/onboarding` reads `session.learnerState.profile.onboardingComplete` **on mount** and `redirect`s to `/courses` when true. The Profiler questionnaire runs **once per account, ever**.

- [ ] **Step 7: motion (§10.2).** Card exits left, next enters from the right on the move curve, 200 ms — direction matches progress, which is what makes it read as forward motion. The chosen option gets a 120 ms fill before the exit. Six-dot progress row. Under reduced motion: a cross-fade, no slide.

**Acceptance**
```bash
npx vitest run src/lib/onboarding "src/app/(app)/onboarding"
npx vitest run          # green
```
Tests must assert: exactly six questions; **zero** `callAgent` invocations across questions one through five (spy); exactly **one** on the sixth; the sixth answer advances to the course picker **without awaiting** that call (resolve the spy's promise only after asserting the stage changed); a rejected Profiler call still completes onboarding with the provisional profile and `onboardingComplete: true`; mounting with `onboardingComplete: true` redirects to `/courses` and renders no question.

**Existing tests it may change:** `src/app/(app)/onboarding/page.test.tsx` — substantially. This is the one existing test file in the plan that may be **rewritten**, because the flow it tests is being replaced. Every behavioural guarantee it currently asserts that still applies (profile merge semantics, learner-state write shape, error recovery) must survive into the new file; list them in the commit body.
**Review (Opus):** exactly one agent call in the whole flow; no `await` between a tap and the next card; the anti-drift test genuinely compares against the fallback fixture; the redirect cannot loop; `onboardingComplete` is written on both the success and the failure path.
**Commit:** `git add src/lib/onboarding "src/app/(app)/onboarding" src/lib/agents/profiler.ts && git commit -m "feat(onboarding): six local questions, one background Profiler call, once per account"`

---

### T1.6 — `/courses`, the optimistic course switch, and the proxy matcher

**Model:** Sonnet. **Review:** Opus.
**Depends on:** W0

**Files**
- Create: `src/app/(app)/courses/page.tsx`, `loading.tsx`, `page.test.tsx`
- Create: `src/components/course/CourseCard.tsx`
- Create: `src/lib/learner/provisional.ts`, `src/lib/learner/provisional.test.ts`
- Edit: `src/proxy.ts`, `src/lib/supabase/middleware.ts`, `src/app/(app)/dashboard/page.tsx` (**link targets only** — the data layer is T2.1's)

**Interfaces produced**
```ts
// src/lib/learner/provisional.ts — pure, unit-tested, zero network
export function provisionalPlan(args: {
  code: CourseCode
  clos: readonly Clo[]
  exercises: readonly ExercisePublic[]
  mastery: LearnerState['mastery']
}): { path: CloId[]; nextExerciseIds: string[] }
```

- [ ] **Step 1: `provisionalPlan`.**
  - `path` = the course's CLOs in `ordinal` order (already prerequisite-respecting in the seed). The function still topologically sorts on `Clo.prerequisites` and falls back to ordinal on a cycle — and, per §10.4's correction, **it sorts on in-course prerequisites and ignores dangling external ids** rather than treating them as a cycle.
  - `nextExerciseIds` = `pickFromBank` (the existing widening-tier selector) against the first non-closed CLO at `DEFAULT_DIFFICULTY`, three distinct patterns.

- [ ] **Step 2: the switch, in order — all client-side except one background call (R4.4).**
  1. The learner taps a course card. **Optimistic navigation to `/course/{code}` in the same frame.**
  2. `provisionalPlan()` computes a path and three next exercises from data already in the bundle.
  3. The path map, the Next-up stack and the walkthrough card render immediately from that.
  4. One `plan-refresh` call to the Planner fires **in the background** with the course's CLOs and the pre-fetched candidates — exactly the existing contract, exactly one of the seven triggers.
  5. On return, reconcile. If the order or the three ids actually changed, one quiet toast: "Path tuned." If nothing changed, **say nothing**.
  6. `learner_state` is written **once**, with the version guard, carrying whichever plan is final.

  If the Planner fails, the provisional plan is kept and persisted. **A course is never unusable because a model call failed.**

- [ ] **Step 3: switching never resets progress (R4.5).** `mastery`, `points`, both streaks, achievements and `lesson_progress` are account-level and course-keyed. Switch away and back and everything is where it was. A test asserts this against a state with progress in two courses.

- [ ] **Step 4: the screen (§10.7).** Every live course as a card: title, language, level, your progress ring, and whether you have a path there. `coming-soon` courses shown **honestly, disabled, with the reason**. States: normal; switching (optimistic — navigation already happened); planner-refining (a one-line dismissible "tuning your path" chip, never blocking); planner-failed (silent). Cards stagger in at 40 ms; the chosen card scales to 0.98 on press. **No spinner** — the switch is optimistic by construction.

- [ ] **Step 5: the proxy matcher (§3 C3).** `src/proxy.ts` currently does not match `/account`, so session refresh and the ban/restrict gate never run there. Add `/account/:path*`, `/course/:path*` and `/lesson/:path*`:
```ts
matcher: [
  '/dashboard/:path*', '/onboarding/:path*', '/courses/:path*', '/course/:path*',
  '/lesson/:path*', '/exercise/:path*', '/derot/:path*', '/reports/:path*',
  '/account/:path*', '/admin/:path*', '/login', '/auth/:path*',
],
```
  In `src/lib/supabase/middleware.ts`, extend the restricted-route rule so a restricted learner keeps **dashboard, walkthroughs and De-rot** and loses only `/exercise` — which is exactly what the restricted screen's copy promises. Anything the copy promises and the gate takes away is a lie in the product.

- [ ] **Step 6: dashboard links.** "Change course" and "Review your course" point at `/courses`. Nothing else in that file is touched — T2.1 owns it next wave.

**Acceptance**
```bash
npx vitest run src/lib/learner/provisional.test.ts "src/app/(app)/courses"
npx vitest run          # green
npm run build           # /courses and the new matcher entries in the route list
npx playwright test     # existing flows still pass with the new matcher
```
Tests must assert: a tap navigates before any promise resolves (spy on `router.push`, resolve the Planner afterwards); exactly one `callAgent` with `trigger: 'plan-refresh'`; a rejected Planner leaves the provisional plan persisted; switching to a second course and back preserves the first course's mastery and points; a `coming-soon` card is not clickable and states its reason; **the Profiler is unreachable** from `/courses` (no route or handler on the page can reach `/onboarding`).

**Existing tests it may change:** `src/lib/supabase/middleware.test.ts` — additions for the new matcher and the restricted-route rule. `src/app/(app)/dashboard/page.test.tsx` — link-target assertions only.
**Review (Opus):** exactly one agent call; the write is a single versioned `learner_state` write, not two; the restricted gate matches the restricted copy; `/account` is now behind the proxy; no progress reset on switch.
**Commit:** `git add "src/app/(app)/courses" src/components/course/CourseCard.tsx src/lib/learner/provisional.ts src/lib/learner/provisional.test.ts src/proxy.ts src/lib/supabase/middleware.ts src/lib/supabase/middleware.test.ts "src/app/(app)/dashboard/page.tsx" && git commit -m "feat(courses): optimistic course switch with a provisional plan; proxy covers account, course and lesson"`

---

### Wave 1 gate

```bash
npx tsc --noEmit && npx eslint src
npx vitest run                                     # >= 840 + W0 + W1 additions, all green
for f in seed/lessons/*.json; do node scripts/verify-lesson.mjs "$f" || exit 1; done
node seed/validate.mjs
node scripts/build-static-curriculum.mjs --check
npm run build
npx playwright test
```
Manual, against the dev server: a brand-new account gets **six** questions, each advancing in the same frame, with no loading state between cards; the course picker appears with no wait; picking a course paints the course home **immediately** with a map and three cards; the first card is a Walkthrough and it teaches; switching courses **never** asks a profiler question again and progress survives the round trip.

Record in `docs/build-log.md`; tick the W1 rows; `git push origin main`.

---

## Wave 2 — It feels fast, alive and honest

The biggest wave. Every screen moves onto Query with optimistic mutations and a shape-matched skeleton; the rail becomes a dock the learner places; XP, levels, streaks, achievements and celebrations land; De-rot splits into two lanes; the lockdown starts telling the truth; and the Bro's voice reaches every string.

**Groups.**
- **A (parallel, immediately):** T2.5 (rewards math), T2.7a (voice bank), T2.8 (lockdown + integrity), T2.9a (Arcade), T2.10 (agent identity), T2.4 (dock).
- **B (parallel, after A's named dependencies commit):** T2.1 (layout + dashboard), T2.2 (exercise loop), T2.3 (reports + account), T2.6 (celebration components), T2.9b (Playground games), T2.11 (buddy).
- **C (serial, last, after every other W2 task commits):** T2.7b (the copy sweep).

**De-rot is in this wave on purpose.** The literal wave list in the brief does not name it, but the owner's addendum ("de-rot is super rotting, it's so boring") is one of the complaints v2 exists to answer, its contracts landed in W0's PR, and its rewards share T2.5's math. Leaving it to a later wave would ship a rewards layer that half the product cannot reach.

---

### T2.1 — Data layer: `(app)/layout.tsx` and the dashboard

**Model:** Sonnet (**Codex-preferred**). **Review:** Opus.
**Depends on:** T0.4, T1.6, T2.5

**The cause, so nobody re-diagnoses it.** Ten serial hops before the dashboard paints (`(app)/layout.tsx:13,24,35-44,45-48`; `src/proxy.ts:9-12`); an **unbounded** attempts pager at `:35-44`; a duplicate `auth.getUser()` when the proxy already proved identity and forwards it in internal headers; and no `loading.tsx`, so Next never prefetches a single link.

**Files**
- Edit: `src/app/(app)/layout.tsx`, `src/app/(app)/layout.test.tsx`
- Edit: `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/dashboard/page.test.tsx`
- Create: `src/app/(app)/dashboard/loading.tsx`

- [ ] **Step 1: delete the pager, add the bounded read (R5.2 + R5.2a).** Remove the `activityDates()` loop entirely. Streaks now come from `learner_state` plus **one** `my_activity_days(120)` RPC, seeded into `['activity-days', userId]` with `staleTime: Infinity` and invalidated by the attempt and drill mutations. This matters and is not cosmetic: a 50-row attempts window is about sixteen days at three reps a day, so without the RPC a 30-day streak is unverifiable, the `thirty` achievement is unreachable, and the open bug from the build log at 23:29 ("hydrated streaks never expire in the (app) layout") comes straight back.

- [ ] **Step 2: delete the duplicate `getUser()`.** The proxy already validated the session and forwards `x-brogram-account-status`, `x-brogram-restricted-until` and `x-brogram-pathname`. Forward the user id the same way and read it from headers. Keep every gate: banned → `/auth/signout`; restricted + `/exercise` → `/dashboard`.

- [ ] **Step 3: cap attempts at 50, newest first,** and seed `['attempts', userId]`, `['learner-state', userId]`, `['wellness', userId]`, `['lesson-progress', userId]`, `['achievements', userId]`, `['activity-days', userId]` through `<QuerySeed>`.

- [ ] **Step 4: the dashboard becomes "Today" (§10.3).** Server-rendered above the fold, no client fetch:
  - **Resume card first** — the exercise or walkthrough in flight, with elapsed context ("you were 2 of 3 into {skill}");
  - streak flame with today's status — kept, at risk (after 18:00 local with no rep), or reset;
  - the daily-goal ring;
  - Next up, three cards, by §10.4's rules;
  - the level bar with XP and the last three trophies;
  - the De-rot entry with its own streak;
  - one Buddy prompt line.
  Every `useEffect` + `useState` fetch trio in this file is replaced by a Query hook.

- [ ] **Step 5: `loading.tsx`** — shape-matched: resume card, flame, ring, three cards, level bar. This is what turns on `<Link>` prefetching for every route the dashboard links to.

- [ ] **Step 6: the prefetch ladder (§5.4).** On mount, the curriculum resolves from the bundle (zero requests) and `requestIdleCallback` (with a `setTimeout(…, 1)` fallback) warms the runtime for the **top Next-up card's language**. `<Link>` prefetches all three exercise routes as they enter the viewport. Hover or keyboard focus on a card warms that card's runtime (`warmup()` is documented idempotent and the adapter is cached per language for the session, so an early warmup is never wasted) and prefetches the route. Hover on a path-map node prefetches its walkthrough and first rep.

- [ ] **Step 7: honest scoping of the warmup claim (R5.4).** Moving warmup to dashboard idle removes the cold start on broadband and shortens it on a slow link. It does **not** guarantee a warm runtime: on the throttled profile §5.6 measures against, a 10 MB Pyodide fetch is not hidden by 3–8 seconds of idle. The exercise screen keeps its real-progress warming state, and "first Run of a session is not user-visible" is **not** a CI-gated budget. Also apply R5.4's second half: `warmup()` starts the active worker and schedules the standby at the **next idle callback** rather than in the same tick, halving the cold-start network burst without weakening the terminate-and-promote guarantee.

**Acceptance**
```bash
npx vitest run "src/app/(app)/layout.test.tsx" "src/app/(app)/dashboard"
npx vitest run && npm run build
```
Tests must assert: **zero** Supabase reads fire from the dashboard component on mount (the layout seeded everything); the layout issues at most three round trips (proxy claims, one profile read forwarded in headers, one `learner_state` read) plus the one `my_activity_days` call; no unbounded loop remains (grep for `range(` in the file); a 30-day streak derived purely from `my_activity_days` is correct; a stored streak whose last activity is older than yesterday **expires**.

**Existing tests it may change:** `src/app/(app)/layout.test.tsx`, `src/app/(app)/dashboard/page.test.tsx` — both substantially, because both test the fetch shape being replaced. Every behavioural guarantee they assert (auth gates, ban redirect, restricted redirect, streak expiry, draft-CLO rendering) must survive; list each in the commit body.
**Review (Opus):** round-trip count asserted, not claimed; every gate still fires; the streak can still expire; the idle warmup does not run on a route that is not the dashboard; `loading.tsx` matches the real shape closely enough that nothing shifts on hydration (CLS ≤ 0.05).
**Commit:** `git add "src/app/(app)/layout.tsx" "src/app/(app)/layout.test.tsx" "src/app/(app)/dashboard" && git commit -m "perf(dashboard): query-backed layout, bounded activity days, skeleton, idle warmup"`

---

### T2.2 — The optimistic submit path

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.4, T2.5, T2.6

**The cause.** Eight serial stages sit between local grading and the word "Passed" (`useExerciseLoop.ts:267-341`), and `next()` does a full `router.push` that discards the already-fetched next exercise (`:264` versus `:437-441`), throwing away the warm runtime and the mounted editor.

`useExerciseLoop.ts` sits on the seam between lanes and is edited in this wave **by this task only**.

**Files**
- Edit: `src/hooks/useExerciseLoop.ts`, `src/hooks/useExerciseLoop.test.tsx`
- Edit: `src/app/(app)/exercise/[id]/page.tsx`, `src/app/(app)/exercise/[id]/page.test.tsx`
- Create: `src/app/(app)/exercise/[id]/loading.tsx`

- [ ] **Step 1: the new `'graded'` status.** `type Status` gains `'graded'` between `'running'` and `'submitting'`. **The browser knows pass or fail the instant `getRuntime().run()` resolves**, so that is where the results panel, the pass/fail verdict, the XP delta, the chain pip, the mastery bar and the celebration all render. The existing `finishSubmission()` chain runs untouched in the background.

- [ ] **Step 2: the XP reconciliation, labelled.** The optimistic figure uses the neutral `quality = 70` already used on reload. When the Reviewer's real quality lands, the counter tweens the delta — **+15 at best, −35 at worst**, because `pointsForPass` adds `round(quality/100 * 50)` and neutral 70 is +35. Since the worst case is a **visible drop**, the provisional number carries a hairline under it until the Reviewer answers, so a falling counter reads as a result arriving and never as points being taken away.

- [ ] **Step 3: no rollback for the verdict.** Pass or fail is a **true local computation**, not a guess, so it is never rolled back. If the background save fails, a "didn't save, retrying" banner appears and **the result stands**.

- [ ] **Step 4: `next()` stops remounting.** Swap state in place under a `<ViewTransition>` on the **prompt panel only**, and update the URL with `router.replace` semantics. The editor and the warm runtime survive. **No route transition ever wraps `/exercise/[id]`** — remounting the editor or the runtime worker mid-transition is precisely the cost being removed.

- [ ] **Step 5: the hint path.** Already optimistic (spent and persisted before the await, streamed partials). Add: the hint card's skeleton appears on click and the "hints left" pip decrements in the same frame. The existing refund-only-if-zero-frames logic is untouched.

- [ ] **Step 6: one read, or two (R5.1b).** Resolve the exercise id against the memoised static course bundle first; fall through to a single `exercises_public` read only when the id is not there, which is exactly the runtime-generated case (`origin='generated'`, author-scoped, never in a shared static file). A learner in a well-stocked CLO pays 1; a learner on a freshly authored variant pays 2.

- [ ] **Step 7: the editor goes lazy and single-grammar.** `Editor` becomes `next/dynamic` with `ssr: false` and a **skeleton with the real chrome, not a sentence**; CodeMirror loads one grammar per exercise through a `Record<Language, () => Promise<Extension>>` and a compartment reconfigure.

- [ ] **Step 8: juice at the transition, silence during composition.** Pass fires the checkmark draw, the XP tween, the chain pip and the `pass` sound; **confetti only on the session's first pass, on a chain tick reaching 3, and on a milestone** — a routine pass gets the checkmark and the counter, because the twentieth confetti of a session is what makes the first one worthless. Fail plays `fail` (soft, neutral, never a buzzer) and shakes **only the failing test row**, then slides calmly into the fix plan. Nothing animates or sounds while the learner is typing.

- [ ] **Step 9: delete the standing surveillance label.** Remove the permanent grey "Type your own work" text pinned to the editor header (`exercise/[id]/page.tsx:54`). *Owned here rather than in T2.8 because this task owns the file;* T2.8 depends on it being gone. Standing surveillance labels change nothing and cost trust — the rule is stated once in the walkthrough and once in the Integrity panel, and the toast says it when it actually matters.

- [ ] **Step 10: `loading.tsx`** — prompt panel, editor chrome, results panel, all at real size.

**Acceptance**
```bash
npx vitest run src/hooks/useExerciseLoop.test.tsx "src/app/(app)/exercise"
npx vitest run && npm run build
```
Tests must assert: `'graded'` is reached **before** any network call resolves (spy on the Supabase insert and resolve it late); XP renders at neutral quality and then tweens to the Reviewer's value, including a **downward** case; a failed attempt insert leaves the verdict intact and shows the retry banner; `next()` does not remount the editor (assert the editor instance identity survives); a seed exercise costs one read and a generated one costs two; the existing seven-trigger spy still passes unchanged.

**Existing tests it may change:** `src/hooks/useExerciseLoop.test.tsx` and `src/app/(app)/exercise/[id]/page.test.tsx` — **additions plus status-name updates**. The agent-trigger spy test, the hint cooldown tests, the retry-deduplication test and the stale-mastery test must all survive unchanged in intent.
**Review (Opus):** the verdict is never rolled back; no agent call moved earlier or later; the hint quota still survives a reload; the editor does not remount on `next()`; confetti is rate-limited; nothing animates during typing.
**Commit:** `git add src/hooks/useExerciseLoop.ts src/hooks/useExerciseLoop.test.tsx "src/app/(app)/exercise" && git commit -m "perf(exercise): optimistic graded status, in-place next, lazy single-grammar editor"`

---

### T2.3 — Data layer: Progress and Account

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.4, T2.5, T2.6, T2.8 (`IntegrityPanel`)

**Files**
- Edit: `src/app/(app)/reports/page.tsx`, `data.ts`, `page.test.tsx`, `data.test.ts`
- Edit: `src/app/(app)/account/page.tsx`, `page.test.tsx`
- Create: `src/app/(app)/reports/loading.tsx`, `src/app/(app)/account/loading.tsx`

- [ ] **Step 1: `/reports` gets its own narrow query.** `['report-attempts', userId]`, capped at **1000**, fetched only when the Report tab is opened, selecting `id, exercise_id, passed, duration_ms, hint_count, created_at` — **never `code`, never `results`**. Today the page pulls the full attempt history including both.

- [ ] **Step 2: two tabs (§10.10).** **Trophies**: the twenty achievement cards; unlocked ones lit with their date, locked ones stating their rule. Nothing is a mystery box — `visibleWhenLocked` is `true` for all twenty and a locked card that hides its rule is a dark pattern. **Report**: the existing mastery, angles, mistake trend, time spent, de-rot scores, Planner focus line and PDF export, unchanged in substance.

- [ ] **Step 3: `/account` gets the "Make it yours" panel first (§10.11)** — theme swatches, dock placement, dock collapse, compact-on-exercise, sound on/off and volume, **interface sounds**, motion preference, daily goal. Then "How the Bro talks" (tone, verbosity, depth, beyond-courses — the three cut from onboarding live here). Then **Integrity explained** (mount T2.8's `<IntegrityPanel/>`). Then **Diagnostics** (T3.2's local web-vitals ring buffer). Then password change and sign-out. Scattering these across three settings pages is what made them invisible in v1.

- [ ] **Step 4: every control is optimistic.** Prefs apply to local state and `localStorage` in the same frame — **zero network wait, ever, for a toggle** — with a 400 ms debounced write-through to `wellness.prefs`. A toast on repeated failure only; **never revert a toggle under the learner's finger**.

- [ ] **Step 5: skeletons** for both routes, shape-matched.

- [ ] **Step 6: motion.** Trophy cards stagger in at 30 ms; a trophy unlocked in this session gets one entrance flourish and then sits still. The Report tab is a document: no motion beyond the tab indicator. The theme switch is instant with transitions suppressed during the swap.

**Acceptance**
```bash
npx vitest run "src/app/(app)/reports" "src/app/(app)/account"
npx vitest run && npm run build
```
Tests must assert: the report query never selects `code` or `results` (assert the select string); it does not fire until the Report tab is opened; every locked trophy renders its `how` text; a prefs toggle updates the UI **before** the mutation resolves and does not revert when it rejects; the Account page is reachable and gated (it is now behind the proxy — §3 C3).

**Existing tests it may change:** `src/app/(app)/reports/page.test.tsx`, `data.test.ts`, `src/app/(app)/account/page.test.tsx` — additions and fetch-shape updates. The PDF export tests must survive unchanged.
**Review (Opus):** no wide select remains; the trophy shelf cannot show a mystery box; every pref is optimistic; Diagnostics reads a local ring buffer and posts nothing anywhere.
**Commit:** `git add "src/app/(app)/reports" "src/app/(app)/account" && git commit -m "feat(progress,account): trophies tab, narrow report query, Make it yours panel"`

---

### T2.4 — The wellness dock

**Model:** Sonnet (**Codex-preferred**). **Review:** Opus.
**Depends on:** W0 (`WellnessDockPrefs`, `resolveWellnessPrefs`, `ShellLayout`, `useSecondTick`)

**The cause.** `AppShell.tsx:46-50` welds the rail into a fixed right grid column; `Rail.tsx` accepts only a `compact` boolean; **there is no position concept anywhere in the stack**; and the rail re-renders at 1 Hz on every page (`Rail.tsx:30-37,120`).

**Files**
- Edit: `src/components/wellness/Rail.tsx` → renamed `Dock.tsx` (plus `Rail.test.tsx` → `Dock.test.tsx`), `PrayerTimes.tsx`, `WaterStretch.tsx`, `Pomodoro.tsx` and their tests
- Edit: `src/components/shell/ShellLayout.tsx`, `src/components/shell/WellnessSlot.tsx`, `src/components/shell/DockControl.tsx`
- Edit: `src/lib/wellness/prayer.ts`
- Create: `src/lib/wellness/dock.ts`, `src/lib/wellness/dock.test.ts`

- [ ] **Step 1: five placements (R6.1), and placement is a real layout decision, not a class swap.**

| Placement | Layout | Renderer |
|---|---|---|
| `right` (default) | shell grid column 2, 280 px, sticky, full height | vertical |
| `left` | shell grid column 0, 280 px, sticky, full height | vertical, mirrored, same component |
| `top` | full-width strip under the header, 56 px | horizontal — reuses the existing compact renderer (`Rail.tsx:195-204`), which already lays out as a wrapping row |
| `float` | fixed floating pill, movable to any corner, corner persisted | pill, then popover |
| `hidden` | not rendered | none — the `DockControl` glyph stays in the header and restores the previous placement. **Never a dead end.** |

  `left`/`right` change the shell's grid template; `top` changes the shell to a rows layout; `float` renders into a portal outside the grid. All four render the same `<Dock>` with `orientation: 'vertical' | 'horizontal' | 'pill'`.

- [ ] **Step 2: collapse (R6.2, §6.2).** One toggle in the dock header, persisted as `dock.collapsed`. Vertical collapsed becomes a 56 px icon rail — prayer glyph with the next-prayer countdown, water glyph with today's count, pomodoro ring — with hover or focus revealing the full label. Horizontal collapsed becomes one line: next event plus a chevron. Pill collapsed is the pill. Expanding animates a **transform-based wrapper** over 200 ms on the move curve, **never an animated `width`**.

- [ ] **Step 3: keyboard, in every placement (R6.2).** The dock is keyboard-reachable everywhere and never traps focus. In `float` it is `role="complementary"` with an accessible name, and moving it is **pointer-optional**: arrow keys move it between the four corners when the pill has focus.

- [ ] **Step 4: persistence, two tiers.** Local state and `localStorage` update in the same frame; a debounced write-through updates `wellness.prefs.dock`. On sign-in the **server value wins** over a stale local value; a local value chosen before any server value existed becomes the first write. Existing stored rows simply lack the key and fall back through `resolveWellnessPrefs` — which is why this needs no data migration, and why the merge must be deep.

- [ ] **Step 5: compact on the two focus screens (R6.3).** When `compactOnExercise` is true (the default) the dock renders **collapsed** on `/exercise/[id]` and `/lesson/[cloId]` regardless of placement, and in `float` it renders as a bare pill. The learner's **placement is never overridden** — only the collapse state, and only on those two routes. Turning the preference off keeps the dock fully expanded there too. The exercise screen is the learner's screen.

- [ ] **Step 6: reminders never interrupt an attempt (R6.4).** The `brogram:attempt-active` signal already exists. A prayer, water, stretch or pomodoro event that fires during an attempt **queues** and surfaces on the next submit as a **dock badge** — never a modal, never a toast over the editor. A pomodoro ending mid-attempt pauses the idle guard instead of firing.

- [ ] **Step 7: kill the 1 Hz whole-rail re-render (R6.5).** Replace the rail's own interval with `useSecondTick` (T0.7). **Only the two components that actually display seconds subscribe**; everything else derives from timestamps, which the pure timer math in `src/lib/wellness/timers.ts` already does correctly.

- [ ] **Step 8: `adhan` becomes a dynamic import inside `computeFallback` only** — **457 KB off seven of eight routes**, the single largest bundle win in the plan (`prayer.ts:10,113-129`). Also delete the rail's second `wellness` read (`Rail.tsx:130`) and the de-rot page's third (`derot/page.tsx:37` — coordinate: that line is T2.9a's file, so T2.9a deletes it and this task's review confirms it).

- [ ] **Step 9: `src/lib/wellness/dock.ts`** — pure: `gridTemplateFor(placement)`, `orientationFor(placement)`, `effectiveCollapsed(prefs, pathname)`, `nextCorner(corner, key)`. Unit-tested, so the layout math is not trapped in JSX.

**Acceptance**
```bash
npx vitest run src/components/wellness src/lib/wellness src/components/shell
npx vitest run && npm run build
```
Tests must assert: each of the five placements renders the documented DOM; `hidden` still renders the header re-open glyph; collapse survives a reload; `compactOnExercise` collapses on `/exercise` and `/lesson` and **does not change placement**; a reminder firing while `brogram:attempt-active` is set produces a badge and no toast; **one** interval exists app-wide; `adhan` is not in the `/dashboard` client chunk (assert against the build output).

**Existing tests it may change:** `src/components/wellness/Rail.test.tsx` (renamed to `Dock.test.tsx` — a rename, with every existing assertion carried over), `PrayerTimes.test.tsx`, `WaterStretch.test.tsx`, `Pomodoro.test.tsx` — additions and the second-tick source change only.
**Review (Opus):** all five placements work with the keyboard alone; placement is never silently overridden; the dock cannot become unreachable; `adhan` is genuinely out of the shared chunk (numbers in the commit body); one interval; the queued-reminder path cannot fire over the editor.
**Commit:** `git add src/components/wellness src/components/shell src/lib/wellness && git commit -m "feat(dock): five placements, real collapse, per-user persistence, one shared clock, adhan split"`

---

### T2.5 — Rewards: XP, levels, streaks, achievement predicates (pure)

**Model:** Sonnet. **Review:** Opus.
**Depends on:** W0

**Files**
- Create: `src/lib/rewards/context.ts`, `achievements.ts`, `streaks.ts`, `goal.ts`, and a `*.test.ts` for each

**Interfaces produced**
```ts
// src/lib/rewards/context.ts — assembled entirely from data that already exists
export interface RewardContext {
  state: LearnerState
  attempts: readonly Attempt[]              // the capped 50-row window
  activityDays: readonly { kind: 'exercise' | 'derot'; day: string }[]
  lessonProgress: readonly LessonProgress[]
  drillResults: readonly DrillResult[]
  prefs: WellnessPrefs
  courseLessonCounts: Readonly<Record<CourseCode, number>>
  today: string                              // UTC date key from the server clock
}
export function buildRewardContext(args: …): RewardContext

// src/lib/rewards/achievements.ts
export type AchievementPredicate = (ctx: RewardContext) => boolean
export const PREDICATES: Readonly<Record<string, AchievementPredicate>>   // one per ACHIEVEMENTS id
export function newlyUnlocked(ctx: RewardContext, held: readonly string[]): Achievement[]

// src/lib/rewards/streaks.ts
export type FlameState = 'cold' | 'lit' | 'at-risk' | 'ignite' | 'milestone' | 'reset'
export function flameState(streak: number, countedToday: boolean, localHour: number, justCounted: boolean): FlameState
export const MILESTONES: readonly number[]    // 3, 7, 14, 30, 50, 100
export function crossedMilestone(before: number, after: number): number | null

// src/lib/rewards/goal.ts
export function winsToday(ctx: RewardContext): number   // passed rep | completed walkthrough | de-rot run, either lane
export function goalMet(ctx: RewardContext): boolean
export function levelBand(level: number): 'Fresh' | 'Wired In' | 'Shipping' | 'Dangerous' | 'Locked In' | 'Machine'
```

- [ ] **Step 1: XP is points. There is no second currency (R7.1).** `LearnerState.points` already exists, is already computed by the frozen `pointsForPass`, and is already persisted. The UI renders it as XP. No new table, no new field, no drift between two numbers. **Achievements award no XP** — they are recognition, not currency, which is what keeps "rewards track real growth" true. Level is **derived, never stored**: a pure function of `points`, so it can never disagree with XP and needs no migration.

- [ ] **Step 2: the twenty predicates**, each pure over `RewardContext`, each with a test that passes and a test that fails. Three carry corrections that would otherwise ship as silent never-firing achievements:
  - **`comeback`** reads attempts grouped by exercise **within the 50-row window only** — so the locked card says "in your recent history" rather than letting it quietly never fire.
  - **`two-tongues`** derives its language set from **closed-or-touched CLOs via `mastery`**, not from the attempts window: a learner who passes 60 Python reps before switching course has aged those out by the time the first JS pass lands. `mastery` is unbounded and course-keyed.
  - **`kept-the-promise`** reads `wellness.prefs.goalDays` (R7.7). Nothing else can see back seven goal-days once walkthroughs and de-rot runs count as wins, because they live in different tables from `attempts`.

- [ ] **Step 3: the daily goal.** One number, default 3, adjustable 1–10 in Account, stored at `wellness.prefs.dailyGoal`. A **win** is any of: a passed exercise, a completed walkthrough, or a completed de-rot run in **either** lane. The day a goal is met, append its UTC date key to `wellness.prefs.goalDays`, deduped and capped at 120, written in the same debounced prefs write as every other preference. Hitting the goal fires `goal.done` once per day; **going past it says nothing**, because an infinite treadmill is exactly the thing to avoid.

- [ ] **Step 4: flame states, all derived**, per §7.4: cold (streak 0), lit (≥1 and today counted), at-risk (≥1, today not counted, local time ≥ 18:00), ignite (the day's first qualifying action), milestone (crossing 3/7/14/30/50/100), reset (detected on load). **Streak copy always frames keeping something good**, never impending loss. No countdown timers, no "you are about to lose everything", no guilt trips. This is the one Duolingo trait deliberately not carried over.

- [ ] **Step 5: three rules that hold everywhere, and are testable here.**
  - **Never punish a mistake with scarcity.** No lives, no hearts, no energy, nothing a failed attempt consumes. A test asserts no predicate and no derivation reads a failure as a debit.
  - **Self-comparison only.** No leaderboard, no cohort comparison, no other learner's number anywhere in `RewardContext` — assert the type cannot carry one.
  - **Every reward tracks demonstrated skill or genuine showing up.** Never time on page, never opening the app.

**Acceptance**
```bash
npx vitest run src/lib/rewards
npx vitest run          # green
```
Plus explicit tests for the arithmetic the spec's critic corrected: four medium passes (1,340 XP) do **not** reach level 3 (1,400); a difficulty-5 pass with no hints at quality 90 is 545 XP; the Reviewer moves a neutral-70 estimate by +15 at best and −35 at worst.

**Existing tests it may change:** none.
**Review (Opus):** every predicate is pure and total (no throw on an empty context); the three corrected predicates are tested against the exact scenario that used to break them; nothing reads wall-clock time on page; `RewardContext` structurally cannot hold another learner's data.
**Commit:** `git add src/lib/rewards && git commit -m "feat(rewards): XP as points, derived levels, streak states, twenty achievement predicates"`

---

### T2.6 — Rewards: celebrations, counters and the trophy shelf

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.5, T0.6, T2.5

**Files**
- Create: `src/components/rewards/XpCounter.tsx`, `LevelBadge.tsx`, `StreakFlame.tsx`, `GoalRing.tsx`, `ChainPips.tsx`, `TrophyCard.tsx`, `TrophyShelf.tsx`, `Celebration.tsx`, `Confetti.tsx`, `rewards.test.tsx`
- Create: `src/lib/rewards/useCelebration.ts`, `useCelebration.test.tsx`

**Interfaces produced**
```ts
// src/lib/rewards/useCelebration.ts — the one entry point; every call site passes the resolved boolean
export type CelebrationKind =
  | 'first-win' | 'pass' | 'chain' | 'clo-close' | 'course-clear'
  | 'level-up' | 'streak-ignite' | 'streak-milestone' | 'best' | 'achievement' | 'goal'
export function useCelebration(): {
  celebrate(kind: CelebrationKind, detail?: { level?: number; skill?: string; n?: number }): void
  queueLength: number
}
```

- [ ] **Step 1: the reward event table (§7.6) implemented exactly**, including the four rate limits that keep it from becoming noise:
  - **confetti** fires only on the session's first pass, on a chain tick reaching 3, and on milestones — with a hard **1200 ms cooldown**. A routine pass gets the checkmark and the counter;
  - **no two reward sounds overlap** — the manager's 250 ms rank debounce (T0.5) does this, so no call site thinks about it;
  - **at most one trophy card is visible**; extras queue, and **a queue longer than two collapses into one "3 new trophies" card that opens the shelf** — three unlocks at 2.5 s each is 7.5 seconds of cards in front of someone who wanted the next rep;
  - **level-up is always dismissable.**

- [ ] **Step 2: silence and stillness where they belong (R7.2, R9.6).** Sound is reserved for positive and neutral product moments. **Never** on a lockdown, integrity or account-status event: a cheerful noise on a restriction notice reads as mockery and destroys the honesty §9 is built on. Blur and idle covers: silence. Paste blocked: silence, **and no motion at all** — the toast simply appears. A shake on a guard is animation on an enforcement surface *and* the punitive register R9.6 exists to remove.

- [ ] **Step 3: the split between the two animation libraries** (both already installed; a third would be pure bloat).
  - **GSAP** (`gsap` + `@gsap/react`) owns anything sequenced or numeric: the XP odometer (tween a proxy object, integer snap, format in `onUpdate`), the flame flicker, the level-up choreography, the path-map fill. **Always through `useGSAP()`** so a route change can never leave a timeline running against an unmounted node. The resolved reduced-motion boolean is passed **into** every timeline as a parameter; `gsap.matchMedia()` is used only for genuinely query-shaped variants.
  - **Motion** (`motion/react`) owns React-idiomatic mount/unmount and layout: hint panel expansion, buddy bubbles, trophy cards, dock collapse, `AnimatePresence` exits.
  - **CSS transitions** own everything interruptible and high-frequency: `:active` scale, hover, tab switches, skeleton shimmer. Transitions retarget mid-flight; keyframes restart from zero.
  - **`<ViewTransition>`** owns route transitions on dashboard, course, lesson, courses, de-rot and reports. **Never on `/exercise/[id]`.**

- [ ] **Step 4: the timing law, checked in review, not felt.** Button press 100–160 ms; tooltips 125–200; dropdowns 150–250; modals and drawers 200–350; on-screen movement 200–300; celebrations 600–900 and **only for positive moments**. Enter curve `cubic-bezier(0.22, 1, 0.36, 1)`; move `cubic-bezier(0.25, 1, 0.5, 1)`; drawer `cubic-bezier(0.32, 0.72, 0, 1)`. **Never `ease-in` on UI. Never `transition: all`. Never animate `width`, `height`, `top` or `left`. Never enter from `scale(0)` — start at 0.95.** Exit is always faster than enter. Stagger 30–50 ms per item, under 300 ms total. Hover animation is gated behind `@media (hover: hover) and (pointer: fine)`.

- [ ] **Step 5: reduced motion collapses everything, and loses nothing (R7.9).** Confetti takes `disableForReducedMotion: true` (built into the library); springs become a 150 ms opacity cross-fade; the flame stops flickering; the XP counter **sets** instead of tweening. **Feedback reduces, it never vanishes** — a level-up still shows "Level 5" and still plays its cue. Every counter uses `tabular-nums` so a tweening number never jitters the layout.

- [ ] **Step 6: `canvas-confetti` is dynamic-imported inside the celebration path**, never on a route's critical path.

- [ ] **Step 7: haptics are a bonus layer only.** `navigator.vibrate` behind a feature check and a `try/catch`, on pass and level-up only. It realistically reaches Chromium on Android and nothing else. **It is never the only channel for anything** — and neither is sound: every row of §7.6 that carries a sound also carries a visible channel, and any future PR adding a sound must name the visible channel it sits on.

**Acceptance**
```bash
npx vitest run src/components/rewards src/lib/rewards/useCelebration.test.tsx
npx vitest run && npm run build
```
Tests must assert: two celebrations inside 1200 ms produce one confetti; three achievement unlocks produce one collapsed card; under reduced motion no GSAP timeline is created and the XP value is set in one frame; `canvas-confetti` is not in any initial chunk; a level-up is dismissable by keyboard; no celebration component fires a sound without also rendering text.

**Existing tests it may change:** none.
**Review (Opus):** every animating component reads `useReducedMotion()` (grep them all — a component that animates and does not read it **fails review**); no `transition: all`, no animated `width`/`height`/`top`/`left`, no `ease-in`, no `scale(0)` entrance; every timeline is inside `useGSAP`; nothing celebratory can fire on a guard surface.
**Commit:** `git add src/components/rewards src/lib/rewards/useCelebration.ts src/lib/rewards/useCelebration.test.tsx && git commit -m "feat(rewards): celebrations, XP odometer, streak flame, trophy shelf, rate-limited confetti"`

---

### T2.7a — The voice bank (Group A)

**Model:** Sonnet. **Review:** Opus — read every line as a person, not as a diff.
**Depends on:** W0

The Bro is one character: someone about two years ahead of you who has already made the mistake you are about to make, who is genuinely pleased when you get it, and who will not type your answer for you. **Not** a teacher, a coach with a whistle, a corporate assistant, or a mascot with a catchphrase. It never says "as an AI", never names a model, never guilt-trips, never celebrates its own helpfulness.

**Files**
- Create: `src/lib/voice/lines.ts`, `src/lib/voice/lines.test.ts`, `src/lib/voice/glossary.ts`, `src/lib/voice/glossary.test.ts`

**Interfaces produced**
```ts
// src/lib/voice/lines.ts — a plain module, so it is unit-testable, greppable and forkable
export type LineKey =
  | 'welcome' | 'onboard.q.intro' | 'onboard.done'
  | 'lesson.start' | 'lesson.check.right' | 'lesson.check.wrong' | 'lesson.done' | 'lesson.skip'
  | 'pass' | 'pass.first' | 'fail' | 'hint' | 'hint.last' | 'chain.tick' | 'clo.close' | 'course.clear'
  | 'streak.keep' | 'streak.milestone' | 'streak.lost' | 'level.up' | 'best' | 'goal.done'
  | 'derot.arcade.enter' | 'derot.play.enter' | 'derot.run.done'
  | 'guard.paste' | 'guard.blur' | 'guard.idle' | 'guard.printscreen' | 'guard.why'
  | 'guard.warned' | 'guard.restricted' | 'guard.banned'
  | 'empty.bank' | 'empty.trophies' | 'error.offline' | 'error.save' | 'loading.plan' | 'loading.runtime'

export type Frequency = 'rare' | 'session' | 'hot'
/** Deterministic per render; never the same variant twice in a row for one key. */
export function line(key: LineKey): string
export function lineWith(key: LineKey, vars: Record<string, string | number>): string

// src/lib/voice/glossary.ts — domain words are translated at the edge, once
export function skillWord(): 'skill'
export function difficultyWord(d: Difficulty): 'easy' | 'light' | 'medium' | 'spicy' | 'brutal'
export function chainWord(n: number): string          // "2 of 3 in a row"
export function masteryWord(): 'how locked in you are'
```

- [ ] **Step 1: ship the string set from spec §2.7 verbatim**, including every `(critic)` correction — the flat `guard.paste` set (variants 47–50), the added `hint` third variant, the three `chain.tick` variants, the third `guard.blur` and `guard.idle`, the two extra `error.save`, the two extra `loading.runtime`.

- [ ] **Step 2: make the nine voice rules testable, not aspirational.** `lines.test.ts` asserts:
  1. **Under twelve words** for any celebration, toast or button-label key; under thirty for a panel body. **One named exemption:** `guard.why`, the Integrity-panel opening paragraph, is a *policy statement* rather than a panel body, capped at **sixty** words, and the test lists it by key.
  2. **"Bro" at most once per message**, and **banned outright** in any `guard.*` key, any error whose cause is the system, any restricted/banned screen, and any account surface.
  3. **No shipped line starts with `"Your "`.** The audit counted thirty-plus in v1.
  4. **No emoji anywhere** (`/\p{Extended_Pictographic}/u`), extending the existing repo-wide check to `src/lib/voice/`.
  5. **Name the cause, then the next step, in that order.** Every `fail`, `error.*` and `guard.*` line is manually classified in the test's fixture as having both halves; a line with a setback and no stated way forward fails.
  6. **Rotation is enforced by frequency class.** Every key declares `rare | session | hot`, and every `hot` key carries **at least three** variants. `hot` at launch: `pass`, `fail`, `hint`, `chain.tick`, `lesson.check.right`, `lesson.check.wrong`, `guard.paste`, `guard.blur`, `guard.idle`, `derot.run.done`, `loading.runtime`, `error.save`. `line()` never returns the same variant twice in a row for one key.
  7. **No internal vocabulary reaches a learner.** Assert no line contains `outcome`, `CLO`, `mastery`, `chain`, `pattern`, or `difficulty N of 5`. The glossary in §2.6 is the only vocabulary a learner sees; admin and reports may still use the internal words.
  8. **Enforcement tone is flat.** Every `guard.*` line contains no exclamation mark, no joke, no second-person praise, no "bro".
  9. **English only, no institution names, ever.**

- [ ] **Step 3: the tone dial.** `Tone` (the frozen `playful | supportive | tough-love | direct`) selects which of the four pillars leads. All four are the **same character at different volumes** — never four characters. Hype belongs on first win, level up, streak and pass; real-talk on lesson, hint, fail, empty bank and offline; flat on blur, idle and paste; flattest on restricted and banned.

- [ ] **Step 4: `lineWith` interpolation** for `{n}`, `{name}`, `{skill}`, `{time}` — with a test that a missing variable throws in development and renders the key's plain fallback in production, rather than shipping a literal `{skill}` to a learner.

**Acceptance**
```bash
npx vitest run src/lib/voice
npx vitest run          # green
```

**Existing tests it may change:** none.
**Review (Opus):** read all ~70 lines aloud. Reject anything that reads as a teacher, a mascot, a corporate assistant or a joke at the learner's expense. Confirm every `guard.*` line would still be the right thing to say to someone who is upset. Confirm rule 5 holds on every setback line.
**Commit:** `git add src/lib/voice && git commit -m "feat(voice): the Bro string bank with nine enforced voice rules and the glossary"`

---

### T2.7b — The copy sweep (Group C, serial, last)

**Model:** Sonnet, **one agent, serially**, after every other W2 task has committed. **Review:** Opus.
**Depends on:** every other W2 task

This is the one task that crosses ownership boundaries, which is exactly why it runs alone and last. Authoring the bank and wiring the call sites are split deliberately: a sweep that runs concurrently with the tasks that own those files would collide with all of them.

**Files:** every file that renders a user-facing string — approximately thirty across `src/app/(app)/**`, `src/components/**`. No file is edited that another agent still has in flight; verify with `git status --porcelain` before starting and again before committing.

- [ ] **Step 1:** replace every user-facing literal with `line('…')` / `lineWith('…', {…})`. A component never holds a string a learner reads.
- [ ] **Step 2:** replace every domain word at the edge via `glossary.ts` — `outcome` → "skill", `mastery` → "how locked in you are", `CLO closed` → "skill locked", `chain 2/3` → "2 of 3 in a row", `pattern` → "angle", `difficulty 3 of 5` → "medium", `bank/exercise` → "rep", `lesson` → "walkthrough", `attempt` → "run"/"submit", `integrity score` → "flags". De-rot keeps its name; it is the owner's word and it has personality.
- [ ] **Step 3:** delete every remaining string that opens with "Your ".
- [ ] **Step 4:** add the repo-wide lint: a test that greps `src/app` and `src/components` for a JSX text node opening with `"Your "` or containing an emoji, and fails on a hit. This is what stops the regression rather than trusting the sweep.

**Acceptance**
```bash
npx vitest run          # green, including the new repo-wide copy lint
npm run build
```
Manual: walk dashboard → course → walkthrough → exercise → De-rot → Progress → Account and confirm **no screen opens a sentence with "Your"**, shows an emoji, names an institution, or surfaces `outcome`, `CLO`, `mastery`, `pattern` or `difficulty N of 5`.

**Existing tests it may change:** any test asserting a user-facing string, across the tree — this is the one task with a broad licence, and it is why it is last. **Assertions may be re-pointed at the new copy; none may be deleted.**
**Review (Opus):** no behavioural change anywhere — a diff that touches logic is a review failure; the lint genuinely fails on a planted violation.
**Commit:** `git add -- <the exact list of swept files> && git commit -m "feat(voice): sweep every call site onto the string bank and the glossary"`

---

### T2.8 — Honest lockdown and the integrity receipt

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.2 (`my_integrity_breakdown`), T2.7a (`guard.*` lines), T2.2 (removes the standing label)

**The principle:** say what is actually true about each mechanism, per mechanism, instead of presenting three very different things as equally "protected".

| Mechanism | The truth |
|---|---|
| Paste, copy, cut, context-menu blocking | **Real enforcement.** `preventDefault()` genuinely stops the paste before content lands in the editor, in every major browser. The one thing BroGram can claim without hedging. |
| Blur and tab-away detection | **A genuine signal, not proof.** Standard APIs, and a spoofing extension exists. Evidence weighted over time, never a verdict on its own. |
| PrintScreen detection | **Best effort against one key, after the fact.** By the time `keyup` fires the OS has already rasterised the frame. |
| Screenshots in general | **Not preventable by any web technology, full stop.** |

**Files**
- Edit: `src/hooks/useLockdown.ts`, `src/hooks/useLockdown.test.tsx`, `src/components/exercise/LockdownOverlay.tsx`
- Create: `src/components/account/IntegrityPanel.tsx`, `src/components/account/IntegrityPanel.test.tsx`, `src/lib/integrity/breakdown.ts`, `src/lib/integrity/breakdown.test.ts`

- [ ] **Step 1: what stays, untouched.** The blur guard (opaque full-screen overlay, logged `blur`, weight 1, with `duringAttempt`); the idle guard (15 s → 85 % overlay with heavy backdrop blur, any input clears it, logged only past 60 s at weight 0); the clipboard guard (`copy`, `cut`, `paste`, `contextmenu` prevented on the container and inside the editor, weights 2, 2, 2, 0); the per-type coalescing and the 1 s batched insert (`useLockdown.ts:50-82`); the `logIntegrity` dedupe; the insert-only table discipline; the `during_attempt` capture; and the escalation math — **7-day rolling score, 10 warns, 20 restricts for 24 hours, 40 bans, five paste blocks in one exercise restricts immediately, `restricted_until` does not stack, admin ids exempt**.

- [ ] **Step 2: retire the PrintScreen overlay entirely (R9.1).** Delete the two-second full-screen cover and the `navigator.clipboard.writeText('')` attempt (`useLockdown.ts:131-141`, `LockdownOverlay.tsx:17,19`). It fires **after** the capture has already happened, protects nothing, and punishes a learner who pressed the key for an unrelated reason. **Keep the `keyup` listener and keep the `printscreen` row at weight 3** — the log is the only thing that guard ever genuinely produced, and it is legitimately useful.

- [ ] **Step 3: acknowledgement is a pattern, not a keypress (R9.2).** On the **third** `printscreen` event within one exercise, **and once only**, a non-blocking inline note appears in the results panel — not a modal, not a full-screen anything: *"Screenshots aren't something a website can block. We log the attempt and move on."* Subsequent presses in that exercise say nothing.

- [ ] **Step 4: the paste block rotates and explains (R9.3).** The single static string at `useLockdown.ts:87` becomes the four-line rotating set from the bank, never the same line twice in a row, with a small "why" affordance expanding one honest sentence. **No shake, no motion, no sound** — R9.6.

- [ ] **Step 5: itemised receipts, where the learner can still act on them (R9.4, corrected).** `src/lib/integrity/breakdown.ts` calls `my_integrity_breakdown()` and renders the learner's own arithmetic with the real weights:
  > Screenshot attempts, 3 at weight 3 — 9 · Paste blocked, 4 at weight 2 — 8 · Tab-away, 3 at weight 1 — 3 · Total 20. The line is 20.

  **The receipt appears on the warned and restricted screens and permanently in Account — never on the banned screen.** `src/lib/supabase/middleware.ts:63` signs a banned user out to `/login?reason=banned`, so that screen renders **unauthenticated**: `my_integrity_breakdown()` reads `auth.uid()` and would return nothing, producing a permanently empty table on the one screen where an empty table reads as a cover-up. The banned screen therefore states the **policy** — weights, thresholds, window, appeal contact — and no per-user numbers. **The receipt has to arrive before the ban, or it never arrives**: a learner should never first see their own arithmetic at the moment it is too late to act on it.

- [ ] **Step 6: "Integrity, explained" in Account (R9.5).** Permanently reachable, linked from the restricted and banned screens. States the whole policy once, in voice: what is **enforced** (paste), what is a **signal** (blur, PrintScreen), what is **impossible** (screenshots), the exact thresholds (10, 20, 40, and 5 pastes in one exercise), the learner's own current score and breakdown, and the variant-exercise backstop — **the real wall stays the real wall**: per-student variants mean a leaked solution matches nobody else's problem, and the learner is told this because it is true and because it undercuts the temptation to build more detection theatre later.

- [ ] **Step 7: no personality, no juice, anywhere here (R9.6).** Flat register, no "bro", no sound, no animation, no colour beyond `--warning` and `--destructive`. The voice does not switch off — it goes quiet. **This is a review checklist item, not a preference.**

**Acceptance**
```bash
npx vitest run src/hooks/useLockdown.test.tsx src/lib/integrity src/components/account
npx vitest run && npm run build
```
Tests must assert: pressing PrintScreen renders **nothing** over the page while still inserting the event; the third press in one exercise renders the note **once** and the fourth renders nothing; paste is still genuinely prevented and still logged at weight 2; the paste message differs between two consecutive blocks; **no sound and no animation fire on any guard event** (spy on `play` and assert zero calls); the breakdown renders on warned and restricted and is absent from banned; the fake-timer idle tests (14 s no overlay, 15 s overlay, keypress clears, 60 s → one `idle` insert) all still pass unchanged.

**Existing tests it may change:** `src/hooks/useLockdown.test.tsx` — **remove only the assertions about the PrintScreen overlay**, which is being deliberately deleted, and add the new note behaviour. Every other assertion survives byte for byte.
**Review (Opus):** every log row that existed still exists at the same weight; the escalation math is untouched; nothing celebratory can reach a guard surface; the banned screen makes no claim it cannot back; the Integrity panel's numbers match `integrity_score()` exactly.
**Commit:** `git add src/hooks/useLockdown.ts src/hooks/useLockdown.test.tsx src/components/exercise/LockdownOverlay.tsx src/components/account src/lib/integrity && git commit -m "feat(integrity): retire the PrintScreen theatre, rotate the paste copy, ship the itemised receipt"`

---

### T2.9a — De-rot Arcade: the hub, the run model, score normalisation

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.1, T0.2, T2.5

The scoring and item-selection code survives untouched (`src/components/derot/scoring.ts`, `src/app/(app)/derot/lib.ts` with `pickDrillItem`, `computeDerotStreak`, `DRILL_META`); only the presentation is new.

**Files**
- Edit: `src/app/(app)/derot/page.tsx`, `src/app/(app)/derot/lib.ts` (+ tests), `src/components/derot/scoring.ts` (+ test), `src/components/derot/DrillRunner.tsx`
- Move: `src/app/(app)/derot/[kind]/` → `src/app/(app)/derot/arcade/[kind]/` (with a redirect from the old path so existing links and the e2e specs do not break)
- Create: `src/app/(app)/derot/loading.tsx`, `src/app/(app)/derot/arcade/[kind]/loading.tsx`, `src/components/derot/RunSummary.tsx`, `ComboMeter.tsx`, `CountdownRing.tsx`, `LaneSwitch.tsx`

- [ ] **Step 1: a run is six items, not one.** Score accumulates across the run. **Combo:** consecutive correct answers multiply the item score (1×, 1.2×, 1.5×, 2×, capped); a miss resets the multiplier, **never the run**. **Countdown tension:** the existing per-item `timeLimitS` drives a ring that turns amber in the last 25 % and red in the last 10 %, with a rising tick that is **silent above 25 % remaining**. **Personal-best scoreboard:** your last five runs of this kind, your best, and the delta — nobody else's numbers ever appear. **Run summary:** score, accuracy, best combo, personal-best badge if earned, one line in voice, one button back in.

- [ ] **Step 2: the names go in voice.** Predict the output → **Call It**; Spot the bug → **Find the Break**; Trace by hand → **Run It in Your Head**; Hold focus → **Don't Blink**; N-back → **Two Back**; Speed type → **Hands**.

- [ ] **Step 3: `DrillResult.score` stays 0–100 for every kind, in both lanes (R7.6a).** The Playground formulas produce values up to 10,000 while every existing drill scores 0–100 (`scoreTimedCorrect` clamps to [50,100]) — and they land in the **same** `drill_results` array and the **same** report table, where `deriveDrillScores` (`src/components/report/derive.ts:267`) takes a plain `Math.max` and mean per kind. One un-normalised run would render a report row two orders of magnitude off every other row and make "personal best" meaningless across kinds. So each game's raw number is normalised to 0–100 by a **pure per-game function** before it becomes a `DrillResult.score`, and the **raw value is kept in the item payload for the run summary**, where "842 ms mean reaction" is the interesting number and "73" is not. Personal bests compare normalised scores **within one kind**, which is the only comparison the product ever makes.

- [ ] **Step 4: writes go through `append_drill_result` (R7.6b).** Replace the read-modify-write at `derot/[kind]/page.tsx:79-99` with the capped server-side append from `0009`. Also delete the de-rot page's third `wellness` read (`derot/page.tsx:37`) — T2.4's review confirms it is gone.

- [ ] **Step 5: the hub (§10.8).** A visible two-lane switch (Arcade / Playground), the de-rot streak, today's runs, your best per drill, six cards per lane. **De-rot is never restricted** — a restricted learner keeps it, and the restricted copy promises exactly that. The lane switch slides an indicator under the active tab over 200 ms; the card grid cross-fades with a 30 ms stagger; each card has one small idle micro-motion that pauses off-screen via `IntersectionObserver` and **stops entirely under reduced motion**.

- [ ] **Step 6: motion and sound in the runner (§10.9).** This is the loudest surface in the product and it is allowed to be: countdown ring, combo pop on each multiplier step, score count-up on the summary, a personal-best stamp. Arcade turns `drill.hit`/`drill.miss` on for the duration of a run through `withInterfaceSounds` regardless of the tier toggle, **because there the tick is the game**. Under reduced motion the ring becomes a numeric countdown and the pops become colour changes; **the drills remain fully playable**.

**Acceptance**
```bash
npx vitest run src/components/derot "src/app/(app)/derot"
npx vitest run && npm run build
npx playwright test          # the old /derot/[kind] links still resolve
```
Tests must assert: a run is six items and a miss does not end it; the combo caps at 2× and resets on a miss; every `DrillResult.score` in both lanes is within [0,100]; the raw value survives into the summary; the append goes through the RPC (spy) and the array never exceeds 300; the lane switch is keyboard-operable; **zero `callAgent` calls** across a full run.

**Existing tests it may change:** `src/app/(app)/derot/lib.test.ts`, `src/app/(app)/derot/page.test.tsx`, `src/app/(app)/derot/[kind]/page.test.tsx` (moved), `src/components/derot/scoring.test.ts`, `DrillRunner.test.tsx` — additions and path updates; every existing scoring assertion must survive.
**Review (Opus):** the frozen scoring functions are reused, not rewritten; normalisation is pure and tested per game; no leaderboard, no cohort number, anywhere; De-rot stays open under restriction; the old route still resolves.
**Commit:** `git add "src/app/(app)/derot" src/components/derot && git commit -m "feat(derot): Arcade runs with combo, countdown and personal bests; normalised scores; capped append"`

---

### T2.9b — De-rot Playground: six non-coding games

**Model:** Sonnet, **two agents in parallel over disjoint game files** (**Codex-preferred** if its sandbox is up — but six games is six serial Codex tasks, so the capacity valve applies here more than anywhere and the default is Claude subagents). **Review:** Opus.
**Depends on:** T2.9a (`LaneSwitch`, normalisation, `RunSummary`)

**Files**
- Create: `src/app/(app)/derot/play/[game]/page.tsx`, `loading.tsx`, `page.test.tsx`
- Create: `src/components/derot/play/FollowTheDot.tsx`, `ColorBack.tsx`, `Twitch.tsx`, `KeepTime.tsx`, `Breathe.tsx`, `MemoryGrid.tsx`, `play.test.tsx`

| Game | id | Loop | Raw score | `timeLimitS` |
|---|---|---|---|---|
| **Follow the Dot** | `follow-the-dot` | keep the pointer inside a dot that drifts and accelerates along a smooth path | share of frames inside the dot × 1000 | 75 |
| **Colour Back** | `color-nback` | press when the current stimulus matches N back | (hits − false alarms) × 100 | 90 |
| **Twitch** | `reaction` | ten rounds; a shape lights at a random interval, tap fast; an early tap voids that round | 10000 − mean reaction ms, floored at 0 | 60 |
| **Keep Time** | `rhythm` | tap on the beat while the tempo drifts | mean absolute offset in ms, inverted | 60 |
| **Breathe** | `breathe` | a 4-7-8 pacer; **cannot be failed** | completion percentage | 90 |
| **Grid** | `memory-grid` | a pattern flashes on a 4×4 grid, reproduce it; it grows each round | rounds cleared × 250 | 90 |

- [ ] **Step 1: Playground is the one place decorative motion is the point (R7.4).** These games may be beautiful, they may loop, they may spend the full celebration budget. They are also the one place with **no code and no judgment**: `breathe` cannot be failed, and **no Playground result ever touches `mastery`, `points`, or the integrity score**.

- [ ] **Step 2: the four accessibility rules, without which "the games remain fully playable" is simply not true.**
  1. **`follow-the-dot` is motion all the way down** and cannot be made reduced-motion-safe by dimming it. Under resolved reduced motion it is neither silently downgraded nor silently hidden: **the card stays, states plainly that it is a movement game, and offers Grid or Twitch as the substitute.** A learner who wants it anyway starts it from that card — the choice is theirs, which is the whole point of the preference.
  2. **`color-nback` must not be colour-only.** Around 1 in 12 men cannot reliably separate the palette. Every stimulus carries a **shape and a colour** (and a tone when interface sound is on), so it is playable on shape alone. Never describe a stimulus by colour in the UI.
  3. **`rhythm` must not be audio-only.** The beat is **shown as well as heard** — a visual pulse plus a travelling marker — so it is playable muted and playable deaf. It is the one game where sound is the natural channel, which is exactly why it needs the visible one.
  4. **`breathe` must not require a sustained hold.** Holding a key through a 4-7-8 cycle is a motor-accessibility wall and it is unpleasant. The default input is **one tap per phase transition**, with hold-to-pace as an option; and since it cannot be failed, a learner who does nothing at all still completes it and still scores.

- [ ] **Step 3: every run produces one `DrillResult`** with `lane: 'play'`, the normalised 0–100 `score`, the raw value in the payload, and the append through `append_drill_result`. Both lanes feed the same `derotDays` streak.

- [ ] **Step 4: a three-two-one start** on every game so nobody is caught cold, and the same `RunSummary` shape as Arcade.

- [ ] **Step 5: the Buddy's suggestion picks a lane from context (R7.6)** — after a hard failure run it suggests Playground ("step off it for ninety seconds"); after a long idle gap it suggests Arcade. This is **copy inside the existing Buddy reply**, not a new trigger. Coordinate with T2.11, which owns the drawer.

**Acceptance**
```bash
npx vitest run src/components/derot/play "src/app/(app)/derot/play"
npx vitest run && npm run build
```
Tests must assert, per game: it starts, scores, and produces a `DrillResult` in [0,100] with `lane: 'play'`; `breathe` completes and scores with **zero input**; `color-nback` renders a shape for every stimulus (assert no stimulus is distinguished by colour alone); `rhythm` renders a visual beat with sound disabled; `follow-the-dot` under reduced motion renders the substitute card and does **not** auto-start; **zero `callAgent` calls** in any game.

**Existing tests it may change:** none.
**Review (Opus):** play each of the six by hand; each must be genuinely pleasant for sixty seconds. Confirm all four accessibility rules by keyboard and with sound off. Confirm nothing here can touch mastery, points or integrity (grep the imports).
**Commit:** `git add "src/app/(app)/derot/play" src/components/derot/play && git commit -m "feat(derot): six Playground games, normalised scoring, accessible by construction"`

---

### T2.10 — Agent identity rewrites (copy only, no schema touched)

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T2.7a

**Files**
- Edit: `src/lib/agents/{profiler,planner,author,diagnoser,coach,reviewer,buddy}.ts` (the `system` string's identity paragraph **only**), `src/lib/agents/prompts.test.ts`

- [ ] **Step 1:** rewrite **only** the identity paragraph at the top of each agent's `system` string, from institutional to the four pillars. Every hard rule each agent has stays byte-identical: the Buddy's on-topic gate and its fixed refusal sentence, the Coach's single-line `codeLine` cap, the JSON-only contract, the token budgets, the fallbacks, the `routeCheck`s, the `repair`s.
- [ ] **Step 2:** update `prompts.test.ts` in the **same commit** so the prompts stay byte-pinned. The pinning is the safety net; a rewrite that lands without it is how a prompt silently drifts.
- [ ] **Step 3:** one live (non-dry-run) call per streaming agent afterwards, pasted into the build log, proving the JSON contract still holds with the new preamble — the 19:24 incident (thinking mode consuming the whole token budget before any JSON was emitted) is the reason this is a step and not an assumption.

**Acceptance**
```bash
npx vitest run src/lib/agents
npx vitest run          # green
AGENT_DRY_RUN=false node <one live profiler, planner and coach-stream call>   # fallback: false
```

**Existing tests it may change:** `src/lib/agents/prompts.test.ts` — the byte pins, necessarily, in the same commit.
**Review (Opus):** diff each `system` string and confirm **only** the identity paragraph changed; every hard rule is present verbatim; the word `json` is still in every system prompt; token budgets unchanged; the live calls returned `fallback: false`.
**Commit:** `git add src/lib/agents && git commit -m "feat(agents): identity paragraphs in the Bro voice, prompts re-pinned"`

---

### T2.11 — Buddy drawer polish

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T0.5, T2.7a, T2.9b (the lane-aware suggestion)

**Files:** `src/components/buddy/**`

- [ ] **Step 1:** the typing indicator and the auto-scroll lock (scroll follows the stream **only** while the learner is already at the bottom — a learner reading back must never be yanked down).
- [ ] **Step 2:** a message is appended before the call and its reply streams (already optimistic); a failed send is marked "didn't send" with a retry and **never deleted**.
- [ ] **Step 3:** the off-topic refusal renders **without** the streaming cursor — it is a fixed sentence, not a generation.
- [ ] **Step 4:** the "suggest a drill" chip picks a lane from context per R7.6, as copy inside the existing reply.
- [ ] **Step 5:** motion — drawer slides from the right on the drawer curve, 320 ms, exits at 200 ms; bubbles enter with a 12 px rise; typing dots while streaming; nothing else. Under reduced motion: cross-fade, static dots.
- [ ] **Step 6:** the drawer is keyboard-complete including its close, and does not trap focus.

**Acceptance:** `npx vitest run src/components/buddy && npx vitest run`. Tests: auto-scroll does not fire when the learner has scrolled up; a failed send is retryable; the refusal has no cursor; **no new agent trigger** (spy: exactly one `buddy-message` per send).
**Existing tests it may change:** `src/components/buddy/Drawer.test.tsx`, `state.test.ts` — additions only.
**Review (Opus):** no new trigger; focus is never trapped; the refusal is byte-identical to the contract's fixed sentence.
**Commit:** `git add src/components/buddy && git commit -m "feat(buddy): typing indicator, scroll lock, retryable sends, lane-aware suggestion"`

---

### Wave 2 gate

```bash
npx tsc --noEmit && npx eslint src
npx vitest run                                     # every existing test plus W0-W2 additions
node scripts/build-static-curriculum.mjs --check
npm run build
npx playwright test
```
Manual sweep, the parts of §13 that are now buildable: submit a wrong answer and see the verdict in well under a second after the code finishes; submit a right one and see pass, XP, the chain pip and the celebration **before** any saving indicator finishes; move the dock to left, top, floating and hidden and reload — every choice survives; turn sound off and pass something (silence, unchanged visible feedback); turn interface sounds on and click Run (it clicks); set motion to reduced and walk every screen (nothing staggers, slides or loops, and every verdict is still legible); press Ctrl+V (a rotating line with a "why"); press PrintScreen (**nothing covers the screen**), twice more (one honest line); open Account → Integrity explained (your own counts, the real weights, the real thresholds); open De-rot (two lanes, a real run, a summary that compares you only to yourself).

Record in `docs/build-log.md`; tick the W2 rows; `git push origin main`.

---

## Wave 3 — Proven and shipped

Measure the thing that was rebuilt, prove it, and put it in front of the owner.

**Groups.** A (parallel): T3.1, T3.2, T3.3, T3.4, T3.5. B (after A): T3.6 whole-branch review and its fix rounds. C (after B is clean): T3.7 deploy and the acceptance run.

---

### T3.1 — The bundle budget, generated from a measurement

**Model:** Sonnet. **Review:** Opus.
**Depends on:** W2

**The numbers in the spec do not close, and the spec says so.** `/dashboard` is 887 KB today, of which `adhan` is 457 KB; removing `adhan` lands it near 430 KB — already above the 380 KB target *before* v2 adds TanStack Query, Motion, GSAP, `next-themes` and the sound manager to the shell. **A budget below the achievable floor is a gate that fails on the first green PR and then gets deleted, which is worse than no gate.**

**Files**
- Create: `scripts/check-bundle-budget.mjs`, `perf-budget.json`

- [ ] **Step 1: reproduce the audit's method exactly.** For each route, read `.next/server/app/**/page_client-reference-manifest.js`, resolve it against on-disk `.next/static/chunks/*.js` sizes, sum uncompressed bytes. The audit's method **is** the definition; a different method produces numbers that cannot be compared to the v1 column.

- [ ] **Step 2: generate `perf-budget.json` from the measured tree, then hand-tighten (R5.7).** Two hard rules bind the generation:
  **(a)** no route's budget may be set **above** its v1 number, ever;
  **(b)** every route whose measured v2 size exceeds the spec's target gets **one named ledger row** saying which library is responsible and whether it is being split, deferred to first gesture, or accepted.
  The most likely such row is the **~467 KB Supabase client pair** on every authenticated route, which no ruling in the spec touches and which is the single largest remaining item on `/dashboard`. Write that row honestly rather than moving the number.

  Direction (from spec §5.6, provisional until measured): `/dashboard` ≤ 380 KB (v1 887); `/course/[code]` ≤ 420; `/lesson/[cloId]` ≤ 600; `/exercise/[id]` ≤ 750 (v1 1593); `/derot/*` ≤ 420 (v1 926); `/reports` ≤ 450 (v1 896); `/onboarding`, `/courses`, `/account` ≤ 380 (v1 890).

- [ ] **Step 3: assert `public/` too**, with §3 C1's correction: the gate is **tracked** `public/` ≤ 3 MB (`git ls-files public`), and the deployed total carries `tools.jar` under its own named ledger row, because the CheerpJ ruling requires a same-origin `tools.jar` and Java is live. A permanent 3 MB deploy cap and a shipped Java adapter are mutually exclusive; the plan says which one it is choosing and why.

- [ ] **Step 4: set the real CodeMirror number.** The spec's "~400–500 KB off `/exercise`" is an estimate — the audit measured the whole CodeMirror chunk at 658 KB and never attributed bytes per grammar. Measure the single-grammar split on the W2 tree and write the actual figure into the commit body and the ledger.

**Acceptance**
```bash
npm run build && npm run perf:bundle      # prints the table, exit 0
```
Prove the gate bites: temporarily add a large import to one route, re-run, confirm exit 1, remove it.

**Existing tests it may change:** none.
**Review (Opus):** the method matches the audit's; no budget exceeds its v1 number; every overage has a named ledger row rather than a raised ceiling.
**Commit:** `git add scripts/check-bundle-budget.mjs perf-budget.json && git commit -m "perf(ci): measured bundle budgets with a gate that bites"`

---

### T3.2 — Timings, vitals, and the local diagnostics buffer

**Model:** Sonnet. **Review:** Opus.
**Depends on:** W2, T3.1 (`perf-budget.json`)

**Files**
- Create: `e2e/perf.spec.ts`, `src/lib/perf/marks.ts`, `src/lib/perf/vitals.ts`, `src/lib/perf/vitals.test.ts`

- [ ] **Step 1: four named marks**, emitted by the app: `brogram:shell-ready`, `brogram:route-ready`, `brogram:graded`, `brogram:check-verdict`.

- [ ] **Step 2: `e2e/perf.spec.ts`** — against a **production build** with `AGENT_DRY_RUN=true` so no model latency pollutes the numbers. Drives dashboard → course → lesson → exercise → submit, reads the marks and the navigation timing entries, runs each route **three times** and asserts the **median** against `perf-budget.json`. Round-trip counts are asserted by counting Supabase requests via `page.route` interception, per route:

  | Route | v2 target |
  |---|---|
  | `/dashboard` | 0 curriculum; shared prefix ≤ 3 |
  | `/course/[code]`, `/lesson/[cloId]` | **0** |
  | `/exercise/[id]` | **1** seed, **2** runtime-generated |
  | `/courses` (switch) | **1** write + one background Planner call |
  | `/derot`, `/derot/*` | **1** wellness read for the whole page load |
  | `/reports` | **1**, capped, narrowed, on tab open |

  Interaction budgets asserted: course tile click → course home painted **< 700 ms** (T3.2 fix round 3, controller-granted amendment — the original 100ms row assumed the route's own render was the cost to cut, but `/course/[code]` makes zero Supabase reads of its own; the measured cost is `src/lib/supabase/middleware.ts`'s two serial network round trips on every proxy-matched request, upstream of that task's file grant. Prefetching the link first was tried and measured *worse* — 857ms, 863ms — before being reverted. Three production-build runs at the reverted, honest baseline: 503.8ms, 697.1ms, 503.9ms; worst of three rounded up to the next 50ms is 700. Real fix owed: shorten or parallelize `middleware.ts`'s serial `rpc('lift_expired_restriction')` + `profiles` select); submit → pass/fail revealed **< 300 ms beyond runtime execution**; lesson check → verdict **< 120 ms** for non-`micro-code` kinds. Paint budgets: LCP ≤ 1.5 s on dashboard, course and lesson; ≤ 1.8 s on exercise; CLS ≤ 0.05 and INP ≤ 200 ms everywhere.

- [ ] **Step 3: two budgets are field-only and are NOT gated here** — and the plan says so out loud rather than shipping a claim. `perf:timings` runs with `AGENT_DRY_RUN=true`, so "hint click → first token < 1.5 s" measures a local fallback and asserts **nothing** about DeepSeek. And "first Run of a session on a cold language is not user-visible" is contradicted by the throttled profile the table is measured against — a 10 MB fetch is not hidden by 3–8 seconds of idle. Both become field-only observations read from Diagnostics and Speed Insights. **A budget nobody can measure is a claim, and this product does not ship claims.**

- [ ] **Step 4: no telemetry route handler (R5.5).** There is no `/api/vitals` and there never will be. `useReportWebVitals` writes LCP, INP and CLS into an **in-memory ring buffer** that Account → Diagnostics renders, so anyone — including a fork on their own hosting — reads their own numbers with no server. `@vercel/speed-insights` mounts **only** when `process.env.NEXT_PUBLIC_VERCEL_ENV` is set, so a self-hoster ships nothing. This is what keeps v1 non-negotiable #3 intact.

**Acceptance**
```bash
npm run build && npm run perf:timings     # exit 0
```

**Existing tests it may change:** none.
**Review (Opus):** the round-trip assertions genuinely count requests (plant an extra read and confirm a failure); the two field-only rows are absent from the gate; nothing posts a metric anywhere.
**Commit:** `git add e2e/perf.spec.ts src/lib/perf && git commit -m "perf(ci): timing and vitals gates, local diagnostics ring buffer, no telemetry route"`

---

### T3.3 — e2e updates

**Model:** Sonnet. **Review:** Opus.
**Depends on:** W2

**Files:** `e2e/**` except `perf.spec.ts`; `playwright.config.ts`

- [ ] **Step 1: update the three existing flows** for the new routes and copy. `invite-to-first-exercise` now goes sign-in → six questions → course picker → **course home** → walkthrough → rep. `fail-fix-pass` asserts the **`'graded'`** verdict lands before the save completes. `blur-overlay` keeps every existing assertion and adds: **PrintScreen covers nothing**, and the third press shows one line.
- [ ] **Step 2: three new specs.**
  - `e2e/onboarding-once.spec.ts` — six questions, no loading state between cards, then switch courses twice and assert **the Profiler is never reached** (this is R4.4's named Playwright assertion).
  - `e2e/walkthrough.spec.ts` — open a walkthrough, run the snippet, answer a check wrong then right, finish, land on the rep.
  - `e2e/dock-and-theme.spec.ts` — move the dock through all five placements, collapse it, switch all four themes, reload, assert every choice survived.
- [ ] **Step 3:** keep the Java and spike specs env-gated exactly as they are; do not make the default suite depend on the CDN or `tools.jar`.

**Acceptance:** `npx playwright test` green against a dev server with `AGENT_DRY_RUN=true`, and again against a preview deploy with only `baseURL` changed.
**Existing tests it may change:** all three existing specs — updates for new routes and copy; **no assertion may be dropped**, only re-pointed.
**Review (Opus):** the onboarding-once spec would genuinely fail if the redirect regressed (prove it by temporarily removing the redirect).
**Commit:** `git add e2e playwright.config.ts && git commit -m "test(e2e): updated flows plus onboarding-once, walkthrough and dock-theme specs"`

---

### T3.4 — The no-agent-surfaces test

**Model:** Sonnet. **Review:** Opus.
**Depends on:** W2

**The guarantee is currently asserted by a test that predates every surface it claims to cover.** `src/hooks/useExerciseLoop.test.tsx:92` ("calls no agents on mount, typing, free run, or timer") covers exactly one hook and knows nothing about lessons, checks, drills, celebrations, themes or the dock — none of which existed when it was written.

**Files:** create `src/lib/agents/no-agent-surfaces.test.tsx`

- [ ] **Step 1:** spy on `callAgent` and `streamAgent` — the single choke point — and assert **zero** calls across each of: a walkthrough mounted and fully completed with **every check kind answered both right and wrong**; an Arcade run start to finish; a Playground run start to finish; a theme switch; a dock move through all five placements; a celebration; a level-up; a `/courses` render; a `/course/[code]` render; a dashboard render.
- [ ] **Step 2:** assert the **seven** legitimate triggers still fire where they should, so the test cannot be satisfied by breaking the product: `onboarding-answer` once at the end of onboarding, `plan-refresh` once per course switch, `attempt-failed`, `hint-requested`, `attempt-passed`, `bank-miss`, `buddy-message`.
- [ ] **Step 3:** a header comment stating that **whoever adds a surface extends this file**, and the ledger row that says the same.

**Acceptance:** `npx vitest run src/lib/agents/no-agent-surfaces.test.tsx` green; plant a `callAgent` in a lesson check handler and confirm it fails.
**Existing tests it may change:** none — the `useExerciseLoop` spy test stays exactly as it is.
**Review (Opus):** the spy is on the choke point, not on `fetch`; every listed surface is genuinely exercised, not merely rendered.
**Commit:** `git add src/lib/agents/no-agent-surfaces.test.tsx && git commit -m "test(agents): zero agent calls across every v2 surface, seven triggers still proven"`

---

### T3.5 — Openness: the work items that make a fork real

**Model:** Sonnet. **Review:** Opus.
**Depends on:** W2

Openness is a **build constraint, not a README line**.

**Files:** create `docs/CONTENT.md`, `SETUP.md`; edit `README.md`, `public/sounds/CREDITS.md`

- [ ] **Step 1: `docs/CONTENT.md`** — how to author a course, end to end: edit `seed/`, run the two generation workflows, run `scripts/verify-exercise.mjs` and `scripts/verify-lesson.mjs`, run `seed:verify`, run `seed:load`, rebuild. Enough for someone else to ship a **different syllabus** without asking anyone. The static curriculum bundle is what makes this true: a fork edits `seed/` and rebuilds.
- [ ] **Step 2: `SETUP.md`** — a self-host path against a **local** Supabase: apply `supabase/migrations/` with `npm run db:apply`, set `.env.local`, `npm run dev`, **no Vercel account required**, and `AGENT_DRY_RUN=true` to run the whole product with **no DeepSeek key at all**. Include the paragraph the spec's change log flags as missing: what a walkthrough, a fix plan and a hint actually look like in dry-run mode — every agent's shipped fallback, deterministic, which is also the mode the perf suite runs in.
- [ ] **Step 3: `README.md`** — two paragraphs on **how the learning model works**, because the distinctive part of this product is the Learner State schema, the seven-trigger rule and the pattern taxonomy, not the model behind it.
- [ ] **Step 4: the licence ledger.** `public/sounds/CREDITS.md` has a row per file. Restate §1.12 accurately: every asset BroGram **authors or curates** is CC0/ISC/MIT; `tools.jar` is OpenJDK 8 under **GPLv2 with the Classpath Exception**, fetched at build and honestly disclosed. The blanket claim is false and a rule the repo already breaks is worse than a rule that is true. **The ledger, not the licence list, is what makes a fork safe.**
- [ ] **Step 5:** verify there is **no Vercel-only code path** on any learner-facing feature (grep `NEXT_PUBLIC_VERCEL_ENV`; the only hit is the Speed Insights mount).

**Acceptance:** a reader following `SETUP.md` on a clean machine reaches a running app with no DeepSeek key. `npx vitest run` green.
**Existing tests it may change:** none.
**Review (Opus):** follow `SETUP.md` literally and report the first step that does not work; confirm the CREDITS ledger covers every file under `public/sounds/` and `public/java/`.
**Commit:** `git add docs/CONTENT.md SETUP.md README.md public/sounds/CREDITS.md && git commit -m "docs(openness): content authoring guide, self-host path, honest licence ledger"`

---

### T3.6 — Whole-branch review (Group B)

**Model:** **Opus**, plus a **Codex adversarial cross-review** if the sandbox is up. Read-only: findings are dispatched back to the owning task's agent as a fix round.
**Depends on:** every W3 Group A task

Review the whole v2 diff (`git diff <the W0 base commit>..HEAD`) against these invariants. The 22:47 build-log lesson stands: cross-review catches what a single reviewer misses, and it is cheap.

1. **Bank secrecy is layered.** No client role reads `public.exercises`; `exercises_public` is unchanged; nothing under `public/curriculum/` contains a reference solution or an `expectedStdout`; the `lessons` table has no client grant.
2. **The LLM boundary holds.** Every model call goes through `src/app/api/agent/route.ts`; `deepseek-v4-flash` only; the word `json` in every system prompt; no client-supplied `referenceSolution`.
3. **Seven triggers, test-enforced** — both `useExerciseLoop.test.tsx` and `no-agent-surfaces.test.tsx` in the same run.
4. **Auth gates.** Proxy matcher covers every authenticated route including `/account`; banned signs out; restricted loses `/exercise` and keeps dashboard, walkthroughs and De-rot — matching what the restricted copy promises.
5. **Lockdown numbers are unchanged.** Weights 2/2/3/1/0/0; thresholds 10/20/40; five pastes in one exercise; 15 s idle blur; 60 s idle log; `restricted_until` does not stack; admin exempt.
6. **Contracts.** Only the sixteen additive items; nothing frozen renamed or re-typed; `src/lib/contracts.ts` byte-identical to `docs/contracts/brogram-contracts.ts`.
7. **Voice and taste.** No screen opens with "Your"; no emoji; no institution name; no internal vocabulary; guard surfaces are flat, silent and still.
8. **Accessibility.** Keyboard-only reaches a path-map node, every lesson check kind, the theme picker, the dock placement control, the sound toggle and the Buddy drawer including its close. Nothing traps focus. Every state carried by colour is also carried by a glyph or a word. Reduced motion collapses staggers, reveals, slides, edge draws and every idle loop — and loses no information.
9. **Data integrity.** One versioned `learner_state` write per transition; `user_achievements` insert-only; `drill_results` capped and appended server-side; `goalDays` capped at 120.
10. **Production readiness.** `npm run build` clean; every gate green; no secret in any committed file; `.env.example` holds no values.

**Output:** a findings list, triaged Critical / Important / Deferred, each dispatched to the task that owns the file. Deferred items become pilot-week ledger rows with a named cost-if-wrong.

---

### T3.7 — Deploy and the ten-minute acceptance run (Group C)

**Model:** Sonnet executes; **Musa** runs the acceptance list. **Review:** Opus signs the build-log entry.
**Depends on:** T3.6 clean

**Files:** create `.github/workflows/ci.yml`; edit `docs/build-log.md`, `openspec/changes/brogram-launch/tasks.md`

- [ ] **Step 1: CI.** One GitHub Actions job running `npm ci`, `npm run typecheck`, `npx eslint src`, `npx vitest run`, `node seed/validate.mjs`, `node scripts/build-static-curriculum.mjs --check`, `npm run build`, `npm run perf:bundle`, `npm run perf:timings`, `npx playwright test`. A regression fails the PR. `perf-budget.json` is the single source for every number.
- [ ] **Step 2: env.** `vercel env add` for every variable in `.env.example` on production and preview, including `NEXT_PUBLIC_JUDGE_PROVIDER=browser` (the Java adapter landed and Musa has not yet set it on Vercel — build log 23:13). Node 22.x.
- [ ] **Step 3: migrations and seed on production.** `npm run db:apply`, then `node scripts/seed-load.mjs`; paste every count into the build log.
- [ ] **Step 4: deploy.** Connect the Vercel project to the GitHub repo (still not connected — build log 22:00) or `vercel deploy --prod`. Re-run the three original Playwright flows plus the three new ones against the deployed URL.
- [ ] **Step 5: the ten-minute acceptance checklist (spec §13), run in order on a fresh browser profile against the deployed build.** Twenty-eight lines, each pass or fail with no interpretation required. The five that matter most, because they are the owner's own complaints: **six questions once, never again on a course switch**; **a walkthrough that teaches before it tests**; **pass, XP and celebration before the saving indicator finishes**; **the dock in any of five places, surviving a reload**; **PrintScreen covers nothing and the third press tells the truth**.
- [ ] **Step 6:** record every ruling in `docs/build-log.md` with its reason; close the v2 rows in the ledger; `git push origin main`.

**Acceptance:** every line of §13 passes; `npm run perf:bundle` and `npm run perf:timings` exit 0; `npx vitest run` green with **both** agent-discipline tests in the run; `npm run build` exit 0 with `prebuild` having run and the secret-stripping test green.

---

## 5. Existing-test change licence

The 840 existing tests are a standing constraint. **A task may change only the files listed on its own row.** Anything else is a review failure. "Additions only" means no existing assertion is deleted or weakened.

| Existing test file | Task allowed to change it | Licence |
|---|---|---|
| `src/lib/contracts.test.ts` | — | **Nobody.** It is the byte-for-byte guard; it must pass unedited. |
| `src/app/(app)/derot/lib.test.ts` | T0.1, T2.9a | additions for the six new kinds; path updates |
| `src/components/report/derive.test.ts` | T0.1 | additions for the six new kinds |
| `src/app/(app)/layout.test.tsx` | T0.4, T0.7, T2.1 | provider wrapper, shell selectors, then the fetch-shape rewrite — every gate assertion survives |
| `src/app/(app)/dashboard/page.test.tsx` | T0.7, T1.6, T2.1 | shell selectors, link targets, then the fetch-shape rewrite |
| `src/lib/exercise/grading.test.ts` | T1.2 | additions plus **one corrected assertion** (the newline collapse was a bug) |
| `src/app/(app)/onboarding/page.test.tsx` | T1.5 | **may be rewritten** — the flow it tests is replaced; every surviving guarantee re-asserted |
| `src/lib/supabase/middleware.test.ts` | T1.6 | additions for the matcher and the restricted-route rule |
| `src/hooks/useExerciseLoop.test.tsx` | T2.2 | additions plus status-name updates; the trigger spy, hint cooldown, retry dedupe and stale-mastery tests survive in intent |
| `src/app/(app)/exercise/[id]/page.test.tsx` | T2.2 | additions; label removal |
| `src/app/(app)/reports/page.test.tsx`, `data.test.ts` | T2.3 | additions and fetch-shape updates; PDF tests survive unchanged |
| `src/app/(app)/account/page.test.tsx` | T2.3 | additions |
| `src/components/wellness/*.test.tsx` | T2.4 | `Rail.test.tsx` → `Dock.test.tsx` **rename with every assertion carried over**; second-tick source change |
| `src/hooks/useLockdown.test.tsx` | T2.8 | **remove only** the PrintScreen-overlay assertions (deliberately deleted); everything else survives byte for byte |
| `src/components/derot/*.test.tsx`, `src/app/(app)/derot/**/*.test.tsx` | T2.9a | additions and path updates; every scoring assertion survives |
| `src/lib/agents/prompts.test.ts` | T2.10 | byte pins updated in the same commit as the prompt change |
| `src/components/buddy/*.test.ts(x)` | T2.11 | additions |
| every test asserting user-facing copy | T2.7b | assertions **re-pointed** at the string bank; none deleted |
| `e2e/*.spec.ts` | T3.3 | updates for new routes and copy; no assertion dropped |
| **everything else** | — | **Nobody.** |

---

## 6. Risks, and what is done about each

| Risk | Mitigation |
|---|---|
| Two agents edit one file | The ownership map in §4 is exclusive per wave; a task that needs a file it does not own **stops and reports**. `git add` is always path-scoped. |
| The tree is red mid-wave | Accepted and bounded: Group B may import a Group A module before it lands. The **wave gate** is the only place green is required, and no wave closes red. |
| Another destructive `git` command | The three banned families are named in §1.2 with the 15:58 incident as the reason. `git add -A` is banned too. |
| The perf budget fails on the first green PR | R5.7: `perf-budget.json` is **generated from a measurement** at the end of W3, never written from the spec's provisional table, and no route's budget may exceed its v1 number. |
| Sound assets block on network or licence | §3 C5: BroGram synthesizes its own CC0 clips with zero network; ffmpeg is verified present for the sprite; the sprite is committed so a fork with no ffmpeg still gets sound. |
| The four palettes ship unverified | T0.6 Step 8 turns R8.3 into a **failing unit test** over APCA `Lc` and WCAG ratios, including the Arcade success/warning lightness separation. |
| Lesson content is late and blocks the screens | W0 ships the schema and one **hand-written golden lesson**; T1.3 renders against it from day one and never waits on T1.1's batch. |
| Codex stays down | Nothing depends on it. The capacity valve is the **default**, not the exception: Claude subagents build, Codex reviews if it returns. |
| A new surface quietly grows an agent call | T3.4's `no-agent-surfaces.test.tsx`, plus the header comment and ledger row that say whoever adds a surface extends it. |
| The static bundle leaks a secret | A strip assertion inside the build script **and** a test over every file under `public/curriculum/`, in the gate of every wave. |
| A learner is worse off, not better | The §13 ten-minute checklist is run by the owner on a fresh profile against the deployed build, and it is written so every line is pass or fail with no interpretation. |

---

## 7. Self-review checklist (run before handing this plan over)

- **Spec coverage.** Every section §2–§12 of the spec maps to a task above: §2 → T2.7a/T2.7b/T2.10; §3 → T1.1–T1.4; §4 → T1.5/T1.6; §5 → T0.3/T0.4/T2.1–T2.3/T3.1/T3.2; §6 → T2.4; §7 → T2.5/T2.6/T2.9a/T2.9b/T0.5; §8 → T0.6; §9 → T2.8; §10 → the screen tasks of W1 and W2; §11 → T0.1/T0.2/T0.3/T3.5; §12 → T3.4 and the non-goals restated in §2 of this plan; §13 → T3.7; §14 → §1 and §4 of this plan.
- **Every owner's complaint has a task.** Sluggish → T0.3, T0.4, T2.1, T2.2, T3.1, T3.2. No walkthroughs → T1.1–T1.4. Re-onboarding → T1.5, T1.6. Slow next question → T1.5. Redundant questions → T1.5 (six, hard cap) and T1.1's critic pass (no check restates its worked example). Sidebar → T2.4. Paste copy and PrintScreen theatre → T2.8. Plain UI, no themes → T0.6. Animation, sound, rewards, fun → T0.5, T2.5, T2.6, T2.9a, T2.9b. Bro not teacher → T2.7a, T2.7b, T2.10. Best open-source platform → T3.5, plus openness as a constraint in §2.
- **No placeholders.** Every task names files, interfaces, exact commands, and code where it removes ambiguity.
- **Disjoint paths.** No path appears twice within a wave in §4. The three historically contended files each have one named owner per wave: `AppShell.tsx` changes once (T0.7) and never again; `useExerciseLoop.ts` is T2.2's alone; `package.json` is T0.0's alone.
- **Type consistency.** Every name used across tasks — `resolveWellnessPrefs`, `loadCourseBundle`, `qk`, `optimistic`, `play`, `useReducedMotion`, `gradeCheck`, `buildMap`, `currentCloId`, `provisionalPlan`, `newlyUnlocked`, `flameState`, `useCelebration`, `line`, `useSecondTick` — is defined exactly once, in the Interfaces block of the task that produces it.
- **The frozen surface is untouched.** Seven agents, seven triggers, browser-first execution, `pointsForPass`, `nextMasteryScore`, `INTEGRITY_WEIGHTS`, `INTEGRITY_THRESHOLDS`, `LOCKDOWN`, `LearnerState`, every agent request and reply.
- **Four corrections to the spec are recorded** in §3 with their evidence, rather than discovered by an implementer at 2am.

---

## 8. Wave gates, in one place

Every wave ends with the same command list. A wave does not close until every line is exit 0, the Opus whole-wave review is clean, `docs/build-log.md` carries the wave's rulings, the ledger rows are ticked, and `main` is pushed.

```bash
npx tsc --noEmit
npx eslint src
npx vitest run                                     # >= 840 and rising, zero failures
node seed/validate.mjs
node scripts/build-static-curriculum.mjs --check
node scripts/seed-load.mjs --dry-run
npm run build
npx playwright test
npm run perf:bundle                                # from W3 on
npm run perf:timings                               # from W3 on
```

Ruling (18:47 Doha, 2026-09-07), T3.2: the @vercel/speed-insights mount is struck from the plan for now (production is not on Vercel analytics); the local vitals ring buffer and the perf-mark gate stand. The GRADED perf mark and the pending-prefs guard on the settle-invalidate inside src/hooks/useExerciseLoop.ts land as a named follow-up after Lane A (the exercise fix lane) is approved; until then the perf gate reports the graded mark as a named pending delta.
