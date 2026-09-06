/**
 * The timing law as values, so review can be mechanical (R7.9 sits on top of
 * this: every animating component reads `useReducedMotion()`, but the
 * numbers a component animates *toward* come from here, not a magic number
 * inline). GSAP timelines, Motion `transition`s, and raw CSS all read the
 * same constants.
 */
export const DUR = {
  /** A pressed-state flash — button press, checkbox tick. */
  instant: 100,
  /** Hover/focus affordances, small state flips. */
  fast: 150,
  /** The default for most enter/exit and layout moves. */
  base: 200,
  /** A drawer, a panel expand, anything with real distance to cover. */
  slow: 320,
  /** Reward-tier moments only: pass confetti, level-up, streak ignite. */
  celebration: 700,
} as const

/** No `ease-in` values in this table (R7.9): everything either starts fast
 *  and settles (`standard`, `enter`) or moves with a game-ish snap (`move`,
 *  `drawer`) — an ease-in reads as sluggish, exactly the complaint this
 *  system exists to fix. */
export const EASE = {
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  enter: 'cubic-bezier(0.22, 1, 0.36, 1)',
  move: 'cubic-bezier(0.25, 1, 0.5, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const

/** Motion's spring preset for mount/unmount and layout animation. */
export const SPRING = { duration: 0.5, bounce: 0.2 } as const

/** Stagger step and cap for list/badge entrances. */
export const STAGGER = { step: 40, max: 300 } as const
