import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { RequestEvent } from '@sveltejs/kit';
import { RepoError } from './events/repo';

// The handler only hands `ctx.db` over to the route; keep the test off disk.
const fakeDb = { marker: 'db' };
vi.mock('$lib/server/db', () => ({ getDb: () => fakeDb }));

const { handler } = await import('./http');

type AnyHandler = (event: RequestEvent<Record<string, string>>) => Promise<Response>;

function call(
	run: AnyHandler,
	init: { body?: string; params?: Record<string, string> } = {}
): Promise<Response> {
	const request = new Request('http://localhost/api/test', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		...(init.body === undefined ? {} : { body: init.body })
	});
	return run({
		request,
		params: init.params ?? {},
		url: new URL(request.url),
		cookies: {} as RequestEvent['cookies']
	} as RequestEvent<Record<string, string>>);
}

const schema = z.object({ name: z.string() });
const ok = () => new Response(null, { status: 204 });

describe('handler', () => {
	it('rejects an unreadable body with the readJson issue', async () => {
		const response = await call(handler({ schema, invalidMessage: 'invalid thing', run: ok }), {
			body: '{ not json'
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: 'validation_failed',
				message: 'invalid thing',
				issues: [{ path: '', code: 'invalid_json', message: 'request body is not valid JSON' }]
			}
		});
	});

	it('attaches the schema issues by default', async () => {
		const response = await call(handler({ schema, invalidMessage: 'invalid thing', run: ok }), {
			body: '{"name":42}'
		});

		expect(response.status).toBe(400);
		const { error } = await response.json();
		expect(error.message).toBe('invalid thing');
		expect(error.issues).toHaveLength(1);
		expect(error.issues[0].path).toBe('name');
	});

	it("omits them in 'message' mode — the contract three timer routes shipped with", async () => {
		const response = await call(
			handler({ schema, invalidMessage: 'invalid thing', detail: 'message', run: ok }),
			{ body: '{"name":42}' }
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: 'validation_failed', message: 'invalid thing' }
		});
	});

	it('accepts a Result-returning validator', async () => {
		const response = await call(
			handler<{ n: number }>({
				schema: () => ({ ok: false, issues: [{ path: 'n', code: 'custom', message: 'nope' }] }),
				invalidMessage: 'invalid thing',
				run: ok
			}),
			{ body: '{}' }
		);

		expect(await response.json()).toEqual({
			error: {
				code: 'validation_failed',
				message: 'invalid thing',
				issues: [{ path: 'n', code: 'custom', message: 'nope' }]
			}
		});
	});

	it('maps a RepoError onto its status', async () => {
		const response = await call(
			handler({
				run: () => {
					throw new RepoError('in_use', 'caregiver is in use');
				}
			})
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'in_use', message: 'caregiver is in use' }
		});
	});

	it('rethrows an unknown error so SvelteKit still answers 500', async () => {
		const boom = new Error('boom');
		await expect(
			call(
				handler({
					run: () => {
						throw boom;
					}
				})
			)
		).rejects.toBe(boom);
	});

	it('passes the response through untouched', async () => {
		const noContent = await call(handler({ run: ok }));
		expect(noContent.status).toBe(204);
		expect(await noContent.text()).toBe('');

		const csv = await call(
			handler({
				run: () => new Response('a,b\n1,2\n', { headers: { 'content-type': 'text/csv' } })
			})
		);
		expect(csv.headers.get('content-type')).toBe('text/csv');
		expect(await csv.text()).toBe('a,b\n1,2\n');
	});

	it('provides params, the database, and an empty body when no schema is declared', async () => {
		const seen: { db?: unknown; body?: unknown; id?: string } = {};
		const response = await call(
			handler({
				run: ({ db, body, params }) => {
					Object.assign(seen, { db, body, id: params.id });
					return ok();
				}
			}),
			// A body that would fail to parse: without a schema it is never read.
			{ body: '{ not json', params: { id: 'ev-1' } }
		);

		expect(response.status).toBe(204);
		expect(seen.db).toBe(fakeDb);
		expect(seen.body).toEqual({});
		expect(seen.id).toBe('ev-1');
	});
});
