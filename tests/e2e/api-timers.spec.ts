import { expect, test, type APIRequestContext } from '@playwright/test';

const start = (request: APIRequestContext, type: string, data: object = {}) =>
	request.post(`/api/timers/${type}/start`, { data: { babyId: 'baby-1', ...data } });
const stop = (request: APIRequestContext, type: string, data: object = {}) =>
	request.post(`/api/timers/${type}/stop`, { data: { babyId: 'baby-1', ...data } });

test.afterEach(async ({ request }) => {
	// Leave no active timers behind for the next test; a pump only stops with a
	// volume (FR-004). Tests that start a future-dated session clean up themselves.
	for (const type of ['nursing', 'sleep']) await stop(request, type);
	await stop(request, 'pump', { volumeMl: 100 });
});

test('start → 201, concurrent start → 200 with the same session (AC-004)', async ({ request }) => {
	const first = await start(request, 'sleep');
	expect(first.status()).toBe(201);
	const firstBody = await first.json();
	expect(firstBody.created).toBe(true);

	const second = await start(request, 'sleep');
	expect(second.status()).toBe(200);
	const secondBody = await second.json();
	expect(secondBody.created).toBe(false);
	expect(secondBody.event.id).toBe(firstBody.event.id);
});

test('GET /api/timers returns serverTime and active sessions (AC-005 recovery)', async ({
	request
}) => {
	const started = await (await start(request, 'nursing', { side: 'left' })).json();
	const res = await request.get('/api/timers?babyId=baby-1');
	const body = await res.json();
	expect(Date.parse(body.serverTime)).not.toBeNaN();
	expect(body.timers.map((t: { id: string }) => t.id)).toContain(started.event.id);
});

test('nursing pause/resume/switch-side transitions', async ({ request }) => {
	await start(request, 'nursing', { side: 'left' });
	const action = (data: object) =>
		request.post('/api/timers/nursing/action', { data: { babyId: 'baby-1', ...data } });

	expect((await action({ action: 'pause' })).status()).toBe(200);
	expect((await action({ action: 'pause' })).status()).toBe(409);
	expect((await action({ action: 'resume' })).status()).toBe(200);
	const switched = await action({ action: 'switch-side' });
	expect(switched.status()).toBe(200);
	const segments = (await switched.json()).details.segments;
	expect(segments[segments.length - 1].side).toBe('right');
});

test('stop without an active timer → 404 no_active_timer', async ({ request }) => {
	const res = await stop(request, 'pump');
	expect(res.status()).toBe(404);
	expect((await res.json()).error.code).toBe('no_active_timer');
});

test('unknown timer type → 404', async ({ request }) => {
	expect((await start(request, 'bath')).status()).toBe(404);
});

test('pump stop records volume; volume 1500 → 400 (FR-017)', async ({ request }) => {
	await start(request, 'pump', { side: 'left' });
	const bad = await stop(request, 'pump', { volumeMl: 1500 });
	expect(bad.status()).toBe(400);
	const ok = await stop(request, 'pump', { volumeMl: 120 });
	expect(ok.status()).toBe(200);
	expect((await ok.json()).details).toEqual({ side: 'left', volumeMl: 120 });
});

test('stop with an endedAt before the session start → 400 (FR-017)', async ({ request }) => {
	const started = await (await start(request, 'sleep')).json();
	const before = new Date(Date.parse(started.event.startedAt) - 60_000).toISOString();

	const res = await stop(request, 'sleep', { endedAt: before });
	expect(res.status()).toBe(400);
	expect((await res.json()).error.code).toBe('validation_failed');

	// Nothing was persisted: the session is still running.
	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	expect(timers.map((t: { id: string }) => t.id)).toContain(started.event.id);
});

test('a future-dated session never persists an end before its start', async ({ request }) => {
	const startedAt = new Date(Date.now() + 4 * 60_000).toISOString();
	const started = await (await start(request, 'sleep', { startedAt })).json();

	const immediate = await stop(request, 'sleep');
	expect(immediate.status()).toBe(400);

	const stopped = await stop(request, 'sleep', {
		endedAt: new Date(Date.now() + 4.5 * 60_000).toISOString()
	});
	expect(stopped.status()).toBe(200);
	const body = await stopped.json();
	expect(body.id).toBe(started.event.id);
	expect(Date.parse(body.endedAt)).toBeGreaterThanOrEqual(Date.parse(body.startedAt));
});

test('stopping a pump without a volume → 400 (FR-004)', async ({ request }) => {
	await start(request, 'pump', { side: 'right' });
	const res = await stop(request, 'pump');
	expect(res.status()).toBe(400);
	expect((await res.json()).error.code).toBe('validation_failed');
});

test('malformed JSON body yields a 400 envelope', async ({ request }) => {
	const res = await request.post('/api/timers/sleep/start', {
		headers: { 'content-type': 'application/json' },
		data: '{ not json'
	});
	expect(res.status()).toBe(400);
	expect((await res.json()).error.code).toBe('validation_failed');
});
