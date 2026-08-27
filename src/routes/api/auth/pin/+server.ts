import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	INVALID_CONTENT_TYPE_ISSUE,
	apiError,
	isJsonContentType,
	readJson
} from '$lib/server/api';
import { handler } from '$lib/server/http';
import { zodIssues } from '$lib/server/events/types';
import { getPinHash } from '$lib/server/settings/repo';
import {
	SESSION_COOKIE,
	pinThrottle,
	sessionCookieOptions,
	sessionToken,
	verifyPin
} from '$lib/server/settings/auth';

const schema = z.object({ pin: z.string() });

// The throttle answers before the body is read, and the same `now` records the
// failure, so this route validates its body inside `run` instead of declaring
// a schema.
export const POST: RequestHandler = handler({
	run: async ({ db, request, cookies, url }) => {
		const now = Date.now();
		if (pinThrottle.isLocked(now))
			return apiError(429, 'too_many_attempts', 'too many attempts, try again shortly');

		// The same content-type gate the skeleton applies to declared schemas —
		// checked after the throttle (it must answer first) and before the read.
		if (!isJsonContentType(request.headers.get('content-type')))
			return apiError(400, 'validation_failed', 'invalid pin', [INVALID_CONTENT_TYPE_ISSUE]);

		const body = await readJson(request);
		if (!body.ok) return apiError(400, 'validation_failed', 'invalid pin', body.issues);

		const parsed = schema.safeParse(body.value);
		if (!parsed.success)
			return apiError(400, 'validation_failed', 'invalid pin', zodIssues(parsed.error));

		const pinHash = getPinHash(db);
		if (pinHash === null || !verifyPin(parsed.data.pin, pinHash)) {
			pinThrottle.recordFailure(now);
			return apiError(403, 'forbidden', 'incorrect pin');
		}
		pinThrottle.recordSuccess();

		cookies.set(SESSION_COOKIE, sessionToken(pinHash), sessionCookieOptions(url));
		return json({ ok: true });
	}
});
