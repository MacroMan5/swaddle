import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
	BabyDTO,
	CreateEventInput,
	Details,
	EventDTO,
	EventType,
	Issue,
	PatchEventInput
} from './types';
import { parseDetails, validateDetailsContext, validateEventTimes } from './types';

type DB = Database.Database;

export class RepoError extends Error {
	constructor(
		public code:
			| 'not_found'
			| 'no_active_timer'
			| 'invalid_state'
			| 'timer_conflict'
			| 'validation_failed'
			| 'in_use',
		message: string,
		public issues?: Issue[]
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

/**
 * Read, merge, validate (FR-017) and write in a single transaction, so two
 * overlapping patches cannot both validate against the same stale row.
 */
export function patchEvent(
	db: DB,
	id: string,
	patch: PatchEventInput,
	now: Date
): EventDTO {
	return db.transaction(() => {
		const current = requireEvent(db, id);
		const startedAt = patch.startedAt ?? current.startedAt;
		const endedAt = patch.endedAt ?? current.endedAt;

		const issues = validateEventTimes({ type: current.type, startedAt, endedAt }, now);
		// Point events (bottle, diaper) must keep endedAt null, same as at creation.
		if (!isTimerType(current.type) && endedAt !== null)
			issues.push({
				path: 'endedAt',
				code: 'ended_at_forbidden',
				message: `${current.type} is a point event and takes no endedAt`
			});
		let details = current.details;
		if (patch.details !== undefined) {
			const parsed = parseDetails(current.type, patch.details);
			if (!parsed.ok) issues.push(...parsed.issues);
			else details = parsed.value;
		}
		issues.push(...validateDetailsContext({ type: current.type, endedAt, details }, now));
		if (issues.length > 0) throw new RepoError('validation_failed', 'invalid patch', issues);

		return updateEvent(db, id, {
			caregiverId: patch.caregiverId === undefined ? undefined : (patch.caregiverId ?? null),
			startedAt: patch.startedAt,
			endedAt: patch.endedAt,
			note: patch.note === undefined ? undefined : (patch.note ?? null),
			details: patch.details === undefined ? undefined : details
		});
	})();
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
		if (current.endedAt === null && isTimerType(current.type)) {
			// Restoring a live timer must not break the unique-timer invariant (FR-013).
			// Point events (bottle, diaper) also have a null ended_at and are exempt.
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

import type { NursingSegment, Side, TimerType } from './types';
import { TIMER_TYPES } from './types';

function isTimerType(type: EventType): type is TimerType {
	return (TIMER_TYPES as readonly string[]).includes(type);
}

export function listActiveTimers(db: DB, babyId?: string): EventDTO[] {
	const placeholders = TIMER_TYPES.map(() => '?').join(', ');
	let sql = `SELECT * FROM event WHERE ended_at IS NULL AND deleted_at IS NULL AND type IN (${placeholders})`;
	const params: string[] = [...TIMER_TYPES];
	if (babyId) {
		sql += ' AND baby_id = ?';
		params.push(babyId);
	}
	return (db.prepare(sql).all(...params) as EventRow[]).map(rowToDto);
}

function activeTimer(db: DB, babyId: string, type: TimerType): EventDTO | undefined {
	const row = db
		.prepare(
			'SELECT * FROM event WHERE baby_id = ? AND type = ? AND ended_at IS NULL AND deleted_at IS NULL'
		)
		.get(babyId, type) as EventRow | undefined;
	return row && rowToDto(row);
}

export function startTimer(
	db: DB,
	opts: {
		type: TimerType;
		babyId: string;
		caregiverId?: string | null;
		side?: Side | 'both';
		startedAt?: string;
	}
): { created: boolean; event: EventDTO } {
	// Transaction makes check-then-insert atomic: a concurrent start returns
	// the existing session instead of creating a duplicate (FR-013).
	return db.transaction(() => {
		const existing = activeTimer(db, opts.babyId, opts.type);
		if (existing) return { created: false, event: existing };
		const startedAt = opts.startedAt ?? nowIso();
		const details: Details =
			opts.type === 'nursing'
				? { segments: [{ side: (opts.side ?? 'left') as Side, startedAt, endedAt: null }] }
				: opts.type === 'pump'
					? { side: opts.side ?? 'both', volumeMl: null }
					: {};
		const event = createEvent(db, {
			babyId: opts.babyId,
			caregiverId: opts.caregiverId ?? null,
			type: opts.type,
			startedAt,
			endedAt: null,
			note: null,
			details
		});
		return { created: true, event };
	})();
}

export function stopTimer(
	db: DB,
	opts: { type: TimerType; babyId: string; endedAt?: string; volumeMl?: number | null }
): EventDTO {
	return db.transaction(() => {
		const event = activeTimer(db, opts.babyId, opts.type);
		if (!event) throw new RepoError('no_active_timer', `no active ${opts.type} timer`);
		const endedAt = opts.endedAt ?? nowIso();
		let details = event.details;
		if (event.type === 'nursing') {
			const d = details as { segments: NursingSegment[] };
			details = {
				segments: d.segments.map((s) => (s.endedAt === null ? { ...s, endedAt } : s))
			};
		} else if (event.type === 'pump' && opts.volumeMl !== undefined) {
			details = { ...(details as { side: Side | 'both' }), volumeMl: opts.volumeMl };
		}

		// The route only bounds endedAt in the future; the session start is only
		// known here, so FR-017 is enforced on the merged event before writing.
		const issues = [
			...validateEventTimes({ type: event.type, startedAt: event.startedAt, endedAt }, new Date()),
			...validateDetailsContext({ type: event.type, endedAt, details }, new Date())
		];
		if (issues.length > 0) throw new RepoError('validation_failed', 'invalid stop', issues);

		return updateEvent(db, event.id, { endedAt, details });
	})();
}

export function nursingAction(
	db: DB,
	opts: { babyId: string; action: 'pause' | 'resume' | 'switch-side'; side?: Side }
): EventDTO {
	return db.transaction(() => {
		const event = activeTimer(db, opts.babyId, 'nursing');
		if (!event) throw new RepoError('no_active_timer', 'no active nursing session');
		const ts = nowIso();
		const segments = [...(event.details as { segments: NursingSegment[] }).segments];
		if (segments.length === 0)
			throw new RepoError('invalid_state', 'nursing session has no segment to act on');
		const openIndex = segments.findIndex((s) => s.endedAt === null);
		const lastSide = segments[segments.length - 1].side;

		if (opts.action === 'pause') {
			if (openIndex === -1) throw new RepoError('invalid_state', 'session is already paused');
			segments[openIndex] = { ...segments[openIndex], endedAt: ts };
		} else if (opts.action === 'resume') {
			if (openIndex !== -1) throw new RepoError('invalid_state', 'session is not paused');
			segments.push({ side: opts.side ?? lastSide, startedAt: ts, endedAt: null });
		} else {
			// switch-side: close the open segment (if any) and open the other side.
			// A client-supplied side is ignored: switching always flips the side,
			// otherwise "switch" could be a no-op on the same breast.
			if (openIndex !== -1) segments[openIndex] = { ...segments[openIndex], endedAt: ts };
			const nextSide: Side = lastSide === 'left' ? 'right' : 'left';
			segments.push({ side: nextSide, startedAt: ts, endedAt: null });
		}
		return updateEvent(db, event.id, { details: { segments } });
	})();
}
