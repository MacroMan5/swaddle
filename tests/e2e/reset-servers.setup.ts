import { expect, test } from '@playwright/test';
// Relative imports: $lib aliases do not resolve outside SvelteKit's own build.
import { openDb } from '../../src/lib/server/db';
import { hashPin } from '../../src/lib/server/settings/auth';
import { BASE_B } from './ports';

const DB_PATH_A = '.playwright-data/swaddle.db';
const DB_PATH_B = '.playwright-data-empty/swaddle.db';
// Any value works: `POST /api/auth/pin` only checks it against whatever hash
// we install below, it doesn't parse the 4-8 digit shape auth.ts uses for
// *setting* a pin.
const TEMP_PIN = '048163';

// Both servers are shared across every browser project in this run — the
// webServer list in playwright.config.ts starts them once, not per project —
// so replaying the whole spec suite a second time under webkit needs both
// put back to the state `global-setup.ts` left them in first. This file is
// that reset, wired in as its own project (see playwright.config.ts) that
// runs, via `dependencies`, strictly between the chromium and webkit
// projects — never concurrently with either, since better-sqlite3's WAL
// file has no locking story for truncating tables while another project's
// specs might still be reading them.

// Server A (the seeded server most specs run against) accumulates data
// throughout a project's run the same way it always has, and most specs
// tolerate that by construction (afterEach cleanups, "today" filters, `id`s
// scoped to what they created). But not every spec does — e.g.
// history-recently-deleted.spec.ts restores an event it soft-deleted rather
// than cleaning it back up, and matches rows by a fixed volume text, which
// collided with the same literal left behind by chromium's run once webkit
// replayed the same file. Reseeding A to the exact state global-setup.ts
// produces removes that whole class of chromium → webkit leakage, instead of
// auditing every spec (present and future) for it individually.
test('reset server A to its freshly seeded state', () => {
	const db = openDb(DB_PATH_A);
	try {
		db.exec('DELETE FROM event; DELETE FROM caregiver; DELETE FROM baby; DELETE FROM household;');
		const now = new Date().toISOString();
		db.prepare(
			'INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES (?, ?, ?, ?, ?)'
		).run('baby-1', 'Testine', '2026-08-01', 'America/Toronto', now);
		db.prepare('INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
			'cg-1',
			'Parent',
			'#4f8a8b',
			now
		);
	} finally {
		db.close();
	}
});

test('reset server B to a pristine, pre-onboarding state', async () => {
	// Install a known pin so the poll below can log in successfully — that's
	// the only thing that clears `pinThrottle` (src/lib/server/settings/auth.ts),
	// the in-memory brute-force counter the "brute-force throttle" test in
	// pin.spec.ts deliberately trips. It never decays on its own: every
	// attempt made while locked still counts as a failure and re-arms the
	// lock (`recordFailure` re-sets `lockedUntil` whenever `failures >=
	// maxAttempts`, which stays true forever once tripped), so simply
	// waiting out the 30s lockout and then trying a *wrong* pin — the DB
	// reset below leaves no pin configured, which itself counts as a
	// failure — would immediately re-lock it for the next project. Polling
	// with the one pin we know is correct is the only way to end the loop.
	{
		const db = openDb(DB_PATH_B);
		try {
			db.prepare(
				`INSERT INTO household (id, pin_hash, created_at) VALUES (1, ?, ?)
				 ON CONFLICT (id) DO UPDATE SET pin_hash = excluded.pin_hash`
			).run(hashPin(TEMP_PIN), new Date().toISOString());
		} finally {
			db.close();
		}
	}

	const deadline = Date.now() + 40_000; // lockoutMs (30s) plus margin
	let unlocked = false;
	while (Date.now() < deadline) {
		const res = await fetch(`${BASE_B}/api/auth/pin`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pin: TEMP_PIN })
		});
		if (res.ok) {
			unlocked = true;
			break;
		}
		if (res.status !== 429) break; // neither locked nor accepted — stop and fail loudly below
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	expect(unlocked, 'the pin throttle on server B never released the lock').toBe(true);

	const db = openDb(DB_PATH_B);
	try {
		db.exec('DELETE FROM event; DELETE FROM caregiver; DELETE FROM baby; DELETE FROM household;');
		const counts = db
			.prepare(
				'SELECT (SELECT COUNT(*) FROM event) AS events, (SELECT COUNT(*) FROM baby) AS babies, (SELECT COUNT(*) FROM caregiver) AS caregivers, (SELECT COUNT(*) FROM household) AS household'
			)
			.get() as { events: number; babies: number; caregivers: number; household: number };
		expect(counts).toEqual({ events: 0, babies: 0, caregivers: 0, household: 0 });
	} finally {
		db.close();
	}
});
