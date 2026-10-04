import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import DocumentChat from '../components/DocumentChat'
import RouteLoading from '../components/RouteLoading'
import type { User } from '../types'
import type { AppDispatch, RootState } from '../store/store'
import { fetchDocument } from '../store/documentsSlice'

type ChatPageProps = {
  user: User
  token: string
  onLogout: () => void
}

function ChatPage({ user, token, onLogout }: ChatPageProps) {
  const { id } = useParams<{ id: string }>()
  const dispatch = useDispatch<AppDispatch>()
  const document = useSelector((state: RootState) => state.documents.items.find((item) => item.document_id === id) ?? null)
  const storeError = useSelector((state: RootState) => state.documents.error)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) {
      setError('That document link is incomplete.')
      setLoading(false)
      return
    }
    if (document) {
      setLoading(false)
      return
    }
    let active = true
    dispatch(fetchDocument({ token, documentId: id }))
      .unwrap()
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load this document.') })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [dispatch, document, id, token])

  if (loading) return <RouteLoading />
  if (!document || document.status !== 'ready') {
    return (
      <main className="route-error flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="eyebrow">DOCUMENT CHAT</div>
        <h1 className="mt-2 text-xl font-bold text-[#1f372a]">{document ? 'This document is still being prepared.' : 'Document unavailable.'}</h1>
        <p className="mt-2 text-sm text-[#5d7366] max-w-md">{error || storeError || 'Return to your workspace to see the latest document status.'}</p>
        <Link
          to="/workspace"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#25523a] px-4 py-2 text-sm font-semibold text-white shadow-2xs hover:bg-[#1a3d2a] transition cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Workspace</span>
        </Link>
      </main>
    )
  }

  return <DocumentChat document={document} token={token} error={error || storeError} user={user} onLogout={onLogout} />
}

export default ChatPage
