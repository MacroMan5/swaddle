import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { insertEventRow, rowToDto, type EventRow } from '$lib/server/events/eventRow';
import { RepoError } from '$lib/server/events/repo';
import type { BabyDTO, EventDTO, Issue } from '$lib/server/events/types';
import { isTimerType, parseDetails, validateDetailsContext, validateEventTimes } from '$lib/server/events/types';
import { quickWordIntentSchema } from '$lib/server/quick/types';
import { getHousehold, getPinHash, listCaregivers, type CaregiverDTO } from './repo';

type DB = Database.Database;

export type QuickWordDTO = { id: string; word: string; intent: unknown };

export type SwaddleExport = {
	format: 'swaddle-export';
	version: 1;
	exportedAt: string;
	household: { volumeUnit: 'ml' | 'oz'; theme: 'light' | 'dark' | 'auto' };
	babies: BabyDTO[];
	caregivers: CaregiverDTO[];
	events: EventDTO[];
	/**
	 * The voice vocabulary (#97): household configuration, so it travels with
	 * the data. API tokens deliberately do NOT — they are per-device secrets,
	 * useless to whoever restores the file and dangerous in a copy of it; a
	 * restored household recreates them from /settings.
	 *
	 * Optional on import (`version` stays 1): an export taken before this field
	 * existed must still restore, and leaves the vocabulary as it is.
	 */
	quickWords: QuickWordDTO[];
};

function listQuickWords(db: DB): QuickWordDTO[] {
	return (
		db.prepare('SELECT id, word, intent FROM quick_word ORDER BY word').all() as {
			id: string;
			word: string;
			intent: string;
		}[]
	).map((r) => ({ id: r.id, word: r.word, intent: JSON.parse(r.intent) as unknown }));
}

function listAllEvents(db: DB): EventDTO[] {
	// Soft-deleted rows are included so a restore is lossless.
	return (db.prepare('SELECT * FROM event ORDER BY created_at').all() as EventRow[]).map(rowToDto);
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
		events: listAllEvents(db),
		quickWords: listQuickWords(db)
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
	),
	// Optional: exports predating #97 carry no vocabulary and must still
	// restore. Absent means "leave the current words alone", not "wipe them".
	quickWords: z
		.array(z.object({ id: z.string(), word: z.string().min(1), intent: z.unknown() }))
		.optional()
});

type ParsedExport = z.infer<typeof exportSchema>;

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

	// quick_word holds two unique columns; a payload that duplicates either
	// would otherwise surface as a raw SQLITE_CONSTRAINT_UNIQUE, which the
	// route maps to `timer_conflict` — a nonsense answer for a vocabulary.
	const wordIds = new Set<string>();
	const words = new Set<string>();
	(data.quickWords ?? []).forEach((w, i) => {
		if (wordIds.has(w.id))
			issues.push({
				path: `quickWords.${i}.id`,
				code: 'duplicate_id',
				message: `duplicate quick word id ${w.id}`
			});
		wordIds.add(w.id);
		if (words.has(w.word))
			issues.push({
				path: `quickWords.${i}.word`,
				code: 'duplicate_word',
				message: `duplicate quick word ${w.word}`
			});
		words.add(w.word);
		// The stored intent is read back — and parsed — every time the vocabulary
		// is listed: by a dictation, by GET /api/quick/words, by the settings
		// page. A payload carrying an unreadable one would restore fine and then
		// break every one of those reads, including the reload the restore itself
		// triggers. It is checked here instead, against the same schema the add
		// route uses.
		const intent = quickWordIntentSchema.safeParse(w.intent);
		if (!intent.success)
			issues.push({
				path: `quickWords.${i}.intent`,
				code: 'invalid_value',
				message: `invalid intent for quick word ${w.word}`
			});
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
		// startedAt must have parsed to compare segment bounds against it (review
		// item 7); an invalid startedAt is already reported above.
		if (!startedAtValid) return;
		issues.push(
			...validateDetailsContext(
				{ type: e.type, startedAt: e.startedAt, endedAt: e.endedAt, details: detailsResult.value },
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

	const { household, babies, caregivers, events, quickWords } = parsed.data;
	// The export never carries the pin hash (see exportJson): a restore must
	// not silently disable the household's current PIN, so it's read before
	// the wipe and rewritten as-is.
	const currentPinHash = getPinHash(db);

	db.transaction(() => {
		// `DELETE FROM caregiver` below trips api_token's ON DELETE SET NULL and
		// detaches every device from its caregiver — even though the payload is
		// about to put the very same caregiver ids back. The links are captured
		// here and reapplied once the caregivers exist again; a link whose
		// caregiver the payload no longer holds stays null, which is correct.
		const tokenLinks = db
			.prepare('SELECT id, caregiver_id FROM api_token WHERE caregiver_id IS NOT NULL')
			.all() as { id: string; caregiver_id: string }[];

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

		// Reattach the devices the wipe just detached. Filtered on the restored
		// ids rather than left to the database: an UPDATE towards a caregiver the
		// payload dropped would violate the foreign key and fail the whole
		// restore, where null is the honest answer.
		const restoredCaregiverIds = new Set(caregivers.map((c) => c.id));
		const relinkToken = db.prepare('UPDATE api_token SET caregiver_id = ? WHERE id = ?');
		for (const link of tokenLinks)
			if (restoredCaregiverIds.has(link.caregiver_id)) relinkToken.run(link.caregiver_id, link.id);

		// Written verbatim (ids and timestamps included) so a restore reproduces
		// the export exactly. The schema types `details` as `unknown`; it has
		// just been checked against its event type by `validateGraph`, so the
		// payload really is an `EventDTO` here.
		for (const e of events) insertEventRow(db, e as EventDTO);

		// api_token is untouched on purpose: the payload never carries tokens, and
		// wiping the table would silently cut off every device the household has
		// paired — including the one that may have triggered this restore.
		if (quickWords !== undefined) {
			db.exec('DELETE FROM quick_word');
			const insertWord = db.prepare('INSERT INTO quick_word (id, word, intent) VALUES (?, ?, ?)');
			for (const w of quickWords) insertWord.run(w.id, w.word, JSON.stringify(w.intent ?? null));
		}
	})();

	return { babies: babies.length, caregivers: caregivers.length, events: events.length };
}

export function snapshotTo(db: DB, destPath: string): void {
	mkdirSync(dirname(destPath), { recursive: true });
	db.prepare('VACUUM INTO ?').run(destPath);
}
