import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { RepoError } from '$lib/server/events/repo';
import { QuickError } from './errors';
import { normalizeWord } from './phrase';
import { quickWordIntentSchema, type QuickWord, type QuickWordIntent } from './types';

type DB = Database.Database;

function rowToWord(row: { id: string; word: string; intent: string }): QuickWord {
	return {
		id: row.id,
		word: row.word,
		// Rows come from the seed, from this module, or from a restored export
		// (validated on the way in): anything else is a corrupted database, and a
		// throw is the right answer to that.
		intent: quickWordIntentSchema.parse(JSON.parse(row.intent))
	};
}

export function listQuickWords(db: DB): QuickWord[] {
	return (
		db.prepare('SELECT id, word, intent FROM quick_word ORDER BY word').all() as {
			id: string;
			word: string;
			intent: string;
		}[]
	).map(rowToWord);
}

/**
 * Adds a synonym. The word is normalised first, so « Nini » and "nini" are the
 * same entry — and the duplicate is refused here rather than left to the unique
 * index, whose constraint error the route would map to something meaningless.
 */
export function addQuickWord(db: DB, input: { word: string; intent: QuickWordIntent }): QuickWord {
	const word = normalizeWord(input.word);
	if (word === '')
		throw new RepoError('validation_failed', 'a vocabulary word cannot be empty', [
			{ path: 'word', code: 'too_small', message: 'a vocabulary word cannot be empty' }
		]);
	// A trigger word is matched whole against one spoken word; a two-word entry
	// could never match, so it is refused instead of silently never firing.
	if (/\s/.test(word))
		throw new RepoError('validation_failed', 'a vocabulary word must be a single word', [
			{ path: 'word', code: 'custom', message: 'a vocabulary word must be a single word' }
		]);

	const existing = db.prepare('SELECT id FROM quick_word WHERE word = ?').get(word);
	if (existing) throw new QuickError('duplicate_word', `the word ${word} is already used`);

	const id = randomUUID();
	db.prepare('INSERT INTO quick_word (id, word, intent) VALUES (?, ?, ?)').run(
		id,
		word,
		JSON.stringify(input.intent)
	);
	return { id, word, intent: input.intent };
}

export function deleteQuickWord(db: DB, id: string): void {
	const result = db.prepare('DELETE FROM quick_word WHERE id = ?').run(id);
	if (result.changes === 0) throw new RepoError('not_found', `no quick word ${id}`);
}
