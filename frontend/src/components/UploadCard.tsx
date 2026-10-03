import { useRef } from 'react'

type UploadCardProps = {
  busy: boolean
  error: string
  onUpload: (file: File | undefined) => void
  limitReached?: boolean
  docCount?: number
  maxDocs?: number
}

function UploadCard({ busy, error, onUpload, limitReached = false, docCount = 0, maxDocs = 3 }: UploadCardProps) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <section className="upload-card upload-tile" aria-label="Upload a document">
      <div className="upload-icon"><span>↑</span></div>
      <div className="upload-tile-label">ADD TO WORKSPACE ({docCount}/{maxDocs})</div>
      <h2>{limitReached ? 'Document limit reached' : 'Upload another document'}</h2>
      <p className="upload-copy">
        {limitReached
          ? `You have reached the maximum limit of ${maxDocs} documents. Please delete an existing document to upload a new one.`
          : 'Add a PDF or DOCX and keep its chat separate from your other files.'}
      </p>
      <button
        className="primary-button"
        onClick={() => !limitReached && fileInput.current?.click()}
        disabled={busy || limitReached}
        title={limitReached ? `Maximum limit of ${maxDocs} documents reached` : undefined}
      >
        {busy ? <><span className="spinner" /> Uploading…</> : limitReached ? `Limit reached (${docCount}/${maxDocs})` : 'Choose a document'}
      </button>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => {
          onUpload(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <div className="file-hint"><span>PDF</span><i /><span>DOCX</span><i /> Up to 15 MB · Max {maxDocs} docs</div>
      {error && <div className="error-message" role="alert">{error}</div>}
      <div className="privacy-note"><span>♧</span> Your document is used only to answer your questions.</div>
    </section>
  )
}

export default UploadCard
