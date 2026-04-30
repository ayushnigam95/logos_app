/**
 * Page-tree crawler — ported from backend/app/services/crawler.py.
 *
 * Uses a simple semaphore (max concurrent fetches) and recursively walks
 * /child/page until either max depth is hit or the tree is exhausted.
 */

import type { PageData } from '../types';
import { ConfluenceClient } from './confluence';

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export type OnPageFound = (title: string, total: number) => void | Promise<void>;

export class PageTreeCrawler {
  private readonly semaphore: Semaphore;
  totalPagesFound = 0;

  constructor(
    private readonly client: ConfluenceClient,
    private readonly maxDepth: number = -1,
    maxConcurrent: number = 5,
    private readonly onPageFound?: OnPageFound,
  ) {
    this.semaphore = new Semaphore(maxConcurrent);
  }

  async crawl(pageId: string, depth = 0): Promise<PageData> {
    let pageData: PageData;
    await this.semaphore.acquire();
    try {
      console.info(`[crawler] Crawling page ${pageId} (depth=${depth})`);
      pageData = await this.fetchPage(pageId, depth);
      this.totalPagesFound += 1;
      if (this.onPageFound) {
        await this.onPageFound(pageData.title, this.totalPagesFound);
      }
    } finally {
      this.semaphore.release();
    }

    if (this.maxDepth !== -1 && depth >= this.maxDepth) {
      return pageData;
    }

    const childTasks: Array<Promise<PageData | Error>> = [];
    for await (const childRaw of this.client.iterAllChildPages(pageId)) {
      const childId = String(childRaw.id);
      childTasks.push(
        this.crawl(childId, depth + 1).catch((e: Error) => e),
      );
    }

    if (childTasks.length) {
      const results = await Promise.all(childTasks);
      for (const res of results) {
        if (res instanceof Error) {
          console.error(`[crawler] Failed to crawl child of ${pageId}:`, res);
        } else {
          res.parentId = pageId;
          pageData.children.push(res);
        }
      }
    }
    return pageData;
  }

  private async fetchPage(pageId: string, depth: number): Promise<PageData> {
    const raw = await this.client.getPage(pageId);
    const bodyHtml: string = raw?.body?.storage?.value ?? '';
    const spaceKey: string = raw?.space?.key ?? '';
    const title: string = raw?.title ?? 'Untitled';
    const baseLink: string = raw?._links?.base ?? '';
    const webLink: string = raw?._links?.webui ?? '';
    const url = baseLink && webLink ? baseLink + webLink : '';

    return {
      pageId: String(raw.id),
      title,
      spaceKey,
      bodyHtml,
      url,
      depth,
      children: [],
    };
  }
}

export function countPages(page: PageData): number {
  let count = 1;
  for (const child of page.children) count += countPages(child);
  return count;
}

export function flattenPages(page: PageData): PageData[] {
  const out = [page];
  for (const child of page.children) out.push(...flattenPages(child));
  return out;
}
