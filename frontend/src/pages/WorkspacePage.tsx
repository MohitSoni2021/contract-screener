import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import DocumentProcessingCard from '../components/DocumentProcessingCard'
import WorkspaceHeader from '../components/WorkspaceHeader'
import WorkspaceSidebar from '../components/WorkspaceSidebar'
import type { User } from '../types'
import { useNavigate } from 'react-router-dom'
import type { AppDispatch, RootState } from '../store/store'
import { clearDocumentError, fetchDocuments, refreshDocument, removeDocument, setDocumentError, uploadDocument } from '../store/documentsSlice'

const MAX_FILE_SIZE = 25 * 1024 * 1024
const IN_PROGRESS = new Set(['queued', 'extracting', 'chunking', 'embedding', 'indexing'])

type WorkspacePageProps = {
  user: User
  token: string
  onLogout: () => void
}

function WorkspacePage({ user, token, onLogout }: WorkspacePageProps) {
  const dispatch = useDispatch<AppDispatch>()
  const { items: documents, loading: restoring, removingId, error } = useSelector((state: RootState) => state.documents)
  const navigate = useNavigate()
  const removingDocument = documents.find((item) => item.document_id === removingId)

  useEffect(() => {
    void dispatch(fetchDocuments({ token }))
  }, [dispatch, token])

  useEffect(() => {
    const processingDocuments = documents.filter((item) => IN_PROGRESS.has(item.status))
    if (processingDocuments.length === 0) return
    const timer = window.setInterval(() => processingDocuments.forEach((item) => void dispatch(refreshDocument({ token, documentId: item.document_id }))), 1500)
    return () => window.clearInterval(timer)
  }, [dispatch, documents, token])

  async function upload(file?: File) {
    if (!file) return
    dispatch(clearDocumentError())
    if (!/\.(pdf|docx)$/i.test(file.name)) { dispatch(setDocumentError('Choose a PDF or DOCX file.')); return }
    if (file.size > MAX_FILE_SIZE) { dispatch(setDocumentError('This file is larger than the 25 MB limit.')); return }
    void dispatch(uploadDocument({ token, file }))
  }

  return (
    <main className="app-shell">
      <WorkspaceHeader user={user} onLogout={onLogout} />
      <div className="workspace" id="top">
        <WorkspaceSidebar documents={documents} selectedDocumentId={null} onSelect={(item) => item.status === 'ready' && navigate(`/chat/${item.document_id}`)} onAddDocument={upload} removingId={removingId} onRemove={(documentId) => void dispatch(removeDocument({ token, documentId }))} />
        <section className="main-panel">
          <div className="page-heading dashboard-heading">
            <div><div className="eyebrow">YOUR WORKSPACE</div><h1>Everything you need to read with confidence.</h1><p>Upload documents, then ask precise questions with every answer grounded in its source.</p></div>
            <div className="secure-badge"><span>✳</span> Private by design</div>
          </div>
          <div className="dashboard-summary" aria-label="Workspace overview">
            <div className="summary-item"><span className="summary-icon">▤</span><div><strong>{documents.length}</strong><span>Uploaded documents</span></div></div>
            <div className="summary-item"><span className="summary-icon summary-icon-green">⌁</span><div><strong>{documents.reduce((total, item) => total + (item.indexed_chunks ?? 0), 0)}</strong><span>Indexed passages</span></div></div>
            <div className="summary-item summary-note"><span className="summary-icon summary-icon-amber">◌</span><div><strong>{documents.filter((item) => item.status === 'ready').length} ready</strong><span>Available to chat</span></div></div>
          </div>
          {restoring
            ? <div className="document-restore" role="status"><span className="spinner" /> Loading your document…</div>
            : <>
              <div className="document-grid">
                {documents.map((item) => <DocumentProcessingCard key={item.document_id} document={item} removing={removingId === item.document_id} onRemove={() => void dispatch(removeDocument({ token, documentId: item.document_id }))} onOpenChat={() => navigate(`/chat/${item.document_id}`)} />)}
              </div>
              {documents.length === 0 && <div className="dashboard-next-step"><span className="next-step-number">01</span><div><strong>Your first document starts here</strong><span>Contracts, briefs, policies, and other PDF or DOCX files up to 25 MB.</span></div><span className="next-step-arrow">→</span></div>}
            </>}
          {removingDocument && <div className="processing-removal-overlay" role="status" aria-live="polite">
            <div className="processing-removal-dialog">
              <span className="spinner" />
              <div><strong>{removingDocument.status === 'queued' ? 'Removing queued upload' : 'Preparing to remove this document'}</strong><p>{removingDocument.status === 'queued' ? `“${removingDocument.filename}” has not started processing yet.` : removingDocument.status === 'ready' || removingDocument.status === 'failed' ? 'Finishing the removal…' : `Please wait while “${removingDocument.filename}” finishes processing.`}</p><small>{removingDocument.status === 'queued' ? 'The upload is being removed safely.' : removingDocument.stage || 'Checking document status'}{removingDocument.status !== 'queued' && removingDocument.status !== 'ready' && removingDocument.status !== 'failed' ? ` · ${removingDocument.progress}%` : ''}</small></div>
            </div>
          </div>}
          {error && <div className="inline-error" role="alert">{error}</div>}
          <footer className="page-footer"><span>ELCARA CONTRACT INTELLIGENCE</span><span>Built for careful reading <b>·</b> v0.1</span></footer>
        </section>
      </div>
    </main>
  )
}

export default WorkspacePage
