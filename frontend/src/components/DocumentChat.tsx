import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { Sparkles, ArrowLeft, PanelLeftClose, PanelLeft, GitCompare, FileText } from 'lucide-react'
import type { ChatCitation, ChatConversation, ChatCoverage, ChatMessage, UploadedDocument, User } from '../types'
import Brand from './Brand'
import { apiUrl } from '../config'

const PdfCitationViewer = lazy(() => import('./PdfCitationViewer'))

type DocumentChatProps = {
  document: UploadedDocument
  token: string
  error: string
  user: User
  onLogout: () => void
}

type StreamEvent = {
  conversation_id?: string
  stage?: string
  message?: string
  text?: string
  items?: ChatCitation[]
  mode?: ChatCoverage['mode']
  complete?: boolean
  source_count?: number
  total_chunks?: number
  verified_chunks?: number
  covered_chunks?: number
  sections?: number
  page_ranges?: number
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

function DocumentChat({ document, token, error, user, onLogout }: DocumentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const isPdf = document.filename.toLowerCase().endsWith('.pdf')
  const [busy, setBusy] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [stageMessage, setStageMessage] = useState('')
  const [chatError, setChatError] = useState('')
  const [selectedCitation, setSelectedCitation] = useState<ChatCitation | null>(null)
  const [originalDocumentOpen, setOriginalDocumentOpen] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)
  const [conversationMenu, setConversationMenu] = useState<{ conversation: ChatConversation; x: number; y: number } | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false)

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(apiUrl(path), {
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
    setSelectedCitation(null)
    setMessages(result.messages as ChatMessage[])
    setChatError('')
    if (window.matchMedia('(max-width: 1023px)').matches) setSidebarOpen(false)
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
    function closeMenu() { setConversationMenu(null) }
    globalThis.document.addEventListener('click', closeMenu)
    globalThis.document.addEventListener('scroll', closeMenu, true)
    return () => {
      globalThis.document.removeEventListener('click', closeMenu)
      globalThis.document.removeEventListener('scroll', closeMenu, true)
    }
  }, [])

  useEffect(() => {
    const item = scrollRef.current
    if (item) item.scrollTop = item.scrollHeight
  }, [messages, stageMessage])

  const activeAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const verifiedCitations = activeAssistant?.citations?.filter((citation) => citation.verified) ?? []
  const allVerifiedCitations = messages.flatMap((message) => (message.citations ?? []).filter((citation) => citation.verified))

  useEffect(() => {
    const selectedIsLoaded = selectedCitation
      ? allVerifiedCitations.some((citation) => citation.chunk_id === selectedCitation.chunk_id)
      : false
    if (!selectedIsLoaded) setSelectedCitation(verifiedCitations[0] ?? null)
  }, [conversationId, activeAssistant?.message_id, activeAssistant?.citations, selectedCitation, allVerifiedCitations, verifiedCitations])

  useEffect(() => {
    if (!selectedCitation && !originalDocumentOpen) {
      setSourceUrl('')
      setSourceLoading(false)
      return
    }
    const controller = new AbortController()
    let active = true
    let objectUrl = ''
    setSourceUrl('')
    setSourceLoading(true)
    const filePath = isPdf
      ? `/api/documents/${document.document_id}/file`
      : `/api/documents/${document.document_id}/file?format=pdf`
    api(filePath, { signal: controller.signal })
      .then((response) => response.blob())
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setSourceUrl(objectUrl)
      })
      .catch((cause) => {
        if (active && !(cause instanceof Error && cause.name === 'AbortError')) setChatError('The document preview could not be opened.')
      })
      .finally(() => { if (active) setSourceLoading(false) })
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [api, document.document_id, document.filename, isPdf, originalDocumentOpen, selectedCitation])


  function startNewConversation() {
    if (busy) return
    setConversationId(null)
    setMessages([])
    setQuestion('')
    setChatError('')
    setSelectedCitation(null)
    if (window.matchMedia('(max-width: 1023px)').matches) setSidebarOpen(false)
  }

  async function deleteConversation(conversation: ChatConversation) {
    setConversationMenu(null)
    try {
      await api(`/api/conversations/${conversation.conversation_id}`, { method: 'DELETE' })
      setConversations((current) => current.filter((item) => item.conversation_id !== conversation.conversation_id))
      if (conversationId === conversation.conversation_id) startNewConversation()
    } catch (cause) {
      setChatError(cause instanceof Error ? cause.message : 'Could not delete that conversation.')
    }
  }

  async function sendQuestion(value = question) {
    const cleanQuestion = value.trim()
    if (!cleanQuestion || busy) return
    setQuestion('')
    setChatError('')
    setStageMessage('Searching your document…')
    setSelectedCitation(null)
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
        if (event === 'coverage') {
          const coverage = data as ChatCoverage
          setMessages((current) => current.map((item) => item.message_id === assistantMessageId
            ? { ...item, coverage }
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
    setSelectedCitation(citation)
    const details = globalThis.document.getElementById(`citation-${messageId}-${citation.source_id}`)
    const disclosure = details?.querySelector('details')
    if (disclosure) disclosure.open = true
    details?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const sourcePanelStatus = busy ? stageMessage || 'Verifying source passages…' : loadingHistory ? 'Loading saved sources…' : ''

  return (
    <main className="fixed inset-0 z-20 flex h-dvh min-h-0 w-full overflow-hidden bg-[#f6f7f4] text-[#252b28]" aria-label="Chat with your document">
      {sidebarOpen && <button aria-label="Close sidebar" className="fixed inset-0 z-30 bg-[#17251d]/35 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[min(84vw,300px)] flex-col border-r border-[#e5eae5] bg-white px-4 pb-4 pt-4 shadow-xl transition-transform duration-200 lg:relative lg:z-10 lg:w-[288px] lg:shrink-0 lg:shadow-none ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:-ml-[288px] lg:translate-x-0'}`} aria-label="Document and conversation sidebar" aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
        <div className="flex h-11 items-center justify-between">
          <Brand home />
          <Link
            to="/workspace"
            className="flex items-center gap-1.5 rounded-lg border border-[#d2ded5] bg-[#f7faf8] px-2.5 py-1 text-xs font-semibold text-[#25523a] transition hover:bg-[#ebf3ed]"
            title="Return to Workspace"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Workspace</span>
          </Link>
        </div>
        <button className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-[#245d4d] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1b4d3f] disabled:opacity-50" onClick={startNewConversation} disabled={busy}>＋ <span>New conversation</span></button>
        <section className="mt-6 min-w-0" aria-label="Active source document">
          <div className="mb-2 px-1 text-[10px] font-bold tracking-[.14em] text-[#859188]">YOUR SOURCE</div>
          <button className="flex w-full min-w-0 items-start gap-3 rounded-lg border border-[#e7ece7] bg-[#fafbf9] p-3 text-left transition hover:border-[#bfd2c4] hover:bg-[#f5f9f5]" onClick={() => setOriginalDocumentOpen(true)}>
            <span className="rounded bg-[#f8e9e7] px-1.5 py-1 text-[9px] font-bold text-[#ad534b]">{isPdf ? 'PDF' : 'DOCX'}</span>
            <div className="min-w-0 flex-1"><p className="m-0 break-words text-xs font-semibold leading-5 text-[#33463b]" title={document.filename}>{document.filename}</p><p className="mt-1 flex items-center gap-1.5 text-[10px] text-[#688071]"><i className="h-1.5 w-1.5 rounded-full bg-[#619572]" /> Indexed and ready</p></div>
          </button>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[10px] text-[#78857c]"><span>{document.indexed_chunks.toLocaleString()} passages</span>{document.page_count != null && isPdf && <span>{document.page_count.toLocaleString()} pages</span>}</div>
          <p className="mt-3 px-1 text-[10px] leading-4 text-[#89958d]">Answers use this private document only.</p>
        </section>
        <section className="mt-6 flex min-h-0 flex-1 flex-col" aria-label="Saved conversations">
          <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-bold tracking-[.14em] text-[#859188]"><span>CONVERSATIONS</span><span className="rounded-full bg-[#edf2ee] px-2 py-0.5 text-[9px] tracking-normal text-[#557462]">{conversations.length}</span></div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {loadingHistory ? <p className="px-2 py-3 text-xs text-[#829087]">Loading conversations…</p> : conversations.length === 0 ? <p className="px-2 py-3 text-xs leading-5 text-[#89958d]">Saved conversations will appear here.</p> : conversations.map((item) => <button key={item.conversation_id} className={`flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition hover:bg-[#f3f6f3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#54806a] ${conversationId === item.conversation_id ? 'bg-[#eaf1ed] text-[#285b4c]' : 'text-[#526158]'}`} onClick={() => void openConversation(item.conversation_id).catch((cause) => setChatError(cause instanceof Error ? cause.message : 'Could not open that conversation.'))} onContextMenu={(event) => { event.preventDefault(); setConversationMenu({ conversation: item, x: event.clientX, y: event.clientY }) }} disabled={busy} aria-current={conversationId === item.conversation_id ? 'page' : undefined}><span className="w-full truncate text-xs font-medium">{item.title || 'Document question'}</span><span className="text-[10px] text-[#8a968e]">{new Date(item.updated_at).toLocaleDateString()}</span></button>)}
          </div>
        </section>
        <div className="mt-4 border-t border-[#e9ede9] pt-3"><div className="flex items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e5ece8] text-xs font-bold text-[#35584c]">{user.name.trim().charAt(0).toUpperCase() || 'U'}</span><span className="min-w-0 flex-1 truncate text-xs text-[#526158]">{user.name}</span><button className="rounded px-2 py-1 text-[10px] text-[#557063] hover:bg-[#f1f4f1]" onClick={onLogout}>Sign out</button></div></div>
      </aside>
      {conversationMenu && <div className="document-context-menu" style={{ left: conversationMenu.x, top: conversationMenu.y }} onClick={(event) => event.stopPropagation()}><button onClick={() => { setConversationMenu(null); void openConversation(conversationMenu.conversation.conversation_id).catch((cause) => setChatError(cause instanceof Error ? cause.message : 'Could not open that conversation.')) }} disabled={busy}>Open conversation</button><button className="danger-action" onClick={() => void deleteConversation(conversationMenu.conversation)} disabled={busy}>Delete conversation</button></div>}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top Header Bar for Chat with Back to Workspace */}
        <header className="shrink-0 flex items-center justify-between border-b border-[#e1e9e3] bg-white px-3 sm:px-5 py-2.5 shadow-2xs z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-lg border border-[#e4e9e4] bg-[#f8faf8] text-[#486454] shadow-2xs hover:bg-[#edf3ee] transition cursor-pointer shrink-0"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </button>

            <Link
              to="/workspace"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#c9ded0] bg-[#f2f8f4] px-3 py-1.5 text-xs font-semibold text-[#1e4e34] hover:bg-[#e4f1e8] hover:border-[#1e4e34] transition shadow-2xs cursor-pointer shrink-0"
              title="Return to Workspace"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Workspace</span>
            </Link>

            <div className="hidden sm:flex items-center gap-2 border-l border-[#e5eae5] pl-3 text-xs text-[#52655a] min-w-0">
              <span className="font-semibold text-[#203c2d] truncate max-w-[180px] md:max-w-[320px]" title={document.filename}>
                {document.filename}
              </span>
              <span className="rounded bg-[#f0f5f1] text-[#2c5a44] px-1.5 py-0.5 text-[10px] font-mono font-medium shrink-0">
                {isPdf ? 'PDF' : 'DOCX'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              to={`/compare-doc?left=${document.document_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3ded6] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#415e4f] hover:bg-[#f3f7f4] transition shadow-2xs"
              title="Compare this document with another draft"
            >
              <GitCompare className="h-3.5 w-3.5 text-[#3b6f52]" />
              <span className="hidden md:inline">Compare</span>
            </Link>

            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3ded6] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#415e4f] hover:bg-[#f3f7f4] transition shadow-2xs cursor-pointer"
              onClick={() => setOriginalDocumentOpen(true)}
              title="View original document"
            >
              <FileText className="h-3.5 w-3.5 text-[#3b6f52]" />
              <span className="hidden md:inline">View Original</span>
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 py-6 md:px-10" ref={scrollRef} aria-live="polite">
            {loadingHistory ? (
              <div className="m-auto flex items-center justify-center gap-2 py-10 text-xs text-[#829087]" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#cad9d0] border-t-[#3c765d]" /> Loading your saved conversations…</div>
            ) : messages.length === 0 ? (
              <div className="m-auto flex w-full max-w-[680px] flex-col items-center justify-center px-3 py-8 text-center">
                <div className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-[#e8f0eb] font-[Manrope] text-2xl font-extrabold text-[#32664f]" aria-hidden="true">e</div>
                <h2 className="m-0 font-[Manrope] text-xl font-semibold tracking-[-.04em] text-[#283c33] md:text-2xl">What would you like to understand?</h2>
                <p className="mb-6 mt-2 max-w-md text-sm leading-6 text-[#7d8981]">Ask a question about the clauses, obligations, or terms in your document.</p>
                <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-3">
                  <button className="rounded-lg border border-[#e2e9e3] bg-white px-3 py-3 text-left text-xs leading-5 text-[#51675a] transition hover:border-[#b8cec0] hover:bg-[#f7faf7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#54806a]" onClick={() => void sendQuestion('What are the main obligations of each party?')}>Summarize the key obligations <span className="mt-1 block text-[10px] text-[#87958b]">Parties &amp; responsibilities</span></button>
                  <button className="rounded-lg border border-[#e2e9e3] bg-white px-3 py-3 text-left text-xs leading-5 text-[#51675a] transition hover:border-[#b8cec0] hover:bg-[#f7faf7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#54806a]" onClick={() => void sendQuestion('How does this agreement end or renew?')}>Explain termination and renewal <span className="mt-1 block text-[10px] text-[#87958b]">Dates &amp; notice periods</span></button>
                  <button className="rounded-lg border border-[#e2e9e3] bg-white px-3 py-3 text-left text-xs leading-5 text-[#51675a] transition hover:border-[#b8cec0] hover:bg-[#f7faf7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#54806a]" onClick={() => void sendQuestion('What does the contract say about liability limits?')}>Find the liability limits <span className="mt-1 block text-[10px] text-[#87958b]">Risk &amp; remedies</span></button>
                </div>
              </div>
            ) : messages.map((message) => (
              <article key={message.message_id} className={`mb-8 w-full ${message.role === 'user' ? 'ml-auto max-w-[min(760px,92%)]' : 'mx-auto max-w-[820px]'}`}>
                <div className={`mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-[#839087] ${message.role === 'user' ? 'justify-end' : ''}`}><span className={message.role === 'assistant' ? 'grid h-6 w-6 place-items-center rounded-md bg-[#e8f0eb] font-[Manrope] text-sm font-extrabold normal-case text-[#32664f]' : 'hidden'}>e</span>{message.role === 'user' ? 'You' : 'Elcara'}{message.status === 'cancelled' ? ' · stopped' : message.status === 'failed' ? ' · incomplete' : ''}</div>
                <div className={`break-words text-sm leading-7 ${message.role === 'user' ? 'whitespace-pre-wrap ml-auto w-fit max-w-full rounded-2xl rounded-br-sm bg-[#e8f0eb] px-4 py-3 text-[#2f4f3f]' : 'max-w-full pl-0 text-[14px] leading-[1.85] text-[#34443a] md:text-[15px]'}`}>
                  {message.role === 'assistant' ? renderAnswer(message, (citation) => revealCitation(message.message_id, citation)) : message.content}
                  {message.status === 'streaming' && <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-sm bg-[#579070] align-middle" aria-label="Answer streaming" />}
                </div>
                {message.role === 'assistant' && message.coverage && message.coverage.mode !== 'focused' && (
                  <div className={`coverage-note ${message.coverage.complete ? '' : 'coverage-partial'}`}>
                    {message.coverage.complete ? 'Coverage checked' : 'Partial coverage'} · {message.coverage.covered_chunks ?? message.coverage.source_count} of {message.coverage.total_chunks ?? message.coverage.source_count} indexed sections supplied
                    {message.coverage.page_ranges ? ` · ${message.coverage.page_ranges} page ranges` : ''}
                  </div>
                )}
                {message.role === 'assistant' && (message.citations ?? []).some((citation) => citation.verified) && (
                  <div className="message-citations" aria-label="Verified document sources">
                    <div className="citation-heading">VERIFIED SOURCES</div>
                    {(message.citations ?? []).filter((citation) => citation.verified).map((citation) => (
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
            {busy && stageMessage && <div className="mx-auto mb-3 flex w-full max-w-[820px] items-center gap-2 text-xs text-[#738178]" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#cad9d0] border-t-[#3c765d]" />{stageMessage}</div>}
          </div>
          {(error || chatError) && <div className="mx-4 mt-2 text-xs text-[#a4483f]" role="alert">{chatError || error}</div>}
          <form className="mx-4 mb-1 mt-3 flex shrink-0 items-end gap-2 rounded-xl border border-[#dfe6e0] bg-white p-2 shadow-[0_3px_12px_#183d2a0b] md:mx-auto md:w-[min(760px,calc(100%-3rem))]" onSubmit={(event) => { event.preventDefault(); void sendQuestion() }}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendQuestion()
                }
              }}
              className="max-h-32 min-w-0 flex-1 resize-y border-0 bg-transparent px-2 py-2 text-sm leading-6 text-[#48574e] outline-none placeholder:text-[#a3aca6]"
              placeholder="Ask anything about your document…"
              aria-label="Ask a question about this document"
              rows={1}
              disabled={loadingHistory}
            />
            {busy
              ? <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#f0d4d0] bg-[#fff2ef] text-xs text-[#a4483f]" onClick={stopAnswer} aria-label="Stop answer">■</button>
              : <button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#245d4d] text-lg text-white hover:bg-[#1b4d3f] disabled:cursor-not-allowed disabled:opacity-40" type="submit" aria-label="Send question" disabled={!question.trim()}>↑</button>}
          </form>
          <div className="shrink-0 px-3 pb-3 pt-1 text-center text-[9px] leading-4 text-[#929d95]">Answers are grounded in retrieved passages from this document. Verify important terms in the cited source.</div>
        </div>
      </div>
      <aside className={`source-panel ${sourcePanelOpen ? 'source-panel-open' : ''}`} aria-label="Verified document sources">
        <button className="source-panel-toggle" type="button" onClick={() => setSourcePanelOpen((open) => !open)} aria-expanded={sourcePanelOpen}>
          <span><span className="source-panel-toggle-icon">⌕</span> Sources{verifiedCitations.length > 0 ? ` · ${verifiedCitations.length}` : ''}</span>
          <span className="source-panel-toggle-chevron">{sourcePanelOpen ? '⌄' : '⌃'}</span>
        </button>
        <div className="source-panel-content">
          <header className="source-panel-header">
            <div><div className="citation-heading">VERIFIED SOURCES</div><h2>{selectedCitation ? `Passage ${selectedCitation.source_id}` : 'Document sources'}</h2></div>
            {selectedCitation && <span className="source-verified-badge">✓ Verified</span>}
          </header>
          {sourcePanelStatus && <div className="source-panel-status" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#cad9d0] border-t-[#3c765d]" />{sourcePanelStatus}</div>}
          {!sourcePanelStatus && verifiedCitations.length === 0 && <div className="source-panel-empty"><span className="source-empty-mark flex items-center justify-center"><Sparkles className="h-4 w-4 text-[#738e7d]" /></span><strong>Sources will appear here</strong><p>Verified source passages from your answer will be shown in this panel.</p></div>}
          {verifiedCitations.length > 0 && <div className="source-panel-body">
            <div className="source-panel-list" aria-label="Verified source passages">
              {verifiedCitations.map((citation) => <button key={citation.chunk_id} type="button" className={`source-panel-card ${selectedCitation?.chunk_id === citation.chunk_id ? 'selected' : ''}`} onClick={() => setSelectedCitation(citation)}><span className="source-panel-card-top"><span className="citation-check">✓</span><strong>{citation.source_id}</strong><span>{citationLocation(citation, isPdf)}</span></span><span className="source-panel-card-quote">{citation.quote}</span></button>)}
            </div>
            {selectedCitation && <div className="source-panel-viewer">
              {sourceLoading && <div className="source-panel-viewer-status" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#cad9d0] border-t-[#3c765d]" />Opening source…</div>}
              {sourceUrl && <Suspense fallback={<div className="source-panel-viewer-status" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#cad9d0] border-t-[#3c765d]" />Loading PDF viewer…</div>}><PdfCitationViewer key={selectedCitation.chunk_id} sourceUrl={sourceUrl} citation={selectedCitation} /></Suspense>}
            </div>}
          </div>}
        </div>
      </aside>
      {originalDocumentOpen && (
        <div className="source-overlay" role="presentation" onClick={() => { setSelectedCitation(null); setOriginalDocumentOpen(false) }}>
          <section className={`source-modal ${originalDocumentOpen ? 'original-document-modal' : ''}`} role="dialog" aria-modal="true" aria-label={originalDocumentOpen ? 'Original document' : 'Verified source passage'} onClick={(event) => event.stopPropagation()}>
            <header className="source-modal-header">
              <div><span className="eyebrow">{originalDocumentOpen ? 'ORIGINAL DOCUMENT' : `VERIFIED SOURCE · ${citationLocation(selectedCitation!, isPdf)}`}</span><h2>{originalDocumentOpen ? document.filename : `Passage from ${document.filename}`}</h2></div>
              <button className="text-button" onClick={() => { setSelectedCitation(null); setOriginalDocumentOpen(false) }}>Close</button>
            </header>
            <div className={`source-modal-body has-pdf ${originalDocumentOpen ? 'original-document-body' : ''}`}>
              <div className="source-pdf-viewer">
                {sourceLoading && <div className="m-auto flex items-center gap-2 text-xs text-[#829087]" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#cad9d0] border-t-[#3c765d]" /> Opening the original document…</div>}
                {sourceUrl && <Suspense fallback={<div className="m-auto flex items-center gap-2 text-xs text-[#829087]" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#cad9d0] border-t-[#3c765d]" /> Loading PDF viewer…</div>}>
                  <PdfCitationViewer key={selectedCitation?.chunk_id ?? 'original-document'} sourceUrl={sourceUrl} citation={selectedCitation} />
                </Suspense>}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function renderAnswer(message: ChatMessage, onCitationClick: (citation: ChatCitation) => void) {
  const citationMap = new Map((message.citations ?? []).filter((citation) => citation.verified).map((citation) => [citation.source_id, citation]))
  const markdown = message.content.replace(SOURCE_MARKER, (_, sourceId: string) => `[${sourceId}](#verified-${sourceId})`)
  return <div className="markdown-answer">
    <ReactMarkdown
      components={{
        a: ({ href, children }) => {
          const sourceId = href?.match(/^#verified-(S\d+)$/)?.[1]
          const citation = sourceId ? citationMap.get(sourceId) : undefined
          if (citation) {
            return <button className="inline-citation" onClick={() => onCitationClick(citation)} aria-label={`Open verified source ${sourceId}`}>{sourceId}</button>
          }
          return <a href={href}>{children}</a>
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  </div>
}

export default DocumentChat
