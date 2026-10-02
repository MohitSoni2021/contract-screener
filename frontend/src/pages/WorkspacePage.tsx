import { useCallback, useEffect, useState } from 'react'
import DocumentProcessingCard from '../components/DocumentProcessingCard'
import DocumentChat from '../components/DocumentChat'
import UploadCard from '../components/UploadCard'
import WorkspaceHeader from '../components/WorkspaceHeader'
import WorkspaceSidebar from '../components/WorkspaceSidebar'
import type { UploadedDocument, User } from '../types'

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
  [key: string]: unknown
}

function WorkspacePage({ user, token, onLogout }: WorkspacePageProps) {
  const [document, setDocument] = useState<UploadedDocument | null>(null)
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
      setDocument((current) => current?.document_id === documentId ? result : current)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh document status.')
    }
  }, [request])

  useEffect(() => {
    let cancelled = false
    request('/api/documents/current')
      .then((result) => { if (!cancelled) setDocument((result?.document as UploadedDocument | null) ?? null) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load your document.') })
      .finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, [request])

  useEffect(() => {
    if (!document || !IN_PROGRESS.has(document.status)) return
    const timer = window.setInterval(() => void refreshStatus(document.document_id), 1500)
    return () => window.clearInterval(timer)
  }, [document, refreshStatus])

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
      setDocument(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the API.')
    } finally {
      setBusy(false)
    }
  }

  async function removeDocument() {
    if (!document) return
    setRemoving(true)
    setError('')
    try {
      await request(`/api/documents/${document.document_id}`, { method: 'DELETE' })
      setDocument(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this document.')
    } finally {
      setRemoving(false)
    }
  }

  if (!restoring && document?.status === 'ready') {
    return <DocumentChat document={document} token={token} error={error} onReplace={removeDocument} user={user} onLogout={onLogout} />
  }

  return (
    <main className="app-shell">
      <WorkspaceHeader user={user} onLogout={onLogout} />
      <div className="workspace" id="top">
        <WorkspaceSidebar document={document} />
        <section className="main-panel">
          <div className="page-heading">
            <div><div className="eyebrow">CONTRACT WORKSPACE</div><h1>Clarity, clause by clause.</h1><p>Upload a contract to prepare a private, searchable document index.</p></div>
            <div className="secure-badge"><span>✳</span> Private document index</div>
          </div>
          {restoring
            ? <div className="document-restore" role="status"><span className="spinner" /> Loading your document…</div>
            : document
            ? <DocumentProcessingCard document={document} removing={removing} onRemove={removeDocument} />
            : <UploadCard busy={busy} error={error} onUpload={upload} />}
          {document && error && <div className="inline-error" role="alert">{error}</div>}
          <footer className="page-footer"><span>ELCARA CONTRACT INTELLIGENCE</span><span>Built for careful reading <b>·</b> v0.1</span></footer>
        </section>
      </div>
    </main>
  )
}

export default WorkspacePage
