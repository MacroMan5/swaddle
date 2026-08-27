import { expect, test } from '@playwright/test';

import { BASE_A } from './ports';

// The API console (issue #115). An unknown dictated phrase is the perfect
// probe: it exercises the whole stack — gate, route, quick module — and
// answers 422 without writing anything, so the seeded server stays pristine.

test('AC: the console fires a quick intent and shows the raw envelope', async ({ page }) => {
	await page.goto('/console');

	// The default endpoint is the dictated phrase; only the text changes.
	await page.getByTestId('console-body').fill('{"action":"phrase","text":"zzz console"}');
	await page.getByTestId('console-send').click();

	await expect(page.getByTestId('console-status')).toContainText('422');
	const response = page.getByTestId('console-response');
	await expect(response).toContainText('unrecognized_phrase');
	await expect(response).toContainText("Je n'ai pas compris");

	// A malformed intent shows the 400 envelope — with the speech the voice
	// clients read (the very field a misconfigured shortcut needs to hear).
	await page.getByTestId('console-body').fill('{"action":"bottle"}');
	await page.getByTestId('console-send').click();

	await expect(page.getByTestId('console-status')).toContainText('400');
	await expect(response).toContainText('validation_failed');
	await expect(response).toContainText("Je n'ai pas compris la demande");
});

test('AC: token-only mode authenticates like a headless shortcut', async ({ page, request }) => {
	const created = await request.post(`${BASE_A}/api/tokens`, { data: { name: 'Console e2e' } });
	expect(created.status()).toBe(201);
	const { plaintext, token } = await created.json();

	// Load the page first: once the PIN is set, navigation would demand it.
	await page.goto('/console');
	await page.getByTestId('console-body').fill('{"action":"phrase","text":"zzz console"}');
	await request.put(`${BASE_A}/api/household/pin`, { data: { pin: '2468' } });

	try {
		// Session mode with no session: the gate answers first.
		await page.getByTestId('console-send').click();
		await expect(page.getByTestId('console-status')).toContainText('401');
		await expect(page.getByTestId('console-response')).toContainText('pin_required');

		// The same call with the Bearer alone (credentials omitted) goes through
		// the gate and reaches the route.
		await page.getByTestId('console-auth-token').click();
		await page.getByTestId('console-token').fill(plaintext);
		await page.getByTestId('console-send').click();
		await expect(page.getByTestId('console-status')).toContainText('422');
		await expect(page.getByTestId('console-response')).toContainText('unrecognized_phrase');
	} finally {
		await request.delete(`${BASE_A}/api/household/pin`, { data: { currentPin: '2468' } });
		await request.delete(`${BASE_A}/api/tokens/${token.id}`);
	}
});

test('the settings screen links to the console', async ({ page }) => {
	await page.goto('/settings');
	await page.getByTestId('open-console').click();
	await expect(page).toHaveURL(/\/console$/);
	await expect(page.getByRole('heading', { name: 'Console API' })).toBeVisible();
});
