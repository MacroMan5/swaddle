import type Database from 'better-sqlite3';

// One entry per schema version. NEVER edit a published migration — append a new
// one instead (existing installations migrate based on user_version).
export const migrations: string[] = [
	`
	CREATE TABLE household (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		pin_hash TEXT,
		volume_unit TEXT NOT NULL DEFAULT 'ml' CHECK (volume_unit IN ('ml', 'oz')),
		theme TEXT NOT NULL DEFAULT 'auto' CHECK (theme IN ('light', 'dark', 'auto')),
		created_at TEXT NOT NULL
	);

	CREATE TABLE baby (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		birthdate TEXT NOT NULL,
		timezone TEXT NOT NULL,
		created_at TEXT NOT NULL
	);

	CREATE TABLE caregiver (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		color TEXT NOT NULL,
		created_at TEXT NOT NULL
	);

	CREATE TABLE event (
		id TEXT PRIMARY KEY,
		baby_id TEXT NOT NULL REFERENCES baby (id),
		caregiver_id TEXT REFERENCES caregiver (id),
		type TEXT NOT NULL CHECK (type IN ('nursing', 'bottle', 'pump', 'diaper', 'sleep')),
		started_at TEXT NOT NULL,
		ended_at TEXT,
		note TEXT,
		details TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT
	);

	CREATE INDEX idx_event_baby_time ON event (baby_id, started_at) WHERE deleted_at IS NULL;
	CREATE INDEX idx_event_active_timer ON event (baby_id, type) WHERE ended_at IS NULL AND deleted_at IS NULL;
	`
];

export function migrate(db: Database.Database): void {
	const current = db.pragma('user_version', { simple: true }) as number;
	for (let v = current; v < migrations.length; v++) {
		db.transaction(() => {
			db.exec(migrations[v]);
			db.pragma(`user_version = ${v + 1}`);
		})();
	}
}
