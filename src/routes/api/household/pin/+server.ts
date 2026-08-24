import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, readJson } from '$lib/server/api';
import { getPinHash, setPinHash } from '$lib/server/settings/repo';
import { PIN_SCHEMA, SESSION_COOKIE, hashPin, sessionToken, verifyPin } from '$lib/server/settings/auth';

const YEAR_S = 60 * 60 * 24 * 365;

const putSchema = z.object({ pin: PIN_SCHEMA, currentPin: z.string().optional() });

export const PUT: RequestHandler = async ({ request, cookies }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid pin', body.issues);

	const parsed = putSchema.safeParse(body.value);
	if (!parsed.success)
		return apiError(
			400,
			'validation_failed',
			'invalid pin',
			parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
		);

	const db = getDb();
	const existing = getPinHash(db);
	if (existing !== null) {
		if (!parsed.data.currentPin || !verifyPin(parsed.data.currentPin, existing))
			return apiError(403, 'forbidden', 'current pin is required to change it');
	}

	const newHash = hashPin(parsed.data.pin);
	setPinHash(db, newHash);
	// The device that sets/changes the pin stays signed in.
	cookies.set(SESSION_COOKIE, sessionToken(newHash), {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: YEAR_S
	});
	return json({ ok: true });
};

const deleteSchema = z.object({ currentPin: z.string() });

export const DELETE: RequestHandler = async ({ request, cookies }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid request', body.issues);

	const parsed = deleteSchema.safeParse(body.value);
	if (!parsed.success)
		return apiError(
			400,
			'validation_failed',
			'invalid request',
			parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
		);

	const db = getDb();
	const existing = getPinHash(db);
	if (existing !== null && !verifyPin(parsed.data.currentPin, existing))
		return apiError(403, 'forbidden', 'current pin is required to disable it');

	setPinHash(db, null);
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
