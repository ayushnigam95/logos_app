/**
 * Tiny .env loader (no external deps).
 *
 * Loaded at the very top of main.ts so settings.* picks up the values.
 * Search order (first hit wins per key, existing process.env wins over file):
 *   1. <appRoot>/.env
 *   2. <cwd>/.env
 *   3. <userData>/.env
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function applyFile(filePath: string, loaded: string[]): void {
  if (!fs.existsSync(filePath)) return;
  try {
    const parsed = parseEnv(fs.readFileSync(filePath, 'utf-8'));
    for (const [k, v] of Object.entries(parsed)) {
      // Don't override values already present in the real environment.
      if (process.env[k] === undefined || process.env[k] === '') {
        process.env[k] = v;
      }
    }
    loaded.push(filePath);
  } catch (e) {
    console.warn(`[env] Failed to load ${filePath}:`, e);
  }
}

export function loadDotEnv(): void {
  // app.getAppPath() points at the asar root in production, electron/dist in dev.
  // Walk up from there to find the project root that contains package.json.
  const candidates: string[] = [];

  const appPath = (() => {
    try {
      return app.getAppPath();
    } catch {
      return process.cwd();
    }
  })();

  // electron/dist → electron → project root
  const projectRoot = path.resolve(appPath, '..', '..');
  candidates.push(path.join(projectRoot, '.env'));

  // Also look next to the executable / cwd as a fallback.
  candidates.push(path.join(process.cwd(), '.env'));

  // User data dir — useful for packaged apps where the project layout doesn't exist.
  try {
    candidates.push(path.join(app.getPath('userData'), '.env'));
  } catch {
    /* app not ready */
  }

  const loaded: string[] = [];
  // De-duplicate.
  const seen = new Set<string>();
  for (const f of candidates) {
    if (seen.has(f)) continue;
    seen.add(f);
    applyFile(f, loaded);
  }

  if (loaded.length) {
    console.info(`[env] loaded: ${loaded.join(', ')}`);
  } else {
    console.info('[env] no .env file found; relying on process environment');
  }
}
