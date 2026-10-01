import { useState } from 'react'
import DocumentChat from '../components/DocumentChat'
import UploadCard from '../components/UploadCard'
import WorkspaceHeader from '../components/WorkspaceHeader'
import WorkspaceSidebar from '../components/WorkspaceSidebar'
import type { UploadedDocument, User } from '../types'

const MAX_FILE_SIZE = 25 * 1024 * 1024

type WorkspacePageProps = {
  user: User
  token: string
  onLogout: () => void
}

function WorkspacePage({ user, token, onLogout }: WorkspacePageProps) {
  const [document, setDocument] = useState<UploadedDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function upload(file?: File) {
    if (!file) return
    setError('')
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError('Choose a PDF or DOCX file.'); return }
    if (file.size > MAX_FILE_SIZE) { setError('This starter accepts files up to 25 MB.'); return }

    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail ?? 'Upload failed. Try again.')
      setDocument(result as UploadedDocument)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the API.')
    } finally {
      setBusy(false)
    }
  }

  function replaceDocument() {
    setDocument(null)
    setError('')
  }

  return (
    <main className="app-shell">
      <WorkspaceHeader user={user} onLogout={onLogout} />
      <div className="workspace" id="top">
        <WorkspaceSidebar document={document} />
        <section className="main-panel">
          <div className="page-heading">
            <div><div className="eyebrow">CONTRACT WORKSPACE</div><h1>Clarity, clause by clause.</h1><p>Upload a contract to get grounded answers from your document.</p></div>
            <div className="secure-badge"><span>✳</span> Source-grounded</div>
          </div>
          {document
            ? <DocumentChat document={document} error={error} onReplace={replaceDocument} />
            : <UploadCard busy={busy} error={error} onUpload={upload} />}
          <footer className="page-footer"><span>ELCARA CONTRACT INTELLIGENCE</span><span>Built for careful reading <b>·</b> v0.1</span></footer>
        </section>
      </div>
    </main>
  )
}

export default WorkspacePage
