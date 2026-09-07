/**
 * The Bro's string bank.
 *
 * One character, present everywhere: someone about two years ahead of you who
 * has already made the mistake you're about to make, who is genuinely pleased
 * when you get it, and who will not type your answer for you. Not a teacher,
 * a coach with a whistle, a corporate assistant, or a mascot with a
 * catchphrase.
 *
 * Content is spec §2.7 verbatim except where a documented ruling below
 * changes it (Opus review, fix round 1 — see docs/build-log.md). Components
 * call `line('pass')`, never a literal string — see
 * docs/superpowers/specs/2026-09-06-brogram-v2-bro.md §2.5.
 */

export type LineKey =
  | 'welcome' | 'onboard.q.intro' | 'onboard.done'
  | 'lesson.start' | 'lesson.check.right' | 'lesson.check.wrong' | 'lesson.check.wrong.line' | 'lesson.done' | 'lesson.skip'
  | 'lesson.verdict.right' | 'lesson.verdict.notYet'
  | 'pass' | 'pass.first' | 'fail' | 'hint' | 'hint.last' | 'chain.tick' | 'clo.close' | 'course.clear'
  | 'streak.keep' | 'streak.milestone' | 'streak.lost' | 'level.up' | 'best' | 'goal.done'
  | 'derot.arcade.enter' | 'derot.play.enter' | 'derot.run.done'
  | 'guard.paste' | 'guard.paste.why' | 'guard.blur' | 'guard.idle' | 'guard.printscreen' | 'guard.why'
  | 'guard.warned' | 'guard.restricted' | 'guard.restricted.paste' | 'guard.banned'
  | 'empty.bank' | 'empty.trophies' | 'error.offline' | 'error.save' | 'error.load' | 'loading.plan' | 'loading.runtime'
  | 'buddy.failed' | 'buddy.suggest.play' | 'buddy.suggest.arcade' | 'buddy.empty'
  | 'dock.prayer' | 'dock.water' | 'dock.stretch' | 'dock.pomodoro' | 'dock.collapse' | 'dock.restore'

export type Frequency = 'rare' | 'session' | 'hot'

interface BankEntry {
  frequency: Frequency
  /** Rotating variants. `line`/`lineWith` never return the same one twice in a row. */
  variants: string[]
  /**
   * Used only when a variable a picked variant needs is missing from `vars`
   * in production. Must itself carry no `{placeholder}` — see `lineWith`.
   */
  fallback?: string
}

/**
 * The one appeal channel BroGram has — same for everyone, matches the
 * existing `Contact Velocity through your invitation email` copy at
 * `src/components/shell/AccountNotice.tsx:7`. Baked into the banned line at
 * module-definition time rather than an interpolation slot, so a missing
 * variable can never strand a banned learner with no way out (fix round 1,
 * finding I2).
 */
const APPEAL_CHANNEL = 'Velocity through your invitation email'

// ---------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------

const BANK: Readonly<Record<LineKey, BankEntry>> = {
  // Welcome / onboarding
  welcome: {
    frequency: 'session',
    variants: [
      'Yo. This is BroGram — the program with a B. Hands on the keyboard from line one.',
      "You're in. No lectures, no fluff. You write code, it tells you the truth.",
      'Welcome. Six quick questions, then we get to work.',
    ],
  },
  'onboard.q.intro': {
    frequency: 'session',
    variants: [
      'Nothing here is a test. Pick whichever is more you.',
      "Six questions. Twenty seconds. Then we're done asking.",
    ],
  },
  'onboard.done': {
    frequency: 'session',
    variants: [
      "Locked in. Pick a course and let's see what you've got.",
      "Got it. That's the last question you'll get from us.",
    ],
  },

  // Walkthrough (lesson)
  'lesson.start': {
    frequency: 'session',
    variants: [
      'Walkthrough first. Read it, run it, then you drive.',
      "Nothing's graded in here. Poke at it.",
      'Short one. Then a real rep.',
    ],
  },
  'lesson.check.right': {
    frequency: 'hot',
    variants: ["That's it.", 'Yep. Exactly that.', 'Clean.'],
  },
  // (fix round 1, I8 — split off the line-number variant. Three of five check
  // kinds (choose-one, fill-blank, micro-code) have no meaningful line
  // number, so the old #1 variant threw in development roughly a third of
  // the time. This key is now var-free on every variant; a third,
  // slot-free variant is added so the hot minimum of three still holds
  // after #1 moved out.)
  'lesson.check.wrong': {
    frequency: 'hot',
    variants: [
      "Close. Read what it actually prints, not what you'd want it to.",
      "Nope. Here's the part that bites people.",
      'Not quite. Give it another look.',
    ],
  },
  /** Only for check kinds that have a real line number (predict-output, trace, spot-the-bug). */
  'lesson.check.wrong.line': {
    frequency: 'session',
    variants: ['Not quite. Look at line {n} again.'],
    fallback: 'Not quite. Give it another look.',
  },
  'lesson.done': {
    frequency: 'session',
    variants: ["That's the idea. Go take a real one.", "You've got the shape of it. Rep time."],
  },
  'lesson.skip': {
    frequency: 'rare',
    variants: ["Fair. It's here if you want it later."],
  },
  // The verdict word next to a check's colour + glyph (change log item 34).
  // A fixed status label, not a celebratory line — no rotation, on purpose.
  'lesson.verdict.right': {
    frequency: 'session',
    variants: ['Right'],
  },
  'lesson.verdict.notYet': {
    frequency: 'session',
    variants: ['Not yet'],
  },

  // Pass / fail / hint
  'pass.first': {
    frequency: 'rare',
    // (fix round 1, table row 37 — "the whole product" is the founder's
    // word, not the bro's.)
    variants: ["First one down. That feeling is why you're here."],
  },
  pass: {
    frequency: 'hot',
    // The zero-hint variant ("Done. Zero hints on that one.") is spec item 24 —
    // it is only true when hintCount === 0, so it never enters this pool.
    // Use `passLine(hintCount)` below to include it honestly.
    variants: [
      'Nailed it. Green across the board.',
      "That's a pass. Next one before you get comfortable.",
      'Clean run. Whatever just clicked, it stuck.',
    ],
  },
  fail: {
    frequency: 'hot',
    variants: [
      "Not this time. Let's look at what broke.",
      'Tests disagree. Take another pass.',
      "That one didn't land. Which is literally what this is for.",
    ],
  },
  hint: {
    frequency: 'hot',
    variants: ["Here's a nudge. Not the answer.", 'One push. The rest is yours.', 'Pointing at it, not solving it.'],
  },
  'hint.last': {
    frequency: 'session',
    variants: ['Last hint on this one. Make it count.'],
  },

  // Progress
  'chain.tick': {
    frequency: 'hot',
    variants: [
      '{n} of 3, different angle each time.',
      // (fix round 1, I7 — "New angle next" is false on the third tick,
      // which closes the skill; T2.6 fires confetti on exactly that tick.)
      '{n} of 3. Each one a different angle.',
      "That's {n}. Same idea, different shape.",
    ],
    // Every shipped variant needs {n} — a bespoke, var-free fallback.
    fallback: 'Another one down. Different angle each time.',
  },
  'clo.close': {
    frequency: 'session',
    variants: ['{skill} — locked.', 'That skill is yours. Three angles, three passes.'],
    fallback: 'That skill is yours. Three angles, three passes.',
  },
  'course.clear': {
    frequency: 'rare',
    variants: ['Whole course, cleared. Go look at where you started.'],
  },
  'streak.keep': {
    frequency: 'rare',
    variants: ['Day {n}. Same time tomorrow.', "Streak's alive."],
    fallback: "Streak's alive.",
  },
  'streak.milestone': {
    frequency: 'rare',
    variants: ["{n} days straight. That's not luck."],
    fallback: "Big streak. That's not luck.",
  },
  'streak.lost': {
    frequency: 'rare',
    variants: ['Streak reset. Start a new one today — takes one rep.'],
  },
  'level.up': {
    frequency: 'rare',
    variants: ['Level {n}. The reps get sharper from here.', 'Level {n}. Look back at your first one.'],
    fallback: 'Level up. The reps get sharper from here.',
  },
  best: {
    frequency: 'session',
    variants: ['New personal best. {n}.'],
    fallback: 'New personal best.',
  },
  'goal.done': {
    frequency: 'rare',
    variants: ['Daily goal, done. Anything past this is profit.'],
  },

  // De-rot
  'derot.arcade.enter': {
    frequency: 'session',
    variants: ["Timer's on. Beat yesterday's you."],
  },
  'derot.play.enter': {
    frequency: 'session',
    variants: ['No code in here. Just you and the screen.'],
  },
  'derot.run.done': {
    frequency: 'hot',
    variants: [
      'Run over. {n} points, {m} combo.',
      // (fix round 1, I6 — "Sharper than last time" claimed an improvement
      // nothing checked, on a hot key, the same fault ruling 4 caught for
      // `pass`. Claim-free replacement: no comparison, nothing to verify.)
      "That's the run. Numbers are on the board.",
      // (added — not in spec §2.7, which left this hot key at two variants;
      // rule 6 requires three. Text replaced per ruling 3: "Logged" is the
      // surveillance register (`guard.printscreen`, `guard.why`) landing on
      // a celebration.)
      "Run's in. Go again whenever.",
    ],
    fallback: "That's the run. Numbers are on the board.",
  },

  // Guards — flat register, no "bro", no sound
  'guard.paste': {
    frequency: 'hot',
    variants: [
      'Paste is off on this screen. Type it out.',
      'Blocked. Typing is the exercise.',
      // (fix round 1, table row 58 — "pasteable" is a coinage, not English.)
      "Paste won't work here. Type it.",
      'Keyboard only on this screen.',
    ],
  },
  // R9.3's "why" affordance on the paste toast — a one-sentence expansion,
  // distinct from `guard.why` (the full Account → Integrity policy panel).
  'guard.paste.why': {
    frequency: 'rare',
    variants: [
      'Paste is off because typing is the exercise, and because it is the one thing browsers actually let us enforce, so we do.',
    ],
  },
  'guard.blur': {
    frequency: 'hot',
    variants: [
      // (fix round 1, I5 — "you clicked away" asserts intent a blur event
      // cannot prove; a system dialog or a notification blurs the tab too.)
      'Paused — the window lost focus. Come back to pick it up.',
      "Work's held right here. Click back in when you're ready.",
      'Paused. Nothing was lost.',
    ],
  },
  'guard.idle': {
    frequency: 'hot',
    variants: ['Quiet for a bit, so we paused. Type anything to keep going.', 'Still here, still yours. Jump back in whenever.', 'Paused after a quiet stretch. Any key resumes.'],
  },
  'guard.printscreen': {
    frequency: 'rare',
    variants: ["Screenshots aren't something a website can block. We log the attempt and move on."],
  },
  'guard.why': {
    frequency: 'rare',
    variants: [
      "Paste is the one thing browsers actually let us stop, so we stop it. Leaving the tab and pressing PrintScreen are signals we log, not things we can prevent. Screenshots can't be prevented by anyone. The real backstop is that your exercises aren't the same as anyone else's.",
    ],
  },
  'guard.warned': {
    frequency: 'rare',
    // (fix round 1, I4 — "this week" contradicted the rolling 7-day window
    // §9.2 actually uses; matched to the wording now shared with `guard.banned`.)
    variants: ["Heads up: flags crossed 10 in the last 7 days. Nothing is paused. Here's exactly what counted."],
  },
  // (deviation — spec §9.3's itemised receipt has a per-user, variable-length
  // list of event counts that no fixed string or `{n}`-style slot can hold
  // honestly. The bank carries the flat frame — including the threshold,
  // which is static and universal, per fix round 1 I1 — and the itemised
  // rows are UI, rendered by the consumer from `my_integrity_breakdown()`.)
  'guard.restricted': {
    frequency: 'rare',
    // (fix round 1, I1 — names the threshold (the actual cause), says "Reps"
    // per the glossary instead of "Exercises", and restores the De-rot
    // promise T2.9a Step 5 depends on verbatim.)
    variants: [
      'Reps are paused for 24 hours. Flags crossed 20 in the last 7 days — here is the arithmetic. Reps come back at {time}; dashboard, walkthroughs and De-rot stay open.',
    ],
    fallback: 'Reps are paused for 24 hours. Flags crossed 20 in the last 7 days. Dashboard, walkthroughs and De-rot stay open.',
  },
  // §9.3's instant-restrict copy (five paste blocks in one rep) — a
  // different cause than the score threshold above, so it needs its own key
  // (fix round 1, I3); reusing `guard.restricted` would have named the wrong
  // cause to a learner whose score never crossed 20.
  'guard.restricted.paste': {
    frequency: 'rare',
    variants: [
      'Reps are paused for 24 hours. Paste was blocked 5 times in one rep — an automatic rule that fires at exactly 5, for everyone. Back at {time}.',
    ],
    fallback: 'Reps are paused for 24 hours. Paste was blocked 5 times in one rep — an automatic rule that fires at exactly 5, for everyone.',
  },
  // (Critical fix, C1 — the shipped line claimed the app counts screenshots.
  // The weight-3 event is a PrintScreen keyup; §9.1 states screenshots are
  // "not preventable by any web technology, full stop." Also restores the
  // 10/20/40 lines R9.5/T2.8 require and "or copy", dropped by the earlier
  // compression. This is the whole disclosure — a banned learner has no
  // session and no receipt underneath it (T2.8 Step 5) — so it now carries
  // the 60-word policy exemption instead of the 30-word panel cap, and the
  // appeal channel is a baked-in constant, never an interpolation slot.)
  'guard.banned': {
    frequency: 'rare',
    variants: [
      `This account is banned. Flags crossed 40 in the last 7 days. The weights: 3 for a PrintScreen attempt, 2 for a blocked paste or copy, 1 for leaving the tab. The lines are 10, 20 and 40, the same for everyone. If this is wrong, contact ${APPEAL_CHANNEL}; we'll read the actual log, not the number.`,
    ],
  },

  // Empty / error / loading
  'empty.bank': {
    frequency: 'rare',
    variants: ['Out of fresh reps at this angle. Writing you one now.'],
  },
  'empty.trophies': {
    frequency: 'rare',
    variants: ['Nothing on the shelf yet. First pass puts something here.'],
  },
  'error.offline': {
    frequency: 'rare',
    variants: ["No connection. Your code still runs — we just can't save it yet."],
  },
  'error.save': {
    frequency: 'hot',
    variants: ["That didn't save. Your result stands; we'll retry.", 'Save failed. The result is real; retrying.', "Couldn't reach the server. Holding it, trying again."],
  },
  // The shared `<ErrorRetry>` (§10 intro) — any failed data fetch outside
  // save/offline's own paths.
  'error.load': {
    frequency: 'session',
    variants: ["Couldn't load that. Try again."],
  },
  'loading.plan': {
    frequency: 'session',
    variants: ['Lining up your path.'],
  },
  'loading.runtime': {
    frequency: 'hot',
    variants: ['Warming up {name}. First time is the slow one.', 'Getting {name} on its feet.', 'Loading {name}. The bar is real progress, not a guess.'],
    // (fix round 1, table row 75 — "runtime" is internal vocabulary.)
    fallback: 'Warming up the code runner. First time is the slow one.',
  },

  // Buddy (T2.11)
  'buddy.failed': {
    frequency: 'session',
    variants: ['Didn\'t send. Tap to try again.'],
  },
  // R7.6's de-rot suggestion, picked by context: a hard failure run points at
  // Playground, a long idle gap points at Arcade.
  'buddy.suggest.play': {
    frequency: 'session',
    variants: ["Step off it for ninety seconds — Playground's right there."],
  },
  'buddy.suggest.arcade': {
    frequency: 'session',
    variants: ['Long gap. A quick Arcade run gets you back in rhythm.'],
  },
  'buddy.empty': {
    frequency: 'rare',
    variants: ["Nothing queued. Ask when you're stuck."],
  },

  // Wellness dock labels (T2.4)
  'dock.prayer': {
    frequency: 'rare',
    variants: ['Prayer'],
  },
  'dock.water': {
    frequency: 'rare',
    variants: ['Water'],
  },
  'dock.stretch': {
    frequency: 'rare',
    variants: ['Stretch'],
  },
  'dock.pomodoro': {
    frequency: 'rare',
    variants: ['Pomodoro'],
  },
  'dock.collapse': {
    frequency: 'rare',
    variants: ['Collapse'],
  },
  'dock.restore': {
    frequency: 'rare',
    variants: ['Bring the dock back'],
  },
}

/** Exposed for tests only — the bank's shape (frequency, variant count) matters more than its identity. */
export const LINE_BANK: Readonly<Record<LineKey, Readonly<BankEntry>>> = BANK

// ---------------------------------------------------------------------------
// Picking and rendering
// ---------------------------------------------------------------------------

/** FNV-1a — small, dependency-free, good enough avalanche for a UI string picker. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const lastIndex = new Map<LineKey, number>()

/**
 * With a `seed`: a pure, deterministic hash of `key:seed`, uniform across
 * every variant. Safe anywhere, including a server-rendered path — the same
 * seed always picks the same variant, so there is nothing for hydration to
 * disagree about.
 *
 * Without a `seed` (legacy path): `Math.random()`, uniform across every
 * variant *except* the immediately previous one (fix round 1, I9 — the
 * earlier version deterministically bumped to `previous + 1`, which gives
 * that one neighbour a 50% share on a 4-variant key). This path carries
 * module-global state, so it is client-only — see `line`'s doc comment.
 */
function pickIndex(key: LineKey, count: number, seed?: string | number): number {
  if (count <= 1) return 0

  if (seed !== undefined) {
    return hashSeed(`${key}:${seed}`) % count
  }

  const previous = lastIndex.get(key)
  const index = previous === undefined
    ? Math.floor(Math.random() * count)
    : (previous + 1 + Math.floor(Math.random() * (count - 1))) % count
  lastIndex.set(key, index)
  return index
}

const PLACEHOLDER = /\{(\w+)\}/g

function render(key: LineKey, vars: Record<string, string | number>, seed?: string | number): string {
  const entry = BANK[key]
  const variant = entry.variants[pickIndex(key, entry.variants.length, seed)]
  const missing: string[] = []
  const filled = variant.replace(PLACEHOLDER, (_match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return String(vars[name])
    missing.push(name)
    return `{${name}}`
  })

  if (missing.length === 0) return filled

  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`voice bank: "${key}" is missing variable(s) ${missing.join(', ')}`)
  }

  // Production never ships a literal brace to a learner — fall back to the
  // key's plain, variable-free line instead.
  return entry.fallback ?? filled.replace(PLACEHOLDER, '')
}

/**
 * Picks a rotating variant for `key` and returns it as-is (no `{var}` slots
 * expected — use `lineWith` for those).
 *
 * Pass a `seed` (a stable per-render key, or `${userId}:${counter}` where
 * the caller increments `counter`) for a deterministic pick that is safe to
 * call from a server-rendered path. With no `seed`, the pick is random and
 * carries process-global rotation state — call it only from a client
 * component, an effect, or an event handler, never during server rendering
 * (fix round 1, I10: the earlier doc comment claimed this path was
 * "deterministic per render", which `Math.random()` cannot be).
 */
export function line(key: LineKey, seed?: string | number): string {
  return render(key, {}, seed)
}

export function lineWith(key: LineKey, vars: Record<string, string | number>, seed?: string | number): string {
  return render(key, vars, seed)
}

/**
 * `pass` has a fourth, spec-mandated variant ("Done. Zero hints on that one.")
 * that is only a true statement when no hint was used. `line('pass')` never
 * includes it, so it can't accidentally lie — call sites that know the hint
 * count should use this instead to get the honest fourth variant in rotation.
 */
export function passLine(hintCount: number, seed?: string | number): string {
  const base = BANK.pass.variants
  const variants = hintCount === 0 ? [...base, 'Done. Zero hints on that one.'] : base
  return variants[pickIndex('pass', variants.length, seed)]
}
