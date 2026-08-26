import { expect, test } from '@playwright/test';
import { BASE_A } from './ports';

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
	const ctxA = await browser.newContext({ baseURL: BASE_A });
	const ctxB = await browser.newContext({ baseURL: BASE_A });
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

test('#46: a baby correction made on device B appears on device A’s Today header without a reload', async ({
	browser,
	request
}) => {
	const ctxA = await browser.newContext({ baseURL: BASE_A });
	const ctxB = await browser.newContext({ baseURL: BASE_A });
	const pageA = await ctxA.newPage();
	const pageB = await ctxB.newPage();

	await pageA.goto('/');
	await expect(pageA.locator('header')).toContainText('Testine');

	// B corrects the baby's name via Settings.
	await pageB.goto('/settings');
	await pageB.getByRole('button', { name: /^Modifier Testine$/ }).click();
	await pageB.getByLabel('Prénom').fill('Testine Live');
	await pageB.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(pageB.getByText('Profil du bébé mis à jour.')).toBeVisible();

	// A sees the corrected name without reloading (SSE `baby` message).
	await expect(pageA.locator('header')).toContainText('Testine Live');

	await ctxA.close();
	await ctxB.close();

	// Restore the seeded name for other specs.
	const { babies } = await (await request.get('/api/babies')).json();
	const testine = babies.find((b: { name: string }) => b.name === 'Testine Live');
	if (testine) await request.patch(`/api/babies/${testine.id}`, { data: { name: 'Testine' } });
});
