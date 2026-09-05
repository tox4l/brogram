import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A4 ratio at 96 dpi in CSS pixels. pdf.ts screenshots each page at this size. */
export const REPORT_PAGE_WIDTH_PX = 794
export const REPORT_PAGE_HEIGHT_PX = 1123
export const REPORT_PAGE_MARGIN_PX = 48

/**
 * The report's single accent, used for every bar and fill on the page.
 * The app's shipped theme (src/app/globals.css) is still the neutral shadcn
 * base palette; the only chroma anywhere in it is the dark-mode
 * `--sidebar-primary` (oklch hue 264), which reads as the intended brand
 * hue. We pin a light-appropriate shade of that same hue here so the report
 * has a real accent instead of grayscale bars, and so it does not depend on
 * whichever theme token the app ends up shipping.
 */
export const REPORT_ACCENT = 'oklch(0.55 0.16 264)'
export const REPORT_ACCENT_SOFT = 'oklch(0.93 0.03 264)'

/**
 * Light-theme values for every semantic token the report's Tailwind classes
 * resolve through (bg-primary, text-muted-foreground, border, etc.), applied
 * as local CSS custom properties. The app is dark-first, so an ancestor may
 * carry the `.dark` class; without this override the same class names would
 * resolve to the dark palette and disappear against the report's forced
 * white page. Values copied verbatim from the `:root` block in globals.css.
 */
const REPORT_THEME_VARS = {
  colorScheme: 'light',
  '--background': 'oklch(1 0 0)',
  '--foreground': 'oklch(0.145 0 0)',
  '--card': 'oklch(1 0 0)',
  '--card-foreground': 'oklch(0.145 0 0)',
  '--primary': 'oklch(0.205 0 0)',
  '--primary-foreground': 'oklch(0.985 0 0)',
  '--secondary': 'oklch(0.97 0 0)',
  '--secondary-foreground': 'oklch(0.205 0 0)',
  '--muted': 'oklch(0.97 0 0)',
  '--muted-foreground': 'oklch(0.556 0 0)',
  '--accent': 'oklch(0.97 0 0)',
  '--accent-foreground': 'oklch(0.205 0 0)',
  '--border': 'oklch(0.922 0 0)',
  '--input': 'oklch(0.922 0 0)',
  '--ring': 'oklch(0.708 0 0)',
  '--report-accent': REPORT_ACCENT,
  '--report-accent-soft': REPORT_ACCENT_SOFT,
} as CSSProperties

interface ReportPageProps {
  children: ReactNode
  className?: string
}

/**
 * One printable page. Always white with dark text: this is the one place in
 * the app light is correct, because the container becomes a PDF page.
 */
export function ReportPage({ children, className }: ReportPageProps) {
  return (
    <div
      data-report-page
      className={cn('relative shrink-0 overflow-hidden bg-white text-neutral-900', className)}
      style={{
        ...REPORT_THEME_VARS,
        width: REPORT_PAGE_WIDTH_PX,
        height: REPORT_PAGE_HEIGHT_PX,
        padding: REPORT_PAGE_MARGIN_PX,
      }}
    >
      <div className="flex h-full w-full flex-col gap-8">{children}</div>
    </div>
  )
}
