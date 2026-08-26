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

// #99: the shortcut a parent actually uses says one sentence and lets the
// server work out what it meant — including a word added minutes earlier.
test('AC: a dictated phrase is resolved against the vocabulary, which the household can extend', async ({
	request
}) => {
	const created = await request.post(`${A}/api/tokens`, { data: { name: 'Dictée e2e' } });
	const { plaintext, token } = await created.json();

	const phrase = (text: string) =>
		fetch(`${A}/api/quick`, {
			method: 'POST',
			headers: { authorization: `Bearer ${plaintext}`, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'phrase', text })
		});

	let addedWordId: string | null = null;
	const logged: string[] = [];
	try {
		const started = await phrase('néné droite');
		expect(started.status).toBe(200);
		const startedBody = await started.json();
		expect(startedBody.did).toBe('started');
		expect(startedBody.speech).toBe('Tétée côté droit démarrée');

		const stopped = await (await phrase('Néné !')).json();
		expect(stopped.did).toBe('stopped');
		expect(stopped.event.id).toBe(startedBody.event.id);
		logged.push(stopped.event.id);

		// A refusal still gives the assistant something to say.
		const unknown = await phrase('bonjour');
		expect(unknown.status).toBe(422);
		const unknownBody = await unknown.json();
		expect(unknownBody.error.code).toBe('unrecognized_phrase');
		expect(unknownBody.speech).toContain("Je n'ai pas compris");

		// The same word, added through the API, works on the very next sentence.
		const word = await request.post(`${A}/api/quick/words`, {
			data: { word: 'Bonjour', intent: { action: 'diaper', kind: 'wet' } }
		});
		expect(word.status()).toBe(201);
		addedWordId = (await word.json()).id;

		const duplicate = await request.post(`${A}/api/quick/words`, {
			data: { word: 'bonjour', intent: { action: 'sleep' } }
		});
		expect(duplicate.status()).toBe(409);
		expect((await duplicate.json()).error.code).toBe('duplicate_word');

		const recognised = await phrase('bonjour');
		expect(recognised.status).toBe(200);
		const recognisedBody = await recognised.json();
		expect(recognisedBody.speech).toBe('Couche pipi enregistrée');
		logged.push(recognisedBody.event.id);
	} finally {
		for (const id of logged) await request.delete(`${A}/api/events/${id}`);
		if (addedWordId !== null) await request.delete(`${A}/api/quick/words/${addedWordId}`);
		await request.delete(`${A}/api/tokens/${token.id}`);
	}
});
