import aiosqlite
import json
import hashlib
import logging
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


class TranslationCache:
    """SQLite-based cache for translations to avoid redundant API calls."""

    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or settings.cache_db_path
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

    async def initialize(self):
        """Create the cache table if it doesn't exist."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS translation_cache (
                    content_hash TEXT PRIMARY KEY,
                    source_text TEXT NOT NULL,
                    translated_text TEXT NOT NULL,
                    target_language TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_cache_lang_provider
                ON translation_cache(target_language, provider)
            """)
            await db.commit()

    @staticmethod
    def _hash(text: str, target_lang: str, provider: str) -> str:
        key = f"{provider}:{target_lang}:{text}"
        return hashlib.sha256(key.encode()).hexdigest()

    async def get(self, text: str, target_lang: str, provider: str) -> str | None:
        """Look up a cached translation."""
        h = self._hash(text, target_lang, provider)
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "SELECT translated_text FROM translation_cache WHERE content_hash = ?",
                (h,),
            )
            row = await cursor.fetchone()
            return row[0] if row else None

    async def put(
        self, text: str, translated: str, target_lang: str, provider: str
    ):
        """Store a translation in the cache."""
        h = self._hash(text, target_lang, provider)
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """INSERT OR REPLACE INTO translation_cache
                   (content_hash, source_text, translated_text, target_language, provider)
                   VALUES (?, ?, ?, ?, ?)""",
                (h, text, translated, target_lang, provider),
            )
            await db.commit()

    async def get_batch(
        self, texts: list[str], target_lang: str, provider: str
    ) -> dict[str, str | None]:
        """Look up multiple cached translations at once."""
        result = {}
        async with aiosqlite.connect(self.db_path) as db:
            for text in texts:
                h = self._hash(text, target_lang, provider)
                cursor = await db.execute(
                    "SELECT translated_text FROM translation_cache WHERE content_hash = ?",
                    (h,),
                )
                row = await cursor.fetchone()
                result[text] = row[0] if row else None
        return result

    async def clear(self):
        """Clear all cached translations."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM translation_cache")
            await db.commit()
