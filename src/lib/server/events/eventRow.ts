import type Database from 'better-sqlite3';
import type { Details, EventDTO, EventType } from '$lib/shared/events';

/**
 * The single source of truth for the `event` table ↔ `EventDTO` mapping, shared
 * by the repository (reads and writes of the running app) and by the transfer
 * layer (export/restore). Keeping one mapping means a new column cannot be
 * added to one side only — `eventRow.test.ts` checks `EVENT_COLUMNS` against
 * `PRAGMA table_info(event)` of a migrated database.
 *
 * Queries stay with their owners: only the column↔field mapping and the
 * faithful INSERT live here.
 */

/** One row of the `event` table, snake_case, exactly as SQLite returns it. */
export type EventRow = {
	id: string;
	baby_id: string;
	caregiver_id: string | null;
	type: EventType;
	started_at: string;
	ended_at: string | null;
	note: string | null;
	details: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
};

/**
 * Canonical column order — the declaration order of the `event` table. The
 * insert statement below and any future positional binding follow it.
 */
export const EVENT_COLUMNS = [
	'id',
	'baby_id',
	'caregiver_id',
	'type',
	'started_at',
	'ended_at',
	'note',
	'details',
	'created_at',
	'updated_at',
	'deleted_at'
] as const satisfies readonly string[];

export function rowToDto(row: EventRow): EventDTO {
	return {
		id: row.id,
		babyId: row.baby_id,
		caregiverId: row.caregiver_id,
		type: row.type,
		startedAt: row.started_at,
		endedAt: row.ended_at,
		note: row.note,
		// THE deserialization boundary: `details` is stored as an opaque JSON
		// text column, and this is the one place where it re-enters the typed
		// world. Everything upstream (the API layer, `parseDetails`, the import
		// graph validation) has already checked the payload against its type, so
		// no other module needs — or is allowed — to parse it again.
		details: JSON.parse(row.details) as Details,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deletedAt: row.deleted_at
	};
}

export function dtoToRow(dto: EventDTO): EventRow {
	return {
		id: dto.id,
		baby_id: dto.babyId,
		caregiver_id: dto.caregiverId,
		type: dto.type,
		started_at: dto.startedAt,
		ended_at: dto.endedAt,
		note: dto.note,
		details: JSON.stringify(dto.details),
		created_at: dto.createdAt,
		updated_at: dto.updatedAt,
		deleted_at: dto.deletedAt
	};
}

export const INSERT_EVENT_SQL = `INSERT INTO event (${EVENT_COLUMNS.join(', ')})
	 VALUES (${EVENT_COLUMNS.map(() => '?').join(', ')})`;

/**
 * Writes a DTO back verbatim — `id`, `createdAt`, `updatedAt` and `deletedAt`
 * included. Deliberately *not* `repo.createEvent`, which mints a new uuid and
 * stamps the timestamps: a restore must reproduce the export byte for byte
 * (AC-007), soft-deleted rows included.
 */
export function insertEventRow(db: Database.Database, dto: EventDTO): void {
	const row = dtoToRow(dto);
	db.prepare(INSERT_EVENT_SQL).run(...EVENT_COLUMNS.map((c) => row[c]));
}
