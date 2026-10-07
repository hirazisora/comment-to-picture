from pathlib import Path
from pypdf import PdfWriter

output = Path('test-results')
output.mkdir(exist_ok=True)
writer = PdfWriter()
writer.add_blank_page(width=300, height=200)
writer.encrypt('test-only-password')
writer.write(output / 'encrypted.pdf')
