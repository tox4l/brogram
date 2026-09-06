'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SendIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import type { AgentError, BuddyReply } from '@/lib/contracts'
import { streamAgent } from '@/lib/agents/client'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { type BuddyMessage, buddyStateSlice, capMessages, REFUSAL, suggestionHref, suggestionLabel } from './state'

const isAgentError = (value: unknown): value is AgentError =>
  Boolean(value) && typeof value === 'object' && (value as AgentError).ok === false

export function BuddyDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const user = useSession(session => session.user)
  const learnerState = useSession(session => session.learnerState)
  const clientRef = useRef<SupabaseClient | null>(null)
  const loadedRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<BuddyMessage[]>([])
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [partial, setPartial] = useState<Partial<BuddyReply> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || loadedRef.current || !user) return
    loadedRef.current = true
    void (async () => {
      const client = (clientRef.current ??= createClient())
      const { data } = await client
        .from('buddy_messages')
        .select('id,role,content,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)
      const rows = [...(data ?? [])].reverse()
      setMessages(rows.map(row => ({ id: String(row.id), role: row.role === 'assistant' ? 'assistant' : 'user', content: String(row.content), createdAt: String(row.created_at) })))
    })()
  }, [open, user])

  useEffect(() => {
    if (!sending && open) inputRef.current?.focus()
  }, [sending, open])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, partial])

  async function send() {
    const content = value.trim()
    if (!content || sending || !user || !learnerState) return
    setError(null)
    const userMessage: BuddyMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt: new Date().toISOString() }
    const nextMessages = capMessages([...messages, userMessage])
    setMessages(nextMessages)
    setValue('')
    setSending(true)
    setPartial(null)
    const client = (clientRef.current ??= createClient())
    try { await client.from('buddy_messages').insert({ user_id: user.id, role: 'user', content }) }
    catch { /* Best-effort persistence; the conversation still works in-memory. */ }
    const last6 = nextMessages.slice(-6).map(message => ({ role: message.role, content: message.content }))
    try {
      const envelope = await streamAgent(
        { agent: 'buddy', trigger: 'buddy-message', messages: last6, state: buddyStateSlice(learnerState) },
        received => setPartial(received),
      )
      const reply = envelope.reply
      const onTopic = reply.onTopic
      const text = onTopic ? reply.reply : REFUSAL
      const assistantMessage: BuddyMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: text,
        createdAt: new Date().toISOString(),
        suggestion: onTopic ? reply.suggestion : undefined,
      }
      setMessages(previous => capMessages([...previous, assistantMessage]))
      try { await client.from('buddy_messages').insert({ user_id: user.id, role: 'assistant', content: text }) }
      catch { /* Best-effort persistence; the conversation still works in-memory. */ }
    } catch (agentError) {
      setError(isAgentError(agentError) ? agentError.message : 'Something went wrong. Try again.')
    } finally {
      setPartial(null)
      setSending(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const streamingText = partial?.onTopic === false ? REFUSAL : partial?.reply ?? ''
  const showCursor = sending && partial?.onTopic !== false

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent className="inset-y-0 right-0 left-auto h-dvh w-full max-w-[min(24rem,100%)] rounded-none border-l border-border bg-background sm:max-w-sm">
        <DrawerHeader className="flex-row items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <DrawerTitle>Your coding Buddy</DrawerTitle>
            <DrawerDescription>Coding and improvement only.</DrawerDescription>
          </div>
          <DrawerClose render={<Button variant="ghost" size="icon-sm" />}>
            <XIcon />
            <span className="sr-only">Close</span>
          </DrawerClose>
        </DrawerHeader>
        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {messages.length === 0 && !sending && (
            <p className="text-sm leading-relaxed text-muted-foreground">Ask about the code you are stuck on, or why a pattern keeps failing.</p>
          )}
          {messages.map(message => (
            <div key={message.id} data-testid="buddy-message" className={cn('flex flex-col gap-2', message.role === 'user' ? 'items-end' : 'items-start')}>
              <div className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap', message.role === 'user' ? 'bg-muted text-foreground' : 'bg-popover text-popover-foreground ring-1 ring-border')}>
                {message.content}
              </div>
              {message.suggestion && (
                <Link href={suggestionHref(message.suggestion.kind, message.suggestion.ref)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {suggestionLabel(message.suggestion.kind)}
                </Link>
              )}
            </div>
          ))}
          {sending && (
            <div className="flex flex-col items-start gap-2">
              <div className="max-w-[85%] rounded-lg bg-popover px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-popover-foreground ring-1 ring-border">
                {streamingText}
                {showCursor && <span aria-hidden="true" className="ml-0.5 inline-block animate-pulse">▍</span>}
              </div>
            </div>
          )}
          {error && <p role="status" className="text-xs text-muted-foreground">{error}</p>}
        </div>
        <form
          className="flex shrink-0 items-end gap-2 border-t border-border p-4"
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
            className="min-h-16 w-full min-w-0 resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button type="submit" size="icon" disabled={sending || !value.trim()} aria-label="Send">
            <SendIcon />
          </Button>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
