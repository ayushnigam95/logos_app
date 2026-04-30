/**
 * LLM helpers — page summary, important notes, and vision image analysis.
 * Ported from backend/app/routers/pages.py (the summary/notes/analyze-image bits).
 */

import * as cheerio from 'cheerio';
import { TranslationService } from './translator';
import { settings } from '../config';
import type { CookieJar } from '../types';
import { fetchAuthenticatedImage } from './imageHelpers';

function htmlToPlainText(html: string): string {
  const $ = cheerio.load(html);
  // Convert to text with newlines between blocks (cheerio's .text() returns inline text,
  // matching BeautifulSoup's default `separator='\n'` requires manual handling).
  const lines: string[] = [];
  $('body, body *').each((_, el) => {
    const tag = el.type === 'tag' ? el.name : '';
    if (
      ['script', 'style'].includes(tag)
    ) return;
  });
  // Use BFS across text nodes, separating by newlines.
  const walk = (nodes: any[]): void => {
    for (const n of nodes) {
      if (n.type === 'text') {
        const t = (n.data ?? '').trim();
        if (t) lines.push(t);
      } else if (n.type === 'tag') {
        if (['script', 'style'].includes(n.name)) continue;
        walk(n.children ?? []);
      }
    }
  };
  walk($.root().children().toArray());
  return lines.join('\n').trim();
}

function stripFormatting(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\w)`([^`]+)`(?!\w)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

function extractPageText(html: string): string {
  const text = htmlToPlainText(html);
  if (!text) return '';
  return text.length > 8000 ? text.slice(0, 8000) + '...' : text;
}

async function llmGenerate(
  translator: TranslationService,
  systemPrompt: string,
  userText: string,
  maxTokens: number,
): Promise<string> {
  try {
    const response = await translator.rawClient.chat.completions.create({
      model: translator.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    });
    const raw = (response.choices[0]?.message?.content ?? '').trim();
    return stripFormatting(raw) || 'Could not generate content.';
  } catch (e) {
    console.error('[llm] generation failed:', e);
    return `Failed to generate content: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function generatePageSummary(html: string, targetLanguage: string): Promise<string> {
  const text = extractPageText(html);
  if (!text) return 'This page has no text content.';
  const translator = new TranslationService(targetLanguage);
  return llmGenerate(
    translator,
    'You are a technical writer. Summarize the following page content ' +
      'in 3-5 concise bullet points. Focus on the key topics, decisions, ' +
      'and actionable information. Return only the bullet points, no preamble. ' +
      'Use plain text only. Do NOT use markdown formatting: no **, no *, no `, no #. ' +
      'Use simple dashes (-) for bullet points.',
    text,
    512,
  );
}

export async function generatePageNotes(html: string, targetLanguage: string): Promise<string> {
  const text = extractPageText(html);
  if (!text) return 'This page has no text content.';
  const translator = new TranslationService(targetLanguage);
  return llmGenerate(
    translator,
    'You are a technical analyst. Extract the most important notes from the following page content. ' +
      'Focus on: key decisions, important configurations, critical warnings, dependencies, ' +
      'and actionable takeaways. Format as a numbered list of concise notes. ' +
      'Return only the notes, no preamble or commentary. ' +
      'Use plain text only. Do NOT use markdown formatting: no **, no *, no `, no #. ' +
      'Write emphasis in plain words, not with formatting markers.',
    text,
    1024,
  );
}

export interface ImageChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnalyzeImageInput {
  url: string;
  baseUrl: string;
  cookies: CookieJar[];
  question?: string;
  history?: ImageChatTurn[];
}

const DEFAULT_VISION_QUESTION =
  'Describe this image in detail. If it is a diagram, explain its structure, ' +
  'components, and relationships. If it contains text, transcribe the key text. ' +
  'Be concise and use plain text (no markdown).';

export async function analyzeImage(
  input: AnalyzeImageInput,
): Promise<{ analysis: string; model: string }> {
  // Resolve a logos-image://<jobId>/<encoded-url> back to original.
  let url = input.url;
  if (url.startsWith('logos-image://')) {
    const m = /logos-image:\/\/[^/]+\/(.+)/.exec(url);
    if (m) url = decodeURIComponent(m[1]);
  }

  const fetched = await fetchAuthenticatedImage(url, input.baseUrl, input.cookies);
  if (!fetched) throw new Error('Failed to fetch image');

  const dataUrl = `data:${fetched.contentType};base64,${fetched.bytes.toString('base64')}`;
  const visionModel = settings.llmVisionModel || settings.llmModel;
  const question = input.question || DEFAULT_VISION_QUESTION;

  const messages: any[] = [
    {
      role: 'system',
      content:
        'You are a helpful assistant analyzing an image the user shared. ' +
        'Answer questions about it directly. Use plain text only — no markdown formatting.',
    },
  ];

  const history = input.history ?? [];
  if (history.length) {
    let firstUserSeen = false;
    for (const turn of history) {
      if (turn.role !== 'user' && turn.role !== 'assistant') continue;
      if (typeof turn.content !== 'string') continue;
      if (turn.role === 'user' && !firstUserSeen) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: turn.content },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        });
        firstUserSeen = true;
      } else {
        messages.push({ role: turn.role, content: turn.content });
      }
    }
    if (!firstUserSeen) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      });
    }
  } else {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: question },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    });
  }

  const translator = new TranslationService();
  try {
    const response = await translator.rawClient.chat.completions.create({
      model: visionModel,
      messages,
      temperature: 0.2,
      max_tokens: 800,
    });
    let content = (response.choices[0]?.message?.content ?? '').trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!content) content = 'The vision model returned no description.';
    return { analysis: content, model: visionModel };
  } catch (e) {
    console.error('[llm] vision analysis failed:', e);
    throw new Error(
      `Vision analysis failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
