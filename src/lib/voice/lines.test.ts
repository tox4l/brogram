import { describe, expect, it, vi, afterEach } from 'vitest'
import { LINE_BANK, line, lineWith, passLine, type LineKey } from './lines'

const ALL_KEYS = Object.keys(LINE_BANK) as LineKey[]
const EMOJI = /\p{Extended_Pictographic}/u

/** Word count that ignores interpolation slots and stray punctuation tokens
 *  (an em dash surrounded by spaces is not a word). This is the same rule
 *  used to size every cap below. */
function wordCount(text: string): number {
  return text
    .replace(/\{[^}]+\}/g, 'X')
    .split(/\s+/)
    .filter((token) => /[a-zA-Z0-9]/.test(token)).length
}

function allTexts(key: LineKey): string[] {
  const entry = LINE_BANK[key]
  return entry.fallback ? [...entry.variants, entry.fallback] : entry.variants
}

describe('voice rule 1 — length caps', () => {
  // "Under twelve" / "under thirty" are read as inclusive ceilings (<=), not
  // strict (<): three spec-mandated toast lines (guard.idle #1,
  // error.offline, lesson.check.wrong #2 as a body line) land at exactly 12
  // words once the em dash is not counted as a word. Rewriting mandated
  // §2.7 copy to dodge a strict "<" was rejected — ship verbatim (Step 1)
  // wins over a stricter reading of "under". Confirmed by Opus review,
  // ruling 1: APPROVE, condition recorded in docs/build-log.md.
  const PANEL_BODY_KEYS = new Set<LineKey>(['welcome', 'guard.printscreen', 'guard.warned', 'guard.paste.why', 'guard.restricted.paste'])
  // Fix round 1, ruling 2: a full-screen policy surface is not a panel body
  // (the same argument the spec already accepted for guard.why) — extended
  // from guard.why alone to guard.restricted and guard.banned, both of
  // which now name the universal thresholds/weights that forced the
  // 30-word cap's earlier, dishonest compression.
  const EXEMPT_60_KEYS = new Set<LineKey>(['guard.why', 'guard.restricted', 'guard.banned'])

  it('keeps every celebration/toast/button-label line at 12 words or fewer', () => {
    for (const key of ALL_KEYS) {
      if (EXEMPT_60_KEYS.has(key) || PANEL_BODY_KEYS.has(key)) continue
      for (const text of allTexts(key)) {
        expect(wordCount(text), `${key}: "${text}"`).toBeLessThanOrEqual(12)
      }
    }
  })

  it('keeps every panel-body line at 30 words or fewer', () => {
    for (const key of PANEL_BODY_KEYS) {
      for (const text of allTexts(key)) {
        expect(wordCount(text), `${key}: "${text}"`).toBeLessThanOrEqual(30)
      }
    }
  })

  it('exempts guard.why, guard.restricted and guard.banned — full-screen policy surfaces — at 60 words', () => {
    for (const key of EXEMPT_60_KEYS) {
      for (const text of allTexts(key)) {
        expect(wordCount(text), `${key}: "${text}"`).toBeLessThanOrEqual(60)
      }
    }
  })
})

describe('voice rule 2 — "bro" is a flavour, not a tic', () => {
  const BRO = /\bbro\b/i
  const BRO_BANNED_KEYS = ALL_KEYS.filter(
    (key) => key.startsWith('guard.') || key === 'error.offline' || key === 'error.save' || key === 'error.load',
  )

  it('never appears more than once in a single line', () => {
    for (const key of ALL_KEYS) {
      for (const text of allTexts(key)) {
        const count = (text.match(new RegExp(BRO, 'gi')) ?? []).length
        expect(count, `${key}: "${text}"`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is banned from every guard.* key and every system-caused error', () => {
    for (const key of BRO_BANNED_KEYS) {
      for (const text of allTexts(key)) {
        expect(BRO.test(text), `${key}: "${text}"`).toBe(false)
      }
    }
  })
})

describe('voice rule 3 — never opens with "Your "', () => {
  it('holds for every shipped line', () => {
    for (const key of ALL_KEYS) {
      for (const text of allTexts(key)) {
        expect(text.startsWith('Your '), `${key}: "${text}"`).toBe(false)
      }
    }
  })
})

describe('voice rule 4 — no emoji anywhere', () => {
  it('holds for every shipped line, extending the repo-wide check to src/lib/voice', () => {
    for (const key of ALL_KEYS) {
      for (const text of allTexts(key)) {
        expect(EMOJI.test(text), `${key}: "${text}"`).toBe(false)
      }
    }
  })
})

describe('voice rule 5 — name the cause, then the next step, in that order', () => {
  // Every fail / error.* / guard.* line — variants AND fallbacks (fix round
  // 1, I11: the fallback is production copy too, and it is exactly where
  // C1/I2 hid) — manually classified: the substring naming what happened,
  // and the substring saying what happens next or what to do. Both must be
  // present, cause before step. A few lines are single-clause or
  // reassurance-shaped, where the instruction/reassurance itself doubles as
  // the "step" half — noted inline.
  const CAUSE_THEN_STEP: Array<{ key: LineKey; text: string; cause: string; step: string }> = [
    { key: 'fail', text: "Not this time. Let's look at what broke.", cause: 'Not this time', step: "Let's look at what broke" },
    { key: 'fail', text: 'Tests disagree. Take another pass.', cause: 'Tests disagree', step: 'Take another pass' },
    { key: 'fail', text: "That one didn't land. Which is literally what this is for.", cause: "didn't land", step: 'literally what this is for' },
    { key: 'error.offline', text: "No connection. Your code still runs — we just can't save it yet.", cause: 'No connection', step: "we just can't save it yet" },
    { key: 'error.save', text: "That didn't save. Your result stands; we'll retry.", cause: "didn't save", step: "we'll retry" },
    { key: 'error.save', text: 'Save failed. The result is real; retrying.', cause: 'Save failed', step: 'retrying' },
    { key: 'error.save', text: "Couldn't reach the server. Holding it, trying again.", cause: "Couldn't reach the server", step: 'trying again' },
    { key: 'error.load', text: "Couldn't load that. Try again.", cause: "Couldn't load that", step: 'Try again' },
    { key: 'guard.paste', text: 'Paste is off on this screen. Type it out.', cause: 'Paste is off', step: 'Type it out' },
    { key: 'guard.paste', text: 'Blocked. Typing is the exercise.', cause: 'Blocked', step: 'Typing is the exercise' },
    { key: 'guard.paste', text: "Paste won't work here. Type it.", cause: "Paste won't work here", step: 'Type it' },
    // Single clause: the instruction is both the cause (paste is off) and the step (use the keyboard).
    { key: 'guard.paste', text: 'Keyboard only on this screen.', cause: 'Keyboard only', step: 'on this screen' },
    { key: 'guard.paste.why', text: 'Paste is off because typing is the exercise, and because it is the one thing browsers actually let us enforce, so we do.', cause: 'Paste is off', step: 'typing is the exercise' },
    { key: 'guard.blur', text: 'Paused — the window lost focus. Come back to pick it up.', cause: 'the window lost focus', step: 'Come back to pick it up' },
    { key: 'guard.blur', text: "Work's held right here. Click back in when you're ready.", cause: "Work's held right here", step: "Click back in when you're ready" },
    // Reassurance stands in for the step: nothing to do because nothing broke.
    { key: 'guard.blur', text: 'Paused. Nothing was lost.', cause: 'Paused', step: 'Nothing was lost' },
    { key: 'guard.idle', text: 'Quiet for a bit, so we paused. Type anything to keep going.', cause: 'so we paused', step: 'Type anything to keep going' },
    { key: 'guard.idle', text: 'Still here, still yours. Jump back in whenever.', cause: 'Still here, still yours', step: 'Jump back in whenever' },
    { key: 'guard.idle', text: 'Paused after a quiet stretch. Any key resumes.', cause: 'Paused after a quiet stretch', step: 'Any key resumes' },
    { key: 'guard.printscreen', text: "Screenshots aren't something a website can block. We log the attempt and move on.", cause: "Screenshots aren't something a website can block", step: 'We log the attempt and move on' },
    { key: 'guard.why', text: "Paste is the one thing browsers actually let us stop, so we stop it. Leaving the tab and pressing PrintScreen are signals we log, not things we can prevent. Screenshots can't be prevented by anyone. The real backstop is that your exercises aren't the same as anyone else's.", cause: 'Paste is the one thing browsers actually let us stop', step: "The real backstop is that your exercises aren't the same as anyone else's" },
    { key: 'guard.warned', text: "Heads up: flags crossed 10 in the last 7 days. Nothing is paused. Here's exactly what counted.", cause: 'flags crossed 10 in the last 7 days', step: "Here's exactly what counted" },
    { key: 'guard.restricted', text: 'Reps are paused for 24 hours. Flags crossed 20 in the last 7 days — here is the arithmetic. Reps come back at {time}; dashboard, walkthroughs and De-rot stay open.', cause: 'Flags crossed 20 in the last 7 days', step: 'Reps come back at {time}' },
    { key: 'guard.restricted', text: 'Reps are paused for 24 hours. Flags crossed 20 in the last 7 days. Dashboard, walkthroughs and De-rot stay open.', cause: 'Flags crossed 20 in the last 7 days', step: 'Dashboard, walkthroughs and De-rot stay open' },
    { key: 'guard.restricted.paste', text: 'Reps are paused for 24 hours. Paste was blocked 5 times in one rep — an automatic rule that fires at exactly 5, for everyone. Back at {time}.', cause: 'Paste was blocked 5 times in one rep', step: 'Back at {time}' },
    { key: 'guard.restricted.paste', text: 'Reps are paused for 24 hours. Paste was blocked 5 times in one rep — an automatic rule that fires at exactly 5, for everyone.', cause: 'Paste was blocked 5 times in one rep', step: 'an automatic rule that fires at exactly 5, for everyone' },
    { key: 'guard.banned', text: "This account is banned. Flags crossed 40 in the last 7 days. The weights: 3 for a PrintScreen attempt, 2 for a blocked paste or copy, 1 for leaving the tab. The lines are 10, 20 and 40, the same for everyone. If this is wrong, contact Velocity through your invitation email; we'll read the actual log, not the number.", cause: 'Flags crossed 40 in the last 7 days', step: 'contact Velocity through your invitation email' },
  ]

  it('matches every fail / error.* / guard.* line actually shipped in the bank, fallbacks included', () => {
    const shipped = new Set<string>()
    for (const key of ALL_KEYS) {
      if (key === 'fail' || key.startsWith('error.') || key.startsWith('guard.')) {
        for (const text of allTexts(key)) shipped.add(`${key}::${text}`)
      }
    }
    const classified = new Set(CAUSE_THEN_STEP.map((c) => `${c.key}::${c.text}`))
    expect(classified).toEqual(shipped)
  })

  it('names the cause before the next step in every classified line', () => {
    for (const { key, text, cause, step } of CAUSE_THEN_STEP) {
      expect(text.includes(cause), `${key} missing cause "${cause}" in "${text}"`).toBe(true)
      expect(text.includes(step), `${key} missing step "${step}" in "${text}"`).toBe(true)
      expect(text.indexOf(cause), `${key}: cause must precede step in "${text}"`).toBeLessThan(text.indexOf(step))
    }
  })
})

describe('voice rule 6 — rotation is enforced by frequency class', () => {
  const HOT_KEYS = new Set<LineKey>([
    'pass', 'fail', 'hint', 'chain.tick', 'lesson.check.right', 'lesson.check.wrong',
    'guard.paste', 'guard.blur', 'guard.idle', 'derot.run.done', 'loading.runtime', 'error.save',
  ])

  it('marks exactly the launch hot list as hot, nothing more, nothing less', () => {
    const actual = new Set(ALL_KEYS.filter((key) => LINE_BANK[key].frequency === 'hot'))
    expect(actual).toEqual(HOT_KEYS)
  })

  it('gives every hot key at least three variants', () => {
    for (const key of HOT_KEYS) {
      expect(LINE_BANK[key].variants.length, key).toBeGreaterThanOrEqual(3)
    }
  })

  it('never returns the same variant twice in a row, for every key with more than one variant (no seed)', () => {
    const sampleVars: Record<string, string | number> = { n: 3, m: 2, skill: 'loops', time: '9:00 AM', name: 'Python', contact: 'support@brogram.dev' }
    for (const key of ALL_KEYS) {
      if (LINE_BANK[key].variants.length < 2) continue
      let previous: string | null = null
      for (let i = 0; i < 300; i += 1) {
        const text = lineWith(key, sampleVars)
        if (previous !== null) expect(text, key).not.toBe(previous)
        previous = text
      }
    }
  })

  it('is uniform (not biased toward one neighbour) with no seed, fix round 1 I9', () => {
    // The earlier `pickIndex` deterministically bumped to `previous + 1`,
    // which gave that one neighbour a 50-67% share depending on variant
    // count. Over many transitions the *marginal* distribution across all
    // variants should now be close to uniform.
    const tally = new Map<string, number>()
    let previous: string | null = null
    for (let i = 0; i < 12000; i += 1) {
      const text = line('fail')
      if (previous !== null) tally.set(text, (tally.get(text) ?? 0) + 1)
      previous = text
    }
    const counts = [...tally.values()]
    expect(counts.length).toBe(3)
    const total = counts.reduce((a, b) => a + b, 0)
    for (const count of counts) {
      expect(count / total).toBeGreaterThan(0.22) // expected ~0.33; old bug gave one line ~0.67 and another ~0
      expect(count / total).toBeLessThan(0.44)
    }
  })

  it('is deterministic when a seed is given — the same seed always picks the same variant', () => {
    for (let i = 0; i < 20; i += 1) {
      const seed = `learner-${i}`
      const first = line('guard.paste', seed)
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(line('guard.paste', seed)).toBe(first)
      }
    }
  })

  it('is uniform across variants when driven by many different seeds — safe for SSR', () => {
    const tally = new Map<string, number>()
    const seedCount = 20000
    for (let i = 0; i < seedCount; i += 1) {
      const text = line('guard.paste', `render-${i}`)
      tally.set(text, (tally.get(text) ?? 0) + 1)
    }
    expect(tally.size).toBe(4)
    for (const count of tally.values()) {
      expect(count / seedCount).toBeGreaterThan(0.2) // expected exactly 0.25
      expect(count / seedCount).toBeLessThan(0.3)
    }
  })
})

describe('voice rule 7 — no internal vocabulary reaches a learner', () => {
  const BANNED = ['outcome', 'CLO', 'mastery', 'chain', 'pattern']
  const DIFFICULTY_N_OF_5 = /difficulty\s+\d\s+of\s+5/i

  it('never uses outcome, CLO, mastery, chain, pattern, or "difficulty N of 5"', () => {
    for (const key of ALL_KEYS) {
      for (const text of allTexts(key)) {
        for (const word of BANNED) {
          expect(new RegExp(`\\b${word}\\b`, 'i').test(text), `${key} contains "${word}": "${text}"`).toBe(false)
        }
        expect(DIFFICULTY_N_OF_5.test(text), `${key}: "${text}"`).toBe(false)
      }
    }
  })
})

describe('voice rule 8 — enforcement tone is flat', () => {
  const GUARD_KEYS = ALL_KEYS.filter((key) => key.startsWith('guard.'))
  const PRAISE_WORDS = ['nice', 'awesome', 'great job', 'amazing', 'love it', 'nailed it', 'crushed it']

  it('has no exclamation marks, no bro, and no second-person praise on any guard.* line', () => {
    for (const key of GUARD_KEYS) {
      for (const text of allTexts(key)) {
        expect(text.includes('!'), `${key}: "${text}"`).toBe(false)
        expect(/\bbro\b/i.test(text), `${key}: "${text}"`).toBe(false)
        for (const praise of PRAISE_WORDS) {
          expect(text.toLowerCase().includes(praise), `${key}: "${text}"`).toBe(false)
        }
      }
    }
  })
})

describe('voice rule 9 — English only, no institution names', () => {
  // Straight/curly quotes, em/en dash, and basic Latin punctuation are the
  // full character set the bank needs; anything outside it is either a
  // typo or a non-English script.
  const ALLOWED = /^[a-zA-Z0-9\s.,;:'"’‘“”\-—–!?{}()&%]*$/
  // "Velocity" is the maker's own brand (spec §10 footer: "Built by
  // Velocity"; also the existing `AccountNotice.tsx:7` appeal copy) — not a
  // learner's institution, so it is deliberately not on this list.
  const INSTITUTION_NAMES = ['UDST', 'University', 'Qatar', 'College']

  it('uses only English characters and standard punctuation', () => {
    for (const key of ALL_KEYS) {
      for (const text of allTexts(key)) {
        expect(ALLOWED.test(text), `${key}: "${text}"`).toBe(true)
      }
    }
  })

  it('never names an institution', () => {
    for (const key of ALL_KEYS) {
      for (const text of allTexts(key)) {
        for (const name of INSTITUTION_NAMES) {
          expect(text.includes(name), `${key}: "${text}"`).toBe(false)
        }
      }
    }
  })
})

describe('LineKey coverage', () => {
  it('has exactly one bank entry per declared key, no more, no fewer', () => {
    // 55 at T2.7a, +5 from T2.7b's sweep: achievement.collapsed (the
    // collapsed trophy-shelf announcement) and the four De-rot Playground
    // run-summary tiers (derot.play.best/sharp/solid/rough).
    expect(ALL_KEYS.length).toBe(60)
  })
})

describe('lineWith interpolation', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('substitutes every provided variable', () => {
    const text = lineWith('chain.tick', { n: 2 })
    expect(text).not.toMatch(/\{/)
    expect(text).toContain('2')
  })

  it('throws when a required variable is missing outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(() => lineWith('chain.tick', {})).toThrow(/missing variable/i)
  })

  it('renders the plain fallback instead of a literal placeholder in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const text = lineWith('chain.tick', {})
    expect(text).not.toMatch(/\{/)
    expect(text.length).toBeGreaterThan(0)
  })

  it('never leaves a placeholder in any key that declares a fallback', () => {
    vi.stubEnv('NODE_ENV', 'production')
    for (const key of ALL_KEYS) {
      if (!LINE_BANK[key].fallback) continue
      for (let i = 0; i < 20; i += 1) {
        expect(lineWith(key, {})).not.toMatch(/\{/)
      }
    }
  })

  it('guard.banned needs no variable at all — the appeal channel is a baked-in constant (fix round 1, I2)', () => {
    // If this ever throws, someone reintroduced an interpolation slot on
    // the one screen where a missing variable cannot be recovered from.
    expect(() => line('guard.banned')).not.toThrow()
    expect(line('guard.banned')).toContain('Velocity')
  })
})

describe('passLine — the honest zero-hint variant', () => {
  it('only ever offers "Done. Zero hints on that one." when hintCount is 0', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(passLine(1)).not.toBe('Done. Zero hints on that one.')
      expect(passLine(3)).not.toBe('Done. Zero hints on that one.')
    }
  })

  it('can offer the zero-hint variant when hintCount is 0', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) seen.add(passLine(0))
    expect(seen.has('Done. Zero hints on that one.')).toBe(true)
  })

  it('is deterministic when given a seed', () => {
    const first = passLine(0, 'seed-x')
    for (let i = 0; i < 5; i += 1) expect(passLine(0, 'seed-x')).toBe(first)
  })
})

describe('line() basic sanity', () => {
  it('returns a non-empty string for every key whose variants never need a variable', () => {
    for (const key of ALL_KEYS) {
      const needsVars = LINE_BANK[key].variants.some((v) => /\{[^}]+\}/.test(v))
      if (needsVars) continue // these keys are lineWith's job; line() may legitimately throw on them
      for (let i = 0; i < 10; i += 1) {
        expect(typeof line(key)).toBe('string')
        expect(line(key).length).toBeGreaterThan(0)
      }
    }
  })
})
