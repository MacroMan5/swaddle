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
	`,
	// v2 — FR-013 (one active timer per baby and type) becomes a schema
	// invariant. The application guards (repo.startTimer / repo.restoreEvent and
	// transfer.validateGraph) stay the source of the clean domain errors; this
	// index is only the last-resort net for a path they would miss.
	`
	-- Repair first: an existing database may already hold duplicates the guards
	-- never covered (a hand-edited file, a restore predating validateGraph).
	-- Keep the most recently started timer of each (baby, type) and soft-delete
	-- the others. Never fail the migration on such data — a family app that
	-- refuses to boot after a "docker pull" is an incident — and never fabricate
	-- an ended_at: it would skew the FR-010 summaries, and a pump closed
	-- without a volumeMl would violate validateDetailsContext. A soft delete is
	-- reversible and the row stays exportable.
	UPDATE event
	SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
		updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
	WHERE ended_at IS NULL
		AND deleted_at IS NULL
		AND type IN ('nursing', 'pump', 'sleep')
		AND rowid NOT IN (
			SELECT rowid FROM (
				SELECT rowid, ROW_NUMBER() OVER (
					PARTITION BY baby_id, type ORDER BY started_at DESC, rowid DESC
				) AS rn
				FROM event
				WHERE ended_at IS NULL AND deleted_at IS NULL AND type IN ('nursing', 'pump', 'sleep')
			) WHERE rn = 1
		);

	DROP INDEX idx_event_active_timer;
	-- The type restriction is mandatory, not an optimisation: point events
	-- (bottle, diaper) carry a null ended_at by design, so without it the index
	-- would forbid a baby's second undeleted bottle of the day.
	CREATE UNIQUE INDEX idx_event_active_timer ON event (baby_id, type)
		WHERE ended_at IS NULL AND deleted_at IS NULL
			AND type IN ('nursing', 'pump', 'sleep');
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
