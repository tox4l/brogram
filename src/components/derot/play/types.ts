import type { DrillKind } from '@/lib/contracts'
export type PlayGameId = Extract<DrillKind, 'follow-the-dot' | 'color-nback' | 'reaction' | 'rhythm' | 'breathe' | 'memory-grid'>
export interface PlayGameResult { raw: number; payload: Record<string, unknown> }
export interface PlayGameProps {
  timeLimitS: number
  soundOn: boolean
  reducedMotion: boolean
  onComplete(result: PlayGameResult): void
  onAbort(): void
}
export type PlayGameComponent = React.ComponentType<PlayGameProps>
