import { expect, test } from '@playwright/test';

test.afterEach(async ({ request }) => {
	for (const type of ['nursing', 'pump', 'sleep'])
		await request.post(`/api/timers/${type}/stop`, {
			data: { babyId: 'baby-1', ...(type === 'pump' ? { volumeMl: 10 } : {}) }
		});
});

test('AC-003: sleep started on device A is visible and stoppable on device B; A sees the end in < 2 s', async ({
	browser,
	request
}) => {
	// `browser.newContext()` inherits the project's `use.baseURL` (verified: a
	// manually created context resolves `goto('/')` to http://localhost:3000/
	// without this) — passed explicitly anyway so the spec doesn't rely on
	// that inheritance being obvious to a future reader.
	const ctxA = await browser.newContext({ baseURL: 'http://localhost:3000' });
	const ctxB = await browser.newContext({ baseURL: 'http://localhost:3000' });
	const pageA = await ctxA.newPage();
	const pageB = await ctxB.newPage();

	await pageA.goto('/');
	await pageA.getByRole('button', { name: 'Commencer le sommeil' }).click();
	await expect(pageA.getByTestId('active-timers')).toContainText('Sommeil');

	// Device B opens the app and sees the running timer (server state, not local).
	await pageB.goto('/');
	await expect(pageB.getByTestId('active-timers')).toContainText('Sommeil');

	// B stops it; A must see the end within the NFR-001 budget (2 s).
	await pageB.getByRole('button', { name: 'Réveillé' }).click();
	await expect(pageA.getByTestId('active-timers')).toBeHidden({ timeout: 2000 });

	await ctxA.close();
	await ctxB.close();
	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	expect(timers).toHaveLength(0);
});
