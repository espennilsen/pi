#!/usr/bin/env python3
"""
PDF content extraction using pdfplumber, with OCR fallback via Tesseract.

Usage:
    python3 extract.py <mode> <pdf-path> [options]

Modes:
    text        Extract text (all pages or range)
    tables      Extract tables as formatted text
    metadata    Show PDF metadata
    scan        Quick summary: pages, tables, metadata, OCR detection
    ocr         Force OCR on all pages (for scanned/image-based PDFs)

Options:
    --pages 1-5     Page range (1-indexed)
    --csv           Output tables as CSV
    --json          Output as JSON
    --dpi 300       OCR resolution (default: 300)
    --lang eng      Tesseract language (default: eng)

Examples:
    python3 extract.py text document.pdf
    python3 extract.py text document.pdf --pages 1-10
    python3 extract.py tables document.pdf
    python3 extract.py tables document.pdf --csv
    python3 extract.py ocr scanned.pdf
    python3 extract.py ocr scanned.pdf --pages 1-5 --dpi 400 --lang eng+nor
    python3 extract.py scan document.pdf
"""

import sys
import json

try:
    import pdfplumber
except ImportError:
    print("Error: pdfplumber not installed. Run: pip install pdfplumber", file=sys.stderr)
    sys.exit(1)

HAS_OCR = False
try:
    import pytesseract
    from pdf2image import convert_from_path
    HAS_OCR = True
except ImportError:
    pass


def parse_page_range(range_str, total_pages):
    """Parse '3-5' or '3' into (start, end) 0-indexed."""
    if '-' in range_str:
        start, end = range_str.split('-', 1)
        start, end = int(start) - 1, min(int(end), total_pages)
    else:
        p = int(range_str) - 1
        start, end = p, p + 1
    if start < 0:
        raise ValueError(f"Invalid page number: pages are 1-indexed (got {start + 1})")
    if end <= start:
        raise ValueError(f"Invalid page range: start ({start + 1}) must be less than end ({end})")
    return start, end


def extract_text(pdf_path, page_range=None):
    """Extract text from all or specified pages."""
    pdf = pdfplumber.open(pdf_path)
    total = len(pdf.pages)

    if page_range:
        start, end = parse_page_range(page_range, total)
    else:
        start, end = 0, total

    for i in range(start, end):
        page = pdf.pages[i]
        text = page.extract_text()
        if text:
            print(f"\n--- Page {i + 1} of {total} ---\n")
            print(text)

    pdf.close()


def extract_tables(pdf_path, page_range=None, as_csv=False, as_json=False):
    """Extract tables from all or specified pages."""
    pdf = pdfplumber.open(pdf_path)
    total = len(pdf.pages)

    if page_range:
        start, end = parse_page_range(page_range, total)
    else:
        start, end = 0, total

    all_tables = []
    found_any = False

    for i in range(start, end):
        page = pdf.pages[i]
        tables = page.extract_tables()
        if tables:
            found_any = True
        for t_idx, table in enumerate(tables):
            if as_json:
                # Use first row as headers
                if len(table) > 1:
                    headers = [str(h or f"col_{j}") for j, h in enumerate(table[0])]
                    rows = [dict(zip(headers, [str(cell or "") for cell in row])) for row in table[1:]]
                    all_tables.append({"page": i + 1, "table": t_idx + 1, "data": rows})
                else:
                    all_tables.append({"page": i + 1, "table": t_idx + 1, "data": table})
            elif as_csv:
                print(f"# Page {i + 1}, Table {t_idx + 1}")
                for row in table:
                    print(",".join(f'"{str(cell or "")}"' for cell in row))
                print()
            else:
                print(f"\n--- Page {i + 1}, Table {t_idx + 1} ---\n")
                if not table:
                    continue
                # Calculate column widths
                widths = [0] * len(table[0])
                for row in table:
                    for j, cell in enumerate(row):
                        if j < len(widths):
                            widths[j] = max(widths[j], len(str(cell or "")))

                for r_idx, row in enumerate(table):
                    cells = [str(cell or "").ljust(widths[j]) for j, cell in enumerate(row) if j < len(widths)]
                    print(" | ".join(cells))
                    if r_idx == 0:  # separator after header
                        print("-+-".join("-" * w for w in widths))

    if as_json:
        print(json.dumps(all_tables, indent=2))

    if not as_json and not as_csv and not found_any:
        print("No tables found in the specified pages.")

    pdf.close()


def scan_pdf(pdf_path):
    """Quick summary of PDF contents."""
    pdf = pdfplumber.open(pdf_path)
    total = len(pdf.pages)

    print(f"File: {pdf_path}")
    print(f"Pages: {total}")

    if pdf.metadata:
        print("\nMetadata:")
        for key, val in pdf.metadata.items():
            if val:
                print(f"  {key}: {val}")

    # Scan for tables
    table_pages = []
    for i, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        if tables:
            table_pages.append((i + 1, len(tables)))

    if table_pages:
        print(f"\nTables found on {len(table_pages)} page(s):")
        for page_num, count in table_pages:
            print(f"  Page {page_num}: {count} table(s)")
    else:
        print("\nNo tables detected.")

    # Detect scanned pages
    scanned = [i + 1 for i, page in enumerate(pdf.pages) if is_scanned_page(page)]
    if scanned:
        if len(scanned) == total:
            print(f"\n⚠ All {total} pages appear scanned (no selectable text).")
        else:
            print(f"\n⚠ {len(scanned)} page(s) appear scanned: {scanned[:20]}"
                  + (" ..." if len(scanned) > 20 else ""))
        if HAS_OCR:
            print("  Use 'ocr' mode to extract text, or 'text' mode (auto-fallback).")
        else:
            print("  Install OCR: pip install pytesseract pdf2image")
    else:
        print("\nAll pages have selectable text (no OCR needed).")

    # Sample text from first page
    first_text = pdf.pages[0].extract_text()
    if first_text:
        preview = first_text[:300].strip()
        print(f"\nFirst page preview:\n  {preview}...")
    elif HAS_OCR:
        print("\nFirst page preview (OCR):")
        images = convert_from_path(pdf_path, dpi=200, first_page=1, last_page=1)
        ocr_text = pytesseract.image_to_string(images[0])
        print(f"  {ocr_text[:300].strip()}...")
    else:
        print("\nNo extractable text on first page (scanned — install OCR packages).")

    pdf.close()


def is_scanned_page(page):
    """Detect if a page is image-based (scanned) with no selectable text."""
    text = page.extract_text()
    if not text or len(text.strip()) < 10:
        return True
    return False


def ocr_pdf(pdf_path, page_range=None, dpi=300, lang='eng'):
    """OCR a PDF using Tesseract. For scanned/image-based PDFs."""
    if not HAS_OCR:
        print("Error: OCR requires pytesseract and pdf2image.", file=sys.stderr)
        print("Install: pip install pytesseract pdf2image", file=sys.stderr)
        sys.exit(1)

    # Get total pages for display
    pdf = pdfplumber.open(pdf_path)
    total = len(pdf.pages)
    pdf.close()

    kwargs = {'dpi': dpi}
    if page_range:
        start, end = parse_page_range(page_range, total)
        kwargs['first_page'] = start + 1  # pdf2image is 1-indexed
        kwargs['last_page'] = end
    else:
        start, end = 0, total

    print(f"OCR: converting pages {start + 1}-{end} at {dpi} DPI (lang={lang})...",
          file=sys.stderr)

    images = convert_from_path(pdf_path, **kwargs)

    for i, img in enumerate(images):
        page_num = start + i + 1
        text = pytesseract.image_to_string(img, lang=lang)
        if text.strip():
            print(f"\n--- Page {page_num} of {total} (OCR) ---\n")
            print(text)


def text_with_ocr_fallback(pdf_path, page_range=None, dpi=300, lang='eng'):
    """Extract text, falling back to OCR for pages with no selectable text."""
    pdf = pdfplumber.open(pdf_path)
    total = len(pdf.pages)

    if page_range:
        start, end = parse_page_range(page_range, total)
    else:
        start, end = 0, total

    ocr_pages = []  # collect pages that need OCR

    for i in range(start, end):
        page = pdf.pages[i]
        text = page.extract_text()
        if text and len(text.strip()) >= 10:
            print(f"\n--- Page {i + 1} of {total} ---\n")
            print(text)
        else:
            ocr_pages.append(i + 1)  # 1-indexed

    pdf.close()

    # OCR fallback for pages with no text
    if ocr_pages and HAS_OCR:
        print(f"\n⚠ {len(ocr_pages)} page(s) have no selectable text — running OCR...",
              file=sys.stderr)
        for page_num in ocr_pages:
            images = convert_from_path(pdf_path, dpi=dpi,
                                       first_page=page_num, last_page=page_num)
            text = pytesseract.image_to_string(images[0], lang=lang)
            if text.strip():
                print(f"\n--- Page {page_num} of {total} (OCR) ---\n")
                print(text)
            else:
                print(f"\n--- Page {page_num} of {total} (OCR: no text found) ---\n")
    elif ocr_pages and not HAS_OCR:
        print(f"\n⚠ {len(ocr_pages)} page(s) have no selectable text.", file=sys.stderr)
        print("  Install OCR support: pip install pytesseract pdf2image", file=sys.stderr)
        for p in ocr_pages:
            print(f"  - Page {p}")


def extract_metadata(pdf_path):
    """Show PDF metadata."""
    pdf = pdfplumber.open(pdf_path)
    print(f"File: {pdf_path}")
    print(f"Pages: {len(pdf.pages)}")

    if pdf.metadata:
        print("\nMetadata:")
        for key, val in pdf.metadata.items():
            if val:
                print(f"  {key}: {val}")

    # Page dimensions
    p = pdf.pages[0]
    print(f"\nPage 1 size: {p.width} × {p.height} pts")

    pdf.close()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    mode = sys.argv[1]
    pdf_path = sys.argv[2]
    args = sys.argv[3:]

    # Parse options
    page_range = None
    as_csv = '--csv' in args
    as_json = '--json' in args
    dpi = 300
    lang = 'eng'

    for i, arg in enumerate(args):
        if arg == '--pages' and i + 1 < len(args):
            page_range = args[i + 1]
        elif arg == '--dpi' and i + 1 < len(args):
            dpi = int(args[i + 1])
        elif arg == '--lang' and i + 1 < len(args):
            lang = args[i + 1]

    try:
        if mode == 'text':
            text_with_ocr_fallback(pdf_path, page_range, dpi, lang)
        elif mode == 'ocr':
            ocr_pdf(pdf_path, page_range, dpi, lang)
        elif mode == 'tables':
            extract_tables(pdf_path, page_range, as_csv, as_json)
        elif mode == 'metadata':
            extract_metadata(pdf_path)
        elif mode == 'scan':
            scan_pdf(pdf_path)
        else:
            print(f"Unknown mode: {mode}")
            print("Modes: text, ocr, tables, metadata, scan")
            sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
