'use client'

import { usePathname } from 'next/navigation'
import { Rail } from '@/components/wellness/Rail'

export function WellnessSlot() {
  const pathname = usePathname()
  const exercise = pathname === '/exercise' || pathname.startsWith('/exercise/')
  return <Rail compact={exercise} />
}
