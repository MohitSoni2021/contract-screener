import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Document as PdfDocument, Page, pdfjs } from "react-pdf";
import type { ChatCitation } from "../types";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface ErrorBoundaryProps {
  fallback: (error: Error) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class PdfErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn("Caught PDF render error:", error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback(this.state.error ?? new Error("PDF could not be rendered"));
    }
    return this.props.children;
  }
}

type PdfCitationViewerProps = {
  sourceUrl: string;
  citation?: ChatCitation | null;
};

export default function PdfCitationViewer({
  sourceUrl,
  citation,
}: PdfCitationViewerProps) {
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(citation?.page_start ?? 1);
  const [width, setWidth] = useState(700);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (citation?.page_start) {
      setPage(citation.page_start);
    }
  }, [citation?.page_start]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const el = viewerRef.current?.querySelector(".pdf-source-highlight");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [page, citation]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (!viewerRef.current) return;
    if (document.fullscreenElement === viewerRef.current) {
      await document.exitFullscreen();
    } else {
      await viewerRef.current.requestFullscreen();
    }
  }

  const [loadError, setLoadError] = useState<string | null>(null);

  const fallbackView = (
    <div className="pdf-viewer-scroll p-6 text-center text-xs text-[#52655a]">
      <div className="rounded-xl border border-[#e1e9e3] bg-white p-6 shadow-sm max-w-md mx-auto">
        <p className="font-semibold text-[#1e3c2b] mb-1">Document Passage</p>
        {citation?.quote && (
          <div className="mt-3 text-left font-serif text-xs leading-relaxed text-[#23382c] bg-amber-50/60 p-4 rounded-lg border border-amber-200/80">
            <mark className="bg-amber-200 px-1 py-0.5 rounded text-amber-950 font-medium">{citation.quote}</mark>
          </div>
        )}
      </div>
    </div>
  );

  if (loadError) {
    return fallbackView;
  }

  return (
    <div className="pdf-viewer-scroll" ref={viewerRef}>
      <div className="flex gap-3">
        <div className="pdf-page-controls">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span>
            Page {page}
            {pageCount ? ` of ${pageCount}` : ""}
          </span>
          <button
            type="button"
            onClick={() =>
              setPage((current) =>
                Math.min(pageCount || current + 1, current + 1),
              )
            }
            disabled={Boolean(pageCount) && page >= pageCount}
          >
            Next
          </button>
        </div>

        <div className="">
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="pdf-fullscreen-button"
            aria-label={
              isFullscreen ? "Exit full screen" : "View PDF full screen"
            }
            title={isFullscreen ? "Exit full screen" : "View PDF full screen"}
          >
            {isFullscreen ? "⛶" : "⛶"}
          </button>
        </div>
      </div>

      <PdfErrorBoundary fallback={() => fallbackView}>
        <PdfDocument
          file={sourceUrl}
          onLoadError={(err) => {
            console.warn("PDF load error:", err);
            setLoadError(err?.message || "Could not render PDF");
          }}
          loading={
            <div className="chat-loading">
              <span className="spinner" /> Rendering PDF…
            </div>
          }
          error={
            <div className="pdf-viewer-error">
              This PDF page could not be rendered.
            </div>
          }
          onLoadSuccess={({ numPages }) => {
            setPageCount(numPages);
            setPage((current) => Math.min(current, numPages));
          }}
        >
          <Page
            pageNumber={page}
            width={Math.max(280, Math.min(width - 36, 760))}
            renderAnnotationLayer={false}
            customTextRenderer={({ str }) =>
              citation ? renderPdfText(str, citation.quote) : escapeHtml(str)
            }
          />
        </PdfDocument>
      </PdfErrorBoundary>
    </div>
  );
}

function renderPdfText(text: string, quote: string) {
  const normalizedItem = normalizePdfText(text);
  const normalizedQuote = normalizePdfText(quote);
  const itemWords = normalizedItem.split(" ").filter((word) => word.length > 2);
  const quoteWords = new Set(normalizedQuote.split(" "));
  // PDF text items can split a source line differently from extraction. Prefer an
  // exact normalized line match, then allow only complete multi-word matches.
  const isExactSourceLine =
    normalizedItem.length >= 12 && normalizedQuote.includes(normalizedItem);
  const hasCompletePhrase =
    itemWords.length >= 4 && itemWords.every((word) => quoteWords.has(word));
  const safeText = escapeHtml(text);
  return isExactSourceLine || hasCompletePhrase
    ? `<mark class="pdf-source-highlight">${safeText}</mark>`
    : safeText;
}

function normalizePdfText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}
