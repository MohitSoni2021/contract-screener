import type { UploadedDocument } from '../types'

type DocumentProcessingCardProps = {
  document: UploadedDocument
  removing: boolean
  onRemove: () => void
  onOpenChat: () => void
}

function DocumentProcessingCard({ document, removing, onRemove, onOpenChat }: DocumentProcessingCardProps) {
  const failed = document.status === 'failed'
  const ready = document.status === 'ready'
  const progress = Math.max(0, Math.min(100, document.progress ?? 0))

  return (
    <section className="processing-card" aria-live="polite" aria-busy={!failed && !ready}>
      <div className={`processing-icon ${failed ? 'failed' : ready ? 'ready' : ''}`}>
        {failed ? '!' : ready ? '✓' : <span className="spinner" />}
      </div>
      <div className="processing-filetype">{document.filename.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX'}</div>
      <h2>{failed ? 'We couldn’t prepare this document' : ready ? 'Your document is ready' : 'Preparing your document'}</h2>
      <p className="processing-filename" title={document.filename}>{document.filename}</p>
      <div className="progress-track" role="progressbar" aria-label="Document processing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="progress-caption"><span>{document.stage || 'Waiting to start'}</span><strong>{progress}%</strong></div>
      {document.chunk_count != null && !failed && (
        <p className="index-count">{document.indexed_chunks} of {document.chunk_count} sections saved to your private search index</p>
      )}
      {failed && <div className="error-message processing-error" role="alert">{document.error || 'Please check your service settings and try again.'}</div>}
      {ready && <p className="ready-note">Your document is indexed privately and ready for questions.</p>}
      <div className="processing-actions">
        {ready && <button className="primary-button processing-chat-button" onClick={onOpenChat}>Open document chat <span>→</span></button>}
        {(ready || failed) && <button className="text-button" onClick={onRemove} disabled={removing}>{removing ? 'Removing…' : 'Remove document'}</button>}
      </div>
      {!ready && !failed && <p className="processing-footnote">You can keep this page open. Progress updates automatically.</p>}
    </section>
  )
}

export default DocumentProcessingCard
