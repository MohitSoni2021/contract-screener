import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Files, GitCompare, Sparkles, FilePenLine, Plus } from "lucide-react";
import type { UploadedDocument } from "../types";
import Brand from "./Brand";

type WorkspaceSidebarProps = {
  documents: UploadedDocument[];
  selectedDocumentId: string | null;
  onSelect: (document: UploadedDocument) => void;
  onAddDocument: (file: File | undefined) => void;
  removingId: string | null;
  onRemove: (documentId: string) => void;
  collapsible?: boolean;
  userName?: string;
  onLogout?: () => void;
};

function WorkspaceSidebar({
  documents,
  selectedDocumentId,
  onSelect,
  onAddDocument,
  removingId,
  onRemove,
  collapsible = false,
  userName,
  onLogout,
}: WorkspaceSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{
    document: UploadedDocument;
    x: number;
    y: number;
  } | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    function closeMenu() {
      setMenu(null);
    }
    document.addEventListener("click", closeMenu);
    document.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("scroll", closeMenu, true);
    };
  }, []);

  return (
    <div className={`comparison-sidebar-wrap${hidden ? " sidebar-wrap-hidden" : ""}`}>
      {collapsible && (
        <button
          className="sidebar-toggle-button"
          onClick={() => setHidden((v) => !v)}
          aria-label={hidden ? "Show sidebar" : "Hide sidebar"}
        >
          {hidden ? "›" : "‹"}
        </button>
      )}
      <aside
        className={`${collapsible ? "comparison-sidebar" : ""} ${hidden ? "comparison-sidebar-hidden" : ""} sticky top-[70px] flex h-[calc(100dvh-70px)] w-[246px] shrink-0 flex-col overflow-y-auto border-r border-[#e8eae5] bg-[#f6f7f4] px-[19px] pb-[22px] pt-[35px] max-[760px]:hidden`}
      >
        {collapsible && (
          <div className="comparison-sidebar-brand">
            <Brand home />
          </div>
        )}
        <div className="sidebar-label">WORKSPACE</div>
        <div className="flex flex-col gap-1.5 mt-3">
          <button
            className={`py-2 px-3.5 text-xs rounded-lg text-start gap-2.5 flex items-center transition font-medium ${
              location.pathname === "/workspace"
                ? "bg-white text-[#214f36] shadow-2xs font-semibold"
                : "text-[#546b5e] hover:bg-[#edf3ee]"
            }`}
            onClick={() => navigate("/workspace")}
          >
            <Files className="h-4 w-4 shrink-0 text-[#426b54]" />
            <span className="sidebar-text">My documents</span>
          </button>
          <button
            className={`py-2 px-3.5 text-xs rounded-lg text-start gap-2.5 flex items-center transition font-medium ${
              location.pathname === "/compare-doc"
                ? "bg-white text-[#214f36] shadow-2xs font-semibold"
                : "text-[#546b5e] hover:bg-[#edf3ee]"
            }`}
            onClick={() => navigate("/compare-doc")}
          >
            <GitCompare className="h-4 w-4 shrink-0 text-[#426b54]" />
            <span className="sidebar-text">Compare documents</span>
          </button>
          <button
            className={`py-2 px-3.5 text-xs rounded-lg text-start gap-2.5 flex items-center transition font-medium ${
              location.pathname === "/research"
                ? "bg-white text-[#214f36] shadow-2xs font-semibold"
                : "text-[#546b5e] hover:bg-[#edf3ee]"
            }`}
            onClick={() => navigate("/research")}
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[#426b54]" />
            <span className="sidebar-text">Agent research</span>
          </button>
          <button
            className={`py-2 px-3.5 text-xs rounded-lg text-start gap-2.5 flex items-center transition font-medium ${
              location.pathname.startsWith("/redline")
                ? "bg-white text-[#214f36] shadow-2xs font-semibold"
                : "text-[#546b5e] hover:bg-[#edf3ee]"
            }`}
            onClick={() => navigate("/redline")}
          >
            <FilePenLine className="h-4 w-4 shrink-0 text-[#426b54]" />
            <span className="sidebar-text">Redline &amp; Export</span>
          </button>

          <button
            className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-[#cfddd3] bg-white px-3 py-2 text-xs font-semibold text-[#25523a] shadow-2xs transition hover:border-[#25523a] hover:bg-[#f5faf6] disabled:opacity-50"
            onClick={() => fileInput.current?.click()}
            title={
              documents.length >= 3
                ? "Document limit reached (3/3 docs)"
                : "Upload a document (max 3 docs, < 15 MB)"
            }
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-xs">Add document ({documents.length}/3)</span>
          </button>
        </div>

        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => {
            onAddDocument(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <div className="sidebar-divider" />
        <div className="sidebar-label recent-label">RECENT</div>
        {documents.length > 0 ? (
          documents.slice(0, 6).map((document) => (
            <button
              className={`recent-document ${selectedDocumentId === document.document_id ? "selected" : ""}`}
              key={document.document_id}
              onClick={() => onSelect(document)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ document, x: event.clientX, y: event.clientY });
              }}
            >
              <span className="file-mini">
                {document.filename.toLowerCase().endsWith(".pdf")
                  ? "PDF"
                  : "DOCX"}
              </span>
              <span className="ellipsis sidebar-text">{document.filename}</span>
            </button>
          ))
        ) : (
          <p className="sidebar-empty">Your documents will appear here.</p>
        )}
        {userName && onLogout && (
          <div className="sidebar-account">
            <span className="avatar">
              {userName.trim().charAt(0).toUpperCase() || "U"}
            </span>
            <span className="sidebar-text ellipsis">{userName}</span>
            <button className="sidebar-logout sidebar-text" onClick={onLogout}>
              Sign out
            </button>
          </div>
        )}
        {menu && (
          <div
            className="document-context-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={() => {
                setMenu(null);
                onSelect(menu.document);
              }}
              disabled={menu.document.status !== "ready"}
            >
              Open chat
            </button>
            <button
              className="danger-action"
              onClick={() => {
                setMenu(null);
                onRemove(menu.document.document_id);
              }}
              disabled={removingId !== null}
            >
              {removingId === menu.document.document_id
                ? "Waiting to remove…"
                : "Remove document"}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

export default WorkspaceSidebar;
