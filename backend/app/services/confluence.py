import logging
from typing import AsyncGenerator

import httpx

logger = logging.getLogger(__name__)


class ConfluenceClient:
    """
    Async Confluence REST API client using httpx with SAML session cookies.
    """

    def __init__(self, base_url: str, cookies: list[dict]):
        self.base_url = base_url.rstrip("/")
        # Build the REST API base
        if "/wiki" in self.base_url:
            self.api_base = self.base_url + "/rest/api"
        else:
            self.api_base = self.base_url + "/rest/api"

        self._client = httpx.AsyncClient(timeout=30.0)
        for cookie in cookies:
            self._client.cookies.set(
                cookie["name"],
                cookie["value"],
                domain=cookie.get("domain", ""),
                path=cookie.get("path", "/"),
            )

    async def get_page(self, page_id: str) -> dict:
        """Fetch a single page with its body (storage format) and metadata."""
        url = f"{self.api_base}/content/{page_id}"
        params = {
            "expand": "body.storage,space,ancestors,version,children.page",
        }
        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()

    async def get_page_by_title(self, space_key: str, title: str) -> dict | None:
        """Find a page by space key and title."""
        url = f"{self.api_base}/content"
        params = {
            "spaceKey": space_key,
            "title": title,
            "expand": "body.storage,space,ancestors,version,children.page",
        }
        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])
        return results[0] if results else None

    async def get_child_pages(
        self, page_id: str, limit: int = 25, start: int = 0
    ) -> dict:
        """Get child pages of a given page (paginated)."""
        url = f"{self.api_base}/content/{page_id}/child/page"
        params = {
            "expand": "body.storage,children.page",
            "limit": limit,
            "start": start,
        }
        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()

    async def iter_all_child_pages(
        self, page_id: str
    ) -> AsyncGenerator[dict, None]:
        """Iterate through ALL child pages (handles pagination)."""
        start = 0
        limit = 25
        while True:
            data = await self.get_child_pages(page_id, limit=limit, start=start)
            results = data.get("results", [])
            for page in results:
                yield page

            # Check if there are more pages
            size = data.get("size", 0)
            if size < limit:
                break
            start += limit

    async def get_attachment(self, page_id: str, filename: str) -> bytes | None:
        """Download an attachment by filename from a page."""
        url = f"{self.api_base}/content/{page_id}/child/attachment"
        params = {"filename": filename}
        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])
        if not results:
            return None

        download_link = results[0].get("_links", {}).get("download", "")
        if not download_link:
            return None

        download_url = self.base_url + download_link
        dl_resp = await self._client.get(download_url)
        dl_resp.raise_for_status()
        return dl_resp.content

    async def get_page_attachments(self, page_id: str) -> list[dict]:
        """List all attachments on a page."""
        url = f"{self.api_base}/content/{page_id}/child/attachment"
        params = {"limit": 100}
        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        return resp.json().get("results", [])

    async def close(self):
        await self._client.aclose()
