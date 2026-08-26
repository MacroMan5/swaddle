import { expect, test } from '@playwright/test';

import { BASE_A } from './ports';

const A = BASE_A;

// Server A is seeded and has no PIN by default. A Bearer only proves its worth
// while a code is set — that is the whole scenario: a headless shortcut, no
// cookie, a locked app. The PIN is always removed again so later specs see the
// pristine server.
test('AC: a headless client logs and toggles through /api/quick with a Bearer alone', async ({
	request
}) => {
	const created = await request.post(`${A}/api/tokens`, { data: { name: 'Raccourci e2e' } });
	expect(created.status()).toBe(201);
	const { plaintext, token } = await created.json();

	const babies = await (await request.get(`${A}/api/babies`)).json();
	const babyId = babies.babies[0].id;

	await request.put(`${A}/api/household/pin`, { data: { pin: '1357' } });
	const quick = (body: unknown) =>
		// Bare fetch, not the `request` fixture: it carries no session cookie, so
		// this is a genuine headless client.
		fetch(`${A}/api/quick`, {
			method: 'POST',
			headers: { authorization: `Bearer ${plaintext}`, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});

	try {
		const bottle = await quick({ action: 'bottle', volumeMl: 120 });
		expect(bottle.status).toBe(200);
		const logged = await bottle.json();
		expect(logged.did).toBe('logged');
		expect(logged.speech).toBe('Biberon 120 millilitres enregistré');

		// The saved event is a first-class one: it shows up in the ordinary list.
		const listed = await fetch(`${A}/api/events?babyId=${babyId}`, {
			headers: { authorization: `Bearer ${plaintext}` }
		});
		expect(listed.status).toBe(200);
		const { events } = await listed.json();
		expect(events.some((e: { id: string }) => e.id === logged.event.id)).toBe(true);

		// The same intent twice: the timer toggles instead of conflicting.
		const started = await (await quick({ action: 'sleep' })).json();
		expect(started.did).toBe('started');
		expect(started.speech).toBe('Dodo démarré');

		const stopped = await (await quick({ action: 'sleep' })).json();
		expect(stopped.did).toBe('stopped');
		expect(stopped.speech).toMatch(/^Dodo terminé, /);
		expect(stopped.event.id).toBe(started.event.id);

		const invalid = await quick({ action: 'bottle' });
		expect(invalid.status).toBe(400);
		expect((await invalid.json()).error.code).toBe('validation_failed');

		// Without the token the gate answers first, as for any other API path.
		const noAuth = await fetch(`${A}/api/quick`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'diaper', kind: 'wet' })
		});
		expect(noAuth.status).toBe(401);
		expect((await noAuth.json()).error.code).toBe('pin_required');

		// Clean up the events this spec left behind, so later specs (and the
		// seeded fixtures) see the server they expect.
		for (const id of [logged.event.id, stopped.event.id])
			await fetch(`${A}/api/events/${id}`, {
				method: 'DELETE',
				headers: { authorization: `Bearer ${plaintext}` }
			});
	} finally {
		await request.delete(`${A}/api/household/pin`, { data: { currentPin: '1357' } });
		await request.delete(`${A}/api/tokens/${token.id}`);
	}
});
