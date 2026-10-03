import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  GitCompare,
  Sparkles,
  User,
  AlertTriangle,
  CheckCircle2,
  Send,
  Loader2,
  Trash2,
} from "lucide-react";
import type { CompareChatMessage, CompareCitation, UploadedDocument } from "../types";
import { apiUrl } from "../config";

type CompareChatProps = {
  leftDoc: UploadedDocument | undefined;
  rightDoc: UploadedDocument | undefined;
  token: string;
};

function CompareChat({ leftDoc, rightDoc, token }: CompareChatProps) {
  const [messages, setMessages] = useState<CompareChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  // Reset or clear errors when documents change
  useEffect(() => {
    if (leftDoc && rightDoc) {
      setError("");
    }
  }, [leftDoc?.document_id, rightDoc?.document_id]);

  async function handleSend(customPrompt?: string) {
    const promptToSend = (customPrompt ?? question).trim();
    if (!leftDoc || !rightDoc || !promptToSend || busy) return;

    const userMessage: CompareChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: promptToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setBusy(true);
    setError("");

    try {
      const response = await fetch(apiUrl("/api/compare/chat"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leftDocumentId: leftDoc.document_id,
          rightDocumentId: rightDoc.document_id,
          question: promptToSend,
        }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(errorBody.detail ?? "Comparative chat could not be completed.");
      }

      const data = (await response.json()) as {
        answer: string;
        insufficientEvidence?: boolean;
        citations?: CompareCitation[];
        leftDocumentName?: string;
        rightDocumentName?: string;
        summary?: {
          totalSections: number;
          modifiedCount: number;
          addedCount: number;
          deletedCount: number;
          unchangedCount?: number;
        };
      };

      const assistantMessage: CompareChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        citations: data.citations ?? [],
        summary: data.summary,
        insufficientEvidence: data.insufficientEvidence,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate comparative answer.");
    } finally {
      setBusy(false);
    }
  }

  const hasDocsSelected = Boolean(leftDoc && rightDoc);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f9f7]">
      {/* Top Header Strip if conversation active */}
      {messages.length > 0 && (
        <div className="flex items-center justify-between border-b border-[#e5ebe6] bg-white px-6 py-2 shrink-0">
          <div className="text-[11px] text-[#6b8274]">
            Comparing <span className="font-semibold text-[#25523a]">{leftDoc?.filename}</span> with{" "}
            <span className="font-semibold text-[#25523a]">{rightDoc?.filename}</span>
          </div>
          <button
            type="button"
            onClick={() => setMessages([])}
            className="inline-flex items-center gap-1 text-[11px] text-[#85342e] hover:text-[#5e1914] transition"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear conversation</span>
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Empty State */}
          {messages.length === 0 && (
            <div className="m-auto flex w-full max-w-[680px] flex-col items-center justify-center px-3 py-10 text-center">
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-[#e8f0eb] text-[#245d4d] shadow-2xs">
                <GitCompare className="h-5 w-5" />
              </div>
              <h2 className="m-0 font-[Manrope] text-xl font-semibold tracking-[-.03em] text-[#24392e] md:text-2xl">
                What would you like to compare?
              </h2>
              <p className="mb-6 mt-2 max-w-md text-sm leading-6 text-[#728579]">
                Ask precise comparative questions across both contract drafts with verified clause citations.
              </p>

              {/* 3-column inquiry cards matching conversation page */}
              {hasDocsSelected ? (
                <div className="grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <button
                    type="button"
                    className="rounded-lg border border-[#e2e9e3] bg-white px-3 py-3 text-left text-xs leading-5 text-[#51675a] transition hover:border-[#b8cec0] hover:bg-[#f7faf7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#54806a]"
                    onClick={() =>
                      void handleSend("What changed regarding IP ownership between these two drafts?")
                    }
                    disabled={busy}
                  >
                    Compare IP rights
                    <span className="mt-1 block text-[10px] text-[#87958b]">Ownership &amp; licenses</span>
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#e2e9e3] bg-white px-3 py-3 text-left text-xs leading-5 text-[#51675a] transition hover:border-[#b8cec0] hover:bg-[#f7faf7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#54806a]"
                    onClick={() =>
                      void handleSend("How did indemnification and liability caps change?")
                    }
                    disabled={busy}
                  >
                    Indemnity &amp; liability
                    <span className="mt-1 block text-[10px] text-[#87958b]">Caps &amp; risk shifts</span>
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#e2e9e3] bg-white px-3 py-3 text-left text-xs leading-5 text-[#51675a] transition hover:border-[#b8cec0] hover:bg-[#f7faf7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#54806a]"
                    onClick={() =>
                      void handleSend("Were termination rights or notice periods modified?")
                    }
                    disabled={busy}
                  >
                    Termination &amp; notice
                    <span className="mt-1 block text-[10px] text-[#87958b]">Periods &amp; cure rights</span>
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-[#dfe7e1] bg-white px-4 py-3 text-xs text-[#62776a] shadow-2xs">
                  Please select both <strong>Version 1</strong> and <strong>Version 2</strong> in the top bar to enable comparative questions.
                </div>
              )}
            </div>
          )}

          {/* Chat Messages */}
          {messages.map((msg) => (
            <div key={msg.id} className="w-full">
              {msg.role === "user" ? (
                /* User Bubble */
                <div className="flex flex-col items-end">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#839087]">
                    <User className="h-3 w-3 text-[#718679]" />
                    <span className="font-semibold text-[#32493c]">You</span>
                    <span>·</span>
                    <span>{msg.timestamp}</span>
                  </div>
                  <div className="max-w-2xl rounded-2xl rounded-tr-xs border border-[#cfe0d5] bg-[#eaf3ec] px-4 py-3 text-sm leading-relaxed text-[#1b3d2b] shadow-2xs">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ) : (
                /* Assistant Bubble */
                <div className="flex flex-col items-start w-full">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#839087]">
                    <div className="grid h-4 w-4 place-items-center rounded bg-[#e5eee8] text-[#25523a]">
                      <Sparkles className="h-2.5 w-2.5" />
                    </div>
                    <span className="font-bold text-[#233f30]">Comparative Intelligence</span>
                    <span>·</span>
                    <span>{msg.timestamp}</span>
                  </div>

                  <div className="w-full max-w-3xl rounded-2xl border border-[#dfe7e1] bg-white p-5 text-sm leading-relaxed text-[#23382c] shadow-xs">
                    {/* Summary statistics bar */}
                    {msg.summary && (
                      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#e2eae4] bg-[#f8faf8] p-2.5 text-xs">
                        <span className="font-bold text-[#244733]">Clause Scope:</span>
                        <span className="rounded bg-white px-2 py-0.5 border border-[#e1eae3] font-medium text-[#3b5344]">
                          {msg.summary.totalSections} Total Clauses
                        </span>
                        <span className="rounded border border-[#fde68a] bg-[#fef3c7] px-2 py-0.5 font-bold text-[#92400e]">
                          {msg.summary.modifiedCount} Modified
                        </span>
                        <span className="rounded border border-[#bbf7d0] bg-[#dcfce7] px-2 py-0.5 font-bold text-[#166534]">
                          +{msg.summary.addedCount} Added
                        </span>
                        <span className="rounded border border-[#fecaca] bg-[#fee2e2] px-2 py-0.5 font-bold text-[#991b1b]">
                          -{msg.summary.deletedCount} Deleted
                        </span>
                      </div>
                    )}

                    {/* Insufficient evidence warning */}
                    {msg.insufficientEvidence && (
                      <div className="mb-3.5 flex items-start gap-2 rounded-lg border border-[#fde68a] bg-[#fffbeb] p-3 text-xs text-[#92400e]">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-[#b45309] mt-0.5" />
                        <div>
                          <strong>Limited Evidence:</strong> The comparison engine did not find enough
                          direct clause provisions to fully address all aspects of this question.
                        </div>
                      </div>
                    )}

                    {/* Markdown Answer */}
                    <article className="markdown-answer space-y-2 [&_h3]:mt-3.5 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-[#1c3829] [&_h4]:mt-2 [&_h4]:text-xs [&_h4]:font-semibold [&_p]:leading-relaxed [&_ul]:pl-4 [&_ul]:list-disc [&_li]:my-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </article>

                    {/* Citations & Evidence Panel */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-4 border-t border-[#edf2ee] pt-3.5">
                        <div className="mb-2 flex items-center justify-between text-xs font-bold text-[#27533b]">
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-[#2d6c4a]" />
                            <span>VERIFIED EVIDENCE CITATIONS ({msg.citations.length})</span>
                          </span>
                          <span className="text-[10px] font-normal text-[#647f6f]">
                            Dual-document verified quotes
                          </span>
                        </div>

                        <div className="space-y-2">
                          {msg.citations.map((cite, cIdx) => {
                            const isLeft = cite.documentId === leftDoc?.document_id;
                            const docLabel = isLeft
                              ? `Version 1 (${leftDoc?.filename})`
                              : `Version 2 (${rightDoc?.filename})`;

                            return (
                              <div
                                key={cIdx}
                                className={`rounded-lg border p-2.5 text-xs transition ${
                                  isLeft
                                    ? "border-[#fbcfe8] bg-[#fdf2f8]/40"
                                    : "border-[#bbf7d0] bg-[#f0fdf4]/50"
                                }`}
                              >
                                <div className="mb-1 flex items-center justify-between font-bold text-[#1f3d2c]">
                                  <span className="flex items-center gap-1.5">
                                    <span
                                      className={`inline-block h-2 w-2 rounded-full ${
                                        isLeft ? "bg-[#db2777]" : "bg-[#16a34a]"
                                      }`}
                                    />
                                    <span>{docLabel}</span>
                                  </span>
                                  <span className="rounded bg-white px-1.5 py-0.5 border border-[#e2e9e3] text-[10px] text-[#4d6657]">
                                    {cite.pageNumber ? `Page ${cite.pageNumber}` : "Passage"}
                                  </span>
                                </div>
                                <blockquote className="italic text-[#37493e] border-l-2 border-[#a3c4ae] pl-2 my-1">
                                  &quot;{cite.quote}&quot;
                                </blockquote>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Busy Indicator */}
          {busy && (
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#718679]">
                <div className="grid h-4 w-4 place-items-center rounded bg-[#e5eee8] text-[#25523a]">
                  <Sparkles className="h-2.5 w-2.5" />
                </div>
                <span className="font-semibold text-[#233f30]">Comparative Intelligence</span>
              </div>
              <div className="flex items-center gap-2.5 rounded-2xl border border-[#dfe7e1] bg-white px-4 py-3 shadow-xs">
                <Loader2 className="h-4 w-4 animate-spin text-[#25523a]" />
                <span className="text-xs text-[#4e6b5a]">
                  Analyzing clause differences, diffing contract text, and verifying citations…
                </span>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="rounded-lg border border-[#fecaca] bg-[#fff5f5] p-3 text-xs text-[#991b1b]">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Composer Dock matching DocumentChat */}
      <div className="shrink-0 bg-transparent px-4 pb-2 pt-2 md:px-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="mx-auto flex max-w-[760px] items-end gap-2 rounded-xl border border-[#dfe6e0] bg-white p-2 shadow-[0_3px_12px_#183d2a0b]"
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              hasDocsSelected
                ? "Ask about changes between these two versions (e.g., 'How did indemnification change?')..."
                : "Select two documents above to start comparative questions..."
            }
            disabled={!hasDocsSelected || busy}
            rows={1}
            className="max-h-32 min-w-0 flex-1 resize-y border-0 bg-transparent px-2 py-2 text-sm leading-6 text-[#48574e] outline-none placeholder:text-[#a3aca6] disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!hasDocsSelected || !question.trim() || busy}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#245d4d] text-white hover:bg-[#1b4d3f] disabled:cursor-not-allowed disabled:opacity-40 transition shadow-xs"
            title="Send comparative question"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </form>
        <div className="shrink-0 px-3 pb-2 pt-1 text-center text-[9px] leading-4 text-[#929d95]">
          Answers compare Version 1 and Version 2 with verified dual-document citations.
        </div>
      </div>
    </div>
  );
}

export default CompareChat;
