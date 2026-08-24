import { redirect, type Handle } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { isSetupComplete } from '$lib/server/setup';
import { apiError } from '$lib/server/api';
import { SESSION_COOKIE } from '$lib/server/settings/auth';
import { getPinHash } from '$lib/server/settings/repo';
import { gateDecision } from '$lib/server/settings/gate';

export const handle: Handle = ({ event, resolve }) => {
	const db = getDb();
	const pathname = event.url.pathname;
	const isApi = pathname.startsWith('/api/');

	const decision = gateDecision({
		pathname,
		setupComplete: isSetupComplete(db),
		pinHash: getPinHash(db),
		sessionCookie: event.cookies.get(SESSION_COOKIE)
	});

	// The setup gate only ever redirects pages: /api/* writes stay available so
	// the seeded main server and the wizard's own API calls keep working.
	if (decision === 'to-setup') {
		if (isApi) return resolve(event);
		throw redirect(303, '/setup');
	}

	if (decision === 'to-pin') {
		if (isApi) return apiError(401, 'pin_required', 'a valid pin session is required');
		throw redirect(303, '/pin');
	}

	return resolve(event);
};
