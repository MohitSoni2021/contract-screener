import { useState } from "react";
import { FileText, ChevronDown, Check } from "lucide-react";
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
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        className="group flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-[#d6e2d9] bg-white px-3.5 py-2 text-left text-xs font-medium text-[#2d4739] transition hover:border-[#9ec0a8] hover:bg-[#fafcfa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3b6f52] shadow-2xs"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#edf4ef] text-[#2c5b41]">
          <FileText className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {selected?.filename ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#8aa093] transition group-hover:text-[#4d6c5b]" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-full min-w-[260px] overflow-hidden rounded-xl border border-[#d8e3db] bg-white p-1.5 shadow-[0_12px_28px_rgba(20,50,30,0.1)]"
          role="listbox"
        >
          <div className="px-3 py-1.5 text-[10px] font-bold tracking-[.1em] text-[#829388]">
            SELECT DOCUMENT
          </div>
          {documents.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-[#819087]">
              No ready documents available.
            </div>
          ) : (
            documents.map((document) => (
              <button
                type="button"
                role="option"
                aria-selected={document.document_id === value}
                key={document.document_id}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                  document.document_id === value
                    ? "bg-[#eaf3ec] font-semibold text-[#1e4d35]"
                    : "text-[#475b4f] hover:bg-[#f3f7f4]"
                }`}
                onClick={() => {
                  onChange(document.document_id);
                  setOpen(false);
                }}
              >
                <span className="rounded bg-[#fbeae7] px-1.5 py-0.5 text-[9px] font-bold text-[#b54a40]">
                  {document.filename.toLowerCase().endsWith(".pdf") ? "PDF" : "DOCX"}
                </span>
                <span className="min-w-0 truncate">{document.filename}</span>
                {document.document_id === value && (
                  <Check className="ml-auto h-3.5 w-3.5 text-[#2b6446]" />
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
