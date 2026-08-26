import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { RequestEvent } from '@sveltejs/kit';
import { MAX_BODY_BYTES } from '$lib/limits';
import { readJson } from './api';
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

	// Issue #45: the bound holds whether or not the request announces its size,
	// and whether the body is read by the skeleton or by the route itself.
	describe('the 10 MiB body bound', () => {
		const oversized = `{"pad":"${'x'.repeat(MAX_BODY_BYTES)}"}`;

		async function expectRefused(response: Response) {
			expect(response.status).toBe(413);
			const { error } = await response.json();
			expect(error.code).toBe('payload_too_large');
		}

		it('refuses a body whose content-length already exceeds it', async () => {
			let read = false;
			const request = new Request('http://localhost/api/test', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'content-length': String(MAX_BODY_BYTES + 1) },
				body: '{"name":"a"}'
			});
			const response = await handler({
				schema,
				run: () => {
					read = true;
					return ok();
				}
			})({
				request,
				params: {},
				url: new URL(request.url),
				cookies: {} as RequestEvent['cookies']
			} as RequestEvent<Record<string, string>>);

			await expectRefused(response);
			expect(read, 'the route must not run').toBe(false);
		});

		it('refuses an oversized body that announced no content-length', async () => {
			// A chunked request: nothing before the read can size it, so the bound
			// is enforced on what was actually received.
			const request = {
				headers: new Headers({ 'content-type': 'application/json' }),
				text: () => Promise.resolve(oversized)
			} as unknown as Request;
			await expectRefused(
				await handler({ schema, run: ok })({
					request,
					params: {},
					url: new URL('http://localhost/api/test'),
					cookies: {} as RequestEvent['cookies']
				} as RequestEvent<Record<string, string>>)
			);
		});

		it('refuses one read inside run (the pin route shape) instead of answering 500', async () => {
			const request = {
				headers: new Headers({ 'content-type': 'application/json' }),
				text: () => Promise.resolve(oversized)
			} as unknown as Request;
			await expectRefused(
				await handler({
					run: async (ctx) => {
						await readJson(ctx.request);
						return ok();
					}
				})({
					request,
					params: {},
					url: new URL('http://localhost/api/test'),
					cookies: {} as RequestEvent['cookies']
				} as RequestEvent<Record<string, string>>)
			);
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

	it('maps a unique-index violation onto 409 timer_conflict', async () => {
		const response = await call(
			handler({
				run: () => {
					throw Object.assign(new Error('UNIQUE constraint failed'), {
						code: 'SQLITE_CONSTRAINT_UNIQUE'
					});
				}
			})
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: 'timer_conflict',
				message: 'an active timer already exists for this baby and type'
			}
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
