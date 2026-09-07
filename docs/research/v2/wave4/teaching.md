<!-- Wave 4 research lane, compiled 2026-09-07. Copied verbatim from the lane agent's report. -->

> **Lane:** teaching. **Date:** 2026-09-07. **Status:** research input, not a decision.
> **Scope.** The guide that moves through code as a learner reads it: what the tree already does, what the evidence supports, and the component contract.
> **Decisions taken from it** live in `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md`;
> where this file and that spec disagree, **the spec wins** and says why.
>
> **Primary sources**
> - Schneider, Beege, Nebel & Rey 2018, Educational Research Review — 103 studies, N = 12,201, signalling g+ = 0.53 retention
> - Alpizar, Adesope et al. 2020, ETR&D — 44 effect sizes, 29 studies, 2,726 participants
> - Xie et al., JCAL — eye-movement modelling examples meta-analysis (25 articles); Bednarik et al., Koli Calling 2018
> - arXiv 2605.04868 — 120 CS undergraduates; teacher- and learner-initiated EMME beat automated triggering
> - Margulieux, Catrambone & Guzdial 2016 — subgoal grouping and labelling; Busjahn et al., ICPC 2015 — novices read code linearly
> - Cambridge Handbook of Multimedia Learning ch. 15 (split attention) and ch. 21 (transient information)
> - developer.mozilla.org — aria-current, prefers-reduced-motion ("removed or replaced")
> - Local measurement: 52 worked blocks across seed/lessons (216 steps, 4.15 mean, 50 of 52 monotonic), LessonSnippet.highlight authored and never rendered

---
# Wave 4 — Dynamic teaching visuals for reading code

Lane: the guide that moves through code as a learner reads it.
Scope: presentation only. No route change, no runtime change, no contract change.

## 1. What is already in the tree (measured, not assumed)

`src/components/lesson/WorkedBlock.tsx` already ships a working guide: a plain `<pre>` (no CodeMirror, no tokenizer, no editor chunk), a fixed 24 px `LINE_HEIGHT_PX`, and one absolutely-positioned band moved with `transform: translateY() scaleY()` on `var(--ease-move)` at 200 ms, suppressed when `reduced` is true. That is the correct skeleton and the correct cost. The work below refines it; it does not replace it.

Measured across the 32 files in `seed/lessons/` (script run for this report):

- 52 `worked` blocks; mean 4.15 steps (min 3, max 5); mean 13.0 code lines (min 5, max 20).
- 216 steps total: 142 single-line, 74 range. Mean `say` length 15.4 words (max 20).
- **50 of 52 blocks step monotonically down the file.** The 2 exceptions are both `INFS2201-3` (SQL) with starts `[6, 4, 10, 14]` — a deliberate teach of clause evaluation order.
- 0 blocks contain a tab; 0 contain a non-ASCII character; 0 step line refs are out of range **but nothing checks that** — `scripts/verify-lesson.mjs` verifies snippets, `predict-output`, `micro-code`, `spot-the-bug` and `fill-blank` only. `worked` is unverified.
- Only 2 of 216 `say` strings contain a backticked token.
- `LessonSnippet.highlight` exists in `src/lib/contracts.ts` and in `seed/lessons/lesson.schema.json`, is authored once in seed, and **`SnippetBlock.tsx` never renders it.** Authored-and-dropped.

## 2. What the evidence supports

**Signalling works and is the single best-evidenced move here.** Schneider, Beege, Nebel & Rey's meta-analysis (103 studies, N = 12,201) puts signalling at g = .52 for retention (95% CI [.44, .60]) and g = .31 for transfer, with cognitive load significantly reduced ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1747938X17300581), [LearnTechLib](https://www.learntechlib.org/p/204443/)). Highlighting the line the sentence is about is signalling.

**Keeping the sentence beside the code is the split-attention fix.** Mayer & Moreno's dual-processing account and the spatial-contiguity meta-analysis both say integration cost falls when referent and words are not separated ([Cambridge Handbook ch. 15](https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/splitattention-principle-in-multimedia-learning/194CBCD1A3C911116CCB5F403AC7E415), [Educ Psych Rev](https://link.springer.com/article/10.1007/s10648-018-9435-9)). BroGram stacks the callouts *below* the code block; the band is the compensating link. Without it this is a split-attention design.

**Guiding attention through code specifically has direct evidence.** Xie et al.'s meta-analysis of eye-movement modelling examples (25 articles) reports d = −0.83 on time-to-first-fixation, d = 0.74 on fixation duration and d = 0.43 on cognitive performance ([JCAL](https://onlinelibrary.wiley.com/doi/abs/10.1111/jcal.12568)); Bednarik et al. ran it in a code-comprehension classroom ([Koli Calling](https://dl.acm.org/doi/10.1145/3279720.3279722)).

**Learner-advance beats auto-advance — measured.** A 2026 study of 120 CS undergraduates on Python debugging compared teacher-initiated, learner-initiated and automatically-triggered EMME scaffolds: all three beat control, but *human-mediated initiation (teacher or learner) consistently outperformed automated triggering*, and automated triggering produced disruptive, mistimed delivery ([arXiv 2605.04868](https://arxiv.org/abs/2605.04868)). This is corroborated by the transient information effect — replaced information must be held in working memory, so learner-paced segments beat a running animation ([Cambridge Handbook ch. 21](https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/transient-information-principle-in-multimedia-learning/670D96C3B9520320CE558AA855A49EE9)). It also keeps WCAG 2.2.2 Pause/Stop/Hide out of scope entirely: nothing auto-updates for more than five seconds, so no pause control is owed ([W3C](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html)).

**Reading order, not execution order.** Busjahn et al. found code is not read linearly and that experts backtrack far more than novices ([PDF](https://huang.isis.vanderbilt.edu/cs8395/paper/linear-order-eye.pdf)); Peitek et al. found reading order is driven by semantics rather than layout ([PDF](https://www.se.cs.uni-saarland.de/publications/docs/PSA20.pdf)). The seed data agrees: 50/52 blocks are a reading-order tour. A Python Tutor–style execution trace with a variables pane ([Guo, SIGCSE 2013](https://www.semanticscholar.org/paper/641cb912e58c54e8c8e1a741c2df8d5341a4a487); [pythontutor.com](https://pythontutor.com/visualize.html)) and Bret Victor's "show the data" argument ([Learnable Programming](http://worrydream.com/LearnableProgramming/)) are both right and both out of scope for a pure-presentation pass: they need a stepping interpreter, which is a runtime change.

**Fading is the long-game move, not this wave's.** Guidance fading and the expertise-reversal effect say the guide should thin out as the learner improves ([Instructional Science](https://link.springer.com/article/10.1023/B:TRUC.0000021815.74806.f6), [Salden et al.](http://www.cee.uma.pt/ron/Salden%20et%20al.%20-%20The%20Expertise%20Reversal%20Effect%20and%20Worked%20Examples.pdf)). Recorded as a non-goal with a hook, below.

## 3. Interaction design rulings

**Band, not arrow.** A floating arrow occludes and needs a leader line; a tint band covers a range (74 of 216 steps *are* ranges) and reads at any zoom. The premium detail is a 2 px vertical **rail** at the left edge of the band — that is the "guide" the eye tracks — plus the tint. Do not keep a ring around the band: the current `ring-1 ring-inset` is scaled by `scaleY(n)`, so on a 3-line step the 1 px top and bottom edges render at 3 px. A borderless tint plus a rail is both undistorted under scale and more deliberate-looking.

**Line-level by default, token-level opt-in with no contract change.** If a step's `say` contains exactly one backticked span, resolve that literal string on the step's line range and draw a 2 px underline beneath it; otherwise stay line-level. Column geometry is free here because the block is monospace: `x = 16px + col * 1ch`, `width = len * 1ch`. No tokenizer, no syntax highlighting, no bundle. Safe because seed contains zero tabs and zero non-ASCII in `worked` code; the verifier enforces that going forward.

**No CodeMirror in `worked`.** Decorations (`Decoration.line`, `StateEffect`, a `StateField` with `provide: f => EditorView.decorations.from(f)`, dispatched via `view.dispatch({effects: ...})` — [decoration example](https://codemirror.net/examples/decoration/), [Fox's line-highlight extension](http://blog.pamelafox.org/2022/07/line-highlighting-extension-for-code.html)) update without remounting and are the right tool *when an editor already exists*. They are the wrong tool for `worked`, which pays no editor cost today. Reserve them for a future guided `micro-code`.

**GSAP is not needed and should not be used here.** CSS `transition: transform` on `var(--ease-move)` covers it, retargets mid-flight when a learner clicks fast (keyframes and tweens restart from zero), and — relevant to the MIT constraint — GSAP ships under Webflow's proprietary "Standard No Charge" licence, not MIT or any OSI licence ([gsap.com](https://gsap.com/community/standard-license/)). Every asset this lane adds is first-party CSS.

## 4. Accessibility

`aria-current="step"` on the active callout is the exact semantic ([MDN](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current)). The band is `aria-hidden` and always will be, so a screen-reader user gets no location unless the step text carries it: prefix each callout with a visually-hidden "Step 2 of 4, lines 3 to 5." Reduced motion means *reduce non-essential motion*, not remove animation ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)) — the band still **moves to the new lines**, it just arrives with `transition: none`. Losing the position under reduced motion would delete the teaching, not the motion.

## Recommendations

1. **Extract `src/components/lesson/CodeGuide.tsx`.** Props: `{ code: string; language: Language; active: GuideSpan | null; passive?: GuideSpan[]; reduced: boolean; label: string; idPrefix: string }`, where `GuideSpan = { line: number | [number, number]; token?: string }`. `WorkedBlock` passes `active`; `SnippetBlock` passes `passive`. Test: rendering with `active: null` produces no band element.
2. **Replace the ringed band with tint + rail.** Two absolutely-positioned children, both `transform`-only: a `bg-primary/12` box and a 2 px `bg-primary` rail at `left: 8px`. Drop `ring-1 ring-inset`. Test: computed style of the band contains no `border-width` and no `box-shadow`; a snapshot at `scaleY(3)` has uniform edges.
3. **Keep 200 ms / `var(--ease-move)` (`DUR.base`, `EASE.move` from `src/lib/motion/tokens.ts`).** Test: the transition string is `transform 200ms var(--ease-move)` and never contains `all`, `top`, `height` or `ease-in`.
4. **Token-level guide derived from a single backticked span in `say`.** Resolve the literal on the step's line range; draw a 2 px underline at `left: calc(16px + Nch)`, `width: calc(Mch)`, animated with `translateX` + `scaleX` from a shared origin. Fall back to line-level when there is no backtick or no unique match. Test: a step whose `say` is ``Printing `.alt.length` proves…`` renders an underline whose left offset equals the column index; a step with a non-matching backtick renders none and does not throw.
5. **Never auto-advance.** No timer, no `setInterval`, no autoplay flag on any lesson block ([arXiv 2605.04868](https://arxiv.org/abs/2605.04868)). Test: grep the lesson component directory for `setInterval|setTimeout` in advance paths returns nothing.
6. **Reduced motion sets `transition: none` and nothing else.** The band's target position and the token underline are identical in both modes. Test: with `useReducedMotion()` true, the band's `transform` after step 3 equals the value produced with it false.
7. **Render `LessonSnippet.highlight`** as a static, non-stepping `passive` tint at 60 % of the active band's alpha, applied on block enter. This closes an authored-but-dropped contract field. Test: a snippet with `highlight: [[2,3]]` renders one passive band; a snippet without it renders none.
8. **Add `worked` and `snippet.highlight` validation to `scripts/verify-lesson.mjs`:** every `line` / `highlight` range is within `code.split('\n').length` and has `start <= end`; `code` contains no tab and no non-ASCII character; any backticked span in `say` occurs exactly once within its own line range. Test: a fixture lesson with a step pointing at line 99 of an 11-line block exits 1.
9. **Add `aria-current="step"` to the active callout and a visually-hidden "Step N of M, line(s) X to Y." prefix on every callout.** Test: `getByText` on the step sentence has an ancestor with `aria-current="step"`; the accessible name of the active callout starts with "Step".
10. **Block kinds that get the guide:** `worked` (stepped), `snippet` (passive only). **Not** `predict-output`, **not** `spot-the-bug` before an answer (it would give away `bugLines`), **not** `micro-code`, **not** the learner's editor, **not** `PromptPanel` (its fenced code is markdown with no line data). Test: the walkthrough test file asserts no band element inside a `spot-the-bug` check's pre-answer DOM.
11. **Non-goals, recorded with a hook, not built:** execution-trace playback with a variables pane (needs a stepping interpreter — runtime change), and guidance fading keyed to learner state (needs `LessonProgress` reads in a presentation component). `CodeGuide`'s `active: null` is the seam both would use later.
12. **Owner ruling needed before building:** a "Previous step" control. Backtracking is what real code readers do ([Busjahn et al.](https://huang.isis.vanderbilt.edu/cs8395/paper/linear-order-eye.pdf)) and the block currently offers no way back, but adding a control is a behaviour change and therefore outside "pure UI and UX". Do not ship it unasked.
