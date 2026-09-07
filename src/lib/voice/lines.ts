/**
 * The Bro's string bank.
 *
 * One character, present everywhere: someone about two years ahead of you who
 * has already made the mistake you're about to make, who is genuinely pleased
 * when you get it, and who will not type your answer for you. Not a teacher,
 * a coach with a whistle, a corporate assistant, or a mascot with a
 * catchphrase.
 *
 * Content is spec §2.7 verbatim, with two documented deviations recorded
 * below at their keys. Components call `line('pass')`, never a literal
 * string — see docs/superpowers/specs/2026-09-06-brogram-v2-bro.md §2.5.
 */

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
  'lesson.check.wrong': {
    frequency: 'hot',
    variants: [
      'Not quite. Look at line {n} again.',
      "Close. Read what it actually prints, not what you'd want it to.",
      "Nope. Here's the part that bites people.",
    ],
    // Only variant 16 carries no {n} — reused so a missing n never leaks a brace.
    fallback: "Nope. Here's the part that bites people.",
  },
  'lesson.done': {
    frequency: 'session',
    variants: ["That's the idea. Go take a real one.", "You've got the shape of it. Rep time."],
  },
  'lesson.skip': {
    frequency: 'rare',
    variants: ["Fair. It's here if you want it later."],
  },

  // Pass / fail / hint
  'pass.first': {
    frequency: 'rare',
    variants: ['First one down. That feeling is the whole product.'],
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
    variants: ['{n} of 3, different angle each time.', '{n} of 3. New angle next.', "That's {n}. Same idea, different shape."],
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
      'That\'s the run. Sharper than last time.',
      // (added — not in spec §2.7, which left this hot key at two variants;
      // rule 6 requires three. See report for the ruling.)
      "Logged. Go again whenever you're ready.",
    ],
    fallback: "That's the run. Sharper than last time.",
  },

  // Guards — flat register, no "bro", no sound
  'guard.paste': {
    frequency: 'hot',
    variants: [
      'Paste is off on this screen. Type it out.',
      'Blocked. Typing is the exercise.',
      'Not pasteable here. Type it.',
      'Keyboard only on this screen.',
    ],
  },
  'guard.blur': {
    frequency: 'hot',
    variants: ['Paused — you clicked away. Come back to pick it up.', "Work's held right here. Click back in when you're ready.", 'Paused. Nothing was lost.'],
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
    variants: ['Heads up: your flag count crossed 10 this week. Nothing is paused. Here\'s exactly what counted.'],
  },
  // (deviation — spec §9.3's itemised receipt has a per-user, variable-length
  // list of event counts that no fixed string or `{n}`-style slot can hold
  // honestly. The bank carries the flat frame; the itemised rows are UI,
  // rendered by the consumer from `my_integrity_breakdown()`. See report.)
  'guard.restricted': {
    frequency: 'rare',
    variants: ['Exercises are paused for 24 hours. Reps come back at {time} — everything else stays open.'],
    fallback: 'Exercises are paused for 24 hours. Everything else stays open.',
  },
  'guard.banned': {
    frequency: 'rare',
    variants: [
      'Banned. The score crossed 40 in the last 7 days — weight 3 per screenshot, 2 per paste block, 1 per tab-away, same for everyone. Reply to {contact} to appeal.',
    ],
    fallback:
      'Banned. The score crossed 40 in the last 7 days — weight 3 per screenshot, 2 per paste block, 1 per tab-away, same for everyone.',
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
  'loading.plan': {
    frequency: 'session',
    variants: ['Lining up your path.'],
  },
  'loading.runtime': {
    frequency: 'hot',
    variants: ['Warming up {name}. First time is the slow one.', 'Getting {name} on its feet.', 'Loading {name}. The bar is real progress, not a guess.'],
    fallback: 'Warming up the runtime. First time is the slow one.',
  },
}

/** Exposed for tests only — the bank's shape (frequency, variant count) matters more than its identity. */
export const LINE_BANK: Readonly<Record<LineKey, Readonly<BankEntry>>> = BANK

// ---------------------------------------------------------------------------
// Picking and rendering
// ---------------------------------------------------------------------------

const lastIndex = new Map<LineKey, number>()

function pickIndex(key: LineKey, count: number): number {
  if (count <= 1) return 0
  const previous = lastIndex.get(key)
  let index = Math.floor(Math.random() * count)
  if (index === previous) {
    index = (index + 1) % count
  }
  lastIndex.set(key, index)
  return index
}

const PLACEHOLDER = /\{(\w+)\}/g

function render(key: LineKey, vars: Record<string, string | number>): string {
  const entry = BANK[key]
  const variant = entry.variants[pickIndex(key, entry.variants.length)]
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

/** Deterministic-per-render; never the same variant twice in a row for one key. */
export function line(key: LineKey): string {
  return render(key, {})
}

export function lineWith(key: LineKey, vars: Record<string, string | number>): string {
  return render(key, vars)
}

/**
 * `pass` has a fourth, spec-mandated variant ("Done. Zero hints on that one.")
 * that is only a true statement when no hint was used. `line('pass')` never
 * includes it, so it can't accidentally lie — call sites that know the hint
 * count should use this instead to get the honest fourth variant in rotation.
 */
export function passLine(hintCount: number): string {
  const base = BANK.pass.variants
  const variants = hintCount === 0 ? [...base, 'Done. Zero hints on that one.'] : base
  return variants[pickIndex('pass', variants.length)]
}
