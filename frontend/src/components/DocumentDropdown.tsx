import { useState } from "react";
import type { UploadedDocument } from "../types";

type DocumentDropdownProps = {
  documents: UploadedDocument[];
  value: string;
  onChange: (documentId: string) => void;
  placeholder?: string;
};

function DocumentDropdown({
  documents,
  value,
  onChange,
  placeholder = "Select a document",
}: DocumentDropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = documents.find((document) => document.document_id === value);

  return (
    <div className="relative min-w-0 text-chat-meta">
      <button
        type="button"
        className="group flex w-full min-w-0 items-center gap-2 rounded-md border border-[#dce6df] bg-[#fbfcfa] px-3 py-2.5 text-left text-chat-meta text-[#486454] transition hover:border-[#a9c4b0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#54806a]"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[#bfd2c4] bg-white text-sm leading-none text-[#3f7655] shadow-sm transition group-hover:bg-[#edf5ef]">
          +
        </span>
        <span className="min-w-0 flex-1 truncate">
          {selected?.filename ?? placeholder}
        </span>
        <span className="shrink-0 text-[#789080]">⌄</span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-full min-w-[240px] overflow-hidden rounded-lg border border-[#dfe8e1] bg-white p-1.5 shadow-[0_12px_30px_#183d2a18]"
          role="listbox"
        >
          <div className="px-2.5 py-2 text-chat-label font-bold tracking-[.12em] text-[#859188]">
            SOURCE DOCUMENT
          </div>
          {documents.length === 0 ? (
            <div className="px-2.5 py-3 text-chat-meta text-[#819087]">
              No ready documents available.
            </div>
          ) : (
            documents.map((document) => (
              <button
                type="button"
                role="option"
                aria-selected={document.document_id === value}
                key={document.document_id}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-chat-meta transition hover:bg-[#f1f6f2] ${document.document_id === value ? "bg-[#eaf2ec] text-[#285b4c]" : "text-[#56685d]"}`}
                onClick={() => {
                  onChange(document.document_id);
                  setOpen(false);
                }}
              >
                <span className="rounded bg-[#f8e9e7] px-1.5 py-1 text-[8px] font-bold text-[#ad534b]">
                  {document.filename.toLowerCase().endsWith(".pdf") ? "PDF" : "DOCX"}
                </span>
                <span className="min-w-0 truncate">{document.filename}</span>
                {document.document_id === value && (
                  <span className="ml-auto text-[#4d8066]">✓</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default DocumentDropdown;
