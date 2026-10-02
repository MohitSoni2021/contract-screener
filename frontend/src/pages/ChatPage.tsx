import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useParams } from 'react-router-dom'
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
      <main className="route-error">
        <div className="eyebrow">DOCUMENT CHAT</div>
        <h1>{document ? 'This document is still being prepared.' : 'Document unavailable.'}</h1>
        <p>{error || storeError || 'Return to your workspace to see the latest document status.'}</p>
      </main>
    )
  }

  return <DocumentChat document={document} token={token} error={error || storeError} user={user} onLogout={onLogout} />
}

export default ChatPage
