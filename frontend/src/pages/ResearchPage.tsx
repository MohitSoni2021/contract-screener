import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import WorkspaceSidebar from '../components/WorkspaceSidebar'
import type { User } from '../types'
import type { AppDispatch, RootState } from '../store/store'
import { fetchDocuments } from '../store/documentsSlice'
import ReactMarkdown from 'react-markdown'

type Activity = { round?: number; tool?: string; message: string; status?: string }
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
  const { items: documents } = useSelector((state: RootState) => state.documents)
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
        if (name === 'status') setActivity((current) => [...current, { message: String(data.message ?? '') }])
        if (name === 'tool_start') setActivity((current) => [...current, { tool: String(data.tool ?? ''), message: String(data.label ?? 'Using document tool…') }])
        if (name === 'tool_result') setActivity((current) => [...current, { tool: String(data.tool ?? ''), message: String(data.summary ?? ''), status: data.ok ? 'done' : 'failed' }])
        if (name === 'answer_delta') setAnswer((current) => current ? `${current}\n\n${String(data.text ?? '')}` : String(data.text ?? ''))
        if (name === 'final') {
          const finalAnswer = data.answer as { summary?: string } | undefined
          setAnswer(String(finalAnswer?.summary ?? ''))
        }
        if (name === 'error') setError(String(data.message ?? 'Research failed.'))
      })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Research could not be completed.') }
    finally { setBusy(false) }
  }

  return <main className="fixed inset-0 z-20 flex h-dvh min-h-0 w-full overflow-hidden bg-[#f6f7f4] text-[#252b28]" aria-label="Agentic document research workspace">
    <div className="flex h-full min-h-0 w-full">
      <WorkspaceSidebar documents={documents} selectedDocumentId={documentId || null} onSelect={(document) => document.status === 'ready' && setDocumentId(document.document_id)} onAddDocument={() => navigate('/workspace')} removingId={null} onRemove={() => undefined} collapsible userName={user.name} onLogout={onLogout} />
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] ">
            <section className="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-[#f6f7f4]" aria-label="Source document research">
              <div className="flex min-h-full flex-col  bg-white p-5 shadow-[0_8px_24px_#183d2a0a] md:p-7">
                <div className="mb-7">
                  <div className="mb-2 text-[10px] font-bold tracking-[.14em] text-[#859188]">SOURCE DOCUMENT</div>
                  <label className="block text-xs font-semibold text-[#52665a]">Choose a ready document
                    <select className="mt-2 block w-full rounded-md border border-[#dce6df] bg-[#fbfcfa] px-3 py-2.5 text-xs font-normal text-[#3f584a] outline-none transition focus:border-[#78a489] focus:ring-2 focus:ring-[#dcece1]" value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
                      <option value="">Select a ready document</option>
                      {ready.map((document) => <option key={document.document_id} value={document.document_id}>{document.filename}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block text-xs font-semibold text-[#52665a]">Research question
                  <textarea className="mt-2 block min-h-[150px] w-full resize-y rounded-md border border-[#dce6df] bg-[#fbfcfa] px-3 py-3 text-sm font-normal leading-6 text-[#34443a] outline-none transition focus:border-[#78a489] focus:ring-2 focus:ring-[#dcece1]" value={question} onChange={(event) => setQuestion(event.target.value)} rows={5} />
                </label>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button className="rounded-md bg-[#285f4d] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#1b4d3f] disabled:cursor-not-allowed disabled:bg-[#a7b9ad]" onClick={() => void runResearch()} disabled={busy || !documentId}>{busy ? 'Researching…' : 'Start research'}</button>
                  <button className="rounded-md border border-[#dce6df] bg-white px-4 py-2.5 text-xs font-medium text-[#557063] transition hover:border-[#a9c4b0] hover:bg-[#f5f9f5] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void runResearch('Find every clause about termination, notice, and renewal, then explain the practical deadlines.')} disabled={busy || !documentId}>Run demo flow</button>
                </div>
                {error && <div className="mt-4 rounded-md border border-[#efd2ce] bg-[#fff5f3] px-3 py-2 text-xs text-[#a4483f]" role="alert">{error}</div>}
                <div className="mt-8 border-t border-[#edf1ed] pt-6">
                  <div className="flex items-center justify-between gap-4"><div className="text-[10px] font-bold tracking-[.14em] text-[#859188]">SOURCE-GROUNDED ANSWER</div><span className="rounded-full bg-[#edf2ee] px-2 py-1 text-[9px] font-semibold text-[#557462]">{busy ? 'Researching' : answer ? 'Verified' : 'Ready'}</span></div>
                  {answer ? <article className="mt-4 text-sm leading-7 text-[#34443a]"><ReactMarkdown>{answer}</ReactMarkdown></article> : <p className="m-0 mt-4 text-xs leading-5 text-[#819087]">Your human-readable, source-grounded answer will appear here.</p>}
                </div>
                <div className="mt-auto border-t border-[#edf1ed] pt-6 text-[10px] leading-5 text-[#89958d]">Bounded to a configurable maximum of 4 rounds and 3,200 model tokens. Tool calls and unsupported evidence are rejected safely.</div>
              </div>
            </section>
            <aside className="flex min-h-0 flex-col border-t border-[#e1e8e2] bg-[#fbfcfa] lg:border-l lg:border-t-0" aria-label="Research process logs">
              <div className="flex shrink-0 items-center justify-between border-b border-[#e6ece7] bg-white px-5 py-4">
                <div><div className="text-[10px] font-bold tracking-[.14em] text-[#859188]">PROCESS LOGS</div><p className="m-0 mt-1 text-xs text-[#718178]">Tool decisions and document reads</p></div>
                <span className="rounded-full bg-[#edf2ee] px-2 py-1 text-[9px] font-semibold text-[#557462]">{activity.length}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {activity.length === 0 ? <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center"><span className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-[#eaf2ec] text-lg text-[#528067]">⌁</span><p className="m-0 max-w-[190px] text-xs leading-5 text-[#819087]">Each search decision and tool call will appear here.</p></div> : <div className="space-y-2">{activity.map((item, index) => <div className="rounded-lg border border-[#e1e9e2] bg-white p-3" key={`${item.round}-${item.tool}-${index}`}><div className="flex items-center justify-between gap-2 text-[9px] font-bold tracking-[.1em] text-[#779080]"><span>{item.tool ? 'TOOL' : 'STATUS'}</span>{item.status && <span className={item.status === 'failed' ? 'text-[#a4483f]' : 'text-[#4d8066]'}>{item.status}</span>}</div><p className="m-0 mt-2 text-xs leading-5 text-[#56685d]">{item.message}</p></div>)}</div>}
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>
  </main>
}

export default ResearchPage
