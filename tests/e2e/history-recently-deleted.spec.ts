import { expect, test } from '@playwright/test';

// Issue #50: the five-second undo toast (history-edit.spec.ts) is a
// convenience, not the only way back — "Supprimés récemment" must recover a
// deleted event after the toast has expired, after navigation/reload, and
// must surface a timer conflict (FR-013) through the French userMessage.
//
// Other specs sharing this suite's single worker/data dir also delete events
// for baby-1, so rows are matched by "most recently deleted" (list order,
// deletedAt DESC) rather than by a type/volume text that could collide with
// leftovers from another spec.

test('recovers a deleted event after the undo toast has expired', async ({ page }) => {
	await page.goto('/history');

	await page.getByRole('button', { name: 'Ajouter' }).click();
	await page.getByRole('button', { name: 'Biberon', exact: true }).click();
	await page.getByLabel('Volume (ml)').fill('130');
	await page.getByRole('button', { name: 'Enregistrer' }).click();

	const row = page.getByTestId('event-row').filter({ hasText: '130' });
	await expect(row).toHaveCount(1);

	await row.click();
	await page.getByRole('button', { name: 'Supprimer' }).click();
	await expect(page.getByTestId('event-row').filter({ hasText: '130' })).toHaveCount(0);

	// Let the 5 s undo toast expire. 12 s: expiry plus slack for a busy runner
	// (#82) — a toast that closes late is tolerated here.
	await expect(page.getByRole('status')).toBeHidden({ timeout: 12_000 });

	await page.getByRole('button', { name: 'Supprimés récemment' }).click();
	const deletedRow = page.getByTestId('recently-deleted-row').first();
	await expect(deletedRow).toContainText('Biberon');
	await expect(deletedRow).toContainText('130');
	await deletedRow.getByRole('button', { name: /Restaurer/ }).click();

	await expect(page.getByTestId('recently-deleted-row').filter({ hasText: '130' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('event-row').filter({ hasText: '130' })).toHaveCount(1);
});

test('a restored event survives navigation and reload', async ({ page }) => {
	await page.goto('/history');

	await page.getByRole('button', { name: 'Ajouter' }).click();
	await page.getByRole('button', { name: 'Biberon', exact: true }).click();
	await page.getByLabel('Volume (ml)').fill('141');
	await page.getByRole('button', { name: 'Enregistrer' }).click();

	const row = page.getByTestId('event-row').filter({ hasText: '141' });
	await row.click();
	await page.getByRole('button', { name: 'Supprimer' }).click();
	await expect(page.getByRole('status')).toBeVisible();

	// Navigate away before the toast resolves, then come back and reload —
	// the deleted event must still be reachable through "Supprimés récemment".
	await page.getByRole('link', { name: /Aujourd.hui/ }).click();
	await page.goto('/history');
	await page.reload();

	await page.getByRole('button', { name: 'Supprimés récemment' }).click();
	const deletedRow = page.getByTestId('recently-deleted-row').first();
	await expect(deletedRow).toContainText('141');
	await deletedRow.getByRole('button', { name: /Restaurer/ }).click();
	await expect(page.getByTestId('recently-deleted-row').filter({ hasText: '141' })).toHaveCount(0);

	await page.keyboard.press('Escape');
	await page.reload();
	await expect(page.getByTestId('event-row').filter({ hasText: '141' })).toHaveCount(1);
});

test('restoring a timer event surfaces the active-timer conflict (FR-013)', async ({
	page,
	request
}) => {
	const start = await request.post('/api/timers/sleep/start', { data: { babyId: 'baby-1' } });
	expect(start.status()).toBe(201);
	const { event: firstTimer } = await start.json();

	const del = await request.delete(`/api/events/${firstTimer.id}`);
	expect(del.status()).toBe(200);

	// A second sleep timer is now the only active one; restoring the deleted
	// one must conflict with it instead of duplicating an active timer.
	const restart = await request.post('/api/timers/sleep/start', { data: { babyId: 'baby-1' } });
	expect(restart.status()).toBe(201);

	await page.goto('/history');
	await page.getByRole('button', { name: 'Supprimés récemment' }).click();
	const deletedRow = page.getByTestId('recently-deleted-row').first();
	await expect(deletedRow).toContainText('Sommeil');
	await deletedRow.getByRole('button', { name: /Restaurer/ }).click();

	await expect(page.getByRole('alert')).toContainText('Une séance est déjà en cours.');
	// The conflicting row stays listed — the restore did not silently succeed.
	await expect(page.getByTestId('recently-deleted-row').first()).toContainText('Sommeil');

	// Leave no active timer behind for later specs sharing this baby.
	await request.post('/api/timers/sleep/stop', { data: { babyId: 'baby-1' } });
});

test('a slow initial load replays a live delete without refetching or clobbering it', async ({
	page,
	request
}) => {
	// RecentlyDeletedSheet has no component-level test harness in this repo
	// (no @testing-library/svelte or equivalent — the only .svelte-adjacent
	// unit tests are plain classes like historyWindow.svelte.ts), so this
	// race is covered end-to-end instead: an artificially delayed
	// GET /api/events?deleted=1 response must replay a live incremental delete
	// rather than overwrite it or issue a defensive refetch.
	const bottleId = async (volumeMl: number) => {
		const res = await request.post('/api/events', {
			data: {
				babyId: 'baby-1',
				type: 'bottle',
				startedAt: new Date().toISOString(),
				details: { milkType: 'formula', volumeMl }
			}
		});
		return (await res.json()).id as string;
	};

	await page.goto('/history');

	let matched = 0;
	await page.route(/\/api\/events\?.*deleted=1/, async (route) => {
		matched += 1;
		if (matched === 1) {
			// Let the first request reach the server immediately (so its response
			// reflects the state *before* B is deleted below), but hold the
			// response back from the page — simulating a slow network delivering
			// stale data late, after the second (faster) load already landed.
			const response = await route.fetch();
			await new Promise((resolve) => setTimeout(resolve, 800));
			await route.fulfill({ response });
			return;
		}
		await route.continue();
	});

	await page.getByRole('button', { name: 'Supprimés récemment' }).click();

	// Deleted while the sheet's slow initial fetch is still in flight; the SSE
	// confirmation updates the list immediately and is buffered for replay.
	const idB = await bottleId(163);
	await request.delete(`/api/events/${idB}`);

	const rowB = page.getByTestId('recently-deleted-row').filter({ hasText: '163' });
	// The incremental confirmation shows B almost immediately.
	await expect(rowB).toBeVisible({ timeout: 3000 });

	// `toBeVisible` only asserts B appeared *at some point* — it does not
	// re-check afterwards. The regression is the stale first response landing
	// *after* that and wiping B back out, so the real assertion is that B is
	// still there once that delayed response has had time to resolve (~800ms).
	await page.waitForTimeout(1000);
	await expect(rowB).toBeVisible();
	expect(matched).toBe(1);
});
