import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '$lib/server/db';

let db: Database.Database;

vi.mock('$lib/server/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/db')>();
	return { ...actual, getDb: () => db };
});

const { POST } = await import('./+server');

function seed(babies: string[]) {
	const now = new Date().toISOString();
	for (const [i, id] of babies.entries())
		db.prepare(
			'INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES (?, ?, ?, ?, ?)'
		).run(id, `Bébé ${i + 1}`, '2026-08-01', 'America/Toronto', now);
	db.prepare('INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
		'cg-1',
		'Parent',
		'#4f8a8b',
		now
	);
}

function post(body: unknown, caregiverId: string | null = null) {
	const request = new Request('http://localhost/api/quick', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return POST({
		request,
		params: {},
		url: new URL(request.url),
		locals: { apiToken: caregiverId === null ? null : { tokenId: 't-1', caregiverId } }
	} as never);
}

beforeEach(() => {
	db = openDb(':memory:');
	seed(['baby-1']);
});

describe('POST /api/quick', () => {
	it('logs an intent and answers with the event, what it did and what to say', async () => {
		const response = await post({ action: 'bottle', volumeMl: 120 }, 'cg-1');

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.did).toBe('logged');
		expect(body.speech).toBe('Biberon 120 millilitres enregistré');
		expect(body.event.type).toBe('bottle');
		// The caregiver comes from the credential, never from the payload.
		expect(body.event.caregiverId).toBe('cg-1');
	});

	it.each([
		[{ action: 'bottle' }, 'a bottle without its volume'],
		[{ action: 'bottle', volumeMl: 5000 }, 'a volume outside FR-017 bounds'],
		[{ action: 'diaper', kind: 'soggy' }, 'an unknown diaper kind'],
		[{ action: 'nursing', side: 'middle' }, 'an unknown nursing side'],
		[{ action: 'burp' }, 'an unknown action'],
		[{}, 'no action at all']
	])('refuses %j — %s — with 400 validation_failed', async (body, _why) => {
		const response = await post(body);

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('validation_failed');
	});

	it('answers 409 ambiguous_baby when the household has several babies', async () => {
		db = openDb(':memory:');
		seed(['baby-1', 'baby-2']);

		const response = await post({ action: 'sleep' });

		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('ambiguous_baby');
	});
});

// Issue #99: the free-text intent, refused with a status a client can branch on
// and a `speech` it can read out loud whatever the status.
describe('POST /api/quick — phrase', () => {
	it('performs a dictated sentence like the intent it resolves to', async () => {
		const response = await post({ action: 'phrase', text: 'Caca !' }, 'cg-1');

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.did).toBe('logged');
		expect(body.speech).toBe('Couche caca enregistrée');
		expect(body.event.caregiverId).toBe('cg-1');
	});

	it('answers 422 unrecognized_phrase, with something to say', async () => {
		const response = await post({ action: 'phrase', text: 'bonjour' });

		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error.code).toBe('unrecognized_phrase');
		expect(body.speech).toBe("Je n'ai pas compris “bonjour”");
	});

	it('answers 422 missing_volume for a bottle with no number', async () => {
		const response = await post({ action: 'phrase', text: 'biberon' });

		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error.code).toBe('missing_volume');
		expect(body.speech).toBe('Il me faut le volume du biberon');
	});

	it('answers 422 invalid_volume for a decimal volume', async () => {
		const response = await post({ action: 'phrase', text: 'biberon 120,5' });

		expect(response.status).toBe(422);
		const body = await response.json();
		expect(body.error.code).toBe('invalid_volume');
		expect(body.speech).toBe('Le volume doit être un nombre entier de millilitres');
	});

	it('refuses a phrase that is not a string with 400', async () => {
		const response = await post({ action: 'phrase' });

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('validation_failed');
	});
});
