import { REPORT_PAGE_HEIGHT_PX, REPORT_PAGE_WIDTH_PX } from './ReportPage'

/** Device-pixel-ratio-independent screenshot quality; matches the runtime-facts guidance. */
const CAPTURE_SCALE = 2

/**
 * Renders every `[data-report-page]` element inside `root`, in DOM order,
 * to a raster image and assembles them into a one-image-per-page PDF.
 *
 * Client-only by construction: jspdf and html2canvas-pro are loaded with a
 * dynamic import so nothing here executes, or is bundled for, the server.
 * Only ever call this from a 'use client' event handler after the report
 * has mounted (see DownloadReportButton).
 */
export async function downloadReportPdf(root: HTMLElement, fileName: string): Promise<void> {
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-report-page]'))
  if (pages.length === 0) {
    throw new Error('downloadReportPdf: no [data-report-page] elements found inside root')
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')])

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'px',
    format: [REPORT_PAGE_WIDTH_PX, REPORT_PAGE_HEIGHT_PX],
    compress: true,
  })

  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      scale: CAPTURE_SCALE,
      backgroundColor: '#ffffff',
      useCORS: true,
    })
    const imageData = canvas.toDataURL('image/png')

    if (i > 0) doc.addPage([REPORT_PAGE_WIDTH_PX, REPORT_PAGE_HEIGHT_PX], 'portrait')
    doc.addImage(imageData, 'PNG', 0, 0, REPORT_PAGE_WIDTH_PX, REPORT_PAGE_HEIGHT_PX)
  }

  doc.save(fileName)
}
