from __future__ import annotations

import io
import zipfile
import pytest

from app.services.citations.locator import SourcePage, page_for_offset
from app.services.citations.normalizer import (
    normalize_quote,
    normalize_with_map,
)
from app.services.citations.verifier import (
    MIN_QUOTE_CHARS,
    OffsetRange,
    SourceDocument,
    verify_quote,
)
from app.services.comparison.diff import diff_words
from app.services.comparison.compare import (
    compare_contracts,
    extract_sections,
)
from app.services.redline.docx_xml import (
    DocxEdit,
    apply_tracked_changes_to_docx,
    create_docx_with_tracked_changes,
)
from app.services.redline.propose import deterministic_redline
from app.services.ai.synthesis import (
    extract_contract_clauses,
    synthesize_legal_answer,
)
from app.services.ai.tools import execute_tool
from app.services.ai.answer import ModelAnswer, finalize_answer
from app.services.retrieval.chunker import chunk_document
from app.services.retrieval.keyword import retrieve_chunks


# ---------------------------------------------------------------------------
# 1. Normalization & Zero-Trust Verification Tests
# ---------------------------------------------------------------------------

def test_normalizer_folds_typography_and_builds_accurate_map():
    original = "The “Agreement” shall\u00A0govern—with ‘respect’ to   payments."
    norm = normalize_with_map(original)

    # Typographic quotes and em-dash folded, non-breaking space converted, whitespace collapsed
    assert '""' in norm.text or '""' in norm.text or '"agreement"' in norm.text
    assert "payments." in norm.text
    assert "  " not in norm.text

    # Map verification: every normalized char traces back to its original position
    for norm_idx, orig_idx in enumerate(norm.map):
        assert 0 <= orig_idx < len(original)

    # Substring search in normalized text maps back to original character offsets
    needle = "agreement"
    start_in_norm = norm.text.find(needle)
    assert start_in_norm != -1
    start_in_orig = norm.map[start_in_norm]
    end_in_orig = norm.map[start_in_norm + len(needle) - 1] + 1
    assert original[start_in_orig:end_in_orig] == "Agreement"


def test_locator_page_lookup():
    pages = [
        SourcePage(page_number=1, start_offset=0, text="Page 1 text"),
        SourcePage(page_number=2, start_offset=100, text="Page 2 text"),
        SourcePage(page_number=3, start_offset=250, text="Page 3 text"),
    ]
    assert page_for_offset(pages, 0) == 1
    assert page_for_offset(pages, 50) == 1
    assert page_for_offset(pages, 100) == 2
    assert page_for_offset(pages, 150) == 2
    assert page_for_offset(pages, 250) == 3
    assert page_for_offset(pages, 300) == 3


def test_verify_quote_finds_exact_and_whitespace_variant_quotes():
    full_text = (
        "CONSULTING AGREEMENT\n\n"
        "Section 1. Services.\n"
        "Consultant shall perform the services described in Exhibit A.\n\n"
        "Section 2. Fees.\n"
        "Client shall pay Consultant a fee of $10,000 per month within thirty (30) days of invoice.\n\n"
        "Section 3. Limitation of Liability.\n"
        "The aggregate liability of either party shall not exceed $100,000.\n"
    )
    pages = [
        SourcePage(page_number=1, start_offset=0, text=full_text[:150]),
        SourcePage(page_number=2, start_offset=150, text=full_text[150:]),
    ]
    doc = SourceDocument(id="doc-1", name="Contract.pdf", full_text=full_text, pages=pages)

    # 1. Exact candidate quote
    exact_q = "Consultant shall perform the services described in Exhibit A."
    res = verify_quote(doc, exact_q)
    assert res.verified is True
    assert res.citation is not None
    assert res.citation.quote == exact_q
    assert res.citation.document_id == "doc-1"
    assert res.citation.page_start == 1

    # 2. Quote with newline and extra whitespace differences
    whitespace_q = "Consultant   shall\nperform the services   described in Exhibit A."
    res_ws = verify_quote(doc, whitespace_q)
    assert res_ws.verified is True
    assert res_ws.citation.quote == exact_q

    # 3. Disambiguation with preferred ranges
    liability_q = "The aggregate liability of either party shall not exceed $100,000."
    res_liab = verify_quote(doc, liability_q, prefer_ranges=[OffsetRange(start=180, end=300)])
    assert res_liab.verified is True
    assert res_liab.citation.page_start == 2
    assert "$100,000" in res_liab.citation.quote


def test_verify_quote_rejects_hallucinations_and_too_short():
    full_text = "This agreement is entered into on October 1, 2026 between Client and Vendor."
    doc = SourceDocument(id="doc-1", name="Contract.pdf", full_text=full_text, pages=[SourcePage(1, 0, full_text)])

    # Too short (< 12 chars)
    short_res = verify_quote(doc, "agreement")
    assert short_res.verified is False
    assert short_res.reason == "too_short"

    # Hallucinated quote not in text
    fake_res = verify_quote(doc, "The liability cap is strictly $5,000,000 under all circumstances.")
    assert fake_res.verified is False
    assert fake_res.reason == "not_found"


# ---------------------------------------------------------------------------
# 2. Document Comparison & Visual Diff Tests
# ---------------------------------------------------------------------------

def test_diff_words_lcs_accuracy():
    left = "The customer shall pay within thirty (30) days."
    right = "The customer shall pay within sixty (60) days."
    left_tokens, right_tokens, has_diff = diff_words(left, right)

    assert has_diff is True
    del_text = " ".join(t.text for t in left_tokens if t.op == "deleted")
    ins_text = " ".join(t.text for t in right_tokens if t.op == "inserted")
    assert "thirty (30)" in del_text
    assert "sixty (60)" in ins_text


def test_compare_contracts_identifies_monetary_and_liability_changes():
    v1_text = (
        "Section 1. Fees.\n"
        "Customer shall pay $1,000,000 upon completion.\n\n"
        "Section 2. Limitation of Liability.\n"
        "The aggregate liability of Vendor is capped at $1,000,000.\n\n"
        "Section 3. Termination.\n"
        "Either party may terminate upon thirty (30) days notice.\n"
    )
    v2_text = (
        "Section 1. Fees.\n"
        "Customer shall pay $5,000,000 upon completion.\n\n"
        "Section 2. Limitation of Liability.\n"
        "The aggregate liability of either party is capped at $5,000,000.\n\n"
        "Section 3. Termination.\n"
        "Either party may terminate upon sixty (60) days notice.\n\n"
        "Section 4. Confidentiality.\n"
        "Parties agree to keep proprietary data confidential.\n"
    )
    doc1 = SourceDocument("v1", "Contract_V1.pdf", v1_text)
    doc2 = SourceDocument("v2", "Contract_V2.pdf", v2_text)

    report = compare_contracts(doc1, doc2)
    assert report["summary"]["totalSections"] == 4
    assert report["summary"]["modifiedCount"] >= 3
    assert report["summary"]["addedCount"] == 1
    assert report["summary"]["highSignificanceCount"] >= 2

    # Check UI changes format
    changes = report["changes"]
    assert len(changes) == 4
    assert any(c["significance"] == "substantive" and "Monetary change" in c["summary"] for c in changes)
    assert any(c["change_type"] == "inserted" and "Confidentiality" in c["summary"] for c in changes)

    from app.routers.compare import generate_comparative_fallback
    fallback = generate_comparative_fallback("What changed in the liability and fees?", report, doc1, doc2)
    assert "Contract Comparison Analysis" in fallback["answer"]
    assert len(fallback["citations"]) > 0
    for cit in fallback["citations"]:
        assert cit["documentId"] in {doc1.id, doc2.id}
        assert cit["quote"]


# ---------------------------------------------------------------------------
# 3. Tracked-Change Redlining Tests
# ---------------------------------------------------------------------------

def test_docx_tracked_changes_package_generation():
    contract_text = (
        "CONSULTING AGREEMENT\n\n"
        "Section 4. Term and Termination.\n"
        "Either party may terminate this agreement upon thirty-day (30-day) written notice.\n"
    )
    edits = [
        DocxEdit(
            target_text="thirty-day (30-day)",
            revised_text="sixty-day (60-day)",
            author="ContractAI",
        )
    ]
    docx_bytes = create_docx_with_tracked_changes(contract_text, edits, author="ContractAI")
    assert len(docx_bytes) > 100

    # Verify OpenXML archive contents
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as z:
        assert "[Content_Types].xml" in z.namelist()
        assert "word/document.xml" in z.namelist()
        xml = z.read("word/document.xml").decode("utf-8")
        assert "<w:del" in xml
        assert "<w:ins" in xml
        assert "thirty-day (30-day)" in xml
        assert "sixty-day (60-day)" in xml
        assert 'w:author="ContractAI"' in xml


def test_deterministic_redline_rule_engine():
    contract_text = (
        "Section 4.A - Term and Termination\n"
        "Either party may terminate by giving CONSULTANT thirty-day (30-day) written notice thereof.\n"
    )
    doc = SourceDocument("doc-1", "Contract.docx", contract_text)

    # 1. Termination notice rule
    proposal = deterministic_redline(doc, "increase notice period to 60 days")
    assert proposal.target_text == "thirty-day (30-day)"
    assert proposal.revised_text == "sixty-day (60-day)"
    assert "thirty-day (30-day)" in proposal.context_sentence


# ---------------------------------------------------------------------------
# 4. Legal Synthesis & Finalize Answer Tests
# ---------------------------------------------------------------------------

def test_legal_synthesis_engine_produces_verified_citations():
    full_text = (
        "MASTER SERVICES AGREEMENT\n\n"
        "Section 1. Scope.\n"
        "Vendor will provide software engineering services for the duration of the engagement.\n\n"
        "Section 2. Fees.\n"
        "Customer shall pay invoices within thirty (30) days of receipt.\n\n"
        "Section 3. Limitation of Liability.\n"
        "The aggregate liability of either party arising out of or related to this Agreement shall not exceed $1,000,000.\n\n"
        "Section 4. Governing Law.\n"
        "This Agreement shall be governed by the laws of the State of Delaware, without regard to conflicts of law.\n"
    )
    pages = [SourcePage(1, 0, full_text)]
    doc = SourceDocument("doc-1", "MSA.pdf", full_text, pages)

    # Executive summary query
    synth = synthesize_legal_answer("Provide an executive summary of this contract", [doc])
    assert "### Executive Summary" in synth["answer"]
    assert len(synth["citations"]) > 0

    # Every citation returned by the synthesis engine must verify 100% against the document text!
    for cit in synth["citations"]:
        v = verify_quote(doc, cit["quote"])
        assert v.verified is True, f"Citation failed verification: {cit['quote']}"

    # Specific liability query
    liab_synth = synthesize_legal_answer("What is the liability cap?", [doc])
    assert "### Liability & Risk Allocation" in liab_synth["answer"]
    assert "$1,000,000" in liab_synth["answer"]
    for cit in liab_synth["citations"]:
        assert verify_quote(doc, cit["quote"]).verified is True


def test_finalize_answer_drops_unverified_and_records_verified():
    full_text = "The vendor guarantees 99.9% uptime per calendar quarter."
    doc = SourceDocument("doc-1", "SLA.pdf", full_text, [SourcePage(1, 0, full_text)])

    parsed = ModelAnswer(
        answer="The SLA uptime commitment is 99.9%.",
        insufficient_evidence=False,
        citations=[
            {"documentId": "doc-1", "quote": "The vendor guarantees 99.9% uptime per calendar quarter."},
            {"documentId": "doc-1", "quote": "This quote is completely fabricated by an LLM."},
        ],
    )
    res = finalize_answer(parsed, [doc], [])
    assert len(res.citations) == 1
    assert res.citations[0].quote == "The vendor guarantees 99.9% uptime per calendar quarter."
    assert res.rejected_citation_count == 1
    assert res.unverified is False


# ---------------------------------------------------------------------------
# 5. Agent Tools Execution Tests
# ---------------------------------------------------------------------------

def test_agent_tools_execution():
    full_text = (
        "Section 1. Purpose.\n"
        "The purpose is software development.\n\n"
        "Section 8.2. Indemnification.\n"
        "Each party shall defend and indemnify the other against third party claims.\n"
    )
    doc = SourceDocument("doc-1", "Agreement.pdf", full_text, [SourcePage(1, 0, full_text)])

    # 1. list_clauses
    res_list = execute_tool("list_clauses", {}, [doc])
    assert res_list.ok is True
    assert len(res_list.data["clauses"]) >= 2

    # 2. get_section
    res_sec = execute_tool("get_section", {"number": "8.2"}, [doc])
    assert res_sec.ok is True
    assert "Indemnification" in res_sec.data["sections"][0]["text"]

    # 3. search_document
    res_search = execute_tool("search_document", {"query": "indemnify"}, [doc])
    assert res_search.ok is True
    assert len(res_search.data["results"]) >= 1
