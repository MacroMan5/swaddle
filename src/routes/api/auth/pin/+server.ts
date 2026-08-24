import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, readJson } from '$lib/server/api';
import { getPinHash } from '$lib/server/settings/repo';
import { SESSION_COOKIE, sessionToken, verifyPin } from '$lib/server/settings/auth';

const YEAR_S = 60 * 60 * 24 * 365;

const schema = z.object({ pin: z.string() });

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid pin', body.issues);

	const parsed = schema.safeParse(body.value);
	if (!parsed.success)
		return apiError(
			400,
			'validation_failed',
			'invalid pin',
			parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
		);

	const pinHash = getPinHash(getDb());
	if (pinHash === null || !verifyPin(parsed.data.pin, pinHash))
		return apiError(403, 'forbidden', 'incorrect pin');

	cookies.set(SESSION_COOKIE, sessionToken(pinHash), {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: YEAR_S
	});
	return json({ ok: true });
};
