import { describe, it, expect } from 'vitest';
import { CONSOLE_ENDPOINTS, DEFAULT_ENDPOINT_ID } from './catalog';

// The catalog is hand-maintained (docs/api/ stays the source of truth); these
// invariants catch the mistakes hand maintenance actually makes.
describe('console catalog', () => {
	it('has unique ids', () => {
		const ids = CONSOLE_ENDPOINTS.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('contains the entry the page opens on', () => {
		expect(CONSOLE_ENDPOINTS.some((e) => e.id === DEFAULT_ENDPOINT_ID)).toBe(true);
	});

	it('tells entries sharing a method and path apart with a label', () => {
		// The picker renders `method path — label`; without distinct labels the
		// five quick intents would read as five identical options.
		const shown = CONSOLE_ENDPOINTS.map((e) => `${e.method} ${e.path} — ${e.label ?? ''}`);
		expect(new Set(shown).size).toBe(shown.length);
	});

	it('only points at /api/ paths', () => {
		for (const e of CONSOLE_ENDPOINTS) expect(e.path, e.id).toMatch(/^\/api\//);
	});

	it('ships body templates that are valid JSON objects', () => {
		for (const e of CONSOLE_ENDPOINTS.filter((e) => e.body !== undefined)) {
			expect(() => JSON.parse(e.body!), e.id).not.toThrow();
			const parsed: unknown = JSON.parse(e.body!);
			expect(typeof parsed, e.id).toBe('object');
			expect(parsed, e.id).not.toBeNull();
		}
	});

	it('never puts a body on a GET', () => {
		for (const e of CONSOLE_ENDPOINTS.filter((e) => e.method === 'GET'))
			expect(e.body, e.id).toBeUndefined();
	});

	it('marks every /api/tokens entry PIN-only, matching the gate rule', () => {
		for (const e of CONSOLE_ENDPOINTS.filter((e) => e.path.startsWith('/api/tokens')))
			expect(e.pinOnly, e.id).toBe(true);
	});
});
