import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import {
  FilePenLine,
  Check,
  Sparkles,
  Download,
  Plus,
  X,
  Trash2,
  Loader2,
  ChevronDown,
} from "lucide-react";
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

        <section className="flex h-full w-full flex-1 flex-col min-h-0 min-w-0 overflow-hidden bg-[#f7f9f7]">
          {/* Top Bar: Active Document & Status on top of the screen */}
          <div className="shrink-0 border-b border-[#dfe8e1] bg-white px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#688172]">
                Active Document:
              </span>
              {readyDocuments.length === 0 ? (
                <span className="text-xs text-[#8c9c91]">
                  No ready documents available. Upload a document in your workspace first.
                </span>
              ) : (
                <div className="relative">
                  <select
                    className="appearance-none rounded-lg border border-[#c9d9ce] bg-[#f8faf8] pl-3 pr-8 py-1.5 text-xs font-semibold text-[#203c2c] focus:border-[#2f5e43] focus:bg-white focus:outline-none transition cursor-pointer"
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
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#738e7d]" />
                </div>
              )}

              {selectedDocument && (
                <div className="flex items-center gap-2 text-xs text-[#5e7367]">
                  <span className="rounded bg-[#e8f1eb] px-2 py-0.5 font-bold text-[11px] text-[#245338]">
                    {selectedDocument.filename.toLowerCase().endsWith(".docx") ? "DOCX Document" : "PDF Document"}
                  </span>
                  <span>•</span>
                  <span className="text-[11px] font-medium text-[#657a6e]">
                    {selectedDocument.indexed_chunks} indexed passages
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <div className="hidden sm:flex items-center gap-1.5 rounded-md border border-[#cbe0d2] bg-[#f2f7f3] px-2.5 py-1 text-xs font-semibold text-[#275b3e]">
                <FilePenLine className="h-3.5 w-3.5" />
                <span>Word Tracked Changes (.docx)</span>
              </div>

              {stagedEdits.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleDownloadDocx()}
                  disabled={applying || stagedEdits.filter((e) => e.applied).length === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-[#25523a] px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#1a3d2a] disabled:opacity-50"
                  title="Export all staged edits"
                >
                  {applying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  <span>Export ({stagedEdits.filter((e) => e.applied).length}) .docx</span>
                </button>
              )}
            </div>
          </div>

          {/* Slim Notifications Banner if error or success */}
          {error && (
            <div
              className="shrink-0 flex items-center justify-between border-b border-[#fecaca] bg-[#fff5f5] px-5 py-2 text-xs text-[#991b1b]"
              role="alert"
            >
              <span><strong>Error:</strong> {error}</span>
              <button
                onClick={() => setError("")}
                className="font-bold underline hover:text-[#7f1d1d]"
              >
                Dismiss
              </button>
            </div>
          )}

          {successMessage && (
            <div
              className="shrink-0 flex items-center justify-between border-b border-[#bbf7d0] bg-[#f0fdf4] px-5 py-2 text-xs text-[#166534]"
              role="status"
            >
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" />
                <span>{successMessage}</span>
              </span>
              <button
                onClick={() => setSuccessMessage("")}
                className="font-bold underline hover:text-[#14532d]"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Edge-to-Edge Split Workbench */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* Left Panel: Redline Composer & Staged Edits Queue */}
            <div className="w-full lg:w-[460px] xl:w-[500px] shrink-0 border-r border-[#dfe8e1] bg-white flex flex-col min-h-0 overflow-y-auto">
              {/* Section 1: Composer & Presets */}
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#1f372a]">1. Redline Instruction</h2>
                  <span className="text-[10px] font-semibold text-[#70897a] uppercase tracking-wider">AI Drafting</span>
                </div>
                <p className="mt-1 text-xs text-[#5e7367]">
                  Describe the legal change to propose. The AI targets the exact clause and crafts surgical Word-tracked replacements.
                </p>

                {/* Preset Pills */}
                <div className="mt-3.5">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#798e81]">
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
                        className="rounded-full border border-[#d2e2d6] bg-[#f6faf7] px-2.5 py-1 text-xs font-medium text-[#2d5c41] transition hover:border-[#387b53] hover:bg-[#ebf4ee] hover:text-[#18482d]"
                        disabled={proposing || !selectedDocId}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Drafting Prompt Textarea */}
                <div className="mt-4">
                  <label htmlFor="redline-prompt" className="mb-1 block text-xs font-semibold text-[#385142]">
                    Custom Drafting Prompt
                  </label>
                  <textarea
                    id="redline-prompt"
                    className="w-full resize-none rounded-xl border border-[#cbdad0] bg-[#fcfdfc] p-3 text-xs text-[#203629] placeholder-[#90a297] focus:border-[#2f5e43] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#2f5e43]/20"
                    rows={3}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="e.g., Change governing law to New York and require mutual attorney fee recovery..."
                    disabled={proposing || !selectedDocId}
                  />
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[#788b7f]">
                    <span>Max 500 characters</span>
                    <span>{instruction.length}/500</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => handleProposeRedline()}
                    disabled={proposing || !selectedDocId || !instruction.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-[#25523a] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#1a3d2a] disabled:opacity-50"
                  >
                    {proposing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
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

              {/* Section 2: Staged Edits for Batch Export */}
              <div className="border-t border-[#e5ebe6] p-5 flex-1 flex flex-col">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-[#1f372a]">Staged Edits for Batch Export</h2>
                    <p className="mt-0.5 text-[11px] text-[#63796d]">
                      {stagedEdits.length === 0
                        ? "No edits staged yet. Propose edits and click 'Stage Edit' to queue them."
                        : `${stagedEdits.filter((e) => e.applied).length} of ${stagedEdits.length} edits selected for export.`}
                    </p>
                  </div>
                  {stagedEdits.length > 0 && (
                    <span className="rounded-full bg-[#e3efe6] px-2.5 py-0.5 text-xs font-bold text-[#235338]">
                      {stagedEdits.length} Staged
                    </span>
                  )}
                </div>

                {stagedEdits.length > 0 && (
                  <div className="mt-3.5 space-y-2.5 flex-1">
                    {stagedEdits.map((edit) => (
                      <div
                        key={edit.id}
                        className={`rounded-lg border p-3 text-xs transition ${
                          edit.applied
                            ? "border-[#c4decb] bg-[#f8fbf9]"
                            : "border-[#e0e6e2] bg-[#fbfbfb] opacity-60"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <label className="flex items-center gap-2 font-semibold text-[#1e3b2b] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={edit.applied}
                              onChange={() => handleToggleStagedEdit(edit.id)}
                              className="h-3.5 w-3.5 rounded border-[#9fb9a6] text-[#25523a] focus:ring-[#25523a]"
                            />
                            <span>{edit.clauseTitle}</span>
                          </label>
                          <button
                            onClick={() => handleRemoveStagedEdit(edit.id)}
                            className="text-[#964038] hover:text-[#b82618] p-0.5"
                            title="Remove edit"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="mt-2 space-y-1 pl-5 font-mono text-[11px]">
                          <div className="rounded bg-[#fee2e2] px-2 py-0.5 text-[#991b1b] line-through">
                            - {edit.targetText}
                          </div>
                          <div className="rounded bg-[#dcfce7] px-2 py-0.5 text-[#166534]">
                            + {edit.revisedText}
                          </div>
                        </div>

                        <p className="mt-1.5 pl-5 text-[10px] italic text-[#607567]">
                          {edit.explanation}
                        </p>
                      </div>
                    ))}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#eaf0eb] pt-3">
                      <button
                        type="button"
                        onClick={() => setStagedEdits([])}
                        className="inline-flex items-center gap-1 text-[11px] text-[#80261f] hover:underline"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Clear all staged</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDownloadDocx()}
                        disabled={applying || stagedEdits.filter((e) => e.applied).length === 0}
                        className="flex items-center gap-1.5 rounded-lg bg-[#25523a] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#1a3d2a] disabled:opacity-50"
                      >
                        {applying ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Exporting…</span>
                          </>
                        ) : (
                          <>
                            <Download className="h-3.5 w-3.5" />
                            <span>Export ({stagedEdits.filter((e) => e.applied).length}) .docx</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Proposed Redline Inspection & Diff Viewer */}
            <div className="flex-1 min-h-0 overflow-y-auto bg-[#f8faf8] flex flex-col">
              {!currentProposal && !proposing && (
                <div className="m-auto flex max-w-md flex-col items-center justify-center p-8 text-center text-[#73887c]">
                  <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#e5eee8] text-[#25523a]">
                    <FilePenLine className="h-6 w-6" />
                  </div>
                  <h3 className="text-sm font-bold text-[#1f372a]">No active redline proposed yet</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#687f71]">
                    Select a document, pick a quick instruction pill or type your custom instruction on the left, then click &quot;Propose Redline&quot;.
                  </p>
                </div>
              )}

              {proposing && (
                <div className="m-auto flex flex-col items-center justify-center p-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#25523a]" />
                  <p className="mt-3 text-sm font-semibold text-[#213e2d]">
                    Locating clause & synthesizing legal revision…
                  </p>
                  <p className="mt-1 text-xs text-[#6e8276]">
                    Preserving surrounding contract context and formatting tracked changes
                  </p>
                </div>
              )}

              {currentProposal && !proposing && (
                <div className="p-6 max-w-4xl space-y-4">
                  {/* Proposal Header Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe8e1] pb-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-[#1f372a]">2. Proposed Redline Inspection</h2>
                      <span className="rounded bg-[#e8f2eb] px-2.5 py-0.5 text-xs font-semibold text-[#245338]">
                        {currentProposal.clauseTitle || "Target Clause"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const revised = isEditingProposal ? customRevisedText : currentProposal.revisedText;
                          void handleDownloadDocx([
                            { targetText: currentProposal.targetText, revisedText: revised },
                          ]);
                        }}
                        disabled={applying}
                        className="flex items-center gap-1.5 rounded-lg border border-[#25523a] bg-white px-3 py-1.5 text-xs font-semibold text-[#25523a] transition hover:bg-[#edf5ef] disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Download Revision (.docx)</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleStageCurrentEdit}
                        className="flex items-center gap-1.5 rounded-lg bg-[#25523a] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#1a3d2a]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Stage this Edit</span>
                      </button>
                    </div>
                  </div>

                  {/* Legal Rationale Box */}
                  <div className="rounded-xl border border-[#cfe1d5] bg-white p-4 shadow-2xs">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#2e6240]">
                      Legal Rationale &amp; Analysis
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#233d2e]">
                      {currentProposal.explanation}
                    </p>
                  </div>

                  {/* Visual Diff: Prior vs Proposed */}
                  <div className="space-y-3">
                    <div className="rounded-xl border border-[#fecaca] bg-[#fff5f5] p-4 shadow-2xs">
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

                    <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] p-4 shadow-2xs">
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
                          className="mt-2 w-full rounded-lg border border-[#86efac] bg-white p-2.5 font-mono text-xs text-[#14532d] focus:border-[#16a34a] focus:outline-none"
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
                    <div className="rounded-xl border border-[#dfe7e2] bg-white p-3.5 shadow-2xs">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#697d71]">
                        Full Clause Context
                      </div>
                      <blockquote className="mt-1 text-xs italic leading-relaxed text-[#415347] border-l-2 border-[#a8c9b3] pl-2.5">
                        &quot;{currentProposal.contextSentence}&quot;
                      </blockquote>
                    </div>
                  )}

                  {/* About Word Tracked Changes (.docx) */}
                  <div className="rounded-xl border border-[#e2e8e3] bg-[#f4f7f5] p-3.5 text-xs text-[#526659]">
                    <div className="font-bold text-[#203c2c] text-[11px]">About Word Tracked Changes (.docx)</div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[#5a7062]">
                      When you export, the backend packages your revisions directly using OpenXML elements{" "}
                      <code className="rounded bg-white px-1 py-0.5 text-[10px] font-mono text-[#b33939]">&lt;w:del&gt;</code> and{" "}
                      <code className="rounded bg-white px-1 py-0.5 text-[10px] font-mono text-[#25733d]">&lt;w:ins&gt;</code>.
                      Opening the downloaded document in Microsoft Word, Google Docs, or LibreOffice will immediately display standard redline markup with Accept/Reject controls.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default RedlinePage;
