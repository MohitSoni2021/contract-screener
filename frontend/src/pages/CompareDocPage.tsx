import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import DocumentComparison from '../components/DocumentComparison'
import WorkspaceSidebar from '../components/WorkspaceSidebar'
import type { User } from '../types'
import type { AppDispatch, RootState } from '../store/store'
import { fetchDocuments } from '../store/documentsSlice'

type CompareDocPageProps = {
  user: User
  token: string
  onLogout: () => void
}

function CompareDocPage({ user, token, onLogout }: CompareDocPageProps) {
  const dispatch = useDispatch<AppDispatch>()
  const navigate = useNavigate()
  const { items: documents, loading } = useSelector((state: RootState) => state.documents)

  useEffect(() => {
    void dispatch(fetchDocuments({ token }))
  }, [dispatch, token])

  return (
    <main className="comparison-app-shell" aria-label="Document comparison workspace">
      <div className="comparison-workspace" id="top">
        <WorkspaceSidebar
          documents={documents}
          selectedDocumentId={null}
          onSelect={(document) => document.status === 'ready' && navigate(`/chat/${document.document_id}`)}
          onAddDocument={() => navigate('/workspace')}
          removingId={null}
          onRemove={() => undefined}
          collapsible
          userName={user.name}
          onLogout={onLogout}
        />
        <section className="comparison-main-panel !p-0 flex h-full min-h-0 w-full flex-1 flex-col">
          {loading ? (
            <div className="document-restore" role="status"><span className="spinner" /> Loading your documents…</div>
          ) : documents.filter((document) => document.status === 'ready').length < 2 ? (
            <div className="comparison-empty-state">
              <span className="comparison-empty-icon">⇄</span>
              <h2>Two ready documents make a comparison.</h2>
              <p>Upload both versions in your workspace, then return here to align their clauses and review every change.</p>
              <button className="comparison-button" onClick={() => navigate('/workspace')}>Go to my documents</button>
            </div>
          ) : (
            <DocumentComparison documents={documents} token={token} />
          )}
          <footer className="page-footer">
            <span>ELCARA CONTRACT INTELLIGENCE</span>
            <span>Built for careful reading <b>·</b> v0.1</span>
          </footer>
        </section>
      </div>
    </main>
  )
}

export default CompareDocPage
