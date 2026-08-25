import { rmSync } from 'node:fs';
// Relative import: $lib aliases do not resolve in Playwright setup files.
import { openDb } from '../../src/lib/server/db';

// Playwright runs this before starting the webServer: wipe the data dir from
// previous runs and seed the baby/caregiver every API test relies on.
export default function globalSetup(): void {
	rmSync('.playwright-data', { recursive: true, force: true });
	rmSync('.playwright-data-empty', { recursive: true, force: true });
	const db = openDb('.playwright-data/swaddle.db');
	const now = new Date().toISOString();
	db.prepare(
		'INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES (?, ?, ?, ?, ?)'
	).run('baby-1', 'Testine', '2026-08-01', 'America/Toronto', now);
	db.prepare('INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
		'cg-1',
		'Parent',
		'#4f8a8b',
		now
	);
	db.close();
}
