import { useState } from 'react'
import type { UploadedDocument } from '../types'

type DocumentChatProps = {
  document: UploadedDocument
  error: string
  onReplace: () => void
}

function DocumentChat({ document, error, onReplace }: DocumentChatProps) {
  const [question, setQuestion] = useState('')

  return (
    <section className="chat-card">
      <div className="document-bar">
        <div className="document-icon">{document.filename.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX'}</div>
        <div className="doc-meta"><strong className="ellipsis">{document.filename}</strong><span>{document.status === 'uploaded' ? 'Uploaded · processing is not connected yet' : document.status}</span></div>
        <button className="text-button" onClick={onReplace}>Replace</button>
      </div>
      <div className="chat-empty">
        <div className="sparkle">✳</div>
        <h2>Your contract is ready for a closer look.</h2>
        <p>Ask about obligations, dates, termination, or anything else in the document.</p>
        <div className="suggestion-row">
          <button onClick={() => setQuestion('What are the main obligations?')}>What are the main obligations?</button>
          <button onClick={() => setQuestion('How can this agreement be terminated?')}>How can it be terminated?</button>
        </div>
        <div className="starter-notice">Chat and document processing are placeholders in this starter.</div>
      </div>
      <form className="composer" onSubmit={(event) => { event.preventDefault() }}>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question about your contract…" aria-label="Ask a question" />
        <button type="submit" aria-label="Send question">↑</button>
      </form>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="chat-disclaimer">Answers will include verified quotes from your source document.</div>
    </section>
  )
}

export default DocumentChat
