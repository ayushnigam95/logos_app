from pydantic import BaseModel
from typing import Optional
from enum import Enum
import uuid


class JobStatus(str, Enum):
    PENDING = "pending"
    AUTHENTICATING = "authenticating"
    CRAWLING = "crawling"
    TRANSLATING = "translating"
    GENERATING_PDF = "generating_pdf"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobRequest(BaseModel):
    confluence_url: str
    include_children: bool = True
    max_depth: int = -1  # -1 = unlimited
    target_language: str = "en"
    export_pdf: bool = True


class JobProgress(BaseModel):
    job_id: str
    status: JobStatus
    total_pages: int = 0
    pages_crawled: int = 0
    pages_translated: int = 0
    current_page: Optional[str] = None
    error: Optional[str] = None


class Job(BaseModel):
    job_id: str
    request: JobRequest
    progress: JobProgress

    @classmethod
    def create(cls, request: JobRequest) -> "Job":
        job_id = str(uuid.uuid4())
        return cls(
            job_id=job_id,
            request=request,
            progress=JobProgress(job_id=job_id, status=JobStatus.PENDING),
        )
