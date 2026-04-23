import asyncio
import io
import logging
import zipfile

logger = logging.getLogger(__name__)

PAGE_CSS = """
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 20px;
    color: #172b4d;
    line-height: 1.6;
    font-size: 14px;
}
h1, h2, h3, h4, h5, h6 { color: #172b4d; margin-top: 1.5em; margin-bottom: 0.5em; }
h1 { font-size: 24px; border-bottom: 1px solid #dfe1e6; padding-bottom: 8px; }
h2 { font-size: 20px; }
h3 { font-size: 16px; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #dfe1e6; padding: 8px 12px; text-align: left; }
th { background-color: #f4f5f7; font-weight: 600; }
pre, code { background-color: #f4f5f7; border-radius: 3px; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; }
pre { padding: 12px; overflow-x: auto; }
code { padding: 2px 4px; }
img { max-width: 100%; height: auto; }
blockquote { border-left: 3px solid #dfe1e6; margin-left: 0; padding-left: 16px; color: #6b778c; }
a { color: #0052cc; text-decoration: none; }
.page-header { margin-bottom: 24px; }
.page-header h1 { margin-top: 0; }
.page-meta { color: #6b778c; font-size: 12px; margin-bottom: 16px; }
@page { margin: 2cm; size: A4; }
"""


def generate_page_html(title: str, body_html: str, breadcrumbs: list[str] | None = None) -> str:
    breadcrumb_html = ""
    if breadcrumbs:
        parts = " &gt; ".join(breadcrumbs)
        breadcrumb_html = f'<div class="page-meta">{parts}</div>'
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>{PAGE_CSS}</style>
</head>
<body>
    <div class="page-header">
        {breadcrumb_html}
        <h1>{title}</h1>
    </div>
    <div class="page-content">
        {body_html}
    </div>
</body>
</html>"""


async def _render_pdf_with_playwright(html_content: str) -> bytes:
    """Use Playwright Chromium to render HTML to PDF."""
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(html_content, wait_until="networkidle")
        pdf_bytes = await page.pdf(
            format="A4",
            margin={"top": "2cm", "bottom": "2cm", "left": "2cm", "right": "2cm"},
            print_background=True,
        )
        await browser.close()
        return pdf_bytes


def generate_pdf(html_content: str) -> bytes:
    """Generate PDF from HTML using Playwright Chromium."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(asyncio.run, _render_pdf_with_playwright(html_content))
            return future.result(timeout=120)
    else:
        return asyncio.run(_render_pdf_with_playwright(html_content))


def generate_pdf_from_page(title: str, body_html: str, breadcrumbs: list[str] | None = None) -> bytes:
    full_html = generate_page_html(title, body_html, breadcrumbs)
    return generate_pdf(full_html)


def generate_combined_pdf(pages: list[dict]) -> bytes:
    sections = []
    for i, page in enumerate(pages):
        breadcrumb_html = ""
        if page.get("breadcrumbs"):
            parts = " &gt; ".join(page["breadcrumbs"])
            breadcrumb_html = f'<div class="page-meta">{parts}</div>'
        page_break = 'style="page-break-before: always;"' if i > 0 else ""
        sections.append(f"""
        <div {page_break}>
            <div class="page-header">
                {breadcrumb_html}
                <h1>{page["title"]}</h1>
            </div>
            <div class="page-content">
                {page["body_html"]}
            </div>
        </div>
        """)
    combined_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Confluence Translation</title>
    <style>{PAGE_CSS}</style>
</head>
<body>
    {"".join(sections)}
</body>
</html>"""
    return generate_pdf(combined_html)


def generate_pdf_zip(pages: list[dict]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, page in enumerate(pages):
            title = page["title"]
            safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip()
            safe_title = safe_title[:80] or f"page_{i}"
            filename = f"{i + 1:03d}_{safe_title}.pdf"
            pdf_bytes = generate_pdf_from_page(title, page["body_html"], page.get("breadcrumbs"))
            zf.writestr(filename, pdf_bytes)
    return buffer.getvalue()
