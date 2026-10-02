import type { UploadedDocument } from '../types'

type WorkspaceSidebarProps = {
  documents: UploadedDocument[]
  selectedDocumentId: string | null
  onSelect: (document: UploadedDocument) => void
}

function WorkspaceSidebar({ documents, selectedDocumentId, onSelect }: WorkspaceSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-label">WORKSPACE</div>
      <button className="nav-item active"><span className="nav-icon">▤</span> My documents</button>
      <div className="sidebar-divider" />
      <div className="sidebar-label recent-label">RECENT</div>
      {documents.length > 0 ? documents.slice(0, 6).map((document) => (
        <button className={`recent-document ${selectedDocumentId === document.document_id ? 'selected' : ''}`} key={document.document_id} onClick={() => onSelect(document)}>
          <span className="file-mini">{document.filename.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX'}</span>
          <span className="ellipsis">{document.filename}</span>
        </button>
      )) : <p className="sidebar-empty">Your documents will appear here.</p>}
      <div className="sidebar-footer"><span className="shield">◇</span><span>Your files stay yours.<br />Private by design.</span></div>
    </aside>
  )
}

export default WorkspaceSidebar
