'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { redirect, useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { callAgent } from '@/lib/agents/client'
import { createClient } from '@/lib/supabase/client'
import { provisionalProfile } from '@/lib/onboarding/derive'
import { QUESTIONS } from '@/lib/onboarding/questions'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { useSession } from '@/store/session'
import { mergeProfileDelta, messageOf, writeLearnerState } from './lib'

/**
 * The chosen option gets a fill before the card exits (spec 10.2). This is deliberate local
 * choreography, not a busy state: nothing here waits on data, so it never violates "no busy state
 * between cards, ever" (R4.2) — the next card's content is already known synchronously.
 */
const OPTION_FILL_MS = 120

// Motion needs a numeric bezier tuple; these mirror EASE.move / EASE.standard in
// src/lib/motion/tokens.ts, which stores the CSS-string form for raw CSS/GSAP consumers.
const MOVE_EASE: [number, number, number, number] = [0.25, 1, 0.5, 1]
const STANDARD_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]
const CARD_DURATION = 0.2 // DUR.base, in seconds

type Answer = { questionId: string; answer: string }

export default function Onboarding() {
  const session = useSession()
  const router = useRouter()
  const reducedMotion = useReducedMotion()

  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const fillTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (fillTimeout.current) clearTimeout(fillTimeout.current)
  }, [])

  // The only irreducible wait in this flow is the background Profiler call, and it never blocks
  // the UI: the course picker is already showing by the time it starts (spec R4.3).
  const finishOnboarding = useCallback((finalAnswers: Answer[]) => {
    const learnerState = session.learnerState
    router.push('/courses')
    if (!learnerState) return

    const provisional = provisionalProfile(finalAnswers)
    session.setLearnerState({ ...learnerState, profile: { ...learnerState.profile, ...provisional } })

    void (async () => {
      let finalProfile = provisional
      try {
        const envelope = await callAgent({
          agent: 'profiler',
          trigger: 'onboarding-answer',
          phase: 2,
          answers: finalAnswers,
          state: { userId: learnerState.userId, version: learnerState.version, profile: { ...provisional, displayName: learnerState.profile.displayName } },
        })
        // `fallback: true` means the route never reached a live model reply (AGENT_DRY_RUN, or
        // DeepSeek failed twice); the provisional profile stands rather than merging a delta that
        // was never actually decided by the model (spec R4.2.5).
        if (!envelope.fallback) finalProfile = mergeProfileDelta(provisional, envelope.reply.profileDelta)
      } catch {
        // network failure, timeout, or rate-limited: the provisional profile stands.
      }
      try {
        const supabase = createClient()
        const nextState = await writeLearnerState(supabase, learnerState, (base) => ({
          ...base,
          profile: { ...base.profile, ...finalProfile, onboardingComplete: true },
        }))
        session.setLearnerState(nextState)
      } catch (writeError) {
        // Nothing left on screen to show this to — the learner already moved on to /courses.
        console.error('[onboarding] could not persist onboardingComplete:', messageOf(writeError))
      }
    })()
  }, [router, session])

  const selectOption = useCallback((value: string) => {
    if (selected !== null) return
    setSelected(value)
    const finalAnswers = [...answers, { questionId: QUESTIONS[index].id, answer: value }]
    fillTimeout.current = setTimeout(() => {
      if (index + 1 < QUESTIONS.length) {
        setAnswers(finalAnswers)
        setIndex(index + 1)
        setSelected(null)
      } else {
        finishOnboarding(finalAnswers)
      }
    }, reducedMotion ? 0 : OPTION_FILL_MS)
  }, [answers, finishOnboarding, index, reducedMotion, selected])

  if (!session.user?.id) return null
  if (session.learnerState?.profile.onboardingComplete) {
    redirect('/courses')
    return null
  }

  const question = QUESTIONS[index]
  const slideVariants = reducedMotion
    ? { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }
    : { enter: { x: 24, opacity: 0 }, center: { x: 0, opacity: 1 }, exit: { x: -24, opacity: 0 } }

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-10">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Question {index + 1} of {QUESTIONS.length}</p>
        <div role="img" aria-label={`Question ${index + 1} of ${QUESTIONS.length}`} className="flex gap-1.5">
          {QUESTIONS.map((q, i) => (
            <span
              key={q.id}
              aria-hidden="true"
              className={`h-1.5 flex-1 rounded-full transition-colors motion-reduce:transition-none ${i <= index ? 'bg-emerald-300' : 'bg-muted'}`}
            />
          ))}
        </div>
      </div>
      <AnimatePresence initial={false}>
        <motion.div
          key={question.id}
          initial="enter"
          animate="center"
          exit="exit"
          variants={slideVariants}
          transition={{ duration: CARD_DURATION, ease: MOVE_EASE }}
          className="space-y-8"
        >
          <h1 className="max-w-xl text-2xl font-medium leading-relaxed tracking-tight">{question.text}</h1>
          <div role="group" aria-label="Choose one" className="grid gap-3 sm:grid-cols-2">
            {question.options.map((option, i) => (
              <button
                key={option.value}
                type="button"
                autoFocus={i === 0}
                disabled={selected !== null}
                aria-pressed={selected === option.value}
                onClick={() => selectOption(option.value)}
                className={`relative overflow-hidden rounded-xl border border-border bg-card p-5 text-left text-sm font-medium leading-relaxed outline-none transition-colors hover:border-emerald-300 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-default motion-reduce:transition-none ${selected !== null && selected !== option.value ? 'opacity-50' : ''}`}
              >
                {!reducedMotion && selected === option.value && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 bg-emerald-300/30"
                    style={{ transformOrigin: 'left' }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: OPTION_FILL_MS / 1000, ease: STANDARD_EASE }}
                  />
                )}
                <span className="relative">{option.label}</span>
              </button>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
