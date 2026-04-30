/**
 * Translation cache — ported from backend/app/services/cache.py.
 *
 * Uses better-sqlite3 (synchronous, fast). The cache key is a SHA-256 of
 * "{provider}:{targetLang}:{text}", matching the Python implementation so
 * existing cache databases can be reused.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Database, { Database as SqliteDatabase } from 'better-sqlite3';
import { settings } from '../config';

export class TranslationCache {
  private db: SqliteDatabase | null = null;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? settings.cacheDbPath;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
  }

  initialize(): void {
    if (this.db) return;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS translation_cache (
        content_hash TEXT PRIMARY KEY,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        target_language TEXT NOT NULL,
        provider TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cache_lang_provider
        ON translation_cache(target_language, provider);
    `);
  }

  private hash(text: string, targetLang: string, provider: string): string {
    return crypto
      .createHash('sha256')
      .update(`${provider}:${targetLang}:${text}`)
      .digest('hex');
  }

  get(text: string, targetLang: string, provider: string): string | null {
    if (!this.db) this.initialize();
    const row = this.db!
      .prepare('SELECT translated_text FROM translation_cache WHERE content_hash = ?')
      .get(this.hash(text, targetLang, provider)) as { translated_text: string } | undefined;
    return row?.translated_text ?? null;
  }

  put(text: string, translated: string, targetLang: string, provider: string): void {
    if (!this.db) this.initialize();
    this.db!
      .prepare(
        `INSERT OR REPLACE INTO translation_cache
         (content_hash, source_text, translated_text, target_language, provider)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(this.hash(text, targetLang, provider), text, translated, targetLang, provider);
  }

  getBatch(
    texts: string[],
    targetLang: string,
    provider: string,
  ): Record<string, string | null> {
    if (!this.db) this.initialize();
    const stmt = this.db!.prepare(
      'SELECT translated_text FROM translation_cache WHERE content_hash = ?',
    );
    const out: Record<string, string | null> = {};
    for (const text of texts) {
      const row = stmt.get(this.hash(text, targetLang, provider)) as
        | { translated_text: string }
        | undefined;
      out[text] = row?.translated_text ?? null;
    }
    return out;
  }

  clear(): void {
    if (!this.db) this.initialize();
    this.db!.prepare('DELETE FROM translation_cache').run();
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
