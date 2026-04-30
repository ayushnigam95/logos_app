/**
 * Confluence REST client — ported from backend/app/services/confluence.py.
 *
 * Uses Node's built-in fetch with a manually managed Cookie header (cookies
 * captured from the SAML Playwright session).
 */

import type { CookieJar } from '../types';

export class ConfluenceClient {
  readonly baseUrl: string;
  readonly apiBase: string;
  private readonly cookieHeader: string;

  constructor(baseUrl: string, cookies: CookieJar[]) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiBase = `${this.baseUrl}/rest/api`;
    this.cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  private async getJson(url: string): Promise<any> {
    const resp = await fetch(url, {
      headers: {
        Cookie: this.cookieHeader,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) {
      throw new Error(`Confluence GET ${url} → ${resp.status} ${resp.statusText}`);
    }
    return resp.json();
  }

  async getPage(pageId: string): Promise<any> {
    const params = new URLSearchParams({
      expand: 'body.storage,space,ancestors,version,children.page',
    });
    return this.getJson(`${this.apiBase}/content/${pageId}?${params}`);
  }

  async getPageByTitle(spaceKey: string, title: string): Promise<any | null> {
    const params = new URLSearchParams({
      spaceKey,
      title,
      expand: 'body.storage,space,ancestors,version,children.page',
    });
    const data = await this.getJson(`${this.apiBase}/content?${params}`);
    const results = data.results ?? [];
    return results[0] ?? null;
  }

  async getChildPages(pageId: string, limit = 25, start = 0): Promise<any> {
    const params = new URLSearchParams({
      expand: 'body.storage,children.page',
      limit: String(limit),
      start: String(start),
    });
    return this.getJson(`${this.apiBase}/content/${pageId}/child/page?${params}`);
  }

  /** Yield every child page (handles pagination). */
  async *iterAllChildPages(pageId: string): AsyncGenerator<any> {
    let start = 0;
    const limit = 25;
    while (true) {
      const data = await this.getChildPages(pageId, limit, start);
      const results: any[] = data.results ?? [];
      for (const page of results) yield page;
      const size: number = data.size ?? 0;
      if (size < limit) break;
      start += limit;
    }
  }

  async getPageAttachments(pageId: string): Promise<any[]> {
    const params = new URLSearchParams({ limit: '100' });
    const data = await this.getJson(
      `${this.apiBase}/content/${pageId}/child/attachment?${params}`,
    );
    return data.results ?? [];
  }

  async getAttachment(pageId: string, filename: string): Promise<Uint8Array | null> {
    const params = new URLSearchParams({ filename });
    const data = await this.getJson(
      `${this.apiBase}/content/${pageId}/child/attachment?${params}`,
    );
    const results: any[] = data.results ?? [];
    if (!results.length) return null;
    const downloadLink: string = results[0]?._links?.download ?? '';
    if (!downloadLink) return null;

    const dlUrl = this.baseUrl + downloadLink;
    const resp = await fetch(dlUrl, { headers: { Cookie: this.cookieHeader } });
    if (!resp.ok) {
      throw new Error(`Attachment download failed: ${resp.status}`);
    }
    return new Uint8Array(await resp.arrayBuffer());
  }
}
