import asyncio
import logging
from typing import Callable, Awaitable

from app.models.page import PageData
from app.services.confluence import ConfluenceClient

logger = logging.getLogger(__name__)


class PageTreeCrawler:
    """Recursively crawls Confluence page trees."""

    def __init__(
        self,
        client: ConfluenceClient,
        max_depth: int = -1,
        max_concurrent: int = 5,
        on_page_found: Callable[[str, int], Awaitable[None]] | None = None,
    ):
        self.client = client
        self.max_depth = max_depth
        self.max_concurrent = max_concurrent
        self.on_page_found = on_page_found
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self.total_pages_found = 0

    async def crawl(self, page_id: str, depth: int = 0) -> PageData:
        """
        Crawl a page and all its children recursively.
        Returns a PageData tree.
        """
        async with self._semaphore:
            logger.info(f"Crawling page {page_id} (depth={depth})")
            page_data = await self._fetch_page(page_id, depth)
            self.total_pages_found += 1

            if self.on_page_found:
                await self.on_page_found(page_data.title, self.total_pages_found)

        # Check depth limit
        if self.max_depth != -1 and depth >= self.max_depth:
            return page_data

        # Crawl children concurrently
        child_tasks = []
        async for child_raw in self.client.iter_all_child_pages(page_id):
            child_id = child_raw["id"]
            task = asyncio.create_task(self.crawl(child_id, depth + 1))
            child_tasks.append(task)

        if child_tasks:
            children = await asyncio.gather(*child_tasks, return_exceptions=True)
            for child in children:
                if isinstance(child, PageData):
                    child.parent_id = page_id
                    page_data.children.append(child)
                elif isinstance(child, Exception):
                    logger.error(f"Failed to crawl child of {page_id}: {child}")

        return page_data

    async def _fetch_page(self, page_id: str, depth: int) -> PageData:
        """Fetch a single page and convert to PageData."""
        raw = await self.client.get_page(page_id)

        body_html = raw.get("body", {}).get("storage", {}).get("value", "")
        space_key = raw.get("space", {}).get("key", "")
        title = raw.get("title", "Untitled")

        # Build the page URL
        base_link = raw.get("_links", {}).get("base", "")
        web_link = raw.get("_links", {}).get("webui", "")
        url = base_link + web_link if base_link and web_link else ""

        return PageData(
            page_id=str(raw["id"]),
            title=title,
            space_key=space_key,
            body_html=body_html,
            url=url,
            depth=depth,
        )


def count_pages(page: PageData) -> int:
    """Count total pages in a page tree."""
    count = 1
    for child in page.children:
        count += count_pages(child)
    return count


def flatten_pages(page: PageData) -> list[PageData]:
    """Flatten a page tree into a list (BFS order)."""
    pages = [page]
    for child in page.children:
        pages.extend(flatten_pages(child))
    return pages
