import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Scale,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  FileText,
  ArrowRight,
  GitCompare,
  Search,
  Loader2,
  X,
  ArrowDown,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
} from "lucide-react";
import type {
  ComparisonReport,
  MatchedSectionComparison,
  UploadedDocument,
  CompareCitation,
} from "../types";
import { diffWords } from "../utils/diff";
import DocumentDropdown from "./DocumentDropdown";
import CompareChat from "./CompareChat";
import { apiUrl } from "../config";

interface DocumentComparisonProps {
  documents: UploadedDocument[];
  token: string;
  initialLeftId?: string | null;
  initialRightId?: string | null;
}

interface AssistantChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: CompareCitation[];
}

export function DocumentComparison({
  documents,
  token,
  initialLeftId,
  initialRightId,
}: DocumentComparisonProps) {
  const readyDocs = useMemo(
    () => documents.filter((d) => d.status === "ready"),
    [documents]
  );

  const [leftDocId, setLeftDocId] = useState<string>(
    initialLeftId || readyDocs[1]?.document_id || readyDocs[0]?.document_id || ""
  );
  const [rightDocId, setRightDocId] = useState<string>(
    initialRightId || readyDocs[0]?.document_id || readyDocs[1]?.document_id || ""
  );

  const [report, setReport] = useState<ComparisonReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab mode: "sideBySide" (default) or "fullChat"
  const [activeTab, setActiveTab] = useState<"sideBySide" | "fullChat">("sideBySide");

  // Active highlighted section
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  // Synchronized scrolling state
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);

  // Layout toggles to keep UI uncluttered
  const [showNavigator, setShowNavigator] = useState<boolean>(true);
  const [showChat, setShowChat] = useState<boolean>(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSignificance, setFilterSignificance] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Integrated Comparison Assistant Panel state
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<AssistantChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize selection
  useEffect(() => {
    if (!leftDocId && readyDocs.length >= 2) {
      setLeftDocId(readyDocs[1].document_id);
    }
    if (!rightDocId && readyDocs.length >= 1) {
      setRightDocId(readyDocs[0].document_id);
    }
  }, [readyDocs, leftDocId, rightDocId]);

  useEffect(() => {
    if (initialLeftId) setLeftDocId(initialLeftId);
    if (initialRightId) setRightDocId(initialRightId);
  }, [initialLeftId, initialRightId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  // Execute Comparison
  async function runComparison() {
    if (!leftDocId || !rightDocId) {
      setError("Please select two documents to compare.");
      return;
    }
    if (leftDocId === rightDocId) {
      setError("Please select two different documents to compare.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/compare"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leftDocumentId: leftDocId,
          rightDocumentId: rightDocId,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.detail || json.message || "Comparison could not be completed.");
      }

      const data = (json.data ?? json) as ComparisonReport;
      setReport(data);
      if (data.sections && data.sections.length > 0) {
        setActiveSectionId(data.sections[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error comparing contracts.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-run comparison when two valid documents are selected and no report exists yet
  useEffect(() => {
    if (leftDocId && rightDocId && leftDocId !== rightDocId && !report && !loading) {
      void runComparison();
    }
  }, [leftDocId, rightDocId]);

  // Synchronized scrolling handler
  function handleScroll(source: "left" | "right") {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;

    const sourceEl = source === "left" ? leftPaneRef.current : rightPaneRef.current;
    const targetEl = source === "left" ? rightPaneRef.current : leftPaneRef.current;

    if (sourceEl && targetEl) {
      const scrollRatio =
        sourceEl.scrollTop / (sourceEl.scrollHeight - sourceEl.clientHeight || 1);
      targetEl.scrollTop = scrollRatio * (targetEl.scrollHeight - targetEl.clientHeight);
    }

    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }

  // Smooth scroll to target section in both panes
  function scrollToSection(secId: string) {
    setActiveSectionId(secId);
    const leftEl = document.getElementById(`left-${secId}`);
    const rightEl = document.getElementById(`right-${secId}`);
    if (leftEl) leftEl.scrollIntoView({ behavior: "smooth", block: "start" });
    if (rightEl) rightEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Handle Comparison Chat Questions
  async function handleSendComparisonChat(promptText?: string) {
    const query = (promptText ?? chatQuestion).trim();
    if (!query || chatLoading || !leftDocId || !rightDocId) return;

    setChatLoading(true);
    setChatError(null);
    setChatQuestion("");

    const userMsg: AssistantChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: query,
    };
    setChatMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch(apiUrl("/api/compare/chat"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leftDocumentId: leftDocId,
          rightDocumentId: rightDocId,
          question: query,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.detail || json.message || "Failed to answer comparison question.");
      }

      const data = json.data ?? json;
      const asstMsg: AssistantChatMessage = {
        id: `asst-${Date.now()}`,
        role: "assistant",
        content: data.answer || "No comparative analysis returned.",
        citations: data.citations || [],
      };
      setChatMessages((prev) => [...prev, asstMsg]);
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : "Error generating answer.");
    } finally {
      setChatLoading(false);
    }
  }

  // Filter sections by status, significance, and search query
  const filteredSections = useMemo(() => {
    if (!report?.sections) return [];
    return report.sections.filter((s) => {
      if (filterStatus !== "all" && s.status !== filterStatus) return false;
      if (filterSignificance !== "all" && s.significance !== filterSignificance) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchTitle = s.title.toLowerCase().includes(q);
        const matchExpl = s.explanation?.toLowerCase().includes(q);
        const matchChanges = s.detectedChanges?.some((c) => c.toLowerCase().includes(q));
        if (!matchTitle && !matchExpl && !matchChanges) return false;
      }
      return true;
    });
  }, [report, filterStatus, filterSignificance, searchTerm]);

  const selectedOld = readyDocs.find((d) => d.document_id === leftDocId);
  const selectedNew = readyDocs.find((d) => d.document_id === rightDocId);

  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f7f9f7]"
      aria-label="Side-by-side contract comparison"
    >
      {/* Top Header & Version Bar */}
      <header className="shrink-0 border-b border-[#e1e9e3] bg-white px-5 py-2.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: View Tabs */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                activeTab === "sideBySide"
                  ? "bg-[#25523a] text-white shadow-2xs"
                  : "text-[#5b7365] hover:bg-[#f0f5f1] hover:text-[#25523a]"
              }`}
              onClick={() => setActiveTab("sideBySide")}
            >
              <GitCompare className="h-3.5 w-3.5" />
              <span>Side-by-Side Diff</span>
            </button>

            <button
              type="button"
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                activeTab === "fullChat"
                  ? "bg-[#25523a] text-white shadow-2xs"
                  : "text-[#5b7365] hover:bg-[#f0f5f1] hover:text-[#25523a]"
              }`}
              onClick={() => setActiveTab("fullChat")}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Comparative Chat</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                  activeTab === "fullChat"
                    ? "bg-white/20 text-white"
                    : "bg-[#e8f2eb] text-[#25523a]"
                }`}
              >
                AI
              </span>
            </button>
          </div>

          {/* Right: Dual Document Selectors & Comparison Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#697d70]">
                V1:
              </span>
              <div className="w-[170px] sm:w-[200px]">
                <DocumentDropdown
                  documents={readyDocs}
                  value={leftDocId}
                  onChange={(id) => {
                    setLeftDocId(id);
                    setReport(null);
                  }}
                  placeholder="Select prior draft"
                />
              </div>
            </div>

            <ArrowRight className="h-3.5 w-3.5 text-[#8aa093] shrink-0" />

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#697d70]">
                V2:
              </span>
              <div className="w-[170px] sm:w-[200px]">
                <DocumentDropdown
                  documents={readyDocs}
                  value={rightDocId}
                  onChange={(id) => {
                    setRightDocId(id);
                    setReport(null);
                  }}
                  placeholder="Select revised draft"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={loading || readyDocs.length < 2 || !leftDocId || !rightDocId || leftDocId === rightDocId}
              onClick={() => void runComparison()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#25523a] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[#1a3d2a] disabled:opacity-40 transition cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Comparing…</span>
                </>
              ) : (
                <>
                  <GitCompare className="h-3.5 w-3.5" />
                  <span>Compare</span>
                </>
              )}
            </button>

            {report && activeTab === "sideBySide" && (
              <button
                type="button"
                onClick={() => setShowChat(!showChat)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  showChat
                    ? "bg-[#eaf4ed] border-[#25523a] text-[#1e4630]"
                    : "border-[#c9dcd0] bg-[#f4f9f5] text-[#25523a] hover:bg-[#eaf4ed]"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-[#25523a]" />
                <span>{showChat ? "Close Assistant" : "Ask Assistant"}</span>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-2.5 rounded-lg border border-[#fecaca] bg-[#fff5f5] p-2 text-xs text-[#991b1b] flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#dc2626]" />
            <span>{error}</span>
          </div>
        )}
      </header>

      {/* Tab Mode: Full Comparative Chat */}
      {activeTab === "fullChat" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CompareChat leftDoc={selectedOld} rightDoc={selectedNew} token={token} />
        </div>
      )}

      {/* Tab Mode: Side-by-Side Review */}
      {activeTab === "sideBySide" && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Compact Metrics & Legend Strip (Saves vertical space) */}
          {report && (
            <div className="shrink-0 border-b border-[#e5ece7] bg-white px-5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
              {/* Left: Stat Pills */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[#f1f5f2] px-2.5 py-1 text-[11px] font-semibold text-[#284334]">
                  <span>Clauses:</span>
                  <strong>{report.summary.totalSections}</strong>
                </span>

                <span className="inline-flex items-center gap-1.5 rounded-md bg-[#fff7ed] px-2.5 py-1 text-[11px] font-semibold text-[#c2410c] border border-[#ffedd5]">
                  <span>Modified:</span>
                  <strong>{report.summary.modifiedCount}</strong>
                </span>

                <span className="inline-flex items-center gap-1.5 rounded-md bg-[#f0fdf4] px-2.5 py-1 text-[11px] font-semibold text-[#15803d] border border-[#dcfce7]">
                  <span>Added:</span>
                  <strong>+{report.summary.addedCount}</strong>
                </span>

                <span className="inline-flex items-center gap-1.5 rounded-md bg-[#f8faf9] px-2.5 py-1 text-[11px] font-semibold text-[#4b6353] border border-[#e4ede7]">
                  <span>Deleted:</span>
                  <strong>-{report.summary.deletedCount}</strong>
                </span>

                {(report.summary.highSignificanceCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-[#fef2f2] px-2.5 py-1 text-[11px] font-semibold text-[#b91c1c] border border-[#fee2e2]">
                    <span>High Risk:</span>
                    <strong>{report.summary.highSignificanceCount}</strong>
                  </span>
                )}
              </div>

              {/* Right: Toggle Navigator & Diff Legend */}
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2 text-[11px] text-[#637d6e]">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">
                    <span className="line-through decoration-red-600 font-bold">Deleted text</span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    <span className="underline decoration-2 decoration-emerald-600 font-bold">Added text</span>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setShowNavigator(!showNavigator)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[#486654] hover:bg-[#edf4ef] transition cursor-pointer"
                  title={showNavigator ? "Collapse Navigator" : "Show Navigator"}
                >
                  {showNavigator ? (
                    <>
                      <PanelLeftClose className="h-3.5 w-3.5" />
                      <span>Hide list</span>
                    </>
                  ) : (
                    <>
                      <PanelLeft className="h-3.5 w-3.5" />
                      <span>Clauses ({filteredSections.length})</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Empty State when no report loaded yet */}
          {!report && !loading && (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#e6efe8] text-[#245b41] shadow-2xs">
                <GitCompare className="h-6 w-6" />
              </div>
              <h2 className="text-base font-bold text-[#233a2e]">
                Side-by-Side Contract Comparison
              </h2>
              <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[#688172]">
                Select two contract drafts above to automatically align clauses, compute word-level
                visual diffs, assess risk shifts, and ask comparative questions with verified citations.
              </p>
              <button
                type="button"
                disabled={readyDocs.length < 2 || !leftDocId || !rightDocId || leftDocId === rightDocId}
                onClick={() => void runComparison()}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#25523a] px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-[#1a3d2a] disabled:opacity-40 transition cursor-pointer"
              >
                <GitCompare className="h-4 w-4" />
                <span>Run Comparison</span>
              </button>
            </div>
          )}

          {/* Loading Spinner */}
          {loading && (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-[#557161]">
              <Loader2 className="h-7 w-7 animate-spin text-[#25523a]" />
              <p className="mt-3 text-sm font-semibold text-[#20392b]">
                Aligning clauses &amp; calculating diffs…
              </p>
              <p className="mt-1 text-xs text-[#738d7e]">
                Analyzing language differences across both drafts.
              </p>
            </div>
          )}

          {/* Main Comparison Area: Clean 2-Pane or 3-Pane View */}
          {report && !loading && (
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Optional Collapsible Change Navigator (Left) */}
              {showNavigator && (
                <aside className="w-64 shrink-0 border-r border-[#e1e9e3] bg-white flex flex-col min-h-0 overflow-hidden">
                  <div className="p-3 border-b border-[#edf3ee] space-y-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-[#1e3b2b]">Clauses</span>
                      <span className="text-[10px] text-[#5e7768] font-mono font-semibold">
                        {filteredSections.length} of {report.sections.length}
                      </span>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-[#7f9788]" />
                      <input
                        type="text"
                        placeholder="Filter clauses…"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full rounded-md border border-[#d3ded6] bg-[#f9fbf9] pl-7 pr-2.5 py-1 text-xs text-[#284334] focus:outline-hidden focus:border-[#25523a]"
                      />
                    </div>

                    <div className="flex gap-1.5">
                      <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="flex-1 rounded-md border border-[#d3ded6] bg-[#f9fbf9] px-2 py-1 text-[11px] text-[#284334] focus:outline-hidden"
                      >
                        <option value="all">All ({report.sections.length})</option>
                        <option value="modified">Modified ({report.summary.modifiedCount})</option>
                        <option value="added">Added ({report.summary.addedCount})</option>
                        <option value="deleted">Deleted ({report.summary.deletedCount})</option>
                        <option value="unchanged">Unchanged ({report.summary.unchangedCount})</option>
                      </select>

                      <select
                        value={filterSignificance}
                        onChange={(e) => setFilterSignificance(e.target.value)}
                        className="flex-1 rounded-md border border-[#d3ded6] bg-[#f9fbf9] px-2 py-1 text-[11px] text-[#284334] focus:outline-hidden"
                      >
                        <option value="all">All Risk</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </div>

                  {/* Clause List */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {filteredSections.map((sec) => {
                      const isActive = activeSectionId === sec.id;
                      return (
                        <button
                          key={sec.id}
                          type="button"
                          onClick={() => scrollToSection(sec.id)}
                          className={`w-full text-left p-2 rounded-lg text-xs transition cursor-pointer border ${
                            isActive
                              ? "bg-[#eaf4ed] border-[#25523a] font-semibold text-[#183a27] shadow-2xs"
                              : "border-transparent hover:bg-[#f3f7f4] text-[#3c5747]"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px]">
                            <span
                              className={`font-mono uppercase font-bold text-[9px] px-1 rounded ${
                                sec.status === "modified"
                                  ? "bg-amber-100 text-amber-900"
                                  : sec.status === "added"
                                  ? "bg-emerald-100 text-emerald-900"
                                  : sec.status === "deleted"
                                  ? "bg-red-100 text-red-900"
                                  : "bg-zinc-100 text-zinc-700"
                              }`}
                            >
                              {sec.status === "modified" && "MODIFIED"}
                              {sec.status === "added" && "+ ADDED"}
                              {sec.status === "deleted" && "- DELETED"}
                              {sec.status === "unchanged" && "UNCHANGED"}
                            </span>

                            {sec.significance === "high" && (
                              <span className="text-red-700 bg-red-100 px-1 rounded font-bold text-[9px]">
                                HIGH
                              </span>
                            )}
                          </div>
                          <p className="truncate text-[11px] mt-0.5 font-medium">{sec.title}</p>
                        </button>
                      );
                    })}
                  </div>
                </aside>
              )}

              {/* Side-by-Side Dual-Pane Viewer (Wide, comfortable reading space) */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
                {/* Dual Panes Header */}
                <div className="grid grid-cols-2 bg-[#f8faf8] border-b border-[#e1e9e3] text-xs font-bold divide-x divide-[#e1e9e3] shrink-0">
                  <div className="px-4 py-2 flex items-center justify-between text-[#263e30]">
                    <span className="truncate flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-[#547361] shrink-0" />
                      <span className="truncate">{report.leftDocumentName}</span>
                    </span>
                    <span className="text-[10px] text-[#4d6657] font-mono uppercase bg-[#e4ede6] px-1.5 py-0.5 rounded font-semibold shrink-0">
                      Version 1 (Original)
                    </span>
                  </div>

                  <div className="px-4 py-2 flex items-center justify-between text-[#183f2a] bg-[#f2f8f4]">
                    <span className="truncate flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-[#25523a] shrink-0" />
                      <span className="truncate">{report.rightDocumentName}</span>
                    </span>
                    <span className="text-[10px] text-[#25523a] font-mono uppercase bg-[#d9ebe0] px-1.5 py-0.5 rounded font-bold shrink-0">
                      Version 2 (Revised)
                    </span>
                  </div>
                </div>

                {/* Synchronized Side-by-Side Scrolling Panes */}
                <div className="flex-1 grid grid-cols-2 divide-x divide-[#e1e9e3] overflow-hidden min-h-0">
                  {/* Left Pane (Version 1) */}
                  <div
                    ref={leftPaneRef}
                    onScroll={() => handleScroll("left")}
                    className="h-full overflow-y-auto p-4 space-y-4"
                  >
                    {filteredSections.map((sec) => (
                      <SideBySideClauseCard
                        key={sec.id}
                        side="left"
                        sec={sec}
                        isActive={activeSectionId === sec.id}
                        onClick={() => setActiveSectionId(sec.id)}
                      />
                    ))}
                  </div>

                  {/* Right Pane (Version 2) */}
                  <div
                    ref={rightPaneRef}
                    onScroll={() => handleScroll("right")}
                    className="h-full overflow-y-auto p-4 space-y-4 bg-[#fbfdfb]"
                  >
                    {filteredSections.map((sec) => (
                      <SideBySideClauseCard
                        key={sec.id}
                        side="right"
                        sec={sec}
                        isActive={activeSectionId === sec.id}
                        onClick={() => setActiveSectionId(sec.id)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Optional Assistant Panel (Slide-out on right) */}
              {showChat && (
                <aside className="w-80 shrink-0 border-l border-[#e1e9e3] bg-white shadow-lg flex flex-col min-h-0 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#1b3a29] text-white text-xs shrink-0">
                    <span className="font-semibold flex items-center gap-1.5 truncate">
                      <MessageSquare className="h-3.5 w-3.5 text-[#9eceb1] shrink-0" />
                      <span className="truncate">Comparison Assistant</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] bg-white/20 text-[#e0f2e6] px-1.5 py-0.5 rounded font-mono font-medium shrink-0">
                        Dual-Authority
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowChat(false)}
                        className="text-white/70 hover:text-white transition px-1 py-0.5 rounded hover:bg-white/10 text-xs cursor-pointer font-bold"
                        title="Close Assistant Panel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Quick Prompts when no messages */}
                  {chatMessages.length === 0 && (
                    <div className="p-3 bg-[#f8faf8] border-b border-[#e6eee8] text-xs shrink-0 space-y-2">
                      <span className="text-[11px] text-[#557161] font-medium block">
                        Quick prompts:
                      </span>
                      <div className="flex flex-col gap-1.5">
                        {[
                          "What changed in the termination notice period?",
                          "What are the biggest financial and liability differences?",
                          "Which version favors the Customer?",
                        ].map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => void handleSendComparisonChat(prompt)}
                            className="text-left px-2.5 py-1.5 rounded-lg bg-white border border-[#d6e3da] text-[#244533] hover:bg-[#f0f6f2] hover:border-[#b4cfbd] transition text-[11px] cursor-pointer leading-tight shadow-2xs"
                          >
                            &quot;{prompt}&quot;
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Messages Feed */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                    {chatMessages.length === 0 && (
                      <div className="text-center py-6 text-[#7a9586] text-xs italic px-2">
                        Ask questions to compare obligations and risk shifts between both versions.
                      </div>
                    )}

                    {chatMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${
                          msg.role === "user" ? "items-end" : "items-start"
                        }`}
                      >
                        <div
                          className={`max-w-[95%] rounded-xl px-3 py-2 leading-relaxed text-xs ${
                            msg.role === "user"
                              ? "bg-[#25523a] text-white"
                              : "bg-[#f8faf8] border border-[#e2eae4] text-[#1e392b]"
                          }`}
                        >
                          <div className="markdown-answer [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mb-1 [&_p]:my-1 [&_ul]:pl-3.5 [&_ul]:list-disc [&_li]:my-0.5">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        </div>

                        {/* Verified Citations */}
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="mt-1 max-w-[95%] space-y-1 w-full">
                            <span className="text-[9px] font-bold text-[#567262] uppercase tracking-wider block">
                              Source Evidence ({msg.citations.length})
                            </span>
                            {msg.citations.map((c, i) => (
                              <div
                                key={i}
                                className="p-1.5 rounded bg-emerald-50/80 border border-emerald-200 text-[10px] text-emerald-950 cursor-pointer hover:bg-emerald-100 transition shadow-2xs"
                                onClick={() => {
                                  const matchingSec = report.sections.find(
                                    (s) =>
                                      (s.leftText && s.leftText.includes(c.quote)) ||
                                      (s.rightText && s.rightText.includes(c.quote))
                                  );
                                  if (matchingSec) scrollToSection(matchingSec.id);
                                }}
                                title="Click to scroll to this clause"
                              >
                                <span className="font-semibold text-emerald-800 inline-flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                                  <span className="truncate">
                                    {c.documentName || "Contract"} • Page{" "}
                                    {c.pageNumber || c.pageStart || 1}
                                  </span>
                                </span>
                                <p className="italic text-[#374c40] truncate mt-0.5">
                                  &quot;{c.quote}&quot;
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}

                    {chatLoading && (
                      <div className="text-xs text-[#2b513c] flex items-center gap-2 p-2 bg-[#f4f8f5] rounded-lg border border-[#d6e3da]">
                        <span className="h-2 w-2 rounded-full bg-[#25523a] animate-pulse shrink-0" />
                        <span className="text-[11px]">
                          Analyzing differences…
                        </span>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>

                  {chatError && (
                    <div className="px-3 py-1.5 bg-red-50 text-[11px] text-red-700 border-t border-red-200 flex items-center gap-1.5 shrink-0">
                      <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                      <span className="truncate">{chatError}</span>
                    </div>
                  )}

                  {/* Chat Input */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSendComparisonChat();
                    }}
                    className="p-2 border-t border-[#e2eae4] bg-[#f9fbf9] flex items-center gap-1.5 shrink-0"
                  >
                    <input
                      type="text"
                      placeholder="Ask about differences…"
                      value={chatQuestion}
                      onChange={(e) => setChatQuestion(e.target.value)}
                      disabled={chatLoading}
                      className="flex-1 rounded-md border border-[#cddad1] bg-white px-2.5 py-1.5 text-xs text-[#1e382a] focus:outline-hidden focus:border-[#25523a]"
                    />
                    <button
                      type="submit"
                      disabled={chatLoading || !chatQuestion.trim()}
                      className="rounded-md bg-[#25523a] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1a3d2a] disabled:opacity-40 transition cursor-pointer shrink-0"
                    >
                      Ask
                    </button>
                  </form>
                </aside>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SideBySideClauseCard({
  side,
  sec,
  isActive,
  onClick,
}: {
  side: "left" | "right";
  sec: MatchedSectionComparison;
  isActive: boolean;
  onClick: () => void;
}) {
  const text = side === "left" ? sec.leftText : sec.rightText;

  const isDeleted = side === "left" && sec.status === "deleted";
  const isAdded = side === "right" && sec.status === "added";
  const isModified = sec.status === "modified";

  // Compute precise word-level diff between original and revision
  const diff = useMemo(() => {
    if (!isModified || !sec.leftText || !sec.rightText) return null;
    return diffWords(sec.leftText, sec.rightText);
  }, [isModified, sec.leftText, sec.rightText]);

  return (
    <article
      id={`${side}-${sec.id}`}
      onClick={onClick}
      className={`rounded-xl border p-4 transition-all text-xs font-serif leading-relaxed ${
        isActive
          ? "ring-2 ring-[#25523a]/40 border-[#25523a] bg-white shadow-sm"
          : "border-[#e1e9e3] bg-white hover:border-[#b9cebe]"
      }`}
    >
      {/* Clause Title & Accessible Badges */}
      <div className="font-sans flex items-center justify-between pb-2 mb-2.5 border-b border-[#edf3ee] flex-wrap gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#1f3a2c] text-xs">{sec.title}</span>
          {isModified && (
            <span className="text-[10px] font-medium text-[#7c622a] bg-[#fef9ec] border border-[#fef0cb] px-1.5 py-0.5 rounded">
              {side === "left" ? "Prior wording" : "Revised wording"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isDeleted && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-900 border border-red-200">
              [-] DELETED
            </span>
          )}
          {isAdded && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-200">
              [+] INSERTED
            </span>
          )}
          {isModified && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
              [Δ] MODIFIED
            </span>
          )}

          {sec.significance === "high" && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-800 border border-red-200">
              HIGH RISK
            </span>
          )}

          {isModified && diff && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const target = document.getElementById(`diff-target-${side}-${sec.id}`);
                if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium bg-[#f5f8f6] hover:bg-[#eaf3ed] text-[#25523a] border border-[#cfe0d5] transition cursor-pointer"
              title="Jump to first change in this clause"
            >
              <span>Jump</span>
              <ArrowDown className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Clean Single-Line Risk & Impact Note on Right Pane (No duplicate text walls!) */}
      {side === "right" && isModified && (sec.favorsParty !== "Neutral" || sec.explanation) && (
        <div className="font-sans mb-3 rounded-lg border border-[#e6eee8] bg-[#f8faf8] px-3 py-2 text-[11px] text-[#334e3e] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-[#1c3c2a]">
            <Scale className="h-3 w-3 text-[#25523a]" />
            <span>Favors: {sec.favorsParty}</span>
            <span className="text-[#8aa092]">•</span>
            <span className="font-normal text-[#5c7768]">Risk: {sec.riskLevel}</span>
          </div>
          {sec.explanation && (
            <p className="w-full text-[11px] text-[#4d6657] font-normal leading-normal">
              {sec.explanation}
            </p>
          )}
        </div>
      )}

      {/* Clause Text Content with Word-Level Diff Highlighting */}
      {text ? (
        isModified && diff ? (
          <div className="whitespace-pre-wrap leading-relaxed text-[#23382c]">
            {side === "left"
              ? (() => {
                  let firstTargetMarked = false;
                  return diff.leftTokens.map((token, idx) => {
                    if (token.op === "deleted") {
                      const isFirst = !firstTargetMarked;
                      if (isFirst) firstTargetMarked = true;
                      return (
                        <mark
                          key={idx}
                          id={isFirst ? `diff-target-left-${sec.id}` : undefined}
                          className="bg-red-100 text-red-950 line-through decoration-red-600 decoration-1.5 font-medium px-1 py-0.5 rounded border border-red-300 inline scroll-mt-24 shadow-2xs"
                          title="Original text removed in revision"
                        >
                          {token.text}
                        </mark>
                      );
                    }
                    return (
                      <span key={idx} className="text-[#23382c]">
                        {token.text}
                      </span>
                    );
                  });
                })()
              : (() => {
                  let firstTargetMarked = false;
                  return diff.rightTokens.map((token, idx) => {
                    if (token.op === "inserted") {
                      const isFirst = !firstTargetMarked;
                      if (isFirst) firstTargetMarked = true;
                      return (
                        <mark
                          key={idx}
                          id={isFirst ? `diff-target-right-${sec.id}` : undefined}
                          className="bg-emerald-100 text-emerald-950 underline decoration-emerald-600 decoration-2 font-medium px-1 py-0.5 rounded border border-emerald-300 inline scroll-mt-24 shadow-2xs"
                          title="New text added in revision"
                        >
                          {token.text}
                        </mark>
                      );
                    }
                    return (
                      <span key={idx} className="text-[#23382c]">
                        {token.text}
                      </span>
                    );
                  });
                })()}
          </div>
        ) : (
          <div
            className={`whitespace-pre-wrap leading-relaxed ${
              isDeleted
                ? "line-through decoration-red-500/70 text-[#6d7f74] bg-red-50/40 p-2.5 rounded border border-red-200"
                : isAdded
                ? "underline decoration-emerald-500/70 text-[#1a3828] bg-emerald-50/40 p-2.5 rounded border border-emerald-200 font-medium"
                : "text-[#23382c]"
            }`}
          >
            {text}
          </div>
        )
      ) : (
        <div className="italic text-[#8aa092] py-4 text-center rounded-lg border border-dashed border-[#d8e3dc] bg-[#fafcfa]">
          {side === "left"
            ? "— Clause not present in Version 1 (Newly added in Version 2) —"
            : "— Clause deleted from Version 2 (Omitted in revision) —"}
        </div>
      )}
    </article>
  );
}

export default DocumentComparison;
