import type { z } from 'zod';
import { json, type Cookies, type RequestEvent } from '@sveltejs/kit';
import type Database from 'better-sqlite3';
import { MAX_BODY_BYTES } from '$lib/limits';
import { getDb } from './db';
import { apiError, handleRepoError, isPayloadTooLarge, payloadTooLarge, readJson } from './api';
import { zodIssues, type Issue, type Result } from './events/types';

/**
 * The body validator: either a zod schema or any function returning a
 * `Result` — the event domain validates with hand-rolled parsers
 * (`parseCreateEvent`, `parsePatchEvent`) rather than a bare schema.
 */
export type BodySchema<B> = z.ZodType<B> | ((value: unknown) => Result<B>);

export type HandlerContext<B> = {
	/** The shared connection, opened at most once per request. */
	readonly db: Database.Database;
	body: B;
	params: Record<string, string>;
	url: URL;
	request: Request;
	cookies: Cookies;
	/** What `hooks.server.ts` resolved about the caller — the Bearer token and
	 * the caregiver it is linked to (issue #97). */
	locals: App.Locals;
};

export type HandlerOptions<B> = {
	/** Omitted: the body is never read and `ctx.body` is `{}`. */
	schema?: BodySchema<B>;
	/** Message of the 400 envelope for an unreadable body or a schema failure. */
	invalidMessage?: string;
	/**
	 * `'issues'` (default) attaches the validation issues to the error body;
	 * `'message'` keeps the message alone — the contract three timer routes
	 * shipped with.
	 */
	detail?: 'issues' | 'message';
	/**
	 * Fields merged into the root of the skeleton's own 400 envelope (unreadable
	 * body or schema failure). The quick route rides a `speech` on it so a voice
	 * client reads the same field whatever the status (issue #115).
	 */
	invalidExtra?: Record<string, unknown>;
	run: (ctx: HandlerContext<B>) => Response | Promise<Response>;
};

/** Accepts both validator shapes and normalises them to a `Result`. */
function parseBody<B>(schema: BodySchema<B>, value: unknown): Result<B> {
	if (typeof schema === 'function') return schema(value);
	const parsed = schema.safeParse(value);
	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, issues: zodIssues(parsed.error) };
}

/**
 * The skeleton every `/api` route repeated: read and validate the body, resolve
 * the database, run the route, map repository errors onto their status.
 * Anything else — unknown timer types, missing query parameters, pin throttling
 * — stays an explicit guard inside `run`.
 */
export function handler<B = Record<string, never>>(
	options: HandlerOptions<B>
): (event: RequestEvent<Record<string, string>>) => Promise<Response> {
	const {
		schema,
		invalidMessage = 'invalid request body',
		detail = 'issues',
		invalidExtra,
		run
	} = options;

	// The skeleton's 400, with the route's extra root fields when it declared
	// some — `apiError` otherwise, so the envelope stays built in one place.
	const invalid = (issues?: Issue[]): Response =>
		invalidExtra === undefined
			? apiError(400, 'validation_failed', invalidMessage, issues)
			: json(
					{
						error: { code: 'validation_failed', message: invalidMessage, ...(issues ? { issues } : {}) },
						...invalidExtra
					},
					{ status: 400 }
				);

	return async (event) => {
		let body = {} as B;
		if (schema) {
			// The application's own bound (issue #45), independent of how
			// `BODY_SIZE_LIMIT` is configured. An announced content-length is the
			// cheap case: refused before a byte is read. A missing or unparsable
			// header (chunked request) means "unknown", not "empty" — `readJson`
			// then measures what it actually read and throws, so the bound holds
			// either way.
			const declared = Number(event.request.headers.get('content-length') ?? Number.NaN);
			if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return payloadTooLarge();

			let raw: Result<unknown>;
			try {
				raw = await readJson(event.request);
			} catch (e) {
				if (isPayloadTooLarge(e)) return payloadTooLarge();
				throw e;
			}
			if (!raw.ok) return invalid(raw.issues);

			const parsed = parseBody(schema, raw.value);
			if (!parsed.ok) return invalid(detail === 'issues' ? parsed.issues : undefined);
			body = parsed.value;
		}

		// Lazy so a route that never touches the database (server-info) keeps
		// not touching it; memoised so `ctx.db` is one connection per request.
		let db: Database.Database | undefined;
		const ctx: HandlerContext<B> = {
			get db() {
				return (db ??= getDb());
			},
			body,
			params: event.params,
			url: event.url,
			request: event.request,
			cookies: event.cookies,
			locals: event.locals
		};

		try {
			return await run(ctx);
		} catch (e) {
			return handleRepoError(e);
		}
	};
}
