import { useState } from "react";
import type { ComparisonChange, UploadedDocument } from "../types";

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

  async function compare() {
    if (!oldId || !newId || oldId === newId) {
      setError("Choose two different ready documents.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/documents/compare", {
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
      className={`comparison-section flex min-h-0 min-w-fit overflow-y-scroll w-full flex-col ${changes.length > 0 ? " flex-1" : ""}`}
      aria-labelledby="comparison-title"
    >
      <div className="comparison-heading">
        <div>
          <div className="eyebrow">VERSION REVIEW</div>
          <h2 id="comparison-title">Compare two document versions</h2>
          <p>
            Align clauses!overflow-hidden, spot material risk, and keep both
            originals one click away.
          </p>
        </div>
        <span className="comparison-count">
          {
            changes.filter((change) => change.significance === "substantive")
              .length
          }{" "}
          substantive
        </span>
      </div>
      <div className="comparison-controls">
        <label>
          Earlier version
          <select
            value={oldId}
            onChange={(event) => setOldId(event.target.value)}
          >
            <option value="">Select a document</option>
            {ready.map((document) => (
              <option key={document.document_id} value={document.document_id}>
                {document.filename}
              </option>
            ))}
          </select>
        </label>
        <span className="comparison-arrow">→</span>
        <label>
          Later version
          <select
            value={newId}
            onChange={(event) => setNewId(event.target.value)}
          >
            <option value="">Select a document</option>
            {ready.map((document) => (
              <option key={document.document_id} value={document.document_id}>
                {document.filename}
              </option>
            ))}
          </select>
        </label>
        <button
          className="comparison-button"
          onClick={() => void compare()}
          disabled={loading || ready.length < 2}
        >
          {loading ? "Comparing…" : "Compare versions"}
        </button>
      </div>
      {selectedOld && selectedNew && (
        <div className="comparison-sources">
          <button onClick={() => void openSource(selectedOld, token)}>
            <span>OLD</span>
            {selectedOld.filename}
          </button>
          <button onClick={() => void openSource(selectedNew, token)}>
            <span>NEW</span>
            {selectedNew.filename}
          </button>
        </div>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {changes.length > 0 && (
        <>
          <div className="comparison-toolbar">
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
          <div className="comparison-results min-h-0 flex-1 px-4 py-4">
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
  const response = await fetch(`/api/documents/${document.document_id}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return;
  const url = URL.createObjectURL(await response.blob());
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default DocumentComparison;
