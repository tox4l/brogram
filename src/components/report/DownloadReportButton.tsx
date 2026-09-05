'use client'

import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { downloadReportPdf } from './pdf'

interface DownloadReportButtonProps {
  /** Ref to the element that contains the report's `[data-report-page]` children. */
  containerRef: RefObject<HTMLElement | null>
  fileName?: string
  className?: string
}

/**
 * Dark-first chrome around the (always-light) report pages. Renders the
 * pages to a PDF and triggers a browser download; shows a busy state while
 * html2canvas-pro is rasterizing, since that can take a couple of seconds
 * for three A4 pages.
 */
export function DownloadReportButton({ containerRef, fileName = 'brogram-progress-report.pdf', className }: DownloadReportButtonProps) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle')

  async function handleClick() {
    const root = containerRef.current
    if (!root) return
    setStatus('busy')
    try {
      await downloadReportPdf(root, fileName)
      setStatus('idle')
    } catch (error) {
      console.error('downloadReportPdf failed', error)
      setStatus('error')
    }
  }

  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      <Button onClick={handleClick} disabled={status === 'busy'} data-slot="download-report-button">
        {status === 'busy' ? (
          <>
            <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />
            Preparing PDF
          </>
        ) : (
          <>
            <Download data-icon="inline-start" aria-hidden />
            Download PDF
          </>
        )}
      </Button>
      {status === 'error' && <p className="text-xs text-destructive">Could not generate the PDF. Try again.</p>}
    </div>
  )
}
