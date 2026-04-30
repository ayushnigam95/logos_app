/**
 * URL parser — ported 1:1 from backend/app/utils/url_parser.py.
 *
 * Supports:
 *  - Cloud:  https://company.atlassian.net/wiki/spaces/SPACE/pages/12345/Page+Title
 *  - DC:     https://confluence.company.com/spaces/SPACE/pages/12345/Title
 *  - Server: https://confluence.company.com/display/SPACE/Page+Title
 *  - Server: https://confluence.company.com/pages/viewpage.action?pageId=12345
 */

export interface ParsedConfluenceUrl {
  baseUrl: string;
  spaceKey: string | null;
  pageId: string | null;
  pageTitle: string | null;
}

export function parseConfluenceUrl(rawUrl: string): ParsedConfluenceUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Could not parse Confluence URL: ${rawUrl}`);
  }

  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  const path = decodeURIComponent(parsed.pathname);

  const result: ParsedConfluenceUrl = {
    baseUrl,
    spaceKey: null,
    pageId: null,
    pageTitle: null,
  };

  // Cloud: /wiki/spaces/SPACE/pages/12345/Title
  const cloud = /^\/wiki\/spaces\/([^/]+)\/pages\/(\d+)(?:\/(.+))?/.exec(path);
  if (cloud) {
    result.baseUrl = `${baseUrl}/wiki`;
    result.spaceKey = cloud[1];
    result.pageId = cloud[2];
    result.pageTitle = cloud[3] ?? null;
    return result;
  }

  // Data Center: /spaces/SPACE/pages/12345/Title
  const dc = /^\/spaces\/([^/]+)\/pages\/(\d+)(?:\/(.+))?/.exec(path);
  if (dc) {
    result.spaceKey = dc[1];
    result.pageId = dc[2];
    result.pageTitle = dc[3] ?? null;
    return result;
  }

  // Server: /display/SPACE/Title
  const display = /^\/display\/([^/]+)\/(.+)/.exec(path);
  if (display) {
    result.spaceKey = display[1];
    result.pageTitle = display[2];
    return result;
  }

  // Server: /pages/viewpage.action?pageId=12345
  if (path.includes('viewpage.action')) {
    const pageId = parsed.searchParams.get('pageId');
    if (pageId) {
      result.pageId = pageId;
      return result;
    }
  }

  throw new Error(`Could not parse Confluence URL: ${rawUrl}`);
}
