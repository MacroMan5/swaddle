import { expect, test } from '@playwright/test';

test('household defaults, patch, caregiver CRUD', async ({ request }) => {
	const before = await (await request.get('/api/household')).json();
	expect(before).toMatchObject({ volumeUnit: 'ml', theme: 'auto', pinEnabled: false });
	const patched = await request.patch('/api/household', { data: { theme: 'dark' } });
	expect((await patched.json()).theme).toBe('dark');
	await request.patch('/api/household', { data: { theme: 'auto' } }); // restore

	const created = await request.post('/api/caregivers', { data: { name: 'Papa', color: '#0284C7' } });
	expect(created.status()).toBe(201);
	const { id } = await created.json();
	const renamed = await request.patch(`/api/caregivers/${id}`, { data: { name: 'Papou' } });
	expect((await renamed.json()).name).toBe('Papou');
	expect((await request.delete(`/api/caregivers/${id}`)).status()).toBe(204);
});

test('caregiver referenced by an event cannot be deleted', async ({ request }) => {
	const res = await request.delete('/api/caregivers/cg-1'); // seeded, referenced by earlier api specs' events
	// cg-1 may or may not be referenced depending on spec order — create our own referenced caregiver instead:
	const cg = await (await request.post('/api/caregivers', { data: { name: 'Ref', color: '#112233' } })).json();
	await request.post('/api/events', {
		data: { babyId: 'baby-1', caregiverId: cg.id, type: 'diaper', startedAt: new Date().toISOString(), details: { pee: true, poo: false } }
	});
	const del = await request.delete(`/api/caregivers/${cg.id}`);
	expect(del.status()).toBe(409);
	expect((await del.json()).error.code).toBe('in_use');
	void res;
});

test('AC-007: export json → restore reproduces the data and leaves a snapshot', async ({ request }) => {
	const exported = await (await request.get('/api/export/json')).json();
	expect(exported).toMatchObject({ format: 'swaddle-export', version: 1 });
	const restore = await request.post('/api/restore', { data: exported });
	expect(restore.ok()).toBeTruthy();
	const body = await restore.json();
	expect(body.restored.events).toBe(exported.events.length);
	expect(body.snapshot).toContain('pre-restore');
	const after = await (await request.get('/api/export/json')).json();
	expect(after.events).toEqual(exported.events);
	expect(after.babies).toEqual(exported.babies);
});

test('csv export has a header and one line per event', async ({ request }) => {
	const res = await request.get('/api/export/csv');
	expect(res.headers()['content-type']).toContain('text/csv');
	const lines = (await res.text()).trim().split('\n');
	expect(lines[0]).toContain('id,babyId');
	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	expect(lines.length).toBeGreaterThanOrEqual(1 + events.length);
});

test('backup downloads a sqlite snapshot', async ({ request }) => {
	const res = await request.get('/api/backup');
	expect(res.status()).toBe(200);
	expect((await res.body()).subarray(0, 15).toString()).toContain('SQLite format 3');
});
