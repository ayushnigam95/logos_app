/**
 * SAML authenticator — ported from backend/app/services/auth.py.
 *
 * Flow:
 *  1. First run:    headed Chromium → user completes SAML manually.
 *  2. Cookies are persisted to settings.browserSessionDir.
 *  3. Subsequent runs reuse the saved profile (headless attempt first).
 *  4. If the saved session is expired, falls back to a headed login.
 */

import * as fs from 'fs';
import { chromium, BrowserContext } from 'playwright';
import { settings } from '../config';
import type { CookieJar } from '../types';

const LOGIN_KEYWORDS = ['login', 'sso', 'saml', 'auth', 'signin'];

export class SamlAuthenticator {
  private readonly baseUrl: string;
  private readonly sessionDir: string;
  private context: BrowserContext | null = null;

  constructor(confluenceBaseUrl?: string) {
    const url = (confluenceBaseUrl ?? settings.confluenceBaseUrl).replace(/\/+$/, '');
    this.baseUrl = url;
    this.sessionDir = settings.browserSessionDir;
    fs.mkdirSync(this.sessionDir, { recursive: true });
  }

  /**
   * Authenticate with Confluence via SAML.
   *
   * If headless=true and a saved session exists, will attempt a silent re-auth
   * and fall back to a headed login on failure.
   */
  async authenticate(headless: boolean = false): Promise<CookieJar[]> {
    if (headless && this.sessionExists()) {
      const cookies = await this.trySavedSession();
      if (cookies) return cookies;
      console.info('[auth] Saved session expired, falling back to headed login');
    }
    return this.interactiveLogin();
  }

  private wikiUrl(): string {
    return this.baseUrl.endsWith('/wiki') ? this.baseUrl : `${this.baseUrl}/wiki`;
  }

  private async trySavedSession(): Promise<CookieJar[] | null> {
    try {
      this.context = await chromium.launchPersistentContext(this.sessionDir, {
        headless: true,
      });
      const page = this.context.pages()[0] ?? (await this.context.newPage());

      await page.goto(this.wikiUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      const currentUrl = page.url().toLowerCase();
      if (LOGIN_KEYWORDS.some((kw) => currentUrl.includes(kw))) {
        await this.context.close();
        this.context = null;
        return null;
      }

      const cookies = await this.context.cookies();
      await this.context.close();
      this.context = null;
      return cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? '/',
      }));
    } catch (err) {
      console.warn('[auth] Failed to reuse saved session:', err);
      if (this.context) {
        await this.context.close().catch(() => {});
        this.context = null;
      }
      return null;
    }
  }

  private async interactiveLogin(): Promise<CookieJar[]> {
    console.info('[auth] Opening browser for SAML login...');

    this.context = await chromium.launchPersistentContext(this.sessionDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
    });
    const page = this.context.pages()[0] ?? (await this.context.newPage());

    await page.goto(this.wikiUrl(), { waitUntil: 'domcontentloaded' });

    console.info('[auth] Waiting for SAML login (up to 120s)...');
    try {
      await page.waitForFunction(
        (kw: string[]) => {
          const u = window.location.href.toLowerCase();
          return !kw.some((k) => u.includes(k));
        },
        LOGIN_KEYWORDS,
        { timeout: 120_000 },
      );
    } catch {
      // Fallback: wait for a confluence shell selector
      await page.waitForSelector(
        '[data-testid="app-navigation"], #com-atlassian-confluence, .wiki-content, #main-content',
        { timeout: 60_000 },
      );
    }

    await page.waitForTimeout(2000);
    const cookies = await this.context.cookies();
    console.info(`[auth] Login successful. Captured ${cookies.length} cookies.`);
    await this.context.close();
    this.context = null;

    return cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
    }));
  }

  private sessionExists(): boolean {
    return (
      fs.existsSync(`${this.sessionDir}/Default`) ||
      fs.existsSync(`${this.sessionDir}/Cookies`)
    );
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
  }
}
