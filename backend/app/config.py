from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # Confluence
    confluence_base_url: str = ""

    # LLM (GitHub Models API — included with Copilot subscription)
    llm_api_key: str = ""  # GitHub PAT with copilot scope
    llm_base_url: str = "https://models.inference.ai.azure.com"
    llm_model: str = "gpt-4o"  # text translation model
    llm_vision_model: str = ""  # vision model for OCR (e.g. llava:7b); falls back to llm_model
    target_language: str = "en"

    # App
    app_secret_key: str = "change-me-in-production"
    cache_db_path: str = str(Path(__file__).parent.parent / "data" / "cache.db")
    browser_session_dir: str = str(Path(__file__).parent.parent / "browser_session")
    max_concurrent_pages: int = 5

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
