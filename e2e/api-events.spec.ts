import { expect, test, type APIRequestContext } from '@playwright/test';

const diaper = {
	babyId: 'baby-1',
	caregiverId: 'cg-1',
	type: 'diaper',
	startedAt: new Date().toISOString(),
	details: { pee: true, poo: false }
};

async function createDiaper(request: APIRequestContext) {
	const res = await request.post('/api/events', { data: diaper });
	expect(res.status()).toBe(201);
	return res.json();
}

test('lists the seeded baby', async ({ request }) => {
	const res = await request.get('/api/babies');
	expect(res.ok()).toBeTruthy();
	const { babies } = await res.json();
	expect(babies[0]).toMatchObject({ id: 'baby-1', name: 'Testine' });
});

test('creates, reads, lists, patches an event', async ({ request }) => {
	const created = await createDiaper(request);
	expect(created.id).toBeTruthy();
	expect(created.details).toEqual({ pee: true, poo: false });

	const got = await (await request.get(`/api/events/${created.id}`)).json();
	expect(got.id).toBe(created.id);

	const list = await (await request.get('/api/events?babyId=baby-1')).json();
	expect(list.events.map((e: { id: string }) => e.id)).toContain(created.id);

	const patched = await request.patch(`/api/events/${created.id}`, {
		data: { note: 'small one' }
	});
	expect(patched.status()).toBe(200);
	expect((await patched.json()).note).toBe('small one');
});

test('rejects FR-017 violations with 400 and issues (AC-010)', async ({ request }) => {
	const bad = await request.post('/api/events', {
		data: { ...diaper, type: 'bottle', details: { milkType: 'formula', volumeMl: 1500 } }
	});
	expect(bad.status()).toBe(400);
	const body = await bad.json();
	expect(body.error.code).toBe('validation_failed');
	expect(body.error.issues.length).toBeGreaterThan(0);
});

test('soft delete hides from list, restore brings back (FR-007)', async ({ request }) => {
	const created = await createDiaper(request);
	const del = await request.delete(`/api/events/${created.id}`);
	expect(del.status()).toBe(200);
	expect((await del.json()).deletedAt).not.toBeNull();

	const list = await (await request.get('/api/events?babyId=baby-1')).json();
	expect(list.events.map((e: { id: string }) => e.id)).not.toContain(created.id);

	const restored = await request.post(`/api/events/${created.id}/restore`);
	expect(restored.status()).toBe(200);
	expect((await restored.json()).deletedAt).toBeNull();
});

test('unknown event id yields 404 with error envelope', async ({ request }) => {
	const res = await request.get('/api/events/nope');
	expect(res.status()).toBe(404);
	expect((await res.json()).error.code).toBe('not_found');
});
