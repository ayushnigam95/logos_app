from unittest.mock import patch, MagicMock
from app.services.translator import TranslationService


def _mock_openai_response(content: str):
    """Create a mock OpenAI chat completion response."""
    choice = MagicMock()
    choice.message.content = content
    response = MagicMock()
    response.choices = [choice]
    return response


class TestTranslationService:
    @patch("app.services.translator.OpenAI")
    def test_translate_simple_text(self, mock_openai_cls):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_openai_response("Hello world")

        svc = TranslationService(target_language="en")
        result = svc.translate("Hola mundo")

        assert result == "Hello world"
        mock_client.chat.completions.create.assert_called_once()
        call_kwargs = mock_client.chat.completions.create.call_args[1]
        assert call_kwargs["temperature"] == 0.1
        assert any("Hola mundo" in str(m) for m in call_kwargs["messages"])

    @patch("app.services.translator.OpenAI")
    def test_translate_empty_string(self, mock_openai_cls):
        svc = TranslationService(target_language="en")
        assert svc.translate("") == ""
        assert svc.translate("   ") == "   "
        mock_openai_cls.return_value.chat.completions.create.assert_not_called()

    @patch("app.services.translator.OpenAI")
    def test_translate_batch(self, mock_openai_cls):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.chat.completions.create.side_effect = [
            _mock_openai_response("One"),
            _mock_openai_response("Two"),
        ]

        svc = TranslationService(target_language="en")
        results = svc.translate_batch(["Uno", "", "Dos"])

        assert results == ["One", "", "Two"]
        assert mock_client.chat.completions.create.call_count == 2

    @patch("app.services.translator.OpenAI")
    def test_translate_html_small(self, mock_openai_cls):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_openai_response(
            "<p>Hello world</p>"
        )

        svc = TranslationService(target_language="en")
        result = svc.translate_html("<p>Hola mundo</p>")

        assert result == "<p>Hello world</p>"
        # Should use direct HTML mode for small content
        call_kwargs = mock_client.chat.completions.create.call_args[1]
        assert "HTML" in str(call_kwargs["messages"][0])

    @patch("app.services.translator.OpenAI")
    def test_translate_html_empty(self, mock_openai_cls):
        svc = TranslationService(target_language="en")
        assert svc.translate_html("") == ""
        mock_openai_cls.return_value.chat.completions.create.assert_not_called()

    @patch("app.services.translator.OpenAI")
    def test_translate_fallback_on_error(self, mock_openai_cls):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("API error")

        svc = TranslationService(target_language="en")
        result = svc.translate("Should fallback")

        # Should return original text on error
        assert result == "Should fallback"

    @patch("app.services.translator.OpenAI")
    def test_translate_uses_target_language(self, mock_openai_cls):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.chat.completions.create.return_value = _mock_openai_response("Bonjour")

        svc = TranslationService(target_language="fr")
        svc.translate("Hello")

        call_kwargs = mock_client.chat.completions.create.call_args[1]
        system_msg = call_kwargs["messages"][0]["content"]
        assert "fr" in system_msg
