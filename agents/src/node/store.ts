import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChangeSet } from '../core/domain.ts';
import type { Store } from '../core/ports.ts';

/** Change sets in one SQLite table, in order. The mindstorm is rebuilt from them at start. */
export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS change_sets (seq INTEGER PRIMARY KEY, id TEXT NOT NULL, at TEXT NOT NULL, json TEXT NOT NULL)');
  }

  append(set: ChangeSet): void {
    this.db.prepare('INSERT INTO change_sets (seq, id, at, json) VALUES (?, ?, ?, ?)').run(set.seq, set.id, set.at, JSON.stringify(set));
  }

  all(): ChangeSet[] {
    return this.db
      .prepare('SELECT json FROM change_sets ORDER BY seq')
      .all()
      .map((row) => JSON.parse((row as { json: string }).json) as ChangeSet);
  }

  close(): void {
    this.db.close();
  }
}
