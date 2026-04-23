import asyncio
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import Response
import httpx

from app.models.job import Job, JobRequest, JobStatus, JobProgress
from app.models.page import PageData
from app.services.auth import SamlAuthenticator
from app.services.confluence import ConfluenceClient
from app.services.crawler import PageTreeCrawler, flatten_pages, count_pages
from app.services.translator import TranslationService
from app.services.cache import TranslationCache
from app.utils.url_parser import parse_confluence_url
from app.utils.confluence_macros import preprocess_confluence_html
from app.config import settings
from app.routers.ws import manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["pages"])

# In-memory job store (replace with Redis for production)
jobs: dict[str, Job] = {}
job_results: dict[str, PageData] = {}
# Store auth cookies per job for image proxying
job_cookies: dict[str, tuple[str, list[dict]]] = {}  # job_id -> (base_url, cookies)
# Cache authenticated sessions per base_url to avoid re-login
_session_cache: dict[str, list[dict]] = {}  # base_url -> cookies


@router.post("/jobs", response_model=JobProgress)
async def create_job(request: JobRequest, background_tasks: BackgroundTasks):
    """Start a new translation job."""
    # Validate the URL
    try:
        parsed = parse_confluence_url(request.confluence_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    job = Job.create(request)
    jobs[job.job_id] = job

    # Run translation in background
    background_tasks.add_task(run_translation_job, job)

    return job.progress


@router.get("/jobs/{job_id}", response_model=JobProgress)
async def get_job(job_id: str):
    """Get the status of a translation job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id].progress


@router.get("/jobs/{job_id}/pages")
async def get_job_pages(job_id: str):
    """Get the translated page tree for a completed job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    if job_id not in job_results:
        raise HTTPException(status_code=404, detail="Results not ready yet")
    return job_results[job_id]


@router.get("/pages/{job_id}/{page_id}")
async def get_translated_page(job_id: str, page_id: str):
    """Get a single translated page's HTML."""
    if job_id not in job_results:
        raise HTTPException(status_code=404, detail="Job not found")

    page = _find_page(job_results[job_id], page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    html = page.translated_html or page.body_html
    # Convert any remaining Confluence macros and proxy images
    base_url = job_cookies[job_id][0] if job_id in job_cookies else ""
    html = preprocess_confluence_html(html, job_id, page.page_id, base_url)
    html = _rewrite_image_urls(html, job_id)

    return {
        "page_id": page.page_id,
        "title": page.title,
        "translated_html": html,
        "url": page.url,
    }


@router.get("/pages/{job_id}/{page_id}/raw")
async def get_raw_page(job_id: str, page_id: str):
    """Debug: return the raw body_html and translated_html for a page."""
    if job_id not in job_results:
        raise HTTPException(status_code=404, detail="Job not found")
    page = _find_page(job_results[job_id], page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return {
        "page_id": page.page_id,
        "title": page.title,
        "body_html": page.body_html,
        "translated_html": page.translated_html,
    }


@router.get("/pages/{job_id}/{page_id}/summary")
async def get_page_summary(job_id: str, page_id: str):
    """Generate an LLM summary of a translated page."""
    if job_id not in job_results:
        raise HTTPException(status_code=404, detail="Job not found")

    page = _find_page(job_results[job_id], page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    html = page.translated_html or page.body_html
    # Extract plain text from HTML for summarization
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(separator="\n", strip=True)

    if not text.strip():
        return {"summary": "This page has no text content."}

    # Truncate to avoid token limits
    if len(text) > 8000:
        text = text[:8000] + "..."

    translator = TranslationService(target_language="en")
    summary = await asyncio.to_thread(_generate_summary, translator, text)
    return {"summary": summary}


def _generate_summary(translator: TranslationService, text: str) -> str:
    """Generate a summary using the LLM."""
    try:
        response = translator._client.chat.completions.create(
            model=translator._model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a technical writer. Summarize the following page content "
                        "in 3-5 concise bullet points. Focus on the key topics, decisions, "
                        "and actionable information. Return only the bullet points, no preamble. "
                        "Use plain text only. Do NOT use markdown formatting: no **, no *, no `, no #. "
                        "Use simple dashes (-) for bullet points."
                    ),
                },
                {"role": "user", "content": text},
            ],
            temperature=0.2,
            max_tokens=512,
        )
        result = response.choices[0].message.content
        if result:
            result = result.strip()
            import re
            result = re.sub(r'\*\*(.+?)\*\*', r'\1', result)
            result = re.sub(r'(?<!\w)`([^`]+)`(?!\w)', r'\1', result)
            result = re.sub(r'^#{1,6}\s+', '', result, flags=re.MULTILINE)
        return result if result else "Could not generate summary."
    except Exception as e:
        logger.error(f"Summary generation failed: {e}")
        return "Failed to generate summary."


def _extract_page_text(job_id: str, page_id: str) -> str:
    """Extract plain text from a page for LLM processing."""
    if job_id not in job_results:
        raise HTTPException(status_code=404, detail="Job not found")
    page = _find_page(job_results[job_id], page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    from bs4 import BeautifulSoup
    html = page.translated_html or page.body_html
    text = BeautifulSoup(html, "html.parser").get_text(separator="\n", strip=True)
    if not text.strip():
        return ""
    return text[:8000] + "..." if len(text) > 8000 else text


def _llm_generate(prompt: str, text: str, max_tokens: int = 1024) -> str:
    """Run an LLM generation with the given system prompt and user text."""
    translator = TranslationService(target_language="en")
    try:
        response = translator._client.chat.completions.create(
            model=translator._model,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": text},
            ],
            temperature=0.2,
            max_tokens=max_tokens,
        )
        result = response.choices[0].message.content
        logger.info(
            f"LLM generate: input={len(text)} chars, output={len(result) if result else 0} chars, "
            f"finish={response.choices[0].finish_reason}"
        )
        if result:
            result = result.strip()
            # Strip markdown formatting the LLM may add despite instructions
            import re
            # Remove <think>...</think> reasoning blocks some models emit
            result = re.sub(r'<think>.*?</think>', '', result, flags=re.DOTALL).strip()
            result = re.sub(r'\*\*(.+?)\*\*', r'\1', result)
            result = re.sub(r'(?<!\w)`([^`]+)`(?!\w)', r'\1', result)
            result = re.sub(r'^#{1,6}\s+', '', result, flags=re.MULTILINE)
        if not result:
            logger.warning(f"LLM generate produced empty output for text of {len(text)} chars")
            return "Could not generate content."
        return result
    except Exception as e:
        logger.error(f"LLM generation failed: {e}")
        return f"Failed to generate content: {e}"


@router.get("/pages/{job_id}/{page_id}/notes")
async def get_page_notes(job_id: str, page_id: str):
    """Generate important notes from a translated page."""
    text = _extract_page_text(job_id, page_id)
    if not text:
        return {"notes": "This page has no text content."}

    prompt = (
        "You are a technical analyst. Extract the most important notes from the following page content. "
        "Focus on: key decisions, important configurations, critical warnings, dependencies, "
        "and actionable takeaways. Format as a numbered list of concise notes. "
        "Return only the notes, no preamble or commentary. "
        "Use plain text only. Do NOT use markdown formatting: no **, no *, no `, no #. "
        "Write emphasis in plain words, not with formatting markers."
    )
    notes = await asyncio.to_thread(_llm_generate, prompt, text)
    return {"notes": notes}


@router.get("/images/{job_id}")
async def proxy_image(job_id: str, url: str):
    """Proxy Confluence images with authentication."""
    if job_id not in job_cookies:
        raise HTTPException(status_code=404, detail="Job not found or expired")

    base_url, cookies = job_cookies[job_id]

    # Resolve relative URLs
    if url.startswith("/"):
        full_url = base_url.rstrip("/") + url
    elif not url.startswith("http"):
        full_url = base_url.rstrip("/") + "/" + url
    else:
        full_url = url

    # Only allow proxying from the same Confluence host
    parsed_base = urlparse(base_url)
    parsed_url = urlparse(full_url)
    if parsed_url.hostname != parsed_base.hostname:
        raise HTTPException(status_code=403, detail="Cross-origin image request blocked")

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for cookie in cookies:
                client.cookies.set(
                    cookie["name"],
                    cookie["value"],
                    domain=cookie.get("domain", ""),
                    path=cookie.get("path", "/"),
                )
            resp = await client.get(full_url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/png")
            return Response(content=resp.content, media_type=content_type)
    except Exception as e:
        logger.error(f"Image proxy failed for {full_url}: {e}")
        raise HTTPException(status_code=502, detail="Failed to fetch image")


@router.post("/pages/{job_id}/analyze-image")
async def analyze_image(job_id: str, payload: dict):
    """Analyze an image using the configured vision LLM and return a description.

    Body:
      - url: image URL (required)
      - question: optional single question (used when history is empty)
      - history: optional list of {role: 'user'|'assistant', content: str} turns
                 representing prior conversation about the same image
    """
    url = payload.get("url", "")
    history = payload.get("history") or []
    question = payload.get("question") or (
        "Describe this image in detail. If it is a diagram, explain its structure, "
        "components, and relationships. If it contains text, transcribe the key text. "
        "Be concise and use plain text (no markdown)."
    )
    if not url:
        raise HTTPException(status_code=400, detail="Missing 'url' in body")
    if job_id not in job_cookies:
        raise HTTPException(status_code=404, detail="Job not found or expired")

    base_url, cookies = job_cookies[job_id]

    # Resolve relative/proxy URLs
    if url.startswith("/api/images/"):
        # Extract the original url query param
        from urllib.parse import parse_qs, urlparse as _up
        q = parse_qs(_up(url).query)
        url = q.get("url", [""])[0]
    if url.startswith("/"):
        full_url = base_url.rstrip("/") + url
    elif not url.startswith("http"):
        full_url = base_url.rstrip("/") + "/" + url
    else:
        full_url = url

    parsed_base = urlparse(base_url)
    parsed_url = urlparse(full_url)
    if parsed_url.hostname and parsed_base.hostname and parsed_url.hostname != parsed_base.hostname:
        raise HTTPException(status_code=403, detail="Cross-origin image request blocked")

    # Fetch image with auth
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for cookie in cookies:
                client.cookies.set(
                    cookie["name"],
                    cookie["value"],
                    domain=cookie.get("domain", ""),
                    path=cookie.get("path", "/"),
                )
            resp = await client.get(full_url)
            resp.raise_for_status()
            image_bytes = resp.content
            content_type = resp.headers.get("content-type", "image/png").split(";")[0].strip()
    except Exception as e:
        logger.error(f"analyze-image: failed to fetch {full_url}: {e}")
        raise HTTPException(status_code=502, detail="Failed to fetch image")

    # Build messages: image is attached only to the first user turn so the model
    # can refer back to it across follow-ups without re-uploading every turn.
    try:
        import base64
        b64 = base64.b64encode(image_bytes).decode("ascii")
        data_url = f"data:{content_type};base64,{b64}"
        vision_model = settings.llm_vision_model or settings.llm_model

        messages: list[dict] = [
            {
                "role": "system",
                "content": (
                    "You are a helpful assistant analyzing an image the user shared. "
                    "Answer questions about it directly. Use plain text only — no markdown formatting."
                ),
            }
        ]

        if history:
            # Sanitize and use provided history. Attach the image to the FIRST user turn.
            first_user_seen = False
            for turn in history:
                role = turn.get("role")
                content = turn.get("content", "")
                if role not in ("user", "assistant") or not isinstance(content, str):
                    continue
                if role == "user" and not first_user_seen:
                    messages.append({
                        "role": "user",
                        "content": [
                            {"type": "text", "text": content},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    })
                    first_user_seen = True
                else:
                    messages.append({"role": role, "content": content})
            if not first_user_seen:
                # No user turn in history — fall back to single question
                messages.append({
                    "role": "user",
                    "content": [
                        {"type": "text", "text": question},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                })
        else:
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": question},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            })

        translator = TranslationService(target_language="en")
        response = await asyncio.to_thread(
            lambda: translator._client.chat.completions.create(
                model=vision_model,
                messages=messages,
                temperature=0.2,
                max_tokens=800,
            )
        )
        content = (response.choices[0].message.content or "").strip()
        # Strip <think>...</think> blocks if model emits them
        content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL).strip()
        if not content:
            content = "The vision model returned no description."
        return {"analysis": content, "model": vision_model}
    except Exception as e:
        logger.error(f"Vision analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Vision analysis failed: {e}")


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a running job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    jobs[job_id].progress.status = JobStatus.CANCELLED
    return {"message": "Job cancelled"}


async def run_translation_job(job: Job):
    """Background task that runs the full scrape → translate pipeline."""
    progress = job.progress
    request = job.request

    try:
        # Step 1: Authenticate
        progress.status = JobStatus.AUTHENTICATING
        await manager.broadcast(job.job_id, progress.model_dump())

        parsed = parse_confluence_url(request.confluence_url)
        base_url = parsed["base_url"]

        # Reuse cached session if available, otherwise authenticate
        cookies = None
        if base_url in _session_cache:
            cached_cookies = _session_cache[base_url]
            # Quick validation: try a REST call with cached cookies
            try:
                test_client = ConfluenceClient(base_url, cached_cookies)
                await test_client.get_page("0")  # will 404 but not 401
                cookies = cached_cookies
                logger.info("Reusing cached session cookies")
                await test_client.close()
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    logger.info("Cached session expired, re-authenticating")
                    del _session_cache[base_url]
                else:
                    # 404 is expected for page "0", means auth is valid
                    cookies = cached_cookies
                    logger.info("Reusing cached session cookies")
                    await test_client.close()
            except Exception:
                # Network error or similar — try fresh auth
                logger.info("Cached session check failed, re-authenticating")

        if not cookies:
            auth = SamlAuthenticator(confluence_base_url=base_url)
            cookies = await auth.authenticate(headless=True)
            await auth.close()
            _session_cache[base_url] = cookies

        # Store cookies for image proxying
        job_cookies[job.job_id] = (base_url, cookies)

        client = ConfluenceClient(base_url, cookies)

        # Step 2: Resolve page ID
        page_id = parsed.get("page_id")
        if not page_id and parsed.get("space_key") and parsed.get("page_title"):
            page = await client.get_page_by_title(
                parsed["space_key"], parsed["page_title"]
            )
            if not page:
                raise ValueError("Page not found")
            page_id = page["id"]

        if not page_id:
            raise ValueError("Could not determine page ID from URL")

        # Step 3: Crawl page tree
        progress.status = JobStatus.CRAWLING
        await manager.broadcast(job.job_id, progress.model_dump())

        async def on_page_found(title: str, total: int):
            progress.pages_crawled = total
            progress.current_page = title
            await manager.broadcast(job.job_id, progress.model_dump())

        crawler = PageTreeCrawler(
            client=client,
            max_depth=request.max_depth,
            max_concurrent=settings.max_concurrent_pages,
            on_page_found=on_page_found,
        )

        if request.include_children:
            page_tree = await crawler.crawl(page_id)
        else:
            page_tree = await crawler._fetch_page(page_id, 0)

        progress.total_pages = count_pages(page_tree)
        progress.pages_crawled = progress.total_pages

        # Step 4: Translate all pages
        progress.status = JobStatus.TRANSLATING
        await manager.broadcast(job.job_id, progress.model_dump())

        translator = TranslationService(
            target_language=request.target_language
        )
        cache = TranslationCache()
        await cache.initialize()

        all_pages = flatten_pages(page_tree)
        for i, page in enumerate(all_pages):
            if progress.status == JobStatus.CANCELLED:
                return

            progress.pages_translated = i
            progress.current_page = page.title
            await manager.broadcast(job.job_id, progress.model_dump())

            # Pre-process Confluence macros → standard HTML before translation
            preprocessed = preprocess_confluence_html(
                page.body_html,
                job_id=job.job_id,
                page_id=page.page_id,
                base_url=base_url,
            )

            # Run blocking LLM calls in thread pool to avoid blocking the event loop
            page.translated_html = await asyncio.to_thread(
                translator.translate_html, preprocessed
            )
            page.title = await asyncio.to_thread(
                translator.translate, page.title
            )

        progress.pages_translated = len(all_pages)

        # Store results
        job_results[job.job_id] = page_tree
        progress.status = JobStatus.COMPLETED
        progress.current_page = None
        await manager.broadcast(job.job_id, progress.model_dump())

        await client.close()

    except Exception as e:
        logger.exception(f"Job {job.job_id} failed")
        progress.status = JobStatus.FAILED
        progress.error = str(e)
        await manager.broadcast(job.job_id, progress.model_dump())


def _find_page(tree: PageData, page_id: str) -> PageData | None:
    """Find a page by ID in the tree."""
    if tree.page_id == page_id:
        return tree
    for child in tree.children:
        found = _find_page(child, page_id)
        if found:
            return found
    return None


def _convert_confluence_images(html: str, job_id: str, page_id: str) -> str:
    """Convert Confluence ac:image macros to standard <img> tags."""
    from bs4 import BeautifulSoup

    if "ac:image" not in html and "ri:attachment" not in html:
        return html

    soup = BeautifulSoup(html, "html.parser")
    changed = False

    for ac_img in soup.find_all("ac:image"):
        # Try ri:attachment (page attachment)
        ri_attach = ac_img.find("ri:attachment")
        if ri_attach:
            filename = ri_attach.get("ri:filename", "")
            if filename:
                # Build the Confluence attachment download URL
                if job_id in job_cookies:
                    base_url = job_cookies[job_id][0]
                    download_url = f"{base_url.rstrip('/')}/download/attachments/{page_id}/{filename}"
                else:
                    download_url = f"/download/attachments/{page_id}/{filename}"

                img_tag = soup.new_tag("img", src=download_url, alt=filename)
                # Copy width/height if present
                width = ac_img.get("ac:width")
                height = ac_img.get("ac:height")
                if width:
                    img_tag["width"] = width
                if height:
                    img_tag["height"] = height
                ac_img.replace_with(img_tag)
                changed = True
                continue

        # Try ri:url (external image)
        ri_url = ac_img.find("ri:url")
        if ri_url:
            url = ri_url.get("ri:value", "")
            if url:
                img_tag = soup.new_tag("img", src=url, alt="")
                width = ac_img.get("ac:width")
                height = ac_img.get("ac:height")
                if width:
                    img_tag["width"] = width
                if height:
                    img_tag["height"] = height
                ac_img.replace_with(img_tag)
                changed = True
                continue

    return str(soup) if changed else html


def _rewrite_image_urls(html: str, job_id: str) -> str:
    """Rewrite img src attributes to go through our image proxy."""
    def replace_src(match: re.Match) -> str:
        prefix = match.group(1)  # 'src="' or "src='"
        url = match.group(2)
        suffix = match.group(3)  # closing quote

        # Skip data URIs and already-proxied URLs
        if url.startswith("data:") or "/api/images/" in url:
            return match.group(0)

        # Skip external URLs that aren't from Confluence
        if url.startswith("http") and job_id not in url:
            # Check if it's a Confluence URL by looking at job_cookies
            if job_id in job_cookies:
                base_url = job_cookies[job_id][0]
                parsed_base = urlparse(base_url)
                parsed_url = urlparse(url)
                if parsed_url.hostname != parsed_base.hostname:
                    return match.group(0)

        from urllib.parse import quote
        proxy_url = f"/api/images/{job_id}?url={quote(url, safe='')}"
        return f"{prefix}{proxy_url}{suffix}"

    # Match src attributes in img tags
    return re.sub(
        r'''(src=["'])([^"']+)(["'])''',
        replace_src,
        html,
    )


