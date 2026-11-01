"""Structural/content QA of synthetic app-generated fixtures; not visual QA."""
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from pypdf import PdfReader

root = Path(sys.argv[1])
result = []
for path in sorted(root.iterdir()):
    if path.suffix not in (".xlsx", ".docx", ".pdf", ".pptx"):
        continue
    entry = {"file": path.name, "bytes": path.stat().st_size}
    if path.suffix == ".pdf":
        reader = PdfReader(path)
        text = "\n".join(page.extract_text() for page in reader.pages)
        entry.update(pages=len(reader.pages), hasExpectedTotal=bool(re.search(r"693[., ]?000", text)), hasVietnamese="BÁO CÁO" in text.upper())
    else:
        with ZipFile(path) as z:
            entry["zipIntegrity"] = z.testzip() is None
            if path.suffix == ".docx":
                text = " ".join(ET.fromstring(z.read("word/document.xml")).itertext())
                entry["hasExpectedTotal"] = bool(re.search(r"693[., ]?000", text))
            elif path.suffix == ".pptx":
                slides = [n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
                entry["slideCount"] = len(slides)
                text = " ".join(" ".join(ET.fromstring(z.read(n)).itertext()) for n in slides)
                entry["hasExpectedTotal"] = bool(re.search(r"693[., ]?000", text))
            else:
                ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
                cells = []
                for name in z.namelist():
                    if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name):
                        for cell in ET.fromstring(z.read(name)).findall(".//x:c", ns):
                            cells.append({"cell": cell.get("r"), "formula": cell.findtext("x:f", namespaces=ns), "value": cell.findtext("x:v", namespaces=ns)})
                entry["formulas"] = [c for c in cells if c["formula"]]
                expected = "957000" if "cap-nhat" in path.name else "693000"
                entry["hasCachedExpectedTotal"] = any(c["value"] and re.fullmatch(r"-?\d+(?:\.\d+)?", c["value"]) and float(c["value"]) == float(expected) for c in cells)
                entry["note"] = "Formula semantics and displayed cached totals need both checks; XML alone is not a full spreadsheet engine."
    result.append(entry)
(root / "file-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps(result, ensure_ascii=False, indent=2))
