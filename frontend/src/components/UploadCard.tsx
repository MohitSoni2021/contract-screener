import { useRef } from 'react'

type UploadCardProps = {
  busy: boolean
  error: string
  onUpload: (file: File | undefined) => void
}

function UploadCard({ busy, error, onUpload }: UploadCardProps) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <section className="upload-card upload-tile" aria-label="Upload a document">
      <div className="upload-icon"><span>↑</span></div>
      <div className="upload-tile-label">ADD TO WORKSPACE</div>
      <h2>Upload another document</h2>
      <p className="upload-copy">Add a PDF or DOCX and keep its chat separate from your other files.</p>
      <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={busy}>
        {busy ? <><span className="spinner" /> Uploading…</> : 'Choose a document'}
      </button>
      <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => onUpload(event.target.files?.[0])} />
      <div className="file-hint"><span>PDF</span><i /><span>DOCX</span><i /> Up to 25 MB</div>
      {error && <div className="error-message" role="alert">{error}</div>}
      <div className="privacy-note"><span>♧</span> Your document is used only to answer your questions.</div>
    </section>
  )
}

export default UploadCard
