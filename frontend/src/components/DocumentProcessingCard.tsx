import { Check, AlertTriangle, FilePenLine, GitCompare } from 'lucide-react'
import type { UploadedDocument } from '../types'

type DocumentProcessingCardProps = {
  document: UploadedDocument
  removing: boolean
  onRemove: () => void
  onOpenChat: () => void
  onOpenRedline?: () => void
  onCompare?: () => void
}

function DocumentProcessingCard({ document, removing, onRemove, onOpenChat, onOpenRedline, onCompare }: DocumentProcessingCardProps) {
  const failed = document.status === 'failed'
  const ready = document.status === 'ready'
  const progress = Math.max(0, Math.min(100, document.progress ?? 0))

  return (
    <section className={`processing-card document-tile ${failed ? 'document-tile-failed' : ready ? 'document-tile-ready' : 'document-tile-progress'}`} aria-live="polite" aria-busy={!failed && !ready}>
      <div className="document-tile-header">
        <div className={`processing-icon ${failed ? 'failed' : ready ? 'ready' : ''}`}>
        {failed ? <AlertTriangle className="h-3.5 w-3.5" /> : ready ? <Check className="h-3.5 w-3.5" /> : <span className="spinner" />}
        </div>
        <span className="document-status">{failed ? 'Needs attention' : ready ? 'Ready to chat' : 'Indexing'}</span>
      </div>
      <div className="processing-filetype">{document.filename.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX'}</div>
      <h2>{failed ? 'Couldn’t prepare this file' : ready ? 'Ready for questions' : 'Preparing this file'}</h2>
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
        {ready && (
          <>
            <button className="primary-button processing-chat-button" onClick={onOpenChat}>
              Open chat <span>→</span>
            </button>
            {onCompare && (
              <button
                className="secondary-button"
                onClick={onCompare}
                title="Compare against another contract draft"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '7px 11px',
                  borderRadius: '7px',
                  border: '1px solid #c9ded0',
                  background: '#f4f9f5',
                  color: '#2b5a3f',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <GitCompare className="h-3 w-3" /> Compare
              </button>
            )}
            {onOpenRedline && (
              <button
                className="secondary-button"
                onClick={onOpenRedline}
                title="Propose contract redlines & export Word tracked changes"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '7px 11px',
                  borderRadius: '7px',
                  border: '1px solid #c9ded0',
                  background: '#f4f9f5',
                  color: '#2b5a3f',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <FilePenLine className="h-3 w-3" /> Redline
              </button>
            )}
          </>
        )}
        {(ready || failed) && <button className="text-button" onClick={onRemove} disabled={removing}>{removing ? 'Removing…' : 'Remove document'}</button>}
      </div>
      {!ready && !failed && <p className="processing-footnote">You can keep this page open. Progress updates automatically.</p>}
    </section>
  )
}

export default DocumentProcessingCard
