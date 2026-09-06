'use client'

import { useParams } from 'next/navigation'
import { LessonView } from '@/components/lesson/LessonView'

export default function LessonPage() {
  const { cloId } = useParams<{ cloId: string }>()
  return <LessonView key={cloId} cloId={cloId} />
}
