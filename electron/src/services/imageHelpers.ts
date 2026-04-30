/**
 * Image helpers — combines what Python had spread across pages.py and export.py:
 *   - convertConfluenceImages: ac:image → <img>
 *   - rewriteImageUrlsForViewer: rewrite <img src> through our custom protocol
 *   - embedImagesAsBase64: download with auth, replace src with data: URIs
 *   - fetchAuthenticatedImage: shared download for protocol handler & embed
 */

import * as cheerio from 'cheerio';
import type { CookieJar } from '../types';

function escapeNs(s: string): string {
  return s.replace(/:/g, '\\:');
}

function cookieHeader(cookies: CookieJar[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** Convert ac:image macros (with ri:attachment / ri:url) to standard <img> tags. */
export function convertConfluenceImages(
  html: string,
  jobId: string,
  pageId: string,
  baseUrl: string,
): string {
  if (!html.includes('ac:image') && !html.includes('ri:attachment')) return html;
  const $ = cheerio.load(html, { xmlMode: true });
  let changed = false;

  $(escapeNs('ac:image')).each((_, acImg) => {
    const $acImg = $(acImg);
    const riAttach = $acImg.find(escapeNs('ri:attachment')).first();
    if (riAttach.length) {
      const filename = riAttach.attr('ri:filename') ?? '';
      if (filename) {
        const cleanBase = baseUrl.replace(/\/+$/, '');
        const src = cleanBase
          ? `${cleanBase}/download/attachments/${pageId}/${filename}`
          : `/download/attachments/${pageId}/${filename}`;
        const img = $('<img>').attr('src', src).attr('alt', filename);
        const w = $acImg.attr('ac:width');
        const h = $acImg.attr('ac:height');
        if (w) img.attr('width', w);
        if (h) img.attr('height', h);
        $acImg.replaceWith(img);
        changed = true;
        return;
      }
    }
    const riUrl = $acImg.find(escapeNs('ri:url')).first();
    if (riUrl.length) {
      const url = riUrl.attr('ri:value') ?? '';
      if (url) {
        const img = $('<img>').attr('src', url).attr('alt', '');
        const w = $acImg.attr('ac:width');
        const h = $acImg.attr('ac:height');
        if (w) img.attr('width', w);
        if (h) img.attr('height', h);
        $acImg.replaceWith(img);
        changed = true;
      }
    }
  });

  return changed ? ($.root().html() ?? html) : html;
}

/**
 * Rewrite <img src> URLs to go through the custom `logos-image://<jobId>/...` protocol
 * registered in main.ts. The renderer can then load images without needing
 * a separate HTTP proxy.
 */
export function rewriteImageUrlsForViewer(html: string, jobId: string): string {
  return html.replace(
    /(src=["'])([^"']+)(["'])/g,
    (full, prefix: string, url: string, suffix: string) => {
      if (url.startsWith('data:')) return full;
      if (url.startsWith('logos-image://')) return full;
      // Encode the original URL so we can recover it in the protocol handler.
      const proxied = `logos-image://${jobId}/${encodeURIComponent(url)}`;
      return `${prefix}${proxied}${suffix}`;
    },
  );
}

/**
 * Fetch a single image with the job's auth cookies. Returns raw bytes + content-type.
 * Used by both the custom protocol handler and the PDF base64-embed path.
 */
export async function fetchAuthenticatedImage(
  url: string,
  baseUrl: string,
  cookies: CookieJar[],
): Promise<{ bytes: Buffer; contentType: string } | null> {
  let fullUrl: string;
  if (url.startsWith('http')) {
    fullUrl = url;
  } else if (url.startsWith('/')) {
    fullUrl = baseUrl.replace(/\/+$/, '') + url;
  } else {
    fullUrl = baseUrl.replace(/\/+$/, '') + '/' + url;
  }

  // Block cross-origin fetches.
  try {
    const target = new URL(fullUrl);
    const base = new URL(baseUrl);
    if (target.hostname !== base.hostname) return null;
  } catch {
    return null;
  }

  try {
    const resp = await fetch(fullUrl, {
      headers: { Cookie: cookieHeader(cookies) },
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type')?.split(';')[0].trim() ?? 'image/png';
    const bytes = Buffer.from(await resp.arrayBuffer());
    return { bytes, contentType };
  } catch (e) {
    console.warn('[image] fetch failed for', fullUrl, e);
    return null;
  }
}

/** Embed every <img src> as a base64 data URI for offline rendering (PDF). */
export async function embedImagesAsBase64(
  html: string,
  baseUrl: string,
  cookies: CookieJar[],
): Promise<string> {
  const matches = [...html.matchAll(/(src=["'])([^"']+)(["'])/g)];
  if (!matches.length) return html;

  const uniqueUrls = Array.from(
    new Set(
      matches
        .map((m) => m[2])
        .filter((u) => !u.startsWith('data:') && !u.startsWith('logos-image://')),
    ),
  );

  const results = await Promise.all(
    uniqueUrls.map(async (u) => {
      const r = await fetchAuthenticatedImage(u, baseUrl, cookies);
      if (!r) return [u, null] as const;
      const b64 = r.bytes.toString('base64');
      return [u, `data:${r.contentType};base64,${b64}`] as const;
    }),
  );
  const map = new Map(results.filter(([, v]) => v) as [string, string][]);

  return html.replace(
    /(src=["'])([^"']+)(["'])/g,
    (full, prefix, url, suffix) => {
      const data = map.get(url);
      return data ? `${prefix}${data}${suffix}` : full;
    },
  );
}
