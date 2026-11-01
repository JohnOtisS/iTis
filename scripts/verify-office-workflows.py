"""Check synthetic Office workflow fixtures, including preservation on edit."""
import sys,json,re
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from docx import Document
root=Path(sys.argv[1])
original=next(root.glob("01-word-create-*.docx"))
edited=next(root.glob("02-word-edit-*.docx"))
def word_text(path):
    document=Document(path)
    return "\n".join([p.text for p in document.paragraphs]+[cell.text for table in document.tables for row in table.rows for cell in row.cells])
assert "Backend Developer" in word_text(original)
assert "Full-stack Developer" in word_text(edited)
assert "Backend Developer" not in word_text(edited)
assert "SOURCE-742" in word_text(original) and "SOURCE-742" in word_text(edited)
with ZipFile(original) as before,ZipFile(edited) as after:
    assert set(before.namelist())==set(after.namelist())
    for name in before.namelist():
        if name!="word/document.xml":assert before.read(name)==after.read(name),name
book=next(root.glob("03-excel-analyze-edit-*.xlsx"))
with ZipFile(book) as archive:
    assert archive.testzip() is None
    ns={"x":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    formulas=[];values=[]
    for name in archive.namelist():
        if re.fullmatch(r"xl/worksheets/sheet\d+\.xml",name):
            cells=ET.fromstring(archive.read(name)).findall(".//x:c",ns)
            formulas.extend(c.findtext("x:f",namespaces=ns) for c in cells if c.find("x:f",ns) is not None)
            values.extend(c.findtext("x:v",namespaces=ns) for c in cells)
    assert formulas,"Spreadsheet formulas were lost"
    assert any(v and re.fullmatch(r"\d+(?:\.\d+)?",v) and float(v)==957000 for v in values),"Missing cached 957000 total"
deck=next(root.glob("04-powerpoint-create-*.pptx"))
with ZipFile(deck) as archive:
    assert archive.testzip() is None
    slides=[name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml",name)]
    assert len(slides)==3,slides
    text=" ".join(" ".join(ET.fromstring(archive.read(name)).itertext()) for name in slides)
    assert "QA-DECK-742" in text
result={"wordCreate":True,"wordEdit":True,"unchangedWordParts":True,"excelFormulas":True,"excelTotal":957000,"powerPointSlides":3,"scope":"Content and package checks; not full visual rendering."}
(root/"verification.json").write_text(json.dumps(result,indent=2),encoding="utf8")
print("PASS:",json.dumps(result))
