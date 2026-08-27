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
	init: { body?: string; params?: Record<string, string>; contentType?: string | null } = {}
): Promise<Response> {
	const contentType = init.contentType === undefined ? 'application/json' : init.contentType;
	const request = new Request('http://localhost/api/test', {
		method: 'POST',
		...(contentType === null ? {} : { headers: { 'content-type': contentType } }),
		...(init.body === undefined ? {} : { body: init.body })
	});
	// undici invents text/plain for a string body, like a browser would.
	if (contentType === null) request.headers.delete('content-type');
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

	// The adapter happens to skip the body when content-type is missing
	// (get_raw_body returns null), which would surface as a misleading
	// invalid_json for perfectly valid JSON. The skeleton owns the rule
	// instead: a declared schema demands `application/json`, said plainly.
	describe('the content-type gate', () => {
		const make = () => handler({ schema, invalidMessage: 'invalid thing', run: ok });

		it.each([
			[null, 'a missing header'],
			['text/plain', "a browser fetch's invented default"],
			['application/x-www-form-urlencoded', 'a form post']
		])('refuses %s — %s — before reading the body', async (contentType, _why) => {
			const response = await call(make(), { body: '{"name":"a"}', contentType });

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: {
					code: 'validation_failed',
					message: 'invalid thing',
					issues: [
						{
							path: '',
							code: 'invalid_content_type',
							message: 'content-type must be application/json'
						}
					]
				}
			});
		});

		it('accepts a charset parameter and case differences', async () => {
			const response = await call(make(), {
				body: '{"name":"a"}',
				contentType: 'Application/JSON; charset=utf-8'
			});
			expect(response.status).toBe(204);
		});

		it('carries invalidExtra like the other skeleton 400s', async () => {
			const response = await call(
				handler({ schema, invalidMessage: 'invalid thing', invalidExtra: { speech: 'Pardon ?' }, run: ok }),
				{ body: '{"name":"a"}', contentType: null }
			);

			expect(response.status).toBe(400);
			const parsed = await response.json();
			expect(parsed.speech).toBe('Pardon ?');
			expect(parsed.error.issues[0].code).toBe('invalid_content_type');
		});

		it('does not gate a schemaless route, which never reads the body', async () => {
			const response = await call(handler({ run: ok }), { body: '{"x":1}', contentType: null });
			expect(response.status).toBe(204);
		});
	});

	// Issue #115: a voice client reads the same top-level `speech` whatever the
	// status, so the skeleton's own 400 must be able to carry one too.
	it('merges invalidExtra into the root of both 400 envelopes', async () => {
		const make = () =>
			handler({ schema, invalidMessage: 'invalid thing', invalidExtra: { speech: 'Pardon ?' }, run: ok });

		const unreadable = await call(make(), { body: '{ not json' });
		expect(unreadable.status).toBe(400);
		expect(await unreadable.json()).toEqual({
			error: {
				code: 'validation_failed',
				message: 'invalid thing',
				issues: [{ path: '', code: 'invalid_json', message: 'request body is not valid JSON' }]
			},
			speech: 'Pardon ?'
		});

		const refused = await call(make(), { body: '{"name":42}' });
		expect(refused.status).toBe(400);
		const body = await refused.json();
		expect(body.speech).toBe('Pardon ?');
		expect(body.error.code).toBe('validation_failed');
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
