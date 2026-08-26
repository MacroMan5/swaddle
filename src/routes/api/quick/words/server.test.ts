import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '$lib/server/db';

let db: Database.Database;

vi.mock('$lib/server/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/db')>();
	return { ...actual, getDb: () => db };
});

const { GET, POST } = await import('./+server');
const { DELETE } = await import('./[id]/+server');

function request(method: string, body?: unknown, id?: string) {
	const url = `http://localhost/api/quick/words${id ? `/${id}` : ''}`;
	const req = new Request(url, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	const event = { request: req, params: id ? { id } : {}, url: new URL(url), locals: {} } as never;
	if (method === 'GET') return GET(event);
	if (method === 'DELETE') return DELETE(event);
	return POST(event);
}

const list = async () => (await (await request('GET')).json()).words as { word: string }[];

beforeEach(() => {
	db = openDb(':memory:');
});

describe('/api/quick/words', () => {
	it('lists the vocabulary seeded by the migration, intents parsed', async () => {
		const response = await request('GET');

		expect(response.status).toBe(200);
		const { words } = await response.json();
		expect(words.map((w: { word: string }) => w.word)).toContain('biberon');
		expect(words.find((w: { word: string }) => w.word === 'caca').intent).toEqual({
			action: 'diaper',
			kind: 'dirty'
		});
	});

	it('adds a synonym, normalising what was typed', async () => {
		const response = await request('POST', { word: ' Nini ', intent: { action: 'nursing' } });

		expect(response.status).toBe(201);
		const created = await response.json();
		expect(created.word).toBe('nini');
		expect(created.intent).toEqual({ action: 'nursing' });
		expect((await list()).map((w) => w.word)).toContain('nini');
	});

	it('refuses a word already taken in its normalised form with 409 duplicate_word', async () => {
		const response = await request('POST', { word: 'Néné', intent: { action: 'nursing' } });

		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('duplicate_word');
	});

	it.each([
		[{ word: '', intent: { action: 'sleep' } }, 'an empty word'],
		[{ word: 'gros caca', intent: { action: 'diaper', kind: 'dirty' } }, 'two words'],
		// Punctuation inside a word splits it in two once tokenised, so it could
		// never be the whole word a sentence is matched against.
		[{ word: 'petit-dodo', intent: { action: 'sleep' } }, 'a hyphenated pair'],
		[{ word: "l'ete", intent: { action: 'sleep' } }, 'an elided pair'],
		[{ word: '!', intent: { action: 'sleep' } }, 'punctuation alone'],
		[{ word: 'nini' }, 'no intent'],
		[{ word: 'nini', intent: { action: 'burp' } }, 'an unknown action'],
		[{ word: 'nini', intent: { action: 'diaper' } }, 'a diaper without its kind']
	])('refuses %j — %s — with 400 validation_failed', async (body, _why) => {
		const response = await request('POST', body);

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('validation_failed');
	});

	it('stores the word as a dictation would be tokenised, trailing punctuation dropped', async () => {
		const created = await (
			await request('POST', { word: 'Nini !', intent: { action: 'nursing' } })
		).json();

		// Stored the way `parsePhrase` will see it, so the word really matches.
		expect(created.word).toBe('nini');
	});

	it('keeps only the action of an intent: a word never carries a modifier', async () => {
		const created = await (
			await request('POST', { word: 'nini', intent: { action: 'bottle', volumeMl: 120 } })
		).json();

		// The volume comes from the sentence that was dictated, never from here.
		expect(created.intent).toEqual({ action: 'bottle' });
	});

	it('deletes a word', async () => {
		const created = await (
			await request('POST', { word: 'nini', intent: { action: 'sleep' } })
		).json();

		const response = await request('DELETE', undefined, created.id);

		expect(response.status).toBe(204);
		expect((await list()).map((w) => w.word)).not.toContain('nini');
	});

	it('answers 404 for a word that does not exist', async () => {
		const response = await request('DELETE', undefined, 'nope');

		expect(response.status).toBe(404);
		expect((await response.json()).error.code).toBe('not_found');
	});
});
