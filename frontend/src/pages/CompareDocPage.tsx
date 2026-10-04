import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  const [searchParams] = useSearchParams()
  const initialLeftId = searchParams.get('left') || searchParams.get('v1')
  const initialRightId = searchParams.get('right') || searchParams.get('v2')

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
        <section className="flex h-full w-full flex-1 flex-col min-h-0 min-w-0 overflow-hidden bg-[#f6f8f6]">
          {loading ? (
            <div className="document-restore m-auto" role="status"><span className="spinner" /> Loading your documents…</div>
          ) : (
            <DocumentComparison
              documents={documents}
              token={token}
              initialLeftId={initialLeftId}
              initialRightId={initialRightId}
            />
          )}
        </section>
      </div>
    </main>
  )
}

export default CompareDocPage
