import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
        <button
          className={`nav-item ${location.pathname === "/workspace" ? "active" : ""}`}
          onClick={() => navigate("/workspace")}
        >
          <span className="nav-icon">▤</span>{" "}
          <span className="sidebar-text">My documents</span>
        </button>
        <button
          className={`nav-item ${location.pathname === "/compare-doc" ? "active" : ""}`}
          onClick={() => navigate("/compare-doc")}
        >
          <span className="nav-icon">⇄</span>{" "}
          <span className="sidebar-text">Compare documents</span>
        </button>
        <button
          className={`nav-item ${location.pathname === "/research" ? "active" : ""}`}
          onClick={() => navigate("/research")}
        >
          <span className="nav-icon">⌁</span>{" "}
          <span className="sidebar-text">Agent research</span>
        </button>
        <button
          className="sidebar-add-button"
          onClick={() => fileInput.current?.click()}
        >
          <span>+</span> <span className="sidebar-text">Add document</span>
        </button>
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
