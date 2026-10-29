"""Attach real PDF highlights where quoted source characters can be located."""
import sys, json, re, io
import pdfplumber
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Highlight
from pypdf.generic import ArrayObject, FloatObject, NameObject, TextStringObject

payload = json.load(sys.stdin)
writer = PdfWriter()
writer.clone_document_from_reader(PdfReader(payload['filename']))
with pdfplumber.open(payload['filename']) as pdf:
    for note in payload.get('annotations', [])[:40]:
        quote = re.sub(r'\s+', '', str(note.get('quote', '')))
        if len(quote) < 3: continue
        for page_index, page in enumerate(pdf.pages):
            # extract_text_lines preserves the reading order while retaining coordinates.
            chars = [c for line in page.extract_text_lines(return_chars=True) for c in line['chars'] if c['text'].strip()]
            stream = ''.join(c['text'] for c in chars)
            start = stream.find(quote)
            if start < 0: continue
            # Map string offsets back to characters, including multi-character glyphs.
            offsets, offset = [], 0
            for c in chars:
                if offset < start + len(quote) and offset + len(c['text']) > start: offsets.append(c)
                offset += len(c['text'])
            rows = []
            for c in offsets:
                row = next((r for r in rows if abs(r[0]['top']-c['top']) < 3), None)
                if row is None: rows.append([c])
                else: row.append(c)
            for row in rows:
                left, right = min(c['x0'] for c in row), max(c['x1'] for c in row)
                top, bottom = page.height-min(c['top'] for c in row), page.height-max(c['bottom'] for c in row)
                annotation = Highlight(rect=(left,bottom,right,top), quad_points=ArrayObject([FloatObject(v) for v in [left,top,right,top,left,bottom,right,bottom]]), highlight_color='ffe08a', printing=True)
                annotation[NameObject('/Contents')] = TextStringObject(str(note.get('issue','')) + '\n建议：' + str(note.get('suggestion','')) + '\n原因：' + str(note.get('reason','')))
                annotation[NameObject('/T')] = TextStringObject('Resume Protocol')
                writer.add_annotation(page_number=page_index, annotation=annotation)
            break
result = io.BytesIO()
writer.write(result)
sys.stdout.buffer.write(result.getvalue())
