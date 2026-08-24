import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// NFR-008: every color/radius/shadow must go through a design token. This
// statically scans all Svelte components for the usual ways that discipline
// gets broken: raw hex/rgb/hsl colors, black/white color utilities (any
// property, not just bg/text), hand-rolled shadows/blurs, Tailwind arbitrary
// shadow/radius values, and literal color/shadow/radius values in a raw
// `style="..."` attribute.
//
// Allowlist: none. `src/lib/palette.ts` holds the caregiver color swatches
// (user data, not a design token), but every consumer binds it through the
// Svelte `style:background-color={color}` / `style:border-color={...}`
// *directives* (not a raw `style="..."` attribute), and `style="--dot-color:
// {c}"`-shaped custom-property assignments are exempt by construction (see
// `FORBIDDEN_STYLE_PROPS` below — a `--custom-property` name never matches a
// literal `color`/`background`/etc. entry) — so no exception is needed here.

const SRC_DIR = join(__dirname, '..', '..', 'src');

function listSvelteFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true })
		.map((entry) => entry.toString())
		.filter((entry) => entry.endsWith('.svelte'))
		.map((entry) => join(dir, entry));
}

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_HSL_COLOR = /\b(?:rgb|rgba|hsl|hsla)\(/g;
// Any color-bearing Tailwind utility pinned to black/white, not just bg/text:
// border, ring, outline, divide, decoration, fill, stroke, shadow, caret,
// accent, and gradient stops (from/via/to) all bypass the palette the same way.
const COLOR_UTILITY_BLACK_WHITE =
	/\b(?:bg|text|border|ring|outline|divide|decoration|fill|stroke|shadow|caret|accent|from|via|to)-(?:black|white)\b/g;
const RAW_SHADOW = /box-shadow\s*:/g;
const RAW_BLUR = /backdrop-filter\s*:\s*blur/g;
// Tailwind arbitrary-value syntax for shadow/radius bypasses the token scale
// (e.g. `shadow-[0_2px_4px_rgba(0,0,0,.3)]`, `rounded-[7px]`).
const ARBITRARY_SHADOW_ROUNDED = /\b(?:shadow|rounded)-\[[^\]]+\]/g;

const FORBIDDEN_STYLE_PROPS = new Set([
	'color',
	'background',
	'background-color',
	'border-color',
	'box-shadow',
	'border-radius',
	'backdrop-filter'
]);

/**
 * Flags literal color/shadow/radius values inside a raw `style="..."`
 * attribute (as opposed to Svelte's `style:property={expr}` directive, which
 * this deliberately does not touch — see the module doc comment). A
 * `--custom-property` name (e.g. `--dot-color`) never matches
 * `FORBIDDEN_STYLE_PROPS`, and a value that is itself a template expression
 * (starts with `{`) is not a literal, so both are exempt by construction.
 */
function findRawStyleLiterals(content: string): string[] {
	const hits: string[] = [];
	const styleAttr = /style\s*=\s*"([^"]*)"/g;
	let attrMatch: RegExpExecArray | null;
	while ((attrMatch = styleAttr.exec(content))) {
		for (const decl of attrMatch[1].split(';')) {
			const colonIndex = decl.indexOf(':');
			if (colonIndex === -1) continue;
			const prop = decl.slice(0, colonIndex).trim();
			const value = decl.slice(colonIndex + 1).trim();
			if (FORBIDDEN_STYLE_PROPS.has(prop) && value !== '' && !value.startsWith('{')) {
				hits.push(`${prop}: ${value}`);
			}
		}
	}
	return hits;
}

function findViolations(content: string): string[] {
	return [
		...(content.match(HEX_COLOR) ?? []),
		...(content.match(RGB_HSL_COLOR) ?? []),
		...(content.match(COLOR_UTILITY_BLACK_WHITE) ?? []),
		...(content.match(RAW_SHADOW) ?? []),
		...(content.match(RAW_BLUR) ?? []),
		...(content.match(ARBITRARY_SHADOW_ROUNDED) ?? []),
		...findRawStyleLiterals(content)
	];
}

describe('NFR-008: design-token discipline (static guard)', () => {
	const files = listSvelteFiles(SRC_DIR);

	it('found Svelte components to scan', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const rel = relative(SRC_DIR, file);
		it(`${rel} has no raw colors, shadows, radii, or blurs bypassing tokens`, () => {
			const content = readFileSync(file, 'utf-8');
			const violations = findViolations(content);
			expect(violations, `token-discipline violation(s) in ${rel}: ${violations.join(', ')}`).toEqual(
				[]
			);
		});
	}

	// Regression harness: fixture strings the matchers above must (or must
	// not) flag, independent of what currently lives under src/. Guards
	// against a future edit silently narrowing a regex back to a blind spot.
	describe('fixture regression table', () => {
		const fixtures: { label: string; snippet: string; shouldFlag: boolean }[] = [
			{ label: 'hex color in a class', snippet: '<div class="bg-[#ff0000]"></div>', shouldFlag: true },
			{
				label: 'rgb() in a raw style attribute',
				snippet: '<div style="background: rgb(255, 0, 0)"></div>',
				shouldFlag: true
			},
			{
				label: 'hsl() in a raw style attribute',
				snippet: '<div style="color: hsl(0, 100%, 50%)"></div>',
				shouldFlag: true
			},
			{ label: 'bg-black / text-white utilities', snippet: '<p class="bg-black text-white">x</p>', shouldFlag: true },
			{
				label: 'border-white / ring-black utilities (non bg/text property)',
				snippet: '<div class="border-white ring-black"></div>',
				shouldFlag: true
			},
			{
				label: 'raw box-shadow in a style attribute',
				snippet: '<div style="box-shadow: 0 2px 4px rgba(0,0,0,0.2)"></div>',
				shouldFlag: true
			},
			{
				label: 'raw backdrop-filter: blur in a style attribute',
				snippet: '<div style="backdrop-filter: blur(8px)"></div>',
				shouldFlag: true
			},
			{
				label: 'Tailwind arbitrary shadow value',
				snippet: '<div class="shadow-[0_2px_4px_rgba(0,0,0,0.3)]"></div>',
				shouldFlag: true
			},
			{
				label: 'Tailwind arbitrary rounded value',
				snippet: '<div class="rounded-[7px]"></div>',
				shouldFlag: true
			},
			{
				label: 'design-token utility classes',
				snippet: '<div class="bg-primary text-ink rounded-control border-border"></div>',
				shouldFlag: false
			},
			{
				label: 'Svelte style:property directive bound to data (caregiver color)',
				snippet: '<button style:background-color={color} style:border-color={x}></button>',
				shouldFlag: false
			},
			{
				label: 'custom-property assignment fed from data (allowed pattern)',
				snippet: '<div style="--dot-color: {c}"></div>',
				shouldFlag: false
			}
		];

		for (const { label, snippet, shouldFlag } of fixtures) {
			it(`${shouldFlag ? 'flags' : 'allows'}: ${label}`, () => {
				const violations = findViolations(snippet);
				if (shouldFlag) expect(violations.length).toBeGreaterThan(0);
				else expect(violations).toEqual([]);
			});
		}
	});
});
