# BroGram v2 — "The program with a b"

**Date:** 2026-09-06
**Owner:** Musa (Velocity)
**Status:** Decided. Every open question in this document is answered and marked **Ruling**. Implementers build from this without asking.
**Supersedes:** `docs/superpowers/specs/2026-09-05-brogram-design.md` (v1) for everything it contradicts. Every v1 non-negotiable the owner did not overturn survives verbatim (seven subsystems, browser-first execution, learner-state agents, hybrid offline bank, invite/allow-list gate, lockdown logging and escalation, English only, no emoji in UI copy, no institution names, MIT).
**Evidence base:** `docs/build-log.md` (every ruling to date), `docs/research/v2/codebase-audit.md`, `docs/research/v2/learning-ux.md`, `docs/research/v2/performance.md`, `docs/research/v2/sound-motion.md`, `docs/research/v2/theming-voice.md`, `docs/research/v2/owner-addendum.md`.
**Ledger:** `openspec/changes/brogram-launch/tasks.md` gains a `v2` section; each ruling below is one or more ledger rows.

---

## 0. The one-paragraph version

v1 works and is correct — 840 green tests, real runtimes, real agents, real RLS — and it feels like a form. v2 keeps every mechanism and rebuilds the *experience* on top of it: the app teaches before it tests, it answers in one frame instead of nine round trips, it asks who you are exactly once, it lets you put your own tools where you want them, it has four looks and a sound, it pays you for real work with XP and levels and trophies, it tells the truth about what it can and cannot enforce, and it talks like a person who is a bit further along than you and wants you to win. Nothing in this document adds an eighth agent trigger, moves grading off the browser, or changes what "correct" means.

---

## 1. What changes and why

Every complaint the owner filed after real use, mapped to exactly one decision. The **Cause** column names the file and line from the audit so nobody re-diagnoses.

### 1.1 "Too sluggish, no optimistic UI or caching"

**Cause.** Nothing is cached, nothing is server-rendered with data, nothing is optimistic. Ten serial hops before the dashboard paints (`src/app/(app)/layout.tsx:13,24,35-44,45-48`; `src/proxy.ts:9-12`), 457 KB of prayer astronomy on seven of eight routes (`src/lib/wellness/prayer.ts:10`), eight serial stages between local grading and the word "Passed" (`src/hooks/useExerciseLoop.ts:267-341`), zero `loading.tsx` anywhere so Next never prefetches a single link.

**Ruling R1.1.** Rebuild the data layer per §5: curriculum becomes static JSON generated at build time (zero round trips), TanStack Query v5 owns every per-user read with SSR seeding, every mutation the learner can feel (attempt, hint, drill, prefs, buddy, lesson check, course switch) becomes optimistic, every route under `(app)` gets a shape-matched `loading.tsx`, CodeMirror loads one grammar and `adhan` loads only on fallback, Pyodide warms at idle from the dashboard. Budget and CI enforcement in §5.6-5.7.

### 1.2 "No walkthroughs — a course starts at 'Next exercises', a beginner cannot learn"

**Cause.** There is no concept layer in the product at all. `Clo.outcome` is one sentence; `Exercise.prompt` states a task. No lesson route exists (`.next` app-paths-manifest has none).

**Ruling R1.2.** Ship the Lessons subsystem (§3): one lesson per learning outcome — concept, worked example, 1-3 guided checks graded instantly in place, then the bank exercise. Authored offline as seed content keyed by `CloId`, verified by execution, shipped in the static curriculum bundle. A course now opens on a **course home with a path map**, not a list. The lesson is a strong default, never a lock — "I've got this" skips it and records the skip.

### 1.3 "Every course switch re-runs the onboarding profiler"

**Cause.** `src/app/(app)/onboarding/page.tsx:47` initialises `stage` to `'question'` unconditionally and never reads `profile.onboardingComplete`, which the same file sets at `:158`. Both dashboard entry points link straight there (`dashboard/page.tsx:118,155`).

**Ruling R1.3.** The Profiler questionnaire runs **once per account, ever**. Course switching moves to its own route `/courses` and fires exactly one agent trigger — `plan-refresh`, the Planner, which is what the contract already models (`src/lib/contracts.ts:300-307`). `/onboarding` redirects to `/courses` whenever `onboardingComplete` is true. §4.

### 1.4 "Finding the next question takes a long time"

**Cause.** One blocking, non-streamed DeepSeek call per onboarding question, up to 13, each behind ~4 server DB round trips (`src/lib/agents/profiler.ts:132`; `src/lib/agents/ratelimit.ts:52,70`) — while the entire 13-question flow is already computable client-side with zero model calls (`profiler.ts:117-129`).

**Ruling R1.4.** The question bank is local and ships in the bundle. Phase 1 and phase 2 are answered offline at zero latency. **One** Profiler call fires at the end with all answers — the contract's `answers` array is already cumulative (`ProfilerRequest.answers`) — and it refines a profile the learner already has. If it fails, times out, or is rate-limited, the locally-derived profile stands and onboarding completes anyway. §4.

### 1.5 "Remove redundant questions"

**Cause.** `MAX_QUESTIONS = 13`; phase 2's six questions are hardcoded verbatim and mapped by a pure switch (`profiler.ts:53-60,85-101`). Three of them (verbosity, depth, agentic-coding) change no behaviour the learner can see on day one.

**Ruling R1.5.** Onboarding is **six questions, hard cap**, before the course picker: four style either-ors and two motivation questions. `verbosity` defaults to `short`, `depth` to `understand`, `wantsAgenticCoding` to `false`; all three are editable in Account and one of them is offered by the Buddy after the third session, never as a gate. Second ruling, same complaint applied to content: the bank must not serve two exercises with the same `(cloId, pattern, difficulty)` inside one chain, and the lesson generation workflow's critic pass rejects a lesson whose check restates its own worked example. §3.6, §4.2.

### 1.6 "The wellness sidebar cannot be collapsed and must not be forced to the right"

**Cause.** `src/components/shell/AppShell.tsx:46-50` welds the rail into a fixed right grid column; `Rail.tsx` accepts only a `compact` boolean. There is no position concept anywhere in the stack, and the rail re-renders at 1 Hz on every page (`Rail.tsx:30-37,120`).

**Ruling R1.6.** The wellness rail becomes the **wellness dock** with five placements (right rail, left rail, top bar, floating pill, hidden), a real collapsed state, and per-user persistence in `wellness.prefs.dock`. Hidden is never a dead end — a re-open affordance stays in the shell header. Compact mode on the exercise screen is a separate, independently persisted preference, default on. The 1 Hz interval is replaced by one shell-level clock at 1 Hz that only the components displaying seconds subscribe to. §6.

### 1.7 "The paste block only says 'Type it. That's the whole point' and the PrintScreen overlay is theatre"

**Cause.** One static string (`useLockdown.ts:87`) shown identically every time, which reads as scolding on repetition. The PrintScreen guard listens on `keyup` — after the OS has already rasterised the frame — then covers the page for two seconds and tries to blank a clipboard it usually cannot reach (`useLockdown.ts:131-141`). It prevents nothing.

**Ruling R1.7.** Keep every mechanism that works and every log row. Retire the PrintScreen overlay entirely: the event is still logged and still weighted 3, and the learner is told the truth **once per exercise, on the third press**, in one non-blocking line. Paste, copy, cut and context-menu blocking stay exactly as built; their copy becomes a rotating four-line set plus a "why" affordance that states plainly which of the three mechanisms is real enforcement, which is a signal, and which is impossible. An "Integrity, explained" panel in Account shows the learner their own itemised score with the real weights. §9.

### 1.8 "The UI is plain with no themes and no personality"

**Cause.** One grayscale theme, every token at chroma 0, `dark` hardcoded on `<html>`, `next-themes` installed and used only by the toast wrapper, `gsap`/`@gsap/react`/`motion` installed and imported nowhere, zero `Audio`/`AudioContext` in the tree, total animation surface six `animate-pulse` and two `animate-spin`.

**Ruling R1.8.** Four named themes with independently-derived OKLCH palettes — **Midnight** (dark default), **Amber** (warm dark), **Paper** (light), **Arcade** (high-contrast) — driven by `data-theme` through `next-themes` with the pre-hydration script for zero flash, plus the missing semantic tokens (`--success`, `--warning`, `--celebration`, `--destructive-foreground`, `--glow`), a per-theme elevation model, and a motion token scale. Picker in Account, quick-switch in the shell. §8.

### 1.9 "He wants an interesting, animated, rewarding UI with sound effects and fun"

**Ruling R1.9.** Ship the rewards and juice layer (§7): XP that *is* the points already computed by `pointsForPass`, a 30-level curve, streak flames, twenty achievements derived from data that already exists, celebrations on pass / chain / CLO close / level up / streak milestone / first-ever win, a fifteen-cue sound sprite behind a mute toggle and a first-gesture unlock, and confetti that respects reduced motion. **The governing rule, and the reconciliation with v1 §13: juice fires at transitions, never during composition.** Nothing animates or sounds while the learner is typing or thinking. Everything can the instant they submit.

### 1.10 "BroGram is 'the program with a b', it should act like a bro, not a teacher"

**Cause.** "Your …" opens more than thirty user-facing strings; `outcome`, `mastery`, `curriculum`, `Difficulty 3 of 5` are surfaced raw.

**Ruling R1.10.** The Bro is a named persona with four pillars, one tone dial, and a shipped string bank that the UI reads the same way the agents read their tone sentences. Domain vocabulary is translated at the edge: `outcome` → "skill", `mastery` → "how locked in you are", `CLO closed` → "skill locked", `chain` → "streak of three". §2.

### 1.11 "De-rot is super rotting. It's so boring." (owner addendum)

**Ruling R1.11.** De-rot splits into two lanes under one section with a visible switch: **Arcade** (the six coding drills, rebuilt as a game — countdown tension, combo counter, personal-best scoreboard, sound, run summary) and **Playground** (six short non-coding games — follow the dot, colour n-back, reaction tap, rhythm tap, breathing pacer, memory grid — 60 to 120 seconds each, entirely local, scoring into the same `DrillResult`). Both count for the de-rot streak. The Buddy's "go do a drill" suggestion may point at either. §7.9, §10.8-10.9.

### 1.12 "Make it the best open-source code learning platform in the world"

**Ruling R1.12.** Openness is a build constraint, not a README line. Concretely: no Vercel-only code path on any learner-facing feature (Speed Insights mounts only when `NEXT_PUBLIC_VERCEL_ENV` is present; there is no telemetry route handler); every asset in `public/` carries a row in a credits ledger naming its licence, and every asset **BroGram itself authors or curates** — sounds, images, fonts — is CC0, ISC or MIT **(critic — the original blanket claim is already false: the CheerpJ ruling at 22:33 self-hosts `tools.jar` from OpenJDK 8 under GPLv2 with the Classpath Exception. That licence is fine for a fetched-at-build runtime dependency and it is honestly disclosed, but it is not CC0/ISC/MIT, and a rule that the repo already breaks is worse than a rule that is true. The ledger, not the licence list, is what makes a fork safe.)**; content authoring is a documented workflow anyone can run (`docs/CONTENT.md`); `SETUP.md` gets a self-host path against a local Supabase; the static curriculum bundle means a fork can ship a whole different syllabus by editing `seed/` and rebuilding. §11.6, §12.

### 1.13 Carried forward without re-deciding

- **Java** ships as a browser adapter (CheerpJ, ruled GO in the build log at 23:33 with measured numbers: 382 ms cold init, 5978 ms cold compile, 2713 ms warm, 5/5 tests passing, Java 8 mode). `JUDGE_PROVIDER=none` stands; `/api/judge` answers 503; INFS3102 stays `coming-soon` until the adapter lands and the 15 parked exercises pass. **This spec does not re-decide it and does not depend on it** — no lesson, reward or budget in this document assumes Java exists.
- **Auth** stays as the owner left it: admin-issued email/password accounts, magic link behind `NEXT_PUBLIC_AUTH_MAGIC_LINK`, the `.edu.qa` hook governing self sign-ups, unredeemed invites as the allow-list.
- **The seven triggers are frozen.** Nothing in v2 adds one. Every new interaction is either pure local computation, static content, or an existing trigger.

---

## 2. The Bro

### 2.1 Who it is

One character, present everywhere, never named as a mascot and never given a face. It is the voice of the product: someone about two years ahead of you who has already made the mistake you are about to make, who is genuinely pleased when you get it, and who will not type your answer for you.

**It is not** a teacher, a coach with a whistle, a corporate assistant, or a mascot with a catchphrase. It never says "as an AI", never names a model, never guilt-trips, never celebrates its own helpfulness.

### 2.2 The four pillars

| Pillar | Means | Never |
|---|---|---|
| **Real** | Says the true thing about your code and your progress, plainly. "Third off-by-one this week" is real. | Vague positivity that could apply to anyone. "Great effort!" with nothing under it. |
| **Hyped** | Brings actual energy to wins, loudest on the first one. | Mockery dressed as banter. A joke never lands at the learner's expense. |
| **In your corner** | Default assumption is you've got this. Notices effort, not only results. Sounds like it's on your team while delivering a fail. | Guilt trips. "Checking in" as pressure. Making a day off feel like a debt. |
| **Straight-talking** | Knows the material, explains the real why, gets to the point. | Condescension. Over-explaining. Identity leaks. |

`Tone` (the frozen `playful | supportive | tough-love | direct`) selects which pillar leads. All four are the same character at different volumes — never four characters.

### 2.3 Voice rules (enforceable, tested)

1. **Under twelve words** for any celebration, toast, or button label. Under thirty for a panel body. **(critic)** One named exemption: `guard.why`, the Integrity-panel opening paragraph (§9.5), is a policy statement rather than a panel body — it is capped at sixty words and the lint test lists it by key. Without this exemption line 56 violates this rule as written.
2. **"Bro" is a flavour, not a tic.** At most once per message. Allowed in welcome, pass, streak, level-up, de-rot. **Banned** in: any integrity or lockdown string, any error whose cause is the system, any restricted/banned screen, any account or billing surface, any agent's technical detail.
3. **Never open with "Your".** The audit counted thirty-plus. A lint test (`src/lib/voice/lines.test.ts`) asserts no shipped line in the bank starts with "Your ".
4. **No emoji anywhere in copy.** Sound and motion carry the celebratory register. Enforced by the existing repo-wide check, extended to `src/lib/voice/`.
5. **Name the cause, then the next step, in that order, in the same message.** Never leave a setback with no stated way forward.
6. **Rotate.** Any line that a learner can trigger more than three times in a session ships as a set of three or four variants; `pickLine` never returns the same variant twice in a row for the same key. **(critic)** Enforced, not aspirational: every key declares a frequency class (`rare` | `session` | `hot`) and `src/lib/voice/lines.test.ts` asserts every `hot` key carries at least three variants. `hot` at launch: `pass`, `fail`, `hint`, `chain.tick`, `lesson.check.right`, `lesson.check.wrong`, `guard.paste`, `guard.blur`, `guard.idle`, `derot.run.done`, `loading.runtime`, `error.save`. Six of those shipped with two variants or one in the first draft of §2.7; the missing variants are added below.
7. **Domain words are translated at the edge.** The glossary in §2.6 is the only vocabulary a learner sees. `outcome`, `CLO`, `mastery`, `chain`, `pattern`, `difficulty N of 5` never appear in learner-facing copy. Admin and reports may use the internal words.
8. **Enforcement tone is flat.** On integrity and account-status surfaces the voice does not switch off — it goes quiet. Short, factual, no jokes, no sound, no animation.
9. **English only. No institution names. Ever.**

### 2.4 The tone dial

```
HYPE ─────────────────────────────────────────────────────────── REAL-TALK
first win · level up · streak · pass    lesson · hint · fail · empty bank · offline    blur · idle · paste blocked    restricted · banned
```

### 2.5 Where the Bro speaks

| Surface | Mechanism | Owner |
|---|---|---|
| UI copy | `src/lib/voice/lines.ts` — the string bank; components call `line('pass')`, never a literal | Claude lane (copy), Astra lane (wiring) |
| Celebration and toast copy | Same bank, keys prefixed `celebrate.*` / `toast.*` | Claude |
| Lesson prose | Authored into `seed/lessons/*.json` by the lesson workflow, critiqued against these rules | Claude (workflow) |
| The seven agents | Existing tone sentences appended to each system prompt, plus a one-paragraph identity rewrite in each agent's `system` string | Claude |
| Empty, error and loading states | Same bank, keys `empty.*` / `error.*` / `loading.*` | Claude |
| Lockdown and integrity | Same bank, keys `guard.*` — **flat register, no "bro", no sound** | Claude |
| Achievement names and lines | `ACHIEVEMENTS` in contracts, §7.5 | Claude |

The bank is a plain module so it is unit-testable, greppable, and forkable:

```ts
// src/lib/voice/lines.ts
export type LineKey =
  | 'welcome' | 'onboard.q.intro' | 'onboard.done'
  | 'lesson.start' | 'lesson.check.right' | 'lesson.check.wrong' | 'lesson.done' | 'lesson.skip'
  | 'pass' | 'pass.first' | 'fail' | 'hint' | 'hint.last' | 'chain.tick' | 'clo.close' | 'course.clear'
  | 'streak.keep' | 'streak.milestone' | 'streak.lost' | 'level.up' | 'best' | 'goal.done'
  | 'derot.arcade.enter' | 'derot.play.enter' | 'derot.run.done'
  | 'guard.paste' | 'guard.blur' | 'guard.idle' | 'guard.printscreen' | 'guard.why'
  | 'empty.bank' | 'empty.trophies' | 'error.offline' | 'error.save' | 'loading.plan' | 'loading.runtime'

/** Deterministic-per-render, never the same variant twice in a row for one key. */
export function line(key: LineKey): string
export function lineWith(key: LineKey, vars: Record<string, string | number>): string
```

### 2.6 Glossary — the only words a learner sees

| Internal | Learner-facing |
|---|---|
| CLO / learning outcome | **skill** |
| `Clo.outcome` sentence | **what this skill is** |
| mastery score | **how locked in you are** (a bar, not a number) |
| CLO closed | **skill locked** |
| chain 1/2/3 | **1 of 3 in a row** |
| pattern | **angle** (as in "a different angle on the same skill") |
| difficulty 3 of 5 | **medium** (1 easy, 2 light, 3 medium, 4 spicy, 5 brutal) |
| bank / exercise | **rep** |
| lesson | **walkthrough** |
| de-rot | **De-rot** (kept; it is the owner's word and it has personality) |
| attempt | **run** (free) / **submit** (graded) |
| integrity score | **flags** |

### 2.7 The shipped string set

No emoji. No institution names. `{n}`, `{name}`, `{skill}`, `{time}` are interpolation slots. Variants rotate.

**Welcome / onboarding**
1. `welcome` — "Yo. This is BroGram — the program with a B. Hands on the keyboard from line one."
2. `welcome` — "You're in. No lectures, no fluff. You write code, it tells you the truth."
3. `welcome` — "Welcome. Six quick questions, then we get to work."
4. `onboard.q.intro` — "Nothing here is a test. Pick whichever is more you."
5. `onboard.q.intro` — "Six questions. Twenty seconds. Then we're done asking."
6. `onboard.done` — "Locked in. Pick a course and let's see what you've got."
7. `onboard.done` — "Got it. That's the last question you'll get from us."

**Walkthrough (lesson)**
8. `lesson.start` — "Walkthrough first. Read it, run it, then you drive."
9. `lesson.start` — "Nothing's graded in here. Poke at it."
10. `lesson.start` — "Short one. Then a real rep."
11. `lesson.check.right` — "That's it."
12. `lesson.check.right` — "Yep. Exactly that."
13. `lesson.check.right` — "Clean."
14. `lesson.check.wrong` — "Not quite. Look at line {n} again."
15. `lesson.check.wrong` — "Close. Read what it actually prints, not what you'd want it to."
16. `lesson.check.wrong` — "Nope. Here's the part that bites people."
17. `lesson.done` — "That's the idea. Go take a real one."
18. `lesson.done` — "You've got the shape of it. Rep time."
19. `lesson.skip` — "Fair. It's here if you want it later."

**Pass / fail / hint**
20. `pass.first` — "First one down. That feeling is the whole product."
21. `pass` — "Nailed it. Green across the board."
22. `pass` — "That's a pass. Next one before you get comfortable."
23. `pass` — "Clean run. Whatever just clicked, it stuck."
24. `pass` — "Done. Zero hints on that one." *(variant used only when `hintCount === 0`)*
25. `fail` — "Not this time. Let's look at what broke."
26. `fail` — "Tests disagree. Take another pass."
27. `fail` — "That one didn't land. Which is literally what this is for."
28. `hint` — "Here's a nudge. Not the answer."
29. `hint` — "One push. The rest is yours."
29b. `hint` — "Pointing at it, not solving it." **(critic — third variant, rule 6)**
30. `hint.last` — "Last hint on this one. Make it count."

**Progress**
31. `chain.tick` — "{n} of 3, different angle each time."
31b. `chain.tick` — "{n} of 3. New angle next." **(critic — rule 6)**
31c. `chain.tick` — "That's {n}. Same idea, different shape." **(critic — rule 6)**
32. `clo.close` — "{skill} — locked."
33. `clo.close` — "That skill is yours. Three angles, three passes."
34. `course.clear` — "Whole course, cleared. Go look at where you started."
35. `streak.keep` — "Day {n}. Same time tomorrow."
36. `streak.keep` — "Streak's alive."
37. `streak.milestone` — "{n} days straight. That's not luck."
38. `streak.lost` — "Streak reset. Start a new one today — takes one rep."
39. `level.up` — "Level {n}. The reps get sharper from here."
40. `level.up` — "Level {n}. Look back at your first one."
41. `best` — "New personal best. {n}."
42. `goal.done` — "Daily goal, done. Anything past this is profit."

**De-rot**
43. `derot.arcade.enter` — "Timer's on. Beat yesterday's you."
44. `derot.play.enter` — "No code in here. Just you and the screen."
45. `derot.run.done` — "Run over. {n} points, {m} combo."
46. `derot.run.done` — "That's the run. Sharper than last time."

**Guards — flat register, no "bro", no sound**
47. `guard.paste` — "Paste is off on this screen. Type it out." **(critic — the original, "Typed, not pasted. Your fingers do the learning.", is a lecture; rule 8 and R9.6 require a flat register on guard surfaces. Four rotating sermons is still a sermon, which is the owner's original complaint.)**
48. `guard.paste` — "Blocked. Typing is the exercise."
49. `guard.paste` — "Not pasteable here. Type it." **(critic — was "Copy-paste doesn't build the muscle. Type it.")**
50. `guard.paste` — "Keyboard only on this screen." **(critic — "That's the rep" is persona; guards get none.)**
51. `guard.blur` — "Paused — you clicked away. Come back to pick it up."
52. `guard.blur` — "Work's held right here. Click back in when you're ready."
52b. `guard.blur` — "Paused. Nothing was lost." **(critic — rule 6)**
53. `guard.idle` — "Quiet for a bit, so we paused. Type anything to keep going."
54. `guard.idle` — "Still here, still yours. Jump back in whenever."
54b. `guard.idle` — "Paused after a quiet stretch. Any key resumes." **(critic — rule 6)**
55. `guard.printscreen` — "Screenshots aren't something a website can block. We log the attempt and move on."
56. `guard.why` — "Paste is the one thing browsers actually let us stop, so we stop it. Leaving the tab and pressing PrintScreen are signals we log, not things we can prevent. Screenshots can't be prevented by anyone. The real backstop is that your exercises aren't the same as anyone else's."

**Empty / error / loading**
57. `empty.bank` — "Out of fresh reps at this angle. Writing you one now."
58. `empty.trophies` — "Nothing on the shelf yet. First pass puts something here."
59. `error.offline` — "No connection. Your code still runs — we just can't save it yet."
60. `error.save` — "That didn't save. Your result stands; we'll retry."
60b. `error.save` — "Save failed. The result is real; retrying." **(critic — rule 6)**
60c. `error.save` — "Couldn't reach the server. Holding it, trying again." **(critic — rule 6)**
61. `loading.plan` — "Lining up your path."
62. `loading.runtime` — "Warming up {name}. First time is the slow one."
62b. `loading.runtime` — "Getting {name} on its feet." **(critic — rule 6)**
62c. `loading.runtime` — "Loading {name}. The bar is real progress, not a guess." **(critic — rule 6)**

### 2.8 Agent identity rewrites (copy-only, no schema touched)

Each of the seven agents keeps every hard rule it has — the Buddy's on-topic gate and fixed refusal sentence, the Coach's single-line `codeLine` cap, the JSON-only contract, the token budgets, the fallbacks. Only the identity paragraph at the top of each `system` string changes, from institutional to the four pillars. The machine-checked `prompts.test.ts` is updated in the same commit so the prompts stay byte-pinned.

---

## 3. Learn before you test

### 3.1 The shape, and why it is this shape

Every product researched converges on the same four steps, and the pedagogy behind it has a name — the worked-example effect paired with gradual release:

1. **Concept.** One idea, plainly. Not the topic. Not five ideas.
2. **Worked example.** The idea solved once, fully, with the reasoning visible.
3. **Guided checks.** One to three small graded-instantly-in-place checks against exactly that idea.
4. **The rep.** The real bank exercise with hidden tests. This already exists and does not change.

**Ruling R3.1.** The lesson unit is **per learning outcome (`CloId`)**, not per exercise. 26 CLOs at launch is authorable; 95-350 exercises is not. One lesson teaches the idea; the bank's many exercises drill it from different angles.

**Ruling R3.2.** Lessons add **no agent trigger**. Every check is graded locally by code that already exists. "Explain that differently" inside a lesson opens the Buddy drawer, which uses the existing `buddy-message` trigger.

**Ruling R3.3.** A lesson is a **strong default, never a lock**. The course home puts it first and the exercise screen shows a "walkthrough" link in the prompt panel header, but nothing is gated. "I've got this" records `status: 'skipped'` and the map node carries a small skipped marker. Autonomy is the point.

### 3.2 The content schema

Files: `seed/lessons/<COURSE_CODE>.json`, one per course, validated by `seed/validate.mjs` (extended) against `seed/lessons/lesson.schema.json`.

```jsonc
{
  "$note": "BroGram lessons. One lesson per CLO. No institution names, no pattern ids, no emoji.",
  "course": "INFS1101",
  "lessons": [
    {
      "id": "INFS1101-3",                 // (critic) EXACTLY the cloId. The first draft used "<cloId>-L<version>" AND a separate `version` column: two versioning mechanisms that fight. Because `lesson_progress.lesson_id` is a foreign key with `on delete cascade`, a version bump under the old scheme minted a new id, orphaned every learner's progress row, re-marked finished walkthroughs as unseen and silently un-earned `read-the-manual` and `full-read`. One lesson per CLO (R3.1) means the CLO id is already unique; `version` alone carries staleness.
      "cloId": "INFS1101-3",
      "course": "INFS1101",
      "language": "python",               // Language; drives snippet runtime and editor grammar
      "version": 1,                       // the ONLY version mechanism. lesson_progress.lesson_version < lessons.version => show a "this was rewritten" marker; progress is never deleted.
      "title": "Loops that stop when you tell them to",
      "hook": "Every loop you write is one of three shapes. Here they are.",
      "estimatedMinutes": 6,              // 4-8; the workflow rejects anything over 8
      "draft": false,                     // mirrors Clo.draft; renders the muted marker
      "tags": ["iteration", "guard"],
      "blocks": [ /* see 3.3 */ ],
      "exitLine": "That's the whole idea. Go take a real one."
    }
  ]
}
```

**Invariants the validator enforces:** exactly one `concept` block, exactly one `worked` block, one to three `check` blocks, exactly one `recap`, exactly one `bridge`, blocks in that order, total blocks ≤ 8, every code string ≤ 20 lines and ≤ 90 columns, no string matches `/\b(CLO|learning outcome|syllabus)\b/i`, no string contains a pattern id from `seed/patterns.json`, no emoji, `language` matches the CLO's course language (or `sql`/`mongo` for the two mixed CLOs).

### 3.3 Block types (discriminated union on `type`)

```ts
// added to src/lib/contracts.ts — see §11.4
export type LessonBlock =
  | LessonConcept | LessonSnippet | LessonWorked | LessonCheck | LessonRecap | LessonBridge

export interface LessonConcept {
  type: 'concept'
  id: string
  heading: string                 // <= 60 chars
  body: string                    // markdown, <= 120 words, plain language, second person
  /** Optional inline SVG. No external assets, no <script>, no <foreignObject>. Sanitised at build. */
  figure?: string
}

export interface LessonSnippet {
  type: 'snippet'
  id: string
  language: Language
  code: string
  /** true = a Run button appears; the learner may edit and re-run freely. Nothing is graded. */
  runnable: boolean
  /** Certified by the verifier, never shown to the learner. Empty string for snippets with no stdout. */
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
  /** Revealed one at a time as the learner steps through. 2-6 steps. */
  steps: { line: number | [number, number]; say: string }[]   // say <= 22 words
  caption?: string
}

export type LessonCheck =
  | { type: 'check'; id: string; kind: 'predict-output'; prompt: string; language: Language; code: string
      expected: string; normalize: 'lines' | 'exact'; hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'choose'; prompt: string
      options: string[]; correctIndex: number
      /** One line per option. Shown the instant that option is chosen — this is where the teaching happens. */
      why: string[]; hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'spot-the-bug'; prompt: string; language: Language; code: string
      bugLines: number[]; hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'fill-blank'; prompt: string; language: Language
      /** Template with __1__, __2__ markers. */
      template: string
      blanks: { id: string; accept: string[] }[]   // accept is compared case-insensitively, trimmed
      hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'micro-code'; prompt: string; language: Language
      starterCode: string
      /** 2-3 tests, ALL visible. A check is not a hidden-test wall. */
      tests: TestCase[]
      referenceSolution: string     // stripped from the client payload at build (see R3.5)
      hint: string; explain: string }

export interface LessonRecap {
  type: 'recap'
  id: string
  bullets: string[]     // exactly 2 or 3, <= 14 words each
  remember: string      // one line the learner should still have in a week
}

export interface LessonBridge {
  type: 'bridge'
  id: string
  say: string           // the handoff, in voice, <= 20 words
}
```

**Ruling R3.4 — inline runnable snippets reuse the existing runtimes, unchanged.** A `snippet` with `runnable: true` calls `getRuntime(language).run({ language, code, tests: [], fixture, timeoutMs: 5000, packages })` — the same free-run path the exercise screen's Run button already uses (`src/lib/exercise/grading.ts:exerciseRunRequest`). A `micro-code` check calls the same adapter with its two or three visible tests. `web`, `sql` and `mongo` snippets carry their `fixture` exactly as an exercise does. **Java snippets are static-only (`runnable: false`) until the CheerpJ adapter lands.**

**Ruling R3.5 — lesson secrecy mirrors exercise secrecy.** `LessonPublic` is the shipped shape: `Omit` of every `micro-code` check's `referenceSolution`, produced by the static-curriculum build step. The `lessons` table keeps the full row; the client never receives a reference solution, exactly as `exercises_public` already does. `expectedStdout` on a snippet is a verifier artifact and is also stripped from the public payload.

**Ruling R3.6 — grading is local and reuses what exists.** All four non-`micro-code` kinds are graded by pure functions in a new `src/lib/lesson/grade.ts`; `micro-code` runs the runtime adapter. No check ever calls an agent.

**(critic) Corrected: the first draft named the wrong function and the wrong module.** `gradeAnswer` (`src/lib/exercise/grading.ts:12`) takes an `ExercisePublic`, which a `LessonCheck` is not, and its `predict-output` path normalises with `text.trim().replace(/\s+/g, ' ')` — it collapses newlines, which is the exact bug the 23:07 ruling fixed **elsewhere**. The per-line, newline-significant implementation the ruling produced lives in `src/components/derot/scoring.ts` as `normalizeOutput` / `gradePredictOutput`, not in `grading.ts`. Concretely:

| Check kind | Grader | Note |
|---|---|---|
| `predict-output` | `gradePredictOutput` from `src/components/derot/scoring.ts` when `normalize: 'lines'`; strict `===` on the raw strings when `normalize: 'exact'` | `normalize` exists on the block because a lesson sometimes wants trailing-space significance; neither existing grader supports it, so `src/lib/lesson/grade.ts` owns the switch |
| `spot-the-bug` | `gradeSpotTheBug` from `src/components/derot/scoring.ts` (clicked line in the bug-line set) | already set-based, already tested |
| `choose`, `fill-blank` | new pure functions in `src/lib/lesson/grade.ts` | `fill-blank` compares trimmed and case-insensitively against `accept` |
| `micro-code` | `getRuntime(language).run(...)` with the two or three visible tests | |

A follow-on ledger row (not a v2 blocker): `gradeAnswer`'s `predict-output` branch still collapses newlines and should be switched to `normalizeOutput` so the exercise loop and the lessons agree. That is a one-line change plus a test, and it is a live inconsistency in v1, not something v2 introduces.

**Ruling R3.7 — checks never punish.** Unlimited attempts, nothing consumed, no red flash. First wrong answer reveals `hint`; second reveals `explain` and marks the check answered so the learner can move on. A wrong check is recorded in `lesson_progress.checks_failed` for content quality only — it never touches `mastery`, `points`, or the integrity score.

### 3.4 The lesson screen

Route: `/(app)/lesson/[cloId]`. One column, max width 720px, the same editor component the exercise screen uses (lazy-loaded, one grammar). Blocks render as a vertical sequence with a slim progress rail on the left showing block count. Motion in §10.5.

### 3.5 Course home and the path map

Route: `/(app)/course/[code]`. This replaces the flat "Next exercises" list as the place a course starts.

**What it shows, top to bottom:**
1. Course header — title, language chip, your level and XP for this course, the daily-goal ring.
2. **The path map** — the centrepiece. Nodes are CLOs, laid out along `LearnerState.path` order, connected by edges drawn from `Clo.prerequisites` (not just sequence) so the learner sees *why* something opened.
3. **Next up** — the stack of three cards (below).
4. A collapsed "everything in this course" list for learners who want the flat view.

**Node states — every one a pure derivation of data that already exists, zero new fields:**

| State | Derivation | Look |
|---|---|---|
| Locked | some `prerequisites` CLO **that is in this course** is not `closed` | dim, hairline outline, no fill |
| Available | prerequisites closed, `chain === 0`, not `closed` | solid outline, `--primary` ring |
| Walkthrough ready | Available **and** the learner has no `lesson_progress` row for this lesson, or has one with `status = 'started'` | Available plus a small book glyph |
| In progress | `chain > 0 && !closed` | fill to `chain/3`, `--primary` |
| Locked in | `closed === true` | full fill, `--celebration` edge, permanent |
| Draft | `draft === true` on the CLO row in the static curriculum bundle | muted, "drafted" marker, still usable (the ruling at 22:33 stands) |

**(critic) Three corrections to this table, all of which would have shipped as bugs.**

1. **`Clo.draft` does not exist on the frozen contract.** `draft` is a real column in `seed/clos.json` and in `public.clos`, but `interface Clo` in `src/lib/contracts.ts` has no such field, and §11.4 lists `Clo` under "explicitly not changed". So either §11.4 gains `Clo.draft?: boolean` (additive, every stored row already has the column, zero migration) or the map reads `draft` off the generated curriculum row type. **Ruling: add `Clo.draft?: boolean` to the contracts PR** — §11.4 item 14 — because the Planner and the bank both already have a legitimate reason to know, and a second parallel row type is worse than one optional field.
2. **`unseen` is not a status.** The `lesson_progress` check constraint in `0006_lessons.sql` is `status in ('started','completed','skipped')` and the `LessonProgress` contract in §11.4 item 9 says the same. "Unseen" is the absence of a row, and the derivation above now says so.
3. **Locked must ignore cross-course prerequisites.** `Clo.prerequisites` crosses course boundaries in the shipped seed — `INFS1201-1` lists `INFS1101-4`. Under the original wording, a learner whose *first* course is INFS1201 sees every node in it permanently locked, because a CLO in a course they have never opened is not `closed`. Prerequisites outside the current course are advisory only: they may be drawn as a faint inbound edge with a "comes from another course" label, and they never gate. The same rule applies to `provisionalPlan()`'s topological sort in §4.3 — it sorts on in-course prerequisites and ignores dangling external ids rather than treating them as a cycle.

**Ruling R3.8 — how the Planner's next three fit.** "The current CLO" is a derivation, not a stored field: the first CLO in `LearnerState.path` whose `mastery[cloId].closed` is false, falling back to the last CLO in the path when all are closed. **(critic — `LearnerState` has no current-CLO pointer and inventing one would be a contract change.)** The "Next up" stack is always exactly three cards:
- If the current CLO has no `lesson_progress` row, or one with `status = 'started'`: card 1 is **Walkthrough — {title}**, cards 2 and 3 are the Planner's first two `nextExerciseIds`, shown at full opacity with a one-line "after the walkthrough, or skip it" caption. Nothing is disabled.
- Otherwise: the three cards are `LearnerState.nextExerciseIds` in Planner order.
- If `nextExerciseIds` is short (fresh account, bank widening), the client fills from `pickFromBank` locally and marks the card "picked for you" — it never renders an empty slot and never waits on an agent to render.

### 3.6 How lessons are generated offline, and reviewed

New workflow `docs/workflows/lesson-generation.js`, same four-phase shape as `exercise-bank-generation.js` so the runner, journal and resume behaviour are already proven.

```
phase('Author')   one agent per CLO  -> seed/lessons/by-clo/<cloId>.json
phase('Verify')   node scripts/verify-lesson.mjs <file>  (executes every runnable snippet and every check)
phase('Merge')    concatenate into seed/lessons/<COURSE>.json
phase('Critique') voice, redundancy, leak and reading-level pass
```

**Author prompt** (`docs/prompts/agents/08-lesson-author.md`, and the workflow instructs the agent to follow it exactly, the same way the exercise workflow points at `03-author.md`):

> You are writing one BroGram walkthrough for one skill. Read `docs/prompts/agents/03-author.md` for the house style on code and tests, `src/lib/contracts.ts` for `LessonBlock` and `TestCase`, `seed/lessons/lesson.schema.json` for the exact shape, and `docs/superpowers/specs/2026-09-06-brogram-v2-bro.md` §2 for the voice.
>
> Target skill: `{clo}`. Language: `{language}`. The learner has just finished `{prerequisiteOutcomes}` and has never seen this idea.
>
> Write, in this order: one `concept` block of at most 120 words teaching **one** idea in plain second-person language (no jargon that is not defined in the same block); optionally one runnable `snippet` that shows the idea alive in under 12 lines; one `worked` block that solves one instance of the idea completely, with 3 to 5 step callouts of at most 22 words each explaining *why*, not *what*; one to three `check` blocks that test **the concept you just taught and nothing else** — vary the kinds, prefer `predict-output` or `choose` for a first check and `micro-code` only as the last one; one `recap` of two or three bullets plus one `remember` line; one `bridge` handing off to the real rep.
>
> Hard rules. Never state the answer to a check inside the worked example. Never restate the worked example as a check — a check must require a step the learner has to take themselves. Never mention any university, instructor, course code, the string "CLO", "learning outcome", or any pattern id. Never use emoji. Every code sample must be independently runnable and correct. For `micro-code`, all tests are visible and there are at most three. Keep the whole thing under eight minutes of reading and doing.
>
> Write `{ "lessons": [ ... ] }` to `seed/lessons/by-clo/{cloId}.json`. Return json `{ cloId, file, blockCount, checkKinds, estimatedMinutes }`.

**Verifier** (`scripts/verify-lesson.mjs`, sibling of the proven `scripts/verify-exercise.mjs`): for every `snippet` with `runnable: true`, execute it in the real runtime and assert stdout equals `expectedStdout`; for every `predict-output` check, execute `code` and assert the runtime's stdout equals `expected` under the declared normalisation; for every `micro-code` check, run `referenceSolution` against `tests` and require all pass; for every `spot-the-bug`, assert the code with `bugLines` removed or corrected is not required (structural check only — the bug lines must be within the code's line count); for `fill-blank`, assert the template's markers match the blank ids and that filling with `accept[0]` produces code that parses. Exit non-zero with a per-lesson failure list. Java lessons report `unverified` and must ship `runnable: false`.

**Critic phase** rejects, and fixes in place: any voice-rule violation from §2.3 (line-opening "Your", emoji, over-length celebration copy, "bro" in a guard string); any check whose correct answer is stated verbatim in the concept or worked block (the redundancy rule from R1.5); any lesson over 8 estimated minutes; any duplicated story or variable-naming tic across lessons in the same course; any leak (institution, pattern id, "CLO").

**Human review gate.** Same discipline as the bank: execution verification plus the critic pass **is** the review for content. One human read of the first lesson per course before the batch is committed, because the first lesson sets the register for the rest.

**Launch target.** One lesson per code-assessable CLO across the five live courses (23 lessons), plus honestly-shortened lessons for the three non-code-assessable CLOs. Drafted CLOs (INFS1201, all four) get a lesson marked `draft: true`.

---

## 4. Onboarding once

### 4.1 The six questions, all local

`src/lib/onboarding/questions.ts` ships the whole flow. It is generated from — and a test asserts it stays identical in ids and text to — `src/lib/agents/fixtures/profiler-fallback.json` plus the hardcoded phase-2 set in `src/lib/agents/profiler.ts:53-60`, so the local bank and the agent's own fallback can never drift.

| # | Phase | Question | Options | Feeds |
|---|---|---|---|---|
| 1 | 1 | "A new idea lands better as…" | a diagram / a paragraph | `styleVector.visual`/`verbal` |
| 2 | 1 | "Show me…" | a worked example first / the rule first | `styleVector.example`/`theory` |
| 3 | 1 | "When something breaks you…" | read the code / read the error | `styleVector.verbal`, `learningStyle` |
| 4 | 1 | "You'd rather…" | watch it run / reason it out on paper | `styleVector.visual`/`theory` |
| 5 | 2 | "Why are you here?" | pass the course / actually understand this / get good enough to build things | `motivation.why`, `motivation.depth` |
| 6 | 2 | "How should this thing talk to you?" | hype me up / keep me steady / push me hard / just the facts | `tone` |

**Ruling R4.1.** `MAX_QUESTIONS` becomes 6 and the phase-1/phase-2 split is preserved in the ids (`p1q*`, `p2q*`) so the Profiler's own id-prefix counting (fixed in C1 round 4) still works. Cut and defaulted: `verbosity: 'short'`, `motivation.beyondCourses: false`, `motivation.wantsAgenticCoding: false`. All three are editable in Account under "How the Bro talks"; the Buddy offers the `beyondCourses` question once, after the third session, in conversation, never as a gate.

**Ruling R4.2.** Answers are applied to a **provisional profile the instant a card is tapped**, by the pure local scorer (`styleFromAnswers` and the phase-2 switch, both already pure in `profiler.ts:70-101` and both moved to `src/lib/onboarding/derive.ts` so the client can call them without importing the agent module). The next card renders in the same frame. There is no busy state between cards, ever.

### 4.2 One Profiler call, at the end, non-blocking

On the sixth answer:

1. The provisional profile is complete and already in the Zustand session store.
2. The UI advances straight to the course picker. **No spinner.**
3. In the background, one `callAgent({ agent: 'profiler', trigger: 'onboarding-answer', phase: 2, answers: <all six, cumulative> })` fires. The contract already supports this: `ProfilerRequest.answers` is the cumulative array and `phase` is a plain discriminator.
4. On success, the reply's `profileDelta` is merged over the provisional profile (motivation merged key-by-key, never replaced — the contract's own note). If `tone` or `learningStyle` changed, nothing visible happens; the next agent call simply carries the better values.
5. On failure, timeout, rate-limit, or `AGENT_DRY_RUN`, the provisional profile stands. `onboardingComplete` is set to `true` either way, in the same `learner_state` write.

**Ruling R4.3.** Onboarding never blocks on a network call. The only irreducible wait in the whole flow is the Planner, and §4.3 removes that from the critical path too.

### 4.3 Course switching without re-onboarding

**Ruling R4.4.** New route `/(app)/courses` owns picking and switching. `/(app)/onboarding` reads `session.learnerState.profile.onboardingComplete` on mount and `redirect`s to `/courses` when true. The dashboard's "Change course" and "Review your course" links point at `/courses`. The Profiler is unreachable after onboarding completes — a Playwright assertion covers this.

**The switch, in order (all client-side except one background call):**

1. Learner taps a course card. **Optimistic navigation to `/course/{code}` in the same frame.**
2. `provisionalPlan()` (new, pure, unit-tested, `src/lib/learner/provisional.ts`) computes a path and three next exercises from data already in the bundle:
   - `path` = the course's CLOs in `ordinal` order (which is already prerequisite-respecting in the seed; the function still topologically sorts on `Clo.prerequisites` and falls back to ordinal on a cycle).
   - `nextExerciseIds` = `pickFromBank` (the existing widening-tier selector) against the first non-closed CLO at `DEFAULT_DIFFICULTY`, three distinct patterns.
3. The path map, the Next-up stack and the walkthrough card render immediately from that.
4. One `plan-refresh` call to the Planner fires in the background with the course's CLOs and the pre-fetched candidates — exactly the existing contract, exactly one of the seven triggers.
5. When it returns, the state is reconciled. If the order or the three ids actually changed, one quiet toast: "Path tuned." If nothing changed, nothing is said.
6. `learner_state` is written once, with the version guard, carrying whichever plan is final.

If the Planner fails, the provisional plan is kept and persisted. A course is never unusable because a model call failed.

**Ruling R4.5.** Switching courses **never** resets progress. `mastery`, `points`, both streaks, achievements and `lesson_progress` are account-level and course-keyed; the learner can switch back and find everything where they left it.

### 4.4 The returning user

Sign-in lands on `/dashboard` ("Today"), which server-renders from the layout's already-fetched `learner_state`:

- **Resume card** first: the exercise or walkthrough in flight, with elapsed context ("you were 2 of 3 into {skill}").
- Streak state with today's status — kept, at risk (after 18:00 local with no rep), or reset.
- Daily-goal ring.
- Next up (three cards, §3.5 rules).
- The last three trophies and the level bar.
- De-rot entry with the de-rot streak.

Nothing on this screen waits on an agent, and the whole above-the-fold block is server-rendered text, not a client fetch.

---

## 5. Speed

### 5.1 Data classification — the single decision that removes most of the latency

| Data | Source of truth | What the browser actually reads | Invalidated by |
|---|---|---|---|
| Courses, CLOs, patterns | `seed/*.json` → Supabase (authoring, admin) | **Bundled TypeScript module**, generated at build | redeploy |
| Exercises (`ExercisePublic`) | `seed/exercises/*.json` → Supabase | **Static JSON per course**, `public/curriculum/course/<CODE>.json` | redeploy |
| Lessons (`LessonPublic`) | `seed/lessons/*.json` → Supabase | same per-course file | redeploy |
| Drill items | `seed/drills/*.json` | `public/curriculum/drills/<kind>.json` | redeploy |
| Onboarding questions | `src/lib/onboarding/questions.ts` | bundled | redeploy |
| `learner_state` | Supabase, per user | SSR-seeded once in `(app)/layout.tsx`, then TanStack Query | mutation, or 30 s stale |
| `attempts` | Supabase, per user | TanStack Query, **capped at 50, newest first** | new attempt, or 30 s |
| `wellness` (prefs, logs, drill results) | Supabase, per user | localStorage-first, TanStack Query mutation writes through | mutation |
| `lesson_progress`, `user_achievements` | Supabase, per user | SSR-seeded, TanStack Query, optimistic | mutation |
| `integrity_events` | Supabase | write-only from the client; the breakdown comes from one RPC | n/a |
| Agent replies | `/api/agent` | never cached — `useMutation` only | every trigger, by design |

**Ruling R5.1 — the curriculum leaves the network.** `scripts/build-static-curriculum.mjs` runs as `prebuild`. It reads `seed/`, applies exactly the filters the current Supabase queries apply (`status === 'live'`, `verified === true`), strips `referenceSolution` from every exercise and every `micro-code` check and `expectedStdout` from every snippet, and writes:

```
src/lib/curriculum/generated.ts          courses[], clos[], patterns[]  (~28 KB raw, bundled)
public/curriculum/manifest.json          { buildId, files: { "<CODE>": "<sha1>" } }
public/curriculum/course/<CODE>.json     { clos, exercises: ExercisePublic[], lessons: LessonPublic[] }
public/curriculum/drills/<kind>.json     DrillItem[]
```

Per-course files are fetched once with `fetch('/curriculum/course/INFS1101.json?v=' + hash, { cache: 'force-cache' })` and memoised for the session, with these headers set in `next.config.ts`:

```ts
async headers() {
  return [{
    source: '/curriculum/:path*',
    headers: [{ key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=604800' }],
  }]
}
```

This respects v1 non-negotiable #3 ("Vercel exists only to call DeepSeek and proxy the judge") — a static file is served by the CDN with **zero function invocations**. Supabase remains the authoring source of truth and the admin surface's data; only the learner's hot path changes. Trade-off, stated plainly: a content edit needs a rebuild to reach learners. The content is authored offline in batches; this is the right trade.

**(critic) Two consequences the first draft left implicit. Both are rulings, not caveats.**

**R5.1a — the seed bank becomes unauthenticated public data, and that is accepted on the record.** `exercises_public` is gated by `public.is_not_banned()` and by `origin = 'seed' or author_user_id = auth.uid()`. A file under `public/curriculum/` has no gate at all: anyone with the URL, signed out or banned, gets every seed exercise with every hidden test's `expected` value. This is a real change in exposure, and it is acceptable for exactly one reason — `seed/exercises/*.json` is already committed to a public MIT repository (v1 §14), so the marginal loss is a URL, not a secret. What it does **not** cover is the ban gate: a banned account can still read the curriculum. That is fine, because reading exercises is not the thing a ban withholds — submitting attempts is, and that stays behind RLS. Do not use this precedent to move anything user-owned into `public/`. `referenceSolution` and snippet `expectedStdout` remain server-only and the §11.3 test asserts it.

**R5.1b — runtime-generated exercises are not in the bundle, so `/exercise/[id]` is 1 or 2 reads, not always 1.** Bank-miss exercises are inserted with `origin='generated'`, `author_user_id` set, and are visible only to their author; they can never live in a shared static file. The exercise page resolves an id against the memoised static course file first and falls through to a single `exercises_public` read only when the id is not there. §5.6's round-trip row is corrected accordingly. A learner in a well-stocked CLO pays 1; a learner on a freshly authored variant pays 2.

### 5.2 TanStack Query v5, seeded from the server

Add `@tanstack/react-query@^5.102.8`. `src/components/shell/QueryProvider.tsx` follows the Next.js 16 guide's documented singleton pattern (one client per server render, one reused in the browser). It wraps `SessionProvider` in `(app)/layout.tsx`; the two are complementary — Zustand keeps the session snapshot the whole shell reads synchronously, Query owns fetching, caching, dedupe and mutations.

**SSR hydration.** The layout already assembles `learner_state`, capped attempts and wellness server-side. It passes them as props into a client `<QuerySeed>` that calls `queryClient.setQueryData` once on mount for `['learner-state', userId]`, `['attempts', userId]`, `['wellness', userId]`, `['lesson-progress', userId]` and `['achievements', userId]`. This is the lighter documented alternative to `dehydrate`/`HydrationBoundary`, and it is the correct one here because the layout reads through the Supabase server client, not `fetch`. Full `HydrationBoundary` is deferred to the Cache Components phase (§5.8).

**Stale times.**

| Key | `staleTime` | `gcTime` |
|---|---|---|
| `['curriculum', code]` | `Infinity` | `Infinity` |
| `['learner-state', userId]` | `30_000` | `300_000` |
| `['attempts', userId]` | `30_000` | `300_000` |
| `['wellness', userId]` | `Infinity` | `Infinity` |
| `['lesson-progress', userId]` | `Infinity` | `Infinity` |
| `['achievements', userId]` | `Infinity` | `Infinity` |
| any agent call | never a query — `useMutation` only | — |

**Ruling R5.2.** The layout's unbounded `attempts` pager (`layout.tsx:35-44`) is deleted. Streaks come from `learner_state`, which already carries them.

**(critic) A 50-row attempts window cannot carry the streak, and the first draft's "the client recomputes only from the capped 50-row window" quietly breaks three things.** At a modest three reps a day, 50 rows is about sixteen days — so a 30-day streak is unverifiable, the `thirty` achievement (§7.5 #14) is unreachable, and the known open bug recorded in the build log at 23:29 ("hydrated streaks never expire in the (app) layout") comes straight back, because a stored streak with no independent activity source has nothing to expire against. **Ruling R5.2a:** add one narrow read path in the same migration as §11.2's breakdown function —

```sql
-- Distinct UTC activity dates for the calling user only. Aggregate, tiny,
-- and the only thing streak math actually needs. No rows, no code, no results.
create or replace function public.my_activity_days(window_days int default 120)
returns table (kind text, day date)
language sql security definer set search_path = public, pg_temp stable as $
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
$;
```

One call per session, seeded into `['activity-days', userId]` with `staleTime: Infinity`, invalidated by the attempt and drill mutations. It is bounded (at most 120 rows of two small columns), it replaces the pager it deletes, and it makes both streaks and the `kept-the-promise` derivation honest. The 50-row `['attempts', userId]` window stays exactly as specified for everything else. `/reports` gets its own `['report-attempts', userId]` query with a 1000-row cap, fetched only when the report tab is opened, selecting `id, exercise_id, passed, duration_ms, hint_count, created_at` — never `code`, never `results`.

### 5.3 Optimistic mutations

Every one uses the documented `onMutate` → snapshot → `setQueryData` → `onError` rollback shape. `LearnerState.version` is the server-side guard that makes this safe; it was designed for exactly this and has never been used from the client.

| Mutation | Optimistic behaviour | Reconciliation | Rollback |
|---|---|---|---|
| **Attempt submit** | The browser knows pass/fail the instant `getRuntime().run()` resolves. A new terminal-ish status `'graded'` fires there: results panel, pass/fail, XP delta, chain pip, mastery bar and the celebration all render **immediately**. XP uses the neutral `quality = 70` already used on reload. | The existing `finishSubmission()` chain runs untouched in the background. When the Reviewer's real `quality` lands, the XP counter tweens the delta — **+15 at best, −35 at worst (critic — corrected from "usually ±25"; see §7.2)** — and that tween *is* the reconciliation. Because the worst case is a visible drop, the optimistic figure is labelled while it is provisional (a hairline under the number, removed when the Reviewer lands) so a falling counter reads as a result arriving, never as points being taken away. Praise and the two improvements slot in when they arrive. | None for the pass/fail fact — it is a true local computation. If the background save fails, a "didn't save, retrying" banner appears and the result stands. |
| **Hint** | Already optimistic (spent and persisted before the await, streamed partials). Add: the hint card's skeleton appears on click, and the "hints left" pip decrements in the same frame. | Streamed reply replaces the skeleton. | Existing refund-only-if-zero-frames logic is untouched. |
| **Lesson check** | Graded locally, so instant by construction. `lesson_progress` write is fire-and-forget. | Background upsert. | Queue for retry on next mount; never revert a check the learner actually answered. |
| **Drill / game result** | Score screen renders the instant the run ends. Streak and personal-best computed locally. | Background `wellness.drill_results` append. | Retry on next mount. |
| **Prefs** (dock, theme, sound, motion, daily goal, wellness) | Applied to local state and `localStorage` in the same frame. Zero network wait, ever, for a toggle. | Debounced (400 ms) write-through to `wellness.prefs`. | Toast on repeated failure only; never revert the toggle under the learner's finger. |
| **Buddy** | Already optimistic (message appended before the call, reply streams). Add the typing indicator and the auto-scroll lock. | Streamed reply. | Message marked "didn't send" with a retry, never deleted. |
| **Course switch** | Provisional path renders instantly (§4.3). | Planner reply reconciles. | Provisional plan is kept and persisted on failure. |
| **Achievement unlock** | The toast fires from the local predicate the moment the state that satisfies it lands. | `user_achievements` upsert with `on conflict do nothing`. | If the write fails, the toast already showed and the row retries on next mount — a duplicate unlock is impossible because the PK is `(user_id, achievement_id)`. |

### 5.4 Prefetch, warmup, and the shape of a click

**Ruling R5.3 — `loading.tsx` everywhere.** Every route segment under `src/app/(app)/` gets a shape-matched skeleton: `dashboard`, `course/[code]`, `lesson/[cloId]`, `exercise/[id]`, `courses`, `derot`, `derot/arcade/[kind]`, `derot/play/[game]`, `reports`, `account`. This is not cosmetic: per Next 16's prefetching model, **a dynamic route without `loading.js` is not prefetched by `<Link>` at all**, so every link in v1 is currently un-prefetched. This one convention turns router prefetching on for the whole app.

**Prefetch ladder:**

| Signal | Action |
|---|---|
| Dashboard mount | Curriculum resolves from the bundle (zero requests). `requestIdleCallback` warms the runtime for the top Next-up card's language. `<Link>` prefetches all three exercise routes as they enter the viewport (now that `loading.tsx` exists). |
| Hover or keyboard focus on a Next-up card | Warm that card's runtime (`getRuntime(lang).warmup()` is documented idempotent and the adapter is cached per language for the session, so an early warmup is never wasted). Prefetch that route. |
| Hover on a path-map node | Prefetch `/lesson/{cloId}` and the node's first exercise. |
| Exercise page mount | Runtime warmup starts **in parallel with** the one remaining per-user read, not after four hops — it no longer depends on `course.packages`, which is now static. |
| Pass → next exercise | `next()` no longer does a full `router.push` that discards the already-fetched next exercise (`useExerciseLoop.ts:264` vs `:437-441`). It swaps state in place with a `<ViewTransition>` on the prompt panel and pushes the URL with `history.replaceState` semantics via `router.replace`, keeping the warm runtime and the mounted editor. |

**Pyodide warmup timing, precisely.** `warmup()` spawns an active and a standby worker; each fetches ~10 MB from the CDN. Today both start after four database hops on the exercise page. In v2: warmup begins at dashboard idle for the top card's language (typically 3-8 seconds before the click). **(critic) On broadband that is enough for a warm runtime by the time the editor mounts; on the Lighthouse mobile-throttled profile §5.6 declares as the measurement basis, 10 MB takes tens of seconds and it plainly is not.** So the claim is scoped: moving warmup to dashboard idle removes the cold start from the critical path on a normal connection and shortens it on a slow one — it never *guarantees* a warm runtime, the exercise screen keeps its real-progress warming state (v1 §13: "never a spinner alone"), and "first Run of a session is not user-visible" is dropped from the CI-gated budget table below and kept only as an untimed expectation. `requestIdleCallback` gets a `setTimeout(…, 1)` fallback for engines that lack it. The exercise page keeps its own `warmup()` call as the fallback for direct links and refreshes; it is idempotent and resolves instantly when already warm. **Ruling R5.4:** the standby worker is spawned lazily — `warmup()` starts the active worker and schedules the standby at the next idle callback rather than in the same tick, halving the cold-start network burst without weakening the terminate-and-promote guarantee.

### 5.5 Bundle diet

| Change | Saving | File |
|---|---|---|
| `adhan` becomes a dynamic import inside `computeFallback` only | **457 KB off seven of eight routes** | `src/lib/wellness/prayer.ts:10,113-129` |
| CodeMirror loads one grammar per exercise via a `Record<Language, () => Promise<Extension>>` and a compartment reconfigure | *estimated* ~400-500 KB off `/exercise` **(critic — not measured; the audit measured the CodeMirror chunk at 658 KB in total, it did not attribute bytes per grammar. Set the real number from `perf:bundle` on the W1 branch.)** | `src/components/exercise/Editor.tsx:6-12` |
| `Editor` itself becomes `next/dynamic` with `ssr: false` and a skeleton | CodeMirror out of the initial exercise payload entirely | `exercise/[id]/page.tsx:10` |
| Sound sprite + Howler load on first gesture, never on the critical path | *estimated* ~30 KB of JS plus ≤120 KB of audio deferred **(critic — the "20 KB" in the first draft matched neither figure and had no source)** | §7.7 |
| `public/spikes/*` (18 MB) added to `.gitignore` and removed from the deploy; `public/java/*` gitignored but **regenerated by `scripts/fetch-java-tools.mjs` at build time on any deploy where the Java adapter is enabled** | ~18 MB off every deploy today, ~37 MB while `java` stays `coming-soon` | **(critic)** spike leftovers — but `public/java/tools.jar` is not one of them. The 22:33 CheerpJ ruling requires `tools.jar` **self-hosted from the app's origin** (the vendor CDN serves the engine, not the JDK), so "removed from the deploy" and "Java ships as a browser adapter" cannot both be unconditionally true. The asset is excluded from git (correct — an 18 MB binary does not belong in the repo) and fetched during `prebuild` behind a flag, so the two lanes do not collide. See §5.6's `public/` budget note. |
| `canvas-confetti` dynamic-imported inside the celebration path | ~6 KB gzip deferred **(critic — every other row in this table is uncompressed; do not compare them)** | §7.6 |

### 5.6 Performance budget

Measured on the Lighthouse mobile-throttled profile for paint metrics; repeat-visit numbers assume a warm cache, which is what a logged-in product actually experiences.

**Supabase round trips per route, steady state**

| Route | v1 | v2 target |
|---|---|---|
| `/dashboard` | 3 curriculum + shared prefix of 9 hops | **0** curriculum; shared prefix cut to 3 (proxy claims + one profile read forwarded in headers + one `learner_state` read) |
| `/course/[code]` | did not exist | **0** |
| `/lesson/[cloId]` | did not exist | **0** |
| `/exercise/[id]` | 4 in 3 sequential waves | **1** for a seed exercise (capped attempts); **2** for a runtime-generated one, which is never in the static bundle **(critic — see R5.1b)** |
| `/courses` (switch) | ~7 plus up to 13 profiler screens | **1** (the `learner_state` write) plus one background Planner call |
| `/derot`, `/derot/*` | 2-3, wellness read three times per load | **1** wellness read for the whole page load |
| `/reports` | full attempt history with `code` and `results` | **1**, capped, columns narrowed, on tab open |

**Paint and interaction**

| Metric | Route | Budget |
|---|---|---|
| LCP | `/dashboard` | ≤ 1.5 s |
| LCP | `/course/[code]` | ≤ 1.5 s |
| LCP | `/lesson/[cloId]` | ≤ 1.5 s |
| LCP | `/exercise/[id]` | ≤ 1.8 s (excludes the editor mount, which is interaction-gated) |
| CLS | every route | ≤ 0.05 |
| INP | every route | ≤ 200 ms |
| Course tile click → course home painted | — | < 100 ms (pure client transition) |
| Submit click → pass/fail revealed | — | < 300 ms **beyond** actual runtime execution time |
| Lesson check submit → verdict | — | < 120 ms for non-`micro-code` kinds |
| Hint click → first token | — | < 1.5 s — **field-only, not a CI gate (critic: `perf:timings` runs with `AGENT_DRY_RUN=true` and cannot measure DeepSeek)** |
| First Run of a session on a cold language | — | **field-only (critic)**. Expectation, not a budget: dashboard-idle warmup removes the cold start on broadband and shortens it on a slow link; on the throttled profile this table is measured against, a 10 MB fetch is not hidden by 3-8 seconds of idle. The exercise screen keeps real-progress warming. |

**JS payload, uncompressed, per route (the audit's measurement method is the definition)**

**(critic) These numbers are PROVISIONAL and must be re-set from a measured baseline before they become a CI gate, because the arithmetic in the first draft does not close.** Worked example, using only the audit's own measured figures: `/dashboard` is 887 KB today, of which `adhan` is 457 KB. Removing `adhan` lands it at ~430 KB — already above the 380 KB target *before* v2 adds `@tanstack/react-query`, `motion`, `gsap`, `next-themes` and the sound manager to the shell, which realistically pushes it back toward 550-600 KB. A budget below the achievable floor is a gate that fails on the first green PR and then gets deleted, which is worse than no gate.

**Ruling R5.7 (critic).** The budget table below is the *direction*, not the contract. `perf-budget.json` is generated once, at the end of W1, by running `npm run perf:bundle` against the branch that has landed the `adhan` split, the CodeMirror split, the lazy `Editor` and the static curriculum — and then hand-tightened. Two hard rules bind that generation: **(a)** no route's budget may be set above its v1 number, ever; **(b)** every route whose measured v2 size exceeds its target below gets one named ledger row saying which library is responsible and whether it is being split, deferred to first gesture, or accepted. The most likely such row is the ~467 KB Supabase client pair on every authenticated route, which no ruling in this document touches and which is the single largest remaining item on `/dashboard`.

| Route | v1 | Budget |
|---|---|---|
| `/dashboard` | 887 KB | **≤ 380 KB** |
| `/course/[code]` | — | ≤ 420 KB |
| `/lesson/[cloId]` | — | ≤ 600 KB (one grammar, lazy editor) |
| `/exercise/[id]` | 1593 KB | **≤ 750 KB** |
| `/derot`, `/derot/*` | 926 KB | ≤ 420 KB |
| `/reports` | 896 KB | ≤ 450 KB |
| `/onboarding`, `/courses`, `/account` | 890 KB | ≤ 380 KB |
| `public/` total shipped | 37 MB | **≤ 3 MB** while `java` is `coming-soon`; the budget is re-set in the Java adapter's own ledger row when `tools.jar` is fetched at build **(critic — the CheerpJ ruling requires a same-origin `tools.jar`, so a permanent 3 MB cap and a shipped Java adapter are mutually exclusive)** |

### 5.7 How the budget is measured in CI

**Ruling R5.5 — no telemetry route handler.** There is no `/api/vitals`. Field data comes from `@vercel/speed-insights` mounted only when `process.env.NEXT_PUBLIC_VERCEL_ENV` is set (so a self-hoster ships nothing); `useReportWebVitals` writes LCP/INP/CLS into an in-memory ring buffer that the Account page's Diagnostics section renders, so anyone — including a fork on their own hosting — can read their own numbers with no server. This keeps v1 non-negotiable #3 intact.

Three CI gates, all runnable locally:

1. **`npm run perf:bundle`** — `scripts/check-bundle-budget.mjs` reproduces the audit's method exactly: read each route's `.next/server/app/**/page_client-reference-manifest.js`, resolve it against on-disk `.next/static/chunks/*.js` sizes, compare to `perf-budget.json`, print a table, exit 1 on any overage. Also asserts `public/` total size.
2. **`npm run perf:timings`** — `e2e/perf.spec.ts` (Playwright, against a production build with `AGENT_DRY_RUN=true` so no model latency pollutes the numbers). The app emits `performance.mark()` at four named points: `brogram:shell-ready`, `brogram:route-ready`, `brogram:graded`, `brogram:check-verdict`. The spec drives dashboard → course → lesson → exercise → submit, reads the marks and the navigation timing entries, runs each route three times and asserts the **median** against `perf-budget.json`. Round-trip counts are asserted by counting Supabase requests via `page.route` interception per route.
3. **`npm run perf:vitals`** — the same Playwright run collects `web-vitals` (LCP, CLS, INP proxy via `event` timing) from the page and asserts the paint budgets.

**(critic) Two of the budgets in §5.6 cannot be gated by this harness and are hereby moved out of it.** `perf:timings` runs with `AGENT_DRY_RUN=true`, so "hint click → first token < 1.5 s" measures a local fallback and asserts nothing about DeepSeek; and "first Run of a session on a cold language: not user-visible" is contradicted by the throttled profile (see R5.4's correction). Both become **field-only observations** read from the Account → Diagnostics ring buffer and from Speed Insights, with no CI assertion. Everything else in §5.6 stays gated. A budget nobody can measure is a claim, and this document does not ship claims.

All three run in the same GitHub Actions job as the existing suite; a regression fails the PR. `perf-budget.json` is the single source for every number in §5.6.

### 5.8 Deferred, deliberately

`cacheComponents: true` (Next 16's unified Cache Components — the old `experimental.ppr` / `dynamicIO` / `useCache` flags no longer exist) and `partialPrefetching: true` are the right long-term shape for this app, but adoption is a real migration: every dynamic read, starting with the layout's auth check, needs an explicit `<Suspense>` boundary, and `revalidateTag` now takes a mandatory second `cacheLife` argument. **Ruling R5.6:** not in v2. Revisit once v2 is live and the budget above is being met by simpler means. `reactCompiler` likewise: measured trial only, never a blind flip.

---

## 6. The wellness dock

### 6.1 Modes

The rail becomes a dock with one placement preference and one collapse state. `WellnessSlot` stops being a route-driven boolean and becomes a placement-driven renderer; `AppShell` reads the placement and lays out accordingly.

| Placement | Layout | Renderer | Notes |
|---|---|---|---|
| `right` (default) | shell grid column 2, 280 px, sticky, full height | vertical | today's behaviour, now a choice |
| `left` | shell grid column 0, 280 px, sticky, full height | vertical | mirrored, same component |
| `top` | full-width strip under the header, 56 px | horizontal | reuses the existing compact renderer (`Rail.tsx:195-204`), which already lays out as a wrapping row |
| `float` | fixed floating pill, bottom-right by default, movable to any corner, corner persisted | pill then popover | collapsed = one pill showing the next event; expanded = a popover with the full dock |
| `hidden` | not rendered | none | a small dock glyph stays in the shell header; clicking it restores the previous placement. **Never a dead end.** |

**Ruling R6.1.** Placement is a real layout decision, not a class swap: `left`/`right` change the shell's grid template; `top` changes the shell to a rows layout; `float` renders into a portal outside the grid. All four render the same `<Dock>` component with an `orientation` prop of `'vertical' | 'horizontal' | 'pill'`.

**Ruling R6.2.** The dock is keyboard-reachable in every placement and never traps focus. In `float` it is `role="complementary"` with an accessible name, and moving it is pointer-optional: arrow keys move it between the four corners when the pill has focus.

### 6.2 Collapse

One toggle in the dock header, persisted as `dock.collapsed`.

- `vertical` collapsed becomes a 56 px icon rail: prayer glyph with the next-prayer countdown, water glyph with today's count, pomodoro ring. Hover or focus reveals the full label. Expanding animates a transform-based wrapper over 200 ms with the move curve, never an animated `width`.
- `horizontal` collapsed becomes a single line: next event plus a chevron.
- `pill` collapsed is the pill itself.

### 6.3 Persistence

Stored in `wellness.prefs.dock` (contracts addition, section 11.4):

```ts
export interface WellnessDockPrefs {
  placement: 'left' | 'right' | 'top' | 'float' | 'hidden'
  collapsed: boolean
  /** Collapse automatically on the exercise and lesson screens. */
  compactOnExercise: boolean
  /** Only meaningful for placement 'float'. */
  corner: 'tl' | 'tr' | 'bl' | 'br'
}
```

Defaults added to `DEFAULT_WELLNESS`: `{ placement: 'right', collapsed: false, compactOnExercise: true, corner: 'br' }`. Existing stored rows simply lack the key and fall back, which is why this is a safe additive contracts change and needs no data migration.

Two-tier persistence, the same shape `Rail.tsx:124-177` already uses for water and pomodoro logs: local state and `localStorage` update in the same frame; a debounced write-through updates `wellness.prefs`. On sign-in the server value wins over a stale local value; a local value set before any server value existed becomes the first write.

### 6.4 Compact mode on the exercise and lesson screens

**Ruling R6.3.** When `compactOnExercise` is true (the default) the dock renders collapsed on `/exercise/[id]` and `/lesson/[cloId]` regardless of placement, and in `float` placement it renders as a bare pill. The learner's chosen placement is never overridden, only the collapse state, and only on those two routes. Turning the preference off keeps the dock fully expanded there too. The exercise screen is the learner's screen.

**Ruling R6.4.** Wellness reminders never interrupt an active attempt. The `brogram:attempt-active` signal already exists (built in A4). A prayer, water, stretch or pomodoro event that fires during an attempt queues and surfaces on the next submit as a dock badge, never as a modal and never as a toast over the editor. A pomodoro ending mid-attempt pauses the idle guard instead of firing.

### 6.5 The 1 Hz problem

`Rail.tsx:30-37,120` re-renders the whole rail every second on every route. **Ruling R6.5:** replace it with one shell-level clock, `useSecondTick`, a `useSyncExternalStore` over a single shared interval that suspends while `document.hidden`. Only the two components that actually display seconds subscribe. Everything else derives from timestamps, which the pure timer math in `src/lib/wellness/timers.ts` already does correctly.

---

## 7. Rewards and juice

### 7.1 The governing rule

**Juice fires at transitions, never during composition.** Nothing animates and nothing sounds while the learner is typing, reading, or thinking. Everything can the instant they submit, pass, chain, lock a skill, level up, or hit a streak. This is not a compromise between v1's "the editor is the hero" rule and the owner's "make it fun" demand; it is where the research says the fun belongs, and it is the reason the exercise screen can be quiet and rewarding at the same time.

Three rules that hold everywhere:

- **Never punish a mistake with scarcity.** No lives, no hearts, no energy, nothing a failed attempt consumes. v1 is already built this way; v2 keeps it and says it out loud in copy.
- **Self-comparison only.** No leaderboards, no public ranks, no cohort comparison. Personal bests only. In a small hand-picked cohort a public board is worse than anywhere else, and the research is unambiguous that it demotivates exactly the learners who need the help.
- **Every reward tracks demonstrated skill or genuine showing up.** Never time on page, never opening the app.

### 7.2 XP

**Ruling R7.1. XP is points. There is no second currency.** `LearnerState.points` already exists, is already computed by the frozen `pointsForPass(difficulty, hintCount, quality)`, and is already persisted. The UI renders it as XP. No new table, no new field, no drift between two numbers.

What falls out of the existing formula, stated so nobody re-derives it:

- A medium (difficulty 3) pass with no hints and neutral quality is **335 XP**.
- Each hint costs 10 XP, capped at five hints.
- Reviewer quality moves the number by **+15 at best and −35 at worst**, measured from the neutral 70 used before the Reviewer answers. **(critic — the first draft said "at most 25 either way", which the frozen formula does not produce: `pointsForPass` adds `round(quality/100 * 50)`, so neutral 70 is +35, quality 100 is +50, quality 0 is +0. The asymmetry matters because it is the size of the visible reconciliation tween in §5.3, and an XP number that can drop by 35 needs to be introduced as provisional, not as a result.)**
- A difficulty 5 pass with no hints and quality 90 is **545 XP**.
- The floor is 10 XP. A pass is always worth something.

Achievements award no XP. They are recognition, not currency, which is what keeps "rewards track real growth" true.

### 7.3 Levels

```ts
// added next to pointsForPass in src/lib/contracts.ts
export const MAX_LEVEL = 30
/** Cumulative XP needed to be at a level. Level 1 = 0. */
export function xpToReach(level: number): number {
  if (level <= 1) return 0
  const capped = Math.min(level, MAX_LEVEL)
  return Math.round((500 * Math.pow(capped - 1, 1.5)) / 50) * 50
}
/** Largest n with xpToReach(n) <= xp, capped at MAX_LEVEL. */
export function levelForXp(xp: number): number
```

| Level | XP | Roughly |
|---|---|---|
| 1 | 0 | sign-up |
| 2 | 500 | 2 passes |
| 3 | 1,400 | 5 passes **(critic — 4 × 335 = 1,340, which does not reach it)** |
| 4 | 2,600 | 8 |
| 5 | 4,000 | 12 |
| 6 | 5,600 | 17 |
| 8 | 9,250 | 28 |
| 10 | 13,500 | 40 |
| 15 | 26,200 | 78 |
| 20 | 41,400 | 124 |
| 25 | 58,800 | 176 |
| 30 | 78,100 | 233 |

Past level 30 the level stays 30 and XP keeps counting. No fake infinite ladder.

**Bands** — the label next to the number; the number is always shown too.

| Levels | Band |
|---|---|
| 1-4 | Fresh |
| 5-9 | Wired In |
| 10-14 | Shipping |
| 15-19 | Dangerous |
| 20-24 | Locked In |
| 25-30 | Machine |

Level is derived, never stored. It is a pure function of `points`, so it can never disagree with XP and needs no migration.

### 7.4 Streaks and the daily goal

Two independent streaks already exist in `LearnerState.streak` (`exerciseDays`, `derotDays`) with correct expiry: a streak expires when the last activity is older than yesterday, compared on UTC date keys against a server-supplied clock (the ruling at 22:47).

**Flame states**, all derived:

| State | Condition | Look | Sound |
|---|---|---|---|
| Cold | streak 0 | outlined glyph, muted foreground | none |
| Lit | streak >= 1 and today already counted | filled, celebration token, slow 3 s opacity flicker, no transform | none |
| At risk | streak >= 1, today not counted, local time >= 18:00 | filled, dimmed, one slow pulse | none |
| Ignite | the day's first qualifying action | flame scales 1 to 1.18 to 1, brief sparks, counter tweens | `streak.light` |
| Milestone | streak crosses 3, 7, 14, 30, 50, 100 | bigger burst plus a milestone card | `streak.milestone`, used nowhere else so it keeps meaning |
| Reset | detected on load | flame dims to ember once, no loop | `streak.lost`, quieter than the pass chime, mutable |

Streak copy always frames keeping something good ("Day 7. Same time tomorrow."), never impending loss. No countdown timers, no "you are about to lose everything", no guilt trips. This is the one Duolingo trait deliberately not carried over.

**Daily goal.** One number, default 3, adjustable 1 to 10 in Account, stored at `wellness.prefs.dailyGoal`. A **win** is any of: a passed exercise, a completed walkthrough, or a completed de-rot run in either lane. The ring on the dashboard and course home fills as wins land. Hitting the goal fires `goal.done` once per day. Going past it says nothing, because an infinite treadmill is the thing to avoid.

**(critic) The goal needs one byte of memory that §11.1 refuses to give it.** Today's ring is derivable from today's data, but achievement #15 `kept-the-promise` ("Hit your daily goal seven times") is a claim about seven *past* days, and §11.1 rules out both a reward-events table and an XP ledger. Nothing else stores it: the 50-row attempts window cannot see back seven goal-days once walkthroughs and de-rot runs count as wins, and `lesson_progress` and `drill_results` are in different tables from `attempts`. **Ruling R7.7 (critic):** the day a goal is met, append its UTC date key to `wellness.prefs.goalDays: string[]`, capped at the most recent 120 entries, written in the same debounced prefs write as every other preference. It is `jsonb`, so it needs no migration; it is a set of date strings, so it cannot drift from the truth the way a counter can; and it is written once a day at most, so it is not on any hot path. `wellness.prefs.goalDays` joins the §11.4 contracts list as item 15.

### 7.5 Achievements

**Schema.** Two tables (SQL in section 11.2). The catalogue itself is code, not data, so predicates are unit-testable and a fork can extend them:

```ts
// src/lib/contracts.ts
export type AchievementTier = 'bronze' | 'silver' | 'gold'
export interface Achievement {
  id: string
  name: string          // in voice, at most 3 words
  line: string          // shown on unlock, at most 12 words
  tier: AchievementTier
  /** Human-readable rule, shown on the locked card. Nothing is a mystery box. */
  how: string
  visibleWhenLocked: boolean
}
export interface UserAchievement { userId: string; achievementId: string; unlockedAt: string }
export const ACHIEVEMENTS: readonly Achievement[]
```

Predicates live in `src/lib/rewards/achievements.ts` as pure functions over one `RewardContext` assembled from data that already exists (`LearnerState`, the capped attempts window, `lesson_progress`, `wellness.drill_results`). They are evaluated client-side after every state change that could satisfy one; unlocks are written optimistically with `on conflict do nothing`.

**The twenty.**

| # | id | Name | Tier | How (shown on the locked card) | Reads |
|---|---|---|---|---|---|
| 1 | `first-blood` | First Blood | bronze | Pass your first rep. | attempts |
| 2 | `no-wheels` | No Training Wheels | bronze | Pass a medium or harder rep with zero hints. | attempt + difficulty |
| 3 | `three-angles` | Three Angles | silver | Lock your first skill: three passes, three different angles. | `mastery.closed` |
| 4 | `five-locked` | Five Locked | silver | Lock five skills. | `mastery` |
| 5 | `course-clear` | Cleared It | gold | Lock every skill in a course. | `path` + `mastery` |
| 6 | `read-the-manual` | Reads the Manual | bronze | Finish five walkthroughs. | `lesson_progress` |
| 7 | `full-read` | Full Read | silver | Finish every walkthrough in a course. | `lesson_progress` + course lessons |
| 8 | `comeback` | Comeback | bronze | Pass a rep you failed three times or more. | attempts grouped by exercise, **within the 50-row window only — say so on the locked card ("in your recent history") rather than letting it silently not fire (critic)** |
| 9 | `under-a-minute` | Under a Minute | silver | Pass a rep in under 60 seconds with no hints. | `attempt.durationMs` |
| 10 | `two-tongues` | Two Tongues | bronze | Pass reps in two different languages. | `mastery` keys → CLO → course language **(critic — the 50-row attempts window loses this: a learner passes 60 Python reps before switching course, and the Python passes have aged out by the time the first JS pass lands. `mastery` is unbounded and course-keyed, so derive the language set from closed-or-touched CLOs instead.)** |
| 11 | `pattern-hunter` | Pattern Hunter | silver | Pass ten different angles across any skills. | `mastery.patternsPassed` |
| 12 | `day-three` | Three Deep | bronze | Three-day streak. | `streak.exerciseDays` |
| 13 | `week-strong` | Week Strong | silver | Seven-day streak. | `streak.exerciseDays` |
| 14 | `thirty` | Thirty | gold | Thirty-day streak. | `streak.exerciseDays` |
| 15 | `kept-the-promise` | Kept the Promise | silver | Hit your daily goal seven times. | `wellness.prefs.goalDays` **(critic — R7.7; "derived daily wins" had no durable source)** |
| 16 | `sharp` | Sharp | bronze | Ten Arcade runs. | `drill_results` lane arcade |
| 17 | `touch-grass` | Touch Grass | bronze | Ten Playground runs. | `drill_results` lane play |
| 18 | `beat-yourself` | Beat Yourself | silver | Five personal bests. | `drill_results` |
| 19 | `level-five` | Level Five | silver | Reach level 5. | `levelForXp(points)` |
| 20 | `machine` | Machine | gold | Reach level 25. | `levelForXp(points)` |

`visibleWhenLocked` is `true` for all twenty. There are no secret achievements. A mystery box is a dark pattern, and telling the learner exactly what earns each one is the same honesty section 9 is built on.

### 7.6 The reward event table

Every trigger is a state change that already exists. No new agent trigger, no new table, no server call.

| Event | Fires on | Sound | Motion | Frequency guard |
|---|---|---|---|---|
| First-ever pass | first `passed: true` for the account | `first.win`, longer and richer, used nowhere else | full-screen warm celebration | once per account, permanently |
| Pass | local grading resolves passed | `pass` | checkmark draw on the result panel, XP counter tween; **confetti only on the session's first pass, on a chain tick that reaches 3, and on any milestone — a routine pass gets the checkmark and the counter, no particles (critic)** | every pass; confetti has a 1200 ms cooldown **and a decay rule: the twentieth confetti of a session is the thing that makes the first one worthless** |
| Fail | local grading resolves not-passed | `fail`, soft and neutral, never a buzzer | 4 px / 150 ms shake on the failing test row only, then a calm slide into the fix plan | every fail |
| Chain tick | `mastery.chain` increases without closing | `chain.tick`, short ascending, distinct from pass | one pip fills on the 3-pip indicator, 180 ms enter curve | every increment |
| Skill locked | `mastery.closed` flips true | `clo.close`, the biggest sound short of first win | the path-map node fills and stays lit; a card slides in with the skill name | every close |
| Course cleared | every CLO in `path` closed | `clo.close` layered with `level.up` | map-wide sweep | once per course |
| Level up | `levelForXp` crosses a threshold | `level.up`, layered fanfare, the rare-event budget | badge entrance on a spring (duration 0.5, bounce 0.2), XP bar refill, edge glow using `--glow`, always dismissable | rare by construction |
| XP settle | any XP change | `xp.settle`, one quiet tick on the final value only, never per frame | GSAP proxy tween with integer snap, rendered in `tabular-nums` so nothing jitters | once per change |
| Streak ignite | day's first qualifying action | `streak.light` | flame scale plus sparks | once per day |
| Streak milestone | 3 / 7 / 14 / 30 / 50 / 100 | `streak.milestone` | milestone card | milestones only |
| Personal best | a `DrillResult.score` beats your own prior best for that drill | `best` | "new best" badge stamps onto the score row | every genuine best |
| Achievement unlocked | a predicate flips true | `best` (a trophy and a best are the same register) | trophy card slides in from the shelf position, 2.5 s, dismissable | at most one card visible; extras queue, **and a queue longer than two collapses into one "3 new trophies" card that opens the shelf (critic — three unlocks at 2.5 s each is 7.5 s of cards in front of a learner who wanted the next rep)** |
| Daily goal met | wins reach the goal | `goal.done` | the ring completes with one sweep | once per day |
| Lesson check right | local grade | `drill.hit`, light | row goes green, `explain` expands | every check |
| Lesson check wrong | local grade | `drill.miss`, soft and low, never harsh | row settles amber, hint expands | every check |
| Walkthrough finished | last block acknowledged | `pass` at 70 percent volume | the bridge card slides up, the path-map node gains its book mark | every lesson |
| Hint revealed | Coach reply starts streaming | `hint`, deliberately unexciting, a page turn | panel expands, height-auto via Motion | every hint |
| Drill or game finished | run ends | `drill.hit`, plus `best` if applicable | score count-up, combo meter settle | every run |
| Run clicked (free run) | Run button | `run.go`, quiet — **interface tier, default OFF (critic)** | `scale(0.97)` on `:active`, 160 ms | every click |
| Submit clicked | Submit button | `submit.send`, soft whoosh, anticipation only — **interface tier, default OFF (critic)** | progress indicator only; no celebration spent here | every click |
| Buddy reply arrives | first streamed token | `ui.tap` at low volume | bubble slide-in plus typing dots | every reply |
| Wellness reminder | wellness timers | `wellness.chime`, the most conservative sound in the set | dock badge pulse | never during an active attempt (R6.4) |
| Blur or idle cover | lockdown | **silence** | fade to cover, blur increases | a step-away moment, not a reward moment |
| Paste blocked | clipboard guard | **silence** | **none — the toast simply appears (critic: R9.6 says enforcement surfaces get "no animation", and a micro-shake is animation; a shake on a guard is also the punitive register R9.6 exists to remove)** | rotating copy, section 9 |
| PrintScreen | key guard | **silence** | nothing at all | logged only; one honest line on the third press per exercise |
| Integrity status change | `accountStatus` changes | **silence** | plain flat panel, no confetti, no playful motion | every change |

**Ruling R7.2.** Sound is reserved for positive and neutral product moments. It never plays on a lockdown, integrity, or account-status event. A cheerful noise on a restriction notice reads as mockery and destroys the honesty the whole of section 9 is built on.

**Ruling R7.3.** No two reward sounds overlap. The manager debounces inside a 250 ms window and plays only the larger of the two, ranked `first.win` > `level.up` > `clo.close` > `pass` > `chain.tick` > everything else. Confetti has a hard 1200 ms cooldown so quick successive events read as celebratory rather than chaotic.

### 7.7 The sound manager

`howler@2.2.4` (MIT) is the single audio dependency: Web Audio first with an HTML5 Audio fallback, first-class sprites, and an `autoUnlock` that plays a silent buffer on the first gesture, which is exactly what every browser's autoplay policy requires. Do not hand-roll `AudioContext` unlocking; double-unlock races and Safari quirks are a known source of bugs.

```ts
// src/lib/sound/events.ts  — client-only, deliberately NOT a contract (one lane, no cross-lane need)
export type SoundEventId =
  | 'ui.tap' | 'run.go' | 'submit.send'
  | 'pass' | 'fail' | 'chain.tick' | 'clo.close' | 'first.win'
  | 'level.up' | 'xp.settle' | 'streak.light' | 'streak.milestone' | 'streak.lost' | 'best'
  | 'hint' | 'drill.hit' | 'drill.miss' | 'goal.done' | 'wellness.chime'
```

`src/lib/sound/manager.ts`, a module singleton marked `'use client'` and never imported from a server path:

- `init()` is wired to the app's first real gesture: one `pointerdown`/`keydown` listener installed in the shell and removed after it fires. It dynamic-imports Howler, fetches `public/sounds/brogram.json`, and constructs one `Howl` over the webm plus mp3 sprite pair. Nothing audio-related sits on any route's critical path.
- `play(id)` before load or before unlock is a no-op-and-queue, never a throw. The queue flushes on `load`.
- `setEnabled(on)` calls `Howler.mute(!on)` and persists.
- The rank-based debounce and the 250 ms window live here, so no call site has to think about it.
- Volume comes from `wellness.prefs.sound.volume`, default 0.6.

**Mute** is one icon button in the shell header, not buried in settings, mirrored in Account. Default **on**: nothing can play before the first gesture anyway, so defaulting on costs nothing and matches the ask.

**(critic) Nineteen sound ids is more than twice what the research recommends, and four of them fire on every click.** `docs/research/v2/learning-ux.md` §4 is explicit: build "roughly 6-8 sounds total", and "sound should scale with frequency — the more common an action, the simpler its sound". A learner doing six checks in a walkthrough and then eight reps hears `run.go`, `submit.send`, `drill.hit`/`drill.miss` and `ui.tap` several dozen times an hour. That is the sound design that makes people mute a product once and never unmute it, which costs every reward moment after it. **Ruling R7.8 (critic): two tiers, two toggles.**

| Tier | Ids | Default | Toggle |
|---|---|---|---|
| **Reward** | `pass`, `fail`, `chain.tick`, `clo.close`, `first.win`, `level.up`, `streak.light`, `streak.milestone`, `streak.lost`, `best`, `goal.done`, `hint` | **on** | the header mute |
| **Interface** | `ui.tap`, `run.go`, `submit.send`, `xp.settle`, `drill.hit`, `drill.miss`, `wellness.chime` | **off** | "Interface sounds" in Account → Make it yours |

The header mute kills both. Turning interface sounds on is a deliberate act by someone who wants a clicky product, and Arcade turns `drill.hit`/`drill.miss` on for the duration of a run regardless, because there the tick *is* the game. Additionally, the manager applies **repetition attenuation**: the same id played more than four times inside sixty seconds drops 6 dB for the rest of that window. `fail` in particular is soft-and-neutral by §7.6 and stays that way; the research's position that a fail may reasonably carry no sound at all is respected by making `fail` the one reward-tier id a learner can silence on its own.

**Reduced motion** resolves through one hook, `useReducedMotion()`, combining the OS signal (`prefers-reduced-motion` via `useSyncExternalStore`) with an in-app override at `wellness.prefs.motion` (`'system' | 'full' | 'reduced'`). Every celebration entry point takes the resolved boolean as a parameter; no call site queries `matchMedia` itself. Under reduced motion: confetti gets `disableForReducedMotion: true` (built into the library), springs collapse to a 150 ms opacity cross-fade, the flame stops flickering, the XP counter sets instead of tweening. **Feedback reduces, it never vanishes** — a level-up still shows "Level 5" and still plays its cue.

**(critic) The reduced-motion rule above only covers celebrations, and §10's screens are full of motion it does not reach** — dashboard block staggers, course-map node staggers and edge draws, onboarding card slides, lesson scroll reveals, the buddy drawer, the de-rot lane cross-fade and the card idle micro-motions. **Ruling R7.9 (critic), and it is a review checklist item on every screen in §10:** under resolved reduced motion, *all* of the following collapse, not just celebrations — staggers become a single simultaneous opacity fade of ≤150 ms; scroll-triggered reveals render immediately at full opacity with no transform and no `IntersectionObserver` gating; directional route and card slides become cross-fades; the path map's `stroke-dashoffset` edge draw renders complete; every looping or idle animation (flame flicker, de-rot card micro-motion, skeleton shimmer, typing dots) stops and holds a static state. Nothing is removed and no information is lost — the only thing that changes is that nothing moves. Any component that animates and does not read the resolved boolean fails review.

**Reduced transparency** (`prefers-reduced-transparency`, Chrome 118+) is progressive enhancement only: every glass or blurred surface pairs with an opaque fallback under that query. It is never load-bearing.

**Haptics** are a bonus layer: `navigator.vibrate` behind a feature check and a `try/catch`, on pass and level-up only. It realistically reaches Chromium on Android and nothing else — Firefox removed it in 129, and WebKit has never shipped it and formally opposes it. It is never the only channel for anything.

**The rule above all of this:** no feedback is ever sound-only or haptics-only. Every row in 7.6 that carries a sound also carries a visible channel. Any future PR that adds a sound must name the visible channel it sits on top of.

### 7.8 Motion implementation split

Both animation libraries are already installed; a third would be pure bloat.

- **GSAP** (`gsap` plus `@gsap/react`, free for commercial use including every former Club plugin since April 2025) owns anything sequenced or numeric: the XP odometer (tween a proxy object, integer snap, format in `onUpdate`), the flame flicker, the level-up choreography, the path-map fill. Always through `useGSAP()` so a route change can never leave a timeline running against an unmounted node. **(critic) `gsap.matchMedia()` cannot gate the in-app override, because an override is React state and `matchMedia` only evaluates media queries** — `gsap.matchMediaRefresh()` re-runs the queries, it does not know that a learner set `wellness.prefs.motion = 'full'` on a machine whose OS says reduce. So the single resolved boolean from `useReducedMotion()` is the source of truth and is passed into every timeline as a parameter; `gsap.matchMedia()` is used only for genuinely query-shaped variants (viewport size, `hover: hover`), never for reduced motion. Every celebration entry point already takes the resolved boolean, which is exactly the seam this needs.
- **Motion** (`motion/react`) owns React-idiomatic mount and unmount and layout animation: hint panel expansion, buddy bubbles, trophy cards, dock collapse, `AnimatePresence` exits.
- **CSS transitions** own everything interruptible and high-frequency: button `:active` scale, hover, tab switches, skeleton shimmer. Transitions retarget mid-flight; keyframes restart from zero.
- **`<ViewTransition>` from `react`** (works in the App Router with no config on 16.3.x) owns route transitions on dashboard, course, lesson, courses, de-rot and reports. **Never on `/exercise/[id]`** — remounting the editor or the runtime worker mid-transition is exactly the cost being removed.

**Timing law**, applied everywhere and checked in review: button press 100-160 ms; tooltips 125-200 ms; dropdowns 150-250 ms; modals and drawers 200-350 ms; on-screen movement 200-300 ms; celebrations 600-900 ms and only for positive moments. Enter curve `cubic-bezier(0.22, 1, 0.36, 1)`; move curve `cubic-bezier(0.25, 1, 0.5, 1)`; drawer curve `cubic-bezier(0.32, 0.72, 0, 1)`. **Never `ease-in` on UI. Never `transition: all`. Never animate `width`, `height`, `top` or `left`. Never enter from `scale(0)`; start at 0.95.** Exit is always faster than enter. Stagger 30-50 ms per item, total under 300 ms. Hover animation is gated behind `@media (hover: hover) and (pointer: fine)`. Popovers scale from their trigger via the Base UI transform-origin variable; modals stay centred. Skeleton shimmer sweeps on a 1400 ms linear cycle and becomes a static tint under reduced motion.

### 7.9 De-rot: two lanes

`/derot` becomes a hub with a visible two-way switch. Both lanes score into the same `DrillResult` and feed the same `derotDays` streak.

**Lane A — Arcade** (the six coding drills, rebuilt as a game). The scoring and item-selection code survives untouched (`src/components/derot/scoring.ts`, `src/app/(app)/derot/lib.ts` with `pickDrillItem`, `computeDerotStreak`, `DRILL_META`); only the presentation is new.

- A **run** is six items of one kind, not one item. Score accumulates across the run.
- **Combo**: consecutive correct answers multiply the item score (1x, 1.2x, 1.5x, 2x, capped). A miss resets the multiplier, never the run.
- **Countdown tension**: the existing per-item `timeLimitS` drives a ring that turns amber in the last 25 percent and red in the last 10 percent, with a rising tick that is silent above 25 percent remaining.
- **Personal-best scoreboard**: your last five runs of this kind, your best, and the delta. Nobody else's numbers ever appear.
- **Run summary**: score, accuracy, best combo, personal-best badge if earned, one line in voice, one button back in.
- Drill names go in voice: Predict the output becomes **Call It**; Spot the bug becomes **Find the Break**; Trace by hand becomes **Run It in Your Head**; Hold focus becomes **Don't Blink**; N-back becomes **Two Back**; Speed type becomes **Hands**.

**Lane B — Playground** (six non-coding games, 60-120 seconds each, entirely local, no data beyond a `DrillResult`).

| Game | id | Loop | Score |
|---|---|---|---|
| **Follow the Dot** | `follow-the-dot` | keep the pointer inside a dot that drifts and accelerates along a smooth path for 75 s | share of frames inside the dot, times 1000 |
| **Colour Back** | `color-nback` | colours or tones instead of code tokens; press when the current one matches N back | hits minus false alarms, times 100 |
| **Twitch** | `reaction` | ten rounds; a shape lights at a random interval, tap as fast as you can; an early tap voids that round | 10000 minus mean reaction ms, floored at 0 |
| **Keep Time** | `rhythm` | tap on the beat for 60 s while the tempo drifts | mean absolute offset in ms, inverted |
| **Breathe** | `breathe` | a 4-7-8 pacer for 90 s; hold a key or the pointer through each phase | completion percentage; cannot be failed |
| **Grid** | `memory-grid` | a pattern flashes on a 4x4 grid, reproduce it; the pattern grows each round | rounds cleared, times 250 |

**Ruling R7.4.** Playground is the one place in the product where decorative motion is not just allowed but the point. These games may be beautiful, they may loop, they may spend the full celebration budget. They are also the one place with no code and no judgment: `breathe` cannot be failed, and no Playground result ever touches `mastery`, `points`, or the integrity score.

**(critic) Four of the six games are unplayable for some learner as specified, and "the games remain fully playable" in §10.9 is not true without these four rules.**

1. **`follow-the-dot` is motion, all the way down.** It cannot be made reduced-motion-safe by dimming it. Under resolved reduced motion it is not silently downgraded and not silently hidden: the card stays, states plainly that it is a movement game, and offers **Grid** or **Twitch** as the substitute. A learner who wants it anyway can start it from that card — the choice is theirs, which is the whole point of the preference.
2. **`color-nback` must not be colour-only.** Around 1 in 12 men cannot reliably separate the palette. Every stimulus carries a shape *and* a colour (and a tone when interface sound is on), so it is playable on shape alone. Rename in copy to "Two Back" as already specified and never describe a stimulus by colour in the UI.
3. **`rhythm` must not be audio-only.** The beat is shown as well as heard — a visual pulse plus a travelling marker — so the game is playable muted and playable deaf. It is the one Playground game where sound is the natural channel, and that is exactly why it needs the visible one.
4. **`breathe` must not require a sustained hold.** Holding a key or the pointer for a 4-7-8 cycle is a motor-accessibility wall (WCAG 2.5 territory) and it is also just unpleasant. The default input is one tap per phase transition, with hold-to-pace as an option; and since `breathe` cannot be failed, a learner who does nothing at all still completes it and still scores.

**Ruling R7.5.** `DrillKind` gains the six ids above, and `DrillItem` and `DrillResult` each gain `lane: 'arcade' | 'play'` (contracts addition, section 11.4). Playground games are code, not seeded content, so the seed loader writes one synthetic `DrillItem` per game (`id: 'play-<kind>'`, `difficulty: 3`, `timeLimitS` per the table) so the existing `drill_results` shape and streak math need no special case.

**Ruling R7.6a (critic) — `DrillResult.score` stays 0-100 for every kind, in both lanes.** The score formulas in the Playground table produce values up to 10,000 while every existing drill scores 0-100 (`scoreTimedCorrect` clamps to [50,100]). They land in the same `drill_results` array and the same report table: `deriveDrillScores` (`src/components/report/derive.ts:267`) takes a plain `Math.max` and mean per kind, so one Follow-the-Dot run would render a report row two orders of magnitude off every other row, and a "personal best" comparison across kinds would be meaningless. So each game's raw number is normalised to 0-100 by a pure per-game function before it becomes a `DrillResult.score`, and the raw value is kept in the item payload for the run summary, where "842 ms mean reaction" is the interesting number and "73" is not. Personal bests compare normalised scores within one kind, which is the only comparison the product ever makes.

**Ruling R7.6b (critic) — `wellness.drill_results` gets a cap and stops being read-modify-write.** It is an unbounded `jsonb` array today, appended by reading the whole array and writing it back (`derot/[kind]/page.tsx:79-99`). Playground runs are 60-120 seconds each, so the array grows several times faster than v1 assumed, two tabs racing lose a run, and the same array is re-read on `/derot`, on the runner and in `/reports`. Cap it at the most recent **300** results, trimmed oldest-first on write, and do the append server-side with a small `security definer` function taking one result so the read-modify-write happens inside one statement. Per-kind bests are computed from the capped window and cached in the same row, so trimming can never lose a personal best.

**(critic) Note for the contracts PR:** `DRILL_KINDS`, `DRILL_META` (`src/app/(app)/derot/lib.ts:8-16`) and `DRILL_KIND_ORDER` (`src/components/report/derive.ts`) are exhaustive over `DrillKind`, so adding six ids is a compile error until all three are extended. That is the good kind of breakage — but it means the `DrillKind` addition and those three constants land in the same commit, not in different waves.

**Ruling R7.6.** The Buddy's de-rot suggestion (after three consecutive fails, which already exists) picks a lane from context: after a hard failure run it suggests Playground ("step off it for ninety seconds"); after a long idle gap it suggests Arcade. This is copy inside the existing Buddy reply, not a new trigger.

### 7.10 Asset list and licences

Every file that lands in `public/sounds/` gets one row in `public/sounds/CREDITS.md`: filename, source, author, licence, URL. That ledger is what keeps an MIT repo genuinely forkable.

| Need | Source | Licence | Note |
|---|---|---|---|
| UI clicks, confirm, cancel | Kenney, UI Audio (50 sounds) | CC0 | primary source; no attribution required, no redistribution restriction |
| Hover and select variety | Kenney, Interface Sounds (100) | CC0 | |
| Pass thump, fail thud | Kenney, Impact Sounds (130) | CC0 | |
| Retro blips: XP tick, level register | Kenney, Digital Audio (60) | CC0 | fits a coding tool |
| Streak ignite whoosh, layered level-up fanfare, buddy pop | Freesound, CC0-filtered search through APIv2 | CC0, or CC-BY **only** with a CREDITS row | fetched by `scripts/fetch-sounds.mjs` from a pinned id list, never hand-downloaded, so provenance is reproducible |
| Sprite builder | `audiosprite` (ffmpeg-backed) | MIT | **devDependency only**, run by `scripts/build-sound-sprite.mjs`; never a runtime dependency |
| Playback | `howler` 2.2.4 | MIT | new runtime dependency |
| Confetti | `canvas-confetti` | ISC | new runtime dependency, about 6 KB gzip, ships `disableForReducedMotion` |
| **Never committed** | Mixkit, Pixabay | their own terms forbid redistributing content standalone or in original form | a public MIT repo is exactly that. Inspiration only. |

**Format and budget.** Every source clip is mono, 44.1 kHz, well under one second. The sprite emits **both** webm (primary, better compression) and mp3 (the fallback that actually protects Safari before 18.4, which did not support WebM with Opus). Combined budget: under **120 KB per format**, loaded after the first gesture, never on a route's critical path.

---

## 8. Themes

### 8.1 Architecture

Two layers, the same shape `globals.css` already has, widened from one theme to four:

1. **Primitive values** live inside one `[data-theme="…"]` block and are never referenced by a component.
2. **Semantic tokens** are the role names the shadcn/Base UI components already consume (`--background`, `--primary`, `--border`, …). Every theme block redefines the *same* semantic names.

**No component ever branches on which theme is active.** That indirection is the entire point, and it is why this is additive to v1 rather than a rewrite: the `@theme inline` block already sitting at `globals.css:43-85` keeps its shape and only gains more theme blocks feeding it.

**Ruling R8.1.** Four named looks on one axis (`data-theme="midnight|amber|paper|arcade"`), not a light/dark binary with a brand layered on top. Two of the four are dark. One axis is simpler to build and to QA than a light/dark by brand matrix, and it matches what was actually asked for.

**Ruling R8.2.** Fix the latent bug while touching this file: `:root` currently sets `color-scheme: dark` immediately above a *light* `--background: oklch(1 0 0)`. Each theme block sets its own `color-scheme` so native form controls and scrollbars follow the theme.

### 8.2 Wiring and no-flash

```tsx
// src/app/providers.tsx — client component, as next-themes requires in the App Router
<ThemeProvider
  attribute="data-theme"
  themes={['midnight', 'amber', 'paper', 'arcade']}
  defaultTheme="midnight"
  enableSystem={false}
  storageKey="brogram:theme"
  disableTransitionOnChange
>
  {children}
</ThemeProvider>
```

```tsx
// src/app/layout.tsx
<html lang="en" suppressHydrationWarning>
```

- `next-themes@0.4.6` is already installed and currently used only by the toast wrapper. Its injected pre-hydration script reads `localStorage` before React mounts; that script **is** the no-flash mechanism, and `suppressHydrationWarning` on `<html>` is required because the attribute is set by that script rather than by the first server render.
- `enableSystem={false}` is deliberate. System detection keys off two poles named `light`/`dark`; four discrete personalities do not reduce to a binary. Everyone defaults to **Midnight** and the picker is impossible to miss.
- **(critic) The empty-storage first paint is not a deferral, it is a two-line accessibility default and it ships in v2.** Deferring it means a learner whose OS says "I need high contrast" or "I need light" gets a low-contrast dark theme on their very first screen, before they know a picker exists. In the pre-hydration script, only when `localStorage['brogram:theme']` is empty: `prefers-contrast: more` → `arcade`; else `prefers-color-scheme: light` → `paper`; else `midnight`. It is one read of two media queries in a script that already runs before paint, it never overrides an explicit choice, and it costs nothing. `enableSystem` stays `false` — this is a one-time seed of the stored value, not ongoing system following, which is the distinction that made the four-personality argument correct in the first place.
- `disableTransitionOnChange` plus `[data-theme-switching] * { transition: none !important }` prevents a hundred elements cross-fading independently on switch.
- The dark class hardcoded on `<html>` (`src/app/layout.tsx:28`) is removed in the same commit.

### 8.3 The four palettes

Anchors in OKLCH, because two OKLCH colours at the same `L` read as equally bright regardless of hue, which is what lets four palettes share fixed lightness anchors and swap hue without re-deriving contrast by eye. **The `L` values are the load-bearing part; hue and chroma are adjustable to taste.**

**Ruling R8.3.** Every foreground/background pair ships only after passing **both** WCAG 2.2 ratio checks and APCA `Lc` targets — body text `Lc >= 75` (90 preferred), large text and UI components `Lc >= 60`, focus rings and dividers `Lc >= 45`. Dark themes are assigned independently, never derived by inverting the light one. Verification is a task on the ledger with named tools (a live shadcn theme editor for the components, apcacontrast.com for the borderline pairs); no theme ships on this document's numbers alone.

```css
/* Midnight — dark default. Confident, cool, the 2am default. */
[data-theme="midnight"] {
  color-scheme: dark;
  --background: oklch(0.16 0.014 260);
  --foreground: oklch(0.96 0.005 260);
  --card: oklch(0.20 0.016 260);
  --card-foreground: var(--foreground);
  --popover: oklch(0.23 0.016 260);
  --popover-foreground: var(--foreground);
  --primary: oklch(0.72 0.19 264);
  --primary-foreground: oklch(0.15 0.02 264);
  --secondary: oklch(0.27 0.014 260);
  --secondary-foreground: var(--foreground);
  --muted: oklch(0.27 0.014 260);
  --muted-foreground: oklch(0.66 0.02 260);
  --accent: oklch(0.74 0.14 200);
  --accent-foreground: oklch(0.15 0.02 200);
  --destructive: oklch(0.65 0.21 25);
  --destructive-foreground: oklch(0.15 0.02 25);
  --success: oklch(0.75 0.16 150);
  --success-foreground: oklch(0.15 0.02 150);
  --warning: oklch(0.80 0.15 85);
  --warning-foreground: oklch(0.16 0.02 85);
  --celebration: oklch(0.80 0.19 95);
  --celebration-foreground: oklch(0.16 0.02 95);
  --glow: oklch(0.72 0.19 264 / 0.35);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 12%);
  --ring: oklch(0.72 0.19 264 / 0.6);
  --radius: 0.625rem;
}

/* Amber — warm dark. Cozy, lamp-lit desk. */
[data-theme="amber"] {
  color-scheme: dark;
  --background: oklch(0.17 0.02 55);
  --foreground: oklch(0.95 0.01 70);
  --card: oklch(0.21 0.024 55);
  --card-foreground: var(--foreground);
  --popover: oklch(0.24 0.024 55);
  --popover-foreground: var(--foreground);
  --primary: oklch(0.74 0.16 55);
  --primary-foreground: oklch(0.16 0.02 55);
  --secondary: oklch(0.28 0.02 55);
  --secondary-foreground: var(--foreground);
  --muted: oklch(0.28 0.02 55);
  --muted-foreground: oklch(0.68 0.02 60);
  --accent: oklch(0.72 0.13 35);
  --accent-foreground: oklch(0.16 0.02 35);
  --destructive: oklch(0.65 0.22 25);
  --destructive-foreground: oklch(0.16 0.02 25);
  --success: oklch(0.73 0.15 140);
  --success-foreground: oklch(0.16 0.02 140);
  --warning: oklch(0.80 0.16 85);
  --warning-foreground: oklch(0.16 0.02 85);
  --celebration: oklch(0.82 0.17 80);
  --celebration-foreground: oklch(0.16 0.02 80);
  --glow: oklch(0.74 0.16 55 / 0.32);
  --border: oklch(0.9 0.02 60 / 12%);
  --input: oklch(0.9 0.02 60 / 14%);
  --ring: oklch(0.74 0.16 55 / 0.6);
  --radius: 0.875rem;
}

/* Paper — light. Daytime, notebook, unhurried. Cream, never stark white. */
[data-theme="paper"] {
  color-scheme: light;
  --background: oklch(0.97 0.008 85);
  --foreground: oklch(0.22 0.015 55);
  --card: oklch(0.99 0.006 85);
  --card-foreground: var(--foreground);
  --popover: oklch(1 0 0);
  --popover-foreground: var(--foreground);
  --primary: oklch(0.42 0.11 220);
  --primary-foreground: oklch(0.98 0.005 85);
  --secondary: oklch(0.93 0.012 85);
  --secondary-foreground: var(--foreground);
  --muted: oklch(0.93 0.012 85);
  --muted-foreground: oklch(0.45 0.02 70);
  --accent: oklch(0.55 0.14 35);
  --accent-foreground: oklch(0.98 0.005 85);
  --destructive: oklch(0.55 0.20 25);
  --destructive-foreground: oklch(0.98 0.005 85);
  --success: oklch(0.45 0.12 150);
  --success-foreground: oklch(0.98 0.005 85);
  --warning: oklch(0.62 0.15 80);
  --warning-foreground: oklch(0.18 0.02 80);
  --celebration: oklch(0.60 0.16 70);
  --celebration-foreground: oklch(0.98 0.005 85);
  --glow: oklch(0.42 0.11 220 / 0.18);
  --border: oklch(0.85 0.01 85);
  --input: oklch(0.88 0.01 85);
  --ring: oklch(0.42 0.11 220 / 0.5);
  --radius: 0.75rem;
}

/* Arcade — high contrast. Cabinet glow. Maximum legibility. */
[data-theme="arcade"] {
  color-scheme: dark;
  --background: oklch(0.12 0 0);
  --foreground: oklch(0.99 0 0);
  --card: oklch(0.16 0 0);
  --card-foreground: var(--foreground);
  --popover: oklch(0.19 0 0);
  --popover-foreground: var(--foreground);
  --primary: oklch(0.85 0.16 195);
  --primary-foreground: oklch(0.12 0 0);
  --secondary: oklch(0.24 0 0);
  --secondary-foreground: var(--foreground);
  --muted: oklch(0.24 0 0);
  --muted-foreground: oklch(0.75 0 0);
  --accent: oklch(0.75 0.22 350);
  --accent-foreground: oklch(0.12 0 0);
  --destructive: oklch(0.70 0.22 25);
  --destructive-foreground: oklch(0.12 0 0);
  --success: oklch(0.82 0.19 145);
  --success-foreground: oklch(0.12 0 0);
  --warning: oklch(0.85 0.17 95);
  --warning-foreground: oklch(0.12 0 0);
  --celebration: oklch(0.85 0.18 90);
  --celebration-foreground: oklch(0.12 0 0);
  --glow: oklch(0.85 0.16 195 / 0.5);
  --border: oklch(1 0 0 / 18%);
  --input: oklch(1 0 0 / 20%);
  --ring: oklch(0.85 0.16 195 / 0.7);
  --radius: 0.25rem;
}
```

Why these choices, briefly, so nobody "improves" them into mush:

- **Arcade stays hue-neutral on background, card, secondary and muted on purpose.** Neon works through restraint: one hero neon (cyan, carrying `primary` and every interactive state), one support neon (magenta, reserved for `accent` and celebrations, used sparingly), and a stable neutral structure. Two or three competing saturated hues on a saturated ground produce optical vibration, eye strain, and stop being a high-contrast accessibility theme.
- **Amber and Paper use warm neutrals, never pure black or pure white.** A deep desaturated warm base is measurably more comfortable for long sessions than pure black, and a cream page beats stark white for the same reason.
- **`--celebration` is a new token, not a repaint of `--primary` or `--warning`.** A streak burst must read as the same golden accent in all four themes, independent of the theme's own primary hue.

### 8.4 New semantic tokens (additive; nothing is renamed)

| Token | Why it does not exist yet | Used for |
|---|---|---|
| `--destructive-foreground` | text on destructive currently relies on assumption, which will not hold across four destructive hues | text and icons on destructive surfaces |
| `--success` / `--success-foreground` | no success colour exists at all today; pass states borrow ad-hoc emerald utilities (`Rail.tsx:217`) | pass banners, checks, verified badges |
| `--warning` / `--warning-foreground` | same gap | restricted banners, low-time warnings |
| `--celebration` / `--celebration-foreground` | a new concept | streak flame, level-up burst, XP highlight, locked-skill node |
| `--glow` | dark and Arcade themes communicate elevation with light, not shadow | focus and active glow, confetti-adjacent highlight |

### 8.5 Elevation, per theme

One shadow scale cannot serve Paper and Arcade, because they signal depth by opposite mechanisms. Implement as a `--shadow-*` namespace with four flat sizes (`xs`, `sm`, `md`, `lg`) redefined inside each theme block, exactly as `--radius-*` already is.

- **Paper**: conventional soft shadow, e.g. `0 4px 12px oklch(0.4 0.02 70 / 0.10)`.
- **Midnight and Amber**: a black shadow on a near-black ground is invisible. Elevation is communicated by **lightening the surface**: `--card` already sits measurably lighter than `--background`, and `--popover` sits lighter again. A modal or dropdown raises the surface token, it does not deepen the shadow.
- **Arcade**: elevation and interactivity both read as a **coloured glow** — a two-radius `box-shadow` in the hero hue at low opacity, e.g. `0 0 8px var(--glow), 0 0 24px oklch(0.85 0.16 195 / 0.2)`. Never as `text-shadow`, which destroys legibility.

### 8.6 Motion tokens

| Token | Value | Use |
|---|---|---|
| `--duration-instant` | 100 ms | button press, checkbox tick |
| `--duration-fast` | 150 ms | hover, small state changes |
| `--duration-base` | 200 ms | panel and tab transitions |
| `--duration-slow` | 320 ms | modal and drawer open, theme cross-fade |
| `--duration-celebration` | 600-900 ms | streak burst, level up. The only tier allowed this long, and only for positive moments. |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | default |
| `--ease-enter` | `cubic-bezier(0.22, 1, 0.36, 1)` | entrances, transform hover |
| `--ease-move` | `cubic-bezier(0.25, 1, 0.5, 1)` | slides, panels |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | drawers, sheets |

Celebration motion uses a real spring (`duration: 0.5, bounce: 0.2`), not a keyframed overshoot, because a spring interrupts and resumes naturally when the learner acts mid-animation. Under reduced motion `--duration-celebration` collapses to `--duration-fast` and the spring becomes an opacity cross-fade.

### 8.7 Typography

Geist Sans and Geist Mono are already wired as `--font-sans` and `--font-mono`. Keep both; Inter stays forbidden. The scale is BroGram's own, built from Geist's two load-bearing traits: 14 px body default, and letter-spacing that tightens as size grows.

| Role | Size / line-height | Tracking | Weight | Font |
|---|---|---|---|---|
| Display (level-up, hero numbers) | 48 / 56 | -0.02em | 600 | Sans |
| H1 | 32 / 40 | -0.015em | 600 | Sans |
| H2 | 24 / 32 | -0.01em | 600 | Sans |
| H3 | 20 / 28 | -0.005em | 600 | Sans |
| H4, large label | 16 / 24 | 0 | 600 | Sans |
| Body | 14 / 22 | 0 | 400 | Sans |
| Small, caption | 13 / 20 | 0 | 400 | Sans |
| Micro, meta (the only place uppercase is allowed) | 12 / 16 | +0.01em | 500 | Sans |
| Code, editor | 13 / 20 | 0 | 400 | Mono |

**`font-variant-numeric: tabular-nums` on every counter that ticks live** — streak days, XP, level, hint countdown, drill timer, combo. Digits then hold fixed width while changing, so a counter animating upward never jitters the layout around it.

### 8.8 The picker, and persistence

**Ruling R8.4.** The canonical picker lives in **Account**, under one "Make it yours" panel that also holds the dock placement, sound, motion and daily-goal controls. Scattering these across three settings pages is what made them invisible in v1. A quick-switch popover on the shell header icon carries the same four swatches for discoverability.

- Not a segmented control. Four full personalities are a small grid of live swatch previews (background, primary and accent dots plus the name), `role="radiogroup"` with `role="radio"` children so it is keyboard- and screen-reader-navigable.
- Optional progressive enhancement: `document.startViewTransition` gives the switch a circular wipe from the trigger. Feature-detected, and itself gated on reduced motion.

**Persistence, two tiers, matching the dock:**

1. `next-themes`' own `localStorage` under `brogram:theme` is the source of truth for first paint. It must stay device-local and instant and must never wait on a network round trip.
2. `wellness.prefs.theme` carries the cross-device copy (a contracts addition, section 11.4). On sign-in, reconcile: a server value that differs from the local value wins and overwrites `localStorage`; a local value chosen before any server value existed becomes the first write. This is the same local-first-then-synced shape `Rail.tsx` already implements for water and pomodoro logs.

---

## 9. Honest lockdown

### 9.1 The principle

Say what is actually true about each mechanism, per mechanism, instead of presenting three very different things as equally "protected".

| Mechanism | The truth |
|---|---|
| Paste, copy, cut, context-menu blocking | **Real enforcement.** `preventDefault()` on clipboard events genuinely stops the paste before content lands in the editor, in every major browser. This is the one thing BroGram can claim without hedging, and it does. |
| Blur and tab-away detection | **A genuine signal, not proof.** `visibilitychange` and `blur` are standard, and a browser extension that spoofs the Page Visibility API exists. Evidence, weighted over time, never a verdict on its own. |
| PrintScreen detection | **Best effort against one key, after the fact.** By the time `keyup` fires the OS has already rasterised the frame. It catches nothing from a phone camera, an OS recorder, or a second machine. |
| Screenshots in general | **Not preventable by any web technology, full stop.** The only products that meaningfully restrict capture use OS or DRM hooks unavailable to a web app, and even those are bypassable. |

The academic-proctoring literature converges on the same conclusion the owner reached by instinct: transparent, up-front communication about exactly what is watched and why measurably reduces anxiety and makes a system feel fair, where unexplained blocking does the opposite.

### 9.2 What stays, unchanged

Everything in `useLockdown.ts` that works, and every log row:

- **Blur guard.** `visibilitychange` hidden or `window.blur` raises a full-screen opaque overlay above the editor (a separate element, not a filter). Focus returns, overlay goes. Logged as `blur`, weight 1, with `duringAttempt`.
- **Idle guard.** No `keydown` or `mousemove` for `LOCKDOWN.idleBlurAfterS` (15 s) raises an 85 percent overlay with heavy backdrop blur. Any input clears it. Logged as `idle` only past `idleLogAfterS` (60 s), weight 0.
- **Clipboard guard.** `copy`, `cut`, `paste` and `contextmenu` prevented on the exercise container and inside the editor. Logged at weights 2, 2, 2 and 0.
- **The per-type coalescing and 1 s batched insert** (`useLockdown.ts:50-82`), the `logIntegrity` dedupe, the insert-only table discipline, the `during_attempt` capture. None of this is touched.
- **Escalation math**, unchanged and quoted back to the learner verbatim: over a rolling 7 days, score at or above 10 warns, 20 restricts for 24 hours, 40 bans; five paste blocks inside one exercise restricts for 24 hours immediately, regardless of score. `restricted_until` does not stack. Admin ids are exempt.
- **The real wall stays the real wall.** Per-student variant exercises mean a leaked solution matches nobody else's problem. The learner is told this, because it is true and because it undercuts the temptation to build more detection theatre later.

### 9.3 What changes

**Ruling R9.1 — the PrintScreen overlay is retired entirely.** Delete the two-second full-screen cover and the `navigator.clipboard.writeText('')` attempt (`useLockdown.ts:131-141`, `LockdownOverlay.tsx:17,19`). The cover fires after the capture has already happened, protects nothing, and punishes a learner who pressed the key for an unrelated reason. **Keep the `keyup` listener and keep the `printscreen` event row** (still weight 3) — the log is the only thing that guard ever genuinely produced, and it is legitimately useful.

**Ruling R9.2 — acknowledgement is a pattern, not a keypress.** On the **third** `printscreen` event within one exercise, and once only, a non-blocking inline note appears in the results panel (not a modal, not a full-screen anything): *"Screenshots aren't something a website can block. We log the attempt and move on."* Subsequent presses in that exercise say nothing.

**Ruling R9.3 — the paste block rotates and explains.** The single static string (`useLockdown.ts:87`) becomes the four-line rotating set from section 2.7, chosen so the same line never appears twice in a row. A small "why" affordance on the toast expands one honest sentence: *"Paste is off because typing is the exercise, and because it is the one thing browsers actually let us enforce, so we do."*

**Ruling R9.4 — restricted and banned screens are itemised receipts, not verdicts from nowhere.** The learner sees their own numbers with the real weights. This needs one new read path, because `integrity_events` correctly has no SELECT grant for non-admins and must keep none: a `security definer` function `public.my_integrity_breakdown()` returns **aggregate counts per event type over the 7-day window for `auth.uid()` only** — no raw rows, no timestamps, no other users, nothing that could turn into a surveillance feed. Migration in section 11.2.

Restricted screen:

> Exercises are paused for 24 hours. Here is the arithmetic.
> Screenshot attempts, 3 at weight 3 — 9
> Paste blocked, 4 at weight 2 — 8
> Tab-away, 3 at weight 1 — 3
> Total 20. The line is 20.
> Reps come back at {time}. Everything else — dashboard, walkthroughs, De-rot — stays open.

Banned screen **(corrected — critic)**:

> This account is banned. The score crossed 40 in the last 7 days. The weights are 3 for a screenshot attempt, 2 for a blocked paste or copy, 1 for leaving the tab, and the lines are 10, 20 and 40 — the same for everyone.
> If this is wrong, reply to {contact} with your account email and we will read the actual log, not just the number.

**(critic) The itemised list cannot appear on the banned screen, because a banned learner has no session to itemise from.** `src/lib/supabase/middleware.ts:63` signs a banned user out and redirects to `/login?reason=banned`, so the screen renders unauthenticated; `my_integrity_breakdown()` reads `auth.uid()` and would return nothing. Shipping the receipt copy as written would produce a permanently empty table on the one screen where an empty table reads as a cover-up. Two consequences, both rulings:

1. The banned screen states the policy — weights, thresholds, window, appeal contact — and no per-user numbers. That is still radically more honest than v1's one-line message, and it is true.
2. **The receipt has to arrive before the ban, or it never arrives.** The itemised breakdown is therefore shown on the **warned** screen (score ≥ 10, nothing paused) and on the **restricted** screen, both of which the learner sees while signed in, and it is permanently available in Account → Integrity explained from the first day. A learner should never first see their own arithmetic at the moment it is too late to act on it. `guard.warned` already exists in §9.4's copy set for exactly this.

The restricted receipt above is unchanged; a restricted learner is still signed in and `my_integrity_breakdown()` answers normally.

Instant-restrict variant:

> Paste got blocked 5 times in this one exercise, so it is paused for 24 hours. That is an automatic rule, not a judgment call, and it fires at exactly 5 for everyone.

**Ruling R9.5 — an "Integrity, explained" panel in Account**, permanently reachable and linked from the restricted and banned screens. It states the whole policy once, in voice, so nothing else has to re-explain itself: what is enforced (paste), what is a signal (blur, PrintScreen), what is impossible (screenshots), the exact thresholds, the learner's own current score and breakdown, and the variant-exercise backstop. Copy line 56 in section 2.7 is its opening paragraph.

**Ruling R9.6 — enforcement surfaces get no personality and no juice.** Flat register, no "bro", no sound, no animation, no colour beyond `--warning` and `--destructive`. The voice does not switch off here; it goes quiet. This is a review checklist item, not a preference. **(critic) Three places in the first draft broke this rule and are corrected where they sit:** the paste toast's "micro-shake" in §7.6 (animation on a guard, and a punitive one); `guard.paste` variants 47 and 49 in §2.7 ("your fingers do the learning", "doesn't build the muscle" — moralising, which is personality); and the guard set as a whole, which needed a third variant per rule 6 because blur and idle fire many times a session. A rotating set of four sermons is still a sermon, and it is the thing the owner actually complained about.

### 9.4 The lockdown copy set

| Key | Lines (rotating) |
|---|---|
| `guard.paste` | "Typed, not pasted. Your fingers do the learning." / "Paste is off in here on purpose. Type it out." / "Copy-paste doesn't build the muscle. Type it." / "Keyboard only. That's the rep." |
| `guard.blur` | "Paused — you clicked away. Come back to pick it up." / "Work's held right here. Click back in when you're ready." |
| `guard.idle` | "Quiet for a bit, so we paused. Type anything to keep going." / "Still here, still yours. Jump back in whenever." |
| `guard.printscreen` | "Screenshots aren't something a website can block. We log the attempt and move on." (once per exercise, on the third event) |
| `guard.why` | "Paste is the one thing browsers actually let us stop, so we stop it. Leaving the tab and pressing PrintScreen are signals we log, not things we can prevent. Screenshots can't be prevented by anyone. The real backstop is that your exercises aren't the same as anyone else's." |
| `guard.warned` | "Heads up: your flag count crossed 10 this week. Nothing is paused. Here's exactly what counted." |
| `guard.restricted` | (the itemised receipt above) |
| `guard.banned` | (the itemised receipt above) |

The permanent grey "Type your own work" label pinned to the editor header (`exercise/[id]/page.tsx:54`) is removed. Standing surveillance labels change nothing and cost trust; the rule is stated once in the walkthrough and once in the Integrity panel, and the toast says it when it actually matters.

---

## 10. Screens

Every screen lists what it shows, its states, and its motion. Common to all: the shell header (logo, course switcher, De-rot, Progress, Buddy, sound toggle, theme quick-switch, account), the wellness dock in the learner's placement, and the footer line "Built by Velocity" beside the open-source link. Every route has a shape-matched `loading.tsx`. No screen has an unstyled error state; every one uses the shared `<ErrorRetry>` with a `retry()` that re-runs the server fetch.

### 10.1 `/login`

**Shows.** Product line, email and password fields (magic link when `NEXT_PUBLIC_AUTH_MAGIC_LINK` is on), the honest note that accounts are issued by the admin during the beta.
**States.** Idle, submitting, error (verbatim hook message: wrong domain, not invited, bad credentials), banned notice with the appeal contact, already-signed-in redirect to `/dashboard`.
**Motion.** One staggered entrance for the form block (40 ms per row, under 200 ms total). Button press scale. Nothing else.

### 10.2 `/onboarding`

**Shows.** Six cards, one at a time, two large options each, a six-dot progress row. Then the course picker.
**States.** Question (1 of 6 through 6 of 6), course picker, redirect-to-`/courses` when `onboardingComplete` is already true.
**Motion.** Card exits left and the next enters from the right on the move curve, 200 ms — direction matches progress, which is what makes it read as forward motion. The chosen option gets a 120 ms fill before the exit. **No busy state between cards, ever** (R4.2).

### 10.3 `/dashboard` — "Today"

**Shows.** Resume card, streak flame with today's status, daily-goal ring, Next up (three cards per R3.8), level bar with XP, the last three trophies, De-rot entry with its own streak, one Buddy prompt line.
**States.** First-visit empty (no course chosen: one card, "Pick a course"), normal, restricted banner, warned banner, offline banner.
**Motion.** Content blocks stagger in at 40 ms once, on first mount only (never on back-navigation, where the cache is warm and motion would read as slowness). The XP bar and streak flame animate only when their value actually changed since the last render. `<ViewTransition>` cross-fade on route entry.

### 10.4 `/course/[code]` — course home

**Shows.** Course header with your level for this course; the **path map** (nodes = skills, edges from `Clo.prerequisites`, six node states per section 3.5); Next up; a collapsible flat list of every skill.
**States.** Loading skeleton (map shape with grey nodes), normal, draft-CLO markers, restricted (map read-only, walkthroughs still open), course `coming-soon`.
**Motion.** Nodes stagger along the path on first paint, 30 ms apart, capped at 300 ms total. A node that just locked plays its fill once and then stays lit permanently. Hovering a node lifts it 2 px and prefetches its lesson and first rep. Edges draw once on first visit only (`stroke-dashoffset`, 600 ms), never again. Under reduced motion, R7.9 applies: no stagger, edges render complete.

**Accessibility (critic — the first draft gave the centrepiece of the product no keyboard or screen-reader story at all).** The map is a **progressive enhancement over a real list**, not a canvas with click targets. The DOM is an ordered list of links in `path` order; each item's accessible name is the skill plus its state plus its progress ("Loops that stop when you tell them to — in progress, 2 of 3"), and prerequisite relationships are exposed with `aria-describedby` pointing at the prerequisite item, which is what an edge means. Tab moves through the nodes in path order; Enter opens; the SVG edges are `aria-hidden` decoration on top. Node state is **never** carried by colour alone — locked, available, in-progress and locked-in each have a distinct shape or fill pattern as well as a token, because six states across four themes cannot be told apart by hue by every learner. The collapsed "everything in this course" flat list stays, and it is the same data, not a second implementation.

### 10.5 `/lesson/[cloId]` — the walkthrough

**Shows.** In order: hook line, concept, optional runnable snippet, worked example with steppable callouts, one to three checks, recap, bridge to the rep. A slim left progress rail. A "skip this" affordance in the header, always.
**States.** Loading skeleton, in-progress, check-pending, check-right, check-wrong (hint), check-explained, complete, skipped, draft marker, runtime warming (for a runnable snippet on a cold language), Java (snippet static with an honest one-liner).
**Motion.** Blocks reveal on scroll into view, once, with an 8 px rise and fade over 300 ms on the enter curve. Worked-example steps advance on click or Enter: the previous callout fades to 40 percent and the highlight band slides to the new lines on the move curve, 200 ms. A right check draws a checkmark **and** shows a check glyph plus the word "Right"; a wrong check settles amber **with a distinct glyph and the word "Not yet"**, plus a 4 px shake, once. The bridge card slides up at the end. No looping motion anywhere — this is a reading surface. Under reduced motion, R7.9 applies: reveals render immediately, the shake does not play, and the verdict is unchanged.

**Accessibility (critic).** Two gaps in the check kinds as specified. **(a)** `spot-the-bug` is "click the broken line" — every line is a focusable control with the line number and its text as the accessible name, arrow keys move between them, Enter selects; a mouse is never required. **(b)** Right and wrong must not be carried by `--success` green and amber alone — every verdict pairs the colour with a glyph and a word, which is also what makes the two states legible in Arcade, where both tokens are saturated. The verdict is announced in an `aria-live="polite"` region so a screen-reader user is told the outcome without moving focus, and the `hint` and `explain` reveals follow it in DOM order rather than being injected above the learner's position.

### 10.6 `/exercise/[id]`

**Shows.** Prompt panel (with a "walkthrough" link back to the lesson), editor, results panel, run and submit, hints-left pips, chain pips (1 of 3), the fix plan panel, the dock in compact mode.
**States.** Opening (editor skeleton with the real chrome, not a sentence), runtime warming with real progress, ready, running, **graded** (new: pass/fail revealed instantly), saving (a quiet inline indicator while the background chain runs), passed, failed, hint streaming, blur cover, idle cover, restricted, save-failed banner, judge-absent notice (Java).
**Motion.** The quietest screen in the product while composing: no ambient motion, no decorative animation, the editor never remounts. All juice is at the transition — pass fires the checkmark draw, the XP tween, the panel-anchored confetti and the chain pip; fail shakes only the failing test row. Moving to the next rep swaps state in place under a `<ViewTransition>` on the prompt panel; the editor and the warm runtime survive. **No route transition wraps this screen.**

### 10.7 `/courses`

**Shows.** Every live course as a card with title, language, level, your progress ring, and whether you have a path there. `coming-soon` courses shown honestly, disabled, with the reason.
**States.** Normal, switching (optimistic: navigation happens immediately), planner-refining (a one-line "tuning your path" chip, dismissible, never blocking), planner-failed (silent; the provisional plan stands).
**Motion.** Cards stagger in at 40 ms. The chosen card scales to 0.98 on press, then the route transitions. **No spinner** — the switch is optimistic by construction (R4.4).

### 10.8 `/derot` — the hub

**Shows.** The two-lane switch (Arcade / Playground), the de-rot streak, today's runs, your best per drill, and six cards per lane.
**States.** Loading skeleton, normal, first-visit (no runs yet), restricted (open — de-rot is never restricted).
**Motion.** The lane switch slides an indicator under the active tab, 200 ms move curve, and the card grid cross-fades with a 30 ms stagger. Each card has one small idle micro-motion (a drifting dot on Follow the Dot, a pulsing beat on Keep Time) that pauses off-screen via `IntersectionObserver` and stops entirely under reduced motion.

### 10.9 `/derot/arcade/[kind]` and `/derot/play/[game]`

**Shows (Arcade).** Countdown ring, item, combo meter, run progress (item 3 of 6), then the run summary with score, accuracy, best combo, personal-best badge, your last five runs.
**Shows (Playground).** The game canvas, a timer, a live score, then the same summary shape.
**States.** Ready (a three-two-one start so nobody is caught cold), running, item-correct, item-wrong, run complete, personal best, voided (Don't Blink only, when focus is lost — the existing rule).
**Motion.** This is the loudest surface in the product and it is allowed to be. Countdown ring, combo pop on each multiplier step, score count-up on the summary, a personal-best stamp. Under reduced motion the ring becomes a numeric countdown and the pops become colour changes; the games remain fully playable.

### 10.10 `/reports` — "Progress"

**Shows.** Two tabs. **Trophies**: the twenty achievement cards, unlocked ones lit with their date, locked ones showing their rule. **Report**: mastery per skill, angles passed, mistake trend, time spent, de-rot scores, the Planner's focus line, and the PDF export.
**States.** Loading skeleton, empty (no attempts yet), normal, PDF generating, PDF failed.
**Motion.** Trophy cards stagger in at 30 ms. A trophy unlocked in this session gets one entrance flourish and then sits still. The report tab is a document: no motion beyond the tab indicator.

### 10.11 `/account`

**Shows.** One "Make it yours" panel first (theme swatches, dock placement, dock collapse, compact-on-exercise, sound on/off and volume, motion preference, daily goal), then "How the Bro talks" (tone, verbosity, depth, beyond-courses), then Integrity explained with the learner's own breakdown, then Diagnostics (the local web-vitals ring buffer), then password change and sign-out.
**States.** Normal, saving (never blocking — every control is optimistic), save-failed toast, banned/restricted context.
**Motion.** Theme switch is instant with transitions suppressed during the swap. Toggles animate their own knob and nothing else.

### 10.12 Buddy drawer (overlay, every screen)

**Shows.** Chat with the Buddy, seeded with the learner-state summary; a "suggest a drill" chip; the fixed refusal for off-topic.
**States.** Closed, open, streaming, off-topic refusal (rendered without the streaming cursor), rate-limited, offline.
**Motion.** Drawer slides from the right on the drawer curve, 320 ms; exit at 200 ms. Bubbles enter with a 12 px rise. Typing dots while streaming. Nothing else.

### 10.13 `/admin`

Unchanged from v1 in shape and gating, with two additions: a **lesson coverage** table (lessons per course, per CLO, draft flags, block counts) and an **achievement distribution** table (how many learners hold each one, which is the fastest read on whether the reward curve is right). Existing skeleton stays.

---

## 11. Data changes

### 11.1 What is new, and what is deliberately not

| Thing | Decision |
|---|---|
| `lessons` | **New table.** Authoring and admin source of truth. The learner's browser never reads it. |
| `lesson_progress` | **New table.** Per user, per lesson. |
| `achievements` | **New table.** The catalogue, loaded from the `ACHIEVEMENTS` constant so SQL joins and admin stats work and a fork can read it. |
| `user_achievements` | **New table.** Per user, insert-only. |
| XP events | **Not added. Ruling R11.1.** XP is `LearnerState.points`, which already exists and is already written on every pass. Level is a pure function of it. A separate ledger would be a second number that can disagree with the first, plus a table on the hot write path, for zero product benefit. If an XP audit trail is ever wanted, `attempts` already is one. |
| Reward events | **Not a table.** Every reward in section 7 is a client-side reaction to state that already exists. Persisting them would add writes to the exact loop v2 is making faster. |
| `drills.lane` | **New column** on the existing table, defaulting to `'arcade'`. |
| Anything under `wellness.prefs` | **No migration.** It is `jsonb`; the contracts change plus `DEFAULT_WELLNESS` is the whole change, and stored rows without the keys fall back. |

### 11.2 Migrations

Four new files under `supabase/migrations/`, in the existing house style (snake_case, RLS on every table, `public.is_not_banned()` on every learner-facing policy, `search_path` pinned on every security-definer function). Applied with the same session-pooler path already proven at 20:43, and recorded in `supabase_migrations.schema_migrations`.

**`0006_lessons.sql`**

```sql
create table public.lessons (
  id                text primary key,
  clo_id            text not null references public.clos(id) on delete cascade,
  course            text not null references public.courses(code) on delete cascade,
  language          text not null,
  version           int  not null default 1,
  title             text not null,
  hook              text not null,
  estimated_minutes int  not null,
  draft             boolean not null default false,
  tags              text[] not null default '{}',
  blocks            jsonb not null,
  exit_line         text not null,
  created_at        timestamptz not null default now()
);
create index lessons_clo_idx on public.lessons (clo_id);
create index lessons_course_idx on public.lessons (course);

-- Lessons contain micro-code reference solutions. The client reads the static
-- bundle, never this table, so nothing is granted to anon or authenticated.
alter table public.lessons enable row level security;
revoke all on public.lessons from anon, authenticated;

create table public.lesson_progress (
  user_id        uuid not null references auth.users(id) on delete cascade,
  lesson_id      text not null references public.lessons(id) on delete cascade,
  clo_id         text not null,
  status         text not null check (status in ('started','completed','skipped')),
  block_index    int  not null default 0,
  checks_passed  int  not null default 0,
  checks_failed  int  not null default 0,
  lesson_version int  not null default 1,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
alter table public.lesson_progress enable row level security;

create policy lesson_progress_select_own on public.lesson_progress
  for select to authenticated
  using ((select auth.uid()) = user_id and public.is_not_banned());
create policy lesson_progress_insert_own on public.lesson_progress
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_not_banned());
create policy lesson_progress_update_own on public.lesson_progress
  for update to authenticated
  using ((select auth.uid()) = user_id and public.is_not_banned())
  with check ((select auth.uid()) = user_id and public.is_not_banned());
```

**`0007_achievements.sql`**

```sql
create table public.achievements (
  id                  text primary key,
  name                text not null,
  line                text not null,
  tier                text not null check (tier in ('bronze','silver','gold')),
  how                 text not null,
  visible_when_locked boolean not null default true,
  ordinal             int  not null   -- (critic) mirrored by Achievement.ordinal, §11.4 item 16
);
alter table public.achievements enable row level security;
-- Catalogue data, no secrets: readable by any signed-in, non-banned learner.
create policy achievements_read on public.achievements
  for select to authenticated using (public.is_not_banned());

create table public.user_achievements (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievements(id) on delete cascade,
  unlocked_at    timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.user_achievements enable row level security;

create policy user_achievements_select_own on public.user_achievements
  for select to authenticated
  using ((select auth.uid()) = user_id and public.is_not_banned());
-- Insert only. No update, no delete: an unlock is permanent and cannot be
-- rewritten, and the primary key makes a duplicate unlock impossible.
create policy user_achievements_insert_own on public.user_achievements
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_not_banned());
```

**`0008_integrity_breakdown.sql`** — the one new read path for section 9.4, deliberately narrow.

```sql
-- Returns AGGREGATE counts only, for the calling user only, over the same
-- 7-day window integrity_score() uses. No raw rows, no timestamps, no other
-- users. integrity_events keeps zero SELECT grants for non-admins.
create or replace function public.my_integrity_breakdown()
returns table (event_type text, events int, weight int, points int)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select e.type::text,
         count(*)::int,
         coalesce(w.weight, 0)::int,
         (count(*) * coalesce(w.weight, 0))::int
  from public.integrity_events e
  left join public.integrity_weights w on w.type = e.type
  where e.user_id = (select auth.uid())
    and e.created_at >= now() - interval '7 days'
  group by e.type, w.weight
  order by 4 desc, 1 asc;
$$;
revoke all on function public.my_integrity_breakdown() from public, anon;
grant execute on function public.my_integrity_breakdown() to authenticated;
```

**(critic) `public.integrity_weights` does not exist — the SQL above will not apply as printed.** `0003_integrity.sql` inlines the weights as a `case` expression inside `integrity_score(uid)` (`when 'paste-blocked' then 2 when 'copy-blocked' then 2 when 'printscreen' then 3 when 'blur' then 1 else 0`). A `left join public.integrity_weights` therefore errors on `relation does not exist`, and the prose escape hatch ("the function inlines the same weights") would leave the numbers written out in two `case` expressions — which is precisely the second source of truth R11.2 forbids. Since R11.2 is right, make it true rather than weakening it. `0008` opens by creating the table, seeding it from `INTEGRITY_WEIGHTS`, and redefining `integrity_score()` to read it, with identical numbers so no escalation behaviour changes:

```sql
create table public.integrity_weights (
  type   text primary key,
  weight int  not null
);
insert into public.integrity_weights (type, weight) values
  ('paste-blocked', 2), ('copy-blocked', 2), ('printscreen', 3),
  ('blur', 1), ('contextmenu-blocked', 0), ('idle', 0);
alter table public.integrity_weights enable row level security;
create policy integrity_weights_read on public.integrity_weights
  for select to authenticated using (true);   -- the policy IS the honesty of §9

create or replace function public.integrity_score(uid uuid) returns int
language sql stable as $
  select coalesce(sum(coalesce(w.weight, 0)), 0)::int
  from public.integrity_events e
  left join public.integrity_weights w on w.type = e.type::text
  where e.user_id = uid and e.created_at > now() - interval '7 days'
$;
```

**Ruling R11.2 (restated, now true):** there is exactly one place in the database where the weights live, `integrity_score()` and `my_integrity_breakdown()` both read it, and the existing test asserting `INTEGRITY_WEIGHTS` equals the SQL weights now compares against a table instead of parsing a `case` expression. `apply_integrity_escalation()` is untouched — it calls `integrity_score()`, which keeps its signature and its numbers.

**`0009_drill_lanes.sql`**

```sql
alter table public.drills add column lane text not null default 'arcade'
  check (lane in ('arcade','play'));
create index drills_lane_idx on public.drills (lane);
```

### 11.3 Seed loader and validator changes

`scripts/seed-load.mjs`:
1. Reads `seed/lessons/*.json` and upserts into `lessons` (service key), reporting a count the same way it reports exercises and drills.
2. Upserts the `ACHIEVEMENTS` catalogue into `achievements` (imported from the contracts module so the two can never drift; a test asserts the table matches the constant after a load).
3. Writes one synthetic `DrillItem` per Playground game with `lane: 'play'` (`id: 'play-<kind>'`, `difficulty: 3`, `timeLimitS` from the table in 7.9, `payload: {}`), so `drill_results` and streak math need no special case.
4. Sets `lane: 'arcade'` on every existing seeded drill.
5. `--dry-run` continues to report every count, and the counts become part of the acceptance checklist.

`seed/validate.mjs` gains the lesson invariants from section 3.2 and fails the build on any of them.

`scripts/build-static-curriculum.mjs` (new, runs as `prebuild`) is specified in section 5.1. It is the only thing that produces what the learner's browser reads, and it strips every secret: exercise `referenceSolution`, lesson `micro-code` `referenceSolution`, and snippet `expectedStdout`. **A test asserts that no generated file under `public/curriculum/` contains the string `referenceSolution` or `expectedStdout`.**

### 11.4 Contracts additions — the exact list

One contracts PR, reviewed by both lanes in the same hour, per the standing rule. Everything below is **additive**; nothing existing is renamed, removed, or re-typed, so every stored row and every one of the 840 existing tests stays valid.

1. `WellnessDockPrefs` interface (section 6.3) and `WellnessPrefs.dock: WellnessDockPrefs`.
2. `ThemeName = 'midnight' | 'amber' | 'paper' | 'arcade'` and `WellnessPrefs.theme: ThemeName`.
3. `WellnessPrefs.sound: { enabled: boolean; volume: number }`.
4. `WellnessPrefs.motion: 'system' | 'full' | 'reduced'`.
5. `WellnessPrefs.dailyGoal: number` (1-10).
6. Corresponding defaults added to `DEFAULT_WELLNESS`: `dock: { placement: 'right', collapsed: false, compactOnExercise: true, corner: 'br' }`, `theme: 'midnight'`, `sound: { enabled: true, volume: 0.6 }`, `motion: 'system'`, `dailyGoal: 3`.
7. `LessonBlock`, `LessonConcept`, `LessonSnippet`, `LessonWorked`, `LessonCheck`, `LessonRecap`, `LessonBridge` (section 3.3).
8. `Lesson` interface and `LessonPublic = ` the lesson with every `micro-code` `referenceSolution` and every snippet `expectedStdout` removed (the type is written explicitly, mirroring how `ExercisePublic` is written).
9. `LessonProgress` interface: `{ userId, lessonId, cloId, status: 'started' | 'completed' | 'skipped', blockIndex, checksPassed, checksFailed, lessonVersion, startedAt, completedAt, updatedAt }`.
10. `AchievementTier`, `Achievement`, `UserAchievement`, and the `ACHIEVEMENTS` constant (section 7.5).
11. `MAX_LEVEL`, `xpToReach(level)`, `levelForXp(xp)` — pure, sitting beside `pointsForPass` and `nextMasteryScore`, pinned by tests exactly as those two are.
12. `DrillLane = 'arcade' | 'play'`; `DrillItem.lane: DrillLane`; `DrillResult.lane: DrillLane`.
13. `DrillKind` gains `'follow-the-dot' | 'color-nback' | 'reaction' | 'rhythm' | 'breathe' | 'memory-grid'`. Landing in the **same commit**: `DRILL_KINDS` and `DRILL_META` (`src/app/(app)/derot/lib.ts:8-16`) and `DRILL_KIND_ORDER` (`src/components/report/derive.ts`), all three of which are exhaustive over `DrillKind` and will not compile otherwise. **(critic)**
14. **(critic)** `Clo.draft?: boolean` — optional, additive. The column exists in `seed/clos.json` and in `public.clos` and drives the drafted-CLO marker the 22:33 ruling requires, but `interface Clo` has never carried it, so §3.5's `Clo.draft === true` was a contract change written as prose. Optional means every existing fixture and every one of the 840 tests stays valid.
15. **(critic)** `WellnessPrefs.goalDays: string[]` (UTC date keys, most recent 120) — the durable source for achievement #15 per R7.7, with `[]` added to `DEFAULT_WELLNESS`.
16. **(critic)** `Achievement.ordinal: number`. `0007_achievements.sql` declares `ordinal int not null` but the `Achievement` interface in §7.5 has no such field, so §11.3's "a test asserts the table matches the constant after a load" would fail on the first run against a column the constant cannot produce. Either the field exists or the column is dropped; the field is better, because display order is a product decision and array index is not a stable id.

**Explicitly not changed, and this is the point:** `AgentTrigger` (still seven), `AgentName` (still seven), `AGENT_TOKEN_BUDGETS`, `INTEGRITY_WEIGHTS`, `INTEGRITY_THRESHOLDS`, `LOCKDOWN`, `pointsForPass`, `nextMasteryScore`, `LearnerState`, `LearnerProfile`, `Exercise`, `ExercisePublic`, `Course`, `TestCase`, `RunRequest`, `RunResult`, `RuntimeAdapter`, `Attempt`, `Mastery`, every agent request and reply interface. **(critic — `Clo` moved off this list; item 14 above adds one optional field to it. Leaving it here while §3.2 and §3.5 read `Clo.draft` was the one place in this document where a contract change was hiding in prose, and the standing rule is that contract changes are a PR both lanes review in the same hour, not a sentence in a screen spec.)** v2 is a large product change that touches none of the frozen surface that makes the product correct.

### 11.5 What is deleted

- The layout's unbounded `attempts` pager (`layout.tsx:35-44`).
- The layout's duplicate `auth.getUser()` — the proxy already proved identity and forwards it in internal headers (`middleware.ts:16-22`).
- The rail's second `wellness` read (`Rail.tsx:130`) and the de-rot page's third (`derot/page.tsx:37`).
- The PrintScreen overlay branch in `LockdownOverlay.tsx` and its two-second timer and clipboard-blanking in `useLockdown.ts:131-141` (the `keyup` listener and the log row stay).
- The permanent "Type your own work" editor label.
- The `dark` class hardcoded on `<html>`.
- `public/java/*` and `public/spikes/*` from the deploy (added to `.gitignore`; the two e2e specs that reference them are marked `test.skip` with a comment pointing at the fetch script).
- Every `useEffect` + `useState` fetch trio replaced by a Query hook, in `dashboard/page.tsx`, `onboarding/page.tsx`, `reports/page.tsx` and `useExerciseLoop.ts`.

### 11.6 Openness work items (R1.12)

- `docs/CONTENT.md` — how to author a course: edit `seed/`, run the two generation workflows, run the verifiers, run `seed:load`, rebuild. Enough for someone else to ship a different syllabus.
- `SETUP.md` — a self-host path: local Supabase, `.env.local` keys, `npm run dev`, no Vercel account required, `AGENT_DRY_RUN=true` to run the whole product with no DeepSeek key at all.
- `public/sounds/CREDITS.md` — the licence ledger (section 7.10).
- `@vercel/speed-insights` mounts only when `NEXT_PUBLIC_VERCEL_ENV` is present; there is no telemetry route handler anywhere (R5.5).
- README gains a two-paragraph "how the learning model works" section, because the distinctive part of this product is the Learner State schema, the seven-trigger rule and the pattern taxonomy, not the model behind it.

---

## 12. Non-goals for v2

Stated so nobody builds them and nobody asks.

1. **Arabic, RTL, or any second UI language.** English only.
2. **Leaderboards, cohort ranking, friends, following, or any social comparison.** Personal bests only. If a social layer is ever built it will be opt-in and small-group; it is not this release.
3. **Hearts, lives, energy, or any consumable a failed attempt spends.** Permanently out of scope, not deferred.
4. **Push notifications and email beyond the auth mail.** The streak is visible in the product; it does not chase the learner.
5. **A second lesson per CLO, branching lesson paths, or video.** One lesson per skill, text and code and inline runnable snippets.
6. **Server-side code execution for anything.** The browser grades. `/api/judge` stays flag-off at 503.
7. **Cache Components (`cacheComponents: true`), Partial Prefetching, and the React Compiler.** Right shape, real migration, deferred behind the v2 budget (R5.6).
8. **Sharing runtime-generated exercises between learners.** Still needs server-side verification.
9. **An eighth agent, an eighth trigger, or any agent call on a keystroke, timer, page load, lesson block, check, drill, celebration, or theme change.** **(critic) The test that exists asserts less than this sentence claims.** `src/hooks/useExerciseLoop.test.tsx:92` ("calls no agents on mount, typing, free run, or timer") covers exactly one hook and knows nothing about lessons, checks, drills, celebrations or theme changes, none of which existed when it was written. So the guarantee is made real rather than assumed: `callAgent` is the single choke point, and a spy on it is asserted to record **zero** calls across a lesson mounted and fully completed (every check kind answered right and wrong), an Arcade run and a Playground run start-to-finish, a theme switch, a dock move, a celebration and a level-up, and a `/courses` render. One test file, `src/lib/agents/no-agent-surfaces.test.tsx`, listed in W3's ledger rows, extended by whoever adds a surface.
10. **Realtime, presence, collaboration, or a mobile app.**
11. **Payments, SSO, org accounts.**
12. **Re-deciding Java.** The CheerpJ adapter is its own lane with its own ruling; nothing in this document depends on it.
13. **A design system package, a Storybook, or a component library extraction.** The preview harness at `src/app/preview` is the iteration surface and it already works offline.
14. **Custom themes, user-authored palettes, or a theme editor.** Four themes, chosen and verified.

---

## 13. The ten-minute acceptance checklist

Run in order, on a fresh browser profile, against the deployed build. Each line is pass or fail with no interpretation required.

**Minute 1 — it looks like something.**
1. Sign in. The app is dark, coloured, and has a visible identity. Header carries a sound toggle and a theme switcher.
2. Open the theme switcher, pick each of the four in turn. Each one changes background, text, primary and accent together, with no white flash and no half-themed component. Reload on Paper: it is still Paper, and there is no flash of Midnight first.

**Minute 2 — onboarding, once.**
3. On a brand-new account: exactly **six** questions, each advancing in the same frame you tap it, with **no loading state between cards**.
4. After question six you land on the course picker with no wait.
5. Pick a course. The course home appears **immediately** with a path map and three cards. No "Building your path" wall.

**Minute 3 — it teaches.**
6. The first card says Walkthrough. Open it. There is a concept, a worked example you can step through, at least one check, a recap, and a handoff to a real rep.
7. Answer a check wrong: you get a hint, not a punishment, and you can try again as many times as you like. Answer it right: it says so instantly, with sound.
8. Run the inline snippet. It executes in the browser and prints output.

**Minute 4 — no re-onboarding.**
9. Go to the course switcher and change to a different course. **You are never asked a profiler question again.** The new course home appears immediately; if anything tunes, it does so in the background.
10. Switch back. Your progress on the first course is exactly where you left it.

**Minute 5-6 — the loop, fast.**
11. Open an exercise from the dashboard. The editor chrome appears immediately as a skeleton, not a sentence, and the runtime shows real progress if it is still warming.
12. Submit a wrong answer. The result appears in well under a second after the code finishes running; the failing test row shakes; the fix plan starts streaming. Nothing is consumed and nothing turns red-and-angry.
13. Submit a correct answer. **Pass, XP, the chain pip and the celebration all appear immediately** — before any "saving" indicator finishes. There is sound and there is confetti anchored to the result panel.
14. Pass a second rep. The chain pip advances to 2 of 3, with its own distinct sound.

**Minute 7 — rewards are real.**
15. The dashboard shows a level with an XP bar, a streak flame lit for today, and a daily-goal ring that moved.
16. Open Progress and then Trophies. At least First Blood is lit, with its date. Every locked trophy states exactly what earns it. Nothing is a mystery box.

**Minute 8 — you own the layout.**
17. In Account, move the wellness dock to the left. It moves. To the top. It moves. To floating. It floats. To hidden. It disappears and a re-open glyph stays in the header. Set it back to the right and collapse it: it becomes an icon rail.
18. Reload. Every one of those choices survived.
19. Turn sound off. Pass or fail something. Silence, and the visible feedback is unchanged.
19b. **(critic)** Turn interface sounds on in Account. Click Run. It clicks. Turn them off. It does not, and the header mute still kills everything.
19c. **(critic)** Set motion to "reduced" in Account, then reload and walk dashboard → course → lesson → exercise → De-rot. Nothing staggers, nothing slides, nothing loops, scroll reveals are simply already there — and every verdict, level, streak and score is still legible and still announced. Then set the OS to reduce motion and set the in-app override to "full": motion comes back, which is the test that the override is real and not just a media query.
19d. **(critic)** Unplug the mouse. Reach every one of these with the keyboard alone: a path-map node, a lesson check of each kind, the theme picker, the dock placement control, the sound toggle, and the Buddy drawer including its close. Nothing traps focus, and every state that is carried by colour is also carried by a glyph or a word.

**Minute 9 — honesty.**
20. In an exercise, press Ctrl+V. The block message is one of several lines, not the same one every time, and there is a "why" you can open.
21. Press PrintScreen. **Nothing covers the screen.** Press it twice more: one short line appears saying screenshots cannot be blocked by any website and the attempt was logged.
22. Open Account, then Integrity explained. It shows your own event counts, the real weights, the real thresholds (10, 20, 40, and 5 pastes in one exercise), and states plainly which mechanism is enforcement, which is a signal, and which is impossible.

**Minute 10 — De-rot is not boring.**
23. Open De-rot. There are two lanes. Arcade runs six items with a countdown ring, a combo meter, and a run summary that compares you to your own last five runs and nobody else's.
24. Playground has games with no code in them. Play Follow the Dot or Breathe for a minute. It is pleasant, it scores, and it counts toward the de-rot streak.
25. Nowhere in those ten minutes did any screen say "Your …" as its opening word, show an emoji, name an institution, or make you wait on a spinner with a grey sentence under it.

**The two numbers to check afterwards**
26. `npm run perf:bundle` and `npm run perf:timings` both exit 0 against `perf-budget.json`.
27. `npx vitest run` is green, and **both** agent-discipline tests are in that run: the existing `useExerciseLoop` one and the new `no-agent-surfaces` one (§12 #9). **(critic)**
28. **(critic)** `npm run build` is exit 0 and `node scripts/build-static-curriculum.mjs` has run as `prebuild`; the test asserting no file under `public/curriculum/` contains `referenceSolution` or `expectedStdout` is green.

---

## 14. Build order and ownership

Sequenced low-risk-first so every step ships something the owner can feel, and so nothing blocks on content.

| Wave | Work | Lane |
|---|---|---|
| **W0** | The contracts PR (section 11.4, now sixteen items) and the four migrations (11.2). **Plus, moved up from W3 (critic): `seed/lessons/lesson.schema.json`, the `LessonBlock` types and the extended `seed/validate.mjs`, and one hand-written golden lesson.** Nothing else starts until this lands. | Both, same hour |
| **W1 — feels fast in a day** | Onboarding six-question local flow and the `/courses` split (R4.1-R4.4); `loading.tsx` on every route; static curriculum build script; `adhan` and CodeMirror split; dashboard idle warmup; delete the layout's attempt pager and duplicate `getUser`. | Astra (routes, shell), Claude (onboarding derive, provisional plan, static build script) |
| **W2 — feels alive** | Themes and tokens; the voice string bank; the wellness dock; the sound manager and sprite; the reward layer, XP, levels, streaks, achievements, celebrations. **Copy replacement at call sites is a separate, later pass (critic).** | Claude: `src/lib/voice/*`, `src/lib/rewards/*`, `src/lib/sound/*`. Astra: `globals.css`, `src/components/shell/*`, `src/components/wellness/*`, celebration components. **Split explicitly because "every copy replacement" touches the thirty-plus component files Astra owns and v1 §16 forbids Claude from editing them — §2.5 already says Claude writes the copy and Astra wires it, and this row now says the same.** |
| **W3 — teaches** | Lesson runtime and the lesson screen; course home and path map; `lesson_progress`; the lesson generation workflow, the verifier, and the first batch of 23 lessons; `no-agent-surfaces.test.tsx`. | Claude: `src/lib/lesson/*`, `docs/workflows/lesson-generation.js`, `scripts/verify-lesson.mjs`, `seed/lessons/**`, the tests. Astra: `src/app/(app)/lesson/**`, `src/app/(app)/course/**`, `src/components/lesson/*`, `src/components/course/*`. **Because W0 now carries the schema and a golden lesson, content generation and the screens run in parallel instead of the screens waiting on content (critic).** |
| **W4 — honest and playful** | Lockdown copy and the PrintScreen retirement; the `integrity_weights` table, the corrected `integrity_score()`, the breakdown RPC and the Account panel; De-rot Arcade rebuild; the six Playground games. | Claude: `src/lib/voice/lines.ts` guard keys, `src/components/derot/scoring.ts` (score normalisation, R7.6a), the breakdown derivations and their tests. Astra: `0008`/`0009` migrations, `src/hooks/useLockdown.ts`, `src/components/exercise/LockdownOverlay.tsx`, `src/app/(app)/derot/**`, the six game components. **Six games is six serial Codex tasks; v1 §16's capacity valve applies here more than anywhere and is restated below (critic).** |
| **W5 — proven** | TanStack Query everywhere; the optimistic submit path; `my_activity_days` and the streak fix (R5.2a); generating `perf-budget.json` from the measured W1 baseline (R5.7); perf CI gates; the acceptance run. | Astra: `(app)/layout.tsx`, `QueryProvider`, `QuerySeed`, and the page-level query hooks in `dashboard`, `onboarding`, `reports`. Claude: `useExerciseLoop.ts`'s `'graded'` status and the optimistic submit path, plus `scripts/check-bundle-budget.mjs`. **`useExerciseLoop.ts` sits on the seam between the two lanes and is named here so it does not get edited twice (critic).** |

Ownership seams from v1 hold: Claude owns agent prompts and modules, learner-state math, bank and chain logic, scoring, generation workflows, the voice bank, reward math, and the tests for all of it. Astra owns schema, migrations, RLS, the app shell, every screen, runtime adapters, the lockdown hook, the dock, themes, and Playwright. The contracts file is frozen again the moment W0 lands.

**(critic) Two scheduling facts the first draft's wave table did not survive contact with.**

**The capacity valve from v1 §16 is still in force and v2 needs it more, not less.** Codex runs one write-capable task at a time in this working tree, so every Astra column above is *serial*. W2 alone hands Astra four themes, a five-placement dock, a header gaining three new controls, and a celebration layer; W4 hands it six games. If Astra is the critical path at the W2 or W4 checkpoint, the Claude lane builds the pure-presentation pieces — the six Playground game components against the `DrillResult` contract, the trophy shelf, the theme swatch grid — with parallel subagents following the Astra operating prompt, and Astra reviews before merge. This is the same valve, invoked the same way, and the default is to use it.

**Three files are contended and get named owners rather than a lane.** `src/components/shell/AppShell.tsx` receives the dock placement (W2), the sound toggle (W2) and the theme quick-switch (W2) — three tasks, one file, one serial writer. Compose the header from three small owned components (`DockControl`, `SoundToggle`, `ThemeQuickSwitch`) so the shell file changes once. `src/hooks/useExerciseLoop.ts` is edited in W1 (attempts cap), W2 (celebration hooks) and W5 (optimistic submit): those land in that order, in that hook, by one lane. `src/components/derot/scoring.ts` is Claude's under v1 §16's "scoring" even though it sits in a component directory; W4 says so explicitly.

**Standing rules that do not change.** Never `git reset`, `git checkout --`, `git stash` or `git clean` in the shared tree. Every ruling in this document goes into `docs/build-log.md` with its reason as it is implemented. Every task gets both an Opus review and a Codex cross-review; the build log's own lesson at 22:47 is that cross-review catches what a single reviewer misses, and it is cheap.

---

## 15. Change log (critic)

Adversarial read of this spec against v1 (`docs/superpowers/specs/2026-09-05-brogram-design.md`), the frozen contracts (`src/lib/contracts.ts`), the shipped code, `docs/build-log.md`, and the five research files under `docs/research/v2/`. Date: 2026-09-06. Every entry below is edited in place above and marked **(critic)** at the point of change.

### Fixed in place

**Contract changes that were hiding in prose**

1. **`Clo.draft` was read by §3.2 and §3.5 while §11.4 listed `Clo` as untouched.** `interface Clo` in `src/lib/contracts.ts` has no `draft` field; the column exists only in `seed/clos.json` and `public.clos`. Added as §11.4 item 14 (`Clo.draft?: boolean`, optional, additive) and removed `Clo` from the "explicitly not changed" list. §3.5, §11.4.
2. **Achievement #15 `kept-the-promise` needed durable storage that §11.1 refused to grant.** "Derived daily wins" has no source: the 50-row attempts window cannot see seven past goal-days once walkthroughs and de-rot runs also count as wins, and §11.1 rules out both a reward-events table and an XP ledger. Ruled R7.7: `wellness.prefs.goalDays: string[]`, `jsonb`, no migration, capped at 120. §7.4, §7.5, §11.4 item 15.
3. **`Achievement.ordinal` is a `not null` column in `0007_achievements.sql` with no field on the interface**, which would have failed §11.3's "the table matches the constant" test on its first run. §11.4 item 16, §11.2.
4. **`DrillKind`'s six new ids break three exhaustive `Record`s** (`DRILL_KINDS`, `DRILL_META`, `DRILL_KIND_ORDER`) — named so they land in the same commit rather than as a surprise build failure in another lane's wave. §11.4 item 13.

**Contradictions with fixed constraints and with the spec's own rulings**

5. **`0008_integrity_breakdown.sql` will not apply as printed.** It joins `public.integrity_weights`, which does not exist — `0003_integrity.sql` inlines the weights as a `case` inside `integrity_score()`. The prose fallback ("inline the same weights") would have put the numbers in two places, which is what R11.2 forbids. Rewrote `0008` to create and seed the table and redefine `integrity_score()` to read it, with identical numbers, so R11.2 becomes true instead of being weakened. §11.2.
6. **The banned screen's itemised receipt cannot render.** `src/lib/supabase/middleware.ts:63` signs a banned user out to `/login?reason=banned`, so there is no `auth.uid()` for `my_integrity_breakdown()` to read. Banned copy now states policy, weights, thresholds and the appeal contact; the receipt moves to the warned and restricted screens and to Account, where the learner still has a session and can still act on it. §9.4.
7. **R9.6 ("no animation on enforcement surfaces") was contradicted by §7.6's paste "toast micro-shake"** and by two moralising `guard.paste` variants that rule 8 ("enforcement tone is flat") forbids. Shake removed; lines 47 and 49 rewritten flat. §2.7, §7.6, §9.6.
8. **§1.12's "every asset in `public/` is CC0, ISC or MIT" is already false** — the 22:33 CheerpJ ruling self-hosts `tools.jar` under GPLv2+CE. Narrowed the claim to assets BroGram authors or curates; the credits ledger, not the licence list, is what makes a fork safe. §1.12.
9. **§5.5 deletes `public/java/*` from the deploy while the CheerpJ ruling requires a same-origin `tools.jar`.** Reworked: gitignored (an 18 MB binary does not belong in the repo) but fetched at `prebuild` behind a flag, and `public/` ≤ 3 MB is scoped to the period while `java` is `coming-soon`. §5.5, §5.6.
10. **Voice rule 1 (thirty-word panel bodies) is violated by line 56, the Integrity panel paragraph, at 55 words.** Added one named exemption at sixty words rather than shortening the one paragraph in the product whose job is to be complete. §2.3.
11. **Voice rule 6 (three-plus variants for anything a learner triggers more than three times a session) is violated by six of its own keys.** Added variants for `hint`, `chain.tick`, `guard.blur`, `guard.idle`, `error.save`, `loading.runtime`, and made the rule testable by giving every key a frequency class. §2.3, §2.7.

**Performance claims without a measurement**

12. **The JS payload budgets do not close arithmetically.** `/dashboard` is 887 KB with `adhan` at 457 KB; removing `adhan` lands at ~430 KB, already over the 380 KB target *before* v2 adds TanStack Query, Motion, GSAP, `next-themes` and the sound manager to the shell. Marked the table provisional and ruled R5.7: `perf-budget.json` is generated from a measured W1 baseline, no route's budget may exceed its v1 number, and every overage gets a named ledger row (the ~467 KB Supabase pair being the likely first). §5.6.
13. **"~500 KB off `/exercise`" and "20 KB deferred" are unsourced.** The audit measured the whole CodeMirror chunk at 658 KB and never attributed bytes per grammar; Howler plus a sprite is ~30 KB of JS plus ≤120 KB of audio, not 20 KB. Both marked estimated; the `canvas-confetti` row marked gzip so it is not compared against uncompressed neighbours. §5.5.
14. **"The first exercise of a session has a warm runtime" contradicts §5.6's own measurement profile.** 10 MB on the Lighthouse mobile-throttled profile takes tens of seconds. Claim scoped to broadband, real-progress warming kept, and "first Run is not user-visible" dropped from the CI-gated table. §5.4.
15. **Two budgets cannot be measured by the harness that claims to gate them.** `perf:timings` runs with `AGENT_DRY_RUN=true`, so "hint click to first token < 1.5 s" measures a local fallback. Both moved to field-only observation. §5.7.
16. **Deleting the attempts pager while capping attempts at 50 breaks streaks.** Fifty rows is about sixteen days at three reps a day, so a 30-day streak is unverifiable, the `thirty` achievement is unreachable, and the known open bug from the build log at 23:29 returns. Ruled R5.2a: one bounded `my_activity_days()` RPC returning distinct UTC activity dates. §5.2.
17. **`/exercise/[id]` is not always one round trip.** Runtime-generated exercises are per-author and can never be in a shared static file, so the page falls through to `exercises_public` for those. Ruled R5.1b and corrected the round-trip table. §5.1, §5.6.
18. **The static curriculum silently drops the RLS gate on the whole seed bank.** Stated on the record as R5.1a — acceptable only because `seed/exercises/*.json` is already in a public MIT repo, and explicitly not a precedent for moving anything user-owned into `public/`. §5.1.

**Correctness**

19. **`gradeAnswer` is the wrong function for lesson checks.** It takes an `ExercisePublic` (which a `LessonCheck` is not) and its `predict-output` path collapses newlines — the exact bug the 23:07 ruling fixed *in a different module*. The per-line implementation is `normalizeOutput`/`gradePredictOutput` in `src/components/derot/scoring.ts`. Rewrote R3.6 with a per-kind grader table and logged the live v1 inconsistency as a follow-on row. §3.6.
20. **The lesson had two fighting version mechanisms** — `id: "<cloId>-L<version>"` *and* a `version` column — with `lesson_progress.lesson_id` a cascading foreign key. A version bump would have minted a new id, orphaned every progress row, re-marked finished walkthroughs unseen and un-earned `read-the-manual` and `full-read`. Id is now the `cloId`; `version` alone carries staleness. §3.2.
21. **The path map locks every node in a course entered first.** `Clo.prerequisites` crosses courses in the shipped seed (`INFS1201-1` to `INFS1101-4`), so "some prerequisite is not closed" locks INFS1201 forever for a learner who starts there. Out-of-course prerequisites are advisory and never gate; the same rule applied to `provisionalPlan()`'s topological sort. §3.5, §4.3.
22. **`lesson_progress.status` has no `'unseen'` value** — the check constraint and the contract both say `started | completed | skipped`. Unseen is the absence of a row. §3.5, §3.8.
23. **"The current CLO" is not a field on `LearnerState`.** Defined as a derivation (first non-closed CLO in `path`) rather than letting an implementer add a pointer. §3.8.
24. **The XP reconciliation arithmetic is wrong.** `pointsForPass` adds `round(quality/100 * 50)`, so from the neutral 70 the Reviewer moves the number **+15 at best and −35 at worst**, not "±25". Because the worst case is a visible drop, the optimistic figure is now labelled provisional until the Reviewer lands. §5.3, §7.2.
25. **Level 3 says "4 passes"; four medium passes are 1,340 XP against a 1,400 threshold.** §7.3.
26. **Playground scores (up to 10,000) and Arcade scores (0-100) land in the same `drill_results` array and the same report table**, where `deriveDrillScores` takes a flat max and mean per kind. Ruled R7.6a: `DrillResult.score` is 0-100 for every kind in both lanes; raw values live in the run summary. §7.9.
27. **`wellness.drill_results` is an unbounded `jsonb` array written read-modify-write**, and Playground makes it grow several times faster. Ruled R7.6b: capped at 300, appended by a `security definer` function so two tabs cannot race away a run. §7.9.
28. **`gsap.matchMedia()` cannot gate the in-app motion override**, because an override is React state and `matchMedia` evaluates media queries; `matchMediaRefresh()` does not know about `wellness.prefs.motion`. The resolved boolean from `useReducedMotion()` is the single input. §7.8.
29. **The agent-discipline guarantee is asserted by a test that predates every surface it claims to cover.** `useExerciseLoop.test.tsx:92` knows nothing about lessons, checks, drills, celebrations or theme changes. Specified `src/lib/agents/no-agent-surfaces.test.tsx` with the concrete list. §12, §13.

**Reward loops that would annoy**

30. **Nineteen sound ids, four of them on every click, against research that says six to eight and "scale sound to frequency".** Ruled R7.8: two tiers, two toggles — reward sounds default on, interface sounds (`ui.tap`, `run.go`, `submit.send`, `xp.settle`, `drill.hit`, `drill.miss`, `wellness.chime`) default off — plus repetition attenuation of 6 dB after four plays of one id in sixty seconds. This is the difference between a product someone mutes once and never unmutes, and one they leave on. §7.7.
31. **Confetti on every pass, twenty times a session, is what makes the first burst worthless.** Confetti now fires on the session's first pass, on a chain tick reaching 3, and on milestones; a routine pass keeps the checkmark, the counter and the sound. §7.6.
32. **Three simultaneous trophy unlocks is 7.5 s of cards in front of someone who wanted the next rep.** A queue longer than two collapses into one "3 new trophies" card. §7.6.

**Accessibility**

33. **The path map — the centrepiece of the new course home — had no keyboard or screen-reader story at all.** Specified as a progressive enhancement over an ordered list of links, with prerequisites exposed through `aria-describedby`, decorative SVG edges, and state carried by shape as well as colour. §10.4.
34. **Lesson check verdicts were colour-only** (`--success` green, amber) and `spot-the-bug` was click-only. Every verdict now pairs colour with a glyph and a word, announced through `aria-live="polite"`; every code line is a focusable control with arrow-key navigation. §10.5.
35. **Reduced motion was specified for celebrations only**, leaving staggers, scroll reveals, route slides, edge draws and idle loops across every screen in §10 ungoverned. Ruled R7.9 as a blanket rule and a per-screen review item. §7.7.
36. **Four of the six Playground games are unplayable for someone as specified**: `follow-the-dot` is irreducibly motion (now offers a named substitute rather than being silently downgraded or hidden), `color-nback` was colour-only (now shape *and* colour), `rhythm` was audio-only (now a visible beat as well), `breathe` required a sustained hold (now one tap per phase, hold optional). §7.9.
37. **A learner whose OS asks for high contrast or light gets a low-contrast dark theme on their first screen, before they know a picker exists.** The empty-storage seed of two media queries in the pre-hydration script is two lines and ships in v2 rather than being deferred; it never overrides an explicit choice and `enableSystem` stays `false`. §8.2.
38. **Added acceptance items 19b-19d and 28** — interface-sound toggle, a reduced-motion walkthrough including the override-beats-OS case, a keyboard-only pass over every new control, and the static-curriculum secret-stripping test.

**Scope that could not be built by subagents in disjoint paths**

39. **W2's "every copy replacement" put Claude inside thirty-plus files Astra owns**, contradicting v1 §16 and this document's own §2.5. Split: Claude authors the bank, Astra wires the call sites in a later pass. Per-lane file paths added to W2-W5. §14.
40. **`AppShell.tsx` receives three separate W2 tasks** (dock placement, sound toggle, theme quick-switch) with one serial writer. Composed into three owned components so the shell file changes once. §14.
41. **`useExerciseLoop.ts` is edited in W1, W2 and W5 with no owner named**, and it sits on the lane seam. Named. §14.
42. **The v1 capacity valve is not mentioned anywhere in §14**, despite W2 and W4 handing Astra four themes, a five-placement dock, a rebuilt header, a celebration layer and six games — all serial, because Codex runs one write-capable task at a time. Restated and made the default. §14.
43. **W3 had the lesson schema and the lesson screens in the same wave**, so screens waited on content. Schema, types, validator and one golden lesson moved to W0; W3's two halves now run in parallel. §14.

### Not fixed — needs the owner or a lane decision

1. **The 13-inch laptop constraint from v1 §13** ("every screen usable at 100% zoom with the wellness rail open") is never restated in v2, and the new `/course/[code]` puts a path map, a three-card stack and a collapsible list on one screen. Someone has to actually check the map at 1280x800 with the dock expanded; it is a design call, not a spec edit.
2. **The four palettes are unverified.** R8.3 requires WCAG 2.2 plus APCA on every pair and says "no theme ships on this document's numbers alone" — correct, and still outstanding. Arcade in particular pairs `--success` at `L 0.82` and `--warning` at `L 0.85` on an `L 0.12` ground, close enough in lightness that a green/amber verdict may not separate by luminance for everyone. That is why item 34 above adds glyphs, but the palette check is still owed.
3. **Level 25 (`machine`) needs roughly 176 passes and level 30 needs 233, against a launch bank of about 100 seed exercises.** Reachable only through runtime-generated variants. Whether the gold tier should be reachable inside the pilot week is a product call; the acceptance checklist does not depend on it.
4. **`docs/prompts/agents/08-lesson-author.md` does not exist yet**, and §2.8's "identity paragraph rewrite in each agent's `system` string" has to keep `prompts.test.ts`'s byte-pinning green. Both are real work items with no ledger row in §14.
5. **The owner's word "dock" was renamed to "float".** He listed "left, right, top, dock, hidden"; the research reads `dock` as a floating corner tab, which is what `float` is, so the substance is right — but the product now calls the whole component the dock *and* has a placement called something else, and there is no bottom placement even though `top` already has a horizontal renderer. A naming call for the owner.
6. **`AGENT_DRY_RUN` is the self-host story** (§11.6: "run the whole product with no DeepSeek key at all"), but nothing in this document says what a walkthrough, a fix plan or a hint looks like in that mode, and it is now the mode the perf suite runs in. Worth one paragraph.
