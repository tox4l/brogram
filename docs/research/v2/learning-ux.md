# Learning UX research: how the best products teach and motivate, and what a bro borrows

Date: 2026-09-06. Written for the v2 design pass after the product owner's post-use verdict (see `docs/build-log.md`, 22:17 and 22:20 entries, and `docs/research/v2/owner-addendum.md`). Scope: external research only, with every claim traced to a source in the **Sources** section. Where a finding is compared against BroGram's actual code, the file and line are named so the recommendation is checkable, not just plausible. No institution names appear because none are relevant to this material; all copy examples are in English.

---

## 0. Summary: the six moves that matter most

1. **Teach before you test.** Every product studied puts a concept and a worked example in front of the learner before the first graded rep — including Brilliant, which still lets the learner *try* first, but on an ungraded pretest, not a hidden-test wall. BroGram has no concept layer at all today: `Clo.outcome` is one sentence (`src/lib/contracts.ts:56`) and `Exercise.prompt` states the task, never the idea behind it. This is the single biggest gap and the owner's loudest complaint ("a course starts at 'Next exercises', a beginner cannot learn").
2. **Reward the transition, not the typing.** Duolingo, Brilliant, and game-feel research all fire celebration at state changes (lesson complete, streak tick, pass), never as ambient decoration during focused work. This reconciles the old v1 rule ("no decorative animation on the exercise screen," `docs/superpowers/specs/2026-09-05-brogram-design.md` §13) with the owner's new demand for an animated, rewarding UI: juice belongs at Submit/Pass/Chain/Close, not while the student is thinking.
3. **Never punish a mistake with scarcity.** Duolingo's own heart system — lose a life per wrong answer — is the most-criticized mechanic in the entire research set and is being phased out for an "Energy" system because it teaches fear of trying, the opposite of what BroGram needs from a nervous beginner. BroGram already does this right by construction (failed attempts loop into diagnosis and retry, nothing is consumed) — the recommendation is: keep it that way, and say so in the UI.
4. **Separate the learner's profile from the course's syllabus.** Duolingo, Exercism, and Codecademy all keep identity/preferences at the account level and content progress at the per-course level; switching a course/track never re-asks who you are, at most it offers a short, skippable placement check scoped to the new content. BroGram's own contract already models this correctly (`AgentTrigger` has one `plan-refresh` trigger for "onboarding done, CLO closed, course switched" — the Planner, not the Profiler, `src/lib/contracts.ts:300-307`). The re-onboarding the owner hit is a UI routing bug, not a design flaw: `src/app/(app)/onboarding/page.tsx:47` initializes `stage` to `'question'` unconditionally, and both `Change course` and `Review your course` on the dashboard link straight to `/onboarding` (`src/app/(app)/dashboard/page.tsx:118,155`) with no check of `learnerState.profile.onboardingComplete`.
5. **Cadence and restraint are the whole game with reward systems.** Duolingo's push system caps at two notifications a day and rotates which motivation it pulls (streak, league, social) specifically so no single lever gets numbed; 2025-2026 write-ups on gamification are dominated by post-mortems of streak anxiety, badge-for-badge's-sake, and leaderboards that demotivate strugglers. BroGram's reward layer should borrow the mechanics but build in the same restraint from day one, not retrofit it after users complain.
6. **A path map is a literal map, and BroGram already has the data for one.** Every product visualizes progress as nodes and connections, not lists. BroGram's `LearnerState.path: CloId[]` and `mastery: Record<CloId, Mastery>` (`src/lib/contracts.ts:266,269`) already contain everything a map needs — this is a rendering project, not a data project, and needs no contracts change.

---

## 1. Scope and method

Researched via live web search and page fetches on 2026-09-06: Duolingo (streaks, XP, leagues, hearts, celebrations, the Duo character, sound design, notification design), Brilliant (interactive lesson structure), Boot.dev (gamified backend learning, XP/levels/boss battles, the Boots character), Exercism (mentoring, learning mode, syllabus trees), Codecademy and Khan Academy (walkthrough structure, checkpoints, hints, mastery), Swift Playgrounds (guided lessons), plus 2025-2026 write-ups on gamified onboarding, retention, dark patterns, habit loops, and one 2025 primary research post from JetBrains on AI-generated programming hints. Every source is numbered and listed at the end; inline citations use the same numbers.

Findings below are cross-checked against BroGram's actual spec (`docs/superpowers/specs/2026-09-05-brogram-design.md`), contracts (`src/lib/contracts.ts`), and current implementation, read directly for this research, not assumed.

---

## 2. Product-by-product findings

### 2.1 Duolingo — the habit engine, and a punishment mechanic it is now abandoning

**Streaks** run on loss aversion, not gain-seeking: the cost of quitting (losing a long streak) is engineered to outweigh the effort of one short session, and a streak wager measurably lifts day-14 retention [1][2]. **XP and levels** give a tangible sense of progress before the learner feels fluent [1]. **Leagues** (weekly bronze-to-diamond brackets against matched peers) add social status and competition [1]. **Badges** are shared and drive referrals by satisfying self-worth, not just showing off [1]. **Hearts** — five lives, lose one per wrong answer, refill over hours or with paid currency — combine punishment with slot-machine-style variable reward, but this is also the most criticized mechanic in the whole research set: it "discourages experimentation and punishes the very thing language learning requires: making mistakes," and Duolingo is actively replacing it with an "Energy" system framed around healthier habits rather than scarcity [9][10][11]. **Celebrations** are physical: a perfect lesson makes the mascot's head visibly swell and burst into a stylized cloud with sparks, then stat cards slide in with sound [6]. **Sound** is short, snappy, upbeat, and deliberately repetitive so it becomes recognizable rather than novel each time [7]. **Notifications** are capped at two per day, fire only on a behavioral trigger (never a fixed broadcast schedule), and are split into gentle "routine" nudges timed to the user's own historical practice window versus "save" alerts reserved for genuine imminent loss (streak expiring in minutes, a league spot about to be overtaken); the system deliberately rotates which motivation it pulls — continuity, competition, completion, social — specifically because hitting the same emotional nerve every time is what causes fatigue, not raw volume [8]. **The Duo character** carries four documented voice qualities — Expressive, Playful, Embracing, Worldly — and is written as a persistent, emotionally invested cheerleader who "isn't shy about checking in or laying on guilt trips… like a parent, you never want to disappoint" [12]. **Course switching**: starting a new language course offers a placement test that can skip ahead based on existing knowledge, or a full restart — it never re-asks the identity/motivation questions from original sign-up, and this placement step can be skipped entirely (skipping just means starting at zero content-knowledge, not answering more questions) [13].

*Applies to BroGram:* the reward event table (§4), the "no scarcity" rule for failed attempts, notification/toast cadence discipline, and the persona voice section (§8) — with an explicit note to drop the guilt-tripping trait, which conflicts with "respectful."

### 2.2 Brilliant — pretest, one concept per screen, feedback that teaches instead of just grading

Brilliant does not lecture first: it "pretests on the material, letting the learner try to find a solution before learning the procedure" [14], then each lesson centers on exactly one concept mixing direct instruction with active problem-solving, using visual, explorable representations rather than walls of text [14]. Wrong answers get **custom, instant feedback**, often with an interactive explanation the learner can manipulate rather than a static correct-answer reveal [14]. Progress visuals — a streak counter whose animation ties directly to the incrementing number, and color-coded topic pathways with connecting lines — are built specifically to be "satisfying indicators and celebrations of progress," with the studio's own framing that "playful and colorful moments brimming with surprise and delight" are core to retention, not decoration bolted on afterward [15].

*Applies to BroGver:* the walkthrough content model (§3) — specifically, "try before being taught the procedure" where the exercise kind allows it (e.g., predict-output before a code exercise on the same pattern) — and the path map's use of color and connective lines (§6).

### 2.3 Boot.dev — RPG framing, effort-based XP, and a tutor built to refuse

Boot.dev wraps backend fundamentals in full RPG language: XP, levels, quests, guilds, and periodic "boss battles" scheduled every 4-8 weeks [18][20]. Critically, after early versions let boss fights ride a shared community health pool, the design was changed so **XP counts toward the player's own reward thresholds** — loot and achievements come from personal effort, not from riding a stronger cohort's wave, and boss-battle achievements are now based on total bosses helped rather than leaderboard rank [20]. The **Boots** character is a wizard-bear AI tutor with a fixed rule: it uses the Socratic method and is "instructed to... ask you questions to help you learn rather than give you the answer," refers to programming in fantasy terms ("casting spells"), and is described as "intentionally penalized through game mechanics to discourage over-reliance" on it [18][19]. The platform's own stated philosophy is explicit about pacing and honesty: realistic multi-month timelines beat false promises, growth happens by embracing discomfort (the zone of proximal development), and AI should not become a crutch for someone still learning fundamentals [18].

*Applies to BroGram:* directly validates the existing Coach design (`AgentModule` for `coach`, `src/lib/agents/coach.ts` — one line of code maximum, never a full answer) — this is not a new idea to add, it is confirmation that a hint agent which refuses to just answer is the right call, and its refusal can be voiced in-persona rather than as a bare constraint. Also grounds "your own effort, not the leaderboard" as the right default for a v1 with a small, hand-picked cohort where public leaderboards would mean everyone recognizes everyone.

### 2.4 Exercism — concepts unlock exercises, not the other way around

A track's content is a **syllabus**: a tree of concepts, where each Concept Exercise teaches exactly one concept and is designed to take about five minutes for someone already fluent [21][23]. Exercises **unlock** based on which concepts have been completed, and an exercise can require more than one prerequisite concept before it becomes available — content is gated by demonstrated understanding, not simply by position in a list [22]. Concept Exercises are auto-checked (an analyzer/representer gives feedback) rather than human-mentored; **human mentoring** is a separate, optional layer available on any exercise in either mode, run by real people giving asynchronous feedback on submitted solutions, not automated grading [21][24]. Learners can leave "Learning Mode" for "Practice Mode" at any time to skip straight to unlocked practice exercises, at the cost of not being walked through the syllabus [21].

*Applies to BroGram:* the strongest external precedent for a **concept-before-exercise** content unit keyed to a single learning outcome (§3), and for gating the *next pattern in a chain* on demonstrated understanding rather than just serving whatever the bank has (which the chain rule in `docs/superpowers/specs/2026-09-05-brogram-design.md` §7.2 already does at the CLO level — Exercism validates extending that same idea down to the walkthrough step level).

### 2.5 Codecademy — narrative, checkpoint, quiz, and "Get Unstuck" as the last resort, not the first option

The atomic unit is one exercise: a **narrative** (explains the idea), a **checkpoint** (a small task in a real code editor testing that specific idea, run against automated checks), then eventually a **quiz** testing retention with multiple-choice and fill-in-the-blank across a whole lesson [26]. When a learner is stuck, the product offers a layered ladder rather than jumping straight to the answer: a hint section the learner must actively expand, then a "Get Unstuck" flow that can ultimately reveal a full solution as a deliberate last resort, plus walkthrough videos for project-scale work [27][28]. Switching between learning paths **preserves prior progress and earned skills**; a learner does not restart because they moved to a different track, only the exam/certification scoring for the new structure may look different [29].

*Applies to BroGram:* the checkpoint-then-quiz shape reinforces "prove the concept immediately, in the editor, before moving on" (§3); the hint ladder (expand a hint → get more concrete help → full reveal only as an explicit opt-in) is a good shape for the existing Coach's five-hint cap, ordered from vaguer to more concrete rather than flat; the path-switching behavior reinforces §7.

### 2.6 Khan Academy — mastery over pace, and a support ladder that scales down human effort

Khan Academy's mastery model lets a learner keep working a skill until they actually master it rather than moving on because a calendar date arrived [30][31], with a self-paced mode explicitly designed around "unlocking" mastery learning rather than forcing lockstep progress [32]. Its support ladder for programming challenges is scaffolding by design: the starter code already contains structure, and getting stuck escalates through hints and short on-demand videos before it ever reaches a teacher, freeing a real person's attention for the students a hint genuinely can't unblock [33][34].

*Applies to BroGram:* validates that difficulty and pacing should track demonstrated mastery (the CLO chain-of-three-distinct-patterns rule already does this), and validates a hint-before-Coach or hint-before-Diagnoser layer that catches the easy cases without spending an agent call — worth flagging for the pilot-week backlog even though it is out of scope for this research pass to design.

### 2.7 Swift Playgrounds — guided walkthroughs live inside the real tool

Swift Playgrounds' flagship path, "Get Started with Code," teaches by having the learner write real code to move a character through a 3D world, with guided walkthroughs that "show you interesting and relevant areas of code" directly in place, and a split-screen where code sits on one side and its live result renders instantly on the other [35][36][37]. Lessons build deliberately: basics first, then progressively more advanced concepts layered onto what was already built, never introduced cold.

*Applies to BroGram:* the strongest precedent for **in-place** guidance — the walkthrough should live inside the same editor/prompt panel the exercise will use next, not a separate slideshow the learner clicks through and then abandons for a different-feeling screen.

### 2.8 2025-2026 gamification and retention: what the field has learned to stop doing

Recent write-ups converge on the same failure modes: streak systems that shift from motivating to anxiety-inducing once loss aversion crosses into dread ("setting alarms, doing sessions while sick... just to keep the counter alive") [38]; badge collections chasing completion for its own sake (the Zeigarnik "incomplete collection nags the mind" effect) rather than demonstrated skill [38][40]; **global leaderboards that measurably lower motivation for lower-performing users while raising it for high performers** — i.e., a leaderboard widens the gap it should be closing [38]; and the overjustification effect, where paying learners in points for something they already found rewarding can leave them less interested once the points stop [38][43]. The prescribed fix across sources is Self-Determination Theory: gamification should support **autonomy** (the user controls it, can see how it works, can opt out), **competence** (rewards track real growth, not time-on-page), and **relatedness** (connection that feels earned, not manufactured urgency or social shaming) [38][39]. On the onboarding side specifically, 2025-2026 SaaS research finds progressive, checklist-shaped onboarding cutting time-to-first-value by roughly 40% and lifting completion by comparable margins, versus long upfront walkthroughs that create the friction that kills activation — the recommended shape is three phases (orient, activate, reinforce) reaching a first genuine win in under five minutes [44][45][46]. Separately, habit-loop research puts the number of repetitions needed to make a behavior automatic at roughly 60-70, and finds that variable (unpredictable-magnitude) rewards build stronger habitual pull than fixed ones — the same principle behind why Duolingo's own numbers show a concentrated, consistent daily-use window forming at scale [41][42][43].

*Applies to BroGram:* the entire "avoid annoying the user" section (§5) and the trim to onboarding question count (§9.1, §9.5).

---

## 3. The walkthrough structure that works for absolute beginners

Stripped of branding, every product in this research converges on the same four-step shape, and the pedagogical research behind it has a name — the worked-example effect paired with the "I do / we do / you do" gradual-release model, which is exactly what shows up in practice at Brilliant, Khan Academy, Codecademy, and Swift Playgrounds alike [14][30][26][35][49]:

1. **Concept.** A short, concrete explanation of the *one* idea this outcome is about — not the whole topic, not prose that could apply to five different lessons. Visual or example-first where the idea allows it (Brilliant, Swift Playgrounds); text-first where it doesn't.
2. **Worked example.** The idea is shown solved once, fully, with the reasoning visible — this is the "I do" step, and research on scaffolded self-explanation prompts (cited alongside the I-do/we-do/you-do framework) is specific that skipping straight from concept to blank editor is where beginners fall off [49].
3. **Guided step(s) with immediate feedback.** One or two small, low-stakes checks against the exact concept just shown — Codecademy's checkpoint, Exercism's five-minute Concept Exercise, Khan Academy's scaffolded starter code — each graded the instant the learner submits, in place, not after a page change [21][26][33].
4. **Free exercise.** Only now does the learner get the real, harder, hidden-test exercise — this is the "you do," and it is exactly BroGram's existing `code` exercise kind.

**A 2025 primary-research finding worth carrying into the Coach and Diagnoser specifically:** JetBrains' Education Research team, studying AI-generated hints for programming learners inside an IDE, found that the single biggest failure mode was "bottom-out" hints that hand over the answer; the fix that worked was showing structure without content (e.g., "you'll want a loop here" with the loop skeleton visible but its body withheld), validating the hint automatically before showing it (their team ran static analysis to strip hallucinated or bad code first), and — specifically for beginners — preferring one clear next-step suggestion over a conversational chat interface, which advanced learners preferred instead [47]. This maps almost exactly onto BroGram's existing Coach contract (`codeLine` capped at one line, under 80 characters, `src/lib/contracts.ts` DiagnoserReply/Coach fields) — the research says that constraint is correct, and that hints should escalate in concreteness across the five-hint cap rather than stay flat.

### Recommended content unit (see §9.1 for the exact shape)

The unit is **per learning outcome (CLO)**, not per exercise, because a CLO can have several patterns and exercises but the concept underneath it is one idea. This also means it is authored once per CLO (26 CLOs at launch, per `docs/superpowers/specs/2026-09-05-brogram-design.md` §1) rather than once per exercise (95-350 of them), which is the only version of this that is actually authorable before the next milestone.

---

## 4. Reward loops: what fires, how often, what it sounds like

The research is consistent that reward strength comes from **variety of trigger + tight timing + short, recognizable sound**, not from stacking more effects on one moment [1][7][8][43][50]. Game-feel research breaks the mechanics of a satisfying moment into concrete, implementable pieces: ease-out motion (fast start, gentle settle) reads as natural where linear motion reads as robotic; a 2-4 frame pause at the moment of impact reads as *weight* before the payoff animation continues; sound should scale with frequency — the more common an action, the simpler its sound should be, saving complex layered audio for rare, big moments [50].

**The reconciling principle for BroGram specifically:** the v1 UI rule that the exercise screen should have "no decorative animation... the editor is the hero" (`docs/superpowers/specs/2026-09-05-brogram-design.md` §13) is not actually in conflict with the owner's demand for a fun, animated, rewarding product — every product researched draws the same line BroGram drew, just for a different reason than "keep it plain": **juice fires at transitions, never during composition.** Nothing animates or plays sound while the student is typing or thinking. Everything can animate and play sound the instant they submit, pass, chain, close a CLO, or hit a streak. That is not a compromise of the fun the owner wants; it is *where* the fun research says to put it.

| Event | Fires on (already-existing state — no new agent call) | Visual | Sound | Frequency guard |
|---|---|---|---|---|
| First-ever pass | First `Attempt` with `passed: true` for this user, ever | Full-screen warm celebration, once only | Distinct "first win" stinger, longer and richer than any other — this is the single highest-emotion moment in every product studied and should not be reused | Once per account, permanently |
| Exercise pass | `Attempt.passed === true` | Short pass animation on the Submit button / result panel | Short, punchy tone (under ~500ms) | Every pass — this is the base loop and must never be skipped or the whole reward system reads as broken |
| Exercise fail | `Attempt.passed === false` | Neutral, not punitive — no red flash, no "wrong" tone; a calm "let's look" transition into the Diagnoser panel | None, or a soft neutral cue at most | Every fail |
| Chain step (pattern passed, `chain` not yet closing) | `Mastery.chain` increases | Small progress-tick animation, e.g. a pip filling on a 3-pip chain indicator | Short ascending tick, distinct from the pass sound | Every chain increment |
| CLO closed | `Mastery.closed` flips true | The map node for that CLO visibly locks-open / lights up (see §6) | The biggest sound short of first-ever-pass | Every close |
| Course path cleared | Every CLO in `path` closed | Map-wide celebration | Rare, so it can be as big as first-ever-pass | Once per course |
| Streak continues (exercise or de-rot) | `streak.exerciseDays` / `streak.derotDays` increments on a new calendar day | Small counter tick, warm not urgent | Very short chime | Once per day, first qualifying action only |
| Streak milestone (7/30/100-style) | Streak count crosses a round number | Bigger, shareable-feeling moment | Distinct milestone sound, reused only at milestones so it stays meaningful [5] | Only at milestones |
| Personal-best drill score | `DrillResult.score` beats the user's own prior best for that drill | Small "new best" badge on the drill result | Short bright tone | Every genuine personal best — never fabricated, never compared to anyone else's score (Boot.dev's own-effort-only lesson, §2.3; leaderboard-demotivation finding, §2.8) |
| Hint used | Coach call returns | Quiet, supportive, *not* a reward sound — a hint is help, not an achievement, and treating it as one would undercut the "figure it out yourself" framing every source protects (Boot.dev's Socratic refusal, JetBrains' bottom-out warning) | Soft, low-key cue distinct from every reward sound | Every hint, deliberately unexciting |
| Wellness log (water/stretch/pomodoro) | Existing wellness log write | Tiny, cheerful micro-animation in the rail only | Very soft, rail-scoped, never interrupts an active attempt | Every log |
| Integrity notice (warned/restricted) | `accountStatus` changes | Calm, serious, explicitly *not* animated as a punishment moment — flat, factual presentation | None | Every status change |

**On sound as a system, not a sound-per-event:** build one small, distinct set (roughly 6-8 sounds total: pass, chain-tick, close, first-win, streak, personal-best, hint, notice) rather than a unique sound per event *instance* — recognizability is what makes a sound rewarding on repetition, per Duolingo's own "short, snappy, deliberately repetitive" signature [7]. Every sound needs a mute toggle independent of the rest of the app (autonomy, §5), and no two reward sounds should be able to overlap — debounce so a chain-tick occurring in the same frame as a pass plays only the bigger of the two.

---

## 5. Avoiding annoyance: the checklist and where BroGram is already exposed or already safe

Distilled from the 2025-2026 dark-pattern and gamification-ethics research [1][8][9][10][11][38][39][40]:

| Anti-pattern | What it looks like | BroGram's exposure today |
|---|---|---|
| Scarcity punishing mistakes | Hearts/lives lost per wrong answer | **Not present, and must stay that way.** BroGram's loop already treats a fail as data for the Diagnoser, not a cost. This is a real strength — say so in copy rather than silently relying on it. |
| Loss-framed, guilt-driven notifications | "You're about to lose everything," sad-mascot imagery, streak shaming | Not yet built (buddy/notification layer is future work) — design the reward table above so streak copy is always framed as *keeping* something good, never as impending loss, and skip a Duo-style guilt trip entirely (§2.1, §8). |
| Global leaderboards that demotivate strugglers | Public rank visible to a whole cohort | A small, hand-picked beta cohort makes a public leaderboard *worse*, not better — everyone knows everyone. Default to self-comparison only (personal-best framing, §4); if a social layer is ever added, scope it to opt-in, small, mutually-consented groups, never a sitewide board. |
| Badges for completion, not competence | A badge for opening the app 5 days running, unconnected to any actual skill | Keep BroGram's badge-equivalents (CLO-closed, chain, streak) tied to something that is already, by contract, a measure of demonstrated skill (`Mastery.closed`, `patternsPassed`) rather than inventing new badges for low-effort actions. |
| Redundant, low-signal onboarding | Asking many questions to build a profile the product barely uses | Directly the owner's complaint. `src/app/(app)/onboarding/page.tsx` allows up to `MAX_QUESTIONS = 13` (line 26) across two phases. §9.5 recommends cutting this materially and deferring low-signal questions to optional, later moments instead of gating the dashboard on them. |
| Notification/toast spam | Every minor event pinging the user | The reward table (§4) is deliberately tiered — only first-win, pass, close, and milestones get a real "moment"; hints and wellness logs stay quiet on purpose. |
| Manufactured urgency | Countdown timers, expiring rewards | Nothing in the spec calls for this and nothing here recommends adding it. |
| Removing user control over the "game" layer | No mute, no way to turn off animation, no way to place UI where the user wants it | Directly the owner's wellness-rail complaint (§9.3) and a real, checkable gap today: `src/components/shell/AppShell.tsx` lines 46-50 hard-code the wellness `<aside>` into the right-hand grid column with no prop, state, or preference controlling it, and `src/components/wellness/Rail.tsx` takes only a `compact` boolean — there is no position concept anywhere in the stack to change. |

The Self-Determination Theory framing [38][39] maps cleanly onto three things BroGram is already positioned to do well: **autonomy** (let the user place the wellness rail, mute sound, and see exactly what the integrity system logs and why — nothing hidden), **competence** (every reward in §4 ties to real mastery/streak data already in the contract, never invented), and **relatedness** (the bro persona, §8, is the relatedness lever — a companion voice, not a social leaderboard, fits a small trusted cohort far better).

---

## 6. The path map

Brilliant's color-coded, connected-node pathway [15] and the general skill-tree pattern used across gamified learning platforms [16-item family, general finding] both converge on the same three visual jobs a map has to do that a list cannot: show **what's done**, show **what's next and why it follows**, and show **how far the whole course goes** at a glance.

**BroGram already has every field a map needs, with no contracts change required:**
- `LearnerState.path: CloId[]` — the ordered sequence of CLOs the Planner picked (`src/lib/contracts.ts:266`).
- `LearnerState.mastery: Record<CloId, Mastery>`, where each `Mastery` carries `score`, `chain`, `patternsPassed`, `closed` (`src/lib/contracts.ts:185-196,269`).
- `Clo.prerequisites: CloId[]` for drawing the actual dependency lines rather than a flat sequence (`src/lib/contracts.ts:58`).
- `Clo.draft` for CLOs written without a syllabus yet, which the current build already renders with a muted "draft outcome" note (`docs/build-log.md`, final fix wave entry) — the map should carry that same muted treatment into node styling rather than reinvent it.

**Recommended node states**, directly from existing data with no new fields:
- **Locked** — a CLO whose prerequisites are not yet closed.
- **Available** — prerequisites closed, not yet attempted; this is where `nextExerciseIds` points.
- **In progress** — `chain > 0` and not yet `closed`, i.e., the student is mid-chain on this CLO right now.
- **Closed** — `closed: true`; per §4, this is a node that "lit up" the moment it closed and stays lit.
- **Draft** — `Clo.draft: true`, muted regardless of the above.

Connect nodes along `Clo.prerequisites`, not just `path` order, so a student can see *why* something unlocked, not just that it did — this is the specific thing a flat "next three exercises" list (the current dashboard, `src/app/(app)/dashboard/page.tsx`) cannot show, and the specific thing every product in this research treats as core rather than decorative.

---

## 7. Course switching without re-onboarding

The pattern is identical across every product that has more than one course/track: **the learner's profile is a separate object from the course's content, and switching content never re-collects identity.** Duolingo's placement test is scoped only to *how much of this specific language's content to skip*, never to the learner's original motivation/style answers, and can be skipped outright at the cost of starting the new content at zero — not at the cost of more questions [13]. Exercism's per-track syllabus is independent of the learner's account-level reputation and mentoring history [21][24]. Codecademy explicitly preserves prior progress and earned skills when a learner switches paths [29].

**BroGram's contract already encodes this correctly — the bug is in the UI, not the design.** `AgentTrigger` (`src/lib/contracts.ts:300-307`) has exactly one trigger for a course change: `plan-refresh`, documented as firing on "onboarding done, CLO closed, course switched" and routed to the **Planner**, which only ever touches `mastery`, `recentMistakes`, and `currentCourse` (`src/lib/contracts.ts:117-120`). There is no trigger that re-invokes the **Profiler** on a course switch. The actual defect is that `src/app/(app)/onboarding/page.tsx` line 47 declares `const [stage, setStage] = useState<Stage>('question')` with no check against `session.learnerState?.profile.onboardingComplete` before rendering the question flow — so visiting `/onboarding` for any reason, including the dashboard's own `Change course` link (`src/app/(app)/dashboard/page.tsx:118`) and `Review your course` link (`:155`), restarts Phase 1, Question 1 of the Profiler every time. The fix implied by the research pattern above: when `onboardingComplete` is already true, `/onboarding` should open directly at `stage: 'course'` (the course-picker screen that already exists in this same file, line 199) and only ever call the Planner — the two-phase Profiler questionnaire runs exactly once per account, exactly as `LearnerProfile.onboardingComplete: boolean` (`src/lib/contracts.ts:258`) already implies it should.

**The second half of the same complaint — "finding the next question takes a long time" — is a latency problem sitting on top of a correctly-scoped agent call.** Each onboarding answer round-trips to the Profiler agent synchronously before the next question renders (`submitAnswer` in `onboarding/page.tsx`, awaiting `callAgent` before calling `setQuestion`), with the only feedback a generic `"Finding your next question."` busy state. Nothing in this research suggests removing the adaptive agent (Brilliant, Exercism, and Khan Academy all adapt to the learner too) — it suggests **not blocking on it**: BroGram should hold a small local fallback question sequence (the build log confirms one already exists — `profiler-fallback.json`, shipped in the C1 task, `docs/build-log.md` line 29) and advance the UI optimistically from that local sequence the instant an answer is chosen, reconciling with the agent's real `nextQuestion` when it returns rather than making the learner watch a spinner between every card.

---

## 8. Persona voice: acting like a bro, not a teacher

Duolingo's own documented voice model is four named qualities that stay constant while *tone* (how hard each quality is pushed) flexes by context — the character does not change identity between a lesson and a notification, only its volume [12]. Boot.dev takes the same approach from a different angle: one consistent tutor identity (Boots), whose defining trait is a *behavioral rule* — refuse to just hand over the answer — rather than a mood [18][19]. BroGram already has the right mechanism for this: `Tone` is one of four values (`playful | supportive | tough-love | direct`, `src/lib/contracts.ts:22`) applied as "two sentences generated from the profile" appended to every agent prompt (`docs/superpowers/specs/2026-09-05-brogram-design.md` §6). The research says this structure is correct and just needs a persona underneath it to flex, the same way Duo flexes under four fixed qualities rather than inventing a new character per tone.

### The four bro pillars (BroGram's answer to Duo's four qualities)

| Pillar | What it means | What it is not |
|---|---|---|
| **Real** | Says what's actually true about the student's code and progress, plainly, like a peer would — "this is your third off-by-one this week" is real | Corporate hedging, vague positivity that could apply to anyone ("Great effort!" with nothing underneath it) |
| **Hyped** | Brings genuine energy to wins, especially the first one | Mockery dressed as banter; jokes never land at the student's expense |
| **In your corner** | Default assumption is "you've got this," notices effort as well as results, sounds like it's on the student's team even when delivering a fail | Guilt-tripping, "checking in" as pressure, anything that would make a student feel worse for a normal day off — this is the one Duo trait [12] deliberately **not** carried over, because it fails "stays respectful" |
| **Straight-talking** | Knows the material cold, explains the real "why," gets to the point | Condescension, over-explaining what wasn't asked, ever saying "as an AI" or naming the model (already a hard rule in `buddy.ts`'s `system` prompt and its `buddyReply` schema's identity-leak check, `src/lib/agents/buddy.ts:30`) |

`Tone` then reads as which pillar leads: `playful` leads with Hyped, `supportive` leads with In-your-corner, `tough-love` leads with Real (delivered without losing In-your-corner underneath), `direct` leads with Straight-talking. All four are still the same bro — never four different characters.

### Concrete rewrites, checked against the exact copy shipping today

These are illustrative, not final — copy is the Astra lane's call per the ownership table (`docs/superpowers/specs/2026-09-05-brogram-design.md` §16) — but each is grounded in a real string read directly from source, not invented:

- **Paste block** (`src/hooks/useLockdown.ts:87`, today: `"Type it. That's the whole point."`) — already fairly close to on-voice (short, direct, a real reason). The owner's complaint is less that the line is wrong and more that it is the *only* line, appearing identically every time, which reads as scolding on repetition. Recommend 2-3 short variants rotated in the same register so it stays Real without becoming a nag — e.g. *"Keyboard only — that's the rep."* / *"Nah. Typing it is what makes it stick."*
- **Idle overlay** (`src/components/exercise/LockdownOverlay.tsx:19`, today: `"Your exercise is still here. Move your mouse or press a key when you are ready."`) — solid and calm already; a light pass could tighten it toward Real/In-your-corner without losing the reassurance: *"Still here, still yours. Jump back in whenever."*
- **PrintScreen overlay** (same file, today: `"Keep your work here"` / `"Your exercise will return in a moment."`) — this is the specific interaction the owner named as "theatre." The research in §5 supports treating this as a factual, low-drama notice rather than a themed moment (integrity notices are the one place §4 explicitly recommends *against* adding personality or animation) — a flatter, shorter line reads as more bro, not less: *"Screenshot noted. Back to it."* The underlying detection/logging mechanic is outside this research's scope (owned by the anti-cheat subsystem); only the copy and its visual weight are addressed here.
- **Onboarding busy state** (`src/app/(app)/onboarding/page.tsx:193`, today: `"Finding your next question."`) — the real fix is removing the wait (§7); the copy, if a wait is ever visible at all, should sound like anticipation rather than a system status: *"Dialing in your next one…"*
- **Buddy identity** (`src/lib/agents/buddy.ts:5`, today opens: `"You are the BroGram Buddy, a study companion who talks about one thing: getting better at coding."`) — every hard rule in this file (on-topic gate, fixed refusal sentence, no code hand-outs, no identity leak) is correct and untouched by this research; only the identity framing in the system prompt is a candidate for a persona pass, e.g. reframing "a study companion" as something closer to a peer who's already a bit further along and genuinely wants to see the student win — the fixed refusal itself, `"I only talk about coding and how you get better at it. Ask me anything in that lane."` (`buddy.ts:20`), already reads as on-voice and needs no change.

### The structural rule, not just the copy rule

"Act like a bro, not a teacher" is bigger than word choice: it means the product should frame a fail as *"let's figure this out"* (what the Diagnoser already does — intent, root cause, fix plan, no grading language) rather than red-ink correctness, celebrate that the student showed up at all before it celebrates that they were right, and — per the Boot.dev and JetBrains findings above (§2.3, §3) — treat a hint as help from a friend who won't just do it for you, never as a shortcut the product is quietly proud of handing out.

---

## 9. Concrete recommendations for BroGram

### 9.1 Lesson content model per learning outcome

One new, small content unit per CLO — not per exercise — authored once for each of the 26 launch CLOs. Recommend modeling it as **new seed content joined by the existing `CloId`**, not as new fields on the frozen `Clo` or `Exercise` interfaces, so it ships with zero contracts PR:

```
seed/concepts/<course>.json → keyed by CloId
{
  "cloId": "INFS1101-3",
  "concept": "markdown, 2-4 sentences — the one idea, plain language",
  "workedExample": { "code": "...", "walkthrough": "markdown, step-by-step reasoning" },
  "guidedSteps": [ { "prompt": "...", "check": "..." } ],  // 1-2 small in-place checks
  "freeExerciseId": null  // resolved client-side via the existing bank query
}
```

Render order matches §3 exactly: concept → worked example → 1-2 guided steps graded instantly in place (Codecademy checkpoint pattern, §2.5) → the existing free `code` exercise from the bank. A CLO already marked `draft: true` gets a shorter, honestly-labeled version rather than blocking on the missing syllabus. This is authorable as its own offline generation workflow, the same shape as the existing exercise-bank workflow (`docs/workflows/exercise-bank-generation.js`), reviewed the same way (execution-verified where the guided steps are code, reasoning-reviewed where they are not).

### 9.2 Reward events list

Ship exactly the table in §4 as a client-only reaction layer — every trigger is a state change that already exists in `Attempt`, `Mastery`, `LearnerState.streak`, or `DrillResult`. **No new `AgentTrigger` and no contracts change is needed for the reward layer itself** — this is the fastest, lowest-risk part of the whole recommendation set to build, and it is real leverage against the "sluggish, no reward" complaint without waiting on any agent or schema work. Sound set: 6-8 short, distinct, mutable clips (pass, chain-tick, close, first-win, streak, personal-best, hint, notice); a single mute toggle in wellness/account prefs; debounce so simultaneous events play only the larger sound.

### 9.3 Path map

A new dashboard/course view rendering `path` and `mastery` as connected nodes per §6, using `Clo.prerequisites` for the connective structure, the five node states (locked/available/in-progress/closed/draft) as pure derivations of existing fields, and the same muted-draft treatment the mastery grid already uses. Zero contracts change. This directly replaces the flat "next three exercises" list as the dashboard's centerpiece, with the list still available as the map's zoomed-in view of "what's actionable right now."

### 9.4 Persona voice rules

Adopt the four bro pillars in §8 (Real, Hyped, In-your-corner, Straight-talking) as the one persona underneath all four `Tone` values, drop the guilt-tripping trait explicitly, and apply the rewrite pattern shown there across the app's copy — prioritizing the strings the owner specifically flagged (paste block, PrintScreen overlay) first, then the onboarding and dashboard copy, then the seven agents' system-prompt identity paragraphs (copy-only changes inside `src/lib/agents/*.ts`, none of which touch a frozen schema or rule). Every agent's existing hard rules (on-topic gate, single-line Coach code, no identity leak, fixed refusal sentence) stay exactly as specified — persona is a voice layer on top of those rules, never a replacement for them.

### 9.5 Fixes this research surfaced directly (not opinions — reproducible against the current code)

1. **Re-onboarding on course switch:** `src/app/(app)/onboarding/page.tsx` should check `session.learnerState?.profile.onboardingComplete` and open at `stage: 'course'` when true, skipping straight to the Planner-only flow; `Change course` / `Review your course` on the dashboard should not both dump the user into the same full flow a first-time visitor sees (§7).
2. **Onboarding latency:** advance the UI from the existing local `profiler-fallback.json` sequence optimistically, reconciling with the live Profiler reply instead of blocking each card on a round-trip (§7).
3. **Redundant onboarding questions:** cut `MAX_QUESTIONS` (`onboarding/page.tsx:26`, currently 13) materially — recommend a hard ceiling closer to 5-6 before the course picker, keeping only the highest-signal style/motivation questions gating the dashboard, and moving lower-signal ones (e.g., verbosity, depth-of-interest questions that could instead be inferred from later hint usage and session length) into optional, later prompts surfaced through the Buddy rather than a gate (§2.8, §5).
4. **Wellness rail placement:** `src/components/shell/AppShell.tsx:46-50` hard-codes the wellness `<aside>` into a fixed right-hand grid column with no control surface, and `src/components/wellness/Rail.tsx` accepts only a `compact` boolean. Recommend adding one additive field to the already-frozen-but-extensible `WellnessPrefs` (`src/lib/contracts.ts:499`) — e.g. `railPosition: 'left' | 'right' | 'top' | 'dock' | 'hidden'`, defaulted in `DEFAULT_WELLNESS` (`:509`) — which is a backward-compatible, low-risk contracts PR (existing stored rows simply lack the field and fall back to the default), then have `AppShell` read it and lay out accordingly, including a genuine collapsed/hidden state, which does not exist today at all.
5. **What NOT to change:** the seven-trigger agent-call discipline (`AgentTrigger`, `src/lib/contracts.ts:300-307`) is already correct per every course-switching precedent in this research (§7) and should not gain a new trigger for anything in this document — every recommendation above is either pure client-side reaction to existing state (§9.2, §9.3) or new content joined by an existing id (§9.1), specifically so none of it requires touching the frozen agent-call surface.

---

## Sources

1. [Duolingo gamification explained | StriveCloud](https://www.strivecloud.io/duolingo-gamification-explained)
2. [The Psychology Behind Duolingo's Streak Feature](https://www.justanotherpm.com/blog/the-psychology-behind-duolingos-streak-feature)
3. [Why Duolingo's Gamification Works (And When It Doesn't) - DEV Community](https://dev.to/pocket_linguist/why-duolingos-gamification-works-and-when-it-doesnt-1d4)
4. [The Psychology of Gamification: A Deep Dive Into Duolingo | Ludaxis](https://www.ludaxis.io/blog/gamification-in-apps-duolingo-case-study-2026)
5. [Streak milestone design animation | Duolingo Blog](https://blog.duolingo.com/streak-milestone-design-animation)
6. [Duolingo Lesson Complete Head Explode Animation | 60fps.design](https://60fps.design/shots/duolingo-lesson-complete-head-explode-animation)
7. [Exploring Duolingo's Unique Audio | SoundCy](https://soundcy.com/article/what-does-duolingo-sound-like)
8. [Duolingo Push Notifications: Inside One of Mobile's Most-Copied Playbooks | Deconstructor of Fun](https://duolingo.deconstructoroffun.com/mechanics/notifications)
9. [Duolingo Energy System — The Complete Guide | duoplanet](https://duoplanet.com/duolingo-energy-system/)
10. [Hearts | Duolingo Wiki | Fandom](https://duolingo.fandom.com/wiki/Hearts)
11. [It's Time For Duolingo To DITCH The Heart System | duoplanet / duolingoguides](https://duolingoguides.com/its-time-for-duolingo-to-ditch-the-heart-system/)
12. [Inside the Brand: Duolingo | Kepler Design](https://keplerdesign.substack.com/p/duolingo)
13. [Duolingo 101: how to learn a language on Duolingo | Duolingo Blog](https://blog.duolingo.com/duolingo-101-how-to-learn-a-language-on-duolingo)
14. [The key to learning math and science online is interactive play | UX Collective](https://uxdesign.cc/the-key-to-learning-math-and-science-online-is-interactive-play-6ea68ce167fe)
15. [How Brilliant.org motivates learners with Rive animations](https://rive.app/blog/how-brilliant-org-motivates-learners-with-rive-animations)
16. [About | Brilliant](https://brilliant.org/about/)
17. [Brilliant.org × ustwo](https://ustwo.com/work/brilliant/)
18. [About | Boot.dev](https://www.boot.dev/about)
19. [Boots, a Wizard Bear that Codes | Boot.dev](https://www.boot.dev/blog/wiki/boots)
20. [Developer Gamification: Levels, Badges, and XP — Does It Work or Annoy? | PanDev Metrics](https://pandev-metrics.com/docs/blog/gamification-works-or-annoys)
21. [Syllabus | Exercism's Docs](https://exercism.org/docs/building/tracks/syllabus)
22. [Unlocking Exercises | Exercism's Docs](https://exercism.org/docs/building/product/unlocking-exercises)
23. [Concept Exercises | Exercism's Docs](https://exercism.org/docs/building/product/concept-exercises)
24. [The Mentoring Mindset | Exercism's Docs](https://exercism.org/docs/mentoring/mindset)
25. [A Tour of Exercism | Webstep, Medium](https://medium.com/webstep/a-tour-of-exercism-9fe2946ea4ba)
26. [Tutorial standards | Codecademy Teams+ Docs](https://codecademy-teams-curriculum-documentation.codecademy.com/articles/tutorial-standards/)
27. [Coding problems? Learn what to do when you're stuck | Codecademy](https://www.codecademy.com/resources/blog/what-to-do-when-youre-stuck)
28. [Understanding Your Code | Codecademy Help Center](https://help.codecademy.com/hc/en-us/articles/220914987-Understanding-Your-Code)
29. [Picking Your Learning Path | Codecademy Help Center](https://help.codecademy.com/hc/en-us/articles/220453248-Picking-Your-Learning-Path)
30. [How Khan Academy is Bringing Mastery Learning to the Masses | Cult of Pedagogy](https://www.cultofpedagogy.com/khan-mastery-learning/)
31. [Why Mastery Learning, by Sal Khan | Khan Academy Help Center](https://support.khanacademy.org/hc/en-us/articles/360030753412-Why-Mastery-Learning-by-Sal-Khan)
32. [What is self-paced Mastery? | Khan Academy Help Center](https://support.khanacademy.org/hc/en-us/articles/360007253831-What-is-self-paced-Mastery)
33. [Khan Academy gamifies computer science | ResearchGate](https://www.researchgate.net/publication/261961212_Khan_Academy_gamifies_computer_science)
34. [Strategies for Supporting Self-Paced Mastery on Khan Academy Readiness Pace (PDF)](https://www.khanschoolsnetwork.org/wp-content/uploads/2025/04/Khan-Academy-Strategy-Bank.pdf)
35. [Swift Playgrounds | Apple](https://www.apple.com/uk/swift/playgrounds/)
36. [Create engaging content for Swift Playgrounds — WWDC22 | Apple Developer](https://developer.apple.com/videos/play/wwdc2022/110349/)
37. [Learn to code in Swift Playgrounds on Mac | Apple Support](https://support.apple.com/guide/playgrounds/learn-to-code-itca964ba79c/4.3/mac/13.0)
38. [Gamification Gone Wrong: When Streaks and Badges Become the Point (2026) | NerdSip](https://nerdsip.com/blog/gamification-gone-wrong-when-streaks-become-the-point)
39. [Dark Patterns: Brignull's 12 Manipulative UX Tricks | Yu-kai Chou](https://yukaichou.com/gamification-analysis/dark-patterns-brignull-manipulative-design-ux/)
40. [What is Gamification: Complete Guide (2026) | StriveCloud](https://www.strivecloud.io/blog/what-is-gamification)
41. [The Habit Loop: Key to Building Habit-Forming App Experiences | Netcore](https://netcore.ai/blog/the-habit-loops-key-to-building-habit-forming-app-experiences/)
42. [The Habit Loop in Product Design: Build Sticky Apps | productgrowth.in](https://productgrowth.in/insights/consumer/habit-loop-product-design/)
43. [Harnessing Habit Loops for Behavior Change | Number Analytics](https://www.numberanalytics.com/blog/ultimate-guide-habit-loops-design-behavior-change)
44. [Best SaaS Onboarding Examples, Checklist & Practices for 2025 | Candu](https://www.candu.ai/blog/best-saas-onboarding-examples-for-2025)
45. [Onboarding Gamification: What Works in B2B SaaS (and What Backfires) | Kompassify](https://kompassify.com/blog/onboarding-gamification-guide)
46. [SaaS Onboarding 2026: Beat the 37.5% Activation Trap | Flowjam](https://www.flowjam.com/blog/saas-onboarding-best-practices-2025-guide-checklist)
47. [Helping Students Get Unstuck: AI-Based Hints for Online Learning | JetBrains Research Blog](https://blog.jetbrains.com/research/2025/07/ai-hints-for-online-learning/)
48. [A Survey of Automated Programming Hint Generation — The HINTS Framework](https://arxiv.org/pdf/1908.11566)
49. [I do / we do... strikes again | Unstoppable Learning](https://unstoppablelearning.substack.com/p/i-do-we-do-strikes-again)
50. [Squeezing more juice out of your game design! | GameAnalytics](https://www.gameanalytics.com/blog/squeezing-more-juice-out-of-your-game-design)
