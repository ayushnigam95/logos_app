from app.utils.html_processor import extract_text_nodes, replace_text_nodes, extract_image_urls


class TestExtractTextNodes:
    def test_simple_html(self):
        html = "<p>Hello world</p>"
        nodes = extract_text_nodes(html)
        texts = [n["text"] for n in nodes]
        assert "Hello world" in texts

    def test_nested_html(self):
        html = "<div><p>First</p><p>Second</p></div>"
        nodes = extract_text_nodes(html)
        texts = [n["text"] for n in nodes]
        assert "First" in texts
        assert "Second" in texts

    def test_skips_code_blocks(self):
        html = "<p>Translate me</p><code>skip_this()</code><pre>also_skip</pre>"
        nodes = extract_text_nodes(html)
        texts = [n["text"] for n in nodes]
        assert "Translate me" in texts
        assert "skip_this()" not in texts
        assert "also_skip" not in texts

    def test_skips_script_and_style(self):
        html = "<p>Visible</p><script>var x=1;</script><style>.a{color:red}</style>"
        nodes = extract_text_nodes(html)
        texts = [n["text"] for n in nodes]
        assert "Visible" in texts
        assert len(texts) == 1

    def test_empty_html(self):
        nodes = extract_text_nodes("")
        assert nodes == []

    def test_whitespace_only_skipped(self):
        html = "<p>   </p><p>Real text</p>"
        nodes = extract_text_nodes(html)
        texts = [n["text"] for n in nodes]
        assert "Real text" in texts
        assert len(texts) == 1


class TestReplaceTextNodes:
    def test_simple_replacement(self):
        html = "<p>Hola mundo</p>"
        translations = {"Hola mundo": "Hello world"}
        result = replace_text_nodes(html, translations)
        assert "Hello world" in result
        assert "Hola mundo" not in result

    def test_preserves_tags(self):
        html = '<p class="intro">Bonjour</p>'
        translations = {"Bonjour": "Hello"}
        result = replace_text_nodes(html, translations)
        assert "Hello" in result
        assert 'class="intro"' in result

    def test_skips_code_in_replacement(self):
        html = "<p>Translate</p><code>keep_this</code>"
        translations = {"Translate": "Translated", "keep_this": "CHANGED"}
        result = replace_text_nodes(html, translations)
        assert "Translated" in result
        assert "keep_this" in result  # should NOT have been replaced

    def test_no_matching_translations(self):
        html = "<p>Some text</p>"
        translations = {"Other text": "Otro texto"}
        result = replace_text_nodes(html, translations)
        assert "Some text" in result

    def test_multiple_replacements(self):
        html = "<div><h1>Title</h1><p>Body text</p></div>"
        translations = {"Title": "Titre", "Body text": "Corps du texte"}
        result = replace_text_nodes(html, translations)
        assert "Titre" in result
        assert "Corps du texte" in result


class TestExtractImageUrls:
    def test_img_tags(self):
        html = '<p><img src="https://example.com/img.png"/></p>'
        urls = extract_image_urls(html)
        assert "https://example.com/img.png" in urls

    def test_relative_img_with_base(self):
        html = '<img src="/download/attachments/123/pic.png"/>'
        urls = extract_image_urls(html, base_url="https://confluence.company.com")
        assert "https://confluence.company.com/download/attachments/123/pic.png" in urls

    def test_no_images(self):
        html = "<p>Just text</p>"
        urls = extract_image_urls(html)
        assert urls == []
