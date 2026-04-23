import re
from urllib.parse import urlparse, unquote


def parse_confluence_url(url: str) -> dict:
    """
    Parse a Confluence URL and extract base_url, space_key, and page_id.

    Supports formats:
    - Cloud:  https://company.atlassian.net/wiki/spaces/SPACE/pages/12345/Page+Title
    - Server: https://confluence.company.com/display/SPACE/Page+Title
    - Server: https://confluence.company.com/pages/viewpage.action?pageId=12345
    """
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    path = unquote(parsed.path)

    result = {
        "base_url": base_url,
        "space_key": None,
        "page_id": None,
        "page_title": None,
    }

    # Cloud format: /wiki/spaces/SPACE/pages/12345/Title
    cloud_match = re.match(
        r"/wiki/spaces/([^/]+)/pages/(\d+)(?:/(.+))?", path
    )
    if cloud_match:
        result["base_url"] = f"{base_url}/wiki"
        result["space_key"] = cloud_match.group(1)
        result["page_id"] = cloud_match.group(2)
        result["page_title"] = cloud_match.group(3)
        return result

    # Data Center / Server format: /spaces/SPACE/pages/12345/Title (no /wiki prefix)
    dc_match = re.match(
        r"/spaces/([^/]+)/pages/(\d+)(?:/(.+))?", path
    )
    if dc_match:
        result["space_key"] = dc_match.group(1)
        result["page_id"] = dc_match.group(2)
        result["page_title"] = dc_match.group(3)
        return result

    # Server format: /display/SPACE/Title
    display_match = re.match(r"/display/([^/]+)/(.+)", path)
    if display_match:
        result["space_key"] = display_match.group(1)
        result["page_title"] = display_match.group(2)
        return result

    # Server format: /pages/viewpage.action?pageId=12345
    if "viewpage.action" in path:
        query_params = dict(
            param.split("=") for param in parsed.query.split("&") if "=" in param
        )
        result["page_id"] = query_params.get("pageId")
        return result

    raise ValueError(f"Could not parse Confluence URL: {url}")
