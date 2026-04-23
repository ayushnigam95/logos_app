from pydantic import BaseModel
from typing import Optional


class PageData(BaseModel):
    page_id: str
    title: str
    space_key: str
    body_html: str
    translated_html: Optional[str] = None
    url: str
    parent_id: Optional[str] = None
    children: list["PageData"] = []
    depth: int = 0


class PageTreeNode(BaseModel):
    page_id: str
    title: str
    translated_title: Optional[str] = None
    url: str
    children: list["PageTreeNode"] = []
