import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
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

	// The pre-restore snapshot (FR-014) must be a real, openable SQLite file
	// holding the state as it was right before the wipe — not just a path
	// string in the response.
	const snapshotDb = new Database(body.snapshot, { readonly: true });
	const { n: snapshotEventCount } = snapshotDb.prepare('SELECT COUNT(*) AS n FROM event').get() as {
		n: number;
	};
	snapshotDb.close();
	expect(snapshotEventCount).toBe(exported.events.length);

	const after = await (await request.get('/api/export/json')).json();
	expect(after.events).toEqual(exported.events);
	expect(after.babies).toEqual(exported.babies);
});

test('restore rejects a corrupted export before writing anything', async ({ request }) => {
	const exported = await (await request.get('/api/export/json')).json();
	const before = await (await request.get('/api/export/json')).json();

	const unknownRef = { ...exported, events: [{ ...exported.events[0], babyId: 'no-such-baby' }] };
	const missingRef = await request.post('/api/restore', { data: unknownRef });
	expect(missingRef.status()).toBe(400);
	expect((await missingRef.json()).error.code).toBe('validation_failed');

	const duplicateId = {
		...exported,
		events: [exported.events[0], { ...exported.events[0] }]
	};
	const dup = await request.post('/api/restore', { data: duplicateId });
	expect(dup.status()).toBe(400);

	const after = await (await request.get('/api/export/json')).json();
	const { exportedAt: _before, ...restBefore } = before;
	const { exportedAt: _after, ...restAfter } = after;
	void _before;
	void _after;
	expect(restAfter).toEqual(restBefore);
});

test('#45: a restore above 512 KiB succeeds, one above 10 MiB is refused untouched', async ({
	request
}) => {
	const original = await (await request.get('/api/export/json')).json();
	const [{ id: babyId }] = original.babies;
	const [{ id: caregiverId }] = original.caregivers;
	const now = new Date().toISOString();

	// Bigger than adapter-node's 512 KiB default, which used to report a valid
	// export as malformed JSON: ~4000 events is a couple of years of tracking.
	const many = Array.from({ length: 4000 }, (_, i) => ({
		id: `bulk-${i}`,
		babyId,
		caregiverId,
		type: 'diaper',
		startedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
		endedAt: null,
		note: 'x'.repeat(120),
		details: { pee: true, poo: false },
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	}));
	const large = JSON.stringify({ ...original, events: many });
	expect(large.length).toBeGreaterThan(512 * 1024);

	const restored = await request.post('/api/restore', {
		headers: { 'content-type': 'application/json' },
		data: large
	});
	expect(restored.status()).toBe(200);
	const { snapshot } = await restored.json();
	expect((await (await request.get('/api/export/json')).json()).events).toHaveLength(many.length);

	// Above the bound: a distinct 413 envelope, no snapshot, data untouched.
	const backupsDir = dirname(snapshot);
	const snapshotsBefore = readdirSync(backupsDir).length;
	const oversized = `{"format":"swaddle-export","version":1,"exportedAt":"${now}","household":{"volumeUnit":"ml","theme":"auto"},"babies":[],"caregivers":[],"events":[],"pad":"${'x'.repeat(11 * 1024 * 1024)}"}`;
	const refused = await request.post('/api/restore', {
		headers: { 'content-type': 'application/json' },
		data: oversized
	});
	expect(refused.status()).toBe(413);
	expect((await refused.json()).error.code).toBe('payload_too_large');
	expect(readdirSync(backupsDir)).toHaveLength(snapshotsBefore);
	expect((await (await request.get('/api/export/json')).json()).events).toHaveLength(many.length);

	// Put the household back the way the other specs expect it.
	expect((await request.post('/api/restore', { data: original })).status()).toBe(200);
	const after = await (await request.get('/api/export/json')).json();
	expect(after.events).toEqual(original.events);
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
