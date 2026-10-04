import { useEffect, useRef, useState } from "react";
import { Download, ZoomIn, ZoomOut, Maximize2, Minimize2, CheckCircle2 } from "lucide-react";
import type { ChatCitation, UploadedDocument } from "../types";
import { apiUrl } from "../config";

interface DocxCitationViewerProps {
  document: UploadedDocument;
  citation: ChatCitation;
  token?: string;
}

export default function DocxCitationViewer({
  document: doc,
  citation,
  token,
}: DocxCitationViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullText, setFullText] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Fetch full canonical text if available to show surrounding context
  useEffect(() => {
    let active = true;
    setLoadingText(true);
    fetch(apiUrl(`/api/documents/${doc.document_id}/content`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        if (data?.fullText && typeof data.fullText === "string") {
          setFullText(data.fullText);
        }
      })
      .catch(() => {
        // Fallback to displaying citation.quote directly
      })
      .finally(() => {
        if (active) setLoadingText(false);
      });

    return () => {
      active = false;
    };
  }, [doc.document_id, token]);

  // Auto-scroll highlight into view when citation changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const target = viewerRef.current?.querySelector("#docx-citation-highlight");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [citation, fullText]);

  // Fullscreen event listener
  useEffect(() => {
    const handleFullscreen = () => {
      setIsFullscreen(globalThis.document.fullscreenElement === viewerRef.current);
    };
    globalThis.document.addEventListener("fullscreenchange", handleFullscreen);
    return () => {
      globalThis.document.removeEventListener("fullscreenchange", handleFullscreen);
    };
  }, []);

  async function toggleFullscreen() {
    if (!viewerRef.current) return;
    if (globalThis.document.fullscreenElement === viewerRef.current) {
      await globalThis.document.exitFullscreen();
    } else {
      await viewerRef.current.requestFullscreen();
    }
  }

  const locationLabel =
    citation.block_start != null
      ? citation.block_end != null && citation.block_end !== citation.block_start
        ? `Blocks ${citation.block_start}–${citation.block_end}`
        : `Block ${citation.block_start}`
      : citation.page_start != null
        ? `Page ${citation.page_start}`
        : "Document Passage";

  const surrounding = fullText ? extractSurroundingContext(fullText, citation.quote) : null;

  return (
    <div className="pdf-viewer-scroll" ref={viewerRef}>
      {/* Control bar matching PDF viewer style */}
      <div className="flex gap-2 items-center flex-wrap justify-center">
        <div className="pdf-page-controls">
          <span className="font-semibold text-[#2c624b] flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-[#367153]" />
            {locationLabel}
          </span>
          <span className="text-[#c1ccc4]">|</span>
          <span className="text-[#687a70]">
            Zoom {zoom}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(80, z - 10))}
            disabled={zoom <= 80}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-3 w-3 inline" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(140, z + 10))}
            disabled={zoom >= 140}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-3 w-3 inline" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="pdf-fullscreen-button"
            aria-label={isFullscreen ? "Exit full screen" : "View full screen"}
            title={isFullscreen ? "Exit full screen" : "View full screen"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <a
            href={apiUrl(`/api/documents/${doc.document_id}/file`)}
            target="_blank"
            rel="noreferrer"
            className="pdf-fullscreen-button"
            title="Download original DOCX"
            aria-label="Download original DOCX"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Realistic Paper Document Sheet */}
      <div
        className="w-full max-w-[680px] rounded-lg border border-[#d6e0d8] bg-white p-6 sm:p-9 shadow-md transition-all duration-150"
        style={{ fontSize: `${(zoom / 100) * 12.5}px` }}
      >
        {/* Document Header Watermark */}
        <div className="mb-5 flex items-center justify-between border-b border-[#e9efe9] pb-3 text-[10px] text-[#6d7f74] select-none">
          <span className="font-mono font-medium truncate max-w-[240px] sm:max-w-md">
            {doc.filename}
          </span>
          <span className="rounded bg-[#e8f3eb] px-2 py-0.5 font-semibold text-[#285d43]">
            {locationLabel}
          </span>
        </div>

        {/* Document Passage Content with Highlighted Citation */}
        <div className="font-serif leading-relaxed text-[#21352a] whitespace-pre-wrap break-words">
          {surrounding ? (
            <>
              {surrounding.prefix && (
                <span className="text-[#495e52]">{surrounding.prefix}</span>
              )}
              <mark
                id="docx-citation-highlight"
                className="pdf-source-highlight font-medium bg-[#dcef91] text-[#1c2e23] px-1 py-0.5 rounded shadow-2xs border-b border-[#b7cc6a]"
              >
                {surrounding.quote}
              </mark>
              {surrounding.suffix && (
                <span className="text-[#495e52]">{surrounding.suffix}</span>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <mark
                id="docx-citation-highlight"
                className="pdf-source-highlight font-medium bg-[#dcef91] text-[#1c2e23] px-1.5 py-1 rounded inline-block shadow-2xs border-b border-[#b7cc6a]"
              >
                {citation.quote}
              </mark>
              {loadingText && (
                <p className="text-[10px] text-[#86958b] italic">
                  Loading full document context…
                </p>
              )}
            </div>
          )}
        </div>

        {/* Sheet Footer */}
        <div className="mt-8 border-t border-[#eef3ef] pt-3 flex items-center justify-between text-[10px] text-[#829288] select-none">
          <span>Passage {citation.source_id}</span>
          <span>Verified Legal Source</span>
        </div>
      </div>
    </div>
  );
}

function extractSurroundingContext(fullText: string, quote: string, maxContext = 650) {
  if (!fullText || !quote) return null;
  let idx = fullText.indexOf(quote);
  if (idx === -1) {
    // Attempt normalized whitespace search
    const cleanFull = fullText.replace(/\s+/g, " ");
    const cleanQuote = quote.trim().replace(/\s+/g, " ");
    const cleanIdx = cleanFull.indexOf(cleanQuote);
    if (cleanIdx !== -1) {
      // Find approximate offset
      idx = Math.max(0, cleanIdx);
    } else {
      return null;
    }
  }

  const start = Math.max(0, idx - Math.floor(maxContext / 2));
  const end = Math.min(fullText.length, idx + quote.length + Math.floor(maxContext / 2));

  let prefix = fullText.slice(start, idx);
  let suffix = fullText.slice(idx + quote.length, end);

  if (start > 0) {
    const spaceIdx = prefix.indexOf(" ");
    prefix = "…" + (spaceIdx !== -1 ? prefix.slice(spaceIdx) : prefix);
  }
  if (end < fullText.length) {
    const lastSpace = suffix.lastIndexOf(" ");
    suffix = (lastSpace !== -1 ? suffix.slice(0, lastSpace) : suffix) + "…";
  }

  return { prefix, quote, suffix };
}
