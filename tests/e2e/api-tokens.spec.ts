import { expect, test } from '@playwright/test';

import { BASE_A } from './ports';

const A = BASE_A;

// Runs on server A in the browser-less "api" project. Server A has no PIN by
// default, so the whole point of a Bearer — reaching the API without a session
// — is only observable while one is set: the spec sets a PIN, exercises the
// token, and always removes it again so later specs see the pristine server.
test('AC: a Bearer token reaches the API without a cookie, and revocation cuts it off', async ({
	request
}) => {
	// Minted while the app is still open, exactly as a parent would from
	// /settings on an unlocked device.
	const created = await request.post(`${A}/api/tokens`, { data: { name: 'iPhone e2e' } });
	expect(created.status()).toBe(201);
	const { plaintext, token } = await created.json();
	expect(plaintext).toMatch(/^swd_[A-Za-z0-9_-]+$/);
	expect(token).toMatchObject({ name: 'iPhone e2e', caregiverId: null, revokedAt: null });

	await request.put(`${A}/api/household/pin`, { data: { pin: '2468' } });
	try {
		// Bare fetch, not the `request` fixture: it carries no session cookie, so
		// this is a genuine headless client.
		const noAuth = await fetch(`${A}/api/events?babyId=baby-1`);
		expect(noAuth.status).toBe(401);
		expect((await noAuth.json()).error.code).toBe('pin_required');

		const withBearer = await fetch(`${A}/api/events?babyId=baby-1`, {
			headers: { authorization: `Bearer ${plaintext}` }
		});
		expect(withBearer.status).toBe(200);
		expect(Array.isArray((await withBearer.json()).events)).toBe(true);

		// A page is never unlocked by a token, however valid.
		const page = await fetch(`${A}/settings`, {
			headers: { authorization: `Bearer ${plaintext}` },
			redirect: 'manual'
		});
		expect(page.status).toBe(303);
		expect(page.headers.get('location')).toBe('/pin');

		// Nor is token management: minting successors needs the code.
		const mintWithBearer = await fetch(`${A}/api/tokens`, {
			method: 'POST',
			headers: { authorization: `Bearer ${plaintext}`, 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'successor' })
		});
		expect(mintWithBearer.status).toBe(401);

		// Revoking needs a PIN session; the `request` fixture has one because
		// setting the code signs the calling device in (PUT /api/household/pin).
		const listed = await (await request.get(`${A}/api/tokens`)).json();
		const mine = listed.tokens.find((t: { id: string }) => t.id === token.id);
		expect(mine.lastUsedAt).not.toBeNull(); // stamped by the calls above
		expect(JSON.stringify(listed)).not.toContain(plaintext);

		expect((await request.delete(`${A}/api/tokens/${token.id}`)).status()).toBe(204);

		const afterRevoke = await fetch(`${A}/api/events?babyId=baby-1`, {
			headers: { authorization: `Bearer ${plaintext}` }
		});
		expect(afterRevoke.status).toBe(401);
		expect((await afterRevoke.json()).error.code).toBe('pin_required');
	} finally {
		await request.delete(`${A}/api/household/pin`, { data: { currentPin: '2468' } });
	}
});
