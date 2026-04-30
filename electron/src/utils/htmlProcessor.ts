/**
 * HTML text-node extractor — ported from backend/app/utils/html_processor.py.
 *
 * Operates on Confluence storage-format HTML, so we use cheerio in xmlMode
 * to preserve namespaced tags (ac:, ri:) and self-closing semantics.
 */

import * as cheerio from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';

/** Tags whose text content should never be translated. */
const SKIP_TAGS = new Set([
  'code',
  'pre',
  'script',
  'style',
  'kbd',
  'samp',
  'var',
  'svg',
  'math',
]);

function isText(node: AnyNode): node is Text {
  return node.type === 'text';
}

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

export interface TextNode {
  /** The original (un-stripped) text content. */
  raw: string;
  /** Stripped text used as the translation key. */
  text: string;
}

/**
 * Extract all translatable text nodes from HTML.
 * Returns the unique stripped strings (preserves first-seen order).
 */
export function extractTextNodes(html: string): TextNode[] {
  if (!html || !html.trim()) return [];
  const $ = cheerio.load(html, { xmlMode: true });

  const out: TextNode[] = [];
  const walk = (nodes: AnyNode[], skip: boolean) => {
    for (const n of nodes) {
      if (isText(n)) {
        const raw = n.data ?? '';
        const text = raw.trim();
        if (text && !skip) {
          out.push({ raw, text });
        }
        continue;
      }
      if (isElement(n)) {
        const tagName = (n.name ?? '').toLowerCase();
        const childSkip = skip || SKIP_TAGS.has(tagName);
        walk(n.children as AnyNode[], childSkip);
      }
    }
  };
  walk($.root().children().toArray() as AnyNode[], false);
  return out;
}

/**
 * Replace text nodes in HTML with translated versions.
 * `translations` maps the *stripped* original text → translated text.
 * Leading / trailing whitespace from each original node is preserved.
 */
export function replaceTextNodes(
  html: string,
  translations: Record<string, string>,
): string {
  if (!html || !html.trim()) return html;
  const $ = cheerio.load(html, { xmlMode: true });

  const walk = (nodes: AnyNode[], skip: boolean) => {
    for (const n of nodes) {
      if (isText(n)) {
        if (skip) continue;
        const raw = n.data ?? '';
        const text = raw.trim();
        if (!text) continue;
        const translated = translations[text];
        if (translated === undefined) continue;
        const leading = raw.slice(0, raw.length - raw.trimStart().length);
        const trailing = raw.slice(raw.trimEnd().length);
        n.data = leading + translated + trailing;
        continue;
      }
      if (isElement(n)) {
        const tagName = (n.name ?? '').toLowerCase();
        const childSkip = skip || SKIP_TAGS.has(tagName);
        walk(n.children as AnyNode[], childSkip);
      }
    }
  };
  walk($.root().children().toArray() as AnyNode[], false);

  return $.root().html() ?? html;
}

/** Extract all <img> src and <ac:image> attachment references. */
export function extractImageUrls(html: string, baseUrl = ''): string[] {
  if (!html) return [];
  const $ = cheerio.load(html, { xmlMode: true });
  const urls: string[] = [];

  $('img').each((_, el) => {
    let src = $(el).attr('src') ?? '';
    if (!src) return;
    if (src.startsWith('/') && baseUrl) {
      src = baseUrl.replace(/\/+$/, '') + src;
    }
    urls.push(src);
  });

  $('ac\\:image').each((_, el) => {
    const ri = $(el).find('ri\\:attachment').first();
    const filename = ri.attr('ri:filename');
    if (filename) urls.push(`attachment:${filename}`);
  });

  return urls;
}
