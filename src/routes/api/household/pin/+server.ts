import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { apiError } from '$lib/server/api';
import { handler } from '$lib/server/http';
import { getPinHash, setPinHash } from '$lib/server/settings/repo';
import {
	PIN_SCHEMA,
	SESSION_COOKIE,
	hashPin,
	sessionCookieOptions,
	sessionToken,
	verifyPin
} from '$lib/server/settings/auth';

const putSchema = z.object({ pin: PIN_SCHEMA, currentPin: z.string().optional() });

export const PUT: RequestHandler = handler({
	schema: putSchema,
	invalidMessage: 'invalid pin',
	run: ({ db, body, cookies, url }) => {
		const existing = getPinHash(db);
		if (existing !== null) {
			if (!body.currentPin || !verifyPin(body.currentPin, existing))
				return apiError(403, 'forbidden', 'current pin is required to change it');
		}

		const newHash = hashPin(body.pin);
		setPinHash(db, newHash);
		// The device that sets/changes the pin stays signed in.
		cookies.set(SESSION_COOKIE, sessionToken(newHash), sessionCookieOptions(url));
		return json({ ok: true });
	}
});

const deleteSchema = z.object({ currentPin: z.string() });

export const DELETE: RequestHandler = handler({
	schema: deleteSchema,
	invalidMessage: 'invalid request',
	run: ({ db, body, cookies }) => {
		const existing = getPinHash(db);
		if (existing !== null && !verifyPin(body.currentPin, existing))
			return apiError(403, 'forbidden', 'current pin is required to disable it');

		setPinHash(db, null);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return json({ ok: true });
	}
});
