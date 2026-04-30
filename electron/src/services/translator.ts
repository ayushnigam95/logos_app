/**
 * Translation service — ported from backend/app/services/translator.py.
 *
 * Uses an OpenAI-compatible chat completions endpoint (configured via
 * settings.llm{ApiKey,BaseUrl,Model}). Preserves Python behavior:
 *  - skip rule for non-translatable text (URLs, emails, pure punctuation)
 *  - leading numbered prefix protection ("2. Title" → "2. " + title)
 *  - leading/trailing punctuation protection in HTML chunked mode
 *  - markdown stripping (** and # only — leaves bullets/italic intact)
 *  - HTML-aware translation via extractTextNodes / replaceTextNodes
 */

import OpenAI from 'openai';
import { settings } from '../config';
import { extractTextNodes, replaceTextNodes } from '../utils/htmlProcessor';

const TRANSLATE_SYSTEM_PROMPT = (lang: string): string =>
  `You are a professional translator. Translate the given text to ${lang}.\n` +
  `Rules:\n` +
  `- Return ONLY the translated text, nothing else\n` +
  `- No explanations, notes, preamble, or commentary\n` +
  `- Do NOT add any markdown formatting: no **, no *, no #, no -, no numbered lists\n` +
  `- Do NOT wrap text in bold, italic, or any other formatting markers\n` +
  `- Return plain text only — the text will be placed back into its original HTML context\n` +
  `- Preserve ALL punctuation exactly as in the original: colons, semicolons, periods, commas, dashes, parentheses, brackets\n` +
  `- If the text is already in ${lang}, return it exactly as-is with zero changes\n` +
  `- Do NOT translate: code, variable names, URLs, email addresses, brand names, product names, acronyms\n` +
  `- Do NOT say things like 'The text is already in English' or 'Here is the translation'\n` +
  `- NEVER add or remove punctuation marks\n` +
  `- Your response must contain ONLY the translated text`;

// Leading/trailing punctuation that LLMs tend to strip.
const LEADING_PUNCT = /^([:\;\-\u2013\u2014,.()[\]/\\|!?\u00bf\u00a1]+\s*)/;
const TRAILING_PUNCT = /(\s*[:\;\-\u2013\u2014,.()[\]/\\|!?\u00bf\u00a1]+)$/;

// Leading number prefix (e.g. "2. ", "3.1 ", "5. ") that LLMs tend to drop.
const LEADING_NUMBER = /^(\d+(?:\.\d+)*\.?\s+)/;

const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

function shouldSkip(text: string): boolean {
  const stripped = text.trim();
  if (!stripped) return true;
  if (stripped.length <= 1) return true;
  // No alphabetic characters — pure numbers/punctuation/symbols
  if (!/\p{L}/u.test(stripped)) return true;
  if (URL_RE.test(stripped)) return true;
  if (EMAIL_RE.test(stripped)) return true;
  return false;
}

export class TranslationService {
  readonly targetLanguage: string;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(targetLanguage: string = settings.targetLanguage) {
    this.targetLanguage = targetLanguage;
    this.model = settings.llmModel;
    this.client = new OpenAI({
      apiKey: settings.llmApiKey,
      baseURL: settings.llmBaseUrl,
    });
  }

  /** Expose underlying client for summary/notes/image-analysis (Phase 5). */
  get rawClient(): OpenAI {
    return this.client;
  }

  async translate(text: string): Promise<string> {
    if (!text || !text.trim()) return text;
    if (shouldSkip(text)) return text;

    // Preserve leading numbered prefix
    let numPrefix = '';
    let body = text;
    const m = LEADING_NUMBER.exec(body);
    if (m) {
      numPrefix = m[1];
      body = body.slice(numPrefix.length);
      if (!body.trim()) return text;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: TRANSLATE_SYSTEM_PROMPT(this.targetLanguage) },
          { role: 'user', content: body },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      });
      let result = response.choices[0]?.message?.content ?? '';
      if (result) {
        result = stripMarkdown(result.trim());
        // If LLM rambled, take the first non-empty line.
        if (result.length > body.length * 5 && body.length > 10) {
          console.warn(
            `[translator] LLM output ${(result.length / text.length).toFixed(1)}x ` +
              `longer than input (${text.length} chars), may contain commentary`,
          );
          const firstLine = result.split('\n')[0]?.trim();
          if (firstLine) result = firstLine;
        }
        // Strip number prefix the LLM might have re-added
        if (numPrefix && result) {
          const m2 = LEADING_NUMBER.exec(result);
          if (m2) result = result.slice(m2[1].length);
        }
      }
      return numPrefix + (result || body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[translator] LLM translation failed (${text.length} chars): ${msg}`);
      // Surface auth/connection problems instead of silently returning the
      // original text — otherwise the user sees the source language and
      // assumes translation "didn't run".
      if (/401|403|unauthorized|forbidden|invalid.*token/i.test(msg)) {
        throw new Error(
          `LLM authentication failed (${msg}). Check LLM_API_KEY / LLM_BASE_URL / LLM_MODEL.`,
        );
      }
      if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) {
        throw new Error(
          `LLM endpoint unreachable (${msg}). Is your LLM server running at ${settings.llmBaseUrl}?`,
        );
      }
      if (/404|not.found|model.*not.*found/i.test(msg)) {
        throw new Error(
          `LLM model not found (${msg}). Check LLM_MODEL — currently "${settings.llmModel}".`,
        );
      }
      return text;
    }
  }

  async translateBatch(texts: string[]): Promise<string[]> {
    return Promise.all(texts.map((t) => (t && t.trim() ? this.translate(t) : Promise.resolve(t))));
  }

  /**
   * Translate HTML by extracting unique text nodes, translating each
   * individually, and reinserting. Guarantees structural integrity.
   */
  async translateHtml(html: string): Promise<string> {
    if (!html || !html.trim()) return html;
    return this.translateHtmlChunked(html);
  }

  private async translateHtmlChunked(html: string): Promise<string> {
    const nodes = extractTextNodes(html);
    if (!nodes.length) return html;

    const uniqueTexts = Array.from(new Set(nodes.map((n) => n.text)));
    const translations: Record<string, string> = {};

    for (const text of uniqueTexts) {
      if (shouldSkip(text)) {
        translations[text] = text;
        continue;
      }

      // Strip leading/trailing punctuation so the LLM sees only the meaningful body.
      let prefix = '';
      let suffix = '';
      let body = text;

      const lead = LEADING_PUNCT.exec(body);
      if (lead) {
        prefix = lead[1];
        body = body.slice(prefix.length);
      }
      const trail = TRAILING_PUNCT.exec(body);
      if (trail) {
        suffix = trail[1];
        body = body.slice(0, body.length - suffix.length);
      }

      if (body && !shouldSkip(body)) {
        const translatedBody = await this.translate(body);
        translations[text] = prefix + translatedBody + suffix;
      } else {
        translations[text] = text;
      }
    }

    return replaceTextNodes(html, translations);
  }
}
