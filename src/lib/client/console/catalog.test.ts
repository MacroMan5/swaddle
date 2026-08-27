import { describe, it, expect } from 'vitest';
import { CONSOLE_ENDPOINTS } from './catalog';

// The catalog is hand-maintained (docs/api/ stays the source of truth); these
// invariants catch the mistakes hand maintenance actually makes.
describe('console catalog', () => {
	it('has unique ids', () => {
		const ids = CONSOLE_ENDPOINTS.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('only points at /api/ paths', () => {
		for (const e of CONSOLE_ENDPOINTS) expect(e.path, e.id).toMatch(/^\/api\//);
	});

	it('ships body templates that are valid JSON objects', () => {
		for (const e of CONSOLE_ENDPOINTS.filter((e) => e.body !== undefined)) {
			expect(() => JSON.parse(e.body!), e.id).not.toThrow();
			expect(typeof JSON.parse(e.body!), e.id).toBe('object');
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
