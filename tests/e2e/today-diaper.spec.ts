import { expect, test } from '@playwright/test';

test('AC-001: one-touch diaper is recorded and undoable for 5 s', async ({ page, request }) => {
	// Frozen clock: the two API round-trips below eat real time, and on a busy
	// runner the 5 s expiry could dismiss the toast before the Annuler click
	// (#82). Expiry timing itself is covered by the next test.
	await page.clock.install();
	await page.goto('/');
	await page.getByRole('button', { name: 'Pipi', exact: true }).click();

	const toast = page.getByRole('status');
	await expect(toast).toContainText('Couche enregistrée');
	await expect(toast.getByRole('button', { name: 'Annuler' })).toBeVisible();

	// The event exists server-side…
	const before = await (await request.get('/api/events?babyId=baby-1')).json();
	const diaper = before.events.find(
		(e: { type: string; details: { pee: boolean } }) => e.type === 'diaper' && e.details.pee
	);
	expect(diaper).toBeTruthy();

	// …and Annuler soft-deletes it.
	await toast.getByRole('button', { name: 'Annuler' }).click();
	await expect(toast).toBeHidden();
	const after = await (await request.get('/api/events?babyId=baby-1')).json();
	expect(after.events.map((e: { id: string }) => e.id)).not.toContain(diaper.id);
});

test('the toast disappears by itself after 5 s', async ({ page }) => {
	await page.clock.install();
	await page.goto('/');
	await page.getByRole('button', { name: 'Caca', exact: true }).click();
	await expect(page.getByRole('status')).toBeVisible();
	await page.clock.runFor(5000);
	await expect(page.getByRole('status')).toBeHidden();
});

test('a failed undo keeps the toast open with an error and allows retry (FR-018)', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Pipi', exact: true }).click();
	const toast = page.getByRole('status');
	await expect(toast).toContainText('Couche enregistrée');

	// Force the undo's DELETE to fail exactly once (DELETE is idempotent
	// server-side, so a real double-delete would not actually fail — this is the
	// deterministic way to exercise the failure path).
	let failedOnce = false;
	await page.route('**/api/events/*', async (route) => {
		if (route.request().method() === 'DELETE' && !failedOnce) {
			failedOnce = true;
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: { code: 'internal', message: 'boom' } })
			});
			return;
		}
		await route.continue();
	});

	await toast.getByRole('button', { name: 'Annuler' }).click();
	await expect(toast.getByRole('alert')).toBeVisible();
	await expect(toast).toBeVisible(); // stays open on failure, not silently dismissed

	// Retrying succeeds once the route stops failing.
	await toast.getByRole('button', { name: 'Annuler' }).click();
	await expect(toast).toBeHidden();
});

test('a slow undo spanning the 5 s deadline is not dismissed by the expiry timer (round 2, item 3)', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Caca', exact: true }).click();
	const toast = page.getByRole('status');
	await expect(toast).toContainText('Couche enregistrée');

	// The undo's DELETE takes well longer than the toast's own 5 s expiry, so the
	// 5.5 s check below can only pass if the expiry timer was actually suspended
	// — not because the (much later) delayed response happened to land first.
	await page.route('**/api/events/*', async (route) => {
		if (route.request().method() === 'DELETE') {
			await new Promise((resolve) => setTimeout(resolve, 8000));
		}
		await route.continue();
	});

	await toast.getByRole('button', { name: 'Annuler' }).click();
	await page.waitForTimeout(5500); // past the original 5 s deadline, undo still in flight
	await expect(toast).toBeVisible();
	// The delayed DELETE eventually resolves and dismisses the toast on success.
	// 10 s: the route already burned 8 s before continuing, and a busy runner
	// (#82) can add seconds on top — later is fine, dismissed-early would have
	// failed the toBeVisible above.
	await expect(toast).toBeHidden({ timeout: 10_000 });
});
