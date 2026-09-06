'use client'

import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DEFAULT_WELLNESS, type WellnessPrefs } from '@/lib/contracts'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { setEnabled as setSoundEnabled, setVolume as setSoundVolume } from '@/lib/sound/manager'
import { useSession } from '@/store/session'

interface WellnessRow {
  prefs: Partial<WellnessPrefs> | null
}

/**
 * One icon button in the shell header — not buried in settings, mirrored on
 * the Account page. Default **on**: nothing can play before the first
 * gesture anyway, so defaulting on costs nothing (T0.5 step 5).
 *
 * Writes straight through to `wellness.prefs.sound`, the same table
 * `Rail` already reads and writes, and syncs the sound manager's master
 * gate so a click takes effect immediately rather than on next reload.
 */
export function SoundToggle() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const [enabled, setEnabled] = useState(DEFAULT_WELLNESS.sound.enabled)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      try {
        const client = createClient()
        const { data, error } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
        if (cancelled) return
        if (error) throw error
        const prefs = resolveWellnessPrefs((data as WellnessRow | null)?.prefs)
        setEnabled(prefs.sound.enabled)
        setSoundEnabled(prefs.sound.enabled)
        setSoundVolume(prefs.sound.volume)
      } catch {
        // Falls back to the default (on); the manager already starts enabled.
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  async function toggle() {
    const next = !enabled
    setEnabled(next)
    setSoundEnabled(next)
    if (!userId) return
    try {
      const client = createClient()
      const { data } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
      const current = resolveWellnessPrefs((data as WellnessRow | null)?.prefs)
      const nextPrefs: WellnessPrefs = { ...current, sound: { ...current.sound, enabled: next } }
      // The row normally already exists (created on signup), so a plain
      // update is the common case; insert once as a fallback if it somehow does not.
      const { data: updated } = await client
        .from('wellness')
        .update({ prefs: nextPrefs, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .select('user_id')
        .maybeSingle()
      if (!updated) await client.from('wellness').insert({ user_id: userId, prefs: nextPrefs })
    } catch {
      // Best-effort; the manager and local state already reflect the change.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={enabled}
      aria-label={enabled ? 'Mute sound' : 'Unmute sound'}
      onClick={() => void toggle()}
    >
      {enabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
    </Button>
  )
}
