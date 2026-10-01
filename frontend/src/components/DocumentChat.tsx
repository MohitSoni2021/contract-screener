import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import type { ChatCitation, ChatConversation, ChatMessage, UploadedDocument } from '../types'

const PdfCitationViewer = lazy(() => import('./PdfCitationViewer'))

type DocumentChatProps = {
  document: UploadedDocument
  token: string
  error: string
  onReplace: () => void
}

type StreamEvent = {
  conversation_id?: string
  stage?: string
  message?: string
  text?: string
  items?: ChatCitation[]
  message_id?: string
  status?: ChatMessage['status']
  content?: string
}

const SOURCE_MARKER = /\[\[(S\d+)\]\]/g

async function consumeEventStream(
  response: Response,
  onEvent: (event: string, data: StreamEvent) => void,
) {
  if (!response.body) throw new Error('The chat stream was not available.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''

  function dispatch(frame: string) {
    const lines = frame.replace(/\r/g, '').split('\n')
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
    if (!event || !data) return
    onEvent(event, JSON.parse(data) as StreamEvent)
  }

  while (true) {
    const { done, value } = await reader.read()
    buffered += decoder.decode(value, { stream: !done })
    buffered = buffered.replace(/\r\n/g, '\n')
    let boundary = buffered.indexOf('\n\n')
    while (boundary >= 0) {
      dispatch(buffered.slice(0, boundary))
      buffered = buffered.slice(boundary + 2)
      boundary = buffered.indexOf('\n\n')
    }
    if (done) break
  }
}

function citationLocation(citation: ChatCitation, isPdf: boolean) {
  if (isPdf && citation.page_start != null) {
    return citation.page_end && citation.page_end !== citation.page_start
      ? `Pages ${citation.page_start}–${citation.page_end}`
      : `Page ${citation.page_start}`
  }
  if (citation.block_start != null) {
    return citation.block_end != null && citation.block_end !== citation.block_start
      ? `DOCX blocks ${citation.block_start}–${citation.block_end}`
      : `DOCX block ${citation.block_start}`
  }
  return 'Document passage'
}

function DocumentChat({ document, token, error, onReplace }: DocumentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [stageMessage, setStageMessage] = useState('')
  const [chatError, setChatError] = useState('')
  const [selectedCitation, setSelectedCitation] = useState<ChatCitation | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDetailsElement>(null)

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw new Error(result.detail ?? 'The request could not be completed.')
    }
    return response
  }, [token])

  const openConversation = useCallback(async (id: string) => {
    const response = await api(`/api/conversations/${id}`)
    const result = await response.json()
    setConversationId(id)
    setMessages(result.messages as ChatMessage[])
    setChatError('')
    if (historyRef.current) historyRef.current.open = false
  }, [api])

  const loadConversations = useCallback(async (openLatest: boolean) => {
    const response = await api(`/api/documents/${document.document_id}/conversations`)
    const result = await response.json()
    const items = result.conversations as ChatConversation[]
    setConversations(items)
    if (openLatest && items.length > 0) await openConversation(items[0].conversation_id)
  }, [api, document.document_id, openConversation])

  useEffect(() => {
    let active = true
    setLoadingHistory(true)
    setMessages([])
    setConversationId(null)
    loadConversations(true)
      .catch((cause) => { if (active) setChatError(cause instanceof Error ? cause.message : 'Could not load chat history.') })
      .finally(() => { if (active) setLoadingHistory(false) })
    return () => { active = false }
  }, [loadConversations])

  useEffect(() => {
    const item = scrollRef.current
    if (item) item.scrollTop = item.scrollHeight
  }, [messages, stageMessage])

  useEffect(() => {
    if (!selectedCitation || !document.filename.toLowerCase().endsWith('.pdf')) {
      setSourceUrl('')
      return
    }
    const controller = new AbortController()
    let objectUrl = ''
    setSourceLoading(true)
    api(`/api/documents/${document.document_id}/file`, { signal: controller.signal })
      .then((response) => response.blob())
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setSourceUrl(objectUrl)
      })
      .catch((cause) => {
        if (!(cause instanceof Error && cause.name === 'AbortError')) setChatError('The original PDF could not be opened.')
      })
      .finally(() => setSourceLoading(false))
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [api, document.document_id, document.filename, selectedCitation])


  function startNewConversation() {
    if (busy) return
    setConversationId(null)
    setMessages([])
    setQuestion('')
    setChatError('')
    if (historyRef.current) historyRef.current.open = false
  }

  async function sendQuestion(value = question) {
    const cleanQuestion = value.trim()
    if (!cleanQuestion || busy) return
    setQuestion('')
    setChatError('')
    setStageMessage('Searching your document…')
    setBusy(true)

    const userMessageId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    setMessages((current) => [
      ...current,
      { message_id: userMessageId, role: 'user', content: cleanQuestion, status: 'complete', citations: [] },
      { message_id: assistantMessageId, role: 'assistant', content: '', status: 'streaming', citations: [] },
    ])

    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const response = await api('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: document.document_id,
          conversation_id: conversationId,
          question: cleanQuestion,
        }),
        signal: controller.signal,
      })
      await consumeEventStream(response, (event, data) => {
        if (event === 'conversation' && data.conversation_id) setConversationId(data.conversation_id)
        if (event === 'status') setStageMessage(data.message ?? '')
        if (event === 'token' && data.text) {
          setMessages((current) => current.map((item) => item.message_id === assistantMessageId
            ? { ...item, content: item.content + data.text }
            : item))
        }
        if (event === 'citations') {
          const items = data.items ?? []
          setMessages((current) => current.map((item) => item.message_id === assistantMessageId
            ? { ...item, citations: items }
            : item))
        }
        if (event === 'done') {
          setMessages((current) => current.map((item) => item.message_id === assistantMessageId
            ? { ...item, content: data.content ?? item.content, status: data.status ?? 'complete' }
            : item))
          setStageMessage('')
        }
        if (event === 'error') {
          setChatError(data.message ?? 'The answer could not be completed.')
          setMessages((current) => current.map((item) => item.message_id === assistantMessageId
            ? { ...item, status: 'failed' }
            : item))
          setStageMessage('')
        }
      })
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        setMessages((current) => current.map((item) => item.message_id === assistantMessageId
          ? { ...item, status: 'cancelled' }
          : item))
      } else {
        setChatError(cause instanceof Error ? cause.message : 'Could not reach the chat service.')
        setMessages((current) => current.map((item) => item.message_id === assistantMessageId
          ? { ...item, status: 'failed' }
          : item))
      }
      setStageMessage('')
    } finally {
      controllerRef.current = null
      setBusy(false)
      try { await loadConversations(false) } catch { /* Keep the current answer visible if history refresh fails. */ }
    }
  }

  function stopAnswer() {
    controllerRef.current?.abort()
  }

  function revealCitation(messageId: string, citation: ChatCitation) {
    const details = globalThis.document.getElementById(`citation-${messageId}-${citation.source_id}`)
    const disclosure = details?.querySelector('details')
    if (disclosure) disclosure.open = true
    details?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const isPdf = document.filename.toLowerCase().endsWith('.pdf')

  return (
    <section className="chat-card" aria-label="Chat with your document">
      <div className="document-bar chat-document-bar">
        <div className="document-icon">{isPdf ? 'PDF' : 'DOCX'}</div>
        <div className="doc-meta"><strong className="ellipsis">{document.filename}</strong><span>Indexed · ready for questions</span></div>
        <details className="history-picker" ref={historyRef}>
          <summary aria-label="Open chat history">History <span>{conversations.length}</span></summary>
          <div className="history-menu">
            <button className="history-new" onClick={startNewConversation} disabled={busy}>＋ New conversation</button>
            {conversations.length === 0
              ? <p className="history-empty">Your saved conversations will appear here.</p>
              : conversations.map((item) => (
                <button key={item.conversation_id} className={`history-item ${conversationId === item.conversation_id ? 'selected' : ''}`} onClick={() => void openConversation(item.conversation_id).catch((cause) => setChatError(cause instanceof Error ? cause.message : 'Could not open that conversation.'))} disabled={busy}>
                  <strong>{item.title || 'Document question'}</strong>
                  <span>{new Date(item.updated_at).toLocaleDateString()}</span>
                </button>
              ))}
          </div>
        </details>
        <button className="text-button" onClick={onReplace} disabled={busy}>Replace</button>
      </div>

      <div className="chat-transcript" ref={scrollRef} aria-live="polite">
        {loadingHistory ? (
          <div className="chat-loading"><span className="spinner" /> Loading your saved conversations…</div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <div className="sparkle">✳</div>
            <h2>Ask your contract a question.</h2>
            <p>Answers use retrieved passages from this document. Each source quote is checked against the extracted text.</p>
            <div className="suggestion-row">
              <button onClick={() => void sendQuestion('What are the main obligations of each party?')}>What are the main obligations?</button>
              <button onClick={() => void sendQuestion('How does this agreement end or renew?')}>How does it end or renew?</button>
              <button onClick={() => void sendQuestion('What does the contract say about liability limits?')}>What are the liability limits?</button>
            </div>
          </div>
        ) : messages.map((message) => (
          <article key={message.message_id} className={`chat-message ${message.role}`}>
            <div className="message-label">{message.role === 'user' ? 'You' : 'Elcara'}{message.status === 'cancelled' ? ' · stopped' : message.status === 'failed' ? ' · incomplete' : ''}</div>
            <div className="message-content">
              {message.role === 'assistant' ? renderAnswer(message, (citation) => revealCitation(message.message_id, citation)) : message.content}
              {message.status === 'streaming' && <span className="typing-cursor" aria-label="Answer streaming" />}
            </div>
            {message.role === 'assistant' && message.citations.length > 0 && (
              <div className="message-citations" aria-label="Verified document sources">
                <div className="citation-heading">VERIFIED SOURCES</div>
                {message.citations.map((citation) => (
                  <div className="citation-card" id={`citation-${message.message_id}-${citation.source_id}`} key={citation.source_id}>
                    <details>
                      <summary><span className="citation-check">✓</span> {citation.source_id} · {citationLocation(citation, isPdf)}</summary>
                      <blockquote>{citation.quote}</blockquote>
                    </details>
                    <button className="citation-open" onClick={() => setSelectedCitation(citation)}>Open passage</button>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
        {busy && stageMessage && <div className="chat-status"><span className="spinner" />{stageMessage}</div>}
      </div>

      {(error || chatError) && <div className="inline-error" role="alert">{chatError || error}</div>}
      <form className="composer chat-composer" onSubmit={(event) => { event.preventDefault(); void sendQuestion() }}>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendQuestion()
            }
          }}
          placeholder="Ask a question about this contract…"
          aria-label="Ask a question about this contract"
          rows={1}
          disabled={loadingHistory}
        />
        {busy
          ? <button type="button" className="stop-button" onClick={stopAnswer} aria-label="Stop answer">■</button>
          : <button type="submit" aria-label="Send question" disabled={!question.trim()}>↑</button>}
      </form>
      <div className="chat-disclaimer">Answers use the most relevant retrieved passages. Search may not find every mention in a long document.</div>

      {selectedCitation && (
        <div className="source-overlay" role="presentation" onClick={() => setSelectedCitation(null)}>
          <section className="source-modal" role="dialog" aria-modal="true" aria-label="Verified source passage" onClick={(event) => event.stopPropagation()}>
            <header className="source-modal-header">
              <div><span className="eyebrow">VERIFIED SOURCE · {citationLocation(selectedCitation, isPdf)}</span><h2>Passage from {document.filename}</h2></div>
              <button className="text-button" onClick={() => setSelectedCitation(null)}>Close</button>
            </header>
            <div className={`source-modal-body ${isPdf ? 'has-pdf' : ''}`}>
              {isPdf && (
                <div className="source-pdf-viewer">
                  {sourceLoading && <div className="chat-loading"><span className="spinner" /> Opening the original PDF…</div>}
                  {sourceUrl && <Suspense fallback={<div className="chat-loading"><span className="spinner" /> Loading PDF viewer…</div>}>
                    <PdfCitationViewer key={selectedCitation.chunk_id} sourceUrl={sourceUrl} citation={selectedCitation} />
                  </Suspense>}
                </div>
              )}
              <div className="source-quote-panel">
                <div className="citation-heading">EXACT EXTRACTED TEXT</div>
                <blockquote><mark>{selectedCitation.quote}</mark></blockquote>
                <p>This passage was matched to the document text before it was shown.</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

function renderAnswer(message: ChatMessage, onCitationClick: (citation: ChatCitation) => void) {
  const citationMap = new Map(message.citations.map((citation) => [citation.source_id, citation]))
  const parts = message.content.split(SOURCE_MARKER)
  return parts.map((part, index) => {
    const citation = citationMap.get(part)
    if (citation) {
      return <button className="inline-citation" key={`${message.message_id}-${index}`} onClick={() => onCitationClick(citation)} aria-label={`Open verified source ${part}`}>{citation.source_id}</button>
    }
    if (/^S\d+$/.test(part)) return <span key={`${message.message_id}-${index}`}>[{part}]</span>
    return <span key={`${message.message_id}-${index}`}>{part}</span>
  })
}

export default DocumentChat
