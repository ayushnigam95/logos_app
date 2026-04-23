from bs4 import BeautifulSoup, NavigableString
from typing import Callable


# Tags whose text content should never be translated
SKIP_TAGS = {"code", "pre", "script", "style", "kbd", "samp", "var", "svg", "math"}


def _is_plain_text(element) -> bool:
    """Return True only for plain text NavigableStrings (not Comment, CData, etc.)."""
    return type(element) is NavigableString


def extract_text_nodes(html: str) -> list[dict]:
    """Extract all translatable text nodes from HTML, preserving structure."""
    soup = BeautifulSoup(html, "lxml")
    nodes = []

    def _walk(element, skip=False):
        if isinstance(element, NavigableString):
            if not _is_plain_text(element):
                return  # skip Comment, CData, ProcessingInstruction, etc.
            text = str(element).strip()
            if text and not skip:
                nodes.append({"node": element, "text": text})
            return
        tag_name = getattr(element, "name", None)
        should_skip = skip or (tag_name in SKIP_TAGS)
        for child in element.children:
            _walk(child, should_skip)

    _walk(soup)
    return nodes


def replace_text_nodes(html: str, translations: dict[str, str]) -> str:
    """
    Replace text nodes in HTML with translated versions.
    translations: mapping of original text → translated text
    """
    soup = BeautifulSoup(html, "lxml")

    def _walk(element, skip=False):
        if isinstance(element, NavigableString):
            if not _is_plain_text(element):
                return
            text = str(element).strip()
            if text and not skip and text in translations:
                original_str = str(element)
                translated = translations[text]
                # Preserve leading/trailing whitespace from original
                leading = original_str[: len(original_str) - len(original_str.lstrip())]
                trailing = original_str[len(original_str.rstrip()) :]
                element.replace_with(NavigableString(leading + translated + trailing))
            return
        tag_name = getattr(element, "name", None)
        should_skip = skip or (tag_name in SKIP_TAGS)
        for child in list(element.children):
            _walk(child, should_skip)

    _walk(soup)

    # Return just the body content if lxml wrapped it
    body = soup.find("body")
    if body:
        return "".join(str(child) for child in body.children)
    return str(soup)


def extract_image_urls(html: str, base_url: str = "") -> list[str]:
    """Extract all image URLs from HTML content."""
    soup = BeautifulSoup(html, "lxml")
    urls = []

    # Standard <img> tags
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if src:
            if src.startswith("/") and base_url:
                src = base_url.rstrip("/") + src
            urls.append(src)

    # Confluence <ac:image> macros
    for ac_img in soup.find_all("ac:image"):
        ri = ac_img.find("ri:attachment")
        if ri:
            filename = ri.get("ri:filename", "")
            if filename:
                urls.append(f"attachment:{filename}")

    return urls
