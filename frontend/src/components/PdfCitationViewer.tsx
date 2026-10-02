import { useEffect, useRef, useState } from 'react'
import { Document as PdfDocument, Page, pdfjs } from 'react-pdf'
import type { ChatCitation } from '../types'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type PdfCitationViewerProps = {
  sourceUrl: string
  citation?: ChatCitation | null
}

export default function PdfCitationViewer({ sourceUrl, citation }: PdfCitationViewerProps) {
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(citation?.page_start ?? 1)
  const [width, setWidth] = useState(700)
  const viewerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(viewer)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="pdf-viewer-scroll" ref={viewerRef}>
      <div className="pdf-page-controls">
        <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button>
        <span>Page {page}{pageCount ? ` of ${pageCount}` : ''}</span>
        <button type="button" onClick={() => setPage((current) => Math.min(pageCount || current + 1, current + 1))} disabled={Boolean(pageCount) && page >= pageCount}>Next</button>
      </div>
      <PdfDocument
        file={sourceUrl}
        loading={<div className="chat-loading"><span className="spinner" /> Rendering PDF…</div>}
        error={<div className="pdf-viewer-error">This PDF page could not be rendered.</div>}
        onLoadSuccess={({ numPages }) => {
          setPageCount(numPages)
          setPage((current) => Math.min(current, numPages))
        }}
      >
        <Page
          pageNumber={page}
          width={Math.max(280, Math.min(width - 36, 760))}
          renderAnnotationLayer={false}
          customTextRenderer={({ str }) => citation ? renderPdfText(str, citation.quote) : escapeHtml(str)}
        />
      </PdfDocument>
    </div>
  )
}

function renderPdfText(text: string, quote: string) {
  const normalizedItem = normalizePdfText(text)
  const normalizedQuote = normalizePdfText(quote)
  const itemWords = normalizedItem.split(' ').filter((word) => word.length > 2)
  const quoteWords = new Set(normalizedQuote.split(' '))
  const overlapsQuote = normalizedItem.length >= 7 && normalizedQuote.includes(normalizedItem)
  const hasMatchingPhrase = itemWords.length >= 3 && itemWords.filter((word) => quoteWords.has(word)).length / itemWords.length >= 0.8
  const safeText = escapeHtml(text)
  return overlapsQuote || hasMatchingPhrase ? `<mark class="pdf-source-highlight">${safeText}</mark>` : safeText
}

function normalizePdfText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u00a0]+/g, ' ').trim()
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}
