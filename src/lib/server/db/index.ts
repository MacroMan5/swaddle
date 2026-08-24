import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations';

const DATA_DIR = process.env.DATA_DIR ?? 'data';

export function openDb(path = `${DATA_DIR}/swaddle.db`): Database.Database {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db);
	return db;
}

let instance: Database.Database | undefined;

export function getDb(): Database.Database {
	instance ??= openDb();
	return instance;
}
