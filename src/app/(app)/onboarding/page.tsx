'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { redirect, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import type { LearnerProfile, LearnerState } from '@/lib/contracts'
import { callAgent } from '@/lib/agents/client'
import { createClient } from '@/lib/supabase/client'
import { clearQueuedCompletion, queueCompletion, readQueuedCompletion } from '@/lib/onboarding/completionQueue'
import { provisionalProfile } from '@/lib/onboarding/derive'
import { QUESTIONS } from '@/lib/onboarding/questions'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { qk } from '@/lib/query/keys'
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

/** Wave 1 gate finding I3: one short pause before retrying a failed completing write. */
const COMPLETION_RETRY_DELAY_MS = 1500
const COMPLETION_SYNC_NOTICE = 'Saved on this device. We will sync when the connection is back.'
const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

type Answer = { questionId: string; answer: string }

export default function Onboarding() {
  const session = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()
  const reducedMotion = useReducedMotion()

  const userId = session.user?.id ?? null
  // A locally-queued completion means a previous session's completing write never confirmed as
  // landed (Wave 1 gate I3): this account is not re-asked and the Profiler is not asked again
  // regardless of what the server row currently says. Read during render — synchronous,
  // side-effect-free from React's own perspective — so the question flow never paints even for a
  // frame; the actual retry happens in the effect below.
  const queuedProfile = userId ? readQueuedCompletion(userId) : null

  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const fillTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => {
    if (fillTimeout.current) clearTimeout(fillTimeout.current)
  }, [])

  const question = QUESTIONS[index]

  // Focus lands on the card, not stolen into an option button, so the heading is announced
  // before any option and the viewport does not jump to scroll a button into view (fix round 1,
  // Minor M6).
  useEffect(() => {
    cardRef.current?.focus()
  }, [question.id])

  // Retries a queued completion on the next time this page mounts, before any redirect decision
  // is acted on — never calls the Profiler; only re-attempts the write (Wave 1 gate I3).
  useEffect(() => {
    if (!userId || !queuedProfile) return
    const learnerState = session.learnerState
    if (!learnerState) return
    router.push('/courses')
    void (async () => {
      try {
        const supabase = createClient()
        const nextState = await writeLearnerState(supabase, learnerState, (base) => ({
          ...base,
          profile: { ...base.profile, ...queuedProfile, onboardingComplete: true },
        }))
        session.setLearnerState(nextState)
        queryClient.setQueryData(qk.learnerState(userId), nextState)
        clearQueuedCompletion(userId)
      } catch {
        // still queued; the next mount tries again. No notice here — the learner already saw
        // one, if the original session's own retry also failed.
      }
    })()
    // Runs once per mount against whatever queue entry existed when this component first
    // rendered; a queue that appears later (this session's own failure path, below) is handled
    // by that path directly, not by this effect re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The only irreducible wait in this flow is the background Profiler refinement, and it never
  // blocks the UI: the course picker is already showing by the time it starts (spec R4.3).
  const finishOnboarding = useCallback((finalAnswers: Answer[]) => {
    const learnerState = session.learnerState
    if (!learnerState) return // nothing to mark complete or write; navigating away would strand the flag

    const provisional = provisionalProfile(finalAnswers)
    const completeProfile = (profile: LearnerProfile): LearnerProfile => ({ ...profile, ...provisional, onboardingComplete: true })

    // Mark complete instantly, client-side (fix round 1, Critical C1): a reload, a Back press,
    // or a remount before either write below lands must never re-ask all six questions or fire a
    // second Profiler call. Both the session store and the query cache /courses reads from (fix
    // round 1, Important I2) get the completed profile up front, before navigating.
    const optimisticState: LearnerState = { ...learnerState, profile: completeProfile(learnerState.profile) }
    session.setLearnerState(optimisticState)
    queryClient.setQueryData(qk.learnerState(learnerState.userId), optimisticState)
    router.push('/courses')

    void (async () => {
      const supabase = createClient()

      // Persist onboardingComplete now, started in parallel with the Profiler call below rather
      // than after it settles: a non-streamed DeepSeek round trip can take 5-30s, and gating the
      // write on it left a long window where a reload or tab close lost the whole profile. On
      // failure, retry once after a short delay (Wave 1 gate I3); if that also fails, the session
      // flag set above is never reverted (so this session is never re-asked), and the compiled
      // profile is queued to localStorage so the next time this page mounts — even after a
      // reload that lost everything above — the write is retried before any redirect decision,
      // and the Profiler is never asked again for this account.
      const attemptCompletionWrite = () =>
        writeLearnerState(supabase, learnerState, (base) => ({ ...base, profile: completeProfile(base.profile) }))
      const persisted = (async () => {
        let nextState: LearnerState | null = null
        try {
          nextState = await attemptCompletionWrite()
        } catch {
          await delay(COMPLETION_RETRY_DELAY_MS)
          try {
            nextState = await attemptCompletionWrite()
          } catch (secondError) {
            console.error('[onboarding] could not persist onboardingComplete after a retry:', messageOf(secondError))
          }
        }
        if (nextState) {
          session.setLearnerState(nextState)
          queryClient.setQueryData(qk.learnerState(learnerState.userId), nextState)
          clearQueuedCompletion(learnerState.userId)
        } else {
          queueCompletion(learnerState.userId, optimisticState.profile)
          toast(COMPLETION_SYNC_NOTICE)
        }
      })()

      try {
        const envelope = await callAgent({
          agent: 'profiler',
          trigger: 'onboarding-answer',
          phase: 2,
          answers: finalAnswers,
          state: { userId: learnerState.userId, version: learnerState.version, profile: { ...provisional, displayName: learnerState.profile.displayName } },
        })
        // `fallback: true` means the route never reached a live model reply (AGENT_DRY_RUN, or
        // DeepSeek failed twice); the completed provisional profile stands rather than merging a
        // delta that was never actually decided by the model (spec R4.2.5).
        if (!envelope.fallback) {
          // Re-derives the completed profile from whatever `base` the read returns rather than
          // depending on `persisted` having landed first, so this write is correct regardless of
          // which of the two lands second (both are version-guarded and retry on a lost race).
          const nextState = await writeLearnerState(supabase, learnerState, (base) => {
            const complete = completeProfile(base.profile)
            return { ...base, profile: { ...complete, ...mergeProfileDelta(complete, envelope.reply.profileDelta) } }
          })
          session.setLearnerState(nextState)
          queryClient.setQueryData(qk.learnerState(learnerState.userId), nextState)
          clearQueuedCompletion(learnerState.userId)
        }
      } catch {
        // network failure, timeout, or rate-limited: the completed provisional profile stands.
      }
      await persisted
    })()
  }, [queryClient, router, session])

  const selectOption = useCallback((value: string) => {
    if (selected !== null) return
    const finalAnswers = [...answers, { questionId: question.id, answer: value }]
    const commit = () => {
      if (index + 1 < QUESTIONS.length) {
        setAnswers(finalAnswers)
        setIndex(index + 1)
        setSelected(null)
      } else {
        finishOnboarding(finalAnswers)
      }
    }
    if (reducedMotion) { commit(); return } // no deferred tick under reduced motion (fix round 1, Minor M5)
    setSelected(value)
    fillTimeout.current = setTimeout(commit, OPTION_FILL_MS)
  }, [answers, finishOnboarding, index, question.id, reducedMotion, selected])

  if (!userId) return null
  if (session.learnerState?.profile.onboardingComplete) {
    redirect('/courses')
    return null
  }
  // A queued completion from a previous session: the retry effect above navigates and retries
  // the write; never render a question while one exists (Wave 1 gate I3).
  if (queuedProfile) return null

  const slideVariants = reducedMotion
    ? { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }
    : { enter: { x: 24, opacity: 0 }, center: { x: 0, opacity: 1 }, exit: { x: -24, opacity: 0 } }

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-10">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Question {index + 1} of {QUESTIONS.length}</p>
        <div aria-hidden="true" className="flex gap-1.5">
          {QUESTIONS.map((q, i) => (
            <span
              key={q.id}
              className={`h-1.5 flex-1 rounded-full transition-colors motion-reduce:transition-none ${i <= index ? 'bg-emerald-300' : 'bg-muted'}`}
            />
          ))}
        </div>
      </div>
      <AnimatePresence initial={false}>
        <motion.div
          key={question.id}
          ref={cardRef}
          tabIndex={-1}
          initial="enter"
          animate="center"
          exit="exit"
          variants={slideVariants}
          transition={{ duration: CARD_DURATION, ease: MOVE_EASE }}
          className="space-y-8 outline-none"
        >
          <h1 className="max-w-xl text-2xl font-medium leading-relaxed tracking-tight">{question.text}</h1>
          <div role="radiogroup" aria-label="Choose one" className="grid gap-3 sm:grid-cols-2">
            {question.options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                disabled={selected !== null}
                aria-checked={selected === option.value}
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
