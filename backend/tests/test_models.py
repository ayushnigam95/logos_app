from app.models.job import Job, JobRequest, JobStatus


class TestJobModel:
    def test_create_job(self):
        request = JobRequest(
            confluence_url="https://company.atlassian.net/wiki/spaces/PROJ/pages/123/Test"
        )
        job = Job.create(request)
        assert job.job_id
        assert job.progress.status == JobStatus.PENDING
        assert job.progress.job_id == job.job_id
        assert job.request.confluence_url == request.confluence_url

    def test_job_defaults(self):
        request = JobRequest(
            confluence_url="https://example.com/wiki/spaces/X/pages/1/T"
        )
        assert request.include_children is True
        assert request.max_depth == -1
        assert request.target_language == "en"
        assert request.export_pdf is True

    def test_job_custom_values(self):
        request = JobRequest(
            confluence_url="https://example.com/wiki/spaces/X/pages/1/T",
            include_children=False,
            max_depth=3,
            target_language="fr",
            export_pdf=False,
        )
        assert request.include_children is False
        assert request.max_depth == 3
        assert request.target_language == "fr"

    def test_job_progress_defaults(self):
        request = JobRequest(
            confluence_url="https://example.com/wiki/spaces/X/pages/1/T"
        )
        job = Job.create(request)
        assert job.progress.total_pages == 0
        assert job.progress.pages_crawled == 0
        assert job.progress.pages_translated == 0
        assert job.progress.current_page is None
        assert job.progress.error is None
