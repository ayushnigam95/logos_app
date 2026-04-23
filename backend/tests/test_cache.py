import pytest
import pytest_asyncio
from app.services.cache import TranslationCache
import tempfile
import os


@pytest_asyncio.fixture
async def cache(tmp_path):
    db_path = str(tmp_path / "test_cache.db")
    c = TranslationCache(db_path=db_path)
    await c.initialize()
    return c


@pytest.mark.asyncio
async def test_put_and_get(cache):
    await cache.put("hello", "hola", "es", "google")
    result = await cache.get("hello", "es", "google")
    assert result == "hola"


@pytest.mark.asyncio
async def test_get_missing(cache):
    result = await cache.get("nonexistent", "en", "google")
    assert result is None


@pytest.mark.asyncio
async def test_overwrite(cache):
    await cache.put("hi", "salut", "fr", "google")
    await cache.put("hi", "bonjour", "fr", "google")
    result = await cache.get("hi", "fr", "google")
    assert result == "bonjour"


@pytest.mark.asyncio
async def test_different_languages(cache):
    await cache.put("hello", "hola", "es", "google")
    await cache.put("hello", "bonjour", "fr", "google")
    assert await cache.get("hello", "es", "google") == "hola"
    assert await cache.get("hello", "fr", "google") == "bonjour"


@pytest.mark.asyncio
async def test_different_providers(cache):
    await cache.put("hello", "hola_google", "es", "google")
    await cache.put("hello", "hola_deepl", "es", "deepl")
    assert await cache.get("hello", "es", "google") == "hola_google"
    assert await cache.get("hello", "es", "deepl") == "hola_deepl"


@pytest.mark.asyncio
async def test_get_batch(cache):
    await cache.put("one", "uno", "es", "google")
    await cache.put("two", "dos", "es", "google")
    result = await cache.get_batch(["one", "two", "three"], "es", "google")
    assert result["one"] == "uno"
    assert result["two"] == "dos"
    assert result["three"] is None


@pytest.mark.asyncio
async def test_clear(cache):
    await cache.put("test", "prueba", "es", "google")
    await cache.clear()
    result = await cache.get("test", "es", "google")
    assert result is None
