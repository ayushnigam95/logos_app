import pytest
from app.utils.url_parser import parse_confluence_url


class TestParseConfluenceUrl:
    def test_cloud_format_with_title(self):
        url = "https://company.atlassian.net/wiki/spaces/PROJ/pages/12345/My+Page+Title"
        result = parse_confluence_url(url)
        assert result["base_url"] == "https://company.atlassian.net/wiki"
        assert result["space_key"] == "PROJ"
        assert result["page_id"] == "12345"
        assert result["page_title"] == "My+Page+Title"

    def test_cloud_format_without_title(self):
        url = "https://company.atlassian.net/wiki/spaces/DEV/pages/67890"
        result = parse_confluence_url(url)
        assert result["base_url"] == "https://company.atlassian.net/wiki"
        assert result["space_key"] == "DEV"
        assert result["page_id"] == "67890"
        assert result["page_title"] is None

    def test_server_display_format(self):
        url = "https://confluence.company.com/display/TEAM/Getting+Started"
        result = parse_confluence_url(url)
        assert result["base_url"] == "https://confluence.company.com"
        assert result["space_key"] == "TEAM"
        assert result["page_title"] == "Getting+Started"
        assert result["page_id"] is None

    def test_server_viewpage_format(self):
        url = "https://confluence.company.com/pages/viewpage.action?pageId=99999"
        result = parse_confluence_url(url)
        assert result["base_url"] == "https://confluence.company.com"
        assert result["page_id"] == "99999"

    def test_invalid_url_raises(self):
        with pytest.raises(ValueError, match="Could not parse"):
            parse_confluence_url("https://example.com/something/random")

    def test_url_with_encoded_chars(self):
        url = "https://company.atlassian.net/wiki/spaces/PROJ/pages/111/Hello%20World"
        result = parse_confluence_url(url)
        assert result["space_key"] == "PROJ"
        assert result["page_id"] == "111"

    def test_datacenter_format_no_wiki_prefix(self):
        url = "https://confluence.falabella.tech/spaces/FIFDF/pages/551637513/Kairos+Platform"
        result = parse_confluence_url(url)
        assert result["base_url"] == "https://confluence.falabella.tech"
        assert result["space_key"] == "FIFDF"
        assert result["page_id"] == "551637513"
        assert result["page_title"] == "Kairos+Platform"

    def test_datacenter_format_no_title(self):
        url = "https://confluence.company.com/spaces/TEAM/pages/12345"
        result = parse_confluence_url(url)
        assert result["space_key"] == "TEAM"
        assert result["page_id"] == "12345"
        assert result["page_title"] is None
