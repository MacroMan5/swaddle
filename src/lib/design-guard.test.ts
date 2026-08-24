import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// NFR-008: every color/radius/shadow must go through a design token. This
// statically scans all Svelte components for the usual ways that discipline
// gets broken: raw hex colors, black/white utility classes, and hand-rolled
// shadows/blurs that bypass the token layer.
//
// Allowlist: none. `src/lib/palette.ts` holds the caregiver color swatches
// (user data, not a design token), but every consumer binds it through
// `style:background-color={color}` / `style:border-color={...}` — the hex
// literals themselves never appear inside a .svelte file, so no exception is
// needed here.

const SRC_DIR = join(__dirname, '..', '..', 'src');

function listSvelteFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true })
		.map((entry) => entry.toString())
		.filter((entry) => entry.endsWith('.svelte'))
		.map((entry) => join(dir, entry));
}

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
const BLACK_WHITE_UTILITY = /\b(?:bg|text)-(?:black|white)\b/g;
const RAW_SHADOW = /box-shadow\s*:/g;
const RAW_BLUR = /backdrop-filter\s*:\s*blur/g;

describe('NFR-008: design-token discipline (static guard)', () => {
	const files = listSvelteFiles(SRC_DIR);

	it('found Svelte components to scan', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const rel = relative(SRC_DIR, file);
		it(`${rel} has no raw hex colors, black/white utilities, or hand-rolled shadows/blurs`, () => {
			const content = readFileSync(file, 'utf-8');

			const hexHits = content.match(HEX_COLOR) ?? [];
			expect(hexHits, `raw hex color literal(s) in ${rel}: ${hexHits.join(', ')}`).toEqual([]);

			const bwHits = content.match(BLACK_WHITE_UTILITY) ?? [];
			expect(
				bwHits,
				`black/white utility class(es) in ${rel}: ${bwHits.join(', ')}`
			).toEqual([]);

			const shadowHits = content.match(RAW_SHADOW) ?? [];
			expect(shadowHits, `raw box-shadow in ${rel}`).toEqual([]);

			const blurHits = content.match(RAW_BLUR) ?? [];
			expect(blurHits, `raw backdrop-filter: blur in ${rel}`).toEqual([]);
		});
	}
});
