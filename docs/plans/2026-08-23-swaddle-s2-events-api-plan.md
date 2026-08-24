# Slice 2 — Events API, Unique Timers and SSE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side domain layer for Swaddle: event CRUD (5 types, soft delete), server validation (FR-017), the unique-active-timer invariant (FR-013), and an SSE change stream with state recovery (FR-012).

**Architecture:** Pure server slice, no UI. A typed validation layer (zod) feeds a synchronous better-sqlite3 repository (`src/lib/server/events/`); SvelteKit `+server.ts` routes expose REST endpoints under `/api/`; an in-process broadcast module fans out changes to an SSE endpoint. Single Node process (adapter-node), so better-sqlite3 transactions are sufficient for the concurrency invariant.

**Tech Stack:** SvelteKit 2 (adapter-node), TypeScript, better-sqlite3 (schema v1 already migrated), zod v4, Vitest (unit), Playwright (API/e2e).

**Spec:** `docs/specs/2026-08-23-newborn-tracker-spec.md` (FR-006/007/012/013/017, AC-004/005/010, DEC-001/002, RISK-001). Schema v1: `src/lib/server/db/migrations.ts`.

## Global Constraints

- Install deps with `npm ci --ignore-scripts` / `npm install <pkg> --ignore-scripts` — never plain (better-sqlite3 prebuilds, cf. CLAUDE.md).
- Code, identifiers, comments and commit messages in **English**; no AI attribution of any kind in commits.
- Timestamps are ISO 8601 UTC strings end to end (`new Date().toISOString()`).
- FR-017 exact values: volumes must be in **[1, 1000] ml**; `endedAt >= startedAt`; timestamps at most **5 minutes** in the future.
- Server time is authoritative (RISK-001): every SSE payload carries `serverTime`.
- Commit after every green task; conventional commit style (`feat:`, `test:`, `fix:` …) as in the existing history.
- Verification commands: `npm run check`, `npm run test:unit`, `npm run test:e2e` (builds prod; chromium already installed on the runner).

## API contract (summary — implemented task by task)

Event JSON shape (`EventDTO`, camelCase; DB stays snake_case):

```ts
{
  id: string; babyId: string; caregiverId: string | null;
  type: 'nursing' | 'bottle' | 'pump' | 'diaper' | 'sleep';
  startedAt: string; endedAt: string | null;
  note: string | null; details: Details;         // per-type, see Task 1
  createdAt: string; updatedAt: string; deletedAt: string | null;
}
```

| Route | Verb | Purpose |
|---|---|---|
| `/api/babies` | GET | `{ babies: BabyDTO[] }` — UI slices need the baby id |
| `/api/events?babyId=&from=&to=` | GET | list non-deleted events, `startedAt` DESC |
| `/api/events` | POST | create completed/manual event → 201 |
| `/api/events/[id]` | GET / PATCH / DELETE | read (incl. deleted) / edit / soft-delete |
| `/api/events/[id]/restore` | POST | undo soft delete (409 on timer conflict) |
| `/api/timers?babyId=` | GET | `{ serverTime, timers: EventDTO[] }` (active) |
| `/api/timers/[type]/start` | POST | start or return existing → `{ created, event }` |
| `/api/timers/[type]/stop` | POST | stop active timer (404 `no_active_timer`) |
| `/api/timers/nursing/action` | POST | `pause` / `resume` / `switch-side` |
| `/api/stream` | GET | SSE: `snapshot` on connect, `sync` on change |

Errors: `{ error: { code, message, issues? } }` — 400 `validation_failed`, 404 `not_found` / `no_active_timer` / `unknown_timer_type`, 409 `invalid_state` / `timer_conflict`.

Timer types: `nursing`, `pump`, `sleep` (bottle and diaper are point events, `endedAt` always null). Nursing pause model: the event is *paused* when it is active (`endedAt === null`) but no segment is open; effective duration = sum of segment durations, so paused time is excluded by construction (DEC-001).

---

### Task 1: Types and validation (`types.ts`)

**Files:**
- Modify: `package.json` (add zod)
- Create: `src/lib/server/events/types.ts`
- Test: `src/lib/server/events/types.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (used by every later task):
  - `EVENT_TYPES`, `TIMER_TYPES` const arrays; types `EventType`, `TimerType`, `Side`, `Details`, `EventDTO`, `BabyDTO`.
  - `MAX_FUTURE_MS = 5 * 60 * 1000`.
  - `parseCreateEvent(input: unknown, now: Date): Result<CreateEventInput>`
  - `parsePatchEvent(input: unknown): Result<PatchEventInput>`
  - `validateEventTimes(e: { type, startedAt, endedAt, details }, now: Date): Issue[]` (shared by create & patch-merge)
  - `Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] }` with `Issue = { path: string; code: string; message: string }`.

- [ ] **Step 1: Install zod**

```bash
npm install zod --ignore-scripts
```

- [ ] **Step 2: Write the failing tests**

`src/lib/server/events/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCreateEvent, parsePatchEvent } from './types';

const NOW = new Date('2026-08-23T12:00:00.000Z');
const base = {
	babyId: 'baby-1',
	type: 'bottle',
	startedAt: '2026-08-23T11:00:00.000Z',
	details: { milkType: 'formula', volumeMl: 90 }
};

describe('parseCreateEvent — FR-017 (AC-010)', () => {
	it('accepts a valid bottle', () => {
		const r = parseCreateEvent(base, NOW);
		expect(r.ok).toBe(true);
	});

	it('rejects volume 0 and 1500 ml', () => {
		for (const volumeMl of [0, 1500]) {
			const r = parseCreateEvent({ ...base, details: { milkType: 'formula', volumeMl } }, NOW);
			expect(r.ok).toBe(false);
		}
	});

	it('rejects end before start', () => {
		const r = parseCreateEvent(
			{
				...base,
				type: 'sleep',
				details: {},
				startedAt: '2026-08-23T11:00:00.000Z',
				endedAt: '2026-08-23T10:00:00.000Z'
			},
			NOW
		);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.issues.some((i) => i.code === 'end_before_start')).toBe(true);
	});

	it('rejects times more than 5 minutes in the future, accepts 4 minutes', () => {
		const bad = parseCreateEvent({ ...base, startedAt: '2026-08-23T12:10:00.000Z' }, NOW);
		expect(bad.ok).toBe(false);
		const good = parseCreateEvent({ ...base, startedAt: '2026-08-23T12:04:00.000Z' }, NOW);
		expect(good.ok).toBe(true);
	});

	it('rejects details not matching the type', () => {
		const r = parseCreateEvent({ ...base, type: 'diaper' }, NOW);
		expect(r.ok).toBe(false);
	});

	it('requires at least pee or poo on a diaper', () => {
		const r = parseCreateEvent(
			{ ...base, type: 'diaper', details: { pee: false, poo: false } },
			NOW
		);
		expect(r.ok).toBe(false);
	});

	it('requires endedAt on timer types and forbids it on point types', () => {
		const sleepOpen = parseCreateEvent({ ...base, type: 'sleep', details: {} }, NOW);
		expect(sleepOpen.ok).toBe(false); // active timers go through /api/timers
		const bottleEnded = parseCreateEvent({ ...base, endedAt: '2026-08-23T11:05:00.000Z' }, NOW);
		expect(bottleEnded.ok).toBe(false);
	});

	it('accepts a completed nursing with segments', () => {
		const r = parseCreateEvent(
			{
				babyId: 'baby-1',
				type: 'nursing',
				startedAt: '2026-08-23T10:00:00.000Z',
				endedAt: '2026-08-23T10:20:00.000Z',
				details: {
					segments: [
						{ side: 'left', startedAt: '2026-08-23T10:00:00.000Z', endedAt: '2026-08-23T10:10:00.000Z' },
						{ side: 'right', startedAt: '2026-08-23T10:12:00.000Z', endedAt: '2026-08-23T10:20:00.000Z' }
					]
				}
			},
			NOW
		);
		expect(r.ok).toBe(true);
	});
});

describe('parsePatchEvent', () => {
	it('accepts a partial patch', () => {
		expect(parsePatchEvent({ note: 'spit up a little' }).ok).toBe(true);
	});

	it('rejects clearing endedAt (cannot reopen a finished timer)', () => {
		expect(parsePatchEvent({ endedAt: null }).ok).toBe(false);
	});

	it('rejects unknown fields', () => {
		expect(parsePatchEvent({ type: 'sleep' }).ok).toBe(false);
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/events/types.test.ts`
Expected: FAIL (module `./types` not found).

- [ ] **Step 4: Implement `src/lib/server/events/types.ts`**

```ts
import { z } from 'zod';

export const EVENT_TYPES = ['nursing', 'bottle', 'pump', 'diaper', 'sleep'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// Types driven by a timer; bottle and diaper are point events (endedAt null).
export const TIMER_TYPES = ['nursing', 'pump', 'sleep'] as const;
export type TimerType = (typeof TIMER_TYPES)[number];

export const MAX_FUTURE_MS = 5 * 60 * 1000; // FR-017 / DEC-002

const isoDatetime = z.iso.datetime();
const volumeMl = z.number().min(1).max(1000); // FR-017: [1, 1000] ml
const side = z.enum(['left', 'right']);
export type Side = z.infer<typeof side>;

const segment = z.object({
	side,
	startedAt: isoDatetime,
	endedAt: isoDatetime.nullable()
});
export type NursingSegment = z.infer<typeof segment>;

export const detailsSchemas = {
	nursing: z.object({ segments: z.array(segment) }),
	bottle: z.object({ milkType: z.enum(['breast', 'formula', 'mixed']), volumeMl }),
	pump: z.object({ side: z.enum(['left', 'right', 'both']), volumeMl: volumeMl.nullable() }),
	diaper: z
		.object({ pee: z.boolean(), poo: z.boolean() })
		.refine((d) => d.pee || d.poo, { message: 'a diaper needs at least pee or poo' }),
	sleep: z.strictObject({})
} as const;

export type Details = {
	[K in EventType]: z.infer<(typeof detailsSchemas)[K]>;
}[EventType];

export type EventDTO = {
	id: string;
	babyId: string;
	caregiverId: string | null;
	type: EventType;
	startedAt: string;
	endedAt: string | null;
	note: string | null;
	details: Details;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};

export type BabyDTO = { id: string; name: string; birthdate: string; timezone: string };

export type Issue = { path: string; code: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

const createEventSchema = z.object({
	babyId: z.string().min(1),
	caregiverId: z.string().min(1).nullish(),
	type: z.enum(EVENT_TYPES),
	startedAt: isoDatetime,
	endedAt: isoDatetime.nullish(),
	note: z.string().max(1000).nullish(),
	details: z.unknown()
});
export type CreateEventInput = {
	babyId: string;
	caregiverId: string | null;
	type: EventType;
	startedAt: string;
	endedAt: string | null;
	note: string | null;
	details: Details;
};

const patchEventSchema = z.strictObject({
	caregiverId: z.string().min(1).nullish(),
	startedAt: isoDatetime.optional(),
	// null is rejected: reopening a finished timer would bypass the unique-timer invariant.
	endedAt: isoDatetime.optional(),
	note: z.string().max(1000).nullish(),
	details: z.unknown().optional()
});
export type PatchEventInput = z.infer<typeof patchEventSchema>;

function zodIssues(error: z.ZodError): Issue[] {
	return error.issues.map((i) => ({
		path: i.path.join('.'),
		code: i.code,
		message: i.message
	}));
}

/** FR-017 time rules, shared by create and patched-merge validation. */
export function validateEventTimes(
	e: { type: EventType; startedAt: string; endedAt: string | null },
	now: Date
): Issue[] {
	const issues: Issue[] = [];
	const max = now.getTime() + MAX_FUTURE_MS;
	if (Date.parse(e.startedAt) > max)
		issues.push({ path: 'startedAt', code: 'too_far_in_future', message: 'startedAt is more than 5 minutes in the future' });
	if (e.endedAt !== null) {
		if (Date.parse(e.endedAt) > max)
			issues.push({ path: 'endedAt', code: 'too_far_in_future', message: 'endedAt is more than 5 minutes in the future' });
		if (Date.parse(e.endedAt) < Date.parse(e.startedAt))
			issues.push({ path: 'endedAt', code: 'end_before_start', message: 'endedAt is before startedAt' });
	}
	return issues;
}

/** Details must match the event type. Returns issues or the parsed details. */
export function parseDetails(type: EventType, details: unknown): Result<Details> {
	const parsed = detailsSchemas[type].safeParse(details);
	if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
	return { ok: true, value: parsed.data as Details };
}

export function parseCreateEvent(input: unknown, now: Date): Result<CreateEventInput> {
	const parsed = createEventSchema.safeParse(input);
	if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
	const { babyId, caregiverId, type, startedAt, endedAt, note, details } = parsed.data;
	const issues: Issue[] = [];

	const isTimerType = (TIMER_TYPES as readonly string[]).includes(type);
	if (isTimerType && endedAt == null)
		issues.push({ path: 'endedAt', code: 'ended_at_required', message: `a completed ${type} needs endedAt; use /api/timers for live sessions` });
	if (!isTimerType && endedAt != null)
		issues.push({ path: 'endedAt', code: 'ended_at_forbidden', message: `${type} is a point event and takes no endedAt` });

	const detailsResult = parseDetails(type, details);
	if (!detailsResult.ok) issues.push(...detailsResult.issues);

	issues.push(...validateEventTimes({ type, startedAt, endedAt: endedAt ?? null }, now));
	if (issues.length > 0) return { ok: false, issues };
	return {
		ok: true,
		value: {
			babyId,
			caregiverId: caregiverId ?? null,
			type,
			startedAt,
			endedAt: endedAt ?? null,
			note: note ?? null,
			details: (detailsResult as { ok: true; value: Details }).value
		}
	};
}

export function parsePatchEvent(input: unknown): Result<PatchEventInput> {
	const parsed = patchEventSchema.safeParse(input);
	if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
	return { ok: true, value: parsed.data };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/events/types.test.ts`
Expected: PASS. If a zod v4 API name differs (e.g. `z.iso.datetime`), check the installed version's docs — do not silence with `any`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/server/events/types.ts src/lib/server/events/types.test.ts docs/plans/2026-08-23-swaddle-s2-events-api-plan.md
git commit -m "feat: add event types and FR-017 validation layer"
```

---

### Task 2: Repository — CRUD and soft delete (`repo.ts`)

**Files:**
- Create: `src/lib/server/events/repo.ts`
- Test: `src/lib/server/events/repo.test.ts`

**Interfaces:**
- Consumes: `openDb` from `$lib/server/db` (tests use `openDb(':memory:')`); `EventDTO`, `Details`, `CreateEventInput`, `TIMER_TYPES` from `./types`.
- Produces (Task 3 extends this file; Tasks 5–7 call it):
  - `class RepoError extends Error { code: 'not_found' | 'no_active_timer' | 'invalid_state' | 'timer_conflict' }`
  - `createEvent(db, input: CreateEventInput): EventDTO`
  - `getEvent(db, id: string): EventDTO | undefined` (returns soft-deleted rows too, `deletedAt` set)
  - `listEvents(db, opts: { babyId: string; from?: string; to?: string }): EventDTO[]` (non-deleted, `startedAt` DESC; `from` inclusive / `to` exclusive on `startedAt`)
  - `updateEvent(db, id, fields: { caregiverId?, startedAt?, endedAt?, note?, details? }): EventDTO` (throws `not_found`)
  - `softDeleteEvent(db, id): EventDTO` (idempotent; throws `not_found`)
  - `restoreEvent(db, id): EventDTO` (throws `not_found`; throws `timer_conflict` if the restored event is an active timer and another one now exists)
  - `listBabies(db): BabyDTO[]`

- [ ] **Step 1: Write the failing tests**

`src/lib/server/events/repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../db';
import {
	createEvent,
	getEvent,
	listEvents,
	updateEvent,
	softDeleteEvent,
	restoreEvent,
	listBabies,
	RepoError
} from './repo';
import type { CreateEventInput } from './types';

let db: Database.Database;

function seed(db: Database.Database) {
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
}

const bottle = (over: Partial<CreateEventInput> = {}): CreateEventInput => ({
	babyId: 'baby-1',
	caregiverId: 'cg-1',
	type: 'bottle',
	startedAt: '2026-08-23T11:00:00.000Z',
	endedAt: null,
	note: null,
	details: { milkType: 'formula', volumeMl: 90 },
	...over
});

beforeEach(() => {
	db = openDb(':memory:');
	seed(db);
});

describe('event CRUD', () => {
	it('creates and reads back an event as camelCase DTO with parsed details', () => {
		const created = createEvent(db, bottle());
		expect(created.id).toBeTruthy();
		expect(created.babyId).toBe('baby-1');
		expect(created.details).toEqual({ milkType: 'formula', volumeMl: 90 });
		expect(created.deletedAt).toBeNull();
		expect(getEvent(db, created.id)).toEqual(created);
	});

	it('lists non-deleted events for a baby, startedAt DESC, from inclusive / to exclusive', () => {
		const a = createEvent(db, bottle({ startedAt: '2026-08-23T08:00:00.000Z' }));
		const b = createEvent(db, bottle({ startedAt: '2026-08-23T10:00:00.000Z' }));
		createEvent(db, bottle({ startedAt: '2026-08-24T10:00:00.000Z' }));
		const listed = listEvents(db, {
			babyId: 'baby-1',
			from: '2026-08-23T08:00:00.000Z',
			to: '2026-08-24T00:00:00.000Z'
		});
		expect(listed.map((e) => e.id)).toEqual([b.id, a.id]);
	});

	it('updates fields and bumps updatedAt', () => {
		const created = createEvent(db, bottle());
		const updated = updateEvent(db, created.id, { note: 'hungry night' });
		expect(updated.note).toBe('hungry night');
		expect(updated.updatedAt >= created.updatedAt).toBe(true);
	});

	it('soft-deletes (kept in DB, hidden from list) and restores', () => {
		const created = createEvent(db, bottle());
		const deleted = softDeleteEvent(db, created.id);
		expect(deleted.deletedAt).not.toBeNull();
		expect(listEvents(db, { babyId: 'baby-1' })).toHaveLength(0);
		expect(getEvent(db, created.id)?.deletedAt).not.toBeNull();
		const restored = restoreEvent(db, created.id);
		expect(restored.deletedAt).toBeNull();
		expect(listEvents(db, { babyId: 'baby-1' })).toHaveLength(1);
	});

	it('throws RepoError not_found on unknown ids', () => {
		expect(() => updateEvent(db, 'nope', { note: 'x' })).toThrowError(RepoError);
		expect(() => softDeleteEvent(db, 'nope')).toThrowError(RepoError);
		expect(() => restoreEvent(db, 'nope')).toThrowError(RepoError);
	});

	it('lists babies', () => {
		expect(listBabies(db)).toEqual([
			{ id: 'baby-1', name: 'Testine', birthdate: '2026-08-01', timezone: 'America/Toronto' }
		]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/events/repo.test.ts`
Expected: FAIL (module `./repo` not found).

- [ ] **Step 3: Implement `src/lib/server/events/repo.ts`**

```ts
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
			if (clash) throw new RepoError('timer_conflict', `an active ${current.type} timer already exists`);
		}
		db.prepare('UPDATE event SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(
			nowIso(),
			id
		);
		return getEvent(db, id)!;
	})();
}

export function listBabies(db: DB): BabyDTO[] {
	return db
		.prepare('SELECT id, name, birthdate, timezone FROM baby ORDER BY created_at')
		.all() as BabyDTO[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/events/repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/events/repo.ts src/lib/server/events/repo.test.ts
git commit -m "feat: add event repository with soft delete and restore"
```

---

### Task 3: Repository — timers and the unique-timer invariant

**Files:**
- Modify: `src/lib/server/events/repo.ts` (append)
- Test: `src/lib/server/events/repo.test.ts` (append a `describe('timers')` block)

**Interfaces:**
- Consumes: Task 2's helpers (`getEvent`, `rowToDto`, `RepoError`, `nowIso`), `TimerType`, `Side`, `NursingSegment` from `./types`.
- Produces (Tasks 6–7 call these):
  - `listActiveTimers(db, babyId?: string): EventDTO[]`
  - `startTimer(db, opts: { type: TimerType; babyId: string; caregiverId?: string | null; side?: Side | 'both'; startedAt?: string }): { created: boolean; event: EventDTO }`
  - `stopTimer(db, opts: { type: TimerType; babyId: string; endedAt?: string; volumeMl?: number | null }): EventDTO` (throws `no_active_timer`)
  - `nursingAction(db, opts: { babyId: string; action: 'pause' | 'resume' | 'switch-side'; side?: Side }): EventDTO` (throws `no_active_timer` / `invalid_state`)

- [ ] **Step 1: Write the failing tests** (append to `repo.test.ts`; reuses `db`/`seed` from Task 2)

```ts
import { listActiveTimers, startTimer, stopTimer, nursingAction } from './repo';
import type { NursingSegment } from './types';

describe('timers (FR-013, AC-004)', () => {
	it('starts a sleep timer with server start time and no end', () => {
		const { created, event } = startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		expect(created).toBe(true);
		expect(event.endedAt).toBeNull();
		expect(listActiveTimers(db, 'baby-1').map((e) => e.id)).toEqual([event.id]);
	});

	it('concurrent start returns the existing session instead of creating one', () => {
		const first = startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		const second = startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		expect(second.created).toBe(false);
		expect(second.event.id).toBe(first.event.id);
		expect(listActiveTimers(db, 'baby-1')).toHaveLength(1);
	});

	it('allows one active timer per category (sleep + nursing coexist)', () => {
		startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		expect(listActiveTimers(db, 'baby-1')).toHaveLength(2);
	});

	it('stops the active timer; stopping again throws no_active_timer', () => {
		startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		const stopped = stopTimer(db, { type: 'sleep', babyId: 'baby-1' });
		expect(stopped.endedAt).not.toBeNull();
		expect(() => stopTimer(db, { type: 'sleep', babyId: 'baby-1' })).toThrowError(RepoError);
	});

	it('pump start records side, stop records the volume', () => {
		startTimer(db, { type: 'pump', babyId: 'baby-1', side: 'both' });
		const stopped = stopTimer(db, { type: 'pump', babyId: 'baby-1', volumeMl: 120 });
		expect(stopped.details).toEqual({ side: 'both', volumeMl: 120 });
	});

	it('soft-deleting an active timer frees the slot', () => {
		const { event } = startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		softDeleteEvent(db, event.id);
		expect(startTimer(db, { type: 'sleep', babyId: 'baby-1' }).created).toBe(true);
		expect(() => restoreEvent(db, event.id)).toThrowError(RepoError); // timer_conflict
	});
});

describe('nursing session (FR-002, AC-002 segments)', () => {
	const segs = (e: { details: unknown }) => (e.details as { segments: NursingSegment[] }).segments;

	it('start opens a segment on the chosen side', () => {
		const { event } = startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		expect(segs(event)).toHaveLength(1);
		expect(segs(event)[0].side).toBe('left');
		expect(segs(event)[0].endedAt).toBeNull();
	});

	it('pause closes the open segment (paused time lives in no segment — DEC-001)', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		const paused = nursingAction(db, { babyId: 'baby-1', action: 'pause' });
		expect(segs(paused).every((s) => s.endedAt !== null)).toBe(true);
		expect(paused.endedAt).toBeNull(); // still active
	});

	it('resume opens a new segment on the last side by default', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		nursingAction(db, { babyId: 'baby-1', action: 'pause' });
		const resumed = nursingAction(db, { babyId: 'baby-1', action: 'resume' });
		expect(segs(resumed)).toHaveLength(2);
		expect(segs(resumed)[1].side).toBe('left');
		expect(segs(resumed)[1].endedAt).toBeNull();
	});

	it('switch-side closes the segment and opens the other side', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		const switched = nursingAction(db, { babyId: 'baby-1', action: 'switch-side' });
		expect(segs(switched)).toHaveLength(2);
		expect(segs(switched)[0].endedAt).not.toBeNull();
		expect(segs(switched)[1].side).toBe('right');
	});

	it('rejects pause while paused and resume while running', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		expect(() => nursingAction(db, { babyId: 'baby-1', action: 'resume' })).toThrowError(RepoError);
		nursingAction(db, { babyId: 'baby-1', action: 'pause' });
		expect(() => nursingAction(db, { babyId: 'baby-1', action: 'pause' })).toThrowError(RepoError);
	});

	it('stop closes the open segment at endedAt', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'right' });
		const stopped = stopTimer(db, { type: 'nursing', babyId: 'baby-1' });
		expect(stopped.endedAt).not.toBeNull();
		expect(segs(stopped).every((s) => s.endedAt !== null)).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/events/repo.test.ts`
Expected: FAIL (`startTimer` not exported).

- [ ] **Step 3: Implement (append to `repo.ts`)**

```ts
import type { NursingSegment, Side, TimerType } from './types';
import { TIMER_TYPES } from './types';

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
			if (openIndex !== -1) segments[openIndex] = { ...segments[openIndex], endedAt: ts };
			const nextSide: Side = opts.side ?? (lastSide === 'left' ? 'right' : 'left');
			segments.push({ side: nextSide, startedAt: ts, endedAt: null });
		}
		return updateEvent(db, event.id, { details: { segments } });
	})();
}
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS (db, types, repo).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/events/repo.ts src/lib/server/events/repo.test.ts
git commit -m "feat: enforce unique active timers and nursing segments"
```

---

### Task 4: Broadcast module

**Files:**
- Create: `src/lib/server/events/broadcast.ts`
- Test: `src/lib/server/events/broadcast.test.ts`

**Interfaces:**
- Consumes: `EventDTO` from `./types`.
- Produces (Tasks 5–7):
  - `type Change = { kind: 'created' | 'updated' | 'deleted' | 'restored'; event: EventDTO }`
  - `subscribe(listener: (c: Change) => void): () => void` (returns unsubscribe)
  - `publish(change: Change): void`

- [ ] **Step 1: Write the failing test**

`src/lib/server/events/broadcast.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { subscribe, publish, type Change } from './broadcast';
import type { EventDTO } from './types';

const change: Change = { kind: 'created', event: { id: 'e1' } as EventDTO };

describe('broadcast', () => {
	it('delivers changes to subscribers until unsubscribed', () => {
		const seen: Change[] = [];
		const unsubscribe = subscribe((c) => seen.push(c));
		publish(change);
		unsubscribe();
		publish(change);
		expect(seen).toHaveLength(1);
	});

	it('a throwing listener does not break the others', () => {
		const bad = subscribe(() => {
			throw new Error('boom');
		});
		const ok = vi.fn();
		const okUnsub = subscribe(ok);
		expect(() => publish(change)).not.toThrow();
		expect(ok).toHaveBeenCalledOnce();
		bad();
		okUnsub();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/events/broadcast.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/server/events/broadcast.ts`**

```ts
import type { EventDTO } from './types';

export type Change = {
	kind: 'created' | 'updated' | 'deleted' | 'restored';
	event: EventDTO;
};

type Listener = (change: Change) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function publish(change: Change): void {
	for (const listener of [...listeners]) {
		try {
			listener(change);
		} catch {
			// A broken SSE consumer must not affect the others.
		}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/events/broadcast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/events/broadcast.ts src/lib/server/events/broadcast.test.ts
git commit -m "feat: add in-process change broadcast"
```

---

### Task 5: HTTP routes — events CRUD and babies

**Files:**
- Create: `src/lib/server/api.ts`
- Create: `src/routes/api/babies/+server.ts`
- Create: `src/routes/api/events/+server.ts`
- Create: `src/routes/api/events/[id]/+server.ts`
- Create: `src/routes/api/events/[id]/restore/+server.ts`
- Create: `e2e/global-setup.ts`
- Modify: `playwright.config.ts` (globalSetup, workers: 1)
- Modify: `e2e/smoke.spec.ts` (setup is now seeded → `setupComplete: true`)
- Test: `e2e/api-events.spec.ts`

**Interfaces:**
- Consumes: `getDb`, Task 1–2 exports, `publish` from broadcast.
- Produces:
  - `apiError(status: number, code: string, message: string, issues?: Issue[]): Response` and `handleRepoError(e: unknown): Response` in `src/lib/server/api.ts` (Task 6 reuses both).
  - HTTP contract of the routes listed in the plan header.
  - Seeded Playwright DB: baby `baby-1` (« Testine »), caregiver `cg-1`.

- [ ] **Step 1: Write the shared HTTP helpers** — `src/lib/server/api.ts`

```ts
import { json } from '@sveltejs/kit';
import { RepoError } from './events/repo';
import type { Issue } from './events/types';

export function apiError(
	status: number,
	code: string,
	message: string,
	issues?: Issue[]
): Response {
	return json({ error: { code, message, ...(issues ? { issues } : {}) } }, { status });
}

const repoStatus: Record<RepoError['code'], number> = {
	not_found: 404,
	no_active_timer: 404,
	invalid_state: 409,
	timer_conflict: 409
};

export function handleRepoError(e: unknown): Response {
	if (e instanceof RepoError) return apiError(repoStatus[e.code], e.code, e.message);
	throw e;
}
```

- [ ] **Step 2: Write the failing Playwright tests**

`e2e/global-setup.ts`:

```ts
import { rmSync } from 'node:fs';
// Relative import: $lib aliases do not resolve in Playwright setup files.
import { openDb } from '../src/lib/server/db';

// Playwright runs this before starting the webServer: wipe the data dir from
// previous runs and seed the baby/caregiver every API test relies on.
export default function globalSetup(): void {
	rmSync('.playwright-data', { recursive: true, force: true });
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
```

`playwright.config.ts` — add both keys (single shared SQLite file + unique-timer invariant ⇒ specs must not race each other):

```ts
export default defineConfig({
	testDir: 'e2e',
	globalSetup: './e2e/global-setup.ts',
	workers: 1,
	webServer: {
		command: 'npm run build && node build',
		port: 3000,
		env: { DATA_DIR: '.playwright-data' },
		reuseExistingServer: false
	},
	use: { baseURL: 'http://localhost:3000' }
});
```

`e2e/smoke.spec.ts` — the DB is now seeded, so update the second test:

```ts
test('health endpoint reports seeded setup', async ({ request }) => {
	const res = await request.get('/api/health');
	expect(res.ok()).toBeTruthy();
	const body = await res.json();
	expect(body.status).toBe('ok');
	expect(body.setupComplete).toBe(true);
});
```

`e2e/api-events.spec.ts`:

```ts
import { expect, test, type APIRequestContext } from '@playwright/test';

const diaper = {
	babyId: 'baby-1',
	caregiverId: 'cg-1',
	type: 'diaper',
	startedAt: new Date().toISOString(),
	details: { pee: true, poo: false }
};

async function createDiaper(request: APIRequestContext) {
	const res = await request.post('/api/events', { data: diaper });
	expect(res.status()).toBe(201);
	return res.json();
}

test('lists the seeded baby', async ({ request }) => {
	const res = await request.get('/api/babies');
	expect(res.ok()).toBeTruthy();
	const { babies } = await res.json();
	expect(babies[0]).toMatchObject({ id: 'baby-1', name: 'Testine' });
});

test('creates, reads, lists, patches an event', async ({ request }) => {
	const created = await createDiaper(request);
	expect(created.id).toBeTruthy();
	expect(created.details).toEqual({ pee: true, poo: false });

	const got = await (await request.get(`/api/events/${created.id}`)).json();
	expect(got.id).toBe(created.id);

	const list = await (await request.get('/api/events?babyId=baby-1')).json();
	expect(list.events.map((e: { id: string }) => e.id)).toContain(created.id);

	const patched = await request.patch(`/api/events/${created.id}`, {
		data: { note: 'small one' }
	});
	expect(patched.status()).toBe(200);
	expect((await patched.json()).note).toBe('small one');
});

test('rejects FR-017 violations with 400 and issues (AC-010)', async ({ request }) => {
	const bad = await request.post('/api/events', {
		data: { ...diaper, type: 'bottle', details: { milkType: 'formula', volumeMl: 1500 } }
	});
	expect(bad.status()).toBe(400);
	const body = await bad.json();
	expect(body.error.code).toBe('validation_failed');
	expect(body.error.issues.length).toBeGreaterThan(0);
});

test('soft delete hides from list, restore brings back (FR-007)', async ({ request }) => {
	const created = await createDiaper(request);
	const del = await request.delete(`/api/events/${created.id}`);
	expect(del.status()).toBe(200);
	expect((await del.json()).deletedAt).not.toBeNull();

	const list = await (await request.get('/api/events?babyId=baby-1')).json();
	expect(list.events.map((e: { id: string }) => e.id)).not.toContain(created.id);

	const restored = await request.post(`/api/events/${created.id}/restore`);
	expect(restored.status()).toBe(200);
	expect((await restored.json()).deletedAt).toBeNull();
});

test('unknown event id yields 404 with error envelope', async ({ request }) => {
	const res = await request.get('/api/events/nope');
	expect(res.status()).toBe(404);
	expect((await res.json()).error.code).toBe('not_found');
});
```

- [ ] **Step 3: Run the e2e file to verify it fails**

Run: `npx playwright test e2e/api-events.spec.ts`
Expected: FAIL (404 on `/api/events`, routes not implemented).

- [ ] **Step 4: Implement the routes**

`src/routes/api/babies/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { listBabies } from '$lib/server/events/repo';

export const GET: RequestHandler = () => {
	return json({ babies: listBabies(getDb()) });
};
```

`src/routes/api/events/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError } from '$lib/server/api';
import { parseCreateEvent } from '$lib/server/events/types';
import { createEvent, listEvents } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const GET: RequestHandler = ({ url }) => {
	const babyId = url.searchParams.get('babyId');
	if (!babyId) return apiError(400, 'validation_failed', 'babyId query parameter is required');
	const events = listEvents(getDb(), {
		babyId,
		from: url.searchParams.get('from') ?? undefined,
		to: url.searchParams.get('to') ?? undefined
	});
	return json({ events });
};

export const POST: RequestHandler = async ({ request }) => {
	const parsed = parseCreateEvent(await request.json(), new Date());
	if (!parsed.ok) return apiError(400, 'validation_failed', 'invalid event', parsed.issues);
	const event = createEvent(getDb(), parsed.value);
	publish({ kind: 'created', event });
	return json(event, { status: 201 });
};
```

`src/routes/api/events/[id]/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError } from '$lib/server/api';
import {
	parseDetails,
	parsePatchEvent,
	validateEventTimes,
	type Details
} from '$lib/server/events/types';
import { getEvent, softDeleteEvent, updateEvent } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const GET: RequestHandler = ({ params }) => {
	const event = getEvent(getDb(), params.id);
	if (!event) return apiError(404, 'not_found', `no event ${params.id}`);
	return json(event);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	const current = getEvent(db, params.id);
	if (!current) return apiError(404, 'not_found', `no event ${params.id}`);

	const parsed = parsePatchEvent(await request.json());
	if (!parsed.ok) return apiError(400, 'validation_failed', 'invalid patch', parsed.issues);
	const patch = parsed.value;

	// Re-validate the merged event against FR-017 and the per-type details schema.
	const merged = {
		type: current.type,
		startedAt: patch.startedAt ?? current.startedAt,
		endedAt: patch.endedAt ?? current.endedAt
	};
	const issues = validateEventTimes(merged, new Date());
	let details: Details | undefined;
	if (patch.details !== undefined) {
		const parsedDetails = parseDetails(current.type, patch.details);
		if (!parsedDetails.ok) issues.push(...parsedDetails.issues);
		else details = parsedDetails.value;
	}
	if (issues.length > 0) return apiError(400, 'validation_failed', 'invalid patch', issues);

	try {
		const event = updateEvent(db, params.id, {
			caregiverId: patch.caregiverId === undefined ? undefined : (patch.caregiverId ?? null),
			startedAt: patch.startedAt,
			endedAt: patch.endedAt,
			note: patch.note === undefined ? undefined : (patch.note ?? null),
			details
		});
		publish({ kind: 'updated', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};

export const DELETE: RequestHandler = ({ params }) => {
	try {
		const event = softDeleteEvent(getDb(), params.id);
		publish({ kind: 'deleted', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};
```

`src/routes/api/events/[id]/restore/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { handleRepoError } from '$lib/server/api';
import { restoreEvent } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const POST: RequestHandler = ({ params }) => {
	try {
		const event = restoreEvent(getDb(), params.id);
		publish({ kind: 'restored', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};
```

- [ ] **Step 5: Run checks and the e2e file**

Run: `npm run check && npx playwright test e2e/api-events.spec.ts e2e/smoke.spec.ts`
Expected: PASS (both files, smoke updated).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/api.ts src/routes/api/babies src/routes/api/events e2e/global-setup.ts e2e/api-events.spec.ts e2e/smoke.spec.ts playwright.config.ts
git commit -m "feat: add events and babies HTTP API with seeded e2e setup"
```

---

### Task 6: HTTP routes — timers

**Files:**
- Create: `src/routes/api/timers/+server.ts`
- Create: `src/routes/api/timers/[type]/start/+server.ts`
- Create: `src/routes/api/timers/[type]/stop/+server.ts`
- Create: `src/routes/api/timers/nursing/action/+server.ts`
- Test: `e2e/api-timers.spec.ts`

**Interfaces:**
- Consumes: Task 3 repo functions, Task 5 `apiError`/`handleRepoError`, `publish`, `TIMER_TYPES`, `MAX_FUTURE_MS`.
- Produces: the `/api/timers` HTTP contract; SSE (Task 7) and UI slices consume `{ serverTime, timers }` and `{ created, event }` shapes.

- [ ] **Step 1: Write the failing Playwright tests** — `e2e/api-timers.spec.ts`

```ts
import { expect, test, type APIRequestContext } from '@playwright/test';

const start = (request: APIRequestContext, type: string, data: object = {}) =>
	request.post(`/api/timers/${type}/start`, { data: { babyId: 'baby-1', ...data } });
const stop = (request: APIRequestContext, type: string, data: object = {}) =>
	request.post(`/api/timers/${type}/stop`, { data: { babyId: 'baby-1', ...data } });

test.afterEach(async ({ request }) => {
	// Leave no active timers behind for the next test.
	for (const type of ['nursing', 'pump', 'sleep']) await stop(request, type);
});

test('start → 201, concurrent start → 200 with the same session (AC-004)', async ({ request }) => {
	const first = await start(request, 'sleep');
	expect(first.status()).toBe(201);
	const firstBody = await first.json();
	expect(firstBody.created).toBe(true);

	const second = await start(request, 'sleep');
	expect(second.status()).toBe(200);
	const secondBody = await second.json();
	expect(secondBody.created).toBe(false);
	expect(secondBody.event.id).toBe(firstBody.event.id);
});

test('GET /api/timers returns serverTime and active sessions (AC-005 recovery)', async ({
	request
}) => {
	const started = await (await start(request, 'nursing', { side: 'left' })).json();
	const res = await request.get('/api/timers?babyId=baby-1');
	const body = await res.json();
	expect(Date.parse(body.serverTime)).not.toBeNaN();
	expect(body.timers.map((t: { id: string }) => t.id)).toContain(started.event.id);
});

test('nursing pause/resume/switch-side transitions', async ({ request }) => {
	await start(request, 'nursing', { side: 'left' });
	const action = (data: object) =>
		request.post('/api/timers/nursing/action', { data: { babyId: 'baby-1', ...data } });

	expect((await action({ action: 'pause' })).status()).toBe(200);
	expect((await action({ action: 'pause' })).status()).toBe(409);
	expect((await action({ action: 'resume' })).status()).toBe(200);
	const switched = await action({ action: 'switch-side' });
	expect(switched.status()).toBe(200);
	const segments = (await switched.json()).details.segments;
	expect(segments[segments.length - 1].side).toBe('right');
});

test('stop without an active timer → 404 no_active_timer', async ({ request }) => {
	const res = await stop(request, 'pump');
	expect(res.status()).toBe(404);
	expect((await res.json()).error.code).toBe('no_active_timer');
});

test('unknown timer type → 404', async ({ request }) => {
	expect((await start(request, 'bath')).status()).toBe(404);
});

test('pump stop records volume; volume 1500 → 400 (FR-017)', async ({ request }) => {
	await start(request, 'pump', { side: 'left' });
	const bad = await stop(request, 'pump', { volumeMl: 1500 });
	expect(bad.status()).toBe(400);
	const ok = await stop(request, 'pump', { volumeMl: 120 });
	expect(ok.status()).toBe(200);
	expect((await ok.json()).details).toEqual({ side: 'left', volumeMl: 120 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test e2e/api-timers.spec.ts`
Expected: FAIL (routes missing).

- [ ] **Step 3: Implement the routes**

`src/routes/api/timers/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { listActiveTimers } from '$lib/server/events/repo';

export const GET: RequestHandler = ({ url }) => {
	const babyId = url.searchParams.get('babyId') ?? undefined;
	return json({
		serverTime: new Date().toISOString(),
		timers: listActiveTimers(getDb(), babyId)
	});
};
```

`src/routes/api/timers/[type]/start/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError } from '$lib/server/api';
import { MAX_FUTURE_MS, TIMER_TYPES, type TimerType } from '$lib/server/events/types';
import { startTimer } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

const startSchema = z.object({
	babyId: z.string().min(1),
	caregiverId: z.string().min(1).nullish(),
	side: z.enum(['left', 'right', 'both']).optional(),
	startedAt: z.iso.datetime().optional()
});

export const POST: RequestHandler = async ({ params, request }) => {
	if (!(TIMER_TYPES as readonly string[]).includes(params.type))
		return apiError(404, 'unknown_timer_type', `no timer type ${params.type}`);
	const type = params.type as TimerType;

	const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) return apiError(400, 'validation_failed', 'invalid start payload');
	const { babyId, caregiverId, side, startedAt } = parsed.data;
	if (type === 'nursing' && side === 'both')
		return apiError(400, 'validation_failed', 'nursing side must be left or right');
	if (startedAt && Date.parse(startedAt) > Date.now() + MAX_FUTURE_MS)
		return apiError(400, 'validation_failed', 'startedAt is more than 5 minutes in the future');

	try {
		const { created, event } = startTimer(getDb(), { type, babyId, caregiverId, side, startedAt });
		if (created) publish({ kind: 'created', event });
		return json({ created, event }, { status: created ? 201 : 200 });
	} catch (e) {
		return handleRepoError(e);
	}
};
```

`src/routes/api/timers/[type]/stop/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError } from '$lib/server/api';
import { MAX_FUTURE_MS, TIMER_TYPES, type TimerType } from '$lib/server/events/types';
import { stopTimer } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

const stopSchema = z.object({
	babyId: z.string().min(1),
	endedAt: z.iso.datetime().optional(),
	volumeMl: z.number().min(1).max(1000).nullish() // FR-017
});

export const POST: RequestHandler = async ({ params, request }) => {
	if (!(TIMER_TYPES as readonly string[]).includes(params.type))
		return apiError(404, 'unknown_timer_type', `no timer type ${params.type}`);
	const type = params.type as TimerType;

	const parsed = stopSchema.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) return apiError(400, 'validation_failed', 'invalid stop payload');
	const { babyId, endedAt, volumeMl } = parsed.data;
	if (endedAt && Date.parse(endedAt) > Date.now() + MAX_FUTURE_MS)
		return apiError(400, 'validation_failed', 'endedAt is more than 5 minutes in the future');

	try {
		const event = stopTimer(getDb(), { type, babyId, endedAt, volumeMl });
		publish({ kind: 'updated', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};
```

`src/routes/api/timers/nursing/action/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError } from '$lib/server/api';
import { nursingAction } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

const actionSchema = z.object({
	babyId: z.string().min(1),
	action: z.enum(['pause', 'resume', 'switch-side']),
	side: z.enum(['left', 'right']).optional()
});

export const POST: RequestHandler = async ({ request }) => {
	const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) return apiError(400, 'validation_failed', 'invalid action payload');
	try {
		const event = nursingAction(getDb(), parsed.data);
		publish({ kind: 'updated', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};
```

Note: SvelteKit routes static segments (`timers/nursing/action`) alongside the `[type]` param without conflict — `/api/timers/nursing/start` still resolves to `[type]/start`.

- [ ] **Step 4: Run checks and the timers e2e file**

Run: `npm run check && npx playwright test e2e/api-timers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/timers e2e/api-timers.spec.ts
git commit -m "feat: add timer HTTP API with unique-session start"
```

---

### Task 7: SSE stream

**Files:**
- Create: `src/routes/api/stream/+server.ts`
- Test: `e2e/api-stream.spec.ts`

**Interfaces:**
- Consumes: `subscribe` (Task 4), `listActiveTimers` (Task 3), `getDb`.
- Produces: SSE contract for UI slices —
  - on connect: `event: snapshot`, data `{ serverTime: string, activeTimers: EventDTO[] }` (FR-012 state recovery: reconnecting replays the snapshot; clients refetch `/api/events` for lists);
  - on every change: `event: sync`, data `{ kind, event, serverTime }`;
  - comment heartbeat `:ping` every 25 s.

- [ ] **Step 1: Write the failing Playwright test** — `e2e/api-stream.spec.ts`

```ts
import { expect, test } from '@playwright/test';

test('SSE sends a snapshot on connect and a sync on change (FR-012)', async ({
	request,
	baseURL
}) => {
	// The Playwright request fixture buffers responses; use Node fetch to stream.
	const res = await fetch(`${baseURL}/api/stream`, {
		headers: { accept: 'text/event-stream' }
	});
	expect(res.headers.get('content-type')).toContain('text/event-stream');
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const readUntil = async (marker: string) => {
		const deadline = Date.now() + 10_000;
		while (!buffer.includes(marker) && Date.now() < deadline) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
		}
		expect(buffer).toContain(marker);
	};

	await readUntil('event: snapshot');
	expect(buffer).toContain('"serverTime"');
	expect(buffer).toContain('"activeTimers"');

	const created = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: new Date().toISOString(),
			details: { pee: true, poo: true }
		}
	});
	expect(created.status()).toBe(201);
	const { id } = await created.json();

	await readUntil('event: sync');
	await readUntil(id);
	expect(buffer).toContain('"kind":"created"');
	await reader.cancel();
});

test('snapshot includes the active timers', async ({ request, baseURL }) => {
	const started = await request.post('/api/timers/sleep/start', { data: { babyId: 'baby-1' } });
	const { event } = await started.json();

	const res = await fetch(`${baseURL}/api/stream`);
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const deadline = Date.now() + 10_000;
	while (!buffer.includes(event.id) && Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
	}
	expect(buffer).toContain(event.id);
	await reader.cancel();
	await request.post('/api/timers/sleep/stop', { data: { babyId: 'baby-1' } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test e2e/api-stream.spec.ts`
Expected: FAIL (404 on `/api/stream`).

- [ ] **Step 3: Implement `src/routes/api/stream/+server.ts`**

```ts
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { listActiveTimers } from '$lib/server/events/repo';
import { subscribe } from '$lib/server/events/broadcast';

const PING_INTERVAL_MS = 25_000;

export const GET: RequestHandler = () => {
	const db = getDb();
	let unsubscribe: (() => void) | undefined;
	let ping: ReturnType<typeof setInterval> | undefined;
	let closed = false;

	const stream = new ReadableStream<string>({
		start(controller) {
			const send = (event: string, data: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				} catch {
					closed = true; // consumer went away between cancel and this write
				}
			};
			send('snapshot', {
				serverTime: new Date().toISOString(),
				activeTimers: listActiveTimers(db)
			});
			unsubscribe = subscribe((change) =>
				send('sync', { ...change, serverTime: new Date().toISOString() })
			);
			ping = setInterval(() => {
				if (!closed)
					try {
						controller.enqueue(`:ping\n\n`);
					} catch {
						closed = true;
					}
			}, PING_INTERVAL_MS);
		},
		cancel() {
			closed = true;
			unsubscribe?.();
			if (ping) clearInterval(ping);
		}
	});

	return new Response(stream.pipeThrough(new TextEncoderStream()), {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
};
```

- [ ] **Step 4: Run checks and the stream e2e file**

Run: `npm run check && npx playwright test e2e/api-stream.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/stream e2e/api-stream.spec.ts
git commit -m "feat: add SSE change stream with snapshot recovery"
```

---

### Task 8: Contract doc and full verification

**Files:**
- Create: `docs/api/events-api.md`
- Modify: `CLAUDE.md` (Architecture section: one line for `src/lib/server/events/` and the API routes)

**Interfaces:**
- Consumes: everything above.
- Produces: `docs/api/events-api.md` — the reference the UI slices (3–5) build against; linked from the wayfinder resolution comment.

- [ ] **Step 1: Write `docs/api/events-api.md`**

Document exactly what was implemented (verify each item against the code, do not copy blindly from this plan):

```markdown
# Events API — contract (slice 2)

All timestamps are ISO 8601 UTC. Server time is authoritative: clients compute
timer displays from `startedAt` and the latest `serverTime`, clamped to ≥ 0.
Errors: `{ error: { code, message, issues? } }`.

## EventDTO
<the DTO shape and per-type `details` schemas, incl. the nursing pause model:
active + no open segment = paused; duration = sum of segment durations>

## Endpoints
<the route table from the plan header, with per-route request/response bodies
and status codes, as implemented>

## SSE — GET /api/stream
<`snapshot` / `sync` event shapes; reconnect = new snapshot + refetch of lists;
`:ping` heartbeat every 25 s>
```

- [ ] **Step 2: Update `CLAUDE.md`** — in the Architecture section, after the `src/lib/server/db/` bullet, add:

```markdown
- `src/lib/server/events/` — domain des événements : `types.ts` (zod, FR-017),
  `repo.ts` (CRUD, soft delete, minuteurs uniques FR-013), `broadcast.ts`
  (fan-out SSE). Routes : `/api/babies`, `/api/events[...]`, `/api/timers[...]`,
  `/api/stream` (SSE) — contrat détaillé dans `docs/api/events-api.md`.
```

- [ ] **Step 3: Full verification**

Run: `npm run check && npm run test:unit && npm run test:e2e`
Expected: all PASS. Fix anything that fails before committing.

- [ ] **Step 4: Commit**

```bash
git add docs/api/events-api.md CLAUDE.md
git commit -m "docs: document the events API contract"
```

---

## Self-review notes (already applied)

- FR-013 lives in `startTimer`/`restoreEvent` transactions (single better-sqlite3 connection, synchronous — atomic within the one server process; adapter-node runs one process, cf. ADR 0001).
- FR-017 is enforced at both entry points: `parseCreateEvent`/`parsePatchEvent` + zod schemas on timer routes (volume bounds on `stop`, future bound on `startedAt`/`endedAt`).
- FR-012: writes via HTTP only; SSE `sync` broadcasts every mutation (create/update/delete/restore, timer start/stop/action); reconnect gets a fresh `snapshot`; `serverTime` on every payload (RISK-001).
- FR-006/FR-007: manual creation via `POST /api/events`; edit via PATCH; soft delete + restore.
- Out of scope for this slice: summaries (FR-010), UI, PIN, exports, setup wizard — later slices.
