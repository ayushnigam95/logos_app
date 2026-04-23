"""Convert Confluence storage-format macros to standard HTML.

This module should be called BEFORE translation so that:
- Layout macros become CSS-styled divs (proper column alignment)
- Image macros become <img> tags (prevents attribute text leaking)
- Structured macros (drawio, gliffy, etc.) become clean placeholders
- Macro parameters/metadata don't get extracted as translatable text
"""

import logging
import re
from bs4 import BeautifulSoup, Tag
from urllib.parse import quote

logger = logging.getLogger(__name__)


def preprocess_confluence_html(
    html: str,
    job_id: str = "",
    page_id: str = "",
    base_url: str = "",
) -> str:
    """Convert all Confluence macros to standard HTML before translation.

    Order matters:
    1. Layout macros → CSS flex divs
    2. Structured macros → clean HTML, diagram images, or placeholders
    3. Image macros → <img> tags
    4. Remove remaining ac:/ri: parameter noise
    """
    if not html or not html.strip():
        return html

    # Use html.parser to preserve namespaced tags as-is
    soup = BeautifulSoup(html, "html.parser")

    _convert_layouts(soup)
    _convert_structured_macros(soup, job_id, page_id, base_url)
    _convert_images(soup, job_id, page_id, base_url)
    _clean_remaining_macros(soup)

    return str(soup)


def _convert_layouts(soup: BeautifulSoup) -> None:
    """Convert ac:layout → CSS flex row/column divs."""

    # Process each layout block
    for layout in soup.find_all("ac:layout"):
        layout_div = soup.new_tag("div")
        layout_div["class"] = "confluence-layout"
        layout_div["style"] = "width: 100%; margin: 16px 0;"

        for section in layout.find_all("ac:layout-section", recursive=False):
            section_type = section.get("ac:type", "single")

            section_div = soup.new_tag("div")
            section_div["class"] = f"confluence-layout-section confluence-layout-{section_type}"
            section_div["style"] = "display: flex; gap: 24px; margin-bottom: 16px;"

            cells = section.find_all("ac:layout-cell", recursive=False)
            num_cells = len(cells)

            for cell in cells:
                cell_div = soup.new_tag("div")
                cell_div["class"] = "confluence-layout-cell"
                # Distribute width based on section type and cell count
                width = _get_cell_width(section_type, num_cells)
                cell_div["style"] = f"flex: 0 0 {width}; min-width: 0;"

                # Move all children from the cell into the div
                for child in list(cell.children):
                    child.extract()
                    cell_div.append(child)

                section_div.append(cell_div)

            layout_div.append(section_div)

        layout.replace_with(layout_div)


def _get_cell_width(section_type: str, num_cells: int) -> str:
    """Determine cell width based on Confluence layout section type."""
    width_map = {
        "single": "100%",
        "two_equal": "calc(50% - 12px)",
        "two_left_sidebar": ("30%", "calc(70% - 24px)"),
        "two_right_sidebar": ("calc(70% - 24px)", "30%"),
        "three_equal": "calc(33.33% - 16px)",
        "three_with_sidebars": ("20%", "calc(60% - 48px)", "20%"),
    }
    val = width_map.get(section_type)
    if isinstance(val, tuple):
        # Return based on position — but we don't track position here
        # For simplicity, equal distribution
        return f"calc({100 / num_cells:.1f}% - {12 * (num_cells - 1) / num_cells:.0f}px)"
    if isinstance(val, str):
        return val
    # Fallback: equal distribution
    if num_cells > 0:
        return f"calc({100 / num_cells:.1f}% - {12 * (num_cells - 1) / num_cells:.0f}px)"
    return "100%"


def _convert_images(
    soup: BeautifulSoup,
    job_id: str,
    page_id: str,
    base_url: str,
) -> None:
    """Convert ac:image macros to <img> tags."""
    for ac_img in soup.find_all("ac:image"):
        img_tag = _make_img_tag(soup, ac_img, job_id, page_id, base_url)
        if img_tag:
            ac_img.replace_with(img_tag)
        else:
            # Can't resolve — remove to prevent attribute text leaking
            ac_img.decompose()


def _make_img_tag(
    soup: BeautifulSoup,
    ac_img: Tag,
    job_id: str,
    page_id: str,
    base_url: str,
) -> Tag | None:
    """Build an <img> tag from an ac:image element."""
    src = None
    alt = ""

    # ri:attachment — page attachment
    ri_attach = ac_img.find("ri:attachment")
    if ri_attach:
        filename = ri_attach.get("ri:filename", "")
        if filename:
            alt = filename
            if base_url:
                src = f"{base_url.rstrip('/')}/download/attachments/{page_id}/{quote(filename, safe='')}"
            else:
                src = f"/download/attachments/{page_id}/{quote(filename, safe='')}"

    # ri:url — external image
    if not src:
        ri_url = ac_img.find("ri:url")
        if ri_url:
            src = ri_url.get("ri:value", "")

    if not src:
        return None

    img_tag = soup.new_tag("img", src=src, alt=alt)

    # Copy dimensions
    for attr in ("ac:width", "ac:height", "width", "height"):
        val = ac_img.get(attr)
        if val:
            clean_attr = attr.replace("ac:", "")
            img_tag[clean_attr] = val

    return img_tag


def _convert_structured_macros(soup: BeautifulSoup, job_id: str = "", page_id: str = "", base_url: str = "") -> None:
    """Convert ac:structured-macro elements to useful HTML."""
    for macro in soup.find_all("ac:structured-macro"):
        macro_name = macro.get("ac:name", "") or macro.get("data-macro-name", "")

        # Diagram macros: drawio, drawio-sketch, inc-drawio, gliffy, lucidchart, plantuml
        if "drawio" in macro_name or macro_name in ("gliffy", "lucidchart", "plantuml", "mermaid", "mermaid-cloud"):
            _convert_diagram_macro(soup, macro, macro_name, job_id, page_id, base_url)
        elif macro_name in ("info", "note", "warning", "tip"):
            _convert_panel_macro(soup, macro, macro_name)
        elif macro_name == "expand":
            _convert_expand_macro(soup, macro)
        elif macro_name in ("code", "noformat"):
            _convert_code_macro(soup, macro)
        elif macro_name == "status":
            _convert_status_macro(soup, macro)
        elif macro_name in ("jira", "jiraissues", "jira-issue"):
            _convert_jira_macro(soup, macro)
        elif macro_name in ("viewxls", "viewpdf", "viewfile", "view-file", "view-doc", "view-ppt"):
            _convert_file_macro(soup, macro, base_url, page_id)
        elif macro_name in ("attachments", "attachment"):
            _convert_attachments_macro(soup, macro)
        elif macro_name in ("widget", "widget-connector", "iframe", "multimedia"):
            _convert_embed_macro(soup, macro)
        elif macro_name in ("anchor",):
            _convert_anchor_macro(soup, macro)
        elif macro_name in ("html", "html-bobswift", "html-include"):
            _convert_html_macro(soup, macro)
        # Removed: navigation/dynamic macros that don't make sense offline
        elif macro_name in ("toc", "children", "pagetree", "pagetreesearch",
                            "blog-posts", "recently-updated", "content-by-label",
                            "contentbylabel", "livesearch", "popular-labels",
                            "space-details", "labels-list", "profile-picture",
                            "roster", "gallery"):
            macro.decompose()
        elif macro_name in ("excerpt", "excerpt-include", "panel", "section",
                            "column", "tabs-container", "tab", "ui-tabs-container",
                            "div", "span", "details"):
            _convert_body_only(soup, macro)
        else:
            # Unknown macro — extract body content, discard parameters
            _convert_body_only(soup, macro)

    # Also handle non-structured elements
    _convert_ac_links(soup)
    _convert_task_lists(soup)
    _convert_emoticons(soup)


def _convert_diagram_macro(soup: BeautifulSoup, macro: Tag, name: str,
                           job_id: str = "", page_id: str = "", base_url: str = "") -> None:
    """Replace diagram macros with an <img> pointing to the attachment, or a placeholder."""
    container = soup.new_tag("div")
    container["class"] = "confluence-diagram"
    container["style"] = "text-align: center; margin: 16px 0;"

    # Try to find an embedded image inside the macro first
    inner_img = macro.find("ac:image") or macro.find("img")
    if inner_img:
        img = inner_img.extract()
        container.append(img)
        macro.replace_with(container)
        return

    # Drawio/gliffy store their rendered image as a page attachment.
    # Drawio: attachment name is "{diagramName}.png"
    # inc-drawio: diagram lives on a DIFFERENT page identified by `pageId` param
    diagram_name = _get_macro_param(macro, "diagramName")
    # For included diagrams, use the referenced pageId
    target_page_id = _get_macro_param(macro, "pageId") or page_id

    if diagram_name and target_page_id:
        filename = f"{diagram_name}.png"
        if base_url:
            src = f"{base_url.rstrip('/')}/download/attachments/{target_page_id}/{quote(filename, safe='')}"
        else:
            src = f"/download/attachments/{target_page_id}/{quote(filename, safe='')}"

        img_tag = soup.new_tag("img", src=src, alt=diagram_name)
        # Use diagramWidth (the native resolution) for high-def rendering when available.
        # Fall back to width param, default max-width to 100% for responsive layout.
        diagram_width = _get_macro_param(macro, "diagramWidth")
        display_width = _get_macro_param(macro, "width")

        img_tag["style"] = "max-width: 100%; height: auto;"
        if diagram_width:
            # Render at native resolution (high-def), let CSS max-width scale down
            img_tag["width"] = diagram_width
        elif display_width:
            img_tag["width"] = display_width

        container.append(img_tag)
        macro.replace_with(container)
        return

    # Fallback: placeholder
    placeholder = soup.new_tag("div")
    placeholder["class"] = "confluence-diagram-placeholder"
    placeholder["style"] = (
        "background: #f4f5f7; border: 1px dashed #ccc; border-radius: 4px; "
        "padding: 24px; text-align: center; margin: 16px 0; color: #6b778c;"
    )
    label = diagram_name or f"[{name.title()} Diagram]"
    placeholder.string = f"📊 {label}"
    macro.replace_with(placeholder)


def _convert_panel_macro(soup: BeautifulSoup, macro: Tag, panel_type: str) -> None:
    """Convert info/note/warning/tip macros to styled divs."""
    styles = {
        "info": ("ℹ️", "#deebff", "#0052cc"),
        "note": ("📝", "#fffae6", "#ff8b00"),
        "warning": ("⚠️", "#ffebe6", "#de350b"),
        "tip": ("💡", "#e3fcef", "#006644"),
    }
    icon, bg, border_color = styles.get(panel_type, ("", "#f4f5f7", "#ccc"))

    panel_div = soup.new_tag("div")
    panel_div["class"] = f"confluence-panel confluence-panel-{panel_type}"
    panel_div["style"] = (
        f"background: {bg}; border-left: 4px solid {border_color}; "
        f"padding: 12px 16px; margin: 12px 0; border-radius: 4px;"
    )

    # Optional title
    title = _get_macro_param(macro, "title")
    if title:
        title_tag = soup.new_tag("strong")
        title_tag.string = f"{icon} {title}"
        panel_div.append(title_tag)
        panel_div.append(soup.new_tag("br"))

    # Body content
    body = macro.find("ac:rich-text-body") or macro.find("ac:plain-text-body")
    if body:
        for child in list(body.children):
            child.extract()
            panel_div.append(child)
    else:
        # Fallback: get any remaining text
        for child in list(macro.children):
            if not _is_parameter(child):
                child.extract()
                panel_div.append(child)

    macro.replace_with(panel_div)


def _convert_expand_macro(soup: BeautifulSoup, macro: Tag) -> None:
    """Convert expand macro to a <details> element."""
    details = soup.new_tag("details")
    details["style"] = "margin: 8px 0;"

    title = _get_macro_param(macro, "title") or "Click to expand"
    summary = soup.new_tag("summary")
    summary["style"] = "cursor: pointer; font-weight: bold; padding: 4px 0;"
    summary.string = title
    details.append(summary)

    body = macro.find("ac:rich-text-body")
    if body:
        content_div = soup.new_tag("div")
        content_div["style"] = "padding: 8px 0 8px 16px;"
        for child in list(body.children):
            child.extract()
            content_div.append(child)
        details.append(content_div)

    macro.replace_with(details)


def _convert_code_macro(soup: BeautifulSoup, macro: Tag) -> None:
    """Convert code/noformat macros to <pre><code> blocks."""
    language = _get_macro_param(macro, "language") or ""
    body = macro.find("ac:plain-text-body")

    pre = soup.new_tag("pre")
    code = soup.new_tag("code")
    if language:
        code["class"] = f"language-{language}"
    code.string = body.get_text() if body else ""
    pre.append(code)
    macro.replace_with(pre)


def _convert_status_macro(soup: BeautifulSoup, macro: Tag) -> None:
    """Convert status macro to a colored badge."""
    title = _get_macro_param(macro, "title") or ""
    colour = (_get_macro_param(macro, "colour") or "grey").lower()

    # Confluence status colors → CSS
    colors = {
        "grey": ("#42526e", "#dfe1e6"),
        "gray": ("#42526e", "#dfe1e6"),
        "red": ("#bf2600", "#ffebe6"),
        "yellow": ("#974f0c", "#fff0b3"),
        "green": ("#006644", "#abf5d1"),
        "blue": ("#0747a6", "#deebff"),
        "purple": ("#403294", "#eae6ff"),
    }
    fg, bg = colors.get(colour, colors["grey"])

    badge = soup.new_tag("span")
    badge["class"] = f"confluence-status confluence-status-{colour}"
    badge["style"] = (
        f"display: inline-block; padding: 2px 8px; border-radius: 3px; "
        f"font-size: 11px; font-weight: 700; text-transform: uppercase; "
        f"background: {bg}; color: {fg};"
    )
    badge.string = title
    macro.replace_with(badge)


def _convert_jira_macro(soup: BeautifulSoup, macro: Tag) -> None:
    """Convert Jira issue macro to a link."""
    key = _get_macro_param(macro, "key")
    server_url = _get_macro_param(macro, "serverId") or _get_macro_param(macro, "server")

    if not key:
        # Might be a JQL query macro — skip
        macro.decompose()
        return

    link = soup.new_tag("a")
    # We don't have the real Jira URL; show as styled badge
    link["class"] = "confluence-jira-link"
    link["style"] = (
        "display: inline-block; padding: 1px 6px; border-radius: 3px; "
        "font-family: monospace; font-size: 12px; background: #deebff; "
        "color: #0747a6; text-decoration: none; border: 1px solid #b3d4fc;"
    )
    link.string = key
    if server_url:
        link["href"] = f"{server_url}/browse/{key}"
    macro.replace_with(link)


def _convert_file_macro(soup: BeautifulSoup, macro: Tag, base_url: str, page_id: str) -> None:
    """Convert viewxls/viewpdf/viewfile macros to a download link."""
    attach = macro.find("ri:attachment")
    filename = attach.get("ri:filename", "") if attach else (_get_macro_param(macro, "name") or "")

    if not filename:
        macro.decompose()
        return

    link = soup.new_tag("a")
    if base_url and page_id:
        link["href"] = f"{base_url.rstrip('/')}/download/attachments/{page_id}/{quote(filename, safe='')}"
    else:
        link["href"] = f"/download/attachments/{page_id}/{quote(filename, safe='')}"
    link["class"] = "confluence-file-link"
    link["style"] = (
        "display: inline-block; padding: 6px 12px; margin: 8px 0; "
        "background: #f4f5f7; border: 1px solid #dfe1e6; border-radius: 4px; "
        "text-decoration: none; color: #0052cc;"
    )
    link.string = f"📎 {filename}"
    macro.replace_with(link)


def _convert_attachments_macro(soup: BeautifulSoup, macro: Tag) -> None:
    """Attachments list macro — replaced with a simple note since we can't fetch the list."""
    note = soup.new_tag("div")
    note["class"] = "confluence-attachments-note"
    note["style"] = (
        "padding: 8px 12px; background: #f4f5f7; border-left: 3px solid #0052cc; "
        "font-size: 13px; color: #5e6c84; margin: 8px 0;"
    )
    note.string = "📎 (Attachments list — view original page for files)"
    macro.replace_with(note)


def _convert_embed_macro(soup: BeautifulSoup, macro: Tag) -> None:
    """Convert iframe/widget macros to embedded iframes when possible."""
    url = (_get_macro_param(macro, "url")
           or _get_macro_param(macro, "src")
           or _get_macro_param(macro, "location"))

    if not url:
        _convert_body_only(soup, macro)
        return

    # Basic allow list — iframe for common embeds (youtube, vimeo, gdocs)
    iframe = soup.new_tag("iframe")
    iframe["src"] = url
    iframe["style"] = "width: 100%; min-height: 400px; border: 1px solid #dfe1e6; border-radius: 4px; margin: 8px 0;"
    iframe["loading"] = "lazy"
    iframe["allowfullscreen"] = ""
    macro.replace_with(iframe)


def _convert_anchor_macro(soup: BeautifulSoup, macro: Tag) -> None:
    """Anchor macros become <a name>/<a id> anchors."""
    name = macro.get_text(strip=True) or _get_macro_param(macro, "0") or ""
    if not name:
        macro.decompose()
        return
    anchor = soup.new_tag("a")
    anchor["id"] = name
    anchor["class"] = "confluence-anchor"
    macro.replace_with(anchor)


def _convert_html_macro(soup: BeautifulSoup, macro: Tag) -> None:
    """HTML macro — extract raw HTML body."""
    body = macro.find("ac:plain-text-body")
    if body:
        # Parse the raw HTML and insert it
        raw_html = body.get_text()
        fragment = BeautifulSoup(raw_html, "html.parser")
        wrapper = soup.new_tag("div")
        wrapper["class"] = "confluence-html-macro"
        for child in list(fragment.children):
            wrapper.append(child)
        macro.replace_with(wrapper)
    else:
        macro.decompose()


def _convert_ac_links(soup: BeautifulSoup) -> None:
    """Convert <ac:link> elements (internal page/user/attachment links) to <a>."""
    for link in soup.find_all("ac:link"):
        # Get the display text (link body)
        body = link.find("ac:link-body") or link.find("ac:plain-text-link-body")
        text = body.get_text(strip=True) if body else ""

        # Resolve the target
        ri_page = link.find("ri:page")
        ri_user = link.find("ri:user")
        ri_attach = link.find("ri:attachment")
        ri_space = link.find("ri:space")
        anchor = link.get("ac:anchor", "")

        href = "#"
        if ri_page:
            title = ri_page.get("ri:content-title", "")
            if not text:
                text = title
            # We don't have the page ID resolution, so use the title as a display hint
            if anchor:
                href = f"#{anchor}"
        elif ri_user:
            username = ri_user.get("ri:username", "") or ri_user.get("ri:userkey", "")
            if not text:
                text = f"@{username}"
        elif ri_attach:
            filename = ri_attach.get("ri:filename", "")
            if not text:
                text = filename
        elif ri_space:
            space_key = ri_space.get("ri:space-key", "")
            if not text:
                text = space_key
        elif anchor:
            href = f"#{anchor}"
            if not text:
                text = anchor

        if not text:
            link.decompose()
            continue

        a = soup.new_tag("a", href=href)
        a["class"] = "confluence-internal-link"
        a.string = text
        link.replace_with(a)


def _convert_task_lists(soup: BeautifulSoup) -> None:
    """Convert ac:task-list / ac:task elements to checkbox lists."""
    for task_list in soup.find_all("ac:task-list"):
        ul = soup.new_tag("ul")
        ul["class"] = "confluence-task-list"
        ul["style"] = "list-style: none; padding-left: 0;"

        for task in task_list.find_all("ac:task"):
            status = task.find("ac:task-status")
            body = task.find("ac:task-body")
            is_done = status and status.get_text(strip=True).lower() == "complete"

            li = soup.new_tag("li")
            li["style"] = "margin: 4px 0;"

            checkbox = soup.new_tag("input", type="checkbox")
            checkbox["disabled"] = ""
            if is_done:
                checkbox["checked"] = ""
            checkbox["style"] = "margin-right: 8px;"
            li.append(checkbox)

            if body:
                for child in list(body.children):
                    child.extract()
                    li.append(child)

            ul.append(li)

        task_list.replace_with(ul)


def _convert_emoticons(soup: BeautifulSoup) -> None:
    """Convert ac:emoticon elements to unicode emoji."""
    emoticon_map = {
        "smile": "🙂", "sad": "🙁", "cheeky": "😋", "laugh": "😄",
        "wink": "😉", "thumbs-up": "👍", "thumbs-down": "👎",
        "information": "ℹ️", "tick": "✔️", "cross": "❌",
        "warning": "⚠️", "plus": "➕", "minus": "➖",
        "question": "❓", "light-on": "💡", "light-off": "💭",
        "yellow-star": "⭐", "red-star": "🌟", "green-star": "✨",
        "blue-star": "⭐", "heart": "❤️", "broken-heart": "💔",
    }
    for emo in soup.find_all("ac:emoticon"):
        name = emo.get("ac:name", "")
        char = emoticon_map.get(name, "")
        if char:
            emo.replace_with(char)
        else:
            emo.decompose()


def _convert_body_only(soup: BeautifulSoup, macro: Tag) -> None:
    """Extract body content from a macro, discard parameters."""
    body = macro.find("ac:rich-text-body") or macro.find("ac:plain-text-body")
    if body:
        # Create a wrapper div and move children into it
        wrapper = soup.new_tag("div")
        for child in list(body.children):
            child.extract()
            wrapper.append(child)
        macro.replace_with(wrapper)
    else:
        # No body — try to preserve any real content, discard parameter tags
        wrapper = soup.new_tag("div")
        has_content = False
        for child in list(macro.children):
            if not _is_parameter(child):
                child.extract()
                wrapper.append(child)
                has_content = True
        if has_content:
            macro.replace_with(wrapper)
        else:
            macro.decompose()


def _clean_remaining_macros(soup: BeautifulSoup) -> None:
    """Remove any remaining ac:/ri: elements that weren't handled.

    This prevents macro attribute text from leaking into the output.
    """
    # Remove ac:parameter tags
    for param in soup.find_all("ac:parameter"):
        param.decompose()

    # Remove ri: elements that are orphaned (not inside an already-converted tag)
    for tag_name in ("ri:attachment", "ri:url", "ri:page", "ri:space",
                     "ri:content-entity", "ri:user"):
        for el in soup.find_all(tag_name):
            el.decompose()

    # Clean up any remaining empty ac: wrapper tags
    for tag in soup.find_all(re.compile(r'^ac:')):
        # If it has children, unwrap (keep children); if empty, remove
        if tag.contents:
            tag.unwrap()
        else:
            tag.decompose()


def _get_macro_param(macro: Tag, name: str) -> str | None:
    """Get a named parameter from a structured macro."""
    for param in macro.find_all("ac:parameter"):
        if param.get("ac:name") == name:
            return param.get_text(strip=True)
    return None


def _is_parameter(element) -> bool:
    """Check if an element is a macro parameter (should be discarded)."""
    if isinstance(element, Tag):
        tag_name = element.name or ""
        return tag_name.startswith("ac:parameter") or tag_name.startswith("ri:")
    return False
