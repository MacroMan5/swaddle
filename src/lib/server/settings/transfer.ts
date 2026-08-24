import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { RepoError } from '$lib/server/events/repo';
import type { BabyDTO, EventDTO } from '$lib/server/events/types';
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

/** RFC 4180: double embedded quotes, quote fields containing `,`, `"` or `\n`. */
function csvField(value: string): string {
	if (/[,"\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
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
	return [header, ...lines].join('\n') + '\n';
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
