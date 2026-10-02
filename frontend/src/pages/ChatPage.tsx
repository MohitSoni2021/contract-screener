import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DocumentChat from '../components/DocumentChat'
import RouteLoading from '../components/RouteLoading'
import type { UploadedDocument, User } from '../types'

type ChatPageProps = {
  user: User
  token: string
  onLogout: () => void
}

type ApiResponse = {
  detail?: string
}

function ChatPage({ user, token, onLogout }: ChatPageProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [document, setDocument] = useState<UploadedDocument | null>(null)
  const [loading, setLoading] = useState(true)
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

  useEffect(() => {
    if (!id) {
      setError('That document link is incomplete.')
      setLoading(false)
      return
    }
    let active = true
    request(`/api/documents/${id}`)
      .then((result) => {
        if (active) setDocument(result as UploadedDocument)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load this document.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [id, request])

  async function removeDocument() {
    if (!id) return
    try {
      await request(`/api/documents/${id}`, { method: 'DELETE' })
      navigate('/workspace')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this document.')
    }
  }

  if (loading) return <RouteLoading />
  if (!document || document.status !== 'ready') {
    return (
      <main className="route-error">
        <div className="eyebrow">DOCUMENT CHAT</div>
        <h1>{document ? 'This document is still being prepared.' : 'Document unavailable.'}</h1>
        <p>{error || 'Return to your workspace to see the latest document status.'}</p>
        <button className="primary-button" onClick={() => navigate('/workspace')}>Back to workspace</button>
      </main>
    )
  }

  return <DocumentChat document={document} token={token} error={error} onReplace={removeDocument} user={user} onLogout={onLogout} />
}

export default ChatPage
