'use client'

import { useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { isArcadeKind, isPlayKind } from '../lib'

/**
 * `/derot/[kind]` moved when the hub grew a second lane (spec 10.9): Arcade
 * kinds now live at `/derot/arcade/[kind]`, Playground kinds at
 * `/derot/play/[kind]`. This shim keeps every existing link, deep link and
 * e2e spec pointed at the old path resolving instead of 404ing, by
 * forwarding straight through (including any query string, e.g. `?item=`).
 */
export default function LegacyDerotKindRedirect() {
  const router = useRouter()
  const params = useParams<{ kind: string }>()
  const searchParams = useSearchParams()

  useEffect(() => {
    const kind = params.kind
    const qs = searchParams.toString()
    const suffix = qs ? `?${qs}` : ''
    if (isArcadeKind(kind)) {
      router.replace(`/derot/arcade/${kind}${suffix}`)
      return
    }
    if (isPlayKind(kind)) {
      router.replace(`/derot/play/${kind}${suffix}`)
      return
    }
    router.replace('/derot')
  }, [params.kind, router, searchParams])

  return <p role="status" className="text-small text-muted-foreground">Taking you to the new de-rot page.</p>
}
