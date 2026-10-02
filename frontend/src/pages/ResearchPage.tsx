import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import WorkspaceSidebar from '../components/WorkspaceSidebar'
import type { User } from '../types'
import type { AppDispatch, RootState } from '../store/store'
import { fetchDocuments } from '../store/documentsSlice'

type Activity = { round?: number; tool?: string; message: string }
type ResearchPageProps = { user: User; token: string; onLogout: () => void }

async function consumeEvents(response: Response, onEvent: (name: string, data: Record<string, unknown>) => void) {
  if (!response.body) throw new Error('Research stream unavailable.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = frame.match(/^event: (.+)$/m)?.[1]
      const data = frame.match(/^data: (.+)$/m)?.[1]
      if (event && data) onEvent(event, JSON.parse(data) as Record<string, unknown>)
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
}

function ResearchPage({ user, token, onLogout }: ResearchPageProps) {
  const dispatch = useDispatch<AppDispatch>()
  const navigate = useNavigate()
  const { items: documents, loading } = useSelector((state: RootState) => state.documents)
  const ready = documents.filter((document) => document.status === 'ready')
  const [documentId, setDocumentId] = useState('')
  const [question, setQuestion] = useState('What are the key obligations, deadlines, and liability risks in this document?')
  const [activity, setActivity] = useState<Activity[]>([])
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { void dispatch(fetchDocuments({ token })) }, [dispatch, token])

  async function runResearch(prompt = question) {
    if (!documentId || !prompt.trim() || busy) return
    setBusy(true); setError(''); setAnswer(''); setActivity([])
    try {
      const response = await fetch('/api/research/stream', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ document_id: documentId, question: prompt }) })
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(body.detail ?? 'Research could not be started.') }
      await consumeEvents(response, (name, data) => {
        if (name === 'activity') setActivity((current) => [...current, { round: data.round as number | undefined, tool: data.tool as string | undefined, message: String(data.message ?? '') }])
        if (name === 'token') setAnswer(String(data.text ?? ''))
        if (name === 'done') setAnswer(String(data.content ?? ''))
        if (name === 'error') setError(String(data.message ?? 'Research failed.'))
      })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Research could not be completed.') }
    finally { setBusy(false) }
  }

  return <main className="comparison-app-shell research-app-shell" aria-label="Agentic document research workspace"><div className="comparison-workspace"><WorkspaceSidebar documents={documents} selectedDocumentId={documentId || null} onSelect={(document) => document.status === 'ready' && setDocumentId(document.document_id)} onAddDocument={() => navigate('/workspace')} removingId={null} onRemove={() => undefined} collapsible userName={user.name} onLogout={onLogout} /><section className="comparison-main-panel research-main-panel"><div className="page-heading dashboard-heading"><div><div className="eyebrow">PART C · AGENTIC RESEARCH</div><h1>Ask the document to investigate.</h1><p>The agent plans bounded research rounds, uses strict document tools, and shows its work before answering.</p></div><div className="secure-badge"><span>✳</span> Verified evidence only</div></div><div className="research-grid"><section className="research-console"><label>Source document<select value={documentId} onChange={(event) => setDocumentId(event.target.value)}><option value="">Select a ready document</option>{ready.map((document) => <option key={document.document_id} value={document.document_id}>{document.filename}</option>)}</select></label><label>Research question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} /></label><div className="research-actions"><button className="comparison-button" onClick={() => void runResearch()} disabled={busy || !documentId}>{busy ? 'Researching…' : 'Start research'}</button><button className="research-demo-button" onClick={() => void runResearch('Find every clause about termination, notice, and renewal, then explain the practical deadlines.')} disabled={busy || !documentId}>Run demo flow</button></div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="research-limit-note">Bounded to a configurable maximum of 4 rounds and 3,200 model tokens. Tool calls and unsupported evidence are rejected safely.</div></section><section className="research-output"><div className="research-output-header"><span className="eyebrow">LIVE RESEARCH TRACE</span><span>{busy ? 'Working' : 'Ready'}</span></div><div className="research-activity">{activity.length === 0 ? <p className="research-placeholder">Each search decision and tool call will appear here.</p> : activity.map((item, index) => <div className="research-activity-item" key={`${item.round}-${item.tool}-${index}`}><span>{item.tool ? 'TOOL' : `ROUND ${item.round ?? ''}`}</span><p>{item.message}</p></div>)}</div>{answer && <article className="research-answer"><div className="eyebrow">SOURCE-GROUNDED ANSWER</div><p>{answer}</p></article>}</section></div><footer className="page-footer"><span>ELCARA CONTRACT INTELLIGENCE</span><span>Agent research · Part C</span></footer></section></div></main>
}

export default ResearchPage
