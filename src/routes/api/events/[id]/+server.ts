import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError } from '$lib/server/api';
import {
	parseDetails,
	parsePatchEvent,
	validateEventTimes,
	type Details
} from '$lib/server/events/types';
import { getEvent, softDeleteEvent, updateEvent } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const GET: RequestHandler = ({ params }) => {
	const event = getEvent(getDb(), params.id);
	if (!event) return apiError(404, 'not_found', `no event ${params.id}`);
	return json(event);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	const current = getEvent(db, params.id);
	if (!current) return apiError(404, 'not_found', `no event ${params.id}`);

	const parsed = parsePatchEvent(await request.json());
	if (!parsed.ok) return apiError(400, 'validation_failed', 'invalid patch', parsed.issues);
	const patch = parsed.value;

	// Re-validate the merged event against FR-017 and the per-type details schema.
	const merged = {
		type: current.type,
		startedAt: patch.startedAt ?? current.startedAt,
		endedAt: patch.endedAt ?? current.endedAt
	};
	const issues = validateEventTimes(merged, new Date());
	let details: Details | undefined;
	if (patch.details !== undefined) {
		const parsedDetails = parseDetails(current.type, patch.details);
		if (!parsedDetails.ok) issues.push(...parsedDetails.issues);
		else details = parsedDetails.value;
	}
	if (issues.length > 0) return apiError(400, 'validation_failed', 'invalid patch', issues);

	try {
		const event = updateEvent(db, params.id, {
			caregiverId: patch.caregiverId === undefined ? undefined : (patch.caregiverId ?? null),
			startedAt: patch.startedAt,
			endedAt: patch.endedAt,
			note: patch.note === undefined ? undefined : (patch.note ?? null),
			details
		});
		publish({ kind: 'updated', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};

export const DELETE: RequestHandler = ({ params }) => {
	try {
		const event = softDeleteEvent(getDb(), params.id);
		publish({ kind: 'deleted', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};
