"""Independent checks on actual downloaded outputs; no visual-layout certification."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP
import sys, json, re, unicodedata
from pypdf import PdfReader
from docx import Document
root=Path(sys.argv[1])
ns={"x":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
book=next(root.glob("02-*.xlsx"))
with ZipFile(book) as archive:
    sheet=ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    cells={c.attrib['r']:c for c in sheet.findall('.//x:c',ns)}
    def value(ref):return Decimal(cells[ref].findtext('x:v',namespaces=ns))
    assert value('B3')==3
    assert value('B4')==-1
    subtotal=sum(value(f'B{i}')*value(f'C{i}') for i in range(2,5))
    vat=(subtotal*Decimal('.08')).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
    total=subtotal+vat
    assert subtotal==Decimal('85.12') and vat==Decimal('6.81') and total==Decimal('91.93')
    for ref,expected in [('D2',Decimal('59.97')),('D3',Decimal('30.15')),('D4',Decimal('-5')),('D6',subtotal),('D7',vat),('D8',total)]:
        assert cells[ref].find('x:f',ns) is not None, f'Formula missing at {ref}'
        assert value(ref)==expected,(ref,value(ref),expected)
source=Path('artifacts/office-performance-2026-11-01T16-10-05-109Z/01-word-create-JD_Backend_Developer_Junior_SOURCE-742.docx')
document=Document(source)
paragraphs=[p.text for p in document.paragraphs]+[c.text for t in document.tables for r in t.rows for c in r.cells]
pdf=PdfReader(next(root.glob('03-*.pdf')))
pdf_text='\n'.join(p.extract_text() or '' for p in pdf.pages)
def normalize(text):return re.sub(r'[^\w]+','',unicodedata.normalize('NFC',text)).casefold()
normalized=normalize(pdf_text)
missing=[p for p in paragraphs if normalize(p) and normalize(p) not in normalized]
assert not missing,missing
assert 'SOURCE-742' in pdf_text
assert len(pdf.pages)==2
report={"spreadsheetIndependentDecimalCheck":True,"cachedFormulaValues":True,"expectedTotal":"91.93","pdfSourceParagraphsRetained":True,"pdfPages":2,"scope":"Text/content/OOXML checks, not visual Office layout inspection"}
(root/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print('PASS:',json.dumps(report,ensure_ascii=False))
