import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { describe, it, expect } from 'vitest'
import type { AgentName } from '@/lib/contracts'
import { AGENT_TOKEN_BUDGETS } from '@/lib/contracts'
import { modules } from './index'
import { approxTokens } from './shared'

const SPEC: Record<AgentName, string> = {
  profiler: '01-profiler',
  planner: '02-planner',
  author: '03-author',
  diagnoser: '04-diagnoser',
  coach: '05-coach',
  reviewer: '06-reviewer',
  buddy: '07-buddy',
}

/** The prompt is the first fenced block under "## System prompt (static)". */
function specPrompt(file: string) {
  const md = readFileSync(`docs/prompts/agents/${file}.md`, 'utf8').replace(/\r\n/g, '\n')
  const after = md.split('## System prompt (static)')[1]
  return after.split('```')[1].replace(/^\n/, '').replace(/\n$/, '')
}

/** Everything below the identity paragraph is a hard rule; T2.10 rewrote only the first paragraph. */
const identityParagraph = (system: string) => system.split('\n\n')[0]

const BANNED_IDENTITY_PATTERNS = [/^You are the BroGram/, /\bas an AI\b/i, /\blanguage model\b/i, /\bDeepSeek\b/i]

/** Top-level field names of the agent's reply schema (zod 4 keeps `.shape` even through `.refine()`). */
const replyKeys = (agent: AgentName) => Object.keys((modules[agent].schema as unknown as z.ZodObject).shape)

describe('system prompts', () => {
  it.each(Object.keys(SPEC) as AgentName[])('%s matches its spec file word for word', agent => {
    expect(modules[agent].system).toBe(specPrompt(SPEC[agent]))
  })

  it('every prompt contains the word json, because DeepSeek json mode requires it', () => {
    for (const agent of Object.keys(SPEC) as AgentName[]) {
      expect(modules[agent].system, agent).toContain('json')
    }
  })

  it('every identity paragraph speaks in the Bro voice, not the old institutional framing', () => {
    for (const agent of Object.keys(SPEC) as AgentName[]) {
      const identity = identityParagraph(modules[agent].system)
      for (const pattern of BANNED_IDENTITY_PATTERNS) expect(identity, `${agent}: ${pattern}`).not.toMatch(pattern)
    }
  })

  it("every reply schema's top-level field names are named in its own prompt", () => {
    for (const agent of Object.keys(SPEC) as AgentName[]) {
      for (const key of replyKeys(agent)) expect(modules[agent].system, `${agent}.${key}`).toContain(key)
    }
  })

  it('no prompt grew past its token budget', () => {
    for (const agent of Object.keys(SPEC) as AgentName[]) {
      expect(approxTokens(modules[agent].system), agent).toBeLessThan(AGENT_TOKEN_BUDGETS[agent])
    }
  })
})
