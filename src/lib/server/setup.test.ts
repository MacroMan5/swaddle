import { describe, it, expect } from 'vitest';
import { openDb } from './db';
import { isSetupComplete } from './setup';

describe('isSetupComplete', () => {
	it('is false on an empty database', () => {
		const db = openDb(':memory:');
		expect(isSetupComplete(db)).toBe(false);
	});

	it('is true once a baby and a caregiver exist', () => {
		const db = openDb(':memory:');
		const now = new Date().toISOString();
		db.prepare(
			'INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES (?, ?, ?, ?, ?)'
		).run('b1', 'Léa', '2026-08-01', 'America/Toronto', now);
		expect(isSetupComplete(db)).toBe(false);
		db.prepare('INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
			'c1',
			'Émile',
			'#4f46e5',
			now
		);
		expect(isSetupComplete(db)).toBe(true);
	});
});
