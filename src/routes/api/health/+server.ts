import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { isSetupComplete } from '$lib/server/setup';

export function GET() {
	return json({ status: 'ok', setupComplete: isSetupComplete(getDb()) });
}
