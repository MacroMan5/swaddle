import type Database from 'better-sqlite3';

export function isSetupComplete(db: Database.Database): boolean {
	const babies = db.prepare('SELECT COUNT(*) AS n FROM baby').get() as { n: number };
	const caregivers = db.prepare('SELECT COUNT(*) AS n FROM caregiver').get() as { n: number };
	return babies.n > 0 && caregivers.n > 0;
}
