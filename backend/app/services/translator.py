import logging
import re
from openai import OpenAI
from app.config import settings

logger = logging.getLogger(__name__)

TRANSLATE_SYSTEM_PROMPT = """You are a professional translator. Translate the given text to {target_language}.
Rules:
- Return ONLY the translated text, nothing else
- No explanations, notes, preamble, or commentary
- Do NOT add any markdown formatting: no **, no *, no #, no -, no numbered lists
- Do NOT wrap text in bold, italic, or any other formatting markers
- Return plain text only — the text will be placed back into its original HTML context
- Preserve ALL punctuation exactly as in the original: colons, semicolons, periods, commas, dashes, parentheses, brackets
- If the text is already in {target_language}, return it exactly as-is with zero changes
- Do NOT translate: code, variable names, URLs, email addresses, brand names, product names, acronyms
- Do NOT say things like 'The text is already in English' or 'Here is the translation'
- NEVER add or remove punctuation marks
- Your response must contain ONLY the translated text"""

# Leading/trailing punctuation that LLMs tend to strip during translation
_LEADING_PUNCT = re.compile(r'^([:\;\-\u2013\u2014,\.\(\)\[\]/\\|!?\u00bf\u00a1]+[\s]*)')
_TRAILING_PUNCT = re.compile(r'([\s]*[:\;\-\u2013\u2014,\.\(\)\[\]/\\|!?\u00bf\u00a1]+)$')

# Leading number prefix (e.g. "2. ", "3.1 ", "5. ") that LLMs tend to drop
_LEADING_NUMBER = re.compile(r'^(\d+(?:\.\d+)*\.?\s+)')


class TranslationService:
    """Translate text and HTML using LLM (OpenAI-compatible)."""

    def __init__(self, target_language: str = "en"):
        self.target_language = target_language
        self._client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )
        self._model = settings.llm_model

    @staticmethod
    def _strip_markdown(text: str) -> str:
        """Remove markdown bold/heading artifacts that the LLM might add.

        Only strips patterns that are unambiguously markdown:
        - **bold** markers (safe: literal ** rarely appears in normal text)
        - # heading markers at line start
        Does NOT strip: italic (*), bullets (- ), numbered lists (1. )
        because those patterns appear in legitimate content.
        """
        text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
        text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
        return text.strip()

    @staticmethod
    def _should_skip(text: str) -> bool:
        """Check if text should be returned as-is without sending to LLM.

        Skips: empty/whitespace, single characters, pure numbers/punctuation,
        URLs, and email addresses.
        """
        stripped = text.strip()
        if not stripped:
            return True
        if len(stripped) <= 1:
            return True
        # No alphabetic characters at all → pure numbers/punctuation/symbols
        if not any(c.isalpha() for c in stripped):
            return True
        # URLs
        if re.match(r'^https?://\S+$', stripped, re.IGNORECASE):
            return True
        # Emails
        if re.match(r'^[\w.+-]+@[\w-]+\.[\w.-]+$', stripped):
            return True
        return False

    def translate(self, text: str) -> str:
        """Translate a single text string using the LLM."""
        if not text or not text.strip():
            return text
        if self._should_skip(text):
            return text

        # Protect leading number prefix (e.g. "2. Arquitectura" → "2. " + "Arquitectura")
        num_prefix = ""
        body = text
        m = _LEADING_NUMBER.match(body)
        if m:
            num_prefix = m.group(1)
            body = body[len(num_prefix):]
            if not body.strip():
                return text  # Just a number, nothing to translate

        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {
                        "role": "system",
                        "content": TRANSLATE_SYSTEM_PROMPT.format(
                            target_language=self.target_language
                        ),
                    },
                    {"role": "user", "content": body},
                ],
                temperature=0.1,
                max_tokens=4096,
            )
            result = response.choices[0].message.content
            if result:
                result = self._strip_markdown(result.strip())
                # If LLM returned something wildly longer, it likely added commentary
                if len(result) > len(body) * 5 and len(body) > 10:
                    logger.warning(
                        "LLM output is %.1fx longer than input (%d chars), "
                        "may contain commentary",
                        len(result) / len(text), len(text),
                    )
                    first_line = result.split('\n')[0].strip()
                    if first_line:
                        result = first_line
                # Strip any number prefix the LLM may have re-added
                if num_prefix and result:
                    m2 = _LEADING_NUMBER.match(result)
                    if m2:
                        result = result[len(m2.group(1)):]
            translated = result if result else body
            return num_prefix + translated
        except Exception as e:
            logger.error(f"LLM translation failed for text ({len(text)} chars): {e}")
            return text

    def translate_batch(self, texts: list[str]) -> list[str]:
        """Translate a batch of text strings."""
        return [self.translate(t) if t and t.strip() else t for t in texts]

    def translate_html(self, html: str) -> str:
        """Translate HTML content, preserving all structure.

        Uses chunked mode: extract text nodes, translate individually, reinsert.
        This guarantees HTML structure is preserved regardless of LLM output.
        """
        if not html or not html.strip():
            return html
        return self._translate_html_chunked(html)

    def _translate_html_chunked(self, html: str) -> str:
        """Extract text nodes, translate individually, reinsert into HTML."""
        from app.utils.html_processor import extract_text_nodes, replace_text_nodes

        nodes = extract_text_nodes(html)
        if not nodes:
            return html

        unique_texts = list({n["text"] for n in nodes})
        translations = {}

        for text in unique_texts:
            # Skip non-translatable text entirely
            if self._should_skip(text):
                translations[text] = text
                continue

            # Protect leading/trailing punctuation from LLM mangling.
            # E.g. ": the AI application" → prefix=": ", body="the AI application"
            prefix = suffix = ""
            body = text

            m_lead = _LEADING_PUNCT.match(body)
            if m_lead:
                prefix = m_lead.group(1)
                body = body[len(prefix):]

            m_trail = _TRAILING_PUNCT.search(body)
            if m_trail:
                suffix = m_trail.group(1)
                body = body[:m_trail.start()]

            # Translate the body if it still has translatable content
            if body and not self._should_skip(body):
                translated_body = self.translate(body)
                translations[text] = prefix + translated_body + suffix
            else:
                translations[text] = text

        return replace_text_nodes(html, translations)
