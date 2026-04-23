import asyncio
import base64
import logging
import re
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
import httpx

from app.routers.pages import job_results, jobs, job_cookies, _convert_confluence_images
from app.services.crawler import flatten_pages
from app.services.pdf_generator import (
    generate_pdf_from_page,
    generate_combined_pdf,
    generate_pdf_zip,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/export", tags=["export"])


async def _embed_images_as_base64(html: str, job_id: str) -> str:
    """Download all images and embed them as base64 data URIs for offline rendering."""
    if job_id not in job_cookies:
        return html

    base_url, cookies = job_cookies[job_id]

    # Find all img src attributes
    img_pattern = re.compile(r'''(src=["'])([^"']+)(["'])''')
    matches = list(img_pattern.finditer(html))
    if not matches:
        return html

    # Collect unique URLs to download
    urls_to_fetch = {}
    for m in matches:
        url = m.group(2)
        if url.startswith("data:") or url in urls_to_fetch:
            continue
        urls_to_fetch[url] = None

    # Download images concurrently
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        for cookie in cookies:
            client.cookies.set(
                cookie["name"],
                cookie["value"],
                domain=cookie.get("domain", ""),
                path=cookie.get("path", "/"),
            )

        async def fetch_image(url: str) -> tuple[str, str | None]:
            try:
                if url.startswith("/"):
                    full_url = base_url.rstrip("/") + url
                elif not url.startswith("http"):
                    full_url = base_url.rstrip("/") + "/" + url
                else:
                    full_url = url
                resp = await client.get(full_url)
                resp.raise_for_status()
                content_type = resp.headers.get("content-type", "image/png")
                b64 = base64.b64encode(resp.content).decode("ascii")
                return url, f"data:{content_type};base64,{b64}"
            except Exception as e:
                logger.warning(f"Failed to download image for PDF: {url}: {e}")
                return url, None

        results = await asyncio.gather(*[fetch_image(u) for u in urls_to_fetch])

    # Build replacement map
    for original_url, data_uri in results:
        if data_uri:
            urls_to_fetch[original_url] = data_uri

    # Replace URLs in HTML
    def replace_with_base64(match: re.Match) -> str:
        prefix = match.group(1)
        url = match.group(2)
        suffix = match.group(3)
        data_uri = urls_to_fetch.get(url)
        if data_uri:
            return f"{prefix}{data_uri}{suffix}"
        return match.group(0)

    return img_pattern.sub(replace_with_base64, html)


async def _prepare_html_for_pdf(html: str, job_id: str, page_id: str) -> str:
    """Convert Confluence macros to img tags, then embed images as base64."""
    html = _convert_confluence_images(html, job_id, page_id)
    html = await _embed_images_as_base64(html, job_id)
    return html


@router.get("/jobs/{job_id}/pdf")
async def export_job_pdf(job_id: str, mode: str = "combined"):
    """
    Export all translated pages as PDF.
    mode: "combined" (single PDF) or "zip" (individual PDFs in ZIP)
    """
    if job_id not in job_results:
        raise HTTPException(status_code=404, detail="Job results not found")

    page_tree = job_results[job_id]
    all_pages = flatten_pages(page_tree)

    pages_data = []
    breadcrumb_map = _build_breadcrumbs(page_tree)
    for page in all_pages:
        body = page.translated_html or page.body_html
        body = await _prepare_html_for_pdf(body, job_id, page.page_id)
        pages_data.append({
            "title": page.title,
            "body_html": body,
            "breadcrumbs": breadcrumb_map.get(page.page_id, []),
        })

    if mode == "zip":
        content = await asyncio.to_thread(generate_pdf_zip, pages_data)
        return Response(
            content=content,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename=confluence_translated_{job_id[:8]}.zip"},
        )
    else:
        content = await asyncio.to_thread(generate_combined_pdf, pages_data)
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=confluence_translated_{job_id[:8]}.pdf"},
        )


@router.get("/pages/{job_id}/{page_id}/pdf")
async def export_page_pdf(job_id: str, page_id: str):
    """Export a single translated page as PDF."""
    if job_id not in job_results:
        raise HTTPException(status_code=404, detail="Job results not found")

    page_tree = job_results[job_id]
    page = _find_page(page_tree, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    breadcrumbs = _build_breadcrumbs(page_tree).get(page_id, [])
    body = page.translated_html or page.body_html
    body = await _prepare_html_for_pdf(body, job_id, page_id)
    content = await asyncio.to_thread(
        generate_pdf_from_page,
        page.title,
        body,
        breadcrumbs,
    )

    safe_title = "".join(c for c in page.title if c.isalnum() or c in " -_").strip()[:50]
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={safe_title or 'page'}.pdf"},
    )


def _find_page(tree, page_id):
    from app.models.page import PageData
    if tree.page_id == page_id:
        return tree
    for child in tree.children:
        found = _find_page(child, page_id)
        if found:
            return found
    return None


def _build_breadcrumbs(tree, path=None) -> dict[str, list[str]]:
    """Build a mapping of page_id → breadcrumb trail."""
    if path is None:
        path = []
    result = {}
    current_path = path + [tree.title]
    result[tree.page_id] = current_path
    for child in tree.children:
        result.update(_build_breadcrumbs(child, current_path))
    return result
