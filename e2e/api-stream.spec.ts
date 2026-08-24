import { expect, test } from '@playwright/test';

test('SSE sends a snapshot on connect and a sync on change (FR-012)', async ({
	request,
	baseURL
}) => {
	// The Playwright request fixture buffers responses; use Node fetch to stream.
	const res = await fetch(`${baseURL}/api/stream`, {
		headers: { accept: 'text/event-stream' }
	});
	expect(res.headers.get('content-type')).toContain('text/event-stream');
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const readUntil = async (marker: string) => {
		const deadline = Date.now() + 10_000;
		while (!buffer.includes(marker) && Date.now() < deadline) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
		}
		expect(buffer).toContain(marker);
	};

	await readUntil('event: snapshot');
	expect(buffer).toContain('"serverTime"');
	expect(buffer).toContain('"activeTimers"');

	const created = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: new Date().toISOString(),
			details: { pee: true, poo: true }
		}
	});
	expect(created.status()).toBe(201);
	const { id } = await created.json();

	await readUntil('event: sync');
	await readUntil(id);
	expect(buffer).toContain('"kind":"created"');
	await reader.cancel();
});

test('snapshot includes the active timers', async ({ request, baseURL }) => {
	const started = await request.post('/api/timers/sleep/start', { data: { babyId: 'baby-1' } });
	const { event } = await started.json();

	const res = await fetch(`${baseURL}/api/stream`);
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const deadline = Date.now() + 10_000;
	while (!buffer.includes(event.id) && Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
	}
	expect(buffer).toContain(event.id);
	await reader.cancel();
	await request.post('/api/timers/sleep/stop', { data: { babyId: 'baby-1' } });
});

test('restore emits an event: reset frame so connected clients refetch (slice 5)', async ({
	request,
	baseURL
}) => {
	const res = await fetch(`${baseURL}/api/stream`);
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const readUntil = async (marker: string) => {
		const deadline = Date.now() + 10_000;
		while (!buffer.includes(marker) && Date.now() < deadline) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
		}
		expect(buffer).toContain(marker);
	};
	await readUntil('event: snapshot');

	// Round-trip the current data through restore: it leaves the seed intact
	// while still exercising the reset broadcast at the end of the route.
	const exported = await (await request.get('/api/export/json')).json();
	const restore = await request.post('/api/restore', { data: exported });
	expect(restore.ok()).toBeTruthy();

	await readUntil('event: reset');
	expect(buffer).toContain('"serverTime"');
	await reader.cancel();
});
