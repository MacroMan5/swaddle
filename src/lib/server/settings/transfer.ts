import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { RepoError } from '$lib/server/events/repo';
import type { BabyDTO, EventDTO, EventType, Issue } from '$lib/server/events/types';
import { TIMER_TYPES, parseDetails, validateDetailsContext, validateEventTimes } from '$lib/server/events/types';
import { getHousehold, getPinHash, listCaregivers, type CaregiverDTO } from './repo';

type DB = Database.Database;

export type SwaddleExport = {
	format: 'swaddle-export';
	version: 1;
	exportedAt: string;
	household: { volumeUnit: 'ml' | 'oz'; theme: 'light' | 'dark' | 'auto' };
	babies: BabyDTO[];
	caregivers: CaregiverDTO[];
	events: EventDTO[];
};

type EventRow = {
	id: string;
	baby_id: string;
	caregiver_id: string | null;
	type: string;
	started_at: string;
	ended_at: string | null;
	note: string | null;
	details: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
};

function rowToEventDto(row: EventRow): EventDTO {
	return {
		id: row.id,
		babyId: row.baby_id,
		caregiverId: row.caregiver_id,
		type: row.type as EventDTO['type'],
		startedAt: row.started_at,
		endedAt: row.ended_at,
		note: row.note,
		details: JSON.parse(row.details) as EventDTO['details'],
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deletedAt: row.deleted_at
	};
}

function listAllEvents(db: DB): EventDTO[] {
	// Soft-deleted rows are included so a restore is lossless.
	return (db.prepare('SELECT * FROM event ORDER BY created_at').all() as EventRow[]).map(
		rowToEventDto
	);
}

function listAllBabies(db: DB): BabyDTO[] {
	return db
		.prepare('SELECT id, name, birthdate, timezone FROM baby ORDER BY created_at')
		.all() as BabyDTO[];
}

export function exportJson(db: DB): SwaddleExport {
	const household = getHousehold(db);
	return {
		format: 'swaddle-export',
		version: 1,
		exportedAt: new Date().toISOString(),
		household: { volumeUnit: household.volumeUnit, theme: household.theme },
		babies: listAllBabies(db),
		caregivers: listCaregivers(db),
		events: listAllEvents(db)
	};
}

/**
 * Strict RFC 4180: double embedded quotes, quote fields containing `,`, `"`,
 * `\r` or `\n` (a bare CR included, not just full CRLF).
 */
function csvField(value: string): string {
	if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

export function exportCsv(db: DB): string {
	const header = 'id,babyId,caregiverId,type,startedAt,endedAt,note,details,createdAt,updatedAt,deletedAt';
	const events = listAllEvents(db);
	const lines = events.map((e) =>
		[
			e.id,
			e.babyId,
			e.caregiverId ?? '',
			e.type,
			e.startedAt,
			e.endedAt ?? '',
			e.note ?? '',
			JSON.stringify(e.details),
			e.createdAt,
			e.updatedAt,
			e.deletedAt ?? ''
		]
			.map((v) => csvField(String(v)))
			.join(',')
	);
	// RFC 4180 record separator is CRLF, not a bare LF.
	return [header, ...lines].join('\r\n') + '\r\n';
}

const exportSchema = z.object({
	format: z.literal('swaddle-export'),
	version: z.literal(1),
	exportedAt: z.string(),
	household: z.object({
		volumeUnit: z.enum(['ml', 'oz']),
		theme: z.enum(['light', 'dark', 'auto'])
	}),
	babies: z.array(
		z.object({ id: z.string(), name: z.string(), birthdate: z.string(), timezone: z.string() })
	),
	caregivers: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
	events: z.array(
		z.object({
			id: z.string(),
			babyId: z.string(),
			caregiverId: z.string().nullable(),
			type: z.enum(['nursing', 'bottle', 'pump', 'diaper', 'sleep']),
			startedAt: z.string(),
			endedAt: z.string().nullable(),
			note: z.string().nullable(),
			details: z.unknown(),
			createdAt: z.string(),
			updatedAt: z.string(),
			deletedAt: z.string().nullable()
		})
	)
});

type ParsedExport = z.infer<typeof exportSchema>;

function isTimerType(type: EventType): boolean {
	return (TIMER_TYPES as readonly string[]).includes(type);
}

/**
 * Everything the schema alone can't catch: ids that must be unique within
 * their own collection (each is a table primary key), event references that
 * must resolve to a baby/caregiver in the same payload, event `details` that
 * must actually match their type — the schema only knows `details` as
 * `unknown`, so a corrupted export could otherwise import e.g. an active
 * nursing session with `{}` and crash a later `nursingAction` call — event
 * timestamps that must be ISO-parseable and obey the same FR-017 rules as a
 * normal write, and the FR-013 invariant (at most one undeleted active timer
 * per baby/type). Runs before the destructive transaction so nothing is
 * written on failure.
 */
function validateGraph(data: ParsedExport): Issue[] {
	const issues: Issue[] = [];
	const now = new Date();

	const babyIds = new Set<string>();
	data.babies.forEach((b, i) => {
		if (babyIds.has(b.id))
			issues.push({ path: `babies.${i}.id`, code: 'duplicate_id', message: `duplicate baby id ${b.id}` });
		babyIds.add(b.id);
	});

	const caregiverIds = new Set<string>();
	data.caregivers.forEach((c, i) => {
		if (caregiverIds.has(c.id))
			issues.push({
				path: `caregivers.${i}.id`,
				code: 'duplicate_id',
				message: `duplicate caregiver id ${c.id}`
			});
		caregiverIds.add(c.id);
	});

	const eventIds = new Set<string>();
	const activeTimerKeys = new Set<string>();
	data.events.forEach((e, i) => {
		if (eventIds.has(e.id))
			issues.push({ path: `events.${i}.id`, code: 'duplicate_id', message: `duplicate event id ${e.id}` });
		eventIds.add(e.id);

		if (!babyIds.has(e.babyId))
			issues.push({
				path: `events.${i}.babyId`,
				code: 'unknown_reference',
				message: `event ${e.id} references unknown babyId ${e.babyId}`
			});
		if (e.caregiverId !== null && !caregiverIds.has(e.caregiverId))
			issues.push({
				path: `events.${i}.caregiverId`,
				code: 'unknown_reference',
				message: `event ${e.id} references unknown caregiverId ${e.caregiverId}`
			});

		const startedAtValid = !Number.isNaN(Date.parse(e.startedAt));
		if (!startedAtValid)
			issues.push({
				path: `events.${i}.startedAt`,
				code: 'invalid_date',
				message: `event ${e.id} has a non-ISO startedAt`
			});
		const endedAtValid = e.endedAt === null || !Number.isNaN(Date.parse(e.endedAt));
		if (!endedAtValid)
			issues.push({
				path: `events.${i}.endedAt`,
				code: 'invalid_date',
				message: `event ${e.id} has a non-ISO endedAt`
			});
		// Comparisons below need both timestamps to have parsed; skip them
		// otherwise instead of comparing against NaN (which silently passes).
		if (startedAtValid && endedAtValid)
			issues.push(
				...validateEventTimes(
					{ type: e.type, startedAt: e.startedAt, endedAt: e.endedAt },
					now
				).map((iss) => ({ ...iss, path: `events.${i}.${iss.path}` }))
			);

		// Point events (bottle, diaper) must keep endedAt null, same as at
		// creation; timer types (nursing, pump, sleep) may be null (active) or
		// set (completed).
		if (!isTimerType(e.type) && e.endedAt !== null)
			issues.push({
				path: `events.${i}.endedAt`,
				code: 'ended_at_forbidden',
				message: `${e.type} is a point event and takes no endedAt`
			});

		// FR-013: at most one undeleted active timer per baby+type.
		if (isTimerType(e.type) && e.endedAt === null && e.deletedAt === null) {
			const key = `${e.babyId}:${e.type}`;
			if (activeTimerKeys.has(key))
				issues.push({
					path: `events.${i}`,
					code: 'timer_conflict',
					message: `duplicate active ${e.type} timer for baby ${e.babyId}`
				});
			activeTimerKeys.add(key);
		}

		const detailsResult = parseDetails(e.type, e.details);
		if (!detailsResult.ok) {
			issues.push(
				...detailsResult.issues.map((iss) => ({ ...iss, path: `events.${i}.${iss.path}` }))
			);
			return; // context validation needs details shaped as Details; skip it below
		}
		issues.push(
			...validateDetailsContext(
				{ type: e.type, endedAt: e.endedAt, details: detailsResult.value },
				now
			).map((iss) => ({ ...iss, path: `events.${i}.${iss.path}` }))
		);
	});

	return issues;
}

export function importJson(
	db: DB,
	data: unknown
): { babies: number; caregivers: number; events: number } {
	const parsed = exportSchema.safeParse(data);
	if (!parsed.success)
		throw new RepoError(
			'validation_failed',
			'invalid export payload',
			parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
		);

	const graphIssues = validateGraph(parsed.data);
	if (graphIssues.length > 0)
		throw new RepoError('validation_failed', 'invalid export payload', graphIssues);

	const { household, babies, caregivers, events } = parsed.data;
	// The export never carries the pin hash (see exportJson): a restore must
	// not silently disable the household's current PIN, so it's read before
	// the wipe and rewritten as-is.
	const currentPinHash = getPinHash(db);

	db.transaction(() => {
		db.exec('DELETE FROM event');
		db.exec('DELETE FROM caregiver');
		db.exec('DELETE FROM baby');
		db.exec('DELETE FROM household');

		db.prepare(
			'INSERT INTO household (id, pin_hash, volume_unit, theme, created_at) VALUES (1, ?, ?, ?, ?)'
		).run(currentPinHash, household.volumeUnit, household.theme, new Date().toISOString());

		const insertBaby = db.prepare(
			'INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES (?, ?, ?, ?, ?)'
		);
		for (const b of babies) insertBaby.run(b.id, b.name, b.birthdate, b.timezone, new Date().toISOString());

		const insertCaregiver = db.prepare(
			'INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)'
		);
		for (const c of caregivers) insertCaregiver.run(c.id, c.name, c.color, new Date().toISOString());

		const insertEvent = db.prepare(
			`INSERT INTO event (id, baby_id, caregiver_id, type, started_at, ended_at, note, details, created_at, updated_at, deleted_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		for (const e of events)
			insertEvent.run(
				e.id,
				e.babyId,
				e.caregiverId,
				e.type,
				e.startedAt,
				e.endedAt,
				e.note,
				JSON.stringify(e.details),
				e.createdAt,
				e.updatedAt,
				e.deletedAt
			);
	})();

	return { babies: babies.length, caregivers: caregivers.length, events: events.length };
}

export function snapshotTo(db: DB, destPath: string): void {
	mkdirSync(dirname(destPath), { recursive: true });
	db.prepare('VACUUM INTO ?').run(destPath);
}
