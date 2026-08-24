import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BabyDTO, CreateEventInput, Details, EventDTO, EventType } from './types';

type DB = Database.Database;

export class RepoError extends Error {
	constructor(
		public code: 'not_found' | 'no_active_timer' | 'invalid_state' | 'timer_conflict',
		message: string
	) {
		super(message);
	}
}

type EventRow = {
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

function rowToDto(row: EventRow): EventDTO {
	return {
		id: row.id,
		babyId: row.baby_id,
		caregiverId: row.caregiver_id,
		type: row.type,
		startedAt: row.started_at,
		endedAt: row.ended_at,
		note: row.note,
		details: JSON.parse(row.details) as Details,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deletedAt: row.deleted_at
	};
}

const nowIso = () => new Date().toISOString();

export function createEvent(db: DB, input: CreateEventInput): EventDTO {
	const id = randomUUID();
	const ts = nowIso();
	db.prepare(
		`INSERT INTO event (id, baby_id, caregiver_id, type, started_at, ended_at, note, details, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		input.babyId,
		input.caregiverId,
		input.type,
		input.startedAt,
		input.endedAt,
		input.note,
		JSON.stringify(input.details),
		ts,
		ts
	);
	return getEvent(db, id)!;
}

export function getEvent(db: DB, id: string): EventDTO | undefined {
	const row = db.prepare('SELECT * FROM event WHERE id = ?').get(id) as EventRow | undefined;
	return row && rowToDto(row);
}

export function listEvents(
	db: DB,
	opts: { babyId: string; from?: string; to?: string }
): EventDTO[] {
	let sql = 'SELECT * FROM event WHERE deleted_at IS NULL AND baby_id = ?';
	const params: string[] = [opts.babyId];
	if (opts.from) {
		sql += ' AND started_at >= ?';
		params.push(opts.from);
	}
	if (opts.to) {
		sql += ' AND started_at < ?';
		params.push(opts.to);
	}
	sql += ' ORDER BY started_at DESC';
	return (db.prepare(sql).all(...params) as EventRow[]).map(rowToDto);
}

function requireEvent(db: DB, id: string): EventDTO {
	const event = getEvent(db, id);
	if (!event) throw new RepoError('not_found', `no event ${id}`);
	return event;
}

export function updateEvent(
	db: DB,
	id: string,
	fields: {
		caregiverId?: string | null;
		startedAt?: string;
		endedAt?: string;
		note?: string | null;
		details?: Details;
	}
): EventDTO {
	const current = requireEvent(db, id);
	db.prepare(
		`UPDATE event SET caregiver_id = ?, started_at = ?, ended_at = ?, note = ?, details = ?, updated_at = ? WHERE id = ?`
	).run(
		fields.caregiverId !== undefined ? fields.caregiverId : current.caregiverId,
		fields.startedAt ?? current.startedAt,
		fields.endedAt ?? current.endedAt,
		fields.note !== undefined ? fields.note : current.note,
		JSON.stringify(fields.details ?? current.details),
		nowIso(),
		id
	);
	return getEvent(db, id)!;
}

export function softDeleteEvent(db: DB, id: string): EventDTO {
	const current = requireEvent(db, id);
	if (current.deletedAt) return current; // idempotent
	db.prepare('UPDATE event SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
		nowIso(),
		nowIso(),
		id
	);
	return getEvent(db, id)!;
}

export function restoreEvent(db: DB, id: string): EventDTO {
	return db.transaction(() => {
		const current = requireEvent(db, id);
		if (!current.deletedAt) return current;
		if (current.endedAt === null) {
			// Restoring a live timer must not break the unique-timer invariant (FR-013).
			const clash = db
				.prepare(
					'SELECT id FROM event WHERE baby_id = ? AND type = ? AND ended_at IS NULL AND deleted_at IS NULL'
				)
				.get(current.babyId, current.type);
			if (clash)
				throw new RepoError('timer_conflict', `an active ${current.type} timer already exists`);
		}
		db.prepare('UPDATE event SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
		return getEvent(db, id)!;
	})();
}

export function listBabies(db: DB): BabyDTO[] {
	return db
		.prepare('SELECT id, name, birthdate, timezone FROM baby ORDER BY created_at')
		.all() as BabyDTO[];
}
