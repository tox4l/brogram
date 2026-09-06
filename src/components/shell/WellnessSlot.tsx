'use client'

import { usePathname } from 'next/navigation'
import { Rail } from '@/components/wellness/Rail'

export function WellnessSlot({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname()
  const exercise = compact || pathname === '/exercise' || pathname.startsWith('/exercise/')
  return <Rail compact={exercise} />
}
