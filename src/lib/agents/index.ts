import type { AgentName, AgentRequest } from '@/lib/contracts'
import type { AgentModule } from './shared'
import { profiler } from './profiler'
import { planner } from './planner'
import { author } from './author'
import { diagnoser } from './diagnoser'
import { coach } from './coach'
import { reviewer } from './reviewer'
import { buddy } from './buddy'

export const modules: Record<AgentName, AgentModule<AgentRequest, unknown>> = {
  profiler,
  planner,
  author,
  diagnoser,
  coach,
  reviewer,
  buddy,
}
