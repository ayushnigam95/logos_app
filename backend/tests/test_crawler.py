from app.services.crawler import count_pages, flatten_pages
from app.models.page import PageData


class TestCrawlerHelpers:
    def _make_tree(self):
        child1 = PageData(
            page_id="2", title="Child 1", space_key="SP",
            body_html="<p>child1</p>", url="/child1", depth=1,
        )
        child2 = PageData(
            page_id="3", title="Child 2", space_key="SP",
            body_html="<p>child2</p>", url="/child2", depth=1,
        )
        grandchild = PageData(
            page_id="4", title="Grandchild", space_key="SP",
            body_html="<p>grandchild</p>", url="/gc", depth=2,
        )
        child1.children = [grandchild]
        root = PageData(
            page_id="1", title="Root", space_key="SP",
            body_html="<p>root</p>", url="/root", depth=0,
            children=[child1, child2],
        )
        return root

    def test_count_pages(self):
        tree = self._make_tree()
        assert count_pages(tree) == 4

    def test_count_single_page(self):
        page = PageData(
            page_id="1", title="Only", space_key="SP",
            body_html="", url="/", depth=0,
        )
        assert count_pages(page) == 1

    def test_flatten_pages(self):
        tree = self._make_tree()
        flat = flatten_pages(tree)
        assert len(flat) == 4
        ids = [p.page_id for p in flat]
        assert "1" in ids
        assert "2" in ids
        assert "3" in ids
        assert "4" in ids

    def test_flatten_preserves_order(self):
        tree = self._make_tree()
        flat = flatten_pages(tree)
        # Root should be first
        assert flat[0].page_id == "1"
