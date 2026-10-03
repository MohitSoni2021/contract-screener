import { useEffect, useState } from "react";
import { MessageSquare, GitCompare, ArrowRight, FileText, ExternalLink } from "lucide-react";
import type { ComparisonChange, UploadedDocument } from "../types";
import DocumentDropdown from "./DocumentDropdown";
import CompareChat from "./CompareChat";
import { apiUrl } from "../config";

type Props = { documents: UploadedDocument[]; token: string };

function DocumentComparison({ documents, token }: Props) {
  const ready = documents.filter((document) => document.status === "ready");
  const [oldId, setOldId] = useState("");
  const [newId, setNewId] = useState("");
  const [changes, setChanges] = useState<ComparisonChange[]>([]);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<"position" | "significance">("significance");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"chat" | "diffs">("chat");

  // Preselect documents if available and not yet chosen
  useEffect(() => {
    if (!oldId && !newId && ready.length >= 2) {
      setOldId(ready[1].document_id);
      setNewId(ready[0].document_id);
    } else if (!oldId && ready.length >= 1) {
      setOldId(ready[0].document_id);
    }
  }, [ready, oldId, newId]);

  async function compare() {
    if (!oldId || !newId || oldId === newId) {
      setError("Choose two different ready documents.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/documents/compare"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          old_document_id: oldId,
          new_document_id: newId,
        }),
      });
      const body = (await response.json()) as {
        detail?: string;
        changes?: ComparisonChange[];
      };
      if (!response.ok)
        throw new Error(body.detail ?? "Comparison could not be completed.");
      setChanges(body.changes ?? []);
    } catch (comparisonError) {
      setError(
        comparisonError instanceof Error
          ? comparisonError.message
          : "Comparison could not be completed.",
      );
    } finally {
      setLoading(false);
    }
  }

  const visibleChanges = changes
    .filter((change) => filter === "all" || change.significance === filter)
    .sort((left, right) =>
      sort === "significance"
        ? significanceRank(right.significance) -
        significanceRank(left.significance)
        : (left.new?.block_number ?? left.old?.block_number ?? 0) -
        (right.new?.block_number ?? right.old?.block_number ?? 0),
    );
  const selectedOld = ready.find((document) => document.document_id === oldId);
  const selectedNew = ready.find((document) => document.document_id === newId);

  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f7f9f7]"
      aria-labelledby="comparison-title"
    >
      {/* Header and Selectors */}
      <div className="shrink-0">

        {/* Unified Dual Document Selector Bar */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl p-3">
          <div className="flex flex-1 min-w-[220px] flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#697d70]">
              Earlier Version (V1)
            </span>
            <DocumentDropdown
              documents={ready}
              value={oldId}
              onChange={setOldId}
              placeholder="Select earlier version"
            />
          </div>

          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d2ded5] bg-white text-[#567a65] shadow-2xs self-end mb-0.5">
            <ArrowRight className="h-4 w-4" />
          </div>

          <div className="flex flex-1 min-w-[220px] flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#697d70]">
              Later Version (V2)
            </span>
            <DocumentDropdown
              documents={ready}
              value={newId}
              onChange={setNewId}
              placeholder="Select later version"
            />
          </div>

          {activeTab === "diffs" && (
            <div className="self-end mb-0.5">
              <button
                type="button"
                className="flex h-9 items-center gap-1.5 rounded-lg bg-[#25523a] px-4 text-xs font-semibold text-white shadow-xs transition hover:bg-[#1b3d2b] disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => void compare()}
                disabled={loading || ready.length < 2 || !oldId || !newId || oldId === newId}
              >
                <GitCompare className="h-3.5 w-3.5" />
                <span>{loading ? "Comparing…" : "Compare versions"}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 bg-[#fff5f5] px-6 py-2.5 text-xs text-[#991b1b] border-b border-[#fecaca]" role="alert">
          {error}
        </div>
      )}

      {/* View Switcher Tabs */}
      <div className="flex items-center justify-between border-b border-[#dfe8e1] bg-white px-6 shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`flex items-center gap-2 py-3 px-3.5 text-xs font-semibold border-b-2 transition ${activeTab === "chat"
              ? "border-[#25523a] text-[#25523a]"
              : "border-transparent text-[#6e8275] hover:text-[#25523a]"
              }`}
            onClick={() => setActiveTab("chat")}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Comparative Q&amp;A Chat</span>
            <span className="rounded-md bg-[#eaf3ec] px-1.5 py-0.5 text-[10px] font-bold text-[#235338]">
              Dual-Doc AI
            </span>
          </button>

          <button
            type="button"
            className={`flex items-center gap-2 py-3 px-3.5 text-xs font-semibold border-b-2 transition ${activeTab === "diffs"
              ? "border-[#25523a] text-[#25523a]"
              : "border-transparent text-[#6e8275] hover:text-[#25523a]"
              }`}
            onClick={() => {
              setActiveTab("diffs");
              if (changes.length === 0 && oldId && newId && oldId !== newId) {
                void compare();
              }
            }}
          >
            <GitCompare className="h-3.5 w-3.5" />
            <span>Clause Diff Review</span>
            {changes.length > 0 && (
              <span className="rounded-md bg-[#f0f4f1] px-1.5 py-0.5 text-[10px] font-bold text-[#446050]">
                {changes.length}
              </span>
            )}
          </button>
        </div>


      </div>

      {/* Tab 1: Comparative Q&A Chat */}
      {activeTab === "chat" && (
        <CompareChat leftDoc={selectedOld} rightDoc={selectedNew} token={token} />
      )}

      {/* Tab 2: Clause Diff Review */}
      {activeTab === "diffs" && (
        <div className="flex-1 overflow-y-auto min-h-0 bg-[#f7f9f7]">
          {changes.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-center text-[#74887d]">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#e5efe8] text-[#275d40]">
                <GitCompare className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-[#253d30]">No clause differences loaded.</p>
              <p className="mt-1 max-w-sm text-xs text-[#708779]">
                Click &quot;Compare versions&quot; above to align clauses and calculate substantive changes between these drafts.
              </p>
            </div>
          )}

          {changes.length > 0 && (
            <>
              <div className="comparison-toolbar px-6 py-3 border-b border-[#dfe7e1] bg-white">
                <div className="comparison-filters">
                  {[
                    ["all", "All"],
                    ["substantive", "Substantive"],
                    ["wording", "Wording"],
                    ["formatting", "Formatting"],
                  ].map(([value, label]) => (
                    <button
                      className={filter === value ? "selected" : ""}
                      key={value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label>
                  Sort
                  <select
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as "position" | "significance")
                    }
                  >
                    <option value="significance">Significance</option>
                    <option value="position">Document order</option>
                  </select>
                </label>
              </div>
              <div className="comparison-results max-w-5xl mx-auto min-h-0 flex-1 px-6 py-6">
                {visibleChanges.map((change) => (
                  <article
                    className={`comparison-change ${change.significance}`}
                    key={change.change_id}
                  >
                    <div className="comparison-change-meta">
                      <span className={`change-pill ${change.change_type}`}>
                        {change.change_type}
                      </span>
                      <span>
                        {change.significance === "none"
                          ? "unchanged"
                          : change.significance}
                      </span>
                      <span>
                        old §{change.old?.block_number ?? "—"} · new §
                        {change.new?.block_number ?? "—"}
                      </span>
                    </div>
                    <p>{change.summary}</p>
                    <div className="comparison-texts">
                      <div>
                        <strong>Earlier</strong>
                        <span>
                          {change.old?.text ??
                            "Clause not present in earlier version."}
                        </span>
                      </div>
                      <div>
                        <strong>Later</strong>
                        <span>
                          {change.new?.text ??
                            "Clause not present in later version."}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function significanceRank(value: ComparisonChange["significance"]) {
  return value === "substantive"
    ? 3
    : value === "wording"
      ? 2
      : value === "formatting"
        ? 1
        : 0;
}

async function openSource(document: UploadedDocument, token: string) {
  const response = await fetch(apiUrl(`/api/documents/${document.document_id}/file`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return;
  const url = URL.createObjectURL(await response.blob());
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default DocumentComparison;
