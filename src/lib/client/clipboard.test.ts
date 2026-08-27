import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

/** Minimal fake textarea for the execCommand fallback path. */
function fakeTextarea(body: { children: unknown[] }) {
	const el = {
		value: '',
		style: {} as Record<string, string>,
		setAttribute: vi.fn(),
		focus: vi.fn(),
		select: vi.fn(),
		setSelectionRange: vi.fn(),
		remove: vi.fn(() => {
			const index = body.children.indexOf(el);
			if (index !== -1) body.children.splice(index, 1);
		})
	};
	return el;
}

function fakeDocument(execCommandResult: boolean | null = true) {
	const body: { children: unknown[] } = { children: [] };
	const doc = {
		createElement: vi.fn(() => fakeTextarea(body)),
		body: {
			appendChild: vi.fn((el: unknown) => body.children.push(el)),
			...body
		},
		execCommand: execCommandResult === null ? undefined : vi.fn(() => execCommandResult)
	};
	return doc;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('copyText', () => {
	it('uses the Async Clipboard API when available', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });

		const result = await copyText('hello');

		expect(result).toBe(true);
		expect(writeText).toHaveBeenCalledWith('hello');
	});

	it('falls back to execCommand when the clipboard API is unavailable', async () => {
		vi.stubGlobal('navigator', {});
		const doc = fakeDocument(true);
		vi.stubGlobal('document', doc);

		const result = await copyText('hello');

		expect(result).toBe(true);
		expect(doc.body.children).toHaveLength(0);
	});

	it('selects via focus + setSelectionRange so iOS Safari actually copies', async () => {
		vi.stubGlobal('navigator', {});
		const doc = fakeDocument(true);
		vi.stubGlobal('document', doc);

		await copyText('hello');

		const textarea = doc.createElement.mock.results[0]!.value;
		expect(textarea.focus).toHaveBeenCalled();
		expect(textarea.setSelectionRange).toHaveBeenCalledWith(0, 'hello'.length);
	});

	it('falls back to execCommand when writeText rejects', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('denied'));
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const doc = fakeDocument(true);
		vi.stubGlobal('document', doc);

		const result = await copyText('hello');

		expect(result).toBe(true);
	});

	it('returns false when no copy mechanism is available', async () => {
		vi.stubGlobal('navigator', {});
		const doc = fakeDocument(null);
		vi.stubGlobal('document', doc);

		const result = await copyText('hello');

		expect(result).toBe(false);
	});

	it('returns false when execCommand reports failure', async () => {
		vi.stubGlobal('navigator', {});
		const doc = fakeDocument(false);
		vi.stubGlobal('document', doc);

		const result = await copyText('hello');

		expect(result).toBe(false);
	});
});
