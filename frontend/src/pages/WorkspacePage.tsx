import { useCallback, useEffect, useState } from 'react'
import DocumentProcessingCard from '../components/DocumentProcessingCard'
import UploadCard from '../components/UploadCard'
import WorkspaceHeader from '../components/WorkspaceHeader'
import WorkspaceSidebar from '../components/WorkspaceSidebar'
import type { UploadedDocument, User } from '../types'
import { useNavigate } from 'react-router-dom'

const MAX_FILE_SIZE = 25 * 1024 * 1024
const IN_PROGRESS = new Set(['queued', 'extracting', 'chunking', 'embedding', 'indexing'])

type WorkspacePageProps = {
  user: User
  token: string
  onLogout: () => void
}

type ApiResponse = {
  detail?: string
  document?: UploadedDocument | null
  documents?: UploadedDocument[]
  [key: string]: unknown
}

function WorkspacePage({ user, token, onLogout }: WorkspacePageProps) {
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const navigate = useNavigate()
  const [restoring, setRestoring] = useState(true)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    })
    if (response.status === 204) return null
    const body = await response.text()
    let result: ApiResponse = {}
    if (body) {
      try { result = JSON.parse(body) as ApiResponse } catch { /* Some proxies return plain-text errors. */ }
    }
    if (!response.ok) throw new Error(result.detail ?? (body || 'The request could not be completed.'))
    return result
  }, [token])

  const refreshStatus = useCallback(async (documentId: string) => {
    try {
      const result = await request(`/api/documents/${documentId}`) as UploadedDocument
      setDocuments((current) => current.map((item) => item.document_id === documentId ? result : item))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh document status.')
    }
  }, [request])

  useEffect(() => {
    let cancelled = false
    request('/api/documents')
      .then((result) => { if (!cancelled) setDocuments(result?.documents ?? []) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load your documents.') })
      .finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, [request])

  useEffect(() => {
    const processingDocuments = documents.filter((item) => IN_PROGRESS.has(item.status))
    if (processingDocuments.length === 0) return
    const timer = window.setInterval(() => processingDocuments.forEach((item) => void refreshStatus(item.document_id)), 1500)
    return () => window.clearInterval(timer)
  }, [documents, refreshStatus])

  async function upload(file?: File) {
    if (!file) return
    setError('')
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError('Choose a PDF or DOCX file.'); return }
    if (file.size > MAX_FILE_SIZE) { setError('This file is larger than the 25 MB limit.'); return }

    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const result = await request('/api/documents', { method: 'POST', body }) as UploadedDocument
      setDocuments((current) => [result, ...current])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the API.')
    } finally {
      setBusy(false)
    }
  }

  async function removeDocument(documentId: string) {
    setRemoving(true)
    setError('')
    try {
      await request(`/api/documents/${documentId}`, { method: 'DELETE' })
      setDocuments((current) => current.filter((item) => item.document_id !== documentId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this document.')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <main className="app-shell">
      <WorkspaceHeader user={user} onLogout={onLogout} />
      <div className="workspace" id="top">
        <WorkspaceSidebar documents={documents} selectedDocumentId={null} onSelect={(item) => item.status === 'ready' && navigate(`/chat/${item.document_id}`)} />
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
                {documents.map((item) => <DocumentProcessingCard key={item.document_id} document={item} removing={removing} onRemove={() => removeDocument(item.document_id)} onOpenChat={() => navigate(`/chat/${item.document_id}`)} />)}
                <UploadCard busy={busy} error={error} onUpload={upload} />
              </div>
              {documents.length === 0 && <div className="dashboard-next-step"><span className="next-step-number">01</span><div><strong>Your first document starts here</strong><span>Contracts, briefs, policies, and other PDF or DOCX files up to 25 MB.</span></div><span className="next-step-arrow">→</span></div>}
            </>}
          {error && <div className="inline-error" role="alert">{error}</div>}
          <footer className="page-footer"><span>ELCARA CONTRACT INTELLIGENCE</span><span>Built for careful reading <b>·</b> v0.1</span></footer>
        </section>
      </div>
    </main>
  )
}

export default WorkspacePage
