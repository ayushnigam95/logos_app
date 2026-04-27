import asyncio
import logging
from pathlib import Path
from playwright.async_api import async_playwright, BrowserContext

from app.config import settings

logger = logging.getLogger(__name__)


class SamlAuthenticator:
    """
    Handles SAML/SSO authentication via Playwright.

    Flow:
    1. First run: opens a headed browser → user logs in via SAML manually
    2. Session cookies are saved to disk (browser_session_dir)
    3. Subsequent runs: reuses saved session (headless)
    4. If session expires: detects redirect to login → reopens headed browser
    """

    def __init__(self, confluence_base_url: str | None = None):
        self.base_url = (confluence_base_url or settings.confluence_base_url).rstrip("/")
        self.session_dir = Path(settings.browser_session_dir)
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self._playwright = None
        self._context: BrowserContext | None = None
        self._cookies: list[dict] = []

    async def authenticate(self, headless: bool = False) -> list[dict]:
        """
        Authenticate with Confluence via SAML.
        Returns a list of cookie dicts suitable for httpx.

        If headless=True and session is expired, will fallback to headed mode.
        """
        import os
        # Force headless mode in Docker
        in_docker = os.environ.get("IN_DOCKER", "0") == "1"
        self._playwright = await async_playwright().start()

        # Try headless first with saved session
        if (headless or in_docker) and self._session_exists():
            cookies = await self._try_saved_session()
            if cookies:
                return cookies
            logger.info("Saved session expired, falling back to headed login")

        # Headed login (user completes SAML manually)
        return await self._interactive_login(headless=in_docker)

    async def _try_saved_session(self) -> list[dict] | None:
        """Try to reuse a saved browser session. Returns cookies if valid."""
        try:
            self._context = await self._playwright.chromium.launch_persistent_context(
                user_data_dir=str(self.session_dir),
                headless=True,
            )
            page = self._context.pages[0] if self._context.pages else await self._context.new_page()

            # Navigate to Confluence and check if we're still logged in
            wiki_url = self.base_url
            if not wiki_url.endswith("/wiki"):
                wiki_url += "/wiki"

            await page.goto(wiki_url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(3000)

            current_url = page.url.lower()
            # If we got redirected to a login/SSO page, session is expired
            if any(kw in current_url for kw in ["login", "sso", "saml", "auth", "signin"]):
                await self._context.close()
                self._context = None
                return None

            # Session is valid — extract cookies
            self._cookies = await self._context.cookies()
            await self._context.close()
            return self._format_cookies(self._cookies)

        except Exception as e:
            logger.warning(f"Failed to reuse saved session: {e}")
            if self._context:
                await self._context.close()
                self._context = None
            return None

    async def _interactive_login(self, headless: bool = False) -> list[dict]:
        """Open a browser for the user to complete SAML login. Headless if specified."""
        logger.info("Opening browser for SAML login...")
        if headless:
            logger.info("Running in Docker: using headless browser for SAML login.")
        else:
            logger.info("Please complete the login in the browser window.")

        self._context = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.session_dir),
            headless=headless,
            viewport={"width": 1280, "height": 800},
        )
        page = self._context.pages[0] if self._context.pages else await self._context.new_page()

        wiki_url = self.base_url
        if not wiki_url.endswith("/wiki"):
            wiki_url += "/wiki"

        await page.goto(wiki_url, wait_until="domcontentloaded")

        # Wait for the user to complete login (detect navigation away from login page)
        # We wait until the URL no longer contains login-related keywords
        logger.info("Waiting for SAML login to complete (timeout: 120s)...")
        try:
            await page.wait_for_function(
                """() => {
                    const url = window.location.href.toLowerCase();
                    const loginKeywords = ['login', 'sso', 'saml', 'auth', 'signin'];
                    return !loginKeywords.some(kw => url.includes(kw));
                }""",
                timeout=120000,
            )
        except Exception:
            # Also check if we're on a Confluence page (some SSO URLs don't contain keywords)
            await page.wait_for_selector(
                '[data-testid="app-navigation"], #com-atlassian-confluence, .wiki-content, #main-content',
                timeout=60000,
            )

        # Give it a moment for all cookies to settle
        await page.wait_for_timeout(2000)

        self._cookies = await self._context.cookies()
        logger.info(f"Login successful! Captured {len(self._cookies)} cookies.")

        await self._context.close()
        return self._format_cookies(self._cookies)

    def _session_exists(self) -> bool:
        """Check if a saved browser session exists on disk."""
        return (self.session_dir / "Default").exists() or (
            self.session_dir / "Cookies"
        ).exists()

    @staticmethod
    def _format_cookies(playwright_cookies: list[dict]) -> list[dict]:
        """Convert Playwright cookies to a format usable by httpx."""
        return [
            {
                "name": c["name"],
                "value": c["value"],
                "domain": c["domain"],
                "path": c.get("path", "/"),
            }
            for c in playwright_cookies
        ]

    async def close(self):
        """Clean up Playwright resources."""
        if self._context:
            await self._context.close()
        if self._playwright:
            await self._playwright.stop()
