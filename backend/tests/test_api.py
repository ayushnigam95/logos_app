import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_create_job_invalid_url():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/jobs",
            json={"confluence_url": "https://example.com/not-a-confluence-url"},
        )
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_get_job_not_found():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/jobs/nonexistent-id")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cancel_job_not_found():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.delete("/api/jobs/nonexistent-id")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_job_pages_not_found():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/jobs/nonexistent-id/pages")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_export_pdf_not_found():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/export/jobs/nonexistent-id/pdf")
        assert resp.status_code == 404
