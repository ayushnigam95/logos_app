/**
 * Runtime config — ported from backend/app/config.py.
 *
 * In Electron we rely on environment variables (set by the user) and
 * sensible per-platform defaults rooted at app.getPath('userData').
 */

import { app } from 'electron';
import * as path from 'path';

function userDataDir(): string {
  // app may not be ready in some contexts (e.g. tests). Fall back to cwd.
  try {
    return app.getPath('userData');
  } catch {
    return process.cwd();
  }
}

export interface AppSettings {
  confluenceBaseUrl: string;

  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmVisionModel: string;
  targetLanguage: string;

  cacheDbPath: string;
  browserSessionDir: string;
  maxConcurrentPages: number;
}

function buildSettings(): AppSettings {
  const base = userDataDir();
  return {
    confluenceBaseUrl: process.env.CONFLUENCE_BASE_URL ?? '',

    llmApiKey: process.env.LLM_API_KEY ?? '',
    llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://models.inference.ai.azure.com',
    llmModel: process.env.LLM_MODEL ?? 'gpt-4o',
    llmVisionModel: process.env.LLM_VISION_MODEL ?? '',
    targetLanguage: process.env.TARGET_LANGUAGE ?? 'en',

    cacheDbPath: process.env.CACHE_DB_PATH ?? path.join(base, 'data', 'cache.db'),
    browserSessionDir:
      process.env.BROWSER_SESSION_DIR ?? path.join(base, 'browser_session'),
    maxConcurrentPages: Number(process.env.MAX_CONCURRENT_PAGES ?? 5),
  };
}

export const settings: AppSettings = buildSettings();
