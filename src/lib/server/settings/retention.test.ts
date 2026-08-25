import { mkdtempSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pruneSnapshots } from './retention';

vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return {
		...actual,
		unlinkSync: vi.fn((path: Parameters<typeof unlinkSync>[0]) => {
			if (String(path).includes('stuck')) throw new Error('EPERM: simulated filesystem error');
			return actual.unlinkSync(path);
		})
	};
});

let dir: string | null = null;

function tempDataDir(): string {
	dir = mkdtempSync(join(tmpdir(), 'swaddle-retention-'));
	return dir;
}

/** Creates `name` under `dir` and stamps it with a distinct, ordered mtime. */
function snapshot(dir: string, name: string, minutesAgo: number): void {
	const path = join(dir, name);
	writeFileSync(path, 'x');
	const time = new Date(Date.now() - minutesAgo * 60_000);
	utimesSync(path, time, time);
}

afterEach(() => {
	if (dir !== null) rmSync(dir, { recursive: true, force: true });
	dir = null;
});

describe('pruneSnapshots', () => {
	it('does nothing when the directory does not exist', () => {
		const dataDir = tempDataDir();
		expect(() => pruneSnapshots(join(dataDir, 'missing'), 'backup', 10)).not.toThrow();
	});

	it('leaves everything untouched when at or under the limit', () => {
		const dataDir = tempDataDir();
		for (let i = 0; i < 10; i++) snapshot(dataDir, `backup-${i}.sqlite`, i);
		pruneSnapshots(dataDir, 'backup', 10);
		expect(readdirSync(dataDir)).toHaveLength(10);
	});

	it('keeps exactly the newest N by mtime and deletes the rest', () => {
		const dataDir = tempDataDir();
		// 15 backups, ages 0..14 minutes; newest 10 are ages 0..9.
		for (let i = 0; i < 15; i++) snapshot(dataDir, `backup-${i}.sqlite`, i);
		pruneSnapshots(dataDir, 'backup', 10);
		const remaining = readdirSync(dataDir).sort();
		const expected = Array.from({ length: 10 }, (_, i) => `backup-${i}.sqlite`).sort();
		expect(remaining).toEqual(expected);
	});

	it('breaks ties on identical/close mtimes deterministically by filename', () => {
		const dataDir = tempDataDir();
		// Three snapshots sharing the exact same mtime; keep=2 must drop
		// exactly one, and always the same one (lowest name), not a random pick.
		snapshot(dataDir, 'backup-a.sqlite', 5);
		snapshot(dataDir, 'backup-b.sqlite', 5);
		snapshot(dataDir, 'backup-c.sqlite', 5);
		pruneSnapshots(dataDir, 'backup', 2);
		expect(readdirSync(dataDir).sort()).toEqual(['backup-b.sqlite', 'backup-c.sqlite']);
	});

	it('only considers files matching the given kind, leaving other kinds and unrelated files alone', () => {
		const dataDir = tempDataDir();
		for (let i = 0; i < 12; i++) snapshot(dataDir, `backup-${i}.sqlite`, i);
		snapshot(dataDir, 'pre-restore-0.sqlite', 0);
		snapshot(dataDir, 'pre-restore-1.sqlite', 1);
		writeFileSync(join(dataDir, 'notes.txt'), 'not a backup');

		pruneSnapshots(dataDir, 'backup', 10);

		const remaining = readdirSync(dataDir);
		expect(remaining).toContain('pre-restore-0.sqlite');
		expect(remaining).toContain('pre-restore-1.sqlite');
		expect(remaining).toContain('notes.txt');
		expect(remaining.filter((n) => n.startsWith('backup-'))).toHaveLength(10);
	});

	it('prunes backup and pre-restore kinds independently', () => {
		const dataDir = tempDataDir();
		for (let i = 0; i < 12; i++) snapshot(dataDir, `backup-${i}.sqlite`, i);
		for (let i = 0; i < 12; i++) snapshot(dataDir, `pre-restore-${i}.sqlite`, i);

		pruneSnapshots(dataDir, 'backup', 10);
		pruneSnapshots(dataDir, 'pre-restore', 10);

		const remaining = readdirSync(dataDir);
		expect(remaining.filter((n) => n.startsWith('backup-'))).toHaveLength(10);
		expect(remaining.filter((n) => n.startsWith('pre-restore-'))).toHaveLength(10);
	});

	it('does not throw and keeps the retained files when a victim cannot be deleted', () => {
		const dataDir = tempDataDir();
		for (let i = 0; i < 9; i++) snapshot(dataDir, `backup-${i}.sqlite`, i);
		// Oldest of the bunch; `unlinkSync` is mocked above to fail for any
		// path containing "stuck", simulating a filesystem error (e.g. EPERM)
		// on exactly the file pruning would otherwise delete.
		snapshot(dataDir, 'backup-stuck.sqlite', 20);

		expect(() => pruneSnapshots(dataDir, 'backup', 9)).not.toThrow();
		// The 9 real, newer snapshots are all still present — the failure to
		// delete the stuck one cost nothing.
		for (let i = 0; i < 9; i++) expect(readdirSync(dataDir)).toContain(`backup-${i}.sqlite`);
		expect(readdirSync(dataDir)).toContain('backup-stuck.sqlite');
	});
});
