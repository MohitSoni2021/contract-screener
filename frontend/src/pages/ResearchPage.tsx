import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import WorkspaceSidebar from "../components/WorkspaceSidebar";
import type { UploadedDocument, User } from "../types";
import type { AppDispatch, RootState } from "../store/store";
import { fetchDocuments } from "../store/documentsSlice";
import ReactMarkdown from "react-markdown";

type ResearchAnswer = {
  summary?: string;
  findings?: Array<string | { title?: string; severity?: string; explanation?: string; clauseRef?: string; quotes?: string[] }>;
  notFound?: string[];
  notChecked?: string[];
};
type ResearchPageProps = { user: User; token: string; onLogout: () => void };

// Converts the API's structured answer into predictable Markdown for humans.
// The API may return an object, a JSON string, fenced JSON, or plain text.
function formatResearchAnswer(value: unknown) {
  if (typeof value === "string") {
    const cleaned = value
      .replace(/^```(?:json|markdown)?\s*|\s*```$/g, "")
      .trim();
    try {
      return formatResearchAnswer(JSON.parse(cleaned) as ResearchAnswer);
    } catch {
      return value;
    }
  }
  if (!value || typeof value !== "object") return "";
  const result = value as ResearchAnswer;
  if (result.summary) {
    const nestedSummary = result.summary.trim().replace(/^```(?:json|markdown)?\s*|\s*```$/g, "");
    try {
      const parsedSummary = JSON.parse(nestedSummary) as unknown;
      if (parsedSummary && typeof parsedSummary === "object") {
        const nestedResult = parsedSummary as ResearchAnswer;
        return formatResearchAnswer({
          ...nestedResult,
          notFound: result.notFound ?? nestedResult.notFound,
          notChecked: result.notChecked ?? nestedResult.notChecked,
        });
      }
    } catch {
      // A normal prose summary is expected when the model did not nest JSON.
    }
  }
  const sections = [result.summary ? `## Summary\n\n${result.summary}` : ""];
  if (result.findings?.length)
    sections.push(
      `## Findings\n\n${result.findings.map((item) => {
        if (typeof item === "string") return `- ${item}`;
        const details = [item.explanation, item.clauseRef && `Clause: ${item.clauseRef}`, item.quotes?.length && `Quote: “${item.quotes.join(" ” / “") }”`].filter(Boolean).join(" — ");
        return `- **${item.title ?? "Finding"}**${item.severity ? ` (${item.severity})` : ""}${details ? `: ${details}` : ""}`;
      }).join("\n")}`,
    );
  if (result.notFound?.length)
    sections.push(
      `## Not found in the document\n\n${result.notFound.map((item) => `- ${item}`).join("\n")}`,
    );
  if (result.notChecked?.length)
    sections.push(
      `## Not checked\n\n${result.notChecked.map((item) => `- ${item}`).join("\n")}`,
    );
  sections.push("This explains the document; it is not legal advice.");
  return sections.filter(Boolean).join("\n\n");
}

// Chat-style source selector. The plus button opens the ready-document list
// below the header while the selected filename stays visible beside it.
function DocumentDropdown({
  documents,
  value,
  onChange,
}: {
  documents: UploadedDocument[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = documents.find((document) => document.document_id === value);
  return (
    <div className="relative shrink-0 text-xs">
      <button
        type="button"
        className="group flex max-w-[280px] items-center gap-2 text-left text-chat-meta text-[#486454]"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#bfd2c4] bg-white text-xl leading-none text-[#3f7655] shadow-sm transition group-hover:bg-[#edf5ef]">
          +
        </span>
        <span className="min-w-0 truncate font-medium text-xs">
          {selected?.filename ?? "Add source document"}
        </span>
        <span className="text-[#789080]">⌄</span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+8px)] z-30 w-[min(280px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-[#dfe8e1] bg-white p-1.5 shadow-[0_12px_30px_#183d2a18]"
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
                  {document.filename.toLowerCase().endsWith(".pdf")
                    ? "PDF"
                    : "DOCX"}
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

function ResearchPage({ user, token, onLogout }: ResearchPageProps) {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { items: documents } = useSelector(
    (state: RootState) => state.documents,
  );
  const ready = documents.filter((document) => document.status === "ready");
  const [documentId, setDocumentId] = useState("");
  const [question, setQuestion] = useState(
    "What are the key obligations, deadlines, and liability risks in this document?",
  );
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Restore the user's available documents when the research workspace opens.
  useEffect(() => {
    void dispatch(fetchDocuments({ token }));
  }, [dispatch, token]);

  // Runs research to completion and renders only the final normalized answer.
  async function runResearch(prompt = question) {
    if (!documentId || !prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ document_id: documentId, question: prompt }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(body.detail ?? "Research could not be started.");
      }
      const body = (await response.json()) as { answer?: unknown; message?: string };
      if (!response.ok) throw new Error(body.message ?? "Research could not be completed.");
      setAnswer(formatResearchAnswer(body.answer));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Research could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="fixed inset-0 z-20 flex h-dvh min-h-0 w-full overflow-hidden bg-[#f6f7f4] text-[#252b28]"
      aria-label="Agentic document research workspace"
    >
      <div className="flex h-full min-h-0 w-full">
        {/* Reusable workspace navigation and recent-document sidebar. */}
        <WorkspaceSidebar
          documents={documents}
          selectedDocumentId={documentId || null}
          onSelect={(document) =>
            document.status === "ready" && setDocumentId(document.document_id)
          }
          onAddDocument={() => navigate("/workspace")}
          removingId={null}
          onRemove={() => undefined}
          collapsible
          userName={user.name}
          onLogout={onLogout}
        />
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#f6f7f4]">
          <section className="flex min-h-0 flex-1 flex-col" aria-label="Source document research">
                <header className="flex shrink-0 items-center gap-3 border-b border-[#e5ebe6] bg-white px-5 py-3 md:px-10">
                  <DocumentDropdown
                    documents={ready}
                    value={documentId}
                    onChange={setDocumentId}
                  />
                  <span className="text-chat-label text-[#8a968e]">Source document</span>
                </header>
                {/* Chat-like transcript: the answer grows here while the
                    composer remains anchored at the bottom. */}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6 md:px-10">
                  <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col">
                    <div className="mb-8 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs text-[#859188]">
                          SOURCE-GROUNDED ANSWER
                        </div>
                        <p className="m-0 mt-1 text-xs text-[#718178]">
                          Research grounded in the selected document
                        </p>
                      </div>
                      <span className="rounded-full bg-[#edf2ee] px-2.5 py-1 text-xs font-semibold text-[#557462]">
                        {busy ? "Researching" : answer ? "Verified" : "Ready"}
                      </span>
                    </div>
                    {busy ? (
                      <div className="flex items-center gap-3 py-3 text-xs text-[#8d918f]" role="status" aria-live="polite">
                        <span className="text-base leading-none text-[#a2a5a3]" aria-hidden="true">◎</span>
                        <span>Preparing the final answer<span className="inline-flex w-7 overflow-hidden align-bottom text-left" aria-hidden="true"><span className="animate-pulse">...</span></span></span>
                      </div>
                    ) : answer ? (
                      <article className="markdown-answer max-w-[760px] text-xs text-[#34443a] [&_h1]:text-[10px] [&_h2]:text-[14px] [&_h3]:text-[12px] [&_li]:text-xs">
                        <ReactMarkdown>{answer}</ReactMarkdown>
                      </article>
                    ) : (
                      <div className="m-auto flex max-w-[390px] flex-col items-center text-center">
                        <span className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-[#e8f0eb] font-[Manrope] text-xl font-extrabold text-[#32664f]">
                          e
                        </span>
                        <p className="m-0 text-research-empty text-[#819087]">
                          Choose a source file, then ask a focused question
                          about its obligations, dates, or risks.
                        </p>
                      </div>
                    )}
                    {error && (
                      <div
                        className="mt-5 rounded-md border border-[#efd2ce] bg-[#fff5f3] px-3 py-2 text-xs text-[#a4483f]"
                        role="alert"
                      >
                        {error}
                      </div>
                    )}
                  </div>
                </div>
                {/* Enter submits a question; Shift+Enter creates a new line. */}
                <form
                  className="mx-4 mb-1 mt-3 text-xs flex shrink-0 items-end gap-2 rounded-xl border border-[#dfe6e0] bg-white p-2 shadow-[0_3px_12px_#183d2a0b] md:mx-auto md:w-[min(820px,calc(100%-3rem))]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runResearch();
                  }}
                >
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void runResearch();
                      }
                    }}
                    className="max-h-32 min-w-0 flex-1 resize-y border-0 bg-transparent px-2 py-2 text-chat-meta text-xs text-[#48574e] outline-none placeholder:text-[#a3aca6]"
                    placeholder="Ask about this document…"
                    aria-label="Ask a research question"
                    rows={1}
                  />
                  <button
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#245d4d] text-lg text-white transition hover:bg-[#1b4d3f] disabled:cursor-not-allowed disabled:opacity-40"
                    type="submit"
                    aria-label="Send research question"
                    disabled={busy || !documentId || !question.trim()}
                  >
                    {busy ? "…" : "↑"}
                  </button>
                </form>
                <div className="shrink-0 px-3 pb-3 pt-1 text-center text-[9px] leading-4 text-[#929d95]">
                  Answers are grounded in retrieved passages. Verify important
                  terms in the original source.
                </div>
          </section>
        </section>
      </div>
    </main>
  );
}

export default ResearchPage;
