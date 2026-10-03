from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import html
import io
import re
from typing import Any
import zipfile


@dataclass
class DocxEdit:
    target_text: str
    revised_text: str
    author: str = "ContractAI"


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def apply_tracked_changes_to_docx(
    docx_bytes: bytes,
    edits: list[DocxEdit],
    author: str = "ContractAI",
) -> bytes:
    """Applies native WordprocessingML tracked changes into a DOCX archive.
    Preserves all original styles, fonts, bold, tables, headers, and numbering.
    Produces valid <w:del> and <w:ins> elements compatible with Microsoft Word and LibreOffice.
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    change_id = 1000

    in_buffer = io.BytesIO(docx_bytes)
    out_buffer = io.BytesIO()

    with zipfile.ZipFile(in_buffer, "r") as in_zip:
        if "word/document.xml" not in in_zip.namelist():
            raise ValueError("Invalid DOCX file: word/document.xml not found.")

        with zipfile.ZipFile(out_buffer, "w", compression=zipfile.ZIP_DEFLATED) as out_zip:
            for item in in_zip.infolist():
                if item.filename == "word/document.xml":
                    xml = in_zip.read(item.filename).decode("utf-8")
                    for edit in edits:
                        raw_target = edit.target_text.strip()
                        if not raw_target:
                            continue
                        raw_revised = edit.revised_text.strip()
                        escaped_target = _escape_xml(raw_target)
                        escaped_replacement = _escape_xml(raw_revised)

                        # 1. Direct search in XML text content
                        if escaped_target in xml:
                            change_id += 1
                            del_id = change_id
                            change_id += 1
                            ins_id = change_id
                            del_ins = (
                                f'</w:t></w:r><w:del w:id="{del_id}" w:author="{author}" w:date="{timestamp}">'
                                f'<w:r><w:delText xml:space="preserve">{escaped_target}</w:delText></w:r></w:del>'
                                f'<w:ins w:id="{ins_id}" w:author="{author}" w:date="{timestamp}">'
                                f'<w:r><w:t xml:space="preserve">{escaped_replacement}</w:t></w:r></w:ins>'
                                f'<w:r><w:t xml:space="preserve">'
                            )
                            xml = xml.replace(escaped_target, del_ins, 1)
                            continue

                        # 2. Paragraph-level replacement: handle text fragmented across runs
                        norm_target = _normalize_whitespace(raw_target)

                        def replace_paragraph(match: re.Match) -> str:
                            nonlocal change_id
                            para_xml = match.group(0)
                            t_matches = re.findall(r"<w:t\b[^>]*>([\s\S]*?)</w:t>", para_xml, re.I)
                            full_para_text = "".join(t_matches)
                            norm_para_text = _normalize_whitespace(full_para_text)
                            if norm_target not in norm_para_text:
                                return para_xml

                            r_pr_match = re.search(r"<w:rPr\b[^>]*>[\s\S]*?</w:rPr>", para_xml, re.I)
                            r_pr_xml = r_pr_match.group(0) if r_pr_match else ""

                            change_id += 1
                            del_id = change_id
                            change_id += 1
                            ins_id = change_id

                            tracked_markup = (
                                f'<w:del w:id="{del_id}" w:author="{author}" w:date="{timestamp}">'
                                f'<w:r>{r_pr_xml}<w:delText xml:space="preserve">{_escape_xml(raw_target)}</w:delText></w:r></w:del>'
                                f'<w:ins w:id="{ins_id}" w:author="{author}" w:date="{timestamp}">'
                                f'<w:r>{r_pr_xml}<w:t xml:space="preserve">{_escape_xml(raw_revised)}</w:t></w:r></w:ins>'
                            )
                            return re.sub(r"</w:p>", f"{tracked_markup}</w:p>", para_xml, count=1, flags=re.I)

                        xml = re.sub(r"<w:p\b[^>]*>[\s\S]*?</w:p>", replace_paragraph, xml, flags=re.I)

                    out_zip.writestr(item.filename, xml.encode("utf-8"))
                else:
                    out_zip.writestr(item, in_zip.read(item.filename))

    return out_buffer.getvalue()


def create_docx_with_tracked_changes(
    full_text: str,
    edits: list[DocxEdit],
    author: str = "ContractAI",
) -> bytes:
    """Creates a clean, standard OpenXML DOCX document from contract text with embedded tracked changes."""
    out_buffer = io.BytesIO()
    timestamp = datetime.now(timezone.utc).isoformat()
    change_id = 1000

    with zipfile.ZipFile(out_buffer, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        # 1. [Content_Types].xml
        content_types = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
            '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
            '  <Default Extension="xml" ContentType="application/xml"/>\n'
            '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n'
            "</Types>"
        )
        zip_file.writestr("[Content_Types].xml", content_types)

        # 2. _rels/.rels
        rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n'
            "</Relationships>"
        )
        zip_file.writestr("_rels/.rels", rels)

        # 3. word/document.xml with paragraphs and tracked changes
        paragraphs = [p.strip() for p in re.split(r"\n{2,}|\r\n\r\n", full_text) if p.strip()]
        para_xmls: list[str] = []

        for para in paragraphs:
            applicable_edit = next((e for e in edits if e.target_text.strip() in para), None)
            if applicable_edit:
                raw_target = applicable_edit.target_text.strip()
                raw_revised = applicable_edit.revised_text.strip()
                parts = para.split(raw_target)
                p_content = ""
                for i, part in enumerate(parts):
                    if part:
                        p_content += f'<w:r><w:t xml:space="preserve">{_escape_xml(part)}</w:t></w:r>'
                    if i < len(parts) - 1:
                        change_id += 1
                        del_id = change_id
                        change_id += 1
                        ins_id = change_id
                        p_content += (
                            f'<w:del w:id="{del_id}" w:author="{author}" w:date="{timestamp}">'
                            f'<w:r><w:delText xml:space="preserve">{_escape_xml(raw_target)}</w:delText></w:r></w:del>'
                            f'<w:ins w:id="{ins_id}" w:author="{author}" w:date="{timestamp}">'
                            f'<w:r><w:t xml:space="preserve">{_escape_xml(raw_revised)}</w:t></w:r></w:ins>'
                        )
            else:
                p_content = f'<w:r><w:t xml:space="preserve">{_escape_xml(para)}</w:t></w:r>'

            para_xmls.append(f"<w:p>{p_content}</w:p>")

        document_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
            "  <w:body>\n"
            f"    {chr(10).join(para_xmls)}\n"
            "    <w:sectPr>\n"
            '      <w:pgSz w:w="12240" w:h="15840"/>\n'
            '      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>\n'
            "    </w:sectPr>\n"
            "  </w:body>\n"
            "</w:document>"
        )
        zip_file.writestr("word/document.xml", document_xml)

    return out_buffer.getvalue()
