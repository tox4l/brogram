import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { AgentName } from '@/lib/contracts'
import { modules } from './index'

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

describe('system prompts', () => {
  it.each(Object.keys(SPEC) as AgentName[])('%s matches its spec file word for word', agent => {
    expect(modules[agent].system).toBe(specPrompt(SPEC[agent]))
  })

  it('every prompt contains the word json, because DeepSeek json mode requires it', () => {
    for (const agent of Object.keys(SPEC) as AgentName[]) {
      expect(modules[agent].system, agent).toContain('json')
    }
  })
})
