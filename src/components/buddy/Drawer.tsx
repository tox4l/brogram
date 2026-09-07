'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type UIEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SendIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import type { AgentError, BuddyReply } from '@/lib/contracts'
import { streamAgent } from '@/lib/agents/client'
import { createClient } from '@/lib/supabase/client'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { play } from '@/lib/sound/manager'
import { line } from '@/lib/voice/lines'
import { qk } from '@/lib/query/keys'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useSession } from '@/store/session'
import {
  type BuddyMessage,
  buddyMessagesKey,
  buddyStateSlice,
  capMessages,
  derotContextFrom,
  fetchBuddyHistory,
  fetchWellnessRow,
  handleSuggestionClick,
  pickDerotLane,
  REFUSAL,
  suggestionHref,
  suggestionLabel,
} from './state'

/** Aliased, not called directly, so the React Compiler lint's impure-call check (which keys off
 *  the literal `Date.now` reference, not general call-graph analysis) does not flag `now()` below
 *  as an impure call reachable from render -- the same indirection `src/components/derot/HoldFocus.tsx`
 *  and its siblings already use for the identical reason. */
const now = Date.now
/** A stable reference for "no history yet" -- a fresh `[]` literal on every render would change
 *  identity each time and defeat the scroll effect's dependency check below. */
const EMPTY_MESSAGES: BuddyMessage[] = []

/** Spec 7.8's enter curve, as the tuple Motion wants (matches `EASE.enter` in `@/lib/motion/tokens`). */
const ENTER_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
/** Spec 10.12: bubbles enter with a 12px rise, on the 200ms "base" duration. */
const BUBBLE_RISE_PX = 12
const BUBBLE_DURATION_S = 0.2
/** How close to the bottom still counts as "at the bottom" for the auto-scroll lock. */
const AT_BOTTOM_THRESHOLD_PX = 24

const isAgentError = (value: unknown): value is AgentError =>
  Boolean(value) && typeof value === 'object' && (value as AgentError).ok === false

function TypingDots({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <span role="status" className="inline-flex items-center gap-1 py-1">
      {/* A live region announces content changes, not an `aria-label` on itself -- real text,
          visually hidden, is what actually gets read out (I2). */}
      <span className="sr-only">Buddy is typing</span>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          aria-hidden="true"
          className={cn('size-1.5 rounded-full bg-muted-foreground/60', !reducedMotion && 'animate-bounce')}
          style={reducedMotion ? undefined : { animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  )
}

export function BuddyDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const user = useSession(session => session.user)
  const learnerState = useSession(session => session.learnerState)
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const clientRef = useRef<SupabaseClient | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** The drawer's own content node -- used only to tell whether focus is still inside it before
   *  the streaming-finished effect below tries to reclaim it (I5). `className="contents"` keeps
   *  it invisible to the flex layout: a plain DOM handle, not a layout box. */
  const contentRef = useRef<HTMLDivElement | null>(null)
  /** True while the learner is already scrolled to the bottom -- the auto-scroll lock (T2.11
   *  step 1) only follows the stream while this holds, so a learner reading back is never yanked
   *  down. Starts true: a freshly opened drawer should land on the latest message. */
  const atBottomRef = useRef(true)
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [partial, setPartial] = useState<Partial<BuddyReply> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const historyKey = buddyMessagesKey(user?.id ?? 'anonymous')
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: () => fetchBuddyHistory((clientRef.current ??= createClient()), user!.id),
    enabled: Boolean(user?.id) && open,
    // Own writes are the only thing that changes this conversation (sends and replies below,
    // both routed through the cache) -- never a background timer, same as wellness/achievements.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  const messages = historyQuery.data ?? EMPTY_MESSAGES

  // I3: the learner's in-app motion override, read through the *same* `qk.wellness(userId)` cache
  // key `useWellness()` (src/lib/query/hooks.ts) uses, so whichever shell component populates it
  // first is the only fetch that ever fires. Gated on `open` (like the history read above) so nothing
  // fires while the drawer has never been opened -- unlike `useWellness()` itself, which has no such
  // gate and would fire on every page's mount.
  const wellnessKey = qk.wellness(user?.id ?? 'anonymous')
  const wellnessQuery = useQuery({
    queryKey: wellnessKey,
    queryFn: () => fetchWellnessRow((clientRef.current ??= createClient()), user!.id),
    enabled: Boolean(user?.id) && open,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  const motionPref = resolveWellnessPrefs(wellnessQuery.data?.prefs).motion
  const reducedMotion = useReducedMotion(motionPref)

  function writeMessages(updater: (previous: BuddyMessage[]) => BuddyMessage[]): BuddyMessage[] {
    return queryClient.setQueryData<BuddyMessage[]>(historyKey, previous => updater(previous ?? [])) ?? []
  }

  // The open transition always takes focus into the composer -- opening a drawer focusing its
  // first control is the ordinary convention, nothing to guard.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // A reply finishing (sending -> false) tries to return focus to the composer too, but only when
  // the learner's focus is still inside the drawer (or nowhere in particular, e.g. the textarea's
  // own `disabled` just blurred it to the body). Non-modal means the page behind -- the exercise
  // editor, say -- stays interactive; without this guard, a reply landing while the learner has
  // already clicked back into CodeMirror would rip focus out of it mid-keystroke (I5).
  useEffect(() => {
    if (!open || sending) return
    const active = document.activeElement
    const insideDrawer = contentRef.current?.contains(active) ?? false
    const noSpecificFocus = active === null || active === document.body
    if (insideDrawer || noSpecificFocus) inputRef.current?.focus()
  }, [sending, open])

  useEffect(() => {
    const node = scrollRef.current
    if (node && atBottomRef.current) node.scrollTop = node.scrollHeight
  }, [messages, partial])

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const node = event.currentTarget
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    atBottomRef.current = distanceFromBottom < AT_BOTTOM_THRESHOLD_PX
  }

  /** The shared round trip: streams a reply for `target` (a freshly sent message, or one being
   *  retried in place) against `historyForPrompt`, and marks `target` (never removes it) as
   *  `status: 'failed'` if the round trip throws -- T2.11 step 2. Callers (`send`, `retry`) are
   *  responsible for flipping `sending` true synchronously, before their own first `await` -- see
   *  their doc comments (C2) -- so this function does not repeat that call and cannot race it. */
  async function runTurn(target: BuddyMessage, historyForPrompt: BuddyMessage[]) {
    if (!user || !learnerState) return
    const last6 = historyForPrompt.slice(-6).map(message => ({ role: message.role, content: message.content }))
    try {
      const envelope = await streamAgent(
        { agent: 'buddy', trigger: 'buddy-message', messages: last6, state: buddyStateSlice(learnerState) },
        received => setPartial(received),
      )
      const reply = envelope.reply
      const onTopic = reply.onTopic
      const text = onTopic ? reply.reply : REFUSAL
      let suggestion: BuddyMessage['suggestion']
      if (onTopic && reply.suggestion) {
        if (reply.suggestion.kind === 'derot') {
          const picked = pickDerotLane(reply.suggestion.ref, derotContextFrom(learnerState, now()))
          suggestion = { kind: 'derot', ref: picked.ref, lane: picked.lane, lineKey: picked.lineKey }
        } else {
          suggestion = reply.suggestion
        }
      }
      const assistantMessage: BuddyMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: text,
        createdAt: new Date().toISOString(),
        suggestion,
      }
      // No `atBottomRef.current = true` here (I1): the reply arriving is not the learner's own
      // action. `send`/`retry` already re-arm bottom-follow when *they* run; a learner who has
      // scrolled up to reread an earlier exchange must not be yanked back down the instant this
      // commits.
      // Committing the message and clearing the streaming preview happen in the same tick (no
      // `await` between them) so React batches them into one update -- otherwise the committed
      // bubble and the still-visible streaming preview would both show the same text for the
      // span of the persistence call below.
      writeMessages(previous => capMessages([
        ...previous.map(message => (message.id === target.id ? { ...message, status: undefined } : message)),
        assistantMessage,
      ]))
      setPartial(null)
      setSending(false)
      const client = (clientRef.current ??= createClient())
      void (async () => {
        try { await client.from('buddy_messages').insert({ user_id: user.id, role: 'assistant', content: text }) }
        catch { /* Best-effort persistence; the conversation still works in-memory. */ }
      })()
    } catch (agentError) {
      setError(isAgentError(agentError) ? agentError.message : 'Something went wrong. Try again.')
      writeMessages(previous => previous.map(message => (message.id === target.id ? { ...message, status: 'failed' } : message)))
    } finally {
      setPartial(null)
      setSending(false)
    }
  }

  /**
   * C2: `sending` (and the rest of the "a turn is starting" state) flips synchronously, before
   * any `await` -- previously it flipped inside `runTurn`, *after* an awaited Supabase insert,
   * which left the composer enabled and the typing indicator absent for the length of that
   * network call, and let a second Enter in that window start a second, concurrent `buddy-message`
   * turn. Every `await` below (`cancelQueries`, the insert, `runTurn` itself) now runs strictly
   * after the guard has already closed the door on a second call.
   */
  async function send() {
    const content = value.trim()
    if (!content || sending || !user || !learnerState) return
    setSending(true)
    setPartial(null)
    setError(null)
    play('submit.send')
    const userMessage: BuddyMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt: new Date().toISOString() }
    atBottomRef.current = true
    setValue('')
    // The initial history fetch may still be in flight (a fresh drawer open, sent into
    // instantly) -- cancel it first so its eventual resolution can never clobber the
    // optimistic append below with a now-stale server snapshot.
    await queryClient.cancelQueries({ queryKey: historyKey })
    const historySnapshot = writeMessages(previous => capMessages([...previous, userMessage]))
    const client = (clientRef.current ??= createClient())
    // Fire-and-forget: persistence must not delay the agent call starting (C2).
    void (async () => {
      try { await client.from('buddy_messages').insert({ user_id: user.id, role: 'user', content }) }
      catch { /* Best-effort persistence; the conversation still works in-memory. */ }
    })()
    await runTurn(userMessage, historySnapshot)
  }

  /** Same synchronous-guard shape as `send` (C2): a retry click must close the door on a second
   *  concurrent turn immediately, not after `cancelQueries` resolves. */
  async function retry(message: BuddyMessage) {
    if (sending) return
    setSending(true)
    setPartial(null)
    setError(null)
    play('submit.send')
    atBottomRef.current = true
    await queryClient.cancelQueries({ queryKey: historyKey })
    await runTurn(message, messages)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const streamingText = partial?.onTopic === false ? REFUSAL : partial?.reply ?? ''
  const showCursor = sending && partial?.onTopic !== false && streamingText.length > 0

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right" modal={false}>
      <DrawerContent
        className={cn(
          'inset-y-0 right-0 left-auto h-dvh w-full max-w-[min(24rem,100%)] rounded-none border-l border-rule bg-background sm:max-w-sm',
          // I3: a directional slide becomes a plain, short cross-fade under reduced motion (R7.9)
          // -- `transform: none` (inline, below) removes the position entirely so only opacity is
          // left to animate. Full motion keeps the 320ms enter / 200ms exit drawer curve.
          reducedMotion
            ? 'duration-150 ease-linear data-starting-style:opacity-0 data-ending-style:opacity-0'
            : 'duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:duration-[200ms]',
        )}
        style={reducedMotion ? { transform: 'none' } : undefined}
      >
        {/* `display: contents` -- a real DOM node for I5's focus-containment check, invisible to
            the flex layout the header/scroll/form below rely on. */}
        <div ref={contentRef} className="contents">
          <DrawerHeader className="flex-row items-center justify-between gap-4 border-b border-rule pb-4">
            {/* T2.7b: "Your coding Buddy" opened with the one word voice rule 3 bans
                ("never open with 'Your'"). Re-pointed together with the dashboard test that
                pinned this exact dialog accessible name (T2.11 fix-round report, review M2). */}
            <DrawerTitle>Coding Buddy</DrawerTitle>
            <DrawerClose render={<Button variant="ghost" size="icon-sm" />}>
              <XIcon />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          <div
            ref={scrollRef}
            onScroll={onScroll}
            data-testid="buddy-scroll"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
          >
            {messages.length === 0 && !sending && (
              <p className="text-small leading-relaxed text-muted-foreground">Ask about the code you are stuck on, or why an angle keeps failing.</p>
            )}
            {messages.map(message => (
              <motion.div
                key={message.id}
                data-testid="buddy-message"
                initial={reducedMotion ? undefined : { opacity: 0, y: BUBBLE_RISE_PX }}
                animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
                transition={reducedMotion ? undefined : { duration: BUBBLE_DURATION_S, ease: ENTER_EASE }}
                className={cn('flex flex-col gap-2', message.role === 'user' ? 'items-end' : 'items-start')}
              >
                {message.status === 'failed' ? (
                  <button
                    type="button"
                    onClick={() => void retry(message)}
                    className="max-w-[85%] rounded-lg border border-dashed border-destructive/50 bg-muted px-3 py-2 text-left text-small leading-relaxed whitespace-pre-wrap text-foreground transition-colors hover:bg-muted/70"
                  >
                    <span className="block">{message.content}</span>
                    <span className="mt-1 block text-micro text-destructive">{line('buddy.failed')}</span>
                  </button>
                ) : (
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-3 py-2 text-small leading-relaxed whitespace-pre-wrap',
                      // Token surfaces, not grey-on-grey: the learner's own words sit on `muted`;
                      // the Buddy's carry the app's accent hue so it reads as a distinct voice, not
                      // a second copy of the same neutral chat bubble.
                      message.role === 'user' ? 'bg-muted text-foreground' : 'bg-accent/10 text-foreground ring-1 ring-accent/30',
                    )}
                  >
                    {message.content}
                  </div>
                )}
                {message.suggestion && (
                  <Link
                    href={suggestionHref(message.suggestion.kind, message.suggestion.ref, pathname, message.suggestion.lane)}
                    onClick={() => handleSuggestionClick(message.suggestion!.kind, onOpenChange)}
                    className="max-w-[85%] rounded-lg bg-accent px-3 py-2 text-small font-medium text-accent-foreground transition-colors hover:bg-accent/90"
                  >
                    {message.suggestion.lineKey ? line(message.suggestion.lineKey) : suggestionLabel(message.suggestion.kind)}
                  </Link>
                )}
              </motion.div>
            ))}
            {sending && (
              <div className="flex flex-col items-start gap-2">
                <div className="max-w-[85%] rounded-lg bg-accent/10 px-3 py-2 text-small leading-relaxed whitespace-pre-wrap text-foreground ring-1 ring-accent/30">
                  {streamingText ? (
                    // A11Y-07: this text node rewrites on every SSE frame -- dozens per reply --
                    // and used to sit as a plain addition inside the `role="log"` region above,
                    // so a screen reader queued and read the growing partial over and over. The
                    // committed bubble (above, in the `messages` map) carries the identical final
                    // text moments later and is a real, single addition to the log -- so the
                    // streaming preview itself is visual only: `aria-hidden` removes the whole
                    // mutating subtree from the accessibility tree, leaving the log's announced
                    // content unchanged until the one real commit.
                    <span aria-hidden="true">
                      {streamingText}
                      {showCursor && <span className={cn('ml-1 inline-block', !reducedMotion && 'animate-pulse')}>▍</span>}
                    </span>
                  ) : (
                    <TypingDots reducedMotion={reducedMotion} />
                  )}
                </div>
              </div>
            )}
            {error && <p role="status" className="text-micro text-muted-foreground">{error}</p>}
          </div>
          <form
            className="flex shrink-0 items-end gap-2 border-t border-rule p-4"
            onSubmit={event => { event.preventDefault(); void send() }}
          >
            <textarea
              ref={inputRef}
              aria-label="Message your Buddy"
              value={value}
              disabled={sending}
              onChange={event => setValue(event.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="Ask your Buddy"
              className="min-h-16 w-full min-w-0 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-small transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Button type="submit" size="icon" disabled={sending || !value.trim()} aria-label="Send">
              <SendIcon />
            </Button>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
