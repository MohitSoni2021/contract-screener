import type { UploadedDocument } from '../types'

type WorkspaceSidebarProps = {
  document: UploadedDocument | null
}

function WorkspaceSidebar({ document }: WorkspaceSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-label">WORKSPACE</div>
      <button className="nav-item active"><span className="nav-icon">▤</span> My document</button>
      <div className="sidebar-divider" />
      <div className="sidebar-label recent-label">RECENT</div>
      {document ? (
        <div className="recent-document">
          <span className="file-mini">{document.filename.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX'}</span>
          <span className="ellipsis">{document.filename}</span>
        </div>
      ) : <p className="sidebar-empty">Your document will appear here.</p>}
      <div className="sidebar-footer"><span className="shield">◇</span><span>Your files stay yours.<br />Private by design.</span></div>
    </aside>
  )
}

export default WorkspaceSidebar
