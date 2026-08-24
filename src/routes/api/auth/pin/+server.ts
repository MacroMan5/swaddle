import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, readJson } from '$lib/server/api';
import { getPinHash } from '$lib/server/settings/repo';
import {
	SESSION_COOKIE,
	pinThrottle,
	sessionCookieOptions,
	sessionToken,
	verifyPin
} from '$lib/server/settings/auth';

const schema = z.object({ pin: z.string() });

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const now = Date.now();
	if (pinThrottle.isLocked(now))
		return apiError(429, 'too_many_attempts', 'too many attempts, try again shortly');

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
	if (pinHash === null || !verifyPin(parsed.data.pin, pinHash)) {
		pinThrottle.recordFailure(now);
		return apiError(403, 'forbidden', 'incorrect pin');
	}
	pinThrottle.recordSuccess();

	cookies.set(SESSION_COOKIE, sessionToken(pinHash), sessionCookieOptions(url));
	return json({ ok: true });
};
