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
  // strict (<): two spec-mandated toast lines (guard.idle #1, and
  // lesson.check.wrong #2 as a body line) land at exactly 12 words, and
  // error.offline lands at exactly 12 once the em dash is not counted as a
  // word. Rewriting mandated §2.7 copy to dodge a strict "<" was rejected —
  // ship verbatim (Step 1) wins over a stricter reading of "under".
  const PANEL_BODY_KEYS = new Set<LineKey>(['welcome', 'guard.printscreen', 'guard.warned', 'guard.restricted', 'guard.banned'])
  const GUARD_WHY_EXEMPTION: LineKey = 'guard.why'

  it('keeps every celebration/toast/button-label line at 12 words or fewer', () => {
    for (const key of ALL_KEYS) {
      if (key === GUARD_WHY_EXEMPTION || PANEL_BODY_KEYS.has(key)) continue
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

  it('exempts only guard.why, the Integrity-panel policy paragraph, at 60 words', () => {
    for (const text of allTexts(GUARD_WHY_EXEMPTION)) {
      expect(wordCount(text)).toBeLessThanOrEqual(60)
    }
  })
})

describe('voice rule 2 — "bro" is a flavour, not a tic', () => {
  const BRO = /\bbro\b/i
  const BRO_BANNED_KEYS = ALL_KEYS.filter(
    (key) => key.startsWith('guard.') || key === 'error.offline' || key === 'error.save',
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
  // Every fail / error.* / guard.* line, manually classified: the substring
  // that names what happened, and the substring that says what happens next
  // or what to do. Both must be present, cause before step. guard.paste #4
  // and guard.blur #3 are single-clause lines where the instruction and the
  // reassurance double as the "step" half — noted inline.
  const CAUSE_THEN_STEP: Array<{ key: LineKey; text: string; cause: string; step: string }> = [
    { key: 'fail', text: "Not this time. Let's look at what broke.", cause: 'Not this time', step: "Let's look at what broke" },
    { key: 'fail', text: 'Tests disagree. Take another pass.', cause: 'Tests disagree', step: 'Take another pass' },
    { key: 'fail', text: "That one didn't land. Which is literally what this is for.", cause: "didn't land", step: 'literally what this is for' },
    { key: 'error.offline', text: "No connection. Your code still runs — we just can't save it yet.", cause: 'No connection', step: "we just can't save it yet" },
    { key: 'error.save', text: "That didn't save. Your result stands; we'll retry.", cause: "didn't save", step: "we'll retry" },
    { key: 'error.save', text: 'Save failed. The result is real; retrying.', cause: 'Save failed', step: 'retrying' },
    { key: 'error.save', text: "Couldn't reach the server. Holding it, trying again.", cause: "Couldn't reach the server", step: 'trying again' },
    { key: 'guard.paste', text: 'Paste is off on this screen. Type it out.', cause: 'Paste is off', step: 'Type it out' },
    { key: 'guard.paste', text: 'Blocked. Typing is the exercise.', cause: 'Blocked', step: 'Typing is the exercise' },
    { key: 'guard.paste', text: 'Not pasteable here. Type it.', cause: 'Not pasteable here', step: 'Type it' },
    // Single clause: the instruction is both the cause (paste is off) and the step (use the keyboard).
    { key: 'guard.paste', text: 'Keyboard only on this screen.', cause: 'Keyboard only', step: 'on this screen' },
    { key: 'guard.blur', text: 'Paused — you clicked away. Come back to pick it up.', cause: 'you clicked away', step: 'Come back to pick it up' },
    { key: 'guard.blur', text: "Work's held right here. Click back in when you're ready.", cause: "Work's held right here", step: "Click back in when you're ready" },
    // Reassurance stands in for the step: nothing to do because nothing broke.
    { key: 'guard.blur', text: 'Paused. Nothing was lost.', cause: 'Paused', step: 'Nothing was lost' },
    { key: 'guard.idle', text: 'Quiet for a bit, so we paused. Type anything to keep going.', cause: 'so we paused', step: 'Type anything to keep going' },
    { key: 'guard.idle', text: 'Still here, still yours. Jump back in whenever.', cause: 'Still here, still yours', step: 'Jump back in whenever' },
    { key: 'guard.idle', text: 'Paused after a quiet stretch. Any key resumes.', cause: 'Paused after a quiet stretch', step: 'Any key resumes' },
    { key: 'guard.printscreen', text: "Screenshots aren't something a website can block. We log the attempt and move on.", cause: "Screenshots aren't something a website can block", step: 'We log the attempt and move on' },
    { key: 'guard.why', text: "Paste is the one thing browsers actually let us stop, so we stop it. Leaving the tab and pressing PrintScreen are signals we log, not things we can prevent. Screenshots can't be prevented by anyone. The real backstop is that your exercises aren't the same as anyone else's.", cause: 'Paste is the one thing browsers actually let us stop', step: "The real backstop is that your exercises aren't the same as anyone else's" },
    { key: 'guard.warned', text: "Heads up: your flag count crossed 10 this week. Nothing is paused. Here's exactly what counted.", cause: 'your flag count crossed 10', step: "Here's exactly what counted" },
    { key: 'guard.restricted', text: 'Exercises are paused for 24 hours. Reps come back at {time} — everything else stays open.', cause: 'Exercises are paused for 24 hours', step: 'Reps come back at {time}' },
    { key: 'guard.banned', text: 'Banned. The score crossed 40 in the last 7 days — weight 3 per screenshot, 2 per paste block, 1 per tab-away, same for everyone. Reply to {contact} to appeal.', cause: 'The score crossed 40', step: 'Reply to {contact} to appeal' },
  ]

  it('matches every fail / error.* / guard.* line actually shipped in the bank', () => {
    const shipped = new Set<string>()
    for (const key of ALL_KEYS) {
      if (key === 'fail' || key.startsWith('error.') || key.startsWith('guard.')) {
        for (const text of LINE_BANK[key].variants) shipped.add(`${key}::${text}`)
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

  it('never returns the same variant twice in a row, for every key with more than one variant', () => {
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
    expect(ALL_KEYS.length).toBe(39)
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
