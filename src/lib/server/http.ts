import type { z } from 'zod';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import type Database from 'better-sqlite3';
import { getDb } from './db';
import { apiError, handleRepoError, readJson } from './api';
import { zodIssues, type Result } from './events/types';

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
	const { schema, invalidMessage = 'invalid request body', detail = 'issues', run } = options;

	return async (event) => {
		let body = {} as B;
		if (schema) {
			const raw = await readJson(event.request);
			if (!raw.ok) return apiError(400, 'validation_failed', invalidMessage, raw.issues);

			const parsed = parseBody(schema, raw.value);
			if (!parsed.ok)
				return apiError(
					400,
					'validation_failed',
					invalidMessage,
					detail === 'issues' ? parsed.issues : undefined
				);
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
			cookies: event.cookies
		};

		try {
			return await run(ctx);
		} catch (e) {
			return handleRepoError(e);
		}
	};
}
