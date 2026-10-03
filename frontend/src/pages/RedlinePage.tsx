import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { FilePenLine, Check, Sparkles } from "lucide-react";
import WorkspaceSidebar from "../components/WorkspaceSidebar";
import type { ProposedRedline, RedlineStagedEdit, UploadedDocument, User } from "../types";
import type { AppDispatch, RootState } from "../store/store";
import { fetchDocuments } from "../store/documentsSlice";
import { apiUrl } from "../config";

type RedlinePageProps = {
  user: User;
  token: string;
  onLogout: () => void;
};

const PRESET_INSTRUCTIONS = [
  { label: "Mutual Indemnification", text: "Make indemnification mutual for both parties" },
  { label: "Liability Cap (12 mo)", text: "Cap aggregate liability at total fees paid in past 12 months" },
  { label: "60-Day Termination Notice", text: "Extend termination notice period to sixty-day (60-day)" },
  { label: "30-Day Cure Period", text: "Add 30-day written notice and cure period before termination for breach" },
  { label: "3-Year Confidentiality", text: "Limit confidentiality obligations to 3 years from disclosure" },
  { label: "Narrow IP Assignment", text: "Narrow IP assignment exclusively to deliverables developed under this SOW" },
];

function RedlinePage({ user, token, onLogout }: RedlinePageProps) {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { id: routeDocId } = useParams<{ id?: string }>();
  const { items: documents } = useSelector((state: RootState) => state.documents);

  const readyDocuments = documents.filter((doc) => doc.status === "ready");
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [instruction, setInstruction] = useState<string>(
    "Make indemnification mutual for both parties"
  );
  const [proposing, setProposing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const [currentProposal, setCurrentProposal] = useState<ProposedRedline | null>(null);
  const [customRevisedText, setCustomRevisedText] = useState<string>("");
  const [isEditingProposal, setIsEditingProposal] = useState<boolean>(false);
  const [stagedEdits, setStagedEdits] = useState<RedlineStagedEdit[]>([]);

  // Initialize or update selected document
  useEffect(() => {
    void dispatch(fetchDocuments({ token }));
  }, [dispatch, token]);

  useEffect(() => {
    if (routeDocId && readyDocuments.some((d) => d.document_id === routeDocId)) {
      setSelectedDocId(routeDocId);
    } else if (!selectedDocId && readyDocuments.length > 0) {
      setSelectedDocId(readyDocuments[0].document_id);
    }
  }, [routeDocId, readyDocuments, selectedDocId]);

  const selectedDocument: UploadedDocument | undefined = readyDocuments.find(
    (d) => d.document_id === selectedDocId
  );

  async function handleProposeRedline(customPrompt?: string) {
    const promptToUse = (customPrompt ?? instruction).trim();
    if (!selectedDocId || !promptToUse || proposing) return;

    setProposing(true);
    setError("");
    setSuccessMessage("");
    setIsEditingProposal(false);

    try {
      const response = await fetch(apiUrl("/api/redline"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentId: selectedDocId,
          instruction: promptToUse,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(errorData.detail ?? "Could not generate redline proposal.");
      }

      const proposal = (await response.json()) as ProposedRedline;
      setCurrentProposal(proposal);
      setCustomRevisedText(proposal.revisedText);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose redline.");
    } finally {
      setProposing(false);
    }
  }

  function handleStageCurrentEdit() {
    if (!currentProposal) return;
    const finalRevised = isEditingProposal ? customRevisedText : currentProposal.revisedText;

    const newEdit: RedlineStagedEdit = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      clauseTitle: currentProposal.clauseTitle || "Proposed Revision",
      targetText: currentProposal.targetText,
      revisedText: finalRevised,
      explanation: currentProposal.explanation,
      applied: true,
    };

    setStagedEdits((prev) => [newEdit, ...prev]);
    setSuccessMessage(`Staged revision for "${newEdit.clauseTitle}". You can now apply it or add more edits.`);
    setCurrentProposal(null);
    setIsEditingProposal(false);
  }

  async function handleDownloadDocx(editsToApply?: Array<{ targetText: string; revisedText: string }>) {
    if (!selectedDocId || applying) return;

    const editsList =
      editsToApply ??
      stagedEdits
        .filter((e) => e.applied)
        .map((e) => ({ targetText: e.targetText, revisedText: e.revisedText }));

    if (editsList.length === 0) {
      setError("Please stage at least one edit to export.");
      return;
    }

    setApplying(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await fetch(apiUrl("/api/redline/apply"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentId: selectedDocId,
          edits: editsList,
        }),
      });

      if (!response.ok) {
        const errJson = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(errJson.detail ?? "Could not generate tracked changes document.");
      }

      // Extract filename from Content-Disposition if present
      const disposition = response.headers.get("Content-Disposition");
      let filename = `redlined-${selectedDocument?.filename.replace(/\.[^/.]+$/, "") || "contract"}.docx`;
      if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1]);
        }
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);

      setSuccessMessage(
        `Successfully exported "${filename}" with native Word tracked changes (<w:ins> and <w:del>). Open in Word or Google Docs to view inline revisions.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export redlined document.");
    } finally {
      setApplying(false);
    }
  }

  function handleRemoveStagedEdit(id: string) {
    setStagedEdits((prev) => prev.filter((e) => e.id !== id));
  }

  function handleToggleStagedEdit(id: string) {
    setStagedEdits((prev) =>
      prev.map((e) => (e.id === id ? { ...e, applied: !e.applied } : e))
    );
  }

  return (
    <main
      className="comparison-app-shell workspace-app-shell"
      aria-label="Contract Redlining and Tracked Changes"
    >
      <div className="comparison-workspace" id="top">
        <WorkspaceSidebar
          documents={documents}
          selectedDocumentId={selectedDocId || null}
          onSelect={(document) => {
            if (document.status === "ready") {
              setSelectedDocId(document.document_id);
              setCurrentProposal(null);
            }
          }}
          onAddDocument={() => navigate("/workspace")}
          removingId={null}
          onRemove={() => undefined}
          collapsible
          userName={user.name}
          onLogout={onLogout}
        />

        <section className="comparison-main-panel workspace-main-panel flex-1 overflow-y-auto px-6 py-8 md:px-10">
          <div className="mx-auto max-w-5xl">
            {/* Header */}
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-[#e2e8e3] pb-6">
              <div>
                <div className="eyebrow text-xs font-bold uppercase tracking-wider text-[#456b54]">
                  CONTRACT INTELLIGENCE · REDLINE & EXPORT
                </div>
                <h1 className="mt-1 font-serif text-2xl font-bold tracking-tight text-[#1e2e26] md:text-3xl">
                  Contract Redlining & Tracked Changes
                </h1>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#5a6d62]">
                  Propose surgical contract edits using AI and export native Microsoft Word (
                  <code className="rounded bg-[#eaf1ec] px-1 py-0.5 text-xs font-semibold text-[#2f553f]">
                    .docx
                  </code>
                  ) documents with tracked changes (
                  <span className="font-mono text-xs text-[#b83232]">&lt;w:del&gt;</span> and{" "}
                  <span className="font-mono text-xs text-[#2a7a4b]">&lt;w:ins&gt;</span>).
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-[#cbe0d2] bg-[#f2f7f3] px-3.5 py-2 shadow-sm">
                <FilePenLine className="h-4 w-4 text-[#2f553f]" />
                <div className="text-xs">
                  <div className="font-bold text-[#1f3f2d]">Word Tracked Changes</div>
                  <div className="text-[#597564]">Native XML formatting</div>
                </div>
              </div>
            </div>

            {/* Document Selector */}
            <div className="mb-6 rounded-xl border border-[#dfe8e1] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[#354c3e]">Active Document:</span>
                  {readyDocuments.length === 0 ? (
                    <span className="text-xs text-[#8c9c91]">No ready documents available. Upload a document in your workspace first.</span>
                  ) : (
                    <select
                      className="rounded-lg border border-[#c9d9ce] bg-[#f8faf8] px-3 py-1.5 text-sm font-medium text-[#233c2e] focus:border-[#427b58] focus:outline-none"
                      value={selectedDocId}
                      onChange={(e) => {
                        setSelectedDocId(e.target.value);
                        setCurrentProposal(null);
                      }}
                    >
                      {readyDocuments.map((doc) => (
                        <option key={doc.document_id} value={doc.document_id}>
                          {doc.filename} ({doc.filename.toLowerCase().endsWith(".docx") ? "DOCX" : "PDF"})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {selectedDocument && (
                  <div className="flex items-center gap-2 text-xs text-[#5e7367]">
                    <span className="rounded bg-[#e8f1eb] px-2 py-0.5 font-semibold text-[#2a5a3e]">
                      {selectedDocument.filename.toLowerCase().endsWith(".docx") ? "Original DOCX" : "PDF Document"}
                    </span>
                    <span>•</span>
                    <span>{selectedDocument.indexed_chunks} indexed passages</span>
                  </div>
                )}
              </div>
            </div>

            {/* Notifications */}
            {error && (
              <div
                className="mb-6 flex items-start gap-3 rounded-lg border border-[#f5c6cb] bg-[#fdf2f2] p-4 text-sm text-[#721c24] shadow-sm"
                role="alert"
              >
                <span className="font-bold">Error:</span>
                <span className="flex-1">{error}</span>
                <button
                  onClick={() => setError("")}
                  className="text-xs font-bold text-[#721c24] hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {successMessage && (
              <div
                className="mb-6 flex items-start gap-3 rounded-lg border border-[#c3e6cb] bg-[#f2f9f4] p-4 text-sm text-[#155724] shadow-sm"
                role="status"
              >
                <Check className="h-4 w-4 text-[#155724] shrink-0 mt-0.5" />
                <span className="flex-1">{successMessage}</span>
                <button
                  onClick={() => setSuccessMessage("")}
                  className="text-xs font-bold text-[#155724] hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Main Redline Workbench Grid */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Left Column: Prompting & Instructions */}
              <div className="lg:col-span-6 flex flex-col gap-5">
                <div className="rounded-xl border border-[#dfe8e1] bg-white p-5 shadow-sm">
                  <h2 className="text-base font-bold text-[#23382c]">1. Redline Instruction</h2>
                  <p className="mt-1 text-xs text-[#5c6e63]">
                    Describe the modification you want to propose. The AI will locate the exact target clause and formulate the revised legal text.
                  </p>

                  {/* Preset Pills */}
                  <div className="mt-3">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#798e81]">
                      Quick Preset Instructions
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_INSTRUCTIONS.map((preset, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setInstruction(preset.text);
                            void handleProposeRedline(preset.text);
                          }}
                          className="rounded-full border border-[#d2e2d6] bg-[#f6faf7] px-2.5 py-1 text-xs text-[#2d5c41] transition hover:border-[#387b53] hover:bg-[#ebf4ee] hover:text-[#18482d]"
                          disabled={proposing || !selectedDocId}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Prompt Textarea */}
                  <div className="mt-4">
                    <label htmlFor="redline-prompt" className="mb-1 block text-xs font-semibold text-[#405649]">
                      Custom Drafting Prompt
                    </label>
                    <textarea
                      id="redline-prompt"
                      className="w-full rounded-lg border border-[#cbdad0] p-3 text-sm text-[#203629] placeholder-[#90a297] focus:border-[#387b53] focus:bg-[#fcfdfc] focus:outline-none"
                      rows={3}
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder="e.g., Change governing law to New York and require mutual attorney fee recovery..."
                      disabled={proposing || !selectedDocId}
                    />
                    <div className="mt-1 flex items-center justify-between text-[11px] text-[#788b7f]">
                      <span>Max 500 characters</span>
                      <span>{instruction.length}/500</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => handleProposeRedline()}
                      disabled={proposing || !selectedDocId || !instruction.trim()}
                      className="flex items-center gap-2 rounded-lg bg-[#2f5e43] px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-[#254d36] disabled:opacity-50"
                    >
                      {proposing ? (
                        <>
                          <span className="spinner inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          <span>Analyzing & Drafting…</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Propose Redline</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Staged Edits Overview Card */}
                <div className="rounded-xl border border-[#dfe8e1] bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-[#23382c]">Staged Edits for Batch Export</h2>
                      <p className="text-xs text-[#667a6e]">
                        {stagedEdits.length === 0
                          ? "No edits staged yet. Propose edits and click 'Stage Edit' to queue them."
                          : `${stagedEdits.filter((e) => e.applied).length} of ${stagedEdits.length} edits selected for DOCX export.`}
                      </p>
                    </div>
                    {stagedEdits.length > 0 && (
                      <span className="rounded-full bg-[#e3efe6] px-2.5 py-0.5 text-xs font-bold text-[#275a3c]">
                        {stagedEdits.length} Staged
                      </span>
                    )}
                  </div>

                  {stagedEdits.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {stagedEdits.map((edit) => (
                        <div
                          key={edit.id}
                          className={`rounded-lg border p-3.5 text-xs transition ${
                            edit.applied
                              ? "border-[#c4decb] bg-[#f7fbf8]"
                              : "border-[#e0e6e2] bg-[#fbfbfb] opacity-60"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <label className="flex items-center gap-2 font-bold text-[#203c2c] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={edit.applied}
                                onChange={() => handleToggleStagedEdit(edit.id)}
                                className="h-4 w-4 rounded border-[#9fb9a6] text-[#2f5e43] focus:ring-[#387b53]"
                              />
                              <span>{edit.clauseTitle}</span>
                            </label>
                            <button
                              onClick={() => handleRemoveStagedEdit(edit.id)}
                              className="text-[#964038] hover:text-[#b82618]"
                              title="Remove edit"
                            >
                              ✕
                            </button>
                          </div>

                          <div className="mt-2 space-y-1.5 pl-6 font-mono text-[11px]">
                            <div className="rounded bg-[#fee2e2] px-2 py-1 text-[#991b1b] line-through">
                              - {edit.targetText}
                            </div>
                            <div className="rounded bg-[#dcfce7] px-2 py-1 text-[#166534]">
                              + {edit.revisedText}
                            </div>
                          </div>

                          <p className="mt-2 pl-6 text-[11px] italic text-[#5f7467]">
                            {edit.explanation}
                          </p>
                        </div>
                      ))}

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e5ece6] pt-4">
                        <button
                          type="button"
                          onClick={() => setStagedEdits([])}
                          className="text-xs text-[#80261f] hover:underline"
                        >
                          Clear all staged edits
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDownloadDocx()}
                          disabled={applying || stagedEdits.filter((e) => e.applied).length === 0}
                          className="flex items-center gap-2 rounded-lg bg-[#185333] px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-[#124227] disabled:opacity-50"
                        >
                          {applying ? (
                            <>
                              <span className="spinner inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              <span>Generating Tracked Changes DOCX…</span>
                            </>
                          ) : (
                            <>
                              <span>📥</span>
                              <span>Export All ({stagedEdits.filter((e) => e.applied).length}) as Tracked Changes DOCX</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Right Column: Proposed Redline Review & Diff Inspection */}
              <div className="lg:col-span-6 flex flex-col gap-5">
                <div className="rounded-xl border border-[#dfe8e1] bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between border-b border-[#e9efe9] pb-3">
                    <h2 className="text-base font-bold text-[#23382c]">2. Proposed Redline Inspection</h2>
                    {currentProposal && (
                      <span className="rounded bg-[#edf5ef] px-2.5 py-1 text-xs font-semibold text-[#285b3e]">
                        {currentProposal.clauseTitle || "Target Clause"}
                      </span>
                    )}
                  </div>

                  {!currentProposal && !proposing && (
                    <div className="py-12 text-center text-[#73887c]">
                      <FilePenLine className="h-8 w-8 mx-auto text-[#73887c]" />
                      <p className="mt-2 text-sm font-medium">No active redline proposed yet.</p>
                      <p className="mt-1 text-xs text-[#889b90]">
                        Select a document, pick a quick instruction or type your prompt, and click &quot;Propose Redline&quot;.
                      </p>
                    </div>
                  )}

                  {proposing && (
                    <div className="py-14 text-center">
                      <div className="spinner mx-auto h-7 w-7 animate-spin rounded-full border-3 border-[#2f5e43] border-t-transparent" />
                      <p className="mt-3 text-sm font-semibold text-[#234231]">
                        Locating clause & synthesizing legal revision…
                      </p>
                      <p className="text-xs text-[#6e8276]">
                        Preserving sentence context and preparing tracked changes
                      </p>
                    </div>
                  )}

                  {currentProposal && !proposing && (
                    <div className="mt-4 space-y-4">
                      {/* Legal Rationale Box */}
                      <div className="rounded-lg border border-[#cfe1d5] bg-[#f5f9f6] p-3.5">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#316946]">
                          Legal Rationale & Analysis
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-[#233d2e]">
                          {currentProposal.explanation}
                        </p>
                      </div>

                      {/* Visual Diff: Prior vs Revised */}
                      <div className="space-y-3">
                        <div className="rounded-lg border border-[#fecaca] bg-[#fff5f5] p-3.5">
                          <div className="flex items-center justify-between text-xs font-bold text-[#991b1b]">
                            <span>Prior Language (To be deleted)</span>
                            <span className="rounded bg-[#fee2e2] px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider">
                              &lt;w:del&gt;
                            </span>
                          </div>
                          <div className="mt-2 font-mono text-xs leading-relaxed text-[#7f1d1d] line-through">
                            {currentProposal.targetText}
                          </div>
                        </div>

                        <div className="rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] p-3.5">
                          <div className="flex items-center justify-between text-xs font-bold text-[#166534]">
                            <span>Proposed Language (To be inserted)</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setIsEditingProposal((prev) => !prev)}
                                className="text-[11px] text-[#2563eb] underline hover:text-[#1d4ed8]"
                              >
                                {isEditingProposal ? "Cancel Edit" : "Custom Edit"}
                              </button>
                              <span className="rounded bg-[#dcfce7] px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider">
                                &lt;w:ins&gt;
                              </span>
                            </div>
                          </div>

                          {isEditingProposal ? (
                            <textarea
                              className="mt-2 w-full rounded border border-[#86efac] bg-white p-2 font-mono text-xs text-[#14532d] focus:border-[#16a34a] focus:outline-none"
                              rows={3}
                              value={customRevisedText}
                              onChange={(e) => setCustomRevisedText(e.target.value)}
                            />
                          ) : (
                            <div className="mt-2 font-mono text-xs font-medium leading-relaxed text-[#14532d]">
                              {customRevisedText}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Context Sentence Preview */}
                      {currentProposal.contextSentence && (
                        <div className="rounded-lg border border-[#e2e8e3] bg-[#fbfdfb] p-3">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-[#697d71]">
                            Full Clause Context
                          </div>
                          <p className="mt-1 text-xs italic leading-relaxed text-[#415347]">
                            &quot;{currentProposal.contextSentence}&quot;
                          </p>
                        </div>
                      )}

                      {/* Action Bar */}
                      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#e8efe9] pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            const revised = isEditingProposal ? customRevisedText : currentProposal.revisedText;
                            void handleDownloadDocx([
                              { targetText: currentProposal.targetText, revisedText: revised },
                            ]);
                          }}
                          disabled={applying}
                          className="flex items-center gap-1.5 rounded-lg border border-[#2f5e43] bg-white px-4 py-2 text-xs font-bold text-[#2f5e43] transition hover:bg-[#edf5ef] disabled:opacity-50"
                        >
                          <span>📥</span>
                          <span>Download this Revision (.docx)</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleStageCurrentEdit}
                          className="flex items-center gap-1.5 rounded-lg bg-[#275a3c] px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-[#1d462e]"
                        >
                          <span>+</span>
                          <span>Stage this Edit</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Information Card on Native DOCX Tracked Changes */}
                <div className="rounded-xl border border-[#dfe8e1] bg-[#f8faf8] p-4 text-xs text-[#526659]">
                  <h3 className="font-bold text-[#243d2f]">About Word Tracked Changes (.docx)</h3>
                  <p className="mt-1 leading-relaxed">
                    When you export, the backend packages your revisions directly using OpenXML elements{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[11px] font-mono text-[#b33939]">&lt;w:del&gt;</code> and{" "}
                    <code className="rounded bg-white px-1 py-0.5 text-[11px] font-mono text-[#25733d]">&lt;w:ins&gt;</code>.
                    Opening the downloaded document in Microsoft Word, Google Docs, or LibreOffice will immediately display standard redline markup with Accept/Reject controls.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default RedlinePage;
