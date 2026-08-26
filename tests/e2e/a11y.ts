// Shared accessibility-verification helpers (issue #54).
//
// Two spec files use them:
//   - a11y-scan.spec.ts        — automated semantic scans (axe-core)
//   - a11y-interaction.spec.ts — keyboard, obstruction, zoom, spacing, 320px
//
// Not a `*.spec.ts` file, so Playwright's default testMatch never collects it
// (same reason ports.ts is a plain module).
import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

// The prototype's accessibility contract is WCAG 2.1 A/AA. `best-practice` is
// deliberately left out: its findings (region/landmark heuristics, heading
// order preferences) are advisory and would drown the signal this ticket is
// after — a genuine, unwaived serious/critical semantic defect.
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Rules waived across every scan, each with the reason it is not a defect of
 * this remediation. Anything not listed here fails the scan at
 * serious/critical impact.
 *
 * Deliberately empty: every scan in a11y-scan.spec.ts passes the full WCAG
 * 2.1 A/AA rule set as-is, so there is nothing to waive rule-wide. The one
 * genuine finding (the dimmed active quick-action tile) is waived at the node
 * level, in the scan that sees it, so the rule stays armed everywhere else.
 * Keep it that way: a rule waived here is a rule no route can fail again.
 */
export const WAIVED_RULES: Record<string, string> = {};

type Violation = {
	id: string;
	impact: string | null | undefined;
	help: string;
	nodes: { target: unknown[]; failureSummary?: string }[];
};

function summarize(violations: Violation[]): string[] {
	return violations.flatMap((v) =>
		v.nodes.map(
			(n) =>
				`${v.id} (${v.impact}) ${JSON.stringify(n.target)} — ${(n.failureSummary ?? v.help)
					.replace(/\s+/g, ' ')
					.trim()}`
		)
	);
}

/**
 * Runs axe over the current page state and fails if any non-waived
 * serious/critical violation remains. `label` names the route × state × theme
 * so a failure says which scan broke without reading the stack.
 */
export async function expectNoSeriousViolations(
	page: Page,
	label: string,
	configure: (builder: AxeBuilder) => AxeBuilder = (b) => b
): Promise<void> {
	await settleAnimations(page);
	const results = await configure(new AxeBuilder({ page }).withTags(WCAG_TAGS)).analyze();
	const blocking = results.violations.filter(
		(v) => (v.impact === 'serious' || v.impact === 'critical') && !(v.id in WAIVED_RULES)
	);
	expect(summarize(blocking as Violation[]), `axe: ${label}`).toEqual([]);
}

/**
 * Turns the Registre entrance/pulse animations off for this page.
 *
 * playwright.config.ts already asks for `reducedMotion: 'reduce'` at the top
 * level, and `testInfo.project.use.reducedMotion` does resolve to `'reduce'` —
 * but under Playwright 1.62 the browser context is not actually emulating it
 * (`matchMedia('(prefers-reduced-motion: reduce)').matches` is `false` in the
 * page until `page.emulateMedia` is called explicitly). Left unhandled, axe
 * samples colours mid-fade and reports dozens of phantom contrast failures
 * (#faf9f7 text half-way through `enter-up`). Calling it here keeps this
 * ticket's scans honest without changing the shared config's timing for every
 * other spec; the config discrepancy is filed as a follow-up.
 */
export async function reduceMotion(page: Page): Promise<void> {
	await page.emulateMedia({ reducedMotion: 'reduce' });
}

/**
 * Waits until every finite animation has settled, so a scan or a measurement
 * never samples a transition in flight. Infinite animations (the active-timer
 * pulse) are excluded — they never finish by design.
 */
export async function settleAnimations(page: Page): Promise<void> {
	await page.waitForFunction(() =>
		document.getAnimations().every((a) => {
			const iterations = a.effect?.getTiming().iterations ?? 1;
			return iterations === Infinity || a.playState === 'finished' || a.playState === 'idle';
		})
	);
}

/** Makes the next `goto` render in forced dark mode (app.html reads this before paint). */
export async function forceDarkTheme(page: Page): Promise<void> {
	await page.addInitScript(() => localStorage.setItem('swaddle.theme', 'dark'));
}

/**
 * WCAG 1.4.12 Text Spacing: the user stylesheet the success criterion is
 * written against. Applied with `!important` so it beats the app's own
 * utility classes, exactly as a real user stylesheet or bookmarklet would.
 */
export const TEXT_SPACING_CSS = `
	* {
		line-height: 1.5 !important;
		letter-spacing: 0.12em !important;
		word-spacing: 0.16em !important;
	}
	p, li, h1, h2, h3, h4, h5, h6 {
		margin-bottom: 2em !important;
	}
`;

/**
 * A moment inside the *current local day*: `fraction` of the way from local
 * midnight to now (0 = midnight, 1 = now).
 *
 * Seeding "N minutes ago" is a midnight landmine, the same one
 * history-calendar.spec.ts's `yesterdayAt` was introduced to dodge (#81): run
 * the suite at 00:10 and a `now - 90 min` event lands on *yesterday*, so
 * "Aujourd'hui" and the History day view — both of which show the current
 * local day — come up empty and every assertion that needs a row fails.
 * `yesterdayAt` is the right answer for specs that navigate the day selector
 * back a day; these ones assert on the default (today) view of both screens,
 * so they need the mirror-image guarantee instead: always inside today, always
 * in the past, at any hour, with no branching. Anchoring to the elapsed part
 * of today gives exactly that. Right at midnight the window collapses and the
 * events pile up on the same instant — still today, still listed, which is all
 * these specs ask of them; verified by pinning `elapsed` to 30 s and running
 * both a11y spec files green in either engine.
 */
export function withinTodayIso(fraction: number): string {
	const midnight = new Date();
	midnight.setHours(0, 0, 0, 0);
	const elapsed = Date.now() - midnight.getTime();
	return new Date(midnight.getTime() + elapsed * fraction).toISOString();
}

/**
 * Gives server A a few of today's events so Today and the History day view are
 * exercised populated rather than empty.
 *
 * The returned ids MUST be handed back to `removeSeededEvents` once the test
 * is done: these events sit earlier in the day than the ones later specs
 * create, and history.spec.ts asserts on the *first* (oldest) row of the day —
 * leaving them behind would silently take that row over.
 */
export async function seedTodayEvents(request: APIRequestContext): Promise<string[]> {
	const events = [
		{
			type: 'bottle',
			startedAt: withinTodayIso(0.2),
			endedAt: null,
			details: { milkType: 'formula', volumeMl: 120 }
		},
		{
			type: 'diaper',
			startedAt: withinTodayIso(0.5),
			endedAt: null,
			details: { pee: true, poo: false }
		},
		{
			type: 'sleep',
			startedAt: withinTodayIso(0.7),
			endedAt: withinTodayIso(0.9),
			details: {}
		}
	];
	const ids: string[] = [];
	for (const event of events) {
		const res = await request.post('/api/events', {
			data: { babyId: 'baby-1', caregiverId: 'cg-1', ...event }
		});
		expect(res.status(), `seeding a ${event.type} event`).toBe(201);
		ids.push((await res.json()).id as string);
	}
	return ids;
}

/** Soft-deletes what `seedTodayEvents` created (see the ordering warning there). */
export async function removeSeededEvents(
	request: APIRequestContext,
	ids: string[]
): Promise<void> {
	for (const id of ids) await request.delete(`/api/events/${id}`);
}
